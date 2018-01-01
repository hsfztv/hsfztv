'use strict'

const geoip = require('geoip-lite')
const yaml = require('js-yaml')

const log = require('./log')

const is_id = (id) => {
  return /^[0-9a-zA-Z\-]+$/.test(id)
}

const is_uuid = (uuid) => {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(uuid)
}

const is_email = (email) => {
  return /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/.test(email)
}

const get_timestamp = () => {
  return new Date().getTime() / 1000.0
}

const get_socket_ip = (socket) => {
  // process ip
  // var ip = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address
  var ip = socket.handshake.address
  if (ip.startsWith('::ffff:')) {
    ip = ip.slice('::ffff:'.length)
  }
  return ip
}

const get_ip_subnet = (ip) => {
  var parts = ip.split('.')
  if (parts.length !== 4) {
    return null
  }
  return parts[0] + '.' + parts[1]
}

const locate_ip = (ip) => {
  var geo = geoip.lookup(ip)
  if (!(geo && geo.country && geo.ll)) {
    return null
  }
  var latitude = geo.ll[0]
  var longitude = geo.ll[1]
  // garther information
  var location = {
    id: '' + Math.round(latitude * 100.0) / 100.0 + ',' + Math.round(longitude * 100.0) / 100.0,
    country: geo.country,
    latitude,
    longitude,
  }
  if (geo.region) {
    location.region = geo.region
  }
  if (geo.city) {
    location.city = geo.city
  }
  return location
}

const distance = (l1, l2) => {
  var p = 0.017453292519943295
  var c = Math.cos
  var a = 0.5 - c((l2.latitude - l1.latitude) * p) / 2 + c(l1.latitude * p) * c(l2.latitude * p) * (1 - c((l2.longitude - l1.longitude) * p)) / 2
  return 12742 * Math.asin(Math.sqrt(a))
}

const sorted_keys = (d) => {
  var keys = Object.keys(d)
  return keys.sort(function(a, b) {
    return d[a] - d[b]
  })
}

const average = (l) => {
  var s = 0
  for (let i of l) {
    s += i
  }
  return s / l.length
}

const parse_yaml = (content) => {
  if (content) {
    try {
      return yaml.load(content)
    } catch(e) {
      log.error(`failed to parse yaml: ${e}`)
    }
  }
  return null
}

const dump_yaml = (content) => {
  return yaml.dump(content)
}

const parse_json = (content) => {
  if (content) {
    try {
      return JSON.parse(content)
    } catch(e) {
      log.error(`failed to parse json: ${e}`)
    }
  }
  return null
}

const dump_json = (content) => {
  return JSON.stringify(content)
}

module.exports = {
  is_id,
  is_uuid,
  is_email,
  get_timestamp,
  get_socket_ip,
  get_ip_subnet,
  locate_ip,
  distance,
  sorted_keys,
  average,
  parse_yaml,
  dump_yaml,
  parse_json,
  dump_json,
}
