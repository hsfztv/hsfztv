'use strict'

const utils = require('./utils')
const log = require('./log')

class Peer {
  constructor(id, ip, location) {
    this.id = id
    this.ip = ip
    this.location = location
    this.subnet = utils.get_ip_subnet(this.ip)

    // mapping from url to true
    this.fragments = {}

    // number of available upload slots
    this.slots = 0

    // sent and received
    this.stats = {
      p2p: {
        sent: 0,
        received: 0,
      },
      xhr: {
        received: 0,
      },
    }
  }
}

class Subnet {
  constructor(subnet) {
    this.subnet = subnet
    this.peers = {}
  }
}

class Location {
  constructor(location) {
    this.location = location
    this.id = this.location.id

    // map from location id to distance in km
    this.distances = {}

    // list of sorted neighbour location ids
    this.neighbours = []

    // peers at this location
    this.peers = {}
  }
}

class Tracker {
  constructor(comet) {
    // mapping from id to peer
    this.comet = comet
    this.peers = {}

    this.locations = {}
    this.subnets = {}

    // global stats
    this.stats = {
      peers: {
        max: 0,
      },
      timing: {
        report: {
          samples: [],
        },
        query: {
          samples: [],
        },
      },
      p2p: {
        sent: 0,
        received: 0,
      },
      xhr: {
        received: 0,
      },
    }

    this.timer = setInterval(() => {
      let stats = [
        `peers = ${Object.keys(this.peers).length}/${this.stats.peers.max}`,
        `locations = ${Object.keys(this.locations).length}`,
        `subnets = ${Object.keys(this.subnets).length}`,
        `p2p.sent = ${this.stats.p2p.sent}`,
        `p2p.received = ${this.stats.p2p.received}`,
        `xhr.received = ${this.stats.xhr.received}`,
        `total.received = ${this.stats.p2p.received + this.stats.xhr.received}`,
        `ratio = ${this.stats.p2p.received / (this.stats.p2p.received + this.stats.xhr.received + 1)}`,
      ]
      if (this.stats.timing.query.samples.length > 0) {
        stats.push(`timing.query = ${Math.round(this.stats.timing.query.min * 1e6)}/${Math.round(utils.average(this.stats.timing.query.samples) * 1e6)}/${Math.round(this.stats.timing.query.max * 1e6)}`)
      }
      if (this.stats.timing.report.samples.length > 0) {
        stats.push(`timing.report = ${Math.round(this.stats.timing.report.min * 1e6)}/${Math.round(utils.average(this.stats.timing.report.samples) * 1e6)}/${Math.round(this.stats.timing.report.max * 1e6)}`)
      }
      let statistics = stats.join(', ')
      if (statistics != this.statistics) {
        log.debug(`tracker: statistics: ${statistics}`)
      }
      this.statistics = statistics
    }, 10000)
  }

  get_or_create_subnet(subnet) {
    if (!subnet) {
      return null
    }
    if (this.subnets[subnet]) {
      return this.subnets[subnet]
    }
    var new_subnet = new Subnet(subnet)
    this.subnets[subnet] = new_subnet
    return new_subnet
  }

  get_or_create_location(location) {
    if (!location) {
      return null
    }
    if (this.locations[location.id]) {
      return this.locations[location.id]
    }
    var new_location = new Location(location)
    this.locations[location.id] = new_location
    for (let id in this.locations) {
      let other_location = this.locations[id]
      if (other_location === new_location) {
        continue
      }
      // figure out the distance to each location
      const distance = utils.distance(other_location.location, new_location)
      other_location.distances[new_location.id] = distance
      // keep a list of sorted neighbours
      other_location.neighbours = utils.sorted_keys(other_location.distances)
      new_location.distances[other_location.id] = distance
    }
    new_location.neighbours = utils.sorted_keys(new_location.distances)
    return new_location
  }

  get_or_create_peer(id, ip, location) {
    if (this.peers[id]) {
      return this.peers[id]
    }
    const peer = new Peer(id, ip, location)
    this.peers[id] = peer
    const subnet = this.get_or_create_subnet(peer.subnet)
    if (subnet) {
      subnet.peers[id] = peer
    }
    location = this.get_or_create_location(peer.location)
    if (location) {
      location.peers[id] = peer
    }
    this.stats.peers.max = Math.max(this.stats.peers.max, Object.keys(this.peers).length)
    return peer
  }

  pick_peers(url, requester, chosen, count) {
    const pool = {}

    // find peer in local subnet
    if (requester.subnet && this.subnets[requester.subnet]) {
      const subnet = this.subnets[requester.subnet]
      for (let id in subnet.peers) {
        let peer = subnet.peers[id]
        if (id === requester.id || chosen[id] || !peer.fragments[url] || peer.slots <= 0) {
          continue
        }
        pool[id] = peer
      }
    }

    // if requester location is known
    if (requester.location && this.locations[requester.location.id]) {
      const location = this.locations[requester.location.id]

      // find peer in same location
      for (let id in location.peers) {
        let peer = location.peers[id]
        if (id === requester.id || chosen[id] || !peer.fragments[url] || peer.slots <= 0) {
          continue
        }
        pool[id] = peer
      }

      // find peer in neighbour locations
      for (let neighbour of location.neighbours) {
        if (Object.keys(pool).length > count * 2) {
          break
        }
        // limit distance to 1000 km
        if (!location.distances[neighbour] || location.distances[neighbour] > 1000) {
          break
        }
        neighbour = this.locations[neighbour]
        // limit peer in own country
        if (!neighbour || neighbour.location.country != location.location.country) {
          continue
        }
        for (let id in neighbour.peers) {
          let peer = neighbour.peers[id]
          if (id === requester.id || chosen[id] || !peer.fragments[url] || peer.slots <= 0) {
            continue
          }
          pool[id] = peer
        }
      }
    }

    // randomly choose from candidates
    log.verbose(`tracker: pick: chosen = ${Object.keys(chosen).length}, pool = ${Object.keys(pool).length}`)

    while (Object.keys(chosen).length < count) {
      const keys = Object.keys(pool)
      if (keys.length == 0) {
        break
      }
      let id = keys[Math.floor(Math.random() * keys.length)]
      chosen[id] = pool[id]
      delete pool[id]
    }
  }

  query(id, ip, location, url, contributors, candidates, callback) {
    // record start time
    let t = process.hrtime()

    // find peer
    const requester = this.get_or_create_peer(id, ip, location)

    const chosen = {}

    // check contributors, ignore slots
    for (id of contributors) {
      if (!this.peers[id] || !this.peers[id].fragments[url]) {
        continue
      }
      chosen[id] = this.peers[id]
    }

    // check known peers
    for (id of candidates) {
      if (!this.peers[id] || !this.peers[id].fragments[url] || this.peers[id].slots <= 0) {
        continue
      }
      chosen[id] = this.peers[id]
    }

    // make sure self is not in there
    delete chosen[requester.id]

    // pick at least 4 + 1 peers, at least 1 peer must be new
    this.pick_peers(url, requester, chosen, Math.max(Object.keys(chosen).length, 4) + 1)

    // return to caller
    const peers = Object.keys(chosen)

    // timing stats
    t = process.hrtime(t)
    const elapsed = (t[1] / 1e9) + t[0]
    if (!this.stats.timing.query.max || this.stats.timing.query.max < elapsed) {
      this.stats.timing.query.max = elapsed
    }
    if (!this.stats.timing.query.min || this.stats.timing.query.min > elapsed) {
      this.stats.timing.query.min = elapsed
    }
    this.stats.timing.query.samples.push(elapsed)
    while (this.stats.timing.query.samples.length > 100) {
      this.stats.timing.query.samples.shift()
    }

    log.verbose(`tracker: query: id = ${requester.id}, ip = ${ip}, location = ${requester.location ? requester.location.id : null}, fragment = ${url}, peers = ${peers}, elapsed = ${elapsed}`)
    return peers
  }

  report(id, ip, location, fragments, slots, stats) {
    // record start time
    let t = process.hrtime()

    // find peer
    const peer = this.get_or_create_peer(id, ip, location)
    peer.slots = slots

    if (stats && stats.p2p) {
      if (stats.p2p.sent && stats.p2p.sent > peer.stats.p2p.sent) {
        this.stats.p2p.sent += stats.p2p.sent - peer.stats.p2p.sent
        peer.stats.p2p.sent = stats.p2p.sent
      }
      if (stats.p2p.received && stats.p2p.received > peer.stats.p2p.received) {
        this.stats.p2p.received += stats.p2p.received - peer.stats.p2p.received
        peer.stats.p2p.received = stats.p2p.received
      }
    }
    if (stats && stats.xhr) {
      if (stats.xhr.received && stats.xhr.received > peer.stats.xhr.received) {
        this.stats.xhr.received += stats.xhr.received - peer.stats.xhr.received
        peer.stats.xhr.received = stats.xhr.received
      }
    }

    for (let url of (fragments.added || [])) {
      peer.fragments[url] = true
    }
    for (let url of (fragments.removed || [])) {
      delete peer.fragments[url]
    }

    // timing stats
    t = process.hrtime(t)
    const elapsed = (t[1] / 1e9) + t[0]
    if (!this.stats.timing.report.max || this.stats.timing.report.max < elapsed) {
      this.stats.timing.report.max = elapsed
    }
    if (!this.stats.timing.report.min || this.stats.timing.report.min > elapsed) {
      this.stats.timing.report.min = elapsed
    }
    this.stats.timing.report.samples.push(elapsed)
    while (this.stats.timing.report.samples.length > 100) {
      this.stats.timing.report.samples.shift()
    }

    log.verbose(`tracker: report: id = ${id}, ip = ${ip}, location = ${location ? location.id : null}, fragments = ${Object.keys(peer.fragments).length}, slots = ${peer.slots}, elapsed = ${elapsed}`)
  }

  remove(id) {
    if (!this.peers[id]) {
      return
    }
    const peer = this.peers[id]
    delete this.peers[id]
    if (peer.location) {
      const location = this.locations[peer.location.id]
      if (location) {
        delete location.peers[id]
      }
    }
    if (peer.subnet) {
      const subnet = this.subnets[peer.subnet]
      if (subnet) { 
        delete subnet.peers[id]
      }
    }
  }
}

module.exports = {
  Tracker,
}
