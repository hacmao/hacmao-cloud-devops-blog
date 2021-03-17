---
title: From docker-compose to ECS Cluster
date: 2021-03-16 15:35:28
tags:
  - docker
  - ecs
---

# From Docker compose to ECS Cluster  

## Create ECS cluster  

Làm việc với ECS có thể cần liên quan tới khá nhiều mạng mẽo. Trước tiên để đơn giản trong quá trình setup mà không cần quan tâm nhiều tới vấn đề mạng mẽo bên dưới, ta sẽ sử dụng `ECS Fargate`.  

Mình sẽ sử dụng `CDK` để tạo cluster.  

+ `Vpc`:  

```ts
const vpc = new ec2.Vpc(this, 'Vpc', { 
    maxAzs: 2,
    natGateways: 0,
    subnetConfiguration: [
    {
        cidrMask: 24,
        name: 'nodejs-ecs',
        subnetType: ec2.SubnetType.PUBLIC,
    }
    ]
});
new cdk.CfnOutput(this, 'vpc', { value: vpc.vpcId });
```

Ta sẽ tạo một `Vpc` với 2 Multi-Az. Vì `Natgateway` khá là đắt nên mình sẽ dùng hoàn toàn mạng public với CIDR là `10.0.0.0/16` và 2 subnet cho 2 Multi-Az với `cidrMask` là 24.  

+ `Elastic Load Balancer`:  

```ts
const elb = new elbv2.NetworkLoadBalancer(this, 'nodejs-ELB', {
  loadBalancerName: 'nodejs-NLB',
  vpc: vpc,
  internetFacing: true
});
new cdk.CfnOutput(this, 'Website Url', { value: elb.loadBalancerDnsName });
```

+ `Cluster`:  

```ts
const cluster = new ecs.Cluster(this, 'nodejs-mongodb-ecs', {
  clusterName: 'nodejs-app',
  vpc: vpc
});
```

## Docker ecs-cli  

Install [ecs-cli](https://github.com/docker/compose-cli/blob/main/INSTALL.md) cho phiên bản Linux.  
Mới đây, docker đã thiết lập một extension để tích hợp trực tiếp với ecs. Lưu ý đây mới là phiên bản beta nên còn khá nhiều lỗi. Khi cài với Linux mà thất bại, có thể thử dùng với quyền `sudo`.  

Ta sẽ tạo một context của aws trong docker :  

```bash
docker compose create ecs aws
```

Lưu ý khi dùng context của aws thì các credential cần được lưu dưới dạng enviroment variable.  

Ta sẽ tiến hành deploy 1 web node-js đã tạo trong bài [Containerized nodejs Application](http://hacmao-blog.s3-website-ap-southeast-1.amazonaws.com/2021/03/15/Containerizing-nodejs-app-with-docker-compose/).  

File `docker-compose.yml` hiện tại có dạng như sau:  

```bash
version: '3'

services:
  nodejs:
    build:
      context: .
      dockerfile: Dockerfile
    image: hacmao/nodejs-app:v1.0
    container_name: nodejs
    restart: unless-stopped
    env_file: .env
    environment:
      - MONGO_USERNAME=$MONGO_USERNAME
      - MONGO_PASSWORD=$MONGO_PASSWORD
      - MONGO_HOSTNAME=db
      - MONGO_PORT=$MONGO_PORT
      - MONGO_DB=$MONGO_DB
    ports:
      - "80:8080"
    volumes:
      - .:/home/node/app
      - node_modules:/home/node/app/node_modules
    networks:
      - app-network
    command: ./wait-for.sh db:27017 -- /home/node/app/node_modules/.bin/nodemon app.js

  db:
    image: mongo:4.1.8-xenial
    container_name: db
    restart: unless-stopped
    env_file: .env
    environment:
      - MONGO_INITDB_ROOT_USERNAME=$MONGO_USERNAME
      - MONGO_INITDB_ROOT_PASSWORD=$MONGO_PASSWORD
    volumes:
      - dbdata:/data/db
    networks:
      - app-network

networks:
  app-network:
    driver: bridge

volumes:
  dbdata:
  node_modules:
```

Điểm đặc biệt của plugin `ecs-cli` này là có thể dùng file `docker-compose.yml` dùng trên local để deploy lên ecs cluster mà không cần thay đổi quá nhiều.  

Các điểm cần sửa đổi để chạy trên ecs là :  

+ `ports`. ECS CLuster không cho phép ta có thể map hai port khác nhau mà phải là `8080:8080`.  
+ `image`: phải là một image có sẵn trên dockerhub.  

Lệnh `build` vẫn được giữ nguyên nhưng sẽ không được thực hiện.  
`ecs-cli` plugin sẽ tự động tạo mới một cluster, vpc, loadbalancer mà không cần phải cấu hình gì cả. Trong một vài trường hợp có thể có lỗi xảy ra, xem trên `cloudformation` để tìm hiểu nguyên nhân.  

Dùng lệnh chuyển context sang aws và deploy :  

```bash
docker context use aws
docker compose up 
```

![console](http://hacmao-blog.s3-website-ap-southeast-1.amazonaws.com/img/2021-03-17-12-31-30.png)  

Trong một số trường hợp, vì một lí do nào đó mà deploy bị fail mà không rõ nguyên nhân. Ta có thể thử deploy lại với chính file `docker-compose` đó. Có thể đây là sự không ổn định của plugin do mới đang ở bản beta.  

Sau một hồi thử nghiệm thì mình thấy với lệnh `docker compose up -d` sẽ thành công 100%. Magic gì đây :v  

## Custom config  

Đến đây, bạn có thể sẽ đặt câu hỏi là vậy thì việc tạo cluster ở bước trước có ý nghĩa gì ?  

Trong một số trường hợp, ta đã có sẵn một cluster và muốn deploy ứng dụng của ta lên đó. Thì ta vẫn có thể cấu hình cho `docker compose` thực hiện được.  

```yml
x-aws-vpc: "vpc-00b896528d5656749"
x-aws-cluster: "nodejs-app"
x-aws-loadbalancer: "nodejs-NLB"
```  

Ta cũng có thể config thêm về `network`, `ports`, `volumes`, `deploy` ... Tham khảo tại trang hướng dẫn của [docker](https://docs.docker.com/cloud/ecs-integration/#install-the-docker-compose-cli-on-linux).  

Bạn có thể tham khảo file cấu hình của mình :  

```yml
version: '3'

x-aws-vpc: "vpc-00b896528d5656749"
x-aws-cluster: "nodejs-app"
x-aws-loadbalancer: "nodejs-NLB"

services:
  nodejs:
    image: hacmao/nodejs-app:v1.0
    build:
      context: .
      dockerfile: Dockerfile
    container_name: nodejs
    env_file: .env
    deploy:
      resources:
        limits:
          cpus: '0.5'
          memory: 2048M
    environment:
      - MONGO_USERNAME=$MONGO_USERNAME
      - MONGO_PASSWORD=$MONGO_PASSWORD
      - MONGO_HOSTNAME=db
      - MONGO_PORT=$MONGO_PORT
      - MONGO_DB=$MONGO_DB
    ports:
      - 8080:8080
    networks:
      - app-network
    command: ./wait-for.sh db:27017 -t 300 -- /home/node/app/node_modules/.bin/nodemon app.js

  db:
    image: mongo:4.1.8-xenial
    container_name: db
    env_file: .env
    environment:
      - MONGO_INITDB_ROOT_USERNAME=$MONGO_USERNAME
      - MONGO_INITDB_ROOT_PASSWORD=$MONGO_PASSWORD
    deploy:
      resources:
        limits:
          cpus: '0.5'
          memory: 2048M
    volumes:
      - dbdata:/data/db
    networks:
      - app-network

networks:
  app-network:

volumes:
  dbdata:
    driver_opts:
      backup_policy: ENABLED
      lifecycle_policy: AFTER_30_DAYS
      performance_mode: maxIO
      throughput_mode: provisioned
      provisioned_throughput: 1024
```

## Sản phẩm  

Để xem các container đang chạy :  

```bash
docker compose ps
```

Ta sẽ có url tới website.  

![web](http://hacmao-blog.s3-website-ap-southeast-1.amazonaws.com/img/2021-03-17-14-13-28.png)  

Vậy là ta đã deploy thành công container lên ECS cluster.  

Suýt nữa mình đã quên một việc quan trọng =)) Việc tạo volume ngoài có vẻ tốn khá nhiều tiền, do mình thử nghiệm tới lui, mount target các kiểu nên gây ra tổn thất một số tiền không hề nhỏ =(((  

![bill](http://hacmao-blog.s3-website-ap-southeast-1.amazonaws.com/img/2021-03-17-14-16-59.png)  

Nhìn bảng giá mà lòng đau như cắt hmu hmu =(( Có thể bỏ qua phần mount volume cũng được.  
