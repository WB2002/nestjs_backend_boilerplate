'use strict';

class Client {
  constructor() {
    this.connect = async () => undefined;
    this.query = async () => ({ rows: [] });
    this.end = async () => undefined;
  }
}

class Pool {
  constructor() {
    this.connect = async () => new Client();
    this.query = async () => ({ rows: [] });
    this.end = async () => undefined;
  }
}

module.exports = { Client, Pool, default: { Client, Pool } };
