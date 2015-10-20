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
    url: "events",
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
//# sourceMappingURL=data:application/json;charset:utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL0FwcERhdGEvUm9hbWluZy9ucG0vbm9kZV9tb2R1bGVzL2Jyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2Jyb3dzZXItcGFjay9fcHJlbHVkZS5qcyIsIi4uLy4uL0FwcERhdGEvUm9hbWluZy9ucG0vbm9kZV9tb2R1bGVzL2Jyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2J1ZmZlci9pbmRleC5qcyIsIi4uLy4uL0FwcERhdGEvUm9hbWluZy9ucG0vbm9kZV9tb2R1bGVzL2Jyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2J1ZmZlci9ub2RlX21vZHVsZXMvYmFzZTY0LWpzL2xpYi9iNjQuanMiLCIuLi8uLi9BcHBEYXRhL1JvYW1pbmcvbnBtL25vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9idWZmZXIvbm9kZV9tb2R1bGVzL2llZWU3NTQvaW5kZXguanMiLCIuLi8uLi9BcHBEYXRhL1JvYW1pbmcvbnBtL25vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9idWZmZXIvbm9kZV9tb2R1bGVzL2lzLWFycmF5L2luZGV4LmpzIiwiLi4vLi4vQXBwRGF0YS9Sb2FtaW5nL25wbS9ub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvcHJvY2Vzcy9icm93c2VyLmpzIiwianMvYXBwL0NvbmZpZy5qcyIsImpzL2FwcC9HdWkuanMiLCJqcy9hcHAvSG90U3BvdC5qcyIsImpzL2FwcC9JbmRleC5qcyIsImpzL2FwcC9MaXZlU3RyZWFtLmpzIiwianMvYXBwL01vdmluZ0NhbS5qcyIsImpzL2FwcC9QYXJ0aWNpcGFudC5qcyIsImpzL2FwcC9Qb2ludC5qcyIsImpzL2FwcC9TdHlsZXMuanMiLCJqcy9hcHAvVHJhY2suanMiLCJqcy9hcHAvVXRpbHMuanMiLCJub2RlX21vZHVsZXMvYmludHJlZXMvaW5kZXguanMiLCJub2RlX21vZHVsZXMvYmludHJlZXMvbGliL2JpbnRyZWUuanMiLCJub2RlX21vZHVsZXMvYmludHJlZXMvbGliL3JidHJlZS5qcyIsIm5vZGVfbW9kdWxlcy9iaW50cmVlcy9saWIvdHJlZWJhc2UuanMiLCJub2RlX21vZHVsZXMvam9vc2Uvam9vc2UtYWxsLmpzIiwibm9kZV9tb2R1bGVzL2tsZC1pbnRlcnNlY3Rpb25zL2luZGV4LmpzIiwibm9kZV9tb2R1bGVzL2tsZC1pbnRlcnNlY3Rpb25zL2xpYi9JbnRlcnNlY3Rpb24uanMiLCJub2RlX21vZHVsZXMva2xkLWludGVyc2VjdGlvbnMvbGliL0ludGVyc2VjdGlvblBhcmFtcy5qcyIsIm5vZGVfbW9kdWxlcy9rbGQtaW50ZXJzZWN0aW9ucy9ub2RlX21vZHVsZXMva2xkLWFmZmluZS9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9rbGQtaW50ZXJzZWN0aW9ucy9ub2RlX21vZHVsZXMva2xkLWFmZmluZS9saWIvTWF0cml4MkQuanMiLCJub2RlX21vZHVsZXMva2xkLWludGVyc2VjdGlvbnMvbm9kZV9tb2R1bGVzL2tsZC1hZmZpbmUvbGliL1BvaW50MkQuanMiLCJub2RlX21vZHVsZXMva2xkLWludGVyc2VjdGlvbnMvbm9kZV9tb2R1bGVzL2tsZC1hZmZpbmUvbGliL1ZlY3RvcjJELmpzIiwibm9kZV9tb2R1bGVzL2tsZC1pbnRlcnNlY3Rpb25zL25vZGVfbW9kdWxlcy9rbGQtcG9seW5vbWlhbC9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9rbGQtaW50ZXJzZWN0aW9ucy9ub2RlX21vZHVsZXMva2xkLXBvbHlub21pYWwvbGliL1BvbHlub21pYWwuanMiLCJub2RlX21vZHVsZXMva2xkLWludGVyc2VjdGlvbnMvbm9kZV9tb2R1bGVzL2tsZC1wb2x5bm9taWFsL2xpYi9TcXJ0UG9seW5vbWlhbC5qcyIsIm5vZGVfbW9kdWxlcy9yYnVzaC9yYnVzaC5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTtBQ0FBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzc1Q0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM1SEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDcEZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2pDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMxRkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BIQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzFrQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbkRBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDekhBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDL0hBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1pBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDaHhCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN2Q0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNwa0JBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7OztBQzVaQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7O0FDOWpCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ0pBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzVHQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDMU5BO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7QUN2T0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7OztBQ2pwR0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNQQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2x1REE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2hDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDTEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN4YUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMvS0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDMU9BO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDSkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdG5CQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM1REE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EiLCJmaWxlIjoiZ2VuZXJhdGVkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXNDb250ZW50IjpbIihmdW5jdGlvbiBlKHQsbixyKXtmdW5jdGlvbiBzKG8sdSl7aWYoIW5bb10pe2lmKCF0W29dKXt2YXIgYT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2lmKCF1JiZhKXJldHVybiBhKG8sITApO2lmKGkpcmV0dXJuIGkobywhMCk7dmFyIGY9bmV3IEVycm9yKFwiQ2Fubm90IGZpbmQgbW9kdWxlICdcIitvK1wiJ1wiKTt0aHJvdyBmLmNvZGU9XCJNT0RVTEVfTk9UX0ZPVU5EXCIsZn12YXIgbD1uW29dPXtleHBvcnRzOnt9fTt0W29dWzBdLmNhbGwobC5leHBvcnRzLGZ1bmN0aW9uKGUpe3ZhciBuPXRbb11bMV1bZV07cmV0dXJuIHMobj9uOmUpfSxsLGwuZXhwb3J0cyxlLHQsbixyKX1yZXR1cm4gbltvXS5leHBvcnRzfXZhciBpPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7Zm9yKHZhciBvPTA7bzxyLmxlbmd0aDtvKyspcyhyW29dKTtyZXR1cm4gc30pIiwiLyohXG4gKiBUaGUgYnVmZmVyIG1vZHVsZSBmcm9tIG5vZGUuanMsIGZvciB0aGUgYnJvd3Nlci5cbiAqXG4gKiBAYXV0aG9yICAgRmVyb3NzIEFib3VraGFkaWplaCA8ZmVyb3NzQGZlcm9zcy5vcmc+IDxodHRwOi8vZmVyb3NzLm9yZz5cbiAqIEBsaWNlbnNlICBNSVRcbiAqL1xuXG52YXIgYmFzZTY0ID0gcmVxdWlyZSgnYmFzZTY0LWpzJylcbnZhciBpZWVlNzU0ID0gcmVxdWlyZSgnaWVlZTc1NCcpXG52YXIgaXNBcnJheSA9IHJlcXVpcmUoJ2lzLWFycmF5JylcblxuZXhwb3J0cy5CdWZmZXIgPSBCdWZmZXJcbmV4cG9ydHMuU2xvd0J1ZmZlciA9IFNsb3dCdWZmZXJcbmV4cG9ydHMuSU5TUEVDVF9NQVhfQllURVMgPSA1MFxuQnVmZmVyLnBvb2xTaXplID0gODE5MiAvLyBub3QgdXNlZCBieSB0aGlzIGltcGxlbWVudGF0aW9uXG5cbnZhciByb290UGFyZW50ID0ge31cblxuLyoqXG4gKiBJZiBgQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlRgOlxuICogICA9PT0gdHJ1ZSAgICBVc2UgVWludDhBcnJheSBpbXBsZW1lbnRhdGlvbiAoZmFzdGVzdClcbiAqICAgPT09IGZhbHNlICAgVXNlIE9iamVjdCBpbXBsZW1lbnRhdGlvbiAobW9zdCBjb21wYXRpYmxlLCBldmVuIElFNilcbiAqXG4gKiBCcm93c2VycyB0aGF0IHN1cHBvcnQgdHlwZWQgYXJyYXlzIGFyZSBJRSAxMCssIEZpcmVmb3ggNCssIENocm9tZSA3KywgU2FmYXJpIDUuMSssXG4gKiBPcGVyYSAxMS42KywgaU9TIDQuMisuXG4gKlxuICogTm90ZTpcbiAqXG4gKiAtIEltcGxlbWVudGF0aW9uIG11c3Qgc3VwcG9ydCBhZGRpbmcgbmV3IHByb3BlcnRpZXMgdG8gYFVpbnQ4QXJyYXlgIGluc3RhbmNlcy5cbiAqICAgRmlyZWZveCA0LTI5IGxhY2tlZCBzdXBwb3J0LCBmaXhlZCBpbiBGaXJlZm94IDMwKy5cbiAqICAgU2VlOiBodHRwczovL2J1Z3ppbGxhLm1vemlsbGEub3JnL3Nob3dfYnVnLmNnaT9pZD02OTU0MzguXG4gKlxuICogIC0gQ2hyb21lIDktMTAgaXMgbWlzc2luZyB0aGUgYFR5cGVkQXJyYXkucHJvdG90eXBlLnN1YmFycmF5YCBmdW5jdGlvbi5cbiAqXG4gKiAgLSBJRTEwIGhhcyBhIGJyb2tlbiBgVHlwZWRBcnJheS5wcm90b3R5cGUuc3ViYXJyYXlgIGZ1bmN0aW9uIHdoaWNoIHJldHVybnMgYXJyYXlzIG9mXG4gKiAgICBpbmNvcnJlY3QgbGVuZ3RoIGluIHNvbWUgc2l0dWF0aW9ucy5cbiAqXG4gKiBXZSBkZXRlY3QgdGhlc2UgYnVnZ3kgYnJvd3NlcnMgYW5kIHNldCBgQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlRgIHRvIGBmYWxzZWAgc28gdGhleSB3aWxsXG4gKiBnZXQgdGhlIE9iamVjdCBpbXBsZW1lbnRhdGlvbiwgd2hpY2ggaXMgc2xvd2VyIGJ1dCB3aWxsIHdvcmsgY29ycmVjdGx5LlxuICovXG5CdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCA9IChmdW5jdGlvbiAoKSB7XG4gIGZ1bmN0aW9uIEZvbyAoKSB7fVxuICB0cnkge1xuICAgIHZhciBidWYgPSBuZXcgQXJyYXlCdWZmZXIoMClcbiAgICB2YXIgYXJyID0gbmV3IFVpbnQ4QXJyYXkoYnVmKVxuICAgIGFyci5mb28gPSBmdW5jdGlvbiAoKSB7IHJldHVybiA0MiB9XG4gICAgYXJyLmNvbnN0cnVjdG9yID0gRm9vXG4gICAgcmV0dXJuIGFyci5mb28oKSA9PT0gNDIgJiYgLy8gdHlwZWQgYXJyYXkgaW5zdGFuY2VzIGNhbiBiZSBhdWdtZW50ZWRcbiAgICAgICAgYXJyLmNvbnN0cnVjdG9yID09PSBGb28gJiYgLy8gY29uc3RydWN0b3IgY2FuIGJlIHNldFxuICAgICAgICB0eXBlb2YgYXJyLnN1YmFycmF5ID09PSAnZnVuY3Rpb24nICYmIC8vIGNocm9tZSA5LTEwIGxhY2sgYHN1YmFycmF5YFxuICAgICAgICBuZXcgVWludDhBcnJheSgxKS5zdWJhcnJheSgxLCAxKS5ieXRlTGVuZ3RoID09PSAwIC8vIGllMTAgaGFzIGJyb2tlbiBgc3ViYXJyYXlgXG4gIH0gY2F0Y2ggKGUpIHtcbiAgICByZXR1cm4gZmFsc2VcbiAgfVxufSkoKVxuXG5mdW5jdGlvbiBrTWF4TGVuZ3RoICgpIHtcbiAgcmV0dXJuIEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUXG4gICAgPyAweDdmZmZmZmZmXG4gICAgOiAweDNmZmZmZmZmXG59XG5cbi8qKlxuICogQ2xhc3M6IEJ1ZmZlclxuICogPT09PT09PT09PT09PVxuICpcbiAqIFRoZSBCdWZmZXIgY29uc3RydWN0b3IgcmV0dXJucyBpbnN0YW5jZXMgb2YgYFVpbnQ4QXJyYXlgIHRoYXQgYXJlIGF1Z21lbnRlZFxuICogd2l0aCBmdW5jdGlvbiBwcm9wZXJ0aWVzIGZvciBhbGwgdGhlIG5vZGUgYEJ1ZmZlcmAgQVBJIGZ1bmN0aW9ucy4gV2UgdXNlXG4gKiBgVWludDhBcnJheWAgc28gdGhhdCBzcXVhcmUgYnJhY2tldCBub3RhdGlvbiB3b3JrcyBhcyBleHBlY3RlZCAtLSBpdCByZXR1cm5zXG4gKiBhIHNpbmdsZSBvY3RldC5cbiAqXG4gKiBCeSBhdWdtZW50aW5nIHRoZSBpbnN0YW5jZXMsIHdlIGNhbiBhdm9pZCBtb2RpZnlpbmcgdGhlIGBVaW50OEFycmF5YFxuICogcHJvdG90eXBlLlxuICovXG5mdW5jdGlvbiBCdWZmZXIgKGFyZykge1xuICBpZiAoISh0aGlzIGluc3RhbmNlb2YgQnVmZmVyKSkge1xuICAgIC8vIEF2b2lkIGdvaW5nIHRocm91Z2ggYW4gQXJndW1lbnRzQWRhcHRvclRyYW1wb2xpbmUgaW4gdGhlIGNvbW1vbiBjYXNlLlxuICAgIGlmIChhcmd1bWVudHMubGVuZ3RoID4gMSkgcmV0dXJuIG5ldyBCdWZmZXIoYXJnLCBhcmd1bWVudHNbMV0pXG4gICAgcmV0dXJuIG5ldyBCdWZmZXIoYXJnKVxuICB9XG5cbiAgdGhpcy5sZW5ndGggPSAwXG4gIHRoaXMucGFyZW50ID0gdW5kZWZpbmVkXG5cbiAgLy8gQ29tbW9uIGNhc2UuXG4gIGlmICh0eXBlb2YgYXJnID09PSAnbnVtYmVyJykge1xuICAgIHJldHVybiBmcm9tTnVtYmVyKHRoaXMsIGFyZylcbiAgfVxuXG4gIC8vIFNsaWdodGx5IGxlc3MgY29tbW9uIGNhc2UuXG4gIGlmICh0eXBlb2YgYXJnID09PSAnc3RyaW5nJykge1xuICAgIHJldHVybiBmcm9tU3RyaW5nKHRoaXMsIGFyZywgYXJndW1lbnRzLmxlbmd0aCA+IDEgPyBhcmd1bWVudHNbMV0gOiAndXRmOCcpXG4gIH1cblxuICAvLyBVbnVzdWFsLlxuICByZXR1cm4gZnJvbU9iamVjdCh0aGlzLCBhcmcpXG59XG5cbmZ1bmN0aW9uIGZyb21OdW1iZXIgKHRoYXQsIGxlbmd0aCkge1xuICB0aGF0ID0gYWxsb2NhdGUodGhhdCwgbGVuZ3RoIDwgMCA/IDAgOiBjaGVja2VkKGxlbmd0aCkgfCAwKVxuICBpZiAoIUJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW5ndGg7IGkrKykge1xuICAgICAgdGhhdFtpXSA9IDBcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHRoYXRcbn1cblxuZnVuY3Rpb24gZnJvbVN0cmluZyAodGhhdCwgc3RyaW5nLCBlbmNvZGluZykge1xuICBpZiAodHlwZW9mIGVuY29kaW5nICE9PSAnc3RyaW5nJyB8fCBlbmNvZGluZyA9PT0gJycpIGVuY29kaW5nID0gJ3V0ZjgnXG5cbiAgLy8gQXNzdW1wdGlvbjogYnl0ZUxlbmd0aCgpIHJldHVybiB2YWx1ZSBpcyBhbHdheXMgPCBrTWF4TGVuZ3RoLlxuICB2YXIgbGVuZ3RoID0gYnl0ZUxlbmd0aChzdHJpbmcsIGVuY29kaW5nKSB8IDBcbiAgdGhhdCA9IGFsbG9jYXRlKHRoYXQsIGxlbmd0aClcblxuICB0aGF0LndyaXRlKHN0cmluZywgZW5jb2RpbmcpXG4gIHJldHVybiB0aGF0XG59XG5cbmZ1bmN0aW9uIGZyb21PYmplY3QgKHRoYXQsIG9iamVjdCkge1xuICBpZiAoQnVmZmVyLmlzQnVmZmVyKG9iamVjdCkpIHJldHVybiBmcm9tQnVmZmVyKHRoYXQsIG9iamVjdClcblxuICBpZiAoaXNBcnJheShvYmplY3QpKSByZXR1cm4gZnJvbUFycmF5KHRoYXQsIG9iamVjdClcblxuICBpZiAob2JqZWN0ID09IG51bGwpIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdtdXN0IHN0YXJ0IHdpdGggbnVtYmVyLCBidWZmZXIsIGFycmF5IG9yIHN0cmluZycpXG4gIH1cblxuICBpZiAodHlwZW9mIEFycmF5QnVmZmVyICE9PSAndW5kZWZpbmVkJyAmJiBvYmplY3QuYnVmZmVyIGluc3RhbmNlb2YgQXJyYXlCdWZmZXIpIHtcbiAgICByZXR1cm4gZnJvbVR5cGVkQXJyYXkodGhhdCwgb2JqZWN0KVxuICB9XG5cbiAgaWYgKG9iamVjdC5sZW5ndGgpIHJldHVybiBmcm9tQXJyYXlMaWtlKHRoYXQsIG9iamVjdClcblxuICByZXR1cm4gZnJvbUpzb25PYmplY3QodGhhdCwgb2JqZWN0KVxufVxuXG5mdW5jdGlvbiBmcm9tQnVmZmVyICh0aGF0LCBidWZmZXIpIHtcbiAgdmFyIGxlbmd0aCA9IGNoZWNrZWQoYnVmZmVyLmxlbmd0aCkgfCAwXG4gIHRoYXQgPSBhbGxvY2F0ZSh0aGF0LCBsZW5ndGgpXG4gIGJ1ZmZlci5jb3B5KHRoYXQsIDAsIDAsIGxlbmd0aClcbiAgcmV0dXJuIHRoYXRcbn1cblxuZnVuY3Rpb24gZnJvbUFycmF5ICh0aGF0LCBhcnJheSkge1xuICB2YXIgbGVuZ3RoID0gY2hlY2tlZChhcnJheS5sZW5ndGgpIHwgMFxuICB0aGF0ID0gYWxsb2NhdGUodGhhdCwgbGVuZ3RoKVxuICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbmd0aDsgaSArPSAxKSB7XG4gICAgdGhhdFtpXSA9IGFycmF5W2ldICYgMjU1XG4gIH1cbiAgcmV0dXJuIHRoYXRcbn1cblxuLy8gRHVwbGljYXRlIG9mIGZyb21BcnJheSgpIHRvIGtlZXAgZnJvbUFycmF5KCkgbW9ub21vcnBoaWMuXG5mdW5jdGlvbiBmcm9tVHlwZWRBcnJheSAodGhhdCwgYXJyYXkpIHtcbiAgdmFyIGxlbmd0aCA9IGNoZWNrZWQoYXJyYXkubGVuZ3RoKSB8IDBcbiAgdGhhdCA9IGFsbG9jYXRlKHRoYXQsIGxlbmd0aClcbiAgLy8gVHJ1bmNhdGluZyB0aGUgZWxlbWVudHMgaXMgcHJvYmFibHkgbm90IHdoYXQgcGVvcGxlIGV4cGVjdCBmcm9tIHR5cGVkXG4gIC8vIGFycmF5cyB3aXRoIEJZVEVTX1BFUl9FTEVNRU5UID4gMSBidXQgaXQncyBjb21wYXRpYmxlIHdpdGggdGhlIGJlaGF2aW9yXG4gIC8vIG9mIHRoZSBvbGQgQnVmZmVyIGNvbnN0cnVjdG9yLlxuICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbmd0aDsgaSArPSAxKSB7XG4gICAgdGhhdFtpXSA9IGFycmF5W2ldICYgMjU1XG4gIH1cbiAgcmV0dXJuIHRoYXRcbn1cblxuZnVuY3Rpb24gZnJvbUFycmF5TGlrZSAodGhhdCwgYXJyYXkpIHtcbiAgdmFyIGxlbmd0aCA9IGNoZWNrZWQoYXJyYXkubGVuZ3RoKSB8IDBcbiAgdGhhdCA9IGFsbG9jYXRlKHRoYXQsIGxlbmd0aClcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW5ndGg7IGkgKz0gMSkge1xuICAgIHRoYXRbaV0gPSBhcnJheVtpXSAmIDI1NVxuICB9XG4gIHJldHVybiB0aGF0XG59XG5cbi8vIERlc2VyaWFsaXplIHsgdHlwZTogJ0J1ZmZlcicsIGRhdGE6IFsxLDIsMywuLi5dIH0gaW50byBhIEJ1ZmZlciBvYmplY3QuXG4vLyBSZXR1cm5zIGEgemVyby1sZW5ndGggYnVmZmVyIGZvciBpbnB1dHMgdGhhdCBkb24ndCBjb25mb3JtIHRvIHRoZSBzcGVjLlxuZnVuY3Rpb24gZnJvbUpzb25PYmplY3QgKHRoYXQsIG9iamVjdCkge1xuICB2YXIgYXJyYXlcbiAgdmFyIGxlbmd0aCA9IDBcblxuICBpZiAob2JqZWN0LnR5cGUgPT09ICdCdWZmZXInICYmIGlzQXJyYXkob2JqZWN0LmRhdGEpKSB7XG4gICAgYXJyYXkgPSBvYmplY3QuZGF0YVxuICAgIGxlbmd0aCA9IGNoZWNrZWQoYXJyYXkubGVuZ3RoKSB8IDBcbiAgfVxuICB0aGF0ID0gYWxsb2NhdGUodGhhdCwgbGVuZ3RoKVxuXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuZ3RoOyBpICs9IDEpIHtcbiAgICB0aGF0W2ldID0gYXJyYXlbaV0gJiAyNTVcbiAgfVxuICByZXR1cm4gdGhhdFxufVxuXG5mdW5jdGlvbiBhbGxvY2F0ZSAodGhhdCwgbGVuZ3RoKSB7XG4gIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIC8vIFJldHVybiBhbiBhdWdtZW50ZWQgYFVpbnQ4QXJyYXlgIGluc3RhbmNlLCBmb3IgYmVzdCBwZXJmb3JtYW5jZVxuICAgIHRoYXQgPSBCdWZmZXIuX2F1Z21lbnQobmV3IFVpbnQ4QXJyYXkobGVuZ3RoKSlcbiAgfSBlbHNlIHtcbiAgICAvLyBGYWxsYmFjazogUmV0dXJuIGFuIG9iamVjdCBpbnN0YW5jZSBvZiB0aGUgQnVmZmVyIGNsYXNzXG4gICAgdGhhdC5sZW5ndGggPSBsZW5ndGhcbiAgICB0aGF0Ll9pc0J1ZmZlciA9IHRydWVcbiAgfVxuXG4gIHZhciBmcm9tUG9vbCA9IGxlbmd0aCAhPT0gMCAmJiBsZW5ndGggPD0gQnVmZmVyLnBvb2xTaXplID4+PiAxXG4gIGlmIChmcm9tUG9vbCkgdGhhdC5wYXJlbnQgPSByb290UGFyZW50XG5cbiAgcmV0dXJuIHRoYXRcbn1cblxuZnVuY3Rpb24gY2hlY2tlZCAobGVuZ3RoKSB7XG4gIC8vIE5vdGU6IGNhbm5vdCB1c2UgYGxlbmd0aCA8IGtNYXhMZW5ndGhgIGhlcmUgYmVjYXVzZSB0aGF0IGZhaWxzIHdoZW5cbiAgLy8gbGVuZ3RoIGlzIE5hTiAod2hpY2ggaXMgb3RoZXJ3aXNlIGNvZXJjZWQgdG8gemVyby4pXG4gIGlmIChsZW5ndGggPj0ga01heExlbmd0aCgpKSB7XG4gICAgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ0F0dGVtcHQgdG8gYWxsb2NhdGUgQnVmZmVyIGxhcmdlciB0aGFuIG1heGltdW0gJyArXG4gICAgICAgICAgICAgICAgICAgICAgICAgJ3NpemU6IDB4JyArIGtNYXhMZW5ndGgoKS50b1N0cmluZygxNikgKyAnIGJ5dGVzJylcbiAgfVxuICByZXR1cm4gbGVuZ3RoIHwgMFxufVxuXG5mdW5jdGlvbiBTbG93QnVmZmVyIChzdWJqZWN0LCBlbmNvZGluZykge1xuICBpZiAoISh0aGlzIGluc3RhbmNlb2YgU2xvd0J1ZmZlcikpIHJldHVybiBuZXcgU2xvd0J1ZmZlcihzdWJqZWN0LCBlbmNvZGluZylcblxuICB2YXIgYnVmID0gbmV3IEJ1ZmZlcihzdWJqZWN0LCBlbmNvZGluZylcbiAgZGVsZXRlIGJ1Zi5wYXJlbnRcbiAgcmV0dXJuIGJ1ZlxufVxuXG5CdWZmZXIuaXNCdWZmZXIgPSBmdW5jdGlvbiBpc0J1ZmZlciAoYikge1xuICByZXR1cm4gISEoYiAhPSBudWxsICYmIGIuX2lzQnVmZmVyKVxufVxuXG5CdWZmZXIuY29tcGFyZSA9IGZ1bmN0aW9uIGNvbXBhcmUgKGEsIGIpIHtcbiAgaWYgKCFCdWZmZXIuaXNCdWZmZXIoYSkgfHwgIUJ1ZmZlci5pc0J1ZmZlcihiKSkge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ0FyZ3VtZW50cyBtdXN0IGJlIEJ1ZmZlcnMnKVxuICB9XG5cbiAgaWYgKGEgPT09IGIpIHJldHVybiAwXG5cbiAgdmFyIHggPSBhLmxlbmd0aFxuICB2YXIgeSA9IGIubGVuZ3RoXG5cbiAgdmFyIGkgPSAwXG4gIHZhciBsZW4gPSBNYXRoLm1pbih4LCB5KVxuICB3aGlsZSAoaSA8IGxlbikge1xuICAgIGlmIChhW2ldICE9PSBiW2ldKSBicmVha1xuXG4gICAgKytpXG4gIH1cblxuICBpZiAoaSAhPT0gbGVuKSB7XG4gICAgeCA9IGFbaV1cbiAgICB5ID0gYltpXVxuICB9XG5cbiAgaWYgKHggPCB5KSByZXR1cm4gLTFcbiAgaWYgKHkgPCB4KSByZXR1cm4gMVxuICByZXR1cm4gMFxufVxuXG5CdWZmZXIuaXNFbmNvZGluZyA9IGZ1bmN0aW9uIGlzRW5jb2RpbmcgKGVuY29kaW5nKSB7XG4gIHN3aXRjaCAoU3RyaW5nKGVuY29kaW5nKS50b0xvd2VyQ2FzZSgpKSB7XG4gICAgY2FzZSAnaGV4JzpcbiAgICBjYXNlICd1dGY4JzpcbiAgICBjYXNlICd1dGYtOCc6XG4gICAgY2FzZSAnYXNjaWknOlxuICAgIGNhc2UgJ2JpbmFyeSc6XG4gICAgY2FzZSAnYmFzZTY0JzpcbiAgICBjYXNlICdyYXcnOlxuICAgIGNhc2UgJ3VjczInOlxuICAgIGNhc2UgJ3Vjcy0yJzpcbiAgICBjYXNlICd1dGYxNmxlJzpcbiAgICBjYXNlICd1dGYtMTZsZSc6XG4gICAgICByZXR1cm4gdHJ1ZVxuICAgIGRlZmF1bHQ6XG4gICAgICByZXR1cm4gZmFsc2VcbiAgfVxufVxuXG5CdWZmZXIuY29uY2F0ID0gZnVuY3Rpb24gY29uY2F0IChsaXN0LCBsZW5ndGgpIHtcbiAgaWYgKCFpc0FycmF5KGxpc3QpKSB0aHJvdyBuZXcgVHlwZUVycm9yKCdsaXN0IGFyZ3VtZW50IG11c3QgYmUgYW4gQXJyYXkgb2YgQnVmZmVycy4nKVxuXG4gIGlmIChsaXN0Lmxlbmd0aCA9PT0gMCkge1xuICAgIHJldHVybiBuZXcgQnVmZmVyKDApXG4gIH0gZWxzZSBpZiAobGlzdC5sZW5ndGggPT09IDEpIHtcbiAgICByZXR1cm4gbGlzdFswXVxuICB9XG5cbiAgdmFyIGlcbiAgaWYgKGxlbmd0aCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgbGVuZ3RoID0gMFxuICAgIGZvciAoaSA9IDA7IGkgPCBsaXN0Lmxlbmd0aDsgaSsrKSB7XG4gICAgICBsZW5ndGggKz0gbGlzdFtpXS5sZW5ndGhcbiAgICB9XG4gIH1cblxuICB2YXIgYnVmID0gbmV3IEJ1ZmZlcihsZW5ndGgpXG4gIHZhciBwb3MgPSAwXG4gIGZvciAoaSA9IDA7IGkgPCBsaXN0Lmxlbmd0aDsgaSsrKSB7XG4gICAgdmFyIGl0ZW0gPSBsaXN0W2ldXG4gICAgaXRlbS5jb3B5KGJ1ZiwgcG9zKVxuICAgIHBvcyArPSBpdGVtLmxlbmd0aFxuICB9XG4gIHJldHVybiBidWZcbn1cblxuZnVuY3Rpb24gYnl0ZUxlbmd0aCAoc3RyaW5nLCBlbmNvZGluZykge1xuICBpZiAodHlwZW9mIHN0cmluZyAhPT0gJ3N0cmluZycpIHN0cmluZyA9ICcnICsgc3RyaW5nXG5cbiAgdmFyIGxlbiA9IHN0cmluZy5sZW5ndGhcbiAgaWYgKGxlbiA9PT0gMCkgcmV0dXJuIDBcblxuICAvLyBVc2UgYSBmb3IgbG9vcCB0byBhdm9pZCByZWN1cnNpb25cbiAgdmFyIGxvd2VyZWRDYXNlID0gZmFsc2VcbiAgZm9yICg7Oykge1xuICAgIHN3aXRjaCAoZW5jb2RpbmcpIHtcbiAgICAgIGNhc2UgJ2FzY2lpJzpcbiAgICAgIGNhc2UgJ2JpbmFyeSc6XG4gICAgICAvLyBEZXByZWNhdGVkXG4gICAgICBjYXNlICdyYXcnOlxuICAgICAgY2FzZSAncmF3cyc6XG4gICAgICAgIHJldHVybiBsZW5cbiAgICAgIGNhc2UgJ3V0ZjgnOlxuICAgICAgY2FzZSAndXRmLTgnOlxuICAgICAgICByZXR1cm4gdXRmOFRvQnl0ZXMoc3RyaW5nKS5sZW5ndGhcbiAgICAgIGNhc2UgJ3VjczInOlxuICAgICAgY2FzZSAndWNzLTInOlxuICAgICAgY2FzZSAndXRmMTZsZSc6XG4gICAgICBjYXNlICd1dGYtMTZsZSc6XG4gICAgICAgIHJldHVybiBsZW4gKiAyXG4gICAgICBjYXNlICdoZXgnOlxuICAgICAgICByZXR1cm4gbGVuID4+PiAxXG4gICAgICBjYXNlICdiYXNlNjQnOlxuICAgICAgICByZXR1cm4gYmFzZTY0VG9CeXRlcyhzdHJpbmcpLmxlbmd0aFxuICAgICAgZGVmYXVsdDpcbiAgICAgICAgaWYgKGxvd2VyZWRDYXNlKSByZXR1cm4gdXRmOFRvQnl0ZXMoc3RyaW5nKS5sZW5ndGggLy8gYXNzdW1lIHV0ZjhcbiAgICAgICAgZW5jb2RpbmcgPSAoJycgKyBlbmNvZGluZykudG9Mb3dlckNhc2UoKVxuICAgICAgICBsb3dlcmVkQ2FzZSA9IHRydWVcbiAgICB9XG4gIH1cbn1cbkJ1ZmZlci5ieXRlTGVuZ3RoID0gYnl0ZUxlbmd0aFxuXG4vLyBwcmUtc2V0IGZvciB2YWx1ZXMgdGhhdCBtYXkgZXhpc3QgaW4gdGhlIGZ1dHVyZVxuQnVmZmVyLnByb3RvdHlwZS5sZW5ndGggPSB1bmRlZmluZWRcbkJ1ZmZlci5wcm90b3R5cGUucGFyZW50ID0gdW5kZWZpbmVkXG5cbmZ1bmN0aW9uIHNsb3dUb1N0cmluZyAoZW5jb2RpbmcsIHN0YXJ0LCBlbmQpIHtcbiAgdmFyIGxvd2VyZWRDYXNlID0gZmFsc2VcblxuICBzdGFydCA9IHN0YXJ0IHwgMFxuICBlbmQgPSBlbmQgPT09IHVuZGVmaW5lZCB8fCBlbmQgPT09IEluZmluaXR5ID8gdGhpcy5sZW5ndGggOiBlbmQgfCAwXG5cbiAgaWYgKCFlbmNvZGluZykgZW5jb2RpbmcgPSAndXRmOCdcbiAgaWYgKHN0YXJ0IDwgMCkgc3RhcnQgPSAwXG4gIGlmIChlbmQgPiB0aGlzLmxlbmd0aCkgZW5kID0gdGhpcy5sZW5ndGhcbiAgaWYgKGVuZCA8PSBzdGFydCkgcmV0dXJuICcnXG5cbiAgd2hpbGUgKHRydWUpIHtcbiAgICBzd2l0Y2ggKGVuY29kaW5nKSB7XG4gICAgICBjYXNlICdoZXgnOlxuICAgICAgICByZXR1cm4gaGV4U2xpY2UodGhpcywgc3RhcnQsIGVuZClcblxuICAgICAgY2FzZSAndXRmOCc6XG4gICAgICBjYXNlICd1dGYtOCc6XG4gICAgICAgIHJldHVybiB1dGY4U2xpY2UodGhpcywgc3RhcnQsIGVuZClcblxuICAgICAgY2FzZSAnYXNjaWknOlxuICAgICAgICByZXR1cm4gYXNjaWlTbGljZSh0aGlzLCBzdGFydCwgZW5kKVxuXG4gICAgICBjYXNlICdiaW5hcnknOlxuICAgICAgICByZXR1cm4gYmluYXJ5U2xpY2UodGhpcywgc3RhcnQsIGVuZClcblxuICAgICAgY2FzZSAnYmFzZTY0JzpcbiAgICAgICAgcmV0dXJuIGJhc2U2NFNsaWNlKHRoaXMsIHN0YXJ0LCBlbmQpXG5cbiAgICAgIGNhc2UgJ3VjczInOlxuICAgICAgY2FzZSAndWNzLTInOlxuICAgICAgY2FzZSAndXRmMTZsZSc6XG4gICAgICBjYXNlICd1dGYtMTZsZSc6XG4gICAgICAgIHJldHVybiB1dGYxNmxlU2xpY2UodGhpcywgc3RhcnQsIGVuZClcblxuICAgICAgZGVmYXVsdDpcbiAgICAgICAgaWYgKGxvd2VyZWRDYXNlKSB0aHJvdyBuZXcgVHlwZUVycm9yKCdVbmtub3duIGVuY29kaW5nOiAnICsgZW5jb2RpbmcpXG4gICAgICAgIGVuY29kaW5nID0gKGVuY29kaW5nICsgJycpLnRvTG93ZXJDYXNlKClcbiAgICAgICAgbG93ZXJlZENhc2UgPSB0cnVlXG4gICAgfVxuICB9XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUudG9TdHJpbmcgPSBmdW5jdGlvbiB0b1N0cmluZyAoKSB7XG4gIHZhciBsZW5ndGggPSB0aGlzLmxlbmd0aCB8IDBcbiAgaWYgKGxlbmd0aCA9PT0gMCkgcmV0dXJuICcnXG4gIGlmIChhcmd1bWVudHMubGVuZ3RoID09PSAwKSByZXR1cm4gdXRmOFNsaWNlKHRoaXMsIDAsIGxlbmd0aClcbiAgcmV0dXJuIHNsb3dUb1N0cmluZy5hcHBseSh0aGlzLCBhcmd1bWVudHMpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUuZXF1YWxzID0gZnVuY3Rpb24gZXF1YWxzIChiKSB7XG4gIGlmICghQnVmZmVyLmlzQnVmZmVyKGIpKSB0aHJvdyBuZXcgVHlwZUVycm9yKCdBcmd1bWVudCBtdXN0IGJlIGEgQnVmZmVyJylcbiAgaWYgKHRoaXMgPT09IGIpIHJldHVybiB0cnVlXG4gIHJldHVybiBCdWZmZXIuY29tcGFyZSh0aGlzLCBiKSA9PT0gMFxufVxuXG5CdWZmZXIucHJvdG90eXBlLmluc3BlY3QgPSBmdW5jdGlvbiBpbnNwZWN0ICgpIHtcbiAgdmFyIHN0ciA9ICcnXG4gIHZhciBtYXggPSBleHBvcnRzLklOU1BFQ1RfTUFYX0JZVEVTXG4gIGlmICh0aGlzLmxlbmd0aCA+IDApIHtcbiAgICBzdHIgPSB0aGlzLnRvU3RyaW5nKCdoZXgnLCAwLCBtYXgpLm1hdGNoKC8uezJ9L2cpLmpvaW4oJyAnKVxuICAgIGlmICh0aGlzLmxlbmd0aCA+IG1heCkgc3RyICs9ICcgLi4uICdcbiAgfVxuICByZXR1cm4gJzxCdWZmZXIgJyArIHN0ciArICc+J1xufVxuXG5CdWZmZXIucHJvdG90eXBlLmNvbXBhcmUgPSBmdW5jdGlvbiBjb21wYXJlIChiKSB7XG4gIGlmICghQnVmZmVyLmlzQnVmZmVyKGIpKSB0aHJvdyBuZXcgVHlwZUVycm9yKCdBcmd1bWVudCBtdXN0IGJlIGEgQnVmZmVyJylcbiAgaWYgKHRoaXMgPT09IGIpIHJldHVybiAwXG4gIHJldHVybiBCdWZmZXIuY29tcGFyZSh0aGlzLCBiKVxufVxuXG5CdWZmZXIucHJvdG90eXBlLmluZGV4T2YgPSBmdW5jdGlvbiBpbmRleE9mICh2YWwsIGJ5dGVPZmZzZXQpIHtcbiAgaWYgKGJ5dGVPZmZzZXQgPiAweDdmZmZmZmZmKSBieXRlT2Zmc2V0ID0gMHg3ZmZmZmZmZlxuICBlbHNlIGlmIChieXRlT2Zmc2V0IDwgLTB4ODAwMDAwMDApIGJ5dGVPZmZzZXQgPSAtMHg4MDAwMDAwMFxuICBieXRlT2Zmc2V0ID4+PSAwXG5cbiAgaWYgKHRoaXMubGVuZ3RoID09PSAwKSByZXR1cm4gLTFcbiAgaWYgKGJ5dGVPZmZzZXQgPj0gdGhpcy5sZW5ndGgpIHJldHVybiAtMVxuXG4gIC8vIE5lZ2F0aXZlIG9mZnNldHMgc3RhcnQgZnJvbSB0aGUgZW5kIG9mIHRoZSBidWZmZXJcbiAgaWYgKGJ5dGVPZmZzZXQgPCAwKSBieXRlT2Zmc2V0ID0gTWF0aC5tYXgodGhpcy5sZW5ndGggKyBieXRlT2Zmc2V0LCAwKVxuXG4gIGlmICh0eXBlb2YgdmFsID09PSAnc3RyaW5nJykge1xuICAgIGlmICh2YWwubGVuZ3RoID09PSAwKSByZXR1cm4gLTEgLy8gc3BlY2lhbCBjYXNlOiBsb29raW5nIGZvciBlbXB0eSBzdHJpbmcgYWx3YXlzIGZhaWxzXG4gICAgcmV0dXJuIFN0cmluZy5wcm90b3R5cGUuaW5kZXhPZi5jYWxsKHRoaXMsIHZhbCwgYnl0ZU9mZnNldClcbiAgfVxuICBpZiAoQnVmZmVyLmlzQnVmZmVyKHZhbCkpIHtcbiAgICByZXR1cm4gYXJyYXlJbmRleE9mKHRoaXMsIHZhbCwgYnl0ZU9mZnNldClcbiAgfVxuICBpZiAodHlwZW9mIHZhbCA9PT0gJ251bWJlcicpIHtcbiAgICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQgJiYgVWludDhBcnJheS5wcm90b3R5cGUuaW5kZXhPZiA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgcmV0dXJuIFVpbnQ4QXJyYXkucHJvdG90eXBlLmluZGV4T2YuY2FsbCh0aGlzLCB2YWwsIGJ5dGVPZmZzZXQpXG4gICAgfVxuICAgIHJldHVybiBhcnJheUluZGV4T2YodGhpcywgWyB2YWwgXSwgYnl0ZU9mZnNldClcbiAgfVxuXG4gIGZ1bmN0aW9uIGFycmF5SW5kZXhPZiAoYXJyLCB2YWwsIGJ5dGVPZmZzZXQpIHtcbiAgICB2YXIgZm91bmRJbmRleCA9IC0xXG4gICAgZm9yICh2YXIgaSA9IDA7IGJ5dGVPZmZzZXQgKyBpIDwgYXJyLmxlbmd0aDsgaSsrKSB7XG4gICAgICBpZiAoYXJyW2J5dGVPZmZzZXQgKyBpXSA9PT0gdmFsW2ZvdW5kSW5kZXggPT09IC0xID8gMCA6IGkgLSBmb3VuZEluZGV4XSkge1xuICAgICAgICBpZiAoZm91bmRJbmRleCA9PT0gLTEpIGZvdW5kSW5kZXggPSBpXG4gICAgICAgIGlmIChpIC0gZm91bmRJbmRleCArIDEgPT09IHZhbC5sZW5ndGgpIHJldHVybiBieXRlT2Zmc2V0ICsgZm91bmRJbmRleFxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgZm91bmRJbmRleCA9IC0xXG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiAtMVxuICB9XG5cbiAgdGhyb3cgbmV3IFR5cGVFcnJvcigndmFsIG11c3QgYmUgc3RyaW5nLCBudW1iZXIgb3IgQnVmZmVyJylcbn1cblxuLy8gYGdldGAgd2lsbCBiZSByZW1vdmVkIGluIE5vZGUgMC4xMytcbkJ1ZmZlci5wcm90b3R5cGUuZ2V0ID0gZnVuY3Rpb24gZ2V0IChvZmZzZXQpIHtcbiAgY29uc29sZS5sb2coJy5nZXQoKSBpcyBkZXByZWNhdGVkLiBBY2Nlc3MgdXNpbmcgYXJyYXkgaW5kZXhlcyBpbnN0ZWFkLicpXG4gIHJldHVybiB0aGlzLnJlYWRVSW50OChvZmZzZXQpXG59XG5cbi8vIGBzZXRgIHdpbGwgYmUgcmVtb3ZlZCBpbiBOb2RlIDAuMTMrXG5CdWZmZXIucHJvdG90eXBlLnNldCA9IGZ1bmN0aW9uIHNldCAodiwgb2Zmc2V0KSB7XG4gIGNvbnNvbGUubG9nKCcuc2V0KCkgaXMgZGVwcmVjYXRlZC4gQWNjZXNzIHVzaW5nIGFycmF5IGluZGV4ZXMgaW5zdGVhZC4nKVxuICByZXR1cm4gdGhpcy53cml0ZVVJbnQ4KHYsIG9mZnNldClcbn1cblxuZnVuY3Rpb24gaGV4V3JpdGUgKGJ1Ziwgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCkge1xuICBvZmZzZXQgPSBOdW1iZXIob2Zmc2V0KSB8fCAwXG4gIHZhciByZW1haW5pbmcgPSBidWYubGVuZ3RoIC0gb2Zmc2V0XG4gIGlmICghbGVuZ3RoKSB7XG4gICAgbGVuZ3RoID0gcmVtYWluaW5nXG4gIH0gZWxzZSB7XG4gICAgbGVuZ3RoID0gTnVtYmVyKGxlbmd0aClcbiAgICBpZiAobGVuZ3RoID4gcmVtYWluaW5nKSB7XG4gICAgICBsZW5ndGggPSByZW1haW5pbmdcbiAgICB9XG4gIH1cblxuICAvLyBtdXN0IGJlIGFuIGV2ZW4gbnVtYmVyIG9mIGRpZ2l0c1xuICB2YXIgc3RyTGVuID0gc3RyaW5nLmxlbmd0aFxuICBpZiAoc3RyTGVuICUgMiAhPT0gMCkgdGhyb3cgbmV3IEVycm9yKCdJbnZhbGlkIGhleCBzdHJpbmcnKVxuXG4gIGlmIChsZW5ndGggPiBzdHJMZW4gLyAyKSB7XG4gICAgbGVuZ3RoID0gc3RyTGVuIC8gMlxuICB9XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuZ3RoOyBpKyspIHtcbiAgICB2YXIgcGFyc2VkID0gcGFyc2VJbnQoc3RyaW5nLnN1YnN0cihpICogMiwgMiksIDE2KVxuICAgIGlmIChpc05hTihwYXJzZWQpKSB0aHJvdyBuZXcgRXJyb3IoJ0ludmFsaWQgaGV4IHN0cmluZycpXG4gICAgYnVmW29mZnNldCArIGldID0gcGFyc2VkXG4gIH1cbiAgcmV0dXJuIGlcbn1cblxuZnVuY3Rpb24gdXRmOFdyaXRlIChidWYsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpIHtcbiAgcmV0dXJuIGJsaXRCdWZmZXIodXRmOFRvQnl0ZXMoc3RyaW5nLCBidWYubGVuZ3RoIC0gb2Zmc2V0KSwgYnVmLCBvZmZzZXQsIGxlbmd0aClcbn1cblxuZnVuY3Rpb24gYXNjaWlXcml0ZSAoYnVmLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKSB7XG4gIHJldHVybiBibGl0QnVmZmVyKGFzY2lpVG9CeXRlcyhzdHJpbmcpLCBidWYsIG9mZnNldCwgbGVuZ3RoKVxufVxuXG5mdW5jdGlvbiBiaW5hcnlXcml0ZSAoYnVmLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKSB7XG4gIHJldHVybiBhc2NpaVdyaXRlKGJ1Ziwgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aClcbn1cblxuZnVuY3Rpb24gYmFzZTY0V3JpdGUgKGJ1Ziwgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCkge1xuICByZXR1cm4gYmxpdEJ1ZmZlcihiYXNlNjRUb0J5dGVzKHN0cmluZyksIGJ1Ziwgb2Zmc2V0LCBsZW5ndGgpXG59XG5cbmZ1bmN0aW9uIHVjczJXcml0ZSAoYnVmLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKSB7XG4gIHJldHVybiBibGl0QnVmZmVyKHV0ZjE2bGVUb0J5dGVzKHN0cmluZywgYnVmLmxlbmd0aCAtIG9mZnNldCksIGJ1Ziwgb2Zmc2V0LCBsZW5ndGgpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGUgPSBmdW5jdGlvbiB3cml0ZSAoc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCwgZW5jb2RpbmcpIHtcbiAgLy8gQnVmZmVyI3dyaXRlKHN0cmluZylcbiAgaWYgKG9mZnNldCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgZW5jb2RpbmcgPSAndXRmOCdcbiAgICBsZW5ndGggPSB0aGlzLmxlbmd0aFxuICAgIG9mZnNldCA9IDBcbiAgLy8gQnVmZmVyI3dyaXRlKHN0cmluZywgZW5jb2RpbmcpXG4gIH0gZWxzZSBpZiAobGVuZ3RoID09PSB1bmRlZmluZWQgJiYgdHlwZW9mIG9mZnNldCA9PT0gJ3N0cmluZycpIHtcbiAgICBlbmNvZGluZyA9IG9mZnNldFxuICAgIGxlbmd0aCA9IHRoaXMubGVuZ3RoXG4gICAgb2Zmc2V0ID0gMFxuICAvLyBCdWZmZXIjd3JpdGUoc3RyaW5nLCBvZmZzZXRbLCBsZW5ndGhdWywgZW5jb2RpbmddKVxuICB9IGVsc2UgaWYgKGlzRmluaXRlKG9mZnNldCkpIHtcbiAgICBvZmZzZXQgPSBvZmZzZXQgfCAwXG4gICAgaWYgKGlzRmluaXRlKGxlbmd0aCkpIHtcbiAgICAgIGxlbmd0aCA9IGxlbmd0aCB8IDBcbiAgICAgIGlmIChlbmNvZGluZyA9PT0gdW5kZWZpbmVkKSBlbmNvZGluZyA9ICd1dGY4J1xuICAgIH0gZWxzZSB7XG4gICAgICBlbmNvZGluZyA9IGxlbmd0aFxuICAgICAgbGVuZ3RoID0gdW5kZWZpbmVkXG4gICAgfVxuICAvLyBsZWdhY3kgd3JpdGUoc3RyaW5nLCBlbmNvZGluZywgb2Zmc2V0LCBsZW5ndGgpIC0gcmVtb3ZlIGluIHYwLjEzXG4gIH0gZWxzZSB7XG4gICAgdmFyIHN3YXAgPSBlbmNvZGluZ1xuICAgIGVuY29kaW5nID0gb2Zmc2V0XG4gICAgb2Zmc2V0ID0gbGVuZ3RoIHwgMFxuICAgIGxlbmd0aCA9IHN3YXBcbiAgfVxuXG4gIHZhciByZW1haW5pbmcgPSB0aGlzLmxlbmd0aCAtIG9mZnNldFxuICBpZiAobGVuZ3RoID09PSB1bmRlZmluZWQgfHwgbGVuZ3RoID4gcmVtYWluaW5nKSBsZW5ndGggPSByZW1haW5pbmdcblxuICBpZiAoKHN0cmluZy5sZW5ndGggPiAwICYmIChsZW5ndGggPCAwIHx8IG9mZnNldCA8IDApKSB8fCBvZmZzZXQgPiB0aGlzLmxlbmd0aCkge1xuICAgIHRocm93IG5ldyBSYW5nZUVycm9yKCdhdHRlbXB0IHRvIHdyaXRlIG91dHNpZGUgYnVmZmVyIGJvdW5kcycpXG4gIH1cblxuICBpZiAoIWVuY29kaW5nKSBlbmNvZGluZyA9ICd1dGY4J1xuXG4gIHZhciBsb3dlcmVkQ2FzZSA9IGZhbHNlXG4gIGZvciAoOzspIHtcbiAgICBzd2l0Y2ggKGVuY29kaW5nKSB7XG4gICAgICBjYXNlICdoZXgnOlxuICAgICAgICByZXR1cm4gaGV4V3JpdGUodGhpcywgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aClcblxuICAgICAgY2FzZSAndXRmOCc6XG4gICAgICBjYXNlICd1dGYtOCc6XG4gICAgICAgIHJldHVybiB1dGY4V3JpdGUodGhpcywgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aClcblxuICAgICAgY2FzZSAnYXNjaWknOlxuICAgICAgICByZXR1cm4gYXNjaWlXcml0ZSh0aGlzLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKVxuXG4gICAgICBjYXNlICdiaW5hcnknOlxuICAgICAgICByZXR1cm4gYmluYXJ5V3JpdGUodGhpcywgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aClcblxuICAgICAgY2FzZSAnYmFzZTY0JzpcbiAgICAgICAgLy8gV2FybmluZzogbWF4TGVuZ3RoIG5vdCB0YWtlbiBpbnRvIGFjY291bnQgaW4gYmFzZTY0V3JpdGVcbiAgICAgICAgcmV0dXJuIGJhc2U2NFdyaXRlKHRoaXMsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpXG5cbiAgICAgIGNhc2UgJ3VjczInOlxuICAgICAgY2FzZSAndWNzLTInOlxuICAgICAgY2FzZSAndXRmMTZsZSc6XG4gICAgICBjYXNlICd1dGYtMTZsZSc6XG4gICAgICAgIHJldHVybiB1Y3MyV3JpdGUodGhpcywgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aClcblxuICAgICAgZGVmYXVsdDpcbiAgICAgICAgaWYgKGxvd2VyZWRDYXNlKSB0aHJvdyBuZXcgVHlwZUVycm9yKCdVbmtub3duIGVuY29kaW5nOiAnICsgZW5jb2RpbmcpXG4gICAgICAgIGVuY29kaW5nID0gKCcnICsgZW5jb2RpbmcpLnRvTG93ZXJDYXNlKClcbiAgICAgICAgbG93ZXJlZENhc2UgPSB0cnVlXG4gICAgfVxuICB9XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUudG9KU09OID0gZnVuY3Rpb24gdG9KU09OICgpIHtcbiAgcmV0dXJuIHtcbiAgICB0eXBlOiAnQnVmZmVyJyxcbiAgICBkYXRhOiBBcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbCh0aGlzLl9hcnIgfHwgdGhpcywgMClcbiAgfVxufVxuXG5mdW5jdGlvbiBiYXNlNjRTbGljZSAoYnVmLCBzdGFydCwgZW5kKSB7XG4gIGlmIChzdGFydCA9PT0gMCAmJiBlbmQgPT09IGJ1Zi5sZW5ndGgpIHtcbiAgICByZXR1cm4gYmFzZTY0LmZyb21CeXRlQXJyYXkoYnVmKVxuICB9IGVsc2Uge1xuICAgIHJldHVybiBiYXNlNjQuZnJvbUJ5dGVBcnJheShidWYuc2xpY2Uoc3RhcnQsIGVuZCkpXG4gIH1cbn1cblxuZnVuY3Rpb24gdXRmOFNsaWNlIChidWYsIHN0YXJ0LCBlbmQpIHtcbiAgdmFyIHJlcyA9ICcnXG4gIHZhciB0bXAgPSAnJ1xuICBlbmQgPSBNYXRoLm1pbihidWYubGVuZ3RoLCBlbmQpXG5cbiAgZm9yICh2YXIgaSA9IHN0YXJ0OyBpIDwgZW5kOyBpKyspIHtcbiAgICBpZiAoYnVmW2ldIDw9IDB4N0YpIHtcbiAgICAgIHJlcyArPSBkZWNvZGVVdGY4Q2hhcih0bXApICsgU3RyaW5nLmZyb21DaGFyQ29kZShidWZbaV0pXG4gICAgICB0bXAgPSAnJ1xuICAgIH0gZWxzZSB7XG4gICAgICB0bXAgKz0gJyUnICsgYnVmW2ldLnRvU3RyaW5nKDE2KVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiByZXMgKyBkZWNvZGVVdGY4Q2hhcih0bXApXG59XG5cbmZ1bmN0aW9uIGFzY2lpU2xpY2UgKGJ1Ziwgc3RhcnQsIGVuZCkge1xuICB2YXIgcmV0ID0gJydcbiAgZW5kID0gTWF0aC5taW4oYnVmLmxlbmd0aCwgZW5kKVxuXG4gIGZvciAodmFyIGkgPSBzdGFydDsgaSA8IGVuZDsgaSsrKSB7XG4gICAgcmV0ICs9IFN0cmluZy5mcm9tQ2hhckNvZGUoYnVmW2ldICYgMHg3RilcbiAgfVxuICByZXR1cm4gcmV0XG59XG5cbmZ1bmN0aW9uIGJpbmFyeVNsaWNlIChidWYsIHN0YXJ0LCBlbmQpIHtcbiAgdmFyIHJldCA9ICcnXG4gIGVuZCA9IE1hdGgubWluKGJ1Zi5sZW5ndGgsIGVuZClcblxuICBmb3IgKHZhciBpID0gc3RhcnQ7IGkgPCBlbmQ7IGkrKykge1xuICAgIHJldCArPSBTdHJpbmcuZnJvbUNoYXJDb2RlKGJ1ZltpXSlcbiAgfVxuICByZXR1cm4gcmV0XG59XG5cbmZ1bmN0aW9uIGhleFNsaWNlIChidWYsIHN0YXJ0LCBlbmQpIHtcbiAgdmFyIGxlbiA9IGJ1Zi5sZW5ndGhcblxuICBpZiAoIXN0YXJ0IHx8IHN0YXJ0IDwgMCkgc3RhcnQgPSAwXG4gIGlmICghZW5kIHx8IGVuZCA8IDAgfHwgZW5kID4gbGVuKSBlbmQgPSBsZW5cblxuICB2YXIgb3V0ID0gJydcbiAgZm9yICh2YXIgaSA9IHN0YXJ0OyBpIDwgZW5kOyBpKyspIHtcbiAgICBvdXQgKz0gdG9IZXgoYnVmW2ldKVxuICB9XG4gIHJldHVybiBvdXRcbn1cblxuZnVuY3Rpb24gdXRmMTZsZVNsaWNlIChidWYsIHN0YXJ0LCBlbmQpIHtcbiAgdmFyIGJ5dGVzID0gYnVmLnNsaWNlKHN0YXJ0LCBlbmQpXG4gIHZhciByZXMgPSAnJ1xuICBmb3IgKHZhciBpID0gMDsgaSA8IGJ5dGVzLmxlbmd0aDsgaSArPSAyKSB7XG4gICAgcmVzICs9IFN0cmluZy5mcm9tQ2hhckNvZGUoYnl0ZXNbaV0gKyBieXRlc1tpICsgMV0gKiAyNTYpXG4gIH1cbiAgcmV0dXJuIHJlc1xufVxuXG5CdWZmZXIucHJvdG90eXBlLnNsaWNlID0gZnVuY3Rpb24gc2xpY2UgKHN0YXJ0LCBlbmQpIHtcbiAgdmFyIGxlbiA9IHRoaXMubGVuZ3RoXG4gIHN0YXJ0ID0gfn5zdGFydFxuICBlbmQgPSBlbmQgPT09IHVuZGVmaW5lZCA/IGxlbiA6IH5+ZW5kXG5cbiAgaWYgKHN0YXJ0IDwgMCkge1xuICAgIHN0YXJ0ICs9IGxlblxuICAgIGlmIChzdGFydCA8IDApIHN0YXJ0ID0gMFxuICB9IGVsc2UgaWYgKHN0YXJ0ID4gbGVuKSB7XG4gICAgc3RhcnQgPSBsZW5cbiAgfVxuXG4gIGlmIChlbmQgPCAwKSB7XG4gICAgZW5kICs9IGxlblxuICAgIGlmIChlbmQgPCAwKSBlbmQgPSAwXG4gIH0gZWxzZSBpZiAoZW5kID4gbGVuKSB7XG4gICAgZW5kID0gbGVuXG4gIH1cblxuICBpZiAoZW5kIDwgc3RhcnQpIGVuZCA9IHN0YXJ0XG5cbiAgdmFyIG5ld0J1ZlxuICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICBuZXdCdWYgPSBCdWZmZXIuX2F1Z21lbnQodGhpcy5zdWJhcnJheShzdGFydCwgZW5kKSlcbiAgfSBlbHNlIHtcbiAgICB2YXIgc2xpY2VMZW4gPSBlbmQgLSBzdGFydFxuICAgIG5ld0J1ZiA9IG5ldyBCdWZmZXIoc2xpY2VMZW4sIHVuZGVmaW5lZClcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IHNsaWNlTGVuOyBpKyspIHtcbiAgICAgIG5ld0J1ZltpXSA9IHRoaXNbaSArIHN0YXJ0XVxuICAgIH1cbiAgfVxuXG4gIGlmIChuZXdCdWYubGVuZ3RoKSBuZXdCdWYucGFyZW50ID0gdGhpcy5wYXJlbnQgfHwgdGhpc1xuXG4gIHJldHVybiBuZXdCdWZcbn1cblxuLypcbiAqIE5lZWQgdG8gbWFrZSBzdXJlIHRoYXQgYnVmZmVyIGlzbid0IHRyeWluZyB0byB3cml0ZSBvdXQgb2YgYm91bmRzLlxuICovXG5mdW5jdGlvbiBjaGVja09mZnNldCAob2Zmc2V0LCBleHQsIGxlbmd0aCkge1xuICBpZiAoKG9mZnNldCAlIDEpICE9PSAwIHx8IG9mZnNldCA8IDApIHRocm93IG5ldyBSYW5nZUVycm9yKCdvZmZzZXQgaXMgbm90IHVpbnQnKVxuICBpZiAob2Zmc2V0ICsgZXh0ID4gbGVuZ3RoKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcignVHJ5aW5nIHRvIGFjY2VzcyBiZXlvbmQgYnVmZmVyIGxlbmd0aCcpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZFVJbnRMRSA9IGZ1bmN0aW9uIHJlYWRVSW50TEUgKG9mZnNldCwgYnl0ZUxlbmd0aCwgbm9Bc3NlcnQpIHtcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBieXRlTGVuZ3RoID0gYnl0ZUxlbmd0aCB8IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCBieXRlTGVuZ3RoLCB0aGlzLmxlbmd0aClcblxuICB2YXIgdmFsID0gdGhpc1tvZmZzZXRdXG4gIHZhciBtdWwgPSAxXG4gIHZhciBpID0gMFxuICB3aGlsZSAoKytpIDwgYnl0ZUxlbmd0aCAmJiAobXVsICo9IDB4MTAwKSkge1xuICAgIHZhbCArPSB0aGlzW29mZnNldCArIGldICogbXVsXG4gIH1cblxuICByZXR1cm4gdmFsXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZFVJbnRCRSA9IGZ1bmN0aW9uIHJlYWRVSW50QkUgKG9mZnNldCwgYnl0ZUxlbmd0aCwgbm9Bc3NlcnQpIHtcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBieXRlTGVuZ3RoID0gYnl0ZUxlbmd0aCB8IDBcbiAgaWYgKCFub0Fzc2VydCkge1xuICAgIGNoZWNrT2Zmc2V0KG9mZnNldCwgYnl0ZUxlbmd0aCwgdGhpcy5sZW5ndGgpXG4gIH1cblxuICB2YXIgdmFsID0gdGhpc1tvZmZzZXQgKyAtLWJ5dGVMZW5ndGhdXG4gIHZhciBtdWwgPSAxXG4gIHdoaWxlIChieXRlTGVuZ3RoID4gMCAmJiAobXVsICo9IDB4MTAwKSkge1xuICAgIHZhbCArPSB0aGlzW29mZnNldCArIC0tYnl0ZUxlbmd0aF0gKiBtdWxcbiAgfVxuXG4gIHJldHVybiB2YWxcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkVUludDggPSBmdW5jdGlvbiByZWFkVUludDggKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCAxLCB0aGlzLmxlbmd0aClcbiAgcmV0dXJuIHRoaXNbb2Zmc2V0XVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRVSW50MTZMRSA9IGZ1bmN0aW9uIHJlYWRVSW50MTZMRSAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDIsIHRoaXMubGVuZ3RoKVxuICByZXR1cm4gdGhpc1tvZmZzZXRdIHwgKHRoaXNbb2Zmc2V0ICsgMV0gPDwgOClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkVUludDE2QkUgPSBmdW5jdGlvbiByZWFkVUludDE2QkUgKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCAyLCB0aGlzLmxlbmd0aClcbiAgcmV0dXJuICh0aGlzW29mZnNldF0gPDwgOCkgfCB0aGlzW29mZnNldCArIDFdXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZFVJbnQzMkxFID0gZnVuY3Rpb24gcmVhZFVJbnQzMkxFIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgNCwgdGhpcy5sZW5ndGgpXG5cbiAgcmV0dXJuICgodGhpc1tvZmZzZXRdKSB8XG4gICAgICAodGhpc1tvZmZzZXQgKyAxXSA8PCA4KSB8XG4gICAgICAodGhpc1tvZmZzZXQgKyAyXSA8PCAxNikpICtcbiAgICAgICh0aGlzW29mZnNldCArIDNdICogMHgxMDAwMDAwKVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRVSW50MzJCRSA9IGZ1bmN0aW9uIHJlYWRVSW50MzJCRSAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDQsIHRoaXMubGVuZ3RoKVxuXG4gIHJldHVybiAodGhpc1tvZmZzZXRdICogMHgxMDAwMDAwKSArXG4gICAgKCh0aGlzW29mZnNldCArIDFdIDw8IDE2KSB8XG4gICAgKHRoaXNbb2Zmc2V0ICsgMl0gPDwgOCkgfFxuICAgIHRoaXNbb2Zmc2V0ICsgM10pXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEludExFID0gZnVuY3Rpb24gcmVhZEludExFIChvZmZzZXQsIGJ5dGVMZW5ndGgsIG5vQXNzZXJ0KSB7XG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgYnl0ZUxlbmd0aCA9IGJ5dGVMZW5ndGggfCAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgYnl0ZUxlbmd0aCwgdGhpcy5sZW5ndGgpXG5cbiAgdmFyIHZhbCA9IHRoaXNbb2Zmc2V0XVxuICB2YXIgbXVsID0gMVxuICB2YXIgaSA9IDBcbiAgd2hpbGUgKCsraSA8IGJ5dGVMZW5ndGggJiYgKG11bCAqPSAweDEwMCkpIHtcbiAgICB2YWwgKz0gdGhpc1tvZmZzZXQgKyBpXSAqIG11bFxuICB9XG4gIG11bCAqPSAweDgwXG5cbiAgaWYgKHZhbCA+PSBtdWwpIHZhbCAtPSBNYXRoLnBvdygyLCA4ICogYnl0ZUxlbmd0aClcblxuICByZXR1cm4gdmFsXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEludEJFID0gZnVuY3Rpb24gcmVhZEludEJFIChvZmZzZXQsIGJ5dGVMZW5ndGgsIG5vQXNzZXJ0KSB7XG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgYnl0ZUxlbmd0aCA9IGJ5dGVMZW5ndGggfCAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgYnl0ZUxlbmd0aCwgdGhpcy5sZW5ndGgpXG5cbiAgdmFyIGkgPSBieXRlTGVuZ3RoXG4gIHZhciBtdWwgPSAxXG4gIHZhciB2YWwgPSB0aGlzW29mZnNldCArIC0taV1cbiAgd2hpbGUgKGkgPiAwICYmIChtdWwgKj0gMHgxMDApKSB7XG4gICAgdmFsICs9IHRoaXNbb2Zmc2V0ICsgLS1pXSAqIG11bFxuICB9XG4gIG11bCAqPSAweDgwXG5cbiAgaWYgKHZhbCA+PSBtdWwpIHZhbCAtPSBNYXRoLnBvdygyLCA4ICogYnl0ZUxlbmd0aClcblxuICByZXR1cm4gdmFsXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEludDggPSBmdW5jdGlvbiByZWFkSW50OCAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDEsIHRoaXMubGVuZ3RoKVxuICBpZiAoISh0aGlzW29mZnNldF0gJiAweDgwKSkgcmV0dXJuICh0aGlzW29mZnNldF0pXG4gIHJldHVybiAoKDB4ZmYgLSB0aGlzW29mZnNldF0gKyAxKSAqIC0xKVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRJbnQxNkxFID0gZnVuY3Rpb24gcmVhZEludDE2TEUgKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCAyLCB0aGlzLmxlbmd0aClcbiAgdmFyIHZhbCA9IHRoaXNbb2Zmc2V0XSB8ICh0aGlzW29mZnNldCArIDFdIDw8IDgpXG4gIHJldHVybiAodmFsICYgMHg4MDAwKSA/IHZhbCB8IDB4RkZGRjAwMDAgOiB2YWxcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkSW50MTZCRSA9IGZ1bmN0aW9uIHJlYWRJbnQxNkJFIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgMiwgdGhpcy5sZW5ndGgpXG4gIHZhciB2YWwgPSB0aGlzW29mZnNldCArIDFdIHwgKHRoaXNbb2Zmc2V0XSA8PCA4KVxuICByZXR1cm4gKHZhbCAmIDB4ODAwMCkgPyB2YWwgfCAweEZGRkYwMDAwIDogdmFsXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEludDMyTEUgPSBmdW5jdGlvbiByZWFkSW50MzJMRSAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDQsIHRoaXMubGVuZ3RoKVxuXG4gIHJldHVybiAodGhpc1tvZmZzZXRdKSB8XG4gICAgKHRoaXNbb2Zmc2V0ICsgMV0gPDwgOCkgfFxuICAgICh0aGlzW29mZnNldCArIDJdIDw8IDE2KSB8XG4gICAgKHRoaXNbb2Zmc2V0ICsgM10gPDwgMjQpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEludDMyQkUgPSBmdW5jdGlvbiByZWFkSW50MzJCRSAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDQsIHRoaXMubGVuZ3RoKVxuXG4gIHJldHVybiAodGhpc1tvZmZzZXRdIDw8IDI0KSB8XG4gICAgKHRoaXNbb2Zmc2V0ICsgMV0gPDwgMTYpIHxcbiAgICAodGhpc1tvZmZzZXQgKyAyXSA8PCA4KSB8XG4gICAgKHRoaXNbb2Zmc2V0ICsgM10pXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEZsb2F0TEUgPSBmdW5jdGlvbiByZWFkRmxvYXRMRSAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDQsIHRoaXMubGVuZ3RoKVxuICByZXR1cm4gaWVlZTc1NC5yZWFkKHRoaXMsIG9mZnNldCwgdHJ1ZSwgMjMsIDQpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEZsb2F0QkUgPSBmdW5jdGlvbiByZWFkRmxvYXRCRSAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDQsIHRoaXMubGVuZ3RoKVxuICByZXR1cm4gaWVlZTc1NC5yZWFkKHRoaXMsIG9mZnNldCwgZmFsc2UsIDIzLCA0KVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWREb3VibGVMRSA9IGZ1bmN0aW9uIHJlYWREb3VibGVMRSAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDgsIHRoaXMubGVuZ3RoKVxuICByZXR1cm4gaWVlZTc1NC5yZWFkKHRoaXMsIG9mZnNldCwgdHJ1ZSwgNTIsIDgpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZERvdWJsZUJFID0gZnVuY3Rpb24gcmVhZERvdWJsZUJFIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgOCwgdGhpcy5sZW5ndGgpXG4gIHJldHVybiBpZWVlNzU0LnJlYWQodGhpcywgb2Zmc2V0LCBmYWxzZSwgNTIsIDgpXG59XG5cbmZ1bmN0aW9uIGNoZWNrSW50IChidWYsIHZhbHVlLCBvZmZzZXQsIGV4dCwgbWF4LCBtaW4pIHtcbiAgaWYgKCFCdWZmZXIuaXNCdWZmZXIoYnVmKSkgdGhyb3cgbmV3IFR5cGVFcnJvcignYnVmZmVyIG11c3QgYmUgYSBCdWZmZXIgaW5zdGFuY2UnKVxuICBpZiAodmFsdWUgPiBtYXggfHwgdmFsdWUgPCBtaW4pIHRocm93IG5ldyBSYW5nZUVycm9yKCd2YWx1ZSBpcyBvdXQgb2YgYm91bmRzJylcbiAgaWYgKG9mZnNldCArIGV4dCA+IGJ1Zi5sZW5ndGgpIHRocm93IG5ldyBSYW5nZUVycm9yKCdpbmRleCBvdXQgb2YgcmFuZ2UnKVxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlVUludExFID0gZnVuY3Rpb24gd3JpdGVVSW50TEUgKHZhbHVlLCBvZmZzZXQsIGJ5dGVMZW5ndGgsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgYnl0ZUxlbmd0aCA9IGJ5dGVMZW5ndGggfCAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIGJ5dGVMZW5ndGgsIE1hdGgucG93KDIsIDggKiBieXRlTGVuZ3RoKSwgMClcblxuICB2YXIgbXVsID0gMVxuICB2YXIgaSA9IDBcbiAgdGhpc1tvZmZzZXRdID0gdmFsdWUgJiAweEZGXG4gIHdoaWxlICgrK2kgPCBieXRlTGVuZ3RoICYmIChtdWwgKj0gMHgxMDApKSB7XG4gICAgdGhpc1tvZmZzZXQgKyBpXSA9ICh2YWx1ZSAvIG11bCkgJiAweEZGXG4gIH1cblxuICByZXR1cm4gb2Zmc2V0ICsgYnl0ZUxlbmd0aFxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlVUludEJFID0gZnVuY3Rpb24gd3JpdGVVSW50QkUgKHZhbHVlLCBvZmZzZXQsIGJ5dGVMZW5ndGgsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgYnl0ZUxlbmd0aCA9IGJ5dGVMZW5ndGggfCAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIGJ5dGVMZW5ndGgsIE1hdGgucG93KDIsIDggKiBieXRlTGVuZ3RoKSwgMClcblxuICB2YXIgaSA9IGJ5dGVMZW5ndGggLSAxXG4gIHZhciBtdWwgPSAxXG4gIHRoaXNbb2Zmc2V0ICsgaV0gPSB2YWx1ZSAmIDB4RkZcbiAgd2hpbGUgKC0taSA+PSAwICYmIChtdWwgKj0gMHgxMDApKSB7XG4gICAgdGhpc1tvZmZzZXQgKyBpXSA9ICh2YWx1ZSAvIG11bCkgJiAweEZGXG4gIH1cblxuICByZXR1cm4gb2Zmc2V0ICsgYnl0ZUxlbmd0aFxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlVUludDggPSBmdW5jdGlvbiB3cml0ZVVJbnQ4ICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgfCAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIDEsIDB4ZmYsIDApXG4gIGlmICghQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHZhbHVlID0gTWF0aC5mbG9vcih2YWx1ZSlcbiAgdGhpc1tvZmZzZXRdID0gdmFsdWVcbiAgcmV0dXJuIG9mZnNldCArIDFcbn1cblxuZnVuY3Rpb24gb2JqZWN0V3JpdGVVSW50MTYgKGJ1ZiwgdmFsdWUsIG9mZnNldCwgbGl0dGxlRW5kaWFuKSB7XG4gIGlmICh2YWx1ZSA8IDApIHZhbHVlID0gMHhmZmZmICsgdmFsdWUgKyAxXG4gIGZvciAodmFyIGkgPSAwLCBqID0gTWF0aC5taW4oYnVmLmxlbmd0aCAtIG9mZnNldCwgMik7IGkgPCBqOyBpKyspIHtcbiAgICBidWZbb2Zmc2V0ICsgaV0gPSAodmFsdWUgJiAoMHhmZiA8PCAoOCAqIChsaXR0bGVFbmRpYW4gPyBpIDogMSAtIGkpKSkpID4+PlxuICAgICAgKGxpdHRsZUVuZGlhbiA/IGkgOiAxIC0gaSkgKiA4XG4gIH1cbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZVVJbnQxNkxFID0gZnVuY3Rpb24gd3JpdGVVSW50MTZMRSAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCAyLCAweGZmZmYsIDApXG4gIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIHRoaXNbb2Zmc2V0XSA9IHZhbHVlXG4gICAgdGhpc1tvZmZzZXQgKyAxXSA9ICh2YWx1ZSA+Pj4gOClcbiAgfSBlbHNlIHtcbiAgICBvYmplY3RXcml0ZVVJbnQxNih0aGlzLCB2YWx1ZSwgb2Zmc2V0LCB0cnVlKVxuICB9XG4gIHJldHVybiBvZmZzZXQgKyAyXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVVSW50MTZCRSA9IGZ1bmN0aW9uIHdyaXRlVUludDE2QkUgKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgMiwgMHhmZmZmLCAwKVxuICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICB0aGlzW29mZnNldF0gPSAodmFsdWUgPj4+IDgpXG4gICAgdGhpc1tvZmZzZXQgKyAxXSA9IHZhbHVlXG4gIH0gZWxzZSB7XG4gICAgb2JqZWN0V3JpdGVVSW50MTYodGhpcywgdmFsdWUsIG9mZnNldCwgZmFsc2UpXG4gIH1cbiAgcmV0dXJuIG9mZnNldCArIDJcbn1cblxuZnVuY3Rpb24gb2JqZWN0V3JpdGVVSW50MzIgKGJ1ZiwgdmFsdWUsIG9mZnNldCwgbGl0dGxlRW5kaWFuKSB7XG4gIGlmICh2YWx1ZSA8IDApIHZhbHVlID0gMHhmZmZmZmZmZiArIHZhbHVlICsgMVxuICBmb3IgKHZhciBpID0gMCwgaiA9IE1hdGgubWluKGJ1Zi5sZW5ndGggLSBvZmZzZXQsIDQpOyBpIDwgajsgaSsrKSB7XG4gICAgYnVmW29mZnNldCArIGldID0gKHZhbHVlID4+PiAobGl0dGxlRW5kaWFuID8gaSA6IDMgLSBpKSAqIDgpICYgMHhmZlxuICB9XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVVSW50MzJMRSA9IGZ1bmN0aW9uIHdyaXRlVUludDMyTEUgKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgNCwgMHhmZmZmZmZmZiwgMClcbiAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgdGhpc1tvZmZzZXQgKyAzXSA9ICh2YWx1ZSA+Pj4gMjQpXG4gICAgdGhpc1tvZmZzZXQgKyAyXSA9ICh2YWx1ZSA+Pj4gMTYpXG4gICAgdGhpc1tvZmZzZXQgKyAxXSA9ICh2YWx1ZSA+Pj4gOClcbiAgICB0aGlzW29mZnNldF0gPSB2YWx1ZVxuICB9IGVsc2Uge1xuICAgIG9iamVjdFdyaXRlVUludDMyKHRoaXMsIHZhbHVlLCBvZmZzZXQsIHRydWUpXG4gIH1cbiAgcmV0dXJuIG9mZnNldCArIDRcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZVVJbnQzMkJFID0gZnVuY3Rpb24gd3JpdGVVSW50MzJCRSAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCA0LCAweGZmZmZmZmZmLCAwKVxuICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICB0aGlzW29mZnNldF0gPSAodmFsdWUgPj4+IDI0KVxuICAgIHRoaXNbb2Zmc2V0ICsgMV0gPSAodmFsdWUgPj4+IDE2KVxuICAgIHRoaXNbb2Zmc2V0ICsgMl0gPSAodmFsdWUgPj4+IDgpXG4gICAgdGhpc1tvZmZzZXQgKyAzXSA9IHZhbHVlXG4gIH0gZWxzZSB7XG4gICAgb2JqZWN0V3JpdGVVSW50MzIodGhpcywgdmFsdWUsIG9mZnNldCwgZmFsc2UpXG4gIH1cbiAgcmV0dXJuIG9mZnNldCArIDRcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUludExFID0gZnVuY3Rpb24gd3JpdGVJbnRMRSAodmFsdWUsIG9mZnNldCwgYnl0ZUxlbmd0aCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBpZiAoIW5vQXNzZXJ0KSB7XG4gICAgdmFyIGxpbWl0ID0gTWF0aC5wb3coMiwgOCAqIGJ5dGVMZW5ndGggLSAxKVxuXG4gICAgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgYnl0ZUxlbmd0aCwgbGltaXQgLSAxLCAtbGltaXQpXG4gIH1cblxuICB2YXIgaSA9IDBcbiAgdmFyIG11bCA9IDFcbiAgdmFyIHN1YiA9IHZhbHVlIDwgMCA/IDEgOiAwXG4gIHRoaXNbb2Zmc2V0XSA9IHZhbHVlICYgMHhGRlxuICB3aGlsZSAoKytpIDwgYnl0ZUxlbmd0aCAmJiAobXVsICo9IDB4MTAwKSkge1xuICAgIHRoaXNbb2Zmc2V0ICsgaV0gPSAoKHZhbHVlIC8gbXVsKSA+PiAwKSAtIHN1YiAmIDB4RkZcbiAgfVxuXG4gIHJldHVybiBvZmZzZXQgKyBieXRlTGVuZ3RoXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVJbnRCRSA9IGZ1bmN0aW9uIHdyaXRlSW50QkUgKHZhbHVlLCBvZmZzZXQsIGJ5dGVMZW5ndGgsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgaWYgKCFub0Fzc2VydCkge1xuICAgIHZhciBsaW1pdCA9IE1hdGgucG93KDIsIDggKiBieXRlTGVuZ3RoIC0gMSlcblxuICAgIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIGJ5dGVMZW5ndGgsIGxpbWl0IC0gMSwgLWxpbWl0KVxuICB9XG5cbiAgdmFyIGkgPSBieXRlTGVuZ3RoIC0gMVxuICB2YXIgbXVsID0gMVxuICB2YXIgc3ViID0gdmFsdWUgPCAwID8gMSA6IDBcbiAgdGhpc1tvZmZzZXQgKyBpXSA9IHZhbHVlICYgMHhGRlxuICB3aGlsZSAoLS1pID49IDAgJiYgKG11bCAqPSAweDEwMCkpIHtcbiAgICB0aGlzW29mZnNldCArIGldID0gKCh2YWx1ZSAvIG11bCkgPj4gMCkgLSBzdWIgJiAweEZGXG4gIH1cblxuICByZXR1cm4gb2Zmc2V0ICsgYnl0ZUxlbmd0aFxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlSW50OCA9IGZ1bmN0aW9uIHdyaXRlSW50OCAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCAxLCAweDdmLCAtMHg4MClcbiAgaWYgKCFCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkgdmFsdWUgPSBNYXRoLmZsb29yKHZhbHVlKVxuICBpZiAodmFsdWUgPCAwKSB2YWx1ZSA9IDB4ZmYgKyB2YWx1ZSArIDFcbiAgdGhpc1tvZmZzZXRdID0gdmFsdWVcbiAgcmV0dXJuIG9mZnNldCArIDFcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUludDE2TEUgPSBmdW5jdGlvbiB3cml0ZUludDE2TEUgKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgMiwgMHg3ZmZmLCAtMHg4MDAwKVxuICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICB0aGlzW29mZnNldF0gPSB2YWx1ZVxuICAgIHRoaXNbb2Zmc2V0ICsgMV0gPSAodmFsdWUgPj4+IDgpXG4gIH0gZWxzZSB7XG4gICAgb2JqZWN0V3JpdGVVSW50MTYodGhpcywgdmFsdWUsIG9mZnNldCwgdHJ1ZSlcbiAgfVxuICByZXR1cm4gb2Zmc2V0ICsgMlxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlSW50MTZCRSA9IGZ1bmN0aW9uIHdyaXRlSW50MTZCRSAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCAyLCAweDdmZmYsIC0weDgwMDApXG4gIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIHRoaXNbb2Zmc2V0XSA9ICh2YWx1ZSA+Pj4gOClcbiAgICB0aGlzW29mZnNldCArIDFdID0gdmFsdWVcbiAgfSBlbHNlIHtcbiAgICBvYmplY3RXcml0ZVVJbnQxNih0aGlzLCB2YWx1ZSwgb2Zmc2V0LCBmYWxzZSlcbiAgfVxuICByZXR1cm4gb2Zmc2V0ICsgMlxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlSW50MzJMRSA9IGZ1bmN0aW9uIHdyaXRlSW50MzJMRSAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCA0LCAweDdmZmZmZmZmLCAtMHg4MDAwMDAwMClcbiAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgdGhpc1tvZmZzZXRdID0gdmFsdWVcbiAgICB0aGlzW29mZnNldCArIDFdID0gKHZhbHVlID4+PiA4KVxuICAgIHRoaXNbb2Zmc2V0ICsgMl0gPSAodmFsdWUgPj4+IDE2KVxuICAgIHRoaXNbb2Zmc2V0ICsgM10gPSAodmFsdWUgPj4+IDI0KVxuICB9IGVsc2Uge1xuICAgIG9iamVjdFdyaXRlVUludDMyKHRoaXMsIHZhbHVlLCBvZmZzZXQsIHRydWUpXG4gIH1cbiAgcmV0dXJuIG9mZnNldCArIDRcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUludDMyQkUgPSBmdW5jdGlvbiB3cml0ZUludDMyQkUgKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgNCwgMHg3ZmZmZmZmZiwgLTB4ODAwMDAwMDApXG4gIGlmICh2YWx1ZSA8IDApIHZhbHVlID0gMHhmZmZmZmZmZiArIHZhbHVlICsgMVxuICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICB0aGlzW29mZnNldF0gPSAodmFsdWUgPj4+IDI0KVxuICAgIHRoaXNbb2Zmc2V0ICsgMV0gPSAodmFsdWUgPj4+IDE2KVxuICAgIHRoaXNbb2Zmc2V0ICsgMl0gPSAodmFsdWUgPj4+IDgpXG4gICAgdGhpc1tvZmZzZXQgKyAzXSA9IHZhbHVlXG4gIH0gZWxzZSB7XG4gICAgb2JqZWN0V3JpdGVVSW50MzIodGhpcywgdmFsdWUsIG9mZnNldCwgZmFsc2UpXG4gIH1cbiAgcmV0dXJuIG9mZnNldCArIDRcbn1cblxuZnVuY3Rpb24gY2hlY2tJRUVFNzU0IChidWYsIHZhbHVlLCBvZmZzZXQsIGV4dCwgbWF4LCBtaW4pIHtcbiAgaWYgKHZhbHVlID4gbWF4IHx8IHZhbHVlIDwgbWluKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcigndmFsdWUgaXMgb3V0IG9mIGJvdW5kcycpXG4gIGlmIChvZmZzZXQgKyBleHQgPiBidWYubGVuZ3RoKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcignaW5kZXggb3V0IG9mIHJhbmdlJylcbiAgaWYgKG9mZnNldCA8IDApIHRocm93IG5ldyBSYW5nZUVycm9yKCdpbmRleCBvdXQgb2YgcmFuZ2UnKVxufVxuXG5mdW5jdGlvbiB3cml0ZUZsb2F0IChidWYsIHZhbHVlLCBvZmZzZXQsIGxpdHRsZUVuZGlhbiwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkge1xuICAgIGNoZWNrSUVFRTc1NChidWYsIHZhbHVlLCBvZmZzZXQsIDQsIDMuNDAyODIzNDY2Mzg1Mjg4NmUrMzgsIC0zLjQwMjgyMzQ2NjM4NTI4ODZlKzM4KVxuICB9XG4gIGllZWU3NTQud3JpdGUoYnVmLCB2YWx1ZSwgb2Zmc2V0LCBsaXR0bGVFbmRpYW4sIDIzLCA0KVxuICByZXR1cm4gb2Zmc2V0ICsgNFxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlRmxvYXRMRSA9IGZ1bmN0aW9uIHdyaXRlRmxvYXRMRSAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgcmV0dXJuIHdyaXRlRmxvYXQodGhpcywgdmFsdWUsIG9mZnNldCwgdHJ1ZSwgbm9Bc3NlcnQpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVGbG9hdEJFID0gZnVuY3Rpb24gd3JpdGVGbG9hdEJFICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICByZXR1cm4gd3JpdGVGbG9hdCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCBmYWxzZSwgbm9Bc3NlcnQpXG59XG5cbmZ1bmN0aW9uIHdyaXRlRG91YmxlIChidWYsIHZhbHVlLCBvZmZzZXQsIGxpdHRsZUVuZGlhbiwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkge1xuICAgIGNoZWNrSUVFRTc1NChidWYsIHZhbHVlLCBvZmZzZXQsIDgsIDEuNzk3NjkzMTM0ODYyMzE1N0UrMzA4LCAtMS43OTc2OTMxMzQ4NjIzMTU3RSszMDgpXG4gIH1cbiAgaWVlZTc1NC53cml0ZShidWYsIHZhbHVlLCBvZmZzZXQsIGxpdHRsZUVuZGlhbiwgNTIsIDgpXG4gIHJldHVybiBvZmZzZXQgKyA4XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVEb3VibGVMRSA9IGZ1bmN0aW9uIHdyaXRlRG91YmxlTEUgKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHJldHVybiB3cml0ZURvdWJsZSh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCB0cnVlLCBub0Fzc2VydClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZURvdWJsZUJFID0gZnVuY3Rpb24gd3JpdGVEb3VibGVCRSAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgcmV0dXJuIHdyaXRlRG91YmxlKHRoaXMsIHZhbHVlLCBvZmZzZXQsIGZhbHNlLCBub0Fzc2VydClcbn1cblxuLy8gY29weSh0YXJnZXRCdWZmZXIsIHRhcmdldFN0YXJ0PTAsIHNvdXJjZVN0YXJ0PTAsIHNvdXJjZUVuZD1idWZmZXIubGVuZ3RoKVxuQnVmZmVyLnByb3RvdHlwZS5jb3B5ID0gZnVuY3Rpb24gY29weSAodGFyZ2V0LCB0YXJnZXRTdGFydCwgc3RhcnQsIGVuZCkge1xuICBpZiAoIXN0YXJ0KSBzdGFydCA9IDBcbiAgaWYgKCFlbmQgJiYgZW5kICE9PSAwKSBlbmQgPSB0aGlzLmxlbmd0aFxuICBpZiAodGFyZ2V0U3RhcnQgPj0gdGFyZ2V0Lmxlbmd0aCkgdGFyZ2V0U3RhcnQgPSB0YXJnZXQubGVuZ3RoXG4gIGlmICghdGFyZ2V0U3RhcnQpIHRhcmdldFN0YXJ0ID0gMFxuICBpZiAoZW5kID4gMCAmJiBlbmQgPCBzdGFydCkgZW5kID0gc3RhcnRcblxuICAvLyBDb3B5IDAgYnl0ZXM7IHdlJ3JlIGRvbmVcbiAgaWYgKGVuZCA9PT0gc3RhcnQpIHJldHVybiAwXG4gIGlmICh0YXJnZXQubGVuZ3RoID09PSAwIHx8IHRoaXMubGVuZ3RoID09PSAwKSByZXR1cm4gMFxuXG4gIC8vIEZhdGFsIGVycm9yIGNvbmRpdGlvbnNcbiAgaWYgKHRhcmdldFN0YXJ0IDwgMCkge1xuICAgIHRocm93IG5ldyBSYW5nZUVycm9yKCd0YXJnZXRTdGFydCBvdXQgb2YgYm91bmRzJylcbiAgfVxuICBpZiAoc3RhcnQgPCAwIHx8IHN0YXJ0ID49IHRoaXMubGVuZ3RoKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcignc291cmNlU3RhcnQgb3V0IG9mIGJvdW5kcycpXG4gIGlmIChlbmQgPCAwKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcignc291cmNlRW5kIG91dCBvZiBib3VuZHMnKVxuXG4gIC8vIEFyZSB3ZSBvb2I/XG4gIGlmIChlbmQgPiB0aGlzLmxlbmd0aCkgZW5kID0gdGhpcy5sZW5ndGhcbiAgaWYgKHRhcmdldC5sZW5ndGggLSB0YXJnZXRTdGFydCA8IGVuZCAtIHN0YXJ0KSB7XG4gICAgZW5kID0gdGFyZ2V0Lmxlbmd0aCAtIHRhcmdldFN0YXJ0ICsgc3RhcnRcbiAgfVxuXG4gIHZhciBsZW4gPSBlbmQgLSBzdGFydFxuXG4gIGlmIChsZW4gPCAxMDAwIHx8ICFCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuOyBpKyspIHtcbiAgICAgIHRhcmdldFtpICsgdGFyZ2V0U3RhcnRdID0gdGhpc1tpICsgc3RhcnRdXG4gICAgfVxuICB9IGVsc2Uge1xuICAgIHRhcmdldC5fc2V0KHRoaXMuc3ViYXJyYXkoc3RhcnQsIHN0YXJ0ICsgbGVuKSwgdGFyZ2V0U3RhcnQpXG4gIH1cblxuICByZXR1cm4gbGVuXG59XG5cbi8vIGZpbGwodmFsdWUsIHN0YXJ0PTAsIGVuZD1idWZmZXIubGVuZ3RoKVxuQnVmZmVyLnByb3RvdHlwZS5maWxsID0gZnVuY3Rpb24gZmlsbCAodmFsdWUsIHN0YXJ0LCBlbmQpIHtcbiAgaWYgKCF2YWx1ZSkgdmFsdWUgPSAwXG4gIGlmICghc3RhcnQpIHN0YXJ0ID0gMFxuICBpZiAoIWVuZCkgZW5kID0gdGhpcy5sZW5ndGhcblxuICBpZiAoZW5kIDwgc3RhcnQpIHRocm93IG5ldyBSYW5nZUVycm9yKCdlbmQgPCBzdGFydCcpXG5cbiAgLy8gRmlsbCAwIGJ5dGVzOyB3ZSdyZSBkb25lXG4gIGlmIChlbmQgPT09IHN0YXJ0KSByZXR1cm5cbiAgaWYgKHRoaXMubGVuZ3RoID09PSAwKSByZXR1cm5cblxuICBpZiAoc3RhcnQgPCAwIHx8IHN0YXJ0ID49IHRoaXMubGVuZ3RoKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcignc3RhcnQgb3V0IG9mIGJvdW5kcycpXG4gIGlmIChlbmQgPCAwIHx8IGVuZCA+IHRoaXMubGVuZ3RoKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcignZW5kIG91dCBvZiBib3VuZHMnKVxuXG4gIHZhciBpXG4gIGlmICh0eXBlb2YgdmFsdWUgPT09ICdudW1iZXInKSB7XG4gICAgZm9yIChpID0gc3RhcnQ7IGkgPCBlbmQ7IGkrKykge1xuICAgICAgdGhpc1tpXSA9IHZhbHVlXG4gICAgfVxuICB9IGVsc2Uge1xuICAgIHZhciBieXRlcyA9IHV0ZjhUb0J5dGVzKHZhbHVlLnRvU3RyaW5nKCkpXG4gICAgdmFyIGxlbiA9IGJ5dGVzLmxlbmd0aFxuICAgIGZvciAoaSA9IHN0YXJ0OyBpIDwgZW5kOyBpKyspIHtcbiAgICAgIHRoaXNbaV0gPSBieXRlc1tpICUgbGVuXVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiB0aGlzXG59XG5cbi8qKlxuICogQ3JlYXRlcyBhIG5ldyBgQXJyYXlCdWZmZXJgIHdpdGggdGhlICpjb3BpZWQqIG1lbW9yeSBvZiB0aGUgYnVmZmVyIGluc3RhbmNlLlxuICogQWRkZWQgaW4gTm9kZSAwLjEyLiBPbmx5IGF2YWlsYWJsZSBpbiBicm93c2VycyB0aGF0IHN1cHBvcnQgQXJyYXlCdWZmZXIuXG4gKi9cbkJ1ZmZlci5wcm90b3R5cGUudG9BcnJheUJ1ZmZlciA9IGZ1bmN0aW9uIHRvQXJyYXlCdWZmZXIgKCkge1xuICBpZiAodHlwZW9mIFVpbnQ4QXJyYXkgIT09ICd1bmRlZmluZWQnKSB7XG4gICAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgICByZXR1cm4gKG5ldyBCdWZmZXIodGhpcykpLmJ1ZmZlclxuICAgIH0gZWxzZSB7XG4gICAgICB2YXIgYnVmID0gbmV3IFVpbnQ4QXJyYXkodGhpcy5sZW5ndGgpXG4gICAgICBmb3IgKHZhciBpID0gMCwgbGVuID0gYnVmLmxlbmd0aDsgaSA8IGxlbjsgaSArPSAxKSB7XG4gICAgICAgIGJ1ZltpXSA9IHRoaXNbaV1cbiAgICAgIH1cbiAgICAgIHJldHVybiBidWYuYnVmZmVyXG4gICAgfVxuICB9IGVsc2Uge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ0J1ZmZlci50b0FycmF5QnVmZmVyIG5vdCBzdXBwb3J0ZWQgaW4gdGhpcyBicm93c2VyJylcbiAgfVxufVxuXG4vLyBIRUxQRVIgRlVOQ1RJT05TXG4vLyA9PT09PT09PT09PT09PT09XG5cbnZhciBCUCA9IEJ1ZmZlci5wcm90b3R5cGVcblxuLyoqXG4gKiBBdWdtZW50IGEgVWludDhBcnJheSAqaW5zdGFuY2UqIChub3QgdGhlIFVpbnQ4QXJyYXkgY2xhc3MhKSB3aXRoIEJ1ZmZlciBtZXRob2RzXG4gKi9cbkJ1ZmZlci5fYXVnbWVudCA9IGZ1bmN0aW9uIF9hdWdtZW50IChhcnIpIHtcbiAgYXJyLmNvbnN0cnVjdG9yID0gQnVmZmVyXG4gIGFyci5faXNCdWZmZXIgPSB0cnVlXG5cbiAgLy8gc2F2ZSByZWZlcmVuY2UgdG8gb3JpZ2luYWwgVWludDhBcnJheSBzZXQgbWV0aG9kIGJlZm9yZSBvdmVyd3JpdGluZ1xuICBhcnIuX3NldCA9IGFyci5zZXRcblxuICAvLyBkZXByZWNhdGVkLCB3aWxsIGJlIHJlbW92ZWQgaW4gbm9kZSAwLjEzK1xuICBhcnIuZ2V0ID0gQlAuZ2V0XG4gIGFyci5zZXQgPSBCUC5zZXRcblxuICBhcnIud3JpdGUgPSBCUC53cml0ZVxuICBhcnIudG9TdHJpbmcgPSBCUC50b1N0cmluZ1xuICBhcnIudG9Mb2NhbGVTdHJpbmcgPSBCUC50b1N0cmluZ1xuICBhcnIudG9KU09OID0gQlAudG9KU09OXG4gIGFyci5lcXVhbHMgPSBCUC5lcXVhbHNcbiAgYXJyLmNvbXBhcmUgPSBCUC5jb21wYXJlXG4gIGFyci5pbmRleE9mID0gQlAuaW5kZXhPZlxuICBhcnIuY29weSA9IEJQLmNvcHlcbiAgYXJyLnNsaWNlID0gQlAuc2xpY2VcbiAgYXJyLnJlYWRVSW50TEUgPSBCUC5yZWFkVUludExFXG4gIGFyci5yZWFkVUludEJFID0gQlAucmVhZFVJbnRCRVxuICBhcnIucmVhZFVJbnQ4ID0gQlAucmVhZFVJbnQ4XG4gIGFyci5yZWFkVUludDE2TEUgPSBCUC5yZWFkVUludDE2TEVcbiAgYXJyLnJlYWRVSW50MTZCRSA9IEJQLnJlYWRVSW50MTZCRVxuICBhcnIucmVhZFVJbnQzMkxFID0gQlAucmVhZFVJbnQzMkxFXG4gIGFyci5yZWFkVUludDMyQkUgPSBCUC5yZWFkVUludDMyQkVcbiAgYXJyLnJlYWRJbnRMRSA9IEJQLnJlYWRJbnRMRVxuICBhcnIucmVhZEludEJFID0gQlAucmVhZEludEJFXG4gIGFyci5yZWFkSW50OCA9IEJQLnJlYWRJbnQ4XG4gIGFyci5yZWFkSW50MTZMRSA9IEJQLnJlYWRJbnQxNkxFXG4gIGFyci5yZWFkSW50MTZCRSA9IEJQLnJlYWRJbnQxNkJFXG4gIGFyci5yZWFkSW50MzJMRSA9IEJQLnJlYWRJbnQzMkxFXG4gIGFyci5yZWFkSW50MzJCRSA9IEJQLnJlYWRJbnQzMkJFXG4gIGFyci5yZWFkRmxvYXRMRSA9IEJQLnJlYWRGbG9hdExFXG4gIGFyci5yZWFkRmxvYXRCRSA9IEJQLnJlYWRGbG9hdEJFXG4gIGFyci5yZWFkRG91YmxlTEUgPSBCUC5yZWFkRG91YmxlTEVcbiAgYXJyLnJlYWREb3VibGVCRSA9IEJQLnJlYWREb3VibGVCRVxuICBhcnIud3JpdGVVSW50OCA9IEJQLndyaXRlVUludDhcbiAgYXJyLndyaXRlVUludExFID0gQlAud3JpdGVVSW50TEVcbiAgYXJyLndyaXRlVUludEJFID0gQlAud3JpdGVVSW50QkVcbiAgYXJyLndyaXRlVUludDE2TEUgPSBCUC53cml0ZVVJbnQxNkxFXG4gIGFyci53cml0ZVVJbnQxNkJFID0gQlAud3JpdGVVSW50MTZCRVxuICBhcnIud3JpdGVVSW50MzJMRSA9IEJQLndyaXRlVUludDMyTEVcbiAgYXJyLndyaXRlVUludDMyQkUgPSBCUC53cml0ZVVJbnQzMkJFXG4gIGFyci53cml0ZUludExFID0gQlAud3JpdGVJbnRMRVxuICBhcnIud3JpdGVJbnRCRSA9IEJQLndyaXRlSW50QkVcbiAgYXJyLndyaXRlSW50OCA9IEJQLndyaXRlSW50OFxuICBhcnIud3JpdGVJbnQxNkxFID0gQlAud3JpdGVJbnQxNkxFXG4gIGFyci53cml0ZUludDE2QkUgPSBCUC53cml0ZUludDE2QkVcbiAgYXJyLndyaXRlSW50MzJMRSA9IEJQLndyaXRlSW50MzJMRVxuICBhcnIud3JpdGVJbnQzMkJFID0gQlAud3JpdGVJbnQzMkJFXG4gIGFyci53cml0ZUZsb2F0TEUgPSBCUC53cml0ZUZsb2F0TEVcbiAgYXJyLndyaXRlRmxvYXRCRSA9IEJQLndyaXRlRmxvYXRCRVxuICBhcnIud3JpdGVEb3VibGVMRSA9IEJQLndyaXRlRG91YmxlTEVcbiAgYXJyLndyaXRlRG91YmxlQkUgPSBCUC53cml0ZURvdWJsZUJFXG4gIGFyci5maWxsID0gQlAuZmlsbFxuICBhcnIuaW5zcGVjdCA9IEJQLmluc3BlY3RcbiAgYXJyLnRvQXJyYXlCdWZmZXIgPSBCUC50b0FycmF5QnVmZmVyXG5cbiAgcmV0dXJuIGFyclxufVxuXG52YXIgSU5WQUxJRF9CQVNFNjRfUkUgPSAvW14rXFwvMC05QS16XFwtXS9nXG5cbmZ1bmN0aW9uIGJhc2U2NGNsZWFuIChzdHIpIHtcbiAgLy8gTm9kZSBzdHJpcHMgb3V0IGludmFsaWQgY2hhcmFjdGVycyBsaWtlIFxcbiBhbmQgXFx0IGZyb20gdGhlIHN0cmluZywgYmFzZTY0LWpzIGRvZXMgbm90XG4gIHN0ciA9IHN0cmluZ3RyaW0oc3RyKS5yZXBsYWNlKElOVkFMSURfQkFTRTY0X1JFLCAnJylcbiAgLy8gTm9kZSBjb252ZXJ0cyBzdHJpbmdzIHdpdGggbGVuZ3RoIDwgMiB0byAnJ1xuICBpZiAoc3RyLmxlbmd0aCA8IDIpIHJldHVybiAnJ1xuICAvLyBOb2RlIGFsbG93cyBmb3Igbm9uLXBhZGRlZCBiYXNlNjQgc3RyaW5ncyAobWlzc2luZyB0cmFpbGluZyA9PT0pLCBiYXNlNjQtanMgZG9lcyBub3RcbiAgd2hpbGUgKHN0ci5sZW5ndGggJSA0ICE9PSAwKSB7XG4gICAgc3RyID0gc3RyICsgJz0nXG4gIH1cbiAgcmV0dXJuIHN0clxufVxuXG5mdW5jdGlvbiBzdHJpbmd0cmltIChzdHIpIHtcbiAgaWYgKHN0ci50cmltKSByZXR1cm4gc3RyLnRyaW0oKVxuICByZXR1cm4gc3RyLnJlcGxhY2UoL15cXHMrfFxccyskL2csICcnKVxufVxuXG5mdW5jdGlvbiB0b0hleCAobikge1xuICBpZiAobiA8IDE2KSByZXR1cm4gJzAnICsgbi50b1N0cmluZygxNilcbiAgcmV0dXJuIG4udG9TdHJpbmcoMTYpXG59XG5cbmZ1bmN0aW9uIHV0ZjhUb0J5dGVzIChzdHJpbmcsIHVuaXRzKSB7XG4gIHVuaXRzID0gdW5pdHMgfHwgSW5maW5pdHlcbiAgdmFyIGNvZGVQb2ludFxuICB2YXIgbGVuZ3RoID0gc3RyaW5nLmxlbmd0aFxuICB2YXIgbGVhZFN1cnJvZ2F0ZSA9IG51bGxcbiAgdmFyIGJ5dGVzID0gW11cbiAgdmFyIGkgPSAwXG5cbiAgZm9yICg7IGkgPCBsZW5ndGg7IGkrKykge1xuICAgIGNvZGVQb2ludCA9IHN0cmluZy5jaGFyQ29kZUF0KGkpXG5cbiAgICAvLyBpcyBzdXJyb2dhdGUgY29tcG9uZW50XG4gICAgaWYgKGNvZGVQb2ludCA+IDB4RDdGRiAmJiBjb2RlUG9pbnQgPCAweEUwMDApIHtcbiAgICAgIC8vIGxhc3QgY2hhciB3YXMgYSBsZWFkXG4gICAgICBpZiAobGVhZFN1cnJvZ2F0ZSkge1xuICAgICAgICAvLyAyIGxlYWRzIGluIGEgcm93XG4gICAgICAgIGlmIChjb2RlUG9pbnQgPCAweERDMDApIHtcbiAgICAgICAgICBpZiAoKHVuaXRzIC09IDMpID4gLTEpIGJ5dGVzLnB1c2goMHhFRiwgMHhCRiwgMHhCRClcbiAgICAgICAgICBsZWFkU3Vycm9nYXRlID0gY29kZVBvaW50XG4gICAgICAgICAgY29udGludWVcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAvLyB2YWxpZCBzdXJyb2dhdGUgcGFpclxuICAgICAgICAgIGNvZGVQb2ludCA9IGxlYWRTdXJyb2dhdGUgLSAweEQ4MDAgPDwgMTAgfCBjb2RlUG9pbnQgLSAweERDMDAgfCAweDEwMDAwXG4gICAgICAgICAgbGVhZFN1cnJvZ2F0ZSA9IG51bGxcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgLy8gbm8gbGVhZCB5ZXRcblxuICAgICAgICBpZiAoY29kZVBvaW50ID4gMHhEQkZGKSB7XG4gICAgICAgICAgLy8gdW5leHBlY3RlZCB0cmFpbFxuICAgICAgICAgIGlmICgodW5pdHMgLT0gMykgPiAtMSkgYnl0ZXMucHVzaCgweEVGLCAweEJGLCAweEJEKVxuICAgICAgICAgIGNvbnRpbnVlXG4gICAgICAgIH0gZWxzZSBpZiAoaSArIDEgPT09IGxlbmd0aCkge1xuICAgICAgICAgIC8vIHVucGFpcmVkIGxlYWRcbiAgICAgICAgICBpZiAoKHVuaXRzIC09IDMpID4gLTEpIGJ5dGVzLnB1c2goMHhFRiwgMHhCRiwgMHhCRClcbiAgICAgICAgICBjb250aW51ZVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIC8vIHZhbGlkIGxlYWRcbiAgICAgICAgICBsZWFkU3Vycm9nYXRlID0gY29kZVBvaW50XG4gICAgICAgICAgY29udGludWVcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0gZWxzZSBpZiAobGVhZFN1cnJvZ2F0ZSkge1xuICAgICAgLy8gdmFsaWQgYm1wIGNoYXIsIGJ1dCBsYXN0IGNoYXIgd2FzIGEgbGVhZFxuICAgICAgaWYgKCh1bml0cyAtPSAzKSA+IC0xKSBieXRlcy5wdXNoKDB4RUYsIDB4QkYsIDB4QkQpXG4gICAgICBsZWFkU3Vycm9nYXRlID0gbnVsbFxuICAgIH1cblxuICAgIC8vIGVuY29kZSB1dGY4XG4gICAgaWYgKGNvZGVQb2ludCA8IDB4ODApIHtcbiAgICAgIGlmICgodW5pdHMgLT0gMSkgPCAwKSBicmVha1xuICAgICAgYnl0ZXMucHVzaChjb2RlUG9pbnQpXG4gICAgfSBlbHNlIGlmIChjb2RlUG9pbnQgPCAweDgwMCkge1xuICAgICAgaWYgKCh1bml0cyAtPSAyKSA8IDApIGJyZWFrXG4gICAgICBieXRlcy5wdXNoKFxuICAgICAgICBjb2RlUG9pbnQgPj4gMHg2IHwgMHhDMCxcbiAgICAgICAgY29kZVBvaW50ICYgMHgzRiB8IDB4ODBcbiAgICAgIClcbiAgICB9IGVsc2UgaWYgKGNvZGVQb2ludCA8IDB4MTAwMDApIHtcbiAgICAgIGlmICgodW5pdHMgLT0gMykgPCAwKSBicmVha1xuICAgICAgYnl0ZXMucHVzaChcbiAgICAgICAgY29kZVBvaW50ID4+IDB4QyB8IDB4RTAsXG4gICAgICAgIGNvZGVQb2ludCA+PiAweDYgJiAweDNGIHwgMHg4MCxcbiAgICAgICAgY29kZVBvaW50ICYgMHgzRiB8IDB4ODBcbiAgICAgIClcbiAgICB9IGVsc2UgaWYgKGNvZGVQb2ludCA8IDB4MjAwMDAwKSB7XG4gICAgICBpZiAoKHVuaXRzIC09IDQpIDwgMCkgYnJlYWtcbiAgICAgIGJ5dGVzLnB1c2goXG4gICAgICAgIGNvZGVQb2ludCA+PiAweDEyIHwgMHhGMCxcbiAgICAgICAgY29kZVBvaW50ID4+IDB4QyAmIDB4M0YgfCAweDgwLFxuICAgICAgICBjb2RlUG9pbnQgPj4gMHg2ICYgMHgzRiB8IDB4ODAsXG4gICAgICAgIGNvZGVQb2ludCAmIDB4M0YgfCAweDgwXG4gICAgICApXG4gICAgfSBlbHNlIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignSW52YWxpZCBjb2RlIHBvaW50JylcbiAgICB9XG4gIH1cblxuICByZXR1cm4gYnl0ZXNcbn1cblxuZnVuY3Rpb24gYXNjaWlUb0J5dGVzIChzdHIpIHtcbiAgdmFyIGJ5dGVBcnJheSA9IFtdXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgc3RyLmxlbmd0aDsgaSsrKSB7XG4gICAgLy8gTm9kZSdzIGNvZGUgc2VlbXMgdG8gYmUgZG9pbmcgdGhpcyBhbmQgbm90ICYgMHg3Ri4uXG4gICAgYnl0ZUFycmF5LnB1c2goc3RyLmNoYXJDb2RlQXQoaSkgJiAweEZGKVxuICB9XG4gIHJldHVybiBieXRlQXJyYXlcbn1cblxuZnVuY3Rpb24gdXRmMTZsZVRvQnl0ZXMgKHN0ciwgdW5pdHMpIHtcbiAgdmFyIGMsIGhpLCBsb1xuICB2YXIgYnl0ZUFycmF5ID0gW11cbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBzdHIubGVuZ3RoOyBpKyspIHtcbiAgICBpZiAoKHVuaXRzIC09IDIpIDwgMCkgYnJlYWtcblxuICAgIGMgPSBzdHIuY2hhckNvZGVBdChpKVxuICAgIGhpID0gYyA+PiA4XG4gICAgbG8gPSBjICUgMjU2XG4gICAgYnl0ZUFycmF5LnB1c2gobG8pXG4gICAgYnl0ZUFycmF5LnB1c2goaGkpXG4gIH1cblxuICByZXR1cm4gYnl0ZUFycmF5XG59XG5cbmZ1bmN0aW9uIGJhc2U2NFRvQnl0ZXMgKHN0cikge1xuICByZXR1cm4gYmFzZTY0LnRvQnl0ZUFycmF5KGJhc2U2NGNsZWFuKHN0cikpXG59XG5cbmZ1bmN0aW9uIGJsaXRCdWZmZXIgKHNyYywgZHN0LCBvZmZzZXQsIGxlbmd0aCkge1xuICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbmd0aDsgaSsrKSB7XG4gICAgaWYgKChpICsgb2Zmc2V0ID49IGRzdC5sZW5ndGgpIHx8IChpID49IHNyYy5sZW5ndGgpKSBicmVha1xuICAgIGRzdFtpICsgb2Zmc2V0XSA9IHNyY1tpXVxuICB9XG4gIHJldHVybiBpXG59XG5cbmZ1bmN0aW9uIGRlY29kZVV0ZjhDaGFyIChzdHIpIHtcbiAgdHJ5IHtcbiAgICByZXR1cm4gZGVjb2RlVVJJQ29tcG9uZW50KHN0cilcbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgcmV0dXJuIFN0cmluZy5mcm9tQ2hhckNvZGUoMHhGRkZEKSAvLyBVVEYgOCBpbnZhbGlkIGNoYXJcbiAgfVxufVxuIiwidmFyIGxvb2t1cCA9ICdBQkNERUZHSElKS0xNTk9QUVJTVFVWV1hZWmFiY2RlZmdoaWprbG1ub3BxcnN0dXZ3eHl6MDEyMzQ1Njc4OSsvJztcblxuOyhmdW5jdGlvbiAoZXhwb3J0cykge1xuXHQndXNlIHN0cmljdCc7XG5cbiAgdmFyIEFyciA9ICh0eXBlb2YgVWludDhBcnJheSAhPT0gJ3VuZGVmaW5lZCcpXG4gICAgPyBVaW50OEFycmF5XG4gICAgOiBBcnJheVxuXG5cdHZhciBQTFVTICAgPSAnKycuY2hhckNvZGVBdCgwKVxuXHR2YXIgU0xBU0ggID0gJy8nLmNoYXJDb2RlQXQoMClcblx0dmFyIE5VTUJFUiA9ICcwJy5jaGFyQ29kZUF0KDApXG5cdHZhciBMT1dFUiAgPSAnYScuY2hhckNvZGVBdCgwKVxuXHR2YXIgVVBQRVIgID0gJ0EnLmNoYXJDb2RlQXQoMClcblx0dmFyIFBMVVNfVVJMX1NBRkUgPSAnLScuY2hhckNvZGVBdCgwKVxuXHR2YXIgU0xBU0hfVVJMX1NBRkUgPSAnXycuY2hhckNvZGVBdCgwKVxuXG5cdGZ1bmN0aW9uIGRlY29kZSAoZWx0KSB7XG5cdFx0dmFyIGNvZGUgPSBlbHQuY2hhckNvZGVBdCgwKVxuXHRcdGlmIChjb2RlID09PSBQTFVTIHx8XG5cdFx0ICAgIGNvZGUgPT09IFBMVVNfVVJMX1NBRkUpXG5cdFx0XHRyZXR1cm4gNjIgLy8gJysnXG5cdFx0aWYgKGNvZGUgPT09IFNMQVNIIHx8XG5cdFx0ICAgIGNvZGUgPT09IFNMQVNIX1VSTF9TQUZFKVxuXHRcdFx0cmV0dXJuIDYzIC8vICcvJ1xuXHRcdGlmIChjb2RlIDwgTlVNQkVSKVxuXHRcdFx0cmV0dXJuIC0xIC8vbm8gbWF0Y2hcblx0XHRpZiAoY29kZSA8IE5VTUJFUiArIDEwKVxuXHRcdFx0cmV0dXJuIGNvZGUgLSBOVU1CRVIgKyAyNiArIDI2XG5cdFx0aWYgKGNvZGUgPCBVUFBFUiArIDI2KVxuXHRcdFx0cmV0dXJuIGNvZGUgLSBVUFBFUlxuXHRcdGlmIChjb2RlIDwgTE9XRVIgKyAyNilcblx0XHRcdHJldHVybiBjb2RlIC0gTE9XRVIgKyAyNlxuXHR9XG5cblx0ZnVuY3Rpb24gYjY0VG9CeXRlQXJyYXkgKGI2NCkge1xuXHRcdHZhciBpLCBqLCBsLCB0bXAsIHBsYWNlSG9sZGVycywgYXJyXG5cblx0XHRpZiAoYjY0Lmxlbmd0aCAlIDQgPiAwKSB7XG5cdFx0XHR0aHJvdyBuZXcgRXJyb3IoJ0ludmFsaWQgc3RyaW5nLiBMZW5ndGggbXVzdCBiZSBhIG11bHRpcGxlIG9mIDQnKVxuXHRcdH1cblxuXHRcdC8vIHRoZSBudW1iZXIgb2YgZXF1YWwgc2lnbnMgKHBsYWNlIGhvbGRlcnMpXG5cdFx0Ly8gaWYgdGhlcmUgYXJlIHR3byBwbGFjZWhvbGRlcnMsIHRoYW4gdGhlIHR3byBjaGFyYWN0ZXJzIGJlZm9yZSBpdFxuXHRcdC8vIHJlcHJlc2VudCBvbmUgYnl0ZVxuXHRcdC8vIGlmIHRoZXJlIGlzIG9ubHkgb25lLCB0aGVuIHRoZSB0aHJlZSBjaGFyYWN0ZXJzIGJlZm9yZSBpdCByZXByZXNlbnQgMiBieXRlc1xuXHRcdC8vIHRoaXMgaXMganVzdCBhIGNoZWFwIGhhY2sgdG8gbm90IGRvIGluZGV4T2YgdHdpY2Vcblx0XHR2YXIgbGVuID0gYjY0Lmxlbmd0aFxuXHRcdHBsYWNlSG9sZGVycyA9ICc9JyA9PT0gYjY0LmNoYXJBdChsZW4gLSAyKSA/IDIgOiAnPScgPT09IGI2NC5jaGFyQXQobGVuIC0gMSkgPyAxIDogMFxuXG5cdFx0Ly8gYmFzZTY0IGlzIDQvMyArIHVwIHRvIHR3byBjaGFyYWN0ZXJzIG9mIHRoZSBvcmlnaW5hbCBkYXRhXG5cdFx0YXJyID0gbmV3IEFycihiNjQubGVuZ3RoICogMyAvIDQgLSBwbGFjZUhvbGRlcnMpXG5cblx0XHQvLyBpZiB0aGVyZSBhcmUgcGxhY2Vob2xkZXJzLCBvbmx5IGdldCB1cCB0byB0aGUgbGFzdCBjb21wbGV0ZSA0IGNoYXJzXG5cdFx0bCA9IHBsYWNlSG9sZGVycyA+IDAgPyBiNjQubGVuZ3RoIC0gNCA6IGI2NC5sZW5ndGhcblxuXHRcdHZhciBMID0gMFxuXG5cdFx0ZnVuY3Rpb24gcHVzaCAodikge1xuXHRcdFx0YXJyW0wrK10gPSB2XG5cdFx0fVxuXG5cdFx0Zm9yIChpID0gMCwgaiA9IDA7IGkgPCBsOyBpICs9IDQsIGogKz0gMykge1xuXHRcdFx0dG1wID0gKGRlY29kZShiNjQuY2hhckF0KGkpKSA8PCAxOCkgfCAoZGVjb2RlKGI2NC5jaGFyQXQoaSArIDEpKSA8PCAxMikgfCAoZGVjb2RlKGI2NC5jaGFyQXQoaSArIDIpKSA8PCA2KSB8IGRlY29kZShiNjQuY2hhckF0KGkgKyAzKSlcblx0XHRcdHB1c2goKHRtcCAmIDB4RkYwMDAwKSA+PiAxNilcblx0XHRcdHB1c2goKHRtcCAmIDB4RkYwMCkgPj4gOClcblx0XHRcdHB1c2godG1wICYgMHhGRilcblx0XHR9XG5cblx0XHRpZiAocGxhY2VIb2xkZXJzID09PSAyKSB7XG5cdFx0XHR0bXAgPSAoZGVjb2RlKGI2NC5jaGFyQXQoaSkpIDw8IDIpIHwgKGRlY29kZShiNjQuY2hhckF0KGkgKyAxKSkgPj4gNClcblx0XHRcdHB1c2godG1wICYgMHhGRilcblx0XHR9IGVsc2UgaWYgKHBsYWNlSG9sZGVycyA9PT0gMSkge1xuXHRcdFx0dG1wID0gKGRlY29kZShiNjQuY2hhckF0KGkpKSA8PCAxMCkgfCAoZGVjb2RlKGI2NC5jaGFyQXQoaSArIDEpKSA8PCA0KSB8IChkZWNvZGUoYjY0LmNoYXJBdChpICsgMikpID4+IDIpXG5cdFx0XHRwdXNoKCh0bXAgPj4gOCkgJiAweEZGKVxuXHRcdFx0cHVzaCh0bXAgJiAweEZGKVxuXHRcdH1cblxuXHRcdHJldHVybiBhcnJcblx0fVxuXG5cdGZ1bmN0aW9uIHVpbnQ4VG9CYXNlNjQgKHVpbnQ4KSB7XG5cdFx0dmFyIGksXG5cdFx0XHRleHRyYUJ5dGVzID0gdWludDgubGVuZ3RoICUgMywgLy8gaWYgd2UgaGF2ZSAxIGJ5dGUgbGVmdCwgcGFkIDIgYnl0ZXNcblx0XHRcdG91dHB1dCA9IFwiXCIsXG5cdFx0XHR0ZW1wLCBsZW5ndGhcblxuXHRcdGZ1bmN0aW9uIGVuY29kZSAobnVtKSB7XG5cdFx0XHRyZXR1cm4gbG9va3VwLmNoYXJBdChudW0pXG5cdFx0fVxuXG5cdFx0ZnVuY3Rpb24gdHJpcGxldFRvQmFzZTY0IChudW0pIHtcblx0XHRcdHJldHVybiBlbmNvZGUobnVtID4+IDE4ICYgMHgzRikgKyBlbmNvZGUobnVtID4+IDEyICYgMHgzRikgKyBlbmNvZGUobnVtID4+IDYgJiAweDNGKSArIGVuY29kZShudW0gJiAweDNGKVxuXHRcdH1cblxuXHRcdC8vIGdvIHRocm91Z2ggdGhlIGFycmF5IGV2ZXJ5IHRocmVlIGJ5dGVzLCB3ZSdsbCBkZWFsIHdpdGggdHJhaWxpbmcgc3R1ZmYgbGF0ZXJcblx0XHRmb3IgKGkgPSAwLCBsZW5ndGggPSB1aW50OC5sZW5ndGggLSBleHRyYUJ5dGVzOyBpIDwgbGVuZ3RoOyBpICs9IDMpIHtcblx0XHRcdHRlbXAgPSAodWludDhbaV0gPDwgMTYpICsgKHVpbnQ4W2kgKyAxXSA8PCA4KSArICh1aW50OFtpICsgMl0pXG5cdFx0XHRvdXRwdXQgKz0gdHJpcGxldFRvQmFzZTY0KHRlbXApXG5cdFx0fVxuXG5cdFx0Ly8gcGFkIHRoZSBlbmQgd2l0aCB6ZXJvcywgYnV0IG1ha2Ugc3VyZSB0byBub3QgZm9yZ2V0IHRoZSBleHRyYSBieXRlc1xuXHRcdHN3aXRjaCAoZXh0cmFCeXRlcykge1xuXHRcdFx0Y2FzZSAxOlxuXHRcdFx0XHR0ZW1wID0gdWludDhbdWludDgubGVuZ3RoIC0gMV1cblx0XHRcdFx0b3V0cHV0ICs9IGVuY29kZSh0ZW1wID4+IDIpXG5cdFx0XHRcdG91dHB1dCArPSBlbmNvZGUoKHRlbXAgPDwgNCkgJiAweDNGKVxuXHRcdFx0XHRvdXRwdXQgKz0gJz09J1xuXHRcdFx0XHRicmVha1xuXHRcdFx0Y2FzZSAyOlxuXHRcdFx0XHR0ZW1wID0gKHVpbnQ4W3VpbnQ4Lmxlbmd0aCAtIDJdIDw8IDgpICsgKHVpbnQ4W3VpbnQ4Lmxlbmd0aCAtIDFdKVxuXHRcdFx0XHRvdXRwdXQgKz0gZW5jb2RlKHRlbXAgPj4gMTApXG5cdFx0XHRcdG91dHB1dCArPSBlbmNvZGUoKHRlbXAgPj4gNCkgJiAweDNGKVxuXHRcdFx0XHRvdXRwdXQgKz0gZW5jb2RlKCh0ZW1wIDw8IDIpICYgMHgzRilcblx0XHRcdFx0b3V0cHV0ICs9ICc9J1xuXHRcdFx0XHRicmVha1xuXHRcdH1cblxuXHRcdHJldHVybiBvdXRwdXRcblx0fVxuXG5cdGV4cG9ydHMudG9CeXRlQXJyYXkgPSBiNjRUb0J5dGVBcnJheVxuXHRleHBvcnRzLmZyb21CeXRlQXJyYXkgPSB1aW50OFRvQmFzZTY0XG59KHR5cGVvZiBleHBvcnRzID09PSAndW5kZWZpbmVkJyA/ICh0aGlzLmJhc2U2NGpzID0ge30pIDogZXhwb3J0cykpXG4iLCJleHBvcnRzLnJlYWQgPSBmdW5jdGlvbiAoYnVmZmVyLCBvZmZzZXQsIGlzTEUsIG1MZW4sIG5CeXRlcykge1xuICB2YXIgZSwgbVxuICB2YXIgZUxlbiA9IG5CeXRlcyAqIDggLSBtTGVuIC0gMVxuICB2YXIgZU1heCA9ICgxIDw8IGVMZW4pIC0gMVxuICB2YXIgZUJpYXMgPSBlTWF4ID4+IDFcbiAgdmFyIG5CaXRzID0gLTdcbiAgdmFyIGkgPSBpc0xFID8gKG5CeXRlcyAtIDEpIDogMFxuICB2YXIgZCA9IGlzTEUgPyAtMSA6IDFcbiAgdmFyIHMgPSBidWZmZXJbb2Zmc2V0ICsgaV1cblxuICBpICs9IGRcblxuICBlID0gcyAmICgoMSA8PCAoLW5CaXRzKSkgLSAxKVxuICBzID4+PSAoLW5CaXRzKVxuICBuQml0cyArPSBlTGVuXG4gIGZvciAoOyBuQml0cyA+IDA7IGUgPSBlICogMjU2ICsgYnVmZmVyW29mZnNldCArIGldLCBpICs9IGQsIG5CaXRzIC09IDgpIHt9XG5cbiAgbSA9IGUgJiAoKDEgPDwgKC1uQml0cykpIC0gMSlcbiAgZSA+Pj0gKC1uQml0cylcbiAgbkJpdHMgKz0gbUxlblxuICBmb3IgKDsgbkJpdHMgPiAwOyBtID0gbSAqIDI1NiArIGJ1ZmZlcltvZmZzZXQgKyBpXSwgaSArPSBkLCBuQml0cyAtPSA4KSB7fVxuXG4gIGlmIChlID09PSAwKSB7XG4gICAgZSA9IDEgLSBlQmlhc1xuICB9IGVsc2UgaWYgKGUgPT09IGVNYXgpIHtcbiAgICByZXR1cm4gbSA/IE5hTiA6ICgocyA/IC0xIDogMSkgKiBJbmZpbml0eSlcbiAgfSBlbHNlIHtcbiAgICBtID0gbSArIE1hdGgucG93KDIsIG1MZW4pXG4gICAgZSA9IGUgLSBlQmlhc1xuICB9XG4gIHJldHVybiAocyA/IC0xIDogMSkgKiBtICogTWF0aC5wb3coMiwgZSAtIG1MZW4pXG59XG5cbmV4cG9ydHMud3JpdGUgPSBmdW5jdGlvbiAoYnVmZmVyLCB2YWx1ZSwgb2Zmc2V0LCBpc0xFLCBtTGVuLCBuQnl0ZXMpIHtcbiAgdmFyIGUsIG0sIGNcbiAgdmFyIGVMZW4gPSBuQnl0ZXMgKiA4IC0gbUxlbiAtIDFcbiAgdmFyIGVNYXggPSAoMSA8PCBlTGVuKSAtIDFcbiAgdmFyIGVCaWFzID0gZU1heCA+PiAxXG4gIHZhciBydCA9IChtTGVuID09PSAyMyA/IE1hdGgucG93KDIsIC0yNCkgLSBNYXRoLnBvdygyLCAtNzcpIDogMClcbiAgdmFyIGkgPSBpc0xFID8gMCA6IChuQnl0ZXMgLSAxKVxuICB2YXIgZCA9IGlzTEUgPyAxIDogLTFcbiAgdmFyIHMgPSB2YWx1ZSA8IDAgfHwgKHZhbHVlID09PSAwICYmIDEgLyB2YWx1ZSA8IDApID8gMSA6IDBcblxuICB2YWx1ZSA9IE1hdGguYWJzKHZhbHVlKVxuXG4gIGlmIChpc05hTih2YWx1ZSkgfHwgdmFsdWUgPT09IEluZmluaXR5KSB7XG4gICAgbSA9IGlzTmFOKHZhbHVlKSA/IDEgOiAwXG4gICAgZSA9IGVNYXhcbiAgfSBlbHNlIHtcbiAgICBlID0gTWF0aC5mbG9vcihNYXRoLmxvZyh2YWx1ZSkgLyBNYXRoLkxOMilcbiAgICBpZiAodmFsdWUgKiAoYyA9IE1hdGgucG93KDIsIC1lKSkgPCAxKSB7XG4gICAgICBlLS1cbiAgICAgIGMgKj0gMlxuICAgIH1cbiAgICBpZiAoZSArIGVCaWFzID49IDEpIHtcbiAgICAgIHZhbHVlICs9IHJ0IC8gY1xuICAgIH0gZWxzZSB7XG4gICAgICB2YWx1ZSArPSBydCAqIE1hdGgucG93KDIsIDEgLSBlQmlhcylcbiAgICB9XG4gICAgaWYgKHZhbHVlICogYyA+PSAyKSB7XG4gICAgICBlKytcbiAgICAgIGMgLz0gMlxuICAgIH1cblxuICAgIGlmIChlICsgZUJpYXMgPj0gZU1heCkge1xuICAgICAgbSA9IDBcbiAgICAgIGUgPSBlTWF4XG4gICAgfSBlbHNlIGlmIChlICsgZUJpYXMgPj0gMSkge1xuICAgICAgbSA9ICh2YWx1ZSAqIGMgLSAxKSAqIE1hdGgucG93KDIsIG1MZW4pXG4gICAgICBlID0gZSArIGVCaWFzXG4gICAgfSBlbHNlIHtcbiAgICAgIG0gPSB2YWx1ZSAqIE1hdGgucG93KDIsIGVCaWFzIC0gMSkgKiBNYXRoLnBvdygyLCBtTGVuKVxuICAgICAgZSA9IDBcbiAgICB9XG4gIH1cblxuICBmb3IgKDsgbUxlbiA+PSA4OyBidWZmZXJbb2Zmc2V0ICsgaV0gPSBtICYgMHhmZiwgaSArPSBkLCBtIC89IDI1NiwgbUxlbiAtPSA4KSB7fVxuXG4gIGUgPSAoZSA8PCBtTGVuKSB8IG1cbiAgZUxlbiArPSBtTGVuXG4gIGZvciAoOyBlTGVuID4gMDsgYnVmZmVyW29mZnNldCArIGldID0gZSAmIDB4ZmYsIGkgKz0gZCwgZSAvPSAyNTYsIGVMZW4gLT0gOCkge31cblxuICBidWZmZXJbb2Zmc2V0ICsgaSAtIGRdIHw9IHMgKiAxMjhcbn1cbiIsIlxuLyoqXG4gKiBpc0FycmF5XG4gKi9cblxudmFyIGlzQXJyYXkgPSBBcnJheS5pc0FycmF5O1xuXG4vKipcbiAqIHRvU3RyaW5nXG4gKi9cblxudmFyIHN0ciA9IE9iamVjdC5wcm90b3R5cGUudG9TdHJpbmc7XG5cbi8qKlxuICogV2hldGhlciBvciBub3QgdGhlIGdpdmVuIGB2YWxgXG4gKiBpcyBhbiBhcnJheS5cbiAqXG4gKiBleGFtcGxlOlxuICpcbiAqICAgICAgICBpc0FycmF5KFtdKTtcbiAqICAgICAgICAvLyA+IHRydWVcbiAqICAgICAgICBpc0FycmF5KGFyZ3VtZW50cyk7XG4gKiAgICAgICAgLy8gPiBmYWxzZVxuICogICAgICAgIGlzQXJyYXkoJycpO1xuICogICAgICAgIC8vID4gZmFsc2VcbiAqXG4gKiBAcGFyYW0ge21peGVkfSB2YWxcbiAqIEByZXR1cm4ge2Jvb2x9XG4gKi9cblxubW9kdWxlLmV4cG9ydHMgPSBpc0FycmF5IHx8IGZ1bmN0aW9uICh2YWwpIHtcbiAgcmV0dXJuICEhIHZhbCAmJiAnW29iamVjdCBBcnJheV0nID09IHN0ci5jYWxsKHZhbCk7XG59O1xuIiwiLy8gc2hpbSBmb3IgdXNpbmcgcHJvY2VzcyBpbiBicm93c2VyXG5cbnZhciBwcm9jZXNzID0gbW9kdWxlLmV4cG9ydHMgPSB7fTtcbnZhciBxdWV1ZSA9IFtdO1xudmFyIGRyYWluaW5nID0gZmFsc2U7XG52YXIgY3VycmVudFF1ZXVlO1xudmFyIHF1ZXVlSW5kZXggPSAtMTtcblxuZnVuY3Rpb24gY2xlYW5VcE5leHRUaWNrKCkge1xuICAgIGRyYWluaW5nID0gZmFsc2U7XG4gICAgaWYgKGN1cnJlbnRRdWV1ZS5sZW5ndGgpIHtcbiAgICAgICAgcXVldWUgPSBjdXJyZW50UXVldWUuY29uY2F0KHF1ZXVlKTtcbiAgICB9IGVsc2Uge1xuICAgICAgICBxdWV1ZUluZGV4ID0gLTE7XG4gICAgfVxuICAgIGlmIChxdWV1ZS5sZW5ndGgpIHtcbiAgICAgICAgZHJhaW5RdWV1ZSgpO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gZHJhaW5RdWV1ZSgpIHtcbiAgICBpZiAoZHJhaW5pbmcpIHtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB2YXIgdGltZW91dCA9IHNldFRpbWVvdXQoY2xlYW5VcE5leHRUaWNrKTtcbiAgICBkcmFpbmluZyA9IHRydWU7XG5cbiAgICB2YXIgbGVuID0gcXVldWUubGVuZ3RoO1xuICAgIHdoaWxlKGxlbikge1xuICAgICAgICBjdXJyZW50UXVldWUgPSBxdWV1ZTtcbiAgICAgICAgcXVldWUgPSBbXTtcbiAgICAgICAgd2hpbGUgKCsrcXVldWVJbmRleCA8IGxlbikge1xuICAgICAgICAgICAgY3VycmVudFF1ZXVlW3F1ZXVlSW5kZXhdLnJ1bigpO1xuICAgICAgICB9XG4gICAgICAgIHF1ZXVlSW5kZXggPSAtMTtcbiAgICAgICAgbGVuID0gcXVldWUubGVuZ3RoO1xuICAgIH1cbiAgICBjdXJyZW50UXVldWUgPSBudWxsO1xuICAgIGRyYWluaW5nID0gZmFsc2U7XG4gICAgY2xlYXJUaW1lb3V0KHRpbWVvdXQpO1xufVxuXG5wcm9jZXNzLm5leHRUaWNrID0gZnVuY3Rpb24gKGZ1bikge1xuICAgIHZhciBhcmdzID0gbmV3IEFycmF5KGFyZ3VtZW50cy5sZW5ndGggLSAxKTtcbiAgICBpZiAoYXJndW1lbnRzLmxlbmd0aCA+IDEpIHtcbiAgICAgICAgZm9yICh2YXIgaSA9IDE7IGkgPCBhcmd1bWVudHMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIGFyZ3NbaSAtIDFdID0gYXJndW1lbnRzW2ldO1xuICAgICAgICB9XG4gICAgfVxuICAgIHF1ZXVlLnB1c2gobmV3IEl0ZW0oZnVuLCBhcmdzKSk7XG4gICAgaWYgKHF1ZXVlLmxlbmd0aCA9PT0gMSAmJiAhZHJhaW5pbmcpIHtcbiAgICAgICAgc2V0VGltZW91dChkcmFpblF1ZXVlLCAwKTtcbiAgICB9XG59O1xuXG4vLyB2OCBsaWtlcyBwcmVkaWN0aWJsZSBvYmplY3RzXG5mdW5jdGlvbiBJdGVtKGZ1biwgYXJyYXkpIHtcbiAgICB0aGlzLmZ1biA9IGZ1bjtcbiAgICB0aGlzLmFycmF5ID0gYXJyYXk7XG59XG5JdGVtLnByb3RvdHlwZS5ydW4gPSBmdW5jdGlvbiAoKSB7XG4gICAgdGhpcy5mdW4uYXBwbHkobnVsbCwgdGhpcy5hcnJheSk7XG59O1xucHJvY2Vzcy50aXRsZSA9ICdicm93c2VyJztcbnByb2Nlc3MuYnJvd3NlciA9IHRydWU7XG5wcm9jZXNzLmVudiA9IHt9O1xucHJvY2Vzcy5hcmd2ID0gW107XG5wcm9jZXNzLnZlcnNpb24gPSAnJzsgLy8gZW1wdHkgc3RyaW5nIHRvIGF2b2lkIHJlZ2V4cCBpc3N1ZXNcbnByb2Nlc3MudmVyc2lvbnMgPSB7fTtcblxuZnVuY3Rpb24gbm9vcCgpIHt9XG5cbnByb2Nlc3Mub24gPSBub29wO1xucHJvY2Vzcy5hZGRMaXN0ZW5lciA9IG5vb3A7XG5wcm9jZXNzLm9uY2UgPSBub29wO1xucHJvY2Vzcy5vZmYgPSBub29wO1xucHJvY2Vzcy5yZW1vdmVMaXN0ZW5lciA9IG5vb3A7XG5wcm9jZXNzLnJlbW92ZUFsbExpc3RlbmVycyA9IG5vb3A7XG5wcm9jZXNzLmVtaXQgPSBub29wO1xuXG5wcm9jZXNzLmJpbmRpbmcgPSBmdW5jdGlvbiAobmFtZSkge1xuICAgIHRocm93IG5ldyBFcnJvcigncHJvY2Vzcy5iaW5kaW5nIGlzIG5vdCBzdXBwb3J0ZWQnKTtcbn07XG5cbi8vIFRPRE8oc2h0eWxtYW4pXG5wcm9jZXNzLmN3ZCA9IGZ1bmN0aW9uICgpIHsgcmV0dXJuICcvJyB9O1xucHJvY2Vzcy5jaGRpciA9IGZ1bmN0aW9uIChkaXIpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ3Byb2Nlc3MuY2hkaXIgaXMgbm90IHN1cHBvcnRlZCcpO1xufTtcbnByb2Nlc3MudW1hc2sgPSBmdW5jdGlvbigpIHsgcmV0dXJuIDA7IH07XG4iLCJ2YXIgVXRpbHMgPSByZXF1aXJlKFwiLi9VdGlscy5qc1wiKTtcclxuXHJcbnZhciBDT05GSUcgPSBcclxue1xyXG5cdHRpbWVvdXRzIDogLy8gaW4gc2Vjb25kc1xyXG5cdHtcclxuXHRcdGRldmljZVRpbWVvdXQgOiA2MCo1LFxyXG5cdFx0YW5pbWF0aW9uRnJhbWUgOiBVdGlscy5tb2JpbGVBbmRUYWJsZXRDaGVjaygpID8gMC40IDogMC4xLFxyXG5cdFx0Z3BzTG9jYXRpb25EZWJ1Z1Nob3cgOiA0LFx0XHQvLyB0aW1lIHRvIHNob3cgZ3BzIGxvY2F0aW9uIChkZWJ1ZykgaW5mb1xyXG5cdFx0c3RyZWFtRGF0YUludGVydmFsIDogMTAgXHRcdC8qIE5PUk1BTCAxMCBzZWNvbmRzICovXHJcblx0fSxcclxuXHRkaXN0YW5jZXMgOiAvLyBpbiBtXHJcblx0e1xyXG5cdFx0c3RheU9uUm9hZFRvbGVyYW5jZSA6IDUwMCxcdC8vIDUwMG0gc3RheSBvbiByb2FkIHRvbGVyYW5jZVxyXG5cdFx0ZWxhcHNlZERpcmVjdGlvbkVwc2lsb24gOiA1MDAgLy8gNTAwbSBkaXJlY3Rpb24gdG9sZXJhbmNlLCB0b28gZmFzdCBtb3ZlbWVudCB3aWxsIGRpc2NhcmQgXHJcblx0fSxcclxuXHRjb25zdHJhaW50cyA6IHtcclxuXHRcdGJhY2t3YXJkc0Vwc2lsb25Jbk1ldGVyIDogNDAwLCAvLzIyMCBtIG1vdmVtZW50IGluIHRoZSBiYWNrd2FyZCBkaXJlY3Rpb24gd2lsbCBub3QgdHJpZ2dlciBuZXh0IHJ1biBjb3VudGVyIGluY3JlbWVudFx0XHRcclxuXHRcdG1heFNwZWVkIDogMjAsXHQvL2ttaFxyXG5cdFx0bWF4UGFydGljaXBhbnRTdGF0ZUhpc3RvcnkgOiAxMDAwLCAvLyBudW1iZXIgb2YgZWxlbWVudHNcclxuXHRcdHBvcHVwRW5zdXJlVmlzaWJsZVdpZHRoIDogMjAwLFxyXG5cdFx0cG9wdXBFbnN1cmVWaXNpYmxlSGVpZ2h0OiAxMjBcclxuXHR9LFxyXG5cdHNpbXVsYXRpb24gOiB7XHJcblx0XHRwaW5nSW50ZXJ2YWwgOiAxMCwgIC8vIGludGVydmFsIGluIHNlY29uZHMgdG8gcGluZyB3aXRoIGdwcyBkYXRhXHJcblx0XHRncHNJbmFjY3VyYWN5IDogNCwgLy84LCAgLy8gZXJyb3Igc2ltdWxhdGlvbiBpbiBNRVRFUiAobG9vayBtYXRoLmdwc0luYWNjdXJhY3ksIG1pbiAxLzIpXHJcblx0XHRzcGVlZENvZWYgOiAxMDBcclxuXHR9LFxyXG5cdHNldHRpbmdzIDoge1xyXG5cdFx0bm9NaWRkbGVXYXJlIDogMCwgXHQvLyBTS0lQIG1pZGRsZSB3YXJlIG5vZGUganMgYXBwXHJcblx0XHRub0ludGVycG9sYXRpb24gOiAwXHQvLyAxIC0+IG5vIGludGVycG9sYXRpb24gb25seSBwb2ludHNcclxuXHR9LFxyXG5cdG1hdGggOiB7XHJcblx0XHRwcm9qZWN0aW9uU2NhbGVZIDogMC43NSxcdFx0XHRcdC8vIFRPRE8gRVhQTEFJTiAocmVjdGFuZ2UgY3JlYXRpb24gaW4gd29ybGQgbWVyY2F0b3IgY29lZiB5IFxyXG5cdFx0Z3BzSW5hY2N1cmFjeSA6IDMwLFx0XHRcdFx0XHRcdCAvL1RPRE8gMTMgbWluID8gXHJcblx0XHRzcGVlZEFuZEFjY2VsZXJhdGlvbkF2ZXJhZ2VEZWdyZWUgOiAyLFx0Ly8gY2FsY3VsYXRpb24gYmFzZWQgb24gTiBzdGF0ZXMgKGF2ZXJhZ2UpIChNSU4gMilcclxuXHRcdGRpc3BsYXlEZWxheSA6IDM1LFx0XHRcdFx0XHRcdC8vIGRpc3BsYXkgZGVsYXkgaW4gU0VDT05EU1xyXG5cdFx0aW50ZXJwb2xhdGVHUFNBdmVyYWdlIDogMCAvLyBudW1iZXIgb2YgcmVjZW50IHZhbHVlcyB0byBjYWxjdWxhdGUgYXZlcmFnZSBncHMgZm9yIHBvc2l0aW9uIChzbW9vdGhpbmcgdGhlIGN1cnZlLm1pbiAwID0gTk8sMSA9IDIgdmFsdWVzIChjdXJyZW50IGFuZCBsYXN0KSlcclxuXHR9LFxyXG5cdGNvbnN0YW50cyA6IFxyXG5cdHtcclxuXHRcdGFnZUdyb3VwcyA6ICBcclxuXHRcdFtcclxuXHRcdCB7XHJcblx0XHRcdCBmcm9tIDogbnVsbCxcclxuXHRcdFx0IHRvIDogOCwgXHJcblx0XHRcdCBjb2RlIDogXCJGaXJzdEFnZUdyb3VwXCJcclxuXHRcdCB9XHJcblx0XHQgLHtcclxuXHRcdFx0IGZyb20gOiA4LFxyXG5cdFx0XHQgdG8gOiA0MCwgXHJcblx0XHRcdCBjb2RlIDogXCJNaWRkbGVBZ2VHcm91cFwiXHJcblx0XHQgfVxyXG5cdFx0ICx7XHJcblx0XHRcdCBmcm9tIDogNDAsXHJcblx0XHRcdCB0byA6IG51bGwsIFxyXG5cdFx0XHQgY29kZSA6IFwiTGFzdEFnZUdyb3VwXCJcclxuXHRcdCB9XHJcblx0XHRdXHJcblx0fSxcclxuXHJcblx0ZXZlbnQgOiB7XHJcblx0XHRiZWdpblRpbWVzdGFtcCA6IChuZXcgRGF0ZSgpKS5nZXRUaW1lKCksXHJcblx0XHRkdXJhdGlvbiA6IDYwLCAvL01JTlVURVNcclxuXHRcdGlkIDogM1xyXG5cdH0sXHJcblxyXG5cdHNlcnZlciA6IHtcclxuXHRcdHByZWZpeCA6IFwiL3RyaWF0aGxvbi9cIlxyXG5cdH0sXHJcblx0XHJcblx0YXBwZWFyYW5jZSA6IHtcclxuXHRcdGRlYnVnIDogMCxcclxuXHRcdHRyYWNrQ29sb3JTd2ltIDogJyM1Njc2ZmYnLFxyXG5cdFx0dHJhY2tDb2xvckJpa2UgOiAnI0UyMDA3NCcsXHJcblx0XHR0cmFja0NvbG9yUnVuIDogICcjMDc5ZjM2JyxcclxuXHJcblx0XHQvLyBOb3RlIHRoZSBzZXF1ZW5jZSBpcyBhbHdheXMgU3dpbS1CaWtlLVJ1biAtIHNvIDIgY2hhbmdlLXBvaW50c1xyXG5cdFx0Ly8gVE9ETyBSdW1lbiAtIGFkZCBzY2FsZSBoZXJlLCBub3QgaW4gU3R5bGVzLmpzXHJcblx0XHRpbWFnZVN0YXJ0IDogXCJpbWcvc3RhcnQucG5nXCIsXHJcblx0XHRpbWFnZUZpbmlzaCA6IFwiaW1nL2ZpbmlzaC5wbmdcIixcclxuXHRcdGltYWdlQ2FtIDogXCJpbWcvY2FtZXJhLnN2Z1wiLFxyXG5cdFx0aW1hZ2VDaGVja3BvaW50U3dpbUJpa2UgOiBcImltZy93ejEuc3ZnXCIsXHJcblx0XHRpbWFnZUNoZWNrcG9pbnRCaWtlUnVuIDogXCJpbWcvd3oyLnN2Z1wiLFxyXG5cdFx0aXNTaG93Q2hlY2twb2ludEltYWdlIDogZmFsc2UsIC8qIHNob3cgYW4gaW1hZ2Ugb24gdGhlIGNoZWNrcG9pbnRzIChlLmcgb24gdGhlIGNoYW5naW5nIFdaIHBvaW50cyAqL1xyXG5cdFx0aXNTaG93Q2hlY2twb2ludCA6IGZhbHNlLCAgLyogc2hvdyBhbiBzcXVhcmUgb24gdGhlIHNhbWUgY29sb3Igb24gdGhlIGNoZWNrcG9pbnRzLCBvbmx5IGlmIGlzU2hvd0NoZWNrcG9pbnRJbWFnZSBpcyBub3QgdHJ1ZSovXHJcblxyXG4gICAgICAgIC8vIHRoZSBkaXN0YW5jZSBiZXR3ZWVuIHRoZSBkaXJlY3Rpb24gaWNvbnMgLSBpbiBwaXhlbHMsXHJcbiAgICAgICAgLy8gaWYgc2V0IG5vbi1wb3NpdGl2ZSB2YWx1ZSAoMCBvciBsZXNzKSB0aGVuIGRvbid0IHNob3cgdGhlbSBhdCBhbGxcclxuXHRcdC8vZGlyZWN0aW9uSWNvbkJldHdlZW4gOiAyMDBcclxuXHRcdGRpcmVjdGlvbkljb25CZXR3ZWVuIDogLTFcclxuXHR9LFxyXG5cclxuICAgIGhvdHNwb3QgOiB7XHJcbiAgICAgICAgY2FtIDoge2ltYWdlIDpcImltZy9jYW1lcmEuc3ZnXCJ9LCAgLy8gdXNlIHRoZSBzYW1lIGltYWdlIGZvciBzdGF0aWMgY2FtZXJhcyBhcyBmb3IgdGhlIG1vdmluZyBvbmVzXHJcblx0XHRjYW1Td2ltQmlrZSA6IHtpbWFnZSA6IFwiaW1nL3d6MS5zdmdcIn0sXHJcblx0XHRjYW1CaWtlUnVuIDoge2ltYWdlIDogXCJpbWcvd3oyLnN2Z1wifSxcclxuICAgICAgICB3YXRlciA6IHtpbWFnZSA6IFwiaW1nL3dhdGVyLnN2Z1wifSxcclxuICAgICAgICB1dHVybiA6IHtpbWFnZSA6IFwiaW1nL3V0dXJuLnN2Z1wifSxcclxuXHJcblx0XHRrbTEwIDoge2ltYWdlIDogXCJpbWcvMTBrbS5zdmdcIiwgc2NhbGUgOiAxLjV9LFxyXG5cdFx0a20yMCA6IHtpbWFnZSA6IFwiaW1nLzIwa20uc3ZnXCIsIHNjYWxlIDogMS41fSxcclxuXHRcdGttMzAgOiB7aW1hZ2UgOiBcImltZy8zMGttLnN2Z1wiLCBzY2FsZSA6IDEuNX0sXHJcblx0XHRrbTQwIDoge2ltYWdlIDogXCJpbWcvNDBrbS5zdmdcIiwgc2NhbGUgOiAxLjV9LFxyXG5cdFx0a202MCA6IHtpbWFnZSA6IFwiaW1nLzYwa20uc3ZnXCIsIHNjYWxlIDogMS41fSxcclxuXHRcdGttODAgOiB7aW1hZ2UgOiBcImltZy84MGttLnN2Z1wiLCBzY2FsZSA6IDEuNX0sXHJcblx0XHRrbTEwMCA6IHtpbWFnZSA6IFwiaW1nLzEwMGttLnN2Z1wiLCBzY2FsZSA6IDEuNX0sXHJcblx0XHRrbTEyMCA6IHtpbWFnZSA6IFwiaW1nLzEyMGttLnN2Z1wiLCBzY2FsZSA6IDEuNX0sXHJcblx0XHRrbTE0MCA6IHtpbWFnZSA6IFwiaW1nLzE0MGttLnN2Z1wiLCBzY2FsZSA6IDEuNX0sXHJcblx0XHRrbTE2MCA6IHtpbWFnZSA6IFwiaW1nLzE2MGttLnN2Z1wiLCBzY2FsZSA6IDEuNX0sXHJcblx0XHRrbTE4MCA6IHtpbWFnZSA6IFwiaW1nLzE4MGttLnN2Z1wiLCBzY2FsZSA6IDEuNX1cclxuICAgIH1cclxufTtcclxuXHJcbmZvciAodmFyIGkgaW4gQ09ORklHKVxyXG5cdGV4cG9ydHNbaV09Q09ORklHW2ldO1xyXG4iLCJ2YXIgVXRpbHM9cmVxdWlyZSgnLi9VdGlscycpO1xyXG52YXIgU1RZTEVTPXJlcXVpcmUoJy4vU3R5bGVzJyk7XHJcbnJlcXVpcmUoJ2pvb3NlJyk7XHJcbnJlcXVpcmUoJy4vVHJhY2snKTtcclxucmVxdWlyZSgnLi9MaXZlU3RyZWFtJyk7XHJcbnZhciBDT05GSUcgPSByZXF1aXJlKFwiLi9Db25maWdcIik7XHJcblxyXG5DbGFzcyhcIkd1aVwiLCBcclxue1xyXG4gICAgLy8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdC8vIEFMTCBDT09SRElOQVRFUyBBUkUgSU4gV09STEQgTUVSQ0FUT1JcclxuICAgIC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuICAgIGhhczogXHJcblx0e1xyXG4gICAgXHRpc0RlYnVnIDoge1xyXG4gICAgXHRcdGlzIDogXCJyd1wiLFxyXG4gICAgXHRcdGluaXQgOiAhVXRpbHMubW9iaWxlQW5kVGFibGV0Q2hlY2soKSAmJiBDT05GSUcuYXBwZWFyYW5jZS5kZWJ1Z1xyXG4gICAgXHR9LFxyXG5cdFx0aXNXaWRnZXQgOiB7XHJcblx0XHRcdGluaXQgOiBmYWxzZVxyXG5cdFx0fSxcclxuXHRcdGlzRGVidWdTaG93UG9zaXRpb24gOiB7XHJcblx0XHRcdC8vIGlmIHNldCB0byB0cnVlIGl0IHdpbGwgYWRkIGFuIGFic29sdXRlIGVsZW1lbnQgc2hvd2luZyB0aGUgY29vcmRpbmF0ZXMgYWJvdmUgdGhlIG1vdXNlIGxvY2F0aW9uXHJcblx0XHRcdGluaXQgOiBmYWxzZVxyXG5cdFx0fSxcclxuXHRcdHJlY2VpdmVyT25NYXBDbGljayA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiBbXVxyXG5cdFx0fSxcclxuICAgICAgICB3aWR0aCA6IHtcclxuICAgICAgICAgICAgaXM6ICAgXCJyd1wiLFxyXG4gICAgICAgICAgICBpbml0OiA3NTBcclxuICAgICAgICB9LFxyXG4gICAgICAgIGhlaWdodDoge1xyXG4gICAgICAgICAgICBpczogICBcInJ3XCIsXHJcbiAgICAgICAgICAgIGluaXQ6IDUwMFxyXG4gICAgICAgIH0sXHJcblx0XHR0cmFjayA6IHtcclxuXHRcdFx0aXM6ICAgXCJyd1wiXHJcblx0XHR9LFxyXG5cdFx0ZWxlbWVudElkIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IFwibWFwXCJcclxuXHRcdH0sXHJcblx0XHRpbml0aWFsUG9zIDoge1x0XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogbnVsbFxyXG5cdFx0fSxcclxuXHRcdGluaXRpYWxab29tIDoge1x0XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogMTBcclxuXHRcdH0sXHJcblx0XHRpc1NraXBFeHRlbnQgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogZmFsc2VcclxuXHRcdH0sXHJcblx0XHRiaW5nTWFwS2V5IDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6ICdBaWp0M0FzV09NRTNoUEVFX0hxUmxVS2RjQktxZThkR1JaSF92LUwzSF9GRjY0c3ZYTWJrcjFUNnVfV0FTb2V0J1xyXG5cdFx0fSxcclxuXHRcdC8vLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdFx0bWFwIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IG51bGxcclxuXHRcdH0sXHJcblx0XHR0cmFja0xheWVyIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IG51bGxcclxuXHRcdH0sXHJcbiAgICAgICAgaG90c3BvdHNMYXllciA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiBudWxsXHJcblx0XHR9LFxyXG4gICAgICAgIGNhbXNMYXllciA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiBudWxsXHJcblx0XHR9LFxyXG5cdFx0cGFydGljaXBhbnRzTGF5ZXIgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogbnVsbFxyXG5cdFx0fSxcclxuXHRcdGRlYnVnTGF5ZXJHUFMgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogbnVsbFxyXG5cdFx0fSxcdFxyXG5cdFx0dGVzdExheWVyIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IG51bGxcclxuXHRcdH0sXHRcclxuXHRcdHRlc3RMYXllcjEgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogbnVsbFxyXG5cdFx0fSxcdFxyXG5cdFx0dGVzdExheWVyMiA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiBudWxsXHJcblx0XHR9LFx0XHJcblx0XHRcclxuXHRcdHNlbGVjdGVkUGFydGljaXBhbnQxIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IG51bGxcclxuXHRcdH0sXHJcblx0XHRzZWxlY3RlZFBhcnRpY2lwYW50MiA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiBudWxsXHJcblx0XHR9LFxyXG5cdFx0cG9wdXAxIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IG51bGxcclxuXHRcdH0sXHJcblx0XHRwb3B1cDIgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogbnVsbFxyXG5cdFx0fSxcclxuXHRcdGlzU2hvd1N3aW0gOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogdHJ1ZVxyXG5cdFx0fSxcclxuXHRcdGlzU2hvd0Jpa2UgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogdHJ1ZVxyXG5cdFx0fSxcclxuXHRcdGlzU2hvd1J1biA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiB0cnVlXHJcblx0XHR9LFxyXG5cdFx0c2VsZWN0TnVtIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IDFcclxuXHRcdH0sXHJcbiAgICAgICAgbGl2ZVN0cmVhbSA6IHtcclxuICAgICAgICAgICAgaW5pdDogbnVsbFxyXG4gICAgICAgIH0sXHJcblx0XHRkaXNwbGF5TW9kZSA6IHtcdFx0XHRcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiBcIm5lYXJlc3RcIlx0XHRcdC8vbmVhcmVzdCxsaW5lYXIsdHJhY2tpbmdcclxuXHRcdH1cclxuICAgIH0sXHJcbiAgICAvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0bWV0aG9kczogXHJcblx0e1xyXG4gICAgICAgIGluaXQ6IGZ1bmN0aW9uIChwYXJhbXMpICBcclxuXHRcdHtcclxuXHRcdFx0Ly8gaWYgaW4gd2lkZ2V0IG1vZGUgdGhlbiBkaXNhYmxlIGRlYnVnXHJcblx0XHRcdGlmICh0aGlzLmlzV2lkZ2V0KSB7XHJcblx0XHRcdFx0dGhpcy5pc0RlYnVnID0gZmFsc2U7XHJcblx0XHRcdH1cclxuXHJcblx0XHRcdHZhciBkZWZQb3MgPSBbMCwwXTtcclxuXHRcdFx0aWYgKHRoaXMuaW5pdGlhbFBvcykge1xyXG5cdFx0XHRcdGRlZlBvcyA9IHRoaXMuaW5pdGlhbFBvcztcclxuXHRcdFx0fSBlbHNlIGlmIChUUkFDSy5nZXRSb3V0ZSgpICYmIFRSQUNLLmdldFJvdXRlKCkubGVuZ3RoID4gMSkge1xyXG5cdFx0XHRcdGRlZlBvcyA9IFRSQUNLLmdldFJvdXRlKClbMF07XHJcblx0XHRcdH1cclxuXHRcdFx0Ly8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRcdFx0dmFyIGV4dGVudCA9IHRoaXMuaXNTa2lwRXh0ZW50ID8gbnVsbCA6IFRSQUNLLmdldFJvdXRlKCkgJiYgVFJBQ0suZ2V0Um91dGUoKS5sZW5ndGggPiAxID8gb2wucHJvai50cmFuc2Zvcm1FeHRlbnQoIChuZXcgb2wuZ2VvbS5MaW5lU3RyaW5nKFRSQUNLLmdldFJvdXRlKCkpKS5nZXRFeHRlbnQoKSAsICdFUFNHOjQzMjYnLCAnRVBTRzozODU3JykgOiBudWxsO1xyXG5cdFx0XHR0aGlzLnRyYWNrTGF5ZXIgPSBuZXcgb2wubGF5ZXIuVmVjdG9yKHtcclxuXHRcdFx0ICBzb3VyY2U6IG5ldyBvbC5zb3VyY2UuVmVjdG9yKCksXHJcblx0XHRcdCAgc3R5bGUgOiBTVFlMRVNbXCJ0cmFja1wiXVxyXG5cdFx0XHR9KTtcclxuXHRcdFx0dGhpcy5ob3RzcG90c0xheWVyID0gbmV3IG9sLmxheWVyLlZlY3Rvcih7XHJcblx0XHRcdCAgc291cmNlOiBuZXcgb2wuc291cmNlLlZlY3RvcigpLFxyXG5cdFx0XHQgIHN0eWxlIDogU1RZTEVTW1wiaG90c3BvdFwiXVxyXG5cdFx0XHR9KTtcclxuXHRcdFx0dGhpcy5wYXJ0aWNpcGFudHNMYXllciA9IG5ldyBvbC5sYXllci5WZWN0b3Ioe1xyXG5cdFx0XHQgIHNvdXJjZTogbmV3IG9sLnNvdXJjZS5WZWN0b3IoKSxcclxuXHRcdFx0ICBzdHlsZSA6IFNUWUxFU1tcInBhcnRpY2lwYW50XCJdXHJcblx0XHRcdH0pO1xyXG5cdFx0XHR0aGlzLmNhbXNMYXllciA9IG5ldyBvbC5sYXllci5WZWN0b3Ioe1xyXG5cdFx0XHRcdHNvdXJjZTogbmV3IG9sLnNvdXJjZS5WZWN0b3IoKSxcclxuXHRcdFx0XHRzdHlsZSA6IFNUWUxFU1tcImNhbVwiXVxyXG5cdFx0XHR9KTtcclxuXHRcdFx0aWYgKHRoaXMuaXNEZWJ1ZykgXHJcblx0XHRcdHtcclxuXHRcdFx0XHR0aGlzLmRlYnVnTGF5ZXJHUFMgPSBuZXcgb2wubGF5ZXIuVmVjdG9yKHtcclxuXHRcdFx0XHRcdCAgc291cmNlOiBuZXcgb2wuc291cmNlLlZlY3RvcigpLFxyXG5cdFx0XHRcdFx0ICBzdHlsZSA6IFNUWUxFU1tcImRlYnVnR1BTXCJdXHJcblx0XHRcdFx0fSk7XHJcblx0XHRcdFx0dGhpcy50ZXN0TGF5ZXIgPSBuZXcgb2wubGF5ZXIuVmVjdG9yKHtcclxuXHRcdFx0XHRcdCAgc291cmNlOiBuZXcgb2wuc291cmNlLlZlY3RvcigpLFxyXG5cdFx0XHRcdFx0ICBzdHlsZSA6IFNUWUxFU1tcInRlc3RcIl1cclxuXHRcdFx0XHR9KTtcclxuXHRcdFx0XHR0aGlzLnRlc3RMYXllcjEgPSBuZXcgb2wubGF5ZXIuVmVjdG9yKHtcclxuXHRcdFx0XHRcdCAgc291cmNlOiBuZXcgb2wuc291cmNlLlZlY3RvcigpLFxyXG5cdFx0XHRcdFx0ICBzdHlsZSA6IFNUWUxFU1tcInRlc3QxXCJdXHJcblx0XHRcdFx0fSk7XHJcblx0XHRcdFx0dGhpcy50ZXN0TGF5ZXIyID0gbmV3IG9sLmxheWVyLlZlY3Rvcih7XHJcblx0XHRcdFx0XHQgIHNvdXJjZTogbmV3IG9sLnNvdXJjZS5WZWN0b3IoKSxcclxuXHRcdFx0XHQgIFx0c3R5bGUgOiBTVFlMRVNbXCJ0ZXN0MlwiXVxyXG5cdFx0XHRcdH0pO1xyXG5cdFx0XHR9XHJcblx0XHRcdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRcdFx0dmFyIGludHMgPSBbXTtcclxuXHRcdFx0dGhpcy5wb3B1cDEgPSBuZXcgb2wuT3ZlcmxheS5Qb3B1cCh7YW5pOmZhbHNlLHBhbk1hcElmT3V0T2ZWaWV3IDogZmFsc2V9KTtcclxuXHRcdFx0dGhpcy5wb3B1cDIgPSBuZXcgb2wuT3ZlcmxheS5Qb3B1cCh7YW5pOmZhbHNlLHBhbk1hcElmT3V0T2ZWaWV3IDogZmFsc2V9KTtcclxuXHRcdFx0dGhpcy5wb3B1cDIuc2V0T2Zmc2V0KFswLDE3NV0pO1xyXG5cdFx0XHR0aGlzLm1hcCA9IG5ldyBvbC5NYXAoe1xyXG5cdFx0XHQgIHJlbmRlcmVyIDogXCJjYW52YXNcIixcclxuXHRcdFx0ICB0YXJnZXQ6ICdtYXAnLFxyXG5cdFx0XHQgIGxheWVyczogW1xyXG5cdFx0XHQgICAgICAgICAgIG5ldyBvbC5sYXllci5UaWxlKHtcclxuXHRcdFx0ICAgICAgICAgICAgICAgc291cmNlOiBuZXcgb2wuc291cmNlLk9TTSgpXHJcblx0XHRcdCAgICAgICAgICAgfSksXHJcblx0XHRcdFx0XHR0aGlzLnRyYWNrTGF5ZXIsXHJcblx0XHRcdFx0XHR0aGlzLmhvdHNwb3RzTGF5ZXIsXHJcblx0XHRcdFx0XHR0aGlzLmNhbXNMYXllcixcclxuXHRcdFx0XHRcdHRoaXMucGFydGljaXBhbnRzTGF5ZXJcclxuXHRcdFx0ICBdLFxyXG5cdFx0XHQgIGNvbnRyb2xzOiB0aGlzLmlzV2lkZ2V0ID8gW10gOiBvbC5jb250cm9sLmRlZmF1bHRzKCksXHJcblx0XHRcdCAgdmlldzogbmV3IG9sLlZpZXcoe1xyXG5cdFx0XHRcdGNlbnRlcjogb2wucHJvai50cmFuc2Zvcm0oZGVmUG9zLCAnRVBTRzo0MzI2JywgJ0VQU0c6Mzg1NycpLFxyXG5cdFx0XHRcdHpvb206IHRoaXMuaW5pdGlhbFpvb20sXHJcblx0XHRcdFx0bWluWm9vbTogdGhpcy5pc1dpZGdldCA/IHRoaXMuaW5pdGlhbFpvb20gOiA4LFxyXG5cdFx0XHRcdG1heFpvb206IHRoaXMuaXNXaWRnZXQgPyB0aGlzLmluaXRpYWxab29tIDogKENPTkZJRy5hcHBlYXJhbmNlLmRlYnVnID8gMjAgOiAxNyksXHJcblx0XHRcdFx0ZXh0ZW50IDogZXh0ZW50ID8gZXh0ZW50IDogdW5kZWZpbmVkXHJcblx0XHRcdCAgfSlcclxuXHRcdFx0fSk7XHJcblx0XHRcdFxyXG5cdFx0XHRmb3IgKHZhciBpPTA7aTxpbnRzLmxlbmd0aDtpKyspXHJcblx0XHRcdFx0dGhpcy5tYXAuYWRkSW50ZXJhY3Rpb24oaW50c1tpXSk7XHJcblx0XHRcdHRoaXMubWFwLmFkZE92ZXJsYXkodGhpcy5wb3B1cDEpO1xyXG5cdFx0XHR0aGlzLm1hcC5hZGRPdmVybGF5KHRoaXMucG9wdXAyKTtcclxuXHRcdFx0aWYgKHRoaXMuaXNEZWJ1ZykgeyBcclxuXHRcdFx0XHR0aGlzLm1hcC5hZGRMYXllcih0aGlzLmRlYnVnTGF5ZXJHUFMpO1xyXG5cdFx0XHRcdHRoaXMubWFwLmFkZExheWVyKHRoaXMudGVzdExheWVyKTtcclxuXHRcdFx0XHR0aGlzLm1hcC5hZGRMYXllcih0aGlzLnRlc3RMYXllcjEpO1xyXG5cdFx0XHRcdHRoaXMubWFwLmFkZExheWVyKHRoaXMudGVzdExheWVyMik7XHJcblx0XHRcdH1cclxuXHRcdFx0VFJBQ0suaW5pdCgpO1xyXG5cdFx0XHR0aGlzLmFkZFRyYWNrRmVhdHVyZSgpO1xyXG5cdFx0XHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRcdFx0aWYgKCF0aGlzLmlzV2lkZ2V0KSB7XHJcblx0XHRcdFx0dGhpcy5tYXAub24oJ2NsaWNrJywgZnVuY3Rpb24gKGV2ZW50KSB7XHJcblx0XHRcdFx0XHRUUkFDSy5vbk1hcENsaWNrKGV2ZW50KTtcclxuXHRcdFx0XHRcdHZhciBzZWxlY3RlZFBhcnRpY2lwYW50cyA9IFtdO1xyXG5cdFx0XHRcdFx0dmFyIHNlbGVjdGVkSG90c3BvdCA9IG51bGw7XHJcblx0XHRcdFx0XHR0aGlzLm1hcC5mb3JFYWNoRmVhdHVyZUF0UGl4ZWwoZXZlbnQucGl4ZWwsIGZ1bmN0aW9uIChmZWF0dXJlLCBsYXllcikge1xyXG5cdFx0XHRcdFx0XHRpZiAobGF5ZXIgPT0gdGhpcy5wYXJ0aWNpcGFudHNMYXllcikge1xyXG5cdFx0XHRcdFx0XHRcdHNlbGVjdGVkUGFydGljaXBhbnRzLnB1c2goZmVhdHVyZSk7XHJcblx0XHRcdFx0XHRcdH0gZWxzZSBpZiAobGF5ZXIgPT0gdGhpcy5ob3RzcG90c0xheWVyKSB7XHJcblx0XHRcdFx0XHRcdFx0Ly8gYWxsb3cgb25seSBvbmUgaG90c3BvdCB0byBiZSBzZWxlY3RlZCBhdCBhIHRpbWVcclxuXHRcdFx0XHRcdFx0XHRpZiAoIXNlbGVjdGVkSG90c3BvdClcclxuXHRcdFx0XHRcdFx0XHRcdHNlbGVjdGVkSG90c3BvdCA9IGZlYXR1cmU7XHJcblx0XHRcdFx0XHRcdH1cclxuXHRcdFx0XHRcdH0sIHRoaXMpO1xyXG5cclxuXHRcdFx0XHRcdC8vIGZpcnN0IGlmIHRoZXJlIGFyZSBzZWxlY3RlZCBwYXJ0aWNpcGFudHMgdGhlbiBzaG93IHRoZWlyIHBvcHVwc1xyXG5cdFx0XHRcdFx0Ly8gYW5kIG9ubHkgaWYgdGhlcmUgYXJlIG5vdCB1c2UgdGhlIHNlbGVjdGVkIGhvdHNwb3QgaWYgdGhlcmUncyBhbnlcclxuXHRcdFx0XHRcdGlmIChzZWxlY3RlZFBhcnRpY2lwYW50cy5sZW5ndGgpIHtcclxuXHRcdFx0XHRcdFx0aWYgKHRoaXMuc2VsZWN0ZWRQYXJ0aWNpcGFudDEgPT0gbnVsbCkge1xyXG5cdFx0XHRcdFx0XHRcdHZhciBmZWF0ID0gdGhpcy5nZXRTZWxlY3RlZFBhcnRpY2lwYW50RnJvbUFycmF5Q3ljbGljKHNlbGVjdGVkUGFydGljaXBhbnRzKTtcclxuXHRcdFx0XHRcdFx0XHRpZiAoZmVhdClcclxuXHRcdFx0XHRcdFx0XHRcdHRoaXMuc2V0U2VsZWN0ZWRQYXJ0aWNpcGFudDEoZmVhdC5wYXJ0aWNpcGFudCk7XHJcblx0XHRcdFx0XHRcdFx0ZWxzZVxyXG5cdFx0XHRcdFx0XHRcdFx0dGhpcy5zZXRTZWxlY3RlZFBhcnRpY2lwYW50MShudWxsKTtcclxuXHRcdFx0XHRcdFx0XHR0aGlzLnNlbGVjdE51bSA9IDA7XHJcblx0XHRcdFx0XHRcdH0gZWxzZSBpZiAodGhpcy5zZWxlY3RlZFBhcnRpY2lwYW50MiA9PSBudWxsKSB7XHJcblx0XHRcdFx0XHRcdFx0dmFyIGZlYXQgPSB0aGlzLmdldFNlbGVjdGVkUGFydGljaXBhbnRGcm9tQXJyYXlDeWNsaWMoc2VsZWN0ZWRQYXJ0aWNpcGFudHMpO1xyXG5cdFx0XHRcdFx0XHRcdGlmIChmZWF0KVxyXG5cdFx0XHRcdFx0XHRcdFx0dGhpcy5zZXRTZWxlY3RlZFBhcnRpY2lwYW50MihmZWF0LnBhcnRpY2lwYW50KTtcclxuXHRcdFx0XHRcdFx0XHRlbHNlXHJcblx0XHRcdFx0XHRcdFx0XHR0aGlzLnNldFNlbGVjdGVkUGFydGljaXBhbnQyKG51bGwpO1xyXG5cdFx0XHRcdFx0XHRcdHRoaXMuc2VsZWN0TnVtID0gMTtcclxuXHRcdFx0XHRcdFx0fSBlbHNlIHtcclxuXHRcdFx0XHRcdFx0XHR0aGlzLnNlbGVjdE51bSA9ICh0aGlzLnNlbGVjdE51bSArIDEpICUgMjtcclxuXHRcdFx0XHRcdFx0XHRpZiAodGhpcy5zZWxlY3ROdW0gPT0gMCkge1xyXG5cdFx0XHRcdFx0XHRcdFx0dmFyIGZlYXQgPSB0aGlzLmdldFNlbGVjdGVkUGFydGljaXBhbnRGcm9tQXJyYXlDeWNsaWMoc2VsZWN0ZWRQYXJ0aWNpcGFudHMpO1xyXG5cdFx0XHRcdFx0XHRcdFx0aWYgKGZlYXQpXHJcblx0XHRcdFx0XHRcdFx0XHRcdHRoaXMuc2V0U2VsZWN0ZWRQYXJ0aWNpcGFudDEoZmVhdC5wYXJ0aWNpcGFudCk7XHJcblx0XHRcdFx0XHRcdFx0XHRlbHNlXHJcblx0XHRcdFx0XHRcdFx0XHRcdHRoaXMuc2V0U2VsZWN0ZWRQYXJ0aWNpcGFudDEobnVsbCk7XHJcblx0XHRcdFx0XHRcdFx0fSBlbHNlIHtcclxuXHRcdFx0XHRcdFx0XHRcdHZhciBmZWF0ID0gdGhpcy5nZXRTZWxlY3RlZFBhcnRpY2lwYW50RnJvbUFycmF5Q3ljbGljKHNlbGVjdGVkUGFydGljaXBhbnRzKTtcclxuXHRcdFx0XHRcdFx0XHRcdGlmIChmZWF0KVxyXG5cdFx0XHRcdFx0XHRcdFx0XHR0aGlzLnNldFNlbGVjdGVkUGFydGljaXBhbnQyKGZlYXQucGFydGljaXBhbnQpO1xyXG5cdFx0XHRcdFx0XHRcdFx0ZWxzZVxyXG5cdFx0XHRcdFx0XHRcdFx0XHR0aGlzLnNldFNlbGVjdGVkUGFydGljaXBhbnQyKG51bGwpO1xyXG5cdFx0XHRcdFx0XHRcdH1cclxuXHRcdFx0XHRcdFx0fVxyXG5cdFx0XHRcdFx0fSBlbHNlIHtcclxuXHRcdFx0XHRcdFx0dGhpcy5zZXRTZWxlY3RlZFBhcnRpY2lwYW50MShudWxsKTtcclxuXHRcdFx0XHRcdFx0dGhpcy5zZXRTZWxlY3RlZFBhcnRpY2lwYW50MihudWxsKTtcclxuXHJcblx0XHRcdFx0XHRcdGlmIChzZWxlY3RlZEhvdHNwb3QpIHtcclxuXHRcdFx0XHRcdFx0XHRzZWxlY3RlZEhvdHNwb3QuaG90c3BvdC5vbkNsaWNrKCk7XHJcblx0XHRcdFx0XHRcdH1cclxuXHRcdFx0XHRcdH1cclxuXHRcdFx0XHR9LCB0aGlzKTtcclxuXHJcblx0XHRcdFx0Ly8gY2hhbmdlIG1vdXNlIGN1cnNvciB3aGVuIG92ZXIgc3BlY2lmaWMgZmVhdHVyZXNcclxuXHRcdFx0XHR2YXIgc2VsZiA9IHRoaXM7XHJcblx0XHRcdFx0JCh0aGlzLm1hcC5nZXRWaWV3cG9ydCgpKS5vbignbW91c2Vtb3ZlJywgZnVuY3Rpb24gKGUpIHtcclxuXHRcdFx0XHRcdHZhciBwaXhlbCA9IHNlbGYubWFwLmdldEV2ZW50UGl4ZWwoZS5vcmlnaW5hbEV2ZW50KTtcclxuXHRcdFx0XHRcdHZhciBpc0NsaWNrYWJsZSA9IHNlbGYubWFwLmZvckVhY2hGZWF0dXJlQXRQaXhlbChwaXhlbCwgZnVuY3Rpb24gKGZlYXR1cmUsIGxheWVyKSB7XHJcblx0XHRcdFx0XHRcdGlmIChsYXllciA9PT0gc2VsZi5wYXJ0aWNpcGFudHNMYXllciB8fCBsYXllciA9PT0gc2VsZi5jYW1zTGF5ZXIpIHtcclxuXHRcdFx0XHRcdFx0XHQvLyBhbGwgcGFydGljaXBhbnRzIGFuZCBtb3ZpbmcgY2FtZXJhcyBhcmUgY2xpY2thYmxlXHJcblx0XHRcdFx0XHRcdFx0cmV0dXJuIHRydWU7XHJcblx0XHRcdFx0XHRcdH0gZWxzZSBpZiAobGF5ZXIgPT09IHNlbGYuaG90c3BvdHNMYXllcikge1xyXG5cdFx0XHRcdFx0XHRcdC8vIGdldCBcImNsaWNrYWJpbGl0eVwiIGZyb20gdGhlIGhvdHNwb3RcclxuXHRcdFx0XHRcdFx0XHRyZXR1cm4gZmVhdHVyZS5ob3RzcG90LmlzQ2xpY2thYmxlKCk7XHJcblx0XHRcdFx0XHRcdH1cclxuXHRcdFx0XHRcdH0pO1xyXG5cdFx0XHRcdFx0c2VsZi5tYXAuZ2V0Vmlld3BvcnQoKS5zdHlsZS5jdXJzb3IgPSBpc0NsaWNrYWJsZSA/ICdwb2ludGVyJyA6ICcnO1xyXG5cdFx0XHRcdH0pO1xyXG5cdFx0XHR9XHJcblx0XHRcdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRcdFx0LyppZiAoIXRoaXMuX2FuaW1hdGlvbkluaXQpIHtcclxuXHRcdFx0XHR0aGlzLl9hbmltYXRpb25Jbml0PXRydWU7XHJcblx0XHRcdFx0c2V0SW50ZXJ2YWwodGhpcy5vbkFuaW1hdGlvbi5iaW5kKHRoaXMpLCAxMDAwKkNPTkZJRy50aW1lb3V0cy5hbmltYXRpb25GcmFtZSApO1xyXG5cdFx0XHR9Ki9cclxuXHJcblx0XHRcdC8vIGlmIHRoaXMgaXMgT04gdGhlbiBpdCB3aWxsIHNob3cgdGhlIGNvb3JkaW5hdGVzIHBvc2l0aW9uIHVuZGVyIHRoZSBtb3VzZSBsb2NhdGlvblxyXG5cdFx0XHRpZiAodGhpcy5pc0RlYnVnU2hvd1Bvc2l0aW9uKSB7XHJcblx0XHRcdFx0JChcIiNtYXBcIikuYXBwZW5kKCc8cCBpZD1cImRlYnVnU2hvd1Bvc2l0aW9uXCI+RVBTRzozODU3IDxzcGFuIGlkPVwibW91c2UzODU3XCI+PC9zcGFuPiAmbmJzcDsgRVBTRzo0MzI2IDxzcGFuIGlkPVwibW91c2U0MzI2XCI+PC9zcGFuPicpO1xyXG5cdFx0XHRcdHRoaXMubWFwLm9uKCdwb2ludGVybW92ZScsIGZ1bmN0aW9uKGV2ZW50KSB7XHJcblx0XHRcdFx0XHR2YXIgY29vcmQzODU3ID0gZXZlbnQuY29vcmRpbmF0ZTtcclxuXHRcdFx0XHRcdHZhciBjb29yZDQzMjYgPSBvbC5wcm9qLnRyYW5zZm9ybShjb29yZDM4NTcsICdFUFNHOjM4NTcnLCAnRVBTRzo0MzI2Jyk7XHJcblx0XHRcdFx0XHQkKCcjbW91c2UzODU3JykudGV4dChvbC5jb29yZGluYXRlLnRvU3RyaW5nWFkoY29vcmQzODU3LCAyKSk7XHJcblx0XHRcdFx0XHQkKCcjbW91c2U0MzI2JykudGV4dChvbC5jb29yZGluYXRlLnRvU3RyaW5nWFkoY29vcmQ0MzI2LCAxNSkpO1xyXG5cdFx0XHRcdH0pO1xyXG5cdFx0XHR9XHJcblxyXG5cdFx0XHQvLyBwYXNzIHRoZSBpZCBvZiB0aGUgRE9NIGVsZW1lbnRcclxuXHRcdFx0dGhpcy5saXZlU3RyZWFtID0gbmV3IExpdmVTdHJlYW0oe2lkIDogXCJsaXZlU3RyZWFtXCJ9KTtcclxuICAgICAgICB9LFxyXG5cdFx0XHJcbiAgICAgICAgXHJcbiAgICAgICAgYWRkVHJhY2tGZWF0dXJlIDogZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgXHRUUkFDSy5pbml0KCk7XHJcbiAgICAgICAgXHRpZiAoVFJBQ0suZmVhdHVyZSkge1xyXG4gICAgICAgIFx0XHR2YXIgZnQgPSB0aGlzLnRyYWNrTGF5ZXIuZ2V0U291cmNlKCkuZ2V0RmVhdHVyZXMoKTtcclxuICAgICAgICBcdFx0dmFyIG9rPWZhbHNlO1xyXG4gICAgICAgIFx0XHRmb3IgKHZhciBpPTA7aTxmdC5sZW5ndGg7aSsrKSBcclxuICAgICAgICBcdFx0e1xyXG4gICAgICAgIFx0XHRcdGlmIChmdFtpXSA9PSBUUkFDSy5mZWF0dXJlKVxyXG4gICAgICAgIFx0XHRcdHtcclxuICAgICAgICBcdFx0XHRcdG9rPXRydWU7XHJcbiAgICAgICAgXHRcdFx0XHRicmVhaztcclxuICAgICAgICBcdFx0XHR9XHJcbiAgICAgICAgXHRcdH1cclxuICAgICAgICBcdFx0aWYgKCFvaylcclxuICAgICAgICBcdFx0XHR0aGlzLnRyYWNrTGF5ZXIuZ2V0U291cmNlKCkuYWRkRmVhdHVyZShUUkFDSy5mZWF0dXJlKTtcclxuICAgICAgICBcdH1cclxuICAgICAgICB9LFxyXG4gICAgICAgIHpvb21Ub1RyYWNrIDogZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgICAgIHZhciBleHRlbnQgPSBUUkFDSy5nZXRSb3V0ZSgpICYmIFRSQUNLLmdldFJvdXRlKCkubGVuZ3RoID4gMSA/IG9sLnByb2oudHJhbnNmb3JtRXh0ZW50KCAobmV3IG9sLmdlb20uTGluZVN0cmluZyhUUkFDSy5nZXRSb3V0ZSgpKSkuZ2V0RXh0ZW50KCkgLCAnRVBTRzo0MzI2JywgJ0VQU0c6Mzg1NycpIDogbnVsbDtcclxuICAgICAgICAgICAgaWYgKGV4dGVudClcclxuICAgICAgICAgICAgXHR0aGlzLm1hcC5nZXRWaWV3KCkuZml0RXh0ZW50KGV4dGVudCx0aGlzLm1hcC5nZXRTaXplKCkpO1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgXHJcbiAgICAgICAgZ2V0U2VsZWN0ZWRQYXJ0aWNpcGFudEZyb21BcnJheUN5Y2xpYyA6IGZ1bmN0aW9uKGZlYXR1cmVzKSB7XHJcbiAgICBcdFx0dmFyIGFyciA9IFtdO1xyXG4gICAgXHRcdHZhciB0bWFwID0ge307XHJcbiAgICBcdFx0dmFyIGNyclBvcyA9IDA7XHJcblx0XHRcdHZhciBwb3M9bnVsbDtcclxuICAgIFx0XHRmb3IgKHZhciBpPTA7aTxmZWF0dXJlcy5sZW5ndGg7aSsrKSB7XHJcbiAgICBcdFx0XHR2YXIgZmVhdHVyZSA9IGZlYXR1cmVzW2ldO1xyXG4gICAgXHRcdFx0dmFyIGlkID0gZmVhdHVyZS5wYXJ0aWNpcGFudC5jb2RlO1xyXG4gICAgXHRcdFx0YXJyLnB1c2goaWQpO1xyXG4gICAgXHRcdFx0dG1hcFtpZF09dHJ1ZTtcclxuXHRcdFx0XHRpZiAoaWQgPT0gdGhpcy52cl9sYXN0c2VsZWN0ZWQpIHtcclxuXHRcdFx0XHRcdHBvcz1pO1xyXG5cdFx0XHRcdH1cclxuICAgIFx0XHR9XHJcbiAgICBcdFx0dmFyIHNhbWUgPSB0aGlzLnZyX29sZGJlc3RhcnIgJiYgcG9zICE9IG51bGw7IFxyXG4gICAgXHRcdGlmIChzYW1lKSBcclxuICAgIFx0XHR7XHJcbiAgICBcdFx0XHQvLyBhbGwgZnJvbSB0aGUgb2xkIGNvbnRhaW5lZCBpbiB0aGUgbmV3XHJcbiAgICBcdFx0XHRmb3IgKHZhciBpPTA7aTx0aGlzLnZyX29sZGJlc3RhcnIubGVuZ3RoO2krKykgXHJcbiAgICBcdFx0XHR7XHJcbiAgICBcdFx0XHRcdGlmICghdG1hcFt0aGlzLnZyX29sZGJlc3RhcnJbaV1dKSB7XHJcbiAgICBcdFx0XHRcdFx0c2FtZT1mYWxzZTtcclxuICAgIFx0XHRcdFx0XHRicmVhaztcclxuICAgIFx0XHRcdFx0fVxyXG4gICAgXHRcdFx0fVxyXG4gICAgXHRcdH1cclxuICAgIFx0XHRpZiAoIXNhbWUpIHtcclxuICAgIFx0XHRcdHRoaXMudnJfb2xkYmVzdGFycj1hcnI7XHJcbiAgICBcdFx0XHR0aGlzLnZyX2xhc3RzZWxlY3RlZD1hcnJbMF07XHJcbiAgICBcdFx0XHRyZXR1cm4gZmVhdHVyZXNbMF07XHJcbiAgICBcdFx0fSBlbHNlIHtcclxuICAgIFx0XHRcdHRoaXMudnJfbGFzdHNlbGVjdGVkID0gcG9zID4gMCA/IGFycltwb3MtMV0gOiBhcnJbYXJyLmxlbmd0aC0xXTsgICAgXHRcdFx0XHJcbiAgICAgICAgXHRcdHZhciByZXN1bHRGZWF0dXJlO1xyXG4gICAgXHRcdFx0Zm9yICh2YXIgaT0wO2k8ZmVhdHVyZXMubGVuZ3RoO2krKykgXHJcbiAgICAgICAgXHRcdHtcclxuICAgICAgICBcdFx0XHR2YXIgZmVhdHVyZSA9IGZlYXR1cmVzW2ldO1xyXG4gICAgICAgIFx0XHRcdHZhciBpZCA9IGZlYXR1cmUucGFydGljaXBhbnQuY29kZTtcclxuICAgICAgICBcdFx0XHRpZiAoaWQgPT0gdGhpcy52cl9sYXN0c2VsZWN0ZWQpIHtcclxuICAgICAgICBcdFx0XHRcdHJlc3VsdEZlYXR1cmU9ZmVhdHVyZTtcclxuICAgICAgICBcdFx0XHRcdGJyZWFrO1xyXG4gICAgICAgIFx0XHRcdH1cclxuICAgICAgICBcdFx0fVxyXG4gICAgICAgICAgICAgICAgcmV0dXJuIHJlc3VsdEZlYXR1cmU7XHJcbiAgICBcdFx0fVxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgXHJcblx0XHRzaG93RXJyb3IgOiBmdW5jdGlvbihtc2csb25DbG9zZUNhbGxiYWNrKVxyXG5cdFx0e1xyXG5cdFx0XHRhbGVydChcIkVSUk9SIDogXCIrbXNnKTtcclxuXHRcdFx0aWYgKG9uQ2xvc2VDYWxsYmFjaykgXHJcblx0XHRcdFx0b25DbG9zZUNhbGxiYWNrKCk7XHJcblx0XHR9LFxyXG5cdFx0XHJcblx0XHRvbkFuaW1hdGlvbiA6IGZ1bmN0aW9uKGN0aW1lKVxyXG5cdFx0e1xyXG5cdFx0XHRpZiAoY3RpbWUpIFxyXG5cdFx0XHR7XHJcblx0XHRcdFx0dmFyIGFycj1bXTtcclxuXHRcdFx0XHRmb3IgKHZhciBpcD0wO2lwPFRSQUNLLnBhcnRpY2lwYW50cy5sZW5ndGg7aXArKylcclxuXHRcdFx0XHR7XHJcblx0XHRcdFx0XHR2YXIgcCA9IFRSQUNLLnBhcnRpY2lwYW50c1tpcF07XHJcblx0XHRcdFx0XHRpZiAocC5pc0Zhdm9yaXRlKVxyXG5cdFx0XHRcdFx0e1xyXG5cdFx0XHRcdFx0XHRwLmludGVycG9sYXRlKGN0aW1lKTtcclxuXHRcdFx0XHRcdFx0Ly8gdGhpcyB3aWxsIGFkZCBpbiB0aGUgcmFua2luZyBwb3NpdGluZyBvbmx5IHRoZSBwYXJ0aWNpcGFudHMgdGhlIGhhcyB0byBiZSB0cmFja2VkXHJcblx0XHRcdFx0XHRcdC8vIHNvIG1vdmluZyBjYW1zIGFyZSBza2lwcGVkXHJcblx0XHRcdFx0XHRcdGlmICghcC5fX3NraXBUcmFja2luZ1BvcylcclxuXHRcdFx0XHRcdFx0XHRhcnIucHVzaChpcCk7XHJcblx0XHRcdFx0XHR9XHJcblx0XHRcdFx0fVxyXG5cdFx0XHRcdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdFx0XHRcdC8vIHdlIGhhdmUgdG8gc29ydCB0aGVtIG90aGVyd2lzZSB0aGlzIF9fcG9zLCBfX3ByZXYsIF9fbmV4dCBhcmUgaXJyZWxldmFudFxyXG5cdFx0XHRcdGFyci5zb3J0KGZ1bmN0aW9uKGlwMSwgaWQyKXtcclxuXHRcdFx0XHRcdHJldHVybiBUUkFDSy5wYXJ0aWNpcGFudHNbaWQyXS5nZXRFbGFwc2VkKCkgLSBUUkFDSy5wYXJ0aWNpcGFudHNbaXAxXS5nZXRFbGFwc2VkKCk7XHJcblx0XHRcdFx0fSk7XHJcblx0XHRcdFx0Zm9yICh2YXIgaXA9MDtpcDxhcnIubGVuZ3RoO2lwKyspXHJcblx0XHRcdFx0e1xyXG5cdFx0XHRcdFx0VFJBQ0sucGFydGljaXBhbnRzW2FycltpcF1dLl9fcG9zPWlwO1xyXG5cdFx0XHRcdFx0aWYgKGlwID09IDApXHJcblx0XHRcdFx0XHRcdGRlbGV0ZSBUUkFDSy5wYXJ0aWNpcGFudHNbYXJyW2lwXV0uX19wcmV2O1xyXG5cdFx0XHRcdFx0ZWxzZVxyXG5cdFx0XHRcdFx0XHRUUkFDSy5wYXJ0aWNpcGFudHNbYXJyW2lwXV0uX19wcmV2PVRSQUNLLnBhcnRpY2lwYW50c1thcnJbaXAtMV1dO1xyXG5cdFx0XHRcdFx0aWYgKGlwID09IFRSQUNLLnBhcnRpY2lwYW50cy5sZW5ndGgtMSlcclxuXHRcdFx0XHRcdFx0ZGVsZXRlICBUUkFDSy5wYXJ0aWNpcGFudHNbYXJyW2lwXV0uX19uZXh0O1xyXG5cdFx0XHRcdFx0ZWxzZVxyXG5cdFx0XHRcdFx0XHRUUkFDSy5wYXJ0aWNpcGFudHNbYXJyW2lwXV0uX19uZXh0PVRSQUNLLnBhcnRpY2lwYW50c1thcnJbaXArMV1dO1xyXG5cdFx0XHRcdH1cclxuXHRcdFx0fVxyXG5cdFx0XHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRcdFx0dmFyIHRpbWVTd2l0Y2ggPSBNYXRoLnJvdW5kKChuZXcgRGF0ZSgpKS5nZXRUaW1lKCkvKDEwMDAqNSkpJTI7XHJcblx0XHRcdHZhciB0b1BhbiA9IFtdO1xyXG5cdFx0XHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRcdFx0aWYgKHRoaXMuc2VsZWN0ZWRQYXJ0aWNpcGFudDEpIFxyXG5cdFx0XHR7XHJcblx0XHRcdFx0dmFyIGN0aW1lID0gdGhpcy5zZWxlY3RlZFBhcnRpY2lwYW50MS5fX2N0aW1lO1xyXG5cdFx0XHRcdHZhciBzcG9zID0gdGhpcy5zZWxlY3RlZFBhcnRpY2lwYW50MS5nZXRGZWF0dXJlKCkuZ2V0R2VvbWV0cnkoKS5nZXRDb29yZGluYXRlcygpO1xyXG5cdFx0XHRcdGlmICghdGhpcy5wb3B1cDEuaXNfc2hvd24pIHtcclxuXHRcdFx0XHQgICAgdGhpcy5wb3B1cDEuc2hvdyhzcG9zLCB0aGlzLnBvcHVwMS5sYXN0SFRNTD10aGlzLnNlbGVjdGVkUGFydGljaXBhbnQxLmdldFBvcHVwSFRNTChjdGltZSkpO1xyXG5cdFx0XHRcdCAgICB0aGlzLnBvcHVwMS5pc19zaG93bj0xO1xyXG5cdFx0XHRcdH0gZWxzZSB7XHJcblx0XHRcdFx0XHRpZiAoIXRoaXMucG9wdXAxLmdldFBvc2l0aW9uKCkgfHwgdGhpcy5wb3B1cDEuZ2V0UG9zaXRpb24oKVswXSAhPSBzcG9zWzBdIHx8IHRoaXMucG9wdXAxLmdldFBvc2l0aW9uKClbMV0gIT0gc3Bvc1sxXSlcclxuXHRcdFx0XHRcdCAgICB0aGlzLnBvcHVwMS5zZXRQb3NpdGlvbihzcG9zKTtcclxuXHRcdFx0XHRcdGlmICghdGhpcy5sYXN0UG9wdXBSZWZlcmVzaDEgfHwgKG5ldyBEYXRlKCkpLmdldFRpbWUoKSAtIHRoaXMubGFzdFBvcHVwUmVmZXJlc2gxID4gMjAwMCkgXHJcblx0XHRcdFx0XHR7XHJcblx0XHRcdFx0XHRcdHRoaXMubGFzdFBvcHVwUmVmZXJlc2gxPShuZXcgRGF0ZSgpKS5nZXRUaW1lKCk7XHJcblx0XHRcdFx0XHQgICAgdmFyIHJyID0gdGhpcy5zZWxlY3RlZFBhcnRpY2lwYW50MS5nZXRQb3B1cEhUTUwoY3RpbWUpO1xyXG5cdFx0XHRcdFx0ICAgIGlmIChyciAhPSB0aGlzLnBvcHVwMS5sYXN0SFRNTCkge1xyXG5cdFx0XHRcdFx0ICAgIFx0dGhpcy5wb3B1cDEubGFzdEhUTUw9cnI7XHJcblx0XHRcdFx0XHRcdCAgICB0aGlzLnBvcHVwMS5jb250ZW50LmlubmVySFRNTD1ycjsgXHJcblx0XHRcdFx0XHQgICAgfVx0XHRcdFx0XHRcclxuXHRcdFx0XHRcdH1cclxuXHRcdFx0XHRcdHRvUGFuLnB1c2goW3RoaXMucG9wdXAxLHNwb3NdKTtcclxuXHRcdFx0XHR9XHJcblx0XHRcdH1cclxuXHRcdFx0aWYgKHRoaXMuc2VsZWN0ZWRQYXJ0aWNpcGFudDIpIFxyXG5cdFx0XHR7XHJcblx0XHRcdFx0dmFyIGN0aW1lID0gdGhpcy5zZWxlY3RlZFBhcnRpY2lwYW50Mi5fX2N0aW1lO1xyXG5cdFx0XHRcdHZhciBzcG9zID0gdGhpcy5zZWxlY3RlZFBhcnRpY2lwYW50Mi5nZXRGZWF0dXJlKCkuZ2V0R2VvbWV0cnkoKS5nZXRDb29yZGluYXRlcygpO1xyXG5cdFx0XHRcdGlmICghdGhpcy5wb3B1cDIuaXNfc2hvd24pIHtcclxuXHRcdFx0XHQgICAgdGhpcy5wb3B1cDIuc2hvdyhzcG9zLCB0aGlzLnBvcHVwMi5sYXN0SFRNTD10aGlzLnNlbGVjdGVkUGFydGljaXBhbnQyLmdldFBvcHVwSFRNTChjdGltZSkpO1xyXG5cdFx0XHRcdCAgICB0aGlzLnBvcHVwMi5pc19zaG93bj0xO1xyXG5cdFx0XHRcdH0gZWxzZSB7XHJcblx0XHRcdFx0XHRpZiAoIXRoaXMucG9wdXAyLmdldFBvc2l0aW9uKCkgfHwgdGhpcy5wb3B1cDIuZ2V0UG9zaXRpb24oKVswXSAhPSBzcG9zWzBdIHx8IHRoaXMucG9wdXAyLmdldFBvc2l0aW9uKClbMV0gIT0gc3Bvc1sxXSlcclxuXHRcdFx0XHRcdCAgICB0aGlzLnBvcHVwMi5zZXRQb3NpdGlvbihzcG9zKTtcclxuXHRcdFx0XHRcdGlmICghdGhpcy5sYXN0UG9wdXBSZWZlcmVzaDIgfHwgKG5ldyBEYXRlKCkpLmdldFRpbWUoKSAtIHRoaXMubGFzdFBvcHVwUmVmZXJlc2gyID4gMjAwMCkgXHJcblx0XHRcdFx0XHR7XHJcblx0XHRcdFx0XHRcdHRoaXMubGFzdFBvcHVwUmVmZXJlc2gyPShuZXcgRGF0ZSgpKS5nZXRUaW1lKCk7XHJcblx0XHRcdFx0XHQgICAgdmFyIHJyID0gdGhpcy5zZWxlY3RlZFBhcnRpY2lwYW50Mi5nZXRQb3B1cEhUTUwoY3RpbWUpO1xyXG5cdFx0XHRcdFx0ICAgIGlmIChyciAhPSB0aGlzLnBvcHVwMi5sYXN0SFRNTCkge1xyXG5cdFx0XHRcdFx0ICAgIFx0dGhpcy5wb3B1cDIubGFzdEhUTUw9cnI7XHJcblx0XHRcdFx0XHRcdCAgICB0aGlzLnBvcHVwMi5jb250ZW50LmlubmVySFRNTD1ycjsgXHJcblx0XHRcdFx0XHQgICAgfVx0XHRcdFx0XHRcclxuXHRcdFx0XHRcdH1cclxuXHRcdFx0XHRcdHRvUGFuLnB1c2goW3RoaXMucG9wdXAyLHNwb3NdKTtcclxuXHRcdFx0XHR9XHJcblx0XHRcdH1cclxuXHRcdFx0Ly8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdFx0XHRpZiAodG9QYW4ubGVuZ3RoID09IDEpIHtcclxuXHRcdFx0XHR0b1BhblswXVswXS5wYW5JbnRvVmlld18odG9QYW5bMF1bMV0pO1xyXG5cdFx0XHR9IGVsc2UgaWYgKHRvUGFuLmxlbmd0aCA9PSAyKSB7XHJcblx0XHRcdFx0dG9QYW5bdGltZVN3aXRjaF1bMF0ucGFuSW50b1ZpZXdfKHRvUGFuW3RpbWVTd2l0Y2hdWzFdKTtcclxuXHRcdFx0fVxyXG5cdFx0XHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tXHRcdFx0XHJcblx0XHRcdGlmICh0aGlzLmlzRGVidWcpICBcclxuXHRcdFx0XHR0aGlzLmRvRGVidWdBbmltYXRpb24oKTtcclxuXHRcdH0sXHJcblx0XHRcclxuXHRcdHNldFNlbGVjdGVkUGFydGljaXBhbnQxIDogZnVuY3Rpb24ocGFydCxjZW50ZXIpIHtcclxuXHRcdFx0Ly8gVE9ETyBSdW1lbiAtIG1lcmdlIHNldFNlbGVjdGVkUGFydGljaXBhbnQxIGFuZCBzZXRTZWxlY3RlZFBhcnRpY2lwYW50MiBpbiBvbmx5IG9uZSBtZXRob2RcclxuXHRcdFx0Ly8gVE9ETyBSdW1lbiAtIGFuZCB1c2Ugb25seSBpdCAtIHByb2JhYmx5IG1lcmdlIHRoZW0gdG9nZXRoZXIgYWxzbyB3aXRoIHNldFNlbGVjdGVkUGFydGljaXBhbnRcclxuXHRcdFx0aWYgKHRoaXMuc2VsZWN0ZWRQYXJ0aWNpcGFudDIgJiYgdGhpcy5zZWxlY3RlZFBhcnRpY2lwYW50MiA9PSBwYXJ0KVxyXG5cdFx0XHRcdHJldHVybjtcclxuXHRcdFx0dGhpcy5zZWxlY3RlZFBhcnRpY2lwYW50MT1wYXJ0O1xyXG5cdFx0XHRpZiAoIXBhcnQpIHtcclxuXHRcdFx0XHR0aGlzLnBvcHVwMS5oaWRlKCk7XHJcblx0XHRcdFx0ZGVsZXRlIHRoaXMucG9wdXAxLmlzX3Nob3duO1xyXG5cdFx0XHR9IGVsc2Uge1xyXG5cdFx0XHRcdHRoaXMubGFzdFBvcHVwUmVmZXJlc2gxPTA7XHJcblx0XHRcdFx0aWYgKGNlbnRlciAmJiBHVUkubWFwICYmIHBhcnQuZmVhdHVyZSkge1xyXG5cdFx0XHRcdFx0dmFyIHggPSAocGFydC5mZWF0dXJlLmdldEdlb21ldHJ5KCkuZ2V0RXh0ZW50KClbMF0rcGFydC5mZWF0dXJlLmdldEdlb21ldHJ5KCkuZ2V0RXh0ZW50KClbMl0pLzI7XHJcblx0XHRcdFx0XHR2YXIgeSA9IChwYXJ0LmZlYXR1cmUuZ2V0R2VvbWV0cnkoKS5nZXRFeHRlbnQoKVsxXStwYXJ0LmZlYXR1cmUuZ2V0R2VvbWV0cnkoKS5nZXRFeHRlbnQoKVszXSkvMjtcclxuXHRcdFx0XHRcdEdVSS5tYXAuZ2V0VmlldygpLnNldENlbnRlcihbeCx5XSk7XHJcblx0XHRcdFx0fVxyXG5cdFx0XHR9IFxyXG5cdFx0fSxcclxuXHJcblx0XHRzZXRTZWxlY3RlZFBhcnRpY2lwYW50MiA6IGZ1bmN0aW9uKHBhcnQsY2VudGVyKSB7XHJcblx0XHRcdGlmICh0aGlzLnNlbGVjdGVkUGFydGljaXBhbnQxICYmIHRoaXMuc2VsZWN0ZWRQYXJ0aWNpcGFudDEgPT0gcGFydClcclxuXHRcdFx0XHRyZXR1cm47XHJcblx0XHRcdHRoaXMuc2VsZWN0ZWRQYXJ0aWNpcGFudDI9cGFydDtcclxuXHRcdFx0aWYgKCFwYXJ0KSB7XHJcblx0XHRcdFx0dGhpcy5wb3B1cDIuaGlkZSgpO1xyXG5cdFx0XHRcdGRlbGV0ZSB0aGlzLnBvcHVwMi5pc19zaG93bjtcclxuXHRcdFx0fSBlbHNlIHtcclxuXHRcdFx0XHR0aGlzLmxhc3RQb3B1cFJlZmVyZXNoMj0wO1xyXG5cdFx0XHRcdGlmIChjZW50ZXIgJiYgR1VJLm1hcCAmJiBwYXJ0LmZlYXR1cmUpIHtcclxuXHRcdFx0XHRcdHZhciB4ID0gKHBhcnQuZmVhdHVyZS5nZXRHZW9tZXRyeSgpLmdldEV4dGVudCgpWzBdK3BhcnQuZmVhdHVyZS5nZXRHZW9tZXRyeSgpLmdldEV4dGVudCgpWzJdKS8yO1xyXG5cdFx0XHRcdFx0dmFyIHkgPSAocGFydC5mZWF0dXJlLmdldEdlb21ldHJ5KCkuZ2V0RXh0ZW50KClbMV0rcGFydC5mZWF0dXJlLmdldEdlb21ldHJ5KCkuZ2V0RXh0ZW50KClbM10pLzI7XHJcblx0XHRcdFx0XHRHVUkubWFwLmdldFZpZXcoKS5zZXRDZW50ZXIoW3gseV0pO1xyXG5cdFx0XHRcdH1cclxuXHRcdFx0fSBcclxuXHRcdH0sXHJcblxyXG5cdFx0c2V0U2VsZWN0ZWRQYXJ0aWNpcGFudCA6IGZ1bmN0aW9uKHBhcnQpIHtcclxuXHRcdFx0aWYgKCF0aGlzLnBvcHVwMS5pc19zaG93bikgIHtcclxuXHRcdFx0XHR0aGlzLnNldFNlbGVjdGVkUGFydGljaXBhbnQxKHBhcnQsIHRydWUpO1xyXG5cdFx0XHR9IGVsc2UgaWYgKCF0aGlzLnBvcHVwMi5pc19zaG93bikge1xyXG5cdFx0XHRcdHRoaXMuc2V0U2VsZWN0ZWRQYXJ0aWNpcGFudDIocGFydCwgdHJ1ZSk7XHJcblx0XHRcdH0gZWxzZSB7XHJcblx0XHRcdFx0dGhpcy5zZXRTZWxlY3RlZFBhcnRpY2lwYW50MShwYXJ0LCB0cnVlKTtcclxuXHRcdFx0fVxyXG5cdFx0fSxcclxuXHJcblx0XHRkb0RlYnVnQW5pbWF0aW9uIDogZnVuY3Rpb24oKSBcclxuXHRcdHtcclxuXHRcdFx0dmFyIGN0aW1lID0gKG5ldyBEYXRlKCkpLmdldFRpbWUoKTtcclxuXHRcdFx0dmFyIHRvZGVsPVtdO1xyXG5cdFx0XHR2YXIgcnIgPSB0aGlzLmRlYnVnTGF5ZXJHUFMuZ2V0U291cmNlKCkuZ2V0RmVhdHVyZXMoKTtcclxuXHRcdFx0Zm9yICh2YXIgaT0wO2k8cnIubGVuZ3RoO2krKylcclxuXHRcdFx0e1xyXG5cdFx0XHRcdHZhciBmID0gcnJbaV07XHJcblx0XHRcdFx0aWYgKGN0aW1lIC0gZi50aW1lQ3JlYXRlZCAtIENPTkZJRy5tYXRoLmRpc3BsYXlEZWxheSoxMDAwID4gQ09ORklHLnRpbWVvdXRzLmdwc0xvY2F0aW9uRGVidWdTaG93KjEwMDApXHJcblx0XHRcdFx0XHR0b2RlbC5wdXNoKGYpO1xyXG5cdFx0XHRcdGVsc2VcclxuXHRcdFx0XHRcdGYuY2hhbmdlZCgpO1xyXG5cdFx0XHR9XHJcblx0XHRcdGlmICh0b2RlbC5sZW5ndGgpIFxyXG5cdFx0XHR7XHJcblx0XHRcdFx0Zm9yICh2YXIgaT0wO2k8dG9kZWwubGVuZ3RoO2krKylcclxuXHRcdFx0XHRcdHRoaXMuZGVidWdMYXllckdQUy5nZXRTb3VyY2UoKS5yZW1vdmVGZWF0dXJlKHRvZGVsW2ldKTtcclxuXHRcdFx0fVxyXG5cdFx0XHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRcdH0sXHJcblx0XHRcclxuXHRcdHJlZHJhdyA6IGZ1bmN0aW9uKCkge1xyXG5cdFx0XHR0aGlzLmdldFRyYWNrKCkuZ2V0RmVhdHVyZSgpLmNoYW5nZWQoKTtcclxuXHRcdH0sXHJcblxyXG4gICAgICAgIC8qKlxyXG4gICAgICAgICAqIFNob3cgdGhlIGxpdmUtc3RyZWFtaW5nIGNvbnRhaW5lci4gSWYgdGhlIHBhc3NlZCAnc3RyZWFtSWQnIGlzIHZhbGlkIHRoZW4gaXQgb3BlbnMgaXRzIHN0cmVhbSBkaXJlY3RseS5cclxuICAgICAgICAgKiBAcGFyYW0ge1N0cmluZ30gW3N0cmVhbUlkXVxyXG4gICAgICAgICAqIEBwYXJhbSB7RnVuY3Rpb259IFtjb21wbGV0ZUNhbGxiYWNrXVxyXG4gICAgICAgICAqL1xyXG4gICAgICAgIHNob3dMaXZlU3RyZWFtIDogZnVuY3Rpb24oc3RyZWFtSWQsIGNvbXBsZXRlQ2FsbGJhY2spIHtcclxuICAgICAgICAgICAgdGhpcy5saXZlU3RyZWFtLnNob3coc3RyZWFtSWQsIGNvbXBsZXRlQ2FsbGJhY2spO1xyXG4gICAgICAgIH0sXHJcblxyXG4gICAgICAgIC8qKlxyXG4gICAgICAgICAqIFRvZ2dsZSB0aGUgbGl2ZS1zdHJlYW1pbmcgY29udGFpbmVyIGNvbnRhaW5lclxyXG5cdFx0ICogQHBhcmFtIHtGdW5jdGlvbn0gW2NvbXBsZXRlQ2FsbGJhY2tdXHJcbiAgICAgICAgICovXHJcbiAgICAgICAgdG9nZ2xlTGl2ZVN0cmVhbTogZnVuY3Rpb24oY29tcGxldGVDYWxsYmFjaykge1xyXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5saXZlU3RyZWFtLnRvZ2dsZShjb21wbGV0ZUNhbGxiYWNrKTtcclxuICAgICAgICB9XHJcblx0XHRcclxuICAgIH1cclxufSk7IiwicmVxdWlyZSgnam9vc2UnKTtcclxucmVxdWlyZSgnLi9Qb2ludCcpO1xyXG5yZXF1aXJlKCcuL1V0aWxzJyk7XHJcblxyXG5DbGFzcyhcIkhvdFNwb3RcIiwge1xyXG4gICAgaXNhIDogUG9pbnQsXHJcblxyXG4gICAgaGFzIDoge1xyXG4gICAgICAgIHR5cGUgOiB7XHJcbiAgICAgICAgICAgIGlzIDogXCJyb1wiLFxyXG4gICAgICAgICAgICByZXF1aXJlZCA6IHRydWUsXHJcbiAgICAgICAgICAgIGluaXQgOiBudWxsXHJcbiAgICAgICAgfSxcclxuXHJcbiAgICAgICAgY2xpY2thYmxlIDoge1xyXG4gICAgICAgICAgICBpbml0IDogZmFsc2VcclxuICAgICAgICB9LFxyXG5cclxuICAgICAgICBsaXZlU3RyZWFtIDoge1xyXG4gICAgICAgICAgICBpbml0IDogbnVsbFxyXG4gICAgICAgIH1cclxuICAgIH0sXHJcblxyXG4gICAgYWZ0ZXIgOiB7XHJcbiAgICAgICAgaW5pdCA6IGZ1bmN0aW9uKCkge1xyXG4gICAgICAgICAgICB0aGlzLmZlYXR1cmUuaG90c3BvdD10aGlzO1xyXG4gICAgICAgICAgICBHVUkuaG90c3BvdHNMYXllci5nZXRTb3VyY2UoKS5hZGRGZWF0dXJlKHRoaXMuZmVhdHVyZSk7XHJcbiAgICAgICAgfVxyXG4gICAgfSxcclxuXHJcbiAgICBtZXRob2RzIDoge1xyXG4gICAgICAgIG9uQ2xpY2sgOiBmdW5jdGlvbigpIHtcclxuICAgICAgICAgICAgdmFyIGlzQ29uc3VtZWQgPSBmYWxzZTtcclxuXHJcbiAgICAgICAgICAgIGlmICh0aGlzLmNsaWNrYWJsZSkge1xyXG4gICAgICAgICAgICAgICAgLy8gZm9yIG5vdyBvbmx5IGhvdHNwb3RzIHdpdGggYXR0YWNoZWQgbGl2ZS1zdHJlYW0gY2FuIGJlIGNsaWNrZWRcclxuICAgICAgICAgICAgICAgIGlmIChpc0RlZmluZWQodGhpcy5saXZlU3RyZWFtKSkge1xyXG4gICAgICAgICAgICAgICAgICAgIEdVSS5zaG93TGl2ZVN0cmVhbSh0aGlzLmxpdmVTdHJlYW0pO1xyXG4gICAgICAgICAgICAgICAgICAgIC8vIHdlbGwgdGhpcyBldmVudCBzaG91bGQgYmUgY29uc3VtZWQgYW5kIG5vdCBoYW5kbGVkIGFueSBtb3JlIChsaWtlIHdoZW4gY2xpY2tlZCBvbiBhbm90aGVyIGZlYXR1cmVcclxuICAgICAgICAgICAgICAgICAgICBpc0NvbnN1bWVkID0gdHJ1ZTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgcmV0dXJuIGlzQ29uc3VtZWRcclxuICAgICAgICB9LFxyXG5cclxuICAgICAgICBpc0NsaWNrYWJsZSA6IGZ1bmN0aW9uKCkge1xyXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5jbGlja2FibGU7XHJcbiAgICAgICAgfVxyXG5cclxuICAgIH1cclxufSk7IiwiLypcclxuXHJcblx0Q1VTVE9NSEFDSyBJTiBqcXVlcnkuZnVsbFBhZ2UuanNcclxuXHRUT0RPIDogRklYIElOIExBVEVSIFJFTEVBU0VTXHJcblx0XHJcblx0ICAgIGZ1bmN0aW9uIHRvdWNoTW92ZUhhbmRsZXIoZXZlbnQpe1xyXG4gICAgICAgIFx0Ly8gSEFDS1xyXG4gICAgICAgIFx0aWYgKHRoaXMuX19kaXNhYmxlKVxyXG4gICAgICAgIFx0XHRyZXR1cm47XHJcbiAgICAgICAgXHRcdFxyXG4gICAgICAgIC4uXHJcbiAgICAgICAgZnVuY3Rpb24gdG91Y2hTdGFydEhhbmRsZXIoZXZlbnQpIHtcclxuICAgICAgICBcdC8vIEhBQ0sgXHJcbiAgICAgICAgXHRpZiAoISQoZXZlbnQudGFyZ2V0KS5pcyhcImgxXCIpKSB7XHJcbiAgICAgICAgXHRcdHRoaXMuX19kaXNhYmxlPTE7XHJcbiAgICAgICAgXHRcdHJldHVybjsgICAgICAgIFx0XHJcbiAgICAgICAgXHR9XHJcbiAgICAgICAgXHR0aGlzLl9fZGlzYWJsZT0wO1xyXG4gICAgICAgIC4uXHJcbiAqIFxyXG4gKi9cclxuLy8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxucmVxdWlyZSgnLi9UcmFjaycpO1xyXG5yZXF1aXJlKCcuL0d1aScpO1xyXG5yZXF1aXJlKCcuL1BhcnRpY2lwYW50Jyk7XHJcbnJlcXVpcmUoJy4vTW92aW5nQ2FtJyk7XHJcbnJlcXVpcmUoJy4vSG90U3BvdCcpO1xyXG52YXIgU1RZTEVTPXJlcXVpcmUoJy4vU3R5bGVzJyk7XHJcbndpbmRvdy5DT05GSUcgPSByZXF1aXJlKCcuL0NvbmZpZycpO1xyXG52YXIgVXRpbHMgPSByZXF1aXJlKCcuL1V0aWxzJyk7XHJcbmZvciAodmFyIGUgaW4gVXRpbHMpXHJcbiAgICB3aW5kb3dbZV0gPSBVdGlsc1tlXTtcclxuLy8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuZnVuY3Rpb24gZ2V0U2VhcmNoUGFyYW1ldGVycygpIHtcclxuICAgIHZhciBwcm1zdHIgPSB3aW5kb3cubG9jYXRpb24uc2VhcmNoLnN1YnN0cigxKTtcclxuICAgIHJldHVybiBwcm1zdHIgIT0gbnVsbCAmJiBwcm1zdHIgIT0gXCJcIiA/IHRyYW5zZm9ybVRvQXNzb2NBcnJheShwcm1zdHIpIDoge307XHJcbn1cclxuZnVuY3Rpb24gdHJhbnNmb3JtVG9Bc3NvY0FycmF5KHBybXN0cikge1xyXG4gICAgdmFyIHBhcmFtcyA9IHt9O1xyXG4gICAgdmFyIHBybWFyciA9IHBybXN0ci5zcGxpdChcIiZcIik7XHJcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IHBybWFyci5sZW5ndGg7IGkrKykge1xyXG4gICAgICAgIHZhciB0bXBhcnIgPSBwcm1hcnJbaV0uc3BsaXQoXCI9XCIpO1xyXG4gICAgICAgIHBhcmFtc1t0bXBhcnJbMF1dID0gdG1wYXJyWzFdO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIHBhcmFtcztcclxufVxyXG53aW5kb3cub25PcGVuID0gZnVuY3Rpb24oaWQpIHtcclxuXHR3aW5kb3cubG9jYXRpb24uaHJlZj1cImxpdmUuaHRtbD9ldmVudD1cIitlbmNvZGVVUklDb21wb25lbnQoaWQpO1xyXG59XHJcbnZhciBwYXJhbXMgPSBnZXRTZWFyY2hQYXJhbWV0ZXJzKCk7XHJcbi8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuJC5hamF4KHtcclxuICAgIHR5cGU6IFwiR0VUXCIsXHJcbiAgICB1cmw6IFwiZXZlbnRzXCIsXHJcbiAgICBjb250ZW50VHlwZTogXCJhcHBsaWNhdGlvbi9qc29uOyBjaGFyc2V0PXV0Zi04XCIsXHJcbiAgICBkYXRhVHlwZTogXCJqc29uXCIsXHJcbiAgICBzdWNjZXNzOiBmdW5jdGlvbihkYXRhKVxyXG4gICAge1xyXG4gICAgXHRcclxuICAgIFx0dmFyIHR0PVtdO1xyXG4gICAgXHRmb3IgKHZhciBlIGluIGRhdGEuZGF0YSkgXHJcbiAgICBcdHtcclxuICAgIFx0XHR2YXIgZXYgPSBkYXRhLmRhdGFbZV07XHJcbiAgICBcdFx0dmFyIHRyYWNrPUpTT04ucGFyc2UoZXYudHJhY2spOyAgICAgICAgXHRcdFxyXG4gICAgXHRcdHZhciBleHRlbnQgPSBvbC5wcm9qLnRyYW5zZm9ybUV4dGVudCggKG5ldyBvbC5nZW9tLkxpbmVTdHJpbmcodHJhY2spKS5nZXRFeHRlbnQoKSAsICdFUFNHOjQzMjYnLCAnRVBTRzozODU3Jyk7XHJcbiAgICBcdFx0dmFyIGgxdCA9IFwiPGRpdiBjbGFzcz0nY250JyBpZD0nY250XCIrZStcIic+XCIrZXYuY29kZStcIjxkaXYgY2xhc3M9J2R1cic+XCIrZXYuc3RhcnRUaW1lK1wiJm5ic3A7Jm5ic3A7Jm5ic3A7Jm5ic3A7XCIrZXYuZW5kVGltZStcIjwvZGl2PjwvZGl2PlwiO1xyXG4gICAgXHRcdHZhciBtZGl2ID0gJChcIiNmdWxscGFnZVwiKS5hcHBlbmQoJzxkaXYgY2xhc3M9XCJzZWN0aW9uICcrKGUgPT0gMCA/ICdhY3RpdmUnIDogJycpKydcIiBpZD1cInNlY3Rpb24nK2UrJ1wiPjxkaXYgY2xhc3M9XCJwcmVcIiBpZD1cInByZScrZSsnXCI+PC9kaXY+PGRpdiBjbGFzcz1cImZyZVwiIGlkPVwiZnJlJytlKydcIj48aDE+JytoMXQrJzwvaDE+PC9kaXY+PG1lbnUgY2xhc3M9XCJtZWRpdW0gcGxheWJ0blwiPjxidXR0b24gY2xhc3M9XCJwbGF5XCIgb25jbGljaz1cIm9uT3BlbihcXCcnK2V2LmlkKydcXCcpXCI+PC9idXR0b24+PC9tZW51PjwvZGl2PicpO1xyXG4gICAgXHRcdHR0LnB1c2goZXYuY29kZSk7XHJcblx0XHRcdHZhciByYXN0ZXIgPSBuZXcgb2wubGF5ZXIuVGlsZSh7c291cmNlIDogbmV3IG9sLnNvdXJjZS5PU00oKS8qLGV4dGVudCA6IGV4dGVudCovIH0pO1xyXG5cdFx0XHR2YXIgdHJhY2tMYXllciA9IG5ldyBvbC5sYXllci5WZWN0b3Ioe1xyXG5cdFx0XHRcdCAgc291cmNlOiBuZXcgb2wuc291cmNlLlZlY3RvcigpLFxyXG5cdFx0XHRcdCAgc3R5bGUgOiBTVFlMRVNbXCJ0cmFja1wiXVxyXG5cdFx0XHRcdCAgLy9leHRlbnQgOiBleHRlbnRcclxuXHRcdFx0fSk7XHJcblx0XHRcdHZhciBtYXAgPSBuZXcgb2wuTWFwKHtcclxuXHRcdFx0XHRsb2dvIDogZmFsc2UsXHJcblx0XHRcdFx0aW50ZXJhY3Rpb25zIDogb2wuaW50ZXJhY3Rpb24uZGVmYXVsdHMoe1xyXG5cdFx0XHRcdFx0bW91c2VXaGVlbFpvb20gOiBmYWxzZVxyXG5cdFx0XHRcdH0pLFxyXG5cdFx0XHRcdHRhcmdldCA6ICdwcmUnICsgZSxcclxuXHRcdFx0XHRsYXllcnMgOiBbIHJhc3Rlcix0cmFja0xheWVyIF0sXHJcblx0XHRcdFx0Y29udHJvbHMgOiBvbC5jb250cm9sLmRlZmF1bHRzKCksXHJcblx0XHRcdFx0dmlldyA6IG5ldyBvbC5WaWV3KHtcclxuXHRcdFx0XHRcdGNlbnRlciA6IFsgNzM5MjE4LCA1OTA2MDk2IF0sXHJcblx0XHRcdFx0XHRtaW5ab29tIDogMSxcclxuXHRcdFx0XHRcdG1heFpvb20gOiAxNyxcclxuXHRcdFx0XHRcdHpvb20gOiAxN1xyXG5cdFx0XHRcdFx0Ly9leHRlbnQgOiBleHRlbnRcclxuXHRcdFx0XHR9KVxyXG5cdFx0XHR9KTtcclxuXHRcdFx0Ly9tYXAuZ2V0VmlldygpLmZpdEV4dGVudChleHRlbnQsIG1hcC5nZXRTaXplKCkpO1xyXG5cdFx0XHQvLy0tLS0tLS1cclxuXHRcdFx0dmFyIFRSQUNLID0gbmV3IFRyYWNrKCk7XHJcblx0XHRcdFRSQUNLLnNldEJpa2VTdGFydEtNKHBhcnNlRmxvYXQoZXYuYmlrZVN0YXJ0S00pKTtcclxuXHQgICAgICAgIFRSQUNLLnNldFJ1blN0YXJ0S00ocGFyc2VGbG9hdChldi5ydW5TdGFydEtNKSk7XHJcblx0ICAgICAgICBUUkFDSy5zZXRSb3V0ZSh0cmFjayk7XHJcblx0ICAgICAgICB3aW5kb3cuR1VJID0gbmV3IE9iamVjdCgpO1xyXG5cdCAgICAgICAgR1VJLmlzU2hvd1N3aW09dHJ1ZTtcclxuXHQgICAgICAgIEdVSS5pc1Nob3dCaWtlPXRydWU7XHJcblx0ICAgICAgICBHVUkuaXNTaG93UnVuPXRydWU7XHJcblx0ICAgICAgICBHVUkubWFwPW1hcDtcclxuXHQgICAgICAgIFRSQUNLLmluaXQoKTtcclxuXHQgICAgICAgIHRyYWNrTGF5ZXIuZ2V0U291cmNlKCkuYWRkRmVhdHVyZShUUkFDSy5mZWF0dXJlKTtcclxuXHQgICAgICAgIC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0ICAgICAgICAvL3BvaW50ZXItZXZlbnRzIDogbm9uZTtcclxuICAgIFx0fVxyXG5cdFx0JCgnI2Z1bGxwYWdlJykuZnVsbHBhZ2Uoe1xyXG5cdFx0XHRjc3MzIDogZmFsc2UsXHJcblx0XHRcdG5hdmlnYXRpb24gOiB0cnVlLFxyXG5cdFx0XHRuYXZpZ2F0aW9uUG9zaXRpb24gOiAncmlnaHQnLFxyXG5cdFx0XHRuYXZpZ2F0aW9uVG9vbHRpcHMgOiB0dFxyXG5cdFx0fSk7XHJcbiAgIFx0IFx0JChcIi5mcmUsaDFcIikuY3NzKFwicG9pbnRlci1ldmVudHNcIixcIm5vbmVcIik7XHJcbiAgICAgICAgaWYoISAvQW5kcm9pZHx3ZWJPU3xpUGhvbmV8aVBhZHxpUG9kfEJsYWNrQmVycnl8SUVNb2JpbGV8T3BlcmEgTWluaS9pLnRlc3QobmF2aWdhdG9yLnVzZXJBZ2VudCkgKSB7XHJcbiAgICAgICB9IGVsc2Uge1xyXG4gICAgXHQgICAvLyBNT0JJTEUgICAgICBcdCAgIFxyXG4gICAgICAgfVxyXG5cdH0sXHJcblx0ZmFpbHVyZSA6IGZ1bmN0aW9uKGVyck1zZykge1xyXG5cdFx0Y29uc29sZS5lcnJvcihcIkVSUk9SIGdldCBkYXRhIGZyb20gYmFja2VuZCBcIiArIGVyck1zZylcclxuXHR9XHJcbn0pOyIsInJlcXVpcmUoJ2pvb3NlJyk7XHJcbnJlcXVpcmUoJy4vVXRpbHMnKTtcclxuXHJcbkNsYXNzKFwiTGl2ZVN0cmVhbVwiLCB7XHJcbiAgICBoYXMgOiB7XHJcbiAgICAgICAgXyRjb21wIDoge1xyXG4gICAgICAgICAgICBpbml0OiBmdW5jdGlvbihjb25maWcpIHtcclxuICAgICAgICAgICAgICAgIHJldHVybiAkKCcjJyArIGNvbmZpZy5pZCk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9LFxyXG5cclxuICAgICAgICBfaXNTaG93biA6IHtcclxuICAgICAgICAgICBpbml0IDogZmFsc2VcclxuICAgICAgICB9LFxyXG5cclxuICAgICAgICBfaXNWYWxpZCA6IHtcclxuICAgICAgICAgICAgaW5pdCA6IGZhbHNlXHJcbiAgICAgICAgfVxyXG4gICAgfSxcclxuICAgIG1ldGhvZHM6IHtcclxuICAgICAgICBpbml0aWFsaXplOiBmdW5jdGlvbigpIHtcclxuICAgICAgICAgICAgdmFyIGxpdmVTdHJlYW1zID0gd2luZG93LkxJVkVfU1RSRUFNUztcclxuICAgICAgICAgICAgaWYgKCFsaXZlU3RyZWFtcyB8fCBsaXZlU3RyZWFtcy5sZW5ndGggPD0gMCkge1xyXG4gICAgICAgICAgICAgICAgY29uc29sZS53YXJuKFwiTm8gbGl2ZSBzdHJlYW1zIHNldFwiKTtcclxuICAgICAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgLy8gaW5pdGlhbGl6ZSB0aGUgc3RyZWFtc1xyXG4gICAgICAgICAgICB2YXIgc2VsZiA9IHRoaXM7XHJcbiAgICAgICAgICAgIHZhciBpID0gMDtcclxuICAgICAgICAgICAgdGhpcy5fJGNvbXAuZmluZChcIi5saXZlU3RyZWFtVGh1bWJcIikuYWRkQ2xhc3MoXCJpbmFjdGl2ZVwiKS5lYWNoKGZ1bmN0aW9uKCkge1xyXG4gICAgICAgICAgICAgICAgdmFyIHN0cmVhbSA9IGxpdmVTdHJlYW1zW2ldO1xyXG4gICAgICAgICAgICAgICAgaSsrO1xyXG4gICAgICAgICAgICAgICAgaWYgKCFzdHJlYW0pIHtcclxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gZmFsc2U7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAkKHRoaXMpLmFkZENsYXNzKFwidmFsaWRcIikuZGF0YShcImlkXCIsIHN0cmVhbS5pZCkuZGF0YShcInVybFwiLCBzdHJlYW0udXJsKTtcclxuXHJcbiAgICAgICAgICAgICAgICAvLyBhdCBsZWFzdCBvbmUgdmFsaWQgdGh1bWIgLSBzbyB0aGUgd2hvbGUgTGl2ZVN0cmVhbSBpcyB2YWxpZFxyXG4gICAgICAgICAgICAgICAgc2VsZi5faXNWYWxpZCA9IHRydWU7XHJcbiAgICAgICAgICAgIH0pLmZpbHRlcihcIi52YWxpZFwiKS5jbGljayhmdW5jdGlvbigpIHtcclxuICAgICAgICAgICAgICAgIHZhciAkdGhpcyA9ICQodGhpcyk7XHJcblxyXG4gICAgICAgICAgICAgICAgLy8gaWYgY2xpY2tlZCBvbiB0aGUgc2FtZSBhY3RpdmUgdGh1bWIgdGhlbiBza2lwIGl0XHJcbiAgICAgICAgICAgICAgICBpZiAoISR0aGlzLmhhc0NsYXNzKFwiaW5hY3RpdmVcIikpIHtcclxuICAgICAgICAgICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICAgICBzZWxmLl9zaG93U3RyZWFtKCR0aGlzKTtcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgfSxcclxuXHJcbiAgICAgICAgc2hvdzogZnVuY3Rpb24oc3RyZWFtSWQsIGNvbXBsZXRlQ2FsbGJhY2spIHtcclxuICAgICAgICAgICAgaWYgKCF0aGlzLl9pc1ZhbGlkKVxyXG4gICAgICAgICAgICAgICByZXR1cm47XHJcblxyXG4gICAgICAgICAgICB2YXIgJHRodW1iID0gbnVsbDtcclxuICAgICAgICAgICAgdmFyICR0aHVtYnMgPSB0aGlzLl8kY29tcC5maW5kKFwiLmxpdmVTdHJlYW1UaHVtYi52YWxpZFwiKTtcclxuICAgICAgICAgICAgaWYgKCFpc0RlZmluZWQoc3RyZWFtSWQpKSB7XHJcbiAgICAgICAgICAgICAgICAkdGh1bWIgPSAkdGh1bWJzLmVxKDApO1xyXG4gICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgJHRodW1icy5lYWNoKGZ1bmN0aW9uKCkge1xyXG4gICAgICAgICAgICAgICAgICAgIGlmIChzdHJlYW1JZCA9PT0gJCh0aGlzKS5kYXRhKFwiaWRcIikpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgJHRodW1iID0gJCh0aGlzKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICBpZiAoISR0aHVtYikge1xyXG4gICAgICAgICAgICAgICAgY29uc29sZS53YXJuKFwiTm8gc3RyZWFtIGZvciBpZCA6IFwiICsgc3RyZWFtSWQpO1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICB0aGlzLl9zaG93U3RyZWFtKCR0aHVtYiwgY29tcGxldGVDYWxsYmFjayk7XHJcbiAgICAgICAgfSxcclxuXHJcbiAgICAgICAgLyoqXHJcbiAgICAgICAgICpcclxuICAgICAgICAgKiBAcmV0dXJuIHtib29sZWFufVxyXG4gICAgICAgICAqL1xyXG4gICAgICAgIHRvZ2dsZSA6IGZ1bmN0aW9uKGNvbXBsZXRlQ2FsbGJhY2spIHtcclxuICAgICAgICAgICAgaWYgKCF0aGlzLl9pc1ZhbGlkKVxyXG4gICAgICAgICAgICAgICAgcmV0dXJuO1xyXG5cclxuICAgICAgICAgICAgLy8gaWYgc2hvd24gaGlkZSBvdGhlcndpc2Ugc2hvd1xyXG4gICAgICAgICAgICBpZiAodGhpcy5faXNTaG93bilcclxuICAgICAgICAgICAgICAgIHRoaXMuX2hpZGUoY29tcGxldGVDYWxsYmFjayk7XHJcbiAgICAgICAgICAgIGVsc2VcclxuICAgICAgICAgICAgICAgIHRoaXMuc2hvdyhjb21wbGV0ZUNhbGxiYWNrKTtcclxuXHJcbiAgICAgICAgICAgIHJldHVybiB0aGlzLl9pc1Nob3duO1xyXG4gICAgICAgIH0sXHJcblxyXG4gICAgICAgIC8qIFByaXZhdGUgTWV0aG9kcyAqL1xyXG5cclxuICAgICAgICBfaGlkZSA6IGZ1bmN0aW9uKGNvbXBsZXRlQ2FsbGJhY2spIHtcclxuICAgICAgICAgICAgdmFyIHNlbGYgPSB0aGlzO1xyXG4gICAgICAgICAgICB0aGlzLl8kY29tcC5zbGlkZVVwKDQwMCwgZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgICAgICAgICAvLyBzdG9wIHRoZSBzdHJlYW0gd2hlbiB3aG9sZSBwYW5lbCBoYXMgY29tcGxldGVkIGFuaW1hdGlvblxyXG4gICAgICAgICAgICAgICAgc2VsZi5fJGNvbXAuZmluZChcIi5saXZlU3RyZWFtUGxheWVyXCIpLmVtcHR5KCk7XHJcbiAgICAgICAgICAgICAgICBjb21wbGV0ZUNhbGxiYWNrKCk7XHJcbiAgICAgICAgICAgIH0pO1xyXG5cclxuICAgICAgICAgICAgdGhpcy5faXNTaG93biA9IGZhbHNlO1xyXG4gICAgICAgIH0sXHJcblxyXG4gICAgICAgIF9zaG93U3RyZWFtIDogZnVuY3Rpb24oJHRodW1iLCBjb21wbGV0ZUNhbGxiYWNrKSB7XHJcbiAgICAgICAgICAgIC8vIHRvZ2dsZSB0aGUgXCJpbmFjdGl2ZVwiIGNsYXNzXHJcbiAgICAgICAgICAgIHRoaXMuXyRjb21wLmZpbmQoXCIubGl2ZVN0cmVhbVRodW1iXCIpLmFkZENsYXNzKFwiaW5hY3RpdmVcIik7XHJcbiAgICAgICAgICAgICR0aHVtYi5yZW1vdmVDbGFzcyhcImluYWN0aXZlXCIpO1xyXG5cclxuICAgICAgICAgICAgLy8gc2hvdyB0aGUgbmV3IHN0cmVhbVxyXG4gICAgICAgICAgICB2YXIgdXJsID0gJHRodW1iLmRhdGEoXCJ1cmxcIik7XHJcbiAgICAgICAgICAgIHZhciAkcGxheWVyID0gdGhpcy5fJGNvbXAuZmluZChcIi5saXZlU3RyZWFtUGxheWVyXCIpO1xyXG5cclxuICAgICAgICAgICAgLy8gd2lkdGg9NDkwJmhlaWdodD0yNzUmXHJcbiAgICAgICAgICAgIC8vIHdpZHRoPVwiNDkwXCIgaGVpZ2h0PVwiMjc1XCJcclxuICAgICAgICAgICAgJHBsYXllci5odG1sKCc8aWZyYW1lIHNyYz0nICsgdXJsICsgJz9hdXRvUGxheT10cnVlJm11dGU9ZmFsc2VcIiBmcmFtZWJvcmRlcj1cIjBcIiBzY3JvbGxpbmc9XCJub1wiICcrXHJcbiAgICAgICAgICAgICdhbGxvd2Z1bGxzY3JlZW4gd2Via2l0YWxsb3dmdWxsc2NyZWVuIG1vemFsbG93ZnVsbHNjcmVlbiBvYWxsb3dmdWxsc2NyZWVuIG1zYWxsb3dmdWxsc2NyZWVuPjwvaWZyYW1lPicpO1xyXG5cclxuICAgICAgICAgICAgLy8gc2hvdyBpZiBub3QgYWxyZWFkeSBzaG93blxyXG4gICAgICAgICAgICBpZiAoIXRoaXMuX2lzU2hvd24pXHJcbiAgICAgICAgICAgICAgICB0aGlzLl8kY29tcC5zbGlkZURvd24oNDAwLCBjb21wbGV0ZUNhbGxiYWNrKTtcclxuICAgICAgICAgICAgdGhpcy5faXNTaG93biA9IHRydWU7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG59KTsiLCJyZXF1aXJlKCdqb29zZScpO1xyXG5yZXF1aXJlKCcuL1BhcnRpY2lwYW50Jyk7XHJcblxyXG5DbGFzcyhcIk1vdmluZ0NhbVwiLCB7XHJcbiAgICBpc2EgOiBQYXJ0aWNpcGFudCxcclxuXHJcbiAgICBvdmVycmlkZSA6IHtcclxuICAgICAgICBpbml0RmVhdHVyZSA6IGZ1bmN0aW9uKCkge1xyXG4gICAgICAgICAgICB0aGlzLmZlYXR1cmUuY2FtPXRoaXM7XHJcbiAgICAgICAgICAgIEdVSS5jYW1zTGF5ZXIuZ2V0U291cmNlKCkuYWRkRmVhdHVyZSh0aGlzLmZlYXR1cmUpO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxufSk7IiwicmVxdWlyZSgnam9vc2UnKTtcclxucmVxdWlyZSgnLi9Qb2ludCcpO1xyXG52YXIgUkJUcmVlID0gcmVxdWlyZSgnYmludHJlZXMnKS5SQlRyZWU7XHJcbnZhciBDT05GSUcgPSByZXF1aXJlKCcuL0NvbmZpZycpO1xyXG52YXIgVXRpbHMgPSByZXF1aXJlKCcuL1V0aWxzJyk7XHJcbnZhciBJbnRlcnNlY3Rpb24gPSByZXF1aXJlKFwia2xkLWludGVyc2VjdGlvbnNcIikuSW50ZXJzZWN0aW9uO1xyXG52YXIgUG9pbnQyRCA9IHJlcXVpcmUoXCJrbGQtaW50ZXJzZWN0aW9uc1wiKS5Qb2ludDJEO1xyXG5cclxudmFyIGNvZWZ5ID0gQ09ORklHLm1hdGgucHJvamVjdGlvblNjYWxlWTtcclxuQ2xhc3MoXCJQYXJ0aWNpcGFudFN0YXRlXCIsXHJcbntcclxuXHRoYXMgOiB7XHRcdFxyXG4gICAgXHRkZWJ1Z0luZm8gOiB7XHJcbiAgICBcdFx0aXMgOiBcInJ3XCIsXHJcbiAgICBcdFx0aW5pdCA6IG51bGxcclxuICAgIFx0fSxcclxuXHRcdHNwZWVkIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IDBcclxuXHRcdH0sXHJcblx0XHRlbGFwc2VkIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IDBcclxuXHRcdH0sXHJcblx0ICAgIHRpbWVzdGFtcCA6IFxyXG5cdFx0e1xyXG5cdCAgICAgICAgaXM6ICAgXCJyd1wiLFxyXG5cdCAgICAgICAgaW5pdDogMFx0Ly9sb24gbGF0IHdvcmxkIG1lcmNhdG9yXHJcblx0ICAgIH0sXHJcblx0ICAgIGdwcyA6IHtcclxuXHQgICAgXHRpczogICBcInJ3XCIsXHJcblx0ICAgICAgICBpbml0OiBbMCwwXVx0Ly9sb24gbGF0IHdvcmxkIG1lcmNhdG9yXHJcblx0ICAgIH0sXHJcblx0XHRmcmVxIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IDBcclxuXHRcdH0sXHJcblx0XHRpc1NPUyA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiBmYWxzZVxyXG5cdFx0fSxcclxuXHRcdGlzRGlzY2FyZGVkIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IGZhbHNlXHJcblx0XHR9LFxyXG5cdFx0YWNjZWxlcmF0aW9uIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IDBcclxuXHRcdH0sXHJcblx0XHRhbHQgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogMFxyXG5cdFx0fSxcclxuXHRcdG92ZXJhbGxSYW5rIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IDBcclxuXHRcdH0sXHJcblx0XHRnZW5kZXJSYW5rIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IDBcclxuXHRcdH0sXHJcblx0XHRncm91cFJhbmsgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogMFxyXG5cdFx0fVxyXG5cdH1cclxufSk7XHRcdFxyXG4vLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuQ2xhc3MoXCJNb3ZpbmdQb2ludFwiLCB7XHJcblx0aXNhIDogUG9pbnQsXHJcblxyXG5cdGhhcyA6IHtcclxuXHRcdGRldmljZUlkIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IFwiREVWSUNFX0lEX05PVF9TRVRcIlxyXG5cdFx0fVxyXG5cdH1cclxufSk7XHJcbi8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5DbGFzcyhcIlBhcnRpY2lwYW50XCIsXHJcbntcclxuXHRpc2EgOiBNb3ZpbmdQb2ludCxcclxuXHJcbiAgICBoYXM6IFxyXG5cdHtcdFxyXG4gICAgXHRsYXN0UGluZ1RpbWVzdGFtcCA6IHtcclxuICAgIFx0XHRpcyA6IFwicndcIixcclxuICAgIFx0XHRpbml0IDogbnVsbFxyXG4gICAgXHR9LFxyXG4gICAgXHRzaWduYWxMb3N0RGVsYXkgOiB7XHJcbiAgICBcdFx0aXMgOiBcInJ3XCIsXHJcbiAgICBcdFx0aW5pdCA6IG51bGxcclxuICAgIFx0fSxcclxuICAgIFx0bGFzdFJlYWxEZWxheSA6IHtcclxuICAgIFx0XHRpcyA6IFwicndcIixcclxuICAgIFx0XHRpbml0IDogMFxyXG4gICAgXHR9LFxyXG4gICAgXHR0cmFjayA6IHtcclxuICAgIFx0XHRpcyA6IFwicndcIlxyXG4gICAgXHR9LFxyXG4gICAgXHRzdGF0ZXMgOiB7XHJcbiAgICBcdFx0aXMgOiBcInJ3XCIsXHJcbiAgICBcdFx0aW5pdCA6IG5ldyBSQlRyZWUoZnVuY3Rpb24oYSwgYikgeyByZXR1cm4gYS50aW1lc3RhbXAgLSBiLnRpbWVzdGFtcDsgfSlcclxuICAgIFx0XHRcclxuICAgIFx0fSxcclxuXHRcdGlzVGltZWRPdXQgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogZmFsc2VcclxuXHRcdH0sXHJcblx0XHRpc0Rpc2NhcmRlZCA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiBmYWxzZVxyXG5cdFx0fSxcclxuXHRcdGlzU09TIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IGZhbHNlXHJcblx0XHR9LFxyXG5cdFx0aWNvbjoge1xyXG5cdFx0XHRpczogXCJyd1wiLFxyXG5cdCAgICAgICAgaW5pdDogXCJpbWcvcGxheWVyMS5wbmdcIlxyXG5cdCAgICB9LFxyXG5cdCAgICBpbWFnZSA6XHR7XHJcblx0ICAgICAgICBpczogICBcInJ3XCIsXHJcblx0ICAgICAgICBpbml0OiBcImltZy9wcm9maWxlMS5wbmdcIiAgLy8xMDB4MTAwXHJcblx0ICAgIH0sXHJcblx0ICAgIGNvbG9yIDoge1xyXG5cdCAgICAgICAgaXM6ICAgXCJyd1wiLFxyXG5cdCAgICAgICAgaW5pdDogXCIjZmZmXCJcclxuXHQgICAgfSxcclxuXHQgICAgYWdlR3JvdXAgOiB7XHJcblx0ICAgIFx0aXMgOiBcInJ3XCIsXHJcblx0ICAgIFx0aW5pdCA6IFwiLVwiXHJcblx0ICAgIH0sXHJcblx0ICAgIGFnZSA6IHtcclxuXHQgICAgXHRpcyA6IFwicndcIixcclxuXHQgICAgXHRpbml0IDogXCItXCJcclxuXHQgICAgfSxcclxuXHQgICAgcm90YXRpb24gOiB7XHJcblx0ICAgIFx0aXMgOiBcInJ3XCIsXHJcblx0ICAgIFx0aW5pdCA6IG51bGwgXHJcblx0ICAgIH0sIFxyXG5cdCAgICBlbGFwc2VkIDoge1xyXG5cdCAgICBcdGlzIDogXCJyd1wiLFxyXG5cdCAgICBcdGluaXQgOiAwXHJcblx0ICAgIH0sXHJcblx0XHRzZXFJZCA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiAwXHJcblx0XHR9LFxyXG5cdFx0Y291bnRyeSA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiBcIkdlcm1hbnlcIlxyXG5cdFx0fSxcclxuXHRcdHN0YXJ0UG9zIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IDBcclxuXHRcdH0sXHJcblx0XHRzdGFydFRpbWUgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogMFxyXG5cdFx0fSxcclxuXHRcdGdlbmRlciA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiBcIk1cIlxyXG5cdFx0fSxcclxuXHRcdGlzRmF2b3JpdGUgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogZmFsc2VcclxuXHRcdH1cclxuICAgIH0sXHJcblx0YWZ0ZXIgOiB7XHJcblx0XHRpbml0IDogZnVuY3Rpb24ocG9zLCB0cmFjaykge1xyXG5cdFx0XHR0aGlzLnNldFRyYWNrKHRyYWNrKTtcclxuXHRcdFx0dmFyIGN0aW1lID0gKG5ldyBEYXRlKCkpLmdldFRpbWUoKTtcclxuXHRcdFx0dmFyIHN0YXRlID0gbmV3IFBhcnRpY2lwYW50U3RhdGUoe3RpbWVzdGFtcDoxLyogcGxhY2Vob2xkZXIgY3RpbWUgbm90IDAgKi8sZ3BzOnBvcyxpc1NPUzpmYWxzZSxpc0Rpc2NhcmRlZDpmYWxzZSxmcmVxOjAsc3BlZWQ6MCxlbGFwc2VkOjB9KTtcclxuXHRcdFx0dGhpcy5zZXRFbGFwc2VkKHN0YXRlLmVsYXBzZWQpO1xyXG5cdFx0XHR0aGlzLnNldFN0YXRlcyhuZXcgUkJUcmVlKGZ1bmN0aW9uKGEsIGIpIHsgcmV0dXJuIGEudGltZXN0YW1wIC0gYi50aW1lc3RhbXA7IH0pKTtcclxuXHRcdFx0dGhpcy5zdGF0ZXMuaW5zZXJ0KHN0YXRlKTtcclxuXHRcdFx0dGhpcy5zZXRJc1NPUyhmYWxzZSk7XHJcblx0XHRcdHRoaXMuc2V0SXNEaXNjYXJkZWQoZmFsc2UpO1xyXG5cdFx0XHRpZiAodGhpcy5mZWF0dXJlKSB7XHJcblx0XHRcdFx0dGhpcy5pbml0RmVhdHVyZSgpO1xyXG5cdFx0XHR9XHJcblx0XHRcdHRoaXMucGluZ0NhbGN1bGF0ZWQoc3RhdGUpO1xyXG5cdFx0fVxyXG5cdH0sXHJcbiAgICAvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0bWV0aG9kczogXHJcblx0e1xyXG5cdFx0aW5pdEZlYXR1cmUgOiBmdW5jdGlvbigpIHtcclxuXHRcdFx0dGhpcy5mZWF0dXJlLnBhcnRpY2lwYW50PXRoaXM7XHJcblx0XHRcdEdVSS5wYXJ0aWNpcGFudHNMYXllci5nZXRTb3VyY2UoKS5hZGRGZWF0dXJlKHRoaXMuZmVhdHVyZSk7XHJcblx0XHR9LFxyXG5cclxuXHRcdGdldEluaXRpYWxzIDogZnVuY3Rpb24oKSB7XHJcblx0XHRcdHZhciB0dCA9IHRoaXMuZ2V0Q29kZSgpLnNwbGl0KFwiIFwiKTtcclxuXHRcdFx0aWYgKHR0Lmxlbmd0aCA+PSAyKSB7XHJcblx0XHRcdFx0cmV0dXJuIHR0WzBdWzBdK3R0WzFdWzBdO1xyXG5cdFx0XHR9XHJcblx0XHRcdGlmICh0dC5sZW5ndGggPT0gMSlcclxuXHRcdFx0XHRyZXR1cm4gdHRbMF1bMF07XHJcblx0XHRcdHJldHVybiBcIj9cIjtcclxuXHRcdH0sXHJcblx0XHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRcdC8vIG1haW4gZnVuY3Rpb24gY2FsbCA+IFxyXG5cdFx0Ly8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0XHR1cGRhdGVGZWF0dXJlIDogZnVuY3Rpb24oKSB7XHJcblx0XHRcdHZhciBtcG9zID0gb2wucHJvai50cmFuc2Zvcm0odGhpcy5nZXRQb3NpdGlvbigpLCAnRVBTRzo0MzI2JywgJ0VQU0c6Mzg1NycpO1xyXG5cdFx0XHRpZiAodGhpcy5mZWF0dXJlKSBcclxuXHRcdFx0XHR0aGlzLmZlYXR1cmUuc2V0R2VvbWV0cnkobmV3IG9sLmdlb20uUG9pbnQobXBvcykpO1xyXG5cdFx0fSxcclxuXHJcblx0XHRpbnRlcnBvbGF0ZSA6IGZ1bmN0aW9uKGN0aW1lKSBcclxuXHRcdHtcclxuXHRcdFx0dGhpcy5fX2N0aW1lPWN0aW1lO1xyXG5cdFx0XHRpZiAoIXRoaXMuc3RhdGVzLnNpemUpXHJcblx0XHRcdFx0cmV0dXJuO1x0XHRcclxuXHRcdFx0aWYgKHRoaXMuc3RhdGVzLnNpemUgPCAyKVxyXG5cdFx0XHRcdHJldHVybjtcclxuXHRcdFx0dmFyIHJlcyA9IHRoaXMuY2FsY3VsYXRlRWxhcHNlZEF2ZXJhZ2UoY3RpbWUpO1xyXG5cdFx0XHRpZiAocmVzICE9IG51bGwpIFxyXG5cdFx0XHR7XHJcblx0XHRcdFx0dmFyIHRyZXM9cmVzO1xyXG5cdFx0XHRcdGlmICh0cmVzID09IHRoaXMudHJhY2subGFwcylcclxuXHRcdFx0XHRcdHRyZXM9MS4wO1xyXG5cdFx0XHRcdGVsc2VcclxuXHRcdFx0XHRcdHRyZXM9dHJlcyUxO1xyXG5cdFx0XHRcdHZhciB0a2EgPSB0aGlzLnRyYWNrLmdldFBvc2l0aW9uQW5kUm90YXRpb25Gcm9tRWxhcHNlZCh0cmVzKTtcclxuXHRcdFx0XHR0aGlzLnNldFBvc2l0aW9uKFt0a2FbMF0sdGthWzFdXSk7XHJcblx0XHRcdFx0dGhpcy5zZXRSb3RhdGlvbih0a2FbMl0pO1xyXG5cdFx0XHRcdHRoaXMudXBkYXRlRmVhdHVyZSgpO1xyXG5cdFx0XHRcdHRoaXMuc2V0RWxhcHNlZChyZXMpO1xyXG5cdFx0XHR9IFxyXG5cdFx0fSxcclxuXHJcblx0XHRtaW4gOiBmdW5jdGlvbihjdGltZSxwcm9OYW1lKSBcclxuXHRcdHtcclxuXHRcdFx0dmFyIGl0ID0gdGhpcy5zdGF0ZXMubG93ZXJCb3VuZCh7dGltZXN0YW1wOmN0aW1lfSk7XHJcblx0XHRcdHZhciBzYiA9IGl0LmRhdGEoKTtcclxuXHRcdFx0aWYgKCFzYilcclxuXHRcdFx0XHRyZXR1cm4gbnVsbDtcclxuXHRcdFx0aWYgKHNiLnRpbWVzdGFtcCA9PSBjdGltZSlcclxuXHRcdFx0XHRyZXR1cm4gc2JbcHJvTmFtZV07XHJcblx0XHRcdHZhciBzYSA9IGl0LnByZXYoKTtcclxuXHRcdFx0aWYgKHNhKSB7XHJcblx0XHRcdFx0cmV0dXJuIHNhW3Byb05hbWVdO1xyXG5cdFx0XHR9XHJcblx0XHRcdHJldHVybiBudWxsO1xyXG5cdFx0fSxcclxuXHRcdFxyXG5cdFx0bWF4IDogZnVuY3Rpb24oY3RpbWUscHJvTmFtZSkgXHJcblx0XHR7XHJcblx0XHRcdHZhciBpdCA9IHRoaXMuc3RhdGVzLmxvd2VyQm91bmQoe3RpbWVzdGFtcDpjdGltZX0pO1xyXG5cdFx0XHR2YXIgc2EgPSBpdC5kYXRhKCk7XHJcblx0XHRcdGlmICghc2EpXHJcblx0XHRcdFx0cmV0dXJuIG51bGw7XHJcblx0XHRcdHJldHVybiBzYVtwcm9OYW1lXTtcclxuXHRcdH0sXHJcblxyXG5cdFx0YXZnMiA6IGZ1bmN0aW9uKGN0aW1lLHByb05hbWUpIFxyXG5cdFx0e1xyXG5cclxuXHRcdFx0dmFyIGl0ID0gdGhpcy5zdGF0ZXMubG93ZXJCb3VuZCh7dGltZXN0YW1wOmN0aW1lfSk7XHJcblx0XHRcdHZhciBzYiA9IGl0LmRhdGEoKTtcclxuXHRcdFx0aWYgKHNiKSB7XHJcblx0XHRcdFx0aWYgKHNiLnRpbWVzdGFtcCA9PSBjdGltZSlcclxuXHRcdFx0XHRcdHJldHVybiBzYltwcm9OYW1lXTtcclxuXHRcdFx0XHQvLyBzYiA+PSBcclxuXHRcdFx0XHR2YXIgc2EgPSBpdC5wcmV2KCk7XHJcblx0XHRcdFx0aWYgKHNhKSBcclxuXHRcdFx0XHR7IFxyXG5cdFx0XHRcdFx0cmV0dXJuIFtcclxuXHRcdFx0XHRcdCAgICAgICBcdHNhW3Byb05hbWVdWzBdKyhjdGltZS1zYS50aW1lc3RhbXApICogKHNiW3Byb05hbWVdWzBdLXNhW3Byb05hbWVdWzBdKSAvIChzYi50aW1lc3RhbXAtc2EudGltZXN0YW1wKSxcclxuXHRcdFx0XHRcdCAgICAgICBcdHNhW3Byb05hbWVdWzFdKyhjdGltZS1zYS50aW1lc3RhbXApICogKHNiW3Byb05hbWVdWzFdLXNhW3Byb05hbWVdWzFdKSAvIChzYi50aW1lc3RhbXAtc2EudGltZXN0YW1wKVxyXG5cdFx0XHRcdCAgICAgICAgICBdOyBcclxuXHRcdFx0XHR9XHJcblx0XHRcdH1cclxuXHRcdFx0cmV0dXJuIG51bGw7XHJcblx0XHR9LFxyXG5cclxuXHRcdGF2ZyA6IGZ1bmN0aW9uKGN0aW1lLHByb05hbWUpIFxyXG5cdFx0e1xyXG5cdFx0XHR2YXIgaXQgPSB0aGlzLnN0YXRlcy5sb3dlckJvdW5kKHt0aW1lc3RhbXA6Y3RpbWV9KTtcclxuXHRcdFx0dmFyIHNiID0gaXQuZGF0YSgpO1xyXG5cdFx0XHRpZiAoc2IpIHtcclxuXHRcdFx0XHRpZiAoc2IudGltZXN0YW1wID09IGN0aW1lKVxyXG5cdFx0XHRcdFx0cmV0dXJuIHNiW3Byb05hbWVdO1xyXG5cdFx0XHRcdC8vIHNiID49IFxyXG5cdFx0XHRcdHZhciBzYSA9IGl0LnByZXYoKTtcclxuXHRcdFx0XHRpZiAoc2EpIFxyXG5cdFx0XHRcdHsgXHJcblx0XHRcdFx0XHRyZXR1cm4gc2FbcHJvTmFtZV0rKGN0aW1lLXNhLnRpbWVzdGFtcCkgKiAoc2JbcHJvTmFtZV0tc2FbcHJvTmFtZV0pIC8gKHNiLnRpbWVzdGFtcC1zYS50aW1lc3RhbXApO1xyXG5cdFx0XHRcdH1cclxuXHRcdFx0fVxyXG5cdFx0XHRyZXR1cm4gbnVsbDtcclxuXHRcdH0sXHJcblxyXG5cdFx0Y2FsY3VsYXRlRWxhcHNlZEF2ZXJhZ2UgOiBmdW5jdGlvbihjdGltZSkgXHJcblx0XHR7XHJcblx0XHRcdHZhciByZXM9bnVsbDtcclxuXHRcdFx0dmFyIG9rID0gZmFsc2U7XHJcblx0XHRcdHZhciBpdCA9IHRoaXMuc3RhdGVzLmxvd2VyQm91bmQoe3RpbWVzdGFtcDpjdGltZX0pO1xyXG5cdFx0XHR2YXIgc2IgPSBpdC5kYXRhKCk7XHJcblx0XHRcdGlmIChzYikge1xyXG5cdFx0XHRcdGlmIChzYi50aW1lc3RhbXAgPT0gY3RpbWUpIHtcclxuXHRcdFx0XHRcdG9rPXRydWU7XHJcblx0XHRcdFx0XHRyZXM9c2IuZWxhcHNlZDtcclxuXHRcdFx0XHR9IGVsc2Uge1xyXG5cdFx0XHRcdFx0dmFyIHNhID0gaXQucHJldigpO1xyXG5cdFx0XHRcdFx0aWYgKHNhKSBcclxuXHRcdFx0XHRcdHsgXHJcblx0XHRcdFx0XHRcdHJlcyA9IHNhLmVsYXBzZWQrKGN0aW1lLXNhLnRpbWVzdGFtcCkgKiAoc2IuZWxhcHNlZC1zYS5lbGFwc2VkKSAvIChzYi50aW1lc3RhbXAtc2EudGltZXN0YW1wKTtcclxuXHRcdFx0XHRcdFx0Ly9jb25zb2xlLmxvZyhcIkZPVU5EIFRJTUUgSU5UIFtcIitVdGlscy5mb3JtYXREYXRlVGltZVNlYyhuZXcgRGF0ZShzYS50aW1lc3RhbXApKStcIiA+IFwiK1V0aWxzLmZvcm1hdERhdGVUaW1lU2VjKG5ldyBEYXRlKHNiLnRpbWVzdGFtcCkpK1wiXVwiKTtcclxuXHRcdFx0XHRcdFx0b2s9dHJ1ZTtcclxuXHRcdFx0XHRcdH1cclxuXHRcdFx0XHR9XHJcblx0XHRcdH1cclxuXHRcdFx0aWYgKCFvaykge1xyXG5cdFx0XHRcdGlmICh0aGlzLnN0YXRlcy5zaXplID49IDIpXHJcblx0XHRcdFx0XHRjb25zb2xlLmxvZyh0aGlzLmNvZGUrXCIgfCBOT1QgRk9VTkQgVElNRSBcIitVdGlscy5mb3JtYXREYXRlVGltZVNlYyhuZXcgRGF0ZShjdGltZSkpKTtcclxuXHRcdFx0fSBlbHNlXHJcblx0XHRcdFx0dGhpcy5zZXRTaWduYWxMb3N0RGVsYXkobnVsbCk7XHJcblx0XHRcdHJldHVybiByZXM7XHJcblx0XHR9LFxyXG5cdFx0XHJcblx0XHRwaW5nQ2FsY3VsYXRlZCA6IGZ1bmN0aW9uKG9iaikge1xyXG5cdFx0XHRpZiAob2JqLmRpc2NhcmRlZCkge1xyXG5cdFx0XHRcdGRlbGV0ZSBvYmouZGlzY2FyZGVkO1xyXG5cdFx0XHRcdHRoaXMuc2V0SXNEaXNjYXJkZWQodHJ1ZSk7XHRcdFx0XHJcblx0XHRcdH1cclxuXHRcdFx0dmFyIHN0YXRlID0gbmV3IFBhcnRpY2lwYW50U3RhdGUob2JqKTtcclxuXHRcdFx0dGhpcy5hZGRTdGF0ZShzdGF0ZSk7XHJcblx0XHRcdHZhciBwb3MgPSBzdGF0ZS5ncHM7XHJcblx0XHRcdHZhciBjb2VmID0gdGhpcy50cmFjay5nZXRUcmFja0xlbmd0aEluV0dTODQoKS90aGlzLnRyYWNrLmdldFRyYWNrTGVuZ3RoKCk7XHJcblx0XHRcdHZhciByciA9IENPTkZJRy5tYXRoLmdwc0luYWNjdXJhY3kqY29lZjtcclxuXHRcdFx0aWYgKHR5cGVvZiBHVUkgIT0gXCJ1bmRlZmluZWRcIiAmJiBHVUkuaXNEZWJ1ZykgXHJcblx0XHRcdHtcclxuXHRcdFx0XHR2YXIgcmluZyA9IFtcclxuXHRcdFx0XHQgICAgICAgICAgICBbcG9zWzBdLXJyLCBwb3NbMV0tcnIqY29lZnldLCBbcG9zWzBdK3JyLCBwb3NbMV0tcnIqY29lZnldLFtwb3NbMF0rcnIsIHBvc1sxXStycipjb2VmeV0sW3Bvc1swXS1yciwgcG9zWzFdK3JyKmNvZWZ5XSxbcG9zWzBdLXJyLCBwb3NbMV0tcnIqY29lZnldXHJcblx0IFx0XHRcdF07XHJcblx0XHRcdFx0dmFyIHBvbHlnb24gPSBuZXcgb2wuZ2VvbS5Qb2x5Z29uKFtyaW5nXSk7XHJcblx0XHRcdFx0cG9seWdvbi50cmFuc2Zvcm0oJ0VQU0c6NDMyNicsICdFUFNHOjM4NTcnKTtcclxuXHRcdFx0XHR2YXIgZmVhdHVyZSA9IG5ldyBvbC5GZWF0dXJlKHBvbHlnb24pO1xyXG5cdFx0XHRcdEdVSS50ZXN0TGF5ZXIxLmdldFNvdXJjZSgpLmFkZEZlYXR1cmUoZmVhdHVyZSk7XHJcblxyXG5cdFx0XHRcdHZhciBtcG9zID0gb2wucHJvai50cmFuc2Zvcm0ocG9zLCAnRVBTRzo0MzI2JywgJ0VQU0c6Mzg1NycpO1xyXG5cdFx0XHRcdHZhciBmZWF0dXJlID0gbmV3IG9sLkZlYXR1cmUobmV3IG9sLmdlb20uUG9pbnQobXBvcykpO1xyXG5cdFx0XHRcdEdVSS50ZXN0TGF5ZXIuZ2V0U291cmNlKCkuYWRkRmVhdHVyZShmZWF0dXJlKTtcclxuXHRcdFx0XHQvL2NvbnNvbGUubG9nKHRoaXMuZ2V0Q29kZSgpK1wiIHwgXCIrTWF0aC5yb3VuZChzdGF0ZS5lbGFwc2VkKjEwMC4wKjEwMC4wKS8xMDAuMCtcIiUgUE9ORyBbXCIrcG9zWzBdK1wiLFwiK3Bvc1sxXStcIl0gXCIrbmV3IERhdGUoc3RhdGUudGltZXN0YW1wKStcIiB8IFwiK3N0YXRlLmRlYnVnSW5mbyk7XHJcblx0XHRcdFx0Ly8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0XHRcdFx0aWYgKHN0YXRlLmRlYnVnSW5mbyAmJiBzdGF0ZS5kZWJ1Z0luZm8ucG9pbnQgJiYgc3RhdGUuZGVidWdJbmZvLmJlc3QpIFxyXG5cdFx0XHRcdHtcclxuXHRcdFx0XHRcdHZhciBtcG9zID0gb2wucHJvai50cmFuc2Zvcm0oc3RhdGUuZGVidWdJbmZvLnBvaW50LCAnRVBTRzo0MzI2JywgJ0VQU0c6Mzg1NycpO1xyXG5cdFx0XHRcdFx0dmFyIGZlYXR1cmUgPSBuZXcgb2wuRmVhdHVyZShuZXcgb2wuZ2VvbS5Qb2ludChtcG9zKSk7XHJcblx0XHRcdFx0XHRpZiAodGhpcy5fX29sZEZlYXR1cmUxKVxyXG5cdFx0XHRcdFx0XHRHVUkudGVzdExheWVyMi5nZXRTb3VyY2UoKS5yZW1vdmVGZWF0dXJlKHRoaXMuX19vbGRGZWF0dXJlMSk7XHJcblx0XHRcdFx0XHRHVUkudGVzdExheWVyMi5nZXRTb3VyY2UoKS5hZGRGZWF0dXJlKGZlYXR1cmUpO1xyXG5cdFx0XHRcdFx0ZmVhdHVyZS5kZWJ1Z0luZm89c3RhdGUuZGVidWdJbmZvO1xyXG5cdFx0XHRcdFx0dGhpcy5fX29sZEZlYXR1cmUxPWZlYXR1cmU7XHJcblxyXG5cdFx0XHRcdFx0dmFyIHAxID0gdGhpcy50cmFjay5yb3V0ZVtzdGF0ZS5kZWJ1Z0luZm8uYmVzdF07XHJcblx0XHRcdFx0XHR2YXIgcDIgPSB0aGlzLnRyYWNrLnJvdXRlW3N0YXRlLmRlYnVnSW5mby5iZXN0KzFdO1xyXG5cdFx0XHRcdFx0dmFyIGxpbmUgPSBuZXcgb2wuZ2VvbS5MaW5lU3RyaW5nKFsgcDEscDIgXSk7XHJcblx0XHRcdFx0XHRsaW5lLnRyYW5zZm9ybSgnRVBTRzo0MzI2JywgJ0VQU0c6Mzg1NycpO1xyXG5cdFx0XHRcdFx0XHJcblx0XHRcdFx0XHRpZiAodGhpcy5fX29sZEZlYXR1cmUyKVxyXG5cdFx0XHRcdFx0XHRHVUkudGVzdExheWVyMi5nZXRTb3VyY2UoKS5yZW1vdmVGZWF0dXJlKHRoaXMuX19vbGRGZWF0dXJlMik7XHJcblx0XHRcdFx0XHR2YXIgZmVhdHVyZSA9IG5ldyBvbC5GZWF0dXJlKGxpbmUpO1xyXG5cdFx0XHRcdFx0ZmVhdHVyZS5kZWJ1Z0luZm89c3RhdGUuZGVidWdJbmZvO1xyXG5cdFx0XHRcdFx0R1VJLnRlc3RMYXllcjIuZ2V0U291cmNlKCkuYWRkRmVhdHVyZShmZWF0dXJlKTtcclxuXHRcdFx0XHRcdHRoaXMuX19vbGRGZWF0dXJlMj1mZWF0dXJlO1xyXG5cdFx0XHRcdH1cclxuXHRcdFx0XHR3aGlsZSAoR1VJLnRlc3RMYXllcjEuZ2V0U291cmNlKCkuZ2V0RmVhdHVyZXMoKS5sZW5ndGggPiAxMDApXHJcblx0XHRcdFx0XHRHVUkudGVzdExheWVyMS5nZXRTb3VyY2UoKS5yZW1vdmVGZWF0dXJlKEdVSS50ZXN0TGF5ZXIxLmdldFNvdXJjZSgpLmdldEZlYXR1cmVzKClbMF0pO1xyXG5cdFx0XHRcdHdoaWxlIChHVUkudGVzdExheWVyLmdldFNvdXJjZSgpLmdldEZlYXR1cmVzKCkubGVuZ3RoID4gMTAwKVxyXG5cdFx0XHRcdFx0R1VJLnRlc3RMYXllci5nZXRTb3VyY2UoKS5yZW1vdmVGZWF0dXJlKEdVSS50ZXN0TGF5ZXIuZ2V0U291cmNlKCkuZ2V0RmVhdHVyZXMoKVswXSk7XHJcblx0XHRcdH0gXHJcblxyXG5cdFx0fSxcclxuXHJcblx0XHRnZXRPdmVyYWxsUmFuayA6IGZ1bmN0aW9uKGN0aW1lKSB7XHJcblx0XHRcdHZhciB2ID0gdGhpcy5tYXgoY3RpbWUsXCJvdmVyYWxsUmFua1wiKTtcclxuXHRcdFx0aWYgKHYpXHJcblx0XHRcdFx0cmV0dXJuIHY7XHJcblx0XHRcdHJldHVybiBcIi1cIjtcclxuXHRcdH0sXHJcblx0XHRnZXRHcm91cFJhbmsgOiBmdW5jdGlvbihjdGltZSkge1xyXG5cdFx0XHR2YXIgdiA9IHRoaXMubWF4KGN0aW1lLFwiZ3JvdXBSYW5rXCIpO1xyXG5cdFx0XHRpZiAodilcclxuXHRcdFx0XHRyZXR1cm4gdjtcclxuXHRcdFx0cmV0dXJuIFwiLVwiO1xyXG5cdFx0fSxcclxuXHRcdGdldEdlbmRlclJhbmsgOiBmdW5jdGlvbihjdGltZSkge1xyXG5cdFx0XHR2YXIgdiA9IHRoaXMubWF4KGN0aW1lLFwiZ2VuZGVyUmFua1wiKTtcclxuXHRcdFx0aWYgKHYpXHJcblx0XHRcdFx0cmV0dXJuIHY7XHJcblx0XHRcdHJldHVybiBcIi1cIjtcclxuXHRcdH0sXHJcblx0XHRcclxuXHRcdHBpbmcgOiBmdW5jdGlvbihwb3MsZnJlcSxpc1NPUyxjdGltZSxhbHQsb3ZlcmFsbFJhbmssZ3JvdXBSYW5rLGdlbmRlclJhbmssX0VMQVBTRUQpXHJcblx0XHR7XHJcblx0XHRcdHZhciBsbHQgPSAobmV3IERhdGUoKSkuZ2V0VGltZSgpOyBcclxuXHRcdFx0aWYgKCFjdGltZSlcclxuXHRcdFx0XHRjdGltZT1sbHQ7XHJcblx0XHRcdHRoaXMuc2V0TGFzdFJlYWxEZWxheShsbHQtY3RpbWUpO1xyXG5cdFx0XHR0aGlzLnNldExhc3RQaW5nVGltZXN0YW1wKGxsdCk7XHRcdFx0XHJcblx0XHRcdGlmIChpc1NPUylcclxuXHRcdFx0XHR0aGlzLnNldElzU09TKHRydWUpO1x0XHRcdFx0XHJcblx0XHRcdGVsc2VcclxuXHRcdFx0XHRpc1NPUz10aGlzLmdldElzU09TKCk7XHJcblx0XHRcdHZhciBzdGF0ZSA9IG5ldyBQYXJ0aWNpcGFudFN0YXRlKHt0aW1lc3RhbXA6Y3RpbWUsZ3BzOnBvcyxpc1NPUzppc1NPUyxmcmVxOmZyZXEsYWx0OmFsdCxvdmVyYWxsUmFuazpvdmVyYWxsUmFuayxncm91cFJhbms6Z3JvdXBSYW5rLGdlbmRlclJhbms6Z2VuZGVyUmFua30pO1xyXG5cdFx0XHRpZiAoaXNTT1MpXHJcblx0XHRcdHtcclxuXHRcdFx0XHR0aGlzLmFkZFN0YXRlKHN0YXRlKTtcclxuXHRcdFx0XHRyZXR1cm47XHJcblx0XHRcdH1cclxuXHRcdFx0Ly8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0XHRcdHZhciB0cmFja2xlbiA9IHRoaXMudHJhY2suZ2V0VHJhY2tMZW5ndGgoKTtcclxuXHRcdFx0dmFyIHRyYWNrbGVuMSA9IHRoaXMudHJhY2suZ2V0VHJhY2tMZW5ndGhJbldHUzg0KCk7XHJcblx0XHRcdHZhciBsbHN0YXRlPW51bGw7XHJcblx0XHRcdHZhciBsc3RhdGU9bnVsbDtcclxuXHRcdFx0aWYgKHRoaXMuc3RhdGVzLnNpemUgPj0gMSkgXHJcblx0XHRcdHtcclxuXHRcdFx0XHR2YXIgaXQgPSB0aGlzLnN0YXRlcy5maW5kSXRlcih0aGlzLnN0YXRlcy5tYXgoKSk7XHJcblx0XHRcdFx0bHN0YXRlPWl0LmRhdGEoKTtcclxuXHRcdFx0XHRpZiAodGhpcy5zdGF0ZXMuc2l6ZSA+PSAyKSB7XHJcblx0XHRcdFx0XHRsbHN0YXRlPWl0LnByZXYoKTtcclxuXHRcdFx0XHR9XHJcblx0XHRcdH1cclxuXHRcdFx0aWYgKHBvc1swXSA9PSAwICYmIHBvc1sxXSA9PSAwKSB7XHJcblx0XHRcdFx0aWYgKCFsc3RhdGUpIFxyXG5cdFx0XHRcdFx0cmV0dXJuO1xyXG5cdFx0XHRcdHBvcz1sc3RhdGUuZ3BzO1xyXG5cdFx0XHR9XHJcblx0XHRcdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdFx0XHR2YXIgYmVzdDtcclxuXHRcdFx0dmFyIGJlc3RtPW51bGw7XHJcblx0XHRcdHZhciBsZWxwID0gbHN0YXRlID8gbHN0YXRlLmdldEVsYXBzZWQoKSA6IDA7XHQvLyBsYXN0IGVsYXBzZWRcclxuXHRcdFx0dmFyIHRnID0gdGhpcy50cmFjay5yb3V0ZTtcclxuXHRcdFx0Ly8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0XHRcdC8vIE5FVyBBTEdcclxuXHRcdFx0dmFyIGNvZWYgPSB0aGlzLnRyYWNrLmdldFRyYWNrTGVuZ3RoSW5XR1M4NCgpL3RoaXMudHJhY2suZ2V0VHJhY2tMZW5ndGgoKTtcclxuXHRcdFx0dmFyIG1pbmYgPSBudWxsO1xyXG5cdFx0XHR2YXIgcnIgPSBDT05GSUcubWF0aC5ncHNJbmFjY3VyYWN5KmNvZWY7XHJcblx0XHRcdHZhciByZXN1bHQgPSB0aGlzLnRyYWNrLnJUcmVlLnNlYXJjaChbcG9zWzBdLXJyLCBwb3NbMV0tcnIqY29lZnksIHBvc1swXStyciwgcG9zWzFdK3JyKmNvZWZ5XSk7XHJcblx0XHRcdGlmICghcmVzdWx0KVxyXG5cdFx0XHRcdHJlc3VsdD1bXTtcclxuXHRcdFx0Ly9jb25zb2xlLmxvZyhcIiEhISBGT1VORCBcIityZXN1bHQubGVuZ3RoK1wiIHwgXCIrdGhpcy50cmFjay5yb3V0ZS5sZW5ndGgrXCIgfCBcIitycik7XHJcblx0XHRcdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdFx0XHR2YXIgZGVidWdJbmZvPXt9O1xyXG5cdFx0XHR2YXIgbW1pbmY9bnVsbDtcclxuXHRcdFx0Zm9yICh2YXIgX2k9MDtfaTxyZXN1bHQubGVuZ3RoO19pKyspXHJcblx0XHRcdHtcclxuXHRcdFx0XHR2YXIgaSA9IHJlc3VsdFtfaV1bNF0uaW5kZXg7XHJcblx0XHRcdFx0Ly9hMSxhMixyMSxyMlxyXG5cdFx0XHRcdHZhciByZXMgPSBJbnRlcnNlY3Rpb24uaW50ZXJzZWN0TGluZVJlY3RhbmdsZShcclxuXHRcdFx0XHRcdFx0XHRuZXcgUG9pbnQyRCh0Z1tpXVswXSx0Z1tpXVsxXSksXHJcblx0XHRcdFx0XHRcdFx0bmV3IFBvaW50MkQodGdbaSsxXVswXSx0Z1tpKzFdWzFdKSxcclxuXHRcdFx0XHRcdFx0XHRuZXcgUG9pbnQyRChwb3NbMF0tcnIscG9zWzFdLXJyKmNvZWZ5KSxcclxuXHRcdFx0XHRcdFx0XHRuZXcgUG9pbnQyRChwb3NbMF0rcnIscG9zWzFdK3JyKmNvZWZ5KVxyXG5cdFx0XHRcdFx0XHQpO1xyXG5cdFx0XHRcdC8vY29uc29sZS5sb2cocmVzKTtcclxuXHRcdFx0XHRpZiAocmVzICYmIHJlcy5wb2ludHMgJiYgcmVzLnBvaW50cy5sZW5ndGgpIFxyXG5cdFx0XHRcdHtcclxuXHRcdFx0XHRcdC8vVXRpbHMuZGlzcFxyXG5cdFx0XHRcdFx0dmFyIGQzID0gVXRpbHMuV0dTODRTUEhFUkUuaGF2ZXJzaW5lRGlzdGFuY2UodGdbaV0sdGdbaSsxXSk7XHJcblx0XHRcdFx0XHRyZXM9cmVzLnBvaW50cztcclxuXHRcdFx0XHRcdGZvciAodmFyIHE9MDtxPHJlcy5sZW5ndGg7cSsrKSBcclxuXHRcdFx0XHRcdHtcclxuXHRcdFx0XHRcdFx0Ly9VdGlscy5kaXNwXHJcblx0XHRcdFx0XHRcdHZhciBkMSA9IFV0aWxzLldHUzg0U1BIRVJFLmhhdmVyc2luZURpc3RhbmNlKFtyZXNbcV0ueCxyZXNbcV0ueV0sdGdbaV0pO1xyXG5cdFx0XHRcdFx0XHR2YXIgZWwxID0gdGhpcy50cmFjay5kaXN0YW5jZXNFbGFwc2VkW2ldKyh0aGlzLnRyYWNrLmRpc3RhbmNlc0VsYXBzZWRbaSsxXS10aGlzLnRyYWNrLmRpc3RhbmNlc0VsYXBzZWRbaV0pKmQxL2QzO1xyXG5cdFx0XHRcdFx0XHRpZiAoZWwxIDwgbGVscCkge1xyXG5cdFx0XHRcdFx0XHRcdGlmIChtbWluZiA9PSBudWxsIHx8IG1taW5mID4gZWwxKVxyXG5cdFx0XHRcdFx0XHRcdFx0bW1pbmY9ZWwxO1xyXG5cdFx0XHRcdFx0XHRcdGNvbnRpbnVlOyBcdFx0XHRcdC8vIFNLSVAgPCBMRUxQXHJcblx0XHRcdFx0XHRcdH1cclxuXHRcdFx0XHRcdFx0aWYgKG1pbmYgPT0gbnVsbCB8fCBlbDEgPCBtaW5mKSB7XHJcblx0XHRcdFx0XHRcdFx0aWYgKGRlYnVnSW5mbykge1xyXG5cdFx0XHRcdFx0XHRcdFx0ZGVidWdJbmZvLmJlc3Q9aTtcclxuXHRcdFx0XHRcdFx0XHRcdGRlYnVnSW5mby5wb2ludD1bcmVzW3FdLngscmVzW3FdLnldO1xyXG5cdFx0XHRcdFx0XHRcdFx0ZGVidWdJbmZvLnZhbHVlPWVsMTtcclxuXHRcdFx0XHRcdFx0XHR9XHJcblx0XHRcdFx0XHRcdFx0bWluZj1lbDE7XHJcblx0XHRcdFx0XHRcdH1cclxuXHRcdFx0XHRcdFx0Y29uc29sZS5sb2coXCJJbnRlcnNlY3Rpb24gY2FuZGlkYXRlIGF0IFwiK2krXCIgfCBcIitNYXRoLnJvdW5kKGVsMSoxMDAuMCoxMDAuMCkvMTAwLjApO1xyXG5cdFx0XHRcdFx0fVxyXG5cdFx0XHRcdH1cclxuXHRcdFx0XHQvKnZhciByZXMgPSBVdGlscy5pbnRlcmNlcHRPbkNpcmNsZSh0Z1tpXSx0Z1tpKzFdLHBvcyxycik7XHJcblx0XHRcdFx0aWYgKHJlcykgXHJcblx0XHRcdFx0e1xyXG5cdFx0XHRcdFx0Ly8gaGFzIGludGVyc2VjdGlvbiAoMiBwb2ludHMpXHJcblx0XHRcdFx0XHR2YXIgZDEgPSBVdGlscy5kaXN0cChyZXNbMF0sdGdbaV0pO1xyXG5cdFx0XHRcdFx0dmFyIGQyID0gVXRpbHMuZGlzdHAocmVzWzFdLHRnW2ldKTtcclxuXHRcdFx0XHRcdHZhciBkMyA9IFV0aWxzLmRpc3RwKHRnW2ldLHRnW2krMV0pO1xyXG5cdFx0XHRcdFx0dmFyIGVsMSA9IHRoaXMudHJhY2suZGlzdGFuY2VzRWxhcHNlZFtpXSsodGhpcy50cmFjay5kaXN0YW5jZXNFbGFwc2VkW2krMV0tdGhpcy50cmFjay5kaXN0YW5jZXNFbGFwc2VkW2ldKSpkMS9kMztcclxuXHRcdFx0XHRcdHZhciBlbDIgPSB0aGlzLnRyYWNrLmRpc3RhbmNlc0VsYXBzZWRbaV0rKHRoaXMudHJhY2suZGlzdGFuY2VzRWxhcHNlZFtpKzFdLXRoaXMudHJhY2suZGlzdGFuY2VzRWxhcHNlZFtpXSkqZDIvZDM7XHJcblx0XHRcdFx0XHQvL2NvbnNvbGUubG9nKFwiSW50ZXJzZWN0aW9uIGNhbmRpZGF0ZSBhdCBcIitpK1wiIHwgXCIrTWF0aC5yb3VuZChlbDEqMTAwLjAqMTAwLjApLzEwMC4wK1wiIHwgXCIrTWF0aC5yb3VuZChlbDIqMTAwLjAqMTAwLjApLzEwMC4wK1wiIHwgTEVMUD1cIitNYXRoLnJvdW5kKGxlbHAqMTAwLjAqMTAwLjApLzEwMC4wKTtcclxuXHRcdFx0XHRcdGlmIChlbDEgPCBsZWxwKVxyXG5cdFx0XHRcdFx0XHRlbDE9bGVscDtcclxuXHRcdFx0XHRcdGlmIChlbDIgPCBsZWxwKVxyXG5cdFx0XHRcdFx0XHRlbDI9bGVscDtcclxuXHRcdFx0XHRcdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdFx0XHRcdFx0aWYgKG1pbmYgPT0gbnVsbCB8fCBlbDEgPCBtaW5mKVxyXG5cdFx0XHRcdFx0XHRtaW5mPWVsMTtcclxuXHRcdFx0XHRcdGlmIChlbDIgPCBtaW5mKVxyXG5cdFx0XHRcdFx0XHRtaW5mPWVsMjtcclxuXHRcdFx0XHR9Ki9cclxuXHRcdFx0fVxyXG5cdFx0XHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVx0XHRcdFxyXG5cdFx0XHRpZiAobWluZiA9PSBudWxsICYmIG1taW5mID09IG51bGwpIFxyXG5cdFx0XHR7XHJcblx0XHRcdFx0Y29uc29sZS5lcnJvcihcIk1NSU5GIE5VTEwgPiBESVNDQVJEIFwiK3RoaXMuY29kZStcIiB8IFwiK3RoaXMuZGV2aWNlSWQpO1xyXG5cdFx0XHRcdHRoaXMuc2V0SXNEaXNjYXJkZWQodHJ1ZSk7XHJcblx0XHRcdFx0c3RhdGUuc2V0SXNEaXNjYXJkZWQodHJ1ZSk7XHJcblx0XHRcdFx0c3RhdGUuc2V0RWxhcHNlZChsZWxwKTtcclxuXHRcdFx0XHR0aGlzLmFkZFN0YXRlKHN0YXRlKTtcclxuXHRcdFx0XHRyZXR1cm47XHJcblx0XHRcdH1cclxuXHRcdFx0LyppZiAobWluZiA9PSBudWxsKVxyXG5cdFx0XHRcdGNvbnNvbGUuZXJyb3IoXCJNSU5GIE5VTExcIik7XHJcblx0XHRcdGVsc2VcclxuXHRcdFx0XHRjb25zb2xlLmxvZyhcIj4+IE1JTkYgXCIrTWF0aC5yb3VuZChtaW5mKjEwMC4wKjEwMC4wKS8xMDAuMCk7Ki9cclxuXHRcdFx0Ly8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cdFx0XHRcclxuXHRcdFx0aWYgKGRlYnVnSW5mbylcclxuXHRcdFx0XHRzdGF0ZS5kZWJ1Z0luZm89ZGVidWdJbmZvO1xyXG5cdFx0XHRpZiAobWluZiA9PSBudWxsKSB7XHJcblx0XHRcdFx0c3RhdGUuc2V0RWxhcHNlZChsZWxwKTtcclxuXHRcdFx0XHRzdGF0ZS5zZXRJc0Rpc2NhcmRlZCh0aGlzLmdldElzRGlzY2FyZGVkKCkpO1xyXG5cdFx0XHRcdHRoaXMuYWRkU3RhdGUoc3RhdGUpO1xyXG5cdFx0XHRcdHJldHVybjtcclxuXHRcdFx0fVxyXG5cdFx0XHRiZXN0bT1taW5mO1xyXG5cdFx0XHRpZiAoYmVzdG0gIT0gbnVsbCkgXHJcblx0XHRcdHtcclxuXHRcdFx0XHR2YXIgbmVsID0gYmVzdG07IFxyXG5cdFx0XHRcdGlmIChsc3RhdGUpIFxyXG5cdFx0XHRcdHtcclxuXHRcdFx0XHRcdC8qaWYgKG5lbCA8IGxzdGF0ZS5nZXRFbGFwc2VkKCkpIFxyXG5cdFx0XHRcdFx0e1xyXG5cdFx0XHRcdFx0XHQvLyBXUk9ORyBESVJFQ1RJT04gT1IgR1BTIERBVEEgV1JPTkc/IFNLSVAuLlxyXG5cdFx0XHRcdFx0XHRpZiAoKGxzdGF0ZS5nZXRFbGFwc2VkKCktbmVsKSp0cmFja2xlbiA8IENPTkZJRy5jb25zdHJhaW50cy5iYWNrd2FyZHNFcHNpbG9uSW5NZXRlcikgXHJcblx0XHRcdFx0XHRcdFx0cmV0dXJuO1xyXG5cdFx0XHRcdFx0XHRkbyAgXHJcblx0XHRcdFx0XHRcdHtcclxuXHRcdFx0XHRcdFx0XHRuZWwrPTEuMDtcclxuXHRcdFx0XHRcdFx0fSB3aGlsZSAobmVsIDwgbHN0YXRlLmdldEVsYXBzZWQoKSk7XHJcblx0XHRcdFx0XHR9Ki9cclxuXHRcdFx0XHRcdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRcdFx0XHRcdGlmIChuZWwgPiB0aGlzLnRyYWNrLmxhcHMpIHtcclxuXHRcdFx0XHRcdFx0bmVsPXRoaXMudHJhY2subGFwcztcclxuXHRcdFx0XHRcdH1cclxuXHRcdFx0XHRcdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRcdFx0XHRcdGxsc3RhdGU9bnVsbDtcclxuXHRcdFx0XHRcdGxzdGF0ZT1udWxsO1xyXG5cdFx0XHRcdFx0aWYgKHRoaXMuc3RhdGVzLnNpemUgPj0gQ09ORklHLm1hdGguc3BlZWRBbmRBY2NlbGVyYXRpb25BdmVyYWdlRGVncmVlKSB7XHJcblx0XHRcdFx0XHRcdHZhciBpdCA9IHRoaXMuc3RhdGVzLmZpbmRJdGVyKHRoaXMuc3RhdGVzLm1heCgpKTtcclxuXHRcdFx0XHRcdFx0bHN0YXRlPWl0LmRhdGEoKTsgXHJcblx0XHRcdFx0XHRcdGZvciAodmFyIGtrPTA7a2s8Q09ORklHLm1hdGguc3BlZWRBbmRBY2NlbGVyYXRpb25BdmVyYWdlRGVncmVlLTE7a2srKykge1xyXG5cdFx0XHRcdFx0XHRcdGxzdGF0ZT1pdC5wcmV2KCk7IFxyXG5cdFx0XHRcdFx0XHR9XHJcblx0XHRcdFx0XHR9XHJcblx0XHRcdFx0XHRpZiAodGhpcy5zdGF0ZXMuc2l6ZSA+PSBDT05GSUcubWF0aC5zcGVlZEFuZEFjY2VsZXJhdGlvbkF2ZXJhZ2VEZWdyZWUqMikge1xyXG5cdFx0XHRcdFx0XHR2YXIgaXQgPSB0aGlzLnN0YXRlcy5maW5kSXRlcih0aGlzLnN0YXRlcy5tYXgoKSk7XHJcblx0XHRcdFx0XHRcdGxsc3RhdGU9aXQuZGF0YSgpOyBcclxuXHRcdFx0XHRcdFx0Zm9yICh2YXIga2s9MDtrazxDT05GSUcubWF0aC5zcGVlZEFuZEFjY2VsZXJhdGlvbkF2ZXJhZ2VEZWdyZWUqMi0xO2trKyspIHtcclxuXHRcdFx0XHRcdFx0XHRsbHN0YXRlPWl0LnByZXYoKTsgXHJcblx0XHRcdFx0XHRcdH1cclxuXHRcdFx0XHRcdH1cclxuXHRcdFx0XHRcdGlmIChsc3RhdGUpICB7XHJcblx0XHRcdFx0XHRcdHN0YXRlLnNldFNwZWVkKCB0cmFja2xlbiAqIChuZWwtbHN0YXRlLmdldEVsYXBzZWQoKSkgKiAxMDAwIC8gKGN0aW1lLWxzdGF0ZS50aW1lc3RhbXApKTtcclxuXHRcdFx0XHRcdFx0aWYgKGxsc3RhdGUpIFxyXG5cdFx0XHRcdFx0XHRcdHN0YXRlLnNldEFjY2VsZXJhdGlvbiggKHN0YXRlLmdldFNwZWVkKCktbHN0YXRlLmdldFNwZWVkKCkpICogMTAwMCAvIChjdGltZS1sc3RhdGUudGltZXN0YW1wKSk7XHJcblx0XHRcdFx0XHR9XHJcblx0XHRcdFx0XHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0XHRcdFx0fVxyXG5cdFx0XHRcdHN0YXRlLnNldEVsYXBzZWQobmVsKTtcclxuXHRcdFx0fSBlbHNlIHtcclxuXHRcdFx0XHRpZiAobHN0YXRlKVxyXG5cdFx0XHRcdFx0c3RhdGUuc2V0RWxhcHNlZChsc3RhdGUuZ2V0RWxhcHNlZCgpKTtcclxuXHRcdFx0XHRpZiAobHN0YXRlLmdldEVsYXBzZWQoKSAhPSB0aGlzLnRyYWNrLmxhcHMpIHtcclxuXHRcdFx0XHRcdHRoaXMuc2V0SXNEaXNjYXJkZWQodHJ1ZSk7XHJcblx0XHRcdFx0fVxyXG5cdFx0XHR9XHJcblx0XHRcdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRcdFx0c3RhdGUuc2V0SXNEaXNjYXJkZWQodGhpcy5nZXRJc0Rpc2NhcmRlZCgpKTtcclxuXHRcdFx0dGhpcy5hZGRTdGF0ZShzdGF0ZSk7XHJcblx0XHR9LFxyXG5cdFx0XHJcblx0XHRhZGRTdGF0ZSA6IGZ1bmN0aW9uKHN0YXRlKSB7XHJcblx0XHRcdHRoaXMuc3RhdGVzLmluc2VydChzdGF0ZSk7XHJcblx0XHRcdGlmICghQ09ORklHLl9fc2tpcFBhcnRpY2lwYW50SGlzdG9yeUNsZWFyKVxyXG5cdFx0XHRpZiAodGhpcy5zdGF0ZXMuc2l6ZSA+IENPTkZJRy5jb25zdHJhaW50cy5tYXhQYXJ0aWNpcGFudFN0YXRlSGlzdG9yeSlcclxuXHRcdFx0XHR0aGlzLnN0YXRlcy5yZW1vdmUodGhpcy5zdGF0ZXMubWluKCkpO1xyXG5cdFx0fSxcclxuXHJcblx0XHRnZXRMYXN0U3RhdGU6IGZ1bmN0aW9uKCkge1xyXG5cdFx0XHRyZXR1cm4gdGhpcy5zdGF0ZXMuc2l6ZSA/IHRoaXMuc3RhdGVzLm1heCgpIDogbnVsbDtcclxuXHRcdH0sXHJcblxyXG5cdFx0Z2V0RnJlcSA6IGZ1bmN0aW9uKCkge1xyXG5cdFx0XHR2YXIgbHN0YXRlID0gdGhpcy5nZXRMYXN0U3RhdGUoKTtcclxuXHRcdFx0cmV0dXJuIGxzdGF0ZSA/IGxzdGF0ZS5mcmVxIDogMDtcclxuXHRcdH0sXHJcblxyXG5cdFx0Z2V0U3BlZWQgOiBmdW5jdGlvbigpIHtcclxuXHRcdFx0dmFyIGxzdGF0ZSA9IHRoaXMuZ2V0TGFzdFN0YXRlKCk7XHJcblx0XHRcdHJldHVybiBsc3RhdGUgPyBsc3RhdGUuc3BlZWQgOiAwO1xyXG5cdFx0fSxcclxuXHJcblx0XHRnZXRHUFMgOiBmdW5jdGlvbigpIHtcclxuXHRcdFx0dmFyIGxzdGF0ZSA9IHRoaXMuZ2V0TGFzdFN0YXRlKCk7XHJcblx0XHRcdHJldHVybiBsc3RhdGUgPyBsc3RhdGUuZ3BzIDogdGhpcy5nZXRQb3NpdGlvbigpO1xyXG5cdFx0fSxcclxuXHJcblx0XHRnZXRFbGFwc2VkIDogZnVuY3Rpb24oKSB7XHJcblx0XHRcdHZhciBsc3RhdGUgPSB0aGlzLmdldExhc3RTdGF0ZSgpO1xyXG5cdFx0XHRyZXR1cm4gbHN0YXRlID8gbHN0YXRlLmVsYXBzZWQgOiAwO1xyXG5cdFx0fSxcclxuXHJcblx0XHRnZXRQb3B1cEhUTUwgOiBmdW5jdGlvbihjdGltZSkge1xyXG5cdFx0XHR2YXIgcG9zID0gdGhpcy5taW4oXCJncHNcIik7XHJcblx0XHRcdHZhciB0bGVuID0gdGhpcy50cmFjay5nZXRUcmFja0xlbmd0aCgpO1xyXG5cdFx0XHR2YXIgZWxhcHNlZCA9IHRoaXMuY2FsY3VsYXRlRWxhcHNlZEF2ZXJhZ2UoY3RpbWUpO1xyXG5cdFx0XHR2YXIgdHBhcnQgPSB0aGlzLnRyYWNrLmdldFRyYWNrUGFydChlbGFwc2VkKTtcclxuXHRcdFx0dmFyIHRhcmdldEtNO1xyXG5cdFx0XHR2YXIgcGFydFN0YXJ0O1xyXG5cdFx0XHR2YXIgdHBhcnRNb3JlO1xyXG5cdFx0XHRpZiAodHBhcnQgPT0gMCkge1xyXG5cdFx0XHRcdHRwYXJ0cz1cIlNXSU1cIjtcclxuXHRcdFx0XHR0YXJnZXRLTT10aGlzLnRyYWNrLmJpa2VTdGFydEtNO1xyXG5cdFx0XHRcdHBhcnRTdGFydD0wO1xyXG5cdFx0XHRcdHRwYXJ0TW9yZT1cIlNXSU1cIjtcclxuXHRcdFx0fSBlbHNlIGlmICh0cGFydCA9PSAxKSB7XHJcblx0XHRcdFx0dHBhcnRzPVwiQklLRVwiO1xyXG5cdFx0XHRcdHRhcmdldEtNPXRoaXMudHJhY2sucnVuU3RhcnRLTTtcclxuXHRcdFx0XHRwYXJ0U3RhcnQ9dGhpcy50cmFjay5iaWtlU3RhcnRLTTtcclxuXHRcdFx0XHR0cGFydE1vcmU9XCJSSURFXCI7XHJcblx0XHRcdH0gZWxzZSBpZiAodHBhcnQgPT0gMikgeyBcclxuXHRcdFx0XHR0cGFydHM9XCJSVU5cIjtcclxuXHRcdFx0XHR0YXJnZXRLTT10bGVuLzEwMDAuMDtcclxuXHRcdFx0XHRwYXJ0U3RhcnQ9dGhpcy50cmFjay5ydW5TdGFydEtNO1xyXG5cdFx0XHRcdHRwYXJ0TW9yZT1cIlJVTlwiO1xyXG5cdFx0XHR9XHJcblx0XHRcdHZhciBodG1sPVwiPGRpdiBjbGFzcz0ncG9wdXBfY29kZScgc3R5bGU9J2NvbG9yOnJnYmEoXCIrY29sb3JBbHBoYUFycmF5KHRoaXMuZ2V0Q29sb3IoKSwwLjkpLmpvaW4oXCIsXCIpK1wiKSc+XCIrZXNjYXBlSFRNTCh0aGlzLmdldENvZGUoKSkrXCIgKDEpPC9kaXY+XCI7XHJcblx0XHRcdHZhciBmcmVxID0gTWF0aC5yb3VuZCh0aGlzLmdldEZyZXEoKSk7XHJcblx0XHRcdGlmIChmcmVxID4gMCkge1xyXG5cdFx0XHRcdGh0bWwrPVwiPGRpdiBjbGFzc1wiICtcclxuXHRcdFx0XHRcdFx0XCI9J3BvcHVwX2ZyZXEnPlwiK2ZyZXErXCI8L2Rpdj5cIjtcclxuXHRcdFx0fVxyXG5cdFx0XHR2YXIgZWxrbSA9IGVsYXBzZWQqdGxlbi8xMDAwLjA7XHJcblx0XHRcdHZhciBlbGttcyA9IHBhcnNlRmxvYXQoTWF0aC5yb3VuZChlbGttICogMTAwKSAvIDEwMCkudG9GaXhlZCgyKTtcdFx0XHRcclxuXHJcblx0XHRcdC8qdmFyIHJla20gPSBlbGFwc2VkJTEuMDtcclxuXHRcdFx0cmVrbT0oMS4wLXJla20pKnRsZW4vMTAwMC4wO1xyXG5cdFx0XHRyZWttID0gcGFyc2VGbG9hdChNYXRoLnJvdW5kKHJla20gKiAxMDApIC8gMTAwKS50b0ZpeGVkKDIpOyovXHRcdFx0XHJcblx0XHRcdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRcdFx0dmFyIGVzdGY9bnVsbDtcclxuXHRcdFx0dmFyIGV0eHQxPW51bGw7XHJcblx0XHRcdHZhciBldHh0Mj1udWxsO1xyXG5cdFx0XHR2YXIgbHN0YXRlID0gbnVsbDsgXHJcblxyXG5cdFx0XHR2YXIgc3BlZWQgPSB0aGlzLmF2ZyhjdGltZSxcInNwZWVkXCIpO1xyXG5cdFx0XHRpZiAoc3BlZWQgJiYgc3BlZWQgPiAwKSBcclxuXHRcdFx0e1xyXG5cdFx0XHRcdHZhciBhY2NlbGVyYXRpb24gPSB0aGlzLmF2ZyhjdGltZSxcImFjY2VsZXJhdGlvblwiKTtcclxuXHRcdFx0XHR2YXIgcm90ID0gdGhpcy50cmFjay5nZXRQb3NpdGlvbkFuZFJvdGF0aW9uRnJvbUVsYXBzZWQoZWxhcHNlZCkqMTgwL01hdGguUEk7XHJcblx0XHRcdFx0aWYgKHJvdCA8IDApXHJcblx0XHRcdFx0XHRyb3QrPTM2MDtcclxuXHRcdFx0XHR2YXIgc3BtcyA9IE1hdGguY2VpbChzcGVlZCAqIDEwMCkgLyAxMDA7XHJcblx0XHRcdFx0c3Btcy89MTAwMC4wO1xyXG5cdFx0XHRcdHNwbXMqPTYwKjYwO1xyXG5cdFx0XHRcdGV0eHQxPXBhcnNlRmxvYXQoc3BtcykudG9GaXhlZCgyKStcIiBrbS9oXCI7XHJcblx0XHRcdFx0aWYgKHJvdCAhPSBudWxsKSBcclxuXHRcdFx0XHR7XHJcblx0XHRcdFx0XHRpZiAocm90IDw9IDApIFxyXG5cdFx0XHRcdFx0XHRldHh0MSs9XCIgRVwiO1xyXG5cdFx0XHRcdFx0ZWxzZSBpZiAocm90IDw9IDQ1KVxyXG5cdFx0XHRcdFx0XHRldHh0MSs9XCIgU0VcIjtcclxuXHRcdFx0XHRcdGVsc2UgaWYgKHJvdCA8PSA5MClcclxuXHRcdFx0XHRcdFx0ZXR4dDErPVwiIFNcIjtcclxuXHRcdFx0XHRcdGVsc2UgaWYgKHJvdCA8PSAxMzUpXHJcblx0XHRcdFx0XHRcdGV0eHQxKz1cIiBTV1wiO1xyXG5cdFx0XHRcdFx0ZWxzZSBpZiAocm90IDw9IDE4MClcclxuXHRcdFx0XHRcdFx0ZXR4dDErPVwiIFdcIjtcclxuXHRcdFx0XHRcdGVsc2UgaWYgKHJvdCA8PSAyMjUpXHJcblx0XHRcdFx0XHRcdGV0eHQxKz1cIiBOV1wiO1xyXG5cdFx0XHRcdFx0ZWxzZSBpZiAocm90IDw9IDI3MClcclxuXHRcdFx0XHRcdFx0ZXR4dDErPVwiIE5cIjtcclxuXHRcdFx0XHRcdGVsc2UgXHJcblx0XHRcdFx0XHRcdGV0eHQxKz1cIiBORVwiO1xyXG5cdFx0XHRcdH1cclxuXHRcdFx0XHRlc3RmPVV0aWxzLmZvcm1hdFRpbWUobmV3IERhdGUoIGN0aW1lICsgdGFyZ2V0S00qMTAwMCAvIHNwbXMqMTAwMCApKTsgIFxyXG5cdFx0XHRcdGlmIChhY2NlbGVyYXRpb24gPiAwKVxyXG5cdFx0XHRcdFx0ZXR4dDI9cGFyc2VGbG9hdChNYXRoLmNlaWwoYWNjZWxlcmF0aW9uICogMTAwKSAvIDEwMCkudG9GaXhlZCgyKStcIiBtL3MyXCI7XHJcblx0XHRcdH1cclxuXHRcdFx0Ly8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0XHRcdHZhciBwMSA9IDEwMCp0aGlzLnRyYWNrLmJpa2VTdGFydEtNLyh0bGVuLzEwMDAuMCk7XHJcblx0XHRcdHZhciBwMiA9IDEwMCoodGhpcy50cmFjay5ydW5TdGFydEtNLXRoaXMudHJhY2suYmlrZVN0YXJ0S00pLyh0bGVuLzEwMDAuMCk7XHJcblx0XHRcdHZhciBwMyA9IDEwMCoodGxlbi8xMDAwLjAgLSB0aGlzLnRyYWNrLnJ1blN0YXJ0S00pLyh0bGVuLzEwMDAuMCk7XHJcblx0XHRcdHZhciBwcmV0dHlDb29yZD1cclxuXHRcdFx0XHRcIjxkaXYgc3R5bGU9J29wYWNpdHk6MC43O2Zsb2F0OmxlZnQ7b3ZlcmZsb3c6aGlkZGVuO2hlaWdodDo3cHg7d2lkdGg6XCIrcDErXCIlO2JhY2tncm91bmQtY29sb3I6XCIrQ09ORklHLmFwcGVhcmFuY2UudHJhY2tDb2xvclN3aW0rXCInLz5cIitcclxuXHRcdFx0XHRcIjxkaXYgc3R5bGU9J29wYWNpdHk6MC43O2Zsb2F0OmxlZnQ7b3ZlcmZsb3c6aGlkZGVuO2hlaWdodDo3cHg7d2lkdGg6XCIrcDIrXCIlO2JhY2tncm91bmQtY29sb3I6XCIrQ09ORklHLmFwcGVhcmFuY2UudHJhY2tDb2xvckJpa2UrXCInLz5cIitcclxuXHRcdFx0XHRcIjxkaXYgc3R5bGU9J29wYWNpdHk6MC43O2Zsb2F0OmxlZnQ7b3ZlcmZsb3c6aGlkZGVuO2hlaWdodDo3cHg7d2lkdGg6XCIrcDMrXCIlO2JhY2tncm91bmQtY29sb3I6XCIrQ09ORklHLmFwcGVhcmFuY2UudHJhY2tDb2xvclJ1bitcIicvPlwiXHJcblx0XHRcdFx0OyAvL29sLmNvb3JkaW5hdGUudG9TdHJpbmdIRE1TKHRoaXMuZ2V0UG9zaXRpb24oKSwgMik7XHJcblxyXG5cdFx0XHR2YXIgaW1nZGl2O1xyXG5cdFx0XHRpZiAodHBhcnQgPT0gMClcclxuXHRcdFx0XHRpbWdkaXY9XCI8aW1nIGNsYXNzPSdwb3B1cF90cmFja19tb2RlJyBzdHlsZT0nbGVmdDpcIitlbGFwc2VkKjEwMCtcIiUnIHNyYz0naW1nL3N3aW0uc3ZnJy8+XCJcclxuXHRcdFx0ZWxzZSBpZiAodHBhcnQgPT0gMSlcclxuXHRcdFx0XHRpbWdkaXY9XCI8aW1nIGNsYXNzPSdwb3B1cF90cmFja19tb2RlJyBzdHlsZT0nbGVmdDpcIitlbGFwc2VkKjEwMCtcIiUnIHNyYz0naW1nL2Jpa2Uuc3ZnJy8+XCJcclxuXHRcdFx0ZWxzZSAvKmlmICh0cGFydCA9PSAyKSovXHJcblx0XHRcdFx0aW1nZGl2PVwiPGltZyBjbGFzcz0ncG9wdXBfdHJhY2tfbW9kZScgc3R5bGU9J2xlZnQ6XCIrZWxhcHNlZCoxMDArXCIlJyBzcmM9J2ltZy9ydW4uc3ZnJy8+XCJcclxuXHRcclxuXHJcblx0XHRcdHZhciBwYXNzID0gTWF0aC5yb3VuZCgobmV3IERhdGUoKSkuZ2V0VGltZSgpLzM1MDApICUgMztcclxuXHRcdFx0aHRtbCs9XCI8dGFibGUgY2xhc3M9J3BvcHVwX3RhYmxlJyBzdHlsZT0nYmFja2dyb3VuZC1pbWFnZTp1cmwoXFxcIlwiK3RoaXMuZ2V0SW1hZ2UoKStcIlxcXCIpJz5cIjtcclxuXHRcdFx0dmFyIGlzRHVtbXk9IShlbGFwc2VkID4gMCk7XHJcblx0XHRcdGh0bWwrPVwiPHRyPjx0ZCBjbGFzcz0nbGJsJz5FbGFwc2VkPC90ZD48dGQgY2xhc3M9J3ZhbHVlJz5cIisoaXNEdW1teSA/IFwiLVwiIDogZWxrbXMrXCIga21cIikrXCI8L3RkPjwvdHI+XCI7XHJcblx0XHRcdGh0bWwrPVwiPHRyPjx0ZCBjbGFzcz0nbGJsJz5Nb3JlIHRvIFwiK3RwYXJ0TW9yZStcIjwvdGQ+PHRkIGNsYXNzPSd2YWx1ZSc+XCIrKGlzRHVtbXkgPyBcIi1cIiA6IHBhcnNlRmxvYXQoTWF0aC5yb3VuZCgodGFyZ2V0S00tZWxrbSkgKiAxMDApIC8gMTAwKS50b0ZpeGVkKDIpIC8qIHJla20gKi8gK1wiIGttXCIpK1wiPC90ZD48L3RyPlwiO1xyXG5cdFx0XHRodG1sKz1cIjx0cj48dGQgY2xhc3M9J2xibCc+RmluaXNoIFwiKyB0cGFydHMudG9Mb3dlckNhc2UoKSArXCI8L3RkPjx0ZCBjbGFzcz0ndmFsdWUnPlwiKyghZXN0ZiA/IFwiLVwiIDogZXN0ZikrXCI8L3RkPjwvdHI+XCI7XHRcdFx0XHRcdFxyXG5cdFx0XHRodG1sKz1cIjx0cj48dGQgY2xhc3M9J2xibCc+U3BlZWQ8L3RkPjx0ZCBjbGFzcz0ndmFsdWUnPlwiKyghaXNEdW1teSAmJiBldHh0MSA/IGV0eHQxIDogXCItXCIpICsgXCI8L3RkPjwvdHI+XCI7XHJcblx0XHRcdGh0bWwrPVwiPHRyPjx0ZCBjbGFzcz0nbGJsJz5BY2NlbGVyLjwvdGQ+PHRkIGNsYXNzPSd2YWx1ZSc+XCIrKCFpc0R1bW15ICYmIGV0eHQyID8gZXR4dDIgOiBcIi1cIikgK1wiPC90ZD48L3RyPlwiO1xyXG5cdFx0XHRodG1sKz1cIjx0ciBzdHlsZT0naGVpZ2h0OjEwMCUnPjx0ZD4mbmJzcDs8L3RkPjx0ZD4mbmJzcDs8L3RkPjwvdHI+XCI7XHJcblx0XHRcdGh0bWwrXCI8L3RhYmxlPlwiXHJcblx0XHRcdC8vaHRtbCs9XCI8ZGl2IGNsYXNzPSdwb3B1cF9zaGFkb3cnPlwiK3ByZXR0eUNvb3JkK2ltZ2RpditcIjwvZGl2PlwiO1xyXG5cdFx0XHRcclxuXHRcdFx0dmFyIHJhbms9XCItXCI7XHJcblx0XHRcdGlmICh0aGlzLl9fcG9zICE9IHVuZGVmaW5lZClcclxuXHRcdFx0XHRyYW5rPXRoaXMuX19wb3MgKyAxOyAgIC8vIHRoZSBmaXJzdCBwb3MgLSB0aGUgRkFTVEVTVCBpcyAwXHJcblx0XHRcdFxyXG5cdFx0XHRcclxuXHRcdFx0aHRtbD1cIjxkaXYgY2xhc3M9J3BvcHVwX2NvbnRlbnRfcHJnJz48ZGl2IHN0eWxlPSd3aWR0aDpcIitwMStcIiU7aGVpZ2h0OjZweDtiYWNrZ3JvdW5kLWNvbG9yOlwiK0NPTkZJRy5hcHBlYXJhbmNlLnRyYWNrQ29sb3JTd2ltK1wiO2Zsb2F0OmxlZnQ7Jz48L2Rpdj48ZGl2IHN0eWxlPSd3aWR0aDpcIitwMitcIiU7aGVpZ2h0OjZweDtiYWNrZ3JvdW5kLWNvbG9yOlwiK0NPTkZJRy5hcHBlYXJhbmNlLnRyYWNrQ29sb3JCaWtlK1wiO2Zsb2F0OmxlZnQ7Jz48L2Rpdj48ZGl2IHN0eWxlPSd3aWR0aDpcIitwMytcIiU7aGVpZ2h0OjZweDtiYWNrZ3JvdW5kLWNvbG9yOlwiK0NPTkZJRy5hcHBlYXJhbmNlLnRyYWNrQ29sb3JSdW4rXCI7ZmxvYXQ6bGVmdDsnPjwvZGl2PlwiO1xyXG5cdFx0XHRodG1sKz1cIjxkaXYgY2xhc3M9J3BvcHVwX3RyYWNrX3Bvcyc+PGRpdiBjbGFzcz0ncG9wdXBfdHJhY2tfcG9zXzEnIHN0eWxlPSdsZWZ0OlwiKyhlbGFwc2VkKjkwKStcIiUnPjwvZGl2PjwvZGl2PlwiO1xyXG5cdFx0XHRodG1sKz1cIjwvZGl2PlwiO1xyXG5cdFx0XHRodG1sKz1cIjxpbWcgY2xhc3M9J3BvcHVwX2NvbnRlbnRfaW1nJyBzcmM9J1wiK3RoaXMuZ2V0SW1hZ2UoKStcIicvPlwiO1xyXG5cdFx0XHRodG1sKz1cIjxkaXYgY2xhc3M9J3BvcHVwX2NvbnRlbnRfMSc+XCI7XHJcblx0XHRcdGh0bWwrPVwiPGRpdiBjbGFzcz0ncG9wdXBfY29udGVudF9uYW1lJz5cIitlc2NhcGVIVE1MKHRoaXMuZ2V0Q29kZSgpKStcIjwvZGl2PlwiO1xyXG5cdFx0XHRodG1sKz1cIjxkaXYgY2xhc3M9J3BvcHVwX2NvbnRlbnRfbDEnPlwiK3RoaXMuZ2V0Q291bnRyeSgpLnN1YnN0cmluZygwLDMpLnRvVXBwZXJDYXNlKCkrXCIgfCBQb3M6IFwiK3JhbmsrXCIgfCBTcGVlZDogXCIrKCFpc0R1bW15ICYmIGV0eHQxID8gZXR4dDEgOiBcIi1cIikrXCI8L2Rpdj5cIjtcclxuXHRcdFx0dmFyIHBhc3MgPSBNYXRoLnJvdW5kKCgobmV3IERhdGUoKSkuZ2V0VGltZSgpIC8gMTAwMCAvIDQpKSUyO1xyXG5cdFx0XHRpZiAocGFzcyA9PSAwKSB7XHJcblx0XHRcdFx0aWYgKHRoaXMuX19wb3MgIT0gdW5kZWZpbmVkKSBcclxuXHRcdFx0XHR7XHJcblx0XHRcdFx0XHRwYXJzZUZsb2F0KE1hdGgucm91bmQoZWxrbSAqIDEwMCkgLyAxMDApLnRvRml4ZWQoMik7XHJcblxyXG5cdFx0XHRcdFx0Ly8gdGhpcy5fX25leHQgaXMgdGhlIHBhcnRpY2lwYW50IGJlaGluZCB0aGlzIG9uZSAoZS5nIHRoZSBzbG93ZXIgb25lIHdpdGggbGVzdCBlbGFwc2VkIGluZGV4KVxyXG5cdFx0XHRcdFx0Ly8gYW5kIHRoaXMuX19wcmV2IGlzIHRoZSBvbmUgYmVmb3JlIHVzXHJcblx0XHRcdFx0XHQvLyBzbyBpZiBwYXJ0aWNpcGFudCBpcyBpbiBwb3NpdGlvbiAzIHRoZSBvbmUgYmVmb3JlIGhpbSB3aWxsIGJlIDIgYW5kIHRoZSBvbmUgYmVoaW5kIGhpbSB3aWxsIGJlIDRcclxuXHRcdFx0XHRcdC8vIChlLmcuIFwidGhpcy5fX3BvcyA9PSAzXCIgPT4gdGhpcy5fX3ByZXYuX19wb3MgPT0gMiBhbmQgdGhpcy5fX3ByZXYuX19uZXh0ID09IDRcclxuXHRcdFx0XHRcdC8vIGZvciB0aGVcclxuXHJcblx0XHRcdFx0XHRpZiAodGhpcy5fX3ByZXYgJiYgdGhpcy5fX3ByZXYuX19wb3MgIT0gdW5kZWZpbmVkICYmIHRoaXMuZ2V0U3BlZWQoKSkge1xyXG5cdFx0XHRcdFx0XHQvLyB3aGF0IGlzIHRoZSBkaWZmZXJlbmNlIGJldHdlZW4gY3VycmVudCBvbmUgYW5kIHRoZSBvbmUgYmVmb3JlIC0gd2Ugd2lsbCBydW4gc28gb3VyIHNwZWVkXHJcblx0XHRcdFx0XHRcdC8vIHdoYXQgdGltZSB3ZSBhcmUgc2hvcnQgLSBzbyB3aWxsIGFkZCBhIG1pbnVzIGluIGZyb250IG9mIHRoZSB0aW1lXHJcblx0XHRcdFx0XHRcdHZhciBlbGFwc2VkcHJldiA9IHRoaXMuX19wcmV2LmNhbGN1bGF0ZUVsYXBzZWRBdmVyYWdlKGN0aW1lKTtcclxuXHRcdFx0XHRcdFx0dmFyIGRwcmV2ID0gKChlbGFwc2VkcHJldiAtIGVsYXBzZWQpKnRoaXMudHJhY2suZ2V0VHJhY2tMZW5ndGgoKSAvIHRoaXMuZ2V0U3BlZWQoKSkvNjAuMDtcclxuXHRcdFx0XHRcdFx0ZHByZXYgPSBwYXJzZUZsb2F0KE1hdGgucm91bmQoZHByZXYgKiAxMDApIC8gMTAwKS50b0ZpeGVkKDIpO1xyXG5cdFx0XHRcdFx0XHRodG1sKz1cIjxkaXYgY2xhc3M9J3BvcHVwX2NvbnRlbnRfbDInPkdBUCBQXCIrKHRoaXMuX19wcmV2Ll9fcG9zICsgMSkrXCIgOiAtXCIrZHByZXYrXCIgTWluPC9kaXY+XCI7XHJcblx0XHRcdFx0XHR9IGVsc2Uge1xyXG5cdFx0XHRcdFx0XHRodG1sKz1cIjxkaXYgY2xhc3M9J3BvcHVwX2NvbnRlbnRfbDInPiZuYnNwOzwvZGl2PlwiO1xyXG5cdFx0XHRcdFx0fVxyXG5cclxuXHRcdFx0XHRcdGlmICh0aGlzLl9fbmV4dCAmJiB0aGlzLl9fbmV4dC5fX3BvcyAhPSB1bmRlZmluZWQgJiYgdGhpcy5fX25leHQuZ2V0U3BlZWQoKSkge1xyXG5cdFx0XHRcdFx0XHQvLyB3aGF0IGlzIHRoZSBkaWZmZXJlbmNlIGJldHdlZW4gY3VycmVudCBvbmUgYW5kIHRoZSBvbmUgYmVoaW5kIC0gdGhpcyBvdGhlciBvbmUgd2lsbCBydW4gc28gaGlzIHNwZWVkXHJcblx0XHRcdFx0XHRcdC8vIHdhaHQgdGltZSB3ZSBhcmUgYWhlYWQgLSBzbyBhIHBvc2l0aXZlIHRpbWVcclxuXHRcdFx0XHRcdFx0dmFyIGVsYXBzZWRuZXh0ID0gdGhpcy5fX25leHQuY2FsY3VsYXRlRWxhcHNlZEF2ZXJhZ2UoY3RpbWUpO1xyXG5cdFx0XHRcdFx0XHR2YXIgZG5leHQgPSAoKGVsYXBzZWQgLSBlbGFwc2VkbmV4dCkqdGhpcy50cmFjay5nZXRUcmFja0xlbmd0aCgpIC8gdGhpcy5fX25leHQuZ2V0U3BlZWQoKSkvNjAuMDtcclxuXHRcdFx0XHRcdFx0ZG5leHQgPSBwYXJzZUZsb2F0KE1hdGgucm91bmQoZG5leHQgKiAxMDApIC8gMTAwKS50b0ZpeGVkKDIpO1xyXG5cdFx0XHRcdFx0XHRodG1sKz1cIjxkaXYgY2xhc3M9J3BvcHVwX2NvbnRlbnRfbDMnPkdBUCBQXCIrKHRoaXMuX19uZXh0Ll9fcG9zICsgMSkrXCIgOiBcIitkbmV4dCtcIiBNaW48L2Rpdj5cIjtcclxuXHRcdFx0XHRcdH0gZWxzZSB7XHJcblx0XHRcdFx0XHRcdGh0bWwrPVwiPGRpdiBjbGFzcz0ncG9wdXBfY29udGVudF9sMic+Jm5ic3A7PC9kaXY+XCI7XHJcblx0XHRcdFx0XHR9XHJcblx0XHRcdFx0fVxyXG5cdFx0XHR9IGVsc2Uge1xyXG5cdFx0XHRcdGh0bWwrPVwiPGRpdiBjbGFzcz0ncG9wdXBfY29udGVudF9sMic+TU9SRSBUTyAgXCIrdHBhcnRNb3JlK1wiOiBcIisoaXNEdW1teSA/IFwiLVwiIDogcGFyc2VGbG9hdChNYXRoLnJvdW5kKCh0YXJnZXRLTS1lbGttKSAqIDEwMCkgLyAxMDApLnRvRml4ZWQoMikgLyogcmVrbSAqLyArXCIga21cIikrXCI8L2Rpdj5cIjtcclxuXHRcdFx0XHRodG1sKz1cIjxkaXYgY2xhc3M9J3BvcHVwX2NvbnRlbnRfbDMnPkZJTklTSCBcIisgdHBhcnRzICtcIjogXCIrKCFlc3RmID8gXCItXCIgOiBlc3RmKStcIjwvZGl2PlwiO1xyXG5cdFx0XHR9XHJcblx0XHRcdGh0bWwrPVwiPC9kaXY+XCI7XHJcblx0XHRcdHJldHVybiBodG1sO1xyXG5cdFx0fVxyXG5cdFx0XHJcblx0XHRcclxuICAgIH1cclxufSk7XHJcbiIsInJlcXVpcmUoJ2pvb3NlJyk7XHJcblxyXG5DbGFzcyhcIlBvaW50XCIsIHtcclxuICAgIC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuICAgIC8vIEFMTCBDT09SRElOQVRFUyBBUkUgSU4gV09STEQgTUVSQ0FUT1JcclxuICAgIC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHJcbiAgICBoYXMgOiB7XHJcbiAgICAgICAgY29kZSA6IHtcclxuICAgICAgICAgICAgaXMgOiBcInJ3XCIsXHJcbiAgICAgICAgICAgIGluaXQgOiBcIkNPREVfTk9UX1NFVFwiXHJcbiAgICAgICAgfSxcclxuICAgICAgICBpZCA6IHtcclxuICAgICAgICAgICAgaXMgOiBcInJ3XCIsXHJcbiAgICAgICAgICAgIGluaXQgOiBcIklEX05PVF9TRVRcIlxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgZmVhdHVyZSA6IHtcclxuICAgICAgICAgICAgaXMgOiBcInJ3XCIsXHJcbiAgICAgICAgICAgIGluaXQgOiBudWxsXHJcbiAgICAgICAgfSxcclxuICAgICAgICBwb3NpdGlvbiA6IHtcclxuICAgICAgICAgICAgaXM6ICAgXCJyd1wiLFxyXG4gICAgICAgICAgICBpbml0OiBbMCwwXVx0Ly9sb24gbGF0IHdvcmxkIG1lcmNhdG9yXHJcbiAgICAgICAgfVxyXG4gICAgfSxcclxuXHJcbiAgICBtZXRob2RzIDoge1xyXG4gICAgICAgIGluaXQgOiBmdW5jdGlvbihwb3MpIHtcclxuICAgICAgICAgICAgaWYgKHR5cGVvZiBvbCAhPSBcInVuZGVmaW5lZFwiKSB7XHJcbiAgICAgICAgICAgICAgICB2YXIgZ2VvbSA9IG5ldyBvbC5nZW9tLlBvaW50KHBvcyk7XHJcbiAgICAgICAgICAgICAgICBnZW9tLnRyYW5zZm9ybSgnRVBTRzo0MzI2JywgJ0VQU0c6Mzg1NycpO1xyXG4gICAgICAgICAgICAgICAgdmFyIGZlYXR1cmUgPSBuZXcgb2wuRmVhdHVyZSgpO1xyXG4gICAgICAgICAgICAgICAgZmVhdHVyZS5zZXRHZW9tZXRyeShnZW9tKTtcclxuICAgICAgICAgICAgICAgIHRoaXMuc2V0RmVhdHVyZShmZWF0dXJlKTtcclxuXHJcbiAgICAgICAgICAgICAgICB0aGlzLnNldFBvc2l0aW9uKHBvcyk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICB9XHJcbn0pOyIsInZhciBDT05GSUcgPSByZXF1aXJlKCcuL0NvbmZpZycpO1xyXG4vLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG52YXIgYWxpYXNlcz17fTtcclxudmFyIGFsaWFzZXNSPXt9O1xyXG4kLmFqYXgoe1xyXG5cdHR5cGU6IFwiR0VUXCIsXHJcblx0dXJsOiBcImRhdGEvYWxpYXNlcy54bWxcIixcclxuXHRkYXRhVHlwZTogXCJ4bWxcIixcclxuXHRzdWNjZXNzOiBmdW5jdGlvbih4bWwpIHtcclxuXHRcdHZhciAkeG1sID0gJCh4bWwpO1xyXG5cdFx0dmFyICR0aXRsZSA9ICR4bWwuZmluZCggXCJNMk1EZXZpY2VcIiApLmVhY2goZnVuY3Rpb24oKSB7XHJcblx0XHRcdHZhciBkZXZJZD0kKHRoaXMpLmF0dHIoXCJtMm1EZXZpY2VJZFwiKTtcclxuXHRcdFx0dmFyIGltZWk9JCh0aGlzKS5hdHRyKFwiaW1laU51bWJlclwiKTtcclxuXHRcdFx0YWxpYXNlc1tpbWVpXT1kZXZJZDtcclxuXHRcdFx0YWxpYXNlc1JbZGV2SWRdPWltZWk7XHJcblx0XHR9KTtcclxuXHR9XHJcbn0pO1xyXG5cclxuZnVuY3Rpb24gYWxpYXMoaW1laSkgXHJcbnsgXHJcblx0aWYgKGFsaWFzZXNSW2ltZWldKVxyXG5cdFx0cmV0dXJuIGFsaWFzZXNSW2ltZWldO1xyXG5cdHJldHVybiBpbWVpO1xyXG59XHJcbi8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblxyXG5cclxudmFyIFNUWUxFUz1cclxue1xyXG5cdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0Ly8gc3R5bGUgZnVuY3Rpb24gZm9yIHRyYWNrXHJcblx0Ly8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRcdFxyXG5cdFwiX3RyYWNrXCI6IGZ1bmN0aW9uKGZlYXR1cmUscmVzb2x1dGlvbikgXHJcblx0e1xyXG4gICAgICAgIHJldHVybiBbXHJcbiAgICAgICAgXTtcclxuXHR9LFxyXG5cclxuXHRcInRlc3RcIjogZnVuY3Rpb24oZmVhdHVyZSxyZXNvbHV0aW9uKSBcclxuXHR7XHJcblx0XHR2YXIgc3R5bGVzPVtdO1xyXG4gICAgICAgIHN0eWxlcy5wdXNoKG5ldyBvbC5zdHlsZS5TdHlsZSh7XHJcbiAgICAgICAgICAgIGltYWdlOiBuZXcgb2wuc3R5bGUuQ2lyY2xlKHtcclxuICAgICAgICAgICAgICAgIHJhZGl1czogMTcsXHJcbiAgICAgICAgICAgICAgICBmaWxsOiBuZXcgb2wuc3R5bGUuRmlsbCh7XHJcbiAgICAgICAgICAgICAgICAgICAgY29sb3I6IFwicmdiYSgyNTUsMjU1LDI1NSwwLjUpXCJcclxuICAgICAgICAgICAgICAgIH0pLFxyXG4gICAgICAgICAgICAgICAgc3Ryb2tlOiBuZXcgb2wuc3R5bGUuU3Ryb2tlKHtcclxuICAgICAgICAgICAgICAgICAgICBjb2xvcjogXCJyZ2JhKDI1NSwyNTUsMjU1LDEpXCIsXHJcbiAgICAgICAgICAgICAgICAgICAgd2lkdGg6IDNcclxuICAgICAgICAgICAgICAgIH0pXHJcbiAgICAgICAgICAgIH0pXHJcbiAgICAgICAgfSkpO1xyXG4gICAgICAgIHJldHVybiBzdHlsZXM7XHJcblx0fSxcclxuXHJcblx0XCJ0ZXN0MlwiOiBmdW5jdGlvbihmZWF0dXJlLHJlc29sdXRpb24pIFxyXG5cdHtcclxuXHRcdHZhciBzdHlsZXM9W107XHJcbiAgICAgICAgc3R5bGVzLnB1c2gobmV3IG9sLnN0eWxlLlN0eWxlKHtcclxuICAgICAgICAgICAgc3Ryb2tlOiBuZXcgb2wuc3R5bGUuU3Ryb2tlKHtcclxuICAgICAgICAgICAgICAgIGNvbG9yOiBcInJnYmEoMjU1LDI1NSwwLDEpXCIsXHJcbiAgICAgICAgICAgICAgICB3aWR0aDogM1xyXG4gICAgICAgICAgICB9KSxcclxuXHQgICAgICAgIGltYWdlOiBuZXcgb2wuc3R5bGUuQ2lyY2xlKHtcclxuXHQgICAgICAgICAgICByYWRpdXM6IDcsXHJcblx0ICAgICAgICAgICAgc3Ryb2tlOiBuZXcgb2wuc3R5bGUuU3Ryb2tlKHtcclxuXHQgICAgICAgICAgICBcdC8vZmVhdHVyZS5jb2xvclxyXG5cdCAgICAgICAgICAgICAgICBjb2xvcjogXCJyZ2JhKDI1NSwyNTUsMCwxKVwiLFxyXG5cdCAgICAgICAgICAgICAgICB3aWR0aDogM1xyXG5cdCAgICAgICAgICAgIH0pLFxyXG5cdCAgICAgICAgICAgIGZpbGw6IG5ldyBvbC5zdHlsZS5TdHJva2Uoe1xyXG5cdCAgICAgICAgICAgIFx0Ly9mZWF0dXJlLmNvbG9yXHJcblx0ICAgICAgICAgICAgICAgIGNvbG9yOiBcInJnYmEoMjU1LDI1NSwwLDAuNylcIixcclxuXHQgICAgICAgICAgICAgICAgd2lkdGg6IDNcclxuXHQgICAgICAgICAgICB9KVxyXG5cdCAgICAgICAgfSksXHJcblx0ICAgICAgICB0ZXh0OiBuZXcgb2wuc3R5bGUuVGV4dCh7XHJcblx0ICAgICAgICAgICAgZm9udDogJ2JvbGQgMTVweCBMYXRvLVJlZ3VsYXInLFxyXG5cdCAgICAgICAgICAgIGZpbGw6IG5ldyBvbC5zdHlsZS5GaWxsKHtcclxuXHQgICAgICAgICAgICAgICAgY29sb3I6ICdyZ2JhKDI1NSwyNTUsMCwxKSdcclxuXHQgICAgICAgICAgICB9KSxcclxuXHQgICAgICAgICAgICB0ZXh0OiBmZWF0dXJlLmdldEdlb21ldHJ5KCkgaW5zdGFuY2VvZiBvbC5nZW9tLlBvaW50ID8gKE1hdGgucm91bmQoZmVhdHVyZS5kZWJ1Z0luZm8udmFsdWUqMTAwKjEwMC4wKS8xMDAuMCkrXCIlXCIgOiBcIlwiLFxyXG5cdCAgICAgICAgICAgIG9mZnNldFg6ICAwLFxyXG5cdCAgICAgICAgICAgIG9mZnNldFkgOiAxNlxyXG5cdCAgICAgICAgfSlcclxuICAgICAgICB9KSk7XHJcbiAgICAgICAgcmV0dXJuIHN0eWxlcztcclxuXHR9LFxyXG5cclxuXHRcInRlc3QxXCI6IGZ1bmN0aW9uKGZlYXR1cmUscmVzb2x1dGlvbikgXHJcblx0e1xyXG5cdFx0dmFyIHN0eWxlcz1bXTtcclxuICAgICAgICBzdHlsZXMucHVzaChuZXcgb2wuc3R5bGUuU3R5bGUoe1xyXG4gICAgICAgICAgICAgc3Ryb2tlOiBuZXcgb2wuc3R5bGUuU3Ryb2tlKHtcclxuICAgICAgICAgICAgICAgICBjb2xvcjogXCJyZ2JhKDAsMCwwLDAuNClcIixcclxuICAgICAgICAgICAgICAgICB3aWR0aDogM1xyXG4gICAgICAgICAgICAgfSksXHJcblx0ICAgICAgICAgZmlsbDogbmV3IG9sLnN0eWxlLkZpbGwoe1xyXG5cdCAgICAgICAgICAgIGNvbG9yOiBcInJnYmEoNDAsMjU1LDQwLDAuMilcIlxyXG5cdCAgICAgICAgIH0pLFxyXG4gICAgICAgIH0pKTtcclxuICAgICAgICByZXR1cm4gc3R5bGVzO1xyXG5cdH0sXHJcblx0XCJ0cmFja1wiIDogZnVuY3Rpb24oZmVhdHVyZSxyZXNvbHV0aW9uKSBcclxuXHR7XHJcblx0XHR2YXIgc3R5bGVzPVtdO1xyXG5cdFx0dmFyIHRyYWNrPWZlYXR1cmUudHJhY2s7XHJcblx0XHRpZiAoIXRyYWNrKSB7XHJcblx0XHRcdGNvbnNvbGUubG9nKFwiUmVuZGVyaW5nIHRyYWNrIGZlYXR1cmUgd2l0aG91dCB0cmFjayBvYmplY3QhXCIpO1xyXG5cdFx0XHRyZXR1cm4gc3R5bGVzO1xyXG5cdFx0fVxyXG5cdFx0dmFyIGNvb3Jkcz1mZWF0dXJlLmdldEdlb21ldHJ5KCkuZ2V0Q29vcmRpbmF0ZXMoKTtcclxuXHRcdHZhciBnZW9tc3dpbT1jb29yZHM7XHJcblx0XHR2YXIgZ2VvbWJpa2U7XHJcblx0XHR2YXIgZ2VvbXJ1bjtcclxuXHRcdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdFx0XHJcblx0XHQvKnZhciB3dyA9IDguMC9yZXNvbHV0aW9uO1xyXG5cdFx0aWYgKHd3IDwgNi4wKVxyXG5cdFx0XHR3dz02LjA7Ki9cclxuXHRcdHZhciB3dz0xMC4wO1xyXG5cclxuXHRcdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdFx0aWYgKHRyYWNrICYmICFpc05hTih0cmFjay5iaWtlU3RhcnRLTSkpIFxyXG5cdFx0e1xyXG5cdFx0XHRmb3IgKHZhciBpPTA7aTx0cmFjay5kaXN0YW5jZXMubGVuZ3RoO2krKykge1xyXG5cdFx0XHRcdGlmICh0cmFjay5kaXN0YW5jZXNbaV0gPj0gdHJhY2suYmlrZVN0YXJ0S00qMTAwMCkge1xyXG5cdFx0XHRcdFx0YnJlYWs7XHJcblx0XHRcdFx0fVxyXG5cdFx0XHR9XHJcblx0XHRcdHZhciBqO1xyXG5cdFx0XHRpZiAoIWlzTmFOKHRyYWNrLnJ1blN0YXJ0S00pKSB7XHJcblx0XHRcdFx0Zm9yIChqPWk7ajx0cmFjay5kaXN0YW5jZXMubGVuZ3RoO2orKykge1xyXG5cdFx0XHRcdFx0aWYgKHRyYWNrLmRpc3RhbmNlc1tqXSA+PSB0cmFjay5ydW5TdGFydEtNKjEwMDApXHJcblx0XHRcdFx0XHRcdGJyZWFrO1xyXG5cdFx0XHRcdH1cclxuXHRcdFx0fSBlbHNlIHtcclxuXHRcdFx0XHRqPXRyYWNrLmRpc3RhbmNlcy5sZW5ndGg7XHJcblx0XHRcdH1cclxuXHRcdFx0Z2VvbXN3aW09Y29vcmRzLnNsaWNlKDAsaSk7XHJcblx0XHRcdGdlb21iaWtlPWNvb3Jkcy5zbGljZShpIDwgMSA/IGkgOiBpLTEsaik7XHJcblx0XHRcdGlmIChqIDwgdHJhY2suZGlzdGFuY2VzLmxlbmd0aClcclxuXHRcdFx0XHRnZW9tcnVuPWNvb3Jkcy5zbGljZShqIDwgMSA/IGogOiBqLTEsdHJhY2suZGlzdGFuY2VzLmxlbmd0aCk7XHJcblx0XHRcdGlmICghZ2VvbXN3aW0gfHwgIWdlb21zd2ltLmxlbmd0aClcclxuXHRcdFx0XHRnZW9tc3dpbT1udWxsO1xyXG5cdFx0XHRpZiAoIWdlb21iaWtlIHx8ICFnZW9tYmlrZS5sZW5ndGgpXHJcblx0XHRcdFx0Z2VvbWJpa2U9bnVsbDtcclxuXHRcdFx0aWYgKCFnZW9tcnVuIHx8ICFnZW9tcnVuLmxlbmd0aClcclxuICAgICAgICAgICAgICAgIGdlb21ydW49bnVsbDtcclxuXHRcdH1cclxuXHJcblxyXG4gICAgICAgIGlmIChnZW9tc3dpbSAmJiBHVUkuaXNTaG93U3dpbSkge1xyXG4gICAgICAgICAgICBzdHlsZXMucHVzaChuZXcgb2wuc3R5bGUuU3R5bGUoe1xyXG4gICAgICAgICAgICAgICAgICAgIGdlb21ldHJ5OiBuZXcgb2wuZ2VvbS5MaW5lU3RyaW5nKGdlb21zd2ltKSxcclxuICAgICAgICAgICAgICAgICAgICBzdHJva2U6IG5ldyBvbC5zdHlsZS5TdHJva2Uoe1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb2xvcjogQ09ORklHLmFwcGVhcmFuY2UudHJhY2tDb2xvclN3aW0sXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHdpZHRoOiB3d1xyXG4gICAgICAgICAgICAgICAgICAgIH0pXHJcbiAgICAgICAgICAgICAgICB9KVxyXG4gICAgICAgICAgICApO1xyXG4gICAgICAgICAgICBTVFlMRVMuX2dlbkRpcmVjdGlvbihnZW9tc3dpbSwgd3csIHJlc29sdXRpb24sIENPTkZJRy5hcHBlYXJhbmNlLnRyYWNrQ29sb3JTd2ltLCBzdHlsZXMpO1xyXG5cclxuICAgICAgICAgICAgU1RZTEVTLl9nZW5EaXN0YW5jZUttKHd3LCByZXNvbHV0aW9uLCBjb29yZHMsIHRyYWNrLmRpc3RhbmNlcywgMCwgaSwgc3R5bGVzKTtcclxuXHJcblx0XHRcdC8vIGZvciBub3cgZG9uJ3Qgc2hvdyB0aGlzIGNoZWNrcG9pbnRcclxuXHRcdFx0Ly9pZiAoR1VJLmlzU2hvd1N3aW0pXHJcblx0XHRcdC8vXHRTVFlMRVMuX2dlbkNoZWNrcG9pbnQoZ2VvbXN3aW0sIENPTkZJRy5hcHBlYXJhbmNlLnRyYWNrQ29sb3JTd2ltLCBzdHlsZXMpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBpZiAoZ2VvbWJpa2UgJiYgR1VJLmlzU2hvd0Jpa2UpXHJcbiAgICAgICAge1xyXG4gICAgICAgICAgICBzdHlsZXMucHVzaChuZXcgb2wuc3R5bGUuU3R5bGUoe1xyXG4gICAgICAgICAgICAgICAgICAgIGdlb21ldHJ5OiBuZXcgb2wuZ2VvbS5MaW5lU3RyaW5nKGdlb21iaWtlKSxcclxuICAgICAgICAgICAgICAgICAgICBzdHJva2U6IG5ldyBvbC5zdHlsZS5TdHJva2Uoe1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb2xvcjogQ09ORklHLmFwcGVhcmFuY2UudHJhY2tDb2xvckJpa2UsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHdpZHRoOiB3d1xyXG4gICAgICAgICAgICAgICAgICAgIH0pXHJcbiAgICAgICAgICAgICAgICB9KVxyXG4gICAgICAgICAgICApO1xyXG4gICAgICAgICAgICBTVFlMRVMuX2dlbkRpcmVjdGlvbihnZW9tYmlrZSwgd3csIHJlc29sdXRpb24sIENPTkZJRy5hcHBlYXJhbmNlLnRyYWNrQ29sb3JCaWtlLCBzdHlsZXMpO1xyXG5cclxuICAgICAgICAgICAgU1RZTEVTLl9nZW5EaXN0YW5jZUttKHd3LCByZXNvbHV0aW9uLCBjb29yZHMsIHRyYWNrLmRpc3RhbmNlcywgaSwgaiwgc3R5bGVzKTtcclxuXHJcblx0XHRcdC8vIGFkZCBjaGVja3BvaW50IGlmIHRoaXMgaXMgbm90IGFscmVhZHkgYWRkZWQgYXMgYSBob3RzcG90XHJcblx0XHRcdGlmICghdHJhY2suaXNBZGRlZEhvdFNwb3RTd2ltQmlrZSkge1xyXG5cdFx0XHRcdGlmIChDT05GSUcuYXBwZWFyYW5jZS5pc1Nob3dDaGVja3BvaW50SW1hZ2UpXHJcblx0XHRcdFx0XHRTVFlMRVMuX2dlbkNoZWNrcG9pbnRJbWFnZShnZW9tYmlrZSwgQ09ORklHLmFwcGVhcmFuY2UuaW1hZ2VDaGVja3BvaW50U3dpbUJpa2UsIHN0eWxlcyk7XHJcblx0XHRcdFx0ZWxzZSBpZiAoQ09ORklHLmFwcGVhcmFuY2UuaXNTaG93Q2hlY2twb2ludCAmJiBHVUkuaXNTaG93QmlrZSlcclxuXHRcdFx0XHRcdFNUWUxFUy5fZ2VuQ2hlY2twb2ludChnZW9tYmlrZSwgQ09ORklHLmFwcGVhcmFuY2UudHJhY2tDb2xvckJpa2UsIHN0eWxlcyk7XHJcblx0XHRcdH1cclxuICAgICAgICB9XHJcblx0XHRpZiAoZ2VvbXJ1biAmJiBHVUkuaXNTaG93UnVuKVxyXG5cdFx0e1xyXG5cdFx0XHRzdHlsZXMucHVzaChuZXcgb2wuc3R5bGUuU3R5bGUoe1xyXG4gICAgICAgICAgICAgICAgICAgIGdlb21ldHJ5OiBuZXcgb2wuZ2VvbS5MaW5lU3RyaW5nKGdlb21ydW4pLFxyXG4gICAgICAgICAgICAgICAgICAgIHN0cm9rZTogbmV3IG9sLnN0eWxlLlN0cm9rZSh7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbG9yOiBDT05GSUcuYXBwZWFyYW5jZS50cmFja0NvbG9yUnVuLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICB3aWR0aDogd3dcclxuICAgICAgICAgICAgICAgICAgICB9KVxyXG4gICAgICAgICAgICAgICAgfSlcclxuICAgICAgICAgICAgKTtcclxuICAgICAgICAgICAgU1RZTEVTLl9nZW5EaXJlY3Rpb24oZ2VvbXJ1biwgd3csIHJlc29sdXRpb24sIENPTkZJRy5hcHBlYXJhbmNlLnRyYWNrQ29sb3JSdW4sIHN0eWxlcyk7XHJcblxyXG4gICAgICAgICAgICBTVFlMRVMuX2dlbkRpc3RhbmNlS20od3csIHJlc29sdXRpb24sIGNvb3JkcywgdHJhY2suZGlzdGFuY2VzLCBqLCB0cmFjay5kaXN0YW5jZXMubGVuZ3RoLCBzdHlsZXMpO1xyXG5cclxuXHRcdFx0Ly8gYWRkIGNoZWNrcG9pbnQgaWYgdGhpcyBpcyBub3QgYWxyZWFkeSBhZGRlZCBhcyBhIGhvdHNwb3RcclxuXHRcdFx0aWYgKCF0cmFjay5pc0FkZGVkSG90U3BvdEJpa2VSdW4pIHtcclxuXHRcdFx0XHRpZiAoQ09ORklHLmFwcGVhcmFuY2UuaXNTaG93Q2hlY2twb2ludEltYWdlKVxyXG5cdFx0XHRcdFx0U1RZTEVTLl9nZW5DaGVja3BvaW50SW1hZ2UoZ2VvbXJ1biwgQ09ORklHLmFwcGVhcmFuY2UuaW1hZ2VDaGVja3BvaW50QmlrZVJ1biwgc3R5bGVzKTtcclxuXHRcdFx0XHRlbHNlIGlmIChDT05GSUcuYXBwZWFyYW5jZS5pc1Nob3dDaGVja3BvaW50ICYmIEdVSS5pc1Nob3dCaWtlKVxyXG5cdFx0XHRcdFx0U1RZTEVTLl9nZW5DaGVja3BvaW50KGdlb21ydW4sIENPTkZJRy5hcHBlYXJhbmNlLnRyYWNrQ29sb3JSdW4sIHN0eWxlcyk7XHJcblx0XHRcdH1cclxuICAgICAgICB9XHJcblxyXG5cdFx0Ly8gU1RBUlQtRklOSVNIIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0XHRpZiAoY29vcmRzICYmIGNvb3Jkcy5sZW5ndGggPj0gMilcclxuXHRcdHtcclxuXHRcdFx0dmFyIHN0YXJ0ID0gY29vcmRzWzBdO1xyXG5cdFx0XHR2YXIgZW5kID0gY29vcmRzWzFdO1xyXG5cdFx0XHQvKnZhciBkeCA9IGVuZFswXSAtIHN0YXJ0WzBdO1xyXG5cdFx0XHQgdmFyIGR5ID0gZW5kWzFdIC0gc3RhcnRbMV07XHJcblx0XHRcdCB2YXIgcm90YXRpb24gPSBNYXRoLmF0YW4yKGR5LCBkeCk7XHJcblx0XHRcdCBzdHlsZXMucHVzaChuZXcgb2wuc3R5bGUuU3R5bGUoXHJcblx0XHRcdCB7XHJcblx0XHRcdCBnZW9tZXRyeTogbmV3IG9sLmdlb20uUG9pbnQoc3RhcnQpLFxyXG5cdFx0XHQgaW1hZ2U6IG5ldyBvbC5zdHlsZS5JY29uKHtcclxuXHRcdFx0IHNyYzogJ2ltZy9iZWdpbi1lbmQtYXJyb3cucG5nJyxcclxuXHRcdFx0IHNjYWxlIDogMC40NSxcclxuXHRcdFx0IGFuY2hvcjogWzAuMCwgMC41XSxcclxuXHRcdFx0IHJvdGF0ZVdpdGhWaWV3OiB0cnVlLFxyXG5cdFx0XHQgcm90YXRpb246IC1yb3RhdGlvbixcclxuXHRcdFx0IG9wYWNpdHkgOiAxXHJcblx0XHRcdCB9KVxyXG5cdFx0XHQgfSkpOyovXHJcblxyXG5cdFx0XHQvLyBsb29wP1xyXG5cdFx0XHRlbmQgPSBjb29yZHNbY29vcmRzLmxlbmd0aC0xXTtcclxuXHRcdFx0aWYgKGVuZFswXSAhPSBzdGFydFswXSB8fCBlbmRbMV0gIT0gc3RhcnRbMV0pXHJcblx0XHRcdHtcclxuXHRcdFx0XHR2YXIgc3RhcnQgPSBjb29yZHNbY29vcmRzLmxlbmd0aC0yXTtcclxuXHRcdFx0XHR2YXIgZHggPSBlbmRbMF0gLSBzdGFydFswXTtcclxuXHRcdFx0XHR2YXIgZHkgPSBlbmRbMV0gLSBzdGFydFsxXTtcclxuXHRcdFx0XHR2YXIgcm90YXRpb24gPSBNYXRoLmF0YW4yKGR5LCBkeCk7XHJcblx0XHRcdFx0c3R5bGVzLnB1c2gobmV3IG9sLnN0eWxlLlN0eWxlKFxyXG5cdFx0XHRcdFx0e1xyXG5cdFx0XHRcdFx0XHRnZW9tZXRyeTogbmV3IG9sLmdlb20uUG9pbnQoZW5kKSxcclxuXHRcdFx0XHRcdFx0aW1hZ2U6IG5ldyBvbC5zdHlsZS5JY29uKHtcclxuXHRcdFx0XHRcdFx0XHRzcmM6IENPTkZJRy5hcHBlYXJhbmNlLmltYWdlRmluaXNoLFxyXG5cdFx0XHRcdFx0XHRcdHNjYWxlIDogMC40NSxcclxuXHRcdFx0XHRcdFx0XHRhbmNob3I6IFswLjUsIDAuNV0sXHJcblx0XHRcdFx0XHRcdFx0cm90YXRlV2l0aFZpZXc6IHRydWUsXHJcblx0XHRcdFx0XHRcdFx0Ly9yb3RhdGlvbjogLXJvdGF0aW9uLFxyXG5cdFx0XHRcdFx0XHRcdG9wYWNpdHkgOiAxXHJcblx0XHRcdFx0XHRcdH0pXHJcblx0XHRcdFx0XHR9KSk7XHJcblx0XHRcdH1cclxuXHRcdH1cclxuXHJcblx0XHRyZXR1cm4gc3R5bGVzO1xyXG5cdH0sXHJcblx0Ly8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdFwiZGVidWdHUFNcIiA6IGZ1bmN0aW9uKGZlYXR1cmUscmVzb2x1dGlvbikgXHJcblx0e1xyXG5cdFx0dmFyIGNvZWYgPSAoKG5ldyBEYXRlKCkpLmdldFRpbWUoKS1mZWF0dXJlLnRpbWVDcmVhdGVkKS8oQ09ORklHLnRpbWVvdXRzLmdwc0xvY2F0aW9uRGVidWdTaG93KjEwMDApO1xyXG5cdFx0aWYgKGNvZWYgPiAxKVxyXG5cdFx0XHRyZXR1cm4gW107XHJcblx0XHRyZXR1cm4gW1xyXG5cdFx0ICAgICAgICBuZXcgb2wuc3R5bGUuU3R5bGUoe1xyXG5cdFx0ICAgICAgICBpbWFnZTogbmV3IG9sLnN0eWxlLkNpcmNsZSh7XHJcblx0XHQgICAgICAgICAgICByYWRpdXM6IGNvZWYqMjAsXHJcblx0XHQgICAgICAgICAgICBzdHJva2U6IG5ldyBvbC5zdHlsZS5TdHJva2Uoe1xyXG5cdFx0ICAgICAgICAgICAgXHQvL2ZlYXR1cmUuY29sb3JcclxuXHRcdCAgICAgICAgICAgICAgICBjb2xvcjogY29sb3JBbHBoYUFycmF5KGZlYXR1cmUuY29sb3IsKDEuMC1jb2VmKSoxLjApLCBcclxuXHRcdCAgICAgICAgICAgICAgICB3aWR0aDogNFxyXG5cdFx0ICAgICAgICAgICAgfSlcclxuXHRcdCAgICAgICAgICB9KVxyXG5cdFx0fSldO1xyXG5cdH0sXHJcblx0XHJcblx0XCJwYXJ0aWNpcGFudFwiIDogZnVuY3Rpb24oZmVhdHVyZSxyZXNvbHV0aW9uKSBcclxuXHR7XHJcblx0XHQvLyBTS0lQIERSQVcgKFRPRE8gT1BUSU1JWkUpXHJcblx0XHR2YXIgcGFydCA9IGZlYXR1cmUucGFydGljaXBhbnQ7XHJcblx0XHRpZiAoIXBhcnQuaXNGYXZvcml0ZSlcclxuXHRcdFx0cmV0dXJuIFtdO1xyXG5cdFx0XHJcblx0XHR2YXIgY3RpbWUgPSBwYXJ0Ll9fY3RpbWUgPyBwYXJ0Ll9fY3RpbWUgOiAobmV3IERhdGUoKSkuZ2V0VGltZSgpO1xyXG5cdFx0dmFyIHNwZWVkID0gcGFydC5hdmcoY3RpbWUsXCJzcGVlZFwiKTtcclxuXHRcdHZhciBldHh0PVwiXCI7XHJcblx0XHRpZiAoc3BlZWQpIHtcclxuXHRcdFx0ZXR4dD1cIiBcIitwYXJzZUZsb2F0KE1hdGguY2VpbChzcGVlZCogMTAwKSAvIDEwMCkudG9GaXhlZCgyKStcIiBtL3NcIjtcclxuXHRcdH1cclxuXHRcdHZhciB6SW5kZXggPSBNYXRoLnJvdW5kKHBhcnQuZ2V0RWxhcHNlZCgpKjEwMDAwMDApKjEwMDArcGFydC5zZXFJZDtcclxuXHRcdHZhciBzdHlsZXM9W107XHJcblx0XHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0XHR2YXIgaXNUaW1lID0gKGN0aW1lID49IENPTkZJRy50aW1lcy5iZWdpbiAmJiBjdGltZSA8PSBDT05GSUcudGltZXMuZW5kKTtcclxuXHRcdHZhciBpc1NPUyA9IHBhcnQubWluKGN0aW1lLFwiaXNTT1NcIik7XHJcblx0XHR2YXIgaXNEaXNjYXJkZWQgPSBwYXJ0Lm1pbihjdGltZSxcImlzRGlzY2FyZGVkXCIpO1xyXG5cdFx0dmFyIGlzRGlyZWN0aW9uID0gKHNwZWVkICYmICFpc1NPUyAmJiAhaXNEaXNjYXJkZWQgJiYgaXNUaW1lKTtcclxuXHRcdHZhciBhbmltRnJhbWUgPSAoY3RpbWUlMzAwMCkqTWF0aC5QSSoyLzMwMDAuMDtcclxuXHJcbiAgICAgICAgaWYgKGlzVGltZSkge1xyXG4gICAgICAgICAgICBzdHlsZXMucHVzaChuZXcgb2wuc3R5bGUuU3R5bGUoe1xyXG4gICAgICAgICAgICAgICAgekluZGV4OiB6SW5kZXgsXHJcbiAgICAgICAgICAgICAgICBpbWFnZTogbmV3IG9sLnN0eWxlLkNpcmNsZSh7XHJcbiAgICAgICAgICAgICAgICAgICAgcmFkaXVzOiAxNyxcclxuICAgICAgICAgICAgICAgICAgICBmaWxsOiBuZXcgb2wuc3R5bGUuRmlsbCh7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbG9yOiBpc0Rpc2NhcmRlZCB8fCBpc1NPUyA/IFwicmdiYSgxOTIsMCwwLFwiICsgKE1hdGguc2luKGFuaW1GcmFtZSkgKiAwLjcgKyAwLjMpICsgXCIpXCIgOiBcInJnYmEoXCIgKyBjb2xvckFscGhhQXJyYXkocGFydC5jb2xvciwgMC44NSkuam9pbihcIixcIikgKyBcIilcIlxyXG4gICAgICAgICAgICAgICAgICAgIH0pLFxyXG4gICAgICAgICAgICAgICAgICAgIHN0cm9rZTogbmV3IG9sLnN0eWxlLlN0cm9rZSh7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbG9yOiBpc0Rpc2NhcmRlZCB8fCBpc1NPUyA/IFwicmdiYSgyNTUsMCwwLFwiICsgKDEuMCAtIChNYXRoLnNpbihhbmltRnJhbWUpICogMC43ICsgMC4zKSkgKyBcIilcIiA6IFwiI2ZmZmZmZlwiLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICB3aWR0aDogM1xyXG4gICAgICAgICAgICAgICAgICAgIH0pXHJcbiAgICAgICAgICAgICAgICB9KSxcclxuICAgICAgICAgICAgICAgIHRleHQ6IG5ldyBvbC5zdHlsZS5UZXh0KHtcclxuICAgICAgICAgICAgICAgICAgICBmb250OiAnbm9ybWFsIDEzcHggTGF0by1SZWd1bGFyJyxcclxuICAgICAgICAgICAgICAgICAgICBmaWxsOiBuZXcgb2wuc3R5bGUuRmlsbCh7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbG9yOiAnI0ZGRkZGRidcclxuICAgICAgICAgICAgICAgICAgICB9KSxcclxuICAgICAgICAgICAgICAgICAgICB0ZXh0OiBwYXJ0LmdldEluaXRpYWxzKCksXHJcbiAgICAgICAgICAgICAgICAgICAgb2Zmc2V0WDogMCxcclxuICAgICAgICAgICAgICAgICAgICBvZmZzZXRZOiAwXHJcbiAgICAgICAgICAgICAgICB9KVxyXG4gICAgICAgICAgICB9KSk7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgc3R5bGVzLnB1c2gobmV3IG9sLnN0eWxlLlN0eWxlKHtcclxuICAgICAgICAgICAgICAgIHpJbmRleDogekluZGV4LFxyXG4gICAgICAgICAgICAgICAgaW1hZ2U6IG5ldyBvbC5zdHlsZS5DaXJjbGUoe1xyXG4gICAgICAgICAgICAgICAgICAgIHJhZGl1czogMTcsXHJcbiAgICAgICAgICAgICAgICAgICAgZmlsbDogbmV3IG9sLnN0eWxlLkZpbGwoe1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb2xvcjogXCJyZ2JhKFwiICsgY29sb3JBbHBoYUFycmF5KHBhcnQuY29sb3IsIDAuMzUpLmpvaW4oXCIsXCIpICsgXCIpXCJcclxuICAgICAgICAgICAgICAgICAgICB9KSxcclxuICAgICAgICAgICAgICAgICAgICBzdHJva2U6IG5ldyBvbC5zdHlsZS5TdHJva2Uoe1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb2xvcjogXCJyZ2JhKDI1NSwyNTUsMjU1LDEpXCIsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHdpZHRoOiAzXHJcbiAgICAgICAgICAgICAgICAgICAgfSlcclxuICAgICAgICAgICAgICAgIH0pLFxyXG4gICAgICAgICAgICAgICAgdGV4dDogbmV3IG9sLnN0eWxlLlRleHQoe1xyXG4gICAgICAgICAgICAgICAgICAgIGZvbnQ6ICdub3JtYWwgMTNweCBMYXRvLVJlZ3VsYXInLFxyXG4gICAgICAgICAgICAgICAgICAgIGZpbGw6IG5ldyBvbC5zdHlsZS5GaWxsKHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29sb3I6ICcjMDAwMDAwJ1xyXG4gICAgICAgICAgICAgICAgICAgIH0pLFxyXG4gICAgICAgICAgICAgICAgICAgIHRleHQ6IGFsaWFzKHBhcnQuZ2V0RGV2aWNlSWQoKSksXHJcbiAgICAgICAgICAgICAgICAgICAgb2Zmc2V0WDogMCxcclxuICAgICAgICAgICAgICAgICAgICBvZmZzZXRZOiAyMFxyXG4gICAgICAgICAgICAgICAgfSlcclxuICAgICAgICAgICAgfSkpO1xyXG4gICAgICAgIH1cclxuICAgICAgICAvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcbiAgICAgICAgc3R5bGVzLnB1c2gobmV3IG9sLnN0eWxlLlN0eWxlKHtcclxuICAgICAgICAgICAgekluZGV4OiB6SW5kZXgsXHJcbiAgICAgICAgICAgIGltYWdlOiBuZXcgb2wuc3R5bGUuQ2lyY2xlKHtcclxuICAgICAgICAgICAgICAgIHJhZGl1czogMTcsXHJcbiAgICAgICAgICAgICAgICBmaWxsOiBuZXcgb2wuc3R5bGUuRmlsbCh7XHJcbiAgICAgICAgICAgICAgICAgICAgY29sb3I6IHBhcnQuaXNEaXNjYXJkZWQgfHwgcGFydC5pc1NPUyA/IFwicmdiYSgxOTIsMCwwLFwiICsgKE1hdGguc2luKGFuaW1GcmFtZSkgKiAwLjcgKyAwLjMpICsgXCIpXCIgOiBcInJnYmEoXCIgKyBjb2xvckFscGhhQXJyYXkocGFydC5jb2xvciwgMC44NSkuam9pbihcIixcIikgKyBcIilcIlxyXG4gICAgICAgICAgICAgICAgfSksXHJcbiAgICAgICAgICAgICAgICBzdHJva2U6IG5ldyBvbC5zdHlsZS5TdHJva2Uoe1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbG9yOiBwYXJ0LmlzRGlzY2FyZGVkIHx8IHBhcnQuaXNTT1MgPyBcInJnYmEoMjU1LDAsMCxcIiArICgxLjAgLSAoTWF0aC5zaW4oYW5pbUZyYW1lKSAqIDAuNyArIDAuMykpICsgXCIpXCIgOiBcIiNmZmZmZmZcIixcclxuICAgICAgICAgICAgICAgICAgICB3aWR0aDogM1xyXG4gICAgICAgICAgICAgICAgfSlcclxuICAgICAgICAgICAgfSksXHJcbiAgICAgICAgICAgIHRleHQ6IG5ldyBvbC5zdHlsZS5UZXh0KHtcclxuICAgICAgICAgICAgICAgIGZvbnQ6ICdub3JtYWwgMTNweCBMYXRvLVJlZ3VsYXInLFxyXG4gICAgICAgICAgICAgICAgZmlsbDogbmV3IG9sLnN0eWxlLkZpbGwoe1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbG9yOiAnI0ZGRkZGRidcclxuICAgICAgICAgICAgICAgIH0pLFxyXG4gICAgICAgICAgICAgICAgdGV4dDogcGFydC5nZXRJbml0aWFscygpLFxyXG4gICAgICAgICAgICAgICAgb2Zmc2V0WDogMCxcclxuICAgICAgICAgICAgICAgIG9mZnNldFk6IDBcclxuICAgICAgICAgICAgfSlcclxuICAgICAgICB9KSk7XHJcblxyXG5cclxuICAgICAgICBpZiAoaXNEaXJlY3Rpb24gJiYgcGFydC5nZXRSb3RhdGlvbigpICE9IG51bGwpXHJcbiAgICAgICAge1xyXG4gICAgICAgICAgICBzdHlsZXMucHVzaChuZXcgb2wuc3R5bGUuU3R5bGUoe1xyXG4gICAgICAgICAgICAgICAgekluZGV4OiB6SW5kZXgsXHJcbiAgICAgICAgICAgICAgICBpbWFnZTogbmV3IG9sLnN0eWxlLkljb24oKHtcclxuICAgICAgICAgICAgICAgICAgICBhbmNob3I6IFstMC41LDAuNV0sXHJcbiAgICAgICAgICAgICAgICAgICAgYW5jaG9yWFVuaXRzOiAnZnJhY3Rpb24nLFxyXG4gICAgICAgICAgICAgICAgICAgIGFuY2hvcllVbml0czogJ2ZyYWN0aW9uJyxcclxuICAgICAgICAgICAgICAgICAgICBvcGFjaXR5OiAxLFxyXG4gICAgICAgICAgICAgICAgICAgIHNyYyA6IHJlbmRlckFycm93QmFzZTY0KDQ4LDQ4LHBhcnQuY29sb3IpLFxyXG5cdFx0XHRcdFx0ICBzY2FsZSA6IDAuNTUsXHJcblx0XHRcdFx0XHQgIHJvdGF0aW9uIDogLXBhcnQuZ2V0Um90YXRpb24oKVxyXG5cdFx0XHRcdCAgIH0pKVxyXG5cdFx0XHR9KSk7XHJcblx0XHR9XHJcbiAgICAgICAgXHJcblx0XHQvKnZhciBjb2VmID0gcGFydC50cmFjay5nZXRUcmFja0xlbmd0aEluV0dTODQoKS9wYXJ0LnRyYWNrLmdldFRyYWNrTGVuZ3RoKCk7XHRcdFxyXG5cdFx0dmFyIHJyID0gQ09ORklHLm1hdGguZ3BzSW5hY2N1cmFjeSpjb2VmO1x0XHRcclxuICAgICAgICBzdHlsZXMucHVzaChuZXcgb2wuc3R5bGUuU3R5bGUoe1xyXG4gICAgICAgICAgICB6SW5kZXg6IHpJbmRleCxcclxuICAgICAgICAgICAgaW1hZ2U6IG5ldyBvbC5zdHlsZS5DaXJjbGUoe1xyXG4gICAgICAgICAgICBcdGdlb21ldHJ5OiBuZXcgb2wuZ2VvbS5Qb2ludChwYXJ0LmdldEdQUygpKSxcclxuICAgICAgICAgICAgICAgIHJhZGl1czogMTAsIC8vcnIgKiByZXNvbHV0aW9uLFxyXG4gICAgICAgICAgICAgICAgZmlsbDogbmV3IG9sLnN0eWxlLkZpbGwoe1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbG9yOiBcInJnYmEoMjU1LDI1NSwyNTUsMC44KVwiXHJcbiAgICAgICAgICAgICAgICB9KSxcclxuICAgICAgICAgICAgICAgIHN0cm9rZTogbmV3IG9sLnN0eWxlLlN0cm9rZSh7XHJcbiAgICAgICAgICAgICAgICAgICAgY29sb3I6IFwicmdiYSgwLDAsMCwxKVwiLFxyXG4gICAgICAgICAgICAgICAgICAgIHdpZHRoOiAxXHJcbiAgICAgICAgICAgICAgICB9KVxyXG4gICAgICAgICAgICB9KVxyXG4gICAgICAgIH0pKTsqL1xyXG5cdFx0cmV0dXJuIHN0eWxlcztcclxuXHR9LFxyXG5cclxuXHRcImNhbVwiIDogZnVuY3Rpb24oZmVhdHVyZSwgcmVzb2x1dGlvbikge1xyXG5cdFx0dmFyIHN0eWxlcz1bXTtcclxuXHJcblx0XHR2YXIgY2FtID0gZmVhdHVyZS5jYW07XHJcblxyXG5cdFx0c3R5bGVzLnB1c2gobmV3IG9sLnN0eWxlLlN0eWxlKHtcclxuXHRcdFx0aW1hZ2U6IG5ldyBvbC5zdHlsZS5JY29uKCh7XHJcblx0XHRcdFx0Ly8gVE9ETyBSdW1lbiAtIGl0J3MgYmV0dGVyIGFsbCBpbWFnZXMgdG8gYmUgdGhlIHNhbWUgc2l6ZSwgc28gdGhlIHNhbWUgc2NhbGVcclxuXHRcdFx0XHRzY2FsZSA6IDAuMDQwLFxyXG5cdFx0XHRcdHNyYyA6IENPTkZJRy5hcHBlYXJhbmNlLmltYWdlQ2FtLnNwbGl0KFwiLnN2Z1wiKS5qb2luKChjYW0uc2VxSWQrMSkgKyBcIi5zdmdcIilcclxuXHRcdFx0fSkpXHJcblx0XHR9KSk7XHJcblxyXG5cdFx0cmV0dXJuIHN0eWxlcztcclxuXHR9LFxyXG5cclxuICAgIFwiaG90c3BvdFwiIDogZnVuY3Rpb24oZmVhdHVyZSwgcmVzb2x1dGlvbikge1xyXG4gICAgICAgIHZhciBzdHlsZXM9W107XHJcblxyXG4gICAgICAgIHZhciBob3RzcG90ID0gZmVhdHVyZS5ob3RzcG90O1xyXG5cclxuICAgICAgICBzdHlsZXMucHVzaChuZXcgb2wuc3R5bGUuU3R5bGUoe1xyXG4gICAgICAgICAgICBpbWFnZTogbmV3IG9sLnN0eWxlLkljb24oKHtcclxuICAgICAgICAgICAgICAgIHNjYWxlIDogaG90c3BvdC5nZXRUeXBlKCkuc2NhbGUgfHwgMSxcclxuICAgICAgICAgICAgICAgIHNyYyA6IGhvdHNwb3QuZ2V0VHlwZSgpLmltYWdlXHJcbiAgICAgICAgICAgIH0pKVxyXG4gICAgICAgIH0pKTtcclxuXHJcbiAgICAgICAgcmV0dXJuIHN0eWxlcztcclxuICAgIH0sXHJcblxyXG5cdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0Ly8gUHJpdmF0ZSBtZXRob2RzXHJcblx0Ly8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHJcblx0X3RyYWNrU2VsZWN0ZWQgOiBuZXcgb2wuc3R5bGUuU3R5bGUoe1xyXG5cdFx0c3Ryb2tlOiBuZXcgb2wuc3R5bGUuU3Ryb2tlKHtcclxuXHRcdFx0Y29sb3I6ICcjRkY1MDUwJyxcclxuXHRcdFx0d2lkdGg6IDQuNVxyXG5cdFx0fSlcclxuXHR9KSxcclxuXHJcblx0X2dlbkNoZWNrcG9pbnQgOiBmdW5jdGlvbihnZW9tZXRyeSwgY29sb3IsIHN0eWxlcykge1xyXG5cdFx0dmFyIHN0YXJ0ID0gZ2VvbWV0cnlbMF07XHJcblx0XHR2YXIgZW5kID0gZ2VvbWV0cnlbMV07XHJcblx0XHR2YXIgZHggPSBlbmRbMF0gLSBzdGFydFswXTtcclxuXHRcdHZhciBkeSA9IGVuZFsxXSAtIHN0YXJ0WzFdO1xyXG5cdFx0dmFyIHJvdGF0aW9uID0gTWF0aC5hdGFuMihkeSwgZHgpO1xyXG5cclxuXHRcdHN0eWxlcy5wdXNoKG5ldyBvbC5zdHlsZS5TdHlsZSh7XHJcblx0XHRcdGdlb21ldHJ5OiBuZXcgb2wuZ2VvbS5Qb2ludChzdGFydCksXHJcblx0XHRcdGltYWdlOiBuZXcgb2wuc3R5bGUuSWNvbih7XHJcblx0XHRcdFx0c3JjOiByZW5kZXJCb3hCYXNlNjQoMTYsMTYsY29sb3IpLFxyXG5cdFx0XHRcdHNjYWxlIDogMSxcclxuXHRcdFx0XHRhbmNob3I6IFswLjkyLCAwLjVdLFxyXG5cdFx0XHRcdHJvdGF0ZVdpdGhWaWV3OiB0cnVlLFxyXG5cdFx0XHRcdHJvdGF0aW9uOiAtcm90YXRpb24sXHJcblx0XHRcdFx0b3BhY2l0eSA6IDAuNjVcclxuXHRcdFx0fSlcclxuXHRcdH0pKTtcclxuXHR9LFxyXG5cclxuXHRfZ2VuQ2hlY2twb2ludEltYWdlIDogZnVuY3Rpb24oZ2VvbWV0cnksIGltYWdlLCBzdHlsZXMpIHtcclxuXHRcdHZhciBzdGFydCA9IGdlb21ldHJ5WzBdO1xyXG5cdFx0Ly92YXIgZW5kID0gZ2VvbWV0cnlbMV07XHJcblx0XHQvL3ZhciBkeCA9IGVuZFswXSAtIHN0YXJ0WzBdO1xyXG5cdFx0Ly92YXIgZHkgPSBlbmRbMV0gLSBzdGFydFsxXTtcclxuXHRcdC8vdmFyIHJvdGF0aW9uID0gTWF0aC5hdGFuMihkeSwgZHgpO1xyXG5cclxuXHRcdHN0eWxlcy5wdXNoKG5ldyBvbC5zdHlsZS5TdHlsZSh7XHJcblx0XHRcdGdlb21ldHJ5OiBuZXcgb2wuZ2VvbS5Qb2ludChzdGFydCksXHJcblx0XHRcdGltYWdlOiBuZXcgb2wuc3R5bGUuSWNvbih7XHJcblx0XHRcdFx0c3JjOiBpbWFnZSxcclxuXHRcdFx0XHQvL3NjYWxlIDogMC42NSxcclxuXHRcdFx0XHRhbmNob3I6IFswLjUsIDAuNV0sXHJcblx0XHRcdFx0cm90YXRlV2l0aFZpZXc6IHRydWUsXHJcblx0XHRcdFx0Ly9yb3RhdGlvbjogLXJvdGF0aW9uLFxyXG5cdFx0XHRcdG9wYWNpdHkgOiAxXHJcblx0XHRcdH0pXHJcblx0XHR9KSk7XHJcblx0fSxcclxuXHJcblx0X2dlbkRpcmVjdGlvbiA6IGZ1bmN0aW9uKHB0cywgd3csIHJlc29sdXRpb24sIGNvbG9yLCBzdHlsZXMpIHtcclxuICAgICAgICBpZiAoQ09ORklHLmFwcGVhcmFuY2UuZGlyZWN0aW9uSWNvbkJldHdlZW4gPD0gMCkge1xyXG4gICAgICAgICAgICAvLyB0aGlzIG1lYW5zIG5vIG5lZWQgdG8gc2hvdyB0aGUgZGlyZWN0aW9uc1xyXG4gICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICB2YXIgY250ID0gMDtcclxuICAgICAgICB2YXIgaWNuID0gcmVuZGVyRGlyZWN0aW9uQmFzZTY0KDE2LCAxNiwgY29sb3IpO1xyXG4gICAgICAgIHZhciByZXMgPSAwLjA7XHJcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBwdHMubGVuZ3RoIC0gMTsgaSsrKSB7XHJcbiAgICAgICAgICAgIHZhciBzdGFydCA9IHB0c1tpICsgMV07XHJcbiAgICAgICAgICAgIHZhciBlbmQgPSBwdHNbaV07XHJcbiAgICAgICAgICAgIHZhciBkeCA9IGVuZFswXSAtIHN0YXJ0WzBdO1xyXG4gICAgICAgICAgICB2YXIgZHkgPSBlbmRbMV0gLSBzdGFydFsxXTtcclxuICAgICAgICAgICAgdmFyIGxlbiA9IE1hdGguc3FydChkeCAqIGR4ICsgZHkgKiBkeSkgLyByZXNvbHV0aW9uO1xyXG4gICAgICAgICAgICByZXMgKz0gbGVuO1xyXG4gICAgICAgICAgICBpZiAoaSA9PSAwIHx8IHJlcyA+PSBDT05GSUcuYXBwZWFyYW5jZS5kaXJlY3Rpb25JY29uQmV0d2Vlbikge1xyXG4gICAgICAgICAgICAgICAgcmVzID0gMDtcclxuICAgICAgICAgICAgICAgIHZhciByb3RhdGlvbiA9IE1hdGguYXRhbjIoZHksIGR4KTtcclxuICAgICAgICAgICAgICAgIHN0eWxlcy5wdXNoKG5ldyBvbC5zdHlsZS5TdHlsZSh7XHJcbiAgICAgICAgICAgICAgICAgICAgZ2VvbWV0cnk6IG5ldyBvbC5nZW9tLlBvaW50KFsoc3RhcnRbMF0gKyBlbmRbMF0pIC8gMiwgKHN0YXJ0WzFdICsgZW5kWzFdKSAvIDJdKSxcclxuICAgICAgICAgICAgICAgICAgICBpbWFnZTogbmV3IG9sLnN0eWxlLkljb24oe1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBzcmM6IGljbixcclxuICAgICAgICAgICAgICAgICAgICAgICAgc2NhbGU6IHd3IC8gMTIuMCxcclxuICAgICAgICAgICAgICAgICAgICAgICAgYW5jaG9yOiBbMC41LCAwLjVdLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICByb3RhdGVXaXRoVmlldzogdHJ1ZSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgcm90YXRpb246IC1yb3RhdGlvbiArIE1hdGguUEksIC8vIGFkZCAxODAgZGVncmVlc1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBvcGFjaXR5OiAxXHJcbiAgICAgICAgICAgICAgICAgICAgfSlcclxuICAgICAgICAgICAgICAgIH0pKTtcclxuICAgICAgICAgICAgICAgIGNudCsrO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgfSxcclxuXHJcbiAgICBfZ2VuRGlzdGFuY2VLbSA6IGZ1bmN0aW9uKHd3LCByZXNvbHV0aW9uLFxyXG5cdFx0XHRcdFx0XHRcdCAgY29vcmRzLCBkaXN0YW5jZXMsIHN0YXJ0RGlzdEluZGV4LCBlbmREaXN0SW5kZXgsXHJcblx0XHRcdFx0XHRcdFx0ICBzdHlsZXMpIHtcclxuICAgICAgICAvLyBUT0RPIFJ1bWVuIC0gc3RpbGwgbm90IHJlYWR5IC0gZm9yIG5vdyBzdGF0aWMgaG90c3BvdHMgYXJlIHVzZWRcclxuICAgICAgICBpZiAodHJ1ZSkge3JldHVybjt9XHJcblxyXG4gICAgICAgIHZhciBob3RzcG90c0ttID0gWzIwLCA0MCwgNjAsIDgwLCAxMDAsIDEyMCwgMTQwLCAxNjAsIDE4MF07XHJcblxyXG4gICAgICAgIGZ1bmN0aW9uIGFkZEhvdFNwb3RLTShrbSwgcG9pbnQpIHtcclxuICAgICAgICAgICAgLy92YXIgZHggPSBlbmRbMF0gLSBzdGFydFswXTtcclxuICAgICAgICAgICAgLy92YXIgZHkgPSBlbmRbMV0gLSBzdGFydFsxXTtcclxuICAgICAgICAgICAgLy92YXIgcm90YXRpb24gPSBNYXRoLmF0YW4yKGR5LCBkeCk7XHJcbiAgICAgICAgICAgIHN0eWxlcy5wdXNoKG5ldyBvbC5zdHlsZS5TdHlsZSh7XHJcbiAgICAgICAgICAgICAgICAvL2dlb21ldHJ5OiBuZXcgb2wuZ2VvbS5Qb2ludChbKHN0YXJ0WzBdK2VuZFswXSkvMiwoc3RhcnRbMV0rZW5kWzFdKS8yXSksXHJcbiAgICAgICAgICAgICAgICBnZW9tZXRyeTogbmV3IG9sLmdlb20uUG9pbnQoW3BvaW50WzBdLCBwb2ludFsxXV0pLFxyXG4gICAgICAgICAgICAgICAgaW1hZ2U6IG5ldyBvbC5zdHlsZS5JY29uKHtcclxuICAgICAgICAgICAgICAgICAgICBzcmM6IFwiaW1nL1wiICsga20gKyBcImttLnN2Z1wiLFxyXG4gICAgICAgICAgICAgICAgICAgIHNjYWxlOiAxLjUsXHJcbiAgICAgICAgICAgICAgICAgICAgcm90YXRlV2l0aFZpZXc6IHRydWUsXHJcbiAgICAgICAgICAgICAgICAgICAgLy9yb3RhdGlvbjogLXJvdGF0aW9uICsgTWF0aC5QSS8yLCAvLyBhZGQgMTgwIGRlZ3JlZXNcclxuICAgICAgICAgICAgICAgICAgICBvcGFjaXR5IDogMVxyXG4gICAgICAgICAgICAgICAgfSlcclxuICAgICAgICAgICAgfSkpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgZm9yICh2YXIgaSA9IHN0YXJ0RGlzdEluZGV4OyBpIDwgZW5kRGlzdEluZGV4OyBpKyspIHtcclxuICAgICAgICAgICAgaWYgKCFob3RzcG90c0ttLmxlbmd0aCkge1xyXG5cdFx0XHRcdHJldHVybjtcclxuXHRcdFx0fVxyXG5cclxuXHRcdFx0dmFyIGRpc3QgPSBkaXN0YW5jZXNbaV07XHJcblxyXG5cdFx0XHRpZiAoZGlzdCA+PSBob3RzcG90c0ttWzBdKjEwMDApIHtcclxuXHRcdFx0XHQvLyBkcmF3IHRoZSBmaXJzdCBob3RzcG90IGFuZCBhbnkgbmV4dCBpZiBpdCdzIGNvbnRhaW5lZCBpbiB0aGUgc2FtZSBcImRpc3RhbmNlXCJcclxuXHRcdFx0XHR2YXIgcmVtb3ZlSG90c3BvdEttID0gMDtcclxuXHRcdFx0XHRmb3IgKHZhciBrID0gMCwgbGVuSG90c3BvdHNLbSA9IGhvdHNwb3RzS20ubGVuZ3RoOyBrIDwgbGVuSG90c3BvdHNLbTsgaysrKSB7XHJcblx0XHRcdFx0XHRpZiAoZGlzdCA+PSBob3RzcG90c0ttW2tdKjEwMDApIHtcclxuXHRcdFx0XHRcdFx0YWRkSG90U3BvdEtNKGhvdHNwb3RzS21ba10sIGNvb3Jkc1tpXSk7XHJcblx0XHRcdFx0XHRcdHJlbW92ZUhvdHNwb3RLbSsrO1xyXG5cdFx0XHRcdFx0fSBlbHNlIHtcclxuXHRcdFx0XHRcdFx0YnJlYWs7XHJcblx0XHRcdFx0XHR9XHJcblx0XHRcdFx0fVxyXG5cdFx0XHRcdC8vIHJlbW92ZSBhbGwgdGhlIGFscmVhZHkgZHJhd24gaG90c3BvdHNcclxuXHRcdFx0XHRmb3IgKHZhciBqID0gMDsgaiA8cmVtb3ZlSG90c3BvdEttOyBqKyspIGhvdHNwb3RzS20uc2hpZnQoKTtcclxuXHRcdFx0fVxyXG4gICAgICAgIH1cclxuICAgIH1cclxufTtcclxuXHJcbmZvciAodmFyIGkgaW4gU1RZTEVTKVxyXG5cdGV4cG9ydHNbaV09U1RZTEVTW2ldO1xyXG4iLCJyZXF1aXJlKCdqb29zZScpO1xyXG5yZXF1aXJlKCcuL1BhcnRpY2lwYW50Jyk7XHJcblxyXG52YXIgcmJ1c2ggPSByZXF1aXJlKCdyYnVzaCcpO1xyXG52YXIgQ09ORklHID0gcmVxdWlyZSgnLi9Db25maWcnKTtcclxudmFyIFdHUzg0U1BIRVJFID0gcmVxdWlyZSgnLi9VdGlscycpLldHUzg0U1BIRVJFO1xyXG5cclxuQ2xhc3MoXCJUcmFja1wiLCBcclxue1x0XHJcbiAgICAvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0Ly8gQUxMIENPT1JESU5BVEVTIEFSRSBJTiBXT1JMRCBNRVJDQVRPUlxyXG4gICAgLy8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG4gICAgaGFzOiBcclxuXHR7XHJcbiAgICAgICAgcm91dGUgOiB7XHJcbiAgICAgICAgICAgIGlzOiAgIFwicndcIlxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgZGlzdGFuY2VzIDoge1xyXG4gICAgICAgICAgICBpczogICBcInJ3XCJcclxuICAgICAgICB9LFxyXG4gICAgICAgIGRpc3RhbmNlc0VsYXBzZWQgOiB7XHJcbiAgICAgICAgICAgIGlzOiAgIFwicndcIlxyXG4gICAgICAgIH0sXHJcblx0XHR0b3RhbExlbmd0aCA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCJcclxuXHRcdH0sXHJcblx0XHRwYXJ0aWNpcGFudHMgOiB7XHJcblx0XHRcdGlzOiAgIFwicndcIixcclxuXHRcdFx0aW5pdCA6IFtdXHJcblx0XHR9LFxyXG5cdFx0Y2Ftc0NvdW50IDoge1xyXG5cdFx0XHRpczogICBcInJ3XCIsXHJcblx0XHRcdGluaXQ6IDBcclxuXHRcdH0sXHJcblx0XHQvLyBpbiBFUFNHIDM4NTdcclxuXHRcdGZlYXR1cmUgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogbnVsbFx0XHRcclxuXHRcdH0sXHJcblx0XHRpc0RpcmVjdGlvbkNvbnN0cmFpbnQgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogZmFsc2VcclxuXHRcdH0sXHJcblx0XHRcclxuXHRcdGRlYnVnUGFydGljaXBhbnQgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogbnVsbFxyXG5cdFx0fSxcclxuXHRcdGJpa2VTdGFydEtNIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IG51bGxcclxuXHRcdH0sXHJcblx0XHRydW5TdGFydEtNIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IG51bGxcclxuXHRcdH0sXHJcblx0XHRsYXBzIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IDFcclxuXHRcdH0sXHJcblx0XHR0b3RhbFBhcnRpY2lwYW50cyA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiA1MFxyXG5cdFx0fSxcclxuXHRcdHJUcmVlIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IHJidXNoKDEwKVxyXG5cdFx0fSxcclxuXHJcblx0XHRpc0FkZGVkSG90U3BvdFN3aW1CaWtlIDoge1xyXG5cdFx0XHRpbml0IDogZmFsc2VcclxuXHRcdH0sXHJcblx0XHRpc0FkZGVkSG90U3BvdEJpa2VSdW4gOiB7XHJcblx0XHRcdGluaXQgOiBmYWxzZVxyXG5cdFx0fVxyXG4gICAgfSxcclxuICAgIC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRtZXRob2RzOiBcclxuXHR7XHRcdFxyXG5cdFx0c2V0Um91dGUgOiBmdW5jdGlvbih2YWwpIHtcclxuXHRcdFx0dGhpcy5yb3V0ZT12YWw7XHJcblx0XHRcdGRlbGV0ZSB0aGlzLl9sZW50bXAxO1xyXG5cdFx0XHRkZWxldGUgdGhpcy5fbGVudG1wMjtcclxuXHRcdH0sXHJcblx0XHRcclxuXHRcdGdldEJvdW5kaW5nQm94IDogZnVuY3Rpb24oKSB7XHJcblx0XHRcdHZhciBtaW54PW51bGwsbWlueT1udWxsLG1heHg9bnVsbCxtYXh5PW51bGw7XHJcblx0XHRcdGZvciAodmFyIGk9MDtpPHRoaXMucm91dGUubGVuZ3RoO2krKylcclxuXHRcdFx0e1xyXG5cdFx0XHRcdHZhciBwPXRoaXMucm91dGVbaV07XHJcblx0XHRcdFx0aWYgKG1pbnggPT0gbnVsbCB8fCBwWzBdIDwgbWlueCkgbWlueD1wWzBdO1xyXG5cdFx0XHRcdGlmIChtYXh4ID09IG51bGwgfHwgcFswXSA+IG1heHgpIG1heHg9cFswXTtcclxuXHRcdFx0XHRpZiAobWlueSA9PSBudWxsIHx8IHBbMV0gPCBtaW55KSBtaW55PXBbMV07XHJcblx0XHRcdFx0aWYgKG1heHkgPT0gbnVsbCB8fCBwWzFdID4gbWF4eSkgbWF4eT1wWzFdO1xyXG5cdFx0XHR9XHJcblx0XHRcdHJldHVybiBbbWlueCxtaW55LG1heHgsbWF4eV07XHJcblx0XHR9LFxyXG5cdFx0XHJcblx0XHQvLyBlbGFwc2VkIGZyb20gMC4uMVxyXG5cdFx0Z2V0UG9zaXRpb25BbmRSb3RhdGlvbkZyb21FbGFwc2VkIDogZnVuY3Rpb24oZWxhcHNlZCkge1xyXG5cdFx0XHR2YXIgcnI9bnVsbDtcclxuXHRcdFx0dmFyIGNjID0gdGhpcy5yb3V0ZTtcclxuXHRcdFx0XHJcblx0XHRcdHZhciBsbCA9IHRoaXMuZGlzdGFuY2VzRWxhcHNlZC5sZW5ndGgtMTtcclxuXHRcdFx0dmFyIHNpID0gMDtcclxuXHJcblx0XHRcdC8vIFRPRE8gRklYIE1FIFxyXG5cdFx0XHR3aGlsZSAoc2kgPCBsbCAmJiBzaSs1MDAgPCBsbCAmJiB0aGlzLmRpc3RhbmNlc0VsYXBzZWRbc2krNTAwXSA8IGVsYXBzZWQgKSB7XHJcblx0XHRcdFx0c2krPTUwMDtcclxuXHRcdFx0fVxyXG5cdFx0XHRcclxuXHRcdFx0d2hpbGUgKHNpIDwgbGwgJiYgc2krMjUwIDwgbGwgJiYgdGhpcy5kaXN0YW5jZXNFbGFwc2VkW3NpKzI1MF0gPCBlbGFwc2VkICkge1xyXG5cdFx0XHRcdHNpKz0yNTA7XHJcblx0XHRcdH1cclxuXHRcdFx0XHJcblx0XHRcdHdoaWxlIChzaSA8IGxsICYmIHNpKzEyNSA8IGxsICYmIHRoaXMuZGlzdGFuY2VzRWxhcHNlZFtzaSsxMjVdIDwgZWxhcHNlZCApIHtcclxuXHRcdFx0XHRzaSs9MTI1O1xyXG5cdFx0XHR9XHJcblxyXG5cdFx0XHR3aGlsZSAoc2kgPCBsbCAmJiBzaSs1MCA8IGxsICYmIHRoaXMuZGlzdGFuY2VzRWxhcHNlZFtzaSs1MF0gPCBlbGFwc2VkICkge1xyXG5cdFx0XHRcdHNpKz01MDtcclxuXHRcdFx0fVxyXG5cdFx0XHRcclxuXHRcdFx0Zm9yICh2YXIgaT1zaTtpPGxsO2krKykgXHJcblx0XHRcdHtcclxuXHRcdFx0XHQvKmRvIFxyXG5cdFx0XHRcdHtcclxuXHRcdFx0XHRcdHZhciBtID0gKChjYy5sZW5ndGgtMStpKSA+PiAxKTtcclxuXHRcdFx0XHRcdGlmIChtLWkgPiA1ICYmIGVsYXBzZWQgPCB0aGlzLmRpc3RhbmNlc0VsYXBzZWRbbV0pIHtcclxuXHRcdFx0XHRcdFx0aT1tO1xyXG5cdFx0XHRcdFx0XHRjb250aW51ZTtcclxuXHRcdFx0XHRcdH1cclxuXHRcdFx0XHRcdGJyZWFrO1xyXG5cdFx0XHRcdH0gd2hpbGUgKHRydWUpOyovXHJcblx0XHRcdFx0aWYgKGVsYXBzZWQgPj0gdGhpcy5kaXN0YW5jZXNFbGFwc2VkW2ldICYmIGVsYXBzZWQgPD0gdGhpcy5kaXN0YW5jZXNFbGFwc2VkW2krMV0pIFxyXG5cdFx0XHRcdHtcclxuXHRcdFx0XHRcdGVsYXBzZWQtPXRoaXMuZGlzdGFuY2VzRWxhcHNlZFtpXTtcclxuXHRcdFx0XHRcdHZhciBhYz10aGlzLmRpc3RhbmNlc0VsYXBzZWRbaSsxXS10aGlzLmRpc3RhbmNlc0VsYXBzZWRbaV07XHJcblx0XHRcdFx0XHR2YXIgYSA9IGNjW2ldO1xyXG5cdFx0XHRcdFx0dmFyIGMgPSBjY1tpKzFdO1xyXG5cdFx0XHRcdFx0dmFyIGR4ID0gY1swXSAtIGFbMF07XHJcblx0XHRcdFx0XHR2YXIgZHkgPSBjWzFdIC0gYVsxXTtcclxuXHRcdFx0XHRcdHJyPVsgYVswXSsoY1swXS1hWzBdKSplbGFwc2VkL2FjLGFbMV0rKGNbMV0tYVsxXSkqZWxhcHNlZC9hYyxNYXRoLmF0YW4yKGR5LCBkeCldO1xyXG5cdFx0XHRcdFx0YnJlYWs7XHJcblx0XHRcdFx0fVxyXG5cdFx0XHR9XHJcblx0XHRcdHJldHVybiBycjtcclxuXHRcdH0sXHJcblx0XHRcclxuXHRcdF9fZ2V0UG9zaXRpb25BbmRSb3RhdGlvbkZyb21FbGFwc2VkIDogZnVuY3Rpb24oZWxhcHNlZCkge1xyXG5cdFx0XHRlbGFwc2VkKj10aGlzLmdldFRyYWNrTGVuZ3RoKCk7XHJcblx0XHRcdHZhciBycj1udWxsO1xyXG5cdFx0XHR2YXIgY2MgPSB0aGlzLnJvdXRlO1xyXG5cdFx0XHRmb3IgKHZhciBpPTA7aTxjYy5sZW5ndGgtMTtpKyspIFxyXG5cdFx0XHR7XHJcblx0XHRcdFx0dmFyIGEgPSBjY1tpXTtcclxuXHRcdFx0XHR2YXIgYyA9IGNjW2krMV07XHJcblx0XHRcdFx0dmFyIGFjID0gV0dTODRTUEhFUkUuaGF2ZXJzaW5lRGlzdGFuY2UoYSxjKTtcclxuXHRcdFx0XHRpZiAoZWxhcHNlZCA8PSBhYykge1xyXG5cdFx0XHRcdFx0dmFyIGR4ID0gY1swXSAtIGFbMF07XHJcblx0XHRcdFx0XHR2YXIgZHkgPSBjWzFdIC0gYVsxXTtcclxuXHRcdFx0XHRcdHJyPVsgYVswXSsoY1swXS1hWzBdKSplbGFwc2VkL2FjLGFbMV0rKGNbMV0tYVsxXSkqZWxhcHNlZC9hYyxNYXRoLmF0YW4yKGR5LCBkeCldO1xyXG5cdFx0XHRcdFx0YnJlYWs7XHJcblx0XHRcdFx0fVxyXG5cdFx0XHRcdGVsYXBzZWQtPWFjO1xyXG5cdFx0XHR9XHJcblx0XHRcdHJldHVybiBycjtcclxuXHRcdH0sXHJcblxyXG5cdFx0XHJcblx0XHRnZXRUcmFja0xlbmd0aCA6IGZ1bmN0aW9uKCkge1xyXG5cdFx0XHRpZiAodGhpcy5fbGVudG1wMSlcclxuXHRcdFx0XHRyZXR1cm4gdGhpcy5fbGVudG1wMTtcclxuXHRcdFx0dmFyIHJlcz0wLjA7XHJcblx0XHRcdHZhciBjYyA9IHRoaXMucm91dGU7XHJcblx0XHRcdGZvciAodmFyIGk9MDtpPGNjLmxlbmd0aC0xO2krKykgXHJcblx0XHRcdHtcclxuXHRcdFx0XHR2YXIgYSA9IGNjW2ldO1xyXG5cdFx0XHRcdHZhciBiID0gY2NbaSsxXTtcclxuXHRcdFx0XHR2YXIgZCA9IFdHUzg0U1BIRVJFLmhhdmVyc2luZURpc3RhbmNlKGEsYik7XHJcblx0XHRcdFx0aWYgKCFpc05hTihkKSAmJiBkID4gMCkgXHJcblx0XHRcdFx0XHRyZXMrPWQ7XHJcblx0XHRcdH1cclxuXHRcdFx0dGhpcy5fbGVudG1wMT1yZXM7XHJcblx0XHRcdHJldHVybiByZXM7XHJcblx0XHR9LFxyXG5cclxuXHRcdGdldFRyYWNrTGVuZ3RoSW5XR1M4NCA6IGZ1bmN0aW9uKCkge1xyXG5cdFx0XHRpZiAodGhpcy5fbGVudG1wMilcclxuXHRcdFx0XHRyZXR1cm4gdGhpcy5fbGVudG1wMjtcclxuXHRcdFx0dmFyIHJlcz0wLjA7XHJcblx0XHRcdHZhciBjYyA9IHRoaXMucm91dGU7XHJcblx0XHRcdGZvciAodmFyIGk9MDtpPGNjLmxlbmd0aC0xO2krKykgXHJcblx0XHRcdHtcclxuXHRcdFx0XHR2YXIgYSA9IGNjW2ldO1xyXG5cdFx0XHRcdHZhciBiID0gY2NbaSsxXTtcclxuXHRcdFx0XHR2YXIgZCA9IE1hdGguc3FydCgoYVswXS1iWzBdKSooYVswXS1iWzBdKSsoYVsxXS1iWzFdKSooYVsxXS1iWzFdKSk7XHJcblx0XHRcdFx0aWYgKCFpc05hTihkKSAmJiBkID4gMCkgXHJcblx0XHRcdFx0XHRyZXMrPWQ7XHJcblx0XHRcdH1cclxuXHRcdFx0dGhpcy5fbGVudG1wMj1yZXM7XHJcblx0XHRcdHJldHVybiByZXM7XHJcblx0XHR9LFxyXG5cclxuXHRcdGdldENlbnRlciA6IGZ1bmN0aW9uKCkge1xyXG5cdFx0XHR2YXIgYmIgPSB0aGlzLmdldEJvdW5kaW5nQm94KCk7XHJcblx0XHRcdHJldHVybiBbKGJiWzBdK2JiWzJdKS8yLjAsKGJiWzFdK2JiWzNdKS8yLjBdO1xyXG5cdFx0fSxcclxuXHRcdFxyXG5cdFx0aW5pdCA6IGZ1bmN0aW9uKCkgXHJcblx0XHR7XHJcblx0XHRcdGlmICghdGhpcy5yb3V0ZSlcclxuXHRcdFx0XHRyZXR1cm47XHJcblx0XHRcdC8vIDEpIGNhbGN1bGF0ZSB0b3RhbCByb3V0ZSBsZW5ndGggaW4gS00gXHJcblx0XHRcdHRoaXMudXBkYXRlRmVhdHVyZSgpO1xyXG5cdFx0XHRpZiAodHlwZW9mIHdpbmRvdyAhPSBcInVuZGVmaW5lZFwiKSBcclxuXHRcdFx0e1xyXG5cdFx0XHRcdGlmICghR1VJLmdldElzU2tpcEV4dGVudCB8fCAhR1VJLmdldElzU2tpcEV4dGVudCgpKSB7XHJcblx0XHRcdFx0XHRpZiAodGhpcy5mZWF0dXJlKSB7XHJcblx0XHRcdFx0XHRcdEdVSS5tYXAuZ2V0VmlldygpLmZpdEV4dGVudCh0aGlzLmZlYXR1cmUuZ2V0R2VvbWV0cnkoKS5nZXRFeHRlbnQoKSwgR1VJLm1hcC5nZXRTaXplKCkpO1xyXG5cdFx0XHRcdFx0XHRjb25zb2xlLmxvZyhcIkN1cnJlbnQgZXh0ZW50IDogXCIgKyBKU09OLnN0cmluZ2lmeSh0aGlzLmZlYXR1cmUuZ2V0R2VvbWV0cnkoKS5nZXRFeHRlbnQoKSkpO1xyXG5cdFx0XHRcdFx0fSBlbHNlIHtcclxuXHRcdFx0XHRcdFx0R1VJLm1hcC5nZXRWaWV3KCkuZml0RXh0ZW50KFsxMjM0NTkyLjM2MzczNDU1NjgsIDYyODI3MDYuODg5Njc2NDM1LCAxMjY0MzQ4LjQ2NDM3Mzc2NiwgNjMyNTY5NC43NDMxNjQ3MjVdLCBHVUkubWFwLmdldFNpemUoKSk7XHJcblx0XHRcdFx0XHR9XHJcblx0XHRcdFx0fVxyXG5cdFx0XHR9XHJcblx0XHR9LFxyXG5cdFx0XHJcblx0XHRnZXRUcmFja1BhcnQgOiBmdW5jdGlvbihlbGFwc2VkKSB7XHJcblx0XHRcdHZhciBsZW4gPSB0aGlzLmdldFRyYWNrTGVuZ3RoKCk7XHJcblx0XHRcdHZhciBlbSA9IChlbGFwc2VkJTEuMCkqbGVuO1xyXG5cdFx0XHRpZiAoZW0gPj0gdGhpcy5ydW5TdGFydEtNKjEwMDApIFxyXG5cdFx0XHRcdHJldHVybiAyO1xyXG5cdFx0XHRpZiAoZW0gPj0gdGhpcy5iaWtlU3RhcnRLTSoxMDAwKSBcclxuXHRcdFx0XHRyZXR1cm4gMTtcclxuXHRcdFx0cmV0dXJuIDA7XHJcblx0XHR9LFxyXG5cdFx0XHJcblx0XHR1cGRhdGVGZWF0dXJlIDogZnVuY3Rpb24oKSBcclxuXHRcdHtcclxuXHRcdFx0dGhpcy5kaXN0YW5jZXM9W107XHJcblx0XHRcdHZhciByZXM9MC4wO1xyXG5cdFx0XHR2YXIgY2MgPSB0aGlzLnJvdXRlO1xyXG5cdFx0XHRmb3IgKHZhciBpPTA7aTxjYy5sZW5ndGgtMTtpKyspIFxyXG5cdFx0XHR7XHJcblx0XHRcdFx0dmFyIGEgPSBjY1tpXTtcclxuXHRcdFx0XHR2YXIgYiA9IGNjW2krMV07XHJcblx0XHRcdFx0dmFyIGQgPSBXR1M4NFNQSEVSRS5oYXZlcnNpbmVEaXN0YW5jZShhLGIpO1xyXG5cdFx0XHRcdHRoaXMuZGlzdGFuY2VzLnB1c2gocmVzKTtcclxuXHRcdFx0XHRpZiAoIWlzTmFOKGQpICYmIGQgPiAwKSBcclxuXHRcdFx0XHRcdHJlcys9ZDtcclxuXHRcdFx0fVxyXG5cdFx0XHR0aGlzLmRpc3RhbmNlcy5wdXNoKHJlcyk7XHJcblx0XHRcdHRoaXMuZGlzdGFuY2VzRWxhcHNlZD1bXTtcclxuXHRcdFx0dmFyIHRsID0gdGhpcy5nZXRUcmFja0xlbmd0aCgpO1xyXG5cdFx0XHRmb3IgKHZhciBpPTA7aTxjYy5sZW5ndGg7aSsrKSB7XHJcblx0XHRcdFx0dGhpcy5kaXN0YW5jZXNFbGFwc2VkLnB1c2godGhpcy5kaXN0YW5jZXNbaV0vdGwpO1xyXG5cdFx0XHR9XHJcblx0XHRcdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRcdFx0dGhpcy5yVHJlZS5jbGVhcigpO1xyXG5cdFx0XHR2YXIgYXJyID0gW107XHJcblx0XHRcdGZvciAodmFyIGk9MDtpPHRoaXMucm91dGUubGVuZ3RoLTE7aSsrKSBcclxuXHRcdFx0e1xyXG5cdFx0XHRcdHZhciB4MSA9IHRoaXMucm91dGVbaV1bMF07XHJcblx0XHRcdFx0dmFyIHkxID0gdGhpcy5yb3V0ZVtpXVsxXTtcclxuXHRcdFx0XHR2YXIgeDIgPSB0aGlzLnJvdXRlW2krMV1bMF07XHJcblx0XHRcdFx0dmFyIHkyID0gdGhpcy5yb3V0ZVtpKzFdWzFdO1xyXG5cdFx0XHRcdHZhciBtaW54ID0geDEgPCB4MiA/IHgxIDogeDI7XHJcblx0XHRcdFx0dmFyIG1pbnkgPSB5MSA8IHkyID8geTEgOiB5MjtcclxuXHRcdFx0XHR2YXIgbWF4eCA9IHgxID4geDIgPyB4MSA6IHgyO1xyXG5cdFx0XHRcdHZhciBtYXh5ID0geTEgPiB5MiA/IHkxIDogeTI7XHJcblx0XHRcdFx0YXJyLnB1c2goW21pbngsbWlueSxtYXh4LG1heHkseyBpbmRleCA6IGkgfV0pO1xyXG5cdFx0XHR9XHJcblx0XHRcdHRoaXMuclRyZWUubG9hZChhcnIpO1xyXG5cdFx0XHQvLy0tLS0tLS0tLS0tLS0tLS0tIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdFx0XHRpZiAodHlwZW9mIHdpbmRvdyAhPSBcInVuZGVmaW5lZFwiICYmIHRoaXMucm91dGUgJiYgdGhpcy5yb3V0ZS5sZW5ndGgpIFxyXG5cdFx0XHR7XHJcblx0XHRcdFx0dmFyIHdrdCA9IFtdO1xyXG5cdFx0XHRcdGZvciAodmFyIGk9MDtpPHRoaXMucm91dGUubGVuZ3RoO2krKykge1xyXG5cdFx0XHRcdFx0d2t0LnB1c2godGhpcy5yb3V0ZVtpXVswXStcIiBcIit0aGlzLnJvdXRlW2ldWzFdKTtcclxuXHRcdFx0XHR9XHJcblx0XHRcdFx0d2t0PVwiTElORVNUUklORyhcIit3a3Quam9pbihcIixcIikrXCIpXCI7XHJcblx0XHRcdFx0dmFyIGZvcm1hdCA9IG5ldyBvbC5mb3JtYXQuV0tUKCk7XHJcblx0XHRcdFx0aWYgKCF0aGlzLmZlYXR1cmUpIHtcclxuXHRcdFx0XHRcdHRoaXMuZmVhdHVyZSA9IGZvcm1hdC5yZWFkRmVhdHVyZSh3a3QpO1xyXG5cdFx0XHRcdH0gZWxzZSB7XHJcblx0XHRcdFx0XHR0aGlzLmZlYXR1cmUuc2V0R2VvbWV0cnkoZm9ybWF0LnJlYWRGZWF0dXJlKHdrdCkuZ2V0R2VvbWV0cnkoKSk7XHJcblx0XHRcdFx0fVxyXG5cdFx0XHRcdHRoaXMuZmVhdHVyZS50cmFjaz10aGlzO1xyXG5cdFx0XHRcdHRoaXMuZmVhdHVyZS5nZXRHZW9tZXRyeSgpLnRyYW5zZm9ybSgnRVBTRzo0MzI2JywgJ0VQU0c6Mzg1NycpO1x0XHRcdFx0XHRcdFxyXG5cdFx0XHRcdC8vY29uc29sZS5sb2coXCJGRUFUVVJFIFRSQUNLIDogXCIrdGhpcy5mZWF0dXJlLnRyYWNrKTtcclxuXHRcdFx0fSBlbHNlIHtcclxuXHRcdFx0XHRkZWxldGUgdGhpcy5mZWF0dXJlO1xyXG5cdFx0XHR9XHJcblx0XHR9LFxyXG5cclxuXHRcdGdldFJlYWxQYXJ0aWNpcGFudHNDb3VudCA6IGZ1bmN0aW9uKCkge1xyXG5cdFx0XHRyZXR1cm4gdGhpcy5wYXJ0aWNpcGFudHMubGVuZ3RoIC0gdGhpcy5jYW1zQ291bnQ7XHJcblx0XHR9LFxyXG5cclxuXHRcdGdldFBhcnRpY2lwYW50QnlJZCA6IGZ1bmN0aW9uKGlkKSB7XHJcblx0XHRcdC8vIFRPRE8gUnVtZW4gLSBpdCB3b3VsZCBiZSBnb29kIHRvIGhvbGQgYSBtYXAgb2YgdGhlIHR5cGUgaWQgLT4gUGFydGljaXBhbnRcclxuXHRcdFx0aWYgKHRoaXMucGFydGljaXBhbnRzKSB7XHJcblx0XHRcdFx0Zm9yICh2YXIgaSA9IDAsIGxlbiA9IHRoaXMucGFydGljaXBhbnRzLmxlbmd0aDsgaSA8IGxlbjsgaSsrKSB7XHJcblx0XHRcdFx0XHQgaWYgKHRoaXMucGFydGljaXBhbnRzW2ldLmlkID09PSBpZCkge1xyXG5cdFx0XHRcdFx0XHQgcmV0dXJuIHRoaXMucGFydGljaXBhbnRzW2ldO1xyXG5cdFx0XHRcdFx0IH1cclxuXHRcdFx0XHR9XHJcblx0XHRcdH1cclxuXHRcdFx0cmV0dXJuIG51bGw7XHJcblx0XHR9LFxyXG5cdFx0XHJcblx0XHRuZXdQYXJ0aWNpcGFudCA6IGZ1bmN0aW9uKGlkLGRldmljZUlkLG5hbWUpXHJcblx0XHR7XHJcblx0XHRcdHZhciBwYXJ0ID0gbmV3IFBhcnRpY2lwYW50KHtpZDppZCxkZXZpY2VJZDpkZXZpY2VJZCxjb2RlOm5hbWV9KTtcclxuXHRcdFx0cGFydC5pbml0KHRoaXMucm91dGVbMF0sdGhpcyk7XHJcblx0XHRcdHBhcnQuc2V0U2VxSWQodGhpcy5wYXJ0aWNpcGFudHMubGVuZ3RoKTtcclxuXHRcdFx0dGhpcy5wYXJ0aWNpcGFudHMucHVzaChwYXJ0KTtcclxuXHRcdFx0cmV0dXJuIHBhcnQ7XHJcblx0XHR9LFxyXG5cclxuXHRcdG5ld01vdmluZ0NhbSA6IGZ1bmN0aW9uKGlkLGRldmljZUlkLG5hbWUpXHJcblx0XHR7XHJcblx0XHRcdHZhciBjYW0gPSBuZXcgTW92aW5nQ2FtKHtpZDppZCxkZXZpY2VJZDpkZXZpY2VJZCxjb2RlOm5hbWV9KTtcclxuXHRcdFx0Y2FtLmluaXQodGhpcy5yb3V0ZVswXSx0aGlzKTtcclxuXHRcdFx0Y2FtLnNldFNlcUlkKHRoaXMuY2Ftc0NvdW50KTtcclxuXHRcdFx0dGhpcy5jYW1zQ291bnQrKztcclxuXHRcdFx0Y2FtLl9fc2tpcFRyYWNraW5nUG9zPXRydWU7XHJcblx0XHRcdHRoaXMucGFydGljaXBhbnRzLnB1c2goY2FtKTtcclxuXHRcdFx0cmV0dXJuIGNhbTtcclxuXHRcdH0sXHJcblxyXG5cdFx0bmV3SG90U3BvdHMgOiBmdW5jdGlvbihob3RzcG90cykge1xyXG5cdFx0XHRpZiAoIWhvdHNwb3RzIHx8ICFob3RzcG90cy5sZW5ndGgpIHtcclxuXHRcdFx0XHRyZXR1cm47XHJcblx0XHRcdH1cclxuXHJcblx0XHRcdC8vIFRPRE8gUnVtZW4gLSB0aGlzIGlzIENPUFktUEFTVEUgY29kZSBmb3JtIHRoZSBTdHlsZXNcclxuXHRcdFx0Ly8gc28gbGF0ZXIgaXQgaGFzIHRvIGJlIGluIG9ubHkgb25lIHBsYWNlIC0gZ2V0dGluZyB0aGUgZ2VvbWV0cmllcyBmb3IgZWFjaCB0eXBlIGRpc3RhbmNlXHJcblx0XHRcdC8vIG1heWJlIGluIHRoZSBzYW1lIHBsYWNlIGRpc3RhbmNlcyBhcmUgY2FsY3VsYXRlZC5cclxuXHRcdFx0Ly8gVEhJUyBJUyBURU1QT1JBUlkgUEFUQ0ggdG8gZ2V0IHRoZSBuZWVkZWQgcG9pbnRzXHJcblx0XHRcdGlmICghaXNOYU4odGhpcy5iaWtlU3RhcnRLTSkpIHtcclxuXHRcdFx0XHRmb3IgKHZhciBpPTA7aTx0aGlzLmRpc3RhbmNlcy5sZW5ndGg7aSsrKSB7XHJcblx0XHRcdFx0XHRpZiAodGhpcy5kaXN0YW5jZXNbaV0gPj0gdGhpcy5iaWtlU3RhcnRLTSoxMDAwKVxyXG5cdFx0XHRcdFx0XHRicmVhaztcclxuXHRcdFx0XHR9XHJcblx0XHRcdFx0dmFyIGo7XHJcblx0XHRcdFx0aWYgKCFpc05hTih0aGlzLnJ1blN0YXJ0S00pKSB7XHJcblx0XHRcdFx0XHRmb3IgKGo9aTtqPHRoaXMuZGlzdGFuY2VzLmxlbmd0aDtqKyspIHtcclxuXHRcdFx0XHRcdFx0aWYgKHRoaXMuZGlzdGFuY2VzW2pdID49IHRoaXMucnVuU3RhcnRLTSoxMDAwKVxyXG5cdFx0XHRcdFx0XHRcdGJyZWFrO1xyXG5cdFx0XHRcdFx0fVxyXG5cdFx0XHRcdH0gZWxzZSB7XHJcblx0XHRcdFx0XHRqPXRoaXMuZGlzdGFuY2VzLmxlbmd0aDtcclxuXHRcdFx0XHR9XHJcblx0XHRcdFx0dmFyIGNvb3Jkcz10aGlzLmZlYXR1cmUuZ2V0R2VvbWV0cnkoKS5nZXRDb29yZGluYXRlcygpO1xyXG5cdFx0XHRcdHZhciBnZW9tc3dpbT1jb29yZHMuc2xpY2UoMCxpKTtcclxuXHRcdFx0XHR2YXIgZ2VvbWJpa2U9Y29vcmRzLnNsaWNlKGkgPCAxID8gaSA6IGktMSxqKTtcclxuXHRcdFx0XHRpZiAoaiA8IHRoaXMuZGlzdGFuY2VzLmxlbmd0aClcclxuXHRcdFx0XHRcdHZhciBnZW9tcnVuPWNvb3Jkcy5zbGljZShqIDwgMSA/IGogOiBqLTEsdGhpcy5kaXN0YW5jZXMubGVuZ3RoKTtcclxuXHRcdFx0XHRpZiAoIWdlb21zd2ltLmxlbmd0aClcclxuXHRcdFx0XHRcdGdlb21zd2ltPW51bGw7XHJcblx0XHRcdFx0aWYgKCFnZW9tYmlrZS5sZW5ndGgpXHJcblx0XHRcdFx0XHRnZW9tYmlrZT1udWxsO1xyXG5cdFx0XHRcdGlmICghZ2VvbXJ1bi5sZW5ndGgpXHJcblx0XHRcdFx0XHRnZW9tcnVuPW51bGw7XHJcblx0XHRcdH1cclxuXHJcblx0XHRcdGZvciAodmFyIGkgPSAwLCBsZW4gPSBob3RzcG90cy5sZW5ndGg7IGkgPCBsZW47IGkrKykge1xyXG5cdFx0XHRcdHZhciBob3RzcG90ID0gaG90c3BvdHNbaV07XHJcblx0XHRcdFx0dmFyIHBvaW50O1xyXG5cdFx0XHRcdGlmIChob3RzcG90LnR5cGUgPT09IENPTkZJRy5ob3RzcG90LmNhbVN3aW1CaWtlKSB7XHJcblx0XHRcdFx0XHRpZiAodGhpcy5pc0FkZGVkSG90U3BvdFN3aW1CaWtlKSBjb250aW51ZTsgLy8gbm90IGFsbG93ZWQgdG8gYWRkIHRvIHNhbWUgaG90c3BvdHNcclxuXHRcdFx0XHRcdGlmIChnZW9tYmlrZSkge1xyXG5cdFx0XHRcdFx0XHRwb2ludCA9IG9sLnByb2oudHJhbnNmb3JtKGdlb21iaWtlWzBdLCAnRVBTRzozODU3JywgJ0VQU0c6NDMyNicpO1xyXG5cdFx0XHRcdFx0XHR0aGlzLmlzQWRkZWRIb3RTcG90U3dpbUJpa2UgPSB0cnVlO1xyXG5cdFx0XHRcdFx0fVxyXG5cdFx0XHRcdH0gZWxzZSBpZiAoaG90c3BvdC50eXBlID09PSBDT05GSUcuaG90c3BvdC5jYW1CaWtlUnVuKSB7XHJcblx0XHRcdFx0XHRpZiAodGhpcy5pc0FkZGVkSG90U3BvdEJpa2VSdW4pIGNvbnRpbnVlOyAvLyBub3QgYWxsb3dlZCB0byBhZGQgdG8gc2FtZSBob3RzcG90c1xyXG5cdFx0XHRcdFx0aWYgKGdlb21ydW4pIHtcclxuXHRcdFx0XHRcdFx0cG9pbnQgPSBvbC5wcm9qLnRyYW5zZm9ybShnZW9tcnVuWzBdLCAnRVBTRzozODU3JywgJ0VQU0c6NDMyNicpO1xyXG5cdFx0XHRcdFx0XHR0aGlzLmlzQWRkZWRIb3RTcG90QmlrZVJ1biA9IHRydWU7XHJcblx0XHRcdFx0XHR9XHJcblx0XHRcdFx0fVxyXG5cdFx0XHRcdGlmIChwb2ludClcclxuXHRcdFx0XHRcdGhvdHNwb3QuaW5pdChwb2ludCk7XHJcblx0XHRcdH1cclxuXHRcdH0sXHJcblx0XHRcclxuXHRcdG9uTWFwQ2xpY2sgOiBmdW5jdGlvbihldmVudCkgXHJcblx0XHR7XHJcblx0XHRcdGlmICh0aGlzLmRlYnVnUGFydGljaXBhbnQpIFxyXG5cdFx0XHR7XHJcblx0XHRcdFx0dGhpcy5kZWJ1Z1BhcnRpY2lwYW50Lm9uRGVidWdDbGljayhldmVudCk7XHJcblx0XHRcdH1cclxuXHRcdH0sXHJcblx0XHRcclxuXHRcdHRlc3QxIDogZnVuY3Rpb24oKSB7XHJcblx0XHRcdC8qY29uc29sZS5sb2coXCIjQkVHSU5OTk5OTk5OTk5OTk5OTk5OTk5OTk5OTk5OTk5OTk5OTk5OTk5cIilcclxuXHRcdFx0Zm9yICh2YXIgaT0wO2k8MzA7aSsrKSBcclxuXHRcdFx0e1xyXG5cdFx0XHRcdHZhciBlbGFwc2VkID0gaS82MC4wOyAgLy8oKHRtIC0gc3RpbWUpLzEwMDAuMCkvdHJhY2tJblNlY29uZHMgKyBDb25maWcuc2ltdWxhdGlvbi5zdGFydEVsYXBzZWQ7XHJcblx0XHRcdFx0aWYgKGVsYXBzZWQgPiAxKVxyXG5cdFx0XHRcdFx0ZWxhcHNlZD0xO1xyXG5cdFx0XHRcdC8vdmFyIHBvcyA9IHRyYWNrLmdldFBvc2l0aW9uQW5kUm90YXRpb25Gcm9tRWxhcHNlZChlbGFwc2VkKTtcclxuXHRcdFx0XHR2YXIgcG9zID0gdGhpcy5fX2dldFBvc2l0aW9uQW5kUm90YXRpb25Gcm9tRWxhcHNlZChlbGFwc2VkKTtcclxuXHRcdFx0XHRjb25zb2xlLmxvZyhbTWF0aC5yb3VuZChwb3NbMF0qMTAwMDAwMC4wKS8xMDAwMDAwLjAsTWF0aC5yb3VuZChwb3NbMV0qMTAwMDAwMC4wKS8xMDAwMDAwLjBdKTtcclxuXHRcdFx0fVxyXG5cdFx0XHRjb25zb2xlLmxvZyhcIiNFTkRcIik7Ki9cclxuXHRcdH1cclxuXHJcbiAgICB9XHJcbn0pOyIsInZhciB0b1JhZGlhbnMgPSBmdW5jdGlvbihhbmdsZURlZ3JlZXMpIHsgcmV0dXJuIGFuZ2xlRGVncmVlcyAqIE1hdGguUEkgLyAxODA7IH07XHJcbnZhciB0b0RlZ3JlZXMgPSBmdW5jdGlvbihhbmdsZVJhZGlhbnMpIHsgcmV0dXJuIGFuZ2xlUmFkaWFucyAqIDE4MCAvIE1hdGguUEk7IH07XHJcblxyXG52YXIgV0dTODRTcGhlcmUgPSBmdW5jdGlvbihyYWRpdXMpIHtcclxuICB0aGlzLnJhZGl1cyA9IHJhZGl1cztcclxufTtcclxuXHJcbldHUzg0U3BoZXJlLnByb3RvdHlwZS5jb3NpbmVEaXN0YW5jZSA9IGZ1bmN0aW9uKGMxLCBjMikge1xyXG4gIHZhciBsYXQxID0gdG9SYWRpYW5zKGMxWzFdKTtcclxuICB2YXIgbGF0MiA9IHRvUmFkaWFucyhjMlsxXSk7XHJcbiAgdmFyIGRlbHRhTG9uID0gdG9SYWRpYW5zKGMyWzBdIC0gYzFbMF0pO1xyXG4gIHJldHVybiB0aGlzLnJhZGl1cyAqIE1hdGguYWNvcyhcclxuICAgICAgTWF0aC5zaW4obGF0MSkgKiBNYXRoLnNpbihsYXQyKSArXHJcbiAgICAgIE1hdGguY29zKGxhdDEpICogTWF0aC5jb3MobGF0MikgKiBNYXRoLmNvcyhkZWx0YUxvbikpO1xyXG59O1xyXG5cclxuV0dTODRTcGhlcmUucHJvdG90eXBlLmdlb2Rlc2ljQXJlYSA9IGZ1bmN0aW9uKGNvb3JkaW5hdGVzKSB7XHJcbiAgdmFyIGFyZWEgPSAwLCBsZW4gPSBjb29yZGluYXRlcy5sZW5ndGg7XHJcbiAgdmFyIHgxID0gY29vcmRpbmF0ZXNbbGVuIC0gMV1bMF07XHJcbiAgdmFyIHkxID0gY29vcmRpbmF0ZXNbbGVuIC0gMV1bMV07XHJcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW47IGkrKykge1xyXG4gICAgdmFyIHgyID0gY29vcmRpbmF0ZXNbaV1bMF0sIHkyID0gY29vcmRpbmF0ZXNbaV1bMV07XHJcbiAgICBhcmVhICs9IHRvUmFkaWFucyh4MiAtIHgxKSAqXHJcbiAgICAgICAgKDIgKyBNYXRoLnNpbih0b1JhZGlhbnMoeTEpKSArXHJcbiAgICAgICAgTWF0aC5zaW4odG9SYWRpYW5zKHkyKSkpO1xyXG4gICAgeDEgPSB4MjtcclxuICAgIHkxID0geTI7XHJcbiAgfVxyXG4gIHJldHVybiBhcmVhICogdGhpcy5yYWRpdXMgKiB0aGlzLnJhZGl1cyAvIDIuMDtcclxufTtcclxuXHJcbldHUzg0U3BoZXJlLnByb3RvdHlwZS5jcm9zc1RyYWNrRGlzdGFuY2UgPSBmdW5jdGlvbihjMSwgYzIsIGMzKSB7XHJcbiAgdmFyIGQxMyA9IHRoaXMuY29zaW5lRGlzdGFuY2UoYzEsIGMyKTtcclxuICB2YXIgdGhldGExMiA9IHRvUmFkaWFucyh0aGlzLmluaXRpYWxCZWFyaW5nKGMxLCBjMikpO1xyXG4gIHZhciB0aGV0YTEzID0gdG9SYWRpYW5zKHRoaXMuaW5pdGlhbEJlYXJpbmcoYzEsIGMzKSk7XHJcbiAgcmV0dXJuIHRoaXMucmFkaXVzICpcclxuICAgICAgTWF0aC5hc2luKE1hdGguc2luKGQxMyAvIHRoaXMucmFkaXVzKSAqIE1hdGguc2luKHRoZXRhMTMgLSB0aGV0YTEyKSk7XHJcbn07XHJcblxyXG5XR1M4NFNwaGVyZS5wcm90b3R5cGUuZXF1aXJlY3Rhbmd1bGFyRGlzdGFuY2UgPSBmdW5jdGlvbihjMSwgYzIpIHtcclxuICB2YXIgbGF0MSA9IHRvUmFkaWFucyhjMVsxXSk7XHJcbiAgdmFyIGxhdDIgPSB0b1JhZGlhbnMoYzJbMV0pO1xyXG4gIHZhciBkZWx0YUxvbiA9IHRvUmFkaWFucyhjMlswXSAtIGMxWzBdKTtcclxuICB2YXIgeCA9IGRlbHRhTG9uICogTWF0aC5jb3MoKGxhdDEgKyBsYXQyKSAvIDIpO1xyXG4gIHZhciB5ID0gbGF0MiAtIGxhdDE7XHJcbiAgcmV0dXJuIHRoaXMucmFkaXVzICogTWF0aC5zcXJ0KHggKiB4ICsgeSAqIHkpO1xyXG59O1xyXG5cclxuV0dTODRTcGhlcmUucHJvdG90eXBlLmZpbmFsQmVhcmluZyA9IGZ1bmN0aW9uKGMxLCBjMikge1xyXG4gIHJldHVybiAodGhpcy5pbml0aWFsQmVhcmluZyhjMiwgYzEpICsgMTgwKSAlIDM2MDtcclxufTtcclxuXHJcbldHUzg0U3BoZXJlLnByb3RvdHlwZS5oYXZlcnNpbmVEaXN0YW5jZSA9IGZ1bmN0aW9uKGMxLCBjMikge1xyXG4gIHZhciBsYXQxID0gdG9SYWRpYW5zKGMxWzFdKTtcclxuICB2YXIgbGF0MiA9IHRvUmFkaWFucyhjMlsxXSk7XHJcbiAgdmFyIGRlbHRhTGF0QnkyID0gKGxhdDIgLSBsYXQxKSAvIDI7XHJcbiAgdmFyIGRlbHRhTG9uQnkyID0gdG9SYWRpYW5zKGMyWzBdIC0gYzFbMF0pIC8gMjtcclxuICB2YXIgYSA9IE1hdGguc2luKGRlbHRhTGF0QnkyKSAqIE1hdGguc2luKGRlbHRhTGF0QnkyKSArXHJcbiAgICAgIE1hdGguc2luKGRlbHRhTG9uQnkyKSAqIE1hdGguc2luKGRlbHRhTG9uQnkyKSAqXHJcbiAgICAgIE1hdGguY29zKGxhdDEpICogTWF0aC5jb3MobGF0Mik7XHJcbiAgcmV0dXJuIDIgKiB0aGlzLnJhZGl1cyAqIE1hdGguYXRhbjIoTWF0aC5zcXJ0KGEpLCBNYXRoLnNxcnQoMSAtIGEpKTtcclxufTtcclxuXHJcbldHUzg0U3BoZXJlLnByb3RvdHlwZS5pbnRlcnBvbGF0ZSA9IGZ1bmN0aW9uKGMxLCBjMiwgZnJhY3Rpb24pIHtcclxuICB2YXIgbGF0MSA9IHRvUmFkaWFucyhjMVsxXSk7XHJcbiAgdmFyIGxvbjEgPSB0b1JhZGlhbnMoYzFbMF0pO1xyXG4gIHZhciBsYXQyID0gdG9SYWRpYW5zKGMyWzFdKTtcclxuICB2YXIgbG9uMiA9IHRvUmFkaWFucyhjMlswXSk7XHJcbiAgdmFyIGNvc0xhdDEgPSBNYXRoLmNvcyhsYXQxKTtcclxuICB2YXIgc2luTGF0MSA9IE1hdGguc2luKGxhdDEpO1xyXG4gIHZhciBjb3NMYXQyID0gTWF0aC5jb3MobGF0Mik7XHJcbiAgdmFyIHNpbkxhdDIgPSBNYXRoLnNpbihsYXQyKTtcclxuICB2YXIgY29zRGVsdGFMb24gPSBNYXRoLmNvcyhsb24yIC0gbG9uMSk7XHJcbiAgdmFyIGQgPSBzaW5MYXQxICogc2luTGF0MiArIGNvc0xhdDEgKiBjb3NMYXQyICogY29zRGVsdGFMb247XHJcbiAgaWYgKDEgPD0gZCkge1xyXG4gICAgcmV0dXJuIGMyLnNsaWNlKCk7XHJcbiAgfVxyXG4gIGQgPSBmcmFjdGlvbiAqIE1hdGguYWNvcyhkKTtcclxuICB2YXIgY29zRCA9IE1hdGguY29zKGQpO1xyXG4gIHZhciBzaW5EID0gTWF0aC5zaW4oZCk7XHJcbiAgdmFyIHkgPSBNYXRoLnNpbihsb24yIC0gbG9uMSkgKiBjb3NMYXQyO1xyXG4gIHZhciB4ID0gY29zTGF0MSAqIHNpbkxhdDIgLSBzaW5MYXQxICogY29zTGF0MiAqIGNvc0RlbHRhTG9uO1xyXG4gIHZhciB0aGV0YSA9IE1hdGguYXRhbjIoeSwgeCk7XHJcbiAgdmFyIGxhdCA9IE1hdGguYXNpbihzaW5MYXQxICogY29zRCArIGNvc0xhdDEgKiBzaW5EICogTWF0aC5jb3ModGhldGEpKTtcclxuICB2YXIgbG9uID0gbG9uMSArIE1hdGguYXRhbjIoTWF0aC5zaW4odGhldGEpICogc2luRCAqIGNvc0xhdDEsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvc0QgLSBzaW5MYXQxICogTWF0aC5zaW4obGF0KSk7XHJcbiAgcmV0dXJuIFt0b0RlZ3JlZXMobG9uKSwgdG9EZWdyZWVzKGxhdCldO1xyXG59O1xyXG5cclxuV0dTODRTcGhlcmUucHJvdG90eXBlLmluaXRpYWxCZWFyaW5nID0gZnVuY3Rpb24oYzEsIGMyKSB7XHJcbiAgdmFyIGxhdDEgPSB0b1JhZGlhbnMoYzFbMV0pO1xyXG4gIHZhciBsYXQyID0gdG9SYWRpYW5zKGMyWzFdKTtcclxuICB2YXIgZGVsdGFMb24gPSB0b1JhZGlhbnMoYzJbMF0gLSBjMVswXSk7XHJcbiAgdmFyIHkgPSBNYXRoLnNpbihkZWx0YUxvbikgKiBNYXRoLmNvcyhsYXQyKTtcclxuICB2YXIgeCA9IE1hdGguY29zKGxhdDEpICogTWF0aC5zaW4obGF0MikgLVxyXG4gICAgICBNYXRoLnNpbihsYXQxKSAqIE1hdGguY29zKGxhdDIpICogTWF0aC5jb3MoZGVsdGFMb24pO1xyXG4gIHJldHVybiB0b0RlZ3JlZXMoTWF0aC5hdGFuMih5LCB4KSk7XHJcbn07XHJcblxyXG5XR1M4NFNwaGVyZS5wcm90b3R5cGUubWF4aW11bUxhdGl0dWRlID0gZnVuY3Rpb24oYmVhcmluZywgbGF0aXR1ZGUpIHtcclxuICByZXR1cm4gTWF0aC5jb3MoTWF0aC5hYnMoTWF0aC5zaW4odG9SYWRpYW5zKGJlYXJpbmcpKSAqXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgIE1hdGguY29zKHRvUmFkaWFucyhsYXRpdHVkZSkpKSk7XHJcbn07XHJcblxyXG5XR1M4NFNwaGVyZS5wcm90b3R5cGUubWlkcG9pbnQgPSBmdW5jdGlvbihjMSwgYzIpIHtcclxuICB2YXIgbGF0MSA9IHRvUmFkaWFucyhjMVsxXSk7XHJcbiAgdmFyIGxhdDIgPSB0b1JhZGlhbnMoYzJbMV0pO1xyXG4gIHZhciBsb24xID0gdG9SYWRpYW5zKGMxWzBdKTtcclxuICB2YXIgZGVsdGFMb24gPSB0b1JhZGlhbnMoYzJbMF0gLSBjMVswXSk7XHJcbiAgdmFyIEJ4ID0gTWF0aC5jb3MobGF0MikgKiBNYXRoLmNvcyhkZWx0YUxvbik7XHJcbiAgdmFyIEJ5ID0gTWF0aC5jb3MobGF0MikgKiBNYXRoLnNpbihkZWx0YUxvbik7XHJcbiAgdmFyIGNvc0xhdDFQbHVzQnggPSBNYXRoLmNvcyhsYXQxKSArIEJ4O1xyXG4gIHZhciBsYXQgPSBNYXRoLmF0YW4yKE1hdGguc2luKGxhdDEpICsgTWF0aC5zaW4obGF0MiksXHJcbiAgICAgICAgICAgICAgICAgICAgICAgTWF0aC5zcXJ0KGNvc0xhdDFQbHVzQnggKiBjb3NMYXQxUGx1c0J4ICsgQnkgKiBCeSkpO1xyXG4gIHZhciBsb24gPSBsb24xICsgTWF0aC5hdGFuMihCeSwgY29zTGF0MVBsdXNCeCk7XHJcbiAgcmV0dXJuIFt0b0RlZ3JlZXMobG9uKSwgdG9EZWdyZWVzKGxhdCldO1xyXG59O1xyXG5cclxuV0dTODRTcGhlcmUucHJvdG90eXBlLm9mZnNldCA9IGZ1bmN0aW9uKGMxLCBkaXN0YW5jZSwgYmVhcmluZykge1xyXG4gIHZhciBsYXQxID0gdG9SYWRpYW5zKGMxWzFdKTtcclxuICB2YXIgbG9uMSA9IHRvUmFkaWFucyhjMVswXSk7XHJcbiAgdmFyIGRCeVIgPSBkaXN0YW5jZSAvIHRoaXMucmFkaXVzO1xyXG4gIHZhciBsYXQgPSBNYXRoLmFzaW4oXHJcbiAgICAgIE1hdGguc2luKGxhdDEpICogTWF0aC5jb3MoZEJ5UikgK1xyXG4gICAgICBNYXRoLmNvcyhsYXQxKSAqIE1hdGguc2luKGRCeVIpICogTWF0aC5jb3MoYmVhcmluZykpO1xyXG4gIHZhciBsb24gPSBsb24xICsgTWF0aC5hdGFuMihcclxuICAgICAgTWF0aC5zaW4oYmVhcmluZykgKiBNYXRoLnNpbihkQnlSKSAqIE1hdGguY29zKGxhdDEpLFxyXG4gICAgICBNYXRoLmNvcyhkQnlSKSAtIE1hdGguc2luKGxhdDEpICogTWF0aC5zaW4obGF0KSk7XHJcbiAgcmV0dXJuIFt0b0RlZ3JlZXMobG9uKSwgdG9EZWdyZWVzKGxhdCldO1xyXG59O1xyXG5cclxuLyoqXHJcbiAqIENoZWNrcyB3aGV0aGVyIG9iamVjdCBpcyBub3QgbnVsbCBhbmQgbm90IHVuZGVmaW5lZFxyXG4gKiBAcGFyYW0geyp9IG9iaiBvYmplY3QgdG8gYmUgY2hlY2tlZFxyXG4gKiBAcmV0dXJuIHtib29sZWFufVxyXG4gKi9cclxuXHJcbmZ1bmN0aW9uIGlzRGVmaW5lZChvYmopIHtcclxuICAgIHJldHVybiBudWxsICE9IG9iaiAmJiB1bmRlZmluZWQgIT0gb2JqO1xyXG59XHJcblxyXG5mdW5jdGlvbiBpc051bWVyaWMod2gpIHtcclxuICAgIHJldHVybiAhaXNOYU4ocGFyc2VGbG9hdCh3aCkpICYmIGlzRmluaXRlKHdoKTtcclxufVxyXG5cclxuZnVuY3Rpb24gaXNGdW5jdGlvbih3aCkge1xyXG4gICAgaWYgKCF3aCkge1xyXG4gICAgICAgIHJldHVybiBmYWxzZTtcclxuICAgIH1cclxuICAgIHJldHVybiAod2ggaW5zdGFuY2VvZiBGdW5jdGlvbiB8fCB0eXBlb2Ygd2ggPT0gXCJmdW5jdGlvblwiKTtcclxufVxyXG5cclxuZnVuY3Rpb24gaXNTdHJpbmdOb3RFbXB0eSh3aCkge1xyXG4gICAgaWYgKCF3aCkge1xyXG4gICAgICAgIHJldHVybiBmYWxzZTtcclxuICAgIH1cclxuICAgIHJldHVybiAod2ggaW5zdGFuY2VvZiBTdHJpbmcgfHwgdHlwZW9mIHdoID09IFwic3RyaW5nXCIpO1xyXG59XHJcblxyXG5mdW5jdGlvbiBpc1N0cih3aCkge1xyXG4gICAgcmV0dXJuICh3aCBpbnN0YW5jZW9mIFN0cmluZyB8fCB0eXBlb2Ygd2ggPT09IFwic3RyaW5nXCIpO1xyXG59XHJcblxyXG5mdW5jdGlvbiBpc0Jvb2xlYW4od2gpIHtcclxuICAgIHJldHVybiAod2ggaW5zdGFuY2VvZiBCb29sZWFuIHx8IHR5cGVvZiB3aCA9PSBcImJvb2xlYW5cIik7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIG15VHJpbSh4KSB7XHJcbiAgICByZXR1cm4geC5yZXBsYWNlKC9eXFxzK3xcXHMrJC9nbSwnJyk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIG15VHJpbUNvb3JkaW5hdGUoeCkge1xyXG5cdGRvIHtcclxuXHRcdHZhciBrPXg7XHJcblx0XHR4PW15VHJpbSh4KTtcclxuXHRcdGlmIChrICE9IHgpIFxyXG5cdFx0XHRjb250aW51ZTtcclxuXHRcdGlmICh4Lmxlbmd0aCkgXHJcblx0XHR7XHJcblx0XHRcdGlmICh4WzBdID09IFwiLFwiKVxyXG5cdFx0XHRcdHg9eC5zdWJzdHJpbmcoMSx4Lmxlbmd0aCk7XHJcblx0XHRcdGVsc2UgaWYgKGtbay5sZW5ndGgtMV0gPT0gXCIsXCIpXHJcblx0XHRcdFx0eD14LnN1YnN0cmluZygwLHgubGVuZ3RoLTEpO1xyXG5cdFx0XHRlbHNlXHJcblx0XHRcdFx0YnJlYWs7XHJcblx0XHRcdGNvbnRpbnVlO1xyXG5cdFx0fVxyXG5cdFx0YnJlYWs7XHJcblx0fSB3aGlsZSAodHJ1ZSk7XHJcblx0cmV0dXJuIHg7XHJcbn1cclxuXHJcblxyXG5mdW5jdGlvbiBjbG9zZXN0UHJvamVjdGlvbk9mUG9pbnRPbkxpbmUoeCx5LHgxLHkxLHgyLHkyKSBcclxue1xyXG5cdHZhciBzdGF0dXM7XHJcblx0dmFyIFAxPW51bGw7XHJcblx0dmFyIFAyPW51bGw7XHJcblx0dmFyIFAzPW51bGw7XHJcblx0dmFyIFA0PW51bGw7XHJcblx0dmFyIHAxPVtdO1xyXG4gICAgdmFyIHAyPVtdO1xyXG4gICAgdmFyIHAzPVtdO1xyXG5cdHZhciBwND1bXTtcclxuICAgIHZhciBpbnRlcnNlY3Rpb25Qb2ludD1udWxsO1xyXG4gICAgdmFyIGRpc3RNaW5Qb2ludD1udWxsO1xyXG4gICAgdmFyIGRlbm9taW5hdG9yPTA7XHJcbiAgICB2YXIgbm9taW5hdG9yPTA7XHJcbiAgICB2YXIgdT0wO1xyXG4gICAgdmFyIGRpc3RPcnRobz0wO1xyXG4gICAgdmFyIGRpc3RQMT0wO1xyXG4gICAgdmFyIGRpc3RQMj0wO1xyXG4gICAgdmFyIGRpc3RNaW49MDtcclxuICAgIHZhciBkaXN0TWF4PTA7XHJcbiAgIFxyXG4gICAgZnVuY3Rpb24gaW50ZXJzZWN0aW9uKClcclxuICAgIHtcclxuICAgICAgICB2YXIgYXggPSBwMVswXSArIHUgKiAocDJbMF0gLSBwMVswXSk7XHJcbiAgICAgICAgdmFyIGF5ID0gcDFbMV0gKyB1ICogKHAyWzFdIC0gcDFbMV0pO1xyXG4gICAgICAgIHA0ID0gW2F4LCBheV07XHJcbiAgICAgICAgaW50ZXJzZWN0aW9uUG9pbnQgPSBbYXgsYXldO1xyXG4gICAgfVxyXG5cclxuICAgIGZ1bmN0aW9uIGRpc3RhbmNlKClcclxuICAgIHtcclxuICAgICAgICB2YXIgYXggPSBwMVswXSArIHUgKiAocDJbMF0gLSBwMVswXSk7XHJcbiAgICAgICAgdmFyIGF5ID0gcDFbMV0gKyB1ICogKHAyWzFdIC0gcDFbMV0pO1xyXG4gICAgICAgIHA0ID0gW2F4LCBheV07XHJcbiAgICAgICAgZGlzdE9ydGhvID0gTWF0aC5zcXJ0KE1hdGgucG93KChwNFswXSAtIHAzWzBdKSwyKSArIE1hdGgucG93KChwNFsxXSAtIHAzWzFdKSwyKSk7XHJcbiAgICAgICAgZGlzdFAxICAgID0gTWF0aC5zcXJ0KE1hdGgucG93KChwMVswXSAtIHAzWzBdKSwyKSArIE1hdGgucG93KChwMVsxXSAtIHAzWzFdKSwyKSk7XHJcbiAgICAgICAgZGlzdFAyICAgID0gTWF0aC5zcXJ0KE1hdGgucG93KChwMlswXSAtIHAzWzBdKSwyKSArIE1hdGgucG93KChwMlsxXSAtIHAzWzFdKSwyKSk7XHJcbiAgICAgICAgaWYodT49MCAmJiB1PD0xKVxyXG4gICAgICAgIHsgICBkaXN0TWluID0gZGlzdE9ydGhvO1xyXG4gICAgICAgICAgICBkaXN0TWluUG9pbnQgPSBpbnRlcnNlY3Rpb25Qb2ludDtcclxuICAgICAgICB9XHJcbiAgICAgICAgZWxzZVxyXG4gICAgICAgIHsgICBpZihkaXN0UDEgPD0gZGlzdFAyKVxyXG4gICAgICAgICAgICB7ICAgZGlzdE1pbiA9IGRpc3RQMTtcclxuICAgICAgICAgICAgICAgIGRpc3RNaW5Qb2ludCA9IFAxO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGVsc2VcclxuICAgICAgICAgICAgeyAgIGRpc3RNaW4gPSBkaXN0UDI7XHJcbiAgICAgICAgICAgICAgICBkaXN0TWluUG9pbnQgPSBQMjtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgICAgICBkaXN0TWF4ID0gTWF0aC5tYXgoTWF0aC5tYXgoZGlzdE9ydGhvLCBkaXN0UDEpLCBkaXN0UDIpO1xyXG4gICAgfVxyXG5cdFAxID0gW3gxLHkxXTtcclxuXHRQMiA9IFt4Mix5Ml07XHJcblx0UDMgPSBbeCx5XTtcclxuXHRwMSA9IFt4MSwgeTFdO1xyXG5cdHAyID0gW3gyLCB5Ml07XHJcblx0cDMgPSBbeCwgeV07XHJcblx0ZGVub21pbmF0b3IgPSBNYXRoLnBvdyhNYXRoLnNxcnQoTWF0aC5wb3cocDJbMF0tcDFbMF0sMikgKyBNYXRoLnBvdyhwMlsxXS1wMVsxXSwyKSksMiApO1xyXG5cdG5vbWluYXRvciAgID0gKHAzWzBdIC0gcDFbMF0pICogKHAyWzBdIC0gcDFbMF0pICsgKHAzWzFdIC0gcDFbMV0pICogKHAyWzFdIC0gcDFbMV0pO1xyXG5cdGlmKGRlbm9taW5hdG9yPT0wKVxyXG5cdHsgICBzdGF0dXMgPSBcImNvaW5jaWRlbnRhbFwiXHJcblx0XHR1ID0gLTk5OTtcclxuXHR9XHJcblx0ZWxzZVxyXG5cdHsgICB1ID0gbm9taW5hdG9yIC8gZGVub21pbmF0b3I7XHJcblx0XHRpZih1ID49MCAmJiB1IDw9IDEpXHJcblx0XHRcdHN0YXR1cyA9IFwib3J0aG9nb25hbFwiO1xyXG5cdFx0ZWxzZVxyXG5cdFx0XHRzdGF0dXMgPSBcIm9ibGlxdWVcIjtcclxuXHR9XHJcblx0aW50ZXJzZWN0aW9uKCk7XHJcblx0ZGlzdGFuY2UoKTtcclxuXHRcclxuXHRyZXR1cm4geyBzdGF0dXMgOiBzdGF0dXMsIHBvcyA6IGRpc3RNaW5Qb2ludCwgbWluIDogZGlzdE1pbiB9O1xyXG59XHJcblxyXG5mdW5jdGlvbiBjb2xvckx1bWluYW5jZShoZXgsIGx1bSkge1xyXG4gICAgLy8gVmFsaWRhdGUgaGV4IHN0cmluZ1xyXG4gICAgaGV4ID0gU3RyaW5nKGhleCkucmVwbGFjZSgvW14wLTlhLWZdL2dpLCBcIlwiKTtcclxuICAgIGlmIChoZXgubGVuZ3RoIDwgNikge1xyXG4gICAgICAgIGhleCA9IGhleC5yZXBsYWNlKC8oLikvZywgJyQxJDEnKTtcclxuICAgIH1cclxuICAgIGx1bSA9IGx1bSB8fCAwO1xyXG4gICAgLy8gQ29udmVydCB0byBkZWNpbWFsIGFuZCBjaGFuZ2UgbHVtaW5vc2l0eVxyXG4gICAgdmFyIHJnYiA9IFwiI1wiLFxyXG4gICAgICAgIGM7XHJcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IDM7ICsraSkge1xyXG4gICAgICAgIGMgPSBwYXJzZUludChoZXguc3Vic3RyKGkgKiAyLCAyKSwgMTYpO1xyXG4gICAgICAgIGMgPSBNYXRoLnJvdW5kKE1hdGgubWluKE1hdGgubWF4KDAsIGMgKyAoYyAqIGx1bSkpLCAyNTUpKS50b1N0cmluZygxNik7XHJcbiAgICAgICAgcmdiICs9IChcIjAwXCIgKyBjKS5zdWJzdHIoYy5sZW5ndGgpO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIHJnYjtcclxufVxyXG5cclxuZnVuY3Rpb24gaW5jcmVhc2VCcmlnaHRuZXNzKGhleCwgcGVyY2VudCkgXHJcbntcclxuICAgIGhleCA9IFN0cmluZyhoZXgpLnJlcGxhY2UoL1teMC05YS1mXS9naSwgXCJcIik7XHJcbiAgICBpZiAoaGV4Lmxlbmd0aCA8IDYpIHtcclxuICAgICAgICBoZXggPSBoZXgucmVwbGFjZSgvKC4pL2csICckMSQxJyk7XHJcbiAgICB9XHJcbiAgICB2YXIgcmdiID0gXCIjXCIsXHJcbiAgICAgICAgYztcclxuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgMzsgKytpKSB7XHJcbiAgICAgICAgYyA9IHBhcnNlSW50KGhleC5zdWJzdHIoaSAqIDIsIDIpLCAxNik7XHJcbiAgICAgICAgYyA9IHBhcnNlSW50KChjKigxMDAtcGVyY2VudCkrMjU1KnBlcmNlbnQpLzEwMCk7XHJcbiAgICAgICAgaWYgKGMgPiAyNTUpXHJcbiAgICAgICAgXHRjPTI1NTtcclxuICAgICAgICBjPWMudG9TdHJpbmcoMTYpO1xyXG4gICAgICAgIHJnYiArPSAoXCIwMFwiICsgYykuc3Vic3RyKGMubGVuZ3RoKTtcclxuICAgIH1cclxuICAgIHJldHVybiByZ2I7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGNvbG9yQWxwaGFBcnJheShoZXgsIGFscGhhKSB7XHJcbiAgICBoZXggPSBTdHJpbmcoaGV4KS5yZXBsYWNlKC9bXjAtOWEtZl0vZ2ksIFwiXCIpO1xyXG4gICAgaWYgKGhleC5sZW5ndGggPCA2KSB7XHJcbiAgICAgICAgaGV4ID0gaGV4LnJlcGxhY2UoLyguKS9nLCAnJDEkMScpO1xyXG4gICAgfVxyXG4gICAgdmFyIHJlcz1bXTtcclxuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgMzsgKytpKSB7XHJcbiAgICAgICAgYyA9IHBhcnNlSW50KGhleC5zdWJzdHIoaSAqIDIsIDIpLCAxNik7XHJcbiAgICAgICAgcmVzLnB1c2goYyk7XHJcbiAgICB9XHJcbiAgICByZXMucHVzaChhbHBoYSk7XHJcbiAgICByZXR1cm4gcmVzO1xyXG59XHJcblxyXG5mdW5jdGlvbiBlc2NhcGVIVE1MKHVuc2FmZSkge1xyXG4gICAgcmV0dXJuIHVuc2FmZVxyXG4gICAgICAgICAucmVwbGFjZSgvJi9nLCBcIiZhbXA7XCIpXHJcbiAgICAgICAgIC5yZXBsYWNlKC88L2csIFwiJmx0O1wiKVxyXG4gICAgICAgICAucmVwbGFjZSgvPi9nLCBcIiZndDtcIilcclxuICAgICAgICAgLnJlcGxhY2UoL1wiL2csIFwiJnF1b3Q7XCIpXHJcbiAgICAgICAgIC5yZXBsYWNlKC8nL2csIFwiJiMwMzk7XCIpO1xyXG4gfVxyXG5cclxuZnVuY3Rpb24gZm9ybWF0TnVtYmVyMih2YWwpIHtcclxuXHRyZXR1cm4gcGFyc2VGbG9hdChNYXRoLnJvdW5kKHZhbCAqIDEwMCkgLyAxMDApLnRvRml4ZWQoMik7XHJcbn1cclxuZnVuY3Rpb24gZm9ybWF0RGF0ZShkKSB7XHJcbiBcdHZhciBkZCA9IGQuZ2V0RGF0ZSgpO1xyXG4gICAgdmFyIG1tID0gZC5nZXRNb250aCgpKzE7IC8vSmFudWFyeSBpcyAwIVxyXG4gICAgdmFyIHl5eXkgPSBkLmdldEZ1bGxZZWFyKCk7XHJcbiAgICBpZihkZDwxMCl7XHJcbiAgICAgICAgZGQ9JzAnK2RkO1xyXG4gICAgfSBcclxuICAgIGlmKG1tPDEwKXtcclxuICAgICAgICBtbT0nMCcrbW07XHJcbiAgICB9IFxyXG4gICAgcmV0dXJuIGRkKycuJyttbSsnLicreXl5eTtcclxufVxyXG5cclxuZnVuY3Rpb24gZm9ybWF0VGltZShkKSB7XHJcbiAgICB2YXIgaGggPSBkLmdldEhvdXJzKCk7XHJcbiAgICBpZihoaDwxMCl7XHJcbiAgICBcdGhoPScwJytoaDtcclxuICAgIH0gXHJcbiAgICB2YXIgbW0gPSBkLmdldE1pbnV0ZXMoKTtcclxuICAgIGlmKG1tPDEwKXtcclxuICAgICAgICBtbT0nMCcrbW07XHJcbiAgICB9IFxyXG4gICAgcmV0dXJuIGhoK1wiOlwiK21tO1xyXG59XHJcblxyXG5mdW5jdGlvbiBmb3JtYXREYXRlVGltZShkKSB7XHJcblx0cmV0dXJuIGZvcm1hdERhdGUoZCkrXCIgXCIrZm9ybWF0VGltZShkKTtcclxufVxyXG5cclxuZnVuY3Rpb24gZm9ybWF0RGF0ZVRpbWVTZWMoZCkge1xyXG5cdHJldHVybiBmb3JtYXREYXRlKGQpK1wiIFwiK2Zvcm1hdFRpbWVTZWMoZCk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGZvcm1hdFRpbWVTZWMoZCkge1xyXG4gICAgdmFyIGhoID0gZC5nZXRIb3VycygpO1xyXG4gICAgaWYoaGg8MTApe1xyXG4gICAgXHRoaD0nMCcraGg7XHJcbiAgICB9IFxyXG4gICAgdmFyIG1tID0gZC5nZXRNaW51dGVzKCk7XHJcbiAgICBpZihtbTwxMCl7XHJcbiAgICAgICAgbW09JzAnK21tO1xyXG4gICAgfSBcclxuICAgIHZhciBzcyA9IGQuZ2V0U2Vjb25kcygpO1xyXG4gICAgaWYoc3M8MTApe1xyXG4gICAgICAgIHNzPScwJytzcztcclxuICAgIH0gXHJcbiAgICByZXR1cm4gaGgrXCI6XCIrbW0rXCI6XCIrc3M7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIHJhaW5ib3cobnVtT2ZTdGVwcywgc3RlcCkge1xyXG4gICAgLy8gVGhpcyBmdW5jdGlvbiBnZW5lcmF0ZXMgdmlicmFudCwgXCJldmVubHkgc3BhY2VkXCIgY29sb3VycyAoaS5lLiBubyBjbHVzdGVyaW5nKS4gVGhpcyBpcyBpZGVhbCBmb3IgY3JlYXRpbmcgZWFzaWx5IGRpc3Rpbmd1aXNoYWJsZSB2aWJyYW50IG1hcmtlcnMgaW4gR29vZ2xlIE1hcHMgYW5kIG90aGVyIGFwcHMuXHJcbiAgICAvLyBBZGFtIENvbGUsIDIwMTEtU2VwdC0xNFxyXG4gICAgLy8gSFNWIHRvIFJCRyBhZGFwdGVkIGZyb206IGh0dHA6Ly9tamlqYWNrc29uLmNvbS8yMDA4LzAyL3JnYi10by1oc2wtYW5kLXJnYi10by1oc3YtY29sb3ItbW9kZWwtY29udmVyc2lvbi1hbGdvcml0aG1zLWluLWphdmFzY3JpcHRcclxuICAgIHZhciByLCBnLCBiO1xyXG4gICAgdmFyIGggPSBzdGVwIC8gbnVtT2ZTdGVwcztcclxuICAgIHZhciBpID0gfn4oaCAqIDYpO1xyXG4gICAgdmFyIGYgPSBoICogNiAtIGk7XHJcbiAgICB2YXIgcSA9IDEgLSBmO1xyXG4gICAgc3dpdGNoKGkgJSA2KXtcclxuICAgICAgICBjYXNlIDA6IHIgPSAxLCBnID0gZiwgYiA9IDA7IGJyZWFrO1xyXG4gICAgICAgIGNhc2UgMTogciA9IHEsIGcgPSAxLCBiID0gMDsgYnJlYWs7XHJcbiAgICAgICAgY2FzZSAyOiByID0gMCwgZyA9IDEsIGIgPSBmOyBicmVhaztcclxuICAgICAgICBjYXNlIDM6IHIgPSAwLCBnID0gcSwgYiA9IDE7IGJyZWFrO1xyXG4gICAgICAgIGNhc2UgNDogciA9IGYsIGcgPSAwLCBiID0gMTsgYnJlYWs7XHJcbiAgICAgICAgY2FzZSA1OiByID0gMSwgZyA9IDAsIGIgPSBxOyBicmVhaztcclxuICAgIH1cclxuICAgIHZhciBjID0gXCIjXCIgKyAoXCIwMFwiICsgKH4gfihyICogMjU1KSkudG9TdHJpbmcoMTYpKS5zbGljZSgtMikgKyAoXCIwMFwiICsgKH4gfihnICogMjU1KSkudG9TdHJpbmcoMTYpKS5zbGljZSgtMikgKyAoXCIwMFwiICsgKH4gfihiICogMjU1KSkudG9TdHJpbmcoMTYpKS5zbGljZSgtMik7XHJcbiAgICByZXR1cm4gKGMpO1xyXG59XHJcblxyXG5mdW5jdGlvbiBtb2JpbGVBbmRUYWJsZXRDaGVjaygpIFxyXG57XHJcblx0ICBpZiAodHlwZW9mIG5hdmlnYXRvciA9PSBcInVuZGVmaW5lZFwiKVxyXG5cdFx0ICByZXR1cm4gZmFsc2U7XHJcblx0ICB2YXIgY2hlY2sgPSBmYWxzZTtcclxuXHQgIChmdW5jdGlvbihhKXtpZigvKGFuZHJvaWR8YmJcXGQrfG1lZWdvKS4rbW9iaWxlfGF2YW50Z298YmFkYVxcL3xibGFja2JlcnJ5fGJsYXplcnxjb21wYWx8ZWxhaW5lfGZlbm5lY3xoaXB0b3B8aWVtb2JpbGV8aXAoaG9uZXxvZCl8aXJpc3xraW5kbGV8bGdlIHxtYWVtb3xtaWRwfG1tcHxtb2JpbGUuK2ZpcmVmb3h8bmV0ZnJvbnR8b3BlcmEgbShvYnxpbilpfHBhbG0oIG9zKT98cGhvbmV8cChpeGl8cmUpXFwvfHBsdWNrZXJ8cG9ja2V0fHBzcHxzZXJpZXMoNHw2KTB8c3ltYmlhbnx0cmVvfHVwXFwuKGJyb3dzZXJ8bGluayl8dm9kYWZvbmV8d2FwfHdpbmRvd3MgY2V8eGRhfHhpaW5vfGFuZHJvaWR8aXBhZHxwbGF5Ym9va3xzaWxrL2kudGVzdChhKXx8LzEyMDd8NjMxMHw2NTkwfDNnc298NHRocHw1MFsxLTZdaXw3NzBzfDgwMnN8YSB3YXxhYmFjfGFjKGVyfG9vfHNcXC0pfGFpKGtvfHJuKXxhbChhdnxjYXxjbyl8YW1vaXxhbihleHxueXx5dyl8YXB0dXxhcihjaHxnbyl8YXModGV8dXMpfGF0dHd8YXUoZGl8XFwtbXxyIHxzICl8YXZhbnxiZShja3xsbHxucSl8YmkobGJ8cmQpfGJsKGFjfGF6KXxicihlfHYpd3xidW1ifGJ3XFwtKG58dSl8YzU1XFwvfGNhcGl8Y2N3YXxjZG1cXC18Y2VsbHxjaHRtfGNsZGN8Y21kXFwtfGNvKG1wfG5kKXxjcmF3fGRhKGl0fGxsfG5nKXxkYnRlfGRjXFwtc3xkZXZpfGRpY2F8ZG1vYnxkbyhjfHApb3xkcygxMnxcXC1kKXxlbCg0OXxhaSl8ZW0obDJ8dWwpfGVyKGljfGswKXxlc2w4fGV6KFs0LTddMHxvc3x3YXx6ZSl8ZmV0Y3xmbHkoXFwtfF8pfGcxIHV8ZzU2MHxnZW5lfGdmXFwtNXxnXFwtbW98Z28oXFwud3xvZCl8Z3IoYWR8dW4pfGhhaWV8aGNpdHxoZFxcLShtfHB8dCl8aGVpXFwtfGhpKHB0fHRhKXxocCggaXxpcCl8aHNcXC1jfGh0KGMoXFwtfCB8X3xhfGd8cHxzfHQpfHRwKXxodShhd3x0Yyl8aVxcLSgyMHxnb3xtYSl8aTIzMHxpYWMoIHxcXC18XFwvKXxpYnJvfGlkZWF8aWcwMXxpa29tfGltMWt8aW5ub3xpcGFxfGlyaXN8amEodHx2KWF8amJyb3xqZW11fGppZ3N8a2RkaXxrZWppfGtndCggfFxcLyl8a2xvbnxrcHQgfGt3Y1xcLXxreW8oY3xrKXxsZShub3x4aSl8bGcoIGd8XFwvKGt8bHx1KXw1MHw1NHxcXC1bYS13XSl8bGlid3xseW54fG0xXFwtd3xtM2dhfG01MFxcL3xtYSh0ZXx1aXx4byl8bWMoMDF8MjF8Y2EpfG1cXC1jcnxtZShyY3xyaSl8bWkobzh8b2F8dHMpfG1tZWZ8bW8oMDF8MDJ8Yml8ZGV8ZG98dChcXC18IHxvfHYpfHp6KXxtdCg1MHxwMXx2ICl8bXdicHxteXdhfG4xMFswLTJdfG4yMFsyLTNdfG4zMCgwfDIpfG41MCgwfDJ8NSl8bjcoMCgwfDEpfDEwKXxuZSgoY3xtKVxcLXxvbnx0Znx3Znx3Z3x3dCl8bm9rKDZ8aSl8bnpwaHxvMmltfG9wKHRpfHd2KXxvcmFufG93ZzF8cDgwMHxwYW4oYXxkfHQpfHBkeGd8cGcoMTN8XFwtKFsxLThdfGMpKXxwaGlsfHBpcmV8cGwoYXl8dWMpfHBuXFwtMnxwbyhja3xydHxzZSl8cHJveHxwc2lvfHB0XFwtZ3xxYVxcLWF8cWMoMDd8MTJ8MjF8MzJ8NjB8XFwtWzItN118aVxcLSl8cXRla3xyMzgwfHI2MDB8cmFrc3xyaW05fHJvKHZlfHpvKXxzNTVcXC98c2EoZ2V8bWF8bW18bXN8bnl8dmEpfHNjKDAxfGhcXC18b298cFxcLSl8c2RrXFwvfHNlKGMoXFwtfDB8MSl8NDd8bWN8bmR8cmkpfHNnaFxcLXxzaGFyfHNpZShcXC18bSl8c2tcXC0wfHNsKDQ1fGlkKXxzbShhbHxhcnxiM3xpdHx0NSl8c28oZnR8bnkpfHNwKDAxfGhcXC18dlxcLXx2ICl8c3koMDF8bWIpfHQyKDE4fDUwKXx0NigwMHwxMHwxOCl8dGEoZ3R8bGspfHRjbFxcLXx0ZGdcXC18dGVsKGl8bSl8dGltXFwtfHRcXC1tb3x0byhwbHxzaCl8dHMoNzB8bVxcLXxtM3xtNSl8dHhcXC05fHVwKFxcLmJ8ZzF8c2kpfHV0c3R8djQwMHx2NzUwfHZlcml8dmkocmd8dGUpfHZrKDQwfDVbMC0zXXxcXC12KXx2bTQwfHZvZGF8dnVsY3x2eCg1Mnw1M3w2MHw2MXw3MHw4MHw4MXw4M3w4NXw5OCl8dzNjKFxcLXwgKXx3ZWJjfHdoaXR8d2koZyB8bmN8bncpfHdtbGJ8d29udXx4NzAwfHlhc1xcLXx5b3VyfHpldG98enRlXFwtL2kudGVzdChhLnN1YnN0cigwLDQpKSljaGVjayA9IHRydWV9KShuYXZpZ2F0b3IudXNlckFnZW50fHxuYXZpZ2F0b3IudmVuZG9yfHx3aW5kb3cub3BlcmEpO1xyXG5cdCAgcmV0dXJuIGNoZWNrO1xyXG59XHJcblxyXG52YXIgUkVOREVSRURBUlJPV1M9e307XHJcbmZ1bmN0aW9uIHJlbmRlckFycm93QmFzZTY0KHdpZHRoLGhlaWdodCxjb2xvcikgXHJcbntcclxuXHR2YXIga2V5ID0gd2lkdGgrXCJ4XCIraGVpZ2h0K1wiOlwiK2NvbG9yO1xyXG5cdGlmIChSRU5ERVJFREFSUk9XU1trZXldKVxyXG5cdFx0cmV0dXJuIFJFTkRFUkVEQVJST1dTW2tleV07XHJcblx0dmFyIGJyZGNvbCA9IFwiI2ZlZmVmZVwiOyAvL2luY3JlYXNlQnJpZ2h0bmVzcyhjb2xvciw5OSk7XHJcblx0XHJcblx0dmFyIHN2Zz0nPHN2ZyB2ZXJzaW9uPVwiMS4xXCIgaWQ9XCJMYXllcl8xXCIgeG1sbnM9XCJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2Z1wiIHhtbG5zOnhsaW5rPVwiaHR0cDovL3d3dy53My5vcmcvMTk5OS94bGlua1wiIHg9XCIwcHhcIiB5PVwiMHB4XCIgd2lkdGg9XCInK3dpZHRoKydwdFwiIGhlaWdodD1cIicraGVpZ2h0KydwdFwiICdcdFxyXG5cdCsndmlld0JveD1cIjEzNy44MzQgLTgyLjgzMyAxMTQgOTEuMzMzXCIgZW5hYmxlLWJhY2tncm91bmQ9XCJuZXcgMTM3LjgzNCAtODIuODMzIDExNCA5MS4zMzNcIiB4bWw6c3BhY2U9XCJwcmVzZXJ2ZVwiPidcclxuXHQrJzxwYXRoIGZpbGw9XCJub25lXCIgZD1cIk0tNTEtMi4xNjdoNDh2NDhoLTQ4Vi0yLjE2N3pcIi8+J1xyXG5cdCsnPGNpcmNsZSBkaXNwbGF5PVwibm9uZVwiIGZpbGw9XCIjNjA1Q0M5XCIgY3g9XCI1MS4yODZcIiBjeT1cIi0zNS4yODZcIiByPVwiODguNzg2XCIvPidcclxuXHQrJzxwYXRoIGZpbGw9XCIjNjA1Q0M5XCIgc3Ryb2tlPVwiI0ZGRkZGRlwiIHN0cm9rZS13aWR0aD1cIjRcIiBzdHJva2UtbWl0ZXJsaW1pdD1cIjEwXCIgZD1cIk0yMzkuNS0zNi44bC05Mi41NTgtMzUuNjkgYzUuMjE2LDExLjMwNCw4LjEzLDIzLjg4Nyw4LjEzLDM3LjE1M2MwLDEyLjE3LTIuNDUxLDIzLjc2Ny02Ljg4MywzNC4zMjdMMjM5LjUtMzYuOHpcIi8+J1xyXG5cdCsnPC9zdmc+J1xyXG5cdHZhciBzdmc9c3ZnLnNwbGl0KFwiIzYwNUNDOVwiKS5qb2luKGNvbG9yKTtcclxuXHR2YXIgY2FudmFzID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnY2FudmFzJyk7XHJcbiAgICBjYW52YXMud2lkdGggPSB3aWR0aDtcclxuICAgIGNhbnZhcy5oZWlnaHQgPSBoZWlnaHQ7XHJcbiAgICBjYW52ZyhjYW52YXMsIHN2Zyx7IGlnbm9yZU1vdXNlOiB0cnVlLCBpZ25vcmVBbmltYXRpb246IHRydWUgfSk7XHJcbiAgICByZXR1cm4gUkVOREVSRURBUlJPV1Nba2V5XT1jYW52YXMudG9EYXRhVVJMKCk7XHJcbn1cclxuXHJcbnZhciBSRU5ERVJFRERJUkVDVElPTlM9e307XHJcbmZ1bmN0aW9uIHJlbmRlckRpcmVjdGlvbkJhc2U2NCh3aWR0aCxoZWlnaHQsY29sb3IpIFxyXG57XHJcblx0dmFyIGtleSA9IHdpZHRoK1wieFwiK2hlaWdodCtcIjpcIitjb2xvcjtcclxuXHRpZiAoUkVOREVSRURESVJFQ1RJT05TW2tleV0pXHJcblx0XHRyZXR1cm4gUkVOREVSRURESVJFQ1RJT05TW2tleV07XHJcblxyXG5cdHZhciBzdmc9Jzxzdmcgd2lkdGg9XCInK3dpZHRoKydwdFwiIGhlaWdodD1cIicraGVpZ2h0KydwdFwiICdcclxuXHJcblx0XHQrJ3ZpZXdCb3g9XCIxNSA5IDE5Ljc1IDI5LjVcIiBlbmFibGUtYmFja2dyb3VuZD1cIm5ldyAxNSA5IDE5Ljc1IDI5LjVcIiB4bWw6c3BhY2U9XCJwcmVzZXJ2ZVwiPidcclxuXHRcdCsnPHBhdGggZmlsbD1cIiNGRkZFRkZcIiBkPVwiTTE3LjE3LDMyLjkybDkuMTctOS4xN2wtOS4xNy05LjE3TDIwLDExLjc1bDEyLDEybC0xMiwxMkwxNy4xNywzMi45MnpcIi8+J1xyXG5cdFx0Kyc8cGF0aCBmaWxsPVwibm9uZVwiIGQ9XCJNMC0wLjI1aDQ4djQ4SDBWLTAuMjV6XCIvPidcclxuXHJcblx0Kyc8L3N2Zz4nO1xyXG5cclxuXHR2YXIgc3ZnPXN2Zy5zcGxpdChcIiMwMDAwMDBcIikuam9pbihjb2xvcik7XHJcblx0dmFyIGNhbnZhcyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2NhbnZhcycpO1xyXG4gICAgY2FudmFzLndpZHRoID0gd2lkdGg7XHJcbiAgICBjYW52YXMuaGVpZ2h0ID0gaGVpZ2h0O1xyXG4gICAgY2FudmcoY2FudmFzLCBzdmcseyBpZ25vcmVNb3VzZTogdHJ1ZSwgaWdub3JlQW5pbWF0aW9uOiB0cnVlIH0pO1xyXG4gICAgcmV0dXJuIFJFTkRFUkVERElSRUNUSU9OU1trZXldPWNhbnZhcy50b0RhdGFVUkwoKTtcclxufVxyXG5cclxudmFyIFJFTkRFUkVCT1hFUz17fTtcclxuZnVuY3Rpb24gcmVuZGVyQm94QmFzZTY0KHdpZHRoLGhlaWdodCxjb2xvcikgXHJcbntcclxuXHR2YXIga2V5ID0gd2lkdGgrXCJ4XCIraGVpZ2h0K1wiOlwiK2NvbG9yO1xyXG5cdGlmIChSRU5ERVJFQk9YRVNba2V5XSlcclxuXHRcdHJldHVybiBSRU5ERVJFQk9YRVNba2V5XTtcclxuXHJcblx0dmFyIHN2Zz0nPHN2ZyB3aWR0aD1cIicrd2lkdGgrJ3B0XCIgaGVpZ2h0PVwiJytoZWlnaHQrJ3B0XCIgdmlld0JveD1cIjAgMCA1MTIgNTEyXCIgdmVyc2lvbj1cIjEuMVwiIHhtbG5zPVwiaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmdcIj4nXHJcblx0Kyc8ZyBpZD1cIiNmZmZmZmZmZlwiPidcclxuXHQrJzxwYXRoIGZpbGw9XCIjZmZmZmZmXCIgb3BhY2l0eT1cIjEuMDBcIiBkPVwiIE0gNTUuNTAgMC4wMCBMIDQ1OC40NSAwLjAwIEMgNDcyLjQ0IDAuOTkgNDg2LjAzIDcuMDkgNDk1Ljc4IDE3LjIzIEMgNTA1LjM0IDI2Ljg4IDUxMS4wMSA0MC4wNCA1MTIuMDAgNTMuNTUgTCA1MTIuMDAgNDU4LjQ0IEMgNTEwLjk5IDQ3Mi40MyA1MDQuOTAgNDg2LjAxIDQ5NC43NyA0OTUuNzcgQyA0ODUuMTEgNTA1LjMyIDQ3MS45NiA1MTEuMDEgNDU4LjQ1IDUxMi4wMCBMIDUzLjU2IDUxMi4wMCBDIDM5LjU3IDUxMC45OSAyNS45NyA1MDQuOTEgMTYuMjIgNDk0Ljc4IEMgNi42NyA0ODUuMTIgMC45NyA0NzEuOTcgMC4wMCA0NTguNDUgTCAwLjAwIDU1LjUwIEMgMC40MCA0MS4wNyA2LjQ1IDI2Ljg5IDE2Ljc0IDE2LjczIEMgMjYuODkgNi40NSA0MS4wNyAwLjQxIDU1LjUwIDAuMDAgTSA1Ni45MCA1Ni45MCBDIDU2Ljg3IDE4OS42MyA1Ni44NiAzMjIuMzYgNTYuOTAgNDU1LjA5IEMgMTg5LjYzIDQ1NS4xMiAzMjIuMzYgNDU1LjEyIDQ1NS4wOSA0NTUuMDkgQyA0NTUuMTIgMzIyLjM2IDQ1NS4xMiAxODkuNjMgNDU1LjA5IDU2LjkwIEMgMzIyLjM2IDU2Ljg2IDE4OS42MyA1Ni44NyA1Ni45MCA1Ni45MCBaXCIgLz4nXHJcblx0Kyc8L2c+J1xyXG5cdCsnPGcgaWQ9XCIjMDAwMDAwZmZcIj4nXHJcblx0Kyc8cGF0aCBmaWxsPVwiIzAwMDAwMFwiIG9wYWNpdHk9XCIxLjAwXCIgZD1cIiBNIDU2LjkwIDU2LjkwIEMgMTg5LjYzIDU2Ljg3IDMyMi4zNiA1Ni44NiA0NTUuMDkgNTYuOTAgQyA0NTUuMTIgMTg5LjYzIDQ1NS4xMiAzMjIuMzYgNDU1LjA5IDQ1NS4wOSBDIDMyMi4zNiA0NTUuMTIgMTg5LjYzIDQ1NS4xMiA1Ni45MCA0NTUuMDkgQyA1Ni44NiAzMjIuMzYgNTYuODcgMTg5LjYzIDU2LjkwIDU2LjkwIFpcIiAvPidcclxuXHQrJzwvZz4nXHJcblx0Kyc8L3N2Zz4nO1xyXG5cclxuXHR2YXIgc3ZnPXN2Zy5zcGxpdChcIiMwMDAwMDBcIikuam9pbihjb2xvcik7XHJcblx0dmFyIGNhbnZhcyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2NhbnZhcycpO1xyXG4gICAgY2FudmFzLndpZHRoID0gd2lkdGg7XHJcbiAgICBjYW52YXMuaGVpZ2h0ID0gaGVpZ2h0O1xyXG4gICAgY2FudmcoY2FudmFzLCBzdmcseyBpZ25vcmVNb3VzZTogdHJ1ZSwgaWdub3JlQW5pbWF0aW9uOiB0cnVlIH0pO1xyXG4gICAgcmV0dXJuIFJFTkRFUkVCT1hFU1trZXldPWNhbnZhcy50b0RhdGFVUkwoKTtcclxufVxyXG5cclxuXHJcbmZ1bmN0aW9uIGludGVyY2VwdE9uQ2lyY2xlKGEsYixjLHIpIHtcclxuXHRyZXR1cm4gY2lyY2xlTGluZUludGVyc2VjdChhWzBdLGFbMV0sYlswXSxiWzFdLGNbMF0sY1sxXSxyKTtcdFxyXG59XHJcbmZ1bmN0aW9uIGRpc3RwKHAxLHAyKSB7XHJcblx0ICByZXR1cm4gTWF0aC5zcXJ0KChwMlswXS1wMVswXSkqKHAyWzBdLXAxWzBdKSsocDJbMV0tcDFbMV0pKihwMlsxXS1wMVsxXSkpO1xyXG59XHJcblxyXG5mdW5jdGlvbiBjaXJjbGVMaW5lSW50ZXJzZWN0KHgxLCB5MSwgeDIsIHkyLCBjeCwgY3ksIGNyICkgXHJcbntcclxuXHQgIGZ1bmN0aW9uIGRpc3QoeDEseTEseDIseTIpIHtcclxuXHRcdCAgcmV0dXJuIE1hdGguc3FydCgoeDIteDEpKih4Mi14MSkrKHkyLXkxKSooeTIteTEpKTtcclxuXHQgIH1cclxuXHQgIHZhciBkeCA9IHgyIC0geDE7XHJcblx0ICB2YXIgZHkgPSB5MiAtIHkxO1xyXG5cdCAgdmFyIGEgPSBkeCAqIGR4ICsgZHkgKiBkeTtcclxuXHQgIHZhciBiID0gMiAqIChkeCAqICh4MSAtIGN4KSArIGR5ICogKHkxIC0gY3kpKTtcclxuXHQgIHZhciBjID0gY3ggKiBjeCArIGN5ICogY3k7XHJcblx0ICBjICs9IHgxICogeDEgKyB5MSAqIHkxO1xyXG5cdCAgYyAtPSAyICogKGN4ICogeDEgKyBjeSAqIHkxKTtcclxuXHQgIGMgLT0gY3IgKiBjcjtcclxuXHQgIHZhciBiYjRhYyA9IGIgKiBiIC0gNCAqIGEgKiBjO1xyXG5cdCAgaWYgKGJiNGFjIDwgMCkgeyAgLy8gTm90IGludGVyc2VjdGluZ1xyXG5cdCAgICByZXR1cm4gZmFsc2U7XHJcblx0ICB9IGVsc2Uge1xyXG5cdFx0dmFyIG11ID0gKC1iICsgTWF0aC5zcXJ0KCBiKmIgLSA0KmEqYyApKSAvICgyKmEpO1xyXG5cdFx0dmFyIGl4MSA9IHgxICsgbXUqKGR4KTtcclxuXHRcdHZhciBpeTEgPSB5MSArIG11KihkeSk7XHJcblx0ICAgIG11ID0gKC1iIC0gTWF0aC5zcXJ0KGIqYiAtIDQqYSpjICkpIC8gKDIqYSk7XHJcblx0ICAgIHZhciBpeDIgPSB4MSArIG11KihkeCk7XHJcblx0ICAgIHZhciBpeTIgPSB5MSArIG11KihkeSk7XHJcblxyXG5cdCAgICAvLyBUaGUgaW50ZXJzZWN0aW9uIHBvaW50c1xyXG5cdCAgICAvL2VsbGlwc2UoaXgxLCBpeTEsIDEwLCAxMCk7XHJcblx0ICAgIC8vZWxsaXBzZShpeDIsIGl5MiwgMTAsIDEwKTtcclxuXHQgICAgXHJcblx0ICAgIHZhciB0ZXN0WDtcclxuXHQgICAgdmFyIHRlc3RZO1xyXG5cdCAgICAvLyBGaWd1cmUgb3V0IHdoaWNoIHBvaW50IGlzIGNsb3NlciB0byB0aGUgY2lyY2xlXHJcblx0ICAgIGlmIChkaXN0KHgxLCB5MSwgY3gsIGN5KSA8IGRpc3QoeDIsIHkyLCBjeCwgY3kpKSB7XHJcblx0ICAgICAgdGVzdFggPSB4MjtcclxuXHQgICAgICB0ZXN0WSA9IHkyO1xyXG5cdCAgICB9IGVsc2Uge1xyXG5cdCAgICAgIHRlc3RYID0geDE7XHJcblx0ICAgICAgdGVzdFkgPSB5MTtcclxuXHQgICAgfVxyXG5cdCAgICAgXHJcblx0ICAgIGlmIChkaXN0KHRlc3RYLCB0ZXN0WSwgaXgxLCBpeTEpIDwgZGlzdCh4MSwgeTEsIHgyLCB5MikgfHwgZGlzdCh0ZXN0WCwgdGVzdFksIGl4MiwgaXkyKSA8IGRpc3QoeDEsIHkxLCB4MiwgeTIpKSB7XHJcblx0ICAgICAgcmV0dXJuIFsgW2l4MSxpeTFdLFtpeDIsaXkyXSBdO1xyXG5cdCAgICB9IGVsc2Uge1xyXG5cdCAgICAgIHJldHVybiBmYWxzZTtcclxuXHQgICAgfVxyXG5cdCAgfVxyXG59XHJcblxyXG5mdW5jdGlvbiBkZWNvZGVCYXNlNjRJbWFnZShkYXRhU3RyaW5nKSB7XHJcblx0ICB2YXIgbWF0Y2hlcyA9IGRhdGFTdHJpbmcubWF0Y2goL15kYXRhOihbQS1aYS16LStcXC9dKyk7YmFzZTY0LCguKykkLyksXHJcblx0ICAgIHJlc3BvbnNlID0ge307XHJcblx0ICBpZiAobWF0Y2hlcy5sZW5ndGggIT09IDMpIHtcclxuXHQgICAgcmV0dXJuIG5ldyBFcnJvcignSW52YWxpZCBpbnB1dCBzdHJpbmcnKTtcclxuXHQgIH1cclxuXHQgIHJlc3BvbnNlLnR5cGUgPSBtYXRjaGVzWzFdO1xyXG5cdCAgcmVzcG9uc2UuZGF0YSA9IG5ldyBCdWZmZXIobWF0Y2hlc1syXSwgJ2Jhc2U2NCcpO1xyXG5cdCAgcmV0dXJuIHJlc3BvbnNlO1xyXG5cdH1cclxuXHJcbi8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcbmV4cG9ydHMubXlUcmltPW15VHJpbTtcclxuZXhwb3J0cy5teVRyaW1Db29yZGluYXRlPW15VHJpbUNvb3JkaW5hdGU7XHJcbmV4cG9ydHMuY2xvc2VzdFByb2plY3Rpb25PZlBvaW50T25MaW5lPWNsb3Nlc3RQcm9qZWN0aW9uT2ZQb2ludE9uTGluZTtcclxuZXhwb3J0cy5jb2xvckx1bWluYW5jZT1jb2xvckx1bWluYW5jZTtcclxuZXhwb3J0cy5pbmNyZWFzZUJyaWdodG5lc3M9aW5jcmVhc2VCcmlnaHRuZXNzO1xyXG5leHBvcnRzLmNvbG9yQWxwaGFBcnJheT1jb2xvckFscGhhQXJyYXk7XHJcbmV4cG9ydHMuZXNjYXBlSFRNTD1lc2NhcGVIVE1MO1xyXG5leHBvcnRzLmZvcm1hdE51bWJlcjI9Zm9ybWF0TnVtYmVyMjtcclxuZXhwb3J0cy5mb3JtYXREYXRlVGltZT1mb3JtYXREYXRlVGltZTtcclxuZXhwb3J0cy5mb3JtYXREYXRlVGltZVNlYz1mb3JtYXREYXRlVGltZVNlYztcclxuZXhwb3J0cy5mb3JtYXREYXRlPWZvcm1hdERhdGU7XHJcbmV4cG9ydHMuZm9ybWF0VGltZT1mb3JtYXRUaW1lO1xyXG5leHBvcnRzLnJhaW5ib3c9cmFpbmJvdztcclxuZXhwb3J0cy5tb2JpbGVBbmRUYWJsZXRDaGVjaz1tb2JpbGVBbmRUYWJsZXRDaGVjaztcclxuZXhwb3J0cy5yZW5kZXJBcnJvd0Jhc2U2ND1yZW5kZXJBcnJvd0Jhc2U2NDtcclxuZXhwb3J0cy5yZW5kZXJEaXJlY3Rpb25CYXNlNjQ9cmVuZGVyRGlyZWN0aW9uQmFzZTY0O1xyXG5leHBvcnRzLnJlbmRlckJveEJhc2U2ND1yZW5kZXJCb3hCYXNlNjQ7XHJcbmV4cG9ydHMuaW50ZXJjZXB0T25DaXJjbGU9aW50ZXJjZXB0T25DaXJjbGU7XHJcbmV4cG9ydHMuZGlzdHA9ZGlzdHA7XHJcbmV4cG9ydHMuY2lyY2xlTGluZUludGVyc2VjdD1jaXJjbGVMaW5lSW50ZXJzZWN0O1xyXG5leHBvcnRzLk1PQklMRT1tb2JpbGVBbmRUYWJsZXRDaGVjaygpO1xyXG5leHBvcnRzLldHUzg0U1BIRVJFPW5ldyBXR1M4NFNwaGVyZSg2Mzc4MTM3KTtcclxuZXhwb3J0cy5mb3JtYXRUaW1lU2VjPWZvcm1hdFRpbWVTZWM7XHJcbmV4cG9ydHMuZGVjb2RlQmFzZTY0SW1hZ2U9ZGVjb2RlQmFzZTY0SW1hZ2U7XHJcbmV4cG9ydHMuaXNEZWZpbmVkPWlzRGVmaW5lZDsiLCJtb2R1bGUuZXhwb3J0cyA9IHtcbiAgICBSQlRyZWU6IHJlcXVpcmUoJy4vbGliL3JidHJlZScpLFxuICAgIEJpblRyZWU6IHJlcXVpcmUoJy4vbGliL2JpbnRyZWUnKVxufTtcbiIsIlxudmFyIFRyZWVCYXNlID0gcmVxdWlyZSgnLi90cmVlYmFzZScpO1xuXG5mdW5jdGlvbiBOb2RlKGRhdGEpIHtcbiAgICB0aGlzLmRhdGEgPSBkYXRhO1xuICAgIHRoaXMubGVmdCA9IG51bGw7XG4gICAgdGhpcy5yaWdodCA9IG51bGw7XG59XG5cbk5vZGUucHJvdG90eXBlLmdldF9jaGlsZCA9IGZ1bmN0aW9uKGRpcikge1xuICAgIHJldHVybiBkaXIgPyB0aGlzLnJpZ2h0IDogdGhpcy5sZWZ0O1xufTtcblxuTm9kZS5wcm90b3R5cGUuc2V0X2NoaWxkID0gZnVuY3Rpb24oZGlyLCB2YWwpIHtcbiAgICBpZihkaXIpIHtcbiAgICAgICAgdGhpcy5yaWdodCA9IHZhbDtcbiAgICB9XG4gICAgZWxzZSB7XG4gICAgICAgIHRoaXMubGVmdCA9IHZhbDtcbiAgICB9XG59O1xuXG5mdW5jdGlvbiBCaW5UcmVlKGNvbXBhcmF0b3IpIHtcbiAgICB0aGlzLl9yb290ID0gbnVsbDtcbiAgICB0aGlzLl9jb21wYXJhdG9yID0gY29tcGFyYXRvcjtcbiAgICB0aGlzLnNpemUgPSAwO1xufVxuXG5CaW5UcmVlLnByb3RvdHlwZSA9IG5ldyBUcmVlQmFzZSgpO1xuXG4vLyByZXR1cm5zIHRydWUgaWYgaW5zZXJ0ZWQsIGZhbHNlIGlmIGR1cGxpY2F0ZVxuQmluVHJlZS5wcm90b3R5cGUuaW5zZXJ0ID0gZnVuY3Rpb24oZGF0YSkge1xuICAgIGlmKHRoaXMuX3Jvb3QgPT09IG51bGwpIHtcbiAgICAgICAgLy8gZW1wdHkgdHJlZVxuICAgICAgICB0aGlzLl9yb290ID0gbmV3IE5vZGUoZGF0YSk7XG4gICAgICAgIHRoaXMuc2l6ZSsrO1xuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG5cbiAgICB2YXIgZGlyID0gMDtcblxuICAgIC8vIHNldHVwXG4gICAgdmFyIHAgPSBudWxsOyAvLyBwYXJlbnRcbiAgICB2YXIgbm9kZSA9IHRoaXMuX3Jvb3Q7XG5cbiAgICAvLyBzZWFyY2ggZG93blxuICAgIHdoaWxlKHRydWUpIHtcbiAgICAgICAgaWYobm9kZSA9PT0gbnVsbCkge1xuICAgICAgICAgICAgLy8gaW5zZXJ0IG5ldyBub2RlIGF0IHRoZSBib3R0b21cbiAgICAgICAgICAgIG5vZGUgPSBuZXcgTm9kZShkYXRhKTtcbiAgICAgICAgICAgIHAuc2V0X2NoaWxkKGRpciwgbm9kZSk7XG4gICAgICAgICAgICByZXQgPSB0cnVlO1xuICAgICAgICAgICAgdGhpcy5zaXplKys7XG4gICAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIHN0b3AgaWYgZm91bmRcbiAgICAgICAgaWYodGhpcy5fY29tcGFyYXRvcihub2RlLmRhdGEsIGRhdGEpID09PSAwKSB7XG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cblxuICAgICAgICBkaXIgPSB0aGlzLl9jb21wYXJhdG9yKG5vZGUuZGF0YSwgZGF0YSkgPCAwO1xuXG4gICAgICAgIC8vIHVwZGF0ZSBoZWxwZXJzXG4gICAgICAgIHAgPSBub2RlO1xuICAgICAgICBub2RlID0gbm9kZS5nZXRfY2hpbGQoZGlyKTtcbiAgICB9XG59O1xuXG4vLyByZXR1cm5zIHRydWUgaWYgcmVtb3ZlZCwgZmFsc2UgaWYgbm90IGZvdW5kXG5CaW5UcmVlLnByb3RvdHlwZS5yZW1vdmUgPSBmdW5jdGlvbihkYXRhKSB7XG4gICAgaWYodGhpcy5fcm9vdCA9PT0gbnVsbCkge1xuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuXG4gICAgdmFyIGhlYWQgPSBuZXcgTm9kZSh1bmRlZmluZWQpOyAvLyBmYWtlIHRyZWUgcm9vdFxuICAgIHZhciBub2RlID0gaGVhZDtcbiAgICBub2RlLnJpZ2h0ID0gdGhpcy5fcm9vdDtcbiAgICB2YXIgcCA9IG51bGw7IC8vIHBhcmVudFxuICAgIHZhciBmb3VuZCA9IG51bGw7IC8vIGZvdW5kIGl0ZW1cbiAgICB2YXIgZGlyID0gMTtcblxuICAgIHdoaWxlKG5vZGUuZ2V0X2NoaWxkKGRpcikgIT09IG51bGwpIHtcbiAgICAgICAgcCA9IG5vZGU7XG4gICAgICAgIG5vZGUgPSBub2RlLmdldF9jaGlsZChkaXIpO1xuICAgICAgICB2YXIgY21wID0gdGhpcy5fY29tcGFyYXRvcihkYXRhLCBub2RlLmRhdGEpO1xuICAgICAgICBkaXIgPSBjbXAgPiAwO1xuXG4gICAgICAgIGlmKGNtcCA9PT0gMCkge1xuICAgICAgICAgICAgZm91bmQgPSBub2RlO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgaWYoZm91bmQgIT09IG51bGwpIHtcbiAgICAgICAgZm91bmQuZGF0YSA9IG5vZGUuZGF0YTtcbiAgICAgICAgcC5zZXRfY2hpbGQocC5yaWdodCA9PT0gbm9kZSwgbm9kZS5nZXRfY2hpbGQobm9kZS5sZWZ0ID09PSBudWxsKSk7XG5cbiAgICAgICAgdGhpcy5fcm9vdCA9IGhlYWQucmlnaHQ7XG4gICAgICAgIHRoaXMuc2l6ZS0tO1xuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG4gICAgZWxzZSB7XG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IEJpblRyZWU7XG5cbiIsIlxudmFyIFRyZWVCYXNlID0gcmVxdWlyZSgnLi90cmVlYmFzZScpO1xuXG5mdW5jdGlvbiBOb2RlKGRhdGEpIHtcbiAgICB0aGlzLmRhdGEgPSBkYXRhO1xuICAgIHRoaXMubGVmdCA9IG51bGw7XG4gICAgdGhpcy5yaWdodCA9IG51bGw7XG4gICAgdGhpcy5yZWQgPSB0cnVlO1xufVxuXG5Ob2RlLnByb3RvdHlwZS5nZXRfY2hpbGQgPSBmdW5jdGlvbihkaXIpIHtcbiAgICByZXR1cm4gZGlyID8gdGhpcy5yaWdodCA6IHRoaXMubGVmdDtcbn07XG5cbk5vZGUucHJvdG90eXBlLnNldF9jaGlsZCA9IGZ1bmN0aW9uKGRpciwgdmFsKSB7XG4gICAgaWYoZGlyKSB7XG4gICAgICAgIHRoaXMucmlnaHQgPSB2YWw7XG4gICAgfVxuICAgIGVsc2Uge1xuICAgICAgICB0aGlzLmxlZnQgPSB2YWw7XG4gICAgfVxufTtcblxuZnVuY3Rpb24gUkJUcmVlKGNvbXBhcmF0b3IpIHtcbiAgICB0aGlzLl9yb290ID0gbnVsbDtcbiAgICB0aGlzLl9jb21wYXJhdG9yID0gY29tcGFyYXRvcjtcbiAgICB0aGlzLnNpemUgPSAwO1xufVxuXG5SQlRyZWUucHJvdG90eXBlID0gbmV3IFRyZWVCYXNlKCk7XG5cbi8vIHJldHVybnMgdHJ1ZSBpZiBpbnNlcnRlZCwgZmFsc2UgaWYgZHVwbGljYXRlXG5SQlRyZWUucHJvdG90eXBlLmluc2VydCA9IGZ1bmN0aW9uKGRhdGEpIHtcbiAgICB2YXIgcmV0ID0gZmFsc2U7XG5cbiAgICBpZih0aGlzLl9yb290ID09PSBudWxsKSB7XG4gICAgICAgIC8vIGVtcHR5IHRyZWVcbiAgICAgICAgdGhpcy5fcm9vdCA9IG5ldyBOb2RlKGRhdGEpO1xuICAgICAgICByZXQgPSB0cnVlO1xuICAgICAgICB0aGlzLnNpemUrKztcbiAgICB9XG4gICAgZWxzZSB7XG4gICAgICAgIHZhciBoZWFkID0gbmV3IE5vZGUodW5kZWZpbmVkKTsgLy8gZmFrZSB0cmVlIHJvb3RcblxuICAgICAgICB2YXIgZGlyID0gMDtcbiAgICAgICAgdmFyIGxhc3QgPSAwO1xuXG4gICAgICAgIC8vIHNldHVwXG4gICAgICAgIHZhciBncCA9IG51bGw7IC8vIGdyYW5kcGFyZW50XG4gICAgICAgIHZhciBnZ3AgPSBoZWFkOyAvLyBncmFuZC1ncmFuZC1wYXJlbnRcbiAgICAgICAgdmFyIHAgPSBudWxsOyAvLyBwYXJlbnRcbiAgICAgICAgdmFyIG5vZGUgPSB0aGlzLl9yb290O1xuICAgICAgICBnZ3AucmlnaHQgPSB0aGlzLl9yb290O1xuXG4gICAgICAgIC8vIHNlYXJjaCBkb3duXG4gICAgICAgIHdoaWxlKHRydWUpIHtcbiAgICAgICAgICAgIGlmKG5vZGUgPT09IG51bGwpIHtcbiAgICAgICAgICAgICAgICAvLyBpbnNlcnQgbmV3IG5vZGUgYXQgdGhlIGJvdHRvbVxuICAgICAgICAgICAgICAgIG5vZGUgPSBuZXcgTm9kZShkYXRhKTtcbiAgICAgICAgICAgICAgICBwLnNldF9jaGlsZChkaXIsIG5vZGUpO1xuICAgICAgICAgICAgICAgIHJldCA9IHRydWU7XG4gICAgICAgICAgICAgICAgdGhpcy5zaXplKys7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBlbHNlIGlmKGlzX3JlZChub2RlLmxlZnQpICYmIGlzX3JlZChub2RlLnJpZ2h0KSkge1xuICAgICAgICAgICAgICAgIC8vIGNvbG9yIGZsaXBcbiAgICAgICAgICAgICAgICBub2RlLnJlZCA9IHRydWU7XG4gICAgICAgICAgICAgICAgbm9kZS5sZWZ0LnJlZCA9IGZhbHNlO1xuICAgICAgICAgICAgICAgIG5vZGUucmlnaHQucmVkID0gZmFsc2U7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIGZpeCByZWQgdmlvbGF0aW9uXG4gICAgICAgICAgICBpZihpc19yZWQobm9kZSkgJiYgaXNfcmVkKHApKSB7XG4gICAgICAgICAgICAgICAgdmFyIGRpcjIgPSBnZ3AucmlnaHQgPT09IGdwO1xuXG4gICAgICAgICAgICAgICAgaWYobm9kZSA9PT0gcC5nZXRfY2hpbGQobGFzdCkpIHtcbiAgICAgICAgICAgICAgICAgICAgZ2dwLnNldF9jaGlsZChkaXIyLCBzaW5nbGVfcm90YXRlKGdwLCAhbGFzdCkpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgZ2dwLnNldF9jaGlsZChkaXIyLCBkb3VibGVfcm90YXRlKGdwLCAhbGFzdCkpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgdmFyIGNtcCA9IHRoaXMuX2NvbXBhcmF0b3Iobm9kZS5kYXRhLCBkYXRhKTtcblxuICAgICAgICAgICAgLy8gc3RvcCBpZiBmb3VuZFxuICAgICAgICAgICAgaWYoY21wID09PSAwKSB7XG4gICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGxhc3QgPSBkaXI7XG4gICAgICAgICAgICBkaXIgPSBjbXAgPCAwO1xuXG4gICAgICAgICAgICAvLyB1cGRhdGUgaGVscGVyc1xuICAgICAgICAgICAgaWYoZ3AgIT09IG51bGwpIHtcbiAgICAgICAgICAgICAgICBnZ3AgPSBncDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGdwID0gcDtcbiAgICAgICAgICAgIHAgPSBub2RlO1xuICAgICAgICAgICAgbm9kZSA9IG5vZGUuZ2V0X2NoaWxkKGRpcik7XG4gICAgICAgIH1cblxuICAgICAgICAvLyB1cGRhdGUgcm9vdFxuICAgICAgICB0aGlzLl9yb290ID0gaGVhZC5yaWdodDtcbiAgICB9XG5cbiAgICAvLyBtYWtlIHJvb3QgYmxhY2tcbiAgICB0aGlzLl9yb290LnJlZCA9IGZhbHNlO1xuXG4gICAgcmV0dXJuIHJldDtcbn07XG5cbi8vIHJldHVybnMgdHJ1ZSBpZiByZW1vdmVkLCBmYWxzZSBpZiBub3QgZm91bmRcblJCVHJlZS5wcm90b3R5cGUucmVtb3ZlID0gZnVuY3Rpb24oZGF0YSkge1xuICAgIGlmKHRoaXMuX3Jvb3QgPT09IG51bGwpIHtcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cblxuICAgIHZhciBoZWFkID0gbmV3IE5vZGUodW5kZWZpbmVkKTsgLy8gZmFrZSB0cmVlIHJvb3RcbiAgICB2YXIgbm9kZSA9IGhlYWQ7XG4gICAgbm9kZS5yaWdodCA9IHRoaXMuX3Jvb3Q7XG4gICAgdmFyIHAgPSBudWxsOyAvLyBwYXJlbnRcbiAgICB2YXIgZ3AgPSBudWxsOyAvLyBncmFuZCBwYXJlbnRcbiAgICB2YXIgZm91bmQgPSBudWxsOyAvLyBmb3VuZCBpdGVtXG4gICAgdmFyIGRpciA9IDE7XG5cbiAgICB3aGlsZShub2RlLmdldF9jaGlsZChkaXIpICE9PSBudWxsKSB7XG4gICAgICAgIHZhciBsYXN0ID0gZGlyO1xuXG4gICAgICAgIC8vIHVwZGF0ZSBoZWxwZXJzXG4gICAgICAgIGdwID0gcDtcbiAgICAgICAgcCA9IG5vZGU7XG4gICAgICAgIG5vZGUgPSBub2RlLmdldF9jaGlsZChkaXIpO1xuXG4gICAgICAgIHZhciBjbXAgPSB0aGlzLl9jb21wYXJhdG9yKGRhdGEsIG5vZGUuZGF0YSk7XG5cbiAgICAgICAgZGlyID0gY21wID4gMDtcblxuICAgICAgICAvLyBzYXZlIGZvdW5kIG5vZGVcbiAgICAgICAgaWYoY21wID09PSAwKSB7XG4gICAgICAgICAgICBmb3VuZCA9IG5vZGU7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBwdXNoIHRoZSByZWQgbm9kZSBkb3duXG4gICAgICAgIGlmKCFpc19yZWQobm9kZSkgJiYgIWlzX3JlZChub2RlLmdldF9jaGlsZChkaXIpKSkge1xuICAgICAgICAgICAgaWYoaXNfcmVkKG5vZGUuZ2V0X2NoaWxkKCFkaXIpKSkge1xuICAgICAgICAgICAgICAgIHZhciBzciA9IHNpbmdsZV9yb3RhdGUobm9kZSwgZGlyKTtcbiAgICAgICAgICAgICAgICBwLnNldF9jaGlsZChsYXN0LCBzcik7XG4gICAgICAgICAgICAgICAgcCA9IHNyO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZSBpZighaXNfcmVkKG5vZGUuZ2V0X2NoaWxkKCFkaXIpKSkge1xuICAgICAgICAgICAgICAgIHZhciBzaWJsaW5nID0gcC5nZXRfY2hpbGQoIWxhc3QpO1xuICAgICAgICAgICAgICAgIGlmKHNpYmxpbmcgIT09IG51bGwpIHtcbiAgICAgICAgICAgICAgICAgICAgaWYoIWlzX3JlZChzaWJsaW5nLmdldF9jaGlsZCghbGFzdCkpICYmICFpc19yZWQoc2libGluZy5nZXRfY2hpbGQobGFzdCkpKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBjb2xvciBmbGlwXG4gICAgICAgICAgICAgICAgICAgICAgICBwLnJlZCA9IGZhbHNlO1xuICAgICAgICAgICAgICAgICAgICAgICAgc2libGluZy5yZWQgPSB0cnVlO1xuICAgICAgICAgICAgICAgICAgICAgICAgbm9kZS5yZWQgPSB0cnVlO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgICAgdmFyIGRpcjIgPSBncC5yaWdodCA9PT0gcDtcblxuICAgICAgICAgICAgICAgICAgICAgICAgaWYoaXNfcmVkKHNpYmxpbmcuZ2V0X2NoaWxkKGxhc3QpKSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGdwLnNldF9jaGlsZChkaXIyLCBkb3VibGVfcm90YXRlKHAsIGxhc3QpKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIGVsc2UgaWYoaXNfcmVkKHNpYmxpbmcuZ2V0X2NoaWxkKCFsYXN0KSkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBncC5zZXRfY2hpbGQoZGlyMiwgc2luZ2xlX3JvdGF0ZShwLCBsYXN0KSk7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIGVuc3VyZSBjb3JyZWN0IGNvbG9yaW5nXG4gICAgICAgICAgICAgICAgICAgICAgICB2YXIgZ3BjID0gZ3AuZ2V0X2NoaWxkKGRpcjIpO1xuICAgICAgICAgICAgICAgICAgICAgICAgZ3BjLnJlZCA9IHRydWU7XG4gICAgICAgICAgICAgICAgICAgICAgICBub2RlLnJlZCA9IHRydWU7XG4gICAgICAgICAgICAgICAgICAgICAgICBncGMubGVmdC5yZWQgPSBmYWxzZTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGdwYy5yaWdodC5yZWQgPSBmYWxzZTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8vIHJlcGxhY2UgYW5kIHJlbW92ZSBpZiBmb3VuZFxuICAgIGlmKGZvdW5kICE9PSBudWxsKSB7XG4gICAgICAgIGZvdW5kLmRhdGEgPSBub2RlLmRhdGE7XG4gICAgICAgIHAuc2V0X2NoaWxkKHAucmlnaHQgPT09IG5vZGUsIG5vZGUuZ2V0X2NoaWxkKG5vZGUubGVmdCA9PT0gbnVsbCkpO1xuICAgICAgICB0aGlzLnNpemUtLTtcbiAgICB9XG5cbiAgICAvLyB1cGRhdGUgcm9vdCBhbmQgbWFrZSBpdCBibGFja1xuICAgIHRoaXMuX3Jvb3QgPSBoZWFkLnJpZ2h0O1xuICAgIGlmKHRoaXMuX3Jvb3QgIT09IG51bGwpIHtcbiAgICAgICAgdGhpcy5fcm9vdC5yZWQgPSBmYWxzZTtcbiAgICB9XG5cbiAgICByZXR1cm4gZm91bmQgIT09IG51bGw7XG59O1xuXG5mdW5jdGlvbiBpc19yZWQobm9kZSkge1xuICAgIHJldHVybiBub2RlICE9PSBudWxsICYmIG5vZGUucmVkO1xufVxuXG5mdW5jdGlvbiBzaW5nbGVfcm90YXRlKHJvb3QsIGRpcikge1xuICAgIHZhciBzYXZlID0gcm9vdC5nZXRfY2hpbGQoIWRpcik7XG5cbiAgICByb290LnNldF9jaGlsZCghZGlyLCBzYXZlLmdldF9jaGlsZChkaXIpKTtcbiAgICBzYXZlLnNldF9jaGlsZChkaXIsIHJvb3QpO1xuXG4gICAgcm9vdC5yZWQgPSB0cnVlO1xuICAgIHNhdmUucmVkID0gZmFsc2U7XG5cbiAgICByZXR1cm4gc2F2ZTtcbn1cblxuZnVuY3Rpb24gZG91YmxlX3JvdGF0ZShyb290LCBkaXIpIHtcbiAgICByb290LnNldF9jaGlsZCghZGlyLCBzaW5nbGVfcm90YXRlKHJvb3QuZ2V0X2NoaWxkKCFkaXIpLCAhZGlyKSk7XG4gICAgcmV0dXJuIHNpbmdsZV9yb3RhdGUocm9vdCwgZGlyKTtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSBSQlRyZWU7XG4iLCJcbmZ1bmN0aW9uIFRyZWVCYXNlKCkge31cblxuLy8gcmVtb3ZlcyBhbGwgbm9kZXMgZnJvbSB0aGUgdHJlZVxuVHJlZUJhc2UucHJvdG90eXBlLmNsZWFyID0gZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5fcm9vdCA9IG51bGw7XG4gICAgdGhpcy5zaXplID0gMDtcbn07XG5cbi8vIHJldHVybnMgbm9kZSBkYXRhIGlmIGZvdW5kLCBudWxsIG90aGVyd2lzZVxuVHJlZUJhc2UucHJvdG90eXBlLmZpbmQgPSBmdW5jdGlvbihkYXRhKSB7XG4gICAgdmFyIHJlcyA9IHRoaXMuX3Jvb3Q7XG5cbiAgICB3aGlsZShyZXMgIT09IG51bGwpIHtcbiAgICAgICAgdmFyIGMgPSB0aGlzLl9jb21wYXJhdG9yKGRhdGEsIHJlcy5kYXRhKTtcbiAgICAgICAgaWYoYyA9PT0gMCkge1xuICAgICAgICAgICAgcmV0dXJuIHJlcy5kYXRhO1xuICAgICAgICB9XG4gICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgcmVzID0gcmVzLmdldF9jaGlsZChjID4gMCk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gbnVsbDtcbn07XG5cbi8vIHJldHVybnMgaXRlcmF0b3IgdG8gbm9kZSBpZiBmb3VuZCwgbnVsbCBvdGhlcndpc2VcblRyZWVCYXNlLnByb3RvdHlwZS5maW5kSXRlciA9IGZ1bmN0aW9uKGRhdGEpIHtcbiAgICB2YXIgcmVzID0gdGhpcy5fcm9vdDtcbiAgICB2YXIgaXRlciA9IHRoaXMuaXRlcmF0b3IoKTtcblxuICAgIHdoaWxlKHJlcyAhPT0gbnVsbCkge1xuICAgICAgICB2YXIgYyA9IHRoaXMuX2NvbXBhcmF0b3IoZGF0YSwgcmVzLmRhdGEpO1xuICAgICAgICBpZihjID09PSAwKSB7XG4gICAgICAgICAgICBpdGVyLl9jdXJzb3IgPSByZXM7XG4gICAgICAgICAgICByZXR1cm4gaXRlcjtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgIGl0ZXIuX2FuY2VzdG9ycy5wdXNoKHJlcyk7XG4gICAgICAgICAgICByZXMgPSByZXMuZ2V0X2NoaWxkKGMgPiAwKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBudWxsO1xufTtcblxuLy8gUmV0dXJucyBhbiBpdGVyYXRvciB0byB0aGUgdHJlZSBub2RlIGF0IG9yIGltbWVkaWF0ZWx5IGFmdGVyIHRoZSBpdGVtXG5UcmVlQmFzZS5wcm90b3R5cGUubG93ZXJCb3VuZCA9IGZ1bmN0aW9uKGl0ZW0pIHtcbiAgICB2YXIgY3VyID0gdGhpcy5fcm9vdDtcbiAgICB2YXIgaXRlciA9IHRoaXMuaXRlcmF0b3IoKTtcbiAgICB2YXIgY21wID0gdGhpcy5fY29tcGFyYXRvcjtcblxuICAgIHdoaWxlKGN1ciAhPT0gbnVsbCkge1xuICAgICAgICB2YXIgYyA9IGNtcChpdGVtLCBjdXIuZGF0YSk7XG4gICAgICAgIGlmKGMgPT09IDApIHtcbiAgICAgICAgICAgIGl0ZXIuX2N1cnNvciA9IGN1cjtcbiAgICAgICAgICAgIHJldHVybiBpdGVyO1xuICAgICAgICB9XG4gICAgICAgIGl0ZXIuX2FuY2VzdG9ycy5wdXNoKGN1cik7XG4gICAgICAgIGN1ciA9IGN1ci5nZXRfY2hpbGQoYyA+IDApO1xuICAgIH1cblxuICAgIGZvcih2YXIgaT1pdGVyLl9hbmNlc3RvcnMubGVuZ3RoIC0gMTsgaSA+PSAwOyAtLWkpIHtcbiAgICAgICAgY3VyID0gaXRlci5fYW5jZXN0b3JzW2ldO1xuICAgICAgICBpZihjbXAoaXRlbSwgY3VyLmRhdGEpIDwgMCkge1xuICAgICAgICAgICAgaXRlci5fY3Vyc29yID0gY3VyO1xuICAgICAgICAgICAgaXRlci5fYW5jZXN0b3JzLmxlbmd0aCA9IGk7XG4gICAgICAgICAgICByZXR1cm4gaXRlcjtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGl0ZXIuX2FuY2VzdG9ycy5sZW5ndGggPSAwO1xuICAgIHJldHVybiBpdGVyO1xufTtcblxuLy8gUmV0dXJucyBhbiBpdGVyYXRvciB0byB0aGUgdHJlZSBub2RlIGltbWVkaWF0ZWx5IGFmdGVyIHRoZSBpdGVtXG5UcmVlQmFzZS5wcm90b3R5cGUudXBwZXJCb3VuZCA9IGZ1bmN0aW9uKGl0ZW0pIHtcbiAgICB2YXIgaXRlciA9IHRoaXMubG93ZXJCb3VuZChpdGVtKTtcbiAgICB2YXIgY21wID0gdGhpcy5fY29tcGFyYXRvcjtcblxuICAgIHdoaWxlKGl0ZXIuZGF0YSgpICE9PSBudWxsICYmIGNtcChpdGVyLmRhdGEoKSwgaXRlbSkgPT09IDApIHtcbiAgICAgICAgaXRlci5uZXh0KCk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGl0ZXI7XG59O1xuXG4vLyByZXR1cm5zIG51bGwgaWYgdHJlZSBpcyBlbXB0eVxuVHJlZUJhc2UucHJvdG90eXBlLm1pbiA9IGZ1bmN0aW9uKCkge1xuICAgIHZhciByZXMgPSB0aGlzLl9yb290O1xuICAgIGlmKHJlcyA9PT0gbnVsbCkge1xuICAgICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG5cbiAgICB3aGlsZShyZXMubGVmdCAhPT0gbnVsbCkge1xuICAgICAgICByZXMgPSByZXMubGVmdDtcbiAgICB9XG5cbiAgICByZXR1cm4gcmVzLmRhdGE7XG59O1xuXG4vLyByZXR1cm5zIG51bGwgaWYgdHJlZSBpcyBlbXB0eVxuVHJlZUJhc2UucHJvdG90eXBlLm1heCA9IGZ1bmN0aW9uKCkge1xuICAgIHZhciByZXMgPSB0aGlzLl9yb290O1xuICAgIGlmKHJlcyA9PT0gbnVsbCkge1xuICAgICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG5cbiAgICB3aGlsZShyZXMucmlnaHQgIT09IG51bGwpIHtcbiAgICAgICAgcmVzID0gcmVzLnJpZ2h0O1xuICAgIH1cblxuICAgIHJldHVybiByZXMuZGF0YTtcbn07XG5cbi8vIHJldHVybnMgYSBudWxsIGl0ZXJhdG9yXG4vLyBjYWxsIG5leHQoKSBvciBwcmV2KCkgdG8gcG9pbnQgdG8gYW4gZWxlbWVudFxuVHJlZUJhc2UucHJvdG90eXBlLml0ZXJhdG9yID0gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIG5ldyBJdGVyYXRvcih0aGlzKTtcbn07XG5cbi8vIGNhbGxzIGNiIG9uIGVhY2ggbm9kZSdzIGRhdGEsIGluIG9yZGVyXG5UcmVlQmFzZS5wcm90b3R5cGUuZWFjaCA9IGZ1bmN0aW9uKGNiKSB7XG4gICAgdmFyIGl0PXRoaXMuaXRlcmF0b3IoKSwgZGF0YTtcbiAgICB3aGlsZSgoZGF0YSA9IGl0Lm5leHQoKSkgIT09IG51bGwpIHtcbiAgICAgICAgY2IoZGF0YSk7XG4gICAgfVxufTtcblxuLy8gY2FsbHMgY2Igb24gZWFjaCBub2RlJ3MgZGF0YSwgaW4gcmV2ZXJzZSBvcmRlclxuVHJlZUJhc2UucHJvdG90eXBlLnJlYWNoID0gZnVuY3Rpb24oY2IpIHtcbiAgICB2YXIgaXQ9dGhpcy5pdGVyYXRvcigpLCBkYXRhO1xuICAgIHdoaWxlKChkYXRhID0gaXQucHJldigpKSAhPT0gbnVsbCkge1xuICAgICAgICBjYihkYXRhKTtcbiAgICB9XG59O1xuXG5cbmZ1bmN0aW9uIEl0ZXJhdG9yKHRyZWUpIHtcbiAgICB0aGlzLl90cmVlID0gdHJlZTtcbiAgICB0aGlzLl9hbmNlc3RvcnMgPSBbXTtcbiAgICB0aGlzLl9jdXJzb3IgPSBudWxsO1xufVxuXG5JdGVyYXRvci5wcm90b3R5cGUuZGF0YSA9IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiB0aGlzLl9jdXJzb3IgIT09IG51bGwgPyB0aGlzLl9jdXJzb3IuZGF0YSA6IG51bGw7XG59O1xuXG4vLyBpZiBudWxsLWl0ZXJhdG9yLCByZXR1cm5zIGZpcnN0IG5vZGVcbi8vIG90aGVyd2lzZSwgcmV0dXJucyBuZXh0IG5vZGVcbkl0ZXJhdG9yLnByb3RvdHlwZS5uZXh0ID0gZnVuY3Rpb24oKSB7XG4gICAgaWYodGhpcy5fY3Vyc29yID09PSBudWxsKSB7XG4gICAgICAgIHZhciByb290ID0gdGhpcy5fdHJlZS5fcm9vdDtcbiAgICAgICAgaWYocm9vdCAhPT0gbnVsbCkge1xuICAgICAgICAgICAgdGhpcy5fbWluTm9kZShyb290KTtcbiAgICAgICAgfVxuICAgIH1cbiAgICBlbHNlIHtcbiAgICAgICAgaWYodGhpcy5fY3Vyc29yLnJpZ2h0ID09PSBudWxsKSB7XG4gICAgICAgICAgICAvLyBubyBncmVhdGVyIG5vZGUgaW4gc3VidHJlZSwgZ28gdXAgdG8gcGFyZW50XG4gICAgICAgICAgICAvLyBpZiBjb21pbmcgZnJvbSBhIHJpZ2h0IGNoaWxkLCBjb250aW51ZSB1cCB0aGUgc3RhY2tcbiAgICAgICAgICAgIHZhciBzYXZlO1xuICAgICAgICAgICAgZG8ge1xuICAgICAgICAgICAgICAgIHNhdmUgPSB0aGlzLl9jdXJzb3I7XG4gICAgICAgICAgICAgICAgaWYodGhpcy5fYW5jZXN0b3JzLmxlbmd0aCkge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLl9jdXJzb3IgPSB0aGlzLl9hbmNlc3RvcnMucG9wKCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLl9jdXJzb3IgPSBudWxsO1xuICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9IHdoaWxlKHRoaXMuX2N1cnNvci5yaWdodCA9PT0gc2F2ZSk7XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAvLyBnZXQgdGhlIG5leHQgbm9kZSBmcm9tIHRoZSBzdWJ0cmVlXG4gICAgICAgICAgICB0aGlzLl9hbmNlc3RvcnMucHVzaCh0aGlzLl9jdXJzb3IpO1xuICAgICAgICAgICAgdGhpcy5fbWluTm9kZSh0aGlzLl9jdXJzb3IucmlnaHQpO1xuICAgICAgICB9XG4gICAgfVxuICAgIHJldHVybiB0aGlzLl9jdXJzb3IgIT09IG51bGwgPyB0aGlzLl9jdXJzb3IuZGF0YSA6IG51bGw7XG59O1xuXG4vLyBpZiBudWxsLWl0ZXJhdG9yLCByZXR1cm5zIGxhc3Qgbm9kZVxuLy8gb3RoZXJ3aXNlLCByZXR1cm5zIHByZXZpb3VzIG5vZGVcbkl0ZXJhdG9yLnByb3RvdHlwZS5wcmV2ID0gZnVuY3Rpb24oKSB7XG4gICAgaWYodGhpcy5fY3Vyc29yID09PSBudWxsKSB7XG4gICAgICAgIHZhciByb290ID0gdGhpcy5fdHJlZS5fcm9vdDtcbiAgICAgICAgaWYocm9vdCAhPT0gbnVsbCkge1xuICAgICAgICAgICAgdGhpcy5fbWF4Tm9kZShyb290KTtcbiAgICAgICAgfVxuICAgIH1cbiAgICBlbHNlIHtcbiAgICAgICAgaWYodGhpcy5fY3Vyc29yLmxlZnQgPT09IG51bGwpIHtcbiAgICAgICAgICAgIHZhciBzYXZlO1xuICAgICAgICAgICAgZG8ge1xuICAgICAgICAgICAgICAgIHNhdmUgPSB0aGlzLl9jdXJzb3I7XG4gICAgICAgICAgICAgICAgaWYodGhpcy5fYW5jZXN0b3JzLmxlbmd0aCkge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLl9jdXJzb3IgPSB0aGlzLl9hbmNlc3RvcnMucG9wKCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLl9jdXJzb3IgPSBudWxsO1xuICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9IHdoaWxlKHRoaXMuX2N1cnNvci5sZWZ0ID09PSBzYXZlKTtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgIHRoaXMuX2FuY2VzdG9ycy5wdXNoKHRoaXMuX2N1cnNvcik7XG4gICAgICAgICAgICB0aGlzLl9tYXhOb2RlKHRoaXMuX2N1cnNvci5sZWZ0KTtcbiAgICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gdGhpcy5fY3Vyc29yICE9PSBudWxsID8gdGhpcy5fY3Vyc29yLmRhdGEgOiBudWxsO1xufTtcblxuSXRlcmF0b3IucHJvdG90eXBlLl9taW5Ob2RlID0gZnVuY3Rpb24oc3RhcnQpIHtcbiAgICB3aGlsZShzdGFydC5sZWZ0ICE9PSBudWxsKSB7XG4gICAgICAgIHRoaXMuX2FuY2VzdG9ycy5wdXNoKHN0YXJ0KTtcbiAgICAgICAgc3RhcnQgPSBzdGFydC5sZWZ0O1xuICAgIH1cbiAgICB0aGlzLl9jdXJzb3IgPSBzdGFydDtcbn07XG5cbkl0ZXJhdG9yLnByb3RvdHlwZS5fbWF4Tm9kZSA9IGZ1bmN0aW9uKHN0YXJ0KSB7XG4gICAgd2hpbGUoc3RhcnQucmlnaHQgIT09IG51bGwpIHtcbiAgICAgICAgdGhpcy5fYW5jZXN0b3JzLnB1c2goc3RhcnQpO1xuICAgICAgICBzdGFydCA9IHN0YXJ0LnJpZ2h0O1xuICAgIH1cbiAgICB0aGlzLl9jdXJzb3IgPSBzdGFydDtcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gVHJlZUJhc2U7XG5cbiIsIjshZnVuY3Rpb24gKCkgeztcbnZhciBKb29zZSA9IHt9XG5cbi8vIGNvbmZpZ3VyYXRpb24gaGFzaFxuXG5Kb29zZS5DICAgICAgICAgICAgID0gdHlwZW9mIEpPT1NFX0NGRyAhPSAndW5kZWZpbmVkJyA/IEpPT1NFX0NGRyA6IHt9XG5cbkpvb3NlLmlzX0lFICAgICAgICAgPSAnXFx2JyA9PSAndidcbkpvb3NlLmlzX05vZGVKUyAgICAgPSBCb29sZWFuKHR5cGVvZiBwcm9jZXNzICE9ICd1bmRlZmluZWQnICYmIHByb2Nlc3MucGlkKVxuXG5cbkpvb3NlLnRvcCAgICAgICAgICAgPSBKb29zZS5pc19Ob2RlSlMgJiYgZ2xvYmFsIHx8IHRoaXNcblxuSm9vc2Uuc3R1YiAgICAgICAgICA9IGZ1bmN0aW9uICgpIHtcbiAgICByZXR1cm4gZnVuY3Rpb24gKCkgeyB0aHJvdyBuZXcgRXJyb3IoXCJNb2R1bGVzIGNhbiBub3QgYmUgaW5zdGFudGlhdGVkXCIpIH1cbn1cblxuXG5Kb29zZS5WRVJTSU9OICAgICAgID0gKHsgLypQS0dWRVJTSU9OKi9WRVJTSU9OIDogJzMuNTAuMCcgfSkuVkVSU0lPTlxuXG5cbmlmICh0eXBlb2YgbW9kdWxlICE9ICd1bmRlZmluZWQnKSBtb2R1bGUuZXhwb3J0cyA9IEpvb3NlXG4vKmlmICghSm9vc2UuaXNfTm9kZUpTKSAqL1xudGhpcy5Kb29zZSA9IEpvb3NlXG5cblxuLy8gU3RhdGljIGhlbHBlcnMgZm9yIEFycmF5c1xuSm9vc2UuQSA9IHtcblxuICAgIGVhY2ggOiBmdW5jdGlvbiAoYXJyYXksIGZ1bmMsIHNjb3BlKSB7XG4gICAgICAgIHNjb3BlID0gc2NvcGUgfHwgdGhpc1xuICAgICAgICBcbiAgICAgICAgZm9yICh2YXIgaSA9IDAsIGxlbiA9IGFycmF5Lmxlbmd0aDsgaSA8IGxlbjsgaSsrKSBcbiAgICAgICAgICAgIGlmIChmdW5jLmNhbGwoc2NvcGUsIGFycmF5W2ldLCBpKSA9PT0gZmFsc2UpIHJldHVybiBmYWxzZVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgZWFjaFIgOiBmdW5jdGlvbiAoYXJyYXksIGZ1bmMsIHNjb3BlKSB7XG4gICAgICAgIHNjb3BlID0gc2NvcGUgfHwgdGhpc1xuXG4gICAgICAgIGZvciAodmFyIGkgPSBhcnJheS5sZW5ndGggLSAxOyBpID49IDA7IGktLSkgXG4gICAgICAgICAgICBpZiAoZnVuYy5jYWxsKHNjb3BlLCBhcnJheVtpXSwgaSkgPT09IGZhbHNlKSByZXR1cm4gZmFsc2VcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGV4aXN0cyA6IGZ1bmN0aW9uIChhcnJheSwgdmFsdWUpIHtcbiAgICAgICAgZm9yICh2YXIgaSA9IDAsIGxlbiA9IGFycmF5Lmxlbmd0aDsgaSA8IGxlbjsgaSsrKSBpZiAoYXJyYXlbaV0gPT0gdmFsdWUpIHJldHVybiB0cnVlXG4gICAgICAgICAgICBcbiAgICAgICAgcmV0dXJuIGZhbHNlXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBtYXAgOiBmdW5jdGlvbiAoYXJyYXksIGZ1bmMsIHNjb3BlKSB7XG4gICAgICAgIHNjb3BlID0gc2NvcGUgfHwgdGhpc1xuICAgICAgICBcbiAgICAgICAgdmFyIHJlcyA9IFtdXG4gICAgICAgIFxuICAgICAgICBmb3IgKHZhciBpID0gMCwgbGVuID0gYXJyYXkubGVuZ3RoOyBpIDwgbGVuOyBpKyspIFxuICAgICAgICAgICAgcmVzLnB1c2goIGZ1bmMuY2FsbChzY29wZSwgYXJyYXlbaV0sIGkpIClcbiAgICAgICAgICAgIFxuICAgICAgICByZXR1cm4gcmVzXG4gICAgfSxcbiAgICBcblxuICAgIGdyZXAgOiBmdW5jdGlvbiAoYXJyYXksIGZ1bmMpIHtcbiAgICAgICAgdmFyIGEgPSBbXVxuICAgICAgICBcbiAgICAgICAgSm9vc2UuQS5lYWNoKGFycmF5LCBmdW5jdGlvbiAodCkge1xuICAgICAgICAgICAgaWYgKGZ1bmModCkpIGEucHVzaCh0KVxuICAgICAgICB9KVxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIGFcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIHJlbW92ZSA6IGZ1bmN0aW9uIChhcnJheSwgcmVtb3ZlRWxlKSB7XG4gICAgICAgIHZhciBhID0gW11cbiAgICAgICAgXG4gICAgICAgIEpvb3NlLkEuZWFjaChhcnJheSwgZnVuY3Rpb24gKHQpIHtcbiAgICAgICAgICAgIGlmICh0ICE9PSByZW1vdmVFbGUpIGEucHVzaCh0KVxuICAgICAgICB9KVxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIGFcbiAgICB9XG4gICAgXG59XG5cbi8vIFN0YXRpYyBoZWxwZXJzIGZvciBTdHJpbmdzXG5Kb29zZS5TID0ge1xuICAgIFxuICAgIHNhbmVTcGxpdCA6IGZ1bmN0aW9uIChzdHIsIGRlbGltZXRlcikge1xuICAgICAgICB2YXIgcmVzID0gKHN0ciB8fCAnJykuc3BsaXQoZGVsaW1ldGVyKVxuICAgICAgICBcbiAgICAgICAgaWYgKHJlcy5sZW5ndGggPT0gMSAmJiAhcmVzWzBdKSByZXMuc2hpZnQoKVxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIHJlc1xuICAgIH0sXG4gICAgXG5cbiAgICB1cHBlcmNhc2VGaXJzdCA6IGZ1bmN0aW9uIChzdHJpbmcpIHsgXG4gICAgICAgIHJldHVybiBzdHJpbmcuc3Vic3RyKDAsIDEpLnRvVXBwZXJDYXNlKCkgKyBzdHJpbmcuc3Vic3RyKDEsIHN0cmluZy5sZW5ndGggLSAxKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgc3RyVG9DbGFzcyA6IGZ1bmN0aW9uIChuYW1lLCB0b3ApIHtcbiAgICAgICAgdmFyIGN1cnJlbnQgPSB0b3AgfHwgSm9vc2UudG9wXG4gICAgICAgIFxuICAgICAgICBKb29zZS5BLmVhY2gobmFtZS5zcGxpdCgnLicpLCBmdW5jdGlvbiAoc2VnbWVudCkge1xuICAgICAgICAgICAgaWYgKGN1cnJlbnQpIFxuICAgICAgICAgICAgICAgIGN1cnJlbnQgPSBjdXJyZW50WyBzZWdtZW50IF1cbiAgICAgICAgICAgIGVsc2VcbiAgICAgICAgICAgICAgICByZXR1cm4gZmFsc2VcbiAgICAgICAgfSlcbiAgICAgICAgXG4gICAgICAgIHJldHVybiBjdXJyZW50XG4gICAgfVxufVxuXG52YXIgYmFzZUZ1bmMgICAgPSBmdW5jdGlvbiAoKSB7fVxuXG4vLyBTdGF0aWMgaGVscGVycyBmb3Igb2JqZWN0c1xuSm9vc2UuTyA9IHtcblxuICAgIGVhY2ggOiBmdW5jdGlvbiAob2JqZWN0LCBmdW5jLCBzY29wZSkge1xuICAgICAgICBzY29wZSA9IHNjb3BlIHx8IHRoaXNcbiAgICAgICAgXG4gICAgICAgIGZvciAodmFyIGkgaW4gb2JqZWN0KSBcbiAgICAgICAgICAgIGlmIChmdW5jLmNhbGwoc2NvcGUsIG9iamVjdFtpXSwgaSkgPT09IGZhbHNlKSByZXR1cm4gZmFsc2VcbiAgICAgICAgXG4gICAgICAgIGlmIChKb29zZS5pc19JRSkgXG4gICAgICAgICAgICByZXR1cm4gSm9vc2UuQS5lYWNoKFsgJ3RvU3RyaW5nJywgJ2NvbnN0cnVjdG9yJywgJ2hhc093blByb3BlcnR5JyBdLCBmdW5jdGlvbiAoZWwpIHtcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBpZiAob2JqZWN0Lmhhc093blByb3BlcnR5KGVsKSkgcmV0dXJuIGZ1bmMuY2FsbChzY29wZSwgb2JqZWN0W2VsXSwgZWwpXG4gICAgICAgICAgICB9KVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgZWFjaE93biA6IGZ1bmN0aW9uIChvYmplY3QsIGZ1bmMsIHNjb3BlKSB7XG4gICAgICAgIHNjb3BlID0gc2NvcGUgfHwgdGhpc1xuICAgICAgICBcbiAgICAgICAgcmV0dXJuIEpvb3NlLk8uZWFjaChvYmplY3QsIGZ1bmN0aW9uICh2YWx1ZSwgbmFtZSkge1xuICAgICAgICAgICAgaWYgKG9iamVjdC5oYXNPd25Qcm9wZXJ0eShuYW1lKSkgcmV0dXJuIGZ1bmMuY2FsbChzY29wZSwgdmFsdWUsIG5hbWUpXG4gICAgICAgIH0sIHNjb3BlKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgY29weSA6IGZ1bmN0aW9uIChzb3VyY2UsIHRhcmdldCkge1xuICAgICAgICB0YXJnZXQgPSB0YXJnZXQgfHwge31cbiAgICAgICAgXG4gICAgICAgIEpvb3NlLk8uZWFjaChzb3VyY2UsIGZ1bmN0aW9uICh2YWx1ZSwgbmFtZSkgeyB0YXJnZXRbbmFtZV0gPSB2YWx1ZSB9KVxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIHRhcmdldFxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgY29weU93biA6IGZ1bmN0aW9uIChzb3VyY2UsIHRhcmdldCkge1xuICAgICAgICB0YXJnZXQgPSB0YXJnZXQgfHwge31cbiAgICAgICAgXG4gICAgICAgIEpvb3NlLk8uZWFjaE93bihzb3VyY2UsIGZ1bmN0aW9uICh2YWx1ZSwgbmFtZSkgeyB0YXJnZXRbbmFtZV0gPSB2YWx1ZSB9KVxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIHRhcmdldFxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgZ2V0TXV0YWJsZUNvcHkgOiBmdW5jdGlvbiAob2JqZWN0KSB7XG4gICAgICAgIGJhc2VGdW5jLnByb3RvdHlwZSA9IG9iamVjdFxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIG5ldyBiYXNlRnVuYygpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBleHRlbmQgOiBmdW5jdGlvbiAodGFyZ2V0LCBzb3VyY2UpIHtcbiAgICAgICAgcmV0dXJuIEpvb3NlLk8uY29weShzb3VyY2UsIHRhcmdldClcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGlzRW1wdHkgOiBmdW5jdGlvbiAob2JqZWN0KSB7XG4gICAgICAgIGZvciAodmFyIGkgaW4gb2JqZWN0KSBpZiAob2JqZWN0Lmhhc093blByb3BlcnR5KGkpKSByZXR1cm4gZmFsc2VcbiAgICAgICAgXG4gICAgICAgIHJldHVybiB0cnVlXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBpc0luc3RhbmNlOiBmdW5jdGlvbiAob2JqKSB7XG4gICAgICAgIHJldHVybiBvYmogJiYgb2JqLm1ldGEgJiYgb2JqLmNvbnN0cnVjdG9yID09IG9iai5tZXRhLmNcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGlzQ2xhc3MgOiBmdW5jdGlvbiAob2JqKSB7XG4gICAgICAgIHJldHVybiBvYmogJiYgb2JqLm1ldGEgJiYgb2JqLm1ldGEuYyA9PSBvYmpcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIHdhbnRBcnJheSA6IGZ1bmN0aW9uIChvYmopIHtcbiAgICAgICAgaWYgKG9iaiBpbnN0YW5jZW9mIEFycmF5KSByZXR1cm4gb2JqXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gWyBvYmogXVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgLy8gdGhpcyB3YXMgYSBidWcgaW4gV2ViS2l0LCB3aGljaCBnaXZlcyB0eXBlb2YgLyAvID09ICdmdW5jdGlvbidcbiAgICAvLyBzaG91bGQgYmUgbW9uaXRvcmVkIGFuZCByZW1vdmVkIGF0IHNvbWUgcG9pbnQgaW4gdGhlIGZ1dHVyZVxuICAgIGlzRnVuY3Rpb24gOiBmdW5jdGlvbiAob2JqKSB7XG4gICAgICAgIHJldHVybiB0eXBlb2Ygb2JqID09ICdmdW5jdGlvbicgJiYgb2JqLmNvbnN0cnVjdG9yICE9IC8gLy5jb25zdHJ1Y3RvclxuICAgIH1cbn1cblxuXG4vL2luaXRpYWxpemVyc1xuXG5Kb29zZS5JID0ge1xuICAgIEFycmF5ICAgICAgIDogZnVuY3Rpb24gKCkgeyByZXR1cm4gW10gfSxcbiAgICBPYmplY3QgICAgICA6IGZ1bmN0aW9uICgpIHsgcmV0dXJuIHt9IH0sXG4gICAgRnVuY3Rpb24gICAgOiBmdW5jdGlvbiAoKSB7IHJldHVybiBhcmd1bWVudHMuY2FsbGVlIH0sXG4gICAgTm93ICAgICAgICAgOiBmdW5jdGlvbiAoKSB7IHJldHVybiBuZXcgRGF0ZSgpIH1cbn07XG5Kb29zZS5Qcm90byA9IEpvb3NlLnN0dWIoKVxuXG5Kb29zZS5Qcm90by5FbXB0eSA9IEpvb3NlLnN0dWIoKVxuICAgIFxuSm9vc2UuUHJvdG8uRW1wdHkubWV0YSA9IHt9O1xuOyhmdW5jdGlvbiAoKSB7XG5cbiAgICBKb29zZS5Qcm90by5PYmplY3QgPSBKb29zZS5zdHViKClcbiAgICBcbiAgICBcbiAgICB2YXIgU1VQRVIgPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHZhciBzZWxmID0gU1VQRVIuY2FsbGVyXG4gICAgICAgIFxuICAgICAgICBpZiAoc2VsZiA9PSBTVVBFUkFSRykgc2VsZiA9IHNlbGYuY2FsbGVyXG4gICAgICAgIFxuICAgICAgICBpZiAoIXNlbGYuU1VQRVIpIHRocm93IFwiSW52YWxpZCBjYWxsIHRvIFNVUEVSXCJcbiAgICAgICAgXG4gICAgICAgIHJldHVybiBzZWxmLlNVUEVSW3NlbGYubWV0aG9kTmFtZV0uYXBwbHkodGhpcywgYXJndW1lbnRzKVxuICAgIH1cbiAgICBcbiAgICBcbiAgICB2YXIgU1VQRVJBUkcgPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHJldHVybiB0aGlzLlNVUEVSLmFwcGx5KHRoaXMsIGFyZ3VtZW50c1swXSlcbiAgICB9XG4gICAgXG4gICAgXG4gICAgXG4gICAgSm9vc2UuUHJvdG8uT2JqZWN0LnByb3RvdHlwZSA9IHtcbiAgICAgICAgXG4gICAgICAgIFNVUEVSQVJHIDogU1VQRVJBUkcsXG4gICAgICAgIFNVUEVSIDogU1VQRVIsXG4gICAgICAgIFxuICAgICAgICBJTk5FUiA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHRocm93IFwiSW52YWxpZCBjYWxsIHRvIElOTkVSXCJcbiAgICAgICAgfSwgICAgICAgICAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgQlVJTEQgOiBmdW5jdGlvbiAoY29uZmlnKSB7XG4gICAgICAgICAgICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aCA9PSAxICYmIHR5cGVvZiBjb25maWcgPT0gJ29iamVjdCcgJiYgY29uZmlnIHx8IHt9XG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgaW5pdGlhbGl6ZTogZnVuY3Rpb24gKCkge1xuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIHRvU3RyaW5nOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICByZXR1cm4gXCJhIFwiICsgdGhpcy5tZXRhLm5hbWVcbiAgICAgICAgfVxuICAgICAgICBcbiAgICB9XG4gICAgICAgIFxuICAgIEpvb3NlLlByb3RvLk9iamVjdC5tZXRhID0ge1xuICAgICAgICBjb25zdHJ1Y3RvciAgICAgOiBKb29zZS5Qcm90by5PYmplY3QsXG4gICAgICAgIFxuICAgICAgICBtZXRob2RzICAgICAgICAgOiBKb29zZS5PLmNvcHkoSm9vc2UuUHJvdG8uT2JqZWN0LnByb3RvdHlwZSksXG4gICAgICAgIGF0dHJpYnV0ZXMgICAgICA6IHt9XG4gICAgfVxuICAgIFxuICAgIEpvb3NlLlByb3RvLk9iamVjdC5wcm90b3R5cGUubWV0YSA9IEpvb3NlLlByb3RvLk9iamVjdC5tZXRhXG5cbn0pKCk7XG47KGZ1bmN0aW9uICgpIHtcblxuICAgIEpvb3NlLlByb3RvLkNsYXNzID0gZnVuY3Rpb24gKCkge1xuICAgICAgICByZXR1cm4gdGhpcy5pbml0aWFsaXplKHRoaXMuQlVJTEQuYXBwbHkodGhpcywgYXJndW1lbnRzKSkgfHwgdGhpc1xuICAgIH1cbiAgICBcbiAgICB2YXIgYm9vdHN0cmFwID0ge1xuICAgICAgICBcbiAgICAgICAgVkVSU0lPTiAgICAgICAgICAgICA6IG51bGwsXG4gICAgICAgIEFVVEhPUklUWSAgICAgICAgICAgOiBudWxsLFxuICAgICAgICBcbiAgICAgICAgY29uc3RydWN0b3IgICAgICAgICA6IEpvb3NlLlByb3RvLkNsYXNzLFxuICAgICAgICBzdXBlckNsYXNzICAgICAgICAgIDogbnVsbCxcbiAgICAgICAgXG4gICAgICAgIG5hbWUgICAgICAgICAgICAgICAgOiBudWxsLFxuICAgICAgICBcbiAgICAgICAgYXR0cmlidXRlcyAgICAgICAgICA6IG51bGwsXG4gICAgICAgIG1ldGhvZHMgICAgICAgICAgICAgOiBudWxsLFxuICAgICAgICBcbiAgICAgICAgbWV0YSAgICAgICAgICAgICAgICA6IG51bGwsXG4gICAgICAgIGMgICAgICAgICAgICAgICAgICAgOiBudWxsLFxuICAgICAgICBcbiAgICAgICAgZGVmYXVsdFN1cGVyQ2xhc3MgICA6IEpvb3NlLlByb3RvLk9iamVjdCxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBCVUlMRCA6IGZ1bmN0aW9uIChuYW1lLCBleHRlbmQpIHtcbiAgICAgICAgICAgIHRoaXMubmFtZSA9IG5hbWVcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcmV0dXJuIHsgX19leHRlbmRfXyA6IGV4dGVuZCB8fCB7fSB9XG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgaW5pdGlhbGl6ZTogZnVuY3Rpb24gKHByb3BzKSB7XG4gICAgICAgICAgICB2YXIgZXh0ZW5kICAgICAgPSBwcm9wcy5fX2V4dGVuZF9fXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXMuVkVSU0lPTiAgICA9IGV4dGVuZC5WRVJTSU9OXG4gICAgICAgICAgICB0aGlzLkFVVEhPUklUWSAgPSBleHRlbmQuQVVUSE9SSVRZXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGRlbGV0ZSBleHRlbmQuVkVSU0lPTlxuICAgICAgICAgICAgZGVsZXRlIGV4dGVuZC5BVVRIT1JJVFlcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpcy5jID0gdGhpcy5leHRyYWN0Q29uc3RydWN0b3IoZXh0ZW5kKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLmFkYXB0Q29uc3RydWN0b3IodGhpcy5jKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAoZXh0ZW5kLmNvbnN0cnVjdG9yT25seSkge1xuICAgICAgICAgICAgICAgIGRlbGV0ZSBleHRlbmQuY29uc3RydWN0b3JPbmx5XG4gICAgICAgICAgICAgICAgcmV0dXJuXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXMuY29uc3RydWN0KGV4dGVuZClcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBjb25zdHJ1Y3QgOiBmdW5jdGlvbiAoZXh0ZW5kKSB7XG4gICAgICAgICAgICBpZiAoIXRoaXMucHJlcGFyZVByb3BzKGV4dGVuZCkpIHJldHVyblxuICAgICAgICAgICAgXG4gICAgICAgICAgICB2YXIgc3VwZXJDbGFzcyA9IHRoaXMuc3VwZXJDbGFzcyA9IHRoaXMuZXh0cmFjdFN1cGVyQ2xhc3MoZXh0ZW5kKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLnByb2Nlc3NTdXBlckNsYXNzKHN1cGVyQ2xhc3MpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXMuYWRhcHRQcm90b3R5cGUodGhpcy5jLnByb3RvdHlwZSlcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpcy5maW5hbGl6ZShleHRlbmQpXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgZmluYWxpemUgOiBmdW5jdGlvbiAoZXh0ZW5kKSB7XG4gICAgICAgICAgICB0aGlzLnByb2Nlc3NTdGVtKGV4dGVuZClcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpcy5leHRlbmQoZXh0ZW5kKVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIC8vaWYgdGhlIGV4dGVuc2lvbiByZXR1cm5zIGZhbHNlIGZyb20gdGhpcyBtZXRob2QgaXQgc2hvdWxkIHJlLWVudGVyICdjb25zdHJ1Y3QnXG4gICAgICAgIHByZXBhcmVQcm9wcyA6IGZ1bmN0aW9uIChleHRlbmQpIHtcbiAgICAgICAgICAgIHJldHVybiB0cnVlXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgZXh0cmFjdENvbnN0cnVjdG9yIDogZnVuY3Rpb24gKGV4dGVuZCkge1xuICAgICAgICAgICAgdmFyIHJlcyA9IGV4dGVuZC5oYXNPd25Qcm9wZXJ0eSgnY29uc3RydWN0b3InKSA/IGV4dGVuZC5jb25zdHJ1Y3RvciA6IHRoaXMuZGVmYXVsdENvbnN0cnVjdG9yKClcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgZGVsZXRlIGV4dGVuZC5jb25zdHJ1Y3RvclxuICAgICAgICAgICAgXG4gICAgICAgICAgICByZXR1cm4gcmVzXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgZXh0cmFjdFN1cGVyQ2xhc3MgOiBmdW5jdGlvbiAoZXh0ZW5kKSB7XG4gICAgICAgICAgICBpZiAoZXh0ZW5kLmhhc093blByb3BlcnR5KCdpc2EnKSAmJiAhZXh0ZW5kLmlzYSkgdGhyb3cgbmV3IEVycm9yKFwiQXR0ZW1wdCB0byBpbmhlcml0IGZyb20gdW5kZWZpbmVkIHN1cGVyY2xhc3MgW1wiICsgdGhpcy5uYW1lICsgXCJdXCIpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciByZXMgPSBleHRlbmQuaXNhIHx8IHRoaXMuZGVmYXVsdFN1cGVyQ2xhc3NcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgZGVsZXRlIGV4dGVuZC5pc2FcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcmV0dXJuIHJlc1xuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIHByb2Nlc3NTdGVtIDogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgdmFyIHN1cGVyTWV0YSAgICAgICA9IHRoaXMuc3VwZXJDbGFzcy5tZXRhXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXMubWV0aG9kcyAgICAgICAgPSBKb29zZS5PLmdldE11dGFibGVDb3B5KHN1cGVyTWV0YS5tZXRob2RzIHx8IHt9KVxuICAgICAgICAgICAgdGhpcy5hdHRyaWJ1dGVzICAgICA9IEpvb3NlLk8uZ2V0TXV0YWJsZUNvcHkoc3VwZXJNZXRhLmF0dHJpYnV0ZXMgfHwge30pXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgaW5pdEluc3RhbmNlIDogZnVuY3Rpb24gKGluc3RhbmNlLCBwcm9wcykge1xuICAgICAgICAgICAgSm9vc2UuTy5jb3B5T3duKHByb3BzLCBpbnN0YW5jZSlcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBkZWZhdWx0Q29uc3RydWN0b3I6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHJldHVybiBmdW5jdGlvbiAoYXJnKSB7XG4gICAgICAgICAgICAgICAgdmFyIEJVSUxEID0gdGhpcy5CVUlMRFxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIHZhciBhcmdzID0gQlVJTEQgJiYgQlVJTEQuYXBwbHkodGhpcywgYXJndW1lbnRzKSB8fCBhcmcgfHwge31cbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICB2YXIgdGhpc01ldGEgICAgPSB0aGlzLm1ldGFcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICB0aGlzTWV0YS5pbml0SW5zdGFuY2UodGhpcywgYXJncylcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICByZXR1cm4gdGhpc01ldGEuaGFzTWV0aG9kKCdpbml0aWFsaXplJykgJiYgdGhpcy5pbml0aWFsaXplKGFyZ3MpIHx8IHRoaXNcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBwcm9jZXNzU3VwZXJDbGFzczogZnVuY3Rpb24gKHN1cGVyQ2xhc3MpIHtcbiAgICAgICAgICAgIHZhciBzdXBlclByb3RvICAgICAgPSBzdXBlckNsYXNzLnByb3RvdHlwZVxuICAgICAgICAgICAgXG4gICAgICAgICAgICAvL25vbi1Kb29zZSBzdXBlcmNsYXNzZXNcbiAgICAgICAgICAgIGlmICghc3VwZXJDbGFzcy5tZXRhKSB7XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgdmFyIGV4dGVuZCA9IEpvb3NlLk8uY29weShzdXBlclByb3RvKVxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIGV4dGVuZC5pc2EgPSBKb29zZS5Qcm90by5FbXB0eVxuICAgICAgICAgICAgICAgIC8vIGNsZWFyIHBvdGVudGlhbCB2YWx1ZSBpbiB0aGUgYGV4dGVuZC5jb25zdHJ1Y3RvcmAgdG8gcHJldmVudCBpdCBmcm9tIGJlaW5nIG1vZGlmaWVkXG4gICAgICAgICAgICAgICAgZGVsZXRlIGV4dGVuZC5jb25zdHJ1Y3RvclxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIHZhciBtZXRhID0gbmV3IHRoaXMuZGVmYXVsdFN1cGVyQ2xhc3MubWV0YS5jb25zdHJ1Y3RvcihudWxsLCBleHRlbmQpXG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgc3VwZXJDbGFzcy5tZXRhID0gc3VwZXJQcm90by5tZXRhID0gbWV0YVxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIG1ldGEuYyA9IHN1cGVyQ2xhc3NcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpcy5jLnByb3RvdHlwZSAgICA9IEpvb3NlLk8uZ2V0TXV0YWJsZUNvcHkoc3VwZXJQcm90bylcbiAgICAgICAgICAgIHRoaXMuYy5zdXBlckNsYXNzICAgPSBzdXBlclByb3RvXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgYWRhcHRDb25zdHJ1Y3RvcjogZnVuY3Rpb24gKGMpIHtcbiAgICAgICAgICAgIGMubWV0YSA9IHRoaXNcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKCFjLmhhc093blByb3BlcnR5KCd0b1N0cmluZycpKSBjLnRvU3RyaW5nID0gZnVuY3Rpb24gKCkgeyByZXR1cm4gdGhpcy5tZXRhLm5hbWUgfVxuICAgICAgICB9LFxuICAgIFxuICAgICAgICBcbiAgICAgICAgYWRhcHRQcm90b3R5cGU6IGZ1bmN0aW9uIChwcm90bykge1xuICAgICAgICAgICAgLy90aGlzIHdpbGwgZml4IHdlaXJkIHNlbWFudGljIG9mIG5hdGl2ZSBcImNvbnN0cnVjdG9yXCIgcHJvcGVydHkgdG8gbW9yZSBpbnR1aXRpdmUgKGlkZWEgYm9ycm93ZWQgZnJvbSBFeHQpXG4gICAgICAgICAgICBwcm90by5jb25zdHJ1Y3RvciAgID0gdGhpcy5jXG4gICAgICAgICAgICBwcm90by5tZXRhICAgICAgICAgID0gdGhpc1xuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIGFkZE1ldGhvZDogZnVuY3Rpb24gKG5hbWUsIGZ1bmMpIHtcbiAgICAgICAgICAgIGZ1bmMuU1VQRVIgPSB0aGlzLnN1cGVyQ2xhc3MucHJvdG90eXBlXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vY2hyb21lIGRvbid0IGFsbG93IHRvIHJlZGVmaW5lIHRoZSBcIm5hbWVcIiBwcm9wZXJ0eVxuICAgICAgICAgICAgZnVuYy5tZXRob2ROYW1lID0gbmFtZVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLm1ldGhvZHNbbmFtZV0gPSBmdW5jXG4gICAgICAgICAgICB0aGlzLmMucHJvdG90eXBlW25hbWVdID0gZnVuY1xuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIGFkZEF0dHJpYnV0ZTogZnVuY3Rpb24gKG5hbWUsIGluaXQpIHtcbiAgICAgICAgICAgIHRoaXMuYXR0cmlidXRlc1tuYW1lXSA9IGluaXRcbiAgICAgICAgICAgIHRoaXMuYy5wcm90b3R5cGVbbmFtZV0gPSBpbml0XG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgcmVtb3ZlTWV0aG9kIDogZnVuY3Rpb24gKG5hbWUpIHtcbiAgICAgICAgICAgIGRlbGV0ZSB0aGlzLm1ldGhvZHNbbmFtZV1cbiAgICAgICAgICAgIGRlbGV0ZSB0aGlzLmMucHJvdG90eXBlW25hbWVdXG4gICAgICAgIH0sXG4gICAgXG4gICAgICAgIFxuICAgICAgICByZW1vdmVBdHRyaWJ1dGU6IGZ1bmN0aW9uIChuYW1lKSB7XG4gICAgICAgICAgICBkZWxldGUgdGhpcy5hdHRyaWJ1dGVzW25hbWVdXG4gICAgICAgICAgICBkZWxldGUgdGhpcy5jLnByb3RvdHlwZVtuYW1lXVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIGhhc01ldGhvZDogZnVuY3Rpb24gKG5hbWUpIHsgXG4gICAgICAgICAgICByZXR1cm4gQm9vbGVhbih0aGlzLm1ldGhvZHNbbmFtZV0pXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgaGFzQXR0cmlidXRlOiBmdW5jdGlvbiAobmFtZSkgeyBcbiAgICAgICAgICAgIHJldHVybiB0aGlzLmF0dHJpYnV0ZXNbbmFtZV0gIT09IHVuZGVmaW5lZFxuICAgICAgICB9LFxuICAgICAgICBcbiAgICBcbiAgICAgICAgaGFzT3duTWV0aG9kOiBmdW5jdGlvbiAobmFtZSkgeyBcbiAgICAgICAgICAgIHJldHVybiB0aGlzLmhhc01ldGhvZChuYW1lKSAmJiB0aGlzLm1ldGhvZHMuaGFzT3duUHJvcGVydHkobmFtZSlcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBoYXNPd25BdHRyaWJ1dGU6IGZ1bmN0aW9uIChuYW1lKSB7IFxuICAgICAgICAgICAgcmV0dXJuIHRoaXMuaGFzQXR0cmlidXRlKG5hbWUpICYmIHRoaXMuYXR0cmlidXRlcy5oYXNPd25Qcm9wZXJ0eShuYW1lKVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIGV4dGVuZCA6IGZ1bmN0aW9uIChwcm9wcykge1xuICAgICAgICAgICAgSm9vc2UuTy5lYWNoT3duKHByb3BzLCBmdW5jdGlvbiAodmFsdWUsIG5hbWUpIHtcbiAgICAgICAgICAgICAgICBpZiAobmFtZSAhPSAnbWV0YScgJiYgbmFtZSAhPSAnY29uc3RydWN0b3InKSBcbiAgICAgICAgICAgICAgICAgICAgaWYgKEpvb3NlLk8uaXNGdW5jdGlvbih2YWx1ZSkgJiYgIXZhbHVlLm1ldGEpIFxuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5hZGRNZXRob2QobmFtZSwgdmFsdWUpIFxuICAgICAgICAgICAgICAgICAgICBlbHNlIFxuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5hZGRBdHRyaWJ1dGUobmFtZSwgdmFsdWUpXG4gICAgICAgICAgICB9LCB0aGlzKVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIHN1YkNsYXNzT2YgOiBmdW5jdGlvbiAoY2xhc3NPYmplY3QsIGV4dGVuZCkge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuc3ViQ2xhc3MoZXh0ZW5kLCBudWxsLCBjbGFzc09iamVjdClcbiAgICAgICAgfSxcbiAgICBcbiAgICBcbiAgICAgICAgc3ViQ2xhc3MgOiBmdW5jdGlvbiAoZXh0ZW5kLCBuYW1lLCBjbGFzc09iamVjdCkge1xuICAgICAgICAgICAgZXh0ZW5kICAgICAgPSBleHRlbmQgICAgICAgIHx8IHt9XG4gICAgICAgICAgICBleHRlbmQuaXNhICA9IGNsYXNzT2JqZWN0ICAgfHwgdGhpcy5jXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHJldHVybiBuZXcgdGhpcy5jb25zdHJ1Y3RvcihuYW1lLCBleHRlbmQpLmNcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBpbnN0YW50aWF0ZSA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHZhciBmID0gZnVuY3Rpb24gKCkge31cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgZi5wcm90b3R5cGUgPSB0aGlzLmMucHJvdG90eXBlXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciBvYmogPSBuZXcgZigpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHJldHVybiB0aGlzLmMuYXBwbHkob2JqLCBhcmd1bWVudHMpIHx8IG9ialxuICAgICAgICB9XG4gICAgfVxuICAgIFxuICAgIC8vbWljcm8gYm9vdHN0cmFwaW5nXG4gICAgXG4gICAgSm9vc2UuUHJvdG8uQ2xhc3MucHJvdG90eXBlID0gSm9vc2UuTy5nZXRNdXRhYmxlQ29weShKb29zZS5Qcm90by5PYmplY3QucHJvdG90eXBlKVxuICAgIFxuICAgIEpvb3NlLk8uZXh0ZW5kKEpvb3NlLlByb3RvLkNsYXNzLnByb3RvdHlwZSwgYm9vdHN0cmFwKVxuICAgIFxuICAgIEpvb3NlLlByb3RvLkNsYXNzLnByb3RvdHlwZS5tZXRhID0gbmV3IEpvb3NlLlByb3RvLkNsYXNzKCdKb29zZS5Qcm90by5DbGFzcycsIGJvb3RzdHJhcClcbiAgICBcbiAgICBcbiAgICBcbiAgICBKb29zZS5Qcm90by5DbGFzcy5tZXRhLmFkZE1ldGhvZCgnaXNhJywgZnVuY3Rpb24gKHNvbWVDbGFzcykge1xuICAgICAgICB2YXIgZiA9IGZ1bmN0aW9uICgpIHt9XG4gICAgICAgIFxuICAgICAgICBmLnByb3RvdHlwZSA9IHRoaXMuYy5wcm90b3R5cGVcbiAgICAgICAgXG4gICAgICAgIHJldHVybiBuZXcgZigpIGluc3RhbmNlb2Ygc29tZUNsYXNzXG4gICAgfSlcbn0pKCk7XG5Kb29zZS5NYW5hZ2VkID0gSm9vc2Uuc3R1YigpXG5cbkpvb3NlLk1hbmFnZWQuUHJvcGVydHkgPSBuZXcgSm9vc2UuUHJvdG8uQ2xhc3MoJ0pvb3NlLk1hbmFnZWQuUHJvcGVydHknLCB7XG4gICAgXG4gICAgbmFtZSAgICAgICAgICAgIDogbnVsbCxcbiAgICBcbiAgICBpbml0ICAgICAgICAgICAgOiBudWxsLFxuICAgIHZhbHVlICAgICAgICAgICA6IG51bGwsXG4gICAgXG4gICAgZGVmaW5lZEluICAgICAgIDogbnVsbCxcbiAgICBcbiAgICBcbiAgICBpbml0aWFsaXplIDogZnVuY3Rpb24gKHByb3BzKSB7XG4gICAgICAgIEpvb3NlLk1hbmFnZWQuUHJvcGVydHkuc3VwZXJDbGFzcy5pbml0aWFsaXplLmNhbGwodGhpcywgcHJvcHMpXG4gICAgICAgIFxuICAgICAgICB0aGlzLmNvbXB1dGVWYWx1ZSgpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBjb21wdXRlVmFsdWUgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHRoaXMudmFsdWUgPSB0aGlzLmluaXRcbiAgICB9LCAgICBcbiAgICBcbiAgICBcbiAgICAvL3RhcmdldENsYXNzIGlzIHN0aWxsIG9wZW4gYXQgdGhpcyBzdGFnZVxuICAgIHByZUFwcGx5IDogZnVuY3Rpb24gKHRhcmdldENsYXNzKSB7XG4gICAgfSxcbiAgICBcblxuICAgIC8vdGFyZ2V0Q2xhc3MgaXMgYWxyZWFkeSBvcGVuIGF0IHRoaXMgc3RhZ2VcbiAgICBwb3N0VW5BcHBseSA6IGZ1bmN0aW9uICh0YXJnZXRDbGFzcykge1xuICAgIH0sXG4gICAgXG4gICAgXG4gICAgYXBwbHkgOiBmdW5jdGlvbiAodGFyZ2V0KSB7XG4gICAgICAgIHRhcmdldFt0aGlzLm5hbWVdID0gdGhpcy52YWx1ZVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgaXNBcHBsaWVkVG8gOiBmdW5jdGlvbiAodGFyZ2V0KSB7XG4gICAgICAgIHJldHVybiB0YXJnZXRbdGhpcy5uYW1lXSA9PSB0aGlzLnZhbHVlXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICB1bmFwcGx5IDogZnVuY3Rpb24gKGZyb20pIHtcbiAgICAgICAgaWYgKCF0aGlzLmlzQXBwbGllZFRvKGZyb20pKSB0aHJvdyBcIlVuYXBwbHkgb2YgcHJvcGVydHkgW1wiICsgdGhpcy5uYW1lICsgXCJdIGZyb20gW1wiICsgZnJvbSArIFwiXSBmYWlsZWRcIlxuICAgICAgICBcbiAgICAgICAgZGVsZXRlIGZyb21bdGhpcy5uYW1lXVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgY2xvbmVQcm9wcyA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIG5hbWUgICAgICAgIDogdGhpcy5uYW1lLCBcbiAgICAgICAgICAgIGluaXQgICAgICAgIDogdGhpcy5pbml0LFxuICAgICAgICAgICAgZGVmaW5lZEluICAgOiB0aGlzLmRlZmluZWRJblxuICAgICAgICB9XG4gICAgfSxcblxuICAgIFxuICAgIGNsb25lIDogZnVuY3Rpb24gKG5hbWUpIHtcbiAgICAgICAgdmFyIHByb3BzID0gdGhpcy5jbG9uZVByb3BzKClcbiAgICAgICAgXG4gICAgICAgIHByb3BzLm5hbWUgPSBuYW1lIHx8IHByb3BzLm5hbWVcbiAgICAgICAgXG4gICAgICAgIHJldHVybiBuZXcgdGhpcy5jb25zdHJ1Y3Rvcihwcm9wcylcbiAgICB9XG4gICAgXG4gICAgXG59KS5jO1xuSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5Db25mbGljdE1hcmtlciA9IG5ldyBKb29zZS5Qcm90by5DbGFzcygnSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5Db25mbGljdE1hcmtlcicsIHtcbiAgICBcbiAgICBpc2EgOiBKb29zZS5NYW5hZ2VkLlByb3BlcnR5LFxuXG4gICAgYXBwbHkgOiBmdW5jdGlvbiAodGFyZ2V0KSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcIkF0dGVtcHQgdG8gYXBwbHkgQ29uZmxpY3RNYXJrZXIgW1wiICsgdGhpcy5uYW1lICsgXCJdIHRvIFtcIiArIHRhcmdldCArIFwiXVwiKVxuICAgIH1cbiAgICBcbn0pLmM7XG5Kb29zZS5NYW5hZ2VkLlByb3BlcnR5LlJlcXVpcmVtZW50ID0gbmV3IEpvb3NlLlByb3RvLkNsYXNzKCdKb29zZS5NYW5hZ2VkLlByb3BlcnR5LlJlcXVpcmVtZW50Jywge1xuICAgIFxuICAgIGlzYSA6IEpvb3NlLk1hbmFnZWQuUHJvcGVydHksXG5cbiAgICBcbiAgICBhcHBseSA6IGZ1bmN0aW9uICh0YXJnZXQpIHtcbiAgICAgICAgaWYgKCF0YXJnZXQubWV0YS5oYXNNZXRob2QodGhpcy5uYW1lKSkgXG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJSZXF1aXJlbWVudCBbXCIgKyB0aGlzLm5hbWUgKyBcIl0sIGRlZmluZWQgaW4gW1wiICsgdGhpcy5kZWZpbmVkSW4uZGVmaW5lZEluLm5hbWUgKyBcIl0gaXMgbm90IHNhdGlzZmllZCBmb3IgY2xhc3MgW1wiICsgdGFyZ2V0ICsgXCJdXCIpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICB1bmFwcGx5IDogZnVuY3Rpb24gKGZyb20pIHtcbiAgICB9XG4gICAgXG59KS5jO1xuSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5BdHRyaWJ1dGUgPSBuZXcgSm9vc2UuUHJvdG8uQ2xhc3MoJ0pvb3NlLk1hbmFnZWQuUHJvcGVydHkuQXR0cmlidXRlJywge1xuICAgIFxuICAgIGlzYSA6IEpvb3NlLk1hbmFnZWQuUHJvcGVydHksXG4gICAgXG4gICAgc2xvdCAgICAgICAgICAgICAgICA6IG51bGwsXG4gICAgXG4gICAgXG4gICAgaW5pdGlhbGl6ZSA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5BdHRyaWJ1dGUuc3VwZXJDbGFzcy5pbml0aWFsaXplLmFwcGx5KHRoaXMsIGFyZ3VtZW50cylcbiAgICAgICAgXG4gICAgICAgIHRoaXMuc2xvdCA9IHRoaXMubmFtZVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgYXBwbHkgOiBmdW5jdGlvbiAodGFyZ2V0KSB7XG4gICAgICAgIHRhcmdldC5wcm90b3R5cGVbIHRoaXMuc2xvdCBdID0gdGhpcy52YWx1ZVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgaXNBcHBsaWVkVG8gOiBmdW5jdGlvbiAodGFyZ2V0KSB7XG4gICAgICAgIHJldHVybiB0YXJnZXQucHJvdG90eXBlWyB0aGlzLnNsb3QgXSA9PSB0aGlzLnZhbHVlXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICB1bmFwcGx5IDogZnVuY3Rpb24gKGZyb20pIHtcbiAgICAgICAgaWYgKCF0aGlzLmlzQXBwbGllZFRvKGZyb20pKSB0aHJvdyBcIlVuYXBwbHkgb2YgcHJvcGVydHkgW1wiICsgdGhpcy5uYW1lICsgXCJdIGZyb20gW1wiICsgZnJvbSArIFwiXSBmYWlsZWRcIlxuICAgICAgICBcbiAgICAgICAgZGVsZXRlIGZyb20ucHJvdG90eXBlW3RoaXMuc2xvdF1cbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGNsZWFyVmFsdWUgOiBmdW5jdGlvbiAoaW5zdGFuY2UpIHtcbiAgICAgICAgZGVsZXRlIGluc3RhbmNlWyB0aGlzLnNsb3QgXVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgaGFzVmFsdWUgOiBmdW5jdGlvbiAoaW5zdGFuY2UpIHtcbiAgICAgICAgcmV0dXJuIGluc3RhbmNlLmhhc093blByb3BlcnR5KHRoaXMuc2xvdClcbiAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgZ2V0UmF3VmFsdWVGcm9tIDogZnVuY3Rpb24gKGluc3RhbmNlKSB7XG4gICAgICAgIHJldHVybiBpbnN0YW5jZVsgdGhpcy5zbG90IF1cbiAgICB9LFxuICAgIFxuICAgIFxuICAgIHNldFJhd1ZhbHVlVG8gOiBmdW5jdGlvbiAoaW5zdGFuY2UsIHZhbHVlKSB7XG4gICAgICAgIGluc3RhbmNlWyB0aGlzLnNsb3QgXSA9IHZhbHVlXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gdGhpc1xuICAgIH1cbiAgICBcbn0pLmM7XG5Kb29zZS5NYW5hZ2VkLlByb3BlcnR5Lk1ldGhvZE1vZGlmaWVyID0gbmV3IEpvb3NlLlByb3RvLkNsYXNzKCdKb29zZS5NYW5hZ2VkLlByb3BlcnR5Lk1ldGhvZE1vZGlmaWVyJywge1xuICAgIFxuICAgIGlzYSA6IEpvb3NlLk1hbmFnZWQuUHJvcGVydHksXG5cbiAgICBcbiAgICBwcmVwYXJlV3JhcHBlciA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgdGhyb3cgXCJBYnN0cmFjdCBtZXRob2QgW3ByZXBhcmVXcmFwcGVyXSBvZiBcIiArIHRoaXMgKyBcIiB3YXMgY2FsbGVkXCJcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGFwcGx5IDogZnVuY3Rpb24gKHRhcmdldCkge1xuICAgICAgICB2YXIgbmFtZSAgICAgICAgICAgID0gdGhpcy5uYW1lXG4gICAgICAgIHZhciB0YXJnZXRQcm90byAgICAgPSB0YXJnZXQucHJvdG90eXBlXG4gICAgICAgIHZhciBpc093biAgICAgICAgICAgPSB0YXJnZXRQcm90by5oYXNPd25Qcm9wZXJ0eShuYW1lKVxuICAgICAgICB2YXIgb3JpZ2luYWwgICAgICAgID0gdGFyZ2V0UHJvdG9bbmFtZV1cbiAgICAgICAgdmFyIHN1cGVyUHJvdG8gICAgICA9IHRhcmdldC5tZXRhLnN1cGVyQ2xhc3MucHJvdG90eXBlXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgdmFyIG9yaWdpbmFsQ2FsbCA9IGlzT3duID8gb3JpZ2luYWwgOiBmdW5jdGlvbiAoKSB7IFxuICAgICAgICAgICAgcmV0dXJuIHN1cGVyUHJvdG9bbmFtZV0uYXBwbHkodGhpcywgYXJndW1lbnRzKSBcbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgdmFyIG1ldGhvZFdyYXBwZXIgPSB0aGlzLnByZXBhcmVXcmFwcGVyKHtcbiAgICAgICAgICAgIG5hbWUgICAgICAgICAgICA6IG5hbWUsXG4gICAgICAgICAgICBtb2RpZmllciAgICAgICAgOiB0aGlzLnZhbHVlLCBcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaXNPd24gICAgICAgICAgIDogaXNPd24sXG4gICAgICAgICAgICBvcmlnaW5hbENhbGwgICAgOiBvcmlnaW5hbENhbGwsIFxuICAgICAgICAgICAgXG4gICAgICAgICAgICBzdXBlclByb3RvICAgICAgOiBzdXBlclByb3RvLFxuICAgICAgICAgICAgXG4gICAgICAgICAgICB0YXJnZXQgICAgICAgICAgOiB0YXJnZXRcbiAgICAgICAgfSlcbiAgICAgICAgXG4gICAgICAgIGlmIChpc093bikgbWV0aG9kV3JhcHBlci5fX09SSUdJTkFMX18gPSBvcmlnaW5hbFxuICAgICAgICBcbiAgICAgICAgbWV0aG9kV3JhcHBlci5fX0NPTlRBSU5fXyAgID0gdGhpcy52YWx1ZVxuICAgICAgICBtZXRob2RXcmFwcGVyLl9fTUVUSE9EX18gICAgPSB0aGlzXG4gICAgICAgIFxuICAgICAgICB0YXJnZXRQcm90b1tuYW1lXSA9IG1ldGhvZFdyYXBwZXJcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGlzQXBwbGllZFRvIDogZnVuY3Rpb24gKHRhcmdldCkge1xuICAgICAgICB2YXIgdGFyZ2V0Q29udCA9IHRhcmdldC5wcm90b3R5cGVbdGhpcy5uYW1lXVxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIHRhcmdldENvbnQgJiYgdGFyZ2V0Q29udC5fX0NPTlRBSU5fXyA9PSB0aGlzLnZhbHVlXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICB1bmFwcGx5IDogZnVuY3Rpb24gKGZyb20pIHtcbiAgICAgICAgdmFyIG5hbWUgPSB0aGlzLm5hbWVcbiAgICAgICAgdmFyIGZyb21Qcm90byA9IGZyb20ucHJvdG90eXBlXG4gICAgICAgIHZhciBvcmlnaW5hbCA9IGZyb21Qcm90b1tuYW1lXS5fX09SSUdJTkFMX19cbiAgICAgICAgXG4gICAgICAgIGlmICghdGhpcy5pc0FwcGxpZWRUbyhmcm9tKSkgdGhyb3cgXCJVbmFwcGx5IG9mIG1ldGhvZCBbXCIgKyBuYW1lICsgXCJdIGZyb20gY2xhc3MgW1wiICsgZnJvbSArIFwiXSBmYWlsZWRcIlxuICAgICAgICBcbiAgICAgICAgLy9pZiBtb2RpZmllciB3YXMgYXBwbGllZCB0byBvd24gbWV0aG9kIC0gcmVzdG9yZSBpdFxuICAgICAgICBpZiAob3JpZ2luYWwpIFxuICAgICAgICAgICAgZnJvbVByb3RvW25hbWVdID0gb3JpZ2luYWxcbiAgICAgICAgLy9vdGhlcndpc2UgLSBqdXN0IGRlbGV0ZSBpdCwgdG8gcmV2ZWFsIHRoZSBpbmhlcml0ZWQgbWV0aG9kIFxuICAgICAgICBlbHNlXG4gICAgICAgICAgICBkZWxldGUgZnJvbVByb3RvW25hbWVdXG4gICAgfVxuICAgIFxufSkuYztcbkpvb3NlLk1hbmFnZWQuUHJvcGVydHkuTWV0aG9kTW9kaWZpZXIuT3ZlcnJpZGUgPSBuZXcgSm9vc2UuUHJvdG8uQ2xhc3MoJ0pvb3NlLk1hbmFnZWQuUHJvcGVydHkuTWV0aG9kTW9kaWZpZXIuT3ZlcnJpZGUnLCB7XG4gICAgXG4gICAgaXNhIDogSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5NZXRob2RNb2RpZmllcixcblxuICAgIFxuICAgIHByZXBhcmVXcmFwcGVyIDogZnVuY3Rpb24gKHBhcmFtcykge1xuICAgICAgICBcbiAgICAgICAgdmFyIG1vZGlmaWVyICAgICAgICA9IHBhcmFtcy5tb2RpZmllclxuICAgICAgICB2YXIgb3JpZ2luYWxDYWxsICAgID0gcGFyYW1zLm9yaWdpbmFsQ2FsbFxuICAgICAgICB2YXIgc3VwZXJQcm90byAgICAgID0gcGFyYW1zLnN1cGVyUHJvdG9cbiAgICAgICAgdmFyIHN1cGVyTWV0YUNvbnN0ICA9IHN1cGVyUHJvdG8ubWV0YS5jb25zdHJ1Y3RvclxuICAgICAgICBcbiAgICAgICAgLy9jYWxsIHRvIEpvb3NlLlByb3RvIGxldmVsLCByZXF1aXJlIHNvbWUgYWRkaXRpb25hbCBwcm9jZXNzaW5nXG4gICAgICAgIHZhciBpc0NhbGxUb1Byb3RvID0gKHN1cGVyTWV0YUNvbnN0ID09IEpvb3NlLlByb3RvLkNsYXNzIHx8IHN1cGVyTWV0YUNvbnN0ID09IEpvb3NlLlByb3RvLk9iamVjdCkgJiYgIShwYXJhbXMuaXNPd24gJiYgb3JpZ2luYWxDYWxsLklTX09WRVJSSURFKSBcbiAgICAgICAgXG4gICAgICAgIHZhciBvcmlnaW5hbCA9IG9yaWdpbmFsQ2FsbFxuICAgICAgICBcbiAgICAgICAgaWYgKGlzQ2FsbFRvUHJvdG8pIG9yaWdpbmFsID0gZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgdmFyIGJlZm9yZVNVUEVSID0gdGhpcy5TVVBFUlxuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLlNVUEVSICA9IHN1cGVyUHJvdG8uU1VQRVJcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdmFyIHJlcyA9IG9yaWdpbmFsQ2FsbC5hcHBseSh0aGlzLCBhcmd1bWVudHMpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXMuU1VQRVIgPSBiZWZvcmVTVVBFUlxuICAgICAgICAgICAgXG4gICAgICAgICAgICByZXR1cm4gcmVzXG4gICAgICAgIH1cblxuICAgICAgICB2YXIgb3ZlcnJpZGUgPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciBiZWZvcmVTVVBFUiA9IHRoaXMuU1VQRVJcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpcy5TVVBFUiAgPSBvcmlnaW5hbFxuICAgICAgICAgICAgXG4gICAgICAgICAgICB2YXIgcmVzID0gbW9kaWZpZXIuYXBwbHkodGhpcywgYXJndW1lbnRzKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLlNVUEVSID0gYmVmb3JlU1VQRVJcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcmV0dXJuIHJlc1xuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICBvdmVycmlkZS5JU19PVkVSUklERSA9IHRydWVcbiAgICAgICAgXG4gICAgICAgIHJldHVybiBvdmVycmlkZVxuICAgIH1cbiAgICBcbiAgICBcbn0pLmM7XG5Kb29zZS5NYW5hZ2VkLlByb3BlcnR5Lk1ldGhvZE1vZGlmaWVyLlB1dCA9IG5ldyBKb29zZS5Qcm90by5DbGFzcygnSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5NZXRob2RNb2RpZmllci5QdXQnLCB7XG4gICAgXG4gICAgaXNhIDogSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5NZXRob2RNb2RpZmllci5PdmVycmlkZSxcblxuXG4gICAgcHJlcGFyZVdyYXBwZXIgOiBmdW5jdGlvbiAocGFyYW1zKSB7XG4gICAgICAgIFxuICAgICAgICBpZiAocGFyYW1zLmlzT3duKSB0aHJvdyBcIk1ldGhvZCBbXCIgKyBwYXJhbXMubmFtZSArIFwiXSBpcyBhcHBseWluZyBvdmVyIHNvbWV0aGluZyBbXCIgKyBwYXJhbXMub3JpZ2luYWxDYWxsICsgXCJdIGluIGNsYXNzIFtcIiArIHBhcmFtcy50YXJnZXQgKyBcIl1cIlxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIEpvb3NlLk1hbmFnZWQuUHJvcGVydHkuTWV0aG9kTW9kaWZpZXIuUHV0LnN1cGVyQ2xhc3MucHJlcGFyZVdyYXBwZXIuY2FsbCh0aGlzLCBwYXJhbXMpXG4gICAgfVxuICAgIFxuICAgIFxufSkuYztcbkpvb3NlLk1hbmFnZWQuUHJvcGVydHkuTWV0aG9kTW9kaWZpZXIuQWZ0ZXIgPSBuZXcgSm9vc2UuUHJvdG8uQ2xhc3MoJ0pvb3NlLk1hbmFnZWQuUHJvcGVydHkuTWV0aG9kTW9kaWZpZXIuQWZ0ZXInLCB7XG4gICAgXG4gICAgaXNhIDogSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5NZXRob2RNb2RpZmllcixcblxuICAgIFxuICAgIHByZXBhcmVXcmFwcGVyIDogZnVuY3Rpb24gKHBhcmFtcykge1xuICAgICAgICBcbiAgICAgICAgdmFyIG1vZGlmaWVyICAgICAgICA9IHBhcmFtcy5tb2RpZmllclxuICAgICAgICB2YXIgb3JpZ2luYWxDYWxsICAgID0gcGFyYW1zLm9yaWdpbmFsQ2FsbFxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHZhciByZXMgPSBvcmlnaW5hbENhbGwuYXBwbHkodGhpcywgYXJndW1lbnRzKVxuICAgICAgICAgICAgbW9kaWZpZXIuYXBwbHkodGhpcywgYXJndW1lbnRzKVxuICAgICAgICAgICAgcmV0dXJuIHJlc1xuICAgICAgICB9XG4gICAgfSAgICBcblxuICAgIFxufSkuYztcbkpvb3NlLk1hbmFnZWQuUHJvcGVydHkuTWV0aG9kTW9kaWZpZXIuQmVmb3JlID0gbmV3IEpvb3NlLlByb3RvLkNsYXNzKCdKb29zZS5NYW5hZ2VkLlByb3BlcnR5Lk1ldGhvZE1vZGlmaWVyLkJlZm9yZScsIHtcbiAgICBcbiAgICBpc2EgOiBKb29zZS5NYW5hZ2VkLlByb3BlcnR5Lk1ldGhvZE1vZGlmaWVyLFxuXG4gICAgXG4gICAgcHJlcGFyZVdyYXBwZXIgOiBmdW5jdGlvbiAocGFyYW1zKSB7XG4gICAgICAgIFxuICAgICAgICB2YXIgbW9kaWZpZXIgICAgICAgID0gcGFyYW1zLm1vZGlmaWVyXG4gICAgICAgIHZhciBvcmlnaW5hbENhbGwgICAgPSBwYXJhbXMub3JpZ2luYWxDYWxsXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgbW9kaWZpZXIuYXBwbHkodGhpcywgYXJndW1lbnRzKVxuICAgICAgICAgICAgcmV0dXJuIG9yaWdpbmFsQ2FsbC5hcHBseSh0aGlzLCBhcmd1bWVudHMpXG4gICAgICAgIH1cbiAgICB9XG4gICAgXG59KS5jO1xuSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5NZXRob2RNb2RpZmllci5Bcm91bmQgPSBuZXcgSm9vc2UuUHJvdG8uQ2xhc3MoJ0pvb3NlLk1hbmFnZWQuUHJvcGVydHkuTWV0aG9kTW9kaWZpZXIuQXJvdW5kJywge1xuICAgIFxuICAgIGlzYSA6IEpvb3NlLk1hbmFnZWQuUHJvcGVydHkuTWV0aG9kTW9kaWZpZXIsXG5cbiAgICBwcmVwYXJlV3JhcHBlciA6IGZ1bmN0aW9uIChwYXJhbXMpIHtcbiAgICAgICAgXG4gICAgICAgIHZhciBtb2RpZmllciAgICAgICAgPSBwYXJhbXMubW9kaWZpZXJcbiAgICAgICAgdmFyIG9yaWdpbmFsQ2FsbCAgICA9IHBhcmFtcy5vcmlnaW5hbENhbGxcbiAgICAgICAgXG4gICAgICAgIHZhciBtZVxuICAgICAgICBcbiAgICAgICAgdmFyIGJvdW5kID0gZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgcmV0dXJuIG9yaWdpbmFsQ2FsbC5hcHBseShtZSwgYXJndW1lbnRzKVxuICAgICAgICB9XG4gICAgICAgICAgICBcbiAgICAgICAgcmV0dXJuIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIG1lID0gdGhpc1xuICAgICAgICAgICAgXG4gICAgICAgICAgICB2YXIgYm91bmRBcnIgPSBbIGJvdW5kIF1cbiAgICAgICAgICAgIGJvdW5kQXJyLnB1c2guYXBwbHkoYm91bmRBcnIsIGFyZ3VtZW50cylcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcmV0dXJuIG1vZGlmaWVyLmFwcGx5KHRoaXMsIGJvdW5kQXJyKVxuICAgICAgICB9XG4gICAgfVxuICAgIFxufSkuYztcbkpvb3NlLk1hbmFnZWQuUHJvcGVydHkuTWV0aG9kTW9kaWZpZXIuQXVnbWVudCA9IG5ldyBKb29zZS5Qcm90by5DbGFzcygnSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5NZXRob2RNb2RpZmllci5BdWdtZW50Jywge1xuICAgIFxuICAgIGlzYSA6IEpvb3NlLk1hbmFnZWQuUHJvcGVydHkuTWV0aG9kTW9kaWZpZXIsXG5cbiAgICBcbiAgICBwcmVwYXJlV3JhcHBlciA6IGZ1bmN0aW9uIChwYXJhbXMpIHtcbiAgICAgICAgXG4gICAgICAgIHZhciBBVUdNRU5UID0gZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgXG4gICAgICAgICAgICAvL3BvcHVsYXRlIGNhbGxzdGFjayB0byB0aGUgbW9zdCBkZWVwIG5vbi1hdWdtZW50IG1ldGhvZFxuICAgICAgICAgICAgdmFyIGNhbGxzdGFjayA9IFtdXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciBzZWxmID0gQVVHTUVOVFxuICAgICAgICAgICAgXG4gICAgICAgICAgICBkbyB7XG4gICAgICAgICAgICAgICAgY2FsbHN0YWNrLnB1c2goc2VsZi5JU19BVUdNRU5UID8gc2VsZi5fX0NPTlRBSU5fXyA6IHNlbGYpXG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgc2VsZiA9IHNlbGYuSVNfQVVHTUVOVCAmJiAoc2VsZi5fX09SSUdJTkFMX18gfHwgc2VsZi5TVVBFUltzZWxmLm1ldGhvZE5hbWVdKVxuICAgICAgICAgICAgfSB3aGlsZSAoc2VsZilcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgXG4gICAgICAgICAgICAvL3NhdmUgcHJldmlvdXMgSU5ORVJcbiAgICAgICAgICAgIHZhciBiZWZvcmVJTk5FUiA9IHRoaXMuSU5ORVJcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy9jcmVhdGUgbmV3IElOTkVSXG4gICAgICAgICAgICB0aGlzLklOTkVSID0gZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgIHZhciBpbm5lckNhbGwgPSBjYWxsc3RhY2sucG9wKClcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICByZXR1cm4gaW5uZXJDYWxsID8gaW5uZXJDYWxsLmFwcGx5KHRoaXMsIGFyZ3VtZW50cykgOiB1bmRlZmluZWRcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy9hdWdtZW50IG1vZGlmaWVyIHJlc3VsdHMgaW4gaHlwb3RldGljYWwgSU5ORVIgY2FsbCBvZiB0aGUgc2FtZSBtZXRob2QgaW4gc3ViY2xhc3MgXG4gICAgICAgICAgICB2YXIgcmVzID0gdGhpcy5JTk5FUi5hcHBseSh0aGlzLCBhcmd1bWVudHMpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vcmVzdG9yZSBwcmV2aW91cyBJTk5FUiBjaGFpblxuICAgICAgICAgICAgdGhpcy5JTk5FUiA9IGJlZm9yZUlOTkVSXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHJldHVybiByZXNcbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgQVVHTUVOVC5tZXRob2ROYW1lICA9IHBhcmFtcy5uYW1lXG4gICAgICAgIEFVR01FTlQuU1VQRVIgICAgICAgPSBwYXJhbXMuc3VwZXJQcm90b1xuICAgICAgICBBVUdNRU5ULklTX0FVR01FTlQgID0gdHJ1ZVxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIEFVR01FTlRcbiAgICB9XG4gICAgXG59KS5jO1xuSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eVNldCA9IG5ldyBKb29zZS5Qcm90by5DbGFzcygnSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eVNldCcsIHtcbiAgICBcbiAgICBpc2EgICAgICAgICAgICAgICAgICAgICAgIDogSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eSxcblxuICAgIHByb3BlcnRpZXMgICAgICAgICAgICAgICAgOiBudWxsLFxuICAgIFxuICAgIHByb3BlcnR5TWV0YUNsYXNzICAgICAgICAgOiBKb29zZS5NYW5hZ2VkLlByb3BlcnR5LFxuICAgIFxuICAgIFxuICAgIGluaXRpYWxpemUgOiBmdW5jdGlvbiAocHJvcHMpIHtcbiAgICAgICAgSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eVNldC5zdXBlckNsYXNzLmluaXRpYWxpemUuY2FsbCh0aGlzLCBwcm9wcylcbiAgICAgICAgXG4gICAgICAgIC8vWFhYIHRoaXMgZ3VhcmRzIHRoZSBtZXRhIHJvbGVzIDopXG4gICAgICAgIHRoaXMucHJvcGVydGllcyA9IHByb3BzLnByb3BlcnRpZXMgfHwge31cbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGFkZFByb3BlcnR5IDogZnVuY3Rpb24gKG5hbWUsIHByb3BzKSB7XG4gICAgICAgIHZhciBtZXRhQ2xhc3MgPSBwcm9wcy5tZXRhIHx8IHRoaXMucHJvcGVydHlNZXRhQ2xhc3NcbiAgICAgICAgZGVsZXRlIHByb3BzLm1ldGFcbiAgICAgICAgXG4gICAgICAgIHByb3BzLmRlZmluZWRJbiAgICAgPSB0aGlzXG4gICAgICAgIHByb3BzLm5hbWUgICAgICAgICAgPSBuYW1lXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gdGhpcy5wcm9wZXJ0aWVzW25hbWVdID0gbmV3IG1ldGFDbGFzcyhwcm9wcylcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGFkZFByb3BlcnR5T2JqZWN0IDogZnVuY3Rpb24gKG9iamVjdCkge1xuICAgICAgICByZXR1cm4gdGhpcy5wcm9wZXJ0aWVzW29iamVjdC5uYW1lXSA9IG9iamVjdFxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgcmVtb3ZlUHJvcGVydHkgOiBmdW5jdGlvbiAobmFtZSkge1xuICAgICAgICB2YXIgcHJvcCA9IHRoaXMucHJvcGVydGllc1tuYW1lXVxuICAgICAgICBcbiAgICAgICAgZGVsZXRlIHRoaXMucHJvcGVydGllc1tuYW1lXVxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIHByb3BcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGhhdmVQcm9wZXJ0eSA6IGZ1bmN0aW9uIChuYW1lKSB7XG4gICAgICAgIHJldHVybiB0aGlzLnByb3BlcnRpZXNbbmFtZV0gIT0gbnVsbFxuICAgIH0sXG4gICAgXG5cbiAgICBoYXZlT3duUHJvcGVydHkgOiBmdW5jdGlvbiAobmFtZSkge1xuICAgICAgICByZXR1cm4gdGhpcy5oYXZlUHJvcGVydHkobmFtZSkgJiYgdGhpcy5wcm9wZXJ0aWVzLmhhc093blByb3BlcnR5KG5hbWUpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBnZXRQcm9wZXJ0eSA6IGZ1bmN0aW9uIChuYW1lKSB7XG4gICAgICAgIHJldHVybiB0aGlzLnByb3BlcnRpZXNbbmFtZV1cbiAgICB9LFxuICAgIFxuICAgIFxuICAgIC8vaW5jbHVkZXMgaW5oZXJpdGVkIHByb3BlcnRpZXMgKHByb2JhYmx5IHlvdSB3YW50cyAnZWFjaE93bicsIHdoaWNoIHByb2Nlc3Mgb25seSBcIm93blwiIChpbmNsdWRpbmcgY29uc3VtZWQgZnJvbSBSb2xlcykgcHJvcGVydGllcykgXG4gICAgZWFjaCA6IGZ1bmN0aW9uIChmdW5jLCBzY29wZSkge1xuICAgICAgICBKb29zZS5PLmVhY2godGhpcy5wcm9wZXJ0aWVzLCBmdW5jLCBzY29wZSB8fCB0aGlzKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgZWFjaE93biA6IGZ1bmN0aW9uIChmdW5jLCBzY29wZSkge1xuICAgICAgICBKb29zZS5PLmVhY2hPd24odGhpcy5wcm9wZXJ0aWVzLCBmdW5jLCBzY29wZSB8fCB0aGlzKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgLy9zeW5vbnltIGZvciBlYWNoXG4gICAgZWFjaEFsbCA6IGZ1bmN0aW9uIChmdW5jLCBzY29wZSkge1xuICAgICAgICB0aGlzLmVhY2goZnVuYywgc2NvcGUpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBjbG9uZVByb3BzIDogZnVuY3Rpb24gKCkge1xuICAgICAgICB2YXIgcHJvcHMgPSBKb29zZS5NYW5hZ2VkLlByb3BlcnR5U2V0LnN1cGVyQ2xhc3MuY2xvbmVQcm9wcy5jYWxsKHRoaXMpXG4gICAgICAgIFxuICAgICAgICBwcm9wcy5wcm9wZXJ0eU1ldGFDbGFzcyAgICAgPSB0aGlzLnByb3BlcnR5TWV0YUNsYXNzXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gcHJvcHNcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGNsb25lIDogZnVuY3Rpb24gKG5hbWUpIHtcbiAgICAgICAgdmFyIGNsb25lID0gdGhpcy5jbGVhbkNsb25lKG5hbWUpXG4gICAgICAgIFxuICAgICAgICBjbG9uZS5wcm9wZXJ0aWVzID0gSm9vc2UuTy5jb3B5T3duKHRoaXMucHJvcGVydGllcylcbiAgICAgICAgXG4gICAgICAgIHJldHVybiBjbG9uZVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgY2xlYW5DbG9uZSA6IGZ1bmN0aW9uIChuYW1lKSB7XG4gICAgICAgIHZhciBwcm9wcyA9IHRoaXMuY2xvbmVQcm9wcygpXG4gICAgICAgIFxuICAgICAgICBwcm9wcy5uYW1lID0gbmFtZSB8fCBwcm9wcy5uYW1lXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gbmV3IHRoaXMuY29uc3RydWN0b3IocHJvcHMpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBhbGlhcyA6IGZ1bmN0aW9uICh3aGF0KSB7XG4gICAgICAgIHZhciBwcm9wcyA9IHRoaXMucHJvcGVydGllc1xuICAgICAgICBcbiAgICAgICAgSm9vc2UuTy5lYWNoKHdoYXQsIGZ1bmN0aW9uIChhbGlhc05hbWUsIG9yaWdpbmFsTmFtZSkge1xuICAgICAgICAgICAgdmFyIG9yaWdpbmFsID0gcHJvcHNbb3JpZ2luYWxOYW1lXVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAob3JpZ2luYWwpIHRoaXMuYWRkUHJvcGVydHlPYmplY3Qob3JpZ2luYWwuY2xvbmUoYWxpYXNOYW1lKSlcbiAgICAgICAgfSwgdGhpcylcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGV4Y2x1ZGUgOiBmdW5jdGlvbiAod2hhdCkge1xuICAgICAgICB2YXIgcHJvcHMgPSB0aGlzLnByb3BlcnRpZXNcbiAgICAgICAgXG4gICAgICAgIEpvb3NlLkEuZWFjaCh3aGF0LCBmdW5jdGlvbiAobmFtZSkge1xuICAgICAgICAgICAgZGVsZXRlIHByb3BzW25hbWVdXG4gICAgICAgIH0pXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBiZWZvcmVDb25zdW1lZEJ5IDogZnVuY3Rpb24gKCkge1xuICAgIH0sXG4gICAgXG4gICAgXG4gICAgZmxhdHRlblRvIDogZnVuY3Rpb24gKHRhcmdldCkge1xuICAgICAgICB2YXIgdGFyZ2V0UHJvcHMgPSB0YXJnZXQucHJvcGVydGllc1xuICAgICAgICBcbiAgICAgICAgdGhpcy5lYWNoT3duKGZ1bmN0aW9uIChwcm9wZXJ0eSwgbmFtZSkge1xuICAgICAgICAgICAgdmFyIHRhcmdldFByb3BlcnR5ID0gdGFyZ2V0UHJvcHNbbmFtZV1cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKHRhcmdldFByb3BlcnR5IGluc3RhbmNlb2YgSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5Db25mbGljdE1hcmtlcikgcmV0dXJuXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmICghdGFyZ2V0UHJvcHMuaGFzT3duUHJvcGVydHkobmFtZSkgfHwgdGFyZ2V0UHJvcGVydHkgPT0gbnVsbCkge1xuICAgICAgICAgICAgICAgIHRhcmdldC5hZGRQcm9wZXJ0eU9iamVjdChwcm9wZXJ0eSlcbiAgICAgICAgICAgICAgICByZXR1cm5cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKHRhcmdldFByb3BlcnR5ID09IHByb3BlcnR5KSByZXR1cm5cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGFyZ2V0LnJlbW92ZVByb3BlcnR5KG5hbWUpXG4gICAgICAgICAgICB0YXJnZXQuYWRkUHJvcGVydHkobmFtZSwge1xuICAgICAgICAgICAgICAgIG1ldGEgOiBKb29zZS5NYW5hZ2VkLlByb3BlcnR5LkNvbmZsaWN0TWFya2VyXG4gICAgICAgICAgICB9KVxuICAgICAgICB9LCB0aGlzKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgY29tcG9zZVRvIDogZnVuY3Rpb24gKHRhcmdldCkge1xuICAgICAgICB0aGlzLmVhY2hPd24oZnVuY3Rpb24gKHByb3BlcnR5LCBuYW1lKSB7XG4gICAgICAgICAgICBpZiAoIXRhcmdldC5oYXZlT3duUHJvcGVydHkobmFtZSkpIHRhcmdldC5hZGRQcm9wZXJ0eU9iamVjdChwcm9wZXJ0eSlcbiAgICAgICAgfSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGNvbXBvc2VGcm9tIDogZnVuY3Rpb24gKCkge1xuICAgICAgICBpZiAoIWFyZ3VtZW50cy5sZW5ndGgpIHJldHVyblxuICAgICAgICBcbiAgICAgICAgdmFyIGZsYXR0ZW5pbmcgPSB0aGlzLmNsZWFuQ2xvbmUoKVxuICAgICAgICBcbiAgICAgICAgSm9vc2UuQS5lYWNoKGFyZ3VtZW50cywgZnVuY3Rpb24gKGFyZykge1xuICAgICAgICAgICAgdmFyIGlzRGVzY3JpcHRvciAgICA9ICEoYXJnIGluc3RhbmNlb2YgSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eVNldClcbiAgICAgICAgICAgIHZhciBwcm9wU2V0ICAgICAgICAgPSBpc0Rlc2NyaXB0b3IgPyBhcmcucHJvcGVydHlTZXQgOiBhcmdcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcHJvcFNldC5iZWZvcmVDb25zdW1lZEJ5KHRoaXMsIGZsYXR0ZW5pbmcpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmIChpc0Rlc2NyaXB0b3IpIHtcbiAgICAgICAgICAgICAgICBpZiAoYXJnLmFsaWFzIHx8IGFyZy5leGNsdWRlKSAgIHByb3BTZXQgPSBwcm9wU2V0LmNsb25lKClcbiAgICAgICAgICAgICAgICBpZiAoYXJnLmFsaWFzKSAgICAgICAgICAgICAgICAgIHByb3BTZXQuYWxpYXMoYXJnLmFsaWFzKVxuICAgICAgICAgICAgICAgIGlmIChhcmcuZXhjbHVkZSkgICAgICAgICAgICAgICAgcHJvcFNldC5leGNsdWRlKGFyZy5leGNsdWRlKVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBwcm9wU2V0LmZsYXR0ZW5UbyhmbGF0dGVuaW5nKVxuICAgICAgICB9LCB0aGlzKVxuICAgICAgICBcbiAgICAgICAgZmxhdHRlbmluZy5jb21wb3NlVG8odGhpcylcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIHByZUFwcGx5IDogZnVuY3Rpb24gKHRhcmdldCkge1xuICAgICAgICB0aGlzLmVhY2hPd24oZnVuY3Rpb24gKHByb3BlcnR5KSB7XG4gICAgICAgICAgICBwcm9wZXJ0eS5wcmVBcHBseSh0YXJnZXQpXG4gICAgICAgIH0pXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBhcHBseSA6IGZ1bmN0aW9uICh0YXJnZXQpIHtcbiAgICAgICAgdGhpcy5lYWNoT3duKGZ1bmN0aW9uIChwcm9wZXJ0eSkge1xuICAgICAgICAgICAgcHJvcGVydHkuYXBwbHkodGFyZ2V0KVxuICAgICAgICB9KVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgdW5hcHBseSA6IGZ1bmN0aW9uIChmcm9tKSB7XG4gICAgICAgIHRoaXMuZWFjaE93bihmdW5jdGlvbiAocHJvcGVydHkpIHtcbiAgICAgICAgICAgIHByb3BlcnR5LnVuYXBwbHkoZnJvbSlcbiAgICAgICAgfSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIHBvc3RVbkFwcGx5IDogZnVuY3Rpb24gKHRhcmdldCkge1xuICAgICAgICB0aGlzLmVhY2hPd24oZnVuY3Rpb24gKHByb3BlcnR5KSB7XG4gICAgICAgICAgICBwcm9wZXJ0eS5wb3N0VW5BcHBseSh0YXJnZXQpXG4gICAgICAgIH0pXG4gICAgfVxuICAgIFxufSkuY1xuO1xudmFyIF9fSURfXyA9IDFcblxuXG5Kb29zZS5NYW5hZ2VkLlByb3BlcnR5U2V0Lk11dGFibGUgPSBuZXcgSm9vc2UuUHJvdG8uQ2xhc3MoJ0pvb3NlLk1hbmFnZWQuUHJvcGVydHlTZXQuTXV0YWJsZScsIHtcbiAgICBcbiAgICBpc2EgICAgICAgICAgICAgICAgIDogSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eVNldCxcblxuICAgIElEICAgICAgICAgICAgICAgICAgOiBudWxsLFxuICAgIFxuICAgIGRlcml2YXRpdmVzICAgICAgICAgOiBudWxsLFxuICAgIFxuICAgIG9wZW5lZCAgICAgICAgICAgICAgOiBudWxsLFxuICAgIFxuICAgIGNvbXBvc2VkRnJvbSAgICAgICAgOiBudWxsLFxuICAgIFxuICAgIFxuICAgIGluaXRpYWxpemUgOiBmdW5jdGlvbiAocHJvcHMpIHtcbiAgICAgICAgSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eVNldC5NdXRhYmxlLnN1cGVyQ2xhc3MuaW5pdGlhbGl6ZS5jYWxsKHRoaXMsIHByb3BzKVxuICAgICAgICBcbiAgICAgICAgLy9pbml0aWFsbHkgb3BlbmVkXG4gICAgICAgIHRoaXMub3BlbmVkICAgICAgICAgICAgID0gMVxuICAgICAgICB0aGlzLmRlcml2YXRpdmVzICAgICAgICA9IHt9XG4gICAgICAgIHRoaXMuSUQgICAgICAgICAgICAgICAgID0gX19JRF9fKytcbiAgICAgICAgdGhpcy5jb21wb3NlZEZyb20gICAgICAgPSBbXVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgYWRkQ29tcG9zZUluZm8gOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHRoaXMuZW5zdXJlT3BlbigpXG4gICAgICAgIFxuICAgICAgICBKb29zZS5BLmVhY2goYXJndW1lbnRzLCBmdW5jdGlvbiAoYXJnKSB7XG4gICAgICAgICAgICB0aGlzLmNvbXBvc2VkRnJvbS5wdXNoKGFyZylcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdmFyIHByb3BTZXQgPSBhcmcgaW5zdGFuY2VvZiBKb29zZS5NYW5hZ2VkLlByb3BlcnR5U2V0ID8gYXJnIDogYXJnLnByb3BlcnR5U2V0XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICBwcm9wU2V0LmRlcml2YXRpdmVzW3RoaXMuSURdID0gdGhpc1xuICAgICAgICB9LCB0aGlzKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgcmVtb3ZlQ29tcG9zZUluZm8gOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHRoaXMuZW5zdXJlT3BlbigpXG4gICAgICAgIFxuICAgICAgICBKb29zZS5BLmVhY2goYXJndW1lbnRzLCBmdW5jdGlvbiAoYXJnKSB7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciBpID0gMFxuICAgICAgICAgICAgXG4gICAgICAgICAgICB3aGlsZSAoaSA8IHRoaXMuY29tcG9zZWRGcm9tLmxlbmd0aCkge1xuICAgICAgICAgICAgICAgIHZhciBwcm9wU2V0ID0gdGhpcy5jb21wb3NlZEZyb21baV1cbiAgICAgICAgICAgICAgICBwcm9wU2V0ID0gcHJvcFNldCBpbnN0YW5jZW9mIEpvb3NlLk1hbmFnZWQuUHJvcGVydHlTZXQgPyBwcm9wU2V0IDogcHJvcFNldC5wcm9wZXJ0eVNldFxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIGlmIChhcmcgPT0gcHJvcFNldCkge1xuICAgICAgICAgICAgICAgICAgICBkZWxldGUgcHJvcFNldC5kZXJpdmF0aXZlc1t0aGlzLklEXVxuICAgICAgICAgICAgICAgICAgICB0aGlzLmNvbXBvc2VkRnJvbS5zcGxpY2UoaSwgMSlcbiAgICAgICAgICAgICAgICB9IGVsc2UgaSsrXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBcbiAgICAgICAgfSwgdGhpcylcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGVuc3VyZU9wZW4gOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIGlmICghdGhpcy5vcGVuZWQpIHRocm93IFwiTXV0YXRpb24gb2YgY2xvc2VkIHByb3BlcnR5IHNldDogW1wiICsgdGhpcy5uYW1lICsgXCJdXCJcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGFkZFByb3BlcnR5IDogZnVuY3Rpb24gKG5hbWUsIHByb3BzKSB7XG4gICAgICAgIHRoaXMuZW5zdXJlT3BlbigpXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eVNldC5NdXRhYmxlLnN1cGVyQ2xhc3MuYWRkUHJvcGVydHkuY2FsbCh0aGlzLCBuYW1lLCBwcm9wcylcbiAgICB9LFxuICAgIFxuXG4gICAgYWRkUHJvcGVydHlPYmplY3QgOiBmdW5jdGlvbiAob2JqZWN0KSB7XG4gICAgICAgIHRoaXMuZW5zdXJlT3BlbigpXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eVNldC5NdXRhYmxlLnN1cGVyQ2xhc3MuYWRkUHJvcGVydHlPYmplY3QuY2FsbCh0aGlzLCBvYmplY3QpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICByZW1vdmVQcm9wZXJ0eSA6IGZ1bmN0aW9uIChuYW1lKSB7XG4gICAgICAgIHRoaXMuZW5zdXJlT3BlbigpXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eVNldC5NdXRhYmxlLnN1cGVyQ2xhc3MucmVtb3ZlUHJvcGVydHkuY2FsbCh0aGlzLCBuYW1lKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgY29tcG9zZUZyb20gOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHRoaXMuZW5zdXJlT3BlbigpXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eVNldC5NdXRhYmxlLnN1cGVyQ2xhc3MuY29tcG9zZUZyb20uYXBwbHkodGhpcywgdGhpcy5jb21wb3NlZEZyb20pXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBvcGVuIDogZnVuY3Rpb24gKCkge1xuICAgICAgICB0aGlzLm9wZW5lZCsrXG4gICAgICAgIFxuICAgICAgICBpZiAodGhpcy5vcGVuZWQgPT0gMSkge1xuICAgICAgICBcbiAgICAgICAgICAgIEpvb3NlLk8uZWFjaCh0aGlzLmRlcml2YXRpdmVzLCBmdW5jdGlvbiAocHJvcFNldCkge1xuICAgICAgICAgICAgICAgIHByb3BTZXQub3BlbigpXG4gICAgICAgICAgICB9KVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLmRlQ29tcG9zZSgpXG4gICAgICAgIH1cbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGNsb3NlIDogZnVuY3Rpb24gKCkge1xuICAgICAgICBpZiAoIXRoaXMub3BlbmVkKSB0aHJvdyBcIlVubWF0Y2hlZCAnY2xvc2UnIG9wZXJhdGlvbiBvbiBwcm9wZXJ0eSBzZXQ6IFtcIiArIHRoaXMubmFtZSArIFwiXVwiXG4gICAgICAgIFxuICAgICAgICBpZiAodGhpcy5vcGVuZWQgPT0gMSkge1xuICAgICAgICAgICAgdGhpcy5yZUNvbXBvc2UoKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBKb29zZS5PLmVhY2godGhpcy5kZXJpdmF0aXZlcywgZnVuY3Rpb24gKHByb3BTZXQpIHtcbiAgICAgICAgICAgICAgICBwcm9wU2V0LmNsb3NlKClcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5vcGVuZWQtLVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgcmVDb21wb3NlIDogZnVuY3Rpb24gKCkge1xuICAgICAgICB0aGlzLmNvbXBvc2VGcm9tKClcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGRlQ29tcG9zZSA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgdGhpcy5lYWNoT3duKGZ1bmN0aW9uIChwcm9wZXJ0eSwgbmFtZSkge1xuICAgICAgICAgICAgaWYgKHByb3BlcnR5LmRlZmluZWRJbiAhPSB0aGlzKSB0aGlzLnJlbW92ZVByb3BlcnR5KG5hbWUpXG4gICAgICAgIH0sIHRoaXMpXG4gICAgfVxuICAgIFxufSkuYztcbkpvb3NlLk1hbmFnZWQuU3RlbUVsZW1lbnQgPSBmdW5jdGlvbiAoKSB7IHRocm93IFwiTW9kdWxlcyBtYXkgbm90IGJlIGluc3RhbnRpYXRlZC5cIiB9XG5cbkpvb3NlLk1hbmFnZWQuU3RlbUVsZW1lbnQuQXR0cmlidXRlcyA9IG5ldyBKb29zZS5Qcm90by5DbGFzcygnSm9vc2UuTWFuYWdlZC5TdGVtRWxlbWVudC5BdHRyaWJ1dGVzJywge1xuICAgIFxuICAgIGlzYSAgICAgICAgICAgICAgICAgICAgIDogSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eVNldC5NdXRhYmxlLFxuICAgIFxuICAgIHByb3BlcnR5TWV0YUNsYXNzICAgICAgIDogSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5BdHRyaWJ1dGVcbiAgICBcbn0pLmNcbjtcbkpvb3NlLk1hbmFnZWQuU3RlbUVsZW1lbnQuTWV0aG9kcyA9IG5ldyBKb29zZS5Qcm90by5DbGFzcygnSm9vc2UuTWFuYWdlZC5TdGVtRWxlbWVudC5NZXRob2RzJywge1xuICAgIFxuICAgIGlzYSA6IEpvb3NlLk1hbmFnZWQuUHJvcGVydHlTZXQuTXV0YWJsZSxcbiAgICBcbiAgICBwcm9wZXJ0eU1ldGFDbGFzcyA6IEpvb3NlLk1hbmFnZWQuUHJvcGVydHkuTWV0aG9kTW9kaWZpZXIuUHV0LFxuXG4gICAgXG4gICAgcHJlQXBwbHkgOiBmdW5jdGlvbiAoKSB7XG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBwb3N0VW5BcHBseSA6IGZ1bmN0aW9uICgpIHtcbiAgICB9XG4gICAgXG59KS5jO1xuSm9vc2UuTWFuYWdlZC5TdGVtRWxlbWVudC5SZXF1aXJlbWVudHMgPSBuZXcgSm9vc2UuUHJvdG8uQ2xhc3MoJ0pvb3NlLk1hbmFnZWQuU3RlbUVsZW1lbnQuUmVxdWlyZW1lbnRzJywge1xuXG4gICAgaXNhICAgICAgICAgICAgICAgICAgICAgOiBKb29zZS5NYW5hZ2VkLlByb3BlcnR5U2V0Lk11dGFibGUsXG4gICAgXG4gICAgcHJvcGVydHlNZXRhQ2xhc3MgICAgICAgOiBKb29zZS5NYW5hZ2VkLlByb3BlcnR5LlJlcXVpcmVtZW50LFxuICAgIFxuICAgIFxuICAgIFxuICAgIGFsaWFzIDogZnVuY3Rpb24gKCkge1xuICAgIH0sXG4gICAgXG4gICAgXG4gICAgZXhjbHVkZSA6IGZ1bmN0aW9uICgpIHtcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGZsYXR0ZW5UbyA6IGZ1bmN0aW9uICh0YXJnZXQpIHtcbiAgICAgICAgdGhpcy5lYWNoKGZ1bmN0aW9uIChwcm9wZXJ0eSwgbmFtZSkge1xuICAgICAgICAgICAgaWYgKCF0YXJnZXQuaGF2ZVByb3BlcnR5KG5hbWUpKSB0YXJnZXQuYWRkUHJvcGVydHlPYmplY3QocHJvcGVydHkpXG4gICAgICAgIH0pXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBjb21wb3NlVG8gOiBmdW5jdGlvbiAodGFyZ2V0KSB7XG4gICAgICAgIHRoaXMuZmxhdHRlblRvKHRhcmdldClcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIHByZUFwcGx5IDogZnVuY3Rpb24gKCkge1xuICAgIH0sXG4gICAgXG4gICAgXG4gICAgcG9zdFVuQXBwbHkgOiBmdW5jdGlvbiAoKSB7XG4gICAgfVxuICAgIFxufSkuYztcbkpvb3NlLk1hbmFnZWQuU3RlbUVsZW1lbnQuTWV0aG9kTW9kaWZpZXJzID0gbmV3IEpvb3NlLlByb3RvLkNsYXNzKCdKb29zZS5NYW5hZ2VkLlN0ZW1FbGVtZW50Lk1ldGhvZE1vZGlmaWVycycsIHtcblxuICAgIGlzYSAgICAgICAgICAgICAgICAgICAgIDogSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eVNldC5NdXRhYmxlLFxuICAgIFxuICAgIHByb3BlcnR5TWV0YUNsYXNzICAgICAgIDogbnVsbCxcbiAgICBcbiAgICBcbiAgICBhZGRQcm9wZXJ0eSA6IGZ1bmN0aW9uIChuYW1lLCBwcm9wcykge1xuICAgICAgICB2YXIgbWV0YUNsYXNzID0gcHJvcHMubWV0YVxuICAgICAgICBkZWxldGUgcHJvcHMubWV0YVxuICAgICAgICBcbiAgICAgICAgcHJvcHMuZGVmaW5lZEluICAgICAgICAgPSB0aGlzXG4gICAgICAgIHByb3BzLm5hbWUgICAgICAgICAgICAgID0gbmFtZVxuICAgICAgICBcbiAgICAgICAgdmFyIG1vZGlmaWVyICAgICAgICAgICAgPSBuZXcgbWV0YUNsYXNzKHByb3BzKVxuICAgICAgICB2YXIgcHJvcGVydGllcyAgICAgICAgICA9IHRoaXMucHJvcGVydGllc1xuICAgICAgICBcbiAgICAgICAgaWYgKCFwcm9wZXJ0aWVzW25hbWVdKSBwcm9wZXJ0aWVzWyBuYW1lIF0gPSBbXVxuICAgICAgICBcbiAgICAgICAgcHJvcGVydGllc1tuYW1lXS5wdXNoKG1vZGlmaWVyKVxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIG1vZGlmaWVyXG4gICAgfSxcbiAgICBcblxuICAgIGFkZFByb3BlcnR5T2JqZWN0IDogZnVuY3Rpb24gKG9iamVjdCkge1xuICAgICAgICB2YXIgbmFtZSAgICAgICAgICAgID0gb2JqZWN0Lm5hbWVcbiAgICAgICAgdmFyIHByb3BlcnRpZXMgICAgICA9IHRoaXMucHJvcGVydGllc1xuICAgICAgICBcbiAgICAgICAgaWYgKCFwcm9wZXJ0aWVzW25hbWVdKSBwcm9wZXJ0aWVzW25hbWVdID0gW11cbiAgICAgICAgXG4gICAgICAgIHByb3BlcnRpZXNbbmFtZV0ucHVzaChvYmplY3QpXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gb2JqZWN0XG4gICAgfSxcbiAgICBcbiAgICBcbiAgICAvL3JlbW92ZSBvbmx5IHRoZSBsYXN0IG1vZGlmaWVyXG4gICAgcmVtb3ZlUHJvcGVydHkgOiBmdW5jdGlvbiAobmFtZSkge1xuICAgICAgICBpZiAoIXRoaXMuaGF2ZVByb3BlcnR5KG5hbWUpKSByZXR1cm4gdW5kZWZpbmVkXG4gICAgICAgIFxuICAgICAgICB2YXIgcHJvcGVydGllcyAgICAgID0gdGhpcy5wcm9wZXJ0aWVzXG4gICAgICAgIHZhciBtb2RpZmllciAgICAgICAgPSBwcm9wZXJ0aWVzWyBuYW1lIF0ucG9wKClcbiAgICAgICAgXG4gICAgICAgIC8vaWYgYWxsIG1vZGlmaWVycyB3ZXJlIHJlbW92ZWQgLSBjbGVhcmluZyB0aGUgcHJvcGVydGllc1xuICAgICAgICBpZiAoIXByb3BlcnRpZXNbbmFtZV0ubGVuZ3RoKSBKb29zZS5NYW5hZ2VkLlN0ZW1FbGVtZW50Lk1ldGhvZE1vZGlmaWVycy5zdXBlckNsYXNzLnJlbW92ZVByb3BlcnR5LmNhbGwodGhpcywgbmFtZSlcbiAgICAgICAgXG4gICAgICAgIHJldHVybiBtb2RpZmllclxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgYWxpYXMgOiBmdW5jdGlvbiAoKSB7XG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBleGNsdWRlIDogZnVuY3Rpb24gKCkge1xuICAgIH0sXG4gICAgXG4gICAgXG4gICAgZmxhdHRlblRvIDogZnVuY3Rpb24gKHRhcmdldCkge1xuICAgICAgICB2YXIgdGFyZ2V0UHJvcHMgPSB0YXJnZXQucHJvcGVydGllc1xuICAgICAgICBcbiAgICAgICAgdGhpcy5lYWNoKGZ1bmN0aW9uIChtb2RpZmllcnNBcnIsIG5hbWUpIHtcbiAgICAgICAgICAgIHZhciB0YXJnZXRNb2RpZmllcnNBcnIgPSB0YXJnZXRQcm9wc1tuYW1lXVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAodGFyZ2V0TW9kaWZpZXJzQXJyID09IG51bGwpIHRhcmdldE1vZGlmaWVyc0FyciA9IHRhcmdldFByb3BzW25hbWVdID0gW11cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgSm9vc2UuQS5lYWNoKG1vZGlmaWVyc0FyciwgZnVuY3Rpb24gKG1vZGlmaWVyKSB7XG4gICAgICAgICAgICAgICAgaWYgKCFKb29zZS5BLmV4aXN0cyh0YXJnZXRNb2RpZmllcnNBcnIsIG1vZGlmaWVyKSkgdGFyZ2V0TW9kaWZpZXJzQXJyLnB1c2gobW9kaWZpZXIpXG4gICAgICAgICAgICB9KVxuICAgICAgICAgICAgXG4gICAgICAgIH0pXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBjb21wb3NlVG8gOiBmdW5jdGlvbiAodGFyZ2V0KSB7XG4gICAgICAgIHRoaXMuZmxhdHRlblRvKHRhcmdldClcbiAgICB9LFxuXG4gICAgXG4gICAgZGVDb21wb3NlIDogZnVuY3Rpb24gKCkge1xuICAgICAgICB0aGlzLmVhY2goZnVuY3Rpb24gKG1vZGlmaWVyc0FyciwgbmFtZSkge1xuICAgICAgICAgICAgdmFyIGkgPSAwXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHdoaWxlIChpIDwgbW9kaWZpZXJzQXJyLmxlbmd0aCkgXG4gICAgICAgICAgICAgICAgaWYgKG1vZGlmaWVyc0FycltpXS5kZWZpbmVkSW4gIT0gdGhpcykgXG4gICAgICAgICAgICAgICAgICAgIG1vZGlmaWVyc0Fyci5zcGxpY2UoaSwgMSlcbiAgICAgICAgICAgICAgICBlbHNlIFxuICAgICAgICAgICAgICAgICAgICBpKytcbiAgICAgICAgfSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIHByZUFwcGx5IDogZnVuY3Rpb24gKHRhcmdldCkge1xuICAgIH0sXG5cbiAgICBcbiAgICBwb3N0VW5BcHBseSA6IGZ1bmN0aW9uICh0YXJnZXQpIHtcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGFwcGx5IDogZnVuY3Rpb24gKHRhcmdldCkge1xuICAgICAgICB0aGlzLmVhY2goZnVuY3Rpb24gKG1vZGlmaWVyc0FyciwgbmFtZSkge1xuICAgICAgICAgICAgSm9vc2UuQS5lYWNoKG1vZGlmaWVyc0FyciwgZnVuY3Rpb24gKG1vZGlmaWVyKSB7XG4gICAgICAgICAgICAgICAgbW9kaWZpZXIuYXBwbHkodGFyZ2V0KVxuICAgICAgICAgICAgfSlcbiAgICAgICAgfSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIHVuYXBwbHkgOiBmdW5jdGlvbiAoZnJvbSkge1xuICAgICAgICB0aGlzLmVhY2goZnVuY3Rpb24gKG1vZGlmaWVyc0FyciwgbmFtZSkge1xuICAgICAgICAgICAgZm9yICh2YXIgaSA9IG1vZGlmaWVyc0Fyci5sZW5ndGggLSAxOyBpID49MCA7IGktLSkgbW9kaWZpZXJzQXJyW2ldLnVuYXBwbHkoZnJvbSlcbiAgICAgICAgfSlcbiAgICB9XG4gICAgXG4gICAgXG4gICAgXG59KS5jO1xuSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eVNldC5Db21wb3NpdGlvbiA9IG5ldyBKb29zZS5Qcm90by5DbGFzcygnSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eVNldC5Db21wb3NpdGlvbicsIHtcbiAgICBcbiAgICBpc2EgICAgICAgICAgICAgICAgICAgICAgICAgOiBKb29zZS5NYW5hZ2VkLlByb3BlcnR5U2V0Lk11dGFibGUsXG4gICAgXG4gICAgcHJvcGVydHlNZXRhQ2xhc3MgICAgICAgICAgIDogSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eVNldC5NdXRhYmxlLFxuICAgIFxuICAgIHByb2Nlc3NPcmRlciAgICAgICAgICAgICAgICA6IG51bGwsXG5cbiAgICBcbiAgICBlYWNoIDogZnVuY3Rpb24gKGZ1bmMsIHNjb3BlKSB7XG4gICAgICAgIHZhciBwcm9wcyAgID0gdGhpcy5wcm9wZXJ0aWVzXG4gICAgICAgIHZhciBzY29wZSAgID0gc2NvcGUgfHwgdGhpc1xuICAgICAgICBcbiAgICAgICAgSm9vc2UuQS5lYWNoKHRoaXMucHJvY2Vzc09yZGVyLCBmdW5jdGlvbiAobmFtZSkge1xuICAgICAgICAgICAgZnVuYy5jYWxsKHNjb3BlLCBwcm9wc1tuYW1lXSwgbmFtZSlcbiAgICAgICAgfSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGVhY2hSIDogZnVuY3Rpb24gKGZ1bmMsIHNjb3BlKSB7XG4gICAgICAgIHZhciBwcm9wcyAgID0gdGhpcy5wcm9wZXJ0aWVzXG4gICAgICAgIHZhciBzY29wZSAgID0gc2NvcGUgfHwgdGhpc1xuICAgICAgICBcbiAgICAgICAgSm9vc2UuQS5lYWNoUih0aGlzLnByb2Nlc3NPcmRlciwgZnVuY3Rpb24gKG5hbWUpIHtcbiAgICAgICAgICAgIGZ1bmMuY2FsbChzY29wZSwgcHJvcHNbbmFtZV0sIG5hbWUpXG4gICAgICAgIH0pXG4gICAgICAgIFxuICAgICAgICBcbi8vICAgICAgICB2YXIgcHJvcHMgICAgICAgICAgID0gdGhpcy5wcm9wZXJ0aWVzXG4vLyAgICAgICAgdmFyIHByb2Nlc3NPcmRlciAgICA9IHRoaXMucHJvY2Vzc09yZGVyXG4vLyAgICAgICAgXG4vLyAgICAgICAgZm9yKHZhciBpID0gcHJvY2Vzc09yZGVyLmxlbmd0aCAtIDE7IGkgPj0gMDsgaS0tKSBcbi8vICAgICAgICAgICAgZnVuYy5jYWxsKHNjb3BlIHx8IHRoaXMsIHByb3BzWyBwcm9jZXNzT3JkZXJbaV0gXSwgcHJvY2Vzc09yZGVyW2ldKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgY2xvbmUgOiBmdW5jdGlvbiAobmFtZSkge1xuICAgICAgICB2YXIgY2xvbmUgPSB0aGlzLmNsZWFuQ2xvbmUobmFtZSlcbiAgICAgICAgXG4gICAgICAgIHRoaXMuZWFjaChmdW5jdGlvbiAocHJvcGVydHkpIHtcbiAgICAgICAgICAgIGNsb25lLmFkZFByb3BlcnR5T2JqZWN0KHByb3BlcnR5LmNsb25lKCkpXG4gICAgICAgIH0pXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gY2xvbmVcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGFsaWFzIDogZnVuY3Rpb24gKHdoYXQpIHtcbiAgICAgICAgdGhpcy5lYWNoKGZ1bmN0aW9uIChwcm9wZXJ0eSkge1xuICAgICAgICAgICAgcHJvcGVydHkuYWxpYXMod2hhdClcbiAgICAgICAgfSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGV4Y2x1ZGUgOiBmdW5jdGlvbiAod2hhdCkge1xuICAgICAgICB0aGlzLmVhY2goZnVuY3Rpb24gKHByb3BlcnR5KSB7XG4gICAgICAgICAgICBwcm9wZXJ0eS5leGNsdWRlKHdoYXQpXG4gICAgICAgIH0pXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBmbGF0dGVuVG8gOiBmdW5jdGlvbiAodGFyZ2V0KSB7XG4gICAgICAgIHZhciB0YXJnZXRQcm9wcyA9IHRhcmdldC5wcm9wZXJ0aWVzXG4gICAgICAgIFxuICAgICAgICB0aGlzLmVhY2goZnVuY3Rpb24gKHByb3BlcnR5LCBuYW1lKSB7XG4gICAgICAgICAgICB2YXIgc3ViVGFyZ2V0ID0gdGFyZ2V0UHJvcHNbbmFtZV0gfHwgdGFyZ2V0LmFkZFByb3BlcnR5KG5hbWUsIHtcbiAgICAgICAgICAgICAgICBtZXRhIDogcHJvcGVydHkuY29uc3RydWN0b3JcbiAgICAgICAgICAgIH0pXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHByb3BlcnR5LmZsYXR0ZW5UbyhzdWJUYXJnZXQpXG4gICAgICAgIH0pXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBjb21wb3NlVG8gOiBmdW5jdGlvbiAodGFyZ2V0KSB7XG4gICAgICAgIHZhciB0YXJnZXRQcm9wcyA9IHRhcmdldC5wcm9wZXJ0aWVzXG4gICAgICAgIFxuICAgICAgICB0aGlzLmVhY2goZnVuY3Rpb24gKHByb3BlcnR5LCBuYW1lKSB7XG4gICAgICAgICAgICB2YXIgc3ViVGFyZ2V0ID0gdGFyZ2V0UHJvcHNbbmFtZV0gfHwgdGFyZ2V0LmFkZFByb3BlcnR5KG5hbWUsIHtcbiAgICAgICAgICAgICAgICBtZXRhIDogcHJvcGVydHkuY29uc3RydWN0b3JcbiAgICAgICAgICAgIH0pXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHByb3BlcnR5LmNvbXBvc2VUbyhzdWJUYXJnZXQpXG4gICAgICAgIH0pXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBcbiAgICBkZUNvbXBvc2UgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHRoaXMuZWFjaFIoZnVuY3Rpb24gKHByb3BlcnR5KSB7XG4gICAgICAgICAgICBwcm9wZXJ0eS5vcGVuKClcbiAgICAgICAgfSlcbiAgICAgICAgXG4gICAgICAgIEpvb3NlLk1hbmFnZWQuUHJvcGVydHlTZXQuQ29tcG9zaXRpb24uc3VwZXJDbGFzcy5kZUNvbXBvc2UuY2FsbCh0aGlzKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgcmVDb21wb3NlIDogZnVuY3Rpb24gKCkge1xuICAgICAgICBKb29zZS5NYW5hZ2VkLlByb3BlcnR5U2V0LkNvbXBvc2l0aW9uLnN1cGVyQ2xhc3MucmVDb21wb3NlLmNhbGwodGhpcylcbiAgICAgICAgXG4gICAgICAgIHRoaXMuZWFjaChmdW5jdGlvbiAocHJvcGVydHkpIHtcbiAgICAgICAgICAgIHByb3BlcnR5LmNsb3NlKClcbiAgICAgICAgfSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIHVuYXBwbHkgOiBmdW5jdGlvbiAoZnJvbSkge1xuICAgICAgICB0aGlzLmVhY2hSKGZ1bmN0aW9uIChwcm9wZXJ0eSkge1xuICAgICAgICAgICAgcHJvcGVydHkudW5hcHBseShmcm9tKVxuICAgICAgICB9KVxuICAgIH1cbiAgICBcbn0pLmNcbjtcbkpvb3NlLk1hbmFnZWQuU3RlbSA9IG5ldyBKb29zZS5Qcm90by5DbGFzcygnSm9vc2UuTWFuYWdlZC5TdGVtJywge1xuICAgIFxuICAgIGlzYSAgICAgICAgICAgICAgICAgIDogSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eVNldC5Db21wb3NpdGlvbixcbiAgICBcbiAgICB0YXJnZXRNZXRhICAgICAgICAgICA6IG51bGwsXG4gICAgXG4gICAgYXR0cmlidXRlc01DICAgICAgICAgOiBKb29zZS5NYW5hZ2VkLlN0ZW1FbGVtZW50LkF0dHJpYnV0ZXMsXG4gICAgbWV0aG9kc01DICAgICAgICAgICAgOiBKb29zZS5NYW5hZ2VkLlN0ZW1FbGVtZW50Lk1ldGhvZHMsXG4gICAgcmVxdWlyZW1lbnRzTUMgICAgICAgOiBKb29zZS5NYW5hZ2VkLlN0ZW1FbGVtZW50LlJlcXVpcmVtZW50cyxcbiAgICBtZXRob2RzTW9kaWZpZXJzTUMgICA6IEpvb3NlLk1hbmFnZWQuU3RlbUVsZW1lbnQuTWV0aG9kTW9kaWZpZXJzLFxuICAgIFxuICAgIHByb2Nlc3NPcmRlciAgICAgICAgIDogWyAnYXR0cmlidXRlcycsICdtZXRob2RzJywgJ3JlcXVpcmVtZW50cycsICdtZXRob2RzTW9kaWZpZXJzJyBdLFxuICAgIFxuICAgIFxuICAgIGluaXRpYWxpemUgOiBmdW5jdGlvbiAocHJvcHMpIHtcbiAgICAgICAgSm9vc2UuTWFuYWdlZC5TdGVtLnN1cGVyQ2xhc3MuaW5pdGlhbGl6ZS5jYWxsKHRoaXMsIHByb3BzKVxuICAgICAgICBcbiAgICAgICAgdmFyIHRhcmdldE1ldGEgPSB0aGlzLnRhcmdldE1ldGFcbiAgICAgICAgXG4gICAgICAgIHRoaXMuYWRkUHJvcGVydHkoJ2F0dHJpYnV0ZXMnLCB7XG4gICAgICAgICAgICBtZXRhIDogdGhpcy5hdHRyaWJ1dGVzTUMsXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vaXQgY2FuIGJlIG5vICd0YXJnZXRNZXRhJyBpbiBjbG9uZXNcbiAgICAgICAgICAgIHByb3BlcnRpZXMgOiB0YXJnZXRNZXRhID8gdGFyZ2V0TWV0YS5hdHRyaWJ1dGVzIDoge31cbiAgICAgICAgfSlcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICB0aGlzLmFkZFByb3BlcnR5KCdtZXRob2RzJywge1xuICAgICAgICAgICAgbWV0YSA6IHRoaXMubWV0aG9kc01DLFxuICAgICAgICAgICAgXG4gICAgICAgICAgICBwcm9wZXJ0aWVzIDogdGFyZ2V0TWV0YSA/IHRhcmdldE1ldGEubWV0aG9kcyA6IHt9XG4gICAgICAgIH0pXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgdGhpcy5hZGRQcm9wZXJ0eSgncmVxdWlyZW1lbnRzJywge1xuICAgICAgICAgICAgbWV0YSA6IHRoaXMucmVxdWlyZW1lbnRzTUNcbiAgICAgICAgfSlcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICB0aGlzLmFkZFByb3BlcnR5KCdtZXRob2RzTW9kaWZpZXJzJywge1xuICAgICAgICAgICAgbWV0YSA6IHRoaXMubWV0aG9kc01vZGlmaWVyc01DXG4gICAgICAgIH0pXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICByZUNvbXBvc2UgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHZhciBjICAgICAgID0gdGhpcy50YXJnZXRNZXRhLmNcbiAgICAgICAgXG4gICAgICAgIHRoaXMucHJlQXBwbHkoYylcbiAgICAgICAgXG4gICAgICAgIEpvb3NlLk1hbmFnZWQuU3RlbS5zdXBlckNsYXNzLnJlQ29tcG9zZS5jYWxsKHRoaXMpXG4gICAgICAgIFxuICAgICAgICB0aGlzLmFwcGx5KGMpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBkZUNvbXBvc2UgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHZhciBjICAgICAgID0gdGhpcy50YXJnZXRNZXRhLmNcbiAgICAgICAgXG4gICAgICAgIHRoaXMudW5hcHBseShjKVxuICAgICAgICBcbiAgICAgICAgSm9vc2UuTWFuYWdlZC5TdGVtLnN1cGVyQ2xhc3MuZGVDb21wb3NlLmNhbGwodGhpcylcbiAgICAgICAgXG4gICAgICAgIHRoaXMucG9zdFVuQXBwbHkoYylcbiAgICB9XG4gICAgXG4gICAgXG59KS5jXG47XG5Kb29zZS5NYW5hZ2VkLkJ1aWxkZXIgPSBuZXcgSm9vc2UuUHJvdG8uQ2xhc3MoJ0pvb3NlLk1hbmFnZWQuQnVpbGRlcicsIHtcbiAgICBcbiAgICB0YXJnZXRNZXRhICAgICAgICAgIDogbnVsbCxcbiAgICBcbiAgICBcbiAgICBfYnVpbGRTdGFydCA6IGZ1bmN0aW9uICh0YXJnZXRNZXRhLCBwcm9wcykge1xuICAgICAgICB0YXJnZXRNZXRhLnN0ZW0ub3BlbigpXG4gICAgICAgIFxuICAgICAgICBKb29zZS5BLmVhY2goWyAndHJhaXQnLCAndHJhaXRzJywgJ3JlbW92ZVRyYWl0JywgJ3JlbW92ZVRyYWl0cycsICdkb2VzJywgJ2RvZXNub3QnLCAnZG9lc250JyBdLCBmdW5jdGlvbiAoYnVpbGRlcikge1xuICAgICAgICAgICAgaWYgKHByb3BzW2J1aWxkZXJdKSB7XG4gICAgICAgICAgICAgICAgdGhpc1tidWlsZGVyXSh0YXJnZXRNZXRhLCBwcm9wc1tidWlsZGVyXSlcbiAgICAgICAgICAgICAgICBkZWxldGUgcHJvcHNbYnVpbGRlcl1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfSwgdGhpcylcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIF9leHRlbmQgOiBmdW5jdGlvbiAocHJvcHMpIHtcbiAgICAgICAgaWYgKEpvb3NlLk8uaXNFbXB0eShwcm9wcykpIHJldHVyblxuICAgICAgICBcbiAgICAgICAgdmFyIHRhcmdldE1ldGEgPSB0aGlzLnRhcmdldE1ldGFcbiAgICAgICAgXG4gICAgICAgIHRoaXMuX2J1aWxkU3RhcnQodGFyZ2V0TWV0YSwgcHJvcHMpXG4gICAgICAgIFxuICAgICAgICBKb29zZS5PLmVhY2hPd24ocHJvcHMsIGZ1bmN0aW9uICh2YWx1ZSwgbmFtZSkge1xuICAgICAgICAgICAgdmFyIGhhbmRsZXIgPSB0aGlzW25hbWVdXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmICghaGFuZGxlcikgdGhyb3cgbmV3IEVycm9yKFwiVW5rbm93biBidWlsZGVyIFtcIiArIG5hbWUgKyBcIl0gd2FzIHVzZWQgZHVyaW5nIGV4dGVuZGluZyBvZiBbXCIgKyB0YXJnZXRNZXRhLmMgKyBcIl1cIilcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaGFuZGxlci5jYWxsKHRoaXMsIHRhcmdldE1ldGEsIHZhbHVlKVxuICAgICAgICB9LCB0aGlzKVxuICAgICAgICBcbiAgICAgICAgdGhpcy5fYnVpbGRDb21wbGV0ZSh0YXJnZXRNZXRhLCBwcm9wcylcbiAgICB9LFxuICAgIFxuXG4gICAgX2J1aWxkQ29tcGxldGUgOiBmdW5jdGlvbiAodGFyZ2V0TWV0YSwgcHJvcHMpIHtcbiAgICAgICAgdGFyZ2V0TWV0YS5zdGVtLmNsb3NlKClcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIG1ldGhvZHMgOiBmdW5jdGlvbiAodGFyZ2V0TWV0YSwgaW5mbykge1xuICAgICAgICBKb29zZS5PLmVhY2hPd24oaW5mbywgZnVuY3Rpb24gKHZhbHVlLCBuYW1lKSB7XG4gICAgICAgICAgICB0YXJnZXRNZXRhLmFkZE1ldGhvZChuYW1lLCB2YWx1ZSlcbiAgICAgICAgfSlcbiAgICB9LFxuICAgIFxuXG4gICAgcmVtb3ZlTWV0aG9kcyA6IGZ1bmN0aW9uICh0YXJnZXRNZXRhLCBpbmZvKSB7XG4gICAgICAgIEpvb3NlLkEuZWFjaChpbmZvLCBmdW5jdGlvbiAobmFtZSkge1xuICAgICAgICAgICAgdGFyZ2V0TWV0YS5yZW1vdmVNZXRob2QobmFtZSlcbiAgICAgICAgfSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGhhdmUgOiBmdW5jdGlvbiAodGFyZ2V0TWV0YSwgaW5mbykge1xuICAgICAgICBKb29zZS5PLmVhY2hPd24oaW5mbywgZnVuY3Rpb24gKHZhbHVlLCBuYW1lKSB7XG4gICAgICAgICAgICB0YXJnZXRNZXRhLmFkZEF0dHJpYnV0ZShuYW1lLCB2YWx1ZSlcbiAgICAgICAgfSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGhhdmVub3QgOiBmdW5jdGlvbiAodGFyZ2V0TWV0YSwgaW5mbykge1xuICAgICAgICBKb29zZS5BLmVhY2goaW5mbywgZnVuY3Rpb24gKG5hbWUpIHtcbiAgICAgICAgICAgIHRhcmdldE1ldGEucmVtb3ZlQXR0cmlidXRlKG5hbWUpXG4gICAgICAgIH0pXG4gICAgfSxcbiAgICBcblxuICAgIGhhdmVudCA6IGZ1bmN0aW9uICh0YXJnZXRNZXRhLCBpbmZvKSB7XG4gICAgICAgIHRoaXMuaGF2ZW5vdCh0YXJnZXRNZXRhLCBpbmZvKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgYWZ0ZXIgOiBmdW5jdGlvbiAodGFyZ2V0TWV0YSwgaW5mbykge1xuICAgICAgICBKb29zZS5PLmVhY2goaW5mbywgZnVuY3Rpb24gKHZhbHVlLCBuYW1lKSB7XG4gICAgICAgICAgICB0YXJnZXRNZXRhLmFkZE1ldGhvZE1vZGlmaWVyKG5hbWUsIHZhbHVlLCBKb29zZS5NYW5hZ2VkLlByb3BlcnR5Lk1ldGhvZE1vZGlmaWVyLkFmdGVyKVxuICAgICAgICB9KVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgYmVmb3JlIDogZnVuY3Rpb24gKHRhcmdldE1ldGEsIGluZm8pIHtcbiAgICAgICAgSm9vc2UuTy5lYWNoKGluZm8sIGZ1bmN0aW9uICh2YWx1ZSwgbmFtZSkge1xuICAgICAgICAgICAgdGFyZ2V0TWV0YS5hZGRNZXRob2RNb2RpZmllcihuYW1lLCB2YWx1ZSwgSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5NZXRob2RNb2RpZmllci5CZWZvcmUpXG4gICAgICAgIH0pXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBvdmVycmlkZSA6IGZ1bmN0aW9uICh0YXJnZXRNZXRhLCBpbmZvKSB7XG4gICAgICAgIEpvb3NlLk8uZWFjaChpbmZvLCBmdW5jdGlvbiAodmFsdWUsIG5hbWUpIHtcbiAgICAgICAgICAgIHRhcmdldE1ldGEuYWRkTWV0aG9kTW9kaWZpZXIobmFtZSwgdmFsdWUsIEpvb3NlLk1hbmFnZWQuUHJvcGVydHkuTWV0aG9kTW9kaWZpZXIuT3ZlcnJpZGUpXG4gICAgICAgIH0pXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBhcm91bmQgOiBmdW5jdGlvbiAodGFyZ2V0TWV0YSwgaW5mbykge1xuICAgICAgICBKb29zZS5PLmVhY2goaW5mbywgZnVuY3Rpb24gKHZhbHVlLCBuYW1lKSB7XG4gICAgICAgICAgICB0YXJnZXRNZXRhLmFkZE1ldGhvZE1vZGlmaWVyKG5hbWUsIHZhbHVlLCBKb29zZS5NYW5hZ2VkLlByb3BlcnR5Lk1ldGhvZE1vZGlmaWVyLkFyb3VuZClcbiAgICAgICAgfSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGF1Z21lbnQgOiBmdW5jdGlvbiAodGFyZ2V0TWV0YSwgaW5mbykge1xuICAgICAgICBKb29zZS5PLmVhY2goaW5mbywgZnVuY3Rpb24gKHZhbHVlLCBuYW1lKSB7XG4gICAgICAgICAgICB0YXJnZXRNZXRhLmFkZE1ldGhvZE1vZGlmaWVyKG5hbWUsIHZhbHVlLCBKb29zZS5NYW5hZ2VkLlByb3BlcnR5Lk1ldGhvZE1vZGlmaWVyLkF1Z21lbnQpXG4gICAgICAgIH0pXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICByZW1vdmVNb2RpZmllciA6IGZ1bmN0aW9uICh0YXJnZXRNZXRhLCBpbmZvKSB7XG4gICAgICAgIEpvb3NlLkEuZWFjaChpbmZvLCBmdW5jdGlvbiAobmFtZSkge1xuICAgICAgICAgICAgdGFyZ2V0TWV0YS5yZW1vdmVNZXRob2RNb2RpZmllcihuYW1lKVxuICAgICAgICB9KVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgZG9lcyA6IGZ1bmN0aW9uICh0YXJnZXRNZXRhLCBpbmZvKSB7XG4gICAgICAgIEpvb3NlLkEuZWFjaChKb29zZS5PLndhbnRBcnJheShpbmZvKSwgZnVuY3Rpb24gKGRlc2MpIHtcbiAgICAgICAgICAgIHRhcmdldE1ldGEuYWRkUm9sZShkZXNjKVxuICAgICAgICB9KVxuICAgIH0sXG4gICAgXG5cbiAgICBkb2Vzbm90IDogZnVuY3Rpb24gKHRhcmdldE1ldGEsIGluZm8pIHtcbiAgICAgICAgSm9vc2UuQS5lYWNoKEpvb3NlLk8ud2FudEFycmF5KGluZm8pLCBmdW5jdGlvbiAoZGVzYykge1xuICAgICAgICAgICAgdGFyZ2V0TWV0YS5yZW1vdmVSb2xlKGRlc2MpXG4gICAgICAgIH0pXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBkb2VzbnQgOiBmdW5jdGlvbiAodGFyZ2V0TWV0YSwgaW5mbykge1xuICAgICAgICB0aGlzLmRvZXNub3QodGFyZ2V0TWV0YSwgaW5mbylcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIHRyYWl0IDogZnVuY3Rpb24gKCkge1xuICAgICAgICB0aGlzLnRyYWl0cy5hcHBseSh0aGlzLCBhcmd1bWVudHMpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICB0cmFpdHMgOiBmdW5jdGlvbiAodGFyZ2V0TWV0YSwgaW5mbykge1xuICAgICAgICBpZiAodGFyZ2V0TWV0YS5maXJzdFBhc3MpIHJldHVyblxuICAgICAgICBcbiAgICAgICAgaWYgKCF0YXJnZXRNZXRhLm1ldGEuaXNEZXRhY2hlZCkgdGhyb3cgXCJDYW4ndCBhcHBseSB0cmFpdCB0byBub3QgZGV0YWNoZWQgY2xhc3NcIlxuICAgICAgICBcbiAgICAgICAgdGFyZ2V0TWV0YS5tZXRhLmV4dGVuZCh7XG4gICAgICAgICAgICBkb2VzIDogaW5mb1xuICAgICAgICB9KVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgcmVtb3ZlVHJhaXQgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHRoaXMucmVtb3ZlVHJhaXRzLmFwcGx5KHRoaXMsIGFyZ3VtZW50cylcbiAgICB9LFxuICAgICBcbiAgICBcbiAgICByZW1vdmVUcmFpdHMgOiBmdW5jdGlvbiAodGFyZ2V0TWV0YSwgaW5mbykge1xuICAgICAgICBpZiAoIXRhcmdldE1ldGEubWV0YS5pc0RldGFjaGVkKSB0aHJvdyBcIkNhbid0IHJlbW92ZSB0cmFpdCBmcm9tIG5vdCBkZXRhY2hlZCBjbGFzc1wiXG4gICAgICAgIFxuICAgICAgICB0YXJnZXRNZXRhLm1ldGEuZXh0ZW5kKHtcbiAgICAgICAgICAgIGRvZXNub3QgOiBpbmZvXG4gICAgICAgIH0pXG4gICAgfVxuICAgIFxuICAgIFxuICAgIFxufSkuYztcbkpvb3NlLk1hbmFnZWQuQ2xhc3MgPSBuZXcgSm9vc2UuUHJvdG8uQ2xhc3MoJ0pvb3NlLk1hbmFnZWQuQ2xhc3MnLCB7XG4gICAgXG4gICAgaXNhICAgICAgICAgICAgICAgICAgICAgICAgIDogSm9vc2UuUHJvdG8uQ2xhc3MsXG4gICAgXG4gICAgc3RlbSAgICAgICAgICAgICAgICAgICAgICAgIDogbnVsbCxcbiAgICBzdGVtQ2xhc3MgICAgICAgICAgICAgICAgICAgOiBKb29zZS5NYW5hZ2VkLlN0ZW0sXG4gICAgc3RlbUNsYXNzQ3JlYXRlZCAgICAgICAgICAgIDogZmFsc2UsXG4gICAgXG4gICAgYnVpbGRlciAgICAgICAgICAgICAgICAgICAgIDogbnVsbCxcbiAgICBidWlsZGVyQ2xhc3MgICAgICAgICAgICAgICAgOiBKb29zZS5NYW5hZ2VkLkJ1aWxkZXIsXG4gICAgYnVpbGRlckNsYXNzQ3JlYXRlZCAgICAgICAgIDogZmFsc2UsXG4gICAgXG4gICAgaXNEZXRhY2hlZCAgICAgICAgICAgICAgICAgIDogZmFsc2UsXG4gICAgZmlyc3RQYXNzICAgICAgICAgICAgICAgICAgIDogdHJ1ZSxcbiAgICBcbiAgICAvLyBhIHNwZWNpYWwgaW5zdGFuY2UsIHdoaWNoLCB3aGVuIHBhc3NlZCBhcyAxc3QgYXJndW1lbnQgdG8gY29uc3RydWN0b3IsIHNpZ25pZmllcyB0aGF0IGNvbnN0cnVjdG9yIHNob3VsZFxuICAgIC8vIHNraXBzIHRyYWl0cyBwcm9jZXNzaW5nIGZvciB0aGlzIGluc3RhbmNlXG4gICAgc2tpcFRyYWl0c0FuY2hvciAgICAgICAgICAgIDoge30sXG4gICAgXG4gICAgXG4gICAgLy9idWlsZCBmb3IgbWV0YWNsYXNzZXMgLSBjb2xsZWN0cyB0cmFpdHMgZnJvbSByb2xlc1xuICAgIEJVSUxEIDogZnVuY3Rpb24gKCkge1xuICAgICAgICB2YXIgc3VwID0gSm9vc2UuTWFuYWdlZC5DbGFzcy5zdXBlckNsYXNzLkJVSUxELmFwcGx5KHRoaXMsIGFyZ3VtZW50cylcbiAgICAgICAgXG4gICAgICAgIHZhciBwcm9wcyAgID0gc3VwLl9fZXh0ZW5kX19cbiAgICAgICAgXG4gICAgICAgIHZhciB0cmFpdHMgPSBKb29zZS5PLndhbnRBcnJheShwcm9wcy50cmFpdCB8fCBwcm9wcy50cmFpdHMgfHwgW10pXG4gICAgICAgIGRlbGV0ZSBwcm9wcy50cmFpdFxuICAgICAgICBkZWxldGUgcHJvcHMudHJhaXRzXG4gICAgICAgIFxuICAgICAgICBKb29zZS5BLmVhY2goSm9vc2UuTy53YW50QXJyYXkocHJvcHMuZG9lcyB8fCBbXSksIGZ1bmN0aW9uIChhcmcpIHtcbiAgICAgICAgICAgIHZhciByb2xlID0gKGFyZy5tZXRhIGluc3RhbmNlb2YgSm9vc2UuTWFuYWdlZC5DbGFzcykgPyBhcmcgOiBhcmcucm9sZVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAocm9sZS5tZXRhLm1ldGEuaXNEZXRhY2hlZCkgdHJhaXRzLnB1c2gocm9sZS5tZXRhLmNvbnN0cnVjdG9yKVxuICAgICAgICB9KVxuICAgICAgICBcbiAgICAgICAgaWYgKHRyYWl0cy5sZW5ndGgpIHByb3BzLnRyYWl0cyA9IHRyYWl0cyBcbiAgICAgICAgXG4gICAgICAgIHJldHVybiBzdXBcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGluaXRJbnN0YW5jZSA6IGZ1bmN0aW9uIChpbnN0YW5jZSwgcHJvcHMpIHtcbiAgICAgICAgSm9vc2UuTy5lYWNoKHRoaXMuYXR0cmlidXRlcywgZnVuY3Rpb24gKGF0dHJpYnV0ZSwgbmFtZSkge1xuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAoYXR0cmlidXRlIGluc3RhbmNlb2YgSm9vc2UuTWFuYWdlZC5BdHRyaWJ1dGUpIFxuICAgICAgICAgICAgICAgIGF0dHJpYnV0ZS5pbml0RnJvbUNvbmZpZyhpbnN0YW5jZSwgcHJvcHMpXG4gICAgICAgICAgICBlbHNlIFxuICAgICAgICAgICAgICAgIGlmIChwcm9wcy5oYXNPd25Qcm9wZXJ0eShuYW1lKSkgaW5zdGFuY2VbbmFtZV0gPSBwcm9wc1tuYW1lXVxuICAgICAgICB9KVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgLy8gd2UgYXJlIHVzaW5nIHRoZSBzYW1lIGNvbnN0cnVjdG9yIGZvciB1c3VhbCBhbmQgbWV0YS0gY2xhc3Nlc1xuICAgIGRlZmF1bHRDb25zdHJ1Y3RvcjogZnVuY3Rpb24gKCkge1xuICAgICAgICByZXR1cm4gZnVuY3Rpb24gKHNraXBUcmFpdHNBbmNob3IsIHBhcmFtcykge1xuICAgICAgICAgICAgXG4gICAgICAgICAgICB2YXIgdGhpc01ldGEgICAgPSB0aGlzLm1ldGFcbiAgICAgICAgICAgIHZhciBza2lwVHJhaXRzICA9IHNraXBUcmFpdHNBbmNob3IgPT0gdGhpc01ldGEuc2tpcFRyYWl0c0FuY2hvclxuICAgICAgICAgICAgXG4gICAgICAgICAgICB2YXIgQlVJTEQgICAgICAgPSB0aGlzLkJVSUxEXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciBwcm9wcyAgICAgICA9IEJVSUxEICYmIEJVSUxELmFwcGx5KHRoaXMsIHNraXBUcmFpdHMgPyBwYXJhbXMgOiBhcmd1bWVudHMpIHx8IChza2lwVHJhaXRzID8gcGFyYW1zWzBdIDogc2tpcFRyYWl0c0FuY2hvcikgfHwge31cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBlaXRoZXIgbG9va2luZyBmb3IgdHJhaXRzIGluIF9fZXh0ZW5kX18gKG1ldGEtY2xhc3MpIG9yIGluIHVzdWFsIHByb3BzICh1c3VhbCBjbGFzcylcbiAgICAgICAgICAgIHZhciBleHRlbmQgID0gcHJvcHMuX19leHRlbmRfXyB8fCBwcm9wc1xuICAgICAgICAgICAgXG4gICAgICAgICAgICB2YXIgdHJhaXRzID0gZXh0ZW5kLnRyYWl0IHx8IGV4dGVuZC50cmFpdHNcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKHRyYWl0cyB8fCBleHRlbmQuZGV0YWNoZWQpIHtcbiAgICAgICAgICAgICAgICBkZWxldGUgZXh0ZW5kLnRyYWl0XG4gICAgICAgICAgICAgICAgZGVsZXRlIGV4dGVuZC50cmFpdHNcbiAgICAgICAgICAgICAgICBkZWxldGUgZXh0ZW5kLmRldGFjaGVkXG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgaWYgKCFza2lwVHJhaXRzKSB7XG4gICAgICAgICAgICAgICAgICAgIHZhciBjbGFzc1dpdGhUcmFpdCAgPSB0aGlzTWV0YS5zdWJDbGFzcyh7IGRvZXMgOiB0cmFpdHMgfHwgW10gfSwgdGhpc01ldGEubmFtZSlcbiAgICAgICAgICAgICAgICAgICAgdmFyIG1ldGEgICAgICAgICAgICA9IGNsYXNzV2l0aFRyYWl0Lm1ldGFcbiAgICAgICAgICAgICAgICAgICAgbWV0YS5pc0RldGFjaGVkICAgICA9IHRydWVcbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBtZXRhLmluc3RhbnRpYXRlKHRoaXNNZXRhLnNraXBUcmFpdHNBbmNob3IsIGFyZ3VtZW50cylcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXNNZXRhLmluaXRJbnN0YW5jZSh0aGlzLCBwcm9wcylcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcmV0dXJuIHRoaXNNZXRhLmhhc01ldGhvZCgnaW5pdGlhbGl6ZScpICYmIHRoaXMuaW5pdGlhbGl6ZShwcm9wcykgfHwgdGhpc1xuICAgICAgICB9XG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBmaW5hbGl6ZTogZnVuY3Rpb24gKGV4dGVuZCkge1xuICAgICAgICBKb29zZS5NYW5hZ2VkLkNsYXNzLnN1cGVyQ2xhc3MuZmluYWxpemUuY2FsbCh0aGlzLCBleHRlbmQpXG4gICAgICAgIFxuICAgICAgICB0aGlzLnN0ZW0uY2xvc2UoKVxuICAgICAgICBcbiAgICAgICAgdGhpcy5hZnRlck11dGF0ZSgpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBwcm9jZXNzU3RlbSA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgSm9vc2UuTWFuYWdlZC5DbGFzcy5zdXBlckNsYXNzLnByb2Nlc3NTdGVtLmNhbGwodGhpcylcbiAgICAgICAgXG4gICAgICAgIHRoaXMuYnVpbGRlciAgICA9IG5ldyB0aGlzLmJ1aWxkZXJDbGFzcyh7IHRhcmdldE1ldGEgOiB0aGlzIH0pXG4gICAgICAgIHRoaXMuc3RlbSAgICAgICA9IG5ldyB0aGlzLnN0ZW1DbGFzcyh7IG5hbWUgOiB0aGlzLm5hbWUsIHRhcmdldE1ldGEgOiB0aGlzIH0pXG4gICAgICAgIFxuICAgICAgICB2YXIgYnVpbGRlckNsYXNzID0gdGhpcy5nZXRDbGFzc0luQXR0cmlidXRlKCdidWlsZGVyQ2xhc3MnKVxuICAgICAgICBcbiAgICAgICAgaWYgKGJ1aWxkZXJDbGFzcykge1xuICAgICAgICAgICAgdGhpcy5idWlsZGVyQ2xhc3NDcmVhdGVkID0gdHJ1ZVxuICAgICAgICAgICAgdGhpcy5hZGRBdHRyaWJ1dGUoJ2J1aWxkZXJDbGFzcycsIHRoaXMuc3ViQ2xhc3NPZihidWlsZGVyQ2xhc3MpKVxuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgdmFyIHN0ZW1DbGFzcyA9IHRoaXMuZ2V0Q2xhc3NJbkF0dHJpYnV0ZSgnc3RlbUNsYXNzJylcbiAgICAgICAgXG4gICAgICAgIGlmIChzdGVtQ2xhc3MpIHtcbiAgICAgICAgICAgIHRoaXMuc3RlbUNsYXNzQ3JlYXRlZCA9IHRydWVcbiAgICAgICAgICAgIHRoaXMuYWRkQXR0cmlidXRlKCdzdGVtQ2xhc3MnLCB0aGlzLnN1YkNsYXNzT2Yoc3RlbUNsYXNzKSlcbiAgICAgICAgfVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgZXh0ZW5kIDogZnVuY3Rpb24gKHByb3BzKSB7XG4gICAgICAgIGlmIChwcm9wcy5idWlsZGVyKSB7XG4gICAgICAgICAgICB0aGlzLmdldEJ1aWxkZXJUYXJnZXQoKS5tZXRhLmV4dGVuZChwcm9wcy5idWlsZGVyKVxuICAgICAgICAgICAgZGVsZXRlIHByb3BzLmJ1aWxkZXJcbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgaWYgKHByb3BzLnN0ZW0pIHtcbiAgICAgICAgICAgIHRoaXMuZ2V0U3RlbVRhcmdldCgpLm1ldGEuZXh0ZW5kKHByb3BzLnN0ZW0pXG4gICAgICAgICAgICBkZWxldGUgcHJvcHMuc3RlbVxuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICB0aGlzLmJ1aWxkZXIuX2V4dGVuZChwcm9wcylcbiAgICAgICAgXG4gICAgICAgIHRoaXMuZmlyc3RQYXNzID0gZmFsc2VcbiAgICAgICAgXG4gICAgICAgIGlmICghdGhpcy5zdGVtLm9wZW5lZCkgdGhpcy5hZnRlck11dGF0ZSgpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBnZXRCdWlsZGVyVGFyZ2V0IDogZnVuY3Rpb24gKCkge1xuICAgICAgICB2YXIgYnVpbGRlckNsYXNzID0gdGhpcy5nZXRDbGFzc0luQXR0cmlidXRlKCdidWlsZGVyQ2xhc3MnKVxuICAgICAgICBpZiAoIWJ1aWxkZXJDbGFzcykgdGhyb3cgXCJBdHRlbXB0IHRvIGV4dGVuZCBhIGJ1aWxkZXIgb24gbm9uLW1ldGEgY2xhc3NcIlxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIGJ1aWxkZXJDbGFzc1xuICAgIH0sXG4gICAgXG5cbiAgICBnZXRTdGVtVGFyZ2V0IDogZnVuY3Rpb24gKCkge1xuICAgICAgICB2YXIgc3RlbUNsYXNzID0gdGhpcy5nZXRDbGFzc0luQXR0cmlidXRlKCdzdGVtQ2xhc3MnKVxuICAgICAgICBpZiAoIXN0ZW1DbGFzcykgdGhyb3cgXCJBdHRlbXB0IHRvIGV4dGVuZCBhIHN0ZW0gb24gbm9uLW1ldGEgY2xhc3NcIlxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIHN0ZW1DbGFzc1xuICAgIH0sXG4gICAgXG4gICAgXG4gICAgZ2V0Q2xhc3NJbkF0dHJpYnV0ZSA6IGZ1bmN0aW9uIChhdHRyaWJ1dGVOYW1lKSB7XG4gICAgICAgIHZhciBhdHRyQ2xhc3MgPSB0aGlzLmdldEF0dHJpYnV0ZShhdHRyaWJ1dGVOYW1lKVxuICAgICAgICBpZiAoYXR0ckNsYXNzIGluc3RhbmNlb2YgSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5BdHRyaWJ1dGUpIGF0dHJDbGFzcyA9IGF0dHJDbGFzcy52YWx1ZVxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIGF0dHJDbGFzc1xuICAgIH0sXG4gICAgXG4gICAgXG4gICAgYWRkTWV0aG9kTW9kaWZpZXI6IGZ1bmN0aW9uIChuYW1lLCBmdW5jLCB0eXBlKSB7XG4gICAgICAgIHZhciBwcm9wcyA9IHt9XG4gICAgICAgIFxuICAgICAgICBwcm9wcy5pbml0ID0gZnVuY1xuICAgICAgICBwcm9wcy5tZXRhID0gdHlwZVxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIHRoaXMuc3RlbS5wcm9wZXJ0aWVzLm1ldGhvZHNNb2RpZmllcnMuYWRkUHJvcGVydHkobmFtZSwgcHJvcHMpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICByZW1vdmVNZXRob2RNb2RpZmllcjogZnVuY3Rpb24gKG5hbWUpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuc3RlbS5wcm9wZXJ0aWVzLm1ldGhvZHNNb2RpZmllcnMucmVtb3ZlUHJvcGVydHkobmFtZSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGFkZE1ldGhvZDogZnVuY3Rpb24gKG5hbWUsIGZ1bmMsIHByb3BzKSB7XG4gICAgICAgIHByb3BzID0gcHJvcHMgfHwge31cbiAgICAgICAgcHJvcHMuaW5pdCA9IGZ1bmNcbiAgICAgICAgXG4gICAgICAgIHJldHVybiB0aGlzLnN0ZW0ucHJvcGVydGllcy5tZXRob2RzLmFkZFByb3BlcnR5KG5hbWUsIHByb3BzKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgYWRkQXR0cmlidXRlOiBmdW5jdGlvbiAobmFtZSwgaW5pdCwgcHJvcHMpIHtcbiAgICAgICAgcHJvcHMgPSBwcm9wcyB8fCB7fVxuICAgICAgICBwcm9wcy5pbml0ID0gaW5pdFxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIHRoaXMuc3RlbS5wcm9wZXJ0aWVzLmF0dHJpYnV0ZXMuYWRkUHJvcGVydHkobmFtZSwgcHJvcHMpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICByZW1vdmVNZXRob2QgOiBmdW5jdGlvbiAobmFtZSkge1xuICAgICAgICByZXR1cm4gdGhpcy5zdGVtLnByb3BlcnRpZXMubWV0aG9kcy5yZW1vdmVQcm9wZXJ0eShuYW1lKVxuICAgIH0sXG5cbiAgICBcbiAgICByZW1vdmVBdHRyaWJ1dGU6IGZ1bmN0aW9uIChuYW1lKSB7XG4gICAgICAgIHJldHVybiB0aGlzLnN0ZW0ucHJvcGVydGllcy5hdHRyaWJ1dGVzLnJlbW92ZVByb3BlcnR5KG5hbWUpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBoYXNNZXRob2Q6IGZ1bmN0aW9uIChuYW1lKSB7XG4gICAgICAgIHJldHVybiB0aGlzLnN0ZW0ucHJvcGVydGllcy5tZXRob2RzLmhhdmVQcm9wZXJ0eShuYW1lKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgaGFzQXR0cmlidXRlOiBmdW5jdGlvbiAobmFtZSkgeyBcbiAgICAgICAgcmV0dXJuIHRoaXMuc3RlbS5wcm9wZXJ0aWVzLmF0dHJpYnV0ZXMuaGF2ZVByb3BlcnR5KG5hbWUpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBoYXNNZXRob2RNb2RpZmllcnNGb3IgOiBmdW5jdGlvbiAobmFtZSkge1xuICAgICAgICByZXR1cm4gdGhpcy5zdGVtLnByb3BlcnRpZXMubWV0aG9kc01vZGlmaWVycy5oYXZlUHJvcGVydHkobmFtZSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGhhc093bk1ldGhvZDogZnVuY3Rpb24gKG5hbWUpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuc3RlbS5wcm9wZXJ0aWVzLm1ldGhvZHMuaGF2ZU93blByb3BlcnR5KG5hbWUpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBoYXNPd25BdHRyaWJ1dGU6IGZ1bmN0aW9uIChuYW1lKSB7IFxuICAgICAgICByZXR1cm4gdGhpcy5zdGVtLnByb3BlcnRpZXMuYXR0cmlidXRlcy5oYXZlT3duUHJvcGVydHkobmFtZSlcbiAgICB9LFxuICAgIFxuXG4gICAgZ2V0TWV0aG9kIDogZnVuY3Rpb24gKG5hbWUpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuc3RlbS5wcm9wZXJ0aWVzLm1ldGhvZHMuZ2V0UHJvcGVydHkobmFtZSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGdldEF0dHJpYnV0ZSA6IGZ1bmN0aW9uIChuYW1lKSB7XG4gICAgICAgIHJldHVybiB0aGlzLnN0ZW0ucHJvcGVydGllcy5hdHRyaWJ1dGVzLmdldFByb3BlcnR5KG5hbWUpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBlYWNoUm9sZSA6IGZ1bmN0aW9uIChyb2xlcywgZnVuYywgc2NvcGUpIHtcbiAgICAgICAgSm9vc2UuQS5lYWNoKHJvbGVzLCBmdW5jdGlvbiAoYXJnLCBpbmRleCkge1xuICAgICAgICAgICAgdmFyIHJvbGUgPSAoYXJnLm1ldGEgaW5zdGFuY2VvZiBKb29zZS5NYW5hZ2VkLkNsYXNzKSA/IGFyZyA6IGFyZy5yb2xlXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGZ1bmMuY2FsbChzY29wZSB8fCB0aGlzLCBhcmcsIHJvbGUsIGluZGV4KVxuICAgICAgICB9LCB0aGlzKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgYWRkUm9sZSA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgXG4gICAgICAgIHRoaXMuZWFjaFJvbGUoYXJndW1lbnRzLCBmdW5jdGlvbiAoYXJnLCByb2xlKSB7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXMuYmVmb3JlUm9sZUFkZChyb2xlKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB2YXIgZGVzYyA9IGFyZ1xuICAgICAgICAgICAgXG4gICAgICAgICAgICAvL2NvbXBvc2UgZGVzY3JpcHRvciBjYW4gY29udGFpbiAnYWxpYXMnIGFuZCAnZXhjbHVkZScgZmllbGRzLCBpbiB0aGlzIGNhc2UgYWN0dWFsIHJlZmVyZW5jZSBzaG91bGQgYmUgc3RvcmVkXG4gICAgICAgICAgICAvL2ludG8gJ3Byb3BlcnR5U2V0JyBmaWVsZFxuICAgICAgICAgICAgaWYgKHJvbGUgIT0gYXJnKSB7XG4gICAgICAgICAgICAgICAgZGVzYy5wcm9wZXJ0eVNldCA9IHJvbGUubWV0YS5zdGVtXG4gICAgICAgICAgICAgICAgZGVsZXRlIGRlc2Mucm9sZVxuICAgICAgICAgICAgfSBlbHNlXG4gICAgICAgICAgICAgICAgZGVzYyA9IGRlc2MubWV0YS5zdGVtXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXMuc3RlbS5hZGRDb21wb3NlSW5mbyhkZXNjKVxuICAgICAgICAgICAgXG4gICAgICAgIH0sIHRoaXMpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBiZWZvcmVSb2xlQWRkIDogZnVuY3Rpb24gKHJvbGUpIHtcbiAgICAgICAgdmFyIHJvbGVNZXRhID0gcm9sZS5tZXRhXG4gICAgICAgIFxuICAgICAgICBpZiAocm9sZU1ldGEuYnVpbGRlckNsYXNzQ3JlYXRlZCkgdGhpcy5nZXRCdWlsZGVyVGFyZ2V0KCkubWV0YS5leHRlbmQoe1xuICAgICAgICAgICAgZG9lcyA6IFsgcm9sZU1ldGEuZ2V0QnVpbGRlclRhcmdldCgpIF1cbiAgICAgICAgfSlcbiAgICAgICAgXG4gICAgICAgIGlmIChyb2xlTWV0YS5zdGVtQ2xhc3NDcmVhdGVkKSB0aGlzLmdldFN0ZW1UYXJnZXQoKS5tZXRhLmV4dGVuZCh7XG4gICAgICAgICAgICBkb2VzIDogWyByb2xlTWV0YS5nZXRTdGVtVGFyZ2V0KCkgXVxuICAgICAgICB9KVxuICAgICAgICBcbiAgICAgICAgaWYgKHJvbGVNZXRhLm1ldGEuaXNEZXRhY2hlZCAmJiAhdGhpcy5maXJzdFBhc3MpIHRoaXMuYnVpbGRlci50cmFpdHModGhpcywgcm9sZU1ldGEuY29uc3RydWN0b3IpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBiZWZvcmVSb2xlUmVtb3ZlIDogZnVuY3Rpb24gKHJvbGUpIHtcbiAgICAgICAgdmFyIHJvbGVNZXRhID0gcm9sZS5tZXRhXG4gICAgICAgIFxuICAgICAgICBpZiAocm9sZU1ldGEuYnVpbGRlckNsYXNzQ3JlYXRlZCkgdGhpcy5nZXRCdWlsZGVyVGFyZ2V0KCkubWV0YS5leHRlbmQoe1xuICAgICAgICAgICAgZG9lc250IDogWyByb2xlTWV0YS5nZXRCdWlsZGVyVGFyZ2V0KCkgXVxuICAgICAgICB9KVxuICAgICAgICBcbiAgICAgICAgaWYgKHJvbGVNZXRhLnN0ZW1DbGFzc0NyZWF0ZWQpIHRoaXMuZ2V0U3RlbVRhcmdldCgpLm1ldGEuZXh0ZW5kKHtcbiAgICAgICAgICAgIGRvZXNudCA6IFsgcm9sZU1ldGEuZ2V0U3RlbVRhcmdldCgpIF1cbiAgICAgICAgfSlcbiAgICAgICAgXG4gICAgICAgIGlmIChyb2xlTWV0YS5tZXRhLmlzRGV0YWNoZWQgJiYgIXRoaXMuZmlyc3RQYXNzKSB0aGlzLmJ1aWxkZXIucmVtb3ZlVHJhaXRzKHRoaXMsIHJvbGVNZXRhLmNvbnN0cnVjdG9yKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgcmVtb3ZlUm9sZSA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgdGhpcy5lYWNoUm9sZShhcmd1bWVudHMsIGZ1bmN0aW9uIChhcmcsIHJvbGUpIHtcbiAgICAgICAgICAgIHRoaXMuYmVmb3JlUm9sZVJlbW92ZShyb2xlKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLnN0ZW0ucmVtb3ZlQ29tcG9zZUluZm8ocm9sZS5tZXRhLnN0ZW0pXG4gICAgICAgIH0sIHRoaXMpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBnZXRSb2xlcyA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgXG4gICAgICAgIHJldHVybiBKb29zZS5BLm1hcCh0aGlzLnN0ZW0uY29tcG9zZWRGcm9tLCBmdW5jdGlvbiAoY29tcG9zZURlc2MpIHtcbiAgICAgICAgICAgIC8vY29tcG9zZSBkZXNjcmlwdG9yIGNhbiBjb250YWluICdhbGlhcycgYW5kICdleGNsdWRlJyBmaWVsZHMsIGluIHRoaXMgY2FzZSBhY3R1YWwgcmVmZXJlbmNlIGlzIHN0b3JlZFxuICAgICAgICAgICAgLy9pbnRvICdwcm9wZXJ0eVNldCcgZmllbGRcbiAgICAgICAgICAgIGlmICghKGNvbXBvc2VEZXNjIGluc3RhbmNlb2YgSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eVNldCkpIHJldHVybiBjb21wb3NlRGVzYy5wcm9wZXJ0eVNldFxuICAgICAgICAgICAgXG4gICAgICAgICAgICByZXR1cm4gY29tcG9zZURlc2MudGFyZ2V0TWV0YS5jXG4gICAgICAgIH0pXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBkb2VzIDogZnVuY3Rpb24gKHJvbGUpIHtcbiAgICAgICAgdmFyIG15Um9sZXMgPSB0aGlzLmdldFJvbGVzKClcbiAgICAgICAgXG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgbXlSb2xlcy5sZW5ndGg7IGkrKykgaWYgKHJvbGUgPT0gbXlSb2xlc1tpXSkgcmV0dXJuIHRydWVcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBteVJvbGVzLmxlbmd0aDsgaSsrKSBpZiAobXlSb2xlc1tpXS5tZXRhLmRvZXMocm9sZSkpIHJldHVybiB0cnVlXG4gICAgICAgIFxuICAgICAgICB2YXIgc3VwZXJNZXRhID0gdGhpcy5zdXBlckNsYXNzLm1ldGFcbiAgICAgICAgXG4gICAgICAgIC8vIGNvbnNpZGVyaW5nIHRoZSBjYXNlIG9mIGluaGVyaXRpbmcgZnJvbSBub24tSm9vc2UgY2xhc3Nlc1xuICAgICAgICBpZiAodGhpcy5zdXBlckNsYXNzICE9IEpvb3NlLlByb3RvLkVtcHR5ICYmIHN1cGVyTWV0YSAmJiBzdXBlck1ldGEubWV0YSAmJiBzdXBlck1ldGEubWV0YS5oYXNNZXRob2QoJ2RvZXMnKSkgcmV0dXJuIHN1cGVyTWV0YS5kb2VzKHJvbGUpXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gZmFsc2VcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGdldE1ldGhvZHMgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHJldHVybiB0aGlzLnN0ZW0ucHJvcGVydGllcy5tZXRob2RzXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBnZXRBdHRyaWJ1dGVzIDogZnVuY3Rpb24gKCkge1xuICAgICAgICByZXR1cm4gdGhpcy5zdGVtLnByb3BlcnRpZXMuYXR0cmlidXRlc1xuICAgIH0sXG4gICAgXG4gICAgXG4gICAgYWZ0ZXJNdXRhdGUgOiBmdW5jdGlvbiAoKSB7XG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBnZXRDdXJyZW50TWV0aG9kIDogZnVuY3Rpb24gKCkge1xuICAgICAgICBmb3IgKHZhciB3cmFwcGVyID0gYXJndW1lbnRzLmNhbGxlZS5jYWxsZXIsIGNvdW50ID0gMDsgd3JhcHBlciAmJiBjb3VudCA8IDU7IHdyYXBwZXIgPSB3cmFwcGVyLmNhbGxlciwgY291bnQrKylcbiAgICAgICAgICAgIGlmICh3cmFwcGVyLl9fTUVUSE9EX18pIHJldHVybiB3cmFwcGVyLl9fTUVUSE9EX19cbiAgICAgICAgXG4gICAgICAgIHJldHVybiBudWxsXG4gICAgfVxuICAgIFxuICAgIFxufSkuYztcbkpvb3NlLk1hbmFnZWQuUm9sZSA9IG5ldyBKb29zZS5NYW5hZ2VkLkNsYXNzKCdKb29zZS5NYW5hZ2VkLlJvbGUnLCB7XG4gICAgXG4gICAgaXNhICAgICAgICAgICAgICAgICAgICAgICAgIDogSm9vc2UuTWFuYWdlZC5DbGFzcyxcbiAgICBcbiAgICBoYXZlIDoge1xuICAgICAgICBkZWZhdWx0U3VwZXJDbGFzcyAgICAgICA6IEpvb3NlLlByb3RvLkVtcHR5LFxuICAgICAgICBcbiAgICAgICAgYnVpbGRlclJvbGUgICAgICAgICAgICAgOiBudWxsLFxuICAgICAgICBzdGVtUm9sZSAgICAgICAgICAgICAgICA6IG51bGxcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIG1ldGhvZHMgOiB7XG4gICAgICAgIFxuICAgICAgICBkZWZhdWx0Q29uc3RydWN0b3IgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICByZXR1cm4gZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcIlJvbGVzIGNhbnQgYmUgaW5zdGFudGlhdGVkXCIpXG4gICAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIFxuXG4gICAgICAgIHByb2Nlc3NTdXBlckNsYXNzIDogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgaWYgKHRoaXMuc3VwZXJDbGFzcyAhPSB0aGlzLmRlZmF1bHRTdXBlckNsYXNzKSB0aHJvdyBuZXcgRXJyb3IoXCJSb2xlcyBjYW4ndCBpbmhlcml0IGZyb20gYW55dGhpbmdcIilcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBnZXRCdWlsZGVyVGFyZ2V0IDogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgaWYgKCF0aGlzLmJ1aWxkZXJSb2xlKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5idWlsZGVyUm9sZSA9IG5ldyB0aGlzLmNvbnN0cnVjdG9yKCkuY1xuICAgICAgICAgICAgICAgIHRoaXMuYnVpbGRlckNsYXNzQ3JlYXRlZCA9IHRydWVcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcmV0dXJuIHRoaXMuYnVpbGRlclJvbGVcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgXG4gICAgICAgIGdldFN0ZW1UYXJnZXQgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBpZiAoIXRoaXMuc3RlbVJvbGUpIHtcbiAgICAgICAgICAgICAgICB0aGlzLnN0ZW1Sb2xlID0gbmV3IHRoaXMuY29uc3RydWN0b3IoKS5jXG4gICAgICAgICAgICAgICAgdGhpcy5zdGVtQ2xhc3NDcmVhdGVkID0gdHJ1ZVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5zdGVtUm9sZVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICBcbiAgICAgICAgYWRkUmVxdWlyZW1lbnQgOiBmdW5jdGlvbiAobWV0aG9kTmFtZSkge1xuICAgICAgICAgICAgdGhpcy5zdGVtLnByb3BlcnRpZXMucmVxdWlyZW1lbnRzLmFkZFByb3BlcnR5KG1ldGhvZE5hbWUsIHt9KVxuICAgICAgICB9XG4gICAgICAgIFxuICAgIH0sXG4gICAgXG5cbiAgICBzdGVtIDoge1xuICAgICAgICBtZXRob2RzIDoge1xuICAgICAgICAgICAgXG4gICAgICAgICAgICBhcHBseSA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdW5hcHBseSA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgYnVpbGRlciA6IHtcbiAgICAgICAgbWV0aG9kcyA6IHtcbiAgICAgICAgICAgIHJlcXVpcmVzIDogZnVuY3Rpb24gKHRhcmdldENsYXNzTWV0YSwgaW5mbykge1xuICAgICAgICAgICAgICAgIEpvb3NlLkEuZWFjaChKb29zZS5PLndhbnRBcnJheShpbmZvKSwgZnVuY3Rpb24gKG1ldGhvZE5hbWUpIHtcbiAgICAgICAgICAgICAgICAgICAgdGFyZ2V0Q2xhc3NNZXRhLmFkZFJlcXVpcmVtZW50KG1ldGhvZE5hbWUpXG4gICAgICAgICAgICAgICAgfSwgdGhpcylcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cbiAgICBcbn0pLmM7XG5Kb29zZS5NYW5hZ2VkLkF0dHJpYnV0ZSA9IG5ldyBKb29zZS5NYW5hZ2VkLkNsYXNzKCdKb29zZS5NYW5hZ2VkLkF0dHJpYnV0ZScsIHtcbiAgICBcbiAgICBpc2EgOiBKb29zZS5NYW5hZ2VkLlByb3BlcnR5LkF0dHJpYnV0ZSxcbiAgICBcbiAgICBoYXZlIDoge1xuICAgICAgICBpcyAgICAgICAgICAgICAgOiBudWxsLFxuICAgICAgICBcbiAgICAgICAgYnVpbGRlciAgICAgICAgIDogbnVsbCxcbiAgICAgICAgXG4gICAgICAgIGlzUHJpdmF0ZSAgICAgICA6IGZhbHNlLFxuICAgICAgICBcbiAgICAgICAgcm9sZSAgICAgICAgICAgIDogbnVsbCxcbiAgICAgICAgXG4gICAgICAgIHB1YmxpY05hbWUgICAgICA6IG51bGwsXG4gICAgICAgIHNldHRlck5hbWUgICAgICA6IG51bGwsXG4gICAgICAgIGdldHRlck5hbWUgICAgICA6IG51bGwsXG4gICAgICAgIFxuICAgICAgICAvL2luZGljYXRlcyB0aGUgbG9naWNhbCByZWFkYWJsZW5lc3Mvd3JpdGVhYmxlbmVzcyBvZiB0aGUgYXR0cmlidXRlXG4gICAgICAgIHJlYWRhYmxlICAgICAgICA6IGZhbHNlLFxuICAgICAgICB3cml0ZWFibGUgICAgICAgOiBmYWxzZSxcbiAgICAgICAgXG4gICAgICAgIC8vaW5kaWNhdGVzIHRoZSBwaHlzaWNhbCBwcmVzZW5zZSBvZiB0aGUgYWNjZXNzb3IgKG1heSBiZSBhYnNlbnQgZm9yIFwiY29tYmluZWRcIiBhY2Nlc3NvcnMgZm9yIGV4YW1wbGUpXG4gICAgICAgIGhhc0dldHRlciAgICAgICA6IGZhbHNlLFxuICAgICAgICBoYXNTZXR0ZXIgICAgICAgOiBmYWxzZSxcbiAgICAgICAgXG4gICAgICAgIHJlcXVpcmVkICAgICAgICA6IGZhbHNlLFxuICAgICAgICBcbiAgICAgICAgY2FuSW5saW5lU2V0UmF3IDogdHJ1ZSxcbiAgICAgICAgY2FuSW5saW5lR2V0UmF3IDogdHJ1ZVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgYWZ0ZXIgOiB7XG4gICAgICAgIGluaXRpYWxpemUgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB2YXIgbmFtZSA9IHRoaXMubmFtZVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLnB1YmxpY05hbWUgPSBuYW1lLnJlcGxhY2UoL15fKy8sICcnKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLnNsb3QgPSB0aGlzLmlzUHJpdmF0ZSA/ICckJCcgKyBuYW1lIDogbmFtZVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLnNldHRlck5hbWUgPSB0aGlzLnNldHRlck5hbWUgfHwgdGhpcy5nZXRTZXR0ZXJOYW1lKClcbiAgICAgICAgICAgIHRoaXMuZ2V0dGVyTmFtZSA9IHRoaXMuZ2V0dGVyTmFtZSB8fCB0aGlzLmdldEdldHRlck5hbWUoKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLnJlYWRhYmxlICA9IHRoaXMuaGFzR2V0dGVyID0gL15yL2kudGVzdCh0aGlzLmlzKVxuICAgICAgICAgICAgdGhpcy53cml0ZWFibGUgPSB0aGlzLmhhc1NldHRlciA9IC9eLncvaS50ZXN0KHRoaXMuaXMpXG4gICAgICAgIH1cbiAgICB9LFxuICAgIFxuICAgIFxuICAgIG92ZXJyaWRlIDoge1xuICAgICAgICBcbiAgICAgICAgY29tcHV0ZVZhbHVlIDogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgdmFyIGluaXQgICAgPSB0aGlzLmluaXRcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKEpvb3NlLk8uaXNDbGFzcyhpbml0KSB8fCAhSm9vc2UuTy5pc0Z1bmN0aW9uKGluaXQpKSB0aGlzLlNVUEVSKClcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBwcmVBcHBseSA6IGZ1bmN0aW9uICh0YXJnZXRDbGFzcykge1xuICAgICAgICAgICAgdGFyZ2V0Q2xhc3MubWV0YS5leHRlbmQoe1xuICAgICAgICAgICAgICAgIG1ldGhvZHMgOiB0aGlzLmdldEFjY2Vzc29yc0Zvcih0YXJnZXRDbGFzcylcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgcG9zdFVuQXBwbHkgOiBmdW5jdGlvbiAoZnJvbSkge1xuICAgICAgICAgICAgZnJvbS5tZXRhLmV4dGVuZCh7XG4gICAgICAgICAgICAgICAgcmVtb3ZlTWV0aG9kcyA6IHRoaXMuZ2V0QWNjZXNzb3JzRnJvbShmcm9tKVxuICAgICAgICAgICAgfSlcbiAgICAgICAgfVxuICAgICAgICBcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIG1ldGhvZHMgOiB7XG4gICAgICAgIFxuICAgICAgICBnZXRBY2Nlc3NvcnNGb3IgOiBmdW5jdGlvbiAodGFyZ2V0Q2xhc3MpIHtcbiAgICAgICAgICAgIHZhciB0YXJnZXRNZXRhID0gdGFyZ2V0Q2xhc3MubWV0YVxuICAgICAgICAgICAgdmFyIHNldHRlck5hbWUgPSB0aGlzLnNldHRlck5hbWVcbiAgICAgICAgICAgIHZhciBnZXR0ZXJOYW1lID0gdGhpcy5nZXR0ZXJOYW1lXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciBtZXRob2RzID0ge31cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKHRoaXMuaGFzU2V0dGVyICYmICF0YXJnZXRNZXRhLmhhc01ldGhvZChzZXR0ZXJOYW1lKSkge1xuICAgICAgICAgICAgICAgIG1ldGhvZHNbc2V0dGVyTmFtZV0gPSB0aGlzLmdldFNldHRlcigpXG4gICAgICAgICAgICAgICAgbWV0aG9kc1tzZXR0ZXJOYW1lXS5BQ0NFU1NPUl9GUk9NID0gdGhpc1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAodGhpcy5oYXNHZXR0ZXIgJiYgIXRhcmdldE1ldGEuaGFzTWV0aG9kKGdldHRlck5hbWUpKSB7XG4gICAgICAgICAgICAgICAgbWV0aG9kc1tnZXR0ZXJOYW1lXSA9IHRoaXMuZ2V0R2V0dGVyKClcbiAgICAgICAgICAgICAgICBtZXRob2RzW2dldHRlck5hbWVdLkFDQ0VTU09SX0ZST00gPSB0aGlzXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHJldHVybiBtZXRob2RzXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgZ2V0QWNjZXNzb3JzRnJvbSA6IGZ1bmN0aW9uIChmcm9tKSB7XG4gICAgICAgICAgICB2YXIgdGFyZ2V0TWV0YSA9IGZyb20ubWV0YVxuICAgICAgICAgICAgdmFyIHNldHRlck5hbWUgPSB0aGlzLnNldHRlck5hbWVcbiAgICAgICAgICAgIHZhciBnZXR0ZXJOYW1lID0gdGhpcy5nZXR0ZXJOYW1lXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciBzZXR0ZXIgPSB0aGlzLmhhc1NldHRlciAmJiB0YXJnZXRNZXRhLmdldE1ldGhvZChzZXR0ZXJOYW1lKVxuICAgICAgICAgICAgdmFyIGdldHRlciA9IHRoaXMuaGFzR2V0dGVyICYmIHRhcmdldE1ldGEuZ2V0TWV0aG9kKGdldHRlck5hbWUpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciByZW1vdmVNZXRob2RzID0gW11cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKHNldHRlciAmJiBzZXR0ZXIudmFsdWUuQUNDRVNTT1JfRlJPTSA9PSB0aGlzKSByZW1vdmVNZXRob2RzLnB1c2goc2V0dGVyTmFtZSlcbiAgICAgICAgICAgIGlmIChnZXR0ZXIgJiYgZ2V0dGVyLnZhbHVlLkFDQ0VTU09SX0ZST00gPT0gdGhpcykgcmVtb3ZlTWV0aG9kcy5wdXNoKGdldHRlck5hbWUpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHJldHVybiByZW1vdmVNZXRob2RzXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgZ2V0R2V0dGVyTmFtZSA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHJldHVybiAnZ2V0JyArIEpvb3NlLlMudXBwZXJjYXNlRmlyc3QodGhpcy5wdWJsaWNOYW1lKVxuICAgICAgICB9LFxuXG5cbiAgICAgICAgZ2V0U2V0dGVyTmFtZSA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHJldHVybiAnc2V0JyArIEpvb3NlLlMudXBwZXJjYXNlRmlyc3QodGhpcy5wdWJsaWNOYW1lKVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIGdldFNldHRlciA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHZhciBtZSAgICAgID0gdGhpc1xuICAgICAgICAgICAgdmFyIHNsb3QgICAgPSBtZS5zbG90XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmIChtZS5jYW5JbmxpbmVTZXRSYXcpXG4gICAgICAgICAgICAgICAgcmV0dXJuIGZ1bmN0aW9uICh2YWx1ZSkge1xuICAgICAgICAgICAgICAgICAgICB0aGlzWyBzbG90IF0gPSB2YWx1ZVxuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRoaXNcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICBlbHNlXG4gICAgICAgICAgICAgICAgcmV0dXJuIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIG1lLnNldFJhd1ZhbHVlVG8uYXBwbHkodGhpcywgYXJndW1lbnRzKVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBnZXRHZXR0ZXIgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB2YXIgbWUgICAgICA9IHRoaXNcbiAgICAgICAgICAgIHZhciBzbG90ICAgID0gbWUuc2xvdFxuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAobWUuY2FuSW5saW5lR2V0UmF3KVxuICAgICAgICAgICAgICAgIHJldHVybiBmdW5jdGlvbiAodmFsdWUpIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRoaXNbIHNsb3QgXVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGVsc2VcbiAgICAgICAgICAgICAgICByZXR1cm4gZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gbWUuZ2V0UmF3VmFsdWVGcm9tLmFwcGx5KHRoaXMsIGFyZ3VtZW50cylcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgZ2V0VmFsdWVGcm9tIDogZnVuY3Rpb24gKGluc3RhbmNlKSB7XG4gICAgICAgICAgICB2YXIgZ2V0dGVyTmFtZSAgICAgID0gdGhpcy5nZXR0ZXJOYW1lXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmICh0aGlzLnJlYWRhYmxlICYmIGluc3RhbmNlLm1ldGEuaGFzTWV0aG9kKGdldHRlck5hbWUpKSByZXR1cm4gaW5zdGFuY2VbIGdldHRlck5hbWUgXSgpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHJldHVybiB0aGlzLmdldFJhd1ZhbHVlRnJvbShpbnN0YW5jZSlcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBzZXRWYWx1ZVRvIDogZnVuY3Rpb24gKGluc3RhbmNlLCB2YWx1ZSkge1xuICAgICAgICAgICAgdmFyIHNldHRlck5hbWUgICAgICA9IHRoaXMuc2V0dGVyTmFtZVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAodGhpcy53cml0ZWFibGUgJiYgaW5zdGFuY2UubWV0YS5oYXNNZXRob2Qoc2V0dGVyTmFtZSkpIFxuICAgICAgICAgICAgICAgIGluc3RhbmNlWyBzZXR0ZXJOYW1lIF0odmFsdWUpXG4gICAgICAgICAgICBlbHNlXG4gICAgICAgICAgICAgICAgdGhpcy5zZXRSYXdWYWx1ZVRvKGluc3RhbmNlLCB2YWx1ZSlcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBpbml0RnJvbUNvbmZpZyA6IGZ1bmN0aW9uIChpbnN0YW5jZSwgY29uZmlnKSB7XG4gICAgICAgICAgICB2YXIgbmFtZSAgICAgICAgICAgID0gdGhpcy5uYW1lXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciB2YWx1ZSwgaXNTZXQgPSBmYWxzZVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAoY29uZmlnLmhhc093blByb3BlcnR5KG5hbWUpKSB7XG4gICAgICAgICAgICAgICAgdmFsdWUgPSBjb25maWdbbmFtZV1cbiAgICAgICAgICAgICAgICBpc1NldCA9IHRydWVcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgdmFyIGluaXQgICAgPSB0aGlzLmluaXRcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAvLyBzaW1wbGUgZnVuY3Rpb24gKG5vdCBjbGFzcykgaGFzIGJlZW4gdXNlZCBhcyBcImluaXRcIiB2YWx1ZVxuICAgICAgICAgICAgICAgIGlmIChKb29zZS5PLmlzRnVuY3Rpb24oaW5pdCkgJiYgIUpvb3NlLk8uaXNDbGFzcyhpbml0KSkge1xuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgdmFsdWUgPSBpbml0LmNhbGwoaW5zdGFuY2UsIGNvbmZpZywgbmFtZSlcbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIGlzU2V0ID0gdHJ1ZVxuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKHRoaXMuYnVpbGRlcikge1xuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgdmFsdWUgPSBpbnN0YW5jZVsgdGhpcy5idWlsZGVyLnJlcGxhY2UoL150aGlzXFwuLywgJycpIF0oY29uZmlnLCBuYW1lKVxuICAgICAgICAgICAgICAgICAgICBpc1NldCA9IHRydWVcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmIChpc1NldClcbiAgICAgICAgICAgICAgICB0aGlzLnNldFJhd1ZhbHVlVG8oaW5zdGFuY2UsIHZhbHVlKVxuICAgICAgICAgICAgZWxzZSBcbiAgICAgICAgICAgICAgICBpZiAodGhpcy5yZXF1aXJlZCkgdGhyb3cgbmV3IEVycm9yKFwiUmVxdWlyZWQgYXR0cmlidXRlIFtcIiArIG5hbWUgKyBcIl0gaXMgbWlzc2VkIGR1cmluZyBpbml0aWFsaXphdGlvbiBvZiBcIiArIGluc3RhbmNlKVxuICAgICAgICB9XG4gICAgfVxuXG59KS5jXG47XG5Kb29zZS5NYW5hZ2VkLkF0dHJpYnV0ZS5CdWlsZGVyID0gbmV3IEpvb3NlLk1hbmFnZWQuUm9sZSgnSm9vc2UuTWFuYWdlZC5BdHRyaWJ1dGUuQnVpbGRlcicsIHtcbiAgICBcbiAgICBcbiAgICBoYXZlIDoge1xuICAgICAgICBkZWZhdWx0QXR0cmlidXRlQ2xhc3MgOiBKb29zZS5NYW5hZ2VkLkF0dHJpYnV0ZVxuICAgIH0sXG4gICAgXG4gICAgYnVpbGRlciA6IHtcbiAgICAgICAgXG4gICAgICAgIG1ldGhvZHMgOiB7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGhhcyA6IGZ1bmN0aW9uICh0YXJnZXRDbGFzc01ldGEsIGluZm8pIHtcbiAgICAgICAgICAgICAgICBKb29zZS5PLmVhY2hPd24oaW5mbywgZnVuY3Rpb24gKHByb3BzLCBuYW1lKSB7XG4gICAgICAgICAgICAgICAgICAgIGlmICh0eXBlb2YgcHJvcHMgIT0gJ29iamVjdCcgfHwgcHJvcHMgPT0gbnVsbCB8fCBwcm9wcy5jb25zdHJ1Y3RvciA9PSAvIC8uY29uc3RydWN0b3IpIHByb3BzID0geyBpbml0IDogcHJvcHMgfVxuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgcHJvcHMubWV0YSA9IHByb3BzLm1ldGEgfHwgdGFyZ2V0Q2xhc3NNZXRhLmRlZmF1bHRBdHRyaWJ1dGVDbGFzc1xuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgaWYgKC9eX18vLnRlc3QobmFtZSkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIG5hbWUgPSBuYW1lLnJlcGxhY2UoL15fKy8sICcnKVxuICAgICAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgICAgICBwcm9wcy5pc1ByaXZhdGUgPSB0cnVlXG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIHRhcmdldENsYXNzTWV0YS5hZGRBdHRyaWJ1dGUobmFtZSwgcHJvcHMuaW5pdCwgcHJvcHMpXG4gICAgICAgICAgICAgICAgfSwgdGhpcylcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaGFzbm90IDogZnVuY3Rpb24gKHRhcmdldENsYXNzTWV0YSwgaW5mbykge1xuICAgICAgICAgICAgICAgIHRoaXMuaGF2ZW5vdCh0YXJnZXRDbGFzc01ldGEsIGluZm8pXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGhhc250IDogZnVuY3Rpb24gKHRhcmdldENsYXNzTWV0YSwgaW5mbykge1xuICAgICAgICAgICAgICAgIHRoaXMuaGFzbm90KHRhcmdldENsYXNzTWV0YSwgaW5mbylcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICAgICAgXG4gICAgfVxuICAgIFxufSkuY1xuO1xuSm9vc2UuTWFuYWdlZC5NeSA9IG5ldyBKb29zZS5NYW5hZ2VkLlJvbGUoJ0pvb3NlLk1hbmFnZWQuTXknLCB7XG4gICAgXG4gICAgaGF2ZSA6IHtcbiAgICAgICAgbXlDbGFzcyAgICAgICAgICAgICAgICAgICAgICAgICA6IG51bGwsXG4gICAgICAgIFxuICAgICAgICBuZWVkVG9SZUFsaWFzICAgICAgICAgICAgICAgICAgIDogZmFsc2VcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIG1ldGhvZHMgOiB7XG4gICAgICAgIGNyZWF0ZU15IDogZnVuY3Rpb24gKGV4dGVuZCkge1xuICAgICAgICAgICAgdmFyIHRoaXNNZXRhID0gdGhpcy5tZXRhXG4gICAgICAgICAgICB2YXIgaXNSb2xlID0gdGhpcyBpbnN0YW5jZW9mIEpvb3NlLk1hbmFnZWQuUm9sZVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB2YXIgbXlFeHRlbmQgPSBleHRlbmQubXkgfHwge31cbiAgICAgICAgICAgIGRlbGV0ZSBleHRlbmQubXlcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gU3ltYmlvbnQgd2lsbCBnZW5lcmFsbHkgaGF2ZSB0aGUgc2FtZSBtZXRhIGNsYXNzIGFzIGl0cyBob3N0ZXIsIGV4Y2VwdGluZyB0aGUgY2FzZXMsIHdoZW4gdGhlIHN1cGVyY2xhc3MgYWxzbyBoYXZlIHRoZSBzeW1iaW9udC4gXG4gICAgICAgICAgICAvLyBJbiBzdWNoIGNhc2VzLCB0aGUgbWV0YSBjbGFzcyBmb3Igc3ltYmlvbnQgd2lsbCBiZSBpbmhlcml0ZWQgKHVubGVzcyBleHBsaWNpdGx5IHNwZWNpZmllZClcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdmFyIHN1cGVyQ2xhc3NNeSAgICA9IHRoaXMuc3VwZXJDbGFzcy5tZXRhLm15Q2xhc3NcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKCFpc1JvbGUgJiYgIW15RXh0ZW5kLmlzYSAmJiBzdXBlckNsYXNzTXkpIG15RXh0ZW5kLmlzYSA9IHN1cGVyQ2xhc3NNeVxuICAgICAgICAgICAgXG5cbiAgICAgICAgICAgIGlmICghbXlFeHRlbmQubWV0YSAmJiAhbXlFeHRlbmQuaXNhKSBteUV4dGVuZC5tZXRhID0gdGhpcy5jb25zdHJ1Y3RvclxuICAgICAgICAgICAgXG4gICAgICAgICAgICB2YXIgY3JlYXRlZENsYXNzICAgID0gdGhpcy5teUNsYXNzID0gQ2xhc3MobXlFeHRlbmQpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciBjICAgICAgICAgICAgICAgPSB0aGlzLmNcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgYy5wcm90b3R5cGUubXkgICAgICA9IGMubXkgPSBpc1JvbGUgPyBjcmVhdGVkQ2xhc3MgOiBuZXcgY3JlYXRlZENsYXNzKHsgSE9TVCA6IGMgfSlcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpcy5uZWVkVG9SZUFsaWFzID0gdHJ1ZVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIGFsaWFzU3RhdGljTWV0aG9kcyA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHRoaXMubmVlZFRvUmVBbGlhcyA9IGZhbHNlXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciBjICAgICAgICAgICA9IHRoaXMuY1xuICAgICAgICAgICAgdmFyIG15UHJvdG8gICAgID0gdGhpcy5teUNsYXNzLnByb3RvdHlwZVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBKb29zZS5PLmVhY2hPd24oYywgZnVuY3Rpb24gKHByb3BlcnR5LCBuYW1lKSB7XG4gICAgICAgICAgICAgICAgaWYgKHByb3BlcnR5LklTX0FMSUFTKSBkZWxldGUgY1sgbmFtZSBdIFxuICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpcy5teUNsYXNzLm1ldGEuc3RlbS5wcm9wZXJ0aWVzLm1ldGhvZHMuZWFjaChmdW5jdGlvbiAobWV0aG9kLCBuYW1lKSB7XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgaWYgKCFjWyBuYW1lIF0pXG4gICAgICAgICAgICAgICAgICAgIChjWyBuYW1lIF0gPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gbXlQcm90b1sgbmFtZSBdLmFwcGx5KGMubXksIGFyZ3VtZW50cylcbiAgICAgICAgICAgICAgICAgICAgfSkuSVNfQUxJQVMgPSB0cnVlXG4gICAgICAgICAgICB9KVxuICAgICAgICB9XG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBvdmVycmlkZSA6IHtcbiAgICAgICAgXG4gICAgICAgIGV4dGVuZCA6IGZ1bmN0aW9uIChwcm9wcykge1xuICAgICAgICAgICAgdmFyIG15Q2xhc3MgPSB0aGlzLm15Q2xhc3NcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKCFteUNsYXNzICYmIHRoaXMuc3VwZXJDbGFzcy5tZXRhLm15Q2xhc3MpIHRoaXMuY3JlYXRlTXkocHJvcHMpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmIChwcm9wcy5teSkge1xuICAgICAgICAgICAgICAgIGlmICghbXlDbGFzcykgXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuY3JlYXRlTXkocHJvcHMpXG4gICAgICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMubmVlZFRvUmVBbGlhcyA9IHRydWVcbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIG15Q2xhc3MubWV0YS5leHRlbmQocHJvcHMubXkpXG4gICAgICAgICAgICAgICAgICAgIGRlbGV0ZSBwcm9wcy5teVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpcy5TVVBFUihwcm9wcylcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKHRoaXMubmVlZFRvUmVBbGlhcyAmJiAhKHRoaXMgaW5zdGFuY2VvZiBKb29zZS5NYW5hZ2VkLlJvbGUpKSB0aGlzLmFsaWFzU3RhdGljTWV0aG9kcygpXG4gICAgICAgIH0gIFxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgYmVmb3JlIDoge1xuICAgICAgICBcbiAgICAgICAgYWRkUm9sZSA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHZhciBteVN0ZW1cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgSm9vc2UuQS5lYWNoKGFyZ3VtZW50cywgZnVuY3Rpb24gKGFyZykge1xuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIGlmICghYXJnKSB0aHJvdyBuZXcgRXJyb3IoXCJBdHRlbXB0IHRvIGNvbnN1bWUgYW4gdW5kZWZpbmVkIFJvbGUgaW50byBbXCIgKyB0aGlzLm5hbWUgKyBcIl1cIilcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAvL2luc3RhbmNlb2YgQ2xhc3MgdG8gYWxsb3cgdHJlYXQgY2xhc3NlcyBhcyByb2xlc1xuICAgICAgICAgICAgICAgIHZhciByb2xlID0gKGFyZy5tZXRhIGluc3RhbmNlb2YgSm9vc2UuTWFuYWdlZC5DbGFzcykgPyBhcmcgOiBhcmcucm9sZVxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIGlmIChyb2xlLm1ldGEubWV0YS5oYXNBdHRyaWJ1dGUoJ215Q2xhc3MnKSAmJiByb2xlLm1ldGEubXlDbGFzcykge1xuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgaWYgKCF0aGlzLm15Q2xhc3MpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuY3JlYXRlTXkoe1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG15IDoge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBkb2VzIDogcm9sZS5tZXRhLm15Q2xhc3NcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuXG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIG15U3RlbSA9IHRoaXMubXlDbGFzcy5tZXRhLnN0ZW1cbiAgICAgICAgICAgICAgICAgICAgaWYgKCFteVN0ZW0ub3BlbmVkKSBteVN0ZW0ub3BlbigpXG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICBteVN0ZW0uYWRkQ29tcG9zZUluZm8ocm9sZS5teS5tZXRhLnN0ZW0pXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSwgdGhpcylcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKG15U3RlbSkge1xuICAgICAgICAgICAgICAgIG15U3RlbS5jbG9zZSgpXG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgdGhpcy5uZWVkVG9SZUFsaWFzID0gdHJ1ZVxuICAgICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIHJlbW92ZVJvbGUgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBpZiAoIXRoaXMubXlDbGFzcykgcmV0dXJuXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciBteVN0ZW0gPSB0aGlzLm15Q2xhc3MubWV0YS5zdGVtXG4gICAgICAgICAgICBteVN0ZW0ub3BlbigpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIEpvb3NlLkEuZWFjaChhcmd1bWVudHMsIGZ1bmN0aW9uIChyb2xlKSB7XG4gICAgICAgICAgICAgICAgaWYgKHJvbGUubWV0YS5tZXRhLmhhc0F0dHJpYnV0ZSgnbXlDbGFzcycpICYmIHJvbGUubWV0YS5teUNsYXNzKSB7XG4gICAgICAgICAgICAgICAgICAgIG15U3RlbS5yZW1vdmVDb21wb3NlSW5mbyhyb2xlLm15Lm1ldGEuc3RlbSlcbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIHRoaXMubmVlZFRvUmVBbGlhcyA9IHRydWVcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9LCB0aGlzKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBteVN0ZW0uY2xvc2UoKVxuICAgICAgICB9XG4gICAgICAgIFxuICAgIH1cbiAgICBcbn0pLmM7XG5Kb29zZS5OYW1lc3BhY2UgPSBKb29zZS5zdHViKClcblxuSm9vc2UuTmFtZXNwYWNlLkFibGUgPSBuZXcgSm9vc2UuTWFuYWdlZC5Sb2xlKCdKb29zZS5OYW1lc3BhY2UuQWJsZScsIHtcblxuICAgIGhhdmUgOiB7XG4gICAgICAgIGJvZHlGdW5jICAgICAgICAgICAgICAgIDogbnVsbFxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgYmVmb3JlIDoge1xuICAgICAgICBleHRlbmQgOiBmdW5jdGlvbiAoZXh0ZW5kKSB7XG4gICAgICAgICAgICBpZiAoZXh0ZW5kLmJvZHkpIHtcbiAgICAgICAgICAgICAgICB0aGlzLmJvZHlGdW5jID0gZXh0ZW5kLmJvZHlcbiAgICAgICAgICAgICAgICBkZWxldGUgZXh0ZW5kLmJvZHlcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgYWZ0ZXI6IHtcbiAgICAgICAgXG4gICAgICAgIGFmdGVyTXV0YXRlIDogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgdmFyIGJvZHlGdW5jID0gdGhpcy5ib2R5RnVuY1xuICAgICAgICAgICAgZGVsZXRlIHRoaXMuYm9keUZ1bmNcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKGJvZHlGdW5jKSBKb29zZS5OYW1lc3BhY2UuTWFuYWdlci5teS5leGVjdXRlSW4odGhpcy5jLCBib2R5RnVuYylcbiAgICAgICAgfVxuICAgIH1cbiAgICBcbn0pLmM7XG5Kb29zZS5NYW5hZ2VkLkJvb3RzdHJhcCA9IG5ldyBKb29zZS5NYW5hZ2VkLlJvbGUoJ0pvb3NlLk1hbmFnZWQuQm9vdHN0cmFwJywge1xuICAgIFxuICAgIGRvZXMgICA6IFsgSm9vc2UuTmFtZXNwYWNlLkFibGUsIEpvb3NlLk1hbmFnZWQuTXksIEpvb3NlLk1hbmFnZWQuQXR0cmlidXRlLkJ1aWxkZXIgXVxuICAgIFxufSkuY1xuO1xuSm9vc2UuTWV0YSA9IEpvb3NlLnN0dWIoKVxuXG5cbkpvb3NlLk1ldGEuT2JqZWN0ID0gbmV3IEpvb3NlLlByb3RvLkNsYXNzKCdKb29zZS5NZXRhLk9iamVjdCcsIHtcbiAgICBcbiAgICBpc2EgICAgICAgICAgICAgOiBKb29zZS5Qcm90by5PYmplY3RcbiAgICBcbn0pLmNcblxuXG47XG5Kb29zZS5NZXRhLkNsYXNzID0gbmV3IEpvb3NlLk1hbmFnZWQuQ2xhc3MoJ0pvb3NlLk1ldGEuQ2xhc3MnLCB7XG4gICAgXG4gICAgaXNhICAgICAgICAgICAgICAgICAgICAgICAgIDogSm9vc2UuTWFuYWdlZC5DbGFzcyxcbiAgICBcbiAgICBkb2VzICAgICAgICAgICAgICAgICAgICAgICAgOiBKb29zZS5NYW5hZ2VkLkJvb3RzdHJhcCxcbiAgICBcbiAgICBoYXZlIDoge1xuICAgICAgICBkZWZhdWx0U3VwZXJDbGFzcyAgICAgICA6IEpvb3NlLk1ldGEuT2JqZWN0XG4gICAgfVxuICAgIFxufSkuY1xuXG47XG5Kb29zZS5NZXRhLlJvbGUgPSBuZXcgSm9vc2UuTWV0YS5DbGFzcygnSm9vc2UuTWV0YS5Sb2xlJywge1xuICAgIFxuICAgIGlzYSAgICAgICAgICAgICAgICAgICAgICAgICA6IEpvb3NlLk1hbmFnZWQuUm9sZSxcbiAgICBcbiAgICBkb2VzICAgICAgICAgICAgICAgICAgICAgICAgOiBKb29zZS5NYW5hZ2VkLkJvb3RzdHJhcFxuICAgIFxufSkuYztcbkpvb3NlLk5hbWVzcGFjZS5LZWVwZXIgPSBuZXcgSm9vc2UuTWV0YS5DbGFzcygnSm9vc2UuTmFtZXNwYWNlLktlZXBlcicsIHtcbiAgICBcbiAgICBpc2EgICAgICAgICA6IEpvb3NlLk1ldGEuQ2xhc3MsXG4gICAgXG4gICAgaGF2ZSAgICAgICAgOiB7XG4gICAgICAgIGV4dGVybmFsQ29uc3RydWN0b3IgICAgICAgICAgICAgOiBudWxsXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBtZXRob2RzOiB7XG4gICAgICAgIFxuICAgICAgICBkZWZhdWx0Q29uc3RydWN0b3I6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcmV0dXJuIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgICAvL2NvbnN0cnVjdG9ycyBzaG91bGQgYXNzdW1lIHRoYXQgbWV0YSBpcyBhdHRhY2hlZCB0byAnYXJndW1lbnRzLmNhbGxlZScgKG5vdCB0byAndGhpcycpIFxuICAgICAgICAgICAgICAgIHZhciB0aGlzTWV0YSA9IGFyZ3VtZW50cy5jYWxsZWUubWV0YVxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIGlmICh0aGlzTWV0YSBpbnN0YW5jZW9mIEpvb3NlLk5hbWVzcGFjZS5LZWVwZXIpIHRocm93IG5ldyBFcnJvcihcIk1vZHVsZSBbXCIgKyB0aGlzTWV0YS5jICsgXCJdIG1heSBub3QgYmUgaW5zdGFudGlhdGVkLiBGb3Jnb3QgdG8gJ3VzZScgdGhlIGNsYXNzIHdpdGggdGhlIHNhbWUgbmFtZT9cIilcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICB2YXIgZXh0ZXJuYWxDb25zdHJ1Y3RvciA9IHRoaXNNZXRhLmV4dGVybmFsQ29uc3RydWN0b3JcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBpZiAodHlwZW9mIGV4dGVybmFsQ29uc3RydWN0b3IgPT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgZXh0ZXJuYWxDb25zdHJ1Y3Rvci5tZXRhID0gdGhpc01ldGFcbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBleHRlcm5hbENvbnN0cnVjdG9yLmFwcGx5KHRoaXMsIGFyZ3VtZW50cylcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgdGhyb3cgXCJOYW1lc3BhY2VLZWVwZXIgb2YgW1wiICsgdGhpc01ldGEubmFtZSArIFwiXSB3YXMgcGxhbnRlZCBpbmNvcnJlY3RseS5cIlxuICAgICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIC8vd2l0aENsYXNzIHNob3VsZCBiZSBub3QgY29uc3RydWN0ZWQgeWV0IG9uIHRoaXMgc3RhZ2UgKHNlZSBKb29zZS5Qcm90by5DbGFzcy5jb25zdHJ1Y3QpXG4gICAgICAgIC8vaXQgc2hvdWxkIGJlIG9uIHRoZSAnY29uc3RydWN0b3JPbmx5JyBsaWZlIHN0YWdlIChzaG91bGQgYWxyZWFkeSBoYXZlIGNvbnN0cnVjdG9yKVxuICAgICAgICBwbGFudDogZnVuY3Rpb24gKHdpdGhDbGFzcykge1xuICAgICAgICAgICAgdmFyIGtlZXBlciA9IHRoaXMuY1xuICAgICAgICAgICAgXG4gICAgICAgICAgICBrZWVwZXIubWV0YSA9IHdpdGhDbGFzcy5tZXRhXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGtlZXBlci5tZXRhLmMgPSBrZWVwZXJcbiAgICAgICAgICAgIGtlZXBlci5tZXRhLmV4dGVybmFsQ29uc3RydWN0b3IgPSB3aXRoQ2xhc3NcbiAgICAgICAgfVxuICAgIH1cbiAgICBcbn0pLmNcblxuXG47XG5Kb29zZS5OYW1lc3BhY2UuTWFuYWdlciA9IG5ldyBKb29zZS5NYW5hZ2VkLkNsYXNzKCdKb29zZS5OYW1lc3BhY2UuTWFuYWdlcicsIHtcbiAgICBcbiAgICBoYXZlIDoge1xuICAgICAgICBjdXJyZW50ICAgICA6IG51bGxcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIG1ldGhvZHMgOiB7XG4gICAgICAgIFxuICAgICAgICBpbml0aWFsaXplIDogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgdGhpcy5jdXJyZW50ICAgID0gWyBKb29zZS50b3AgXVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIGdldEN1cnJlbnQ6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLmN1cnJlbnRbMF1cbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBleGVjdXRlSW4gOiBmdW5jdGlvbiAobnMsIGZ1bmMpIHtcbiAgICAgICAgICAgIHZhciBjdXJyZW50ID0gdGhpcy5jdXJyZW50XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGN1cnJlbnQudW5zaGlmdChucylcbiAgICAgICAgICAgIHZhciByZXMgPSBmdW5jLmNhbGwobnMsIG5zKVxuICAgICAgICAgICAgY3VycmVudC5zaGlmdCgpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHJldHVybiByZXNcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBlYXJseUNyZWF0ZSA6IGZ1bmN0aW9uIChuYW1lLCBtZXRhQ2xhc3MsIHByb3BzKSB7XG4gICAgICAgICAgICBwcm9wcy5jb25zdHJ1Y3Rvck9ubHkgPSB0cnVlXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHJldHVybiBuZXcgbWV0YUNsYXNzKG5hbWUsIHByb3BzKS5jXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgLy90aGlzIGZ1bmN0aW9uIGVzdGFibGlzaGluZyB0aGUgZnVsbCBcIm5hbWVzcGFjZSBjaGFpblwiIChpbmNsdWRpbmcgdGhlIGxhc3QgZWxlbWVudClcbiAgICAgICAgY3JlYXRlIDogZnVuY3Rpb24gKG5zTmFtZSwgbWV0YUNsYXNzLCBleHRlbmQpIHtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy9pZiBubyBuYW1lIHByb3ZpZGVkLCB0aGVuIHdlIGNyZWF0aW5nIGFuIGFub255bW91cyBjbGFzcywgc28ganVzdCBza2lwIGFsbCB0aGUgbmFtZXNwYWNlIG1hbmlwdWxhdGlvbnNcbiAgICAgICAgICAgIGlmICghbnNOYW1lKSByZXR1cm4gbmV3IG1ldGFDbGFzcyhuc05hbWUsIGV4dGVuZCkuY1xuICAgICAgICAgICAgXG4gICAgICAgICAgICB2YXIgbWUgPSB0aGlzXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmICgvXlxcLi8udGVzdChuc05hbWUpKSByZXR1cm4gdGhpcy5leGVjdXRlSW4oSm9vc2UudG9wLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIG1lLmNyZWF0ZShuc05hbWUucmVwbGFjZSgvXlxcLi8sICcnKSwgbWV0YUNsYXNzLCBleHRlbmQpXG4gICAgICAgICAgICB9KVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB2YXIgcHJvcHMgICA9IGV4dGVuZCB8fCB7fVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB2YXIgcGFydHMgICA9IEpvb3NlLlMuc2FuZVNwbGl0KG5zTmFtZSwgJy4nKVxuICAgICAgICAgICAgdmFyIG9iamVjdCAgPSB0aGlzLmdldEN1cnJlbnQoKVxuICAgICAgICAgICAgdmFyIHNvRmFyICAgPSBvYmplY3QgPT0gSm9vc2UudG9wID8gW10gOiBKb29zZS5TLnNhbmVTcGxpdChvYmplY3QubWV0YS5uYW1lLCAnLicpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgcGFydHMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgICAgICB2YXIgcGFydCAgICAgICAgPSBwYXJ0c1tpXVxuICAgICAgICAgICAgICAgIHZhciBpc0xhc3QgICAgICA9IGkgPT0gcGFydHMubGVuZ3RoIC0gMVxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIGlmIChwYXJ0ID09IFwibWV0YVwiIHx8IHBhcnQgPT0gXCJteVwiIHx8ICFwYXJ0KSB0aHJvdyBcIk1vZHVsZSBuYW1lIFtcIiArIG5zTmFtZSArIFwiXSBtYXkgbm90IGluY2x1ZGUgYSBwYXJ0IGNhbGxlZCAnbWV0YScgb3IgJ215JyBvciBlbXB0eSBwYXJ0LlwiXG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgdmFyIGN1ciA9ICAgb2JqZWN0W3BhcnRdXG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgc29GYXIucHVzaChwYXJ0KVxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIHZhciBzb0Zhck5hbWUgICAgICAgPSBzb0Zhci5qb2luKFwiLlwiKVxuICAgICAgICAgICAgICAgIHZhciBuZWVkRmluYWxpemUgICAgPSBmYWxzZVxuICAgICAgICAgICAgICAgIHZhciBuc0tlZXBlclxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIC8vIGlmIHRoZSBuYW1lc3BhY2Ugc2VnbWVudCBpcyBlbXB0eVxuICAgICAgICAgICAgICAgIGlmICh0eXBlb2YgY3VyID09IFwidW5kZWZpbmVkXCIpIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGlzTGFzdCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgLy8gcGVyZm9ybSBcImVhcmx5IGNyZWF0ZVwiIHdoaWNoIGp1c3QgZmlsbHMgdGhlIG5hbWVzcGFjZSBzZWdtZW50IHdpdGggcmlnaHQgY29uc3RydWN0b3JcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIHRoaXMgYWxsb3dzIHVzIHRvIGhhdmUgYSByaWdodCBjb25zdHJ1Y3RvciBpbiB0aGUgbmFtZXNwYWNlIHNlZ21lbnQgd2hlbiB0aGUgYGJvZHlgIHdpbGwgYmUgY2FsbGVkXG4gICAgICAgICAgICAgICAgICAgICAgICBuc0tlZXBlciAgICAgICAgPSB0aGlzLmVhcmx5Q3JlYXRlKHNvRmFyTmFtZSwgbWV0YUNsYXNzLCBwcm9wcylcbiAgICAgICAgICAgICAgICAgICAgICAgIG5lZWRGaW5hbGl6ZSAgICA9IHRydWVcbiAgICAgICAgICAgICAgICAgICAgfSBlbHNlXG4gICAgICAgICAgICAgICAgICAgICAgICBuc0tlZXBlciAgICAgICAgPSBuZXcgSm9vc2UuTmFtZXNwYWNlLktlZXBlcihzb0Zhck5hbWUpLmNcbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIG9iamVjdFtwYXJ0XSA9IG5zS2VlcGVyXG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICBjdXIgPSBuc0tlZXBlclxuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKGlzTGFzdCAmJiBjdXIgJiYgY3VyLm1ldGEpIHtcbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIHZhciBjdXJyZW50TWV0YSA9IGN1ci5tZXRhXG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICBpZiAobWV0YUNsYXNzID09IEpvb3NlLk5hbWVzcGFjZS5LZWVwZXIpXG4gICAgICAgICAgICAgICAgICAgICAgICAvL2BNb2R1bGVgIG92ZXIgc29tZXRoaW5nIGNhc2UgLSBleHRlbmQgdGhlIG9yaWdpbmFsXG4gICAgICAgICAgICAgICAgICAgICAgICBjdXJyZW50TWV0YS5leHRlbmQocHJvcHMpXG4gICAgICAgICAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoY3VycmVudE1ldGEgaW5zdGFuY2VvZiBKb29zZS5OYW1lc3BhY2UuS2VlcGVyKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY3VycmVudE1ldGEucGxhbnQodGhpcy5lYXJseUNyZWF0ZShzb0Zhck5hbWUsIG1ldGFDbGFzcywgcHJvcHMpKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG5lZWRGaW5hbGl6ZSA9IHRydWVcbiAgICAgICAgICAgICAgICAgICAgICAgIH0gZWxzZVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcIkRvdWJsZSBkZWNsYXJhdGlvbiBvZiBbXCIgKyBzb0Zhck5hbWUgKyBcIl1cIilcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICB9IGVsc2UgXG4gICAgICAgICAgICAgICAgICAgIGlmIChpc0xhc3QgJiYgIShjdXIgJiYgY3VyLm1ldGEgJiYgY3VyLm1ldGEubWV0YSkpIHRocm93IFwiVHJ5aW5nIHRvIHNldHVwIG1vZHVsZSBcIiArIHNvRmFyTmFtZSArIFwiIGZhaWxlZC4gVGhlcmUgaXMgYWxyZWFkeSBzb21ldGhpbmc6IFwiICsgY3VyXG5cbiAgICAgICAgICAgICAgICAvLyBob29rIHRvIGFsbG93IGVtYmVkZCByZXNvdXJjZSBpbnRvIG1ldGFcbiAgICAgICAgICAgICAgICBpZiAoaXNMYXN0KSB0aGlzLnByZXBhcmVNZXRhKGN1ci5tZXRhKVxuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBpZiAobmVlZEZpbmFsaXplKSBjdXIubWV0YS5jb25zdHJ1Y3QocHJvcHMpXG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIG9iamVjdCA9IGN1clxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgXG4gICAgICAgICAgICByZXR1cm4gb2JqZWN0XG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgcHJlcGFyZU1ldGEgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgcHJlcGFyZVByb3BlcnRpZXMgOiBmdW5jdGlvbiAobmFtZSwgcHJvcHMsIGRlZmF1bHRNZXRhLCBjYWxsYmFjaykge1xuICAgICAgICAgICAgaWYgKG5hbWUgJiYgdHlwZW9mIG5hbWUgIT0gJ3N0cmluZycpIHtcbiAgICAgICAgICAgICAgICBwcm9wcyAgID0gbmFtZVxuICAgICAgICAgICAgICAgIG5hbWUgICAgPSBudWxsXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciBtZXRhXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmIChwcm9wcyAmJiBwcm9wcy5tZXRhKSB7XG4gICAgICAgICAgICAgICAgbWV0YSA9IHByb3BzLm1ldGFcbiAgICAgICAgICAgICAgICBkZWxldGUgcHJvcHMubWV0YVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAoIW1ldGEpXG4gICAgICAgICAgICAgICAgaWYgKHByb3BzICYmIHR5cGVvZiBwcm9wcy5pc2EgPT0gJ2Z1bmN0aW9uJyAmJiBwcm9wcy5pc2EubWV0YSlcbiAgICAgICAgICAgICAgICAgICAgbWV0YSA9IHByb3BzLmlzYS5tZXRhLmNvbnN0cnVjdG9yXG4gICAgICAgICAgICAgICAgZWxzZVxuICAgICAgICAgICAgICAgICAgICBtZXRhID0gZGVmYXVsdE1ldGFcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcmV0dXJuIGNhbGxiYWNrLmNhbGwodGhpcywgbmFtZSwgbWV0YSwgcHJvcHMpXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgZ2V0RGVmYXVsdEhlbHBlckZvciA6IGZ1bmN0aW9uIChtZXRhQ2xhc3MpIHtcbiAgICAgICAgICAgIHZhciBtZSA9IHRoaXNcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcmV0dXJuIGZ1bmN0aW9uIChuYW1lLCBwcm9wcykge1xuICAgICAgICAgICAgICAgIHJldHVybiBtZS5wcmVwYXJlUHJvcGVydGllcyhuYW1lLCBwcm9wcywgbWV0YUNsYXNzLCBmdW5jdGlvbiAobmFtZSwgbWV0YSwgcHJvcHMpIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIG1lLmNyZWF0ZShuYW1lLCBtZXRhLCBwcm9wcylcbiAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIHJlZ2lzdGVyIDogZnVuY3Rpb24gKGhlbHBlck5hbWUsIG1ldGFDbGFzcywgZnVuYykge1xuICAgICAgICAgICAgdmFyIG1lID0gdGhpc1xuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAodGhpcy5tZXRhLmhhc01ldGhvZChoZWxwZXJOYW1lKSkge1xuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIHZhciBoZWxwZXIgPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBtZVsgaGVscGVyTmFtZSBdLmFwcGx5KG1lLCBhcmd1bWVudHMpXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIGlmICghSm9vc2UudG9wWyBoZWxwZXJOYW1lIF0pICAgSm9vc2UudG9wWyBoZWxwZXJOYW1lIF0gICAgICAgICA9IGhlbHBlclxuICAgICAgICAgICAgICAgIGlmICghSm9vc2VbIGhlbHBlck5hbWUgXSkgICAgICAgSm9vc2VbIGhlbHBlck5hbWUgXSAgICAgICAgICAgICA9IGhlbHBlclxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIGlmIChKb29zZS5pc19Ob2RlSlMgJiYgdHlwZW9mIGV4cG9ydHMgIT0gJ3VuZGVmaW5lZCcpICAgICAgICAgICAgZXhwb3J0c1sgaGVscGVyTmFtZSBdICAgID0gaGVscGVyXG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHZhciBtZXRob2RzID0ge31cbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBtZXRob2RzWyBoZWxwZXJOYW1lIF0gPSBmdW5jIHx8IHRoaXMuZ2V0RGVmYXVsdEhlbHBlckZvcihtZXRhQ2xhc3MpXG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgdGhpcy5tZXRhLmV4dGVuZCh7XG4gICAgICAgICAgICAgICAgICAgIG1ldGhvZHMgOiBtZXRob2RzXG4gICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICB0aGlzLnJlZ2lzdGVyKGhlbHBlck5hbWUpXG4gICAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgTW9kdWxlIDogZnVuY3Rpb24gKG5hbWUsIHByb3BzKSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5wcmVwYXJlUHJvcGVydGllcyhuYW1lLCBwcm9wcywgSm9vc2UuTmFtZXNwYWNlLktlZXBlciwgZnVuY3Rpb24gKG5hbWUsIG1ldGEsIHByb3BzKSB7XG4gICAgICAgICAgICAgICAgaWYgKHR5cGVvZiBwcm9wcyA9PSAnZnVuY3Rpb24nKSBwcm9wcyA9IHsgYm9keSA6IHByb3BzIH0gICAgXG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuY3JlYXRlKG5hbWUsIG1ldGEsIHByb3BzKVxuICAgICAgICAgICAgfSlcbiAgICAgICAgfVxuICAgIH1cbiAgICBcbn0pLmNcblxuSm9vc2UuTmFtZXNwYWNlLk1hbmFnZXIubXkgPSBuZXcgSm9vc2UuTmFtZXNwYWNlLk1hbmFnZXIoKVxuXG5Kb29zZS5OYW1lc3BhY2UuTWFuYWdlci5teS5yZWdpc3RlcignQ2xhc3MnLCBKb29zZS5NZXRhLkNsYXNzKVxuSm9vc2UuTmFtZXNwYWNlLk1hbmFnZXIubXkucmVnaXN0ZXIoJ1JvbGUnLCBKb29zZS5NZXRhLlJvbGUpXG5Kb29zZS5OYW1lc3BhY2UuTWFuYWdlci5teS5yZWdpc3RlcignTW9kdWxlJylcblxuXG4vLyBmb3IgdGhlIHJlc3Qgb2YgdGhlIHBhY2thZ2VcbnZhciBDbGFzcyAgICAgICA9IEpvb3NlLkNsYXNzXG52YXIgUm9sZSAgICAgICAgPSBKb29zZS5Sb2xlXG47XG5Sb2xlKCdKb29zZS5BdHRyaWJ1dGUuRGVsZWdhdGUnLCB7XG4gICAgXG4gICAgaGF2ZSA6IHtcbiAgICAgICAgaGFuZGxlcyA6IG51bGxcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIG92ZXJyaWRlIDoge1xuICAgICAgICBcbiAgICAgICAgZWFjaERlbGVnYXRlIDogZnVuY3Rpb24gKGhhbmRsZXMsIGZ1bmMsIHNjb3BlKSB7XG4gICAgICAgICAgICBpZiAodHlwZW9mIGhhbmRsZXMgPT0gJ3N0cmluZycpIHJldHVybiBmdW5jLmNhbGwoc2NvcGUsIGhhbmRsZXMsIGhhbmRsZXMpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmIChoYW5kbGVzIGluc3RhbmNlb2YgQXJyYXkpXG4gICAgICAgICAgICAgICAgcmV0dXJuIEpvb3NlLkEuZWFjaChoYW5kbGVzLCBmdW5jdGlvbiAoZGVsZWdhdGVUbykge1xuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgZnVuYy5jYWxsKHNjb3BlLCBkZWxlZ2F0ZVRvLCBkZWxlZ2F0ZVRvKVxuICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAoaGFuZGxlcyA9PT0gT2JqZWN0KGhhbmRsZXMpKVxuICAgICAgICAgICAgICAgIEpvb3NlLk8uZWFjaE93bihoYW5kbGVzLCBmdW5jdGlvbiAoZGVsZWdhdGVUbywgaGFuZGxlQXMpIHtcbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIGZ1bmMuY2FsbChzY29wZSwgaGFuZGxlQXMsIGRlbGVnYXRlVG8pXG4gICAgICAgICAgICAgICAgfSlcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBnZXRBY2Nlc3NvcnNGb3IgOiBmdW5jdGlvbiAodGFyZ2V0Q2xhc3MpIHtcbiAgICAgICAgICAgIHZhciB0YXJnZXRNZXRhICA9IHRhcmdldENsYXNzLm1ldGFcbiAgICAgICAgICAgIHZhciBtZXRob2RzICAgICA9IHRoaXMuU1VQRVIodGFyZ2V0Q2xhc3MpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciBtZSAgICAgID0gdGhpc1xuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLmVhY2hEZWxlZ2F0ZSh0aGlzLmhhbmRsZXMsIGZ1bmN0aW9uIChoYW5kbGVBcywgZGVsZWdhdGVUbykge1xuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIGlmICghdGFyZ2V0TWV0YS5oYXNNZXRob2QoaGFuZGxlQXMpKSB7XG4gICAgICAgICAgICAgICAgICAgIHZhciBoYW5kbGVyID0gbWV0aG9kc1sgaGFuZGxlQXMgXSA9IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHZhciBhdHRyVmFsdWUgPSBtZS5nZXRWYWx1ZUZyb20odGhpcylcbiAgICAgICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGF0dHJWYWx1ZVsgZGVsZWdhdGVUbyBdLmFwcGx5KGF0dHJWYWx1ZSwgYXJndW1lbnRzKVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICBoYW5kbGVyLkFDQ0VTU09SX0ZST00gPSBtZVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHJldHVybiBtZXRob2RzXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgZ2V0QWNjZXNzb3JzRnJvbSA6IGZ1bmN0aW9uIChmcm9tKSB7XG4gICAgICAgICAgICB2YXIgbWV0aG9kcyA9IHRoaXMuU1VQRVIoZnJvbSlcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdmFyIG1lICAgICAgICAgID0gdGhpc1xuICAgICAgICAgICAgdmFyIHRhcmdldE1ldGEgID0gZnJvbS5tZXRhXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXMuZWFjaERlbGVnYXRlKHRoaXMuaGFuZGxlcywgZnVuY3Rpb24gKGhhbmRsZUFzKSB7XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgdmFyIGhhbmRsZXIgPSB0YXJnZXRNZXRhLmdldE1ldGhvZChoYW5kbGVBcylcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBpZiAoaGFuZGxlciAmJiBoYW5kbGVyLnZhbHVlLkFDQ0VTU09SX0ZST00gPT0gbWUpIG1ldGhvZHMucHVzaChoYW5kbGVBcylcbiAgICAgICAgICAgIH0pXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHJldHVybiBtZXRob2RzXG4gICAgICAgIH1cbiAgICB9XG59KVxuXG47XG5Sb2xlKCdKb29zZS5BdHRyaWJ1dGUuVHJpZ2dlcicsIHtcbiAgICBcbiAgICBoYXZlIDoge1xuICAgICAgICB0cmlnZ2VyICAgICAgICA6IG51bGxcbiAgICB9LCBcblxuICAgIFxuICAgIGFmdGVyIDoge1xuICAgICAgICBpbml0aWFsaXplIDogZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICBpZiAodGhpcy50cmlnZ2VyKSB7XG4gICAgICAgICAgICAgICAgaWYgKCF0aGlzLndyaXRlYWJsZSkgdGhyb3cgbmV3IEVycm9yKFwiQ2FuJ3QgdXNlIGB0cmlnZ2VyYCBmb3IgcmVhZC1vbmx5IGF0dHJpYnV0ZXNcIilcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICB0aGlzLmhhc1NldHRlciA9IHRydWVcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgb3ZlcnJpZGUgOiB7XG4gICAgICAgIFxuICAgICAgICBnZXRTZXR0ZXIgOiBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgIHZhciBvcmlnaW5hbCAgICA9IHRoaXMuU1VQRVIoKVxuICAgICAgICAgICAgdmFyIHRyaWdnZXIgICAgID0gdGhpcy50cmlnZ2VyXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmICghdHJpZ2dlcikgcmV0dXJuIG9yaWdpbmFsXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciBtZSAgICAgID0gdGhpc1xuICAgICAgICAgICAgdmFyIGluaXQgICAgPSBKb29zZS5PLmlzRnVuY3Rpb24obWUuaW5pdCkgPyBudWxsIDogbWUuaW5pdFxuICAgICAgICAgICAgXG4gICAgICAgICAgICByZXR1cm4gZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgIHZhciBvbGRWYWx1ZSAgICA9IG1lLmhhc1ZhbHVlKHRoaXMpID8gbWUuZ2V0VmFsdWVGcm9tKHRoaXMpIDogaW5pdFxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIHZhciByZXMgICAgICAgICA9IG9yaWdpbmFsLmFwcGx5KHRoaXMsIGFyZ3VtZW50cylcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICB0cmlnZ2VyLmNhbGwodGhpcywgbWUuZ2V0VmFsdWVGcm9tKHRoaXMpLCBvbGRWYWx1ZSlcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICByZXR1cm4gcmVzXG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG59KSAgICBcblxuO1xuUm9sZSgnSm9vc2UuQXR0cmlidXRlLkxhenknLCB7XG4gICAgXG4gICAgXG4gICAgaGF2ZSA6IHtcbiAgICAgICAgbGF6eSAgICAgICAgOiBudWxsXG4gICAgfSwgXG4gICAgXG4gICAgXG4gICAgYmVmb3JlIDoge1xuICAgICAgICBjb21wdXRlVmFsdWUgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBpZiAodHlwZW9mIHRoaXMuaW5pdCA9PSAnZnVuY3Rpb24nICYmIHRoaXMubGF6eSkge1xuICAgICAgICAgICAgICAgIHRoaXMubGF6eSA9IHRoaXMuaW5pdCAgICBcbiAgICAgICAgICAgICAgICBkZWxldGUgdGhpcy5pbml0ICAgIFxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBhZnRlciA6IHtcbiAgICAgICAgaW5pdGlhbGl6ZSA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIGlmICh0aGlzLmxhenkpIHRoaXMucmVhZGFibGUgPSB0aGlzLmhhc0dldHRlciA9IHRydWVcbiAgICAgICAgfVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgb3ZlcnJpZGUgOiB7XG4gICAgICAgIFxuICAgICAgICBnZXRHZXR0ZXIgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB2YXIgb3JpZ2luYWwgICAgPSB0aGlzLlNVUEVSKClcbiAgICAgICAgICAgIHZhciBsYXp5ICAgICAgICA9IHRoaXMubGF6eVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAoIWxhenkpIHJldHVybiBvcmlnaW5hbFxuICAgICAgICAgICAgXG4gICAgICAgICAgICB2YXIgbWUgICAgICA9IHRoaXMgICAgXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHJldHVybiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgICAgaWYgKCFtZS5oYXNWYWx1ZSh0aGlzKSkge1xuICAgICAgICAgICAgICAgICAgICB2YXIgaW5pdGlhbGl6ZXIgPSB0eXBlb2YgbGF6eSA9PSAnZnVuY3Rpb24nID8gbGF6eSA6IHRoaXNbIGxhenkucmVwbGFjZSgvXnRoaXNcXC4vLCAnJykgXVxuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgbWUuc2V0VmFsdWVUbyh0aGlzLCBpbml0aWFsaXplci5hcHBseSh0aGlzLCBhcmd1bWVudHMpKVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICByZXR1cm4gb3JpZ2luYWwuY2FsbCh0aGlzKSAgICBcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cbn0pXG5cbjtcblJvbGUoJ0pvb3NlLkF0dHJpYnV0ZS5BY2Nlc3Nvci5Db21iaW5lZCcsIHtcbiAgICBcbiAgICBcbiAgICBoYXZlIDoge1xuICAgICAgICBpc0NvbWJpbmVkICAgICAgICA6IGZhbHNlXG4gICAgfSwgXG4gICAgXG4gICAgXG4gICAgYWZ0ZXIgOiB7XG4gICAgICAgIGluaXRpYWxpemUgOiBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgIHRoaXMuaXNDb21iaW5lZCA9IHRoaXMuaXNDb21iaW5lZCB8fCAvLi5jL2kudGVzdCh0aGlzLmlzKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAodGhpcy5pc0NvbWJpbmVkKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5zbG90ID0gJyQkJyArIHRoaXMubmFtZVxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIHRoaXMuaGFzR2V0dGVyID0gdHJ1ZVxuICAgICAgICAgICAgICAgIHRoaXMuaGFzU2V0dGVyID0gZmFsc2VcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICB0aGlzLnNldHRlck5hbWUgPSB0aGlzLmdldHRlck5hbWUgPSB0aGlzLnB1YmxpY05hbWVcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgb3ZlcnJpZGUgOiB7XG4gICAgICAgIFxuICAgICAgICBnZXRHZXR0ZXIgOiBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgIHZhciBnZXR0ZXIgICAgPSB0aGlzLlNVUEVSKClcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKCF0aGlzLmlzQ29tYmluZWQpIHJldHVybiBnZXR0ZXJcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdmFyIHNldHRlciAgICA9IHRoaXMuZ2V0U2V0dGVyKClcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdmFyIG1lID0gdGhpc1xuICAgICAgICAgICAgXG4gICAgICAgICAgICByZXR1cm4gZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIGlmICghYXJndW1lbnRzLmxlbmd0aCkge1xuICAgICAgICAgICAgICAgICAgICBpZiAobWUucmVhZGFibGUpIHJldHVybiBnZXR0ZXIuY2FsbCh0aGlzKVxuICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDYWxsIHRvIGdldHRlciBvZiB1bnJlYWRhYmxlIGF0dHJpYnV0ZTogW1wiICsgbWUubmFtZSArIFwiXVwiKVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBpZiAobWUud3JpdGVhYmxlKSByZXR1cm4gc2V0dGVyLmFwcGx5KHRoaXMsIGFyZ3VtZW50cylcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDYWxsIHRvIHNldHRlciBvZiByZWFkLW9ubHkgYXR0cmlidXRlOiBbXCIgKyBtZS5uYW1lICsgXCJdXCIpICAgIFxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuICAgIFxufSlcblxuO1xuSm9vc2UuTWFuYWdlZC5BdHRyaWJ1dGUubWV0YS5leHRlbmQoe1xuICAgIGRvZXMgOiBbIEpvb3NlLkF0dHJpYnV0ZS5EZWxlZ2F0ZSwgSm9vc2UuQXR0cmlidXRlLlRyaWdnZXIsIEpvb3NlLkF0dHJpYnV0ZS5MYXp5LCBKb29zZS5BdHRyaWJ1dGUuQWNjZXNzb3IuQ29tYmluZWQgXVxufSkgICAgICAgICAgICBcblxuO1xuUm9sZSgnSm9vc2UuTWV0YS5TaW5nbGV0b24nLCB7XG4gICAgXG4gICAgaGFzIDoge1xuICAgICAgICBmb3JjZUluc3RhbmNlICAgICAgICAgICA6IEpvb3NlLkkuT2JqZWN0LFxuICAgICAgICBpbnN0YW5jZSAgICAgICAgICAgICAgICA6IG51bGxcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIFxuICAgIG92ZXJyaWRlIDoge1xuICAgICAgICBcbiAgICAgICAgZGVmYXVsdENvbnN0cnVjdG9yIDogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgdmFyIG1ldGEgICAgICAgID0gdGhpc1xuICAgICAgICAgICAgdmFyIHByZXZpb3VzICAgID0gdGhpcy5TVVBFUigpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXMuYWRhcHRDb25zdHJ1Y3RvcihwcmV2aW91cylcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcmV0dXJuIGZ1bmN0aW9uIChmb3JjZUluc3RhbmNlLCBwYXJhbXMpIHtcbiAgICAgICAgICAgICAgICBpZiAoZm9yY2VJbnN0YW5jZSA9PSBtZXRhLmZvcmNlSW5zdGFuY2UpIHJldHVybiBwcmV2aW91cy5hcHBseSh0aGlzLCBwYXJhbXMpIHx8IHRoaXNcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICB2YXIgaW5zdGFuY2UgPSBtZXRhLmluc3RhbmNlXG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgaWYgKGluc3RhbmNlKSB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChtZXRhLmhhc01ldGhvZCgnY29uZmlndXJlJykpIGluc3RhbmNlLmNvbmZpZ3VyZS5hcHBseShpbnN0YW5jZSwgYXJndW1lbnRzKVxuICAgICAgICAgICAgICAgIH0gZWxzZVxuICAgICAgICAgICAgICAgICAgICBtZXRhLmluc3RhbmNlID0gbmV3IG1ldGEuYyhtZXRhLmZvcmNlSW5zdGFuY2UsIGFyZ3VtZW50cylcbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgcmV0dXJuIG1ldGEuaW5zdGFuY2VcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSAgICAgICAgXG4gICAgfVxuICAgIFxuXG59KVxuXG5cbkpvb3NlLk5hbWVzcGFjZS5NYW5hZ2VyLm15LnJlZ2lzdGVyKCdTaW5nbGV0b24nLCBDbGFzcyh7XG4gICAgaXNhICAgICA6IEpvb3NlLk1ldGEuQ2xhc3MsXG4gICAgbWV0YSAgICA6IEpvb3NlLk1ldGEuQ2xhc3MsXG4gICAgXG4gICAgZG9lcyAgICA6IEpvb3NlLk1ldGEuU2luZ2xldG9uXG59KSlcbjtcbjtcbn0oKTs7XG4iLCIvLyBleHBvc2UgbW9kdWxlIGNsYXNzZXNcclxuXHJcbmV4cG9ydHMuSW50ZXJzZWN0aW9uID0gcmVxdWlyZSgnLi9saWIvSW50ZXJzZWN0aW9uJyk7XHJcbmV4cG9ydHMuSW50ZXJzZWN0aW9uUGFyYW1zID0gcmVxdWlyZSgnLi9saWIvSW50ZXJzZWN0aW9uUGFyYW1zJyk7XHJcblxyXG4vLyBleHBvc2UgYWZmaW5lIG1vZHVsZSBjbGFzc2VzXHJcbmV4cG9ydHMuUG9pbnQyRCA9IHJlcXVpcmUoJ2tsZC1hZmZpbmUnKS5Qb2ludDJEO1xyXG4iLCIvKipcclxuICpcclxuICogIEludGVyc2VjdGlvbi5qc1xyXG4gKlxyXG4gKiAgY29weXJpZ2h0IDIwMDIsIDIwMTMgS2V2aW4gTGluZHNleVxyXG4gKlxyXG4gKi9cclxuXHJcbnZhciBQb2ludDJEID0gcmVxdWlyZSgna2xkLWFmZmluZScpLlBvaW50MkQsXHJcbiAgICBWZWN0b3IyRCA9IHJlcXVpcmUoJ2tsZC1hZmZpbmUnKS5WZWN0b3IyRCxcclxuICAgIFBvbHlub21pYWwgPSByZXF1aXJlKCdrbGQtcG9seW5vbWlhbCcpLlBvbHlub21pYWw7XHJcblxyXG4vKipcclxuICogIEludGVyc2VjdGlvblxyXG4gKi9cclxuZnVuY3Rpb24gSW50ZXJzZWN0aW9uKHN0YXR1cykge1xyXG4gICAgdGhpcy5pbml0KHN0YXR1cyk7XHJcbn1cclxuXHJcbi8qKlxyXG4gKiAgaW5pdFxyXG4gKlxyXG4gKiAgQHBhcmFtIHtTdHJpbmd9IHN0YXR1c1xyXG4gKiAgQHJldHVybnMge0ludGVyc2VjdGlvbn1cclxuICovXHJcbkludGVyc2VjdGlvbi5wcm90b3R5cGUuaW5pdCA9IGZ1bmN0aW9uKHN0YXR1cykge1xyXG4gICAgdGhpcy5zdGF0dXMgPSBzdGF0dXM7XHJcbiAgICB0aGlzLnBvaW50cyA9IG5ldyBBcnJheSgpO1xyXG59O1xyXG5cclxuLyoqXHJcbiAqICBhcHBlbmRQb2ludFxyXG4gKlxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBwb2ludFxyXG4gKi9cclxuSW50ZXJzZWN0aW9uLnByb3RvdHlwZS5hcHBlbmRQb2ludCA9IGZ1bmN0aW9uKHBvaW50KSB7XHJcbiAgICB0aGlzLnBvaW50cy5wdXNoKHBvaW50KTtcclxufTtcclxuXHJcbi8qKlxyXG4gKiAgYXBwZW5kUG9pbnRzXHJcbiAqXHJcbiAqICBAcGFyYW0ge0FycmF5PFBvaW50MkQ+fSBwb2ludHNcclxuICovXHJcbkludGVyc2VjdGlvbi5wcm90b3R5cGUuYXBwZW5kUG9pbnRzID0gZnVuY3Rpb24ocG9pbnRzKSB7XHJcbiAgICB0aGlzLnBvaW50cyA9IHRoaXMucG9pbnRzLmNvbmNhdChwb2ludHMpO1xyXG59O1xyXG5cclxuLy8gc3RhdGljIG1ldGhvZHNcclxuXHJcbi8qKlxyXG4gKiAgaW50ZXJzZWN0U2hhcGVzXHJcbiAqXHJcbiAqICBAcGFyYW0ge0ludGVyc2VjdGlvblBhcmFtc30gc2hhcGUxXHJcbiAqICBAcGFyYW0ge0ludGVyc2VjdGlvblBhcmFtc30gc2hhcGUyXHJcbiAqICBAcmV0dXJucyB7SW50ZXJzZWN0aW9ufVxyXG4gKi9cclxuSW50ZXJzZWN0aW9uLmludGVyc2VjdFNoYXBlcyA9IGZ1bmN0aW9uKHNoYXBlMSwgc2hhcGUyKSB7XHJcbiAgICB2YXIgaXAxID0gc2hhcGUxLmdldEludGVyc2VjdGlvblBhcmFtcygpO1xyXG4gICAgdmFyIGlwMiA9IHNoYXBlMi5nZXRJbnRlcnNlY3Rpb25QYXJhbXMoKTtcclxuICAgIHZhciByZXN1bHQ7XHJcblxyXG4gICAgaWYgKCBpcDEgIT0gbnVsbCAmJiBpcDIgIT0gbnVsbCApIHtcclxuICAgICAgICBpZiAoIGlwMS5uYW1lID09IFwiUGF0aFwiICkge1xyXG4gICAgICAgICAgICByZXN1bHQgPSBJbnRlcnNlY3Rpb24uaW50ZXJzZWN0UGF0aFNoYXBlKHNoYXBlMSwgc2hhcGUyKTtcclxuICAgICAgICB9IGVsc2UgaWYgKCBpcDIubmFtZSA9PSBcIlBhdGhcIiApIHtcclxuICAgICAgICAgICAgcmVzdWx0ID0gSW50ZXJzZWN0aW9uLmludGVyc2VjdFBhdGhTaGFwZShzaGFwZTIsIHNoYXBlMSk7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgdmFyIG1ldGhvZDtcclxuICAgICAgICAgICAgdmFyIHBhcmFtcztcclxuXHJcbiAgICAgICAgICAgIGlmICggaXAxLm5hbWUgPCBpcDIubmFtZSApIHtcclxuICAgICAgICAgICAgICAgIG1ldGhvZCA9IFwiaW50ZXJzZWN0XCIgKyBpcDEubmFtZSArIGlwMi5uYW1lO1xyXG4gICAgICAgICAgICAgICAgcGFyYW1zID0gaXAxLnBhcmFtcy5jb25jYXQoIGlwMi5wYXJhbXMgKTtcclxuICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgIG1ldGhvZCA9IFwiaW50ZXJzZWN0XCIgKyBpcDIubmFtZSArIGlwMS5uYW1lO1xyXG4gICAgICAgICAgICAgICAgcGFyYW1zID0gaXAyLnBhcmFtcy5jb25jYXQoIGlwMS5wYXJhbXMgKTtcclxuICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgaWYgKCAhKG1ldGhvZCBpbiBJbnRlcnNlY3Rpb24pIClcclxuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcIkludGVyc2VjdGlvbiBub3QgYXZhaWxhYmxlOiBcIiArIG1ldGhvZCk7XHJcblxyXG4gICAgICAgICAgICByZXN1bHQgPSBJbnRlcnNlY3Rpb25bbWV0aG9kXS5hcHBseShudWxsLCBwYXJhbXMpO1xyXG4gICAgICAgIH1cclxuICAgIH0gZWxzZSB7XHJcbiAgICAgICAgcmVzdWx0ID0gbmV3IEludGVyc2VjdGlvbihcIk5vIEludGVyc2VjdGlvblwiKTtcclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gcmVzdWx0O1xyXG59O1xyXG5cclxuLyoqXHJcbiAqICBpbnRlcnNlY3RQYXRoU2hhcGVcclxuICpcclxuICogIEBwYXJhbSB7SW50ZXJzZWN0aW9uUGFyYW1zfSBwYXRoXHJcbiAqICBAcGFyYW0ge0ludGVyc2VjdGlvblBhcmFtc30gc2hhcGVcclxuICogIEByZXR1cm5zIHtJbnRlcnNlY3Rpb259XHJcbiAqL1xyXG5JbnRlcnNlY3Rpb24uaW50ZXJzZWN0UGF0aFNoYXBlID0gZnVuY3Rpb24ocGF0aCwgc2hhcGUpIHtcclxuICAgIHJldHVybiBwYXRoLmludGVyc2VjdFNoYXBlKHNoYXBlKTtcclxufTtcclxuXHJcbi8qKlxyXG4gKiAgaW50ZXJzZWN0QmV6aWVyMkJlemllcjJcclxuICpcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gYTFcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gYTJcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gYTNcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gYjFcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gYjJcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gYjNcclxuICogIEByZXR1cm5zIHtJbnRlcnNlY3Rpb259XHJcbiAqL1xyXG5JbnRlcnNlY3Rpb24uaW50ZXJzZWN0QmV6aWVyMkJlemllcjIgPSBmdW5jdGlvbihhMSwgYTIsIGEzLCBiMSwgYjIsIGIzKSB7XHJcbiAgICB2YXIgYSwgYjtcclxuICAgIHZhciBjMTIsIGMxMSwgYzEwO1xyXG4gICAgdmFyIGMyMiwgYzIxLCBjMjA7XHJcbiAgICB2YXIgcmVzdWx0ID0gbmV3IEludGVyc2VjdGlvbihcIk5vIEludGVyc2VjdGlvblwiKTtcclxuICAgIHZhciBwb2x5O1xyXG5cclxuICAgIGEgPSBhMi5tdWx0aXBseSgtMik7XHJcbiAgICBjMTIgPSBhMS5hZGQoYS5hZGQoYTMpKTtcclxuXHJcbiAgICBhID0gYTEubXVsdGlwbHkoLTIpO1xyXG4gICAgYiA9IGEyLm11bHRpcGx5KDIpO1xyXG4gICAgYzExID0gYS5hZGQoYik7XHJcblxyXG4gICAgYzEwID0gbmV3IFBvaW50MkQoYTEueCwgYTEueSk7XHJcblxyXG4gICAgYSA9IGIyLm11bHRpcGx5KC0yKTtcclxuICAgIGMyMiA9IGIxLmFkZChhLmFkZChiMykpO1xyXG5cclxuICAgIGEgPSBiMS5tdWx0aXBseSgtMik7XHJcbiAgICBiID0gYjIubXVsdGlwbHkoMik7XHJcbiAgICBjMjEgPSBhLmFkZChiKTtcclxuXHJcbiAgICBjMjAgPSBuZXcgUG9pbnQyRChiMS54LCBiMS55KTtcclxuXHJcbiAgICBpZiAoIGMxMi55ID09IDAgKSB7XHJcbiAgICAgICAgdmFyIHYwID0gYzEyLngqKGMxMC55IC0gYzIwLnkpO1xyXG4gICAgICAgIHZhciB2MSA9IHYwIC0gYzExLngqYzExLnk7XHJcbiAgICAgICAgdmFyIHYyID0gdjAgKyB2MTtcclxuICAgICAgICB2YXIgdjMgPSBjMTEueSpjMTEueTtcclxuXHJcbiAgICAgICAgcG9seSA9IG5ldyBQb2x5bm9taWFsKFxyXG4gICAgICAgICAgICBjMTIueCpjMjIueSpjMjIueSxcclxuICAgICAgICAgICAgMipjMTIueCpjMjEueSpjMjIueSxcclxuICAgICAgICAgICAgYzEyLngqYzIxLnkqYzIxLnkgLSBjMjIueCp2MyAtIGMyMi55KnYwIC0gYzIyLnkqdjEsXHJcbiAgICAgICAgICAgIC1jMjEueCp2MyAtIGMyMS55KnYwIC0gYzIxLnkqdjEsXHJcbiAgICAgICAgICAgIChjMTAueCAtIGMyMC54KSp2MyArIChjMTAueSAtIGMyMC55KSp2MVxyXG4gICAgICAgICk7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICAgIHZhciB2MCA9IGMxMi54KmMyMi55IC0gYzEyLnkqYzIyLng7XHJcbiAgICAgICAgdmFyIHYxID0gYzEyLngqYzIxLnkgLSBjMjEueCpjMTIueTtcclxuICAgICAgICB2YXIgdjIgPSBjMTEueCpjMTIueSAtIGMxMS55KmMxMi54O1xyXG4gICAgICAgIHZhciB2MyA9IGMxMC55IC0gYzIwLnk7XHJcbiAgICAgICAgdmFyIHY0ID0gYzEyLnkqKGMxMC54IC0gYzIwLngpIC0gYzEyLngqdjM7XHJcbiAgICAgICAgdmFyIHY1ID0gLWMxMS55KnYyICsgYzEyLnkqdjQ7XHJcbiAgICAgICAgdmFyIHY2ID0gdjIqdjI7XHJcblxyXG4gICAgICAgIHBvbHkgPSBuZXcgUG9seW5vbWlhbChcclxuICAgICAgICAgICAgdjAqdjAsXHJcbiAgICAgICAgICAgIDIqdjAqdjEsXHJcbiAgICAgICAgICAgICgtYzIyLnkqdjYgKyBjMTIueSp2MSp2MSArIGMxMi55KnYwKnY0ICsgdjAqdjUpIC8gYzEyLnksXHJcbiAgICAgICAgICAgICgtYzIxLnkqdjYgKyBjMTIueSp2MSp2NCArIHYxKnY1KSAvIGMxMi55LFxyXG4gICAgICAgICAgICAodjMqdjYgKyB2NCp2NSkgLyBjMTIueVxyXG4gICAgICAgICk7XHJcbiAgICB9XHJcblxyXG4gICAgdmFyIHJvb3RzID0gcG9seS5nZXRSb290cygpO1xyXG4gICAgZm9yICggdmFyIGkgPSAwOyBpIDwgcm9vdHMubGVuZ3RoOyBpKysgKSB7XHJcbiAgICAgICAgdmFyIHMgPSByb290c1tpXTtcclxuXHJcbiAgICAgICAgaWYgKCAwIDw9IHMgJiYgcyA8PSAxICkge1xyXG4gICAgICAgICAgICB2YXIgeFJvb3RzID0gbmV3IFBvbHlub21pYWwoXHJcbiAgICAgICAgICAgICAgICBjMTIueCxcclxuICAgICAgICAgICAgICAgIGMxMS54LFxyXG4gICAgICAgICAgICAgICAgYzEwLnggLSBjMjAueCAtIHMqYzIxLnggLSBzKnMqYzIyLnhcclxuICAgICAgICAgICAgKS5nZXRSb290cygpO1xyXG4gICAgICAgICAgICB2YXIgeVJvb3RzID0gbmV3IFBvbHlub21pYWwoXHJcbiAgICAgICAgICAgICAgICBjMTIueSxcclxuICAgICAgICAgICAgICAgIGMxMS55LFxyXG4gICAgICAgICAgICAgICAgYzEwLnkgLSBjMjAueSAtIHMqYzIxLnkgLSBzKnMqYzIyLnlcclxuICAgICAgICAgICAgKS5nZXRSb290cygpO1xyXG5cclxuICAgICAgICAgICAgaWYgKCB4Um9vdHMubGVuZ3RoID4gMCAmJiB5Um9vdHMubGVuZ3RoID4gMCApIHtcclxuICAgICAgICAgICAgICAgIHZhciBUT0xFUkFOQ0UgPSAxZS00O1xyXG5cclxuICAgICAgICAgICAgICAgIGNoZWNrUm9vdHM6XHJcbiAgICAgICAgICAgICAgICBmb3IgKCB2YXIgaiA9IDA7IGogPCB4Um9vdHMubGVuZ3RoOyBqKysgKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdmFyIHhSb290ID0geFJvb3RzW2pdO1xyXG5cclxuICAgICAgICAgICAgICAgICAgICBpZiAoIDAgPD0geFJvb3QgJiYgeFJvb3QgPD0gMSApIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgZm9yICggdmFyIGsgPSAwOyBrIDwgeVJvb3RzLmxlbmd0aDsgaysrICkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCBNYXRoLmFicyggeFJvb3QgLSB5Um9vdHNba10gKSA8IFRPTEVSQU5DRSApIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXN1bHQucG9pbnRzLnB1c2goIGMyMi5tdWx0aXBseShzKnMpLmFkZChjMjEubXVsdGlwbHkocykuYWRkKGMyMCkpICk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWsgY2hlY2tSb290cztcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICBpZiAoIHJlc3VsdC5wb2ludHMubGVuZ3RoID4gMCApIHJlc3VsdC5zdGF0dXMgPSBcIkludGVyc2VjdGlvblwiO1xyXG5cclxuICAgIHJldHVybiByZXN1bHQ7XHJcbn07XHJcblxyXG5cclxuLyoqXHJcbiAqICBpbnRlcnNlY3RCZXppZXIyQmV6aWVyM1xyXG4gKlxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBhMVxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBhMlxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBhM1xyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBiMVxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBiMlxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBiM1xyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBiNFxyXG4gKiAgQHJldHVybnMge0ludGVyc2VjdGlvbn1cclxuICovXHJcbkludGVyc2VjdGlvbi5pbnRlcnNlY3RCZXppZXIyQmV6aWVyMyA9IGZ1bmN0aW9uKGExLCBhMiwgYTMsIGIxLCBiMiwgYjMsIGI0KSB7XHJcbiAgICB2YXIgYSwgYixjLCBkO1xyXG4gICAgdmFyIGMxMiwgYzExLCBjMTA7XHJcbiAgICB2YXIgYzIzLCBjMjIsIGMyMSwgYzIwO1xyXG4gICAgdmFyIHJlc3VsdCA9IG5ldyBJbnRlcnNlY3Rpb24oXCJObyBJbnRlcnNlY3Rpb25cIik7XHJcblxyXG4gICAgYSA9IGEyLm11bHRpcGx5KC0yKTtcclxuICAgIGMxMiA9IGExLmFkZChhLmFkZChhMykpO1xyXG5cclxuICAgIGEgPSBhMS5tdWx0aXBseSgtMik7XHJcbiAgICBiID0gYTIubXVsdGlwbHkoMik7XHJcbiAgICBjMTEgPSBhLmFkZChiKTtcclxuXHJcbiAgICBjMTAgPSBuZXcgUG9pbnQyRChhMS54LCBhMS55KTtcclxuXHJcbiAgICBhID0gYjEubXVsdGlwbHkoLTEpO1xyXG4gICAgYiA9IGIyLm11bHRpcGx5KDMpO1xyXG4gICAgYyA9IGIzLm11bHRpcGx5KC0zKTtcclxuICAgIGQgPSBhLmFkZChiLmFkZChjLmFkZChiNCkpKTtcclxuICAgIGMyMyA9IG5ldyBWZWN0b3IyRChkLngsIGQueSk7XHJcblxyXG4gICAgYSA9IGIxLm11bHRpcGx5KDMpO1xyXG4gICAgYiA9IGIyLm11bHRpcGx5KC02KTtcclxuICAgIGMgPSBiMy5tdWx0aXBseSgzKTtcclxuICAgIGQgPSBhLmFkZChiLmFkZChjKSk7XHJcbiAgICBjMjIgPSBuZXcgVmVjdG9yMkQoZC54LCBkLnkpO1xyXG5cclxuICAgIGEgPSBiMS5tdWx0aXBseSgtMyk7XHJcbiAgICBiID0gYjIubXVsdGlwbHkoMyk7XHJcbiAgICBjID0gYS5hZGQoYik7XHJcbiAgICBjMjEgPSBuZXcgVmVjdG9yMkQoYy54LCBjLnkpO1xyXG5cclxuICAgIGMyMCA9IG5ldyBWZWN0b3IyRChiMS54LCBiMS55KTtcclxuXHJcbiAgICB2YXIgYzEweDIgPSBjMTAueCpjMTAueDtcclxuICAgIHZhciBjMTB5MiA9IGMxMC55KmMxMC55O1xyXG4gICAgdmFyIGMxMXgyID0gYzExLngqYzExLng7XHJcbiAgICB2YXIgYzExeTIgPSBjMTEueSpjMTEueTtcclxuICAgIHZhciBjMTJ4MiA9IGMxMi54KmMxMi54O1xyXG4gICAgdmFyIGMxMnkyID0gYzEyLnkqYzEyLnk7XHJcbiAgICB2YXIgYzIweDIgPSBjMjAueCpjMjAueDtcclxuICAgIHZhciBjMjB5MiA9IGMyMC55KmMyMC55O1xyXG4gICAgdmFyIGMyMXgyID0gYzIxLngqYzIxLng7XHJcbiAgICB2YXIgYzIxeTIgPSBjMjEueSpjMjEueTtcclxuICAgIHZhciBjMjJ4MiA9IGMyMi54KmMyMi54O1xyXG4gICAgdmFyIGMyMnkyID0gYzIyLnkqYzIyLnk7XHJcbiAgICB2YXIgYzIzeDIgPSBjMjMueCpjMjMueDtcclxuICAgIHZhciBjMjN5MiA9IGMyMy55KmMyMy55O1xyXG5cclxuICAgIHZhciBwb2x5ID0gbmV3IFBvbHlub21pYWwoXHJcbiAgICAgICAgLTIqYzEyLngqYzEyLnkqYzIzLngqYzIzLnkgKyBjMTJ4MipjMjN5MiArIGMxMnkyKmMyM3gyLFxyXG4gICAgICAgIC0yKmMxMi54KmMxMi55KmMyMi54KmMyMy55IC0gMipjMTIueCpjMTIueSpjMjIueSpjMjMueCArIDIqYzEyeTIqYzIyLngqYzIzLnggK1xyXG4gICAgICAgICAgICAyKmMxMngyKmMyMi55KmMyMy55LFxyXG4gICAgICAgIC0yKmMxMi54KmMyMS54KmMxMi55KmMyMy55IC0gMipjMTIueCpjMTIueSpjMjEueSpjMjMueCAtIDIqYzEyLngqYzEyLnkqYzIyLngqYzIyLnkgK1xyXG4gICAgICAgICAgICAyKmMyMS54KmMxMnkyKmMyMy54ICsgYzEyeTIqYzIyeDIgKyBjMTJ4MiooMipjMjEueSpjMjMueSArIGMyMnkyKSxcclxuICAgICAgICAyKmMxMC54KmMxMi54KmMxMi55KmMyMy55ICsgMipjMTAueSpjMTIueCpjMTIueSpjMjMueCArIGMxMS54KmMxMS55KmMxMi54KmMyMy55ICtcclxuICAgICAgICAgICAgYzExLngqYzExLnkqYzEyLnkqYzIzLnggLSAyKmMyMC54KmMxMi54KmMxMi55KmMyMy55IC0gMipjMTIueCpjMjAueSpjMTIueSpjMjMueCAtXHJcbiAgICAgICAgICAgIDIqYzEyLngqYzIxLngqYzEyLnkqYzIyLnkgLSAyKmMxMi54KmMxMi55KmMyMS55KmMyMi54IC0gMipjMTAueCpjMTJ5MipjMjMueCAtXHJcbiAgICAgICAgICAgIDIqYzEwLnkqYzEyeDIqYzIzLnkgKyAyKmMyMC54KmMxMnkyKmMyMy54ICsgMipjMjEueCpjMTJ5MipjMjIueCAtXHJcbiAgICAgICAgICAgIGMxMXkyKmMxMi54KmMyMy54IC0gYzExeDIqYzEyLnkqYzIzLnkgKyBjMTJ4MiooMipjMjAueSpjMjMueSArIDIqYzIxLnkqYzIyLnkpLFxyXG4gICAgICAgIDIqYzEwLngqYzEyLngqYzEyLnkqYzIyLnkgKyAyKmMxMC55KmMxMi54KmMxMi55KmMyMi54ICsgYzExLngqYzExLnkqYzEyLngqYzIyLnkgK1xyXG4gICAgICAgICAgICBjMTEueCpjMTEueSpjMTIueSpjMjIueCAtIDIqYzIwLngqYzEyLngqYzEyLnkqYzIyLnkgLSAyKmMxMi54KmMyMC55KmMxMi55KmMyMi54IC1cclxuICAgICAgICAgICAgMipjMTIueCpjMjEueCpjMTIueSpjMjEueSAtIDIqYzEwLngqYzEyeTIqYzIyLnggLSAyKmMxMC55KmMxMngyKmMyMi55ICtcclxuICAgICAgICAgICAgMipjMjAueCpjMTJ5MipjMjIueCAtIGMxMXkyKmMxMi54KmMyMi54IC0gYzExeDIqYzEyLnkqYzIyLnkgKyBjMjF4MipjMTJ5MiArXHJcbiAgICAgICAgICAgIGMxMngyKigyKmMyMC55KmMyMi55ICsgYzIxeTIpLFxyXG4gICAgICAgIDIqYzEwLngqYzEyLngqYzEyLnkqYzIxLnkgKyAyKmMxMC55KmMxMi54KmMyMS54KmMxMi55ICsgYzExLngqYzExLnkqYzEyLngqYzIxLnkgK1xyXG4gICAgICAgICAgICBjMTEueCpjMTEueSpjMjEueCpjMTIueSAtIDIqYzIwLngqYzEyLngqYzEyLnkqYzIxLnkgLSAyKmMxMi54KmMyMC55KmMyMS54KmMxMi55IC1cclxuICAgICAgICAgICAgMipjMTAueCpjMjEueCpjMTJ5MiAtIDIqYzEwLnkqYzEyeDIqYzIxLnkgKyAyKmMyMC54KmMyMS54KmMxMnkyIC1cclxuICAgICAgICAgICAgYzExeTIqYzEyLngqYzIxLnggLSBjMTF4MipjMTIueSpjMjEueSArIDIqYzEyeDIqYzIwLnkqYzIxLnksXHJcbiAgICAgICAgLTIqYzEwLngqYzEwLnkqYzEyLngqYzEyLnkgLSBjMTAueCpjMTEueCpjMTEueSpjMTIueSAtIGMxMC55KmMxMS54KmMxMS55KmMxMi54ICtcclxuICAgICAgICAgICAgMipjMTAueCpjMTIueCpjMjAueSpjMTIueSArIDIqYzEwLnkqYzIwLngqYzEyLngqYzEyLnkgKyBjMTEueCpjMjAueCpjMTEueSpjMTIueSArXHJcbiAgICAgICAgICAgIGMxMS54KmMxMS55KmMxMi54KmMyMC55IC0gMipjMjAueCpjMTIueCpjMjAueSpjMTIueSAtIDIqYzEwLngqYzIwLngqYzEyeTIgK1xyXG4gICAgICAgICAgICBjMTAueCpjMTF5MipjMTIueCArIGMxMC55KmMxMXgyKmMxMi55IC0gMipjMTAueSpjMTJ4MipjMjAueSAtXHJcbiAgICAgICAgICAgIGMyMC54KmMxMXkyKmMxMi54IC0gYzExeDIqYzIwLnkqYzEyLnkgKyBjMTB4MipjMTJ5MiArIGMxMHkyKmMxMngyICtcclxuICAgICAgICAgICAgYzIweDIqYzEyeTIgKyBjMTJ4MipjMjB5MlxyXG4gICAgKTtcclxuICAgIHZhciByb290cyA9IHBvbHkuZ2V0Um9vdHNJbkludGVydmFsKDAsMSk7XHJcblxyXG4gICAgZm9yICggdmFyIGkgPSAwOyBpIDwgcm9vdHMubGVuZ3RoOyBpKysgKSB7XHJcbiAgICAgICAgdmFyIHMgPSByb290c1tpXTtcclxuICAgICAgICB2YXIgeFJvb3RzID0gbmV3IFBvbHlub21pYWwoXHJcbiAgICAgICAgICAgIGMxMi54LFxyXG4gICAgICAgICAgICBjMTEueCxcclxuICAgICAgICAgICAgYzEwLnggLSBjMjAueCAtIHMqYzIxLnggLSBzKnMqYzIyLnggLSBzKnMqcypjMjMueFxyXG4gICAgICAgICkuZ2V0Um9vdHMoKTtcclxuICAgICAgICB2YXIgeVJvb3RzID0gbmV3IFBvbHlub21pYWwoXHJcbiAgICAgICAgICAgIGMxMi55LFxyXG4gICAgICAgICAgICBjMTEueSxcclxuICAgICAgICAgICAgYzEwLnkgLSBjMjAueSAtIHMqYzIxLnkgLSBzKnMqYzIyLnkgLSBzKnMqcypjMjMueVxyXG4gICAgICAgICkuZ2V0Um9vdHMoKTtcclxuXHJcbiAgICAgICAgaWYgKCB4Um9vdHMubGVuZ3RoID4gMCAmJiB5Um9vdHMubGVuZ3RoID4gMCApIHtcclxuICAgICAgICAgICAgdmFyIFRPTEVSQU5DRSA9IDFlLTQ7XHJcblxyXG4gICAgICAgICAgICBjaGVja1Jvb3RzOlxyXG4gICAgICAgICAgICBmb3IgKCB2YXIgaiA9IDA7IGogPCB4Um9vdHMubGVuZ3RoOyBqKysgKSB7XHJcbiAgICAgICAgICAgICAgICB2YXIgeFJvb3QgPSB4Um9vdHNbal07XHJcblxyXG4gICAgICAgICAgICAgICAgaWYgKCAwIDw9IHhSb290ICYmIHhSb290IDw9IDEgKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgZm9yICggdmFyIGsgPSAwOyBrIDwgeVJvb3RzLmxlbmd0aDsgaysrICkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoIE1hdGguYWJzKCB4Um9vdCAtIHlSb290c1trXSApIDwgVE9MRVJBTkNFICkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcmVzdWx0LnBvaW50cy5wdXNoKFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGMyMy5tdWx0aXBseShzKnMqcykuYWRkKGMyMi5tdWx0aXBseShzKnMpLmFkZChjMjEubXVsdGlwbHkocykuYWRkKGMyMCkpKVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrIGNoZWNrUm9vdHM7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKCByZXN1bHQucG9pbnRzLmxlbmd0aCA+IDAgKSByZXN1bHQuc3RhdHVzID0gXCJJbnRlcnNlY3Rpb25cIjtcclxuXHJcbiAgICByZXR1cm4gcmVzdWx0O1xyXG5cclxufTtcclxuXHJcblxyXG4vKipcclxuICogIGludGVyc2VjdEJlemllcjJDaXJjbGVcclxuICpcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gcDFcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gcDJcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gcDNcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gY1xyXG4gKiAgQHBhcmFtIHtOdW1iZXJ9IHJcclxuICogIEByZXR1cm5zIHtJbnRlcnNlY3Rpb259XHJcbiAqL1xyXG5JbnRlcnNlY3Rpb24uaW50ZXJzZWN0QmV6aWVyMkNpcmNsZSA9IGZ1bmN0aW9uKHAxLCBwMiwgcDMsIGMsIHIpIHtcclxuICAgIHJldHVybiBJbnRlcnNlY3Rpb24uaW50ZXJzZWN0QmV6aWVyMkVsbGlwc2UocDEsIHAyLCBwMywgYywgciwgcik7XHJcbn07XHJcblxyXG5cclxuLyoqXHJcbiAqICBpbnRlcnNlY3RCZXppZXIyRWxsaXBzZVxyXG4gKlxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBwMVxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBwMlxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBwM1xyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBlY1xyXG4gKiAgQHBhcmFtIHtOdW1iZXJ9IHJ4XHJcbiAqICBAcGFyYW0ge051bWJlcn0gcnlcclxuICogIEByZXR1cm5zIHtJbnRlcnNlY3Rpb259XHJcbiAqL1xyXG5JbnRlcnNlY3Rpb24uaW50ZXJzZWN0QmV6aWVyMkVsbGlwc2UgPSBmdW5jdGlvbihwMSwgcDIsIHAzLCBlYywgcngsIHJ5KSB7XHJcbiAgICB2YXIgYSwgYjsgICAgICAgLy8gdGVtcG9yYXJ5IHZhcmlhYmxlc1xyXG4gICAgdmFyIGMyLCBjMSwgYzA7IC8vIGNvZWZmaWNpZW50cyBvZiBxdWFkcmF0aWNcclxuICAgIHZhciByZXN1bHQgPSBuZXcgSW50ZXJzZWN0aW9uKFwiTm8gSW50ZXJzZWN0aW9uXCIpO1xyXG5cclxuICAgIGEgPSBwMi5tdWx0aXBseSgtMik7XHJcbiAgICBjMiA9IHAxLmFkZChhLmFkZChwMykpO1xyXG5cclxuICAgIGEgPSBwMS5tdWx0aXBseSgtMik7XHJcbiAgICBiID0gcDIubXVsdGlwbHkoMik7XHJcbiAgICBjMSA9IGEuYWRkKGIpO1xyXG5cclxuICAgIGMwID0gbmV3IFBvaW50MkQocDEueCwgcDEueSk7XHJcblxyXG4gICAgdmFyIHJ4cnggID0gcngqcng7XHJcbiAgICB2YXIgcnlyeSAgPSByeSpyeTtcclxuICAgIHZhciByb290cyA9IG5ldyBQb2x5bm9taWFsKFxyXG4gICAgICAgIHJ5cnkqYzIueCpjMi54ICsgcnhyeCpjMi55KmMyLnksXHJcbiAgICAgICAgMioocnlyeSpjMi54KmMxLnggKyByeHJ4KmMyLnkqYzEueSksXHJcbiAgICAgICAgcnlyeSooMipjMi54KmMwLnggKyBjMS54KmMxLngpICsgcnhyeCooMipjMi55KmMwLnkrYzEueSpjMS55KSAtXHJcbiAgICAgICAgICAgIDIqKHJ5cnkqZWMueCpjMi54ICsgcnhyeCplYy55KmMyLnkpLFxyXG4gICAgICAgIDIqKHJ5cnkqYzEueCooYzAueC1lYy54KSArIHJ4cngqYzEueSooYzAueS1lYy55KSksXHJcbiAgICAgICAgcnlyeSooYzAueCpjMC54K2VjLngqZWMueCkgKyByeHJ4KihjMC55KmMwLnkgKyBlYy55KmVjLnkpIC1cclxuICAgICAgICAgICAgMioocnlyeSplYy54KmMwLnggKyByeHJ4KmVjLnkqYzAueSkgLSByeHJ4KnJ5cnlcclxuICAgICkuZ2V0Um9vdHMoKTtcclxuXHJcbiAgICBmb3IgKCB2YXIgaSA9IDA7IGkgPCByb290cy5sZW5ndGg7IGkrKyApIHtcclxuICAgICAgICB2YXIgdCA9IHJvb3RzW2ldO1xyXG5cclxuICAgICAgICBpZiAoIDAgPD0gdCAmJiB0IDw9IDEgKVxyXG4gICAgICAgICAgICByZXN1bHQucG9pbnRzLnB1c2goIGMyLm11bHRpcGx5KHQqdCkuYWRkKGMxLm11bHRpcGx5KHQpLmFkZChjMCkpICk7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKCByZXN1bHQucG9pbnRzLmxlbmd0aCA+IDAgKSByZXN1bHQuc3RhdHVzID0gXCJJbnRlcnNlY3Rpb25cIjtcclxuXHJcbiAgICByZXR1cm4gcmVzdWx0O1xyXG59O1xyXG5cclxuXHJcbi8qKlxyXG4gKiAgaW50ZXJzZWN0QmV6aWVyMkxpbmVcclxuICpcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gcDFcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gcDJcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gcDNcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gYTFcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gYTJcclxuICogIEByZXR1cm5zIHtJbnRlcnNlY3Rpb259XHJcbiAqL1xyXG5JbnRlcnNlY3Rpb24uaW50ZXJzZWN0QmV6aWVyMkxpbmUgPSBmdW5jdGlvbihwMSwgcDIsIHAzLCBhMSwgYTIpIHtcclxuICAgIHZhciBhLCBiOyAgICAgICAgICAgICAvLyB0ZW1wb3JhcnkgdmFyaWFibGVzXHJcbiAgICB2YXIgYzIsIGMxLCBjMDsgICAgICAgLy8gY29lZmZpY2llbnRzIG9mIHF1YWRyYXRpY1xyXG4gICAgdmFyIGNsOyAgICAgICAgICAgICAgIC8vIGMgY29lZmZpY2llbnQgZm9yIG5vcm1hbCBmb3JtIG9mIGxpbmVcclxuICAgIHZhciBuOyAgICAgICAgICAgICAgICAvLyBub3JtYWwgZm9yIG5vcm1hbCBmb3JtIG9mIGxpbmVcclxuICAgIHZhciBtaW4gPSBhMS5taW4oYTIpOyAvLyB1c2VkIHRvIGRldGVybWluZSBpZiBwb2ludCBpcyBvbiBsaW5lIHNlZ21lbnRcclxuICAgIHZhciBtYXggPSBhMS5tYXgoYTIpOyAvLyB1c2VkIHRvIGRldGVybWluZSBpZiBwb2ludCBpcyBvbiBsaW5lIHNlZ21lbnRcclxuICAgIHZhciByZXN1bHQgPSBuZXcgSW50ZXJzZWN0aW9uKFwiTm8gSW50ZXJzZWN0aW9uXCIpO1xyXG5cclxuICAgIGEgPSBwMi5tdWx0aXBseSgtMik7XHJcbiAgICBjMiA9IHAxLmFkZChhLmFkZChwMykpO1xyXG5cclxuICAgIGEgPSBwMS5tdWx0aXBseSgtMik7XHJcbiAgICBiID0gcDIubXVsdGlwbHkoMik7XHJcbiAgICBjMSA9IGEuYWRkKGIpO1xyXG5cclxuICAgIGMwID0gbmV3IFBvaW50MkQocDEueCwgcDEueSk7XHJcblxyXG4gICAgLy8gQ29udmVydCBsaW5lIHRvIG5vcm1hbCBmb3JtOiBheCArIGJ5ICsgYyA9IDBcclxuICAgIC8vIEZpbmQgbm9ybWFsIHRvIGxpbmU6IG5lZ2F0aXZlIGludmVyc2Ugb2Ygb3JpZ2luYWwgbGluZSdzIHNsb3BlXHJcbiAgICBuID0gbmV3IFZlY3RvcjJEKGExLnkgLSBhMi55LCBhMi54IC0gYTEueCk7XHJcblxyXG4gICAgLy8gRGV0ZXJtaW5lIG5ldyBjIGNvZWZmaWNpZW50XHJcbiAgICBjbCA9IGExLngqYTIueSAtIGEyLngqYTEueTtcclxuXHJcbiAgICAvLyBUcmFuc2Zvcm0gY3ViaWMgY29lZmZpY2llbnRzIHRvIGxpbmUncyBjb29yZGluYXRlIHN5c3RlbSBhbmQgZmluZCByb290c1xyXG4gICAgLy8gb2YgY3ViaWNcclxuICAgIHJvb3RzID0gbmV3IFBvbHlub21pYWwoXHJcbiAgICAgICAgbi5kb3QoYzIpLFxyXG4gICAgICAgIG4uZG90KGMxKSxcclxuICAgICAgICBuLmRvdChjMCkgKyBjbFxyXG4gICAgKS5nZXRSb290cygpO1xyXG5cclxuICAgIC8vIEFueSByb290cyBpbiBjbG9zZWQgaW50ZXJ2YWwgWzAsMV0gYXJlIGludGVyc2VjdGlvbnMgb24gQmV6aWVyLCBidXRcclxuICAgIC8vIG1pZ2h0IG5vdCBiZSBvbiB0aGUgbGluZSBzZWdtZW50LlxyXG4gICAgLy8gRmluZCBpbnRlcnNlY3Rpb25zIGFuZCBjYWxjdWxhdGUgcG9pbnQgY29vcmRpbmF0ZXNcclxuICAgIGZvciAoIHZhciBpID0gMDsgaSA8IHJvb3RzLmxlbmd0aDsgaSsrICkge1xyXG4gICAgICAgIHZhciB0ID0gcm9vdHNbaV07XHJcblxyXG4gICAgICAgIGlmICggMCA8PSB0ICYmIHQgPD0gMSApIHtcclxuICAgICAgICAgICAgLy8gV2UncmUgd2l0aGluIHRoZSBCZXppZXIgY3VydmVcclxuICAgICAgICAgICAgLy8gRmluZCBwb2ludCBvbiBCZXppZXJcclxuICAgICAgICAgICAgdmFyIHA0ID0gcDEubGVycChwMiwgdCk7XHJcbiAgICAgICAgICAgIHZhciBwNSA9IHAyLmxlcnAocDMsIHQpO1xyXG5cclxuICAgICAgICAgICAgdmFyIHA2ID0gcDQubGVycChwNSwgdCk7XHJcblxyXG4gICAgICAgICAgICAvLyBTZWUgaWYgcG9pbnQgaXMgb24gbGluZSBzZWdtZW50XHJcbiAgICAgICAgICAgIC8vIEhhZCB0byBtYWtlIHNwZWNpYWwgY2FzZXMgZm9yIHZlcnRpY2FsIGFuZCBob3Jpem9udGFsIGxpbmVzIGR1ZVxyXG4gICAgICAgICAgICAvLyB0byBzbGlnaHQgZXJyb3JzIGluIGNhbGN1bGF0aW9uIG9mIHA2XHJcbiAgICAgICAgICAgIGlmICggYTEueCA9PSBhMi54ICkge1xyXG4gICAgICAgICAgICAgICAgaWYgKCBtaW4ueSA8PSBwNi55ICYmIHA2LnkgPD0gbWF4LnkgKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgcmVzdWx0LnN0YXR1cyA9IFwiSW50ZXJzZWN0aW9uXCI7XHJcbiAgICAgICAgICAgICAgICAgICAgcmVzdWx0LmFwcGVuZFBvaW50KCBwNiApO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9IGVsc2UgaWYgKCBhMS55ID09IGEyLnkgKSB7XHJcbiAgICAgICAgICAgICAgICBpZiAoIG1pbi54IDw9IHA2LnggJiYgcDYueCA8PSBtYXgueCApIHtcclxuICAgICAgICAgICAgICAgICAgICByZXN1bHQuc3RhdHVzID0gXCJJbnRlcnNlY3Rpb25cIjtcclxuICAgICAgICAgICAgICAgICAgICByZXN1bHQuYXBwZW5kUG9pbnQoIHA2ICk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0gZWxzZSBpZiAobWluLnggPD0gcDYueCAmJiBwNi54IDw9IG1heC54ICYmIG1pbi55IDw9IHA2LnkgJiYgcDYueSA8PSBtYXgueSkge1xyXG4gICAgICAgICAgICAgICAgcmVzdWx0LnN0YXR1cyA9IFwiSW50ZXJzZWN0aW9uXCI7XHJcbiAgICAgICAgICAgICAgICByZXN1bHQuYXBwZW5kUG9pbnQoIHA2ICk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIHJlc3VsdDtcclxufTtcclxuXHJcblxyXG4vKipcclxuICogIGludGVyc2VjdEJlemllcjJQb2x5Z29uXHJcbiAqXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IHAxXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IHAyXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IHAzXHJcbiAqICBAcGFyYW0ge0FycmF5PFBvaW50MkQ+fSBwb2ludHNcclxuICogIEByZXR1cm5zIHtJbnRlcnNlY3Rpb259XHJcbiAqL1xyXG5JbnRlcnNlY3Rpb24uaW50ZXJzZWN0QmV6aWVyMlBvbHlnb24gPSBmdW5jdGlvbihwMSwgcDIsIHAzLCBwb2ludHMpIHtcclxuICAgIHZhciByZXN1bHQgPSBuZXcgSW50ZXJzZWN0aW9uKFwiTm8gSW50ZXJzZWN0aW9uXCIpO1xyXG4gICAgdmFyIGxlbmd0aCA9IHBvaW50cy5sZW5ndGg7XHJcblxyXG4gICAgZm9yICggdmFyIGkgPSAwOyBpIDwgbGVuZ3RoOyBpKysgKSB7XHJcbiAgICAgICAgdmFyIGExID0gcG9pbnRzW2ldO1xyXG4gICAgICAgIHZhciBhMiA9IHBvaW50c1soaSsxKSAlIGxlbmd0aF07XHJcbiAgICAgICAgdmFyIGludGVyID0gSW50ZXJzZWN0aW9uLmludGVyc2VjdEJlemllcjJMaW5lKHAxLCBwMiwgcDMsIGExLCBhMik7XHJcblxyXG4gICAgICAgIHJlc3VsdC5hcHBlbmRQb2ludHMoaW50ZXIucG9pbnRzKTtcclxuICAgIH1cclxuXHJcbiAgICBpZiAoIHJlc3VsdC5wb2ludHMubGVuZ3RoID4gMCApIHJlc3VsdC5zdGF0dXMgPSBcIkludGVyc2VjdGlvblwiO1xyXG5cclxuICAgIHJldHVybiByZXN1bHQ7XHJcbn07XHJcblxyXG5cclxuLyoqXHJcbiAqICBpbnRlcnNlY3RCZXppZXIyUmVjdGFuZ2xlXHJcbiAqXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IHAxXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IHAyXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IHAzXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IHIxXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IHIyXHJcbiAqICBAcmV0dXJucyB7SW50ZXJzZWN0aW9ufVxyXG4gKi9cclxuSW50ZXJzZWN0aW9uLmludGVyc2VjdEJlemllcjJSZWN0YW5nbGUgPSBmdW5jdGlvbihwMSwgcDIsIHAzLCByMSwgcjIpIHtcclxuICAgIHZhciBtaW4gICAgICAgID0gcjEubWluKHIyKTtcclxuICAgIHZhciBtYXggICAgICAgID0gcjEubWF4KHIyKTtcclxuICAgIHZhciB0b3BSaWdodCAgID0gbmV3IFBvaW50MkQoIG1heC54LCBtaW4ueSApO1xyXG4gICAgdmFyIGJvdHRvbUxlZnQgPSBuZXcgUG9pbnQyRCggbWluLngsIG1heC55ICk7XHJcblxyXG4gICAgdmFyIGludGVyMSA9IEludGVyc2VjdGlvbi5pbnRlcnNlY3RCZXppZXIyTGluZShwMSwgcDIsIHAzLCBtaW4sIHRvcFJpZ2h0KTtcclxuICAgIHZhciBpbnRlcjIgPSBJbnRlcnNlY3Rpb24uaW50ZXJzZWN0QmV6aWVyMkxpbmUocDEsIHAyLCBwMywgdG9wUmlnaHQsIG1heCk7XHJcbiAgICB2YXIgaW50ZXIzID0gSW50ZXJzZWN0aW9uLmludGVyc2VjdEJlemllcjJMaW5lKHAxLCBwMiwgcDMsIG1heCwgYm90dG9tTGVmdCk7XHJcbiAgICB2YXIgaW50ZXI0ID0gSW50ZXJzZWN0aW9uLmludGVyc2VjdEJlemllcjJMaW5lKHAxLCBwMiwgcDMsIGJvdHRvbUxlZnQsIG1pbik7XHJcblxyXG4gICAgdmFyIHJlc3VsdCA9IG5ldyBJbnRlcnNlY3Rpb24oXCJObyBJbnRlcnNlY3Rpb25cIik7XHJcblxyXG4gICAgcmVzdWx0LmFwcGVuZFBvaW50cyhpbnRlcjEucG9pbnRzKTtcclxuICAgIHJlc3VsdC5hcHBlbmRQb2ludHMoaW50ZXIyLnBvaW50cyk7XHJcbiAgICByZXN1bHQuYXBwZW5kUG9pbnRzKGludGVyMy5wb2ludHMpO1xyXG4gICAgcmVzdWx0LmFwcGVuZFBvaW50cyhpbnRlcjQucG9pbnRzKTtcclxuXHJcbiAgICBpZiAoIHJlc3VsdC5wb2ludHMubGVuZ3RoID4gMCApIHJlc3VsdC5zdGF0dXMgPSBcIkludGVyc2VjdGlvblwiO1xyXG5cclxuICAgIHJldHVybiByZXN1bHQ7XHJcbn07XHJcblxyXG5cclxuLyoqXHJcbiAqICBpbnRlcnNlY3RCZXppZXIzQmV6aWVyM1xyXG4gKlxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBhMVxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBhMlxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBhM1xyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBhNFxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBiMVxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBiMlxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBiM1xyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBiNFxyXG4gKiAgQHJldHVybnMge0ludGVyc2VjdGlvbn1cclxuICovXHJcbkludGVyc2VjdGlvbi5pbnRlcnNlY3RCZXppZXIzQmV6aWVyMyA9IGZ1bmN0aW9uKGExLCBhMiwgYTMsIGE0LCBiMSwgYjIsIGIzLCBiNCkge1xyXG4gICAgdmFyIGEsIGIsIGMsIGQ7ICAgICAgICAgLy8gdGVtcG9yYXJ5IHZhcmlhYmxlc1xyXG4gICAgdmFyIGMxMywgYzEyLCBjMTEsIGMxMDsgLy8gY29lZmZpY2llbnRzIG9mIGN1YmljXHJcbiAgICB2YXIgYzIzLCBjMjIsIGMyMSwgYzIwOyAvLyBjb2VmZmljaWVudHMgb2YgY3ViaWNcclxuICAgIHZhciByZXN1bHQgPSBuZXcgSW50ZXJzZWN0aW9uKFwiTm8gSW50ZXJzZWN0aW9uXCIpO1xyXG5cclxuICAgIC8vIENhbGN1bGF0ZSB0aGUgY29lZmZpY2llbnRzIG9mIGN1YmljIHBvbHlub21pYWxcclxuICAgIGEgPSBhMS5tdWx0aXBseSgtMSk7XHJcbiAgICBiID0gYTIubXVsdGlwbHkoMyk7XHJcbiAgICBjID0gYTMubXVsdGlwbHkoLTMpO1xyXG4gICAgZCA9IGEuYWRkKGIuYWRkKGMuYWRkKGE0KSkpO1xyXG4gICAgYzEzID0gbmV3IFZlY3RvcjJEKGQueCwgZC55KTtcclxuXHJcbiAgICBhID0gYTEubXVsdGlwbHkoMyk7XHJcbiAgICBiID0gYTIubXVsdGlwbHkoLTYpO1xyXG4gICAgYyA9IGEzLm11bHRpcGx5KDMpO1xyXG4gICAgZCA9IGEuYWRkKGIuYWRkKGMpKTtcclxuICAgIGMxMiA9IG5ldyBWZWN0b3IyRChkLngsIGQueSk7XHJcblxyXG4gICAgYSA9IGExLm11bHRpcGx5KC0zKTtcclxuICAgIGIgPSBhMi5tdWx0aXBseSgzKTtcclxuICAgIGMgPSBhLmFkZChiKTtcclxuICAgIGMxMSA9IG5ldyBWZWN0b3IyRChjLngsIGMueSk7XHJcblxyXG4gICAgYzEwID0gbmV3IFZlY3RvcjJEKGExLngsIGExLnkpO1xyXG5cclxuICAgIGEgPSBiMS5tdWx0aXBseSgtMSk7XHJcbiAgICBiID0gYjIubXVsdGlwbHkoMyk7XHJcbiAgICBjID0gYjMubXVsdGlwbHkoLTMpO1xyXG4gICAgZCA9IGEuYWRkKGIuYWRkKGMuYWRkKGI0KSkpO1xyXG4gICAgYzIzID0gbmV3IFZlY3RvcjJEKGQueCwgZC55KTtcclxuXHJcbiAgICBhID0gYjEubXVsdGlwbHkoMyk7XHJcbiAgICBiID0gYjIubXVsdGlwbHkoLTYpO1xyXG4gICAgYyA9IGIzLm11bHRpcGx5KDMpO1xyXG4gICAgZCA9IGEuYWRkKGIuYWRkKGMpKTtcclxuICAgIGMyMiA9IG5ldyBWZWN0b3IyRChkLngsIGQueSk7XHJcblxyXG4gICAgYSA9IGIxLm11bHRpcGx5KC0zKTtcclxuICAgIGIgPSBiMi5tdWx0aXBseSgzKTtcclxuICAgIGMgPSBhLmFkZChiKTtcclxuICAgIGMyMSA9IG5ldyBWZWN0b3IyRChjLngsIGMueSk7XHJcblxyXG4gICAgYzIwID0gbmV3IFZlY3RvcjJEKGIxLngsIGIxLnkpO1xyXG5cclxuICAgIHZhciBjMTB4MiA9IGMxMC54KmMxMC54O1xyXG4gICAgdmFyIGMxMHgzID0gYzEwLngqYzEwLngqYzEwLng7XHJcbiAgICB2YXIgYzEweTIgPSBjMTAueSpjMTAueTtcclxuICAgIHZhciBjMTB5MyA9IGMxMC55KmMxMC55KmMxMC55O1xyXG4gICAgdmFyIGMxMXgyID0gYzExLngqYzExLng7XHJcbiAgICB2YXIgYzExeDMgPSBjMTEueCpjMTEueCpjMTEueDtcclxuICAgIHZhciBjMTF5MiA9IGMxMS55KmMxMS55O1xyXG4gICAgdmFyIGMxMXkzID0gYzExLnkqYzExLnkqYzExLnk7XHJcbiAgICB2YXIgYzEyeDIgPSBjMTIueCpjMTIueDtcclxuICAgIHZhciBjMTJ4MyA9IGMxMi54KmMxMi54KmMxMi54O1xyXG4gICAgdmFyIGMxMnkyID0gYzEyLnkqYzEyLnk7XHJcbiAgICB2YXIgYzEyeTMgPSBjMTIueSpjMTIueSpjMTIueTtcclxuICAgIHZhciBjMTN4MiA9IGMxMy54KmMxMy54O1xyXG4gICAgdmFyIGMxM3gzID0gYzEzLngqYzEzLngqYzEzLng7XHJcbiAgICB2YXIgYzEzeTIgPSBjMTMueSpjMTMueTtcclxuICAgIHZhciBjMTN5MyA9IGMxMy55KmMxMy55KmMxMy55O1xyXG4gICAgdmFyIGMyMHgyID0gYzIwLngqYzIwLng7XHJcbiAgICB2YXIgYzIweDMgPSBjMjAueCpjMjAueCpjMjAueDtcclxuICAgIHZhciBjMjB5MiA9IGMyMC55KmMyMC55O1xyXG4gICAgdmFyIGMyMHkzID0gYzIwLnkqYzIwLnkqYzIwLnk7XHJcbiAgICB2YXIgYzIxeDIgPSBjMjEueCpjMjEueDtcclxuICAgIHZhciBjMjF4MyA9IGMyMS54KmMyMS54KmMyMS54O1xyXG4gICAgdmFyIGMyMXkyID0gYzIxLnkqYzIxLnk7XHJcbiAgICB2YXIgYzIyeDIgPSBjMjIueCpjMjIueDtcclxuICAgIHZhciBjMjJ4MyA9IGMyMi54KmMyMi54KmMyMi54O1xyXG4gICAgdmFyIGMyMnkyID0gYzIyLnkqYzIyLnk7XHJcbiAgICB2YXIgYzIzeDIgPSBjMjMueCpjMjMueDtcclxuICAgIHZhciBjMjN4MyA9IGMyMy54KmMyMy54KmMyMy54O1xyXG4gICAgdmFyIGMyM3kyID0gYzIzLnkqYzIzLnk7XHJcbiAgICB2YXIgYzIzeTMgPSBjMjMueSpjMjMueSpjMjMueTtcclxuICAgIHZhciBwb2x5ID0gbmV3IFBvbHlub21pYWwoXHJcbiAgICAgICAgLWMxM3gzKmMyM3kzICsgYzEzeTMqYzIzeDMgLSAzKmMxMy54KmMxM3kyKmMyM3gyKmMyMy55ICtcclxuICAgICAgICAgICAgMypjMTN4MipjMTMueSpjMjMueCpjMjN5MixcclxuICAgICAgICAtNipjMTMueCpjMjIueCpjMTN5MipjMjMueCpjMjMueSArIDYqYzEzeDIqYzEzLnkqYzIyLnkqYzIzLngqYzIzLnkgKyAzKmMyMi54KmMxM3kzKmMyM3gyIC1cclxuICAgICAgICAgICAgMypjMTN4MypjMjIueSpjMjN5MiAtIDMqYzEzLngqYzEzeTIqYzIyLnkqYzIzeDIgKyAzKmMxM3gyKmMyMi54KmMxMy55KmMyM3kyLFxyXG4gICAgICAgIC02KmMyMS54KmMxMy54KmMxM3kyKmMyMy54KmMyMy55IC0gNipjMTMueCpjMjIueCpjMTN5MipjMjIueSpjMjMueCArIDYqYzEzeDIqYzIyLngqYzEzLnkqYzIyLnkqYzIzLnkgK1xyXG4gICAgICAgICAgICAzKmMyMS54KmMxM3kzKmMyM3gyICsgMypjMjJ4MipjMTN5MypjMjMueCArIDMqYzIxLngqYzEzeDIqYzEzLnkqYzIzeTIgLSAzKmMxMy54KmMyMS55KmMxM3kyKmMyM3gyIC1cclxuICAgICAgICAgICAgMypjMTMueCpjMjJ4MipjMTN5MipjMjMueSArIGMxM3gyKmMxMy55KmMyMy54Kig2KmMyMS55KmMyMy55ICsgMypjMjJ5MikgKyBjMTN4MyooLWMyMS55KmMyM3kyIC1cclxuICAgICAgICAgICAgMipjMjJ5MipjMjMueSAtIGMyMy55KigyKmMyMS55KmMyMy55ICsgYzIyeTIpKSxcclxuICAgICAgICBjMTEueCpjMTIueSpjMTMueCpjMTMueSpjMjMueCpjMjMueSAtIGMxMS55KmMxMi54KmMxMy54KmMxMy55KmMyMy54KmMyMy55ICsgNipjMjEueCpjMjIueCpjMTN5MypjMjMueCArXHJcbiAgICAgICAgICAgIDMqYzExLngqYzEyLngqYzEzLngqYzEzLnkqYzIzeTIgKyA2KmMxMC54KmMxMy54KmMxM3kyKmMyMy54KmMyMy55IC0gMypjMTEueCpjMTIueCpjMTN5MipjMjMueCpjMjMueSAtXHJcbiAgICAgICAgICAgIDMqYzExLnkqYzEyLnkqYzEzLngqYzEzLnkqYzIzeDIgLSA2KmMxMC55KmMxM3gyKmMxMy55KmMyMy54KmMyMy55IC0gNipjMjAueCpjMTMueCpjMTN5MipjMjMueCpjMjMueSArXHJcbiAgICAgICAgICAgIDMqYzExLnkqYzEyLnkqYzEzeDIqYzIzLngqYzIzLnkgLSAyKmMxMi54KmMxMnkyKmMxMy54KmMyMy54KmMyMy55IC0gNipjMjEueCpjMTMueCpjMjIueCpjMTN5MipjMjMueSAtXHJcbiAgICAgICAgICAgIDYqYzIxLngqYzEzLngqYzEzeTIqYzIyLnkqYzIzLnggLSA2KmMxMy54KmMyMS55KmMyMi54KmMxM3kyKmMyMy54ICsgNipjMjEueCpjMTN4MipjMTMueSpjMjIueSpjMjMueSArXHJcbiAgICAgICAgICAgIDIqYzEyeDIqYzEyLnkqYzEzLnkqYzIzLngqYzIzLnkgKyBjMjJ4MypjMTN5MyAtIDMqYzEwLngqYzEzeTMqYzIzeDIgKyAzKmMxMC55KmMxM3gzKmMyM3kyICtcclxuICAgICAgICAgICAgMypjMjAueCpjMTN5MypjMjN4MiArIGMxMnkzKmMxMy54KmMyM3gyIC0gYzEyeDMqYzEzLnkqYzIzeTIgLSAzKmMxMC54KmMxM3gyKmMxMy55KmMyM3kyICtcclxuICAgICAgICAgICAgMypjMTAueSpjMTMueCpjMTN5MipjMjN4MiAtIDIqYzExLngqYzEyLnkqYzEzeDIqYzIzeTIgKyBjMTEueCpjMTIueSpjMTN5MipjMjN4MiAtIGMxMS55KmMxMi54KmMxM3gyKmMyM3kyICtcclxuICAgICAgICAgICAgMipjMTEueSpjMTIueCpjMTN5MipjMjN4MiArIDMqYzIwLngqYzEzeDIqYzEzLnkqYzIzeTIgLSBjMTIueCpjMTJ5MipjMTMueSpjMjN4MiAtXHJcbiAgICAgICAgICAgIDMqYzIwLnkqYzEzLngqYzEzeTIqYzIzeDIgKyBjMTJ4MipjMTIueSpjMTMueCpjMjN5MiAtIDMqYzEzLngqYzIyeDIqYzEzeTIqYzIyLnkgK1xyXG4gICAgICAgICAgICBjMTN4MipjMTMueSpjMjMueCooNipjMjAueSpjMjMueSArIDYqYzIxLnkqYzIyLnkpICsgYzEzeDIqYzIyLngqYzEzLnkqKDYqYzIxLnkqYzIzLnkgKyAzKmMyMnkyKSArXHJcbiAgICAgICAgICAgIGMxM3gzKigtMipjMjEueSpjMjIueSpjMjMueSAtIGMyMC55KmMyM3kyIC0gYzIyLnkqKDIqYzIxLnkqYzIzLnkgKyBjMjJ5MikgLSBjMjMueSooMipjMjAueSpjMjMueSArIDIqYzIxLnkqYzIyLnkpKSxcclxuICAgICAgICA2KmMxMS54KmMxMi54KmMxMy54KmMxMy55KmMyMi55KmMyMy55ICsgYzExLngqYzEyLnkqYzEzLngqYzIyLngqYzEzLnkqYzIzLnkgKyBjMTEueCpjMTIueSpjMTMueCpjMTMueSpjMjIueSpjMjMueCAtXHJcbiAgICAgICAgICAgIGMxMS55KmMxMi54KmMxMy54KmMyMi54KmMxMy55KmMyMy55IC0gYzExLnkqYzEyLngqYzEzLngqYzEzLnkqYzIyLnkqYzIzLnggLSA2KmMxMS55KmMxMi55KmMxMy54KmMyMi54KmMxMy55KmMyMy54IC1cclxuICAgICAgICAgICAgNipjMTAueCpjMjIueCpjMTN5MypjMjMueCArIDYqYzIwLngqYzIyLngqYzEzeTMqYzIzLnggKyA2KmMxMC55KmMxM3gzKmMyMi55KmMyMy55ICsgMipjMTJ5MypjMTMueCpjMjIueCpjMjMueCAtXHJcbiAgICAgICAgICAgIDIqYzEyeDMqYzEzLnkqYzIyLnkqYzIzLnkgKyA2KmMxMC54KmMxMy54KmMyMi54KmMxM3kyKmMyMy55ICsgNipjMTAueCpjMTMueCpjMTN5MipjMjIueSpjMjMueCArXHJcbiAgICAgICAgICAgIDYqYzEwLnkqYzEzLngqYzIyLngqYzEzeTIqYzIzLnggLSAzKmMxMS54KmMxMi54KmMyMi54KmMxM3kyKmMyMy55IC0gMypjMTEueCpjMTIueCpjMTN5MipjMjIueSpjMjMueCArXHJcbiAgICAgICAgICAgIDIqYzExLngqYzEyLnkqYzIyLngqYzEzeTIqYzIzLnggKyA0KmMxMS55KmMxMi54KmMyMi54KmMxM3kyKmMyMy54IC0gNipjMTAueCpjMTN4MipjMTMueSpjMjIueSpjMjMueSAtXHJcbiAgICAgICAgICAgIDYqYzEwLnkqYzEzeDIqYzIyLngqYzEzLnkqYzIzLnkgLSA2KmMxMC55KmMxM3gyKmMxMy55KmMyMi55KmMyMy54IC0gNCpjMTEueCpjMTIueSpjMTN4MipjMjIueSpjMjMueSAtXHJcbiAgICAgICAgICAgIDYqYzIwLngqYzEzLngqYzIyLngqYzEzeTIqYzIzLnkgLSA2KmMyMC54KmMxMy54KmMxM3kyKmMyMi55KmMyMy54IC0gMipjMTEueSpjMTIueCpjMTN4MipjMjIueSpjMjMueSArXHJcbiAgICAgICAgICAgIDMqYzExLnkqYzEyLnkqYzEzeDIqYzIyLngqYzIzLnkgKyAzKmMxMS55KmMxMi55KmMxM3gyKmMyMi55KmMyMy54IC0gMipjMTIueCpjMTJ5MipjMTMueCpjMjIueCpjMjMueSAtXHJcbiAgICAgICAgICAgIDIqYzEyLngqYzEyeTIqYzEzLngqYzIyLnkqYzIzLnggLSAyKmMxMi54KmMxMnkyKmMyMi54KmMxMy55KmMyMy54IC0gNipjMjAueSpjMTMueCpjMjIueCpjMTN5MipjMjMueCAtXHJcbiAgICAgICAgICAgIDYqYzIxLngqYzEzLngqYzIxLnkqYzEzeTIqYzIzLnggLSA2KmMyMS54KmMxMy54KmMyMi54KmMxM3kyKmMyMi55ICsgNipjMjAueCpjMTN4MipjMTMueSpjMjIueSpjMjMueSArXHJcbiAgICAgICAgICAgIDIqYzEyeDIqYzEyLnkqYzEzLngqYzIyLnkqYzIzLnkgKyAyKmMxMngyKmMxMi55KmMyMi54KmMxMy55KmMyMy55ICsgMipjMTJ4MipjMTIueSpjMTMueSpjMjIueSpjMjMueCArXHJcbiAgICAgICAgICAgIDMqYzIxLngqYzIyeDIqYzEzeTMgKyAzKmMyMXgyKmMxM3kzKmMyMy54IC0gMypjMTMueCpjMjEueSpjMjJ4MipjMTN5MiAtIDMqYzIxeDIqYzEzLngqYzEzeTIqYzIzLnkgK1xyXG4gICAgICAgICAgICBjMTN4MipjMjIueCpjMTMueSooNipjMjAueSpjMjMueSArIDYqYzIxLnkqYzIyLnkpICsgYzEzeDIqYzEzLnkqYzIzLngqKDYqYzIwLnkqYzIyLnkgKyAzKmMyMXkyKSArXHJcbiAgICAgICAgICAgIGMyMS54KmMxM3gyKmMxMy55Kig2KmMyMS55KmMyMy55ICsgMypjMjJ5MikgKyBjMTN4MyooLTIqYzIwLnkqYzIyLnkqYzIzLnkgLSBjMjMueSooMipjMjAueSpjMjIueSArIGMyMXkyKSAtXHJcbiAgICAgICAgICAgIGMyMS55KigyKmMyMS55KmMyMy55ICsgYzIyeTIpIC0gYzIyLnkqKDIqYzIwLnkqYzIzLnkgKyAyKmMyMS55KmMyMi55KSksXHJcbiAgICAgICAgYzExLngqYzIxLngqYzEyLnkqYzEzLngqYzEzLnkqYzIzLnkgKyBjMTEueCpjMTIueSpjMTMueCpjMjEueSpjMTMueSpjMjMueCArIGMxMS54KmMxMi55KmMxMy54KmMyMi54KmMxMy55KmMyMi55IC1cclxuICAgICAgICAgICAgYzExLnkqYzEyLngqYzIxLngqYzEzLngqYzEzLnkqYzIzLnkgLSBjMTEueSpjMTIueCpjMTMueCpjMjEueSpjMTMueSpjMjMueCAtIGMxMS55KmMxMi54KmMxMy54KmMyMi54KmMxMy55KmMyMi55IC1cclxuICAgICAgICAgICAgNipjMTEueSpjMjEueCpjMTIueSpjMTMueCpjMTMueSpjMjMueCAtIDYqYzEwLngqYzIxLngqYzEzeTMqYzIzLnggKyA2KmMyMC54KmMyMS54KmMxM3kzKmMyMy54ICtcclxuICAgICAgICAgICAgMipjMjEueCpjMTJ5MypjMTMueCpjMjMueCArIDYqYzEwLngqYzIxLngqYzEzLngqYzEzeTIqYzIzLnkgKyA2KmMxMC54KmMxMy54KmMyMS55KmMxM3kyKmMyMy54ICtcclxuICAgICAgICAgICAgNipjMTAueCpjMTMueCpjMjIueCpjMTN5MipjMjIueSArIDYqYzEwLnkqYzIxLngqYzEzLngqYzEzeTIqYzIzLnggLSAzKmMxMS54KmMxMi54KmMyMS54KmMxM3kyKmMyMy55IC1cclxuICAgICAgICAgICAgMypjMTEueCpjMTIueCpjMjEueSpjMTN5MipjMjMueCAtIDMqYzExLngqYzEyLngqYzIyLngqYzEzeTIqYzIyLnkgKyAyKmMxMS54KmMyMS54KmMxMi55KmMxM3kyKmMyMy54ICtcclxuICAgICAgICAgICAgNCpjMTEueSpjMTIueCpjMjEueCpjMTN5MipjMjMueCAtIDYqYzEwLnkqYzIxLngqYzEzeDIqYzEzLnkqYzIzLnkgLSA2KmMxMC55KmMxM3gyKmMyMS55KmMxMy55KmMyMy54IC1cclxuICAgICAgICAgICAgNipjMTAueSpjMTN4MipjMjIueCpjMTMueSpjMjIueSAtIDYqYzIwLngqYzIxLngqYzEzLngqYzEzeTIqYzIzLnkgLSA2KmMyMC54KmMxMy54KmMyMS55KmMxM3kyKmMyMy54IC1cclxuICAgICAgICAgICAgNipjMjAueCpjMTMueCpjMjIueCpjMTN5MipjMjIueSArIDMqYzExLnkqYzIxLngqYzEyLnkqYzEzeDIqYzIzLnkgLSAzKmMxMS55KmMxMi55KmMxMy54KmMyMngyKmMxMy55ICtcclxuICAgICAgICAgICAgMypjMTEueSpjMTIueSpjMTN4MipjMjEueSpjMjMueCArIDMqYzExLnkqYzEyLnkqYzEzeDIqYzIyLngqYzIyLnkgLSAyKmMxMi54KmMyMS54KmMxMnkyKmMxMy54KmMyMy55IC1cclxuICAgICAgICAgICAgMipjMTIueCpjMjEueCpjMTJ5MipjMTMueSpjMjMueCAtIDIqYzEyLngqYzEyeTIqYzEzLngqYzIxLnkqYzIzLnggLSAyKmMxMi54KmMxMnkyKmMxMy54KmMyMi54KmMyMi55IC1cclxuICAgICAgICAgICAgNipjMjAueSpjMjEueCpjMTMueCpjMTN5MipjMjMueCAtIDYqYzIxLngqYzEzLngqYzIxLnkqYzIyLngqYzEzeTIgKyA2KmMyMC55KmMxM3gyKmMyMS55KmMxMy55KmMyMy54ICtcclxuICAgICAgICAgICAgMipjMTJ4MipjMjEueCpjMTIueSpjMTMueSpjMjMueSArIDIqYzEyeDIqYzEyLnkqYzIxLnkqYzEzLnkqYzIzLnggKyAyKmMxMngyKmMxMi55KmMyMi54KmMxMy55KmMyMi55IC1cclxuICAgICAgICAgICAgMypjMTAueCpjMjJ4MipjMTN5MyArIDMqYzIwLngqYzIyeDIqYzEzeTMgKyAzKmMyMXgyKmMyMi54KmMxM3kzICsgYzEyeTMqYzEzLngqYzIyeDIgK1xyXG4gICAgICAgICAgICAzKmMxMC55KmMxMy54KmMyMngyKmMxM3kyICsgYzExLngqYzEyLnkqYzIyeDIqYzEzeTIgKyAyKmMxMS55KmMxMi54KmMyMngyKmMxM3kyIC1cclxuICAgICAgICAgICAgYzEyLngqYzEyeTIqYzIyeDIqYzEzLnkgLSAzKmMyMC55KmMxMy54KmMyMngyKmMxM3kyIC0gMypjMjF4MipjMTMueCpjMTN5MipjMjIueSArXHJcbiAgICAgICAgICAgIGMxMngyKmMxMi55KmMxMy54KigyKmMyMS55KmMyMy55ICsgYzIyeTIpICsgYzExLngqYzEyLngqYzEzLngqYzEzLnkqKDYqYzIxLnkqYzIzLnkgKyAzKmMyMnkyKSArXHJcbiAgICAgICAgICAgIGMyMS54KmMxM3gyKmMxMy55Kig2KmMyMC55KmMyMy55ICsgNipjMjEueSpjMjIueSkgKyBjMTJ4MypjMTMueSooLTIqYzIxLnkqYzIzLnkgLSBjMjJ5MikgK1xyXG4gICAgICAgICAgICBjMTAueSpjMTN4MyooNipjMjEueSpjMjMueSArIDMqYzIyeTIpICsgYzExLnkqYzEyLngqYzEzeDIqKC0yKmMyMS55KmMyMy55IC0gYzIyeTIpICtcclxuICAgICAgICAgICAgYzExLngqYzEyLnkqYzEzeDIqKC00KmMyMS55KmMyMy55IC0gMipjMjJ5MikgKyBjMTAueCpjMTN4MipjMTMueSooLTYqYzIxLnkqYzIzLnkgLSAzKmMyMnkyKSArXHJcbiAgICAgICAgICAgIGMxM3gyKmMyMi54KmMxMy55Kig2KmMyMC55KmMyMi55ICsgMypjMjF5MikgKyBjMjAueCpjMTN4MipjMTMueSooNipjMjEueSpjMjMueSArIDMqYzIyeTIpICtcclxuICAgICAgICAgICAgYzEzeDMqKC0yKmMyMC55KmMyMS55KmMyMy55IC0gYzIyLnkqKDIqYzIwLnkqYzIyLnkgKyBjMjF5MikgLSBjMjAueSooMipjMjEueSpjMjMueSArIGMyMnkyKSAtXHJcbiAgICAgICAgICAgIGMyMS55KigyKmMyMC55KmMyMy55ICsgMipjMjEueSpjMjIueSkpLFxyXG4gICAgICAgIC1jMTAueCpjMTEueCpjMTIueSpjMTMueCpjMTMueSpjMjMueSArIGMxMC54KmMxMS55KmMxMi54KmMxMy54KmMxMy55KmMyMy55ICsgNipjMTAueCpjMTEueSpjMTIueSpjMTMueCpjMTMueSpjMjMueCAtXHJcbiAgICAgICAgICAgIDYqYzEwLnkqYzExLngqYzEyLngqYzEzLngqYzEzLnkqYzIzLnkgLSBjMTAueSpjMTEueCpjMTIueSpjMTMueCpjMTMueSpjMjMueCArIGMxMC55KmMxMS55KmMxMi54KmMxMy54KmMxMy55KmMyMy54ICtcclxuICAgICAgICAgICAgYzExLngqYzExLnkqYzEyLngqYzEyLnkqYzEzLngqYzIzLnkgLSBjMTEueCpjMTEueSpjMTIueCpjMTIueSpjMTMueSpjMjMueCArIGMxMS54KmMyMC54KmMxMi55KmMxMy54KmMxMy55KmMyMy55ICtcclxuICAgICAgICAgICAgYzExLngqYzIwLnkqYzEyLnkqYzEzLngqYzEzLnkqYzIzLnggKyBjMTEueCpjMjEueCpjMTIueSpjMTMueCpjMTMueSpjMjIueSArIGMxMS54KmMxMi55KmMxMy54KmMyMS55KmMyMi54KmMxMy55IC1cclxuICAgICAgICAgICAgYzIwLngqYzExLnkqYzEyLngqYzEzLngqYzEzLnkqYzIzLnkgLSA2KmMyMC54KmMxMS55KmMxMi55KmMxMy54KmMxMy55KmMyMy54IC0gYzExLnkqYzEyLngqYzIwLnkqYzEzLngqYzEzLnkqYzIzLnggLVxyXG4gICAgICAgICAgICBjMTEueSpjMTIueCpjMjEueCpjMTMueCpjMTMueSpjMjIueSAtIGMxMS55KmMxMi54KmMxMy54KmMyMS55KmMyMi54KmMxMy55IC0gNipjMTEueSpjMjEueCpjMTIueSpjMTMueCpjMjIueCpjMTMueSAtXHJcbiAgICAgICAgICAgIDYqYzEwLngqYzIwLngqYzEzeTMqYzIzLnggLSA2KmMxMC54KmMyMS54KmMyMi54KmMxM3kzIC0gMipjMTAueCpjMTJ5MypjMTMueCpjMjMueCArIDYqYzIwLngqYzIxLngqYzIyLngqYzEzeTMgK1xyXG4gICAgICAgICAgICAyKmMyMC54KmMxMnkzKmMxMy54KmMyMy54ICsgMipjMjEueCpjMTJ5MypjMTMueCpjMjIueCArIDIqYzEwLnkqYzEyeDMqYzEzLnkqYzIzLnkgLSA2KmMxMC54KmMxMC55KmMxMy54KmMxM3kyKmMyMy54ICtcclxuICAgICAgICAgICAgMypjMTAueCpjMTEueCpjMTIueCpjMTN5MipjMjMueSAtIDIqYzEwLngqYzExLngqYzEyLnkqYzEzeTIqYzIzLnggLSA0KmMxMC54KmMxMS55KmMxMi54KmMxM3kyKmMyMy54ICtcclxuICAgICAgICAgICAgMypjMTAueSpjMTEueCpjMTIueCpjMTN5MipjMjMueCArIDYqYzEwLngqYzEwLnkqYzEzeDIqYzEzLnkqYzIzLnkgKyA2KmMxMC54KmMyMC54KmMxMy54KmMxM3kyKmMyMy55IC1cclxuICAgICAgICAgICAgMypjMTAueCpjMTEueSpjMTIueSpjMTN4MipjMjMueSArIDIqYzEwLngqYzEyLngqYzEyeTIqYzEzLngqYzIzLnkgKyAyKmMxMC54KmMxMi54KmMxMnkyKmMxMy55KmMyMy54ICtcclxuICAgICAgICAgICAgNipjMTAueCpjMjAueSpjMTMueCpjMTN5MipjMjMueCArIDYqYzEwLngqYzIxLngqYzEzLngqYzEzeTIqYzIyLnkgKyA2KmMxMC54KmMxMy54KmMyMS55KmMyMi54KmMxM3kyICtcclxuICAgICAgICAgICAgNCpjMTAueSpjMTEueCpjMTIueSpjMTN4MipjMjMueSArIDYqYzEwLnkqYzIwLngqYzEzLngqYzEzeTIqYzIzLnggKyAyKmMxMC55KmMxMS55KmMxMi54KmMxM3gyKmMyMy55IC1cclxuICAgICAgICAgICAgMypjMTAueSpjMTEueSpjMTIueSpjMTN4MipjMjMueCArIDIqYzEwLnkqYzEyLngqYzEyeTIqYzEzLngqYzIzLnggKyA2KmMxMC55KmMyMS54KmMxMy54KmMyMi54KmMxM3kyIC1cclxuICAgICAgICAgICAgMypjMTEueCpjMjAueCpjMTIueCpjMTN5MipjMjMueSArIDIqYzExLngqYzIwLngqYzEyLnkqYzEzeTIqYzIzLnggKyBjMTEueCpjMTEueSpjMTJ5MipjMTMueCpjMjMueCAtXHJcbiAgICAgICAgICAgIDMqYzExLngqYzEyLngqYzIwLnkqYzEzeTIqYzIzLnggLSAzKmMxMS54KmMxMi54KmMyMS54KmMxM3kyKmMyMi55IC0gMypjMTEueCpjMTIueCpjMjEueSpjMjIueCpjMTN5MiArXHJcbiAgICAgICAgICAgIDIqYzExLngqYzIxLngqYzEyLnkqYzIyLngqYzEzeTIgKyA0KmMyMC54KmMxMS55KmMxMi54KmMxM3kyKmMyMy54ICsgNCpjMTEueSpjMTIueCpjMjEueCpjMjIueCpjMTN5MiAtXHJcbiAgICAgICAgICAgIDIqYzEwLngqYzEyeDIqYzEyLnkqYzEzLnkqYzIzLnkgLSA2KmMxMC55KmMyMC54KmMxM3gyKmMxMy55KmMyMy55IC0gNipjMTAueSpjMjAueSpjMTN4MipjMTMueSpjMjMueCAtXHJcbiAgICAgICAgICAgIDYqYzEwLnkqYzIxLngqYzEzeDIqYzEzLnkqYzIyLnkgLSAyKmMxMC55KmMxMngyKmMxMi55KmMxMy54KmMyMy55IC0gMipjMTAueSpjMTJ4MipjMTIueSpjMTMueSpjMjMueCAtXHJcbiAgICAgICAgICAgIDYqYzEwLnkqYzEzeDIqYzIxLnkqYzIyLngqYzEzLnkgLSBjMTEueCpjMTEueSpjMTJ4MipjMTMueSpjMjMueSAtIDIqYzExLngqYzExeTIqYzEzLngqYzEzLnkqYzIzLnggK1xyXG4gICAgICAgICAgICAzKmMyMC54KmMxMS55KmMxMi55KmMxM3gyKmMyMy55IC0gMipjMjAueCpjMTIueCpjMTJ5MipjMTMueCpjMjMueSAtIDIqYzIwLngqYzEyLngqYzEyeTIqYzEzLnkqYzIzLnggLVxyXG4gICAgICAgICAgICA2KmMyMC54KmMyMC55KmMxMy54KmMxM3kyKmMyMy54IC0gNipjMjAueCpjMjEueCpjMTMueCpjMTN5MipjMjIueSAtIDYqYzIwLngqYzEzLngqYzIxLnkqYzIyLngqYzEzeTIgK1xyXG4gICAgICAgICAgICAzKmMxMS55KmMyMC55KmMxMi55KmMxM3gyKmMyMy54ICsgMypjMTEueSpjMjEueCpjMTIueSpjMTN4MipjMjIueSArIDMqYzExLnkqYzEyLnkqYzEzeDIqYzIxLnkqYzIyLnggLVxyXG4gICAgICAgICAgICAyKmMxMi54KmMyMC55KmMxMnkyKmMxMy54KmMyMy54IC0gMipjMTIueCpjMjEueCpjMTJ5MipjMTMueCpjMjIueSAtIDIqYzEyLngqYzIxLngqYzEyeTIqYzIyLngqYzEzLnkgLVxyXG4gICAgICAgICAgICAyKmMxMi54KmMxMnkyKmMxMy54KmMyMS55KmMyMi54IC0gNipjMjAueSpjMjEueCpjMTMueCpjMjIueCpjMTN5MiAtIGMxMXkyKmMxMi54KmMxMi55KmMxMy54KmMyMy54ICtcclxuICAgICAgICAgICAgMipjMjAueCpjMTJ4MipjMTIueSpjMTMueSpjMjMueSArIDYqYzIwLnkqYzEzeDIqYzIxLnkqYzIyLngqYzEzLnkgKyAyKmMxMXgyKmMxMS55KmMxMy54KmMxMy55KmMyMy55ICtcclxuICAgICAgICAgICAgYzExeDIqYzEyLngqYzEyLnkqYzEzLnkqYzIzLnkgKyAyKmMxMngyKmMyMC55KmMxMi55KmMxMy55KmMyMy54ICsgMipjMTJ4MipjMjEueCpjMTIueSpjMTMueSpjMjIueSArXHJcbiAgICAgICAgICAgIDIqYzEyeDIqYzEyLnkqYzIxLnkqYzIyLngqYzEzLnkgKyBjMjF4MypjMTN5MyArIDMqYzEweDIqYzEzeTMqYzIzLnggLSAzKmMxMHkyKmMxM3gzKmMyMy55ICtcclxuICAgICAgICAgICAgMypjMjB4MipjMTN5MypjMjMueCArIGMxMXkzKmMxM3gyKmMyMy54IC0gYzExeDMqYzEzeTIqYzIzLnkgLSBjMTEueCpjMTF5MipjMTN4MipjMjMueSArXHJcbiAgICAgICAgICAgIGMxMXgyKmMxMS55KmMxM3kyKmMyMy54IC0gMypjMTB4MipjMTMueCpjMTN5MipjMjMueSArIDMqYzEweTIqYzEzeDIqYzEzLnkqYzIzLnggLSBjMTF4MipjMTJ5MipjMTMueCpjMjMueSArXHJcbiAgICAgICAgICAgIGMxMXkyKmMxMngyKmMxMy55KmMyMy54IC0gMypjMjF4MipjMTMueCpjMjEueSpjMTN5MiAtIDMqYzIweDIqYzEzLngqYzEzeTIqYzIzLnkgKyAzKmMyMHkyKmMxM3gyKmMxMy55KmMyMy54ICtcclxuICAgICAgICAgICAgYzExLngqYzEyLngqYzEzLngqYzEzLnkqKDYqYzIwLnkqYzIzLnkgKyA2KmMyMS55KmMyMi55KSArIGMxMngzKmMxMy55KigtMipjMjAueSpjMjMueSAtIDIqYzIxLnkqYzIyLnkpICtcclxuICAgICAgICAgICAgYzEwLnkqYzEzeDMqKDYqYzIwLnkqYzIzLnkgKyA2KmMyMS55KmMyMi55KSArIGMxMS55KmMxMi54KmMxM3gyKigtMipjMjAueSpjMjMueSAtIDIqYzIxLnkqYzIyLnkpICtcclxuICAgICAgICAgICAgYzEyeDIqYzEyLnkqYzEzLngqKDIqYzIwLnkqYzIzLnkgKyAyKmMyMS55KmMyMi55KSArIGMxMS54KmMxMi55KmMxM3gyKigtNCpjMjAueSpjMjMueSAtIDQqYzIxLnkqYzIyLnkpICtcclxuICAgICAgICAgICAgYzEwLngqYzEzeDIqYzEzLnkqKC02KmMyMC55KmMyMy55IC0gNipjMjEueSpjMjIueSkgKyBjMjAueCpjMTN4MipjMTMueSooNipjMjAueSpjMjMueSArIDYqYzIxLnkqYzIyLnkpICtcclxuICAgICAgICAgICAgYzIxLngqYzEzeDIqYzEzLnkqKDYqYzIwLnkqYzIyLnkgKyAzKmMyMXkyKSArIGMxM3gzKigtMipjMjAueSpjMjEueSpjMjIueSAtIGMyMHkyKmMyMy55IC1cclxuICAgICAgICAgICAgYzIxLnkqKDIqYzIwLnkqYzIyLnkgKyBjMjF5MikgLSBjMjAueSooMipjMjAueSpjMjMueSArIDIqYzIxLnkqYzIyLnkpKSxcclxuICAgICAgICAtYzEwLngqYzExLngqYzEyLnkqYzEzLngqYzEzLnkqYzIyLnkgKyBjMTAueCpjMTEueSpjMTIueCpjMTMueCpjMTMueSpjMjIueSArIDYqYzEwLngqYzExLnkqYzEyLnkqYzEzLngqYzIyLngqYzEzLnkgLVxyXG4gICAgICAgICAgICA2KmMxMC55KmMxMS54KmMxMi54KmMxMy54KmMxMy55KmMyMi55IC0gYzEwLnkqYzExLngqYzEyLnkqYzEzLngqYzIyLngqYzEzLnkgKyBjMTAueSpjMTEueSpjMTIueCpjMTMueCpjMjIueCpjMTMueSArXHJcbiAgICAgICAgICAgIGMxMS54KmMxMS55KmMxMi54KmMxMi55KmMxMy54KmMyMi55IC0gYzExLngqYzExLnkqYzEyLngqYzEyLnkqYzIyLngqYzEzLnkgKyBjMTEueCpjMjAueCpjMTIueSpjMTMueCpjMTMueSpjMjIueSArXHJcbiAgICAgICAgICAgIGMxMS54KmMyMC55KmMxMi55KmMxMy54KmMyMi54KmMxMy55ICsgYzExLngqYzIxLngqYzEyLnkqYzEzLngqYzIxLnkqYzEzLnkgLSBjMjAueCpjMTEueSpjMTIueCpjMTMueCpjMTMueSpjMjIueSAtXHJcbiAgICAgICAgICAgIDYqYzIwLngqYzExLnkqYzEyLnkqYzEzLngqYzIyLngqYzEzLnkgLSBjMTEueSpjMTIueCpjMjAueSpjMTMueCpjMjIueCpjMTMueSAtIGMxMS55KmMxMi54KmMyMS54KmMxMy54KmMyMS55KmMxMy55IC1cclxuICAgICAgICAgICAgNipjMTAueCpjMjAueCpjMjIueCpjMTN5MyAtIDIqYzEwLngqYzEyeTMqYzEzLngqYzIyLnggKyAyKmMyMC54KmMxMnkzKmMxMy54KmMyMi54ICsgMipjMTAueSpjMTJ4MypjMTMueSpjMjIueSAtXHJcbiAgICAgICAgICAgIDYqYzEwLngqYzEwLnkqYzEzLngqYzIyLngqYzEzeTIgKyAzKmMxMC54KmMxMS54KmMxMi54KmMxM3kyKmMyMi55IC0gMipjMTAueCpjMTEueCpjMTIueSpjMjIueCpjMTN5MiAtXHJcbiAgICAgICAgICAgIDQqYzEwLngqYzExLnkqYzEyLngqYzIyLngqYzEzeTIgKyAzKmMxMC55KmMxMS54KmMxMi54KmMyMi54KmMxM3kyICsgNipjMTAueCpjMTAueSpjMTN4MipjMTMueSpjMjIueSArXHJcbiAgICAgICAgICAgIDYqYzEwLngqYzIwLngqYzEzLngqYzEzeTIqYzIyLnkgLSAzKmMxMC54KmMxMS55KmMxMi55KmMxM3gyKmMyMi55ICsgMipjMTAueCpjMTIueCpjMTJ5MipjMTMueCpjMjIueSArXHJcbiAgICAgICAgICAgIDIqYzEwLngqYzEyLngqYzEyeTIqYzIyLngqYzEzLnkgKyA2KmMxMC54KmMyMC55KmMxMy54KmMyMi54KmMxM3kyICsgNipjMTAueCpjMjEueCpjMTMueCpjMjEueSpjMTN5MiArXHJcbiAgICAgICAgICAgIDQqYzEwLnkqYzExLngqYzEyLnkqYzEzeDIqYzIyLnkgKyA2KmMxMC55KmMyMC54KmMxMy54KmMyMi54KmMxM3kyICsgMipjMTAueSpjMTEueSpjMTIueCpjMTN4MipjMjIueSAtXHJcbiAgICAgICAgICAgIDMqYzEwLnkqYzExLnkqYzEyLnkqYzEzeDIqYzIyLnggKyAyKmMxMC55KmMxMi54KmMxMnkyKmMxMy54KmMyMi54IC0gMypjMTEueCpjMjAueCpjMTIueCpjMTN5MipjMjIueSArXHJcbiAgICAgICAgICAgIDIqYzExLngqYzIwLngqYzEyLnkqYzIyLngqYzEzeTIgKyBjMTEueCpjMTEueSpjMTJ5MipjMTMueCpjMjIueCAtIDMqYzExLngqYzEyLngqYzIwLnkqYzIyLngqYzEzeTIgLVxyXG4gICAgICAgICAgICAzKmMxMS54KmMxMi54KmMyMS54KmMyMS55KmMxM3kyICsgNCpjMjAueCpjMTEueSpjMTIueCpjMjIueCpjMTN5MiAtIDIqYzEwLngqYzEyeDIqYzEyLnkqYzEzLnkqYzIyLnkgLVxyXG4gICAgICAgICAgICA2KmMxMC55KmMyMC54KmMxM3gyKmMxMy55KmMyMi55IC0gNipjMTAueSpjMjAueSpjMTN4MipjMjIueCpjMTMueSAtIDYqYzEwLnkqYzIxLngqYzEzeDIqYzIxLnkqYzEzLnkgLVxyXG4gICAgICAgICAgICAyKmMxMC55KmMxMngyKmMxMi55KmMxMy54KmMyMi55IC0gMipjMTAueSpjMTJ4MipjMTIueSpjMjIueCpjMTMueSAtIGMxMS54KmMxMS55KmMxMngyKmMxMy55KmMyMi55IC1cclxuICAgICAgICAgICAgMipjMTEueCpjMTF5MipjMTMueCpjMjIueCpjMTMueSArIDMqYzIwLngqYzExLnkqYzEyLnkqYzEzeDIqYzIyLnkgLSAyKmMyMC54KmMxMi54KmMxMnkyKmMxMy54KmMyMi55IC1cclxuICAgICAgICAgICAgMipjMjAueCpjMTIueCpjMTJ5MipjMjIueCpjMTMueSAtIDYqYzIwLngqYzIwLnkqYzEzLngqYzIyLngqYzEzeTIgLSA2KmMyMC54KmMyMS54KmMxMy54KmMyMS55KmMxM3kyICtcclxuICAgICAgICAgICAgMypjMTEueSpjMjAueSpjMTIueSpjMTN4MipjMjIueCArIDMqYzExLnkqYzIxLngqYzEyLnkqYzEzeDIqYzIxLnkgLSAyKmMxMi54KmMyMC55KmMxMnkyKmMxMy54KmMyMi54IC1cclxuICAgICAgICAgICAgMipjMTIueCpjMjEueCpjMTJ5MipjMTMueCpjMjEueSAtIGMxMXkyKmMxMi54KmMxMi55KmMxMy54KmMyMi54ICsgMipjMjAueCpjMTJ4MipjMTIueSpjMTMueSpjMjIueSAtXHJcbiAgICAgICAgICAgIDMqYzExLnkqYzIxeDIqYzEyLnkqYzEzLngqYzEzLnkgKyA2KmMyMC55KmMyMS54KmMxM3gyKmMyMS55KmMxMy55ICsgMipjMTF4MipjMTEueSpjMTMueCpjMTMueSpjMjIueSArXHJcbiAgICAgICAgICAgIGMxMXgyKmMxMi54KmMxMi55KmMxMy55KmMyMi55ICsgMipjMTJ4MipjMjAueSpjMTIueSpjMjIueCpjMTMueSArIDIqYzEyeDIqYzIxLngqYzEyLnkqYzIxLnkqYzEzLnkgLVxyXG4gICAgICAgICAgICAzKmMxMC54KmMyMXgyKmMxM3kzICsgMypjMjAueCpjMjF4MipjMTN5MyArIDMqYzEweDIqYzIyLngqYzEzeTMgLSAzKmMxMHkyKmMxM3gzKmMyMi55ICsgMypjMjB4MipjMjIueCpjMTN5MyArXHJcbiAgICAgICAgICAgIGMyMXgyKmMxMnkzKmMxMy54ICsgYzExeTMqYzEzeDIqYzIyLnggLSBjMTF4MypjMTN5MipjMjIueSArIDMqYzEwLnkqYzIxeDIqYzEzLngqYzEzeTIgLVxyXG4gICAgICAgICAgICBjMTEueCpjMTF5MipjMTN4MipjMjIueSArIGMxMS54KmMyMXgyKmMxMi55KmMxM3kyICsgMipjMTEueSpjMTIueCpjMjF4MipjMTN5MiArIGMxMXgyKmMxMS55KmMyMi54KmMxM3kyIC1cclxuICAgICAgICAgICAgYzEyLngqYzIxeDIqYzEyeTIqYzEzLnkgLSAzKmMyMC55KmMyMXgyKmMxMy54KmMxM3kyIC0gMypjMTB4MipjMTMueCpjMTN5MipjMjIueSArIDMqYzEweTIqYzEzeDIqYzIyLngqYzEzLnkgLVxyXG4gICAgICAgICAgICBjMTF4MipjMTJ5MipjMTMueCpjMjIueSArIGMxMXkyKmMxMngyKmMyMi54KmMxMy55IC0gMypjMjB4MipjMTMueCpjMTN5MipjMjIueSArIDMqYzIweTIqYzEzeDIqYzIyLngqYzEzLnkgK1xyXG4gICAgICAgICAgICBjMTJ4MipjMTIueSpjMTMueCooMipjMjAueSpjMjIueSArIGMyMXkyKSArIGMxMS54KmMxMi54KmMxMy54KmMxMy55Kig2KmMyMC55KmMyMi55ICsgMypjMjF5MikgK1xyXG4gICAgICAgICAgICBjMTJ4MypjMTMueSooLTIqYzIwLnkqYzIyLnkgLSBjMjF5MikgKyBjMTAueSpjMTN4MyooNipjMjAueSpjMjIueSArIDMqYzIxeTIpICtcclxuICAgICAgICAgICAgYzExLnkqYzEyLngqYzEzeDIqKC0yKmMyMC55KmMyMi55IC0gYzIxeTIpICsgYzExLngqYzEyLnkqYzEzeDIqKC00KmMyMC55KmMyMi55IC0gMipjMjF5MikgK1xyXG4gICAgICAgICAgICBjMTAueCpjMTN4MipjMTMueSooLTYqYzIwLnkqYzIyLnkgLSAzKmMyMXkyKSArIGMyMC54KmMxM3gyKmMxMy55Kig2KmMyMC55KmMyMi55ICsgMypjMjF5MikgK1xyXG4gICAgICAgICAgICBjMTN4MyooLTIqYzIwLnkqYzIxeTIgLSBjMjB5MipjMjIueSAtIGMyMC55KigyKmMyMC55KmMyMi55ICsgYzIxeTIpKSxcclxuICAgICAgICAtYzEwLngqYzExLngqYzEyLnkqYzEzLngqYzIxLnkqYzEzLnkgKyBjMTAueCpjMTEueSpjMTIueCpjMTMueCpjMjEueSpjMTMueSArIDYqYzEwLngqYzExLnkqYzIxLngqYzEyLnkqYzEzLngqYzEzLnkgLVxyXG4gICAgICAgICAgICA2KmMxMC55KmMxMS54KmMxMi54KmMxMy54KmMyMS55KmMxMy55IC0gYzEwLnkqYzExLngqYzIxLngqYzEyLnkqYzEzLngqYzEzLnkgKyBjMTAueSpjMTEueSpjMTIueCpjMjEueCpjMTMueCpjMTMueSAtXHJcbiAgICAgICAgICAgIGMxMS54KmMxMS55KmMxMi54KmMyMS54KmMxMi55KmMxMy55ICsgYzExLngqYzExLnkqYzEyLngqYzEyLnkqYzEzLngqYzIxLnkgKyBjMTEueCpjMjAueCpjMTIueSpjMTMueCpjMjEueSpjMTMueSArXHJcbiAgICAgICAgICAgIDYqYzExLngqYzEyLngqYzIwLnkqYzEzLngqYzIxLnkqYzEzLnkgKyBjMTEueCpjMjAueSpjMjEueCpjMTIueSpjMTMueCpjMTMueSAtIGMyMC54KmMxMS55KmMxMi54KmMxMy54KmMyMS55KmMxMy55IC1cclxuICAgICAgICAgICAgNipjMjAueCpjMTEueSpjMjEueCpjMTIueSpjMTMueCpjMTMueSAtIGMxMS55KmMxMi54KmMyMC55KmMyMS54KmMxMy54KmMxMy55IC0gNipjMTAueCpjMjAueCpjMjEueCpjMTN5MyAtXHJcbiAgICAgICAgICAgIDIqYzEwLngqYzIxLngqYzEyeTMqYzEzLnggKyA2KmMxMC55KmMyMC55KmMxM3gzKmMyMS55ICsgMipjMjAueCpjMjEueCpjMTJ5MypjMTMueCArIDIqYzEwLnkqYzEyeDMqYzIxLnkqYzEzLnkgLVxyXG4gICAgICAgICAgICAyKmMxMngzKmMyMC55KmMyMS55KmMxMy55IC0gNipjMTAueCpjMTAueSpjMjEueCpjMTMueCpjMTN5MiArIDMqYzEwLngqYzExLngqYzEyLngqYzIxLnkqYzEzeTIgLVxyXG4gICAgICAgICAgICAyKmMxMC54KmMxMS54KmMyMS54KmMxMi55KmMxM3kyIC0gNCpjMTAueCpjMTEueSpjMTIueCpjMjEueCpjMTN5MiArIDMqYzEwLnkqYzExLngqYzEyLngqYzIxLngqYzEzeTIgK1xyXG4gICAgICAgICAgICA2KmMxMC54KmMxMC55KmMxM3gyKmMyMS55KmMxMy55ICsgNipjMTAueCpjMjAueCpjMTMueCpjMjEueSpjMTN5MiAtIDMqYzEwLngqYzExLnkqYzEyLnkqYzEzeDIqYzIxLnkgK1xyXG4gICAgICAgICAgICAyKmMxMC54KmMxMi54KmMyMS54KmMxMnkyKmMxMy55ICsgMipjMTAueCpjMTIueCpjMTJ5MipjMTMueCpjMjEueSArIDYqYzEwLngqYzIwLnkqYzIxLngqYzEzLngqYzEzeTIgK1xyXG4gICAgICAgICAgICA0KmMxMC55KmMxMS54KmMxMi55KmMxM3gyKmMyMS55ICsgNipjMTAueSpjMjAueCpjMjEueCpjMTMueCpjMTN5MiArIDIqYzEwLnkqYzExLnkqYzEyLngqYzEzeDIqYzIxLnkgLVxyXG4gICAgICAgICAgICAzKmMxMC55KmMxMS55KmMyMS54KmMxMi55KmMxM3gyICsgMipjMTAueSpjMTIueCpjMjEueCpjMTJ5MipjMTMueCAtIDMqYzExLngqYzIwLngqYzEyLngqYzIxLnkqYzEzeTIgK1xyXG4gICAgICAgICAgICAyKmMxMS54KmMyMC54KmMyMS54KmMxMi55KmMxM3kyICsgYzExLngqYzExLnkqYzIxLngqYzEyeTIqYzEzLnggLSAzKmMxMS54KmMxMi54KmMyMC55KmMyMS54KmMxM3kyICtcclxuICAgICAgICAgICAgNCpjMjAueCpjMTEueSpjMTIueCpjMjEueCpjMTN5MiAtIDYqYzEwLngqYzIwLnkqYzEzeDIqYzIxLnkqYzEzLnkgLSAyKmMxMC54KmMxMngyKmMxMi55KmMyMS55KmMxMy55IC1cclxuICAgICAgICAgICAgNipjMTAueSpjMjAueCpjMTN4MipjMjEueSpjMTMueSAtIDYqYzEwLnkqYzIwLnkqYzIxLngqYzEzeDIqYzEzLnkgLSAyKmMxMC55KmMxMngyKmMyMS54KmMxMi55KmMxMy55IC1cclxuICAgICAgICAgICAgMipjMTAueSpjMTJ4MipjMTIueSpjMTMueCpjMjEueSAtIGMxMS54KmMxMS55KmMxMngyKmMyMS55KmMxMy55IC0gNCpjMTEueCpjMjAueSpjMTIueSpjMTN4MipjMjEueSAtXHJcbiAgICAgICAgICAgIDIqYzExLngqYzExeTIqYzIxLngqYzEzLngqYzEzLnkgKyAzKmMyMC54KmMxMS55KmMxMi55KmMxM3gyKmMyMS55IC0gMipjMjAueCpjMTIueCpjMjEueCpjMTJ5MipjMTMueSAtXHJcbiAgICAgICAgICAgIDIqYzIwLngqYzEyLngqYzEyeTIqYzEzLngqYzIxLnkgLSA2KmMyMC54KmMyMC55KmMyMS54KmMxMy54KmMxM3kyIC0gMipjMTEueSpjMTIueCpjMjAueSpjMTN4MipjMjEueSArXHJcbiAgICAgICAgICAgIDMqYzExLnkqYzIwLnkqYzIxLngqYzEyLnkqYzEzeDIgLSAyKmMxMi54KmMyMC55KmMyMS54KmMxMnkyKmMxMy54IC0gYzExeTIqYzEyLngqYzIxLngqYzEyLnkqYzEzLnggK1xyXG4gICAgICAgICAgICA2KmMyMC54KmMyMC55KmMxM3gyKmMyMS55KmMxMy55ICsgMipjMjAueCpjMTJ4MipjMTIueSpjMjEueSpjMTMueSArIDIqYzExeDIqYzExLnkqYzEzLngqYzIxLnkqYzEzLnkgK1xyXG4gICAgICAgICAgICBjMTF4MipjMTIueCpjMTIueSpjMjEueSpjMTMueSArIDIqYzEyeDIqYzIwLnkqYzIxLngqYzEyLnkqYzEzLnkgKyAyKmMxMngyKmMyMC55KmMxMi55KmMxMy54KmMyMS55ICtcclxuICAgICAgICAgICAgMypjMTB4MipjMjEueCpjMTN5MyAtIDMqYzEweTIqYzEzeDMqYzIxLnkgKyAzKmMyMHgyKmMyMS54KmMxM3kzICsgYzExeTMqYzIxLngqYzEzeDIgLSBjMTF4MypjMjEueSpjMTN5MiAtXHJcbiAgICAgICAgICAgIDMqYzIweTIqYzEzeDMqYzIxLnkgLSBjMTEueCpjMTF5MipjMTN4MipjMjEueSArIGMxMXgyKmMxMS55KmMyMS54KmMxM3kyIC0gMypjMTB4MipjMTMueCpjMjEueSpjMTN5MiArXHJcbiAgICAgICAgICAgIDMqYzEweTIqYzIxLngqYzEzeDIqYzEzLnkgLSBjMTF4MipjMTJ5MipjMTMueCpjMjEueSArIGMxMXkyKmMxMngyKmMyMS54KmMxMy55IC0gMypjMjB4MipjMTMueCpjMjEueSpjMTN5MiArXHJcbiAgICAgICAgICAgIDMqYzIweTIqYzIxLngqYzEzeDIqYzEzLnksXHJcbiAgICAgICAgYzEwLngqYzEwLnkqYzExLngqYzEyLnkqYzEzLngqYzEzLnkgLSBjMTAueCpjMTAueSpjMTEueSpjMTIueCpjMTMueCpjMTMueSArIGMxMC54KmMxMS54KmMxMS55KmMxMi54KmMxMi55KmMxMy55IC1cclxuICAgICAgICAgICAgYzEwLnkqYzExLngqYzExLnkqYzEyLngqYzEyLnkqYzEzLnggLSBjMTAueCpjMTEueCpjMjAueSpjMTIueSpjMTMueCpjMTMueSArIDYqYzEwLngqYzIwLngqYzExLnkqYzEyLnkqYzEzLngqYzEzLnkgK1xyXG4gICAgICAgICAgICBjMTAueCpjMTEueSpjMTIueCpjMjAueSpjMTMueCpjMTMueSAtIGMxMC55KmMxMS54KmMyMC54KmMxMi55KmMxMy54KmMxMy55IC0gNipjMTAueSpjMTEueCpjMTIueCpjMjAueSpjMTMueCpjMTMueSArXHJcbiAgICAgICAgICAgIGMxMC55KmMyMC54KmMxMS55KmMxMi54KmMxMy54KmMxMy55IC0gYzExLngqYzIwLngqYzExLnkqYzEyLngqYzEyLnkqYzEzLnkgKyBjMTEueCpjMTEueSpjMTIueCpjMjAueSpjMTIueSpjMTMueCArXHJcbiAgICAgICAgICAgIGMxMS54KmMyMC54KmMyMC55KmMxMi55KmMxMy54KmMxMy55IC0gYzIwLngqYzExLnkqYzEyLngqYzIwLnkqYzEzLngqYzEzLnkgLSAyKmMxMC54KmMyMC54KmMxMnkzKmMxMy54ICtcclxuICAgICAgICAgICAgMipjMTAueSpjMTJ4MypjMjAueSpjMTMueSAtIDMqYzEwLngqYzEwLnkqYzExLngqYzEyLngqYzEzeTIgLSA2KmMxMC54KmMxMC55KmMyMC54KmMxMy54KmMxM3kyICtcclxuICAgICAgICAgICAgMypjMTAueCpjMTAueSpjMTEueSpjMTIueSpjMTN4MiAtIDIqYzEwLngqYzEwLnkqYzEyLngqYzEyeTIqYzEzLnggLSAyKmMxMC54KmMxMS54KmMyMC54KmMxMi55KmMxM3kyIC1cclxuICAgICAgICAgICAgYzEwLngqYzExLngqYzExLnkqYzEyeTIqYzEzLnggKyAzKmMxMC54KmMxMS54KmMxMi54KmMyMC55KmMxM3kyIC0gNCpjMTAueCpjMjAueCpjMTEueSpjMTIueCpjMTN5MiArXHJcbiAgICAgICAgICAgIDMqYzEwLnkqYzExLngqYzIwLngqYzEyLngqYzEzeTIgKyA2KmMxMC54KmMxMC55KmMyMC55KmMxM3gyKmMxMy55ICsgMipjMTAueCpjMTAueSpjMTJ4MipjMTIueSpjMTMueSArXHJcbiAgICAgICAgICAgIDIqYzEwLngqYzExLngqYzExeTIqYzEzLngqYzEzLnkgKyAyKmMxMC54KmMyMC54KmMxMi54KmMxMnkyKmMxMy55ICsgNipjMTAueCpjMjAueCpjMjAueSpjMTMueCpjMTN5MiAtXHJcbiAgICAgICAgICAgIDMqYzEwLngqYzExLnkqYzIwLnkqYzEyLnkqYzEzeDIgKyAyKmMxMC54KmMxMi54KmMyMC55KmMxMnkyKmMxMy54ICsgYzEwLngqYzExeTIqYzEyLngqYzEyLnkqYzEzLnggK1xyXG4gICAgICAgICAgICBjMTAueSpjMTEueCpjMTEueSpjMTJ4MipjMTMueSArIDQqYzEwLnkqYzExLngqYzIwLnkqYzEyLnkqYzEzeDIgLSAzKmMxMC55KmMyMC54KmMxMS55KmMxMi55KmMxM3gyICtcclxuICAgICAgICAgICAgMipjMTAueSpjMjAueCpjMTIueCpjMTJ5MipjMTMueCArIDIqYzEwLnkqYzExLnkqYzEyLngqYzIwLnkqYzEzeDIgKyBjMTEueCpjMjAueCpjMTEueSpjMTJ5MipjMTMueCAtXHJcbiAgICAgICAgICAgIDMqYzExLngqYzIwLngqYzEyLngqYzIwLnkqYzEzeTIgLSAyKmMxMC54KmMxMngyKmMyMC55KmMxMi55KmMxMy55IC0gNipjMTAueSpjMjAueCpjMjAueSpjMTN4MipjMTMueSAtXHJcbiAgICAgICAgICAgIDIqYzEwLnkqYzIwLngqYzEyeDIqYzEyLnkqYzEzLnkgLSAyKmMxMC55KmMxMXgyKmMxMS55KmMxMy54KmMxMy55IC0gYzEwLnkqYzExeDIqYzEyLngqYzEyLnkqYzEzLnkgLVxyXG4gICAgICAgICAgICAyKmMxMC55KmMxMngyKmMyMC55KmMxMi55KmMxMy54IC0gMipjMTEueCpjMjAueCpjMTF5MipjMTMueCpjMTMueSAtIGMxMS54KmMxMS55KmMxMngyKmMyMC55KmMxMy55ICtcclxuICAgICAgICAgICAgMypjMjAueCpjMTEueSpjMjAueSpjMTIueSpjMTN4MiAtIDIqYzIwLngqYzEyLngqYzIwLnkqYzEyeTIqYzEzLnggLSBjMjAueCpjMTF5MipjMTIueCpjMTIueSpjMTMueCArXHJcbiAgICAgICAgICAgIDMqYzEweTIqYzExLngqYzEyLngqYzEzLngqYzEzLnkgKyAzKmMxMS54KmMxMi54KmMyMHkyKmMxMy54KmMxMy55ICsgMipjMjAueCpjMTJ4MipjMjAueSpjMTIueSpjMTMueSAtXHJcbiAgICAgICAgICAgIDMqYzEweDIqYzExLnkqYzEyLnkqYzEzLngqYzEzLnkgKyAyKmMxMXgyKmMxMS55KmMyMC55KmMxMy54KmMxMy55ICsgYzExeDIqYzEyLngqYzIwLnkqYzEyLnkqYzEzLnkgLVxyXG4gICAgICAgICAgICAzKmMyMHgyKmMxMS55KmMxMi55KmMxMy54KmMxMy55IC0gYzEweDMqYzEzeTMgKyBjMTB5MypjMTN4MyArIGMyMHgzKmMxM3kzIC0gYzIweTMqYzEzeDMgLVxyXG4gICAgICAgICAgICAzKmMxMC54KmMyMHgyKmMxM3kzIC0gYzEwLngqYzExeTMqYzEzeDIgKyAzKmMxMHgyKmMyMC54KmMxM3kzICsgYzEwLnkqYzExeDMqYzEzeTIgK1xyXG4gICAgICAgICAgICAzKmMxMC55KmMyMHkyKmMxM3gzICsgYzIwLngqYzExeTMqYzEzeDIgKyBjMTB4MipjMTJ5MypjMTMueCAtIDMqYzEweTIqYzIwLnkqYzEzeDMgLSBjMTB5MipjMTJ4MypjMTMueSArXHJcbiAgICAgICAgICAgIGMyMHgyKmMxMnkzKmMxMy54IC0gYzExeDMqYzIwLnkqYzEzeTIgLSBjMTJ4MypjMjB5MipjMTMueSAtIGMxMC54KmMxMXgyKmMxMS55KmMxM3kyICtcclxuICAgICAgICAgICAgYzEwLnkqYzExLngqYzExeTIqYzEzeDIgLSAzKmMxMC54KmMxMHkyKmMxM3gyKmMxMy55IC0gYzEwLngqYzExeTIqYzEyeDIqYzEzLnkgKyBjMTAueSpjMTF4MipjMTJ5MipjMTMueCAtXHJcbiAgICAgICAgICAgIGMxMS54KmMxMXkyKmMyMC55KmMxM3gyICsgMypjMTB4MipjMTAueSpjMTMueCpjMTN5MiArIGMxMHgyKmMxMS54KmMxMi55KmMxM3kyICtcclxuICAgICAgICAgICAgMipjMTB4MipjMTEueSpjMTIueCpjMTN5MiAtIDIqYzEweTIqYzExLngqYzEyLnkqYzEzeDIgLSBjMTB5MipjMTEueSpjMTIueCpjMTN4MiArIGMxMXgyKmMyMC54KmMxMS55KmMxM3kyIC1cclxuICAgICAgICAgICAgMypjMTAueCpjMjB5MipjMTN4MipjMTMueSArIDMqYzEwLnkqYzIweDIqYzEzLngqYzEzeTIgKyBjMTEueCpjMjB4MipjMTIueSpjMTN5MiAtIDIqYzExLngqYzIweTIqYzEyLnkqYzEzeDIgK1xyXG4gICAgICAgICAgICBjMjAueCpjMTF5MipjMTJ4MipjMTMueSAtIGMxMS55KmMxMi54KmMyMHkyKmMxM3gyIC0gYzEweDIqYzEyLngqYzEyeTIqYzEzLnkgLSAzKmMxMHgyKmMyMC55KmMxMy54KmMxM3kyICtcclxuICAgICAgICAgICAgMypjMTB5MipjMjAueCpjMTN4MipjMTMueSArIGMxMHkyKmMxMngyKmMxMi55KmMxMy54IC0gYzExeDIqYzIwLnkqYzEyeTIqYzEzLnggKyAyKmMyMHgyKmMxMS55KmMxMi54KmMxM3kyICtcclxuICAgICAgICAgICAgMypjMjAueCpjMjB5MipjMTN4MipjMTMueSAtIGMyMHgyKmMxMi54KmMxMnkyKmMxMy55IC0gMypjMjB4MipjMjAueSpjMTMueCpjMTN5MiArIGMxMngyKmMyMHkyKmMxMi55KmMxMy54XHJcbiAgICApO1xyXG4gICAgdmFyIHJvb3RzID0gcG9seS5nZXRSb290c0luSW50ZXJ2YWwoMCwxKTtcclxuXHJcbiAgICBmb3IgKCB2YXIgaSA9IDA7IGkgPCByb290cy5sZW5ndGg7IGkrKyApIHtcclxuICAgICAgICB2YXIgcyA9IHJvb3RzW2ldO1xyXG4gICAgICAgIHZhciB4Um9vdHMgPSBuZXcgUG9seW5vbWlhbChcclxuICAgICAgICAgICAgYzEzLngsXHJcbiAgICAgICAgICAgIGMxMi54LFxyXG4gICAgICAgICAgICBjMTEueCxcclxuICAgICAgICAgICAgYzEwLnggLSBjMjAueCAtIHMqYzIxLnggLSBzKnMqYzIyLnggLSBzKnMqcypjMjMueFxyXG4gICAgICAgICkuZ2V0Um9vdHMoKTtcclxuICAgICAgICB2YXIgeVJvb3RzID0gbmV3IFBvbHlub21pYWwoXHJcbiAgICAgICAgICAgIGMxMy55LFxyXG4gICAgICAgICAgICBjMTIueSxcclxuICAgICAgICAgICAgYzExLnksXHJcbiAgICAgICAgICAgIGMxMC55IC0gYzIwLnkgLSBzKmMyMS55IC0gcypzKmMyMi55IC0gcypzKnMqYzIzLnlcclxuICAgICAgICApLmdldFJvb3RzKCk7XHJcblxyXG4gICAgICAgIGlmICggeFJvb3RzLmxlbmd0aCA+IDAgJiYgeVJvb3RzLmxlbmd0aCA+IDAgKSB7XHJcbiAgICAgICAgICAgIHZhciBUT0xFUkFOQ0UgPSAxZS00O1xyXG5cclxuICAgICAgICAgICAgY2hlY2tSb290czpcclxuICAgICAgICAgICAgZm9yICggdmFyIGogPSAwOyBqIDwgeFJvb3RzLmxlbmd0aDsgaisrICkge1xyXG4gICAgICAgICAgICAgICAgdmFyIHhSb290ID0geFJvb3RzW2pdO1xyXG5cclxuICAgICAgICAgICAgICAgIGlmICggMCA8PSB4Um9vdCAmJiB4Um9vdCA8PSAxICkge1xyXG4gICAgICAgICAgICAgICAgICAgIGZvciAoIHZhciBrID0gMDsgayA8IHlSb290cy5sZW5ndGg7IGsrKyApIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCBNYXRoLmFicyggeFJvb3QgLSB5Um9vdHNba10gKSA8IFRPTEVSQU5DRSApIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJlc3VsdC5wb2ludHMucHVzaChcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjMjMubXVsdGlwbHkocypzKnMpLmFkZChjMjIubXVsdGlwbHkocypzKS5hZGQoYzIxLm11bHRpcGx5KHMpLmFkZChjMjApKSlcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBicmVhayBjaGVja1Jvb3RzO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIGlmICggcmVzdWx0LnBvaW50cy5sZW5ndGggPiAwICkgcmVzdWx0LnN0YXR1cyA9IFwiSW50ZXJzZWN0aW9uXCI7XHJcblxyXG4gICAgcmV0dXJuIHJlc3VsdDtcclxufTtcclxuXHJcblxyXG4vKipcclxuICogIGludGVyc2VjdEJlemllcjNDaXJjbGVcclxuICpcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gcDFcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gcDJcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gcDNcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gcDRcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gY1xyXG4gKiAgQHBhcmFtIHtOdW1iZXJ9IHJcclxuICogIEByZXR1cm5zIHtJbnRlcnNlY3Rpb259XHJcbiAqL1xyXG5JbnRlcnNlY3Rpb24uaW50ZXJzZWN0QmV6aWVyM0NpcmNsZSA9IGZ1bmN0aW9uKHAxLCBwMiwgcDMsIHA0LCBjLCByKSB7XHJcbiAgICByZXR1cm4gSW50ZXJzZWN0aW9uLmludGVyc2VjdEJlemllcjNFbGxpcHNlKHAxLCBwMiwgcDMsIHA0LCBjLCByLCByKTtcclxufTtcclxuXHJcblxyXG4vKipcclxuICogIGludGVyc2VjdEJlemllcjNFbGxpcHNlXHJcbiAqXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IHAxXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IHAyXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IHAzXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IHA0XHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IGVjXHJcbiAqICBAcGFyYW0ge051bWJlcn0gcnhcclxuICogIEBwYXJhbSB7TnVtYmVyfSByeVxyXG4gKiAgQHJldHVybnMge0ludGVyc2VjdGlvbn1cclxuICovXHJcbkludGVyc2VjdGlvbi5pbnRlcnNlY3RCZXppZXIzRWxsaXBzZSA9IGZ1bmN0aW9uKHAxLCBwMiwgcDMsIHA0LCBlYywgcngsIHJ5KSB7XHJcbiAgICB2YXIgYSwgYiwgYywgZDsgICAgICAgLy8gdGVtcG9yYXJ5IHZhcmlhYmxlc1xyXG4gICAgdmFyIGMzLCBjMiwgYzEsIGMwOyAgIC8vIGNvZWZmaWNpZW50cyBvZiBjdWJpY1xyXG4gICAgdmFyIHJlc3VsdCA9IG5ldyBJbnRlcnNlY3Rpb24oXCJObyBJbnRlcnNlY3Rpb25cIik7XHJcblxyXG4gICAgLy8gQ2FsY3VsYXRlIHRoZSBjb2VmZmljaWVudHMgb2YgY3ViaWMgcG9seW5vbWlhbFxyXG4gICAgYSA9IHAxLm11bHRpcGx5KC0xKTtcclxuICAgIGIgPSBwMi5tdWx0aXBseSgzKTtcclxuICAgIGMgPSBwMy5tdWx0aXBseSgtMyk7XHJcbiAgICBkID0gYS5hZGQoYi5hZGQoYy5hZGQocDQpKSk7XHJcbiAgICBjMyA9IG5ldyBWZWN0b3IyRChkLngsIGQueSk7XHJcblxyXG4gICAgYSA9IHAxLm11bHRpcGx5KDMpO1xyXG4gICAgYiA9IHAyLm11bHRpcGx5KC02KTtcclxuICAgIGMgPSBwMy5tdWx0aXBseSgzKTtcclxuICAgIGQgPSBhLmFkZChiLmFkZChjKSk7XHJcbiAgICBjMiA9IG5ldyBWZWN0b3IyRChkLngsIGQueSk7XHJcblxyXG4gICAgYSA9IHAxLm11bHRpcGx5KC0zKTtcclxuICAgIGIgPSBwMi5tdWx0aXBseSgzKTtcclxuICAgIGMgPSBhLmFkZChiKTtcclxuICAgIGMxID0gbmV3IFZlY3RvcjJEKGMueCwgYy55KTtcclxuXHJcbiAgICBjMCA9IG5ldyBWZWN0b3IyRChwMS54LCBwMS55KTtcclxuXHJcbiAgICB2YXIgcnhyeCAgPSByeCpyeDtcclxuICAgIHZhciByeXJ5ICA9IHJ5KnJ5O1xyXG4gICAgdmFyIHBvbHkgPSBuZXcgUG9seW5vbWlhbChcclxuICAgICAgICBjMy54KmMzLngqcnlyeSArIGMzLnkqYzMueSpyeHJ4LFxyXG4gICAgICAgIDIqKGMzLngqYzIueCpyeXJ5ICsgYzMueSpjMi55KnJ4cngpLFxyXG4gICAgICAgIDIqKGMzLngqYzEueCpyeXJ5ICsgYzMueSpjMS55KnJ4cngpICsgYzIueCpjMi54KnJ5cnkgKyBjMi55KmMyLnkqcnhyeCxcclxuICAgICAgICAyKmMzLngqcnlyeSooYzAueCAtIGVjLngpICsgMipjMy55KnJ4cngqKGMwLnkgLSBlYy55KSArXHJcbiAgICAgICAgICAgIDIqKGMyLngqYzEueCpyeXJ5ICsgYzIueSpjMS55KnJ4cngpLFxyXG4gICAgICAgIDIqYzIueCpyeXJ5KihjMC54IC0gZWMueCkgKyAyKmMyLnkqcnhyeCooYzAueSAtIGVjLnkpICtcclxuICAgICAgICAgICAgYzEueCpjMS54KnJ5cnkgKyBjMS55KmMxLnkqcnhyeCxcclxuICAgICAgICAyKmMxLngqcnlyeSooYzAueCAtIGVjLngpICsgMipjMS55KnJ4cngqKGMwLnkgLSBlYy55KSxcclxuICAgICAgICBjMC54KmMwLngqcnlyeSAtIDIqYzAueSplYy55KnJ4cnggLSAyKmMwLngqZWMueCpyeXJ5ICtcclxuICAgICAgICAgICAgYzAueSpjMC55KnJ4cnggKyBlYy54KmVjLngqcnlyeSArIGVjLnkqZWMueSpyeHJ4IC0gcnhyeCpyeXJ5XHJcbiAgICApO1xyXG4gICAgdmFyIHJvb3RzID0gcG9seS5nZXRSb290c0luSW50ZXJ2YWwoMCwxKTtcclxuXHJcbiAgICBmb3IgKCB2YXIgaSA9IDA7IGkgPCByb290cy5sZW5ndGg7IGkrKyApIHtcclxuICAgICAgICB2YXIgdCA9IHJvb3RzW2ldO1xyXG5cclxuICAgICAgICByZXN1bHQucG9pbnRzLnB1c2goXHJcbiAgICAgICAgICAgIGMzLm11bHRpcGx5KHQqdCp0KS5hZGQoYzIubXVsdGlwbHkodCp0KS5hZGQoYzEubXVsdGlwbHkodCkuYWRkKGMwKSkpXHJcbiAgICAgICAgKTtcclxuICAgIH1cclxuXHJcbiAgICBpZiAoIHJlc3VsdC5wb2ludHMubGVuZ3RoID4gMCApIHJlc3VsdC5zdGF0dXMgPSBcIkludGVyc2VjdGlvblwiO1xyXG5cclxuICAgIHJldHVybiByZXN1bHQ7XHJcbn07XHJcblxyXG5cclxuLyoqXHJcbiAqICBpbnRlcnNlY3RCZXppZXIzTGluZVxyXG4gKlxyXG4gKiAgTWFueSB0aGFua3MgdG8gRGFuIFN1bmRheSBhdCBTb2Z0U3VyZmVyLmNvbS4gIEhlIGdhdmUgbWUgYSB2ZXJ5IHRob3JvdWdoXHJcbiAqICBza2V0Y2ggb2YgdGhlIGFsZ29yaXRobSB1c2VkIGhlcmUuICBXaXRob3V0IGhpcyBoZWxwLCBJJ20gbm90IHN1cmUgd2hlbiBJXHJcbiAqICB3b3VsZCBoYXZlIGZpZ3VyZWQgb3V0IHRoaXMgaW50ZXJzZWN0aW9uIHByb2JsZW0uXHJcbiAqXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IHAxXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IHAyXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IHAzXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IHA0XHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IGExXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IGEyXHJcbiAqICBAcmV0dXJucyB7SW50ZXJzZWN0aW9ufVxyXG4gKi9cclxuSW50ZXJzZWN0aW9uLmludGVyc2VjdEJlemllcjNMaW5lID0gZnVuY3Rpb24ocDEsIHAyLCBwMywgcDQsIGExLCBhMikge1xyXG4gICAgdmFyIGEsIGIsIGMsIGQ7ICAgICAgIC8vIHRlbXBvcmFyeSB2YXJpYWJsZXNcclxuICAgIHZhciBjMywgYzIsIGMxLCBjMDsgICAvLyBjb2VmZmljaWVudHMgb2YgY3ViaWNcclxuICAgIHZhciBjbDsgICAgICAgICAgICAgICAvLyBjIGNvZWZmaWNpZW50IGZvciBub3JtYWwgZm9ybSBvZiBsaW5lXHJcbiAgICB2YXIgbjsgICAgICAgICAgICAgICAgLy8gbm9ybWFsIGZvciBub3JtYWwgZm9ybSBvZiBsaW5lXHJcbiAgICB2YXIgbWluID0gYTEubWluKGEyKTsgLy8gdXNlZCB0byBkZXRlcm1pbmUgaWYgcG9pbnQgaXMgb24gbGluZSBzZWdtZW50XHJcbiAgICB2YXIgbWF4ID0gYTEubWF4KGEyKTsgLy8gdXNlZCB0byBkZXRlcm1pbmUgaWYgcG9pbnQgaXMgb24gbGluZSBzZWdtZW50XHJcbiAgICB2YXIgcmVzdWx0ID0gbmV3IEludGVyc2VjdGlvbihcIk5vIEludGVyc2VjdGlvblwiKTtcclxuXHJcbiAgICAvLyBTdGFydCB3aXRoIEJlemllciB1c2luZyBCZXJuc3RlaW4gcG9seW5vbWlhbHMgZm9yIHdlaWdodGluZyBmdW5jdGlvbnM6XHJcbiAgICAvLyAgICAgKDEtdF4zKVAxICsgM3QoMS10KV4yUDIgKyAzdF4yKDEtdClQMyArIHReM1A0XHJcbiAgICAvL1xyXG4gICAgLy8gRXhwYW5kIGFuZCBjb2xsZWN0IHRlcm1zIHRvIGZvcm0gbGluZWFyIGNvbWJpbmF0aW9ucyBvZiBvcmlnaW5hbCBCZXppZXJcclxuICAgIC8vIGNvbnRyb2xzLiAgVGhpcyBlbmRzIHVwIHdpdGggYSB2ZWN0b3IgY3ViaWMgaW4gdDpcclxuICAgIC8vICAgICAoLVAxKzNQMi0zUDMrUDQpdF4zICsgKDNQMS02UDIrM1AzKXReMiArICgtM1AxKzNQMil0ICsgUDFcclxuICAgIC8vICAgICAgICAgICAgIC9cXCAgICAgICAgICAgICAgICAgIC9cXCAgICAgICAgICAgICAgICAvXFwgICAgICAgL1xcXHJcbiAgICAvLyAgICAgICAgICAgICB8fCAgICAgICAgICAgICAgICAgIHx8ICAgICAgICAgICAgICAgIHx8ICAgICAgIHx8XHJcbiAgICAvLyAgICAgICAgICAgICBjMyAgICAgICAgICAgICAgICAgIGMyICAgICAgICAgICAgICAgIGMxICAgICAgIGMwXHJcblxyXG4gICAgLy8gQ2FsY3VsYXRlIHRoZSBjb2VmZmljaWVudHNcclxuICAgIGEgPSBwMS5tdWx0aXBseSgtMSk7XHJcbiAgICBiID0gcDIubXVsdGlwbHkoMyk7XHJcbiAgICBjID0gcDMubXVsdGlwbHkoLTMpO1xyXG4gICAgZCA9IGEuYWRkKGIuYWRkKGMuYWRkKHA0KSkpO1xyXG4gICAgYzMgPSBuZXcgVmVjdG9yMkQoZC54LCBkLnkpO1xyXG5cclxuICAgIGEgPSBwMS5tdWx0aXBseSgzKTtcclxuICAgIGIgPSBwMi5tdWx0aXBseSgtNik7XHJcbiAgICBjID0gcDMubXVsdGlwbHkoMyk7XHJcbiAgICBkID0gYS5hZGQoYi5hZGQoYykpO1xyXG4gICAgYzIgPSBuZXcgVmVjdG9yMkQoZC54LCBkLnkpO1xyXG5cclxuICAgIGEgPSBwMS5tdWx0aXBseSgtMyk7XHJcbiAgICBiID0gcDIubXVsdGlwbHkoMyk7XHJcbiAgICBjID0gYS5hZGQoYik7XHJcbiAgICBjMSA9IG5ldyBWZWN0b3IyRChjLngsIGMueSk7XHJcblxyXG4gICAgYzAgPSBuZXcgVmVjdG9yMkQocDEueCwgcDEueSk7XHJcblxyXG4gICAgLy8gQ29udmVydCBsaW5lIHRvIG5vcm1hbCBmb3JtOiBheCArIGJ5ICsgYyA9IDBcclxuICAgIC8vIEZpbmQgbm9ybWFsIHRvIGxpbmU6IG5lZ2F0aXZlIGludmVyc2Ugb2Ygb3JpZ2luYWwgbGluZSdzIHNsb3BlXHJcbiAgICBuID0gbmV3IFZlY3RvcjJEKGExLnkgLSBhMi55LCBhMi54IC0gYTEueCk7XHJcblxyXG4gICAgLy8gRGV0ZXJtaW5lIG5ldyBjIGNvZWZmaWNpZW50XHJcbiAgICBjbCA9IGExLngqYTIueSAtIGEyLngqYTEueTtcclxuXHJcbiAgICAvLyA/Um90YXRlIGVhY2ggY3ViaWMgY29lZmZpY2llbnQgdXNpbmcgbGluZSBmb3IgbmV3IGNvb3JkaW5hdGUgc3lzdGVtP1xyXG4gICAgLy8gRmluZCByb290cyBvZiByb3RhdGVkIGN1YmljXHJcbiAgICByb290cyA9IG5ldyBQb2x5bm9taWFsKFxyXG4gICAgICAgIG4uZG90KGMzKSxcclxuICAgICAgICBuLmRvdChjMiksXHJcbiAgICAgICAgbi5kb3QoYzEpLFxyXG4gICAgICAgIG4uZG90KGMwKSArIGNsXHJcbiAgICApLmdldFJvb3RzKCk7XHJcblxyXG4gICAgLy8gQW55IHJvb3RzIGluIGNsb3NlZCBpbnRlcnZhbCBbMCwxXSBhcmUgaW50ZXJzZWN0aW9ucyBvbiBCZXppZXIsIGJ1dFxyXG4gICAgLy8gbWlnaHQgbm90IGJlIG9uIHRoZSBsaW5lIHNlZ21lbnQuXHJcbiAgICAvLyBGaW5kIGludGVyc2VjdGlvbnMgYW5kIGNhbGN1bGF0ZSBwb2ludCBjb29yZGluYXRlc1xyXG4gICAgZm9yICggdmFyIGkgPSAwOyBpIDwgcm9vdHMubGVuZ3RoOyBpKysgKSB7XHJcbiAgICAgICAgdmFyIHQgPSByb290c1tpXTtcclxuXHJcbiAgICAgICAgaWYgKCAwIDw9IHQgJiYgdCA8PSAxICkge1xyXG4gICAgICAgICAgICAvLyBXZSdyZSB3aXRoaW4gdGhlIEJlemllciBjdXJ2ZVxyXG4gICAgICAgICAgICAvLyBGaW5kIHBvaW50IG9uIEJlemllclxyXG4gICAgICAgICAgICB2YXIgcDUgPSBwMS5sZXJwKHAyLCB0KTtcclxuICAgICAgICAgICAgdmFyIHA2ID0gcDIubGVycChwMywgdCk7XHJcbiAgICAgICAgICAgIHZhciBwNyA9IHAzLmxlcnAocDQsIHQpO1xyXG5cclxuICAgICAgICAgICAgdmFyIHA4ID0gcDUubGVycChwNiwgdCk7XHJcbiAgICAgICAgICAgIHZhciBwOSA9IHA2LmxlcnAocDcsIHQpO1xyXG5cclxuICAgICAgICAgICAgdmFyIHAxMCA9IHA4LmxlcnAocDksIHQpO1xyXG5cclxuICAgICAgICAgICAgLy8gU2VlIGlmIHBvaW50IGlzIG9uIGxpbmUgc2VnbWVudFxyXG4gICAgICAgICAgICAvLyBIYWQgdG8gbWFrZSBzcGVjaWFsIGNhc2VzIGZvciB2ZXJ0aWNhbCBhbmQgaG9yaXpvbnRhbCBsaW5lcyBkdWVcclxuICAgICAgICAgICAgLy8gdG8gc2xpZ2h0IGVycm9ycyBpbiBjYWxjdWxhdGlvbiBvZiBwMTBcclxuICAgICAgICAgICAgaWYgKCBhMS54ID09IGEyLnggKSB7XHJcbiAgICAgICAgICAgICAgICBpZiAoIG1pbi55IDw9IHAxMC55ICYmIHAxMC55IDw9IG1heC55ICkge1xyXG4gICAgICAgICAgICAgICAgICAgIHJlc3VsdC5zdGF0dXMgPSBcIkludGVyc2VjdGlvblwiO1xyXG4gICAgICAgICAgICAgICAgICAgIHJlc3VsdC5hcHBlbmRQb2ludCggcDEwICk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0gZWxzZSBpZiAoIGExLnkgPT0gYTIueSApIHtcclxuICAgICAgICAgICAgICAgIGlmICggbWluLnggPD0gcDEwLnggJiYgcDEwLnggPD0gbWF4LnggKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgcmVzdWx0LnN0YXR1cyA9IFwiSW50ZXJzZWN0aW9uXCI7XHJcbiAgICAgICAgICAgICAgICAgICAgcmVzdWx0LmFwcGVuZFBvaW50KCBwMTAgKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSBlbHNlIGlmIChtaW4ueCA8PSBwMTAueCAmJiBwMTAueCA8PSBtYXgueCAmJiBtaW4ueSA8PSBwMTAueSAmJiBwMTAueSA8PSBtYXgueSkge1xyXG4gICAgICAgICAgICAgICAgcmVzdWx0LnN0YXR1cyA9IFwiSW50ZXJzZWN0aW9uXCI7XHJcbiAgICAgICAgICAgICAgICByZXN1bHQuYXBwZW5kUG9pbnQoIHAxMCApO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiByZXN1bHQ7XHJcbn07XHJcblxyXG5cclxuLyoqXHJcbiAqICBpbnRlcnNlY3RCZXppZXIzUG9seWdvblxyXG4gKlxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBwMVxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBwMlxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBwM1xyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBwNFxyXG4gKiAgQHBhcmFtIHtBcnJheTxQb2ludDJEPn0gcG9pbnRzXHJcbiAqICBAcmV0dXJucyB7SW50ZXJzZWN0aW9ufVxyXG4gKi9cclxuSW50ZXJzZWN0aW9uLmludGVyc2VjdEJlemllcjNQb2x5Z29uID0gZnVuY3Rpb24ocDEsIHAyLCBwMywgcDQsIHBvaW50cykge1xyXG4gICAgdmFyIHJlc3VsdCA9IG5ldyBJbnRlcnNlY3Rpb24oXCJObyBJbnRlcnNlY3Rpb25cIik7XHJcbiAgICB2YXIgbGVuZ3RoID0gcG9pbnRzLmxlbmd0aDtcclxuXHJcbiAgICBmb3IgKCB2YXIgaSA9IDA7IGkgPCBsZW5ndGg7IGkrKyApIHtcclxuICAgICAgICB2YXIgYTEgPSBwb2ludHNbaV07XHJcbiAgICAgICAgdmFyIGEyID0gcG9pbnRzWyhpKzEpICUgbGVuZ3RoXTtcclxuICAgICAgICB2YXIgaW50ZXIgPSBJbnRlcnNlY3Rpb24uaW50ZXJzZWN0QmV6aWVyM0xpbmUocDEsIHAyLCBwMywgcDQsIGExLCBhMik7XHJcblxyXG4gICAgICAgIHJlc3VsdC5hcHBlbmRQb2ludHMoaW50ZXIucG9pbnRzKTtcclxuICAgIH1cclxuXHJcbiAgICBpZiAoIHJlc3VsdC5wb2ludHMubGVuZ3RoID4gMCApIHJlc3VsdC5zdGF0dXMgPSBcIkludGVyc2VjdGlvblwiO1xyXG5cclxuICAgIHJldHVybiByZXN1bHQ7XHJcbn07XHJcblxyXG5cclxuLyoqXHJcbiAqICBpbnRlcnNlY3RCZXppZXIzUmVjdGFuZ2xlXHJcbiAqXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IHAxXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IHAyXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IHAzXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IHA0XHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IHIxXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IHIyXHJcbiAqICBAcmV0dXJucyB7SW50ZXJzZWN0aW9ufVxyXG4gKi9cclxuSW50ZXJzZWN0aW9uLmludGVyc2VjdEJlemllcjNSZWN0YW5nbGUgPSBmdW5jdGlvbihwMSwgcDIsIHAzLCBwNCwgcjEsIHIyKSB7XHJcbiAgICB2YXIgbWluICAgICAgICA9IHIxLm1pbihyMik7XHJcbiAgICB2YXIgbWF4ICAgICAgICA9IHIxLm1heChyMik7XHJcbiAgICB2YXIgdG9wUmlnaHQgICA9IG5ldyBQb2ludDJEKCBtYXgueCwgbWluLnkgKTtcclxuICAgIHZhciBib3R0b21MZWZ0ID0gbmV3IFBvaW50MkQoIG1pbi54LCBtYXgueSApO1xyXG5cclxuICAgIHZhciBpbnRlcjEgPSBJbnRlcnNlY3Rpb24uaW50ZXJzZWN0QmV6aWVyM0xpbmUocDEsIHAyLCBwMywgcDQsIG1pbiwgdG9wUmlnaHQpO1xyXG4gICAgdmFyIGludGVyMiA9IEludGVyc2VjdGlvbi5pbnRlcnNlY3RCZXppZXIzTGluZShwMSwgcDIsIHAzLCBwNCwgdG9wUmlnaHQsIG1heCk7XHJcbiAgICB2YXIgaW50ZXIzID0gSW50ZXJzZWN0aW9uLmludGVyc2VjdEJlemllcjNMaW5lKHAxLCBwMiwgcDMsIHA0LCBtYXgsIGJvdHRvbUxlZnQpO1xyXG4gICAgdmFyIGludGVyNCA9IEludGVyc2VjdGlvbi5pbnRlcnNlY3RCZXppZXIzTGluZShwMSwgcDIsIHAzLCBwNCwgYm90dG9tTGVmdCwgbWluKTtcclxuXHJcbiAgICB2YXIgcmVzdWx0ID0gbmV3IEludGVyc2VjdGlvbihcIk5vIEludGVyc2VjdGlvblwiKTtcclxuXHJcbiAgICByZXN1bHQuYXBwZW5kUG9pbnRzKGludGVyMS5wb2ludHMpO1xyXG4gICAgcmVzdWx0LmFwcGVuZFBvaW50cyhpbnRlcjIucG9pbnRzKTtcclxuICAgIHJlc3VsdC5hcHBlbmRQb2ludHMoaW50ZXIzLnBvaW50cyk7XHJcbiAgICByZXN1bHQuYXBwZW5kUG9pbnRzKGludGVyNC5wb2ludHMpO1xyXG5cclxuICAgIGlmICggcmVzdWx0LnBvaW50cy5sZW5ndGggPiAwICkgcmVzdWx0LnN0YXR1cyA9IFwiSW50ZXJzZWN0aW9uXCI7XHJcblxyXG4gICAgcmV0dXJuIHJlc3VsdDtcclxufTtcclxuXHJcblxyXG4vKipcclxuICogIGludGVyc2VjdENpcmNsZUNpcmNsZVxyXG4gKlxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBjMVxyXG4gKiAgQHBhcmFtIHtOdW1iZXJ9IHIxXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IGMyXHJcbiAqICBAcGFyYW0ge051bWJlcn0gcjJcclxuICogIEByZXR1cm5zIHtJbnRlcnNlY3Rpb259XHJcbiAqL1xyXG5JbnRlcnNlY3Rpb24uaW50ZXJzZWN0Q2lyY2xlQ2lyY2xlID0gZnVuY3Rpb24oYzEsIHIxLCBjMiwgcjIpIHtcclxuICAgIHZhciByZXN1bHQ7XHJcblxyXG4gICAgLy8gRGV0ZXJtaW5lIG1pbmltdW0gYW5kIG1heGltdW0gcmFkaWkgd2hlcmUgY2lyY2xlcyBjYW4gaW50ZXJzZWN0XHJcbiAgICB2YXIgcl9tYXggPSByMSArIHIyO1xyXG4gICAgdmFyIHJfbWluID0gTWF0aC5hYnMocjEgLSByMik7XHJcblxyXG4gICAgLy8gRGV0ZXJtaW5lIGFjdHVhbCBkaXN0YW5jZSBiZXR3ZWVuIGNpcmNsZSBjaXJjbGVzXHJcbiAgICB2YXIgY19kaXN0ID0gYzEuZGlzdGFuY2VGcm9tKCBjMiApO1xyXG5cclxuICAgIGlmICggY19kaXN0ID4gcl9tYXggKSB7XHJcbiAgICAgICAgcmVzdWx0ID0gbmV3IEludGVyc2VjdGlvbihcIk91dHNpZGVcIik7XHJcbiAgICB9IGVsc2UgaWYgKCBjX2Rpc3QgPCByX21pbiApIHtcclxuICAgICAgICByZXN1bHQgPSBuZXcgSW50ZXJzZWN0aW9uKFwiSW5zaWRlXCIpO1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgICByZXN1bHQgPSBuZXcgSW50ZXJzZWN0aW9uKFwiSW50ZXJzZWN0aW9uXCIpO1xyXG5cclxuICAgICAgICB2YXIgYSA9IChyMSpyMSAtIHIyKnIyICsgY19kaXN0KmNfZGlzdCkgLyAoIDIqY19kaXN0ICk7XHJcbiAgICAgICAgdmFyIGggPSBNYXRoLnNxcnQocjEqcjEgLSBhKmEpO1xyXG4gICAgICAgIHZhciBwID0gYzEubGVycChjMiwgYS9jX2Rpc3QpO1xyXG4gICAgICAgIHZhciBiID0gaCAvIGNfZGlzdDtcclxuXHJcbiAgICAgICAgcmVzdWx0LnBvaW50cy5wdXNoKFxyXG4gICAgICAgICAgICBuZXcgUG9pbnQyRChcclxuICAgICAgICAgICAgICAgIHAueCAtIGIgKiAoYzIueSAtIGMxLnkpLFxyXG4gICAgICAgICAgICAgICAgcC55ICsgYiAqIChjMi54IC0gYzEueClcclxuICAgICAgICAgICAgKVxyXG4gICAgICAgICk7XHJcbiAgICAgICAgcmVzdWx0LnBvaW50cy5wdXNoKFxyXG4gICAgICAgICAgICBuZXcgUG9pbnQyRChcclxuICAgICAgICAgICAgICAgIHAueCArIGIgKiAoYzIueSAtIGMxLnkpLFxyXG4gICAgICAgICAgICAgICAgcC55IC0gYiAqIChjMi54IC0gYzEueClcclxuICAgICAgICAgICAgKVxyXG4gICAgICAgICk7XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIHJlc3VsdDtcclxufTtcclxuXHJcblxyXG4vKipcclxuICogIGludGVyc2VjdENpcmNsZUVsbGlwc2VcclxuICpcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gY2NcclxuICogIEBwYXJhbSB7TnVtYmVyfSByXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IGVjXHJcbiAqICBAcGFyYW0ge051bWJlcn0gcnhcclxuICogIEBwYXJhbSB7TnVtYmVyfSByeVxyXG4gKiAgQHJldHVybnMge0ludGVyc2VjdGlvbn1cclxuICovXHJcbkludGVyc2VjdGlvbi5pbnRlcnNlY3RDaXJjbGVFbGxpcHNlID0gZnVuY3Rpb24oY2MsIHIsIGVjLCByeCwgcnkpIHtcclxuICAgIHJldHVybiBJbnRlcnNlY3Rpb24uaW50ZXJzZWN0RWxsaXBzZUVsbGlwc2UoY2MsIHIsIHIsIGVjLCByeCwgcnkpO1xyXG59O1xyXG5cclxuXHJcbi8qKlxyXG4gKiAgaW50ZXJzZWN0Q2lyY2xlTGluZVxyXG4gKlxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBjXHJcbiAqICBAcGFyYW0ge051bWJlcn0gclxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBhMVxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBhMlxyXG4gKiAgQHJldHVybnMge0ludGVyc2VjdGlvbn1cclxuICovXHJcbkludGVyc2VjdGlvbi5pbnRlcnNlY3RDaXJjbGVMaW5lID0gZnVuY3Rpb24oYywgciwgYTEsIGEyKSB7XHJcbiAgICB2YXIgcmVzdWx0O1xyXG4gICAgdmFyIGEgID0gKGEyLnggLSBhMS54KSAqIChhMi54IC0gYTEueCkgK1xyXG4gICAgICAgICAgICAgKGEyLnkgLSBhMS55KSAqIChhMi55IC0gYTEueSk7XHJcbiAgICB2YXIgYiAgPSAyICogKCAoYTIueCAtIGExLngpICogKGExLnggLSBjLngpICtcclxuICAgICAgICAgICAgICAgICAgIChhMi55IC0gYTEueSkgKiAoYTEueSAtIGMueSkgICApO1xyXG4gICAgdmFyIGNjID0gYy54KmMueCArIGMueSpjLnkgKyBhMS54KmExLnggKyBhMS55KmExLnkgLVxyXG4gICAgICAgICAgICAgMiAqIChjLnggKiBhMS54ICsgYy55ICogYTEueSkgLSByKnI7XHJcbiAgICB2YXIgZGV0ZXIgPSBiKmIgLSA0KmEqY2M7XHJcblxyXG4gICAgaWYgKCBkZXRlciA8IDAgKSB7XHJcbiAgICAgICAgcmVzdWx0ID0gbmV3IEludGVyc2VjdGlvbihcIk91dHNpZGVcIik7XHJcbiAgICB9IGVsc2UgaWYgKCBkZXRlciA9PSAwICkge1xyXG4gICAgICAgIHJlc3VsdCA9IG5ldyBJbnRlcnNlY3Rpb24oXCJUYW5nZW50XCIpO1xyXG4gICAgICAgIC8vIE5PVEU6IHNob3VsZCBjYWxjdWxhdGUgdGhpcyBwb2ludFxyXG4gICAgfSBlbHNlIHtcclxuICAgICAgICB2YXIgZSAgPSBNYXRoLnNxcnQoZGV0ZXIpO1xyXG4gICAgICAgIHZhciB1MSA9ICggLWIgKyBlICkgLyAoIDIqYSApO1xyXG4gICAgICAgIHZhciB1MiA9ICggLWIgLSBlICkgLyAoIDIqYSApO1xyXG5cclxuICAgICAgICBpZiAoICh1MSA8IDAgfHwgdTEgPiAxKSAmJiAodTIgPCAwIHx8IHUyID4gMSkgKSB7XHJcbiAgICAgICAgICAgIGlmICggKHUxIDwgMCAmJiB1MiA8IDApIHx8ICh1MSA+IDEgJiYgdTIgPiAxKSApIHtcclxuICAgICAgICAgICAgICAgIHJlc3VsdCA9IG5ldyBJbnRlcnNlY3Rpb24oXCJPdXRzaWRlXCIpO1xyXG4gICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgcmVzdWx0ID0gbmV3IEludGVyc2VjdGlvbihcIkluc2lkZVwiKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgIHJlc3VsdCA9IG5ldyBJbnRlcnNlY3Rpb24oXCJJbnRlcnNlY3Rpb25cIik7XHJcblxyXG4gICAgICAgICAgICBpZiAoIDAgPD0gdTEgJiYgdTEgPD0gMSlcclxuICAgICAgICAgICAgICAgIHJlc3VsdC5wb2ludHMucHVzaCggYTEubGVycChhMiwgdTEpICk7XHJcblxyXG4gICAgICAgICAgICBpZiAoIDAgPD0gdTIgJiYgdTIgPD0gMSlcclxuICAgICAgICAgICAgICAgIHJlc3VsdC5wb2ludHMucHVzaCggYTEubGVycChhMiwgdTIpICk7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiByZXN1bHQ7XHJcbn07XHJcblxyXG5cclxuLyoqXHJcbiAqICBpbnRlcnNlY3RDaXJjbGVQb2x5Z29uXHJcbiAqXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IGNcclxuICogIEBwYXJhbSB7TnVtYmVyfSByXHJcbiAqICBAcGFyYW0ge0FycmF5PFBvaW50MkQ+fSBwb2ludHNcclxuICogIEByZXR1cm5zIHtJbnRlcnNlY3Rpb259XHJcbiAqL1xyXG5JbnRlcnNlY3Rpb24uaW50ZXJzZWN0Q2lyY2xlUG9seWdvbiA9IGZ1bmN0aW9uKGMsIHIsIHBvaW50cykge1xyXG4gICAgdmFyIHJlc3VsdCA9IG5ldyBJbnRlcnNlY3Rpb24oXCJObyBJbnRlcnNlY3Rpb25cIik7XHJcbiAgICB2YXIgbGVuZ3RoID0gcG9pbnRzLmxlbmd0aDtcclxuICAgIHZhciBpbnRlcjtcclxuXHJcbiAgICBmb3IgKCB2YXIgaSA9IDA7IGkgPCBsZW5ndGg7IGkrKyApIHtcclxuICAgICAgICB2YXIgYTEgPSBwb2ludHNbaV07XHJcbiAgICAgICAgdmFyIGEyID0gcG9pbnRzWyhpKzEpICUgbGVuZ3RoXTtcclxuXHJcbiAgICAgICAgaW50ZXIgPSBJbnRlcnNlY3Rpb24uaW50ZXJzZWN0Q2lyY2xlTGluZShjLCByLCBhMSwgYTIpO1xyXG4gICAgICAgIHJlc3VsdC5hcHBlbmRQb2ludHMoaW50ZXIucG9pbnRzKTtcclxuICAgIH1cclxuXHJcbiAgICBpZiAoIHJlc3VsdC5wb2ludHMubGVuZ3RoID4gMCApXHJcbiAgICAgICAgcmVzdWx0LnN0YXR1cyA9IFwiSW50ZXJzZWN0aW9uXCI7XHJcbiAgICBlbHNlXHJcbiAgICAgICAgcmVzdWx0LnN0YXR1cyA9IGludGVyLnN0YXR1cztcclxuXHJcbiAgICByZXR1cm4gcmVzdWx0O1xyXG59O1xyXG5cclxuXHJcbi8qKlxyXG4gKiAgaW50ZXJzZWN0Q2lyY2xlUmVjdGFuZ2xlXHJcbiAqXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IGNcclxuICogIEBwYXJhbSB7TnVtYmVyfSByXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IHIxXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IHIyXHJcbiAqICBAcmV0dXJucyB7SW50ZXJzZWN0aW9ufVxyXG4gKi9cclxuSW50ZXJzZWN0aW9uLmludGVyc2VjdENpcmNsZVJlY3RhbmdsZSA9IGZ1bmN0aW9uKGMsIHIsIHIxLCByMikge1xyXG4gICAgdmFyIG1pbiAgICAgICAgPSByMS5taW4ocjIpO1xyXG4gICAgdmFyIG1heCAgICAgICAgPSByMS5tYXgocjIpO1xyXG4gICAgdmFyIHRvcFJpZ2h0ICAgPSBuZXcgUG9pbnQyRCggbWF4LngsIG1pbi55ICk7XHJcbiAgICB2YXIgYm90dG9tTGVmdCA9IG5ldyBQb2ludDJEKCBtaW4ueCwgbWF4LnkgKTtcclxuXHJcbiAgICB2YXIgaW50ZXIxID0gSW50ZXJzZWN0aW9uLmludGVyc2VjdENpcmNsZUxpbmUoYywgciwgbWluLCB0b3BSaWdodCk7XHJcbiAgICB2YXIgaW50ZXIyID0gSW50ZXJzZWN0aW9uLmludGVyc2VjdENpcmNsZUxpbmUoYywgciwgdG9wUmlnaHQsIG1heCk7XHJcbiAgICB2YXIgaW50ZXIzID0gSW50ZXJzZWN0aW9uLmludGVyc2VjdENpcmNsZUxpbmUoYywgciwgbWF4LCBib3R0b21MZWZ0KTtcclxuICAgIHZhciBpbnRlcjQgPSBJbnRlcnNlY3Rpb24uaW50ZXJzZWN0Q2lyY2xlTGluZShjLCByLCBib3R0b21MZWZ0LCBtaW4pO1xyXG5cclxuICAgIHZhciByZXN1bHQgPSBuZXcgSW50ZXJzZWN0aW9uKFwiTm8gSW50ZXJzZWN0aW9uXCIpO1xyXG5cclxuICAgIHJlc3VsdC5hcHBlbmRQb2ludHMoaW50ZXIxLnBvaW50cyk7XHJcbiAgICByZXN1bHQuYXBwZW5kUG9pbnRzKGludGVyMi5wb2ludHMpO1xyXG4gICAgcmVzdWx0LmFwcGVuZFBvaW50cyhpbnRlcjMucG9pbnRzKTtcclxuICAgIHJlc3VsdC5hcHBlbmRQb2ludHMoaW50ZXI0LnBvaW50cyk7XHJcblxyXG4gICAgaWYgKCByZXN1bHQucG9pbnRzLmxlbmd0aCA+IDAgKVxyXG4gICAgICAgIHJlc3VsdC5zdGF0dXMgPSBcIkludGVyc2VjdGlvblwiO1xyXG4gICAgZWxzZVxyXG4gICAgICAgIHJlc3VsdC5zdGF0dXMgPSBpbnRlcjEuc3RhdHVzO1xyXG5cclxuICAgIHJldHVybiByZXN1bHQ7XHJcbn07XHJcblxyXG5cclxuLyoqXHJcbiAqICBpbnRlcnNlY3RFbGxpcHNlRWxsaXBzZVxyXG4gKlxyXG4gKiAgVGhpcyBjb2RlIGlzIGJhc2VkIG9uIE1nY0ludHIyREVscEVscC5jcHAgd3JpdHRlbiBieSBEYXZpZCBFYmVybHkuICBIaXNcclxuICogIGNvZGUgYWxvbmcgd2l0aCBtYW55IG90aGVyIGV4Y2VsbGVudCBleGFtcGxlcyBhcmUgYXZhaWFibGUgYXQgaGlzIHNpdGU6XHJcbiAqICBodHRwOi8vd3d3Lm1hZ2ljLXNvZnR3YXJlLmNvbVxyXG4gKlxyXG4gKiAgTk9URTogUm90YXRpb24gd2lsbCBuZWVkIHRvIGJlIGFkZGVkIHRvIHRoaXMgZnVuY3Rpb25cclxuICpcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gYzFcclxuICogIEBwYXJhbSB7TnVtYmVyfSByeDFcclxuICogIEBwYXJhbSB7TnVtYmVyfSByeTFcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gYzJcclxuICogIEBwYXJhbSB7TnVtYmVyfSByeDJcclxuICogIEBwYXJhbSB7TnVtYmVyfSByeTJcclxuICogIEByZXR1cm5zIHtJbnRlcnNlY3Rpb259XHJcbiAqL1xyXG5JbnRlcnNlY3Rpb24uaW50ZXJzZWN0RWxsaXBzZUVsbGlwc2UgPSBmdW5jdGlvbihjMSwgcngxLCByeTEsIGMyLCByeDIsIHJ5Mikge1xyXG4gICAgdmFyIGEgPSBbXHJcbiAgICAgICAgcnkxKnJ5MSwgMCwgcngxKnJ4MSwgLTIqcnkxKnJ5MSpjMS54LCAtMipyeDEqcngxKmMxLnksXHJcbiAgICAgICAgcnkxKnJ5MSpjMS54KmMxLnggKyByeDEqcngxKmMxLnkqYzEueSAtIHJ4MSpyeDEqcnkxKnJ5MVxyXG4gICAgXTtcclxuICAgIHZhciBiID0gW1xyXG4gICAgICAgIHJ5MipyeTIsIDAsIHJ4MipyeDIsIC0yKnJ5MipyeTIqYzIueCwgLTIqcngyKnJ4MipjMi55LFxyXG4gICAgICAgIHJ5MipyeTIqYzIueCpjMi54ICsgcngyKnJ4MipjMi55KmMyLnkgLSByeDIqcngyKnJ5MipyeTJcclxuICAgIF07XHJcblxyXG4gICAgdmFyIHlQb2x5ICAgPSBJbnRlcnNlY3Rpb24uYmV6b3V0KGEsIGIpO1xyXG4gICAgdmFyIHlSb290cyAgPSB5UG9seS5nZXRSb290cygpO1xyXG4gICAgdmFyIGVwc2lsb24gPSAxZS0zO1xyXG4gICAgdmFyIG5vcm0wICAgPSAoIGFbMF0qYVswXSArIDIqYVsxXSphWzFdICsgYVsyXSphWzJdICkgKiBlcHNpbG9uO1xyXG4gICAgdmFyIG5vcm0xICAgPSAoIGJbMF0qYlswXSArIDIqYlsxXSpiWzFdICsgYlsyXSpiWzJdICkgKiBlcHNpbG9uO1xyXG4gICAgdmFyIHJlc3VsdCAgPSBuZXcgSW50ZXJzZWN0aW9uKFwiTm8gSW50ZXJzZWN0aW9uXCIpO1xyXG5cclxuICAgIGZvciAoIHZhciB5ID0gMDsgeSA8IHlSb290cy5sZW5ndGg7IHkrKyApIHtcclxuICAgICAgICB2YXIgeFBvbHkgPSBuZXcgUG9seW5vbWlhbChcclxuICAgICAgICAgICAgYVswXSxcclxuICAgICAgICAgICAgYVszXSArIHlSb290c1t5XSAqIGFbMV0sXHJcbiAgICAgICAgICAgIGFbNV0gKyB5Um9vdHNbeV0gKiAoYVs0XSArIHlSb290c1t5XSphWzJdKVxyXG4gICAgICAgICk7XHJcbiAgICAgICAgdmFyIHhSb290cyA9IHhQb2x5LmdldFJvb3RzKCk7XHJcblxyXG4gICAgICAgIGZvciAoIHZhciB4ID0gMDsgeCA8IHhSb290cy5sZW5ndGg7IHgrKyApIHtcclxuICAgICAgICAgICAgdmFyIHRlc3QgPVxyXG4gICAgICAgICAgICAgICAgKCBhWzBdKnhSb290c1t4XSArIGFbMV0qeVJvb3RzW3ldICsgYVszXSApICogeFJvb3RzW3hdICtcclxuICAgICAgICAgICAgICAgICggYVsyXSp5Um9vdHNbeV0gKyBhWzRdICkgKiB5Um9vdHNbeV0gKyBhWzVdO1xyXG4gICAgICAgICAgICBpZiAoIE1hdGguYWJzKHRlc3QpIDwgbm9ybTAgKSB7XHJcbiAgICAgICAgICAgICAgICB0ZXN0ID1cclxuICAgICAgICAgICAgICAgICAgICAoIGJbMF0qeFJvb3RzW3hdICsgYlsxXSp5Um9vdHNbeV0gKyBiWzNdICkgKiB4Um9vdHNbeF0gK1xyXG4gICAgICAgICAgICAgICAgICAgICggYlsyXSp5Um9vdHNbeV0gKyBiWzRdICkgKiB5Um9vdHNbeV0gKyBiWzVdO1xyXG4gICAgICAgICAgICAgICAgaWYgKCBNYXRoLmFicyh0ZXN0KSA8IG5vcm0xICkge1xyXG4gICAgICAgICAgICAgICAgICAgIHJlc3VsdC5hcHBlbmRQb2ludCggbmV3IFBvaW50MkQoIHhSb290c1t4XSwgeVJvb3RzW3ldICkgKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICBpZiAoIHJlc3VsdC5wb2ludHMubGVuZ3RoID4gMCApIHJlc3VsdC5zdGF0dXMgPSBcIkludGVyc2VjdGlvblwiO1xyXG5cclxuICAgIHJldHVybiByZXN1bHQ7XHJcbn07XHJcblxyXG5cclxuLyoqXHJcbiAqICBpbnRlcnNlY3RFbGxpcHNlTGluZVxyXG4gKlxyXG4gKiAgTk9URTogUm90YXRpb24gd2lsbCBuZWVkIHRvIGJlIGFkZGVkIHRvIHRoaXMgZnVuY3Rpb25cclxuICpcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gY1xyXG4gKiAgQHBhcmFtIHtOdW1iZXJ9IHJ4XHJcbiAqICBAcGFyYW0ge051bWJlcn0gcnlcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gYTFcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gYTJcclxuICogIEByZXR1cm5zIHtJbnRlcnNlY3Rpb259XHJcbiAqL1xyXG5JbnRlcnNlY3Rpb24uaW50ZXJzZWN0RWxsaXBzZUxpbmUgPSBmdW5jdGlvbihjLCByeCwgcnksIGExLCBhMikge1xyXG4gICAgdmFyIHJlc3VsdDtcclxuICAgIHZhciBvcmlnaW4gPSBuZXcgVmVjdG9yMkQoYTEueCwgYTEueSk7XHJcbiAgICB2YXIgZGlyICAgID0gVmVjdG9yMkQuZnJvbVBvaW50cyhhMSwgYTIpO1xyXG4gICAgdmFyIGNlbnRlciA9IG5ldyBWZWN0b3IyRChjLngsIGMueSk7XHJcbiAgICB2YXIgZGlmZiAgID0gb3JpZ2luLnN1YnRyYWN0KGNlbnRlcik7XHJcbiAgICB2YXIgbURpciAgID0gbmV3IFZlY3RvcjJEKCBkaXIueC8ocngqcngpLCAgZGlyLnkvKHJ5KnJ5KSAgKTtcclxuICAgIHZhciBtRGlmZiAgPSBuZXcgVmVjdG9yMkQoIGRpZmYueC8ocngqcngpLCBkaWZmLnkvKHJ5KnJ5KSApO1xyXG5cclxuICAgIHZhciBhID0gZGlyLmRvdChtRGlyKTtcclxuICAgIHZhciBiID0gZGlyLmRvdChtRGlmZik7XHJcbiAgICB2YXIgYyA9IGRpZmYuZG90KG1EaWZmKSAtIDEuMDtcclxuICAgIHZhciBkID0gYipiIC0gYSpjO1xyXG5cclxuICAgIGlmICggZCA8IDAgKSB7XHJcbiAgICAgICAgcmVzdWx0ID0gbmV3IEludGVyc2VjdGlvbihcIk91dHNpZGVcIik7XHJcbiAgICB9IGVsc2UgaWYgKCBkID4gMCApIHtcclxuICAgICAgICB2YXIgcm9vdCA9IE1hdGguc3FydChkKTtcclxuICAgICAgICB2YXIgdF9hICA9ICgtYiAtIHJvb3QpIC8gYTtcclxuICAgICAgICB2YXIgdF9iICA9ICgtYiArIHJvb3QpIC8gYTtcclxuXHJcbiAgICAgICAgaWYgKCAodF9hIDwgMCB8fCAxIDwgdF9hKSAmJiAodF9iIDwgMCB8fCAxIDwgdF9iKSApIHtcclxuICAgICAgICAgICAgaWYgKCAodF9hIDwgMCAmJiB0X2IgPCAwKSB8fCAodF9hID4gMSAmJiB0X2IgPiAxKSApXHJcbiAgICAgICAgICAgICAgICByZXN1bHQgPSBuZXcgSW50ZXJzZWN0aW9uKFwiT3V0c2lkZVwiKTtcclxuICAgICAgICAgICAgZWxzZVxyXG4gICAgICAgICAgICAgICAgcmVzdWx0ID0gbmV3IEludGVyc2VjdGlvbihcIkluc2lkZVwiKTtcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICByZXN1bHQgPSBuZXcgSW50ZXJzZWN0aW9uKFwiSW50ZXJzZWN0aW9uXCIpO1xyXG4gICAgICAgICAgICBpZiAoIDAgPD0gdF9hICYmIHRfYSA8PSAxIClcclxuICAgICAgICAgICAgICAgIHJlc3VsdC5hcHBlbmRQb2ludCggYTEubGVycChhMiwgdF9hKSApO1xyXG4gICAgICAgICAgICBpZiAoIDAgPD0gdF9iICYmIHRfYiA8PSAxIClcclxuICAgICAgICAgICAgICAgIHJlc3VsdC5hcHBlbmRQb2ludCggYTEubGVycChhMiwgdF9iKSApO1xyXG4gICAgICAgIH1cclxuICAgIH0gZWxzZSB7XHJcbiAgICAgICAgdmFyIHQgPSAtYi9hO1xyXG4gICAgICAgIGlmICggMCA8PSB0ICYmIHQgPD0gMSApIHtcclxuICAgICAgICAgICAgcmVzdWx0ID0gbmV3IEludGVyc2VjdGlvbihcIkludGVyc2VjdGlvblwiKTtcclxuICAgICAgICAgICAgcmVzdWx0LmFwcGVuZFBvaW50KCBhMS5sZXJwKGEyLCB0KSApO1xyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgIHJlc3VsdCA9IG5ldyBJbnRlcnNlY3Rpb24oXCJPdXRzaWRlXCIpO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gcmVzdWx0O1xyXG59O1xyXG5cclxuXHJcbi8qKlxyXG4gKiAgaW50ZXJzZWN0RWxsaXBzZVBvbHlnb25cclxuICpcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gY1xyXG4gKiAgQHBhcmFtIHtOdW1iZXJ9IHJ4XHJcbiAqICBAcGFyYW0ge051bWJlcn0gcnlcclxuICogIEBwYXJhbSB7QXJyYXk8UG9pbnQyRD59IGMyXHJcbiAqICBAcmV0dXJucyB7SW50ZXJzZWN0aW9ufVxyXG4gKi9cclxuSW50ZXJzZWN0aW9uLmludGVyc2VjdEVsbGlwc2VQb2x5Z29uID0gZnVuY3Rpb24oYywgcngsIHJ5LCBwb2ludHMpIHtcclxuICAgIHZhciByZXN1bHQgPSBuZXcgSW50ZXJzZWN0aW9uKFwiTm8gSW50ZXJzZWN0aW9uXCIpO1xyXG4gICAgdmFyIGxlbmd0aCA9IHBvaW50cy5sZW5ndGg7XHJcblxyXG4gICAgZm9yICggdmFyIGkgPSAwOyBpIDwgbGVuZ3RoOyBpKysgKSB7XHJcbiAgICAgICAgdmFyIGIxID0gcG9pbnRzW2ldO1xyXG4gICAgICAgIHZhciBiMiA9IHBvaW50c1soaSsxKSAlIGxlbmd0aF07XHJcbiAgICAgICAgdmFyIGludGVyID0gSW50ZXJzZWN0aW9uLmludGVyc2VjdEVsbGlwc2VMaW5lKGMsIHJ4LCByeSwgYjEsIGIyKTtcclxuXHJcbiAgICAgICAgcmVzdWx0LmFwcGVuZFBvaW50cyhpbnRlci5wb2ludHMpO1xyXG4gICAgfVxyXG5cclxuICAgIGlmICggcmVzdWx0LnBvaW50cy5sZW5ndGggPiAwIClcclxuICAgICAgICByZXN1bHQuc3RhdHVzID0gXCJJbnRlcnNlY3Rpb25cIjtcclxuXHJcbiAgICByZXR1cm4gcmVzdWx0O1xyXG59O1xyXG5cclxuXHJcbi8qKlxyXG4gKiAgaW50ZXJzZWN0RWxsaXBzZVJlY3RhbmdsZVxyXG4gKlxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBjXHJcbiAqICBAcGFyYW0ge051bWJlcn0gcnhcclxuICogIEBwYXJhbSB7TnVtYmVyfSByeVxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSByMVxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSByMlxyXG4gKiAgQHJldHVybnMge0ludGVyc2VjdGlvbn1cclxuICovXHJcbkludGVyc2VjdGlvbi5pbnRlcnNlY3RFbGxpcHNlUmVjdGFuZ2xlID0gZnVuY3Rpb24oYywgcngsIHJ5LCByMSwgcjIpIHtcclxuICAgIHZhciBtaW4gICAgICAgID0gcjEubWluKHIyKTtcclxuICAgIHZhciBtYXggICAgICAgID0gcjEubWF4KHIyKTtcclxuICAgIHZhciB0b3BSaWdodCAgID0gbmV3IFBvaW50MkQoIG1heC54LCBtaW4ueSApO1xyXG4gICAgdmFyIGJvdHRvbUxlZnQgPSBuZXcgUG9pbnQyRCggbWluLngsIG1heC55ICk7XHJcblxyXG4gICAgdmFyIGludGVyMSA9IEludGVyc2VjdGlvbi5pbnRlcnNlY3RFbGxpcHNlTGluZShjLCByeCwgcnksIG1pbiwgdG9wUmlnaHQpO1xyXG4gICAgdmFyIGludGVyMiA9IEludGVyc2VjdGlvbi5pbnRlcnNlY3RFbGxpcHNlTGluZShjLCByeCwgcnksIHRvcFJpZ2h0LCBtYXgpO1xyXG4gICAgdmFyIGludGVyMyA9IEludGVyc2VjdGlvbi5pbnRlcnNlY3RFbGxpcHNlTGluZShjLCByeCwgcnksIG1heCwgYm90dG9tTGVmdCk7XHJcbiAgICB2YXIgaW50ZXI0ID0gSW50ZXJzZWN0aW9uLmludGVyc2VjdEVsbGlwc2VMaW5lKGMsIHJ4LCByeSwgYm90dG9tTGVmdCwgbWluKTtcclxuXHJcbiAgICB2YXIgcmVzdWx0ID0gbmV3IEludGVyc2VjdGlvbihcIk5vIEludGVyc2VjdGlvblwiKTtcclxuXHJcbiAgICByZXN1bHQuYXBwZW5kUG9pbnRzKGludGVyMS5wb2ludHMpO1xyXG4gICAgcmVzdWx0LmFwcGVuZFBvaW50cyhpbnRlcjIucG9pbnRzKTtcclxuICAgIHJlc3VsdC5hcHBlbmRQb2ludHMoaW50ZXIzLnBvaW50cyk7XHJcbiAgICByZXN1bHQuYXBwZW5kUG9pbnRzKGludGVyNC5wb2ludHMpO1xyXG5cclxuICAgIGlmICggcmVzdWx0LnBvaW50cy5sZW5ndGggPiAwIClcclxuICAgICAgICByZXN1bHQuc3RhdHVzID0gXCJJbnRlcnNlY3Rpb25cIjtcclxuXHJcbiAgICByZXR1cm4gcmVzdWx0O1xyXG59O1xyXG5cclxuXHJcbi8qKlxyXG4gKiAgaW50ZXJzZWN0TGluZUxpbmVcclxuICpcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gYTFcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gYTJcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gYjFcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gYjJcclxuICogIEByZXR1cm5zIHtJbnRlcnNlY3Rpb259XHJcbiAqL1xyXG5JbnRlcnNlY3Rpb24uaW50ZXJzZWN0TGluZUxpbmUgPSBmdW5jdGlvbihhMSwgYTIsIGIxLCBiMikge1xyXG4gICAgdmFyIHJlc3VsdDtcclxuXHJcbiAgICB2YXIgdWFfdCA9IChiMi54IC0gYjEueCkgKiAoYTEueSAtIGIxLnkpIC0gKGIyLnkgLSBiMS55KSAqIChhMS54IC0gYjEueCk7XHJcbiAgICB2YXIgdWJfdCA9IChhMi54IC0gYTEueCkgKiAoYTEueSAtIGIxLnkpIC0gKGEyLnkgLSBhMS55KSAqIChhMS54IC0gYjEueCk7XHJcbiAgICB2YXIgdV9iICA9IChiMi55IC0gYjEueSkgKiAoYTIueCAtIGExLngpIC0gKGIyLnggLSBiMS54KSAqIChhMi55IC0gYTEueSk7XHJcblxyXG4gICAgaWYgKCB1X2IgIT0gMCApIHtcclxuICAgICAgICB2YXIgdWEgPSB1YV90IC8gdV9iO1xyXG4gICAgICAgIHZhciB1YiA9IHViX3QgLyB1X2I7XHJcblxyXG4gICAgICAgIGlmICggMCA8PSB1YSAmJiB1YSA8PSAxICYmIDAgPD0gdWIgJiYgdWIgPD0gMSApIHtcclxuICAgICAgICAgICAgcmVzdWx0ID0gbmV3IEludGVyc2VjdGlvbihcIkludGVyc2VjdGlvblwiKTtcclxuICAgICAgICAgICAgcmVzdWx0LnBvaW50cy5wdXNoKFxyXG4gICAgICAgICAgICAgICAgbmV3IFBvaW50MkQoXHJcbiAgICAgICAgICAgICAgICAgICAgYTEueCArIHVhICogKGEyLnggLSBhMS54KSxcclxuICAgICAgICAgICAgICAgICAgICBhMS55ICsgdWEgKiAoYTIueSAtIGExLnkpXHJcbiAgICAgICAgICAgICAgICApXHJcbiAgICAgICAgICAgICk7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgcmVzdWx0ID0gbmV3IEludGVyc2VjdGlvbihcIk5vIEludGVyc2VjdGlvblwiKTtcclxuICAgICAgICB9XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICAgIGlmICggdWFfdCA9PSAwIHx8IHViX3QgPT0gMCApIHtcclxuICAgICAgICAgICAgcmVzdWx0ID0gbmV3IEludGVyc2VjdGlvbihcIkNvaW5jaWRlbnRcIik7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgcmVzdWx0ID0gbmV3IEludGVyc2VjdGlvbihcIlBhcmFsbGVsXCIpO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gcmVzdWx0O1xyXG59O1xyXG5cclxuXHJcbi8qKlxyXG4gKiAgaW50ZXJzZWN0TGluZVBvbHlnb25cclxuICpcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gYTFcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gYTJcclxuICogIEBwYXJhbSB7QXJyYXk8UG9pbnQyRD59IHBvaW50c1xyXG4gKiAgQHJldHVybnMge0ludGVyc2VjdGlvbn1cclxuICovXHJcbkludGVyc2VjdGlvbi5pbnRlcnNlY3RMaW5lUG9seWdvbiA9IGZ1bmN0aW9uKGExLCBhMiwgcG9pbnRzKSB7XHJcbiAgICB2YXIgcmVzdWx0ID0gbmV3IEludGVyc2VjdGlvbihcIk5vIEludGVyc2VjdGlvblwiKTtcclxuICAgIHZhciBsZW5ndGggPSBwb2ludHMubGVuZ3RoO1xyXG5cclxuICAgIGZvciAoIHZhciBpID0gMDsgaSA8IGxlbmd0aDsgaSsrICkge1xyXG4gICAgICAgIHZhciBiMSA9IHBvaW50c1tpXTtcclxuICAgICAgICB2YXIgYjIgPSBwb2ludHNbKGkrMSkgJSBsZW5ndGhdO1xyXG4gICAgICAgIHZhciBpbnRlciA9IEludGVyc2VjdGlvbi5pbnRlcnNlY3RMaW5lTGluZShhMSwgYTIsIGIxLCBiMik7XHJcblxyXG4gICAgICAgIHJlc3VsdC5hcHBlbmRQb2ludHMoaW50ZXIucG9pbnRzKTtcclxuICAgIH1cclxuXHJcbiAgICBpZiAoIHJlc3VsdC5wb2ludHMubGVuZ3RoID4gMCApIHJlc3VsdC5zdGF0dXMgPSBcIkludGVyc2VjdGlvblwiO1xyXG5cclxuICAgIHJldHVybiByZXN1bHQ7XHJcbn07XHJcblxyXG5cclxuLyoqXHJcbiAqICBpbnRlcnNlY3RMaW5lUmVjdGFuZ2xlXHJcbiAqXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IGExXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IGEyXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IHIxXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IHIyXHJcbiAqICBAcmV0dXJucyB7SW50ZXJzZWN0aW9ufVxyXG4gKi9cclxuSW50ZXJzZWN0aW9uLmludGVyc2VjdExpbmVSZWN0YW5nbGUgPSBmdW5jdGlvbihhMSwgYTIsIHIxLCByMikge1xyXG4gICAgdmFyIG1pbiAgICAgICAgPSByMS5taW4ocjIpO1xyXG4gICAgdmFyIG1heCAgICAgICAgPSByMS5tYXgocjIpO1xyXG4gICAgdmFyIHRvcFJpZ2h0ICAgPSBuZXcgUG9pbnQyRCggbWF4LngsIG1pbi55ICk7XHJcbiAgICB2YXIgYm90dG9tTGVmdCA9IG5ldyBQb2ludDJEKCBtaW4ueCwgbWF4LnkgKTtcclxuXHJcbiAgICB2YXIgaW50ZXIxID0gSW50ZXJzZWN0aW9uLmludGVyc2VjdExpbmVMaW5lKG1pbiwgdG9wUmlnaHQsIGExLCBhMik7XHJcbiAgICB2YXIgaW50ZXIyID0gSW50ZXJzZWN0aW9uLmludGVyc2VjdExpbmVMaW5lKHRvcFJpZ2h0LCBtYXgsIGExLCBhMik7XHJcbiAgICB2YXIgaW50ZXIzID0gSW50ZXJzZWN0aW9uLmludGVyc2VjdExpbmVMaW5lKG1heCwgYm90dG9tTGVmdCwgYTEsIGEyKTtcclxuICAgIHZhciBpbnRlcjQgPSBJbnRlcnNlY3Rpb24uaW50ZXJzZWN0TGluZUxpbmUoYm90dG9tTGVmdCwgbWluLCBhMSwgYTIpO1xyXG5cclxuICAgIHZhciByZXN1bHQgPSBuZXcgSW50ZXJzZWN0aW9uKFwiTm8gSW50ZXJzZWN0aW9uXCIpO1xyXG5cclxuICAgIHJlc3VsdC5hcHBlbmRQb2ludHMoaW50ZXIxLnBvaW50cyk7XHJcbiAgICByZXN1bHQuYXBwZW5kUG9pbnRzKGludGVyMi5wb2ludHMpO1xyXG4gICAgcmVzdWx0LmFwcGVuZFBvaW50cyhpbnRlcjMucG9pbnRzKTtcclxuICAgIHJlc3VsdC5hcHBlbmRQb2ludHMoaW50ZXI0LnBvaW50cyk7XHJcblxyXG4gICAgaWYgKCByZXN1bHQucG9pbnRzLmxlbmd0aCA+IDAgKVxyXG4gICAgICAgIHJlc3VsdC5zdGF0dXMgPSBcIkludGVyc2VjdGlvblwiO1xyXG5cclxuICAgIHJldHVybiByZXN1bHQ7XHJcbn07XHJcblxyXG5cclxuLyoqXHJcbiAqICBpbnRlcnNlY3RQb2x5Z29uUG9seWdvblxyXG4gKlxyXG4gKiAgQHBhcmFtIHtBcnJheTxQb2ludDJEPn0gcG9pbnRzMVxyXG4gKiAgQHBhcmFtIHtBcnJheTxQb2ludDJEPn0gcG9pbnRzMlxyXG4gKiAgQHJldHVybnMge0ludGVyc2VjdGlvbn1cclxuICovXHJcbkludGVyc2VjdGlvbi5pbnRlcnNlY3RQb2x5Z29uUG9seWdvbiA9IGZ1bmN0aW9uKHBvaW50czEsIHBvaW50czIpIHtcclxuICAgIHZhciByZXN1bHQgPSBuZXcgSW50ZXJzZWN0aW9uKFwiTm8gSW50ZXJzZWN0aW9uXCIpO1xyXG4gICAgdmFyIGxlbmd0aCA9IHBvaW50czEubGVuZ3RoO1xyXG5cclxuICAgIGZvciAoIHZhciBpID0gMDsgaSA8IGxlbmd0aDsgaSsrICkge1xyXG4gICAgICAgIHZhciBhMSA9IHBvaW50czFbaV07XHJcbiAgICAgICAgdmFyIGEyID0gcG9pbnRzMVsoaSsxKSAlIGxlbmd0aF07XHJcbiAgICAgICAgdmFyIGludGVyID0gSW50ZXJzZWN0aW9uLmludGVyc2VjdExpbmVQb2x5Z29uKGExLCBhMiwgcG9pbnRzMik7XHJcblxyXG4gICAgICAgIHJlc3VsdC5hcHBlbmRQb2ludHMoaW50ZXIucG9pbnRzKTtcclxuICAgIH1cclxuXHJcbiAgICBpZiAoIHJlc3VsdC5wb2ludHMubGVuZ3RoID4gMCApXHJcbiAgICAgICAgcmVzdWx0LnN0YXR1cyA9IFwiSW50ZXJzZWN0aW9uXCI7XHJcblxyXG4gICAgcmV0dXJuIHJlc3VsdDtcclxuXHJcbn07XHJcblxyXG5cclxuLyoqXHJcbiAqICBpbnRlcnNlY3RQb2x5Z29uUmVjdGFuZ2xlXHJcbiAqXHJcbiAqICBAcGFyYW0ge0FycmF5PFBvaW50MkQ+fSBwb2ludHNcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gcjFcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gcjJcclxuICogIEByZXR1cm5zIHtJbnRlcnNlY3Rpb259XHJcbiAqL1xyXG5JbnRlcnNlY3Rpb24uaW50ZXJzZWN0UG9seWdvblJlY3RhbmdsZSA9IGZ1bmN0aW9uKHBvaW50cywgcjEsIHIyKSB7XHJcbiAgICB2YXIgbWluICAgICAgICA9IHIxLm1pbihyMik7XHJcbiAgICB2YXIgbWF4ICAgICAgICA9IHIxLm1heChyMik7XHJcbiAgICB2YXIgdG9wUmlnaHQgICA9IG5ldyBQb2ludDJEKCBtYXgueCwgbWluLnkgKTtcclxuICAgIHZhciBib3R0b21MZWZ0ID0gbmV3IFBvaW50MkQoIG1pbi54LCBtYXgueSApO1xyXG5cclxuICAgIHZhciBpbnRlcjEgPSBJbnRlcnNlY3Rpb24uaW50ZXJzZWN0TGluZVBvbHlnb24obWluLCB0b3BSaWdodCwgcG9pbnRzKTtcclxuICAgIHZhciBpbnRlcjIgPSBJbnRlcnNlY3Rpb24uaW50ZXJzZWN0TGluZVBvbHlnb24odG9wUmlnaHQsIG1heCwgcG9pbnRzKTtcclxuICAgIHZhciBpbnRlcjMgPSBJbnRlcnNlY3Rpb24uaW50ZXJzZWN0TGluZVBvbHlnb24obWF4LCBib3R0b21MZWZ0LCBwb2ludHMpO1xyXG4gICAgdmFyIGludGVyNCA9IEludGVyc2VjdGlvbi5pbnRlcnNlY3RMaW5lUG9seWdvbihib3R0b21MZWZ0LCBtaW4sIHBvaW50cyk7XHJcblxyXG4gICAgdmFyIHJlc3VsdCA9IG5ldyBJbnRlcnNlY3Rpb24oXCJObyBJbnRlcnNlY3Rpb25cIik7XHJcblxyXG4gICAgcmVzdWx0LmFwcGVuZFBvaW50cyhpbnRlcjEucG9pbnRzKTtcclxuICAgIHJlc3VsdC5hcHBlbmRQb2ludHMoaW50ZXIyLnBvaW50cyk7XHJcbiAgICByZXN1bHQuYXBwZW5kUG9pbnRzKGludGVyMy5wb2ludHMpO1xyXG4gICAgcmVzdWx0LmFwcGVuZFBvaW50cyhpbnRlcjQucG9pbnRzKTtcclxuXHJcbiAgICBpZiAoIHJlc3VsdC5wb2ludHMubGVuZ3RoID4gMCApXHJcbiAgICAgICAgcmVzdWx0LnN0YXR1cyA9IFwiSW50ZXJzZWN0aW9uXCI7XHJcblxyXG4gICAgcmV0dXJuIHJlc3VsdDtcclxufTtcclxuXHJcblxyXG4vKipcclxuICogIGludGVyc2VjdFJheVJheVxyXG4gKlxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBhMVxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBhMlxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBiMVxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBiMlxyXG4gKiAgQHJldHVybnMge0ludGVyc2VjdGlvbn1cclxuICovXHJcbkludGVyc2VjdGlvbi5pbnRlcnNlY3RSYXlSYXkgPSBmdW5jdGlvbihhMSwgYTIsIGIxLCBiMikge1xyXG4gICAgdmFyIHJlc3VsdDtcclxuXHJcbiAgICB2YXIgdWFfdCA9IChiMi54IC0gYjEueCkgKiAoYTEueSAtIGIxLnkpIC0gKGIyLnkgLSBiMS55KSAqIChhMS54IC0gYjEueCk7XHJcbiAgICB2YXIgdWJfdCA9IChhMi54IC0gYTEueCkgKiAoYTEueSAtIGIxLnkpIC0gKGEyLnkgLSBhMS55KSAqIChhMS54IC0gYjEueCk7XHJcbiAgICB2YXIgdV9iICA9IChiMi55IC0gYjEueSkgKiAoYTIueCAtIGExLngpIC0gKGIyLnggLSBiMS54KSAqIChhMi55IC0gYTEueSk7XHJcblxyXG4gICAgaWYgKCB1X2IgIT0gMCApIHtcclxuICAgICAgICB2YXIgdWEgPSB1YV90IC8gdV9iO1xyXG5cclxuICAgICAgICByZXN1bHQgPSBuZXcgSW50ZXJzZWN0aW9uKFwiSW50ZXJzZWN0aW9uXCIpO1xyXG4gICAgICAgIHJlc3VsdC5wb2ludHMucHVzaChcclxuICAgICAgICAgICAgbmV3IFBvaW50MkQoXHJcbiAgICAgICAgICAgICAgICBhMS54ICsgdWEgKiAoYTIueCAtIGExLngpLFxyXG4gICAgICAgICAgICAgICAgYTEueSArIHVhICogKGEyLnkgLSBhMS55KVxyXG4gICAgICAgICAgICApXHJcbiAgICAgICAgKTtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgICAgaWYgKCB1YV90ID09IDAgfHwgdWJfdCA9PSAwICkge1xyXG4gICAgICAgICAgICByZXN1bHQgPSBuZXcgSW50ZXJzZWN0aW9uKFwiQ29pbmNpZGVudFwiKTtcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICByZXN1bHQgPSBuZXcgSW50ZXJzZWN0aW9uKFwiUGFyYWxsZWxcIik7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiByZXN1bHQ7XHJcbn07XHJcblxyXG5cclxuLyoqXHJcbiAqICBpbnRlcnNlY3RSZWN0YW5nbGVSZWN0YW5nbGVcclxuICpcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gYTFcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gYTJcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gYjFcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gYjJcclxuICogIEByZXR1cm5zIHtJbnRlcnNlY3Rpb259XHJcbiAqL1xyXG5JbnRlcnNlY3Rpb24uaW50ZXJzZWN0UmVjdGFuZ2xlUmVjdGFuZ2xlID0gZnVuY3Rpb24oYTEsIGEyLCBiMSwgYjIpIHtcclxuICAgIHZhciBtaW4gICAgICAgID0gYTEubWluKGEyKTtcclxuICAgIHZhciBtYXggICAgICAgID0gYTEubWF4KGEyKTtcclxuICAgIHZhciB0b3BSaWdodCAgID0gbmV3IFBvaW50MkQoIG1heC54LCBtaW4ueSApO1xyXG4gICAgdmFyIGJvdHRvbUxlZnQgPSBuZXcgUG9pbnQyRCggbWluLngsIG1heC55ICk7XHJcblxyXG4gICAgdmFyIGludGVyMSA9IEludGVyc2VjdGlvbi5pbnRlcnNlY3RMaW5lUmVjdGFuZ2xlKG1pbiwgdG9wUmlnaHQsIGIxLCBiMik7XHJcbiAgICB2YXIgaW50ZXIyID0gSW50ZXJzZWN0aW9uLmludGVyc2VjdExpbmVSZWN0YW5nbGUodG9wUmlnaHQsIG1heCwgYjEsIGIyKTtcclxuICAgIHZhciBpbnRlcjMgPSBJbnRlcnNlY3Rpb24uaW50ZXJzZWN0TGluZVJlY3RhbmdsZShtYXgsIGJvdHRvbUxlZnQsIGIxLCBiMik7XHJcbiAgICB2YXIgaW50ZXI0ID0gSW50ZXJzZWN0aW9uLmludGVyc2VjdExpbmVSZWN0YW5nbGUoYm90dG9tTGVmdCwgbWluLCBiMSwgYjIpO1xyXG5cclxuICAgIHZhciByZXN1bHQgPSBuZXcgSW50ZXJzZWN0aW9uKFwiTm8gSW50ZXJzZWN0aW9uXCIpO1xyXG5cclxuICAgIHJlc3VsdC5hcHBlbmRQb2ludHMoaW50ZXIxLnBvaW50cyk7XHJcbiAgICByZXN1bHQuYXBwZW5kUG9pbnRzKGludGVyMi5wb2ludHMpO1xyXG4gICAgcmVzdWx0LmFwcGVuZFBvaW50cyhpbnRlcjMucG9pbnRzKTtcclxuICAgIHJlc3VsdC5hcHBlbmRQb2ludHMoaW50ZXI0LnBvaW50cyk7XHJcblxyXG4gICAgaWYgKCByZXN1bHQucG9pbnRzLmxlbmd0aCA+IDAgKVxyXG4gICAgICAgIHJlc3VsdC5zdGF0dXMgPSBcIkludGVyc2VjdGlvblwiO1xyXG5cclxuICAgIHJldHVybiByZXN1bHQ7XHJcbn07XHJcblxyXG5cclxuLyoqXHJcbiAqICBiZXpvdXRcclxuICpcclxuICogIFRoaXMgY29kZSBpcyBiYXNlZCBvbiBNZ2NJbnRyMkRFbHBFbHAuY3BwIHdyaXR0ZW4gYnkgRGF2aWQgRWJlcmx5LiAgSGlzXHJcbiAqICBjb2RlIGFsb25nIHdpdGggbWFueSBvdGhlciBleGNlbGxlbnQgZXhhbXBsZXMgYXJlIGF2YWlhYmxlIGF0IGhpcyBzaXRlOlxyXG4gKiAgaHR0cDovL3d3dy5tYWdpYy1zb2Z0d2FyZS5jb21cclxuICpcclxuICogIEBwYXJhbSB7QXJyYXk8UG9pbnQyRD59IGUxXHJcbiAqICBAcGFyYW0ge0FycmF5PFBvaW50MkQ+fSBlMlxyXG4gKiAgQHJldHVybnMge1BvbHlub21pYWx9XHJcbiAqL1xyXG5JbnRlcnNlY3Rpb24uYmV6b3V0ID0gZnVuY3Rpb24oZTEsIGUyKSB7XHJcbiAgICB2YXIgQUIgICAgPSBlMVswXSplMlsxXSAtIGUyWzBdKmUxWzFdO1xyXG4gICAgdmFyIEFDICAgID0gZTFbMF0qZTJbMl0gLSBlMlswXSplMVsyXTtcclxuICAgIHZhciBBRCAgICA9IGUxWzBdKmUyWzNdIC0gZTJbMF0qZTFbM107XHJcbiAgICB2YXIgQUUgICAgPSBlMVswXSplMls0XSAtIGUyWzBdKmUxWzRdO1xyXG4gICAgdmFyIEFGICAgID0gZTFbMF0qZTJbNV0gLSBlMlswXSplMVs1XTtcclxuICAgIHZhciBCQyAgICA9IGUxWzFdKmUyWzJdIC0gZTJbMV0qZTFbMl07XHJcbiAgICB2YXIgQkUgICAgPSBlMVsxXSplMls0XSAtIGUyWzFdKmUxWzRdO1xyXG4gICAgdmFyIEJGICAgID0gZTFbMV0qZTJbNV0gLSBlMlsxXSplMVs1XTtcclxuICAgIHZhciBDRCAgICA9IGUxWzJdKmUyWzNdIC0gZTJbMl0qZTFbM107XHJcbiAgICB2YXIgREUgICAgPSBlMVszXSplMls0XSAtIGUyWzNdKmUxWzRdO1xyXG4gICAgdmFyIERGICAgID0gZTFbM10qZTJbNV0gLSBlMlszXSplMVs1XTtcclxuICAgIHZhciBCRnBERSA9IEJGICsgREU7XHJcbiAgICB2YXIgQkVtQ0QgPSBCRSAtIENEO1xyXG5cclxuICAgIHJldHVybiBuZXcgUG9seW5vbWlhbChcclxuICAgICAgICBBQipCQyAtIEFDKkFDLFxyXG4gICAgICAgIEFCKkJFbUNEICsgQUQqQkMgLSAyKkFDKkFFLFxyXG4gICAgICAgIEFCKkJGcERFICsgQUQqQkVtQ0QgLSBBRSpBRSAtIDIqQUMqQUYsXHJcbiAgICAgICAgQUIqREYgKyBBRCpCRnBERSAtIDIqQUUqQUYsXHJcbiAgICAgICAgQUQqREYgLSBBRipBRlxyXG4gICAgKTtcclxufTtcclxuXHJcbmlmICh0eXBlb2YgbW9kdWxlICE9PSBcInVuZGVmaW5lZFwiKSB7XHJcbiAgICBtb2R1bGUuZXhwb3J0cyA9IEludGVyc2VjdGlvbjtcclxufVxyXG4iLCIvKipcclxuICpcclxuICogICBJbnRlcnNlY3Rpb25QYXJhbXMuanNcclxuICpcclxuICogICBjb3B5cmlnaHQgMjAwMiwgS2V2aW4gTGluZHNleVxyXG4gKlxyXG4gKi9cclxuXHJcbi8qKlxyXG4gKiAgSW50ZXJzZWN0aW9uUGFyYW1zXHJcbiAqXHJcbiAqICBAcGFyYW0ge1N0cmluZ30gbmFtZVxyXG4gKiAgQHBhcmFtIHtBcnJheTxQb2ludDJEfSBwYXJhbXNcclxuICogIEByZXR1cm5zIHtJbnRlcnNlY3Rpb25QYXJhbXN9XHJcbiAqL1xyXG5mdW5jdGlvbiBJbnRlcnNlY3Rpb25QYXJhbXMobmFtZSwgcGFyYW1zKSB7XHJcbiAgICB0aGlzLmluaXQobmFtZSwgcGFyYW1zKTtcclxufVxyXG5cclxuLyoqXHJcbiAqICBpbml0XHJcbiAqXHJcbiAqICBAcGFyYW0ge1N0cmluZ30gbmFtZVxyXG4gKiAgQHBhcmFtIHtBcnJheTxQb2ludDJEPn0gcGFyYW1zXHJcbiAqL1xyXG5JbnRlcnNlY3Rpb25QYXJhbXMucHJvdG90eXBlLmluaXQgPSBmdW5jdGlvbihuYW1lLCBwYXJhbXMpIHtcclxuICAgIHRoaXMubmFtZSAgID0gbmFtZTtcclxuICAgIHRoaXMucGFyYW1zID0gcGFyYW1zO1xyXG59O1xyXG5cclxuaWYgKHR5cGVvZiBtb2R1bGUgIT09IFwidW5kZWZpbmVkXCIpIHtcclxuICAgIG1vZHVsZS5leHBvcnRzID0gSW50ZXJzZWN0aW9uUGFyYW1zO1xyXG59IiwiLy8gZXhwb3NlIGNsYXNzZXNcblxuZXhwb3J0cy5Qb2ludDJEID0gcmVxdWlyZSgnLi9saWIvUG9pbnQyRCcpO1xuZXhwb3J0cy5WZWN0b3IyRCA9IHJlcXVpcmUoJy4vbGliL1ZlY3RvcjJEJyk7XG5leHBvcnRzLk1hdHJpeDJEID0gcmVxdWlyZSgnLi9saWIvTWF0cml4MkQnKTtcbiIsIi8qKlxuICpcbiAqICAgTWF0cml4MkQuanNcbiAqXG4gKiAgIGNvcHlyaWdodCAyMDAxLTIwMDIsIDIwMTMgS2V2aW4gTGluZHNleVxuICpcbiAqL1xuXG4vKipcbiAqICBNYXRyaXgyRFxuICpcbiAqICBAcGFyYW0ge051bWJlcn0gYVxuICogIEBwYXJhbSB7TnVtYmVyfSBiXG4gKiAgQHBhcmFtIHtOdW1iZXJ9IGNcbiAqICBAcGFyYW0ge051bWJlcn0gZFxuICogIEBwYXJhbSB7TnVtYmVyfSBlXG4gKiAgQHBhcmFtIHtOdW1iZXJ9IGZcbiAqICBAcmV0dXJucyB7TWF0cml4MkR9XG4gKi9cbmZ1bmN0aW9uIE1hdHJpeDJEKGEsIGIsIGMsIGQsIGUsIGYpIHtcbiAgICBPYmplY3QuZGVmaW5lUHJvcGVydGllcyh0aGlzLCB7XG4gICAgICAgIFwiYVwiOiB7XG4gICAgICAgICAgICB2YWx1ZTogKGEgIT09IHVuZGVmaW5lZCkgPyBhIDogMSxcbiAgICAgICAgICAgIHdyaXRhYmxlOiBmYWxzZSxcbiAgICAgICAgICAgIGVudW1lcmFibGU6IHRydWUsXG4gICAgICAgICAgICBjb25maWd1cmFibGU6IGZhbHNlXG4gICAgICAgIH0sXG4gICAgICAgIFwiYlwiOiB7XG4gICAgICAgICAgICB2YWx1ZTogKGIgIT09IHVuZGVmaW5lZCkgPyBiIDogMCxcbiAgICAgICAgICAgIHdyaXRhYmxlOiBmYWxzZSxcbiAgICAgICAgICAgIGVudW1lcmFibGU6IHRydWUsXG4gICAgICAgICAgICBjb25maWd1cmFibGU6IGZhbHNlXG4gICAgICAgIH0sXG4gICAgICAgIFwiY1wiOiB7XG4gICAgICAgICAgICB2YWx1ZTogKGMgIT09IHVuZGVmaW5lZCkgPyBjIDogMCxcbiAgICAgICAgICAgIHdyaXRhYmxlOiBmYWxzZSxcbiAgICAgICAgICAgIGVudW1lcmFibGU6IHRydWUsXG4gICAgICAgICAgICBjb25maWd1cmFibGU6IGZhbHNlXG4gICAgICAgIH0sXG4gICAgICAgIFwiZFwiOiB7XG4gICAgICAgICAgICB2YWx1ZTogKGQgIT09IHVuZGVmaW5lZCkgPyBkIDogMSxcbiAgICAgICAgICAgIHdyaXRhYmxlOiBmYWxzZSxcbiAgICAgICAgICAgIGVudW1lcmFibGU6IHRydWUsXG4gICAgICAgICAgICBjb25maWd1cmFibGU6IGZhbHNlXG4gICAgICAgIH0sXG4gICAgICAgIFwiZVwiOiB7XG4gICAgICAgICAgICB2YWx1ZTogKGUgIT09IHVuZGVmaW5lZCkgPyBlIDogMCxcbiAgICAgICAgICAgIHdyaXRhYmxlOiBmYWxzZSxcbiAgICAgICAgICAgIGVudW1lcmFibGU6IHRydWUsXG4gICAgICAgICAgICBjb25maWd1cmFibGU6IGZhbHNlXG4gICAgICAgIH0sXG4gICAgICAgIFwiZlwiOiB7XG4gICAgICAgICAgICB2YWx1ZTogKGYgIT09IHVuZGVmaW5lZCkgPyBmIDogMCxcbiAgICAgICAgICAgIHdyaXRhYmxlOiBmYWxzZSxcbiAgICAgICAgICAgIGVudW1lcmFibGU6IHRydWUsXG4gICAgICAgICAgICBjb25maWd1cmFibGU6IGZhbHNlXG4gICAgICAgIH1cbiAgICB9KTtcbiAgICAvLyB0aGlzLmEgPSAoYSAhPT0gdW5kZWZpbmVkKSA/IGEgOiAxO1xuICAgIC8vIHRoaXMuYiA9IChiICE9PSB1bmRlZmluZWQpID8gYiA6IDA7XG4gICAgLy8gdGhpcy5jID0gKGMgIT09IHVuZGVmaW5lZCkgPyBjIDogMDtcbiAgICAvLyB0aGlzLmQgPSAoZCAhPT0gdW5kZWZpbmVkKSA/IGQgOiAxO1xuICAgIC8vIHRoaXMuZSA9IChlICE9PSB1bmRlZmluZWQpID8gZSA6IDA7XG4gICAgLy8gdGhpcy5mID0gKGYgIT09IHVuZGVmaW5lZCkgPyBmIDogMDtcbn1cblxuLyoqXG4gKiAgSWRlbnRpdHkgbWF0cml4XG4gKlxuICogIEByZXR1cm5zIHtNYXRyaXgyRH1cbiAqL1xuTWF0cml4MkQuSURFTlRJVFkgPSBuZXcgTWF0cml4MkQoMSwgMCwgMCwgMSwgMCwgMCk7XG5cbi8vIFRPRE86IHJvdGF0ZSwgc2tldywgZXRjLiBtYXRyaWNlcyBhcyB3ZWxsP1xuXG4vKipcbiAqICBtdWx0aXBseVxuICpcbiAqICBAcGFyYXJtIHtNYXRyaXgyRH0gdGhhdFxuICogIEByZXR1cm5zIHtNYXRyaXgyRH1cbiAqL1xuTWF0cml4MkQucHJvdG90eXBlLm11bHRpcGx5ID0gZnVuY3Rpb24odGhhdCkge1xuICAgIHJldHVybiBuZXcgTWF0cml4MkQoXG4gICAgICAgIHRoaXMuYSAqIHRoYXQuYSArIHRoaXMuYyAqIHRoYXQuYixcbiAgICAgICAgdGhpcy5iICogdGhhdC5hICsgdGhpcy5kICogdGhhdC5iLFxuICAgICAgICB0aGlzLmEgKiB0aGF0LmMgKyB0aGlzLmMgKiB0aGF0LmQsXG4gICAgICAgIHRoaXMuYiAqIHRoYXQuYyArIHRoaXMuZCAqIHRoYXQuZCxcbiAgICAgICAgdGhpcy5hICogdGhhdC5lICsgdGhpcy5jICogdGhhdC5mICsgdGhpcy5lLFxuICAgICAgICB0aGlzLmIgKiB0aGF0LmUgKyB0aGlzLmQgKiB0aGF0LmYgKyB0aGlzLmZcbiAgICApO1xufTtcblxuLyoqXG4gKiAgaW52ZXJzZVxuICpcbiAqICBAcmV0dXJucyB7TWF0cml4MkR9XG4gKi9cbk1hdHJpeDJELnByb3RvdHlwZS5pbnZlcnNlID0gZnVuY3Rpb24oKSB7XG4gICAgdmFyIGRldDEgPSB0aGlzLmEgKiB0aGlzLmQgLSB0aGlzLmIgKiB0aGlzLmM7XG5cbiAgICBpZiAoIGRldDEgPT0gMC4wIClcbiAgICAgICAgdGhyb3coXCJNYXRyaXggaXMgbm90IGludmVydGlibGVcIik7XG5cbiAgICB2YXIgaWRldCA9IDEuMCAvIGRldDE7XG4gICAgdmFyIGRldDIgPSB0aGlzLmYgKiB0aGlzLmMgLSB0aGlzLmUgKiB0aGlzLmQ7XG4gICAgdmFyIGRldDMgPSB0aGlzLmUgKiB0aGlzLmIgLSB0aGlzLmYgKiB0aGlzLmE7XG5cbiAgICByZXR1cm4gbmV3IE1hdHJpeDJEKFxuICAgICAgICB0aGlzLmQgKiBpZGV0LFxuICAgICAgIC10aGlzLmIgKiBpZGV0LFxuICAgICAgIC10aGlzLmMgKiBpZGV0LFxuICAgICAgICB0aGlzLmEgKiBpZGV0LFxuICAgICAgICAgIGRldDIgKiBpZGV0LFxuICAgICAgICAgIGRldDMgKiBpZGV0XG4gICAgKTtcbn07XG5cbi8qKlxuICogIHRyYW5zbGF0ZVxuICpcbiAqICBAcGFyYW0ge051bWJlcn0gdHhcbiAqICBAcGFyYW0ge051bWJlcn0gdHlcbiAqICBAcmV0dXJucyB7TWF0cml4MkR9XG4gKi9cbk1hdHJpeDJELnByb3RvdHlwZS50cmFuc2xhdGUgPSBmdW5jdGlvbih0eCwgdHkpIHtcbiAgICByZXR1cm4gbmV3IE1hdHJpeDJEKFxuICAgICAgICB0aGlzLmEsXG4gICAgICAgIHRoaXMuYixcbiAgICAgICAgdGhpcy5jLFxuICAgICAgICB0aGlzLmQsXG4gICAgICAgIHRoaXMuYSAqIHR4ICsgdGhpcy5jICogdHkgKyB0aGlzLmUsXG4gICAgICAgIHRoaXMuYiAqIHR4ICsgdGhpcy5kICogdHkgKyB0aGlzLmZcbiAgICApO1xufTtcblxuLyoqXG4gKiAgc2NhbGVcbiAqXG4gKiAgQHBhcmFtIHtOdW1iZXJ9IHNjYWxlXG4gKiAgQHJldHVybnMge01hdHJpeDJEfVxuICovXG5NYXRyaXgyRC5wcm90b3R5cGUuc2NhbGUgPSBmdW5jdGlvbihzY2FsZSkge1xuICAgIHJldHVybiBuZXcgTWF0cml4MkQoXG4gICAgICAgIHRoaXMuYSAqIHNjYWxlLFxuICAgICAgICB0aGlzLmIgKiBzY2FsZSxcbiAgICAgICAgdGhpcy5jICogc2NhbGUsXG4gICAgICAgIHRoaXMuZCAqIHNjYWxlLFxuICAgICAgICB0aGlzLmUsXG4gICAgICAgIHRoaXMuZlxuICAgICk7XG59O1xuXG4vKipcbiAqICBzY2FsZUF0XG4gKlxuICogIEBwYXJhbSB7TnVtYmVyfSBzY2FsZVxuICogIEBwYXJhbSB7UG9pbnQyRH0gY2VudGVyXG4gKiAgQHJldHVybnMge01hdHJpeDJEfVxuICovXG5NYXRyaXgyRC5wcm90b3R5cGUuc2NhbGVBdCA9IGZ1bmN0aW9uKHNjYWxlLCBjZW50ZXIpIHtcbiAgICB2YXIgZHggPSBjZW50ZXIueCAtIHNjYWxlICogY2VudGVyLng7XG4gICAgdmFyIGR5ID0gY2VudGVyLnkgLSBzY2FsZSAqIGNlbnRlci55O1xuXG4gICAgcmV0dXJuIG5ldyBNYXRyaXgyRChcbiAgICAgICAgdGhpcy5hICogc2NhbGUsXG4gICAgICAgIHRoaXMuYiAqIHNjYWxlLFxuICAgICAgICB0aGlzLmMgKiBzY2FsZSxcbiAgICAgICAgdGhpcy5kICogc2NhbGUsXG4gICAgICAgIHRoaXMuYSAqIGR4ICsgdGhpcy5jICogZHkgKyB0aGlzLmUsXG4gICAgICAgIHRoaXMuYiAqIGR4ICsgdGhpcy5kICogZHkgKyB0aGlzLmZcbiAgICApO1xufTtcblxuLyoqXG4gKiAgc2NhbGVOb25Vbmlmb3JtXG4gKlxuICogIEBwYXJhbSB7TnVtYmVyfSBzY2FsZVhcbiAqICBAcGFyYW0ge051bWJlcn0gc2NhbGVZXG4gKiAgQHJldHVybnMge01hdHJpeDJEfVxuICovXG5NYXRyaXgyRC5wcm90b3R5cGUuc2NhbGVOb25Vbmlmb3JtID0gZnVuY3Rpb24oc2NhbGVYLCBzY2FsZVkpIHtcbiAgICByZXR1cm4gbmV3IE1hdHJpeDJEKFxuICAgICAgICB0aGlzLmEgKiBzY2FsZVgsXG4gICAgICAgIHRoaXMuYiAqIHNjYWxlWCxcbiAgICAgICAgdGhpcy5jICogc2NhbGVZLFxuICAgICAgICB0aGlzLmQgKiBzY2FsZVksXG4gICAgICAgIHRoaXMuZSxcbiAgICAgICAgdGhpcy5mXG4gICAgKTtcbn07XG5cbi8qKlxuICogIHNjYWxlTm9uVW5pZm9ybUF0XG4gKlxuICogIEBwYXJhbSB7TnVtYmVyfSBzY2FsZVhcbiAqICBAcGFyYW0ge051bWJlcn0gc2NhbGVZXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBjZW50ZXJcbiAqICBAcmV0dXJucyB7TWF0cml4MkR9XG4gKi9cbk1hdHJpeDJELnByb3RvdHlwZS5zY2FsZU5vblVuaWZvcm1BdCA9IGZ1bmN0aW9uKHNjYWxlWCwgc2NhbGVZLCBjZW50ZXIpIHtcbiAgICB2YXIgZHggPSBjZW50ZXIueCAtIHNjYWxlWCAqIGNlbnRlci54O1xuICAgIHZhciBkeSA9IGNlbnRlci55IC0gc2NhbGVZICogY2VudGVyLnk7XG5cbiAgICByZXR1cm4gbmV3IE1hdHJpeDJEKFxuICAgICAgICB0aGlzLmEgKiBzY2FsZVgsXG4gICAgICAgIHRoaXMuYiAqIHNjYWxlWCxcbiAgICAgICAgdGhpcy5jICogc2NhbGVZLFxuICAgICAgICB0aGlzLmQgKiBzY2FsZVksXG4gICAgICAgIHRoaXMuYSAqIGR4ICsgdGhpcy5jICogZHkgKyB0aGlzLmUsXG4gICAgICAgIHRoaXMuYiAqIGR4ICsgdGhpcy5kICogZHkgKyB0aGlzLmZcbiAgICApO1xufTtcblxuLyoqXG4gKiAgcm90YXRlXG4gKlxuICogIEBwYXJhbSB7TnVtYmVyfSByYWRpYW5zXG4gKiAgQHJldHVybnMge01hdHJpeDJEfVxuICovXG5NYXRyaXgyRC5wcm90b3R5cGUucm90YXRlID0gZnVuY3Rpb24ocmFkaWFucykge1xuICAgIHZhciBjID0gTWF0aC5jb3MocmFkaWFucyk7XG4gICAgdmFyIHMgPSBNYXRoLnNpbihyYWRpYW5zKTtcblxuICAgIHJldHVybiBuZXcgTWF0cml4MkQoXG4gICAgICAgIHRoaXMuYSAqICBjICsgdGhpcy5jICogcyxcbiAgICAgICAgdGhpcy5iICogIGMgKyB0aGlzLmQgKiBzLFxuICAgICAgICB0aGlzLmEgKiAtcyArIHRoaXMuYyAqIGMsXG4gICAgICAgIHRoaXMuYiAqIC1zICsgdGhpcy5kICogYyxcbiAgICAgICAgdGhpcy5lLFxuICAgICAgICB0aGlzLmZcbiAgICApO1xufTtcblxuLyoqXG4gKiAgcm90YXRlQXRcbiAqXG4gKiAgQHBhcmFtIHtOdW1iZXJ9IHJhZGlhbnNcbiAqICBAcGFyYW0ge1BvaW50MkR9IGNlbnRlclxuICogIEByZXN1bHQge01hdHJpeDJEfVxuICovXG5NYXRyaXgyRC5wcm90b3R5cGUucm90YXRlQXQgPSBmdW5jdGlvbihyYWRpYW5zLCBjZW50ZXIpIHtcbiAgICB2YXIgYyA9IE1hdGguY29zKHJhZGlhbnMpO1xuICAgIHZhciBzID0gTWF0aC5zaW4ocmFkaWFucyk7XG4gICAgdmFyIHQxID0gLWNlbnRlci54ICsgY2VudGVyLnggKiBjIC0gY2VudGVyLnkgKiBzO1xuICAgIHZhciB0MiA9IC1jZW50ZXIueSArIGNlbnRlci55ICogYyArIGNlbnRlci54ICogcztcblxuICAgIHJldHVybiBuZXcgTWF0cml4MkQoXG4gICAgICAgIHRoaXMuYSAqICBjICsgdGhpcy5jICogcyxcbiAgICAgICAgdGhpcy5iICogIGMgKyB0aGlzLmQgKiBzLFxuICAgICAgICB0aGlzLmEgKiAtcyArIHRoaXMuYyAqIGMsXG4gICAgICAgIHRoaXMuYiAqIC1zICsgdGhpcy5kICogYyxcbiAgICAgICAgdGhpcy5hICogdDEgKyB0aGlzLmMgKiB0MiArIHRoaXMuZSxcbiAgICAgICAgdGhpcy5iICogdDEgKyB0aGlzLmQgKiB0MiArIHRoaXMuZlxuICAgICk7XG59O1xuXG4vKipcbiAqICByb3RhdGVGcm9tVmVjdG9yXG4gKlxuICogIEBwYXJhbSB7VmVjdG9yMkR9XG4gKiAgQHJldHVybnMge01hdHJpeDJEfVxuICovXG5NYXRyaXgyRC5wcm90b3R5cGUucm90YXRlRnJvbVZlY3RvciA9IGZ1bmN0aW9uKHZlY3Rvcikge1xuICAgIHZhciB1bml0ID0gdmVjdG9yLnVuaXQoKTtcbiAgICB2YXIgYyA9IHVuaXQueDsgLy8gY29zXG4gICAgdmFyIHMgPSB1bml0Lnk7IC8vIHNpblxuXG4gICAgcmV0dXJuIG5ldyBNYXRyaXgyRChcbiAgICAgICAgdGhpcy5hICogIGMgKyB0aGlzLmMgKiBzLFxuICAgICAgICB0aGlzLmIgKiAgYyArIHRoaXMuZCAqIHMsXG4gICAgICAgIHRoaXMuYSAqIC1zICsgdGhpcy5jICogYyxcbiAgICAgICAgdGhpcy5iICogLXMgKyB0aGlzLmQgKiBjLFxuICAgICAgICB0aGlzLmUsXG4gICAgICAgIHRoaXMuZlxuICAgICk7XG59O1xuXG4vKipcbiAqICBmbGlwWFxuICpcbiAqICBAcmV0dXJucyB7TWF0cml4MkR9XG4gKi9cbk1hdHJpeDJELnByb3RvdHlwZS5mbGlwWCA9IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiBuZXcgTWF0cml4MkQoXG4gICAgICAgIC10aGlzLmEsXG4gICAgICAgIC10aGlzLmIsXG4gICAgICAgICB0aGlzLmMsXG4gICAgICAgICB0aGlzLmQsXG4gICAgICAgICB0aGlzLmUsXG4gICAgICAgICB0aGlzLmZcbiAgICApO1xufTtcblxuLyoqXG4gKiAgZmxpcFlcbiAqXG4gKiAgQHJldHVybnMge01hdHJpeDJEfVxuICovXG5NYXRyaXgyRC5wcm90b3R5cGUuZmxpcFkgPSBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gbmV3IE1hdHJpeDJEKFxuICAgICAgICAgdGhpcy5hLFxuICAgICAgICAgdGhpcy5iLFxuICAgICAgICAtdGhpcy5jLFxuICAgICAgICAtdGhpcy5kLFxuICAgICAgICAgdGhpcy5lLFxuICAgICAgICAgdGhpcy5mXG4gICAgKTtcbn07XG5cbi8qKlxuICogIHNrZXdYXG4gKlxuICogIEBwYXJhcm0ge051bWJlcn0gcmFkaWFuc1xuICogIEByZXR1cm5zIHtNYXRyaXgyRH1cbiAqL1xuTWF0cml4MkQucHJvdG90eXBlLnNrZXdYID0gZnVuY3Rpb24ocmFkaWFucykge1xuICAgIHZhciB0ID0gTWF0aC50YW4ocmFkaWFucyk7XG5cbiAgICByZXR1cm4gbmV3IE1hdHJpeDJEKFxuICAgICAgICB0aGlzLmEsXG4gICAgICAgIHRoaXMuYixcbiAgICAgICAgdGhpcy5hICogdCArIHRoaXMuYyxcbiAgICAgICAgdGhpcy5iICogdCArIHRoaXMuZCxcbiAgICAgICAgdGhpcy5lLFxuICAgICAgICB0aGlzLmZcbiAgICApO1xufTtcblxuLy8gVE9ETzogc2tld1hBdFxuXG4vKipcbiAqICBza2V3WVxuICpcbiAqICBAcGFyYXJtIHtOdW1iZXJ9IHJhZGlhbnNcbiAqICBAcmV0dXJucyB7TWF0cml4MkR9XG4gKi9cbk1hdHJpeDJELnByb3RvdHlwZS5za2V3WSA9IGZ1bmN0aW9uKHJhZGlhbnMpIHtcbiAgICB2YXIgdCA9IE1hdGgudGFuKGFuZ2xlKTtcblxuICAgIHJldHVybiBtYXRyaXhfbmV3KFxuICAgICAgICB0aGlzLmEgKyB0aGlzLmMgKiB0LFxuICAgICAgICB0aGlzLmIgKyB0aGlzLmQgKiB0LFxuICAgICAgICB0aGlzLmMsXG4gICAgICAgIHRoaXMuZCxcbiAgICAgICAgdGhpcy5lLFxuICAgICAgICB0aGlzLmZcbiAgICApO1xufTtcblxuLy8gVE9ETzogc2tld1lBdFxuXG4vKipcbiAqICBpc0lkZW50aXR5XG4gKlxuICogIEByZXR1cm5zIHtCb29sZWFufVxuICovXG5NYXRyaXgyRC5wcm90b3R5cGUuaXNJZGVudGl0eSA9IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiAoXG4gICAgICAgIHRoaXMuYSA9PT0gMS4wICYmXG4gICAgICAgIHRoaXMuYiA9PT0gMC4wICYmXG4gICAgICAgIHRoaXMuYyA9PT0gMC4wICYmXG4gICAgICAgIHRoaXMuZCA9PT0gMS4wICYmXG4gICAgICAgIHRoaXMuZSA9PT0gMC4wICYmXG4gICAgICAgIHRoaXMuZiA9PT0gMC4wXG4gICAgKTtcbn07XG5cbi8qKlxuICogIGlzSW52ZXJ0aWJsZVxuICpcbiAqICBAcmV0dXJucyB7Qm9vbGVhbn1cbiAqL1xuTWF0cml4MkQucHJvdG90eXBlLmlzSW52ZXJ0aWJsZSA9IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMuYSAqIHRoaXMuZCAtIHRoaXMuYiAqIHRoaXMuYyAhPT0gMC4wO1xufTtcblxuLyoqXG4gKiAgZ2V0U2NhbGVcbiAqXG4gKiAgQHJldHVybnMge3NjYWxlWDogTnVtYmVyLCBzY2FsZVk6IE51bWJlcn1cbiAqL1xuTWF0cml4MkQucHJvdG90eXBlLmdldFNjYWxlID0gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgICAgc2NhbGVYOiBNYXRoLnNxcnQodGhpcy5hICogdGhpcy5hICsgdGhpcy5jICogdGhpcy5jKSxcbiAgICAgICAgc2NhbGVZOiBNYXRoLnNxcnQodGhpcy5iICogdGhpcy5iICsgdGhpcy5kICogdGhpcy5kKVxuICAgIH07XG59O1xuXG4vKipcbiAqICBlcXVhbHNcbiAqXG4gKiAgQHBhcmFtIHtNYXRyaXgyRH0gdGhhdFxuICogIEByZXR1cm5zIHtCb29sZWFufVxuICovXG5NYXRyaXgyRC5wcm90b3R5cGUuZXF1YWxzID0gZnVuY3Rpb24odGhhdCkge1xuICAgIHJldHVybiAoXG4gICAgICAgIHRoaXMuYSA9PT0gdGhhdC5hICYmXG4gICAgICAgIHRoaXMuYiA9PT0gdGhhdC5iICYmXG4gICAgICAgIHRoaXMuYyA9PT0gdGhhdC5jICYmXG4gICAgICAgIHRoaXMuZCA9PT0gdGhhdC5kICYmXG4gICAgICAgIHRoaXMuZSA9PT0gdGhhdC5lICYmXG4gICAgICAgIHRoaXMuZiA9PT0gdGhhdC5mXG4gICAgKTtcbn07XG5cbi8qKlxuICogIHRvU3RyaW5nXG4gKlxuICogIEByZXR1cm5zIHtTdHJpbmd9XG4gKi9cbk1hdHJpeDJELnByb3RvdHlwZS50b1N0cmluZyA9IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiAoXG4gICAgICAgIFwibWF0cml4KFwiICtcbiAgICAgICAgdGhpcy5hICsgXCIsXCIgK1xuICAgICAgICB0aGlzLmIgKyBcIixcIiArXG4gICAgICAgIHRoaXMuYyArIFwiLFwiICtcbiAgICAgICAgdGhpcy5kICsgXCIsXCIgK1xuICAgICAgICB0aGlzLmUgKyBcIixcIiArXG4gICAgICAgIHRoaXMuZiArIFwiKVwiXG4gICAgKTtcbn1cblxuaWYgKHR5cGVvZiBtb2R1bGUgIT09IFwidW5kZWZpbmVkXCIpIHtcbiAgICBtb2R1bGUuZXhwb3J0cyA9IE1hdHJpeDJEO1xufSIsIi8qKlxuICpcbiAqICAgUG9pbnQyRC5qc1xuICpcbiAqICAgY29weXJpZ2h0IDIwMDEtMjAwMiwgMjAxMyBLZXZpbiBMaW5kc2V5XG4gKlxuICovXG5cbi8qKlxuICogIFBvaW50MkRcbiAqXG4gKiAgQHBhcmFtIHtOdW1iZXJ9IHhcbiAqICBAcGFyYW0ge051bWJlcn0geVxuICogIEByZXR1cm5zIHtQb2ludDJEfVxuICovXG5mdW5jdGlvbiBQb2ludDJEKHgsIHkpIHtcbiAgICBPYmplY3QuZGVmaW5lUHJvcGVydGllcyh0aGlzLCB7XG4gICAgICAgIFwieFwiOiB7XG4gICAgICAgICAgICB2YWx1ZTogeCxcbiAgICAgICAgICAgIHdyaXRhYmxlOiBmYWxzZSxcbiAgICAgICAgICAgIGVudW1lcmFibGU6IHRydWUsXG4gICAgICAgICAgICBjb25maWd1cmFibGU6IGZhbHNlXG4gICAgICAgIH0sXG4gICAgICAgIFwieVwiOiB7XG4gICAgICAgICAgICB2YWx1ZTogeSxcbiAgICAgICAgICAgIHdyaXRhYmxlOiBmYWxzZSxcbiAgICAgICAgICAgIGVudW1lcmFibGU6IHRydWUsXG4gICAgICAgICAgICBjb25maWd1cmFibGU6IGZhbHNlXG4gICAgICAgIH1cbiAgICB9KTtcbiAgICAvLyB0aGlzLnggPSB4O1xuICAgIC8vIHRoaXMueSA9IHk7XG59XG5cbi8qKlxuICogIGNsb25lXG4gKlxuICogIEByZXR1cm5zIHtQb2ludDJEfVxuICovXG5Qb2ludDJELnByb3RvdHlwZS5jbG9uZSA9IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiBuZXcgUG9pbnQyRCh0aGlzLngsIHRoaXMueSk7XG59O1xuXG4vKipcbiAqICBhZGRcbiAqXG4gKiAgQHBhcmFtIHtQb2ludDJEfFZlY3RvcjJEfSB0aGF0XG4gKiAgQHJldHVybnMge1BvaW50MkR9XG4gKi9cblBvaW50MkQucHJvdG90eXBlLmFkZCA9IGZ1bmN0aW9uKHRoYXQpIHtcbiAgICByZXR1cm4gbmV3IFBvaW50MkQodGhpcy54K3RoYXQueCwgdGhpcy55K3RoYXQueSk7XG59O1xuXG4vKipcbiAqICBzdWJ0cmFjdFxuICpcbiAqICBAcGFyYW0geyBWZWN0b3IyRCB8IFBvaW50MkQgfSB0aGF0XG4gKiAgQHJldHVybnMge1BvaW50MkR9XG4gKi9cblBvaW50MkQucHJvdG90eXBlLnN1YnRyYWN0ID0gZnVuY3Rpb24odGhhdCkge1xuICAgIHJldHVybiBuZXcgUG9pbnQyRCh0aGlzLngtdGhhdC54LCB0aGlzLnktdGhhdC55KTtcbn07XG5cbi8qKlxuICogIG11bHRpcGx5XG4gKlxuICogIEBwYXJhbSB7TnVtYmVyfSBzY2FsYXJcbiAqICBAcmV0dXJucyB7UG9pbnQyRH1cbiAqL1xuUG9pbnQyRC5wcm90b3R5cGUubXVsdGlwbHkgPSBmdW5jdGlvbihzY2FsYXIpIHtcbiAgICByZXR1cm4gbmV3IFBvaW50MkQodGhpcy54KnNjYWxhciwgdGhpcy55KnNjYWxhcik7XG59O1xuXG4vKipcbiAqICBkaXZpZGVcbiAqXG4gKiAgQHBhcmFtIHtOdW1iZXJ9IHNjYWxhclxuICogIEByZXR1cm5zIHtQb2ludDJEfVxuICovXG5Qb2ludDJELnByb3RvdHlwZS5kaXZpZGUgPSBmdW5jdGlvbihzY2FsYXIpIHtcbiAgICByZXR1cm4gbmV3IFBvaW50MkQodGhpcy54L3NjYWxhciwgdGhpcy55L3NjYWxhcik7XG59O1xuXG4vKipcbiAqICBlcXVhbHNcbiAqXG4gKiAgQHBhcmFtIHtQb2ludDJEfSB0aGF0XG4gKiAgQHJldHVybnMge0Jvb2xlYW59XG4gKi9cblBvaW50MkQucHJvdG90eXBlLmVxdWFscyA9IGZ1bmN0aW9uKHRoYXQpIHtcbiAgICByZXR1cm4gKCB0aGlzLnggPT0gdGhhdC54ICYmIHRoaXMueSA9PSB0aGF0LnkgKTtcbn07XG5cbi8vIHV0aWxpdHkgbWV0aG9kc1xuXG4vKipcbiAqICBsZXJwXG4gKlxuICogIEBwYXJhbSB7IFZlY3RvcjJEIHwgUG9pbnQyRCB9IHRoYXRcbiAqICBAcGFyYW0ge051bWJlcn0gdFxuIEAgIEByZXR1cm5zIHtQb2ludDJEfVxuICovXG5Qb2ludDJELnByb3RvdHlwZS5sZXJwID0gZnVuY3Rpb24odGhhdCwgdCkge1xuICAgIHZhciBvbXQgPSAxLjAgLSB0O1xuXG4gICAgcmV0dXJuIG5ldyBQb2ludDJEKFxuICAgICAgICB0aGlzLnggKiBvbXQgKyB0aGF0LnggKiB0LFxuICAgICAgICB0aGlzLnkgKiBvbXQgKyB0aGF0LnkgKiB0XG4gICAgKTtcbn07XG5cbi8qKlxuICogIGRpc3RhbmNlRnJvbVxuICpcbiAqICBAcGFyYW0ge1BvaW50MkR9IHRoYXRcbiAqICBAcmV0dXJucyB7TnVtYmVyfVxuICovXG5Qb2ludDJELnByb3RvdHlwZS5kaXN0YW5jZUZyb20gPSBmdW5jdGlvbih0aGF0KSB7XG4gICAgdmFyIGR4ID0gdGhpcy54IC0gdGhhdC54O1xuICAgIHZhciBkeSA9IHRoaXMueSAtIHRoYXQueTtcblxuICAgIHJldHVybiBNYXRoLnNxcnQoZHgqZHggKyBkeSpkeSk7XG59O1xuXG4vKipcbiAqICBtaW5cbiAqXG4gKiAgQHBhcmFtIHtQb2ludDJEfSB0aGF0XG4gKiAgQHJldHVybnMge051bWJlcn1cbiAqL1xuUG9pbnQyRC5wcm90b3R5cGUubWluID0gZnVuY3Rpb24odGhhdCkge1xuICAgIHJldHVybiBuZXcgUG9pbnQyRChcbiAgICAgICAgTWF0aC5taW4oIHRoaXMueCwgdGhhdC54ICksXG4gICAgICAgIE1hdGgubWluKCB0aGlzLnksIHRoYXQueSApXG4gICAgKTtcbn07XG5cbi8qKlxuICogIG1heFxuICpcbiAqICBAcGFyYW0ge1BvaW50MkR9IHRoYXRcbiAqICBAcmV0dXJucyB7TnVtYmVyfVxuICovXG5Qb2ludDJELnByb3RvdHlwZS5tYXggPSBmdW5jdGlvbih0aGF0KSB7XG4gICAgcmV0dXJuIG5ldyBQb2ludDJEKFxuICAgICAgICBNYXRoLm1heCggdGhpcy54LCB0aGF0LnggKSxcbiAgICAgICAgTWF0aC5tYXgoIHRoaXMueSwgdGhhdC55IClcbiAgICApO1xufTtcblxuLyoqXG4gKiAgdHJhbnNmb3JtXG4gKlxuICogIEBwYXJhbSB7TWF0cml4MkR9XG4gKiAgQHJlc3VsdCB7UG9pbnQyRH1cbiAqL1xuUG9pbnQyRC5wcm90b3R5cGUudHJhbnNmb3JtID0gZnVuY3Rpb24obWF0cml4KSB7XG4gICAgcmV0dXJuIG5ldyBQb2ludDJEKFxuICAgICAgICBtYXRyaXguYSAqIHRoaXMueCArIG1hdHJpeC5jICogdGhpcy55ICsgbWF0cml4LmUsXG4gICAgICAgIG1hdHJpeC5iICogdGhpcy54ICsgbWF0cml4LmQgKiB0aGlzLnkgKyBtYXRyaXguZlxuICAgICk7XG59O1xuXG4vKipcbiAqICB0b1N0cmluZ1xuICpcbiAqICBAcmV0dXJucyB7U3RyaW5nfVxuICovXG5Qb2ludDJELnByb3RvdHlwZS50b1N0cmluZyA9IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiBcInBvaW50KFwiICsgdGhpcy54ICsgXCIsXCIgKyB0aGlzLnkgKyBcIilcIjtcbn07XG5cbmlmICh0eXBlb2YgbW9kdWxlICE9PSBcInVuZGVmaW5lZFwiKSB7XG4gICAgbW9kdWxlLmV4cG9ydHMgPSBQb2ludDJEO1xufVxuIiwiLyoqXG4gKlxuICogICBWZWN0b3IyRC5qc1xuICpcbiAqICAgY29weXJpZ2h0IDIwMDEtMjAwMiwgMjAxMyBLZXZpbiBMaW5kc2V5XG4gKlxuICovXG5cbi8qKlxuICogIFZlY3RvcjJEXG4gKlxuICogIEBwYXJhbSB7TnVtYmVyfSB4XG4gKiAgQHBhcmFtIHtOdW1iZXJ9IHlcbiAqICBAcmV0dXJucyB7VmVjdG9yMkR9XG4gKi9cbmZ1bmN0aW9uIFZlY3RvcjJEKHgsIHkpIHtcbiAgICBPYmplY3QuZGVmaW5lUHJvcGVydGllcyh0aGlzLCB7XG4gICAgICAgIFwieFwiOiB7XG4gICAgICAgICAgICB2YWx1ZTogeCxcbiAgICAgICAgICAgIHdyaXRhYmxlOiBmYWxzZSxcbiAgICAgICAgICAgIGVudW1lcmFibGU6IHRydWUsXG4gICAgICAgICAgICBjb25maWd1cmFibGU6IGZhbHNlXG4gICAgICAgIH0sXG4gICAgICAgIFwieVwiOiB7XG4gICAgICAgICAgICB2YWx1ZTogeSxcbiAgICAgICAgICAgIHdyaXRhYmxlOiBmYWxzZSxcbiAgICAgICAgICAgIGVudW1lcmFibGU6IHRydWUsXG4gICAgICAgICAgICBjb25maWd1cmFibGU6IGZhbHNlXG4gICAgICAgIH1cbiAgICB9KTtcbiAgICAvLyB0aGlzLnggPSB4O1xuICAgIC8vIHRoaXMueSA9IHk7XG59XG5cbi8qKlxuICogIGZyb21Qb2ludHNcbiAqXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBwMVxuICogIEBwYXJhbSB7UG9pbnQyRH0gcDJcbiAqICBAcmV0dXJucyB7VmVjdG9yMkR9XG4gKi9cblZlY3RvcjJELmZyb21Qb2ludHMgPSBmdW5jdGlvbihwMSwgcDIpIHtcbiAgICByZXR1cm4gbmV3IFZlY3RvcjJEKFxuICAgICAgICBwMi54IC0gcDEueCxcbiAgICAgICAgcDIueSAtIHAxLnlcbiAgICApO1xufTtcblxuLyoqXG4gKiAgbGVuZ3RoXG4gKlxuICogIEByZXR1cm5zIHtOdW1iZXJ9XG4gKi9cblZlY3RvcjJELnByb3RvdHlwZS5sZW5ndGggPSBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gTWF0aC5zcXJ0KHRoaXMueCp0aGlzLnggKyB0aGlzLnkqdGhpcy55KTtcbn07XG5cbi8qKlxuICogIG1hZ25pdHVkZVxuICpcbiAqICBAcmV0dXJucyB7TnVtYmVyfVxuICovXG5WZWN0b3IyRC5wcm90b3R5cGUubWFnbml0dWRlID0gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIHRoaXMueCp0aGlzLnggKyB0aGlzLnkqdGhpcy55O1xufTtcblxuLyoqXG4gKiAgZG90XG4gKlxuICogIEBwYXJhbSB7VmVjdG9yMkR9IHRoYXRcbiAqICBAcmV0dXJucyB7TnVtYmVyfVxuICovXG5WZWN0b3IyRC5wcm90b3R5cGUuZG90ID0gZnVuY3Rpb24odGhhdCkge1xuICAgIHJldHVybiB0aGlzLngqdGhhdC54ICsgdGhpcy55KnRoYXQueTtcbn07XG5cbi8qKlxuICogIGNyb3NzXG4gKlxuICogIEBwYXJhbSB7VmVjdG9yMkR9IHRoYXRcbiAqICBAcmV0dXJucyB7TnVtYmVyfVxuICovXG5WZWN0b3IyRC5wcm90b3R5cGUuY3Jvc3MgPSBmdW5jdGlvbih0aGF0KSB7XG4gICAgcmV0dXJuIHRoaXMueCp0aGF0LnkgLSB0aGlzLnkqdGhhdC54O1xufVxuXG4vKipcbiAqICBkZXRlcm1pbmFudFxuICpcbiAqICBAcGFyYW0ge1ZlY3RvcjJEfSB0aGF0XG4gKiAgQHJldHVybnMge051bWJlcn1cbiAqL1xuVmVjdG9yMkQucHJvdG90eXBlLmRldGVybWluYW50ID0gZnVuY3Rpb24odGhhdCkge1xuICAgIHJldHVybiB0aGlzLngqdGhhdC55IC0gdGhpcy55KnRoYXQueDtcbn07XG5cbi8qKlxuICogIHVuaXRcbiAqXG4gKiAgQHJldHVybnMge1ZlY3RvcjJEfVxuICovXG5WZWN0b3IyRC5wcm90b3R5cGUudW5pdCA9IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiB0aGlzLmRpdmlkZSggdGhpcy5sZW5ndGgoKSApO1xufTtcblxuLyoqXG4gKiAgYWRkXG4gKlxuICogIEBwYXJhbSB7VmVjdG9yMkR9IHRoYXRcbiAqICBAcmV0dXJucyB7VmVjdG9yMkR9XG4gKi9cblZlY3RvcjJELnByb3RvdHlwZS5hZGQgPSBmdW5jdGlvbih0aGF0KSB7XG4gICAgcmV0dXJuIG5ldyBWZWN0b3IyRCh0aGlzLnggKyB0aGF0LngsIHRoaXMueSArIHRoYXQueSk7XG59O1xuXG4vKipcbiAqICBzdWJ0cmFjdFxuICpcbiAqICBAcGFyYW0ge1ZlY3RvcjJEfSB0aGF0XG4gKiAgQHJldHVybnMge1ZlY3RvcjJEfVxuICovXG5WZWN0b3IyRC5wcm90b3R5cGUuc3VidHJhY3QgPSBmdW5jdGlvbih0aGF0KSB7XG4gICAgcmV0dXJuIG5ldyBWZWN0b3IyRCh0aGlzLnggLSB0aGF0LngsIHRoaXMueSAtIHRoYXQueSk7XG59O1xuXG4vKipcbiAqICBtdWx0aXBseVxuICpcbiAqICBAcGFyYW0ge051bWJlcn0gc2NhbGFyXG4gKiAgQHJldHVybnMge1ZlY3RvcjJEfVxuICovXG5WZWN0b3IyRC5wcm90b3R5cGUubXVsdGlwbHkgPSBmdW5jdGlvbihzY2FsYXIpIHtcbiAgICByZXR1cm4gbmV3IFZlY3RvcjJEKHRoaXMueCAqIHNjYWxhciwgdGhpcy55ICogc2NhbGFyKTtcbn07XG5cbi8qKlxuICogIGRpdmlkZVxuICpcbiAqICBAcGFyYW0ge051bWJlcn0gc2NhbGFyXG4gKiAgQHJldHVybnMge1ZlY3RvcjJEfVxuICovXG5WZWN0b3IyRC5wcm90b3R5cGUuZGl2aWRlID0gZnVuY3Rpb24oc2NhbGFyKSB7XG4gICAgcmV0dXJuIG5ldyBWZWN0b3IyRCh0aGlzLnggLyBzY2FsYXIsIHRoaXMueSAvIHNjYWxhcik7XG59O1xuXG4vKipcbiAqICBhbmdsZUJldHdlZW5cbiAqXG4gKiAgQHBhcmFtIHtWZWN0b3IyRH0gdGhhdFxuICogIEByZXR1cm5zIHtOdW1iZXJ9XG4gKi9cblZlY3RvcjJELnByb3RvdHlwZS5hbmdsZUJldHdlZW4gPSBmdW5jdGlvbih0aGF0KSB7XG4gICAgdmFyIGNvcyA9IHRoaXMuZG90KHRoYXQpIC8gKHRoaXMubGVuZ3RoKCkgKiB0aGF0Lmxlbmd0aCgpKTtcbiAgICBpZiAoY29zIDwgLTEpIHtcbiAgICAgICAgY29zID0gLTE7XG4gICAgfVxuICAgIGVsc2UgaWYgKGNvcyA+IDEpIHtcbiAgICAgICAgY29zID0gMTtcbiAgICB9XG4gICAgdmFyIHJhZGlhbnMgPSBNYXRoLmFjb3MoY29zKTtcblxuICAgIHJldHVybiAodGhpcy5jcm9zcyh0aGF0KSA8IDAuMCkgPyAtcmFkaWFucyA6IHJhZGlhbnM7XG59O1xuXG4vKipcbiAqICBGaW5kIGEgdmVjdG9yIGlzIHRoYXQgaXMgcGVycGVuZGljdWxhciB0byB0aGlzIHZlY3RvclxuICpcbiAqICBAcmV0dXJucyB7VmVjdG9yMkR9XG4gKi9cblZlY3RvcjJELnByb3RvdHlwZS5wZXJwID0gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIG5ldyBWZWN0b3IyRCgtdGhpcy55LCB0aGlzLngpO1xufTtcblxuLyoqXG4gKiAgRmluZCB0aGUgY29tcG9uZW50IG9mIHRoZSBzcGVjaWZpZWQgdmVjdG9yIHRoYXQgaXMgcGVycGVuZGljdWxhciB0b1xuICogIHRoaXMgdmVjdG9yXG4gKlxuICogIEBwYXJhbSB7VmVjdG9yMkR9IHRoYXRcbiAqICBAcmV0dXJucyB7VmVjdG9yMkR9XG4gKi9cblZlY3RvcjJELnByb3RvdHlwZS5wZXJwZW5kaWN1bGFyID0gZnVuY3Rpb24odGhhdCkge1xuICAgIHJldHVybiB0aGlzLnN1YnRyYWN0KHRoaXMucHJvamVjdCh0aGF0KSk7XG59O1xuXG4vKipcbiAqICBwcm9qZWN0XG4gKlxuICogIEBwYXJhbSB7VmVjdG9yMkR9IHRoYXRcbiAqICBAcmV0dXJucyB7VmVjdG9yMkR9XG4gKi9cblZlY3RvcjJELnByb3RvdHlwZS5wcm9qZWN0ID0gZnVuY3Rpb24odGhhdCkge1xuICAgIHZhciBwZXJjZW50ID0gdGhpcy5kb3QodGhhdCkgLyB0aGF0LmRvdCh0aGF0KTtcblxuICAgIHJldHVybiB0aGF0Lm11bHRpcGx5KHBlcmNlbnQpO1xufTtcblxuLyoqXG4gKiAgdHJhbnNmb3JtXG4gKlxuICogIEBwYXJhbSB7TWF0cml4MkR9XG4gKiAgQHJldHVybnMge1ZlY3RvcjJEfVxuICovXG5WZWN0b3IyRC5wcm90b3R5cGUudHJhbnNmb3JtID0gZnVuY3Rpb24obWF0cml4KSB7XG4gICAgcmV0dXJuIG5ldyBWZWN0b3IyRChcbiAgICAgICAgbWF0cml4LmEgKiB0aGlzLnggKyBtYXRyaXguYyAqIHRoaXMueSxcbiAgICAgICAgbWF0cml4LmIgKiB0aGlzLnggKyBtYXRyaXguZCAqIHRoaXMueVxuICAgICk7XG59O1xuXG4vKipcbiAqICBlcXVhbHNcbiAqXG4gKiAgQHBhcmFtIHtWZWN0b3IyRH0gdGhhdFxuICogIEByZXR1cm5zIHtCb29sZWFufVxuICovXG5WZWN0b3IyRC5wcm90b3R5cGUuZXF1YWxzID0gZnVuY3Rpb24odGhhdCkge1xuICAgIHJldHVybiAoXG4gICAgICAgIHRoaXMueCA9PT0gdGhhdC54ICYmXG4gICAgICAgIHRoaXMueSA9PT0gdGhhdC55XG4gICAgKTtcbn07XG5cbi8qKlxuICogIHRvU3RyaW5nXG4gKlxuICogIEByZXR1cm5zIHtTdHJpbmd9XG4gKi9cblZlY3RvcjJELnByb3RvdHlwZS50b1N0cmluZyA9IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiBcInZlY3RvcihcIiArIHRoaXMueCArIFwiLFwiICsgdGhpcy55ICsgXCIpXCI7XG59O1xuXG5pZiAodHlwZW9mIG1vZHVsZSAhPT0gXCJ1bmRlZmluZWRcIikge1xuICAgIG1vZHVsZS5leHBvcnRzID0gVmVjdG9yMkQ7XG59XG4iLCIvLyBleHBvc2UgY2xhc3Nlc1xuXG5leHBvcnRzLlBvbHlub21pYWwgPSByZXF1aXJlKCcuL2xpYi9Qb2x5bm9taWFsJyk7XG5leHBvcnRzLlNxcnRQb2x5bm9taWFsID0gcmVxdWlyZSgnLi9saWIvU3FydFBvbHlub21pYWwnKTtcbiIsIi8qKlxuICpcbiAqICAgUG9seW5vbWlhbC5qc1xuICpcbiAqICAgY29weXJpZ2h0IDIwMDIsIDIxMDMgS2V2aW4gTGluZHNleVxuICpcbiAqL1xuXG5Qb2x5bm9taWFsLlRPTEVSQU5DRSA9IDFlLTY7XG5Qb2x5bm9taWFsLkFDQ1VSQUNZICA9IDE1O1xuXG5cbi8qKlxuICogIGludGVycG9sYXRlXG4gKlxuICogIEBwYXJhbSB7QXJyYXk8TnVtYmVyPn0geHNcbiAqICBAcGFyYW0ge0FycmF5PE51bWJlcj59IHlzXG4gKiAgQHBhcmFtIHtOdW1iZXJ9IG5cbiAqICBAcGFyYW0ge051bWJlcn0gb2Zmc2V0XG4gKiAgQHBhcmFtIHtOdW1iZXJ9IHhcbiAqXG4gKiAgQHJldHVybnMge3k6TnVtYmVyLCBkeTpOdW1iZXJ9XG4gKi9cblBvbHlub21pYWwuaW50ZXJwb2xhdGUgPSBmdW5jdGlvbih4cywgeXMsIG4sIG9mZnNldCwgeCkge1xuICAgIGlmICggeHMuY29uc3RydWN0b3IgIT09IEFycmF5IHx8IHlzLmNvbnN0cnVjdG9yICE9PSBBcnJheSApXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcIlBvbHlub21pYWwuaW50ZXJwb2xhdGU6IHhzIGFuZCB5cyBtdXN0IGJlIGFycmF5c1wiKTtcbiAgICBpZiAoIGlzTmFOKG4pIHx8IGlzTmFOKG9mZnNldCkgfHwgaXNOYU4oeCkgKVxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJQb2x5bm9taWFsLmludGVycG9sYXRlOiBuLCBvZmZzZXQsIGFuZCB4IG11c3QgYmUgbnVtYmVyc1wiKTtcblxuICAgIHZhciB5ICA9IDA7XG4gICAgdmFyIGR5ID0gMDtcbiAgICB2YXIgYyA9IG5ldyBBcnJheShuKTtcbiAgICB2YXIgZCA9IG5ldyBBcnJheShuKTtcbiAgICB2YXIgbnMgPSAwO1xuICAgIHZhciByZXN1bHQ7XG5cbiAgICB2YXIgZGlmZiA9IE1hdGguYWJzKHggLSB4c1tvZmZzZXRdKTtcbiAgICBmb3IgKCB2YXIgaSA9IDA7IGkgPCBuOyBpKysgKSB7XG4gICAgICAgIHZhciBkaWZ0ID0gTWF0aC5hYnMoeCAtIHhzW29mZnNldCtpXSk7XG5cbiAgICAgICAgaWYgKCBkaWZ0IDwgZGlmZiApIHtcbiAgICAgICAgICAgIG5zID0gaTtcbiAgICAgICAgICAgIGRpZmYgPSBkaWZ0O1xuICAgICAgICB9XG4gICAgICAgIGNbaV0gPSBkW2ldID0geXNbb2Zmc2V0K2ldO1xuICAgIH1cbiAgICB5ID0geXNbb2Zmc2V0K25zXTtcbiAgICBucy0tO1xuXG4gICAgZm9yICggdmFyIG0gPSAxOyBtIDwgbjsgbSsrICkge1xuICAgICAgICBmb3IgKCB2YXIgaSA9IDA7IGkgPCBuLW07IGkrKyApIHtcbiAgICAgICAgICAgIHZhciBobyA9IHhzW29mZnNldCtpXSAtIHg7XG4gICAgICAgICAgICB2YXIgaHAgPSB4c1tvZmZzZXQraSttXSAtIHg7XG4gICAgICAgICAgICB2YXIgdyA9IGNbaSsxXS1kW2ldO1xuICAgICAgICAgICAgdmFyIGRlbiA9IGhvIC0gaHA7XG5cbiAgICAgICAgICAgIGlmICggZGVuID09IDAuMCApIHtcbiAgICAgICAgICAgICAgICByZXN1bHQgPSB7IHk6IDAsIGR5OiAwfTtcbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgZGVuID0gdyAvIGRlbjtcbiAgICAgICAgICAgIGRbaV0gPSBocCpkZW47XG4gICAgICAgICAgICBjW2ldID0gaG8qZGVuO1xuICAgICAgICB9XG4gICAgICAgIGR5ID0gKDIqKG5zKzEpIDwgKG4tbSkpID8gY1tucysxXSA6IGRbbnMtLV07XG4gICAgICAgIHkgKz0gZHk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHsgeTogeSwgZHk6IGR5IH07XG59O1xuXG5cbi8qKlxuICogIFBvbHlub21pYWxcbiAqXG4gKiAgQHJldHVybnMge1BvbHlub21pYWx9XG4gKi9cbmZ1bmN0aW9uIFBvbHlub21pYWwoKSB7XG4gICAgdGhpcy5pbml0KCBhcmd1bWVudHMgKTtcbn1cblxuXG4vKipcbiAqICBpbml0XG4gKi9cblBvbHlub21pYWwucHJvdG90eXBlLmluaXQgPSBmdW5jdGlvbihjb2Vmcykge1xuICAgIHRoaXMuY29lZnMgPSBuZXcgQXJyYXkoKTtcblxuICAgIGZvciAoIHZhciBpID0gY29lZnMubGVuZ3RoIC0gMTsgaSA+PSAwOyBpLS0gKVxuICAgICAgICB0aGlzLmNvZWZzLnB1c2goIGNvZWZzW2ldICk7XG5cbiAgICB0aGlzLl92YXJpYWJsZSA9IFwidFwiO1xuICAgIHRoaXMuX3MgPSAwO1xufTtcblxuXG4vKipcbiAqICBldmFsXG4gKi9cblBvbHlub21pYWwucHJvdG90eXBlLmV2YWwgPSBmdW5jdGlvbih4KSB7XG4gICAgaWYgKCBpc05hTih4KSApXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcIlBvbHlub21pYWwuZXZhbDogcGFyYW1ldGVyIG11c3QgYmUgYSBudW1iZXJcIik7XG5cbiAgICB2YXIgcmVzdWx0ID0gMDtcblxuICAgIGZvciAoIHZhciBpID0gdGhpcy5jb2Vmcy5sZW5ndGggLSAxOyBpID49IDA7IGktLSApXG4gICAgICAgIHJlc3VsdCA9IHJlc3VsdCAqIHggKyB0aGlzLmNvZWZzW2ldO1xuXG4gICAgcmV0dXJuIHJlc3VsdDtcbn07XG5cblxuLyoqXG4gKiAgYWRkXG4gKi9cblBvbHlub21pYWwucHJvdG90eXBlLmFkZCA9IGZ1bmN0aW9uKHRoYXQpIHtcbiAgICB2YXIgcmVzdWx0ID0gbmV3IFBvbHlub21pYWwoKTtcbiAgICB2YXIgZDEgPSB0aGlzLmdldERlZ3JlZSgpO1xuICAgIHZhciBkMiA9IHRoYXQuZ2V0RGVncmVlKCk7XG4gICAgdmFyIGRtYXggPSBNYXRoLm1heChkMSxkMik7XG5cbiAgICBmb3IgKCB2YXIgaSA9IDA7IGkgPD0gZG1heDsgaSsrICkge1xuICAgICAgICB2YXIgdjEgPSAoaSA8PSBkMSkgPyB0aGlzLmNvZWZzW2ldIDogMDtcbiAgICAgICAgdmFyIHYyID0gKGkgPD0gZDIpID8gdGhhdC5jb2Vmc1tpXSA6IDA7XG5cbiAgICAgICAgcmVzdWx0LmNvZWZzW2ldID0gdjEgKyB2MjtcbiAgICB9XG5cbiAgICByZXR1cm4gcmVzdWx0O1xufTtcblxuXG4vKipcbiAqICBtdWx0aXBseVxuICovXG5Qb2x5bm9taWFsLnByb3RvdHlwZS5tdWx0aXBseSA9IGZ1bmN0aW9uKHRoYXQpIHtcbiAgICB2YXIgcmVzdWx0ID0gbmV3IFBvbHlub21pYWwoKTtcblxuICAgIGZvciAoIHZhciBpID0gMDsgaSA8PSB0aGlzLmdldERlZ3JlZSgpICsgdGhhdC5nZXREZWdyZWUoKTsgaSsrIClcbiAgICAgICAgcmVzdWx0LmNvZWZzLnB1c2goMCk7XG5cbiAgICBmb3IgKCB2YXIgaSA9IDA7IGkgPD0gdGhpcy5nZXREZWdyZWUoKTsgaSsrIClcbiAgICAgICAgZm9yICggdmFyIGogPSAwOyBqIDw9IHRoYXQuZ2V0RGVncmVlKCk7IGorKyApXG4gICAgICAgICAgICByZXN1bHQuY29lZnNbaStqXSArPSB0aGlzLmNvZWZzW2ldICogdGhhdC5jb2Vmc1tqXTtcblxuICAgIHJldHVybiByZXN1bHQ7XG59O1xuXG5cbi8qKlxuICogIGRpdmlkZV9zY2FsYXJcbiAqL1xuUG9seW5vbWlhbC5wcm90b3R5cGUuZGl2aWRlX3NjYWxhciA9IGZ1bmN0aW9uKHNjYWxhcikge1xuICAgIGZvciAoIHZhciBpID0gMDsgaSA8IHRoaXMuY29lZnMubGVuZ3RoOyBpKysgKVxuICAgICAgICB0aGlzLmNvZWZzW2ldIC89IHNjYWxhcjtcbn07XG5cblxuLyoqXG4gKiAgc2ltcGxpZnlcbiAqL1xuUG9seW5vbWlhbC5wcm90b3R5cGUuc2ltcGxpZnkgPSBmdW5jdGlvbigpIHtcbiAgICBmb3IgKCB2YXIgaSA9IHRoaXMuZ2V0RGVncmVlKCk7IGkgPj0gMDsgaS0tICkge1xuICAgICAgICBpZiAoIE1hdGguYWJzKCB0aGlzLmNvZWZzW2ldICkgPD0gUG9seW5vbWlhbC5UT0xFUkFOQ0UgKVxuICAgICAgICAgICAgdGhpcy5jb2Vmcy5wb3AoKTtcbiAgICAgICAgZWxzZVxuICAgICAgICAgICAgYnJlYWs7XG4gICAgfVxufTtcblxuXG4vKipcbiAqICBiaXNlY3Rpb25cbiAqL1xuUG9seW5vbWlhbC5wcm90b3R5cGUuYmlzZWN0aW9uID0gZnVuY3Rpb24obWluLCBtYXgpIHtcbiAgICB2YXIgbWluVmFsdWUgPSB0aGlzLmV2YWwobWluKTtcbiAgICB2YXIgbWF4VmFsdWUgPSB0aGlzLmV2YWwobWF4KTtcbiAgICB2YXIgcmVzdWx0O1xuXG4gICAgaWYgKCBNYXRoLmFicyhtaW5WYWx1ZSkgPD0gUG9seW5vbWlhbC5UT0xFUkFOQ0UgKVxuICAgICAgICByZXN1bHQgPSBtaW47XG4gICAgZWxzZSBpZiAoIE1hdGguYWJzKG1heFZhbHVlKSA8PSBQb2x5bm9taWFsLlRPTEVSQU5DRSApXG4gICAgICAgIHJlc3VsdCA9IG1heDtcbiAgICBlbHNlIGlmICggbWluVmFsdWUgKiBtYXhWYWx1ZSA8PSAwICkge1xuICAgICAgICB2YXIgdG1wMSAgPSBNYXRoLmxvZyhtYXggLSBtaW4pO1xuICAgICAgICB2YXIgdG1wMiAgPSBNYXRoLkxOMTAgKiBQb2x5bm9taWFsLkFDQ1VSQUNZO1xuICAgICAgICB2YXIgaXRlcnMgPSBNYXRoLmNlaWwoICh0bXAxK3RtcDIpIC8gTWF0aC5MTjIgKTtcblxuICAgICAgICBmb3IgKCB2YXIgaSA9IDA7IGkgPCBpdGVyczsgaSsrICkge1xuICAgICAgICAgICAgcmVzdWx0ID0gMC41ICogKG1pbiArIG1heCk7XG4gICAgICAgICAgICB2YXIgdmFsdWUgPSB0aGlzLmV2YWwocmVzdWx0KTtcblxuICAgICAgICAgICAgaWYgKCBNYXRoLmFicyh2YWx1ZSkgPD0gUG9seW5vbWlhbC5UT0xFUkFOQ0UgKSB7XG4gICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmICggdmFsdWUgKiBtaW5WYWx1ZSA8IDAgKSB7XG4gICAgICAgICAgICAgICAgbWF4ID0gcmVzdWx0O1xuICAgICAgICAgICAgICAgIG1heFZhbHVlID0gdmFsdWU7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIG1pbiA9IHJlc3VsdDtcbiAgICAgICAgICAgICAgICBtaW5WYWx1ZSA9IHZhbHVlO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHJlc3VsdDtcbn07XG5cblxuLyoqXG4gKiAgdG9TdHJpbmdcbiAqL1xuUG9seW5vbWlhbC5wcm90b3R5cGUudG9TdHJpbmcgPSBmdW5jdGlvbigpIHtcbiAgICB2YXIgY29lZnMgPSBuZXcgQXJyYXkoKTtcbiAgICB2YXIgc2lnbnMgPSBuZXcgQXJyYXkoKTtcblxuICAgIGZvciAoIHZhciBpID0gdGhpcy5jb2Vmcy5sZW5ndGggLSAxOyBpID49IDA7IGktLSApIHtcbiAgICAgICAgdmFyIHZhbHVlID0gTWF0aC5yb3VuZCh0aGlzLmNvZWZzW2ldKjEwMDApLzEwMDA7XG4gICAgICAgIC8vdmFyIHZhbHVlID0gdGhpcy5jb2Vmc1tpXTtcblxuICAgICAgICBpZiAoIHZhbHVlICE9IDAgKSB7XG4gICAgICAgICAgICB2YXIgc2lnbiA9ICggdmFsdWUgPCAwICkgPyBcIiAtIFwiIDogXCIgKyBcIjtcblxuICAgICAgICAgICAgdmFsdWUgPSBNYXRoLmFicyh2YWx1ZSk7XG4gICAgICAgICAgICBpZiAoIGkgPiAwIClcbiAgICAgICAgICAgICAgICBpZiAoIHZhbHVlID09IDEgKVxuICAgICAgICAgICAgICAgICAgICB2YWx1ZSA9IHRoaXMuX3ZhcmlhYmxlO1xuICAgICAgICAgICAgICAgIGVsc2VcbiAgICAgICAgICAgICAgICAgICAgdmFsdWUgKz0gdGhpcy5fdmFyaWFibGU7XG4gICAgICAgICAgICBpZiAoIGkgPiAxICkgdmFsdWUgKz0gXCJeXCIgKyBpO1xuXG4gICAgICAgICAgICBzaWducy5wdXNoKCBzaWduICk7XG4gICAgICAgICAgICBjb2Vmcy5wdXNoKCB2YWx1ZSApO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgc2lnbnNbMF0gPSAoIHNpZ25zWzBdID09IFwiICsgXCIgKSA/IFwiXCIgOiBcIi1cIjtcblxuICAgIHZhciByZXN1bHQgPSBcIlwiO1xuICAgIGZvciAoIHZhciBpID0gMDsgaSA8IGNvZWZzLmxlbmd0aDsgaSsrIClcbiAgICAgICAgcmVzdWx0ICs9IHNpZ25zW2ldICsgY29lZnNbaV07XG5cbiAgICByZXR1cm4gcmVzdWx0O1xufTtcblxuXG4vKipcbiAqICB0cmFwZXpvaWRcbiAqICBCYXNlZCBvbiB0cmFwemQgaW4gXCJOdW1lcmljYWwgUmVjaXBlcyBpbiBDXCIsIHBhZ2UgMTM3XG4gKi9cblBvbHlub21pYWwucHJvdG90eXBlLnRyYXBlem9pZCA9IGZ1bmN0aW9uKG1pbiwgbWF4LCBuKSB7XG4gICAgaWYgKCBpc05hTihtaW4pIHx8IGlzTmFOKG1heCkgfHwgaXNOYU4obikgKVxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJQb2x5bm9taWFsLnRyYXBlem9pZDogcGFyYW1ldGVycyBtdXN0IGJlIG51bWJlcnNcIik7XG5cbiAgICB2YXIgcmFuZ2UgPSBtYXggLSBtaW47XG4gICAgdmFyIFRPTEVSQU5DRSA9IDFlLTc7XG5cbiAgICBpZiAoIG4gPT0gMSApIHtcbiAgICAgICAgdmFyIG1pblZhbHVlID0gdGhpcy5ldmFsKG1pbik7XG4gICAgICAgIHZhciBtYXhWYWx1ZSA9IHRoaXMuZXZhbChtYXgpO1xuICAgICAgICB0aGlzLl9zID0gMC41KnJhbmdlKiggbWluVmFsdWUgKyBtYXhWYWx1ZSApO1xuICAgIH0gZWxzZSB7XG4gICAgICAgIHZhciBpdCA9IDEgPDwgKG4tMik7XG4gICAgICAgIHZhciBkZWx0YSA9IHJhbmdlIC8gaXQ7XG4gICAgICAgIHZhciB4ID0gbWluICsgMC41KmRlbHRhO1xuICAgICAgICB2YXIgc3VtID0gMDtcblxuICAgICAgICBmb3IgKCB2YXIgaSA9IDA7IGkgPCBpdDsgaSsrICkge1xuICAgICAgICAgICAgc3VtICs9IHRoaXMuZXZhbCh4KTtcbiAgICAgICAgICAgIHggKz0gZGVsdGE7XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5fcyA9IDAuNSoodGhpcy5fcyArIHJhbmdlKnN1bS9pdCk7XG4gICAgfVxuXG4gICAgaWYgKCBpc05hTih0aGlzLl9zKSApXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcIlBvbHlub21pYWwudHJhcGV6b2lkOiB0aGlzLl9zIGlzIE5hTlwiKTtcblxuICAgIHJldHVybiB0aGlzLl9zO1xufTtcblxuXG4vKipcbiAqICBzaW1wc29uXG4gKiAgQmFzZWQgb24gdHJhcHpkIGluIFwiTnVtZXJpY2FsIFJlY2lwZXMgaW4gQ1wiLCBwYWdlIDEzOVxuICovXG5Qb2x5bm9taWFsLnByb3RvdHlwZS5zaW1wc29uID0gZnVuY3Rpb24obWluLCBtYXgpIHtcbiAgICBpZiAoIGlzTmFOKG1pbikgfHwgaXNOYU4obWF4KSApXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcIlBvbHlub21pYWwuc2ltcHNvbjogcGFyYW1ldGVycyBtdXN0IGJlIG51bWJlcnNcIik7XG5cbiAgICB2YXIgcmFuZ2UgPSBtYXggLSBtaW47XG4gICAgdmFyIHN0ID0gMC41ICogcmFuZ2UgKiAoIHRoaXMuZXZhbChtaW4pICsgdGhpcy5ldmFsKG1heCkgKTtcbiAgICB2YXIgdCA9IHN0O1xuICAgIHZhciBzID0gNC4wKnN0LzMuMDtcbiAgICB2YXIgb3MgPSBzO1xuICAgIHZhciBvc3QgPSBzdDtcbiAgICB2YXIgVE9MRVJBTkNFID0gMWUtNztcblxuICAgIHZhciBpdCA9IDE7XG4gICAgZm9yICggdmFyIG4gPSAyOyBuIDw9IDIwOyBuKysgKSB7XG4gICAgICAgIHZhciBkZWx0YSA9IHJhbmdlIC8gaXQ7XG4gICAgICAgIHZhciB4ICAgICA9IG1pbiArIDAuNSpkZWx0YTtcbiAgICAgICAgdmFyIHN1bSAgID0gMDtcblxuICAgICAgICBmb3IgKCB2YXIgaSA9IDE7IGkgPD0gaXQ7IGkrKyApIHtcbiAgICAgICAgICAgIHN1bSArPSB0aGlzLmV2YWwoeCk7XG4gICAgICAgICAgICB4ICs9IGRlbHRhO1xuICAgICAgICB9XG5cbiAgICAgICAgdCA9IDAuNSAqICh0ICsgcmFuZ2UgKiBzdW0gLyBpdCk7XG4gICAgICAgIHN0ID0gdDtcbiAgICAgICAgcyA9ICg0LjAqc3QgLSBvc3QpLzMuMDtcblxuICAgICAgICBpZiAoIE1hdGguYWJzKHMtb3MpIDwgVE9MRVJBTkNFKk1hdGguYWJzKG9zKSApXG4gICAgICAgICAgICBicmVhaztcblxuICAgICAgICBvcyA9IHM7XG4gICAgICAgIG9zdCA9IHN0O1xuICAgICAgICBpdCA8PD0gMTtcbiAgICB9XG5cbiAgICByZXR1cm4gcztcbn07XG5cblxuLyoqXG4gKiAgcm9tYmVyZ1xuICovXG5Qb2x5bm9taWFsLnByb3RvdHlwZS5yb21iZXJnID0gZnVuY3Rpb24obWluLCBtYXgpIHtcbiAgICBpZiAoIGlzTmFOKG1pbikgfHwgaXNOYU4obWF4KSApXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcIlBvbHlub21pYWwucm9tYmVyZzogcGFyYW1ldGVycyBtdXN0IGJlIG51bWJlcnNcIik7XG5cbiAgICB2YXIgTUFYID0gMjA7XG4gICAgdmFyIEsgPSAzO1xuICAgIHZhciBUT0xFUkFOQ0UgPSAxZS02O1xuICAgIHZhciBzID0gbmV3IEFycmF5KE1BWCsxKTtcbiAgICB2YXIgaCA9IG5ldyBBcnJheShNQVgrMSk7XG4gICAgdmFyIHJlc3VsdCA9IHsgeTogMCwgZHk6IDAgfTtcblxuICAgIGhbMF0gPSAxLjA7XG4gICAgZm9yICggdmFyIGogPSAxOyBqIDw9IE1BWDsgaisrICkge1xuICAgICAgICBzW2otMV0gPSB0aGlzLnRyYXBlem9pZChtaW4sIG1heCwgaik7XG4gICAgICAgIGlmICggaiA+PSBLICkge1xuICAgICAgICAgICAgcmVzdWx0ID0gUG9seW5vbWlhbC5pbnRlcnBvbGF0ZShoLCBzLCBLLCBqLUssIDAuMCk7XG4gICAgICAgICAgICBpZiAoIE1hdGguYWJzKHJlc3VsdC5keSkgPD0gVE9MRVJBTkNFKnJlc3VsdC55KSBicmVhaztcbiAgICAgICAgfVxuICAgICAgICBzW2pdID0gc1tqLTFdO1xuICAgICAgICBoW2pdID0gMC4yNSAqIGhbai0xXTtcbiAgICB9XG5cbiAgICByZXR1cm4gcmVzdWx0Lnk7XG59O1xuXG4vLyBnZXR0ZXJzIGFuZCBzZXR0ZXJzXG5cbi8qKlxuICogIGdldCBkZWdyZWVcbiAqL1xuUG9seW5vbWlhbC5wcm90b3R5cGUuZ2V0RGVncmVlID0gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIHRoaXMuY29lZnMubGVuZ3RoIC0gMTtcbn07XG5cblxuLyoqXG4gKiAgZ2V0RGVyaXZhdGl2ZVxuICovXG5Qb2x5bm9taWFsLnByb3RvdHlwZS5nZXREZXJpdmF0aXZlID0gZnVuY3Rpb24oKSB7XG4gICAgdmFyIGRlcml2YXRpdmUgPSBuZXcgUG9seW5vbWlhbCgpO1xuXG4gICAgZm9yICggdmFyIGkgPSAxOyBpIDwgdGhpcy5jb2Vmcy5sZW5ndGg7IGkrKyApIHtcbiAgICAgICAgZGVyaXZhdGl2ZS5jb2Vmcy5wdXNoKGkqdGhpcy5jb2Vmc1tpXSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGRlcml2YXRpdmU7XG59O1xuXG5cbi8qKlxuICogIGdldFJvb3RzXG4gKi9cblBvbHlub21pYWwucHJvdG90eXBlLmdldFJvb3RzID0gZnVuY3Rpb24oKSB7XG4gICAgdmFyIHJlc3VsdDtcblxuICAgIHRoaXMuc2ltcGxpZnkoKTtcbiAgICBzd2l0Y2ggKCB0aGlzLmdldERlZ3JlZSgpICkge1xuICAgICAgICBjYXNlIDA6IHJlc3VsdCA9IG5ldyBBcnJheSgpOyAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgIGNhc2UgMTogcmVzdWx0ID0gdGhpcy5nZXRMaW5lYXJSb290KCk7ICAgICBicmVhaztcbiAgICAgICAgY2FzZSAyOiByZXN1bHQgPSB0aGlzLmdldFF1YWRyYXRpY1Jvb3RzKCk7IGJyZWFrO1xuICAgICAgICBjYXNlIDM6IHJlc3VsdCA9IHRoaXMuZ2V0Q3ViaWNSb290cygpOyAgICAgYnJlYWs7XG4gICAgICAgIGNhc2UgNDogcmVzdWx0ID0gdGhpcy5nZXRRdWFydGljUm9vdHMoKTsgICBicmVhaztcbiAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAgIHJlc3VsdCA9IG5ldyBBcnJheSgpO1xuICAgICAgICAgICAgLy8gc2hvdWxkIHRyeSBOZXd0b24ncyBtZXRob2QgYW5kL29yIGJpc2VjdGlvblxuICAgIH1cblxuICAgIHJldHVybiByZXN1bHQ7XG59O1xuXG5cbi8qKlxuICogIGdldFJvb3RzSW5JbnRlcnZhbFxuICovXG5Qb2x5bm9taWFsLnByb3RvdHlwZS5nZXRSb290c0luSW50ZXJ2YWwgPSBmdW5jdGlvbihtaW4sIG1heCkge1xuICAgIHZhciByb290cyA9IG5ldyBBcnJheSgpO1xuICAgIHZhciByb290O1xuXG4gICAgaWYgKCB0aGlzLmdldERlZ3JlZSgpID09IDEgKSB7XG4gICAgICAgIHJvb3QgPSB0aGlzLmJpc2VjdGlvbihtaW4sIG1heCk7XG4gICAgICAgIGlmICggcm9vdCAhPSBudWxsICkgcm9vdHMucHVzaChyb290KTtcbiAgICB9IGVsc2Uge1xuICAgICAgICAvLyBnZXQgcm9vdHMgb2YgZGVyaXZhdGl2ZVxuICAgICAgICB2YXIgZGVyaXYgID0gdGhpcy5nZXREZXJpdmF0aXZlKCk7XG4gICAgICAgIHZhciBkcm9vdHMgPSBkZXJpdi5nZXRSb290c0luSW50ZXJ2YWwobWluLCBtYXgpO1xuXG4gICAgICAgIGlmICggZHJvb3RzLmxlbmd0aCA+IDAgKSB7XG4gICAgICAgICAgICAvLyBmaW5kIHJvb3Qgb24gW21pbiwgZHJvb3RzWzBdXVxuICAgICAgICAgICAgcm9vdCA9IHRoaXMuYmlzZWN0aW9uKG1pbiwgZHJvb3RzWzBdKTtcbiAgICAgICAgICAgIGlmICggcm9vdCAhPSBudWxsICkgcm9vdHMucHVzaChyb290KTtcblxuICAgICAgICAgICAgLy8gZmluZCByb290IG9uIFtkcm9vdHNbaV0sZHJvb3RzW2krMV1dIGZvciAwIDw9IGkgPD0gY291bnQtMlxuICAgICAgICAgICAgZm9yICggaSA9IDA7IGkgPD0gZHJvb3RzLmxlbmd0aC0yOyBpKysgKSB7XG4gICAgICAgICAgICAgICAgcm9vdCA9IHRoaXMuYmlzZWN0aW9uKGRyb290c1tpXSwgZHJvb3RzW2krMV0pO1xuICAgICAgICAgICAgICAgIGlmICggcm9vdCAhPSBudWxsICkgcm9vdHMucHVzaChyb290KTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gZmluZCByb290IG9uIFtkcm9vdHNbY291bnQtMV0seG1heF1cbiAgICAgICAgICAgIHJvb3QgPSB0aGlzLmJpc2VjdGlvbihkcm9vdHNbZHJvb3RzLmxlbmd0aC0xXSwgbWF4KTtcbiAgICAgICAgICAgIGlmICggcm9vdCAhPSBudWxsICkgcm9vdHMucHVzaChyb290KTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIC8vIHBvbHlub21pYWwgaXMgbW9ub3RvbmUgb24gW21pbixtYXhdLCBoYXMgYXQgbW9zdCBvbmUgcm9vdFxuICAgICAgICAgICAgcm9vdCA9IHRoaXMuYmlzZWN0aW9uKG1pbiwgbWF4KTtcbiAgICAgICAgICAgIGlmICggcm9vdCAhPSBudWxsICkgcm9vdHMucHVzaChyb290KTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiByb290cztcbn07XG5cblxuLyoqXG4gKiAgZ2V0TGluZWFyUm9vdFxuICovXG5Qb2x5bm9taWFsLnByb3RvdHlwZS5nZXRMaW5lYXJSb290ID0gZnVuY3Rpb24oKSB7XG4gICAgdmFyIHJlc3VsdCA9IG5ldyBBcnJheSgpO1xuICAgIHZhciBhID0gdGhpcy5jb2Vmc1sxXTtcblxuICAgIGlmICggYSAhPSAwIClcbiAgICAgICAgcmVzdWx0LnB1c2goIC10aGlzLmNvZWZzWzBdIC8gYSApO1xuXG4gICAgcmV0dXJuIHJlc3VsdDtcbn07XG5cblxuLyoqXG4gKiAgZ2V0UXVhZHJhdGljUm9vdHNcbiAqL1xuUG9seW5vbWlhbC5wcm90b3R5cGUuZ2V0UXVhZHJhdGljUm9vdHMgPSBmdW5jdGlvbigpIHtcbiAgICB2YXIgcmVzdWx0cyA9IG5ldyBBcnJheSgpO1xuXG4gICAgaWYgKCB0aGlzLmdldERlZ3JlZSgpID09IDIgKSB7XG4gICAgICAgIHZhciBhID0gdGhpcy5jb2Vmc1syXTtcbiAgICAgICAgdmFyIGIgPSB0aGlzLmNvZWZzWzFdIC8gYTtcbiAgICAgICAgdmFyIGMgPSB0aGlzLmNvZWZzWzBdIC8gYTtcbiAgICAgICAgdmFyIGQgPSBiKmIgLSA0KmM7XG5cbiAgICAgICAgaWYgKCBkID4gMCApIHtcbiAgICAgICAgICAgIHZhciBlID0gTWF0aC5zcXJ0KGQpO1xuXG4gICAgICAgICAgICByZXN1bHRzLnB1c2goIDAuNSAqICgtYiArIGUpICk7XG4gICAgICAgICAgICByZXN1bHRzLnB1c2goIDAuNSAqICgtYiAtIGUpICk7XG4gICAgICAgIH0gZWxzZSBpZiAoIGQgPT0gMCApIHtcbiAgICAgICAgICAgIC8vIHJlYWxseSB0d28gcm9vdHMgd2l0aCBzYW1lIHZhbHVlLCBidXQgd2Ugb25seSByZXR1cm4gb25lXG4gICAgICAgICAgICByZXN1bHRzLnB1c2goIDAuNSAqIC1iICk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gcmVzdWx0cztcbn07XG5cblxuLyoqXG4gKiAgZ2V0Q3ViaWNSb290c1xuICpcbiAqICBUaGlzIGNvZGUgaXMgYmFzZWQgb24gTWdjUG9seW5vbWlhbC5jcHAgd3JpdHRlbiBieSBEYXZpZCBFYmVybHkuICBIaXNcbiAqICBjb2RlIGFsb25nIHdpdGggbWFueSBvdGhlciBleGNlbGxlbnQgZXhhbXBsZXMgYXJlIGF2YWlhYmxlIGF0IGhpcyBzaXRlOlxuICogIGh0dHA6Ly93d3cubWFnaWMtc29mdHdhcmUuY29tXG4gKi9cblBvbHlub21pYWwucHJvdG90eXBlLmdldEN1YmljUm9vdHMgPSBmdW5jdGlvbigpIHtcbiAgICB2YXIgcmVzdWx0cyA9IG5ldyBBcnJheSgpO1xuXG4gICAgaWYgKCB0aGlzLmdldERlZ3JlZSgpID09IDMgKSB7XG4gICAgICAgIHZhciBjMyA9IHRoaXMuY29lZnNbM107XG4gICAgICAgIHZhciBjMiA9IHRoaXMuY29lZnNbMl0gLyBjMztcbiAgICAgICAgdmFyIGMxID0gdGhpcy5jb2Vmc1sxXSAvIGMzO1xuICAgICAgICB2YXIgYzAgPSB0aGlzLmNvZWZzWzBdIC8gYzM7XG5cbiAgICAgICAgdmFyIGEgICAgICAgPSAoMypjMSAtIGMyKmMyKSAvIDM7XG4gICAgICAgIHZhciBiICAgICAgID0gKDIqYzIqYzIqYzIgLSA5KmMxKmMyICsgMjcqYzApIC8gMjc7XG4gICAgICAgIHZhciBvZmZzZXQgID0gYzIgLyAzO1xuICAgICAgICB2YXIgZGlzY3JpbSA9IGIqYi80ICsgYSphKmEvMjc7XG4gICAgICAgIHZhciBoYWxmQiAgID0gYiAvIDI7XG5cbiAgICAgICAgaWYgKCBNYXRoLmFicyhkaXNjcmltKSA8PSBQb2x5bm9taWFsLlRPTEVSQU5DRSApIGRpc2NyaW0gPSAwO1xuXG4gICAgICAgIGlmICggZGlzY3JpbSA+IDAgKSB7XG4gICAgICAgICAgICB2YXIgZSA9IE1hdGguc3FydChkaXNjcmltKTtcbiAgICAgICAgICAgIHZhciB0bXA7XG4gICAgICAgICAgICB2YXIgcm9vdDtcblxuICAgICAgICAgICAgdG1wID0gLWhhbGZCICsgZTtcbiAgICAgICAgICAgIGlmICggdG1wID49IDAgKVxuICAgICAgICAgICAgICAgIHJvb3QgPSBNYXRoLnBvdyh0bXAsIDEvMyk7XG4gICAgICAgICAgICBlbHNlXG4gICAgICAgICAgICAgICAgcm9vdCA9IC1NYXRoLnBvdygtdG1wLCAxLzMpO1xuXG4gICAgICAgICAgICB0bXAgPSAtaGFsZkIgLSBlO1xuICAgICAgICAgICAgaWYgKCB0bXAgPj0gMCApXG4gICAgICAgICAgICAgICAgcm9vdCArPSBNYXRoLnBvdyh0bXAsIDEvMyk7XG4gICAgICAgICAgICBlbHNlXG4gICAgICAgICAgICAgICAgcm9vdCAtPSBNYXRoLnBvdygtdG1wLCAxLzMpO1xuXG4gICAgICAgICAgICByZXN1bHRzLnB1c2goIHJvb3QgLSBvZmZzZXQgKTtcbiAgICAgICAgfSBlbHNlIGlmICggZGlzY3JpbSA8IDAgKSB7XG4gICAgICAgICAgICB2YXIgZGlzdGFuY2UgPSBNYXRoLnNxcnQoLWEvMyk7XG4gICAgICAgICAgICB2YXIgYW5nbGUgICAgPSBNYXRoLmF0YW4yKCBNYXRoLnNxcnQoLWRpc2NyaW0pLCAtaGFsZkIpIC8gMztcbiAgICAgICAgICAgIHZhciBjb3MgICAgICA9IE1hdGguY29zKGFuZ2xlKTtcbiAgICAgICAgICAgIHZhciBzaW4gICAgICA9IE1hdGguc2luKGFuZ2xlKTtcbiAgICAgICAgICAgIHZhciBzcXJ0MyAgICA9IE1hdGguc3FydCgzKTtcblxuICAgICAgICAgICAgcmVzdWx0cy5wdXNoKCAyKmRpc3RhbmNlKmNvcyAtIG9mZnNldCApO1xuICAgICAgICAgICAgcmVzdWx0cy5wdXNoKCAtZGlzdGFuY2UgKiAoY29zICsgc3FydDMgKiBzaW4pIC0gb2Zmc2V0KTtcbiAgICAgICAgICAgIHJlc3VsdHMucHVzaCggLWRpc3RhbmNlICogKGNvcyAtIHNxcnQzICogc2luKSAtIG9mZnNldCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB2YXIgdG1wO1xuXG4gICAgICAgICAgICBpZiAoIGhhbGZCID49IDAgKVxuICAgICAgICAgICAgICAgIHRtcCA9IC1NYXRoLnBvdyhoYWxmQiwgMS8zKTtcbiAgICAgICAgICAgIGVsc2VcbiAgICAgICAgICAgICAgICB0bXAgPSBNYXRoLnBvdygtaGFsZkIsIDEvMyk7XG5cbiAgICAgICAgICAgIHJlc3VsdHMucHVzaCggMip0bXAgLSBvZmZzZXQgKTtcbiAgICAgICAgICAgIC8vIHJlYWxseSBzaG91bGQgcmV0dXJuIG5leHQgcm9vdCB0d2ljZSwgYnV0IHdlIHJldHVybiBvbmx5IG9uZVxuICAgICAgICAgICAgcmVzdWx0cy5wdXNoKCAtdG1wIC0gb2Zmc2V0ICk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gcmVzdWx0cztcbn07XG5cblxuLyoqXG4gKiAgZ2V0UXVhcnRpY1Jvb3RzXG4gKlxuICogIFRoaXMgY29kZSBpcyBiYXNlZCBvbiBNZ2NQb2x5bm9taWFsLmNwcCB3cml0dGVuIGJ5IERhdmlkIEViZXJseS4gIEhpc1xuICogIGNvZGUgYWxvbmcgd2l0aCBtYW55IG90aGVyIGV4Y2VsbGVudCBleGFtcGxlcyBhcmUgYXZhaWFibGUgYXQgaGlzIHNpdGU6XG4gKiAgaHR0cDovL3d3dy5tYWdpYy1zb2Z0d2FyZS5jb21cbiAqL1xuUG9seW5vbWlhbC5wcm90b3R5cGUuZ2V0UXVhcnRpY1Jvb3RzID0gZnVuY3Rpb24oKSB7XG4gICAgdmFyIHJlc3VsdHMgPSBuZXcgQXJyYXkoKTtcblxuICAgIGlmICggdGhpcy5nZXREZWdyZWUoKSA9PSA0ICkge1xuICAgICAgICB2YXIgYzQgPSB0aGlzLmNvZWZzWzRdO1xuICAgICAgICB2YXIgYzMgPSB0aGlzLmNvZWZzWzNdIC8gYzQ7XG4gICAgICAgIHZhciBjMiA9IHRoaXMuY29lZnNbMl0gLyBjNDtcbiAgICAgICAgdmFyIGMxID0gdGhpcy5jb2Vmc1sxXSAvIGM0O1xuICAgICAgICB2YXIgYzAgPSB0aGlzLmNvZWZzWzBdIC8gYzQ7XG5cbiAgICAgICAgdmFyIHJlc29sdmVSb290cyA9IG5ldyBQb2x5bm9taWFsKFxuICAgICAgICAgICAgMSwgLWMyLCBjMypjMSAtIDQqYzAsIC1jMypjMypjMCArIDQqYzIqYzAgLWMxKmMxXG4gICAgICAgICkuZ2V0Q3ViaWNSb290cygpO1xuICAgICAgICB2YXIgeSAgICAgICA9IHJlc29sdmVSb290c1swXTtcbiAgICAgICAgdmFyIGRpc2NyaW0gPSBjMypjMy80IC0gYzIgKyB5O1xuXG4gICAgICAgIGlmICggTWF0aC5hYnMoZGlzY3JpbSkgPD0gUG9seW5vbWlhbC5UT0xFUkFOQ0UgKSBkaXNjcmltID0gMDtcblxuICAgICAgICBpZiAoIGRpc2NyaW0gPiAwICkge1xuICAgICAgICAgICAgdmFyIGUgICAgID0gTWF0aC5zcXJ0KGRpc2NyaW0pO1xuICAgICAgICAgICAgdmFyIHQxICAgID0gMypjMypjMy80IC0gZSplIC0gMipjMjtcbiAgICAgICAgICAgIHZhciB0MiAgICA9ICggNCpjMypjMiAtIDgqYzEgLSBjMypjMypjMyApIC8gKCA0KmUgKTtcbiAgICAgICAgICAgIHZhciBwbHVzICA9IHQxK3QyO1xuICAgICAgICAgICAgdmFyIG1pbnVzID0gdDEtdDI7XG5cbiAgICAgICAgICAgIGlmICggTWF0aC5hYnMocGx1cykgIDw9IFBvbHlub21pYWwuVE9MRVJBTkNFICkgcGx1cyAgPSAwO1xuICAgICAgICAgICAgaWYgKCBNYXRoLmFicyhtaW51cykgPD0gUG9seW5vbWlhbC5UT0xFUkFOQ0UgKSBtaW51cyA9IDA7XG5cbiAgICAgICAgICAgIGlmICggcGx1cyA+PSAwICkge1xuICAgICAgICAgICAgICAgIHZhciBmID0gTWF0aC5zcXJ0KHBsdXMpO1xuXG4gICAgICAgICAgICAgICAgcmVzdWx0cy5wdXNoKCAtYzMvNCArIChlK2YpLzIgKTtcbiAgICAgICAgICAgICAgICByZXN1bHRzLnB1c2goIC1jMy80ICsgKGUtZikvMiApO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKCBtaW51cyA+PSAwICkge1xuICAgICAgICAgICAgICAgIHZhciBmID0gTWF0aC5zcXJ0KG1pbnVzKTtcblxuICAgICAgICAgICAgICAgIHJlc3VsdHMucHVzaCggLWMzLzQgKyAoZi1lKS8yICk7XG4gICAgICAgICAgICAgICAgcmVzdWx0cy5wdXNoKCAtYzMvNCAtIChmK2UpLzIgKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIGlmICggZGlzY3JpbSA8IDAgKSB7XG4gICAgICAgICAgICAvLyBubyByb290c1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdmFyIHQyID0geSp5IC0gNCpjMDtcblxuICAgICAgICAgICAgaWYgKCB0MiA+PSAtUG9seW5vbWlhbC5UT0xFUkFOQ0UgKSB7XG4gICAgICAgICAgICAgICAgaWYgKCB0MiA8IDAgKSB0MiA9IDA7XG5cbiAgICAgICAgICAgICAgICB0MiA9IDIqTWF0aC5zcXJ0KHQyKTtcbiAgICAgICAgICAgICAgICB0MSA9IDMqYzMqYzMvNCAtIDIqYzI7XG4gICAgICAgICAgICAgICAgaWYgKCB0MSt0MiA+PSBQb2x5bm9taWFsLlRPTEVSQU5DRSApIHtcbiAgICAgICAgICAgICAgICAgICAgdmFyIGQgPSBNYXRoLnNxcnQodDErdDIpO1xuXG4gICAgICAgICAgICAgICAgICAgIHJlc3VsdHMucHVzaCggLWMzLzQgKyBkLzIgKTtcbiAgICAgICAgICAgICAgICAgICAgcmVzdWx0cy5wdXNoKCAtYzMvNCAtIGQvMiApO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBpZiAoIHQxLXQyID49IFBvbHlub21pYWwuVE9MRVJBTkNFICkge1xuICAgICAgICAgICAgICAgICAgICB2YXIgZCA9IE1hdGguc3FydCh0MS10Mik7XG5cbiAgICAgICAgICAgICAgICAgICAgcmVzdWx0cy5wdXNoKCAtYzMvNCArIGQvMiApO1xuICAgICAgICAgICAgICAgICAgICByZXN1bHRzLnB1c2goIC1jMy80IC0gZC8yICk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHJlc3VsdHM7XG59O1xuXG5pZiAodHlwZW9mIG1vZHVsZSAhPT0gXCJ1bmRlZmluZWRcIikge1xuICAgIG1vZHVsZS5leHBvcnRzID0gUG9seW5vbWlhbDtcbn1cbiIsIi8qKlxuICpcbiAqICAgU3FydFBvbHlub21pYWwuanNcbiAqXG4gKiAgIGNvcHlyaWdodCAyMDAzLCAyMDEzIEtldmluIExpbmRzZXlcbiAqXG4gKi9cblxuaWYgKHR5cGVvZiBtb2R1bGUgIT09IFwidW5kZWZpbmVkXCIpIHtcbiAgICB2YXIgUG9seW5vbWlhbCA9IHJlcXVpcmUoXCIuL1BvbHlub21pYWxcIik7XG59XG5cbi8qKlxuICogICBjbGFzcyB2YXJpYWJsZXNcbiAqL1xuU3FydFBvbHlub21pYWwuVkVSU0lPTiA9IDEuMDtcblxuLy8gc2V0dXAgaW5oZXJpdGFuY2VcblNxcnRQb2x5bm9taWFsLnByb3RvdHlwZSAgICAgICAgICAgICA9IG5ldyBQb2x5bm9taWFsKCk7XG5TcXJ0UG9seW5vbWlhbC5wcm90b3R5cGUuY29uc3RydWN0b3IgPSBTcXJ0UG9seW5vbWlhbDtcblNxcnRQb2x5bm9taWFsLnN1cGVyY2xhc3MgICAgICAgICAgICA9IFBvbHlub21pYWwucHJvdG90eXBlO1xuXG5cbi8qKlxuICogIFNxcnRQb2x5bm9taWFsXG4gKi9cbmZ1bmN0aW9uIFNxcnRQb2x5bm9taWFsKCkge1xuICAgIHRoaXMuaW5pdCggYXJndW1lbnRzICk7XG59XG5cblxuLyoqXG4gKiAgZXZhbFxuICpcbiAqICBAcGFyYW0ge051bWJlcn0geFxuICogIEByZXR1cm5zIHtOdW1iZXJ9XG4gKi9cblNxcnRQb2x5bm9taWFsLnByb3RvdHlwZS5ldmFsID0gZnVuY3Rpb24oeCkge1xuICAgIHZhciBUT0xFUkFOQ0UgPSAxZS03O1xuICAgIHZhciByZXN1bHQgPSBTcXJ0UG9seW5vbWlhbC5zdXBlcmNsYXNzLmV2YWwuY2FsbCh0aGlzLCB4KTtcblxuICAgIC8vIE5PVEU6IE1heSBuZWVkIHRvIGNoYW5nZSB0aGUgZm9sbG93aW5nLiAgSSBhZGRlZCB0aGVzZSB0byBjYXB0dXJlXG4gICAgLy8gc29tZSByZWFsbHkgc21hbGwgbmVnYXRpdmUgdmFsdWVzIHRoYXQgd2VyZSBiZWluZyBnZW5lcmF0ZWQgYnkgb25lXG4gICAgLy8gb2YgbXkgQmV6aWVyIGFyY0xlbmd0aCBmdW5jdGlvbnNcbiAgICBpZiAoIE1hdGguYWJzKHJlc3VsdCkgPCBUT0xFUkFOQ0UgKSByZXN1bHQgPSAwO1xuICAgIGlmICggcmVzdWx0IDwgMCApXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcIlNxcnRQb2x5bm9taWFsLmV2YWw6IGNhbm5vdCB0YWtlIHNxdWFyZSByb290IG9mIG5lZ2F0aXZlIG51bWJlclwiKTtcblxuICAgIHJldHVybiBNYXRoLnNxcnQocmVzdWx0KTtcbn07XG5cblNxcnRQb2x5bm9taWFsLnByb3RvdHlwZS50b1N0cmluZyA9IGZ1bmN0aW9uKCkge1xuICAgIHZhciByZXN1bHQgPSBTcXJ0UG9seW5vbWlhbC5zdXBlcmNsYXNzLnRvU3RyaW5nLmNhbGwodGhpcyk7XG5cbiAgICByZXR1cm4gXCJzcXJ0KFwiICsgcmVzdWx0ICsgXCIpXCI7XG59O1xuXG5pZiAodHlwZW9mIG1vZHVsZSAhPT0gXCJ1bmRlZmluZWRcIikge1xuICAgIG1vZHVsZS5leHBvcnRzID0gU3FydFBvbHlub21pYWw7XG59XG4iLCIvKlxuIChjKSAyMDEzLCBWbGFkaW1pciBBZ2Fmb25raW5cbiBSQnVzaCwgYSBKYXZhU2NyaXB0IGxpYnJhcnkgZm9yIGhpZ2gtcGVyZm9ybWFuY2UgMkQgc3BhdGlhbCBpbmRleGluZyBvZiBwb2ludHMgYW5kIHJlY3RhbmdsZXMuXG4gaHR0cHM6Ly9naXRodWIuY29tL21vdXJuZXIvcmJ1c2hcbiovXG5cbihmdW5jdGlvbiAoKSB7ICd1c2Ugc3RyaWN0JztcblxuZnVuY3Rpb24gcmJ1c2gobWF4RW50cmllcywgZm9ybWF0KSB7XG5cbiAgICAvLyBqc2hpbnQgbmV3Y2FwOiBmYWxzZSwgdmFsaWR0aGlzOiB0cnVlXG4gICAgaWYgKCEodGhpcyBpbnN0YW5jZW9mIHJidXNoKSkgcmV0dXJuIG5ldyByYnVzaChtYXhFbnRyaWVzLCBmb3JtYXQpO1xuXG4gICAgLy8gbWF4IGVudHJpZXMgaW4gYSBub2RlIGlzIDkgYnkgZGVmYXVsdDsgbWluIG5vZGUgZmlsbCBpcyA0MCUgZm9yIGJlc3QgcGVyZm9ybWFuY2VcbiAgICB0aGlzLl9tYXhFbnRyaWVzID0gTWF0aC5tYXgoNCwgbWF4RW50cmllcyB8fCA5KTtcbiAgICB0aGlzLl9taW5FbnRyaWVzID0gTWF0aC5tYXgoMiwgTWF0aC5jZWlsKHRoaXMuX21heEVudHJpZXMgKiAwLjQpKTtcblxuICAgIGlmIChmb3JtYXQpIHtcbiAgICAgICAgdGhpcy5faW5pdEZvcm1hdChmb3JtYXQpO1xuICAgIH1cblxuICAgIHRoaXMuY2xlYXIoKTtcbn1cblxucmJ1c2gucHJvdG90eXBlID0ge1xuXG4gICAgYWxsOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHJldHVybiB0aGlzLl9hbGwodGhpcy5kYXRhLCBbXSk7XG4gICAgfSxcblxuICAgIHNlYXJjaDogZnVuY3Rpb24gKGJib3gpIHtcblxuICAgICAgICB2YXIgbm9kZSA9IHRoaXMuZGF0YSxcbiAgICAgICAgICAgIHJlc3VsdCA9IFtdLFxuICAgICAgICAgICAgdG9CQm94ID0gdGhpcy50b0JCb3g7XG5cbiAgICAgICAgaWYgKCFpbnRlcnNlY3RzKGJib3gsIG5vZGUuYmJveCkpIHJldHVybiByZXN1bHQ7XG5cbiAgICAgICAgdmFyIG5vZGVzVG9TZWFyY2ggPSBbXSxcbiAgICAgICAgICAgIGksIGxlbiwgY2hpbGQsIGNoaWxkQkJveDtcblxuICAgICAgICB3aGlsZSAobm9kZSkge1xuICAgICAgICAgICAgZm9yIChpID0gMCwgbGVuID0gbm9kZS5jaGlsZHJlbi5sZW5ndGg7IGkgPCBsZW47IGkrKykge1xuXG4gICAgICAgICAgICAgICAgY2hpbGQgPSBub2RlLmNoaWxkcmVuW2ldO1xuICAgICAgICAgICAgICAgIGNoaWxkQkJveCA9IG5vZGUubGVhZiA/IHRvQkJveChjaGlsZCkgOiBjaGlsZC5iYm94O1xuXG4gICAgICAgICAgICAgICAgaWYgKGludGVyc2VjdHMoYmJveCwgY2hpbGRCQm94KSkge1xuICAgICAgICAgICAgICAgICAgICBpZiAobm9kZS5sZWFmKSByZXN1bHQucHVzaChjaGlsZCk7XG4gICAgICAgICAgICAgICAgICAgIGVsc2UgaWYgKGNvbnRhaW5zKGJib3gsIGNoaWxkQkJveCkpIHRoaXMuX2FsbChjaGlsZCwgcmVzdWx0KTtcbiAgICAgICAgICAgICAgICAgICAgZWxzZSBub2Rlc1RvU2VhcmNoLnB1c2goY2hpbGQpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIG5vZGUgPSBub2Rlc1RvU2VhcmNoLnBvcCgpO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICB9LFxuXG4gICAgY29sbGlkZXM6IGZ1bmN0aW9uIChiYm94KSB7XG5cbiAgICAgICAgdmFyIG5vZGUgPSB0aGlzLmRhdGEsXG4gICAgICAgICAgICB0b0JCb3ggPSB0aGlzLnRvQkJveDtcblxuICAgICAgICBpZiAoIWludGVyc2VjdHMoYmJveCwgbm9kZS5iYm94KSkgcmV0dXJuIGZhbHNlO1xuXG4gICAgICAgIHZhciBub2Rlc1RvU2VhcmNoID0gW10sXG4gICAgICAgICAgICBpLCBsZW4sIGNoaWxkLCBjaGlsZEJCb3g7XG5cbiAgICAgICAgd2hpbGUgKG5vZGUpIHtcbiAgICAgICAgICAgIGZvciAoaSA9IDAsIGxlbiA9IG5vZGUuY2hpbGRyZW4ubGVuZ3RoOyBpIDwgbGVuOyBpKyspIHtcblxuICAgICAgICAgICAgICAgIGNoaWxkID0gbm9kZS5jaGlsZHJlbltpXTtcbiAgICAgICAgICAgICAgICBjaGlsZEJCb3ggPSBub2RlLmxlYWYgPyB0b0JCb3goY2hpbGQpIDogY2hpbGQuYmJveDtcblxuICAgICAgICAgICAgICAgIGlmIChpbnRlcnNlY3RzKGJib3gsIGNoaWxkQkJveCkpIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKG5vZGUubGVhZiB8fCBjb250YWlucyhiYm94LCBjaGlsZEJCb3gpKSByZXR1cm4gdHJ1ZTtcbiAgICAgICAgICAgICAgICAgICAgbm9kZXNUb1NlYXJjaC5wdXNoKGNoaWxkKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBub2RlID0gbm9kZXNUb1NlYXJjaC5wb3AoKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9LFxuXG4gICAgbG9hZDogZnVuY3Rpb24gKGRhdGEpIHtcbiAgICAgICAgaWYgKCEoZGF0YSAmJiBkYXRhLmxlbmd0aCkpIHJldHVybiB0aGlzO1xuXG4gICAgICAgIGlmIChkYXRhLmxlbmd0aCA8IHRoaXMuX21pbkVudHJpZXMpIHtcbiAgICAgICAgICAgIGZvciAodmFyIGkgPSAwLCBsZW4gPSBkYXRhLmxlbmd0aDsgaSA8IGxlbjsgaSsrKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5pbnNlcnQoZGF0YVtpXSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gdGhpcztcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIHJlY3Vyc2l2ZWx5IGJ1aWxkIHRoZSB0cmVlIHdpdGggdGhlIGdpdmVuIGRhdGEgZnJvbSBzdHJhdGNoIHVzaW5nIE9NVCBhbGdvcml0aG1cbiAgICAgICAgdmFyIG5vZGUgPSB0aGlzLl9idWlsZChkYXRhLnNsaWNlKCksIDAsIGRhdGEubGVuZ3RoIC0gMSwgMCk7XG5cbiAgICAgICAgaWYgKCF0aGlzLmRhdGEuY2hpbGRyZW4ubGVuZ3RoKSB7XG4gICAgICAgICAgICAvLyBzYXZlIGFzIGlzIGlmIHRyZWUgaXMgZW1wdHlcbiAgICAgICAgICAgIHRoaXMuZGF0YSA9IG5vZGU7XG5cbiAgICAgICAgfSBlbHNlIGlmICh0aGlzLmRhdGEuaGVpZ2h0ID09PSBub2RlLmhlaWdodCkge1xuICAgICAgICAgICAgLy8gc3BsaXQgcm9vdCBpZiB0cmVlcyBoYXZlIHRoZSBzYW1lIGhlaWdodFxuICAgICAgICAgICAgdGhpcy5fc3BsaXRSb290KHRoaXMuZGF0YSwgbm9kZSk7XG5cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGlmICh0aGlzLmRhdGEuaGVpZ2h0IDwgbm9kZS5oZWlnaHQpIHtcbiAgICAgICAgICAgICAgICAvLyBzd2FwIHRyZWVzIGlmIGluc2VydGVkIG9uZSBpcyBiaWdnZXJcbiAgICAgICAgICAgICAgICB2YXIgdG1wTm9kZSA9IHRoaXMuZGF0YTtcbiAgICAgICAgICAgICAgICB0aGlzLmRhdGEgPSBub2RlO1xuICAgICAgICAgICAgICAgIG5vZGUgPSB0bXBOb2RlO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBpbnNlcnQgdGhlIHNtYWxsIHRyZWUgaW50byB0aGUgbGFyZ2UgdHJlZSBhdCBhcHByb3ByaWF0ZSBsZXZlbFxuICAgICAgICAgICAgdGhpcy5faW5zZXJ0KG5vZGUsIHRoaXMuZGF0YS5oZWlnaHQgLSBub2RlLmhlaWdodCAtIDEsIHRydWUpO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfSxcblxuICAgIGluc2VydDogZnVuY3Rpb24gKGl0ZW0pIHtcbiAgICAgICAgaWYgKGl0ZW0pIHRoaXMuX2luc2VydChpdGVtLCB0aGlzLmRhdGEuaGVpZ2h0IC0gMSk7XG4gICAgICAgIHJldHVybiB0aGlzO1xuICAgIH0sXG5cbiAgICBjbGVhcjogZnVuY3Rpb24gKCkge1xuICAgICAgICB0aGlzLmRhdGEgPSB7XG4gICAgICAgICAgICBjaGlsZHJlbjogW10sXG4gICAgICAgICAgICBoZWlnaHQ6IDEsXG4gICAgICAgICAgICBiYm94OiBlbXB0eSgpLFxuICAgICAgICAgICAgbGVhZjogdHJ1ZVxuICAgICAgICB9O1xuICAgICAgICByZXR1cm4gdGhpcztcbiAgICB9LFxuXG4gICAgcmVtb3ZlOiBmdW5jdGlvbiAoaXRlbSkge1xuICAgICAgICBpZiAoIWl0ZW0pIHJldHVybiB0aGlzO1xuXG4gICAgICAgIHZhciBub2RlID0gdGhpcy5kYXRhLFxuICAgICAgICAgICAgYmJveCA9IHRoaXMudG9CQm94KGl0ZW0pLFxuICAgICAgICAgICAgcGF0aCA9IFtdLFxuICAgICAgICAgICAgaW5kZXhlcyA9IFtdLFxuICAgICAgICAgICAgaSwgcGFyZW50LCBpbmRleCwgZ29pbmdVcDtcblxuICAgICAgICAvLyBkZXB0aC1maXJzdCBpdGVyYXRpdmUgdHJlZSB0cmF2ZXJzYWxcbiAgICAgICAgd2hpbGUgKG5vZGUgfHwgcGF0aC5sZW5ndGgpIHtcblxuICAgICAgICAgICAgaWYgKCFub2RlKSB7IC8vIGdvIHVwXG4gICAgICAgICAgICAgICAgbm9kZSA9IHBhdGgucG9wKCk7XG4gICAgICAgICAgICAgICAgcGFyZW50ID0gcGF0aFtwYXRoLmxlbmd0aCAtIDFdO1xuICAgICAgICAgICAgICAgIGkgPSBpbmRleGVzLnBvcCgpO1xuICAgICAgICAgICAgICAgIGdvaW5nVXAgPSB0cnVlO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAobm9kZS5sZWFmKSB7IC8vIGNoZWNrIGN1cnJlbnQgbm9kZVxuICAgICAgICAgICAgICAgIGluZGV4ID0gbm9kZS5jaGlsZHJlbi5pbmRleE9mKGl0ZW0pO1xuXG4gICAgICAgICAgICAgICAgaWYgKGluZGV4ICE9PSAtMSkge1xuICAgICAgICAgICAgICAgICAgICAvLyBpdGVtIGZvdW5kLCByZW1vdmUgdGhlIGl0ZW0gYW5kIGNvbmRlbnNlIHRyZWUgdXB3YXJkc1xuICAgICAgICAgICAgICAgICAgICBub2RlLmNoaWxkcmVuLnNwbGljZShpbmRleCwgMSk7XG4gICAgICAgICAgICAgICAgICAgIHBhdGgucHVzaChub2RlKTtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5fY29uZGVuc2UocGF0aCk7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB0aGlzO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKCFnb2luZ1VwICYmICFub2RlLmxlYWYgJiYgY29udGFpbnMobm9kZS5iYm94LCBiYm94KSkgeyAvLyBnbyBkb3duXG4gICAgICAgICAgICAgICAgcGF0aC5wdXNoKG5vZGUpO1xuICAgICAgICAgICAgICAgIGluZGV4ZXMucHVzaChpKTtcbiAgICAgICAgICAgICAgICBpID0gMDtcbiAgICAgICAgICAgICAgICBwYXJlbnQgPSBub2RlO1xuICAgICAgICAgICAgICAgIG5vZGUgPSBub2RlLmNoaWxkcmVuWzBdO1xuXG4gICAgICAgICAgICB9IGVsc2UgaWYgKHBhcmVudCkgeyAvLyBnbyByaWdodFxuICAgICAgICAgICAgICAgIGkrKztcbiAgICAgICAgICAgICAgICBub2RlID0gcGFyZW50LmNoaWxkcmVuW2ldO1xuICAgICAgICAgICAgICAgIGdvaW5nVXAgPSBmYWxzZTtcblxuICAgICAgICAgICAgfSBlbHNlIG5vZGUgPSBudWxsOyAvLyBub3RoaW5nIGZvdW5kXG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gdGhpcztcbiAgICB9LFxuXG4gICAgdG9CQm94OiBmdW5jdGlvbiAoaXRlbSkgeyByZXR1cm4gaXRlbTsgfSxcblxuICAgIGNvbXBhcmVNaW5YOiBmdW5jdGlvbiAoYSwgYikgeyByZXR1cm4gYVswXSAtIGJbMF07IH0sXG4gICAgY29tcGFyZU1pblk6IGZ1bmN0aW9uIChhLCBiKSB7IHJldHVybiBhWzFdIC0gYlsxXTsgfSxcblxuICAgIHRvSlNPTjogZnVuY3Rpb24gKCkgeyByZXR1cm4gdGhpcy5kYXRhOyB9LFxuXG4gICAgZnJvbUpTT046IGZ1bmN0aW9uIChkYXRhKSB7XG4gICAgICAgIHRoaXMuZGF0YSA9IGRhdGE7XG4gICAgICAgIHJldHVybiB0aGlzO1xuICAgIH0sXG5cbiAgICBfYWxsOiBmdW5jdGlvbiAobm9kZSwgcmVzdWx0KSB7XG4gICAgICAgIHZhciBub2Rlc1RvU2VhcmNoID0gW107XG4gICAgICAgIHdoaWxlIChub2RlKSB7XG4gICAgICAgICAgICBpZiAobm9kZS5sZWFmKSByZXN1bHQucHVzaC5hcHBseShyZXN1bHQsIG5vZGUuY2hpbGRyZW4pO1xuICAgICAgICAgICAgZWxzZSBub2Rlc1RvU2VhcmNoLnB1c2guYXBwbHkobm9kZXNUb1NlYXJjaCwgbm9kZS5jaGlsZHJlbik7XG5cbiAgICAgICAgICAgIG5vZGUgPSBub2Rlc1RvU2VhcmNoLnBvcCgpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgfSxcblxuICAgIF9idWlsZDogZnVuY3Rpb24gKGl0ZW1zLCBsZWZ0LCByaWdodCwgaGVpZ2h0KSB7XG5cbiAgICAgICAgdmFyIE4gPSByaWdodCAtIGxlZnQgKyAxLFxuICAgICAgICAgICAgTSA9IHRoaXMuX21heEVudHJpZXMsXG4gICAgICAgICAgICBub2RlO1xuXG4gICAgICAgIGlmIChOIDw9IE0pIHtcbiAgICAgICAgICAgIC8vIHJlYWNoZWQgbGVhZiBsZXZlbDsgcmV0dXJuIGxlYWZcbiAgICAgICAgICAgIG5vZGUgPSB7XG4gICAgICAgICAgICAgICAgY2hpbGRyZW46IGl0ZW1zLnNsaWNlKGxlZnQsIHJpZ2h0ICsgMSksXG4gICAgICAgICAgICAgICAgaGVpZ2h0OiAxLFxuICAgICAgICAgICAgICAgIGJib3g6IG51bGwsXG4gICAgICAgICAgICAgICAgbGVhZjogdHJ1ZVxuICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIGNhbGNCQm94KG5vZGUsIHRoaXMudG9CQm94KTtcbiAgICAgICAgICAgIHJldHVybiBub2RlO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKCFoZWlnaHQpIHtcbiAgICAgICAgICAgIC8vIHRhcmdldCBoZWlnaHQgb2YgdGhlIGJ1bGstbG9hZGVkIHRyZWVcbiAgICAgICAgICAgIGhlaWdodCA9IE1hdGguY2VpbChNYXRoLmxvZyhOKSAvIE1hdGgubG9nKE0pKTtcblxuICAgICAgICAgICAgLy8gdGFyZ2V0IG51bWJlciBvZiByb290IGVudHJpZXMgdG8gbWF4aW1pemUgc3RvcmFnZSB1dGlsaXphdGlvblxuICAgICAgICAgICAgTSA9IE1hdGguY2VpbChOIC8gTWF0aC5wb3coTSwgaGVpZ2h0IC0gMSkpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gVE9ETyBlbGltaW5hdGUgcmVjdXJzaW9uP1xuXG4gICAgICAgIG5vZGUgPSB7XG4gICAgICAgICAgICBjaGlsZHJlbjogW10sXG4gICAgICAgICAgICBoZWlnaHQ6IGhlaWdodCxcbiAgICAgICAgICAgIGJib3g6IG51bGxcbiAgICAgICAgfTtcblxuICAgICAgICAvLyBzcGxpdCB0aGUgaXRlbXMgaW50byBNIG1vc3RseSBzcXVhcmUgdGlsZXNcblxuICAgICAgICB2YXIgTjIgPSBNYXRoLmNlaWwoTiAvIE0pLFxuICAgICAgICAgICAgTjEgPSBOMiAqIE1hdGguY2VpbChNYXRoLnNxcnQoTSkpLFxuICAgICAgICAgICAgaSwgaiwgcmlnaHQyLCByaWdodDM7XG5cbiAgICAgICAgbXVsdGlTZWxlY3QoaXRlbXMsIGxlZnQsIHJpZ2h0LCBOMSwgdGhpcy5jb21wYXJlTWluWCk7XG5cbiAgICAgICAgZm9yIChpID0gbGVmdDsgaSA8PSByaWdodDsgaSArPSBOMSkge1xuXG4gICAgICAgICAgICByaWdodDIgPSBNYXRoLm1pbihpICsgTjEgLSAxLCByaWdodCk7XG5cbiAgICAgICAgICAgIG11bHRpU2VsZWN0KGl0ZW1zLCBpLCByaWdodDIsIE4yLCB0aGlzLmNvbXBhcmVNaW5ZKTtcblxuICAgICAgICAgICAgZm9yIChqID0gaTsgaiA8PSByaWdodDI7IGogKz0gTjIpIHtcblxuICAgICAgICAgICAgICAgIHJpZ2h0MyA9IE1hdGgubWluKGogKyBOMiAtIDEsIHJpZ2h0Mik7XG5cbiAgICAgICAgICAgICAgICAvLyBwYWNrIGVhY2ggZW50cnkgcmVjdXJzaXZlbHlcbiAgICAgICAgICAgICAgICBub2RlLmNoaWxkcmVuLnB1c2godGhpcy5fYnVpbGQoaXRlbXMsIGosIHJpZ2h0MywgaGVpZ2h0IC0gMSkpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgY2FsY0JCb3gobm9kZSwgdGhpcy50b0JCb3gpO1xuXG4gICAgICAgIHJldHVybiBub2RlO1xuICAgIH0sXG5cbiAgICBfY2hvb3NlU3VidHJlZTogZnVuY3Rpb24gKGJib3gsIG5vZGUsIGxldmVsLCBwYXRoKSB7XG5cbiAgICAgICAgdmFyIGksIGxlbiwgY2hpbGQsIHRhcmdldE5vZGUsIGFyZWEsIGVubGFyZ2VtZW50LCBtaW5BcmVhLCBtaW5FbmxhcmdlbWVudDtcblxuICAgICAgICB3aGlsZSAodHJ1ZSkge1xuICAgICAgICAgICAgcGF0aC5wdXNoKG5vZGUpO1xuXG4gICAgICAgICAgICBpZiAobm9kZS5sZWFmIHx8IHBhdGgubGVuZ3RoIC0gMSA9PT0gbGV2ZWwpIGJyZWFrO1xuXG4gICAgICAgICAgICBtaW5BcmVhID0gbWluRW5sYXJnZW1lbnQgPSBJbmZpbml0eTtcblxuICAgICAgICAgICAgZm9yIChpID0gMCwgbGVuID0gbm9kZS5jaGlsZHJlbi5sZW5ndGg7IGkgPCBsZW47IGkrKykge1xuICAgICAgICAgICAgICAgIGNoaWxkID0gbm9kZS5jaGlsZHJlbltpXTtcbiAgICAgICAgICAgICAgICBhcmVhID0gYmJveEFyZWEoY2hpbGQuYmJveCk7XG4gICAgICAgICAgICAgICAgZW5sYXJnZW1lbnQgPSBlbmxhcmdlZEFyZWEoYmJveCwgY2hpbGQuYmJveCkgLSBhcmVhO1xuXG4gICAgICAgICAgICAgICAgLy8gY2hvb3NlIGVudHJ5IHdpdGggdGhlIGxlYXN0IGFyZWEgZW5sYXJnZW1lbnRcbiAgICAgICAgICAgICAgICBpZiAoZW5sYXJnZW1lbnQgPCBtaW5FbmxhcmdlbWVudCkge1xuICAgICAgICAgICAgICAgICAgICBtaW5FbmxhcmdlbWVudCA9IGVubGFyZ2VtZW50O1xuICAgICAgICAgICAgICAgICAgICBtaW5BcmVhID0gYXJlYSA8IG1pbkFyZWEgPyBhcmVhIDogbWluQXJlYTtcbiAgICAgICAgICAgICAgICAgICAgdGFyZ2V0Tm9kZSA9IGNoaWxkO1xuXG4gICAgICAgICAgICAgICAgfSBlbHNlIGlmIChlbmxhcmdlbWVudCA9PT0gbWluRW5sYXJnZW1lbnQpIHtcbiAgICAgICAgICAgICAgICAgICAgLy8gb3RoZXJ3aXNlIGNob29zZSBvbmUgd2l0aCB0aGUgc21hbGxlc3QgYXJlYVxuICAgICAgICAgICAgICAgICAgICBpZiAoYXJlYSA8IG1pbkFyZWEpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIG1pbkFyZWEgPSBhcmVhO1xuICAgICAgICAgICAgICAgICAgICAgICAgdGFyZ2V0Tm9kZSA9IGNoaWxkO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBub2RlID0gdGFyZ2V0Tm9kZTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBub2RlO1xuICAgIH0sXG5cbiAgICBfaW5zZXJ0OiBmdW5jdGlvbiAoaXRlbSwgbGV2ZWwsIGlzTm9kZSkge1xuXG4gICAgICAgIHZhciB0b0JCb3ggPSB0aGlzLnRvQkJveCxcbiAgICAgICAgICAgIGJib3ggPSBpc05vZGUgPyBpdGVtLmJib3ggOiB0b0JCb3goaXRlbSksXG4gICAgICAgICAgICBpbnNlcnRQYXRoID0gW107XG5cbiAgICAgICAgLy8gZmluZCB0aGUgYmVzdCBub2RlIGZvciBhY2NvbW1vZGF0aW5nIHRoZSBpdGVtLCBzYXZpbmcgYWxsIG5vZGVzIGFsb25nIHRoZSBwYXRoIHRvb1xuICAgICAgICB2YXIgbm9kZSA9IHRoaXMuX2Nob29zZVN1YnRyZWUoYmJveCwgdGhpcy5kYXRhLCBsZXZlbCwgaW5zZXJ0UGF0aCk7XG5cbiAgICAgICAgLy8gcHV0IHRoZSBpdGVtIGludG8gdGhlIG5vZGVcbiAgICAgICAgbm9kZS5jaGlsZHJlbi5wdXNoKGl0ZW0pO1xuICAgICAgICBleHRlbmQobm9kZS5iYm94LCBiYm94KTtcblxuICAgICAgICAvLyBzcGxpdCBvbiBub2RlIG92ZXJmbG93OyBwcm9wYWdhdGUgdXB3YXJkcyBpZiBuZWNlc3NhcnlcbiAgICAgICAgd2hpbGUgKGxldmVsID49IDApIHtcbiAgICAgICAgICAgIGlmIChpbnNlcnRQYXRoW2xldmVsXS5jaGlsZHJlbi5sZW5ndGggPiB0aGlzLl9tYXhFbnRyaWVzKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5fc3BsaXQoaW5zZXJ0UGF0aCwgbGV2ZWwpO1xuICAgICAgICAgICAgICAgIGxldmVsLS07XG4gICAgICAgICAgICB9IGVsc2UgYnJlYWs7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBhZGp1c3QgYmJveGVzIGFsb25nIHRoZSBpbnNlcnRpb24gcGF0aFxuICAgICAgICB0aGlzLl9hZGp1c3RQYXJlbnRCQm94ZXMoYmJveCwgaW5zZXJ0UGF0aCwgbGV2ZWwpO1xuICAgIH0sXG5cbiAgICAvLyBzcGxpdCBvdmVyZmxvd2VkIG5vZGUgaW50byB0d29cbiAgICBfc3BsaXQ6IGZ1bmN0aW9uIChpbnNlcnRQYXRoLCBsZXZlbCkge1xuXG4gICAgICAgIHZhciBub2RlID0gaW5zZXJ0UGF0aFtsZXZlbF0sXG4gICAgICAgICAgICBNID0gbm9kZS5jaGlsZHJlbi5sZW5ndGgsXG4gICAgICAgICAgICBtID0gdGhpcy5fbWluRW50cmllcztcblxuICAgICAgICB0aGlzLl9jaG9vc2VTcGxpdEF4aXMobm9kZSwgbSwgTSk7XG5cbiAgICAgICAgdmFyIG5ld05vZGUgPSB7XG4gICAgICAgICAgICBjaGlsZHJlbjogbm9kZS5jaGlsZHJlbi5zcGxpY2UodGhpcy5fY2hvb3NlU3BsaXRJbmRleChub2RlLCBtLCBNKSksXG4gICAgICAgICAgICBoZWlnaHQ6IG5vZGUuaGVpZ2h0XG4gICAgICAgIH07XG5cbiAgICAgICAgaWYgKG5vZGUubGVhZikgbmV3Tm9kZS5sZWFmID0gdHJ1ZTtcblxuICAgICAgICBjYWxjQkJveChub2RlLCB0aGlzLnRvQkJveCk7XG4gICAgICAgIGNhbGNCQm94KG5ld05vZGUsIHRoaXMudG9CQm94KTtcblxuICAgICAgICBpZiAobGV2ZWwpIGluc2VydFBhdGhbbGV2ZWwgLSAxXS5jaGlsZHJlbi5wdXNoKG5ld05vZGUpO1xuICAgICAgICBlbHNlIHRoaXMuX3NwbGl0Um9vdChub2RlLCBuZXdOb2RlKTtcbiAgICB9LFxuXG4gICAgX3NwbGl0Um9vdDogZnVuY3Rpb24gKG5vZGUsIG5ld05vZGUpIHtcbiAgICAgICAgLy8gc3BsaXQgcm9vdCBub2RlXG4gICAgICAgIHRoaXMuZGF0YSA9IHtcbiAgICAgICAgICAgIGNoaWxkcmVuOiBbbm9kZSwgbmV3Tm9kZV0sXG4gICAgICAgICAgICBoZWlnaHQ6IG5vZGUuaGVpZ2h0ICsgMVxuICAgICAgICB9O1xuICAgICAgICBjYWxjQkJveCh0aGlzLmRhdGEsIHRoaXMudG9CQm94KTtcbiAgICB9LFxuXG4gICAgX2Nob29zZVNwbGl0SW5kZXg6IGZ1bmN0aW9uIChub2RlLCBtLCBNKSB7XG5cbiAgICAgICAgdmFyIGksIGJib3gxLCBiYm94Miwgb3ZlcmxhcCwgYXJlYSwgbWluT3ZlcmxhcCwgbWluQXJlYSwgaW5kZXg7XG5cbiAgICAgICAgbWluT3ZlcmxhcCA9IG1pbkFyZWEgPSBJbmZpbml0eTtcblxuICAgICAgICBmb3IgKGkgPSBtOyBpIDw9IE0gLSBtOyBpKyspIHtcbiAgICAgICAgICAgIGJib3gxID0gZGlzdEJCb3gobm9kZSwgMCwgaSwgdGhpcy50b0JCb3gpO1xuICAgICAgICAgICAgYmJveDIgPSBkaXN0QkJveChub2RlLCBpLCBNLCB0aGlzLnRvQkJveCk7XG5cbiAgICAgICAgICAgIG92ZXJsYXAgPSBpbnRlcnNlY3Rpb25BcmVhKGJib3gxLCBiYm94Mik7XG4gICAgICAgICAgICBhcmVhID0gYmJveEFyZWEoYmJveDEpICsgYmJveEFyZWEoYmJveDIpO1xuXG4gICAgICAgICAgICAvLyBjaG9vc2UgZGlzdHJpYnV0aW9uIHdpdGggbWluaW11bSBvdmVybGFwXG4gICAgICAgICAgICBpZiAob3ZlcmxhcCA8IG1pbk92ZXJsYXApIHtcbiAgICAgICAgICAgICAgICBtaW5PdmVybGFwID0gb3ZlcmxhcDtcbiAgICAgICAgICAgICAgICBpbmRleCA9IGk7XG5cbiAgICAgICAgICAgICAgICBtaW5BcmVhID0gYXJlYSA8IG1pbkFyZWEgPyBhcmVhIDogbWluQXJlYTtcblxuICAgICAgICAgICAgfSBlbHNlIGlmIChvdmVybGFwID09PSBtaW5PdmVybGFwKSB7XG4gICAgICAgICAgICAgICAgLy8gb3RoZXJ3aXNlIGNob29zZSBkaXN0cmlidXRpb24gd2l0aCBtaW5pbXVtIGFyZWFcbiAgICAgICAgICAgICAgICBpZiAoYXJlYSA8IG1pbkFyZWEpIHtcbiAgICAgICAgICAgICAgICAgICAgbWluQXJlYSA9IGFyZWE7XG4gICAgICAgICAgICAgICAgICAgIGluZGV4ID0gaTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gaW5kZXg7XG4gICAgfSxcblxuICAgIC8vIHNvcnRzIG5vZGUgY2hpbGRyZW4gYnkgdGhlIGJlc3QgYXhpcyBmb3Igc3BsaXRcbiAgICBfY2hvb3NlU3BsaXRBeGlzOiBmdW5jdGlvbiAobm9kZSwgbSwgTSkge1xuXG4gICAgICAgIHZhciBjb21wYXJlTWluWCA9IG5vZGUubGVhZiA/IHRoaXMuY29tcGFyZU1pblggOiBjb21wYXJlTm9kZU1pblgsXG4gICAgICAgICAgICBjb21wYXJlTWluWSA9IG5vZGUubGVhZiA/IHRoaXMuY29tcGFyZU1pblkgOiBjb21wYXJlTm9kZU1pblksXG4gICAgICAgICAgICB4TWFyZ2luID0gdGhpcy5fYWxsRGlzdE1hcmdpbihub2RlLCBtLCBNLCBjb21wYXJlTWluWCksXG4gICAgICAgICAgICB5TWFyZ2luID0gdGhpcy5fYWxsRGlzdE1hcmdpbihub2RlLCBtLCBNLCBjb21wYXJlTWluWSk7XG5cbiAgICAgICAgLy8gaWYgdG90YWwgZGlzdHJpYnV0aW9ucyBtYXJnaW4gdmFsdWUgaXMgbWluaW1hbCBmb3IgeCwgc29ydCBieSBtaW5YLFxuICAgICAgICAvLyBvdGhlcndpc2UgaXQncyBhbHJlYWR5IHNvcnRlZCBieSBtaW5ZXG4gICAgICAgIGlmICh4TWFyZ2luIDwgeU1hcmdpbikgbm9kZS5jaGlsZHJlbi5zb3J0KGNvbXBhcmVNaW5YKTtcbiAgICB9LFxuXG4gICAgLy8gdG90YWwgbWFyZ2luIG9mIGFsbCBwb3NzaWJsZSBzcGxpdCBkaXN0cmlidXRpb25zIHdoZXJlIGVhY2ggbm9kZSBpcyBhdCBsZWFzdCBtIGZ1bGxcbiAgICBfYWxsRGlzdE1hcmdpbjogZnVuY3Rpb24gKG5vZGUsIG0sIE0sIGNvbXBhcmUpIHtcblxuICAgICAgICBub2RlLmNoaWxkcmVuLnNvcnQoY29tcGFyZSk7XG5cbiAgICAgICAgdmFyIHRvQkJveCA9IHRoaXMudG9CQm94LFxuICAgICAgICAgICAgbGVmdEJCb3ggPSBkaXN0QkJveChub2RlLCAwLCBtLCB0b0JCb3gpLFxuICAgICAgICAgICAgcmlnaHRCQm94ID0gZGlzdEJCb3gobm9kZSwgTSAtIG0sIE0sIHRvQkJveCksXG4gICAgICAgICAgICBtYXJnaW4gPSBiYm94TWFyZ2luKGxlZnRCQm94KSArIGJib3hNYXJnaW4ocmlnaHRCQm94KSxcbiAgICAgICAgICAgIGksIGNoaWxkO1xuXG4gICAgICAgIGZvciAoaSA9IG07IGkgPCBNIC0gbTsgaSsrKSB7XG4gICAgICAgICAgICBjaGlsZCA9IG5vZGUuY2hpbGRyZW5baV07XG4gICAgICAgICAgICBleHRlbmQobGVmdEJCb3gsIG5vZGUubGVhZiA/IHRvQkJveChjaGlsZCkgOiBjaGlsZC5iYm94KTtcbiAgICAgICAgICAgIG1hcmdpbiArPSBiYm94TWFyZ2luKGxlZnRCQm94KTtcbiAgICAgICAgfVxuXG4gICAgICAgIGZvciAoaSA9IE0gLSBtIC0gMTsgaSA+PSBtOyBpLS0pIHtcbiAgICAgICAgICAgIGNoaWxkID0gbm9kZS5jaGlsZHJlbltpXTtcbiAgICAgICAgICAgIGV4dGVuZChyaWdodEJCb3gsIG5vZGUubGVhZiA/IHRvQkJveChjaGlsZCkgOiBjaGlsZC5iYm94KTtcbiAgICAgICAgICAgIG1hcmdpbiArPSBiYm94TWFyZ2luKHJpZ2h0QkJveCk7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gbWFyZ2luO1xuICAgIH0sXG5cbiAgICBfYWRqdXN0UGFyZW50QkJveGVzOiBmdW5jdGlvbiAoYmJveCwgcGF0aCwgbGV2ZWwpIHtcbiAgICAgICAgLy8gYWRqdXN0IGJib3hlcyBhbG9uZyB0aGUgZ2l2ZW4gdHJlZSBwYXRoXG4gICAgICAgIGZvciAodmFyIGkgPSBsZXZlbDsgaSA+PSAwOyBpLS0pIHtcbiAgICAgICAgICAgIGV4dGVuZChwYXRoW2ldLmJib3gsIGJib3gpO1xuICAgICAgICB9XG4gICAgfSxcblxuICAgIF9jb25kZW5zZTogZnVuY3Rpb24gKHBhdGgpIHtcbiAgICAgICAgLy8gZ28gdGhyb3VnaCB0aGUgcGF0aCwgcmVtb3ZpbmcgZW1wdHkgbm9kZXMgYW5kIHVwZGF0aW5nIGJib3hlc1xuICAgICAgICBmb3IgKHZhciBpID0gcGF0aC5sZW5ndGggLSAxLCBzaWJsaW5nczsgaSA+PSAwOyBpLS0pIHtcbiAgICAgICAgICAgIGlmIChwYXRoW2ldLmNoaWxkcmVuLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgICAgICAgIGlmIChpID4gMCkge1xuICAgICAgICAgICAgICAgICAgICBzaWJsaW5ncyA9IHBhdGhbaSAtIDFdLmNoaWxkcmVuO1xuICAgICAgICAgICAgICAgICAgICBzaWJsaW5ncy5zcGxpY2Uoc2libGluZ3MuaW5kZXhPZihwYXRoW2ldKSwgMSk7XG5cbiAgICAgICAgICAgICAgICB9IGVsc2UgdGhpcy5jbGVhcigpO1xuXG4gICAgICAgICAgICB9IGVsc2UgY2FsY0JCb3gocGF0aFtpXSwgdGhpcy50b0JCb3gpO1xuICAgICAgICB9XG4gICAgfSxcblxuICAgIF9pbml0Rm9ybWF0OiBmdW5jdGlvbiAoZm9ybWF0KSB7XG4gICAgICAgIC8vIGRhdGEgZm9ybWF0IChtaW5YLCBtaW5ZLCBtYXhYLCBtYXhZIGFjY2Vzc29ycylcblxuICAgICAgICAvLyB1c2VzIGV2YWwtdHlwZSBmdW5jdGlvbiBjb21waWxhdGlvbiBpbnN0ZWFkIG9mIGp1c3QgYWNjZXB0aW5nIGEgdG9CQm94IGZ1bmN0aW9uXG4gICAgICAgIC8vIGJlY2F1c2UgdGhlIGFsZ29yaXRobXMgYXJlIHZlcnkgc2Vuc2l0aXZlIHRvIHNvcnRpbmcgZnVuY3Rpb25zIHBlcmZvcm1hbmNlLFxuICAgICAgICAvLyBzbyB0aGV5IHNob3VsZCBiZSBkZWFkIHNpbXBsZSBhbmQgd2l0aG91dCBpbm5lciBjYWxsc1xuXG4gICAgICAgIC8vIGpzaGludCBldmlsOiB0cnVlXG5cbiAgICAgICAgdmFyIGNvbXBhcmVBcnIgPSBbJ3JldHVybiBhJywgJyAtIGInLCAnOyddO1xuXG4gICAgICAgIHRoaXMuY29tcGFyZU1pblggPSBuZXcgRnVuY3Rpb24oJ2EnLCAnYicsIGNvbXBhcmVBcnIuam9pbihmb3JtYXRbMF0pKTtcbiAgICAgICAgdGhpcy5jb21wYXJlTWluWSA9IG5ldyBGdW5jdGlvbignYScsICdiJywgY29tcGFyZUFyci5qb2luKGZvcm1hdFsxXSkpO1xuXG4gICAgICAgIHRoaXMudG9CQm94ID0gbmV3IEZ1bmN0aW9uKCdhJywgJ3JldHVybiBbYScgKyBmb3JtYXQuam9pbignLCBhJykgKyAnXTsnKTtcbiAgICB9XG59O1xuXG5cbi8vIGNhbGN1bGF0ZSBub2RlJ3MgYmJveCBmcm9tIGJib3hlcyBvZiBpdHMgY2hpbGRyZW5cbmZ1bmN0aW9uIGNhbGNCQm94KG5vZGUsIHRvQkJveCkge1xuICAgIG5vZGUuYmJveCA9IGRpc3RCQm94KG5vZGUsIDAsIG5vZGUuY2hpbGRyZW4ubGVuZ3RoLCB0b0JCb3gpO1xufVxuXG4vLyBtaW4gYm91bmRpbmcgcmVjdGFuZ2xlIG9mIG5vZGUgY2hpbGRyZW4gZnJvbSBrIHRvIHAtMVxuZnVuY3Rpb24gZGlzdEJCb3gobm9kZSwgaywgcCwgdG9CQm94KSB7XG4gICAgdmFyIGJib3ggPSBlbXB0eSgpO1xuXG4gICAgZm9yICh2YXIgaSA9IGssIGNoaWxkOyBpIDwgcDsgaSsrKSB7XG4gICAgICAgIGNoaWxkID0gbm9kZS5jaGlsZHJlbltpXTtcbiAgICAgICAgZXh0ZW5kKGJib3gsIG5vZGUubGVhZiA/IHRvQkJveChjaGlsZCkgOiBjaGlsZC5iYm94KTtcbiAgICB9XG5cbiAgICByZXR1cm4gYmJveDtcbn1cblxuZnVuY3Rpb24gZW1wdHkoKSB7IHJldHVybiBbSW5maW5pdHksIEluZmluaXR5LCAtSW5maW5pdHksIC1JbmZpbml0eV07IH1cblxuZnVuY3Rpb24gZXh0ZW5kKGEsIGIpIHtcbiAgICBhWzBdID0gTWF0aC5taW4oYVswXSwgYlswXSk7XG4gICAgYVsxXSA9IE1hdGgubWluKGFbMV0sIGJbMV0pO1xuICAgIGFbMl0gPSBNYXRoLm1heChhWzJdLCBiWzJdKTtcbiAgICBhWzNdID0gTWF0aC5tYXgoYVszXSwgYlszXSk7XG4gICAgcmV0dXJuIGE7XG59XG5cbmZ1bmN0aW9uIGNvbXBhcmVOb2RlTWluWChhLCBiKSB7IHJldHVybiBhLmJib3hbMF0gLSBiLmJib3hbMF07IH1cbmZ1bmN0aW9uIGNvbXBhcmVOb2RlTWluWShhLCBiKSB7IHJldHVybiBhLmJib3hbMV0gLSBiLmJib3hbMV07IH1cblxuZnVuY3Rpb24gYmJveEFyZWEoYSkgICB7IHJldHVybiAoYVsyXSAtIGFbMF0pICogKGFbM10gLSBhWzFdKTsgfVxuZnVuY3Rpb24gYmJveE1hcmdpbihhKSB7IHJldHVybiAoYVsyXSAtIGFbMF0pICsgKGFbM10gLSBhWzFdKTsgfVxuXG5mdW5jdGlvbiBlbmxhcmdlZEFyZWEoYSwgYikge1xuICAgIHJldHVybiAoTWF0aC5tYXgoYlsyXSwgYVsyXSkgLSBNYXRoLm1pbihiWzBdLCBhWzBdKSkgKlxuICAgICAgICAgICAoTWF0aC5tYXgoYlszXSwgYVszXSkgLSBNYXRoLm1pbihiWzFdLCBhWzFdKSk7XG59XG5cbmZ1bmN0aW9uIGludGVyc2VjdGlvbkFyZWEoYSwgYikge1xuICAgIHZhciBtaW5YID0gTWF0aC5tYXgoYVswXSwgYlswXSksXG4gICAgICAgIG1pblkgPSBNYXRoLm1heChhWzFdLCBiWzFdKSxcbiAgICAgICAgbWF4WCA9IE1hdGgubWluKGFbMl0sIGJbMl0pLFxuICAgICAgICBtYXhZID0gTWF0aC5taW4oYVszXSwgYlszXSk7XG5cbiAgICByZXR1cm4gTWF0aC5tYXgoMCwgbWF4WCAtIG1pblgpICpcbiAgICAgICAgICAgTWF0aC5tYXgoMCwgbWF4WSAtIG1pblkpO1xufVxuXG5mdW5jdGlvbiBjb250YWlucyhhLCBiKSB7XG4gICAgcmV0dXJuIGFbMF0gPD0gYlswXSAmJlxuICAgICAgICAgICBhWzFdIDw9IGJbMV0gJiZcbiAgICAgICAgICAgYlsyXSA8PSBhWzJdICYmXG4gICAgICAgICAgIGJbM10gPD0gYVszXTtcbn1cblxuZnVuY3Rpb24gaW50ZXJzZWN0cyhhLCBiKSB7XG4gICAgcmV0dXJuIGJbMF0gPD0gYVsyXSAmJlxuICAgICAgICAgICBiWzFdIDw9IGFbM10gJiZcbiAgICAgICAgICAgYlsyXSA+PSBhWzBdICYmXG4gICAgICAgICAgIGJbM10gPj0gYVsxXTtcbn1cblxuLy8gc29ydCBhbiBhcnJheSBzbyB0aGF0IGl0ZW1zIGNvbWUgaW4gZ3JvdXBzIG9mIG4gdW5zb3J0ZWQgaXRlbXMsIHdpdGggZ3JvdXBzIHNvcnRlZCBiZXR3ZWVuIGVhY2ggb3RoZXI7XG4vLyBjb21iaW5lcyBzZWxlY3Rpb24gYWxnb3JpdGhtIHdpdGggYmluYXJ5IGRpdmlkZSAmIGNvbnF1ZXIgYXBwcm9hY2hcblxuZnVuY3Rpb24gbXVsdGlTZWxlY3QoYXJyLCBsZWZ0LCByaWdodCwgbiwgY29tcGFyZSkge1xuICAgIHZhciBzdGFjayA9IFtsZWZ0LCByaWdodF0sXG4gICAgICAgIG1pZDtcblxuICAgIHdoaWxlIChzdGFjay5sZW5ndGgpIHtcbiAgICAgICAgcmlnaHQgPSBzdGFjay5wb3AoKTtcbiAgICAgICAgbGVmdCA9IHN0YWNrLnBvcCgpO1xuXG4gICAgICAgIGlmIChyaWdodCAtIGxlZnQgPD0gbikgY29udGludWU7XG5cbiAgICAgICAgbWlkID0gbGVmdCArIE1hdGguY2VpbCgocmlnaHQgLSBsZWZ0KSAvIG4gLyAyKSAqIG47XG4gICAgICAgIHNlbGVjdChhcnIsIGxlZnQsIHJpZ2h0LCBtaWQsIGNvbXBhcmUpO1xuXG4gICAgICAgIHN0YWNrLnB1c2gobGVmdCwgbWlkLCBtaWQsIHJpZ2h0KTtcbiAgICB9XG59XG5cbi8vIEZsb3lkLVJpdmVzdCBzZWxlY3Rpb24gYWxnb3JpdGhtOlxuLy8gc29ydCBhbiBhcnJheSBiZXR3ZWVuIGxlZnQgYW5kIHJpZ2h0IChpbmNsdXNpdmUpIHNvIHRoYXQgdGhlIHNtYWxsZXN0IGsgZWxlbWVudHMgY29tZSBmaXJzdCAodW5vcmRlcmVkKVxuZnVuY3Rpb24gc2VsZWN0KGFyciwgbGVmdCwgcmlnaHQsIGssIGNvbXBhcmUpIHtcbiAgICB2YXIgbiwgaSwgeiwgcywgc2QsIG5ld0xlZnQsIG5ld1JpZ2h0LCB0LCBqO1xuXG4gICAgd2hpbGUgKHJpZ2h0ID4gbGVmdCkge1xuICAgICAgICBpZiAocmlnaHQgLSBsZWZ0ID4gNjAwKSB7XG4gICAgICAgICAgICBuID0gcmlnaHQgLSBsZWZ0ICsgMTtcbiAgICAgICAgICAgIGkgPSBrIC0gbGVmdCArIDE7XG4gICAgICAgICAgICB6ID0gTWF0aC5sb2cobik7XG4gICAgICAgICAgICBzID0gMC41ICogTWF0aC5leHAoMiAqIHogLyAzKTtcbiAgICAgICAgICAgIHNkID0gMC41ICogTWF0aC5zcXJ0KHogKiBzICogKG4gLSBzKSAvIG4pICogKGkgLSBuIC8gMiA8IDAgPyAtMSA6IDEpO1xuICAgICAgICAgICAgbmV3TGVmdCA9IE1hdGgubWF4KGxlZnQsIE1hdGguZmxvb3IoayAtIGkgKiBzIC8gbiArIHNkKSk7XG4gICAgICAgICAgICBuZXdSaWdodCA9IE1hdGgubWluKHJpZ2h0LCBNYXRoLmZsb29yKGsgKyAobiAtIGkpICogcyAvIG4gKyBzZCkpO1xuICAgICAgICAgICAgc2VsZWN0KGFyciwgbmV3TGVmdCwgbmV3UmlnaHQsIGssIGNvbXBhcmUpO1xuICAgICAgICB9XG5cbiAgICAgICAgdCA9IGFycltrXTtcbiAgICAgICAgaSA9IGxlZnQ7XG4gICAgICAgIGogPSByaWdodDtcblxuICAgICAgICBzd2FwKGFyciwgbGVmdCwgayk7XG4gICAgICAgIGlmIChjb21wYXJlKGFycltyaWdodF0sIHQpID4gMCkgc3dhcChhcnIsIGxlZnQsIHJpZ2h0KTtcblxuICAgICAgICB3aGlsZSAoaSA8IGopIHtcbiAgICAgICAgICAgIHN3YXAoYXJyLCBpLCBqKTtcbiAgICAgICAgICAgIGkrKztcbiAgICAgICAgICAgIGotLTtcbiAgICAgICAgICAgIHdoaWxlIChjb21wYXJlKGFycltpXSwgdCkgPCAwKSBpKys7XG4gICAgICAgICAgICB3aGlsZSAoY29tcGFyZShhcnJbal0sIHQpID4gMCkgai0tO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGNvbXBhcmUoYXJyW2xlZnRdLCB0KSA9PT0gMCkgc3dhcChhcnIsIGxlZnQsIGopO1xuICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgIGorKztcbiAgICAgICAgICAgIHN3YXAoYXJyLCBqLCByaWdodCk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoaiA8PSBrKSBsZWZ0ID0gaiArIDE7XG4gICAgICAgIGlmIChrIDw9IGopIHJpZ2h0ID0gaiAtIDE7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBzd2FwKGFyciwgaSwgaikge1xuICAgIHZhciB0bXAgPSBhcnJbaV07XG4gICAgYXJyW2ldID0gYXJyW2pdO1xuICAgIGFycltqXSA9IHRtcDtcbn1cblxuXG4vLyBleHBvcnQgYXMgQU1EL0NvbW1vbkpTIG1vZHVsZSBvciBnbG9iYWwgdmFyaWFibGVcbmlmICh0eXBlb2YgZGVmaW5lID09PSAnZnVuY3Rpb24nICYmIGRlZmluZS5hbWQpIGRlZmluZSgncmJ1c2gnLCBmdW5jdGlvbigpIHsgcmV0dXJuIHJidXNoOyB9KTtcbmVsc2UgaWYgKHR5cGVvZiBtb2R1bGUgIT09ICd1bmRlZmluZWQnKSBtb2R1bGUuZXhwb3J0cyA9IHJidXNoO1xuZWxzZSBpZiAodHlwZW9mIHNlbGYgIT09ICd1bmRlZmluZWQnKSBzZWxmLnJidXNoID0gcmJ1c2g7XG5lbHNlIHdpbmRvdy5yYnVzaCA9IHJidXNoO1xuXG59KSgpO1xuIl19
