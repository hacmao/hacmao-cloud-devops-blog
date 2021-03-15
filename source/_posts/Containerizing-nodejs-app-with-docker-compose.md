---
title: Containerizing nodejs app with docker compose
date: 2021-03-15 11:21:43
tags:
  - docker
  - nodejs
---

# Containerizing a Node.js Application for Development With Docker Compose

Hôm nay mình tìm thấy một [tutorial](https://www.digitalocean.com/community/tutorial_series/from-containers-to-kubernetes-with-node-js) khá là hay hướng dẫn khá chi tiết, đầy đủ từ việc xây dựng một ứng dụng Nodejs, cho tới containerizing và cuối cùng là kubernetes.  

Bỏ qua phần đầu về việc tạo ứng dụng ra sao, database thế nào, mình sẽ tập trung vào phần docker với kubernetes để nâng trình DevOps lên.  

## Tổng quan về ứng dụng  

Đây là một ứng dụng đơn giản về nodejs có sử dụng database. Có thể clone code tại [repository](https://github.com/do-community/nodejs-mongo-mongoose).  

Ứng dụng gồm có các path chính :  

+ `/`: hiển thị `Home`  

![home](http://hacmao-blog.s3-website-ap-southeast-1.amazonaws.com/img/2021-03-15-11-28-25.png)  

+ `/sharks`: hiển thị giao diện để thêm shark

![shark](http://hacmao-blog.s3-website-ap-southeast-1.amazonaws.com/img/sharks.png)  

+ `/sharks/addsharks`: endpoint khi submit form sẽ thực hiện post request để thêm dữ liệu vào database
+ `/sharks/getshark`: hiển thị tất cả các sharks có trong database  

![info](http://hacmao-blog.s3-website-ap-southeast-1.amazonaws.com/img/2021-03-15-11-30-17.png)  

Các package của project có thể đã cũ, chúng ta có thể update lên phiên bản mới nhất bằng lệnh :  

```bash
npm install -g npm-check-updates
ncu -u
npm update
```

Đồng thời, trong môi trường dev ta sẽ install `nodemon` để khi có bất kì thay đổi nào về code thì không cần phải restart lại server. Ta sẽ chỉ dùng nó trong môi trường dev :  

```bash
npm install --save-dev nodemon
```

## Thêm biến môi trường  

Hiện tại chương trình của chúng ta đang hardcode khá nhiều tham số. Tuy nhiên điều này không tiện lợi khi dùng docker chúng ta muốn config nó. Trong docker ta có thể dùng file `.env` để lưu các biến môi trường rồi sau đó sẽ load vào trong ứng dụng thông qua `process.env` hoặc thêm trong file `docker-compose.yml`.  

```js app.js
...
const port = process.env.PORT || 8080;
...
app.listen(port, function () {
  console.log(`Example app listening on ${port}!`);
});
```

```js db.js
const mongoose = require('mongoose');

const {
  MONGO_USERNAME,
  MONGO_PASSWORD,
  MONGO_HOSTNAME,
  MONGO_PORT,
  MONGO_DB
} = process.env;

const options = {
  useNewUrlParser: true,
  reconnectTries: Number.MAX_VALUE,
  reconnectInterval: 500,
  connectTimeoutMS: 10000,
};

const url = `mongodb://${MONGO_USERNAME}:${MONGO_PASSWORD}@${MONGO_HOSTNAME}:${MONGO_PORT}/${MONGO_DB}?authSource=admin`;

mongoose.connect(url, options).then( function() {
  console.log('MongoDB is connected');
})
  .catch( function(err) {
  console.log(err);
});
```

Ngoài việc thêm các biến môi trường, thì trong file `db.js` ta còn thêm một số options khi kết nối với mongoDB :  

+ `reconnectTries`: số lần kết nối lại, đây đại biểu cho vô hạn lần
+ `reconnectInterval`: 500 ms - thời gian cách giữa các lần kết nối
+ `connectTimeoutMS`: 10s - thời gian timeout

Khai báo các biến môi trường trong file `.env`:  

```bash .env
MONGO_USERNAME=sammy
MONGO_PASSWORD=your_password
MONGO_PORT=27017
MONGO_DB=sharkinfo
```

File `.env` lưu giữ các tham số bí mật nên cần thêm vào file `.dockerignore` và `.gitignore` để file không bị copy vào container hoặc public lên github.  

## Triển khai các services với Docker Compose  

`Services` trong `Compose` bao gồm container và cách nó được khởi chạy.  
Trong một file `docker-compose.yml` có thể định nghĩa nhiều Service như vậy.  

Trước khi định nghĩa service, chúng ta cần quan tâm tới thứ tự các container sẽ được khởi tạo. Ta sẽ có hai container là `nodejs` và `db`.  

+ `nodejs`: chứa server  
+ `db`: MongoDB

Để container `nodejs` có thể hoạt động được thì database phải khởi tạo thành công. Do đó, ta sẽ chỉ chạy lệnh khởi tạo server sau khi biết chắc rằng database khả dụng. Để làm được điều này, ta có thể dùng `depends-on`.  

+ `depends-on`: khai báo thứ tự khởi tạo hoặc kết thúc của các container.  

Ta sẽ khai báo `db` sẽ khởi tạo trước so với `nodejs`. Tuy nhiên, điều này cũng không đảm bảo hoàn toàn rằng database sẽ khả dụng luôn khi server chạy.  

Cách tối ưu hơn là sử dụng script `wait-for`.  

```bash wait-for.sh
#!/bin/sh

# original script: https://github.com/eficode/wait-for/blob/master/wait-for

TIMEOUT=15
QUIET=0

echoerr() {
  if [ "$QUIET" -ne 1 ]; then printf "%s\n" "$*" 1>&2; fi
}

usage() {
  exitcode="$1"
  cat << USAGE >&2
Usage:
  $cmdname host:port [-t timeout] [-- command args]
  -q | --quiet                        Do not output any status messages
  -t TIMEOUT | --timeout=timeout      Timeout in seconds, zero for no timeout
  -- COMMAND ARGS                     Execute command with args after the test finishes
USAGE
  exit "$exitcode"
}

wait_for() {
  for i in `seq $TIMEOUT` ; do
    nc -z "$HOST" "$PORT" > /dev/null 2>&1

    result=$?
    if [ $result -eq 0 ] ; then
      if [ $# -gt 0 ] ; then
        exec "$@"
      fi
      exit 0
    fi
    sleep 1
  done
  echo "Operation timed out" >&2
  exit 1
}

while [ $# -gt 0 ]
do
  case "$1" in
    *:* )
    HOST=$(printf "%s\n" "$1"| cut -d : -f 1)
    PORT=$(printf "%s\n" "$1"| cut -d : -f 2)
    shift 1
    ;;
    -q | --quiet)
    QUIET=1
    shift 1
    ;;
    -t)
    TIMEOUT="$2"
    if [ "$TIMEOUT" = "" ]; then break; fi
    shift 2
    ;;
    --timeout=*)
    TIMEOUT="${1#*=}"
    shift 1
    ;;
    --)
    shift
    break
    ;;
    --help)
    usage 0
    ;;
    *)
    echoerr "Unknown argument: $1"
    usage 1
    ;;
  esac
done

if [ "$HOST" = "" -o "$PORT" = "" ]; then
  echoerr "Error: you need to provide a host and port to test."
  usage 2
fi

wait_for "$@"
```

Script này hoạt động dựa trên `netcat` connect tới cổng của database. Khi nào lệnh này thành công thì nghĩa là database đã khả dụng. Lúc đó, ta mới bắt đầu chạy node server. Không cần đi quá sâu vào cách hoạt động của script trên, do script này có thể dùng lại trong nhiều trường hợp khác nhau, khi ta muốn kiểm tra một kết nối có sẵn sàng không.  

### Nodejs  

Khai báo dịch vụ `nodejs`:  

```yml docker-compose.yml
version: '3'

services:
  nodejs:
    build:
      context: .
      dockerfile: Dockerfile
    image: nodejs
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
```

+ `build`: định nghĩa các cấu hình khi thực hiện lệnh `docker-compose build`. Tại đây ta định nghĩa `context` và `dockerfile`. Khi build sẽ tạo ra các docker image trên local. Nếu không có, thì sẽ bỏ qua khi build. Image sẽ được pull về.  
+ `image`, `container_name`: tên của image, container
+ `restart`: cơ chế restart, mặc định là không, hiện tại là sẽ restart khi container stop
+ `env_file`: enviroment variable trong file `.env`
+ `ports`: map port 80 từ máy ngoài tới port 8080 của container
+ `volumes`: mount volume từ container tới host. Có thể dùng lệnh `docker volume ls` để xem các volume
  + `.:/home/node/app`: mount thư mục hiện tại tới `/home/node/app`. Tại đây, nếu thư mục `node_modules` mà rỗng sẽ ghi đè lên thư mục `node_modules` trong container nên ứng dụng sẽ không chạy được.
  + `node_modules:/home/node/app/node_modules`: tạo một volume mới là `node_modules` để ghi đè lại lỗi tại mount volumes trước đó.
+ `networks`: container sẽ tham gia vào mạng `app-network`. Sẽ được định nghĩa sau
+ `command`: command sẽ được thực thi trong container. Command này sẽ ghi đè lên command `CMD` định nghĩa trong Dockerfile. Tại đây, ta thực hiện script `wait-for.sh` để đợi database khả dụng rồi mới thực hiện chạy `app.js`.  

### Db  

Tiếp đến, tạo `db` service :  

```yml docker-compose.yml
...
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
```

+ `image`: Không có build. Pull image từ docker hub.
+ `MONGO_INITDB_ROOT_USERNAME`, `MONGO_INITDB_ROOT_PASSWORD`: tạo một root user mới trong admin authentication database, trao cho chúng ta quyền để thực hiện được mọi việc với database.  
+ `volumes`: `dbdata:/data/db` nhằm duy trì dữ liệu ngay cả khi container bị tắt, khởi động lại, ...
+ `networks`: `app-network` chung network với `nodejs`.  

Cuối cùng định nghĩa `networks` và `volumes`:  

```yaml docker-compose.yml
...
networks:
  app-network:
    driver: bridge

volumes:
  dbdata:
  node_modules:
```

Bridge network cho phép các container có thể giao tiếp với nhau vì chung một Docker daemon host, có thể dùng tên container. Mặc định, các container chung một host sẽ mở tất cả các cổng với nhau, tuy nhiên giữa container với mạng ngoài sẽ chỉ mở cổng 80.  

### Testing  

Chạy các docker service bằng lệnh :  

```bash
docker-compose up -d
```

Kiểm tra các container đang chạy :  

```bash
docker ps
```

![docker-ps](http://hacmao-blog.s3-website-ap-southeast-1.amazonaws.com/img/2021-03-15-16-09-43.png)  

Truy cập vào mạng localhost port 80 để test giao diện app.  

Để kết thúc container :  

```bash
docker-compose down
```

Tuy nhiên, sau đó, các volume sẽ vẫn còn tồn tại. Chỉ có các container là dừng và bị xóa đi. Khởi chạy lại lần nữa thì dữ liệu lưu trong mongoDB vẫn được dữ nguyên do được duy trì trong một volume riêng biệt.   

Để xóa cả volume dùng lệnh :  

```bash
docker-compose down --volume
```

## Kết luận  

Như vậy ta đã hoàn thiện một hệ thống docker-compose triển khai ứng dụng nodejs có sử dụng database, cấu hình mạng, volumes, ...
