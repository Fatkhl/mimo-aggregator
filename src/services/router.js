const db = require('../db');
const keypool = require('./keypool');
const { getConfig } = require('../config');

class Router {
  constructor() {
    this.roundRobinIndex = 0;
    this.stickyMap = new Map();
  }

  getStrategy() {
    return getConfig('routing_strategy', 'failover');
  }

  selectKey(model, clientIp) {
    const enabled = keypool.getEnabled().filter(k => {
      if (!model) return true;
      const models = JSON.parse(k.models || '[]');
      return models.length === 0 || models.includes(model) || models.includes('*');
    });
    if (enabled.length === 0) return null;

    // Sort by health score descending, then by weight
    enabled.sort((a, b) => {
      if (a.status === 'down' && b.status !== 'down') return 1;
      if (a.status !== 'down' && b.status === 'down') return -1;
      return (b.health_score * b.weight) - (a.health_score * a.weight);
    });

    // Filter out down keys for most strategies
    const available = enabled.filter(k => k.status !== 'down');
    const pool = available.length > 0 ? available : enabled;

    const strategy = this.getStrategy();
    switch (strategy) {
      case 'round-robin':
        return this._roundRobin(pool);
      case 'least-used':
        return this._leastUsed(pool);
      case 'weighted':
        return this._weighted(pool);
      case 'sticky':
        return this._sticky(pool, clientIp);
      case 'failover':
      default:
        return this._failover(pool);
    }
  }

  _failover(pool) {
    return pool[0]; // Already sorted by health*weight
  }

  _roundRobin(pool) {
    this.roundRobinIndex = (this.roundRobinIndex + 1) % pool.length;
    return pool[this.roundRobinIndex];
  }

  _leastUsed(pool) {
    return pool.reduce((min, k) => k.total_requests < min.total_requests ? k : min, pool[0]);
  }

  _weighted(pool) {
    const totalWeight = pool.reduce((sum, k) => sum + k.weight, 0);
    let random = Math.random() * totalWeight;
    for (const k of pool) {
      random -= k.weight;
      if (random <= 0) return k;
    }
    return pool[0];
  }

  _sticky(pool, clientIp) {
    if (!clientIp) return this._failover(pool);
    const existing = this.stickyMap.get(clientIp);
    if (existing && pool.find(k => k.id === existing)) {
      return pool.find(k => k.id === existing);
    }
    const selected = this._failover(pool);
    this.stickyMap.set(clientIp, selected.id);
    return selected;
  }
}

module.exports = new Router();
