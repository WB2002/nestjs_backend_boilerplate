'use strict';

const path = require('path');
const { createRequire } = require('module');

const requireFromRepo = createRequire(path.join(__dirname, '..', 'package.json'));
const pgDir = path.dirname(requireFromRepo.resolve('pg/package.json'));
const pg = require(path.join(pgDir, 'lib', 'index.js'));

class Client {
  constructor(...args) {
    return new pg.Client(...args);
  }
}

class Pool {
  constructor(...args) {
    return new pg.Pool(...args);
  }
}

module.exports = {
  Client,
  Pool,
  default: { Client, Pool },
};
