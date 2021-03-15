---
title: How I create this page
date: 2021-03-13 22:34:20
tags:
 - first-page
---

# How I create this page ?

Hôm nay, mình nổi hứng muốn tạo một blog cho AWS cũng như DevOps, cũng như thực hành các kiến thức đã học thì mình nghĩ tới việc tạo một blog sẽ sử dụng CI/CD để tự động build khi có thay đổi.  

## Tạo giao diện

Việc đầu tiên cần làm là tạo giao diện cho page. Muốn tạo một giao diện blog đẹp sẽ khá tốn thời gian, công sức. Mình cũng không chuyên về front-end nên tìm tạm một template nào đó để tạo sẵn cho mình thôi.  
Lượn lờ một vòng thấy có [blog](https://hackernoon.com/build-a-serverless-production-ready-blog-b1583c0a5ac2) hướng dẫn cách host serverless blog trên S3.  

Từ đó, mình thấy khá thú vị và dễ dàng thực hiện nên quyết định dùng [hexo](https://hexo.io/) framework để tạo giao diện cũng như các chức năng thông thường của một blog.  

Install bằng câu lệnh :  

```bash
npm install -g hexo-cli
```

Khởi tạo blog:  

```bash
hexo init hacmaoblog
```

Sau đó mò dần rồi custom từng thành phần. Mình lựa chọn theme [pure](https://github.com/cofess/hexo-theme-pure).  

Trong thư mục của project vừa tạo, ta thực hiện clone theme :  

```bash
git clone https://github.com/cofess/hexo-theme-pure.git themes/pure
```

Sau đó, trong file `_config.yml`, sửa `theme: landscape` thành `pure`.  

Ban đầu theme tải về sẽ toàn tiếng tàu khựa :v Còn có link donate các kiểu, tốn khá thời gian để config lại thành của mình. Sửa trong file `_config.yml` của thư mục `themes/pure` với các file `.ejs` dùng để tạo các file. Nói chung mò một lúc sẽ ra.  

Chạy hexo server :  

```bash
hexo server
```

Cuối cùng được thành phẩm như hiện tại :v Cũng khá là vừa ý.  

Một số lệnh cơ bản của `hexo`:  

```bash
# Tạo post
hexo new post 'hello world'

# Tạo page
hexo new page 'aboutme'
```

## Build CI/CD  

Mình sẽ làm CI/CD đơn giản thôi. Tạo một `Codepipeline` lấy code từ github hoặc codecommit, sau đó tiến hành dùng `Codebuild` tạo 1 cloudformation để deploy app lên S3 Bucket.  

Mình đã nghĩ tới việc tạo container cho chuyên nghiệp, cơ mà thế thì blog lại tốn kha khá chi phí duy trì cho ECS, NAT, ELB, ... Nên thôi sự lựa chọn S3 vừa dễ setup lại hợp với túi tiền.  

Mình sẽ tạo pipeline bằng cdk cho tiện quản lí với dễ deploy.  

Đầu tiên, tạo một S3 bucket để host website:  

```ts
const hostBucket = new s3.Bucket(this, 'hacmaoBlog', {
    bucketName: 'hacmao-blog',
    removalPolicy: cdk.RemovalPolicy.DESTROY,
    publicReadAccess: true,
    websiteIndexDocument: 'index.html'
});

new cdk.CfnOutput(this, 'hostUrl', { value: hostBucket.bucketWebsiteUrl });
```

Tiếp đến, tạo build project :  

```ts
const hexoBuild = new codebuild.PipelineProject(this, 'hexoBuild', {
    buildSpec: codebuild.BuildSpec.fromSourceFilename('cdk-pipeline/lib/buildspec.yml'),
    environment: {
        buildImage: codebuild.LinuxBuildImage.AMAZON_LINUX_2_3
    },
});
```

Build project sẽ chạy lệnh từ `buildspec.yml`.  

+ `buildspec.yml` :  

```yml
version: 0.2
run-as: root

phases:
  install:
    commands:
      - npm install
  build:
    commands:
      - cp -r source/_posts/img/ themes/pure/source/
      - npm run build
artifacts:
  base-directory: public
  files:
    - '**/*'
```

Đơn giản là install các npm package sử dụng cho hexo project. Đồng thời, do bài viết được viết bởi markdown có chứa các ảnh nên ta cần copy ảnh từ thư mục `source/_post/img` tới thư mục của `themes` để khi compile sẽ có ảnh.  

`enviroment` là một tham số vô cùng quan trọng :v nếu không có nó thì thời gian build có thể lên tới vài phút vì nó phải tiến hành chuyển từ image phiên bản thấp lên phiên bản cao. Chỉ định thì thời gian rút xuống còn có vài chục giây. Haiz trước kia không biết nên phải đợi chờ trong mòn mỏi ~  

### Pipeline  

Sau khi làm xong mấy phần râu ria trên, ta có thể xây dựng pipeline:  

+ Lấy source code từ repo : Codecommit, github, ...
+ Build hexo app
+ Deploy lên S3

+ Khai báo pipeline:  

```ts
const pipeline = new codepipeline.Pipeline(this, 'pipeline', {
    pipelineName: 'BlogPipeline'
});
```

+ Stage 1:  

```ts
pipeline.addStage({
    stageName: 'GitHub',
    actions: [
        new codepipeline_actions.GitHubSourceAction({
            actionName: 'GitHubSource',
            repo: 'hacmao-cloud-devops-blog',
            owner: 'hacmao',
            branch: 'master',
            oauthToken: cdk.SecretValue.secretsManager('my-github-token', { 
                jsonField : 'my-github-token'
            }),
            output: repoOutput
        })
    ]
});
```

+ Stage 2 :  

```ts
pipeline.addStage({
    stageName: 'CodeBuild',
    actions: [
        new codepipeline_actions.CodeBuildAction({
            actionName: 'BuildHexo',
            project: hexoBuild,
            input: repoOutput,
            outputs: [ hexoBuildOutput ]
        })
    ]
});
```

+ Stage 3 :  

```ts
pipeline.addStage({
    stageName: 'Deploy',
    actions: [
        new codepipeline_actions.S3DeployAction({
            actionName: 'S3Deploy',
            bucket: hostBucket,
            input: hexoBuildOutput
        })   
    ]
})
```

Cuối cùng chúng ta có pipeline:  

![cicd](http://hacmao-blog.s3-website-ap-southeast-1.amazonaws.com/img/2021-03-14-12-29-29.png)  

Yeah không quá phức tạp mà ta có thể thực hành build một pipeline để tạo 1 blog đơn giản. Giờ có chỗ viết blog mới rồi :vv kaka  
