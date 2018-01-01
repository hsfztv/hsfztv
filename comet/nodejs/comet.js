'use strict'

const utils = require('./utils')
const api = require('./api')
const client = require('./client')
const tracker = require('./tracker')
const log = require('./log')
const db = require('./db')

class Comet {
  constructor(app, io) {
    this.app = app
    this.io = io

    // database
    this.db = new db.Database(this)

    // handle api call
    this.api = new api.API(this)

    // tracker
    this.tracker = new tracker.Tracker(this)

    // handle socket connection
    this.io.sockets.on('connection', (socket) => {
      new client.Client(this, socket)
    })
  }
}

module.exports = (app, io) => {
  new Comet(app, io)
}

