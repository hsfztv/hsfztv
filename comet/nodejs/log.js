'use strict'

const colors = require('colors/safe')

const log = (color, message) => {
  if (process.env.NODE_ENV === 'production') {
    console.log(color(message))
  } else {
    console.log(color(`${new Date().toISOString()} ${message}`))
  }
}

const error = (message) => {
  log(colors.red, message)
}

const warn = (message) => {
  log(colors.yellow, message)
}

const info = (message) => {
  log(colors.white, message)
}

const debug = (message) => {
  log(colors.green, message)
}

const verbose = (message) => {
  log(colors.blue, message)
}

module.exports = {
  error,
  warn,
  info,
  debug,
  verbose,
}
