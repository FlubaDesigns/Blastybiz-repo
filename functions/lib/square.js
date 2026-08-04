'use strict';

// Lazy-init Square client — secret not available at module load time
let _square;
function getSquare() {
  if (!_square) {
    const { SquareClient, SquareEnvironment } = require('square');
    _square = new SquareClient({
      token: process.env.SQUARE_ACCESS_TOKEN,
      environment: SquareEnvironment.Production,
    });
  }
  return _square;
}

module.exports = { getSquare };
