'use strict';

const crypto = require('crypto');

class Entity {
  constructor (settings = {}) {
    this._state = settings;
  }

  get id () {
    return crypto.createHash('sha256').update(JSON.stringify(this._state)).digest('hex');
  }
}

module.exports = Entity;
