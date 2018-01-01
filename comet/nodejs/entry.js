'use strict'

// read cert and key
const fs = require('fs')
const options = {
  key: fs.readFileSync('key.pem'),
  cert: fs.readFileSync('cert.pem'),
}

// setup express
const express = require('express')
const app = express()
app.use(express.query())
app.use(require('body-parser').json())
app.use(require('morgan')('dev'))
app.disable('x-powered-by')

// setup https
const https = require('https').createServer(options, app)
https.listen(443)

// setup http
const http = require('http').createServer(app)
http.listen(80)

// setup socket io
const io = require('socket.io')(https, {
  cookie: false,
})

// setup comet
require('./comet')(app, io)
