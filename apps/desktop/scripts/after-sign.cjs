const { sign } = require('./vmp-sign.cjs')

/** After code signing: the Windows VMP signature. */
exports.default = (context) => sign(context, 'afterSign')
