#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from '@aws-cdk/core';
import { Pipeline } from '../lib/cdk-stack';

const app = new cdk.App();
new Pipeline(app, 'BlogPipeLine');
