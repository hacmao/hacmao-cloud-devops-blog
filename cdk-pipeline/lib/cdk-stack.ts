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
        
        // =====================================================================
        // Github source
        // =====================================================================
        const gitHubSource = codebuild.Source.gitHub({
            owner: 'hacmao',
            repo: 'hacmao-cloud-devops-blog',
            fetchSubmodules: true,
        });

        // =====================================================================
        //  Output
        // =====================================================================
        const repoOutput = new codepipeline.Artifact('RepoOutput');
        const hexoBuildOutput = new codepipeline.Artifact('HexoBuildOutput');

        // =====================================================================
        // Build project
        // =====================================================================
        const hexoBuild = new codebuild.PipelineProject(this, 'hexoBuild', {
            buildSpec: codebuild.BuildSpec.fromSourceFilename('lib/buildspec.yml')
        });

        // =====================================================================
        // Pipeline 
        // =====================================================================
        const pipeline = new codepipeline.Pipeline(this, 'pipeline', {
            pipelineName: 'BlogPipeline'
        });

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
    }
}