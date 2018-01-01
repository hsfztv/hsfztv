'use strict'

const crypto = require('crypto')

const log = require('./log')

const generate_random_id = (length, callback) => {
  const alphanumeric = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
  const random_to_id = (length, data) => {
    var id = ''
    for (let i = 0; i < length; i++) {
      id += alphanumeric[data.readUInt32BE(i*4) % alphanumeric.length]
    }
    return id
  }

  if (!callback) {
    return random_to_id(length, crypto.randomBytes(length*4))
  }

  crypto.randomBytes(length*4, (err, data) => {
    if (err) {
      log.error(`failed to generate random id: ${err}`)
      return callback(null)
    }
    return callback(random_to_id(length, data))
  })
}

const hash_password = (password, callback) => {
  const hash_size = 32
  const salt_size = 16
  const iterations = 100000
  const digest = 'sha1'

  crypto.randomBytes(salt_size, (err, salt) => {
    if (err) {
      log.error(`failed to hash password: ${err}`)
      return callback(null)
    }

    crypto.pbkdf2(password, salt, iterations, hash_size, digest, (err, hash) => {
      if (err) {
        log.error(`failed to hash password: ${err}`)
        return callback(null)
      }

      return callback({
        digest: digest,
        iterations,
        salt: salt.toString('hex'),
        hash: hash.toString('hex'),
      })
    })
  })
}

const verify_password = (password, encoded, callback) => {
  // extract the salt and hash from the combined buffer
  var digest = encoded.digest
  var iterations = encoded.iterations
  var salt = Buffer.from(encoded.salt, 'hex')
  var hash = Buffer.from(encoded.hash, 'hex')

  // verify the salt and hash against the password
  crypto.pbkdf2(password, salt, iterations, hash.length, digest, (err, verify) => {
    if (err) {
      log.error(`failed to verify password: ${err}`)
      return callback(false)
    }
    return callback(verify.toString('binary') === hash.toString('binary'))
  })
}

module.exports = {
  generate_random_id,
  hash_password,
  verify_password,
}
