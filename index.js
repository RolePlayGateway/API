'use strict';

const config = require('./settings/default');
const auth = require('./settings/auth');

const crypto = require('crypto');
const settings = {
  mysql: require('./settings/mysql')
};

const HTTPServer = require('@fabric/http');
const RPG = require('./lib/rpg');
// const Entity = require('@fabric/core/types/entity');
const Entity = require('./types/entity');

const authorizer = function (req, res, next) {
  const auth = req.params['auth'];
  next();
};

const wrapper = function (input) {
  if (input instanceof Array) {
    if (input.length > 100) input = input.slice(0, 100);
  }

  const entity = new Entity(input);
  return Object.assign({
    id: entity.id,
    list: input,
    element: Object.assign({
      '@type': 'RPGElement',
      '@data': input
    }),
    map: (input.length) ? input.map((x) => {
      const item = input[x];
      const element = Object.assign({}, item);
      return new Entity(element);
    }) : {}
  });
}

const format = function (output) {
  let result = wrapper(output);
  return result;
}

async function main () {
  let server = new HTTPServer({ port: 9998, secure: false });
  let rpg = new RPG(settings);

  server.express.use(function (req, res, next) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    next();
  });

  server._addRoute('GET', '/authors', async function (req, res, next) {
    let result = null;

    if (req.query.filter) {
      result = await rpg.listOnline();
    } else {
      result = await rpg.listAuthors(req.query);
    }

    res.send(result);
  });

  server._addRoute('POST', '/messages', async function (req, res, next) {
    let message = req.body;
    let result = await rpg._createChatMessage(message);
    return res.send({ status: 'success', result: result });
  });

  server._addRoute('POST', '/movements', async function (req, res, next) {
    let auth = req.params['auth'];

    let direction = req.body['direction'];
    let characterID = req.body['characterID'];
    let vehicleID = req.body['vehicleID'];
    let mobID = req.body['mobID'];
    let presentLocation = null;
    let context = null;
    let entity = null;
    let result = null;
    let id = null;

    if (characterID) {
      context = 'character';
      id = parseInt(characterID);
    } else if (vehicleID) {
      context = 'vehicle';
      id = parseInt(vehicleID);
    } else if (mobID) {
      context = 'mob';
      id = parseInt(mobID);
    } else if (req.body['actor']) {
      context = 'actor';
      id = parseInt(req.body['actor']['id']);
    } else {
      return res.send({ status: 'error', message: 'No context provided.' });
    }

    switch (context) {
      case 'actor':
        let actor = req.body['actor'];
        console.log('handling movement for ACTOR:', actor);
        result = {};
        break;
      case 'character':
        entity = await rpg.getCharacterByID(id);
        result = await rpg.moveCharacterInstance(id, direction);
        break;
      case 'vehicle':
        entity = await rpg.getVehicleByID(id);
        result = await rpg.moveVehicleInstance(id, direction);
        break;
      case 'mob':
        entity = await rpg.getMobInstanceByID(id);
        result = await rpg.moveMobInstance(id, direction);
        break;
    }

    res.send(result);
  });

  server._addRoute('GET', '/characters', async function (req, res, next) {
    const result = await rpg.getCharacters();
    if (!result) return next();
    res.send(result);
  });

  server._addRoute('GET', '/characters/:id', async function (req, res, next) {
    const result = await rpg.getCharacterByID(req.params['id']);
    if (!result) return next();
    res.send(result);
  });

  server._addRoute('GET', '/vehicles', async function (req, res, next) {
    const result = await rpg.getVehicles();
    if (!result) return next();
    res.send(result);
  });

  server._addRoute('GET', '/vehicles/:id', async function (req, res, next) {
    const result = await rpg.getVehicleByID(req.params['id']);
    if (!result) return next();
    res.send(result);
  });

  server._addRoute('GET', '/shuttles', async function (req, res, next) {
    const result = await rpg.getShuttleInstances();
    if (!result) return next();
    res.send(result);
  });

  server._addRoute('GET', '/shuttles/:id', async function (req, res, next) {
    const result = await rpg.getShuttleInstanceByID(req.params['id']);
    if (!result) return next();
    res.send(result);
  });

  server._addRoute('GET', '/mobs', async function (req, res, next) {
    const result = await rpg.getMobInstances();
    if (!result) return next();
    res.send(result);
  });

  server._addRoute('GET', '/mobs/:id', async function (req, res, next) {
    const result = await rpg.getMobInstanceByID(req.params['id']);
    if (!result) return next();
    res.send(result);
  });

  server._addRoute('GET', '/assets', async function (req, res, next) {
    const result = await rpg.getAssets();
    if (!result) return next();
    res.send(result);
  });

  server._addRoute('GET', '/items', async function (req, res, next) {
    const result = await rpg.getItemInstances();
    if (!result) return next();
    res.send(result);
  });

  server._addRoute('GET', '/items/:id', async function (req, res, next) {
    const result = await rpg.getItemInstanceByID(req.params['id']);
    if (!result) return next();
    res.send(result);
  });

  server._addRoute('GET', '/places', async function (req, res, next) {
    const result = await rpg.getPlaces();
    if (!result) return next();
    res.send(result);
  });

  server._addRoute('GET', '/places/:id', async function (req, res, next) {
    const result = await rpg.getPlaceByID(req.params['id']);
    if (!result) return next();
    res.send(result);
  });

  server._addRoute('PATCH', '/places/:id', async function (req, res, next) {
    const result = await rpg.getPlaceByID(req.params['id']);

    if (!result) return next();
    if (!req.body) return res.send({ status: 'error', message: 'You must provide an update body.' });
    if (!req.body.channel) return res.send({ status: 'error', message: 'Channel key is required.' });
    let patch = {
      channel: req.body['channel']
    };

    let answer = await rpg.updatePlace(req.params['id'], patch);

    res.send(result);
  });

  server._addRoute('GET', '/places/:id/exits', async function (req, res, next) {
    const result = await rpg.getPlaceExitsByID(req.params['id']);
    if (!result) return next();
    res.send(result);
  });

  server._addRoute('GET', '/universes', async function (req, res, next) {
    const result = await rpg.listUniverses(5);
    if (!result) return next();
    if (req.query.wrapped) {
      res.send(format(result));
    } else {
      res.send(result);
    }
  });

  server._addRoute('GET', '/universes/:id', async function (req, res, next) {
    const result = await rpg.getUniverseByID(req.params['id'], true);
    if (!result) return next();
    if (req.query.wrapped) {
      res.send(format(result));
    } else {
      res.send(result);
    }
  });

  server._addRoute('GET', '/universes/:id/map', async function (req, res, next) {
    const result = await rpg.getUniverseMap(req.params['id']);
    if (!result) return next();
    res.send(result);
  });


  server._addRoute('GET', '/metrics/snippets', async function (req, res, next) {
    const result = await rpg.getRoleplayVolumeByDate();
    res.send(result);
  });

  server._addRoute('POST', '/queries', async function (req, res, next) {
    const result = await rpg.listCharactersByName(req.body['query']);
    res.send(result);
  });

  server._addRoute('GET', '/volumes', async function (req, res, next) {
    const result = await rpg.getTransactionVolumeByDate();
    res.send(result);
  });

  await server.start();
}

main();
