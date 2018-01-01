'use strict'

const log = require('./log')

class API {

  constructor(comet) {
    this.comet = comet
    this.app = this.comet.app

    // handle api call
    this.app.post('/api', (request, response) => {
      if (request.query.key != process.env.API_KEY) {
        response.writeHead(403)
        response.end()
        return
      }
      response.writeHead(200)
      response.end()

      this.api(request.body)
    })
  }

  api(data) {
    log.verbose(`api call: ${JSON.stringify(data)}`)
  }
}

module.exports = {
  API,
}
