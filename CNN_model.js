import * as tf from '@tensorflow/tfjs';
import {Scalar, serialization, Tensor, tidy, util} from '@tensorflow/tfjs-core';

import * as hparam from "./hyperParams"
var stats = require("stats-lite")


// Loss function
export function loss(labels, ys) {
  return tf.losses.softmaxCrossEntropy(labels, ys).mean();
}

// Variables that we want to optimize****************************************************
export let conv1OutputDepth = 8;
export let conv1Weights_;

export let conv2InputDepth = conv1OutputDepth;
export let conv2OutputDepth = 16;
export let conv2Weights_;

export let fullyConnectedWeights_;
export let fullyConnectedBias_ ;


export let moments;
export let moments2;
//**************************************************************************************

export function freshParams(){
  conv1Weights_ =
      tf.variable(tf.randomNormal([5, 5, 1, conv1OutputDepth], 0, 0.1));

  conv2Weights_ =
      tf.variable(tf.randomNormal([5, 5, conv2InputDepth, conv2OutputDepth], 0, 0.1));

  fullyConnectedWeights_ = tf.variable(tf.randomNormal(
      [7 * 7 * conv2OutputDepth, hparam.LABELS_SIZE], 0,
      1 / Math.sqrt(7 * 7 * conv2OutputDepth)));
  fullyConnectedBias_ = tf.variable(tf.zeros([hparam.LABELS_SIZE]));
}


export let conv1, conv2;
export let conv1g, conv1gl, beta_smoothness;
export let layer1_data;
export let layer2_data;
export let moments_data;
export let moments2_data;
export let grad, gradl;

// noise=false is just a hack to make the function more general, noise parameter is not used in this model
export function model(inputXs, noise=false, doGrad=false) {
  var xs = inputXs.as4D(-1, hparam.IMAGE_SIZE, hparam.IMAGE_SIZE, 1);

  var strides = 2;
  var pad = 0;

  // Conv 1
  conv1 = tf.tidy(() => {
    return xs.conv2d(conv1Weights_, 1, 'same')
        .relu()
        .maxPool([2, 2], strides, pad);
  });
  moments = tf.tidy(() => {
    return tf.moments(conv1, [0, 1, 2]);
  });
  moments_data = {
    mean: stats.mean(moments.mean.dataSync()),
    variance: stats.mean(moments.variance.dataSync())
  };
  layer1_data = conv1.flatten().dataSync();

  // Gradient ******************************\
  if (doGrad){
    let a = 0.1; let betasl = [];
    while (a < hparam.A){
      conv1g = x => tf.tidy(() => {
        return conv1.conv2d(conv2Weights_, 1, 'same')
            .relu()
            .maxPool([2, 2], strides, pad)
            .as2D(-1, fullyConnectedWeights_.shape[0])
            .matMul(fullyConnectedWeights_)
            .add(fullyConnectedBias_);
      });
      grad = tf.grad(conv1g);
      let conv1l = conv1.sub(grad(conv1).mul(tf.scalar(a)));
      // Along the gradient
      conv1gl = x => tf.tidy(() => {
        return conv1l.conv2d(conv2Weights_, 1, 'same')
            .relu()
            .maxPool([2, 2], strides, pad)
            .as2D(-1, fullyConnectedWeights_.shape[0])
            .matMul(fullyConnectedWeights_)
            .add(fullyConnectedBias_);
      });
      gradl = tf.grad(conv1gl);
      betasl.push(
        tf.norm(grad(conv1).sub(gradl(conv1l)))
          .div(tf.norm(grad(conv1).mul(tf.scalar(a)))).dataSync()
      );
      a += 0.05;
    }
    beta_smoothness = Math.max(...betasl);
  }
  //****************************************

  // Conv 2
  conv2 = tf.tidy(() => {
    return conv1.conv2d(conv2Weights_, 1, 'same')
        .relu()
        .maxPool([2, 2], strides, pad);
  });
  moments2 = tf.tidy(() => {
    return tf.moments(conv2, [0, 1, 2]);
  });
  moments2_data = {
    mean: stats.mean(moments2.mean.dataSync()),
    variance: stats.mean(moments2.variance.dataSync())
  };
  //layer2_data = layer2_data.concat(conv2.dataSync());

  // Final layer
  return conv2.as2D(-1, fullyConnectedWeights_.shape[0])
      .matMul(fullyConnectedWeights_)
      .add(fullyConnectedBias_);
}




// Predict the digit number from a batch of input images.
export function predict(x) {
  return tf.tidy(() => {
    const axis = 1;
    return model(x);
  });
  //return Array.from(pred.dataSync());
}

// Given a logits or label vector, return the class indices.
export function classesFromLabel(y) {
  const axis = 1;
  const pred = y.argMax(axis);

  return Array.from(pred.dataSync());
}
