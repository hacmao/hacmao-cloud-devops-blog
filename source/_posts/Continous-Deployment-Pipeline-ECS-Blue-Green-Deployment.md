---
title: 'Continous Deployment Pipeline: ECS Blue/Green Deployment'
date: 2021-03-21 20:56:25
tags:
    - ecs
    - ci/cd
---

# Continous Deployment Pipeline: ECS Blue/Green Deployment

Ta sẽ tiến hành triển khai một docker đơn giản lên ECS bằng Blue/Green deployment thông qua một CI/CD pipeline.  

```js app.js
const express = require('express')
const app = express()
const port = 3000

app.get('/', (req, res) => res.send('Hello World!'))
app.get('/health', (req, res) => res.send('Health check status: ok'))

app.listen(3000, () => console.log(`Example app listening at http://localhost:${port}`))
```

Ứng dụng nodejs rất đơn giản là một ứng dụng Hello world, không có chứa database.  

```bash Dockerfile
FROM node:10

COPY . .
RUN npm install

EXPOSE 3000
CMD [ "node", "app.js" ]
```

Ta sẽ tạo container rồi push lên `ecr`.

## Tạo các thành phần cơ bản của ECS  

Ta sẽ tạo bằng CDK.  

### Tạo load balancer  

```ts
const albSecurityGroup = new ec2.SecurityGroup(this, 'albSecurityGroup', {
    securityGroupName: 'alb-sg',
    vpc,
    description: 'security group for ecs load balancer'
});

const elb = new elbv2.ApplicationLoadBalancer(this, 'alb', {
    loadBalancerName: 'alb-nodejs',
    vpc: vpc,
    internetFacing: true,
    securityGroup: albSecurityGroup
});
new cdk.CfnOutput(this, 'website url', { value: elb.loadBalancerDnsName });
```

Load balancer sẽ thực hiện điều phối request tới các target group tương ứng trong quá trình Blue/Green deployment.  

### Target group

Tiếp đến, ta sẽ tạo 2 target group tương ứng với 2 nhiệm vụ : `dev` và `prod`. Target group là một tập hợp các container.  

Khi thực hiện quá trình deployment, load balancer sẽ tiến hành giữ nguyên request tới target group `prod` hiện tại. Trong khi đó, ECS deployment sẽ tạo một nhóm các container hoàn toàn mới trong tartget group `dev` để chạy ứng dụng mới được triển khai. Sau khi triển khai thành công, Load balancer sẽ chuyển dịch dần dần các request sang target group `dev`. Target group `dev` trở thành `prod`.  

Ta sẽ sử dụng 2 port :  

+ 8080: `prod`
+ 8090: `dev`  

```ts
const targetGroup1 = new elbv2.ApplicationTargetGroup(this, 'tg-1', {
      targetGroupName: 'ecs-tg-1', 
      vpc,
      healthCheck: { path: '/health' },
      protocol: elbv2.ApplicationProtocol.HTTP,
});
elb.addListener('ecs-tg-1', {
    protocol: elbv2.ApplicationProtocol.HTTP,
    port: 8080,
    defaultTargetGroups: [ targetGroup1 ]
})

const targetGroup2 = new elbv2.ApplicationTargetGroup(this, 'tg-2', {
    targetGroupName: 'ecs-tg-2', 
    vpc,
    healthCheck: { path: '/health' },
    protocol: elbv2.ApplicationProtocol.HTTP
});
elb.addListener('ecs-tg-2', {
    protocol: elbv2.ApplicationProtocol.HTTP,
    port: 8090,
    defaultTargetGroups: [ targetGroup2 ]
});
```

Các target group được kết nối vào các listener của load balancer tương ứng với từng port.  

![tg](http://hacmao-blog.s3-website-ap-southeast-1.amazonaws.com/img/2021-03-21-22-23-49.png)  

### ECS Cluster  

```ts
const cluster = new ecs.Cluster(this, 'ecs-blue-green-cluster', {
    clusterName: 'ecs-blue-green-cluster',
    vpc: vpc,
});
```

### Tạo task definition  

Task definition sinh ra để định nghĩa các chạy một container như cpu, ram, số lượng task, port mapping, ...  

Trước khi tạo task, ta cần chú ý tới `taskRole` và `taskExecutionRole`.  

+ `taskRole`: `role` cho các container.  
+ `taskExecutionRole`: `role` cho ecs actions để pull image và logs. Có thể được tự động tạo bởi ECS.  

Tại đây, ta có thể tạo tay, rồi load vào cdk.  

```ts
const taskExecutionRole = iam.Role.fromRoleArn(this, 'taskExecutionRole', `arn:aws:iam::${this.account}:role/ecsTaskExecutionRole`);
const taskRole = iam.Role.fromRoleArn(this, 'taskRole', `arn:aws:iam::${this.account}:role/ecsTaskRoleS3FullAccess`);
```

Tiếp đến, ta có thể tạo một task definition :  

```ts
const fargateTaskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDef', {
    executionRole: taskExecutionRole,
    taskRole: taskRole,
    memoryLimitMiB: 1024,
    cpu: 512
});
```

Ta định nghĩa các role cần thiết cũng như là `cpu`, `memory`.  

Load container :  

```ts
const repo = ecr.Repository.fromRepositoryName(this, 'repo', 'ecs-blue-green-nodejs');
```

Tạo hoặc Cloudwatch log group :  

```ts
const appLogGroup = logs.LogGroup.fromLogGroupArn(this, 'LogGroup', 'arn:aws:logs:ap-southeast-1:341546619470:log-group:ecs-nodejs:*');
```

Gán container vào task definition :  

```ts
const container = fargateTaskDefinition.addContainer('NodejsApp', {
    image: ecs.ContainerImage.fromEcrRepository(repo, 'latest'),
    portMappings: [ { containerPort: 3000, protocol: ecs.Protocol.TCP }],
    logging: ecs.LogDriver.awsLogs({
    streamPrefix: '/ecs/nodejs-app/',
    logGroup: appLogGroup
    })
});
```

Mở port maping tới host qua port 3000.  

![img](http://hacmao-blog.s3-website-ap-southeast-1.amazonaws.com/img/2021-03-21-22-27-21.png)

### Service  

```ts
const ecsSecurityGroup = new ec2.SecurityGroup(this, 'ecs-sg', {
    securityGroupName: 'ecs-sg',
    vpc: vpc
})

const service = new ecs.FargateService(this, 'Service', {
    cluster,
    taskDefinition: fargateTaskDefinition,
    assignPublicIp: false,
    desiredCount: 2,
    serviceName: 'nodejs-service',
    deploymentController: { type:ecs.DeploymentControllerType.CODE_DEPLOY },
    securityGroup: ecsSecurityGroup,
    healthCheckGracePeriod: Duration.minutes(2),
    vpcSubnets: vpc.selectSubnets({
        subnetType: ec2.SubnetType.PUBLIC
    }),
});
```

Định nghĩa một fargate service để chạy task được định nghĩa tại bước trước với :  

+ `desiredCount`: 2  
+ `deploymentController`: định nghĩa dạng deployment là blue/green hoặc in-place.  
+ `securityGroup`

Sau đó, một bước quan trọng để kết nối service với load balancer :  

```ts
targetGroup1.addTarget(service.loadBalancerTarget({
    containerName: container.containerName,
    containerPort: container.containerPort
}));
```

Ta sẽ add các container được tạo từ service vào targetGroup `prod`. Target groupt `prod` đã được gán vào listener port 8080 của load balancer. Như vậy, khi request tới port 8080 của load balancer sẽ được forward tới target groupt `prod` chưá các container của service.  

![img](http://hacmao-blog.s3-website-ap-southeast-1.amazonaws.com/img/2021-03-21-22-25-14.png)  

![img](http://hacmao-blog.s3-website-ap-southeast-1.amazonaws.com/img/2021-03-21-22-26-01.png)

## Tạo CI/CD Blue/Green deployment  

Mình đã cố gắng tạo ci/cd bằng cdk nhưng có vẻ không được :v Cdk hạn chế trong việc tạo ecs deployment group khi deploy bằng `codeploy`.  

Ta sẽ thực hiện xây dựng theo [hướng dẫn](https://blog.besharp.it/en/how-to-setup-a-continuous-deployment-pipeline-on-aws-for-ecs-blue-green-deployments/).  

![img](http://hacmao-blog.s3-website-ap-southeast-1.amazonaws.com/img/2021-03-21-22-29-47.png)  

Pipeline bao gồm 3 bước :  

+ `Source` : Codecommit
+ `Build` : Codebuild
+ `Deploy`: Codedeploy

Thư mục sẽ có dạng :  

```bash
- app.js
- ecs-cdk
- appspec.yaml
- buildspec.yml
- Dockerfile
- package.json
```

### Build  

Công việc sẽ là build docker và push lên ecr.  

```yml buildspec.yml
version: 0.2

env:
  variables:
    AWS_ACCOUNT_ID: '341546619470'
phases:
 pre_build:
   commands:
     - REPOSITORY_URI=${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_DEFAULT_REGION}.amazonaws.com/ecs-blue-green-nodejs
     - aws ecr get-login-password --region ${AWS_DEFAULT_REGION} | docker login --username AWS --password-stdin ${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_DEFAULT_REGION}.amazonaws.com
 install:
   runtime-versions:
     java: corretto11
 build:
   commands:
   - docker build -t ecs-blue-green-nodejs .
   - docker tag ecs-blue-green-nodejs:latest ${REPOSITORY_URI}:latest
   - docker push ${REPOSITORY_URI}:latest
   
artifacts:
  files: 
    - appspec.yaml
```

Đơn giản là các câu lệnh để build và push lên `ecr`.  

### Deploy  

Trước hết, trong application ecs deployment của codedeploy, tạo một `deployment group`.  

+ Chọn service role, cluster để deploy và service sẽ deploy :  

![img](http://hacmao-blog.s3-website-ap-southeast-1.amazonaws.com/img/2021-03-21-22-36-40.png)  

+ Load balancer : định nghĩa `prod` và `test` target group

![img](http://hacmao-blog.s3-website-ap-southeast-1.amazonaws.com/img/2021-03-21-22-39-18.png)

+ Configure :  
  + Thời gian bắt đầu chuyển traffic tới target group mới  
  + Các chuyển traffic : chuyển toàn bộ hay chuyển từng phần một
  + Thời gian original container bị hủy

![img](http://hacmao-blog.s3-website-ap-southeast-1.amazonaws.com/img/2021-03-21-22-42-19.png)  

Sau đó, trong pipeline, ta thêm `codedeploy` :  

![img](http://hacmao-blog.s3-website-ap-southeast-1.amazonaws.com/img/2021-03-21-22-49-23.png)  

```ts appspec.yml
version: 0.0

Resources:
  - TargetService:
      Type: AWS::ECS::Service
      Properties:
        TaskDefinition: "arn:aws:ecs:ap-southeast-1:341546619470:task-definition/EcsCdkStackTaskDef9E992340:14"
        LoadBalancerInfo:
          ContainerName: "NodejsApp"
          ContainerPort: 3000
```

Ta có thể quan sát sự dịch chuyển traffic trong deploy detail của codedeploy:  

![img](http://hacmao-blog.s3-website-ap-southeast-1.amazonaws.com/img/2021-03-21-22-52-20.png)  
