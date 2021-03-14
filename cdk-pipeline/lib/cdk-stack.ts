import * as cdk from '@aws-cdk/core';
import * as s3 from '@aws-cdk/aws-s3';
import * as codebuild from '@aws-cdk/aws-codebuild';
import * as codepipeline from '@aws-cdk/aws-codepipeline';
import * as codepipeline_actions from '@aws-cdk/aws-codepipeline-actions';

export class Pipeline extends cdk.Stack {
    constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps){
        super(scope, id);

        const hostBucket = new s3.Bucket(this, 'hacmaoBlog', {
            bucketName: 'hacmao-blog',
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            publicReadAccess: true,
            websiteIndexDocument: 'index.html'
        });
        
        new cdk.CfnOutput(this, 'hostUrl', { value: hostBucket.bucketWebsiteUrl });

    }
}