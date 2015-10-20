(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
/*!
 * The buffer module from node.js, for the browser.
 *
 * @author   Feross Aboukhadijeh <feross@feross.org> <http://feross.org>
 * @license  MIT
 */

var base64 = require('base64-js')
var ieee754 = require('ieee754')
var isArray = require('is-array')

exports.Buffer = Buffer
exports.SlowBuffer = SlowBuffer
exports.INSPECT_MAX_BYTES = 50
Buffer.poolSize = 8192 // not used by this implementation

var rootParent = {}

/**
 * If `Buffer.TYPED_ARRAY_SUPPORT`:
 *   === true    Use Uint8Array implementation (fastest)
 *   === false   Use Object implementation (most compatible, even IE6)
 *
 * Browsers that support typed arrays are IE 10+, Firefox 4+, Chrome 7+, Safari 5.1+,
 * Opera 11.6+, iOS 4.2+.
 *
 * Note:
 *
 * - Implementation must support adding new properties to `Uint8Array` instances.
 *   Firefox 4-29 lacked support, fixed in Firefox 30+.
 *   See: https://bugzilla.mozilla.org/show_bug.cgi?id=695438.
 *
 *  - Chrome 9-10 is missing the `TypedArray.prototype.subarray` function.
 *
 *  - IE10 has a broken `TypedArray.prototype.subarray` function which returns arrays of
 *    incorrect length in some situations.
 *
 * We detect these buggy browsers and set `Buffer.TYPED_ARRAY_SUPPORT` to `false` so they will
 * get the Object implementation, which is slower but will work correctly.
 */
Buffer.TYPED_ARRAY_SUPPORT = (function () {
  function Foo () {}
  try {
    var buf = new ArrayBuffer(0)
    var arr = new Uint8Array(buf)
    arr.foo = function () { return 42 }
    arr.constructor = Foo
    return arr.foo() === 42 && // typed array instances can be augmented
        arr.constructor === Foo && // constructor can be set
        typeof arr.subarray === 'function' && // chrome 9-10 lack `subarray`
        new Uint8Array(1).subarray(1, 1).byteLength === 0 // ie10 has broken `subarray`
  } catch (e) {
    return false
  }
})()

function kMaxLength () {
  return Buffer.TYPED_ARRAY_SUPPORT
    ? 0x7fffffff
    : 0x3fffffff
}

/**
 * Class: Buffer
 * =============
 *
 * The Buffer constructor returns instances of `Uint8Array` that are augmented
 * with function properties for all the node `Buffer` API functions. We use
 * `Uint8Array` so that square bracket notation works as expected -- it returns
 * a single octet.
 *
 * By augmenting the instances, we can avoid modifying the `Uint8Array`
 * prototype.
 */
function Buffer (arg) {
  if (!(this instanceof Buffer)) {
    // Avoid going through an ArgumentsAdaptorTrampoline in the common case.
    if (arguments.length > 1) return new Buffer(arg, arguments[1])
    return new Buffer(arg)
  }

  this.length = 0
  this.parent = undefined

  // Common case.
  if (typeof arg === 'number') {
    return fromNumber(this, arg)
  }

  // Slightly less common case.
  if (typeof arg === 'string') {
    return fromString(this, arg, arguments.length > 1 ? arguments[1] : 'utf8')
  }

  // Unusual.
  return fromObject(this, arg)
}

function fromNumber (that, length) {
  that = allocate(that, length < 0 ? 0 : checked(length) | 0)
  if (!Buffer.TYPED_ARRAY_SUPPORT) {
    for (var i = 0; i < length; i++) {
      that[i] = 0
    }
  }
  return that
}

function fromString (that, string, encoding) {
  if (typeof encoding !== 'string' || encoding === '') encoding = 'utf8'

  // Assumption: byteLength() return value is always < kMaxLength.
  var length = byteLength(string, encoding) | 0
  that = allocate(that, length)

  that.write(string, encoding)
  return that
}

function fromObject (that, object) {
  if (Buffer.isBuffer(object)) return fromBuffer(that, object)

  if (isArray(object)) return fromArray(that, object)

  if (object == null) {
    throw new TypeError('must start with number, buffer, array or string')
  }

  if (typeof ArrayBuffer !== 'undefined' && object.buffer instanceof ArrayBuffer) {
    return fromTypedArray(that, object)
  }

  if (object.length) return fromArrayLike(that, object)

  return fromJsonObject(that, object)
}

function fromBuffer (that, buffer) {
  var length = checked(buffer.length) | 0
  that = allocate(that, length)
  buffer.copy(that, 0, 0, length)
  return that
}

function fromArray (that, array) {
  var length = checked(array.length) | 0
  that = allocate(that, length)
  for (var i = 0; i < length; i += 1) {
    that[i] = array[i] & 255
  }
  return that
}

// Duplicate of fromArray() to keep fromArray() monomorphic.
function fromTypedArray (that, array) {
  var length = checked(array.length) | 0
  that = allocate(that, length)
  // Truncating the elements is probably not what people expect from typed
  // arrays with BYTES_PER_ELEMENT > 1 but it's compatible with the behavior
  // of the old Buffer constructor.
  for (var i = 0; i < length; i += 1) {
    that[i] = array[i] & 255
  }
  return that
}

function fromArrayLike (that, array) {
  var length = checked(array.length) | 0
  that = allocate(that, length)
  for (var i = 0; i < length; i += 1) {
    that[i] = array[i] & 255
  }
  return that
}

// Deserialize { type: 'Buffer', data: [1,2,3,...] } into a Buffer object.
// Returns a zero-length buffer for inputs that don't conform to the spec.
function fromJsonObject (that, object) {
  var array
  var length = 0

  if (object.type === 'Buffer' && isArray(object.data)) {
    array = object.data
    length = checked(array.length) | 0
  }
  that = allocate(that, length)

  for (var i = 0; i < length; i += 1) {
    that[i] = array[i] & 255
  }
  return that
}

function allocate (that, length) {
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    // Return an augmented `Uint8Array` instance, for best performance
    that = Buffer._augment(new Uint8Array(length))
  } else {
    // Fallback: Return an object instance of the Buffer class
    that.length = length
    that._isBuffer = true
  }

  var fromPool = length !== 0 && length <= Buffer.poolSize >>> 1
  if (fromPool) that.parent = rootParent

  return that
}

function checked (length) {
  // Note: cannot use `length < kMaxLength` here because that fails when
  // length is NaN (which is otherwise coerced to zero.)
  if (length >= kMaxLength()) {
    throw new RangeError('Attempt to allocate Buffer larger than maximum ' +
                         'size: 0x' + kMaxLength().toString(16) + ' bytes')
  }
  return length | 0
}

function SlowBuffer (subject, encoding) {
  if (!(this instanceof SlowBuffer)) return new SlowBuffer(subject, encoding)

  var buf = new Buffer(subject, encoding)
  delete buf.parent
  return buf
}

Buffer.isBuffer = function isBuffer (b) {
  return !!(b != null && b._isBuffer)
}

Buffer.compare = function compare (a, b) {
  if (!Buffer.isBuffer(a) || !Buffer.isBuffer(b)) {
    throw new TypeError('Arguments must be Buffers')
  }

  if (a === b) return 0

  var x = a.length
  var y = b.length

  var i = 0
  var len = Math.min(x, y)
  while (i < len) {
    if (a[i] !== b[i]) break

    ++i
  }

  if (i !== len) {
    x = a[i]
    y = b[i]
  }

  if (x < y) return -1
  if (y < x) return 1
  return 0
}

Buffer.isEncoding = function isEncoding (encoding) {
  switch (String(encoding).toLowerCase()) {
    case 'hex':
    case 'utf8':
    case 'utf-8':
    case 'ascii':
    case 'binary':
    case 'base64':
    case 'raw':
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      return true
    default:
      return false
  }
}

Buffer.concat = function concat (list, length) {
  if (!isArray(list)) throw new TypeError('list argument must be an Array of Buffers.')

  if (list.length === 0) {
    return new Buffer(0)
  } else if (list.length === 1) {
    return list[0]
  }

  var i
  if (length === undefined) {
    length = 0
    for (i = 0; i < list.length; i++) {
      length += list[i].length
    }
  }

  var buf = new Buffer(length)
  var pos = 0
  for (i = 0; i < list.length; i++) {
    var item = list[i]
    item.copy(buf, pos)
    pos += item.length
  }
  return buf
}

function byteLength (string, encoding) {
  if (typeof string !== 'string') string = '' + string

  var len = string.length
  if (len === 0) return 0

  // Use a for loop to avoid recursion
  var loweredCase = false
  for (;;) {
    switch (encoding) {
      case 'ascii':
      case 'binary':
      // Deprecated
      case 'raw':
      case 'raws':
        return len
      case 'utf8':
      case 'utf-8':
        return utf8ToBytes(string).length
      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return len * 2
      case 'hex':
        return len >>> 1
      case 'base64':
        return base64ToBytes(string).length
      default:
        if (loweredCase) return utf8ToBytes(string).length // assume utf8
        encoding = ('' + encoding).toLowerCase()
        loweredCase = true
    }
  }
}
Buffer.byteLength = byteLength

// pre-set for values that may exist in the future
Buffer.prototype.length = undefined
Buffer.prototype.parent = undefined

function slowToString (encoding, start, end) {
  var loweredCase = false

  start = start | 0
  end = end === undefined || end === Infinity ? this.length : end | 0

  if (!encoding) encoding = 'utf8'
  if (start < 0) start = 0
  if (end > this.length) end = this.length
  if (end <= start) return ''

  while (true) {
    switch (encoding) {
      case 'hex':
        return hexSlice(this, start, end)

      case 'utf8':
      case 'utf-8':
        return utf8Slice(this, start, end)

      case 'ascii':
        return asciiSlice(this, start, end)

      case 'binary':
        return binarySlice(this, start, end)

      case 'base64':
        return base64Slice(this, start, end)

      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return utf16leSlice(this, start, end)

      default:
        if (loweredCase) throw new TypeError('Unknown encoding: ' + encoding)
        encoding = (encoding + '').toLowerCase()
        loweredCase = true
    }
  }
}

Buffer.prototype.toString = function toString () {
  var length = this.length | 0
  if (length === 0) return ''
  if (arguments.length === 0) return utf8Slice(this, 0, length)
  return slowToString.apply(this, arguments)
}

Buffer.prototype.equals = function equals (b) {
  if (!Buffer.isBuffer(b)) throw new TypeError('Argument must be a Buffer')
  if (this === b) return true
  return Buffer.compare(this, b) === 0
}

Buffer.prototype.inspect = function inspect () {
  var str = ''
  var max = exports.INSPECT_MAX_BYTES
  if (this.length > 0) {
    str = this.toString('hex', 0, max).match(/.{2}/g).join(' ')
    if (this.length > max) str += ' ... '
  }
  return '<Buffer ' + str + '>'
}

Buffer.prototype.compare = function compare (b) {
  if (!Buffer.isBuffer(b)) throw new TypeError('Argument must be a Buffer')
  if (this === b) return 0
  return Buffer.compare(this, b)
}

Buffer.prototype.indexOf = function indexOf (val, byteOffset) {
  if (byteOffset > 0x7fffffff) byteOffset = 0x7fffffff
  else if (byteOffset < -0x80000000) byteOffset = -0x80000000
  byteOffset >>= 0

  if (this.length === 0) return -1
  if (byteOffset >= this.length) return -1

  // Negative offsets start from the end of the buffer
  if (byteOffset < 0) byteOffset = Math.max(this.length + byteOffset, 0)

  if (typeof val === 'string') {
    if (val.length === 0) return -1 // special case: looking for empty string always fails
    return String.prototype.indexOf.call(this, val, byteOffset)
  }
  if (Buffer.isBuffer(val)) {
    return arrayIndexOf(this, val, byteOffset)
  }
  if (typeof val === 'number') {
    if (Buffer.TYPED_ARRAY_SUPPORT && Uint8Array.prototype.indexOf === 'function') {
      return Uint8Array.prototype.indexOf.call(this, val, byteOffset)
    }
    return arrayIndexOf(this, [ val ], byteOffset)
  }

  function arrayIndexOf (arr, val, byteOffset) {
    var foundIndex = -1
    for (var i = 0; byteOffset + i < arr.length; i++) {
      if (arr[byteOffset + i] === val[foundIndex === -1 ? 0 : i - foundIndex]) {
        if (foundIndex === -1) foundIndex = i
        if (i - foundIndex + 1 === val.length) return byteOffset + foundIndex
      } else {
        foundIndex = -1
      }
    }
    return -1
  }

  throw new TypeError('val must be string, number or Buffer')
}

// `get` will be removed in Node 0.13+
Buffer.prototype.get = function get (offset) {
  console.log('.get() is deprecated. Access using array indexes instead.')
  return this.readUInt8(offset)
}

// `set` will be removed in Node 0.13+
Buffer.prototype.set = function set (v, offset) {
  console.log('.set() is deprecated. Access using array indexes instead.')
  return this.writeUInt8(v, offset)
}

function hexWrite (buf, string, offset, length) {
  offset = Number(offset) || 0
  var remaining = buf.length - offset
  if (!length) {
    length = remaining
  } else {
    length = Number(length)
    if (length > remaining) {
      length = remaining
    }
  }

  // must be an even number of digits
  var strLen = string.length
  if (strLen % 2 !== 0) throw new Error('Invalid hex string')

  if (length > strLen / 2) {
    length = strLen / 2
  }
  for (var i = 0; i < length; i++) {
    var parsed = parseInt(string.substr(i * 2, 2), 16)
    if (isNaN(parsed)) throw new Error('Invalid hex string')
    buf[offset + i] = parsed
  }
  return i
}

function utf8Write (buf, string, offset, length) {
  return blitBuffer(utf8ToBytes(string, buf.length - offset), buf, offset, length)
}

function asciiWrite (buf, string, offset, length) {
  return blitBuffer(asciiToBytes(string), buf, offset, length)
}

function binaryWrite (buf, string, offset, length) {
  return asciiWrite(buf, string, offset, length)
}

function base64Write (buf, string, offset, length) {
  return blitBuffer(base64ToBytes(string), buf, offset, length)
}

function ucs2Write (buf, string, offset, length) {
  return blitBuffer(utf16leToBytes(string, buf.length - offset), buf, offset, length)
}

Buffer.prototype.write = function write (string, offset, length, encoding) {
  // Buffer#write(string)
  if (offset === undefined) {
    encoding = 'utf8'
    length = this.length
    offset = 0
  // Buffer#write(string, encoding)
  } else if (length === undefined && typeof offset === 'string') {
    encoding = offset
    length = this.length
    offset = 0
  // Buffer#write(string, offset[, length][, encoding])
  } else if (isFinite(offset)) {
    offset = offset | 0
    if (isFinite(length)) {
      length = length | 0
      if (encoding === undefined) encoding = 'utf8'
    } else {
      encoding = length
      length = undefined
    }
  // legacy write(string, encoding, offset, length) - remove in v0.13
  } else {
    var swap = encoding
    encoding = offset
    offset = length | 0
    length = swap
  }

  var remaining = this.length - offset
  if (length === undefined || length > remaining) length = remaining

  if ((string.length > 0 && (length < 0 || offset < 0)) || offset > this.length) {
    throw new RangeError('attempt to write outside buffer bounds')
  }

  if (!encoding) encoding = 'utf8'

  var loweredCase = false
  for (;;) {
    switch (encoding) {
      case 'hex':
        return hexWrite(this, string, offset, length)

      case 'utf8':
      case 'utf-8':
        return utf8Write(this, string, offset, length)

      case 'ascii':
        return asciiWrite(this, string, offset, length)

      case 'binary':
        return binaryWrite(this, string, offset, length)

      case 'base64':
        // Warning: maxLength not taken into account in base64Write
        return base64Write(this, string, offset, length)

      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return ucs2Write(this, string, offset, length)

      default:
        if (loweredCase) throw new TypeError('Unknown encoding: ' + encoding)
        encoding = ('' + encoding).toLowerCase()
        loweredCase = true
    }
  }
}

Buffer.prototype.toJSON = function toJSON () {
  return {
    type: 'Buffer',
    data: Array.prototype.slice.call(this._arr || this, 0)
  }
}

function base64Slice (buf, start, end) {
  if (start === 0 && end === buf.length) {
    return base64.fromByteArray(buf)
  } else {
    return base64.fromByteArray(buf.slice(start, end))
  }
}

function utf8Slice (buf, start, end) {
  var res = ''
  var tmp = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; i++) {
    if (buf[i] <= 0x7F) {
      res += decodeUtf8Char(tmp) + String.fromCharCode(buf[i])
      tmp = ''
    } else {
      tmp += '%' + buf[i].toString(16)
    }
  }

  return res + decodeUtf8Char(tmp)
}

function asciiSlice (buf, start, end) {
  var ret = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; i++) {
    ret += String.fromCharCode(buf[i] & 0x7F)
  }
  return ret
}

function binarySlice (buf, start, end) {
  var ret = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; i++) {
    ret += String.fromCharCode(buf[i])
  }
  return ret
}

function hexSlice (buf, start, end) {
  var len = buf.length

  if (!start || start < 0) start = 0
  if (!end || end < 0 || end > len) end = len

  var out = ''
  for (var i = start; i < end; i++) {
    out += toHex(buf[i])
  }
  return out
}

function utf16leSlice (buf, start, end) {
  var bytes = buf.slice(start, end)
  var res = ''
  for (var i = 0; i < bytes.length; i += 2) {
    res += String.fromCharCode(bytes[i] + bytes[i + 1] * 256)
  }
  return res
}

Buffer.prototype.slice = function slice (start, end) {
  var len = this.length
  start = ~~start
  end = end === undefined ? len : ~~end

  if (start < 0) {
    start += len
    if (start < 0) start = 0
  } else if (start > len) {
    start = len
  }

  if (end < 0) {
    end += len
    if (end < 0) end = 0
  } else if (end > len) {
    end = len
  }

  if (end < start) end = start

  var newBuf
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    newBuf = Buffer._augment(this.subarray(start, end))
  } else {
    var sliceLen = end - start
    newBuf = new Buffer(sliceLen, undefined)
    for (var i = 0; i < sliceLen; i++) {
      newBuf[i] = this[i + start]
    }
  }

  if (newBuf.length) newBuf.parent = this.parent || this

  return newBuf
}

/*
 * Need to make sure that buffer isn't trying to write out of bounds.
 */
function checkOffset (offset, ext, length) {
  if ((offset % 1) !== 0 || offset < 0) throw new RangeError('offset is not uint')
  if (offset + ext > length) throw new RangeError('Trying to access beyond buffer length')
}

Buffer.prototype.readUIntLE = function readUIntLE (offset, byteLength, noAssert) {
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var val = this[offset]
  var mul = 1
  var i = 0
  while (++i < byteLength && (mul *= 0x100)) {
    val += this[offset + i] * mul
  }

  return val
}

Buffer.prototype.readUIntBE = function readUIntBE (offset, byteLength, noAssert) {
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) {
    checkOffset(offset, byteLength, this.length)
  }

  var val = this[offset + --byteLength]
  var mul = 1
  while (byteLength > 0 && (mul *= 0x100)) {
    val += this[offset + --byteLength] * mul
  }

  return val
}

Buffer.prototype.readUInt8 = function readUInt8 (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 1, this.length)
  return this[offset]
}

Buffer.prototype.readUInt16LE = function readUInt16LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  return this[offset] | (this[offset + 1] << 8)
}

Buffer.prototype.readUInt16BE = function readUInt16BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  return (this[offset] << 8) | this[offset + 1]
}

Buffer.prototype.readUInt32LE = function readUInt32LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return ((this[offset]) |
      (this[offset + 1] << 8) |
      (this[offset + 2] << 16)) +
      (this[offset + 3] * 0x1000000)
}

Buffer.prototype.readUInt32BE = function readUInt32BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset] * 0x1000000) +
    ((this[offset + 1] << 16) |
    (this[offset + 2] << 8) |
    this[offset + 3])
}

Buffer.prototype.readIntLE = function readIntLE (offset, byteLength, noAssert) {
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var val = this[offset]
  var mul = 1
  var i = 0
  while (++i < byteLength && (mul *= 0x100)) {
    val += this[offset + i] * mul
  }
  mul *= 0x80

  if (val >= mul) val -= Math.pow(2, 8 * byteLength)

  return val
}

Buffer.prototype.readIntBE = function readIntBE (offset, byteLength, noAssert) {
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var i = byteLength
  var mul = 1
  var val = this[offset + --i]
  while (i > 0 && (mul *= 0x100)) {
    val += this[offset + --i] * mul
  }
  mul *= 0x80

  if (val >= mul) val -= Math.pow(2, 8 * byteLength)

  return val
}

Buffer.prototype.readInt8 = function readInt8 (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 1, this.length)
  if (!(this[offset] & 0x80)) return (this[offset])
  return ((0xff - this[offset] + 1) * -1)
}

Buffer.prototype.readInt16LE = function readInt16LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  var val = this[offset] | (this[offset + 1] << 8)
  return (val & 0x8000) ? val | 0xFFFF0000 : val
}

Buffer.prototype.readInt16BE = function readInt16BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  var val = this[offset + 1] | (this[offset] << 8)
  return (val & 0x8000) ? val | 0xFFFF0000 : val
}

Buffer.prototype.readInt32LE = function readInt32LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset]) |
    (this[offset + 1] << 8) |
    (this[offset + 2] << 16) |
    (this[offset + 3] << 24)
}

Buffer.prototype.readInt32BE = function readInt32BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset] << 24) |
    (this[offset + 1] << 16) |
    (this[offset + 2] << 8) |
    (this[offset + 3])
}

Buffer.prototype.readFloatLE = function readFloatLE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)
  return ieee754.read(this, offset, true, 23, 4)
}

Buffer.prototype.readFloatBE = function readFloatBE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)
  return ieee754.read(this, offset, false, 23, 4)
}

Buffer.prototype.readDoubleLE = function readDoubleLE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 8, this.length)
  return ieee754.read(this, offset, true, 52, 8)
}

Buffer.prototype.readDoubleBE = function readDoubleBE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 8, this.length)
  return ieee754.read(this, offset, false, 52, 8)
}

function checkInt (buf, value, offset, ext, max, min) {
  if (!Buffer.isBuffer(buf)) throw new TypeError('buffer must be a Buffer instance')
  if (value > max || value < min) throw new RangeError('value is out of bounds')
  if (offset + ext > buf.length) throw new RangeError('index out of range')
}

Buffer.prototype.writeUIntLE = function writeUIntLE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) checkInt(this, value, offset, byteLength, Math.pow(2, 8 * byteLength), 0)

  var mul = 1
  var i = 0
  this[offset] = value & 0xFF
  while (++i < byteLength && (mul *= 0x100)) {
    this[offset + i] = (value / mul) & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeUIntBE = function writeUIntBE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) checkInt(this, value, offset, byteLength, Math.pow(2, 8 * byteLength), 0)

  var i = byteLength - 1
  var mul = 1
  this[offset + i] = value & 0xFF
  while (--i >= 0 && (mul *= 0x100)) {
    this[offset + i] = (value / mul) & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeUInt8 = function writeUInt8 (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 1, 0xff, 0)
  if (!Buffer.TYPED_ARRAY_SUPPORT) value = Math.floor(value)
  this[offset] = value
  return offset + 1
}

function objectWriteUInt16 (buf, value, offset, littleEndian) {
  if (value < 0) value = 0xffff + value + 1
  for (var i = 0, j = Math.min(buf.length - offset, 2); i < j; i++) {
    buf[offset + i] = (value & (0xff << (8 * (littleEndian ? i : 1 - i)))) >>>
      (littleEndian ? i : 1 - i) * 8
  }
}

Buffer.prototype.writeUInt16LE = function writeUInt16LE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 2, 0xffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = value
    this[offset + 1] = (value >>> 8)
  } else {
    objectWriteUInt16(this, value, offset, true)
  }
  return offset + 2
}

Buffer.prototype.writeUInt16BE = function writeUInt16BE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 2, 0xffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 8)
    this[offset + 1] = value
  } else {
    objectWriteUInt16(this, value, offset, false)
  }
  return offset + 2
}

function objectWriteUInt32 (buf, value, offset, littleEndian) {
  if (value < 0) value = 0xffffffff + value + 1
  for (var i = 0, j = Math.min(buf.length - offset, 4); i < j; i++) {
    buf[offset + i] = (value >>> (littleEndian ? i : 3 - i) * 8) & 0xff
  }
}

Buffer.prototype.writeUInt32LE = function writeUInt32LE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 4, 0xffffffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset + 3] = (value >>> 24)
    this[offset + 2] = (value >>> 16)
    this[offset + 1] = (value >>> 8)
    this[offset] = value
  } else {
    objectWriteUInt32(this, value, offset, true)
  }
  return offset + 4
}

Buffer.prototype.writeUInt32BE = function writeUInt32BE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 4, 0xffffffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 24)
    this[offset + 1] = (value >>> 16)
    this[offset + 2] = (value >>> 8)
    this[offset + 3] = value
  } else {
    objectWriteUInt32(this, value, offset, false)
  }
  return offset + 4
}

Buffer.prototype.writeIntLE = function writeIntLE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) {
    var limit = Math.pow(2, 8 * byteLength - 1)

    checkInt(this, value, offset, byteLength, limit - 1, -limit)
  }

  var i = 0
  var mul = 1
  var sub = value < 0 ? 1 : 0
  this[offset] = value & 0xFF
  while (++i < byteLength && (mul *= 0x100)) {
    this[offset + i] = ((value / mul) >> 0) - sub & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeIntBE = function writeIntBE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) {
    var limit = Math.pow(2, 8 * byteLength - 1)

    checkInt(this, value, offset, byteLength, limit - 1, -limit)
  }

  var i = byteLength - 1
  var mul = 1
  var sub = value < 0 ? 1 : 0
  this[offset + i] = value & 0xFF
  while (--i >= 0 && (mul *= 0x100)) {
    this[offset + i] = ((value / mul) >> 0) - sub & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeInt8 = function writeInt8 (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 1, 0x7f, -0x80)
  if (!Buffer.TYPED_ARRAY_SUPPORT) value = Math.floor(value)
  if (value < 0) value = 0xff + value + 1
  this[offset] = value
  return offset + 1
}

Buffer.prototype.writeInt16LE = function writeInt16LE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 2, 0x7fff, -0x8000)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = value
    this[offset + 1] = (value >>> 8)
  } else {
    objectWriteUInt16(this, value, offset, true)
  }
  return offset + 2
}

Buffer.prototype.writeInt16BE = function writeInt16BE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 2, 0x7fff, -0x8000)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 8)
    this[offset + 1] = value
  } else {
    objectWriteUInt16(this, value, offset, false)
  }
  return offset + 2
}

Buffer.prototype.writeInt32LE = function writeInt32LE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = value
    this[offset + 1] = (value >>> 8)
    this[offset + 2] = (value >>> 16)
    this[offset + 3] = (value >>> 24)
  } else {
    objectWriteUInt32(this, value, offset, true)
  }
  return offset + 4
}

Buffer.prototype.writeInt32BE = function writeInt32BE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000)
  if (value < 0) value = 0xffffffff + value + 1
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 24)
    this[offset + 1] = (value >>> 16)
    this[offset + 2] = (value >>> 8)
    this[offset + 3] = value
  } else {
    objectWriteUInt32(this, value, offset, false)
  }
  return offset + 4
}

function checkIEEE754 (buf, value, offset, ext, max, min) {
  if (value > max || value < min) throw new RangeError('value is out of bounds')
  if (offset + ext > buf.length) throw new RangeError('index out of range')
  if (offset < 0) throw new RangeError('index out of range')
}

function writeFloat (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    checkIEEE754(buf, value, offset, 4, 3.4028234663852886e+38, -3.4028234663852886e+38)
  }
  ieee754.write(buf, value, offset, littleEndian, 23, 4)
  return offset + 4
}

Buffer.prototype.writeFloatLE = function writeFloatLE (value, offset, noAssert) {
  return writeFloat(this, value, offset, true, noAssert)
}

Buffer.prototype.writeFloatBE = function writeFloatBE (value, offset, noAssert) {
  return writeFloat(this, value, offset, false, noAssert)
}

function writeDouble (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    checkIEEE754(buf, value, offset, 8, 1.7976931348623157E+308, -1.7976931348623157E+308)
  }
  ieee754.write(buf, value, offset, littleEndian, 52, 8)
  return offset + 8
}

Buffer.prototype.writeDoubleLE = function writeDoubleLE (value, offset, noAssert) {
  return writeDouble(this, value, offset, true, noAssert)
}

Buffer.prototype.writeDoubleBE = function writeDoubleBE (value, offset, noAssert) {
  return writeDouble(this, value, offset, false, noAssert)
}

// copy(targetBuffer, targetStart=0, sourceStart=0, sourceEnd=buffer.length)
Buffer.prototype.copy = function copy (target, targetStart, start, end) {
  if (!start) start = 0
  if (!end && end !== 0) end = this.length
  if (targetStart >= target.length) targetStart = target.length
  if (!targetStart) targetStart = 0
  if (end > 0 && end < start) end = start

  // Copy 0 bytes; we're done
  if (end === start) return 0
  if (target.length === 0 || this.length === 0) return 0

  // Fatal error conditions
  if (targetStart < 0) {
    throw new RangeError('targetStart out of bounds')
  }
  if (start < 0 || start >= this.length) throw new RangeError('sourceStart out of bounds')
  if (end < 0) throw new RangeError('sourceEnd out of bounds')

  // Are we oob?
  if (end > this.length) end = this.length
  if (target.length - targetStart < end - start) {
    end = target.length - targetStart + start
  }

  var len = end - start

  if (len < 1000 || !Buffer.TYPED_ARRAY_SUPPORT) {
    for (var i = 0; i < len; i++) {
      target[i + targetStart] = this[i + start]
    }
  } else {
    target._set(this.subarray(start, start + len), targetStart)
  }

  return len
}

// fill(value, start=0, end=buffer.length)
Buffer.prototype.fill = function fill (value, start, end) {
  if (!value) value = 0
  if (!start) start = 0
  if (!end) end = this.length

  if (end < start) throw new RangeError('end < start')

  // Fill 0 bytes; we're done
  if (end === start) return
  if (this.length === 0) return

  if (start < 0 || start >= this.length) throw new RangeError('start out of bounds')
  if (end < 0 || end > this.length) throw new RangeError('end out of bounds')

  var i
  if (typeof value === 'number') {
    for (i = start; i < end; i++) {
      this[i] = value
    }
  } else {
    var bytes = utf8ToBytes(value.toString())
    var len = bytes.length
    for (i = start; i < end; i++) {
      this[i] = bytes[i % len]
    }
  }

  return this
}

/**
 * Creates a new `ArrayBuffer` with the *copied* memory of the buffer instance.
 * Added in Node 0.12. Only available in browsers that support ArrayBuffer.
 */
Buffer.prototype.toArrayBuffer = function toArrayBuffer () {
  if (typeof Uint8Array !== 'undefined') {
    if (Buffer.TYPED_ARRAY_SUPPORT) {
      return (new Buffer(this)).buffer
    } else {
      var buf = new Uint8Array(this.length)
      for (var i = 0, len = buf.length; i < len; i += 1) {
        buf[i] = this[i]
      }
      return buf.buffer
    }
  } else {
    throw new TypeError('Buffer.toArrayBuffer not supported in this browser')
  }
}

// HELPER FUNCTIONS
// ================

var BP = Buffer.prototype

/**
 * Augment a Uint8Array *instance* (not the Uint8Array class!) with Buffer methods
 */
Buffer._augment = function _augment (arr) {
  arr.constructor = Buffer
  arr._isBuffer = true

  // save reference to original Uint8Array set method before overwriting
  arr._set = arr.set

  // deprecated, will be removed in node 0.13+
  arr.get = BP.get
  arr.set = BP.set

  arr.write = BP.write
  arr.toString = BP.toString
  arr.toLocaleString = BP.toString
  arr.toJSON = BP.toJSON
  arr.equals = BP.equals
  arr.compare = BP.compare
  arr.indexOf = BP.indexOf
  arr.copy = BP.copy
  arr.slice = BP.slice
  arr.readUIntLE = BP.readUIntLE
  arr.readUIntBE = BP.readUIntBE
  arr.readUInt8 = BP.readUInt8
  arr.readUInt16LE = BP.readUInt16LE
  arr.readUInt16BE = BP.readUInt16BE
  arr.readUInt32LE = BP.readUInt32LE
  arr.readUInt32BE = BP.readUInt32BE
  arr.readIntLE = BP.readIntLE
  arr.readIntBE = BP.readIntBE
  arr.readInt8 = BP.readInt8
  arr.readInt16LE = BP.readInt16LE
  arr.readInt16BE = BP.readInt16BE
  arr.readInt32LE = BP.readInt32LE
  arr.readInt32BE = BP.readInt32BE
  arr.readFloatLE = BP.readFloatLE
  arr.readFloatBE = BP.readFloatBE
  arr.readDoubleLE = BP.readDoubleLE
  arr.readDoubleBE = BP.readDoubleBE
  arr.writeUInt8 = BP.writeUInt8
  arr.writeUIntLE = BP.writeUIntLE
  arr.writeUIntBE = BP.writeUIntBE
  arr.writeUInt16LE = BP.writeUInt16LE
  arr.writeUInt16BE = BP.writeUInt16BE
  arr.writeUInt32LE = BP.writeUInt32LE
  arr.writeUInt32BE = BP.writeUInt32BE
  arr.writeIntLE = BP.writeIntLE
  arr.writeIntBE = BP.writeIntBE
  arr.writeInt8 = BP.writeInt8
  arr.writeInt16LE = BP.writeInt16LE
  arr.writeInt16BE = BP.writeInt16BE
  arr.writeInt32LE = BP.writeInt32LE
  arr.writeInt32BE = BP.writeInt32BE
  arr.writeFloatLE = BP.writeFloatLE
  arr.writeFloatBE = BP.writeFloatBE
  arr.writeDoubleLE = BP.writeDoubleLE
  arr.writeDoubleBE = BP.writeDoubleBE
  arr.fill = BP.fill
  arr.inspect = BP.inspect
  arr.toArrayBuffer = BP.toArrayBuffer

  return arr
}

var INVALID_BASE64_RE = /[^+\/0-9A-z\-]/g

function base64clean (str) {
  // Node strips out invalid characters like \n and \t from the string, base64-js does not
  str = stringtrim(str).replace(INVALID_BASE64_RE, '')
  // Node converts strings with length < 2 to ''
  if (str.length < 2) return ''
  // Node allows for non-padded base64 strings (missing trailing ===), base64-js does not
  while (str.length % 4 !== 0) {
    str = str + '='
  }
  return str
}

function stringtrim (str) {
  if (str.trim) return str.trim()
  return str.replace(/^\s+|\s+$/g, '')
}

function toHex (n) {
  if (n < 16) return '0' + n.toString(16)
  return n.toString(16)
}

function utf8ToBytes (string, units) {
  units = units || Infinity
  var codePoint
  var length = string.length
  var leadSurrogate = null
  var bytes = []
  var i = 0

  for (; i < length; i++) {
    codePoint = string.charCodeAt(i)

    // is surrogate component
    if (codePoint > 0xD7FF && codePoint < 0xE000) {
      // last char was a lead
      if (leadSurrogate) {
        // 2 leads in a row
        if (codePoint < 0xDC00) {
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
          leadSurrogate = codePoint
          continue
        } else {
          // valid surrogate pair
          codePoint = leadSurrogate - 0xD800 << 10 | codePoint - 0xDC00 | 0x10000
          leadSurrogate = null
        }
      } else {
        // no lead yet

        if (codePoint > 0xDBFF) {
          // unexpected trail
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
          continue
        } else if (i + 1 === length) {
          // unpaired lead
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
          continue
        } else {
          // valid lead
          leadSurrogate = codePoint
          continue
        }
      }
    } else if (leadSurrogate) {
      // valid bmp char, but last char was a lead
      if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
      leadSurrogate = null
    }

    // encode utf8
    if (codePoint < 0x80) {
      if ((units -= 1) < 0) break
      bytes.push(codePoint)
    } else if (codePoint < 0x800) {
      if ((units -= 2) < 0) break
      bytes.push(
        codePoint >> 0x6 | 0xC0,
        codePoint & 0x3F | 0x80
      )
    } else if (codePoint < 0x10000) {
      if ((units -= 3) < 0) break
      bytes.push(
        codePoint >> 0xC | 0xE0,
        codePoint >> 0x6 & 0x3F | 0x80,
        codePoint & 0x3F | 0x80
      )
    } else if (codePoint < 0x200000) {
      if ((units -= 4) < 0) break
      bytes.push(
        codePoint >> 0x12 | 0xF0,
        codePoint >> 0xC & 0x3F | 0x80,
        codePoint >> 0x6 & 0x3F | 0x80,
        codePoint & 0x3F | 0x80
      )
    } else {
      throw new Error('Invalid code point')
    }
  }

  return bytes
}

function asciiToBytes (str) {
  var byteArray = []
  for (var i = 0; i < str.length; i++) {
    // Node's code seems to be doing this and not & 0x7F..
    byteArray.push(str.charCodeAt(i) & 0xFF)
  }
  return byteArray
}

function utf16leToBytes (str, units) {
  var c, hi, lo
  var byteArray = []
  for (var i = 0; i < str.length; i++) {
    if ((units -= 2) < 0) break

    c = str.charCodeAt(i)
    hi = c >> 8
    lo = c % 256
    byteArray.push(lo)
    byteArray.push(hi)
  }

  return byteArray
}

function base64ToBytes (str) {
  return base64.toByteArray(base64clean(str))
}

function blitBuffer (src, dst, offset, length) {
  for (var i = 0; i < length; i++) {
    if ((i + offset >= dst.length) || (i >= src.length)) break
    dst[i + offset] = src[i]
  }
  return i
}

function decodeUtf8Char (str) {
  try {
    return decodeURIComponent(str)
  } catch (err) {
    return String.fromCharCode(0xFFFD) // UTF 8 invalid char
  }
}

},{"base64-js":2,"ieee754":3,"is-array":4}],2:[function(require,module,exports){
var lookup = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

;(function (exports) {
	'use strict';

  var Arr = (typeof Uint8Array !== 'undefined')
    ? Uint8Array
    : Array

	var PLUS   = '+'.charCodeAt(0)
	var SLASH  = '/'.charCodeAt(0)
	var NUMBER = '0'.charCodeAt(0)
	var LOWER  = 'a'.charCodeAt(0)
	var UPPER  = 'A'.charCodeAt(0)
	var PLUS_URL_SAFE = '-'.charCodeAt(0)
	var SLASH_URL_SAFE = '_'.charCodeAt(0)

	function decode (elt) {
		var code = elt.charCodeAt(0)
		if (code === PLUS ||
		    code === PLUS_URL_SAFE)
			return 62 // '+'
		if (code === SLASH ||
		    code === SLASH_URL_SAFE)
			return 63 // '/'
		if (code < NUMBER)
			return -1 //no match
		if (code < NUMBER + 10)
			return code - NUMBER + 26 + 26
		if (code < UPPER + 26)
			return code - UPPER
		if (code < LOWER + 26)
			return code - LOWER + 26
	}

	function b64ToByteArray (b64) {
		var i, j, l, tmp, placeHolders, arr

		if (b64.length % 4 > 0) {
			throw new Error('Invalid string. Length must be a multiple of 4')
		}

		// the number of equal signs (place holders)
		// if there are two placeholders, than the two characters before it
		// represent one byte
		// if there is only one, then the three characters before it represent 2 bytes
		// this is just a cheap hack to not do indexOf twice
		var len = b64.length
		placeHolders = '=' === b64.charAt(len - 2) ? 2 : '=' === b64.charAt(len - 1) ? 1 : 0

		// base64 is 4/3 + up to two characters of the original data
		arr = new Arr(b64.length * 3 / 4 - placeHolders)

		// if there are placeholders, only get up to the last complete 4 chars
		l = placeHolders > 0 ? b64.length - 4 : b64.length

		var L = 0

		function push (v) {
			arr[L++] = v
		}

		for (i = 0, j = 0; i < l; i += 4, j += 3) {
			tmp = (decode(b64.charAt(i)) << 18) | (decode(b64.charAt(i + 1)) << 12) | (decode(b64.charAt(i + 2)) << 6) | decode(b64.charAt(i + 3))
			push((tmp & 0xFF0000) >> 16)
			push((tmp & 0xFF00) >> 8)
			push(tmp & 0xFF)
		}

		if (placeHolders === 2) {
			tmp = (decode(b64.charAt(i)) << 2) | (decode(b64.charAt(i + 1)) >> 4)
			push(tmp & 0xFF)
		} else if (placeHolders === 1) {
			tmp = (decode(b64.charAt(i)) << 10) | (decode(b64.charAt(i + 1)) << 4) | (decode(b64.charAt(i + 2)) >> 2)
			push((tmp >> 8) & 0xFF)
			push(tmp & 0xFF)
		}

		return arr
	}

	function uint8ToBase64 (uint8) {
		var i,
			extraBytes = uint8.length % 3, // if we have 1 byte left, pad 2 bytes
			output = "",
			temp, length

		function encode (num) {
			return lookup.charAt(num)
		}

		function tripletToBase64 (num) {
			return encode(num >> 18 & 0x3F) + encode(num >> 12 & 0x3F) + encode(num >> 6 & 0x3F) + encode(num & 0x3F)
		}

		// go through the array every three bytes, we'll deal with trailing stuff later
		for (i = 0, length = uint8.length - extraBytes; i < length; i += 3) {
			temp = (uint8[i] << 16) + (uint8[i + 1] << 8) + (uint8[i + 2])
			output += tripletToBase64(temp)
		}

		// pad the end with zeros, but make sure to not forget the extra bytes
		switch (extraBytes) {
			case 1:
				temp = uint8[uint8.length - 1]
				output += encode(temp >> 2)
				output += encode((temp << 4) & 0x3F)
				output += '=='
				break
			case 2:
				temp = (uint8[uint8.length - 2] << 8) + (uint8[uint8.length - 1])
				output += encode(temp >> 10)
				output += encode((temp >> 4) & 0x3F)
				output += encode((temp << 2) & 0x3F)
				output += '='
				break
		}

		return output
	}

	exports.toByteArray = b64ToByteArray
	exports.fromByteArray = uint8ToBase64
}(typeof exports === 'undefined' ? (this.base64js = {}) : exports))

},{}],3:[function(require,module,exports){
exports.read = function (buffer, offset, isLE, mLen, nBytes) {
  var e, m
  var eLen = nBytes * 8 - mLen - 1
  var eMax = (1 << eLen) - 1
  var eBias = eMax >> 1
  var nBits = -7
  var i = isLE ? (nBytes - 1) : 0
  var d = isLE ? -1 : 1
  var s = buffer[offset + i]

  i += d

  e = s & ((1 << (-nBits)) - 1)
  s >>= (-nBits)
  nBits += eLen
  for (; nBits > 0; e = e * 256 + buffer[offset + i], i += d, nBits -= 8) {}

  m = e & ((1 << (-nBits)) - 1)
  e >>= (-nBits)
  nBits += mLen
  for (; nBits > 0; m = m * 256 + buffer[offset + i], i += d, nBits -= 8) {}

  if (e === 0) {
    e = 1 - eBias
  } else if (e === eMax) {
    return m ? NaN : ((s ? -1 : 1) * Infinity)
  } else {
    m = m + Math.pow(2, mLen)
    e = e - eBias
  }
  return (s ? -1 : 1) * m * Math.pow(2, e - mLen)
}

exports.write = function (buffer, value, offset, isLE, mLen, nBytes) {
  var e, m, c
  var eLen = nBytes * 8 - mLen - 1
  var eMax = (1 << eLen) - 1
  var eBias = eMax >> 1
  var rt = (mLen === 23 ? Math.pow(2, -24) - Math.pow(2, -77) : 0)
  var i = isLE ? 0 : (nBytes - 1)
  var d = isLE ? 1 : -1
  var s = value < 0 || (value === 0 && 1 / value < 0) ? 1 : 0

  value = Math.abs(value)

  if (isNaN(value) || value === Infinity) {
    m = isNaN(value) ? 1 : 0
    e = eMax
  } else {
    e = Math.floor(Math.log(value) / Math.LN2)
    if (value * (c = Math.pow(2, -e)) < 1) {
      e--
      c *= 2
    }
    if (e + eBias >= 1) {
      value += rt / c
    } else {
      value += rt * Math.pow(2, 1 - eBias)
    }
    if (value * c >= 2) {
      e++
      c /= 2
    }

    if (e + eBias >= eMax) {
      m = 0
      e = eMax
    } else if (e + eBias >= 1) {
      m = (value * c - 1) * Math.pow(2, mLen)
      e = e + eBias
    } else {
      m = value * Math.pow(2, eBias - 1) * Math.pow(2, mLen)
      e = 0
    }
  }

  for (; mLen >= 8; buffer[offset + i] = m & 0xff, i += d, m /= 256, mLen -= 8) {}

  e = (e << mLen) | m
  eLen += mLen
  for (; eLen > 0; buffer[offset + i] = e & 0xff, i += d, e /= 256, eLen -= 8) {}

  buffer[offset + i - d] |= s * 128
}

},{}],4:[function(require,module,exports){

/**
 * isArray
 */

var isArray = Array.isArray;

/**
 * toString
 */

var str = Object.prototype.toString;

/**
 * Whether or not the given `val`
 * is an array.
 *
 * example:
 *
 *        isArray([]);
 *        // > true
 *        isArray(arguments);
 *        // > false
 *        isArray('');
 *        // > false
 *
 * @param {mixed} val
 * @return {bool}
 */

module.exports = isArray || function (val) {
  return !! val && '[object Array]' == str.call(val);
};

},{}],5:[function(require,module,exports){
// shim for using process in browser

var process = module.exports = {};
var queue = [];
var draining = false;
var currentQueue;
var queueIndex = -1;

function cleanUpNextTick() {
    draining = false;
    if (currentQueue.length) {
        queue = currentQueue.concat(queue);
    } else {
        queueIndex = -1;
    }
    if (queue.length) {
        drainQueue();
    }
}

function drainQueue() {
    if (draining) {
        return;
    }
    var timeout = setTimeout(cleanUpNextTick);
    draining = true;

    var len = queue.length;
    while(len) {
        currentQueue = queue;
        queue = [];
        while (++queueIndex < len) {
            currentQueue[queueIndex].run();
        }
        queueIndex = -1;
        len = queue.length;
    }
    currentQueue = null;
    draining = false;
    clearTimeout(timeout);
}

process.nextTick = function (fun) {
    var args = new Array(arguments.length - 1);
    if (arguments.length > 1) {
        for (var i = 1; i < arguments.length; i++) {
            args[i - 1] = arguments[i];
        }
    }
    queue.push(new Item(fun, args));
    if (queue.length === 1 && !draining) {
        setTimeout(drainQueue, 0);
    }
};

// v8 likes predictible objects
function Item(fun, array) {
    this.fun = fun;
    this.array = array;
}
Item.prototype.run = function () {
    this.fun.apply(null, this.array);
};
process.title = 'browser';
process.browser = true;
process.env = {};
process.argv = [];
process.version = ''; // empty string to avoid regexp issues
process.versions = {};

function noop() {}

process.on = noop;
process.addListener = noop;
process.once = noop;
process.off = noop;
process.removeListener = noop;
process.removeAllListeners = noop;
process.emit = noop;

process.binding = function (name) {
    throw new Error('process.binding is not supported');
};

// TODO(shtylman)
process.cwd = function () { return '/' };
process.chdir = function (dir) {
    throw new Error('process.chdir is not supported');
};
process.umask = function() { return 0; };

},{}],6:[function(require,module,exports){
var Utils = require("./Utils.js");

var CONFIG = 
{
	timeouts : // in seconds
	{
		deviceTimeout : 60*5,
		animationFrame : Utils.mobileAndTabletCheck() ? 0.4 : 0.1,
		gpsLocationDebugShow : 4,		// time to show gps location (debug) info
		streamDataInterval : 10 		/* NORMAL 10 seconds */
	},
	distances : // in m
	{
		stayOnRoadTolerance : 500,	// 500m stay on road tolerance
		elapsedDirectionEpsilon : 500 // 500m direction tolerance, too fast movement will discard 
	},
	constraints : {
		backwardsEpsilonInMeter : 400, //220 m movement in the backward direction will not trigger next run counter increment		
		maxSpeed : 20,	//kmh
		maxParticipantStateHistory : 1000, // number of elements
		popupEnsureVisibleWidth : 200,
		popupEnsureVisibleHeight: 120
	},
	simulation : {
		pingInterval : 10,  // interval in seconds to ping with gps data
		gpsInaccuracy : 4, //8,  // error simulation in METER (look math.gpsInaccuracy, min 1/2)
		speedCoef : 100
	},
	settings : {
		noMiddleWare : 0, 	// SKIP middle ware node js app
		noInterpolation : 0	// 1 -> no interpolation only points
	},
	math : {
		projectionScaleY : 0.75,				// TODO EXPLAIN (rectange creation in world mercator coef y 
		gpsInaccuracy : 30,						 //TODO 13 min ? 
		speedAndAccelerationAverageDegree : 2,	// calculation based on N states (average) (MIN 2)
		displayDelay : 35,						// display delay in SECONDS
		interpolateGPSAverage : 0 // number of recent values to calculate average gps for position (smoothing the curve.min 0 = NO,1 = 2 values (current and last))
	},
	constants : 
	{
		ageGroups :  
		[
		 {
			 from : null,
			 to : 8, 
			 code : "FirstAgeGroup"
		 }
		 ,{
			 from : 8,
			 to : 40, 
			 code : "MiddleAgeGroup"
		 }
		 ,{
			 from : 40,
			 to : null, 
			 code : "LastAgeGroup"
		 }
		]
	},

	event : {
		beginTimestamp : (new Date()).getTime(),
		duration : 60, //MINUTES
		id : 3
	},

	server : {
		prefix : "/triathlon/"
	},
	
	appearance : {
		debug : 0,
		trackColorSwim : '#5676ff',
		trackColorBike : '#E20074',
		trackColorRun :  '#079f36',

		// Note the sequence is always Swim-Bike-Run - so 2 change-points
		// TODO Rumen - add scale here, not in Styles.js
		imageStart : "img/start.png",
		imageFinish : "img/finish.png",
		imageCam : "img/camera.svg",
		imageCheckpointSwimBike : "img/wz1.svg",
		imageCheckpointBikeRun : "img/wz2.svg",
		isShowCheckpointImage : false, /* show an image on the checkpoints (e.g on the changing WZ points */
		isShowCheckpoint : false,  /* show an square on the same color on the checkpoints, only if isShowCheckpointImage is not true*/

        // the distance between the direction icons - in pixels,
        // if set non-positive value (0 or less) then don't show them at all
		//directionIconBetween : 200
		directionIconBetween : -1
	},

    hotspot : {
        cam : {image :"img/camera.svg"},  // use the same image for static cameras as for the moving ones
		camSwimBike : {image : "img/wz1.svg"},
		camBikeRun : {image : "img/wz2.svg"},
        water : {image : "img/water.svg"},
        uturn : {image : "img/uturn.svg"},

		km10 : {image : "img/10km.svg", scale : 1.5},
		km20 : {image : "img/20km.svg", scale : 1.5},
		km30 : {image : "img/30km.svg", scale : 1.5},
		km40 : {image : "img/40km.svg", scale : 1.5},
		km60 : {image : "img/60km.svg", scale : 1.5},
		km80 : {image : "img/80km.svg", scale : 1.5},
		km100 : {image : "img/100km.svg", scale : 1.5},
		km120 : {image : "img/120km.svg", scale : 1.5},
		km140 : {image : "img/140km.svg", scale : 1.5},
		km160 : {image : "img/160km.svg", scale : 1.5},
		km180 : {image : "img/180km.svg", scale : 1.5}
    }
};

for (var i in CONFIG)
	exports[i]=CONFIG[i];

},{"./Utils.js":16}],7:[function(require,module,exports){
var Utils=require('./Utils');
var STYLES=require('./Styles');
require('joose');
require('./Track');
require('./LiveStream');
var CONFIG = require("./Config");

Class("Gui", 
{
    //--------------------------------------
	// ALL COORDINATES ARE IN WORLD MERCATOR
    //--------------------------------------
    has: 
	{
    	isDebug : {
    		is : "rw",
    		init : !Utils.mobileAndTabletCheck() && CONFIG.appearance.debug
    	},
		isWidget : {
			init : false
		},
		isDebugShowPosition : {
			// if set to true it will add an absolute element showing the coordinates above the mouse location
			init : false
		},
		receiverOnMapClick : {
			is : "rw",
			init : []
		},
        width : {
            is:   "rw",
            init: 750
        },
        height: {
            is:   "rw",
            init: 500
        },
		track : {
			is:   "rw"
		},
		elementId : {
			is : "rw",
			init : "map"
		},
		initialPos : {	
			is : "rw",
			init : null
		},
		initialZoom : {	
			is : "rw",
			init : 10
		},
		isSkipExtent : {
			is : "rw",
			init : false
		},
		bingMapKey : {
			is : "rw",
			init : 'Aijt3AsWOME3hPEE_HqRlUKdcBKqe8dGRZH_v-L3H_FF64svXMbkr1T6u_WASoet'
		},
		//-------------------
		map : {
			is : "rw",
			init : null
		},
		trackLayer : {
			is : "rw",
			init : null
		},
        hotspotsLayer : {
			is : "rw",
			init : null
		},
        camsLayer : {
			is : "rw",
			init : null
		},
		participantsLayer : {
			is : "rw",
			init : null
		},
		debugLayerGPS : {
			is : "rw",
			init : null
		},	
		testLayer : {
			is : "rw",
			init : null
		},	
		testLayer1 : {
			is : "rw",
			init : null
		},	
		testLayer2 : {
			is : "rw",
			init : null
		},	
		
		selectedParticipant1 : {
			is : "rw",
			init : null
		},
		selectedParticipant2 : {
			is : "rw",
			init : null
		},
		popup1 : {
			is : "rw",
			init : null
		},
		popup2 : {
			is : "rw",
			init : null
		},
		isShowSwim : {
			is : "rw",
			init : true
		},
		isShowBike : {
			is : "rw",
			init : true
		},
		isShowRun : {
			is : "rw",
			init : true
		},
		selectNum : {
			is : "rw",
			init : 1
		},
        liveStream : {
            init: null
        },
		displayMode : {			
			is : "rw",
			init : "nearest"			//nearest,linear,tracking
		}
    },
    //--------------------------------------
	methods: 
	{
        init: function (params)  
		{
			// if in widget mode then disable debug
			if (this.isWidget) {
				this.isDebug = false;
			}

			var defPos = [0,0];
			if (this.initialPos) {
				defPos = this.initialPos;
			} else if (TRACK.getRoute() && TRACK.getRoute().length > 1) {
				defPos = TRACK.getRoute()[0];
			}
			//---------------------------------------------
			var extent = this.isSkipExtent ? null : TRACK.getRoute() && TRACK.getRoute().length > 1 ? ol.proj.transformExtent( (new ol.geom.LineString(TRACK.getRoute())).getExtent() , 'EPSG:4326', 'EPSG:3857') : null;
			this.trackLayer = new ol.layer.Vector({
			  source: new ol.source.Vector(),
			  style : STYLES["track"]
			});
			this.hotspotsLayer = new ol.layer.Vector({
			  source: new ol.source.Vector(),
			  style : STYLES["hotspot"]
			});
			this.participantsLayer = new ol.layer.Vector({
			  source: new ol.source.Vector(),
			  style : STYLES["participant"]
			});
			this.camsLayer = new ol.layer.Vector({
				source: new ol.source.Vector(),
				style : STYLES["cam"]
			});
			if (this.isDebug) 
			{
				this.debugLayerGPS = new ol.layer.Vector({
					  source: new ol.source.Vector(),
					  style : STYLES["debugGPS"]
				});
				this.testLayer = new ol.layer.Vector({
					  source: new ol.source.Vector(),
					  style : STYLES["test"]
				});
				this.testLayer1 = new ol.layer.Vector({
					  source: new ol.source.Vector(),
					  style : STYLES["test1"]
				});
				this.testLayer2 = new ol.layer.Vector({
					  source: new ol.source.Vector(),
				  	style : STYLES["test2"]
				});
			}
			//--------------------------------------------------------------
			var ints = [];
			this.popup1 = new ol.Overlay.Popup({ani:false,panMapIfOutOfView : false});
			this.popup2 = new ol.Overlay.Popup({ani:false,panMapIfOutOfView : false});
			this.popup2.setOffset([0,175]);
			this.map = new ol.Map({
			  renderer : "canvas",
			  target: 'map',
			  layers: [
			           new ol.layer.Tile({
			               source: new ol.source.OSM()
			           }),
					this.trackLayer,
					this.hotspotsLayer,
					this.camsLayer,
					this.participantsLayer
			  ],
			  controls: this.isWidget ? [] : ol.control.defaults(),
			  view: new ol.View({
				center: ol.proj.transform(defPos, 'EPSG:4326', 'EPSG:3857'),
				zoom: this.initialZoom,
				minZoom: this.isWidget ? this.initialZoom : 8,
				maxZoom: this.isWidget ? this.initialZoom : (CONFIG.appearance.debug ? 20 : 17),
				extent : extent ? extent : undefined
			  })
			});
			
			for (var i=0;i<ints.length;i++)
				this.map.addInteraction(ints[i]);
			this.map.addOverlay(this.popup1);
			this.map.addOverlay(this.popup2);
			if (this.isDebug) { 
				this.map.addLayer(this.debugLayerGPS);
				this.map.addLayer(this.testLayer);
				this.map.addLayer(this.testLayer1);
				this.map.addLayer(this.testLayer2);
			}
			TRACK.init();
			this.addTrackFeature();
			//----------------------------------------------------
			if (!this.isWidget) {
				this.map.on('click', function (event) {
					TRACK.onMapClick(event);
					var selectedParticipants = [];
					var selectedHotspot = null;
					this.map.forEachFeatureAtPixel(event.pixel, function (feature, layer) {
						if (layer == this.participantsLayer) {
							selectedParticipants.push(feature);
						} else if (layer == this.hotspotsLayer) {
							// allow only one hotspot to be selected at a time
							if (!selectedHotspot)
								selectedHotspot = feature;
						}
					}, this);

					// first if there are selected participants then show their popups
					// and only if there are not use the selected hotspot if there's any
					if (selectedParticipants.length) {
						if (this.selectedParticipant1 == null) {
							var feat = this.getSelectedParticipantFromArrayCyclic(selectedParticipants);
							if (feat)
								this.setSelectedParticipant1(feat.participant);
							else
								this.setSelectedParticipant1(null);
							this.selectNum = 0;
						} else if (this.selectedParticipant2 == null) {
							var feat = this.getSelectedParticipantFromArrayCyclic(selectedParticipants);
							if (feat)
								this.setSelectedParticipant2(feat.participant);
							else
								this.setSelectedParticipant2(null);
							this.selectNum = 1;
						} else {
							this.selectNum = (this.selectNum + 1) % 2;
							if (this.selectNum == 0) {
								var feat = this.getSelectedParticipantFromArrayCyclic(selectedParticipants);
								if (feat)
									this.setSelectedParticipant1(feat.participant);
								else
									this.setSelectedParticipant1(null);
							} else {
								var feat = this.getSelectedParticipantFromArrayCyclic(selectedParticipants);
								if (feat)
									this.setSelectedParticipant2(feat.participant);
								else
									this.setSelectedParticipant2(null);
							}
						}
					} else {
						this.setSelectedParticipant1(null);
						this.setSelectedParticipant2(null);

						if (selectedHotspot) {
							selectedHotspot.hotspot.onClick();
						}
					}
				}, this);

				// change mouse cursor when over specific features
				var self = this;
				$(this.map.getViewport()).on('mousemove', function (e) {
					var pixel = self.map.getEventPixel(e.originalEvent);
					var isClickable = self.map.forEachFeatureAtPixel(pixel, function (feature, layer) {
						if (layer === self.participantsLayer || layer === self.camsLayer) {
							// all participants and moving cameras are clickable
							return true;
						} else if (layer === self.hotspotsLayer) {
							// get "clickability" from the hotspot
							return feature.hotspot.isClickable();
						}
					});
					self.map.getViewport().style.cursor = isClickable ? 'pointer' : '';
				});
			}
			//-----------------------------------------------------
			/*if (!this._animationInit) {
				this._animationInit=true;
				setInterval(this.onAnimation.bind(this), 1000*CONFIG.timeouts.animationFrame );
			}*/

			// if this is ON then it will show the coordinates position under the mouse location
			if (this.isDebugShowPosition) {
				$("#map").append('<p id="debugShowPosition">EPSG:3857 <span id="mouse3857"></span> &nbsp; EPSG:4326 <span id="mouse4326"></span>');
				this.map.on('pointermove', function(event) {
					var coord3857 = event.coordinate;
					var coord4326 = ol.proj.transform(coord3857, 'EPSG:3857', 'EPSG:4326');
					$('#mouse3857').text(ol.coordinate.toStringXY(coord3857, 2));
					$('#mouse4326').text(ol.coordinate.toStringXY(coord4326, 15));
				});
			}

			// pass the id of the DOM element
			this.liveStream = new LiveStream({id : "liveStream"});
        },
		
        
        addTrackFeature : function() {
        	TRACK.init();
        	if (TRACK.feature) {
        		var ft = this.trackLayer.getSource().getFeatures();
        		var ok=false;
        		for (var i=0;i<ft.length;i++) 
        		{
        			if (ft[i] == TRACK.feature)
        			{
        				ok=true;
        				break;
        			}
        		}
        		if (!ok)
        			this.trackLayer.getSource().addFeature(TRACK.feature);
        	}
        },
        zoomToTrack : function() {
            var extent = TRACK.getRoute() && TRACK.getRoute().length > 1 ? ol.proj.transformExtent( (new ol.geom.LineString(TRACK.getRoute())).getExtent() , 'EPSG:4326', 'EPSG:3857') : null;
            if (extent)
            	this.map.getView().fitExtent(extent,this.map.getSize());
        },
        
        getSelectedParticipantFromArrayCyclic : function(features) {
    		var arr = [];
    		var tmap = {};
    		var crrPos = 0;
			var pos=null;
    		for (var i=0;i<features.length;i++) {
    			var feature = features[i];
    			var id = feature.participant.code;
    			arr.push(id);
    			tmap[id]=true;
				if (id == this.vr_lastselected) {
					pos=i;
				}
    		}
    		var same = this.vr_oldbestarr && pos != null; 
    		if (same) 
    		{
    			// all from the old contained in the new
    			for (var i=0;i<this.vr_oldbestarr.length;i++) 
    			{
    				if (!tmap[this.vr_oldbestarr[i]]) {
    					same=false;
    					break;
    				}
    			}
    		}
    		if (!same) {
    			this.vr_oldbestarr=arr;
    			this.vr_lastselected=arr[0];
    			return features[0];
    		} else {
    			this.vr_lastselected = pos > 0 ? arr[pos-1] : arr[arr.length-1];    			
        		var resultFeature;
    			for (var i=0;i<features.length;i++) 
        		{
        			var feature = features[i];
        			var id = feature.participant.code;
        			if (id == this.vr_lastselected) {
        				resultFeature=feature;
        				break;
        			}
        		}
                return resultFeature;
    		}
        },
        
		showError : function(msg,onCloseCallback)
		{
			alert("ERROR : "+msg);
			if (onCloseCallback) 
				onCloseCallback();
		},
		
		onAnimation : function(ctime)
		{
			if (ctime) 
			{
				var arr=[];
				for (var ip=0;ip<TRACK.participants.length;ip++)
				{
					var p = TRACK.participants[ip];
					if (p.isFavorite)
					{
						p.interpolate(ctime);
						// this will add in the ranking positing only the participants the has to be tracked
						// so moving cams are skipped
						if (!p.__skipTrackingPos)
							arr.push(ip);
					}
				}
				//-------------------------------------------------------
				// we have to sort them otherwise this __pos, __prev, __next are irrelevant
				arr.sort(function(ip1, id2){
					return TRACK.participants[id2].getElapsed() - TRACK.participants[ip1].getElapsed();
				});
				for (var ip=0;ip<arr.length;ip++)
				{
					TRACK.participants[arr[ip]].__pos=ip;
					if (ip == 0)
						delete TRACK.participants[arr[ip]].__prev;
					else
						TRACK.participants[arr[ip]].__prev=TRACK.participants[arr[ip-1]];
					if (ip == TRACK.participants.length-1)
						delete  TRACK.participants[arr[ip]].__next;
					else
						TRACK.participants[arr[ip]].__next=TRACK.participants[arr[ip+1]];
				}
			}
			//-------------------------------------------------------
			var timeSwitch = Math.round((new Date()).getTime()/(1000*5))%2;
			var toPan = [];
			//-------------------------------------------------------
			if (this.selectedParticipant1) 
			{
				var ctime = this.selectedParticipant1.__ctime;
				var spos = this.selectedParticipant1.getFeature().getGeometry().getCoordinates();
				if (!this.popup1.is_shown) {
				    this.popup1.show(spos, this.popup1.lastHTML=this.selectedParticipant1.getPopupHTML(ctime));
				    this.popup1.is_shown=1;
				} else {
					if (!this.popup1.getPosition() || this.popup1.getPosition()[0] != spos[0] || this.popup1.getPosition()[1] != spos[1])
					    this.popup1.setPosition(spos);
					if (!this.lastPopupReferesh1 || (new Date()).getTime() - this.lastPopupReferesh1 > 2000) 
					{
						this.lastPopupReferesh1=(new Date()).getTime();
					    var rr = this.selectedParticipant1.getPopupHTML(ctime);
					    if (rr != this.popup1.lastHTML) {
					    	this.popup1.lastHTML=rr;
						    this.popup1.content.innerHTML=rr; 
					    }					
					}
					toPan.push([this.popup1,spos]);
				}
			}
			if (this.selectedParticipant2) 
			{
				var ctime = this.selectedParticipant2.__ctime;
				var spos = this.selectedParticipant2.getFeature().getGeometry().getCoordinates();
				if (!this.popup2.is_shown) {
				    this.popup2.show(spos, this.popup2.lastHTML=this.selectedParticipant2.getPopupHTML(ctime));
				    this.popup2.is_shown=1;
				} else {
					if (!this.popup2.getPosition() || this.popup2.getPosition()[0] != spos[0] || this.popup2.getPosition()[1] != spos[1])
					    this.popup2.setPosition(spos);
					if (!this.lastPopupReferesh2 || (new Date()).getTime() - this.lastPopupReferesh2 > 2000) 
					{
						this.lastPopupReferesh2=(new Date()).getTime();
					    var rr = this.selectedParticipant2.getPopupHTML(ctime);
					    if (rr != this.popup2.lastHTML) {
					    	this.popup2.lastHTML=rr;
						    this.popup2.content.innerHTML=rr; 
					    }					
					}
					toPan.push([this.popup2,spos]);
				}
			}
			//-----------------------
			if (toPan.length == 1) {
				toPan[0][0].panIntoView_(toPan[0][1]);
			} else if (toPan.length == 2) {
				toPan[timeSwitch][0].panIntoView_(toPan[timeSwitch][1]);
			}
			//--------------------			
			if (this.isDebug)  
				this.doDebugAnimation();
		},
		
		setSelectedParticipant1 : function(part,center) {
			// TODO Rumen - merge setSelectedParticipant1 and setSelectedParticipant2 in only one method
			// TODO Rumen - and use only it - probably merge them together also with setSelectedParticipant
			if (this.selectedParticipant2 && this.selectedParticipant2 == part)
				return;
			this.selectedParticipant1=part;
			if (!part) {
				this.popup1.hide();
				delete this.popup1.is_shown;
			} else {
				this.lastPopupReferesh1=0;
				if (center && GUI.map && part.feature) {
					var x = (part.feature.getGeometry().getExtent()[0]+part.feature.getGeometry().getExtent()[2])/2;
					var y = (part.feature.getGeometry().getExtent()[1]+part.feature.getGeometry().getExtent()[3])/2;
					GUI.map.getView().setCenter([x,y]);
				}
			} 
		},

		setSelectedParticipant2 : function(part,center) {
			if (this.selectedParticipant1 && this.selectedParticipant1 == part)
				return;
			this.selectedParticipant2=part;
			if (!part) {
				this.popup2.hide();
				delete this.popup2.is_shown;
			} else {
				this.lastPopupReferesh2=0;
				if (center && GUI.map && part.feature) {
					var x = (part.feature.getGeometry().getExtent()[0]+part.feature.getGeometry().getExtent()[2])/2;
					var y = (part.feature.getGeometry().getExtent()[1]+part.feature.getGeometry().getExtent()[3])/2;
					GUI.map.getView().setCenter([x,y]);
				}
			} 
		},

		setSelectedParticipant : function(part) {
			if (!this.popup1.is_shown)  {
				this.setSelectedParticipant1(part, true);
			} else if (!this.popup2.is_shown) {
				this.setSelectedParticipant2(part, true);
			} else {
				this.setSelectedParticipant1(part, true);
			}
		},

		doDebugAnimation : function() 
		{
			var ctime = (new Date()).getTime();
			var todel=[];
			var rr = this.debugLayerGPS.getSource().getFeatures();
			for (var i=0;i<rr.length;i++)
			{
				var f = rr[i];
				if (ctime - f.timeCreated - CONFIG.math.displayDelay*1000 > CONFIG.timeouts.gpsLocationDebugShow*1000)
					todel.push(f);
				else
					f.changed();
			}
			if (todel.length) 
			{
				for (var i=0;i<todel.length;i++)
					this.debugLayerGPS.getSource().removeFeature(todel[i]);
			}
			//-------------------------------------------------------------
		},
		
		redraw : function() {
			this.getTrack().getFeature().changed();
		},

        /**
         * Show the live-streaming container. If the passed 'streamId' is valid then it opens its stream directly.
         * @param {String} [streamId]
         * @param {Function} [completeCallback]
         */
        showLiveStream : function(streamId, completeCallback) {
            this.liveStream.show(streamId, completeCallback);
        },

        /**
         * Toggle the live-streaming container container
		 * @param {Function} [completeCallback]
         */
        toggleLiveStream: function(completeCallback) {
            return this.liveStream.toggle(completeCallback);
        }
		
    }
});
},{"./Config":6,"./LiveStream":10,"./Styles":14,"./Track":15,"./Utils":16,"joose":21}],8:[function(require,module,exports){
require('joose');
require('./Point');
require('./Utils');

Class("HotSpot", {
    isa : Point,

    has : {
        type : {
            is : "ro",
            required : true,
            init : null
        },

        clickable : {
            init : false
        },

        liveStream : {
            init : null
        }
    },

    after : {
        init : function() {
            this.feature.hotspot=this;
            GUI.hotspotsLayer.getSource().addFeature(this.feature);
        }
    },

    methods : {
        onClick : function() {
            var isConsumed = false;

            if (this.clickable) {
                // for now only hotspots with attached live-stream can be clicked
                if (isDefined(this.liveStream)) {
                    GUI.showLiveStream(this.liveStream);
                    // well this event should be consumed and not handled any more (like when clicked on another feature
                    isConsumed = true;
                }
            }

            return isConsumed
        },

        isClickable : function() {
            return this.clickable;
        }

    }
});
},{"./Point":13,"./Utils":16,"joose":21}],9:[function(require,module,exports){
/*

	CUSTOMHACK IN jquery.fullPage.js
	TODO : FIX IN LATER RELEASES
	
	    function touchMoveHandler(event){
        	// HACK
        	if (this.__disable)
        		return;
        		
        ..
        function touchStartHandler(event) {
        	// HACK 
        	if (!$(event.target).is("h1")) {
        		this.__disable=1;
        		return;        	
        	}
        	this.__disable=0;
        ..
 * 
 */
//---------------------------------------------------------------------------------------------------------
require('./Track');
require('./Gui');
require('./Participant');
require('./MovingCam');
require('./HotSpot');
var STYLES=require('./Styles');
window.CONFIG = require('./Config');
var Utils = require('./Utils');
for (var e in Utils)
    window[e] = Utils[e];
//---------------------------------------------------------------------------------------------------------
function getSearchParameters() {
    var prmstr = window.location.search.substr(1);
    return prmstr != null && prmstr != "" ? transformToAssocArray(prmstr) : {};
}
function transformToAssocArray(prmstr) {
    var params = {};
    var prmarr = prmstr.split("&");
    for (var i = 0; i < prmarr.length; i++) {
        var tmparr = prmarr[i].split("=");
        params[tmparr[0]] = tmparr[1];
    }
    return params;
}
window.onOpen = function(id) {
	window.location.href="live.html?event="+encodeURIComponent(id);
}
var params = getSearchParameters();
//-----------------------------------------------
$.ajax({
    type: "GET",
    url: "/events",
    contentType: "application/json; charset=utf-8",
    dataType: "json",
    success: function(data)
    {
    	
    	var tt=[];
    	for (var e in data.data) 
    	{
    		var ev = data.data[e];
    		var track=JSON.parse(ev.track);        		
    		var extent = ol.proj.transformExtent( (new ol.geom.LineString(track)).getExtent() , 'EPSG:4326', 'EPSG:3857');
    		var h1t = "<div class='cnt' id='cnt"+e+"'>"+ev.code+"<div class='dur'>"+ev.startTime+"&nbsp;&nbsp;&nbsp;&nbsp;"+ev.endTime+"</div></div>";
    		var mdiv = $("#fullpage").append('<div class="section '+(e == 0 ? 'active' : '')+'" id="section'+e+'"><div class="pre" id="pre'+e+'"></div><div class="fre" id="fre'+e+'"><h1>'+h1t+'</h1></div><menu class="medium playbtn"><button class="play" onclick="onOpen(\''+ev.id+'\')"></button></menu></div>');
    		tt.push(ev.code);
			var raster = new ol.layer.Tile({source : new ol.source.OSM()/*,extent : extent*/ });
			var trackLayer = new ol.layer.Vector({
				  source: new ol.source.Vector(),
				  style : STYLES["track"]
				  //extent : extent
			});
			var map = new ol.Map({
				logo : false,
				interactions : ol.interaction.defaults({
					mouseWheelZoom : false
				}),
				target : 'pre' + e,
				layers : [ raster,trackLayer ],
				controls : ol.control.defaults(),
				view : new ol.View({
					center : [ 739218, 5906096 ],
					minZoom : 1,
					maxZoom : 17,
					zoom : 17
					//extent : extent
				})
			});
			//map.getView().fitExtent(extent, map.getSize());
			//-------
			var TRACK = new Track();
			TRACK.setBikeStartKM(parseFloat(ev.bikeStartKM));
	        TRACK.setRunStartKM(parseFloat(ev.runStartKM));
	        TRACK.setRoute(track);
	        window.GUI = new Object();
	        GUI.isShowSwim=true;
	        GUI.isShowBike=true;
	        GUI.isShowRun=true;
	        GUI.map=map;
	        TRACK.init();
	        trackLayer.getSource().addFeature(TRACK.feature);
	        //------------------------------------------------------
	        //pointer-events : none;
    	}
		$('#fullpage').fullpage({
			css3 : false,
			navigation : true,
			navigationPosition : 'right',
			navigationTooltips : tt
		});
   	 	$(".fre,h1").css("pointer-events","none");
        if(! /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ) {
       } else {
    	   // MOBILE      	   
       }
	},
	failure : function(errMsg) {
		console.error("ERROR get data from backend " + errMsg)
	}
});
},{"./Config":6,"./Gui":7,"./HotSpot":8,"./MovingCam":11,"./Participant":12,"./Styles":14,"./Track":15,"./Utils":16}],10:[function(require,module,exports){
require('joose');
require('./Utils');

Class("LiveStream", {
    has : {
        _$comp : {
            init: function(config) {
                return $('#' + config.id);
            }
        },

        _isShown : {
           init : false
        },

        _isValid : {
            init : false
        }
    },
    methods: {
        initialize: function() {
            var liveStreams = window.LIVE_STREAMS;
            if (!liveStreams || liveStreams.length <= 0) {
                console.warn("No live streams set");
                return;
            }

            // initialize the streams
            var self = this;
            var i = 0;
            this._$comp.find(".liveStreamThumb").addClass("inactive").each(function() {
                var stream = liveStreams[i];
                i++;
                if (!stream) {
                    return false;
                }
                $(this).addClass("valid").data("id", stream.id).data("url", stream.url);

                // at least one valid thumb - so the whole LiveStream is valid
                self._isValid = true;
            }).filter(".valid").click(function() {
                var $this = $(this);

                // if clicked on the same active thumb then skip it
                if (!$this.hasClass("inactive")) {
                    return;
                }

               self._showStream($this);
            });
        },

        show: function(streamId, completeCallback) {
            if (!this._isValid)
               return;

            var $thumb = null;
            var $thumbs = this._$comp.find(".liveStreamThumb.valid");
            if (!isDefined(streamId)) {
                $thumb = $thumbs.eq(0);
            } else {
                $thumbs.each(function() {
                    if (streamId === $(this).data("id")) {
                        $thumb = $(this);
                        return false;
                    }
                });
            }

            if (!$thumb) {
                console.warn("No stream for id : " + streamId);
                return;
            }

            this._showStream($thumb, completeCallback);
        },

        /**
         *
         * @return {boolean}
         */
        toggle : function(completeCallback) {
            if (!this._isValid)
                return;

            // if shown hide otherwise show
            if (this._isShown)
                this._hide(completeCallback);
            else
                this.show(completeCallback);

            return this._isShown;
        },

        /* Private Methods */

        _hide : function(completeCallback) {
            var self = this;
            this._$comp.slideUp(400, function() {
                // stop the stream when whole panel has completed animation
                self._$comp.find(".liveStreamPlayer").empty();
                completeCallback();
            });

            this._isShown = false;
        },

        _showStream : function($thumb, completeCallback) {
            // toggle the "inactive" class
            this._$comp.find(".liveStreamThumb").addClass("inactive");
            $thumb.removeClass("inactive");

            // show the new stream
            var url = $thumb.data("url");
            var $player = this._$comp.find(".liveStreamPlayer");

            // width=490&height=275&
            // width="490" height="275"
            $player.html('<iframe src=' + url + '?autoPlay=true&mute=false" frameborder="0" scrolling="no" '+
            'allowfullscreen webkitallowfullscreen mozallowfullscreen oallowfullscreen msallowfullscreen></iframe>');

            // show if not already shown
            if (!this._isShown)
                this._$comp.slideDown(400, completeCallback);
            this._isShown = true;
        }
    }
});
},{"./Utils":16,"joose":21}],11:[function(require,module,exports){
require('joose');
require('./Participant');

Class("MovingCam", {
    isa : Participant,

    override : {
        initFeature : function() {
            this.feature.cam=this;
            GUI.camsLayer.getSource().addFeature(this.feature);
        }
    }
});
},{"./Participant":12,"joose":21}],12:[function(require,module,exports){
require('joose');
require('./Point');
var RBTree = require('bintrees').RBTree;
var CONFIG = require('./Config');
var Utils = require('./Utils');
var Intersection = require("kld-intersections").Intersection;
var Point2D = require("kld-intersections").Point2D;

var coefy = CONFIG.math.projectionScaleY;
Class("ParticipantState",
{
	has : {		
    	debugInfo : {
    		is : "rw",
    		init : null
    	},
		speed : {
			is : "rw",
			init : 0
		},
		elapsed : {
			is : "rw",
			init : 0
		},
	    timestamp : 
		{
	        is:   "rw",
	        init: 0	//lon lat world mercator
	    },
	    gps : {
	    	is:   "rw",
	        init: [0,0]	//lon lat world mercator
	    },
		freq : {
			is : "rw",
			init : 0
		},
		isSOS : {
			is : "rw",
			init : false
		},
		isDiscarded : {
			is : "rw",
			init : false
		},
		acceleration : {
			is : "rw",
			init : 0
		},
		alt : {
			is : "rw",
			init : 0
		},
		overallRank : {
			is : "rw",
			init : 0
		},
		genderRank : {
			is : "rw",
			init : 0
		},
		groupRank : {
			is : "rw",
			init : 0
		}
	}
});		
//----------------------------------------
Class("MovingPoint", {
	isa : Point,

	has : {
		deviceId : {
			is : "rw",
			init : "DEVICE_ID_NOT_SET"
		}
	}
});
//----------------------------------------
Class("Participant",
{
	isa : MovingPoint,

    has: 
	{	
    	lastPingTimestamp : {
    		is : "rw",
    		init : null
    	},
    	signalLostDelay : {
    		is : "rw",
    		init : null
    	},
    	lastRealDelay : {
    		is : "rw",
    		init : 0
    	},
    	track : {
    		is : "rw"
    	},
    	states : {
    		is : "rw",
    		init : new RBTree(function(a, b) { return a.timestamp - b.timestamp; })
    		
    	},
		isTimedOut : {
			is : "rw",
			init : false
		},
		isDiscarded : {
			is : "rw",
			init : false
		},
		isSOS : {
			is : "rw",
			init : false
		},
		icon: {
			is: "rw",
	        init: "img/player1.png"
	    },
	    image :	{
	        is:   "rw",
	        init: "img/profile1.png"  //100x100
	    },
	    color : {
	        is:   "rw",
	        init: "#fff"
	    },
	    ageGroup : {
	    	is : "rw",
	    	init : "-"
	    },
	    age : {
	    	is : "rw",
	    	init : "-"
	    },
	    rotation : {
	    	is : "rw",
	    	init : null 
	    }, 
	    elapsed : {
	    	is : "rw",
	    	init : 0
	    },
		seqId : {
			is : "rw",
			init : 0
		},
		country : {
			is : "rw",
			init : "Germany"
		},
		startPos : {
			is : "rw",
			init : 0
		},
		startTime : {
			is : "rw",
			init : 0
		},
		gender : {
			is : "rw",
			init : "M"
		},
		isFavorite : {
			is : "rw",
			init : false
		}
    },
	after : {
		init : function(pos, track) {
			this.setTrack(track);
			var ctime = (new Date()).getTime();
			var state = new ParticipantState({timestamp:1/* placeholder ctime not 0 */,gps:pos,isSOS:false,isDiscarded:false,freq:0,speed:0,elapsed:0});
			this.setElapsed(state.elapsed);
			this.setStates(new RBTree(function(a, b) { return a.timestamp - b.timestamp; }));
			this.states.insert(state);
			this.setIsSOS(false);
			this.setIsDiscarded(false);
			if (this.feature) {
				this.initFeature();
			}
			this.pingCalculated(state);
		}
	},
    //--------------------------------------
	methods: 
	{
		initFeature : function() {
			this.feature.participant=this;
			GUI.participantsLayer.getSource().addFeature(this.feature);
		},

		getInitials : function() {
			var tt = this.getCode().split(" ");
			if (tt.length >= 2) {
				return tt[0][0]+tt[1][0];
			}
			if (tt.length == 1)
				return tt[0][0];
			return "?";
		},
		//----------------------------------------------------------
		// main function call > 
		//----------------------------------------------------------
		updateFeature : function() {
			var mpos = ol.proj.transform(this.getPosition(), 'EPSG:4326', 'EPSG:3857');
			if (this.feature) 
				this.feature.setGeometry(new ol.geom.Point(mpos));
		},

		interpolate : function(ctime) 
		{
			this.__ctime=ctime;
			if (!this.states.size)
				return;		
			if (this.states.size < 2)
				return;
			var res = this.calculateElapsedAverage(ctime);
			if (res != null) 
			{
				var tres=res;
				if (tres == this.track.laps)
					tres=1.0;
				else
					tres=tres%1;
				var tka = this.track.getPositionAndRotationFromElapsed(tres);
				this.setPosition([tka[0],tka[1]]);
				this.setRotation(tka[2]);
				this.updateFeature();
				this.setElapsed(res);
			} 
		},

		min : function(ctime,proName) 
		{
			var it = this.states.lowerBound({timestamp:ctime});
			var sb = it.data();
			if (!sb)
				return null;
			if (sb.timestamp == ctime)
				return sb[proName];
			var sa = it.prev();
			if (sa) {
				return sa[proName];
			}
			return null;
		},
		
		max : function(ctime,proName) 
		{
			var it = this.states.lowerBound({timestamp:ctime});
			var sa = it.data();
			if (!sa)
				return null;
			return sa[proName];
		},

		avg2 : function(ctime,proName) 
		{

			var it = this.states.lowerBound({timestamp:ctime});
			var sb = it.data();
			if (sb) {
				if (sb.timestamp == ctime)
					return sb[proName];
				// sb >= 
				var sa = it.prev();
				if (sa) 
				{ 
					return [
					       	sa[proName][0]+(ctime-sa.timestamp) * (sb[proName][0]-sa[proName][0]) / (sb.timestamp-sa.timestamp),
					       	sa[proName][1]+(ctime-sa.timestamp) * (sb[proName][1]-sa[proName][1]) / (sb.timestamp-sa.timestamp)
				          ]; 
				}
			}
			return null;
		},

		avg : function(ctime,proName) 
		{
			var it = this.states.lowerBound({timestamp:ctime});
			var sb = it.data();
			if (sb) {
				if (sb.timestamp == ctime)
					return sb[proName];
				// sb >= 
				var sa = it.prev();
				if (sa) 
				{ 
					return sa[proName]+(ctime-sa.timestamp) * (sb[proName]-sa[proName]) / (sb.timestamp-sa.timestamp);
				}
			}
			return null;
		},

		calculateElapsedAverage : function(ctime) 
		{
			var res=null;
			var ok = false;
			var it = this.states.lowerBound({timestamp:ctime});
			var sb = it.data();
			if (sb) {
				if (sb.timestamp == ctime) {
					ok=true;
					res=sb.elapsed;
				} else {
					var sa = it.prev();
					if (sa) 
					{ 
						res = sa.elapsed+(ctime-sa.timestamp) * (sb.elapsed-sa.elapsed) / (sb.timestamp-sa.timestamp);
						//console.log("FOUND TIME INT ["+Utils.formatDateTimeSec(new Date(sa.timestamp))+" > "+Utils.formatDateTimeSec(new Date(sb.timestamp))+"]");
						ok=true;
					}
				}
			}
			if (!ok) {
				if (this.states.size >= 2)
					console.log(this.code+" | NOT FOUND TIME "+Utils.formatDateTimeSec(new Date(ctime)));
			} else
				this.setSignalLostDelay(null);
			return res;
		},
		
		pingCalculated : function(obj) {
			if (obj.discarded) {
				delete obj.discarded;
				this.setIsDiscarded(true);			
			}
			var state = new ParticipantState(obj);
			this.addState(state);
			var pos = state.gps;
			var coef = this.track.getTrackLengthInWGS84()/this.track.getTrackLength();
			var rr = CONFIG.math.gpsInaccuracy*coef;
			if (typeof GUI != "undefined" && GUI.isDebug) 
			{
				var ring = [
				            [pos[0]-rr, pos[1]-rr*coefy], [pos[0]+rr, pos[1]-rr*coefy],[pos[0]+rr, pos[1]+rr*coefy],[pos[0]-rr, pos[1]+rr*coefy],[pos[0]-rr, pos[1]-rr*coefy]
	 			];
				var polygon = new ol.geom.Polygon([ring]);
				polygon.transform('EPSG:4326', 'EPSG:3857');
				var feature = new ol.Feature(polygon);
				GUI.testLayer1.getSource().addFeature(feature);

				var mpos = ol.proj.transform(pos, 'EPSG:4326', 'EPSG:3857');
				var feature = new ol.Feature(new ol.geom.Point(mpos));
				GUI.testLayer.getSource().addFeature(feature);
				//console.log(this.getCode()+" | "+Math.round(state.elapsed*100.0*100.0)/100.0+"% PONG ["+pos[0]+","+pos[1]+"] "+new Date(state.timestamp)+" | "+state.debugInfo);
				//-------------------------------------------------------------
				if (state.debugInfo && state.debugInfo.point && state.debugInfo.best) 
				{
					var mpos = ol.proj.transform(state.debugInfo.point, 'EPSG:4326', 'EPSG:3857');
					var feature = new ol.Feature(new ol.geom.Point(mpos));
					if (this.__oldFeature1)
						GUI.testLayer2.getSource().removeFeature(this.__oldFeature1);
					GUI.testLayer2.getSource().addFeature(feature);
					feature.debugInfo=state.debugInfo;
					this.__oldFeature1=feature;

					var p1 = this.track.route[state.debugInfo.best];
					var p2 = this.track.route[state.debugInfo.best+1];
					var line = new ol.geom.LineString([ p1,p2 ]);
					line.transform('EPSG:4326', 'EPSG:3857');
					
					if (this.__oldFeature2)
						GUI.testLayer2.getSource().removeFeature(this.__oldFeature2);
					var feature = new ol.Feature(line);
					feature.debugInfo=state.debugInfo;
					GUI.testLayer2.getSource().addFeature(feature);
					this.__oldFeature2=feature;
				}
				while (GUI.testLayer1.getSource().getFeatures().length > 100)
					GUI.testLayer1.getSource().removeFeature(GUI.testLayer1.getSource().getFeatures()[0]);
				while (GUI.testLayer.getSource().getFeatures().length > 100)
					GUI.testLayer.getSource().removeFeature(GUI.testLayer.getSource().getFeatures()[0]);
			} 

		},

		getOverallRank : function(ctime) {
			var v = this.max(ctime,"overallRank");
			if (v)
				return v;
			return "-";
		},
		getGroupRank : function(ctime) {
			var v = this.max(ctime,"groupRank");
			if (v)
				return v;
			return "-";
		},
		getGenderRank : function(ctime) {
			var v = this.max(ctime,"genderRank");
			if (v)
				return v;
			return "-";
		},
		
		ping : function(pos,freq,isSOS,ctime,alt,overallRank,groupRank,genderRank,_ELAPSED)
		{
			var llt = (new Date()).getTime(); 
			if (!ctime)
				ctime=llt;
			this.setLastRealDelay(llt-ctime);
			this.setLastPingTimestamp(llt);			
			if (isSOS)
				this.setIsSOS(true);				
			else
				isSOS=this.getIsSOS();
			var state = new ParticipantState({timestamp:ctime,gps:pos,isSOS:isSOS,freq:freq,alt:alt,overallRank:overallRank,groupRank:groupRank,genderRank:genderRank});
			if (isSOS)
			{
				this.addState(state);
				return;
			}
			//----------------------------------------------------------
			var tracklen = this.track.getTrackLength();
			var tracklen1 = this.track.getTrackLengthInWGS84();
			var llstate=null;
			var lstate=null;
			if (this.states.size >= 1) 
			{
				var it = this.states.findIter(this.states.max());
				lstate=it.data();
				if (this.states.size >= 2) {
					llstate=it.prev();
				}
			}
			if (pos[0] == 0 && pos[1] == 0) {
				if (!lstate) 
					return;
				pos=lstate.gps;
			}
			//----------------------------------------------------------
			var best;
			var bestm=null;
			var lelp = lstate ? lstate.getElapsed() : 0;	// last elapsed
			var tg = this.track.route;
			//----------------------------------------------------------
			// NEW ALG
			var coef = this.track.getTrackLengthInWGS84()/this.track.getTrackLength();
			var minf = null;
			var rr = CONFIG.math.gpsInaccuracy*coef;
			var result = this.track.rTree.search([pos[0]-rr, pos[1]-rr*coefy, pos[0]+rr, pos[1]+rr*coefy]);
			if (!result)
				result=[];
			//console.log("!!! FOUND "+result.length+" | "+this.track.route.length+" | "+rr);
			//----------------------------------------------
			var debugInfo={};
			var mminf=null;
			for (var _i=0;_i<result.length;_i++)
			{
				var i = result[_i][4].index;
				//a1,a2,r1,r2
				var res = Intersection.intersectLineRectangle(
							new Point2D(tg[i][0],tg[i][1]),
							new Point2D(tg[i+1][0],tg[i+1][1]),
							new Point2D(pos[0]-rr,pos[1]-rr*coefy),
							new Point2D(pos[0]+rr,pos[1]+rr*coefy)
						);
				//console.log(res);
				if (res && res.points && res.points.length) 
				{
					//Utils.disp
					var d3 = Utils.WGS84SPHERE.haversineDistance(tg[i],tg[i+1]);
					res=res.points;
					for (var q=0;q<res.length;q++) 
					{
						//Utils.disp
						var d1 = Utils.WGS84SPHERE.haversineDistance([res[q].x,res[q].y],tg[i]);
						var el1 = this.track.distancesElapsed[i]+(this.track.distancesElapsed[i+1]-this.track.distancesElapsed[i])*d1/d3;
						if (el1 < lelp) {
							if (mminf == null || mminf > el1)
								mminf=el1;
							continue; 				// SKIP < LELP
						}
						if (minf == null || el1 < minf) {
							if (debugInfo) {
								debugInfo.best=i;
								debugInfo.point=[res[q].x,res[q].y];
								debugInfo.value=el1;
							}
							minf=el1;
						}
						console.log("Intersection candidate at "+i+" | "+Math.round(el1*100.0*100.0)/100.0);
					}
				}
				/*var res = Utils.interceptOnCircle(tg[i],tg[i+1],pos,rr);
				if (res) 
				{
					// has intersection (2 points)
					var d1 = Utils.distp(res[0],tg[i]);
					var d2 = Utils.distp(res[1],tg[i]);
					var d3 = Utils.distp(tg[i],tg[i+1]);
					var el1 = this.track.distancesElapsed[i]+(this.track.distancesElapsed[i+1]-this.track.distancesElapsed[i])*d1/d3;
					var el2 = this.track.distancesElapsed[i]+(this.track.distancesElapsed[i+1]-this.track.distancesElapsed[i])*d2/d3;
					//console.log("Intersection candidate at "+i+" | "+Math.round(el1*100.0*100.0)/100.0+" | "+Math.round(el2*100.0*100.0)/100.0+" | LELP="+Math.round(lelp*100.0*100.0)/100.0);
					if (el1 < lelp)
						el1=lelp;
					if (el2 < lelp)
						el2=lelp;
					//-------------------------------------------------------------------------------------------------
					if (minf == null || el1 < minf)
						minf=el1;
					if (el2 < minf)
						minf=el2;
				}*/
			}
			//---------------------------------------------			
			if (minf == null && mminf == null) 
			{
				console.error("MMINF NULL > DISCARD "+this.code+" | "+this.deviceId);
				this.setIsDiscarded(true);
				state.setIsDiscarded(true);
				state.setElapsed(lelp);
				this.addState(state);
				return;
			}
			/*if (minf == null)
				console.error("MINF NULL");
			else
				console.log(">> MINF "+Math.round(minf*100.0*100.0)/100.0);*/
			//---------------------------------------------			
			if (debugInfo)
				state.debugInfo=debugInfo;
			if (minf == null) {
				state.setElapsed(lelp);
				state.setIsDiscarded(this.getIsDiscarded());
				this.addState(state);
				return;
			}
			bestm=minf;
			if (bestm != null) 
			{
				var nel = bestm; 
				if (lstate) 
				{
					/*if (nel < lstate.getElapsed()) 
					{
						// WRONG DIRECTION OR GPS DATA WRONG? SKIP..
						if ((lstate.getElapsed()-nel)*tracklen < CONFIG.constraints.backwardsEpsilonInMeter) 
							return;
						do  
						{
							nel+=1.0;
						} while (nel < lstate.getElapsed());
					}*/
					//--------------------------------------------------------------
					if (nel > this.track.laps) {
						nel=this.track.laps;
					}
					//--------------------------------------------------------------
					llstate=null;
					lstate=null;
					if (this.states.size >= CONFIG.math.speedAndAccelerationAverageDegree) {
						var it = this.states.findIter(this.states.max());
						lstate=it.data(); 
						for (var kk=0;kk<CONFIG.math.speedAndAccelerationAverageDegree-1;kk++) {
							lstate=it.prev(); 
						}
					}
					if (this.states.size >= CONFIG.math.speedAndAccelerationAverageDegree*2) {
						var it = this.states.findIter(this.states.max());
						llstate=it.data(); 
						for (var kk=0;kk<CONFIG.math.speedAndAccelerationAverageDegree*2-1;kk++) {
							llstate=it.prev(); 
						}
					}
					if (lstate)  {
						state.setSpeed( tracklen * (nel-lstate.getElapsed()) * 1000 / (ctime-lstate.timestamp));
						if (llstate) 
							state.setAcceleration( (state.getSpeed()-lstate.getSpeed()) * 1000 / (ctime-lstate.timestamp));
					}
					//--------------------------------------------------------------
				}
				state.setElapsed(nel);
			} else {
				if (lstate)
					state.setElapsed(lstate.getElapsed());
				if (lstate.getElapsed() != this.track.laps) {
					this.setIsDiscarded(true);
				}
			}
			//-----------------------------------------------------------
			state.setIsDiscarded(this.getIsDiscarded());
			this.addState(state);
		},
		
		addState : function(state) {
			this.states.insert(state);
			if (!CONFIG.__skipParticipantHistoryClear)
			if (this.states.size > CONFIG.constraints.maxParticipantStateHistory)
				this.states.remove(this.states.min());
		},

		getLastState: function() {
			return this.states.size ? this.states.max() : null;
		},

		getFreq : function() {
			var lstate = this.getLastState();
			return lstate ? lstate.freq : 0;
		},

		getSpeed : function() {
			var lstate = this.getLastState();
			return lstate ? lstate.speed : 0;
		},

		getGPS : function() {
			var lstate = this.getLastState();
			return lstate ? lstate.gps : this.getPosition();
		},

		getElapsed : function() {
			var lstate = this.getLastState();
			return lstate ? lstate.elapsed : 0;
		},

		getPopupHTML : function(ctime) {
			var pos = this.min("gps");
			var tlen = this.track.getTrackLength();
			var elapsed = this.calculateElapsedAverage(ctime);
			var tpart = this.track.getTrackPart(elapsed);
			var targetKM;
			var partStart;
			var tpartMore;
			if (tpart == 0) {
				tparts="SWIM";
				targetKM=this.track.bikeStartKM;
				partStart=0;
				tpartMore="SWIM";
			} else if (tpart == 1) {
				tparts="BIKE";
				targetKM=this.track.runStartKM;
				partStart=this.track.bikeStartKM;
				tpartMore="RIDE";
			} else if (tpart == 2) { 
				tparts="RUN";
				targetKM=tlen/1000.0;
				partStart=this.track.runStartKM;
				tpartMore="RUN";
			}
			var html="<div class='popup_code' style='color:rgba("+colorAlphaArray(this.getColor(),0.9).join(",")+")'>"+escapeHTML(this.getCode())+" (1)</div>";
			var freq = Math.round(this.getFreq());
			if (freq > 0) {
				html+="<div class" +
						"='popup_freq'>"+freq+"</div>";
			}
			var elkm = elapsed*tlen/1000.0;
			var elkms = parseFloat(Math.round(elkm * 100) / 100).toFixed(2);			

			/*var rekm = elapsed%1.0;
			rekm=(1.0-rekm)*tlen/1000.0;
			rekm = parseFloat(Math.round(rekm * 100) / 100).toFixed(2);*/			
			//-----------------------------------------------------
			var estf=null;
			var etxt1=null;
			var etxt2=null;
			var lstate = null; 

			var speed = this.avg(ctime,"speed");
			if (speed && speed > 0) 
			{
				var acceleration = this.avg(ctime,"acceleration");
				var rot = this.track.getPositionAndRotationFromElapsed(elapsed)*180/Math.PI;
				if (rot < 0)
					rot+=360;
				var spms = Math.ceil(speed * 100) / 100;
				spms/=1000.0;
				spms*=60*60;
				etxt1=parseFloat(spms).toFixed(2)+" km/h";
				if (rot != null) 
				{
					if (rot <= 0) 
						etxt1+=" E";
					else if (rot <= 45)
						etxt1+=" SE";
					else if (rot <= 90)
						etxt1+=" S";
					else if (rot <= 135)
						etxt1+=" SW";
					else if (rot <= 180)
						etxt1+=" W";
					else if (rot <= 225)
						etxt1+=" NW";
					else if (rot <= 270)
						etxt1+=" N";
					else 
						etxt1+=" NE";
				}
				estf=Utils.formatTime(new Date( ctime + targetKM*1000 / spms*1000 ));  
				if (acceleration > 0)
					etxt2=parseFloat(Math.ceil(acceleration * 100) / 100).toFixed(2)+" m/s2";
			}
			//-------------------------------------------------------------------------------------------------
			var p1 = 100*this.track.bikeStartKM/(tlen/1000.0);
			var p2 = 100*(this.track.runStartKM-this.track.bikeStartKM)/(tlen/1000.0);
			var p3 = 100*(tlen/1000.0 - this.track.runStartKM)/(tlen/1000.0);
			var prettyCoord=
				"<div style='opacity:0.7;float:left;overflow:hidden;height:7px;width:"+p1+"%;background-color:"+CONFIG.appearance.trackColorSwim+"'/>"+
				"<div style='opacity:0.7;float:left;overflow:hidden;height:7px;width:"+p2+"%;background-color:"+CONFIG.appearance.trackColorBike+"'/>"+
				"<div style='opacity:0.7;float:left;overflow:hidden;height:7px;width:"+p3+"%;background-color:"+CONFIG.appearance.trackColorRun+"'/>"
				; //ol.coordinate.toStringHDMS(this.getPosition(), 2);

			var imgdiv;
			if (tpart == 0)
				imgdiv="<img class='popup_track_mode' style='left:"+elapsed*100+"%' src='img/swim.svg'/>"
			else if (tpart == 1)
				imgdiv="<img class='popup_track_mode' style='left:"+elapsed*100+"%' src='img/bike.svg'/>"
			else /*if (tpart == 2)*/
				imgdiv="<img class='popup_track_mode' style='left:"+elapsed*100+"%' src='img/run.svg'/>"
	

			var pass = Math.round((new Date()).getTime()/3500) % 3;
			html+="<table class='popup_table' style='background-image:url(\""+this.getImage()+"\")'>";
			var isDummy=!(elapsed > 0);
			html+="<tr><td class='lbl'>Elapsed</td><td class='value'>"+(isDummy ? "-" : elkms+" km")+"</td></tr>";
			html+="<tr><td class='lbl'>More to "+tpartMore+"</td><td class='value'>"+(isDummy ? "-" : parseFloat(Math.round((targetKM-elkm) * 100) / 100).toFixed(2) /* rekm */ +" km")+"</td></tr>";
			html+="<tr><td class='lbl'>Finish "+ tparts.toLowerCase() +"</td><td class='value'>"+(!estf ? "-" : estf)+"</td></tr>";					
			html+="<tr><td class='lbl'>Speed</td><td class='value'>"+(!isDummy && etxt1 ? etxt1 : "-") + "</td></tr>";
			html+="<tr><td class='lbl'>Acceler.</td><td class='value'>"+(!isDummy && etxt2 ? etxt2 : "-") +"</td></tr>";
			html+="<tr style='height:100%'><td>&nbsp;</td><td>&nbsp;</td></tr>";
			html+"</table>"
			//html+="<div class='popup_shadow'>"+prettyCoord+imgdiv+"</div>";
			
			var rank="-";
			if (this.__pos != undefined)
				rank=this.__pos + 1;   // the first pos - the FASTEST is 0
			
			
			html="<div class='popup_content_prg'><div style='width:"+p1+"%;height:6px;background-color:"+CONFIG.appearance.trackColorSwim+";float:left;'></div><div style='width:"+p2+"%;height:6px;background-color:"+CONFIG.appearance.trackColorBike+";float:left;'></div><div style='width:"+p3+"%;height:6px;background-color:"+CONFIG.appearance.trackColorRun+";float:left;'></div>";
			html+="<div class='popup_track_pos'><div class='popup_track_pos_1' style='left:"+(elapsed*90)+"%'></div></div>";
			html+="</div>";
			html+="<img class='popup_content_img' src='"+this.getImage()+"'/>";
			html+="<div class='popup_content_1'>";
			html+="<div class='popup_content_name'>"+escapeHTML(this.getCode())+"</div>";
			html+="<div class='popup_content_l1'>"+this.getCountry().substring(0,3).toUpperCase()+" | Pos: "+rank+" | Speed: "+(!isDummy && etxt1 ? etxt1 : "-")+"</div>";
			var pass = Math.round(((new Date()).getTime() / 1000 / 4))%2;
			if (pass == 0) {
				if (this.__pos != undefined) 
				{
					parseFloat(Math.round(elkm * 100) / 100).toFixed(2);

					// this.__next is the participant behind this one (e.g the slower one with lest elapsed index)
					// and this.__prev is the one before us
					// so if participant is in position 3 the one before him will be 2 and the one behind him will be 4
					// (e.g. "this.__pos == 3" => this.__prev.__pos == 2 and this.__prev.__next == 4
					// for the

					if (this.__prev && this.__prev.__pos != undefined && this.getSpeed()) {
						// what is the difference between current one and the one before - we will run so our speed
						// what time we are short - so will add a minus in front of the time
						var elapsedprev = this.__prev.calculateElapsedAverage(ctime);
						var dprev = ((elapsedprev - elapsed)*this.track.getTrackLength() / this.getSpeed())/60.0;
						dprev = parseFloat(Math.round(dprev * 100) / 100).toFixed(2);
						html+="<div class='popup_content_l2'>GAP P"+(this.__prev.__pos + 1)+" : -"+dprev+" Min</div>";
					} else {
						html+="<div class='popup_content_l2'>&nbsp;</div>";
					}

					if (this.__next && this.__next.__pos != undefined && this.__next.getSpeed()) {
						// what is the difference between current one and the one behind - this other one will run so his speed
						// waht time we are ahead - so a positive time
						var elapsednext = this.__next.calculateElapsedAverage(ctime);
						var dnext = ((elapsed - elapsednext)*this.track.getTrackLength() / this.__next.getSpeed())/60.0;
						dnext = parseFloat(Math.round(dnext * 100) / 100).toFixed(2);
						html+="<div class='popup_content_l3'>GAP P"+(this.__next.__pos + 1)+" : "+dnext+" Min</div>";
					} else {
						html+="<div class='popup_content_l2'>&nbsp;</div>";
					}
				}
			} else {
				html+="<div class='popup_content_l2'>MORE TO  "+tpartMore+": "+(isDummy ? "-" : parseFloat(Math.round((targetKM-elkm) * 100) / 100).toFixed(2) /* rekm */ +" km")+"</div>";
				html+="<div class='popup_content_l3'>FINISH "+ tparts +": "+(!estf ? "-" : estf)+"</div>";
			}
			html+="</div>";
			return html;
		}
		
		
    }
});

},{"./Config":6,"./Point":13,"./Utils":16,"bintrees":17,"joose":21,"kld-intersections":22}],13:[function(require,module,exports){
require('joose');

Class("Point", {
    //--------------------------------------
    // ALL COORDINATES ARE IN WORLD MERCATOR
    //--------------------------------------

    has : {
        code : {
            is : "rw",
            init : "CODE_NOT_SET"
        },
        id : {
            is : "rw",
            init : "ID_NOT_SET"
        },
        feature : {
            is : "rw",
            init : null
        },
        position : {
            is:   "rw",
            init: [0,0]	//lon lat world mercator
        }
    },

    methods : {
        init : function(pos) {
            if (typeof ol != "undefined") {
                var geom = new ol.geom.Point(pos);
                geom.transform('EPSG:4326', 'EPSG:3857');
                var feature = new ol.Feature();
                feature.setGeometry(geom);
                this.setFeature(feature);

                this.setPosition(pos);
            }
        }
    }
});
},{"joose":21}],14:[function(require,module,exports){
var CONFIG = require('./Config');
//---------------------------------
var aliases={};
var aliasesR={};
$.ajax({
	type: "GET",
	url: "data/aliases.xml",
	dataType: "xml",
	success: function(xml) {
		var $xml = $(xml);
		var $title = $xml.find( "M2MDevice" ).each(function() {
			var devId=$(this).attr("m2mDeviceId");
			var imei=$(this).attr("imeiNumber");
			aliases[imei]=devId;
			aliasesR[devId]=imei;
		});
	}
});

function alias(imei) 
{ 
	if (aliasesR[imei])
		return aliasesR[imei];
	return imei;
}
//---------------------------------


var STYLES=
{
	//------------------------------------------------
	// style function for track
	//------------------------------------------------
		
	"_track": function(feature,resolution) 
	{
        return [
        ];
	},

	"test": function(feature,resolution) 
	{
		var styles=[];
        styles.push(new ol.style.Style({
            image: new ol.style.Circle({
                radius: 17,
                fill: new ol.style.Fill({
                    color: "rgba(255,255,255,0.5)"
                }),
                stroke: new ol.style.Stroke({
                    color: "rgba(255,255,255,1)",
                    width: 3
                })
            })
        }));
        return styles;
	},

	"test2": function(feature,resolution) 
	{
		var styles=[];
        styles.push(new ol.style.Style({
            stroke: new ol.style.Stroke({
                color: "rgba(255,255,0,1)",
                width: 3
            }),
	        image: new ol.style.Circle({
	            radius: 7,
	            stroke: new ol.style.Stroke({
	            	//feature.color
	                color: "rgba(255,255,0,1)",
	                width: 3
	            }),
	            fill: new ol.style.Stroke({
	            	//feature.color
	                color: "rgba(255,255,0,0.7)",
	                width: 3
	            })
	        }),
	        text: new ol.style.Text({
	            font: 'bold 15px Lato-Regular',
	            fill: new ol.style.Fill({
	                color: 'rgba(255,255,0,1)'
	            }),
	            text: feature.getGeometry() instanceof ol.geom.Point ? (Math.round(feature.debugInfo.value*100*100.0)/100.0)+"%" : "",
	            offsetX:  0,
	            offsetY : 16
	        })
        }));
        return styles;
	},

	"test1": function(feature,resolution) 
	{
		var styles=[];
        styles.push(new ol.style.Style({
             stroke: new ol.style.Stroke({
                 color: "rgba(0,0,0,0.4)",
                 width: 3
             }),
	         fill: new ol.style.Fill({
	            color: "rgba(40,255,40,0.2)"
	         }),
        }));
        return styles;
	},
	"track" : function(feature,resolution) 
	{
		var styles=[];
		var track=feature.track;
		if (!track) {
			console.log("Rendering track feature without track object!");
			return styles;
		}
		var coords=feature.getGeometry().getCoordinates();
		var geomswim=coords;
		var geombike;
		var geomrun;
		//-------------------------------------
		
		/*var ww = 8.0/resolution;
		if (ww < 6.0)
			ww=6.0;*/
		var ww=10.0;

		//-------------------------------------
		if (track && !isNaN(track.bikeStartKM)) 
		{
			for (var i=0;i<track.distances.length;i++) {
				if (track.distances[i] >= track.bikeStartKM*1000) {
					break;
				}
			}
			var j;
			if (!isNaN(track.runStartKM)) {
				for (j=i;j<track.distances.length;j++) {
					if (track.distances[j] >= track.runStartKM*1000)
						break;
				}
			} else {
				j=track.distances.length;
			}
			geomswim=coords.slice(0,i);
			geombike=coords.slice(i < 1 ? i : i-1,j);
			if (j < track.distances.length)
				geomrun=coords.slice(j < 1 ? j : j-1,track.distances.length);
			if (!geomswim || !geomswim.length)
				geomswim=null;
			if (!geombike || !geombike.length)
				geombike=null;
			if (!geomrun || !geomrun.length)
                geomrun=null;
		}


        if (geomswim && GUI.isShowSwim) {
            styles.push(new ol.style.Style({
                    geometry: new ol.geom.LineString(geomswim),
                    stroke: new ol.style.Stroke({
                        color: CONFIG.appearance.trackColorSwim,
                        width: ww
                    })
                })
            );
            STYLES._genDirection(geomswim, ww, resolution, CONFIG.appearance.trackColorSwim, styles);

            STYLES._genDistanceKm(ww, resolution, coords, track.distances, 0, i, styles);

			// for now don't show this checkpoint
			//if (GUI.isShowSwim)
			//	STYLES._genCheckpoint(geomswim, CONFIG.appearance.trackColorSwim, styles);
        }
        if (geombike && GUI.isShowBike)
        {
            styles.push(new ol.style.Style({
                    geometry: new ol.geom.LineString(geombike),
                    stroke: new ol.style.Stroke({
                        color: CONFIG.appearance.trackColorBike,
                        width: ww
                    })
                })
            );
            STYLES._genDirection(geombike, ww, resolution, CONFIG.appearance.trackColorBike, styles);

            STYLES._genDistanceKm(ww, resolution, coords, track.distances, i, j, styles);

			// add checkpoint if this is not already added as a hotspot
			if (!track.isAddedHotSpotSwimBike) {
				if (CONFIG.appearance.isShowCheckpointImage)
					STYLES._genCheckpointImage(geombike, CONFIG.appearance.imageCheckpointSwimBike, styles);
				else if (CONFIG.appearance.isShowCheckpoint && GUI.isShowBike)
					STYLES._genCheckpoint(geombike, CONFIG.appearance.trackColorBike, styles);
			}
        }
		if (geomrun && GUI.isShowRun)
		{
			styles.push(new ol.style.Style({
                    geometry: new ol.geom.LineString(geomrun),
                    stroke: new ol.style.Stroke({
                        color: CONFIG.appearance.trackColorRun,
                        width: ww
                    })
                })
            );
            STYLES._genDirection(geomrun, ww, resolution, CONFIG.appearance.trackColorRun, styles);

            STYLES._genDistanceKm(ww, resolution, coords, track.distances, j, track.distances.length, styles);

			// add checkpoint if this is not already added as a hotspot
			if (!track.isAddedHotSpotBikeRun) {
				if (CONFIG.appearance.isShowCheckpointImage)
					STYLES._genCheckpointImage(geomrun, CONFIG.appearance.imageCheckpointBikeRun, styles);
				else if (CONFIG.appearance.isShowCheckpoint && GUI.isShowBike)
					STYLES._genCheckpoint(geomrun, CONFIG.appearance.trackColorRun, styles);
			}
        }

		// START-FINISH --------------------------
		if (coords && coords.length >= 2)
		{
			var start = coords[0];
			var end = coords[1];
			/*var dx = end[0] - start[0];
			 var dy = end[1] - start[1];
			 var rotation = Math.atan2(dy, dx);
			 styles.push(new ol.style.Style(
			 {
			 geometry: new ol.geom.Point(start),
			 image: new ol.style.Icon({
			 src: 'img/begin-end-arrow.png',
			 scale : 0.45,
			 anchor: [0.0, 0.5],
			 rotateWithView: true,
			 rotation: -rotation,
			 opacity : 1
			 })
			 }));*/

			// loop?
			end = coords[coords.length-1];
			if (end[0] != start[0] || end[1] != start[1])
			{
				var start = coords[coords.length-2];
				var dx = end[0] - start[0];
				var dy = end[1] - start[1];
				var rotation = Math.atan2(dy, dx);
				styles.push(new ol.style.Style(
					{
						geometry: new ol.geom.Point(end),
						image: new ol.style.Icon({
							src: CONFIG.appearance.imageFinish,
							scale : 0.45,
							anchor: [0.5, 0.5],
							rotateWithView: true,
							//rotation: -rotation,
							opacity : 1
						})
					}));
			}
		}

		return styles;
	},
	//--------------------------------------
	"debugGPS" : function(feature,resolution) 
	{
		var coef = ((new Date()).getTime()-feature.timeCreated)/(CONFIG.timeouts.gpsLocationDebugShow*1000);
		if (coef > 1)
			return [];
		return [
		        new ol.style.Style({
		        image: new ol.style.Circle({
		            radius: coef*20,
		            stroke: new ol.style.Stroke({
		            	//feature.color
		                color: colorAlphaArray(feature.color,(1.0-coef)*1.0), 
		                width: 4
		            })
		          })
		})];
	},
	
	"participant" : function(feature,resolution) 
	{
		// SKIP DRAW (TODO OPTIMIZE)
		var part = feature.participant;
		if (!part.isFavorite)
			return [];
		
		var ctime = part.__ctime ? part.__ctime : (new Date()).getTime();
		var speed = part.avg(ctime,"speed");
		var etxt="";
		if (speed) {
			etxt=" "+parseFloat(Math.ceil(speed* 100) / 100).toFixed(2)+" m/s";
		}
		var zIndex = Math.round(part.getElapsed()*1000000)*1000+part.seqId;
		var styles=[];
		//-----------------------------------------------------------------------------------------------------------------------
		var isTime = (ctime >= CONFIG.times.begin && ctime <= CONFIG.times.end);
		var isSOS = part.min(ctime,"isSOS");
		var isDiscarded = part.min(ctime,"isDiscarded");
		var isDirection = (speed && !isSOS && !isDiscarded && isTime);
		var animFrame = (ctime%3000)*Math.PI*2/3000.0;

        if (isTime) {
            styles.push(new ol.style.Style({
                zIndex: zIndex,
                image: new ol.style.Circle({
                    radius: 17,
                    fill: new ol.style.Fill({
                        color: isDiscarded || isSOS ? "rgba(192,0,0," + (Math.sin(animFrame) * 0.7 + 0.3) + ")" : "rgba(" + colorAlphaArray(part.color, 0.85).join(",") + ")"
                    }),
                    stroke: new ol.style.Stroke({
                        color: isDiscarded || isSOS ? "rgba(255,0,0," + (1.0 - (Math.sin(animFrame) * 0.7 + 0.3)) + ")" : "#ffffff",
                        width: 3
                    })
                }),
                text: new ol.style.Text({
                    font: 'normal 13px Lato-Regular',
                    fill: new ol.style.Fill({
                        color: '#FFFFFF'
                    }),
                    text: part.getInitials(),
                    offsetX: 0,
                    offsetY: 0
                })
            }));
        } else {
            styles.push(new ol.style.Style({
                zIndex: zIndex,
                image: new ol.style.Circle({
                    radius: 17,
                    fill: new ol.style.Fill({
                        color: "rgba(" + colorAlphaArray(part.color, 0.35).join(",") + ")"
                    }),
                    stroke: new ol.style.Stroke({
                        color: "rgba(255,255,255,1)",
                        width: 3
                    })
                }),
                text: new ol.style.Text({
                    font: 'normal 13px Lato-Regular',
                    fill: new ol.style.Fill({
                        color: '#000000'
                    }),
                    text: alias(part.getDeviceId()),
                    offsetX: 0,
                    offsetY: 20
                })
            }));
        }
        //--------------------------------------------------
        styles.push(new ol.style.Style({
            zIndex: zIndex,
            image: new ol.style.Circle({
                radius: 17,
                fill: new ol.style.Fill({
                    color: part.isDiscarded || part.isSOS ? "rgba(192,0,0," + (Math.sin(animFrame) * 0.7 + 0.3) + ")" : "rgba(" + colorAlphaArray(part.color, 0.85).join(",") + ")"
                }),
                stroke: new ol.style.Stroke({
                    color: part.isDiscarded || part.isSOS ? "rgba(255,0,0," + (1.0 - (Math.sin(animFrame) * 0.7 + 0.3)) + ")" : "#ffffff",
                    width: 3
                })
            }),
            text: new ol.style.Text({
                font: 'normal 13px Lato-Regular',
                fill: new ol.style.Fill({
                    color: '#FFFFFF'
                }),
                text: part.getInitials(),
                offsetX: 0,
                offsetY: 0
            })
        }));


        if (isDirection && part.getRotation() != null)
        {
            styles.push(new ol.style.Style({
                zIndex: zIndex,
                image: new ol.style.Icon(({
                    anchor: [-0.5,0.5],
                    anchorXUnits: 'fraction',
                    anchorYUnits: 'fraction',
                    opacity: 1,
                    src : renderArrowBase64(48,48,part.color),
					  scale : 0.55,
					  rotation : -part.getRotation()
				   }))
			}));
		}
        
		/*var coef = part.track.getTrackLengthInWGS84()/part.track.getTrackLength();		
		var rr = CONFIG.math.gpsInaccuracy*coef;		
        styles.push(new ol.style.Style({
            zIndex: zIndex,
            image: new ol.style.Circle({
            	geometry: new ol.geom.Point(part.getGPS()),
                radius: 10, //rr * resolution,
                fill: new ol.style.Fill({
                    color: "rgba(255,255,255,0.8)"
                }),
                stroke: new ol.style.Stroke({
                    color: "rgba(0,0,0,1)",
                    width: 1
                })
            })
        }));*/
		return styles;
	},

	"cam" : function(feature, resolution) {
		var styles=[];

		var cam = feature.cam;

		styles.push(new ol.style.Style({
			image: new ol.style.Icon(({
				// TODO Rumen - it's better all images to be the same size, so the same scale
				scale : 0.040,
				src : CONFIG.appearance.imageCam.split(".svg").join((cam.seqId+1) + ".svg")
			}))
		}));

		return styles;
	},

    "hotspot" : function(feature, resolution) {
        var styles=[];

        var hotspot = feature.hotspot;

        styles.push(new ol.style.Style({
            image: new ol.style.Icon(({
                scale : hotspot.getType().scale || 1,
                src : hotspot.getType().image
            }))
        }));

        return styles;
    },

	//------------------------------------------------
	// Private methods
	//------------------------------------------------

	_trackSelected : new ol.style.Style({
		stroke: new ol.style.Stroke({
			color: '#FF5050',
			width: 4.5
		})
	}),

	_genCheckpoint : function(geometry, color, styles) {
		var start = geometry[0];
		var end = geometry[1];
		var dx = end[0] - start[0];
		var dy = end[1] - start[1];
		var rotation = Math.atan2(dy, dx);

		styles.push(new ol.style.Style({
			geometry: new ol.geom.Point(start),
			image: new ol.style.Icon({
				src: renderBoxBase64(16,16,color),
				scale : 1,
				anchor: [0.92, 0.5],
				rotateWithView: true,
				rotation: -rotation,
				opacity : 0.65
			})
		}));
	},

	_genCheckpointImage : function(geometry, image, styles) {
		var start = geometry[0];
		//var end = geometry[1];
		//var dx = end[0] - start[0];
		//var dy = end[1] - start[1];
		//var rotation = Math.atan2(dy, dx);

		styles.push(new ol.style.Style({
			geometry: new ol.geom.Point(start),
			image: new ol.style.Icon({
				src: image,
				//scale : 0.65,
				anchor: [0.5, 0.5],
				rotateWithView: true,
				//rotation: -rotation,
				opacity : 1
			})
		}));
	},

	_genDirection : function(pts, ww, resolution, color, styles) {
        if (CONFIG.appearance.directionIconBetween <= 0) {
            // this means no need to show the directions
            return;
        }

        var cnt = 0;
        var icn = renderDirectionBase64(16, 16, color);
        var res = 0.0;
        for (var i = 0; i < pts.length - 1; i++) {
            var start = pts[i + 1];
            var end = pts[i];
            var dx = end[0] - start[0];
            var dy = end[1] - start[1];
            var len = Math.sqrt(dx * dx + dy * dy) / resolution;
            res += len;
            if (i == 0 || res >= CONFIG.appearance.directionIconBetween) {
                res = 0;
                var rotation = Math.atan2(dy, dx);
                styles.push(new ol.style.Style({
                    geometry: new ol.geom.Point([(start[0] + end[0]) / 2, (start[1] + end[1]) / 2]),
                    image: new ol.style.Icon({
                        src: icn,
                        scale: ww / 12.0,
                        anchor: [0.5, 0.5],
                        rotateWithView: true,
                        rotation: -rotation + Math.PI, // add 180 degrees
                        opacity: 1
                    })
                }));
                cnt++;
            }
        }
    },

    _genDistanceKm : function(ww, resolution,
							  coords, distances, startDistIndex, endDistIndex,
							  styles) {
        // TODO Rumen - still not ready - for now static hotspots are used
        if (true) {return;}

        var hotspotsKm = [20, 40, 60, 80, 100, 120, 140, 160, 180];

        function addHotSpotKM(km, point) {
            //var dx = end[0] - start[0];
            //var dy = end[1] - start[1];
            //var rotation = Math.atan2(dy, dx);
            styles.push(new ol.style.Style({
                //geometry: new ol.geom.Point([(start[0]+end[0])/2,(start[1]+end[1])/2]),
                geometry: new ol.geom.Point([point[0], point[1]]),
                image: new ol.style.Icon({
                    src: "img/" + km + "km.svg",
                    scale: 1.5,
                    rotateWithView: true,
                    //rotation: -rotation + Math.PI/2, // add 180 degrees
                    opacity : 1
                })
            }));
        }

        for (var i = startDistIndex; i < endDistIndex; i++) {
            if (!hotspotsKm.length) {
				return;
			}

			var dist = distances[i];

			if (dist >= hotspotsKm[0]*1000) {
				// draw the first hotspot and any next if it's contained in the same "distance"
				var removeHotspotKm = 0;
				for (var k = 0, lenHotspotsKm = hotspotsKm.length; k < lenHotspotsKm; k++) {
					if (dist >= hotspotsKm[k]*1000) {
						addHotSpotKM(hotspotsKm[k], coords[i]);
						removeHotspotKm++;
					} else {
						break;
					}
				}
				// remove all the already drawn hotspots
				for (var j = 0; j <removeHotspotKm; j++) hotspotsKm.shift();
			}
        }
    }
};

for (var i in STYLES)
	exports[i]=STYLES[i];

},{"./Config":6}],15:[function(require,module,exports){
require('joose');
require('./Participant');

var rbush = require('rbush');
var CONFIG = require('./Config');
var WGS84SPHERE = require('./Utils').WGS84SPHERE;

Class("Track", 
{	
    //--------------------------------------
	// ALL COORDINATES ARE IN WORLD MERCATOR
    //--------------------------------------
    has: 
	{
        route : {
            is:   "rw"
        },
        distances : {
            is:   "rw"
        },
        distancesElapsed : {
            is:   "rw"
        },
		totalLength : {
			is : "rw"
		},
		participants : {
			is:   "rw",
			init : []
		},
		camsCount : {
			is:   "rw",
			init: 0
		},
		// in EPSG 3857
		feature : {
			is : "rw",
			init : null		
		},
		isDirectionConstraint : {
			is : "rw",
			init : false
		},
		
		debugParticipant : {
			is : "rw",
			init : null
		},
		bikeStartKM : {
			is : "rw",
			init : null
		},
		runStartKM : {
			is : "rw",
			init : null
		},
		laps : {
			is : "rw",
			init : 1
		},
		totalParticipants : {
			is : "rw",
			init : 50
		},
		rTree : {
			is : "rw",
			init : rbush(10)
		},

		isAddedHotSpotSwimBike : {
			init : false
		},
		isAddedHotSpotBikeRun : {
			init : false
		}
    },
    //--------------------------------------
	methods: 
	{		
		setRoute : function(val) {
			this.route=val;
			delete this._lentmp1;
			delete this._lentmp2;
		},
		
		getBoundingBox : function() {
			var minx=null,miny=null,maxx=null,maxy=null;
			for (var i=0;i<this.route.length;i++)
			{
				var p=this.route[i];
				if (minx == null || p[0] < minx) minx=p[0];
				if (maxx == null || p[0] > maxx) maxx=p[0];
				if (miny == null || p[1] < miny) miny=p[1];
				if (maxy == null || p[1] > maxy) maxy=p[1];
			}
			return [minx,miny,maxx,maxy];
		},
		
		// elapsed from 0..1
		getPositionAndRotationFromElapsed : function(elapsed) {
			var rr=null;
			var cc = this.route;
			
			var ll = this.distancesElapsed.length-1;
			var si = 0;

			// TODO FIX ME 
			while (si < ll && si+500 < ll && this.distancesElapsed[si+500] < elapsed ) {
				si+=500;
			}
			
			while (si < ll && si+250 < ll && this.distancesElapsed[si+250] < elapsed ) {
				si+=250;
			}
			
			while (si < ll && si+125 < ll && this.distancesElapsed[si+125] < elapsed ) {
				si+=125;
			}

			while (si < ll && si+50 < ll && this.distancesElapsed[si+50] < elapsed ) {
				si+=50;
			}
			
			for (var i=si;i<ll;i++) 
			{
				/*do 
				{
					var m = ((cc.length-1+i) >> 1);
					if (m-i > 5 && elapsed < this.distancesElapsed[m]) {
						i=m;
						continue;
					}
					break;
				} while (true);*/
				if (elapsed >= this.distancesElapsed[i] && elapsed <= this.distancesElapsed[i+1]) 
				{
					elapsed-=this.distancesElapsed[i];
					var ac=this.distancesElapsed[i+1]-this.distancesElapsed[i];
					var a = cc[i];
					var c = cc[i+1];
					var dx = c[0] - a[0];
					var dy = c[1] - a[1];
					rr=[ a[0]+(c[0]-a[0])*elapsed/ac,a[1]+(c[1]-a[1])*elapsed/ac,Math.atan2(dy, dx)];
					break;
				}
			}
			return rr;
		},
		
		__getPositionAndRotationFromElapsed : function(elapsed) {
			elapsed*=this.getTrackLength();
			var rr=null;
			var cc = this.route;
			for (var i=0;i<cc.length-1;i++) 
			{
				var a = cc[i];
				var c = cc[i+1];
				var ac = WGS84SPHERE.haversineDistance(a,c);
				if (elapsed <= ac) {
					var dx = c[0] - a[0];
					var dy = c[1] - a[1];
					rr=[ a[0]+(c[0]-a[0])*elapsed/ac,a[1]+(c[1]-a[1])*elapsed/ac,Math.atan2(dy, dx)];
					break;
				}
				elapsed-=ac;
			}
			return rr;
		},

		
		getTrackLength : function() {
			if (this._lentmp1)
				return this._lentmp1;
			var res=0.0;
			var cc = this.route;
			for (var i=0;i<cc.length-1;i++) 
			{
				var a = cc[i];
				var b = cc[i+1];
				var d = WGS84SPHERE.haversineDistance(a,b);
				if (!isNaN(d) && d > 0) 
					res+=d;
			}
			this._lentmp1=res;
			return res;
		},

		getTrackLengthInWGS84 : function() {
			if (this._lentmp2)
				return this._lentmp2;
			var res=0.0;
			var cc = this.route;
			for (var i=0;i<cc.length-1;i++) 
			{
				var a = cc[i];
				var b = cc[i+1];
				var d = Math.sqrt((a[0]-b[0])*(a[0]-b[0])+(a[1]-b[1])*(a[1]-b[1]));
				if (!isNaN(d) && d > 0) 
					res+=d;
			}
			this._lentmp2=res;
			return res;
		},

		getCenter : function() {
			var bb = this.getBoundingBox();
			return [(bb[0]+bb[2])/2.0,(bb[1]+bb[3])/2.0];
		},
		
		init : function() 
		{
			if (!this.route)
				return;
			// 1) calculate total route length in KM 
			this.updateFeature();
			if (typeof window != "undefined") 
			{
				if (!GUI.getIsSkipExtent || !GUI.getIsSkipExtent()) {
					if (this.feature) {
						GUI.map.getView().fitExtent(this.feature.getGeometry().getExtent(), GUI.map.getSize());
						console.log("Current extent : " + JSON.stringify(this.feature.getGeometry().getExtent()));
					} else {
						GUI.map.getView().fitExtent([1234592.3637345568, 6282706.889676435, 1264348.464373766, 6325694.743164725], GUI.map.getSize());
					}
				}
			}
		},
		
		getTrackPart : function(elapsed) {
			var len = this.getTrackLength();
			var em = (elapsed%1.0)*len;
			if (em >= this.runStartKM*1000) 
				return 2;
			if (em >= this.bikeStartKM*1000) 
				return 1;
			return 0;
		},
		
		updateFeature : function() 
		{
			this.distances=[];
			var res=0.0;
			var cc = this.route;
			for (var i=0;i<cc.length-1;i++) 
			{
				var a = cc[i];
				var b = cc[i+1];
				var d = WGS84SPHERE.haversineDistance(a,b);
				this.distances.push(res);
				if (!isNaN(d) && d > 0) 
					res+=d;
			}
			this.distances.push(res);
			this.distancesElapsed=[];
			var tl = this.getTrackLength();
			for (var i=0;i<cc.length;i++) {
				this.distancesElapsed.push(this.distances[i]/tl);
			}
			//--------------------------------------------------------------
			this.rTree.clear();
			var arr = [];
			for (var i=0;i<this.route.length-1;i++) 
			{
				var x1 = this.route[i][0];
				var y1 = this.route[i][1];
				var x2 = this.route[i+1][0];
				var y2 = this.route[i+1][1];
				var minx = x1 < x2 ? x1 : x2;
				var miny = y1 < y2 ? y1 : y2;
				var maxx = x1 > x2 ? x1 : x2;
				var maxy = y1 > y2 ? y1 : y2;
				arr.push([minx,miny,maxx,maxy,{ index : i }]);
			}
			this.rTree.load(arr);
			//----------------- ---------------------------------------------
			if (typeof window != "undefined" && this.route && this.route.length) 
			{
				var wkt = [];
				for (var i=0;i<this.route.length;i++) {
					wkt.push(this.route[i][0]+" "+this.route[i][1]);
				}
				wkt="LINESTRING("+wkt.join(",")+")";
				var format = new ol.format.WKT();
				if (!this.feature) {
					this.feature = format.readFeature(wkt);
				} else {
					this.feature.setGeometry(format.readFeature(wkt).getGeometry());
				}
				this.feature.track=this;
				this.feature.getGeometry().transform('EPSG:4326', 'EPSG:3857');						
				//console.log("FEATURE TRACK : "+this.feature.track);
			} else {
				delete this.feature;
			}
		},

		getRealParticipantsCount : function() {
			return this.participants.length - this.camsCount;
		},

		getParticipantById : function(id) {
			// TODO Rumen - it would be good to hold a map of the type id -> Participant
			if (this.participants) {
				for (var i = 0, len = this.participants.length; i < len; i++) {
					 if (this.participants[i].id === id) {
						 return this.participants[i];
					 }
				}
			}
			return null;
		},
		
		newParticipant : function(id,deviceId,name)
		{
			var part = new Participant({id:id,deviceId:deviceId,code:name});
			part.init(this.route[0],this);
			part.setSeqId(this.participants.length);
			this.participants.push(part);
			return part;
		},

		newMovingCam : function(id,deviceId,name)
		{
			var cam = new MovingCam({id:id,deviceId:deviceId,code:name});
			cam.init(this.route[0],this);
			cam.setSeqId(this.camsCount);
			this.camsCount++;
			cam.__skipTrackingPos=true;
			this.participants.push(cam);
			return cam;
		},

		newHotSpots : function(hotspots) {
			if (!hotspots || !hotspots.length) {
				return;
			}

			// TODO Rumen - this is COPY-PASTE code form the Styles
			// so later it has to be in only one place - getting the geometries for each type distance
			// maybe in the same place distances are calculated.
			// THIS IS TEMPORARY PATCH to get the needed points
			if (!isNaN(this.bikeStartKM)) {
				for (var i=0;i<this.distances.length;i++) {
					if (this.distances[i] >= this.bikeStartKM*1000)
						break;
				}
				var j;
				if (!isNaN(this.runStartKM)) {
					for (j=i;j<this.distances.length;j++) {
						if (this.distances[j] >= this.runStartKM*1000)
							break;
					}
				} else {
					j=this.distances.length;
				}
				var coords=this.feature.getGeometry().getCoordinates();
				var geomswim=coords.slice(0,i);
				var geombike=coords.slice(i < 1 ? i : i-1,j);
				if (j < this.distances.length)
					var geomrun=coords.slice(j < 1 ? j : j-1,this.distances.length);
				if (!geomswim.length)
					geomswim=null;
				if (!geombike.length)
					geombike=null;
				if (!geomrun.length)
					geomrun=null;
			}

			for (var i = 0, len = hotspots.length; i < len; i++) {
				var hotspot = hotspots[i];
				var point;
				if (hotspot.type === CONFIG.hotspot.camSwimBike) {
					if (this.isAddedHotSpotSwimBike) continue; // not allowed to add to same hotspots
					if (geombike) {
						point = ol.proj.transform(geombike[0], 'EPSG:3857', 'EPSG:4326');
						this.isAddedHotSpotSwimBike = true;
					}
				} else if (hotspot.type === CONFIG.hotspot.camBikeRun) {
					if (this.isAddedHotSpotBikeRun) continue; // not allowed to add to same hotspots
					if (geomrun) {
						point = ol.proj.transform(geomrun[0], 'EPSG:3857', 'EPSG:4326');
						this.isAddedHotSpotBikeRun = true;
					}
				}
				if (point)
					hotspot.init(point);
			}
		},
		
		onMapClick : function(event) 
		{
			if (this.debugParticipant) 
			{
				this.debugParticipant.onDebugClick(event);
			}
		},
		
		test1 : function() {
			/*console.log("#BEGINNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN")
			for (var i=0;i<30;i++) 
			{
				var elapsed = i/60.0;  //((tm - stime)/1000.0)/trackInSeconds + Config.simulation.startElapsed;
				if (elapsed > 1)
					elapsed=1;
				//var pos = track.getPositionAndRotationFromElapsed(elapsed);
				var pos = this.__getPositionAndRotationFromElapsed(elapsed);
				console.log([Math.round(pos[0]*1000000.0)/1000000.0,Math.round(pos[1]*1000000.0)/1000000.0]);
			}
			console.log("#END");*/
		}

    }
});
},{"./Config":6,"./Participant":12,"./Utils":16,"joose":21,"rbush":32}],16:[function(require,module,exports){
(function (Buffer){
var toRadians = function(angleDegrees) { return angleDegrees * Math.PI / 180; };
var toDegrees = function(angleRadians) { return angleRadians * 180 / Math.PI; };

var WGS84Sphere = function(radius) {
  this.radius = radius;
};

WGS84Sphere.prototype.cosineDistance = function(c1, c2) {
  var lat1 = toRadians(c1[1]);
  var lat2 = toRadians(c2[1]);
  var deltaLon = toRadians(c2[0] - c1[0]);
  return this.radius * Math.acos(
      Math.sin(lat1) * Math.sin(lat2) +
      Math.cos(lat1) * Math.cos(lat2) * Math.cos(deltaLon));
};

WGS84Sphere.prototype.geodesicArea = function(coordinates) {
  var area = 0, len = coordinates.length;
  var x1 = coordinates[len - 1][0];
  var y1 = coordinates[len - 1][1];
  for (var i = 0; i < len; i++) {
    var x2 = coordinates[i][0], y2 = coordinates[i][1];
    area += toRadians(x2 - x1) *
        (2 + Math.sin(toRadians(y1)) +
        Math.sin(toRadians(y2)));
    x1 = x2;
    y1 = y2;
  }
  return area * this.radius * this.radius / 2.0;
};

WGS84Sphere.prototype.crossTrackDistance = function(c1, c2, c3) {
  var d13 = this.cosineDistance(c1, c2);
  var theta12 = toRadians(this.initialBearing(c1, c2));
  var theta13 = toRadians(this.initialBearing(c1, c3));
  return this.radius *
      Math.asin(Math.sin(d13 / this.radius) * Math.sin(theta13 - theta12));
};

WGS84Sphere.prototype.equirectangularDistance = function(c1, c2) {
  var lat1 = toRadians(c1[1]);
  var lat2 = toRadians(c2[1]);
  var deltaLon = toRadians(c2[0] - c1[0]);
  var x = deltaLon * Math.cos((lat1 + lat2) / 2);
  var y = lat2 - lat1;
  return this.radius * Math.sqrt(x * x + y * y);
};

WGS84Sphere.prototype.finalBearing = function(c1, c2) {
  return (this.initialBearing(c2, c1) + 180) % 360;
};

WGS84Sphere.prototype.haversineDistance = function(c1, c2) {
  var lat1 = toRadians(c1[1]);
  var lat2 = toRadians(c2[1]);
  var deltaLatBy2 = (lat2 - lat1) / 2;
  var deltaLonBy2 = toRadians(c2[0] - c1[0]) / 2;
  var a = Math.sin(deltaLatBy2) * Math.sin(deltaLatBy2) +
      Math.sin(deltaLonBy2) * Math.sin(deltaLonBy2) *
      Math.cos(lat1) * Math.cos(lat2);
  return 2 * this.radius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

WGS84Sphere.prototype.interpolate = function(c1, c2, fraction) {
  var lat1 = toRadians(c1[1]);
  var lon1 = toRadians(c1[0]);
  var lat2 = toRadians(c2[1]);
  var lon2 = toRadians(c2[0]);
  var cosLat1 = Math.cos(lat1);
  var sinLat1 = Math.sin(lat1);
  var cosLat2 = Math.cos(lat2);
  var sinLat2 = Math.sin(lat2);
  var cosDeltaLon = Math.cos(lon2 - lon1);
  var d = sinLat1 * sinLat2 + cosLat1 * cosLat2 * cosDeltaLon;
  if (1 <= d) {
    return c2.slice();
  }
  d = fraction * Math.acos(d);
  var cosD = Math.cos(d);
  var sinD = Math.sin(d);
  var y = Math.sin(lon2 - lon1) * cosLat2;
  var x = cosLat1 * sinLat2 - sinLat1 * cosLat2 * cosDeltaLon;
  var theta = Math.atan2(y, x);
  var lat = Math.asin(sinLat1 * cosD + cosLat1 * sinD * Math.cos(theta));
  var lon = lon1 + Math.atan2(Math.sin(theta) * sinD * cosLat1,
                              cosD - sinLat1 * Math.sin(lat));
  return [toDegrees(lon), toDegrees(lat)];
};

WGS84Sphere.prototype.initialBearing = function(c1, c2) {
  var lat1 = toRadians(c1[1]);
  var lat2 = toRadians(c2[1]);
  var deltaLon = toRadians(c2[0] - c1[0]);
  var y = Math.sin(deltaLon) * Math.cos(lat2);
  var x = Math.cos(lat1) * Math.sin(lat2) -
      Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLon);
  return toDegrees(Math.atan2(y, x));
};

WGS84Sphere.prototype.maximumLatitude = function(bearing, latitude) {
  return Math.cos(Math.abs(Math.sin(toRadians(bearing)) *
                           Math.cos(toRadians(latitude))));
};

WGS84Sphere.prototype.midpoint = function(c1, c2) {
  var lat1 = toRadians(c1[1]);
  var lat2 = toRadians(c2[1]);
  var lon1 = toRadians(c1[0]);
  var deltaLon = toRadians(c2[0] - c1[0]);
  var Bx = Math.cos(lat2) * Math.cos(deltaLon);
  var By = Math.cos(lat2) * Math.sin(deltaLon);
  var cosLat1PlusBx = Math.cos(lat1) + Bx;
  var lat = Math.atan2(Math.sin(lat1) + Math.sin(lat2),
                       Math.sqrt(cosLat1PlusBx * cosLat1PlusBx + By * By));
  var lon = lon1 + Math.atan2(By, cosLat1PlusBx);
  return [toDegrees(lon), toDegrees(lat)];
};

WGS84Sphere.prototype.offset = function(c1, distance, bearing) {
  var lat1 = toRadians(c1[1]);
  var lon1 = toRadians(c1[0]);
  var dByR = distance / this.radius;
  var lat = Math.asin(
      Math.sin(lat1) * Math.cos(dByR) +
      Math.cos(lat1) * Math.sin(dByR) * Math.cos(bearing));
  var lon = lon1 + Math.atan2(
      Math.sin(bearing) * Math.sin(dByR) * Math.cos(lat1),
      Math.cos(dByR) - Math.sin(lat1) * Math.sin(lat));
  return [toDegrees(lon), toDegrees(lat)];
};

/**
 * Checks whether object is not null and not undefined
 * @param {*} obj object to be checked
 * @return {boolean}
 */

function isDefined(obj) {
    return null != obj && undefined != obj;
}

function isNumeric(wh) {
    return !isNaN(parseFloat(wh)) && isFinite(wh);
}

function isFunction(wh) {
    if (!wh) {
        return false;
    }
    return (wh instanceof Function || typeof wh == "function");
}

function isStringNotEmpty(wh) {
    if (!wh) {
        return false;
    }
    return (wh instanceof String || typeof wh == "string");
}

function isStr(wh) {
    return (wh instanceof String || typeof wh === "string");
}

function isBoolean(wh) {
    return (wh instanceof Boolean || typeof wh == "boolean");
}

function myTrim(x) {
    return x.replace(/^\s+|\s+$/gm,'');
}

function myTrimCoordinate(x) {
	do {
		var k=x;
		x=myTrim(x);
		if (k != x) 
			continue;
		if (x.length) 
		{
			if (x[0] == ",")
				x=x.substring(1,x.length);
			else if (k[k.length-1] == ",")
				x=x.substring(0,x.length-1);
			else
				break;
			continue;
		}
		break;
	} while (true);
	return x;
}


function closestProjectionOfPointOnLine(x,y,x1,y1,x2,y2) 
{
	var status;
	var P1=null;
	var P2=null;
	var P3=null;
	var P4=null;
	var p1=[];
    var p2=[];
    var p3=[];
	var p4=[];
    var intersectionPoint=null;
    var distMinPoint=null;
    var denominator=0;
    var nominator=0;
    var u=0;
    var distOrtho=0;
    var distP1=0;
    var distP2=0;
    var distMin=0;
    var distMax=0;
   
    function intersection()
    {
        var ax = p1[0] + u * (p2[0] - p1[0]);
        var ay = p1[1] + u * (p2[1] - p1[1]);
        p4 = [ax, ay];
        intersectionPoint = [ax,ay];
    }

    function distance()
    {
        var ax = p1[0] + u * (p2[0] - p1[0]);
        var ay = p1[1] + u * (p2[1] - p1[1]);
        p4 = [ax, ay];
        distOrtho = Math.sqrt(Math.pow((p4[0] - p3[0]),2) + Math.pow((p4[1] - p3[1]),2));
        distP1    = Math.sqrt(Math.pow((p1[0] - p3[0]),2) + Math.pow((p1[1] - p3[1]),2));
        distP2    = Math.sqrt(Math.pow((p2[0] - p3[0]),2) + Math.pow((p2[1] - p3[1]),2));
        if(u>=0 && u<=1)
        {   distMin = distOrtho;
            distMinPoint = intersectionPoint;
        }
        else
        {   if(distP1 <= distP2)
            {   distMin = distP1;
                distMinPoint = P1;
            }
            else
            {   distMin = distP2;
                distMinPoint = P2;
            }
        }
        distMax = Math.max(Math.max(distOrtho, distP1), distP2);
    }
	P1 = [x1,y1];
	P2 = [x2,y2];
	P3 = [x,y];
	p1 = [x1, y1];
	p2 = [x2, y2];
	p3 = [x, y];
	denominator = Math.pow(Math.sqrt(Math.pow(p2[0]-p1[0],2) + Math.pow(p2[1]-p1[1],2)),2 );
	nominator   = (p3[0] - p1[0]) * (p2[0] - p1[0]) + (p3[1] - p1[1]) * (p2[1] - p1[1]);
	if(denominator==0)
	{   status = "coincidental"
		u = -999;
	}
	else
	{   u = nominator / denominator;
		if(u >=0 && u <= 1)
			status = "orthogonal";
		else
			status = "oblique";
	}
	intersection();
	distance();
	
	return { status : status, pos : distMinPoint, min : distMin };
}

function colorLuminance(hex, lum) {
    // Validate hex string
    hex = String(hex).replace(/[^0-9a-f]/gi, "");
    if (hex.length < 6) {
        hex = hex.replace(/(.)/g, '$1$1');
    }
    lum = lum || 0;
    // Convert to decimal and change luminosity
    var rgb = "#",
        c;
    for (var i = 0; i < 3; ++i) {
        c = parseInt(hex.substr(i * 2, 2), 16);
        c = Math.round(Math.min(Math.max(0, c + (c * lum)), 255)).toString(16);
        rgb += ("00" + c).substr(c.length);
    }
    return rgb;
}

function increaseBrightness(hex, percent) 
{
    hex = String(hex).replace(/[^0-9a-f]/gi, "");
    if (hex.length < 6) {
        hex = hex.replace(/(.)/g, '$1$1');
    }
    var rgb = "#",
        c;
    for (var i = 0; i < 3; ++i) {
        c = parseInt(hex.substr(i * 2, 2), 16);
        c = parseInt((c*(100-percent)+255*percent)/100);
        if (c > 255)
        	c=255;
        c=c.toString(16);
        rgb += ("00" + c).substr(c.length);
    }
    return rgb;
}

function colorAlphaArray(hex, alpha) {
    hex = String(hex).replace(/[^0-9a-f]/gi, "");
    if (hex.length < 6) {
        hex = hex.replace(/(.)/g, '$1$1');
    }
    var res=[];
    for (var i = 0; i < 3; ++i) {
        c = parseInt(hex.substr(i * 2, 2), 16);
        res.push(c);
    }
    res.push(alpha);
    return res;
}

function escapeHTML(unsafe) {
    return unsafe
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
 }

function formatNumber2(val) {
	return parseFloat(Math.round(val * 100) / 100).toFixed(2);
}
function formatDate(d) {
 	var dd = d.getDate();
    var mm = d.getMonth()+1; //January is 0!
    var yyyy = d.getFullYear();
    if(dd<10){
        dd='0'+dd;
    } 
    if(mm<10){
        mm='0'+mm;
    } 
    return dd+'.'+mm+'.'+yyyy;
}

function formatTime(d) {
    var hh = d.getHours();
    if(hh<10){
    	hh='0'+hh;
    } 
    var mm = d.getMinutes();
    if(mm<10){
        mm='0'+mm;
    } 
    return hh+":"+mm;
}

function formatDateTime(d) {
	return formatDate(d)+" "+formatTime(d);
}

function formatDateTimeSec(d) {
	return formatDate(d)+" "+formatTimeSec(d);
}

function formatTimeSec(d) {
    var hh = d.getHours();
    if(hh<10){
    	hh='0'+hh;
    } 
    var mm = d.getMinutes();
    if(mm<10){
        mm='0'+mm;
    } 
    var ss = d.getSeconds();
    if(ss<10){
        ss='0'+ss;
    } 
    return hh+":"+mm+":"+ss;
}

function rainbow(numOfSteps, step) {
    // This function generates vibrant, "evenly spaced" colours (i.e. no clustering). This is ideal for creating easily distinguishable vibrant markers in Google Maps and other apps.
    // Adam Cole, 2011-Sept-14
    // HSV to RBG adapted from: http://mjijackson.com/2008/02/rgb-to-hsl-and-rgb-to-hsv-color-model-conversion-algorithms-in-javascript
    var r, g, b;
    var h = step / numOfSteps;
    var i = ~~(h * 6);
    var f = h * 6 - i;
    var q = 1 - f;
    switch(i % 6){
        case 0: r = 1, g = f, b = 0; break;
        case 1: r = q, g = 1, b = 0; break;
        case 2: r = 0, g = 1, b = f; break;
        case 3: r = 0, g = q, b = 1; break;
        case 4: r = f, g = 0, b = 1; break;
        case 5: r = 1, g = 0, b = q; break;
    }
    var c = "#" + ("00" + (~ ~(r * 255)).toString(16)).slice(-2) + ("00" + (~ ~(g * 255)).toString(16)).slice(-2) + ("00" + (~ ~(b * 255)).toString(16)).slice(-2);
    return (c);
}

function mobileAndTabletCheck() 
{
	  if (typeof navigator == "undefined")
		  return false;
	  var check = false;
	  (function(a){if(/(android|bb\d+|meego).+mobile|avantgo|bada\/|blackberry|blazer|compal|elaine|fennec|hiptop|iemobile|ip(hone|od)|iris|kindle|lge |maemo|midp|mmp|mobile.+firefox|netfront|opera m(ob|in)i|palm( os)?|phone|p(ixi|re)\/|plucker|pocket|psp|series(4|6)0|symbian|treo|up\.(browser|link)|vodafone|wap|windows ce|xda|xiino|android|ipad|playbook|silk/i.test(a)||/1207|6310|6590|3gso|4thp|50[1-6]i|770s|802s|a wa|abac|ac(er|oo|s\-)|ai(ko|rn)|al(av|ca|co)|amoi|an(ex|ny|yw)|aptu|ar(ch|go)|as(te|us)|attw|au(di|\-m|r |s )|avan|be(ck|ll|nq)|bi(lb|rd)|bl(ac|az)|br(e|v)w|bumb|bw\-(n|u)|c55\/|capi|ccwa|cdm\-|cell|chtm|cldc|cmd\-|co(mp|nd)|craw|da(it|ll|ng)|dbte|dc\-s|devi|dica|dmob|do(c|p)o|ds(12|\-d)|el(49|ai)|em(l2|ul)|er(ic|k0)|esl8|ez([4-7]0|os|wa|ze)|fetc|fly(\-|_)|g1 u|g560|gene|gf\-5|g\-mo|go(\.w|od)|gr(ad|un)|haie|hcit|hd\-(m|p|t)|hei\-|hi(pt|ta)|hp( i|ip)|hs\-c|ht(c(\-| |_|a|g|p|s|t)|tp)|hu(aw|tc)|i\-(20|go|ma)|i230|iac( |\-|\/)|ibro|idea|ig01|ikom|im1k|inno|ipaq|iris|ja(t|v)a|jbro|jemu|jigs|kddi|keji|kgt( |\/)|klon|kpt |kwc\-|kyo(c|k)|le(no|xi)|lg( g|\/(k|l|u)|50|54|\-[a-w])|libw|lynx|m1\-w|m3ga|m50\/|ma(te|ui|xo)|mc(01|21|ca)|m\-cr|me(rc|ri)|mi(o8|oa|ts)|mmef|mo(01|02|bi|de|do|t(\-| |o|v)|zz)|mt(50|p1|v )|mwbp|mywa|n10[0-2]|n20[2-3]|n30(0|2)|n50(0|2|5)|n7(0(0|1)|10)|ne((c|m)\-|on|tf|wf|wg|wt)|nok(6|i)|nzph|o2im|op(ti|wv)|oran|owg1|p800|pan(a|d|t)|pdxg|pg(13|\-([1-8]|c))|phil|pire|pl(ay|uc)|pn\-2|po(ck|rt|se)|prox|psio|pt\-g|qa\-a|qc(07|12|21|32|60|\-[2-7]|i\-)|qtek|r380|r600|raks|rim9|ro(ve|zo)|s55\/|sa(ge|ma|mm|ms|ny|va)|sc(01|h\-|oo|p\-)|sdk\/|se(c(\-|0|1)|47|mc|nd|ri)|sgh\-|shar|sie(\-|m)|sk\-0|sl(45|id)|sm(al|ar|b3|it|t5)|so(ft|ny)|sp(01|h\-|v\-|v )|sy(01|mb)|t2(18|50)|t6(00|10|18)|ta(gt|lk)|tcl\-|tdg\-|tel(i|m)|tim\-|t\-mo|to(pl|sh)|ts(70|m\-|m3|m5)|tx\-9|up(\.b|g1|si)|utst|v400|v750|veri|vi(rg|te)|vk(40|5[0-3]|\-v)|vm40|voda|vulc|vx(52|53|60|61|70|80|81|83|85|98)|w3c(\-| )|webc|whit|wi(g |nc|nw)|wmlb|wonu|x700|yas\-|your|zeto|zte\-/i.test(a.substr(0,4)))check = true})(navigator.userAgent||navigator.vendor||window.opera);
	  return check;
}

var RENDEREDARROWS={};
function renderArrowBase64(width,height,color) 
{
	var key = width+"x"+height+":"+color;
	if (RENDEREDARROWS[key])
		return RENDEREDARROWS[key];
	var brdcol = "#fefefe"; //increaseBrightness(color,99);
	
	var svg='<svg version="1.1" id="Layer_1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" x="0px" y="0px" width="'+width+'pt" height="'+height+'pt" '	
	+'viewBox="137.834 -82.833 114 91.333" enable-background="new 137.834 -82.833 114 91.333" xml:space="preserve">'
	+'<path fill="none" d="M-51-2.167h48v48h-48V-2.167z"/>'
	+'<circle display="none" fill="#605CC9" cx="51.286" cy="-35.286" r="88.786"/>'
	+'<path fill="#605CC9" stroke="#FFFFFF" stroke-width="4" stroke-miterlimit="10" d="M239.5-36.8l-92.558-35.69 c5.216,11.304,8.13,23.887,8.13,37.153c0,12.17-2.451,23.767-6.883,34.327L239.5-36.8z"/>'
	+'</svg>'
	var svg=svg.split("#605CC9").join(color);
	var canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvg(canvas, svg,{ ignoreMouse: true, ignoreAnimation: true });
    return RENDEREDARROWS[key]=canvas.toDataURL();
}

var RENDEREDDIRECTIONS={};
function renderDirectionBase64(width,height,color) 
{
	var key = width+"x"+height+":"+color;
	if (RENDEREDDIRECTIONS[key])
		return RENDEREDDIRECTIONS[key];

	var svg='<svg width="'+width+'pt" height="'+height+'pt" '

		+'viewBox="15 9 19.75 29.5" enable-background="new 15 9 19.75 29.5" xml:space="preserve">'
		+'<path fill="#FFFEFF" d="M17.17,32.92l9.17-9.17l-9.17-9.17L20,11.75l12,12l-12,12L17.17,32.92z"/>'
		+'<path fill="none" d="M0-0.25h48v48H0V-0.25z"/>'

	+'</svg>';

	var svg=svg.split("#000000").join(color);
	var canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvg(canvas, svg,{ ignoreMouse: true, ignoreAnimation: true });
    return RENDEREDDIRECTIONS[key]=canvas.toDataURL();
}

var RENDEREBOXES={};
function renderBoxBase64(width,height,color) 
{
	var key = width+"x"+height+":"+color;
	if (RENDEREBOXES[key])
		return RENDEREBOXES[key];

	var svg='<svg width="'+width+'pt" height="'+height+'pt" viewBox="0 0 512 512" version="1.1" xmlns="http://www.w3.org/2000/svg">'
	+'<g id="#ffffffff">'
	+'<path fill="#ffffff" opacity="1.00" d=" M 55.50 0.00 L 458.45 0.00 C 472.44 0.99 486.03 7.09 495.78 17.23 C 505.34 26.88 511.01 40.04 512.00 53.55 L 512.00 458.44 C 510.99 472.43 504.90 486.01 494.77 495.77 C 485.11 505.32 471.96 511.01 458.45 512.00 L 53.56 512.00 C 39.57 510.99 25.97 504.91 16.22 494.78 C 6.67 485.12 0.97 471.97 0.00 458.45 L 0.00 55.50 C 0.40 41.07 6.45 26.89 16.74 16.73 C 26.89 6.45 41.07 0.41 55.50 0.00 M 56.90 56.90 C 56.87 189.63 56.86 322.36 56.90 455.09 C 189.63 455.12 322.36 455.12 455.09 455.09 C 455.12 322.36 455.12 189.63 455.09 56.90 C 322.36 56.86 189.63 56.87 56.90 56.90 Z" />'
	+'</g>'
	+'<g id="#000000ff">'
	+'<path fill="#000000" opacity="1.00" d=" M 56.90 56.90 C 189.63 56.87 322.36 56.86 455.09 56.90 C 455.12 189.63 455.12 322.36 455.09 455.09 C 322.36 455.12 189.63 455.12 56.90 455.09 C 56.86 322.36 56.87 189.63 56.90 56.90 Z" />'
	+'</g>'
	+'</svg>';

	var svg=svg.split("#000000").join(color);
	var canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvg(canvas, svg,{ ignoreMouse: true, ignoreAnimation: true });
    return RENDEREBOXES[key]=canvas.toDataURL();
}


function interceptOnCircle(a,b,c,r) {
	return circleLineIntersect(a[0],a[1],b[0],b[1],c[0],c[1],r);	
}
function distp(p1,p2) {
	  return Math.sqrt((p2[0]-p1[0])*(p2[0]-p1[0])+(p2[1]-p1[1])*(p2[1]-p1[1]));
}

function circleLineIntersect(x1, y1, x2, y2, cx, cy, cr ) 
{
	  function dist(x1,y1,x2,y2) {
		  return Math.sqrt((x2-x1)*(x2-x1)+(y2-y1)*(y2-y1));
	  }
	  var dx = x2 - x1;
	  var dy = y2 - y1;
	  var a = dx * dx + dy * dy;
	  var b = 2 * (dx * (x1 - cx) + dy * (y1 - cy));
	  var c = cx * cx + cy * cy;
	  c += x1 * x1 + y1 * y1;
	  c -= 2 * (cx * x1 + cy * y1);
	  c -= cr * cr;
	  var bb4ac = b * b - 4 * a * c;
	  if (bb4ac < 0) {  // Not intersecting
	    return false;
	  } else {
		var mu = (-b + Math.sqrt( b*b - 4*a*c )) / (2*a);
		var ix1 = x1 + mu*(dx);
		var iy1 = y1 + mu*(dy);
	    mu = (-b - Math.sqrt(b*b - 4*a*c )) / (2*a);
	    var ix2 = x1 + mu*(dx);
	    var iy2 = y1 + mu*(dy);

	    // The intersection points
	    //ellipse(ix1, iy1, 10, 10);
	    //ellipse(ix2, iy2, 10, 10);
	    
	    var testX;
	    var testY;
	    // Figure out which point is closer to the circle
	    if (dist(x1, y1, cx, cy) < dist(x2, y2, cx, cy)) {
	      testX = x2;
	      testY = y2;
	    } else {
	      testX = x1;
	      testY = y1;
	    }
	     
	    if (dist(testX, testY, ix1, iy1) < dist(x1, y1, x2, y2) || dist(testX, testY, ix2, iy2) < dist(x1, y1, x2, y2)) {
	      return [ [ix1,iy1],[ix2,iy2] ];
	    } else {
	      return false;
	    }
	  }
}

function decodeBase64Image(dataString) {
	  var matches = dataString.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/),
	    response = {};
	  if (matches.length !== 3) {
	    return new Error('Invalid input string');
	  }
	  response.type = matches[1];
	  response.data = new Buffer(matches[2], 'base64');
	  return response;
	}

//------------------------
exports.myTrim=myTrim;
exports.myTrimCoordinate=myTrimCoordinate;
exports.closestProjectionOfPointOnLine=closestProjectionOfPointOnLine;
exports.colorLuminance=colorLuminance;
exports.increaseBrightness=increaseBrightness;
exports.colorAlphaArray=colorAlphaArray;
exports.escapeHTML=escapeHTML;
exports.formatNumber2=formatNumber2;
exports.formatDateTime=formatDateTime;
exports.formatDateTimeSec=formatDateTimeSec;
exports.formatDate=formatDate;
exports.formatTime=formatTime;
exports.rainbow=rainbow;
exports.mobileAndTabletCheck=mobileAndTabletCheck;
exports.renderArrowBase64=renderArrowBase64;
exports.renderDirectionBase64=renderDirectionBase64;
exports.renderBoxBase64=renderBoxBase64;
exports.interceptOnCircle=interceptOnCircle;
exports.distp=distp;
exports.circleLineIntersect=circleLineIntersect;
exports.MOBILE=mobileAndTabletCheck();
exports.WGS84SPHERE=new WGS84Sphere(6378137);
exports.formatTimeSec=formatTimeSec;
exports.decodeBase64Image=decodeBase64Image;
exports.isDefined=isDefined;
}).call(this,require("buffer").Buffer)

},{"buffer":1}],17:[function(require,module,exports){
module.exports = {
    RBTree: require('./lib/rbtree'),
    BinTree: require('./lib/bintree')
};

},{"./lib/bintree":18,"./lib/rbtree":19}],18:[function(require,module,exports){

var TreeBase = require('./treebase');

function Node(data) {
    this.data = data;
    this.left = null;
    this.right = null;
}

Node.prototype.get_child = function(dir) {
    return dir ? this.right : this.left;
};

Node.prototype.set_child = function(dir, val) {
    if(dir) {
        this.right = val;
    }
    else {
        this.left = val;
    }
};

function BinTree(comparator) {
    this._root = null;
    this._comparator = comparator;
    this.size = 0;
}

BinTree.prototype = new TreeBase();

// returns true if inserted, false if duplicate
BinTree.prototype.insert = function(data) {
    if(this._root === null) {
        // empty tree
        this._root = new Node(data);
        this.size++;
        return true;
    }

    var dir = 0;

    // setup
    var p = null; // parent
    var node = this._root;

    // search down
    while(true) {
        if(node === null) {
            // insert new node at the bottom
            node = new Node(data);
            p.set_child(dir, node);
            ret = true;
            this.size++;
            return true;
        }

        // stop if found
        if(this._comparator(node.data, data) === 0) {
            return false;
        }

        dir = this._comparator(node.data, data) < 0;

        // update helpers
        p = node;
        node = node.get_child(dir);
    }
};

// returns true if removed, false if not found
BinTree.prototype.remove = function(data) {
    if(this._root === null) {
        return false;
    }

    var head = new Node(undefined); // fake tree root
    var node = head;
    node.right = this._root;
    var p = null; // parent
    var found = null; // found item
    var dir = 1;

    while(node.get_child(dir) !== null) {
        p = node;
        node = node.get_child(dir);
        var cmp = this._comparator(data, node.data);
        dir = cmp > 0;

        if(cmp === 0) {
            found = node;
        }
    }

    if(found !== null) {
        found.data = node.data;
        p.set_child(p.right === node, node.get_child(node.left === null));

        this._root = head.right;
        this.size--;
        return true;
    }
    else {
        return false;
    }
};

module.exports = BinTree;


},{"./treebase":20}],19:[function(require,module,exports){

var TreeBase = require('./treebase');

function Node(data) {
    this.data = data;
    this.left = null;
    this.right = null;
    this.red = true;
}

Node.prototype.get_child = function(dir) {
    return dir ? this.right : this.left;
};

Node.prototype.set_child = function(dir, val) {
    if(dir) {
        this.right = val;
    }
    else {
        this.left = val;
    }
};

function RBTree(comparator) {
    this._root = null;
    this._comparator = comparator;
    this.size = 0;
}

RBTree.prototype = new TreeBase();

// returns true if inserted, false if duplicate
RBTree.prototype.insert = function(data) {
    var ret = false;

    if(this._root === null) {
        // empty tree
        this._root = new Node(data);
        ret = true;
        this.size++;
    }
    else {
        var head = new Node(undefined); // fake tree root

        var dir = 0;
        var last = 0;

        // setup
        var gp = null; // grandparent
        var ggp = head; // grand-grand-parent
        var p = null; // parent
        var node = this._root;
        ggp.right = this._root;

        // search down
        while(true) {
            if(node === null) {
                // insert new node at the bottom
                node = new Node(data);
                p.set_child(dir, node);
                ret = true;
                this.size++;
            }
            else if(is_red(node.left) && is_red(node.right)) {
                // color flip
                node.red = true;
                node.left.red = false;
                node.right.red = false;
            }

            // fix red violation
            if(is_red(node) && is_red(p)) {
                var dir2 = ggp.right === gp;

                if(node === p.get_child(last)) {
                    ggp.set_child(dir2, single_rotate(gp, !last));
                }
                else {
                    ggp.set_child(dir2, double_rotate(gp, !last));
                }
            }

            var cmp = this._comparator(node.data, data);

            // stop if found
            if(cmp === 0) {
                break;
            }

            last = dir;
            dir = cmp < 0;

            // update helpers
            if(gp !== null) {
                ggp = gp;
            }
            gp = p;
            p = node;
            node = node.get_child(dir);
        }

        // update root
        this._root = head.right;
    }

    // make root black
    this._root.red = false;

    return ret;
};

// returns true if removed, false if not found
RBTree.prototype.remove = function(data) {
    if(this._root === null) {
        return false;
    }

    var head = new Node(undefined); // fake tree root
    var node = head;
    node.right = this._root;
    var p = null; // parent
    var gp = null; // grand parent
    var found = null; // found item
    var dir = 1;

    while(node.get_child(dir) !== null) {
        var last = dir;

        // update helpers
        gp = p;
        p = node;
        node = node.get_child(dir);

        var cmp = this._comparator(data, node.data);

        dir = cmp > 0;

        // save found node
        if(cmp === 0) {
            found = node;
        }

        // push the red node down
        if(!is_red(node) && !is_red(node.get_child(dir))) {
            if(is_red(node.get_child(!dir))) {
                var sr = single_rotate(node, dir);
                p.set_child(last, sr);
                p = sr;
            }
            else if(!is_red(node.get_child(!dir))) {
                var sibling = p.get_child(!last);
                if(sibling !== null) {
                    if(!is_red(sibling.get_child(!last)) && !is_red(sibling.get_child(last))) {
                        // color flip
                        p.red = false;
                        sibling.red = true;
                        node.red = true;
                    }
                    else {
                        var dir2 = gp.right === p;

                        if(is_red(sibling.get_child(last))) {
                            gp.set_child(dir2, double_rotate(p, last));
                        }
                        else if(is_red(sibling.get_child(!last))) {
                            gp.set_child(dir2, single_rotate(p, last));
                        }

                        // ensure correct coloring
                        var gpc = gp.get_child(dir2);
                        gpc.red = true;
                        node.red = true;
                        gpc.left.red = false;
                        gpc.right.red = false;
                    }
                }
            }
        }
    }

    // replace and remove if found
    if(found !== null) {
        found.data = node.data;
        p.set_child(p.right === node, node.get_child(node.left === null));
        this.size--;
    }

    // update root and make it black
    this._root = head.right;
    if(this._root !== null) {
        this._root.red = false;
    }

    return found !== null;
};

function is_red(node) {
    return node !== null && node.red;
}

function single_rotate(root, dir) {
    var save = root.get_child(!dir);

    root.set_child(!dir, save.get_child(dir));
    save.set_child(dir, root);

    root.red = true;
    save.red = false;

    return save;
}

function double_rotate(root, dir) {
    root.set_child(!dir, single_rotate(root.get_child(!dir), !dir));
    return single_rotate(root, dir);
}

module.exports = RBTree;

},{"./treebase":20}],20:[function(require,module,exports){

function TreeBase() {}

// removes all nodes from the tree
TreeBase.prototype.clear = function() {
    this._root = null;
    this.size = 0;
};

// returns node data if found, null otherwise
TreeBase.prototype.find = function(data) {
    var res = this._root;

    while(res !== null) {
        var c = this._comparator(data, res.data);
        if(c === 0) {
            return res.data;
        }
        else {
            res = res.get_child(c > 0);
        }
    }

    return null;
};

// returns iterator to node if found, null otherwise
TreeBase.prototype.findIter = function(data) {
    var res = this._root;
    var iter = this.iterator();

    while(res !== null) {
        var c = this._comparator(data, res.data);
        if(c === 0) {
            iter._cursor = res;
            return iter;
        }
        else {
            iter._ancestors.push(res);
            res = res.get_child(c > 0);
        }
    }

    return null;
};

// Returns an iterator to the tree node at or immediately after the item
TreeBase.prototype.lowerBound = function(item) {
    var cur = this._root;
    var iter = this.iterator();
    var cmp = this._comparator;

    while(cur !== null) {
        var c = cmp(item, cur.data);
        if(c === 0) {
            iter._cursor = cur;
            return iter;
        }
        iter._ancestors.push(cur);
        cur = cur.get_child(c > 0);
    }

    for(var i=iter._ancestors.length - 1; i >= 0; --i) {
        cur = iter._ancestors[i];
        if(cmp(item, cur.data) < 0) {
            iter._cursor = cur;
            iter._ancestors.length = i;
            return iter;
        }
    }

    iter._ancestors.length = 0;
    return iter;
};

// Returns an iterator to the tree node immediately after the item
TreeBase.prototype.upperBound = function(item) {
    var iter = this.lowerBound(item);
    var cmp = this._comparator;

    while(iter.data() !== null && cmp(iter.data(), item) === 0) {
        iter.next();
    }

    return iter;
};

// returns null if tree is empty
TreeBase.prototype.min = function() {
    var res = this._root;
    if(res === null) {
        return null;
    }

    while(res.left !== null) {
        res = res.left;
    }

    return res.data;
};

// returns null if tree is empty
TreeBase.prototype.max = function() {
    var res = this._root;
    if(res === null) {
        return null;
    }

    while(res.right !== null) {
        res = res.right;
    }

    return res.data;
};

// returns a null iterator
// call next() or prev() to point to an element
TreeBase.prototype.iterator = function() {
    return new Iterator(this);
};

// calls cb on each node's data, in order
TreeBase.prototype.each = function(cb) {
    var it=this.iterator(), data;
    while((data = it.next()) !== null) {
        cb(data);
    }
};

// calls cb on each node's data, in reverse order
TreeBase.prototype.reach = function(cb) {
    var it=this.iterator(), data;
    while((data = it.prev()) !== null) {
        cb(data);
    }
};


function Iterator(tree) {
    this._tree = tree;
    this._ancestors = [];
    this._cursor = null;
}

Iterator.prototype.data = function() {
    return this._cursor !== null ? this._cursor.data : null;
};

// if null-iterator, returns first node
// otherwise, returns next node
Iterator.prototype.next = function() {
    if(this._cursor === null) {
        var root = this._tree._root;
        if(root !== null) {
            this._minNode(root);
        }
    }
    else {
        if(this._cursor.right === null) {
            // no greater node in subtree, go up to parent
            // if coming from a right child, continue up the stack
            var save;
            do {
                save = this._cursor;
                if(this._ancestors.length) {
                    this._cursor = this._ancestors.pop();
                }
                else {
                    this._cursor = null;
                    break;
                }
            } while(this._cursor.right === save);
        }
        else {
            // get the next node from the subtree
            this._ancestors.push(this._cursor);
            this._minNode(this._cursor.right);
        }
    }
    return this._cursor !== null ? this._cursor.data : null;
};

// if null-iterator, returns last node
// otherwise, returns previous node
Iterator.prototype.prev = function() {
    if(this._cursor === null) {
        var root = this._tree._root;
        if(root !== null) {
            this._maxNode(root);
        }
    }
    else {
        if(this._cursor.left === null) {
            var save;
            do {
                save = this._cursor;
                if(this._ancestors.length) {
                    this._cursor = this._ancestors.pop();
                }
                else {
                    this._cursor = null;
                    break;
                }
            } while(this._cursor.left === save);
        }
        else {
            this._ancestors.push(this._cursor);
            this._maxNode(this._cursor.left);
        }
    }
    return this._cursor !== null ? this._cursor.data : null;
};

Iterator.prototype._minNode = function(start) {
    while(start.left !== null) {
        this._ancestors.push(start);
        start = start.left;
    }
    this._cursor = start;
};

Iterator.prototype._maxNode = function(start) {
    while(start.right !== null) {
        this._ancestors.push(start);
        start = start.right;
    }
    this._cursor = start;
};

module.exports = TreeBase;


},{}],21:[function(require,module,exports){
(function (process,global){
;!function () {;
var Joose = {}

// configuration hash

Joose.C             = typeof JOOSE_CFG != 'undefined' ? JOOSE_CFG : {}

Joose.is_IE         = '\v' == 'v'
Joose.is_NodeJS     = Boolean(typeof process != 'undefined' && process.pid)


Joose.top           = Joose.is_NodeJS && global || this

Joose.stub          = function () {
    return function () { throw new Error("Modules can not be instantiated") }
}


Joose.VERSION       = ({ /*PKGVERSION*/VERSION : '3.50.0' }).VERSION


if (typeof module != 'undefined') module.exports = Joose
/*if (!Joose.is_NodeJS) */
this.Joose = Joose


// Static helpers for Arrays
Joose.A = {

    each : function (array, func, scope) {
        scope = scope || this
        
        for (var i = 0, len = array.length; i < len; i++) 
            if (func.call(scope, array[i], i) === false) return false
    },
    
    
    eachR : function (array, func, scope) {
        scope = scope || this

        for (var i = array.length - 1; i >= 0; i--) 
            if (func.call(scope, array[i], i) === false) return false
    },
    
    
    exists : function (array, value) {
        for (var i = 0, len = array.length; i < len; i++) if (array[i] == value) return true
            
        return false
    },
    
    
    map : function (array, func, scope) {
        scope = scope || this
        
        var res = []
        
        for (var i = 0, len = array.length; i < len; i++) 
            res.push( func.call(scope, array[i], i) )
            
        return res
    },
    

    grep : function (array, func) {
        var a = []
        
        Joose.A.each(array, function (t) {
            if (func(t)) a.push(t)
        })
        
        return a
    },
    
    
    remove : function (array, removeEle) {
        var a = []
        
        Joose.A.each(array, function (t) {
            if (t !== removeEle) a.push(t)
        })
        
        return a
    }
    
}

// Static helpers for Strings
Joose.S = {
    
    saneSplit : function (str, delimeter) {
        var res = (str || '').split(delimeter)
        
        if (res.length == 1 && !res[0]) res.shift()
        
        return res
    },
    

    uppercaseFirst : function (string) { 
        return string.substr(0, 1).toUpperCase() + string.substr(1, string.length - 1)
    },
    
    
    strToClass : function (name, top) {
        var current = top || Joose.top
        
        Joose.A.each(name.split('.'), function (segment) {
            if (current) 
                current = current[ segment ]
            else
                return false
        })
        
        return current
    }
}

var baseFunc    = function () {}

// Static helpers for objects
Joose.O = {

    each : function (object, func, scope) {
        scope = scope || this
        
        for (var i in object) 
            if (func.call(scope, object[i], i) === false) return false
        
        if (Joose.is_IE) 
            return Joose.A.each([ 'toString', 'constructor', 'hasOwnProperty' ], function (el) {
                
                if (object.hasOwnProperty(el)) return func.call(scope, object[el], el)
            })
    },
    
    
    eachOwn : function (object, func, scope) {
        scope = scope || this
        
        return Joose.O.each(object, function (value, name) {
            if (object.hasOwnProperty(name)) return func.call(scope, value, name)
        }, scope)
    },
    
    
    copy : function (source, target) {
        target = target || {}
        
        Joose.O.each(source, function (value, name) { target[name] = value })
        
        return target
    },
    
    
    copyOwn : function (source, target) {
        target = target || {}
        
        Joose.O.eachOwn(source, function (value, name) { target[name] = value })
        
        return target
    },
    
    
    getMutableCopy : function (object) {
        baseFunc.prototype = object
        
        return new baseFunc()
    },
    
    
    extend : function (target, source) {
        return Joose.O.copy(source, target)
    },
    
    
    isEmpty : function (object) {
        for (var i in object) if (object.hasOwnProperty(i)) return false
        
        return true
    },
    
    
    isInstance: function (obj) {
        return obj && obj.meta && obj.constructor == obj.meta.c
    },
    
    
    isClass : function (obj) {
        return obj && obj.meta && obj.meta.c == obj
    },
    
    
    wantArray : function (obj) {
        if (obj instanceof Array) return obj
        
        return [ obj ]
    },
    
    
    // this was a bug in WebKit, which gives typeof / / == 'function'
    // should be monitored and removed at some point in the future
    isFunction : function (obj) {
        return typeof obj == 'function' && obj.constructor != / /.constructor
    }
}


//initializers

Joose.I = {
    Array       : function () { return [] },
    Object      : function () { return {} },
    Function    : function () { return arguments.callee },
    Now         : function () { return new Date() }
};
Joose.Proto = Joose.stub()

Joose.Proto.Empty = Joose.stub()
    
Joose.Proto.Empty.meta = {};
;(function () {

    Joose.Proto.Object = Joose.stub()
    
    
    var SUPER = function () {
        var self = SUPER.caller
        
        if (self == SUPERARG) self = self.caller
        
        if (!self.SUPER) throw "Invalid call to SUPER"
        
        return self.SUPER[self.methodName].apply(this, arguments)
    }
    
    
    var SUPERARG = function () {
        return this.SUPER.apply(this, arguments[0])
    }
    
    
    
    Joose.Proto.Object.prototype = {
        
        SUPERARG : SUPERARG,
        SUPER : SUPER,
        
        INNER : function () {
            throw "Invalid call to INNER"
        },                
        
        
        BUILD : function (config) {
            return arguments.length == 1 && typeof config == 'object' && config || {}
        },
        
        
        initialize: function () {
        },
        
        
        toString: function () {
            return "a " + this.meta.name
        }
        
    }
        
    Joose.Proto.Object.meta = {
        constructor     : Joose.Proto.Object,
        
        methods         : Joose.O.copy(Joose.Proto.Object.prototype),
        attributes      : {}
    }
    
    Joose.Proto.Object.prototype.meta = Joose.Proto.Object.meta

})();
;(function () {

    Joose.Proto.Class = function () {
        return this.initialize(this.BUILD.apply(this, arguments)) || this
    }
    
    var bootstrap = {
        
        VERSION             : null,
        AUTHORITY           : null,
        
        constructor         : Joose.Proto.Class,
        superClass          : null,
        
        name                : null,
        
        attributes          : null,
        methods             : null,
        
        meta                : null,
        c                   : null,
        
        defaultSuperClass   : Joose.Proto.Object,
        
        
        BUILD : function (name, extend) {
            this.name = name
            
            return { __extend__ : extend || {} }
        },
        
        
        initialize: function (props) {
            var extend      = props.__extend__
            
            this.VERSION    = extend.VERSION
            this.AUTHORITY  = extend.AUTHORITY
            
            delete extend.VERSION
            delete extend.AUTHORITY
            
            this.c = this.extractConstructor(extend)
            
            this.adaptConstructor(this.c)
            
            if (extend.constructorOnly) {
                delete extend.constructorOnly
                return
            }
            
            this.construct(extend)
        },
        
        
        construct : function (extend) {
            if (!this.prepareProps(extend)) return
            
            var superClass = this.superClass = this.extractSuperClass(extend)
            
            this.processSuperClass(superClass)
            
            this.adaptPrototype(this.c.prototype)
            
            this.finalize(extend)
        },
        
        
        finalize : function (extend) {
            this.processStem(extend)
            
            this.extend(extend)
        },
        
        
        //if the extension returns false from this method it should re-enter 'construct'
        prepareProps : function (extend) {
            return true
        },
        
        
        extractConstructor : function (extend) {
            var res = extend.hasOwnProperty('constructor') ? extend.constructor : this.defaultConstructor()
            
            delete extend.constructor
            
            return res
        },
        
        
        extractSuperClass : function (extend) {
            if (extend.hasOwnProperty('isa') && !extend.isa) throw new Error("Attempt to inherit from undefined superclass [" + this.name + "]")
            
            var res = extend.isa || this.defaultSuperClass
            
            delete extend.isa
            
            return res
        },
        
        
        processStem : function () {
            var superMeta       = this.superClass.meta
            
            this.methods        = Joose.O.getMutableCopy(superMeta.methods || {})
            this.attributes     = Joose.O.getMutableCopy(superMeta.attributes || {})
        },
        
        
        initInstance : function (instance, props) {
            Joose.O.copyOwn(props, instance)
        },
        
        
        defaultConstructor: function () {
            return function (arg) {
                var BUILD = this.BUILD
                
                var args = BUILD && BUILD.apply(this, arguments) || arg || {}
                
                var thisMeta    = this.meta
                
                thisMeta.initInstance(this, args)
                
                return thisMeta.hasMethod('initialize') && this.initialize(args) || this
            }
        },
        
        
        processSuperClass: function (superClass) {
            var superProto      = superClass.prototype
            
            //non-Joose superclasses
            if (!superClass.meta) {
                
                var extend = Joose.O.copy(superProto)
                
                extend.isa = Joose.Proto.Empty
                // clear potential value in the `extend.constructor` to prevent it from being modified
                delete extend.constructor
                
                var meta = new this.defaultSuperClass.meta.constructor(null, extend)
                
                superClass.meta = superProto.meta = meta
                
                meta.c = superClass
            }
            
            this.c.prototype    = Joose.O.getMutableCopy(superProto)
            this.c.superClass   = superProto
        },
        
        
        adaptConstructor: function (c) {
            c.meta = this
            
            if (!c.hasOwnProperty('toString')) c.toString = function () { return this.meta.name }
        },
    
        
        adaptPrototype: function (proto) {
            //this will fix weird semantic of native "constructor" property to more intuitive (idea borrowed from Ext)
            proto.constructor   = this.c
            proto.meta          = this
        },
        
        
        addMethod: function (name, func) {
            func.SUPER = this.superClass.prototype
            
            //chrome don't allow to redefine the "name" property
            func.methodName = name
            
            this.methods[name] = func
            this.c.prototype[name] = func
        },
        
        
        addAttribute: function (name, init) {
            this.attributes[name] = init
            this.c.prototype[name] = init
        },
        
        
        removeMethod : function (name) {
            delete this.methods[name]
            delete this.c.prototype[name]
        },
    
        
        removeAttribute: function (name) {
            delete this.attributes[name]
            delete this.c.prototype[name]
        },
        
        
        hasMethod: function (name) { 
            return Boolean(this.methods[name])
        },
        
        
        hasAttribute: function (name) { 
            return this.attributes[name] !== undefined
        },
        
    
        hasOwnMethod: function (name) { 
            return this.hasMethod(name) && this.methods.hasOwnProperty(name)
        },
        
        
        hasOwnAttribute: function (name) { 
            return this.hasAttribute(name) && this.attributes.hasOwnProperty(name)
        },
        
        
        extend : function (props) {
            Joose.O.eachOwn(props, function (value, name) {
                if (name != 'meta' && name != 'constructor') 
                    if (Joose.O.isFunction(value) && !value.meta) 
                        this.addMethod(name, value) 
                    else 
                        this.addAttribute(name, value)
            }, this)
        },
        
        
        subClassOf : function (classObject, extend) {
            return this.subClass(extend, null, classObject)
        },
    
    
        subClass : function (extend, name, classObject) {
            extend      = extend        || {}
            extend.isa  = classObject   || this.c
            
            return new this.constructor(name, extend).c
        },
        
        
        instantiate : function () {
            var f = function () {}
            
            f.prototype = this.c.prototype
            
            var obj = new f()
            
            return this.c.apply(obj, arguments) || obj
        }
    }
    
    //micro bootstraping
    
    Joose.Proto.Class.prototype = Joose.O.getMutableCopy(Joose.Proto.Object.prototype)
    
    Joose.O.extend(Joose.Proto.Class.prototype, bootstrap)
    
    Joose.Proto.Class.prototype.meta = new Joose.Proto.Class('Joose.Proto.Class', bootstrap)
    
    
    
    Joose.Proto.Class.meta.addMethod('isa', function (someClass) {
        var f = function () {}
        
        f.prototype = this.c.prototype
        
        return new f() instanceof someClass
    })
})();
Joose.Managed = Joose.stub()

Joose.Managed.Property = new Joose.Proto.Class('Joose.Managed.Property', {
    
    name            : null,
    
    init            : null,
    value           : null,
    
    definedIn       : null,
    
    
    initialize : function (props) {
        Joose.Managed.Property.superClass.initialize.call(this, props)
        
        this.computeValue()
    },
    
    
    computeValue : function () {
        this.value = this.init
    },    
    
    
    //targetClass is still open at this stage
    preApply : function (targetClass) {
    },
    

    //targetClass is already open at this stage
    postUnApply : function (targetClass) {
    },
    
    
    apply : function (target) {
        target[this.name] = this.value
    },
    
    
    isAppliedTo : function (target) {
        return target[this.name] == this.value
    },
    
    
    unapply : function (from) {
        if (!this.isAppliedTo(from)) throw "Unapply of property [" + this.name + "] from [" + from + "] failed"
        
        delete from[this.name]
    },
    
    
    cloneProps : function () {
        return {
            name        : this.name, 
            init        : this.init,
            definedIn   : this.definedIn
        }
    },

    
    clone : function (name) {
        var props = this.cloneProps()
        
        props.name = name || props.name
        
        return new this.constructor(props)
    }
    
    
}).c;
Joose.Managed.Property.ConflictMarker = new Joose.Proto.Class('Joose.Managed.Property.ConflictMarker', {
    
    isa : Joose.Managed.Property,

    apply : function (target) {
        throw new Error("Attempt to apply ConflictMarker [" + this.name + "] to [" + target + "]")
    }
    
}).c;
Joose.Managed.Property.Requirement = new Joose.Proto.Class('Joose.Managed.Property.Requirement', {
    
    isa : Joose.Managed.Property,

    
    apply : function (target) {
        if (!target.meta.hasMethod(this.name)) 
            throw new Error("Requirement [" + this.name + "], defined in [" + this.definedIn.definedIn.name + "] is not satisfied for class [" + target + "]")
    },
    
    
    unapply : function (from) {
    }
    
}).c;
Joose.Managed.Property.Attribute = new Joose.Proto.Class('Joose.Managed.Property.Attribute', {
    
    isa : Joose.Managed.Property,
    
    slot                : null,
    
    
    initialize : function () {
        Joose.Managed.Property.Attribute.superClass.initialize.apply(this, arguments)
        
        this.slot = this.name
    },
    
    
    apply : function (target) {
        target.prototype[ this.slot ] = this.value
    },
    
    
    isAppliedTo : function (target) {
        return target.prototype[ this.slot ] == this.value
    },
    
    
    unapply : function (from) {
        if (!this.isAppliedTo(from)) throw "Unapply of property [" + this.name + "] from [" + from + "] failed"
        
        delete from.prototype[this.slot]
    },
    
    
    clearValue : function (instance) {
        delete instance[ this.slot ]
    },
    
    
    hasValue : function (instance) {
        return instance.hasOwnProperty(this.slot)
    },
        
        
    getRawValueFrom : function (instance) {
        return instance[ this.slot ]
    },
    
    
    setRawValueTo : function (instance, value) {
        instance[ this.slot ] = value
        
        return this
    }
    
}).c;
Joose.Managed.Property.MethodModifier = new Joose.Proto.Class('Joose.Managed.Property.MethodModifier', {
    
    isa : Joose.Managed.Property,

    
    prepareWrapper : function () {
        throw "Abstract method [prepareWrapper] of " + this + " was called"
    },
    
    
    apply : function (target) {
        var name            = this.name
        var targetProto     = target.prototype
        var isOwn           = targetProto.hasOwnProperty(name)
        var original        = targetProto[name]
        var superProto      = target.meta.superClass.prototype
        
        
        var originalCall = isOwn ? original : function () { 
            return superProto[name].apply(this, arguments) 
        }
        
        var methodWrapper = this.prepareWrapper({
            name            : name,
            modifier        : this.value, 
            
            isOwn           : isOwn,
            originalCall    : originalCall, 
            
            superProto      : superProto,
            
            target          : target
        })
        
        if (isOwn) methodWrapper.__ORIGINAL__ = original
        
        methodWrapper.__CONTAIN__   = this.value
        methodWrapper.__METHOD__    = this
        
        targetProto[name] = methodWrapper
    },
    
    
    isAppliedTo : function (target) {
        var targetCont = target.prototype[this.name]
        
        return targetCont && targetCont.__CONTAIN__ == this.value
    },
    
    
    unapply : function (from) {
        var name = this.name
        var fromProto = from.prototype
        var original = fromProto[name].__ORIGINAL__
        
        if (!this.isAppliedTo(from)) throw "Unapply of method [" + name + "] from class [" + from + "] failed"
        
        //if modifier was applied to own method - restore it
        if (original) 
            fromProto[name] = original
        //otherwise - just delete it, to reveal the inherited method 
        else
            delete fromProto[name]
    }
    
}).c;
Joose.Managed.Property.MethodModifier.Override = new Joose.Proto.Class('Joose.Managed.Property.MethodModifier.Override', {
    
    isa : Joose.Managed.Property.MethodModifier,

    
    prepareWrapper : function (params) {
        
        var modifier        = params.modifier
        var originalCall    = params.originalCall
        var superProto      = params.superProto
        var superMetaConst  = superProto.meta.constructor
        
        //call to Joose.Proto level, require some additional processing
        var isCallToProto = (superMetaConst == Joose.Proto.Class || superMetaConst == Joose.Proto.Object) && !(params.isOwn && originalCall.IS_OVERRIDE) 
        
        var original = originalCall
        
        if (isCallToProto) original = function () {
            var beforeSUPER = this.SUPER
            
            this.SUPER  = superProto.SUPER
            
            var res = originalCall.apply(this, arguments)
            
            this.SUPER = beforeSUPER
            
            return res
        }

        var override = function () {
            
            var beforeSUPER = this.SUPER
            
            this.SUPER  = original
            
            var res = modifier.apply(this, arguments)
            
            this.SUPER = beforeSUPER
            
            return res
        }
        
        override.IS_OVERRIDE = true
        
        return override
    }
    
    
}).c;
Joose.Managed.Property.MethodModifier.Put = new Joose.Proto.Class('Joose.Managed.Property.MethodModifier.Put', {
    
    isa : Joose.Managed.Property.MethodModifier.Override,


    prepareWrapper : function (params) {
        
        if (params.isOwn) throw "Method [" + params.name + "] is applying over something [" + params.originalCall + "] in class [" + params.target + "]"
        
        return Joose.Managed.Property.MethodModifier.Put.superClass.prepareWrapper.call(this, params)
    }
    
    
}).c;
Joose.Managed.Property.MethodModifier.After = new Joose.Proto.Class('Joose.Managed.Property.MethodModifier.After', {
    
    isa : Joose.Managed.Property.MethodModifier,

    
    prepareWrapper : function (params) {
        
        var modifier        = params.modifier
        var originalCall    = params.originalCall
        
        return function () {
            var res = originalCall.apply(this, arguments)
            modifier.apply(this, arguments)
            return res
        }
    }    

    
}).c;
Joose.Managed.Property.MethodModifier.Before = new Joose.Proto.Class('Joose.Managed.Property.MethodModifier.Before', {
    
    isa : Joose.Managed.Property.MethodModifier,

    
    prepareWrapper : function (params) {
        
        var modifier        = params.modifier
        var originalCall    = params.originalCall
        
        return function () {
            modifier.apply(this, arguments)
            return originalCall.apply(this, arguments)
        }
    }
    
}).c;
Joose.Managed.Property.MethodModifier.Around = new Joose.Proto.Class('Joose.Managed.Property.MethodModifier.Around', {
    
    isa : Joose.Managed.Property.MethodModifier,

    prepareWrapper : function (params) {
        
        var modifier        = params.modifier
        var originalCall    = params.originalCall
        
        var me
        
        var bound = function () {
            return originalCall.apply(me, arguments)
        }
            
        return function () {
            me = this
            
            var boundArr = [ bound ]
            boundArr.push.apply(boundArr, arguments)
            
            return modifier.apply(this, boundArr)
        }
    }
    
}).c;
Joose.Managed.Property.MethodModifier.Augment = new Joose.Proto.Class('Joose.Managed.Property.MethodModifier.Augment', {
    
    isa : Joose.Managed.Property.MethodModifier,

    
    prepareWrapper : function (params) {
        
        var AUGMENT = function () {
            
            //populate callstack to the most deep non-augment method
            var callstack = []
            
            var self = AUGMENT
            
            do {
                callstack.push(self.IS_AUGMENT ? self.__CONTAIN__ : self)
                
                self = self.IS_AUGMENT && (self.__ORIGINAL__ || self.SUPER[self.methodName])
            } while (self)
            
            
            //save previous INNER
            var beforeINNER = this.INNER
            
            //create new INNER
            this.INNER = function () {
                var innerCall = callstack.pop()
                
                return innerCall ? innerCall.apply(this, arguments) : undefined
            }
            
            //augment modifier results in hypotetical INNER call of the same method in subclass 
            var res = this.INNER.apply(this, arguments)
            
            //restore previous INNER chain
            this.INNER = beforeINNER
            
            return res
        }
        
        AUGMENT.methodName  = params.name
        AUGMENT.SUPER       = params.superProto
        AUGMENT.IS_AUGMENT  = true
        
        return AUGMENT
    }
    
}).c;
Joose.Managed.PropertySet = new Joose.Proto.Class('Joose.Managed.PropertySet', {
    
    isa                       : Joose.Managed.Property,

    properties                : null,
    
    propertyMetaClass         : Joose.Managed.Property,
    
    
    initialize : function (props) {
        Joose.Managed.PropertySet.superClass.initialize.call(this, props)
        
        //XXX this guards the meta roles :)
        this.properties = props.properties || {}
    },
    
    
    addProperty : function (name, props) {
        var metaClass = props.meta || this.propertyMetaClass
        delete props.meta
        
        props.definedIn     = this
        props.name          = name
        
        return this.properties[name] = new metaClass(props)
    },
    
    
    addPropertyObject : function (object) {
        return this.properties[object.name] = object
    },
    
    
    removeProperty : function (name) {
        var prop = this.properties[name]
        
        delete this.properties[name]
        
        return prop
    },
    
    
    haveProperty : function (name) {
        return this.properties[name] != null
    },
    

    haveOwnProperty : function (name) {
        return this.haveProperty(name) && this.properties.hasOwnProperty(name)
    },
    
    
    getProperty : function (name) {
        return this.properties[name]
    },
    
    
    //includes inherited properties (probably you wants 'eachOwn', which process only "own" (including consumed from Roles) properties) 
    each : function (func, scope) {
        Joose.O.each(this.properties, func, scope || this)
    },
    
    
    eachOwn : function (func, scope) {
        Joose.O.eachOwn(this.properties, func, scope || this)
    },
    
    
    //synonym for each
    eachAll : function (func, scope) {
        this.each(func, scope)
    },
    
    
    cloneProps : function () {
        var props = Joose.Managed.PropertySet.superClass.cloneProps.call(this)
        
        props.propertyMetaClass     = this.propertyMetaClass
        
        return props
    },
    
    
    clone : function (name) {
        var clone = this.cleanClone(name)
        
        clone.properties = Joose.O.copyOwn(this.properties)
        
        return clone
    },
    
    
    cleanClone : function (name) {
        var props = this.cloneProps()
        
        props.name = name || props.name
        
        return new this.constructor(props)
    },
    
    
    alias : function (what) {
        var props = this.properties
        
        Joose.O.each(what, function (aliasName, originalName) {
            var original = props[originalName]
            
            if (original) this.addPropertyObject(original.clone(aliasName))
        }, this)
    },
    
    
    exclude : function (what) {
        var props = this.properties
        
        Joose.A.each(what, function (name) {
            delete props[name]
        })
    },
    
    
    beforeConsumedBy : function () {
    },
    
    
    flattenTo : function (target) {
        var targetProps = target.properties
        
        this.eachOwn(function (property, name) {
            var targetProperty = targetProps[name]
            
            if (targetProperty instanceof Joose.Managed.Property.ConflictMarker) return
            
            if (!targetProps.hasOwnProperty(name) || targetProperty == null) {
                target.addPropertyObject(property)
                return
            }
            
            if (targetProperty == property) return
            
            target.removeProperty(name)
            target.addProperty(name, {
                meta : Joose.Managed.Property.ConflictMarker
            })
        }, this)
    },
    
    
    composeTo : function (target) {
        this.eachOwn(function (property, name) {
            if (!target.haveOwnProperty(name)) target.addPropertyObject(property)
        })
    },
    
    
    composeFrom : function () {
        if (!arguments.length) return
        
        var flattening = this.cleanClone()
        
        Joose.A.each(arguments, function (arg) {
            var isDescriptor    = !(arg instanceof Joose.Managed.PropertySet)
            var propSet         = isDescriptor ? arg.propertySet : arg
            
            propSet.beforeConsumedBy(this, flattening)
            
            if (isDescriptor) {
                if (arg.alias || arg.exclude)   propSet = propSet.clone()
                if (arg.alias)                  propSet.alias(arg.alias)
                if (arg.exclude)                propSet.exclude(arg.exclude)
            }
            
            propSet.flattenTo(flattening)
        }, this)
        
        flattening.composeTo(this)
    },
    
    
    preApply : function (target) {
        this.eachOwn(function (property) {
            property.preApply(target)
        })
    },
    
    
    apply : function (target) {
        this.eachOwn(function (property) {
            property.apply(target)
        })
    },
    
    
    unapply : function (from) {
        this.eachOwn(function (property) {
            property.unapply(from)
        })
    },
    
    
    postUnApply : function (target) {
        this.eachOwn(function (property) {
            property.postUnApply(target)
        })
    }
    
}).c
;
var __ID__ = 1


Joose.Managed.PropertySet.Mutable = new Joose.Proto.Class('Joose.Managed.PropertySet.Mutable', {
    
    isa                 : Joose.Managed.PropertySet,

    ID                  : null,
    
    derivatives         : null,
    
    opened              : null,
    
    composedFrom        : null,
    
    
    initialize : function (props) {
        Joose.Managed.PropertySet.Mutable.superClass.initialize.call(this, props)
        
        //initially opened
        this.opened             = 1
        this.derivatives        = {}
        this.ID                 = __ID__++
        this.composedFrom       = []
    },
    
    
    addComposeInfo : function () {
        this.ensureOpen()
        
        Joose.A.each(arguments, function (arg) {
            this.composedFrom.push(arg)
            
            var propSet = arg instanceof Joose.Managed.PropertySet ? arg : arg.propertySet
                
            propSet.derivatives[this.ID] = this
        }, this)
    },
    
    
    removeComposeInfo : function () {
        this.ensureOpen()
        
        Joose.A.each(arguments, function (arg) {
            
            var i = 0
            
            while (i < this.composedFrom.length) {
                var propSet = this.composedFrom[i]
                propSet = propSet instanceof Joose.Managed.PropertySet ? propSet : propSet.propertySet
                
                if (arg == propSet) {
                    delete propSet.derivatives[this.ID]
                    this.composedFrom.splice(i, 1)
                } else i++
            }
            
        }, this)
    },
    
    
    ensureOpen : function () {
        if (!this.opened) throw "Mutation of closed property set: [" + this.name + "]"
    },
    
    
    addProperty : function (name, props) {
        this.ensureOpen()
        
        return Joose.Managed.PropertySet.Mutable.superClass.addProperty.call(this, name, props)
    },
    

    addPropertyObject : function (object) {
        this.ensureOpen()
        
        return Joose.Managed.PropertySet.Mutable.superClass.addPropertyObject.call(this, object)
    },
    
    
    removeProperty : function (name) {
        this.ensureOpen()
        
        return Joose.Managed.PropertySet.Mutable.superClass.removeProperty.call(this, name)
    },
    
    
    composeFrom : function () {
        this.ensureOpen()
        
        return Joose.Managed.PropertySet.Mutable.superClass.composeFrom.apply(this, this.composedFrom)
    },
    
    
    open : function () {
        this.opened++
        
        if (this.opened == 1) {
        
            Joose.O.each(this.derivatives, function (propSet) {
                propSet.open()
            })
            
            this.deCompose()
        }
    },
    
    
    close : function () {
        if (!this.opened) throw "Unmatched 'close' operation on property set: [" + this.name + "]"
        
        if (this.opened == 1) {
            this.reCompose()
            
            Joose.O.each(this.derivatives, function (propSet) {
                propSet.close()
            })
        }
        this.opened--
    },
    
    
    reCompose : function () {
        this.composeFrom()
    },
    
    
    deCompose : function () {
        this.eachOwn(function (property, name) {
            if (property.definedIn != this) this.removeProperty(name)
        }, this)
    }
    
}).c;
Joose.Managed.StemElement = function () { throw "Modules may not be instantiated." }

Joose.Managed.StemElement.Attributes = new Joose.Proto.Class('Joose.Managed.StemElement.Attributes', {
    
    isa                     : Joose.Managed.PropertySet.Mutable,
    
    propertyMetaClass       : Joose.Managed.Property.Attribute
    
}).c
;
Joose.Managed.StemElement.Methods = new Joose.Proto.Class('Joose.Managed.StemElement.Methods', {
    
    isa : Joose.Managed.PropertySet.Mutable,
    
    propertyMetaClass : Joose.Managed.Property.MethodModifier.Put,

    
    preApply : function () {
    },
    
    
    postUnApply : function () {
    }
    
}).c;
Joose.Managed.StemElement.Requirements = new Joose.Proto.Class('Joose.Managed.StemElement.Requirements', {

    isa                     : Joose.Managed.PropertySet.Mutable,
    
    propertyMetaClass       : Joose.Managed.Property.Requirement,
    
    
    
    alias : function () {
    },
    
    
    exclude : function () {
    },
    
    
    flattenTo : function (target) {
        this.each(function (property, name) {
            if (!target.haveProperty(name)) target.addPropertyObject(property)
        })
    },
    
    
    composeTo : function (target) {
        this.flattenTo(target)
    },
    
    
    preApply : function () {
    },
    
    
    postUnApply : function () {
    }
    
}).c;
Joose.Managed.StemElement.MethodModifiers = new Joose.Proto.Class('Joose.Managed.StemElement.MethodModifiers', {

    isa                     : Joose.Managed.PropertySet.Mutable,
    
    propertyMetaClass       : null,
    
    
    addProperty : function (name, props) {
        var metaClass = props.meta
        delete props.meta
        
        props.definedIn         = this
        props.name              = name
        
        var modifier            = new metaClass(props)
        var properties          = this.properties
        
        if (!properties[name]) properties[ name ] = []
        
        properties[name].push(modifier)
        
        return modifier
    },
    

    addPropertyObject : function (object) {
        var name            = object.name
        var properties      = this.properties
        
        if (!properties[name]) properties[name] = []
        
        properties[name].push(object)
        
        return object
    },
    
    
    //remove only the last modifier
    removeProperty : function (name) {
        if (!this.haveProperty(name)) return undefined
        
        var properties      = this.properties
        var modifier        = properties[ name ].pop()
        
        //if all modifiers were removed - clearing the properties
        if (!properties[name].length) Joose.Managed.StemElement.MethodModifiers.superClass.removeProperty.call(this, name)
        
        return modifier
    },
    
    
    alias : function () {
    },
    
    
    exclude : function () {
    },
    
    
    flattenTo : function (target) {
        var targetProps = target.properties
        
        this.each(function (modifiersArr, name) {
            var targetModifiersArr = targetProps[name]
            
            if (targetModifiersArr == null) targetModifiersArr = targetProps[name] = []
            
            Joose.A.each(modifiersArr, function (modifier) {
                if (!Joose.A.exists(targetModifiersArr, modifier)) targetModifiersArr.push(modifier)
            })
            
        })
    },
    
    
    composeTo : function (target) {
        this.flattenTo(target)
    },

    
    deCompose : function () {
        this.each(function (modifiersArr, name) {
            var i = 0
            
            while (i < modifiersArr.length) 
                if (modifiersArr[i].definedIn != this) 
                    modifiersArr.splice(i, 1)
                else 
                    i++
        })
    },
    
    
    preApply : function (target) {
    },

    
    postUnApply : function (target) {
    },
    
    
    apply : function (target) {
        this.each(function (modifiersArr, name) {
            Joose.A.each(modifiersArr, function (modifier) {
                modifier.apply(target)
            })
        })
    },
    
    
    unapply : function (from) {
        this.each(function (modifiersArr, name) {
            for (var i = modifiersArr.length - 1; i >=0 ; i--) modifiersArr[i].unapply(from)
        })
    }
    
    
    
}).c;
Joose.Managed.PropertySet.Composition = new Joose.Proto.Class('Joose.Managed.PropertySet.Composition', {
    
    isa                         : Joose.Managed.PropertySet.Mutable,
    
    propertyMetaClass           : Joose.Managed.PropertySet.Mutable,
    
    processOrder                : null,

    
    each : function (func, scope) {
        var props   = this.properties
        var scope   = scope || this
        
        Joose.A.each(this.processOrder, function (name) {
            func.call(scope, props[name], name)
        })
    },
    
    
    eachR : function (func, scope) {
        var props   = this.properties
        var scope   = scope || this
        
        Joose.A.eachR(this.processOrder, function (name) {
            func.call(scope, props[name], name)
        })
        
        
//        var props           = this.properties
//        var processOrder    = this.processOrder
//        
//        for(var i = processOrder.length - 1; i >= 0; i--) 
//            func.call(scope || this, props[ processOrder[i] ], processOrder[i])
    },
    
    
    clone : function (name) {
        var clone = this.cleanClone(name)
        
        this.each(function (property) {
            clone.addPropertyObject(property.clone())
        })
        
        return clone
    },
    
    
    alias : function (what) {
        this.each(function (property) {
            property.alias(what)
        })
    },
    
    
    exclude : function (what) {
        this.each(function (property) {
            property.exclude(what)
        })
    },
    
    
    flattenTo : function (target) {
        var targetProps = target.properties
        
        this.each(function (property, name) {
            var subTarget = targetProps[name] || target.addProperty(name, {
                meta : property.constructor
            })
            
            property.flattenTo(subTarget)
        })
    },
    
    
    composeTo : function (target) {
        var targetProps = target.properties
        
        this.each(function (property, name) {
            var subTarget = targetProps[name] || target.addProperty(name, {
                meta : property.constructor
            })
            
            property.composeTo(subTarget)
        })
    },
    
    
    
    deCompose : function () {
        this.eachR(function (property) {
            property.open()
        })
        
        Joose.Managed.PropertySet.Composition.superClass.deCompose.call(this)
    },
    
    
    reCompose : function () {
        Joose.Managed.PropertySet.Composition.superClass.reCompose.call(this)
        
        this.each(function (property) {
            property.close()
        })
    },
    
    
    unapply : function (from) {
        this.eachR(function (property) {
            property.unapply(from)
        })
    }
    
}).c
;
Joose.Managed.Stem = new Joose.Proto.Class('Joose.Managed.Stem', {
    
    isa                  : Joose.Managed.PropertySet.Composition,
    
    targetMeta           : null,
    
    attributesMC         : Joose.Managed.StemElement.Attributes,
    methodsMC            : Joose.Managed.StemElement.Methods,
    requirementsMC       : Joose.Managed.StemElement.Requirements,
    methodsModifiersMC   : Joose.Managed.StemElement.MethodModifiers,
    
    processOrder         : [ 'attributes', 'methods', 'requirements', 'methodsModifiers' ],
    
    
    initialize : function (props) {
        Joose.Managed.Stem.superClass.initialize.call(this, props)
        
        var targetMeta = this.targetMeta
        
        this.addProperty('attributes', {
            meta : this.attributesMC,
            
            //it can be no 'targetMeta' in clones
            properties : targetMeta ? targetMeta.attributes : {}
        })
        
        
        this.addProperty('methods', {
            meta : this.methodsMC,
            
            properties : targetMeta ? targetMeta.methods : {}
        })
        
        
        this.addProperty('requirements', {
            meta : this.requirementsMC
        })
        
        
        this.addProperty('methodsModifiers', {
            meta : this.methodsModifiersMC
        })
    },
    
    
    reCompose : function () {
        var c       = this.targetMeta.c
        
        this.preApply(c)
        
        Joose.Managed.Stem.superClass.reCompose.call(this)
        
        this.apply(c)
    },
    
    
    deCompose : function () {
        var c       = this.targetMeta.c
        
        this.unapply(c)
        
        Joose.Managed.Stem.superClass.deCompose.call(this)
        
        this.postUnApply(c)
    }
    
    
}).c
;
Joose.Managed.Builder = new Joose.Proto.Class('Joose.Managed.Builder', {
    
    targetMeta          : null,
    
    
    _buildStart : function (targetMeta, props) {
        targetMeta.stem.open()
        
        Joose.A.each([ 'trait', 'traits', 'removeTrait', 'removeTraits', 'does', 'doesnot', 'doesnt' ], function (builder) {
            if (props[builder]) {
                this[builder](targetMeta, props[builder])
                delete props[builder]
            }
        }, this)
    },
    
    
    _extend : function (props) {
        if (Joose.O.isEmpty(props)) return
        
        var targetMeta = this.targetMeta
        
        this._buildStart(targetMeta, props)
        
        Joose.O.eachOwn(props, function (value, name) {
            var handler = this[name]
            
            if (!handler) throw new Error("Unknown builder [" + name + "] was used during extending of [" + targetMeta.c + "]")
            
            handler.call(this, targetMeta, value)
        }, this)
        
        this._buildComplete(targetMeta, props)
    },
    

    _buildComplete : function (targetMeta, props) {
        targetMeta.stem.close()
    },
    
    
    methods : function (targetMeta, info) {
        Joose.O.eachOwn(info, function (value, name) {
            targetMeta.addMethod(name, value)
        })
    },
    

    removeMethods : function (targetMeta, info) {
        Joose.A.each(info, function (name) {
            targetMeta.removeMethod(name)
        })
    },
    
    
    have : function (targetMeta, info) {
        Joose.O.eachOwn(info, function (value, name) {
            targetMeta.addAttribute(name, value)
        })
    },
    
    
    havenot : function (targetMeta, info) {
        Joose.A.each(info, function (name) {
            targetMeta.removeAttribute(name)
        })
    },
    

    havent : function (targetMeta, info) {
        this.havenot(targetMeta, info)
    },
    
    
    after : function (targetMeta, info) {
        Joose.O.each(info, function (value, name) {
            targetMeta.addMethodModifier(name, value, Joose.Managed.Property.MethodModifier.After)
        })
    },
    
    
    before : function (targetMeta, info) {
        Joose.O.each(info, function (value, name) {
            targetMeta.addMethodModifier(name, value, Joose.Managed.Property.MethodModifier.Before)
        })
    },
    
    
    override : function (targetMeta, info) {
        Joose.O.each(info, function (value, name) {
            targetMeta.addMethodModifier(name, value, Joose.Managed.Property.MethodModifier.Override)
        })
    },
    
    
    around : function (targetMeta, info) {
        Joose.O.each(info, function (value, name) {
            targetMeta.addMethodModifier(name, value, Joose.Managed.Property.MethodModifier.Around)
        })
    },
    
    
    augment : function (targetMeta, info) {
        Joose.O.each(info, function (value, name) {
            targetMeta.addMethodModifier(name, value, Joose.Managed.Property.MethodModifier.Augment)
        })
    },
    
    
    removeModifier : function (targetMeta, info) {
        Joose.A.each(info, function (name) {
            targetMeta.removeMethodModifier(name)
        })
    },
    
    
    does : function (targetMeta, info) {
        Joose.A.each(Joose.O.wantArray(info), function (desc) {
            targetMeta.addRole(desc)
        })
    },
    

    doesnot : function (targetMeta, info) {
        Joose.A.each(Joose.O.wantArray(info), function (desc) {
            targetMeta.removeRole(desc)
        })
    },
    
    
    doesnt : function (targetMeta, info) {
        this.doesnot(targetMeta, info)
    },
    
    
    trait : function () {
        this.traits.apply(this, arguments)
    },
    
    
    traits : function (targetMeta, info) {
        if (targetMeta.firstPass) return
        
        if (!targetMeta.meta.isDetached) throw "Can't apply trait to not detached class"
        
        targetMeta.meta.extend({
            does : info
        })
    },
    
    
    removeTrait : function () {
        this.removeTraits.apply(this, arguments)
    },
     
    
    removeTraits : function (targetMeta, info) {
        if (!targetMeta.meta.isDetached) throw "Can't remove trait from not detached class"
        
        targetMeta.meta.extend({
            doesnot : info
        })
    }
    
    
    
}).c;
Joose.Managed.Class = new Joose.Proto.Class('Joose.Managed.Class', {
    
    isa                         : Joose.Proto.Class,
    
    stem                        : null,
    stemClass                   : Joose.Managed.Stem,
    stemClassCreated            : false,
    
    builder                     : null,
    builderClass                : Joose.Managed.Builder,
    builderClassCreated         : false,
    
    isDetached                  : false,
    firstPass                   : true,
    
    // a special instance, which, when passed as 1st argument to constructor, signifies that constructor should
    // skips traits processing for this instance
    skipTraitsAnchor            : {},
    
    
    //build for metaclasses - collects traits from roles
    BUILD : function () {
        var sup = Joose.Managed.Class.superClass.BUILD.apply(this, arguments)
        
        var props   = sup.__extend__
        
        var traits = Joose.O.wantArray(props.trait || props.traits || [])
        delete props.trait
        delete props.traits
        
        Joose.A.each(Joose.O.wantArray(props.does || []), function (arg) {
            var role = (arg.meta instanceof Joose.Managed.Class) ? arg : arg.role
            
            if (role.meta.meta.isDetached) traits.push(role.meta.constructor)
        })
        
        if (traits.length) props.traits = traits 
        
        return sup
    },
    
    
    initInstance : function (instance, props) {
        Joose.O.each(this.attributes, function (attribute, name) {
            
            if (attribute instanceof Joose.Managed.Attribute) 
                attribute.initFromConfig(instance, props)
            else 
                if (props.hasOwnProperty(name)) instance[name] = props[name]
        })
    },
    
    
    // we are using the same constructor for usual and meta- classes
    defaultConstructor: function () {
        return function (skipTraitsAnchor, params) {
            
            var thisMeta    = this.meta
            var skipTraits  = skipTraitsAnchor == thisMeta.skipTraitsAnchor
            
            var BUILD       = this.BUILD
            
            var props       = BUILD && BUILD.apply(this, skipTraits ? params : arguments) || (skipTraits ? params[0] : skipTraitsAnchor) || {}
            
            
            // either looking for traits in __extend__ (meta-class) or in usual props (usual class)
            var extend  = props.__extend__ || props
            
            var traits = extend.trait || extend.traits
            
            if (traits || extend.detached) {
                delete extend.trait
                delete extend.traits
                delete extend.detached
                
                if (!skipTraits) {
                    var classWithTrait  = thisMeta.subClass({ does : traits || [] }, thisMeta.name)
                    var meta            = classWithTrait.meta
                    meta.isDetached     = true
                    
                    return meta.instantiate(thisMeta.skipTraitsAnchor, arguments)
                }
            }
            
            thisMeta.initInstance(this, props)
            
            return thisMeta.hasMethod('initialize') && this.initialize(props) || this
        }
    },
    
    
    finalize: function (extend) {
        Joose.Managed.Class.superClass.finalize.call(this, extend)
        
        this.stem.close()
        
        this.afterMutate()
    },
    
    
    processStem : function () {
        Joose.Managed.Class.superClass.processStem.call(this)
        
        this.builder    = new this.builderClass({ targetMeta : this })
        this.stem       = new this.stemClass({ name : this.name, targetMeta : this })
        
        var builderClass = this.getClassInAttribute('builderClass')
        
        if (builderClass) {
            this.builderClassCreated = true
            this.addAttribute('builderClass', this.subClassOf(builderClass))
        }
        
        
        var stemClass = this.getClassInAttribute('stemClass')
        
        if (stemClass) {
            this.stemClassCreated = true
            this.addAttribute('stemClass', this.subClassOf(stemClass))
        }
    },
    
    
    extend : function (props) {
        if (props.builder) {
            this.getBuilderTarget().meta.extend(props.builder)
            delete props.builder
        }
        
        if (props.stem) {
            this.getStemTarget().meta.extend(props.stem)
            delete props.stem
        }
        
        this.builder._extend(props)
        
        this.firstPass = false
        
        if (!this.stem.opened) this.afterMutate()
    },
    
    
    getBuilderTarget : function () {
        var builderClass = this.getClassInAttribute('builderClass')
        if (!builderClass) throw "Attempt to extend a builder on non-meta class"
        
        return builderClass
    },
    

    getStemTarget : function () {
        var stemClass = this.getClassInAttribute('stemClass')
        if (!stemClass) throw "Attempt to extend a stem on non-meta class"
        
        return stemClass
    },
    
    
    getClassInAttribute : function (attributeName) {
        var attrClass = this.getAttribute(attributeName)
        if (attrClass instanceof Joose.Managed.Property.Attribute) attrClass = attrClass.value
        
        return attrClass
    },
    
    
    addMethodModifier: function (name, func, type) {
        var props = {}
        
        props.init = func
        props.meta = type
        
        return this.stem.properties.methodsModifiers.addProperty(name, props)
    },
    
    
    removeMethodModifier: function (name) {
        return this.stem.properties.methodsModifiers.removeProperty(name)
    },
    
    
    addMethod: function (name, func, props) {
        props = props || {}
        props.init = func
        
        return this.stem.properties.methods.addProperty(name, props)
    },
    
    
    addAttribute: function (name, init, props) {
        props = props || {}
        props.init = init
        
        return this.stem.properties.attributes.addProperty(name, props)
    },
    
    
    removeMethod : function (name) {
        return this.stem.properties.methods.removeProperty(name)
    },

    
    removeAttribute: function (name) {
        return this.stem.properties.attributes.removeProperty(name)
    },
    
    
    hasMethod: function (name) {
        return this.stem.properties.methods.haveProperty(name)
    },
    
    
    hasAttribute: function (name) { 
        return this.stem.properties.attributes.haveProperty(name)
    },
    
    
    hasMethodModifiersFor : function (name) {
        return this.stem.properties.methodsModifiers.haveProperty(name)
    },
    
    
    hasOwnMethod: function (name) {
        return this.stem.properties.methods.haveOwnProperty(name)
    },
    
    
    hasOwnAttribute: function (name) { 
        return this.stem.properties.attributes.haveOwnProperty(name)
    },
    

    getMethod : function (name) {
        return this.stem.properties.methods.getProperty(name)
    },
    
    
    getAttribute : function (name) {
        return this.stem.properties.attributes.getProperty(name)
    },
    
    
    eachRole : function (roles, func, scope) {
        Joose.A.each(roles, function (arg, index) {
            var role = (arg.meta instanceof Joose.Managed.Class) ? arg : arg.role
            
            func.call(scope || this, arg, role, index)
        }, this)
    },
    
    
    addRole : function () {
        
        this.eachRole(arguments, function (arg, role) {
            
            this.beforeRoleAdd(role)
            
            var desc = arg
            
            //compose descriptor can contain 'alias' and 'exclude' fields, in this case actual reference should be stored
            //into 'propertySet' field
            if (role != arg) {
                desc.propertySet = role.meta.stem
                delete desc.role
            } else
                desc = desc.meta.stem
            
            this.stem.addComposeInfo(desc)
            
        }, this)
    },
    
    
    beforeRoleAdd : function (role) {
        var roleMeta = role.meta
        
        if (roleMeta.builderClassCreated) this.getBuilderTarget().meta.extend({
            does : [ roleMeta.getBuilderTarget() ]
        })
        
        if (roleMeta.stemClassCreated) this.getStemTarget().meta.extend({
            does : [ roleMeta.getStemTarget() ]
        })
        
        if (roleMeta.meta.isDetached && !this.firstPass) this.builder.traits(this, roleMeta.constructor)
    },
    
    
    beforeRoleRemove : function (role) {
        var roleMeta = role.meta
        
        if (roleMeta.builderClassCreated) this.getBuilderTarget().meta.extend({
            doesnt : [ roleMeta.getBuilderTarget() ]
        })
        
        if (roleMeta.stemClassCreated) this.getStemTarget().meta.extend({
            doesnt : [ roleMeta.getStemTarget() ]
        })
        
        if (roleMeta.meta.isDetached && !this.firstPass) this.builder.removeTraits(this, roleMeta.constructor)
    },
    
    
    removeRole : function () {
        this.eachRole(arguments, function (arg, role) {
            this.beforeRoleRemove(role)
            
            this.stem.removeComposeInfo(role.meta.stem)
        }, this)
    },
    
    
    getRoles : function () {
        
        return Joose.A.map(this.stem.composedFrom, function (composeDesc) {
            //compose descriptor can contain 'alias' and 'exclude' fields, in this case actual reference is stored
            //into 'propertySet' field
            if (!(composeDesc instanceof Joose.Managed.PropertySet)) return composeDesc.propertySet
            
            return composeDesc.targetMeta.c
        })
    },
    
    
    does : function (role) {
        var myRoles = this.getRoles()
        
        for (var i = 0; i < myRoles.length; i++) if (role == myRoles[i]) return true
        for (var i = 0; i < myRoles.length; i++) if (myRoles[i].meta.does(role)) return true
        
        var superMeta = this.superClass.meta
        
        // considering the case of inheriting from non-Joose classes
        if (this.superClass != Joose.Proto.Empty && superMeta && superMeta.meta && superMeta.meta.hasMethod('does')) return superMeta.does(role)
        
        return false
    },
    
    
    getMethods : function () {
        return this.stem.properties.methods
    },
    
    
    getAttributes : function () {
        return this.stem.properties.attributes
    },
    
    
    afterMutate : function () {
    },
    
    
    getCurrentMethod : function () {
        for (var wrapper = arguments.callee.caller, count = 0; wrapper && count < 5; wrapper = wrapper.caller, count++)
            if (wrapper.__METHOD__) return wrapper.__METHOD__
        
        return null
    }
    
    
}).c;
Joose.Managed.Role = new Joose.Managed.Class('Joose.Managed.Role', {
    
    isa                         : Joose.Managed.Class,
    
    have : {
        defaultSuperClass       : Joose.Proto.Empty,
        
        builderRole             : null,
        stemRole                : null
    },
    
    
    methods : {
        
        defaultConstructor : function () {
            return function () {
                throw new Error("Roles cant be instantiated")
            }
        },
        

        processSuperClass : function () {
            if (this.superClass != this.defaultSuperClass) throw new Error("Roles can't inherit from anything")
        },
        
        
        getBuilderTarget : function () {
            if (!this.builderRole) {
                this.builderRole = new this.constructor().c
                this.builderClassCreated = true
            }
            
            return this.builderRole
        },
        
    
        getStemTarget : function () {
            if (!this.stemRole) {
                this.stemRole = new this.constructor().c
                this.stemClassCreated = true
            }
            
            return this.stemRole
        },
        
    
        addRequirement : function (methodName) {
            this.stem.properties.requirements.addProperty(methodName, {})
        }
        
    },
    

    stem : {
        methods : {
            
            apply : function () {
            },
            
            
            unapply : function () {
            }
        }
    },
    
    
    builder : {
        methods : {
            requires : function (targetClassMeta, info) {
                Joose.A.each(Joose.O.wantArray(info), function (methodName) {
                    targetClassMeta.addRequirement(methodName)
                }, this)
            }
        }
    }
    
}).c;
Joose.Managed.Attribute = new Joose.Managed.Class('Joose.Managed.Attribute', {
    
    isa : Joose.Managed.Property.Attribute,
    
    have : {
        is              : null,
        
        builder         : null,
        
        isPrivate       : false,
        
        role            : null,
        
        publicName      : null,
        setterName      : null,
        getterName      : null,
        
        //indicates the logical readableness/writeableness of the attribute
        readable        : false,
        writeable       : false,
        
        //indicates the physical presense of the accessor (may be absent for "combined" accessors for example)
        hasGetter       : false,
        hasSetter       : false,
        
        required        : false,
        
        canInlineSetRaw : true,
        canInlineGetRaw : true
    },
    
    
    after : {
        initialize : function () {
            var name = this.name
            
            this.publicName = name.replace(/^_+/, '')
            
            this.slot = this.isPrivate ? '$$' + name : name
            
            this.setterName = this.setterName || this.getSetterName()
            this.getterName = this.getterName || this.getGetterName()
            
            this.readable  = this.hasGetter = /^r/i.test(this.is)
            this.writeable = this.hasSetter = /^.w/i.test(this.is)
        }
    },
    
    
    override : {
        
        computeValue : function () {
            var init    = this.init
            
            if (Joose.O.isClass(init) || !Joose.O.isFunction(init)) this.SUPER()
        },
        
        
        preApply : function (targetClass) {
            targetClass.meta.extend({
                methods : this.getAccessorsFor(targetClass)
            })
        },
        
        
        postUnApply : function (from) {
            from.meta.extend({
                removeMethods : this.getAccessorsFrom(from)
            })
        }
        
    },
    
    
    methods : {
        
        getAccessorsFor : function (targetClass) {
            var targetMeta = targetClass.meta
            var setterName = this.setterName
            var getterName = this.getterName
            
            var methods = {}
            
            if (this.hasSetter && !targetMeta.hasMethod(setterName)) {
                methods[setterName] = this.getSetter()
                methods[setterName].ACCESSOR_FROM = this
            }
            
            if (this.hasGetter && !targetMeta.hasMethod(getterName)) {
                methods[getterName] = this.getGetter()
                methods[getterName].ACCESSOR_FROM = this
            }
            
            return methods
        },
        
        
        getAccessorsFrom : function (from) {
            var targetMeta = from.meta
            var setterName = this.setterName
            var getterName = this.getterName
            
            var setter = this.hasSetter && targetMeta.getMethod(setterName)
            var getter = this.hasGetter && targetMeta.getMethod(getterName)
            
            var removeMethods = []
            
            if (setter && setter.value.ACCESSOR_FROM == this) removeMethods.push(setterName)
            if (getter && getter.value.ACCESSOR_FROM == this) removeMethods.push(getterName)
            
            return removeMethods
        },
        
        
        getGetterName : function () {
            return 'get' + Joose.S.uppercaseFirst(this.publicName)
        },


        getSetterName : function () {
            return 'set' + Joose.S.uppercaseFirst(this.publicName)
        },
        
        
        getSetter : function () {
            var me      = this
            var slot    = me.slot
            
            if (me.canInlineSetRaw)
                return function (value) {
                    this[ slot ] = value
                    
                    return this
                }
            else
                return function () {
                    return me.setRawValueTo.apply(this, arguments)
                }
        },
        
        
        getGetter : function () {
            var me      = this
            var slot    = me.slot
            
            if (me.canInlineGetRaw)
                return function (value) {
                    return this[ slot ]
                }
            else
                return function () {
                    return me.getRawValueFrom.apply(this, arguments)
                }
        },
        
        
        getValueFrom : function (instance) {
            var getterName      = this.getterName
            
            if (this.readable && instance.meta.hasMethod(getterName)) return instance[ getterName ]()
            
            return this.getRawValueFrom(instance)
        },
        
        
        setValueTo : function (instance, value) {
            var setterName      = this.setterName
            
            if (this.writeable && instance.meta.hasMethod(setterName)) 
                instance[ setterName ](value)
            else
                this.setRawValueTo(instance, value)
        },
        
        
        initFromConfig : function (instance, config) {
            var name            = this.name
            
            var value, isSet = false
            
            if (config.hasOwnProperty(name)) {
                value = config[name]
                isSet = true
            } else {
                var init    = this.init
                
                // simple function (not class) has been used as "init" value
                if (Joose.O.isFunction(init) && !Joose.O.isClass(init)) {
                    
                    value = init.call(instance, config, name)
                    
                    isSet = true
                    
                } else if (this.builder) {
                    
                    value = instance[ this.builder.replace(/^this\./, '') ](config, name)
                    isSet = true
                }
            }
            
            if (isSet)
                this.setRawValueTo(instance, value)
            else 
                if (this.required) throw new Error("Required attribute [" + name + "] is missed during initialization of " + instance)
        }
    }

}).c
;
Joose.Managed.Attribute.Builder = new Joose.Managed.Role('Joose.Managed.Attribute.Builder', {
    
    
    have : {
        defaultAttributeClass : Joose.Managed.Attribute
    },
    
    builder : {
        
        methods : {
            
            has : function (targetClassMeta, info) {
                Joose.O.eachOwn(info, function (props, name) {
                    if (typeof props != 'object' || props == null || props.constructor == / /.constructor) props = { init : props }
                    
                    props.meta = props.meta || targetClassMeta.defaultAttributeClass
                    
                    if (/^__/.test(name)) {
                        name = name.replace(/^_+/, '')
                        
                        props.isPrivate = true
                    }
                    
                    targetClassMeta.addAttribute(name, props.init, props)
                }, this)
            },
            
            
            hasnot : function (targetClassMeta, info) {
                this.havenot(targetClassMeta, info)
            },
            
            
            hasnt : function (targetClassMeta, info) {
                this.hasnot(targetClassMeta, info)
            }
        }
            
    }
    
}).c
;
Joose.Managed.My = new Joose.Managed.Role('Joose.Managed.My', {
    
    have : {
        myClass                         : null,
        
        needToReAlias                   : false
    },
    
    
    methods : {
        createMy : function (extend) {
            var thisMeta = this.meta
            var isRole = this instanceof Joose.Managed.Role
            
            var myExtend = extend.my || {}
            delete extend.my
            
            // Symbiont will generally have the same meta class as its hoster, excepting the cases, when the superclass also have the symbiont. 
            // In such cases, the meta class for symbiont will be inherited (unless explicitly specified)
            
            var superClassMy    = this.superClass.meta.myClass
            
            if (!isRole && !myExtend.isa && superClassMy) myExtend.isa = superClassMy
            

            if (!myExtend.meta && !myExtend.isa) myExtend.meta = this.constructor
            
            var createdClass    = this.myClass = Class(myExtend)
            
            var c               = this.c
            
            c.prototype.my      = c.my = isRole ? createdClass : new createdClass({ HOST : c })
            
            this.needToReAlias = true
        },
        
        
        aliasStaticMethods : function () {
            this.needToReAlias = false
            
            var c           = this.c
            var myProto     = this.myClass.prototype
            
            Joose.O.eachOwn(c, function (property, name) {
                if (property.IS_ALIAS) delete c[ name ] 
            })
            
            this.myClass.meta.stem.properties.methods.each(function (method, name) {
                
                if (!c[ name ])
                    (c[ name ] = function () {
                        return myProto[ name ].apply(c.my, arguments)
                    }).IS_ALIAS = true
            })
        }
    },
    
    
    override : {
        
        extend : function (props) {
            var myClass = this.myClass
            
            if (!myClass && this.superClass.meta.myClass) this.createMy(props)
            
            if (props.my) {
                if (!myClass) 
                    this.createMy(props)
                else {
                    this.needToReAlias = true
                    
                    myClass.meta.extend(props.my)
                    delete props.my
                }
            }
            
            this.SUPER(props)
            
            if (this.needToReAlias && !(this instanceof Joose.Managed.Role)) this.aliasStaticMethods()
        }  
    },
    
    
    before : {
        
        addRole : function () {
            var myStem
            
            Joose.A.each(arguments, function (arg) {
                
                if (!arg) throw new Error("Attempt to consume an undefined Role into [" + this.name + "]")
                
                //instanceof Class to allow treat classes as roles
                var role = (arg.meta instanceof Joose.Managed.Class) ? arg : arg.role
                
                if (role.meta.meta.hasAttribute('myClass') && role.meta.myClass) {
                    
                    if (!this.myClass) {
                        this.createMy({
                            my : {
                                does : role.meta.myClass
                            }
                        })
                        return
                    }
                    
                    myStem = this.myClass.meta.stem
                    if (!myStem.opened) myStem.open()
                    
                    myStem.addComposeInfo(role.my.meta.stem)
                }
            }, this)
            
            if (myStem) {
                myStem.close()
                
                this.needToReAlias = true
            }
        },
        
        
        removeRole : function () {
            if (!this.myClass) return
            
            var myStem = this.myClass.meta.stem
            myStem.open()
            
            Joose.A.each(arguments, function (role) {
                if (role.meta.meta.hasAttribute('myClass') && role.meta.myClass) {
                    myStem.removeComposeInfo(role.my.meta.stem)
                    
                    this.needToReAlias = true
                }
            }, this)
            
            myStem.close()
        }
        
    }
    
}).c;
Joose.Namespace = Joose.stub()

Joose.Namespace.Able = new Joose.Managed.Role('Joose.Namespace.Able', {

    have : {
        bodyFunc                : null
    },
    
    
    before : {
        extend : function (extend) {
            if (extend.body) {
                this.bodyFunc = extend.body
                delete extend.body
            }
        }
    },
    
    
    after: {
        
        afterMutate : function () {
            var bodyFunc = this.bodyFunc
            delete this.bodyFunc
            
            if (bodyFunc) Joose.Namespace.Manager.my.executeIn(this.c, bodyFunc)
        }
    }
    
}).c;
Joose.Managed.Bootstrap = new Joose.Managed.Role('Joose.Managed.Bootstrap', {
    
    does   : [ Joose.Namespace.Able, Joose.Managed.My, Joose.Managed.Attribute.Builder ]
    
}).c
;
Joose.Meta = Joose.stub()


Joose.Meta.Object = new Joose.Proto.Class('Joose.Meta.Object', {
    
    isa             : Joose.Proto.Object
    
}).c


;
Joose.Meta.Class = new Joose.Managed.Class('Joose.Meta.Class', {
    
    isa                         : Joose.Managed.Class,
    
    does                        : Joose.Managed.Bootstrap,
    
    have : {
        defaultSuperClass       : Joose.Meta.Object
    }
    
}).c

;
Joose.Meta.Role = new Joose.Meta.Class('Joose.Meta.Role', {
    
    isa                         : Joose.Managed.Role,
    
    does                        : Joose.Managed.Bootstrap
    
}).c;
Joose.Namespace.Keeper = new Joose.Meta.Class('Joose.Namespace.Keeper', {
    
    isa         : Joose.Meta.Class,
    
    have        : {
        externalConstructor             : null
    },
    
    
    methods: {
        
        defaultConstructor: function () {
            
            return function () {
                //constructors should assume that meta is attached to 'arguments.callee' (not to 'this') 
                var thisMeta = arguments.callee.meta
                
                if (thisMeta instanceof Joose.Namespace.Keeper) throw new Error("Module [" + thisMeta.c + "] may not be instantiated. Forgot to 'use' the class with the same name?")
                
                var externalConstructor = thisMeta.externalConstructor
                
                if (typeof externalConstructor == 'function') {
                    
                    externalConstructor.meta = thisMeta
                    
                    return externalConstructor.apply(this, arguments)
                }
                
                throw "NamespaceKeeper of [" + thisMeta.name + "] was planted incorrectly."
            }
        },
        
        
        //withClass should be not constructed yet on this stage (see Joose.Proto.Class.construct)
        //it should be on the 'constructorOnly' life stage (should already have constructor)
        plant: function (withClass) {
            var keeper = this.c
            
            keeper.meta = withClass.meta
            
            keeper.meta.c = keeper
            keeper.meta.externalConstructor = withClass
        }
    }
    
}).c


;
Joose.Namespace.Manager = new Joose.Managed.Class('Joose.Namespace.Manager', {
    
    have : {
        current     : null
    },
    
    
    methods : {
        
        initialize : function () {
            this.current    = [ Joose.top ]
        },
        
        
        getCurrent: function () {
            return this.current[0]
        },
        
        
        executeIn : function (ns, func) {
            var current = this.current
            
            current.unshift(ns)
            var res = func.call(ns, ns)
            current.shift()
            
            return res
        },
        
        
        earlyCreate : function (name, metaClass, props) {
            props.constructorOnly = true
            
            return new metaClass(name, props).c
        },
        
        
        //this function establishing the full "namespace chain" (including the last element)
        create : function (nsName, metaClass, extend) {
            
            //if no name provided, then we creating an anonymous class, so just skip all the namespace manipulations
            if (!nsName) return new metaClass(nsName, extend).c
            
            var me = this
            
            if (/^\./.test(nsName)) return this.executeIn(Joose.top, function () {
                return me.create(nsName.replace(/^\./, ''), metaClass, extend)
            })
            
            var props   = extend || {}
            
            var parts   = Joose.S.saneSplit(nsName, '.')
            var object  = this.getCurrent()
            var soFar   = object == Joose.top ? [] : Joose.S.saneSplit(object.meta.name, '.')
            
            for (var i = 0; i < parts.length; i++) {
                var part        = parts[i]
                var isLast      = i == parts.length - 1
                
                if (part == "meta" || part == "my" || !part) throw "Module name [" + nsName + "] may not include a part called 'meta' or 'my' or empty part."
                
                var cur =   object[part]
                
                soFar.push(part)
                
                var soFarName       = soFar.join(".")
                var needFinalize    = false
                var nsKeeper
                
                // if the namespace segment is empty
                if (typeof cur == "undefined") {
                    if (isLast) {
                        // perform "early create" which just fills the namespace segment with right constructor
                        // this allows us to have a right constructor in the namespace segment when the `body` will be called
                        nsKeeper        = this.earlyCreate(soFarName, metaClass, props)
                        needFinalize    = true
                    } else
                        nsKeeper        = new Joose.Namespace.Keeper(soFarName).c
                    
                    object[part] = nsKeeper
                    
                    cur = nsKeeper
                    
                } else if (isLast && cur && cur.meta) {
                    
                    var currentMeta = cur.meta
                    
                    if (metaClass == Joose.Namespace.Keeper)
                        //`Module` over something case - extend the original
                        currentMeta.extend(props)
                    else {
                        
                        if (currentMeta instanceof Joose.Namespace.Keeper) {
                            
                            currentMeta.plant(this.earlyCreate(soFarName, metaClass, props))
                            
                            needFinalize = true
                        } else
                            throw new Error("Double declaration of [" + soFarName + "]")
                    }
                    
                } else 
                    if (isLast && !(cur && cur.meta && cur.meta.meta)) throw "Trying to setup module " + soFarName + " failed. There is already something: " + cur

                // hook to allow embedd resource into meta
                if (isLast) this.prepareMeta(cur.meta)
                    
                if (needFinalize) cur.meta.construct(props)
                    
                object = cur
            }
            
            return object
        },
        
        
        prepareMeta : function () {
        },
        
        
        prepareProperties : function (name, props, defaultMeta, callback) {
            if (name && typeof name != 'string') {
                props   = name
                name    = null
            }
            
            var meta
            
            if (props && props.meta) {
                meta = props.meta
                delete props.meta
            }
            
            if (!meta)
                if (props && typeof props.isa == 'function' && props.isa.meta)
                    meta = props.isa.meta.constructor
                else
                    meta = defaultMeta
            
            return callback.call(this, name, meta, props)
        },
        
        
        getDefaultHelperFor : function (metaClass) {
            var me = this
            
            return function (name, props) {
                return me.prepareProperties(name, props, metaClass, function (name, meta, props) {
                    return me.create(name, meta, props)
                })
            }
        },
        
        
        register : function (helperName, metaClass, func) {
            var me = this
            
            if (this.meta.hasMethod(helperName)) {
                
                var helper = function () {
                    return me[ helperName ].apply(me, arguments)
                }
                
                if (!Joose.top[ helperName ])   Joose.top[ helperName ]         = helper
                if (!Joose[ helperName ])       Joose[ helperName ]             = helper
                
                if (Joose.is_NodeJS && typeof exports != 'undefined')            exports[ helperName ]    = helper
                
            } else {
                var methods = {}
                
                methods[ helperName ] = func || this.getDefaultHelperFor(metaClass)
                
                this.meta.extend({
                    methods : methods
                })
                
                this.register(helperName)
            }
        },
        
        
        Module : function (name, props) {
            return this.prepareProperties(name, props, Joose.Namespace.Keeper, function (name, meta, props) {
                if (typeof props == 'function') props = { body : props }    
                
                return this.create(name, meta, props)
            })
        }
    }
    
}).c

Joose.Namespace.Manager.my = new Joose.Namespace.Manager()

Joose.Namespace.Manager.my.register('Class', Joose.Meta.Class)
Joose.Namespace.Manager.my.register('Role', Joose.Meta.Role)
Joose.Namespace.Manager.my.register('Module')


// for the rest of the package
var Class       = Joose.Class
var Role        = Joose.Role
;
Role('Joose.Attribute.Delegate', {
    
    have : {
        handles : null
    },
    
    
    override : {
        
        eachDelegate : function (handles, func, scope) {
            if (typeof handles == 'string') return func.call(scope, handles, handles)
            
            if (handles instanceof Array)
                return Joose.A.each(handles, function (delegateTo) {
                    
                    func.call(scope, delegateTo, delegateTo)
                })
                
            if (handles === Object(handles))
                Joose.O.eachOwn(handles, function (delegateTo, handleAs) {
                    
                    func.call(scope, handleAs, delegateTo)
                })
        },
        
        
        getAccessorsFor : function (targetClass) {
            var targetMeta  = targetClass.meta
            var methods     = this.SUPER(targetClass)
            
            var me      = this
            
            this.eachDelegate(this.handles, function (handleAs, delegateTo) {
                
                if (!targetMeta.hasMethod(handleAs)) {
                    var handler = methods[ handleAs ] = function () {
                        var attrValue = me.getValueFrom(this)
                        
                        return attrValue[ delegateTo ].apply(attrValue, arguments)
                    }
                    
                    handler.ACCESSOR_FROM = me
                }
            })
            
            return methods
        },
        
        
        getAccessorsFrom : function (from) {
            var methods = this.SUPER(from)
            
            var me          = this
            var targetMeta  = from.meta
            
            this.eachDelegate(this.handles, function (handleAs) {
                
                var handler = targetMeta.getMethod(handleAs)
                
                if (handler && handler.value.ACCESSOR_FROM == me) methods.push(handleAs)
            })
            
            return methods
        }
    }
})

;
Role('Joose.Attribute.Trigger', {
    
    have : {
        trigger        : null
    }, 

    
    after : {
        initialize : function() {
            if (this.trigger) {
                if (!this.writeable) throw new Error("Can't use `trigger` for read-only attributes")
                
                this.hasSetter = true
            }
        }
    },
    
    
    override : {
        
        getSetter : function() {
            var original    = this.SUPER()
            var trigger     = this.trigger
            
            if (!trigger) return original
            
            var me      = this
            var init    = Joose.O.isFunction(me.init) ? null : me.init
            
            return function () {
                var oldValue    = me.hasValue(this) ? me.getValueFrom(this) : init
                
                var res         = original.apply(this, arguments)
                
                trigger.call(this, me.getValueFrom(this), oldValue)
                
                return res
            }
        }
    }
})    

;
Role('Joose.Attribute.Lazy', {
    
    
    have : {
        lazy        : null
    }, 
    
    
    before : {
        computeValue : function () {
            if (typeof this.init == 'function' && this.lazy) {
                this.lazy = this.init    
                delete this.init    
            }
        }
    },
    
    
    after : {
        initialize : function () {
            if (this.lazy) this.readable = this.hasGetter = true
        }
    },
    
    
    override : {
        
        getGetter : function () {
            var original    = this.SUPER()
            var lazy        = this.lazy
            
            if (!lazy) return original
            
            var me      = this    
            
            return function () {
                if (!me.hasValue(this)) {
                    var initializer = typeof lazy == 'function' ? lazy : this[ lazy.replace(/^this\./, '') ]
                    
                    me.setValueTo(this, initializer.apply(this, arguments))
                }
                
                return original.call(this)    
            }
        }
    }
})

;
Role('Joose.Attribute.Accessor.Combined', {
    
    
    have : {
        isCombined        : false
    }, 
    
    
    after : {
        initialize : function() {
            this.isCombined = this.isCombined || /..c/i.test(this.is)
            
            if (this.isCombined) {
                this.slot = '$$' + this.name
                
                this.hasGetter = true
                this.hasSetter = false
                
                this.setterName = this.getterName = this.publicName
            }
        }
    },
    
    
    override : {
        
        getGetter : function() {
            var getter    = this.SUPER()
            
            if (!this.isCombined) return getter
            
            var setter    = this.getSetter()
            
            var me = this
            
            return function () {
                
                if (!arguments.length) {
                    if (me.readable) return getter.call(this)
                    throw new Error("Call to getter of unreadable attribute: [" + me.name + "]")
                }
                
                if (me.writeable) return setter.apply(this, arguments)
                
                throw new Error("Call to setter of read-only attribute: [" + me.name + "]")    
            }
        }
    }
    
})

;
Joose.Managed.Attribute.meta.extend({
    does : [ Joose.Attribute.Delegate, Joose.Attribute.Trigger, Joose.Attribute.Lazy, Joose.Attribute.Accessor.Combined ]
})            

;
Role('Joose.Meta.Singleton', {
    
    has : {
        forceInstance           : Joose.I.Object,
        instance                : null
    },
    
    
    
    override : {
        
        defaultConstructor : function () {
            var meta        = this
            var previous    = this.SUPER()
            
            this.adaptConstructor(previous)
            
            return function (forceInstance, params) {
                if (forceInstance == meta.forceInstance) return previous.apply(this, params) || this
                
                var instance = meta.instance
                
                if (instance) {
                    if (meta.hasMethod('configure')) instance.configure.apply(instance, arguments)
                } else
                    meta.instance = new meta.c(meta.forceInstance, arguments)
                    
                return meta.instance
            }
        }        
    }
    

})


Joose.Namespace.Manager.my.register('Singleton', Class({
    isa     : Joose.Meta.Class,
    meta    : Joose.Meta.Class,
    
    does    : Joose.Meta.Singleton
}))
;
;
}();;

}).call(this,require('_process'),typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{"_process":5}],22:[function(require,module,exports){
// expose module classes

exports.Intersection = require('./lib/Intersection');
exports.IntersectionParams = require('./lib/IntersectionParams');

// expose affine module classes
exports.Point2D = require('kld-affine').Point2D;

},{"./lib/Intersection":23,"./lib/IntersectionParams":24,"kld-affine":25}],23:[function(require,module,exports){
/**
 *
 *  Intersection.js
 *
 *  copyright 2002, 2013 Kevin Lindsey
 *
 */

var Point2D = require('kld-affine').Point2D,
    Vector2D = require('kld-affine').Vector2D,
    Polynomial = require('kld-polynomial').Polynomial;

/**
 *  Intersection
 */
function Intersection(status) {
    this.init(status);
}

/**
 *  init
 *
 *  @param {String} status
 *  @returns {Intersection}
 */
Intersection.prototype.init = function(status) {
    this.status = status;
    this.points = new Array();
};

/**
 *  appendPoint
 *
 *  @param {Point2D} point
 */
Intersection.prototype.appendPoint = function(point) {
    this.points.push(point);
};

/**
 *  appendPoints
 *
 *  @param {Array<Point2D>} points
 */
Intersection.prototype.appendPoints = function(points) {
    this.points = this.points.concat(points);
};

// static methods

/**
 *  intersectShapes
 *
 *  @param {IntersectionParams} shape1
 *  @param {IntersectionParams} shape2
 *  @returns {Intersection}
 */
Intersection.intersectShapes = function(shape1, shape2) {
    var ip1 = shape1.getIntersectionParams();
    var ip2 = shape2.getIntersectionParams();
    var result;

    if ( ip1 != null && ip2 != null ) {
        if ( ip1.name == "Path" ) {
            result = Intersection.intersectPathShape(shape1, shape2);
        } else if ( ip2.name == "Path" ) {
            result = Intersection.intersectPathShape(shape2, shape1);
        } else {
            var method;
            var params;

            if ( ip1.name < ip2.name ) {
                method = "intersect" + ip1.name + ip2.name;
                params = ip1.params.concat( ip2.params );
            } else {
                method = "intersect" + ip2.name + ip1.name;
                params = ip2.params.concat( ip1.params );
            }

            if ( !(method in Intersection) )
                throw new Error("Intersection not available: " + method);

            result = Intersection[method].apply(null, params);
        }
    } else {
        result = new Intersection("No Intersection");
    }

    return result;
};

/**
 *  intersectPathShape
 *
 *  @param {IntersectionParams} path
 *  @param {IntersectionParams} shape
 *  @returns {Intersection}
 */
Intersection.intersectPathShape = function(path, shape) {
    return path.intersectShape(shape);
};

/**
 *  intersectBezier2Bezier2
 *
 *  @param {Point2D} a1
 *  @param {Point2D} a2
 *  @param {Point2D} a3
 *  @param {Point2D} b1
 *  @param {Point2D} b2
 *  @param {Point2D} b3
 *  @returns {Intersection}
 */
Intersection.intersectBezier2Bezier2 = function(a1, a2, a3, b1, b2, b3) {
    var a, b;
    var c12, c11, c10;
    var c22, c21, c20;
    var result = new Intersection("No Intersection");
    var poly;

    a = a2.multiply(-2);
    c12 = a1.add(a.add(a3));

    a = a1.multiply(-2);
    b = a2.multiply(2);
    c11 = a.add(b);

    c10 = new Point2D(a1.x, a1.y);

    a = b2.multiply(-2);
    c22 = b1.add(a.add(b3));

    a = b1.multiply(-2);
    b = b2.multiply(2);
    c21 = a.add(b);

    c20 = new Point2D(b1.x, b1.y);

    if ( c12.y == 0 ) {
        var v0 = c12.x*(c10.y - c20.y);
        var v1 = v0 - c11.x*c11.y;
        var v2 = v0 + v1;
        var v3 = c11.y*c11.y;

        poly = new Polynomial(
            c12.x*c22.y*c22.y,
            2*c12.x*c21.y*c22.y,
            c12.x*c21.y*c21.y - c22.x*v3 - c22.y*v0 - c22.y*v1,
            -c21.x*v3 - c21.y*v0 - c21.y*v1,
            (c10.x - c20.x)*v3 + (c10.y - c20.y)*v1
        );
    } else {
        var v0 = c12.x*c22.y - c12.y*c22.x;
        var v1 = c12.x*c21.y - c21.x*c12.y;
        var v2 = c11.x*c12.y - c11.y*c12.x;
        var v3 = c10.y - c20.y;
        var v4 = c12.y*(c10.x - c20.x) - c12.x*v3;
        var v5 = -c11.y*v2 + c12.y*v4;
        var v6 = v2*v2;

        poly = new Polynomial(
            v0*v0,
            2*v0*v1,
            (-c22.y*v6 + c12.y*v1*v1 + c12.y*v0*v4 + v0*v5) / c12.y,
            (-c21.y*v6 + c12.y*v1*v4 + v1*v5) / c12.y,
            (v3*v6 + v4*v5) / c12.y
        );
    }

    var roots = poly.getRoots();
    for ( var i = 0; i < roots.length; i++ ) {
        var s = roots[i];

        if ( 0 <= s && s <= 1 ) {
            var xRoots = new Polynomial(
                c12.x,
                c11.x,
                c10.x - c20.x - s*c21.x - s*s*c22.x
            ).getRoots();
            var yRoots = new Polynomial(
                c12.y,
                c11.y,
                c10.y - c20.y - s*c21.y - s*s*c22.y
            ).getRoots();

            if ( xRoots.length > 0 && yRoots.length > 0 ) {
                var TOLERANCE = 1e-4;

                checkRoots:
                for ( var j = 0; j < xRoots.length; j++ ) {
                    var xRoot = xRoots[j];

                    if ( 0 <= xRoot && xRoot <= 1 ) {
                        for ( var k = 0; k < yRoots.length; k++ ) {
                            if ( Math.abs( xRoot - yRoots[k] ) < TOLERANCE ) {
                                result.points.push( c22.multiply(s*s).add(c21.multiply(s).add(c20)) );
                                break checkRoots;
                            }
                        }
                    }
                }
            }
        }
    }

    if ( result.points.length > 0 ) result.status = "Intersection";

    return result;
};


/**
 *  intersectBezier2Bezier3
 *
 *  @param {Point2D} a1
 *  @param {Point2D} a2
 *  @param {Point2D} a3
 *  @param {Point2D} b1
 *  @param {Point2D} b2
 *  @param {Point2D} b3
 *  @param {Point2D} b4
 *  @returns {Intersection}
 */
Intersection.intersectBezier2Bezier3 = function(a1, a2, a3, b1, b2, b3, b4) {
    var a, b,c, d;
    var c12, c11, c10;
    var c23, c22, c21, c20;
    var result = new Intersection("No Intersection");

    a = a2.multiply(-2);
    c12 = a1.add(a.add(a3));

    a = a1.multiply(-2);
    b = a2.multiply(2);
    c11 = a.add(b);

    c10 = new Point2D(a1.x, a1.y);

    a = b1.multiply(-1);
    b = b2.multiply(3);
    c = b3.multiply(-3);
    d = a.add(b.add(c.add(b4)));
    c23 = new Vector2D(d.x, d.y);

    a = b1.multiply(3);
    b = b2.multiply(-6);
    c = b3.multiply(3);
    d = a.add(b.add(c));
    c22 = new Vector2D(d.x, d.y);

    a = b1.multiply(-3);
    b = b2.multiply(3);
    c = a.add(b);
    c21 = new Vector2D(c.x, c.y);

    c20 = new Vector2D(b1.x, b1.y);

    var c10x2 = c10.x*c10.x;
    var c10y2 = c10.y*c10.y;
    var c11x2 = c11.x*c11.x;
    var c11y2 = c11.y*c11.y;
    var c12x2 = c12.x*c12.x;
    var c12y2 = c12.y*c12.y;
    var c20x2 = c20.x*c20.x;
    var c20y2 = c20.y*c20.y;
    var c21x2 = c21.x*c21.x;
    var c21y2 = c21.y*c21.y;
    var c22x2 = c22.x*c22.x;
    var c22y2 = c22.y*c22.y;
    var c23x2 = c23.x*c23.x;
    var c23y2 = c23.y*c23.y;

    var poly = new Polynomial(
        -2*c12.x*c12.y*c23.x*c23.y + c12x2*c23y2 + c12y2*c23x2,
        -2*c12.x*c12.y*c22.x*c23.y - 2*c12.x*c12.y*c22.y*c23.x + 2*c12y2*c22.x*c23.x +
            2*c12x2*c22.y*c23.y,
        -2*c12.x*c21.x*c12.y*c23.y - 2*c12.x*c12.y*c21.y*c23.x - 2*c12.x*c12.y*c22.x*c22.y +
            2*c21.x*c12y2*c23.x + c12y2*c22x2 + c12x2*(2*c21.y*c23.y + c22y2),
        2*c10.x*c12.x*c12.y*c23.y + 2*c10.y*c12.x*c12.y*c23.x + c11.x*c11.y*c12.x*c23.y +
            c11.x*c11.y*c12.y*c23.x - 2*c20.x*c12.x*c12.y*c23.y - 2*c12.x*c20.y*c12.y*c23.x -
            2*c12.x*c21.x*c12.y*c22.y - 2*c12.x*c12.y*c21.y*c22.x - 2*c10.x*c12y2*c23.x -
            2*c10.y*c12x2*c23.y + 2*c20.x*c12y2*c23.x + 2*c21.x*c12y2*c22.x -
            c11y2*c12.x*c23.x - c11x2*c12.y*c23.y + c12x2*(2*c20.y*c23.y + 2*c21.y*c22.y),
        2*c10.x*c12.x*c12.y*c22.y + 2*c10.y*c12.x*c12.y*c22.x + c11.x*c11.y*c12.x*c22.y +
            c11.x*c11.y*c12.y*c22.x - 2*c20.x*c12.x*c12.y*c22.y - 2*c12.x*c20.y*c12.y*c22.x -
            2*c12.x*c21.x*c12.y*c21.y - 2*c10.x*c12y2*c22.x - 2*c10.y*c12x2*c22.y +
            2*c20.x*c12y2*c22.x - c11y2*c12.x*c22.x - c11x2*c12.y*c22.y + c21x2*c12y2 +
            c12x2*(2*c20.y*c22.y + c21y2),
        2*c10.x*c12.x*c12.y*c21.y + 2*c10.y*c12.x*c21.x*c12.y + c11.x*c11.y*c12.x*c21.y +
            c11.x*c11.y*c21.x*c12.y - 2*c20.x*c12.x*c12.y*c21.y - 2*c12.x*c20.y*c21.x*c12.y -
            2*c10.x*c21.x*c12y2 - 2*c10.y*c12x2*c21.y + 2*c20.x*c21.x*c12y2 -
            c11y2*c12.x*c21.x - c11x2*c12.y*c21.y + 2*c12x2*c20.y*c21.y,
        -2*c10.x*c10.y*c12.x*c12.y - c10.x*c11.x*c11.y*c12.y - c10.y*c11.x*c11.y*c12.x +
            2*c10.x*c12.x*c20.y*c12.y + 2*c10.y*c20.x*c12.x*c12.y + c11.x*c20.x*c11.y*c12.y +
            c11.x*c11.y*c12.x*c20.y - 2*c20.x*c12.x*c20.y*c12.y - 2*c10.x*c20.x*c12y2 +
            c10.x*c11y2*c12.x + c10.y*c11x2*c12.y - 2*c10.y*c12x2*c20.y -
            c20.x*c11y2*c12.x - c11x2*c20.y*c12.y + c10x2*c12y2 + c10y2*c12x2 +
            c20x2*c12y2 + c12x2*c20y2
    );
    var roots = poly.getRootsInInterval(0,1);

    for ( var i = 0; i < roots.length; i++ ) {
        var s = roots[i];
        var xRoots = new Polynomial(
            c12.x,
            c11.x,
            c10.x - c20.x - s*c21.x - s*s*c22.x - s*s*s*c23.x
        ).getRoots();
        var yRoots = new Polynomial(
            c12.y,
            c11.y,
            c10.y - c20.y - s*c21.y - s*s*c22.y - s*s*s*c23.y
        ).getRoots();

        if ( xRoots.length > 0 && yRoots.length > 0 ) {
            var TOLERANCE = 1e-4;

            checkRoots:
            for ( var j = 0; j < xRoots.length; j++ ) {
                var xRoot = xRoots[j];

                if ( 0 <= xRoot && xRoot <= 1 ) {
                    for ( var k = 0; k < yRoots.length; k++ ) {
                        if ( Math.abs( xRoot - yRoots[k] ) < TOLERANCE ) {
                            result.points.push(
                                c23.multiply(s*s*s).add(c22.multiply(s*s).add(c21.multiply(s).add(c20)))
                            );
                            break checkRoots;
                        }
                    }
                }
            }
        }
    }

    if ( result.points.length > 0 ) result.status = "Intersection";

    return result;

};


/**
 *  intersectBezier2Circle
 *
 *  @param {Point2D} p1
 *  @param {Point2D} p2
 *  @param {Point2D} p3
 *  @param {Point2D} c
 *  @param {Number} r
 *  @returns {Intersection}
 */
Intersection.intersectBezier2Circle = function(p1, p2, p3, c, r) {
    return Intersection.intersectBezier2Ellipse(p1, p2, p3, c, r, r);
};


/**
 *  intersectBezier2Ellipse
 *
 *  @param {Point2D} p1
 *  @param {Point2D} p2
 *  @param {Point2D} p3
 *  @param {Point2D} ec
 *  @param {Number} rx
 *  @param {Number} ry
 *  @returns {Intersection}
 */
Intersection.intersectBezier2Ellipse = function(p1, p2, p3, ec, rx, ry) {
    var a, b;       // temporary variables
    var c2, c1, c0; // coefficients of quadratic
    var result = new Intersection("No Intersection");

    a = p2.multiply(-2);
    c2 = p1.add(a.add(p3));

    a = p1.multiply(-2);
    b = p2.multiply(2);
    c1 = a.add(b);

    c0 = new Point2D(p1.x, p1.y);

    var rxrx  = rx*rx;
    var ryry  = ry*ry;
    var roots = new Polynomial(
        ryry*c2.x*c2.x + rxrx*c2.y*c2.y,
        2*(ryry*c2.x*c1.x + rxrx*c2.y*c1.y),
        ryry*(2*c2.x*c0.x + c1.x*c1.x) + rxrx*(2*c2.y*c0.y+c1.y*c1.y) -
            2*(ryry*ec.x*c2.x + rxrx*ec.y*c2.y),
        2*(ryry*c1.x*(c0.x-ec.x) + rxrx*c1.y*(c0.y-ec.y)),
        ryry*(c0.x*c0.x+ec.x*ec.x) + rxrx*(c0.y*c0.y + ec.y*ec.y) -
            2*(ryry*ec.x*c0.x + rxrx*ec.y*c0.y) - rxrx*ryry
    ).getRoots();

    for ( var i = 0; i < roots.length; i++ ) {
        var t = roots[i];

        if ( 0 <= t && t <= 1 )
            result.points.push( c2.multiply(t*t).add(c1.multiply(t).add(c0)) );
    }

    if ( result.points.length > 0 ) result.status = "Intersection";

    return result;
};


/**
 *  intersectBezier2Line
 *
 *  @param {Point2D} p1
 *  @param {Point2D} p2
 *  @param {Point2D} p3
 *  @param {Point2D} a1
 *  @param {Point2D} a2
 *  @returns {Intersection}
 */
Intersection.intersectBezier2Line = function(p1, p2, p3, a1, a2) {
    var a, b;             // temporary variables
    var c2, c1, c0;       // coefficients of quadratic
    var cl;               // c coefficient for normal form of line
    var n;                // normal for normal form of line
    var min = a1.min(a2); // used to determine if point is on line segment
    var max = a1.max(a2); // used to determine if point is on line segment
    var result = new Intersection("No Intersection");

    a = p2.multiply(-2);
    c2 = p1.add(a.add(p3));

    a = p1.multiply(-2);
    b = p2.multiply(2);
    c1 = a.add(b);

    c0 = new Point2D(p1.x, p1.y);

    // Convert line to normal form: ax + by + c = 0
    // Find normal to line: negative inverse of original line's slope
    n = new Vector2D(a1.y - a2.y, a2.x - a1.x);

    // Determine new c coefficient
    cl = a1.x*a2.y - a2.x*a1.y;

    // Transform cubic coefficients to line's coordinate system and find roots
    // of cubic
    roots = new Polynomial(
        n.dot(c2),
        n.dot(c1),
        n.dot(c0) + cl
    ).getRoots();

    // Any roots in closed interval [0,1] are intersections on Bezier, but
    // might not be on the line segment.
    // Find intersections and calculate point coordinates
    for ( var i = 0; i < roots.length; i++ ) {
        var t = roots[i];

        if ( 0 <= t && t <= 1 ) {
            // We're within the Bezier curve
            // Find point on Bezier
            var p4 = p1.lerp(p2, t);
            var p5 = p2.lerp(p3, t);

            var p6 = p4.lerp(p5, t);

            // See if point is on line segment
            // Had to make special cases for vertical and horizontal lines due
            // to slight errors in calculation of p6
            if ( a1.x == a2.x ) {
                if ( min.y <= p6.y && p6.y <= max.y ) {
                    result.status = "Intersection";
                    result.appendPoint( p6 );
                }
            } else if ( a1.y == a2.y ) {
                if ( min.x <= p6.x && p6.x <= max.x ) {
                    result.status = "Intersection";
                    result.appendPoint( p6 );
                }
            } else if (min.x <= p6.x && p6.x <= max.x && min.y <= p6.y && p6.y <= max.y) {
                result.status = "Intersection";
                result.appendPoint( p6 );
            }
        }
    }

    return result;
};


/**
 *  intersectBezier2Polygon
 *
 *  @param {Point2D} p1
 *  @param {Point2D} p2
 *  @param {Point2D} p3
 *  @param {Array<Point2D>} points
 *  @returns {Intersection}
 */
Intersection.intersectBezier2Polygon = function(p1, p2, p3, points) {
    var result = new Intersection("No Intersection");
    var length = points.length;

    for ( var i = 0; i < length; i++ ) {
        var a1 = points[i];
        var a2 = points[(i+1) % length];
        var inter = Intersection.intersectBezier2Line(p1, p2, p3, a1, a2);

        result.appendPoints(inter.points);
    }

    if ( result.points.length > 0 ) result.status = "Intersection";

    return result;
};


/**
 *  intersectBezier2Rectangle
 *
 *  @param {Point2D} p1
 *  @param {Point2D} p2
 *  @param {Point2D} p3
 *  @param {Point2D} r1
 *  @param {Point2D} r2
 *  @returns {Intersection}
 */
Intersection.intersectBezier2Rectangle = function(p1, p2, p3, r1, r2) {
    var min        = r1.min(r2);
    var max        = r1.max(r2);
    var topRight   = new Point2D( max.x, min.y );
    var bottomLeft = new Point2D( min.x, max.y );

    var inter1 = Intersection.intersectBezier2Line(p1, p2, p3, min, topRight);
    var inter2 = Intersection.intersectBezier2Line(p1, p2, p3, topRight, max);
    var inter3 = Intersection.intersectBezier2Line(p1, p2, p3, max, bottomLeft);
    var inter4 = Intersection.intersectBezier2Line(p1, p2, p3, bottomLeft, min);

    var result = new Intersection("No Intersection");

    result.appendPoints(inter1.points);
    result.appendPoints(inter2.points);
    result.appendPoints(inter3.points);
    result.appendPoints(inter4.points);

    if ( result.points.length > 0 ) result.status = "Intersection";

    return result;
};


/**
 *  intersectBezier3Bezier3
 *
 *  @param {Point2D} a1
 *  @param {Point2D} a2
 *  @param {Point2D} a3
 *  @param {Point2D} a4
 *  @param {Point2D} b1
 *  @param {Point2D} b2
 *  @param {Point2D} b3
 *  @param {Point2D} b4
 *  @returns {Intersection}
 */
Intersection.intersectBezier3Bezier3 = function(a1, a2, a3, a4, b1, b2, b3, b4) {
    var a, b, c, d;         // temporary variables
    var c13, c12, c11, c10; // coefficients of cubic
    var c23, c22, c21, c20; // coefficients of cubic
    var result = new Intersection("No Intersection");

    // Calculate the coefficients of cubic polynomial
    a = a1.multiply(-1);
    b = a2.multiply(3);
    c = a3.multiply(-3);
    d = a.add(b.add(c.add(a4)));
    c13 = new Vector2D(d.x, d.y);

    a = a1.multiply(3);
    b = a2.multiply(-6);
    c = a3.multiply(3);
    d = a.add(b.add(c));
    c12 = new Vector2D(d.x, d.y);

    a = a1.multiply(-3);
    b = a2.multiply(3);
    c = a.add(b);
    c11 = new Vector2D(c.x, c.y);

    c10 = new Vector2D(a1.x, a1.y);

    a = b1.multiply(-1);
    b = b2.multiply(3);
    c = b3.multiply(-3);
    d = a.add(b.add(c.add(b4)));
    c23 = new Vector2D(d.x, d.y);

    a = b1.multiply(3);
    b = b2.multiply(-6);
    c = b3.multiply(3);
    d = a.add(b.add(c));
    c22 = new Vector2D(d.x, d.y);

    a = b1.multiply(-3);
    b = b2.multiply(3);
    c = a.add(b);
    c21 = new Vector2D(c.x, c.y);

    c20 = new Vector2D(b1.x, b1.y);

    var c10x2 = c10.x*c10.x;
    var c10x3 = c10.x*c10.x*c10.x;
    var c10y2 = c10.y*c10.y;
    var c10y3 = c10.y*c10.y*c10.y;
    var c11x2 = c11.x*c11.x;
    var c11x3 = c11.x*c11.x*c11.x;
    var c11y2 = c11.y*c11.y;
    var c11y3 = c11.y*c11.y*c11.y;
    var c12x2 = c12.x*c12.x;
    var c12x3 = c12.x*c12.x*c12.x;
    var c12y2 = c12.y*c12.y;
    var c12y3 = c12.y*c12.y*c12.y;
    var c13x2 = c13.x*c13.x;
    var c13x3 = c13.x*c13.x*c13.x;
    var c13y2 = c13.y*c13.y;
    var c13y3 = c13.y*c13.y*c13.y;
    var c20x2 = c20.x*c20.x;
    var c20x3 = c20.x*c20.x*c20.x;
    var c20y2 = c20.y*c20.y;
    var c20y3 = c20.y*c20.y*c20.y;
    var c21x2 = c21.x*c21.x;
    var c21x3 = c21.x*c21.x*c21.x;
    var c21y2 = c21.y*c21.y;
    var c22x2 = c22.x*c22.x;
    var c22x3 = c22.x*c22.x*c22.x;
    var c22y2 = c22.y*c22.y;
    var c23x2 = c23.x*c23.x;
    var c23x3 = c23.x*c23.x*c23.x;
    var c23y2 = c23.y*c23.y;
    var c23y3 = c23.y*c23.y*c23.y;
    var poly = new Polynomial(
        -c13x3*c23y3 + c13y3*c23x3 - 3*c13.x*c13y2*c23x2*c23.y +
            3*c13x2*c13.y*c23.x*c23y2,
        -6*c13.x*c22.x*c13y2*c23.x*c23.y + 6*c13x2*c13.y*c22.y*c23.x*c23.y + 3*c22.x*c13y3*c23x2 -
            3*c13x3*c22.y*c23y2 - 3*c13.x*c13y2*c22.y*c23x2 + 3*c13x2*c22.x*c13.y*c23y2,
        -6*c21.x*c13.x*c13y2*c23.x*c23.y - 6*c13.x*c22.x*c13y2*c22.y*c23.x + 6*c13x2*c22.x*c13.y*c22.y*c23.y +
            3*c21.x*c13y3*c23x2 + 3*c22x2*c13y3*c23.x + 3*c21.x*c13x2*c13.y*c23y2 - 3*c13.x*c21.y*c13y2*c23x2 -
            3*c13.x*c22x2*c13y2*c23.y + c13x2*c13.y*c23.x*(6*c21.y*c23.y + 3*c22y2) + c13x3*(-c21.y*c23y2 -
            2*c22y2*c23.y - c23.y*(2*c21.y*c23.y + c22y2)),
        c11.x*c12.y*c13.x*c13.y*c23.x*c23.y - c11.y*c12.x*c13.x*c13.y*c23.x*c23.y + 6*c21.x*c22.x*c13y3*c23.x +
            3*c11.x*c12.x*c13.x*c13.y*c23y2 + 6*c10.x*c13.x*c13y2*c23.x*c23.y - 3*c11.x*c12.x*c13y2*c23.x*c23.y -
            3*c11.y*c12.y*c13.x*c13.y*c23x2 - 6*c10.y*c13x2*c13.y*c23.x*c23.y - 6*c20.x*c13.x*c13y2*c23.x*c23.y +
            3*c11.y*c12.y*c13x2*c23.x*c23.y - 2*c12.x*c12y2*c13.x*c23.x*c23.y - 6*c21.x*c13.x*c22.x*c13y2*c23.y -
            6*c21.x*c13.x*c13y2*c22.y*c23.x - 6*c13.x*c21.y*c22.x*c13y2*c23.x + 6*c21.x*c13x2*c13.y*c22.y*c23.y +
            2*c12x2*c12.y*c13.y*c23.x*c23.y + c22x3*c13y3 - 3*c10.x*c13y3*c23x2 + 3*c10.y*c13x3*c23y2 +
            3*c20.x*c13y3*c23x2 + c12y3*c13.x*c23x2 - c12x3*c13.y*c23y2 - 3*c10.x*c13x2*c13.y*c23y2 +
            3*c10.y*c13.x*c13y2*c23x2 - 2*c11.x*c12.y*c13x2*c23y2 + c11.x*c12.y*c13y2*c23x2 - c11.y*c12.x*c13x2*c23y2 +
            2*c11.y*c12.x*c13y2*c23x2 + 3*c20.x*c13x2*c13.y*c23y2 - c12.x*c12y2*c13.y*c23x2 -
            3*c20.y*c13.x*c13y2*c23x2 + c12x2*c12.y*c13.x*c23y2 - 3*c13.x*c22x2*c13y2*c22.y +
            c13x2*c13.y*c23.x*(6*c20.y*c23.y + 6*c21.y*c22.y) + c13x2*c22.x*c13.y*(6*c21.y*c23.y + 3*c22y2) +
            c13x3*(-2*c21.y*c22.y*c23.y - c20.y*c23y2 - c22.y*(2*c21.y*c23.y + c22y2) - c23.y*(2*c20.y*c23.y + 2*c21.y*c22.y)),
        6*c11.x*c12.x*c13.x*c13.y*c22.y*c23.y + c11.x*c12.y*c13.x*c22.x*c13.y*c23.y + c11.x*c12.y*c13.x*c13.y*c22.y*c23.x -
            c11.y*c12.x*c13.x*c22.x*c13.y*c23.y - c11.y*c12.x*c13.x*c13.y*c22.y*c23.x - 6*c11.y*c12.y*c13.x*c22.x*c13.y*c23.x -
            6*c10.x*c22.x*c13y3*c23.x + 6*c20.x*c22.x*c13y3*c23.x + 6*c10.y*c13x3*c22.y*c23.y + 2*c12y3*c13.x*c22.x*c23.x -
            2*c12x3*c13.y*c22.y*c23.y + 6*c10.x*c13.x*c22.x*c13y2*c23.y + 6*c10.x*c13.x*c13y2*c22.y*c23.x +
            6*c10.y*c13.x*c22.x*c13y2*c23.x - 3*c11.x*c12.x*c22.x*c13y2*c23.y - 3*c11.x*c12.x*c13y2*c22.y*c23.x +
            2*c11.x*c12.y*c22.x*c13y2*c23.x + 4*c11.y*c12.x*c22.x*c13y2*c23.x - 6*c10.x*c13x2*c13.y*c22.y*c23.y -
            6*c10.y*c13x2*c22.x*c13.y*c23.y - 6*c10.y*c13x2*c13.y*c22.y*c23.x - 4*c11.x*c12.y*c13x2*c22.y*c23.y -
            6*c20.x*c13.x*c22.x*c13y2*c23.y - 6*c20.x*c13.x*c13y2*c22.y*c23.x - 2*c11.y*c12.x*c13x2*c22.y*c23.y +
            3*c11.y*c12.y*c13x2*c22.x*c23.y + 3*c11.y*c12.y*c13x2*c22.y*c23.x - 2*c12.x*c12y2*c13.x*c22.x*c23.y -
            2*c12.x*c12y2*c13.x*c22.y*c23.x - 2*c12.x*c12y2*c22.x*c13.y*c23.x - 6*c20.y*c13.x*c22.x*c13y2*c23.x -
            6*c21.x*c13.x*c21.y*c13y2*c23.x - 6*c21.x*c13.x*c22.x*c13y2*c22.y + 6*c20.x*c13x2*c13.y*c22.y*c23.y +
            2*c12x2*c12.y*c13.x*c22.y*c23.y + 2*c12x2*c12.y*c22.x*c13.y*c23.y + 2*c12x2*c12.y*c13.y*c22.y*c23.x +
            3*c21.x*c22x2*c13y3 + 3*c21x2*c13y3*c23.x - 3*c13.x*c21.y*c22x2*c13y2 - 3*c21x2*c13.x*c13y2*c23.y +
            c13x2*c22.x*c13.y*(6*c20.y*c23.y + 6*c21.y*c22.y) + c13x2*c13.y*c23.x*(6*c20.y*c22.y + 3*c21y2) +
            c21.x*c13x2*c13.y*(6*c21.y*c23.y + 3*c22y2) + c13x3*(-2*c20.y*c22.y*c23.y - c23.y*(2*c20.y*c22.y + c21y2) -
            c21.y*(2*c21.y*c23.y + c22y2) - c22.y*(2*c20.y*c23.y + 2*c21.y*c22.y)),
        c11.x*c21.x*c12.y*c13.x*c13.y*c23.y + c11.x*c12.y*c13.x*c21.y*c13.y*c23.x + c11.x*c12.y*c13.x*c22.x*c13.y*c22.y -
            c11.y*c12.x*c21.x*c13.x*c13.y*c23.y - c11.y*c12.x*c13.x*c21.y*c13.y*c23.x - c11.y*c12.x*c13.x*c22.x*c13.y*c22.y -
            6*c11.y*c21.x*c12.y*c13.x*c13.y*c23.x - 6*c10.x*c21.x*c13y3*c23.x + 6*c20.x*c21.x*c13y3*c23.x +
            2*c21.x*c12y3*c13.x*c23.x + 6*c10.x*c21.x*c13.x*c13y2*c23.y + 6*c10.x*c13.x*c21.y*c13y2*c23.x +
            6*c10.x*c13.x*c22.x*c13y2*c22.y + 6*c10.y*c21.x*c13.x*c13y2*c23.x - 3*c11.x*c12.x*c21.x*c13y2*c23.y -
            3*c11.x*c12.x*c21.y*c13y2*c23.x - 3*c11.x*c12.x*c22.x*c13y2*c22.y + 2*c11.x*c21.x*c12.y*c13y2*c23.x +
            4*c11.y*c12.x*c21.x*c13y2*c23.x - 6*c10.y*c21.x*c13x2*c13.y*c23.y - 6*c10.y*c13x2*c21.y*c13.y*c23.x -
            6*c10.y*c13x2*c22.x*c13.y*c22.y - 6*c20.x*c21.x*c13.x*c13y2*c23.y - 6*c20.x*c13.x*c21.y*c13y2*c23.x -
            6*c20.x*c13.x*c22.x*c13y2*c22.y + 3*c11.y*c21.x*c12.y*c13x2*c23.y - 3*c11.y*c12.y*c13.x*c22x2*c13.y +
            3*c11.y*c12.y*c13x2*c21.y*c23.x + 3*c11.y*c12.y*c13x2*c22.x*c22.y - 2*c12.x*c21.x*c12y2*c13.x*c23.y -
            2*c12.x*c21.x*c12y2*c13.y*c23.x - 2*c12.x*c12y2*c13.x*c21.y*c23.x - 2*c12.x*c12y2*c13.x*c22.x*c22.y -
            6*c20.y*c21.x*c13.x*c13y2*c23.x - 6*c21.x*c13.x*c21.y*c22.x*c13y2 + 6*c20.y*c13x2*c21.y*c13.y*c23.x +
            2*c12x2*c21.x*c12.y*c13.y*c23.y + 2*c12x2*c12.y*c21.y*c13.y*c23.x + 2*c12x2*c12.y*c22.x*c13.y*c22.y -
            3*c10.x*c22x2*c13y3 + 3*c20.x*c22x2*c13y3 + 3*c21x2*c22.x*c13y3 + c12y3*c13.x*c22x2 +
            3*c10.y*c13.x*c22x2*c13y2 + c11.x*c12.y*c22x2*c13y2 + 2*c11.y*c12.x*c22x2*c13y2 -
            c12.x*c12y2*c22x2*c13.y - 3*c20.y*c13.x*c22x2*c13y2 - 3*c21x2*c13.x*c13y2*c22.y +
            c12x2*c12.y*c13.x*(2*c21.y*c23.y + c22y2) + c11.x*c12.x*c13.x*c13.y*(6*c21.y*c23.y + 3*c22y2) +
            c21.x*c13x2*c13.y*(6*c20.y*c23.y + 6*c21.y*c22.y) + c12x3*c13.y*(-2*c21.y*c23.y - c22y2) +
            c10.y*c13x3*(6*c21.y*c23.y + 3*c22y2) + c11.y*c12.x*c13x2*(-2*c21.y*c23.y - c22y2) +
            c11.x*c12.y*c13x2*(-4*c21.y*c23.y - 2*c22y2) + c10.x*c13x2*c13.y*(-6*c21.y*c23.y - 3*c22y2) +
            c13x2*c22.x*c13.y*(6*c20.y*c22.y + 3*c21y2) + c20.x*c13x2*c13.y*(6*c21.y*c23.y + 3*c22y2) +
            c13x3*(-2*c20.y*c21.y*c23.y - c22.y*(2*c20.y*c22.y + c21y2) - c20.y*(2*c21.y*c23.y + c22y2) -
            c21.y*(2*c20.y*c23.y + 2*c21.y*c22.y)),
        -c10.x*c11.x*c12.y*c13.x*c13.y*c23.y + c10.x*c11.y*c12.x*c13.x*c13.y*c23.y + 6*c10.x*c11.y*c12.y*c13.x*c13.y*c23.x -
            6*c10.y*c11.x*c12.x*c13.x*c13.y*c23.y - c10.y*c11.x*c12.y*c13.x*c13.y*c23.x + c10.y*c11.y*c12.x*c13.x*c13.y*c23.x +
            c11.x*c11.y*c12.x*c12.y*c13.x*c23.y - c11.x*c11.y*c12.x*c12.y*c13.y*c23.x + c11.x*c20.x*c12.y*c13.x*c13.y*c23.y +
            c11.x*c20.y*c12.y*c13.x*c13.y*c23.x + c11.x*c21.x*c12.y*c13.x*c13.y*c22.y + c11.x*c12.y*c13.x*c21.y*c22.x*c13.y -
            c20.x*c11.y*c12.x*c13.x*c13.y*c23.y - 6*c20.x*c11.y*c12.y*c13.x*c13.y*c23.x - c11.y*c12.x*c20.y*c13.x*c13.y*c23.x -
            c11.y*c12.x*c21.x*c13.x*c13.y*c22.y - c11.y*c12.x*c13.x*c21.y*c22.x*c13.y - 6*c11.y*c21.x*c12.y*c13.x*c22.x*c13.y -
            6*c10.x*c20.x*c13y3*c23.x - 6*c10.x*c21.x*c22.x*c13y3 - 2*c10.x*c12y3*c13.x*c23.x + 6*c20.x*c21.x*c22.x*c13y3 +
            2*c20.x*c12y3*c13.x*c23.x + 2*c21.x*c12y3*c13.x*c22.x + 2*c10.y*c12x3*c13.y*c23.y - 6*c10.x*c10.y*c13.x*c13y2*c23.x +
            3*c10.x*c11.x*c12.x*c13y2*c23.y - 2*c10.x*c11.x*c12.y*c13y2*c23.x - 4*c10.x*c11.y*c12.x*c13y2*c23.x +
            3*c10.y*c11.x*c12.x*c13y2*c23.x + 6*c10.x*c10.y*c13x2*c13.y*c23.y + 6*c10.x*c20.x*c13.x*c13y2*c23.y -
            3*c10.x*c11.y*c12.y*c13x2*c23.y + 2*c10.x*c12.x*c12y2*c13.x*c23.y + 2*c10.x*c12.x*c12y2*c13.y*c23.x +
            6*c10.x*c20.y*c13.x*c13y2*c23.x + 6*c10.x*c21.x*c13.x*c13y2*c22.y + 6*c10.x*c13.x*c21.y*c22.x*c13y2 +
            4*c10.y*c11.x*c12.y*c13x2*c23.y + 6*c10.y*c20.x*c13.x*c13y2*c23.x + 2*c10.y*c11.y*c12.x*c13x2*c23.y -
            3*c10.y*c11.y*c12.y*c13x2*c23.x + 2*c10.y*c12.x*c12y2*c13.x*c23.x + 6*c10.y*c21.x*c13.x*c22.x*c13y2 -
            3*c11.x*c20.x*c12.x*c13y2*c23.y + 2*c11.x*c20.x*c12.y*c13y2*c23.x + c11.x*c11.y*c12y2*c13.x*c23.x -
            3*c11.x*c12.x*c20.y*c13y2*c23.x - 3*c11.x*c12.x*c21.x*c13y2*c22.y - 3*c11.x*c12.x*c21.y*c22.x*c13y2 +
            2*c11.x*c21.x*c12.y*c22.x*c13y2 + 4*c20.x*c11.y*c12.x*c13y2*c23.x + 4*c11.y*c12.x*c21.x*c22.x*c13y2 -
            2*c10.x*c12x2*c12.y*c13.y*c23.y - 6*c10.y*c20.x*c13x2*c13.y*c23.y - 6*c10.y*c20.y*c13x2*c13.y*c23.x -
            6*c10.y*c21.x*c13x2*c13.y*c22.y - 2*c10.y*c12x2*c12.y*c13.x*c23.y - 2*c10.y*c12x2*c12.y*c13.y*c23.x -
            6*c10.y*c13x2*c21.y*c22.x*c13.y - c11.x*c11.y*c12x2*c13.y*c23.y - 2*c11.x*c11y2*c13.x*c13.y*c23.x +
            3*c20.x*c11.y*c12.y*c13x2*c23.y - 2*c20.x*c12.x*c12y2*c13.x*c23.y - 2*c20.x*c12.x*c12y2*c13.y*c23.x -
            6*c20.x*c20.y*c13.x*c13y2*c23.x - 6*c20.x*c21.x*c13.x*c13y2*c22.y - 6*c20.x*c13.x*c21.y*c22.x*c13y2 +
            3*c11.y*c20.y*c12.y*c13x2*c23.x + 3*c11.y*c21.x*c12.y*c13x2*c22.y + 3*c11.y*c12.y*c13x2*c21.y*c22.x -
            2*c12.x*c20.y*c12y2*c13.x*c23.x - 2*c12.x*c21.x*c12y2*c13.x*c22.y - 2*c12.x*c21.x*c12y2*c22.x*c13.y -
            2*c12.x*c12y2*c13.x*c21.y*c22.x - 6*c20.y*c21.x*c13.x*c22.x*c13y2 - c11y2*c12.x*c12.y*c13.x*c23.x +
            2*c20.x*c12x2*c12.y*c13.y*c23.y + 6*c20.y*c13x2*c21.y*c22.x*c13.y + 2*c11x2*c11.y*c13.x*c13.y*c23.y +
            c11x2*c12.x*c12.y*c13.y*c23.y + 2*c12x2*c20.y*c12.y*c13.y*c23.x + 2*c12x2*c21.x*c12.y*c13.y*c22.y +
            2*c12x2*c12.y*c21.y*c22.x*c13.y + c21x3*c13y3 + 3*c10x2*c13y3*c23.x - 3*c10y2*c13x3*c23.y +
            3*c20x2*c13y3*c23.x + c11y3*c13x2*c23.x - c11x3*c13y2*c23.y - c11.x*c11y2*c13x2*c23.y +
            c11x2*c11.y*c13y2*c23.x - 3*c10x2*c13.x*c13y2*c23.y + 3*c10y2*c13x2*c13.y*c23.x - c11x2*c12y2*c13.x*c23.y +
            c11y2*c12x2*c13.y*c23.x - 3*c21x2*c13.x*c21.y*c13y2 - 3*c20x2*c13.x*c13y2*c23.y + 3*c20y2*c13x2*c13.y*c23.x +
            c11.x*c12.x*c13.x*c13.y*(6*c20.y*c23.y + 6*c21.y*c22.y) + c12x3*c13.y*(-2*c20.y*c23.y - 2*c21.y*c22.y) +
            c10.y*c13x3*(6*c20.y*c23.y + 6*c21.y*c22.y) + c11.y*c12.x*c13x2*(-2*c20.y*c23.y - 2*c21.y*c22.y) +
            c12x2*c12.y*c13.x*(2*c20.y*c23.y + 2*c21.y*c22.y) + c11.x*c12.y*c13x2*(-4*c20.y*c23.y - 4*c21.y*c22.y) +
            c10.x*c13x2*c13.y*(-6*c20.y*c23.y - 6*c21.y*c22.y) + c20.x*c13x2*c13.y*(6*c20.y*c23.y + 6*c21.y*c22.y) +
            c21.x*c13x2*c13.y*(6*c20.y*c22.y + 3*c21y2) + c13x3*(-2*c20.y*c21.y*c22.y - c20y2*c23.y -
            c21.y*(2*c20.y*c22.y + c21y2) - c20.y*(2*c20.y*c23.y + 2*c21.y*c22.y)),
        -c10.x*c11.x*c12.y*c13.x*c13.y*c22.y + c10.x*c11.y*c12.x*c13.x*c13.y*c22.y + 6*c10.x*c11.y*c12.y*c13.x*c22.x*c13.y -
            6*c10.y*c11.x*c12.x*c13.x*c13.y*c22.y - c10.y*c11.x*c12.y*c13.x*c22.x*c13.y + c10.y*c11.y*c12.x*c13.x*c22.x*c13.y +
            c11.x*c11.y*c12.x*c12.y*c13.x*c22.y - c11.x*c11.y*c12.x*c12.y*c22.x*c13.y + c11.x*c20.x*c12.y*c13.x*c13.y*c22.y +
            c11.x*c20.y*c12.y*c13.x*c22.x*c13.y + c11.x*c21.x*c12.y*c13.x*c21.y*c13.y - c20.x*c11.y*c12.x*c13.x*c13.y*c22.y -
            6*c20.x*c11.y*c12.y*c13.x*c22.x*c13.y - c11.y*c12.x*c20.y*c13.x*c22.x*c13.y - c11.y*c12.x*c21.x*c13.x*c21.y*c13.y -
            6*c10.x*c20.x*c22.x*c13y3 - 2*c10.x*c12y3*c13.x*c22.x + 2*c20.x*c12y3*c13.x*c22.x + 2*c10.y*c12x3*c13.y*c22.y -
            6*c10.x*c10.y*c13.x*c22.x*c13y2 + 3*c10.x*c11.x*c12.x*c13y2*c22.y - 2*c10.x*c11.x*c12.y*c22.x*c13y2 -
            4*c10.x*c11.y*c12.x*c22.x*c13y2 + 3*c10.y*c11.x*c12.x*c22.x*c13y2 + 6*c10.x*c10.y*c13x2*c13.y*c22.y +
            6*c10.x*c20.x*c13.x*c13y2*c22.y - 3*c10.x*c11.y*c12.y*c13x2*c22.y + 2*c10.x*c12.x*c12y2*c13.x*c22.y +
            2*c10.x*c12.x*c12y2*c22.x*c13.y + 6*c10.x*c20.y*c13.x*c22.x*c13y2 + 6*c10.x*c21.x*c13.x*c21.y*c13y2 +
            4*c10.y*c11.x*c12.y*c13x2*c22.y + 6*c10.y*c20.x*c13.x*c22.x*c13y2 + 2*c10.y*c11.y*c12.x*c13x2*c22.y -
            3*c10.y*c11.y*c12.y*c13x2*c22.x + 2*c10.y*c12.x*c12y2*c13.x*c22.x - 3*c11.x*c20.x*c12.x*c13y2*c22.y +
            2*c11.x*c20.x*c12.y*c22.x*c13y2 + c11.x*c11.y*c12y2*c13.x*c22.x - 3*c11.x*c12.x*c20.y*c22.x*c13y2 -
            3*c11.x*c12.x*c21.x*c21.y*c13y2 + 4*c20.x*c11.y*c12.x*c22.x*c13y2 - 2*c10.x*c12x2*c12.y*c13.y*c22.y -
            6*c10.y*c20.x*c13x2*c13.y*c22.y - 6*c10.y*c20.y*c13x2*c22.x*c13.y - 6*c10.y*c21.x*c13x2*c21.y*c13.y -
            2*c10.y*c12x2*c12.y*c13.x*c22.y - 2*c10.y*c12x2*c12.y*c22.x*c13.y - c11.x*c11.y*c12x2*c13.y*c22.y -
            2*c11.x*c11y2*c13.x*c22.x*c13.y + 3*c20.x*c11.y*c12.y*c13x2*c22.y - 2*c20.x*c12.x*c12y2*c13.x*c22.y -
            2*c20.x*c12.x*c12y2*c22.x*c13.y - 6*c20.x*c20.y*c13.x*c22.x*c13y2 - 6*c20.x*c21.x*c13.x*c21.y*c13y2 +
            3*c11.y*c20.y*c12.y*c13x2*c22.x + 3*c11.y*c21.x*c12.y*c13x2*c21.y - 2*c12.x*c20.y*c12y2*c13.x*c22.x -
            2*c12.x*c21.x*c12y2*c13.x*c21.y - c11y2*c12.x*c12.y*c13.x*c22.x + 2*c20.x*c12x2*c12.y*c13.y*c22.y -
            3*c11.y*c21x2*c12.y*c13.x*c13.y + 6*c20.y*c21.x*c13x2*c21.y*c13.y + 2*c11x2*c11.y*c13.x*c13.y*c22.y +
            c11x2*c12.x*c12.y*c13.y*c22.y + 2*c12x2*c20.y*c12.y*c22.x*c13.y + 2*c12x2*c21.x*c12.y*c21.y*c13.y -
            3*c10.x*c21x2*c13y3 + 3*c20.x*c21x2*c13y3 + 3*c10x2*c22.x*c13y3 - 3*c10y2*c13x3*c22.y + 3*c20x2*c22.x*c13y3 +
            c21x2*c12y3*c13.x + c11y3*c13x2*c22.x - c11x3*c13y2*c22.y + 3*c10.y*c21x2*c13.x*c13y2 -
            c11.x*c11y2*c13x2*c22.y + c11.x*c21x2*c12.y*c13y2 + 2*c11.y*c12.x*c21x2*c13y2 + c11x2*c11.y*c22.x*c13y2 -
            c12.x*c21x2*c12y2*c13.y - 3*c20.y*c21x2*c13.x*c13y2 - 3*c10x2*c13.x*c13y2*c22.y + 3*c10y2*c13x2*c22.x*c13.y -
            c11x2*c12y2*c13.x*c22.y + c11y2*c12x2*c22.x*c13.y - 3*c20x2*c13.x*c13y2*c22.y + 3*c20y2*c13x2*c22.x*c13.y +
            c12x2*c12.y*c13.x*(2*c20.y*c22.y + c21y2) + c11.x*c12.x*c13.x*c13.y*(6*c20.y*c22.y + 3*c21y2) +
            c12x3*c13.y*(-2*c20.y*c22.y - c21y2) + c10.y*c13x3*(6*c20.y*c22.y + 3*c21y2) +
            c11.y*c12.x*c13x2*(-2*c20.y*c22.y - c21y2) + c11.x*c12.y*c13x2*(-4*c20.y*c22.y - 2*c21y2) +
            c10.x*c13x2*c13.y*(-6*c20.y*c22.y - 3*c21y2) + c20.x*c13x2*c13.y*(6*c20.y*c22.y + 3*c21y2) +
            c13x3*(-2*c20.y*c21y2 - c20y2*c22.y - c20.y*(2*c20.y*c22.y + c21y2)),
        -c10.x*c11.x*c12.y*c13.x*c21.y*c13.y + c10.x*c11.y*c12.x*c13.x*c21.y*c13.y + 6*c10.x*c11.y*c21.x*c12.y*c13.x*c13.y -
            6*c10.y*c11.x*c12.x*c13.x*c21.y*c13.y - c10.y*c11.x*c21.x*c12.y*c13.x*c13.y + c10.y*c11.y*c12.x*c21.x*c13.x*c13.y -
            c11.x*c11.y*c12.x*c21.x*c12.y*c13.y + c11.x*c11.y*c12.x*c12.y*c13.x*c21.y + c11.x*c20.x*c12.y*c13.x*c21.y*c13.y +
            6*c11.x*c12.x*c20.y*c13.x*c21.y*c13.y + c11.x*c20.y*c21.x*c12.y*c13.x*c13.y - c20.x*c11.y*c12.x*c13.x*c21.y*c13.y -
            6*c20.x*c11.y*c21.x*c12.y*c13.x*c13.y - c11.y*c12.x*c20.y*c21.x*c13.x*c13.y - 6*c10.x*c20.x*c21.x*c13y3 -
            2*c10.x*c21.x*c12y3*c13.x + 6*c10.y*c20.y*c13x3*c21.y + 2*c20.x*c21.x*c12y3*c13.x + 2*c10.y*c12x3*c21.y*c13.y -
            2*c12x3*c20.y*c21.y*c13.y - 6*c10.x*c10.y*c21.x*c13.x*c13y2 + 3*c10.x*c11.x*c12.x*c21.y*c13y2 -
            2*c10.x*c11.x*c21.x*c12.y*c13y2 - 4*c10.x*c11.y*c12.x*c21.x*c13y2 + 3*c10.y*c11.x*c12.x*c21.x*c13y2 +
            6*c10.x*c10.y*c13x2*c21.y*c13.y + 6*c10.x*c20.x*c13.x*c21.y*c13y2 - 3*c10.x*c11.y*c12.y*c13x2*c21.y +
            2*c10.x*c12.x*c21.x*c12y2*c13.y + 2*c10.x*c12.x*c12y2*c13.x*c21.y + 6*c10.x*c20.y*c21.x*c13.x*c13y2 +
            4*c10.y*c11.x*c12.y*c13x2*c21.y + 6*c10.y*c20.x*c21.x*c13.x*c13y2 + 2*c10.y*c11.y*c12.x*c13x2*c21.y -
            3*c10.y*c11.y*c21.x*c12.y*c13x2 + 2*c10.y*c12.x*c21.x*c12y2*c13.x - 3*c11.x*c20.x*c12.x*c21.y*c13y2 +
            2*c11.x*c20.x*c21.x*c12.y*c13y2 + c11.x*c11.y*c21.x*c12y2*c13.x - 3*c11.x*c12.x*c20.y*c21.x*c13y2 +
            4*c20.x*c11.y*c12.x*c21.x*c13y2 - 6*c10.x*c20.y*c13x2*c21.y*c13.y - 2*c10.x*c12x2*c12.y*c21.y*c13.y -
            6*c10.y*c20.x*c13x2*c21.y*c13.y - 6*c10.y*c20.y*c21.x*c13x2*c13.y - 2*c10.y*c12x2*c21.x*c12.y*c13.y -
            2*c10.y*c12x2*c12.y*c13.x*c21.y - c11.x*c11.y*c12x2*c21.y*c13.y - 4*c11.x*c20.y*c12.y*c13x2*c21.y -
            2*c11.x*c11y2*c21.x*c13.x*c13.y + 3*c20.x*c11.y*c12.y*c13x2*c21.y - 2*c20.x*c12.x*c21.x*c12y2*c13.y -
            2*c20.x*c12.x*c12y2*c13.x*c21.y - 6*c20.x*c20.y*c21.x*c13.x*c13y2 - 2*c11.y*c12.x*c20.y*c13x2*c21.y +
            3*c11.y*c20.y*c21.x*c12.y*c13x2 - 2*c12.x*c20.y*c21.x*c12y2*c13.x - c11y2*c12.x*c21.x*c12.y*c13.x +
            6*c20.x*c20.y*c13x2*c21.y*c13.y + 2*c20.x*c12x2*c12.y*c21.y*c13.y + 2*c11x2*c11.y*c13.x*c21.y*c13.y +
            c11x2*c12.x*c12.y*c21.y*c13.y + 2*c12x2*c20.y*c21.x*c12.y*c13.y + 2*c12x2*c20.y*c12.y*c13.x*c21.y +
            3*c10x2*c21.x*c13y3 - 3*c10y2*c13x3*c21.y + 3*c20x2*c21.x*c13y3 + c11y3*c21.x*c13x2 - c11x3*c21.y*c13y2 -
            3*c20y2*c13x3*c21.y - c11.x*c11y2*c13x2*c21.y + c11x2*c11.y*c21.x*c13y2 - 3*c10x2*c13.x*c21.y*c13y2 +
            3*c10y2*c21.x*c13x2*c13.y - c11x2*c12y2*c13.x*c21.y + c11y2*c12x2*c21.x*c13.y - 3*c20x2*c13.x*c21.y*c13y2 +
            3*c20y2*c21.x*c13x2*c13.y,
        c10.x*c10.y*c11.x*c12.y*c13.x*c13.y - c10.x*c10.y*c11.y*c12.x*c13.x*c13.y + c10.x*c11.x*c11.y*c12.x*c12.y*c13.y -
            c10.y*c11.x*c11.y*c12.x*c12.y*c13.x - c10.x*c11.x*c20.y*c12.y*c13.x*c13.y + 6*c10.x*c20.x*c11.y*c12.y*c13.x*c13.y +
            c10.x*c11.y*c12.x*c20.y*c13.x*c13.y - c10.y*c11.x*c20.x*c12.y*c13.x*c13.y - 6*c10.y*c11.x*c12.x*c20.y*c13.x*c13.y +
            c10.y*c20.x*c11.y*c12.x*c13.x*c13.y - c11.x*c20.x*c11.y*c12.x*c12.y*c13.y + c11.x*c11.y*c12.x*c20.y*c12.y*c13.x +
            c11.x*c20.x*c20.y*c12.y*c13.x*c13.y - c20.x*c11.y*c12.x*c20.y*c13.x*c13.y - 2*c10.x*c20.x*c12y3*c13.x +
            2*c10.y*c12x3*c20.y*c13.y - 3*c10.x*c10.y*c11.x*c12.x*c13y2 - 6*c10.x*c10.y*c20.x*c13.x*c13y2 +
            3*c10.x*c10.y*c11.y*c12.y*c13x2 - 2*c10.x*c10.y*c12.x*c12y2*c13.x - 2*c10.x*c11.x*c20.x*c12.y*c13y2 -
            c10.x*c11.x*c11.y*c12y2*c13.x + 3*c10.x*c11.x*c12.x*c20.y*c13y2 - 4*c10.x*c20.x*c11.y*c12.x*c13y2 +
            3*c10.y*c11.x*c20.x*c12.x*c13y2 + 6*c10.x*c10.y*c20.y*c13x2*c13.y + 2*c10.x*c10.y*c12x2*c12.y*c13.y +
            2*c10.x*c11.x*c11y2*c13.x*c13.y + 2*c10.x*c20.x*c12.x*c12y2*c13.y + 6*c10.x*c20.x*c20.y*c13.x*c13y2 -
            3*c10.x*c11.y*c20.y*c12.y*c13x2 + 2*c10.x*c12.x*c20.y*c12y2*c13.x + c10.x*c11y2*c12.x*c12.y*c13.x +
            c10.y*c11.x*c11.y*c12x2*c13.y + 4*c10.y*c11.x*c20.y*c12.y*c13x2 - 3*c10.y*c20.x*c11.y*c12.y*c13x2 +
            2*c10.y*c20.x*c12.x*c12y2*c13.x + 2*c10.y*c11.y*c12.x*c20.y*c13x2 + c11.x*c20.x*c11.y*c12y2*c13.x -
            3*c11.x*c20.x*c12.x*c20.y*c13y2 - 2*c10.x*c12x2*c20.y*c12.y*c13.y - 6*c10.y*c20.x*c20.y*c13x2*c13.y -
            2*c10.y*c20.x*c12x2*c12.y*c13.y - 2*c10.y*c11x2*c11.y*c13.x*c13.y - c10.y*c11x2*c12.x*c12.y*c13.y -
            2*c10.y*c12x2*c20.y*c12.y*c13.x - 2*c11.x*c20.x*c11y2*c13.x*c13.y - c11.x*c11.y*c12x2*c20.y*c13.y +
            3*c20.x*c11.y*c20.y*c12.y*c13x2 - 2*c20.x*c12.x*c20.y*c12y2*c13.x - c20.x*c11y2*c12.x*c12.y*c13.x +
            3*c10y2*c11.x*c12.x*c13.x*c13.y + 3*c11.x*c12.x*c20y2*c13.x*c13.y + 2*c20.x*c12x2*c20.y*c12.y*c13.y -
            3*c10x2*c11.y*c12.y*c13.x*c13.y + 2*c11x2*c11.y*c20.y*c13.x*c13.y + c11x2*c12.x*c20.y*c12.y*c13.y -
            3*c20x2*c11.y*c12.y*c13.x*c13.y - c10x3*c13y3 + c10y3*c13x3 + c20x3*c13y3 - c20y3*c13x3 -
            3*c10.x*c20x2*c13y3 - c10.x*c11y3*c13x2 + 3*c10x2*c20.x*c13y3 + c10.y*c11x3*c13y2 +
            3*c10.y*c20y2*c13x3 + c20.x*c11y3*c13x2 + c10x2*c12y3*c13.x - 3*c10y2*c20.y*c13x3 - c10y2*c12x3*c13.y +
            c20x2*c12y3*c13.x - c11x3*c20.y*c13y2 - c12x3*c20y2*c13.y - c10.x*c11x2*c11.y*c13y2 +
            c10.y*c11.x*c11y2*c13x2 - 3*c10.x*c10y2*c13x2*c13.y - c10.x*c11y2*c12x2*c13.y + c10.y*c11x2*c12y2*c13.x -
            c11.x*c11y2*c20.y*c13x2 + 3*c10x2*c10.y*c13.x*c13y2 + c10x2*c11.x*c12.y*c13y2 +
            2*c10x2*c11.y*c12.x*c13y2 - 2*c10y2*c11.x*c12.y*c13x2 - c10y2*c11.y*c12.x*c13x2 + c11x2*c20.x*c11.y*c13y2 -
            3*c10.x*c20y2*c13x2*c13.y + 3*c10.y*c20x2*c13.x*c13y2 + c11.x*c20x2*c12.y*c13y2 - 2*c11.x*c20y2*c12.y*c13x2 +
            c20.x*c11y2*c12x2*c13.y - c11.y*c12.x*c20y2*c13x2 - c10x2*c12.x*c12y2*c13.y - 3*c10x2*c20.y*c13.x*c13y2 +
            3*c10y2*c20.x*c13x2*c13.y + c10y2*c12x2*c12.y*c13.x - c11x2*c20.y*c12y2*c13.x + 2*c20x2*c11.y*c12.x*c13y2 +
            3*c20.x*c20y2*c13x2*c13.y - c20x2*c12.x*c12y2*c13.y - 3*c20x2*c20.y*c13.x*c13y2 + c12x2*c20y2*c12.y*c13.x
    );
    var roots = poly.getRootsInInterval(0,1);

    for ( var i = 0; i < roots.length; i++ ) {
        var s = roots[i];
        var xRoots = new Polynomial(
            c13.x,
            c12.x,
            c11.x,
            c10.x - c20.x - s*c21.x - s*s*c22.x - s*s*s*c23.x
        ).getRoots();
        var yRoots = new Polynomial(
            c13.y,
            c12.y,
            c11.y,
            c10.y - c20.y - s*c21.y - s*s*c22.y - s*s*s*c23.y
        ).getRoots();

        if ( xRoots.length > 0 && yRoots.length > 0 ) {
            var TOLERANCE = 1e-4;

            checkRoots:
            for ( var j = 0; j < xRoots.length; j++ ) {
                var xRoot = xRoots[j];

                if ( 0 <= xRoot && xRoot <= 1 ) {
                    for ( var k = 0; k < yRoots.length; k++ ) {
                        if ( Math.abs( xRoot - yRoots[k] ) < TOLERANCE ) {
                            result.points.push(
                                c23.multiply(s*s*s).add(c22.multiply(s*s).add(c21.multiply(s).add(c20)))
                            );
                            break checkRoots;
                        }
                    }
                }
            }
        }
    }

    if ( result.points.length > 0 ) result.status = "Intersection";

    return result;
};


/**
 *  intersectBezier3Circle
 *
 *  @param {Point2D} p1
 *  @param {Point2D} p2
 *  @param {Point2D} p3
 *  @param {Point2D} p4
 *  @param {Point2D} c
 *  @param {Number} r
 *  @returns {Intersection}
 */
Intersection.intersectBezier3Circle = function(p1, p2, p3, p4, c, r) {
    return Intersection.intersectBezier3Ellipse(p1, p2, p3, p4, c, r, r);
};


/**
 *  intersectBezier3Ellipse
 *
 *  @param {Point2D} p1
 *  @param {Point2D} p2
 *  @param {Point2D} p3
 *  @param {Point2D} p4
 *  @param {Point2D} ec
 *  @param {Number} rx
 *  @param {Number} ry
 *  @returns {Intersection}
 */
Intersection.intersectBezier3Ellipse = function(p1, p2, p3, p4, ec, rx, ry) {
    var a, b, c, d;       // temporary variables
    var c3, c2, c1, c0;   // coefficients of cubic
    var result = new Intersection("No Intersection");

    // Calculate the coefficients of cubic polynomial
    a = p1.multiply(-1);
    b = p2.multiply(3);
    c = p3.multiply(-3);
    d = a.add(b.add(c.add(p4)));
    c3 = new Vector2D(d.x, d.y);

    a = p1.multiply(3);
    b = p2.multiply(-6);
    c = p3.multiply(3);
    d = a.add(b.add(c));
    c2 = new Vector2D(d.x, d.y);

    a = p1.multiply(-3);
    b = p2.multiply(3);
    c = a.add(b);
    c1 = new Vector2D(c.x, c.y);

    c0 = new Vector2D(p1.x, p1.y);

    var rxrx  = rx*rx;
    var ryry  = ry*ry;
    var poly = new Polynomial(
        c3.x*c3.x*ryry + c3.y*c3.y*rxrx,
        2*(c3.x*c2.x*ryry + c3.y*c2.y*rxrx),
        2*(c3.x*c1.x*ryry + c3.y*c1.y*rxrx) + c2.x*c2.x*ryry + c2.y*c2.y*rxrx,
        2*c3.x*ryry*(c0.x - ec.x) + 2*c3.y*rxrx*(c0.y - ec.y) +
            2*(c2.x*c1.x*ryry + c2.y*c1.y*rxrx),
        2*c2.x*ryry*(c0.x - ec.x) + 2*c2.y*rxrx*(c0.y - ec.y) +
            c1.x*c1.x*ryry + c1.y*c1.y*rxrx,
        2*c1.x*ryry*(c0.x - ec.x) + 2*c1.y*rxrx*(c0.y - ec.y),
        c0.x*c0.x*ryry - 2*c0.y*ec.y*rxrx - 2*c0.x*ec.x*ryry +
            c0.y*c0.y*rxrx + ec.x*ec.x*ryry + ec.y*ec.y*rxrx - rxrx*ryry
    );
    var roots = poly.getRootsInInterval(0,1);

    for ( var i = 0; i < roots.length; i++ ) {
        var t = roots[i];

        result.points.push(
            c3.multiply(t*t*t).add(c2.multiply(t*t).add(c1.multiply(t).add(c0)))
        );
    }

    if ( result.points.length > 0 ) result.status = "Intersection";

    return result;
};


/**
 *  intersectBezier3Line
 *
 *  Many thanks to Dan Sunday at SoftSurfer.com.  He gave me a very thorough
 *  sketch of the algorithm used here.  Without his help, I'm not sure when I
 *  would have figured out this intersection problem.
 *
 *  @param {Point2D} p1
 *  @param {Point2D} p2
 *  @param {Point2D} p3
 *  @param {Point2D} p4
 *  @param {Point2D} a1
 *  @param {Point2D} a2
 *  @returns {Intersection}
 */
Intersection.intersectBezier3Line = function(p1, p2, p3, p4, a1, a2) {
    var a, b, c, d;       // temporary variables
    var c3, c2, c1, c0;   // coefficients of cubic
    var cl;               // c coefficient for normal form of line
    var n;                // normal for normal form of line
    var min = a1.min(a2); // used to determine if point is on line segment
    var max = a1.max(a2); // used to determine if point is on line segment
    var result = new Intersection("No Intersection");

    // Start with Bezier using Bernstein polynomials for weighting functions:
    //     (1-t^3)P1 + 3t(1-t)^2P2 + 3t^2(1-t)P3 + t^3P4
    //
    // Expand and collect terms to form linear combinations of original Bezier
    // controls.  This ends up with a vector cubic in t:
    //     (-P1+3P2-3P3+P4)t^3 + (3P1-6P2+3P3)t^2 + (-3P1+3P2)t + P1
    //             /\                  /\                /\       /\
    //             ||                  ||                ||       ||
    //             c3                  c2                c1       c0

    // Calculate the coefficients
    a = p1.multiply(-1);
    b = p2.multiply(3);
    c = p3.multiply(-3);
    d = a.add(b.add(c.add(p4)));
    c3 = new Vector2D(d.x, d.y);

    a = p1.multiply(3);
    b = p2.multiply(-6);
    c = p3.multiply(3);
    d = a.add(b.add(c));
    c2 = new Vector2D(d.x, d.y);

    a = p1.multiply(-3);
    b = p2.multiply(3);
    c = a.add(b);
    c1 = new Vector2D(c.x, c.y);

    c0 = new Vector2D(p1.x, p1.y);

    // Convert line to normal form: ax + by + c = 0
    // Find normal to line: negative inverse of original line's slope
    n = new Vector2D(a1.y - a2.y, a2.x - a1.x);

    // Determine new c coefficient
    cl = a1.x*a2.y - a2.x*a1.y;

    // ?Rotate each cubic coefficient using line for new coordinate system?
    // Find roots of rotated cubic
    roots = new Polynomial(
        n.dot(c3),
        n.dot(c2),
        n.dot(c1),
        n.dot(c0) + cl
    ).getRoots();

    // Any roots in closed interval [0,1] are intersections on Bezier, but
    // might not be on the line segment.
    // Find intersections and calculate point coordinates
    for ( var i = 0; i < roots.length; i++ ) {
        var t = roots[i];

        if ( 0 <= t && t <= 1 ) {
            // We're within the Bezier curve
            // Find point on Bezier
            var p5 = p1.lerp(p2, t);
            var p6 = p2.lerp(p3, t);
            var p7 = p3.lerp(p4, t);

            var p8 = p5.lerp(p6, t);
            var p9 = p6.lerp(p7, t);

            var p10 = p8.lerp(p9, t);

            // See if point is on line segment
            // Had to make special cases for vertical and horizontal lines due
            // to slight errors in calculation of p10
            if ( a1.x == a2.x ) {
                if ( min.y <= p10.y && p10.y <= max.y ) {
                    result.status = "Intersection";
                    result.appendPoint( p10 );
                }
            } else if ( a1.y == a2.y ) {
                if ( min.x <= p10.x && p10.x <= max.x ) {
                    result.status = "Intersection";
                    result.appendPoint( p10 );
                }
            } else if (min.x <= p10.x && p10.x <= max.x && min.y <= p10.y && p10.y <= max.y) {
                result.status = "Intersection";
                result.appendPoint( p10 );
            }
        }
    }

    return result;
};


/**
 *  intersectBezier3Polygon
 *
 *  @param {Point2D} p1
 *  @param {Point2D} p2
 *  @param {Point2D} p3
 *  @param {Point2D} p4
 *  @param {Array<Point2D>} points
 *  @returns {Intersection}
 */
Intersection.intersectBezier3Polygon = function(p1, p2, p3, p4, points) {
    var result = new Intersection("No Intersection");
    var length = points.length;

    for ( var i = 0; i < length; i++ ) {
        var a1 = points[i];
        var a2 = points[(i+1) % length];
        var inter = Intersection.intersectBezier3Line(p1, p2, p3, p4, a1, a2);

        result.appendPoints(inter.points);
    }

    if ( result.points.length > 0 ) result.status = "Intersection";

    return result;
};


/**
 *  intersectBezier3Rectangle
 *
 *  @param {Point2D} p1
 *  @param {Point2D} p2
 *  @param {Point2D} p3
 *  @param {Point2D} p4
 *  @param {Point2D} r1
 *  @param {Point2D} r2
 *  @returns {Intersection}
 */
Intersection.intersectBezier3Rectangle = function(p1, p2, p3, p4, r1, r2) {
    var min        = r1.min(r2);
    var max        = r1.max(r2);
    var topRight   = new Point2D( max.x, min.y );
    var bottomLeft = new Point2D( min.x, max.y );

    var inter1 = Intersection.intersectBezier3Line(p1, p2, p3, p4, min, topRight);
    var inter2 = Intersection.intersectBezier3Line(p1, p2, p3, p4, topRight, max);
    var inter3 = Intersection.intersectBezier3Line(p1, p2, p3, p4, max, bottomLeft);
    var inter4 = Intersection.intersectBezier3Line(p1, p2, p3, p4, bottomLeft, min);

    var result = new Intersection("No Intersection");

    result.appendPoints(inter1.points);
    result.appendPoints(inter2.points);
    result.appendPoints(inter3.points);
    result.appendPoints(inter4.points);

    if ( result.points.length > 0 ) result.status = "Intersection";

    return result;
};


/**
 *  intersectCircleCircle
 *
 *  @param {Point2D} c1
 *  @param {Number} r1
 *  @param {Point2D} c2
 *  @param {Number} r2
 *  @returns {Intersection}
 */
Intersection.intersectCircleCircle = function(c1, r1, c2, r2) {
    var result;

    // Determine minimum and maximum radii where circles can intersect
    var r_max = r1 + r2;
    var r_min = Math.abs(r1 - r2);

    // Determine actual distance between circle circles
    var c_dist = c1.distanceFrom( c2 );

    if ( c_dist > r_max ) {
        result = new Intersection("Outside");
    } else if ( c_dist < r_min ) {
        result = new Intersection("Inside");
    } else {
        result = new Intersection("Intersection");

        var a = (r1*r1 - r2*r2 + c_dist*c_dist) / ( 2*c_dist );
        var h = Math.sqrt(r1*r1 - a*a);
        var p = c1.lerp(c2, a/c_dist);
        var b = h / c_dist;

        result.points.push(
            new Point2D(
                p.x - b * (c2.y - c1.y),
                p.y + b * (c2.x - c1.x)
            )
        );
        result.points.push(
            new Point2D(
                p.x + b * (c2.y - c1.y),
                p.y - b * (c2.x - c1.x)
            )
        );
    }

    return result;
};


/**
 *  intersectCircleEllipse
 *
 *  @param {Point2D} cc
 *  @param {Number} r
 *  @param {Point2D} ec
 *  @param {Number} rx
 *  @param {Number} ry
 *  @returns {Intersection}
 */
Intersection.intersectCircleEllipse = function(cc, r, ec, rx, ry) {
    return Intersection.intersectEllipseEllipse(cc, r, r, ec, rx, ry);
};


/**
 *  intersectCircleLine
 *
 *  @param {Point2D} c
 *  @param {Number} r
 *  @param {Point2D} a1
 *  @param {Point2D} a2
 *  @returns {Intersection}
 */
Intersection.intersectCircleLine = function(c, r, a1, a2) {
    var result;
    var a  = (a2.x - a1.x) * (a2.x - a1.x) +
             (a2.y - a1.y) * (a2.y - a1.y);
    var b  = 2 * ( (a2.x - a1.x) * (a1.x - c.x) +
                   (a2.y - a1.y) * (a1.y - c.y)   );
    var cc = c.x*c.x + c.y*c.y + a1.x*a1.x + a1.y*a1.y -
             2 * (c.x * a1.x + c.y * a1.y) - r*r;
    var deter = b*b - 4*a*cc;

    if ( deter < 0 ) {
        result = new Intersection("Outside");
    } else if ( deter == 0 ) {
        result = new Intersection("Tangent");
        // NOTE: should calculate this point
    } else {
        var e  = Math.sqrt(deter);
        var u1 = ( -b + e ) / ( 2*a );
        var u2 = ( -b - e ) / ( 2*a );

        if ( (u1 < 0 || u1 > 1) && (u2 < 0 || u2 > 1) ) {
            if ( (u1 < 0 && u2 < 0) || (u1 > 1 && u2 > 1) ) {
                result = new Intersection("Outside");
            } else {
                result = new Intersection("Inside");
            }
        } else {
            result = new Intersection("Intersection");

            if ( 0 <= u1 && u1 <= 1)
                result.points.push( a1.lerp(a2, u1) );

            if ( 0 <= u2 && u2 <= 1)
                result.points.push( a1.lerp(a2, u2) );
        }
    }

    return result;
};


/**
 *  intersectCirclePolygon
 *
 *  @param {Point2D} c
 *  @param {Number} r
 *  @param {Array<Point2D>} points
 *  @returns {Intersection}
 */
Intersection.intersectCirclePolygon = function(c, r, points) {
    var result = new Intersection("No Intersection");
    var length = points.length;
    var inter;

    for ( var i = 0; i < length; i++ ) {
        var a1 = points[i];
        var a2 = points[(i+1) % length];

        inter = Intersection.intersectCircleLine(c, r, a1, a2);
        result.appendPoints(inter.points);
    }

    if ( result.points.length > 0 )
        result.status = "Intersection";
    else
        result.status = inter.status;

    return result;
};


/**
 *  intersectCircleRectangle
 *
 *  @param {Point2D} c
 *  @param {Number} r
 *  @param {Point2D} r1
 *  @param {Point2D} r2
 *  @returns {Intersection}
 */
Intersection.intersectCircleRectangle = function(c, r, r1, r2) {
    var min        = r1.min(r2);
    var max        = r1.max(r2);
    var topRight   = new Point2D( max.x, min.y );
    var bottomLeft = new Point2D( min.x, max.y );

    var inter1 = Intersection.intersectCircleLine(c, r, min, topRight);
    var inter2 = Intersection.intersectCircleLine(c, r, topRight, max);
    var inter3 = Intersection.intersectCircleLine(c, r, max, bottomLeft);
    var inter4 = Intersection.intersectCircleLine(c, r, bottomLeft, min);

    var result = new Intersection("No Intersection");

    result.appendPoints(inter1.points);
    result.appendPoints(inter2.points);
    result.appendPoints(inter3.points);
    result.appendPoints(inter4.points);

    if ( result.points.length > 0 )
        result.status = "Intersection";
    else
        result.status = inter1.status;

    return result;
};


/**
 *  intersectEllipseEllipse
 *
 *  This code is based on MgcIntr2DElpElp.cpp written by David Eberly.  His
 *  code along with many other excellent examples are avaiable at his site:
 *  http://www.magic-software.com
 *
 *  NOTE: Rotation will need to be added to this function
 *
 *  @param {Point2D} c1
 *  @param {Number} rx1
 *  @param {Number} ry1
 *  @param {Point2D} c2
 *  @param {Number} rx2
 *  @param {Number} ry2
 *  @returns {Intersection}
 */
Intersection.intersectEllipseEllipse = function(c1, rx1, ry1, c2, rx2, ry2) {
    var a = [
        ry1*ry1, 0, rx1*rx1, -2*ry1*ry1*c1.x, -2*rx1*rx1*c1.y,
        ry1*ry1*c1.x*c1.x + rx1*rx1*c1.y*c1.y - rx1*rx1*ry1*ry1
    ];
    var b = [
        ry2*ry2, 0, rx2*rx2, -2*ry2*ry2*c2.x, -2*rx2*rx2*c2.y,
        ry2*ry2*c2.x*c2.x + rx2*rx2*c2.y*c2.y - rx2*rx2*ry2*ry2
    ];

    var yPoly   = Intersection.bezout(a, b);
    var yRoots  = yPoly.getRoots();
    var epsilon = 1e-3;
    var norm0   = ( a[0]*a[0] + 2*a[1]*a[1] + a[2]*a[2] ) * epsilon;
    var norm1   = ( b[0]*b[0] + 2*b[1]*b[1] + b[2]*b[2] ) * epsilon;
    var result  = new Intersection("No Intersection");

    for ( var y = 0; y < yRoots.length; y++ ) {
        var xPoly = new Polynomial(
            a[0],
            a[3] + yRoots[y] * a[1],
            a[5] + yRoots[y] * (a[4] + yRoots[y]*a[2])
        );
        var xRoots = xPoly.getRoots();

        for ( var x = 0; x < xRoots.length; x++ ) {
            var test =
                ( a[0]*xRoots[x] + a[1]*yRoots[y] + a[3] ) * xRoots[x] +
                ( a[2]*yRoots[y] + a[4] ) * yRoots[y] + a[5];
            if ( Math.abs(test) < norm0 ) {
                test =
                    ( b[0]*xRoots[x] + b[1]*yRoots[y] + b[3] ) * xRoots[x] +
                    ( b[2]*yRoots[y] + b[4] ) * yRoots[y] + b[5];
                if ( Math.abs(test) < norm1 ) {
                    result.appendPoint( new Point2D( xRoots[x], yRoots[y] ) );
                }
            }
        }
    }

    if ( result.points.length > 0 ) result.status = "Intersection";

    return result;
};


/**
 *  intersectEllipseLine
 *
 *  NOTE: Rotation will need to be added to this function
 *
 *  @param {Point2D} c
 *  @param {Number} rx
 *  @param {Number} ry
 *  @param {Point2D} a1
 *  @param {Point2D} a2
 *  @returns {Intersection}
 */
Intersection.intersectEllipseLine = function(c, rx, ry, a1, a2) {
    var result;
    var origin = new Vector2D(a1.x, a1.y);
    var dir    = Vector2D.fromPoints(a1, a2);
    var center = new Vector2D(c.x, c.y);
    var diff   = origin.subtract(center);
    var mDir   = new Vector2D( dir.x/(rx*rx),  dir.y/(ry*ry)  );
    var mDiff  = new Vector2D( diff.x/(rx*rx), diff.y/(ry*ry) );

    var a = dir.dot(mDir);
    var b = dir.dot(mDiff);
    var c = diff.dot(mDiff) - 1.0;
    var d = b*b - a*c;

    if ( d < 0 ) {
        result = new Intersection("Outside");
    } else if ( d > 0 ) {
        var root = Math.sqrt(d);
        var t_a  = (-b - root) / a;
        var t_b  = (-b + root) / a;

        if ( (t_a < 0 || 1 < t_a) && (t_b < 0 || 1 < t_b) ) {
            if ( (t_a < 0 && t_b < 0) || (t_a > 1 && t_b > 1) )
                result = new Intersection("Outside");
            else
                result = new Intersection("Inside");
        } else {
            result = new Intersection("Intersection");
            if ( 0 <= t_a && t_a <= 1 )
                result.appendPoint( a1.lerp(a2, t_a) );
            if ( 0 <= t_b && t_b <= 1 )
                result.appendPoint( a1.lerp(a2, t_b) );
        }
    } else {
        var t = -b/a;
        if ( 0 <= t && t <= 1 ) {
            result = new Intersection("Intersection");
            result.appendPoint( a1.lerp(a2, t) );
        } else {
            result = new Intersection("Outside");
        }
    }

    return result;
};


/**
 *  intersectEllipsePolygon
 *
 *  @param {Point2D} c
 *  @param {Number} rx
 *  @param {Number} ry
 *  @param {Array<Point2D>} c2
 *  @returns {Intersection}
 */
Intersection.intersectEllipsePolygon = function(c, rx, ry, points) {
    var result = new Intersection("No Intersection");
    var length = points.length;

    for ( var i = 0; i < length; i++ ) {
        var b1 = points[i];
        var b2 = points[(i+1) % length];
        var inter = Intersection.intersectEllipseLine(c, rx, ry, b1, b2);

        result.appendPoints(inter.points);
    }

    if ( result.points.length > 0 )
        result.status = "Intersection";

    return result;
};


/**
 *  intersectEllipseRectangle
 *
 *  @param {Point2D} c
 *  @param {Number} rx
 *  @param {Number} ry
 *  @param {Point2D} r1
 *  @param {Point2D} r2
 *  @returns {Intersection}
 */
Intersection.intersectEllipseRectangle = function(c, rx, ry, r1, r2) {
    var min        = r1.min(r2);
    var max        = r1.max(r2);
    var topRight   = new Point2D( max.x, min.y );
    var bottomLeft = new Point2D( min.x, max.y );

    var inter1 = Intersection.intersectEllipseLine(c, rx, ry, min, topRight);
    var inter2 = Intersection.intersectEllipseLine(c, rx, ry, topRight, max);
    var inter3 = Intersection.intersectEllipseLine(c, rx, ry, max, bottomLeft);
    var inter4 = Intersection.intersectEllipseLine(c, rx, ry, bottomLeft, min);

    var result = new Intersection("No Intersection");

    result.appendPoints(inter1.points);
    result.appendPoints(inter2.points);
    result.appendPoints(inter3.points);
    result.appendPoints(inter4.points);

    if ( result.points.length > 0 )
        result.status = "Intersection";

    return result;
};


/**
 *  intersectLineLine
 *
 *  @param {Point2D} a1
 *  @param {Point2D} a2
 *  @param {Point2D} b1
 *  @param {Point2D} b2
 *  @returns {Intersection}
 */
Intersection.intersectLineLine = function(a1, a2, b1, b2) {
    var result;

    var ua_t = (b2.x - b1.x) * (a1.y - b1.y) - (b2.y - b1.y) * (a1.x - b1.x);
    var ub_t = (a2.x - a1.x) * (a1.y - b1.y) - (a2.y - a1.y) * (a1.x - b1.x);
    var u_b  = (b2.y - b1.y) * (a2.x - a1.x) - (b2.x - b1.x) * (a2.y - a1.y);

    if ( u_b != 0 ) {
        var ua = ua_t / u_b;
        var ub = ub_t / u_b;

        if ( 0 <= ua && ua <= 1 && 0 <= ub && ub <= 1 ) {
            result = new Intersection("Intersection");
            result.points.push(
                new Point2D(
                    a1.x + ua * (a2.x - a1.x),
                    a1.y + ua * (a2.y - a1.y)
                )
            );
        } else {
            result = new Intersection("No Intersection");
        }
    } else {
        if ( ua_t == 0 || ub_t == 0 ) {
            result = new Intersection("Coincident");
        } else {
            result = new Intersection("Parallel");
        }
    }

    return result;
};


/**
 *  intersectLinePolygon
 *
 *  @param {Point2D} a1
 *  @param {Point2D} a2
 *  @param {Array<Point2D>} points
 *  @returns {Intersection}
 */
Intersection.intersectLinePolygon = function(a1, a2, points) {
    var result = new Intersection("No Intersection");
    var length = points.length;

    for ( var i = 0; i < length; i++ ) {
        var b1 = points[i];
        var b2 = points[(i+1) % length];
        var inter = Intersection.intersectLineLine(a1, a2, b1, b2);

        result.appendPoints(inter.points);
    }

    if ( result.points.length > 0 ) result.status = "Intersection";

    return result;
};


/**
 *  intersectLineRectangle
 *
 *  @param {Point2D} a1
 *  @param {Point2D} a2
 *  @param {Point2D} r1
 *  @param {Point2D} r2
 *  @returns {Intersection}
 */
Intersection.intersectLineRectangle = function(a1, a2, r1, r2) {
    var min        = r1.min(r2);
    var max        = r1.max(r2);
    var topRight   = new Point2D( max.x, min.y );
    var bottomLeft = new Point2D( min.x, max.y );

    var inter1 = Intersection.intersectLineLine(min, topRight, a1, a2);
    var inter2 = Intersection.intersectLineLine(topRight, max, a1, a2);
    var inter3 = Intersection.intersectLineLine(max, bottomLeft, a1, a2);
    var inter4 = Intersection.intersectLineLine(bottomLeft, min, a1, a2);

    var result = new Intersection("No Intersection");

    result.appendPoints(inter1.points);
    result.appendPoints(inter2.points);
    result.appendPoints(inter3.points);
    result.appendPoints(inter4.points);

    if ( result.points.length > 0 )
        result.status = "Intersection";

    return result;
};


/**
 *  intersectPolygonPolygon
 *
 *  @param {Array<Point2D>} points1
 *  @param {Array<Point2D>} points2
 *  @returns {Intersection}
 */
Intersection.intersectPolygonPolygon = function(points1, points2) {
    var result = new Intersection("No Intersection");
    var length = points1.length;

    for ( var i = 0; i < length; i++ ) {
        var a1 = points1[i];
        var a2 = points1[(i+1) % length];
        var inter = Intersection.intersectLinePolygon(a1, a2, points2);

        result.appendPoints(inter.points);
    }

    if ( result.points.length > 0 )
        result.status = "Intersection";

    return result;

};


/**
 *  intersectPolygonRectangle
 *
 *  @param {Array<Point2D>} points
 *  @param {Point2D} r1
 *  @param {Point2D} r2
 *  @returns {Intersection}
 */
Intersection.intersectPolygonRectangle = function(points, r1, r2) {
    var min        = r1.min(r2);
    var max        = r1.max(r2);
    var topRight   = new Point2D( max.x, min.y );
    var bottomLeft = new Point2D( min.x, max.y );

    var inter1 = Intersection.intersectLinePolygon(min, topRight, points);
    var inter2 = Intersection.intersectLinePolygon(topRight, max, points);
    var inter3 = Intersection.intersectLinePolygon(max, bottomLeft, points);
    var inter4 = Intersection.intersectLinePolygon(bottomLeft, min, points);

    var result = new Intersection("No Intersection");

    result.appendPoints(inter1.points);
    result.appendPoints(inter2.points);
    result.appendPoints(inter3.points);
    result.appendPoints(inter4.points);

    if ( result.points.length > 0 )
        result.status = "Intersection";

    return result;
};


/**
 *  intersectRayRay
 *
 *  @param {Point2D} a1
 *  @param {Point2D} a2
 *  @param {Point2D} b1
 *  @param {Point2D} b2
 *  @returns {Intersection}
 */
Intersection.intersectRayRay = function(a1, a2, b1, b2) {
    var result;

    var ua_t = (b2.x - b1.x) * (a1.y - b1.y) - (b2.y - b1.y) * (a1.x - b1.x);
    var ub_t = (a2.x - a1.x) * (a1.y - b1.y) - (a2.y - a1.y) * (a1.x - b1.x);
    var u_b  = (b2.y - b1.y) * (a2.x - a1.x) - (b2.x - b1.x) * (a2.y - a1.y);

    if ( u_b != 0 ) {
        var ua = ua_t / u_b;

        result = new Intersection("Intersection");
        result.points.push(
            new Point2D(
                a1.x + ua * (a2.x - a1.x),
                a1.y + ua * (a2.y - a1.y)
            )
        );
    } else {
        if ( ua_t == 0 || ub_t == 0 ) {
            result = new Intersection("Coincident");
        } else {
            result = new Intersection("Parallel");
        }
    }

    return result;
};


/**
 *  intersectRectangleRectangle
 *
 *  @param {Point2D} a1
 *  @param {Point2D} a2
 *  @param {Point2D} b1
 *  @param {Point2D} b2
 *  @returns {Intersection}
 */
Intersection.intersectRectangleRectangle = function(a1, a2, b1, b2) {
    var min        = a1.min(a2);
    var max        = a1.max(a2);
    var topRight   = new Point2D( max.x, min.y );
    var bottomLeft = new Point2D( min.x, max.y );

    var inter1 = Intersection.intersectLineRectangle(min, topRight, b1, b2);
    var inter2 = Intersection.intersectLineRectangle(topRight, max, b1, b2);
    var inter3 = Intersection.intersectLineRectangle(max, bottomLeft, b1, b2);
    var inter4 = Intersection.intersectLineRectangle(bottomLeft, min, b1, b2);

    var result = new Intersection("No Intersection");

    result.appendPoints(inter1.points);
    result.appendPoints(inter2.points);
    result.appendPoints(inter3.points);
    result.appendPoints(inter4.points);

    if ( result.points.length > 0 )
        result.status = "Intersection";

    return result;
};


/**
 *  bezout
 *
 *  This code is based on MgcIntr2DElpElp.cpp written by David Eberly.  His
 *  code along with many other excellent examples are avaiable at his site:
 *  http://www.magic-software.com
 *
 *  @param {Array<Point2D>} e1
 *  @param {Array<Point2D>} e2
 *  @returns {Polynomial}
 */
Intersection.bezout = function(e1, e2) {
    var AB    = e1[0]*e2[1] - e2[0]*e1[1];
    var AC    = e1[0]*e2[2] - e2[0]*e1[2];
    var AD    = e1[0]*e2[3] - e2[0]*e1[3];
    var AE    = e1[0]*e2[4] - e2[0]*e1[4];
    var AF    = e1[0]*e2[5] - e2[0]*e1[5];
    var BC    = e1[1]*e2[2] - e2[1]*e1[2];
    var BE    = e1[1]*e2[4] - e2[1]*e1[4];
    var BF    = e1[1]*e2[5] - e2[1]*e1[5];
    var CD    = e1[2]*e2[3] - e2[2]*e1[3];
    var DE    = e1[3]*e2[4] - e2[3]*e1[4];
    var DF    = e1[3]*e2[5] - e2[3]*e1[5];
    var BFpDE = BF + DE;
    var BEmCD = BE - CD;

    return new Polynomial(
        AB*BC - AC*AC,
        AB*BEmCD + AD*BC - 2*AC*AE,
        AB*BFpDE + AD*BEmCD - AE*AE - 2*AC*AF,
        AB*DF + AD*BFpDE - 2*AE*AF,
        AD*DF - AF*AF
    );
};

if (typeof module !== "undefined") {
    module.exports = Intersection;
}

},{"kld-affine":25,"kld-polynomial":29}],24:[function(require,module,exports){
/**
 *
 *   IntersectionParams.js
 *
 *   copyright 2002, Kevin Lindsey
 *
 */

/**
 *  IntersectionParams
 *
 *  @param {String} name
 *  @param {Array<Point2D} params
 *  @returns {IntersectionParams}
 */
function IntersectionParams(name, params) {
    this.init(name, params);
}

/**
 *  init
 *
 *  @param {String} name
 *  @param {Array<Point2D>} params
 */
IntersectionParams.prototype.init = function(name, params) {
    this.name   = name;
    this.params = params;
};

if (typeof module !== "undefined") {
    module.exports = IntersectionParams;
}
},{}],25:[function(require,module,exports){
// expose classes

exports.Point2D = require('./lib/Point2D');
exports.Vector2D = require('./lib/Vector2D');
exports.Matrix2D = require('./lib/Matrix2D');

},{"./lib/Matrix2D":26,"./lib/Point2D":27,"./lib/Vector2D":28}],26:[function(require,module,exports){
/**
 *
 *   Matrix2D.js
 *
 *   copyright 2001-2002, 2013 Kevin Lindsey
 *
 */

/**
 *  Matrix2D
 *
 *  @param {Number} a
 *  @param {Number} b
 *  @param {Number} c
 *  @param {Number} d
 *  @param {Number} e
 *  @param {Number} f
 *  @returns {Matrix2D}
 */
function Matrix2D(a, b, c, d, e, f) {
    Object.defineProperties(this, {
        "a": {
            value: (a !== undefined) ? a : 1,
            writable: false,
            enumerable: true,
            configurable: false
        },
        "b": {
            value: (b !== undefined) ? b : 0,
            writable: false,
            enumerable: true,
            configurable: false
        },
        "c": {
            value: (c !== undefined) ? c : 0,
            writable: false,
            enumerable: true,
            configurable: false
        },
        "d": {
            value: (d !== undefined) ? d : 1,
            writable: false,
            enumerable: true,
            configurable: false
        },
        "e": {
            value: (e !== undefined) ? e : 0,
            writable: false,
            enumerable: true,
            configurable: false
        },
        "f": {
            value: (f !== undefined) ? f : 0,
            writable: false,
            enumerable: true,
            configurable: false
        }
    });
    // this.a = (a !== undefined) ? a : 1;
    // this.b = (b !== undefined) ? b : 0;
    // this.c = (c !== undefined) ? c : 0;
    // this.d = (d !== undefined) ? d : 1;
    // this.e = (e !== undefined) ? e : 0;
    // this.f = (f !== undefined) ? f : 0;
}

/**
 *  Identity matrix
 *
 *  @returns {Matrix2D}
 */
Matrix2D.IDENTITY = new Matrix2D(1, 0, 0, 1, 0, 0);

// TODO: rotate, skew, etc. matrices as well?

/**
 *  multiply
 *
 *  @pararm {Matrix2D} that
 *  @returns {Matrix2D}
 */
Matrix2D.prototype.multiply = function(that) {
    return new Matrix2D(
        this.a * that.a + this.c * that.b,
        this.b * that.a + this.d * that.b,
        this.a * that.c + this.c * that.d,
        this.b * that.c + this.d * that.d,
        this.a * that.e + this.c * that.f + this.e,
        this.b * that.e + this.d * that.f + this.f
    );
};

/**
 *  inverse
 *
 *  @returns {Matrix2D}
 */
Matrix2D.prototype.inverse = function() {
    var det1 = this.a * this.d - this.b * this.c;

    if ( det1 == 0.0 )
        throw("Matrix is not invertible");

    var idet = 1.0 / det1;
    var det2 = this.f * this.c - this.e * this.d;
    var det3 = this.e * this.b - this.f * this.a;

    return new Matrix2D(
        this.d * idet,
       -this.b * idet,
       -this.c * idet,
        this.a * idet,
          det2 * idet,
          det3 * idet
    );
};

/**
 *  translate
 *
 *  @param {Number} tx
 *  @param {Number} ty
 *  @returns {Matrix2D}
 */
Matrix2D.prototype.translate = function(tx, ty) {
    return new Matrix2D(
        this.a,
        this.b,
        this.c,
        this.d,
        this.a * tx + this.c * ty + this.e,
        this.b * tx + this.d * ty + this.f
    );
};

/**
 *  scale
 *
 *  @param {Number} scale
 *  @returns {Matrix2D}
 */
Matrix2D.prototype.scale = function(scale) {
    return new Matrix2D(
        this.a * scale,
        this.b * scale,
        this.c * scale,
        this.d * scale,
        this.e,
        this.f
    );
};

/**
 *  scaleAt
 *
 *  @param {Number} scale
 *  @param {Point2D} center
 *  @returns {Matrix2D}
 */
Matrix2D.prototype.scaleAt = function(scale, center) {
    var dx = center.x - scale * center.x;
    var dy = center.y - scale * center.y;

    return new Matrix2D(
        this.a * scale,
        this.b * scale,
        this.c * scale,
        this.d * scale,
        this.a * dx + this.c * dy + this.e,
        this.b * dx + this.d * dy + this.f
    );
};

/**
 *  scaleNonUniform
 *
 *  @param {Number} scaleX
 *  @param {Number} scaleY
 *  @returns {Matrix2D}
 */
Matrix2D.prototype.scaleNonUniform = function(scaleX, scaleY) {
    return new Matrix2D(
        this.a * scaleX,
        this.b * scaleX,
        this.c * scaleY,
        this.d * scaleY,
        this.e,
        this.f
    );
};

/**
 *  scaleNonUniformAt
 *
 *  @param {Number} scaleX
 *  @param {Number} scaleY
 *  @param {Point2D} center
 *  @returns {Matrix2D}
 */
Matrix2D.prototype.scaleNonUniformAt = function(scaleX, scaleY, center) {
    var dx = center.x - scaleX * center.x;
    var dy = center.y - scaleY * center.y;

    return new Matrix2D(
        this.a * scaleX,
        this.b * scaleX,
        this.c * scaleY,
        this.d * scaleY,
        this.a * dx + this.c * dy + this.e,
        this.b * dx + this.d * dy + this.f
    );
};

/**
 *  rotate
 *
 *  @param {Number} radians
 *  @returns {Matrix2D}
 */
Matrix2D.prototype.rotate = function(radians) {
    var c = Math.cos(radians);
    var s = Math.sin(radians);

    return new Matrix2D(
        this.a *  c + this.c * s,
        this.b *  c + this.d * s,
        this.a * -s + this.c * c,
        this.b * -s + this.d * c,
        this.e,
        this.f
    );
};

/**
 *  rotateAt
 *
 *  @param {Number} radians
 *  @param {Point2D} center
 *  @result {Matrix2D}
 */
Matrix2D.prototype.rotateAt = function(radians, center) {
    var c = Math.cos(radians);
    var s = Math.sin(radians);
    var t1 = -center.x + center.x * c - center.y * s;
    var t2 = -center.y + center.y * c + center.x * s;

    return new Matrix2D(
        this.a *  c + this.c * s,
        this.b *  c + this.d * s,
        this.a * -s + this.c * c,
        this.b * -s + this.d * c,
        this.a * t1 + this.c * t2 + this.e,
        this.b * t1 + this.d * t2 + this.f
    );
};

/**
 *  rotateFromVector
 *
 *  @param {Vector2D}
 *  @returns {Matrix2D}
 */
Matrix2D.prototype.rotateFromVector = function(vector) {
    var unit = vector.unit();
    var c = unit.x; // cos
    var s = unit.y; // sin

    return new Matrix2D(
        this.a *  c + this.c * s,
        this.b *  c + this.d * s,
        this.a * -s + this.c * c,
        this.b * -s + this.d * c,
        this.e,
        this.f
    );
};

/**
 *  flipX
 *
 *  @returns {Matrix2D}
 */
Matrix2D.prototype.flipX = function() {
    return new Matrix2D(
        -this.a,
        -this.b,
         this.c,
         this.d,
         this.e,
         this.f
    );
};

/**
 *  flipY
 *
 *  @returns {Matrix2D}
 */
Matrix2D.prototype.flipY = function() {
    return new Matrix2D(
         this.a,
         this.b,
        -this.c,
        -this.d,
         this.e,
         this.f
    );
};

/**
 *  skewX
 *
 *  @pararm {Number} radians
 *  @returns {Matrix2D}
 */
Matrix2D.prototype.skewX = function(radians) {
    var t = Math.tan(radians);

    return new Matrix2D(
        this.a,
        this.b,
        this.a * t + this.c,
        this.b * t + this.d,
        this.e,
        this.f
    );
};

// TODO: skewXAt

/**
 *  skewY
 *
 *  @pararm {Number} radians
 *  @returns {Matrix2D}
 */
Matrix2D.prototype.skewY = function(radians) {
    var t = Math.tan(angle);

    return matrix_new(
        this.a + this.c * t,
        this.b + this.d * t,
        this.c,
        this.d,
        this.e,
        this.f
    );
};

// TODO: skewYAt

/**
 *  isIdentity
 *
 *  @returns {Boolean}
 */
Matrix2D.prototype.isIdentity = function() {
    return (
        this.a === 1.0 &&
        this.b === 0.0 &&
        this.c === 0.0 &&
        this.d === 1.0 &&
        this.e === 0.0 &&
        this.f === 0.0
    );
};

/**
 *  isInvertible
 *
 *  @returns {Boolean}
 */
Matrix2D.prototype.isInvertible = function() {
    this.a * this.d - this.b * this.c !== 0.0;
};

/**
 *  getScale
 *
 *  @returns {scaleX: Number, scaleY: Number}
 */
Matrix2D.prototype.getScale = function() {
    return {
        scaleX: Math.sqrt(this.a * this.a + this.c * this.c),
        scaleY: Math.sqrt(this.b * this.b + this.d * this.d)
    };
};

/**
 *  equals
 *
 *  @param {Matrix2D} that
 *  @returns {Boolean}
 */
Matrix2D.prototype.equals = function(that) {
    return (
        this.a === that.a &&
        this.b === that.b &&
        this.c === that.c &&
        this.d === that.d &&
        this.e === that.e &&
        this.f === that.f
    );
};

/**
 *  toString
 *
 *  @returns {String}
 */
Matrix2D.prototype.toString = function() {
    return (
        "matrix(" +
        this.a + "," +
        this.b + "," +
        this.c + "," +
        this.d + "," +
        this.e + "," +
        this.f + ")"
    );
}

if (typeof module !== "undefined") {
    module.exports = Matrix2D;
}
},{}],27:[function(require,module,exports){
/**
 *
 *   Point2D.js
 *
 *   copyright 2001-2002, 2013 Kevin Lindsey
 *
 */

/**
 *  Point2D
 *
 *  @param {Number} x
 *  @param {Number} y
 *  @returns {Point2D}
 */
function Point2D(x, y) {
    Object.defineProperties(this, {
        "x": {
            value: x,
            writable: false,
            enumerable: true,
            configurable: false
        },
        "y": {
            value: y,
            writable: false,
            enumerable: true,
            configurable: false
        }
    });
    // this.x = x;
    // this.y = y;
}

/**
 *  clone
 *
 *  @returns {Point2D}
 */
Point2D.prototype.clone = function() {
    return new Point2D(this.x, this.y);
};

/**
 *  add
 *
 *  @param {Point2D|Vector2D} that
 *  @returns {Point2D}
 */
Point2D.prototype.add = function(that) {
    return new Point2D(this.x+that.x, this.y+that.y);
};

/**
 *  subtract
 *
 *  @param { Vector2D | Point2D } that
 *  @returns {Point2D}
 */
Point2D.prototype.subtract = function(that) {
    return new Point2D(this.x-that.x, this.y-that.y);
};

/**
 *  multiply
 *
 *  @param {Number} scalar
 *  @returns {Point2D}
 */
Point2D.prototype.multiply = function(scalar) {
    return new Point2D(this.x*scalar, this.y*scalar);
};

/**
 *  divide
 *
 *  @param {Number} scalar
 *  @returns {Point2D}
 */
Point2D.prototype.divide = function(scalar) {
    return new Point2D(this.x/scalar, this.y/scalar);
};

/**
 *  equals
 *
 *  @param {Point2D} that
 *  @returns {Boolean}
 */
Point2D.prototype.equals = function(that) {
    return ( this.x == that.x && this.y == that.y );
};

// utility methods

/**
 *  lerp
 *
 *  @param { Vector2D | Point2D } that
 *  @param {Number} t
 @  @returns {Point2D}
 */
Point2D.prototype.lerp = function(that, t) {
    var omt = 1.0 - t;

    return new Point2D(
        this.x * omt + that.x * t,
        this.y * omt + that.y * t
    );
};

/**
 *  distanceFrom
 *
 *  @param {Point2D} that
 *  @returns {Number}
 */
Point2D.prototype.distanceFrom = function(that) {
    var dx = this.x - that.x;
    var dy = this.y - that.y;

    return Math.sqrt(dx*dx + dy*dy);
};

/**
 *  min
 *
 *  @param {Point2D} that
 *  @returns {Number}
 */
Point2D.prototype.min = function(that) {
    return new Point2D(
        Math.min( this.x, that.x ),
        Math.min( this.y, that.y )
    );
};

/**
 *  max
 *
 *  @param {Point2D} that
 *  @returns {Number}
 */
Point2D.prototype.max = function(that) {
    return new Point2D(
        Math.max( this.x, that.x ),
        Math.max( this.y, that.y )
    );
};

/**
 *  transform
 *
 *  @param {Matrix2D}
 *  @result {Point2D}
 */
Point2D.prototype.transform = function(matrix) {
    return new Point2D(
        matrix.a * this.x + matrix.c * this.y + matrix.e,
        matrix.b * this.x + matrix.d * this.y + matrix.f
    );
};

/**
 *  toString
 *
 *  @returns {String}
 */
Point2D.prototype.toString = function() {
    return "point(" + this.x + "," + this.y + ")";
};

if (typeof module !== "undefined") {
    module.exports = Point2D;
}

},{}],28:[function(require,module,exports){
/**
 *
 *   Vector2D.js
 *
 *   copyright 2001-2002, 2013 Kevin Lindsey
 *
 */

/**
 *  Vector2D
 *
 *  @param {Number} x
 *  @param {Number} y
 *  @returns {Vector2D}
 */
function Vector2D(x, y) {
    Object.defineProperties(this, {
        "x": {
            value: x,
            writable: false,
            enumerable: true,
            configurable: false
        },
        "y": {
            value: y,
            writable: false,
            enumerable: true,
            configurable: false
        }
    });
    // this.x = x;
    // this.y = y;
}

/**
 *  fromPoints
 *
 *  @param {Point2D} p1
 *  @param {Point2D} p2
 *  @returns {Vector2D}
 */
Vector2D.fromPoints = function(p1, p2) {
    return new Vector2D(
        p2.x - p1.x,
        p2.y - p1.y
    );
};

/**
 *  length
 *
 *  @returns {Number}
 */
Vector2D.prototype.length = function() {
    return Math.sqrt(this.x*this.x + this.y*this.y);
};

/**
 *  magnitude
 *
 *  @returns {Number}
 */
Vector2D.prototype.magnitude = function() {
    return this.x*this.x + this.y*this.y;
};

/**
 *  dot
 *
 *  @param {Vector2D} that
 *  @returns {Number}
 */
Vector2D.prototype.dot = function(that) {
    return this.x*that.x + this.y*that.y;
};

/**
 *  cross
 *
 *  @param {Vector2D} that
 *  @returns {Number}
 */
Vector2D.prototype.cross = function(that) {
    return this.x*that.y - this.y*that.x;
}

/**
 *  determinant
 *
 *  @param {Vector2D} that
 *  @returns {Number}
 */
Vector2D.prototype.determinant = function(that) {
    return this.x*that.y - this.y*that.x;
};

/**
 *  unit
 *
 *  @returns {Vector2D}
 */
Vector2D.prototype.unit = function() {
    return this.divide( this.length() );
};

/**
 *  add
 *
 *  @param {Vector2D} that
 *  @returns {Vector2D}
 */
Vector2D.prototype.add = function(that) {
    return new Vector2D(this.x + that.x, this.y + that.y);
};

/**
 *  subtract
 *
 *  @param {Vector2D} that
 *  @returns {Vector2D}
 */
Vector2D.prototype.subtract = function(that) {
    return new Vector2D(this.x - that.x, this.y - that.y);
};

/**
 *  multiply
 *
 *  @param {Number} scalar
 *  @returns {Vector2D}
 */
Vector2D.prototype.multiply = function(scalar) {
    return new Vector2D(this.x * scalar, this.y * scalar);
};

/**
 *  divide
 *
 *  @param {Number} scalar
 *  @returns {Vector2D}
 */
Vector2D.prototype.divide = function(scalar) {
    return new Vector2D(this.x / scalar, this.y / scalar);
};

/**
 *  angleBetween
 *
 *  @param {Vector2D} that
 *  @returns {Number}
 */
Vector2D.prototype.angleBetween = function(that) {
    var cos = this.dot(that) / (this.length() * that.length());
    if (cos < -1) {
        cos = -1;
    }
    else if (cos > 1) {
        cos = 1;
    }
    var radians = Math.acos(cos);

    return (this.cross(that) < 0.0) ? -radians : radians;
};

/**
 *  Find a vector is that is perpendicular to this vector
 *
 *  @returns {Vector2D}
 */
Vector2D.prototype.perp = function() {
    return new Vector2D(-this.y, this.x);
};

/**
 *  Find the component of the specified vector that is perpendicular to
 *  this vector
 *
 *  @param {Vector2D} that
 *  @returns {Vector2D}
 */
Vector2D.prototype.perpendicular = function(that) {
    return this.subtract(this.project(that));
};

/**
 *  project
 *
 *  @param {Vector2D} that
 *  @returns {Vector2D}
 */
Vector2D.prototype.project = function(that) {
    var percent = this.dot(that) / that.dot(that);

    return that.multiply(percent);
};

/**
 *  transform
 *
 *  @param {Matrix2D}
 *  @returns {Vector2D}
 */
Vector2D.prototype.transform = function(matrix) {
    return new Vector2D(
        matrix.a * this.x + matrix.c * this.y,
        matrix.b * this.x + matrix.d * this.y
    );
};

/**
 *  equals
 *
 *  @param {Vector2D} that
 *  @returns {Boolean}
 */
Vector2D.prototype.equals = function(that) {
    return (
        this.x === that.x &&
        this.y === that.y
    );
};

/**
 *  toString
 *
 *  @returns {String}
 */
Vector2D.prototype.toString = function() {
    return "vector(" + this.x + "," + this.y + ")";
};

if (typeof module !== "undefined") {
    module.exports = Vector2D;
}

},{}],29:[function(require,module,exports){
// expose classes

exports.Polynomial = require('./lib/Polynomial');
exports.SqrtPolynomial = require('./lib/SqrtPolynomial');

},{"./lib/Polynomial":30,"./lib/SqrtPolynomial":31}],30:[function(require,module,exports){
/**
 *
 *   Polynomial.js
 *
 *   copyright 2002, 2103 Kevin Lindsey
 *
 */

Polynomial.TOLERANCE = 1e-6;
Polynomial.ACCURACY  = 15;


/**
 *  interpolate
 *
 *  @param {Array<Number>} xs
 *  @param {Array<Number>} ys
 *  @param {Number} n
 *  @param {Number} offset
 *  @param {Number} x
 *
 *  @returns {y:Number, dy:Number}
 */
Polynomial.interpolate = function(xs, ys, n, offset, x) {
    if ( xs.constructor !== Array || ys.constructor !== Array )
        throw new Error("Polynomial.interpolate: xs and ys must be arrays");
    if ( isNaN(n) || isNaN(offset) || isNaN(x) )
        throw new Error("Polynomial.interpolate: n, offset, and x must be numbers");

    var y  = 0;
    var dy = 0;
    var c = new Array(n);
    var d = new Array(n);
    var ns = 0;
    var result;

    var diff = Math.abs(x - xs[offset]);
    for ( var i = 0; i < n; i++ ) {
        var dift = Math.abs(x - xs[offset+i]);

        if ( dift < diff ) {
            ns = i;
            diff = dift;
        }
        c[i] = d[i] = ys[offset+i];
    }
    y = ys[offset+ns];
    ns--;

    for ( var m = 1; m < n; m++ ) {
        for ( var i = 0; i < n-m; i++ ) {
            var ho = xs[offset+i] - x;
            var hp = xs[offset+i+m] - x;
            var w = c[i+1]-d[i];
            var den = ho - hp;

            if ( den == 0.0 ) {
                result = { y: 0, dy: 0};
                break;
            }

            den = w / den;
            d[i] = hp*den;
            c[i] = ho*den;
        }
        dy = (2*(ns+1) < (n-m)) ? c[ns+1] : d[ns--];
        y += dy;
    }

    return { y: y, dy: dy };
};


/**
 *  Polynomial
 *
 *  @returns {Polynomial}
 */
function Polynomial() {
    this.init( arguments );
}


/**
 *  init
 */
Polynomial.prototype.init = function(coefs) {
    this.coefs = new Array();

    for ( var i = coefs.length - 1; i >= 0; i-- )
        this.coefs.push( coefs[i] );

    this._variable = "t";
    this._s = 0;
};


/**
 *  eval
 */
Polynomial.prototype.eval = function(x) {
    if ( isNaN(x) )
        throw new Error("Polynomial.eval: parameter must be a number");

    var result = 0;

    for ( var i = this.coefs.length - 1; i >= 0; i-- )
        result = result * x + this.coefs[i];

    return result;
};


/**
 *  add
 */
Polynomial.prototype.add = function(that) {
    var result = new Polynomial();
    var d1 = this.getDegree();
    var d2 = that.getDegree();
    var dmax = Math.max(d1,d2);

    for ( var i = 0; i <= dmax; i++ ) {
        var v1 = (i <= d1) ? this.coefs[i] : 0;
        var v2 = (i <= d2) ? that.coefs[i] : 0;

        result.coefs[i] = v1 + v2;
    }

    return result;
};


/**
 *  multiply
 */
Polynomial.prototype.multiply = function(that) {
    var result = new Polynomial();

    for ( var i = 0; i <= this.getDegree() + that.getDegree(); i++ )
        result.coefs.push(0);

    for ( var i = 0; i <= this.getDegree(); i++ )
        for ( var j = 0; j <= that.getDegree(); j++ )
            result.coefs[i+j] += this.coefs[i] * that.coefs[j];

    return result;
};


/**
 *  divide_scalar
 */
Polynomial.prototype.divide_scalar = function(scalar) {
    for ( var i = 0; i < this.coefs.length; i++ )
        this.coefs[i] /= scalar;
};


/**
 *  simplify
 */
Polynomial.prototype.simplify = function() {
    for ( var i = this.getDegree(); i >= 0; i-- ) {
        if ( Math.abs( this.coefs[i] ) <= Polynomial.TOLERANCE )
            this.coefs.pop();
        else
            break;
    }
};


/**
 *  bisection
 */
Polynomial.prototype.bisection = function(min, max) {
    var minValue = this.eval(min);
    var maxValue = this.eval(max);
    var result;

    if ( Math.abs(minValue) <= Polynomial.TOLERANCE )
        result = min;
    else if ( Math.abs(maxValue) <= Polynomial.TOLERANCE )
        result = max;
    else if ( minValue * maxValue <= 0 ) {
        var tmp1  = Math.log(max - min);
        var tmp2  = Math.LN10 * Polynomial.ACCURACY;
        var iters = Math.ceil( (tmp1+tmp2) / Math.LN2 );

        for ( var i = 0; i < iters; i++ ) {
            result = 0.5 * (min + max);
            var value = this.eval(result);

            if ( Math.abs(value) <= Polynomial.TOLERANCE ) {
                break;
            }

            if ( value * minValue < 0 ) {
                max = result;
                maxValue = value;
            } else {
                min = result;
                minValue = value;
            }
        }
    }

    return result;
};


/**
 *  toString
 */
Polynomial.prototype.toString = function() {
    var coefs = new Array();
    var signs = new Array();

    for ( var i = this.coefs.length - 1; i >= 0; i-- ) {
        var value = Math.round(this.coefs[i]*1000)/1000;
        //var value = this.coefs[i];

        if ( value != 0 ) {
            var sign = ( value < 0 ) ? " - " : " + ";

            value = Math.abs(value);
            if ( i > 0 )
                if ( value == 1 )
                    value = this._variable;
                else
                    value += this._variable;
            if ( i > 1 ) value += "^" + i;

            signs.push( sign );
            coefs.push( value );
        }
    }

    signs[0] = ( signs[0] == " + " ) ? "" : "-";

    var result = "";
    for ( var i = 0; i < coefs.length; i++ )
        result += signs[i] + coefs[i];

    return result;
};


/**
 *  trapezoid
 *  Based on trapzd in "Numerical Recipes in C", page 137
 */
Polynomial.prototype.trapezoid = function(min, max, n) {
    if ( isNaN(min) || isNaN(max) || isNaN(n) )
        throw new Error("Polynomial.trapezoid: parameters must be numbers");

    var range = max - min;
    var TOLERANCE = 1e-7;

    if ( n == 1 ) {
        var minValue = this.eval(min);
        var maxValue = this.eval(max);
        this._s = 0.5*range*( minValue + maxValue );
    } else {
        var it = 1 << (n-2);
        var delta = range / it;
        var x = min + 0.5*delta;
        var sum = 0;

        for ( var i = 0; i < it; i++ ) {
            sum += this.eval(x);
            x += delta;
        }
        this._s = 0.5*(this._s + range*sum/it);
    }

    if ( isNaN(this._s) )
        throw new Error("Polynomial.trapezoid: this._s is NaN");

    return this._s;
};


/**
 *  simpson
 *  Based on trapzd in "Numerical Recipes in C", page 139
 */
Polynomial.prototype.simpson = function(min, max) {
    if ( isNaN(min) || isNaN(max) )
        throw new Error("Polynomial.simpson: parameters must be numbers");

    var range = max - min;
    var st = 0.5 * range * ( this.eval(min) + this.eval(max) );
    var t = st;
    var s = 4.0*st/3.0;
    var os = s;
    var ost = st;
    var TOLERANCE = 1e-7;

    var it = 1;
    for ( var n = 2; n <= 20; n++ ) {
        var delta = range / it;
        var x     = min + 0.5*delta;
        var sum   = 0;

        for ( var i = 1; i <= it; i++ ) {
            sum += this.eval(x);
            x += delta;
        }

        t = 0.5 * (t + range * sum / it);
        st = t;
        s = (4.0*st - ost)/3.0;

        if ( Math.abs(s-os) < TOLERANCE*Math.abs(os) )
            break;

        os = s;
        ost = st;
        it <<= 1;
    }

    return s;
};


/**
 *  romberg
 */
Polynomial.prototype.romberg = function(min, max) {
    if ( isNaN(min) || isNaN(max) )
        throw new Error("Polynomial.romberg: parameters must be numbers");

    var MAX = 20;
    var K = 3;
    var TOLERANCE = 1e-6;
    var s = new Array(MAX+1);
    var h = new Array(MAX+1);
    var result = { y: 0, dy: 0 };

    h[0] = 1.0;
    for ( var j = 1; j <= MAX; j++ ) {
        s[j-1] = this.trapezoid(min, max, j);
        if ( j >= K ) {
            result = Polynomial.interpolate(h, s, K, j-K, 0.0);
            if ( Math.abs(result.dy) <= TOLERANCE*result.y) break;
        }
        s[j] = s[j-1];
        h[j] = 0.25 * h[j-1];
    }

    return result.y;
};

// getters and setters

/**
 *  get degree
 */
Polynomial.prototype.getDegree = function() {
    return this.coefs.length - 1;
};


/**
 *  getDerivative
 */
Polynomial.prototype.getDerivative = function() {
    var derivative = new Polynomial();

    for ( var i = 1; i < this.coefs.length; i++ ) {
        derivative.coefs.push(i*this.coefs[i]);
    }

    return derivative;
};


/**
 *  getRoots
 */
Polynomial.prototype.getRoots = function() {
    var result;

    this.simplify();
    switch ( this.getDegree() ) {
        case 0: result = new Array();              break;
        case 1: result = this.getLinearRoot();     break;
        case 2: result = this.getQuadraticRoots(); break;
        case 3: result = this.getCubicRoots();     break;
        case 4: result = this.getQuarticRoots();   break;
        default:
            result = new Array();
            // should try Newton's method and/or bisection
    }

    return result;
};


/**
 *  getRootsInInterval
 */
Polynomial.prototype.getRootsInInterval = function(min, max) {
    var roots = new Array();
    var root;

    if ( this.getDegree() == 1 ) {
        root = this.bisection(min, max);
        if ( root != null ) roots.push(root);
    } else {
        // get roots of derivative
        var deriv  = this.getDerivative();
        var droots = deriv.getRootsInInterval(min, max);

        if ( droots.length > 0 ) {
            // find root on [min, droots[0]]
            root = this.bisection(min, droots[0]);
            if ( root != null ) roots.push(root);

            // find root on [droots[i],droots[i+1]] for 0 <= i <= count-2
            for ( i = 0; i <= droots.length-2; i++ ) {
                root = this.bisection(droots[i], droots[i+1]);
                if ( root != null ) roots.push(root);
            }

            // find root on [droots[count-1],xmax]
            root = this.bisection(droots[droots.length-1], max);
            if ( root != null ) roots.push(root);
        } else {
            // polynomial is monotone on [min,max], has at most one root
            root = this.bisection(min, max);
            if ( root != null ) roots.push(root);
        }
    }

    return roots;
};


/**
 *  getLinearRoot
 */
Polynomial.prototype.getLinearRoot = function() {
    var result = new Array();
    var a = this.coefs[1];

    if ( a != 0 )
        result.push( -this.coefs[0] / a );

    return result;
};


/**
 *  getQuadraticRoots
 */
Polynomial.prototype.getQuadraticRoots = function() {
    var results = new Array();

    if ( this.getDegree() == 2 ) {
        var a = this.coefs[2];
        var b = this.coefs[1] / a;
        var c = this.coefs[0] / a;
        var d = b*b - 4*c;

        if ( d > 0 ) {
            var e = Math.sqrt(d);

            results.push( 0.5 * (-b + e) );
            results.push( 0.5 * (-b - e) );
        } else if ( d == 0 ) {
            // really two roots with same value, but we only return one
            results.push( 0.5 * -b );
        }
    }

    return results;
};


/**
 *  getCubicRoots
 *
 *  This code is based on MgcPolynomial.cpp written by David Eberly.  His
 *  code along with many other excellent examples are avaiable at his site:
 *  http://www.magic-software.com
 */
Polynomial.prototype.getCubicRoots = function() {
    var results = new Array();

    if ( this.getDegree() == 3 ) {
        var c3 = this.coefs[3];
        var c2 = this.coefs[2] / c3;
        var c1 = this.coefs[1] / c3;
        var c0 = this.coefs[0] / c3;

        var a       = (3*c1 - c2*c2) / 3;
        var b       = (2*c2*c2*c2 - 9*c1*c2 + 27*c0) / 27;
        var offset  = c2 / 3;
        var discrim = b*b/4 + a*a*a/27;
        var halfB   = b / 2;

        if ( Math.abs(discrim) <= Polynomial.TOLERANCE ) discrim = 0;

        if ( discrim > 0 ) {
            var e = Math.sqrt(discrim);
            var tmp;
            var root;

            tmp = -halfB + e;
            if ( tmp >= 0 )
                root = Math.pow(tmp, 1/3);
            else
                root = -Math.pow(-tmp, 1/3);

            tmp = -halfB - e;
            if ( tmp >= 0 )
                root += Math.pow(tmp, 1/3);
            else
                root -= Math.pow(-tmp, 1/3);

            results.push( root - offset );
        } else if ( discrim < 0 ) {
            var distance = Math.sqrt(-a/3);
            var angle    = Math.atan2( Math.sqrt(-discrim), -halfB) / 3;
            var cos      = Math.cos(angle);
            var sin      = Math.sin(angle);
            var sqrt3    = Math.sqrt(3);

            results.push( 2*distance*cos - offset );
            results.push( -distance * (cos + sqrt3 * sin) - offset);
            results.push( -distance * (cos - sqrt3 * sin) - offset);
        } else {
            var tmp;

            if ( halfB >= 0 )
                tmp = -Math.pow(halfB, 1/3);
            else
                tmp = Math.pow(-halfB, 1/3);

            results.push( 2*tmp - offset );
            // really should return next root twice, but we return only one
            results.push( -tmp - offset );
        }
    }

    return results;
};


/**
 *  getQuarticRoots
 *
 *  This code is based on MgcPolynomial.cpp written by David Eberly.  His
 *  code along with many other excellent examples are avaiable at his site:
 *  http://www.magic-software.com
 */
Polynomial.prototype.getQuarticRoots = function() {
    var results = new Array();

    if ( this.getDegree() == 4 ) {
        var c4 = this.coefs[4];
        var c3 = this.coefs[3] / c4;
        var c2 = this.coefs[2] / c4;
        var c1 = this.coefs[1] / c4;
        var c0 = this.coefs[0] / c4;

        var resolveRoots = new Polynomial(
            1, -c2, c3*c1 - 4*c0, -c3*c3*c0 + 4*c2*c0 -c1*c1
        ).getCubicRoots();
        var y       = resolveRoots[0];
        var discrim = c3*c3/4 - c2 + y;

        if ( Math.abs(discrim) <= Polynomial.TOLERANCE ) discrim = 0;

        if ( discrim > 0 ) {
            var e     = Math.sqrt(discrim);
            var t1    = 3*c3*c3/4 - e*e - 2*c2;
            var t2    = ( 4*c3*c2 - 8*c1 - c3*c3*c3 ) / ( 4*e );
            var plus  = t1+t2;
            var minus = t1-t2;

            if ( Math.abs(plus)  <= Polynomial.TOLERANCE ) plus  = 0;
            if ( Math.abs(minus) <= Polynomial.TOLERANCE ) minus = 0;

            if ( plus >= 0 ) {
                var f = Math.sqrt(plus);

                results.push( -c3/4 + (e+f)/2 );
                results.push( -c3/4 + (e-f)/2 );
            }
            if ( minus >= 0 ) {
                var f = Math.sqrt(minus);

                results.push( -c3/4 + (f-e)/2 );
                results.push( -c3/4 - (f+e)/2 );
            }
        } else if ( discrim < 0 ) {
            // no roots
        } else {
            var t2 = y*y - 4*c0;

            if ( t2 >= -Polynomial.TOLERANCE ) {
                if ( t2 < 0 ) t2 = 0;

                t2 = 2*Math.sqrt(t2);
                t1 = 3*c3*c3/4 - 2*c2;
                if ( t1+t2 >= Polynomial.TOLERANCE ) {
                    var d = Math.sqrt(t1+t2);

                    results.push( -c3/4 + d/2 );
                    results.push( -c3/4 - d/2 );
                }
                if ( t1-t2 >= Polynomial.TOLERANCE ) {
                    var d = Math.sqrt(t1-t2);

                    results.push( -c3/4 + d/2 );
                    results.push( -c3/4 - d/2 );
                }
            }
        }
    }

    return results;
};

if (typeof module !== "undefined") {
    module.exports = Polynomial;
}

},{}],31:[function(require,module,exports){
/**
 *
 *   SqrtPolynomial.js
 *
 *   copyright 2003, 2013 Kevin Lindsey
 *
 */

if (typeof module !== "undefined") {
    var Polynomial = require("./Polynomial");
}

/**
 *   class variables
 */
SqrtPolynomial.VERSION = 1.0;

// setup inheritance
SqrtPolynomial.prototype             = new Polynomial();
SqrtPolynomial.prototype.constructor = SqrtPolynomial;
SqrtPolynomial.superclass            = Polynomial.prototype;


/**
 *  SqrtPolynomial
 */
function SqrtPolynomial() {
    this.init( arguments );
}


/**
 *  eval
 *
 *  @param {Number} x
 *  @returns {Number}
 */
SqrtPolynomial.prototype.eval = function(x) {
    var TOLERANCE = 1e-7;
    var result = SqrtPolynomial.superclass.eval.call(this, x);

    // NOTE: May need to change the following.  I added these to capture
    // some really small negative values that were being generated by one
    // of my Bezier arcLength functions
    if ( Math.abs(result) < TOLERANCE ) result = 0;
    if ( result < 0 )
        throw new Error("SqrtPolynomial.eval: cannot take square root of negative number");

    return Math.sqrt(result);
};

SqrtPolynomial.prototype.toString = function() {
    var result = SqrtPolynomial.superclass.toString.call(this);

    return "sqrt(" + result + ")";
};

if (typeof module !== "undefined") {
    module.exports = SqrtPolynomial;
}

},{"./Polynomial":30}],32:[function(require,module,exports){
/*
 (c) 2013, Vladimir Agafonkin
 RBush, a JavaScript library for high-performance 2D spatial indexing of points and rectangles.
 https://github.com/mourner/rbush
*/

(function () { 'use strict';

function rbush(maxEntries, format) {

    // jshint newcap: false, validthis: true
    if (!(this instanceof rbush)) return new rbush(maxEntries, format);

    // max entries in a node is 9 by default; min node fill is 40% for best performance
    this._maxEntries = Math.max(4, maxEntries || 9);
    this._minEntries = Math.max(2, Math.ceil(this._maxEntries * 0.4));

    if (format) {
        this._initFormat(format);
    }

    this.clear();
}

rbush.prototype = {

    all: function () {
        return this._all(this.data, []);
    },

    search: function (bbox) {

        var node = this.data,
            result = [],
            toBBox = this.toBBox;

        if (!intersects(bbox, node.bbox)) return result;

        var nodesToSearch = [],
            i, len, child, childBBox;

        while (node) {
            for (i = 0, len = node.children.length; i < len; i++) {

                child = node.children[i];
                childBBox = node.leaf ? toBBox(child) : child.bbox;

                if (intersects(bbox, childBBox)) {
                    if (node.leaf) result.push(child);
                    else if (contains(bbox, childBBox)) this._all(child, result);
                    else nodesToSearch.push(child);
                }
            }
            node = nodesToSearch.pop();
        }

        return result;
    },

    collides: function (bbox) {

        var node = this.data,
            toBBox = this.toBBox;

        if (!intersects(bbox, node.bbox)) return false;

        var nodesToSearch = [],
            i, len, child, childBBox;

        while (node) {
            for (i = 0, len = node.children.length; i < len; i++) {

                child = node.children[i];
                childBBox = node.leaf ? toBBox(child) : child.bbox;

                if (intersects(bbox, childBBox)) {
                    if (node.leaf || contains(bbox, childBBox)) return true;
                    nodesToSearch.push(child);
                }
            }
            node = nodesToSearch.pop();
        }

        return false;
    },

    load: function (data) {
        if (!(data && data.length)) return this;

        if (data.length < this._minEntries) {
            for (var i = 0, len = data.length; i < len; i++) {
                this.insert(data[i]);
            }
            return this;
        }

        // recursively build the tree with the given data from stratch using OMT algorithm
        var node = this._build(data.slice(), 0, data.length - 1, 0);

        if (!this.data.children.length) {
            // save as is if tree is empty
            this.data = node;

        } else if (this.data.height === node.height) {
            // split root if trees have the same height
            this._splitRoot(this.data, node);

        } else {
            if (this.data.height < node.height) {
                // swap trees if inserted one is bigger
                var tmpNode = this.data;
                this.data = node;
                node = tmpNode;
            }

            // insert the small tree into the large tree at appropriate level
            this._insert(node, this.data.height - node.height - 1, true);
        }

        return this;
    },

    insert: function (item) {
        if (item) this._insert(item, this.data.height - 1);
        return this;
    },

    clear: function () {
        this.data = {
            children: [],
            height: 1,
            bbox: empty(),
            leaf: true
        };
        return this;
    },

    remove: function (item) {
        if (!item) return this;

        var node = this.data,
            bbox = this.toBBox(item),
            path = [],
            indexes = [],
            i, parent, index, goingUp;

        // depth-first iterative tree traversal
        while (node || path.length) {

            if (!node) { // go up
                node = path.pop();
                parent = path[path.length - 1];
                i = indexes.pop();
                goingUp = true;
            }

            if (node.leaf) { // check current node
                index = node.children.indexOf(item);

                if (index !== -1) {
                    // item found, remove the item and condense tree upwards
                    node.children.splice(index, 1);
                    path.push(node);
                    this._condense(path);
                    return this;
                }
            }

            if (!goingUp && !node.leaf && contains(node.bbox, bbox)) { // go down
                path.push(node);
                indexes.push(i);
                i = 0;
                parent = node;
                node = node.children[0];

            } else if (parent) { // go right
                i++;
                node = parent.children[i];
                goingUp = false;

            } else node = null; // nothing found
        }

        return this;
    },

    toBBox: function (item) { return item; },

    compareMinX: function (a, b) { return a[0] - b[0]; },
    compareMinY: function (a, b) { return a[1] - b[1]; },

    toJSON: function () { return this.data; },

    fromJSON: function (data) {
        this.data = data;
        return this;
    },

    _all: function (node, result) {
        var nodesToSearch = [];
        while (node) {
            if (node.leaf) result.push.apply(result, node.children);
            else nodesToSearch.push.apply(nodesToSearch, node.children);

            node = nodesToSearch.pop();
        }
        return result;
    },

    _build: function (items, left, right, height) {

        var N = right - left + 1,
            M = this._maxEntries,
            node;

        if (N <= M) {
            // reached leaf level; return leaf
            node = {
                children: items.slice(left, right + 1),
                height: 1,
                bbox: null,
                leaf: true
            };
            calcBBox(node, this.toBBox);
            return node;
        }

        if (!height) {
            // target height of the bulk-loaded tree
            height = Math.ceil(Math.log(N) / Math.log(M));

            // target number of root entries to maximize storage utilization
            M = Math.ceil(N / Math.pow(M, height - 1));
        }

        // TODO eliminate recursion?

        node = {
            children: [],
            height: height,
            bbox: null
        };

        // split the items into M mostly square tiles

        var N2 = Math.ceil(N / M),
            N1 = N2 * Math.ceil(Math.sqrt(M)),
            i, j, right2, right3;

        multiSelect(items, left, right, N1, this.compareMinX);

        for (i = left; i <= right; i += N1) {

            right2 = Math.min(i + N1 - 1, right);

            multiSelect(items, i, right2, N2, this.compareMinY);

            for (j = i; j <= right2; j += N2) {

                right3 = Math.min(j + N2 - 1, right2);

                // pack each entry recursively
                node.children.push(this._build(items, j, right3, height - 1));
            }
        }

        calcBBox(node, this.toBBox);

        return node;
    },

    _chooseSubtree: function (bbox, node, level, path) {

        var i, len, child, targetNode, area, enlargement, minArea, minEnlargement;

        while (true) {
            path.push(node);

            if (node.leaf || path.length - 1 === level) break;

            minArea = minEnlargement = Infinity;

            for (i = 0, len = node.children.length; i < len; i++) {
                child = node.children[i];
                area = bboxArea(child.bbox);
                enlargement = enlargedArea(bbox, child.bbox) - area;

                // choose entry with the least area enlargement
                if (enlargement < minEnlargement) {
                    minEnlargement = enlargement;
                    minArea = area < minArea ? area : minArea;
                    targetNode = child;

                } else if (enlargement === minEnlargement) {
                    // otherwise choose one with the smallest area
                    if (area < minArea) {
                        minArea = area;
                        targetNode = child;
                    }
                }
            }

            node = targetNode;
        }

        return node;
    },

    _insert: function (item, level, isNode) {

        var toBBox = this.toBBox,
            bbox = isNode ? item.bbox : toBBox(item),
            insertPath = [];

        // find the best node for accommodating the item, saving all nodes along the path too
        var node = this._chooseSubtree(bbox, this.data, level, insertPath);

        // put the item into the node
        node.children.push(item);
        extend(node.bbox, bbox);

        // split on node overflow; propagate upwards if necessary
        while (level >= 0) {
            if (insertPath[level].children.length > this._maxEntries) {
                this._split(insertPath, level);
                level--;
            } else break;
        }

        // adjust bboxes along the insertion path
        this._adjustParentBBoxes(bbox, insertPath, level);
    },

    // split overflowed node into two
    _split: function (insertPath, level) {

        var node = insertPath[level],
            M = node.children.length,
            m = this._minEntries;

        this._chooseSplitAxis(node, m, M);

        var newNode = {
            children: node.children.splice(this._chooseSplitIndex(node, m, M)),
            height: node.height
        };

        if (node.leaf) newNode.leaf = true;

        calcBBox(node, this.toBBox);
        calcBBox(newNode, this.toBBox);

        if (level) insertPath[level - 1].children.push(newNode);
        else this._splitRoot(node, newNode);
    },

    _splitRoot: function (node, newNode) {
        // split root node
        this.data = {
            children: [node, newNode],
            height: node.height + 1
        };
        calcBBox(this.data, this.toBBox);
    },

    _chooseSplitIndex: function (node, m, M) {

        var i, bbox1, bbox2, overlap, area, minOverlap, minArea, index;

        minOverlap = minArea = Infinity;

        for (i = m; i <= M - m; i++) {
            bbox1 = distBBox(node, 0, i, this.toBBox);
            bbox2 = distBBox(node, i, M, this.toBBox);

            overlap = intersectionArea(bbox1, bbox2);
            area = bboxArea(bbox1) + bboxArea(bbox2);

            // choose distribution with minimum overlap
            if (overlap < minOverlap) {
                minOverlap = overlap;
                index = i;

                minArea = area < minArea ? area : minArea;

            } else if (overlap === minOverlap) {
                // otherwise choose distribution with minimum area
                if (area < minArea) {
                    minArea = area;
                    index = i;
                }
            }
        }

        return index;
    },

    // sorts node children by the best axis for split
    _chooseSplitAxis: function (node, m, M) {

        var compareMinX = node.leaf ? this.compareMinX : compareNodeMinX,
            compareMinY = node.leaf ? this.compareMinY : compareNodeMinY,
            xMargin = this._allDistMargin(node, m, M, compareMinX),
            yMargin = this._allDistMargin(node, m, M, compareMinY);

        // if total distributions margin value is minimal for x, sort by minX,
        // otherwise it's already sorted by minY
        if (xMargin < yMargin) node.children.sort(compareMinX);
    },

    // total margin of all possible split distributions where each node is at least m full
    _allDistMargin: function (node, m, M, compare) {

        node.children.sort(compare);

        var toBBox = this.toBBox,
            leftBBox = distBBox(node, 0, m, toBBox),
            rightBBox = distBBox(node, M - m, M, toBBox),
            margin = bboxMargin(leftBBox) + bboxMargin(rightBBox),
            i, child;

        for (i = m; i < M - m; i++) {
            child = node.children[i];
            extend(leftBBox, node.leaf ? toBBox(child) : child.bbox);
            margin += bboxMargin(leftBBox);
        }

        for (i = M - m - 1; i >= m; i--) {
            child = node.children[i];
            extend(rightBBox, node.leaf ? toBBox(child) : child.bbox);
            margin += bboxMargin(rightBBox);
        }

        return margin;
    },

    _adjustParentBBoxes: function (bbox, path, level) {
        // adjust bboxes along the given tree path
        for (var i = level; i >= 0; i--) {
            extend(path[i].bbox, bbox);
        }
    },

    _condense: function (path) {
        // go through the path, removing empty nodes and updating bboxes
        for (var i = path.length - 1, siblings; i >= 0; i--) {
            if (path[i].children.length === 0) {
                if (i > 0) {
                    siblings = path[i - 1].children;
                    siblings.splice(siblings.indexOf(path[i]), 1);

                } else this.clear();

            } else calcBBox(path[i], this.toBBox);
        }
    },

    _initFormat: function (format) {
        // data format (minX, minY, maxX, maxY accessors)

        // uses eval-type function compilation instead of just accepting a toBBox function
        // because the algorithms are very sensitive to sorting functions performance,
        // so they should be dead simple and without inner calls

        // jshint evil: true

        var compareArr = ['return a', ' - b', ';'];

        this.compareMinX = new Function('a', 'b', compareArr.join(format[0]));
        this.compareMinY = new Function('a', 'b', compareArr.join(format[1]));

        this.toBBox = new Function('a', 'return [a' + format.join(', a') + '];');
    }
};


// calculate node's bbox from bboxes of its children
function calcBBox(node, toBBox) {
    node.bbox = distBBox(node, 0, node.children.length, toBBox);
}

// min bounding rectangle of node children from k to p-1
function distBBox(node, k, p, toBBox) {
    var bbox = empty();

    for (var i = k, child; i < p; i++) {
        child = node.children[i];
        extend(bbox, node.leaf ? toBBox(child) : child.bbox);
    }

    return bbox;
}

function empty() { return [Infinity, Infinity, -Infinity, -Infinity]; }

function extend(a, b) {
    a[0] = Math.min(a[0], b[0]);
    a[1] = Math.min(a[1], b[1]);
    a[2] = Math.max(a[2], b[2]);
    a[3] = Math.max(a[3], b[3]);
    return a;
}

function compareNodeMinX(a, b) { return a.bbox[0] - b.bbox[0]; }
function compareNodeMinY(a, b) { return a.bbox[1] - b.bbox[1]; }

function bboxArea(a)   { return (a[2] - a[0]) * (a[3] - a[1]); }
function bboxMargin(a) { return (a[2] - a[0]) + (a[3] - a[1]); }

function enlargedArea(a, b) {
    return (Math.max(b[2], a[2]) - Math.min(b[0], a[0])) *
           (Math.max(b[3], a[3]) - Math.min(b[1], a[1]));
}

function intersectionArea(a, b) {
    var minX = Math.max(a[0], b[0]),
        minY = Math.max(a[1], b[1]),
        maxX = Math.min(a[2], b[2]),
        maxY = Math.min(a[3], b[3]);

    return Math.max(0, maxX - minX) *
           Math.max(0, maxY - minY);
}

function contains(a, b) {
    return a[0] <= b[0] &&
           a[1] <= b[1] &&
           b[2] <= a[2] &&
           b[3] <= a[3];
}

function intersects(a, b) {
    return b[0] <= a[2] &&
           b[1] <= a[3] &&
           b[2] >= a[0] &&
           b[3] >= a[1];
}

// sort an array so that items come in groups of n unsorted items, with groups sorted between each other;
// combines selection algorithm with binary divide & conquer approach

function multiSelect(arr, left, right, n, compare) {
    var stack = [left, right],
        mid;

    while (stack.length) {
        right = stack.pop();
        left = stack.pop();

        if (right - left <= n) continue;

        mid = left + Math.ceil((right - left) / n / 2) * n;
        select(arr, left, right, mid, compare);

        stack.push(left, mid, mid, right);
    }
}

// Floyd-Rivest selection algorithm:
// sort an array between left and right (inclusive) so that the smallest k elements come first (unordered)
function select(arr, left, right, k, compare) {
    var n, i, z, s, sd, newLeft, newRight, t, j;

    while (right > left) {
        if (right - left > 600) {
            n = right - left + 1;
            i = k - left + 1;
            z = Math.log(n);
            s = 0.5 * Math.exp(2 * z / 3);
            sd = 0.5 * Math.sqrt(z * s * (n - s) / n) * (i - n / 2 < 0 ? -1 : 1);
            newLeft = Math.max(left, Math.floor(k - i * s / n + sd));
            newRight = Math.min(right, Math.floor(k + (n - i) * s / n + sd));
            select(arr, newLeft, newRight, k, compare);
        }

        t = arr[k];
        i = left;
        j = right;

        swap(arr, left, k);
        if (compare(arr[right], t) > 0) swap(arr, left, right);

        while (i < j) {
            swap(arr, i, j);
            i++;
            j--;
            while (compare(arr[i], t) < 0) i++;
            while (compare(arr[j], t) > 0) j--;
        }

        if (compare(arr[left], t) === 0) swap(arr, left, j);
        else {
            j++;
            swap(arr, j, right);
        }

        if (j <= k) left = j + 1;
        if (k <= j) right = j - 1;
    }
}

function swap(arr, i, j) {
    var tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
}


// export as AMD/CommonJS module or global variable
if (typeof define === 'function' && define.amd) define('rbush', function() { return rbush; });
else if (typeof module !== 'undefined') module.exports = rbush;
else if (typeof self !== 'undefined') self.rbush = rbush;
else window.rbush = rbush;

})();

},{}]},{},[9])
//# sourceMappingURL=data:application/json;charset:utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL0FwcERhdGEvUm9hbWluZy9ucG0vbm9kZV9tb2R1bGVzL2Jyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2Jyb3dzZXItcGFjay9fcHJlbHVkZS5qcyIsIi4uLy4uL0FwcERhdGEvUm9hbWluZy9ucG0vbm9kZV9tb2R1bGVzL2Jyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2J1ZmZlci9pbmRleC5qcyIsIi4uLy4uL0FwcERhdGEvUm9hbWluZy9ucG0vbm9kZV9tb2R1bGVzL2Jyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2J1ZmZlci9ub2RlX21vZHVsZXMvYmFzZTY0LWpzL2xpYi9iNjQuanMiLCIuLi8uLi9BcHBEYXRhL1JvYW1pbmcvbnBtL25vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9idWZmZXIvbm9kZV9tb2R1bGVzL2llZWU3NTQvaW5kZXguanMiLCIuLi8uLi9BcHBEYXRhL1JvYW1pbmcvbnBtL25vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9idWZmZXIvbm9kZV9tb2R1bGVzL2lzLWFycmF5L2luZGV4LmpzIiwiLi4vLi4vQXBwRGF0YS9Sb2FtaW5nL25wbS9ub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvcHJvY2Vzcy9icm93c2VyLmpzIiwianMvYXBwL0NvbmZpZy5qcyIsImpzL2FwcC9HdWkuanMiLCJqcy9hcHAvSG90U3BvdC5qcyIsImpzL2FwcC9JbmRleC5qcyIsImpzL2FwcC9MaXZlU3RyZWFtLmpzIiwianMvYXBwL01vdmluZ0NhbS5qcyIsImpzL2FwcC9QYXJ0aWNpcGFudC5qcyIsImpzL2FwcC9Qb2ludC5qcyIsImpzL2FwcC9TdHlsZXMuanMiLCJqcy9hcHAvVHJhY2suanMiLCJqcy9hcHAvVXRpbHMuanMiLCJub2RlX21vZHVsZXMvYmludHJlZXMvaW5kZXguanMiLCJub2RlX21vZHVsZXMvYmludHJlZXMvbGliL2JpbnRyZWUuanMiLCJub2RlX21vZHVsZXMvYmludHJlZXMvbGliL3JidHJlZS5qcyIsIm5vZGVfbW9kdWxlcy9iaW50cmVlcy9saWIvdHJlZWJhc2UuanMiLCJub2RlX21vZHVsZXMvam9vc2Uvam9vc2UtYWxsLmpzIiwibm9kZV9tb2R1bGVzL2tsZC1pbnRlcnNlY3Rpb25zL2luZGV4LmpzIiwibm9kZV9tb2R1bGVzL2tsZC1pbnRlcnNlY3Rpb25zL2xpYi9JbnRlcnNlY3Rpb24uanMiLCJub2RlX21vZHVsZXMva2xkLWludGVyc2VjdGlvbnMvbGliL0ludGVyc2VjdGlvblBhcmFtcy5qcyIsIm5vZGVfbW9kdWxlcy9rbGQtaW50ZXJzZWN0aW9ucy9ub2RlX21vZHVsZXMva2xkLWFmZmluZS9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9rbGQtaW50ZXJzZWN0aW9ucy9ub2RlX21vZHVsZXMva2xkLWFmZmluZS9saWIvTWF0cml4MkQuanMiLCJub2RlX21vZHVsZXMva2xkLWludGVyc2VjdGlvbnMvbm9kZV9tb2R1bGVzL2tsZC1hZmZpbmUvbGliL1BvaW50MkQuanMiLCJub2RlX21vZHVsZXMva2xkLWludGVyc2VjdGlvbnMvbm9kZV9tb2R1bGVzL2tsZC1hZmZpbmUvbGliL1ZlY3RvcjJELmpzIiwibm9kZV9tb2R1bGVzL2tsZC1pbnRlcnNlY3Rpb25zL25vZGVfbW9kdWxlcy9rbGQtcG9seW5vbWlhbC9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9rbGQtaW50ZXJzZWN0aW9ucy9ub2RlX21vZHVsZXMva2xkLXBvbHlub21pYWwvbGliL1BvbHlub21pYWwuanMiLCJub2RlX21vZHVsZXMva2xkLWludGVyc2VjdGlvbnMvbm9kZV9tb2R1bGVzL2tsZC1wb2x5bm9taWFsL2xpYi9TcXJ0UG9seW5vbWlhbC5qcyIsIm5vZGVfbW9kdWxlcy9yYnVzaC9yYnVzaC5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTtBQ0FBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzc1Q0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM1SEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDcEZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2pDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMxRkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BIQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzFrQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbkRBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDekhBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDL0hBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1pBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDaHhCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN2Q0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNwa0JBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7OztBQzVaQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7O0FDOWpCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ0pBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzVHQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDMU5BO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7QUN2T0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7OztBQ2pwR0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNQQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2x1REE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2hDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDTEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN4YUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMvS0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDMU9BO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDSkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdG5CQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM1REE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EiLCJmaWxlIjoiZ2VuZXJhdGVkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXNDb250ZW50IjpbIihmdW5jdGlvbiBlKHQsbixyKXtmdW5jdGlvbiBzKG8sdSl7aWYoIW5bb10pe2lmKCF0W29dKXt2YXIgYT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2lmKCF1JiZhKXJldHVybiBhKG8sITApO2lmKGkpcmV0dXJuIGkobywhMCk7dmFyIGY9bmV3IEVycm9yKFwiQ2Fubm90IGZpbmQgbW9kdWxlICdcIitvK1wiJ1wiKTt0aHJvdyBmLmNvZGU9XCJNT0RVTEVfTk9UX0ZPVU5EXCIsZn12YXIgbD1uW29dPXtleHBvcnRzOnt9fTt0W29dWzBdLmNhbGwobC5leHBvcnRzLGZ1bmN0aW9uKGUpe3ZhciBuPXRbb11bMV1bZV07cmV0dXJuIHMobj9uOmUpfSxsLGwuZXhwb3J0cyxlLHQsbixyKX1yZXR1cm4gbltvXS5leHBvcnRzfXZhciBpPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7Zm9yKHZhciBvPTA7bzxyLmxlbmd0aDtvKyspcyhyW29dKTtyZXR1cm4gc30pIiwiLyohXG4gKiBUaGUgYnVmZmVyIG1vZHVsZSBmcm9tIG5vZGUuanMsIGZvciB0aGUgYnJvd3Nlci5cbiAqXG4gKiBAYXV0aG9yICAgRmVyb3NzIEFib3VraGFkaWplaCA8ZmVyb3NzQGZlcm9zcy5vcmc+IDxodHRwOi8vZmVyb3NzLm9yZz5cbiAqIEBsaWNlbnNlICBNSVRcbiAqL1xuXG52YXIgYmFzZTY0ID0gcmVxdWlyZSgnYmFzZTY0LWpzJylcbnZhciBpZWVlNzU0ID0gcmVxdWlyZSgnaWVlZTc1NCcpXG52YXIgaXNBcnJheSA9IHJlcXVpcmUoJ2lzLWFycmF5JylcblxuZXhwb3J0cy5CdWZmZXIgPSBCdWZmZXJcbmV4cG9ydHMuU2xvd0J1ZmZlciA9IFNsb3dCdWZmZXJcbmV4cG9ydHMuSU5TUEVDVF9NQVhfQllURVMgPSA1MFxuQnVmZmVyLnBvb2xTaXplID0gODE5MiAvLyBub3QgdXNlZCBieSB0aGlzIGltcGxlbWVudGF0aW9uXG5cbnZhciByb290UGFyZW50ID0ge31cblxuLyoqXG4gKiBJZiBgQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlRgOlxuICogICA9PT0gdHJ1ZSAgICBVc2UgVWludDhBcnJheSBpbXBsZW1lbnRhdGlvbiAoZmFzdGVzdClcbiAqICAgPT09IGZhbHNlICAgVXNlIE9iamVjdCBpbXBsZW1lbnRhdGlvbiAobW9zdCBjb21wYXRpYmxlLCBldmVuIElFNilcbiAqXG4gKiBCcm93c2VycyB0aGF0IHN1cHBvcnQgdHlwZWQgYXJyYXlzIGFyZSBJRSAxMCssIEZpcmVmb3ggNCssIENocm9tZSA3KywgU2FmYXJpIDUuMSssXG4gKiBPcGVyYSAxMS42KywgaU9TIDQuMisuXG4gKlxuICogTm90ZTpcbiAqXG4gKiAtIEltcGxlbWVudGF0aW9uIG11c3Qgc3VwcG9ydCBhZGRpbmcgbmV3IHByb3BlcnRpZXMgdG8gYFVpbnQ4QXJyYXlgIGluc3RhbmNlcy5cbiAqICAgRmlyZWZveCA0LTI5IGxhY2tlZCBzdXBwb3J0LCBmaXhlZCBpbiBGaXJlZm94IDMwKy5cbiAqICAgU2VlOiBodHRwczovL2J1Z3ppbGxhLm1vemlsbGEub3JnL3Nob3dfYnVnLmNnaT9pZD02OTU0MzguXG4gKlxuICogIC0gQ2hyb21lIDktMTAgaXMgbWlzc2luZyB0aGUgYFR5cGVkQXJyYXkucHJvdG90eXBlLnN1YmFycmF5YCBmdW5jdGlvbi5cbiAqXG4gKiAgLSBJRTEwIGhhcyBhIGJyb2tlbiBgVHlwZWRBcnJheS5wcm90b3R5cGUuc3ViYXJyYXlgIGZ1bmN0aW9uIHdoaWNoIHJldHVybnMgYXJyYXlzIG9mXG4gKiAgICBpbmNvcnJlY3QgbGVuZ3RoIGluIHNvbWUgc2l0dWF0aW9ucy5cbiAqXG4gKiBXZSBkZXRlY3QgdGhlc2UgYnVnZ3kgYnJvd3NlcnMgYW5kIHNldCBgQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlRgIHRvIGBmYWxzZWAgc28gdGhleSB3aWxsXG4gKiBnZXQgdGhlIE9iamVjdCBpbXBsZW1lbnRhdGlvbiwgd2hpY2ggaXMgc2xvd2VyIGJ1dCB3aWxsIHdvcmsgY29ycmVjdGx5LlxuICovXG5CdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCA9IChmdW5jdGlvbiAoKSB7XG4gIGZ1bmN0aW9uIEZvbyAoKSB7fVxuICB0cnkge1xuICAgIHZhciBidWYgPSBuZXcgQXJyYXlCdWZmZXIoMClcbiAgICB2YXIgYXJyID0gbmV3IFVpbnQ4QXJyYXkoYnVmKVxuICAgIGFyci5mb28gPSBmdW5jdGlvbiAoKSB7IHJldHVybiA0MiB9XG4gICAgYXJyLmNvbnN0cnVjdG9yID0gRm9vXG4gICAgcmV0dXJuIGFyci5mb28oKSA9PT0gNDIgJiYgLy8gdHlwZWQgYXJyYXkgaW5zdGFuY2VzIGNhbiBiZSBhdWdtZW50ZWRcbiAgICAgICAgYXJyLmNvbnN0cnVjdG9yID09PSBGb28gJiYgLy8gY29uc3RydWN0b3IgY2FuIGJlIHNldFxuICAgICAgICB0eXBlb2YgYXJyLnN1YmFycmF5ID09PSAnZnVuY3Rpb24nICYmIC8vIGNocm9tZSA5LTEwIGxhY2sgYHN1YmFycmF5YFxuICAgICAgICBuZXcgVWludDhBcnJheSgxKS5zdWJhcnJheSgxLCAxKS5ieXRlTGVuZ3RoID09PSAwIC8vIGllMTAgaGFzIGJyb2tlbiBgc3ViYXJyYXlgXG4gIH0gY2F0Y2ggKGUpIHtcbiAgICByZXR1cm4gZmFsc2VcbiAgfVxufSkoKVxuXG5mdW5jdGlvbiBrTWF4TGVuZ3RoICgpIHtcbiAgcmV0dXJuIEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUXG4gICAgPyAweDdmZmZmZmZmXG4gICAgOiAweDNmZmZmZmZmXG59XG5cbi8qKlxuICogQ2xhc3M6IEJ1ZmZlclxuICogPT09PT09PT09PT09PVxuICpcbiAqIFRoZSBCdWZmZXIgY29uc3RydWN0b3IgcmV0dXJucyBpbnN0YW5jZXMgb2YgYFVpbnQ4QXJyYXlgIHRoYXQgYXJlIGF1Z21lbnRlZFxuICogd2l0aCBmdW5jdGlvbiBwcm9wZXJ0aWVzIGZvciBhbGwgdGhlIG5vZGUgYEJ1ZmZlcmAgQVBJIGZ1bmN0aW9ucy4gV2UgdXNlXG4gKiBgVWludDhBcnJheWAgc28gdGhhdCBzcXVhcmUgYnJhY2tldCBub3RhdGlvbiB3b3JrcyBhcyBleHBlY3RlZCAtLSBpdCByZXR1cm5zXG4gKiBhIHNpbmdsZSBvY3RldC5cbiAqXG4gKiBCeSBhdWdtZW50aW5nIHRoZSBpbnN0YW5jZXMsIHdlIGNhbiBhdm9pZCBtb2RpZnlpbmcgdGhlIGBVaW50OEFycmF5YFxuICogcHJvdG90eXBlLlxuICovXG5mdW5jdGlvbiBCdWZmZXIgKGFyZykge1xuICBpZiAoISh0aGlzIGluc3RhbmNlb2YgQnVmZmVyKSkge1xuICAgIC8vIEF2b2lkIGdvaW5nIHRocm91Z2ggYW4gQXJndW1lbnRzQWRhcHRvclRyYW1wb2xpbmUgaW4gdGhlIGNvbW1vbiBjYXNlLlxuICAgIGlmIChhcmd1bWVudHMubGVuZ3RoID4gMSkgcmV0dXJuIG5ldyBCdWZmZXIoYXJnLCBhcmd1bWVudHNbMV0pXG4gICAgcmV0dXJuIG5ldyBCdWZmZXIoYXJnKVxuICB9XG5cbiAgdGhpcy5sZW5ndGggPSAwXG4gIHRoaXMucGFyZW50ID0gdW5kZWZpbmVkXG5cbiAgLy8gQ29tbW9uIGNhc2UuXG4gIGlmICh0eXBlb2YgYXJnID09PSAnbnVtYmVyJykge1xuICAgIHJldHVybiBmcm9tTnVtYmVyKHRoaXMsIGFyZylcbiAgfVxuXG4gIC8vIFNsaWdodGx5IGxlc3MgY29tbW9uIGNhc2UuXG4gIGlmICh0eXBlb2YgYXJnID09PSAnc3RyaW5nJykge1xuICAgIHJldHVybiBmcm9tU3RyaW5nKHRoaXMsIGFyZywgYXJndW1lbnRzLmxlbmd0aCA+IDEgPyBhcmd1bWVudHNbMV0gOiAndXRmOCcpXG4gIH1cblxuICAvLyBVbnVzdWFsLlxuICByZXR1cm4gZnJvbU9iamVjdCh0aGlzLCBhcmcpXG59XG5cbmZ1bmN0aW9uIGZyb21OdW1iZXIgKHRoYXQsIGxlbmd0aCkge1xuICB0aGF0ID0gYWxsb2NhdGUodGhhdCwgbGVuZ3RoIDwgMCA/IDAgOiBjaGVja2VkKGxlbmd0aCkgfCAwKVxuICBpZiAoIUJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW5ndGg7IGkrKykge1xuICAgICAgdGhhdFtpXSA9IDBcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHRoYXRcbn1cblxuZnVuY3Rpb24gZnJvbVN0cmluZyAodGhhdCwgc3RyaW5nLCBlbmNvZGluZykge1xuICBpZiAodHlwZW9mIGVuY29kaW5nICE9PSAnc3RyaW5nJyB8fCBlbmNvZGluZyA9PT0gJycpIGVuY29kaW5nID0gJ3V0ZjgnXG5cbiAgLy8gQXNzdW1wdGlvbjogYnl0ZUxlbmd0aCgpIHJldHVybiB2YWx1ZSBpcyBhbHdheXMgPCBrTWF4TGVuZ3RoLlxuICB2YXIgbGVuZ3RoID0gYnl0ZUxlbmd0aChzdHJpbmcsIGVuY29kaW5nKSB8IDBcbiAgdGhhdCA9IGFsbG9jYXRlKHRoYXQsIGxlbmd0aClcblxuICB0aGF0LndyaXRlKHN0cmluZywgZW5jb2RpbmcpXG4gIHJldHVybiB0aGF0XG59XG5cbmZ1bmN0aW9uIGZyb21PYmplY3QgKHRoYXQsIG9iamVjdCkge1xuICBpZiAoQnVmZmVyLmlzQnVmZmVyKG9iamVjdCkpIHJldHVybiBmcm9tQnVmZmVyKHRoYXQsIG9iamVjdClcblxuICBpZiAoaXNBcnJheShvYmplY3QpKSByZXR1cm4gZnJvbUFycmF5KHRoYXQsIG9iamVjdClcblxuICBpZiAob2JqZWN0ID09IG51bGwpIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdtdXN0IHN0YXJ0IHdpdGggbnVtYmVyLCBidWZmZXIsIGFycmF5IG9yIHN0cmluZycpXG4gIH1cblxuICBpZiAodHlwZW9mIEFycmF5QnVmZmVyICE9PSAndW5kZWZpbmVkJyAmJiBvYmplY3QuYnVmZmVyIGluc3RhbmNlb2YgQXJyYXlCdWZmZXIpIHtcbiAgICByZXR1cm4gZnJvbVR5cGVkQXJyYXkodGhhdCwgb2JqZWN0KVxuICB9XG5cbiAgaWYgKG9iamVjdC5sZW5ndGgpIHJldHVybiBmcm9tQXJyYXlMaWtlKHRoYXQsIG9iamVjdClcblxuICByZXR1cm4gZnJvbUpzb25PYmplY3QodGhhdCwgb2JqZWN0KVxufVxuXG5mdW5jdGlvbiBmcm9tQnVmZmVyICh0aGF0LCBidWZmZXIpIHtcbiAgdmFyIGxlbmd0aCA9IGNoZWNrZWQoYnVmZmVyLmxlbmd0aCkgfCAwXG4gIHRoYXQgPSBhbGxvY2F0ZSh0aGF0LCBsZW5ndGgpXG4gIGJ1ZmZlci5jb3B5KHRoYXQsIDAsIDAsIGxlbmd0aClcbiAgcmV0dXJuIHRoYXRcbn1cblxuZnVuY3Rpb24gZnJvbUFycmF5ICh0aGF0LCBhcnJheSkge1xuICB2YXIgbGVuZ3RoID0gY2hlY2tlZChhcnJheS5sZW5ndGgpIHwgMFxuICB0aGF0ID0gYWxsb2NhdGUodGhhdCwgbGVuZ3RoKVxuICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbmd0aDsgaSArPSAxKSB7XG4gICAgdGhhdFtpXSA9IGFycmF5W2ldICYgMjU1XG4gIH1cbiAgcmV0dXJuIHRoYXRcbn1cblxuLy8gRHVwbGljYXRlIG9mIGZyb21BcnJheSgpIHRvIGtlZXAgZnJvbUFycmF5KCkgbW9ub21vcnBoaWMuXG5mdW5jdGlvbiBmcm9tVHlwZWRBcnJheSAodGhhdCwgYXJyYXkpIHtcbiAgdmFyIGxlbmd0aCA9IGNoZWNrZWQoYXJyYXkubGVuZ3RoKSB8IDBcbiAgdGhhdCA9IGFsbG9jYXRlKHRoYXQsIGxlbmd0aClcbiAgLy8gVHJ1bmNhdGluZyB0aGUgZWxlbWVudHMgaXMgcHJvYmFibHkgbm90IHdoYXQgcGVvcGxlIGV4cGVjdCBmcm9tIHR5cGVkXG4gIC8vIGFycmF5cyB3aXRoIEJZVEVTX1BFUl9FTEVNRU5UID4gMSBidXQgaXQncyBjb21wYXRpYmxlIHdpdGggdGhlIGJlaGF2aW9yXG4gIC8vIG9mIHRoZSBvbGQgQnVmZmVyIGNvbnN0cnVjdG9yLlxuICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbmd0aDsgaSArPSAxKSB7XG4gICAgdGhhdFtpXSA9IGFycmF5W2ldICYgMjU1XG4gIH1cbiAgcmV0dXJuIHRoYXRcbn1cblxuZnVuY3Rpb24gZnJvbUFycmF5TGlrZSAodGhhdCwgYXJyYXkpIHtcbiAgdmFyIGxlbmd0aCA9IGNoZWNrZWQoYXJyYXkubGVuZ3RoKSB8IDBcbiAgdGhhdCA9IGFsbG9jYXRlKHRoYXQsIGxlbmd0aClcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW5ndGg7IGkgKz0gMSkge1xuICAgIHRoYXRbaV0gPSBhcnJheVtpXSAmIDI1NVxuICB9XG4gIHJldHVybiB0aGF0XG59XG5cbi8vIERlc2VyaWFsaXplIHsgdHlwZTogJ0J1ZmZlcicsIGRhdGE6IFsxLDIsMywuLi5dIH0gaW50byBhIEJ1ZmZlciBvYmplY3QuXG4vLyBSZXR1cm5zIGEgemVyby1sZW5ndGggYnVmZmVyIGZvciBpbnB1dHMgdGhhdCBkb24ndCBjb25mb3JtIHRvIHRoZSBzcGVjLlxuZnVuY3Rpb24gZnJvbUpzb25PYmplY3QgKHRoYXQsIG9iamVjdCkge1xuICB2YXIgYXJyYXlcbiAgdmFyIGxlbmd0aCA9IDBcblxuICBpZiAob2JqZWN0LnR5cGUgPT09ICdCdWZmZXInICYmIGlzQXJyYXkob2JqZWN0LmRhdGEpKSB7XG4gICAgYXJyYXkgPSBvYmplY3QuZGF0YVxuICAgIGxlbmd0aCA9IGNoZWNrZWQoYXJyYXkubGVuZ3RoKSB8IDBcbiAgfVxuICB0aGF0ID0gYWxsb2NhdGUodGhhdCwgbGVuZ3RoKVxuXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuZ3RoOyBpICs9IDEpIHtcbiAgICB0aGF0W2ldID0gYXJyYXlbaV0gJiAyNTVcbiAgfVxuICByZXR1cm4gdGhhdFxufVxuXG5mdW5jdGlvbiBhbGxvY2F0ZSAodGhhdCwgbGVuZ3RoKSB7XG4gIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIC8vIFJldHVybiBhbiBhdWdtZW50ZWQgYFVpbnQ4QXJyYXlgIGluc3RhbmNlLCBmb3IgYmVzdCBwZXJmb3JtYW5jZVxuICAgIHRoYXQgPSBCdWZmZXIuX2F1Z21lbnQobmV3IFVpbnQ4QXJyYXkobGVuZ3RoKSlcbiAgfSBlbHNlIHtcbiAgICAvLyBGYWxsYmFjazogUmV0dXJuIGFuIG9iamVjdCBpbnN0YW5jZSBvZiB0aGUgQnVmZmVyIGNsYXNzXG4gICAgdGhhdC5sZW5ndGggPSBsZW5ndGhcbiAgICB0aGF0Ll9pc0J1ZmZlciA9IHRydWVcbiAgfVxuXG4gIHZhciBmcm9tUG9vbCA9IGxlbmd0aCAhPT0gMCAmJiBsZW5ndGggPD0gQnVmZmVyLnBvb2xTaXplID4+PiAxXG4gIGlmIChmcm9tUG9vbCkgdGhhdC5wYXJlbnQgPSByb290UGFyZW50XG5cbiAgcmV0dXJuIHRoYXRcbn1cblxuZnVuY3Rpb24gY2hlY2tlZCAobGVuZ3RoKSB7XG4gIC8vIE5vdGU6IGNhbm5vdCB1c2UgYGxlbmd0aCA8IGtNYXhMZW5ndGhgIGhlcmUgYmVjYXVzZSB0aGF0IGZhaWxzIHdoZW5cbiAgLy8gbGVuZ3RoIGlzIE5hTiAod2hpY2ggaXMgb3RoZXJ3aXNlIGNvZXJjZWQgdG8gemVyby4pXG4gIGlmIChsZW5ndGggPj0ga01heExlbmd0aCgpKSB7XG4gICAgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ0F0dGVtcHQgdG8gYWxsb2NhdGUgQnVmZmVyIGxhcmdlciB0aGFuIG1heGltdW0gJyArXG4gICAgICAgICAgICAgICAgICAgICAgICAgJ3NpemU6IDB4JyArIGtNYXhMZW5ndGgoKS50b1N0cmluZygxNikgKyAnIGJ5dGVzJylcbiAgfVxuICByZXR1cm4gbGVuZ3RoIHwgMFxufVxuXG5mdW5jdGlvbiBTbG93QnVmZmVyIChzdWJqZWN0LCBlbmNvZGluZykge1xuICBpZiAoISh0aGlzIGluc3RhbmNlb2YgU2xvd0J1ZmZlcikpIHJldHVybiBuZXcgU2xvd0J1ZmZlcihzdWJqZWN0LCBlbmNvZGluZylcblxuICB2YXIgYnVmID0gbmV3IEJ1ZmZlcihzdWJqZWN0LCBlbmNvZGluZylcbiAgZGVsZXRlIGJ1Zi5wYXJlbnRcbiAgcmV0dXJuIGJ1ZlxufVxuXG5CdWZmZXIuaXNCdWZmZXIgPSBmdW5jdGlvbiBpc0J1ZmZlciAoYikge1xuICByZXR1cm4gISEoYiAhPSBudWxsICYmIGIuX2lzQnVmZmVyKVxufVxuXG5CdWZmZXIuY29tcGFyZSA9IGZ1bmN0aW9uIGNvbXBhcmUgKGEsIGIpIHtcbiAgaWYgKCFCdWZmZXIuaXNCdWZmZXIoYSkgfHwgIUJ1ZmZlci5pc0J1ZmZlcihiKSkge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ0FyZ3VtZW50cyBtdXN0IGJlIEJ1ZmZlcnMnKVxuICB9XG5cbiAgaWYgKGEgPT09IGIpIHJldHVybiAwXG5cbiAgdmFyIHggPSBhLmxlbmd0aFxuICB2YXIgeSA9IGIubGVuZ3RoXG5cbiAgdmFyIGkgPSAwXG4gIHZhciBsZW4gPSBNYXRoLm1pbih4LCB5KVxuICB3aGlsZSAoaSA8IGxlbikge1xuICAgIGlmIChhW2ldICE9PSBiW2ldKSBicmVha1xuXG4gICAgKytpXG4gIH1cblxuICBpZiAoaSAhPT0gbGVuKSB7XG4gICAgeCA9IGFbaV1cbiAgICB5ID0gYltpXVxuICB9XG5cbiAgaWYgKHggPCB5KSByZXR1cm4gLTFcbiAgaWYgKHkgPCB4KSByZXR1cm4gMVxuICByZXR1cm4gMFxufVxuXG5CdWZmZXIuaXNFbmNvZGluZyA9IGZ1bmN0aW9uIGlzRW5jb2RpbmcgKGVuY29kaW5nKSB7XG4gIHN3aXRjaCAoU3RyaW5nKGVuY29kaW5nKS50b0xvd2VyQ2FzZSgpKSB7XG4gICAgY2FzZSAnaGV4JzpcbiAgICBjYXNlICd1dGY4JzpcbiAgICBjYXNlICd1dGYtOCc6XG4gICAgY2FzZSAnYXNjaWknOlxuICAgIGNhc2UgJ2JpbmFyeSc6XG4gICAgY2FzZSAnYmFzZTY0JzpcbiAgICBjYXNlICdyYXcnOlxuICAgIGNhc2UgJ3VjczInOlxuICAgIGNhc2UgJ3Vjcy0yJzpcbiAgICBjYXNlICd1dGYxNmxlJzpcbiAgICBjYXNlICd1dGYtMTZsZSc6XG4gICAgICByZXR1cm4gdHJ1ZVxuICAgIGRlZmF1bHQ6XG4gICAgICByZXR1cm4gZmFsc2VcbiAgfVxufVxuXG5CdWZmZXIuY29uY2F0ID0gZnVuY3Rpb24gY29uY2F0IChsaXN0LCBsZW5ndGgpIHtcbiAgaWYgKCFpc0FycmF5KGxpc3QpKSB0aHJvdyBuZXcgVHlwZUVycm9yKCdsaXN0IGFyZ3VtZW50IG11c3QgYmUgYW4gQXJyYXkgb2YgQnVmZmVycy4nKVxuXG4gIGlmIChsaXN0Lmxlbmd0aCA9PT0gMCkge1xuICAgIHJldHVybiBuZXcgQnVmZmVyKDApXG4gIH0gZWxzZSBpZiAobGlzdC5sZW5ndGggPT09IDEpIHtcbiAgICByZXR1cm4gbGlzdFswXVxuICB9XG5cbiAgdmFyIGlcbiAgaWYgKGxlbmd0aCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgbGVuZ3RoID0gMFxuICAgIGZvciAoaSA9IDA7IGkgPCBsaXN0Lmxlbmd0aDsgaSsrKSB7XG4gICAgICBsZW5ndGggKz0gbGlzdFtpXS5sZW5ndGhcbiAgICB9XG4gIH1cblxuICB2YXIgYnVmID0gbmV3IEJ1ZmZlcihsZW5ndGgpXG4gIHZhciBwb3MgPSAwXG4gIGZvciAoaSA9IDA7IGkgPCBsaXN0Lmxlbmd0aDsgaSsrKSB7XG4gICAgdmFyIGl0ZW0gPSBsaXN0W2ldXG4gICAgaXRlbS5jb3B5KGJ1ZiwgcG9zKVxuICAgIHBvcyArPSBpdGVtLmxlbmd0aFxuICB9XG4gIHJldHVybiBidWZcbn1cblxuZnVuY3Rpb24gYnl0ZUxlbmd0aCAoc3RyaW5nLCBlbmNvZGluZykge1xuICBpZiAodHlwZW9mIHN0cmluZyAhPT0gJ3N0cmluZycpIHN0cmluZyA9ICcnICsgc3RyaW5nXG5cbiAgdmFyIGxlbiA9IHN0cmluZy5sZW5ndGhcbiAgaWYgKGxlbiA9PT0gMCkgcmV0dXJuIDBcblxuICAvLyBVc2UgYSBmb3IgbG9vcCB0byBhdm9pZCByZWN1cnNpb25cbiAgdmFyIGxvd2VyZWRDYXNlID0gZmFsc2VcbiAgZm9yICg7Oykge1xuICAgIHN3aXRjaCAoZW5jb2RpbmcpIHtcbiAgICAgIGNhc2UgJ2FzY2lpJzpcbiAgICAgIGNhc2UgJ2JpbmFyeSc6XG4gICAgICAvLyBEZXByZWNhdGVkXG4gICAgICBjYXNlICdyYXcnOlxuICAgICAgY2FzZSAncmF3cyc6XG4gICAgICAgIHJldHVybiBsZW5cbiAgICAgIGNhc2UgJ3V0ZjgnOlxuICAgICAgY2FzZSAndXRmLTgnOlxuICAgICAgICByZXR1cm4gdXRmOFRvQnl0ZXMoc3RyaW5nKS5sZW5ndGhcbiAgICAgIGNhc2UgJ3VjczInOlxuICAgICAgY2FzZSAndWNzLTInOlxuICAgICAgY2FzZSAndXRmMTZsZSc6XG4gICAgICBjYXNlICd1dGYtMTZsZSc6XG4gICAgICAgIHJldHVybiBsZW4gKiAyXG4gICAgICBjYXNlICdoZXgnOlxuICAgICAgICByZXR1cm4gbGVuID4+PiAxXG4gICAgICBjYXNlICdiYXNlNjQnOlxuICAgICAgICByZXR1cm4gYmFzZTY0VG9CeXRlcyhzdHJpbmcpLmxlbmd0aFxuICAgICAgZGVmYXVsdDpcbiAgICAgICAgaWYgKGxvd2VyZWRDYXNlKSByZXR1cm4gdXRmOFRvQnl0ZXMoc3RyaW5nKS5sZW5ndGggLy8gYXNzdW1lIHV0ZjhcbiAgICAgICAgZW5jb2RpbmcgPSAoJycgKyBlbmNvZGluZykudG9Mb3dlckNhc2UoKVxuICAgICAgICBsb3dlcmVkQ2FzZSA9IHRydWVcbiAgICB9XG4gIH1cbn1cbkJ1ZmZlci5ieXRlTGVuZ3RoID0gYnl0ZUxlbmd0aFxuXG4vLyBwcmUtc2V0IGZvciB2YWx1ZXMgdGhhdCBtYXkgZXhpc3QgaW4gdGhlIGZ1dHVyZVxuQnVmZmVyLnByb3RvdHlwZS5sZW5ndGggPSB1bmRlZmluZWRcbkJ1ZmZlci5wcm90b3R5cGUucGFyZW50ID0gdW5kZWZpbmVkXG5cbmZ1bmN0aW9uIHNsb3dUb1N0cmluZyAoZW5jb2RpbmcsIHN0YXJ0LCBlbmQpIHtcbiAgdmFyIGxvd2VyZWRDYXNlID0gZmFsc2VcblxuICBzdGFydCA9IHN0YXJ0IHwgMFxuICBlbmQgPSBlbmQgPT09IHVuZGVmaW5lZCB8fCBlbmQgPT09IEluZmluaXR5ID8gdGhpcy5sZW5ndGggOiBlbmQgfCAwXG5cbiAgaWYgKCFlbmNvZGluZykgZW5jb2RpbmcgPSAndXRmOCdcbiAgaWYgKHN0YXJ0IDwgMCkgc3RhcnQgPSAwXG4gIGlmIChlbmQgPiB0aGlzLmxlbmd0aCkgZW5kID0gdGhpcy5sZW5ndGhcbiAgaWYgKGVuZCA8PSBzdGFydCkgcmV0dXJuICcnXG5cbiAgd2hpbGUgKHRydWUpIHtcbiAgICBzd2l0Y2ggKGVuY29kaW5nKSB7XG4gICAgICBjYXNlICdoZXgnOlxuICAgICAgICByZXR1cm4gaGV4U2xpY2UodGhpcywgc3RhcnQsIGVuZClcblxuICAgICAgY2FzZSAndXRmOCc6XG4gICAgICBjYXNlICd1dGYtOCc6XG4gICAgICAgIHJldHVybiB1dGY4U2xpY2UodGhpcywgc3RhcnQsIGVuZClcblxuICAgICAgY2FzZSAnYXNjaWknOlxuICAgICAgICByZXR1cm4gYXNjaWlTbGljZSh0aGlzLCBzdGFydCwgZW5kKVxuXG4gICAgICBjYXNlICdiaW5hcnknOlxuICAgICAgICByZXR1cm4gYmluYXJ5U2xpY2UodGhpcywgc3RhcnQsIGVuZClcblxuICAgICAgY2FzZSAnYmFzZTY0JzpcbiAgICAgICAgcmV0dXJuIGJhc2U2NFNsaWNlKHRoaXMsIHN0YXJ0LCBlbmQpXG5cbiAgICAgIGNhc2UgJ3VjczInOlxuICAgICAgY2FzZSAndWNzLTInOlxuICAgICAgY2FzZSAndXRmMTZsZSc6XG4gICAgICBjYXNlICd1dGYtMTZsZSc6XG4gICAgICAgIHJldHVybiB1dGYxNmxlU2xpY2UodGhpcywgc3RhcnQsIGVuZClcblxuICAgICAgZGVmYXVsdDpcbiAgICAgICAgaWYgKGxvd2VyZWRDYXNlKSB0aHJvdyBuZXcgVHlwZUVycm9yKCdVbmtub3duIGVuY29kaW5nOiAnICsgZW5jb2RpbmcpXG4gICAgICAgIGVuY29kaW5nID0gKGVuY29kaW5nICsgJycpLnRvTG93ZXJDYXNlKClcbiAgICAgICAgbG93ZXJlZENhc2UgPSB0cnVlXG4gICAgfVxuICB9XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUudG9TdHJpbmcgPSBmdW5jdGlvbiB0b1N0cmluZyAoKSB7XG4gIHZhciBsZW5ndGggPSB0aGlzLmxlbmd0aCB8IDBcbiAgaWYgKGxlbmd0aCA9PT0gMCkgcmV0dXJuICcnXG4gIGlmIChhcmd1bWVudHMubGVuZ3RoID09PSAwKSByZXR1cm4gdXRmOFNsaWNlKHRoaXMsIDAsIGxlbmd0aClcbiAgcmV0dXJuIHNsb3dUb1N0cmluZy5hcHBseSh0aGlzLCBhcmd1bWVudHMpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUuZXF1YWxzID0gZnVuY3Rpb24gZXF1YWxzIChiKSB7XG4gIGlmICghQnVmZmVyLmlzQnVmZmVyKGIpKSB0aHJvdyBuZXcgVHlwZUVycm9yKCdBcmd1bWVudCBtdXN0IGJlIGEgQnVmZmVyJylcbiAgaWYgKHRoaXMgPT09IGIpIHJldHVybiB0cnVlXG4gIHJldHVybiBCdWZmZXIuY29tcGFyZSh0aGlzLCBiKSA9PT0gMFxufVxuXG5CdWZmZXIucHJvdG90eXBlLmluc3BlY3QgPSBmdW5jdGlvbiBpbnNwZWN0ICgpIHtcbiAgdmFyIHN0ciA9ICcnXG4gIHZhciBtYXggPSBleHBvcnRzLklOU1BFQ1RfTUFYX0JZVEVTXG4gIGlmICh0aGlzLmxlbmd0aCA+IDApIHtcbiAgICBzdHIgPSB0aGlzLnRvU3RyaW5nKCdoZXgnLCAwLCBtYXgpLm1hdGNoKC8uezJ9L2cpLmpvaW4oJyAnKVxuICAgIGlmICh0aGlzLmxlbmd0aCA+IG1heCkgc3RyICs9ICcgLi4uICdcbiAgfVxuICByZXR1cm4gJzxCdWZmZXIgJyArIHN0ciArICc+J1xufVxuXG5CdWZmZXIucHJvdG90eXBlLmNvbXBhcmUgPSBmdW5jdGlvbiBjb21wYXJlIChiKSB7XG4gIGlmICghQnVmZmVyLmlzQnVmZmVyKGIpKSB0aHJvdyBuZXcgVHlwZUVycm9yKCdBcmd1bWVudCBtdXN0IGJlIGEgQnVmZmVyJylcbiAgaWYgKHRoaXMgPT09IGIpIHJldHVybiAwXG4gIHJldHVybiBCdWZmZXIuY29tcGFyZSh0aGlzLCBiKVxufVxuXG5CdWZmZXIucHJvdG90eXBlLmluZGV4T2YgPSBmdW5jdGlvbiBpbmRleE9mICh2YWwsIGJ5dGVPZmZzZXQpIHtcbiAgaWYgKGJ5dGVPZmZzZXQgPiAweDdmZmZmZmZmKSBieXRlT2Zmc2V0ID0gMHg3ZmZmZmZmZlxuICBlbHNlIGlmIChieXRlT2Zmc2V0IDwgLTB4ODAwMDAwMDApIGJ5dGVPZmZzZXQgPSAtMHg4MDAwMDAwMFxuICBieXRlT2Zmc2V0ID4+PSAwXG5cbiAgaWYgKHRoaXMubGVuZ3RoID09PSAwKSByZXR1cm4gLTFcbiAgaWYgKGJ5dGVPZmZzZXQgPj0gdGhpcy5sZW5ndGgpIHJldHVybiAtMVxuXG4gIC8vIE5lZ2F0aXZlIG9mZnNldHMgc3RhcnQgZnJvbSB0aGUgZW5kIG9mIHRoZSBidWZmZXJcbiAgaWYgKGJ5dGVPZmZzZXQgPCAwKSBieXRlT2Zmc2V0ID0gTWF0aC5tYXgodGhpcy5sZW5ndGggKyBieXRlT2Zmc2V0LCAwKVxuXG4gIGlmICh0eXBlb2YgdmFsID09PSAnc3RyaW5nJykge1xuICAgIGlmICh2YWwubGVuZ3RoID09PSAwKSByZXR1cm4gLTEgLy8gc3BlY2lhbCBjYXNlOiBsb29raW5nIGZvciBlbXB0eSBzdHJpbmcgYWx3YXlzIGZhaWxzXG4gICAgcmV0dXJuIFN0cmluZy5wcm90b3R5cGUuaW5kZXhPZi5jYWxsKHRoaXMsIHZhbCwgYnl0ZU9mZnNldClcbiAgfVxuICBpZiAoQnVmZmVyLmlzQnVmZmVyKHZhbCkpIHtcbiAgICByZXR1cm4gYXJyYXlJbmRleE9mKHRoaXMsIHZhbCwgYnl0ZU9mZnNldClcbiAgfVxuICBpZiAodHlwZW9mIHZhbCA9PT0gJ251bWJlcicpIHtcbiAgICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQgJiYgVWludDhBcnJheS5wcm90b3R5cGUuaW5kZXhPZiA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgcmV0dXJuIFVpbnQ4QXJyYXkucHJvdG90eXBlLmluZGV4T2YuY2FsbCh0aGlzLCB2YWwsIGJ5dGVPZmZzZXQpXG4gICAgfVxuICAgIHJldHVybiBhcnJheUluZGV4T2YodGhpcywgWyB2YWwgXSwgYnl0ZU9mZnNldClcbiAgfVxuXG4gIGZ1bmN0aW9uIGFycmF5SW5kZXhPZiAoYXJyLCB2YWwsIGJ5dGVPZmZzZXQpIHtcbiAgICB2YXIgZm91bmRJbmRleCA9IC0xXG4gICAgZm9yICh2YXIgaSA9IDA7IGJ5dGVPZmZzZXQgKyBpIDwgYXJyLmxlbmd0aDsgaSsrKSB7XG4gICAgICBpZiAoYXJyW2J5dGVPZmZzZXQgKyBpXSA9PT0gdmFsW2ZvdW5kSW5kZXggPT09IC0xID8gMCA6IGkgLSBmb3VuZEluZGV4XSkge1xuICAgICAgICBpZiAoZm91bmRJbmRleCA9PT0gLTEpIGZvdW5kSW5kZXggPSBpXG4gICAgICAgIGlmIChpIC0gZm91bmRJbmRleCArIDEgPT09IHZhbC5sZW5ndGgpIHJldHVybiBieXRlT2Zmc2V0ICsgZm91bmRJbmRleFxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgZm91bmRJbmRleCA9IC0xXG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiAtMVxuICB9XG5cbiAgdGhyb3cgbmV3IFR5cGVFcnJvcigndmFsIG11c3QgYmUgc3RyaW5nLCBudW1iZXIgb3IgQnVmZmVyJylcbn1cblxuLy8gYGdldGAgd2lsbCBiZSByZW1vdmVkIGluIE5vZGUgMC4xMytcbkJ1ZmZlci5wcm90b3R5cGUuZ2V0ID0gZnVuY3Rpb24gZ2V0IChvZmZzZXQpIHtcbiAgY29uc29sZS5sb2coJy5nZXQoKSBpcyBkZXByZWNhdGVkLiBBY2Nlc3MgdXNpbmcgYXJyYXkgaW5kZXhlcyBpbnN0ZWFkLicpXG4gIHJldHVybiB0aGlzLnJlYWRVSW50OChvZmZzZXQpXG59XG5cbi8vIGBzZXRgIHdpbGwgYmUgcmVtb3ZlZCBpbiBOb2RlIDAuMTMrXG5CdWZmZXIucHJvdG90eXBlLnNldCA9IGZ1bmN0aW9uIHNldCAodiwgb2Zmc2V0KSB7XG4gIGNvbnNvbGUubG9nKCcuc2V0KCkgaXMgZGVwcmVjYXRlZC4gQWNjZXNzIHVzaW5nIGFycmF5IGluZGV4ZXMgaW5zdGVhZC4nKVxuICByZXR1cm4gdGhpcy53cml0ZVVJbnQ4KHYsIG9mZnNldClcbn1cblxuZnVuY3Rpb24gaGV4V3JpdGUgKGJ1Ziwgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCkge1xuICBvZmZzZXQgPSBOdW1iZXIob2Zmc2V0KSB8fCAwXG4gIHZhciByZW1haW5pbmcgPSBidWYubGVuZ3RoIC0gb2Zmc2V0XG4gIGlmICghbGVuZ3RoKSB7XG4gICAgbGVuZ3RoID0gcmVtYWluaW5nXG4gIH0gZWxzZSB7XG4gICAgbGVuZ3RoID0gTnVtYmVyKGxlbmd0aClcbiAgICBpZiAobGVuZ3RoID4gcmVtYWluaW5nKSB7XG4gICAgICBsZW5ndGggPSByZW1haW5pbmdcbiAgICB9XG4gIH1cblxuICAvLyBtdXN0IGJlIGFuIGV2ZW4gbnVtYmVyIG9mIGRpZ2l0c1xuICB2YXIgc3RyTGVuID0gc3RyaW5nLmxlbmd0aFxuICBpZiAoc3RyTGVuICUgMiAhPT0gMCkgdGhyb3cgbmV3IEVycm9yKCdJbnZhbGlkIGhleCBzdHJpbmcnKVxuXG4gIGlmIChsZW5ndGggPiBzdHJMZW4gLyAyKSB7XG4gICAgbGVuZ3RoID0gc3RyTGVuIC8gMlxuICB9XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuZ3RoOyBpKyspIHtcbiAgICB2YXIgcGFyc2VkID0gcGFyc2VJbnQoc3RyaW5nLnN1YnN0cihpICogMiwgMiksIDE2KVxuICAgIGlmIChpc05hTihwYXJzZWQpKSB0aHJvdyBuZXcgRXJyb3IoJ0ludmFsaWQgaGV4IHN0cmluZycpXG4gICAgYnVmW29mZnNldCArIGldID0gcGFyc2VkXG4gIH1cbiAgcmV0dXJuIGlcbn1cblxuZnVuY3Rpb24gdXRmOFdyaXRlIChidWYsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpIHtcbiAgcmV0dXJuIGJsaXRCdWZmZXIodXRmOFRvQnl0ZXMoc3RyaW5nLCBidWYubGVuZ3RoIC0gb2Zmc2V0KSwgYnVmLCBvZmZzZXQsIGxlbmd0aClcbn1cblxuZnVuY3Rpb24gYXNjaWlXcml0ZSAoYnVmLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKSB7XG4gIHJldHVybiBibGl0QnVmZmVyKGFzY2lpVG9CeXRlcyhzdHJpbmcpLCBidWYsIG9mZnNldCwgbGVuZ3RoKVxufVxuXG5mdW5jdGlvbiBiaW5hcnlXcml0ZSAoYnVmLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKSB7XG4gIHJldHVybiBhc2NpaVdyaXRlKGJ1Ziwgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aClcbn1cblxuZnVuY3Rpb24gYmFzZTY0V3JpdGUgKGJ1Ziwgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCkge1xuICByZXR1cm4gYmxpdEJ1ZmZlcihiYXNlNjRUb0J5dGVzKHN0cmluZyksIGJ1Ziwgb2Zmc2V0LCBsZW5ndGgpXG59XG5cbmZ1bmN0aW9uIHVjczJXcml0ZSAoYnVmLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKSB7XG4gIHJldHVybiBibGl0QnVmZmVyKHV0ZjE2bGVUb0J5dGVzKHN0cmluZywgYnVmLmxlbmd0aCAtIG9mZnNldCksIGJ1Ziwgb2Zmc2V0LCBsZW5ndGgpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGUgPSBmdW5jdGlvbiB3cml0ZSAoc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCwgZW5jb2RpbmcpIHtcbiAgLy8gQnVmZmVyI3dyaXRlKHN0cmluZylcbiAgaWYgKG9mZnNldCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgZW5jb2RpbmcgPSAndXRmOCdcbiAgICBsZW5ndGggPSB0aGlzLmxlbmd0aFxuICAgIG9mZnNldCA9IDBcbiAgLy8gQnVmZmVyI3dyaXRlKHN0cmluZywgZW5jb2RpbmcpXG4gIH0gZWxzZSBpZiAobGVuZ3RoID09PSB1bmRlZmluZWQgJiYgdHlwZW9mIG9mZnNldCA9PT0gJ3N0cmluZycpIHtcbiAgICBlbmNvZGluZyA9IG9mZnNldFxuICAgIGxlbmd0aCA9IHRoaXMubGVuZ3RoXG4gICAgb2Zmc2V0ID0gMFxuICAvLyBCdWZmZXIjd3JpdGUoc3RyaW5nLCBvZmZzZXRbLCBsZW5ndGhdWywgZW5jb2RpbmddKVxuICB9IGVsc2UgaWYgKGlzRmluaXRlKG9mZnNldCkpIHtcbiAgICBvZmZzZXQgPSBvZmZzZXQgfCAwXG4gICAgaWYgKGlzRmluaXRlKGxlbmd0aCkpIHtcbiAgICAgIGxlbmd0aCA9IGxlbmd0aCB8IDBcbiAgICAgIGlmIChlbmNvZGluZyA9PT0gdW5kZWZpbmVkKSBlbmNvZGluZyA9ICd1dGY4J1xuICAgIH0gZWxzZSB7XG4gICAgICBlbmNvZGluZyA9IGxlbmd0aFxuICAgICAgbGVuZ3RoID0gdW5kZWZpbmVkXG4gICAgfVxuICAvLyBsZWdhY3kgd3JpdGUoc3RyaW5nLCBlbmNvZGluZywgb2Zmc2V0LCBsZW5ndGgpIC0gcmVtb3ZlIGluIHYwLjEzXG4gIH0gZWxzZSB7XG4gICAgdmFyIHN3YXAgPSBlbmNvZGluZ1xuICAgIGVuY29kaW5nID0gb2Zmc2V0XG4gICAgb2Zmc2V0ID0gbGVuZ3RoIHwgMFxuICAgIGxlbmd0aCA9IHN3YXBcbiAgfVxuXG4gIHZhciByZW1haW5pbmcgPSB0aGlzLmxlbmd0aCAtIG9mZnNldFxuICBpZiAobGVuZ3RoID09PSB1bmRlZmluZWQgfHwgbGVuZ3RoID4gcmVtYWluaW5nKSBsZW5ndGggPSByZW1haW5pbmdcblxuICBpZiAoKHN0cmluZy5sZW5ndGggPiAwICYmIChsZW5ndGggPCAwIHx8IG9mZnNldCA8IDApKSB8fCBvZmZzZXQgPiB0aGlzLmxlbmd0aCkge1xuICAgIHRocm93IG5ldyBSYW5nZUVycm9yKCdhdHRlbXB0IHRvIHdyaXRlIG91dHNpZGUgYnVmZmVyIGJvdW5kcycpXG4gIH1cblxuICBpZiAoIWVuY29kaW5nKSBlbmNvZGluZyA9ICd1dGY4J1xuXG4gIHZhciBsb3dlcmVkQ2FzZSA9IGZhbHNlXG4gIGZvciAoOzspIHtcbiAgICBzd2l0Y2ggKGVuY29kaW5nKSB7XG4gICAgICBjYXNlICdoZXgnOlxuICAgICAgICByZXR1cm4gaGV4V3JpdGUodGhpcywgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aClcblxuICAgICAgY2FzZSAndXRmOCc6XG4gICAgICBjYXNlICd1dGYtOCc6XG4gICAgICAgIHJldHVybiB1dGY4V3JpdGUodGhpcywgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aClcblxuICAgICAgY2FzZSAnYXNjaWknOlxuICAgICAgICByZXR1cm4gYXNjaWlXcml0ZSh0aGlzLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKVxuXG4gICAgICBjYXNlICdiaW5hcnknOlxuICAgICAgICByZXR1cm4gYmluYXJ5V3JpdGUodGhpcywgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aClcblxuICAgICAgY2FzZSAnYmFzZTY0JzpcbiAgICAgICAgLy8gV2FybmluZzogbWF4TGVuZ3RoIG5vdCB0YWtlbiBpbnRvIGFjY291bnQgaW4gYmFzZTY0V3JpdGVcbiAgICAgICAgcmV0dXJuIGJhc2U2NFdyaXRlKHRoaXMsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpXG5cbiAgICAgIGNhc2UgJ3VjczInOlxuICAgICAgY2FzZSAndWNzLTInOlxuICAgICAgY2FzZSAndXRmMTZsZSc6XG4gICAgICBjYXNlICd1dGYtMTZsZSc6XG4gICAgICAgIHJldHVybiB1Y3MyV3JpdGUodGhpcywgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aClcblxuICAgICAgZGVmYXVsdDpcbiAgICAgICAgaWYgKGxvd2VyZWRDYXNlKSB0aHJvdyBuZXcgVHlwZUVycm9yKCdVbmtub3duIGVuY29kaW5nOiAnICsgZW5jb2RpbmcpXG4gICAgICAgIGVuY29kaW5nID0gKCcnICsgZW5jb2RpbmcpLnRvTG93ZXJDYXNlKClcbiAgICAgICAgbG93ZXJlZENhc2UgPSB0cnVlXG4gICAgfVxuICB9XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUudG9KU09OID0gZnVuY3Rpb24gdG9KU09OICgpIHtcbiAgcmV0dXJuIHtcbiAgICB0eXBlOiAnQnVmZmVyJyxcbiAgICBkYXRhOiBBcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbCh0aGlzLl9hcnIgfHwgdGhpcywgMClcbiAgfVxufVxuXG5mdW5jdGlvbiBiYXNlNjRTbGljZSAoYnVmLCBzdGFydCwgZW5kKSB7XG4gIGlmIChzdGFydCA9PT0gMCAmJiBlbmQgPT09IGJ1Zi5sZW5ndGgpIHtcbiAgICByZXR1cm4gYmFzZTY0LmZyb21CeXRlQXJyYXkoYnVmKVxuICB9IGVsc2Uge1xuICAgIHJldHVybiBiYXNlNjQuZnJvbUJ5dGVBcnJheShidWYuc2xpY2Uoc3RhcnQsIGVuZCkpXG4gIH1cbn1cblxuZnVuY3Rpb24gdXRmOFNsaWNlIChidWYsIHN0YXJ0LCBlbmQpIHtcbiAgdmFyIHJlcyA9ICcnXG4gIHZhciB0bXAgPSAnJ1xuICBlbmQgPSBNYXRoLm1pbihidWYubGVuZ3RoLCBlbmQpXG5cbiAgZm9yICh2YXIgaSA9IHN0YXJ0OyBpIDwgZW5kOyBpKyspIHtcbiAgICBpZiAoYnVmW2ldIDw9IDB4N0YpIHtcbiAgICAgIHJlcyArPSBkZWNvZGVVdGY4Q2hhcih0bXApICsgU3RyaW5nLmZyb21DaGFyQ29kZShidWZbaV0pXG4gICAgICB0bXAgPSAnJ1xuICAgIH0gZWxzZSB7XG4gICAgICB0bXAgKz0gJyUnICsgYnVmW2ldLnRvU3RyaW5nKDE2KVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiByZXMgKyBkZWNvZGVVdGY4Q2hhcih0bXApXG59XG5cbmZ1bmN0aW9uIGFzY2lpU2xpY2UgKGJ1Ziwgc3RhcnQsIGVuZCkge1xuICB2YXIgcmV0ID0gJydcbiAgZW5kID0gTWF0aC5taW4oYnVmLmxlbmd0aCwgZW5kKVxuXG4gIGZvciAodmFyIGkgPSBzdGFydDsgaSA8IGVuZDsgaSsrKSB7XG4gICAgcmV0ICs9IFN0cmluZy5mcm9tQ2hhckNvZGUoYnVmW2ldICYgMHg3RilcbiAgfVxuICByZXR1cm4gcmV0XG59XG5cbmZ1bmN0aW9uIGJpbmFyeVNsaWNlIChidWYsIHN0YXJ0LCBlbmQpIHtcbiAgdmFyIHJldCA9ICcnXG4gIGVuZCA9IE1hdGgubWluKGJ1Zi5sZW5ndGgsIGVuZClcblxuICBmb3IgKHZhciBpID0gc3RhcnQ7IGkgPCBlbmQ7IGkrKykge1xuICAgIHJldCArPSBTdHJpbmcuZnJvbUNoYXJDb2RlKGJ1ZltpXSlcbiAgfVxuICByZXR1cm4gcmV0XG59XG5cbmZ1bmN0aW9uIGhleFNsaWNlIChidWYsIHN0YXJ0LCBlbmQpIHtcbiAgdmFyIGxlbiA9IGJ1Zi5sZW5ndGhcblxuICBpZiAoIXN0YXJ0IHx8IHN0YXJ0IDwgMCkgc3RhcnQgPSAwXG4gIGlmICghZW5kIHx8IGVuZCA8IDAgfHwgZW5kID4gbGVuKSBlbmQgPSBsZW5cblxuICB2YXIgb3V0ID0gJydcbiAgZm9yICh2YXIgaSA9IHN0YXJ0OyBpIDwgZW5kOyBpKyspIHtcbiAgICBvdXQgKz0gdG9IZXgoYnVmW2ldKVxuICB9XG4gIHJldHVybiBvdXRcbn1cblxuZnVuY3Rpb24gdXRmMTZsZVNsaWNlIChidWYsIHN0YXJ0LCBlbmQpIHtcbiAgdmFyIGJ5dGVzID0gYnVmLnNsaWNlKHN0YXJ0LCBlbmQpXG4gIHZhciByZXMgPSAnJ1xuICBmb3IgKHZhciBpID0gMDsgaSA8IGJ5dGVzLmxlbmd0aDsgaSArPSAyKSB7XG4gICAgcmVzICs9IFN0cmluZy5mcm9tQ2hhckNvZGUoYnl0ZXNbaV0gKyBieXRlc1tpICsgMV0gKiAyNTYpXG4gIH1cbiAgcmV0dXJuIHJlc1xufVxuXG5CdWZmZXIucHJvdG90eXBlLnNsaWNlID0gZnVuY3Rpb24gc2xpY2UgKHN0YXJ0LCBlbmQpIHtcbiAgdmFyIGxlbiA9IHRoaXMubGVuZ3RoXG4gIHN0YXJ0ID0gfn5zdGFydFxuICBlbmQgPSBlbmQgPT09IHVuZGVmaW5lZCA/IGxlbiA6IH5+ZW5kXG5cbiAgaWYgKHN0YXJ0IDwgMCkge1xuICAgIHN0YXJ0ICs9IGxlblxuICAgIGlmIChzdGFydCA8IDApIHN0YXJ0ID0gMFxuICB9IGVsc2UgaWYgKHN0YXJ0ID4gbGVuKSB7XG4gICAgc3RhcnQgPSBsZW5cbiAgfVxuXG4gIGlmIChlbmQgPCAwKSB7XG4gICAgZW5kICs9IGxlblxuICAgIGlmIChlbmQgPCAwKSBlbmQgPSAwXG4gIH0gZWxzZSBpZiAoZW5kID4gbGVuKSB7XG4gICAgZW5kID0gbGVuXG4gIH1cblxuICBpZiAoZW5kIDwgc3RhcnQpIGVuZCA9IHN0YXJ0XG5cbiAgdmFyIG5ld0J1ZlxuICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICBuZXdCdWYgPSBCdWZmZXIuX2F1Z21lbnQodGhpcy5zdWJhcnJheShzdGFydCwgZW5kKSlcbiAgfSBlbHNlIHtcbiAgICB2YXIgc2xpY2VMZW4gPSBlbmQgLSBzdGFydFxuICAgIG5ld0J1ZiA9IG5ldyBCdWZmZXIoc2xpY2VMZW4sIHVuZGVmaW5lZClcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IHNsaWNlTGVuOyBpKyspIHtcbiAgICAgIG5ld0J1ZltpXSA9IHRoaXNbaSArIHN0YXJ0XVxuICAgIH1cbiAgfVxuXG4gIGlmIChuZXdCdWYubGVuZ3RoKSBuZXdCdWYucGFyZW50ID0gdGhpcy5wYXJlbnQgfHwgdGhpc1xuXG4gIHJldHVybiBuZXdCdWZcbn1cblxuLypcbiAqIE5lZWQgdG8gbWFrZSBzdXJlIHRoYXQgYnVmZmVyIGlzbid0IHRyeWluZyB0byB3cml0ZSBvdXQgb2YgYm91bmRzLlxuICovXG5mdW5jdGlvbiBjaGVja09mZnNldCAob2Zmc2V0LCBleHQsIGxlbmd0aCkge1xuICBpZiAoKG9mZnNldCAlIDEpICE9PSAwIHx8IG9mZnNldCA8IDApIHRocm93IG5ldyBSYW5nZUVycm9yKCdvZmZzZXQgaXMgbm90IHVpbnQnKVxuICBpZiAob2Zmc2V0ICsgZXh0ID4gbGVuZ3RoKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcignVHJ5aW5nIHRvIGFjY2VzcyBiZXlvbmQgYnVmZmVyIGxlbmd0aCcpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZFVJbnRMRSA9IGZ1bmN0aW9uIHJlYWRVSW50TEUgKG9mZnNldCwgYnl0ZUxlbmd0aCwgbm9Bc3NlcnQpIHtcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBieXRlTGVuZ3RoID0gYnl0ZUxlbmd0aCB8IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCBieXRlTGVuZ3RoLCB0aGlzLmxlbmd0aClcblxuICB2YXIgdmFsID0gdGhpc1tvZmZzZXRdXG4gIHZhciBtdWwgPSAxXG4gIHZhciBpID0gMFxuICB3aGlsZSAoKytpIDwgYnl0ZUxlbmd0aCAmJiAobXVsICo9IDB4MTAwKSkge1xuICAgIHZhbCArPSB0aGlzW29mZnNldCArIGldICogbXVsXG4gIH1cblxuICByZXR1cm4gdmFsXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZFVJbnRCRSA9IGZ1bmN0aW9uIHJlYWRVSW50QkUgKG9mZnNldCwgYnl0ZUxlbmd0aCwgbm9Bc3NlcnQpIHtcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBieXRlTGVuZ3RoID0gYnl0ZUxlbmd0aCB8IDBcbiAgaWYgKCFub0Fzc2VydCkge1xuICAgIGNoZWNrT2Zmc2V0KG9mZnNldCwgYnl0ZUxlbmd0aCwgdGhpcy5sZW5ndGgpXG4gIH1cblxuICB2YXIgdmFsID0gdGhpc1tvZmZzZXQgKyAtLWJ5dGVMZW5ndGhdXG4gIHZhciBtdWwgPSAxXG4gIHdoaWxlIChieXRlTGVuZ3RoID4gMCAmJiAobXVsICo9IDB4MTAwKSkge1xuICAgIHZhbCArPSB0aGlzW29mZnNldCArIC0tYnl0ZUxlbmd0aF0gKiBtdWxcbiAgfVxuXG4gIHJldHVybiB2YWxcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkVUludDggPSBmdW5jdGlvbiByZWFkVUludDggKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCAxLCB0aGlzLmxlbmd0aClcbiAgcmV0dXJuIHRoaXNbb2Zmc2V0XVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRVSW50MTZMRSA9IGZ1bmN0aW9uIHJlYWRVSW50MTZMRSAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDIsIHRoaXMubGVuZ3RoKVxuICByZXR1cm4gdGhpc1tvZmZzZXRdIHwgKHRoaXNbb2Zmc2V0ICsgMV0gPDwgOClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkVUludDE2QkUgPSBmdW5jdGlvbiByZWFkVUludDE2QkUgKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCAyLCB0aGlzLmxlbmd0aClcbiAgcmV0dXJuICh0aGlzW29mZnNldF0gPDwgOCkgfCB0aGlzW29mZnNldCArIDFdXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZFVJbnQzMkxFID0gZnVuY3Rpb24gcmVhZFVJbnQzMkxFIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgNCwgdGhpcy5sZW5ndGgpXG5cbiAgcmV0dXJuICgodGhpc1tvZmZzZXRdKSB8XG4gICAgICAodGhpc1tvZmZzZXQgKyAxXSA8PCA4KSB8XG4gICAgICAodGhpc1tvZmZzZXQgKyAyXSA8PCAxNikpICtcbiAgICAgICh0aGlzW29mZnNldCArIDNdICogMHgxMDAwMDAwKVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRVSW50MzJCRSA9IGZ1bmN0aW9uIHJlYWRVSW50MzJCRSAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDQsIHRoaXMubGVuZ3RoKVxuXG4gIHJldHVybiAodGhpc1tvZmZzZXRdICogMHgxMDAwMDAwKSArXG4gICAgKCh0aGlzW29mZnNldCArIDFdIDw8IDE2KSB8XG4gICAgKHRoaXNbb2Zmc2V0ICsgMl0gPDwgOCkgfFxuICAgIHRoaXNbb2Zmc2V0ICsgM10pXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEludExFID0gZnVuY3Rpb24gcmVhZEludExFIChvZmZzZXQsIGJ5dGVMZW5ndGgsIG5vQXNzZXJ0KSB7XG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgYnl0ZUxlbmd0aCA9IGJ5dGVMZW5ndGggfCAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgYnl0ZUxlbmd0aCwgdGhpcy5sZW5ndGgpXG5cbiAgdmFyIHZhbCA9IHRoaXNbb2Zmc2V0XVxuICB2YXIgbXVsID0gMVxuICB2YXIgaSA9IDBcbiAgd2hpbGUgKCsraSA8IGJ5dGVMZW5ndGggJiYgKG11bCAqPSAweDEwMCkpIHtcbiAgICB2YWwgKz0gdGhpc1tvZmZzZXQgKyBpXSAqIG11bFxuICB9XG4gIG11bCAqPSAweDgwXG5cbiAgaWYgKHZhbCA+PSBtdWwpIHZhbCAtPSBNYXRoLnBvdygyLCA4ICogYnl0ZUxlbmd0aClcblxuICByZXR1cm4gdmFsXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEludEJFID0gZnVuY3Rpb24gcmVhZEludEJFIChvZmZzZXQsIGJ5dGVMZW5ndGgsIG5vQXNzZXJ0KSB7XG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgYnl0ZUxlbmd0aCA9IGJ5dGVMZW5ndGggfCAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgYnl0ZUxlbmd0aCwgdGhpcy5sZW5ndGgpXG5cbiAgdmFyIGkgPSBieXRlTGVuZ3RoXG4gIHZhciBtdWwgPSAxXG4gIHZhciB2YWwgPSB0aGlzW29mZnNldCArIC0taV1cbiAgd2hpbGUgKGkgPiAwICYmIChtdWwgKj0gMHgxMDApKSB7XG4gICAgdmFsICs9IHRoaXNbb2Zmc2V0ICsgLS1pXSAqIG11bFxuICB9XG4gIG11bCAqPSAweDgwXG5cbiAgaWYgKHZhbCA+PSBtdWwpIHZhbCAtPSBNYXRoLnBvdygyLCA4ICogYnl0ZUxlbmd0aClcblxuICByZXR1cm4gdmFsXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEludDggPSBmdW5jdGlvbiByZWFkSW50OCAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDEsIHRoaXMubGVuZ3RoKVxuICBpZiAoISh0aGlzW29mZnNldF0gJiAweDgwKSkgcmV0dXJuICh0aGlzW29mZnNldF0pXG4gIHJldHVybiAoKDB4ZmYgLSB0aGlzW29mZnNldF0gKyAxKSAqIC0xKVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRJbnQxNkxFID0gZnVuY3Rpb24gcmVhZEludDE2TEUgKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCAyLCB0aGlzLmxlbmd0aClcbiAgdmFyIHZhbCA9IHRoaXNbb2Zmc2V0XSB8ICh0aGlzW29mZnNldCArIDFdIDw8IDgpXG4gIHJldHVybiAodmFsICYgMHg4MDAwKSA/IHZhbCB8IDB4RkZGRjAwMDAgOiB2YWxcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkSW50MTZCRSA9IGZ1bmN0aW9uIHJlYWRJbnQxNkJFIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgMiwgdGhpcy5sZW5ndGgpXG4gIHZhciB2YWwgPSB0aGlzW29mZnNldCArIDFdIHwgKHRoaXNbb2Zmc2V0XSA8PCA4KVxuICByZXR1cm4gKHZhbCAmIDB4ODAwMCkgPyB2YWwgfCAweEZGRkYwMDAwIDogdmFsXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEludDMyTEUgPSBmdW5jdGlvbiByZWFkSW50MzJMRSAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDQsIHRoaXMubGVuZ3RoKVxuXG4gIHJldHVybiAodGhpc1tvZmZzZXRdKSB8XG4gICAgKHRoaXNbb2Zmc2V0ICsgMV0gPDwgOCkgfFxuICAgICh0aGlzW29mZnNldCArIDJdIDw8IDE2KSB8XG4gICAgKHRoaXNbb2Zmc2V0ICsgM10gPDwgMjQpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEludDMyQkUgPSBmdW5jdGlvbiByZWFkSW50MzJCRSAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDQsIHRoaXMubGVuZ3RoKVxuXG4gIHJldHVybiAodGhpc1tvZmZzZXRdIDw8IDI0KSB8XG4gICAgKHRoaXNbb2Zmc2V0ICsgMV0gPDwgMTYpIHxcbiAgICAodGhpc1tvZmZzZXQgKyAyXSA8PCA4KSB8XG4gICAgKHRoaXNbb2Zmc2V0ICsgM10pXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEZsb2F0TEUgPSBmdW5jdGlvbiByZWFkRmxvYXRMRSAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDQsIHRoaXMubGVuZ3RoKVxuICByZXR1cm4gaWVlZTc1NC5yZWFkKHRoaXMsIG9mZnNldCwgdHJ1ZSwgMjMsIDQpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEZsb2F0QkUgPSBmdW5jdGlvbiByZWFkRmxvYXRCRSAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDQsIHRoaXMubGVuZ3RoKVxuICByZXR1cm4gaWVlZTc1NC5yZWFkKHRoaXMsIG9mZnNldCwgZmFsc2UsIDIzLCA0KVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWREb3VibGVMRSA9IGZ1bmN0aW9uIHJlYWREb3VibGVMRSAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDgsIHRoaXMubGVuZ3RoKVxuICByZXR1cm4gaWVlZTc1NC5yZWFkKHRoaXMsIG9mZnNldCwgdHJ1ZSwgNTIsIDgpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZERvdWJsZUJFID0gZnVuY3Rpb24gcmVhZERvdWJsZUJFIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgOCwgdGhpcy5sZW5ndGgpXG4gIHJldHVybiBpZWVlNzU0LnJlYWQodGhpcywgb2Zmc2V0LCBmYWxzZSwgNTIsIDgpXG59XG5cbmZ1bmN0aW9uIGNoZWNrSW50IChidWYsIHZhbHVlLCBvZmZzZXQsIGV4dCwgbWF4LCBtaW4pIHtcbiAgaWYgKCFCdWZmZXIuaXNCdWZmZXIoYnVmKSkgdGhyb3cgbmV3IFR5cGVFcnJvcignYnVmZmVyIG11c3QgYmUgYSBCdWZmZXIgaW5zdGFuY2UnKVxuICBpZiAodmFsdWUgPiBtYXggfHwgdmFsdWUgPCBtaW4pIHRocm93IG5ldyBSYW5nZUVycm9yKCd2YWx1ZSBpcyBvdXQgb2YgYm91bmRzJylcbiAgaWYgKG9mZnNldCArIGV4dCA+IGJ1Zi5sZW5ndGgpIHRocm93IG5ldyBSYW5nZUVycm9yKCdpbmRleCBvdXQgb2YgcmFuZ2UnKVxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlVUludExFID0gZnVuY3Rpb24gd3JpdGVVSW50TEUgKHZhbHVlLCBvZmZzZXQsIGJ5dGVMZW5ndGgsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgYnl0ZUxlbmd0aCA9IGJ5dGVMZW5ndGggfCAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIGJ5dGVMZW5ndGgsIE1hdGgucG93KDIsIDggKiBieXRlTGVuZ3RoKSwgMClcblxuICB2YXIgbXVsID0gMVxuICB2YXIgaSA9IDBcbiAgdGhpc1tvZmZzZXRdID0gdmFsdWUgJiAweEZGXG4gIHdoaWxlICgrK2kgPCBieXRlTGVuZ3RoICYmIChtdWwgKj0gMHgxMDApKSB7XG4gICAgdGhpc1tvZmZzZXQgKyBpXSA9ICh2YWx1ZSAvIG11bCkgJiAweEZGXG4gIH1cblxuICByZXR1cm4gb2Zmc2V0ICsgYnl0ZUxlbmd0aFxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlVUludEJFID0gZnVuY3Rpb24gd3JpdGVVSW50QkUgKHZhbHVlLCBvZmZzZXQsIGJ5dGVMZW5ndGgsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgYnl0ZUxlbmd0aCA9IGJ5dGVMZW5ndGggfCAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIGJ5dGVMZW5ndGgsIE1hdGgucG93KDIsIDggKiBieXRlTGVuZ3RoKSwgMClcblxuICB2YXIgaSA9IGJ5dGVMZW5ndGggLSAxXG4gIHZhciBtdWwgPSAxXG4gIHRoaXNbb2Zmc2V0ICsgaV0gPSB2YWx1ZSAmIDB4RkZcbiAgd2hpbGUgKC0taSA+PSAwICYmIChtdWwgKj0gMHgxMDApKSB7XG4gICAgdGhpc1tvZmZzZXQgKyBpXSA9ICh2YWx1ZSAvIG11bCkgJiAweEZGXG4gIH1cblxuICByZXR1cm4gb2Zmc2V0ICsgYnl0ZUxlbmd0aFxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlVUludDggPSBmdW5jdGlvbiB3cml0ZVVJbnQ4ICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgfCAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIDEsIDB4ZmYsIDApXG4gIGlmICghQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHZhbHVlID0gTWF0aC5mbG9vcih2YWx1ZSlcbiAgdGhpc1tvZmZzZXRdID0gdmFsdWVcbiAgcmV0dXJuIG9mZnNldCArIDFcbn1cblxuZnVuY3Rpb24gb2JqZWN0V3JpdGVVSW50MTYgKGJ1ZiwgdmFsdWUsIG9mZnNldCwgbGl0dGxlRW5kaWFuKSB7XG4gIGlmICh2YWx1ZSA8IDApIHZhbHVlID0gMHhmZmZmICsgdmFsdWUgKyAxXG4gIGZvciAodmFyIGkgPSAwLCBqID0gTWF0aC5taW4oYnVmLmxlbmd0aCAtIG9mZnNldCwgMik7IGkgPCBqOyBpKyspIHtcbiAgICBidWZbb2Zmc2V0ICsgaV0gPSAodmFsdWUgJiAoMHhmZiA8PCAoOCAqIChsaXR0bGVFbmRpYW4gPyBpIDogMSAtIGkpKSkpID4+PlxuICAgICAgKGxpdHRsZUVuZGlhbiA/IGkgOiAxIC0gaSkgKiA4XG4gIH1cbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZVVJbnQxNkxFID0gZnVuY3Rpb24gd3JpdGVVSW50MTZMRSAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCAyLCAweGZmZmYsIDApXG4gIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIHRoaXNbb2Zmc2V0XSA9IHZhbHVlXG4gICAgdGhpc1tvZmZzZXQgKyAxXSA9ICh2YWx1ZSA+Pj4gOClcbiAgfSBlbHNlIHtcbiAgICBvYmplY3RXcml0ZVVJbnQxNih0aGlzLCB2YWx1ZSwgb2Zmc2V0LCB0cnVlKVxuICB9XG4gIHJldHVybiBvZmZzZXQgKyAyXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVVSW50MTZCRSA9IGZ1bmN0aW9uIHdyaXRlVUludDE2QkUgKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgMiwgMHhmZmZmLCAwKVxuICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICB0aGlzW29mZnNldF0gPSAodmFsdWUgPj4+IDgpXG4gICAgdGhpc1tvZmZzZXQgKyAxXSA9IHZhbHVlXG4gIH0gZWxzZSB7XG4gICAgb2JqZWN0V3JpdGVVSW50MTYodGhpcywgdmFsdWUsIG9mZnNldCwgZmFsc2UpXG4gIH1cbiAgcmV0dXJuIG9mZnNldCArIDJcbn1cblxuZnVuY3Rpb24gb2JqZWN0V3JpdGVVSW50MzIgKGJ1ZiwgdmFsdWUsIG9mZnNldCwgbGl0dGxlRW5kaWFuKSB7XG4gIGlmICh2YWx1ZSA8IDApIHZhbHVlID0gMHhmZmZmZmZmZiArIHZhbHVlICsgMVxuICBmb3IgKHZhciBpID0gMCwgaiA9IE1hdGgubWluKGJ1Zi5sZW5ndGggLSBvZmZzZXQsIDQpOyBpIDwgajsgaSsrKSB7XG4gICAgYnVmW29mZnNldCArIGldID0gKHZhbHVlID4+PiAobGl0dGxlRW5kaWFuID8gaSA6IDMgLSBpKSAqIDgpICYgMHhmZlxuICB9XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVVSW50MzJMRSA9IGZ1bmN0aW9uIHdyaXRlVUludDMyTEUgKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgNCwgMHhmZmZmZmZmZiwgMClcbiAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgdGhpc1tvZmZzZXQgKyAzXSA9ICh2YWx1ZSA+Pj4gMjQpXG4gICAgdGhpc1tvZmZzZXQgKyAyXSA9ICh2YWx1ZSA+Pj4gMTYpXG4gICAgdGhpc1tvZmZzZXQgKyAxXSA9ICh2YWx1ZSA+Pj4gOClcbiAgICB0aGlzW29mZnNldF0gPSB2YWx1ZVxuICB9IGVsc2Uge1xuICAgIG9iamVjdFdyaXRlVUludDMyKHRoaXMsIHZhbHVlLCBvZmZzZXQsIHRydWUpXG4gIH1cbiAgcmV0dXJuIG9mZnNldCArIDRcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZVVJbnQzMkJFID0gZnVuY3Rpb24gd3JpdGVVSW50MzJCRSAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCA0LCAweGZmZmZmZmZmLCAwKVxuICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICB0aGlzW29mZnNldF0gPSAodmFsdWUgPj4+IDI0KVxuICAgIHRoaXNbb2Zmc2V0ICsgMV0gPSAodmFsdWUgPj4+IDE2KVxuICAgIHRoaXNbb2Zmc2V0ICsgMl0gPSAodmFsdWUgPj4+IDgpXG4gICAgdGhpc1tvZmZzZXQgKyAzXSA9IHZhbHVlXG4gIH0gZWxzZSB7XG4gICAgb2JqZWN0V3JpdGVVSW50MzIodGhpcywgdmFsdWUsIG9mZnNldCwgZmFsc2UpXG4gIH1cbiAgcmV0dXJuIG9mZnNldCArIDRcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUludExFID0gZnVuY3Rpb24gd3JpdGVJbnRMRSAodmFsdWUsIG9mZnNldCwgYnl0ZUxlbmd0aCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBpZiAoIW5vQXNzZXJ0KSB7XG4gICAgdmFyIGxpbWl0ID0gTWF0aC5wb3coMiwgOCAqIGJ5dGVMZW5ndGggLSAxKVxuXG4gICAgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgYnl0ZUxlbmd0aCwgbGltaXQgLSAxLCAtbGltaXQpXG4gIH1cblxuICB2YXIgaSA9IDBcbiAgdmFyIG11bCA9IDFcbiAgdmFyIHN1YiA9IHZhbHVlIDwgMCA/IDEgOiAwXG4gIHRoaXNbb2Zmc2V0XSA9IHZhbHVlICYgMHhGRlxuICB3aGlsZSAoKytpIDwgYnl0ZUxlbmd0aCAmJiAobXVsICo9IDB4MTAwKSkge1xuICAgIHRoaXNbb2Zmc2V0ICsgaV0gPSAoKHZhbHVlIC8gbXVsKSA+PiAwKSAtIHN1YiAmIDB4RkZcbiAgfVxuXG4gIHJldHVybiBvZmZzZXQgKyBieXRlTGVuZ3RoXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVJbnRCRSA9IGZ1bmN0aW9uIHdyaXRlSW50QkUgKHZhbHVlLCBvZmZzZXQsIGJ5dGVMZW5ndGgsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgaWYgKCFub0Fzc2VydCkge1xuICAgIHZhciBsaW1pdCA9IE1hdGgucG93KDIsIDggKiBieXRlTGVuZ3RoIC0gMSlcblxuICAgIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIGJ5dGVMZW5ndGgsIGxpbWl0IC0gMSwgLWxpbWl0KVxuICB9XG5cbiAgdmFyIGkgPSBieXRlTGVuZ3RoIC0gMVxuICB2YXIgbXVsID0gMVxuICB2YXIgc3ViID0gdmFsdWUgPCAwID8gMSA6IDBcbiAgdGhpc1tvZmZzZXQgKyBpXSA9IHZhbHVlICYgMHhGRlxuICB3aGlsZSAoLS1pID49IDAgJiYgKG11bCAqPSAweDEwMCkpIHtcbiAgICB0aGlzW29mZnNldCArIGldID0gKCh2YWx1ZSAvIG11bCkgPj4gMCkgLSBzdWIgJiAweEZGXG4gIH1cblxuICByZXR1cm4gb2Zmc2V0ICsgYnl0ZUxlbmd0aFxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlSW50OCA9IGZ1bmN0aW9uIHdyaXRlSW50OCAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCAxLCAweDdmLCAtMHg4MClcbiAgaWYgKCFCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkgdmFsdWUgPSBNYXRoLmZsb29yKHZhbHVlKVxuICBpZiAodmFsdWUgPCAwKSB2YWx1ZSA9IDB4ZmYgKyB2YWx1ZSArIDFcbiAgdGhpc1tvZmZzZXRdID0gdmFsdWVcbiAgcmV0dXJuIG9mZnNldCArIDFcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUludDE2TEUgPSBmdW5jdGlvbiB3cml0ZUludDE2TEUgKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgMiwgMHg3ZmZmLCAtMHg4MDAwKVxuICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICB0aGlzW29mZnNldF0gPSB2YWx1ZVxuICAgIHRoaXNbb2Zmc2V0ICsgMV0gPSAodmFsdWUgPj4+IDgpXG4gIH0gZWxzZSB7XG4gICAgb2JqZWN0V3JpdGVVSW50MTYodGhpcywgdmFsdWUsIG9mZnNldCwgdHJ1ZSlcbiAgfVxuICByZXR1cm4gb2Zmc2V0ICsgMlxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlSW50MTZCRSA9IGZ1bmN0aW9uIHdyaXRlSW50MTZCRSAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCAyLCAweDdmZmYsIC0weDgwMDApXG4gIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIHRoaXNbb2Zmc2V0XSA9ICh2YWx1ZSA+Pj4gOClcbiAgICB0aGlzW29mZnNldCArIDFdID0gdmFsdWVcbiAgfSBlbHNlIHtcbiAgICBvYmplY3RXcml0ZVVJbnQxNih0aGlzLCB2YWx1ZSwgb2Zmc2V0LCBmYWxzZSlcbiAgfVxuICByZXR1cm4gb2Zmc2V0ICsgMlxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlSW50MzJMRSA9IGZ1bmN0aW9uIHdyaXRlSW50MzJMRSAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCA0LCAweDdmZmZmZmZmLCAtMHg4MDAwMDAwMClcbiAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgdGhpc1tvZmZzZXRdID0gdmFsdWVcbiAgICB0aGlzW29mZnNldCArIDFdID0gKHZhbHVlID4+PiA4KVxuICAgIHRoaXNbb2Zmc2V0ICsgMl0gPSAodmFsdWUgPj4+IDE2KVxuICAgIHRoaXNbb2Zmc2V0ICsgM10gPSAodmFsdWUgPj4+IDI0KVxuICB9IGVsc2Uge1xuICAgIG9iamVjdFdyaXRlVUludDMyKHRoaXMsIHZhbHVlLCBvZmZzZXQsIHRydWUpXG4gIH1cbiAgcmV0dXJuIG9mZnNldCArIDRcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUludDMyQkUgPSBmdW5jdGlvbiB3cml0ZUludDMyQkUgKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgNCwgMHg3ZmZmZmZmZiwgLTB4ODAwMDAwMDApXG4gIGlmICh2YWx1ZSA8IDApIHZhbHVlID0gMHhmZmZmZmZmZiArIHZhbHVlICsgMVxuICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICB0aGlzW29mZnNldF0gPSAodmFsdWUgPj4+IDI0KVxuICAgIHRoaXNbb2Zmc2V0ICsgMV0gPSAodmFsdWUgPj4+IDE2KVxuICAgIHRoaXNbb2Zmc2V0ICsgMl0gPSAodmFsdWUgPj4+IDgpXG4gICAgdGhpc1tvZmZzZXQgKyAzXSA9IHZhbHVlXG4gIH0gZWxzZSB7XG4gICAgb2JqZWN0V3JpdGVVSW50MzIodGhpcywgdmFsdWUsIG9mZnNldCwgZmFsc2UpXG4gIH1cbiAgcmV0dXJuIG9mZnNldCArIDRcbn1cblxuZnVuY3Rpb24gY2hlY2tJRUVFNzU0IChidWYsIHZhbHVlLCBvZmZzZXQsIGV4dCwgbWF4LCBtaW4pIHtcbiAgaWYgKHZhbHVlID4gbWF4IHx8IHZhbHVlIDwgbWluKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcigndmFsdWUgaXMgb3V0IG9mIGJvdW5kcycpXG4gIGlmIChvZmZzZXQgKyBleHQgPiBidWYubGVuZ3RoKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcignaW5kZXggb3V0IG9mIHJhbmdlJylcbiAgaWYgKG9mZnNldCA8IDApIHRocm93IG5ldyBSYW5nZUVycm9yKCdpbmRleCBvdXQgb2YgcmFuZ2UnKVxufVxuXG5mdW5jdGlvbiB3cml0ZUZsb2F0IChidWYsIHZhbHVlLCBvZmZzZXQsIGxpdHRsZUVuZGlhbiwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkge1xuICAgIGNoZWNrSUVFRTc1NChidWYsIHZhbHVlLCBvZmZzZXQsIDQsIDMuNDAyODIzNDY2Mzg1Mjg4NmUrMzgsIC0zLjQwMjgyMzQ2NjM4NTI4ODZlKzM4KVxuICB9XG4gIGllZWU3NTQud3JpdGUoYnVmLCB2YWx1ZSwgb2Zmc2V0LCBsaXR0bGVFbmRpYW4sIDIzLCA0KVxuICByZXR1cm4gb2Zmc2V0ICsgNFxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlRmxvYXRMRSA9IGZ1bmN0aW9uIHdyaXRlRmxvYXRMRSAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgcmV0dXJuIHdyaXRlRmxvYXQodGhpcywgdmFsdWUsIG9mZnNldCwgdHJ1ZSwgbm9Bc3NlcnQpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVGbG9hdEJFID0gZnVuY3Rpb24gd3JpdGVGbG9hdEJFICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICByZXR1cm4gd3JpdGVGbG9hdCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCBmYWxzZSwgbm9Bc3NlcnQpXG59XG5cbmZ1bmN0aW9uIHdyaXRlRG91YmxlIChidWYsIHZhbHVlLCBvZmZzZXQsIGxpdHRsZUVuZGlhbiwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkge1xuICAgIGNoZWNrSUVFRTc1NChidWYsIHZhbHVlLCBvZmZzZXQsIDgsIDEuNzk3NjkzMTM0ODYyMzE1N0UrMzA4LCAtMS43OTc2OTMxMzQ4NjIzMTU3RSszMDgpXG4gIH1cbiAgaWVlZTc1NC53cml0ZShidWYsIHZhbHVlLCBvZmZzZXQsIGxpdHRsZUVuZGlhbiwgNTIsIDgpXG4gIHJldHVybiBvZmZzZXQgKyA4XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVEb3VibGVMRSA9IGZ1bmN0aW9uIHdyaXRlRG91YmxlTEUgKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHJldHVybiB3cml0ZURvdWJsZSh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCB0cnVlLCBub0Fzc2VydClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZURvdWJsZUJFID0gZnVuY3Rpb24gd3JpdGVEb3VibGVCRSAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgcmV0dXJuIHdyaXRlRG91YmxlKHRoaXMsIHZhbHVlLCBvZmZzZXQsIGZhbHNlLCBub0Fzc2VydClcbn1cblxuLy8gY29weSh0YXJnZXRCdWZmZXIsIHRhcmdldFN0YXJ0PTAsIHNvdXJjZVN0YXJ0PTAsIHNvdXJjZUVuZD1idWZmZXIubGVuZ3RoKVxuQnVmZmVyLnByb3RvdHlwZS5jb3B5ID0gZnVuY3Rpb24gY29weSAodGFyZ2V0LCB0YXJnZXRTdGFydCwgc3RhcnQsIGVuZCkge1xuICBpZiAoIXN0YXJ0KSBzdGFydCA9IDBcbiAgaWYgKCFlbmQgJiYgZW5kICE9PSAwKSBlbmQgPSB0aGlzLmxlbmd0aFxuICBpZiAodGFyZ2V0U3RhcnQgPj0gdGFyZ2V0Lmxlbmd0aCkgdGFyZ2V0U3RhcnQgPSB0YXJnZXQubGVuZ3RoXG4gIGlmICghdGFyZ2V0U3RhcnQpIHRhcmdldFN0YXJ0ID0gMFxuICBpZiAoZW5kID4gMCAmJiBlbmQgPCBzdGFydCkgZW5kID0gc3RhcnRcblxuICAvLyBDb3B5IDAgYnl0ZXM7IHdlJ3JlIGRvbmVcbiAgaWYgKGVuZCA9PT0gc3RhcnQpIHJldHVybiAwXG4gIGlmICh0YXJnZXQubGVuZ3RoID09PSAwIHx8IHRoaXMubGVuZ3RoID09PSAwKSByZXR1cm4gMFxuXG4gIC8vIEZhdGFsIGVycm9yIGNvbmRpdGlvbnNcbiAgaWYgKHRhcmdldFN0YXJ0IDwgMCkge1xuICAgIHRocm93IG5ldyBSYW5nZUVycm9yKCd0YXJnZXRTdGFydCBvdXQgb2YgYm91bmRzJylcbiAgfVxuICBpZiAoc3RhcnQgPCAwIHx8IHN0YXJ0ID49IHRoaXMubGVuZ3RoKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcignc291cmNlU3RhcnQgb3V0IG9mIGJvdW5kcycpXG4gIGlmIChlbmQgPCAwKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcignc291cmNlRW5kIG91dCBvZiBib3VuZHMnKVxuXG4gIC8vIEFyZSB3ZSBvb2I/XG4gIGlmIChlbmQgPiB0aGlzLmxlbmd0aCkgZW5kID0gdGhpcy5sZW5ndGhcbiAgaWYgKHRhcmdldC5sZW5ndGggLSB0YXJnZXRTdGFydCA8IGVuZCAtIHN0YXJ0KSB7XG4gICAgZW5kID0gdGFyZ2V0Lmxlbmd0aCAtIHRhcmdldFN0YXJ0ICsgc3RhcnRcbiAgfVxuXG4gIHZhciBsZW4gPSBlbmQgLSBzdGFydFxuXG4gIGlmIChsZW4gPCAxMDAwIHx8ICFCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuOyBpKyspIHtcbiAgICAgIHRhcmdldFtpICsgdGFyZ2V0U3RhcnRdID0gdGhpc1tpICsgc3RhcnRdXG4gICAgfVxuICB9IGVsc2Uge1xuICAgIHRhcmdldC5fc2V0KHRoaXMuc3ViYXJyYXkoc3RhcnQsIHN0YXJ0ICsgbGVuKSwgdGFyZ2V0U3RhcnQpXG4gIH1cblxuICByZXR1cm4gbGVuXG59XG5cbi8vIGZpbGwodmFsdWUsIHN0YXJ0PTAsIGVuZD1idWZmZXIubGVuZ3RoKVxuQnVmZmVyLnByb3RvdHlwZS5maWxsID0gZnVuY3Rpb24gZmlsbCAodmFsdWUsIHN0YXJ0LCBlbmQpIHtcbiAgaWYgKCF2YWx1ZSkgdmFsdWUgPSAwXG4gIGlmICghc3RhcnQpIHN0YXJ0ID0gMFxuICBpZiAoIWVuZCkgZW5kID0gdGhpcy5sZW5ndGhcblxuICBpZiAoZW5kIDwgc3RhcnQpIHRocm93IG5ldyBSYW5nZUVycm9yKCdlbmQgPCBzdGFydCcpXG5cbiAgLy8gRmlsbCAwIGJ5dGVzOyB3ZSdyZSBkb25lXG4gIGlmIChlbmQgPT09IHN0YXJ0KSByZXR1cm5cbiAgaWYgKHRoaXMubGVuZ3RoID09PSAwKSByZXR1cm5cblxuICBpZiAoc3RhcnQgPCAwIHx8IHN0YXJ0ID49IHRoaXMubGVuZ3RoKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcignc3RhcnQgb3V0IG9mIGJvdW5kcycpXG4gIGlmIChlbmQgPCAwIHx8IGVuZCA+IHRoaXMubGVuZ3RoKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcignZW5kIG91dCBvZiBib3VuZHMnKVxuXG4gIHZhciBpXG4gIGlmICh0eXBlb2YgdmFsdWUgPT09ICdudW1iZXInKSB7XG4gICAgZm9yIChpID0gc3RhcnQ7IGkgPCBlbmQ7IGkrKykge1xuICAgICAgdGhpc1tpXSA9IHZhbHVlXG4gICAgfVxuICB9IGVsc2Uge1xuICAgIHZhciBieXRlcyA9IHV0ZjhUb0J5dGVzKHZhbHVlLnRvU3RyaW5nKCkpXG4gICAgdmFyIGxlbiA9IGJ5dGVzLmxlbmd0aFxuICAgIGZvciAoaSA9IHN0YXJ0OyBpIDwgZW5kOyBpKyspIHtcbiAgICAgIHRoaXNbaV0gPSBieXRlc1tpICUgbGVuXVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiB0aGlzXG59XG5cbi8qKlxuICogQ3JlYXRlcyBhIG5ldyBgQXJyYXlCdWZmZXJgIHdpdGggdGhlICpjb3BpZWQqIG1lbW9yeSBvZiB0aGUgYnVmZmVyIGluc3RhbmNlLlxuICogQWRkZWQgaW4gTm9kZSAwLjEyLiBPbmx5IGF2YWlsYWJsZSBpbiBicm93c2VycyB0aGF0IHN1cHBvcnQgQXJyYXlCdWZmZXIuXG4gKi9cbkJ1ZmZlci5wcm90b3R5cGUudG9BcnJheUJ1ZmZlciA9IGZ1bmN0aW9uIHRvQXJyYXlCdWZmZXIgKCkge1xuICBpZiAodHlwZW9mIFVpbnQ4QXJyYXkgIT09ICd1bmRlZmluZWQnKSB7XG4gICAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgICByZXR1cm4gKG5ldyBCdWZmZXIodGhpcykpLmJ1ZmZlclxuICAgIH0gZWxzZSB7XG4gICAgICB2YXIgYnVmID0gbmV3IFVpbnQ4QXJyYXkodGhpcy5sZW5ndGgpXG4gICAgICBmb3IgKHZhciBpID0gMCwgbGVuID0gYnVmLmxlbmd0aDsgaSA8IGxlbjsgaSArPSAxKSB7XG4gICAgICAgIGJ1ZltpXSA9IHRoaXNbaV1cbiAgICAgIH1cbiAgICAgIHJldHVybiBidWYuYnVmZmVyXG4gICAgfVxuICB9IGVsc2Uge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ0J1ZmZlci50b0FycmF5QnVmZmVyIG5vdCBzdXBwb3J0ZWQgaW4gdGhpcyBicm93c2VyJylcbiAgfVxufVxuXG4vLyBIRUxQRVIgRlVOQ1RJT05TXG4vLyA9PT09PT09PT09PT09PT09XG5cbnZhciBCUCA9IEJ1ZmZlci5wcm90b3R5cGVcblxuLyoqXG4gKiBBdWdtZW50IGEgVWludDhBcnJheSAqaW5zdGFuY2UqIChub3QgdGhlIFVpbnQ4QXJyYXkgY2xhc3MhKSB3aXRoIEJ1ZmZlciBtZXRob2RzXG4gKi9cbkJ1ZmZlci5fYXVnbWVudCA9IGZ1bmN0aW9uIF9hdWdtZW50IChhcnIpIHtcbiAgYXJyLmNvbnN0cnVjdG9yID0gQnVmZmVyXG4gIGFyci5faXNCdWZmZXIgPSB0cnVlXG5cbiAgLy8gc2F2ZSByZWZlcmVuY2UgdG8gb3JpZ2luYWwgVWludDhBcnJheSBzZXQgbWV0aG9kIGJlZm9yZSBvdmVyd3JpdGluZ1xuICBhcnIuX3NldCA9IGFyci5zZXRcblxuICAvLyBkZXByZWNhdGVkLCB3aWxsIGJlIHJlbW92ZWQgaW4gbm9kZSAwLjEzK1xuICBhcnIuZ2V0ID0gQlAuZ2V0XG4gIGFyci5zZXQgPSBCUC5zZXRcblxuICBhcnIud3JpdGUgPSBCUC53cml0ZVxuICBhcnIudG9TdHJpbmcgPSBCUC50b1N0cmluZ1xuICBhcnIudG9Mb2NhbGVTdHJpbmcgPSBCUC50b1N0cmluZ1xuICBhcnIudG9KU09OID0gQlAudG9KU09OXG4gIGFyci5lcXVhbHMgPSBCUC5lcXVhbHNcbiAgYXJyLmNvbXBhcmUgPSBCUC5jb21wYXJlXG4gIGFyci5pbmRleE9mID0gQlAuaW5kZXhPZlxuICBhcnIuY29weSA9IEJQLmNvcHlcbiAgYXJyLnNsaWNlID0gQlAuc2xpY2VcbiAgYXJyLnJlYWRVSW50TEUgPSBCUC5yZWFkVUludExFXG4gIGFyci5yZWFkVUludEJFID0gQlAucmVhZFVJbnRCRVxuICBhcnIucmVhZFVJbnQ4ID0gQlAucmVhZFVJbnQ4XG4gIGFyci5yZWFkVUludDE2TEUgPSBCUC5yZWFkVUludDE2TEVcbiAgYXJyLnJlYWRVSW50MTZCRSA9IEJQLnJlYWRVSW50MTZCRVxuICBhcnIucmVhZFVJbnQzMkxFID0gQlAucmVhZFVJbnQzMkxFXG4gIGFyci5yZWFkVUludDMyQkUgPSBCUC5yZWFkVUludDMyQkVcbiAgYXJyLnJlYWRJbnRMRSA9IEJQLnJlYWRJbnRMRVxuICBhcnIucmVhZEludEJFID0gQlAucmVhZEludEJFXG4gIGFyci5yZWFkSW50OCA9IEJQLnJlYWRJbnQ4XG4gIGFyci5yZWFkSW50MTZMRSA9IEJQLnJlYWRJbnQxNkxFXG4gIGFyci5yZWFkSW50MTZCRSA9IEJQLnJlYWRJbnQxNkJFXG4gIGFyci5yZWFkSW50MzJMRSA9IEJQLnJlYWRJbnQzMkxFXG4gIGFyci5yZWFkSW50MzJCRSA9IEJQLnJlYWRJbnQzMkJFXG4gIGFyci5yZWFkRmxvYXRMRSA9IEJQLnJlYWRGbG9hdExFXG4gIGFyci5yZWFkRmxvYXRCRSA9IEJQLnJlYWRGbG9hdEJFXG4gIGFyci5yZWFkRG91YmxlTEUgPSBCUC5yZWFkRG91YmxlTEVcbiAgYXJyLnJlYWREb3VibGVCRSA9IEJQLnJlYWREb3VibGVCRVxuICBhcnIud3JpdGVVSW50OCA9IEJQLndyaXRlVUludDhcbiAgYXJyLndyaXRlVUludExFID0gQlAud3JpdGVVSW50TEVcbiAgYXJyLndyaXRlVUludEJFID0gQlAud3JpdGVVSW50QkVcbiAgYXJyLndyaXRlVUludDE2TEUgPSBCUC53cml0ZVVJbnQxNkxFXG4gIGFyci53cml0ZVVJbnQxNkJFID0gQlAud3JpdGVVSW50MTZCRVxuICBhcnIud3JpdGVVSW50MzJMRSA9IEJQLndyaXRlVUludDMyTEVcbiAgYXJyLndyaXRlVUludDMyQkUgPSBCUC53cml0ZVVJbnQzMkJFXG4gIGFyci53cml0ZUludExFID0gQlAud3JpdGVJbnRMRVxuICBhcnIud3JpdGVJbnRCRSA9IEJQLndyaXRlSW50QkVcbiAgYXJyLndyaXRlSW50OCA9IEJQLndyaXRlSW50OFxuICBhcnIud3JpdGVJbnQxNkxFID0gQlAud3JpdGVJbnQxNkxFXG4gIGFyci53cml0ZUludDE2QkUgPSBCUC53cml0ZUludDE2QkVcbiAgYXJyLndyaXRlSW50MzJMRSA9IEJQLndyaXRlSW50MzJMRVxuICBhcnIud3JpdGVJbnQzMkJFID0gQlAud3JpdGVJbnQzMkJFXG4gIGFyci53cml0ZUZsb2F0TEUgPSBCUC53cml0ZUZsb2F0TEVcbiAgYXJyLndyaXRlRmxvYXRCRSA9IEJQLndyaXRlRmxvYXRCRVxuICBhcnIud3JpdGVEb3VibGVMRSA9IEJQLndyaXRlRG91YmxlTEVcbiAgYXJyLndyaXRlRG91YmxlQkUgPSBCUC53cml0ZURvdWJsZUJFXG4gIGFyci5maWxsID0gQlAuZmlsbFxuICBhcnIuaW5zcGVjdCA9IEJQLmluc3BlY3RcbiAgYXJyLnRvQXJyYXlCdWZmZXIgPSBCUC50b0FycmF5QnVmZmVyXG5cbiAgcmV0dXJuIGFyclxufVxuXG52YXIgSU5WQUxJRF9CQVNFNjRfUkUgPSAvW14rXFwvMC05QS16XFwtXS9nXG5cbmZ1bmN0aW9uIGJhc2U2NGNsZWFuIChzdHIpIHtcbiAgLy8gTm9kZSBzdHJpcHMgb3V0IGludmFsaWQgY2hhcmFjdGVycyBsaWtlIFxcbiBhbmQgXFx0IGZyb20gdGhlIHN0cmluZywgYmFzZTY0LWpzIGRvZXMgbm90XG4gIHN0ciA9IHN0cmluZ3RyaW0oc3RyKS5yZXBsYWNlKElOVkFMSURfQkFTRTY0X1JFLCAnJylcbiAgLy8gTm9kZSBjb252ZXJ0cyBzdHJpbmdzIHdpdGggbGVuZ3RoIDwgMiB0byAnJ1xuICBpZiAoc3RyLmxlbmd0aCA8IDIpIHJldHVybiAnJ1xuICAvLyBOb2RlIGFsbG93cyBmb3Igbm9uLXBhZGRlZCBiYXNlNjQgc3RyaW5ncyAobWlzc2luZyB0cmFpbGluZyA9PT0pLCBiYXNlNjQtanMgZG9lcyBub3RcbiAgd2hpbGUgKHN0ci5sZW5ndGggJSA0ICE9PSAwKSB7XG4gICAgc3RyID0gc3RyICsgJz0nXG4gIH1cbiAgcmV0dXJuIHN0clxufVxuXG5mdW5jdGlvbiBzdHJpbmd0cmltIChzdHIpIHtcbiAgaWYgKHN0ci50cmltKSByZXR1cm4gc3RyLnRyaW0oKVxuICByZXR1cm4gc3RyLnJlcGxhY2UoL15cXHMrfFxccyskL2csICcnKVxufVxuXG5mdW5jdGlvbiB0b0hleCAobikge1xuICBpZiAobiA8IDE2KSByZXR1cm4gJzAnICsgbi50b1N0cmluZygxNilcbiAgcmV0dXJuIG4udG9TdHJpbmcoMTYpXG59XG5cbmZ1bmN0aW9uIHV0ZjhUb0J5dGVzIChzdHJpbmcsIHVuaXRzKSB7XG4gIHVuaXRzID0gdW5pdHMgfHwgSW5maW5pdHlcbiAgdmFyIGNvZGVQb2ludFxuICB2YXIgbGVuZ3RoID0gc3RyaW5nLmxlbmd0aFxuICB2YXIgbGVhZFN1cnJvZ2F0ZSA9IG51bGxcbiAgdmFyIGJ5dGVzID0gW11cbiAgdmFyIGkgPSAwXG5cbiAgZm9yICg7IGkgPCBsZW5ndGg7IGkrKykge1xuICAgIGNvZGVQb2ludCA9IHN0cmluZy5jaGFyQ29kZUF0KGkpXG5cbiAgICAvLyBpcyBzdXJyb2dhdGUgY29tcG9uZW50XG4gICAgaWYgKGNvZGVQb2ludCA+IDB4RDdGRiAmJiBjb2RlUG9pbnQgPCAweEUwMDApIHtcbiAgICAgIC8vIGxhc3QgY2hhciB3YXMgYSBsZWFkXG4gICAgICBpZiAobGVhZFN1cnJvZ2F0ZSkge1xuICAgICAgICAvLyAyIGxlYWRzIGluIGEgcm93XG4gICAgICAgIGlmIChjb2RlUG9pbnQgPCAweERDMDApIHtcbiAgICAgICAgICBpZiAoKHVuaXRzIC09IDMpID4gLTEpIGJ5dGVzLnB1c2goMHhFRiwgMHhCRiwgMHhCRClcbiAgICAgICAgICBsZWFkU3Vycm9nYXRlID0gY29kZVBvaW50XG4gICAgICAgICAgY29udGludWVcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAvLyB2YWxpZCBzdXJyb2dhdGUgcGFpclxuICAgICAgICAgIGNvZGVQb2ludCA9IGxlYWRTdXJyb2dhdGUgLSAweEQ4MDAgPDwgMTAgfCBjb2RlUG9pbnQgLSAweERDMDAgfCAweDEwMDAwXG4gICAgICAgICAgbGVhZFN1cnJvZ2F0ZSA9IG51bGxcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgLy8gbm8gbGVhZCB5ZXRcblxuICAgICAgICBpZiAoY29kZVBvaW50ID4gMHhEQkZGKSB7XG4gICAgICAgICAgLy8gdW5leHBlY3RlZCB0cmFpbFxuICAgICAgICAgIGlmICgodW5pdHMgLT0gMykgPiAtMSkgYnl0ZXMucHVzaCgweEVGLCAweEJGLCAweEJEKVxuICAgICAgICAgIGNvbnRpbnVlXG4gICAgICAgIH0gZWxzZSBpZiAoaSArIDEgPT09IGxlbmd0aCkge1xuICAgICAgICAgIC8vIHVucGFpcmVkIGxlYWRcbiAgICAgICAgICBpZiAoKHVuaXRzIC09IDMpID4gLTEpIGJ5dGVzLnB1c2goMHhFRiwgMHhCRiwgMHhCRClcbiAgICAgICAgICBjb250aW51ZVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIC8vIHZhbGlkIGxlYWRcbiAgICAgICAgICBsZWFkU3Vycm9nYXRlID0gY29kZVBvaW50XG4gICAgICAgICAgY29udGludWVcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0gZWxzZSBpZiAobGVhZFN1cnJvZ2F0ZSkge1xuICAgICAgLy8gdmFsaWQgYm1wIGNoYXIsIGJ1dCBsYXN0IGNoYXIgd2FzIGEgbGVhZFxuICAgICAgaWYgKCh1bml0cyAtPSAzKSA+IC0xKSBieXRlcy5wdXNoKDB4RUYsIDB4QkYsIDB4QkQpXG4gICAgICBsZWFkU3Vycm9nYXRlID0gbnVsbFxuICAgIH1cblxuICAgIC8vIGVuY29kZSB1dGY4XG4gICAgaWYgKGNvZGVQb2ludCA8IDB4ODApIHtcbiAgICAgIGlmICgodW5pdHMgLT0gMSkgPCAwKSBicmVha1xuICAgICAgYnl0ZXMucHVzaChjb2RlUG9pbnQpXG4gICAgfSBlbHNlIGlmIChjb2RlUG9pbnQgPCAweDgwMCkge1xuICAgICAgaWYgKCh1bml0cyAtPSAyKSA8IDApIGJyZWFrXG4gICAgICBieXRlcy5wdXNoKFxuICAgICAgICBjb2RlUG9pbnQgPj4gMHg2IHwgMHhDMCxcbiAgICAgICAgY29kZVBvaW50ICYgMHgzRiB8IDB4ODBcbiAgICAgIClcbiAgICB9IGVsc2UgaWYgKGNvZGVQb2ludCA8IDB4MTAwMDApIHtcbiAgICAgIGlmICgodW5pdHMgLT0gMykgPCAwKSBicmVha1xuICAgICAgYnl0ZXMucHVzaChcbiAgICAgICAgY29kZVBvaW50ID4+IDB4QyB8IDB4RTAsXG4gICAgICAgIGNvZGVQb2ludCA+PiAweDYgJiAweDNGIHwgMHg4MCxcbiAgICAgICAgY29kZVBvaW50ICYgMHgzRiB8IDB4ODBcbiAgICAgIClcbiAgICB9IGVsc2UgaWYgKGNvZGVQb2ludCA8IDB4MjAwMDAwKSB7XG4gICAgICBpZiAoKHVuaXRzIC09IDQpIDwgMCkgYnJlYWtcbiAgICAgIGJ5dGVzLnB1c2goXG4gICAgICAgIGNvZGVQb2ludCA+PiAweDEyIHwgMHhGMCxcbiAgICAgICAgY29kZVBvaW50ID4+IDB4QyAmIDB4M0YgfCAweDgwLFxuICAgICAgICBjb2RlUG9pbnQgPj4gMHg2ICYgMHgzRiB8IDB4ODAsXG4gICAgICAgIGNvZGVQb2ludCAmIDB4M0YgfCAweDgwXG4gICAgICApXG4gICAgfSBlbHNlIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignSW52YWxpZCBjb2RlIHBvaW50JylcbiAgICB9XG4gIH1cblxuICByZXR1cm4gYnl0ZXNcbn1cblxuZnVuY3Rpb24gYXNjaWlUb0J5dGVzIChzdHIpIHtcbiAgdmFyIGJ5dGVBcnJheSA9IFtdXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgc3RyLmxlbmd0aDsgaSsrKSB7XG4gICAgLy8gTm9kZSdzIGNvZGUgc2VlbXMgdG8gYmUgZG9pbmcgdGhpcyBhbmQgbm90ICYgMHg3Ri4uXG4gICAgYnl0ZUFycmF5LnB1c2goc3RyLmNoYXJDb2RlQXQoaSkgJiAweEZGKVxuICB9XG4gIHJldHVybiBieXRlQXJyYXlcbn1cblxuZnVuY3Rpb24gdXRmMTZsZVRvQnl0ZXMgKHN0ciwgdW5pdHMpIHtcbiAgdmFyIGMsIGhpLCBsb1xuICB2YXIgYnl0ZUFycmF5ID0gW11cbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBzdHIubGVuZ3RoOyBpKyspIHtcbiAgICBpZiAoKHVuaXRzIC09IDIpIDwgMCkgYnJlYWtcblxuICAgIGMgPSBzdHIuY2hhckNvZGVBdChpKVxuICAgIGhpID0gYyA+PiA4XG4gICAgbG8gPSBjICUgMjU2XG4gICAgYnl0ZUFycmF5LnB1c2gobG8pXG4gICAgYnl0ZUFycmF5LnB1c2goaGkpXG4gIH1cblxuICByZXR1cm4gYnl0ZUFycmF5XG59XG5cbmZ1bmN0aW9uIGJhc2U2NFRvQnl0ZXMgKHN0cikge1xuICByZXR1cm4gYmFzZTY0LnRvQnl0ZUFycmF5KGJhc2U2NGNsZWFuKHN0cikpXG59XG5cbmZ1bmN0aW9uIGJsaXRCdWZmZXIgKHNyYywgZHN0LCBvZmZzZXQsIGxlbmd0aCkge1xuICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbmd0aDsgaSsrKSB7XG4gICAgaWYgKChpICsgb2Zmc2V0ID49IGRzdC5sZW5ndGgpIHx8IChpID49IHNyYy5sZW5ndGgpKSBicmVha1xuICAgIGRzdFtpICsgb2Zmc2V0XSA9IHNyY1tpXVxuICB9XG4gIHJldHVybiBpXG59XG5cbmZ1bmN0aW9uIGRlY29kZVV0ZjhDaGFyIChzdHIpIHtcbiAgdHJ5IHtcbiAgICByZXR1cm4gZGVjb2RlVVJJQ29tcG9uZW50KHN0cilcbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgcmV0dXJuIFN0cmluZy5mcm9tQ2hhckNvZGUoMHhGRkZEKSAvLyBVVEYgOCBpbnZhbGlkIGNoYXJcbiAgfVxufVxuIiwidmFyIGxvb2t1cCA9ICdBQkNERUZHSElKS0xNTk9QUVJTVFVWV1hZWmFiY2RlZmdoaWprbG1ub3BxcnN0dXZ3eHl6MDEyMzQ1Njc4OSsvJztcblxuOyhmdW5jdGlvbiAoZXhwb3J0cykge1xuXHQndXNlIHN0cmljdCc7XG5cbiAgdmFyIEFyciA9ICh0eXBlb2YgVWludDhBcnJheSAhPT0gJ3VuZGVmaW5lZCcpXG4gICAgPyBVaW50OEFycmF5XG4gICAgOiBBcnJheVxuXG5cdHZhciBQTFVTICAgPSAnKycuY2hhckNvZGVBdCgwKVxuXHR2YXIgU0xBU0ggID0gJy8nLmNoYXJDb2RlQXQoMClcblx0dmFyIE5VTUJFUiA9ICcwJy5jaGFyQ29kZUF0KDApXG5cdHZhciBMT1dFUiAgPSAnYScuY2hhckNvZGVBdCgwKVxuXHR2YXIgVVBQRVIgID0gJ0EnLmNoYXJDb2RlQXQoMClcblx0dmFyIFBMVVNfVVJMX1NBRkUgPSAnLScuY2hhckNvZGVBdCgwKVxuXHR2YXIgU0xBU0hfVVJMX1NBRkUgPSAnXycuY2hhckNvZGVBdCgwKVxuXG5cdGZ1bmN0aW9uIGRlY29kZSAoZWx0KSB7XG5cdFx0dmFyIGNvZGUgPSBlbHQuY2hhckNvZGVBdCgwKVxuXHRcdGlmIChjb2RlID09PSBQTFVTIHx8XG5cdFx0ICAgIGNvZGUgPT09IFBMVVNfVVJMX1NBRkUpXG5cdFx0XHRyZXR1cm4gNjIgLy8gJysnXG5cdFx0aWYgKGNvZGUgPT09IFNMQVNIIHx8XG5cdFx0ICAgIGNvZGUgPT09IFNMQVNIX1VSTF9TQUZFKVxuXHRcdFx0cmV0dXJuIDYzIC8vICcvJ1xuXHRcdGlmIChjb2RlIDwgTlVNQkVSKVxuXHRcdFx0cmV0dXJuIC0xIC8vbm8gbWF0Y2hcblx0XHRpZiAoY29kZSA8IE5VTUJFUiArIDEwKVxuXHRcdFx0cmV0dXJuIGNvZGUgLSBOVU1CRVIgKyAyNiArIDI2XG5cdFx0aWYgKGNvZGUgPCBVUFBFUiArIDI2KVxuXHRcdFx0cmV0dXJuIGNvZGUgLSBVUFBFUlxuXHRcdGlmIChjb2RlIDwgTE9XRVIgKyAyNilcblx0XHRcdHJldHVybiBjb2RlIC0gTE9XRVIgKyAyNlxuXHR9XG5cblx0ZnVuY3Rpb24gYjY0VG9CeXRlQXJyYXkgKGI2NCkge1xuXHRcdHZhciBpLCBqLCBsLCB0bXAsIHBsYWNlSG9sZGVycywgYXJyXG5cblx0XHRpZiAoYjY0Lmxlbmd0aCAlIDQgPiAwKSB7XG5cdFx0XHR0aHJvdyBuZXcgRXJyb3IoJ0ludmFsaWQgc3RyaW5nLiBMZW5ndGggbXVzdCBiZSBhIG11bHRpcGxlIG9mIDQnKVxuXHRcdH1cblxuXHRcdC8vIHRoZSBudW1iZXIgb2YgZXF1YWwgc2lnbnMgKHBsYWNlIGhvbGRlcnMpXG5cdFx0Ly8gaWYgdGhlcmUgYXJlIHR3byBwbGFjZWhvbGRlcnMsIHRoYW4gdGhlIHR3byBjaGFyYWN0ZXJzIGJlZm9yZSBpdFxuXHRcdC8vIHJlcHJlc2VudCBvbmUgYnl0ZVxuXHRcdC8vIGlmIHRoZXJlIGlzIG9ubHkgb25lLCB0aGVuIHRoZSB0aHJlZSBjaGFyYWN0ZXJzIGJlZm9yZSBpdCByZXByZXNlbnQgMiBieXRlc1xuXHRcdC8vIHRoaXMgaXMganVzdCBhIGNoZWFwIGhhY2sgdG8gbm90IGRvIGluZGV4T2YgdHdpY2Vcblx0XHR2YXIgbGVuID0gYjY0Lmxlbmd0aFxuXHRcdHBsYWNlSG9sZGVycyA9ICc9JyA9PT0gYjY0LmNoYXJBdChsZW4gLSAyKSA/IDIgOiAnPScgPT09IGI2NC5jaGFyQXQobGVuIC0gMSkgPyAxIDogMFxuXG5cdFx0Ly8gYmFzZTY0IGlzIDQvMyArIHVwIHRvIHR3byBjaGFyYWN0ZXJzIG9mIHRoZSBvcmlnaW5hbCBkYXRhXG5cdFx0YXJyID0gbmV3IEFycihiNjQubGVuZ3RoICogMyAvIDQgLSBwbGFjZUhvbGRlcnMpXG5cblx0XHQvLyBpZiB0aGVyZSBhcmUgcGxhY2Vob2xkZXJzLCBvbmx5IGdldCB1cCB0byB0aGUgbGFzdCBjb21wbGV0ZSA0IGNoYXJzXG5cdFx0bCA9IHBsYWNlSG9sZGVycyA+IDAgPyBiNjQubGVuZ3RoIC0gNCA6IGI2NC5sZW5ndGhcblxuXHRcdHZhciBMID0gMFxuXG5cdFx0ZnVuY3Rpb24gcHVzaCAodikge1xuXHRcdFx0YXJyW0wrK10gPSB2XG5cdFx0fVxuXG5cdFx0Zm9yIChpID0gMCwgaiA9IDA7IGkgPCBsOyBpICs9IDQsIGogKz0gMykge1xuXHRcdFx0dG1wID0gKGRlY29kZShiNjQuY2hhckF0KGkpKSA8PCAxOCkgfCAoZGVjb2RlKGI2NC5jaGFyQXQoaSArIDEpKSA8PCAxMikgfCAoZGVjb2RlKGI2NC5jaGFyQXQoaSArIDIpKSA8PCA2KSB8IGRlY29kZShiNjQuY2hhckF0KGkgKyAzKSlcblx0XHRcdHB1c2goKHRtcCAmIDB4RkYwMDAwKSA+PiAxNilcblx0XHRcdHB1c2goKHRtcCAmIDB4RkYwMCkgPj4gOClcblx0XHRcdHB1c2godG1wICYgMHhGRilcblx0XHR9XG5cblx0XHRpZiAocGxhY2VIb2xkZXJzID09PSAyKSB7XG5cdFx0XHR0bXAgPSAoZGVjb2RlKGI2NC5jaGFyQXQoaSkpIDw8IDIpIHwgKGRlY29kZShiNjQuY2hhckF0KGkgKyAxKSkgPj4gNClcblx0XHRcdHB1c2godG1wICYgMHhGRilcblx0XHR9IGVsc2UgaWYgKHBsYWNlSG9sZGVycyA9PT0gMSkge1xuXHRcdFx0dG1wID0gKGRlY29kZShiNjQuY2hhckF0KGkpKSA8PCAxMCkgfCAoZGVjb2RlKGI2NC5jaGFyQXQoaSArIDEpKSA8PCA0KSB8IChkZWNvZGUoYjY0LmNoYXJBdChpICsgMikpID4+IDIpXG5cdFx0XHRwdXNoKCh0bXAgPj4gOCkgJiAweEZGKVxuXHRcdFx0cHVzaCh0bXAgJiAweEZGKVxuXHRcdH1cblxuXHRcdHJldHVybiBhcnJcblx0fVxuXG5cdGZ1bmN0aW9uIHVpbnQ4VG9CYXNlNjQgKHVpbnQ4KSB7XG5cdFx0dmFyIGksXG5cdFx0XHRleHRyYUJ5dGVzID0gdWludDgubGVuZ3RoICUgMywgLy8gaWYgd2UgaGF2ZSAxIGJ5dGUgbGVmdCwgcGFkIDIgYnl0ZXNcblx0XHRcdG91dHB1dCA9IFwiXCIsXG5cdFx0XHR0ZW1wLCBsZW5ndGhcblxuXHRcdGZ1bmN0aW9uIGVuY29kZSAobnVtKSB7XG5cdFx0XHRyZXR1cm4gbG9va3VwLmNoYXJBdChudW0pXG5cdFx0fVxuXG5cdFx0ZnVuY3Rpb24gdHJpcGxldFRvQmFzZTY0IChudW0pIHtcblx0XHRcdHJldHVybiBlbmNvZGUobnVtID4+IDE4ICYgMHgzRikgKyBlbmNvZGUobnVtID4+IDEyICYgMHgzRikgKyBlbmNvZGUobnVtID4+IDYgJiAweDNGKSArIGVuY29kZShudW0gJiAweDNGKVxuXHRcdH1cblxuXHRcdC8vIGdvIHRocm91Z2ggdGhlIGFycmF5IGV2ZXJ5IHRocmVlIGJ5dGVzLCB3ZSdsbCBkZWFsIHdpdGggdHJhaWxpbmcgc3R1ZmYgbGF0ZXJcblx0XHRmb3IgKGkgPSAwLCBsZW5ndGggPSB1aW50OC5sZW5ndGggLSBleHRyYUJ5dGVzOyBpIDwgbGVuZ3RoOyBpICs9IDMpIHtcblx0XHRcdHRlbXAgPSAodWludDhbaV0gPDwgMTYpICsgKHVpbnQ4W2kgKyAxXSA8PCA4KSArICh1aW50OFtpICsgMl0pXG5cdFx0XHRvdXRwdXQgKz0gdHJpcGxldFRvQmFzZTY0KHRlbXApXG5cdFx0fVxuXG5cdFx0Ly8gcGFkIHRoZSBlbmQgd2l0aCB6ZXJvcywgYnV0IG1ha2Ugc3VyZSB0byBub3QgZm9yZ2V0IHRoZSBleHRyYSBieXRlc1xuXHRcdHN3aXRjaCAoZXh0cmFCeXRlcykge1xuXHRcdFx0Y2FzZSAxOlxuXHRcdFx0XHR0ZW1wID0gdWludDhbdWludDgubGVuZ3RoIC0gMV1cblx0XHRcdFx0b3V0cHV0ICs9IGVuY29kZSh0ZW1wID4+IDIpXG5cdFx0XHRcdG91dHB1dCArPSBlbmNvZGUoKHRlbXAgPDwgNCkgJiAweDNGKVxuXHRcdFx0XHRvdXRwdXQgKz0gJz09J1xuXHRcdFx0XHRicmVha1xuXHRcdFx0Y2FzZSAyOlxuXHRcdFx0XHR0ZW1wID0gKHVpbnQ4W3VpbnQ4Lmxlbmd0aCAtIDJdIDw8IDgpICsgKHVpbnQ4W3VpbnQ4Lmxlbmd0aCAtIDFdKVxuXHRcdFx0XHRvdXRwdXQgKz0gZW5jb2RlKHRlbXAgPj4gMTApXG5cdFx0XHRcdG91dHB1dCArPSBlbmNvZGUoKHRlbXAgPj4gNCkgJiAweDNGKVxuXHRcdFx0XHRvdXRwdXQgKz0gZW5jb2RlKCh0ZW1wIDw8IDIpICYgMHgzRilcblx0XHRcdFx0b3V0cHV0ICs9ICc9J1xuXHRcdFx0XHRicmVha1xuXHRcdH1cblxuXHRcdHJldHVybiBvdXRwdXRcblx0fVxuXG5cdGV4cG9ydHMudG9CeXRlQXJyYXkgPSBiNjRUb0J5dGVBcnJheVxuXHRleHBvcnRzLmZyb21CeXRlQXJyYXkgPSB1aW50OFRvQmFzZTY0XG59KHR5cGVvZiBleHBvcnRzID09PSAndW5kZWZpbmVkJyA/ICh0aGlzLmJhc2U2NGpzID0ge30pIDogZXhwb3J0cykpXG4iLCJleHBvcnRzLnJlYWQgPSBmdW5jdGlvbiAoYnVmZmVyLCBvZmZzZXQsIGlzTEUsIG1MZW4sIG5CeXRlcykge1xuICB2YXIgZSwgbVxuICB2YXIgZUxlbiA9IG5CeXRlcyAqIDggLSBtTGVuIC0gMVxuICB2YXIgZU1heCA9ICgxIDw8IGVMZW4pIC0gMVxuICB2YXIgZUJpYXMgPSBlTWF4ID4+IDFcbiAgdmFyIG5CaXRzID0gLTdcbiAgdmFyIGkgPSBpc0xFID8gKG5CeXRlcyAtIDEpIDogMFxuICB2YXIgZCA9IGlzTEUgPyAtMSA6IDFcbiAgdmFyIHMgPSBidWZmZXJbb2Zmc2V0ICsgaV1cblxuICBpICs9IGRcblxuICBlID0gcyAmICgoMSA8PCAoLW5CaXRzKSkgLSAxKVxuICBzID4+PSAoLW5CaXRzKVxuICBuQml0cyArPSBlTGVuXG4gIGZvciAoOyBuQml0cyA+IDA7IGUgPSBlICogMjU2ICsgYnVmZmVyW29mZnNldCArIGldLCBpICs9IGQsIG5CaXRzIC09IDgpIHt9XG5cbiAgbSA9IGUgJiAoKDEgPDwgKC1uQml0cykpIC0gMSlcbiAgZSA+Pj0gKC1uQml0cylcbiAgbkJpdHMgKz0gbUxlblxuICBmb3IgKDsgbkJpdHMgPiAwOyBtID0gbSAqIDI1NiArIGJ1ZmZlcltvZmZzZXQgKyBpXSwgaSArPSBkLCBuQml0cyAtPSA4KSB7fVxuXG4gIGlmIChlID09PSAwKSB7XG4gICAgZSA9IDEgLSBlQmlhc1xuICB9IGVsc2UgaWYgKGUgPT09IGVNYXgpIHtcbiAgICByZXR1cm4gbSA/IE5hTiA6ICgocyA/IC0xIDogMSkgKiBJbmZpbml0eSlcbiAgfSBlbHNlIHtcbiAgICBtID0gbSArIE1hdGgucG93KDIsIG1MZW4pXG4gICAgZSA9IGUgLSBlQmlhc1xuICB9XG4gIHJldHVybiAocyA/IC0xIDogMSkgKiBtICogTWF0aC5wb3coMiwgZSAtIG1MZW4pXG59XG5cbmV4cG9ydHMud3JpdGUgPSBmdW5jdGlvbiAoYnVmZmVyLCB2YWx1ZSwgb2Zmc2V0LCBpc0xFLCBtTGVuLCBuQnl0ZXMpIHtcbiAgdmFyIGUsIG0sIGNcbiAgdmFyIGVMZW4gPSBuQnl0ZXMgKiA4IC0gbUxlbiAtIDFcbiAgdmFyIGVNYXggPSAoMSA8PCBlTGVuKSAtIDFcbiAgdmFyIGVCaWFzID0gZU1heCA+PiAxXG4gIHZhciBydCA9IChtTGVuID09PSAyMyA/IE1hdGgucG93KDIsIC0yNCkgLSBNYXRoLnBvdygyLCAtNzcpIDogMClcbiAgdmFyIGkgPSBpc0xFID8gMCA6IChuQnl0ZXMgLSAxKVxuICB2YXIgZCA9IGlzTEUgPyAxIDogLTFcbiAgdmFyIHMgPSB2YWx1ZSA8IDAgfHwgKHZhbHVlID09PSAwICYmIDEgLyB2YWx1ZSA8IDApID8gMSA6IDBcblxuICB2YWx1ZSA9IE1hdGguYWJzKHZhbHVlKVxuXG4gIGlmIChpc05hTih2YWx1ZSkgfHwgdmFsdWUgPT09IEluZmluaXR5KSB7XG4gICAgbSA9IGlzTmFOKHZhbHVlKSA/IDEgOiAwXG4gICAgZSA9IGVNYXhcbiAgfSBlbHNlIHtcbiAgICBlID0gTWF0aC5mbG9vcihNYXRoLmxvZyh2YWx1ZSkgLyBNYXRoLkxOMilcbiAgICBpZiAodmFsdWUgKiAoYyA9IE1hdGgucG93KDIsIC1lKSkgPCAxKSB7XG4gICAgICBlLS1cbiAgICAgIGMgKj0gMlxuICAgIH1cbiAgICBpZiAoZSArIGVCaWFzID49IDEpIHtcbiAgICAgIHZhbHVlICs9IHJ0IC8gY1xuICAgIH0gZWxzZSB7XG4gICAgICB2YWx1ZSArPSBydCAqIE1hdGgucG93KDIsIDEgLSBlQmlhcylcbiAgICB9XG4gICAgaWYgKHZhbHVlICogYyA+PSAyKSB7XG4gICAgICBlKytcbiAgICAgIGMgLz0gMlxuICAgIH1cblxuICAgIGlmIChlICsgZUJpYXMgPj0gZU1heCkge1xuICAgICAgbSA9IDBcbiAgICAgIGUgPSBlTWF4XG4gICAgfSBlbHNlIGlmIChlICsgZUJpYXMgPj0gMSkge1xuICAgICAgbSA9ICh2YWx1ZSAqIGMgLSAxKSAqIE1hdGgucG93KDIsIG1MZW4pXG4gICAgICBlID0gZSArIGVCaWFzXG4gICAgfSBlbHNlIHtcbiAgICAgIG0gPSB2YWx1ZSAqIE1hdGgucG93KDIsIGVCaWFzIC0gMSkgKiBNYXRoLnBvdygyLCBtTGVuKVxuICAgICAgZSA9IDBcbiAgICB9XG4gIH1cblxuICBmb3IgKDsgbUxlbiA+PSA4OyBidWZmZXJbb2Zmc2V0ICsgaV0gPSBtICYgMHhmZiwgaSArPSBkLCBtIC89IDI1NiwgbUxlbiAtPSA4KSB7fVxuXG4gIGUgPSAoZSA8PCBtTGVuKSB8IG1cbiAgZUxlbiArPSBtTGVuXG4gIGZvciAoOyBlTGVuID4gMDsgYnVmZmVyW29mZnNldCArIGldID0gZSAmIDB4ZmYsIGkgKz0gZCwgZSAvPSAyNTYsIGVMZW4gLT0gOCkge31cblxuICBidWZmZXJbb2Zmc2V0ICsgaSAtIGRdIHw9IHMgKiAxMjhcbn1cbiIsIlxuLyoqXG4gKiBpc0FycmF5XG4gKi9cblxudmFyIGlzQXJyYXkgPSBBcnJheS5pc0FycmF5O1xuXG4vKipcbiAqIHRvU3RyaW5nXG4gKi9cblxudmFyIHN0ciA9IE9iamVjdC5wcm90b3R5cGUudG9TdHJpbmc7XG5cbi8qKlxuICogV2hldGhlciBvciBub3QgdGhlIGdpdmVuIGB2YWxgXG4gKiBpcyBhbiBhcnJheS5cbiAqXG4gKiBleGFtcGxlOlxuICpcbiAqICAgICAgICBpc0FycmF5KFtdKTtcbiAqICAgICAgICAvLyA+IHRydWVcbiAqICAgICAgICBpc0FycmF5KGFyZ3VtZW50cyk7XG4gKiAgICAgICAgLy8gPiBmYWxzZVxuICogICAgICAgIGlzQXJyYXkoJycpO1xuICogICAgICAgIC8vID4gZmFsc2VcbiAqXG4gKiBAcGFyYW0ge21peGVkfSB2YWxcbiAqIEByZXR1cm4ge2Jvb2x9XG4gKi9cblxubW9kdWxlLmV4cG9ydHMgPSBpc0FycmF5IHx8IGZ1bmN0aW9uICh2YWwpIHtcbiAgcmV0dXJuICEhIHZhbCAmJiAnW29iamVjdCBBcnJheV0nID09IHN0ci5jYWxsKHZhbCk7XG59O1xuIiwiLy8gc2hpbSBmb3IgdXNpbmcgcHJvY2VzcyBpbiBicm93c2VyXG5cbnZhciBwcm9jZXNzID0gbW9kdWxlLmV4cG9ydHMgPSB7fTtcbnZhciBxdWV1ZSA9IFtdO1xudmFyIGRyYWluaW5nID0gZmFsc2U7XG52YXIgY3VycmVudFF1ZXVlO1xudmFyIHF1ZXVlSW5kZXggPSAtMTtcblxuZnVuY3Rpb24gY2xlYW5VcE5leHRUaWNrKCkge1xuICAgIGRyYWluaW5nID0gZmFsc2U7XG4gICAgaWYgKGN1cnJlbnRRdWV1ZS5sZW5ndGgpIHtcbiAgICAgICAgcXVldWUgPSBjdXJyZW50UXVldWUuY29uY2F0KHF1ZXVlKTtcbiAgICB9IGVsc2Uge1xuICAgICAgICBxdWV1ZUluZGV4ID0gLTE7XG4gICAgfVxuICAgIGlmIChxdWV1ZS5sZW5ndGgpIHtcbiAgICAgICAgZHJhaW5RdWV1ZSgpO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gZHJhaW5RdWV1ZSgpIHtcbiAgICBpZiAoZHJhaW5pbmcpIHtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB2YXIgdGltZW91dCA9IHNldFRpbWVvdXQoY2xlYW5VcE5leHRUaWNrKTtcbiAgICBkcmFpbmluZyA9IHRydWU7XG5cbiAgICB2YXIgbGVuID0gcXVldWUubGVuZ3RoO1xuICAgIHdoaWxlKGxlbikge1xuICAgICAgICBjdXJyZW50UXVldWUgPSBxdWV1ZTtcbiAgICAgICAgcXVldWUgPSBbXTtcbiAgICAgICAgd2hpbGUgKCsrcXVldWVJbmRleCA8IGxlbikge1xuICAgICAgICAgICAgY3VycmVudFF1ZXVlW3F1ZXVlSW5kZXhdLnJ1bigpO1xuICAgICAgICB9XG4gICAgICAgIHF1ZXVlSW5kZXggPSAtMTtcbiAgICAgICAgbGVuID0gcXVldWUubGVuZ3RoO1xuICAgIH1cbiAgICBjdXJyZW50UXVldWUgPSBudWxsO1xuICAgIGRyYWluaW5nID0gZmFsc2U7XG4gICAgY2xlYXJUaW1lb3V0KHRpbWVvdXQpO1xufVxuXG5wcm9jZXNzLm5leHRUaWNrID0gZnVuY3Rpb24gKGZ1bikge1xuICAgIHZhciBhcmdzID0gbmV3IEFycmF5KGFyZ3VtZW50cy5sZW5ndGggLSAxKTtcbiAgICBpZiAoYXJndW1lbnRzLmxlbmd0aCA+IDEpIHtcbiAgICAgICAgZm9yICh2YXIgaSA9IDE7IGkgPCBhcmd1bWVudHMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIGFyZ3NbaSAtIDFdID0gYXJndW1lbnRzW2ldO1xuICAgICAgICB9XG4gICAgfVxuICAgIHF1ZXVlLnB1c2gobmV3IEl0ZW0oZnVuLCBhcmdzKSk7XG4gICAgaWYgKHF1ZXVlLmxlbmd0aCA9PT0gMSAmJiAhZHJhaW5pbmcpIHtcbiAgICAgICAgc2V0VGltZW91dChkcmFpblF1ZXVlLCAwKTtcbiAgICB9XG59O1xuXG4vLyB2OCBsaWtlcyBwcmVkaWN0aWJsZSBvYmplY3RzXG5mdW5jdGlvbiBJdGVtKGZ1biwgYXJyYXkpIHtcbiAgICB0aGlzLmZ1biA9IGZ1bjtcbiAgICB0aGlzLmFycmF5ID0gYXJyYXk7XG59XG5JdGVtLnByb3RvdHlwZS5ydW4gPSBmdW5jdGlvbiAoKSB7XG4gICAgdGhpcy5mdW4uYXBwbHkobnVsbCwgdGhpcy5hcnJheSk7XG59O1xucHJvY2Vzcy50aXRsZSA9ICdicm93c2VyJztcbnByb2Nlc3MuYnJvd3NlciA9IHRydWU7XG5wcm9jZXNzLmVudiA9IHt9O1xucHJvY2Vzcy5hcmd2ID0gW107XG5wcm9jZXNzLnZlcnNpb24gPSAnJzsgLy8gZW1wdHkgc3RyaW5nIHRvIGF2b2lkIHJlZ2V4cCBpc3N1ZXNcbnByb2Nlc3MudmVyc2lvbnMgPSB7fTtcblxuZnVuY3Rpb24gbm9vcCgpIHt9XG5cbnByb2Nlc3Mub24gPSBub29wO1xucHJvY2Vzcy5hZGRMaXN0ZW5lciA9IG5vb3A7XG5wcm9jZXNzLm9uY2UgPSBub29wO1xucHJvY2Vzcy5vZmYgPSBub29wO1xucHJvY2Vzcy5yZW1vdmVMaXN0ZW5lciA9IG5vb3A7XG5wcm9jZXNzLnJlbW92ZUFsbExpc3RlbmVycyA9IG5vb3A7XG5wcm9jZXNzLmVtaXQgPSBub29wO1xuXG5wcm9jZXNzLmJpbmRpbmcgPSBmdW5jdGlvbiAobmFtZSkge1xuICAgIHRocm93IG5ldyBFcnJvcigncHJvY2Vzcy5iaW5kaW5nIGlzIG5vdCBzdXBwb3J0ZWQnKTtcbn07XG5cbi8vIFRPRE8oc2h0eWxtYW4pXG5wcm9jZXNzLmN3ZCA9IGZ1bmN0aW9uICgpIHsgcmV0dXJuICcvJyB9O1xucHJvY2Vzcy5jaGRpciA9IGZ1bmN0aW9uIChkaXIpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ3Byb2Nlc3MuY2hkaXIgaXMgbm90IHN1cHBvcnRlZCcpO1xufTtcbnByb2Nlc3MudW1hc2sgPSBmdW5jdGlvbigpIHsgcmV0dXJuIDA7IH07XG4iLCJ2YXIgVXRpbHMgPSByZXF1aXJlKFwiLi9VdGlscy5qc1wiKTtcclxuXHJcbnZhciBDT05GSUcgPSBcclxue1xyXG5cdHRpbWVvdXRzIDogLy8gaW4gc2Vjb25kc1xyXG5cdHtcclxuXHRcdGRldmljZVRpbWVvdXQgOiA2MCo1LFxyXG5cdFx0YW5pbWF0aW9uRnJhbWUgOiBVdGlscy5tb2JpbGVBbmRUYWJsZXRDaGVjaygpID8gMC40IDogMC4xLFxyXG5cdFx0Z3BzTG9jYXRpb25EZWJ1Z1Nob3cgOiA0LFx0XHQvLyB0aW1lIHRvIHNob3cgZ3BzIGxvY2F0aW9uIChkZWJ1ZykgaW5mb1xyXG5cdFx0c3RyZWFtRGF0YUludGVydmFsIDogMTAgXHRcdC8qIE5PUk1BTCAxMCBzZWNvbmRzICovXHJcblx0fSxcclxuXHRkaXN0YW5jZXMgOiAvLyBpbiBtXHJcblx0e1xyXG5cdFx0c3RheU9uUm9hZFRvbGVyYW5jZSA6IDUwMCxcdC8vIDUwMG0gc3RheSBvbiByb2FkIHRvbGVyYW5jZVxyXG5cdFx0ZWxhcHNlZERpcmVjdGlvbkVwc2lsb24gOiA1MDAgLy8gNTAwbSBkaXJlY3Rpb24gdG9sZXJhbmNlLCB0b28gZmFzdCBtb3ZlbWVudCB3aWxsIGRpc2NhcmQgXHJcblx0fSxcclxuXHRjb25zdHJhaW50cyA6IHtcclxuXHRcdGJhY2t3YXJkc0Vwc2lsb25Jbk1ldGVyIDogNDAwLCAvLzIyMCBtIG1vdmVtZW50IGluIHRoZSBiYWNrd2FyZCBkaXJlY3Rpb24gd2lsbCBub3QgdHJpZ2dlciBuZXh0IHJ1biBjb3VudGVyIGluY3JlbWVudFx0XHRcclxuXHRcdG1heFNwZWVkIDogMjAsXHQvL2ttaFxyXG5cdFx0bWF4UGFydGljaXBhbnRTdGF0ZUhpc3RvcnkgOiAxMDAwLCAvLyBudW1iZXIgb2YgZWxlbWVudHNcclxuXHRcdHBvcHVwRW5zdXJlVmlzaWJsZVdpZHRoIDogMjAwLFxyXG5cdFx0cG9wdXBFbnN1cmVWaXNpYmxlSGVpZ2h0OiAxMjBcclxuXHR9LFxyXG5cdHNpbXVsYXRpb24gOiB7XHJcblx0XHRwaW5nSW50ZXJ2YWwgOiAxMCwgIC8vIGludGVydmFsIGluIHNlY29uZHMgdG8gcGluZyB3aXRoIGdwcyBkYXRhXHJcblx0XHRncHNJbmFjY3VyYWN5IDogNCwgLy84LCAgLy8gZXJyb3Igc2ltdWxhdGlvbiBpbiBNRVRFUiAobG9vayBtYXRoLmdwc0luYWNjdXJhY3ksIG1pbiAxLzIpXHJcblx0XHRzcGVlZENvZWYgOiAxMDBcclxuXHR9LFxyXG5cdHNldHRpbmdzIDoge1xyXG5cdFx0bm9NaWRkbGVXYXJlIDogMCwgXHQvLyBTS0lQIG1pZGRsZSB3YXJlIG5vZGUganMgYXBwXHJcblx0XHRub0ludGVycG9sYXRpb24gOiAwXHQvLyAxIC0+IG5vIGludGVycG9sYXRpb24gb25seSBwb2ludHNcclxuXHR9LFxyXG5cdG1hdGggOiB7XHJcblx0XHRwcm9qZWN0aW9uU2NhbGVZIDogMC43NSxcdFx0XHRcdC8vIFRPRE8gRVhQTEFJTiAocmVjdGFuZ2UgY3JlYXRpb24gaW4gd29ybGQgbWVyY2F0b3IgY29lZiB5IFxyXG5cdFx0Z3BzSW5hY2N1cmFjeSA6IDMwLFx0XHRcdFx0XHRcdCAvL1RPRE8gMTMgbWluID8gXHJcblx0XHRzcGVlZEFuZEFjY2VsZXJhdGlvbkF2ZXJhZ2VEZWdyZWUgOiAyLFx0Ly8gY2FsY3VsYXRpb24gYmFzZWQgb24gTiBzdGF0ZXMgKGF2ZXJhZ2UpIChNSU4gMilcclxuXHRcdGRpc3BsYXlEZWxheSA6IDM1LFx0XHRcdFx0XHRcdC8vIGRpc3BsYXkgZGVsYXkgaW4gU0VDT05EU1xyXG5cdFx0aW50ZXJwb2xhdGVHUFNBdmVyYWdlIDogMCAvLyBudW1iZXIgb2YgcmVjZW50IHZhbHVlcyB0byBjYWxjdWxhdGUgYXZlcmFnZSBncHMgZm9yIHBvc2l0aW9uIChzbW9vdGhpbmcgdGhlIGN1cnZlLm1pbiAwID0gTk8sMSA9IDIgdmFsdWVzIChjdXJyZW50IGFuZCBsYXN0KSlcclxuXHR9LFxyXG5cdGNvbnN0YW50cyA6IFxyXG5cdHtcclxuXHRcdGFnZUdyb3VwcyA6ICBcclxuXHRcdFtcclxuXHRcdCB7XHJcblx0XHRcdCBmcm9tIDogbnVsbCxcclxuXHRcdFx0IHRvIDogOCwgXHJcblx0XHRcdCBjb2RlIDogXCJGaXJzdEFnZUdyb3VwXCJcclxuXHRcdCB9XHJcblx0XHQgLHtcclxuXHRcdFx0IGZyb20gOiA4LFxyXG5cdFx0XHQgdG8gOiA0MCwgXHJcblx0XHRcdCBjb2RlIDogXCJNaWRkbGVBZ2VHcm91cFwiXHJcblx0XHQgfVxyXG5cdFx0ICx7XHJcblx0XHRcdCBmcm9tIDogNDAsXHJcblx0XHRcdCB0byA6IG51bGwsIFxyXG5cdFx0XHQgY29kZSA6IFwiTGFzdEFnZUdyb3VwXCJcclxuXHRcdCB9XHJcblx0XHRdXHJcblx0fSxcclxuXHJcblx0ZXZlbnQgOiB7XHJcblx0XHRiZWdpblRpbWVzdGFtcCA6IChuZXcgRGF0ZSgpKS5nZXRUaW1lKCksXHJcblx0XHRkdXJhdGlvbiA6IDYwLCAvL01JTlVURVNcclxuXHRcdGlkIDogM1xyXG5cdH0sXHJcblxyXG5cdHNlcnZlciA6IHtcclxuXHRcdHByZWZpeCA6IFwiL3RyaWF0aGxvbi9cIlxyXG5cdH0sXHJcblx0XHJcblx0YXBwZWFyYW5jZSA6IHtcclxuXHRcdGRlYnVnIDogMCxcclxuXHRcdHRyYWNrQ29sb3JTd2ltIDogJyM1Njc2ZmYnLFxyXG5cdFx0dHJhY2tDb2xvckJpa2UgOiAnI0UyMDA3NCcsXHJcblx0XHR0cmFja0NvbG9yUnVuIDogICcjMDc5ZjM2JyxcclxuXHJcblx0XHQvLyBOb3RlIHRoZSBzZXF1ZW5jZSBpcyBhbHdheXMgU3dpbS1CaWtlLVJ1biAtIHNvIDIgY2hhbmdlLXBvaW50c1xyXG5cdFx0Ly8gVE9ETyBSdW1lbiAtIGFkZCBzY2FsZSBoZXJlLCBub3QgaW4gU3R5bGVzLmpzXHJcblx0XHRpbWFnZVN0YXJ0IDogXCJpbWcvc3RhcnQucG5nXCIsXHJcblx0XHRpbWFnZUZpbmlzaCA6IFwiaW1nL2ZpbmlzaC5wbmdcIixcclxuXHRcdGltYWdlQ2FtIDogXCJpbWcvY2FtZXJhLnN2Z1wiLFxyXG5cdFx0aW1hZ2VDaGVja3BvaW50U3dpbUJpa2UgOiBcImltZy93ejEuc3ZnXCIsXHJcblx0XHRpbWFnZUNoZWNrcG9pbnRCaWtlUnVuIDogXCJpbWcvd3oyLnN2Z1wiLFxyXG5cdFx0aXNTaG93Q2hlY2twb2ludEltYWdlIDogZmFsc2UsIC8qIHNob3cgYW4gaW1hZ2Ugb24gdGhlIGNoZWNrcG9pbnRzIChlLmcgb24gdGhlIGNoYW5naW5nIFdaIHBvaW50cyAqL1xyXG5cdFx0aXNTaG93Q2hlY2twb2ludCA6IGZhbHNlLCAgLyogc2hvdyBhbiBzcXVhcmUgb24gdGhlIHNhbWUgY29sb3Igb24gdGhlIGNoZWNrcG9pbnRzLCBvbmx5IGlmIGlzU2hvd0NoZWNrcG9pbnRJbWFnZSBpcyBub3QgdHJ1ZSovXHJcblxyXG4gICAgICAgIC8vIHRoZSBkaXN0YW5jZSBiZXR3ZWVuIHRoZSBkaXJlY3Rpb24gaWNvbnMgLSBpbiBwaXhlbHMsXHJcbiAgICAgICAgLy8gaWYgc2V0IG5vbi1wb3NpdGl2ZSB2YWx1ZSAoMCBvciBsZXNzKSB0aGVuIGRvbid0IHNob3cgdGhlbSBhdCBhbGxcclxuXHRcdC8vZGlyZWN0aW9uSWNvbkJldHdlZW4gOiAyMDBcclxuXHRcdGRpcmVjdGlvbkljb25CZXR3ZWVuIDogLTFcclxuXHR9LFxyXG5cclxuICAgIGhvdHNwb3QgOiB7XHJcbiAgICAgICAgY2FtIDoge2ltYWdlIDpcImltZy9jYW1lcmEuc3ZnXCJ9LCAgLy8gdXNlIHRoZSBzYW1lIGltYWdlIGZvciBzdGF0aWMgY2FtZXJhcyBhcyBmb3IgdGhlIG1vdmluZyBvbmVzXHJcblx0XHRjYW1Td2ltQmlrZSA6IHtpbWFnZSA6IFwiaW1nL3d6MS5zdmdcIn0sXHJcblx0XHRjYW1CaWtlUnVuIDoge2ltYWdlIDogXCJpbWcvd3oyLnN2Z1wifSxcclxuICAgICAgICB3YXRlciA6IHtpbWFnZSA6IFwiaW1nL3dhdGVyLnN2Z1wifSxcclxuICAgICAgICB1dHVybiA6IHtpbWFnZSA6IFwiaW1nL3V0dXJuLnN2Z1wifSxcclxuXHJcblx0XHRrbTEwIDoge2ltYWdlIDogXCJpbWcvMTBrbS5zdmdcIiwgc2NhbGUgOiAxLjV9LFxyXG5cdFx0a20yMCA6IHtpbWFnZSA6IFwiaW1nLzIwa20uc3ZnXCIsIHNjYWxlIDogMS41fSxcclxuXHRcdGttMzAgOiB7aW1hZ2UgOiBcImltZy8zMGttLnN2Z1wiLCBzY2FsZSA6IDEuNX0sXHJcblx0XHRrbTQwIDoge2ltYWdlIDogXCJpbWcvNDBrbS5zdmdcIiwgc2NhbGUgOiAxLjV9LFxyXG5cdFx0a202MCA6IHtpbWFnZSA6IFwiaW1nLzYwa20uc3ZnXCIsIHNjYWxlIDogMS41fSxcclxuXHRcdGttODAgOiB7aW1hZ2UgOiBcImltZy84MGttLnN2Z1wiLCBzY2FsZSA6IDEuNX0sXHJcblx0XHRrbTEwMCA6IHtpbWFnZSA6IFwiaW1nLzEwMGttLnN2Z1wiLCBzY2FsZSA6IDEuNX0sXHJcblx0XHRrbTEyMCA6IHtpbWFnZSA6IFwiaW1nLzEyMGttLnN2Z1wiLCBzY2FsZSA6IDEuNX0sXHJcblx0XHRrbTE0MCA6IHtpbWFnZSA6IFwiaW1nLzE0MGttLnN2Z1wiLCBzY2FsZSA6IDEuNX0sXHJcblx0XHRrbTE2MCA6IHtpbWFnZSA6IFwiaW1nLzE2MGttLnN2Z1wiLCBzY2FsZSA6IDEuNX0sXHJcblx0XHRrbTE4MCA6IHtpbWFnZSA6IFwiaW1nLzE4MGttLnN2Z1wiLCBzY2FsZSA6IDEuNX1cclxuICAgIH1cclxufTtcclxuXHJcbmZvciAodmFyIGkgaW4gQ09ORklHKVxyXG5cdGV4cG9ydHNbaV09Q09ORklHW2ldO1xyXG4iLCJ2YXIgVXRpbHM9cmVxdWlyZSgnLi9VdGlscycpO1xyXG52YXIgU1RZTEVTPXJlcXVpcmUoJy4vU3R5bGVzJyk7XHJcbnJlcXVpcmUoJ2pvb3NlJyk7XHJcbnJlcXVpcmUoJy4vVHJhY2snKTtcclxucmVxdWlyZSgnLi9MaXZlU3RyZWFtJyk7XHJcbnZhciBDT05GSUcgPSByZXF1aXJlKFwiLi9Db25maWdcIik7XHJcblxyXG5DbGFzcyhcIkd1aVwiLCBcclxue1xyXG4gICAgLy8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdC8vIEFMTCBDT09SRElOQVRFUyBBUkUgSU4gV09STEQgTUVSQ0FUT1JcclxuICAgIC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuICAgIGhhczogXHJcblx0e1xyXG4gICAgXHRpc0RlYnVnIDoge1xyXG4gICAgXHRcdGlzIDogXCJyd1wiLFxyXG4gICAgXHRcdGluaXQgOiAhVXRpbHMubW9iaWxlQW5kVGFibGV0Q2hlY2soKSAmJiBDT05GSUcuYXBwZWFyYW5jZS5kZWJ1Z1xyXG4gICAgXHR9LFxyXG5cdFx0aXNXaWRnZXQgOiB7XHJcblx0XHRcdGluaXQgOiBmYWxzZVxyXG5cdFx0fSxcclxuXHRcdGlzRGVidWdTaG93UG9zaXRpb24gOiB7XHJcblx0XHRcdC8vIGlmIHNldCB0byB0cnVlIGl0IHdpbGwgYWRkIGFuIGFic29sdXRlIGVsZW1lbnQgc2hvd2luZyB0aGUgY29vcmRpbmF0ZXMgYWJvdmUgdGhlIG1vdXNlIGxvY2F0aW9uXHJcblx0XHRcdGluaXQgOiBmYWxzZVxyXG5cdFx0fSxcclxuXHRcdHJlY2VpdmVyT25NYXBDbGljayA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiBbXVxyXG5cdFx0fSxcclxuICAgICAgICB3aWR0aCA6IHtcclxuICAgICAgICAgICAgaXM6ICAgXCJyd1wiLFxyXG4gICAgICAgICAgICBpbml0OiA3NTBcclxuICAgICAgICB9LFxyXG4gICAgICAgIGhlaWdodDoge1xyXG4gICAgICAgICAgICBpczogICBcInJ3XCIsXHJcbiAgICAgICAgICAgIGluaXQ6IDUwMFxyXG4gICAgICAgIH0sXHJcblx0XHR0cmFjayA6IHtcclxuXHRcdFx0aXM6ICAgXCJyd1wiXHJcblx0XHR9LFxyXG5cdFx0ZWxlbWVudElkIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IFwibWFwXCJcclxuXHRcdH0sXHJcblx0XHRpbml0aWFsUG9zIDoge1x0XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogbnVsbFxyXG5cdFx0fSxcclxuXHRcdGluaXRpYWxab29tIDoge1x0XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogMTBcclxuXHRcdH0sXHJcblx0XHRpc1NraXBFeHRlbnQgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogZmFsc2VcclxuXHRcdH0sXHJcblx0XHRiaW5nTWFwS2V5IDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6ICdBaWp0M0FzV09NRTNoUEVFX0hxUmxVS2RjQktxZThkR1JaSF92LUwzSF9GRjY0c3ZYTWJrcjFUNnVfV0FTb2V0J1xyXG5cdFx0fSxcclxuXHRcdC8vLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdFx0bWFwIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IG51bGxcclxuXHRcdH0sXHJcblx0XHR0cmFja0xheWVyIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IG51bGxcclxuXHRcdH0sXHJcbiAgICAgICAgaG90c3BvdHNMYXllciA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiBudWxsXHJcblx0XHR9LFxyXG4gICAgICAgIGNhbXNMYXllciA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiBudWxsXHJcblx0XHR9LFxyXG5cdFx0cGFydGljaXBhbnRzTGF5ZXIgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogbnVsbFxyXG5cdFx0fSxcclxuXHRcdGRlYnVnTGF5ZXJHUFMgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogbnVsbFxyXG5cdFx0fSxcdFxyXG5cdFx0dGVzdExheWVyIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IG51bGxcclxuXHRcdH0sXHRcclxuXHRcdHRlc3RMYXllcjEgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogbnVsbFxyXG5cdFx0fSxcdFxyXG5cdFx0dGVzdExheWVyMiA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiBudWxsXHJcblx0XHR9LFx0XHJcblx0XHRcclxuXHRcdHNlbGVjdGVkUGFydGljaXBhbnQxIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IG51bGxcclxuXHRcdH0sXHJcblx0XHRzZWxlY3RlZFBhcnRpY2lwYW50MiA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiBudWxsXHJcblx0XHR9LFxyXG5cdFx0cG9wdXAxIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IG51bGxcclxuXHRcdH0sXHJcblx0XHRwb3B1cDIgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogbnVsbFxyXG5cdFx0fSxcclxuXHRcdGlzU2hvd1N3aW0gOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogdHJ1ZVxyXG5cdFx0fSxcclxuXHRcdGlzU2hvd0Jpa2UgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogdHJ1ZVxyXG5cdFx0fSxcclxuXHRcdGlzU2hvd1J1biA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiB0cnVlXHJcblx0XHR9LFxyXG5cdFx0c2VsZWN0TnVtIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IDFcclxuXHRcdH0sXHJcbiAgICAgICAgbGl2ZVN0cmVhbSA6IHtcclxuICAgICAgICAgICAgaW5pdDogbnVsbFxyXG4gICAgICAgIH0sXHJcblx0XHRkaXNwbGF5TW9kZSA6IHtcdFx0XHRcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiBcIm5lYXJlc3RcIlx0XHRcdC8vbmVhcmVzdCxsaW5lYXIsdHJhY2tpbmdcclxuXHRcdH1cclxuICAgIH0sXHJcbiAgICAvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0bWV0aG9kczogXHJcblx0e1xyXG4gICAgICAgIGluaXQ6IGZ1bmN0aW9uIChwYXJhbXMpICBcclxuXHRcdHtcclxuXHRcdFx0Ly8gaWYgaW4gd2lkZ2V0IG1vZGUgdGhlbiBkaXNhYmxlIGRlYnVnXHJcblx0XHRcdGlmICh0aGlzLmlzV2lkZ2V0KSB7XHJcblx0XHRcdFx0dGhpcy5pc0RlYnVnID0gZmFsc2U7XHJcblx0XHRcdH1cclxuXHJcblx0XHRcdHZhciBkZWZQb3MgPSBbMCwwXTtcclxuXHRcdFx0aWYgKHRoaXMuaW5pdGlhbFBvcykge1xyXG5cdFx0XHRcdGRlZlBvcyA9IHRoaXMuaW5pdGlhbFBvcztcclxuXHRcdFx0fSBlbHNlIGlmIChUUkFDSy5nZXRSb3V0ZSgpICYmIFRSQUNLLmdldFJvdXRlKCkubGVuZ3RoID4gMSkge1xyXG5cdFx0XHRcdGRlZlBvcyA9IFRSQUNLLmdldFJvdXRlKClbMF07XHJcblx0XHRcdH1cclxuXHRcdFx0Ly8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRcdFx0dmFyIGV4dGVudCA9IHRoaXMuaXNTa2lwRXh0ZW50ID8gbnVsbCA6IFRSQUNLLmdldFJvdXRlKCkgJiYgVFJBQ0suZ2V0Um91dGUoKS5sZW5ndGggPiAxID8gb2wucHJvai50cmFuc2Zvcm1FeHRlbnQoIChuZXcgb2wuZ2VvbS5MaW5lU3RyaW5nKFRSQUNLLmdldFJvdXRlKCkpKS5nZXRFeHRlbnQoKSAsICdFUFNHOjQzMjYnLCAnRVBTRzozODU3JykgOiBudWxsO1xyXG5cdFx0XHR0aGlzLnRyYWNrTGF5ZXIgPSBuZXcgb2wubGF5ZXIuVmVjdG9yKHtcclxuXHRcdFx0ICBzb3VyY2U6IG5ldyBvbC5zb3VyY2UuVmVjdG9yKCksXHJcblx0XHRcdCAgc3R5bGUgOiBTVFlMRVNbXCJ0cmFja1wiXVxyXG5cdFx0XHR9KTtcclxuXHRcdFx0dGhpcy5ob3RzcG90c0xheWVyID0gbmV3IG9sLmxheWVyLlZlY3Rvcih7XHJcblx0XHRcdCAgc291cmNlOiBuZXcgb2wuc291cmNlLlZlY3RvcigpLFxyXG5cdFx0XHQgIHN0eWxlIDogU1RZTEVTW1wiaG90c3BvdFwiXVxyXG5cdFx0XHR9KTtcclxuXHRcdFx0dGhpcy5wYXJ0aWNpcGFudHNMYXllciA9IG5ldyBvbC5sYXllci5WZWN0b3Ioe1xyXG5cdFx0XHQgIHNvdXJjZTogbmV3IG9sLnNvdXJjZS5WZWN0b3IoKSxcclxuXHRcdFx0ICBzdHlsZSA6IFNUWUxFU1tcInBhcnRpY2lwYW50XCJdXHJcblx0XHRcdH0pO1xyXG5cdFx0XHR0aGlzLmNhbXNMYXllciA9IG5ldyBvbC5sYXllci5WZWN0b3Ioe1xyXG5cdFx0XHRcdHNvdXJjZTogbmV3IG9sLnNvdXJjZS5WZWN0b3IoKSxcclxuXHRcdFx0XHRzdHlsZSA6IFNUWUxFU1tcImNhbVwiXVxyXG5cdFx0XHR9KTtcclxuXHRcdFx0aWYgKHRoaXMuaXNEZWJ1ZykgXHJcblx0XHRcdHtcclxuXHRcdFx0XHR0aGlzLmRlYnVnTGF5ZXJHUFMgPSBuZXcgb2wubGF5ZXIuVmVjdG9yKHtcclxuXHRcdFx0XHRcdCAgc291cmNlOiBuZXcgb2wuc291cmNlLlZlY3RvcigpLFxyXG5cdFx0XHRcdFx0ICBzdHlsZSA6IFNUWUxFU1tcImRlYnVnR1BTXCJdXHJcblx0XHRcdFx0fSk7XHJcblx0XHRcdFx0dGhpcy50ZXN0TGF5ZXIgPSBuZXcgb2wubGF5ZXIuVmVjdG9yKHtcclxuXHRcdFx0XHRcdCAgc291cmNlOiBuZXcgb2wuc291cmNlLlZlY3RvcigpLFxyXG5cdFx0XHRcdFx0ICBzdHlsZSA6IFNUWUxFU1tcInRlc3RcIl1cclxuXHRcdFx0XHR9KTtcclxuXHRcdFx0XHR0aGlzLnRlc3RMYXllcjEgPSBuZXcgb2wubGF5ZXIuVmVjdG9yKHtcclxuXHRcdFx0XHRcdCAgc291cmNlOiBuZXcgb2wuc291cmNlLlZlY3RvcigpLFxyXG5cdFx0XHRcdFx0ICBzdHlsZSA6IFNUWUxFU1tcInRlc3QxXCJdXHJcblx0XHRcdFx0fSk7XHJcblx0XHRcdFx0dGhpcy50ZXN0TGF5ZXIyID0gbmV3IG9sLmxheWVyLlZlY3Rvcih7XHJcblx0XHRcdFx0XHQgIHNvdXJjZTogbmV3IG9sLnNvdXJjZS5WZWN0b3IoKSxcclxuXHRcdFx0XHQgIFx0c3R5bGUgOiBTVFlMRVNbXCJ0ZXN0MlwiXVxyXG5cdFx0XHRcdH0pO1xyXG5cdFx0XHR9XHJcblx0XHRcdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRcdFx0dmFyIGludHMgPSBbXTtcclxuXHRcdFx0dGhpcy5wb3B1cDEgPSBuZXcgb2wuT3ZlcmxheS5Qb3B1cCh7YW5pOmZhbHNlLHBhbk1hcElmT3V0T2ZWaWV3IDogZmFsc2V9KTtcclxuXHRcdFx0dGhpcy5wb3B1cDIgPSBuZXcgb2wuT3ZlcmxheS5Qb3B1cCh7YW5pOmZhbHNlLHBhbk1hcElmT3V0T2ZWaWV3IDogZmFsc2V9KTtcclxuXHRcdFx0dGhpcy5wb3B1cDIuc2V0T2Zmc2V0KFswLDE3NV0pO1xyXG5cdFx0XHR0aGlzLm1hcCA9IG5ldyBvbC5NYXAoe1xyXG5cdFx0XHQgIHJlbmRlcmVyIDogXCJjYW52YXNcIixcclxuXHRcdFx0ICB0YXJnZXQ6ICdtYXAnLFxyXG5cdFx0XHQgIGxheWVyczogW1xyXG5cdFx0XHQgICAgICAgICAgIG5ldyBvbC5sYXllci5UaWxlKHtcclxuXHRcdFx0ICAgICAgICAgICAgICAgc291cmNlOiBuZXcgb2wuc291cmNlLk9TTSgpXHJcblx0XHRcdCAgICAgICAgICAgfSksXHJcblx0XHRcdFx0XHR0aGlzLnRyYWNrTGF5ZXIsXHJcblx0XHRcdFx0XHR0aGlzLmhvdHNwb3RzTGF5ZXIsXHJcblx0XHRcdFx0XHR0aGlzLmNhbXNMYXllcixcclxuXHRcdFx0XHRcdHRoaXMucGFydGljaXBhbnRzTGF5ZXJcclxuXHRcdFx0ICBdLFxyXG5cdFx0XHQgIGNvbnRyb2xzOiB0aGlzLmlzV2lkZ2V0ID8gW10gOiBvbC5jb250cm9sLmRlZmF1bHRzKCksXHJcblx0XHRcdCAgdmlldzogbmV3IG9sLlZpZXcoe1xyXG5cdFx0XHRcdGNlbnRlcjogb2wucHJvai50cmFuc2Zvcm0oZGVmUG9zLCAnRVBTRzo0MzI2JywgJ0VQU0c6Mzg1NycpLFxyXG5cdFx0XHRcdHpvb206IHRoaXMuaW5pdGlhbFpvb20sXHJcblx0XHRcdFx0bWluWm9vbTogdGhpcy5pc1dpZGdldCA/IHRoaXMuaW5pdGlhbFpvb20gOiA4LFxyXG5cdFx0XHRcdG1heFpvb206IHRoaXMuaXNXaWRnZXQgPyB0aGlzLmluaXRpYWxab29tIDogKENPTkZJRy5hcHBlYXJhbmNlLmRlYnVnID8gMjAgOiAxNyksXHJcblx0XHRcdFx0ZXh0ZW50IDogZXh0ZW50ID8gZXh0ZW50IDogdW5kZWZpbmVkXHJcblx0XHRcdCAgfSlcclxuXHRcdFx0fSk7XHJcblx0XHRcdFxyXG5cdFx0XHRmb3IgKHZhciBpPTA7aTxpbnRzLmxlbmd0aDtpKyspXHJcblx0XHRcdFx0dGhpcy5tYXAuYWRkSW50ZXJhY3Rpb24oaW50c1tpXSk7XHJcblx0XHRcdHRoaXMubWFwLmFkZE92ZXJsYXkodGhpcy5wb3B1cDEpO1xyXG5cdFx0XHR0aGlzLm1hcC5hZGRPdmVybGF5KHRoaXMucG9wdXAyKTtcclxuXHRcdFx0aWYgKHRoaXMuaXNEZWJ1ZykgeyBcclxuXHRcdFx0XHR0aGlzLm1hcC5hZGRMYXllcih0aGlzLmRlYnVnTGF5ZXJHUFMpO1xyXG5cdFx0XHRcdHRoaXMubWFwLmFkZExheWVyKHRoaXMudGVzdExheWVyKTtcclxuXHRcdFx0XHR0aGlzLm1hcC5hZGRMYXllcih0aGlzLnRlc3RMYXllcjEpO1xyXG5cdFx0XHRcdHRoaXMubWFwLmFkZExheWVyKHRoaXMudGVzdExheWVyMik7XHJcblx0XHRcdH1cclxuXHRcdFx0VFJBQ0suaW5pdCgpO1xyXG5cdFx0XHR0aGlzLmFkZFRyYWNrRmVhdHVyZSgpO1xyXG5cdFx0XHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRcdFx0aWYgKCF0aGlzLmlzV2lkZ2V0KSB7XHJcblx0XHRcdFx0dGhpcy5tYXAub24oJ2NsaWNrJywgZnVuY3Rpb24gKGV2ZW50KSB7XHJcblx0XHRcdFx0XHRUUkFDSy5vbk1hcENsaWNrKGV2ZW50KTtcclxuXHRcdFx0XHRcdHZhciBzZWxlY3RlZFBhcnRpY2lwYW50cyA9IFtdO1xyXG5cdFx0XHRcdFx0dmFyIHNlbGVjdGVkSG90c3BvdCA9IG51bGw7XHJcblx0XHRcdFx0XHR0aGlzLm1hcC5mb3JFYWNoRmVhdHVyZUF0UGl4ZWwoZXZlbnQucGl4ZWwsIGZ1bmN0aW9uIChmZWF0dXJlLCBsYXllcikge1xyXG5cdFx0XHRcdFx0XHRpZiAobGF5ZXIgPT0gdGhpcy5wYXJ0aWNpcGFudHNMYXllcikge1xyXG5cdFx0XHRcdFx0XHRcdHNlbGVjdGVkUGFydGljaXBhbnRzLnB1c2goZmVhdHVyZSk7XHJcblx0XHRcdFx0XHRcdH0gZWxzZSBpZiAobGF5ZXIgPT0gdGhpcy5ob3RzcG90c0xheWVyKSB7XHJcblx0XHRcdFx0XHRcdFx0Ly8gYWxsb3cgb25seSBvbmUgaG90c3BvdCB0byBiZSBzZWxlY3RlZCBhdCBhIHRpbWVcclxuXHRcdFx0XHRcdFx0XHRpZiAoIXNlbGVjdGVkSG90c3BvdClcclxuXHRcdFx0XHRcdFx0XHRcdHNlbGVjdGVkSG90c3BvdCA9IGZlYXR1cmU7XHJcblx0XHRcdFx0XHRcdH1cclxuXHRcdFx0XHRcdH0sIHRoaXMpO1xyXG5cclxuXHRcdFx0XHRcdC8vIGZpcnN0IGlmIHRoZXJlIGFyZSBzZWxlY3RlZCBwYXJ0aWNpcGFudHMgdGhlbiBzaG93IHRoZWlyIHBvcHVwc1xyXG5cdFx0XHRcdFx0Ly8gYW5kIG9ubHkgaWYgdGhlcmUgYXJlIG5vdCB1c2UgdGhlIHNlbGVjdGVkIGhvdHNwb3QgaWYgdGhlcmUncyBhbnlcclxuXHRcdFx0XHRcdGlmIChzZWxlY3RlZFBhcnRpY2lwYW50cy5sZW5ndGgpIHtcclxuXHRcdFx0XHRcdFx0aWYgKHRoaXMuc2VsZWN0ZWRQYXJ0aWNpcGFudDEgPT0gbnVsbCkge1xyXG5cdFx0XHRcdFx0XHRcdHZhciBmZWF0ID0gdGhpcy5nZXRTZWxlY3RlZFBhcnRpY2lwYW50RnJvbUFycmF5Q3ljbGljKHNlbGVjdGVkUGFydGljaXBhbnRzKTtcclxuXHRcdFx0XHRcdFx0XHRpZiAoZmVhdClcclxuXHRcdFx0XHRcdFx0XHRcdHRoaXMuc2V0U2VsZWN0ZWRQYXJ0aWNpcGFudDEoZmVhdC5wYXJ0aWNpcGFudCk7XHJcblx0XHRcdFx0XHRcdFx0ZWxzZVxyXG5cdFx0XHRcdFx0XHRcdFx0dGhpcy5zZXRTZWxlY3RlZFBhcnRpY2lwYW50MShudWxsKTtcclxuXHRcdFx0XHRcdFx0XHR0aGlzLnNlbGVjdE51bSA9IDA7XHJcblx0XHRcdFx0XHRcdH0gZWxzZSBpZiAodGhpcy5zZWxlY3RlZFBhcnRpY2lwYW50MiA9PSBudWxsKSB7XHJcblx0XHRcdFx0XHRcdFx0dmFyIGZlYXQgPSB0aGlzLmdldFNlbGVjdGVkUGFydGljaXBhbnRGcm9tQXJyYXlDeWNsaWMoc2VsZWN0ZWRQYXJ0aWNpcGFudHMpO1xyXG5cdFx0XHRcdFx0XHRcdGlmIChmZWF0KVxyXG5cdFx0XHRcdFx0XHRcdFx0dGhpcy5zZXRTZWxlY3RlZFBhcnRpY2lwYW50MihmZWF0LnBhcnRpY2lwYW50KTtcclxuXHRcdFx0XHRcdFx0XHRlbHNlXHJcblx0XHRcdFx0XHRcdFx0XHR0aGlzLnNldFNlbGVjdGVkUGFydGljaXBhbnQyKG51bGwpO1xyXG5cdFx0XHRcdFx0XHRcdHRoaXMuc2VsZWN0TnVtID0gMTtcclxuXHRcdFx0XHRcdFx0fSBlbHNlIHtcclxuXHRcdFx0XHRcdFx0XHR0aGlzLnNlbGVjdE51bSA9ICh0aGlzLnNlbGVjdE51bSArIDEpICUgMjtcclxuXHRcdFx0XHRcdFx0XHRpZiAodGhpcy5zZWxlY3ROdW0gPT0gMCkge1xyXG5cdFx0XHRcdFx0XHRcdFx0dmFyIGZlYXQgPSB0aGlzLmdldFNlbGVjdGVkUGFydGljaXBhbnRGcm9tQXJyYXlDeWNsaWMoc2VsZWN0ZWRQYXJ0aWNpcGFudHMpO1xyXG5cdFx0XHRcdFx0XHRcdFx0aWYgKGZlYXQpXHJcblx0XHRcdFx0XHRcdFx0XHRcdHRoaXMuc2V0U2VsZWN0ZWRQYXJ0aWNpcGFudDEoZmVhdC5wYXJ0aWNpcGFudCk7XHJcblx0XHRcdFx0XHRcdFx0XHRlbHNlXHJcblx0XHRcdFx0XHRcdFx0XHRcdHRoaXMuc2V0U2VsZWN0ZWRQYXJ0aWNpcGFudDEobnVsbCk7XHJcblx0XHRcdFx0XHRcdFx0fSBlbHNlIHtcclxuXHRcdFx0XHRcdFx0XHRcdHZhciBmZWF0ID0gdGhpcy5nZXRTZWxlY3RlZFBhcnRpY2lwYW50RnJvbUFycmF5Q3ljbGljKHNlbGVjdGVkUGFydGljaXBhbnRzKTtcclxuXHRcdFx0XHRcdFx0XHRcdGlmIChmZWF0KVxyXG5cdFx0XHRcdFx0XHRcdFx0XHR0aGlzLnNldFNlbGVjdGVkUGFydGljaXBhbnQyKGZlYXQucGFydGljaXBhbnQpO1xyXG5cdFx0XHRcdFx0XHRcdFx0ZWxzZVxyXG5cdFx0XHRcdFx0XHRcdFx0XHR0aGlzLnNldFNlbGVjdGVkUGFydGljaXBhbnQyKG51bGwpO1xyXG5cdFx0XHRcdFx0XHRcdH1cclxuXHRcdFx0XHRcdFx0fVxyXG5cdFx0XHRcdFx0fSBlbHNlIHtcclxuXHRcdFx0XHRcdFx0dGhpcy5zZXRTZWxlY3RlZFBhcnRpY2lwYW50MShudWxsKTtcclxuXHRcdFx0XHRcdFx0dGhpcy5zZXRTZWxlY3RlZFBhcnRpY2lwYW50MihudWxsKTtcclxuXHJcblx0XHRcdFx0XHRcdGlmIChzZWxlY3RlZEhvdHNwb3QpIHtcclxuXHRcdFx0XHRcdFx0XHRzZWxlY3RlZEhvdHNwb3QuaG90c3BvdC5vbkNsaWNrKCk7XHJcblx0XHRcdFx0XHRcdH1cclxuXHRcdFx0XHRcdH1cclxuXHRcdFx0XHR9LCB0aGlzKTtcclxuXHJcblx0XHRcdFx0Ly8gY2hhbmdlIG1vdXNlIGN1cnNvciB3aGVuIG92ZXIgc3BlY2lmaWMgZmVhdHVyZXNcclxuXHRcdFx0XHR2YXIgc2VsZiA9IHRoaXM7XHJcblx0XHRcdFx0JCh0aGlzLm1hcC5nZXRWaWV3cG9ydCgpKS5vbignbW91c2Vtb3ZlJywgZnVuY3Rpb24gKGUpIHtcclxuXHRcdFx0XHRcdHZhciBwaXhlbCA9IHNlbGYubWFwLmdldEV2ZW50UGl4ZWwoZS5vcmlnaW5hbEV2ZW50KTtcclxuXHRcdFx0XHRcdHZhciBpc0NsaWNrYWJsZSA9IHNlbGYubWFwLmZvckVhY2hGZWF0dXJlQXRQaXhlbChwaXhlbCwgZnVuY3Rpb24gKGZlYXR1cmUsIGxheWVyKSB7XHJcblx0XHRcdFx0XHRcdGlmIChsYXllciA9PT0gc2VsZi5wYXJ0aWNpcGFudHNMYXllciB8fCBsYXllciA9PT0gc2VsZi5jYW1zTGF5ZXIpIHtcclxuXHRcdFx0XHRcdFx0XHQvLyBhbGwgcGFydGljaXBhbnRzIGFuZCBtb3ZpbmcgY2FtZXJhcyBhcmUgY2xpY2thYmxlXHJcblx0XHRcdFx0XHRcdFx0cmV0dXJuIHRydWU7XHJcblx0XHRcdFx0XHRcdH0gZWxzZSBpZiAobGF5ZXIgPT09IHNlbGYuaG90c3BvdHNMYXllcikge1xyXG5cdFx0XHRcdFx0XHRcdC8vIGdldCBcImNsaWNrYWJpbGl0eVwiIGZyb20gdGhlIGhvdHNwb3RcclxuXHRcdFx0XHRcdFx0XHRyZXR1cm4gZmVhdHVyZS5ob3RzcG90LmlzQ2xpY2thYmxlKCk7XHJcblx0XHRcdFx0XHRcdH1cclxuXHRcdFx0XHRcdH0pO1xyXG5cdFx0XHRcdFx0c2VsZi5tYXAuZ2V0Vmlld3BvcnQoKS5zdHlsZS5jdXJzb3IgPSBpc0NsaWNrYWJsZSA/ICdwb2ludGVyJyA6ICcnO1xyXG5cdFx0XHRcdH0pO1xyXG5cdFx0XHR9XHJcblx0XHRcdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRcdFx0LyppZiAoIXRoaXMuX2FuaW1hdGlvbkluaXQpIHtcclxuXHRcdFx0XHR0aGlzLl9hbmltYXRpb25Jbml0PXRydWU7XHJcblx0XHRcdFx0c2V0SW50ZXJ2YWwodGhpcy5vbkFuaW1hdGlvbi5iaW5kKHRoaXMpLCAxMDAwKkNPTkZJRy50aW1lb3V0cy5hbmltYXRpb25GcmFtZSApO1xyXG5cdFx0XHR9Ki9cclxuXHJcblx0XHRcdC8vIGlmIHRoaXMgaXMgT04gdGhlbiBpdCB3aWxsIHNob3cgdGhlIGNvb3JkaW5hdGVzIHBvc2l0aW9uIHVuZGVyIHRoZSBtb3VzZSBsb2NhdGlvblxyXG5cdFx0XHRpZiAodGhpcy5pc0RlYnVnU2hvd1Bvc2l0aW9uKSB7XHJcblx0XHRcdFx0JChcIiNtYXBcIikuYXBwZW5kKCc8cCBpZD1cImRlYnVnU2hvd1Bvc2l0aW9uXCI+RVBTRzozODU3IDxzcGFuIGlkPVwibW91c2UzODU3XCI+PC9zcGFuPiAmbmJzcDsgRVBTRzo0MzI2IDxzcGFuIGlkPVwibW91c2U0MzI2XCI+PC9zcGFuPicpO1xyXG5cdFx0XHRcdHRoaXMubWFwLm9uKCdwb2ludGVybW92ZScsIGZ1bmN0aW9uKGV2ZW50KSB7XHJcblx0XHRcdFx0XHR2YXIgY29vcmQzODU3ID0gZXZlbnQuY29vcmRpbmF0ZTtcclxuXHRcdFx0XHRcdHZhciBjb29yZDQzMjYgPSBvbC5wcm9qLnRyYW5zZm9ybShjb29yZDM4NTcsICdFUFNHOjM4NTcnLCAnRVBTRzo0MzI2Jyk7XHJcblx0XHRcdFx0XHQkKCcjbW91c2UzODU3JykudGV4dChvbC5jb29yZGluYXRlLnRvU3RyaW5nWFkoY29vcmQzODU3LCAyKSk7XHJcblx0XHRcdFx0XHQkKCcjbW91c2U0MzI2JykudGV4dChvbC5jb29yZGluYXRlLnRvU3RyaW5nWFkoY29vcmQ0MzI2LCAxNSkpO1xyXG5cdFx0XHRcdH0pO1xyXG5cdFx0XHR9XHJcblxyXG5cdFx0XHQvLyBwYXNzIHRoZSBpZCBvZiB0aGUgRE9NIGVsZW1lbnRcclxuXHRcdFx0dGhpcy5saXZlU3RyZWFtID0gbmV3IExpdmVTdHJlYW0oe2lkIDogXCJsaXZlU3RyZWFtXCJ9KTtcclxuICAgICAgICB9LFxyXG5cdFx0XHJcbiAgICAgICAgXHJcbiAgICAgICAgYWRkVHJhY2tGZWF0dXJlIDogZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgXHRUUkFDSy5pbml0KCk7XHJcbiAgICAgICAgXHRpZiAoVFJBQ0suZmVhdHVyZSkge1xyXG4gICAgICAgIFx0XHR2YXIgZnQgPSB0aGlzLnRyYWNrTGF5ZXIuZ2V0U291cmNlKCkuZ2V0RmVhdHVyZXMoKTtcclxuICAgICAgICBcdFx0dmFyIG9rPWZhbHNlO1xyXG4gICAgICAgIFx0XHRmb3IgKHZhciBpPTA7aTxmdC5sZW5ndGg7aSsrKSBcclxuICAgICAgICBcdFx0e1xyXG4gICAgICAgIFx0XHRcdGlmIChmdFtpXSA9PSBUUkFDSy5mZWF0dXJlKVxyXG4gICAgICAgIFx0XHRcdHtcclxuICAgICAgICBcdFx0XHRcdG9rPXRydWU7XHJcbiAgICAgICAgXHRcdFx0XHRicmVhaztcclxuICAgICAgICBcdFx0XHR9XHJcbiAgICAgICAgXHRcdH1cclxuICAgICAgICBcdFx0aWYgKCFvaylcclxuICAgICAgICBcdFx0XHR0aGlzLnRyYWNrTGF5ZXIuZ2V0U291cmNlKCkuYWRkRmVhdHVyZShUUkFDSy5mZWF0dXJlKTtcclxuICAgICAgICBcdH1cclxuICAgICAgICB9LFxyXG4gICAgICAgIHpvb21Ub1RyYWNrIDogZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgICAgIHZhciBleHRlbnQgPSBUUkFDSy5nZXRSb3V0ZSgpICYmIFRSQUNLLmdldFJvdXRlKCkubGVuZ3RoID4gMSA/IG9sLnByb2oudHJhbnNmb3JtRXh0ZW50KCAobmV3IG9sLmdlb20uTGluZVN0cmluZyhUUkFDSy5nZXRSb3V0ZSgpKSkuZ2V0RXh0ZW50KCkgLCAnRVBTRzo0MzI2JywgJ0VQU0c6Mzg1NycpIDogbnVsbDtcclxuICAgICAgICAgICAgaWYgKGV4dGVudClcclxuICAgICAgICAgICAgXHR0aGlzLm1hcC5nZXRWaWV3KCkuZml0RXh0ZW50KGV4dGVudCx0aGlzLm1hcC5nZXRTaXplKCkpO1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgXHJcbiAgICAgICAgZ2V0U2VsZWN0ZWRQYXJ0aWNpcGFudEZyb21BcnJheUN5Y2xpYyA6IGZ1bmN0aW9uKGZlYXR1cmVzKSB7XHJcbiAgICBcdFx0dmFyIGFyciA9IFtdO1xyXG4gICAgXHRcdHZhciB0bWFwID0ge307XHJcbiAgICBcdFx0dmFyIGNyclBvcyA9IDA7XHJcblx0XHRcdHZhciBwb3M9bnVsbDtcclxuICAgIFx0XHRmb3IgKHZhciBpPTA7aTxmZWF0dXJlcy5sZW5ndGg7aSsrKSB7XHJcbiAgICBcdFx0XHR2YXIgZmVhdHVyZSA9IGZlYXR1cmVzW2ldO1xyXG4gICAgXHRcdFx0dmFyIGlkID0gZmVhdHVyZS5wYXJ0aWNpcGFudC5jb2RlO1xyXG4gICAgXHRcdFx0YXJyLnB1c2goaWQpO1xyXG4gICAgXHRcdFx0dG1hcFtpZF09dHJ1ZTtcclxuXHRcdFx0XHRpZiAoaWQgPT0gdGhpcy52cl9sYXN0c2VsZWN0ZWQpIHtcclxuXHRcdFx0XHRcdHBvcz1pO1xyXG5cdFx0XHRcdH1cclxuICAgIFx0XHR9XHJcbiAgICBcdFx0dmFyIHNhbWUgPSB0aGlzLnZyX29sZGJlc3RhcnIgJiYgcG9zICE9IG51bGw7IFxyXG4gICAgXHRcdGlmIChzYW1lKSBcclxuICAgIFx0XHR7XHJcbiAgICBcdFx0XHQvLyBhbGwgZnJvbSB0aGUgb2xkIGNvbnRhaW5lZCBpbiB0aGUgbmV3XHJcbiAgICBcdFx0XHRmb3IgKHZhciBpPTA7aTx0aGlzLnZyX29sZGJlc3RhcnIubGVuZ3RoO2krKykgXHJcbiAgICBcdFx0XHR7XHJcbiAgICBcdFx0XHRcdGlmICghdG1hcFt0aGlzLnZyX29sZGJlc3RhcnJbaV1dKSB7XHJcbiAgICBcdFx0XHRcdFx0c2FtZT1mYWxzZTtcclxuICAgIFx0XHRcdFx0XHRicmVhaztcclxuICAgIFx0XHRcdFx0fVxyXG4gICAgXHRcdFx0fVxyXG4gICAgXHRcdH1cclxuICAgIFx0XHRpZiAoIXNhbWUpIHtcclxuICAgIFx0XHRcdHRoaXMudnJfb2xkYmVzdGFycj1hcnI7XHJcbiAgICBcdFx0XHR0aGlzLnZyX2xhc3RzZWxlY3RlZD1hcnJbMF07XHJcbiAgICBcdFx0XHRyZXR1cm4gZmVhdHVyZXNbMF07XHJcbiAgICBcdFx0fSBlbHNlIHtcclxuICAgIFx0XHRcdHRoaXMudnJfbGFzdHNlbGVjdGVkID0gcG9zID4gMCA/IGFycltwb3MtMV0gOiBhcnJbYXJyLmxlbmd0aC0xXTsgICAgXHRcdFx0XHJcbiAgICAgICAgXHRcdHZhciByZXN1bHRGZWF0dXJlO1xyXG4gICAgXHRcdFx0Zm9yICh2YXIgaT0wO2k8ZmVhdHVyZXMubGVuZ3RoO2krKykgXHJcbiAgICAgICAgXHRcdHtcclxuICAgICAgICBcdFx0XHR2YXIgZmVhdHVyZSA9IGZlYXR1cmVzW2ldO1xyXG4gICAgICAgIFx0XHRcdHZhciBpZCA9IGZlYXR1cmUucGFydGljaXBhbnQuY29kZTtcclxuICAgICAgICBcdFx0XHRpZiAoaWQgPT0gdGhpcy52cl9sYXN0c2VsZWN0ZWQpIHtcclxuICAgICAgICBcdFx0XHRcdHJlc3VsdEZlYXR1cmU9ZmVhdHVyZTtcclxuICAgICAgICBcdFx0XHRcdGJyZWFrO1xyXG4gICAgICAgIFx0XHRcdH1cclxuICAgICAgICBcdFx0fVxyXG4gICAgICAgICAgICAgICAgcmV0dXJuIHJlc3VsdEZlYXR1cmU7XHJcbiAgICBcdFx0fVxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgXHJcblx0XHRzaG93RXJyb3IgOiBmdW5jdGlvbihtc2csb25DbG9zZUNhbGxiYWNrKVxyXG5cdFx0e1xyXG5cdFx0XHRhbGVydChcIkVSUk9SIDogXCIrbXNnKTtcclxuXHRcdFx0aWYgKG9uQ2xvc2VDYWxsYmFjaykgXHJcblx0XHRcdFx0b25DbG9zZUNhbGxiYWNrKCk7XHJcblx0XHR9LFxyXG5cdFx0XHJcblx0XHRvbkFuaW1hdGlvbiA6IGZ1bmN0aW9uKGN0aW1lKVxyXG5cdFx0e1xyXG5cdFx0XHRpZiAoY3RpbWUpIFxyXG5cdFx0XHR7XHJcblx0XHRcdFx0dmFyIGFycj1bXTtcclxuXHRcdFx0XHRmb3IgKHZhciBpcD0wO2lwPFRSQUNLLnBhcnRpY2lwYW50cy5sZW5ndGg7aXArKylcclxuXHRcdFx0XHR7XHJcblx0XHRcdFx0XHR2YXIgcCA9IFRSQUNLLnBhcnRpY2lwYW50c1tpcF07XHJcblx0XHRcdFx0XHRpZiAocC5pc0Zhdm9yaXRlKVxyXG5cdFx0XHRcdFx0e1xyXG5cdFx0XHRcdFx0XHRwLmludGVycG9sYXRlKGN0aW1lKTtcclxuXHRcdFx0XHRcdFx0Ly8gdGhpcyB3aWxsIGFkZCBpbiB0aGUgcmFua2luZyBwb3NpdGluZyBvbmx5IHRoZSBwYXJ0aWNpcGFudHMgdGhlIGhhcyB0byBiZSB0cmFja2VkXHJcblx0XHRcdFx0XHRcdC8vIHNvIG1vdmluZyBjYW1zIGFyZSBza2lwcGVkXHJcblx0XHRcdFx0XHRcdGlmICghcC5fX3NraXBUcmFja2luZ1BvcylcclxuXHRcdFx0XHRcdFx0XHRhcnIucHVzaChpcCk7XHJcblx0XHRcdFx0XHR9XHJcblx0XHRcdFx0fVxyXG5cdFx0XHRcdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdFx0XHRcdC8vIHdlIGhhdmUgdG8gc29ydCB0aGVtIG90aGVyd2lzZSB0aGlzIF9fcG9zLCBfX3ByZXYsIF9fbmV4dCBhcmUgaXJyZWxldmFudFxyXG5cdFx0XHRcdGFyci5zb3J0KGZ1bmN0aW9uKGlwMSwgaWQyKXtcclxuXHRcdFx0XHRcdHJldHVybiBUUkFDSy5wYXJ0aWNpcGFudHNbaWQyXS5nZXRFbGFwc2VkKCkgLSBUUkFDSy5wYXJ0aWNpcGFudHNbaXAxXS5nZXRFbGFwc2VkKCk7XHJcblx0XHRcdFx0fSk7XHJcblx0XHRcdFx0Zm9yICh2YXIgaXA9MDtpcDxhcnIubGVuZ3RoO2lwKyspXHJcblx0XHRcdFx0e1xyXG5cdFx0XHRcdFx0VFJBQ0sucGFydGljaXBhbnRzW2FycltpcF1dLl9fcG9zPWlwO1xyXG5cdFx0XHRcdFx0aWYgKGlwID09IDApXHJcblx0XHRcdFx0XHRcdGRlbGV0ZSBUUkFDSy5wYXJ0aWNpcGFudHNbYXJyW2lwXV0uX19wcmV2O1xyXG5cdFx0XHRcdFx0ZWxzZVxyXG5cdFx0XHRcdFx0XHRUUkFDSy5wYXJ0aWNpcGFudHNbYXJyW2lwXV0uX19wcmV2PVRSQUNLLnBhcnRpY2lwYW50c1thcnJbaXAtMV1dO1xyXG5cdFx0XHRcdFx0aWYgKGlwID09IFRSQUNLLnBhcnRpY2lwYW50cy5sZW5ndGgtMSlcclxuXHRcdFx0XHRcdFx0ZGVsZXRlICBUUkFDSy5wYXJ0aWNpcGFudHNbYXJyW2lwXV0uX19uZXh0O1xyXG5cdFx0XHRcdFx0ZWxzZVxyXG5cdFx0XHRcdFx0XHRUUkFDSy5wYXJ0aWNpcGFudHNbYXJyW2lwXV0uX19uZXh0PVRSQUNLLnBhcnRpY2lwYW50c1thcnJbaXArMV1dO1xyXG5cdFx0XHRcdH1cclxuXHRcdFx0fVxyXG5cdFx0XHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRcdFx0dmFyIHRpbWVTd2l0Y2ggPSBNYXRoLnJvdW5kKChuZXcgRGF0ZSgpKS5nZXRUaW1lKCkvKDEwMDAqNSkpJTI7XHJcblx0XHRcdHZhciB0b1BhbiA9IFtdO1xyXG5cdFx0XHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRcdFx0aWYgKHRoaXMuc2VsZWN0ZWRQYXJ0aWNpcGFudDEpIFxyXG5cdFx0XHR7XHJcblx0XHRcdFx0dmFyIGN0aW1lID0gdGhpcy5zZWxlY3RlZFBhcnRpY2lwYW50MS5fX2N0aW1lO1xyXG5cdFx0XHRcdHZhciBzcG9zID0gdGhpcy5zZWxlY3RlZFBhcnRpY2lwYW50MS5nZXRGZWF0dXJlKCkuZ2V0R2VvbWV0cnkoKS5nZXRDb29yZGluYXRlcygpO1xyXG5cdFx0XHRcdGlmICghdGhpcy5wb3B1cDEuaXNfc2hvd24pIHtcclxuXHRcdFx0XHQgICAgdGhpcy5wb3B1cDEuc2hvdyhzcG9zLCB0aGlzLnBvcHVwMS5sYXN0SFRNTD10aGlzLnNlbGVjdGVkUGFydGljaXBhbnQxLmdldFBvcHVwSFRNTChjdGltZSkpO1xyXG5cdFx0XHRcdCAgICB0aGlzLnBvcHVwMS5pc19zaG93bj0xO1xyXG5cdFx0XHRcdH0gZWxzZSB7XHJcblx0XHRcdFx0XHRpZiAoIXRoaXMucG9wdXAxLmdldFBvc2l0aW9uKCkgfHwgdGhpcy5wb3B1cDEuZ2V0UG9zaXRpb24oKVswXSAhPSBzcG9zWzBdIHx8IHRoaXMucG9wdXAxLmdldFBvc2l0aW9uKClbMV0gIT0gc3Bvc1sxXSlcclxuXHRcdFx0XHRcdCAgICB0aGlzLnBvcHVwMS5zZXRQb3NpdGlvbihzcG9zKTtcclxuXHRcdFx0XHRcdGlmICghdGhpcy5sYXN0UG9wdXBSZWZlcmVzaDEgfHwgKG5ldyBEYXRlKCkpLmdldFRpbWUoKSAtIHRoaXMubGFzdFBvcHVwUmVmZXJlc2gxID4gMjAwMCkgXHJcblx0XHRcdFx0XHR7XHJcblx0XHRcdFx0XHRcdHRoaXMubGFzdFBvcHVwUmVmZXJlc2gxPShuZXcgRGF0ZSgpKS5nZXRUaW1lKCk7XHJcblx0XHRcdFx0XHQgICAgdmFyIHJyID0gdGhpcy5zZWxlY3RlZFBhcnRpY2lwYW50MS5nZXRQb3B1cEhUTUwoY3RpbWUpO1xyXG5cdFx0XHRcdFx0ICAgIGlmIChyciAhPSB0aGlzLnBvcHVwMS5sYXN0SFRNTCkge1xyXG5cdFx0XHRcdFx0ICAgIFx0dGhpcy5wb3B1cDEubGFzdEhUTUw9cnI7XHJcblx0XHRcdFx0XHRcdCAgICB0aGlzLnBvcHVwMS5jb250ZW50LmlubmVySFRNTD1ycjsgXHJcblx0XHRcdFx0XHQgICAgfVx0XHRcdFx0XHRcclxuXHRcdFx0XHRcdH1cclxuXHRcdFx0XHRcdHRvUGFuLnB1c2goW3RoaXMucG9wdXAxLHNwb3NdKTtcclxuXHRcdFx0XHR9XHJcblx0XHRcdH1cclxuXHRcdFx0aWYgKHRoaXMuc2VsZWN0ZWRQYXJ0aWNpcGFudDIpIFxyXG5cdFx0XHR7XHJcblx0XHRcdFx0dmFyIGN0aW1lID0gdGhpcy5zZWxlY3RlZFBhcnRpY2lwYW50Mi5fX2N0aW1lO1xyXG5cdFx0XHRcdHZhciBzcG9zID0gdGhpcy5zZWxlY3RlZFBhcnRpY2lwYW50Mi5nZXRGZWF0dXJlKCkuZ2V0R2VvbWV0cnkoKS5nZXRDb29yZGluYXRlcygpO1xyXG5cdFx0XHRcdGlmICghdGhpcy5wb3B1cDIuaXNfc2hvd24pIHtcclxuXHRcdFx0XHQgICAgdGhpcy5wb3B1cDIuc2hvdyhzcG9zLCB0aGlzLnBvcHVwMi5sYXN0SFRNTD10aGlzLnNlbGVjdGVkUGFydGljaXBhbnQyLmdldFBvcHVwSFRNTChjdGltZSkpO1xyXG5cdFx0XHRcdCAgICB0aGlzLnBvcHVwMi5pc19zaG93bj0xO1xyXG5cdFx0XHRcdH0gZWxzZSB7XHJcblx0XHRcdFx0XHRpZiAoIXRoaXMucG9wdXAyLmdldFBvc2l0aW9uKCkgfHwgdGhpcy5wb3B1cDIuZ2V0UG9zaXRpb24oKVswXSAhPSBzcG9zWzBdIHx8IHRoaXMucG9wdXAyLmdldFBvc2l0aW9uKClbMV0gIT0gc3Bvc1sxXSlcclxuXHRcdFx0XHRcdCAgICB0aGlzLnBvcHVwMi5zZXRQb3NpdGlvbihzcG9zKTtcclxuXHRcdFx0XHRcdGlmICghdGhpcy5sYXN0UG9wdXBSZWZlcmVzaDIgfHwgKG5ldyBEYXRlKCkpLmdldFRpbWUoKSAtIHRoaXMubGFzdFBvcHVwUmVmZXJlc2gyID4gMjAwMCkgXHJcblx0XHRcdFx0XHR7XHJcblx0XHRcdFx0XHRcdHRoaXMubGFzdFBvcHVwUmVmZXJlc2gyPShuZXcgRGF0ZSgpKS5nZXRUaW1lKCk7XHJcblx0XHRcdFx0XHQgICAgdmFyIHJyID0gdGhpcy5zZWxlY3RlZFBhcnRpY2lwYW50Mi5nZXRQb3B1cEhUTUwoY3RpbWUpO1xyXG5cdFx0XHRcdFx0ICAgIGlmIChyciAhPSB0aGlzLnBvcHVwMi5sYXN0SFRNTCkge1xyXG5cdFx0XHRcdFx0ICAgIFx0dGhpcy5wb3B1cDIubGFzdEhUTUw9cnI7XHJcblx0XHRcdFx0XHRcdCAgICB0aGlzLnBvcHVwMi5jb250ZW50LmlubmVySFRNTD1ycjsgXHJcblx0XHRcdFx0XHQgICAgfVx0XHRcdFx0XHRcclxuXHRcdFx0XHRcdH1cclxuXHRcdFx0XHRcdHRvUGFuLnB1c2goW3RoaXMucG9wdXAyLHNwb3NdKTtcclxuXHRcdFx0XHR9XHJcblx0XHRcdH1cclxuXHRcdFx0Ly8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdFx0XHRpZiAodG9QYW4ubGVuZ3RoID09IDEpIHtcclxuXHRcdFx0XHR0b1BhblswXVswXS5wYW5JbnRvVmlld18odG9QYW5bMF1bMV0pO1xyXG5cdFx0XHR9IGVsc2UgaWYgKHRvUGFuLmxlbmd0aCA9PSAyKSB7XHJcblx0XHRcdFx0dG9QYW5bdGltZVN3aXRjaF1bMF0ucGFuSW50b1ZpZXdfKHRvUGFuW3RpbWVTd2l0Y2hdWzFdKTtcclxuXHRcdFx0fVxyXG5cdFx0XHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tXHRcdFx0XHJcblx0XHRcdGlmICh0aGlzLmlzRGVidWcpICBcclxuXHRcdFx0XHR0aGlzLmRvRGVidWdBbmltYXRpb24oKTtcclxuXHRcdH0sXHJcblx0XHRcclxuXHRcdHNldFNlbGVjdGVkUGFydGljaXBhbnQxIDogZnVuY3Rpb24ocGFydCxjZW50ZXIpIHtcclxuXHRcdFx0Ly8gVE9ETyBSdW1lbiAtIG1lcmdlIHNldFNlbGVjdGVkUGFydGljaXBhbnQxIGFuZCBzZXRTZWxlY3RlZFBhcnRpY2lwYW50MiBpbiBvbmx5IG9uZSBtZXRob2RcclxuXHRcdFx0Ly8gVE9ETyBSdW1lbiAtIGFuZCB1c2Ugb25seSBpdCAtIHByb2JhYmx5IG1lcmdlIHRoZW0gdG9nZXRoZXIgYWxzbyB3aXRoIHNldFNlbGVjdGVkUGFydGljaXBhbnRcclxuXHRcdFx0aWYgKHRoaXMuc2VsZWN0ZWRQYXJ0aWNpcGFudDIgJiYgdGhpcy5zZWxlY3RlZFBhcnRpY2lwYW50MiA9PSBwYXJ0KVxyXG5cdFx0XHRcdHJldHVybjtcclxuXHRcdFx0dGhpcy5zZWxlY3RlZFBhcnRpY2lwYW50MT1wYXJ0O1xyXG5cdFx0XHRpZiAoIXBhcnQpIHtcclxuXHRcdFx0XHR0aGlzLnBvcHVwMS5oaWRlKCk7XHJcblx0XHRcdFx0ZGVsZXRlIHRoaXMucG9wdXAxLmlzX3Nob3duO1xyXG5cdFx0XHR9IGVsc2Uge1xyXG5cdFx0XHRcdHRoaXMubGFzdFBvcHVwUmVmZXJlc2gxPTA7XHJcblx0XHRcdFx0aWYgKGNlbnRlciAmJiBHVUkubWFwICYmIHBhcnQuZmVhdHVyZSkge1xyXG5cdFx0XHRcdFx0dmFyIHggPSAocGFydC5mZWF0dXJlLmdldEdlb21ldHJ5KCkuZ2V0RXh0ZW50KClbMF0rcGFydC5mZWF0dXJlLmdldEdlb21ldHJ5KCkuZ2V0RXh0ZW50KClbMl0pLzI7XHJcblx0XHRcdFx0XHR2YXIgeSA9IChwYXJ0LmZlYXR1cmUuZ2V0R2VvbWV0cnkoKS5nZXRFeHRlbnQoKVsxXStwYXJ0LmZlYXR1cmUuZ2V0R2VvbWV0cnkoKS5nZXRFeHRlbnQoKVszXSkvMjtcclxuXHRcdFx0XHRcdEdVSS5tYXAuZ2V0VmlldygpLnNldENlbnRlcihbeCx5XSk7XHJcblx0XHRcdFx0fVxyXG5cdFx0XHR9IFxyXG5cdFx0fSxcclxuXHJcblx0XHRzZXRTZWxlY3RlZFBhcnRpY2lwYW50MiA6IGZ1bmN0aW9uKHBhcnQsY2VudGVyKSB7XHJcblx0XHRcdGlmICh0aGlzLnNlbGVjdGVkUGFydGljaXBhbnQxICYmIHRoaXMuc2VsZWN0ZWRQYXJ0aWNpcGFudDEgPT0gcGFydClcclxuXHRcdFx0XHRyZXR1cm47XHJcblx0XHRcdHRoaXMuc2VsZWN0ZWRQYXJ0aWNpcGFudDI9cGFydDtcclxuXHRcdFx0aWYgKCFwYXJ0KSB7XHJcblx0XHRcdFx0dGhpcy5wb3B1cDIuaGlkZSgpO1xyXG5cdFx0XHRcdGRlbGV0ZSB0aGlzLnBvcHVwMi5pc19zaG93bjtcclxuXHRcdFx0fSBlbHNlIHtcclxuXHRcdFx0XHR0aGlzLmxhc3RQb3B1cFJlZmVyZXNoMj0wO1xyXG5cdFx0XHRcdGlmIChjZW50ZXIgJiYgR1VJLm1hcCAmJiBwYXJ0LmZlYXR1cmUpIHtcclxuXHRcdFx0XHRcdHZhciB4ID0gKHBhcnQuZmVhdHVyZS5nZXRHZW9tZXRyeSgpLmdldEV4dGVudCgpWzBdK3BhcnQuZmVhdHVyZS5nZXRHZW9tZXRyeSgpLmdldEV4dGVudCgpWzJdKS8yO1xyXG5cdFx0XHRcdFx0dmFyIHkgPSAocGFydC5mZWF0dXJlLmdldEdlb21ldHJ5KCkuZ2V0RXh0ZW50KClbMV0rcGFydC5mZWF0dXJlLmdldEdlb21ldHJ5KCkuZ2V0RXh0ZW50KClbM10pLzI7XHJcblx0XHRcdFx0XHRHVUkubWFwLmdldFZpZXcoKS5zZXRDZW50ZXIoW3gseV0pO1xyXG5cdFx0XHRcdH1cclxuXHRcdFx0fSBcclxuXHRcdH0sXHJcblxyXG5cdFx0c2V0U2VsZWN0ZWRQYXJ0aWNpcGFudCA6IGZ1bmN0aW9uKHBhcnQpIHtcclxuXHRcdFx0aWYgKCF0aGlzLnBvcHVwMS5pc19zaG93bikgIHtcclxuXHRcdFx0XHR0aGlzLnNldFNlbGVjdGVkUGFydGljaXBhbnQxKHBhcnQsIHRydWUpO1xyXG5cdFx0XHR9IGVsc2UgaWYgKCF0aGlzLnBvcHVwMi5pc19zaG93bikge1xyXG5cdFx0XHRcdHRoaXMuc2V0U2VsZWN0ZWRQYXJ0aWNpcGFudDIocGFydCwgdHJ1ZSk7XHJcblx0XHRcdH0gZWxzZSB7XHJcblx0XHRcdFx0dGhpcy5zZXRTZWxlY3RlZFBhcnRpY2lwYW50MShwYXJ0LCB0cnVlKTtcclxuXHRcdFx0fVxyXG5cdFx0fSxcclxuXHJcblx0XHRkb0RlYnVnQW5pbWF0aW9uIDogZnVuY3Rpb24oKSBcclxuXHRcdHtcclxuXHRcdFx0dmFyIGN0aW1lID0gKG5ldyBEYXRlKCkpLmdldFRpbWUoKTtcclxuXHRcdFx0dmFyIHRvZGVsPVtdO1xyXG5cdFx0XHR2YXIgcnIgPSB0aGlzLmRlYnVnTGF5ZXJHUFMuZ2V0U291cmNlKCkuZ2V0RmVhdHVyZXMoKTtcclxuXHRcdFx0Zm9yICh2YXIgaT0wO2k8cnIubGVuZ3RoO2krKylcclxuXHRcdFx0e1xyXG5cdFx0XHRcdHZhciBmID0gcnJbaV07XHJcblx0XHRcdFx0aWYgKGN0aW1lIC0gZi50aW1lQ3JlYXRlZCAtIENPTkZJRy5tYXRoLmRpc3BsYXlEZWxheSoxMDAwID4gQ09ORklHLnRpbWVvdXRzLmdwc0xvY2F0aW9uRGVidWdTaG93KjEwMDApXHJcblx0XHRcdFx0XHR0b2RlbC5wdXNoKGYpO1xyXG5cdFx0XHRcdGVsc2VcclxuXHRcdFx0XHRcdGYuY2hhbmdlZCgpO1xyXG5cdFx0XHR9XHJcblx0XHRcdGlmICh0b2RlbC5sZW5ndGgpIFxyXG5cdFx0XHR7XHJcblx0XHRcdFx0Zm9yICh2YXIgaT0wO2k8dG9kZWwubGVuZ3RoO2krKylcclxuXHRcdFx0XHRcdHRoaXMuZGVidWdMYXllckdQUy5nZXRTb3VyY2UoKS5yZW1vdmVGZWF0dXJlKHRvZGVsW2ldKTtcclxuXHRcdFx0fVxyXG5cdFx0XHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRcdH0sXHJcblx0XHRcclxuXHRcdHJlZHJhdyA6IGZ1bmN0aW9uKCkge1xyXG5cdFx0XHR0aGlzLmdldFRyYWNrKCkuZ2V0RmVhdHVyZSgpLmNoYW5nZWQoKTtcclxuXHRcdH0sXHJcblxyXG4gICAgICAgIC8qKlxyXG4gICAgICAgICAqIFNob3cgdGhlIGxpdmUtc3RyZWFtaW5nIGNvbnRhaW5lci4gSWYgdGhlIHBhc3NlZCAnc3RyZWFtSWQnIGlzIHZhbGlkIHRoZW4gaXQgb3BlbnMgaXRzIHN0cmVhbSBkaXJlY3RseS5cclxuICAgICAgICAgKiBAcGFyYW0ge1N0cmluZ30gW3N0cmVhbUlkXVxyXG4gICAgICAgICAqIEBwYXJhbSB7RnVuY3Rpb259IFtjb21wbGV0ZUNhbGxiYWNrXVxyXG4gICAgICAgICAqL1xyXG4gICAgICAgIHNob3dMaXZlU3RyZWFtIDogZnVuY3Rpb24oc3RyZWFtSWQsIGNvbXBsZXRlQ2FsbGJhY2spIHtcclxuICAgICAgICAgICAgdGhpcy5saXZlU3RyZWFtLnNob3coc3RyZWFtSWQsIGNvbXBsZXRlQ2FsbGJhY2spO1xyXG4gICAgICAgIH0sXHJcblxyXG4gICAgICAgIC8qKlxyXG4gICAgICAgICAqIFRvZ2dsZSB0aGUgbGl2ZS1zdHJlYW1pbmcgY29udGFpbmVyIGNvbnRhaW5lclxyXG5cdFx0ICogQHBhcmFtIHtGdW5jdGlvbn0gW2NvbXBsZXRlQ2FsbGJhY2tdXHJcbiAgICAgICAgICovXHJcbiAgICAgICAgdG9nZ2xlTGl2ZVN0cmVhbTogZnVuY3Rpb24oY29tcGxldGVDYWxsYmFjaykge1xyXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5saXZlU3RyZWFtLnRvZ2dsZShjb21wbGV0ZUNhbGxiYWNrKTtcclxuICAgICAgICB9XHJcblx0XHRcclxuICAgIH1cclxufSk7IiwicmVxdWlyZSgnam9vc2UnKTtcclxucmVxdWlyZSgnLi9Qb2ludCcpO1xyXG5yZXF1aXJlKCcuL1V0aWxzJyk7XHJcblxyXG5DbGFzcyhcIkhvdFNwb3RcIiwge1xyXG4gICAgaXNhIDogUG9pbnQsXHJcblxyXG4gICAgaGFzIDoge1xyXG4gICAgICAgIHR5cGUgOiB7XHJcbiAgICAgICAgICAgIGlzIDogXCJyb1wiLFxyXG4gICAgICAgICAgICByZXF1aXJlZCA6IHRydWUsXHJcbiAgICAgICAgICAgIGluaXQgOiBudWxsXHJcbiAgICAgICAgfSxcclxuXHJcbiAgICAgICAgY2xpY2thYmxlIDoge1xyXG4gICAgICAgICAgICBpbml0IDogZmFsc2VcclxuICAgICAgICB9LFxyXG5cclxuICAgICAgICBsaXZlU3RyZWFtIDoge1xyXG4gICAgICAgICAgICBpbml0IDogbnVsbFxyXG4gICAgICAgIH1cclxuICAgIH0sXHJcblxyXG4gICAgYWZ0ZXIgOiB7XHJcbiAgICAgICAgaW5pdCA6IGZ1bmN0aW9uKCkge1xyXG4gICAgICAgICAgICB0aGlzLmZlYXR1cmUuaG90c3BvdD10aGlzO1xyXG4gICAgICAgICAgICBHVUkuaG90c3BvdHNMYXllci5nZXRTb3VyY2UoKS5hZGRGZWF0dXJlKHRoaXMuZmVhdHVyZSk7XHJcbiAgICAgICAgfVxyXG4gICAgfSxcclxuXHJcbiAgICBtZXRob2RzIDoge1xyXG4gICAgICAgIG9uQ2xpY2sgOiBmdW5jdGlvbigpIHtcclxuICAgICAgICAgICAgdmFyIGlzQ29uc3VtZWQgPSBmYWxzZTtcclxuXHJcbiAgICAgICAgICAgIGlmICh0aGlzLmNsaWNrYWJsZSkge1xyXG4gICAgICAgICAgICAgICAgLy8gZm9yIG5vdyBvbmx5IGhvdHNwb3RzIHdpdGggYXR0YWNoZWQgbGl2ZS1zdHJlYW0gY2FuIGJlIGNsaWNrZWRcclxuICAgICAgICAgICAgICAgIGlmIChpc0RlZmluZWQodGhpcy5saXZlU3RyZWFtKSkge1xyXG4gICAgICAgICAgICAgICAgICAgIEdVSS5zaG93TGl2ZVN0cmVhbSh0aGlzLmxpdmVTdHJlYW0pO1xyXG4gICAgICAgICAgICAgICAgICAgIC8vIHdlbGwgdGhpcyBldmVudCBzaG91bGQgYmUgY29uc3VtZWQgYW5kIG5vdCBoYW5kbGVkIGFueSBtb3JlIChsaWtlIHdoZW4gY2xpY2tlZCBvbiBhbm90aGVyIGZlYXR1cmVcclxuICAgICAgICAgICAgICAgICAgICBpc0NvbnN1bWVkID0gdHJ1ZTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgcmV0dXJuIGlzQ29uc3VtZWRcclxuICAgICAgICB9LFxyXG5cclxuICAgICAgICBpc0NsaWNrYWJsZSA6IGZ1bmN0aW9uKCkge1xyXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5jbGlja2FibGU7XHJcbiAgICAgICAgfVxyXG5cclxuICAgIH1cclxufSk7IiwiLypcclxuXHJcblx0Q1VTVE9NSEFDSyBJTiBqcXVlcnkuZnVsbFBhZ2UuanNcclxuXHRUT0RPIDogRklYIElOIExBVEVSIFJFTEVBU0VTXHJcblx0XHJcblx0ICAgIGZ1bmN0aW9uIHRvdWNoTW92ZUhhbmRsZXIoZXZlbnQpe1xyXG4gICAgICAgIFx0Ly8gSEFDS1xyXG4gICAgICAgIFx0aWYgKHRoaXMuX19kaXNhYmxlKVxyXG4gICAgICAgIFx0XHRyZXR1cm47XHJcbiAgICAgICAgXHRcdFxyXG4gICAgICAgIC4uXHJcbiAgICAgICAgZnVuY3Rpb24gdG91Y2hTdGFydEhhbmRsZXIoZXZlbnQpIHtcclxuICAgICAgICBcdC8vIEhBQ0sgXHJcbiAgICAgICAgXHRpZiAoISQoZXZlbnQudGFyZ2V0KS5pcyhcImgxXCIpKSB7XHJcbiAgICAgICAgXHRcdHRoaXMuX19kaXNhYmxlPTE7XHJcbiAgICAgICAgXHRcdHJldHVybjsgICAgICAgIFx0XHJcbiAgICAgICAgXHR9XHJcbiAgICAgICAgXHR0aGlzLl9fZGlzYWJsZT0wO1xyXG4gICAgICAgIC4uXHJcbiAqIFxyXG4gKi9cclxuLy8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxucmVxdWlyZSgnLi9UcmFjaycpO1xyXG5yZXF1aXJlKCcuL0d1aScpO1xyXG5yZXF1aXJlKCcuL1BhcnRpY2lwYW50Jyk7XHJcbnJlcXVpcmUoJy4vTW92aW5nQ2FtJyk7XHJcbnJlcXVpcmUoJy4vSG90U3BvdCcpO1xyXG52YXIgU1RZTEVTPXJlcXVpcmUoJy4vU3R5bGVzJyk7XHJcbndpbmRvdy5DT05GSUcgPSByZXF1aXJlKCcuL0NvbmZpZycpO1xyXG52YXIgVXRpbHMgPSByZXF1aXJlKCcuL1V0aWxzJyk7XHJcbmZvciAodmFyIGUgaW4gVXRpbHMpXHJcbiAgICB3aW5kb3dbZV0gPSBVdGlsc1tlXTtcclxuLy8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuZnVuY3Rpb24gZ2V0U2VhcmNoUGFyYW1ldGVycygpIHtcclxuICAgIHZhciBwcm1zdHIgPSB3aW5kb3cubG9jYXRpb24uc2VhcmNoLnN1YnN0cigxKTtcclxuICAgIHJldHVybiBwcm1zdHIgIT0gbnVsbCAmJiBwcm1zdHIgIT0gXCJcIiA/IHRyYW5zZm9ybVRvQXNzb2NBcnJheShwcm1zdHIpIDoge307XHJcbn1cclxuZnVuY3Rpb24gdHJhbnNmb3JtVG9Bc3NvY0FycmF5KHBybXN0cikge1xyXG4gICAgdmFyIHBhcmFtcyA9IHt9O1xyXG4gICAgdmFyIHBybWFyciA9IHBybXN0ci5zcGxpdChcIiZcIik7XHJcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IHBybWFyci5sZW5ndGg7IGkrKykge1xyXG4gICAgICAgIHZhciB0bXBhcnIgPSBwcm1hcnJbaV0uc3BsaXQoXCI9XCIpO1xyXG4gICAgICAgIHBhcmFtc1t0bXBhcnJbMF1dID0gdG1wYXJyWzFdO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIHBhcmFtcztcclxufVxyXG53aW5kb3cub25PcGVuID0gZnVuY3Rpb24oaWQpIHtcclxuXHR3aW5kb3cubG9jYXRpb24uaHJlZj1cImxpdmUuaHRtbD9ldmVudD1cIitlbmNvZGVVUklDb21wb25lbnQoaWQpO1xyXG59XHJcbnZhciBwYXJhbXMgPSBnZXRTZWFyY2hQYXJhbWV0ZXJzKCk7XHJcbi8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuJC5hamF4KHtcclxuICAgIHR5cGU6IFwiR0VUXCIsXHJcbiAgICB1cmw6IFwiL2V2ZW50c1wiLFxyXG4gICAgY29udGVudFR5cGU6IFwiYXBwbGljYXRpb24vanNvbjsgY2hhcnNldD11dGYtOFwiLFxyXG4gICAgZGF0YVR5cGU6IFwianNvblwiLFxyXG4gICAgc3VjY2VzczogZnVuY3Rpb24oZGF0YSlcclxuICAgIHtcclxuICAgIFx0XHJcbiAgICBcdHZhciB0dD1bXTtcclxuICAgIFx0Zm9yICh2YXIgZSBpbiBkYXRhLmRhdGEpIFxyXG4gICAgXHR7XHJcbiAgICBcdFx0dmFyIGV2ID0gZGF0YS5kYXRhW2VdO1xyXG4gICAgXHRcdHZhciB0cmFjaz1KU09OLnBhcnNlKGV2LnRyYWNrKTsgICAgICAgIFx0XHRcclxuICAgIFx0XHR2YXIgZXh0ZW50ID0gb2wucHJvai50cmFuc2Zvcm1FeHRlbnQoIChuZXcgb2wuZ2VvbS5MaW5lU3RyaW5nKHRyYWNrKSkuZ2V0RXh0ZW50KCkgLCAnRVBTRzo0MzI2JywgJ0VQU0c6Mzg1NycpO1xyXG4gICAgXHRcdHZhciBoMXQgPSBcIjxkaXYgY2xhc3M9J2NudCcgaWQ9J2NudFwiK2UrXCInPlwiK2V2LmNvZGUrXCI8ZGl2IGNsYXNzPSdkdXInPlwiK2V2LnN0YXJ0VGltZStcIiZuYnNwOyZuYnNwOyZuYnNwOyZuYnNwO1wiK2V2LmVuZFRpbWUrXCI8L2Rpdj48L2Rpdj5cIjtcclxuICAgIFx0XHR2YXIgbWRpdiA9ICQoXCIjZnVsbHBhZ2VcIikuYXBwZW5kKCc8ZGl2IGNsYXNzPVwic2VjdGlvbiAnKyhlID09IDAgPyAnYWN0aXZlJyA6ICcnKSsnXCIgaWQ9XCJzZWN0aW9uJytlKydcIj48ZGl2IGNsYXNzPVwicHJlXCIgaWQ9XCJwcmUnK2UrJ1wiPjwvZGl2PjxkaXYgY2xhc3M9XCJmcmVcIiBpZD1cImZyZScrZSsnXCI+PGgxPicraDF0Kyc8L2gxPjwvZGl2PjxtZW51IGNsYXNzPVwibWVkaXVtIHBsYXlidG5cIj48YnV0dG9uIGNsYXNzPVwicGxheVwiIG9uY2xpY2s9XCJvbk9wZW4oXFwnJytldi5pZCsnXFwnKVwiPjwvYnV0dG9uPjwvbWVudT48L2Rpdj4nKTtcclxuICAgIFx0XHR0dC5wdXNoKGV2LmNvZGUpO1xyXG5cdFx0XHR2YXIgcmFzdGVyID0gbmV3IG9sLmxheWVyLlRpbGUoe3NvdXJjZSA6IG5ldyBvbC5zb3VyY2UuT1NNKCkvKixleHRlbnQgOiBleHRlbnQqLyB9KTtcclxuXHRcdFx0dmFyIHRyYWNrTGF5ZXIgPSBuZXcgb2wubGF5ZXIuVmVjdG9yKHtcclxuXHRcdFx0XHQgIHNvdXJjZTogbmV3IG9sLnNvdXJjZS5WZWN0b3IoKSxcclxuXHRcdFx0XHQgIHN0eWxlIDogU1RZTEVTW1widHJhY2tcIl1cclxuXHRcdFx0XHQgIC8vZXh0ZW50IDogZXh0ZW50XHJcblx0XHRcdH0pO1xyXG5cdFx0XHR2YXIgbWFwID0gbmV3IG9sLk1hcCh7XHJcblx0XHRcdFx0bG9nbyA6IGZhbHNlLFxyXG5cdFx0XHRcdGludGVyYWN0aW9ucyA6IG9sLmludGVyYWN0aW9uLmRlZmF1bHRzKHtcclxuXHRcdFx0XHRcdG1vdXNlV2hlZWxab29tIDogZmFsc2VcclxuXHRcdFx0XHR9KSxcclxuXHRcdFx0XHR0YXJnZXQgOiAncHJlJyArIGUsXHJcblx0XHRcdFx0bGF5ZXJzIDogWyByYXN0ZXIsdHJhY2tMYXllciBdLFxyXG5cdFx0XHRcdGNvbnRyb2xzIDogb2wuY29udHJvbC5kZWZhdWx0cygpLFxyXG5cdFx0XHRcdHZpZXcgOiBuZXcgb2wuVmlldyh7XHJcblx0XHRcdFx0XHRjZW50ZXIgOiBbIDczOTIxOCwgNTkwNjA5NiBdLFxyXG5cdFx0XHRcdFx0bWluWm9vbSA6IDEsXHJcblx0XHRcdFx0XHRtYXhab29tIDogMTcsXHJcblx0XHRcdFx0XHR6b29tIDogMTdcclxuXHRcdFx0XHRcdC8vZXh0ZW50IDogZXh0ZW50XHJcblx0XHRcdFx0fSlcclxuXHRcdFx0fSk7XHJcblx0XHRcdC8vbWFwLmdldFZpZXcoKS5maXRFeHRlbnQoZXh0ZW50LCBtYXAuZ2V0U2l6ZSgpKTtcclxuXHRcdFx0Ly8tLS0tLS0tXHJcblx0XHRcdHZhciBUUkFDSyA9IG5ldyBUcmFjaygpO1xyXG5cdFx0XHRUUkFDSy5zZXRCaWtlU3RhcnRLTShwYXJzZUZsb2F0KGV2LmJpa2VTdGFydEtNKSk7XHJcblx0ICAgICAgICBUUkFDSy5zZXRSdW5TdGFydEtNKHBhcnNlRmxvYXQoZXYucnVuU3RhcnRLTSkpO1xyXG5cdCAgICAgICAgVFJBQ0suc2V0Um91dGUodHJhY2spO1xyXG5cdCAgICAgICAgd2luZG93LkdVSSA9IG5ldyBPYmplY3QoKTtcclxuXHQgICAgICAgIEdVSS5pc1Nob3dTd2ltPXRydWU7XHJcblx0ICAgICAgICBHVUkuaXNTaG93QmlrZT10cnVlO1xyXG5cdCAgICAgICAgR1VJLmlzU2hvd1J1bj10cnVlO1xyXG5cdCAgICAgICAgR1VJLm1hcD1tYXA7XHJcblx0ICAgICAgICBUUkFDSy5pbml0KCk7XHJcblx0ICAgICAgICB0cmFja0xheWVyLmdldFNvdXJjZSgpLmFkZEZlYXR1cmUoVFJBQ0suZmVhdHVyZSk7XHJcblx0ICAgICAgICAvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdCAgICAgICAgLy9wb2ludGVyLWV2ZW50cyA6IG5vbmU7XHJcbiAgICBcdH1cclxuXHRcdCQoJyNmdWxscGFnZScpLmZ1bGxwYWdlKHtcclxuXHRcdFx0Y3NzMyA6IGZhbHNlLFxyXG5cdFx0XHRuYXZpZ2F0aW9uIDogdHJ1ZSxcclxuXHRcdFx0bmF2aWdhdGlvblBvc2l0aW9uIDogJ3JpZ2h0JyxcclxuXHRcdFx0bmF2aWdhdGlvblRvb2x0aXBzIDogdHRcclxuXHRcdH0pO1xyXG4gICBcdCBcdCQoXCIuZnJlLGgxXCIpLmNzcyhcInBvaW50ZXItZXZlbnRzXCIsXCJub25lXCIpO1xyXG4gICAgICAgIGlmKCEgL0FuZHJvaWR8d2ViT1N8aVBob25lfGlQYWR8aVBvZHxCbGFja0JlcnJ5fElFTW9iaWxlfE9wZXJhIE1pbmkvaS50ZXN0KG5hdmlnYXRvci51c2VyQWdlbnQpICkge1xyXG4gICAgICAgfSBlbHNlIHtcclxuICAgIFx0ICAgLy8gTU9CSUxFICAgICAgXHQgICBcclxuICAgICAgIH1cclxuXHR9LFxyXG5cdGZhaWx1cmUgOiBmdW5jdGlvbihlcnJNc2cpIHtcclxuXHRcdGNvbnNvbGUuZXJyb3IoXCJFUlJPUiBnZXQgZGF0YSBmcm9tIGJhY2tlbmQgXCIgKyBlcnJNc2cpXHJcblx0fVxyXG59KTsiLCJyZXF1aXJlKCdqb29zZScpO1xyXG5yZXF1aXJlKCcuL1V0aWxzJyk7XHJcblxyXG5DbGFzcyhcIkxpdmVTdHJlYW1cIiwge1xyXG4gICAgaGFzIDoge1xyXG4gICAgICAgIF8kY29tcCA6IHtcclxuICAgICAgICAgICAgaW5pdDogZnVuY3Rpb24oY29uZmlnKSB7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gJCgnIycgKyBjb25maWcuaWQpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfSxcclxuXHJcbiAgICAgICAgX2lzU2hvd24gOiB7XHJcbiAgICAgICAgICAgaW5pdCA6IGZhbHNlXHJcbiAgICAgICAgfSxcclxuXHJcbiAgICAgICAgX2lzVmFsaWQgOiB7XHJcbiAgICAgICAgICAgIGluaXQgOiBmYWxzZVxyXG4gICAgICAgIH1cclxuICAgIH0sXHJcbiAgICBtZXRob2RzOiB7XHJcbiAgICAgICAgaW5pdGlhbGl6ZTogZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgICAgIHZhciBsaXZlU3RyZWFtcyA9IHdpbmRvdy5MSVZFX1NUUkVBTVM7XHJcbiAgICAgICAgICAgIGlmICghbGl2ZVN0cmVhbXMgfHwgbGl2ZVN0cmVhbXMubGVuZ3RoIDw9IDApIHtcclxuICAgICAgICAgICAgICAgIGNvbnNvbGUud2FybihcIk5vIGxpdmUgc3RyZWFtcyBzZXRcIik7XHJcbiAgICAgICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIC8vIGluaXRpYWxpemUgdGhlIHN0cmVhbXNcclxuICAgICAgICAgICAgdmFyIHNlbGYgPSB0aGlzO1xyXG4gICAgICAgICAgICB2YXIgaSA9IDA7XHJcbiAgICAgICAgICAgIHRoaXMuXyRjb21wLmZpbmQoXCIubGl2ZVN0cmVhbVRodW1iXCIpLmFkZENsYXNzKFwiaW5hY3RpdmVcIikuZWFjaChmdW5jdGlvbigpIHtcclxuICAgICAgICAgICAgICAgIHZhciBzdHJlYW0gPSBsaXZlU3RyZWFtc1tpXTtcclxuICAgICAgICAgICAgICAgIGkrKztcclxuICAgICAgICAgICAgICAgIGlmICghc3RyZWFtKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgJCh0aGlzKS5hZGRDbGFzcyhcInZhbGlkXCIpLmRhdGEoXCJpZFwiLCBzdHJlYW0uaWQpLmRhdGEoXCJ1cmxcIiwgc3RyZWFtLnVybCk7XHJcblxyXG4gICAgICAgICAgICAgICAgLy8gYXQgbGVhc3Qgb25lIHZhbGlkIHRodW1iIC0gc28gdGhlIHdob2xlIExpdmVTdHJlYW0gaXMgdmFsaWRcclxuICAgICAgICAgICAgICAgIHNlbGYuX2lzVmFsaWQgPSB0cnVlO1xyXG4gICAgICAgICAgICB9KS5maWx0ZXIoXCIudmFsaWRcIikuY2xpY2soZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgICAgICAgICB2YXIgJHRoaXMgPSAkKHRoaXMpO1xyXG5cclxuICAgICAgICAgICAgICAgIC8vIGlmIGNsaWNrZWQgb24gdGhlIHNhbWUgYWN0aXZlIHRodW1iIHRoZW4gc2tpcCBpdFxyXG4gICAgICAgICAgICAgICAgaWYgKCEkdGhpcy5oYXNDbGFzcyhcImluYWN0aXZlXCIpKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgICAgc2VsZi5fc2hvd1N0cmVhbSgkdGhpcyk7XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgIH0sXHJcblxyXG4gICAgICAgIHNob3c6IGZ1bmN0aW9uKHN0cmVhbUlkLCBjb21wbGV0ZUNhbGxiYWNrKSB7XHJcbiAgICAgICAgICAgIGlmICghdGhpcy5faXNWYWxpZClcclxuICAgICAgICAgICAgICAgcmV0dXJuO1xyXG5cclxuICAgICAgICAgICAgdmFyICR0aHVtYiA9IG51bGw7XHJcbiAgICAgICAgICAgIHZhciAkdGh1bWJzID0gdGhpcy5fJGNvbXAuZmluZChcIi5saXZlU3RyZWFtVGh1bWIudmFsaWRcIik7XHJcbiAgICAgICAgICAgIGlmICghaXNEZWZpbmVkKHN0cmVhbUlkKSkge1xyXG4gICAgICAgICAgICAgICAgJHRodW1iID0gJHRodW1icy5lcSgwKTtcclxuICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgICR0aHVtYnMuZWFjaChmdW5jdGlvbigpIHtcclxuICAgICAgICAgICAgICAgICAgICBpZiAoc3RyZWFtSWQgPT09ICQodGhpcykuZGF0YShcImlkXCIpKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICR0aHVtYiA9ICQodGhpcyk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBmYWxzZTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgaWYgKCEkdGh1bWIpIHtcclxuICAgICAgICAgICAgICAgIGNvbnNvbGUud2FybihcIk5vIHN0cmVhbSBmb3IgaWQgOiBcIiArIHN0cmVhbUlkKTtcclxuICAgICAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgdGhpcy5fc2hvd1N0cmVhbSgkdGh1bWIsIGNvbXBsZXRlQ2FsbGJhY2spO1xyXG4gICAgICAgIH0sXHJcblxyXG4gICAgICAgIC8qKlxyXG4gICAgICAgICAqXHJcbiAgICAgICAgICogQHJldHVybiB7Ym9vbGVhbn1cclxuICAgICAgICAgKi9cclxuICAgICAgICB0b2dnbGUgOiBmdW5jdGlvbihjb21wbGV0ZUNhbGxiYWNrKSB7XHJcbiAgICAgICAgICAgIGlmICghdGhpcy5faXNWYWxpZClcclxuICAgICAgICAgICAgICAgIHJldHVybjtcclxuXHJcbiAgICAgICAgICAgIC8vIGlmIHNob3duIGhpZGUgb3RoZXJ3aXNlIHNob3dcclxuICAgICAgICAgICAgaWYgKHRoaXMuX2lzU2hvd24pXHJcbiAgICAgICAgICAgICAgICB0aGlzLl9oaWRlKGNvbXBsZXRlQ2FsbGJhY2spO1xyXG4gICAgICAgICAgICBlbHNlXHJcbiAgICAgICAgICAgICAgICB0aGlzLnNob3coY29tcGxldGVDYWxsYmFjayk7XHJcblxyXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5faXNTaG93bjtcclxuICAgICAgICB9LFxyXG5cclxuICAgICAgICAvKiBQcml2YXRlIE1ldGhvZHMgKi9cclxuXHJcbiAgICAgICAgX2hpZGUgOiBmdW5jdGlvbihjb21wbGV0ZUNhbGxiYWNrKSB7XHJcbiAgICAgICAgICAgIHZhciBzZWxmID0gdGhpcztcclxuICAgICAgICAgICAgdGhpcy5fJGNvbXAuc2xpZGVVcCg0MDAsIGZ1bmN0aW9uKCkge1xyXG4gICAgICAgICAgICAgICAgLy8gc3RvcCB0aGUgc3RyZWFtIHdoZW4gd2hvbGUgcGFuZWwgaGFzIGNvbXBsZXRlZCBhbmltYXRpb25cclxuICAgICAgICAgICAgICAgIHNlbGYuXyRjb21wLmZpbmQoXCIubGl2ZVN0cmVhbVBsYXllclwiKS5lbXB0eSgpO1xyXG4gICAgICAgICAgICAgICAgY29tcGxldGVDYWxsYmFjaygpO1xyXG4gICAgICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgICAgIHRoaXMuX2lzU2hvd24gPSBmYWxzZTtcclxuICAgICAgICB9LFxyXG5cclxuICAgICAgICBfc2hvd1N0cmVhbSA6IGZ1bmN0aW9uKCR0aHVtYiwgY29tcGxldGVDYWxsYmFjaykge1xyXG4gICAgICAgICAgICAvLyB0b2dnbGUgdGhlIFwiaW5hY3RpdmVcIiBjbGFzc1xyXG4gICAgICAgICAgICB0aGlzLl8kY29tcC5maW5kKFwiLmxpdmVTdHJlYW1UaHVtYlwiKS5hZGRDbGFzcyhcImluYWN0aXZlXCIpO1xyXG4gICAgICAgICAgICAkdGh1bWIucmVtb3ZlQ2xhc3MoXCJpbmFjdGl2ZVwiKTtcclxuXHJcbiAgICAgICAgICAgIC8vIHNob3cgdGhlIG5ldyBzdHJlYW1cclxuICAgICAgICAgICAgdmFyIHVybCA9ICR0aHVtYi5kYXRhKFwidXJsXCIpO1xyXG4gICAgICAgICAgICB2YXIgJHBsYXllciA9IHRoaXMuXyRjb21wLmZpbmQoXCIubGl2ZVN0cmVhbVBsYXllclwiKTtcclxuXHJcbiAgICAgICAgICAgIC8vIHdpZHRoPTQ5MCZoZWlnaHQ9Mjc1JlxyXG4gICAgICAgICAgICAvLyB3aWR0aD1cIjQ5MFwiIGhlaWdodD1cIjI3NVwiXHJcbiAgICAgICAgICAgICRwbGF5ZXIuaHRtbCgnPGlmcmFtZSBzcmM9JyArIHVybCArICc/YXV0b1BsYXk9dHJ1ZSZtdXRlPWZhbHNlXCIgZnJhbWVib3JkZXI9XCIwXCIgc2Nyb2xsaW5nPVwibm9cIiAnK1xyXG4gICAgICAgICAgICAnYWxsb3dmdWxsc2NyZWVuIHdlYmtpdGFsbG93ZnVsbHNjcmVlbiBtb3phbGxvd2Z1bGxzY3JlZW4gb2FsbG93ZnVsbHNjcmVlbiBtc2FsbG93ZnVsbHNjcmVlbj48L2lmcmFtZT4nKTtcclxuXHJcbiAgICAgICAgICAgIC8vIHNob3cgaWYgbm90IGFscmVhZHkgc2hvd25cclxuICAgICAgICAgICAgaWYgKCF0aGlzLl9pc1Nob3duKVxyXG4gICAgICAgICAgICAgICAgdGhpcy5fJGNvbXAuc2xpZGVEb3duKDQwMCwgY29tcGxldGVDYWxsYmFjayk7XHJcbiAgICAgICAgICAgIHRoaXMuX2lzU2hvd24gPSB0cnVlO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxufSk7IiwicmVxdWlyZSgnam9vc2UnKTtcclxucmVxdWlyZSgnLi9QYXJ0aWNpcGFudCcpO1xyXG5cclxuQ2xhc3MoXCJNb3ZpbmdDYW1cIiwge1xyXG4gICAgaXNhIDogUGFydGljaXBhbnQsXHJcblxyXG4gICAgb3ZlcnJpZGUgOiB7XHJcbiAgICAgICAgaW5pdEZlYXR1cmUgOiBmdW5jdGlvbigpIHtcclxuICAgICAgICAgICAgdGhpcy5mZWF0dXJlLmNhbT10aGlzO1xyXG4gICAgICAgICAgICBHVUkuY2Ftc0xheWVyLmdldFNvdXJjZSgpLmFkZEZlYXR1cmUodGhpcy5mZWF0dXJlKTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbn0pOyIsInJlcXVpcmUoJ2pvb3NlJyk7XHJcbnJlcXVpcmUoJy4vUG9pbnQnKTtcclxudmFyIFJCVHJlZSA9IHJlcXVpcmUoJ2JpbnRyZWVzJykuUkJUcmVlO1xyXG52YXIgQ09ORklHID0gcmVxdWlyZSgnLi9Db25maWcnKTtcclxudmFyIFV0aWxzID0gcmVxdWlyZSgnLi9VdGlscycpO1xyXG52YXIgSW50ZXJzZWN0aW9uID0gcmVxdWlyZShcImtsZC1pbnRlcnNlY3Rpb25zXCIpLkludGVyc2VjdGlvbjtcclxudmFyIFBvaW50MkQgPSByZXF1aXJlKFwia2xkLWludGVyc2VjdGlvbnNcIikuUG9pbnQyRDtcclxuXHJcbnZhciBjb2VmeSA9IENPTkZJRy5tYXRoLnByb2plY3Rpb25TY2FsZVk7XHJcbkNsYXNzKFwiUGFydGljaXBhbnRTdGF0ZVwiLFxyXG57XHJcblx0aGFzIDoge1x0XHRcclxuICAgIFx0ZGVidWdJbmZvIDoge1xyXG4gICAgXHRcdGlzIDogXCJyd1wiLFxyXG4gICAgXHRcdGluaXQgOiBudWxsXHJcbiAgICBcdH0sXHJcblx0XHRzcGVlZCA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiAwXHJcblx0XHR9LFxyXG5cdFx0ZWxhcHNlZCA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiAwXHJcblx0XHR9LFxyXG5cdCAgICB0aW1lc3RhbXAgOiBcclxuXHRcdHtcclxuXHQgICAgICAgIGlzOiAgIFwicndcIixcclxuXHQgICAgICAgIGluaXQ6IDBcdC8vbG9uIGxhdCB3b3JsZCBtZXJjYXRvclxyXG5cdCAgICB9LFxyXG5cdCAgICBncHMgOiB7XHJcblx0ICAgIFx0aXM6ICAgXCJyd1wiLFxyXG5cdCAgICAgICAgaW5pdDogWzAsMF1cdC8vbG9uIGxhdCB3b3JsZCBtZXJjYXRvclxyXG5cdCAgICB9LFxyXG5cdFx0ZnJlcSA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiAwXHJcblx0XHR9LFxyXG5cdFx0aXNTT1MgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogZmFsc2VcclxuXHRcdH0sXHJcblx0XHRpc0Rpc2NhcmRlZCA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiBmYWxzZVxyXG5cdFx0fSxcclxuXHRcdGFjY2VsZXJhdGlvbiA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiAwXHJcblx0XHR9LFxyXG5cdFx0YWx0IDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IDBcclxuXHRcdH0sXHJcblx0XHRvdmVyYWxsUmFuayA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiAwXHJcblx0XHR9LFxyXG5cdFx0Z2VuZGVyUmFuayA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiAwXHJcblx0XHR9LFxyXG5cdFx0Z3JvdXBSYW5rIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IDBcclxuXHRcdH1cclxuXHR9XHJcbn0pO1x0XHRcclxuLy8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcbkNsYXNzKFwiTW92aW5nUG9pbnRcIiwge1xyXG5cdGlzYSA6IFBvaW50LFxyXG5cclxuXHRoYXMgOiB7XHJcblx0XHRkZXZpY2VJZCA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiBcIkRFVklDRV9JRF9OT1RfU0VUXCJcclxuXHRcdH1cclxuXHR9XHJcbn0pO1xyXG4vLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuQ2xhc3MoXCJQYXJ0aWNpcGFudFwiLFxyXG57XHJcblx0aXNhIDogTW92aW5nUG9pbnQsXHJcblxyXG4gICAgaGFzOiBcclxuXHR7XHRcclxuICAgIFx0bGFzdFBpbmdUaW1lc3RhbXAgOiB7XHJcbiAgICBcdFx0aXMgOiBcInJ3XCIsXHJcbiAgICBcdFx0aW5pdCA6IG51bGxcclxuICAgIFx0fSxcclxuICAgIFx0c2lnbmFsTG9zdERlbGF5IDoge1xyXG4gICAgXHRcdGlzIDogXCJyd1wiLFxyXG4gICAgXHRcdGluaXQgOiBudWxsXHJcbiAgICBcdH0sXHJcbiAgICBcdGxhc3RSZWFsRGVsYXkgOiB7XHJcbiAgICBcdFx0aXMgOiBcInJ3XCIsXHJcbiAgICBcdFx0aW5pdCA6IDBcclxuICAgIFx0fSxcclxuICAgIFx0dHJhY2sgOiB7XHJcbiAgICBcdFx0aXMgOiBcInJ3XCJcclxuICAgIFx0fSxcclxuICAgIFx0c3RhdGVzIDoge1xyXG4gICAgXHRcdGlzIDogXCJyd1wiLFxyXG4gICAgXHRcdGluaXQgOiBuZXcgUkJUcmVlKGZ1bmN0aW9uKGEsIGIpIHsgcmV0dXJuIGEudGltZXN0YW1wIC0gYi50aW1lc3RhbXA7IH0pXHJcbiAgICBcdFx0XHJcbiAgICBcdH0sXHJcblx0XHRpc1RpbWVkT3V0IDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IGZhbHNlXHJcblx0XHR9LFxyXG5cdFx0aXNEaXNjYXJkZWQgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogZmFsc2VcclxuXHRcdH0sXHJcblx0XHRpc1NPUyA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiBmYWxzZVxyXG5cdFx0fSxcclxuXHRcdGljb246IHtcclxuXHRcdFx0aXM6IFwicndcIixcclxuXHQgICAgICAgIGluaXQ6IFwiaW1nL3BsYXllcjEucG5nXCJcclxuXHQgICAgfSxcclxuXHQgICAgaW1hZ2UgOlx0e1xyXG5cdCAgICAgICAgaXM6ICAgXCJyd1wiLFxyXG5cdCAgICAgICAgaW5pdDogXCJpbWcvcHJvZmlsZTEucG5nXCIgIC8vMTAweDEwMFxyXG5cdCAgICB9LFxyXG5cdCAgICBjb2xvciA6IHtcclxuXHQgICAgICAgIGlzOiAgIFwicndcIixcclxuXHQgICAgICAgIGluaXQ6IFwiI2ZmZlwiXHJcblx0ICAgIH0sXHJcblx0ICAgIGFnZUdyb3VwIDoge1xyXG5cdCAgICBcdGlzIDogXCJyd1wiLFxyXG5cdCAgICBcdGluaXQgOiBcIi1cIlxyXG5cdCAgICB9LFxyXG5cdCAgICBhZ2UgOiB7XHJcblx0ICAgIFx0aXMgOiBcInJ3XCIsXHJcblx0ICAgIFx0aW5pdCA6IFwiLVwiXHJcblx0ICAgIH0sXHJcblx0ICAgIHJvdGF0aW9uIDoge1xyXG5cdCAgICBcdGlzIDogXCJyd1wiLFxyXG5cdCAgICBcdGluaXQgOiBudWxsIFxyXG5cdCAgICB9LCBcclxuXHQgICAgZWxhcHNlZCA6IHtcclxuXHQgICAgXHRpcyA6IFwicndcIixcclxuXHQgICAgXHRpbml0IDogMFxyXG5cdCAgICB9LFxyXG5cdFx0c2VxSWQgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogMFxyXG5cdFx0fSxcclxuXHRcdGNvdW50cnkgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogXCJHZXJtYW55XCJcclxuXHRcdH0sXHJcblx0XHRzdGFydFBvcyA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiAwXHJcblx0XHR9LFxyXG5cdFx0c3RhcnRUaW1lIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IDBcclxuXHRcdH0sXHJcblx0XHRnZW5kZXIgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogXCJNXCJcclxuXHRcdH0sXHJcblx0XHRpc0Zhdm9yaXRlIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IGZhbHNlXHJcblx0XHR9XHJcbiAgICB9LFxyXG5cdGFmdGVyIDoge1xyXG5cdFx0aW5pdCA6IGZ1bmN0aW9uKHBvcywgdHJhY2spIHtcclxuXHRcdFx0dGhpcy5zZXRUcmFjayh0cmFjayk7XHJcblx0XHRcdHZhciBjdGltZSA9IChuZXcgRGF0ZSgpKS5nZXRUaW1lKCk7XHJcblx0XHRcdHZhciBzdGF0ZSA9IG5ldyBQYXJ0aWNpcGFudFN0YXRlKHt0aW1lc3RhbXA6MS8qIHBsYWNlaG9sZGVyIGN0aW1lIG5vdCAwICovLGdwczpwb3MsaXNTT1M6ZmFsc2UsaXNEaXNjYXJkZWQ6ZmFsc2UsZnJlcTowLHNwZWVkOjAsZWxhcHNlZDowfSk7XHJcblx0XHRcdHRoaXMuc2V0RWxhcHNlZChzdGF0ZS5lbGFwc2VkKTtcclxuXHRcdFx0dGhpcy5zZXRTdGF0ZXMobmV3IFJCVHJlZShmdW5jdGlvbihhLCBiKSB7IHJldHVybiBhLnRpbWVzdGFtcCAtIGIudGltZXN0YW1wOyB9KSk7XHJcblx0XHRcdHRoaXMuc3RhdGVzLmluc2VydChzdGF0ZSk7XHJcblx0XHRcdHRoaXMuc2V0SXNTT1MoZmFsc2UpO1xyXG5cdFx0XHR0aGlzLnNldElzRGlzY2FyZGVkKGZhbHNlKTtcclxuXHRcdFx0aWYgKHRoaXMuZmVhdHVyZSkge1xyXG5cdFx0XHRcdHRoaXMuaW5pdEZlYXR1cmUoKTtcclxuXHRcdFx0fVxyXG5cdFx0XHR0aGlzLnBpbmdDYWxjdWxhdGVkKHN0YXRlKTtcclxuXHRcdH1cclxuXHR9LFxyXG4gICAgLy8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdG1ldGhvZHM6IFxyXG5cdHtcclxuXHRcdGluaXRGZWF0dXJlIDogZnVuY3Rpb24oKSB7XHJcblx0XHRcdHRoaXMuZmVhdHVyZS5wYXJ0aWNpcGFudD10aGlzO1xyXG5cdFx0XHRHVUkucGFydGljaXBhbnRzTGF5ZXIuZ2V0U291cmNlKCkuYWRkRmVhdHVyZSh0aGlzLmZlYXR1cmUpO1xyXG5cdFx0fSxcclxuXHJcblx0XHRnZXRJbml0aWFscyA6IGZ1bmN0aW9uKCkge1xyXG5cdFx0XHR2YXIgdHQgPSB0aGlzLmdldENvZGUoKS5zcGxpdChcIiBcIik7XHJcblx0XHRcdGlmICh0dC5sZW5ndGggPj0gMikge1xyXG5cdFx0XHRcdHJldHVybiB0dFswXVswXSt0dFsxXVswXTtcclxuXHRcdFx0fVxyXG5cdFx0XHRpZiAodHQubGVuZ3RoID09IDEpXHJcblx0XHRcdFx0cmV0dXJuIHR0WzBdWzBdO1xyXG5cdFx0XHRyZXR1cm4gXCI/XCI7XHJcblx0XHR9LFxyXG5cdFx0Ly8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0XHQvLyBtYWluIGZ1bmN0aW9uIGNhbGwgPiBcclxuXHRcdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdFx0dXBkYXRlRmVhdHVyZSA6IGZ1bmN0aW9uKCkge1xyXG5cdFx0XHR2YXIgbXBvcyA9IG9sLnByb2oudHJhbnNmb3JtKHRoaXMuZ2V0UG9zaXRpb24oKSwgJ0VQU0c6NDMyNicsICdFUFNHOjM4NTcnKTtcclxuXHRcdFx0aWYgKHRoaXMuZmVhdHVyZSkgXHJcblx0XHRcdFx0dGhpcy5mZWF0dXJlLnNldEdlb21ldHJ5KG5ldyBvbC5nZW9tLlBvaW50KG1wb3MpKTtcclxuXHRcdH0sXHJcblxyXG5cdFx0aW50ZXJwb2xhdGUgOiBmdW5jdGlvbihjdGltZSkgXHJcblx0XHR7XHJcblx0XHRcdHRoaXMuX19jdGltZT1jdGltZTtcclxuXHRcdFx0aWYgKCF0aGlzLnN0YXRlcy5zaXplKVxyXG5cdFx0XHRcdHJldHVybjtcdFx0XHJcblx0XHRcdGlmICh0aGlzLnN0YXRlcy5zaXplIDwgMilcclxuXHRcdFx0XHRyZXR1cm47XHJcblx0XHRcdHZhciByZXMgPSB0aGlzLmNhbGN1bGF0ZUVsYXBzZWRBdmVyYWdlKGN0aW1lKTtcclxuXHRcdFx0aWYgKHJlcyAhPSBudWxsKSBcclxuXHRcdFx0e1xyXG5cdFx0XHRcdHZhciB0cmVzPXJlcztcclxuXHRcdFx0XHRpZiAodHJlcyA9PSB0aGlzLnRyYWNrLmxhcHMpXHJcblx0XHRcdFx0XHR0cmVzPTEuMDtcclxuXHRcdFx0XHRlbHNlXHJcblx0XHRcdFx0XHR0cmVzPXRyZXMlMTtcclxuXHRcdFx0XHR2YXIgdGthID0gdGhpcy50cmFjay5nZXRQb3NpdGlvbkFuZFJvdGF0aW9uRnJvbUVsYXBzZWQodHJlcyk7XHJcblx0XHRcdFx0dGhpcy5zZXRQb3NpdGlvbihbdGthWzBdLHRrYVsxXV0pO1xyXG5cdFx0XHRcdHRoaXMuc2V0Um90YXRpb24odGthWzJdKTtcclxuXHRcdFx0XHR0aGlzLnVwZGF0ZUZlYXR1cmUoKTtcclxuXHRcdFx0XHR0aGlzLnNldEVsYXBzZWQocmVzKTtcclxuXHRcdFx0fSBcclxuXHRcdH0sXHJcblxyXG5cdFx0bWluIDogZnVuY3Rpb24oY3RpbWUscHJvTmFtZSkgXHJcblx0XHR7XHJcblx0XHRcdHZhciBpdCA9IHRoaXMuc3RhdGVzLmxvd2VyQm91bmQoe3RpbWVzdGFtcDpjdGltZX0pO1xyXG5cdFx0XHR2YXIgc2IgPSBpdC5kYXRhKCk7XHJcblx0XHRcdGlmICghc2IpXHJcblx0XHRcdFx0cmV0dXJuIG51bGw7XHJcblx0XHRcdGlmIChzYi50aW1lc3RhbXAgPT0gY3RpbWUpXHJcblx0XHRcdFx0cmV0dXJuIHNiW3Byb05hbWVdO1xyXG5cdFx0XHR2YXIgc2EgPSBpdC5wcmV2KCk7XHJcblx0XHRcdGlmIChzYSkge1xyXG5cdFx0XHRcdHJldHVybiBzYVtwcm9OYW1lXTtcclxuXHRcdFx0fVxyXG5cdFx0XHRyZXR1cm4gbnVsbDtcclxuXHRcdH0sXHJcblx0XHRcclxuXHRcdG1heCA6IGZ1bmN0aW9uKGN0aW1lLHByb05hbWUpIFxyXG5cdFx0e1xyXG5cdFx0XHR2YXIgaXQgPSB0aGlzLnN0YXRlcy5sb3dlckJvdW5kKHt0aW1lc3RhbXA6Y3RpbWV9KTtcclxuXHRcdFx0dmFyIHNhID0gaXQuZGF0YSgpO1xyXG5cdFx0XHRpZiAoIXNhKVxyXG5cdFx0XHRcdHJldHVybiBudWxsO1xyXG5cdFx0XHRyZXR1cm4gc2FbcHJvTmFtZV07XHJcblx0XHR9LFxyXG5cclxuXHRcdGF2ZzIgOiBmdW5jdGlvbihjdGltZSxwcm9OYW1lKSBcclxuXHRcdHtcclxuXHJcblx0XHRcdHZhciBpdCA9IHRoaXMuc3RhdGVzLmxvd2VyQm91bmQoe3RpbWVzdGFtcDpjdGltZX0pO1xyXG5cdFx0XHR2YXIgc2IgPSBpdC5kYXRhKCk7XHJcblx0XHRcdGlmIChzYikge1xyXG5cdFx0XHRcdGlmIChzYi50aW1lc3RhbXAgPT0gY3RpbWUpXHJcblx0XHRcdFx0XHRyZXR1cm4gc2JbcHJvTmFtZV07XHJcblx0XHRcdFx0Ly8gc2IgPj0gXHJcblx0XHRcdFx0dmFyIHNhID0gaXQucHJldigpO1xyXG5cdFx0XHRcdGlmIChzYSkgXHJcblx0XHRcdFx0eyBcclxuXHRcdFx0XHRcdHJldHVybiBbXHJcblx0XHRcdFx0XHQgICAgICAgXHRzYVtwcm9OYW1lXVswXSsoY3RpbWUtc2EudGltZXN0YW1wKSAqIChzYltwcm9OYW1lXVswXS1zYVtwcm9OYW1lXVswXSkgLyAoc2IudGltZXN0YW1wLXNhLnRpbWVzdGFtcCksXHJcblx0XHRcdFx0XHQgICAgICAgXHRzYVtwcm9OYW1lXVsxXSsoY3RpbWUtc2EudGltZXN0YW1wKSAqIChzYltwcm9OYW1lXVsxXS1zYVtwcm9OYW1lXVsxXSkgLyAoc2IudGltZXN0YW1wLXNhLnRpbWVzdGFtcClcclxuXHRcdFx0XHQgICAgICAgICAgXTsgXHJcblx0XHRcdFx0fVxyXG5cdFx0XHR9XHJcblx0XHRcdHJldHVybiBudWxsO1xyXG5cdFx0fSxcclxuXHJcblx0XHRhdmcgOiBmdW5jdGlvbihjdGltZSxwcm9OYW1lKSBcclxuXHRcdHtcclxuXHRcdFx0dmFyIGl0ID0gdGhpcy5zdGF0ZXMubG93ZXJCb3VuZCh7dGltZXN0YW1wOmN0aW1lfSk7XHJcblx0XHRcdHZhciBzYiA9IGl0LmRhdGEoKTtcclxuXHRcdFx0aWYgKHNiKSB7XHJcblx0XHRcdFx0aWYgKHNiLnRpbWVzdGFtcCA9PSBjdGltZSlcclxuXHRcdFx0XHRcdHJldHVybiBzYltwcm9OYW1lXTtcclxuXHRcdFx0XHQvLyBzYiA+PSBcclxuXHRcdFx0XHR2YXIgc2EgPSBpdC5wcmV2KCk7XHJcblx0XHRcdFx0aWYgKHNhKSBcclxuXHRcdFx0XHR7IFxyXG5cdFx0XHRcdFx0cmV0dXJuIHNhW3Byb05hbWVdKyhjdGltZS1zYS50aW1lc3RhbXApICogKHNiW3Byb05hbWVdLXNhW3Byb05hbWVdKSAvIChzYi50aW1lc3RhbXAtc2EudGltZXN0YW1wKTtcclxuXHRcdFx0XHR9XHJcblx0XHRcdH1cclxuXHRcdFx0cmV0dXJuIG51bGw7XHJcblx0XHR9LFxyXG5cclxuXHRcdGNhbGN1bGF0ZUVsYXBzZWRBdmVyYWdlIDogZnVuY3Rpb24oY3RpbWUpIFxyXG5cdFx0e1xyXG5cdFx0XHR2YXIgcmVzPW51bGw7XHJcblx0XHRcdHZhciBvayA9IGZhbHNlO1xyXG5cdFx0XHR2YXIgaXQgPSB0aGlzLnN0YXRlcy5sb3dlckJvdW5kKHt0aW1lc3RhbXA6Y3RpbWV9KTtcclxuXHRcdFx0dmFyIHNiID0gaXQuZGF0YSgpO1xyXG5cdFx0XHRpZiAoc2IpIHtcclxuXHRcdFx0XHRpZiAoc2IudGltZXN0YW1wID09IGN0aW1lKSB7XHJcblx0XHRcdFx0XHRvaz10cnVlO1xyXG5cdFx0XHRcdFx0cmVzPXNiLmVsYXBzZWQ7XHJcblx0XHRcdFx0fSBlbHNlIHtcclxuXHRcdFx0XHRcdHZhciBzYSA9IGl0LnByZXYoKTtcclxuXHRcdFx0XHRcdGlmIChzYSkgXHJcblx0XHRcdFx0XHR7IFxyXG5cdFx0XHRcdFx0XHRyZXMgPSBzYS5lbGFwc2VkKyhjdGltZS1zYS50aW1lc3RhbXApICogKHNiLmVsYXBzZWQtc2EuZWxhcHNlZCkgLyAoc2IudGltZXN0YW1wLXNhLnRpbWVzdGFtcCk7XHJcblx0XHRcdFx0XHRcdC8vY29uc29sZS5sb2coXCJGT1VORCBUSU1FIElOVCBbXCIrVXRpbHMuZm9ybWF0RGF0ZVRpbWVTZWMobmV3IERhdGUoc2EudGltZXN0YW1wKSkrXCIgPiBcIitVdGlscy5mb3JtYXREYXRlVGltZVNlYyhuZXcgRGF0ZShzYi50aW1lc3RhbXApKStcIl1cIik7XHJcblx0XHRcdFx0XHRcdG9rPXRydWU7XHJcblx0XHRcdFx0XHR9XHJcblx0XHRcdFx0fVxyXG5cdFx0XHR9XHJcblx0XHRcdGlmICghb2spIHtcclxuXHRcdFx0XHRpZiAodGhpcy5zdGF0ZXMuc2l6ZSA+PSAyKVxyXG5cdFx0XHRcdFx0Y29uc29sZS5sb2codGhpcy5jb2RlK1wiIHwgTk9UIEZPVU5EIFRJTUUgXCIrVXRpbHMuZm9ybWF0RGF0ZVRpbWVTZWMobmV3IERhdGUoY3RpbWUpKSk7XHJcblx0XHRcdH0gZWxzZVxyXG5cdFx0XHRcdHRoaXMuc2V0U2lnbmFsTG9zdERlbGF5KG51bGwpO1xyXG5cdFx0XHRyZXR1cm4gcmVzO1xyXG5cdFx0fSxcclxuXHRcdFxyXG5cdFx0cGluZ0NhbGN1bGF0ZWQgOiBmdW5jdGlvbihvYmopIHtcclxuXHRcdFx0aWYgKG9iai5kaXNjYXJkZWQpIHtcclxuXHRcdFx0XHRkZWxldGUgb2JqLmRpc2NhcmRlZDtcclxuXHRcdFx0XHR0aGlzLnNldElzRGlzY2FyZGVkKHRydWUpO1x0XHRcdFxyXG5cdFx0XHR9XHJcblx0XHRcdHZhciBzdGF0ZSA9IG5ldyBQYXJ0aWNpcGFudFN0YXRlKG9iaik7XHJcblx0XHRcdHRoaXMuYWRkU3RhdGUoc3RhdGUpO1xyXG5cdFx0XHR2YXIgcG9zID0gc3RhdGUuZ3BzO1xyXG5cdFx0XHR2YXIgY29lZiA9IHRoaXMudHJhY2suZ2V0VHJhY2tMZW5ndGhJbldHUzg0KCkvdGhpcy50cmFjay5nZXRUcmFja0xlbmd0aCgpO1xyXG5cdFx0XHR2YXIgcnIgPSBDT05GSUcubWF0aC5ncHNJbmFjY3VyYWN5KmNvZWY7XHJcblx0XHRcdGlmICh0eXBlb2YgR1VJICE9IFwidW5kZWZpbmVkXCIgJiYgR1VJLmlzRGVidWcpIFxyXG5cdFx0XHR7XHJcblx0XHRcdFx0dmFyIHJpbmcgPSBbXHJcblx0XHRcdFx0ICAgICAgICAgICAgW3Bvc1swXS1yciwgcG9zWzFdLXJyKmNvZWZ5XSwgW3Bvc1swXStyciwgcG9zWzFdLXJyKmNvZWZ5XSxbcG9zWzBdK3JyLCBwb3NbMV0rcnIqY29lZnldLFtwb3NbMF0tcnIsIHBvc1sxXStycipjb2VmeV0sW3Bvc1swXS1yciwgcG9zWzFdLXJyKmNvZWZ5XVxyXG5cdCBcdFx0XHRdO1xyXG5cdFx0XHRcdHZhciBwb2x5Z29uID0gbmV3IG9sLmdlb20uUG9seWdvbihbcmluZ10pO1xyXG5cdFx0XHRcdHBvbHlnb24udHJhbnNmb3JtKCdFUFNHOjQzMjYnLCAnRVBTRzozODU3Jyk7XHJcblx0XHRcdFx0dmFyIGZlYXR1cmUgPSBuZXcgb2wuRmVhdHVyZShwb2x5Z29uKTtcclxuXHRcdFx0XHRHVUkudGVzdExheWVyMS5nZXRTb3VyY2UoKS5hZGRGZWF0dXJlKGZlYXR1cmUpO1xyXG5cclxuXHRcdFx0XHR2YXIgbXBvcyA9IG9sLnByb2oudHJhbnNmb3JtKHBvcywgJ0VQU0c6NDMyNicsICdFUFNHOjM4NTcnKTtcclxuXHRcdFx0XHR2YXIgZmVhdHVyZSA9IG5ldyBvbC5GZWF0dXJlKG5ldyBvbC5nZW9tLlBvaW50KG1wb3MpKTtcclxuXHRcdFx0XHRHVUkudGVzdExheWVyLmdldFNvdXJjZSgpLmFkZEZlYXR1cmUoZmVhdHVyZSk7XHJcblx0XHRcdFx0Ly9jb25zb2xlLmxvZyh0aGlzLmdldENvZGUoKStcIiB8IFwiK01hdGgucm91bmQoc3RhdGUuZWxhcHNlZCoxMDAuMCoxMDAuMCkvMTAwLjArXCIlIFBPTkcgW1wiK3Bvc1swXStcIixcIitwb3NbMV0rXCJdIFwiK25ldyBEYXRlKHN0YXRlLnRpbWVzdGFtcCkrXCIgfCBcIitzdGF0ZS5kZWJ1Z0luZm8pO1xyXG5cdFx0XHRcdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdFx0XHRcdGlmIChzdGF0ZS5kZWJ1Z0luZm8gJiYgc3RhdGUuZGVidWdJbmZvLnBvaW50ICYmIHN0YXRlLmRlYnVnSW5mby5iZXN0KSBcclxuXHRcdFx0XHR7XHJcblx0XHRcdFx0XHR2YXIgbXBvcyA9IG9sLnByb2oudHJhbnNmb3JtKHN0YXRlLmRlYnVnSW5mby5wb2ludCwgJ0VQU0c6NDMyNicsICdFUFNHOjM4NTcnKTtcclxuXHRcdFx0XHRcdHZhciBmZWF0dXJlID0gbmV3IG9sLkZlYXR1cmUobmV3IG9sLmdlb20uUG9pbnQobXBvcykpO1xyXG5cdFx0XHRcdFx0aWYgKHRoaXMuX19vbGRGZWF0dXJlMSlcclxuXHRcdFx0XHRcdFx0R1VJLnRlc3RMYXllcjIuZ2V0U291cmNlKCkucmVtb3ZlRmVhdHVyZSh0aGlzLl9fb2xkRmVhdHVyZTEpO1xyXG5cdFx0XHRcdFx0R1VJLnRlc3RMYXllcjIuZ2V0U291cmNlKCkuYWRkRmVhdHVyZShmZWF0dXJlKTtcclxuXHRcdFx0XHRcdGZlYXR1cmUuZGVidWdJbmZvPXN0YXRlLmRlYnVnSW5mbztcclxuXHRcdFx0XHRcdHRoaXMuX19vbGRGZWF0dXJlMT1mZWF0dXJlO1xyXG5cclxuXHRcdFx0XHRcdHZhciBwMSA9IHRoaXMudHJhY2sucm91dGVbc3RhdGUuZGVidWdJbmZvLmJlc3RdO1xyXG5cdFx0XHRcdFx0dmFyIHAyID0gdGhpcy50cmFjay5yb3V0ZVtzdGF0ZS5kZWJ1Z0luZm8uYmVzdCsxXTtcclxuXHRcdFx0XHRcdHZhciBsaW5lID0gbmV3IG9sLmdlb20uTGluZVN0cmluZyhbIHAxLHAyIF0pO1xyXG5cdFx0XHRcdFx0bGluZS50cmFuc2Zvcm0oJ0VQU0c6NDMyNicsICdFUFNHOjM4NTcnKTtcclxuXHRcdFx0XHRcdFxyXG5cdFx0XHRcdFx0aWYgKHRoaXMuX19vbGRGZWF0dXJlMilcclxuXHRcdFx0XHRcdFx0R1VJLnRlc3RMYXllcjIuZ2V0U291cmNlKCkucmVtb3ZlRmVhdHVyZSh0aGlzLl9fb2xkRmVhdHVyZTIpO1xyXG5cdFx0XHRcdFx0dmFyIGZlYXR1cmUgPSBuZXcgb2wuRmVhdHVyZShsaW5lKTtcclxuXHRcdFx0XHRcdGZlYXR1cmUuZGVidWdJbmZvPXN0YXRlLmRlYnVnSW5mbztcclxuXHRcdFx0XHRcdEdVSS50ZXN0TGF5ZXIyLmdldFNvdXJjZSgpLmFkZEZlYXR1cmUoZmVhdHVyZSk7XHJcblx0XHRcdFx0XHR0aGlzLl9fb2xkRmVhdHVyZTI9ZmVhdHVyZTtcclxuXHRcdFx0XHR9XHJcblx0XHRcdFx0d2hpbGUgKEdVSS50ZXN0TGF5ZXIxLmdldFNvdXJjZSgpLmdldEZlYXR1cmVzKCkubGVuZ3RoID4gMTAwKVxyXG5cdFx0XHRcdFx0R1VJLnRlc3RMYXllcjEuZ2V0U291cmNlKCkucmVtb3ZlRmVhdHVyZShHVUkudGVzdExheWVyMS5nZXRTb3VyY2UoKS5nZXRGZWF0dXJlcygpWzBdKTtcclxuXHRcdFx0XHR3aGlsZSAoR1VJLnRlc3RMYXllci5nZXRTb3VyY2UoKS5nZXRGZWF0dXJlcygpLmxlbmd0aCA+IDEwMClcclxuXHRcdFx0XHRcdEdVSS50ZXN0TGF5ZXIuZ2V0U291cmNlKCkucmVtb3ZlRmVhdHVyZShHVUkudGVzdExheWVyLmdldFNvdXJjZSgpLmdldEZlYXR1cmVzKClbMF0pO1xyXG5cdFx0XHR9IFxyXG5cclxuXHRcdH0sXHJcblxyXG5cdFx0Z2V0T3ZlcmFsbFJhbmsgOiBmdW5jdGlvbihjdGltZSkge1xyXG5cdFx0XHR2YXIgdiA9IHRoaXMubWF4KGN0aW1lLFwib3ZlcmFsbFJhbmtcIik7XHJcblx0XHRcdGlmICh2KVxyXG5cdFx0XHRcdHJldHVybiB2O1xyXG5cdFx0XHRyZXR1cm4gXCItXCI7XHJcblx0XHR9LFxyXG5cdFx0Z2V0R3JvdXBSYW5rIDogZnVuY3Rpb24oY3RpbWUpIHtcclxuXHRcdFx0dmFyIHYgPSB0aGlzLm1heChjdGltZSxcImdyb3VwUmFua1wiKTtcclxuXHRcdFx0aWYgKHYpXHJcblx0XHRcdFx0cmV0dXJuIHY7XHJcblx0XHRcdHJldHVybiBcIi1cIjtcclxuXHRcdH0sXHJcblx0XHRnZXRHZW5kZXJSYW5rIDogZnVuY3Rpb24oY3RpbWUpIHtcclxuXHRcdFx0dmFyIHYgPSB0aGlzLm1heChjdGltZSxcImdlbmRlclJhbmtcIik7XHJcblx0XHRcdGlmICh2KVxyXG5cdFx0XHRcdHJldHVybiB2O1xyXG5cdFx0XHRyZXR1cm4gXCItXCI7XHJcblx0XHR9LFxyXG5cdFx0XHJcblx0XHRwaW5nIDogZnVuY3Rpb24ocG9zLGZyZXEsaXNTT1MsY3RpbWUsYWx0LG92ZXJhbGxSYW5rLGdyb3VwUmFuayxnZW5kZXJSYW5rLF9FTEFQU0VEKVxyXG5cdFx0e1xyXG5cdFx0XHR2YXIgbGx0ID0gKG5ldyBEYXRlKCkpLmdldFRpbWUoKTsgXHJcblx0XHRcdGlmICghY3RpbWUpXHJcblx0XHRcdFx0Y3RpbWU9bGx0O1xyXG5cdFx0XHR0aGlzLnNldExhc3RSZWFsRGVsYXkobGx0LWN0aW1lKTtcclxuXHRcdFx0dGhpcy5zZXRMYXN0UGluZ1RpbWVzdGFtcChsbHQpO1x0XHRcdFxyXG5cdFx0XHRpZiAoaXNTT1MpXHJcblx0XHRcdFx0dGhpcy5zZXRJc1NPUyh0cnVlKTtcdFx0XHRcdFxyXG5cdFx0XHRlbHNlXHJcblx0XHRcdFx0aXNTT1M9dGhpcy5nZXRJc1NPUygpO1xyXG5cdFx0XHR2YXIgc3RhdGUgPSBuZXcgUGFydGljaXBhbnRTdGF0ZSh7dGltZXN0YW1wOmN0aW1lLGdwczpwb3MsaXNTT1M6aXNTT1MsZnJlcTpmcmVxLGFsdDphbHQsb3ZlcmFsbFJhbms6b3ZlcmFsbFJhbmssZ3JvdXBSYW5rOmdyb3VwUmFuayxnZW5kZXJSYW5rOmdlbmRlclJhbmt9KTtcclxuXHRcdFx0aWYgKGlzU09TKVxyXG5cdFx0XHR7XHJcblx0XHRcdFx0dGhpcy5hZGRTdGF0ZShzdGF0ZSk7XHJcblx0XHRcdFx0cmV0dXJuO1xyXG5cdFx0XHR9XHJcblx0XHRcdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdFx0XHR2YXIgdHJhY2tsZW4gPSB0aGlzLnRyYWNrLmdldFRyYWNrTGVuZ3RoKCk7XHJcblx0XHRcdHZhciB0cmFja2xlbjEgPSB0aGlzLnRyYWNrLmdldFRyYWNrTGVuZ3RoSW5XR1M4NCgpO1xyXG5cdFx0XHR2YXIgbGxzdGF0ZT1udWxsO1xyXG5cdFx0XHR2YXIgbHN0YXRlPW51bGw7XHJcblx0XHRcdGlmICh0aGlzLnN0YXRlcy5zaXplID49IDEpIFxyXG5cdFx0XHR7XHJcblx0XHRcdFx0dmFyIGl0ID0gdGhpcy5zdGF0ZXMuZmluZEl0ZXIodGhpcy5zdGF0ZXMubWF4KCkpO1xyXG5cdFx0XHRcdGxzdGF0ZT1pdC5kYXRhKCk7XHJcblx0XHRcdFx0aWYgKHRoaXMuc3RhdGVzLnNpemUgPj0gMikge1xyXG5cdFx0XHRcdFx0bGxzdGF0ZT1pdC5wcmV2KCk7XHJcblx0XHRcdFx0fVxyXG5cdFx0XHR9XHJcblx0XHRcdGlmIChwb3NbMF0gPT0gMCAmJiBwb3NbMV0gPT0gMCkge1xyXG5cdFx0XHRcdGlmICghbHN0YXRlKSBcclxuXHRcdFx0XHRcdHJldHVybjtcclxuXHRcdFx0XHRwb3M9bHN0YXRlLmdwcztcclxuXHRcdFx0fVxyXG5cdFx0XHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRcdFx0dmFyIGJlc3Q7XHJcblx0XHRcdHZhciBiZXN0bT1udWxsO1xyXG5cdFx0XHR2YXIgbGVscCA9IGxzdGF0ZSA/IGxzdGF0ZS5nZXRFbGFwc2VkKCkgOiAwO1x0Ly8gbGFzdCBlbGFwc2VkXHJcblx0XHRcdHZhciB0ZyA9IHRoaXMudHJhY2sucm91dGU7XHJcblx0XHRcdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdFx0XHQvLyBORVcgQUxHXHJcblx0XHRcdHZhciBjb2VmID0gdGhpcy50cmFjay5nZXRUcmFja0xlbmd0aEluV0dTODQoKS90aGlzLnRyYWNrLmdldFRyYWNrTGVuZ3RoKCk7XHJcblx0XHRcdHZhciBtaW5mID0gbnVsbDtcclxuXHRcdFx0dmFyIHJyID0gQ09ORklHLm1hdGguZ3BzSW5hY2N1cmFjeSpjb2VmO1xyXG5cdFx0XHR2YXIgcmVzdWx0ID0gdGhpcy50cmFjay5yVHJlZS5zZWFyY2goW3Bvc1swXS1yciwgcG9zWzFdLXJyKmNvZWZ5LCBwb3NbMF0rcnIsIHBvc1sxXStycipjb2VmeV0pO1xyXG5cdFx0XHRpZiAoIXJlc3VsdClcclxuXHRcdFx0XHRyZXN1bHQ9W107XHJcblx0XHRcdC8vY29uc29sZS5sb2coXCIhISEgRk9VTkQgXCIrcmVzdWx0Lmxlbmd0aCtcIiB8IFwiK3RoaXMudHJhY2sucm91dGUubGVuZ3RoK1wiIHwgXCIrcnIpO1xyXG5cdFx0XHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRcdFx0dmFyIGRlYnVnSW5mbz17fTtcclxuXHRcdFx0dmFyIG1taW5mPW51bGw7XHJcblx0XHRcdGZvciAodmFyIF9pPTA7X2k8cmVzdWx0Lmxlbmd0aDtfaSsrKVxyXG5cdFx0XHR7XHJcblx0XHRcdFx0dmFyIGkgPSByZXN1bHRbX2ldWzRdLmluZGV4O1xyXG5cdFx0XHRcdC8vYTEsYTIscjEscjJcclxuXHRcdFx0XHR2YXIgcmVzID0gSW50ZXJzZWN0aW9uLmludGVyc2VjdExpbmVSZWN0YW5nbGUoXHJcblx0XHRcdFx0XHRcdFx0bmV3IFBvaW50MkQodGdbaV1bMF0sdGdbaV1bMV0pLFxyXG5cdFx0XHRcdFx0XHRcdG5ldyBQb2ludDJEKHRnW2krMV1bMF0sdGdbaSsxXVsxXSksXHJcblx0XHRcdFx0XHRcdFx0bmV3IFBvaW50MkQocG9zWzBdLXJyLHBvc1sxXS1ycipjb2VmeSksXHJcblx0XHRcdFx0XHRcdFx0bmV3IFBvaW50MkQocG9zWzBdK3JyLHBvc1sxXStycipjb2VmeSlcclxuXHRcdFx0XHRcdFx0KTtcclxuXHRcdFx0XHQvL2NvbnNvbGUubG9nKHJlcyk7XHJcblx0XHRcdFx0aWYgKHJlcyAmJiByZXMucG9pbnRzICYmIHJlcy5wb2ludHMubGVuZ3RoKSBcclxuXHRcdFx0XHR7XHJcblx0XHRcdFx0XHQvL1V0aWxzLmRpc3BcclxuXHRcdFx0XHRcdHZhciBkMyA9IFV0aWxzLldHUzg0U1BIRVJFLmhhdmVyc2luZURpc3RhbmNlKHRnW2ldLHRnW2krMV0pO1xyXG5cdFx0XHRcdFx0cmVzPXJlcy5wb2ludHM7XHJcblx0XHRcdFx0XHRmb3IgKHZhciBxPTA7cTxyZXMubGVuZ3RoO3ErKykgXHJcblx0XHRcdFx0XHR7XHJcblx0XHRcdFx0XHRcdC8vVXRpbHMuZGlzcFxyXG5cdFx0XHRcdFx0XHR2YXIgZDEgPSBVdGlscy5XR1M4NFNQSEVSRS5oYXZlcnNpbmVEaXN0YW5jZShbcmVzW3FdLngscmVzW3FdLnldLHRnW2ldKTtcclxuXHRcdFx0XHRcdFx0dmFyIGVsMSA9IHRoaXMudHJhY2suZGlzdGFuY2VzRWxhcHNlZFtpXSsodGhpcy50cmFjay5kaXN0YW5jZXNFbGFwc2VkW2krMV0tdGhpcy50cmFjay5kaXN0YW5jZXNFbGFwc2VkW2ldKSpkMS9kMztcclxuXHRcdFx0XHRcdFx0aWYgKGVsMSA8IGxlbHApIHtcclxuXHRcdFx0XHRcdFx0XHRpZiAobW1pbmYgPT0gbnVsbCB8fCBtbWluZiA+IGVsMSlcclxuXHRcdFx0XHRcdFx0XHRcdG1taW5mPWVsMTtcclxuXHRcdFx0XHRcdFx0XHRjb250aW51ZTsgXHRcdFx0XHQvLyBTS0lQIDwgTEVMUFxyXG5cdFx0XHRcdFx0XHR9XHJcblx0XHRcdFx0XHRcdGlmIChtaW5mID09IG51bGwgfHwgZWwxIDwgbWluZikge1xyXG5cdFx0XHRcdFx0XHRcdGlmIChkZWJ1Z0luZm8pIHtcclxuXHRcdFx0XHRcdFx0XHRcdGRlYnVnSW5mby5iZXN0PWk7XHJcblx0XHRcdFx0XHRcdFx0XHRkZWJ1Z0luZm8ucG9pbnQ9W3Jlc1txXS54LHJlc1txXS55XTtcclxuXHRcdFx0XHRcdFx0XHRcdGRlYnVnSW5mby52YWx1ZT1lbDE7XHJcblx0XHRcdFx0XHRcdFx0fVxyXG5cdFx0XHRcdFx0XHRcdG1pbmY9ZWwxO1xyXG5cdFx0XHRcdFx0XHR9XHJcblx0XHRcdFx0XHRcdGNvbnNvbGUubG9nKFwiSW50ZXJzZWN0aW9uIGNhbmRpZGF0ZSBhdCBcIitpK1wiIHwgXCIrTWF0aC5yb3VuZChlbDEqMTAwLjAqMTAwLjApLzEwMC4wKTtcclxuXHRcdFx0XHRcdH1cclxuXHRcdFx0XHR9XHJcblx0XHRcdFx0Lyp2YXIgcmVzID0gVXRpbHMuaW50ZXJjZXB0T25DaXJjbGUodGdbaV0sdGdbaSsxXSxwb3MscnIpO1xyXG5cdFx0XHRcdGlmIChyZXMpIFxyXG5cdFx0XHRcdHtcclxuXHRcdFx0XHRcdC8vIGhhcyBpbnRlcnNlY3Rpb24gKDIgcG9pbnRzKVxyXG5cdFx0XHRcdFx0dmFyIGQxID0gVXRpbHMuZGlzdHAocmVzWzBdLHRnW2ldKTtcclxuXHRcdFx0XHRcdHZhciBkMiA9IFV0aWxzLmRpc3RwKHJlc1sxXSx0Z1tpXSk7XHJcblx0XHRcdFx0XHR2YXIgZDMgPSBVdGlscy5kaXN0cCh0Z1tpXSx0Z1tpKzFdKTtcclxuXHRcdFx0XHRcdHZhciBlbDEgPSB0aGlzLnRyYWNrLmRpc3RhbmNlc0VsYXBzZWRbaV0rKHRoaXMudHJhY2suZGlzdGFuY2VzRWxhcHNlZFtpKzFdLXRoaXMudHJhY2suZGlzdGFuY2VzRWxhcHNlZFtpXSkqZDEvZDM7XHJcblx0XHRcdFx0XHR2YXIgZWwyID0gdGhpcy50cmFjay5kaXN0YW5jZXNFbGFwc2VkW2ldKyh0aGlzLnRyYWNrLmRpc3RhbmNlc0VsYXBzZWRbaSsxXS10aGlzLnRyYWNrLmRpc3RhbmNlc0VsYXBzZWRbaV0pKmQyL2QzO1xyXG5cdFx0XHRcdFx0Ly9jb25zb2xlLmxvZyhcIkludGVyc2VjdGlvbiBjYW5kaWRhdGUgYXQgXCIraStcIiB8IFwiK01hdGgucm91bmQoZWwxKjEwMC4wKjEwMC4wKS8xMDAuMCtcIiB8IFwiK01hdGgucm91bmQoZWwyKjEwMC4wKjEwMC4wKS8xMDAuMCtcIiB8IExFTFA9XCIrTWF0aC5yb3VuZChsZWxwKjEwMC4wKjEwMC4wKS8xMDAuMCk7XHJcblx0XHRcdFx0XHRpZiAoZWwxIDwgbGVscClcclxuXHRcdFx0XHRcdFx0ZWwxPWxlbHA7XHJcblx0XHRcdFx0XHRpZiAoZWwyIDwgbGVscClcclxuXHRcdFx0XHRcdFx0ZWwyPWxlbHA7XHJcblx0XHRcdFx0XHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRcdFx0XHRcdGlmIChtaW5mID09IG51bGwgfHwgZWwxIDwgbWluZilcclxuXHRcdFx0XHRcdFx0bWluZj1lbDE7XHJcblx0XHRcdFx0XHRpZiAoZWwyIDwgbWluZilcclxuXHRcdFx0XHRcdFx0bWluZj1lbDI7XHJcblx0XHRcdFx0fSovXHJcblx0XHRcdH1cclxuXHRcdFx0Ly8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cdFx0XHRcclxuXHRcdFx0aWYgKG1pbmYgPT0gbnVsbCAmJiBtbWluZiA9PSBudWxsKSBcclxuXHRcdFx0e1xyXG5cdFx0XHRcdGNvbnNvbGUuZXJyb3IoXCJNTUlORiBOVUxMID4gRElTQ0FSRCBcIit0aGlzLmNvZGUrXCIgfCBcIit0aGlzLmRldmljZUlkKTtcclxuXHRcdFx0XHR0aGlzLnNldElzRGlzY2FyZGVkKHRydWUpO1xyXG5cdFx0XHRcdHN0YXRlLnNldElzRGlzY2FyZGVkKHRydWUpO1xyXG5cdFx0XHRcdHN0YXRlLnNldEVsYXBzZWQobGVscCk7XHJcblx0XHRcdFx0dGhpcy5hZGRTdGF0ZShzdGF0ZSk7XHJcblx0XHRcdFx0cmV0dXJuO1xyXG5cdFx0XHR9XHJcblx0XHRcdC8qaWYgKG1pbmYgPT0gbnVsbClcclxuXHRcdFx0XHRjb25zb2xlLmVycm9yKFwiTUlORiBOVUxMXCIpO1xyXG5cdFx0XHRlbHNlXHJcblx0XHRcdFx0Y29uc29sZS5sb2coXCI+PiBNSU5GIFwiK01hdGgucm91bmQobWluZioxMDAuMCoxMDAuMCkvMTAwLjApOyovXHJcblx0XHRcdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHRcdFx0XHJcblx0XHRcdGlmIChkZWJ1Z0luZm8pXHJcblx0XHRcdFx0c3RhdGUuZGVidWdJbmZvPWRlYnVnSW5mbztcclxuXHRcdFx0aWYgKG1pbmYgPT0gbnVsbCkge1xyXG5cdFx0XHRcdHN0YXRlLnNldEVsYXBzZWQobGVscCk7XHJcblx0XHRcdFx0c3RhdGUuc2V0SXNEaXNjYXJkZWQodGhpcy5nZXRJc0Rpc2NhcmRlZCgpKTtcclxuXHRcdFx0XHR0aGlzLmFkZFN0YXRlKHN0YXRlKTtcclxuXHRcdFx0XHRyZXR1cm47XHJcblx0XHRcdH1cclxuXHRcdFx0YmVzdG09bWluZjtcclxuXHRcdFx0aWYgKGJlc3RtICE9IG51bGwpIFxyXG5cdFx0XHR7XHJcblx0XHRcdFx0dmFyIG5lbCA9IGJlc3RtOyBcclxuXHRcdFx0XHRpZiAobHN0YXRlKSBcclxuXHRcdFx0XHR7XHJcblx0XHRcdFx0XHQvKmlmIChuZWwgPCBsc3RhdGUuZ2V0RWxhcHNlZCgpKSBcclxuXHRcdFx0XHRcdHtcclxuXHRcdFx0XHRcdFx0Ly8gV1JPTkcgRElSRUNUSU9OIE9SIEdQUyBEQVRBIFdST05HPyBTS0lQLi5cclxuXHRcdFx0XHRcdFx0aWYgKChsc3RhdGUuZ2V0RWxhcHNlZCgpLW5lbCkqdHJhY2tsZW4gPCBDT05GSUcuY29uc3RyYWludHMuYmFja3dhcmRzRXBzaWxvbkluTWV0ZXIpIFxyXG5cdFx0XHRcdFx0XHRcdHJldHVybjtcclxuXHRcdFx0XHRcdFx0ZG8gIFxyXG5cdFx0XHRcdFx0XHR7XHJcblx0XHRcdFx0XHRcdFx0bmVsKz0xLjA7XHJcblx0XHRcdFx0XHRcdH0gd2hpbGUgKG5lbCA8IGxzdGF0ZS5nZXRFbGFwc2VkKCkpO1xyXG5cdFx0XHRcdFx0fSovXHJcblx0XHRcdFx0XHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0XHRcdFx0XHRpZiAobmVsID4gdGhpcy50cmFjay5sYXBzKSB7XHJcblx0XHRcdFx0XHRcdG5lbD10aGlzLnRyYWNrLmxhcHM7XHJcblx0XHRcdFx0XHR9XHJcblx0XHRcdFx0XHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0XHRcdFx0XHRsbHN0YXRlPW51bGw7XHJcblx0XHRcdFx0XHRsc3RhdGU9bnVsbDtcclxuXHRcdFx0XHRcdGlmICh0aGlzLnN0YXRlcy5zaXplID49IENPTkZJRy5tYXRoLnNwZWVkQW5kQWNjZWxlcmF0aW9uQXZlcmFnZURlZ3JlZSkge1xyXG5cdFx0XHRcdFx0XHR2YXIgaXQgPSB0aGlzLnN0YXRlcy5maW5kSXRlcih0aGlzLnN0YXRlcy5tYXgoKSk7XHJcblx0XHRcdFx0XHRcdGxzdGF0ZT1pdC5kYXRhKCk7IFxyXG5cdFx0XHRcdFx0XHRmb3IgKHZhciBraz0wO2trPENPTkZJRy5tYXRoLnNwZWVkQW5kQWNjZWxlcmF0aW9uQXZlcmFnZURlZ3JlZS0xO2trKyspIHtcclxuXHRcdFx0XHRcdFx0XHRsc3RhdGU9aXQucHJldigpOyBcclxuXHRcdFx0XHRcdFx0fVxyXG5cdFx0XHRcdFx0fVxyXG5cdFx0XHRcdFx0aWYgKHRoaXMuc3RhdGVzLnNpemUgPj0gQ09ORklHLm1hdGguc3BlZWRBbmRBY2NlbGVyYXRpb25BdmVyYWdlRGVncmVlKjIpIHtcclxuXHRcdFx0XHRcdFx0dmFyIGl0ID0gdGhpcy5zdGF0ZXMuZmluZEl0ZXIodGhpcy5zdGF0ZXMubWF4KCkpO1xyXG5cdFx0XHRcdFx0XHRsbHN0YXRlPWl0LmRhdGEoKTsgXHJcblx0XHRcdFx0XHRcdGZvciAodmFyIGtrPTA7a2s8Q09ORklHLm1hdGguc3BlZWRBbmRBY2NlbGVyYXRpb25BdmVyYWdlRGVncmVlKjItMTtraysrKSB7XHJcblx0XHRcdFx0XHRcdFx0bGxzdGF0ZT1pdC5wcmV2KCk7IFxyXG5cdFx0XHRcdFx0XHR9XHJcblx0XHRcdFx0XHR9XHJcblx0XHRcdFx0XHRpZiAobHN0YXRlKSAge1xyXG5cdFx0XHRcdFx0XHRzdGF0ZS5zZXRTcGVlZCggdHJhY2tsZW4gKiAobmVsLWxzdGF0ZS5nZXRFbGFwc2VkKCkpICogMTAwMCAvIChjdGltZS1sc3RhdGUudGltZXN0YW1wKSk7XHJcblx0XHRcdFx0XHRcdGlmIChsbHN0YXRlKSBcclxuXHRcdFx0XHRcdFx0XHRzdGF0ZS5zZXRBY2NlbGVyYXRpb24oIChzdGF0ZS5nZXRTcGVlZCgpLWxzdGF0ZS5nZXRTcGVlZCgpKSAqIDEwMDAgLyAoY3RpbWUtbHN0YXRlLnRpbWVzdGFtcCkpO1xyXG5cdFx0XHRcdFx0fVxyXG5cdFx0XHRcdFx0Ly8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdFx0XHRcdH1cclxuXHRcdFx0XHRzdGF0ZS5zZXRFbGFwc2VkKG5lbCk7XHJcblx0XHRcdH0gZWxzZSB7XHJcblx0XHRcdFx0aWYgKGxzdGF0ZSlcclxuXHRcdFx0XHRcdHN0YXRlLnNldEVsYXBzZWQobHN0YXRlLmdldEVsYXBzZWQoKSk7XHJcblx0XHRcdFx0aWYgKGxzdGF0ZS5nZXRFbGFwc2VkKCkgIT0gdGhpcy50cmFjay5sYXBzKSB7XHJcblx0XHRcdFx0XHR0aGlzLnNldElzRGlzY2FyZGVkKHRydWUpO1xyXG5cdFx0XHRcdH1cclxuXHRcdFx0fVxyXG5cdFx0XHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0XHRcdHN0YXRlLnNldElzRGlzY2FyZGVkKHRoaXMuZ2V0SXNEaXNjYXJkZWQoKSk7XHJcblx0XHRcdHRoaXMuYWRkU3RhdGUoc3RhdGUpO1xyXG5cdFx0fSxcclxuXHRcdFxyXG5cdFx0YWRkU3RhdGUgOiBmdW5jdGlvbihzdGF0ZSkge1xyXG5cdFx0XHR0aGlzLnN0YXRlcy5pbnNlcnQoc3RhdGUpO1xyXG5cdFx0XHRpZiAoIUNPTkZJRy5fX3NraXBQYXJ0aWNpcGFudEhpc3RvcnlDbGVhcilcclxuXHRcdFx0aWYgKHRoaXMuc3RhdGVzLnNpemUgPiBDT05GSUcuY29uc3RyYWludHMubWF4UGFydGljaXBhbnRTdGF0ZUhpc3RvcnkpXHJcblx0XHRcdFx0dGhpcy5zdGF0ZXMucmVtb3ZlKHRoaXMuc3RhdGVzLm1pbigpKTtcclxuXHRcdH0sXHJcblxyXG5cdFx0Z2V0TGFzdFN0YXRlOiBmdW5jdGlvbigpIHtcclxuXHRcdFx0cmV0dXJuIHRoaXMuc3RhdGVzLnNpemUgPyB0aGlzLnN0YXRlcy5tYXgoKSA6IG51bGw7XHJcblx0XHR9LFxyXG5cclxuXHRcdGdldEZyZXEgOiBmdW5jdGlvbigpIHtcclxuXHRcdFx0dmFyIGxzdGF0ZSA9IHRoaXMuZ2V0TGFzdFN0YXRlKCk7XHJcblx0XHRcdHJldHVybiBsc3RhdGUgPyBsc3RhdGUuZnJlcSA6IDA7XHJcblx0XHR9LFxyXG5cclxuXHRcdGdldFNwZWVkIDogZnVuY3Rpb24oKSB7XHJcblx0XHRcdHZhciBsc3RhdGUgPSB0aGlzLmdldExhc3RTdGF0ZSgpO1xyXG5cdFx0XHRyZXR1cm4gbHN0YXRlID8gbHN0YXRlLnNwZWVkIDogMDtcclxuXHRcdH0sXHJcblxyXG5cdFx0Z2V0R1BTIDogZnVuY3Rpb24oKSB7XHJcblx0XHRcdHZhciBsc3RhdGUgPSB0aGlzLmdldExhc3RTdGF0ZSgpO1xyXG5cdFx0XHRyZXR1cm4gbHN0YXRlID8gbHN0YXRlLmdwcyA6IHRoaXMuZ2V0UG9zaXRpb24oKTtcclxuXHRcdH0sXHJcblxyXG5cdFx0Z2V0RWxhcHNlZCA6IGZ1bmN0aW9uKCkge1xyXG5cdFx0XHR2YXIgbHN0YXRlID0gdGhpcy5nZXRMYXN0U3RhdGUoKTtcclxuXHRcdFx0cmV0dXJuIGxzdGF0ZSA/IGxzdGF0ZS5lbGFwc2VkIDogMDtcclxuXHRcdH0sXHJcblxyXG5cdFx0Z2V0UG9wdXBIVE1MIDogZnVuY3Rpb24oY3RpbWUpIHtcclxuXHRcdFx0dmFyIHBvcyA9IHRoaXMubWluKFwiZ3BzXCIpO1xyXG5cdFx0XHR2YXIgdGxlbiA9IHRoaXMudHJhY2suZ2V0VHJhY2tMZW5ndGgoKTtcclxuXHRcdFx0dmFyIGVsYXBzZWQgPSB0aGlzLmNhbGN1bGF0ZUVsYXBzZWRBdmVyYWdlKGN0aW1lKTtcclxuXHRcdFx0dmFyIHRwYXJ0ID0gdGhpcy50cmFjay5nZXRUcmFja1BhcnQoZWxhcHNlZCk7XHJcblx0XHRcdHZhciB0YXJnZXRLTTtcclxuXHRcdFx0dmFyIHBhcnRTdGFydDtcclxuXHRcdFx0dmFyIHRwYXJ0TW9yZTtcclxuXHRcdFx0aWYgKHRwYXJ0ID09IDApIHtcclxuXHRcdFx0XHR0cGFydHM9XCJTV0lNXCI7XHJcblx0XHRcdFx0dGFyZ2V0S009dGhpcy50cmFjay5iaWtlU3RhcnRLTTtcclxuXHRcdFx0XHRwYXJ0U3RhcnQ9MDtcclxuXHRcdFx0XHR0cGFydE1vcmU9XCJTV0lNXCI7XHJcblx0XHRcdH0gZWxzZSBpZiAodHBhcnQgPT0gMSkge1xyXG5cdFx0XHRcdHRwYXJ0cz1cIkJJS0VcIjtcclxuXHRcdFx0XHR0YXJnZXRLTT10aGlzLnRyYWNrLnJ1blN0YXJ0S007XHJcblx0XHRcdFx0cGFydFN0YXJ0PXRoaXMudHJhY2suYmlrZVN0YXJ0S007XHJcblx0XHRcdFx0dHBhcnRNb3JlPVwiUklERVwiO1xyXG5cdFx0XHR9IGVsc2UgaWYgKHRwYXJ0ID09IDIpIHsgXHJcblx0XHRcdFx0dHBhcnRzPVwiUlVOXCI7XHJcblx0XHRcdFx0dGFyZ2V0S009dGxlbi8xMDAwLjA7XHJcblx0XHRcdFx0cGFydFN0YXJ0PXRoaXMudHJhY2sucnVuU3RhcnRLTTtcclxuXHRcdFx0XHR0cGFydE1vcmU9XCJSVU5cIjtcclxuXHRcdFx0fVxyXG5cdFx0XHR2YXIgaHRtbD1cIjxkaXYgY2xhc3M9J3BvcHVwX2NvZGUnIHN0eWxlPSdjb2xvcjpyZ2JhKFwiK2NvbG9yQWxwaGFBcnJheSh0aGlzLmdldENvbG9yKCksMC45KS5qb2luKFwiLFwiKStcIiknPlwiK2VzY2FwZUhUTUwodGhpcy5nZXRDb2RlKCkpK1wiICgxKTwvZGl2PlwiO1xyXG5cdFx0XHR2YXIgZnJlcSA9IE1hdGgucm91bmQodGhpcy5nZXRGcmVxKCkpO1xyXG5cdFx0XHRpZiAoZnJlcSA+IDApIHtcclxuXHRcdFx0XHRodG1sKz1cIjxkaXYgY2xhc3NcIiArXHJcblx0XHRcdFx0XHRcdFwiPSdwb3B1cF9mcmVxJz5cIitmcmVxK1wiPC9kaXY+XCI7XHJcblx0XHRcdH1cclxuXHRcdFx0dmFyIGVsa20gPSBlbGFwc2VkKnRsZW4vMTAwMC4wO1xyXG5cdFx0XHR2YXIgZWxrbXMgPSBwYXJzZUZsb2F0KE1hdGgucm91bmQoZWxrbSAqIDEwMCkgLyAxMDApLnRvRml4ZWQoMik7XHRcdFx0XHJcblxyXG5cdFx0XHQvKnZhciByZWttID0gZWxhcHNlZCUxLjA7XHJcblx0XHRcdHJla209KDEuMC1yZWttKSp0bGVuLzEwMDAuMDtcclxuXHRcdFx0cmVrbSA9IHBhcnNlRmxvYXQoTWF0aC5yb3VuZChyZWttICogMTAwKSAvIDEwMCkudG9GaXhlZCgyKTsqL1x0XHRcdFxyXG5cdFx0XHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0XHRcdHZhciBlc3RmPW51bGw7XHJcblx0XHRcdHZhciBldHh0MT1udWxsO1xyXG5cdFx0XHR2YXIgZXR4dDI9bnVsbDtcclxuXHRcdFx0dmFyIGxzdGF0ZSA9IG51bGw7IFxyXG5cclxuXHRcdFx0dmFyIHNwZWVkID0gdGhpcy5hdmcoY3RpbWUsXCJzcGVlZFwiKTtcclxuXHRcdFx0aWYgKHNwZWVkICYmIHNwZWVkID4gMCkgXHJcblx0XHRcdHtcclxuXHRcdFx0XHR2YXIgYWNjZWxlcmF0aW9uID0gdGhpcy5hdmcoY3RpbWUsXCJhY2NlbGVyYXRpb25cIik7XHJcblx0XHRcdFx0dmFyIHJvdCA9IHRoaXMudHJhY2suZ2V0UG9zaXRpb25BbmRSb3RhdGlvbkZyb21FbGFwc2VkKGVsYXBzZWQpKjE4MC9NYXRoLlBJO1xyXG5cdFx0XHRcdGlmIChyb3QgPCAwKVxyXG5cdFx0XHRcdFx0cm90Kz0zNjA7XHJcblx0XHRcdFx0dmFyIHNwbXMgPSBNYXRoLmNlaWwoc3BlZWQgKiAxMDApIC8gMTAwO1xyXG5cdFx0XHRcdHNwbXMvPTEwMDAuMDtcclxuXHRcdFx0XHRzcG1zKj02MCo2MDtcclxuXHRcdFx0XHRldHh0MT1wYXJzZUZsb2F0KHNwbXMpLnRvRml4ZWQoMikrXCIga20vaFwiO1xyXG5cdFx0XHRcdGlmIChyb3QgIT0gbnVsbCkgXHJcblx0XHRcdFx0e1xyXG5cdFx0XHRcdFx0aWYgKHJvdCA8PSAwKSBcclxuXHRcdFx0XHRcdFx0ZXR4dDErPVwiIEVcIjtcclxuXHRcdFx0XHRcdGVsc2UgaWYgKHJvdCA8PSA0NSlcclxuXHRcdFx0XHRcdFx0ZXR4dDErPVwiIFNFXCI7XHJcblx0XHRcdFx0XHRlbHNlIGlmIChyb3QgPD0gOTApXHJcblx0XHRcdFx0XHRcdGV0eHQxKz1cIiBTXCI7XHJcblx0XHRcdFx0XHRlbHNlIGlmIChyb3QgPD0gMTM1KVxyXG5cdFx0XHRcdFx0XHRldHh0MSs9XCIgU1dcIjtcclxuXHRcdFx0XHRcdGVsc2UgaWYgKHJvdCA8PSAxODApXHJcblx0XHRcdFx0XHRcdGV0eHQxKz1cIiBXXCI7XHJcblx0XHRcdFx0XHRlbHNlIGlmIChyb3QgPD0gMjI1KVxyXG5cdFx0XHRcdFx0XHRldHh0MSs9XCIgTldcIjtcclxuXHRcdFx0XHRcdGVsc2UgaWYgKHJvdCA8PSAyNzApXHJcblx0XHRcdFx0XHRcdGV0eHQxKz1cIiBOXCI7XHJcblx0XHRcdFx0XHRlbHNlIFxyXG5cdFx0XHRcdFx0XHRldHh0MSs9XCIgTkVcIjtcclxuXHRcdFx0XHR9XHJcblx0XHRcdFx0ZXN0Zj1VdGlscy5mb3JtYXRUaW1lKG5ldyBEYXRlKCBjdGltZSArIHRhcmdldEtNKjEwMDAgLyBzcG1zKjEwMDAgKSk7ICBcclxuXHRcdFx0XHRpZiAoYWNjZWxlcmF0aW9uID4gMClcclxuXHRcdFx0XHRcdGV0eHQyPXBhcnNlRmxvYXQoTWF0aC5jZWlsKGFjY2VsZXJhdGlvbiAqIDEwMCkgLyAxMDApLnRvRml4ZWQoMikrXCIgbS9zMlwiO1xyXG5cdFx0XHR9XHJcblx0XHRcdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdFx0XHR2YXIgcDEgPSAxMDAqdGhpcy50cmFjay5iaWtlU3RhcnRLTS8odGxlbi8xMDAwLjApO1xyXG5cdFx0XHR2YXIgcDIgPSAxMDAqKHRoaXMudHJhY2sucnVuU3RhcnRLTS10aGlzLnRyYWNrLmJpa2VTdGFydEtNKS8odGxlbi8xMDAwLjApO1xyXG5cdFx0XHR2YXIgcDMgPSAxMDAqKHRsZW4vMTAwMC4wIC0gdGhpcy50cmFjay5ydW5TdGFydEtNKS8odGxlbi8xMDAwLjApO1xyXG5cdFx0XHR2YXIgcHJldHR5Q29vcmQ9XHJcblx0XHRcdFx0XCI8ZGl2IHN0eWxlPSdvcGFjaXR5OjAuNztmbG9hdDpsZWZ0O292ZXJmbG93OmhpZGRlbjtoZWlnaHQ6N3B4O3dpZHRoOlwiK3AxK1wiJTtiYWNrZ3JvdW5kLWNvbG9yOlwiK0NPTkZJRy5hcHBlYXJhbmNlLnRyYWNrQ29sb3JTd2ltK1wiJy8+XCIrXHJcblx0XHRcdFx0XCI8ZGl2IHN0eWxlPSdvcGFjaXR5OjAuNztmbG9hdDpsZWZ0O292ZXJmbG93OmhpZGRlbjtoZWlnaHQ6N3B4O3dpZHRoOlwiK3AyK1wiJTtiYWNrZ3JvdW5kLWNvbG9yOlwiK0NPTkZJRy5hcHBlYXJhbmNlLnRyYWNrQ29sb3JCaWtlK1wiJy8+XCIrXHJcblx0XHRcdFx0XCI8ZGl2IHN0eWxlPSdvcGFjaXR5OjAuNztmbG9hdDpsZWZ0O292ZXJmbG93OmhpZGRlbjtoZWlnaHQ6N3B4O3dpZHRoOlwiK3AzK1wiJTtiYWNrZ3JvdW5kLWNvbG9yOlwiK0NPTkZJRy5hcHBlYXJhbmNlLnRyYWNrQ29sb3JSdW4rXCInLz5cIlxyXG5cdFx0XHRcdDsgLy9vbC5jb29yZGluYXRlLnRvU3RyaW5nSERNUyh0aGlzLmdldFBvc2l0aW9uKCksIDIpO1xyXG5cclxuXHRcdFx0dmFyIGltZ2RpdjtcclxuXHRcdFx0aWYgKHRwYXJ0ID09IDApXHJcblx0XHRcdFx0aW1nZGl2PVwiPGltZyBjbGFzcz0ncG9wdXBfdHJhY2tfbW9kZScgc3R5bGU9J2xlZnQ6XCIrZWxhcHNlZCoxMDArXCIlJyBzcmM9J2ltZy9zd2ltLnN2ZycvPlwiXHJcblx0XHRcdGVsc2UgaWYgKHRwYXJ0ID09IDEpXHJcblx0XHRcdFx0aW1nZGl2PVwiPGltZyBjbGFzcz0ncG9wdXBfdHJhY2tfbW9kZScgc3R5bGU9J2xlZnQ6XCIrZWxhcHNlZCoxMDArXCIlJyBzcmM9J2ltZy9iaWtlLnN2ZycvPlwiXHJcblx0XHRcdGVsc2UgLyppZiAodHBhcnQgPT0gMikqL1xyXG5cdFx0XHRcdGltZ2Rpdj1cIjxpbWcgY2xhc3M9J3BvcHVwX3RyYWNrX21vZGUnIHN0eWxlPSdsZWZ0OlwiK2VsYXBzZWQqMTAwK1wiJScgc3JjPSdpbWcvcnVuLnN2ZycvPlwiXHJcblx0XHJcblxyXG5cdFx0XHR2YXIgcGFzcyA9IE1hdGgucm91bmQoKG5ldyBEYXRlKCkpLmdldFRpbWUoKS8zNTAwKSAlIDM7XHJcblx0XHRcdGh0bWwrPVwiPHRhYmxlIGNsYXNzPSdwb3B1cF90YWJsZScgc3R5bGU9J2JhY2tncm91bmQtaW1hZ2U6dXJsKFxcXCJcIit0aGlzLmdldEltYWdlKCkrXCJcXFwiKSc+XCI7XHJcblx0XHRcdHZhciBpc0R1bW15PSEoZWxhcHNlZCA+IDApO1xyXG5cdFx0XHRodG1sKz1cIjx0cj48dGQgY2xhc3M9J2xibCc+RWxhcHNlZDwvdGQ+PHRkIGNsYXNzPSd2YWx1ZSc+XCIrKGlzRHVtbXkgPyBcIi1cIiA6IGVsa21zK1wiIGttXCIpK1wiPC90ZD48L3RyPlwiO1xyXG5cdFx0XHRodG1sKz1cIjx0cj48dGQgY2xhc3M9J2xibCc+TW9yZSB0byBcIit0cGFydE1vcmUrXCI8L3RkPjx0ZCBjbGFzcz0ndmFsdWUnPlwiKyhpc0R1bW15ID8gXCItXCIgOiBwYXJzZUZsb2F0KE1hdGgucm91bmQoKHRhcmdldEtNLWVsa20pICogMTAwKSAvIDEwMCkudG9GaXhlZCgyKSAvKiByZWttICovICtcIiBrbVwiKStcIjwvdGQ+PC90cj5cIjtcclxuXHRcdFx0aHRtbCs9XCI8dHI+PHRkIGNsYXNzPSdsYmwnPkZpbmlzaCBcIisgdHBhcnRzLnRvTG93ZXJDYXNlKCkgK1wiPC90ZD48dGQgY2xhc3M9J3ZhbHVlJz5cIisoIWVzdGYgPyBcIi1cIiA6IGVzdGYpK1wiPC90ZD48L3RyPlwiO1x0XHRcdFx0XHRcclxuXHRcdFx0aHRtbCs9XCI8dHI+PHRkIGNsYXNzPSdsYmwnPlNwZWVkPC90ZD48dGQgY2xhc3M9J3ZhbHVlJz5cIisoIWlzRHVtbXkgJiYgZXR4dDEgPyBldHh0MSA6IFwiLVwiKSArIFwiPC90ZD48L3RyPlwiO1xyXG5cdFx0XHRodG1sKz1cIjx0cj48dGQgY2xhc3M9J2xibCc+QWNjZWxlci48L3RkPjx0ZCBjbGFzcz0ndmFsdWUnPlwiKyghaXNEdW1teSAmJiBldHh0MiA/IGV0eHQyIDogXCItXCIpICtcIjwvdGQ+PC90cj5cIjtcclxuXHRcdFx0aHRtbCs9XCI8dHIgc3R5bGU9J2hlaWdodDoxMDAlJz48dGQ+Jm5ic3A7PC90ZD48dGQ+Jm5ic3A7PC90ZD48L3RyPlwiO1xyXG5cdFx0XHRodG1sK1wiPC90YWJsZT5cIlxyXG5cdFx0XHQvL2h0bWwrPVwiPGRpdiBjbGFzcz0ncG9wdXBfc2hhZG93Jz5cIitwcmV0dHlDb29yZCtpbWdkaXYrXCI8L2Rpdj5cIjtcclxuXHRcdFx0XHJcblx0XHRcdHZhciByYW5rPVwiLVwiO1xyXG5cdFx0XHRpZiAodGhpcy5fX3BvcyAhPSB1bmRlZmluZWQpXHJcblx0XHRcdFx0cmFuaz10aGlzLl9fcG9zICsgMTsgICAvLyB0aGUgZmlyc3QgcG9zIC0gdGhlIEZBU1RFU1QgaXMgMFxyXG5cdFx0XHRcclxuXHRcdFx0XHJcblx0XHRcdGh0bWw9XCI8ZGl2IGNsYXNzPSdwb3B1cF9jb250ZW50X3ByZyc+PGRpdiBzdHlsZT0nd2lkdGg6XCIrcDErXCIlO2hlaWdodDo2cHg7YmFja2dyb3VuZC1jb2xvcjpcIitDT05GSUcuYXBwZWFyYW5jZS50cmFja0NvbG9yU3dpbStcIjtmbG9hdDpsZWZ0Oyc+PC9kaXY+PGRpdiBzdHlsZT0nd2lkdGg6XCIrcDIrXCIlO2hlaWdodDo2cHg7YmFja2dyb3VuZC1jb2xvcjpcIitDT05GSUcuYXBwZWFyYW5jZS50cmFja0NvbG9yQmlrZStcIjtmbG9hdDpsZWZ0Oyc+PC9kaXY+PGRpdiBzdHlsZT0nd2lkdGg6XCIrcDMrXCIlO2hlaWdodDo2cHg7YmFja2dyb3VuZC1jb2xvcjpcIitDT05GSUcuYXBwZWFyYW5jZS50cmFja0NvbG9yUnVuK1wiO2Zsb2F0OmxlZnQ7Jz48L2Rpdj5cIjtcclxuXHRcdFx0aHRtbCs9XCI8ZGl2IGNsYXNzPSdwb3B1cF90cmFja19wb3MnPjxkaXYgY2xhc3M9J3BvcHVwX3RyYWNrX3Bvc18xJyBzdHlsZT0nbGVmdDpcIisoZWxhcHNlZCo5MCkrXCIlJz48L2Rpdj48L2Rpdj5cIjtcclxuXHRcdFx0aHRtbCs9XCI8L2Rpdj5cIjtcclxuXHRcdFx0aHRtbCs9XCI8aW1nIGNsYXNzPSdwb3B1cF9jb250ZW50X2ltZycgc3JjPSdcIit0aGlzLmdldEltYWdlKCkrXCInLz5cIjtcclxuXHRcdFx0aHRtbCs9XCI8ZGl2IGNsYXNzPSdwb3B1cF9jb250ZW50XzEnPlwiO1xyXG5cdFx0XHRodG1sKz1cIjxkaXYgY2xhc3M9J3BvcHVwX2NvbnRlbnRfbmFtZSc+XCIrZXNjYXBlSFRNTCh0aGlzLmdldENvZGUoKSkrXCI8L2Rpdj5cIjtcclxuXHRcdFx0aHRtbCs9XCI8ZGl2IGNsYXNzPSdwb3B1cF9jb250ZW50X2wxJz5cIit0aGlzLmdldENvdW50cnkoKS5zdWJzdHJpbmcoMCwzKS50b1VwcGVyQ2FzZSgpK1wiIHwgUG9zOiBcIityYW5rK1wiIHwgU3BlZWQ6IFwiKyghaXNEdW1teSAmJiBldHh0MSA/IGV0eHQxIDogXCItXCIpK1wiPC9kaXY+XCI7XHJcblx0XHRcdHZhciBwYXNzID0gTWF0aC5yb3VuZCgoKG5ldyBEYXRlKCkpLmdldFRpbWUoKSAvIDEwMDAgLyA0KSklMjtcclxuXHRcdFx0aWYgKHBhc3MgPT0gMCkge1xyXG5cdFx0XHRcdGlmICh0aGlzLl9fcG9zICE9IHVuZGVmaW5lZCkgXHJcblx0XHRcdFx0e1xyXG5cdFx0XHRcdFx0cGFyc2VGbG9hdChNYXRoLnJvdW5kKGVsa20gKiAxMDApIC8gMTAwKS50b0ZpeGVkKDIpO1xyXG5cclxuXHRcdFx0XHRcdC8vIHRoaXMuX19uZXh0IGlzIHRoZSBwYXJ0aWNpcGFudCBiZWhpbmQgdGhpcyBvbmUgKGUuZyB0aGUgc2xvd2VyIG9uZSB3aXRoIGxlc3QgZWxhcHNlZCBpbmRleClcclxuXHRcdFx0XHRcdC8vIGFuZCB0aGlzLl9fcHJldiBpcyB0aGUgb25lIGJlZm9yZSB1c1xyXG5cdFx0XHRcdFx0Ly8gc28gaWYgcGFydGljaXBhbnQgaXMgaW4gcG9zaXRpb24gMyB0aGUgb25lIGJlZm9yZSBoaW0gd2lsbCBiZSAyIGFuZCB0aGUgb25lIGJlaGluZCBoaW0gd2lsbCBiZSA0XHJcblx0XHRcdFx0XHQvLyAoZS5nLiBcInRoaXMuX19wb3MgPT0gM1wiID0+IHRoaXMuX19wcmV2Ll9fcG9zID09IDIgYW5kIHRoaXMuX19wcmV2Ll9fbmV4dCA9PSA0XHJcblx0XHRcdFx0XHQvLyBmb3IgdGhlXHJcblxyXG5cdFx0XHRcdFx0aWYgKHRoaXMuX19wcmV2ICYmIHRoaXMuX19wcmV2Ll9fcG9zICE9IHVuZGVmaW5lZCAmJiB0aGlzLmdldFNwZWVkKCkpIHtcclxuXHRcdFx0XHRcdFx0Ly8gd2hhdCBpcyB0aGUgZGlmZmVyZW5jZSBiZXR3ZWVuIGN1cnJlbnQgb25lIGFuZCB0aGUgb25lIGJlZm9yZSAtIHdlIHdpbGwgcnVuIHNvIG91ciBzcGVlZFxyXG5cdFx0XHRcdFx0XHQvLyB3aGF0IHRpbWUgd2UgYXJlIHNob3J0IC0gc28gd2lsbCBhZGQgYSBtaW51cyBpbiBmcm9udCBvZiB0aGUgdGltZVxyXG5cdFx0XHRcdFx0XHR2YXIgZWxhcHNlZHByZXYgPSB0aGlzLl9fcHJldi5jYWxjdWxhdGVFbGFwc2VkQXZlcmFnZShjdGltZSk7XHJcblx0XHRcdFx0XHRcdHZhciBkcHJldiA9ICgoZWxhcHNlZHByZXYgLSBlbGFwc2VkKSp0aGlzLnRyYWNrLmdldFRyYWNrTGVuZ3RoKCkgLyB0aGlzLmdldFNwZWVkKCkpLzYwLjA7XHJcblx0XHRcdFx0XHRcdGRwcmV2ID0gcGFyc2VGbG9hdChNYXRoLnJvdW5kKGRwcmV2ICogMTAwKSAvIDEwMCkudG9GaXhlZCgyKTtcclxuXHRcdFx0XHRcdFx0aHRtbCs9XCI8ZGl2IGNsYXNzPSdwb3B1cF9jb250ZW50X2wyJz5HQVAgUFwiKyh0aGlzLl9fcHJldi5fX3BvcyArIDEpK1wiIDogLVwiK2RwcmV2K1wiIE1pbjwvZGl2PlwiO1xyXG5cdFx0XHRcdFx0fSBlbHNlIHtcclxuXHRcdFx0XHRcdFx0aHRtbCs9XCI8ZGl2IGNsYXNzPSdwb3B1cF9jb250ZW50X2wyJz4mbmJzcDs8L2Rpdj5cIjtcclxuXHRcdFx0XHRcdH1cclxuXHJcblx0XHRcdFx0XHRpZiAodGhpcy5fX25leHQgJiYgdGhpcy5fX25leHQuX19wb3MgIT0gdW5kZWZpbmVkICYmIHRoaXMuX19uZXh0LmdldFNwZWVkKCkpIHtcclxuXHRcdFx0XHRcdFx0Ly8gd2hhdCBpcyB0aGUgZGlmZmVyZW5jZSBiZXR3ZWVuIGN1cnJlbnQgb25lIGFuZCB0aGUgb25lIGJlaGluZCAtIHRoaXMgb3RoZXIgb25lIHdpbGwgcnVuIHNvIGhpcyBzcGVlZFxyXG5cdFx0XHRcdFx0XHQvLyB3YWh0IHRpbWUgd2UgYXJlIGFoZWFkIC0gc28gYSBwb3NpdGl2ZSB0aW1lXHJcblx0XHRcdFx0XHRcdHZhciBlbGFwc2VkbmV4dCA9IHRoaXMuX19uZXh0LmNhbGN1bGF0ZUVsYXBzZWRBdmVyYWdlKGN0aW1lKTtcclxuXHRcdFx0XHRcdFx0dmFyIGRuZXh0ID0gKChlbGFwc2VkIC0gZWxhcHNlZG5leHQpKnRoaXMudHJhY2suZ2V0VHJhY2tMZW5ndGgoKSAvIHRoaXMuX19uZXh0LmdldFNwZWVkKCkpLzYwLjA7XHJcblx0XHRcdFx0XHRcdGRuZXh0ID0gcGFyc2VGbG9hdChNYXRoLnJvdW5kKGRuZXh0ICogMTAwKSAvIDEwMCkudG9GaXhlZCgyKTtcclxuXHRcdFx0XHRcdFx0aHRtbCs9XCI8ZGl2IGNsYXNzPSdwb3B1cF9jb250ZW50X2wzJz5HQVAgUFwiKyh0aGlzLl9fbmV4dC5fX3BvcyArIDEpK1wiIDogXCIrZG5leHQrXCIgTWluPC9kaXY+XCI7XHJcblx0XHRcdFx0XHR9IGVsc2Uge1xyXG5cdFx0XHRcdFx0XHRodG1sKz1cIjxkaXYgY2xhc3M9J3BvcHVwX2NvbnRlbnRfbDInPiZuYnNwOzwvZGl2PlwiO1xyXG5cdFx0XHRcdFx0fVxyXG5cdFx0XHRcdH1cclxuXHRcdFx0fSBlbHNlIHtcclxuXHRcdFx0XHRodG1sKz1cIjxkaXYgY2xhc3M9J3BvcHVwX2NvbnRlbnRfbDInPk1PUkUgVE8gIFwiK3RwYXJ0TW9yZStcIjogXCIrKGlzRHVtbXkgPyBcIi1cIiA6IHBhcnNlRmxvYXQoTWF0aC5yb3VuZCgodGFyZ2V0S00tZWxrbSkgKiAxMDApIC8gMTAwKS50b0ZpeGVkKDIpIC8qIHJla20gKi8gK1wiIGttXCIpK1wiPC9kaXY+XCI7XHJcblx0XHRcdFx0aHRtbCs9XCI8ZGl2IGNsYXNzPSdwb3B1cF9jb250ZW50X2wzJz5GSU5JU0ggXCIrIHRwYXJ0cyArXCI6IFwiKyghZXN0ZiA/IFwiLVwiIDogZXN0ZikrXCI8L2Rpdj5cIjtcclxuXHRcdFx0fVxyXG5cdFx0XHRodG1sKz1cIjwvZGl2PlwiO1xyXG5cdFx0XHRyZXR1cm4gaHRtbDtcclxuXHRcdH1cclxuXHRcdFxyXG5cdFx0XHJcbiAgICB9XHJcbn0pO1xyXG4iLCJyZXF1aXJlKCdqb29zZScpO1xyXG5cclxuQ2xhc3MoXCJQb2ludFwiLCB7XHJcbiAgICAvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcbiAgICAvLyBBTEwgQ09PUkRJTkFURVMgQVJFIElOIFdPUkxEIE1FUkNBVE9SXHJcbiAgICAvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblxyXG4gICAgaGFzIDoge1xyXG4gICAgICAgIGNvZGUgOiB7XHJcbiAgICAgICAgICAgIGlzIDogXCJyd1wiLFxyXG4gICAgICAgICAgICBpbml0IDogXCJDT0RFX05PVF9TRVRcIlxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgaWQgOiB7XHJcbiAgICAgICAgICAgIGlzIDogXCJyd1wiLFxyXG4gICAgICAgICAgICBpbml0IDogXCJJRF9OT1RfU0VUXCJcclxuICAgICAgICB9LFxyXG4gICAgICAgIGZlYXR1cmUgOiB7XHJcbiAgICAgICAgICAgIGlzIDogXCJyd1wiLFxyXG4gICAgICAgICAgICBpbml0IDogbnVsbFxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgcG9zaXRpb24gOiB7XHJcbiAgICAgICAgICAgIGlzOiAgIFwicndcIixcclxuICAgICAgICAgICAgaW5pdDogWzAsMF1cdC8vbG9uIGxhdCB3b3JsZCBtZXJjYXRvclxyXG4gICAgICAgIH1cclxuICAgIH0sXHJcblxyXG4gICAgbWV0aG9kcyA6IHtcclxuICAgICAgICBpbml0IDogZnVuY3Rpb24ocG9zKSB7XHJcbiAgICAgICAgICAgIGlmICh0eXBlb2Ygb2wgIT0gXCJ1bmRlZmluZWRcIikge1xyXG4gICAgICAgICAgICAgICAgdmFyIGdlb20gPSBuZXcgb2wuZ2VvbS5Qb2ludChwb3MpO1xyXG4gICAgICAgICAgICAgICAgZ2VvbS50cmFuc2Zvcm0oJ0VQU0c6NDMyNicsICdFUFNHOjM4NTcnKTtcclxuICAgICAgICAgICAgICAgIHZhciBmZWF0dXJlID0gbmV3IG9sLkZlYXR1cmUoKTtcclxuICAgICAgICAgICAgICAgIGZlYXR1cmUuc2V0R2VvbWV0cnkoZ2VvbSk7XHJcbiAgICAgICAgICAgICAgICB0aGlzLnNldEZlYXR1cmUoZmVhdHVyZSk7XHJcblxyXG4gICAgICAgICAgICAgICAgdGhpcy5zZXRQb3NpdGlvbihwb3MpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG59KTsiLCJ2YXIgQ09ORklHID0gcmVxdWlyZSgnLi9Db25maWcnKTtcclxuLy8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxudmFyIGFsaWFzZXM9e307XHJcbnZhciBhbGlhc2VzUj17fTtcclxuJC5hamF4KHtcclxuXHR0eXBlOiBcIkdFVFwiLFxyXG5cdHVybDogXCJkYXRhL2FsaWFzZXMueG1sXCIsXHJcblx0ZGF0YVR5cGU6IFwieG1sXCIsXHJcblx0c3VjY2VzczogZnVuY3Rpb24oeG1sKSB7XHJcblx0XHR2YXIgJHhtbCA9ICQoeG1sKTtcclxuXHRcdHZhciAkdGl0bGUgPSAkeG1sLmZpbmQoIFwiTTJNRGV2aWNlXCIgKS5lYWNoKGZ1bmN0aW9uKCkge1xyXG5cdFx0XHR2YXIgZGV2SWQ9JCh0aGlzKS5hdHRyKFwibTJtRGV2aWNlSWRcIik7XHJcblx0XHRcdHZhciBpbWVpPSQodGhpcykuYXR0cihcImltZWlOdW1iZXJcIik7XHJcblx0XHRcdGFsaWFzZXNbaW1laV09ZGV2SWQ7XHJcblx0XHRcdGFsaWFzZXNSW2RldklkXT1pbWVpO1xyXG5cdFx0fSk7XHJcblx0fVxyXG59KTtcclxuXHJcbmZ1bmN0aW9uIGFsaWFzKGltZWkpIFxyXG57IFxyXG5cdGlmIChhbGlhc2VzUltpbWVpXSlcclxuXHRcdHJldHVybiBhbGlhc2VzUltpbWVpXTtcclxuXHRyZXR1cm4gaW1laTtcclxufVxyXG4vLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cclxuXHJcbnZhciBTVFlMRVM9XHJcbntcclxuXHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdC8vIHN0eWxlIGZ1bmN0aW9uIGZvciB0cmFja1xyXG5cdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0XHRcclxuXHRcIl90cmFja1wiOiBmdW5jdGlvbihmZWF0dXJlLHJlc29sdXRpb24pIFxyXG5cdHtcclxuICAgICAgICByZXR1cm4gW1xyXG4gICAgICAgIF07XHJcblx0fSxcclxuXHJcblx0XCJ0ZXN0XCI6IGZ1bmN0aW9uKGZlYXR1cmUscmVzb2x1dGlvbikgXHJcblx0e1xyXG5cdFx0dmFyIHN0eWxlcz1bXTtcclxuICAgICAgICBzdHlsZXMucHVzaChuZXcgb2wuc3R5bGUuU3R5bGUoe1xyXG4gICAgICAgICAgICBpbWFnZTogbmV3IG9sLnN0eWxlLkNpcmNsZSh7XHJcbiAgICAgICAgICAgICAgICByYWRpdXM6IDE3LFxyXG4gICAgICAgICAgICAgICAgZmlsbDogbmV3IG9sLnN0eWxlLkZpbGwoe1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbG9yOiBcInJnYmEoMjU1LDI1NSwyNTUsMC41KVwiXHJcbiAgICAgICAgICAgICAgICB9KSxcclxuICAgICAgICAgICAgICAgIHN0cm9rZTogbmV3IG9sLnN0eWxlLlN0cm9rZSh7XHJcbiAgICAgICAgICAgICAgICAgICAgY29sb3I6IFwicmdiYSgyNTUsMjU1LDI1NSwxKVwiLFxyXG4gICAgICAgICAgICAgICAgICAgIHdpZHRoOiAzXHJcbiAgICAgICAgICAgICAgICB9KVxyXG4gICAgICAgICAgICB9KVxyXG4gICAgICAgIH0pKTtcclxuICAgICAgICByZXR1cm4gc3R5bGVzO1xyXG5cdH0sXHJcblxyXG5cdFwidGVzdDJcIjogZnVuY3Rpb24oZmVhdHVyZSxyZXNvbHV0aW9uKSBcclxuXHR7XHJcblx0XHR2YXIgc3R5bGVzPVtdO1xyXG4gICAgICAgIHN0eWxlcy5wdXNoKG5ldyBvbC5zdHlsZS5TdHlsZSh7XHJcbiAgICAgICAgICAgIHN0cm9rZTogbmV3IG9sLnN0eWxlLlN0cm9rZSh7XHJcbiAgICAgICAgICAgICAgICBjb2xvcjogXCJyZ2JhKDI1NSwyNTUsMCwxKVwiLFxyXG4gICAgICAgICAgICAgICAgd2lkdGg6IDNcclxuICAgICAgICAgICAgfSksXHJcblx0ICAgICAgICBpbWFnZTogbmV3IG9sLnN0eWxlLkNpcmNsZSh7XHJcblx0ICAgICAgICAgICAgcmFkaXVzOiA3LFxyXG5cdCAgICAgICAgICAgIHN0cm9rZTogbmV3IG9sLnN0eWxlLlN0cm9rZSh7XHJcblx0ICAgICAgICAgICAgXHQvL2ZlYXR1cmUuY29sb3JcclxuXHQgICAgICAgICAgICAgICAgY29sb3I6IFwicmdiYSgyNTUsMjU1LDAsMSlcIixcclxuXHQgICAgICAgICAgICAgICAgd2lkdGg6IDNcclxuXHQgICAgICAgICAgICB9KSxcclxuXHQgICAgICAgICAgICBmaWxsOiBuZXcgb2wuc3R5bGUuU3Ryb2tlKHtcclxuXHQgICAgICAgICAgICBcdC8vZmVhdHVyZS5jb2xvclxyXG5cdCAgICAgICAgICAgICAgICBjb2xvcjogXCJyZ2JhKDI1NSwyNTUsMCwwLjcpXCIsXHJcblx0ICAgICAgICAgICAgICAgIHdpZHRoOiAzXHJcblx0ICAgICAgICAgICAgfSlcclxuXHQgICAgICAgIH0pLFxyXG5cdCAgICAgICAgdGV4dDogbmV3IG9sLnN0eWxlLlRleHQoe1xyXG5cdCAgICAgICAgICAgIGZvbnQ6ICdib2xkIDE1cHggTGF0by1SZWd1bGFyJyxcclxuXHQgICAgICAgICAgICBmaWxsOiBuZXcgb2wuc3R5bGUuRmlsbCh7XHJcblx0ICAgICAgICAgICAgICAgIGNvbG9yOiAncmdiYSgyNTUsMjU1LDAsMSknXHJcblx0ICAgICAgICAgICAgfSksXHJcblx0ICAgICAgICAgICAgdGV4dDogZmVhdHVyZS5nZXRHZW9tZXRyeSgpIGluc3RhbmNlb2Ygb2wuZ2VvbS5Qb2ludCA/IChNYXRoLnJvdW5kKGZlYXR1cmUuZGVidWdJbmZvLnZhbHVlKjEwMCoxMDAuMCkvMTAwLjApK1wiJVwiIDogXCJcIixcclxuXHQgICAgICAgICAgICBvZmZzZXRYOiAgMCxcclxuXHQgICAgICAgICAgICBvZmZzZXRZIDogMTZcclxuXHQgICAgICAgIH0pXHJcbiAgICAgICAgfSkpO1xyXG4gICAgICAgIHJldHVybiBzdHlsZXM7XHJcblx0fSxcclxuXHJcblx0XCJ0ZXN0MVwiOiBmdW5jdGlvbihmZWF0dXJlLHJlc29sdXRpb24pIFxyXG5cdHtcclxuXHRcdHZhciBzdHlsZXM9W107XHJcbiAgICAgICAgc3R5bGVzLnB1c2gobmV3IG9sLnN0eWxlLlN0eWxlKHtcclxuICAgICAgICAgICAgIHN0cm9rZTogbmV3IG9sLnN0eWxlLlN0cm9rZSh7XHJcbiAgICAgICAgICAgICAgICAgY29sb3I6IFwicmdiYSgwLDAsMCwwLjQpXCIsXHJcbiAgICAgICAgICAgICAgICAgd2lkdGg6IDNcclxuICAgICAgICAgICAgIH0pLFxyXG5cdCAgICAgICAgIGZpbGw6IG5ldyBvbC5zdHlsZS5GaWxsKHtcclxuXHQgICAgICAgICAgICBjb2xvcjogXCJyZ2JhKDQwLDI1NSw0MCwwLjIpXCJcclxuXHQgICAgICAgICB9KSxcclxuICAgICAgICB9KSk7XHJcbiAgICAgICAgcmV0dXJuIHN0eWxlcztcclxuXHR9LFxyXG5cdFwidHJhY2tcIiA6IGZ1bmN0aW9uKGZlYXR1cmUscmVzb2x1dGlvbikgXHJcblx0e1xyXG5cdFx0dmFyIHN0eWxlcz1bXTtcclxuXHRcdHZhciB0cmFjaz1mZWF0dXJlLnRyYWNrO1xyXG5cdFx0aWYgKCF0cmFjaykge1xyXG5cdFx0XHRjb25zb2xlLmxvZyhcIlJlbmRlcmluZyB0cmFjayBmZWF0dXJlIHdpdGhvdXQgdHJhY2sgb2JqZWN0IVwiKTtcclxuXHRcdFx0cmV0dXJuIHN0eWxlcztcclxuXHRcdH1cclxuXHRcdHZhciBjb29yZHM9ZmVhdHVyZS5nZXRHZW9tZXRyeSgpLmdldENvb3JkaW5hdGVzKCk7XHJcblx0XHR2YXIgZ2VvbXN3aW09Y29vcmRzO1xyXG5cdFx0dmFyIGdlb21iaWtlO1xyXG5cdFx0dmFyIGdlb21ydW47XHJcblx0XHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRcdFxyXG5cdFx0Lyp2YXIgd3cgPSA4LjAvcmVzb2x1dGlvbjtcclxuXHRcdGlmICh3dyA8IDYuMClcclxuXHRcdFx0d3c9Ni4wOyovXHJcblx0XHR2YXIgd3c9MTAuMDtcclxuXHJcblx0XHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRcdGlmICh0cmFjayAmJiAhaXNOYU4odHJhY2suYmlrZVN0YXJ0S00pKSBcclxuXHRcdHtcclxuXHRcdFx0Zm9yICh2YXIgaT0wO2k8dHJhY2suZGlzdGFuY2VzLmxlbmd0aDtpKyspIHtcclxuXHRcdFx0XHRpZiAodHJhY2suZGlzdGFuY2VzW2ldID49IHRyYWNrLmJpa2VTdGFydEtNKjEwMDApIHtcclxuXHRcdFx0XHRcdGJyZWFrO1xyXG5cdFx0XHRcdH1cclxuXHRcdFx0fVxyXG5cdFx0XHR2YXIgajtcclxuXHRcdFx0aWYgKCFpc05hTih0cmFjay5ydW5TdGFydEtNKSkge1xyXG5cdFx0XHRcdGZvciAoaj1pO2o8dHJhY2suZGlzdGFuY2VzLmxlbmd0aDtqKyspIHtcclxuXHRcdFx0XHRcdGlmICh0cmFjay5kaXN0YW5jZXNbal0gPj0gdHJhY2sucnVuU3RhcnRLTSoxMDAwKVxyXG5cdFx0XHRcdFx0XHRicmVhaztcclxuXHRcdFx0XHR9XHJcblx0XHRcdH0gZWxzZSB7XHJcblx0XHRcdFx0aj10cmFjay5kaXN0YW5jZXMubGVuZ3RoO1xyXG5cdFx0XHR9XHJcblx0XHRcdGdlb21zd2ltPWNvb3Jkcy5zbGljZSgwLGkpO1xyXG5cdFx0XHRnZW9tYmlrZT1jb29yZHMuc2xpY2UoaSA8IDEgPyBpIDogaS0xLGopO1xyXG5cdFx0XHRpZiAoaiA8IHRyYWNrLmRpc3RhbmNlcy5sZW5ndGgpXHJcblx0XHRcdFx0Z2VvbXJ1bj1jb29yZHMuc2xpY2UoaiA8IDEgPyBqIDogai0xLHRyYWNrLmRpc3RhbmNlcy5sZW5ndGgpO1xyXG5cdFx0XHRpZiAoIWdlb21zd2ltIHx8ICFnZW9tc3dpbS5sZW5ndGgpXHJcblx0XHRcdFx0Z2VvbXN3aW09bnVsbDtcclxuXHRcdFx0aWYgKCFnZW9tYmlrZSB8fCAhZ2VvbWJpa2UubGVuZ3RoKVxyXG5cdFx0XHRcdGdlb21iaWtlPW51bGw7XHJcblx0XHRcdGlmICghZ2VvbXJ1biB8fCAhZ2VvbXJ1bi5sZW5ndGgpXHJcbiAgICAgICAgICAgICAgICBnZW9tcnVuPW51bGw7XHJcblx0XHR9XHJcblxyXG5cclxuICAgICAgICBpZiAoZ2VvbXN3aW0gJiYgR1VJLmlzU2hvd1N3aW0pIHtcclxuICAgICAgICAgICAgc3R5bGVzLnB1c2gobmV3IG9sLnN0eWxlLlN0eWxlKHtcclxuICAgICAgICAgICAgICAgICAgICBnZW9tZXRyeTogbmV3IG9sLmdlb20uTGluZVN0cmluZyhnZW9tc3dpbSksXHJcbiAgICAgICAgICAgICAgICAgICAgc3Ryb2tlOiBuZXcgb2wuc3R5bGUuU3Ryb2tlKHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29sb3I6IENPTkZJRy5hcHBlYXJhbmNlLnRyYWNrQ29sb3JTd2ltLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICB3aWR0aDogd3dcclxuICAgICAgICAgICAgICAgICAgICB9KVxyXG4gICAgICAgICAgICAgICAgfSlcclxuICAgICAgICAgICAgKTtcclxuICAgICAgICAgICAgU1RZTEVTLl9nZW5EaXJlY3Rpb24oZ2VvbXN3aW0sIHd3LCByZXNvbHV0aW9uLCBDT05GSUcuYXBwZWFyYW5jZS50cmFja0NvbG9yU3dpbSwgc3R5bGVzKTtcclxuXHJcbiAgICAgICAgICAgIFNUWUxFUy5fZ2VuRGlzdGFuY2VLbSh3dywgcmVzb2x1dGlvbiwgY29vcmRzLCB0cmFjay5kaXN0YW5jZXMsIDAsIGksIHN0eWxlcyk7XHJcblxyXG5cdFx0XHQvLyBmb3Igbm93IGRvbid0IHNob3cgdGhpcyBjaGVja3BvaW50XHJcblx0XHRcdC8vaWYgKEdVSS5pc1Nob3dTd2ltKVxyXG5cdFx0XHQvL1x0U1RZTEVTLl9nZW5DaGVja3BvaW50KGdlb21zd2ltLCBDT05GSUcuYXBwZWFyYW5jZS50cmFja0NvbG9yU3dpbSwgc3R5bGVzKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgaWYgKGdlb21iaWtlICYmIEdVSS5pc1Nob3dCaWtlKVxyXG4gICAgICAgIHtcclxuICAgICAgICAgICAgc3R5bGVzLnB1c2gobmV3IG9sLnN0eWxlLlN0eWxlKHtcclxuICAgICAgICAgICAgICAgICAgICBnZW9tZXRyeTogbmV3IG9sLmdlb20uTGluZVN0cmluZyhnZW9tYmlrZSksXHJcbiAgICAgICAgICAgICAgICAgICAgc3Ryb2tlOiBuZXcgb2wuc3R5bGUuU3Ryb2tlKHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29sb3I6IENPTkZJRy5hcHBlYXJhbmNlLnRyYWNrQ29sb3JCaWtlLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICB3aWR0aDogd3dcclxuICAgICAgICAgICAgICAgICAgICB9KVxyXG4gICAgICAgICAgICAgICAgfSlcclxuICAgICAgICAgICAgKTtcclxuICAgICAgICAgICAgU1RZTEVTLl9nZW5EaXJlY3Rpb24oZ2VvbWJpa2UsIHd3LCByZXNvbHV0aW9uLCBDT05GSUcuYXBwZWFyYW5jZS50cmFja0NvbG9yQmlrZSwgc3R5bGVzKTtcclxuXHJcbiAgICAgICAgICAgIFNUWUxFUy5fZ2VuRGlzdGFuY2VLbSh3dywgcmVzb2x1dGlvbiwgY29vcmRzLCB0cmFjay5kaXN0YW5jZXMsIGksIGosIHN0eWxlcyk7XHJcblxyXG5cdFx0XHQvLyBhZGQgY2hlY2twb2ludCBpZiB0aGlzIGlzIG5vdCBhbHJlYWR5IGFkZGVkIGFzIGEgaG90c3BvdFxyXG5cdFx0XHRpZiAoIXRyYWNrLmlzQWRkZWRIb3RTcG90U3dpbUJpa2UpIHtcclxuXHRcdFx0XHRpZiAoQ09ORklHLmFwcGVhcmFuY2UuaXNTaG93Q2hlY2twb2ludEltYWdlKVxyXG5cdFx0XHRcdFx0U1RZTEVTLl9nZW5DaGVja3BvaW50SW1hZ2UoZ2VvbWJpa2UsIENPTkZJRy5hcHBlYXJhbmNlLmltYWdlQ2hlY2twb2ludFN3aW1CaWtlLCBzdHlsZXMpO1xyXG5cdFx0XHRcdGVsc2UgaWYgKENPTkZJRy5hcHBlYXJhbmNlLmlzU2hvd0NoZWNrcG9pbnQgJiYgR1VJLmlzU2hvd0Jpa2UpXHJcblx0XHRcdFx0XHRTVFlMRVMuX2dlbkNoZWNrcG9pbnQoZ2VvbWJpa2UsIENPTkZJRy5hcHBlYXJhbmNlLnRyYWNrQ29sb3JCaWtlLCBzdHlsZXMpO1xyXG5cdFx0XHR9XHJcbiAgICAgICAgfVxyXG5cdFx0aWYgKGdlb21ydW4gJiYgR1VJLmlzU2hvd1J1bilcclxuXHRcdHtcclxuXHRcdFx0c3R5bGVzLnB1c2gobmV3IG9sLnN0eWxlLlN0eWxlKHtcclxuICAgICAgICAgICAgICAgICAgICBnZW9tZXRyeTogbmV3IG9sLmdlb20uTGluZVN0cmluZyhnZW9tcnVuKSxcclxuICAgICAgICAgICAgICAgICAgICBzdHJva2U6IG5ldyBvbC5zdHlsZS5TdHJva2Uoe1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb2xvcjogQ09ORklHLmFwcGVhcmFuY2UudHJhY2tDb2xvclJ1bixcclxuICAgICAgICAgICAgICAgICAgICAgICAgd2lkdGg6IHd3XHJcbiAgICAgICAgICAgICAgICAgICAgfSlcclxuICAgICAgICAgICAgICAgIH0pXHJcbiAgICAgICAgICAgICk7XHJcbiAgICAgICAgICAgIFNUWUxFUy5fZ2VuRGlyZWN0aW9uKGdlb21ydW4sIHd3LCByZXNvbHV0aW9uLCBDT05GSUcuYXBwZWFyYW5jZS50cmFja0NvbG9yUnVuLCBzdHlsZXMpO1xyXG5cclxuICAgICAgICAgICAgU1RZTEVTLl9nZW5EaXN0YW5jZUttKHd3LCByZXNvbHV0aW9uLCBjb29yZHMsIHRyYWNrLmRpc3RhbmNlcywgaiwgdHJhY2suZGlzdGFuY2VzLmxlbmd0aCwgc3R5bGVzKTtcclxuXHJcblx0XHRcdC8vIGFkZCBjaGVja3BvaW50IGlmIHRoaXMgaXMgbm90IGFscmVhZHkgYWRkZWQgYXMgYSBob3RzcG90XHJcblx0XHRcdGlmICghdHJhY2suaXNBZGRlZEhvdFNwb3RCaWtlUnVuKSB7XHJcblx0XHRcdFx0aWYgKENPTkZJRy5hcHBlYXJhbmNlLmlzU2hvd0NoZWNrcG9pbnRJbWFnZSlcclxuXHRcdFx0XHRcdFNUWUxFUy5fZ2VuQ2hlY2twb2ludEltYWdlKGdlb21ydW4sIENPTkZJRy5hcHBlYXJhbmNlLmltYWdlQ2hlY2twb2ludEJpa2VSdW4sIHN0eWxlcyk7XHJcblx0XHRcdFx0ZWxzZSBpZiAoQ09ORklHLmFwcGVhcmFuY2UuaXNTaG93Q2hlY2twb2ludCAmJiBHVUkuaXNTaG93QmlrZSlcclxuXHRcdFx0XHRcdFNUWUxFUy5fZ2VuQ2hlY2twb2ludChnZW9tcnVuLCBDT05GSUcuYXBwZWFyYW5jZS50cmFja0NvbG9yUnVuLCBzdHlsZXMpO1xyXG5cdFx0XHR9XHJcbiAgICAgICAgfVxyXG5cclxuXHRcdC8vIFNUQVJULUZJTklTSCAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdFx0aWYgKGNvb3JkcyAmJiBjb29yZHMubGVuZ3RoID49IDIpXHJcblx0XHR7XHJcblx0XHRcdHZhciBzdGFydCA9IGNvb3Jkc1swXTtcclxuXHRcdFx0dmFyIGVuZCA9IGNvb3Jkc1sxXTtcclxuXHRcdFx0Lyp2YXIgZHggPSBlbmRbMF0gLSBzdGFydFswXTtcclxuXHRcdFx0IHZhciBkeSA9IGVuZFsxXSAtIHN0YXJ0WzFdO1xyXG5cdFx0XHQgdmFyIHJvdGF0aW9uID0gTWF0aC5hdGFuMihkeSwgZHgpO1xyXG5cdFx0XHQgc3R5bGVzLnB1c2gobmV3IG9sLnN0eWxlLlN0eWxlKFxyXG5cdFx0XHQge1xyXG5cdFx0XHQgZ2VvbWV0cnk6IG5ldyBvbC5nZW9tLlBvaW50KHN0YXJ0KSxcclxuXHRcdFx0IGltYWdlOiBuZXcgb2wuc3R5bGUuSWNvbih7XHJcblx0XHRcdCBzcmM6ICdpbWcvYmVnaW4tZW5kLWFycm93LnBuZycsXHJcblx0XHRcdCBzY2FsZSA6IDAuNDUsXHJcblx0XHRcdCBhbmNob3I6IFswLjAsIDAuNV0sXHJcblx0XHRcdCByb3RhdGVXaXRoVmlldzogdHJ1ZSxcclxuXHRcdFx0IHJvdGF0aW9uOiAtcm90YXRpb24sXHJcblx0XHRcdCBvcGFjaXR5IDogMVxyXG5cdFx0XHQgfSlcclxuXHRcdFx0IH0pKTsqL1xyXG5cclxuXHRcdFx0Ly8gbG9vcD9cclxuXHRcdFx0ZW5kID0gY29vcmRzW2Nvb3Jkcy5sZW5ndGgtMV07XHJcblx0XHRcdGlmIChlbmRbMF0gIT0gc3RhcnRbMF0gfHwgZW5kWzFdICE9IHN0YXJ0WzFdKVxyXG5cdFx0XHR7XHJcblx0XHRcdFx0dmFyIHN0YXJ0ID0gY29vcmRzW2Nvb3Jkcy5sZW5ndGgtMl07XHJcblx0XHRcdFx0dmFyIGR4ID0gZW5kWzBdIC0gc3RhcnRbMF07XHJcblx0XHRcdFx0dmFyIGR5ID0gZW5kWzFdIC0gc3RhcnRbMV07XHJcblx0XHRcdFx0dmFyIHJvdGF0aW9uID0gTWF0aC5hdGFuMihkeSwgZHgpO1xyXG5cdFx0XHRcdHN0eWxlcy5wdXNoKG5ldyBvbC5zdHlsZS5TdHlsZShcclxuXHRcdFx0XHRcdHtcclxuXHRcdFx0XHRcdFx0Z2VvbWV0cnk6IG5ldyBvbC5nZW9tLlBvaW50KGVuZCksXHJcblx0XHRcdFx0XHRcdGltYWdlOiBuZXcgb2wuc3R5bGUuSWNvbih7XHJcblx0XHRcdFx0XHRcdFx0c3JjOiBDT05GSUcuYXBwZWFyYW5jZS5pbWFnZUZpbmlzaCxcclxuXHRcdFx0XHRcdFx0XHRzY2FsZSA6IDAuNDUsXHJcblx0XHRcdFx0XHRcdFx0YW5jaG9yOiBbMC41LCAwLjVdLFxyXG5cdFx0XHRcdFx0XHRcdHJvdGF0ZVdpdGhWaWV3OiB0cnVlLFxyXG5cdFx0XHRcdFx0XHRcdC8vcm90YXRpb246IC1yb3RhdGlvbixcclxuXHRcdFx0XHRcdFx0XHRvcGFjaXR5IDogMVxyXG5cdFx0XHRcdFx0XHR9KVxyXG5cdFx0XHRcdFx0fSkpO1xyXG5cdFx0XHR9XHJcblx0XHR9XHJcblxyXG5cdFx0cmV0dXJuIHN0eWxlcztcclxuXHR9LFxyXG5cdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRcImRlYnVnR1BTXCIgOiBmdW5jdGlvbihmZWF0dXJlLHJlc29sdXRpb24pIFxyXG5cdHtcclxuXHRcdHZhciBjb2VmID0gKChuZXcgRGF0ZSgpKS5nZXRUaW1lKCktZmVhdHVyZS50aW1lQ3JlYXRlZCkvKENPTkZJRy50aW1lb3V0cy5ncHNMb2NhdGlvbkRlYnVnU2hvdyoxMDAwKTtcclxuXHRcdGlmIChjb2VmID4gMSlcclxuXHRcdFx0cmV0dXJuIFtdO1xyXG5cdFx0cmV0dXJuIFtcclxuXHRcdCAgICAgICAgbmV3IG9sLnN0eWxlLlN0eWxlKHtcclxuXHRcdCAgICAgICAgaW1hZ2U6IG5ldyBvbC5zdHlsZS5DaXJjbGUoe1xyXG5cdFx0ICAgICAgICAgICAgcmFkaXVzOiBjb2VmKjIwLFxyXG5cdFx0ICAgICAgICAgICAgc3Ryb2tlOiBuZXcgb2wuc3R5bGUuU3Ryb2tlKHtcclxuXHRcdCAgICAgICAgICAgIFx0Ly9mZWF0dXJlLmNvbG9yXHJcblx0XHQgICAgICAgICAgICAgICAgY29sb3I6IGNvbG9yQWxwaGFBcnJheShmZWF0dXJlLmNvbG9yLCgxLjAtY29lZikqMS4wKSwgXHJcblx0XHQgICAgICAgICAgICAgICAgd2lkdGg6IDRcclxuXHRcdCAgICAgICAgICAgIH0pXHJcblx0XHQgICAgICAgICAgfSlcclxuXHRcdH0pXTtcclxuXHR9LFxyXG5cdFxyXG5cdFwicGFydGljaXBhbnRcIiA6IGZ1bmN0aW9uKGZlYXR1cmUscmVzb2x1dGlvbikgXHJcblx0e1xyXG5cdFx0Ly8gU0tJUCBEUkFXIChUT0RPIE9QVElNSVpFKVxyXG5cdFx0dmFyIHBhcnQgPSBmZWF0dXJlLnBhcnRpY2lwYW50O1xyXG5cdFx0aWYgKCFwYXJ0LmlzRmF2b3JpdGUpXHJcblx0XHRcdHJldHVybiBbXTtcclxuXHRcdFxyXG5cdFx0dmFyIGN0aW1lID0gcGFydC5fX2N0aW1lID8gcGFydC5fX2N0aW1lIDogKG5ldyBEYXRlKCkpLmdldFRpbWUoKTtcclxuXHRcdHZhciBzcGVlZCA9IHBhcnQuYXZnKGN0aW1lLFwic3BlZWRcIik7XHJcblx0XHR2YXIgZXR4dD1cIlwiO1xyXG5cdFx0aWYgKHNwZWVkKSB7XHJcblx0XHRcdGV0eHQ9XCIgXCIrcGFyc2VGbG9hdChNYXRoLmNlaWwoc3BlZWQqIDEwMCkgLyAxMDApLnRvRml4ZWQoMikrXCIgbS9zXCI7XHJcblx0XHR9XHJcblx0XHR2YXIgekluZGV4ID0gTWF0aC5yb3VuZChwYXJ0LmdldEVsYXBzZWQoKSoxMDAwMDAwKSoxMDAwK3BhcnQuc2VxSWQ7XHJcblx0XHR2YXIgc3R5bGVzPVtdO1xyXG5cdFx0Ly8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdFx0dmFyIGlzVGltZSA9IChjdGltZSA+PSBDT05GSUcudGltZXMuYmVnaW4gJiYgY3RpbWUgPD0gQ09ORklHLnRpbWVzLmVuZCk7XHJcblx0XHR2YXIgaXNTT1MgPSBwYXJ0Lm1pbihjdGltZSxcImlzU09TXCIpO1xyXG5cdFx0dmFyIGlzRGlzY2FyZGVkID0gcGFydC5taW4oY3RpbWUsXCJpc0Rpc2NhcmRlZFwiKTtcclxuXHRcdHZhciBpc0RpcmVjdGlvbiA9IChzcGVlZCAmJiAhaXNTT1MgJiYgIWlzRGlzY2FyZGVkICYmIGlzVGltZSk7XHJcblx0XHR2YXIgYW5pbUZyYW1lID0gKGN0aW1lJTMwMDApKk1hdGguUEkqMi8zMDAwLjA7XHJcblxyXG4gICAgICAgIGlmIChpc1RpbWUpIHtcclxuICAgICAgICAgICAgc3R5bGVzLnB1c2gobmV3IG9sLnN0eWxlLlN0eWxlKHtcclxuICAgICAgICAgICAgICAgIHpJbmRleDogekluZGV4LFxyXG4gICAgICAgICAgICAgICAgaW1hZ2U6IG5ldyBvbC5zdHlsZS5DaXJjbGUoe1xyXG4gICAgICAgICAgICAgICAgICAgIHJhZGl1czogMTcsXHJcbiAgICAgICAgICAgICAgICAgICAgZmlsbDogbmV3IG9sLnN0eWxlLkZpbGwoe1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb2xvcjogaXNEaXNjYXJkZWQgfHwgaXNTT1MgPyBcInJnYmEoMTkyLDAsMCxcIiArIChNYXRoLnNpbihhbmltRnJhbWUpICogMC43ICsgMC4zKSArIFwiKVwiIDogXCJyZ2JhKFwiICsgY29sb3JBbHBoYUFycmF5KHBhcnQuY29sb3IsIDAuODUpLmpvaW4oXCIsXCIpICsgXCIpXCJcclxuICAgICAgICAgICAgICAgICAgICB9KSxcclxuICAgICAgICAgICAgICAgICAgICBzdHJva2U6IG5ldyBvbC5zdHlsZS5TdHJva2Uoe1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb2xvcjogaXNEaXNjYXJkZWQgfHwgaXNTT1MgPyBcInJnYmEoMjU1LDAsMCxcIiArICgxLjAgLSAoTWF0aC5zaW4oYW5pbUZyYW1lKSAqIDAuNyArIDAuMykpICsgXCIpXCIgOiBcIiNmZmZmZmZcIixcclxuICAgICAgICAgICAgICAgICAgICAgICAgd2lkdGg6IDNcclxuICAgICAgICAgICAgICAgICAgICB9KVxyXG4gICAgICAgICAgICAgICAgfSksXHJcbiAgICAgICAgICAgICAgICB0ZXh0OiBuZXcgb2wuc3R5bGUuVGV4dCh7XHJcbiAgICAgICAgICAgICAgICAgICAgZm9udDogJ25vcm1hbCAxM3B4IExhdG8tUmVndWxhcicsXHJcbiAgICAgICAgICAgICAgICAgICAgZmlsbDogbmV3IG9sLnN0eWxlLkZpbGwoe1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb2xvcjogJyNGRkZGRkYnXHJcbiAgICAgICAgICAgICAgICAgICAgfSksXHJcbiAgICAgICAgICAgICAgICAgICAgdGV4dDogcGFydC5nZXRJbml0aWFscygpLFxyXG4gICAgICAgICAgICAgICAgICAgIG9mZnNldFg6IDAsXHJcbiAgICAgICAgICAgICAgICAgICAgb2Zmc2V0WTogMFxyXG4gICAgICAgICAgICAgICAgfSlcclxuICAgICAgICAgICAgfSkpO1xyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgIHN0eWxlcy5wdXNoKG5ldyBvbC5zdHlsZS5TdHlsZSh7XHJcbiAgICAgICAgICAgICAgICB6SW5kZXg6IHpJbmRleCxcclxuICAgICAgICAgICAgICAgIGltYWdlOiBuZXcgb2wuc3R5bGUuQ2lyY2xlKHtcclxuICAgICAgICAgICAgICAgICAgICByYWRpdXM6IDE3LFxyXG4gICAgICAgICAgICAgICAgICAgIGZpbGw6IG5ldyBvbC5zdHlsZS5GaWxsKHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29sb3I6IFwicmdiYShcIiArIGNvbG9yQWxwaGFBcnJheShwYXJ0LmNvbG9yLCAwLjM1KS5qb2luKFwiLFwiKSArIFwiKVwiXHJcbiAgICAgICAgICAgICAgICAgICAgfSksXHJcbiAgICAgICAgICAgICAgICAgICAgc3Ryb2tlOiBuZXcgb2wuc3R5bGUuU3Ryb2tlKHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29sb3I6IFwicmdiYSgyNTUsMjU1LDI1NSwxKVwiLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICB3aWR0aDogM1xyXG4gICAgICAgICAgICAgICAgICAgIH0pXHJcbiAgICAgICAgICAgICAgICB9KSxcclxuICAgICAgICAgICAgICAgIHRleHQ6IG5ldyBvbC5zdHlsZS5UZXh0KHtcclxuICAgICAgICAgICAgICAgICAgICBmb250OiAnbm9ybWFsIDEzcHggTGF0by1SZWd1bGFyJyxcclxuICAgICAgICAgICAgICAgICAgICBmaWxsOiBuZXcgb2wuc3R5bGUuRmlsbCh7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbG9yOiAnIzAwMDAwMCdcclxuICAgICAgICAgICAgICAgICAgICB9KSxcclxuICAgICAgICAgICAgICAgICAgICB0ZXh0OiBhbGlhcyhwYXJ0LmdldERldmljZUlkKCkpLFxyXG4gICAgICAgICAgICAgICAgICAgIG9mZnNldFg6IDAsXHJcbiAgICAgICAgICAgICAgICAgICAgb2Zmc2V0WTogMjBcclxuICAgICAgICAgICAgICAgIH0pXHJcbiAgICAgICAgICAgIH0pKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgLy8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG4gICAgICAgIHN0eWxlcy5wdXNoKG5ldyBvbC5zdHlsZS5TdHlsZSh7XHJcbiAgICAgICAgICAgIHpJbmRleDogekluZGV4LFxyXG4gICAgICAgICAgICBpbWFnZTogbmV3IG9sLnN0eWxlLkNpcmNsZSh7XHJcbiAgICAgICAgICAgICAgICByYWRpdXM6IDE3LFxyXG4gICAgICAgICAgICAgICAgZmlsbDogbmV3IG9sLnN0eWxlLkZpbGwoe1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbG9yOiBwYXJ0LmlzRGlzY2FyZGVkIHx8IHBhcnQuaXNTT1MgPyBcInJnYmEoMTkyLDAsMCxcIiArIChNYXRoLnNpbihhbmltRnJhbWUpICogMC43ICsgMC4zKSArIFwiKVwiIDogXCJyZ2JhKFwiICsgY29sb3JBbHBoYUFycmF5KHBhcnQuY29sb3IsIDAuODUpLmpvaW4oXCIsXCIpICsgXCIpXCJcclxuICAgICAgICAgICAgICAgIH0pLFxyXG4gICAgICAgICAgICAgICAgc3Ryb2tlOiBuZXcgb2wuc3R5bGUuU3Ryb2tlKHtcclxuICAgICAgICAgICAgICAgICAgICBjb2xvcjogcGFydC5pc0Rpc2NhcmRlZCB8fCBwYXJ0LmlzU09TID8gXCJyZ2JhKDI1NSwwLDAsXCIgKyAoMS4wIC0gKE1hdGguc2luKGFuaW1GcmFtZSkgKiAwLjcgKyAwLjMpKSArIFwiKVwiIDogXCIjZmZmZmZmXCIsXHJcbiAgICAgICAgICAgICAgICAgICAgd2lkdGg6IDNcclxuICAgICAgICAgICAgICAgIH0pXHJcbiAgICAgICAgICAgIH0pLFxyXG4gICAgICAgICAgICB0ZXh0OiBuZXcgb2wuc3R5bGUuVGV4dCh7XHJcbiAgICAgICAgICAgICAgICBmb250OiAnbm9ybWFsIDEzcHggTGF0by1SZWd1bGFyJyxcclxuICAgICAgICAgICAgICAgIGZpbGw6IG5ldyBvbC5zdHlsZS5GaWxsKHtcclxuICAgICAgICAgICAgICAgICAgICBjb2xvcjogJyNGRkZGRkYnXHJcbiAgICAgICAgICAgICAgICB9KSxcclxuICAgICAgICAgICAgICAgIHRleHQ6IHBhcnQuZ2V0SW5pdGlhbHMoKSxcclxuICAgICAgICAgICAgICAgIG9mZnNldFg6IDAsXHJcbiAgICAgICAgICAgICAgICBvZmZzZXRZOiAwXHJcbiAgICAgICAgICAgIH0pXHJcbiAgICAgICAgfSkpO1xyXG5cclxuXHJcbiAgICAgICAgaWYgKGlzRGlyZWN0aW9uICYmIHBhcnQuZ2V0Um90YXRpb24oKSAhPSBudWxsKVxyXG4gICAgICAgIHtcclxuICAgICAgICAgICAgc3R5bGVzLnB1c2gobmV3IG9sLnN0eWxlLlN0eWxlKHtcclxuICAgICAgICAgICAgICAgIHpJbmRleDogekluZGV4LFxyXG4gICAgICAgICAgICAgICAgaW1hZ2U6IG5ldyBvbC5zdHlsZS5JY29uKCh7XHJcbiAgICAgICAgICAgICAgICAgICAgYW5jaG9yOiBbLTAuNSwwLjVdLFxyXG4gICAgICAgICAgICAgICAgICAgIGFuY2hvclhVbml0czogJ2ZyYWN0aW9uJyxcclxuICAgICAgICAgICAgICAgICAgICBhbmNob3JZVW5pdHM6ICdmcmFjdGlvbicsXHJcbiAgICAgICAgICAgICAgICAgICAgb3BhY2l0eTogMSxcclxuICAgICAgICAgICAgICAgICAgICBzcmMgOiByZW5kZXJBcnJvd0Jhc2U2NCg0OCw0OCxwYXJ0LmNvbG9yKSxcclxuXHRcdFx0XHRcdCAgc2NhbGUgOiAwLjU1LFxyXG5cdFx0XHRcdFx0ICByb3RhdGlvbiA6IC1wYXJ0LmdldFJvdGF0aW9uKClcclxuXHRcdFx0XHQgICB9KSlcclxuXHRcdFx0fSkpO1xyXG5cdFx0fVxyXG4gICAgICAgIFxyXG5cdFx0Lyp2YXIgY29lZiA9IHBhcnQudHJhY2suZ2V0VHJhY2tMZW5ndGhJbldHUzg0KCkvcGFydC50cmFjay5nZXRUcmFja0xlbmd0aCgpO1x0XHRcclxuXHRcdHZhciByciA9IENPTkZJRy5tYXRoLmdwc0luYWNjdXJhY3kqY29lZjtcdFx0XHJcbiAgICAgICAgc3R5bGVzLnB1c2gobmV3IG9sLnN0eWxlLlN0eWxlKHtcclxuICAgICAgICAgICAgekluZGV4OiB6SW5kZXgsXHJcbiAgICAgICAgICAgIGltYWdlOiBuZXcgb2wuc3R5bGUuQ2lyY2xlKHtcclxuICAgICAgICAgICAgXHRnZW9tZXRyeTogbmV3IG9sLmdlb20uUG9pbnQocGFydC5nZXRHUFMoKSksXHJcbiAgICAgICAgICAgICAgICByYWRpdXM6IDEwLCAvL3JyICogcmVzb2x1dGlvbixcclxuICAgICAgICAgICAgICAgIGZpbGw6IG5ldyBvbC5zdHlsZS5GaWxsKHtcclxuICAgICAgICAgICAgICAgICAgICBjb2xvcjogXCJyZ2JhKDI1NSwyNTUsMjU1LDAuOClcIlxyXG4gICAgICAgICAgICAgICAgfSksXHJcbiAgICAgICAgICAgICAgICBzdHJva2U6IG5ldyBvbC5zdHlsZS5TdHJva2Uoe1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbG9yOiBcInJnYmEoMCwwLDAsMSlcIixcclxuICAgICAgICAgICAgICAgICAgICB3aWR0aDogMVxyXG4gICAgICAgICAgICAgICAgfSlcclxuICAgICAgICAgICAgfSlcclxuICAgICAgICB9KSk7Ki9cclxuXHRcdHJldHVybiBzdHlsZXM7XHJcblx0fSxcclxuXHJcblx0XCJjYW1cIiA6IGZ1bmN0aW9uKGZlYXR1cmUsIHJlc29sdXRpb24pIHtcclxuXHRcdHZhciBzdHlsZXM9W107XHJcblxyXG5cdFx0dmFyIGNhbSA9IGZlYXR1cmUuY2FtO1xyXG5cclxuXHRcdHN0eWxlcy5wdXNoKG5ldyBvbC5zdHlsZS5TdHlsZSh7XHJcblx0XHRcdGltYWdlOiBuZXcgb2wuc3R5bGUuSWNvbigoe1xyXG5cdFx0XHRcdC8vIFRPRE8gUnVtZW4gLSBpdCdzIGJldHRlciBhbGwgaW1hZ2VzIHRvIGJlIHRoZSBzYW1lIHNpemUsIHNvIHRoZSBzYW1lIHNjYWxlXHJcblx0XHRcdFx0c2NhbGUgOiAwLjA0MCxcclxuXHRcdFx0XHRzcmMgOiBDT05GSUcuYXBwZWFyYW5jZS5pbWFnZUNhbS5zcGxpdChcIi5zdmdcIikuam9pbigoY2FtLnNlcUlkKzEpICsgXCIuc3ZnXCIpXHJcblx0XHRcdH0pKVxyXG5cdFx0fSkpO1xyXG5cclxuXHRcdHJldHVybiBzdHlsZXM7XHJcblx0fSxcclxuXHJcbiAgICBcImhvdHNwb3RcIiA6IGZ1bmN0aW9uKGZlYXR1cmUsIHJlc29sdXRpb24pIHtcclxuICAgICAgICB2YXIgc3R5bGVzPVtdO1xyXG5cclxuICAgICAgICB2YXIgaG90c3BvdCA9IGZlYXR1cmUuaG90c3BvdDtcclxuXHJcbiAgICAgICAgc3R5bGVzLnB1c2gobmV3IG9sLnN0eWxlLlN0eWxlKHtcclxuICAgICAgICAgICAgaW1hZ2U6IG5ldyBvbC5zdHlsZS5JY29uKCh7XHJcbiAgICAgICAgICAgICAgICBzY2FsZSA6IGhvdHNwb3QuZ2V0VHlwZSgpLnNjYWxlIHx8IDEsXHJcbiAgICAgICAgICAgICAgICBzcmMgOiBob3RzcG90LmdldFR5cGUoKS5pbWFnZVxyXG4gICAgICAgICAgICB9KSlcclxuICAgICAgICB9KSk7XHJcblxyXG4gICAgICAgIHJldHVybiBzdHlsZXM7XHJcbiAgICB9LFxyXG5cclxuXHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdC8vIFByaXZhdGUgbWV0aG9kc1xyXG5cdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblxyXG5cdF90cmFja1NlbGVjdGVkIDogbmV3IG9sLnN0eWxlLlN0eWxlKHtcclxuXHRcdHN0cm9rZTogbmV3IG9sLnN0eWxlLlN0cm9rZSh7XHJcblx0XHRcdGNvbG9yOiAnI0ZGNTA1MCcsXHJcblx0XHRcdHdpZHRoOiA0LjVcclxuXHRcdH0pXHJcblx0fSksXHJcblxyXG5cdF9nZW5DaGVja3BvaW50IDogZnVuY3Rpb24oZ2VvbWV0cnksIGNvbG9yLCBzdHlsZXMpIHtcclxuXHRcdHZhciBzdGFydCA9IGdlb21ldHJ5WzBdO1xyXG5cdFx0dmFyIGVuZCA9IGdlb21ldHJ5WzFdO1xyXG5cdFx0dmFyIGR4ID0gZW5kWzBdIC0gc3RhcnRbMF07XHJcblx0XHR2YXIgZHkgPSBlbmRbMV0gLSBzdGFydFsxXTtcclxuXHRcdHZhciByb3RhdGlvbiA9IE1hdGguYXRhbjIoZHksIGR4KTtcclxuXHJcblx0XHRzdHlsZXMucHVzaChuZXcgb2wuc3R5bGUuU3R5bGUoe1xyXG5cdFx0XHRnZW9tZXRyeTogbmV3IG9sLmdlb20uUG9pbnQoc3RhcnQpLFxyXG5cdFx0XHRpbWFnZTogbmV3IG9sLnN0eWxlLkljb24oe1xyXG5cdFx0XHRcdHNyYzogcmVuZGVyQm94QmFzZTY0KDE2LDE2LGNvbG9yKSxcclxuXHRcdFx0XHRzY2FsZSA6IDEsXHJcblx0XHRcdFx0YW5jaG9yOiBbMC45MiwgMC41XSxcclxuXHRcdFx0XHRyb3RhdGVXaXRoVmlldzogdHJ1ZSxcclxuXHRcdFx0XHRyb3RhdGlvbjogLXJvdGF0aW9uLFxyXG5cdFx0XHRcdG9wYWNpdHkgOiAwLjY1XHJcblx0XHRcdH0pXHJcblx0XHR9KSk7XHJcblx0fSxcclxuXHJcblx0X2dlbkNoZWNrcG9pbnRJbWFnZSA6IGZ1bmN0aW9uKGdlb21ldHJ5LCBpbWFnZSwgc3R5bGVzKSB7XHJcblx0XHR2YXIgc3RhcnQgPSBnZW9tZXRyeVswXTtcclxuXHRcdC8vdmFyIGVuZCA9IGdlb21ldHJ5WzFdO1xyXG5cdFx0Ly92YXIgZHggPSBlbmRbMF0gLSBzdGFydFswXTtcclxuXHRcdC8vdmFyIGR5ID0gZW5kWzFdIC0gc3RhcnRbMV07XHJcblx0XHQvL3ZhciByb3RhdGlvbiA9IE1hdGguYXRhbjIoZHksIGR4KTtcclxuXHJcblx0XHRzdHlsZXMucHVzaChuZXcgb2wuc3R5bGUuU3R5bGUoe1xyXG5cdFx0XHRnZW9tZXRyeTogbmV3IG9sLmdlb20uUG9pbnQoc3RhcnQpLFxyXG5cdFx0XHRpbWFnZTogbmV3IG9sLnN0eWxlLkljb24oe1xyXG5cdFx0XHRcdHNyYzogaW1hZ2UsXHJcblx0XHRcdFx0Ly9zY2FsZSA6IDAuNjUsXHJcblx0XHRcdFx0YW5jaG9yOiBbMC41LCAwLjVdLFxyXG5cdFx0XHRcdHJvdGF0ZVdpdGhWaWV3OiB0cnVlLFxyXG5cdFx0XHRcdC8vcm90YXRpb246IC1yb3RhdGlvbixcclxuXHRcdFx0XHRvcGFjaXR5IDogMVxyXG5cdFx0XHR9KVxyXG5cdFx0fSkpO1xyXG5cdH0sXHJcblxyXG5cdF9nZW5EaXJlY3Rpb24gOiBmdW5jdGlvbihwdHMsIHd3LCByZXNvbHV0aW9uLCBjb2xvciwgc3R5bGVzKSB7XHJcbiAgICAgICAgaWYgKENPTkZJRy5hcHBlYXJhbmNlLmRpcmVjdGlvbkljb25CZXR3ZWVuIDw9IDApIHtcclxuICAgICAgICAgICAgLy8gdGhpcyBtZWFucyBubyBuZWVkIHRvIHNob3cgdGhlIGRpcmVjdGlvbnNcclxuICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgdmFyIGNudCA9IDA7XHJcbiAgICAgICAgdmFyIGljbiA9IHJlbmRlckRpcmVjdGlvbkJhc2U2NCgxNiwgMTYsIGNvbG9yKTtcclxuICAgICAgICB2YXIgcmVzID0gMC4wO1xyXG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgcHRzLmxlbmd0aCAtIDE7IGkrKykge1xyXG4gICAgICAgICAgICB2YXIgc3RhcnQgPSBwdHNbaSArIDFdO1xyXG4gICAgICAgICAgICB2YXIgZW5kID0gcHRzW2ldO1xyXG4gICAgICAgICAgICB2YXIgZHggPSBlbmRbMF0gLSBzdGFydFswXTtcclxuICAgICAgICAgICAgdmFyIGR5ID0gZW5kWzFdIC0gc3RhcnRbMV07XHJcbiAgICAgICAgICAgIHZhciBsZW4gPSBNYXRoLnNxcnQoZHggKiBkeCArIGR5ICogZHkpIC8gcmVzb2x1dGlvbjtcclxuICAgICAgICAgICAgcmVzICs9IGxlbjtcclxuICAgICAgICAgICAgaWYgKGkgPT0gMCB8fCByZXMgPj0gQ09ORklHLmFwcGVhcmFuY2UuZGlyZWN0aW9uSWNvbkJldHdlZW4pIHtcclxuICAgICAgICAgICAgICAgIHJlcyA9IDA7XHJcbiAgICAgICAgICAgICAgICB2YXIgcm90YXRpb24gPSBNYXRoLmF0YW4yKGR5LCBkeCk7XHJcbiAgICAgICAgICAgICAgICBzdHlsZXMucHVzaChuZXcgb2wuc3R5bGUuU3R5bGUoe1xyXG4gICAgICAgICAgICAgICAgICAgIGdlb21ldHJ5OiBuZXcgb2wuZ2VvbS5Qb2ludChbKHN0YXJ0WzBdICsgZW5kWzBdKSAvIDIsIChzdGFydFsxXSArIGVuZFsxXSkgLyAyXSksXHJcbiAgICAgICAgICAgICAgICAgICAgaW1hZ2U6IG5ldyBvbC5zdHlsZS5JY29uKHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgc3JjOiBpY24sXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHNjYWxlOiB3dyAvIDEyLjAsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGFuY2hvcjogWzAuNSwgMC41XSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgcm90YXRlV2l0aFZpZXc6IHRydWUsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHJvdGF0aW9uOiAtcm90YXRpb24gKyBNYXRoLlBJLCAvLyBhZGQgMTgwIGRlZ3JlZXNcclxuICAgICAgICAgICAgICAgICAgICAgICAgb3BhY2l0eTogMVxyXG4gICAgICAgICAgICAgICAgICAgIH0pXHJcbiAgICAgICAgICAgICAgICB9KSk7XHJcbiAgICAgICAgICAgICAgICBjbnQrKztcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgIH0sXHJcblxyXG4gICAgX2dlbkRpc3RhbmNlS20gOiBmdW5jdGlvbih3dywgcmVzb2x1dGlvbixcclxuXHRcdFx0XHRcdFx0XHQgIGNvb3JkcywgZGlzdGFuY2VzLCBzdGFydERpc3RJbmRleCwgZW5kRGlzdEluZGV4LFxyXG5cdFx0XHRcdFx0XHRcdCAgc3R5bGVzKSB7XHJcbiAgICAgICAgLy8gVE9ETyBSdW1lbiAtIHN0aWxsIG5vdCByZWFkeSAtIGZvciBub3cgc3RhdGljIGhvdHNwb3RzIGFyZSB1c2VkXHJcbiAgICAgICAgaWYgKHRydWUpIHtyZXR1cm47fVxyXG5cclxuICAgICAgICB2YXIgaG90c3BvdHNLbSA9IFsyMCwgNDAsIDYwLCA4MCwgMTAwLCAxMjAsIDE0MCwgMTYwLCAxODBdO1xyXG5cclxuICAgICAgICBmdW5jdGlvbiBhZGRIb3RTcG90S00oa20sIHBvaW50KSB7XHJcbiAgICAgICAgICAgIC8vdmFyIGR4ID0gZW5kWzBdIC0gc3RhcnRbMF07XHJcbiAgICAgICAgICAgIC8vdmFyIGR5ID0gZW5kWzFdIC0gc3RhcnRbMV07XHJcbiAgICAgICAgICAgIC8vdmFyIHJvdGF0aW9uID0gTWF0aC5hdGFuMihkeSwgZHgpO1xyXG4gICAgICAgICAgICBzdHlsZXMucHVzaChuZXcgb2wuc3R5bGUuU3R5bGUoe1xyXG4gICAgICAgICAgICAgICAgLy9nZW9tZXRyeTogbmV3IG9sLmdlb20uUG9pbnQoWyhzdGFydFswXStlbmRbMF0pLzIsKHN0YXJ0WzFdK2VuZFsxXSkvMl0pLFxyXG4gICAgICAgICAgICAgICAgZ2VvbWV0cnk6IG5ldyBvbC5nZW9tLlBvaW50KFtwb2ludFswXSwgcG9pbnRbMV1dKSxcclxuICAgICAgICAgICAgICAgIGltYWdlOiBuZXcgb2wuc3R5bGUuSWNvbih7XHJcbiAgICAgICAgICAgICAgICAgICAgc3JjOiBcImltZy9cIiArIGttICsgXCJrbS5zdmdcIixcclxuICAgICAgICAgICAgICAgICAgICBzY2FsZTogMS41LFxyXG4gICAgICAgICAgICAgICAgICAgIHJvdGF0ZVdpdGhWaWV3OiB0cnVlLFxyXG4gICAgICAgICAgICAgICAgICAgIC8vcm90YXRpb246IC1yb3RhdGlvbiArIE1hdGguUEkvMiwgLy8gYWRkIDE4MCBkZWdyZWVzXHJcbiAgICAgICAgICAgICAgICAgICAgb3BhY2l0eSA6IDFcclxuICAgICAgICAgICAgICAgIH0pXHJcbiAgICAgICAgICAgIH0pKTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGZvciAodmFyIGkgPSBzdGFydERpc3RJbmRleDsgaSA8IGVuZERpc3RJbmRleDsgaSsrKSB7XHJcbiAgICAgICAgICAgIGlmICghaG90c3BvdHNLbS5sZW5ndGgpIHtcclxuXHRcdFx0XHRyZXR1cm47XHJcblx0XHRcdH1cclxuXHJcblx0XHRcdHZhciBkaXN0ID0gZGlzdGFuY2VzW2ldO1xyXG5cclxuXHRcdFx0aWYgKGRpc3QgPj0gaG90c3BvdHNLbVswXSoxMDAwKSB7XHJcblx0XHRcdFx0Ly8gZHJhdyB0aGUgZmlyc3QgaG90c3BvdCBhbmQgYW55IG5leHQgaWYgaXQncyBjb250YWluZWQgaW4gdGhlIHNhbWUgXCJkaXN0YW5jZVwiXHJcblx0XHRcdFx0dmFyIHJlbW92ZUhvdHNwb3RLbSA9IDA7XHJcblx0XHRcdFx0Zm9yICh2YXIgayA9IDAsIGxlbkhvdHNwb3RzS20gPSBob3RzcG90c0ttLmxlbmd0aDsgayA8IGxlbkhvdHNwb3RzS207IGsrKykge1xyXG5cdFx0XHRcdFx0aWYgKGRpc3QgPj0gaG90c3BvdHNLbVtrXSoxMDAwKSB7XHJcblx0XHRcdFx0XHRcdGFkZEhvdFNwb3RLTShob3RzcG90c0ttW2tdLCBjb29yZHNbaV0pO1xyXG5cdFx0XHRcdFx0XHRyZW1vdmVIb3RzcG90S20rKztcclxuXHRcdFx0XHRcdH0gZWxzZSB7XHJcblx0XHRcdFx0XHRcdGJyZWFrO1xyXG5cdFx0XHRcdFx0fVxyXG5cdFx0XHRcdH1cclxuXHRcdFx0XHQvLyByZW1vdmUgYWxsIHRoZSBhbHJlYWR5IGRyYXduIGhvdHNwb3RzXHJcblx0XHRcdFx0Zm9yICh2YXIgaiA9IDA7IGogPHJlbW92ZUhvdHNwb3RLbTsgaisrKSBob3RzcG90c0ttLnNoaWZ0KCk7XHJcblx0XHRcdH1cclxuICAgICAgICB9XHJcbiAgICB9XHJcbn07XHJcblxyXG5mb3IgKHZhciBpIGluIFNUWUxFUylcclxuXHRleHBvcnRzW2ldPVNUWUxFU1tpXTtcclxuIiwicmVxdWlyZSgnam9vc2UnKTtcclxucmVxdWlyZSgnLi9QYXJ0aWNpcGFudCcpO1xyXG5cclxudmFyIHJidXNoID0gcmVxdWlyZSgncmJ1c2gnKTtcclxudmFyIENPTkZJRyA9IHJlcXVpcmUoJy4vQ29uZmlnJyk7XHJcbnZhciBXR1M4NFNQSEVSRSA9IHJlcXVpcmUoJy4vVXRpbHMnKS5XR1M4NFNQSEVSRTtcclxuXHJcbkNsYXNzKFwiVHJhY2tcIiwgXHJcbntcdFxyXG4gICAgLy8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdC8vIEFMTCBDT09SRElOQVRFUyBBUkUgSU4gV09STEQgTUVSQ0FUT1JcclxuICAgIC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuICAgIGhhczogXHJcblx0e1xyXG4gICAgICAgIHJvdXRlIDoge1xyXG4gICAgICAgICAgICBpczogICBcInJ3XCJcclxuICAgICAgICB9LFxyXG4gICAgICAgIGRpc3RhbmNlcyA6IHtcclxuICAgICAgICAgICAgaXM6ICAgXCJyd1wiXHJcbiAgICAgICAgfSxcclxuICAgICAgICBkaXN0YW5jZXNFbGFwc2VkIDoge1xyXG4gICAgICAgICAgICBpczogICBcInJ3XCJcclxuICAgICAgICB9LFxyXG5cdFx0dG90YWxMZW5ndGggOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiXHJcblx0XHR9LFxyXG5cdFx0cGFydGljaXBhbnRzIDoge1xyXG5cdFx0XHRpczogICBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiBbXVxyXG5cdFx0fSxcclxuXHRcdGNhbXNDb3VudCA6IHtcclxuXHRcdFx0aXM6ICAgXCJyd1wiLFxyXG5cdFx0XHRpbml0OiAwXHJcblx0XHR9LFxyXG5cdFx0Ly8gaW4gRVBTRyAzODU3XHJcblx0XHRmZWF0dXJlIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IG51bGxcdFx0XHJcblx0XHR9LFxyXG5cdFx0aXNEaXJlY3Rpb25Db25zdHJhaW50IDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IGZhbHNlXHJcblx0XHR9LFxyXG5cdFx0XHJcblx0XHRkZWJ1Z1BhcnRpY2lwYW50IDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IG51bGxcclxuXHRcdH0sXHJcblx0XHRiaWtlU3RhcnRLTSA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiBudWxsXHJcblx0XHR9LFxyXG5cdFx0cnVuU3RhcnRLTSA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiBudWxsXHJcblx0XHR9LFxyXG5cdFx0bGFwcyA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiAxXHJcblx0XHR9LFxyXG5cdFx0dG90YWxQYXJ0aWNpcGFudHMgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogNTBcclxuXHRcdH0sXHJcblx0XHRyVHJlZSA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiByYnVzaCgxMClcclxuXHRcdH0sXHJcblxyXG5cdFx0aXNBZGRlZEhvdFNwb3RTd2ltQmlrZSA6IHtcclxuXHRcdFx0aW5pdCA6IGZhbHNlXHJcblx0XHR9LFxyXG5cdFx0aXNBZGRlZEhvdFNwb3RCaWtlUnVuIDoge1xyXG5cdFx0XHRpbml0IDogZmFsc2VcclxuXHRcdH1cclxuICAgIH0sXHJcbiAgICAvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0bWV0aG9kczogXHJcblx0e1x0XHRcclxuXHRcdHNldFJvdXRlIDogZnVuY3Rpb24odmFsKSB7XHJcblx0XHRcdHRoaXMucm91dGU9dmFsO1xyXG5cdFx0XHRkZWxldGUgdGhpcy5fbGVudG1wMTtcclxuXHRcdFx0ZGVsZXRlIHRoaXMuX2xlbnRtcDI7XHJcblx0XHR9LFxyXG5cdFx0XHJcblx0XHRnZXRCb3VuZGluZ0JveCA6IGZ1bmN0aW9uKCkge1xyXG5cdFx0XHR2YXIgbWlueD1udWxsLG1pbnk9bnVsbCxtYXh4PW51bGwsbWF4eT1udWxsO1xyXG5cdFx0XHRmb3IgKHZhciBpPTA7aTx0aGlzLnJvdXRlLmxlbmd0aDtpKyspXHJcblx0XHRcdHtcclxuXHRcdFx0XHR2YXIgcD10aGlzLnJvdXRlW2ldO1xyXG5cdFx0XHRcdGlmIChtaW54ID09IG51bGwgfHwgcFswXSA8IG1pbngpIG1pbng9cFswXTtcclxuXHRcdFx0XHRpZiAobWF4eCA9PSBudWxsIHx8IHBbMF0gPiBtYXh4KSBtYXh4PXBbMF07XHJcblx0XHRcdFx0aWYgKG1pbnkgPT0gbnVsbCB8fCBwWzFdIDwgbWlueSkgbWlueT1wWzFdO1xyXG5cdFx0XHRcdGlmIChtYXh5ID09IG51bGwgfHwgcFsxXSA+IG1heHkpIG1heHk9cFsxXTtcclxuXHRcdFx0fVxyXG5cdFx0XHRyZXR1cm4gW21pbngsbWlueSxtYXh4LG1heHldO1xyXG5cdFx0fSxcclxuXHRcdFxyXG5cdFx0Ly8gZWxhcHNlZCBmcm9tIDAuLjFcclxuXHRcdGdldFBvc2l0aW9uQW5kUm90YXRpb25Gcm9tRWxhcHNlZCA6IGZ1bmN0aW9uKGVsYXBzZWQpIHtcclxuXHRcdFx0dmFyIHJyPW51bGw7XHJcblx0XHRcdHZhciBjYyA9IHRoaXMucm91dGU7XHJcblx0XHRcdFxyXG5cdFx0XHR2YXIgbGwgPSB0aGlzLmRpc3RhbmNlc0VsYXBzZWQubGVuZ3RoLTE7XHJcblx0XHRcdHZhciBzaSA9IDA7XHJcblxyXG5cdFx0XHQvLyBUT0RPIEZJWCBNRSBcclxuXHRcdFx0d2hpbGUgKHNpIDwgbGwgJiYgc2krNTAwIDwgbGwgJiYgdGhpcy5kaXN0YW5jZXNFbGFwc2VkW3NpKzUwMF0gPCBlbGFwc2VkICkge1xyXG5cdFx0XHRcdHNpKz01MDA7XHJcblx0XHRcdH1cclxuXHRcdFx0XHJcblx0XHRcdHdoaWxlIChzaSA8IGxsICYmIHNpKzI1MCA8IGxsICYmIHRoaXMuZGlzdGFuY2VzRWxhcHNlZFtzaSsyNTBdIDwgZWxhcHNlZCApIHtcclxuXHRcdFx0XHRzaSs9MjUwO1xyXG5cdFx0XHR9XHJcblx0XHRcdFxyXG5cdFx0XHR3aGlsZSAoc2kgPCBsbCAmJiBzaSsxMjUgPCBsbCAmJiB0aGlzLmRpc3RhbmNlc0VsYXBzZWRbc2krMTI1XSA8IGVsYXBzZWQgKSB7XHJcblx0XHRcdFx0c2krPTEyNTtcclxuXHRcdFx0fVxyXG5cclxuXHRcdFx0d2hpbGUgKHNpIDwgbGwgJiYgc2krNTAgPCBsbCAmJiB0aGlzLmRpc3RhbmNlc0VsYXBzZWRbc2krNTBdIDwgZWxhcHNlZCApIHtcclxuXHRcdFx0XHRzaSs9NTA7XHJcblx0XHRcdH1cclxuXHRcdFx0XHJcblx0XHRcdGZvciAodmFyIGk9c2k7aTxsbDtpKyspIFxyXG5cdFx0XHR7XHJcblx0XHRcdFx0LypkbyBcclxuXHRcdFx0XHR7XHJcblx0XHRcdFx0XHR2YXIgbSA9ICgoY2MubGVuZ3RoLTEraSkgPj4gMSk7XHJcblx0XHRcdFx0XHRpZiAobS1pID4gNSAmJiBlbGFwc2VkIDwgdGhpcy5kaXN0YW5jZXNFbGFwc2VkW21dKSB7XHJcblx0XHRcdFx0XHRcdGk9bTtcclxuXHRcdFx0XHRcdFx0Y29udGludWU7XHJcblx0XHRcdFx0XHR9XHJcblx0XHRcdFx0XHRicmVhaztcclxuXHRcdFx0XHR9IHdoaWxlICh0cnVlKTsqL1xyXG5cdFx0XHRcdGlmIChlbGFwc2VkID49IHRoaXMuZGlzdGFuY2VzRWxhcHNlZFtpXSAmJiBlbGFwc2VkIDw9IHRoaXMuZGlzdGFuY2VzRWxhcHNlZFtpKzFdKSBcclxuXHRcdFx0XHR7XHJcblx0XHRcdFx0XHRlbGFwc2VkLT10aGlzLmRpc3RhbmNlc0VsYXBzZWRbaV07XHJcblx0XHRcdFx0XHR2YXIgYWM9dGhpcy5kaXN0YW5jZXNFbGFwc2VkW2krMV0tdGhpcy5kaXN0YW5jZXNFbGFwc2VkW2ldO1xyXG5cdFx0XHRcdFx0dmFyIGEgPSBjY1tpXTtcclxuXHRcdFx0XHRcdHZhciBjID0gY2NbaSsxXTtcclxuXHRcdFx0XHRcdHZhciBkeCA9IGNbMF0gLSBhWzBdO1xyXG5cdFx0XHRcdFx0dmFyIGR5ID0gY1sxXSAtIGFbMV07XHJcblx0XHRcdFx0XHRycj1bIGFbMF0rKGNbMF0tYVswXSkqZWxhcHNlZC9hYyxhWzFdKyhjWzFdLWFbMV0pKmVsYXBzZWQvYWMsTWF0aC5hdGFuMihkeSwgZHgpXTtcclxuXHRcdFx0XHRcdGJyZWFrO1xyXG5cdFx0XHRcdH1cclxuXHRcdFx0fVxyXG5cdFx0XHRyZXR1cm4gcnI7XHJcblx0XHR9LFxyXG5cdFx0XHJcblx0XHRfX2dldFBvc2l0aW9uQW5kUm90YXRpb25Gcm9tRWxhcHNlZCA6IGZ1bmN0aW9uKGVsYXBzZWQpIHtcclxuXHRcdFx0ZWxhcHNlZCo9dGhpcy5nZXRUcmFja0xlbmd0aCgpO1xyXG5cdFx0XHR2YXIgcnI9bnVsbDtcclxuXHRcdFx0dmFyIGNjID0gdGhpcy5yb3V0ZTtcclxuXHRcdFx0Zm9yICh2YXIgaT0wO2k8Y2MubGVuZ3RoLTE7aSsrKSBcclxuXHRcdFx0e1xyXG5cdFx0XHRcdHZhciBhID0gY2NbaV07XHJcblx0XHRcdFx0dmFyIGMgPSBjY1tpKzFdO1xyXG5cdFx0XHRcdHZhciBhYyA9IFdHUzg0U1BIRVJFLmhhdmVyc2luZURpc3RhbmNlKGEsYyk7XHJcblx0XHRcdFx0aWYgKGVsYXBzZWQgPD0gYWMpIHtcclxuXHRcdFx0XHRcdHZhciBkeCA9IGNbMF0gLSBhWzBdO1xyXG5cdFx0XHRcdFx0dmFyIGR5ID0gY1sxXSAtIGFbMV07XHJcblx0XHRcdFx0XHRycj1bIGFbMF0rKGNbMF0tYVswXSkqZWxhcHNlZC9hYyxhWzFdKyhjWzFdLWFbMV0pKmVsYXBzZWQvYWMsTWF0aC5hdGFuMihkeSwgZHgpXTtcclxuXHRcdFx0XHRcdGJyZWFrO1xyXG5cdFx0XHRcdH1cclxuXHRcdFx0XHRlbGFwc2VkLT1hYztcclxuXHRcdFx0fVxyXG5cdFx0XHRyZXR1cm4gcnI7XHJcblx0XHR9LFxyXG5cclxuXHRcdFxyXG5cdFx0Z2V0VHJhY2tMZW5ndGggOiBmdW5jdGlvbigpIHtcclxuXHRcdFx0aWYgKHRoaXMuX2xlbnRtcDEpXHJcblx0XHRcdFx0cmV0dXJuIHRoaXMuX2xlbnRtcDE7XHJcblx0XHRcdHZhciByZXM9MC4wO1xyXG5cdFx0XHR2YXIgY2MgPSB0aGlzLnJvdXRlO1xyXG5cdFx0XHRmb3IgKHZhciBpPTA7aTxjYy5sZW5ndGgtMTtpKyspIFxyXG5cdFx0XHR7XHJcblx0XHRcdFx0dmFyIGEgPSBjY1tpXTtcclxuXHRcdFx0XHR2YXIgYiA9IGNjW2krMV07XHJcblx0XHRcdFx0dmFyIGQgPSBXR1M4NFNQSEVSRS5oYXZlcnNpbmVEaXN0YW5jZShhLGIpO1xyXG5cdFx0XHRcdGlmICghaXNOYU4oZCkgJiYgZCA+IDApIFxyXG5cdFx0XHRcdFx0cmVzKz1kO1xyXG5cdFx0XHR9XHJcblx0XHRcdHRoaXMuX2xlbnRtcDE9cmVzO1xyXG5cdFx0XHRyZXR1cm4gcmVzO1xyXG5cdFx0fSxcclxuXHJcblx0XHRnZXRUcmFja0xlbmd0aEluV0dTODQgOiBmdW5jdGlvbigpIHtcclxuXHRcdFx0aWYgKHRoaXMuX2xlbnRtcDIpXHJcblx0XHRcdFx0cmV0dXJuIHRoaXMuX2xlbnRtcDI7XHJcblx0XHRcdHZhciByZXM9MC4wO1xyXG5cdFx0XHR2YXIgY2MgPSB0aGlzLnJvdXRlO1xyXG5cdFx0XHRmb3IgKHZhciBpPTA7aTxjYy5sZW5ndGgtMTtpKyspIFxyXG5cdFx0XHR7XHJcblx0XHRcdFx0dmFyIGEgPSBjY1tpXTtcclxuXHRcdFx0XHR2YXIgYiA9IGNjW2krMV07XHJcblx0XHRcdFx0dmFyIGQgPSBNYXRoLnNxcnQoKGFbMF0tYlswXSkqKGFbMF0tYlswXSkrKGFbMV0tYlsxXSkqKGFbMV0tYlsxXSkpO1xyXG5cdFx0XHRcdGlmICghaXNOYU4oZCkgJiYgZCA+IDApIFxyXG5cdFx0XHRcdFx0cmVzKz1kO1xyXG5cdFx0XHR9XHJcblx0XHRcdHRoaXMuX2xlbnRtcDI9cmVzO1xyXG5cdFx0XHRyZXR1cm4gcmVzO1xyXG5cdFx0fSxcclxuXHJcblx0XHRnZXRDZW50ZXIgOiBmdW5jdGlvbigpIHtcclxuXHRcdFx0dmFyIGJiID0gdGhpcy5nZXRCb3VuZGluZ0JveCgpO1xyXG5cdFx0XHRyZXR1cm4gWyhiYlswXStiYlsyXSkvMi4wLChiYlsxXStiYlszXSkvMi4wXTtcclxuXHRcdH0sXHJcblx0XHRcclxuXHRcdGluaXQgOiBmdW5jdGlvbigpIFxyXG5cdFx0e1xyXG5cdFx0XHRpZiAoIXRoaXMucm91dGUpXHJcblx0XHRcdFx0cmV0dXJuO1xyXG5cdFx0XHQvLyAxKSBjYWxjdWxhdGUgdG90YWwgcm91dGUgbGVuZ3RoIGluIEtNIFxyXG5cdFx0XHR0aGlzLnVwZGF0ZUZlYXR1cmUoKTtcclxuXHRcdFx0aWYgKHR5cGVvZiB3aW5kb3cgIT0gXCJ1bmRlZmluZWRcIikgXHJcblx0XHRcdHtcclxuXHRcdFx0XHRpZiAoIUdVSS5nZXRJc1NraXBFeHRlbnQgfHwgIUdVSS5nZXRJc1NraXBFeHRlbnQoKSkge1xyXG5cdFx0XHRcdFx0aWYgKHRoaXMuZmVhdHVyZSkge1xyXG5cdFx0XHRcdFx0XHRHVUkubWFwLmdldFZpZXcoKS5maXRFeHRlbnQodGhpcy5mZWF0dXJlLmdldEdlb21ldHJ5KCkuZ2V0RXh0ZW50KCksIEdVSS5tYXAuZ2V0U2l6ZSgpKTtcclxuXHRcdFx0XHRcdFx0Y29uc29sZS5sb2coXCJDdXJyZW50IGV4dGVudCA6IFwiICsgSlNPTi5zdHJpbmdpZnkodGhpcy5mZWF0dXJlLmdldEdlb21ldHJ5KCkuZ2V0RXh0ZW50KCkpKTtcclxuXHRcdFx0XHRcdH0gZWxzZSB7XHJcblx0XHRcdFx0XHRcdEdVSS5tYXAuZ2V0VmlldygpLmZpdEV4dGVudChbMTIzNDU5Mi4zNjM3MzQ1NTY4LCA2MjgyNzA2Ljg4OTY3NjQzNSwgMTI2NDM0OC40NjQzNzM3NjYsIDYzMjU2OTQuNzQzMTY0NzI1XSwgR1VJLm1hcC5nZXRTaXplKCkpO1xyXG5cdFx0XHRcdFx0fVxyXG5cdFx0XHRcdH1cclxuXHRcdFx0fVxyXG5cdFx0fSxcclxuXHRcdFxyXG5cdFx0Z2V0VHJhY2tQYXJ0IDogZnVuY3Rpb24oZWxhcHNlZCkge1xyXG5cdFx0XHR2YXIgbGVuID0gdGhpcy5nZXRUcmFja0xlbmd0aCgpO1xyXG5cdFx0XHR2YXIgZW0gPSAoZWxhcHNlZCUxLjApKmxlbjtcclxuXHRcdFx0aWYgKGVtID49IHRoaXMucnVuU3RhcnRLTSoxMDAwKSBcclxuXHRcdFx0XHRyZXR1cm4gMjtcclxuXHRcdFx0aWYgKGVtID49IHRoaXMuYmlrZVN0YXJ0S00qMTAwMCkgXHJcblx0XHRcdFx0cmV0dXJuIDE7XHJcblx0XHRcdHJldHVybiAwO1xyXG5cdFx0fSxcclxuXHRcdFxyXG5cdFx0dXBkYXRlRmVhdHVyZSA6IGZ1bmN0aW9uKCkgXHJcblx0XHR7XHJcblx0XHRcdHRoaXMuZGlzdGFuY2VzPVtdO1xyXG5cdFx0XHR2YXIgcmVzPTAuMDtcclxuXHRcdFx0dmFyIGNjID0gdGhpcy5yb3V0ZTtcclxuXHRcdFx0Zm9yICh2YXIgaT0wO2k8Y2MubGVuZ3RoLTE7aSsrKSBcclxuXHRcdFx0e1xyXG5cdFx0XHRcdHZhciBhID0gY2NbaV07XHJcblx0XHRcdFx0dmFyIGIgPSBjY1tpKzFdO1xyXG5cdFx0XHRcdHZhciBkID0gV0dTODRTUEhFUkUuaGF2ZXJzaW5lRGlzdGFuY2UoYSxiKTtcclxuXHRcdFx0XHR0aGlzLmRpc3RhbmNlcy5wdXNoKHJlcyk7XHJcblx0XHRcdFx0aWYgKCFpc05hTihkKSAmJiBkID4gMCkgXHJcblx0XHRcdFx0XHRyZXMrPWQ7XHJcblx0XHRcdH1cclxuXHRcdFx0dGhpcy5kaXN0YW5jZXMucHVzaChyZXMpO1xyXG5cdFx0XHR0aGlzLmRpc3RhbmNlc0VsYXBzZWQ9W107XHJcblx0XHRcdHZhciB0bCA9IHRoaXMuZ2V0VHJhY2tMZW5ndGgoKTtcclxuXHRcdFx0Zm9yICh2YXIgaT0wO2k8Y2MubGVuZ3RoO2krKykge1xyXG5cdFx0XHRcdHRoaXMuZGlzdGFuY2VzRWxhcHNlZC5wdXNoKHRoaXMuZGlzdGFuY2VzW2ldL3RsKTtcclxuXHRcdFx0fVxyXG5cdFx0XHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0XHRcdHRoaXMuclRyZWUuY2xlYXIoKTtcclxuXHRcdFx0dmFyIGFyciA9IFtdO1xyXG5cdFx0XHRmb3IgKHZhciBpPTA7aTx0aGlzLnJvdXRlLmxlbmd0aC0xO2krKykgXHJcblx0XHRcdHtcclxuXHRcdFx0XHR2YXIgeDEgPSB0aGlzLnJvdXRlW2ldWzBdO1xyXG5cdFx0XHRcdHZhciB5MSA9IHRoaXMucm91dGVbaV1bMV07XHJcblx0XHRcdFx0dmFyIHgyID0gdGhpcy5yb3V0ZVtpKzFdWzBdO1xyXG5cdFx0XHRcdHZhciB5MiA9IHRoaXMucm91dGVbaSsxXVsxXTtcclxuXHRcdFx0XHR2YXIgbWlueCA9IHgxIDwgeDIgPyB4MSA6IHgyO1xyXG5cdFx0XHRcdHZhciBtaW55ID0geTEgPCB5MiA/IHkxIDogeTI7XHJcblx0XHRcdFx0dmFyIG1heHggPSB4MSA+IHgyID8geDEgOiB4MjtcclxuXHRcdFx0XHR2YXIgbWF4eSA9IHkxID4geTIgPyB5MSA6IHkyO1xyXG5cdFx0XHRcdGFyci5wdXNoKFttaW54LG1pbnksbWF4eCxtYXh5LHsgaW5kZXggOiBpIH1dKTtcclxuXHRcdFx0fVxyXG5cdFx0XHR0aGlzLnJUcmVlLmxvYWQoYXJyKTtcclxuXHRcdFx0Ly8tLS0tLS0tLS0tLS0tLS0tLSAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRcdFx0aWYgKHR5cGVvZiB3aW5kb3cgIT0gXCJ1bmRlZmluZWRcIiAmJiB0aGlzLnJvdXRlICYmIHRoaXMucm91dGUubGVuZ3RoKSBcclxuXHRcdFx0e1xyXG5cdFx0XHRcdHZhciB3a3QgPSBbXTtcclxuXHRcdFx0XHRmb3IgKHZhciBpPTA7aTx0aGlzLnJvdXRlLmxlbmd0aDtpKyspIHtcclxuXHRcdFx0XHRcdHdrdC5wdXNoKHRoaXMucm91dGVbaV1bMF0rXCIgXCIrdGhpcy5yb3V0ZVtpXVsxXSk7XHJcblx0XHRcdFx0fVxyXG5cdFx0XHRcdHdrdD1cIkxJTkVTVFJJTkcoXCIrd2t0LmpvaW4oXCIsXCIpK1wiKVwiO1xyXG5cdFx0XHRcdHZhciBmb3JtYXQgPSBuZXcgb2wuZm9ybWF0LldLVCgpO1xyXG5cdFx0XHRcdGlmICghdGhpcy5mZWF0dXJlKSB7XHJcblx0XHRcdFx0XHR0aGlzLmZlYXR1cmUgPSBmb3JtYXQucmVhZEZlYXR1cmUod2t0KTtcclxuXHRcdFx0XHR9IGVsc2Uge1xyXG5cdFx0XHRcdFx0dGhpcy5mZWF0dXJlLnNldEdlb21ldHJ5KGZvcm1hdC5yZWFkRmVhdHVyZSh3a3QpLmdldEdlb21ldHJ5KCkpO1xyXG5cdFx0XHRcdH1cclxuXHRcdFx0XHR0aGlzLmZlYXR1cmUudHJhY2s9dGhpcztcclxuXHRcdFx0XHR0aGlzLmZlYXR1cmUuZ2V0R2VvbWV0cnkoKS50cmFuc2Zvcm0oJ0VQU0c6NDMyNicsICdFUFNHOjM4NTcnKTtcdFx0XHRcdFx0XHRcclxuXHRcdFx0XHQvL2NvbnNvbGUubG9nKFwiRkVBVFVSRSBUUkFDSyA6IFwiK3RoaXMuZmVhdHVyZS50cmFjayk7XHJcblx0XHRcdH0gZWxzZSB7XHJcblx0XHRcdFx0ZGVsZXRlIHRoaXMuZmVhdHVyZTtcclxuXHRcdFx0fVxyXG5cdFx0fSxcclxuXHJcblx0XHRnZXRSZWFsUGFydGljaXBhbnRzQ291bnQgOiBmdW5jdGlvbigpIHtcclxuXHRcdFx0cmV0dXJuIHRoaXMucGFydGljaXBhbnRzLmxlbmd0aCAtIHRoaXMuY2Ftc0NvdW50O1xyXG5cdFx0fSxcclxuXHJcblx0XHRnZXRQYXJ0aWNpcGFudEJ5SWQgOiBmdW5jdGlvbihpZCkge1xyXG5cdFx0XHQvLyBUT0RPIFJ1bWVuIC0gaXQgd291bGQgYmUgZ29vZCB0byBob2xkIGEgbWFwIG9mIHRoZSB0eXBlIGlkIC0+IFBhcnRpY2lwYW50XHJcblx0XHRcdGlmICh0aGlzLnBhcnRpY2lwYW50cykge1xyXG5cdFx0XHRcdGZvciAodmFyIGkgPSAwLCBsZW4gPSB0aGlzLnBhcnRpY2lwYW50cy5sZW5ndGg7IGkgPCBsZW47IGkrKykge1xyXG5cdFx0XHRcdFx0IGlmICh0aGlzLnBhcnRpY2lwYW50c1tpXS5pZCA9PT0gaWQpIHtcclxuXHRcdFx0XHRcdFx0IHJldHVybiB0aGlzLnBhcnRpY2lwYW50c1tpXTtcclxuXHRcdFx0XHRcdCB9XHJcblx0XHRcdFx0fVxyXG5cdFx0XHR9XHJcblx0XHRcdHJldHVybiBudWxsO1xyXG5cdFx0fSxcclxuXHRcdFxyXG5cdFx0bmV3UGFydGljaXBhbnQgOiBmdW5jdGlvbihpZCxkZXZpY2VJZCxuYW1lKVxyXG5cdFx0e1xyXG5cdFx0XHR2YXIgcGFydCA9IG5ldyBQYXJ0aWNpcGFudCh7aWQ6aWQsZGV2aWNlSWQ6ZGV2aWNlSWQsY29kZTpuYW1lfSk7XHJcblx0XHRcdHBhcnQuaW5pdCh0aGlzLnJvdXRlWzBdLHRoaXMpO1xyXG5cdFx0XHRwYXJ0LnNldFNlcUlkKHRoaXMucGFydGljaXBhbnRzLmxlbmd0aCk7XHJcblx0XHRcdHRoaXMucGFydGljaXBhbnRzLnB1c2gocGFydCk7XHJcblx0XHRcdHJldHVybiBwYXJ0O1xyXG5cdFx0fSxcclxuXHJcblx0XHRuZXdNb3ZpbmdDYW0gOiBmdW5jdGlvbihpZCxkZXZpY2VJZCxuYW1lKVxyXG5cdFx0e1xyXG5cdFx0XHR2YXIgY2FtID0gbmV3IE1vdmluZ0NhbSh7aWQ6aWQsZGV2aWNlSWQ6ZGV2aWNlSWQsY29kZTpuYW1lfSk7XHJcblx0XHRcdGNhbS5pbml0KHRoaXMucm91dGVbMF0sdGhpcyk7XHJcblx0XHRcdGNhbS5zZXRTZXFJZCh0aGlzLmNhbXNDb3VudCk7XHJcblx0XHRcdHRoaXMuY2Ftc0NvdW50Kys7XHJcblx0XHRcdGNhbS5fX3NraXBUcmFja2luZ1Bvcz10cnVlO1xyXG5cdFx0XHR0aGlzLnBhcnRpY2lwYW50cy5wdXNoKGNhbSk7XHJcblx0XHRcdHJldHVybiBjYW07XHJcblx0XHR9LFxyXG5cclxuXHRcdG5ld0hvdFNwb3RzIDogZnVuY3Rpb24oaG90c3BvdHMpIHtcclxuXHRcdFx0aWYgKCFob3RzcG90cyB8fCAhaG90c3BvdHMubGVuZ3RoKSB7XHJcblx0XHRcdFx0cmV0dXJuO1xyXG5cdFx0XHR9XHJcblxyXG5cdFx0XHQvLyBUT0RPIFJ1bWVuIC0gdGhpcyBpcyBDT1BZLVBBU1RFIGNvZGUgZm9ybSB0aGUgU3R5bGVzXHJcblx0XHRcdC8vIHNvIGxhdGVyIGl0IGhhcyB0byBiZSBpbiBvbmx5IG9uZSBwbGFjZSAtIGdldHRpbmcgdGhlIGdlb21ldHJpZXMgZm9yIGVhY2ggdHlwZSBkaXN0YW5jZVxyXG5cdFx0XHQvLyBtYXliZSBpbiB0aGUgc2FtZSBwbGFjZSBkaXN0YW5jZXMgYXJlIGNhbGN1bGF0ZWQuXHJcblx0XHRcdC8vIFRISVMgSVMgVEVNUE9SQVJZIFBBVENIIHRvIGdldCB0aGUgbmVlZGVkIHBvaW50c1xyXG5cdFx0XHRpZiAoIWlzTmFOKHRoaXMuYmlrZVN0YXJ0S00pKSB7XHJcblx0XHRcdFx0Zm9yICh2YXIgaT0wO2k8dGhpcy5kaXN0YW5jZXMubGVuZ3RoO2krKykge1xyXG5cdFx0XHRcdFx0aWYgKHRoaXMuZGlzdGFuY2VzW2ldID49IHRoaXMuYmlrZVN0YXJ0S00qMTAwMClcclxuXHRcdFx0XHRcdFx0YnJlYWs7XHJcblx0XHRcdFx0fVxyXG5cdFx0XHRcdHZhciBqO1xyXG5cdFx0XHRcdGlmICghaXNOYU4odGhpcy5ydW5TdGFydEtNKSkge1xyXG5cdFx0XHRcdFx0Zm9yIChqPWk7ajx0aGlzLmRpc3RhbmNlcy5sZW5ndGg7aisrKSB7XHJcblx0XHRcdFx0XHRcdGlmICh0aGlzLmRpc3RhbmNlc1tqXSA+PSB0aGlzLnJ1blN0YXJ0S00qMTAwMClcclxuXHRcdFx0XHRcdFx0XHRicmVhaztcclxuXHRcdFx0XHRcdH1cclxuXHRcdFx0XHR9IGVsc2Uge1xyXG5cdFx0XHRcdFx0aj10aGlzLmRpc3RhbmNlcy5sZW5ndGg7XHJcblx0XHRcdFx0fVxyXG5cdFx0XHRcdHZhciBjb29yZHM9dGhpcy5mZWF0dXJlLmdldEdlb21ldHJ5KCkuZ2V0Q29vcmRpbmF0ZXMoKTtcclxuXHRcdFx0XHR2YXIgZ2VvbXN3aW09Y29vcmRzLnNsaWNlKDAsaSk7XHJcblx0XHRcdFx0dmFyIGdlb21iaWtlPWNvb3Jkcy5zbGljZShpIDwgMSA/IGkgOiBpLTEsaik7XHJcblx0XHRcdFx0aWYgKGogPCB0aGlzLmRpc3RhbmNlcy5sZW5ndGgpXHJcblx0XHRcdFx0XHR2YXIgZ2VvbXJ1bj1jb29yZHMuc2xpY2UoaiA8IDEgPyBqIDogai0xLHRoaXMuZGlzdGFuY2VzLmxlbmd0aCk7XHJcblx0XHRcdFx0aWYgKCFnZW9tc3dpbS5sZW5ndGgpXHJcblx0XHRcdFx0XHRnZW9tc3dpbT1udWxsO1xyXG5cdFx0XHRcdGlmICghZ2VvbWJpa2UubGVuZ3RoKVxyXG5cdFx0XHRcdFx0Z2VvbWJpa2U9bnVsbDtcclxuXHRcdFx0XHRpZiAoIWdlb21ydW4ubGVuZ3RoKVxyXG5cdFx0XHRcdFx0Z2VvbXJ1bj1udWxsO1xyXG5cdFx0XHR9XHJcblxyXG5cdFx0XHRmb3IgKHZhciBpID0gMCwgbGVuID0gaG90c3BvdHMubGVuZ3RoOyBpIDwgbGVuOyBpKyspIHtcclxuXHRcdFx0XHR2YXIgaG90c3BvdCA9IGhvdHNwb3RzW2ldO1xyXG5cdFx0XHRcdHZhciBwb2ludDtcclxuXHRcdFx0XHRpZiAoaG90c3BvdC50eXBlID09PSBDT05GSUcuaG90c3BvdC5jYW1Td2ltQmlrZSkge1xyXG5cdFx0XHRcdFx0aWYgKHRoaXMuaXNBZGRlZEhvdFNwb3RTd2ltQmlrZSkgY29udGludWU7IC8vIG5vdCBhbGxvd2VkIHRvIGFkZCB0byBzYW1lIGhvdHNwb3RzXHJcblx0XHRcdFx0XHRpZiAoZ2VvbWJpa2UpIHtcclxuXHRcdFx0XHRcdFx0cG9pbnQgPSBvbC5wcm9qLnRyYW5zZm9ybShnZW9tYmlrZVswXSwgJ0VQU0c6Mzg1NycsICdFUFNHOjQzMjYnKTtcclxuXHRcdFx0XHRcdFx0dGhpcy5pc0FkZGVkSG90U3BvdFN3aW1CaWtlID0gdHJ1ZTtcclxuXHRcdFx0XHRcdH1cclxuXHRcdFx0XHR9IGVsc2UgaWYgKGhvdHNwb3QudHlwZSA9PT0gQ09ORklHLmhvdHNwb3QuY2FtQmlrZVJ1bikge1xyXG5cdFx0XHRcdFx0aWYgKHRoaXMuaXNBZGRlZEhvdFNwb3RCaWtlUnVuKSBjb250aW51ZTsgLy8gbm90IGFsbG93ZWQgdG8gYWRkIHRvIHNhbWUgaG90c3BvdHNcclxuXHRcdFx0XHRcdGlmIChnZW9tcnVuKSB7XHJcblx0XHRcdFx0XHRcdHBvaW50ID0gb2wucHJvai50cmFuc2Zvcm0oZ2VvbXJ1blswXSwgJ0VQU0c6Mzg1NycsICdFUFNHOjQzMjYnKTtcclxuXHRcdFx0XHRcdFx0dGhpcy5pc0FkZGVkSG90U3BvdEJpa2VSdW4gPSB0cnVlO1xyXG5cdFx0XHRcdFx0fVxyXG5cdFx0XHRcdH1cclxuXHRcdFx0XHRpZiAocG9pbnQpXHJcblx0XHRcdFx0XHRob3RzcG90LmluaXQocG9pbnQpO1xyXG5cdFx0XHR9XHJcblx0XHR9LFxyXG5cdFx0XHJcblx0XHRvbk1hcENsaWNrIDogZnVuY3Rpb24oZXZlbnQpIFxyXG5cdFx0e1xyXG5cdFx0XHRpZiAodGhpcy5kZWJ1Z1BhcnRpY2lwYW50KSBcclxuXHRcdFx0e1xyXG5cdFx0XHRcdHRoaXMuZGVidWdQYXJ0aWNpcGFudC5vbkRlYnVnQ2xpY2soZXZlbnQpO1xyXG5cdFx0XHR9XHJcblx0XHR9LFxyXG5cdFx0XHJcblx0XHR0ZXN0MSA6IGZ1bmN0aW9uKCkge1xyXG5cdFx0XHQvKmNvbnNvbGUubG9nKFwiI0JFR0lOTk5OTk5OTk5OTk5OTk5OTk5OTk5OTk5OTk5OTk5OTk5OTk5OXCIpXHJcblx0XHRcdGZvciAodmFyIGk9MDtpPDMwO2krKykgXHJcblx0XHRcdHtcclxuXHRcdFx0XHR2YXIgZWxhcHNlZCA9IGkvNjAuMDsgIC8vKCh0bSAtIHN0aW1lKS8xMDAwLjApL3RyYWNrSW5TZWNvbmRzICsgQ29uZmlnLnNpbXVsYXRpb24uc3RhcnRFbGFwc2VkO1xyXG5cdFx0XHRcdGlmIChlbGFwc2VkID4gMSlcclxuXHRcdFx0XHRcdGVsYXBzZWQ9MTtcclxuXHRcdFx0XHQvL3ZhciBwb3MgPSB0cmFjay5nZXRQb3NpdGlvbkFuZFJvdGF0aW9uRnJvbUVsYXBzZWQoZWxhcHNlZCk7XHJcblx0XHRcdFx0dmFyIHBvcyA9IHRoaXMuX19nZXRQb3NpdGlvbkFuZFJvdGF0aW9uRnJvbUVsYXBzZWQoZWxhcHNlZCk7XHJcblx0XHRcdFx0Y29uc29sZS5sb2coW01hdGgucm91bmQocG9zWzBdKjEwMDAwMDAuMCkvMTAwMDAwMC4wLE1hdGgucm91bmQocG9zWzFdKjEwMDAwMDAuMCkvMTAwMDAwMC4wXSk7XHJcblx0XHRcdH1cclxuXHRcdFx0Y29uc29sZS5sb2coXCIjRU5EXCIpOyovXHJcblx0XHR9XHJcblxyXG4gICAgfVxyXG59KTsiLCJ2YXIgdG9SYWRpYW5zID0gZnVuY3Rpb24oYW5nbGVEZWdyZWVzKSB7IHJldHVybiBhbmdsZURlZ3JlZXMgKiBNYXRoLlBJIC8gMTgwOyB9O1xyXG52YXIgdG9EZWdyZWVzID0gZnVuY3Rpb24oYW5nbGVSYWRpYW5zKSB7IHJldHVybiBhbmdsZVJhZGlhbnMgKiAxODAgLyBNYXRoLlBJOyB9O1xyXG5cclxudmFyIFdHUzg0U3BoZXJlID0gZnVuY3Rpb24ocmFkaXVzKSB7XHJcbiAgdGhpcy5yYWRpdXMgPSByYWRpdXM7XHJcbn07XHJcblxyXG5XR1M4NFNwaGVyZS5wcm90b3R5cGUuY29zaW5lRGlzdGFuY2UgPSBmdW5jdGlvbihjMSwgYzIpIHtcclxuICB2YXIgbGF0MSA9IHRvUmFkaWFucyhjMVsxXSk7XHJcbiAgdmFyIGxhdDIgPSB0b1JhZGlhbnMoYzJbMV0pO1xyXG4gIHZhciBkZWx0YUxvbiA9IHRvUmFkaWFucyhjMlswXSAtIGMxWzBdKTtcclxuICByZXR1cm4gdGhpcy5yYWRpdXMgKiBNYXRoLmFjb3MoXHJcbiAgICAgIE1hdGguc2luKGxhdDEpICogTWF0aC5zaW4obGF0MikgK1xyXG4gICAgICBNYXRoLmNvcyhsYXQxKSAqIE1hdGguY29zKGxhdDIpICogTWF0aC5jb3MoZGVsdGFMb24pKTtcclxufTtcclxuXHJcbldHUzg0U3BoZXJlLnByb3RvdHlwZS5nZW9kZXNpY0FyZWEgPSBmdW5jdGlvbihjb29yZGluYXRlcykge1xyXG4gIHZhciBhcmVhID0gMCwgbGVuID0gY29vcmRpbmF0ZXMubGVuZ3RoO1xyXG4gIHZhciB4MSA9IGNvb3JkaW5hdGVzW2xlbiAtIDFdWzBdO1xyXG4gIHZhciB5MSA9IGNvb3JkaW5hdGVzW2xlbiAtIDFdWzFdO1xyXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuOyBpKyspIHtcclxuICAgIHZhciB4MiA9IGNvb3JkaW5hdGVzW2ldWzBdLCB5MiA9IGNvb3JkaW5hdGVzW2ldWzFdO1xyXG4gICAgYXJlYSArPSB0b1JhZGlhbnMoeDIgLSB4MSkgKlxyXG4gICAgICAgICgyICsgTWF0aC5zaW4odG9SYWRpYW5zKHkxKSkgK1xyXG4gICAgICAgIE1hdGguc2luKHRvUmFkaWFucyh5MikpKTtcclxuICAgIHgxID0geDI7XHJcbiAgICB5MSA9IHkyO1xyXG4gIH1cclxuICByZXR1cm4gYXJlYSAqIHRoaXMucmFkaXVzICogdGhpcy5yYWRpdXMgLyAyLjA7XHJcbn07XHJcblxyXG5XR1M4NFNwaGVyZS5wcm90b3R5cGUuY3Jvc3NUcmFja0Rpc3RhbmNlID0gZnVuY3Rpb24oYzEsIGMyLCBjMykge1xyXG4gIHZhciBkMTMgPSB0aGlzLmNvc2luZURpc3RhbmNlKGMxLCBjMik7XHJcbiAgdmFyIHRoZXRhMTIgPSB0b1JhZGlhbnModGhpcy5pbml0aWFsQmVhcmluZyhjMSwgYzIpKTtcclxuICB2YXIgdGhldGExMyA9IHRvUmFkaWFucyh0aGlzLmluaXRpYWxCZWFyaW5nKGMxLCBjMykpO1xyXG4gIHJldHVybiB0aGlzLnJhZGl1cyAqXHJcbiAgICAgIE1hdGguYXNpbihNYXRoLnNpbihkMTMgLyB0aGlzLnJhZGl1cykgKiBNYXRoLnNpbih0aGV0YTEzIC0gdGhldGExMikpO1xyXG59O1xyXG5cclxuV0dTODRTcGhlcmUucHJvdG90eXBlLmVxdWlyZWN0YW5ndWxhckRpc3RhbmNlID0gZnVuY3Rpb24oYzEsIGMyKSB7XHJcbiAgdmFyIGxhdDEgPSB0b1JhZGlhbnMoYzFbMV0pO1xyXG4gIHZhciBsYXQyID0gdG9SYWRpYW5zKGMyWzFdKTtcclxuICB2YXIgZGVsdGFMb24gPSB0b1JhZGlhbnMoYzJbMF0gLSBjMVswXSk7XHJcbiAgdmFyIHggPSBkZWx0YUxvbiAqIE1hdGguY29zKChsYXQxICsgbGF0MikgLyAyKTtcclxuICB2YXIgeSA9IGxhdDIgLSBsYXQxO1xyXG4gIHJldHVybiB0aGlzLnJhZGl1cyAqIE1hdGguc3FydCh4ICogeCArIHkgKiB5KTtcclxufTtcclxuXHJcbldHUzg0U3BoZXJlLnByb3RvdHlwZS5maW5hbEJlYXJpbmcgPSBmdW5jdGlvbihjMSwgYzIpIHtcclxuICByZXR1cm4gKHRoaXMuaW5pdGlhbEJlYXJpbmcoYzIsIGMxKSArIDE4MCkgJSAzNjA7XHJcbn07XHJcblxyXG5XR1M4NFNwaGVyZS5wcm90b3R5cGUuaGF2ZXJzaW5lRGlzdGFuY2UgPSBmdW5jdGlvbihjMSwgYzIpIHtcclxuICB2YXIgbGF0MSA9IHRvUmFkaWFucyhjMVsxXSk7XHJcbiAgdmFyIGxhdDIgPSB0b1JhZGlhbnMoYzJbMV0pO1xyXG4gIHZhciBkZWx0YUxhdEJ5MiA9IChsYXQyIC0gbGF0MSkgLyAyO1xyXG4gIHZhciBkZWx0YUxvbkJ5MiA9IHRvUmFkaWFucyhjMlswXSAtIGMxWzBdKSAvIDI7XHJcbiAgdmFyIGEgPSBNYXRoLnNpbihkZWx0YUxhdEJ5MikgKiBNYXRoLnNpbihkZWx0YUxhdEJ5MikgK1xyXG4gICAgICBNYXRoLnNpbihkZWx0YUxvbkJ5MikgKiBNYXRoLnNpbihkZWx0YUxvbkJ5MikgKlxyXG4gICAgICBNYXRoLmNvcyhsYXQxKSAqIE1hdGguY29zKGxhdDIpO1xyXG4gIHJldHVybiAyICogdGhpcy5yYWRpdXMgKiBNYXRoLmF0YW4yKE1hdGguc3FydChhKSwgTWF0aC5zcXJ0KDEgLSBhKSk7XHJcbn07XHJcblxyXG5XR1M4NFNwaGVyZS5wcm90b3R5cGUuaW50ZXJwb2xhdGUgPSBmdW5jdGlvbihjMSwgYzIsIGZyYWN0aW9uKSB7XHJcbiAgdmFyIGxhdDEgPSB0b1JhZGlhbnMoYzFbMV0pO1xyXG4gIHZhciBsb24xID0gdG9SYWRpYW5zKGMxWzBdKTtcclxuICB2YXIgbGF0MiA9IHRvUmFkaWFucyhjMlsxXSk7XHJcbiAgdmFyIGxvbjIgPSB0b1JhZGlhbnMoYzJbMF0pO1xyXG4gIHZhciBjb3NMYXQxID0gTWF0aC5jb3MobGF0MSk7XHJcbiAgdmFyIHNpbkxhdDEgPSBNYXRoLnNpbihsYXQxKTtcclxuICB2YXIgY29zTGF0MiA9IE1hdGguY29zKGxhdDIpO1xyXG4gIHZhciBzaW5MYXQyID0gTWF0aC5zaW4obGF0Mik7XHJcbiAgdmFyIGNvc0RlbHRhTG9uID0gTWF0aC5jb3MobG9uMiAtIGxvbjEpO1xyXG4gIHZhciBkID0gc2luTGF0MSAqIHNpbkxhdDIgKyBjb3NMYXQxICogY29zTGF0MiAqIGNvc0RlbHRhTG9uO1xyXG4gIGlmICgxIDw9IGQpIHtcclxuICAgIHJldHVybiBjMi5zbGljZSgpO1xyXG4gIH1cclxuICBkID0gZnJhY3Rpb24gKiBNYXRoLmFjb3MoZCk7XHJcbiAgdmFyIGNvc0QgPSBNYXRoLmNvcyhkKTtcclxuICB2YXIgc2luRCA9IE1hdGguc2luKGQpO1xyXG4gIHZhciB5ID0gTWF0aC5zaW4obG9uMiAtIGxvbjEpICogY29zTGF0MjtcclxuICB2YXIgeCA9IGNvc0xhdDEgKiBzaW5MYXQyIC0gc2luTGF0MSAqIGNvc0xhdDIgKiBjb3NEZWx0YUxvbjtcclxuICB2YXIgdGhldGEgPSBNYXRoLmF0YW4yKHksIHgpO1xyXG4gIHZhciBsYXQgPSBNYXRoLmFzaW4oc2luTGF0MSAqIGNvc0QgKyBjb3NMYXQxICogc2luRCAqIE1hdGguY29zKHRoZXRhKSk7XHJcbiAgdmFyIGxvbiA9IGxvbjEgKyBNYXRoLmF0YW4yKE1hdGguc2luKHRoZXRhKSAqIHNpbkQgKiBjb3NMYXQxLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb3NEIC0gc2luTGF0MSAqIE1hdGguc2luKGxhdCkpO1xyXG4gIHJldHVybiBbdG9EZWdyZWVzKGxvbiksIHRvRGVncmVlcyhsYXQpXTtcclxufTtcclxuXHJcbldHUzg0U3BoZXJlLnByb3RvdHlwZS5pbml0aWFsQmVhcmluZyA9IGZ1bmN0aW9uKGMxLCBjMikge1xyXG4gIHZhciBsYXQxID0gdG9SYWRpYW5zKGMxWzFdKTtcclxuICB2YXIgbGF0MiA9IHRvUmFkaWFucyhjMlsxXSk7XHJcbiAgdmFyIGRlbHRhTG9uID0gdG9SYWRpYW5zKGMyWzBdIC0gYzFbMF0pO1xyXG4gIHZhciB5ID0gTWF0aC5zaW4oZGVsdGFMb24pICogTWF0aC5jb3MobGF0Mik7XHJcbiAgdmFyIHggPSBNYXRoLmNvcyhsYXQxKSAqIE1hdGguc2luKGxhdDIpIC1cclxuICAgICAgTWF0aC5zaW4obGF0MSkgKiBNYXRoLmNvcyhsYXQyKSAqIE1hdGguY29zKGRlbHRhTG9uKTtcclxuICByZXR1cm4gdG9EZWdyZWVzKE1hdGguYXRhbjIoeSwgeCkpO1xyXG59O1xyXG5cclxuV0dTODRTcGhlcmUucHJvdG90eXBlLm1heGltdW1MYXRpdHVkZSA9IGZ1bmN0aW9uKGJlYXJpbmcsIGxhdGl0dWRlKSB7XHJcbiAgcmV0dXJuIE1hdGguY29zKE1hdGguYWJzKE1hdGguc2luKHRvUmFkaWFucyhiZWFyaW5nKSkgKlxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICBNYXRoLmNvcyh0b1JhZGlhbnMobGF0aXR1ZGUpKSkpO1xyXG59O1xyXG5cclxuV0dTODRTcGhlcmUucHJvdG90eXBlLm1pZHBvaW50ID0gZnVuY3Rpb24oYzEsIGMyKSB7XHJcbiAgdmFyIGxhdDEgPSB0b1JhZGlhbnMoYzFbMV0pO1xyXG4gIHZhciBsYXQyID0gdG9SYWRpYW5zKGMyWzFdKTtcclxuICB2YXIgbG9uMSA9IHRvUmFkaWFucyhjMVswXSk7XHJcbiAgdmFyIGRlbHRhTG9uID0gdG9SYWRpYW5zKGMyWzBdIC0gYzFbMF0pO1xyXG4gIHZhciBCeCA9IE1hdGguY29zKGxhdDIpICogTWF0aC5jb3MoZGVsdGFMb24pO1xyXG4gIHZhciBCeSA9IE1hdGguY29zKGxhdDIpICogTWF0aC5zaW4oZGVsdGFMb24pO1xyXG4gIHZhciBjb3NMYXQxUGx1c0J4ID0gTWF0aC5jb3MobGF0MSkgKyBCeDtcclxuICB2YXIgbGF0ID0gTWF0aC5hdGFuMihNYXRoLnNpbihsYXQxKSArIE1hdGguc2luKGxhdDIpLFxyXG4gICAgICAgICAgICAgICAgICAgICAgIE1hdGguc3FydChjb3NMYXQxUGx1c0J4ICogY29zTGF0MVBsdXNCeCArIEJ5ICogQnkpKTtcclxuICB2YXIgbG9uID0gbG9uMSArIE1hdGguYXRhbjIoQnksIGNvc0xhdDFQbHVzQngpO1xyXG4gIHJldHVybiBbdG9EZWdyZWVzKGxvbiksIHRvRGVncmVlcyhsYXQpXTtcclxufTtcclxuXHJcbldHUzg0U3BoZXJlLnByb3RvdHlwZS5vZmZzZXQgPSBmdW5jdGlvbihjMSwgZGlzdGFuY2UsIGJlYXJpbmcpIHtcclxuICB2YXIgbGF0MSA9IHRvUmFkaWFucyhjMVsxXSk7XHJcbiAgdmFyIGxvbjEgPSB0b1JhZGlhbnMoYzFbMF0pO1xyXG4gIHZhciBkQnlSID0gZGlzdGFuY2UgLyB0aGlzLnJhZGl1cztcclxuICB2YXIgbGF0ID0gTWF0aC5hc2luKFxyXG4gICAgICBNYXRoLnNpbihsYXQxKSAqIE1hdGguY29zKGRCeVIpICtcclxuICAgICAgTWF0aC5jb3MobGF0MSkgKiBNYXRoLnNpbihkQnlSKSAqIE1hdGguY29zKGJlYXJpbmcpKTtcclxuICB2YXIgbG9uID0gbG9uMSArIE1hdGguYXRhbjIoXHJcbiAgICAgIE1hdGguc2luKGJlYXJpbmcpICogTWF0aC5zaW4oZEJ5UikgKiBNYXRoLmNvcyhsYXQxKSxcclxuICAgICAgTWF0aC5jb3MoZEJ5UikgLSBNYXRoLnNpbihsYXQxKSAqIE1hdGguc2luKGxhdCkpO1xyXG4gIHJldHVybiBbdG9EZWdyZWVzKGxvbiksIHRvRGVncmVlcyhsYXQpXTtcclxufTtcclxuXHJcbi8qKlxyXG4gKiBDaGVja3Mgd2hldGhlciBvYmplY3QgaXMgbm90IG51bGwgYW5kIG5vdCB1bmRlZmluZWRcclxuICogQHBhcmFtIHsqfSBvYmogb2JqZWN0IHRvIGJlIGNoZWNrZWRcclxuICogQHJldHVybiB7Ym9vbGVhbn1cclxuICovXHJcblxyXG5mdW5jdGlvbiBpc0RlZmluZWQob2JqKSB7XHJcbiAgICByZXR1cm4gbnVsbCAhPSBvYmogJiYgdW5kZWZpbmVkICE9IG9iajtcclxufVxyXG5cclxuZnVuY3Rpb24gaXNOdW1lcmljKHdoKSB7XHJcbiAgICByZXR1cm4gIWlzTmFOKHBhcnNlRmxvYXQod2gpKSAmJiBpc0Zpbml0ZSh3aCk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGlzRnVuY3Rpb24od2gpIHtcclxuICAgIGlmICghd2gpIHtcclxuICAgICAgICByZXR1cm4gZmFsc2U7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gKHdoIGluc3RhbmNlb2YgRnVuY3Rpb24gfHwgdHlwZW9mIHdoID09IFwiZnVuY3Rpb25cIik7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGlzU3RyaW5nTm90RW1wdHkod2gpIHtcclxuICAgIGlmICghd2gpIHtcclxuICAgICAgICByZXR1cm4gZmFsc2U7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gKHdoIGluc3RhbmNlb2YgU3RyaW5nIHx8IHR5cGVvZiB3aCA9PSBcInN0cmluZ1wiKTtcclxufVxyXG5cclxuZnVuY3Rpb24gaXNTdHIod2gpIHtcclxuICAgIHJldHVybiAod2ggaW5zdGFuY2VvZiBTdHJpbmcgfHwgdHlwZW9mIHdoID09PSBcInN0cmluZ1wiKTtcclxufVxyXG5cclxuZnVuY3Rpb24gaXNCb29sZWFuKHdoKSB7XHJcbiAgICByZXR1cm4gKHdoIGluc3RhbmNlb2YgQm9vbGVhbiB8fCB0eXBlb2Ygd2ggPT0gXCJib29sZWFuXCIpO1xyXG59XHJcblxyXG5mdW5jdGlvbiBteVRyaW0oeCkge1xyXG4gICAgcmV0dXJuIHgucmVwbGFjZSgvXlxccyt8XFxzKyQvZ20sJycpO1xyXG59XHJcblxyXG5mdW5jdGlvbiBteVRyaW1Db29yZGluYXRlKHgpIHtcclxuXHRkbyB7XHJcblx0XHR2YXIgaz14O1xyXG5cdFx0eD1teVRyaW0oeCk7XHJcblx0XHRpZiAoayAhPSB4KSBcclxuXHRcdFx0Y29udGludWU7XHJcblx0XHRpZiAoeC5sZW5ndGgpIFxyXG5cdFx0e1xyXG5cdFx0XHRpZiAoeFswXSA9PSBcIixcIilcclxuXHRcdFx0XHR4PXguc3Vic3RyaW5nKDEseC5sZW5ndGgpO1xyXG5cdFx0XHRlbHNlIGlmIChrW2subGVuZ3RoLTFdID09IFwiLFwiKVxyXG5cdFx0XHRcdHg9eC5zdWJzdHJpbmcoMCx4Lmxlbmd0aC0xKTtcclxuXHRcdFx0ZWxzZVxyXG5cdFx0XHRcdGJyZWFrO1xyXG5cdFx0XHRjb250aW51ZTtcclxuXHRcdH1cclxuXHRcdGJyZWFrO1xyXG5cdH0gd2hpbGUgKHRydWUpO1xyXG5cdHJldHVybiB4O1xyXG59XHJcblxyXG5cclxuZnVuY3Rpb24gY2xvc2VzdFByb2plY3Rpb25PZlBvaW50T25MaW5lKHgseSx4MSx5MSx4Mix5MikgXHJcbntcclxuXHR2YXIgc3RhdHVzO1xyXG5cdHZhciBQMT1udWxsO1xyXG5cdHZhciBQMj1udWxsO1xyXG5cdHZhciBQMz1udWxsO1xyXG5cdHZhciBQND1udWxsO1xyXG5cdHZhciBwMT1bXTtcclxuICAgIHZhciBwMj1bXTtcclxuICAgIHZhciBwMz1bXTtcclxuXHR2YXIgcDQ9W107XHJcbiAgICB2YXIgaW50ZXJzZWN0aW9uUG9pbnQ9bnVsbDtcclxuICAgIHZhciBkaXN0TWluUG9pbnQ9bnVsbDtcclxuICAgIHZhciBkZW5vbWluYXRvcj0wO1xyXG4gICAgdmFyIG5vbWluYXRvcj0wO1xyXG4gICAgdmFyIHU9MDtcclxuICAgIHZhciBkaXN0T3J0aG89MDtcclxuICAgIHZhciBkaXN0UDE9MDtcclxuICAgIHZhciBkaXN0UDI9MDtcclxuICAgIHZhciBkaXN0TWluPTA7XHJcbiAgICB2YXIgZGlzdE1heD0wO1xyXG4gICBcclxuICAgIGZ1bmN0aW9uIGludGVyc2VjdGlvbigpXHJcbiAgICB7XHJcbiAgICAgICAgdmFyIGF4ID0gcDFbMF0gKyB1ICogKHAyWzBdIC0gcDFbMF0pO1xyXG4gICAgICAgIHZhciBheSA9IHAxWzFdICsgdSAqIChwMlsxXSAtIHAxWzFdKTtcclxuICAgICAgICBwNCA9IFtheCwgYXldO1xyXG4gICAgICAgIGludGVyc2VjdGlvblBvaW50ID0gW2F4LGF5XTtcclxuICAgIH1cclxuXHJcbiAgICBmdW5jdGlvbiBkaXN0YW5jZSgpXHJcbiAgICB7XHJcbiAgICAgICAgdmFyIGF4ID0gcDFbMF0gKyB1ICogKHAyWzBdIC0gcDFbMF0pO1xyXG4gICAgICAgIHZhciBheSA9IHAxWzFdICsgdSAqIChwMlsxXSAtIHAxWzFdKTtcclxuICAgICAgICBwNCA9IFtheCwgYXldO1xyXG4gICAgICAgIGRpc3RPcnRobyA9IE1hdGguc3FydChNYXRoLnBvdygocDRbMF0gLSBwM1swXSksMikgKyBNYXRoLnBvdygocDRbMV0gLSBwM1sxXSksMikpO1xyXG4gICAgICAgIGRpc3RQMSAgICA9IE1hdGguc3FydChNYXRoLnBvdygocDFbMF0gLSBwM1swXSksMikgKyBNYXRoLnBvdygocDFbMV0gLSBwM1sxXSksMikpO1xyXG4gICAgICAgIGRpc3RQMiAgICA9IE1hdGguc3FydChNYXRoLnBvdygocDJbMF0gLSBwM1swXSksMikgKyBNYXRoLnBvdygocDJbMV0gLSBwM1sxXSksMikpO1xyXG4gICAgICAgIGlmKHU+PTAgJiYgdTw9MSlcclxuICAgICAgICB7ICAgZGlzdE1pbiA9IGRpc3RPcnRobztcclxuICAgICAgICAgICAgZGlzdE1pblBvaW50ID0gaW50ZXJzZWN0aW9uUG9pbnQ7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGVsc2VcclxuICAgICAgICB7ICAgaWYoZGlzdFAxIDw9IGRpc3RQMilcclxuICAgICAgICAgICAgeyAgIGRpc3RNaW4gPSBkaXN0UDE7XHJcbiAgICAgICAgICAgICAgICBkaXN0TWluUG9pbnQgPSBQMTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBlbHNlXHJcbiAgICAgICAgICAgIHsgICBkaXN0TWluID0gZGlzdFAyO1xyXG4gICAgICAgICAgICAgICAgZGlzdE1pblBvaW50ID0gUDI7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgICAgZGlzdE1heCA9IE1hdGgubWF4KE1hdGgubWF4KGRpc3RPcnRobywgZGlzdFAxKSwgZGlzdFAyKTtcclxuICAgIH1cclxuXHRQMSA9IFt4MSx5MV07XHJcblx0UDIgPSBbeDIseTJdO1xyXG5cdFAzID0gW3gseV07XHJcblx0cDEgPSBbeDEsIHkxXTtcclxuXHRwMiA9IFt4MiwgeTJdO1xyXG5cdHAzID0gW3gsIHldO1xyXG5cdGRlbm9taW5hdG9yID0gTWF0aC5wb3coTWF0aC5zcXJ0KE1hdGgucG93KHAyWzBdLXAxWzBdLDIpICsgTWF0aC5wb3cocDJbMV0tcDFbMV0sMikpLDIgKTtcclxuXHRub21pbmF0b3IgICA9IChwM1swXSAtIHAxWzBdKSAqIChwMlswXSAtIHAxWzBdKSArIChwM1sxXSAtIHAxWzFdKSAqIChwMlsxXSAtIHAxWzFdKTtcclxuXHRpZihkZW5vbWluYXRvcj09MClcclxuXHR7ICAgc3RhdHVzID0gXCJjb2luY2lkZW50YWxcIlxyXG5cdFx0dSA9IC05OTk7XHJcblx0fVxyXG5cdGVsc2VcclxuXHR7ICAgdSA9IG5vbWluYXRvciAvIGRlbm9taW5hdG9yO1xyXG5cdFx0aWYodSA+PTAgJiYgdSA8PSAxKVxyXG5cdFx0XHRzdGF0dXMgPSBcIm9ydGhvZ29uYWxcIjtcclxuXHRcdGVsc2VcclxuXHRcdFx0c3RhdHVzID0gXCJvYmxpcXVlXCI7XHJcblx0fVxyXG5cdGludGVyc2VjdGlvbigpO1xyXG5cdGRpc3RhbmNlKCk7XHJcblx0XHJcblx0cmV0dXJuIHsgc3RhdHVzIDogc3RhdHVzLCBwb3MgOiBkaXN0TWluUG9pbnQsIG1pbiA6IGRpc3RNaW4gfTtcclxufVxyXG5cclxuZnVuY3Rpb24gY29sb3JMdW1pbmFuY2UoaGV4LCBsdW0pIHtcclxuICAgIC8vIFZhbGlkYXRlIGhleCBzdHJpbmdcclxuICAgIGhleCA9IFN0cmluZyhoZXgpLnJlcGxhY2UoL1teMC05YS1mXS9naSwgXCJcIik7XHJcbiAgICBpZiAoaGV4Lmxlbmd0aCA8IDYpIHtcclxuICAgICAgICBoZXggPSBoZXgucmVwbGFjZSgvKC4pL2csICckMSQxJyk7XHJcbiAgICB9XHJcbiAgICBsdW0gPSBsdW0gfHwgMDtcclxuICAgIC8vIENvbnZlcnQgdG8gZGVjaW1hbCBhbmQgY2hhbmdlIGx1bWlub3NpdHlcclxuICAgIHZhciByZ2IgPSBcIiNcIixcclxuICAgICAgICBjO1xyXG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCAzOyArK2kpIHtcclxuICAgICAgICBjID0gcGFyc2VJbnQoaGV4LnN1YnN0cihpICogMiwgMiksIDE2KTtcclxuICAgICAgICBjID0gTWF0aC5yb3VuZChNYXRoLm1pbihNYXRoLm1heCgwLCBjICsgKGMgKiBsdW0pKSwgMjU1KSkudG9TdHJpbmcoMTYpO1xyXG4gICAgICAgIHJnYiArPSAoXCIwMFwiICsgYykuc3Vic3RyKGMubGVuZ3RoKTtcclxuICAgIH1cclxuICAgIHJldHVybiByZ2I7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGluY3JlYXNlQnJpZ2h0bmVzcyhoZXgsIHBlcmNlbnQpIFxyXG57XHJcbiAgICBoZXggPSBTdHJpbmcoaGV4KS5yZXBsYWNlKC9bXjAtOWEtZl0vZ2ksIFwiXCIpO1xyXG4gICAgaWYgKGhleC5sZW5ndGggPCA2KSB7XHJcbiAgICAgICAgaGV4ID0gaGV4LnJlcGxhY2UoLyguKS9nLCAnJDEkMScpO1xyXG4gICAgfVxyXG4gICAgdmFyIHJnYiA9IFwiI1wiLFxyXG4gICAgICAgIGM7XHJcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IDM7ICsraSkge1xyXG4gICAgICAgIGMgPSBwYXJzZUludChoZXguc3Vic3RyKGkgKiAyLCAyKSwgMTYpO1xyXG4gICAgICAgIGMgPSBwYXJzZUludCgoYyooMTAwLXBlcmNlbnQpKzI1NSpwZXJjZW50KS8xMDApO1xyXG4gICAgICAgIGlmIChjID4gMjU1KVxyXG4gICAgICAgIFx0Yz0yNTU7XHJcbiAgICAgICAgYz1jLnRvU3RyaW5nKDE2KTtcclxuICAgICAgICByZ2IgKz0gKFwiMDBcIiArIGMpLnN1YnN0cihjLmxlbmd0aCk7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gcmdiO1xyXG59XHJcblxyXG5mdW5jdGlvbiBjb2xvckFscGhhQXJyYXkoaGV4LCBhbHBoYSkge1xyXG4gICAgaGV4ID0gU3RyaW5nKGhleCkucmVwbGFjZSgvW14wLTlhLWZdL2dpLCBcIlwiKTtcclxuICAgIGlmIChoZXgubGVuZ3RoIDwgNikge1xyXG4gICAgICAgIGhleCA9IGhleC5yZXBsYWNlKC8oLikvZywgJyQxJDEnKTtcclxuICAgIH1cclxuICAgIHZhciByZXM9W107XHJcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IDM7ICsraSkge1xyXG4gICAgICAgIGMgPSBwYXJzZUludChoZXguc3Vic3RyKGkgKiAyLCAyKSwgMTYpO1xyXG4gICAgICAgIHJlcy5wdXNoKGMpO1xyXG4gICAgfVxyXG4gICAgcmVzLnB1c2goYWxwaGEpO1xyXG4gICAgcmV0dXJuIHJlcztcclxufVxyXG5cclxuZnVuY3Rpb24gZXNjYXBlSFRNTCh1bnNhZmUpIHtcclxuICAgIHJldHVybiB1bnNhZmVcclxuICAgICAgICAgLnJlcGxhY2UoLyYvZywgXCImYW1wO1wiKVxyXG4gICAgICAgICAucmVwbGFjZSgvPC9nLCBcIiZsdDtcIilcclxuICAgICAgICAgLnJlcGxhY2UoLz4vZywgXCImZ3Q7XCIpXHJcbiAgICAgICAgIC5yZXBsYWNlKC9cIi9nLCBcIiZxdW90O1wiKVxyXG4gICAgICAgICAucmVwbGFjZSgvJy9nLCBcIiYjMDM5O1wiKTtcclxuIH1cclxuXHJcbmZ1bmN0aW9uIGZvcm1hdE51bWJlcjIodmFsKSB7XHJcblx0cmV0dXJuIHBhcnNlRmxvYXQoTWF0aC5yb3VuZCh2YWwgKiAxMDApIC8gMTAwKS50b0ZpeGVkKDIpO1xyXG59XHJcbmZ1bmN0aW9uIGZvcm1hdERhdGUoZCkge1xyXG4gXHR2YXIgZGQgPSBkLmdldERhdGUoKTtcclxuICAgIHZhciBtbSA9IGQuZ2V0TW9udGgoKSsxOyAvL0phbnVhcnkgaXMgMCFcclxuICAgIHZhciB5eXl5ID0gZC5nZXRGdWxsWWVhcigpO1xyXG4gICAgaWYoZGQ8MTApe1xyXG4gICAgICAgIGRkPScwJytkZDtcclxuICAgIH0gXHJcbiAgICBpZihtbTwxMCl7XHJcbiAgICAgICAgbW09JzAnK21tO1xyXG4gICAgfSBcclxuICAgIHJldHVybiBkZCsnLicrbW0rJy4nK3l5eXk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGZvcm1hdFRpbWUoZCkge1xyXG4gICAgdmFyIGhoID0gZC5nZXRIb3VycygpO1xyXG4gICAgaWYoaGg8MTApe1xyXG4gICAgXHRoaD0nMCcraGg7XHJcbiAgICB9IFxyXG4gICAgdmFyIG1tID0gZC5nZXRNaW51dGVzKCk7XHJcbiAgICBpZihtbTwxMCl7XHJcbiAgICAgICAgbW09JzAnK21tO1xyXG4gICAgfSBcclxuICAgIHJldHVybiBoaCtcIjpcIittbTtcclxufVxyXG5cclxuZnVuY3Rpb24gZm9ybWF0RGF0ZVRpbWUoZCkge1xyXG5cdHJldHVybiBmb3JtYXREYXRlKGQpK1wiIFwiK2Zvcm1hdFRpbWUoZCk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGZvcm1hdERhdGVUaW1lU2VjKGQpIHtcclxuXHRyZXR1cm4gZm9ybWF0RGF0ZShkKStcIiBcIitmb3JtYXRUaW1lU2VjKGQpO1xyXG59XHJcblxyXG5mdW5jdGlvbiBmb3JtYXRUaW1lU2VjKGQpIHtcclxuICAgIHZhciBoaCA9IGQuZ2V0SG91cnMoKTtcclxuICAgIGlmKGhoPDEwKXtcclxuICAgIFx0aGg9JzAnK2hoO1xyXG4gICAgfSBcclxuICAgIHZhciBtbSA9IGQuZ2V0TWludXRlcygpO1xyXG4gICAgaWYobW08MTApe1xyXG4gICAgICAgIG1tPScwJyttbTtcclxuICAgIH0gXHJcbiAgICB2YXIgc3MgPSBkLmdldFNlY29uZHMoKTtcclxuICAgIGlmKHNzPDEwKXtcclxuICAgICAgICBzcz0nMCcrc3M7XHJcbiAgICB9IFxyXG4gICAgcmV0dXJuIGhoK1wiOlwiK21tK1wiOlwiK3NzO1xyXG59XHJcblxyXG5mdW5jdGlvbiByYWluYm93KG51bU9mU3RlcHMsIHN0ZXApIHtcclxuICAgIC8vIFRoaXMgZnVuY3Rpb24gZ2VuZXJhdGVzIHZpYnJhbnQsIFwiZXZlbmx5IHNwYWNlZFwiIGNvbG91cnMgKGkuZS4gbm8gY2x1c3RlcmluZykuIFRoaXMgaXMgaWRlYWwgZm9yIGNyZWF0aW5nIGVhc2lseSBkaXN0aW5ndWlzaGFibGUgdmlicmFudCBtYXJrZXJzIGluIEdvb2dsZSBNYXBzIGFuZCBvdGhlciBhcHBzLlxyXG4gICAgLy8gQWRhbSBDb2xlLCAyMDExLVNlcHQtMTRcclxuICAgIC8vIEhTViB0byBSQkcgYWRhcHRlZCBmcm9tOiBodHRwOi8vbWppamFja3Nvbi5jb20vMjAwOC8wMi9yZ2ItdG8taHNsLWFuZC1yZ2ItdG8taHN2LWNvbG9yLW1vZGVsLWNvbnZlcnNpb24tYWxnb3JpdGhtcy1pbi1qYXZhc2NyaXB0XHJcbiAgICB2YXIgciwgZywgYjtcclxuICAgIHZhciBoID0gc3RlcCAvIG51bU9mU3RlcHM7XHJcbiAgICB2YXIgaSA9IH5+KGggKiA2KTtcclxuICAgIHZhciBmID0gaCAqIDYgLSBpO1xyXG4gICAgdmFyIHEgPSAxIC0gZjtcclxuICAgIHN3aXRjaChpICUgNil7XHJcbiAgICAgICAgY2FzZSAwOiByID0gMSwgZyA9IGYsIGIgPSAwOyBicmVhaztcclxuICAgICAgICBjYXNlIDE6IHIgPSBxLCBnID0gMSwgYiA9IDA7IGJyZWFrO1xyXG4gICAgICAgIGNhc2UgMjogciA9IDAsIGcgPSAxLCBiID0gZjsgYnJlYWs7XHJcbiAgICAgICAgY2FzZSAzOiByID0gMCwgZyA9IHEsIGIgPSAxOyBicmVhaztcclxuICAgICAgICBjYXNlIDQ6IHIgPSBmLCBnID0gMCwgYiA9IDE7IGJyZWFrO1xyXG4gICAgICAgIGNhc2UgNTogciA9IDEsIGcgPSAwLCBiID0gcTsgYnJlYWs7XHJcbiAgICB9XHJcbiAgICB2YXIgYyA9IFwiI1wiICsgKFwiMDBcIiArICh+IH4ociAqIDI1NSkpLnRvU3RyaW5nKDE2KSkuc2xpY2UoLTIpICsgKFwiMDBcIiArICh+IH4oZyAqIDI1NSkpLnRvU3RyaW5nKDE2KSkuc2xpY2UoLTIpICsgKFwiMDBcIiArICh+IH4oYiAqIDI1NSkpLnRvU3RyaW5nKDE2KSkuc2xpY2UoLTIpO1xyXG4gICAgcmV0dXJuIChjKTtcclxufVxyXG5cclxuZnVuY3Rpb24gbW9iaWxlQW5kVGFibGV0Q2hlY2soKSBcclxue1xyXG5cdCAgaWYgKHR5cGVvZiBuYXZpZ2F0b3IgPT0gXCJ1bmRlZmluZWRcIilcclxuXHRcdCAgcmV0dXJuIGZhbHNlO1xyXG5cdCAgdmFyIGNoZWNrID0gZmFsc2U7XHJcblx0ICAoZnVuY3Rpb24oYSl7aWYoLyhhbmRyb2lkfGJiXFxkK3xtZWVnbykuK21vYmlsZXxhdmFudGdvfGJhZGFcXC98YmxhY2tiZXJyeXxibGF6ZXJ8Y29tcGFsfGVsYWluZXxmZW5uZWN8aGlwdG9wfGllbW9iaWxlfGlwKGhvbmV8b2QpfGlyaXN8a2luZGxlfGxnZSB8bWFlbW98bWlkcHxtbXB8bW9iaWxlLitmaXJlZm94fG5ldGZyb250fG9wZXJhIG0ob2J8aW4paXxwYWxtKCBvcyk/fHBob25lfHAoaXhpfHJlKVxcL3xwbHVja2VyfHBvY2tldHxwc3B8c2VyaWVzKDR8NikwfHN5bWJpYW58dHJlb3x1cFxcLihicm93c2VyfGxpbmspfHZvZGFmb25lfHdhcHx3aW5kb3dzIGNlfHhkYXx4aWlub3xhbmRyb2lkfGlwYWR8cGxheWJvb2t8c2lsay9pLnRlc3QoYSl8fC8xMjA3fDYzMTB8NjU5MHwzZ3NvfDR0aHB8NTBbMS02XWl8Nzcwc3w4MDJzfGEgd2F8YWJhY3xhYyhlcnxvb3xzXFwtKXxhaShrb3xybil8YWwoYXZ8Y2F8Y28pfGFtb2l8YW4oZXh8bnl8eXcpfGFwdHV8YXIoY2h8Z28pfGFzKHRlfHVzKXxhdHR3fGF1KGRpfFxcLW18ciB8cyApfGF2YW58YmUoY2t8bGx8bnEpfGJpKGxifHJkKXxibChhY3xheil8YnIoZXx2KXd8YnVtYnxid1xcLShufHUpfGM1NVxcL3xjYXBpfGNjd2F8Y2RtXFwtfGNlbGx8Y2h0bXxjbGRjfGNtZFxcLXxjbyhtcHxuZCl8Y3Jhd3xkYShpdHxsbHxuZyl8ZGJ0ZXxkY1xcLXN8ZGV2aXxkaWNhfGRtb2J8ZG8oY3xwKW98ZHMoMTJ8XFwtZCl8ZWwoNDl8YWkpfGVtKGwyfHVsKXxlcihpY3xrMCl8ZXNsOHxleihbNC03XTB8b3N8d2F8emUpfGZldGN8Zmx5KFxcLXxfKXxnMSB1fGc1NjB8Z2VuZXxnZlxcLTV8Z1xcLW1vfGdvKFxcLnd8b2QpfGdyKGFkfHVuKXxoYWllfGhjaXR8aGRcXC0obXxwfHQpfGhlaVxcLXxoaShwdHx0YSl8aHAoIGl8aXApfGhzXFwtY3xodChjKFxcLXwgfF98YXxnfHB8c3x0KXx0cCl8aHUoYXd8dGMpfGlcXC0oMjB8Z298bWEpfGkyMzB8aWFjKCB8XFwtfFxcLyl8aWJyb3xpZGVhfGlnMDF8aWtvbXxpbTFrfGlubm98aXBhcXxpcmlzfGphKHR8dilhfGpicm98amVtdXxqaWdzfGtkZGl8a2VqaXxrZ3QoIHxcXC8pfGtsb258a3B0IHxrd2NcXC18a3lvKGN8ayl8bGUobm98eGkpfGxnKCBnfFxcLyhrfGx8dSl8NTB8NTR8XFwtW2Etd10pfGxpYnd8bHlueHxtMVxcLXd8bTNnYXxtNTBcXC98bWEodGV8dWl8eG8pfG1jKDAxfDIxfGNhKXxtXFwtY3J8bWUocmN8cmkpfG1pKG84fG9hfHRzKXxtbWVmfG1vKDAxfDAyfGJpfGRlfGRvfHQoXFwtfCB8b3x2KXx6eil8bXQoNTB8cDF8diApfG13YnB8bXl3YXxuMTBbMC0yXXxuMjBbMi0zXXxuMzAoMHwyKXxuNTAoMHwyfDUpfG43KDAoMHwxKXwxMCl8bmUoKGN8bSlcXC18b258dGZ8d2Z8d2d8d3QpfG5vayg2fGkpfG56cGh8bzJpbXxvcCh0aXx3dil8b3Jhbnxvd2cxfHA4MDB8cGFuKGF8ZHx0KXxwZHhnfHBnKDEzfFxcLShbMS04XXxjKSl8cGhpbHxwaXJlfHBsKGF5fHVjKXxwblxcLTJ8cG8oY2t8cnR8c2UpfHByb3h8cHNpb3xwdFxcLWd8cWFcXC1hfHFjKDA3fDEyfDIxfDMyfDYwfFxcLVsyLTddfGlcXC0pfHF0ZWt8cjM4MHxyNjAwfHJha3N8cmltOXxybyh2ZXx6byl8czU1XFwvfHNhKGdlfG1hfG1tfG1zfG55fHZhKXxzYygwMXxoXFwtfG9vfHBcXC0pfHNka1xcL3xzZShjKFxcLXwwfDEpfDQ3fG1jfG5kfHJpKXxzZ2hcXC18c2hhcnxzaWUoXFwtfG0pfHNrXFwtMHxzbCg0NXxpZCl8c20oYWx8YXJ8YjN8aXR8dDUpfHNvKGZ0fG55KXxzcCgwMXxoXFwtfHZcXC18diApfHN5KDAxfG1iKXx0MigxOHw1MCl8dDYoMDB8MTB8MTgpfHRhKGd0fGxrKXx0Y2xcXC18dGRnXFwtfHRlbChpfG0pfHRpbVxcLXx0XFwtbW98dG8ocGx8c2gpfHRzKDcwfG1cXC18bTN8bTUpfHR4XFwtOXx1cChcXC5ifGcxfHNpKXx1dHN0fHY0MDB8djc1MHx2ZXJpfHZpKHJnfHRlKXx2ayg0MHw1WzAtM118XFwtdil8dm00MHx2b2RhfHZ1bGN8dngoNTJ8NTN8NjB8NjF8NzB8ODB8ODF8ODN8ODV8OTgpfHczYyhcXC18ICl8d2ViY3x3aGl0fHdpKGcgfG5jfG53KXx3bWxifHdvbnV8eDcwMHx5YXNcXC18eW91cnx6ZXRvfHp0ZVxcLS9pLnRlc3QoYS5zdWJzdHIoMCw0KSkpY2hlY2sgPSB0cnVlfSkobmF2aWdhdG9yLnVzZXJBZ2VudHx8bmF2aWdhdG9yLnZlbmRvcnx8d2luZG93Lm9wZXJhKTtcclxuXHQgIHJldHVybiBjaGVjaztcclxufVxyXG5cclxudmFyIFJFTkRFUkVEQVJST1dTPXt9O1xyXG5mdW5jdGlvbiByZW5kZXJBcnJvd0Jhc2U2NCh3aWR0aCxoZWlnaHQsY29sb3IpIFxyXG57XHJcblx0dmFyIGtleSA9IHdpZHRoK1wieFwiK2hlaWdodCtcIjpcIitjb2xvcjtcclxuXHRpZiAoUkVOREVSRURBUlJPV1Nba2V5XSlcclxuXHRcdHJldHVybiBSRU5ERVJFREFSUk9XU1trZXldO1xyXG5cdHZhciBicmRjb2wgPSBcIiNmZWZlZmVcIjsgLy9pbmNyZWFzZUJyaWdodG5lc3MoY29sb3IsOTkpO1xyXG5cdFxyXG5cdHZhciBzdmc9JzxzdmcgdmVyc2lvbj1cIjEuMVwiIGlkPVwiTGF5ZXJfMVwiIHhtbG5zPVwiaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmdcIiB4bWxuczp4bGluaz1cImh0dHA6Ly93d3cudzMub3JnLzE5OTkveGxpbmtcIiB4PVwiMHB4XCIgeT1cIjBweFwiIHdpZHRoPVwiJyt3aWR0aCsncHRcIiBoZWlnaHQ9XCInK2hlaWdodCsncHRcIiAnXHRcclxuXHQrJ3ZpZXdCb3g9XCIxMzcuODM0IC04Mi44MzMgMTE0IDkxLjMzM1wiIGVuYWJsZS1iYWNrZ3JvdW5kPVwibmV3IDEzNy44MzQgLTgyLjgzMyAxMTQgOTEuMzMzXCIgeG1sOnNwYWNlPVwicHJlc2VydmVcIj4nXHJcblx0Kyc8cGF0aCBmaWxsPVwibm9uZVwiIGQ9XCJNLTUxLTIuMTY3aDQ4djQ4aC00OFYtMi4xNjd6XCIvPidcclxuXHQrJzxjaXJjbGUgZGlzcGxheT1cIm5vbmVcIiBmaWxsPVwiIzYwNUNDOVwiIGN4PVwiNTEuMjg2XCIgY3k9XCItMzUuMjg2XCIgcj1cIjg4Ljc4NlwiLz4nXHJcblx0Kyc8cGF0aCBmaWxsPVwiIzYwNUNDOVwiIHN0cm9rZT1cIiNGRkZGRkZcIiBzdHJva2Utd2lkdGg9XCI0XCIgc3Ryb2tlLW1pdGVybGltaXQ9XCIxMFwiIGQ9XCJNMjM5LjUtMzYuOGwtOTIuNTU4LTM1LjY5IGM1LjIxNiwxMS4zMDQsOC4xMywyMy44ODcsOC4xMywzNy4xNTNjMCwxMi4xNy0yLjQ1MSwyMy43NjctNi44ODMsMzQuMzI3TDIzOS41LTM2Ljh6XCIvPidcclxuXHQrJzwvc3ZnPidcclxuXHR2YXIgc3ZnPXN2Zy5zcGxpdChcIiM2MDVDQzlcIikuam9pbihjb2xvcik7XHJcblx0dmFyIGNhbnZhcyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2NhbnZhcycpO1xyXG4gICAgY2FudmFzLndpZHRoID0gd2lkdGg7XHJcbiAgICBjYW52YXMuaGVpZ2h0ID0gaGVpZ2h0O1xyXG4gICAgY2FudmcoY2FudmFzLCBzdmcseyBpZ25vcmVNb3VzZTogdHJ1ZSwgaWdub3JlQW5pbWF0aW9uOiB0cnVlIH0pO1xyXG4gICAgcmV0dXJuIFJFTkRFUkVEQVJST1dTW2tleV09Y2FudmFzLnRvRGF0YVVSTCgpO1xyXG59XHJcblxyXG52YXIgUkVOREVSRURESVJFQ1RJT05TPXt9O1xyXG5mdW5jdGlvbiByZW5kZXJEaXJlY3Rpb25CYXNlNjQod2lkdGgsaGVpZ2h0LGNvbG9yKSBcclxue1xyXG5cdHZhciBrZXkgPSB3aWR0aCtcInhcIitoZWlnaHQrXCI6XCIrY29sb3I7XHJcblx0aWYgKFJFTkRFUkVERElSRUNUSU9OU1trZXldKVxyXG5cdFx0cmV0dXJuIFJFTkRFUkVERElSRUNUSU9OU1trZXldO1xyXG5cclxuXHR2YXIgc3ZnPSc8c3ZnIHdpZHRoPVwiJyt3aWR0aCsncHRcIiBoZWlnaHQ9XCInK2hlaWdodCsncHRcIiAnXHJcblxyXG5cdFx0Kyd2aWV3Qm94PVwiMTUgOSAxOS43NSAyOS41XCIgZW5hYmxlLWJhY2tncm91bmQ9XCJuZXcgMTUgOSAxOS43NSAyOS41XCIgeG1sOnNwYWNlPVwicHJlc2VydmVcIj4nXHJcblx0XHQrJzxwYXRoIGZpbGw9XCIjRkZGRUZGXCIgZD1cIk0xNy4xNywzMi45Mmw5LjE3LTkuMTdsLTkuMTctOS4xN0wyMCwxMS43NWwxMiwxMmwtMTIsMTJMMTcuMTcsMzIuOTJ6XCIvPidcclxuXHRcdCsnPHBhdGggZmlsbD1cIm5vbmVcIiBkPVwiTTAtMC4yNWg0OHY0OEgwVi0wLjI1elwiLz4nXHJcblxyXG5cdCsnPC9zdmc+JztcclxuXHJcblx0dmFyIHN2Zz1zdmcuc3BsaXQoXCIjMDAwMDAwXCIpLmpvaW4oY29sb3IpO1xyXG5cdHZhciBjYW52YXMgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdjYW52YXMnKTtcclxuICAgIGNhbnZhcy53aWR0aCA9IHdpZHRoO1xyXG4gICAgY2FudmFzLmhlaWdodCA9IGhlaWdodDtcclxuICAgIGNhbnZnKGNhbnZhcywgc3ZnLHsgaWdub3JlTW91c2U6IHRydWUsIGlnbm9yZUFuaW1hdGlvbjogdHJ1ZSB9KTtcclxuICAgIHJldHVybiBSRU5ERVJFRERJUkVDVElPTlNba2V5XT1jYW52YXMudG9EYXRhVVJMKCk7XHJcbn1cclxuXHJcbnZhciBSRU5ERVJFQk9YRVM9e307XHJcbmZ1bmN0aW9uIHJlbmRlckJveEJhc2U2NCh3aWR0aCxoZWlnaHQsY29sb3IpIFxyXG57XHJcblx0dmFyIGtleSA9IHdpZHRoK1wieFwiK2hlaWdodCtcIjpcIitjb2xvcjtcclxuXHRpZiAoUkVOREVSRUJPWEVTW2tleV0pXHJcblx0XHRyZXR1cm4gUkVOREVSRUJPWEVTW2tleV07XHJcblxyXG5cdHZhciBzdmc9Jzxzdmcgd2lkdGg9XCInK3dpZHRoKydwdFwiIGhlaWdodD1cIicraGVpZ2h0KydwdFwiIHZpZXdCb3g9XCIwIDAgNTEyIDUxMlwiIHZlcnNpb249XCIxLjFcIiB4bWxucz1cImh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnXCI+J1xyXG5cdCsnPGcgaWQ9XCIjZmZmZmZmZmZcIj4nXHJcblx0Kyc8cGF0aCBmaWxsPVwiI2ZmZmZmZlwiIG9wYWNpdHk9XCIxLjAwXCIgZD1cIiBNIDU1LjUwIDAuMDAgTCA0NTguNDUgMC4wMCBDIDQ3Mi40NCAwLjk5IDQ4Ni4wMyA3LjA5IDQ5NS43OCAxNy4yMyBDIDUwNS4zNCAyNi44OCA1MTEuMDEgNDAuMDQgNTEyLjAwIDUzLjU1IEwgNTEyLjAwIDQ1OC40NCBDIDUxMC45OSA0NzIuNDMgNTA0LjkwIDQ4Ni4wMSA0OTQuNzcgNDk1Ljc3IEMgNDg1LjExIDUwNS4zMiA0NzEuOTYgNTExLjAxIDQ1OC40NSA1MTIuMDAgTCA1My41NiA1MTIuMDAgQyAzOS41NyA1MTAuOTkgMjUuOTcgNTA0LjkxIDE2LjIyIDQ5NC43OCBDIDYuNjcgNDg1LjEyIDAuOTcgNDcxLjk3IDAuMDAgNDU4LjQ1IEwgMC4wMCA1NS41MCBDIDAuNDAgNDEuMDcgNi40NSAyNi44OSAxNi43NCAxNi43MyBDIDI2Ljg5IDYuNDUgNDEuMDcgMC40MSA1NS41MCAwLjAwIE0gNTYuOTAgNTYuOTAgQyA1Ni44NyAxODkuNjMgNTYuODYgMzIyLjM2IDU2LjkwIDQ1NS4wOSBDIDE4OS42MyA0NTUuMTIgMzIyLjM2IDQ1NS4xMiA0NTUuMDkgNDU1LjA5IEMgNDU1LjEyIDMyMi4zNiA0NTUuMTIgMTg5LjYzIDQ1NS4wOSA1Ni45MCBDIDMyMi4zNiA1Ni44NiAxODkuNjMgNTYuODcgNTYuOTAgNTYuOTAgWlwiIC8+J1xyXG5cdCsnPC9nPidcclxuXHQrJzxnIGlkPVwiIzAwMDAwMGZmXCI+J1xyXG5cdCsnPHBhdGggZmlsbD1cIiMwMDAwMDBcIiBvcGFjaXR5PVwiMS4wMFwiIGQ9XCIgTSA1Ni45MCA1Ni45MCBDIDE4OS42MyA1Ni44NyAzMjIuMzYgNTYuODYgNDU1LjA5IDU2LjkwIEMgNDU1LjEyIDE4OS42MyA0NTUuMTIgMzIyLjM2IDQ1NS4wOSA0NTUuMDkgQyAzMjIuMzYgNDU1LjEyIDE4OS42MyA0NTUuMTIgNTYuOTAgNDU1LjA5IEMgNTYuODYgMzIyLjM2IDU2Ljg3IDE4OS42MyA1Ni45MCA1Ni45MCBaXCIgLz4nXHJcblx0Kyc8L2c+J1xyXG5cdCsnPC9zdmc+JztcclxuXHJcblx0dmFyIHN2Zz1zdmcuc3BsaXQoXCIjMDAwMDAwXCIpLmpvaW4oY29sb3IpO1xyXG5cdHZhciBjYW52YXMgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdjYW52YXMnKTtcclxuICAgIGNhbnZhcy53aWR0aCA9IHdpZHRoO1xyXG4gICAgY2FudmFzLmhlaWdodCA9IGhlaWdodDtcclxuICAgIGNhbnZnKGNhbnZhcywgc3ZnLHsgaWdub3JlTW91c2U6IHRydWUsIGlnbm9yZUFuaW1hdGlvbjogdHJ1ZSB9KTtcclxuICAgIHJldHVybiBSRU5ERVJFQk9YRVNba2V5XT1jYW52YXMudG9EYXRhVVJMKCk7XHJcbn1cclxuXHJcblxyXG5mdW5jdGlvbiBpbnRlcmNlcHRPbkNpcmNsZShhLGIsYyxyKSB7XHJcblx0cmV0dXJuIGNpcmNsZUxpbmVJbnRlcnNlY3QoYVswXSxhWzFdLGJbMF0sYlsxXSxjWzBdLGNbMV0scik7XHRcclxufVxyXG5mdW5jdGlvbiBkaXN0cChwMSxwMikge1xyXG5cdCAgcmV0dXJuIE1hdGguc3FydCgocDJbMF0tcDFbMF0pKihwMlswXS1wMVswXSkrKHAyWzFdLXAxWzFdKSoocDJbMV0tcDFbMV0pKTtcclxufVxyXG5cclxuZnVuY3Rpb24gY2lyY2xlTGluZUludGVyc2VjdCh4MSwgeTEsIHgyLCB5MiwgY3gsIGN5LCBjciApIFxyXG57XHJcblx0ICBmdW5jdGlvbiBkaXN0KHgxLHkxLHgyLHkyKSB7XHJcblx0XHQgIHJldHVybiBNYXRoLnNxcnQoKHgyLXgxKSooeDIteDEpKyh5Mi15MSkqKHkyLXkxKSk7XHJcblx0ICB9XHJcblx0ICB2YXIgZHggPSB4MiAtIHgxO1xyXG5cdCAgdmFyIGR5ID0geTIgLSB5MTtcclxuXHQgIHZhciBhID0gZHggKiBkeCArIGR5ICogZHk7XHJcblx0ICB2YXIgYiA9IDIgKiAoZHggKiAoeDEgLSBjeCkgKyBkeSAqICh5MSAtIGN5KSk7XHJcblx0ICB2YXIgYyA9IGN4ICogY3ggKyBjeSAqIGN5O1xyXG5cdCAgYyArPSB4MSAqIHgxICsgeTEgKiB5MTtcclxuXHQgIGMgLT0gMiAqIChjeCAqIHgxICsgY3kgKiB5MSk7XHJcblx0ICBjIC09IGNyICogY3I7XHJcblx0ICB2YXIgYmI0YWMgPSBiICogYiAtIDQgKiBhICogYztcclxuXHQgIGlmIChiYjRhYyA8IDApIHsgIC8vIE5vdCBpbnRlcnNlY3RpbmdcclxuXHQgICAgcmV0dXJuIGZhbHNlO1xyXG5cdCAgfSBlbHNlIHtcclxuXHRcdHZhciBtdSA9ICgtYiArIE1hdGguc3FydCggYipiIC0gNCphKmMgKSkgLyAoMiphKTtcclxuXHRcdHZhciBpeDEgPSB4MSArIG11KihkeCk7XHJcblx0XHR2YXIgaXkxID0geTEgKyBtdSooZHkpO1xyXG5cdCAgICBtdSA9ICgtYiAtIE1hdGguc3FydChiKmIgLSA0KmEqYyApKSAvICgyKmEpO1xyXG5cdCAgICB2YXIgaXgyID0geDEgKyBtdSooZHgpO1xyXG5cdCAgICB2YXIgaXkyID0geTEgKyBtdSooZHkpO1xyXG5cclxuXHQgICAgLy8gVGhlIGludGVyc2VjdGlvbiBwb2ludHNcclxuXHQgICAgLy9lbGxpcHNlKGl4MSwgaXkxLCAxMCwgMTApO1xyXG5cdCAgICAvL2VsbGlwc2UoaXgyLCBpeTIsIDEwLCAxMCk7XHJcblx0ICAgIFxyXG5cdCAgICB2YXIgdGVzdFg7XHJcblx0ICAgIHZhciB0ZXN0WTtcclxuXHQgICAgLy8gRmlndXJlIG91dCB3aGljaCBwb2ludCBpcyBjbG9zZXIgdG8gdGhlIGNpcmNsZVxyXG5cdCAgICBpZiAoZGlzdCh4MSwgeTEsIGN4LCBjeSkgPCBkaXN0KHgyLCB5MiwgY3gsIGN5KSkge1xyXG5cdCAgICAgIHRlc3RYID0geDI7XHJcblx0ICAgICAgdGVzdFkgPSB5MjtcclxuXHQgICAgfSBlbHNlIHtcclxuXHQgICAgICB0ZXN0WCA9IHgxO1xyXG5cdCAgICAgIHRlc3RZID0geTE7XHJcblx0ICAgIH1cclxuXHQgICAgIFxyXG5cdCAgICBpZiAoZGlzdCh0ZXN0WCwgdGVzdFksIGl4MSwgaXkxKSA8IGRpc3QoeDEsIHkxLCB4MiwgeTIpIHx8IGRpc3QodGVzdFgsIHRlc3RZLCBpeDIsIGl5MikgPCBkaXN0KHgxLCB5MSwgeDIsIHkyKSkge1xyXG5cdCAgICAgIHJldHVybiBbIFtpeDEsaXkxXSxbaXgyLGl5Ml0gXTtcclxuXHQgICAgfSBlbHNlIHtcclxuXHQgICAgICByZXR1cm4gZmFsc2U7XHJcblx0ICAgIH1cclxuXHQgIH1cclxufVxyXG5cclxuZnVuY3Rpb24gZGVjb2RlQmFzZTY0SW1hZ2UoZGF0YVN0cmluZykge1xyXG5cdCAgdmFyIG1hdGNoZXMgPSBkYXRhU3RyaW5nLm1hdGNoKC9eZGF0YTooW0EtWmEtei0rXFwvXSspO2Jhc2U2NCwoLispJC8pLFxyXG5cdCAgICByZXNwb25zZSA9IHt9O1xyXG5cdCAgaWYgKG1hdGNoZXMubGVuZ3RoICE9PSAzKSB7XHJcblx0ICAgIHJldHVybiBuZXcgRXJyb3IoJ0ludmFsaWQgaW5wdXQgc3RyaW5nJyk7XHJcblx0ICB9XHJcblx0ICByZXNwb25zZS50eXBlID0gbWF0Y2hlc1sxXTtcclxuXHQgIHJlc3BvbnNlLmRhdGEgPSBuZXcgQnVmZmVyKG1hdGNoZXNbMl0sICdiYXNlNjQnKTtcclxuXHQgIHJldHVybiByZXNwb25zZTtcclxuXHR9XHJcblxyXG4vLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5leHBvcnRzLm15VHJpbT1teVRyaW07XHJcbmV4cG9ydHMubXlUcmltQ29vcmRpbmF0ZT1teVRyaW1Db29yZGluYXRlO1xyXG5leHBvcnRzLmNsb3Nlc3RQcm9qZWN0aW9uT2ZQb2ludE9uTGluZT1jbG9zZXN0UHJvamVjdGlvbk9mUG9pbnRPbkxpbmU7XHJcbmV4cG9ydHMuY29sb3JMdW1pbmFuY2U9Y29sb3JMdW1pbmFuY2U7XHJcbmV4cG9ydHMuaW5jcmVhc2VCcmlnaHRuZXNzPWluY3JlYXNlQnJpZ2h0bmVzcztcclxuZXhwb3J0cy5jb2xvckFscGhhQXJyYXk9Y29sb3JBbHBoYUFycmF5O1xyXG5leHBvcnRzLmVzY2FwZUhUTUw9ZXNjYXBlSFRNTDtcclxuZXhwb3J0cy5mb3JtYXROdW1iZXIyPWZvcm1hdE51bWJlcjI7XHJcbmV4cG9ydHMuZm9ybWF0RGF0ZVRpbWU9Zm9ybWF0RGF0ZVRpbWU7XHJcbmV4cG9ydHMuZm9ybWF0RGF0ZVRpbWVTZWM9Zm9ybWF0RGF0ZVRpbWVTZWM7XHJcbmV4cG9ydHMuZm9ybWF0RGF0ZT1mb3JtYXREYXRlO1xyXG5leHBvcnRzLmZvcm1hdFRpbWU9Zm9ybWF0VGltZTtcclxuZXhwb3J0cy5yYWluYm93PXJhaW5ib3c7XHJcbmV4cG9ydHMubW9iaWxlQW5kVGFibGV0Q2hlY2s9bW9iaWxlQW5kVGFibGV0Q2hlY2s7XHJcbmV4cG9ydHMucmVuZGVyQXJyb3dCYXNlNjQ9cmVuZGVyQXJyb3dCYXNlNjQ7XHJcbmV4cG9ydHMucmVuZGVyRGlyZWN0aW9uQmFzZTY0PXJlbmRlckRpcmVjdGlvbkJhc2U2NDtcclxuZXhwb3J0cy5yZW5kZXJCb3hCYXNlNjQ9cmVuZGVyQm94QmFzZTY0O1xyXG5leHBvcnRzLmludGVyY2VwdE9uQ2lyY2xlPWludGVyY2VwdE9uQ2lyY2xlO1xyXG5leHBvcnRzLmRpc3RwPWRpc3RwO1xyXG5leHBvcnRzLmNpcmNsZUxpbmVJbnRlcnNlY3Q9Y2lyY2xlTGluZUludGVyc2VjdDtcclxuZXhwb3J0cy5NT0JJTEU9bW9iaWxlQW5kVGFibGV0Q2hlY2soKTtcclxuZXhwb3J0cy5XR1M4NFNQSEVSRT1uZXcgV0dTODRTcGhlcmUoNjM3ODEzNyk7XHJcbmV4cG9ydHMuZm9ybWF0VGltZVNlYz1mb3JtYXRUaW1lU2VjO1xyXG5leHBvcnRzLmRlY29kZUJhc2U2NEltYWdlPWRlY29kZUJhc2U2NEltYWdlO1xyXG5leHBvcnRzLmlzRGVmaW5lZD1pc0RlZmluZWQ7IiwibW9kdWxlLmV4cG9ydHMgPSB7XG4gICAgUkJUcmVlOiByZXF1aXJlKCcuL2xpYi9yYnRyZWUnKSxcbiAgICBCaW5UcmVlOiByZXF1aXJlKCcuL2xpYi9iaW50cmVlJylcbn07XG4iLCJcbnZhciBUcmVlQmFzZSA9IHJlcXVpcmUoJy4vdHJlZWJhc2UnKTtcblxuZnVuY3Rpb24gTm9kZShkYXRhKSB7XG4gICAgdGhpcy5kYXRhID0gZGF0YTtcbiAgICB0aGlzLmxlZnQgPSBudWxsO1xuICAgIHRoaXMucmlnaHQgPSBudWxsO1xufVxuXG5Ob2RlLnByb3RvdHlwZS5nZXRfY2hpbGQgPSBmdW5jdGlvbihkaXIpIHtcbiAgICByZXR1cm4gZGlyID8gdGhpcy5yaWdodCA6IHRoaXMubGVmdDtcbn07XG5cbk5vZGUucHJvdG90eXBlLnNldF9jaGlsZCA9IGZ1bmN0aW9uKGRpciwgdmFsKSB7XG4gICAgaWYoZGlyKSB7XG4gICAgICAgIHRoaXMucmlnaHQgPSB2YWw7XG4gICAgfVxuICAgIGVsc2Uge1xuICAgICAgICB0aGlzLmxlZnQgPSB2YWw7XG4gICAgfVxufTtcblxuZnVuY3Rpb24gQmluVHJlZShjb21wYXJhdG9yKSB7XG4gICAgdGhpcy5fcm9vdCA9IG51bGw7XG4gICAgdGhpcy5fY29tcGFyYXRvciA9IGNvbXBhcmF0b3I7XG4gICAgdGhpcy5zaXplID0gMDtcbn1cblxuQmluVHJlZS5wcm90b3R5cGUgPSBuZXcgVHJlZUJhc2UoKTtcblxuLy8gcmV0dXJucyB0cnVlIGlmIGluc2VydGVkLCBmYWxzZSBpZiBkdXBsaWNhdGVcbkJpblRyZWUucHJvdG90eXBlLmluc2VydCA9IGZ1bmN0aW9uKGRhdGEpIHtcbiAgICBpZih0aGlzLl9yb290ID09PSBudWxsKSB7XG4gICAgICAgIC8vIGVtcHR5IHRyZWVcbiAgICAgICAgdGhpcy5fcm9vdCA9IG5ldyBOb2RlKGRhdGEpO1xuICAgICAgICB0aGlzLnNpemUrKztcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuXG4gICAgdmFyIGRpciA9IDA7XG5cbiAgICAvLyBzZXR1cFxuICAgIHZhciBwID0gbnVsbDsgLy8gcGFyZW50XG4gICAgdmFyIG5vZGUgPSB0aGlzLl9yb290O1xuXG4gICAgLy8gc2VhcmNoIGRvd25cbiAgICB3aGlsZSh0cnVlKSB7XG4gICAgICAgIGlmKG5vZGUgPT09IG51bGwpIHtcbiAgICAgICAgICAgIC8vIGluc2VydCBuZXcgbm9kZSBhdCB0aGUgYm90dG9tXG4gICAgICAgICAgICBub2RlID0gbmV3IE5vZGUoZGF0YSk7XG4gICAgICAgICAgICBwLnNldF9jaGlsZChkaXIsIG5vZGUpO1xuICAgICAgICAgICAgcmV0ID0gdHJ1ZTtcbiAgICAgICAgICAgIHRoaXMuc2l6ZSsrO1xuICAgICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBzdG9wIGlmIGZvdW5kXG4gICAgICAgIGlmKHRoaXMuX2NvbXBhcmF0b3Iobm9kZS5kYXRhLCBkYXRhKSA9PT0gMCkge1xuICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG5cbiAgICAgICAgZGlyID0gdGhpcy5fY29tcGFyYXRvcihub2RlLmRhdGEsIGRhdGEpIDwgMDtcblxuICAgICAgICAvLyB1cGRhdGUgaGVscGVyc1xuICAgICAgICBwID0gbm9kZTtcbiAgICAgICAgbm9kZSA9IG5vZGUuZ2V0X2NoaWxkKGRpcik7XG4gICAgfVxufTtcblxuLy8gcmV0dXJucyB0cnVlIGlmIHJlbW92ZWQsIGZhbHNlIGlmIG5vdCBmb3VuZFxuQmluVHJlZS5wcm90b3R5cGUucmVtb3ZlID0gZnVuY3Rpb24oZGF0YSkge1xuICAgIGlmKHRoaXMuX3Jvb3QgPT09IG51bGwpIHtcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cblxuICAgIHZhciBoZWFkID0gbmV3IE5vZGUodW5kZWZpbmVkKTsgLy8gZmFrZSB0cmVlIHJvb3RcbiAgICB2YXIgbm9kZSA9IGhlYWQ7XG4gICAgbm9kZS5yaWdodCA9IHRoaXMuX3Jvb3Q7XG4gICAgdmFyIHAgPSBudWxsOyAvLyBwYXJlbnRcbiAgICB2YXIgZm91bmQgPSBudWxsOyAvLyBmb3VuZCBpdGVtXG4gICAgdmFyIGRpciA9IDE7XG5cbiAgICB3aGlsZShub2RlLmdldF9jaGlsZChkaXIpICE9PSBudWxsKSB7XG4gICAgICAgIHAgPSBub2RlO1xuICAgICAgICBub2RlID0gbm9kZS5nZXRfY2hpbGQoZGlyKTtcbiAgICAgICAgdmFyIGNtcCA9IHRoaXMuX2NvbXBhcmF0b3IoZGF0YSwgbm9kZS5kYXRhKTtcbiAgICAgICAgZGlyID0gY21wID4gMDtcblxuICAgICAgICBpZihjbXAgPT09IDApIHtcbiAgICAgICAgICAgIGZvdW5kID0gbm9kZTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGlmKGZvdW5kICE9PSBudWxsKSB7XG4gICAgICAgIGZvdW5kLmRhdGEgPSBub2RlLmRhdGE7XG4gICAgICAgIHAuc2V0X2NoaWxkKHAucmlnaHQgPT09IG5vZGUsIG5vZGUuZ2V0X2NoaWxkKG5vZGUubGVmdCA9PT0gbnVsbCkpO1xuXG4gICAgICAgIHRoaXMuX3Jvb3QgPSBoZWFkLnJpZ2h0O1xuICAgICAgICB0aGlzLnNpemUtLTtcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuICAgIGVsc2Uge1xuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxufTtcblxubW9kdWxlLmV4cG9ydHMgPSBCaW5UcmVlO1xuXG4iLCJcbnZhciBUcmVlQmFzZSA9IHJlcXVpcmUoJy4vdHJlZWJhc2UnKTtcblxuZnVuY3Rpb24gTm9kZShkYXRhKSB7XG4gICAgdGhpcy5kYXRhID0gZGF0YTtcbiAgICB0aGlzLmxlZnQgPSBudWxsO1xuICAgIHRoaXMucmlnaHQgPSBudWxsO1xuICAgIHRoaXMucmVkID0gdHJ1ZTtcbn1cblxuTm9kZS5wcm90b3R5cGUuZ2V0X2NoaWxkID0gZnVuY3Rpb24oZGlyKSB7XG4gICAgcmV0dXJuIGRpciA/IHRoaXMucmlnaHQgOiB0aGlzLmxlZnQ7XG59O1xuXG5Ob2RlLnByb3RvdHlwZS5zZXRfY2hpbGQgPSBmdW5jdGlvbihkaXIsIHZhbCkge1xuICAgIGlmKGRpcikge1xuICAgICAgICB0aGlzLnJpZ2h0ID0gdmFsO1xuICAgIH1cbiAgICBlbHNlIHtcbiAgICAgICAgdGhpcy5sZWZ0ID0gdmFsO1xuICAgIH1cbn07XG5cbmZ1bmN0aW9uIFJCVHJlZShjb21wYXJhdG9yKSB7XG4gICAgdGhpcy5fcm9vdCA9IG51bGw7XG4gICAgdGhpcy5fY29tcGFyYXRvciA9IGNvbXBhcmF0b3I7XG4gICAgdGhpcy5zaXplID0gMDtcbn1cblxuUkJUcmVlLnByb3RvdHlwZSA9IG5ldyBUcmVlQmFzZSgpO1xuXG4vLyByZXR1cm5zIHRydWUgaWYgaW5zZXJ0ZWQsIGZhbHNlIGlmIGR1cGxpY2F0ZVxuUkJUcmVlLnByb3RvdHlwZS5pbnNlcnQgPSBmdW5jdGlvbihkYXRhKSB7XG4gICAgdmFyIHJldCA9IGZhbHNlO1xuXG4gICAgaWYodGhpcy5fcm9vdCA9PT0gbnVsbCkge1xuICAgICAgICAvLyBlbXB0eSB0cmVlXG4gICAgICAgIHRoaXMuX3Jvb3QgPSBuZXcgTm9kZShkYXRhKTtcbiAgICAgICAgcmV0ID0gdHJ1ZTtcbiAgICAgICAgdGhpcy5zaXplKys7XG4gICAgfVxuICAgIGVsc2Uge1xuICAgICAgICB2YXIgaGVhZCA9IG5ldyBOb2RlKHVuZGVmaW5lZCk7IC8vIGZha2UgdHJlZSByb290XG5cbiAgICAgICAgdmFyIGRpciA9IDA7XG4gICAgICAgIHZhciBsYXN0ID0gMDtcblxuICAgICAgICAvLyBzZXR1cFxuICAgICAgICB2YXIgZ3AgPSBudWxsOyAvLyBncmFuZHBhcmVudFxuICAgICAgICB2YXIgZ2dwID0gaGVhZDsgLy8gZ3JhbmQtZ3JhbmQtcGFyZW50XG4gICAgICAgIHZhciBwID0gbnVsbDsgLy8gcGFyZW50XG4gICAgICAgIHZhciBub2RlID0gdGhpcy5fcm9vdDtcbiAgICAgICAgZ2dwLnJpZ2h0ID0gdGhpcy5fcm9vdDtcblxuICAgICAgICAvLyBzZWFyY2ggZG93blxuICAgICAgICB3aGlsZSh0cnVlKSB7XG4gICAgICAgICAgICBpZihub2RlID09PSBudWxsKSB7XG4gICAgICAgICAgICAgICAgLy8gaW5zZXJ0IG5ldyBub2RlIGF0IHRoZSBib3R0b21cbiAgICAgICAgICAgICAgICBub2RlID0gbmV3IE5vZGUoZGF0YSk7XG4gICAgICAgICAgICAgICAgcC5zZXRfY2hpbGQoZGlyLCBub2RlKTtcbiAgICAgICAgICAgICAgICByZXQgPSB0cnVlO1xuICAgICAgICAgICAgICAgIHRoaXMuc2l6ZSsrO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZSBpZihpc19yZWQobm9kZS5sZWZ0KSAmJiBpc19yZWQobm9kZS5yaWdodCkpIHtcbiAgICAgICAgICAgICAgICAvLyBjb2xvciBmbGlwXG4gICAgICAgICAgICAgICAgbm9kZS5yZWQgPSB0cnVlO1xuICAgICAgICAgICAgICAgIG5vZGUubGVmdC5yZWQgPSBmYWxzZTtcbiAgICAgICAgICAgICAgICBub2RlLnJpZ2h0LnJlZCA9IGZhbHNlO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBmaXggcmVkIHZpb2xhdGlvblxuICAgICAgICAgICAgaWYoaXNfcmVkKG5vZGUpICYmIGlzX3JlZChwKSkge1xuICAgICAgICAgICAgICAgIHZhciBkaXIyID0gZ2dwLnJpZ2h0ID09PSBncDtcblxuICAgICAgICAgICAgICAgIGlmKG5vZGUgPT09IHAuZ2V0X2NoaWxkKGxhc3QpKSB7XG4gICAgICAgICAgICAgICAgICAgIGdncC5zZXRfY2hpbGQoZGlyMiwgc2luZ2xlX3JvdGF0ZShncCwgIWxhc3QpKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIGdncC5zZXRfY2hpbGQoZGlyMiwgZG91YmxlX3JvdGF0ZShncCwgIWxhc3QpKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHZhciBjbXAgPSB0aGlzLl9jb21wYXJhdG9yKG5vZGUuZGF0YSwgZGF0YSk7XG5cbiAgICAgICAgICAgIC8vIHN0b3AgaWYgZm91bmRcbiAgICAgICAgICAgIGlmKGNtcCA9PT0gMCkge1xuICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBsYXN0ID0gZGlyO1xuICAgICAgICAgICAgZGlyID0gY21wIDwgMDtcblxuICAgICAgICAgICAgLy8gdXBkYXRlIGhlbHBlcnNcbiAgICAgICAgICAgIGlmKGdwICE9PSBudWxsKSB7XG4gICAgICAgICAgICAgICAgZ2dwID0gZ3A7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBncCA9IHA7XG4gICAgICAgICAgICBwID0gbm9kZTtcbiAgICAgICAgICAgIG5vZGUgPSBub2RlLmdldF9jaGlsZChkaXIpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gdXBkYXRlIHJvb3RcbiAgICAgICAgdGhpcy5fcm9vdCA9IGhlYWQucmlnaHQ7XG4gICAgfVxuXG4gICAgLy8gbWFrZSByb290IGJsYWNrXG4gICAgdGhpcy5fcm9vdC5yZWQgPSBmYWxzZTtcblxuICAgIHJldHVybiByZXQ7XG59O1xuXG4vLyByZXR1cm5zIHRydWUgaWYgcmVtb3ZlZCwgZmFsc2UgaWYgbm90IGZvdW5kXG5SQlRyZWUucHJvdG90eXBlLnJlbW92ZSA9IGZ1bmN0aW9uKGRhdGEpIHtcbiAgICBpZih0aGlzLl9yb290ID09PSBudWxsKSB7XG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG5cbiAgICB2YXIgaGVhZCA9IG5ldyBOb2RlKHVuZGVmaW5lZCk7IC8vIGZha2UgdHJlZSByb290XG4gICAgdmFyIG5vZGUgPSBoZWFkO1xuICAgIG5vZGUucmlnaHQgPSB0aGlzLl9yb290O1xuICAgIHZhciBwID0gbnVsbDsgLy8gcGFyZW50XG4gICAgdmFyIGdwID0gbnVsbDsgLy8gZ3JhbmQgcGFyZW50XG4gICAgdmFyIGZvdW5kID0gbnVsbDsgLy8gZm91bmQgaXRlbVxuICAgIHZhciBkaXIgPSAxO1xuXG4gICAgd2hpbGUobm9kZS5nZXRfY2hpbGQoZGlyKSAhPT0gbnVsbCkge1xuICAgICAgICB2YXIgbGFzdCA9IGRpcjtcblxuICAgICAgICAvLyB1cGRhdGUgaGVscGVyc1xuICAgICAgICBncCA9IHA7XG4gICAgICAgIHAgPSBub2RlO1xuICAgICAgICBub2RlID0gbm9kZS5nZXRfY2hpbGQoZGlyKTtcblxuICAgICAgICB2YXIgY21wID0gdGhpcy5fY29tcGFyYXRvcihkYXRhLCBub2RlLmRhdGEpO1xuXG4gICAgICAgIGRpciA9IGNtcCA+IDA7XG5cbiAgICAgICAgLy8gc2F2ZSBmb3VuZCBub2RlXG4gICAgICAgIGlmKGNtcCA9PT0gMCkge1xuICAgICAgICAgICAgZm91bmQgPSBub2RlO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gcHVzaCB0aGUgcmVkIG5vZGUgZG93blxuICAgICAgICBpZighaXNfcmVkKG5vZGUpICYmICFpc19yZWQobm9kZS5nZXRfY2hpbGQoZGlyKSkpIHtcbiAgICAgICAgICAgIGlmKGlzX3JlZChub2RlLmdldF9jaGlsZCghZGlyKSkpIHtcbiAgICAgICAgICAgICAgICB2YXIgc3IgPSBzaW5nbGVfcm90YXRlKG5vZGUsIGRpcik7XG4gICAgICAgICAgICAgICAgcC5zZXRfY2hpbGQobGFzdCwgc3IpO1xuICAgICAgICAgICAgICAgIHAgPSBzcjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGVsc2UgaWYoIWlzX3JlZChub2RlLmdldF9jaGlsZCghZGlyKSkpIHtcbiAgICAgICAgICAgICAgICB2YXIgc2libGluZyA9IHAuZ2V0X2NoaWxkKCFsYXN0KTtcbiAgICAgICAgICAgICAgICBpZihzaWJsaW5nICE9PSBudWxsKSB7XG4gICAgICAgICAgICAgICAgICAgIGlmKCFpc19yZWQoc2libGluZy5nZXRfY2hpbGQoIWxhc3QpKSAmJiAhaXNfcmVkKHNpYmxpbmcuZ2V0X2NoaWxkKGxhc3QpKSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgLy8gY29sb3IgZmxpcFxuICAgICAgICAgICAgICAgICAgICAgICAgcC5yZWQgPSBmYWxzZTtcbiAgICAgICAgICAgICAgICAgICAgICAgIHNpYmxpbmcucmVkID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICAgICAgICAgIG5vZGUucmVkID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHZhciBkaXIyID0gZ3AucmlnaHQgPT09IHA7XG5cbiAgICAgICAgICAgICAgICAgICAgICAgIGlmKGlzX3JlZChzaWJsaW5nLmdldF9jaGlsZChsYXN0KSkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBncC5zZXRfY2hpbGQoZGlyMiwgZG91YmxlX3JvdGF0ZShwLCBsYXN0KSk7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICBlbHNlIGlmKGlzX3JlZChzaWJsaW5nLmdldF9jaGlsZCghbGFzdCkpKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZ3Auc2V0X2NoaWxkKGRpcjIsIHNpbmdsZV9yb3RhdGUocCwgbGFzdCkpO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBlbnN1cmUgY29ycmVjdCBjb2xvcmluZ1xuICAgICAgICAgICAgICAgICAgICAgICAgdmFyIGdwYyA9IGdwLmdldF9jaGlsZChkaXIyKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGdwYy5yZWQgPSB0cnVlO1xuICAgICAgICAgICAgICAgICAgICAgICAgbm9kZS5yZWQgPSB0cnVlO1xuICAgICAgICAgICAgICAgICAgICAgICAgZ3BjLmxlZnQucmVkID0gZmFsc2U7XG4gICAgICAgICAgICAgICAgICAgICAgICBncGMucmlnaHQucmVkID0gZmFsc2U7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvLyByZXBsYWNlIGFuZCByZW1vdmUgaWYgZm91bmRcbiAgICBpZihmb3VuZCAhPT0gbnVsbCkge1xuICAgICAgICBmb3VuZC5kYXRhID0gbm9kZS5kYXRhO1xuICAgICAgICBwLnNldF9jaGlsZChwLnJpZ2h0ID09PSBub2RlLCBub2RlLmdldF9jaGlsZChub2RlLmxlZnQgPT09IG51bGwpKTtcbiAgICAgICAgdGhpcy5zaXplLS07XG4gICAgfVxuXG4gICAgLy8gdXBkYXRlIHJvb3QgYW5kIG1ha2UgaXQgYmxhY2tcbiAgICB0aGlzLl9yb290ID0gaGVhZC5yaWdodDtcbiAgICBpZih0aGlzLl9yb290ICE9PSBudWxsKSB7XG4gICAgICAgIHRoaXMuX3Jvb3QucmVkID0gZmFsc2U7XG4gICAgfVxuXG4gICAgcmV0dXJuIGZvdW5kICE9PSBudWxsO1xufTtcblxuZnVuY3Rpb24gaXNfcmVkKG5vZGUpIHtcbiAgICByZXR1cm4gbm9kZSAhPT0gbnVsbCAmJiBub2RlLnJlZDtcbn1cblxuZnVuY3Rpb24gc2luZ2xlX3JvdGF0ZShyb290LCBkaXIpIHtcbiAgICB2YXIgc2F2ZSA9IHJvb3QuZ2V0X2NoaWxkKCFkaXIpO1xuXG4gICAgcm9vdC5zZXRfY2hpbGQoIWRpciwgc2F2ZS5nZXRfY2hpbGQoZGlyKSk7XG4gICAgc2F2ZS5zZXRfY2hpbGQoZGlyLCByb290KTtcblxuICAgIHJvb3QucmVkID0gdHJ1ZTtcbiAgICBzYXZlLnJlZCA9IGZhbHNlO1xuXG4gICAgcmV0dXJuIHNhdmU7XG59XG5cbmZ1bmN0aW9uIGRvdWJsZV9yb3RhdGUocm9vdCwgZGlyKSB7XG4gICAgcm9vdC5zZXRfY2hpbGQoIWRpciwgc2luZ2xlX3JvdGF0ZShyb290LmdldF9jaGlsZCghZGlyKSwgIWRpcikpO1xuICAgIHJldHVybiBzaW5nbGVfcm90YXRlKHJvb3QsIGRpcik7XG59XG5cbm1vZHVsZS5leHBvcnRzID0gUkJUcmVlO1xuIiwiXG5mdW5jdGlvbiBUcmVlQmFzZSgpIHt9XG5cbi8vIHJlbW92ZXMgYWxsIG5vZGVzIGZyb20gdGhlIHRyZWVcblRyZWVCYXNlLnByb3RvdHlwZS5jbGVhciA9IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMuX3Jvb3QgPSBudWxsO1xuICAgIHRoaXMuc2l6ZSA9IDA7XG59O1xuXG4vLyByZXR1cm5zIG5vZGUgZGF0YSBpZiBmb3VuZCwgbnVsbCBvdGhlcndpc2VcblRyZWVCYXNlLnByb3RvdHlwZS5maW5kID0gZnVuY3Rpb24oZGF0YSkge1xuICAgIHZhciByZXMgPSB0aGlzLl9yb290O1xuXG4gICAgd2hpbGUocmVzICE9PSBudWxsKSB7XG4gICAgICAgIHZhciBjID0gdGhpcy5fY29tcGFyYXRvcihkYXRhLCByZXMuZGF0YSk7XG4gICAgICAgIGlmKGMgPT09IDApIHtcbiAgICAgICAgICAgIHJldHVybiByZXMuZGF0YTtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgIHJlcyA9IHJlcy5nZXRfY2hpbGQoYyA+IDApO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIG51bGw7XG59O1xuXG4vLyByZXR1cm5zIGl0ZXJhdG9yIHRvIG5vZGUgaWYgZm91bmQsIG51bGwgb3RoZXJ3aXNlXG5UcmVlQmFzZS5wcm90b3R5cGUuZmluZEl0ZXIgPSBmdW5jdGlvbihkYXRhKSB7XG4gICAgdmFyIHJlcyA9IHRoaXMuX3Jvb3Q7XG4gICAgdmFyIGl0ZXIgPSB0aGlzLml0ZXJhdG9yKCk7XG5cbiAgICB3aGlsZShyZXMgIT09IG51bGwpIHtcbiAgICAgICAgdmFyIGMgPSB0aGlzLl9jb21wYXJhdG9yKGRhdGEsIHJlcy5kYXRhKTtcbiAgICAgICAgaWYoYyA9PT0gMCkge1xuICAgICAgICAgICAgaXRlci5fY3Vyc29yID0gcmVzO1xuICAgICAgICAgICAgcmV0dXJuIGl0ZXI7XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICBpdGVyLl9hbmNlc3RvcnMucHVzaChyZXMpO1xuICAgICAgICAgICAgcmVzID0gcmVzLmdldF9jaGlsZChjID4gMCk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gbnVsbDtcbn07XG5cbi8vIFJldHVybnMgYW4gaXRlcmF0b3IgdG8gdGhlIHRyZWUgbm9kZSBhdCBvciBpbW1lZGlhdGVseSBhZnRlciB0aGUgaXRlbVxuVHJlZUJhc2UucHJvdG90eXBlLmxvd2VyQm91bmQgPSBmdW5jdGlvbihpdGVtKSB7XG4gICAgdmFyIGN1ciA9IHRoaXMuX3Jvb3Q7XG4gICAgdmFyIGl0ZXIgPSB0aGlzLml0ZXJhdG9yKCk7XG4gICAgdmFyIGNtcCA9IHRoaXMuX2NvbXBhcmF0b3I7XG5cbiAgICB3aGlsZShjdXIgIT09IG51bGwpIHtcbiAgICAgICAgdmFyIGMgPSBjbXAoaXRlbSwgY3VyLmRhdGEpO1xuICAgICAgICBpZihjID09PSAwKSB7XG4gICAgICAgICAgICBpdGVyLl9jdXJzb3IgPSBjdXI7XG4gICAgICAgICAgICByZXR1cm4gaXRlcjtcbiAgICAgICAgfVxuICAgICAgICBpdGVyLl9hbmNlc3RvcnMucHVzaChjdXIpO1xuICAgICAgICBjdXIgPSBjdXIuZ2V0X2NoaWxkKGMgPiAwKTtcbiAgICB9XG5cbiAgICBmb3IodmFyIGk9aXRlci5fYW5jZXN0b3JzLmxlbmd0aCAtIDE7IGkgPj0gMDsgLS1pKSB7XG4gICAgICAgIGN1ciA9IGl0ZXIuX2FuY2VzdG9yc1tpXTtcbiAgICAgICAgaWYoY21wKGl0ZW0sIGN1ci5kYXRhKSA8IDApIHtcbiAgICAgICAgICAgIGl0ZXIuX2N1cnNvciA9IGN1cjtcbiAgICAgICAgICAgIGl0ZXIuX2FuY2VzdG9ycy5sZW5ndGggPSBpO1xuICAgICAgICAgICAgcmV0dXJuIGl0ZXI7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBpdGVyLl9hbmNlc3RvcnMubGVuZ3RoID0gMDtcbiAgICByZXR1cm4gaXRlcjtcbn07XG5cbi8vIFJldHVybnMgYW4gaXRlcmF0b3IgdG8gdGhlIHRyZWUgbm9kZSBpbW1lZGlhdGVseSBhZnRlciB0aGUgaXRlbVxuVHJlZUJhc2UucHJvdG90eXBlLnVwcGVyQm91bmQgPSBmdW5jdGlvbihpdGVtKSB7XG4gICAgdmFyIGl0ZXIgPSB0aGlzLmxvd2VyQm91bmQoaXRlbSk7XG4gICAgdmFyIGNtcCA9IHRoaXMuX2NvbXBhcmF0b3I7XG5cbiAgICB3aGlsZShpdGVyLmRhdGEoKSAhPT0gbnVsbCAmJiBjbXAoaXRlci5kYXRhKCksIGl0ZW0pID09PSAwKSB7XG4gICAgICAgIGl0ZXIubmV4dCgpO1xuICAgIH1cblxuICAgIHJldHVybiBpdGVyO1xufTtcblxuLy8gcmV0dXJucyBudWxsIGlmIHRyZWUgaXMgZW1wdHlcblRyZWVCYXNlLnByb3RvdHlwZS5taW4gPSBmdW5jdGlvbigpIHtcbiAgICB2YXIgcmVzID0gdGhpcy5fcm9vdDtcbiAgICBpZihyZXMgPT09IG51bGwpIHtcbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuXG4gICAgd2hpbGUocmVzLmxlZnQgIT09IG51bGwpIHtcbiAgICAgICAgcmVzID0gcmVzLmxlZnQ7XG4gICAgfVxuXG4gICAgcmV0dXJuIHJlcy5kYXRhO1xufTtcblxuLy8gcmV0dXJucyBudWxsIGlmIHRyZWUgaXMgZW1wdHlcblRyZWVCYXNlLnByb3RvdHlwZS5tYXggPSBmdW5jdGlvbigpIHtcbiAgICB2YXIgcmVzID0gdGhpcy5fcm9vdDtcbiAgICBpZihyZXMgPT09IG51bGwpIHtcbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuXG4gICAgd2hpbGUocmVzLnJpZ2h0ICE9PSBudWxsKSB7XG4gICAgICAgIHJlcyA9IHJlcy5yaWdodDtcbiAgICB9XG5cbiAgICByZXR1cm4gcmVzLmRhdGE7XG59O1xuXG4vLyByZXR1cm5zIGEgbnVsbCBpdGVyYXRvclxuLy8gY2FsbCBuZXh0KCkgb3IgcHJldigpIHRvIHBvaW50IHRvIGFuIGVsZW1lbnRcblRyZWVCYXNlLnByb3RvdHlwZS5pdGVyYXRvciA9IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiBuZXcgSXRlcmF0b3IodGhpcyk7XG59O1xuXG4vLyBjYWxscyBjYiBvbiBlYWNoIG5vZGUncyBkYXRhLCBpbiBvcmRlclxuVHJlZUJhc2UucHJvdG90eXBlLmVhY2ggPSBmdW5jdGlvbihjYikge1xuICAgIHZhciBpdD10aGlzLml0ZXJhdG9yKCksIGRhdGE7XG4gICAgd2hpbGUoKGRhdGEgPSBpdC5uZXh0KCkpICE9PSBudWxsKSB7XG4gICAgICAgIGNiKGRhdGEpO1xuICAgIH1cbn07XG5cbi8vIGNhbGxzIGNiIG9uIGVhY2ggbm9kZSdzIGRhdGEsIGluIHJldmVyc2Ugb3JkZXJcblRyZWVCYXNlLnByb3RvdHlwZS5yZWFjaCA9IGZ1bmN0aW9uKGNiKSB7XG4gICAgdmFyIGl0PXRoaXMuaXRlcmF0b3IoKSwgZGF0YTtcbiAgICB3aGlsZSgoZGF0YSA9IGl0LnByZXYoKSkgIT09IG51bGwpIHtcbiAgICAgICAgY2IoZGF0YSk7XG4gICAgfVxufTtcblxuXG5mdW5jdGlvbiBJdGVyYXRvcih0cmVlKSB7XG4gICAgdGhpcy5fdHJlZSA9IHRyZWU7XG4gICAgdGhpcy5fYW5jZXN0b3JzID0gW107XG4gICAgdGhpcy5fY3Vyc29yID0gbnVsbDtcbn1cblxuSXRlcmF0b3IucHJvdG90eXBlLmRhdGEgPSBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gdGhpcy5fY3Vyc29yICE9PSBudWxsID8gdGhpcy5fY3Vyc29yLmRhdGEgOiBudWxsO1xufTtcblxuLy8gaWYgbnVsbC1pdGVyYXRvciwgcmV0dXJucyBmaXJzdCBub2RlXG4vLyBvdGhlcndpc2UsIHJldHVybnMgbmV4dCBub2RlXG5JdGVyYXRvci5wcm90b3R5cGUubmV4dCA9IGZ1bmN0aW9uKCkge1xuICAgIGlmKHRoaXMuX2N1cnNvciA9PT0gbnVsbCkge1xuICAgICAgICB2YXIgcm9vdCA9IHRoaXMuX3RyZWUuX3Jvb3Q7XG4gICAgICAgIGlmKHJvb3QgIT09IG51bGwpIHtcbiAgICAgICAgICAgIHRoaXMuX21pbk5vZGUocm9vdCk7XG4gICAgICAgIH1cbiAgICB9XG4gICAgZWxzZSB7XG4gICAgICAgIGlmKHRoaXMuX2N1cnNvci5yaWdodCA9PT0gbnVsbCkge1xuICAgICAgICAgICAgLy8gbm8gZ3JlYXRlciBub2RlIGluIHN1YnRyZWUsIGdvIHVwIHRvIHBhcmVudFxuICAgICAgICAgICAgLy8gaWYgY29taW5nIGZyb20gYSByaWdodCBjaGlsZCwgY29udGludWUgdXAgdGhlIHN0YWNrXG4gICAgICAgICAgICB2YXIgc2F2ZTtcbiAgICAgICAgICAgIGRvIHtcbiAgICAgICAgICAgICAgICBzYXZlID0gdGhpcy5fY3Vyc29yO1xuICAgICAgICAgICAgICAgIGlmKHRoaXMuX2FuY2VzdG9ycy5sZW5ndGgpIHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5fY3Vyc29yID0gdGhpcy5fYW5jZXN0b3JzLnBvcCgpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5fY3Vyc29yID0gbnVsbDtcbiAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSB3aGlsZSh0aGlzLl9jdXJzb3IucmlnaHQgPT09IHNhdmUpO1xuICAgICAgICB9XG4gICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgLy8gZ2V0IHRoZSBuZXh0IG5vZGUgZnJvbSB0aGUgc3VidHJlZVxuICAgICAgICAgICAgdGhpcy5fYW5jZXN0b3JzLnB1c2godGhpcy5fY3Vyc29yKTtcbiAgICAgICAgICAgIHRoaXMuX21pbk5vZGUodGhpcy5fY3Vyc29yLnJpZ2h0KTtcbiAgICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gdGhpcy5fY3Vyc29yICE9PSBudWxsID8gdGhpcy5fY3Vyc29yLmRhdGEgOiBudWxsO1xufTtcblxuLy8gaWYgbnVsbC1pdGVyYXRvciwgcmV0dXJucyBsYXN0IG5vZGVcbi8vIG90aGVyd2lzZSwgcmV0dXJucyBwcmV2aW91cyBub2RlXG5JdGVyYXRvci5wcm90b3R5cGUucHJldiA9IGZ1bmN0aW9uKCkge1xuICAgIGlmKHRoaXMuX2N1cnNvciA9PT0gbnVsbCkge1xuICAgICAgICB2YXIgcm9vdCA9IHRoaXMuX3RyZWUuX3Jvb3Q7XG4gICAgICAgIGlmKHJvb3QgIT09IG51bGwpIHtcbiAgICAgICAgICAgIHRoaXMuX21heE5vZGUocm9vdCk7XG4gICAgICAgIH1cbiAgICB9XG4gICAgZWxzZSB7XG4gICAgICAgIGlmKHRoaXMuX2N1cnNvci5sZWZ0ID09PSBudWxsKSB7XG4gICAgICAgICAgICB2YXIgc2F2ZTtcbiAgICAgICAgICAgIGRvIHtcbiAgICAgICAgICAgICAgICBzYXZlID0gdGhpcy5fY3Vyc29yO1xuICAgICAgICAgICAgICAgIGlmKHRoaXMuX2FuY2VzdG9ycy5sZW5ndGgpIHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5fY3Vyc29yID0gdGhpcy5fYW5jZXN0b3JzLnBvcCgpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5fY3Vyc29yID0gbnVsbDtcbiAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSB3aGlsZSh0aGlzLl9jdXJzb3IubGVmdCA9PT0gc2F2ZSk7XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICB0aGlzLl9hbmNlc3RvcnMucHVzaCh0aGlzLl9jdXJzb3IpO1xuICAgICAgICAgICAgdGhpcy5fbWF4Tm9kZSh0aGlzLl9jdXJzb3IubGVmdCk7XG4gICAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIHRoaXMuX2N1cnNvciAhPT0gbnVsbCA/IHRoaXMuX2N1cnNvci5kYXRhIDogbnVsbDtcbn07XG5cbkl0ZXJhdG9yLnByb3RvdHlwZS5fbWluTm9kZSA9IGZ1bmN0aW9uKHN0YXJ0KSB7XG4gICAgd2hpbGUoc3RhcnQubGVmdCAhPT0gbnVsbCkge1xuICAgICAgICB0aGlzLl9hbmNlc3RvcnMucHVzaChzdGFydCk7XG4gICAgICAgIHN0YXJ0ID0gc3RhcnQubGVmdDtcbiAgICB9XG4gICAgdGhpcy5fY3Vyc29yID0gc3RhcnQ7XG59O1xuXG5JdGVyYXRvci5wcm90b3R5cGUuX21heE5vZGUgPSBmdW5jdGlvbihzdGFydCkge1xuICAgIHdoaWxlKHN0YXJ0LnJpZ2h0ICE9PSBudWxsKSB7XG4gICAgICAgIHRoaXMuX2FuY2VzdG9ycy5wdXNoKHN0YXJ0KTtcbiAgICAgICAgc3RhcnQgPSBzdGFydC5yaWdodDtcbiAgICB9XG4gICAgdGhpcy5fY3Vyc29yID0gc3RhcnQ7XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IFRyZWVCYXNlO1xuXG4iLCI7IWZ1bmN0aW9uICgpIHs7XG52YXIgSm9vc2UgPSB7fVxuXG4vLyBjb25maWd1cmF0aW9uIGhhc2hcblxuSm9vc2UuQyAgICAgICAgICAgICA9IHR5cGVvZiBKT09TRV9DRkcgIT0gJ3VuZGVmaW5lZCcgPyBKT09TRV9DRkcgOiB7fVxuXG5Kb29zZS5pc19JRSAgICAgICAgID0gJ1xcdicgPT0gJ3YnXG5Kb29zZS5pc19Ob2RlSlMgICAgID0gQm9vbGVhbih0eXBlb2YgcHJvY2VzcyAhPSAndW5kZWZpbmVkJyAmJiBwcm9jZXNzLnBpZClcblxuXG5Kb29zZS50b3AgICAgICAgICAgID0gSm9vc2UuaXNfTm9kZUpTICYmIGdsb2JhbCB8fCB0aGlzXG5cbkpvb3NlLnN0dWIgICAgICAgICAgPSBmdW5jdGlvbiAoKSB7XG4gICAgcmV0dXJuIGZ1bmN0aW9uICgpIHsgdGhyb3cgbmV3IEVycm9yKFwiTW9kdWxlcyBjYW4gbm90IGJlIGluc3RhbnRpYXRlZFwiKSB9XG59XG5cblxuSm9vc2UuVkVSU0lPTiAgICAgICA9ICh7IC8qUEtHVkVSU0lPTiovVkVSU0lPTiA6ICczLjUwLjAnIH0pLlZFUlNJT05cblxuXG5pZiAodHlwZW9mIG1vZHVsZSAhPSAndW5kZWZpbmVkJykgbW9kdWxlLmV4cG9ydHMgPSBKb29zZVxuLyppZiAoIUpvb3NlLmlzX05vZGVKUykgKi9cbnRoaXMuSm9vc2UgPSBKb29zZVxuXG5cbi8vIFN0YXRpYyBoZWxwZXJzIGZvciBBcnJheXNcbkpvb3NlLkEgPSB7XG5cbiAgICBlYWNoIDogZnVuY3Rpb24gKGFycmF5LCBmdW5jLCBzY29wZSkge1xuICAgICAgICBzY29wZSA9IHNjb3BlIHx8IHRoaXNcbiAgICAgICAgXG4gICAgICAgIGZvciAodmFyIGkgPSAwLCBsZW4gPSBhcnJheS5sZW5ndGg7IGkgPCBsZW47IGkrKykgXG4gICAgICAgICAgICBpZiAoZnVuYy5jYWxsKHNjb3BlLCBhcnJheVtpXSwgaSkgPT09IGZhbHNlKSByZXR1cm4gZmFsc2VcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGVhY2hSIDogZnVuY3Rpb24gKGFycmF5LCBmdW5jLCBzY29wZSkge1xuICAgICAgICBzY29wZSA9IHNjb3BlIHx8IHRoaXNcblxuICAgICAgICBmb3IgKHZhciBpID0gYXJyYXkubGVuZ3RoIC0gMTsgaSA+PSAwOyBpLS0pIFxuICAgICAgICAgICAgaWYgKGZ1bmMuY2FsbChzY29wZSwgYXJyYXlbaV0sIGkpID09PSBmYWxzZSkgcmV0dXJuIGZhbHNlXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBleGlzdHMgOiBmdW5jdGlvbiAoYXJyYXksIHZhbHVlKSB7XG4gICAgICAgIGZvciAodmFyIGkgPSAwLCBsZW4gPSBhcnJheS5sZW5ndGg7IGkgPCBsZW47IGkrKykgaWYgKGFycmF5W2ldID09IHZhbHVlKSByZXR1cm4gdHJ1ZVxuICAgICAgICAgICAgXG4gICAgICAgIHJldHVybiBmYWxzZVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgbWFwIDogZnVuY3Rpb24gKGFycmF5LCBmdW5jLCBzY29wZSkge1xuICAgICAgICBzY29wZSA9IHNjb3BlIHx8IHRoaXNcbiAgICAgICAgXG4gICAgICAgIHZhciByZXMgPSBbXVxuICAgICAgICBcbiAgICAgICAgZm9yICh2YXIgaSA9IDAsIGxlbiA9IGFycmF5Lmxlbmd0aDsgaSA8IGxlbjsgaSsrKSBcbiAgICAgICAgICAgIHJlcy5wdXNoKCBmdW5jLmNhbGwoc2NvcGUsIGFycmF5W2ldLCBpKSApXG4gICAgICAgICAgICBcbiAgICAgICAgcmV0dXJuIHJlc1xuICAgIH0sXG4gICAgXG5cbiAgICBncmVwIDogZnVuY3Rpb24gKGFycmF5LCBmdW5jKSB7XG4gICAgICAgIHZhciBhID0gW11cbiAgICAgICAgXG4gICAgICAgIEpvb3NlLkEuZWFjaChhcnJheSwgZnVuY3Rpb24gKHQpIHtcbiAgICAgICAgICAgIGlmIChmdW5jKHQpKSBhLnB1c2godClcbiAgICAgICAgfSlcbiAgICAgICAgXG4gICAgICAgIHJldHVybiBhXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICByZW1vdmUgOiBmdW5jdGlvbiAoYXJyYXksIHJlbW92ZUVsZSkge1xuICAgICAgICB2YXIgYSA9IFtdXG4gICAgICAgIFxuICAgICAgICBKb29zZS5BLmVhY2goYXJyYXksIGZ1bmN0aW9uICh0KSB7XG4gICAgICAgICAgICBpZiAodCAhPT0gcmVtb3ZlRWxlKSBhLnB1c2godClcbiAgICAgICAgfSlcbiAgICAgICAgXG4gICAgICAgIHJldHVybiBhXG4gICAgfVxuICAgIFxufVxuXG4vLyBTdGF0aWMgaGVscGVycyBmb3IgU3RyaW5nc1xuSm9vc2UuUyA9IHtcbiAgICBcbiAgICBzYW5lU3BsaXQgOiBmdW5jdGlvbiAoc3RyLCBkZWxpbWV0ZXIpIHtcbiAgICAgICAgdmFyIHJlcyA9IChzdHIgfHwgJycpLnNwbGl0KGRlbGltZXRlcilcbiAgICAgICAgXG4gICAgICAgIGlmIChyZXMubGVuZ3RoID09IDEgJiYgIXJlc1swXSkgcmVzLnNoaWZ0KClcbiAgICAgICAgXG4gICAgICAgIHJldHVybiByZXNcbiAgICB9LFxuICAgIFxuXG4gICAgdXBwZXJjYXNlRmlyc3QgOiBmdW5jdGlvbiAoc3RyaW5nKSB7IFxuICAgICAgICByZXR1cm4gc3RyaW5nLnN1YnN0cigwLCAxKS50b1VwcGVyQ2FzZSgpICsgc3RyaW5nLnN1YnN0cigxLCBzdHJpbmcubGVuZ3RoIC0gMSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIHN0clRvQ2xhc3MgOiBmdW5jdGlvbiAobmFtZSwgdG9wKSB7XG4gICAgICAgIHZhciBjdXJyZW50ID0gdG9wIHx8IEpvb3NlLnRvcFxuICAgICAgICBcbiAgICAgICAgSm9vc2UuQS5lYWNoKG5hbWUuc3BsaXQoJy4nKSwgZnVuY3Rpb24gKHNlZ21lbnQpIHtcbiAgICAgICAgICAgIGlmIChjdXJyZW50KSBcbiAgICAgICAgICAgICAgICBjdXJyZW50ID0gY3VycmVudFsgc2VnbWVudCBdXG4gICAgICAgICAgICBlbHNlXG4gICAgICAgICAgICAgICAgcmV0dXJuIGZhbHNlXG4gICAgICAgIH0pXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gY3VycmVudFxuICAgIH1cbn1cblxudmFyIGJhc2VGdW5jICAgID0gZnVuY3Rpb24gKCkge31cblxuLy8gU3RhdGljIGhlbHBlcnMgZm9yIG9iamVjdHNcbkpvb3NlLk8gPSB7XG5cbiAgICBlYWNoIDogZnVuY3Rpb24gKG9iamVjdCwgZnVuYywgc2NvcGUpIHtcbiAgICAgICAgc2NvcGUgPSBzY29wZSB8fCB0aGlzXG4gICAgICAgIFxuICAgICAgICBmb3IgKHZhciBpIGluIG9iamVjdCkgXG4gICAgICAgICAgICBpZiAoZnVuYy5jYWxsKHNjb3BlLCBvYmplY3RbaV0sIGkpID09PSBmYWxzZSkgcmV0dXJuIGZhbHNlXG4gICAgICAgIFxuICAgICAgICBpZiAoSm9vc2UuaXNfSUUpIFxuICAgICAgICAgICAgcmV0dXJuIEpvb3NlLkEuZWFjaChbICd0b1N0cmluZycsICdjb25zdHJ1Y3RvcicsICdoYXNPd25Qcm9wZXJ0eScgXSwgZnVuY3Rpb24gKGVsKSB7XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgaWYgKG9iamVjdC5oYXNPd25Qcm9wZXJ0eShlbCkpIHJldHVybiBmdW5jLmNhbGwoc2NvcGUsIG9iamVjdFtlbF0sIGVsKVxuICAgICAgICAgICAgfSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGVhY2hPd24gOiBmdW5jdGlvbiAob2JqZWN0LCBmdW5jLCBzY29wZSkge1xuICAgICAgICBzY29wZSA9IHNjb3BlIHx8IHRoaXNcbiAgICAgICAgXG4gICAgICAgIHJldHVybiBKb29zZS5PLmVhY2gob2JqZWN0LCBmdW5jdGlvbiAodmFsdWUsIG5hbWUpIHtcbiAgICAgICAgICAgIGlmIChvYmplY3QuaGFzT3duUHJvcGVydHkobmFtZSkpIHJldHVybiBmdW5jLmNhbGwoc2NvcGUsIHZhbHVlLCBuYW1lKVxuICAgICAgICB9LCBzY29wZSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGNvcHkgOiBmdW5jdGlvbiAoc291cmNlLCB0YXJnZXQpIHtcbiAgICAgICAgdGFyZ2V0ID0gdGFyZ2V0IHx8IHt9XG4gICAgICAgIFxuICAgICAgICBKb29zZS5PLmVhY2goc291cmNlLCBmdW5jdGlvbiAodmFsdWUsIG5hbWUpIHsgdGFyZ2V0W25hbWVdID0gdmFsdWUgfSlcbiAgICAgICAgXG4gICAgICAgIHJldHVybiB0YXJnZXRcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGNvcHlPd24gOiBmdW5jdGlvbiAoc291cmNlLCB0YXJnZXQpIHtcbiAgICAgICAgdGFyZ2V0ID0gdGFyZ2V0IHx8IHt9XG4gICAgICAgIFxuICAgICAgICBKb29zZS5PLmVhY2hPd24oc291cmNlLCBmdW5jdGlvbiAodmFsdWUsIG5hbWUpIHsgdGFyZ2V0W25hbWVdID0gdmFsdWUgfSlcbiAgICAgICAgXG4gICAgICAgIHJldHVybiB0YXJnZXRcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGdldE11dGFibGVDb3B5IDogZnVuY3Rpb24gKG9iamVjdCkge1xuICAgICAgICBiYXNlRnVuYy5wcm90b3R5cGUgPSBvYmplY3RcbiAgICAgICAgXG4gICAgICAgIHJldHVybiBuZXcgYmFzZUZ1bmMoKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgZXh0ZW5kIDogZnVuY3Rpb24gKHRhcmdldCwgc291cmNlKSB7XG4gICAgICAgIHJldHVybiBKb29zZS5PLmNvcHkoc291cmNlLCB0YXJnZXQpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBpc0VtcHR5IDogZnVuY3Rpb24gKG9iamVjdCkge1xuICAgICAgICBmb3IgKHZhciBpIGluIG9iamVjdCkgaWYgKG9iamVjdC5oYXNPd25Qcm9wZXJ0eShpKSkgcmV0dXJuIGZhbHNlXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gdHJ1ZVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgaXNJbnN0YW5jZTogZnVuY3Rpb24gKG9iaikge1xuICAgICAgICByZXR1cm4gb2JqICYmIG9iai5tZXRhICYmIG9iai5jb25zdHJ1Y3RvciA9PSBvYmoubWV0YS5jXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBpc0NsYXNzIDogZnVuY3Rpb24gKG9iaikge1xuICAgICAgICByZXR1cm4gb2JqICYmIG9iai5tZXRhICYmIG9iai5tZXRhLmMgPT0gb2JqXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICB3YW50QXJyYXkgOiBmdW5jdGlvbiAob2JqKSB7XG4gICAgICAgIGlmIChvYmogaW5zdGFuY2VvZiBBcnJheSkgcmV0dXJuIG9ialxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIFsgb2JqIF1cbiAgICB9LFxuICAgIFxuICAgIFxuICAgIC8vIHRoaXMgd2FzIGEgYnVnIGluIFdlYktpdCwgd2hpY2ggZ2l2ZXMgdHlwZW9mIC8gLyA9PSAnZnVuY3Rpb24nXG4gICAgLy8gc2hvdWxkIGJlIG1vbml0b3JlZCBhbmQgcmVtb3ZlZCBhdCBzb21lIHBvaW50IGluIHRoZSBmdXR1cmVcbiAgICBpc0Z1bmN0aW9uIDogZnVuY3Rpb24gKG9iaikge1xuICAgICAgICByZXR1cm4gdHlwZW9mIG9iaiA9PSAnZnVuY3Rpb24nICYmIG9iai5jb25zdHJ1Y3RvciAhPSAvIC8uY29uc3RydWN0b3JcbiAgICB9XG59XG5cblxuLy9pbml0aWFsaXplcnNcblxuSm9vc2UuSSA9IHtcbiAgICBBcnJheSAgICAgICA6IGZ1bmN0aW9uICgpIHsgcmV0dXJuIFtdIH0sXG4gICAgT2JqZWN0ICAgICAgOiBmdW5jdGlvbiAoKSB7IHJldHVybiB7fSB9LFxuICAgIEZ1bmN0aW9uICAgIDogZnVuY3Rpb24gKCkgeyByZXR1cm4gYXJndW1lbnRzLmNhbGxlZSB9LFxuICAgIE5vdyAgICAgICAgIDogZnVuY3Rpb24gKCkgeyByZXR1cm4gbmV3IERhdGUoKSB9XG59O1xuSm9vc2UuUHJvdG8gPSBKb29zZS5zdHViKClcblxuSm9vc2UuUHJvdG8uRW1wdHkgPSBKb29zZS5zdHViKClcbiAgICBcbkpvb3NlLlByb3RvLkVtcHR5Lm1ldGEgPSB7fTtcbjsoZnVuY3Rpb24gKCkge1xuXG4gICAgSm9vc2UuUHJvdG8uT2JqZWN0ID0gSm9vc2Uuc3R1YigpXG4gICAgXG4gICAgXG4gICAgdmFyIFNVUEVSID0gZnVuY3Rpb24gKCkge1xuICAgICAgICB2YXIgc2VsZiA9IFNVUEVSLmNhbGxlclxuICAgICAgICBcbiAgICAgICAgaWYgKHNlbGYgPT0gU1VQRVJBUkcpIHNlbGYgPSBzZWxmLmNhbGxlclxuICAgICAgICBcbiAgICAgICAgaWYgKCFzZWxmLlNVUEVSKSB0aHJvdyBcIkludmFsaWQgY2FsbCB0byBTVVBFUlwiXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gc2VsZi5TVVBFUltzZWxmLm1ldGhvZE5hbWVdLmFwcGx5KHRoaXMsIGFyZ3VtZW50cylcbiAgICB9XG4gICAgXG4gICAgXG4gICAgdmFyIFNVUEVSQVJHID0gZnVuY3Rpb24gKCkge1xuICAgICAgICByZXR1cm4gdGhpcy5TVVBFUi5hcHBseSh0aGlzLCBhcmd1bWVudHNbMF0pXG4gICAgfVxuICAgIFxuICAgIFxuICAgIFxuICAgIEpvb3NlLlByb3RvLk9iamVjdC5wcm90b3R5cGUgPSB7XG4gICAgICAgIFxuICAgICAgICBTVVBFUkFSRyA6IFNVUEVSQVJHLFxuICAgICAgICBTVVBFUiA6IFNVUEVSLFxuICAgICAgICBcbiAgICAgICAgSU5ORVIgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB0aHJvdyBcIkludmFsaWQgY2FsbCB0byBJTk5FUlwiXG4gICAgICAgIH0sICAgICAgICAgICAgICAgIFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIEJVSUxEIDogZnVuY3Rpb24gKGNvbmZpZykge1xuICAgICAgICAgICAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGggPT0gMSAmJiB0eXBlb2YgY29uZmlnID09ICdvYmplY3QnICYmIGNvbmZpZyB8fCB7fVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIGluaXRpYWxpemU6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICB0b1N0cmluZzogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgcmV0dXJuIFwiYSBcIiArIHRoaXMubWV0YS5uYW1lXG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgfVxuICAgICAgICBcbiAgICBKb29zZS5Qcm90by5PYmplY3QubWV0YSA9IHtcbiAgICAgICAgY29uc3RydWN0b3IgICAgIDogSm9vc2UuUHJvdG8uT2JqZWN0LFxuICAgICAgICBcbiAgICAgICAgbWV0aG9kcyAgICAgICAgIDogSm9vc2UuTy5jb3B5KEpvb3NlLlByb3RvLk9iamVjdC5wcm90b3R5cGUpLFxuICAgICAgICBhdHRyaWJ1dGVzICAgICAgOiB7fVxuICAgIH1cbiAgICBcbiAgICBKb29zZS5Qcm90by5PYmplY3QucHJvdG90eXBlLm1ldGEgPSBKb29zZS5Qcm90by5PYmplY3QubWV0YVxuXG59KSgpO1xuOyhmdW5jdGlvbiAoKSB7XG5cbiAgICBKb29zZS5Qcm90by5DbGFzcyA9IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuaW5pdGlhbGl6ZSh0aGlzLkJVSUxELmFwcGx5KHRoaXMsIGFyZ3VtZW50cykpIHx8IHRoaXNcbiAgICB9XG4gICAgXG4gICAgdmFyIGJvb3RzdHJhcCA9IHtcbiAgICAgICAgXG4gICAgICAgIFZFUlNJT04gICAgICAgICAgICAgOiBudWxsLFxuICAgICAgICBBVVRIT1JJVFkgICAgICAgICAgIDogbnVsbCxcbiAgICAgICAgXG4gICAgICAgIGNvbnN0cnVjdG9yICAgICAgICAgOiBKb29zZS5Qcm90by5DbGFzcyxcbiAgICAgICAgc3VwZXJDbGFzcyAgICAgICAgICA6IG51bGwsXG4gICAgICAgIFxuICAgICAgICBuYW1lICAgICAgICAgICAgICAgIDogbnVsbCxcbiAgICAgICAgXG4gICAgICAgIGF0dHJpYnV0ZXMgICAgICAgICAgOiBudWxsLFxuICAgICAgICBtZXRob2RzICAgICAgICAgICAgIDogbnVsbCxcbiAgICAgICAgXG4gICAgICAgIG1ldGEgICAgICAgICAgICAgICAgOiBudWxsLFxuICAgICAgICBjICAgICAgICAgICAgICAgICAgIDogbnVsbCxcbiAgICAgICAgXG4gICAgICAgIGRlZmF1bHRTdXBlckNsYXNzICAgOiBKb29zZS5Qcm90by5PYmplY3QsXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgQlVJTEQgOiBmdW5jdGlvbiAobmFtZSwgZXh0ZW5kKSB7XG4gICAgICAgICAgICB0aGlzLm5hbWUgPSBuYW1lXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHJldHVybiB7IF9fZXh0ZW5kX18gOiBleHRlbmQgfHwge30gfVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIGluaXRpYWxpemU6IGZ1bmN0aW9uIChwcm9wcykge1xuICAgICAgICAgICAgdmFyIGV4dGVuZCAgICAgID0gcHJvcHMuX19leHRlbmRfX1xuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLlZFUlNJT04gICAgPSBleHRlbmQuVkVSU0lPTlxuICAgICAgICAgICAgdGhpcy5BVVRIT1JJVFkgID0gZXh0ZW5kLkFVVEhPUklUWVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBkZWxldGUgZXh0ZW5kLlZFUlNJT05cbiAgICAgICAgICAgIGRlbGV0ZSBleHRlbmQuQVVUSE9SSVRZXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXMuYyA9IHRoaXMuZXh0cmFjdENvbnN0cnVjdG9yKGV4dGVuZClcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpcy5hZGFwdENvbnN0cnVjdG9yKHRoaXMuYylcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKGV4dGVuZC5jb25zdHJ1Y3Rvck9ubHkpIHtcbiAgICAgICAgICAgICAgICBkZWxldGUgZXh0ZW5kLmNvbnN0cnVjdG9yT25seVxuICAgICAgICAgICAgICAgIHJldHVyblxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLmNvbnN0cnVjdChleHRlbmQpXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgY29uc3RydWN0IDogZnVuY3Rpb24gKGV4dGVuZCkge1xuICAgICAgICAgICAgaWYgKCF0aGlzLnByZXBhcmVQcm9wcyhleHRlbmQpKSByZXR1cm5cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdmFyIHN1cGVyQ2xhc3MgPSB0aGlzLnN1cGVyQ2xhc3MgPSB0aGlzLmV4dHJhY3RTdXBlckNsYXNzKGV4dGVuZClcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpcy5wcm9jZXNzU3VwZXJDbGFzcyhzdXBlckNsYXNzKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLmFkYXB0UHJvdG90eXBlKHRoaXMuYy5wcm90b3R5cGUpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXMuZmluYWxpemUoZXh0ZW5kKVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIGZpbmFsaXplIDogZnVuY3Rpb24gKGV4dGVuZCkge1xuICAgICAgICAgICAgdGhpcy5wcm9jZXNzU3RlbShleHRlbmQpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXMuZXh0ZW5kKGV4dGVuZClcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICAvL2lmIHRoZSBleHRlbnNpb24gcmV0dXJucyBmYWxzZSBmcm9tIHRoaXMgbWV0aG9kIGl0IHNob3VsZCByZS1lbnRlciAnY29uc3RydWN0J1xuICAgICAgICBwcmVwYXJlUHJvcHMgOiBmdW5jdGlvbiAoZXh0ZW5kKSB7XG4gICAgICAgICAgICByZXR1cm4gdHJ1ZVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIGV4dHJhY3RDb25zdHJ1Y3RvciA6IGZ1bmN0aW9uIChleHRlbmQpIHtcbiAgICAgICAgICAgIHZhciByZXMgPSBleHRlbmQuaGFzT3duUHJvcGVydHkoJ2NvbnN0cnVjdG9yJykgPyBleHRlbmQuY29uc3RydWN0b3IgOiB0aGlzLmRlZmF1bHRDb25zdHJ1Y3RvcigpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGRlbGV0ZSBleHRlbmQuY29uc3RydWN0b3JcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcmV0dXJuIHJlc1xuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIGV4dHJhY3RTdXBlckNsYXNzIDogZnVuY3Rpb24gKGV4dGVuZCkge1xuICAgICAgICAgICAgaWYgKGV4dGVuZC5oYXNPd25Qcm9wZXJ0eSgnaXNhJykgJiYgIWV4dGVuZC5pc2EpIHRocm93IG5ldyBFcnJvcihcIkF0dGVtcHQgdG8gaW5oZXJpdCBmcm9tIHVuZGVmaW5lZCBzdXBlcmNsYXNzIFtcIiArIHRoaXMubmFtZSArIFwiXVwiKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB2YXIgcmVzID0gZXh0ZW5kLmlzYSB8fCB0aGlzLmRlZmF1bHRTdXBlckNsYXNzXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGRlbGV0ZSBleHRlbmQuaXNhXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHJldHVybiByZXNcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBwcm9jZXNzU3RlbSA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHZhciBzdXBlck1ldGEgICAgICAgPSB0aGlzLnN1cGVyQ2xhc3MubWV0YVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLm1ldGhvZHMgICAgICAgID0gSm9vc2UuTy5nZXRNdXRhYmxlQ29weShzdXBlck1ldGEubWV0aG9kcyB8fCB7fSlcbiAgICAgICAgICAgIHRoaXMuYXR0cmlidXRlcyAgICAgPSBKb29zZS5PLmdldE11dGFibGVDb3B5KHN1cGVyTWV0YS5hdHRyaWJ1dGVzIHx8IHt9KVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIGluaXRJbnN0YW5jZSA6IGZ1bmN0aW9uIChpbnN0YW5jZSwgcHJvcHMpIHtcbiAgICAgICAgICAgIEpvb3NlLk8uY29weU93bihwcm9wcywgaW5zdGFuY2UpXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgZGVmYXVsdENvbnN0cnVjdG9yOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICByZXR1cm4gZnVuY3Rpb24gKGFyZykge1xuICAgICAgICAgICAgICAgIHZhciBCVUlMRCA9IHRoaXMuQlVJTERcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICB2YXIgYXJncyA9IEJVSUxEICYmIEJVSUxELmFwcGx5KHRoaXMsIGFyZ3VtZW50cykgfHwgYXJnIHx8IHt9XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgdmFyIHRoaXNNZXRhICAgID0gdGhpcy5tZXRhXG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgdGhpc01ldGEuaW5pdEluc3RhbmNlKHRoaXMsIGFyZ3MpXG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgcmV0dXJuIHRoaXNNZXRhLmhhc01ldGhvZCgnaW5pdGlhbGl6ZScpICYmIHRoaXMuaW5pdGlhbGl6ZShhcmdzKSB8fCB0aGlzXG4gICAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgcHJvY2Vzc1N1cGVyQ2xhc3M6IGZ1bmN0aW9uIChzdXBlckNsYXNzKSB7XG4gICAgICAgICAgICB2YXIgc3VwZXJQcm90byAgICAgID0gc3VwZXJDbGFzcy5wcm90b3R5cGVcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy9ub24tSm9vc2Ugc3VwZXJjbGFzc2VzXG4gICAgICAgICAgICBpZiAoIXN1cGVyQ2xhc3MubWV0YSkge1xuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIHZhciBleHRlbmQgPSBKb29zZS5PLmNvcHkoc3VwZXJQcm90bylcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBleHRlbmQuaXNhID0gSm9vc2UuUHJvdG8uRW1wdHlcbiAgICAgICAgICAgICAgICAvLyBjbGVhciBwb3RlbnRpYWwgdmFsdWUgaW4gdGhlIGBleHRlbmQuY29uc3RydWN0b3JgIHRvIHByZXZlbnQgaXQgZnJvbSBiZWluZyBtb2RpZmllZFxuICAgICAgICAgICAgICAgIGRlbGV0ZSBleHRlbmQuY29uc3RydWN0b3JcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICB2YXIgbWV0YSA9IG5ldyB0aGlzLmRlZmF1bHRTdXBlckNsYXNzLm1ldGEuY29uc3RydWN0b3IobnVsbCwgZXh0ZW5kKVxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIHN1cGVyQ2xhc3MubWV0YSA9IHN1cGVyUHJvdG8ubWV0YSA9IG1ldGFcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBtZXRhLmMgPSBzdXBlckNsYXNzXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXMuYy5wcm90b3R5cGUgICAgPSBKb29zZS5PLmdldE11dGFibGVDb3B5KHN1cGVyUHJvdG8pXG4gICAgICAgICAgICB0aGlzLmMuc3VwZXJDbGFzcyAgID0gc3VwZXJQcm90b1xuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIGFkYXB0Q29uc3RydWN0b3I6IGZ1bmN0aW9uIChjKSB7XG4gICAgICAgICAgICBjLm1ldGEgPSB0aGlzXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmICghYy5oYXNPd25Qcm9wZXJ0eSgndG9TdHJpbmcnKSkgYy50b1N0cmluZyA9IGZ1bmN0aW9uICgpIHsgcmV0dXJuIHRoaXMubWV0YS5uYW1lIH1cbiAgICAgICAgfSxcbiAgICBcbiAgICAgICAgXG4gICAgICAgIGFkYXB0UHJvdG90eXBlOiBmdW5jdGlvbiAocHJvdG8pIHtcbiAgICAgICAgICAgIC8vdGhpcyB3aWxsIGZpeCB3ZWlyZCBzZW1hbnRpYyBvZiBuYXRpdmUgXCJjb25zdHJ1Y3RvclwiIHByb3BlcnR5IHRvIG1vcmUgaW50dWl0aXZlIChpZGVhIGJvcnJvd2VkIGZyb20gRXh0KVxuICAgICAgICAgICAgcHJvdG8uY29uc3RydWN0b3IgICA9IHRoaXMuY1xuICAgICAgICAgICAgcHJvdG8ubWV0YSAgICAgICAgICA9IHRoaXNcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBhZGRNZXRob2Q6IGZ1bmN0aW9uIChuYW1lLCBmdW5jKSB7XG4gICAgICAgICAgICBmdW5jLlNVUEVSID0gdGhpcy5zdXBlckNsYXNzLnByb3RvdHlwZVxuICAgICAgICAgICAgXG4gICAgICAgICAgICAvL2Nocm9tZSBkb24ndCBhbGxvdyB0byByZWRlZmluZSB0aGUgXCJuYW1lXCIgcHJvcGVydHlcbiAgICAgICAgICAgIGZ1bmMubWV0aG9kTmFtZSA9IG5hbWVcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpcy5tZXRob2RzW25hbWVdID0gZnVuY1xuICAgICAgICAgICAgdGhpcy5jLnByb3RvdHlwZVtuYW1lXSA9IGZ1bmNcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBhZGRBdHRyaWJ1dGU6IGZ1bmN0aW9uIChuYW1lLCBpbml0KSB7XG4gICAgICAgICAgICB0aGlzLmF0dHJpYnV0ZXNbbmFtZV0gPSBpbml0XG4gICAgICAgICAgICB0aGlzLmMucHJvdG90eXBlW25hbWVdID0gaW5pdFxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIHJlbW92ZU1ldGhvZCA6IGZ1bmN0aW9uIChuYW1lKSB7XG4gICAgICAgICAgICBkZWxldGUgdGhpcy5tZXRob2RzW25hbWVdXG4gICAgICAgICAgICBkZWxldGUgdGhpcy5jLnByb3RvdHlwZVtuYW1lXVxuICAgICAgICB9LFxuICAgIFxuICAgICAgICBcbiAgICAgICAgcmVtb3ZlQXR0cmlidXRlOiBmdW5jdGlvbiAobmFtZSkge1xuICAgICAgICAgICAgZGVsZXRlIHRoaXMuYXR0cmlidXRlc1tuYW1lXVxuICAgICAgICAgICAgZGVsZXRlIHRoaXMuYy5wcm90b3R5cGVbbmFtZV1cbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBoYXNNZXRob2Q6IGZ1bmN0aW9uIChuYW1lKSB7IFxuICAgICAgICAgICAgcmV0dXJuIEJvb2xlYW4odGhpcy5tZXRob2RzW25hbWVdKVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIGhhc0F0dHJpYnV0ZTogZnVuY3Rpb24gKG5hbWUpIHsgXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5hdHRyaWJ1dGVzW25hbWVdICE9PSB1bmRlZmluZWRcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgXG4gICAgICAgIGhhc093bk1ldGhvZDogZnVuY3Rpb24gKG5hbWUpIHsgXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5oYXNNZXRob2QobmFtZSkgJiYgdGhpcy5tZXRob2RzLmhhc093blByb3BlcnR5KG5hbWUpXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgaGFzT3duQXR0cmlidXRlOiBmdW5jdGlvbiAobmFtZSkgeyBcbiAgICAgICAgICAgIHJldHVybiB0aGlzLmhhc0F0dHJpYnV0ZShuYW1lKSAmJiB0aGlzLmF0dHJpYnV0ZXMuaGFzT3duUHJvcGVydHkobmFtZSlcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBleHRlbmQgOiBmdW5jdGlvbiAocHJvcHMpIHtcbiAgICAgICAgICAgIEpvb3NlLk8uZWFjaE93bihwcm9wcywgZnVuY3Rpb24gKHZhbHVlLCBuYW1lKSB7XG4gICAgICAgICAgICAgICAgaWYgKG5hbWUgIT0gJ21ldGEnICYmIG5hbWUgIT0gJ2NvbnN0cnVjdG9yJykgXG4gICAgICAgICAgICAgICAgICAgIGlmIChKb29zZS5PLmlzRnVuY3Rpb24odmFsdWUpICYmICF2YWx1ZS5tZXRhKSBcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuYWRkTWV0aG9kKG5hbWUsIHZhbHVlKSBcbiAgICAgICAgICAgICAgICAgICAgZWxzZSBcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuYWRkQXR0cmlidXRlKG5hbWUsIHZhbHVlKVxuICAgICAgICAgICAgfSwgdGhpcylcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBzdWJDbGFzc09mIDogZnVuY3Rpb24gKGNsYXNzT2JqZWN0LCBleHRlbmQpIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLnN1YkNsYXNzKGV4dGVuZCwgbnVsbCwgY2xhc3NPYmplY3QpXG4gICAgICAgIH0sXG4gICAgXG4gICAgXG4gICAgICAgIHN1YkNsYXNzIDogZnVuY3Rpb24gKGV4dGVuZCwgbmFtZSwgY2xhc3NPYmplY3QpIHtcbiAgICAgICAgICAgIGV4dGVuZCAgICAgID0gZXh0ZW5kICAgICAgICB8fCB7fVxuICAgICAgICAgICAgZXh0ZW5kLmlzYSAgPSBjbGFzc09iamVjdCAgIHx8IHRoaXMuY1xuICAgICAgICAgICAgXG4gICAgICAgICAgICByZXR1cm4gbmV3IHRoaXMuY29uc3RydWN0b3IobmFtZSwgZXh0ZW5kKS5jXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgaW5zdGFudGlhdGUgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB2YXIgZiA9IGZ1bmN0aW9uICgpIHt9XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGYucHJvdG90eXBlID0gdGhpcy5jLnByb3RvdHlwZVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB2YXIgb2JqID0gbmV3IGYoKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5jLmFwcGx5KG9iaiwgYXJndW1lbnRzKSB8fCBvYmpcbiAgICAgICAgfVxuICAgIH1cbiAgICBcbiAgICAvL21pY3JvIGJvb3RzdHJhcGluZ1xuICAgIFxuICAgIEpvb3NlLlByb3RvLkNsYXNzLnByb3RvdHlwZSA9IEpvb3NlLk8uZ2V0TXV0YWJsZUNvcHkoSm9vc2UuUHJvdG8uT2JqZWN0LnByb3RvdHlwZSlcbiAgICBcbiAgICBKb29zZS5PLmV4dGVuZChKb29zZS5Qcm90by5DbGFzcy5wcm90b3R5cGUsIGJvb3RzdHJhcClcbiAgICBcbiAgICBKb29zZS5Qcm90by5DbGFzcy5wcm90b3R5cGUubWV0YSA9IG5ldyBKb29zZS5Qcm90by5DbGFzcygnSm9vc2UuUHJvdG8uQ2xhc3MnLCBib290c3RyYXApXG4gICAgXG4gICAgXG4gICAgXG4gICAgSm9vc2UuUHJvdG8uQ2xhc3MubWV0YS5hZGRNZXRob2QoJ2lzYScsIGZ1bmN0aW9uIChzb21lQ2xhc3MpIHtcbiAgICAgICAgdmFyIGYgPSBmdW5jdGlvbiAoKSB7fVxuICAgICAgICBcbiAgICAgICAgZi5wcm90b3R5cGUgPSB0aGlzLmMucHJvdG90eXBlXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gbmV3IGYoKSBpbnN0YW5jZW9mIHNvbWVDbGFzc1xuICAgIH0pXG59KSgpO1xuSm9vc2UuTWFuYWdlZCA9IEpvb3NlLnN0dWIoKVxuXG5Kb29zZS5NYW5hZ2VkLlByb3BlcnR5ID0gbmV3IEpvb3NlLlByb3RvLkNsYXNzKCdKb29zZS5NYW5hZ2VkLlByb3BlcnR5Jywge1xuICAgIFxuICAgIG5hbWUgICAgICAgICAgICA6IG51bGwsXG4gICAgXG4gICAgaW5pdCAgICAgICAgICAgIDogbnVsbCxcbiAgICB2YWx1ZSAgICAgICAgICAgOiBudWxsLFxuICAgIFxuICAgIGRlZmluZWRJbiAgICAgICA6IG51bGwsXG4gICAgXG4gICAgXG4gICAgaW5pdGlhbGl6ZSA6IGZ1bmN0aW9uIChwcm9wcykge1xuICAgICAgICBKb29zZS5NYW5hZ2VkLlByb3BlcnR5LnN1cGVyQ2xhc3MuaW5pdGlhbGl6ZS5jYWxsKHRoaXMsIHByb3BzKVxuICAgICAgICBcbiAgICAgICAgdGhpcy5jb21wdXRlVmFsdWUoKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgY29tcHV0ZVZhbHVlIDogZnVuY3Rpb24gKCkge1xuICAgICAgICB0aGlzLnZhbHVlID0gdGhpcy5pbml0XG4gICAgfSwgICAgXG4gICAgXG4gICAgXG4gICAgLy90YXJnZXRDbGFzcyBpcyBzdGlsbCBvcGVuIGF0IHRoaXMgc3RhZ2VcbiAgICBwcmVBcHBseSA6IGZ1bmN0aW9uICh0YXJnZXRDbGFzcykge1xuICAgIH0sXG4gICAgXG5cbiAgICAvL3RhcmdldENsYXNzIGlzIGFscmVhZHkgb3BlbiBhdCB0aGlzIHN0YWdlXG4gICAgcG9zdFVuQXBwbHkgOiBmdW5jdGlvbiAodGFyZ2V0Q2xhc3MpIHtcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGFwcGx5IDogZnVuY3Rpb24gKHRhcmdldCkge1xuICAgICAgICB0YXJnZXRbdGhpcy5uYW1lXSA9IHRoaXMudmFsdWVcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGlzQXBwbGllZFRvIDogZnVuY3Rpb24gKHRhcmdldCkge1xuICAgICAgICByZXR1cm4gdGFyZ2V0W3RoaXMubmFtZV0gPT0gdGhpcy52YWx1ZVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgdW5hcHBseSA6IGZ1bmN0aW9uIChmcm9tKSB7XG4gICAgICAgIGlmICghdGhpcy5pc0FwcGxpZWRUbyhmcm9tKSkgdGhyb3cgXCJVbmFwcGx5IG9mIHByb3BlcnR5IFtcIiArIHRoaXMubmFtZSArIFwiXSBmcm9tIFtcIiArIGZyb20gKyBcIl0gZmFpbGVkXCJcbiAgICAgICAgXG4gICAgICAgIGRlbGV0ZSBmcm9tW3RoaXMubmFtZV1cbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGNsb25lUHJvcHMgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBuYW1lICAgICAgICA6IHRoaXMubmFtZSwgXG4gICAgICAgICAgICBpbml0ICAgICAgICA6IHRoaXMuaW5pdCxcbiAgICAgICAgICAgIGRlZmluZWRJbiAgIDogdGhpcy5kZWZpbmVkSW5cbiAgICAgICAgfVxuICAgIH0sXG5cbiAgICBcbiAgICBjbG9uZSA6IGZ1bmN0aW9uIChuYW1lKSB7XG4gICAgICAgIHZhciBwcm9wcyA9IHRoaXMuY2xvbmVQcm9wcygpXG4gICAgICAgIFxuICAgICAgICBwcm9wcy5uYW1lID0gbmFtZSB8fCBwcm9wcy5uYW1lXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gbmV3IHRoaXMuY29uc3RydWN0b3IocHJvcHMpXG4gICAgfVxuICAgIFxuICAgIFxufSkuYztcbkpvb3NlLk1hbmFnZWQuUHJvcGVydHkuQ29uZmxpY3RNYXJrZXIgPSBuZXcgSm9vc2UuUHJvdG8uQ2xhc3MoJ0pvb3NlLk1hbmFnZWQuUHJvcGVydHkuQ29uZmxpY3RNYXJrZXInLCB7XG4gICAgXG4gICAgaXNhIDogSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eSxcblxuICAgIGFwcGx5IDogZnVuY3Rpb24gKHRhcmdldCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJBdHRlbXB0IHRvIGFwcGx5IENvbmZsaWN0TWFya2VyIFtcIiArIHRoaXMubmFtZSArIFwiXSB0byBbXCIgKyB0YXJnZXQgKyBcIl1cIilcbiAgICB9XG4gICAgXG59KS5jO1xuSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5SZXF1aXJlbWVudCA9IG5ldyBKb29zZS5Qcm90by5DbGFzcygnSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5SZXF1aXJlbWVudCcsIHtcbiAgICBcbiAgICBpc2EgOiBKb29zZS5NYW5hZ2VkLlByb3BlcnR5LFxuXG4gICAgXG4gICAgYXBwbHkgOiBmdW5jdGlvbiAodGFyZ2V0KSB7XG4gICAgICAgIGlmICghdGFyZ2V0Lm1ldGEuaGFzTWV0aG9kKHRoaXMubmFtZSkpIFxuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiUmVxdWlyZW1lbnQgW1wiICsgdGhpcy5uYW1lICsgXCJdLCBkZWZpbmVkIGluIFtcIiArIHRoaXMuZGVmaW5lZEluLmRlZmluZWRJbi5uYW1lICsgXCJdIGlzIG5vdCBzYXRpc2ZpZWQgZm9yIGNsYXNzIFtcIiArIHRhcmdldCArIFwiXVwiKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgdW5hcHBseSA6IGZ1bmN0aW9uIChmcm9tKSB7XG4gICAgfVxuICAgIFxufSkuYztcbkpvb3NlLk1hbmFnZWQuUHJvcGVydHkuQXR0cmlidXRlID0gbmV3IEpvb3NlLlByb3RvLkNsYXNzKCdKb29zZS5NYW5hZ2VkLlByb3BlcnR5LkF0dHJpYnV0ZScsIHtcbiAgICBcbiAgICBpc2EgOiBKb29zZS5NYW5hZ2VkLlByb3BlcnR5LFxuICAgIFxuICAgIHNsb3QgICAgICAgICAgICAgICAgOiBudWxsLFxuICAgIFxuICAgIFxuICAgIGluaXRpYWxpemUgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIEpvb3NlLk1hbmFnZWQuUHJvcGVydHkuQXR0cmlidXRlLnN1cGVyQ2xhc3MuaW5pdGlhbGl6ZS5hcHBseSh0aGlzLCBhcmd1bWVudHMpXG4gICAgICAgIFxuICAgICAgICB0aGlzLnNsb3QgPSB0aGlzLm5hbWVcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGFwcGx5IDogZnVuY3Rpb24gKHRhcmdldCkge1xuICAgICAgICB0YXJnZXQucHJvdG90eXBlWyB0aGlzLnNsb3QgXSA9IHRoaXMudmFsdWVcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGlzQXBwbGllZFRvIDogZnVuY3Rpb24gKHRhcmdldCkge1xuICAgICAgICByZXR1cm4gdGFyZ2V0LnByb3RvdHlwZVsgdGhpcy5zbG90IF0gPT0gdGhpcy52YWx1ZVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgdW5hcHBseSA6IGZ1bmN0aW9uIChmcm9tKSB7XG4gICAgICAgIGlmICghdGhpcy5pc0FwcGxpZWRUbyhmcm9tKSkgdGhyb3cgXCJVbmFwcGx5IG9mIHByb3BlcnR5IFtcIiArIHRoaXMubmFtZSArIFwiXSBmcm9tIFtcIiArIGZyb20gKyBcIl0gZmFpbGVkXCJcbiAgICAgICAgXG4gICAgICAgIGRlbGV0ZSBmcm9tLnByb3RvdHlwZVt0aGlzLnNsb3RdXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBjbGVhclZhbHVlIDogZnVuY3Rpb24gKGluc3RhbmNlKSB7XG4gICAgICAgIGRlbGV0ZSBpbnN0YW5jZVsgdGhpcy5zbG90IF1cbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGhhc1ZhbHVlIDogZnVuY3Rpb24gKGluc3RhbmNlKSB7XG4gICAgICAgIHJldHVybiBpbnN0YW5jZS5oYXNPd25Qcm9wZXJ0eSh0aGlzLnNsb3QpXG4gICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgIGdldFJhd1ZhbHVlRnJvbSA6IGZ1bmN0aW9uIChpbnN0YW5jZSkge1xuICAgICAgICByZXR1cm4gaW5zdGFuY2VbIHRoaXMuc2xvdCBdXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBzZXRSYXdWYWx1ZVRvIDogZnVuY3Rpb24gKGluc3RhbmNlLCB2YWx1ZSkge1xuICAgICAgICBpbnN0YW5jZVsgdGhpcy5zbG90IF0gPSB2YWx1ZVxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIHRoaXNcbiAgICB9XG4gICAgXG59KS5jO1xuSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5NZXRob2RNb2RpZmllciA9IG5ldyBKb29zZS5Qcm90by5DbGFzcygnSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5NZXRob2RNb2RpZmllcicsIHtcbiAgICBcbiAgICBpc2EgOiBKb29zZS5NYW5hZ2VkLlByb3BlcnR5LFxuXG4gICAgXG4gICAgcHJlcGFyZVdyYXBwZXIgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHRocm93IFwiQWJzdHJhY3QgbWV0aG9kIFtwcmVwYXJlV3JhcHBlcl0gb2YgXCIgKyB0aGlzICsgXCIgd2FzIGNhbGxlZFwiXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBhcHBseSA6IGZ1bmN0aW9uICh0YXJnZXQpIHtcbiAgICAgICAgdmFyIG5hbWUgICAgICAgICAgICA9IHRoaXMubmFtZVxuICAgICAgICB2YXIgdGFyZ2V0UHJvdG8gICAgID0gdGFyZ2V0LnByb3RvdHlwZVxuICAgICAgICB2YXIgaXNPd24gICAgICAgICAgID0gdGFyZ2V0UHJvdG8uaGFzT3duUHJvcGVydHkobmFtZSlcbiAgICAgICAgdmFyIG9yaWdpbmFsICAgICAgICA9IHRhcmdldFByb3RvW25hbWVdXG4gICAgICAgIHZhciBzdXBlclByb3RvICAgICAgPSB0YXJnZXQubWV0YS5zdXBlckNsYXNzLnByb3RvdHlwZVxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIHZhciBvcmlnaW5hbENhbGwgPSBpc093biA/IG9yaWdpbmFsIDogZnVuY3Rpb24gKCkgeyBcbiAgICAgICAgICAgIHJldHVybiBzdXBlclByb3RvW25hbWVdLmFwcGx5KHRoaXMsIGFyZ3VtZW50cykgXG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgICAgIHZhciBtZXRob2RXcmFwcGVyID0gdGhpcy5wcmVwYXJlV3JhcHBlcih7XG4gICAgICAgICAgICBuYW1lICAgICAgICAgICAgOiBuYW1lLFxuICAgICAgICAgICAgbW9kaWZpZXIgICAgICAgIDogdGhpcy52YWx1ZSwgXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlzT3duICAgICAgICAgICA6IGlzT3duLFxuICAgICAgICAgICAgb3JpZ2luYWxDYWxsICAgIDogb3JpZ2luYWxDYWxsLCBcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgc3VwZXJQcm90byAgICAgIDogc3VwZXJQcm90byxcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGFyZ2V0ICAgICAgICAgIDogdGFyZ2V0XG4gICAgICAgIH0pXG4gICAgICAgIFxuICAgICAgICBpZiAoaXNPd24pIG1ldGhvZFdyYXBwZXIuX19PUklHSU5BTF9fID0gb3JpZ2luYWxcbiAgICAgICAgXG4gICAgICAgIG1ldGhvZFdyYXBwZXIuX19DT05UQUlOX18gICA9IHRoaXMudmFsdWVcbiAgICAgICAgbWV0aG9kV3JhcHBlci5fX01FVEhPRF9fICAgID0gdGhpc1xuICAgICAgICBcbiAgICAgICAgdGFyZ2V0UHJvdG9bbmFtZV0gPSBtZXRob2RXcmFwcGVyXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBpc0FwcGxpZWRUbyA6IGZ1bmN0aW9uICh0YXJnZXQpIHtcbiAgICAgICAgdmFyIHRhcmdldENvbnQgPSB0YXJnZXQucHJvdG90eXBlW3RoaXMubmFtZV1cbiAgICAgICAgXG4gICAgICAgIHJldHVybiB0YXJnZXRDb250ICYmIHRhcmdldENvbnQuX19DT05UQUlOX18gPT0gdGhpcy52YWx1ZVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgdW5hcHBseSA6IGZ1bmN0aW9uIChmcm9tKSB7XG4gICAgICAgIHZhciBuYW1lID0gdGhpcy5uYW1lXG4gICAgICAgIHZhciBmcm9tUHJvdG8gPSBmcm9tLnByb3RvdHlwZVxuICAgICAgICB2YXIgb3JpZ2luYWwgPSBmcm9tUHJvdG9bbmFtZV0uX19PUklHSU5BTF9fXG4gICAgICAgIFxuICAgICAgICBpZiAoIXRoaXMuaXNBcHBsaWVkVG8oZnJvbSkpIHRocm93IFwiVW5hcHBseSBvZiBtZXRob2QgW1wiICsgbmFtZSArIFwiXSBmcm9tIGNsYXNzIFtcIiArIGZyb20gKyBcIl0gZmFpbGVkXCJcbiAgICAgICAgXG4gICAgICAgIC8vaWYgbW9kaWZpZXIgd2FzIGFwcGxpZWQgdG8gb3duIG1ldGhvZCAtIHJlc3RvcmUgaXRcbiAgICAgICAgaWYgKG9yaWdpbmFsKSBcbiAgICAgICAgICAgIGZyb21Qcm90b1tuYW1lXSA9IG9yaWdpbmFsXG4gICAgICAgIC8vb3RoZXJ3aXNlIC0ganVzdCBkZWxldGUgaXQsIHRvIHJldmVhbCB0aGUgaW5oZXJpdGVkIG1ldGhvZCBcbiAgICAgICAgZWxzZVxuICAgICAgICAgICAgZGVsZXRlIGZyb21Qcm90b1tuYW1lXVxuICAgIH1cbiAgICBcbn0pLmM7XG5Kb29zZS5NYW5hZ2VkLlByb3BlcnR5Lk1ldGhvZE1vZGlmaWVyLk92ZXJyaWRlID0gbmV3IEpvb3NlLlByb3RvLkNsYXNzKCdKb29zZS5NYW5hZ2VkLlByb3BlcnR5Lk1ldGhvZE1vZGlmaWVyLk92ZXJyaWRlJywge1xuICAgIFxuICAgIGlzYSA6IEpvb3NlLk1hbmFnZWQuUHJvcGVydHkuTWV0aG9kTW9kaWZpZXIsXG5cbiAgICBcbiAgICBwcmVwYXJlV3JhcHBlciA6IGZ1bmN0aW9uIChwYXJhbXMpIHtcbiAgICAgICAgXG4gICAgICAgIHZhciBtb2RpZmllciAgICAgICAgPSBwYXJhbXMubW9kaWZpZXJcbiAgICAgICAgdmFyIG9yaWdpbmFsQ2FsbCAgICA9IHBhcmFtcy5vcmlnaW5hbENhbGxcbiAgICAgICAgdmFyIHN1cGVyUHJvdG8gICAgICA9IHBhcmFtcy5zdXBlclByb3RvXG4gICAgICAgIHZhciBzdXBlck1ldGFDb25zdCAgPSBzdXBlclByb3RvLm1ldGEuY29uc3RydWN0b3JcbiAgICAgICAgXG4gICAgICAgIC8vY2FsbCB0byBKb29zZS5Qcm90byBsZXZlbCwgcmVxdWlyZSBzb21lIGFkZGl0aW9uYWwgcHJvY2Vzc2luZ1xuICAgICAgICB2YXIgaXNDYWxsVG9Qcm90byA9IChzdXBlck1ldGFDb25zdCA9PSBKb29zZS5Qcm90by5DbGFzcyB8fCBzdXBlck1ldGFDb25zdCA9PSBKb29zZS5Qcm90by5PYmplY3QpICYmICEocGFyYW1zLmlzT3duICYmIG9yaWdpbmFsQ2FsbC5JU19PVkVSUklERSkgXG4gICAgICAgIFxuICAgICAgICB2YXIgb3JpZ2luYWwgPSBvcmlnaW5hbENhbGxcbiAgICAgICAgXG4gICAgICAgIGlmIChpc0NhbGxUb1Byb3RvKSBvcmlnaW5hbCA9IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHZhciBiZWZvcmVTVVBFUiA9IHRoaXMuU1VQRVJcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpcy5TVVBFUiAgPSBzdXBlclByb3RvLlNVUEVSXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciByZXMgPSBvcmlnaW5hbENhbGwuYXBwbHkodGhpcywgYXJndW1lbnRzKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLlNVUEVSID0gYmVmb3JlU1VQRVJcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcmV0dXJuIHJlc1xuICAgICAgICB9XG5cbiAgICAgICAgdmFyIG92ZXJyaWRlID0gZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgXG4gICAgICAgICAgICB2YXIgYmVmb3JlU1VQRVIgPSB0aGlzLlNVUEVSXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXMuU1VQRVIgID0gb3JpZ2luYWxcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdmFyIHJlcyA9IG1vZGlmaWVyLmFwcGx5KHRoaXMsIGFyZ3VtZW50cylcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpcy5TVVBFUiA9IGJlZm9yZVNVUEVSXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHJldHVybiByZXNcbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgb3ZlcnJpZGUuSVNfT1ZFUlJJREUgPSB0cnVlXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gb3ZlcnJpZGVcbiAgICB9XG4gICAgXG4gICAgXG59KS5jO1xuSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5NZXRob2RNb2RpZmllci5QdXQgPSBuZXcgSm9vc2UuUHJvdG8uQ2xhc3MoJ0pvb3NlLk1hbmFnZWQuUHJvcGVydHkuTWV0aG9kTW9kaWZpZXIuUHV0Jywge1xuICAgIFxuICAgIGlzYSA6IEpvb3NlLk1hbmFnZWQuUHJvcGVydHkuTWV0aG9kTW9kaWZpZXIuT3ZlcnJpZGUsXG5cblxuICAgIHByZXBhcmVXcmFwcGVyIDogZnVuY3Rpb24gKHBhcmFtcykge1xuICAgICAgICBcbiAgICAgICAgaWYgKHBhcmFtcy5pc093bikgdGhyb3cgXCJNZXRob2QgW1wiICsgcGFyYW1zLm5hbWUgKyBcIl0gaXMgYXBwbHlpbmcgb3ZlciBzb21ldGhpbmcgW1wiICsgcGFyYW1zLm9yaWdpbmFsQ2FsbCArIFwiXSBpbiBjbGFzcyBbXCIgKyBwYXJhbXMudGFyZ2V0ICsgXCJdXCJcbiAgICAgICAgXG4gICAgICAgIHJldHVybiBKb29zZS5NYW5hZ2VkLlByb3BlcnR5Lk1ldGhvZE1vZGlmaWVyLlB1dC5zdXBlckNsYXNzLnByZXBhcmVXcmFwcGVyLmNhbGwodGhpcywgcGFyYW1zKVxuICAgIH1cbiAgICBcbiAgICBcbn0pLmM7XG5Kb29zZS5NYW5hZ2VkLlByb3BlcnR5Lk1ldGhvZE1vZGlmaWVyLkFmdGVyID0gbmV3IEpvb3NlLlByb3RvLkNsYXNzKCdKb29zZS5NYW5hZ2VkLlByb3BlcnR5Lk1ldGhvZE1vZGlmaWVyLkFmdGVyJywge1xuICAgIFxuICAgIGlzYSA6IEpvb3NlLk1hbmFnZWQuUHJvcGVydHkuTWV0aG9kTW9kaWZpZXIsXG5cbiAgICBcbiAgICBwcmVwYXJlV3JhcHBlciA6IGZ1bmN0aW9uIChwYXJhbXMpIHtcbiAgICAgICAgXG4gICAgICAgIHZhciBtb2RpZmllciAgICAgICAgPSBwYXJhbXMubW9kaWZpZXJcbiAgICAgICAgdmFyIG9yaWdpbmFsQ2FsbCAgICA9IHBhcmFtcy5vcmlnaW5hbENhbGxcbiAgICAgICAgXG4gICAgICAgIHJldHVybiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB2YXIgcmVzID0gb3JpZ2luYWxDYWxsLmFwcGx5KHRoaXMsIGFyZ3VtZW50cylcbiAgICAgICAgICAgIG1vZGlmaWVyLmFwcGx5KHRoaXMsIGFyZ3VtZW50cylcbiAgICAgICAgICAgIHJldHVybiByZXNcbiAgICAgICAgfVxuICAgIH0gICAgXG5cbiAgICBcbn0pLmM7XG5Kb29zZS5NYW5hZ2VkLlByb3BlcnR5Lk1ldGhvZE1vZGlmaWVyLkJlZm9yZSA9IG5ldyBKb29zZS5Qcm90by5DbGFzcygnSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5NZXRob2RNb2RpZmllci5CZWZvcmUnLCB7XG4gICAgXG4gICAgaXNhIDogSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5NZXRob2RNb2RpZmllcixcblxuICAgIFxuICAgIHByZXBhcmVXcmFwcGVyIDogZnVuY3Rpb24gKHBhcmFtcykge1xuICAgICAgICBcbiAgICAgICAgdmFyIG1vZGlmaWVyICAgICAgICA9IHBhcmFtcy5tb2RpZmllclxuICAgICAgICB2YXIgb3JpZ2luYWxDYWxsICAgID0gcGFyYW1zLm9yaWdpbmFsQ2FsbFxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIG1vZGlmaWVyLmFwcGx5KHRoaXMsIGFyZ3VtZW50cylcbiAgICAgICAgICAgIHJldHVybiBvcmlnaW5hbENhbGwuYXBwbHkodGhpcywgYXJndW1lbnRzKVxuICAgICAgICB9XG4gICAgfVxuICAgIFxufSkuYztcbkpvb3NlLk1hbmFnZWQuUHJvcGVydHkuTWV0aG9kTW9kaWZpZXIuQXJvdW5kID0gbmV3IEpvb3NlLlByb3RvLkNsYXNzKCdKb29zZS5NYW5hZ2VkLlByb3BlcnR5Lk1ldGhvZE1vZGlmaWVyLkFyb3VuZCcsIHtcbiAgICBcbiAgICBpc2EgOiBKb29zZS5NYW5hZ2VkLlByb3BlcnR5Lk1ldGhvZE1vZGlmaWVyLFxuXG4gICAgcHJlcGFyZVdyYXBwZXIgOiBmdW5jdGlvbiAocGFyYW1zKSB7XG4gICAgICAgIFxuICAgICAgICB2YXIgbW9kaWZpZXIgICAgICAgID0gcGFyYW1zLm1vZGlmaWVyXG4gICAgICAgIHZhciBvcmlnaW5hbENhbGwgICAgPSBwYXJhbXMub3JpZ2luYWxDYWxsXG4gICAgICAgIFxuICAgICAgICB2YXIgbWVcbiAgICAgICAgXG4gICAgICAgIHZhciBib3VuZCA9IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHJldHVybiBvcmlnaW5hbENhbGwuYXBwbHkobWUsIGFyZ3VtZW50cylcbiAgICAgICAgfVxuICAgICAgICAgICAgXG4gICAgICAgIHJldHVybiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBtZSA9IHRoaXNcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdmFyIGJvdW5kQXJyID0gWyBib3VuZCBdXG4gICAgICAgICAgICBib3VuZEFyci5wdXNoLmFwcGx5KGJvdW5kQXJyLCBhcmd1bWVudHMpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHJldHVybiBtb2RpZmllci5hcHBseSh0aGlzLCBib3VuZEFycilcbiAgICAgICAgfVxuICAgIH1cbiAgICBcbn0pLmM7XG5Kb29zZS5NYW5hZ2VkLlByb3BlcnR5Lk1ldGhvZE1vZGlmaWVyLkF1Z21lbnQgPSBuZXcgSm9vc2UuUHJvdG8uQ2xhc3MoJ0pvb3NlLk1hbmFnZWQuUHJvcGVydHkuTWV0aG9kTW9kaWZpZXIuQXVnbWVudCcsIHtcbiAgICBcbiAgICBpc2EgOiBKb29zZS5NYW5hZ2VkLlByb3BlcnR5Lk1ldGhvZE1vZGlmaWVyLFxuXG4gICAgXG4gICAgcHJlcGFyZVdyYXBwZXIgOiBmdW5jdGlvbiAocGFyYW1zKSB7XG4gICAgICAgIFxuICAgICAgICB2YXIgQVVHTUVOVCA9IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy9wb3B1bGF0ZSBjYWxsc3RhY2sgdG8gdGhlIG1vc3QgZGVlcCBub24tYXVnbWVudCBtZXRob2RcbiAgICAgICAgICAgIHZhciBjYWxsc3RhY2sgPSBbXVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB2YXIgc2VsZiA9IEFVR01FTlRcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgZG8ge1xuICAgICAgICAgICAgICAgIGNhbGxzdGFjay5wdXNoKHNlbGYuSVNfQVVHTUVOVCA/IHNlbGYuX19DT05UQUlOX18gOiBzZWxmKVxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIHNlbGYgPSBzZWxmLklTX0FVR01FTlQgJiYgKHNlbGYuX19PUklHSU5BTF9fIHx8IHNlbGYuU1VQRVJbc2VsZi5tZXRob2ROYW1lXSlcbiAgICAgICAgICAgIH0gd2hpbGUgKHNlbGYpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy9zYXZlIHByZXZpb3VzIElOTkVSXG4gICAgICAgICAgICB2YXIgYmVmb3JlSU5ORVIgPSB0aGlzLklOTkVSXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vY3JlYXRlIG5ldyBJTk5FUlxuICAgICAgICAgICAgdGhpcy5JTk5FUiA9IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgICB2YXIgaW5uZXJDYWxsID0gY2FsbHN0YWNrLnBvcCgpXG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgcmV0dXJuIGlubmVyQ2FsbCA/IGlubmVyQ2FsbC5hcHBseSh0aGlzLCBhcmd1bWVudHMpIDogdW5kZWZpbmVkXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vYXVnbWVudCBtb2RpZmllciByZXN1bHRzIGluIGh5cG90ZXRpY2FsIElOTkVSIGNhbGwgb2YgdGhlIHNhbWUgbWV0aG9kIGluIHN1YmNsYXNzIFxuICAgICAgICAgICAgdmFyIHJlcyA9IHRoaXMuSU5ORVIuYXBwbHkodGhpcywgYXJndW1lbnRzKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICAvL3Jlc3RvcmUgcHJldmlvdXMgSU5ORVIgY2hhaW5cbiAgICAgICAgICAgIHRoaXMuSU5ORVIgPSBiZWZvcmVJTk5FUlxuICAgICAgICAgICAgXG4gICAgICAgICAgICByZXR1cm4gcmVzXG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgICAgIEFVR01FTlQubWV0aG9kTmFtZSAgPSBwYXJhbXMubmFtZVxuICAgICAgICBBVUdNRU5ULlNVUEVSICAgICAgID0gcGFyYW1zLnN1cGVyUHJvdG9cbiAgICAgICAgQVVHTUVOVC5JU19BVUdNRU5UICA9IHRydWVcbiAgICAgICAgXG4gICAgICAgIHJldHVybiBBVUdNRU5UXG4gICAgfVxuICAgIFxufSkuYztcbkpvb3NlLk1hbmFnZWQuUHJvcGVydHlTZXQgPSBuZXcgSm9vc2UuUHJvdG8uQ2xhc3MoJ0pvb3NlLk1hbmFnZWQuUHJvcGVydHlTZXQnLCB7XG4gICAgXG4gICAgaXNhICAgICAgICAgICAgICAgICAgICAgICA6IEpvb3NlLk1hbmFnZWQuUHJvcGVydHksXG5cbiAgICBwcm9wZXJ0aWVzICAgICAgICAgICAgICAgIDogbnVsbCxcbiAgICBcbiAgICBwcm9wZXJ0eU1ldGFDbGFzcyAgICAgICAgIDogSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eSxcbiAgICBcbiAgICBcbiAgICBpbml0aWFsaXplIDogZnVuY3Rpb24gKHByb3BzKSB7XG4gICAgICAgIEpvb3NlLk1hbmFnZWQuUHJvcGVydHlTZXQuc3VwZXJDbGFzcy5pbml0aWFsaXplLmNhbGwodGhpcywgcHJvcHMpXG4gICAgICAgIFxuICAgICAgICAvL1hYWCB0aGlzIGd1YXJkcyB0aGUgbWV0YSByb2xlcyA6KVxuICAgICAgICB0aGlzLnByb3BlcnRpZXMgPSBwcm9wcy5wcm9wZXJ0aWVzIHx8IHt9XG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBhZGRQcm9wZXJ0eSA6IGZ1bmN0aW9uIChuYW1lLCBwcm9wcykge1xuICAgICAgICB2YXIgbWV0YUNsYXNzID0gcHJvcHMubWV0YSB8fCB0aGlzLnByb3BlcnR5TWV0YUNsYXNzXG4gICAgICAgIGRlbGV0ZSBwcm9wcy5tZXRhXG4gICAgICAgIFxuICAgICAgICBwcm9wcy5kZWZpbmVkSW4gICAgID0gdGhpc1xuICAgICAgICBwcm9wcy5uYW1lICAgICAgICAgID0gbmFtZVxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIHRoaXMucHJvcGVydGllc1tuYW1lXSA9IG5ldyBtZXRhQ2xhc3MocHJvcHMpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBhZGRQcm9wZXJ0eU9iamVjdCA6IGZ1bmN0aW9uIChvYmplY3QpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMucHJvcGVydGllc1tvYmplY3QubmFtZV0gPSBvYmplY3RcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIHJlbW92ZVByb3BlcnR5IDogZnVuY3Rpb24gKG5hbWUpIHtcbiAgICAgICAgdmFyIHByb3AgPSB0aGlzLnByb3BlcnRpZXNbbmFtZV1cbiAgICAgICAgXG4gICAgICAgIGRlbGV0ZSB0aGlzLnByb3BlcnRpZXNbbmFtZV1cbiAgICAgICAgXG4gICAgICAgIHJldHVybiBwcm9wXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBoYXZlUHJvcGVydHkgOiBmdW5jdGlvbiAobmFtZSkge1xuICAgICAgICByZXR1cm4gdGhpcy5wcm9wZXJ0aWVzW25hbWVdICE9IG51bGxcbiAgICB9LFxuICAgIFxuXG4gICAgaGF2ZU93blByb3BlcnR5IDogZnVuY3Rpb24gKG5hbWUpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuaGF2ZVByb3BlcnR5KG5hbWUpICYmIHRoaXMucHJvcGVydGllcy5oYXNPd25Qcm9wZXJ0eShuYW1lKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgZ2V0UHJvcGVydHkgOiBmdW5jdGlvbiAobmFtZSkge1xuICAgICAgICByZXR1cm4gdGhpcy5wcm9wZXJ0aWVzW25hbWVdXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICAvL2luY2x1ZGVzIGluaGVyaXRlZCBwcm9wZXJ0aWVzIChwcm9iYWJseSB5b3Ugd2FudHMgJ2VhY2hPd24nLCB3aGljaCBwcm9jZXNzIG9ubHkgXCJvd25cIiAoaW5jbHVkaW5nIGNvbnN1bWVkIGZyb20gUm9sZXMpIHByb3BlcnRpZXMpIFxuICAgIGVhY2ggOiBmdW5jdGlvbiAoZnVuYywgc2NvcGUpIHtcbiAgICAgICAgSm9vc2UuTy5lYWNoKHRoaXMucHJvcGVydGllcywgZnVuYywgc2NvcGUgfHwgdGhpcylcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGVhY2hPd24gOiBmdW5jdGlvbiAoZnVuYywgc2NvcGUpIHtcbiAgICAgICAgSm9vc2UuTy5lYWNoT3duKHRoaXMucHJvcGVydGllcywgZnVuYywgc2NvcGUgfHwgdGhpcylcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIC8vc3lub255bSBmb3IgZWFjaFxuICAgIGVhY2hBbGwgOiBmdW5jdGlvbiAoZnVuYywgc2NvcGUpIHtcbiAgICAgICAgdGhpcy5lYWNoKGZ1bmMsIHNjb3BlKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgY2xvbmVQcm9wcyA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgdmFyIHByb3BzID0gSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eVNldC5zdXBlckNsYXNzLmNsb25lUHJvcHMuY2FsbCh0aGlzKVxuICAgICAgICBcbiAgICAgICAgcHJvcHMucHJvcGVydHlNZXRhQ2xhc3MgICAgID0gdGhpcy5wcm9wZXJ0eU1ldGFDbGFzc1xuICAgICAgICBcbiAgICAgICAgcmV0dXJuIHByb3BzXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBjbG9uZSA6IGZ1bmN0aW9uIChuYW1lKSB7XG4gICAgICAgIHZhciBjbG9uZSA9IHRoaXMuY2xlYW5DbG9uZShuYW1lKVxuICAgICAgICBcbiAgICAgICAgY2xvbmUucHJvcGVydGllcyA9IEpvb3NlLk8uY29weU93bih0aGlzLnByb3BlcnRpZXMpXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gY2xvbmVcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGNsZWFuQ2xvbmUgOiBmdW5jdGlvbiAobmFtZSkge1xuICAgICAgICB2YXIgcHJvcHMgPSB0aGlzLmNsb25lUHJvcHMoKVxuICAgICAgICBcbiAgICAgICAgcHJvcHMubmFtZSA9IG5hbWUgfHwgcHJvcHMubmFtZVxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIG5ldyB0aGlzLmNvbnN0cnVjdG9yKHByb3BzKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgYWxpYXMgOiBmdW5jdGlvbiAod2hhdCkge1xuICAgICAgICB2YXIgcHJvcHMgPSB0aGlzLnByb3BlcnRpZXNcbiAgICAgICAgXG4gICAgICAgIEpvb3NlLk8uZWFjaCh3aGF0LCBmdW5jdGlvbiAoYWxpYXNOYW1lLCBvcmlnaW5hbE5hbWUpIHtcbiAgICAgICAgICAgIHZhciBvcmlnaW5hbCA9IHByb3BzW29yaWdpbmFsTmFtZV1cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKG9yaWdpbmFsKSB0aGlzLmFkZFByb3BlcnR5T2JqZWN0KG9yaWdpbmFsLmNsb25lKGFsaWFzTmFtZSkpXG4gICAgICAgIH0sIHRoaXMpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBleGNsdWRlIDogZnVuY3Rpb24gKHdoYXQpIHtcbiAgICAgICAgdmFyIHByb3BzID0gdGhpcy5wcm9wZXJ0aWVzXG4gICAgICAgIFxuICAgICAgICBKb29zZS5BLmVhY2god2hhdCwgZnVuY3Rpb24gKG5hbWUpIHtcbiAgICAgICAgICAgIGRlbGV0ZSBwcm9wc1tuYW1lXVxuICAgICAgICB9KVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgYmVmb3JlQ29uc3VtZWRCeSA6IGZ1bmN0aW9uICgpIHtcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGZsYXR0ZW5UbyA6IGZ1bmN0aW9uICh0YXJnZXQpIHtcbiAgICAgICAgdmFyIHRhcmdldFByb3BzID0gdGFyZ2V0LnByb3BlcnRpZXNcbiAgICAgICAgXG4gICAgICAgIHRoaXMuZWFjaE93bihmdW5jdGlvbiAocHJvcGVydHksIG5hbWUpIHtcbiAgICAgICAgICAgIHZhciB0YXJnZXRQcm9wZXJ0eSA9IHRhcmdldFByb3BzW25hbWVdXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmICh0YXJnZXRQcm9wZXJ0eSBpbnN0YW5jZW9mIEpvb3NlLk1hbmFnZWQuUHJvcGVydHkuQ29uZmxpY3RNYXJrZXIpIHJldHVyblxuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAoIXRhcmdldFByb3BzLmhhc093blByb3BlcnR5KG5hbWUpIHx8IHRhcmdldFByb3BlcnR5ID09IG51bGwpIHtcbiAgICAgICAgICAgICAgICB0YXJnZXQuYWRkUHJvcGVydHlPYmplY3QocHJvcGVydHkpXG4gICAgICAgICAgICAgICAgcmV0dXJuXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmICh0YXJnZXRQcm9wZXJ0eSA9PSBwcm9wZXJ0eSkgcmV0dXJuXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRhcmdldC5yZW1vdmVQcm9wZXJ0eShuYW1lKVxuICAgICAgICAgICAgdGFyZ2V0LmFkZFByb3BlcnR5KG5hbWUsIHtcbiAgICAgICAgICAgICAgICBtZXRhIDogSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5Db25mbGljdE1hcmtlclxuICAgICAgICAgICAgfSlcbiAgICAgICAgfSwgdGhpcylcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGNvbXBvc2VUbyA6IGZ1bmN0aW9uICh0YXJnZXQpIHtcbiAgICAgICAgdGhpcy5lYWNoT3duKGZ1bmN0aW9uIChwcm9wZXJ0eSwgbmFtZSkge1xuICAgICAgICAgICAgaWYgKCF0YXJnZXQuaGF2ZU93blByb3BlcnR5KG5hbWUpKSB0YXJnZXQuYWRkUHJvcGVydHlPYmplY3QocHJvcGVydHkpXG4gICAgICAgIH0pXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBjb21wb3NlRnJvbSA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgaWYgKCFhcmd1bWVudHMubGVuZ3RoKSByZXR1cm5cbiAgICAgICAgXG4gICAgICAgIHZhciBmbGF0dGVuaW5nID0gdGhpcy5jbGVhbkNsb25lKClcbiAgICAgICAgXG4gICAgICAgIEpvb3NlLkEuZWFjaChhcmd1bWVudHMsIGZ1bmN0aW9uIChhcmcpIHtcbiAgICAgICAgICAgIHZhciBpc0Rlc2NyaXB0b3IgICAgPSAhKGFyZyBpbnN0YW5jZW9mIEpvb3NlLk1hbmFnZWQuUHJvcGVydHlTZXQpXG4gICAgICAgICAgICB2YXIgcHJvcFNldCAgICAgICAgID0gaXNEZXNjcmlwdG9yID8gYXJnLnByb3BlcnR5U2V0IDogYXJnXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHByb3BTZXQuYmVmb3JlQ29uc3VtZWRCeSh0aGlzLCBmbGF0dGVuaW5nKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAoaXNEZXNjcmlwdG9yKSB7XG4gICAgICAgICAgICAgICAgaWYgKGFyZy5hbGlhcyB8fCBhcmcuZXhjbHVkZSkgICBwcm9wU2V0ID0gcHJvcFNldC5jbG9uZSgpXG4gICAgICAgICAgICAgICAgaWYgKGFyZy5hbGlhcykgICAgICAgICAgICAgICAgICBwcm9wU2V0LmFsaWFzKGFyZy5hbGlhcylcbiAgICAgICAgICAgICAgICBpZiAoYXJnLmV4Y2x1ZGUpICAgICAgICAgICAgICAgIHByb3BTZXQuZXhjbHVkZShhcmcuZXhjbHVkZSlcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcHJvcFNldC5mbGF0dGVuVG8oZmxhdHRlbmluZylcbiAgICAgICAgfSwgdGhpcylcbiAgICAgICAgXG4gICAgICAgIGZsYXR0ZW5pbmcuY29tcG9zZVRvKHRoaXMpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBwcmVBcHBseSA6IGZ1bmN0aW9uICh0YXJnZXQpIHtcbiAgICAgICAgdGhpcy5lYWNoT3duKGZ1bmN0aW9uIChwcm9wZXJ0eSkge1xuICAgICAgICAgICAgcHJvcGVydHkucHJlQXBwbHkodGFyZ2V0KVxuICAgICAgICB9KVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgYXBwbHkgOiBmdW5jdGlvbiAodGFyZ2V0KSB7XG4gICAgICAgIHRoaXMuZWFjaE93bihmdW5jdGlvbiAocHJvcGVydHkpIHtcbiAgICAgICAgICAgIHByb3BlcnR5LmFwcGx5KHRhcmdldClcbiAgICAgICAgfSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIHVuYXBwbHkgOiBmdW5jdGlvbiAoZnJvbSkge1xuICAgICAgICB0aGlzLmVhY2hPd24oZnVuY3Rpb24gKHByb3BlcnR5KSB7XG4gICAgICAgICAgICBwcm9wZXJ0eS51bmFwcGx5KGZyb20pXG4gICAgICAgIH0pXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBwb3N0VW5BcHBseSA6IGZ1bmN0aW9uICh0YXJnZXQpIHtcbiAgICAgICAgdGhpcy5lYWNoT3duKGZ1bmN0aW9uIChwcm9wZXJ0eSkge1xuICAgICAgICAgICAgcHJvcGVydHkucG9zdFVuQXBwbHkodGFyZ2V0KVxuICAgICAgICB9KVxuICAgIH1cbiAgICBcbn0pLmNcbjtcbnZhciBfX0lEX18gPSAxXG5cblxuSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eVNldC5NdXRhYmxlID0gbmV3IEpvb3NlLlByb3RvLkNsYXNzKCdKb29zZS5NYW5hZ2VkLlByb3BlcnR5U2V0Lk11dGFibGUnLCB7XG4gICAgXG4gICAgaXNhICAgICAgICAgICAgICAgICA6IEpvb3NlLk1hbmFnZWQuUHJvcGVydHlTZXQsXG5cbiAgICBJRCAgICAgICAgICAgICAgICAgIDogbnVsbCxcbiAgICBcbiAgICBkZXJpdmF0aXZlcyAgICAgICAgIDogbnVsbCxcbiAgICBcbiAgICBvcGVuZWQgICAgICAgICAgICAgIDogbnVsbCxcbiAgICBcbiAgICBjb21wb3NlZEZyb20gICAgICAgIDogbnVsbCxcbiAgICBcbiAgICBcbiAgICBpbml0aWFsaXplIDogZnVuY3Rpb24gKHByb3BzKSB7XG4gICAgICAgIEpvb3NlLk1hbmFnZWQuUHJvcGVydHlTZXQuTXV0YWJsZS5zdXBlckNsYXNzLmluaXRpYWxpemUuY2FsbCh0aGlzLCBwcm9wcylcbiAgICAgICAgXG4gICAgICAgIC8vaW5pdGlhbGx5IG9wZW5lZFxuICAgICAgICB0aGlzLm9wZW5lZCAgICAgICAgICAgICA9IDFcbiAgICAgICAgdGhpcy5kZXJpdmF0aXZlcyAgICAgICAgPSB7fVxuICAgICAgICB0aGlzLklEICAgICAgICAgICAgICAgICA9IF9fSURfXysrXG4gICAgICAgIHRoaXMuY29tcG9zZWRGcm9tICAgICAgID0gW11cbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGFkZENvbXBvc2VJbmZvIDogZnVuY3Rpb24gKCkge1xuICAgICAgICB0aGlzLmVuc3VyZU9wZW4oKVxuICAgICAgICBcbiAgICAgICAgSm9vc2UuQS5lYWNoKGFyZ3VtZW50cywgZnVuY3Rpb24gKGFyZykge1xuICAgICAgICAgICAgdGhpcy5jb21wb3NlZEZyb20ucHVzaChhcmcpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciBwcm9wU2V0ID0gYXJnIGluc3RhbmNlb2YgSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eVNldCA/IGFyZyA6IGFyZy5wcm9wZXJ0eVNldFxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgcHJvcFNldC5kZXJpdmF0aXZlc1t0aGlzLklEXSA9IHRoaXNcbiAgICAgICAgfSwgdGhpcylcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIHJlbW92ZUNvbXBvc2VJbmZvIDogZnVuY3Rpb24gKCkge1xuICAgICAgICB0aGlzLmVuc3VyZU9wZW4oKVxuICAgICAgICBcbiAgICAgICAgSm9vc2UuQS5lYWNoKGFyZ3VtZW50cywgZnVuY3Rpb24gKGFyZykge1xuICAgICAgICAgICAgXG4gICAgICAgICAgICB2YXIgaSA9IDBcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgd2hpbGUgKGkgPCB0aGlzLmNvbXBvc2VkRnJvbS5sZW5ndGgpIHtcbiAgICAgICAgICAgICAgICB2YXIgcHJvcFNldCA9IHRoaXMuY29tcG9zZWRGcm9tW2ldXG4gICAgICAgICAgICAgICAgcHJvcFNldCA9IHByb3BTZXQgaW5zdGFuY2VvZiBKb29zZS5NYW5hZ2VkLlByb3BlcnR5U2V0ID8gcHJvcFNldCA6IHByb3BTZXQucHJvcGVydHlTZXRcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBpZiAoYXJnID09IHByb3BTZXQpIHtcbiAgICAgICAgICAgICAgICAgICAgZGVsZXRlIHByb3BTZXQuZGVyaXZhdGl2ZXNbdGhpcy5JRF1cbiAgICAgICAgICAgICAgICAgICAgdGhpcy5jb21wb3NlZEZyb20uc3BsaWNlKGksIDEpXG4gICAgICAgICAgICAgICAgfSBlbHNlIGkrK1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgXG4gICAgICAgIH0sIHRoaXMpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBlbnN1cmVPcGVuIDogZnVuY3Rpb24gKCkge1xuICAgICAgICBpZiAoIXRoaXMub3BlbmVkKSB0aHJvdyBcIk11dGF0aW9uIG9mIGNsb3NlZCBwcm9wZXJ0eSBzZXQ6IFtcIiArIHRoaXMubmFtZSArIFwiXVwiXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBhZGRQcm9wZXJ0eSA6IGZ1bmN0aW9uIChuYW1lLCBwcm9wcykge1xuICAgICAgICB0aGlzLmVuc3VyZU9wZW4oKVxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIEpvb3NlLk1hbmFnZWQuUHJvcGVydHlTZXQuTXV0YWJsZS5zdXBlckNsYXNzLmFkZFByb3BlcnR5LmNhbGwodGhpcywgbmFtZSwgcHJvcHMpXG4gICAgfSxcbiAgICBcblxuICAgIGFkZFByb3BlcnR5T2JqZWN0IDogZnVuY3Rpb24gKG9iamVjdCkge1xuICAgICAgICB0aGlzLmVuc3VyZU9wZW4oKVxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIEpvb3NlLk1hbmFnZWQuUHJvcGVydHlTZXQuTXV0YWJsZS5zdXBlckNsYXNzLmFkZFByb3BlcnR5T2JqZWN0LmNhbGwodGhpcywgb2JqZWN0KVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgcmVtb3ZlUHJvcGVydHkgOiBmdW5jdGlvbiAobmFtZSkge1xuICAgICAgICB0aGlzLmVuc3VyZU9wZW4oKVxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIEpvb3NlLk1hbmFnZWQuUHJvcGVydHlTZXQuTXV0YWJsZS5zdXBlckNsYXNzLnJlbW92ZVByb3BlcnR5LmNhbGwodGhpcywgbmFtZSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGNvbXBvc2VGcm9tIDogZnVuY3Rpb24gKCkge1xuICAgICAgICB0aGlzLmVuc3VyZU9wZW4oKVxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIEpvb3NlLk1hbmFnZWQuUHJvcGVydHlTZXQuTXV0YWJsZS5zdXBlckNsYXNzLmNvbXBvc2VGcm9tLmFwcGx5KHRoaXMsIHRoaXMuY29tcG9zZWRGcm9tKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgb3BlbiA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgdGhpcy5vcGVuZWQrK1xuICAgICAgICBcbiAgICAgICAgaWYgKHRoaXMub3BlbmVkID09IDEpIHtcbiAgICAgICAgXG4gICAgICAgICAgICBKb29zZS5PLmVhY2godGhpcy5kZXJpdmF0aXZlcywgZnVuY3Rpb24gKHByb3BTZXQpIHtcbiAgICAgICAgICAgICAgICBwcm9wU2V0Lm9wZW4oKVxuICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpcy5kZUNvbXBvc2UoKVxuICAgICAgICB9XG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBjbG9zZSA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgaWYgKCF0aGlzLm9wZW5lZCkgdGhyb3cgXCJVbm1hdGNoZWQgJ2Nsb3NlJyBvcGVyYXRpb24gb24gcHJvcGVydHkgc2V0OiBbXCIgKyB0aGlzLm5hbWUgKyBcIl1cIlxuICAgICAgICBcbiAgICAgICAgaWYgKHRoaXMub3BlbmVkID09IDEpIHtcbiAgICAgICAgICAgIHRoaXMucmVDb21wb3NlKClcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgSm9vc2UuTy5lYWNoKHRoaXMuZGVyaXZhdGl2ZXMsIGZ1bmN0aW9uIChwcm9wU2V0KSB7XG4gICAgICAgICAgICAgICAgcHJvcFNldC5jbG9zZSgpXG4gICAgICAgICAgICB9KVxuICAgICAgICB9XG4gICAgICAgIHRoaXMub3BlbmVkLS1cbiAgICB9LFxuICAgIFxuICAgIFxuICAgIHJlQ29tcG9zZSA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgdGhpcy5jb21wb3NlRnJvbSgpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBkZUNvbXBvc2UgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHRoaXMuZWFjaE93bihmdW5jdGlvbiAocHJvcGVydHksIG5hbWUpIHtcbiAgICAgICAgICAgIGlmIChwcm9wZXJ0eS5kZWZpbmVkSW4gIT0gdGhpcykgdGhpcy5yZW1vdmVQcm9wZXJ0eShuYW1lKVxuICAgICAgICB9LCB0aGlzKVxuICAgIH1cbiAgICBcbn0pLmM7XG5Kb29zZS5NYW5hZ2VkLlN0ZW1FbGVtZW50ID0gZnVuY3Rpb24gKCkgeyB0aHJvdyBcIk1vZHVsZXMgbWF5IG5vdCBiZSBpbnN0YW50aWF0ZWQuXCIgfVxuXG5Kb29zZS5NYW5hZ2VkLlN0ZW1FbGVtZW50LkF0dHJpYnV0ZXMgPSBuZXcgSm9vc2UuUHJvdG8uQ2xhc3MoJ0pvb3NlLk1hbmFnZWQuU3RlbUVsZW1lbnQuQXR0cmlidXRlcycsIHtcbiAgICBcbiAgICBpc2EgICAgICAgICAgICAgICAgICAgICA6IEpvb3NlLk1hbmFnZWQuUHJvcGVydHlTZXQuTXV0YWJsZSxcbiAgICBcbiAgICBwcm9wZXJ0eU1ldGFDbGFzcyAgICAgICA6IEpvb3NlLk1hbmFnZWQuUHJvcGVydHkuQXR0cmlidXRlXG4gICAgXG59KS5jXG47XG5Kb29zZS5NYW5hZ2VkLlN0ZW1FbGVtZW50Lk1ldGhvZHMgPSBuZXcgSm9vc2UuUHJvdG8uQ2xhc3MoJ0pvb3NlLk1hbmFnZWQuU3RlbUVsZW1lbnQuTWV0aG9kcycsIHtcbiAgICBcbiAgICBpc2EgOiBKb29zZS5NYW5hZ2VkLlByb3BlcnR5U2V0Lk11dGFibGUsXG4gICAgXG4gICAgcHJvcGVydHlNZXRhQ2xhc3MgOiBKb29zZS5NYW5hZ2VkLlByb3BlcnR5Lk1ldGhvZE1vZGlmaWVyLlB1dCxcblxuICAgIFxuICAgIHByZUFwcGx5IDogZnVuY3Rpb24gKCkge1xuICAgIH0sXG4gICAgXG4gICAgXG4gICAgcG9zdFVuQXBwbHkgOiBmdW5jdGlvbiAoKSB7XG4gICAgfVxuICAgIFxufSkuYztcbkpvb3NlLk1hbmFnZWQuU3RlbUVsZW1lbnQuUmVxdWlyZW1lbnRzID0gbmV3IEpvb3NlLlByb3RvLkNsYXNzKCdKb29zZS5NYW5hZ2VkLlN0ZW1FbGVtZW50LlJlcXVpcmVtZW50cycsIHtcblxuICAgIGlzYSAgICAgICAgICAgICAgICAgICAgIDogSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eVNldC5NdXRhYmxlLFxuICAgIFxuICAgIHByb3BlcnR5TWV0YUNsYXNzICAgICAgIDogSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5SZXF1aXJlbWVudCxcbiAgICBcbiAgICBcbiAgICBcbiAgICBhbGlhcyA6IGZ1bmN0aW9uICgpIHtcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGV4Y2x1ZGUgOiBmdW5jdGlvbiAoKSB7XG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBmbGF0dGVuVG8gOiBmdW5jdGlvbiAodGFyZ2V0KSB7XG4gICAgICAgIHRoaXMuZWFjaChmdW5jdGlvbiAocHJvcGVydHksIG5hbWUpIHtcbiAgICAgICAgICAgIGlmICghdGFyZ2V0LmhhdmVQcm9wZXJ0eShuYW1lKSkgdGFyZ2V0LmFkZFByb3BlcnR5T2JqZWN0KHByb3BlcnR5KVxuICAgICAgICB9KVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgY29tcG9zZVRvIDogZnVuY3Rpb24gKHRhcmdldCkge1xuICAgICAgICB0aGlzLmZsYXR0ZW5Ubyh0YXJnZXQpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBwcmVBcHBseSA6IGZ1bmN0aW9uICgpIHtcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIHBvc3RVbkFwcGx5IDogZnVuY3Rpb24gKCkge1xuICAgIH1cbiAgICBcbn0pLmM7XG5Kb29zZS5NYW5hZ2VkLlN0ZW1FbGVtZW50Lk1ldGhvZE1vZGlmaWVycyA9IG5ldyBKb29zZS5Qcm90by5DbGFzcygnSm9vc2UuTWFuYWdlZC5TdGVtRWxlbWVudC5NZXRob2RNb2RpZmllcnMnLCB7XG5cbiAgICBpc2EgICAgICAgICAgICAgICAgICAgICA6IEpvb3NlLk1hbmFnZWQuUHJvcGVydHlTZXQuTXV0YWJsZSxcbiAgICBcbiAgICBwcm9wZXJ0eU1ldGFDbGFzcyAgICAgICA6IG51bGwsXG4gICAgXG4gICAgXG4gICAgYWRkUHJvcGVydHkgOiBmdW5jdGlvbiAobmFtZSwgcHJvcHMpIHtcbiAgICAgICAgdmFyIG1ldGFDbGFzcyA9IHByb3BzLm1ldGFcbiAgICAgICAgZGVsZXRlIHByb3BzLm1ldGFcbiAgICAgICAgXG4gICAgICAgIHByb3BzLmRlZmluZWRJbiAgICAgICAgID0gdGhpc1xuICAgICAgICBwcm9wcy5uYW1lICAgICAgICAgICAgICA9IG5hbWVcbiAgICAgICAgXG4gICAgICAgIHZhciBtb2RpZmllciAgICAgICAgICAgID0gbmV3IG1ldGFDbGFzcyhwcm9wcylcbiAgICAgICAgdmFyIHByb3BlcnRpZXMgICAgICAgICAgPSB0aGlzLnByb3BlcnRpZXNcbiAgICAgICAgXG4gICAgICAgIGlmICghcHJvcGVydGllc1tuYW1lXSkgcHJvcGVydGllc1sgbmFtZSBdID0gW11cbiAgICAgICAgXG4gICAgICAgIHByb3BlcnRpZXNbbmFtZV0ucHVzaChtb2RpZmllcilcbiAgICAgICAgXG4gICAgICAgIHJldHVybiBtb2RpZmllclxuICAgIH0sXG4gICAgXG5cbiAgICBhZGRQcm9wZXJ0eU9iamVjdCA6IGZ1bmN0aW9uIChvYmplY3QpIHtcbiAgICAgICAgdmFyIG5hbWUgICAgICAgICAgICA9IG9iamVjdC5uYW1lXG4gICAgICAgIHZhciBwcm9wZXJ0aWVzICAgICAgPSB0aGlzLnByb3BlcnRpZXNcbiAgICAgICAgXG4gICAgICAgIGlmICghcHJvcGVydGllc1tuYW1lXSkgcHJvcGVydGllc1tuYW1lXSA9IFtdXG4gICAgICAgIFxuICAgICAgICBwcm9wZXJ0aWVzW25hbWVdLnB1c2gob2JqZWN0KVxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIG9iamVjdFxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgLy9yZW1vdmUgb25seSB0aGUgbGFzdCBtb2RpZmllclxuICAgIHJlbW92ZVByb3BlcnR5IDogZnVuY3Rpb24gKG5hbWUpIHtcbiAgICAgICAgaWYgKCF0aGlzLmhhdmVQcm9wZXJ0eShuYW1lKSkgcmV0dXJuIHVuZGVmaW5lZFxuICAgICAgICBcbiAgICAgICAgdmFyIHByb3BlcnRpZXMgICAgICA9IHRoaXMucHJvcGVydGllc1xuICAgICAgICB2YXIgbW9kaWZpZXIgICAgICAgID0gcHJvcGVydGllc1sgbmFtZSBdLnBvcCgpXG4gICAgICAgIFxuICAgICAgICAvL2lmIGFsbCBtb2RpZmllcnMgd2VyZSByZW1vdmVkIC0gY2xlYXJpbmcgdGhlIHByb3BlcnRpZXNcbiAgICAgICAgaWYgKCFwcm9wZXJ0aWVzW25hbWVdLmxlbmd0aCkgSm9vc2UuTWFuYWdlZC5TdGVtRWxlbWVudC5NZXRob2RNb2RpZmllcnMuc3VwZXJDbGFzcy5yZW1vdmVQcm9wZXJ0eS5jYWxsKHRoaXMsIG5hbWUpXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gbW9kaWZpZXJcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGFsaWFzIDogZnVuY3Rpb24gKCkge1xuICAgIH0sXG4gICAgXG4gICAgXG4gICAgZXhjbHVkZSA6IGZ1bmN0aW9uICgpIHtcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGZsYXR0ZW5UbyA6IGZ1bmN0aW9uICh0YXJnZXQpIHtcbiAgICAgICAgdmFyIHRhcmdldFByb3BzID0gdGFyZ2V0LnByb3BlcnRpZXNcbiAgICAgICAgXG4gICAgICAgIHRoaXMuZWFjaChmdW5jdGlvbiAobW9kaWZpZXJzQXJyLCBuYW1lKSB7XG4gICAgICAgICAgICB2YXIgdGFyZ2V0TW9kaWZpZXJzQXJyID0gdGFyZ2V0UHJvcHNbbmFtZV1cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKHRhcmdldE1vZGlmaWVyc0FyciA9PSBudWxsKSB0YXJnZXRNb2RpZmllcnNBcnIgPSB0YXJnZXRQcm9wc1tuYW1lXSA9IFtdXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIEpvb3NlLkEuZWFjaChtb2RpZmllcnNBcnIsIGZ1bmN0aW9uIChtb2RpZmllcikge1xuICAgICAgICAgICAgICAgIGlmICghSm9vc2UuQS5leGlzdHModGFyZ2V0TW9kaWZpZXJzQXJyLCBtb2RpZmllcikpIHRhcmdldE1vZGlmaWVyc0Fyci5wdXNoKG1vZGlmaWVyKVxuICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIFxuICAgICAgICB9KVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgY29tcG9zZVRvIDogZnVuY3Rpb24gKHRhcmdldCkge1xuICAgICAgICB0aGlzLmZsYXR0ZW5Ubyh0YXJnZXQpXG4gICAgfSxcblxuICAgIFxuICAgIGRlQ29tcG9zZSA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgdGhpcy5lYWNoKGZ1bmN0aW9uIChtb2RpZmllcnNBcnIsIG5hbWUpIHtcbiAgICAgICAgICAgIHZhciBpID0gMFxuICAgICAgICAgICAgXG4gICAgICAgICAgICB3aGlsZSAoaSA8IG1vZGlmaWVyc0Fyci5sZW5ndGgpIFxuICAgICAgICAgICAgICAgIGlmIChtb2RpZmllcnNBcnJbaV0uZGVmaW5lZEluICE9IHRoaXMpIFxuICAgICAgICAgICAgICAgICAgICBtb2RpZmllcnNBcnIuc3BsaWNlKGksIDEpXG4gICAgICAgICAgICAgICAgZWxzZSBcbiAgICAgICAgICAgICAgICAgICAgaSsrXG4gICAgICAgIH0pXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBwcmVBcHBseSA6IGZ1bmN0aW9uICh0YXJnZXQpIHtcbiAgICB9LFxuXG4gICAgXG4gICAgcG9zdFVuQXBwbHkgOiBmdW5jdGlvbiAodGFyZ2V0KSB7XG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBhcHBseSA6IGZ1bmN0aW9uICh0YXJnZXQpIHtcbiAgICAgICAgdGhpcy5lYWNoKGZ1bmN0aW9uIChtb2RpZmllcnNBcnIsIG5hbWUpIHtcbiAgICAgICAgICAgIEpvb3NlLkEuZWFjaChtb2RpZmllcnNBcnIsIGZ1bmN0aW9uIChtb2RpZmllcikge1xuICAgICAgICAgICAgICAgIG1vZGlmaWVyLmFwcGx5KHRhcmdldClcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH0pXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICB1bmFwcGx5IDogZnVuY3Rpb24gKGZyb20pIHtcbiAgICAgICAgdGhpcy5lYWNoKGZ1bmN0aW9uIChtb2RpZmllcnNBcnIsIG5hbWUpIHtcbiAgICAgICAgICAgIGZvciAodmFyIGkgPSBtb2RpZmllcnNBcnIubGVuZ3RoIC0gMTsgaSA+PTAgOyBpLS0pIG1vZGlmaWVyc0FycltpXS51bmFwcGx5KGZyb20pXG4gICAgICAgIH0pXG4gICAgfVxuICAgIFxuICAgIFxuICAgIFxufSkuYztcbkpvb3NlLk1hbmFnZWQuUHJvcGVydHlTZXQuQ29tcG9zaXRpb24gPSBuZXcgSm9vc2UuUHJvdG8uQ2xhc3MoJ0pvb3NlLk1hbmFnZWQuUHJvcGVydHlTZXQuQ29tcG9zaXRpb24nLCB7XG4gICAgXG4gICAgaXNhICAgICAgICAgICAgICAgICAgICAgICAgIDogSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eVNldC5NdXRhYmxlLFxuICAgIFxuICAgIHByb3BlcnR5TWV0YUNsYXNzICAgICAgICAgICA6IEpvb3NlLk1hbmFnZWQuUHJvcGVydHlTZXQuTXV0YWJsZSxcbiAgICBcbiAgICBwcm9jZXNzT3JkZXIgICAgICAgICAgICAgICAgOiBudWxsLFxuXG4gICAgXG4gICAgZWFjaCA6IGZ1bmN0aW9uIChmdW5jLCBzY29wZSkge1xuICAgICAgICB2YXIgcHJvcHMgICA9IHRoaXMucHJvcGVydGllc1xuICAgICAgICB2YXIgc2NvcGUgICA9IHNjb3BlIHx8IHRoaXNcbiAgICAgICAgXG4gICAgICAgIEpvb3NlLkEuZWFjaCh0aGlzLnByb2Nlc3NPcmRlciwgZnVuY3Rpb24gKG5hbWUpIHtcbiAgICAgICAgICAgIGZ1bmMuY2FsbChzY29wZSwgcHJvcHNbbmFtZV0sIG5hbWUpXG4gICAgICAgIH0pXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBlYWNoUiA6IGZ1bmN0aW9uIChmdW5jLCBzY29wZSkge1xuICAgICAgICB2YXIgcHJvcHMgICA9IHRoaXMucHJvcGVydGllc1xuICAgICAgICB2YXIgc2NvcGUgICA9IHNjb3BlIHx8IHRoaXNcbiAgICAgICAgXG4gICAgICAgIEpvb3NlLkEuZWFjaFIodGhpcy5wcm9jZXNzT3JkZXIsIGZ1bmN0aW9uIChuYW1lKSB7XG4gICAgICAgICAgICBmdW5jLmNhbGwoc2NvcGUsIHByb3BzW25hbWVdLCBuYW1lKVxuICAgICAgICB9KVxuICAgICAgICBcbiAgICAgICAgXG4vLyAgICAgICAgdmFyIHByb3BzICAgICAgICAgICA9IHRoaXMucHJvcGVydGllc1xuLy8gICAgICAgIHZhciBwcm9jZXNzT3JkZXIgICAgPSB0aGlzLnByb2Nlc3NPcmRlclxuLy8gICAgICAgIFxuLy8gICAgICAgIGZvcih2YXIgaSA9IHByb2Nlc3NPcmRlci5sZW5ndGggLSAxOyBpID49IDA7IGktLSkgXG4vLyAgICAgICAgICAgIGZ1bmMuY2FsbChzY29wZSB8fCB0aGlzLCBwcm9wc1sgcHJvY2Vzc09yZGVyW2ldIF0sIHByb2Nlc3NPcmRlcltpXSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGNsb25lIDogZnVuY3Rpb24gKG5hbWUpIHtcbiAgICAgICAgdmFyIGNsb25lID0gdGhpcy5jbGVhbkNsb25lKG5hbWUpXG4gICAgICAgIFxuICAgICAgICB0aGlzLmVhY2goZnVuY3Rpb24gKHByb3BlcnR5KSB7XG4gICAgICAgICAgICBjbG9uZS5hZGRQcm9wZXJ0eU9iamVjdChwcm9wZXJ0eS5jbG9uZSgpKVxuICAgICAgICB9KVxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIGNsb25lXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBhbGlhcyA6IGZ1bmN0aW9uICh3aGF0KSB7XG4gICAgICAgIHRoaXMuZWFjaChmdW5jdGlvbiAocHJvcGVydHkpIHtcbiAgICAgICAgICAgIHByb3BlcnR5LmFsaWFzKHdoYXQpXG4gICAgICAgIH0pXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBleGNsdWRlIDogZnVuY3Rpb24gKHdoYXQpIHtcbiAgICAgICAgdGhpcy5lYWNoKGZ1bmN0aW9uIChwcm9wZXJ0eSkge1xuICAgICAgICAgICAgcHJvcGVydHkuZXhjbHVkZSh3aGF0KVxuICAgICAgICB9KVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgZmxhdHRlblRvIDogZnVuY3Rpb24gKHRhcmdldCkge1xuICAgICAgICB2YXIgdGFyZ2V0UHJvcHMgPSB0YXJnZXQucHJvcGVydGllc1xuICAgICAgICBcbiAgICAgICAgdGhpcy5lYWNoKGZ1bmN0aW9uIChwcm9wZXJ0eSwgbmFtZSkge1xuICAgICAgICAgICAgdmFyIHN1YlRhcmdldCA9IHRhcmdldFByb3BzW25hbWVdIHx8IHRhcmdldC5hZGRQcm9wZXJ0eShuYW1lLCB7XG4gICAgICAgICAgICAgICAgbWV0YSA6IHByb3BlcnR5LmNvbnN0cnVjdG9yXG4gICAgICAgICAgICB9KVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBwcm9wZXJ0eS5mbGF0dGVuVG8oc3ViVGFyZ2V0KVxuICAgICAgICB9KVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgY29tcG9zZVRvIDogZnVuY3Rpb24gKHRhcmdldCkge1xuICAgICAgICB2YXIgdGFyZ2V0UHJvcHMgPSB0YXJnZXQucHJvcGVydGllc1xuICAgICAgICBcbiAgICAgICAgdGhpcy5lYWNoKGZ1bmN0aW9uIChwcm9wZXJ0eSwgbmFtZSkge1xuICAgICAgICAgICAgdmFyIHN1YlRhcmdldCA9IHRhcmdldFByb3BzW25hbWVdIHx8IHRhcmdldC5hZGRQcm9wZXJ0eShuYW1lLCB7XG4gICAgICAgICAgICAgICAgbWV0YSA6IHByb3BlcnR5LmNvbnN0cnVjdG9yXG4gICAgICAgICAgICB9KVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBwcm9wZXJ0eS5jb21wb3NlVG8oc3ViVGFyZ2V0KVxuICAgICAgICB9KVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgXG4gICAgZGVDb21wb3NlIDogZnVuY3Rpb24gKCkge1xuICAgICAgICB0aGlzLmVhY2hSKGZ1bmN0aW9uIChwcm9wZXJ0eSkge1xuICAgICAgICAgICAgcHJvcGVydHkub3BlbigpXG4gICAgICAgIH0pXG4gICAgICAgIFxuICAgICAgICBKb29zZS5NYW5hZ2VkLlByb3BlcnR5U2V0LkNvbXBvc2l0aW9uLnN1cGVyQ2xhc3MuZGVDb21wb3NlLmNhbGwodGhpcylcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIHJlQ29tcG9zZSA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eVNldC5Db21wb3NpdGlvbi5zdXBlckNsYXNzLnJlQ29tcG9zZS5jYWxsKHRoaXMpXG4gICAgICAgIFxuICAgICAgICB0aGlzLmVhY2goZnVuY3Rpb24gKHByb3BlcnR5KSB7XG4gICAgICAgICAgICBwcm9wZXJ0eS5jbG9zZSgpXG4gICAgICAgIH0pXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICB1bmFwcGx5IDogZnVuY3Rpb24gKGZyb20pIHtcbiAgICAgICAgdGhpcy5lYWNoUihmdW5jdGlvbiAocHJvcGVydHkpIHtcbiAgICAgICAgICAgIHByb3BlcnR5LnVuYXBwbHkoZnJvbSlcbiAgICAgICAgfSlcbiAgICB9XG4gICAgXG59KS5jXG47XG5Kb29zZS5NYW5hZ2VkLlN0ZW0gPSBuZXcgSm9vc2UuUHJvdG8uQ2xhc3MoJ0pvb3NlLk1hbmFnZWQuU3RlbScsIHtcbiAgICBcbiAgICBpc2EgICAgICAgICAgICAgICAgICA6IEpvb3NlLk1hbmFnZWQuUHJvcGVydHlTZXQuQ29tcG9zaXRpb24sXG4gICAgXG4gICAgdGFyZ2V0TWV0YSAgICAgICAgICAgOiBudWxsLFxuICAgIFxuICAgIGF0dHJpYnV0ZXNNQyAgICAgICAgIDogSm9vc2UuTWFuYWdlZC5TdGVtRWxlbWVudC5BdHRyaWJ1dGVzLFxuICAgIG1ldGhvZHNNQyAgICAgICAgICAgIDogSm9vc2UuTWFuYWdlZC5TdGVtRWxlbWVudC5NZXRob2RzLFxuICAgIHJlcXVpcmVtZW50c01DICAgICAgIDogSm9vc2UuTWFuYWdlZC5TdGVtRWxlbWVudC5SZXF1aXJlbWVudHMsXG4gICAgbWV0aG9kc01vZGlmaWVyc01DICAgOiBKb29zZS5NYW5hZ2VkLlN0ZW1FbGVtZW50Lk1ldGhvZE1vZGlmaWVycyxcbiAgICBcbiAgICBwcm9jZXNzT3JkZXIgICAgICAgICA6IFsgJ2F0dHJpYnV0ZXMnLCAnbWV0aG9kcycsICdyZXF1aXJlbWVudHMnLCAnbWV0aG9kc01vZGlmaWVycycgXSxcbiAgICBcbiAgICBcbiAgICBpbml0aWFsaXplIDogZnVuY3Rpb24gKHByb3BzKSB7XG4gICAgICAgIEpvb3NlLk1hbmFnZWQuU3RlbS5zdXBlckNsYXNzLmluaXRpYWxpemUuY2FsbCh0aGlzLCBwcm9wcylcbiAgICAgICAgXG4gICAgICAgIHZhciB0YXJnZXRNZXRhID0gdGhpcy50YXJnZXRNZXRhXG4gICAgICAgIFxuICAgICAgICB0aGlzLmFkZFByb3BlcnR5KCdhdHRyaWJ1dGVzJywge1xuICAgICAgICAgICAgbWV0YSA6IHRoaXMuYXR0cmlidXRlc01DLFxuICAgICAgICAgICAgXG4gICAgICAgICAgICAvL2l0IGNhbiBiZSBubyAndGFyZ2V0TWV0YScgaW4gY2xvbmVzXG4gICAgICAgICAgICBwcm9wZXJ0aWVzIDogdGFyZ2V0TWV0YSA/IHRhcmdldE1ldGEuYXR0cmlidXRlcyA6IHt9XG4gICAgICAgIH0pXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgdGhpcy5hZGRQcm9wZXJ0eSgnbWV0aG9kcycsIHtcbiAgICAgICAgICAgIG1ldGEgOiB0aGlzLm1ldGhvZHNNQyxcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcHJvcGVydGllcyA6IHRhcmdldE1ldGEgPyB0YXJnZXRNZXRhLm1ldGhvZHMgOiB7fVxuICAgICAgICB9KVxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIHRoaXMuYWRkUHJvcGVydHkoJ3JlcXVpcmVtZW50cycsIHtcbiAgICAgICAgICAgIG1ldGEgOiB0aGlzLnJlcXVpcmVtZW50c01DXG4gICAgICAgIH0pXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgdGhpcy5hZGRQcm9wZXJ0eSgnbWV0aG9kc01vZGlmaWVycycsIHtcbiAgICAgICAgICAgIG1ldGEgOiB0aGlzLm1ldGhvZHNNb2RpZmllcnNNQ1xuICAgICAgICB9KVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgcmVDb21wb3NlIDogZnVuY3Rpb24gKCkge1xuICAgICAgICB2YXIgYyAgICAgICA9IHRoaXMudGFyZ2V0TWV0YS5jXG4gICAgICAgIFxuICAgICAgICB0aGlzLnByZUFwcGx5KGMpXG4gICAgICAgIFxuICAgICAgICBKb29zZS5NYW5hZ2VkLlN0ZW0uc3VwZXJDbGFzcy5yZUNvbXBvc2UuY2FsbCh0aGlzKVxuICAgICAgICBcbiAgICAgICAgdGhpcy5hcHBseShjKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgZGVDb21wb3NlIDogZnVuY3Rpb24gKCkge1xuICAgICAgICB2YXIgYyAgICAgICA9IHRoaXMudGFyZ2V0TWV0YS5jXG4gICAgICAgIFxuICAgICAgICB0aGlzLnVuYXBwbHkoYylcbiAgICAgICAgXG4gICAgICAgIEpvb3NlLk1hbmFnZWQuU3RlbS5zdXBlckNsYXNzLmRlQ29tcG9zZS5jYWxsKHRoaXMpXG4gICAgICAgIFxuICAgICAgICB0aGlzLnBvc3RVbkFwcGx5KGMpXG4gICAgfVxuICAgIFxuICAgIFxufSkuY1xuO1xuSm9vc2UuTWFuYWdlZC5CdWlsZGVyID0gbmV3IEpvb3NlLlByb3RvLkNsYXNzKCdKb29zZS5NYW5hZ2VkLkJ1aWxkZXInLCB7XG4gICAgXG4gICAgdGFyZ2V0TWV0YSAgICAgICAgICA6IG51bGwsXG4gICAgXG4gICAgXG4gICAgX2J1aWxkU3RhcnQgOiBmdW5jdGlvbiAodGFyZ2V0TWV0YSwgcHJvcHMpIHtcbiAgICAgICAgdGFyZ2V0TWV0YS5zdGVtLm9wZW4oKVxuICAgICAgICBcbiAgICAgICAgSm9vc2UuQS5lYWNoKFsgJ3RyYWl0JywgJ3RyYWl0cycsICdyZW1vdmVUcmFpdCcsICdyZW1vdmVUcmFpdHMnLCAnZG9lcycsICdkb2Vzbm90JywgJ2RvZXNudCcgXSwgZnVuY3Rpb24gKGJ1aWxkZXIpIHtcbiAgICAgICAgICAgIGlmIChwcm9wc1tidWlsZGVyXSkge1xuICAgICAgICAgICAgICAgIHRoaXNbYnVpbGRlcl0odGFyZ2V0TWV0YSwgcHJvcHNbYnVpbGRlcl0pXG4gICAgICAgICAgICAgICAgZGVsZXRlIHByb3BzW2J1aWxkZXJdXG4gICAgICAgICAgICB9XG4gICAgICAgIH0sIHRoaXMpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBfZXh0ZW5kIDogZnVuY3Rpb24gKHByb3BzKSB7XG4gICAgICAgIGlmIChKb29zZS5PLmlzRW1wdHkocHJvcHMpKSByZXR1cm5cbiAgICAgICAgXG4gICAgICAgIHZhciB0YXJnZXRNZXRhID0gdGhpcy50YXJnZXRNZXRhXG4gICAgICAgIFxuICAgICAgICB0aGlzLl9idWlsZFN0YXJ0KHRhcmdldE1ldGEsIHByb3BzKVxuICAgICAgICBcbiAgICAgICAgSm9vc2UuTy5lYWNoT3duKHByb3BzLCBmdW5jdGlvbiAodmFsdWUsIG5hbWUpIHtcbiAgICAgICAgICAgIHZhciBoYW5kbGVyID0gdGhpc1tuYW1lXVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAoIWhhbmRsZXIpIHRocm93IG5ldyBFcnJvcihcIlVua25vd24gYnVpbGRlciBbXCIgKyBuYW1lICsgXCJdIHdhcyB1c2VkIGR1cmluZyBleHRlbmRpbmcgb2YgW1wiICsgdGFyZ2V0TWV0YS5jICsgXCJdXCIpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGhhbmRsZXIuY2FsbCh0aGlzLCB0YXJnZXRNZXRhLCB2YWx1ZSlcbiAgICAgICAgfSwgdGhpcylcbiAgICAgICAgXG4gICAgICAgIHRoaXMuX2J1aWxkQ29tcGxldGUodGFyZ2V0TWV0YSwgcHJvcHMpXG4gICAgfSxcbiAgICBcblxuICAgIF9idWlsZENvbXBsZXRlIDogZnVuY3Rpb24gKHRhcmdldE1ldGEsIHByb3BzKSB7XG4gICAgICAgIHRhcmdldE1ldGEuc3RlbS5jbG9zZSgpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBtZXRob2RzIDogZnVuY3Rpb24gKHRhcmdldE1ldGEsIGluZm8pIHtcbiAgICAgICAgSm9vc2UuTy5lYWNoT3duKGluZm8sIGZ1bmN0aW9uICh2YWx1ZSwgbmFtZSkge1xuICAgICAgICAgICAgdGFyZ2V0TWV0YS5hZGRNZXRob2QobmFtZSwgdmFsdWUpXG4gICAgICAgIH0pXG4gICAgfSxcbiAgICBcblxuICAgIHJlbW92ZU1ldGhvZHMgOiBmdW5jdGlvbiAodGFyZ2V0TWV0YSwgaW5mbykge1xuICAgICAgICBKb29zZS5BLmVhY2goaW5mbywgZnVuY3Rpb24gKG5hbWUpIHtcbiAgICAgICAgICAgIHRhcmdldE1ldGEucmVtb3ZlTWV0aG9kKG5hbWUpXG4gICAgICAgIH0pXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBoYXZlIDogZnVuY3Rpb24gKHRhcmdldE1ldGEsIGluZm8pIHtcbiAgICAgICAgSm9vc2UuTy5lYWNoT3duKGluZm8sIGZ1bmN0aW9uICh2YWx1ZSwgbmFtZSkge1xuICAgICAgICAgICAgdGFyZ2V0TWV0YS5hZGRBdHRyaWJ1dGUobmFtZSwgdmFsdWUpXG4gICAgICAgIH0pXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBoYXZlbm90IDogZnVuY3Rpb24gKHRhcmdldE1ldGEsIGluZm8pIHtcbiAgICAgICAgSm9vc2UuQS5lYWNoKGluZm8sIGZ1bmN0aW9uIChuYW1lKSB7XG4gICAgICAgICAgICB0YXJnZXRNZXRhLnJlbW92ZUF0dHJpYnV0ZShuYW1lKVxuICAgICAgICB9KVxuICAgIH0sXG4gICAgXG5cbiAgICBoYXZlbnQgOiBmdW5jdGlvbiAodGFyZ2V0TWV0YSwgaW5mbykge1xuICAgICAgICB0aGlzLmhhdmVub3QodGFyZ2V0TWV0YSwgaW5mbylcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGFmdGVyIDogZnVuY3Rpb24gKHRhcmdldE1ldGEsIGluZm8pIHtcbiAgICAgICAgSm9vc2UuTy5lYWNoKGluZm8sIGZ1bmN0aW9uICh2YWx1ZSwgbmFtZSkge1xuICAgICAgICAgICAgdGFyZ2V0TWV0YS5hZGRNZXRob2RNb2RpZmllcihuYW1lLCB2YWx1ZSwgSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5NZXRob2RNb2RpZmllci5BZnRlcilcbiAgICAgICAgfSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGJlZm9yZSA6IGZ1bmN0aW9uICh0YXJnZXRNZXRhLCBpbmZvKSB7XG4gICAgICAgIEpvb3NlLk8uZWFjaChpbmZvLCBmdW5jdGlvbiAodmFsdWUsIG5hbWUpIHtcbiAgICAgICAgICAgIHRhcmdldE1ldGEuYWRkTWV0aG9kTW9kaWZpZXIobmFtZSwgdmFsdWUsIEpvb3NlLk1hbmFnZWQuUHJvcGVydHkuTWV0aG9kTW9kaWZpZXIuQmVmb3JlKVxuICAgICAgICB9KVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgb3ZlcnJpZGUgOiBmdW5jdGlvbiAodGFyZ2V0TWV0YSwgaW5mbykge1xuICAgICAgICBKb29zZS5PLmVhY2goaW5mbywgZnVuY3Rpb24gKHZhbHVlLCBuYW1lKSB7XG4gICAgICAgICAgICB0YXJnZXRNZXRhLmFkZE1ldGhvZE1vZGlmaWVyKG5hbWUsIHZhbHVlLCBKb29zZS5NYW5hZ2VkLlByb3BlcnR5Lk1ldGhvZE1vZGlmaWVyLk92ZXJyaWRlKVxuICAgICAgICB9KVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgYXJvdW5kIDogZnVuY3Rpb24gKHRhcmdldE1ldGEsIGluZm8pIHtcbiAgICAgICAgSm9vc2UuTy5lYWNoKGluZm8sIGZ1bmN0aW9uICh2YWx1ZSwgbmFtZSkge1xuICAgICAgICAgICAgdGFyZ2V0TWV0YS5hZGRNZXRob2RNb2RpZmllcihuYW1lLCB2YWx1ZSwgSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5NZXRob2RNb2RpZmllci5Bcm91bmQpXG4gICAgICAgIH0pXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBhdWdtZW50IDogZnVuY3Rpb24gKHRhcmdldE1ldGEsIGluZm8pIHtcbiAgICAgICAgSm9vc2UuTy5lYWNoKGluZm8sIGZ1bmN0aW9uICh2YWx1ZSwgbmFtZSkge1xuICAgICAgICAgICAgdGFyZ2V0TWV0YS5hZGRNZXRob2RNb2RpZmllcihuYW1lLCB2YWx1ZSwgSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5NZXRob2RNb2RpZmllci5BdWdtZW50KVxuICAgICAgICB9KVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgcmVtb3ZlTW9kaWZpZXIgOiBmdW5jdGlvbiAodGFyZ2V0TWV0YSwgaW5mbykge1xuICAgICAgICBKb29zZS5BLmVhY2goaW5mbywgZnVuY3Rpb24gKG5hbWUpIHtcbiAgICAgICAgICAgIHRhcmdldE1ldGEucmVtb3ZlTWV0aG9kTW9kaWZpZXIobmFtZSlcbiAgICAgICAgfSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGRvZXMgOiBmdW5jdGlvbiAodGFyZ2V0TWV0YSwgaW5mbykge1xuICAgICAgICBKb29zZS5BLmVhY2goSm9vc2UuTy53YW50QXJyYXkoaW5mbyksIGZ1bmN0aW9uIChkZXNjKSB7XG4gICAgICAgICAgICB0YXJnZXRNZXRhLmFkZFJvbGUoZGVzYylcbiAgICAgICAgfSlcbiAgICB9LFxuICAgIFxuXG4gICAgZG9lc25vdCA6IGZ1bmN0aW9uICh0YXJnZXRNZXRhLCBpbmZvKSB7XG4gICAgICAgIEpvb3NlLkEuZWFjaChKb29zZS5PLndhbnRBcnJheShpbmZvKSwgZnVuY3Rpb24gKGRlc2MpIHtcbiAgICAgICAgICAgIHRhcmdldE1ldGEucmVtb3ZlUm9sZShkZXNjKVxuICAgICAgICB9KVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgZG9lc250IDogZnVuY3Rpb24gKHRhcmdldE1ldGEsIGluZm8pIHtcbiAgICAgICAgdGhpcy5kb2Vzbm90KHRhcmdldE1ldGEsIGluZm8pXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICB0cmFpdCA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgdGhpcy50cmFpdHMuYXBwbHkodGhpcywgYXJndW1lbnRzKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgdHJhaXRzIDogZnVuY3Rpb24gKHRhcmdldE1ldGEsIGluZm8pIHtcbiAgICAgICAgaWYgKHRhcmdldE1ldGEuZmlyc3RQYXNzKSByZXR1cm5cbiAgICAgICAgXG4gICAgICAgIGlmICghdGFyZ2V0TWV0YS5tZXRhLmlzRGV0YWNoZWQpIHRocm93IFwiQ2FuJ3QgYXBwbHkgdHJhaXQgdG8gbm90IGRldGFjaGVkIGNsYXNzXCJcbiAgICAgICAgXG4gICAgICAgIHRhcmdldE1ldGEubWV0YS5leHRlbmQoe1xuICAgICAgICAgICAgZG9lcyA6IGluZm9cbiAgICAgICAgfSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIHJlbW92ZVRyYWl0IDogZnVuY3Rpb24gKCkge1xuICAgICAgICB0aGlzLnJlbW92ZVRyYWl0cy5hcHBseSh0aGlzLCBhcmd1bWVudHMpXG4gICAgfSxcbiAgICAgXG4gICAgXG4gICAgcmVtb3ZlVHJhaXRzIDogZnVuY3Rpb24gKHRhcmdldE1ldGEsIGluZm8pIHtcbiAgICAgICAgaWYgKCF0YXJnZXRNZXRhLm1ldGEuaXNEZXRhY2hlZCkgdGhyb3cgXCJDYW4ndCByZW1vdmUgdHJhaXQgZnJvbSBub3QgZGV0YWNoZWQgY2xhc3NcIlxuICAgICAgICBcbiAgICAgICAgdGFyZ2V0TWV0YS5tZXRhLmV4dGVuZCh7XG4gICAgICAgICAgICBkb2Vzbm90IDogaW5mb1xuICAgICAgICB9KVxuICAgIH1cbiAgICBcbiAgICBcbiAgICBcbn0pLmM7XG5Kb29zZS5NYW5hZ2VkLkNsYXNzID0gbmV3IEpvb3NlLlByb3RvLkNsYXNzKCdKb29zZS5NYW5hZ2VkLkNsYXNzJywge1xuICAgIFxuICAgIGlzYSAgICAgICAgICAgICAgICAgICAgICAgICA6IEpvb3NlLlByb3RvLkNsYXNzLFxuICAgIFxuICAgIHN0ZW0gICAgICAgICAgICAgICAgICAgICAgICA6IG51bGwsXG4gICAgc3RlbUNsYXNzICAgICAgICAgICAgICAgICAgIDogSm9vc2UuTWFuYWdlZC5TdGVtLFxuICAgIHN0ZW1DbGFzc0NyZWF0ZWQgICAgICAgICAgICA6IGZhbHNlLFxuICAgIFxuICAgIGJ1aWxkZXIgICAgICAgICAgICAgICAgICAgICA6IG51bGwsXG4gICAgYnVpbGRlckNsYXNzICAgICAgICAgICAgICAgIDogSm9vc2UuTWFuYWdlZC5CdWlsZGVyLFxuICAgIGJ1aWxkZXJDbGFzc0NyZWF0ZWQgICAgICAgICA6IGZhbHNlLFxuICAgIFxuICAgIGlzRGV0YWNoZWQgICAgICAgICAgICAgICAgICA6IGZhbHNlLFxuICAgIGZpcnN0UGFzcyAgICAgICAgICAgICAgICAgICA6IHRydWUsXG4gICAgXG4gICAgLy8gYSBzcGVjaWFsIGluc3RhbmNlLCB3aGljaCwgd2hlbiBwYXNzZWQgYXMgMXN0IGFyZ3VtZW50IHRvIGNvbnN0cnVjdG9yLCBzaWduaWZpZXMgdGhhdCBjb25zdHJ1Y3RvciBzaG91bGRcbiAgICAvLyBza2lwcyB0cmFpdHMgcHJvY2Vzc2luZyBmb3IgdGhpcyBpbnN0YW5jZVxuICAgIHNraXBUcmFpdHNBbmNob3IgICAgICAgICAgICA6IHt9LFxuICAgIFxuICAgIFxuICAgIC8vYnVpbGQgZm9yIG1ldGFjbGFzc2VzIC0gY29sbGVjdHMgdHJhaXRzIGZyb20gcm9sZXNcbiAgICBCVUlMRCA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgdmFyIHN1cCA9IEpvb3NlLk1hbmFnZWQuQ2xhc3Muc3VwZXJDbGFzcy5CVUlMRC5hcHBseSh0aGlzLCBhcmd1bWVudHMpXG4gICAgICAgIFxuICAgICAgICB2YXIgcHJvcHMgICA9IHN1cC5fX2V4dGVuZF9fXG4gICAgICAgIFxuICAgICAgICB2YXIgdHJhaXRzID0gSm9vc2UuTy53YW50QXJyYXkocHJvcHMudHJhaXQgfHwgcHJvcHMudHJhaXRzIHx8IFtdKVxuICAgICAgICBkZWxldGUgcHJvcHMudHJhaXRcbiAgICAgICAgZGVsZXRlIHByb3BzLnRyYWl0c1xuICAgICAgICBcbiAgICAgICAgSm9vc2UuQS5lYWNoKEpvb3NlLk8ud2FudEFycmF5KHByb3BzLmRvZXMgfHwgW10pLCBmdW5jdGlvbiAoYXJnKSB7XG4gICAgICAgICAgICB2YXIgcm9sZSA9IChhcmcubWV0YSBpbnN0YW5jZW9mIEpvb3NlLk1hbmFnZWQuQ2xhc3MpID8gYXJnIDogYXJnLnJvbGVcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKHJvbGUubWV0YS5tZXRhLmlzRGV0YWNoZWQpIHRyYWl0cy5wdXNoKHJvbGUubWV0YS5jb25zdHJ1Y3RvcilcbiAgICAgICAgfSlcbiAgICAgICAgXG4gICAgICAgIGlmICh0cmFpdHMubGVuZ3RoKSBwcm9wcy50cmFpdHMgPSB0cmFpdHMgXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gc3VwXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBpbml0SW5zdGFuY2UgOiBmdW5jdGlvbiAoaW5zdGFuY2UsIHByb3BzKSB7XG4gICAgICAgIEpvb3NlLk8uZWFjaCh0aGlzLmF0dHJpYnV0ZXMsIGZ1bmN0aW9uIChhdHRyaWJ1dGUsIG5hbWUpIHtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKGF0dHJpYnV0ZSBpbnN0YW5jZW9mIEpvb3NlLk1hbmFnZWQuQXR0cmlidXRlKSBcbiAgICAgICAgICAgICAgICBhdHRyaWJ1dGUuaW5pdEZyb21Db25maWcoaW5zdGFuY2UsIHByb3BzKVxuICAgICAgICAgICAgZWxzZSBcbiAgICAgICAgICAgICAgICBpZiAocHJvcHMuaGFzT3duUHJvcGVydHkobmFtZSkpIGluc3RhbmNlW25hbWVdID0gcHJvcHNbbmFtZV1cbiAgICAgICAgfSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIC8vIHdlIGFyZSB1c2luZyB0aGUgc2FtZSBjb25zdHJ1Y3RvciBmb3IgdXN1YWwgYW5kIG1ldGEtIGNsYXNzZXNcbiAgICBkZWZhdWx0Q29uc3RydWN0b3I6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgcmV0dXJuIGZ1bmN0aW9uIChza2lwVHJhaXRzQW5jaG9yLCBwYXJhbXMpIHtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdmFyIHRoaXNNZXRhICAgID0gdGhpcy5tZXRhXG4gICAgICAgICAgICB2YXIgc2tpcFRyYWl0cyAgPSBza2lwVHJhaXRzQW5jaG9yID09IHRoaXNNZXRhLnNraXBUcmFpdHNBbmNob3JcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdmFyIEJVSUxEICAgICAgID0gdGhpcy5CVUlMRFxuICAgICAgICAgICAgXG4gICAgICAgICAgICB2YXIgcHJvcHMgICAgICAgPSBCVUlMRCAmJiBCVUlMRC5hcHBseSh0aGlzLCBza2lwVHJhaXRzID8gcGFyYW1zIDogYXJndW1lbnRzKSB8fCAoc2tpcFRyYWl0cyA/IHBhcmFtc1swXSA6IHNraXBUcmFpdHNBbmNob3IpIHx8IHt9XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gZWl0aGVyIGxvb2tpbmcgZm9yIHRyYWl0cyBpbiBfX2V4dGVuZF9fIChtZXRhLWNsYXNzKSBvciBpbiB1c3VhbCBwcm9wcyAodXN1YWwgY2xhc3MpXG4gICAgICAgICAgICB2YXIgZXh0ZW5kICA9IHByb3BzLl9fZXh0ZW5kX18gfHwgcHJvcHNcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdmFyIHRyYWl0cyA9IGV4dGVuZC50cmFpdCB8fCBleHRlbmQudHJhaXRzXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmICh0cmFpdHMgfHwgZXh0ZW5kLmRldGFjaGVkKSB7XG4gICAgICAgICAgICAgICAgZGVsZXRlIGV4dGVuZC50cmFpdFxuICAgICAgICAgICAgICAgIGRlbGV0ZSBleHRlbmQudHJhaXRzXG4gICAgICAgICAgICAgICAgZGVsZXRlIGV4dGVuZC5kZXRhY2hlZFxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIGlmICghc2tpcFRyYWl0cykge1xuICAgICAgICAgICAgICAgICAgICB2YXIgY2xhc3NXaXRoVHJhaXQgID0gdGhpc01ldGEuc3ViQ2xhc3MoeyBkb2VzIDogdHJhaXRzIHx8IFtdIH0sIHRoaXNNZXRhLm5hbWUpXG4gICAgICAgICAgICAgICAgICAgIHZhciBtZXRhICAgICAgICAgICAgPSBjbGFzc1dpdGhUcmFpdC5tZXRhXG4gICAgICAgICAgICAgICAgICAgIG1ldGEuaXNEZXRhY2hlZCAgICAgPSB0cnVlXG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gbWV0YS5pbnN0YW50aWF0ZSh0aGlzTWV0YS5za2lwVHJhaXRzQW5jaG9yLCBhcmd1bWVudHMpXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzTWV0YS5pbml0SW5zdGFuY2UodGhpcywgcHJvcHMpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHJldHVybiB0aGlzTWV0YS5oYXNNZXRob2QoJ2luaXRpYWxpemUnKSAmJiB0aGlzLmluaXRpYWxpemUocHJvcHMpIHx8IHRoaXNcbiAgICAgICAgfVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgZmluYWxpemU6IGZ1bmN0aW9uIChleHRlbmQpIHtcbiAgICAgICAgSm9vc2UuTWFuYWdlZC5DbGFzcy5zdXBlckNsYXNzLmZpbmFsaXplLmNhbGwodGhpcywgZXh0ZW5kKVxuICAgICAgICBcbiAgICAgICAgdGhpcy5zdGVtLmNsb3NlKClcbiAgICAgICAgXG4gICAgICAgIHRoaXMuYWZ0ZXJNdXRhdGUoKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgcHJvY2Vzc1N0ZW0gOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIEpvb3NlLk1hbmFnZWQuQ2xhc3Muc3VwZXJDbGFzcy5wcm9jZXNzU3RlbS5jYWxsKHRoaXMpXG4gICAgICAgIFxuICAgICAgICB0aGlzLmJ1aWxkZXIgICAgPSBuZXcgdGhpcy5idWlsZGVyQ2xhc3MoeyB0YXJnZXRNZXRhIDogdGhpcyB9KVxuICAgICAgICB0aGlzLnN0ZW0gICAgICAgPSBuZXcgdGhpcy5zdGVtQ2xhc3MoeyBuYW1lIDogdGhpcy5uYW1lLCB0YXJnZXRNZXRhIDogdGhpcyB9KVxuICAgICAgICBcbiAgICAgICAgdmFyIGJ1aWxkZXJDbGFzcyA9IHRoaXMuZ2V0Q2xhc3NJbkF0dHJpYnV0ZSgnYnVpbGRlckNsYXNzJylcbiAgICAgICAgXG4gICAgICAgIGlmIChidWlsZGVyQ2xhc3MpIHtcbiAgICAgICAgICAgIHRoaXMuYnVpbGRlckNsYXNzQ3JlYXRlZCA9IHRydWVcbiAgICAgICAgICAgIHRoaXMuYWRkQXR0cmlidXRlKCdidWlsZGVyQ2xhc3MnLCB0aGlzLnN1YkNsYXNzT2YoYnVpbGRlckNsYXNzKSlcbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIHZhciBzdGVtQ2xhc3MgPSB0aGlzLmdldENsYXNzSW5BdHRyaWJ1dGUoJ3N0ZW1DbGFzcycpXG4gICAgICAgIFxuICAgICAgICBpZiAoc3RlbUNsYXNzKSB7XG4gICAgICAgICAgICB0aGlzLnN0ZW1DbGFzc0NyZWF0ZWQgPSB0cnVlXG4gICAgICAgICAgICB0aGlzLmFkZEF0dHJpYnV0ZSgnc3RlbUNsYXNzJywgdGhpcy5zdWJDbGFzc09mKHN0ZW1DbGFzcykpXG4gICAgICAgIH1cbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGV4dGVuZCA6IGZ1bmN0aW9uIChwcm9wcykge1xuICAgICAgICBpZiAocHJvcHMuYnVpbGRlcikge1xuICAgICAgICAgICAgdGhpcy5nZXRCdWlsZGVyVGFyZ2V0KCkubWV0YS5leHRlbmQocHJvcHMuYnVpbGRlcilcbiAgICAgICAgICAgIGRlbGV0ZSBwcm9wcy5idWlsZGVyXG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgICAgIGlmIChwcm9wcy5zdGVtKSB7XG4gICAgICAgICAgICB0aGlzLmdldFN0ZW1UYXJnZXQoKS5tZXRhLmV4dGVuZChwcm9wcy5zdGVtKVxuICAgICAgICAgICAgZGVsZXRlIHByb3BzLnN0ZW1cbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgdGhpcy5idWlsZGVyLl9leHRlbmQocHJvcHMpXG4gICAgICAgIFxuICAgICAgICB0aGlzLmZpcnN0UGFzcyA9IGZhbHNlXG4gICAgICAgIFxuICAgICAgICBpZiAoIXRoaXMuc3RlbS5vcGVuZWQpIHRoaXMuYWZ0ZXJNdXRhdGUoKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgZ2V0QnVpbGRlclRhcmdldCA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgdmFyIGJ1aWxkZXJDbGFzcyA9IHRoaXMuZ2V0Q2xhc3NJbkF0dHJpYnV0ZSgnYnVpbGRlckNsYXNzJylcbiAgICAgICAgaWYgKCFidWlsZGVyQ2xhc3MpIHRocm93IFwiQXR0ZW1wdCB0byBleHRlbmQgYSBidWlsZGVyIG9uIG5vbi1tZXRhIGNsYXNzXCJcbiAgICAgICAgXG4gICAgICAgIHJldHVybiBidWlsZGVyQ2xhc3NcbiAgICB9LFxuICAgIFxuXG4gICAgZ2V0U3RlbVRhcmdldCA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgdmFyIHN0ZW1DbGFzcyA9IHRoaXMuZ2V0Q2xhc3NJbkF0dHJpYnV0ZSgnc3RlbUNsYXNzJylcbiAgICAgICAgaWYgKCFzdGVtQ2xhc3MpIHRocm93IFwiQXR0ZW1wdCB0byBleHRlbmQgYSBzdGVtIG9uIG5vbi1tZXRhIGNsYXNzXCJcbiAgICAgICAgXG4gICAgICAgIHJldHVybiBzdGVtQ2xhc3NcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGdldENsYXNzSW5BdHRyaWJ1dGUgOiBmdW5jdGlvbiAoYXR0cmlidXRlTmFtZSkge1xuICAgICAgICB2YXIgYXR0ckNsYXNzID0gdGhpcy5nZXRBdHRyaWJ1dGUoYXR0cmlidXRlTmFtZSlcbiAgICAgICAgaWYgKGF0dHJDbGFzcyBpbnN0YW5jZW9mIEpvb3NlLk1hbmFnZWQuUHJvcGVydHkuQXR0cmlidXRlKSBhdHRyQ2xhc3MgPSBhdHRyQ2xhc3MudmFsdWVcbiAgICAgICAgXG4gICAgICAgIHJldHVybiBhdHRyQ2xhc3NcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGFkZE1ldGhvZE1vZGlmaWVyOiBmdW5jdGlvbiAobmFtZSwgZnVuYywgdHlwZSkge1xuICAgICAgICB2YXIgcHJvcHMgPSB7fVxuICAgICAgICBcbiAgICAgICAgcHJvcHMuaW5pdCA9IGZ1bmNcbiAgICAgICAgcHJvcHMubWV0YSA9IHR5cGVcbiAgICAgICAgXG4gICAgICAgIHJldHVybiB0aGlzLnN0ZW0ucHJvcGVydGllcy5tZXRob2RzTW9kaWZpZXJzLmFkZFByb3BlcnR5KG5hbWUsIHByb3BzKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgcmVtb3ZlTWV0aG9kTW9kaWZpZXI6IGZ1bmN0aW9uIChuYW1lKSB7XG4gICAgICAgIHJldHVybiB0aGlzLnN0ZW0ucHJvcGVydGllcy5tZXRob2RzTW9kaWZpZXJzLnJlbW92ZVByb3BlcnR5KG5hbWUpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBhZGRNZXRob2Q6IGZ1bmN0aW9uIChuYW1lLCBmdW5jLCBwcm9wcykge1xuICAgICAgICBwcm9wcyA9IHByb3BzIHx8IHt9XG4gICAgICAgIHByb3BzLmluaXQgPSBmdW5jXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gdGhpcy5zdGVtLnByb3BlcnRpZXMubWV0aG9kcy5hZGRQcm9wZXJ0eShuYW1lLCBwcm9wcylcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGFkZEF0dHJpYnV0ZTogZnVuY3Rpb24gKG5hbWUsIGluaXQsIHByb3BzKSB7XG4gICAgICAgIHByb3BzID0gcHJvcHMgfHwge31cbiAgICAgICAgcHJvcHMuaW5pdCA9IGluaXRcbiAgICAgICAgXG4gICAgICAgIHJldHVybiB0aGlzLnN0ZW0ucHJvcGVydGllcy5hdHRyaWJ1dGVzLmFkZFByb3BlcnR5KG5hbWUsIHByb3BzKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgcmVtb3ZlTWV0aG9kIDogZnVuY3Rpb24gKG5hbWUpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuc3RlbS5wcm9wZXJ0aWVzLm1ldGhvZHMucmVtb3ZlUHJvcGVydHkobmFtZSlcbiAgICB9LFxuXG4gICAgXG4gICAgcmVtb3ZlQXR0cmlidXRlOiBmdW5jdGlvbiAobmFtZSkge1xuICAgICAgICByZXR1cm4gdGhpcy5zdGVtLnByb3BlcnRpZXMuYXR0cmlidXRlcy5yZW1vdmVQcm9wZXJ0eShuYW1lKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgaGFzTWV0aG9kOiBmdW5jdGlvbiAobmFtZSkge1xuICAgICAgICByZXR1cm4gdGhpcy5zdGVtLnByb3BlcnRpZXMubWV0aG9kcy5oYXZlUHJvcGVydHkobmFtZSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGhhc0F0dHJpYnV0ZTogZnVuY3Rpb24gKG5hbWUpIHsgXG4gICAgICAgIHJldHVybiB0aGlzLnN0ZW0ucHJvcGVydGllcy5hdHRyaWJ1dGVzLmhhdmVQcm9wZXJ0eShuYW1lKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgaGFzTWV0aG9kTW9kaWZpZXJzRm9yIDogZnVuY3Rpb24gKG5hbWUpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuc3RlbS5wcm9wZXJ0aWVzLm1ldGhvZHNNb2RpZmllcnMuaGF2ZVByb3BlcnR5KG5hbWUpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBoYXNPd25NZXRob2Q6IGZ1bmN0aW9uIChuYW1lKSB7XG4gICAgICAgIHJldHVybiB0aGlzLnN0ZW0ucHJvcGVydGllcy5tZXRob2RzLmhhdmVPd25Qcm9wZXJ0eShuYW1lKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgaGFzT3duQXR0cmlidXRlOiBmdW5jdGlvbiAobmFtZSkgeyBcbiAgICAgICAgcmV0dXJuIHRoaXMuc3RlbS5wcm9wZXJ0aWVzLmF0dHJpYnV0ZXMuaGF2ZU93blByb3BlcnR5KG5hbWUpXG4gICAgfSxcbiAgICBcblxuICAgIGdldE1ldGhvZCA6IGZ1bmN0aW9uIChuYW1lKSB7XG4gICAgICAgIHJldHVybiB0aGlzLnN0ZW0ucHJvcGVydGllcy5tZXRob2RzLmdldFByb3BlcnR5KG5hbWUpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBnZXRBdHRyaWJ1dGUgOiBmdW5jdGlvbiAobmFtZSkge1xuICAgICAgICByZXR1cm4gdGhpcy5zdGVtLnByb3BlcnRpZXMuYXR0cmlidXRlcy5nZXRQcm9wZXJ0eShuYW1lKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgZWFjaFJvbGUgOiBmdW5jdGlvbiAocm9sZXMsIGZ1bmMsIHNjb3BlKSB7XG4gICAgICAgIEpvb3NlLkEuZWFjaChyb2xlcywgZnVuY3Rpb24gKGFyZywgaW5kZXgpIHtcbiAgICAgICAgICAgIHZhciByb2xlID0gKGFyZy5tZXRhIGluc3RhbmNlb2YgSm9vc2UuTWFuYWdlZC5DbGFzcykgPyBhcmcgOiBhcmcucm9sZVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBmdW5jLmNhbGwoc2NvcGUgfHwgdGhpcywgYXJnLCByb2xlLCBpbmRleClcbiAgICAgICAgfSwgdGhpcylcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGFkZFJvbGUgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIFxuICAgICAgICB0aGlzLmVhY2hSb2xlKGFyZ3VtZW50cywgZnVuY3Rpb24gKGFyZywgcm9sZSkge1xuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLmJlZm9yZVJvbGVBZGQocm9sZSlcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdmFyIGRlc2MgPSBhcmdcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy9jb21wb3NlIGRlc2NyaXB0b3IgY2FuIGNvbnRhaW4gJ2FsaWFzJyBhbmQgJ2V4Y2x1ZGUnIGZpZWxkcywgaW4gdGhpcyBjYXNlIGFjdHVhbCByZWZlcmVuY2Ugc2hvdWxkIGJlIHN0b3JlZFxuICAgICAgICAgICAgLy9pbnRvICdwcm9wZXJ0eVNldCcgZmllbGRcbiAgICAgICAgICAgIGlmIChyb2xlICE9IGFyZykge1xuICAgICAgICAgICAgICAgIGRlc2MucHJvcGVydHlTZXQgPSByb2xlLm1ldGEuc3RlbVxuICAgICAgICAgICAgICAgIGRlbGV0ZSBkZXNjLnJvbGVcbiAgICAgICAgICAgIH0gZWxzZVxuICAgICAgICAgICAgICAgIGRlc2MgPSBkZXNjLm1ldGEuc3RlbVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLnN0ZW0uYWRkQ29tcG9zZUluZm8oZGVzYylcbiAgICAgICAgICAgIFxuICAgICAgICB9LCB0aGlzKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgYmVmb3JlUm9sZUFkZCA6IGZ1bmN0aW9uIChyb2xlKSB7XG4gICAgICAgIHZhciByb2xlTWV0YSA9IHJvbGUubWV0YVxuICAgICAgICBcbiAgICAgICAgaWYgKHJvbGVNZXRhLmJ1aWxkZXJDbGFzc0NyZWF0ZWQpIHRoaXMuZ2V0QnVpbGRlclRhcmdldCgpLm1ldGEuZXh0ZW5kKHtcbiAgICAgICAgICAgIGRvZXMgOiBbIHJvbGVNZXRhLmdldEJ1aWxkZXJUYXJnZXQoKSBdXG4gICAgICAgIH0pXG4gICAgICAgIFxuICAgICAgICBpZiAocm9sZU1ldGEuc3RlbUNsYXNzQ3JlYXRlZCkgdGhpcy5nZXRTdGVtVGFyZ2V0KCkubWV0YS5leHRlbmQoe1xuICAgICAgICAgICAgZG9lcyA6IFsgcm9sZU1ldGEuZ2V0U3RlbVRhcmdldCgpIF1cbiAgICAgICAgfSlcbiAgICAgICAgXG4gICAgICAgIGlmIChyb2xlTWV0YS5tZXRhLmlzRGV0YWNoZWQgJiYgIXRoaXMuZmlyc3RQYXNzKSB0aGlzLmJ1aWxkZXIudHJhaXRzKHRoaXMsIHJvbGVNZXRhLmNvbnN0cnVjdG9yKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgYmVmb3JlUm9sZVJlbW92ZSA6IGZ1bmN0aW9uIChyb2xlKSB7XG4gICAgICAgIHZhciByb2xlTWV0YSA9IHJvbGUubWV0YVxuICAgICAgICBcbiAgICAgICAgaWYgKHJvbGVNZXRhLmJ1aWxkZXJDbGFzc0NyZWF0ZWQpIHRoaXMuZ2V0QnVpbGRlclRhcmdldCgpLm1ldGEuZXh0ZW5kKHtcbiAgICAgICAgICAgIGRvZXNudCA6IFsgcm9sZU1ldGEuZ2V0QnVpbGRlclRhcmdldCgpIF1cbiAgICAgICAgfSlcbiAgICAgICAgXG4gICAgICAgIGlmIChyb2xlTWV0YS5zdGVtQ2xhc3NDcmVhdGVkKSB0aGlzLmdldFN0ZW1UYXJnZXQoKS5tZXRhLmV4dGVuZCh7XG4gICAgICAgICAgICBkb2VzbnQgOiBbIHJvbGVNZXRhLmdldFN0ZW1UYXJnZXQoKSBdXG4gICAgICAgIH0pXG4gICAgICAgIFxuICAgICAgICBpZiAocm9sZU1ldGEubWV0YS5pc0RldGFjaGVkICYmICF0aGlzLmZpcnN0UGFzcykgdGhpcy5idWlsZGVyLnJlbW92ZVRyYWl0cyh0aGlzLCByb2xlTWV0YS5jb25zdHJ1Y3RvcilcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIHJlbW92ZVJvbGUgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHRoaXMuZWFjaFJvbGUoYXJndW1lbnRzLCBmdW5jdGlvbiAoYXJnLCByb2xlKSB7XG4gICAgICAgICAgICB0aGlzLmJlZm9yZVJvbGVSZW1vdmUocm9sZSlcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpcy5zdGVtLnJlbW92ZUNvbXBvc2VJbmZvKHJvbGUubWV0YS5zdGVtKVxuICAgICAgICB9LCB0aGlzKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgZ2V0Um9sZXMgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIFxuICAgICAgICByZXR1cm4gSm9vc2UuQS5tYXAodGhpcy5zdGVtLmNvbXBvc2VkRnJvbSwgZnVuY3Rpb24gKGNvbXBvc2VEZXNjKSB7XG4gICAgICAgICAgICAvL2NvbXBvc2UgZGVzY3JpcHRvciBjYW4gY29udGFpbiAnYWxpYXMnIGFuZCAnZXhjbHVkZScgZmllbGRzLCBpbiB0aGlzIGNhc2UgYWN0dWFsIHJlZmVyZW5jZSBpcyBzdG9yZWRcbiAgICAgICAgICAgIC8vaW50byAncHJvcGVydHlTZXQnIGZpZWxkXG4gICAgICAgICAgICBpZiAoIShjb21wb3NlRGVzYyBpbnN0YW5jZW9mIEpvb3NlLk1hbmFnZWQuUHJvcGVydHlTZXQpKSByZXR1cm4gY29tcG9zZURlc2MucHJvcGVydHlTZXRcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcmV0dXJuIGNvbXBvc2VEZXNjLnRhcmdldE1ldGEuY1xuICAgICAgICB9KVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgZG9lcyA6IGZ1bmN0aW9uIChyb2xlKSB7XG4gICAgICAgIHZhciBteVJvbGVzID0gdGhpcy5nZXRSb2xlcygpXG4gICAgICAgIFxuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IG15Um9sZXMubGVuZ3RoOyBpKyspIGlmIChyb2xlID09IG15Um9sZXNbaV0pIHJldHVybiB0cnVlXG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgbXlSb2xlcy5sZW5ndGg7IGkrKykgaWYgKG15Um9sZXNbaV0ubWV0YS5kb2VzKHJvbGUpKSByZXR1cm4gdHJ1ZVxuICAgICAgICBcbiAgICAgICAgdmFyIHN1cGVyTWV0YSA9IHRoaXMuc3VwZXJDbGFzcy5tZXRhXG4gICAgICAgIFxuICAgICAgICAvLyBjb25zaWRlcmluZyB0aGUgY2FzZSBvZiBpbmhlcml0aW5nIGZyb20gbm9uLUpvb3NlIGNsYXNzZXNcbiAgICAgICAgaWYgKHRoaXMuc3VwZXJDbGFzcyAhPSBKb29zZS5Qcm90by5FbXB0eSAmJiBzdXBlck1ldGEgJiYgc3VwZXJNZXRhLm1ldGEgJiYgc3VwZXJNZXRhLm1ldGEuaGFzTWV0aG9kKCdkb2VzJykpIHJldHVybiBzdXBlck1ldGEuZG9lcyhyb2xlKVxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIGZhbHNlXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBnZXRNZXRob2RzIDogZnVuY3Rpb24gKCkge1xuICAgICAgICByZXR1cm4gdGhpcy5zdGVtLnByb3BlcnRpZXMubWV0aG9kc1xuICAgIH0sXG4gICAgXG4gICAgXG4gICAgZ2V0QXR0cmlidXRlcyA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuc3RlbS5wcm9wZXJ0aWVzLmF0dHJpYnV0ZXNcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGFmdGVyTXV0YXRlIDogZnVuY3Rpb24gKCkge1xuICAgIH0sXG4gICAgXG4gICAgXG4gICAgZ2V0Q3VycmVudE1ldGhvZCA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgZm9yICh2YXIgd3JhcHBlciA9IGFyZ3VtZW50cy5jYWxsZWUuY2FsbGVyLCBjb3VudCA9IDA7IHdyYXBwZXIgJiYgY291bnQgPCA1OyB3cmFwcGVyID0gd3JhcHBlci5jYWxsZXIsIGNvdW50KyspXG4gICAgICAgICAgICBpZiAod3JhcHBlci5fX01FVEhPRF9fKSByZXR1cm4gd3JhcHBlci5fX01FVEhPRF9fXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gbnVsbFxuICAgIH1cbiAgICBcbiAgICBcbn0pLmM7XG5Kb29zZS5NYW5hZ2VkLlJvbGUgPSBuZXcgSm9vc2UuTWFuYWdlZC5DbGFzcygnSm9vc2UuTWFuYWdlZC5Sb2xlJywge1xuICAgIFxuICAgIGlzYSAgICAgICAgICAgICAgICAgICAgICAgICA6IEpvb3NlLk1hbmFnZWQuQ2xhc3MsXG4gICAgXG4gICAgaGF2ZSA6IHtcbiAgICAgICAgZGVmYXVsdFN1cGVyQ2xhc3MgICAgICAgOiBKb29zZS5Qcm90by5FbXB0eSxcbiAgICAgICAgXG4gICAgICAgIGJ1aWxkZXJSb2xlICAgICAgICAgICAgIDogbnVsbCxcbiAgICAgICAgc3RlbVJvbGUgICAgICAgICAgICAgICAgOiBudWxsXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBtZXRob2RzIDoge1xuICAgICAgICBcbiAgICAgICAgZGVmYXVsdENvbnN0cnVjdG9yIDogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgcmV0dXJuIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJSb2xlcyBjYW50IGJlIGluc3RhbnRpYXRlZFwiKVxuICAgICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICBcblxuICAgICAgICBwcm9jZXNzU3VwZXJDbGFzcyA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIGlmICh0aGlzLnN1cGVyQ2xhc3MgIT0gdGhpcy5kZWZhdWx0U3VwZXJDbGFzcykgdGhyb3cgbmV3IEVycm9yKFwiUm9sZXMgY2FuJ3QgaW5oZXJpdCBmcm9tIGFueXRoaW5nXCIpXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgZ2V0QnVpbGRlclRhcmdldCA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIGlmICghdGhpcy5idWlsZGVyUm9sZSkge1xuICAgICAgICAgICAgICAgIHRoaXMuYnVpbGRlclJvbGUgPSBuZXcgdGhpcy5jb25zdHJ1Y3RvcigpLmNcbiAgICAgICAgICAgICAgICB0aGlzLmJ1aWxkZXJDbGFzc0NyZWF0ZWQgPSB0cnVlXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHJldHVybiB0aGlzLmJ1aWxkZXJSb2xlXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgIFxuICAgICAgICBnZXRTdGVtVGFyZ2V0IDogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgaWYgKCF0aGlzLnN0ZW1Sb2xlKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5zdGVtUm9sZSA9IG5ldyB0aGlzLmNvbnN0cnVjdG9yKCkuY1xuICAgICAgICAgICAgICAgIHRoaXMuc3RlbUNsYXNzQ3JlYXRlZCA9IHRydWVcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcmV0dXJuIHRoaXMuc3RlbVJvbGVcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgXG4gICAgICAgIGFkZFJlcXVpcmVtZW50IDogZnVuY3Rpb24gKG1ldGhvZE5hbWUpIHtcbiAgICAgICAgICAgIHRoaXMuc3RlbS5wcm9wZXJ0aWVzLnJlcXVpcmVtZW50cy5hZGRQcm9wZXJ0eShtZXRob2ROYW1lLCB7fSlcbiAgICAgICAgfVxuICAgICAgICBcbiAgICB9LFxuICAgIFxuXG4gICAgc3RlbSA6IHtcbiAgICAgICAgbWV0aG9kcyA6IHtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgYXBwbHkgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHVuYXBwbHkgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGJ1aWxkZXIgOiB7XG4gICAgICAgIG1ldGhvZHMgOiB7XG4gICAgICAgICAgICByZXF1aXJlcyA6IGZ1bmN0aW9uICh0YXJnZXRDbGFzc01ldGEsIGluZm8pIHtcbiAgICAgICAgICAgICAgICBKb29zZS5BLmVhY2goSm9vc2UuTy53YW50QXJyYXkoaW5mbyksIGZ1bmN0aW9uIChtZXRob2ROYW1lKSB7XG4gICAgICAgICAgICAgICAgICAgIHRhcmdldENsYXNzTWV0YS5hZGRSZXF1aXJlbWVudChtZXRob2ROYW1lKVxuICAgICAgICAgICAgICAgIH0sIHRoaXMpXG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG4gICAgXG59KS5jO1xuSm9vc2UuTWFuYWdlZC5BdHRyaWJ1dGUgPSBuZXcgSm9vc2UuTWFuYWdlZC5DbGFzcygnSm9vc2UuTWFuYWdlZC5BdHRyaWJ1dGUnLCB7XG4gICAgXG4gICAgaXNhIDogSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5BdHRyaWJ1dGUsXG4gICAgXG4gICAgaGF2ZSA6IHtcbiAgICAgICAgaXMgICAgICAgICAgICAgIDogbnVsbCxcbiAgICAgICAgXG4gICAgICAgIGJ1aWxkZXIgICAgICAgICA6IG51bGwsXG4gICAgICAgIFxuICAgICAgICBpc1ByaXZhdGUgICAgICAgOiBmYWxzZSxcbiAgICAgICAgXG4gICAgICAgIHJvbGUgICAgICAgICAgICA6IG51bGwsXG4gICAgICAgIFxuICAgICAgICBwdWJsaWNOYW1lICAgICAgOiBudWxsLFxuICAgICAgICBzZXR0ZXJOYW1lICAgICAgOiBudWxsLFxuICAgICAgICBnZXR0ZXJOYW1lICAgICAgOiBudWxsLFxuICAgICAgICBcbiAgICAgICAgLy9pbmRpY2F0ZXMgdGhlIGxvZ2ljYWwgcmVhZGFibGVuZXNzL3dyaXRlYWJsZW5lc3Mgb2YgdGhlIGF0dHJpYnV0ZVxuICAgICAgICByZWFkYWJsZSAgICAgICAgOiBmYWxzZSxcbiAgICAgICAgd3JpdGVhYmxlICAgICAgIDogZmFsc2UsXG4gICAgICAgIFxuICAgICAgICAvL2luZGljYXRlcyB0aGUgcGh5c2ljYWwgcHJlc2Vuc2Ugb2YgdGhlIGFjY2Vzc29yIChtYXkgYmUgYWJzZW50IGZvciBcImNvbWJpbmVkXCIgYWNjZXNzb3JzIGZvciBleGFtcGxlKVxuICAgICAgICBoYXNHZXR0ZXIgICAgICAgOiBmYWxzZSxcbiAgICAgICAgaGFzU2V0dGVyICAgICAgIDogZmFsc2UsXG4gICAgICAgIFxuICAgICAgICByZXF1aXJlZCAgICAgICAgOiBmYWxzZSxcbiAgICAgICAgXG4gICAgICAgIGNhbklubGluZVNldFJhdyA6IHRydWUsXG4gICAgICAgIGNhbklubGluZUdldFJhdyA6IHRydWVcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGFmdGVyIDoge1xuICAgICAgICBpbml0aWFsaXplIDogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgdmFyIG5hbWUgPSB0aGlzLm5hbWVcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpcy5wdWJsaWNOYW1lID0gbmFtZS5yZXBsYWNlKC9eXysvLCAnJylcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpcy5zbG90ID0gdGhpcy5pc1ByaXZhdGUgPyAnJCQnICsgbmFtZSA6IG5hbWVcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpcy5zZXR0ZXJOYW1lID0gdGhpcy5zZXR0ZXJOYW1lIHx8IHRoaXMuZ2V0U2V0dGVyTmFtZSgpXG4gICAgICAgICAgICB0aGlzLmdldHRlck5hbWUgPSB0aGlzLmdldHRlck5hbWUgfHwgdGhpcy5nZXRHZXR0ZXJOYW1lKClcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpcy5yZWFkYWJsZSAgPSB0aGlzLmhhc0dldHRlciA9IC9eci9pLnRlc3QodGhpcy5pcylcbiAgICAgICAgICAgIHRoaXMud3JpdGVhYmxlID0gdGhpcy5oYXNTZXR0ZXIgPSAvXi53L2kudGVzdCh0aGlzLmlzKVxuICAgICAgICB9XG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBvdmVycmlkZSA6IHtcbiAgICAgICAgXG4gICAgICAgIGNvbXB1dGVWYWx1ZSA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHZhciBpbml0ICAgID0gdGhpcy5pbml0XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmIChKb29zZS5PLmlzQ2xhc3MoaW5pdCkgfHwgIUpvb3NlLk8uaXNGdW5jdGlvbihpbml0KSkgdGhpcy5TVVBFUigpXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgcHJlQXBwbHkgOiBmdW5jdGlvbiAodGFyZ2V0Q2xhc3MpIHtcbiAgICAgICAgICAgIHRhcmdldENsYXNzLm1ldGEuZXh0ZW5kKHtcbiAgICAgICAgICAgICAgICBtZXRob2RzIDogdGhpcy5nZXRBY2Nlc3NvcnNGb3IodGFyZ2V0Q2xhc3MpXG4gICAgICAgICAgICB9KVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIHBvc3RVbkFwcGx5IDogZnVuY3Rpb24gKGZyb20pIHtcbiAgICAgICAgICAgIGZyb20ubWV0YS5leHRlbmQoe1xuICAgICAgICAgICAgICAgIHJlbW92ZU1ldGhvZHMgOiB0aGlzLmdldEFjY2Vzc29yc0Zyb20oZnJvbSlcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBtZXRob2RzIDoge1xuICAgICAgICBcbiAgICAgICAgZ2V0QWNjZXNzb3JzRm9yIDogZnVuY3Rpb24gKHRhcmdldENsYXNzKSB7XG4gICAgICAgICAgICB2YXIgdGFyZ2V0TWV0YSA9IHRhcmdldENsYXNzLm1ldGFcbiAgICAgICAgICAgIHZhciBzZXR0ZXJOYW1lID0gdGhpcy5zZXR0ZXJOYW1lXG4gICAgICAgICAgICB2YXIgZ2V0dGVyTmFtZSA9IHRoaXMuZ2V0dGVyTmFtZVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB2YXIgbWV0aG9kcyA9IHt9XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmICh0aGlzLmhhc1NldHRlciAmJiAhdGFyZ2V0TWV0YS5oYXNNZXRob2Qoc2V0dGVyTmFtZSkpIHtcbiAgICAgICAgICAgICAgICBtZXRob2RzW3NldHRlck5hbWVdID0gdGhpcy5nZXRTZXR0ZXIoKVxuICAgICAgICAgICAgICAgIG1ldGhvZHNbc2V0dGVyTmFtZV0uQUNDRVNTT1JfRlJPTSA9IHRoaXNcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKHRoaXMuaGFzR2V0dGVyICYmICF0YXJnZXRNZXRhLmhhc01ldGhvZChnZXR0ZXJOYW1lKSkge1xuICAgICAgICAgICAgICAgIG1ldGhvZHNbZ2V0dGVyTmFtZV0gPSB0aGlzLmdldEdldHRlcigpXG4gICAgICAgICAgICAgICAgbWV0aG9kc1tnZXR0ZXJOYW1lXS5BQ0NFU1NPUl9GUk9NID0gdGhpc1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgXG4gICAgICAgICAgICByZXR1cm4gbWV0aG9kc1xuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIGdldEFjY2Vzc29yc0Zyb20gOiBmdW5jdGlvbiAoZnJvbSkge1xuICAgICAgICAgICAgdmFyIHRhcmdldE1ldGEgPSBmcm9tLm1ldGFcbiAgICAgICAgICAgIHZhciBzZXR0ZXJOYW1lID0gdGhpcy5zZXR0ZXJOYW1lXG4gICAgICAgICAgICB2YXIgZ2V0dGVyTmFtZSA9IHRoaXMuZ2V0dGVyTmFtZVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB2YXIgc2V0dGVyID0gdGhpcy5oYXNTZXR0ZXIgJiYgdGFyZ2V0TWV0YS5nZXRNZXRob2Qoc2V0dGVyTmFtZSlcbiAgICAgICAgICAgIHZhciBnZXR0ZXIgPSB0aGlzLmhhc0dldHRlciAmJiB0YXJnZXRNZXRhLmdldE1ldGhvZChnZXR0ZXJOYW1lKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB2YXIgcmVtb3ZlTWV0aG9kcyA9IFtdXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmIChzZXR0ZXIgJiYgc2V0dGVyLnZhbHVlLkFDQ0VTU09SX0ZST00gPT0gdGhpcykgcmVtb3ZlTWV0aG9kcy5wdXNoKHNldHRlck5hbWUpXG4gICAgICAgICAgICBpZiAoZ2V0dGVyICYmIGdldHRlci52YWx1ZS5BQ0NFU1NPUl9GUk9NID09IHRoaXMpIHJlbW92ZU1ldGhvZHMucHVzaChnZXR0ZXJOYW1lKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICByZXR1cm4gcmVtb3ZlTWV0aG9kc1xuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIGdldEdldHRlck5hbWUgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICByZXR1cm4gJ2dldCcgKyBKb29zZS5TLnVwcGVyY2FzZUZpcnN0KHRoaXMucHVibGljTmFtZSlcbiAgICAgICAgfSxcblxuXG4gICAgICAgIGdldFNldHRlck5hbWUgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICByZXR1cm4gJ3NldCcgKyBKb29zZS5TLnVwcGVyY2FzZUZpcnN0KHRoaXMucHVibGljTmFtZSlcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBnZXRTZXR0ZXIgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB2YXIgbWUgICAgICA9IHRoaXNcbiAgICAgICAgICAgIHZhciBzbG90ICAgID0gbWUuc2xvdFxuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAobWUuY2FuSW5saW5lU2V0UmF3KVxuICAgICAgICAgICAgICAgIHJldHVybiBmdW5jdGlvbiAodmFsdWUpIHtcbiAgICAgICAgICAgICAgICAgICAgdGhpc1sgc2xvdCBdID0gdmFsdWVcbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB0aGlzXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZVxuICAgICAgICAgICAgICAgIHJldHVybiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBtZS5zZXRSYXdWYWx1ZVRvLmFwcGx5KHRoaXMsIGFyZ3VtZW50cylcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgZ2V0R2V0dGVyIDogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgdmFyIG1lICAgICAgPSB0aGlzXG4gICAgICAgICAgICB2YXIgc2xvdCAgICA9IG1lLnNsb3RcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKG1lLmNhbklubGluZUdldFJhdylcbiAgICAgICAgICAgICAgICByZXR1cm4gZnVuY3Rpb24gKHZhbHVlKSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB0aGlzWyBzbG90IF1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICBlbHNlXG4gICAgICAgICAgICAgICAgcmV0dXJuIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIG1lLmdldFJhd1ZhbHVlRnJvbS5hcHBseSh0aGlzLCBhcmd1bWVudHMpXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIGdldFZhbHVlRnJvbSA6IGZ1bmN0aW9uIChpbnN0YW5jZSkge1xuICAgICAgICAgICAgdmFyIGdldHRlck5hbWUgICAgICA9IHRoaXMuZ2V0dGVyTmFtZVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAodGhpcy5yZWFkYWJsZSAmJiBpbnN0YW5jZS5tZXRhLmhhc01ldGhvZChnZXR0ZXJOYW1lKSkgcmV0dXJuIGluc3RhbmNlWyBnZXR0ZXJOYW1lIF0oKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5nZXRSYXdWYWx1ZUZyb20oaW5zdGFuY2UpXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgc2V0VmFsdWVUbyA6IGZ1bmN0aW9uIChpbnN0YW5jZSwgdmFsdWUpIHtcbiAgICAgICAgICAgIHZhciBzZXR0ZXJOYW1lICAgICAgPSB0aGlzLnNldHRlck5hbWVcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKHRoaXMud3JpdGVhYmxlICYmIGluc3RhbmNlLm1ldGEuaGFzTWV0aG9kKHNldHRlck5hbWUpKSBcbiAgICAgICAgICAgICAgICBpbnN0YW5jZVsgc2V0dGVyTmFtZSBdKHZhbHVlKVxuICAgICAgICAgICAgZWxzZVxuICAgICAgICAgICAgICAgIHRoaXMuc2V0UmF3VmFsdWVUbyhpbnN0YW5jZSwgdmFsdWUpXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgaW5pdEZyb21Db25maWcgOiBmdW5jdGlvbiAoaW5zdGFuY2UsIGNvbmZpZykge1xuICAgICAgICAgICAgdmFyIG5hbWUgICAgICAgICAgICA9IHRoaXMubmFtZVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB2YXIgdmFsdWUsIGlzU2V0ID0gZmFsc2VcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKGNvbmZpZy5oYXNPd25Qcm9wZXJ0eShuYW1lKSkge1xuICAgICAgICAgICAgICAgIHZhbHVlID0gY29uZmlnW25hbWVdXG4gICAgICAgICAgICAgICAgaXNTZXQgPSB0cnVlXG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHZhciBpbml0ICAgID0gdGhpcy5pbml0XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgLy8gc2ltcGxlIGZ1bmN0aW9uIChub3QgY2xhc3MpIGhhcyBiZWVuIHVzZWQgYXMgXCJpbml0XCIgdmFsdWVcbiAgICAgICAgICAgICAgICBpZiAoSm9vc2UuTy5pc0Z1bmN0aW9uKGluaXQpICYmICFKb29zZS5PLmlzQ2xhc3MoaW5pdCkpIHtcbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIHZhbHVlID0gaW5pdC5jYWxsKGluc3RhbmNlLCBjb25maWcsIG5hbWUpXG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICBpc1NldCA9IHRydWVcbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgfSBlbHNlIGlmICh0aGlzLmJ1aWxkZXIpIHtcbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIHZhbHVlID0gaW5zdGFuY2VbIHRoaXMuYnVpbGRlci5yZXBsYWNlKC9edGhpc1xcLi8sICcnKSBdKGNvbmZpZywgbmFtZSlcbiAgICAgICAgICAgICAgICAgICAgaXNTZXQgPSB0cnVlXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAoaXNTZXQpXG4gICAgICAgICAgICAgICAgdGhpcy5zZXRSYXdWYWx1ZVRvKGluc3RhbmNlLCB2YWx1ZSlcbiAgICAgICAgICAgIGVsc2UgXG4gICAgICAgICAgICAgICAgaWYgKHRoaXMucmVxdWlyZWQpIHRocm93IG5ldyBFcnJvcihcIlJlcXVpcmVkIGF0dHJpYnV0ZSBbXCIgKyBuYW1lICsgXCJdIGlzIG1pc3NlZCBkdXJpbmcgaW5pdGlhbGl6YXRpb24gb2YgXCIgKyBpbnN0YW5jZSlcbiAgICAgICAgfVxuICAgIH1cblxufSkuY1xuO1xuSm9vc2UuTWFuYWdlZC5BdHRyaWJ1dGUuQnVpbGRlciA9IG5ldyBKb29zZS5NYW5hZ2VkLlJvbGUoJ0pvb3NlLk1hbmFnZWQuQXR0cmlidXRlLkJ1aWxkZXInLCB7XG4gICAgXG4gICAgXG4gICAgaGF2ZSA6IHtcbiAgICAgICAgZGVmYXVsdEF0dHJpYnV0ZUNsYXNzIDogSm9vc2UuTWFuYWdlZC5BdHRyaWJ1dGVcbiAgICB9LFxuICAgIFxuICAgIGJ1aWxkZXIgOiB7XG4gICAgICAgIFxuICAgICAgICBtZXRob2RzIDoge1xuICAgICAgICAgICAgXG4gICAgICAgICAgICBoYXMgOiBmdW5jdGlvbiAodGFyZ2V0Q2xhc3NNZXRhLCBpbmZvKSB7XG4gICAgICAgICAgICAgICAgSm9vc2UuTy5lYWNoT3duKGluZm8sIGZ1bmN0aW9uIChwcm9wcywgbmFtZSkge1xuICAgICAgICAgICAgICAgICAgICBpZiAodHlwZW9mIHByb3BzICE9ICdvYmplY3QnIHx8IHByb3BzID09IG51bGwgfHwgcHJvcHMuY29uc3RydWN0b3IgPT0gLyAvLmNvbnN0cnVjdG9yKSBwcm9wcyA9IHsgaW5pdCA6IHByb3BzIH1cbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIHByb3BzLm1ldGEgPSBwcm9wcy5tZXRhIHx8IHRhcmdldENsYXNzTWV0YS5kZWZhdWx0QXR0cmlidXRlQ2xhc3NcbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIGlmICgvXl9fLy50ZXN0KG5hbWUpKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBuYW1lID0gbmFtZS5yZXBsYWNlKC9eXysvLCAnJylcbiAgICAgICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICAgICAgcHJvcHMuaXNQcml2YXRlID0gdHJ1ZVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICB0YXJnZXRDbGFzc01ldGEuYWRkQXR0cmlidXRlKG5hbWUsIHByb3BzLmluaXQsIHByb3BzKVxuICAgICAgICAgICAgICAgIH0sIHRoaXMpXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGhhc25vdCA6IGZ1bmN0aW9uICh0YXJnZXRDbGFzc01ldGEsIGluZm8pIHtcbiAgICAgICAgICAgICAgICB0aGlzLmhhdmVub3QodGFyZ2V0Q2xhc3NNZXRhLCBpbmZvKVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgXG4gICAgICAgICAgICBoYXNudCA6IGZ1bmN0aW9uICh0YXJnZXRDbGFzc01ldGEsIGluZm8pIHtcbiAgICAgICAgICAgICAgICB0aGlzLmhhc25vdCh0YXJnZXRDbGFzc01ldGEsIGluZm8pXG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgICAgIFxuICAgIH1cbiAgICBcbn0pLmNcbjtcbkpvb3NlLk1hbmFnZWQuTXkgPSBuZXcgSm9vc2UuTWFuYWdlZC5Sb2xlKCdKb29zZS5NYW5hZ2VkLk15Jywge1xuICAgIFxuICAgIGhhdmUgOiB7XG4gICAgICAgIG15Q2xhc3MgICAgICAgICAgICAgICAgICAgICAgICAgOiBudWxsLFxuICAgICAgICBcbiAgICAgICAgbmVlZFRvUmVBbGlhcyAgICAgICAgICAgICAgICAgICA6IGZhbHNlXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBtZXRob2RzIDoge1xuICAgICAgICBjcmVhdGVNeSA6IGZ1bmN0aW9uIChleHRlbmQpIHtcbiAgICAgICAgICAgIHZhciB0aGlzTWV0YSA9IHRoaXMubWV0YVxuICAgICAgICAgICAgdmFyIGlzUm9sZSA9IHRoaXMgaW5zdGFuY2VvZiBKb29zZS5NYW5hZ2VkLlJvbGVcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdmFyIG15RXh0ZW5kID0gZXh0ZW5kLm15IHx8IHt9XG4gICAgICAgICAgICBkZWxldGUgZXh0ZW5kLm15XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vIFN5bWJpb250IHdpbGwgZ2VuZXJhbGx5IGhhdmUgdGhlIHNhbWUgbWV0YSBjbGFzcyBhcyBpdHMgaG9zdGVyLCBleGNlcHRpbmcgdGhlIGNhc2VzLCB3aGVuIHRoZSBzdXBlcmNsYXNzIGFsc28gaGF2ZSB0aGUgc3ltYmlvbnQuIFxuICAgICAgICAgICAgLy8gSW4gc3VjaCBjYXNlcywgdGhlIG1ldGEgY2xhc3MgZm9yIHN5bWJpb250IHdpbGwgYmUgaW5oZXJpdGVkICh1bmxlc3MgZXhwbGljaXRseSBzcGVjaWZpZWQpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciBzdXBlckNsYXNzTXkgICAgPSB0aGlzLnN1cGVyQ2xhc3MubWV0YS5teUNsYXNzXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmICghaXNSb2xlICYmICFteUV4dGVuZC5pc2EgJiYgc3VwZXJDbGFzc015KSBteUV4dGVuZC5pc2EgPSBzdXBlckNsYXNzTXlcbiAgICAgICAgICAgIFxuXG4gICAgICAgICAgICBpZiAoIW15RXh0ZW5kLm1ldGEgJiYgIW15RXh0ZW5kLmlzYSkgbXlFeHRlbmQubWV0YSA9IHRoaXMuY29uc3RydWN0b3JcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdmFyIGNyZWF0ZWRDbGFzcyAgICA9IHRoaXMubXlDbGFzcyA9IENsYXNzKG15RXh0ZW5kKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB2YXIgYyAgICAgICAgICAgICAgID0gdGhpcy5jXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGMucHJvdG90eXBlLm15ICAgICAgPSBjLm15ID0gaXNSb2xlID8gY3JlYXRlZENsYXNzIDogbmV3IGNyZWF0ZWRDbGFzcyh7IEhPU1QgOiBjIH0pXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXMubmVlZFRvUmVBbGlhcyA9IHRydWVcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBhbGlhc1N0YXRpY01ldGhvZHMgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB0aGlzLm5lZWRUb1JlQWxpYXMgPSBmYWxzZVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB2YXIgYyAgICAgICAgICAgPSB0aGlzLmNcbiAgICAgICAgICAgIHZhciBteVByb3RvICAgICA9IHRoaXMubXlDbGFzcy5wcm90b3R5cGVcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgSm9vc2UuTy5lYWNoT3duKGMsIGZ1bmN0aW9uIChwcm9wZXJ0eSwgbmFtZSkge1xuICAgICAgICAgICAgICAgIGlmIChwcm9wZXJ0eS5JU19BTElBUykgZGVsZXRlIGNbIG5hbWUgXSBcbiAgICAgICAgICAgIH0pXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXMubXlDbGFzcy5tZXRhLnN0ZW0ucHJvcGVydGllcy5tZXRob2RzLmVhY2goZnVuY3Rpb24gKG1ldGhvZCwgbmFtZSkge1xuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIGlmICghY1sgbmFtZSBdKVxuICAgICAgICAgICAgICAgICAgICAoY1sgbmFtZSBdID0gZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIG15UHJvdG9bIG5hbWUgXS5hcHBseShjLm15LCBhcmd1bWVudHMpXG4gICAgICAgICAgICAgICAgICAgIH0pLklTX0FMSUFTID0gdHJ1ZVxuICAgICAgICAgICAgfSlcbiAgICAgICAgfVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgb3ZlcnJpZGUgOiB7XG4gICAgICAgIFxuICAgICAgICBleHRlbmQgOiBmdW5jdGlvbiAocHJvcHMpIHtcbiAgICAgICAgICAgIHZhciBteUNsYXNzID0gdGhpcy5teUNsYXNzXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmICghbXlDbGFzcyAmJiB0aGlzLnN1cGVyQ2xhc3MubWV0YS5teUNsYXNzKSB0aGlzLmNyZWF0ZU15KHByb3BzKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAocHJvcHMubXkpIHtcbiAgICAgICAgICAgICAgICBpZiAoIW15Q2xhc3MpIFxuICAgICAgICAgICAgICAgICAgICB0aGlzLmNyZWF0ZU15KHByb3BzKVxuICAgICAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLm5lZWRUb1JlQWxpYXMgPSB0cnVlXG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICBteUNsYXNzLm1ldGEuZXh0ZW5kKHByb3BzLm15KVxuICAgICAgICAgICAgICAgICAgICBkZWxldGUgcHJvcHMubXlcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXMuU1VQRVIocHJvcHMpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmICh0aGlzLm5lZWRUb1JlQWxpYXMgJiYgISh0aGlzIGluc3RhbmNlb2YgSm9vc2UuTWFuYWdlZC5Sb2xlKSkgdGhpcy5hbGlhc1N0YXRpY01ldGhvZHMoKVxuICAgICAgICB9ICBcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGJlZm9yZSA6IHtcbiAgICAgICAgXG4gICAgICAgIGFkZFJvbGUgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB2YXIgbXlTdGVtXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIEpvb3NlLkEuZWFjaChhcmd1bWVudHMsIGZ1bmN0aW9uIChhcmcpIHtcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBpZiAoIWFyZykgdGhyb3cgbmV3IEVycm9yKFwiQXR0ZW1wdCB0byBjb25zdW1lIGFuIHVuZGVmaW5lZCBSb2xlIGludG8gW1wiICsgdGhpcy5uYW1lICsgXCJdXCIpXG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgLy9pbnN0YW5jZW9mIENsYXNzIHRvIGFsbG93IHRyZWF0IGNsYXNzZXMgYXMgcm9sZXNcbiAgICAgICAgICAgICAgICB2YXIgcm9sZSA9IChhcmcubWV0YSBpbnN0YW5jZW9mIEpvb3NlLk1hbmFnZWQuQ2xhc3MpID8gYXJnIDogYXJnLnJvbGVcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBpZiAocm9sZS5tZXRhLm1ldGEuaGFzQXR0cmlidXRlKCdteUNsYXNzJykgJiYgcm9sZS5tZXRhLm15Q2xhc3MpIHtcbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIGlmICghdGhpcy5teUNsYXNzKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmNyZWF0ZU15KHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBteSA6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZG9lcyA6IHJvbGUubWV0YS5teUNsYXNzXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVyblxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICBteVN0ZW0gPSB0aGlzLm15Q2xhc3MubWV0YS5zdGVtXG4gICAgICAgICAgICAgICAgICAgIGlmICghbXlTdGVtLm9wZW5lZCkgbXlTdGVtLm9wZW4oKVxuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgbXlTdGVtLmFkZENvbXBvc2VJbmZvKHJvbGUubXkubWV0YS5zdGVtKVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0sIHRoaXMpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmIChteVN0ZW0pIHtcbiAgICAgICAgICAgICAgICBteVN0ZW0uY2xvc2UoKVxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIHRoaXMubmVlZFRvUmVBbGlhcyA9IHRydWVcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICByZW1vdmVSb2xlIDogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgaWYgKCF0aGlzLm15Q2xhc3MpIHJldHVyblxuICAgICAgICAgICAgXG4gICAgICAgICAgICB2YXIgbXlTdGVtID0gdGhpcy5teUNsYXNzLm1ldGEuc3RlbVxuICAgICAgICAgICAgbXlTdGVtLm9wZW4oKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBKb29zZS5BLmVhY2goYXJndW1lbnRzLCBmdW5jdGlvbiAocm9sZSkge1xuICAgICAgICAgICAgICAgIGlmIChyb2xlLm1ldGEubWV0YS5oYXNBdHRyaWJ1dGUoJ215Q2xhc3MnKSAmJiByb2xlLm1ldGEubXlDbGFzcykge1xuICAgICAgICAgICAgICAgICAgICBteVN0ZW0ucmVtb3ZlQ29tcG9zZUluZm8ocm9sZS5teS5tZXRhLnN0ZW0pXG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICB0aGlzLm5lZWRUb1JlQWxpYXMgPSB0cnVlXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSwgdGhpcylcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgbXlTdGVtLmNsb3NlKClcbiAgICAgICAgfVxuICAgICAgICBcbiAgICB9XG4gICAgXG59KS5jO1xuSm9vc2UuTmFtZXNwYWNlID0gSm9vc2Uuc3R1YigpXG5cbkpvb3NlLk5hbWVzcGFjZS5BYmxlID0gbmV3IEpvb3NlLk1hbmFnZWQuUm9sZSgnSm9vc2UuTmFtZXNwYWNlLkFibGUnLCB7XG5cbiAgICBoYXZlIDoge1xuICAgICAgICBib2R5RnVuYyAgICAgICAgICAgICAgICA6IG51bGxcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGJlZm9yZSA6IHtcbiAgICAgICAgZXh0ZW5kIDogZnVuY3Rpb24gKGV4dGVuZCkge1xuICAgICAgICAgICAgaWYgKGV4dGVuZC5ib2R5KSB7XG4gICAgICAgICAgICAgICAgdGhpcy5ib2R5RnVuYyA9IGV4dGVuZC5ib2R5XG4gICAgICAgICAgICAgICAgZGVsZXRlIGV4dGVuZC5ib2R5XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGFmdGVyOiB7XG4gICAgICAgIFxuICAgICAgICBhZnRlck11dGF0ZSA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHZhciBib2R5RnVuYyA9IHRoaXMuYm9keUZ1bmNcbiAgICAgICAgICAgIGRlbGV0ZSB0aGlzLmJvZHlGdW5jXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmIChib2R5RnVuYykgSm9vc2UuTmFtZXNwYWNlLk1hbmFnZXIubXkuZXhlY3V0ZUluKHRoaXMuYywgYm9keUZ1bmMpXG4gICAgICAgIH1cbiAgICB9XG4gICAgXG59KS5jO1xuSm9vc2UuTWFuYWdlZC5Cb290c3RyYXAgPSBuZXcgSm9vc2UuTWFuYWdlZC5Sb2xlKCdKb29zZS5NYW5hZ2VkLkJvb3RzdHJhcCcsIHtcbiAgICBcbiAgICBkb2VzICAgOiBbIEpvb3NlLk5hbWVzcGFjZS5BYmxlLCBKb29zZS5NYW5hZ2VkLk15LCBKb29zZS5NYW5hZ2VkLkF0dHJpYnV0ZS5CdWlsZGVyIF1cbiAgICBcbn0pLmNcbjtcbkpvb3NlLk1ldGEgPSBKb29zZS5zdHViKClcblxuXG5Kb29zZS5NZXRhLk9iamVjdCA9IG5ldyBKb29zZS5Qcm90by5DbGFzcygnSm9vc2UuTWV0YS5PYmplY3QnLCB7XG4gICAgXG4gICAgaXNhICAgICAgICAgICAgIDogSm9vc2UuUHJvdG8uT2JqZWN0XG4gICAgXG59KS5jXG5cblxuO1xuSm9vc2UuTWV0YS5DbGFzcyA9IG5ldyBKb29zZS5NYW5hZ2VkLkNsYXNzKCdKb29zZS5NZXRhLkNsYXNzJywge1xuICAgIFxuICAgIGlzYSAgICAgICAgICAgICAgICAgICAgICAgICA6IEpvb3NlLk1hbmFnZWQuQ2xhc3MsXG4gICAgXG4gICAgZG9lcyAgICAgICAgICAgICAgICAgICAgICAgIDogSm9vc2UuTWFuYWdlZC5Cb290c3RyYXAsXG4gICAgXG4gICAgaGF2ZSA6IHtcbiAgICAgICAgZGVmYXVsdFN1cGVyQ2xhc3MgICAgICAgOiBKb29zZS5NZXRhLk9iamVjdFxuICAgIH1cbiAgICBcbn0pLmNcblxuO1xuSm9vc2UuTWV0YS5Sb2xlID0gbmV3IEpvb3NlLk1ldGEuQ2xhc3MoJ0pvb3NlLk1ldGEuUm9sZScsIHtcbiAgICBcbiAgICBpc2EgICAgICAgICAgICAgICAgICAgICAgICAgOiBKb29zZS5NYW5hZ2VkLlJvbGUsXG4gICAgXG4gICAgZG9lcyAgICAgICAgICAgICAgICAgICAgICAgIDogSm9vc2UuTWFuYWdlZC5Cb290c3RyYXBcbiAgICBcbn0pLmM7XG5Kb29zZS5OYW1lc3BhY2UuS2VlcGVyID0gbmV3IEpvb3NlLk1ldGEuQ2xhc3MoJ0pvb3NlLk5hbWVzcGFjZS5LZWVwZXInLCB7XG4gICAgXG4gICAgaXNhICAgICAgICAgOiBKb29zZS5NZXRhLkNsYXNzLFxuICAgIFxuICAgIGhhdmUgICAgICAgIDoge1xuICAgICAgICBleHRlcm5hbENvbnN0cnVjdG9yICAgICAgICAgICAgIDogbnVsbFxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgbWV0aG9kczoge1xuICAgICAgICBcbiAgICAgICAgZGVmYXVsdENvbnN0cnVjdG9yOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHJldHVybiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgICAgLy9jb25zdHJ1Y3RvcnMgc2hvdWxkIGFzc3VtZSB0aGF0IG1ldGEgaXMgYXR0YWNoZWQgdG8gJ2FyZ3VtZW50cy5jYWxsZWUnIChub3QgdG8gJ3RoaXMnKSBcbiAgICAgICAgICAgICAgICB2YXIgdGhpc01ldGEgPSBhcmd1bWVudHMuY2FsbGVlLm1ldGFcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBpZiAodGhpc01ldGEgaW5zdGFuY2VvZiBKb29zZS5OYW1lc3BhY2UuS2VlcGVyKSB0aHJvdyBuZXcgRXJyb3IoXCJNb2R1bGUgW1wiICsgdGhpc01ldGEuYyArIFwiXSBtYXkgbm90IGJlIGluc3RhbnRpYXRlZC4gRm9yZ290IHRvICd1c2UnIHRoZSBjbGFzcyB3aXRoIHRoZSBzYW1lIG5hbWU/XCIpXG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgdmFyIGV4dGVybmFsQ29uc3RydWN0b3IgPSB0aGlzTWV0YS5leHRlcm5hbENvbnN0cnVjdG9yXG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgaWYgKHR5cGVvZiBleHRlcm5hbENvbnN0cnVjdG9yID09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIGV4dGVybmFsQ29uc3RydWN0b3IubWV0YSA9IHRoaXNNZXRhXG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gZXh0ZXJuYWxDb25zdHJ1Y3Rvci5hcHBseSh0aGlzLCBhcmd1bWVudHMpXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIHRocm93IFwiTmFtZXNwYWNlS2VlcGVyIG9mIFtcIiArIHRoaXNNZXRhLm5hbWUgKyBcIl0gd2FzIHBsYW50ZWQgaW5jb3JyZWN0bHkuXCJcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICAvL3dpdGhDbGFzcyBzaG91bGQgYmUgbm90IGNvbnN0cnVjdGVkIHlldCBvbiB0aGlzIHN0YWdlIChzZWUgSm9vc2UuUHJvdG8uQ2xhc3MuY29uc3RydWN0KVxuICAgICAgICAvL2l0IHNob3VsZCBiZSBvbiB0aGUgJ2NvbnN0cnVjdG9yT25seScgbGlmZSBzdGFnZSAoc2hvdWxkIGFscmVhZHkgaGF2ZSBjb25zdHJ1Y3RvcilcbiAgICAgICAgcGxhbnQ6IGZ1bmN0aW9uICh3aXRoQ2xhc3MpIHtcbiAgICAgICAgICAgIHZhciBrZWVwZXIgPSB0aGlzLmNcbiAgICAgICAgICAgIFxuICAgICAgICAgICAga2VlcGVyLm1ldGEgPSB3aXRoQ2xhc3MubWV0YVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBrZWVwZXIubWV0YS5jID0ga2VlcGVyXG4gICAgICAgICAgICBrZWVwZXIubWV0YS5leHRlcm5hbENvbnN0cnVjdG9yID0gd2l0aENsYXNzXG4gICAgICAgIH1cbiAgICB9XG4gICAgXG59KS5jXG5cblxuO1xuSm9vc2UuTmFtZXNwYWNlLk1hbmFnZXIgPSBuZXcgSm9vc2UuTWFuYWdlZC5DbGFzcygnSm9vc2UuTmFtZXNwYWNlLk1hbmFnZXInLCB7XG4gICAgXG4gICAgaGF2ZSA6IHtcbiAgICAgICAgY3VycmVudCAgICAgOiBudWxsXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBtZXRob2RzIDoge1xuICAgICAgICBcbiAgICAgICAgaW5pdGlhbGl6ZSA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHRoaXMuY3VycmVudCAgICA9IFsgSm9vc2UudG9wIF1cbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBnZXRDdXJyZW50OiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5jdXJyZW50WzBdXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgZXhlY3V0ZUluIDogZnVuY3Rpb24gKG5zLCBmdW5jKSB7XG4gICAgICAgICAgICB2YXIgY3VycmVudCA9IHRoaXMuY3VycmVudFxuICAgICAgICAgICAgXG4gICAgICAgICAgICBjdXJyZW50LnVuc2hpZnQobnMpXG4gICAgICAgICAgICB2YXIgcmVzID0gZnVuYy5jYWxsKG5zLCBucylcbiAgICAgICAgICAgIGN1cnJlbnQuc2hpZnQoKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICByZXR1cm4gcmVzXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgZWFybHlDcmVhdGUgOiBmdW5jdGlvbiAobmFtZSwgbWV0YUNsYXNzLCBwcm9wcykge1xuICAgICAgICAgICAgcHJvcHMuY29uc3RydWN0b3JPbmx5ID0gdHJ1ZVxuICAgICAgICAgICAgXG4gICAgICAgICAgICByZXR1cm4gbmV3IG1ldGFDbGFzcyhuYW1lLCBwcm9wcykuY1xuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIC8vdGhpcyBmdW5jdGlvbiBlc3RhYmxpc2hpbmcgdGhlIGZ1bGwgXCJuYW1lc3BhY2UgY2hhaW5cIiAoaW5jbHVkaW5nIHRoZSBsYXN0IGVsZW1lbnQpXG4gICAgICAgIGNyZWF0ZSA6IGZ1bmN0aW9uIChuc05hbWUsIG1ldGFDbGFzcywgZXh0ZW5kKSB7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vaWYgbm8gbmFtZSBwcm92aWRlZCwgdGhlbiB3ZSBjcmVhdGluZyBhbiBhbm9ueW1vdXMgY2xhc3MsIHNvIGp1c3Qgc2tpcCBhbGwgdGhlIG5hbWVzcGFjZSBtYW5pcHVsYXRpb25zXG4gICAgICAgICAgICBpZiAoIW5zTmFtZSkgcmV0dXJuIG5ldyBtZXRhQ2xhc3MobnNOYW1lLCBleHRlbmQpLmNcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdmFyIG1lID0gdGhpc1xuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAoL15cXC4vLnRlc3QobnNOYW1lKSkgcmV0dXJuIHRoaXMuZXhlY3V0ZUluKEpvb3NlLnRvcCwgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgIHJldHVybiBtZS5jcmVhdGUobnNOYW1lLnJlcGxhY2UoL15cXC4vLCAnJyksIG1ldGFDbGFzcywgZXh0ZW5kKVxuICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdmFyIHByb3BzICAgPSBleHRlbmQgfHwge31cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdmFyIHBhcnRzICAgPSBKb29zZS5TLnNhbmVTcGxpdChuc05hbWUsICcuJylcbiAgICAgICAgICAgIHZhciBvYmplY3QgID0gdGhpcy5nZXRDdXJyZW50KClcbiAgICAgICAgICAgIHZhciBzb0ZhciAgID0gb2JqZWN0ID09IEpvb3NlLnRvcCA/IFtdIDogSm9vc2UuUy5zYW5lU3BsaXQob2JqZWN0Lm1ldGEubmFtZSwgJy4nKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IHBhcnRzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICAgICAgdmFyIHBhcnQgICAgICAgID0gcGFydHNbaV1cbiAgICAgICAgICAgICAgICB2YXIgaXNMYXN0ICAgICAgPSBpID09IHBhcnRzLmxlbmd0aCAtIDFcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBpZiAocGFydCA9PSBcIm1ldGFcIiB8fCBwYXJ0ID09IFwibXlcIiB8fCAhcGFydCkgdGhyb3cgXCJNb2R1bGUgbmFtZSBbXCIgKyBuc05hbWUgKyBcIl0gbWF5IG5vdCBpbmNsdWRlIGEgcGFydCBjYWxsZWQgJ21ldGEnIG9yICdteScgb3IgZW1wdHkgcGFydC5cIlxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIHZhciBjdXIgPSAgIG9iamVjdFtwYXJ0XVxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIHNvRmFyLnB1c2gocGFydClcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICB2YXIgc29GYXJOYW1lICAgICAgID0gc29GYXIuam9pbihcIi5cIilcbiAgICAgICAgICAgICAgICB2YXIgbmVlZEZpbmFsaXplICAgID0gZmFsc2VcbiAgICAgICAgICAgICAgICB2YXIgbnNLZWVwZXJcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAvLyBpZiB0aGUgbmFtZXNwYWNlIHNlZ21lbnQgaXMgZW1wdHlcbiAgICAgICAgICAgICAgICBpZiAodHlwZW9mIGN1ciA9PSBcInVuZGVmaW5lZFwiKSB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChpc0xhc3QpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIHBlcmZvcm0gXCJlYXJseSBjcmVhdGVcIiB3aGljaCBqdXN0IGZpbGxzIHRoZSBuYW1lc3BhY2Ugc2VnbWVudCB3aXRoIHJpZ2h0IGNvbnN0cnVjdG9yXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyB0aGlzIGFsbG93cyB1cyB0byBoYXZlIGEgcmlnaHQgY29uc3RydWN0b3IgaW4gdGhlIG5hbWVzcGFjZSBzZWdtZW50IHdoZW4gdGhlIGBib2R5YCB3aWxsIGJlIGNhbGxlZFxuICAgICAgICAgICAgICAgICAgICAgICAgbnNLZWVwZXIgICAgICAgID0gdGhpcy5lYXJseUNyZWF0ZShzb0Zhck5hbWUsIG1ldGFDbGFzcywgcHJvcHMpXG4gICAgICAgICAgICAgICAgICAgICAgICBuZWVkRmluYWxpemUgICAgPSB0cnVlXG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZVxuICAgICAgICAgICAgICAgICAgICAgICAgbnNLZWVwZXIgICAgICAgID0gbmV3IEpvb3NlLk5hbWVzcGFjZS5LZWVwZXIoc29GYXJOYW1lKS5jXG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICBvYmplY3RbcGFydF0gPSBuc0tlZXBlclxuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgY3VyID0gbnNLZWVwZXJcbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgfSBlbHNlIGlmIChpc0xhc3QgJiYgY3VyICYmIGN1ci5tZXRhKSB7XG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICB2YXIgY3VycmVudE1ldGEgPSBjdXIubWV0YVxuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgaWYgKG1ldGFDbGFzcyA9PSBKb29zZS5OYW1lc3BhY2UuS2VlcGVyKVxuICAgICAgICAgICAgICAgICAgICAgICAgLy9gTW9kdWxlYCBvdmVyIHNvbWV0aGluZyBjYXNlIC0gZXh0ZW5kIHRoZSBvcmlnaW5hbFxuICAgICAgICAgICAgICAgICAgICAgICAgY3VycmVudE1ldGEuZXh0ZW5kKHByb3BzKVxuICAgICAgICAgICAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGN1cnJlbnRNZXRhIGluc3RhbmNlb2YgSm9vc2UuTmFtZXNwYWNlLktlZXBlcikge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGN1cnJlbnRNZXRhLnBsYW50KHRoaXMuZWFybHlDcmVhdGUoc29GYXJOYW1lLCBtZXRhQ2xhc3MsIHByb3BzKSlcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBuZWVkRmluYWxpemUgPSB0cnVlXG4gICAgICAgICAgICAgICAgICAgICAgICB9IGVsc2VcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJEb3VibGUgZGVjbGFyYXRpb24gb2YgW1wiICsgc29GYXJOYW1lICsgXCJdXCIpXG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgfSBlbHNlIFxuICAgICAgICAgICAgICAgICAgICBpZiAoaXNMYXN0ICYmICEoY3VyICYmIGN1ci5tZXRhICYmIGN1ci5tZXRhLm1ldGEpKSB0aHJvdyBcIlRyeWluZyB0byBzZXR1cCBtb2R1bGUgXCIgKyBzb0Zhck5hbWUgKyBcIiBmYWlsZWQuIFRoZXJlIGlzIGFscmVhZHkgc29tZXRoaW5nOiBcIiArIGN1clxuXG4gICAgICAgICAgICAgICAgLy8gaG9vayB0byBhbGxvdyBlbWJlZGQgcmVzb3VyY2UgaW50byBtZXRhXG4gICAgICAgICAgICAgICAgaWYgKGlzTGFzdCkgdGhpcy5wcmVwYXJlTWV0YShjdXIubWV0YSlcbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgaWYgKG5lZWRGaW5hbGl6ZSkgY3VyLm1ldGEuY29uc3RydWN0KHByb3BzKVxuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBvYmplY3QgPSBjdXJcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcmV0dXJuIG9iamVjdFxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIHByZXBhcmVNZXRhIDogZnVuY3Rpb24gKCkge1xuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIHByZXBhcmVQcm9wZXJ0aWVzIDogZnVuY3Rpb24gKG5hbWUsIHByb3BzLCBkZWZhdWx0TWV0YSwgY2FsbGJhY2spIHtcbiAgICAgICAgICAgIGlmIChuYW1lICYmIHR5cGVvZiBuYW1lICE9ICdzdHJpbmcnKSB7XG4gICAgICAgICAgICAgICAgcHJvcHMgICA9IG5hbWVcbiAgICAgICAgICAgICAgICBuYW1lICAgID0gbnVsbFxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB2YXIgbWV0YVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAocHJvcHMgJiYgcHJvcHMubWV0YSkge1xuICAgICAgICAgICAgICAgIG1ldGEgPSBwcm9wcy5tZXRhXG4gICAgICAgICAgICAgICAgZGVsZXRlIHByb3BzLm1ldGFcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKCFtZXRhKVxuICAgICAgICAgICAgICAgIGlmIChwcm9wcyAmJiB0eXBlb2YgcHJvcHMuaXNhID09ICdmdW5jdGlvbicgJiYgcHJvcHMuaXNhLm1ldGEpXG4gICAgICAgICAgICAgICAgICAgIG1ldGEgPSBwcm9wcy5pc2EubWV0YS5jb25zdHJ1Y3RvclxuICAgICAgICAgICAgICAgIGVsc2VcbiAgICAgICAgICAgICAgICAgICAgbWV0YSA9IGRlZmF1bHRNZXRhXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHJldHVybiBjYWxsYmFjay5jYWxsKHRoaXMsIG5hbWUsIG1ldGEsIHByb3BzKVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIGdldERlZmF1bHRIZWxwZXJGb3IgOiBmdW5jdGlvbiAobWV0YUNsYXNzKSB7XG4gICAgICAgICAgICB2YXIgbWUgPSB0aGlzXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHJldHVybiBmdW5jdGlvbiAobmFtZSwgcHJvcHMpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gbWUucHJlcGFyZVByb3BlcnRpZXMobmFtZSwgcHJvcHMsIG1ldGFDbGFzcywgZnVuY3Rpb24gKG5hbWUsIG1ldGEsIHByb3BzKSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBtZS5jcmVhdGUobmFtZSwgbWV0YSwgcHJvcHMpXG4gICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICByZWdpc3RlciA6IGZ1bmN0aW9uIChoZWxwZXJOYW1lLCBtZXRhQ2xhc3MsIGZ1bmMpIHtcbiAgICAgICAgICAgIHZhciBtZSA9IHRoaXNcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKHRoaXMubWV0YS5oYXNNZXRob2QoaGVscGVyTmFtZSkpIHtcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICB2YXIgaGVscGVyID0gZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gbWVbIGhlbHBlck5hbWUgXS5hcHBseShtZSwgYXJndW1lbnRzKVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBpZiAoIUpvb3NlLnRvcFsgaGVscGVyTmFtZSBdKSAgIEpvb3NlLnRvcFsgaGVscGVyTmFtZSBdICAgICAgICAgPSBoZWxwZXJcbiAgICAgICAgICAgICAgICBpZiAoIUpvb3NlWyBoZWxwZXJOYW1lIF0pICAgICAgIEpvb3NlWyBoZWxwZXJOYW1lIF0gICAgICAgICAgICAgPSBoZWxwZXJcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBpZiAoSm9vc2UuaXNfTm9kZUpTICYmIHR5cGVvZiBleHBvcnRzICE9ICd1bmRlZmluZWQnKSAgICAgICAgICAgIGV4cG9ydHNbIGhlbHBlck5hbWUgXSAgICA9IGhlbHBlclxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICB2YXIgbWV0aG9kcyA9IHt9XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgbWV0aG9kc1sgaGVscGVyTmFtZSBdID0gZnVuYyB8fCB0aGlzLmdldERlZmF1bHRIZWxwZXJGb3IobWV0YUNsYXNzKVxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIHRoaXMubWV0YS5leHRlbmQoe1xuICAgICAgICAgICAgICAgICAgICBtZXRob2RzIDogbWV0aG9kc1xuICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgdGhpcy5yZWdpc3RlcihoZWxwZXJOYW1lKVxuICAgICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIE1vZHVsZSA6IGZ1bmN0aW9uIChuYW1lLCBwcm9wcykge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMucHJlcGFyZVByb3BlcnRpZXMobmFtZSwgcHJvcHMsIEpvb3NlLk5hbWVzcGFjZS5LZWVwZXIsIGZ1bmN0aW9uIChuYW1lLCBtZXRhLCBwcm9wcykge1xuICAgICAgICAgICAgICAgIGlmICh0eXBlb2YgcHJvcHMgPT0gJ2Z1bmN0aW9uJykgcHJvcHMgPSB7IGJvZHkgOiBwcm9wcyB9ICAgIFxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLmNyZWF0ZShuYW1lLCBtZXRhLCBwcm9wcylcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH1cbiAgICB9XG4gICAgXG59KS5jXG5cbkpvb3NlLk5hbWVzcGFjZS5NYW5hZ2VyLm15ID0gbmV3IEpvb3NlLk5hbWVzcGFjZS5NYW5hZ2VyKClcblxuSm9vc2UuTmFtZXNwYWNlLk1hbmFnZXIubXkucmVnaXN0ZXIoJ0NsYXNzJywgSm9vc2UuTWV0YS5DbGFzcylcbkpvb3NlLk5hbWVzcGFjZS5NYW5hZ2VyLm15LnJlZ2lzdGVyKCdSb2xlJywgSm9vc2UuTWV0YS5Sb2xlKVxuSm9vc2UuTmFtZXNwYWNlLk1hbmFnZXIubXkucmVnaXN0ZXIoJ01vZHVsZScpXG5cblxuLy8gZm9yIHRoZSByZXN0IG9mIHRoZSBwYWNrYWdlXG52YXIgQ2xhc3MgICAgICAgPSBKb29zZS5DbGFzc1xudmFyIFJvbGUgICAgICAgID0gSm9vc2UuUm9sZVxuO1xuUm9sZSgnSm9vc2UuQXR0cmlidXRlLkRlbGVnYXRlJywge1xuICAgIFxuICAgIGhhdmUgOiB7XG4gICAgICAgIGhhbmRsZXMgOiBudWxsXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBvdmVycmlkZSA6IHtcbiAgICAgICAgXG4gICAgICAgIGVhY2hEZWxlZ2F0ZSA6IGZ1bmN0aW9uIChoYW5kbGVzLCBmdW5jLCBzY29wZSkge1xuICAgICAgICAgICAgaWYgKHR5cGVvZiBoYW5kbGVzID09ICdzdHJpbmcnKSByZXR1cm4gZnVuYy5jYWxsKHNjb3BlLCBoYW5kbGVzLCBoYW5kbGVzKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAoaGFuZGxlcyBpbnN0YW5jZW9mIEFycmF5KVxuICAgICAgICAgICAgICAgIHJldHVybiBKb29zZS5BLmVhY2goaGFuZGxlcywgZnVuY3Rpb24gKGRlbGVnYXRlVG8pIHtcbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIGZ1bmMuY2FsbChzY29wZSwgZGVsZWdhdGVUbywgZGVsZWdhdGVUbylcbiAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKGhhbmRsZXMgPT09IE9iamVjdChoYW5kbGVzKSlcbiAgICAgICAgICAgICAgICBKb29zZS5PLmVhY2hPd24oaGFuZGxlcywgZnVuY3Rpb24gKGRlbGVnYXRlVG8sIGhhbmRsZUFzKSB7XG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICBmdW5jLmNhbGwoc2NvcGUsIGhhbmRsZUFzLCBkZWxlZ2F0ZVRvKVxuICAgICAgICAgICAgICAgIH0pXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgZ2V0QWNjZXNzb3JzRm9yIDogZnVuY3Rpb24gKHRhcmdldENsYXNzKSB7XG4gICAgICAgICAgICB2YXIgdGFyZ2V0TWV0YSAgPSB0YXJnZXRDbGFzcy5tZXRhXG4gICAgICAgICAgICB2YXIgbWV0aG9kcyAgICAgPSB0aGlzLlNVUEVSKHRhcmdldENsYXNzKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB2YXIgbWUgICAgICA9IHRoaXNcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpcy5lYWNoRGVsZWdhdGUodGhpcy5oYW5kbGVzLCBmdW5jdGlvbiAoaGFuZGxlQXMsIGRlbGVnYXRlVG8pIHtcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBpZiAoIXRhcmdldE1ldGEuaGFzTWV0aG9kKGhhbmRsZUFzKSkge1xuICAgICAgICAgICAgICAgICAgICB2YXIgaGFuZGxlciA9IG1ldGhvZHNbIGhhbmRsZUFzIF0gPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICB2YXIgYXR0clZhbHVlID0gbWUuZ2V0VmFsdWVGcm9tKHRoaXMpXG4gICAgICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBhdHRyVmFsdWVbIGRlbGVnYXRlVG8gXS5hcHBseShhdHRyVmFsdWUsIGFyZ3VtZW50cylcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgaGFuZGxlci5BQ0NFU1NPUl9GUk9NID0gbWVcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KVxuICAgICAgICAgICAgXG4gICAgICAgICAgICByZXR1cm4gbWV0aG9kc1xuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIGdldEFjY2Vzc29yc0Zyb20gOiBmdW5jdGlvbiAoZnJvbSkge1xuICAgICAgICAgICAgdmFyIG1ldGhvZHMgPSB0aGlzLlNVUEVSKGZyb20pXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciBtZSAgICAgICAgICA9IHRoaXNcbiAgICAgICAgICAgIHZhciB0YXJnZXRNZXRhICA9IGZyb20ubWV0YVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLmVhY2hEZWxlZ2F0ZSh0aGlzLmhhbmRsZXMsIGZ1bmN0aW9uIChoYW5kbGVBcykge1xuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIHZhciBoYW5kbGVyID0gdGFyZ2V0TWV0YS5nZXRNZXRob2QoaGFuZGxlQXMpXG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgaWYgKGhhbmRsZXIgJiYgaGFuZGxlci52YWx1ZS5BQ0NFU1NPUl9GUk9NID09IG1lKSBtZXRob2RzLnB1c2goaGFuZGxlQXMpXG4gICAgICAgICAgICB9KVxuICAgICAgICAgICAgXG4gICAgICAgICAgICByZXR1cm4gbWV0aG9kc1xuICAgICAgICB9XG4gICAgfVxufSlcblxuO1xuUm9sZSgnSm9vc2UuQXR0cmlidXRlLlRyaWdnZXInLCB7XG4gICAgXG4gICAgaGF2ZSA6IHtcbiAgICAgICAgdHJpZ2dlciAgICAgICAgOiBudWxsXG4gICAgfSwgXG5cbiAgICBcbiAgICBhZnRlciA6IHtcbiAgICAgICAgaW5pdGlhbGl6ZSA6IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgaWYgKHRoaXMudHJpZ2dlcikge1xuICAgICAgICAgICAgICAgIGlmICghdGhpcy53cml0ZWFibGUpIHRocm93IG5ldyBFcnJvcihcIkNhbid0IHVzZSBgdHJpZ2dlcmAgZm9yIHJlYWQtb25seSBhdHRyaWJ1dGVzXCIpXG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgdGhpcy5oYXNTZXR0ZXIgPSB0cnVlXG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9LFxuICAgIFxuICAgIFxuICAgIG92ZXJyaWRlIDoge1xuICAgICAgICBcbiAgICAgICAgZ2V0U2V0dGVyIDogZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICB2YXIgb3JpZ2luYWwgICAgPSB0aGlzLlNVUEVSKClcbiAgICAgICAgICAgIHZhciB0cmlnZ2VyICAgICA9IHRoaXMudHJpZ2dlclxuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAoIXRyaWdnZXIpIHJldHVybiBvcmlnaW5hbFxuICAgICAgICAgICAgXG4gICAgICAgICAgICB2YXIgbWUgICAgICA9IHRoaXNcbiAgICAgICAgICAgIHZhciBpbml0ICAgID0gSm9vc2UuTy5pc0Z1bmN0aW9uKG1lLmluaXQpID8gbnVsbCA6IG1lLmluaXRcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcmV0dXJuIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgICB2YXIgb2xkVmFsdWUgICAgPSBtZS5oYXNWYWx1ZSh0aGlzKSA/IG1lLmdldFZhbHVlRnJvbSh0aGlzKSA6IGluaXRcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICB2YXIgcmVzICAgICAgICAgPSBvcmlnaW5hbC5hcHBseSh0aGlzLCBhcmd1bWVudHMpXG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgdHJpZ2dlci5jYWxsKHRoaXMsIG1lLmdldFZhbHVlRnJvbSh0aGlzKSwgb2xkVmFsdWUpXG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgcmV0dXJuIHJlc1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxufSkgICAgXG5cbjtcblJvbGUoJ0pvb3NlLkF0dHJpYnV0ZS5MYXp5Jywge1xuICAgIFxuICAgIFxuICAgIGhhdmUgOiB7XG4gICAgICAgIGxhenkgICAgICAgIDogbnVsbFxuICAgIH0sIFxuICAgIFxuICAgIFxuICAgIGJlZm9yZSA6IHtcbiAgICAgICAgY29tcHV0ZVZhbHVlIDogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgaWYgKHR5cGVvZiB0aGlzLmluaXQgPT0gJ2Z1bmN0aW9uJyAmJiB0aGlzLmxhenkpIHtcbiAgICAgICAgICAgICAgICB0aGlzLmxhenkgPSB0aGlzLmluaXQgICAgXG4gICAgICAgICAgICAgICAgZGVsZXRlIHRoaXMuaW5pdCAgICBcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgYWZ0ZXIgOiB7XG4gICAgICAgIGluaXRpYWxpemUgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBpZiAodGhpcy5sYXp5KSB0aGlzLnJlYWRhYmxlID0gdGhpcy5oYXNHZXR0ZXIgPSB0cnVlXG4gICAgICAgIH1cbiAgICB9LFxuICAgIFxuICAgIFxuICAgIG92ZXJyaWRlIDoge1xuICAgICAgICBcbiAgICAgICAgZ2V0R2V0dGVyIDogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgdmFyIG9yaWdpbmFsICAgID0gdGhpcy5TVVBFUigpXG4gICAgICAgICAgICB2YXIgbGF6eSAgICAgICAgPSB0aGlzLmxhenlcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKCFsYXp5KSByZXR1cm4gb3JpZ2luYWxcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdmFyIG1lICAgICAgPSB0aGlzICAgIFxuICAgICAgICAgICAgXG4gICAgICAgICAgICByZXR1cm4gZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgIGlmICghbWUuaGFzVmFsdWUodGhpcykpIHtcbiAgICAgICAgICAgICAgICAgICAgdmFyIGluaXRpYWxpemVyID0gdHlwZW9mIGxhenkgPT0gJ2Z1bmN0aW9uJyA/IGxhenkgOiB0aGlzWyBsYXp5LnJlcGxhY2UoL150aGlzXFwuLywgJycpIF1cbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIG1lLnNldFZhbHVlVG8odGhpcywgaW5pdGlhbGl6ZXIuYXBwbHkodGhpcywgYXJndW1lbnRzKSlcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgcmV0dXJuIG9yaWdpbmFsLmNhbGwodGhpcykgICAgXG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG59KVxuXG47XG5Sb2xlKCdKb29zZS5BdHRyaWJ1dGUuQWNjZXNzb3IuQ29tYmluZWQnLCB7XG4gICAgXG4gICAgXG4gICAgaGF2ZSA6IHtcbiAgICAgICAgaXNDb21iaW5lZCAgICAgICAgOiBmYWxzZVxuICAgIH0sIFxuICAgIFxuICAgIFxuICAgIGFmdGVyIDoge1xuICAgICAgICBpbml0aWFsaXplIDogZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICB0aGlzLmlzQ29tYmluZWQgPSB0aGlzLmlzQ29tYmluZWQgfHwgLy4uYy9pLnRlc3QodGhpcy5pcylcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKHRoaXMuaXNDb21iaW5lZCkge1xuICAgICAgICAgICAgICAgIHRoaXMuc2xvdCA9ICckJCcgKyB0aGlzLm5hbWVcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICB0aGlzLmhhc0dldHRlciA9IHRydWVcbiAgICAgICAgICAgICAgICB0aGlzLmhhc1NldHRlciA9IGZhbHNlXG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgdGhpcy5zZXR0ZXJOYW1lID0gdGhpcy5nZXR0ZXJOYW1lID0gdGhpcy5wdWJsaWNOYW1lXG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9LFxuICAgIFxuICAgIFxuICAgIG92ZXJyaWRlIDoge1xuICAgICAgICBcbiAgICAgICAgZ2V0R2V0dGVyIDogZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICB2YXIgZ2V0dGVyICAgID0gdGhpcy5TVVBFUigpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmICghdGhpcy5pc0NvbWJpbmVkKSByZXR1cm4gZ2V0dGVyXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciBzZXR0ZXIgICAgPSB0aGlzLmdldFNldHRlcigpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciBtZSA9IHRoaXNcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcmV0dXJuIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBpZiAoIWFyZ3VtZW50cy5sZW5ndGgpIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKG1lLnJlYWRhYmxlKSByZXR1cm4gZ2V0dGVyLmNhbGwodGhpcylcbiAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ2FsbCB0byBnZXR0ZXIgb2YgdW5yZWFkYWJsZSBhdHRyaWJ1dGU6IFtcIiArIG1lLm5hbWUgKyBcIl1cIilcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgaWYgKG1lLndyaXRlYWJsZSkgcmV0dXJuIHNldHRlci5hcHBseSh0aGlzLCBhcmd1bWVudHMpXG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ2FsbCB0byBzZXR0ZXIgb2YgcmVhZC1vbmx5IGF0dHJpYnV0ZTogW1wiICsgbWUubmFtZSArIFwiXVwiKSAgICBcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cbiAgICBcbn0pXG5cbjtcbkpvb3NlLk1hbmFnZWQuQXR0cmlidXRlLm1ldGEuZXh0ZW5kKHtcbiAgICBkb2VzIDogWyBKb29zZS5BdHRyaWJ1dGUuRGVsZWdhdGUsIEpvb3NlLkF0dHJpYnV0ZS5UcmlnZ2VyLCBKb29zZS5BdHRyaWJ1dGUuTGF6eSwgSm9vc2UuQXR0cmlidXRlLkFjY2Vzc29yLkNvbWJpbmVkIF1cbn0pICAgICAgICAgICAgXG5cbjtcblJvbGUoJ0pvb3NlLk1ldGEuU2luZ2xldG9uJywge1xuICAgIFxuICAgIGhhcyA6IHtcbiAgICAgICAgZm9yY2VJbnN0YW5jZSAgICAgICAgICAgOiBKb29zZS5JLk9iamVjdCxcbiAgICAgICAgaW5zdGFuY2UgICAgICAgICAgICAgICAgOiBudWxsXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBcbiAgICBvdmVycmlkZSA6IHtcbiAgICAgICAgXG4gICAgICAgIGRlZmF1bHRDb25zdHJ1Y3RvciA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHZhciBtZXRhICAgICAgICA9IHRoaXNcbiAgICAgICAgICAgIHZhciBwcmV2aW91cyAgICA9IHRoaXMuU1VQRVIoKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLmFkYXB0Q29uc3RydWN0b3IocHJldmlvdXMpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHJldHVybiBmdW5jdGlvbiAoZm9yY2VJbnN0YW5jZSwgcGFyYW1zKSB7XG4gICAgICAgICAgICAgICAgaWYgKGZvcmNlSW5zdGFuY2UgPT0gbWV0YS5mb3JjZUluc3RhbmNlKSByZXR1cm4gcHJldmlvdXMuYXBwbHkodGhpcywgcGFyYW1zKSB8fCB0aGlzXG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgdmFyIGluc3RhbmNlID0gbWV0YS5pbnN0YW5jZVxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIGlmIChpbnN0YW5jZSkge1xuICAgICAgICAgICAgICAgICAgICBpZiAobWV0YS5oYXNNZXRob2QoJ2NvbmZpZ3VyZScpKSBpbnN0YW5jZS5jb25maWd1cmUuYXBwbHkoaW5zdGFuY2UsIGFyZ3VtZW50cylcbiAgICAgICAgICAgICAgICB9IGVsc2VcbiAgICAgICAgICAgICAgICAgICAgbWV0YS5pbnN0YW5jZSA9IG5ldyBtZXRhLmMobWV0YS5mb3JjZUluc3RhbmNlLCBhcmd1bWVudHMpXG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIHJldHVybiBtZXRhLmluc3RhbmNlXG4gICAgICAgICAgICB9XG4gICAgICAgIH0gICAgICAgIFxuICAgIH1cbiAgICBcblxufSlcblxuXG5Kb29zZS5OYW1lc3BhY2UuTWFuYWdlci5teS5yZWdpc3RlcignU2luZ2xldG9uJywgQ2xhc3Moe1xuICAgIGlzYSAgICAgOiBKb29zZS5NZXRhLkNsYXNzLFxuICAgIG1ldGEgICAgOiBKb29zZS5NZXRhLkNsYXNzLFxuICAgIFxuICAgIGRvZXMgICAgOiBKb29zZS5NZXRhLlNpbmdsZXRvblxufSkpXG47XG47XG59KCk7O1xuIiwiLy8gZXhwb3NlIG1vZHVsZSBjbGFzc2VzXHJcblxyXG5leHBvcnRzLkludGVyc2VjdGlvbiA9IHJlcXVpcmUoJy4vbGliL0ludGVyc2VjdGlvbicpO1xyXG5leHBvcnRzLkludGVyc2VjdGlvblBhcmFtcyA9IHJlcXVpcmUoJy4vbGliL0ludGVyc2VjdGlvblBhcmFtcycpO1xyXG5cclxuLy8gZXhwb3NlIGFmZmluZSBtb2R1bGUgY2xhc3Nlc1xyXG5leHBvcnRzLlBvaW50MkQgPSByZXF1aXJlKCdrbGQtYWZmaW5lJykuUG9pbnQyRDtcclxuIiwiLyoqXHJcbiAqXHJcbiAqICBJbnRlcnNlY3Rpb24uanNcclxuICpcclxuICogIGNvcHlyaWdodCAyMDAyLCAyMDEzIEtldmluIExpbmRzZXlcclxuICpcclxuICovXHJcblxyXG52YXIgUG9pbnQyRCA9IHJlcXVpcmUoJ2tsZC1hZmZpbmUnKS5Qb2ludDJELFxyXG4gICAgVmVjdG9yMkQgPSByZXF1aXJlKCdrbGQtYWZmaW5lJykuVmVjdG9yMkQsXHJcbiAgICBQb2x5bm9taWFsID0gcmVxdWlyZSgna2xkLXBvbHlub21pYWwnKS5Qb2x5bm9taWFsO1xyXG5cclxuLyoqXHJcbiAqICBJbnRlcnNlY3Rpb25cclxuICovXHJcbmZ1bmN0aW9uIEludGVyc2VjdGlvbihzdGF0dXMpIHtcclxuICAgIHRoaXMuaW5pdChzdGF0dXMpO1xyXG59XHJcblxyXG4vKipcclxuICogIGluaXRcclxuICpcclxuICogIEBwYXJhbSB7U3RyaW5nfSBzdGF0dXNcclxuICogIEByZXR1cm5zIHtJbnRlcnNlY3Rpb259XHJcbiAqL1xyXG5JbnRlcnNlY3Rpb24ucHJvdG90eXBlLmluaXQgPSBmdW5jdGlvbihzdGF0dXMpIHtcclxuICAgIHRoaXMuc3RhdHVzID0gc3RhdHVzO1xyXG4gICAgdGhpcy5wb2ludHMgPSBuZXcgQXJyYXkoKTtcclxufTtcclxuXHJcbi8qKlxyXG4gKiAgYXBwZW5kUG9pbnRcclxuICpcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gcG9pbnRcclxuICovXHJcbkludGVyc2VjdGlvbi5wcm90b3R5cGUuYXBwZW5kUG9pbnQgPSBmdW5jdGlvbihwb2ludCkge1xyXG4gICAgdGhpcy5wb2ludHMucHVzaChwb2ludCk7XHJcbn07XHJcblxyXG4vKipcclxuICogIGFwcGVuZFBvaW50c1xyXG4gKlxyXG4gKiAgQHBhcmFtIHtBcnJheTxQb2ludDJEPn0gcG9pbnRzXHJcbiAqL1xyXG5JbnRlcnNlY3Rpb24ucHJvdG90eXBlLmFwcGVuZFBvaW50cyA9IGZ1bmN0aW9uKHBvaW50cykge1xyXG4gICAgdGhpcy5wb2ludHMgPSB0aGlzLnBvaW50cy5jb25jYXQocG9pbnRzKTtcclxufTtcclxuXHJcbi8vIHN0YXRpYyBtZXRob2RzXHJcblxyXG4vKipcclxuICogIGludGVyc2VjdFNoYXBlc1xyXG4gKlxyXG4gKiAgQHBhcmFtIHtJbnRlcnNlY3Rpb25QYXJhbXN9IHNoYXBlMVxyXG4gKiAgQHBhcmFtIHtJbnRlcnNlY3Rpb25QYXJhbXN9IHNoYXBlMlxyXG4gKiAgQHJldHVybnMge0ludGVyc2VjdGlvbn1cclxuICovXHJcbkludGVyc2VjdGlvbi5pbnRlcnNlY3RTaGFwZXMgPSBmdW5jdGlvbihzaGFwZTEsIHNoYXBlMikge1xyXG4gICAgdmFyIGlwMSA9IHNoYXBlMS5nZXRJbnRlcnNlY3Rpb25QYXJhbXMoKTtcclxuICAgIHZhciBpcDIgPSBzaGFwZTIuZ2V0SW50ZXJzZWN0aW9uUGFyYW1zKCk7XHJcbiAgICB2YXIgcmVzdWx0O1xyXG5cclxuICAgIGlmICggaXAxICE9IG51bGwgJiYgaXAyICE9IG51bGwgKSB7XHJcbiAgICAgICAgaWYgKCBpcDEubmFtZSA9PSBcIlBhdGhcIiApIHtcclxuICAgICAgICAgICAgcmVzdWx0ID0gSW50ZXJzZWN0aW9uLmludGVyc2VjdFBhdGhTaGFwZShzaGFwZTEsIHNoYXBlMik7XHJcbiAgICAgICAgfSBlbHNlIGlmICggaXAyLm5hbWUgPT0gXCJQYXRoXCIgKSB7XHJcbiAgICAgICAgICAgIHJlc3VsdCA9IEludGVyc2VjdGlvbi5pbnRlcnNlY3RQYXRoU2hhcGUoc2hhcGUyLCBzaGFwZTEpO1xyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgIHZhciBtZXRob2Q7XHJcbiAgICAgICAgICAgIHZhciBwYXJhbXM7XHJcblxyXG4gICAgICAgICAgICBpZiAoIGlwMS5uYW1lIDwgaXAyLm5hbWUgKSB7XHJcbiAgICAgICAgICAgICAgICBtZXRob2QgPSBcImludGVyc2VjdFwiICsgaXAxLm5hbWUgKyBpcDIubmFtZTtcclxuICAgICAgICAgICAgICAgIHBhcmFtcyA9IGlwMS5wYXJhbXMuY29uY2F0KCBpcDIucGFyYW1zICk7XHJcbiAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICBtZXRob2QgPSBcImludGVyc2VjdFwiICsgaXAyLm5hbWUgKyBpcDEubmFtZTtcclxuICAgICAgICAgICAgICAgIHBhcmFtcyA9IGlwMi5wYXJhbXMuY29uY2F0KCBpcDEucGFyYW1zICk7XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIGlmICggIShtZXRob2QgaW4gSW50ZXJzZWN0aW9uKSApXHJcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJJbnRlcnNlY3Rpb24gbm90IGF2YWlsYWJsZTogXCIgKyBtZXRob2QpO1xyXG5cclxuICAgICAgICAgICAgcmVzdWx0ID0gSW50ZXJzZWN0aW9uW21ldGhvZF0uYXBwbHkobnVsbCwgcGFyYW1zKTtcclxuICAgICAgICB9XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICAgIHJlc3VsdCA9IG5ldyBJbnRlcnNlY3Rpb24oXCJObyBJbnRlcnNlY3Rpb25cIik7XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIHJlc3VsdDtcclxufTtcclxuXHJcbi8qKlxyXG4gKiAgaW50ZXJzZWN0UGF0aFNoYXBlXHJcbiAqXHJcbiAqICBAcGFyYW0ge0ludGVyc2VjdGlvblBhcmFtc30gcGF0aFxyXG4gKiAgQHBhcmFtIHtJbnRlcnNlY3Rpb25QYXJhbXN9IHNoYXBlXHJcbiAqICBAcmV0dXJucyB7SW50ZXJzZWN0aW9ufVxyXG4gKi9cclxuSW50ZXJzZWN0aW9uLmludGVyc2VjdFBhdGhTaGFwZSA9IGZ1bmN0aW9uKHBhdGgsIHNoYXBlKSB7XHJcbiAgICByZXR1cm4gcGF0aC5pbnRlcnNlY3RTaGFwZShzaGFwZSk7XHJcbn07XHJcblxyXG4vKipcclxuICogIGludGVyc2VjdEJlemllcjJCZXppZXIyXHJcbiAqXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IGExXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IGEyXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IGEzXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IGIxXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IGIyXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IGIzXHJcbiAqICBAcmV0dXJucyB7SW50ZXJzZWN0aW9ufVxyXG4gKi9cclxuSW50ZXJzZWN0aW9uLmludGVyc2VjdEJlemllcjJCZXppZXIyID0gZnVuY3Rpb24oYTEsIGEyLCBhMywgYjEsIGIyLCBiMykge1xyXG4gICAgdmFyIGEsIGI7XHJcbiAgICB2YXIgYzEyLCBjMTEsIGMxMDtcclxuICAgIHZhciBjMjIsIGMyMSwgYzIwO1xyXG4gICAgdmFyIHJlc3VsdCA9IG5ldyBJbnRlcnNlY3Rpb24oXCJObyBJbnRlcnNlY3Rpb25cIik7XHJcbiAgICB2YXIgcG9seTtcclxuXHJcbiAgICBhID0gYTIubXVsdGlwbHkoLTIpO1xyXG4gICAgYzEyID0gYTEuYWRkKGEuYWRkKGEzKSk7XHJcblxyXG4gICAgYSA9IGExLm11bHRpcGx5KC0yKTtcclxuICAgIGIgPSBhMi5tdWx0aXBseSgyKTtcclxuICAgIGMxMSA9IGEuYWRkKGIpO1xyXG5cclxuICAgIGMxMCA9IG5ldyBQb2ludDJEKGExLngsIGExLnkpO1xyXG5cclxuICAgIGEgPSBiMi5tdWx0aXBseSgtMik7XHJcbiAgICBjMjIgPSBiMS5hZGQoYS5hZGQoYjMpKTtcclxuXHJcbiAgICBhID0gYjEubXVsdGlwbHkoLTIpO1xyXG4gICAgYiA9IGIyLm11bHRpcGx5KDIpO1xyXG4gICAgYzIxID0gYS5hZGQoYik7XHJcblxyXG4gICAgYzIwID0gbmV3IFBvaW50MkQoYjEueCwgYjEueSk7XHJcblxyXG4gICAgaWYgKCBjMTIueSA9PSAwICkge1xyXG4gICAgICAgIHZhciB2MCA9IGMxMi54KihjMTAueSAtIGMyMC55KTtcclxuICAgICAgICB2YXIgdjEgPSB2MCAtIGMxMS54KmMxMS55O1xyXG4gICAgICAgIHZhciB2MiA9IHYwICsgdjE7XHJcbiAgICAgICAgdmFyIHYzID0gYzExLnkqYzExLnk7XHJcblxyXG4gICAgICAgIHBvbHkgPSBuZXcgUG9seW5vbWlhbChcclxuICAgICAgICAgICAgYzEyLngqYzIyLnkqYzIyLnksXHJcbiAgICAgICAgICAgIDIqYzEyLngqYzIxLnkqYzIyLnksXHJcbiAgICAgICAgICAgIGMxMi54KmMyMS55KmMyMS55IC0gYzIyLngqdjMgLSBjMjIueSp2MCAtIGMyMi55KnYxLFxyXG4gICAgICAgICAgICAtYzIxLngqdjMgLSBjMjEueSp2MCAtIGMyMS55KnYxLFxyXG4gICAgICAgICAgICAoYzEwLnggLSBjMjAueCkqdjMgKyAoYzEwLnkgLSBjMjAueSkqdjFcclxuICAgICAgICApO1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgICB2YXIgdjAgPSBjMTIueCpjMjIueSAtIGMxMi55KmMyMi54O1xyXG4gICAgICAgIHZhciB2MSA9IGMxMi54KmMyMS55IC0gYzIxLngqYzEyLnk7XHJcbiAgICAgICAgdmFyIHYyID0gYzExLngqYzEyLnkgLSBjMTEueSpjMTIueDtcclxuICAgICAgICB2YXIgdjMgPSBjMTAueSAtIGMyMC55O1xyXG4gICAgICAgIHZhciB2NCA9IGMxMi55KihjMTAueCAtIGMyMC54KSAtIGMxMi54KnYzO1xyXG4gICAgICAgIHZhciB2NSA9IC1jMTEueSp2MiArIGMxMi55KnY0O1xyXG4gICAgICAgIHZhciB2NiA9IHYyKnYyO1xyXG5cclxuICAgICAgICBwb2x5ID0gbmV3IFBvbHlub21pYWwoXHJcbiAgICAgICAgICAgIHYwKnYwLFxyXG4gICAgICAgICAgICAyKnYwKnYxLFxyXG4gICAgICAgICAgICAoLWMyMi55KnY2ICsgYzEyLnkqdjEqdjEgKyBjMTIueSp2MCp2NCArIHYwKnY1KSAvIGMxMi55LFxyXG4gICAgICAgICAgICAoLWMyMS55KnY2ICsgYzEyLnkqdjEqdjQgKyB2MSp2NSkgLyBjMTIueSxcclxuICAgICAgICAgICAgKHYzKnY2ICsgdjQqdjUpIC8gYzEyLnlcclxuICAgICAgICApO1xyXG4gICAgfVxyXG5cclxuICAgIHZhciByb290cyA9IHBvbHkuZ2V0Um9vdHMoKTtcclxuICAgIGZvciAoIHZhciBpID0gMDsgaSA8IHJvb3RzLmxlbmd0aDsgaSsrICkge1xyXG4gICAgICAgIHZhciBzID0gcm9vdHNbaV07XHJcblxyXG4gICAgICAgIGlmICggMCA8PSBzICYmIHMgPD0gMSApIHtcclxuICAgICAgICAgICAgdmFyIHhSb290cyA9IG5ldyBQb2x5bm9taWFsKFxyXG4gICAgICAgICAgICAgICAgYzEyLngsXHJcbiAgICAgICAgICAgICAgICBjMTEueCxcclxuICAgICAgICAgICAgICAgIGMxMC54IC0gYzIwLnggLSBzKmMyMS54IC0gcypzKmMyMi54XHJcbiAgICAgICAgICAgICkuZ2V0Um9vdHMoKTtcclxuICAgICAgICAgICAgdmFyIHlSb290cyA9IG5ldyBQb2x5bm9taWFsKFxyXG4gICAgICAgICAgICAgICAgYzEyLnksXHJcbiAgICAgICAgICAgICAgICBjMTEueSxcclxuICAgICAgICAgICAgICAgIGMxMC55IC0gYzIwLnkgLSBzKmMyMS55IC0gcypzKmMyMi55XHJcbiAgICAgICAgICAgICkuZ2V0Um9vdHMoKTtcclxuXHJcbiAgICAgICAgICAgIGlmICggeFJvb3RzLmxlbmd0aCA+IDAgJiYgeVJvb3RzLmxlbmd0aCA+IDAgKSB7XHJcbiAgICAgICAgICAgICAgICB2YXIgVE9MRVJBTkNFID0gMWUtNDtcclxuXHJcbiAgICAgICAgICAgICAgICBjaGVja1Jvb3RzOlxyXG4gICAgICAgICAgICAgICAgZm9yICggdmFyIGogPSAwOyBqIDwgeFJvb3RzLmxlbmd0aDsgaisrICkge1xyXG4gICAgICAgICAgICAgICAgICAgIHZhciB4Um9vdCA9IHhSb290c1tqXTtcclxuXHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKCAwIDw9IHhSb290ICYmIHhSb290IDw9IDEgKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGZvciAoIHZhciBrID0gMDsgayA8IHlSb290cy5sZW5ndGg7IGsrKyApIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmICggTWF0aC5hYnMoIHhSb290IC0geVJvb3RzW2tdICkgPCBUT0xFUkFOQ0UgKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmVzdWx0LnBvaW50cy5wdXNoKCBjMjIubXVsdGlwbHkocypzKS5hZGQoYzIxLm11bHRpcGx5KHMpLmFkZChjMjApKSApO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrIGNoZWNrUm9vdHM7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKCByZXN1bHQucG9pbnRzLmxlbmd0aCA+IDAgKSByZXN1bHQuc3RhdHVzID0gXCJJbnRlcnNlY3Rpb25cIjtcclxuXHJcbiAgICByZXR1cm4gcmVzdWx0O1xyXG59O1xyXG5cclxuXHJcbi8qKlxyXG4gKiAgaW50ZXJzZWN0QmV6aWVyMkJlemllcjNcclxuICpcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gYTFcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gYTJcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gYTNcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gYjFcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gYjJcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gYjNcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gYjRcclxuICogIEByZXR1cm5zIHtJbnRlcnNlY3Rpb259XHJcbiAqL1xyXG5JbnRlcnNlY3Rpb24uaW50ZXJzZWN0QmV6aWVyMkJlemllcjMgPSBmdW5jdGlvbihhMSwgYTIsIGEzLCBiMSwgYjIsIGIzLCBiNCkge1xyXG4gICAgdmFyIGEsIGIsYywgZDtcclxuICAgIHZhciBjMTIsIGMxMSwgYzEwO1xyXG4gICAgdmFyIGMyMywgYzIyLCBjMjEsIGMyMDtcclxuICAgIHZhciByZXN1bHQgPSBuZXcgSW50ZXJzZWN0aW9uKFwiTm8gSW50ZXJzZWN0aW9uXCIpO1xyXG5cclxuICAgIGEgPSBhMi5tdWx0aXBseSgtMik7XHJcbiAgICBjMTIgPSBhMS5hZGQoYS5hZGQoYTMpKTtcclxuXHJcbiAgICBhID0gYTEubXVsdGlwbHkoLTIpO1xyXG4gICAgYiA9IGEyLm11bHRpcGx5KDIpO1xyXG4gICAgYzExID0gYS5hZGQoYik7XHJcblxyXG4gICAgYzEwID0gbmV3IFBvaW50MkQoYTEueCwgYTEueSk7XHJcblxyXG4gICAgYSA9IGIxLm11bHRpcGx5KC0xKTtcclxuICAgIGIgPSBiMi5tdWx0aXBseSgzKTtcclxuICAgIGMgPSBiMy5tdWx0aXBseSgtMyk7XHJcbiAgICBkID0gYS5hZGQoYi5hZGQoYy5hZGQoYjQpKSk7XHJcbiAgICBjMjMgPSBuZXcgVmVjdG9yMkQoZC54LCBkLnkpO1xyXG5cclxuICAgIGEgPSBiMS5tdWx0aXBseSgzKTtcclxuICAgIGIgPSBiMi5tdWx0aXBseSgtNik7XHJcbiAgICBjID0gYjMubXVsdGlwbHkoMyk7XHJcbiAgICBkID0gYS5hZGQoYi5hZGQoYykpO1xyXG4gICAgYzIyID0gbmV3IFZlY3RvcjJEKGQueCwgZC55KTtcclxuXHJcbiAgICBhID0gYjEubXVsdGlwbHkoLTMpO1xyXG4gICAgYiA9IGIyLm11bHRpcGx5KDMpO1xyXG4gICAgYyA9IGEuYWRkKGIpO1xyXG4gICAgYzIxID0gbmV3IFZlY3RvcjJEKGMueCwgYy55KTtcclxuXHJcbiAgICBjMjAgPSBuZXcgVmVjdG9yMkQoYjEueCwgYjEueSk7XHJcblxyXG4gICAgdmFyIGMxMHgyID0gYzEwLngqYzEwLng7XHJcbiAgICB2YXIgYzEweTIgPSBjMTAueSpjMTAueTtcclxuICAgIHZhciBjMTF4MiA9IGMxMS54KmMxMS54O1xyXG4gICAgdmFyIGMxMXkyID0gYzExLnkqYzExLnk7XHJcbiAgICB2YXIgYzEyeDIgPSBjMTIueCpjMTIueDtcclxuICAgIHZhciBjMTJ5MiA9IGMxMi55KmMxMi55O1xyXG4gICAgdmFyIGMyMHgyID0gYzIwLngqYzIwLng7XHJcbiAgICB2YXIgYzIweTIgPSBjMjAueSpjMjAueTtcclxuICAgIHZhciBjMjF4MiA9IGMyMS54KmMyMS54O1xyXG4gICAgdmFyIGMyMXkyID0gYzIxLnkqYzIxLnk7XHJcbiAgICB2YXIgYzIyeDIgPSBjMjIueCpjMjIueDtcclxuICAgIHZhciBjMjJ5MiA9IGMyMi55KmMyMi55O1xyXG4gICAgdmFyIGMyM3gyID0gYzIzLngqYzIzLng7XHJcbiAgICB2YXIgYzIzeTIgPSBjMjMueSpjMjMueTtcclxuXHJcbiAgICB2YXIgcG9seSA9IG5ldyBQb2x5bm9taWFsKFxyXG4gICAgICAgIC0yKmMxMi54KmMxMi55KmMyMy54KmMyMy55ICsgYzEyeDIqYzIzeTIgKyBjMTJ5MipjMjN4MixcclxuICAgICAgICAtMipjMTIueCpjMTIueSpjMjIueCpjMjMueSAtIDIqYzEyLngqYzEyLnkqYzIyLnkqYzIzLnggKyAyKmMxMnkyKmMyMi54KmMyMy54ICtcclxuICAgICAgICAgICAgMipjMTJ4MipjMjIueSpjMjMueSxcclxuICAgICAgICAtMipjMTIueCpjMjEueCpjMTIueSpjMjMueSAtIDIqYzEyLngqYzEyLnkqYzIxLnkqYzIzLnggLSAyKmMxMi54KmMxMi55KmMyMi54KmMyMi55ICtcclxuICAgICAgICAgICAgMipjMjEueCpjMTJ5MipjMjMueCArIGMxMnkyKmMyMngyICsgYzEyeDIqKDIqYzIxLnkqYzIzLnkgKyBjMjJ5MiksXHJcbiAgICAgICAgMipjMTAueCpjMTIueCpjMTIueSpjMjMueSArIDIqYzEwLnkqYzEyLngqYzEyLnkqYzIzLnggKyBjMTEueCpjMTEueSpjMTIueCpjMjMueSArXHJcbiAgICAgICAgICAgIGMxMS54KmMxMS55KmMxMi55KmMyMy54IC0gMipjMjAueCpjMTIueCpjMTIueSpjMjMueSAtIDIqYzEyLngqYzIwLnkqYzEyLnkqYzIzLnggLVxyXG4gICAgICAgICAgICAyKmMxMi54KmMyMS54KmMxMi55KmMyMi55IC0gMipjMTIueCpjMTIueSpjMjEueSpjMjIueCAtIDIqYzEwLngqYzEyeTIqYzIzLnggLVxyXG4gICAgICAgICAgICAyKmMxMC55KmMxMngyKmMyMy55ICsgMipjMjAueCpjMTJ5MipjMjMueCArIDIqYzIxLngqYzEyeTIqYzIyLnggLVxyXG4gICAgICAgICAgICBjMTF5MipjMTIueCpjMjMueCAtIGMxMXgyKmMxMi55KmMyMy55ICsgYzEyeDIqKDIqYzIwLnkqYzIzLnkgKyAyKmMyMS55KmMyMi55KSxcclxuICAgICAgICAyKmMxMC54KmMxMi54KmMxMi55KmMyMi55ICsgMipjMTAueSpjMTIueCpjMTIueSpjMjIueCArIGMxMS54KmMxMS55KmMxMi54KmMyMi55ICtcclxuICAgICAgICAgICAgYzExLngqYzExLnkqYzEyLnkqYzIyLnggLSAyKmMyMC54KmMxMi54KmMxMi55KmMyMi55IC0gMipjMTIueCpjMjAueSpjMTIueSpjMjIueCAtXHJcbiAgICAgICAgICAgIDIqYzEyLngqYzIxLngqYzEyLnkqYzIxLnkgLSAyKmMxMC54KmMxMnkyKmMyMi54IC0gMipjMTAueSpjMTJ4MipjMjIueSArXHJcbiAgICAgICAgICAgIDIqYzIwLngqYzEyeTIqYzIyLnggLSBjMTF5MipjMTIueCpjMjIueCAtIGMxMXgyKmMxMi55KmMyMi55ICsgYzIxeDIqYzEyeTIgK1xyXG4gICAgICAgICAgICBjMTJ4MiooMipjMjAueSpjMjIueSArIGMyMXkyKSxcclxuICAgICAgICAyKmMxMC54KmMxMi54KmMxMi55KmMyMS55ICsgMipjMTAueSpjMTIueCpjMjEueCpjMTIueSArIGMxMS54KmMxMS55KmMxMi54KmMyMS55ICtcclxuICAgICAgICAgICAgYzExLngqYzExLnkqYzIxLngqYzEyLnkgLSAyKmMyMC54KmMxMi54KmMxMi55KmMyMS55IC0gMipjMTIueCpjMjAueSpjMjEueCpjMTIueSAtXHJcbiAgICAgICAgICAgIDIqYzEwLngqYzIxLngqYzEyeTIgLSAyKmMxMC55KmMxMngyKmMyMS55ICsgMipjMjAueCpjMjEueCpjMTJ5MiAtXHJcbiAgICAgICAgICAgIGMxMXkyKmMxMi54KmMyMS54IC0gYzExeDIqYzEyLnkqYzIxLnkgKyAyKmMxMngyKmMyMC55KmMyMS55LFxyXG4gICAgICAgIC0yKmMxMC54KmMxMC55KmMxMi54KmMxMi55IC0gYzEwLngqYzExLngqYzExLnkqYzEyLnkgLSBjMTAueSpjMTEueCpjMTEueSpjMTIueCArXHJcbiAgICAgICAgICAgIDIqYzEwLngqYzEyLngqYzIwLnkqYzEyLnkgKyAyKmMxMC55KmMyMC54KmMxMi54KmMxMi55ICsgYzExLngqYzIwLngqYzExLnkqYzEyLnkgK1xyXG4gICAgICAgICAgICBjMTEueCpjMTEueSpjMTIueCpjMjAueSAtIDIqYzIwLngqYzEyLngqYzIwLnkqYzEyLnkgLSAyKmMxMC54KmMyMC54KmMxMnkyICtcclxuICAgICAgICAgICAgYzEwLngqYzExeTIqYzEyLnggKyBjMTAueSpjMTF4MipjMTIueSAtIDIqYzEwLnkqYzEyeDIqYzIwLnkgLVxyXG4gICAgICAgICAgICBjMjAueCpjMTF5MipjMTIueCAtIGMxMXgyKmMyMC55KmMxMi55ICsgYzEweDIqYzEyeTIgKyBjMTB5MipjMTJ4MiArXHJcbiAgICAgICAgICAgIGMyMHgyKmMxMnkyICsgYzEyeDIqYzIweTJcclxuICAgICk7XHJcbiAgICB2YXIgcm9vdHMgPSBwb2x5LmdldFJvb3RzSW5JbnRlcnZhbCgwLDEpO1xyXG5cclxuICAgIGZvciAoIHZhciBpID0gMDsgaSA8IHJvb3RzLmxlbmd0aDsgaSsrICkge1xyXG4gICAgICAgIHZhciBzID0gcm9vdHNbaV07XHJcbiAgICAgICAgdmFyIHhSb290cyA9IG5ldyBQb2x5bm9taWFsKFxyXG4gICAgICAgICAgICBjMTIueCxcclxuICAgICAgICAgICAgYzExLngsXHJcbiAgICAgICAgICAgIGMxMC54IC0gYzIwLnggLSBzKmMyMS54IC0gcypzKmMyMi54IC0gcypzKnMqYzIzLnhcclxuICAgICAgICApLmdldFJvb3RzKCk7XHJcbiAgICAgICAgdmFyIHlSb290cyA9IG5ldyBQb2x5bm9taWFsKFxyXG4gICAgICAgICAgICBjMTIueSxcclxuICAgICAgICAgICAgYzExLnksXHJcbiAgICAgICAgICAgIGMxMC55IC0gYzIwLnkgLSBzKmMyMS55IC0gcypzKmMyMi55IC0gcypzKnMqYzIzLnlcclxuICAgICAgICApLmdldFJvb3RzKCk7XHJcblxyXG4gICAgICAgIGlmICggeFJvb3RzLmxlbmd0aCA+IDAgJiYgeVJvb3RzLmxlbmd0aCA+IDAgKSB7XHJcbiAgICAgICAgICAgIHZhciBUT0xFUkFOQ0UgPSAxZS00O1xyXG5cclxuICAgICAgICAgICAgY2hlY2tSb290czpcclxuICAgICAgICAgICAgZm9yICggdmFyIGogPSAwOyBqIDwgeFJvb3RzLmxlbmd0aDsgaisrICkge1xyXG4gICAgICAgICAgICAgICAgdmFyIHhSb290ID0geFJvb3RzW2pdO1xyXG5cclxuICAgICAgICAgICAgICAgIGlmICggMCA8PSB4Um9vdCAmJiB4Um9vdCA8PSAxICkge1xyXG4gICAgICAgICAgICAgICAgICAgIGZvciAoIHZhciBrID0gMDsgayA8IHlSb290cy5sZW5ndGg7IGsrKyApIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCBNYXRoLmFicyggeFJvb3QgLSB5Um9vdHNba10gKSA8IFRPTEVSQU5DRSApIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJlc3VsdC5wb2ludHMucHVzaChcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjMjMubXVsdGlwbHkocypzKnMpLmFkZChjMjIubXVsdGlwbHkocypzKS5hZGQoYzIxLm11bHRpcGx5KHMpLmFkZChjMjApKSlcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBicmVhayBjaGVja1Jvb3RzO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIGlmICggcmVzdWx0LnBvaW50cy5sZW5ndGggPiAwICkgcmVzdWx0LnN0YXR1cyA9IFwiSW50ZXJzZWN0aW9uXCI7XHJcblxyXG4gICAgcmV0dXJuIHJlc3VsdDtcclxuXHJcbn07XHJcblxyXG5cclxuLyoqXHJcbiAqICBpbnRlcnNlY3RCZXppZXIyQ2lyY2xlXHJcbiAqXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IHAxXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IHAyXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IHAzXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IGNcclxuICogIEBwYXJhbSB7TnVtYmVyfSByXHJcbiAqICBAcmV0dXJucyB7SW50ZXJzZWN0aW9ufVxyXG4gKi9cclxuSW50ZXJzZWN0aW9uLmludGVyc2VjdEJlemllcjJDaXJjbGUgPSBmdW5jdGlvbihwMSwgcDIsIHAzLCBjLCByKSB7XHJcbiAgICByZXR1cm4gSW50ZXJzZWN0aW9uLmludGVyc2VjdEJlemllcjJFbGxpcHNlKHAxLCBwMiwgcDMsIGMsIHIsIHIpO1xyXG59O1xyXG5cclxuXHJcbi8qKlxyXG4gKiAgaW50ZXJzZWN0QmV6aWVyMkVsbGlwc2VcclxuICpcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gcDFcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gcDJcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gcDNcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gZWNcclxuICogIEBwYXJhbSB7TnVtYmVyfSByeFxyXG4gKiAgQHBhcmFtIHtOdW1iZXJ9IHJ5XHJcbiAqICBAcmV0dXJucyB7SW50ZXJzZWN0aW9ufVxyXG4gKi9cclxuSW50ZXJzZWN0aW9uLmludGVyc2VjdEJlemllcjJFbGxpcHNlID0gZnVuY3Rpb24ocDEsIHAyLCBwMywgZWMsIHJ4LCByeSkge1xyXG4gICAgdmFyIGEsIGI7ICAgICAgIC8vIHRlbXBvcmFyeSB2YXJpYWJsZXNcclxuICAgIHZhciBjMiwgYzEsIGMwOyAvLyBjb2VmZmljaWVudHMgb2YgcXVhZHJhdGljXHJcbiAgICB2YXIgcmVzdWx0ID0gbmV3IEludGVyc2VjdGlvbihcIk5vIEludGVyc2VjdGlvblwiKTtcclxuXHJcbiAgICBhID0gcDIubXVsdGlwbHkoLTIpO1xyXG4gICAgYzIgPSBwMS5hZGQoYS5hZGQocDMpKTtcclxuXHJcbiAgICBhID0gcDEubXVsdGlwbHkoLTIpO1xyXG4gICAgYiA9IHAyLm11bHRpcGx5KDIpO1xyXG4gICAgYzEgPSBhLmFkZChiKTtcclxuXHJcbiAgICBjMCA9IG5ldyBQb2ludDJEKHAxLngsIHAxLnkpO1xyXG5cclxuICAgIHZhciByeHJ4ICA9IHJ4KnJ4O1xyXG4gICAgdmFyIHJ5cnkgID0gcnkqcnk7XHJcbiAgICB2YXIgcm9vdHMgPSBuZXcgUG9seW5vbWlhbChcclxuICAgICAgICByeXJ5KmMyLngqYzIueCArIHJ4cngqYzIueSpjMi55LFxyXG4gICAgICAgIDIqKHJ5cnkqYzIueCpjMS54ICsgcnhyeCpjMi55KmMxLnkpLFxyXG4gICAgICAgIHJ5cnkqKDIqYzIueCpjMC54ICsgYzEueCpjMS54KSArIHJ4cngqKDIqYzIueSpjMC55K2MxLnkqYzEueSkgLVxyXG4gICAgICAgICAgICAyKihyeXJ5KmVjLngqYzIueCArIHJ4cngqZWMueSpjMi55KSxcclxuICAgICAgICAyKihyeXJ5KmMxLngqKGMwLngtZWMueCkgKyByeHJ4KmMxLnkqKGMwLnktZWMueSkpLFxyXG4gICAgICAgIHJ5cnkqKGMwLngqYzAueCtlYy54KmVjLngpICsgcnhyeCooYzAueSpjMC55ICsgZWMueSplYy55KSAtXHJcbiAgICAgICAgICAgIDIqKHJ5cnkqZWMueCpjMC54ICsgcnhyeCplYy55KmMwLnkpIC0gcnhyeCpyeXJ5XHJcbiAgICApLmdldFJvb3RzKCk7XHJcblxyXG4gICAgZm9yICggdmFyIGkgPSAwOyBpIDwgcm9vdHMubGVuZ3RoOyBpKysgKSB7XHJcbiAgICAgICAgdmFyIHQgPSByb290c1tpXTtcclxuXHJcbiAgICAgICAgaWYgKCAwIDw9IHQgJiYgdCA8PSAxIClcclxuICAgICAgICAgICAgcmVzdWx0LnBvaW50cy5wdXNoKCBjMi5tdWx0aXBseSh0KnQpLmFkZChjMS5tdWx0aXBseSh0KS5hZGQoYzApKSApO1xyXG4gICAgfVxyXG5cclxuICAgIGlmICggcmVzdWx0LnBvaW50cy5sZW5ndGggPiAwICkgcmVzdWx0LnN0YXR1cyA9IFwiSW50ZXJzZWN0aW9uXCI7XHJcblxyXG4gICAgcmV0dXJuIHJlc3VsdDtcclxufTtcclxuXHJcblxyXG4vKipcclxuICogIGludGVyc2VjdEJlemllcjJMaW5lXHJcbiAqXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IHAxXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IHAyXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IHAzXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IGExXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IGEyXHJcbiAqICBAcmV0dXJucyB7SW50ZXJzZWN0aW9ufVxyXG4gKi9cclxuSW50ZXJzZWN0aW9uLmludGVyc2VjdEJlemllcjJMaW5lID0gZnVuY3Rpb24ocDEsIHAyLCBwMywgYTEsIGEyKSB7XHJcbiAgICB2YXIgYSwgYjsgICAgICAgICAgICAgLy8gdGVtcG9yYXJ5IHZhcmlhYmxlc1xyXG4gICAgdmFyIGMyLCBjMSwgYzA7ICAgICAgIC8vIGNvZWZmaWNpZW50cyBvZiBxdWFkcmF0aWNcclxuICAgIHZhciBjbDsgICAgICAgICAgICAgICAvLyBjIGNvZWZmaWNpZW50IGZvciBub3JtYWwgZm9ybSBvZiBsaW5lXHJcbiAgICB2YXIgbjsgICAgICAgICAgICAgICAgLy8gbm9ybWFsIGZvciBub3JtYWwgZm9ybSBvZiBsaW5lXHJcbiAgICB2YXIgbWluID0gYTEubWluKGEyKTsgLy8gdXNlZCB0byBkZXRlcm1pbmUgaWYgcG9pbnQgaXMgb24gbGluZSBzZWdtZW50XHJcbiAgICB2YXIgbWF4ID0gYTEubWF4KGEyKTsgLy8gdXNlZCB0byBkZXRlcm1pbmUgaWYgcG9pbnQgaXMgb24gbGluZSBzZWdtZW50XHJcbiAgICB2YXIgcmVzdWx0ID0gbmV3IEludGVyc2VjdGlvbihcIk5vIEludGVyc2VjdGlvblwiKTtcclxuXHJcbiAgICBhID0gcDIubXVsdGlwbHkoLTIpO1xyXG4gICAgYzIgPSBwMS5hZGQoYS5hZGQocDMpKTtcclxuXHJcbiAgICBhID0gcDEubXVsdGlwbHkoLTIpO1xyXG4gICAgYiA9IHAyLm11bHRpcGx5KDIpO1xyXG4gICAgYzEgPSBhLmFkZChiKTtcclxuXHJcbiAgICBjMCA9IG5ldyBQb2ludDJEKHAxLngsIHAxLnkpO1xyXG5cclxuICAgIC8vIENvbnZlcnQgbGluZSB0byBub3JtYWwgZm9ybTogYXggKyBieSArIGMgPSAwXHJcbiAgICAvLyBGaW5kIG5vcm1hbCB0byBsaW5lOiBuZWdhdGl2ZSBpbnZlcnNlIG9mIG9yaWdpbmFsIGxpbmUncyBzbG9wZVxyXG4gICAgbiA9IG5ldyBWZWN0b3IyRChhMS55IC0gYTIueSwgYTIueCAtIGExLngpO1xyXG5cclxuICAgIC8vIERldGVybWluZSBuZXcgYyBjb2VmZmljaWVudFxyXG4gICAgY2wgPSBhMS54KmEyLnkgLSBhMi54KmExLnk7XHJcblxyXG4gICAgLy8gVHJhbnNmb3JtIGN1YmljIGNvZWZmaWNpZW50cyB0byBsaW5lJ3MgY29vcmRpbmF0ZSBzeXN0ZW0gYW5kIGZpbmQgcm9vdHNcclxuICAgIC8vIG9mIGN1YmljXHJcbiAgICByb290cyA9IG5ldyBQb2x5bm9taWFsKFxyXG4gICAgICAgIG4uZG90KGMyKSxcclxuICAgICAgICBuLmRvdChjMSksXHJcbiAgICAgICAgbi5kb3QoYzApICsgY2xcclxuICAgICkuZ2V0Um9vdHMoKTtcclxuXHJcbiAgICAvLyBBbnkgcm9vdHMgaW4gY2xvc2VkIGludGVydmFsIFswLDFdIGFyZSBpbnRlcnNlY3Rpb25zIG9uIEJlemllciwgYnV0XHJcbiAgICAvLyBtaWdodCBub3QgYmUgb24gdGhlIGxpbmUgc2VnbWVudC5cclxuICAgIC8vIEZpbmQgaW50ZXJzZWN0aW9ucyBhbmQgY2FsY3VsYXRlIHBvaW50IGNvb3JkaW5hdGVzXHJcbiAgICBmb3IgKCB2YXIgaSA9IDA7IGkgPCByb290cy5sZW5ndGg7IGkrKyApIHtcclxuICAgICAgICB2YXIgdCA9IHJvb3RzW2ldO1xyXG5cclxuICAgICAgICBpZiAoIDAgPD0gdCAmJiB0IDw9IDEgKSB7XHJcbiAgICAgICAgICAgIC8vIFdlJ3JlIHdpdGhpbiB0aGUgQmV6aWVyIGN1cnZlXHJcbiAgICAgICAgICAgIC8vIEZpbmQgcG9pbnQgb24gQmV6aWVyXHJcbiAgICAgICAgICAgIHZhciBwNCA9IHAxLmxlcnAocDIsIHQpO1xyXG4gICAgICAgICAgICB2YXIgcDUgPSBwMi5sZXJwKHAzLCB0KTtcclxuXHJcbiAgICAgICAgICAgIHZhciBwNiA9IHA0LmxlcnAocDUsIHQpO1xyXG5cclxuICAgICAgICAgICAgLy8gU2VlIGlmIHBvaW50IGlzIG9uIGxpbmUgc2VnbWVudFxyXG4gICAgICAgICAgICAvLyBIYWQgdG8gbWFrZSBzcGVjaWFsIGNhc2VzIGZvciB2ZXJ0aWNhbCBhbmQgaG9yaXpvbnRhbCBsaW5lcyBkdWVcclxuICAgICAgICAgICAgLy8gdG8gc2xpZ2h0IGVycm9ycyBpbiBjYWxjdWxhdGlvbiBvZiBwNlxyXG4gICAgICAgICAgICBpZiAoIGExLnggPT0gYTIueCApIHtcclxuICAgICAgICAgICAgICAgIGlmICggbWluLnkgPD0gcDYueSAmJiBwNi55IDw9IG1heC55ICkge1xyXG4gICAgICAgICAgICAgICAgICAgIHJlc3VsdC5zdGF0dXMgPSBcIkludGVyc2VjdGlvblwiO1xyXG4gICAgICAgICAgICAgICAgICAgIHJlc3VsdC5hcHBlbmRQb2ludCggcDYgKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSBlbHNlIGlmICggYTEueSA9PSBhMi55ICkge1xyXG4gICAgICAgICAgICAgICAgaWYgKCBtaW4ueCA8PSBwNi54ICYmIHA2LnggPD0gbWF4LnggKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgcmVzdWx0LnN0YXR1cyA9IFwiSW50ZXJzZWN0aW9uXCI7XHJcbiAgICAgICAgICAgICAgICAgICAgcmVzdWx0LmFwcGVuZFBvaW50KCBwNiApO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9IGVsc2UgaWYgKG1pbi54IDw9IHA2LnggJiYgcDYueCA8PSBtYXgueCAmJiBtaW4ueSA8PSBwNi55ICYmIHA2LnkgPD0gbWF4LnkpIHtcclxuICAgICAgICAgICAgICAgIHJlc3VsdC5zdGF0dXMgPSBcIkludGVyc2VjdGlvblwiO1xyXG4gICAgICAgICAgICAgICAgcmVzdWx0LmFwcGVuZFBvaW50KCBwNiApO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiByZXN1bHQ7XHJcbn07XHJcblxyXG5cclxuLyoqXHJcbiAqICBpbnRlcnNlY3RCZXppZXIyUG9seWdvblxyXG4gKlxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBwMVxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBwMlxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBwM1xyXG4gKiAgQHBhcmFtIHtBcnJheTxQb2ludDJEPn0gcG9pbnRzXHJcbiAqICBAcmV0dXJucyB7SW50ZXJzZWN0aW9ufVxyXG4gKi9cclxuSW50ZXJzZWN0aW9uLmludGVyc2VjdEJlemllcjJQb2x5Z29uID0gZnVuY3Rpb24ocDEsIHAyLCBwMywgcG9pbnRzKSB7XHJcbiAgICB2YXIgcmVzdWx0ID0gbmV3IEludGVyc2VjdGlvbihcIk5vIEludGVyc2VjdGlvblwiKTtcclxuICAgIHZhciBsZW5ndGggPSBwb2ludHMubGVuZ3RoO1xyXG5cclxuICAgIGZvciAoIHZhciBpID0gMDsgaSA8IGxlbmd0aDsgaSsrICkge1xyXG4gICAgICAgIHZhciBhMSA9IHBvaW50c1tpXTtcclxuICAgICAgICB2YXIgYTIgPSBwb2ludHNbKGkrMSkgJSBsZW5ndGhdO1xyXG4gICAgICAgIHZhciBpbnRlciA9IEludGVyc2VjdGlvbi5pbnRlcnNlY3RCZXppZXIyTGluZShwMSwgcDIsIHAzLCBhMSwgYTIpO1xyXG5cclxuICAgICAgICByZXN1bHQuYXBwZW5kUG9pbnRzKGludGVyLnBvaW50cyk7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKCByZXN1bHQucG9pbnRzLmxlbmd0aCA+IDAgKSByZXN1bHQuc3RhdHVzID0gXCJJbnRlcnNlY3Rpb25cIjtcclxuXHJcbiAgICByZXR1cm4gcmVzdWx0O1xyXG59O1xyXG5cclxuXHJcbi8qKlxyXG4gKiAgaW50ZXJzZWN0QmV6aWVyMlJlY3RhbmdsZVxyXG4gKlxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBwMVxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBwMlxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBwM1xyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSByMVxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSByMlxyXG4gKiAgQHJldHVybnMge0ludGVyc2VjdGlvbn1cclxuICovXHJcbkludGVyc2VjdGlvbi5pbnRlcnNlY3RCZXppZXIyUmVjdGFuZ2xlID0gZnVuY3Rpb24ocDEsIHAyLCBwMywgcjEsIHIyKSB7XHJcbiAgICB2YXIgbWluICAgICAgICA9IHIxLm1pbihyMik7XHJcbiAgICB2YXIgbWF4ICAgICAgICA9IHIxLm1heChyMik7XHJcbiAgICB2YXIgdG9wUmlnaHQgICA9IG5ldyBQb2ludDJEKCBtYXgueCwgbWluLnkgKTtcclxuICAgIHZhciBib3R0b21MZWZ0ID0gbmV3IFBvaW50MkQoIG1pbi54LCBtYXgueSApO1xyXG5cclxuICAgIHZhciBpbnRlcjEgPSBJbnRlcnNlY3Rpb24uaW50ZXJzZWN0QmV6aWVyMkxpbmUocDEsIHAyLCBwMywgbWluLCB0b3BSaWdodCk7XHJcbiAgICB2YXIgaW50ZXIyID0gSW50ZXJzZWN0aW9uLmludGVyc2VjdEJlemllcjJMaW5lKHAxLCBwMiwgcDMsIHRvcFJpZ2h0LCBtYXgpO1xyXG4gICAgdmFyIGludGVyMyA9IEludGVyc2VjdGlvbi5pbnRlcnNlY3RCZXppZXIyTGluZShwMSwgcDIsIHAzLCBtYXgsIGJvdHRvbUxlZnQpO1xyXG4gICAgdmFyIGludGVyNCA9IEludGVyc2VjdGlvbi5pbnRlcnNlY3RCZXppZXIyTGluZShwMSwgcDIsIHAzLCBib3R0b21MZWZ0LCBtaW4pO1xyXG5cclxuICAgIHZhciByZXN1bHQgPSBuZXcgSW50ZXJzZWN0aW9uKFwiTm8gSW50ZXJzZWN0aW9uXCIpO1xyXG5cclxuICAgIHJlc3VsdC5hcHBlbmRQb2ludHMoaW50ZXIxLnBvaW50cyk7XHJcbiAgICByZXN1bHQuYXBwZW5kUG9pbnRzKGludGVyMi5wb2ludHMpO1xyXG4gICAgcmVzdWx0LmFwcGVuZFBvaW50cyhpbnRlcjMucG9pbnRzKTtcclxuICAgIHJlc3VsdC5hcHBlbmRQb2ludHMoaW50ZXI0LnBvaW50cyk7XHJcblxyXG4gICAgaWYgKCByZXN1bHQucG9pbnRzLmxlbmd0aCA+IDAgKSByZXN1bHQuc3RhdHVzID0gXCJJbnRlcnNlY3Rpb25cIjtcclxuXHJcbiAgICByZXR1cm4gcmVzdWx0O1xyXG59O1xyXG5cclxuXHJcbi8qKlxyXG4gKiAgaW50ZXJzZWN0QmV6aWVyM0JlemllcjNcclxuICpcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gYTFcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gYTJcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gYTNcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gYTRcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gYjFcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gYjJcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gYjNcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gYjRcclxuICogIEByZXR1cm5zIHtJbnRlcnNlY3Rpb259XHJcbiAqL1xyXG5JbnRlcnNlY3Rpb24uaW50ZXJzZWN0QmV6aWVyM0JlemllcjMgPSBmdW5jdGlvbihhMSwgYTIsIGEzLCBhNCwgYjEsIGIyLCBiMywgYjQpIHtcclxuICAgIHZhciBhLCBiLCBjLCBkOyAgICAgICAgIC8vIHRlbXBvcmFyeSB2YXJpYWJsZXNcclxuICAgIHZhciBjMTMsIGMxMiwgYzExLCBjMTA7IC8vIGNvZWZmaWNpZW50cyBvZiBjdWJpY1xyXG4gICAgdmFyIGMyMywgYzIyLCBjMjEsIGMyMDsgLy8gY29lZmZpY2llbnRzIG9mIGN1YmljXHJcbiAgICB2YXIgcmVzdWx0ID0gbmV3IEludGVyc2VjdGlvbihcIk5vIEludGVyc2VjdGlvblwiKTtcclxuXHJcbiAgICAvLyBDYWxjdWxhdGUgdGhlIGNvZWZmaWNpZW50cyBvZiBjdWJpYyBwb2x5bm9taWFsXHJcbiAgICBhID0gYTEubXVsdGlwbHkoLTEpO1xyXG4gICAgYiA9IGEyLm11bHRpcGx5KDMpO1xyXG4gICAgYyA9IGEzLm11bHRpcGx5KC0zKTtcclxuICAgIGQgPSBhLmFkZChiLmFkZChjLmFkZChhNCkpKTtcclxuICAgIGMxMyA9IG5ldyBWZWN0b3IyRChkLngsIGQueSk7XHJcblxyXG4gICAgYSA9IGExLm11bHRpcGx5KDMpO1xyXG4gICAgYiA9IGEyLm11bHRpcGx5KC02KTtcclxuICAgIGMgPSBhMy5tdWx0aXBseSgzKTtcclxuICAgIGQgPSBhLmFkZChiLmFkZChjKSk7XHJcbiAgICBjMTIgPSBuZXcgVmVjdG9yMkQoZC54LCBkLnkpO1xyXG5cclxuICAgIGEgPSBhMS5tdWx0aXBseSgtMyk7XHJcbiAgICBiID0gYTIubXVsdGlwbHkoMyk7XHJcbiAgICBjID0gYS5hZGQoYik7XHJcbiAgICBjMTEgPSBuZXcgVmVjdG9yMkQoYy54LCBjLnkpO1xyXG5cclxuICAgIGMxMCA9IG5ldyBWZWN0b3IyRChhMS54LCBhMS55KTtcclxuXHJcbiAgICBhID0gYjEubXVsdGlwbHkoLTEpO1xyXG4gICAgYiA9IGIyLm11bHRpcGx5KDMpO1xyXG4gICAgYyA9IGIzLm11bHRpcGx5KC0zKTtcclxuICAgIGQgPSBhLmFkZChiLmFkZChjLmFkZChiNCkpKTtcclxuICAgIGMyMyA9IG5ldyBWZWN0b3IyRChkLngsIGQueSk7XHJcblxyXG4gICAgYSA9IGIxLm11bHRpcGx5KDMpO1xyXG4gICAgYiA9IGIyLm11bHRpcGx5KC02KTtcclxuICAgIGMgPSBiMy5tdWx0aXBseSgzKTtcclxuICAgIGQgPSBhLmFkZChiLmFkZChjKSk7XHJcbiAgICBjMjIgPSBuZXcgVmVjdG9yMkQoZC54LCBkLnkpO1xyXG5cclxuICAgIGEgPSBiMS5tdWx0aXBseSgtMyk7XHJcbiAgICBiID0gYjIubXVsdGlwbHkoMyk7XHJcbiAgICBjID0gYS5hZGQoYik7XHJcbiAgICBjMjEgPSBuZXcgVmVjdG9yMkQoYy54LCBjLnkpO1xyXG5cclxuICAgIGMyMCA9IG5ldyBWZWN0b3IyRChiMS54LCBiMS55KTtcclxuXHJcbiAgICB2YXIgYzEweDIgPSBjMTAueCpjMTAueDtcclxuICAgIHZhciBjMTB4MyA9IGMxMC54KmMxMC54KmMxMC54O1xyXG4gICAgdmFyIGMxMHkyID0gYzEwLnkqYzEwLnk7XHJcbiAgICB2YXIgYzEweTMgPSBjMTAueSpjMTAueSpjMTAueTtcclxuICAgIHZhciBjMTF4MiA9IGMxMS54KmMxMS54O1xyXG4gICAgdmFyIGMxMXgzID0gYzExLngqYzExLngqYzExLng7XHJcbiAgICB2YXIgYzExeTIgPSBjMTEueSpjMTEueTtcclxuICAgIHZhciBjMTF5MyA9IGMxMS55KmMxMS55KmMxMS55O1xyXG4gICAgdmFyIGMxMngyID0gYzEyLngqYzEyLng7XHJcbiAgICB2YXIgYzEyeDMgPSBjMTIueCpjMTIueCpjMTIueDtcclxuICAgIHZhciBjMTJ5MiA9IGMxMi55KmMxMi55O1xyXG4gICAgdmFyIGMxMnkzID0gYzEyLnkqYzEyLnkqYzEyLnk7XHJcbiAgICB2YXIgYzEzeDIgPSBjMTMueCpjMTMueDtcclxuICAgIHZhciBjMTN4MyA9IGMxMy54KmMxMy54KmMxMy54O1xyXG4gICAgdmFyIGMxM3kyID0gYzEzLnkqYzEzLnk7XHJcbiAgICB2YXIgYzEzeTMgPSBjMTMueSpjMTMueSpjMTMueTtcclxuICAgIHZhciBjMjB4MiA9IGMyMC54KmMyMC54O1xyXG4gICAgdmFyIGMyMHgzID0gYzIwLngqYzIwLngqYzIwLng7XHJcbiAgICB2YXIgYzIweTIgPSBjMjAueSpjMjAueTtcclxuICAgIHZhciBjMjB5MyA9IGMyMC55KmMyMC55KmMyMC55O1xyXG4gICAgdmFyIGMyMXgyID0gYzIxLngqYzIxLng7XHJcbiAgICB2YXIgYzIxeDMgPSBjMjEueCpjMjEueCpjMjEueDtcclxuICAgIHZhciBjMjF5MiA9IGMyMS55KmMyMS55O1xyXG4gICAgdmFyIGMyMngyID0gYzIyLngqYzIyLng7XHJcbiAgICB2YXIgYzIyeDMgPSBjMjIueCpjMjIueCpjMjIueDtcclxuICAgIHZhciBjMjJ5MiA9IGMyMi55KmMyMi55O1xyXG4gICAgdmFyIGMyM3gyID0gYzIzLngqYzIzLng7XHJcbiAgICB2YXIgYzIzeDMgPSBjMjMueCpjMjMueCpjMjMueDtcclxuICAgIHZhciBjMjN5MiA9IGMyMy55KmMyMy55O1xyXG4gICAgdmFyIGMyM3kzID0gYzIzLnkqYzIzLnkqYzIzLnk7XHJcbiAgICB2YXIgcG9seSA9IG5ldyBQb2x5bm9taWFsKFxyXG4gICAgICAgIC1jMTN4MypjMjN5MyArIGMxM3kzKmMyM3gzIC0gMypjMTMueCpjMTN5MipjMjN4MipjMjMueSArXHJcbiAgICAgICAgICAgIDMqYzEzeDIqYzEzLnkqYzIzLngqYzIzeTIsXHJcbiAgICAgICAgLTYqYzEzLngqYzIyLngqYzEzeTIqYzIzLngqYzIzLnkgKyA2KmMxM3gyKmMxMy55KmMyMi55KmMyMy54KmMyMy55ICsgMypjMjIueCpjMTN5MypjMjN4MiAtXHJcbiAgICAgICAgICAgIDMqYzEzeDMqYzIyLnkqYzIzeTIgLSAzKmMxMy54KmMxM3kyKmMyMi55KmMyM3gyICsgMypjMTN4MipjMjIueCpjMTMueSpjMjN5MixcclxuICAgICAgICAtNipjMjEueCpjMTMueCpjMTN5MipjMjMueCpjMjMueSAtIDYqYzEzLngqYzIyLngqYzEzeTIqYzIyLnkqYzIzLnggKyA2KmMxM3gyKmMyMi54KmMxMy55KmMyMi55KmMyMy55ICtcclxuICAgICAgICAgICAgMypjMjEueCpjMTN5MypjMjN4MiArIDMqYzIyeDIqYzEzeTMqYzIzLnggKyAzKmMyMS54KmMxM3gyKmMxMy55KmMyM3kyIC0gMypjMTMueCpjMjEueSpjMTN5MipjMjN4MiAtXHJcbiAgICAgICAgICAgIDMqYzEzLngqYzIyeDIqYzEzeTIqYzIzLnkgKyBjMTN4MipjMTMueSpjMjMueCooNipjMjEueSpjMjMueSArIDMqYzIyeTIpICsgYzEzeDMqKC1jMjEueSpjMjN5MiAtXHJcbiAgICAgICAgICAgIDIqYzIyeTIqYzIzLnkgLSBjMjMueSooMipjMjEueSpjMjMueSArIGMyMnkyKSksXHJcbiAgICAgICAgYzExLngqYzEyLnkqYzEzLngqYzEzLnkqYzIzLngqYzIzLnkgLSBjMTEueSpjMTIueCpjMTMueCpjMTMueSpjMjMueCpjMjMueSArIDYqYzIxLngqYzIyLngqYzEzeTMqYzIzLnggK1xyXG4gICAgICAgICAgICAzKmMxMS54KmMxMi54KmMxMy54KmMxMy55KmMyM3kyICsgNipjMTAueCpjMTMueCpjMTN5MipjMjMueCpjMjMueSAtIDMqYzExLngqYzEyLngqYzEzeTIqYzIzLngqYzIzLnkgLVxyXG4gICAgICAgICAgICAzKmMxMS55KmMxMi55KmMxMy54KmMxMy55KmMyM3gyIC0gNipjMTAueSpjMTN4MipjMTMueSpjMjMueCpjMjMueSAtIDYqYzIwLngqYzEzLngqYzEzeTIqYzIzLngqYzIzLnkgK1xyXG4gICAgICAgICAgICAzKmMxMS55KmMxMi55KmMxM3gyKmMyMy54KmMyMy55IC0gMipjMTIueCpjMTJ5MipjMTMueCpjMjMueCpjMjMueSAtIDYqYzIxLngqYzEzLngqYzIyLngqYzEzeTIqYzIzLnkgLVxyXG4gICAgICAgICAgICA2KmMyMS54KmMxMy54KmMxM3kyKmMyMi55KmMyMy54IC0gNipjMTMueCpjMjEueSpjMjIueCpjMTN5MipjMjMueCArIDYqYzIxLngqYzEzeDIqYzEzLnkqYzIyLnkqYzIzLnkgK1xyXG4gICAgICAgICAgICAyKmMxMngyKmMxMi55KmMxMy55KmMyMy54KmMyMy55ICsgYzIyeDMqYzEzeTMgLSAzKmMxMC54KmMxM3kzKmMyM3gyICsgMypjMTAueSpjMTN4MypjMjN5MiArXHJcbiAgICAgICAgICAgIDMqYzIwLngqYzEzeTMqYzIzeDIgKyBjMTJ5MypjMTMueCpjMjN4MiAtIGMxMngzKmMxMy55KmMyM3kyIC0gMypjMTAueCpjMTN4MipjMTMueSpjMjN5MiArXHJcbiAgICAgICAgICAgIDMqYzEwLnkqYzEzLngqYzEzeTIqYzIzeDIgLSAyKmMxMS54KmMxMi55KmMxM3gyKmMyM3kyICsgYzExLngqYzEyLnkqYzEzeTIqYzIzeDIgLSBjMTEueSpjMTIueCpjMTN4MipjMjN5MiArXHJcbiAgICAgICAgICAgIDIqYzExLnkqYzEyLngqYzEzeTIqYzIzeDIgKyAzKmMyMC54KmMxM3gyKmMxMy55KmMyM3kyIC0gYzEyLngqYzEyeTIqYzEzLnkqYzIzeDIgLVxyXG4gICAgICAgICAgICAzKmMyMC55KmMxMy54KmMxM3kyKmMyM3gyICsgYzEyeDIqYzEyLnkqYzEzLngqYzIzeTIgLSAzKmMxMy54KmMyMngyKmMxM3kyKmMyMi55ICtcclxuICAgICAgICAgICAgYzEzeDIqYzEzLnkqYzIzLngqKDYqYzIwLnkqYzIzLnkgKyA2KmMyMS55KmMyMi55KSArIGMxM3gyKmMyMi54KmMxMy55Kig2KmMyMS55KmMyMy55ICsgMypjMjJ5MikgK1xyXG4gICAgICAgICAgICBjMTN4MyooLTIqYzIxLnkqYzIyLnkqYzIzLnkgLSBjMjAueSpjMjN5MiAtIGMyMi55KigyKmMyMS55KmMyMy55ICsgYzIyeTIpIC0gYzIzLnkqKDIqYzIwLnkqYzIzLnkgKyAyKmMyMS55KmMyMi55KSksXHJcbiAgICAgICAgNipjMTEueCpjMTIueCpjMTMueCpjMTMueSpjMjIueSpjMjMueSArIGMxMS54KmMxMi55KmMxMy54KmMyMi54KmMxMy55KmMyMy55ICsgYzExLngqYzEyLnkqYzEzLngqYzEzLnkqYzIyLnkqYzIzLnggLVxyXG4gICAgICAgICAgICBjMTEueSpjMTIueCpjMTMueCpjMjIueCpjMTMueSpjMjMueSAtIGMxMS55KmMxMi54KmMxMy54KmMxMy55KmMyMi55KmMyMy54IC0gNipjMTEueSpjMTIueSpjMTMueCpjMjIueCpjMTMueSpjMjMueCAtXHJcbiAgICAgICAgICAgIDYqYzEwLngqYzIyLngqYzEzeTMqYzIzLnggKyA2KmMyMC54KmMyMi54KmMxM3kzKmMyMy54ICsgNipjMTAueSpjMTN4MypjMjIueSpjMjMueSArIDIqYzEyeTMqYzEzLngqYzIyLngqYzIzLnggLVxyXG4gICAgICAgICAgICAyKmMxMngzKmMxMy55KmMyMi55KmMyMy55ICsgNipjMTAueCpjMTMueCpjMjIueCpjMTN5MipjMjMueSArIDYqYzEwLngqYzEzLngqYzEzeTIqYzIyLnkqYzIzLnggK1xyXG4gICAgICAgICAgICA2KmMxMC55KmMxMy54KmMyMi54KmMxM3kyKmMyMy54IC0gMypjMTEueCpjMTIueCpjMjIueCpjMTN5MipjMjMueSAtIDMqYzExLngqYzEyLngqYzEzeTIqYzIyLnkqYzIzLnggK1xyXG4gICAgICAgICAgICAyKmMxMS54KmMxMi55KmMyMi54KmMxM3kyKmMyMy54ICsgNCpjMTEueSpjMTIueCpjMjIueCpjMTN5MipjMjMueCAtIDYqYzEwLngqYzEzeDIqYzEzLnkqYzIyLnkqYzIzLnkgLVxyXG4gICAgICAgICAgICA2KmMxMC55KmMxM3gyKmMyMi54KmMxMy55KmMyMy55IC0gNipjMTAueSpjMTN4MipjMTMueSpjMjIueSpjMjMueCAtIDQqYzExLngqYzEyLnkqYzEzeDIqYzIyLnkqYzIzLnkgLVxyXG4gICAgICAgICAgICA2KmMyMC54KmMxMy54KmMyMi54KmMxM3kyKmMyMy55IC0gNipjMjAueCpjMTMueCpjMTN5MipjMjIueSpjMjMueCAtIDIqYzExLnkqYzEyLngqYzEzeDIqYzIyLnkqYzIzLnkgK1xyXG4gICAgICAgICAgICAzKmMxMS55KmMxMi55KmMxM3gyKmMyMi54KmMyMy55ICsgMypjMTEueSpjMTIueSpjMTN4MipjMjIueSpjMjMueCAtIDIqYzEyLngqYzEyeTIqYzEzLngqYzIyLngqYzIzLnkgLVxyXG4gICAgICAgICAgICAyKmMxMi54KmMxMnkyKmMxMy54KmMyMi55KmMyMy54IC0gMipjMTIueCpjMTJ5MipjMjIueCpjMTMueSpjMjMueCAtIDYqYzIwLnkqYzEzLngqYzIyLngqYzEzeTIqYzIzLnggLVxyXG4gICAgICAgICAgICA2KmMyMS54KmMxMy54KmMyMS55KmMxM3kyKmMyMy54IC0gNipjMjEueCpjMTMueCpjMjIueCpjMTN5MipjMjIueSArIDYqYzIwLngqYzEzeDIqYzEzLnkqYzIyLnkqYzIzLnkgK1xyXG4gICAgICAgICAgICAyKmMxMngyKmMxMi55KmMxMy54KmMyMi55KmMyMy55ICsgMipjMTJ4MipjMTIueSpjMjIueCpjMTMueSpjMjMueSArIDIqYzEyeDIqYzEyLnkqYzEzLnkqYzIyLnkqYzIzLnggK1xyXG4gICAgICAgICAgICAzKmMyMS54KmMyMngyKmMxM3kzICsgMypjMjF4MipjMTN5MypjMjMueCAtIDMqYzEzLngqYzIxLnkqYzIyeDIqYzEzeTIgLSAzKmMyMXgyKmMxMy54KmMxM3kyKmMyMy55ICtcclxuICAgICAgICAgICAgYzEzeDIqYzIyLngqYzEzLnkqKDYqYzIwLnkqYzIzLnkgKyA2KmMyMS55KmMyMi55KSArIGMxM3gyKmMxMy55KmMyMy54Kig2KmMyMC55KmMyMi55ICsgMypjMjF5MikgK1xyXG4gICAgICAgICAgICBjMjEueCpjMTN4MipjMTMueSooNipjMjEueSpjMjMueSArIDMqYzIyeTIpICsgYzEzeDMqKC0yKmMyMC55KmMyMi55KmMyMy55IC0gYzIzLnkqKDIqYzIwLnkqYzIyLnkgKyBjMjF5MikgLVxyXG4gICAgICAgICAgICBjMjEueSooMipjMjEueSpjMjMueSArIGMyMnkyKSAtIGMyMi55KigyKmMyMC55KmMyMy55ICsgMipjMjEueSpjMjIueSkpLFxyXG4gICAgICAgIGMxMS54KmMyMS54KmMxMi55KmMxMy54KmMxMy55KmMyMy55ICsgYzExLngqYzEyLnkqYzEzLngqYzIxLnkqYzEzLnkqYzIzLnggKyBjMTEueCpjMTIueSpjMTMueCpjMjIueCpjMTMueSpjMjIueSAtXHJcbiAgICAgICAgICAgIGMxMS55KmMxMi54KmMyMS54KmMxMy54KmMxMy55KmMyMy55IC0gYzExLnkqYzEyLngqYzEzLngqYzIxLnkqYzEzLnkqYzIzLnggLSBjMTEueSpjMTIueCpjMTMueCpjMjIueCpjMTMueSpjMjIueSAtXHJcbiAgICAgICAgICAgIDYqYzExLnkqYzIxLngqYzEyLnkqYzEzLngqYzEzLnkqYzIzLnggLSA2KmMxMC54KmMyMS54KmMxM3kzKmMyMy54ICsgNipjMjAueCpjMjEueCpjMTN5MypjMjMueCArXHJcbiAgICAgICAgICAgIDIqYzIxLngqYzEyeTMqYzEzLngqYzIzLnggKyA2KmMxMC54KmMyMS54KmMxMy54KmMxM3kyKmMyMy55ICsgNipjMTAueCpjMTMueCpjMjEueSpjMTN5MipjMjMueCArXHJcbiAgICAgICAgICAgIDYqYzEwLngqYzEzLngqYzIyLngqYzEzeTIqYzIyLnkgKyA2KmMxMC55KmMyMS54KmMxMy54KmMxM3kyKmMyMy54IC0gMypjMTEueCpjMTIueCpjMjEueCpjMTN5MipjMjMueSAtXHJcbiAgICAgICAgICAgIDMqYzExLngqYzEyLngqYzIxLnkqYzEzeTIqYzIzLnggLSAzKmMxMS54KmMxMi54KmMyMi54KmMxM3kyKmMyMi55ICsgMipjMTEueCpjMjEueCpjMTIueSpjMTN5MipjMjMueCArXHJcbiAgICAgICAgICAgIDQqYzExLnkqYzEyLngqYzIxLngqYzEzeTIqYzIzLnggLSA2KmMxMC55KmMyMS54KmMxM3gyKmMxMy55KmMyMy55IC0gNipjMTAueSpjMTN4MipjMjEueSpjMTMueSpjMjMueCAtXHJcbiAgICAgICAgICAgIDYqYzEwLnkqYzEzeDIqYzIyLngqYzEzLnkqYzIyLnkgLSA2KmMyMC54KmMyMS54KmMxMy54KmMxM3kyKmMyMy55IC0gNipjMjAueCpjMTMueCpjMjEueSpjMTN5MipjMjMueCAtXHJcbiAgICAgICAgICAgIDYqYzIwLngqYzEzLngqYzIyLngqYzEzeTIqYzIyLnkgKyAzKmMxMS55KmMyMS54KmMxMi55KmMxM3gyKmMyMy55IC0gMypjMTEueSpjMTIueSpjMTMueCpjMjJ4MipjMTMueSArXHJcbiAgICAgICAgICAgIDMqYzExLnkqYzEyLnkqYzEzeDIqYzIxLnkqYzIzLnggKyAzKmMxMS55KmMxMi55KmMxM3gyKmMyMi54KmMyMi55IC0gMipjMTIueCpjMjEueCpjMTJ5MipjMTMueCpjMjMueSAtXHJcbiAgICAgICAgICAgIDIqYzEyLngqYzIxLngqYzEyeTIqYzEzLnkqYzIzLnggLSAyKmMxMi54KmMxMnkyKmMxMy54KmMyMS55KmMyMy54IC0gMipjMTIueCpjMTJ5MipjMTMueCpjMjIueCpjMjIueSAtXHJcbiAgICAgICAgICAgIDYqYzIwLnkqYzIxLngqYzEzLngqYzEzeTIqYzIzLnggLSA2KmMyMS54KmMxMy54KmMyMS55KmMyMi54KmMxM3kyICsgNipjMjAueSpjMTN4MipjMjEueSpjMTMueSpjMjMueCArXHJcbiAgICAgICAgICAgIDIqYzEyeDIqYzIxLngqYzEyLnkqYzEzLnkqYzIzLnkgKyAyKmMxMngyKmMxMi55KmMyMS55KmMxMy55KmMyMy54ICsgMipjMTJ4MipjMTIueSpjMjIueCpjMTMueSpjMjIueSAtXHJcbiAgICAgICAgICAgIDMqYzEwLngqYzIyeDIqYzEzeTMgKyAzKmMyMC54KmMyMngyKmMxM3kzICsgMypjMjF4MipjMjIueCpjMTN5MyArIGMxMnkzKmMxMy54KmMyMngyICtcclxuICAgICAgICAgICAgMypjMTAueSpjMTMueCpjMjJ4MipjMTN5MiArIGMxMS54KmMxMi55KmMyMngyKmMxM3kyICsgMipjMTEueSpjMTIueCpjMjJ4MipjMTN5MiAtXHJcbiAgICAgICAgICAgIGMxMi54KmMxMnkyKmMyMngyKmMxMy55IC0gMypjMjAueSpjMTMueCpjMjJ4MipjMTN5MiAtIDMqYzIxeDIqYzEzLngqYzEzeTIqYzIyLnkgK1xyXG4gICAgICAgICAgICBjMTJ4MipjMTIueSpjMTMueCooMipjMjEueSpjMjMueSArIGMyMnkyKSArIGMxMS54KmMxMi54KmMxMy54KmMxMy55Kig2KmMyMS55KmMyMy55ICsgMypjMjJ5MikgK1xyXG4gICAgICAgICAgICBjMjEueCpjMTN4MipjMTMueSooNipjMjAueSpjMjMueSArIDYqYzIxLnkqYzIyLnkpICsgYzEyeDMqYzEzLnkqKC0yKmMyMS55KmMyMy55IC0gYzIyeTIpICtcclxuICAgICAgICAgICAgYzEwLnkqYzEzeDMqKDYqYzIxLnkqYzIzLnkgKyAzKmMyMnkyKSArIGMxMS55KmMxMi54KmMxM3gyKigtMipjMjEueSpjMjMueSAtIGMyMnkyKSArXHJcbiAgICAgICAgICAgIGMxMS54KmMxMi55KmMxM3gyKigtNCpjMjEueSpjMjMueSAtIDIqYzIyeTIpICsgYzEwLngqYzEzeDIqYzEzLnkqKC02KmMyMS55KmMyMy55IC0gMypjMjJ5MikgK1xyXG4gICAgICAgICAgICBjMTN4MipjMjIueCpjMTMueSooNipjMjAueSpjMjIueSArIDMqYzIxeTIpICsgYzIwLngqYzEzeDIqYzEzLnkqKDYqYzIxLnkqYzIzLnkgKyAzKmMyMnkyKSArXHJcbiAgICAgICAgICAgIGMxM3gzKigtMipjMjAueSpjMjEueSpjMjMueSAtIGMyMi55KigyKmMyMC55KmMyMi55ICsgYzIxeTIpIC0gYzIwLnkqKDIqYzIxLnkqYzIzLnkgKyBjMjJ5MikgLVxyXG4gICAgICAgICAgICBjMjEueSooMipjMjAueSpjMjMueSArIDIqYzIxLnkqYzIyLnkpKSxcclxuICAgICAgICAtYzEwLngqYzExLngqYzEyLnkqYzEzLngqYzEzLnkqYzIzLnkgKyBjMTAueCpjMTEueSpjMTIueCpjMTMueCpjMTMueSpjMjMueSArIDYqYzEwLngqYzExLnkqYzEyLnkqYzEzLngqYzEzLnkqYzIzLnggLVxyXG4gICAgICAgICAgICA2KmMxMC55KmMxMS54KmMxMi54KmMxMy54KmMxMy55KmMyMy55IC0gYzEwLnkqYzExLngqYzEyLnkqYzEzLngqYzEzLnkqYzIzLnggKyBjMTAueSpjMTEueSpjMTIueCpjMTMueCpjMTMueSpjMjMueCArXHJcbiAgICAgICAgICAgIGMxMS54KmMxMS55KmMxMi54KmMxMi55KmMxMy54KmMyMy55IC0gYzExLngqYzExLnkqYzEyLngqYzEyLnkqYzEzLnkqYzIzLnggKyBjMTEueCpjMjAueCpjMTIueSpjMTMueCpjMTMueSpjMjMueSArXHJcbiAgICAgICAgICAgIGMxMS54KmMyMC55KmMxMi55KmMxMy54KmMxMy55KmMyMy54ICsgYzExLngqYzIxLngqYzEyLnkqYzEzLngqYzEzLnkqYzIyLnkgKyBjMTEueCpjMTIueSpjMTMueCpjMjEueSpjMjIueCpjMTMueSAtXHJcbiAgICAgICAgICAgIGMyMC54KmMxMS55KmMxMi54KmMxMy54KmMxMy55KmMyMy55IC0gNipjMjAueCpjMTEueSpjMTIueSpjMTMueCpjMTMueSpjMjMueCAtIGMxMS55KmMxMi54KmMyMC55KmMxMy54KmMxMy55KmMyMy54IC1cclxuICAgICAgICAgICAgYzExLnkqYzEyLngqYzIxLngqYzEzLngqYzEzLnkqYzIyLnkgLSBjMTEueSpjMTIueCpjMTMueCpjMjEueSpjMjIueCpjMTMueSAtIDYqYzExLnkqYzIxLngqYzEyLnkqYzEzLngqYzIyLngqYzEzLnkgLVxyXG4gICAgICAgICAgICA2KmMxMC54KmMyMC54KmMxM3kzKmMyMy54IC0gNipjMTAueCpjMjEueCpjMjIueCpjMTN5MyAtIDIqYzEwLngqYzEyeTMqYzEzLngqYzIzLnggKyA2KmMyMC54KmMyMS54KmMyMi54KmMxM3kzICtcclxuICAgICAgICAgICAgMipjMjAueCpjMTJ5MypjMTMueCpjMjMueCArIDIqYzIxLngqYzEyeTMqYzEzLngqYzIyLnggKyAyKmMxMC55KmMxMngzKmMxMy55KmMyMy55IC0gNipjMTAueCpjMTAueSpjMTMueCpjMTN5MipjMjMueCArXHJcbiAgICAgICAgICAgIDMqYzEwLngqYzExLngqYzEyLngqYzEzeTIqYzIzLnkgLSAyKmMxMC54KmMxMS54KmMxMi55KmMxM3kyKmMyMy54IC0gNCpjMTAueCpjMTEueSpjMTIueCpjMTN5MipjMjMueCArXHJcbiAgICAgICAgICAgIDMqYzEwLnkqYzExLngqYzEyLngqYzEzeTIqYzIzLnggKyA2KmMxMC54KmMxMC55KmMxM3gyKmMxMy55KmMyMy55ICsgNipjMTAueCpjMjAueCpjMTMueCpjMTN5MipjMjMueSAtXHJcbiAgICAgICAgICAgIDMqYzEwLngqYzExLnkqYzEyLnkqYzEzeDIqYzIzLnkgKyAyKmMxMC54KmMxMi54KmMxMnkyKmMxMy54KmMyMy55ICsgMipjMTAueCpjMTIueCpjMTJ5MipjMTMueSpjMjMueCArXHJcbiAgICAgICAgICAgIDYqYzEwLngqYzIwLnkqYzEzLngqYzEzeTIqYzIzLnggKyA2KmMxMC54KmMyMS54KmMxMy54KmMxM3kyKmMyMi55ICsgNipjMTAueCpjMTMueCpjMjEueSpjMjIueCpjMTN5MiArXHJcbiAgICAgICAgICAgIDQqYzEwLnkqYzExLngqYzEyLnkqYzEzeDIqYzIzLnkgKyA2KmMxMC55KmMyMC54KmMxMy54KmMxM3kyKmMyMy54ICsgMipjMTAueSpjMTEueSpjMTIueCpjMTN4MipjMjMueSAtXHJcbiAgICAgICAgICAgIDMqYzEwLnkqYzExLnkqYzEyLnkqYzEzeDIqYzIzLnggKyAyKmMxMC55KmMxMi54KmMxMnkyKmMxMy54KmMyMy54ICsgNipjMTAueSpjMjEueCpjMTMueCpjMjIueCpjMTN5MiAtXHJcbiAgICAgICAgICAgIDMqYzExLngqYzIwLngqYzEyLngqYzEzeTIqYzIzLnkgKyAyKmMxMS54KmMyMC54KmMxMi55KmMxM3kyKmMyMy54ICsgYzExLngqYzExLnkqYzEyeTIqYzEzLngqYzIzLnggLVxyXG4gICAgICAgICAgICAzKmMxMS54KmMxMi54KmMyMC55KmMxM3kyKmMyMy54IC0gMypjMTEueCpjMTIueCpjMjEueCpjMTN5MipjMjIueSAtIDMqYzExLngqYzEyLngqYzIxLnkqYzIyLngqYzEzeTIgK1xyXG4gICAgICAgICAgICAyKmMxMS54KmMyMS54KmMxMi55KmMyMi54KmMxM3kyICsgNCpjMjAueCpjMTEueSpjMTIueCpjMTN5MipjMjMueCArIDQqYzExLnkqYzEyLngqYzIxLngqYzIyLngqYzEzeTIgLVxyXG4gICAgICAgICAgICAyKmMxMC54KmMxMngyKmMxMi55KmMxMy55KmMyMy55IC0gNipjMTAueSpjMjAueCpjMTN4MipjMTMueSpjMjMueSAtIDYqYzEwLnkqYzIwLnkqYzEzeDIqYzEzLnkqYzIzLnggLVxyXG4gICAgICAgICAgICA2KmMxMC55KmMyMS54KmMxM3gyKmMxMy55KmMyMi55IC0gMipjMTAueSpjMTJ4MipjMTIueSpjMTMueCpjMjMueSAtIDIqYzEwLnkqYzEyeDIqYzEyLnkqYzEzLnkqYzIzLnggLVxyXG4gICAgICAgICAgICA2KmMxMC55KmMxM3gyKmMyMS55KmMyMi54KmMxMy55IC0gYzExLngqYzExLnkqYzEyeDIqYzEzLnkqYzIzLnkgLSAyKmMxMS54KmMxMXkyKmMxMy54KmMxMy55KmMyMy54ICtcclxuICAgICAgICAgICAgMypjMjAueCpjMTEueSpjMTIueSpjMTN4MipjMjMueSAtIDIqYzIwLngqYzEyLngqYzEyeTIqYzEzLngqYzIzLnkgLSAyKmMyMC54KmMxMi54KmMxMnkyKmMxMy55KmMyMy54IC1cclxuICAgICAgICAgICAgNipjMjAueCpjMjAueSpjMTMueCpjMTN5MipjMjMueCAtIDYqYzIwLngqYzIxLngqYzEzLngqYzEzeTIqYzIyLnkgLSA2KmMyMC54KmMxMy54KmMyMS55KmMyMi54KmMxM3kyICtcclxuICAgICAgICAgICAgMypjMTEueSpjMjAueSpjMTIueSpjMTN4MipjMjMueCArIDMqYzExLnkqYzIxLngqYzEyLnkqYzEzeDIqYzIyLnkgKyAzKmMxMS55KmMxMi55KmMxM3gyKmMyMS55KmMyMi54IC1cclxuICAgICAgICAgICAgMipjMTIueCpjMjAueSpjMTJ5MipjMTMueCpjMjMueCAtIDIqYzEyLngqYzIxLngqYzEyeTIqYzEzLngqYzIyLnkgLSAyKmMxMi54KmMyMS54KmMxMnkyKmMyMi54KmMxMy55IC1cclxuICAgICAgICAgICAgMipjMTIueCpjMTJ5MipjMTMueCpjMjEueSpjMjIueCAtIDYqYzIwLnkqYzIxLngqYzEzLngqYzIyLngqYzEzeTIgLSBjMTF5MipjMTIueCpjMTIueSpjMTMueCpjMjMueCArXHJcbiAgICAgICAgICAgIDIqYzIwLngqYzEyeDIqYzEyLnkqYzEzLnkqYzIzLnkgKyA2KmMyMC55KmMxM3gyKmMyMS55KmMyMi54KmMxMy55ICsgMipjMTF4MipjMTEueSpjMTMueCpjMTMueSpjMjMueSArXHJcbiAgICAgICAgICAgIGMxMXgyKmMxMi54KmMxMi55KmMxMy55KmMyMy55ICsgMipjMTJ4MipjMjAueSpjMTIueSpjMTMueSpjMjMueCArIDIqYzEyeDIqYzIxLngqYzEyLnkqYzEzLnkqYzIyLnkgK1xyXG4gICAgICAgICAgICAyKmMxMngyKmMxMi55KmMyMS55KmMyMi54KmMxMy55ICsgYzIxeDMqYzEzeTMgKyAzKmMxMHgyKmMxM3kzKmMyMy54IC0gMypjMTB5MipjMTN4MypjMjMueSArXHJcbiAgICAgICAgICAgIDMqYzIweDIqYzEzeTMqYzIzLnggKyBjMTF5MypjMTN4MipjMjMueCAtIGMxMXgzKmMxM3kyKmMyMy55IC0gYzExLngqYzExeTIqYzEzeDIqYzIzLnkgK1xyXG4gICAgICAgICAgICBjMTF4MipjMTEueSpjMTN5MipjMjMueCAtIDMqYzEweDIqYzEzLngqYzEzeTIqYzIzLnkgKyAzKmMxMHkyKmMxM3gyKmMxMy55KmMyMy54IC0gYzExeDIqYzEyeTIqYzEzLngqYzIzLnkgK1xyXG4gICAgICAgICAgICBjMTF5MipjMTJ4MipjMTMueSpjMjMueCAtIDMqYzIxeDIqYzEzLngqYzIxLnkqYzEzeTIgLSAzKmMyMHgyKmMxMy54KmMxM3kyKmMyMy55ICsgMypjMjB5MipjMTN4MipjMTMueSpjMjMueCArXHJcbiAgICAgICAgICAgIGMxMS54KmMxMi54KmMxMy54KmMxMy55Kig2KmMyMC55KmMyMy55ICsgNipjMjEueSpjMjIueSkgKyBjMTJ4MypjMTMueSooLTIqYzIwLnkqYzIzLnkgLSAyKmMyMS55KmMyMi55KSArXHJcbiAgICAgICAgICAgIGMxMC55KmMxM3gzKig2KmMyMC55KmMyMy55ICsgNipjMjEueSpjMjIueSkgKyBjMTEueSpjMTIueCpjMTN4MiooLTIqYzIwLnkqYzIzLnkgLSAyKmMyMS55KmMyMi55KSArXHJcbiAgICAgICAgICAgIGMxMngyKmMxMi55KmMxMy54KigyKmMyMC55KmMyMy55ICsgMipjMjEueSpjMjIueSkgKyBjMTEueCpjMTIueSpjMTN4MiooLTQqYzIwLnkqYzIzLnkgLSA0KmMyMS55KmMyMi55KSArXHJcbiAgICAgICAgICAgIGMxMC54KmMxM3gyKmMxMy55KigtNipjMjAueSpjMjMueSAtIDYqYzIxLnkqYzIyLnkpICsgYzIwLngqYzEzeDIqYzEzLnkqKDYqYzIwLnkqYzIzLnkgKyA2KmMyMS55KmMyMi55KSArXHJcbiAgICAgICAgICAgIGMyMS54KmMxM3gyKmMxMy55Kig2KmMyMC55KmMyMi55ICsgMypjMjF5MikgKyBjMTN4MyooLTIqYzIwLnkqYzIxLnkqYzIyLnkgLSBjMjB5MipjMjMueSAtXHJcbiAgICAgICAgICAgIGMyMS55KigyKmMyMC55KmMyMi55ICsgYzIxeTIpIC0gYzIwLnkqKDIqYzIwLnkqYzIzLnkgKyAyKmMyMS55KmMyMi55KSksXHJcbiAgICAgICAgLWMxMC54KmMxMS54KmMxMi55KmMxMy54KmMxMy55KmMyMi55ICsgYzEwLngqYzExLnkqYzEyLngqYzEzLngqYzEzLnkqYzIyLnkgKyA2KmMxMC54KmMxMS55KmMxMi55KmMxMy54KmMyMi54KmMxMy55IC1cclxuICAgICAgICAgICAgNipjMTAueSpjMTEueCpjMTIueCpjMTMueCpjMTMueSpjMjIueSAtIGMxMC55KmMxMS54KmMxMi55KmMxMy54KmMyMi54KmMxMy55ICsgYzEwLnkqYzExLnkqYzEyLngqYzEzLngqYzIyLngqYzEzLnkgK1xyXG4gICAgICAgICAgICBjMTEueCpjMTEueSpjMTIueCpjMTIueSpjMTMueCpjMjIueSAtIGMxMS54KmMxMS55KmMxMi54KmMxMi55KmMyMi54KmMxMy55ICsgYzExLngqYzIwLngqYzEyLnkqYzEzLngqYzEzLnkqYzIyLnkgK1xyXG4gICAgICAgICAgICBjMTEueCpjMjAueSpjMTIueSpjMTMueCpjMjIueCpjMTMueSArIGMxMS54KmMyMS54KmMxMi55KmMxMy54KmMyMS55KmMxMy55IC0gYzIwLngqYzExLnkqYzEyLngqYzEzLngqYzEzLnkqYzIyLnkgLVxyXG4gICAgICAgICAgICA2KmMyMC54KmMxMS55KmMxMi55KmMxMy54KmMyMi54KmMxMy55IC0gYzExLnkqYzEyLngqYzIwLnkqYzEzLngqYzIyLngqYzEzLnkgLSBjMTEueSpjMTIueCpjMjEueCpjMTMueCpjMjEueSpjMTMueSAtXHJcbiAgICAgICAgICAgIDYqYzEwLngqYzIwLngqYzIyLngqYzEzeTMgLSAyKmMxMC54KmMxMnkzKmMxMy54KmMyMi54ICsgMipjMjAueCpjMTJ5MypjMTMueCpjMjIueCArIDIqYzEwLnkqYzEyeDMqYzEzLnkqYzIyLnkgLVxyXG4gICAgICAgICAgICA2KmMxMC54KmMxMC55KmMxMy54KmMyMi54KmMxM3kyICsgMypjMTAueCpjMTEueCpjMTIueCpjMTN5MipjMjIueSAtIDIqYzEwLngqYzExLngqYzEyLnkqYzIyLngqYzEzeTIgLVxyXG4gICAgICAgICAgICA0KmMxMC54KmMxMS55KmMxMi54KmMyMi54KmMxM3kyICsgMypjMTAueSpjMTEueCpjMTIueCpjMjIueCpjMTN5MiArIDYqYzEwLngqYzEwLnkqYzEzeDIqYzEzLnkqYzIyLnkgK1xyXG4gICAgICAgICAgICA2KmMxMC54KmMyMC54KmMxMy54KmMxM3kyKmMyMi55IC0gMypjMTAueCpjMTEueSpjMTIueSpjMTN4MipjMjIueSArIDIqYzEwLngqYzEyLngqYzEyeTIqYzEzLngqYzIyLnkgK1xyXG4gICAgICAgICAgICAyKmMxMC54KmMxMi54KmMxMnkyKmMyMi54KmMxMy55ICsgNipjMTAueCpjMjAueSpjMTMueCpjMjIueCpjMTN5MiArIDYqYzEwLngqYzIxLngqYzEzLngqYzIxLnkqYzEzeTIgK1xyXG4gICAgICAgICAgICA0KmMxMC55KmMxMS54KmMxMi55KmMxM3gyKmMyMi55ICsgNipjMTAueSpjMjAueCpjMTMueCpjMjIueCpjMTN5MiArIDIqYzEwLnkqYzExLnkqYzEyLngqYzEzeDIqYzIyLnkgLVxyXG4gICAgICAgICAgICAzKmMxMC55KmMxMS55KmMxMi55KmMxM3gyKmMyMi54ICsgMipjMTAueSpjMTIueCpjMTJ5MipjMTMueCpjMjIueCAtIDMqYzExLngqYzIwLngqYzEyLngqYzEzeTIqYzIyLnkgK1xyXG4gICAgICAgICAgICAyKmMxMS54KmMyMC54KmMxMi55KmMyMi54KmMxM3kyICsgYzExLngqYzExLnkqYzEyeTIqYzEzLngqYzIyLnggLSAzKmMxMS54KmMxMi54KmMyMC55KmMyMi54KmMxM3kyIC1cclxuICAgICAgICAgICAgMypjMTEueCpjMTIueCpjMjEueCpjMjEueSpjMTN5MiArIDQqYzIwLngqYzExLnkqYzEyLngqYzIyLngqYzEzeTIgLSAyKmMxMC54KmMxMngyKmMxMi55KmMxMy55KmMyMi55IC1cclxuICAgICAgICAgICAgNipjMTAueSpjMjAueCpjMTN4MipjMTMueSpjMjIueSAtIDYqYzEwLnkqYzIwLnkqYzEzeDIqYzIyLngqYzEzLnkgLSA2KmMxMC55KmMyMS54KmMxM3gyKmMyMS55KmMxMy55IC1cclxuICAgICAgICAgICAgMipjMTAueSpjMTJ4MipjMTIueSpjMTMueCpjMjIueSAtIDIqYzEwLnkqYzEyeDIqYzEyLnkqYzIyLngqYzEzLnkgLSBjMTEueCpjMTEueSpjMTJ4MipjMTMueSpjMjIueSAtXHJcbiAgICAgICAgICAgIDIqYzExLngqYzExeTIqYzEzLngqYzIyLngqYzEzLnkgKyAzKmMyMC54KmMxMS55KmMxMi55KmMxM3gyKmMyMi55IC0gMipjMjAueCpjMTIueCpjMTJ5MipjMTMueCpjMjIueSAtXHJcbiAgICAgICAgICAgIDIqYzIwLngqYzEyLngqYzEyeTIqYzIyLngqYzEzLnkgLSA2KmMyMC54KmMyMC55KmMxMy54KmMyMi54KmMxM3kyIC0gNipjMjAueCpjMjEueCpjMTMueCpjMjEueSpjMTN5MiArXHJcbiAgICAgICAgICAgIDMqYzExLnkqYzIwLnkqYzEyLnkqYzEzeDIqYzIyLnggKyAzKmMxMS55KmMyMS54KmMxMi55KmMxM3gyKmMyMS55IC0gMipjMTIueCpjMjAueSpjMTJ5MipjMTMueCpjMjIueCAtXHJcbiAgICAgICAgICAgIDIqYzEyLngqYzIxLngqYzEyeTIqYzEzLngqYzIxLnkgLSBjMTF5MipjMTIueCpjMTIueSpjMTMueCpjMjIueCArIDIqYzIwLngqYzEyeDIqYzEyLnkqYzEzLnkqYzIyLnkgLVxyXG4gICAgICAgICAgICAzKmMxMS55KmMyMXgyKmMxMi55KmMxMy54KmMxMy55ICsgNipjMjAueSpjMjEueCpjMTN4MipjMjEueSpjMTMueSArIDIqYzExeDIqYzExLnkqYzEzLngqYzEzLnkqYzIyLnkgK1xyXG4gICAgICAgICAgICBjMTF4MipjMTIueCpjMTIueSpjMTMueSpjMjIueSArIDIqYzEyeDIqYzIwLnkqYzEyLnkqYzIyLngqYzEzLnkgKyAyKmMxMngyKmMyMS54KmMxMi55KmMyMS55KmMxMy55IC1cclxuICAgICAgICAgICAgMypjMTAueCpjMjF4MipjMTN5MyArIDMqYzIwLngqYzIxeDIqYzEzeTMgKyAzKmMxMHgyKmMyMi54KmMxM3kzIC0gMypjMTB5MipjMTN4MypjMjIueSArIDMqYzIweDIqYzIyLngqYzEzeTMgK1xyXG4gICAgICAgICAgICBjMjF4MipjMTJ5MypjMTMueCArIGMxMXkzKmMxM3gyKmMyMi54IC0gYzExeDMqYzEzeTIqYzIyLnkgKyAzKmMxMC55KmMyMXgyKmMxMy54KmMxM3kyIC1cclxuICAgICAgICAgICAgYzExLngqYzExeTIqYzEzeDIqYzIyLnkgKyBjMTEueCpjMjF4MipjMTIueSpjMTN5MiArIDIqYzExLnkqYzEyLngqYzIxeDIqYzEzeTIgKyBjMTF4MipjMTEueSpjMjIueCpjMTN5MiAtXHJcbiAgICAgICAgICAgIGMxMi54KmMyMXgyKmMxMnkyKmMxMy55IC0gMypjMjAueSpjMjF4MipjMTMueCpjMTN5MiAtIDMqYzEweDIqYzEzLngqYzEzeTIqYzIyLnkgKyAzKmMxMHkyKmMxM3gyKmMyMi54KmMxMy55IC1cclxuICAgICAgICAgICAgYzExeDIqYzEyeTIqYzEzLngqYzIyLnkgKyBjMTF5MipjMTJ4MipjMjIueCpjMTMueSAtIDMqYzIweDIqYzEzLngqYzEzeTIqYzIyLnkgKyAzKmMyMHkyKmMxM3gyKmMyMi54KmMxMy55ICtcclxuICAgICAgICAgICAgYzEyeDIqYzEyLnkqYzEzLngqKDIqYzIwLnkqYzIyLnkgKyBjMjF5MikgKyBjMTEueCpjMTIueCpjMTMueCpjMTMueSooNipjMjAueSpjMjIueSArIDMqYzIxeTIpICtcclxuICAgICAgICAgICAgYzEyeDMqYzEzLnkqKC0yKmMyMC55KmMyMi55IC0gYzIxeTIpICsgYzEwLnkqYzEzeDMqKDYqYzIwLnkqYzIyLnkgKyAzKmMyMXkyKSArXHJcbiAgICAgICAgICAgIGMxMS55KmMxMi54KmMxM3gyKigtMipjMjAueSpjMjIueSAtIGMyMXkyKSArIGMxMS54KmMxMi55KmMxM3gyKigtNCpjMjAueSpjMjIueSAtIDIqYzIxeTIpICtcclxuICAgICAgICAgICAgYzEwLngqYzEzeDIqYzEzLnkqKC02KmMyMC55KmMyMi55IC0gMypjMjF5MikgKyBjMjAueCpjMTN4MipjMTMueSooNipjMjAueSpjMjIueSArIDMqYzIxeTIpICtcclxuICAgICAgICAgICAgYzEzeDMqKC0yKmMyMC55KmMyMXkyIC0gYzIweTIqYzIyLnkgLSBjMjAueSooMipjMjAueSpjMjIueSArIGMyMXkyKSksXHJcbiAgICAgICAgLWMxMC54KmMxMS54KmMxMi55KmMxMy54KmMyMS55KmMxMy55ICsgYzEwLngqYzExLnkqYzEyLngqYzEzLngqYzIxLnkqYzEzLnkgKyA2KmMxMC54KmMxMS55KmMyMS54KmMxMi55KmMxMy54KmMxMy55IC1cclxuICAgICAgICAgICAgNipjMTAueSpjMTEueCpjMTIueCpjMTMueCpjMjEueSpjMTMueSAtIGMxMC55KmMxMS54KmMyMS54KmMxMi55KmMxMy54KmMxMy55ICsgYzEwLnkqYzExLnkqYzEyLngqYzIxLngqYzEzLngqYzEzLnkgLVxyXG4gICAgICAgICAgICBjMTEueCpjMTEueSpjMTIueCpjMjEueCpjMTIueSpjMTMueSArIGMxMS54KmMxMS55KmMxMi54KmMxMi55KmMxMy54KmMyMS55ICsgYzExLngqYzIwLngqYzEyLnkqYzEzLngqYzIxLnkqYzEzLnkgK1xyXG4gICAgICAgICAgICA2KmMxMS54KmMxMi54KmMyMC55KmMxMy54KmMyMS55KmMxMy55ICsgYzExLngqYzIwLnkqYzIxLngqYzEyLnkqYzEzLngqYzEzLnkgLSBjMjAueCpjMTEueSpjMTIueCpjMTMueCpjMjEueSpjMTMueSAtXHJcbiAgICAgICAgICAgIDYqYzIwLngqYzExLnkqYzIxLngqYzEyLnkqYzEzLngqYzEzLnkgLSBjMTEueSpjMTIueCpjMjAueSpjMjEueCpjMTMueCpjMTMueSAtIDYqYzEwLngqYzIwLngqYzIxLngqYzEzeTMgLVxyXG4gICAgICAgICAgICAyKmMxMC54KmMyMS54KmMxMnkzKmMxMy54ICsgNipjMTAueSpjMjAueSpjMTN4MypjMjEueSArIDIqYzIwLngqYzIxLngqYzEyeTMqYzEzLnggKyAyKmMxMC55KmMxMngzKmMyMS55KmMxMy55IC1cclxuICAgICAgICAgICAgMipjMTJ4MypjMjAueSpjMjEueSpjMTMueSAtIDYqYzEwLngqYzEwLnkqYzIxLngqYzEzLngqYzEzeTIgKyAzKmMxMC54KmMxMS54KmMxMi54KmMyMS55KmMxM3kyIC1cclxuICAgICAgICAgICAgMipjMTAueCpjMTEueCpjMjEueCpjMTIueSpjMTN5MiAtIDQqYzEwLngqYzExLnkqYzEyLngqYzIxLngqYzEzeTIgKyAzKmMxMC55KmMxMS54KmMxMi54KmMyMS54KmMxM3kyICtcclxuICAgICAgICAgICAgNipjMTAueCpjMTAueSpjMTN4MipjMjEueSpjMTMueSArIDYqYzEwLngqYzIwLngqYzEzLngqYzIxLnkqYzEzeTIgLSAzKmMxMC54KmMxMS55KmMxMi55KmMxM3gyKmMyMS55ICtcclxuICAgICAgICAgICAgMipjMTAueCpjMTIueCpjMjEueCpjMTJ5MipjMTMueSArIDIqYzEwLngqYzEyLngqYzEyeTIqYzEzLngqYzIxLnkgKyA2KmMxMC54KmMyMC55KmMyMS54KmMxMy54KmMxM3kyICtcclxuICAgICAgICAgICAgNCpjMTAueSpjMTEueCpjMTIueSpjMTN4MipjMjEueSArIDYqYzEwLnkqYzIwLngqYzIxLngqYzEzLngqYzEzeTIgKyAyKmMxMC55KmMxMS55KmMxMi54KmMxM3gyKmMyMS55IC1cclxuICAgICAgICAgICAgMypjMTAueSpjMTEueSpjMjEueCpjMTIueSpjMTN4MiArIDIqYzEwLnkqYzEyLngqYzIxLngqYzEyeTIqYzEzLnggLSAzKmMxMS54KmMyMC54KmMxMi54KmMyMS55KmMxM3kyICtcclxuICAgICAgICAgICAgMipjMTEueCpjMjAueCpjMjEueCpjMTIueSpjMTN5MiArIGMxMS54KmMxMS55KmMyMS54KmMxMnkyKmMxMy54IC0gMypjMTEueCpjMTIueCpjMjAueSpjMjEueCpjMTN5MiArXHJcbiAgICAgICAgICAgIDQqYzIwLngqYzExLnkqYzEyLngqYzIxLngqYzEzeTIgLSA2KmMxMC54KmMyMC55KmMxM3gyKmMyMS55KmMxMy55IC0gMipjMTAueCpjMTJ4MipjMTIueSpjMjEueSpjMTMueSAtXHJcbiAgICAgICAgICAgIDYqYzEwLnkqYzIwLngqYzEzeDIqYzIxLnkqYzEzLnkgLSA2KmMxMC55KmMyMC55KmMyMS54KmMxM3gyKmMxMy55IC0gMipjMTAueSpjMTJ4MipjMjEueCpjMTIueSpjMTMueSAtXHJcbiAgICAgICAgICAgIDIqYzEwLnkqYzEyeDIqYzEyLnkqYzEzLngqYzIxLnkgLSBjMTEueCpjMTEueSpjMTJ4MipjMjEueSpjMTMueSAtIDQqYzExLngqYzIwLnkqYzEyLnkqYzEzeDIqYzIxLnkgLVxyXG4gICAgICAgICAgICAyKmMxMS54KmMxMXkyKmMyMS54KmMxMy54KmMxMy55ICsgMypjMjAueCpjMTEueSpjMTIueSpjMTN4MipjMjEueSAtIDIqYzIwLngqYzEyLngqYzIxLngqYzEyeTIqYzEzLnkgLVxyXG4gICAgICAgICAgICAyKmMyMC54KmMxMi54KmMxMnkyKmMxMy54KmMyMS55IC0gNipjMjAueCpjMjAueSpjMjEueCpjMTMueCpjMTN5MiAtIDIqYzExLnkqYzEyLngqYzIwLnkqYzEzeDIqYzIxLnkgK1xyXG4gICAgICAgICAgICAzKmMxMS55KmMyMC55KmMyMS54KmMxMi55KmMxM3gyIC0gMipjMTIueCpjMjAueSpjMjEueCpjMTJ5MipjMTMueCAtIGMxMXkyKmMxMi54KmMyMS54KmMxMi55KmMxMy54ICtcclxuICAgICAgICAgICAgNipjMjAueCpjMjAueSpjMTN4MipjMjEueSpjMTMueSArIDIqYzIwLngqYzEyeDIqYzEyLnkqYzIxLnkqYzEzLnkgKyAyKmMxMXgyKmMxMS55KmMxMy54KmMyMS55KmMxMy55ICtcclxuICAgICAgICAgICAgYzExeDIqYzEyLngqYzEyLnkqYzIxLnkqYzEzLnkgKyAyKmMxMngyKmMyMC55KmMyMS54KmMxMi55KmMxMy55ICsgMipjMTJ4MipjMjAueSpjMTIueSpjMTMueCpjMjEueSArXHJcbiAgICAgICAgICAgIDMqYzEweDIqYzIxLngqYzEzeTMgLSAzKmMxMHkyKmMxM3gzKmMyMS55ICsgMypjMjB4MipjMjEueCpjMTN5MyArIGMxMXkzKmMyMS54KmMxM3gyIC0gYzExeDMqYzIxLnkqYzEzeTIgLVxyXG4gICAgICAgICAgICAzKmMyMHkyKmMxM3gzKmMyMS55IC0gYzExLngqYzExeTIqYzEzeDIqYzIxLnkgKyBjMTF4MipjMTEueSpjMjEueCpjMTN5MiAtIDMqYzEweDIqYzEzLngqYzIxLnkqYzEzeTIgK1xyXG4gICAgICAgICAgICAzKmMxMHkyKmMyMS54KmMxM3gyKmMxMy55IC0gYzExeDIqYzEyeTIqYzEzLngqYzIxLnkgKyBjMTF5MipjMTJ4MipjMjEueCpjMTMueSAtIDMqYzIweDIqYzEzLngqYzIxLnkqYzEzeTIgK1xyXG4gICAgICAgICAgICAzKmMyMHkyKmMyMS54KmMxM3gyKmMxMy55LFxyXG4gICAgICAgIGMxMC54KmMxMC55KmMxMS54KmMxMi55KmMxMy54KmMxMy55IC0gYzEwLngqYzEwLnkqYzExLnkqYzEyLngqYzEzLngqYzEzLnkgKyBjMTAueCpjMTEueCpjMTEueSpjMTIueCpjMTIueSpjMTMueSAtXHJcbiAgICAgICAgICAgIGMxMC55KmMxMS54KmMxMS55KmMxMi54KmMxMi55KmMxMy54IC0gYzEwLngqYzExLngqYzIwLnkqYzEyLnkqYzEzLngqYzEzLnkgKyA2KmMxMC54KmMyMC54KmMxMS55KmMxMi55KmMxMy54KmMxMy55ICtcclxuICAgICAgICAgICAgYzEwLngqYzExLnkqYzEyLngqYzIwLnkqYzEzLngqYzEzLnkgLSBjMTAueSpjMTEueCpjMjAueCpjMTIueSpjMTMueCpjMTMueSAtIDYqYzEwLnkqYzExLngqYzEyLngqYzIwLnkqYzEzLngqYzEzLnkgK1xyXG4gICAgICAgICAgICBjMTAueSpjMjAueCpjMTEueSpjMTIueCpjMTMueCpjMTMueSAtIGMxMS54KmMyMC54KmMxMS55KmMxMi54KmMxMi55KmMxMy55ICsgYzExLngqYzExLnkqYzEyLngqYzIwLnkqYzEyLnkqYzEzLnggK1xyXG4gICAgICAgICAgICBjMTEueCpjMjAueCpjMjAueSpjMTIueSpjMTMueCpjMTMueSAtIGMyMC54KmMxMS55KmMxMi54KmMyMC55KmMxMy54KmMxMy55IC0gMipjMTAueCpjMjAueCpjMTJ5MypjMTMueCArXHJcbiAgICAgICAgICAgIDIqYzEwLnkqYzEyeDMqYzIwLnkqYzEzLnkgLSAzKmMxMC54KmMxMC55KmMxMS54KmMxMi54KmMxM3kyIC0gNipjMTAueCpjMTAueSpjMjAueCpjMTMueCpjMTN5MiArXHJcbiAgICAgICAgICAgIDMqYzEwLngqYzEwLnkqYzExLnkqYzEyLnkqYzEzeDIgLSAyKmMxMC54KmMxMC55KmMxMi54KmMxMnkyKmMxMy54IC0gMipjMTAueCpjMTEueCpjMjAueCpjMTIueSpjMTN5MiAtXHJcbiAgICAgICAgICAgIGMxMC54KmMxMS54KmMxMS55KmMxMnkyKmMxMy54ICsgMypjMTAueCpjMTEueCpjMTIueCpjMjAueSpjMTN5MiAtIDQqYzEwLngqYzIwLngqYzExLnkqYzEyLngqYzEzeTIgK1xyXG4gICAgICAgICAgICAzKmMxMC55KmMxMS54KmMyMC54KmMxMi54KmMxM3kyICsgNipjMTAueCpjMTAueSpjMjAueSpjMTN4MipjMTMueSArIDIqYzEwLngqYzEwLnkqYzEyeDIqYzEyLnkqYzEzLnkgK1xyXG4gICAgICAgICAgICAyKmMxMC54KmMxMS54KmMxMXkyKmMxMy54KmMxMy55ICsgMipjMTAueCpjMjAueCpjMTIueCpjMTJ5MipjMTMueSArIDYqYzEwLngqYzIwLngqYzIwLnkqYzEzLngqYzEzeTIgLVxyXG4gICAgICAgICAgICAzKmMxMC54KmMxMS55KmMyMC55KmMxMi55KmMxM3gyICsgMipjMTAueCpjMTIueCpjMjAueSpjMTJ5MipjMTMueCArIGMxMC54KmMxMXkyKmMxMi54KmMxMi55KmMxMy54ICtcclxuICAgICAgICAgICAgYzEwLnkqYzExLngqYzExLnkqYzEyeDIqYzEzLnkgKyA0KmMxMC55KmMxMS54KmMyMC55KmMxMi55KmMxM3gyIC0gMypjMTAueSpjMjAueCpjMTEueSpjMTIueSpjMTN4MiArXHJcbiAgICAgICAgICAgIDIqYzEwLnkqYzIwLngqYzEyLngqYzEyeTIqYzEzLnggKyAyKmMxMC55KmMxMS55KmMxMi54KmMyMC55KmMxM3gyICsgYzExLngqYzIwLngqYzExLnkqYzEyeTIqYzEzLnggLVxyXG4gICAgICAgICAgICAzKmMxMS54KmMyMC54KmMxMi54KmMyMC55KmMxM3kyIC0gMipjMTAueCpjMTJ4MipjMjAueSpjMTIueSpjMTMueSAtIDYqYzEwLnkqYzIwLngqYzIwLnkqYzEzeDIqYzEzLnkgLVxyXG4gICAgICAgICAgICAyKmMxMC55KmMyMC54KmMxMngyKmMxMi55KmMxMy55IC0gMipjMTAueSpjMTF4MipjMTEueSpjMTMueCpjMTMueSAtIGMxMC55KmMxMXgyKmMxMi54KmMxMi55KmMxMy55IC1cclxuICAgICAgICAgICAgMipjMTAueSpjMTJ4MipjMjAueSpjMTIueSpjMTMueCAtIDIqYzExLngqYzIwLngqYzExeTIqYzEzLngqYzEzLnkgLSBjMTEueCpjMTEueSpjMTJ4MipjMjAueSpjMTMueSArXHJcbiAgICAgICAgICAgIDMqYzIwLngqYzExLnkqYzIwLnkqYzEyLnkqYzEzeDIgLSAyKmMyMC54KmMxMi54KmMyMC55KmMxMnkyKmMxMy54IC0gYzIwLngqYzExeTIqYzEyLngqYzEyLnkqYzEzLnggK1xyXG4gICAgICAgICAgICAzKmMxMHkyKmMxMS54KmMxMi54KmMxMy54KmMxMy55ICsgMypjMTEueCpjMTIueCpjMjB5MipjMTMueCpjMTMueSArIDIqYzIwLngqYzEyeDIqYzIwLnkqYzEyLnkqYzEzLnkgLVxyXG4gICAgICAgICAgICAzKmMxMHgyKmMxMS55KmMxMi55KmMxMy54KmMxMy55ICsgMipjMTF4MipjMTEueSpjMjAueSpjMTMueCpjMTMueSArIGMxMXgyKmMxMi54KmMyMC55KmMxMi55KmMxMy55IC1cclxuICAgICAgICAgICAgMypjMjB4MipjMTEueSpjMTIueSpjMTMueCpjMTMueSAtIGMxMHgzKmMxM3kzICsgYzEweTMqYzEzeDMgKyBjMjB4MypjMTN5MyAtIGMyMHkzKmMxM3gzIC1cclxuICAgICAgICAgICAgMypjMTAueCpjMjB4MipjMTN5MyAtIGMxMC54KmMxMXkzKmMxM3gyICsgMypjMTB4MipjMjAueCpjMTN5MyArIGMxMC55KmMxMXgzKmMxM3kyICtcclxuICAgICAgICAgICAgMypjMTAueSpjMjB5MipjMTN4MyArIGMyMC54KmMxMXkzKmMxM3gyICsgYzEweDIqYzEyeTMqYzEzLnggLSAzKmMxMHkyKmMyMC55KmMxM3gzIC0gYzEweTIqYzEyeDMqYzEzLnkgK1xyXG4gICAgICAgICAgICBjMjB4MipjMTJ5MypjMTMueCAtIGMxMXgzKmMyMC55KmMxM3kyIC0gYzEyeDMqYzIweTIqYzEzLnkgLSBjMTAueCpjMTF4MipjMTEueSpjMTN5MiArXHJcbiAgICAgICAgICAgIGMxMC55KmMxMS54KmMxMXkyKmMxM3gyIC0gMypjMTAueCpjMTB5MipjMTN4MipjMTMueSAtIGMxMC54KmMxMXkyKmMxMngyKmMxMy55ICsgYzEwLnkqYzExeDIqYzEyeTIqYzEzLnggLVxyXG4gICAgICAgICAgICBjMTEueCpjMTF5MipjMjAueSpjMTN4MiArIDMqYzEweDIqYzEwLnkqYzEzLngqYzEzeTIgKyBjMTB4MipjMTEueCpjMTIueSpjMTN5MiArXHJcbiAgICAgICAgICAgIDIqYzEweDIqYzExLnkqYzEyLngqYzEzeTIgLSAyKmMxMHkyKmMxMS54KmMxMi55KmMxM3gyIC0gYzEweTIqYzExLnkqYzEyLngqYzEzeDIgKyBjMTF4MipjMjAueCpjMTEueSpjMTN5MiAtXHJcbiAgICAgICAgICAgIDMqYzEwLngqYzIweTIqYzEzeDIqYzEzLnkgKyAzKmMxMC55KmMyMHgyKmMxMy54KmMxM3kyICsgYzExLngqYzIweDIqYzEyLnkqYzEzeTIgLSAyKmMxMS54KmMyMHkyKmMxMi55KmMxM3gyICtcclxuICAgICAgICAgICAgYzIwLngqYzExeTIqYzEyeDIqYzEzLnkgLSBjMTEueSpjMTIueCpjMjB5MipjMTN4MiAtIGMxMHgyKmMxMi54KmMxMnkyKmMxMy55IC0gMypjMTB4MipjMjAueSpjMTMueCpjMTN5MiArXHJcbiAgICAgICAgICAgIDMqYzEweTIqYzIwLngqYzEzeDIqYzEzLnkgKyBjMTB5MipjMTJ4MipjMTIueSpjMTMueCAtIGMxMXgyKmMyMC55KmMxMnkyKmMxMy54ICsgMipjMjB4MipjMTEueSpjMTIueCpjMTN5MiArXHJcbiAgICAgICAgICAgIDMqYzIwLngqYzIweTIqYzEzeDIqYzEzLnkgLSBjMjB4MipjMTIueCpjMTJ5MipjMTMueSAtIDMqYzIweDIqYzIwLnkqYzEzLngqYzEzeTIgKyBjMTJ4MipjMjB5MipjMTIueSpjMTMueFxyXG4gICAgKTtcclxuICAgIHZhciByb290cyA9IHBvbHkuZ2V0Um9vdHNJbkludGVydmFsKDAsMSk7XHJcblxyXG4gICAgZm9yICggdmFyIGkgPSAwOyBpIDwgcm9vdHMubGVuZ3RoOyBpKysgKSB7XHJcbiAgICAgICAgdmFyIHMgPSByb290c1tpXTtcclxuICAgICAgICB2YXIgeFJvb3RzID0gbmV3IFBvbHlub21pYWwoXHJcbiAgICAgICAgICAgIGMxMy54LFxyXG4gICAgICAgICAgICBjMTIueCxcclxuICAgICAgICAgICAgYzExLngsXHJcbiAgICAgICAgICAgIGMxMC54IC0gYzIwLnggLSBzKmMyMS54IC0gcypzKmMyMi54IC0gcypzKnMqYzIzLnhcclxuICAgICAgICApLmdldFJvb3RzKCk7XHJcbiAgICAgICAgdmFyIHlSb290cyA9IG5ldyBQb2x5bm9taWFsKFxyXG4gICAgICAgICAgICBjMTMueSxcclxuICAgICAgICAgICAgYzEyLnksXHJcbiAgICAgICAgICAgIGMxMS55LFxyXG4gICAgICAgICAgICBjMTAueSAtIGMyMC55IC0gcypjMjEueSAtIHMqcypjMjIueSAtIHMqcypzKmMyMy55XHJcbiAgICAgICAgKS5nZXRSb290cygpO1xyXG5cclxuICAgICAgICBpZiAoIHhSb290cy5sZW5ndGggPiAwICYmIHlSb290cy5sZW5ndGggPiAwICkge1xyXG4gICAgICAgICAgICB2YXIgVE9MRVJBTkNFID0gMWUtNDtcclxuXHJcbiAgICAgICAgICAgIGNoZWNrUm9vdHM6XHJcbiAgICAgICAgICAgIGZvciAoIHZhciBqID0gMDsgaiA8IHhSb290cy5sZW5ndGg7IGorKyApIHtcclxuICAgICAgICAgICAgICAgIHZhciB4Um9vdCA9IHhSb290c1tqXTtcclxuXHJcbiAgICAgICAgICAgICAgICBpZiAoIDAgPD0geFJvb3QgJiYgeFJvb3QgPD0gMSApIHtcclxuICAgICAgICAgICAgICAgICAgICBmb3IgKCB2YXIgayA9IDA7IGsgPCB5Um9vdHMubGVuZ3RoOyBrKysgKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmICggTWF0aC5hYnMoIHhSb290IC0geVJvb3RzW2tdICkgPCBUT0xFUkFOQ0UgKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXN1bHQucG9pbnRzLnB1c2goXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYzIzLm11bHRpcGx5KHMqcypzKS5hZGQoYzIyLm11bHRpcGx5KHMqcykuYWRkKGMyMS5tdWx0aXBseShzKS5hZGQoYzIwKSkpXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICApO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWsgY2hlY2tSb290cztcclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICBpZiAoIHJlc3VsdC5wb2ludHMubGVuZ3RoID4gMCApIHJlc3VsdC5zdGF0dXMgPSBcIkludGVyc2VjdGlvblwiO1xyXG5cclxuICAgIHJldHVybiByZXN1bHQ7XHJcbn07XHJcblxyXG5cclxuLyoqXHJcbiAqICBpbnRlcnNlY3RCZXppZXIzQ2lyY2xlXHJcbiAqXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IHAxXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IHAyXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IHAzXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IHA0XHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IGNcclxuICogIEBwYXJhbSB7TnVtYmVyfSByXHJcbiAqICBAcmV0dXJucyB7SW50ZXJzZWN0aW9ufVxyXG4gKi9cclxuSW50ZXJzZWN0aW9uLmludGVyc2VjdEJlemllcjNDaXJjbGUgPSBmdW5jdGlvbihwMSwgcDIsIHAzLCBwNCwgYywgcikge1xyXG4gICAgcmV0dXJuIEludGVyc2VjdGlvbi5pbnRlcnNlY3RCZXppZXIzRWxsaXBzZShwMSwgcDIsIHAzLCBwNCwgYywgciwgcik7XHJcbn07XHJcblxyXG5cclxuLyoqXHJcbiAqICBpbnRlcnNlY3RCZXppZXIzRWxsaXBzZVxyXG4gKlxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBwMVxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBwMlxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBwM1xyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBwNFxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBlY1xyXG4gKiAgQHBhcmFtIHtOdW1iZXJ9IHJ4XHJcbiAqICBAcGFyYW0ge051bWJlcn0gcnlcclxuICogIEByZXR1cm5zIHtJbnRlcnNlY3Rpb259XHJcbiAqL1xyXG5JbnRlcnNlY3Rpb24uaW50ZXJzZWN0QmV6aWVyM0VsbGlwc2UgPSBmdW5jdGlvbihwMSwgcDIsIHAzLCBwNCwgZWMsIHJ4LCByeSkge1xyXG4gICAgdmFyIGEsIGIsIGMsIGQ7ICAgICAgIC8vIHRlbXBvcmFyeSB2YXJpYWJsZXNcclxuICAgIHZhciBjMywgYzIsIGMxLCBjMDsgICAvLyBjb2VmZmljaWVudHMgb2YgY3ViaWNcclxuICAgIHZhciByZXN1bHQgPSBuZXcgSW50ZXJzZWN0aW9uKFwiTm8gSW50ZXJzZWN0aW9uXCIpO1xyXG5cclxuICAgIC8vIENhbGN1bGF0ZSB0aGUgY29lZmZpY2llbnRzIG9mIGN1YmljIHBvbHlub21pYWxcclxuICAgIGEgPSBwMS5tdWx0aXBseSgtMSk7XHJcbiAgICBiID0gcDIubXVsdGlwbHkoMyk7XHJcbiAgICBjID0gcDMubXVsdGlwbHkoLTMpO1xyXG4gICAgZCA9IGEuYWRkKGIuYWRkKGMuYWRkKHA0KSkpO1xyXG4gICAgYzMgPSBuZXcgVmVjdG9yMkQoZC54LCBkLnkpO1xyXG5cclxuICAgIGEgPSBwMS5tdWx0aXBseSgzKTtcclxuICAgIGIgPSBwMi5tdWx0aXBseSgtNik7XHJcbiAgICBjID0gcDMubXVsdGlwbHkoMyk7XHJcbiAgICBkID0gYS5hZGQoYi5hZGQoYykpO1xyXG4gICAgYzIgPSBuZXcgVmVjdG9yMkQoZC54LCBkLnkpO1xyXG5cclxuICAgIGEgPSBwMS5tdWx0aXBseSgtMyk7XHJcbiAgICBiID0gcDIubXVsdGlwbHkoMyk7XHJcbiAgICBjID0gYS5hZGQoYik7XHJcbiAgICBjMSA9IG5ldyBWZWN0b3IyRChjLngsIGMueSk7XHJcblxyXG4gICAgYzAgPSBuZXcgVmVjdG9yMkQocDEueCwgcDEueSk7XHJcblxyXG4gICAgdmFyIHJ4cnggID0gcngqcng7XHJcbiAgICB2YXIgcnlyeSAgPSByeSpyeTtcclxuICAgIHZhciBwb2x5ID0gbmV3IFBvbHlub21pYWwoXHJcbiAgICAgICAgYzMueCpjMy54KnJ5cnkgKyBjMy55KmMzLnkqcnhyeCxcclxuICAgICAgICAyKihjMy54KmMyLngqcnlyeSArIGMzLnkqYzIueSpyeHJ4KSxcclxuICAgICAgICAyKihjMy54KmMxLngqcnlyeSArIGMzLnkqYzEueSpyeHJ4KSArIGMyLngqYzIueCpyeXJ5ICsgYzIueSpjMi55KnJ4cngsXHJcbiAgICAgICAgMipjMy54KnJ5cnkqKGMwLnggLSBlYy54KSArIDIqYzMueSpyeHJ4KihjMC55IC0gZWMueSkgK1xyXG4gICAgICAgICAgICAyKihjMi54KmMxLngqcnlyeSArIGMyLnkqYzEueSpyeHJ4KSxcclxuICAgICAgICAyKmMyLngqcnlyeSooYzAueCAtIGVjLngpICsgMipjMi55KnJ4cngqKGMwLnkgLSBlYy55KSArXHJcbiAgICAgICAgICAgIGMxLngqYzEueCpyeXJ5ICsgYzEueSpjMS55KnJ4cngsXHJcbiAgICAgICAgMipjMS54KnJ5cnkqKGMwLnggLSBlYy54KSArIDIqYzEueSpyeHJ4KihjMC55IC0gZWMueSksXHJcbiAgICAgICAgYzAueCpjMC54KnJ5cnkgLSAyKmMwLnkqZWMueSpyeHJ4IC0gMipjMC54KmVjLngqcnlyeSArXHJcbiAgICAgICAgICAgIGMwLnkqYzAueSpyeHJ4ICsgZWMueCplYy54KnJ5cnkgKyBlYy55KmVjLnkqcnhyeCAtIHJ4cngqcnlyeVxyXG4gICAgKTtcclxuICAgIHZhciByb290cyA9IHBvbHkuZ2V0Um9vdHNJbkludGVydmFsKDAsMSk7XHJcblxyXG4gICAgZm9yICggdmFyIGkgPSAwOyBpIDwgcm9vdHMubGVuZ3RoOyBpKysgKSB7XHJcbiAgICAgICAgdmFyIHQgPSByb290c1tpXTtcclxuXHJcbiAgICAgICAgcmVzdWx0LnBvaW50cy5wdXNoKFxyXG4gICAgICAgICAgICBjMy5tdWx0aXBseSh0KnQqdCkuYWRkKGMyLm11bHRpcGx5KHQqdCkuYWRkKGMxLm11bHRpcGx5KHQpLmFkZChjMCkpKVxyXG4gICAgICAgICk7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKCByZXN1bHQucG9pbnRzLmxlbmd0aCA+IDAgKSByZXN1bHQuc3RhdHVzID0gXCJJbnRlcnNlY3Rpb25cIjtcclxuXHJcbiAgICByZXR1cm4gcmVzdWx0O1xyXG59O1xyXG5cclxuXHJcbi8qKlxyXG4gKiAgaW50ZXJzZWN0QmV6aWVyM0xpbmVcclxuICpcclxuICogIE1hbnkgdGhhbmtzIHRvIERhbiBTdW5kYXkgYXQgU29mdFN1cmZlci5jb20uICBIZSBnYXZlIG1lIGEgdmVyeSB0aG9yb3VnaFxyXG4gKiAgc2tldGNoIG9mIHRoZSBhbGdvcml0aG0gdXNlZCBoZXJlLiAgV2l0aG91dCBoaXMgaGVscCwgSSdtIG5vdCBzdXJlIHdoZW4gSVxyXG4gKiAgd291bGQgaGF2ZSBmaWd1cmVkIG91dCB0aGlzIGludGVyc2VjdGlvbiBwcm9ibGVtLlxyXG4gKlxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBwMVxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBwMlxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBwM1xyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBwNFxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBhMVxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBhMlxyXG4gKiAgQHJldHVybnMge0ludGVyc2VjdGlvbn1cclxuICovXHJcbkludGVyc2VjdGlvbi5pbnRlcnNlY3RCZXppZXIzTGluZSA9IGZ1bmN0aW9uKHAxLCBwMiwgcDMsIHA0LCBhMSwgYTIpIHtcclxuICAgIHZhciBhLCBiLCBjLCBkOyAgICAgICAvLyB0ZW1wb3JhcnkgdmFyaWFibGVzXHJcbiAgICB2YXIgYzMsIGMyLCBjMSwgYzA7ICAgLy8gY29lZmZpY2llbnRzIG9mIGN1YmljXHJcbiAgICB2YXIgY2w7ICAgICAgICAgICAgICAgLy8gYyBjb2VmZmljaWVudCBmb3Igbm9ybWFsIGZvcm0gb2YgbGluZVxyXG4gICAgdmFyIG47ICAgICAgICAgICAgICAgIC8vIG5vcm1hbCBmb3Igbm9ybWFsIGZvcm0gb2YgbGluZVxyXG4gICAgdmFyIG1pbiA9IGExLm1pbihhMik7IC8vIHVzZWQgdG8gZGV0ZXJtaW5lIGlmIHBvaW50IGlzIG9uIGxpbmUgc2VnbWVudFxyXG4gICAgdmFyIG1heCA9IGExLm1heChhMik7IC8vIHVzZWQgdG8gZGV0ZXJtaW5lIGlmIHBvaW50IGlzIG9uIGxpbmUgc2VnbWVudFxyXG4gICAgdmFyIHJlc3VsdCA9IG5ldyBJbnRlcnNlY3Rpb24oXCJObyBJbnRlcnNlY3Rpb25cIik7XHJcblxyXG4gICAgLy8gU3RhcnQgd2l0aCBCZXppZXIgdXNpbmcgQmVybnN0ZWluIHBvbHlub21pYWxzIGZvciB3ZWlnaHRpbmcgZnVuY3Rpb25zOlxyXG4gICAgLy8gICAgICgxLXReMylQMSArIDN0KDEtdCleMlAyICsgM3ReMigxLXQpUDMgKyB0XjNQNFxyXG4gICAgLy9cclxuICAgIC8vIEV4cGFuZCBhbmQgY29sbGVjdCB0ZXJtcyB0byBmb3JtIGxpbmVhciBjb21iaW5hdGlvbnMgb2Ygb3JpZ2luYWwgQmV6aWVyXHJcbiAgICAvLyBjb250cm9scy4gIFRoaXMgZW5kcyB1cCB3aXRoIGEgdmVjdG9yIGN1YmljIGluIHQ6XHJcbiAgICAvLyAgICAgKC1QMSszUDItM1AzK1A0KXReMyArICgzUDEtNlAyKzNQMyl0XjIgKyAoLTNQMSszUDIpdCArIFAxXHJcbiAgICAvLyAgICAgICAgICAgICAvXFwgICAgICAgICAgICAgICAgICAvXFwgICAgICAgICAgICAgICAgL1xcICAgICAgIC9cXFxyXG4gICAgLy8gICAgICAgICAgICAgfHwgICAgICAgICAgICAgICAgICB8fCAgICAgICAgICAgICAgICB8fCAgICAgICB8fFxyXG4gICAgLy8gICAgICAgICAgICAgYzMgICAgICAgICAgICAgICAgICBjMiAgICAgICAgICAgICAgICBjMSAgICAgICBjMFxyXG5cclxuICAgIC8vIENhbGN1bGF0ZSB0aGUgY29lZmZpY2llbnRzXHJcbiAgICBhID0gcDEubXVsdGlwbHkoLTEpO1xyXG4gICAgYiA9IHAyLm11bHRpcGx5KDMpO1xyXG4gICAgYyA9IHAzLm11bHRpcGx5KC0zKTtcclxuICAgIGQgPSBhLmFkZChiLmFkZChjLmFkZChwNCkpKTtcclxuICAgIGMzID0gbmV3IFZlY3RvcjJEKGQueCwgZC55KTtcclxuXHJcbiAgICBhID0gcDEubXVsdGlwbHkoMyk7XHJcbiAgICBiID0gcDIubXVsdGlwbHkoLTYpO1xyXG4gICAgYyA9IHAzLm11bHRpcGx5KDMpO1xyXG4gICAgZCA9IGEuYWRkKGIuYWRkKGMpKTtcclxuICAgIGMyID0gbmV3IFZlY3RvcjJEKGQueCwgZC55KTtcclxuXHJcbiAgICBhID0gcDEubXVsdGlwbHkoLTMpO1xyXG4gICAgYiA9IHAyLm11bHRpcGx5KDMpO1xyXG4gICAgYyA9IGEuYWRkKGIpO1xyXG4gICAgYzEgPSBuZXcgVmVjdG9yMkQoYy54LCBjLnkpO1xyXG5cclxuICAgIGMwID0gbmV3IFZlY3RvcjJEKHAxLngsIHAxLnkpO1xyXG5cclxuICAgIC8vIENvbnZlcnQgbGluZSB0byBub3JtYWwgZm9ybTogYXggKyBieSArIGMgPSAwXHJcbiAgICAvLyBGaW5kIG5vcm1hbCB0byBsaW5lOiBuZWdhdGl2ZSBpbnZlcnNlIG9mIG9yaWdpbmFsIGxpbmUncyBzbG9wZVxyXG4gICAgbiA9IG5ldyBWZWN0b3IyRChhMS55IC0gYTIueSwgYTIueCAtIGExLngpO1xyXG5cclxuICAgIC8vIERldGVybWluZSBuZXcgYyBjb2VmZmljaWVudFxyXG4gICAgY2wgPSBhMS54KmEyLnkgLSBhMi54KmExLnk7XHJcblxyXG4gICAgLy8gP1JvdGF0ZSBlYWNoIGN1YmljIGNvZWZmaWNpZW50IHVzaW5nIGxpbmUgZm9yIG5ldyBjb29yZGluYXRlIHN5c3RlbT9cclxuICAgIC8vIEZpbmQgcm9vdHMgb2Ygcm90YXRlZCBjdWJpY1xyXG4gICAgcm9vdHMgPSBuZXcgUG9seW5vbWlhbChcclxuICAgICAgICBuLmRvdChjMyksXHJcbiAgICAgICAgbi5kb3QoYzIpLFxyXG4gICAgICAgIG4uZG90KGMxKSxcclxuICAgICAgICBuLmRvdChjMCkgKyBjbFxyXG4gICAgKS5nZXRSb290cygpO1xyXG5cclxuICAgIC8vIEFueSByb290cyBpbiBjbG9zZWQgaW50ZXJ2YWwgWzAsMV0gYXJlIGludGVyc2VjdGlvbnMgb24gQmV6aWVyLCBidXRcclxuICAgIC8vIG1pZ2h0IG5vdCBiZSBvbiB0aGUgbGluZSBzZWdtZW50LlxyXG4gICAgLy8gRmluZCBpbnRlcnNlY3Rpb25zIGFuZCBjYWxjdWxhdGUgcG9pbnQgY29vcmRpbmF0ZXNcclxuICAgIGZvciAoIHZhciBpID0gMDsgaSA8IHJvb3RzLmxlbmd0aDsgaSsrICkge1xyXG4gICAgICAgIHZhciB0ID0gcm9vdHNbaV07XHJcblxyXG4gICAgICAgIGlmICggMCA8PSB0ICYmIHQgPD0gMSApIHtcclxuICAgICAgICAgICAgLy8gV2UncmUgd2l0aGluIHRoZSBCZXppZXIgY3VydmVcclxuICAgICAgICAgICAgLy8gRmluZCBwb2ludCBvbiBCZXppZXJcclxuICAgICAgICAgICAgdmFyIHA1ID0gcDEubGVycChwMiwgdCk7XHJcbiAgICAgICAgICAgIHZhciBwNiA9IHAyLmxlcnAocDMsIHQpO1xyXG4gICAgICAgICAgICB2YXIgcDcgPSBwMy5sZXJwKHA0LCB0KTtcclxuXHJcbiAgICAgICAgICAgIHZhciBwOCA9IHA1LmxlcnAocDYsIHQpO1xyXG4gICAgICAgICAgICB2YXIgcDkgPSBwNi5sZXJwKHA3LCB0KTtcclxuXHJcbiAgICAgICAgICAgIHZhciBwMTAgPSBwOC5sZXJwKHA5LCB0KTtcclxuXHJcbiAgICAgICAgICAgIC8vIFNlZSBpZiBwb2ludCBpcyBvbiBsaW5lIHNlZ21lbnRcclxuICAgICAgICAgICAgLy8gSGFkIHRvIG1ha2Ugc3BlY2lhbCBjYXNlcyBmb3IgdmVydGljYWwgYW5kIGhvcml6b250YWwgbGluZXMgZHVlXHJcbiAgICAgICAgICAgIC8vIHRvIHNsaWdodCBlcnJvcnMgaW4gY2FsY3VsYXRpb24gb2YgcDEwXHJcbiAgICAgICAgICAgIGlmICggYTEueCA9PSBhMi54ICkge1xyXG4gICAgICAgICAgICAgICAgaWYgKCBtaW4ueSA8PSBwMTAueSAmJiBwMTAueSA8PSBtYXgueSApIHtcclxuICAgICAgICAgICAgICAgICAgICByZXN1bHQuc3RhdHVzID0gXCJJbnRlcnNlY3Rpb25cIjtcclxuICAgICAgICAgICAgICAgICAgICByZXN1bHQuYXBwZW5kUG9pbnQoIHAxMCApO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9IGVsc2UgaWYgKCBhMS55ID09IGEyLnkgKSB7XHJcbiAgICAgICAgICAgICAgICBpZiAoIG1pbi54IDw9IHAxMC54ICYmIHAxMC54IDw9IG1heC54ICkge1xyXG4gICAgICAgICAgICAgICAgICAgIHJlc3VsdC5zdGF0dXMgPSBcIkludGVyc2VjdGlvblwiO1xyXG4gICAgICAgICAgICAgICAgICAgIHJlc3VsdC5hcHBlbmRQb2ludCggcDEwICk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0gZWxzZSBpZiAobWluLnggPD0gcDEwLnggJiYgcDEwLnggPD0gbWF4LnggJiYgbWluLnkgPD0gcDEwLnkgJiYgcDEwLnkgPD0gbWF4LnkpIHtcclxuICAgICAgICAgICAgICAgIHJlc3VsdC5zdGF0dXMgPSBcIkludGVyc2VjdGlvblwiO1xyXG4gICAgICAgICAgICAgICAgcmVzdWx0LmFwcGVuZFBvaW50KCBwMTAgKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gcmVzdWx0O1xyXG59O1xyXG5cclxuXHJcbi8qKlxyXG4gKiAgaW50ZXJzZWN0QmV6aWVyM1BvbHlnb25cclxuICpcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gcDFcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gcDJcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gcDNcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gcDRcclxuICogIEBwYXJhbSB7QXJyYXk8UG9pbnQyRD59IHBvaW50c1xyXG4gKiAgQHJldHVybnMge0ludGVyc2VjdGlvbn1cclxuICovXHJcbkludGVyc2VjdGlvbi5pbnRlcnNlY3RCZXppZXIzUG9seWdvbiA9IGZ1bmN0aW9uKHAxLCBwMiwgcDMsIHA0LCBwb2ludHMpIHtcclxuICAgIHZhciByZXN1bHQgPSBuZXcgSW50ZXJzZWN0aW9uKFwiTm8gSW50ZXJzZWN0aW9uXCIpO1xyXG4gICAgdmFyIGxlbmd0aCA9IHBvaW50cy5sZW5ndGg7XHJcblxyXG4gICAgZm9yICggdmFyIGkgPSAwOyBpIDwgbGVuZ3RoOyBpKysgKSB7XHJcbiAgICAgICAgdmFyIGExID0gcG9pbnRzW2ldO1xyXG4gICAgICAgIHZhciBhMiA9IHBvaW50c1soaSsxKSAlIGxlbmd0aF07XHJcbiAgICAgICAgdmFyIGludGVyID0gSW50ZXJzZWN0aW9uLmludGVyc2VjdEJlemllcjNMaW5lKHAxLCBwMiwgcDMsIHA0LCBhMSwgYTIpO1xyXG5cclxuICAgICAgICByZXN1bHQuYXBwZW5kUG9pbnRzKGludGVyLnBvaW50cyk7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKCByZXN1bHQucG9pbnRzLmxlbmd0aCA+IDAgKSByZXN1bHQuc3RhdHVzID0gXCJJbnRlcnNlY3Rpb25cIjtcclxuXHJcbiAgICByZXR1cm4gcmVzdWx0O1xyXG59O1xyXG5cclxuXHJcbi8qKlxyXG4gKiAgaW50ZXJzZWN0QmV6aWVyM1JlY3RhbmdsZVxyXG4gKlxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBwMVxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBwMlxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBwM1xyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBwNFxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSByMVxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSByMlxyXG4gKiAgQHJldHVybnMge0ludGVyc2VjdGlvbn1cclxuICovXHJcbkludGVyc2VjdGlvbi5pbnRlcnNlY3RCZXppZXIzUmVjdGFuZ2xlID0gZnVuY3Rpb24ocDEsIHAyLCBwMywgcDQsIHIxLCByMikge1xyXG4gICAgdmFyIG1pbiAgICAgICAgPSByMS5taW4ocjIpO1xyXG4gICAgdmFyIG1heCAgICAgICAgPSByMS5tYXgocjIpO1xyXG4gICAgdmFyIHRvcFJpZ2h0ICAgPSBuZXcgUG9pbnQyRCggbWF4LngsIG1pbi55ICk7XHJcbiAgICB2YXIgYm90dG9tTGVmdCA9IG5ldyBQb2ludDJEKCBtaW4ueCwgbWF4LnkgKTtcclxuXHJcbiAgICB2YXIgaW50ZXIxID0gSW50ZXJzZWN0aW9uLmludGVyc2VjdEJlemllcjNMaW5lKHAxLCBwMiwgcDMsIHA0LCBtaW4sIHRvcFJpZ2h0KTtcclxuICAgIHZhciBpbnRlcjIgPSBJbnRlcnNlY3Rpb24uaW50ZXJzZWN0QmV6aWVyM0xpbmUocDEsIHAyLCBwMywgcDQsIHRvcFJpZ2h0LCBtYXgpO1xyXG4gICAgdmFyIGludGVyMyA9IEludGVyc2VjdGlvbi5pbnRlcnNlY3RCZXppZXIzTGluZShwMSwgcDIsIHAzLCBwNCwgbWF4LCBib3R0b21MZWZ0KTtcclxuICAgIHZhciBpbnRlcjQgPSBJbnRlcnNlY3Rpb24uaW50ZXJzZWN0QmV6aWVyM0xpbmUocDEsIHAyLCBwMywgcDQsIGJvdHRvbUxlZnQsIG1pbik7XHJcblxyXG4gICAgdmFyIHJlc3VsdCA9IG5ldyBJbnRlcnNlY3Rpb24oXCJObyBJbnRlcnNlY3Rpb25cIik7XHJcblxyXG4gICAgcmVzdWx0LmFwcGVuZFBvaW50cyhpbnRlcjEucG9pbnRzKTtcclxuICAgIHJlc3VsdC5hcHBlbmRQb2ludHMoaW50ZXIyLnBvaW50cyk7XHJcbiAgICByZXN1bHQuYXBwZW5kUG9pbnRzKGludGVyMy5wb2ludHMpO1xyXG4gICAgcmVzdWx0LmFwcGVuZFBvaW50cyhpbnRlcjQucG9pbnRzKTtcclxuXHJcbiAgICBpZiAoIHJlc3VsdC5wb2ludHMubGVuZ3RoID4gMCApIHJlc3VsdC5zdGF0dXMgPSBcIkludGVyc2VjdGlvblwiO1xyXG5cclxuICAgIHJldHVybiByZXN1bHQ7XHJcbn07XHJcblxyXG5cclxuLyoqXHJcbiAqICBpbnRlcnNlY3RDaXJjbGVDaXJjbGVcclxuICpcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gYzFcclxuICogIEBwYXJhbSB7TnVtYmVyfSByMVxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBjMlxyXG4gKiAgQHBhcmFtIHtOdW1iZXJ9IHIyXHJcbiAqICBAcmV0dXJucyB7SW50ZXJzZWN0aW9ufVxyXG4gKi9cclxuSW50ZXJzZWN0aW9uLmludGVyc2VjdENpcmNsZUNpcmNsZSA9IGZ1bmN0aW9uKGMxLCByMSwgYzIsIHIyKSB7XHJcbiAgICB2YXIgcmVzdWx0O1xyXG5cclxuICAgIC8vIERldGVybWluZSBtaW5pbXVtIGFuZCBtYXhpbXVtIHJhZGlpIHdoZXJlIGNpcmNsZXMgY2FuIGludGVyc2VjdFxyXG4gICAgdmFyIHJfbWF4ID0gcjEgKyByMjtcclxuICAgIHZhciByX21pbiA9IE1hdGguYWJzKHIxIC0gcjIpO1xyXG5cclxuICAgIC8vIERldGVybWluZSBhY3R1YWwgZGlzdGFuY2UgYmV0d2VlbiBjaXJjbGUgY2lyY2xlc1xyXG4gICAgdmFyIGNfZGlzdCA9IGMxLmRpc3RhbmNlRnJvbSggYzIgKTtcclxuXHJcbiAgICBpZiAoIGNfZGlzdCA+IHJfbWF4ICkge1xyXG4gICAgICAgIHJlc3VsdCA9IG5ldyBJbnRlcnNlY3Rpb24oXCJPdXRzaWRlXCIpO1xyXG4gICAgfSBlbHNlIGlmICggY19kaXN0IDwgcl9taW4gKSB7XHJcbiAgICAgICAgcmVzdWx0ID0gbmV3IEludGVyc2VjdGlvbihcIkluc2lkZVwiKTtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgICAgcmVzdWx0ID0gbmV3IEludGVyc2VjdGlvbihcIkludGVyc2VjdGlvblwiKTtcclxuXHJcbiAgICAgICAgdmFyIGEgPSAocjEqcjEgLSByMipyMiArIGNfZGlzdCpjX2Rpc3QpIC8gKCAyKmNfZGlzdCApO1xyXG4gICAgICAgIHZhciBoID0gTWF0aC5zcXJ0KHIxKnIxIC0gYSphKTtcclxuICAgICAgICB2YXIgcCA9IGMxLmxlcnAoYzIsIGEvY19kaXN0KTtcclxuICAgICAgICB2YXIgYiA9IGggLyBjX2Rpc3Q7XHJcblxyXG4gICAgICAgIHJlc3VsdC5wb2ludHMucHVzaChcclxuICAgICAgICAgICAgbmV3IFBvaW50MkQoXHJcbiAgICAgICAgICAgICAgICBwLnggLSBiICogKGMyLnkgLSBjMS55KSxcclxuICAgICAgICAgICAgICAgIHAueSArIGIgKiAoYzIueCAtIGMxLngpXHJcbiAgICAgICAgICAgIClcclxuICAgICAgICApO1xyXG4gICAgICAgIHJlc3VsdC5wb2ludHMucHVzaChcclxuICAgICAgICAgICAgbmV3IFBvaW50MkQoXHJcbiAgICAgICAgICAgICAgICBwLnggKyBiICogKGMyLnkgLSBjMS55KSxcclxuICAgICAgICAgICAgICAgIHAueSAtIGIgKiAoYzIueCAtIGMxLngpXHJcbiAgICAgICAgICAgIClcclxuICAgICAgICApO1xyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiByZXN1bHQ7XHJcbn07XHJcblxyXG5cclxuLyoqXHJcbiAqICBpbnRlcnNlY3RDaXJjbGVFbGxpcHNlXHJcbiAqXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IGNjXHJcbiAqICBAcGFyYW0ge051bWJlcn0gclxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBlY1xyXG4gKiAgQHBhcmFtIHtOdW1iZXJ9IHJ4XHJcbiAqICBAcGFyYW0ge051bWJlcn0gcnlcclxuICogIEByZXR1cm5zIHtJbnRlcnNlY3Rpb259XHJcbiAqL1xyXG5JbnRlcnNlY3Rpb24uaW50ZXJzZWN0Q2lyY2xlRWxsaXBzZSA9IGZ1bmN0aW9uKGNjLCByLCBlYywgcngsIHJ5KSB7XHJcbiAgICByZXR1cm4gSW50ZXJzZWN0aW9uLmludGVyc2VjdEVsbGlwc2VFbGxpcHNlKGNjLCByLCByLCBlYywgcngsIHJ5KTtcclxufTtcclxuXHJcblxyXG4vKipcclxuICogIGludGVyc2VjdENpcmNsZUxpbmVcclxuICpcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gY1xyXG4gKiAgQHBhcmFtIHtOdW1iZXJ9IHJcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gYTFcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gYTJcclxuICogIEByZXR1cm5zIHtJbnRlcnNlY3Rpb259XHJcbiAqL1xyXG5JbnRlcnNlY3Rpb24uaW50ZXJzZWN0Q2lyY2xlTGluZSA9IGZ1bmN0aW9uKGMsIHIsIGExLCBhMikge1xyXG4gICAgdmFyIHJlc3VsdDtcclxuICAgIHZhciBhICA9IChhMi54IC0gYTEueCkgKiAoYTIueCAtIGExLngpICtcclxuICAgICAgICAgICAgIChhMi55IC0gYTEueSkgKiAoYTIueSAtIGExLnkpO1xyXG4gICAgdmFyIGIgID0gMiAqICggKGEyLnggLSBhMS54KSAqIChhMS54IC0gYy54KSArXHJcbiAgICAgICAgICAgICAgICAgICAoYTIueSAtIGExLnkpICogKGExLnkgLSBjLnkpICAgKTtcclxuICAgIHZhciBjYyA9IGMueCpjLnggKyBjLnkqYy55ICsgYTEueCphMS54ICsgYTEueSphMS55IC1cclxuICAgICAgICAgICAgIDIgKiAoYy54ICogYTEueCArIGMueSAqIGExLnkpIC0gcipyO1xyXG4gICAgdmFyIGRldGVyID0gYipiIC0gNCphKmNjO1xyXG5cclxuICAgIGlmICggZGV0ZXIgPCAwICkge1xyXG4gICAgICAgIHJlc3VsdCA9IG5ldyBJbnRlcnNlY3Rpb24oXCJPdXRzaWRlXCIpO1xyXG4gICAgfSBlbHNlIGlmICggZGV0ZXIgPT0gMCApIHtcclxuICAgICAgICByZXN1bHQgPSBuZXcgSW50ZXJzZWN0aW9uKFwiVGFuZ2VudFwiKTtcclxuICAgICAgICAvLyBOT1RFOiBzaG91bGQgY2FsY3VsYXRlIHRoaXMgcG9pbnRcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgICAgdmFyIGUgID0gTWF0aC5zcXJ0KGRldGVyKTtcclxuICAgICAgICB2YXIgdTEgPSAoIC1iICsgZSApIC8gKCAyKmEgKTtcclxuICAgICAgICB2YXIgdTIgPSAoIC1iIC0gZSApIC8gKCAyKmEgKTtcclxuXHJcbiAgICAgICAgaWYgKCAodTEgPCAwIHx8IHUxID4gMSkgJiYgKHUyIDwgMCB8fCB1MiA+IDEpICkge1xyXG4gICAgICAgICAgICBpZiAoICh1MSA8IDAgJiYgdTIgPCAwKSB8fCAodTEgPiAxICYmIHUyID4gMSkgKSB7XHJcbiAgICAgICAgICAgICAgICByZXN1bHQgPSBuZXcgSW50ZXJzZWN0aW9uKFwiT3V0c2lkZVwiKTtcclxuICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgIHJlc3VsdCA9IG5ldyBJbnRlcnNlY3Rpb24oXCJJbnNpZGVcIik7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICByZXN1bHQgPSBuZXcgSW50ZXJzZWN0aW9uKFwiSW50ZXJzZWN0aW9uXCIpO1xyXG5cclxuICAgICAgICAgICAgaWYgKCAwIDw9IHUxICYmIHUxIDw9IDEpXHJcbiAgICAgICAgICAgICAgICByZXN1bHQucG9pbnRzLnB1c2goIGExLmxlcnAoYTIsIHUxKSApO1xyXG5cclxuICAgICAgICAgICAgaWYgKCAwIDw9IHUyICYmIHUyIDw9IDEpXHJcbiAgICAgICAgICAgICAgICByZXN1bHQucG9pbnRzLnB1c2goIGExLmxlcnAoYTIsIHUyKSApO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gcmVzdWx0O1xyXG59O1xyXG5cclxuXHJcbi8qKlxyXG4gKiAgaW50ZXJzZWN0Q2lyY2xlUG9seWdvblxyXG4gKlxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBjXHJcbiAqICBAcGFyYW0ge051bWJlcn0gclxyXG4gKiAgQHBhcmFtIHtBcnJheTxQb2ludDJEPn0gcG9pbnRzXHJcbiAqICBAcmV0dXJucyB7SW50ZXJzZWN0aW9ufVxyXG4gKi9cclxuSW50ZXJzZWN0aW9uLmludGVyc2VjdENpcmNsZVBvbHlnb24gPSBmdW5jdGlvbihjLCByLCBwb2ludHMpIHtcclxuICAgIHZhciByZXN1bHQgPSBuZXcgSW50ZXJzZWN0aW9uKFwiTm8gSW50ZXJzZWN0aW9uXCIpO1xyXG4gICAgdmFyIGxlbmd0aCA9IHBvaW50cy5sZW5ndGg7XHJcbiAgICB2YXIgaW50ZXI7XHJcblxyXG4gICAgZm9yICggdmFyIGkgPSAwOyBpIDwgbGVuZ3RoOyBpKysgKSB7XHJcbiAgICAgICAgdmFyIGExID0gcG9pbnRzW2ldO1xyXG4gICAgICAgIHZhciBhMiA9IHBvaW50c1soaSsxKSAlIGxlbmd0aF07XHJcblxyXG4gICAgICAgIGludGVyID0gSW50ZXJzZWN0aW9uLmludGVyc2VjdENpcmNsZUxpbmUoYywgciwgYTEsIGEyKTtcclxuICAgICAgICByZXN1bHQuYXBwZW5kUG9pbnRzKGludGVyLnBvaW50cyk7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKCByZXN1bHQucG9pbnRzLmxlbmd0aCA+IDAgKVxyXG4gICAgICAgIHJlc3VsdC5zdGF0dXMgPSBcIkludGVyc2VjdGlvblwiO1xyXG4gICAgZWxzZVxyXG4gICAgICAgIHJlc3VsdC5zdGF0dXMgPSBpbnRlci5zdGF0dXM7XHJcblxyXG4gICAgcmV0dXJuIHJlc3VsdDtcclxufTtcclxuXHJcblxyXG4vKipcclxuICogIGludGVyc2VjdENpcmNsZVJlY3RhbmdsZVxyXG4gKlxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBjXHJcbiAqICBAcGFyYW0ge051bWJlcn0gclxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSByMVxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSByMlxyXG4gKiAgQHJldHVybnMge0ludGVyc2VjdGlvbn1cclxuICovXHJcbkludGVyc2VjdGlvbi5pbnRlcnNlY3RDaXJjbGVSZWN0YW5nbGUgPSBmdW5jdGlvbihjLCByLCByMSwgcjIpIHtcclxuICAgIHZhciBtaW4gICAgICAgID0gcjEubWluKHIyKTtcclxuICAgIHZhciBtYXggICAgICAgID0gcjEubWF4KHIyKTtcclxuICAgIHZhciB0b3BSaWdodCAgID0gbmV3IFBvaW50MkQoIG1heC54LCBtaW4ueSApO1xyXG4gICAgdmFyIGJvdHRvbUxlZnQgPSBuZXcgUG9pbnQyRCggbWluLngsIG1heC55ICk7XHJcblxyXG4gICAgdmFyIGludGVyMSA9IEludGVyc2VjdGlvbi5pbnRlcnNlY3RDaXJjbGVMaW5lKGMsIHIsIG1pbiwgdG9wUmlnaHQpO1xyXG4gICAgdmFyIGludGVyMiA9IEludGVyc2VjdGlvbi5pbnRlcnNlY3RDaXJjbGVMaW5lKGMsIHIsIHRvcFJpZ2h0LCBtYXgpO1xyXG4gICAgdmFyIGludGVyMyA9IEludGVyc2VjdGlvbi5pbnRlcnNlY3RDaXJjbGVMaW5lKGMsIHIsIG1heCwgYm90dG9tTGVmdCk7XHJcbiAgICB2YXIgaW50ZXI0ID0gSW50ZXJzZWN0aW9uLmludGVyc2VjdENpcmNsZUxpbmUoYywgciwgYm90dG9tTGVmdCwgbWluKTtcclxuXHJcbiAgICB2YXIgcmVzdWx0ID0gbmV3IEludGVyc2VjdGlvbihcIk5vIEludGVyc2VjdGlvblwiKTtcclxuXHJcbiAgICByZXN1bHQuYXBwZW5kUG9pbnRzKGludGVyMS5wb2ludHMpO1xyXG4gICAgcmVzdWx0LmFwcGVuZFBvaW50cyhpbnRlcjIucG9pbnRzKTtcclxuICAgIHJlc3VsdC5hcHBlbmRQb2ludHMoaW50ZXIzLnBvaW50cyk7XHJcbiAgICByZXN1bHQuYXBwZW5kUG9pbnRzKGludGVyNC5wb2ludHMpO1xyXG5cclxuICAgIGlmICggcmVzdWx0LnBvaW50cy5sZW5ndGggPiAwIClcclxuICAgICAgICByZXN1bHQuc3RhdHVzID0gXCJJbnRlcnNlY3Rpb25cIjtcclxuICAgIGVsc2VcclxuICAgICAgICByZXN1bHQuc3RhdHVzID0gaW50ZXIxLnN0YXR1cztcclxuXHJcbiAgICByZXR1cm4gcmVzdWx0O1xyXG59O1xyXG5cclxuXHJcbi8qKlxyXG4gKiAgaW50ZXJzZWN0RWxsaXBzZUVsbGlwc2VcclxuICpcclxuICogIFRoaXMgY29kZSBpcyBiYXNlZCBvbiBNZ2NJbnRyMkRFbHBFbHAuY3BwIHdyaXR0ZW4gYnkgRGF2aWQgRWJlcmx5LiAgSGlzXHJcbiAqICBjb2RlIGFsb25nIHdpdGggbWFueSBvdGhlciBleGNlbGxlbnQgZXhhbXBsZXMgYXJlIGF2YWlhYmxlIGF0IGhpcyBzaXRlOlxyXG4gKiAgaHR0cDovL3d3dy5tYWdpYy1zb2Z0d2FyZS5jb21cclxuICpcclxuICogIE5PVEU6IFJvdGF0aW9uIHdpbGwgbmVlZCB0byBiZSBhZGRlZCB0byB0aGlzIGZ1bmN0aW9uXHJcbiAqXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IGMxXHJcbiAqICBAcGFyYW0ge051bWJlcn0gcngxXHJcbiAqICBAcGFyYW0ge051bWJlcn0gcnkxXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IGMyXHJcbiAqICBAcGFyYW0ge051bWJlcn0gcngyXHJcbiAqICBAcGFyYW0ge051bWJlcn0gcnkyXHJcbiAqICBAcmV0dXJucyB7SW50ZXJzZWN0aW9ufVxyXG4gKi9cclxuSW50ZXJzZWN0aW9uLmludGVyc2VjdEVsbGlwc2VFbGxpcHNlID0gZnVuY3Rpb24oYzEsIHJ4MSwgcnkxLCBjMiwgcngyLCByeTIpIHtcclxuICAgIHZhciBhID0gW1xyXG4gICAgICAgIHJ5MSpyeTEsIDAsIHJ4MSpyeDEsIC0yKnJ5MSpyeTEqYzEueCwgLTIqcngxKnJ4MSpjMS55LFxyXG4gICAgICAgIHJ5MSpyeTEqYzEueCpjMS54ICsgcngxKnJ4MSpjMS55KmMxLnkgLSByeDEqcngxKnJ5MSpyeTFcclxuICAgIF07XHJcbiAgICB2YXIgYiA9IFtcclxuICAgICAgICByeTIqcnkyLCAwLCByeDIqcngyLCAtMipyeTIqcnkyKmMyLngsIC0yKnJ4MipyeDIqYzIueSxcclxuICAgICAgICByeTIqcnkyKmMyLngqYzIueCArIHJ4MipyeDIqYzIueSpjMi55IC0gcngyKnJ4MipyeTIqcnkyXHJcbiAgICBdO1xyXG5cclxuICAgIHZhciB5UG9seSAgID0gSW50ZXJzZWN0aW9uLmJlem91dChhLCBiKTtcclxuICAgIHZhciB5Um9vdHMgID0geVBvbHkuZ2V0Um9vdHMoKTtcclxuICAgIHZhciBlcHNpbG9uID0gMWUtMztcclxuICAgIHZhciBub3JtMCAgID0gKCBhWzBdKmFbMF0gKyAyKmFbMV0qYVsxXSArIGFbMl0qYVsyXSApICogZXBzaWxvbjtcclxuICAgIHZhciBub3JtMSAgID0gKCBiWzBdKmJbMF0gKyAyKmJbMV0qYlsxXSArIGJbMl0qYlsyXSApICogZXBzaWxvbjtcclxuICAgIHZhciByZXN1bHQgID0gbmV3IEludGVyc2VjdGlvbihcIk5vIEludGVyc2VjdGlvblwiKTtcclxuXHJcbiAgICBmb3IgKCB2YXIgeSA9IDA7IHkgPCB5Um9vdHMubGVuZ3RoOyB5KysgKSB7XHJcbiAgICAgICAgdmFyIHhQb2x5ID0gbmV3IFBvbHlub21pYWwoXHJcbiAgICAgICAgICAgIGFbMF0sXHJcbiAgICAgICAgICAgIGFbM10gKyB5Um9vdHNbeV0gKiBhWzFdLFxyXG4gICAgICAgICAgICBhWzVdICsgeVJvb3RzW3ldICogKGFbNF0gKyB5Um9vdHNbeV0qYVsyXSlcclxuICAgICAgICApO1xyXG4gICAgICAgIHZhciB4Um9vdHMgPSB4UG9seS5nZXRSb290cygpO1xyXG5cclxuICAgICAgICBmb3IgKCB2YXIgeCA9IDA7IHggPCB4Um9vdHMubGVuZ3RoOyB4KysgKSB7XHJcbiAgICAgICAgICAgIHZhciB0ZXN0ID1cclxuICAgICAgICAgICAgICAgICggYVswXSp4Um9vdHNbeF0gKyBhWzFdKnlSb290c1t5XSArIGFbM10gKSAqIHhSb290c1t4XSArXHJcbiAgICAgICAgICAgICAgICAoIGFbMl0qeVJvb3RzW3ldICsgYVs0XSApICogeVJvb3RzW3ldICsgYVs1XTtcclxuICAgICAgICAgICAgaWYgKCBNYXRoLmFicyh0ZXN0KSA8IG5vcm0wICkge1xyXG4gICAgICAgICAgICAgICAgdGVzdCA9XHJcbiAgICAgICAgICAgICAgICAgICAgKCBiWzBdKnhSb290c1t4XSArIGJbMV0qeVJvb3RzW3ldICsgYlszXSApICogeFJvb3RzW3hdICtcclxuICAgICAgICAgICAgICAgICAgICAoIGJbMl0qeVJvb3RzW3ldICsgYls0XSApICogeVJvb3RzW3ldICsgYls1XTtcclxuICAgICAgICAgICAgICAgIGlmICggTWF0aC5hYnModGVzdCkgPCBub3JtMSApIHtcclxuICAgICAgICAgICAgICAgICAgICByZXN1bHQuYXBwZW5kUG9pbnQoIG5ldyBQb2ludDJEKCB4Um9vdHNbeF0sIHlSb290c1t5XSApICk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKCByZXN1bHQucG9pbnRzLmxlbmd0aCA+IDAgKSByZXN1bHQuc3RhdHVzID0gXCJJbnRlcnNlY3Rpb25cIjtcclxuXHJcbiAgICByZXR1cm4gcmVzdWx0O1xyXG59O1xyXG5cclxuXHJcbi8qKlxyXG4gKiAgaW50ZXJzZWN0RWxsaXBzZUxpbmVcclxuICpcclxuICogIE5PVEU6IFJvdGF0aW9uIHdpbGwgbmVlZCB0byBiZSBhZGRlZCB0byB0aGlzIGZ1bmN0aW9uXHJcbiAqXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IGNcclxuICogIEBwYXJhbSB7TnVtYmVyfSByeFxyXG4gKiAgQHBhcmFtIHtOdW1iZXJ9IHJ5XHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IGExXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IGEyXHJcbiAqICBAcmV0dXJucyB7SW50ZXJzZWN0aW9ufVxyXG4gKi9cclxuSW50ZXJzZWN0aW9uLmludGVyc2VjdEVsbGlwc2VMaW5lID0gZnVuY3Rpb24oYywgcngsIHJ5LCBhMSwgYTIpIHtcclxuICAgIHZhciByZXN1bHQ7XHJcbiAgICB2YXIgb3JpZ2luID0gbmV3IFZlY3RvcjJEKGExLngsIGExLnkpO1xyXG4gICAgdmFyIGRpciAgICA9IFZlY3RvcjJELmZyb21Qb2ludHMoYTEsIGEyKTtcclxuICAgIHZhciBjZW50ZXIgPSBuZXcgVmVjdG9yMkQoYy54LCBjLnkpO1xyXG4gICAgdmFyIGRpZmYgICA9IG9yaWdpbi5zdWJ0cmFjdChjZW50ZXIpO1xyXG4gICAgdmFyIG1EaXIgICA9IG5ldyBWZWN0b3IyRCggZGlyLngvKHJ4KnJ4KSwgIGRpci55LyhyeSpyeSkgICk7XHJcbiAgICB2YXIgbURpZmYgID0gbmV3IFZlY3RvcjJEKCBkaWZmLngvKHJ4KnJ4KSwgZGlmZi55LyhyeSpyeSkgKTtcclxuXHJcbiAgICB2YXIgYSA9IGRpci5kb3QobURpcik7XHJcbiAgICB2YXIgYiA9IGRpci5kb3QobURpZmYpO1xyXG4gICAgdmFyIGMgPSBkaWZmLmRvdChtRGlmZikgLSAxLjA7XHJcbiAgICB2YXIgZCA9IGIqYiAtIGEqYztcclxuXHJcbiAgICBpZiAoIGQgPCAwICkge1xyXG4gICAgICAgIHJlc3VsdCA9IG5ldyBJbnRlcnNlY3Rpb24oXCJPdXRzaWRlXCIpO1xyXG4gICAgfSBlbHNlIGlmICggZCA+IDAgKSB7XHJcbiAgICAgICAgdmFyIHJvb3QgPSBNYXRoLnNxcnQoZCk7XHJcbiAgICAgICAgdmFyIHRfYSAgPSAoLWIgLSByb290KSAvIGE7XHJcbiAgICAgICAgdmFyIHRfYiAgPSAoLWIgKyByb290KSAvIGE7XHJcblxyXG4gICAgICAgIGlmICggKHRfYSA8IDAgfHwgMSA8IHRfYSkgJiYgKHRfYiA8IDAgfHwgMSA8IHRfYikgKSB7XHJcbiAgICAgICAgICAgIGlmICggKHRfYSA8IDAgJiYgdF9iIDwgMCkgfHwgKHRfYSA+IDEgJiYgdF9iID4gMSkgKVxyXG4gICAgICAgICAgICAgICAgcmVzdWx0ID0gbmV3IEludGVyc2VjdGlvbihcIk91dHNpZGVcIik7XHJcbiAgICAgICAgICAgIGVsc2VcclxuICAgICAgICAgICAgICAgIHJlc3VsdCA9IG5ldyBJbnRlcnNlY3Rpb24oXCJJbnNpZGVcIik7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgcmVzdWx0ID0gbmV3IEludGVyc2VjdGlvbihcIkludGVyc2VjdGlvblwiKTtcclxuICAgICAgICAgICAgaWYgKCAwIDw9IHRfYSAmJiB0X2EgPD0gMSApXHJcbiAgICAgICAgICAgICAgICByZXN1bHQuYXBwZW5kUG9pbnQoIGExLmxlcnAoYTIsIHRfYSkgKTtcclxuICAgICAgICAgICAgaWYgKCAwIDw9IHRfYiAmJiB0X2IgPD0gMSApXHJcbiAgICAgICAgICAgICAgICByZXN1bHQuYXBwZW5kUG9pbnQoIGExLmxlcnAoYTIsIHRfYikgKTtcclxuICAgICAgICB9XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICAgIHZhciB0ID0gLWIvYTtcclxuICAgICAgICBpZiAoIDAgPD0gdCAmJiB0IDw9IDEgKSB7XHJcbiAgICAgICAgICAgIHJlc3VsdCA9IG5ldyBJbnRlcnNlY3Rpb24oXCJJbnRlcnNlY3Rpb25cIik7XHJcbiAgICAgICAgICAgIHJlc3VsdC5hcHBlbmRQb2ludCggYTEubGVycChhMiwgdCkgKTtcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICByZXN1bHQgPSBuZXcgSW50ZXJzZWN0aW9uKFwiT3V0c2lkZVwiKTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIHJlc3VsdDtcclxufTtcclxuXHJcblxyXG4vKipcclxuICogIGludGVyc2VjdEVsbGlwc2VQb2x5Z29uXHJcbiAqXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IGNcclxuICogIEBwYXJhbSB7TnVtYmVyfSByeFxyXG4gKiAgQHBhcmFtIHtOdW1iZXJ9IHJ5XHJcbiAqICBAcGFyYW0ge0FycmF5PFBvaW50MkQ+fSBjMlxyXG4gKiAgQHJldHVybnMge0ludGVyc2VjdGlvbn1cclxuICovXHJcbkludGVyc2VjdGlvbi5pbnRlcnNlY3RFbGxpcHNlUG9seWdvbiA9IGZ1bmN0aW9uKGMsIHJ4LCByeSwgcG9pbnRzKSB7XHJcbiAgICB2YXIgcmVzdWx0ID0gbmV3IEludGVyc2VjdGlvbihcIk5vIEludGVyc2VjdGlvblwiKTtcclxuICAgIHZhciBsZW5ndGggPSBwb2ludHMubGVuZ3RoO1xyXG5cclxuICAgIGZvciAoIHZhciBpID0gMDsgaSA8IGxlbmd0aDsgaSsrICkge1xyXG4gICAgICAgIHZhciBiMSA9IHBvaW50c1tpXTtcclxuICAgICAgICB2YXIgYjIgPSBwb2ludHNbKGkrMSkgJSBsZW5ndGhdO1xyXG4gICAgICAgIHZhciBpbnRlciA9IEludGVyc2VjdGlvbi5pbnRlcnNlY3RFbGxpcHNlTGluZShjLCByeCwgcnksIGIxLCBiMik7XHJcblxyXG4gICAgICAgIHJlc3VsdC5hcHBlbmRQb2ludHMoaW50ZXIucG9pbnRzKTtcclxuICAgIH1cclxuXHJcbiAgICBpZiAoIHJlc3VsdC5wb2ludHMubGVuZ3RoID4gMCApXHJcbiAgICAgICAgcmVzdWx0LnN0YXR1cyA9IFwiSW50ZXJzZWN0aW9uXCI7XHJcblxyXG4gICAgcmV0dXJuIHJlc3VsdDtcclxufTtcclxuXHJcblxyXG4vKipcclxuICogIGludGVyc2VjdEVsbGlwc2VSZWN0YW5nbGVcclxuICpcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gY1xyXG4gKiAgQHBhcmFtIHtOdW1iZXJ9IHJ4XHJcbiAqICBAcGFyYW0ge051bWJlcn0gcnlcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gcjFcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gcjJcclxuICogIEByZXR1cm5zIHtJbnRlcnNlY3Rpb259XHJcbiAqL1xyXG5JbnRlcnNlY3Rpb24uaW50ZXJzZWN0RWxsaXBzZVJlY3RhbmdsZSA9IGZ1bmN0aW9uKGMsIHJ4LCByeSwgcjEsIHIyKSB7XHJcbiAgICB2YXIgbWluICAgICAgICA9IHIxLm1pbihyMik7XHJcbiAgICB2YXIgbWF4ICAgICAgICA9IHIxLm1heChyMik7XHJcbiAgICB2YXIgdG9wUmlnaHQgICA9IG5ldyBQb2ludDJEKCBtYXgueCwgbWluLnkgKTtcclxuICAgIHZhciBib3R0b21MZWZ0ID0gbmV3IFBvaW50MkQoIG1pbi54LCBtYXgueSApO1xyXG5cclxuICAgIHZhciBpbnRlcjEgPSBJbnRlcnNlY3Rpb24uaW50ZXJzZWN0RWxsaXBzZUxpbmUoYywgcngsIHJ5LCBtaW4sIHRvcFJpZ2h0KTtcclxuICAgIHZhciBpbnRlcjIgPSBJbnRlcnNlY3Rpb24uaW50ZXJzZWN0RWxsaXBzZUxpbmUoYywgcngsIHJ5LCB0b3BSaWdodCwgbWF4KTtcclxuICAgIHZhciBpbnRlcjMgPSBJbnRlcnNlY3Rpb24uaW50ZXJzZWN0RWxsaXBzZUxpbmUoYywgcngsIHJ5LCBtYXgsIGJvdHRvbUxlZnQpO1xyXG4gICAgdmFyIGludGVyNCA9IEludGVyc2VjdGlvbi5pbnRlcnNlY3RFbGxpcHNlTGluZShjLCByeCwgcnksIGJvdHRvbUxlZnQsIG1pbik7XHJcblxyXG4gICAgdmFyIHJlc3VsdCA9IG5ldyBJbnRlcnNlY3Rpb24oXCJObyBJbnRlcnNlY3Rpb25cIik7XHJcblxyXG4gICAgcmVzdWx0LmFwcGVuZFBvaW50cyhpbnRlcjEucG9pbnRzKTtcclxuICAgIHJlc3VsdC5hcHBlbmRQb2ludHMoaW50ZXIyLnBvaW50cyk7XHJcbiAgICByZXN1bHQuYXBwZW5kUG9pbnRzKGludGVyMy5wb2ludHMpO1xyXG4gICAgcmVzdWx0LmFwcGVuZFBvaW50cyhpbnRlcjQucG9pbnRzKTtcclxuXHJcbiAgICBpZiAoIHJlc3VsdC5wb2ludHMubGVuZ3RoID4gMCApXHJcbiAgICAgICAgcmVzdWx0LnN0YXR1cyA9IFwiSW50ZXJzZWN0aW9uXCI7XHJcblxyXG4gICAgcmV0dXJuIHJlc3VsdDtcclxufTtcclxuXHJcblxyXG4vKipcclxuICogIGludGVyc2VjdExpbmVMaW5lXHJcbiAqXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IGExXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IGEyXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IGIxXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IGIyXHJcbiAqICBAcmV0dXJucyB7SW50ZXJzZWN0aW9ufVxyXG4gKi9cclxuSW50ZXJzZWN0aW9uLmludGVyc2VjdExpbmVMaW5lID0gZnVuY3Rpb24oYTEsIGEyLCBiMSwgYjIpIHtcclxuICAgIHZhciByZXN1bHQ7XHJcblxyXG4gICAgdmFyIHVhX3QgPSAoYjIueCAtIGIxLngpICogKGExLnkgLSBiMS55KSAtIChiMi55IC0gYjEueSkgKiAoYTEueCAtIGIxLngpO1xyXG4gICAgdmFyIHViX3QgPSAoYTIueCAtIGExLngpICogKGExLnkgLSBiMS55KSAtIChhMi55IC0gYTEueSkgKiAoYTEueCAtIGIxLngpO1xyXG4gICAgdmFyIHVfYiAgPSAoYjIueSAtIGIxLnkpICogKGEyLnggLSBhMS54KSAtIChiMi54IC0gYjEueCkgKiAoYTIueSAtIGExLnkpO1xyXG5cclxuICAgIGlmICggdV9iICE9IDAgKSB7XHJcbiAgICAgICAgdmFyIHVhID0gdWFfdCAvIHVfYjtcclxuICAgICAgICB2YXIgdWIgPSB1Yl90IC8gdV9iO1xyXG5cclxuICAgICAgICBpZiAoIDAgPD0gdWEgJiYgdWEgPD0gMSAmJiAwIDw9IHViICYmIHViIDw9IDEgKSB7XHJcbiAgICAgICAgICAgIHJlc3VsdCA9IG5ldyBJbnRlcnNlY3Rpb24oXCJJbnRlcnNlY3Rpb25cIik7XHJcbiAgICAgICAgICAgIHJlc3VsdC5wb2ludHMucHVzaChcclxuICAgICAgICAgICAgICAgIG5ldyBQb2ludDJEKFxyXG4gICAgICAgICAgICAgICAgICAgIGExLnggKyB1YSAqIChhMi54IC0gYTEueCksXHJcbiAgICAgICAgICAgICAgICAgICAgYTEueSArIHVhICogKGEyLnkgLSBhMS55KVxyXG4gICAgICAgICAgICAgICAgKVxyXG4gICAgICAgICAgICApO1xyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgIHJlc3VsdCA9IG5ldyBJbnRlcnNlY3Rpb24oXCJObyBJbnRlcnNlY3Rpb25cIik7XHJcbiAgICAgICAgfVxyXG4gICAgfSBlbHNlIHtcclxuICAgICAgICBpZiAoIHVhX3QgPT0gMCB8fCB1Yl90ID09IDAgKSB7XHJcbiAgICAgICAgICAgIHJlc3VsdCA9IG5ldyBJbnRlcnNlY3Rpb24oXCJDb2luY2lkZW50XCIpO1xyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgIHJlc3VsdCA9IG5ldyBJbnRlcnNlY3Rpb24oXCJQYXJhbGxlbFwiKTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIHJlc3VsdDtcclxufTtcclxuXHJcblxyXG4vKipcclxuICogIGludGVyc2VjdExpbmVQb2x5Z29uXHJcbiAqXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IGExXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IGEyXHJcbiAqICBAcGFyYW0ge0FycmF5PFBvaW50MkQ+fSBwb2ludHNcclxuICogIEByZXR1cm5zIHtJbnRlcnNlY3Rpb259XHJcbiAqL1xyXG5JbnRlcnNlY3Rpb24uaW50ZXJzZWN0TGluZVBvbHlnb24gPSBmdW5jdGlvbihhMSwgYTIsIHBvaW50cykge1xyXG4gICAgdmFyIHJlc3VsdCA9IG5ldyBJbnRlcnNlY3Rpb24oXCJObyBJbnRlcnNlY3Rpb25cIik7XHJcbiAgICB2YXIgbGVuZ3RoID0gcG9pbnRzLmxlbmd0aDtcclxuXHJcbiAgICBmb3IgKCB2YXIgaSA9IDA7IGkgPCBsZW5ndGg7IGkrKyApIHtcclxuICAgICAgICB2YXIgYjEgPSBwb2ludHNbaV07XHJcbiAgICAgICAgdmFyIGIyID0gcG9pbnRzWyhpKzEpICUgbGVuZ3RoXTtcclxuICAgICAgICB2YXIgaW50ZXIgPSBJbnRlcnNlY3Rpb24uaW50ZXJzZWN0TGluZUxpbmUoYTEsIGEyLCBiMSwgYjIpO1xyXG5cclxuICAgICAgICByZXN1bHQuYXBwZW5kUG9pbnRzKGludGVyLnBvaW50cyk7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKCByZXN1bHQucG9pbnRzLmxlbmd0aCA+IDAgKSByZXN1bHQuc3RhdHVzID0gXCJJbnRlcnNlY3Rpb25cIjtcclxuXHJcbiAgICByZXR1cm4gcmVzdWx0O1xyXG59O1xyXG5cclxuXHJcbi8qKlxyXG4gKiAgaW50ZXJzZWN0TGluZVJlY3RhbmdsZVxyXG4gKlxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBhMVxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBhMlxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSByMVxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSByMlxyXG4gKiAgQHJldHVybnMge0ludGVyc2VjdGlvbn1cclxuICovXHJcbkludGVyc2VjdGlvbi5pbnRlcnNlY3RMaW5lUmVjdGFuZ2xlID0gZnVuY3Rpb24oYTEsIGEyLCByMSwgcjIpIHtcclxuICAgIHZhciBtaW4gICAgICAgID0gcjEubWluKHIyKTtcclxuICAgIHZhciBtYXggICAgICAgID0gcjEubWF4KHIyKTtcclxuICAgIHZhciB0b3BSaWdodCAgID0gbmV3IFBvaW50MkQoIG1heC54LCBtaW4ueSApO1xyXG4gICAgdmFyIGJvdHRvbUxlZnQgPSBuZXcgUG9pbnQyRCggbWluLngsIG1heC55ICk7XHJcblxyXG4gICAgdmFyIGludGVyMSA9IEludGVyc2VjdGlvbi5pbnRlcnNlY3RMaW5lTGluZShtaW4sIHRvcFJpZ2h0LCBhMSwgYTIpO1xyXG4gICAgdmFyIGludGVyMiA9IEludGVyc2VjdGlvbi5pbnRlcnNlY3RMaW5lTGluZSh0b3BSaWdodCwgbWF4LCBhMSwgYTIpO1xyXG4gICAgdmFyIGludGVyMyA9IEludGVyc2VjdGlvbi5pbnRlcnNlY3RMaW5lTGluZShtYXgsIGJvdHRvbUxlZnQsIGExLCBhMik7XHJcbiAgICB2YXIgaW50ZXI0ID0gSW50ZXJzZWN0aW9uLmludGVyc2VjdExpbmVMaW5lKGJvdHRvbUxlZnQsIG1pbiwgYTEsIGEyKTtcclxuXHJcbiAgICB2YXIgcmVzdWx0ID0gbmV3IEludGVyc2VjdGlvbihcIk5vIEludGVyc2VjdGlvblwiKTtcclxuXHJcbiAgICByZXN1bHQuYXBwZW5kUG9pbnRzKGludGVyMS5wb2ludHMpO1xyXG4gICAgcmVzdWx0LmFwcGVuZFBvaW50cyhpbnRlcjIucG9pbnRzKTtcclxuICAgIHJlc3VsdC5hcHBlbmRQb2ludHMoaW50ZXIzLnBvaW50cyk7XHJcbiAgICByZXN1bHQuYXBwZW5kUG9pbnRzKGludGVyNC5wb2ludHMpO1xyXG5cclxuICAgIGlmICggcmVzdWx0LnBvaW50cy5sZW5ndGggPiAwIClcclxuICAgICAgICByZXN1bHQuc3RhdHVzID0gXCJJbnRlcnNlY3Rpb25cIjtcclxuXHJcbiAgICByZXR1cm4gcmVzdWx0O1xyXG59O1xyXG5cclxuXHJcbi8qKlxyXG4gKiAgaW50ZXJzZWN0UG9seWdvblBvbHlnb25cclxuICpcclxuICogIEBwYXJhbSB7QXJyYXk8UG9pbnQyRD59IHBvaW50czFcclxuICogIEBwYXJhbSB7QXJyYXk8UG9pbnQyRD59IHBvaW50czJcclxuICogIEByZXR1cm5zIHtJbnRlcnNlY3Rpb259XHJcbiAqL1xyXG5JbnRlcnNlY3Rpb24uaW50ZXJzZWN0UG9seWdvblBvbHlnb24gPSBmdW5jdGlvbihwb2ludHMxLCBwb2ludHMyKSB7XHJcbiAgICB2YXIgcmVzdWx0ID0gbmV3IEludGVyc2VjdGlvbihcIk5vIEludGVyc2VjdGlvblwiKTtcclxuICAgIHZhciBsZW5ndGggPSBwb2ludHMxLmxlbmd0aDtcclxuXHJcbiAgICBmb3IgKCB2YXIgaSA9IDA7IGkgPCBsZW5ndGg7IGkrKyApIHtcclxuICAgICAgICB2YXIgYTEgPSBwb2ludHMxW2ldO1xyXG4gICAgICAgIHZhciBhMiA9IHBvaW50czFbKGkrMSkgJSBsZW5ndGhdO1xyXG4gICAgICAgIHZhciBpbnRlciA9IEludGVyc2VjdGlvbi5pbnRlcnNlY3RMaW5lUG9seWdvbihhMSwgYTIsIHBvaW50czIpO1xyXG5cclxuICAgICAgICByZXN1bHQuYXBwZW5kUG9pbnRzKGludGVyLnBvaW50cyk7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKCByZXN1bHQucG9pbnRzLmxlbmd0aCA+IDAgKVxyXG4gICAgICAgIHJlc3VsdC5zdGF0dXMgPSBcIkludGVyc2VjdGlvblwiO1xyXG5cclxuICAgIHJldHVybiByZXN1bHQ7XHJcblxyXG59O1xyXG5cclxuXHJcbi8qKlxyXG4gKiAgaW50ZXJzZWN0UG9seWdvblJlY3RhbmdsZVxyXG4gKlxyXG4gKiAgQHBhcmFtIHtBcnJheTxQb2ludDJEPn0gcG9pbnRzXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IHIxXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IHIyXHJcbiAqICBAcmV0dXJucyB7SW50ZXJzZWN0aW9ufVxyXG4gKi9cclxuSW50ZXJzZWN0aW9uLmludGVyc2VjdFBvbHlnb25SZWN0YW5nbGUgPSBmdW5jdGlvbihwb2ludHMsIHIxLCByMikge1xyXG4gICAgdmFyIG1pbiAgICAgICAgPSByMS5taW4ocjIpO1xyXG4gICAgdmFyIG1heCAgICAgICAgPSByMS5tYXgocjIpO1xyXG4gICAgdmFyIHRvcFJpZ2h0ICAgPSBuZXcgUG9pbnQyRCggbWF4LngsIG1pbi55ICk7XHJcbiAgICB2YXIgYm90dG9tTGVmdCA9IG5ldyBQb2ludDJEKCBtaW4ueCwgbWF4LnkgKTtcclxuXHJcbiAgICB2YXIgaW50ZXIxID0gSW50ZXJzZWN0aW9uLmludGVyc2VjdExpbmVQb2x5Z29uKG1pbiwgdG9wUmlnaHQsIHBvaW50cyk7XHJcbiAgICB2YXIgaW50ZXIyID0gSW50ZXJzZWN0aW9uLmludGVyc2VjdExpbmVQb2x5Z29uKHRvcFJpZ2h0LCBtYXgsIHBvaW50cyk7XHJcbiAgICB2YXIgaW50ZXIzID0gSW50ZXJzZWN0aW9uLmludGVyc2VjdExpbmVQb2x5Z29uKG1heCwgYm90dG9tTGVmdCwgcG9pbnRzKTtcclxuICAgIHZhciBpbnRlcjQgPSBJbnRlcnNlY3Rpb24uaW50ZXJzZWN0TGluZVBvbHlnb24oYm90dG9tTGVmdCwgbWluLCBwb2ludHMpO1xyXG5cclxuICAgIHZhciByZXN1bHQgPSBuZXcgSW50ZXJzZWN0aW9uKFwiTm8gSW50ZXJzZWN0aW9uXCIpO1xyXG5cclxuICAgIHJlc3VsdC5hcHBlbmRQb2ludHMoaW50ZXIxLnBvaW50cyk7XHJcbiAgICByZXN1bHQuYXBwZW5kUG9pbnRzKGludGVyMi5wb2ludHMpO1xyXG4gICAgcmVzdWx0LmFwcGVuZFBvaW50cyhpbnRlcjMucG9pbnRzKTtcclxuICAgIHJlc3VsdC5hcHBlbmRQb2ludHMoaW50ZXI0LnBvaW50cyk7XHJcblxyXG4gICAgaWYgKCByZXN1bHQucG9pbnRzLmxlbmd0aCA+IDAgKVxyXG4gICAgICAgIHJlc3VsdC5zdGF0dXMgPSBcIkludGVyc2VjdGlvblwiO1xyXG5cclxuICAgIHJldHVybiByZXN1bHQ7XHJcbn07XHJcblxyXG5cclxuLyoqXHJcbiAqICBpbnRlcnNlY3RSYXlSYXlcclxuICpcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gYTFcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gYTJcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gYjFcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gYjJcclxuICogIEByZXR1cm5zIHtJbnRlcnNlY3Rpb259XHJcbiAqL1xyXG5JbnRlcnNlY3Rpb24uaW50ZXJzZWN0UmF5UmF5ID0gZnVuY3Rpb24oYTEsIGEyLCBiMSwgYjIpIHtcclxuICAgIHZhciByZXN1bHQ7XHJcblxyXG4gICAgdmFyIHVhX3QgPSAoYjIueCAtIGIxLngpICogKGExLnkgLSBiMS55KSAtIChiMi55IC0gYjEueSkgKiAoYTEueCAtIGIxLngpO1xyXG4gICAgdmFyIHViX3QgPSAoYTIueCAtIGExLngpICogKGExLnkgLSBiMS55KSAtIChhMi55IC0gYTEueSkgKiAoYTEueCAtIGIxLngpO1xyXG4gICAgdmFyIHVfYiAgPSAoYjIueSAtIGIxLnkpICogKGEyLnggLSBhMS54KSAtIChiMi54IC0gYjEueCkgKiAoYTIueSAtIGExLnkpO1xyXG5cclxuICAgIGlmICggdV9iICE9IDAgKSB7XHJcbiAgICAgICAgdmFyIHVhID0gdWFfdCAvIHVfYjtcclxuXHJcbiAgICAgICAgcmVzdWx0ID0gbmV3IEludGVyc2VjdGlvbihcIkludGVyc2VjdGlvblwiKTtcclxuICAgICAgICByZXN1bHQucG9pbnRzLnB1c2goXHJcbiAgICAgICAgICAgIG5ldyBQb2ludDJEKFxyXG4gICAgICAgICAgICAgICAgYTEueCArIHVhICogKGEyLnggLSBhMS54KSxcclxuICAgICAgICAgICAgICAgIGExLnkgKyB1YSAqIChhMi55IC0gYTEueSlcclxuICAgICAgICAgICAgKVxyXG4gICAgICAgICk7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICAgIGlmICggdWFfdCA9PSAwIHx8IHViX3QgPT0gMCApIHtcclxuICAgICAgICAgICAgcmVzdWx0ID0gbmV3IEludGVyc2VjdGlvbihcIkNvaW5jaWRlbnRcIik7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgcmVzdWx0ID0gbmV3IEludGVyc2VjdGlvbihcIlBhcmFsbGVsXCIpO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gcmVzdWx0O1xyXG59O1xyXG5cclxuXHJcbi8qKlxyXG4gKiAgaW50ZXJzZWN0UmVjdGFuZ2xlUmVjdGFuZ2xlXHJcbiAqXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IGExXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IGEyXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IGIxXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IGIyXHJcbiAqICBAcmV0dXJucyB7SW50ZXJzZWN0aW9ufVxyXG4gKi9cclxuSW50ZXJzZWN0aW9uLmludGVyc2VjdFJlY3RhbmdsZVJlY3RhbmdsZSA9IGZ1bmN0aW9uKGExLCBhMiwgYjEsIGIyKSB7XHJcbiAgICB2YXIgbWluICAgICAgICA9IGExLm1pbihhMik7XHJcbiAgICB2YXIgbWF4ICAgICAgICA9IGExLm1heChhMik7XHJcbiAgICB2YXIgdG9wUmlnaHQgICA9IG5ldyBQb2ludDJEKCBtYXgueCwgbWluLnkgKTtcclxuICAgIHZhciBib3R0b21MZWZ0ID0gbmV3IFBvaW50MkQoIG1pbi54LCBtYXgueSApO1xyXG5cclxuICAgIHZhciBpbnRlcjEgPSBJbnRlcnNlY3Rpb24uaW50ZXJzZWN0TGluZVJlY3RhbmdsZShtaW4sIHRvcFJpZ2h0LCBiMSwgYjIpO1xyXG4gICAgdmFyIGludGVyMiA9IEludGVyc2VjdGlvbi5pbnRlcnNlY3RMaW5lUmVjdGFuZ2xlKHRvcFJpZ2h0LCBtYXgsIGIxLCBiMik7XHJcbiAgICB2YXIgaW50ZXIzID0gSW50ZXJzZWN0aW9uLmludGVyc2VjdExpbmVSZWN0YW5nbGUobWF4LCBib3R0b21MZWZ0LCBiMSwgYjIpO1xyXG4gICAgdmFyIGludGVyNCA9IEludGVyc2VjdGlvbi5pbnRlcnNlY3RMaW5lUmVjdGFuZ2xlKGJvdHRvbUxlZnQsIG1pbiwgYjEsIGIyKTtcclxuXHJcbiAgICB2YXIgcmVzdWx0ID0gbmV3IEludGVyc2VjdGlvbihcIk5vIEludGVyc2VjdGlvblwiKTtcclxuXHJcbiAgICByZXN1bHQuYXBwZW5kUG9pbnRzKGludGVyMS5wb2ludHMpO1xyXG4gICAgcmVzdWx0LmFwcGVuZFBvaW50cyhpbnRlcjIucG9pbnRzKTtcclxuICAgIHJlc3VsdC5hcHBlbmRQb2ludHMoaW50ZXIzLnBvaW50cyk7XHJcbiAgICByZXN1bHQuYXBwZW5kUG9pbnRzKGludGVyNC5wb2ludHMpO1xyXG5cclxuICAgIGlmICggcmVzdWx0LnBvaW50cy5sZW5ndGggPiAwIClcclxuICAgICAgICByZXN1bHQuc3RhdHVzID0gXCJJbnRlcnNlY3Rpb25cIjtcclxuXHJcbiAgICByZXR1cm4gcmVzdWx0O1xyXG59O1xyXG5cclxuXHJcbi8qKlxyXG4gKiAgYmV6b3V0XHJcbiAqXHJcbiAqICBUaGlzIGNvZGUgaXMgYmFzZWQgb24gTWdjSW50cjJERWxwRWxwLmNwcCB3cml0dGVuIGJ5IERhdmlkIEViZXJseS4gIEhpc1xyXG4gKiAgY29kZSBhbG9uZyB3aXRoIG1hbnkgb3RoZXIgZXhjZWxsZW50IGV4YW1wbGVzIGFyZSBhdmFpYWJsZSBhdCBoaXMgc2l0ZTpcclxuICogIGh0dHA6Ly93d3cubWFnaWMtc29mdHdhcmUuY29tXHJcbiAqXHJcbiAqICBAcGFyYW0ge0FycmF5PFBvaW50MkQ+fSBlMVxyXG4gKiAgQHBhcmFtIHtBcnJheTxQb2ludDJEPn0gZTJcclxuICogIEByZXR1cm5zIHtQb2x5bm9taWFsfVxyXG4gKi9cclxuSW50ZXJzZWN0aW9uLmJlem91dCA9IGZ1bmN0aW9uKGUxLCBlMikge1xyXG4gICAgdmFyIEFCICAgID0gZTFbMF0qZTJbMV0gLSBlMlswXSplMVsxXTtcclxuICAgIHZhciBBQyAgICA9IGUxWzBdKmUyWzJdIC0gZTJbMF0qZTFbMl07XHJcbiAgICB2YXIgQUQgICAgPSBlMVswXSplMlszXSAtIGUyWzBdKmUxWzNdO1xyXG4gICAgdmFyIEFFICAgID0gZTFbMF0qZTJbNF0gLSBlMlswXSplMVs0XTtcclxuICAgIHZhciBBRiAgICA9IGUxWzBdKmUyWzVdIC0gZTJbMF0qZTFbNV07XHJcbiAgICB2YXIgQkMgICAgPSBlMVsxXSplMlsyXSAtIGUyWzFdKmUxWzJdO1xyXG4gICAgdmFyIEJFICAgID0gZTFbMV0qZTJbNF0gLSBlMlsxXSplMVs0XTtcclxuICAgIHZhciBCRiAgICA9IGUxWzFdKmUyWzVdIC0gZTJbMV0qZTFbNV07XHJcbiAgICB2YXIgQ0QgICAgPSBlMVsyXSplMlszXSAtIGUyWzJdKmUxWzNdO1xyXG4gICAgdmFyIERFICAgID0gZTFbM10qZTJbNF0gLSBlMlszXSplMVs0XTtcclxuICAgIHZhciBERiAgICA9IGUxWzNdKmUyWzVdIC0gZTJbM10qZTFbNV07XHJcbiAgICB2YXIgQkZwREUgPSBCRiArIERFO1xyXG4gICAgdmFyIEJFbUNEID0gQkUgLSBDRDtcclxuXHJcbiAgICByZXR1cm4gbmV3IFBvbHlub21pYWwoXHJcbiAgICAgICAgQUIqQkMgLSBBQypBQyxcclxuICAgICAgICBBQipCRW1DRCArIEFEKkJDIC0gMipBQypBRSxcclxuICAgICAgICBBQipCRnBERSArIEFEKkJFbUNEIC0gQUUqQUUgLSAyKkFDKkFGLFxyXG4gICAgICAgIEFCKkRGICsgQUQqQkZwREUgLSAyKkFFKkFGLFxyXG4gICAgICAgIEFEKkRGIC0gQUYqQUZcclxuICAgICk7XHJcbn07XHJcblxyXG5pZiAodHlwZW9mIG1vZHVsZSAhPT0gXCJ1bmRlZmluZWRcIikge1xyXG4gICAgbW9kdWxlLmV4cG9ydHMgPSBJbnRlcnNlY3Rpb247XHJcbn1cclxuIiwiLyoqXHJcbiAqXHJcbiAqICAgSW50ZXJzZWN0aW9uUGFyYW1zLmpzXHJcbiAqXHJcbiAqICAgY29weXJpZ2h0IDIwMDIsIEtldmluIExpbmRzZXlcclxuICpcclxuICovXHJcblxyXG4vKipcclxuICogIEludGVyc2VjdGlvblBhcmFtc1xyXG4gKlxyXG4gKiAgQHBhcmFtIHtTdHJpbmd9IG5hbWVcclxuICogIEBwYXJhbSB7QXJyYXk8UG9pbnQyRH0gcGFyYW1zXHJcbiAqICBAcmV0dXJucyB7SW50ZXJzZWN0aW9uUGFyYW1zfVxyXG4gKi9cclxuZnVuY3Rpb24gSW50ZXJzZWN0aW9uUGFyYW1zKG5hbWUsIHBhcmFtcykge1xyXG4gICAgdGhpcy5pbml0KG5hbWUsIHBhcmFtcyk7XHJcbn1cclxuXHJcbi8qKlxyXG4gKiAgaW5pdFxyXG4gKlxyXG4gKiAgQHBhcmFtIHtTdHJpbmd9IG5hbWVcclxuICogIEBwYXJhbSB7QXJyYXk8UG9pbnQyRD59IHBhcmFtc1xyXG4gKi9cclxuSW50ZXJzZWN0aW9uUGFyYW1zLnByb3RvdHlwZS5pbml0ID0gZnVuY3Rpb24obmFtZSwgcGFyYW1zKSB7XHJcbiAgICB0aGlzLm5hbWUgICA9IG5hbWU7XHJcbiAgICB0aGlzLnBhcmFtcyA9IHBhcmFtcztcclxufTtcclxuXHJcbmlmICh0eXBlb2YgbW9kdWxlICE9PSBcInVuZGVmaW5lZFwiKSB7XHJcbiAgICBtb2R1bGUuZXhwb3J0cyA9IEludGVyc2VjdGlvblBhcmFtcztcclxufSIsIi8vIGV4cG9zZSBjbGFzc2VzXG5cbmV4cG9ydHMuUG9pbnQyRCA9IHJlcXVpcmUoJy4vbGliL1BvaW50MkQnKTtcbmV4cG9ydHMuVmVjdG9yMkQgPSByZXF1aXJlKCcuL2xpYi9WZWN0b3IyRCcpO1xuZXhwb3J0cy5NYXRyaXgyRCA9IHJlcXVpcmUoJy4vbGliL01hdHJpeDJEJyk7XG4iLCIvKipcbiAqXG4gKiAgIE1hdHJpeDJELmpzXG4gKlxuICogICBjb3B5cmlnaHQgMjAwMS0yMDAyLCAyMDEzIEtldmluIExpbmRzZXlcbiAqXG4gKi9cblxuLyoqXG4gKiAgTWF0cml4MkRcbiAqXG4gKiAgQHBhcmFtIHtOdW1iZXJ9IGFcbiAqICBAcGFyYW0ge051bWJlcn0gYlxuICogIEBwYXJhbSB7TnVtYmVyfSBjXG4gKiAgQHBhcmFtIHtOdW1iZXJ9IGRcbiAqICBAcGFyYW0ge051bWJlcn0gZVxuICogIEBwYXJhbSB7TnVtYmVyfSBmXG4gKiAgQHJldHVybnMge01hdHJpeDJEfVxuICovXG5mdW5jdGlvbiBNYXRyaXgyRChhLCBiLCBjLCBkLCBlLCBmKSB7XG4gICAgT2JqZWN0LmRlZmluZVByb3BlcnRpZXModGhpcywge1xuICAgICAgICBcImFcIjoge1xuICAgICAgICAgICAgdmFsdWU6IChhICE9PSB1bmRlZmluZWQpID8gYSA6IDEsXG4gICAgICAgICAgICB3cml0YWJsZTogZmFsc2UsXG4gICAgICAgICAgICBlbnVtZXJhYmxlOiB0cnVlLFxuICAgICAgICAgICAgY29uZmlndXJhYmxlOiBmYWxzZVxuICAgICAgICB9LFxuICAgICAgICBcImJcIjoge1xuICAgICAgICAgICAgdmFsdWU6IChiICE9PSB1bmRlZmluZWQpID8gYiA6IDAsXG4gICAgICAgICAgICB3cml0YWJsZTogZmFsc2UsXG4gICAgICAgICAgICBlbnVtZXJhYmxlOiB0cnVlLFxuICAgICAgICAgICAgY29uZmlndXJhYmxlOiBmYWxzZVxuICAgICAgICB9LFxuICAgICAgICBcImNcIjoge1xuICAgICAgICAgICAgdmFsdWU6IChjICE9PSB1bmRlZmluZWQpID8gYyA6IDAsXG4gICAgICAgICAgICB3cml0YWJsZTogZmFsc2UsXG4gICAgICAgICAgICBlbnVtZXJhYmxlOiB0cnVlLFxuICAgICAgICAgICAgY29uZmlndXJhYmxlOiBmYWxzZVxuICAgICAgICB9LFxuICAgICAgICBcImRcIjoge1xuICAgICAgICAgICAgdmFsdWU6IChkICE9PSB1bmRlZmluZWQpID8gZCA6IDEsXG4gICAgICAgICAgICB3cml0YWJsZTogZmFsc2UsXG4gICAgICAgICAgICBlbnVtZXJhYmxlOiB0cnVlLFxuICAgICAgICAgICAgY29uZmlndXJhYmxlOiBmYWxzZVxuICAgICAgICB9LFxuICAgICAgICBcImVcIjoge1xuICAgICAgICAgICAgdmFsdWU6IChlICE9PSB1bmRlZmluZWQpID8gZSA6IDAsXG4gICAgICAgICAgICB3cml0YWJsZTogZmFsc2UsXG4gICAgICAgICAgICBlbnVtZXJhYmxlOiB0cnVlLFxuICAgICAgICAgICAgY29uZmlndXJhYmxlOiBmYWxzZVxuICAgICAgICB9LFxuICAgICAgICBcImZcIjoge1xuICAgICAgICAgICAgdmFsdWU6IChmICE9PSB1bmRlZmluZWQpID8gZiA6IDAsXG4gICAgICAgICAgICB3cml0YWJsZTogZmFsc2UsXG4gICAgICAgICAgICBlbnVtZXJhYmxlOiB0cnVlLFxuICAgICAgICAgICAgY29uZmlndXJhYmxlOiBmYWxzZVxuICAgICAgICB9XG4gICAgfSk7XG4gICAgLy8gdGhpcy5hID0gKGEgIT09IHVuZGVmaW5lZCkgPyBhIDogMTtcbiAgICAvLyB0aGlzLmIgPSAoYiAhPT0gdW5kZWZpbmVkKSA/IGIgOiAwO1xuICAgIC8vIHRoaXMuYyA9IChjICE9PSB1bmRlZmluZWQpID8gYyA6IDA7XG4gICAgLy8gdGhpcy5kID0gKGQgIT09IHVuZGVmaW5lZCkgPyBkIDogMTtcbiAgICAvLyB0aGlzLmUgPSAoZSAhPT0gdW5kZWZpbmVkKSA/IGUgOiAwO1xuICAgIC8vIHRoaXMuZiA9IChmICE9PSB1bmRlZmluZWQpID8gZiA6IDA7XG59XG5cbi8qKlxuICogIElkZW50aXR5IG1hdHJpeFxuICpcbiAqICBAcmV0dXJucyB7TWF0cml4MkR9XG4gKi9cbk1hdHJpeDJELklERU5USVRZID0gbmV3IE1hdHJpeDJEKDEsIDAsIDAsIDEsIDAsIDApO1xuXG4vLyBUT0RPOiByb3RhdGUsIHNrZXcsIGV0Yy4gbWF0cmljZXMgYXMgd2VsbD9cblxuLyoqXG4gKiAgbXVsdGlwbHlcbiAqXG4gKiAgQHBhcmFybSB7TWF0cml4MkR9IHRoYXRcbiAqICBAcmV0dXJucyB7TWF0cml4MkR9XG4gKi9cbk1hdHJpeDJELnByb3RvdHlwZS5tdWx0aXBseSA9IGZ1bmN0aW9uKHRoYXQpIHtcbiAgICByZXR1cm4gbmV3IE1hdHJpeDJEKFxuICAgICAgICB0aGlzLmEgKiB0aGF0LmEgKyB0aGlzLmMgKiB0aGF0LmIsXG4gICAgICAgIHRoaXMuYiAqIHRoYXQuYSArIHRoaXMuZCAqIHRoYXQuYixcbiAgICAgICAgdGhpcy5hICogdGhhdC5jICsgdGhpcy5jICogdGhhdC5kLFxuICAgICAgICB0aGlzLmIgKiB0aGF0LmMgKyB0aGlzLmQgKiB0aGF0LmQsXG4gICAgICAgIHRoaXMuYSAqIHRoYXQuZSArIHRoaXMuYyAqIHRoYXQuZiArIHRoaXMuZSxcbiAgICAgICAgdGhpcy5iICogdGhhdC5lICsgdGhpcy5kICogdGhhdC5mICsgdGhpcy5mXG4gICAgKTtcbn07XG5cbi8qKlxuICogIGludmVyc2VcbiAqXG4gKiAgQHJldHVybnMge01hdHJpeDJEfVxuICovXG5NYXRyaXgyRC5wcm90b3R5cGUuaW52ZXJzZSA9IGZ1bmN0aW9uKCkge1xuICAgIHZhciBkZXQxID0gdGhpcy5hICogdGhpcy5kIC0gdGhpcy5iICogdGhpcy5jO1xuXG4gICAgaWYgKCBkZXQxID09IDAuMCApXG4gICAgICAgIHRocm93KFwiTWF0cml4IGlzIG5vdCBpbnZlcnRpYmxlXCIpO1xuXG4gICAgdmFyIGlkZXQgPSAxLjAgLyBkZXQxO1xuICAgIHZhciBkZXQyID0gdGhpcy5mICogdGhpcy5jIC0gdGhpcy5lICogdGhpcy5kO1xuICAgIHZhciBkZXQzID0gdGhpcy5lICogdGhpcy5iIC0gdGhpcy5mICogdGhpcy5hO1xuXG4gICAgcmV0dXJuIG5ldyBNYXRyaXgyRChcbiAgICAgICAgdGhpcy5kICogaWRldCxcbiAgICAgICAtdGhpcy5iICogaWRldCxcbiAgICAgICAtdGhpcy5jICogaWRldCxcbiAgICAgICAgdGhpcy5hICogaWRldCxcbiAgICAgICAgICBkZXQyICogaWRldCxcbiAgICAgICAgICBkZXQzICogaWRldFxuICAgICk7XG59O1xuXG4vKipcbiAqICB0cmFuc2xhdGVcbiAqXG4gKiAgQHBhcmFtIHtOdW1iZXJ9IHR4XG4gKiAgQHBhcmFtIHtOdW1iZXJ9IHR5XG4gKiAgQHJldHVybnMge01hdHJpeDJEfVxuICovXG5NYXRyaXgyRC5wcm90b3R5cGUudHJhbnNsYXRlID0gZnVuY3Rpb24odHgsIHR5KSB7XG4gICAgcmV0dXJuIG5ldyBNYXRyaXgyRChcbiAgICAgICAgdGhpcy5hLFxuICAgICAgICB0aGlzLmIsXG4gICAgICAgIHRoaXMuYyxcbiAgICAgICAgdGhpcy5kLFxuICAgICAgICB0aGlzLmEgKiB0eCArIHRoaXMuYyAqIHR5ICsgdGhpcy5lLFxuICAgICAgICB0aGlzLmIgKiB0eCArIHRoaXMuZCAqIHR5ICsgdGhpcy5mXG4gICAgKTtcbn07XG5cbi8qKlxuICogIHNjYWxlXG4gKlxuICogIEBwYXJhbSB7TnVtYmVyfSBzY2FsZVxuICogIEByZXR1cm5zIHtNYXRyaXgyRH1cbiAqL1xuTWF0cml4MkQucHJvdG90eXBlLnNjYWxlID0gZnVuY3Rpb24oc2NhbGUpIHtcbiAgICByZXR1cm4gbmV3IE1hdHJpeDJEKFxuICAgICAgICB0aGlzLmEgKiBzY2FsZSxcbiAgICAgICAgdGhpcy5iICogc2NhbGUsXG4gICAgICAgIHRoaXMuYyAqIHNjYWxlLFxuICAgICAgICB0aGlzLmQgKiBzY2FsZSxcbiAgICAgICAgdGhpcy5lLFxuICAgICAgICB0aGlzLmZcbiAgICApO1xufTtcblxuLyoqXG4gKiAgc2NhbGVBdFxuICpcbiAqICBAcGFyYW0ge051bWJlcn0gc2NhbGVcbiAqICBAcGFyYW0ge1BvaW50MkR9IGNlbnRlclxuICogIEByZXR1cm5zIHtNYXRyaXgyRH1cbiAqL1xuTWF0cml4MkQucHJvdG90eXBlLnNjYWxlQXQgPSBmdW5jdGlvbihzY2FsZSwgY2VudGVyKSB7XG4gICAgdmFyIGR4ID0gY2VudGVyLnggLSBzY2FsZSAqIGNlbnRlci54O1xuICAgIHZhciBkeSA9IGNlbnRlci55IC0gc2NhbGUgKiBjZW50ZXIueTtcblxuICAgIHJldHVybiBuZXcgTWF0cml4MkQoXG4gICAgICAgIHRoaXMuYSAqIHNjYWxlLFxuICAgICAgICB0aGlzLmIgKiBzY2FsZSxcbiAgICAgICAgdGhpcy5jICogc2NhbGUsXG4gICAgICAgIHRoaXMuZCAqIHNjYWxlLFxuICAgICAgICB0aGlzLmEgKiBkeCArIHRoaXMuYyAqIGR5ICsgdGhpcy5lLFxuICAgICAgICB0aGlzLmIgKiBkeCArIHRoaXMuZCAqIGR5ICsgdGhpcy5mXG4gICAgKTtcbn07XG5cbi8qKlxuICogIHNjYWxlTm9uVW5pZm9ybVxuICpcbiAqICBAcGFyYW0ge051bWJlcn0gc2NhbGVYXG4gKiAgQHBhcmFtIHtOdW1iZXJ9IHNjYWxlWVxuICogIEByZXR1cm5zIHtNYXRyaXgyRH1cbiAqL1xuTWF0cml4MkQucHJvdG90eXBlLnNjYWxlTm9uVW5pZm9ybSA9IGZ1bmN0aW9uKHNjYWxlWCwgc2NhbGVZKSB7XG4gICAgcmV0dXJuIG5ldyBNYXRyaXgyRChcbiAgICAgICAgdGhpcy5hICogc2NhbGVYLFxuICAgICAgICB0aGlzLmIgKiBzY2FsZVgsXG4gICAgICAgIHRoaXMuYyAqIHNjYWxlWSxcbiAgICAgICAgdGhpcy5kICogc2NhbGVZLFxuICAgICAgICB0aGlzLmUsXG4gICAgICAgIHRoaXMuZlxuICAgICk7XG59O1xuXG4vKipcbiAqICBzY2FsZU5vblVuaWZvcm1BdFxuICpcbiAqICBAcGFyYW0ge051bWJlcn0gc2NhbGVYXG4gKiAgQHBhcmFtIHtOdW1iZXJ9IHNjYWxlWVxuICogIEBwYXJhbSB7UG9pbnQyRH0gY2VudGVyXG4gKiAgQHJldHVybnMge01hdHJpeDJEfVxuICovXG5NYXRyaXgyRC5wcm90b3R5cGUuc2NhbGVOb25Vbmlmb3JtQXQgPSBmdW5jdGlvbihzY2FsZVgsIHNjYWxlWSwgY2VudGVyKSB7XG4gICAgdmFyIGR4ID0gY2VudGVyLnggLSBzY2FsZVggKiBjZW50ZXIueDtcbiAgICB2YXIgZHkgPSBjZW50ZXIueSAtIHNjYWxlWSAqIGNlbnRlci55O1xuXG4gICAgcmV0dXJuIG5ldyBNYXRyaXgyRChcbiAgICAgICAgdGhpcy5hICogc2NhbGVYLFxuICAgICAgICB0aGlzLmIgKiBzY2FsZVgsXG4gICAgICAgIHRoaXMuYyAqIHNjYWxlWSxcbiAgICAgICAgdGhpcy5kICogc2NhbGVZLFxuICAgICAgICB0aGlzLmEgKiBkeCArIHRoaXMuYyAqIGR5ICsgdGhpcy5lLFxuICAgICAgICB0aGlzLmIgKiBkeCArIHRoaXMuZCAqIGR5ICsgdGhpcy5mXG4gICAgKTtcbn07XG5cbi8qKlxuICogIHJvdGF0ZVxuICpcbiAqICBAcGFyYW0ge051bWJlcn0gcmFkaWFuc1xuICogIEByZXR1cm5zIHtNYXRyaXgyRH1cbiAqL1xuTWF0cml4MkQucHJvdG90eXBlLnJvdGF0ZSA9IGZ1bmN0aW9uKHJhZGlhbnMpIHtcbiAgICB2YXIgYyA9IE1hdGguY29zKHJhZGlhbnMpO1xuICAgIHZhciBzID0gTWF0aC5zaW4ocmFkaWFucyk7XG5cbiAgICByZXR1cm4gbmV3IE1hdHJpeDJEKFxuICAgICAgICB0aGlzLmEgKiAgYyArIHRoaXMuYyAqIHMsXG4gICAgICAgIHRoaXMuYiAqICBjICsgdGhpcy5kICogcyxcbiAgICAgICAgdGhpcy5hICogLXMgKyB0aGlzLmMgKiBjLFxuICAgICAgICB0aGlzLmIgKiAtcyArIHRoaXMuZCAqIGMsXG4gICAgICAgIHRoaXMuZSxcbiAgICAgICAgdGhpcy5mXG4gICAgKTtcbn07XG5cbi8qKlxuICogIHJvdGF0ZUF0XG4gKlxuICogIEBwYXJhbSB7TnVtYmVyfSByYWRpYW5zXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBjZW50ZXJcbiAqICBAcmVzdWx0IHtNYXRyaXgyRH1cbiAqL1xuTWF0cml4MkQucHJvdG90eXBlLnJvdGF0ZUF0ID0gZnVuY3Rpb24ocmFkaWFucywgY2VudGVyKSB7XG4gICAgdmFyIGMgPSBNYXRoLmNvcyhyYWRpYW5zKTtcbiAgICB2YXIgcyA9IE1hdGguc2luKHJhZGlhbnMpO1xuICAgIHZhciB0MSA9IC1jZW50ZXIueCArIGNlbnRlci54ICogYyAtIGNlbnRlci55ICogcztcbiAgICB2YXIgdDIgPSAtY2VudGVyLnkgKyBjZW50ZXIueSAqIGMgKyBjZW50ZXIueCAqIHM7XG5cbiAgICByZXR1cm4gbmV3IE1hdHJpeDJEKFxuICAgICAgICB0aGlzLmEgKiAgYyArIHRoaXMuYyAqIHMsXG4gICAgICAgIHRoaXMuYiAqICBjICsgdGhpcy5kICogcyxcbiAgICAgICAgdGhpcy5hICogLXMgKyB0aGlzLmMgKiBjLFxuICAgICAgICB0aGlzLmIgKiAtcyArIHRoaXMuZCAqIGMsXG4gICAgICAgIHRoaXMuYSAqIHQxICsgdGhpcy5jICogdDIgKyB0aGlzLmUsXG4gICAgICAgIHRoaXMuYiAqIHQxICsgdGhpcy5kICogdDIgKyB0aGlzLmZcbiAgICApO1xufTtcblxuLyoqXG4gKiAgcm90YXRlRnJvbVZlY3RvclxuICpcbiAqICBAcGFyYW0ge1ZlY3RvcjJEfVxuICogIEByZXR1cm5zIHtNYXRyaXgyRH1cbiAqL1xuTWF0cml4MkQucHJvdG90eXBlLnJvdGF0ZUZyb21WZWN0b3IgPSBmdW5jdGlvbih2ZWN0b3IpIHtcbiAgICB2YXIgdW5pdCA9IHZlY3Rvci51bml0KCk7XG4gICAgdmFyIGMgPSB1bml0Lng7IC8vIGNvc1xuICAgIHZhciBzID0gdW5pdC55OyAvLyBzaW5cblxuICAgIHJldHVybiBuZXcgTWF0cml4MkQoXG4gICAgICAgIHRoaXMuYSAqICBjICsgdGhpcy5jICogcyxcbiAgICAgICAgdGhpcy5iICogIGMgKyB0aGlzLmQgKiBzLFxuICAgICAgICB0aGlzLmEgKiAtcyArIHRoaXMuYyAqIGMsXG4gICAgICAgIHRoaXMuYiAqIC1zICsgdGhpcy5kICogYyxcbiAgICAgICAgdGhpcy5lLFxuICAgICAgICB0aGlzLmZcbiAgICApO1xufTtcblxuLyoqXG4gKiAgZmxpcFhcbiAqXG4gKiAgQHJldHVybnMge01hdHJpeDJEfVxuICovXG5NYXRyaXgyRC5wcm90b3R5cGUuZmxpcFggPSBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gbmV3IE1hdHJpeDJEKFxuICAgICAgICAtdGhpcy5hLFxuICAgICAgICAtdGhpcy5iLFxuICAgICAgICAgdGhpcy5jLFxuICAgICAgICAgdGhpcy5kLFxuICAgICAgICAgdGhpcy5lLFxuICAgICAgICAgdGhpcy5mXG4gICAgKTtcbn07XG5cbi8qKlxuICogIGZsaXBZXG4gKlxuICogIEByZXR1cm5zIHtNYXRyaXgyRH1cbiAqL1xuTWF0cml4MkQucHJvdG90eXBlLmZsaXBZID0gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIG5ldyBNYXRyaXgyRChcbiAgICAgICAgIHRoaXMuYSxcbiAgICAgICAgIHRoaXMuYixcbiAgICAgICAgLXRoaXMuYyxcbiAgICAgICAgLXRoaXMuZCxcbiAgICAgICAgIHRoaXMuZSxcbiAgICAgICAgIHRoaXMuZlxuICAgICk7XG59O1xuXG4vKipcbiAqICBza2V3WFxuICpcbiAqICBAcGFyYXJtIHtOdW1iZXJ9IHJhZGlhbnNcbiAqICBAcmV0dXJucyB7TWF0cml4MkR9XG4gKi9cbk1hdHJpeDJELnByb3RvdHlwZS5za2V3WCA9IGZ1bmN0aW9uKHJhZGlhbnMpIHtcbiAgICB2YXIgdCA9IE1hdGgudGFuKHJhZGlhbnMpO1xuXG4gICAgcmV0dXJuIG5ldyBNYXRyaXgyRChcbiAgICAgICAgdGhpcy5hLFxuICAgICAgICB0aGlzLmIsXG4gICAgICAgIHRoaXMuYSAqIHQgKyB0aGlzLmMsXG4gICAgICAgIHRoaXMuYiAqIHQgKyB0aGlzLmQsXG4gICAgICAgIHRoaXMuZSxcbiAgICAgICAgdGhpcy5mXG4gICAgKTtcbn07XG5cbi8vIFRPRE86IHNrZXdYQXRcblxuLyoqXG4gKiAgc2tld1lcbiAqXG4gKiAgQHBhcmFybSB7TnVtYmVyfSByYWRpYW5zXG4gKiAgQHJldHVybnMge01hdHJpeDJEfVxuICovXG5NYXRyaXgyRC5wcm90b3R5cGUuc2tld1kgPSBmdW5jdGlvbihyYWRpYW5zKSB7XG4gICAgdmFyIHQgPSBNYXRoLnRhbihhbmdsZSk7XG5cbiAgICByZXR1cm4gbWF0cml4X25ldyhcbiAgICAgICAgdGhpcy5hICsgdGhpcy5jICogdCxcbiAgICAgICAgdGhpcy5iICsgdGhpcy5kICogdCxcbiAgICAgICAgdGhpcy5jLFxuICAgICAgICB0aGlzLmQsXG4gICAgICAgIHRoaXMuZSxcbiAgICAgICAgdGhpcy5mXG4gICAgKTtcbn07XG5cbi8vIFRPRE86IHNrZXdZQXRcblxuLyoqXG4gKiAgaXNJZGVudGl0eVxuICpcbiAqICBAcmV0dXJucyB7Qm9vbGVhbn1cbiAqL1xuTWF0cml4MkQucHJvdG90eXBlLmlzSWRlbnRpdHkgPSBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gKFxuICAgICAgICB0aGlzLmEgPT09IDEuMCAmJlxuICAgICAgICB0aGlzLmIgPT09IDAuMCAmJlxuICAgICAgICB0aGlzLmMgPT09IDAuMCAmJlxuICAgICAgICB0aGlzLmQgPT09IDEuMCAmJlxuICAgICAgICB0aGlzLmUgPT09IDAuMCAmJlxuICAgICAgICB0aGlzLmYgPT09IDAuMFxuICAgICk7XG59O1xuXG4vKipcbiAqICBpc0ludmVydGlibGVcbiAqXG4gKiAgQHJldHVybnMge0Jvb2xlYW59XG4gKi9cbk1hdHJpeDJELnByb3RvdHlwZS5pc0ludmVydGlibGUgPSBmdW5jdGlvbigpIHtcbiAgICB0aGlzLmEgKiB0aGlzLmQgLSB0aGlzLmIgKiB0aGlzLmMgIT09IDAuMDtcbn07XG5cbi8qKlxuICogIGdldFNjYWxlXG4gKlxuICogIEByZXR1cm5zIHtzY2FsZVg6IE51bWJlciwgc2NhbGVZOiBOdW1iZXJ9XG4gKi9cbk1hdHJpeDJELnByb3RvdHlwZS5nZXRTY2FsZSA9IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiB7XG4gICAgICAgIHNjYWxlWDogTWF0aC5zcXJ0KHRoaXMuYSAqIHRoaXMuYSArIHRoaXMuYyAqIHRoaXMuYyksXG4gICAgICAgIHNjYWxlWTogTWF0aC5zcXJ0KHRoaXMuYiAqIHRoaXMuYiArIHRoaXMuZCAqIHRoaXMuZClcbiAgICB9O1xufTtcblxuLyoqXG4gKiAgZXF1YWxzXG4gKlxuICogIEBwYXJhbSB7TWF0cml4MkR9IHRoYXRcbiAqICBAcmV0dXJucyB7Qm9vbGVhbn1cbiAqL1xuTWF0cml4MkQucHJvdG90eXBlLmVxdWFscyA9IGZ1bmN0aW9uKHRoYXQpIHtcbiAgICByZXR1cm4gKFxuICAgICAgICB0aGlzLmEgPT09IHRoYXQuYSAmJlxuICAgICAgICB0aGlzLmIgPT09IHRoYXQuYiAmJlxuICAgICAgICB0aGlzLmMgPT09IHRoYXQuYyAmJlxuICAgICAgICB0aGlzLmQgPT09IHRoYXQuZCAmJlxuICAgICAgICB0aGlzLmUgPT09IHRoYXQuZSAmJlxuICAgICAgICB0aGlzLmYgPT09IHRoYXQuZlxuICAgICk7XG59O1xuXG4vKipcbiAqICB0b1N0cmluZ1xuICpcbiAqICBAcmV0dXJucyB7U3RyaW5nfVxuICovXG5NYXRyaXgyRC5wcm90b3R5cGUudG9TdHJpbmcgPSBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gKFxuICAgICAgICBcIm1hdHJpeChcIiArXG4gICAgICAgIHRoaXMuYSArIFwiLFwiICtcbiAgICAgICAgdGhpcy5iICsgXCIsXCIgK1xuICAgICAgICB0aGlzLmMgKyBcIixcIiArXG4gICAgICAgIHRoaXMuZCArIFwiLFwiICtcbiAgICAgICAgdGhpcy5lICsgXCIsXCIgK1xuICAgICAgICB0aGlzLmYgKyBcIilcIlxuICAgICk7XG59XG5cbmlmICh0eXBlb2YgbW9kdWxlICE9PSBcInVuZGVmaW5lZFwiKSB7XG4gICAgbW9kdWxlLmV4cG9ydHMgPSBNYXRyaXgyRDtcbn0iLCIvKipcbiAqXG4gKiAgIFBvaW50MkQuanNcbiAqXG4gKiAgIGNvcHlyaWdodCAyMDAxLTIwMDIsIDIwMTMgS2V2aW4gTGluZHNleVxuICpcbiAqL1xuXG4vKipcbiAqICBQb2ludDJEXG4gKlxuICogIEBwYXJhbSB7TnVtYmVyfSB4XG4gKiAgQHBhcmFtIHtOdW1iZXJ9IHlcbiAqICBAcmV0dXJucyB7UG9pbnQyRH1cbiAqL1xuZnVuY3Rpb24gUG9pbnQyRCh4LCB5KSB7XG4gICAgT2JqZWN0LmRlZmluZVByb3BlcnRpZXModGhpcywge1xuICAgICAgICBcInhcIjoge1xuICAgICAgICAgICAgdmFsdWU6IHgsXG4gICAgICAgICAgICB3cml0YWJsZTogZmFsc2UsXG4gICAgICAgICAgICBlbnVtZXJhYmxlOiB0cnVlLFxuICAgICAgICAgICAgY29uZmlndXJhYmxlOiBmYWxzZVxuICAgICAgICB9LFxuICAgICAgICBcInlcIjoge1xuICAgICAgICAgICAgdmFsdWU6IHksXG4gICAgICAgICAgICB3cml0YWJsZTogZmFsc2UsXG4gICAgICAgICAgICBlbnVtZXJhYmxlOiB0cnVlLFxuICAgICAgICAgICAgY29uZmlndXJhYmxlOiBmYWxzZVxuICAgICAgICB9XG4gICAgfSk7XG4gICAgLy8gdGhpcy54ID0geDtcbiAgICAvLyB0aGlzLnkgPSB5O1xufVxuXG4vKipcbiAqICBjbG9uZVxuICpcbiAqICBAcmV0dXJucyB7UG9pbnQyRH1cbiAqL1xuUG9pbnQyRC5wcm90b3R5cGUuY2xvbmUgPSBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gbmV3IFBvaW50MkQodGhpcy54LCB0aGlzLnkpO1xufTtcblxuLyoqXG4gKiAgYWRkXG4gKlxuICogIEBwYXJhbSB7UG9pbnQyRHxWZWN0b3IyRH0gdGhhdFxuICogIEByZXR1cm5zIHtQb2ludDJEfVxuICovXG5Qb2ludDJELnByb3RvdHlwZS5hZGQgPSBmdW5jdGlvbih0aGF0KSB7XG4gICAgcmV0dXJuIG5ldyBQb2ludDJEKHRoaXMueCt0aGF0LngsIHRoaXMueSt0aGF0LnkpO1xufTtcblxuLyoqXG4gKiAgc3VidHJhY3RcbiAqXG4gKiAgQHBhcmFtIHsgVmVjdG9yMkQgfCBQb2ludDJEIH0gdGhhdFxuICogIEByZXR1cm5zIHtQb2ludDJEfVxuICovXG5Qb2ludDJELnByb3RvdHlwZS5zdWJ0cmFjdCA9IGZ1bmN0aW9uKHRoYXQpIHtcbiAgICByZXR1cm4gbmV3IFBvaW50MkQodGhpcy54LXRoYXQueCwgdGhpcy55LXRoYXQueSk7XG59O1xuXG4vKipcbiAqICBtdWx0aXBseVxuICpcbiAqICBAcGFyYW0ge051bWJlcn0gc2NhbGFyXG4gKiAgQHJldHVybnMge1BvaW50MkR9XG4gKi9cblBvaW50MkQucHJvdG90eXBlLm11bHRpcGx5ID0gZnVuY3Rpb24oc2NhbGFyKSB7XG4gICAgcmV0dXJuIG5ldyBQb2ludDJEKHRoaXMueCpzY2FsYXIsIHRoaXMueSpzY2FsYXIpO1xufTtcblxuLyoqXG4gKiAgZGl2aWRlXG4gKlxuICogIEBwYXJhbSB7TnVtYmVyfSBzY2FsYXJcbiAqICBAcmV0dXJucyB7UG9pbnQyRH1cbiAqL1xuUG9pbnQyRC5wcm90b3R5cGUuZGl2aWRlID0gZnVuY3Rpb24oc2NhbGFyKSB7XG4gICAgcmV0dXJuIG5ldyBQb2ludDJEKHRoaXMueC9zY2FsYXIsIHRoaXMueS9zY2FsYXIpO1xufTtcblxuLyoqXG4gKiAgZXF1YWxzXG4gKlxuICogIEBwYXJhbSB7UG9pbnQyRH0gdGhhdFxuICogIEByZXR1cm5zIHtCb29sZWFufVxuICovXG5Qb2ludDJELnByb3RvdHlwZS5lcXVhbHMgPSBmdW5jdGlvbih0aGF0KSB7XG4gICAgcmV0dXJuICggdGhpcy54ID09IHRoYXQueCAmJiB0aGlzLnkgPT0gdGhhdC55ICk7XG59O1xuXG4vLyB1dGlsaXR5IG1ldGhvZHNcblxuLyoqXG4gKiAgbGVycFxuICpcbiAqICBAcGFyYW0geyBWZWN0b3IyRCB8IFBvaW50MkQgfSB0aGF0XG4gKiAgQHBhcmFtIHtOdW1iZXJ9IHRcbiBAICBAcmV0dXJucyB7UG9pbnQyRH1cbiAqL1xuUG9pbnQyRC5wcm90b3R5cGUubGVycCA9IGZ1bmN0aW9uKHRoYXQsIHQpIHtcbiAgICB2YXIgb210ID0gMS4wIC0gdDtcblxuICAgIHJldHVybiBuZXcgUG9pbnQyRChcbiAgICAgICAgdGhpcy54ICogb210ICsgdGhhdC54ICogdCxcbiAgICAgICAgdGhpcy55ICogb210ICsgdGhhdC55ICogdFxuICAgICk7XG59O1xuXG4vKipcbiAqICBkaXN0YW5jZUZyb21cbiAqXG4gKiAgQHBhcmFtIHtQb2ludDJEfSB0aGF0XG4gKiAgQHJldHVybnMge051bWJlcn1cbiAqL1xuUG9pbnQyRC5wcm90b3R5cGUuZGlzdGFuY2VGcm9tID0gZnVuY3Rpb24odGhhdCkge1xuICAgIHZhciBkeCA9IHRoaXMueCAtIHRoYXQueDtcbiAgICB2YXIgZHkgPSB0aGlzLnkgLSB0aGF0Lnk7XG5cbiAgICByZXR1cm4gTWF0aC5zcXJ0KGR4KmR4ICsgZHkqZHkpO1xufTtcblxuLyoqXG4gKiAgbWluXG4gKlxuICogIEBwYXJhbSB7UG9pbnQyRH0gdGhhdFxuICogIEByZXR1cm5zIHtOdW1iZXJ9XG4gKi9cblBvaW50MkQucHJvdG90eXBlLm1pbiA9IGZ1bmN0aW9uKHRoYXQpIHtcbiAgICByZXR1cm4gbmV3IFBvaW50MkQoXG4gICAgICAgIE1hdGgubWluKCB0aGlzLngsIHRoYXQueCApLFxuICAgICAgICBNYXRoLm1pbiggdGhpcy55LCB0aGF0LnkgKVxuICAgICk7XG59O1xuXG4vKipcbiAqICBtYXhcbiAqXG4gKiAgQHBhcmFtIHtQb2ludDJEfSB0aGF0XG4gKiAgQHJldHVybnMge051bWJlcn1cbiAqL1xuUG9pbnQyRC5wcm90b3R5cGUubWF4ID0gZnVuY3Rpb24odGhhdCkge1xuICAgIHJldHVybiBuZXcgUG9pbnQyRChcbiAgICAgICAgTWF0aC5tYXgoIHRoaXMueCwgdGhhdC54ICksXG4gICAgICAgIE1hdGgubWF4KCB0aGlzLnksIHRoYXQueSApXG4gICAgKTtcbn07XG5cbi8qKlxuICogIHRyYW5zZm9ybVxuICpcbiAqICBAcGFyYW0ge01hdHJpeDJEfVxuICogIEByZXN1bHQge1BvaW50MkR9XG4gKi9cblBvaW50MkQucHJvdG90eXBlLnRyYW5zZm9ybSA9IGZ1bmN0aW9uKG1hdHJpeCkge1xuICAgIHJldHVybiBuZXcgUG9pbnQyRChcbiAgICAgICAgbWF0cml4LmEgKiB0aGlzLnggKyBtYXRyaXguYyAqIHRoaXMueSArIG1hdHJpeC5lLFxuICAgICAgICBtYXRyaXguYiAqIHRoaXMueCArIG1hdHJpeC5kICogdGhpcy55ICsgbWF0cml4LmZcbiAgICApO1xufTtcblxuLyoqXG4gKiAgdG9TdHJpbmdcbiAqXG4gKiAgQHJldHVybnMge1N0cmluZ31cbiAqL1xuUG9pbnQyRC5wcm90b3R5cGUudG9TdHJpbmcgPSBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gXCJwb2ludChcIiArIHRoaXMueCArIFwiLFwiICsgdGhpcy55ICsgXCIpXCI7XG59O1xuXG5pZiAodHlwZW9mIG1vZHVsZSAhPT0gXCJ1bmRlZmluZWRcIikge1xuICAgIG1vZHVsZS5leHBvcnRzID0gUG9pbnQyRDtcbn1cbiIsIi8qKlxuICpcbiAqICAgVmVjdG9yMkQuanNcbiAqXG4gKiAgIGNvcHlyaWdodCAyMDAxLTIwMDIsIDIwMTMgS2V2aW4gTGluZHNleVxuICpcbiAqL1xuXG4vKipcbiAqICBWZWN0b3IyRFxuICpcbiAqICBAcGFyYW0ge051bWJlcn0geFxuICogIEBwYXJhbSB7TnVtYmVyfSB5XG4gKiAgQHJldHVybnMge1ZlY3RvcjJEfVxuICovXG5mdW5jdGlvbiBWZWN0b3IyRCh4LCB5KSB7XG4gICAgT2JqZWN0LmRlZmluZVByb3BlcnRpZXModGhpcywge1xuICAgICAgICBcInhcIjoge1xuICAgICAgICAgICAgdmFsdWU6IHgsXG4gICAgICAgICAgICB3cml0YWJsZTogZmFsc2UsXG4gICAgICAgICAgICBlbnVtZXJhYmxlOiB0cnVlLFxuICAgICAgICAgICAgY29uZmlndXJhYmxlOiBmYWxzZVxuICAgICAgICB9LFxuICAgICAgICBcInlcIjoge1xuICAgICAgICAgICAgdmFsdWU6IHksXG4gICAgICAgICAgICB3cml0YWJsZTogZmFsc2UsXG4gICAgICAgICAgICBlbnVtZXJhYmxlOiB0cnVlLFxuICAgICAgICAgICAgY29uZmlndXJhYmxlOiBmYWxzZVxuICAgICAgICB9XG4gICAgfSk7XG4gICAgLy8gdGhpcy54ID0geDtcbiAgICAvLyB0aGlzLnkgPSB5O1xufVxuXG4vKipcbiAqICBmcm9tUG9pbnRzXG4gKlxuICogIEBwYXJhbSB7UG9pbnQyRH0gcDFcbiAqICBAcGFyYW0ge1BvaW50MkR9IHAyXG4gKiAgQHJldHVybnMge1ZlY3RvcjJEfVxuICovXG5WZWN0b3IyRC5mcm9tUG9pbnRzID0gZnVuY3Rpb24ocDEsIHAyKSB7XG4gICAgcmV0dXJuIG5ldyBWZWN0b3IyRChcbiAgICAgICAgcDIueCAtIHAxLngsXG4gICAgICAgIHAyLnkgLSBwMS55XG4gICAgKTtcbn07XG5cbi8qKlxuICogIGxlbmd0aFxuICpcbiAqICBAcmV0dXJucyB7TnVtYmVyfVxuICovXG5WZWN0b3IyRC5wcm90b3R5cGUubGVuZ3RoID0gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIE1hdGguc3FydCh0aGlzLngqdGhpcy54ICsgdGhpcy55KnRoaXMueSk7XG59O1xuXG4vKipcbiAqICBtYWduaXR1ZGVcbiAqXG4gKiAgQHJldHVybnMge051bWJlcn1cbiAqL1xuVmVjdG9yMkQucHJvdG90eXBlLm1hZ25pdHVkZSA9IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiB0aGlzLngqdGhpcy54ICsgdGhpcy55KnRoaXMueTtcbn07XG5cbi8qKlxuICogIGRvdFxuICpcbiAqICBAcGFyYW0ge1ZlY3RvcjJEfSB0aGF0XG4gKiAgQHJldHVybnMge051bWJlcn1cbiAqL1xuVmVjdG9yMkQucHJvdG90eXBlLmRvdCA9IGZ1bmN0aW9uKHRoYXQpIHtcbiAgICByZXR1cm4gdGhpcy54KnRoYXQueCArIHRoaXMueSp0aGF0Lnk7XG59O1xuXG4vKipcbiAqICBjcm9zc1xuICpcbiAqICBAcGFyYW0ge1ZlY3RvcjJEfSB0aGF0XG4gKiAgQHJldHVybnMge051bWJlcn1cbiAqL1xuVmVjdG9yMkQucHJvdG90eXBlLmNyb3NzID0gZnVuY3Rpb24odGhhdCkge1xuICAgIHJldHVybiB0aGlzLngqdGhhdC55IC0gdGhpcy55KnRoYXQueDtcbn1cblxuLyoqXG4gKiAgZGV0ZXJtaW5hbnRcbiAqXG4gKiAgQHBhcmFtIHtWZWN0b3IyRH0gdGhhdFxuICogIEByZXR1cm5zIHtOdW1iZXJ9XG4gKi9cblZlY3RvcjJELnByb3RvdHlwZS5kZXRlcm1pbmFudCA9IGZ1bmN0aW9uKHRoYXQpIHtcbiAgICByZXR1cm4gdGhpcy54KnRoYXQueSAtIHRoaXMueSp0aGF0Lng7XG59O1xuXG4vKipcbiAqICB1bml0XG4gKlxuICogIEByZXR1cm5zIHtWZWN0b3IyRH1cbiAqL1xuVmVjdG9yMkQucHJvdG90eXBlLnVuaXQgPSBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gdGhpcy5kaXZpZGUoIHRoaXMubGVuZ3RoKCkgKTtcbn07XG5cbi8qKlxuICogIGFkZFxuICpcbiAqICBAcGFyYW0ge1ZlY3RvcjJEfSB0aGF0XG4gKiAgQHJldHVybnMge1ZlY3RvcjJEfVxuICovXG5WZWN0b3IyRC5wcm90b3R5cGUuYWRkID0gZnVuY3Rpb24odGhhdCkge1xuICAgIHJldHVybiBuZXcgVmVjdG9yMkQodGhpcy54ICsgdGhhdC54LCB0aGlzLnkgKyB0aGF0LnkpO1xufTtcblxuLyoqXG4gKiAgc3VidHJhY3RcbiAqXG4gKiAgQHBhcmFtIHtWZWN0b3IyRH0gdGhhdFxuICogIEByZXR1cm5zIHtWZWN0b3IyRH1cbiAqL1xuVmVjdG9yMkQucHJvdG90eXBlLnN1YnRyYWN0ID0gZnVuY3Rpb24odGhhdCkge1xuICAgIHJldHVybiBuZXcgVmVjdG9yMkQodGhpcy54IC0gdGhhdC54LCB0aGlzLnkgLSB0aGF0LnkpO1xufTtcblxuLyoqXG4gKiAgbXVsdGlwbHlcbiAqXG4gKiAgQHBhcmFtIHtOdW1iZXJ9IHNjYWxhclxuICogIEByZXR1cm5zIHtWZWN0b3IyRH1cbiAqL1xuVmVjdG9yMkQucHJvdG90eXBlLm11bHRpcGx5ID0gZnVuY3Rpb24oc2NhbGFyKSB7XG4gICAgcmV0dXJuIG5ldyBWZWN0b3IyRCh0aGlzLnggKiBzY2FsYXIsIHRoaXMueSAqIHNjYWxhcik7XG59O1xuXG4vKipcbiAqICBkaXZpZGVcbiAqXG4gKiAgQHBhcmFtIHtOdW1iZXJ9IHNjYWxhclxuICogIEByZXR1cm5zIHtWZWN0b3IyRH1cbiAqL1xuVmVjdG9yMkQucHJvdG90eXBlLmRpdmlkZSA9IGZ1bmN0aW9uKHNjYWxhcikge1xuICAgIHJldHVybiBuZXcgVmVjdG9yMkQodGhpcy54IC8gc2NhbGFyLCB0aGlzLnkgLyBzY2FsYXIpO1xufTtcblxuLyoqXG4gKiAgYW5nbGVCZXR3ZWVuXG4gKlxuICogIEBwYXJhbSB7VmVjdG9yMkR9IHRoYXRcbiAqICBAcmV0dXJucyB7TnVtYmVyfVxuICovXG5WZWN0b3IyRC5wcm90b3R5cGUuYW5nbGVCZXR3ZWVuID0gZnVuY3Rpb24odGhhdCkge1xuICAgIHZhciBjb3MgPSB0aGlzLmRvdCh0aGF0KSAvICh0aGlzLmxlbmd0aCgpICogdGhhdC5sZW5ndGgoKSk7XG4gICAgaWYgKGNvcyA8IC0xKSB7XG4gICAgICAgIGNvcyA9IC0xO1xuICAgIH1cbiAgICBlbHNlIGlmIChjb3MgPiAxKSB7XG4gICAgICAgIGNvcyA9IDE7XG4gICAgfVxuICAgIHZhciByYWRpYW5zID0gTWF0aC5hY29zKGNvcyk7XG5cbiAgICByZXR1cm4gKHRoaXMuY3Jvc3ModGhhdCkgPCAwLjApID8gLXJhZGlhbnMgOiByYWRpYW5zO1xufTtcblxuLyoqXG4gKiAgRmluZCBhIHZlY3RvciBpcyB0aGF0IGlzIHBlcnBlbmRpY3VsYXIgdG8gdGhpcyB2ZWN0b3JcbiAqXG4gKiAgQHJldHVybnMge1ZlY3RvcjJEfVxuICovXG5WZWN0b3IyRC5wcm90b3R5cGUucGVycCA9IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiBuZXcgVmVjdG9yMkQoLXRoaXMueSwgdGhpcy54KTtcbn07XG5cbi8qKlxuICogIEZpbmQgdGhlIGNvbXBvbmVudCBvZiB0aGUgc3BlY2lmaWVkIHZlY3RvciB0aGF0IGlzIHBlcnBlbmRpY3VsYXIgdG9cbiAqICB0aGlzIHZlY3RvclxuICpcbiAqICBAcGFyYW0ge1ZlY3RvcjJEfSB0aGF0XG4gKiAgQHJldHVybnMge1ZlY3RvcjJEfVxuICovXG5WZWN0b3IyRC5wcm90b3R5cGUucGVycGVuZGljdWxhciA9IGZ1bmN0aW9uKHRoYXQpIHtcbiAgICByZXR1cm4gdGhpcy5zdWJ0cmFjdCh0aGlzLnByb2plY3QodGhhdCkpO1xufTtcblxuLyoqXG4gKiAgcHJvamVjdFxuICpcbiAqICBAcGFyYW0ge1ZlY3RvcjJEfSB0aGF0XG4gKiAgQHJldHVybnMge1ZlY3RvcjJEfVxuICovXG5WZWN0b3IyRC5wcm90b3R5cGUucHJvamVjdCA9IGZ1bmN0aW9uKHRoYXQpIHtcbiAgICB2YXIgcGVyY2VudCA9IHRoaXMuZG90KHRoYXQpIC8gdGhhdC5kb3QodGhhdCk7XG5cbiAgICByZXR1cm4gdGhhdC5tdWx0aXBseShwZXJjZW50KTtcbn07XG5cbi8qKlxuICogIHRyYW5zZm9ybVxuICpcbiAqICBAcGFyYW0ge01hdHJpeDJEfVxuICogIEByZXR1cm5zIHtWZWN0b3IyRH1cbiAqL1xuVmVjdG9yMkQucHJvdG90eXBlLnRyYW5zZm9ybSA9IGZ1bmN0aW9uKG1hdHJpeCkge1xuICAgIHJldHVybiBuZXcgVmVjdG9yMkQoXG4gICAgICAgIG1hdHJpeC5hICogdGhpcy54ICsgbWF0cml4LmMgKiB0aGlzLnksXG4gICAgICAgIG1hdHJpeC5iICogdGhpcy54ICsgbWF0cml4LmQgKiB0aGlzLnlcbiAgICApO1xufTtcblxuLyoqXG4gKiAgZXF1YWxzXG4gKlxuICogIEBwYXJhbSB7VmVjdG9yMkR9IHRoYXRcbiAqICBAcmV0dXJucyB7Qm9vbGVhbn1cbiAqL1xuVmVjdG9yMkQucHJvdG90eXBlLmVxdWFscyA9IGZ1bmN0aW9uKHRoYXQpIHtcbiAgICByZXR1cm4gKFxuICAgICAgICB0aGlzLnggPT09IHRoYXQueCAmJlxuICAgICAgICB0aGlzLnkgPT09IHRoYXQueVxuICAgICk7XG59O1xuXG4vKipcbiAqICB0b1N0cmluZ1xuICpcbiAqICBAcmV0dXJucyB7U3RyaW5nfVxuICovXG5WZWN0b3IyRC5wcm90b3R5cGUudG9TdHJpbmcgPSBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gXCJ2ZWN0b3IoXCIgKyB0aGlzLnggKyBcIixcIiArIHRoaXMueSArIFwiKVwiO1xufTtcblxuaWYgKHR5cGVvZiBtb2R1bGUgIT09IFwidW5kZWZpbmVkXCIpIHtcbiAgICBtb2R1bGUuZXhwb3J0cyA9IFZlY3RvcjJEO1xufVxuIiwiLy8gZXhwb3NlIGNsYXNzZXNcblxuZXhwb3J0cy5Qb2x5bm9taWFsID0gcmVxdWlyZSgnLi9saWIvUG9seW5vbWlhbCcpO1xuZXhwb3J0cy5TcXJ0UG9seW5vbWlhbCA9IHJlcXVpcmUoJy4vbGliL1NxcnRQb2x5bm9taWFsJyk7XG4iLCIvKipcbiAqXG4gKiAgIFBvbHlub21pYWwuanNcbiAqXG4gKiAgIGNvcHlyaWdodCAyMDAyLCAyMTAzIEtldmluIExpbmRzZXlcbiAqXG4gKi9cblxuUG9seW5vbWlhbC5UT0xFUkFOQ0UgPSAxZS02O1xuUG9seW5vbWlhbC5BQ0NVUkFDWSAgPSAxNTtcblxuXG4vKipcbiAqICBpbnRlcnBvbGF0ZVxuICpcbiAqICBAcGFyYW0ge0FycmF5PE51bWJlcj59IHhzXG4gKiAgQHBhcmFtIHtBcnJheTxOdW1iZXI+fSB5c1xuICogIEBwYXJhbSB7TnVtYmVyfSBuXG4gKiAgQHBhcmFtIHtOdW1iZXJ9IG9mZnNldFxuICogIEBwYXJhbSB7TnVtYmVyfSB4XG4gKlxuICogIEByZXR1cm5zIHt5Ok51bWJlciwgZHk6TnVtYmVyfVxuICovXG5Qb2x5bm9taWFsLmludGVycG9sYXRlID0gZnVuY3Rpb24oeHMsIHlzLCBuLCBvZmZzZXQsIHgpIHtcbiAgICBpZiAoIHhzLmNvbnN0cnVjdG9yICE9PSBBcnJheSB8fCB5cy5jb25zdHJ1Y3RvciAhPT0gQXJyYXkgKVxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJQb2x5bm9taWFsLmludGVycG9sYXRlOiB4cyBhbmQgeXMgbXVzdCBiZSBhcnJheXNcIik7XG4gICAgaWYgKCBpc05hTihuKSB8fCBpc05hTihvZmZzZXQpIHx8IGlzTmFOKHgpIClcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiUG9seW5vbWlhbC5pbnRlcnBvbGF0ZTogbiwgb2Zmc2V0LCBhbmQgeCBtdXN0IGJlIG51bWJlcnNcIik7XG5cbiAgICB2YXIgeSAgPSAwO1xuICAgIHZhciBkeSA9IDA7XG4gICAgdmFyIGMgPSBuZXcgQXJyYXkobik7XG4gICAgdmFyIGQgPSBuZXcgQXJyYXkobik7XG4gICAgdmFyIG5zID0gMDtcbiAgICB2YXIgcmVzdWx0O1xuXG4gICAgdmFyIGRpZmYgPSBNYXRoLmFicyh4IC0geHNbb2Zmc2V0XSk7XG4gICAgZm9yICggdmFyIGkgPSAwOyBpIDwgbjsgaSsrICkge1xuICAgICAgICB2YXIgZGlmdCA9IE1hdGguYWJzKHggLSB4c1tvZmZzZXQraV0pO1xuXG4gICAgICAgIGlmICggZGlmdCA8IGRpZmYgKSB7XG4gICAgICAgICAgICBucyA9IGk7XG4gICAgICAgICAgICBkaWZmID0gZGlmdDtcbiAgICAgICAgfVxuICAgICAgICBjW2ldID0gZFtpXSA9IHlzW29mZnNldCtpXTtcbiAgICB9XG4gICAgeSA9IHlzW29mZnNldCtuc107XG4gICAgbnMtLTtcblxuICAgIGZvciAoIHZhciBtID0gMTsgbSA8IG47IG0rKyApIHtcbiAgICAgICAgZm9yICggdmFyIGkgPSAwOyBpIDwgbi1tOyBpKysgKSB7XG4gICAgICAgICAgICB2YXIgaG8gPSB4c1tvZmZzZXQraV0gLSB4O1xuICAgICAgICAgICAgdmFyIGhwID0geHNbb2Zmc2V0K2krbV0gLSB4O1xuICAgICAgICAgICAgdmFyIHcgPSBjW2krMV0tZFtpXTtcbiAgICAgICAgICAgIHZhciBkZW4gPSBobyAtIGhwO1xuXG4gICAgICAgICAgICBpZiAoIGRlbiA9PSAwLjAgKSB7XG4gICAgICAgICAgICAgICAgcmVzdWx0ID0geyB5OiAwLCBkeTogMH07XG4gICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGRlbiA9IHcgLyBkZW47XG4gICAgICAgICAgICBkW2ldID0gaHAqZGVuO1xuICAgICAgICAgICAgY1tpXSA9IGhvKmRlbjtcbiAgICAgICAgfVxuICAgICAgICBkeSA9ICgyKihucysxKSA8IChuLW0pKSA/IGNbbnMrMV0gOiBkW25zLS1dO1xuICAgICAgICB5ICs9IGR5O1xuICAgIH1cblxuICAgIHJldHVybiB7IHk6IHksIGR5OiBkeSB9O1xufTtcblxuXG4vKipcbiAqICBQb2x5bm9taWFsXG4gKlxuICogIEByZXR1cm5zIHtQb2x5bm9taWFsfVxuICovXG5mdW5jdGlvbiBQb2x5bm9taWFsKCkge1xuICAgIHRoaXMuaW5pdCggYXJndW1lbnRzICk7XG59XG5cblxuLyoqXG4gKiAgaW5pdFxuICovXG5Qb2x5bm9taWFsLnByb3RvdHlwZS5pbml0ID0gZnVuY3Rpb24oY29lZnMpIHtcbiAgICB0aGlzLmNvZWZzID0gbmV3IEFycmF5KCk7XG5cbiAgICBmb3IgKCB2YXIgaSA9IGNvZWZzLmxlbmd0aCAtIDE7IGkgPj0gMDsgaS0tIClcbiAgICAgICAgdGhpcy5jb2Vmcy5wdXNoKCBjb2Vmc1tpXSApO1xuXG4gICAgdGhpcy5fdmFyaWFibGUgPSBcInRcIjtcbiAgICB0aGlzLl9zID0gMDtcbn07XG5cblxuLyoqXG4gKiAgZXZhbFxuICovXG5Qb2x5bm9taWFsLnByb3RvdHlwZS5ldmFsID0gZnVuY3Rpb24oeCkge1xuICAgIGlmICggaXNOYU4oeCkgKVxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJQb2x5bm9taWFsLmV2YWw6IHBhcmFtZXRlciBtdXN0IGJlIGEgbnVtYmVyXCIpO1xuXG4gICAgdmFyIHJlc3VsdCA9IDA7XG5cbiAgICBmb3IgKCB2YXIgaSA9IHRoaXMuY29lZnMubGVuZ3RoIC0gMTsgaSA+PSAwOyBpLS0gKVxuICAgICAgICByZXN1bHQgPSByZXN1bHQgKiB4ICsgdGhpcy5jb2Vmc1tpXTtcblxuICAgIHJldHVybiByZXN1bHQ7XG59O1xuXG5cbi8qKlxuICogIGFkZFxuICovXG5Qb2x5bm9taWFsLnByb3RvdHlwZS5hZGQgPSBmdW5jdGlvbih0aGF0KSB7XG4gICAgdmFyIHJlc3VsdCA9IG5ldyBQb2x5bm9taWFsKCk7XG4gICAgdmFyIGQxID0gdGhpcy5nZXREZWdyZWUoKTtcbiAgICB2YXIgZDIgPSB0aGF0LmdldERlZ3JlZSgpO1xuICAgIHZhciBkbWF4ID0gTWF0aC5tYXgoZDEsZDIpO1xuXG4gICAgZm9yICggdmFyIGkgPSAwOyBpIDw9IGRtYXg7IGkrKyApIHtcbiAgICAgICAgdmFyIHYxID0gKGkgPD0gZDEpID8gdGhpcy5jb2Vmc1tpXSA6IDA7XG4gICAgICAgIHZhciB2MiA9IChpIDw9IGQyKSA/IHRoYXQuY29lZnNbaV0gOiAwO1xuXG4gICAgICAgIHJlc3VsdC5jb2Vmc1tpXSA9IHYxICsgdjI7XG4gICAgfVxuXG4gICAgcmV0dXJuIHJlc3VsdDtcbn07XG5cblxuLyoqXG4gKiAgbXVsdGlwbHlcbiAqL1xuUG9seW5vbWlhbC5wcm90b3R5cGUubXVsdGlwbHkgPSBmdW5jdGlvbih0aGF0KSB7XG4gICAgdmFyIHJlc3VsdCA9IG5ldyBQb2x5bm9taWFsKCk7XG5cbiAgICBmb3IgKCB2YXIgaSA9IDA7IGkgPD0gdGhpcy5nZXREZWdyZWUoKSArIHRoYXQuZ2V0RGVncmVlKCk7IGkrKyApXG4gICAgICAgIHJlc3VsdC5jb2Vmcy5wdXNoKDApO1xuXG4gICAgZm9yICggdmFyIGkgPSAwOyBpIDw9IHRoaXMuZ2V0RGVncmVlKCk7IGkrKyApXG4gICAgICAgIGZvciAoIHZhciBqID0gMDsgaiA8PSB0aGF0LmdldERlZ3JlZSgpOyBqKysgKVxuICAgICAgICAgICAgcmVzdWx0LmNvZWZzW2kral0gKz0gdGhpcy5jb2Vmc1tpXSAqIHRoYXQuY29lZnNbal07XG5cbiAgICByZXR1cm4gcmVzdWx0O1xufTtcblxuXG4vKipcbiAqICBkaXZpZGVfc2NhbGFyXG4gKi9cblBvbHlub21pYWwucHJvdG90eXBlLmRpdmlkZV9zY2FsYXIgPSBmdW5jdGlvbihzY2FsYXIpIHtcbiAgICBmb3IgKCB2YXIgaSA9IDA7IGkgPCB0aGlzLmNvZWZzLmxlbmd0aDsgaSsrIClcbiAgICAgICAgdGhpcy5jb2Vmc1tpXSAvPSBzY2FsYXI7XG59O1xuXG5cbi8qKlxuICogIHNpbXBsaWZ5XG4gKi9cblBvbHlub21pYWwucHJvdG90eXBlLnNpbXBsaWZ5ID0gZnVuY3Rpb24oKSB7XG4gICAgZm9yICggdmFyIGkgPSB0aGlzLmdldERlZ3JlZSgpOyBpID49IDA7IGktLSApIHtcbiAgICAgICAgaWYgKCBNYXRoLmFicyggdGhpcy5jb2Vmc1tpXSApIDw9IFBvbHlub21pYWwuVE9MRVJBTkNFIClcbiAgICAgICAgICAgIHRoaXMuY29lZnMucG9wKCk7XG4gICAgICAgIGVsc2VcbiAgICAgICAgICAgIGJyZWFrO1xuICAgIH1cbn07XG5cblxuLyoqXG4gKiAgYmlzZWN0aW9uXG4gKi9cblBvbHlub21pYWwucHJvdG90eXBlLmJpc2VjdGlvbiA9IGZ1bmN0aW9uKG1pbiwgbWF4KSB7XG4gICAgdmFyIG1pblZhbHVlID0gdGhpcy5ldmFsKG1pbik7XG4gICAgdmFyIG1heFZhbHVlID0gdGhpcy5ldmFsKG1heCk7XG4gICAgdmFyIHJlc3VsdDtcblxuICAgIGlmICggTWF0aC5hYnMobWluVmFsdWUpIDw9IFBvbHlub21pYWwuVE9MRVJBTkNFIClcbiAgICAgICAgcmVzdWx0ID0gbWluO1xuICAgIGVsc2UgaWYgKCBNYXRoLmFicyhtYXhWYWx1ZSkgPD0gUG9seW5vbWlhbC5UT0xFUkFOQ0UgKVxuICAgICAgICByZXN1bHQgPSBtYXg7XG4gICAgZWxzZSBpZiAoIG1pblZhbHVlICogbWF4VmFsdWUgPD0gMCApIHtcbiAgICAgICAgdmFyIHRtcDEgID0gTWF0aC5sb2cobWF4IC0gbWluKTtcbiAgICAgICAgdmFyIHRtcDIgID0gTWF0aC5MTjEwICogUG9seW5vbWlhbC5BQ0NVUkFDWTtcbiAgICAgICAgdmFyIGl0ZXJzID0gTWF0aC5jZWlsKCAodG1wMSt0bXAyKSAvIE1hdGguTE4yICk7XG5cbiAgICAgICAgZm9yICggdmFyIGkgPSAwOyBpIDwgaXRlcnM7IGkrKyApIHtcbiAgICAgICAgICAgIHJlc3VsdCA9IDAuNSAqIChtaW4gKyBtYXgpO1xuICAgICAgICAgICAgdmFyIHZhbHVlID0gdGhpcy5ldmFsKHJlc3VsdCk7XG5cbiAgICAgICAgICAgIGlmICggTWF0aC5hYnModmFsdWUpIDw9IFBvbHlub21pYWwuVE9MRVJBTkNFICkge1xuICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAoIHZhbHVlICogbWluVmFsdWUgPCAwICkge1xuICAgICAgICAgICAgICAgIG1heCA9IHJlc3VsdDtcbiAgICAgICAgICAgICAgICBtYXhWYWx1ZSA9IHZhbHVlO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBtaW4gPSByZXN1bHQ7XG4gICAgICAgICAgICAgICAgbWluVmFsdWUgPSB2YWx1ZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiByZXN1bHQ7XG59O1xuXG5cbi8qKlxuICogIHRvU3RyaW5nXG4gKi9cblBvbHlub21pYWwucHJvdG90eXBlLnRvU3RyaW5nID0gZnVuY3Rpb24oKSB7XG4gICAgdmFyIGNvZWZzID0gbmV3IEFycmF5KCk7XG4gICAgdmFyIHNpZ25zID0gbmV3IEFycmF5KCk7XG5cbiAgICBmb3IgKCB2YXIgaSA9IHRoaXMuY29lZnMubGVuZ3RoIC0gMTsgaSA+PSAwOyBpLS0gKSB7XG4gICAgICAgIHZhciB2YWx1ZSA9IE1hdGgucm91bmQodGhpcy5jb2Vmc1tpXSoxMDAwKS8xMDAwO1xuICAgICAgICAvL3ZhciB2YWx1ZSA9IHRoaXMuY29lZnNbaV07XG5cbiAgICAgICAgaWYgKCB2YWx1ZSAhPSAwICkge1xuICAgICAgICAgICAgdmFyIHNpZ24gPSAoIHZhbHVlIDwgMCApID8gXCIgLSBcIiA6IFwiICsgXCI7XG5cbiAgICAgICAgICAgIHZhbHVlID0gTWF0aC5hYnModmFsdWUpO1xuICAgICAgICAgICAgaWYgKCBpID4gMCApXG4gICAgICAgICAgICAgICAgaWYgKCB2YWx1ZSA9PSAxIClcbiAgICAgICAgICAgICAgICAgICAgdmFsdWUgPSB0aGlzLl92YXJpYWJsZTtcbiAgICAgICAgICAgICAgICBlbHNlXG4gICAgICAgICAgICAgICAgICAgIHZhbHVlICs9IHRoaXMuX3ZhcmlhYmxlO1xuICAgICAgICAgICAgaWYgKCBpID4gMSApIHZhbHVlICs9IFwiXlwiICsgaTtcblxuICAgICAgICAgICAgc2lnbnMucHVzaCggc2lnbiApO1xuICAgICAgICAgICAgY29lZnMucHVzaCggdmFsdWUgKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHNpZ25zWzBdID0gKCBzaWduc1swXSA9PSBcIiArIFwiICkgPyBcIlwiIDogXCItXCI7XG5cbiAgICB2YXIgcmVzdWx0ID0gXCJcIjtcbiAgICBmb3IgKCB2YXIgaSA9IDA7IGkgPCBjb2Vmcy5sZW5ndGg7IGkrKyApXG4gICAgICAgIHJlc3VsdCArPSBzaWduc1tpXSArIGNvZWZzW2ldO1xuXG4gICAgcmV0dXJuIHJlc3VsdDtcbn07XG5cblxuLyoqXG4gKiAgdHJhcGV6b2lkXG4gKiAgQmFzZWQgb24gdHJhcHpkIGluIFwiTnVtZXJpY2FsIFJlY2lwZXMgaW4gQ1wiLCBwYWdlIDEzN1xuICovXG5Qb2x5bm9taWFsLnByb3RvdHlwZS50cmFwZXpvaWQgPSBmdW5jdGlvbihtaW4sIG1heCwgbikge1xuICAgIGlmICggaXNOYU4obWluKSB8fCBpc05hTihtYXgpIHx8IGlzTmFOKG4pIClcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiUG9seW5vbWlhbC50cmFwZXpvaWQ6IHBhcmFtZXRlcnMgbXVzdCBiZSBudW1iZXJzXCIpO1xuXG4gICAgdmFyIHJhbmdlID0gbWF4IC0gbWluO1xuICAgIHZhciBUT0xFUkFOQ0UgPSAxZS03O1xuXG4gICAgaWYgKCBuID09IDEgKSB7XG4gICAgICAgIHZhciBtaW5WYWx1ZSA9IHRoaXMuZXZhbChtaW4pO1xuICAgICAgICB2YXIgbWF4VmFsdWUgPSB0aGlzLmV2YWwobWF4KTtcbiAgICAgICAgdGhpcy5fcyA9IDAuNSpyYW5nZSooIG1pblZhbHVlICsgbWF4VmFsdWUgKTtcbiAgICB9IGVsc2Uge1xuICAgICAgICB2YXIgaXQgPSAxIDw8IChuLTIpO1xuICAgICAgICB2YXIgZGVsdGEgPSByYW5nZSAvIGl0O1xuICAgICAgICB2YXIgeCA9IG1pbiArIDAuNSpkZWx0YTtcbiAgICAgICAgdmFyIHN1bSA9IDA7XG5cbiAgICAgICAgZm9yICggdmFyIGkgPSAwOyBpIDwgaXQ7IGkrKyApIHtcbiAgICAgICAgICAgIHN1bSArPSB0aGlzLmV2YWwoeCk7XG4gICAgICAgICAgICB4ICs9IGRlbHRhO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMuX3MgPSAwLjUqKHRoaXMuX3MgKyByYW5nZSpzdW0vaXQpO1xuICAgIH1cblxuICAgIGlmICggaXNOYU4odGhpcy5fcykgKVxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJQb2x5bm9taWFsLnRyYXBlem9pZDogdGhpcy5fcyBpcyBOYU5cIik7XG5cbiAgICByZXR1cm4gdGhpcy5fcztcbn07XG5cblxuLyoqXG4gKiAgc2ltcHNvblxuICogIEJhc2VkIG9uIHRyYXB6ZCBpbiBcIk51bWVyaWNhbCBSZWNpcGVzIGluIENcIiwgcGFnZSAxMzlcbiAqL1xuUG9seW5vbWlhbC5wcm90b3R5cGUuc2ltcHNvbiA9IGZ1bmN0aW9uKG1pbiwgbWF4KSB7XG4gICAgaWYgKCBpc05hTihtaW4pIHx8IGlzTmFOKG1heCkgKVxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJQb2x5bm9taWFsLnNpbXBzb246IHBhcmFtZXRlcnMgbXVzdCBiZSBudW1iZXJzXCIpO1xuXG4gICAgdmFyIHJhbmdlID0gbWF4IC0gbWluO1xuICAgIHZhciBzdCA9IDAuNSAqIHJhbmdlICogKCB0aGlzLmV2YWwobWluKSArIHRoaXMuZXZhbChtYXgpICk7XG4gICAgdmFyIHQgPSBzdDtcbiAgICB2YXIgcyA9IDQuMCpzdC8zLjA7XG4gICAgdmFyIG9zID0gcztcbiAgICB2YXIgb3N0ID0gc3Q7XG4gICAgdmFyIFRPTEVSQU5DRSA9IDFlLTc7XG5cbiAgICB2YXIgaXQgPSAxO1xuICAgIGZvciAoIHZhciBuID0gMjsgbiA8PSAyMDsgbisrICkge1xuICAgICAgICB2YXIgZGVsdGEgPSByYW5nZSAvIGl0O1xuICAgICAgICB2YXIgeCAgICAgPSBtaW4gKyAwLjUqZGVsdGE7XG4gICAgICAgIHZhciBzdW0gICA9IDA7XG5cbiAgICAgICAgZm9yICggdmFyIGkgPSAxOyBpIDw9IGl0OyBpKysgKSB7XG4gICAgICAgICAgICBzdW0gKz0gdGhpcy5ldmFsKHgpO1xuICAgICAgICAgICAgeCArPSBkZWx0YTtcbiAgICAgICAgfVxuXG4gICAgICAgIHQgPSAwLjUgKiAodCArIHJhbmdlICogc3VtIC8gaXQpO1xuICAgICAgICBzdCA9IHQ7XG4gICAgICAgIHMgPSAoNC4wKnN0IC0gb3N0KS8zLjA7XG5cbiAgICAgICAgaWYgKCBNYXRoLmFicyhzLW9zKSA8IFRPTEVSQU5DRSpNYXRoLmFicyhvcykgKVxuICAgICAgICAgICAgYnJlYWs7XG5cbiAgICAgICAgb3MgPSBzO1xuICAgICAgICBvc3QgPSBzdDtcbiAgICAgICAgaXQgPDw9IDE7XG4gICAgfVxuXG4gICAgcmV0dXJuIHM7XG59O1xuXG5cbi8qKlxuICogIHJvbWJlcmdcbiAqL1xuUG9seW5vbWlhbC5wcm90b3R5cGUucm9tYmVyZyA9IGZ1bmN0aW9uKG1pbiwgbWF4KSB7XG4gICAgaWYgKCBpc05hTihtaW4pIHx8IGlzTmFOKG1heCkgKVxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJQb2x5bm9taWFsLnJvbWJlcmc6IHBhcmFtZXRlcnMgbXVzdCBiZSBudW1iZXJzXCIpO1xuXG4gICAgdmFyIE1BWCA9IDIwO1xuICAgIHZhciBLID0gMztcbiAgICB2YXIgVE9MRVJBTkNFID0gMWUtNjtcbiAgICB2YXIgcyA9IG5ldyBBcnJheShNQVgrMSk7XG4gICAgdmFyIGggPSBuZXcgQXJyYXkoTUFYKzEpO1xuICAgIHZhciByZXN1bHQgPSB7IHk6IDAsIGR5OiAwIH07XG5cbiAgICBoWzBdID0gMS4wO1xuICAgIGZvciAoIHZhciBqID0gMTsgaiA8PSBNQVg7IGorKyApIHtcbiAgICAgICAgc1tqLTFdID0gdGhpcy50cmFwZXpvaWQobWluLCBtYXgsIGopO1xuICAgICAgICBpZiAoIGogPj0gSyApIHtcbiAgICAgICAgICAgIHJlc3VsdCA9IFBvbHlub21pYWwuaW50ZXJwb2xhdGUoaCwgcywgSywgai1LLCAwLjApO1xuICAgICAgICAgICAgaWYgKCBNYXRoLmFicyhyZXN1bHQuZHkpIDw9IFRPTEVSQU5DRSpyZXN1bHQueSkgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgICAgc1tqXSA9IHNbai0xXTtcbiAgICAgICAgaFtqXSA9IDAuMjUgKiBoW2otMV07XG4gICAgfVxuXG4gICAgcmV0dXJuIHJlc3VsdC55O1xufTtcblxuLy8gZ2V0dGVycyBhbmQgc2V0dGVyc1xuXG4vKipcbiAqICBnZXQgZGVncmVlXG4gKi9cblBvbHlub21pYWwucHJvdG90eXBlLmdldERlZ3JlZSA9IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiB0aGlzLmNvZWZzLmxlbmd0aCAtIDE7XG59O1xuXG5cbi8qKlxuICogIGdldERlcml2YXRpdmVcbiAqL1xuUG9seW5vbWlhbC5wcm90b3R5cGUuZ2V0RGVyaXZhdGl2ZSA9IGZ1bmN0aW9uKCkge1xuICAgIHZhciBkZXJpdmF0aXZlID0gbmV3IFBvbHlub21pYWwoKTtcblxuICAgIGZvciAoIHZhciBpID0gMTsgaSA8IHRoaXMuY29lZnMubGVuZ3RoOyBpKysgKSB7XG4gICAgICAgIGRlcml2YXRpdmUuY29lZnMucHVzaChpKnRoaXMuY29lZnNbaV0pO1xuICAgIH1cblxuICAgIHJldHVybiBkZXJpdmF0aXZlO1xufTtcblxuXG4vKipcbiAqICBnZXRSb290c1xuICovXG5Qb2x5bm9taWFsLnByb3RvdHlwZS5nZXRSb290cyA9IGZ1bmN0aW9uKCkge1xuICAgIHZhciByZXN1bHQ7XG5cbiAgICB0aGlzLnNpbXBsaWZ5KCk7XG4gICAgc3dpdGNoICggdGhpcy5nZXREZWdyZWUoKSApIHtcbiAgICAgICAgY2FzZSAwOiByZXN1bHQgPSBuZXcgQXJyYXkoKTsgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICBjYXNlIDE6IHJlc3VsdCA9IHRoaXMuZ2V0TGluZWFyUm9vdCgpOyAgICAgYnJlYWs7XG4gICAgICAgIGNhc2UgMjogcmVzdWx0ID0gdGhpcy5nZXRRdWFkcmF0aWNSb290cygpOyBicmVhaztcbiAgICAgICAgY2FzZSAzOiByZXN1bHQgPSB0aGlzLmdldEN1YmljUm9vdHMoKTsgICAgIGJyZWFrO1xuICAgICAgICBjYXNlIDQ6IHJlc3VsdCA9IHRoaXMuZ2V0UXVhcnRpY1Jvb3RzKCk7ICAgYnJlYWs7XG4gICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICByZXN1bHQgPSBuZXcgQXJyYXkoKTtcbiAgICAgICAgICAgIC8vIHNob3VsZCB0cnkgTmV3dG9uJ3MgbWV0aG9kIGFuZC9vciBiaXNlY3Rpb25cbiAgICB9XG5cbiAgICByZXR1cm4gcmVzdWx0O1xufTtcblxuXG4vKipcbiAqICBnZXRSb290c0luSW50ZXJ2YWxcbiAqL1xuUG9seW5vbWlhbC5wcm90b3R5cGUuZ2V0Um9vdHNJbkludGVydmFsID0gZnVuY3Rpb24obWluLCBtYXgpIHtcbiAgICB2YXIgcm9vdHMgPSBuZXcgQXJyYXkoKTtcbiAgICB2YXIgcm9vdDtcblxuICAgIGlmICggdGhpcy5nZXREZWdyZWUoKSA9PSAxICkge1xuICAgICAgICByb290ID0gdGhpcy5iaXNlY3Rpb24obWluLCBtYXgpO1xuICAgICAgICBpZiAoIHJvb3QgIT0gbnVsbCApIHJvb3RzLnB1c2gocm9vdCk7XG4gICAgfSBlbHNlIHtcbiAgICAgICAgLy8gZ2V0IHJvb3RzIG9mIGRlcml2YXRpdmVcbiAgICAgICAgdmFyIGRlcml2ICA9IHRoaXMuZ2V0RGVyaXZhdGl2ZSgpO1xuICAgICAgICB2YXIgZHJvb3RzID0gZGVyaXYuZ2V0Um9vdHNJbkludGVydmFsKG1pbiwgbWF4KTtcblxuICAgICAgICBpZiAoIGRyb290cy5sZW5ndGggPiAwICkge1xuICAgICAgICAgICAgLy8gZmluZCByb290IG9uIFttaW4sIGRyb290c1swXV1cbiAgICAgICAgICAgIHJvb3QgPSB0aGlzLmJpc2VjdGlvbihtaW4sIGRyb290c1swXSk7XG4gICAgICAgICAgICBpZiAoIHJvb3QgIT0gbnVsbCApIHJvb3RzLnB1c2gocm9vdCk7XG5cbiAgICAgICAgICAgIC8vIGZpbmQgcm9vdCBvbiBbZHJvb3RzW2ldLGRyb290c1tpKzFdXSBmb3IgMCA8PSBpIDw9IGNvdW50LTJcbiAgICAgICAgICAgIGZvciAoIGkgPSAwOyBpIDw9IGRyb290cy5sZW5ndGgtMjsgaSsrICkge1xuICAgICAgICAgICAgICAgIHJvb3QgPSB0aGlzLmJpc2VjdGlvbihkcm9vdHNbaV0sIGRyb290c1tpKzFdKTtcbiAgICAgICAgICAgICAgICBpZiAoIHJvb3QgIT0gbnVsbCApIHJvb3RzLnB1c2gocm9vdCk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIGZpbmQgcm9vdCBvbiBbZHJvb3RzW2NvdW50LTFdLHhtYXhdXG4gICAgICAgICAgICByb290ID0gdGhpcy5iaXNlY3Rpb24oZHJvb3RzW2Ryb290cy5sZW5ndGgtMV0sIG1heCk7XG4gICAgICAgICAgICBpZiAoIHJvb3QgIT0gbnVsbCApIHJvb3RzLnB1c2gocm9vdCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAvLyBwb2x5bm9taWFsIGlzIG1vbm90b25lIG9uIFttaW4sbWF4XSwgaGFzIGF0IG1vc3Qgb25lIHJvb3RcbiAgICAgICAgICAgIHJvb3QgPSB0aGlzLmJpc2VjdGlvbihtaW4sIG1heCk7XG4gICAgICAgICAgICBpZiAoIHJvb3QgIT0gbnVsbCApIHJvb3RzLnB1c2gocm9vdCk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gcm9vdHM7XG59O1xuXG5cbi8qKlxuICogIGdldExpbmVhclJvb3RcbiAqL1xuUG9seW5vbWlhbC5wcm90b3R5cGUuZ2V0TGluZWFyUm9vdCA9IGZ1bmN0aW9uKCkge1xuICAgIHZhciByZXN1bHQgPSBuZXcgQXJyYXkoKTtcbiAgICB2YXIgYSA9IHRoaXMuY29lZnNbMV07XG5cbiAgICBpZiAoIGEgIT0gMCApXG4gICAgICAgIHJlc3VsdC5wdXNoKCAtdGhpcy5jb2Vmc1swXSAvIGEgKTtcblxuICAgIHJldHVybiByZXN1bHQ7XG59O1xuXG5cbi8qKlxuICogIGdldFF1YWRyYXRpY1Jvb3RzXG4gKi9cblBvbHlub21pYWwucHJvdG90eXBlLmdldFF1YWRyYXRpY1Jvb3RzID0gZnVuY3Rpb24oKSB7XG4gICAgdmFyIHJlc3VsdHMgPSBuZXcgQXJyYXkoKTtcblxuICAgIGlmICggdGhpcy5nZXREZWdyZWUoKSA9PSAyICkge1xuICAgICAgICB2YXIgYSA9IHRoaXMuY29lZnNbMl07XG4gICAgICAgIHZhciBiID0gdGhpcy5jb2Vmc1sxXSAvIGE7XG4gICAgICAgIHZhciBjID0gdGhpcy5jb2Vmc1swXSAvIGE7XG4gICAgICAgIHZhciBkID0gYipiIC0gNCpjO1xuXG4gICAgICAgIGlmICggZCA+IDAgKSB7XG4gICAgICAgICAgICB2YXIgZSA9IE1hdGguc3FydChkKTtcblxuICAgICAgICAgICAgcmVzdWx0cy5wdXNoKCAwLjUgKiAoLWIgKyBlKSApO1xuICAgICAgICAgICAgcmVzdWx0cy5wdXNoKCAwLjUgKiAoLWIgLSBlKSApO1xuICAgICAgICB9IGVsc2UgaWYgKCBkID09IDAgKSB7XG4gICAgICAgICAgICAvLyByZWFsbHkgdHdvIHJvb3RzIHdpdGggc2FtZSB2YWx1ZSwgYnV0IHdlIG9ubHkgcmV0dXJuIG9uZVxuICAgICAgICAgICAgcmVzdWx0cy5wdXNoKCAwLjUgKiAtYiApO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHJlc3VsdHM7XG59O1xuXG5cbi8qKlxuICogIGdldEN1YmljUm9vdHNcbiAqXG4gKiAgVGhpcyBjb2RlIGlzIGJhc2VkIG9uIE1nY1BvbHlub21pYWwuY3BwIHdyaXR0ZW4gYnkgRGF2aWQgRWJlcmx5LiAgSGlzXG4gKiAgY29kZSBhbG9uZyB3aXRoIG1hbnkgb3RoZXIgZXhjZWxsZW50IGV4YW1wbGVzIGFyZSBhdmFpYWJsZSBhdCBoaXMgc2l0ZTpcbiAqICBodHRwOi8vd3d3Lm1hZ2ljLXNvZnR3YXJlLmNvbVxuICovXG5Qb2x5bm9taWFsLnByb3RvdHlwZS5nZXRDdWJpY1Jvb3RzID0gZnVuY3Rpb24oKSB7XG4gICAgdmFyIHJlc3VsdHMgPSBuZXcgQXJyYXkoKTtcblxuICAgIGlmICggdGhpcy5nZXREZWdyZWUoKSA9PSAzICkge1xuICAgICAgICB2YXIgYzMgPSB0aGlzLmNvZWZzWzNdO1xuICAgICAgICB2YXIgYzIgPSB0aGlzLmNvZWZzWzJdIC8gYzM7XG4gICAgICAgIHZhciBjMSA9IHRoaXMuY29lZnNbMV0gLyBjMztcbiAgICAgICAgdmFyIGMwID0gdGhpcy5jb2Vmc1swXSAvIGMzO1xuXG4gICAgICAgIHZhciBhICAgICAgID0gKDMqYzEgLSBjMipjMikgLyAzO1xuICAgICAgICB2YXIgYiAgICAgICA9ICgyKmMyKmMyKmMyIC0gOSpjMSpjMiArIDI3KmMwKSAvIDI3O1xuICAgICAgICB2YXIgb2Zmc2V0ICA9IGMyIC8gMztcbiAgICAgICAgdmFyIGRpc2NyaW0gPSBiKmIvNCArIGEqYSphLzI3O1xuICAgICAgICB2YXIgaGFsZkIgICA9IGIgLyAyO1xuXG4gICAgICAgIGlmICggTWF0aC5hYnMoZGlzY3JpbSkgPD0gUG9seW5vbWlhbC5UT0xFUkFOQ0UgKSBkaXNjcmltID0gMDtcblxuICAgICAgICBpZiAoIGRpc2NyaW0gPiAwICkge1xuICAgICAgICAgICAgdmFyIGUgPSBNYXRoLnNxcnQoZGlzY3JpbSk7XG4gICAgICAgICAgICB2YXIgdG1wO1xuICAgICAgICAgICAgdmFyIHJvb3Q7XG5cbiAgICAgICAgICAgIHRtcCA9IC1oYWxmQiArIGU7XG4gICAgICAgICAgICBpZiAoIHRtcCA+PSAwIClcbiAgICAgICAgICAgICAgICByb290ID0gTWF0aC5wb3codG1wLCAxLzMpO1xuICAgICAgICAgICAgZWxzZVxuICAgICAgICAgICAgICAgIHJvb3QgPSAtTWF0aC5wb3coLXRtcCwgMS8zKTtcblxuICAgICAgICAgICAgdG1wID0gLWhhbGZCIC0gZTtcbiAgICAgICAgICAgIGlmICggdG1wID49IDAgKVxuICAgICAgICAgICAgICAgIHJvb3QgKz0gTWF0aC5wb3codG1wLCAxLzMpO1xuICAgICAgICAgICAgZWxzZVxuICAgICAgICAgICAgICAgIHJvb3QgLT0gTWF0aC5wb3coLXRtcCwgMS8zKTtcblxuICAgICAgICAgICAgcmVzdWx0cy5wdXNoKCByb290IC0gb2Zmc2V0ICk7XG4gICAgICAgIH0gZWxzZSBpZiAoIGRpc2NyaW0gPCAwICkge1xuICAgICAgICAgICAgdmFyIGRpc3RhbmNlID0gTWF0aC5zcXJ0KC1hLzMpO1xuICAgICAgICAgICAgdmFyIGFuZ2xlICAgID0gTWF0aC5hdGFuMiggTWF0aC5zcXJ0KC1kaXNjcmltKSwgLWhhbGZCKSAvIDM7XG4gICAgICAgICAgICB2YXIgY29zICAgICAgPSBNYXRoLmNvcyhhbmdsZSk7XG4gICAgICAgICAgICB2YXIgc2luICAgICAgPSBNYXRoLnNpbihhbmdsZSk7XG4gICAgICAgICAgICB2YXIgc3FydDMgICAgPSBNYXRoLnNxcnQoMyk7XG5cbiAgICAgICAgICAgIHJlc3VsdHMucHVzaCggMipkaXN0YW5jZSpjb3MgLSBvZmZzZXQgKTtcbiAgICAgICAgICAgIHJlc3VsdHMucHVzaCggLWRpc3RhbmNlICogKGNvcyArIHNxcnQzICogc2luKSAtIG9mZnNldCk7XG4gICAgICAgICAgICByZXN1bHRzLnB1c2goIC1kaXN0YW5jZSAqIChjb3MgLSBzcXJ0MyAqIHNpbikgLSBvZmZzZXQpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdmFyIHRtcDtcblxuICAgICAgICAgICAgaWYgKCBoYWxmQiA+PSAwIClcbiAgICAgICAgICAgICAgICB0bXAgPSAtTWF0aC5wb3coaGFsZkIsIDEvMyk7XG4gICAgICAgICAgICBlbHNlXG4gICAgICAgICAgICAgICAgdG1wID0gTWF0aC5wb3coLWhhbGZCLCAxLzMpO1xuXG4gICAgICAgICAgICByZXN1bHRzLnB1c2goIDIqdG1wIC0gb2Zmc2V0ICk7XG4gICAgICAgICAgICAvLyByZWFsbHkgc2hvdWxkIHJldHVybiBuZXh0IHJvb3QgdHdpY2UsIGJ1dCB3ZSByZXR1cm4gb25seSBvbmVcbiAgICAgICAgICAgIHJlc3VsdHMucHVzaCggLXRtcCAtIG9mZnNldCApO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHJlc3VsdHM7XG59O1xuXG5cbi8qKlxuICogIGdldFF1YXJ0aWNSb290c1xuICpcbiAqICBUaGlzIGNvZGUgaXMgYmFzZWQgb24gTWdjUG9seW5vbWlhbC5jcHAgd3JpdHRlbiBieSBEYXZpZCBFYmVybHkuICBIaXNcbiAqICBjb2RlIGFsb25nIHdpdGggbWFueSBvdGhlciBleGNlbGxlbnQgZXhhbXBsZXMgYXJlIGF2YWlhYmxlIGF0IGhpcyBzaXRlOlxuICogIGh0dHA6Ly93d3cubWFnaWMtc29mdHdhcmUuY29tXG4gKi9cblBvbHlub21pYWwucHJvdG90eXBlLmdldFF1YXJ0aWNSb290cyA9IGZ1bmN0aW9uKCkge1xuICAgIHZhciByZXN1bHRzID0gbmV3IEFycmF5KCk7XG5cbiAgICBpZiAoIHRoaXMuZ2V0RGVncmVlKCkgPT0gNCApIHtcbiAgICAgICAgdmFyIGM0ID0gdGhpcy5jb2Vmc1s0XTtcbiAgICAgICAgdmFyIGMzID0gdGhpcy5jb2Vmc1szXSAvIGM0O1xuICAgICAgICB2YXIgYzIgPSB0aGlzLmNvZWZzWzJdIC8gYzQ7XG4gICAgICAgIHZhciBjMSA9IHRoaXMuY29lZnNbMV0gLyBjNDtcbiAgICAgICAgdmFyIGMwID0gdGhpcy5jb2Vmc1swXSAvIGM0O1xuXG4gICAgICAgIHZhciByZXNvbHZlUm9vdHMgPSBuZXcgUG9seW5vbWlhbChcbiAgICAgICAgICAgIDEsIC1jMiwgYzMqYzEgLSA0KmMwLCAtYzMqYzMqYzAgKyA0KmMyKmMwIC1jMSpjMVxuICAgICAgICApLmdldEN1YmljUm9vdHMoKTtcbiAgICAgICAgdmFyIHkgICAgICAgPSByZXNvbHZlUm9vdHNbMF07XG4gICAgICAgIHZhciBkaXNjcmltID0gYzMqYzMvNCAtIGMyICsgeTtcblxuICAgICAgICBpZiAoIE1hdGguYWJzKGRpc2NyaW0pIDw9IFBvbHlub21pYWwuVE9MRVJBTkNFICkgZGlzY3JpbSA9IDA7XG5cbiAgICAgICAgaWYgKCBkaXNjcmltID4gMCApIHtcbiAgICAgICAgICAgIHZhciBlICAgICA9IE1hdGguc3FydChkaXNjcmltKTtcbiAgICAgICAgICAgIHZhciB0MSAgICA9IDMqYzMqYzMvNCAtIGUqZSAtIDIqYzI7XG4gICAgICAgICAgICB2YXIgdDIgICAgPSAoIDQqYzMqYzIgLSA4KmMxIC0gYzMqYzMqYzMgKSAvICggNCplICk7XG4gICAgICAgICAgICB2YXIgcGx1cyAgPSB0MSt0MjtcbiAgICAgICAgICAgIHZhciBtaW51cyA9IHQxLXQyO1xuXG4gICAgICAgICAgICBpZiAoIE1hdGguYWJzKHBsdXMpICA8PSBQb2x5bm9taWFsLlRPTEVSQU5DRSApIHBsdXMgID0gMDtcbiAgICAgICAgICAgIGlmICggTWF0aC5hYnMobWludXMpIDw9IFBvbHlub21pYWwuVE9MRVJBTkNFICkgbWludXMgPSAwO1xuXG4gICAgICAgICAgICBpZiAoIHBsdXMgPj0gMCApIHtcbiAgICAgICAgICAgICAgICB2YXIgZiA9IE1hdGguc3FydChwbHVzKTtcblxuICAgICAgICAgICAgICAgIHJlc3VsdHMucHVzaCggLWMzLzQgKyAoZStmKS8yICk7XG4gICAgICAgICAgICAgICAgcmVzdWx0cy5wdXNoKCAtYzMvNCArIChlLWYpLzIgKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmICggbWludXMgPj0gMCApIHtcbiAgICAgICAgICAgICAgICB2YXIgZiA9IE1hdGguc3FydChtaW51cyk7XG5cbiAgICAgICAgICAgICAgICByZXN1bHRzLnB1c2goIC1jMy80ICsgKGYtZSkvMiApO1xuICAgICAgICAgICAgICAgIHJlc3VsdHMucHVzaCggLWMzLzQgLSAoZitlKS8yICk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSBpZiAoIGRpc2NyaW0gPCAwICkge1xuICAgICAgICAgICAgLy8gbm8gcm9vdHNcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHZhciB0MiA9IHkqeSAtIDQqYzA7XG5cbiAgICAgICAgICAgIGlmICggdDIgPj0gLVBvbHlub21pYWwuVE9MRVJBTkNFICkge1xuICAgICAgICAgICAgICAgIGlmICggdDIgPCAwICkgdDIgPSAwO1xuXG4gICAgICAgICAgICAgICAgdDIgPSAyKk1hdGguc3FydCh0Mik7XG4gICAgICAgICAgICAgICAgdDEgPSAzKmMzKmMzLzQgLSAyKmMyO1xuICAgICAgICAgICAgICAgIGlmICggdDErdDIgPj0gUG9seW5vbWlhbC5UT0xFUkFOQ0UgKSB7XG4gICAgICAgICAgICAgICAgICAgIHZhciBkID0gTWF0aC5zcXJ0KHQxK3QyKTtcblxuICAgICAgICAgICAgICAgICAgICByZXN1bHRzLnB1c2goIC1jMy80ICsgZC8yICk7XG4gICAgICAgICAgICAgICAgICAgIHJlc3VsdHMucHVzaCggLWMzLzQgLSBkLzIgKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgaWYgKCB0MS10MiA+PSBQb2x5bm9taWFsLlRPTEVSQU5DRSApIHtcbiAgICAgICAgICAgICAgICAgICAgdmFyIGQgPSBNYXRoLnNxcnQodDEtdDIpO1xuXG4gICAgICAgICAgICAgICAgICAgIHJlc3VsdHMucHVzaCggLWMzLzQgKyBkLzIgKTtcbiAgICAgICAgICAgICAgICAgICAgcmVzdWx0cy5wdXNoKCAtYzMvNCAtIGQvMiApO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiByZXN1bHRzO1xufTtcblxuaWYgKHR5cGVvZiBtb2R1bGUgIT09IFwidW5kZWZpbmVkXCIpIHtcbiAgICBtb2R1bGUuZXhwb3J0cyA9IFBvbHlub21pYWw7XG59XG4iLCIvKipcbiAqXG4gKiAgIFNxcnRQb2x5bm9taWFsLmpzXG4gKlxuICogICBjb3B5cmlnaHQgMjAwMywgMjAxMyBLZXZpbiBMaW5kc2V5XG4gKlxuICovXG5cbmlmICh0eXBlb2YgbW9kdWxlICE9PSBcInVuZGVmaW5lZFwiKSB7XG4gICAgdmFyIFBvbHlub21pYWwgPSByZXF1aXJlKFwiLi9Qb2x5bm9taWFsXCIpO1xufVxuXG4vKipcbiAqICAgY2xhc3MgdmFyaWFibGVzXG4gKi9cblNxcnRQb2x5bm9taWFsLlZFUlNJT04gPSAxLjA7XG5cbi8vIHNldHVwIGluaGVyaXRhbmNlXG5TcXJ0UG9seW5vbWlhbC5wcm90b3R5cGUgICAgICAgICAgICAgPSBuZXcgUG9seW5vbWlhbCgpO1xuU3FydFBvbHlub21pYWwucHJvdG90eXBlLmNvbnN0cnVjdG9yID0gU3FydFBvbHlub21pYWw7XG5TcXJ0UG9seW5vbWlhbC5zdXBlcmNsYXNzICAgICAgICAgICAgPSBQb2x5bm9taWFsLnByb3RvdHlwZTtcblxuXG4vKipcbiAqICBTcXJ0UG9seW5vbWlhbFxuICovXG5mdW5jdGlvbiBTcXJ0UG9seW5vbWlhbCgpIHtcbiAgICB0aGlzLmluaXQoIGFyZ3VtZW50cyApO1xufVxuXG5cbi8qKlxuICogIGV2YWxcbiAqXG4gKiAgQHBhcmFtIHtOdW1iZXJ9IHhcbiAqICBAcmV0dXJucyB7TnVtYmVyfVxuICovXG5TcXJ0UG9seW5vbWlhbC5wcm90b3R5cGUuZXZhbCA9IGZ1bmN0aW9uKHgpIHtcbiAgICB2YXIgVE9MRVJBTkNFID0gMWUtNztcbiAgICB2YXIgcmVzdWx0ID0gU3FydFBvbHlub21pYWwuc3VwZXJjbGFzcy5ldmFsLmNhbGwodGhpcywgeCk7XG5cbiAgICAvLyBOT1RFOiBNYXkgbmVlZCB0byBjaGFuZ2UgdGhlIGZvbGxvd2luZy4gIEkgYWRkZWQgdGhlc2UgdG8gY2FwdHVyZVxuICAgIC8vIHNvbWUgcmVhbGx5IHNtYWxsIG5lZ2F0aXZlIHZhbHVlcyB0aGF0IHdlcmUgYmVpbmcgZ2VuZXJhdGVkIGJ5IG9uZVxuICAgIC8vIG9mIG15IEJlemllciBhcmNMZW5ndGggZnVuY3Rpb25zXG4gICAgaWYgKCBNYXRoLmFicyhyZXN1bHQpIDwgVE9MRVJBTkNFICkgcmVzdWx0ID0gMDtcbiAgICBpZiAoIHJlc3VsdCA8IDAgKVxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJTcXJ0UG9seW5vbWlhbC5ldmFsOiBjYW5ub3QgdGFrZSBzcXVhcmUgcm9vdCBvZiBuZWdhdGl2ZSBudW1iZXJcIik7XG5cbiAgICByZXR1cm4gTWF0aC5zcXJ0KHJlc3VsdCk7XG59O1xuXG5TcXJ0UG9seW5vbWlhbC5wcm90b3R5cGUudG9TdHJpbmcgPSBmdW5jdGlvbigpIHtcbiAgICB2YXIgcmVzdWx0ID0gU3FydFBvbHlub21pYWwuc3VwZXJjbGFzcy50b1N0cmluZy5jYWxsKHRoaXMpO1xuXG4gICAgcmV0dXJuIFwic3FydChcIiArIHJlc3VsdCArIFwiKVwiO1xufTtcblxuaWYgKHR5cGVvZiBtb2R1bGUgIT09IFwidW5kZWZpbmVkXCIpIHtcbiAgICBtb2R1bGUuZXhwb3J0cyA9IFNxcnRQb2x5bm9taWFsO1xufVxuIiwiLypcbiAoYykgMjAxMywgVmxhZGltaXIgQWdhZm9ua2luXG4gUkJ1c2gsIGEgSmF2YVNjcmlwdCBsaWJyYXJ5IGZvciBoaWdoLXBlcmZvcm1hbmNlIDJEIHNwYXRpYWwgaW5kZXhpbmcgb2YgcG9pbnRzIGFuZCByZWN0YW5nbGVzLlxuIGh0dHBzOi8vZ2l0aHViLmNvbS9tb3VybmVyL3JidXNoXG4qL1xuXG4oZnVuY3Rpb24gKCkgeyAndXNlIHN0cmljdCc7XG5cbmZ1bmN0aW9uIHJidXNoKG1heEVudHJpZXMsIGZvcm1hdCkge1xuXG4gICAgLy8ganNoaW50IG5ld2NhcDogZmFsc2UsIHZhbGlkdGhpczogdHJ1ZVxuICAgIGlmICghKHRoaXMgaW5zdGFuY2VvZiByYnVzaCkpIHJldHVybiBuZXcgcmJ1c2gobWF4RW50cmllcywgZm9ybWF0KTtcblxuICAgIC8vIG1heCBlbnRyaWVzIGluIGEgbm9kZSBpcyA5IGJ5IGRlZmF1bHQ7IG1pbiBub2RlIGZpbGwgaXMgNDAlIGZvciBiZXN0IHBlcmZvcm1hbmNlXG4gICAgdGhpcy5fbWF4RW50cmllcyA9IE1hdGgubWF4KDQsIG1heEVudHJpZXMgfHwgOSk7XG4gICAgdGhpcy5fbWluRW50cmllcyA9IE1hdGgubWF4KDIsIE1hdGguY2VpbCh0aGlzLl9tYXhFbnRyaWVzICogMC40KSk7XG5cbiAgICBpZiAoZm9ybWF0KSB7XG4gICAgICAgIHRoaXMuX2luaXRGb3JtYXQoZm9ybWF0KTtcbiAgICB9XG5cbiAgICB0aGlzLmNsZWFyKCk7XG59XG5cbnJidXNoLnByb3RvdHlwZSA9IHtcblxuICAgIGFsbDogZnVuY3Rpb24gKCkge1xuICAgICAgICByZXR1cm4gdGhpcy5fYWxsKHRoaXMuZGF0YSwgW10pO1xuICAgIH0sXG5cbiAgICBzZWFyY2g6IGZ1bmN0aW9uIChiYm94KSB7XG5cbiAgICAgICAgdmFyIG5vZGUgPSB0aGlzLmRhdGEsXG4gICAgICAgICAgICByZXN1bHQgPSBbXSxcbiAgICAgICAgICAgIHRvQkJveCA9IHRoaXMudG9CQm94O1xuXG4gICAgICAgIGlmICghaW50ZXJzZWN0cyhiYm94LCBub2RlLmJib3gpKSByZXR1cm4gcmVzdWx0O1xuXG4gICAgICAgIHZhciBub2Rlc1RvU2VhcmNoID0gW10sXG4gICAgICAgICAgICBpLCBsZW4sIGNoaWxkLCBjaGlsZEJCb3g7XG5cbiAgICAgICAgd2hpbGUgKG5vZGUpIHtcbiAgICAgICAgICAgIGZvciAoaSA9IDAsIGxlbiA9IG5vZGUuY2hpbGRyZW4ubGVuZ3RoOyBpIDwgbGVuOyBpKyspIHtcblxuICAgICAgICAgICAgICAgIGNoaWxkID0gbm9kZS5jaGlsZHJlbltpXTtcbiAgICAgICAgICAgICAgICBjaGlsZEJCb3ggPSBub2RlLmxlYWYgPyB0b0JCb3goY2hpbGQpIDogY2hpbGQuYmJveDtcblxuICAgICAgICAgICAgICAgIGlmIChpbnRlcnNlY3RzKGJib3gsIGNoaWxkQkJveCkpIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKG5vZGUubGVhZikgcmVzdWx0LnB1c2goY2hpbGQpO1xuICAgICAgICAgICAgICAgICAgICBlbHNlIGlmIChjb250YWlucyhiYm94LCBjaGlsZEJCb3gpKSB0aGlzLl9hbGwoY2hpbGQsIHJlc3VsdCk7XG4gICAgICAgICAgICAgICAgICAgIGVsc2Ugbm9kZXNUb1NlYXJjaC5wdXNoKGNoaWxkKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBub2RlID0gbm9kZXNUb1NlYXJjaC5wb3AoKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgfSxcblxuICAgIGNvbGxpZGVzOiBmdW5jdGlvbiAoYmJveCkge1xuXG4gICAgICAgIHZhciBub2RlID0gdGhpcy5kYXRhLFxuICAgICAgICAgICAgdG9CQm94ID0gdGhpcy50b0JCb3g7XG5cbiAgICAgICAgaWYgKCFpbnRlcnNlY3RzKGJib3gsIG5vZGUuYmJveCkpIHJldHVybiBmYWxzZTtcblxuICAgICAgICB2YXIgbm9kZXNUb1NlYXJjaCA9IFtdLFxuICAgICAgICAgICAgaSwgbGVuLCBjaGlsZCwgY2hpbGRCQm94O1xuXG4gICAgICAgIHdoaWxlIChub2RlKSB7XG4gICAgICAgICAgICBmb3IgKGkgPSAwLCBsZW4gPSBub2RlLmNoaWxkcmVuLmxlbmd0aDsgaSA8IGxlbjsgaSsrKSB7XG5cbiAgICAgICAgICAgICAgICBjaGlsZCA9IG5vZGUuY2hpbGRyZW5baV07XG4gICAgICAgICAgICAgICAgY2hpbGRCQm94ID0gbm9kZS5sZWFmID8gdG9CQm94KGNoaWxkKSA6IGNoaWxkLmJib3g7XG5cbiAgICAgICAgICAgICAgICBpZiAoaW50ZXJzZWN0cyhiYm94LCBjaGlsZEJCb3gpKSB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChub2RlLmxlYWYgfHwgY29udGFpbnMoYmJveCwgY2hpbGRCQm94KSkgcmV0dXJuIHRydWU7XG4gICAgICAgICAgICAgICAgICAgIG5vZGVzVG9TZWFyY2gucHVzaChjaGlsZCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgbm9kZSA9IG5vZGVzVG9TZWFyY2gucG9wKCk7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgfSxcblxuICAgIGxvYWQ6IGZ1bmN0aW9uIChkYXRhKSB7XG4gICAgICAgIGlmICghKGRhdGEgJiYgZGF0YS5sZW5ndGgpKSByZXR1cm4gdGhpcztcblxuICAgICAgICBpZiAoZGF0YS5sZW5ndGggPCB0aGlzLl9taW5FbnRyaWVzKSB7XG4gICAgICAgICAgICBmb3IgKHZhciBpID0gMCwgbGVuID0gZGF0YS5sZW5ndGg7IGkgPCBsZW47IGkrKykge1xuICAgICAgICAgICAgICAgIHRoaXMuaW5zZXJ0KGRhdGFbaV0pO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgICAgIH1cblxuICAgICAgICAvLyByZWN1cnNpdmVseSBidWlsZCB0aGUgdHJlZSB3aXRoIHRoZSBnaXZlbiBkYXRhIGZyb20gc3RyYXRjaCB1c2luZyBPTVQgYWxnb3JpdGhtXG4gICAgICAgIHZhciBub2RlID0gdGhpcy5fYnVpbGQoZGF0YS5zbGljZSgpLCAwLCBkYXRhLmxlbmd0aCAtIDEsIDApO1xuXG4gICAgICAgIGlmICghdGhpcy5kYXRhLmNoaWxkcmVuLmxlbmd0aCkge1xuICAgICAgICAgICAgLy8gc2F2ZSBhcyBpcyBpZiB0cmVlIGlzIGVtcHR5XG4gICAgICAgICAgICB0aGlzLmRhdGEgPSBub2RlO1xuXG4gICAgICAgIH0gZWxzZSBpZiAodGhpcy5kYXRhLmhlaWdodCA9PT0gbm9kZS5oZWlnaHQpIHtcbiAgICAgICAgICAgIC8vIHNwbGl0IHJvb3QgaWYgdHJlZXMgaGF2ZSB0aGUgc2FtZSBoZWlnaHRcbiAgICAgICAgICAgIHRoaXMuX3NwbGl0Um9vdCh0aGlzLmRhdGEsIG5vZGUpO1xuXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBpZiAodGhpcy5kYXRhLmhlaWdodCA8IG5vZGUuaGVpZ2h0KSB7XG4gICAgICAgICAgICAgICAgLy8gc3dhcCB0cmVlcyBpZiBpbnNlcnRlZCBvbmUgaXMgYmlnZ2VyXG4gICAgICAgICAgICAgICAgdmFyIHRtcE5vZGUgPSB0aGlzLmRhdGE7XG4gICAgICAgICAgICAgICAgdGhpcy5kYXRhID0gbm9kZTtcbiAgICAgICAgICAgICAgICBub2RlID0gdG1wTm9kZTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gaW5zZXJ0IHRoZSBzbWFsbCB0cmVlIGludG8gdGhlIGxhcmdlIHRyZWUgYXQgYXBwcm9wcmlhdGUgbGV2ZWxcbiAgICAgICAgICAgIHRoaXMuX2luc2VydChub2RlLCB0aGlzLmRhdGEuaGVpZ2h0IC0gbm9kZS5oZWlnaHQgLSAxLCB0cnVlKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB0aGlzO1xuICAgIH0sXG5cbiAgICBpbnNlcnQ6IGZ1bmN0aW9uIChpdGVtKSB7XG4gICAgICAgIGlmIChpdGVtKSB0aGlzLl9pbnNlcnQoaXRlbSwgdGhpcy5kYXRhLmhlaWdodCAtIDEpO1xuICAgICAgICByZXR1cm4gdGhpcztcbiAgICB9LFxuXG4gICAgY2xlYXI6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgdGhpcy5kYXRhID0ge1xuICAgICAgICAgICAgY2hpbGRyZW46IFtdLFxuICAgICAgICAgICAgaGVpZ2h0OiAxLFxuICAgICAgICAgICAgYmJveDogZW1wdHkoKSxcbiAgICAgICAgICAgIGxlYWY6IHRydWVcbiAgICAgICAgfTtcbiAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfSxcblxuICAgIHJlbW92ZTogZnVuY3Rpb24gKGl0ZW0pIHtcbiAgICAgICAgaWYgKCFpdGVtKSByZXR1cm4gdGhpcztcblxuICAgICAgICB2YXIgbm9kZSA9IHRoaXMuZGF0YSxcbiAgICAgICAgICAgIGJib3ggPSB0aGlzLnRvQkJveChpdGVtKSxcbiAgICAgICAgICAgIHBhdGggPSBbXSxcbiAgICAgICAgICAgIGluZGV4ZXMgPSBbXSxcbiAgICAgICAgICAgIGksIHBhcmVudCwgaW5kZXgsIGdvaW5nVXA7XG5cbiAgICAgICAgLy8gZGVwdGgtZmlyc3QgaXRlcmF0aXZlIHRyZWUgdHJhdmVyc2FsXG4gICAgICAgIHdoaWxlIChub2RlIHx8IHBhdGgubGVuZ3RoKSB7XG5cbiAgICAgICAgICAgIGlmICghbm9kZSkgeyAvLyBnbyB1cFxuICAgICAgICAgICAgICAgIG5vZGUgPSBwYXRoLnBvcCgpO1xuICAgICAgICAgICAgICAgIHBhcmVudCA9IHBhdGhbcGF0aC5sZW5ndGggLSAxXTtcbiAgICAgICAgICAgICAgICBpID0gaW5kZXhlcy5wb3AoKTtcbiAgICAgICAgICAgICAgICBnb2luZ1VwID0gdHJ1ZTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKG5vZGUubGVhZikgeyAvLyBjaGVjayBjdXJyZW50IG5vZGVcbiAgICAgICAgICAgICAgICBpbmRleCA9IG5vZGUuY2hpbGRyZW4uaW5kZXhPZihpdGVtKTtcblxuICAgICAgICAgICAgICAgIGlmIChpbmRleCAhPT0gLTEpIHtcbiAgICAgICAgICAgICAgICAgICAgLy8gaXRlbSBmb3VuZCwgcmVtb3ZlIHRoZSBpdGVtIGFuZCBjb25kZW5zZSB0cmVlIHVwd2FyZHNcbiAgICAgICAgICAgICAgICAgICAgbm9kZS5jaGlsZHJlbi5zcGxpY2UoaW5kZXgsIDEpO1xuICAgICAgICAgICAgICAgICAgICBwYXRoLnB1c2gobm9kZSk7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX2NvbmRlbnNlKHBhdGgpO1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gdGhpcztcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmICghZ29pbmdVcCAmJiAhbm9kZS5sZWFmICYmIGNvbnRhaW5zKG5vZGUuYmJveCwgYmJveCkpIHsgLy8gZ28gZG93blxuICAgICAgICAgICAgICAgIHBhdGgucHVzaChub2RlKTtcbiAgICAgICAgICAgICAgICBpbmRleGVzLnB1c2goaSk7XG4gICAgICAgICAgICAgICAgaSA9IDA7XG4gICAgICAgICAgICAgICAgcGFyZW50ID0gbm9kZTtcbiAgICAgICAgICAgICAgICBub2RlID0gbm9kZS5jaGlsZHJlblswXTtcblxuICAgICAgICAgICAgfSBlbHNlIGlmIChwYXJlbnQpIHsgLy8gZ28gcmlnaHRcbiAgICAgICAgICAgICAgICBpKys7XG4gICAgICAgICAgICAgICAgbm9kZSA9IHBhcmVudC5jaGlsZHJlbltpXTtcbiAgICAgICAgICAgICAgICBnb2luZ1VwID0gZmFsc2U7XG5cbiAgICAgICAgICAgIH0gZWxzZSBub2RlID0gbnVsbDsgLy8gbm90aGluZyBmb3VuZFxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfSxcblxuICAgIHRvQkJveDogZnVuY3Rpb24gKGl0ZW0pIHsgcmV0dXJuIGl0ZW07IH0sXG5cbiAgICBjb21wYXJlTWluWDogZnVuY3Rpb24gKGEsIGIpIHsgcmV0dXJuIGFbMF0gLSBiWzBdOyB9LFxuICAgIGNvbXBhcmVNaW5ZOiBmdW5jdGlvbiAoYSwgYikgeyByZXR1cm4gYVsxXSAtIGJbMV07IH0sXG5cbiAgICB0b0pTT046IGZ1bmN0aW9uICgpIHsgcmV0dXJuIHRoaXMuZGF0YTsgfSxcblxuICAgIGZyb21KU09OOiBmdW5jdGlvbiAoZGF0YSkge1xuICAgICAgICB0aGlzLmRhdGEgPSBkYXRhO1xuICAgICAgICByZXR1cm4gdGhpcztcbiAgICB9LFxuXG4gICAgX2FsbDogZnVuY3Rpb24gKG5vZGUsIHJlc3VsdCkge1xuICAgICAgICB2YXIgbm9kZXNUb1NlYXJjaCA9IFtdO1xuICAgICAgICB3aGlsZSAobm9kZSkge1xuICAgICAgICAgICAgaWYgKG5vZGUubGVhZikgcmVzdWx0LnB1c2guYXBwbHkocmVzdWx0LCBub2RlLmNoaWxkcmVuKTtcbiAgICAgICAgICAgIGVsc2Ugbm9kZXNUb1NlYXJjaC5wdXNoLmFwcGx5KG5vZGVzVG9TZWFyY2gsIG5vZGUuY2hpbGRyZW4pO1xuXG4gICAgICAgICAgICBub2RlID0gbm9kZXNUb1NlYXJjaC5wb3AoKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gcmVzdWx0O1xuICAgIH0sXG5cbiAgICBfYnVpbGQ6IGZ1bmN0aW9uIChpdGVtcywgbGVmdCwgcmlnaHQsIGhlaWdodCkge1xuXG4gICAgICAgIHZhciBOID0gcmlnaHQgLSBsZWZ0ICsgMSxcbiAgICAgICAgICAgIE0gPSB0aGlzLl9tYXhFbnRyaWVzLFxuICAgICAgICAgICAgbm9kZTtcblxuICAgICAgICBpZiAoTiA8PSBNKSB7XG4gICAgICAgICAgICAvLyByZWFjaGVkIGxlYWYgbGV2ZWw7IHJldHVybiBsZWFmXG4gICAgICAgICAgICBub2RlID0ge1xuICAgICAgICAgICAgICAgIGNoaWxkcmVuOiBpdGVtcy5zbGljZShsZWZ0LCByaWdodCArIDEpLFxuICAgICAgICAgICAgICAgIGhlaWdodDogMSxcbiAgICAgICAgICAgICAgICBiYm94OiBudWxsLFxuICAgICAgICAgICAgICAgIGxlYWY6IHRydWVcbiAgICAgICAgICAgIH07XG4gICAgICAgICAgICBjYWxjQkJveChub2RlLCB0aGlzLnRvQkJveCk7XG4gICAgICAgICAgICByZXR1cm4gbm9kZTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICghaGVpZ2h0KSB7XG4gICAgICAgICAgICAvLyB0YXJnZXQgaGVpZ2h0IG9mIHRoZSBidWxrLWxvYWRlZCB0cmVlXG4gICAgICAgICAgICBoZWlnaHQgPSBNYXRoLmNlaWwoTWF0aC5sb2coTikgLyBNYXRoLmxvZyhNKSk7XG5cbiAgICAgICAgICAgIC8vIHRhcmdldCBudW1iZXIgb2Ygcm9vdCBlbnRyaWVzIHRvIG1heGltaXplIHN0b3JhZ2UgdXRpbGl6YXRpb25cbiAgICAgICAgICAgIE0gPSBNYXRoLmNlaWwoTiAvIE1hdGgucG93KE0sIGhlaWdodCAtIDEpKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFRPRE8gZWxpbWluYXRlIHJlY3Vyc2lvbj9cblxuICAgICAgICBub2RlID0ge1xuICAgICAgICAgICAgY2hpbGRyZW46IFtdLFxuICAgICAgICAgICAgaGVpZ2h0OiBoZWlnaHQsXG4gICAgICAgICAgICBiYm94OiBudWxsXG4gICAgICAgIH07XG5cbiAgICAgICAgLy8gc3BsaXQgdGhlIGl0ZW1zIGludG8gTSBtb3N0bHkgc3F1YXJlIHRpbGVzXG5cbiAgICAgICAgdmFyIE4yID0gTWF0aC5jZWlsKE4gLyBNKSxcbiAgICAgICAgICAgIE4xID0gTjIgKiBNYXRoLmNlaWwoTWF0aC5zcXJ0KE0pKSxcbiAgICAgICAgICAgIGksIGosIHJpZ2h0MiwgcmlnaHQzO1xuXG4gICAgICAgIG11bHRpU2VsZWN0KGl0ZW1zLCBsZWZ0LCByaWdodCwgTjEsIHRoaXMuY29tcGFyZU1pblgpO1xuXG4gICAgICAgIGZvciAoaSA9IGxlZnQ7IGkgPD0gcmlnaHQ7IGkgKz0gTjEpIHtcblxuICAgICAgICAgICAgcmlnaHQyID0gTWF0aC5taW4oaSArIE4xIC0gMSwgcmlnaHQpO1xuXG4gICAgICAgICAgICBtdWx0aVNlbGVjdChpdGVtcywgaSwgcmlnaHQyLCBOMiwgdGhpcy5jb21wYXJlTWluWSk7XG5cbiAgICAgICAgICAgIGZvciAoaiA9IGk7IGogPD0gcmlnaHQyOyBqICs9IE4yKSB7XG5cbiAgICAgICAgICAgICAgICByaWdodDMgPSBNYXRoLm1pbihqICsgTjIgLSAxLCByaWdodDIpO1xuXG4gICAgICAgICAgICAgICAgLy8gcGFjayBlYWNoIGVudHJ5IHJlY3Vyc2l2ZWx5XG4gICAgICAgICAgICAgICAgbm9kZS5jaGlsZHJlbi5wdXNoKHRoaXMuX2J1aWxkKGl0ZW1zLCBqLCByaWdodDMsIGhlaWdodCAtIDEpKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGNhbGNCQm94KG5vZGUsIHRoaXMudG9CQm94KTtcblxuICAgICAgICByZXR1cm4gbm9kZTtcbiAgICB9LFxuXG4gICAgX2Nob29zZVN1YnRyZWU6IGZ1bmN0aW9uIChiYm94LCBub2RlLCBsZXZlbCwgcGF0aCkge1xuXG4gICAgICAgIHZhciBpLCBsZW4sIGNoaWxkLCB0YXJnZXROb2RlLCBhcmVhLCBlbmxhcmdlbWVudCwgbWluQXJlYSwgbWluRW5sYXJnZW1lbnQ7XG5cbiAgICAgICAgd2hpbGUgKHRydWUpIHtcbiAgICAgICAgICAgIHBhdGgucHVzaChub2RlKTtcblxuICAgICAgICAgICAgaWYgKG5vZGUubGVhZiB8fCBwYXRoLmxlbmd0aCAtIDEgPT09IGxldmVsKSBicmVhaztcblxuICAgICAgICAgICAgbWluQXJlYSA9IG1pbkVubGFyZ2VtZW50ID0gSW5maW5pdHk7XG5cbiAgICAgICAgICAgIGZvciAoaSA9IDAsIGxlbiA9IG5vZGUuY2hpbGRyZW4ubGVuZ3RoOyBpIDwgbGVuOyBpKyspIHtcbiAgICAgICAgICAgICAgICBjaGlsZCA9IG5vZGUuY2hpbGRyZW5baV07XG4gICAgICAgICAgICAgICAgYXJlYSA9IGJib3hBcmVhKGNoaWxkLmJib3gpO1xuICAgICAgICAgICAgICAgIGVubGFyZ2VtZW50ID0gZW5sYXJnZWRBcmVhKGJib3gsIGNoaWxkLmJib3gpIC0gYXJlYTtcblxuICAgICAgICAgICAgICAgIC8vIGNob29zZSBlbnRyeSB3aXRoIHRoZSBsZWFzdCBhcmVhIGVubGFyZ2VtZW50XG4gICAgICAgICAgICAgICAgaWYgKGVubGFyZ2VtZW50IDwgbWluRW5sYXJnZW1lbnQpIHtcbiAgICAgICAgICAgICAgICAgICAgbWluRW5sYXJnZW1lbnQgPSBlbmxhcmdlbWVudDtcbiAgICAgICAgICAgICAgICAgICAgbWluQXJlYSA9IGFyZWEgPCBtaW5BcmVhID8gYXJlYSA6IG1pbkFyZWE7XG4gICAgICAgICAgICAgICAgICAgIHRhcmdldE5vZGUgPSBjaGlsZDtcblxuICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAoZW5sYXJnZW1lbnQgPT09IG1pbkVubGFyZ2VtZW50KSB7XG4gICAgICAgICAgICAgICAgICAgIC8vIG90aGVyd2lzZSBjaG9vc2Ugb25lIHdpdGggdGhlIHNtYWxsZXN0IGFyZWFcbiAgICAgICAgICAgICAgICAgICAgaWYgKGFyZWEgPCBtaW5BcmVhKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBtaW5BcmVhID0gYXJlYTtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRhcmdldE5vZGUgPSBjaGlsZDtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgbm9kZSA9IHRhcmdldE5vZGU7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gbm9kZTtcbiAgICB9LFxuXG4gICAgX2luc2VydDogZnVuY3Rpb24gKGl0ZW0sIGxldmVsLCBpc05vZGUpIHtcblxuICAgICAgICB2YXIgdG9CQm94ID0gdGhpcy50b0JCb3gsXG4gICAgICAgICAgICBiYm94ID0gaXNOb2RlID8gaXRlbS5iYm94IDogdG9CQm94KGl0ZW0pLFxuICAgICAgICAgICAgaW5zZXJ0UGF0aCA9IFtdO1xuXG4gICAgICAgIC8vIGZpbmQgdGhlIGJlc3Qgbm9kZSBmb3IgYWNjb21tb2RhdGluZyB0aGUgaXRlbSwgc2F2aW5nIGFsbCBub2RlcyBhbG9uZyB0aGUgcGF0aCB0b29cbiAgICAgICAgdmFyIG5vZGUgPSB0aGlzLl9jaG9vc2VTdWJ0cmVlKGJib3gsIHRoaXMuZGF0YSwgbGV2ZWwsIGluc2VydFBhdGgpO1xuXG4gICAgICAgIC8vIHB1dCB0aGUgaXRlbSBpbnRvIHRoZSBub2RlXG4gICAgICAgIG5vZGUuY2hpbGRyZW4ucHVzaChpdGVtKTtcbiAgICAgICAgZXh0ZW5kKG5vZGUuYmJveCwgYmJveCk7XG5cbiAgICAgICAgLy8gc3BsaXQgb24gbm9kZSBvdmVyZmxvdzsgcHJvcGFnYXRlIHVwd2FyZHMgaWYgbmVjZXNzYXJ5XG4gICAgICAgIHdoaWxlIChsZXZlbCA+PSAwKSB7XG4gICAgICAgICAgICBpZiAoaW5zZXJ0UGF0aFtsZXZlbF0uY2hpbGRyZW4ubGVuZ3RoID4gdGhpcy5fbWF4RW50cmllcykge1xuICAgICAgICAgICAgICAgIHRoaXMuX3NwbGl0KGluc2VydFBhdGgsIGxldmVsKTtcbiAgICAgICAgICAgICAgICBsZXZlbC0tO1xuICAgICAgICAgICAgfSBlbHNlIGJyZWFrO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gYWRqdXN0IGJib3hlcyBhbG9uZyB0aGUgaW5zZXJ0aW9uIHBhdGhcbiAgICAgICAgdGhpcy5fYWRqdXN0UGFyZW50QkJveGVzKGJib3gsIGluc2VydFBhdGgsIGxldmVsKTtcbiAgICB9LFxuXG4gICAgLy8gc3BsaXQgb3ZlcmZsb3dlZCBub2RlIGludG8gdHdvXG4gICAgX3NwbGl0OiBmdW5jdGlvbiAoaW5zZXJ0UGF0aCwgbGV2ZWwpIHtcblxuICAgICAgICB2YXIgbm9kZSA9IGluc2VydFBhdGhbbGV2ZWxdLFxuICAgICAgICAgICAgTSA9IG5vZGUuY2hpbGRyZW4ubGVuZ3RoLFxuICAgICAgICAgICAgbSA9IHRoaXMuX21pbkVudHJpZXM7XG5cbiAgICAgICAgdGhpcy5fY2hvb3NlU3BsaXRBeGlzKG5vZGUsIG0sIE0pO1xuXG4gICAgICAgIHZhciBuZXdOb2RlID0ge1xuICAgICAgICAgICAgY2hpbGRyZW46IG5vZGUuY2hpbGRyZW4uc3BsaWNlKHRoaXMuX2Nob29zZVNwbGl0SW5kZXgobm9kZSwgbSwgTSkpLFxuICAgICAgICAgICAgaGVpZ2h0OiBub2RlLmhlaWdodFxuICAgICAgICB9O1xuXG4gICAgICAgIGlmIChub2RlLmxlYWYpIG5ld05vZGUubGVhZiA9IHRydWU7XG5cbiAgICAgICAgY2FsY0JCb3gobm9kZSwgdGhpcy50b0JCb3gpO1xuICAgICAgICBjYWxjQkJveChuZXdOb2RlLCB0aGlzLnRvQkJveCk7XG5cbiAgICAgICAgaWYgKGxldmVsKSBpbnNlcnRQYXRoW2xldmVsIC0gMV0uY2hpbGRyZW4ucHVzaChuZXdOb2RlKTtcbiAgICAgICAgZWxzZSB0aGlzLl9zcGxpdFJvb3Qobm9kZSwgbmV3Tm9kZSk7XG4gICAgfSxcblxuICAgIF9zcGxpdFJvb3Q6IGZ1bmN0aW9uIChub2RlLCBuZXdOb2RlKSB7XG4gICAgICAgIC8vIHNwbGl0IHJvb3Qgbm9kZVxuICAgICAgICB0aGlzLmRhdGEgPSB7XG4gICAgICAgICAgICBjaGlsZHJlbjogW25vZGUsIG5ld05vZGVdLFxuICAgICAgICAgICAgaGVpZ2h0OiBub2RlLmhlaWdodCArIDFcbiAgICAgICAgfTtcbiAgICAgICAgY2FsY0JCb3godGhpcy5kYXRhLCB0aGlzLnRvQkJveCk7XG4gICAgfSxcblxuICAgIF9jaG9vc2VTcGxpdEluZGV4OiBmdW5jdGlvbiAobm9kZSwgbSwgTSkge1xuXG4gICAgICAgIHZhciBpLCBiYm94MSwgYmJveDIsIG92ZXJsYXAsIGFyZWEsIG1pbk92ZXJsYXAsIG1pbkFyZWEsIGluZGV4O1xuXG4gICAgICAgIG1pbk92ZXJsYXAgPSBtaW5BcmVhID0gSW5maW5pdHk7XG5cbiAgICAgICAgZm9yIChpID0gbTsgaSA8PSBNIC0gbTsgaSsrKSB7XG4gICAgICAgICAgICBiYm94MSA9IGRpc3RCQm94KG5vZGUsIDAsIGksIHRoaXMudG9CQm94KTtcbiAgICAgICAgICAgIGJib3gyID0gZGlzdEJCb3gobm9kZSwgaSwgTSwgdGhpcy50b0JCb3gpO1xuXG4gICAgICAgICAgICBvdmVybGFwID0gaW50ZXJzZWN0aW9uQXJlYShiYm94MSwgYmJveDIpO1xuICAgICAgICAgICAgYXJlYSA9IGJib3hBcmVhKGJib3gxKSArIGJib3hBcmVhKGJib3gyKTtcblxuICAgICAgICAgICAgLy8gY2hvb3NlIGRpc3RyaWJ1dGlvbiB3aXRoIG1pbmltdW0gb3ZlcmxhcFxuICAgICAgICAgICAgaWYgKG92ZXJsYXAgPCBtaW5PdmVybGFwKSB7XG4gICAgICAgICAgICAgICAgbWluT3ZlcmxhcCA9IG92ZXJsYXA7XG4gICAgICAgICAgICAgICAgaW5kZXggPSBpO1xuXG4gICAgICAgICAgICAgICAgbWluQXJlYSA9IGFyZWEgPCBtaW5BcmVhID8gYXJlYSA6IG1pbkFyZWE7XG5cbiAgICAgICAgICAgIH0gZWxzZSBpZiAob3ZlcmxhcCA9PT0gbWluT3ZlcmxhcCkge1xuICAgICAgICAgICAgICAgIC8vIG90aGVyd2lzZSBjaG9vc2UgZGlzdHJpYnV0aW9uIHdpdGggbWluaW11bSBhcmVhXG4gICAgICAgICAgICAgICAgaWYgKGFyZWEgPCBtaW5BcmVhKSB7XG4gICAgICAgICAgICAgICAgICAgIG1pbkFyZWEgPSBhcmVhO1xuICAgICAgICAgICAgICAgICAgICBpbmRleCA9IGk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIGluZGV4O1xuICAgIH0sXG5cbiAgICAvLyBzb3J0cyBub2RlIGNoaWxkcmVuIGJ5IHRoZSBiZXN0IGF4aXMgZm9yIHNwbGl0XG4gICAgX2Nob29zZVNwbGl0QXhpczogZnVuY3Rpb24gKG5vZGUsIG0sIE0pIHtcblxuICAgICAgICB2YXIgY29tcGFyZU1pblggPSBub2RlLmxlYWYgPyB0aGlzLmNvbXBhcmVNaW5YIDogY29tcGFyZU5vZGVNaW5YLFxuICAgICAgICAgICAgY29tcGFyZU1pblkgPSBub2RlLmxlYWYgPyB0aGlzLmNvbXBhcmVNaW5ZIDogY29tcGFyZU5vZGVNaW5ZLFxuICAgICAgICAgICAgeE1hcmdpbiA9IHRoaXMuX2FsbERpc3RNYXJnaW4obm9kZSwgbSwgTSwgY29tcGFyZU1pblgpLFxuICAgICAgICAgICAgeU1hcmdpbiA9IHRoaXMuX2FsbERpc3RNYXJnaW4obm9kZSwgbSwgTSwgY29tcGFyZU1pblkpO1xuXG4gICAgICAgIC8vIGlmIHRvdGFsIGRpc3RyaWJ1dGlvbnMgbWFyZ2luIHZhbHVlIGlzIG1pbmltYWwgZm9yIHgsIHNvcnQgYnkgbWluWCxcbiAgICAgICAgLy8gb3RoZXJ3aXNlIGl0J3MgYWxyZWFkeSBzb3J0ZWQgYnkgbWluWVxuICAgICAgICBpZiAoeE1hcmdpbiA8IHlNYXJnaW4pIG5vZGUuY2hpbGRyZW4uc29ydChjb21wYXJlTWluWCk7XG4gICAgfSxcblxuICAgIC8vIHRvdGFsIG1hcmdpbiBvZiBhbGwgcG9zc2libGUgc3BsaXQgZGlzdHJpYnV0aW9ucyB3aGVyZSBlYWNoIG5vZGUgaXMgYXQgbGVhc3QgbSBmdWxsXG4gICAgX2FsbERpc3RNYXJnaW46IGZ1bmN0aW9uIChub2RlLCBtLCBNLCBjb21wYXJlKSB7XG5cbiAgICAgICAgbm9kZS5jaGlsZHJlbi5zb3J0KGNvbXBhcmUpO1xuXG4gICAgICAgIHZhciB0b0JCb3ggPSB0aGlzLnRvQkJveCxcbiAgICAgICAgICAgIGxlZnRCQm94ID0gZGlzdEJCb3gobm9kZSwgMCwgbSwgdG9CQm94KSxcbiAgICAgICAgICAgIHJpZ2h0QkJveCA9IGRpc3RCQm94KG5vZGUsIE0gLSBtLCBNLCB0b0JCb3gpLFxuICAgICAgICAgICAgbWFyZ2luID0gYmJveE1hcmdpbihsZWZ0QkJveCkgKyBiYm94TWFyZ2luKHJpZ2h0QkJveCksXG4gICAgICAgICAgICBpLCBjaGlsZDtcblxuICAgICAgICBmb3IgKGkgPSBtOyBpIDwgTSAtIG07IGkrKykge1xuICAgICAgICAgICAgY2hpbGQgPSBub2RlLmNoaWxkcmVuW2ldO1xuICAgICAgICAgICAgZXh0ZW5kKGxlZnRCQm94LCBub2RlLmxlYWYgPyB0b0JCb3goY2hpbGQpIDogY2hpbGQuYmJveCk7XG4gICAgICAgICAgICBtYXJnaW4gKz0gYmJveE1hcmdpbihsZWZ0QkJveCk7XG4gICAgICAgIH1cblxuICAgICAgICBmb3IgKGkgPSBNIC0gbSAtIDE7IGkgPj0gbTsgaS0tKSB7XG4gICAgICAgICAgICBjaGlsZCA9IG5vZGUuY2hpbGRyZW5baV07XG4gICAgICAgICAgICBleHRlbmQocmlnaHRCQm94LCBub2RlLmxlYWYgPyB0b0JCb3goY2hpbGQpIDogY2hpbGQuYmJveCk7XG4gICAgICAgICAgICBtYXJnaW4gKz0gYmJveE1hcmdpbihyaWdodEJCb3gpO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIG1hcmdpbjtcbiAgICB9LFxuXG4gICAgX2FkanVzdFBhcmVudEJCb3hlczogZnVuY3Rpb24gKGJib3gsIHBhdGgsIGxldmVsKSB7XG4gICAgICAgIC8vIGFkanVzdCBiYm94ZXMgYWxvbmcgdGhlIGdpdmVuIHRyZWUgcGF0aFxuICAgICAgICBmb3IgKHZhciBpID0gbGV2ZWw7IGkgPj0gMDsgaS0tKSB7XG4gICAgICAgICAgICBleHRlbmQocGF0aFtpXS5iYm94LCBiYm94KTtcbiAgICAgICAgfVxuICAgIH0sXG5cbiAgICBfY29uZGVuc2U6IGZ1bmN0aW9uIChwYXRoKSB7XG4gICAgICAgIC8vIGdvIHRocm91Z2ggdGhlIHBhdGgsIHJlbW92aW5nIGVtcHR5IG5vZGVzIGFuZCB1cGRhdGluZyBiYm94ZXNcbiAgICAgICAgZm9yICh2YXIgaSA9IHBhdGgubGVuZ3RoIC0gMSwgc2libGluZ3M7IGkgPj0gMDsgaS0tKSB7XG4gICAgICAgICAgICBpZiAocGF0aFtpXS5jaGlsZHJlbi5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgICAgICBpZiAoaSA+IDApIHtcbiAgICAgICAgICAgICAgICAgICAgc2libGluZ3MgPSBwYXRoW2kgLSAxXS5jaGlsZHJlbjtcbiAgICAgICAgICAgICAgICAgICAgc2libGluZ3Muc3BsaWNlKHNpYmxpbmdzLmluZGV4T2YocGF0aFtpXSksIDEpO1xuXG4gICAgICAgICAgICAgICAgfSBlbHNlIHRoaXMuY2xlYXIoKTtcblxuICAgICAgICAgICAgfSBlbHNlIGNhbGNCQm94KHBhdGhbaV0sIHRoaXMudG9CQm94KTtcbiAgICAgICAgfVxuICAgIH0sXG5cbiAgICBfaW5pdEZvcm1hdDogZnVuY3Rpb24gKGZvcm1hdCkge1xuICAgICAgICAvLyBkYXRhIGZvcm1hdCAobWluWCwgbWluWSwgbWF4WCwgbWF4WSBhY2Nlc3NvcnMpXG5cbiAgICAgICAgLy8gdXNlcyBldmFsLXR5cGUgZnVuY3Rpb24gY29tcGlsYXRpb24gaW5zdGVhZCBvZiBqdXN0IGFjY2VwdGluZyBhIHRvQkJveCBmdW5jdGlvblxuICAgICAgICAvLyBiZWNhdXNlIHRoZSBhbGdvcml0aG1zIGFyZSB2ZXJ5IHNlbnNpdGl2ZSB0byBzb3J0aW5nIGZ1bmN0aW9ucyBwZXJmb3JtYW5jZSxcbiAgICAgICAgLy8gc28gdGhleSBzaG91bGQgYmUgZGVhZCBzaW1wbGUgYW5kIHdpdGhvdXQgaW5uZXIgY2FsbHNcblxuICAgICAgICAvLyBqc2hpbnQgZXZpbDogdHJ1ZVxuXG4gICAgICAgIHZhciBjb21wYXJlQXJyID0gWydyZXR1cm4gYScsICcgLSBiJywgJzsnXTtcblxuICAgICAgICB0aGlzLmNvbXBhcmVNaW5YID0gbmV3IEZ1bmN0aW9uKCdhJywgJ2InLCBjb21wYXJlQXJyLmpvaW4oZm9ybWF0WzBdKSk7XG4gICAgICAgIHRoaXMuY29tcGFyZU1pblkgPSBuZXcgRnVuY3Rpb24oJ2EnLCAnYicsIGNvbXBhcmVBcnIuam9pbihmb3JtYXRbMV0pKTtcblxuICAgICAgICB0aGlzLnRvQkJveCA9IG5ldyBGdW5jdGlvbignYScsICdyZXR1cm4gW2EnICsgZm9ybWF0LmpvaW4oJywgYScpICsgJ107Jyk7XG4gICAgfVxufTtcblxuXG4vLyBjYWxjdWxhdGUgbm9kZSdzIGJib3ggZnJvbSBiYm94ZXMgb2YgaXRzIGNoaWxkcmVuXG5mdW5jdGlvbiBjYWxjQkJveChub2RlLCB0b0JCb3gpIHtcbiAgICBub2RlLmJib3ggPSBkaXN0QkJveChub2RlLCAwLCBub2RlLmNoaWxkcmVuLmxlbmd0aCwgdG9CQm94KTtcbn1cblxuLy8gbWluIGJvdW5kaW5nIHJlY3RhbmdsZSBvZiBub2RlIGNoaWxkcmVuIGZyb20gayB0byBwLTFcbmZ1bmN0aW9uIGRpc3RCQm94KG5vZGUsIGssIHAsIHRvQkJveCkge1xuICAgIHZhciBiYm94ID0gZW1wdHkoKTtcblxuICAgIGZvciAodmFyIGkgPSBrLCBjaGlsZDsgaSA8IHA7IGkrKykge1xuICAgICAgICBjaGlsZCA9IG5vZGUuY2hpbGRyZW5baV07XG4gICAgICAgIGV4dGVuZChiYm94LCBub2RlLmxlYWYgPyB0b0JCb3goY2hpbGQpIDogY2hpbGQuYmJveCk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGJib3g7XG59XG5cbmZ1bmN0aW9uIGVtcHR5KCkgeyByZXR1cm4gW0luZmluaXR5LCBJbmZpbml0eSwgLUluZmluaXR5LCAtSW5maW5pdHldOyB9XG5cbmZ1bmN0aW9uIGV4dGVuZChhLCBiKSB7XG4gICAgYVswXSA9IE1hdGgubWluKGFbMF0sIGJbMF0pO1xuICAgIGFbMV0gPSBNYXRoLm1pbihhWzFdLCBiWzFdKTtcbiAgICBhWzJdID0gTWF0aC5tYXgoYVsyXSwgYlsyXSk7XG4gICAgYVszXSA9IE1hdGgubWF4KGFbM10sIGJbM10pO1xuICAgIHJldHVybiBhO1xufVxuXG5mdW5jdGlvbiBjb21wYXJlTm9kZU1pblgoYSwgYikgeyByZXR1cm4gYS5iYm94WzBdIC0gYi5iYm94WzBdOyB9XG5mdW5jdGlvbiBjb21wYXJlTm9kZU1pblkoYSwgYikgeyByZXR1cm4gYS5iYm94WzFdIC0gYi5iYm94WzFdOyB9XG5cbmZ1bmN0aW9uIGJib3hBcmVhKGEpICAgeyByZXR1cm4gKGFbMl0gLSBhWzBdKSAqIChhWzNdIC0gYVsxXSk7IH1cbmZ1bmN0aW9uIGJib3hNYXJnaW4oYSkgeyByZXR1cm4gKGFbMl0gLSBhWzBdKSArIChhWzNdIC0gYVsxXSk7IH1cblxuZnVuY3Rpb24gZW5sYXJnZWRBcmVhKGEsIGIpIHtcbiAgICByZXR1cm4gKE1hdGgubWF4KGJbMl0sIGFbMl0pIC0gTWF0aC5taW4oYlswXSwgYVswXSkpICpcbiAgICAgICAgICAgKE1hdGgubWF4KGJbM10sIGFbM10pIC0gTWF0aC5taW4oYlsxXSwgYVsxXSkpO1xufVxuXG5mdW5jdGlvbiBpbnRlcnNlY3Rpb25BcmVhKGEsIGIpIHtcbiAgICB2YXIgbWluWCA9IE1hdGgubWF4KGFbMF0sIGJbMF0pLFxuICAgICAgICBtaW5ZID0gTWF0aC5tYXgoYVsxXSwgYlsxXSksXG4gICAgICAgIG1heFggPSBNYXRoLm1pbihhWzJdLCBiWzJdKSxcbiAgICAgICAgbWF4WSA9IE1hdGgubWluKGFbM10sIGJbM10pO1xuXG4gICAgcmV0dXJuIE1hdGgubWF4KDAsIG1heFggLSBtaW5YKSAqXG4gICAgICAgICAgIE1hdGgubWF4KDAsIG1heFkgLSBtaW5ZKTtcbn1cblxuZnVuY3Rpb24gY29udGFpbnMoYSwgYikge1xuICAgIHJldHVybiBhWzBdIDw9IGJbMF0gJiZcbiAgICAgICAgICAgYVsxXSA8PSBiWzFdICYmXG4gICAgICAgICAgIGJbMl0gPD0gYVsyXSAmJlxuICAgICAgICAgICBiWzNdIDw9IGFbM107XG59XG5cbmZ1bmN0aW9uIGludGVyc2VjdHMoYSwgYikge1xuICAgIHJldHVybiBiWzBdIDw9IGFbMl0gJiZcbiAgICAgICAgICAgYlsxXSA8PSBhWzNdICYmXG4gICAgICAgICAgIGJbMl0gPj0gYVswXSAmJlxuICAgICAgICAgICBiWzNdID49IGFbMV07XG59XG5cbi8vIHNvcnQgYW4gYXJyYXkgc28gdGhhdCBpdGVtcyBjb21lIGluIGdyb3VwcyBvZiBuIHVuc29ydGVkIGl0ZW1zLCB3aXRoIGdyb3VwcyBzb3J0ZWQgYmV0d2VlbiBlYWNoIG90aGVyO1xuLy8gY29tYmluZXMgc2VsZWN0aW9uIGFsZ29yaXRobSB3aXRoIGJpbmFyeSBkaXZpZGUgJiBjb25xdWVyIGFwcHJvYWNoXG5cbmZ1bmN0aW9uIG11bHRpU2VsZWN0KGFyciwgbGVmdCwgcmlnaHQsIG4sIGNvbXBhcmUpIHtcbiAgICB2YXIgc3RhY2sgPSBbbGVmdCwgcmlnaHRdLFxuICAgICAgICBtaWQ7XG5cbiAgICB3aGlsZSAoc3RhY2subGVuZ3RoKSB7XG4gICAgICAgIHJpZ2h0ID0gc3RhY2sucG9wKCk7XG4gICAgICAgIGxlZnQgPSBzdGFjay5wb3AoKTtcblxuICAgICAgICBpZiAocmlnaHQgLSBsZWZ0IDw9IG4pIGNvbnRpbnVlO1xuXG4gICAgICAgIG1pZCA9IGxlZnQgKyBNYXRoLmNlaWwoKHJpZ2h0IC0gbGVmdCkgLyBuIC8gMikgKiBuO1xuICAgICAgICBzZWxlY3QoYXJyLCBsZWZ0LCByaWdodCwgbWlkLCBjb21wYXJlKTtcblxuICAgICAgICBzdGFjay5wdXNoKGxlZnQsIG1pZCwgbWlkLCByaWdodCk7XG4gICAgfVxufVxuXG4vLyBGbG95ZC1SaXZlc3Qgc2VsZWN0aW9uIGFsZ29yaXRobTpcbi8vIHNvcnQgYW4gYXJyYXkgYmV0d2VlbiBsZWZ0IGFuZCByaWdodCAoaW5jbHVzaXZlKSBzbyB0aGF0IHRoZSBzbWFsbGVzdCBrIGVsZW1lbnRzIGNvbWUgZmlyc3QgKHVub3JkZXJlZClcbmZ1bmN0aW9uIHNlbGVjdChhcnIsIGxlZnQsIHJpZ2h0LCBrLCBjb21wYXJlKSB7XG4gICAgdmFyIG4sIGksIHosIHMsIHNkLCBuZXdMZWZ0LCBuZXdSaWdodCwgdCwgajtcblxuICAgIHdoaWxlIChyaWdodCA+IGxlZnQpIHtcbiAgICAgICAgaWYgKHJpZ2h0IC0gbGVmdCA+IDYwMCkge1xuICAgICAgICAgICAgbiA9IHJpZ2h0IC0gbGVmdCArIDE7XG4gICAgICAgICAgICBpID0gayAtIGxlZnQgKyAxO1xuICAgICAgICAgICAgeiA9IE1hdGgubG9nKG4pO1xuICAgICAgICAgICAgcyA9IDAuNSAqIE1hdGguZXhwKDIgKiB6IC8gMyk7XG4gICAgICAgICAgICBzZCA9IDAuNSAqIE1hdGguc3FydCh6ICogcyAqIChuIC0gcykgLyBuKSAqIChpIC0gbiAvIDIgPCAwID8gLTEgOiAxKTtcbiAgICAgICAgICAgIG5ld0xlZnQgPSBNYXRoLm1heChsZWZ0LCBNYXRoLmZsb29yKGsgLSBpICogcyAvIG4gKyBzZCkpO1xuICAgICAgICAgICAgbmV3UmlnaHQgPSBNYXRoLm1pbihyaWdodCwgTWF0aC5mbG9vcihrICsgKG4gLSBpKSAqIHMgLyBuICsgc2QpKTtcbiAgICAgICAgICAgIHNlbGVjdChhcnIsIG5ld0xlZnQsIG5ld1JpZ2h0LCBrLCBjb21wYXJlKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHQgPSBhcnJba107XG4gICAgICAgIGkgPSBsZWZ0O1xuICAgICAgICBqID0gcmlnaHQ7XG5cbiAgICAgICAgc3dhcChhcnIsIGxlZnQsIGspO1xuICAgICAgICBpZiAoY29tcGFyZShhcnJbcmlnaHRdLCB0KSA+IDApIHN3YXAoYXJyLCBsZWZ0LCByaWdodCk7XG5cbiAgICAgICAgd2hpbGUgKGkgPCBqKSB7XG4gICAgICAgICAgICBzd2FwKGFyciwgaSwgaik7XG4gICAgICAgICAgICBpKys7XG4gICAgICAgICAgICBqLS07XG4gICAgICAgICAgICB3aGlsZSAoY29tcGFyZShhcnJbaV0sIHQpIDwgMCkgaSsrO1xuICAgICAgICAgICAgd2hpbGUgKGNvbXBhcmUoYXJyW2pdLCB0KSA+IDApIGotLTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChjb21wYXJlKGFycltsZWZ0XSwgdCkgPT09IDApIHN3YXAoYXJyLCBsZWZ0LCBqKTtcbiAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICBqKys7XG4gICAgICAgICAgICBzd2FwKGFyciwgaiwgcmlnaHQpO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGogPD0gaykgbGVmdCA9IGogKyAxO1xuICAgICAgICBpZiAoayA8PSBqKSByaWdodCA9IGogLSAxO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gc3dhcChhcnIsIGksIGopIHtcbiAgICB2YXIgdG1wID0gYXJyW2ldO1xuICAgIGFycltpXSA9IGFycltqXTtcbiAgICBhcnJbal0gPSB0bXA7XG59XG5cblxuLy8gZXhwb3J0IGFzIEFNRC9Db21tb25KUyBtb2R1bGUgb3IgZ2xvYmFsIHZhcmlhYmxlXG5pZiAodHlwZW9mIGRlZmluZSA9PT0gJ2Z1bmN0aW9uJyAmJiBkZWZpbmUuYW1kKSBkZWZpbmUoJ3JidXNoJywgZnVuY3Rpb24oKSB7IHJldHVybiByYnVzaDsgfSk7XG5lbHNlIGlmICh0eXBlb2YgbW9kdWxlICE9PSAndW5kZWZpbmVkJykgbW9kdWxlLmV4cG9ydHMgPSByYnVzaDtcbmVsc2UgaWYgKHR5cGVvZiBzZWxmICE9PSAndW5kZWZpbmVkJykgc2VsZi5yYnVzaCA9IHJidXNoO1xuZWxzZSB3aW5kb3cucmJ1c2ggPSByYnVzaDtcblxufSkoKTtcbiJdfQ==
