'use strict';

const config = require('../settings/default');

const mysql = require('mysql2/promise');
const mysql_real_escape_string = require('../methods/mysql_real_escape_string');

const graphviz = require('graphviz');
const Fabric = require('@fabric/core');

const Entity = require('../types/entity');

const {
  ENABLE_CHAT_MESSAGES,
  ENABLE_PUBLIC_LOGS,
  CHATBOT_ID,
  CHATBOT_NAME,
  PER_PAGE_LIMIT
} = require('../constants');

class RPG {
  constructor (settings = {}) {
    this.settings = Object.assign({}, settings);
    this.key = new Fabric.Key();
    this.pool = mysql.createPool({
      user: settings.mysql.user,
      password: settings.mysql.password,
      socketPath: settings.mysql.socket,
      database: settings.mysql.database
    });
  }

  async _createChatMessage (msg) {
    console.log('[RPG]', '_createChatMessage:', msg);
    let message = new Fabric.Message(msg);
    let parts = msg.text.split(' ');
    let place = null;
    let universe = null;
    let channel = 0;
    let username = msg.username.split('@')[1];
    let author = await this.getAuthorByName(username);

    switch (parts[0]) {
      case '/privmsg':
      case '/privmsgto':
      case '/help':
        return;
    }

    if (msg.matrix && msg.matrix.room) {
      const result = await this.pool.query(`SELECT id, roleplay_id as universe, name, url FROM rpg_places WHERE matrixChannelID = "${mysql_real_escape_string(msg.matrix.room)}"`);
      console.log('result:', result);
      place = (result && result[0]) ? result[0][0] : null;
      if (!place) {
        const candidate = await this.pool.query(`SELECT id FROM rpg_roleplays WHERE matrixChannelID = "${mysql_real_escape_string(msg.matrix.room)}"`);
        universe = (candidate && candidate[0]) ? candidate[0][0] : null;
        channel = 0;
      } else {
        channel = place['id'];
        universe = await this.getUniverseByID(place['universe']);
      }
    }

    if (!author) {
      author = {};
    }

    if (!universe) {
      universe = {};
    }

    console.log('purporting channel:', channel);

    let result = await this.pool.query(`INSERT INTO ajax_chat_messages (roleplayID, userID, userName, userRole, channel, dateTime, text)
      VALUES (
        ${parseInt(universe['id']) || 'null'},
        ${author.id || CHATBOT_ID},
        "${mysql_real_escape_string(msg.username)}",
        4,
        ${channel},
      NOW(),
        "${mysql_real_escape_string(msg.text)}"
      )`);

    if (place) {
      let content = await this.pool.query(`INSERT INTO rpg_content (place_id, old_chat_id, author_id, text) VALUES (${channel}, ${result[0].insertId}, ${author.id}, "${mysql_real_escape_string(msg.text)}")`);
    }

    return {
      message: msg,
      signature: this.key._sign(message.id)
    };
  }

  async getTransactionVolumeByDate () {
    const result = await this.pool.query(`SELECT DATE_FORMAT(timestamp, '%Y-%m-%d') as label, COUNT(*) as transactions, SUM(amount) as volume FROM rpg_ledger WHERE \`for\` NOT LIKE "/medals/%" GROUP BY DATE(timestamp)`);
    if (!result || !result[0]) return null;
    return result[0];
  }

  async getRoleplayVolumeByDate () {
    const result = await this.pool.query(`SELECT DATE_FORMAT(written, '%Y-%m-%d') as label, COUNT(*) as transactions FROM rpg_content WHERE DATE_FORMAT(written, '%Y-%m-%d') <> '0000-00-00' GROUP BY DATE(written)`);
    if (!result || !result[0]) return null;
    return result[0];
  }

  async listOnline () {
    const result = await this.pool.query(`SELECT
          userID as id,
          userName as nickname,
          UNIX_TIMESTAMP(dateTime) as updated
        FROM
          ajax_chat_online
        GROUP BY userID
        ORDER BY LOWER(userName)`);
    if (!result || !result[0]) return null;
    return result[0];
  }

  async listAuthors (params) {
    let sql = null;

    if (params) {
      sql = `SELECT user_id as id, username as nickname FROM gateway_users ORDER BY id DESC LIMIT ${parseInt(params.limit) || 100}`;
    } else {
      sql = `SELECT user_id as id, username as nickname FROM gateway_users ORDER BY id DESC LIMIT 100`;
    }

    const result = await this.pool.query(sql);
    if (!result || !result[0]) return null;
    return result[0];
  }

  async getAuthorByName (name) {
    const result = await this.pool.query(`SELECT user_id as id, username as nickname FROM gateway_users WHERE username_clean = "${mysql_real_escape_string(name)}"`);
    if (!result || !result[0] || !result[0][0]) return null;
    return result[0][0];
  }

  async getAuthorByID (id) {
    const result = await this.pool.query(`SELECT user_id as id, username as nickname FROM gateway_users WHERE user_id = ${parseInt(id)}`);
    if (!result || !result[0] || !result[0][0]) return null;
    return result[0][0];
  }

  async getCharacters () {
    const result = await this.pool.query(`SELECT id, name, location, roleplay_id as roleplay, url FROM rpg_characters ORDER BY id DESC LIMIT 20`);
    if (!result || !result[0]) return null;
    return result[0];
  }

  async getCharactersInLocation (placeID) {
    const result = await this.pool.query(`SELECT id, name, location, roleplay_id as roleplay, url FROM rpg_characters WHERE location = ${parseInt(placeID)} ORDER BY id DESC LIMIT 20`);
    if (!result || !result[0]) return null;
    return result[0];
  }

  async countCharactersInLocation (placeID) {
    const result = await this.pool.query(`SELECT count(id) as total FROM rpg_characters WHERE location = ${parseInt(placeID)}`);
    if (!result || !result[0]) return null;
    return result[0][0]['total'];
  }

  async getCharacterByName (name) {
    const result = await this.pool.query(`SELECT id, name FROM rpg_characters WHERE LOWER(name) LIKE "${mysql_real_escape_string(name)}%"`);
    if (!result || !result[0] || !result[0][0]) return null;
    let character = result[0][0];
    const universe = await this.getUniverseByID(character['roleplay']);
    character['link'] = `https://www.roleplaygateway.com/universes/${universe['url']}/characters/${character['url']}`;
    return character;
  }

  async listCharactersByName (name) {
    if (!name) return null;
    const result = await this.pool.query(`SELECT id, name FROM rpg_characters WHERE LOWER(name) LIKE "${mysql_real_escape_string(name)}%"`);
    if (!result || !result[0] || !result[0][0]) return null;
    let characters = result[0];

    // TODO: restore full list? i.e., from getCharacterByID

    return characters;
  }

  async listUniverses (limit = 100) {
    const result = await this.pool.query(`SELECT id, title, description as synopsis, introduction as description, url, url as slug FROM rpg_roleplays LIMIT ${limit}`);
    if (!result || !result[0]) return null;
    const universes = result[0];
    const output = universes.map((x) => {
      const universe = x;
      universe.link = `https://${config.authority}/universes/${universe.slug}`;
      universe.media = {
        thumbnail: {
          encoding: x.encoding,
          png: `https://${config.authority}/universes/${universe.slug}/image.png`,
          url: `https://${config.authority}/universes/${universe.slug}/image`
        }
      };
      return universe;
    });
    return result[0];
  }

  async getUniverseByID (id, extra = false) {
    const result = await this.pool.query(`SELECT id, title, description as synopsis, introduction as description, matrixChannelID, url, url as slug FROM rpg_roleplays WHERE id = "${id}"`);
    if (!result || !result[0] || !result[0][0]) return null;
    const universe = result[0][0];
    const entity = new Entity({ address: `@rpg/core/universes/${id}` });
    const output = Object.assign({}, universe, {
      id: entity.id,
      matrixChannelID: undefined,
      media: {
        thumbnail: {
          url: `https://${config.authority}/universes/${universe.slug}/image`
        }
      },
      services: {
        matrix: universe['matrixChannelID']
      },
      _places: (extra) ? await this.listPlacesInUniverse(id) : undefined
    });
    return output;
  }

  async getCharacterByID (id) {
    const result = await this.pool.query(`SELECT id, name, location, roleplay_id as roleplay, url FROM rpg_characters WHERE id = ${parseInt(id)}`);
    if (!result || !result[0] || !result[0][0]) return null;
    let character = result[0][0];
    const universe = await this.getUniverseByID(character['roleplay']);
    character['link'] = `https://www.roleplaygateway.com/universes/${universe['url']}/characters/${character['url']}`;
    return character;
  }

  async getPlaces () {
    const limit = 100;
    const result = await this.pool.query(`SELECT id, name FROM rpg_places LIMIT ${limit}`);
    if (!result || !result[0]) return null;
    let places = result[0];
    return places;
  }

  async listPlacesInUniverse (id, limit = 100) {
    const result = await this.pool.query(`SELECT id, name, url as slug, image_type as encoding FROM rpg_places WHERE roleplay_id = ${id} LIMIT ${limit}`);
    if (!result || !result[0]) return null;
    let places = result[0];
    let universe = await this.getUniverseByID(id);
    return places.map((x) => {
      x.media = {
        thumbnail: {
          encoding: x.encoding,
          url: `https://${config.authority}/universes/${universe.slug}/places/${x.slug}/image`
        }
      };

      x.remotes = {
        thumbnail: `https://www.roleplaygateway.com/universes/${universe.slug}/places/${x.slug}/image`
      };
      return x;
    });
  }

  async getPlaceByID (id) {
    const result = await this.pool.query(`SELECT id, name, synopsis, roleplay_id as roleplay, matrixChannelID, url as slug FROM rpg_places WHERE id = ${parseInt(id)}`);
    if (!result || !result[0] || !result[0][0]) return null;
    let place = Object.assign({}, result[0][0], {
      matrixChannelID: undefined,
      services: {
        matrix: {
          id: result[0][0]['matrixChannelID']
        }
      }
    });

    const data = await this.getPlaceDataByID(id);
    // Load exits...
    const exits = await this.getExits(place['id']);
    const active = await this.getActiveCharactersInPlace(place['id']);
    const characters = await this.getCharactersInLocation(place['id']);
    const universe = await this.getUniverseByID(place['roleplay']);
    const stats = {
      'characters': await this.countCharactersInLocation(place['id'])
    };

    place['link'] = `https://www.roleplaygateway.com/universes/${universe['url']}/places/${place['slug']}`;
    place['stats'] = stats;

    // If exits exist, add them
    place['exits'] = exits || [];
    place['active'] = active || [];
    place['characters'] = characters || [];
    place['services'] = {
      matrix: data['matrixChannelID'] || null
    };

    return place;
  }

  async getPlaceExitsByID (id) {
    const result = await this.pool.query(`SELECT id, name, synopsis, roleplay_id as roleplay, url as slug FROM rpg_places WHERE id = ${parseInt(id)}`);
    if (!result || !result[0] || !result[0][0]) return null;
    let place = result[0][0];

    const data = await this.getPlaceDataByID(id);
    // Load exits...
    const exits = await this.getExits(place['id']);

    return exits;
  }

  async getUniverseMap (id) {
    let exits = [];
    let places = [];
    let universe = null;

    const result = await this.pool.query(`SELECT id, title as name, url as slug FROM rpg_roleplays WHERE id = ${parseInt(id)}`);
    if (!result || !result[0] || !result[0][0]) return null;
    universe = result[0][0];

    let map = graphviz.digraph('Circuit', {
      rankdir: 'LR'
    });

    const placeResult = await this.pool.query(`SELECT id, name, parent_id as region, url as slug FROM rpg_places WHERE roleplay_id = ${parseInt(id)}`);
    if (!placeResult || !placeResult[0]) return null;
    places = placeResult[0];

    for (let i = 0; i < places.length; i++) {
      let place = places[i];
      const parentResult = await this.pool.query(`SELECT id, name, parent_id as region, url as slug FROM rpg_places WHERE id = ${parseInt(place['region'])}`);
      let region = parentResult[0][0];

      map.addNode(place['name'], {
        group: (region) ? region['id'] : universe['name']
      });

      if (region && region['id']) {
        map.addCluster(region['id'], {
          label: region['name']
        });
        map.addEdge(place['name'], region['name'], {
          label: 'ascend'
        });
        /* map.addEdge(region['name'], place['name'], {
          label: 'ascend'
        }); */
      }

      const exitResult = await this.pool.query(`SELECT * FROM rpg_exits WHERE place_id = ${parseInt(place['id'])} AND direction NOT IN ("ascend", "descend")`);
      if (!exitResult || !exitResult[0]) return null;
      for (let f = 0; f < exitResult[0].length; f++) {
        let exit = exitResult[0][f];
        const destinationResult = await this.pool.query(`SELECT id, name, parent_id as region, url as slug FROM rpg_places WHERE id = ${parseInt(exit['destination_id'])}`);
        let destination = destinationResult[0][0];
        map.addEdge(place['name'], destination['name'], {
          label: exit['direction']
        });
      }
    }

    return map.to_dot();
  }

  async getPlaceDataByID (id) {
    const result = await this.pool.query(`SELECT id, matrixChannelID FROM rpg_places WHERE id = ${parseInt(id)}`);
    if (!result || !result[0] || !result[0][0]) return null;
    return result[0][0];
  }

  async getVehicleByID (id) {
    const result = await this.pool.query(`SELECT i.id, v.name, i.location_id, v.roleplay_id as roleplay FROM rpg_vehicle_instances i
      INNER JOIN rpg_vehicles v
        ON v.id = i.vehicle_id
      WHERE i.id = ${parseInt(id)}`);
    if (!result || !result[0] || !result[0][0]) return null;
    return result[0][0];
  }

  async getShuttleInstances () {
    const result = await this.pool.query(`SELECT i.id, t.name, i.location_id as location, i.mode, t.roleplay_id as roleplay FROM rpg_shuttle_instances i
      INNER JOIN rpg_vehicles t
        ON t.id = i.vehicle_id
      INNER JOIN rpg_vehicle_instances v
        ON v.id = i.vehicle_instance_id
      ORDER BY i.id DESC
      LIMIT ${PER_PAGE_LIMIT}`);
    if (!result || !result[0] || !result[0]) return null;
    return result[0];
  }

  async getShuttleInstanceByID (id) {
    const result = await this.pool.query(`SELECT i.id, t.name, i.location_id as location, i.mode, t.roleplay_id as roleplay FROM rpg_shuttle_instances i
      INNER JOIN rpg_vehicles t
        ON t.id = i.vehicle_id
      INNER JOIN rpg_vehicle_instances v
        ON v.id = i.vehicle_instance_id
      WHERE i.id = ${parseInt(id)}`);
    if (!result || !result[0] || !result[0][0]) return null;
    return result[0][0];
  }

  async getMobInstances () {
    const result = await this.pool.query(`SELECT i.id, m.name, i.location_id as location, i.mood, m.roleplay_id as roleplay FROM rpg_mob_instances i
      INNER JOIN rpg_mobs m
        ON m.id = i.mob_id
      ORDER BY i.id DESC
      LIMIT ${PER_PAGE_LIMIT}`);
    if (!result || !result[0] || !result[0]) return null;
    return result[0];
  }

  async getMobInstanceByID (id) {
    const result = await this.pool.query(`SELECT i.id, m.name, i.location_id as location, i.mood, m.roleplay_id as roleplay FROM rpg_mob_instances i
      INNER JOIN rpg_mobs m
        ON m.id = i.mob_id
      WHERE i.id = ${parseInt(id)}`);
    if (!result || !result[0] || !result[0][0]) return null;
    return result[0][0];
  }

  async getAssets () {
    const result = await this.pool.query(`SELECT a.* FROM rpg_assets a
      ORDER BY a.id DESC
      LIMIT ${PER_PAGE_LIMIT}`);
    if (!result || !result[0]) return null;
    return result[0];
  }

  async getItemInstances () {
    const result = await this.pool.query(`SELECT i.id, m.name, i.location_id as location, m.roleplay_id as roleplay FROM rpg_item_instances i
      INNER JOIN rpg_items m
        ON m.id = i.item_id
      ORDER BY i.id DESC
      LIMIT ${PER_PAGE_LIMIT}`);
    if (!result || !result[0]) return null;
    return result[0];
  }

  async getItemInstanceByID (id) {
    const result = await this.pool.query(`SELECT i.id, v.name, i.location, v.roleplay_id as roleplay FROM rpg_item_instances i
      INNER JOIN rpg_items v
        ON v.id = i.item_id
      WHERE i.id = ${parseInt(id)}`);
    if (!result || !result[0] || !result[0][0]) return null;
    return result[0][0];
  }

  async getExits (placeID) {
    let result = await this.pool.query(`SELECT direction, destination_id as destination FROM rpg_exits
      WHERE place_id = ${parseInt(placeID)}
        AND direction IN ('north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest', 'up', 'down', 'in', 'out')
        AND mode <> "hidden"`);
    return result[0];
  }

  async getActiveCharactersInUniverse (universeID) {
    let result = await this.pool.query(`SELECT characterID FROM ajax_chat_online WHERE roleplayID = ${parseInt(universeID)}`);
    return result[0];
  }

  async getActiveCharactersInPlace (placeID) {
    let rpg = this;
    let result = await this.pool.query(`SELECT characterID FROM ajax_chat_online WHERE characterID IN (SELECT id FROM rpg_characters WHERE location = ${parseInt(placeID)})`);
    let list = result[0].map(function (x) {
      return rpg.getCharacterByID(x['characterID']);
    });
    return await Promise.all(list);
  }

  async getDestinationFrom (placeID, direction) {
    let result = await this.pool.query(`SELECT direction, destination_id as destination FROM rpg_exits
      WHERE place_id = ${parseInt(placeID)} AND direction = "${direction.toLowerCase()}"`);
    return result[0][0];
  }

  async moveCharacterInstance (characterID, direction) {
    let character = await this.getCharacterByID(characterID);
    let destination = await this.getDestinationFrom(character['location'], direction);
    if (!destination) return false;

    let result = await this.pool.query(`UPDATE rpg_characters
      SET location = ${destination.destination} WHERE id = ${parseInt(characterID)}`);
    if (!result) return false;

    let returningDirection = this._getPrintableReturnDirection(direction);

    await this.addGameMasterMessage(character['location'], `[b]${character['name']}[/b] leaves the area, heading [b]${direction}[/b].`);
    await this.addGameMasterMessage(destination.destination, `[b]${character['name']}[/b] arrives, coming from ${returningDirection}.`);

    return this.getCharacterByID(characterID);
  }

  async moveVehicleInstance (vehicleID, direction) {
    let vehicle = await this.getVehicleInstanceByID(vehicleID);
    let destination = await this.getDestinationFrom(vehicle['location'], direction);
    if (!destination) return false;

    let result = await this.pool.query(`UPDATE rpg_vehicle_instances
      SET location_id = ${destination.destination} WHERE id = ${parseInt(vehicleID)}`);
    if (!result) return false;

    let returningDirection = this._getPrintableReturnDirection(direction);

    await this.addGameMasterMessage(vehicle['location'], `[b]${vehicle['name']}[/b] leaves the area, heading [b]${direction}[/b].`);
    await this.addGameMasterMessage(destination.destination, `[b]${vehicle['name']}[/b] arrives, coming from ${returningDirection}.`);

    return this.getVehicleInstanceByID(vehicleID);
  }

  async moveMobInstance (mobID, direction) {
    let mob = await this.getMobInstanceByID(mobID);
    let destination = await this.getDestinationFrom(mob['location'], direction);
    if (!destination) return false;

    let result = await this.pool.query(`UPDATE rpg_mob_instances
      SET location_id = ${destination.destination} WHERE id = ${parseInt(mobID)}`);
    if (!result) return false;

    let returningDirection = this._getPrintableReturnDirection(direction);

    await this.addGameMasterMessage(mob['location'], `[b]${mob['name']}[/b] leaves the area, heading [b]${direction}[/b].`);
    await this.addGameMasterMessage(destination.destination, `[b]${mob['name']}[/b] arrives, coming from ${returningDirection}.`);

    return this.getMobInstanceByID(mobID);
  }

  async updatePlace (locationID, data) {
    if (!data) return false;
    if (!data.channel) return false;
    let sql = `UPDATE rpg_places SET matrixChannelID = "${mysql_real_escape_string(data.channel)}" WHERE id = ${locationID}`;
    let result = await this.pool.query(sql);
    return result;
  }

  async addGameMasterMessage (locationID, message) {
    let location = await this.getPlaceByID(locationID);

    if (ENABLE_CHAT_MESSAGES) {
      let chatResult = await this.pool.query(`INSERT INTO ajax_chat_messages (
        userID,
        userName,
        userRole,
        channel,
        dateTime,
        ip,
        text,
        text,
        roleplayID
      ) VALUES (
          ${parseInt(CHATBOT_ID)},
          'Game Master (GM)',
          4,
          ${locationID},
          NOW(),
          CAST('127.0.0.1' AS BINARY),
          '${message}',
          ${location.roleplay}
      )`);

      if (ENABLE_PUBLIC_LOGS) {
        let contentResult = await this.pool.query(`INSERT INTO rpg_content (
          roleplay_id,
          character_id,
          author_id,
          type,
          place_id,
          text,
          bbcode_bitfield,
          bbcode_uid,
          old_chat_id
        ) VALUES (
          ${location.roleplay},
          ${parseInt(CHATBOT_ID)},
          ${parseInt(CHATBOT_ID)},
          "Movement",
          ${locationID},
          "${message}",
          7,
          '',
          ${chatResult[0].insertId}
        )`);
      }
    }
  }

  _getReturnDirection (direction) {
    switch (direction.toLowerCase()) {
      case 'north':
        return 'south';
      case 'northeast':
        return 'southwest';
      case 'east':
        return 'west';
      case 'southeast':
        return 'northwest';
      case 'south':
        return 'north';
      case 'southwest':
        return 'northeast';
      case 'west':
        return 'east';
      case 'northwest':
        return 'southeast';
      case 'up':
        return 'down';
      case 'down':
        return 'up';
    }
  }

  _getPrintableReturnDirection (direction) {
    switch (direction.toLowerCase()) {
      case 'north':
        return 'the [b]south[/b]';
      case 'northeast':
        return 'the [b]southwest[/b]';
      case 'east':
        return 'the [b]west[/b]';
      case 'southeast':
        return 'the [b]northwest[/b]';
      case 'south':
        return 'the [b]north[/b]';
      case 'southwest':
        return 'the [b]northeast[/b]';
      case 'west':
        return 'the [b]east[/b]';
      case 'northwest':
        return 'the [b]southeast[/b]';
      case 'up':
        return '[b]below[/b] (down)';
      case 'down':
        return '[b]above[/b] (up)';
      case 'out':
        return ' within';
      case 'in':
        return '[b]outside[/b]';
    }
  }
}

module.exports = RPG;
