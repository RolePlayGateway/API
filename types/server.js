'use strict';

const express = require('express');
const bodyparser = require('body-parser');

class Server {
  constructor (settings = {}) {
    this.settings = Object.assign({
      port: 9998,
      secure: false,
      reconnect: false
    }, settings);

    this.app = this.express = express();

    this.app.use(bodyparser.json());
    this.app.use(bodyparser.urlencoded({ extended: true }));
    this.app.use(function (req, res, next) {
      console.log('[API:SERVER]', req.method, req.path, req.body || '(empty body)');
      next();
    });

    return this;
  }

  _addRoute (method, path, handler) {
    this.app[method.toLowerCase()](path, handler);
  }

  async start () {
    await this.app.listen(this.settings.port);
  }
}

module.exports = Server;