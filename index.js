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
require('joose');
var Utils = require('./Utils');
var CONFIG = require('./Config');
Class("BackendStream",
{
    has:
    {
		url : {
			is : "rw",
			init : (window.location.host.indexOf("localhost") == 0 || window.location.host.indexOf("127.0.0.1") == 0) ? "http://localhost:3000/stream" : "node/stream"
		},
    },
    //--------------------------------------
    methods:
    {
        start : function(track)
        {    
        	track.test1();
        	// TEST
        	if (0 == 1) 
        	{
        		var ctime = (new Date()).getTime();
        		var cc=0;
        		setInterval(function() 
        		{
        			cc++;
                    for (var i in track.participants) 
                    {
                    	var diff = ((new Date()).getTime()-ctime)/1000; // seconds
        				var elp = cc/60.0;  
                    	if (elp > 1)
                    		elp=1;
                    	var pp = track.participants[i];
                    	//var pos = track.__getPositionAndRotationFromElapsed(elp);
                    	var pos = track.getPositionAndRotationFromElapsed(elp);
                    	pp.pingCalculated(
                    	  {
                    	        "imei": "1000",
                    	        "speed": 0,
                    	        "elapsed": 0,
                    	        "timestamp": (new Date()).getTime(),
                    	        "gps": [Math.round(pos[0]*1000000.0)/1000000.0,Math.round(pos[1]*1000000.0)/1000000.0],
                    	        "freq": 0,
                    	        "isSOS": false,
                    	        "acceleration": 0,
                    	        "alt": 0,
                    	        "overallRank": 1,
                    	        "genderRank": 1,
                    	        "groupRank": 1
                    	    });
                    }
        		},3000);
        		return;
        	}
        	//-------------------------------------------------------------------------        	
    		var url = this.url;
        	function doTick() 
        	{
                var mmap = {};
                var ctime = (new Date()).getTime();
                var json = [];
                for (var i in track.participants) 
                {
                	var pp = track.participants[i];
                	if (pp.isFavorite)
                		mmap[pp.deviceId]=pp;
                	var reft = ctime - 10*60*1000;
                	if (!pp.__startTime || pp.__startTime < reft) {
                		pp.__startTime=reft;
                	}
                	json.push({start:pp.__startTime,end : ctime,imei:pp.deviceId});
                }
                if (!json.length)
                	return;
                function processData(data) 
                {
                	for (var i in data) 
                	{
                		//console.warn(data[i]);
                		var pp = mmap[data[i].imei];
                		if (pp) {
                			if (data[i].timestamp+1 > pp.__startTime)
                				pp.__startTime=data[i].timestamp+1;
                			pp.pingCalculated(data[i]);
                		}
                	}
                }
                //console.log(json);
                $.ajax({
                    type: "POST",
                    url: url,
                    data: JSON.stringify(json),
                    contentType: "application/json; charset=utf-8",
                    dataType: "json",
                    success: function(data){
                        processData(data);
                    },
                    failure: function(errMsg) {
                        console.error("ERROR get data from backend "+errMsg)
                    }
                });
                setTimeout(doTick,CONFIG.timeouts.streamDataInterval*1000);
        	}
        	doTick();
        }
    }    
});

},{"./Config":7,"./Utils":18,"joose":20}],7:[function(require,module,exports){
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
		gpsInaccuracy : 8, //8,  // error simulation in METER (look math.gpsInaccuracy, min 1/2)
		speedCoef : 100
	},
	settings : {
		noMiddleWare : 0, 	// SKIP middle ware node js app
		noInterpolation : 0	// 1 -> no interpolation only points
	},
	math : {
		gpsInaccuracy : 30,	//TODO 13 min
		speedAndAccelerationAverageDegree : 2,	// calculation based on N states (average) (MIN 2)
		displayDelay : 70,						// display delay in SECONDS
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
		debug : 1,
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
		isShowImageCheckpoint : true,

        // the distance between the direction icons - in pixels,
        // if set non-positive value (0 or less) then don't show them at all
		//directionIconBetween : 200
		directionIconBetween : -1
	},

    hotspot : {
        cam : {image :"img/camera.svg"},  // use the same image for static cameras as for the moving ones
		camSwimBike : {image : "img/wz1.svg", scale : 0.040},
		camBikeRun : {image : "img/wz2.svg", scale : 0.040},
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

},{"./Utils.js":18}],8:[function(require,module,exports){
var Utils = require('./Utils');
var CONFIG = require('./Config');

var DemoSimulation = function() {

    console.info("Starting demo simulation");

    var scoef = 6*5*5*3; //5*4;//*3;//*3;//4.729;

    // keep track of all the simulation participants
    var countSimulations = 0;

    this.simulateParticipant = function(part) {

        var trackInSeconds = 30*scoef*(1+countSimulations/7.0);
        countSimulations++;

        var p0 = TRACK.route[0];
        var randcoef = 0;//CONFIG.simulation.gpsInaccuracy * 0.0001 / Utils.WGS84SPHERE.haversineDistance(p0, [p0[0]+0.0001, p0[1]+0.0001]);
        var stime = (new Date()).getTime();
        var coef = TRACK.getTrackLength() / TRACK.getTrackLengthInWGS84();
        setInterval(function(e) {
            var ctime = (new Date()).getTime();
            var elapsed = ((ctime - stime)/1000.0)/trackInSeconds;
            var pos = TRACK.__getPositionAndRotationFromElapsed(elapsed % 1.0);
            var dist1 = (Math.random()*2.0-1.0) * randcoef;
            var dist2 =  (Math.random()*2.0-1.0)  * randcoef;
            var alt = 1000*Math.random();
            var overallRank = parseInt(20*Math.random())+1;
            var groupRank = parseInt(20*Math.random())+1;
            var genderRank = parseInt(20*Math.random())+1;
            //pos[0]+=dist1;
            //pos[1]+=dist2;
            part.ping(pos,80+Math.random()*10,false,ctime,alt,overallRank,groupRank,genderRank,elapsed);
        }, CONFIG.simulation.pingInterval*1000);
    };
};

module.exports = new DemoSimulation();



},{"./Config":7,"./Utils":18}],9:[function(require,module,exports){
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
				maxZoom: this.isWidget ? this.initialZoom : 17,
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
			if (!this._animationInit) {
				this._animationInit=true;
				setInterval(this.onAnimation.bind(this), 1000*CONFIG.timeouts.animationFrame );
			}

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
		
		onAnimation : function()
		{
			var arr=[];
			for (var ip=0;ip<TRACK.participants.length;ip++)
			{
				var p = TRACK.participants[ip];
				if (p.isFavorite)
				{
					p.interpolate();

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
			//-------------------------------------------------------
			if (this.selectedParticipant1) 
			{
				var spos = this.selectedParticipant1.getFeature().getGeometry().getCoordinates();
				if (!this.popup1.is_shown) {
				    this.popup1.show(spos, this.popup1.lastHTML=this.selectedParticipant1.getPopupHTML());
				    this.popup1.is_shown=1;
				} else {
					if (!this.popup1.getPosition() || this.popup1.getPosition()[0] != spos[0] || this.popup1.getPosition()[1] != spos[1])
					    this.popup1.setPosition(spos);
					var ctime = (new Date()).getTime();			 
					if (!this.lastPopupReferesh1 || ctime - this.lastPopupReferesh1 > 2000) 
					{
						this.lastPopupReferesh1=ctime;
					    var rr = this.selectedParticipant1.getPopupHTML();
					    if (rr != this.popup1.lastHTML) {
					    	this.popup1.lastHTML=rr;
						    this.popup1.content.innerHTML=rr; 
					    }					
					}
				    this.popup1.panIntoView_(spos);
				}
			}
			if (this.selectedParticipant2) 
			{
				var spos = this.selectedParticipant2.getFeature().getGeometry().getCoordinates();
				if (!this.popup2.is_shown) {
				    this.popup2.show(spos, this.popup2.lastHTML=this.selectedParticipant2.getPopupHTML());
				    this.popup2.is_shown=1;
				} else {
					if (!this.popup2.getPosition() || this.popup2.getPosition()[0] != spos[0] || this.popup2.getPosition()[1] != spos[1])
					    this.popup2.setPosition(spos);
					var ctime = (new Date()).getTime();			 
					if (!this.lastPopupReferesh2 || ctime - this.lastPopupReferesh2 > 2000) 
					{
						this.lastPopupReferesh2=ctime;
					    var rr = this.selectedParticipant2.getPopupHTML();
					    if (rr != this.popup2.lastHTML) {
					    	this.popup2.lastHTML=rr;
						    this.popup2.content.innerHTML=rr; 
					    }					
					}
				    this.popup2.panIntoView_(spos);
				}
			}
			//--------------------			
			if (this.isDebug)  
				this.doDebugAnimation();
		},
		
		setSelectedParticipant1 : function(part,center) 
		{
			if (!(part instanceof Participant)) {
				var pp=part;
				part=null;
				for (var i=0;i<TRACK.participants.length;i++)
					if (TRACK.participants[i].deviceId == pp) {
						part=TRACK.participants[i];
						break;
					}
			}
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

		setSelectedParticipant2 : function(part,center) 
		{
			if (!(part instanceof Participant)) {
				var pp=part;
				part=null;
				for (var i=0;i<TRACK.participants.length;i++)
					if (TRACK.participants[i].deviceId == pp) {
						part=TRACK.participants[i];
						break;
					}
			}
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
},{"./Config":7,"./LiveStream":12,"./Styles":16,"./Track":17,"./Utils":18,"joose":20}],10:[function(require,module,exports){
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
},{"./Point":15,"./Utils":18,"joose":20}],11:[function(require,module,exports){
//---------------------------------------------------------------------------------------------------------
require('./Track');
require('./Gui');
require('./Participant');
require('./MovingCam');
require('./HotSpot');
require('./BackendStream');
require('./../nodejs/StreamData');
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
var params = getSearchParameters();
//-----------------------------------------------
if (params["debug"] && params["debug"] != "0") {
    console.warn("GOING TO DEBUG MODE...");
    CONFIG.timeouts.animationFrame = 4; // 4 sec
}
//-----------------------------------------------
if (params["simple"] && params["simple"] != "0") {
    console.warn("GOING TO SIMPLE MODE...");
    CONFIG.settings.noMiddleWare = 1;
    CONFIG.settings.noInterpolation = 1;
}
//-----------------------------------------------
var tableFavorites = null;
var tableParticipants = null;

function showMap() {
    $("#left_pane").addClass('hide');
    $("#map").removeClass('col-sm-6 col-md-8 hidden-xs').addClass('col-sm-12');
    $(window).resize();
    if (GUI.map)
        GUI.map.updateSize();
}
function showLeftPane() {
    $("#map").addClass('col-sm-6 col-md-8 hidden-xs').removeClass('col-sm-12');
    $("#left_pane").removeClass('hide');
    $(window).resize();
    if (GUI.map)
        GUI.map.updateSize();
}

function isTabVisible(tabId) {
    if ($("#left_pane").hasClass("hide"))
        return false;
    return !($('#' + tabId).hasClass('hide'));
}

function showTab(tabId) {
    showLeftPane();

    $('#tabcont').find('div[role="tabpanel"]').addClass('hide');
    $('#' + tabId).removeClass('hide');

    if (tabId == "participants") {
        initTableParticipants();
    } else if (tabId == "favorites") {
        initTableFavorites();
    }
}

function initTableParticipants() {
    if (!tableParticipants) {
        var arr = PARTICIPANTS;
        var res = [];
        for (var i in arr) {
            var part = arr[i];
            res.push({
                id: part.id,
                follow: part.isFavorite,
                name: part.code,
                bib: part.startPos,
                gender: part.gender,
                country: part.country,
                ageGroup: part.ageGroup,
                age: part.age,
                "overall-rank": part.getOverallRank(),
                "gender-rank": part.getGenderRank(),
                "group-rank": part.getGroupRank(),
                "occupation": ""
            });
        }
        tableParticipants = $('#table-participants').DataTable({
            "iDisplayLength": 50,
            "bAutoWidth": false,
            "aaSorting": [[1, 'asc']],
            data: res,
            columns: [
                {
                    //follow
                    className: "dt-body-center",
                    data: null,
                    render: function (data, type, row) {
                        var favImgSrc;
                        if (data.follow == 1)
                            favImgSrc = "star_solid.svg";
                        else
                            favImgSrc = "star.svg";
                        return "<img data-id='" + data.id + "' src='img/" + favImgSrc + "' class='table-favorite-add'/>";
                    }
                },

                {data: "name"},
                {data: "overall-rank", className: "dt-body-center"},
                {data: "group-rank", className: "dt-body-center"},
                {data: "gender-rank", className: "dt-body-center"},
                {data: "bib", className: "dt-body-center"},
                {data: "gender", className: "dt-body-center"},
                {
                    className: "dt-body-center",
                    data: null,
                    render: function (data, type, row) {
                        if (!data.country)
                            return "";
                        return '<div class="invisible">' + data.country + '</div><flag-icon key="' + data.country + '" width="42"></flag-icon>';
                    }
                },
                {
                    // age + GROUP
                    data: null,
                    render: function (data, type, row) {
                        return data.age;
                    }
                },
                {data: "occupation", className: "dt-body-center"}
            ],
            tableTools: {
                sRowSelect: "os",
                aButtons: []
            }
        });
    } else {
        $("#table-participants").resize();
    }
}

function initTableFavorites() {
    if (!tableFavorites) {
        var arr = PARTICIPANTS.filter(function (v) {
            return v.isFavorite;
        });
        var res = [];
        for (var i in arr) {
            var part = arr[i];
            res.push({
                name: part.code,
                bib: part.startPos,
                gender: part.gender,
                country: part.country,
                ageGroup: part.ageGroup,
                age: part.age
            });
        }
        tableFavorites = $('#table-favorites').DataTable({
            "destroy": true,
            "iDisplayLength": 50,
            "bAutoWidth": false,
            "aaSorting": [[1, 'asc']],
            data: res,
            columns: [
                {data: "name"},
                {data: "bib", className: "dt-body-center"},
                {data: "gender", className: "dt-body-center"},
                {
                    className: "dt-body-center",
                    data: null,
                    render: function (data, type, row) {
                        if (!data.country)
                            return "";
                        return '<div class="invisible">' + data.country + '</div><flag-icon key="' + data.country + '" width="42"></flag-icon>';
                    }
                },
                {
                    // age + GROUP
                    data: null,
                    render: function (data, type, row) {
                        return data.age;
                    }
                    , className: "dt-body-right"

                }
            ],
            tableTools: {
                sRowSelect: "os",
                aButtons: []
            }
        });
        $('#table-favorites').on('click', 'tr', function (e) {
            if (tableFavorites.row(this).data()) {
                GUI.setSelectedParticipant1(tableFavorites.row(this).data().code, true);
                GUI.setSelectedParticipant2(null);
            }
        });
    } else {
        $("#table-favorites").resize();
    }
}

function refreshTables() {
    if (tableParticipants) {
        var arr = PARTICIPANTS;
        tableParticipants.clear();
        arr.forEach(function (part) {
            tableParticipants.row.add({
                id: part.id,
                follow: part.isFavorite,
                name: part.code,
                bib: part.startPos,
                gender: part.gender,
                country: part.country,
                ageGroup: part.ageGroup,
                age: part.age,
                "overall-rank": part.getOverallRank(),
                "gender-rank": part.getGenderRank(),
                "group-rank": part.getGroupRank(),
                "occupation": ""
            });
        });
        tableParticipants.draw();
    }

    if (tableFavorites) {
        var arr = PARTICIPANTS.filter(function (v) {
            return v.isFavorite;
        });
        tableFavorites.clear();
        arr.forEach(function (part) {
            tableFavorites.row.add({
                name: part.code,
                bib: part.startPos,
                gender: part.gender,
                country: part.country,
                ageGroup: part.ageGroup,
                age: part.age
            });
        });
        tableFavorites.draw();
    }
}

function changeFavorite(id) {
    for (var i in TRACK.participants) {
        var p = TRACK.participants[i];
        if (p.id == id) {
            p.isFavorite = !p.isFavorite;
            localStorage.setItem("favorite-" + p.id, p.isFavorite ? "1" : "0");
            refreshTables();
            break;
        }
    }
}

//--------------------------------------------------------------------------
// use this if you want to bypass all the NodeJS dynamic event get
// it will simulate a static data return by "demo_simulation_data.json"
//window.isDEMO_SIMULATION = true;

window.TRACK = new Track();
window.GUI = new Gui({track: TRACK, isSkipExtent : true, initialZoom : 14});
window.PARTICIPANTS = [];

//--------------------------------------------------------------------------
$(document).ready(function () {
    if (Utils.mobileAndTabletCheck())
        $("body").addClass("mobile");

    // Event data loading - realtime or hard simulated
    //--------------------------------------------------------------------------
    var eventDataUrl;
    if (window.isDEMO_SIMULATION === true) {
        // load the demo simulation generator
        var demoSimulation = require('./DemoSimulation');
        // this is the data with the demo participants/cams
        eventDataUrl = "data/demo_simulation_data.json";

        CONFIG.math.displayDelay = 10; // fix this animation display delay time
    } else {
        var baseurl = (window.location.host.indexOf("localhost") == 0 ||
        window.location.host.indexOf("127.0.0.1") == 0) ? "http://localhost:3000/" : "node/";
        eventDataUrl = baseurl + "event";
    }

    $.getJSON(eventDataUrl).done(function (data) {
        TRACK.setBikeStartKM(data.bikeStartKM);
        TRACK.setRunStartKM(data.runStartKM);
        TRACK.setRoute(data.route);
        CONFIG.times = {begin: data.times.startTime , end: data.times.endTime };
        GUI.init();

        function processEntry(pdata, isCam) {
            var part;
            if (isCam)
                part = TRACK.newMovingCam(pdata.id, pdata.deviceId, pdata.code);
            else
                part = TRACK.newParticipant(pdata.id, pdata.deviceId, pdata.code);
            part.setColor(pdata.color);
            part.setAgeGroup(pdata.ageGroup);
            part.setAge(pdata.age);
            part.setCountry(pdata.country);
            part.setStartPos(pdata.startPos);
            part.setGender(pdata.gender);
            part.setIcon(pdata.icon);
            part.setImage(pdata.image);
            if (isCam || localStorage.getItem("favorite-" + part.id) == 1)
                part.setIsFavorite(true);
            if (!isCam)
                PARTICIPANTS.push(part);

            // if this is a demo simulation then start it for each single favourite-participant or cam
            if (window.isDEMO_SIMULATION === true) {
                if (part.getIsFavorite()) {
                    demoSimulation.simulateParticipant(part);
                }
            }
        }

        for (var i in data.participants)
            processEntry(data.participants[i], false);
        for (var i in data.cams)
            processEntry(data.cams[i], true);

        // if this is not a demo simulation start listening for the realtime pings
        if (window.isDEMO_SIMULATION !== true) {
            if (CONFIG.settings.noMiddleWare) {
                function doHTTP(url, json, onReqDone) {
                    if (json.length) {
                        $.ajax({
                            type: "POST",
                            url: url,
                            data: JSON.stringify(json),
                            contentType: "application/json; charset=utf-8",
                            dataType: "json",
                            success: function (data) {
                                onReqDone(data);
                            },
                            failure: function (errMsg) {
                                console.error("ERROR get data from backend " + errMsg)
                            }
                        });
                    }
                }

                var stream = new StreamData();
                stream.start(TRACK, function () {
                    return true;
                }, 10, doHTTP); // 10 sec ping int.
            } else {
                // NORMAL CASE
                var stream = new BackendStream();
                stream.start(TRACK);
                
                
            }
        }

        // add all the static HotSpots
        var dynamicTrackHotspots = [];
        for (var k = 0; k < HOTSPOTS.length; k++) {
            var hotspotData = HOTSPOTS[k];
            var hotspot = new HotSpot(HOTSPOTS[k]);
            if (hotspotData.point) {
                // this is a static hotspot - just a fixed point
                hotspot.init(HOTSPOTS[k].point);
            } else {
                // this is a dynamic HotSpot - depending on the Track
                dynamicTrackHotspots.push(hotspot)
            }
        }
        TRACK.newHotSpots(dynamicTrackHotspots);
    }).fail(function () {
        console.error("Error get event configuration from backend!");
    });

    //--------------------------------------------------------------------------

    $("#button_swim, #button_bike, #button_run").
        css("background-color", function() {
            return CONFIG.appearance["trackColor" + $(this).data("track")];
        }).
        click(function () {
            var track = $(this).data("track");
            $(this).toggleClass("inactive");
            GUI["isShow" + track] = !$(this).hasClass("inactive");
            GUI.redraw();
        });

    $("#button_rank, #button_participants, #button_favorites").click(function () {
        var openTabId = $(this).data("open");
        if (isTabVisible(openTabId))
            showMap();
        else
            showTab(openTabId);
    });

    $("#tabcont").find(".close").click(function () {
        showMap();
    });

    $("#link_partners, #link_legalNotice, #button_liveStream").click(function () {
        var $toClose = $("._contVisible");
        var $toOpen = $("#" + $(this).data("open"));
        var isLiveStreamClose = $toClose.is("#liveStream");
        var isLiveStreamOpen = $toOpen.is("#liveStream");

        function open() {
            $toClose.removeClass("_contVisible");

            if ($toClose.is($toOpen))
                return;

            if (isLiveStreamOpen) {
                var isShown = GUI.toggleLiveStream();
                $toOpen.toggleClass("_contVisible", isShown);
            } else {
                $toOpen.addClass("_contVisible");
                $toOpen.slideDown();
            }
        }

        if ($toClose.length) {
            if (isLiveStreamClose) {
                GUI.toggleLiveStream(open);
            } else {
                $toClose.slideUp(400, open);
            }
        } else {
            open();
        }
    });

    $("#table-participants").on("click", ".table-favorite-add", function() {
        var id = $(this).data('id');
        changeFavorite(id);
    });
});


},{"./../nodejs/StreamData":19,"./BackendStream":6,"./Config":7,"./DemoSimulation":8,"./Gui":9,"./HotSpot":10,"./MovingCam":13,"./Participant":14,"./Track":17,"./Utils":18}],12:[function(require,module,exports){
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
            $player.html('<iframe src=' + url + '?width=490&height=275&autoPlay=true&mute=false" width="490" height="275" frameborder="0" scrolling="no" '+
            'allowfullscreen webkitallowfullscreen mozallowfullscreen oallowfullscreen msallowfullscreen></iframe>');

            // show if not already shown
            if (!this._isShown)
                this._$comp.slideDown(400, completeCallback);
            this._isShown = true;
        }
    }
});
},{"./Utils":18,"joose":20}],13:[function(require,module,exports){
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
},{"./Participant":14,"joose":20}],14:[function(require,module,exports){
require('joose');
require('./Point');

var CONFIG = require('./Config');
var Utils = require('./Utils');

var coefy = 0.75;

Class("ParticipantState",
{
	has : {		
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
    		init : null //[]
    		
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
	    lastInterpolateTimestamp : {
	    	is : "rw",
	    	init : null
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
			init : true /* todo set false */
		}
    },
	after : {
		init : function(pos, track) {
			this.setTrack(track);
			var ctime = (new Date()).getTime();
			var state = new ParticipantState({timestamp:1/* placeholder ctime not 0 */,gps:pos,isSOS:false,freq:0,speed:0,elapsed:track.getElapsedFromPoint(pos)});
			this.setElapsed(state.elapsed);
			this.setStates([state]);
			this.setIsSOS(false);
			this.setIsDiscarded(false);

			if (this.feature) {
				this.initFeature();
			}
			this.ping(pos,0,false,1 /* placeholder ctime not 0 */,0,0,0,0,0);
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
		interpolate : function() 
		{
			
			if (!this.states.length)
				return;
			var ctime=(new Date()).getTime();
			var isTime = (ctime >= CONFIG.times.begin && ctime <= CONFIG.times.end);
			if (this.isDiscarded || this.isSOS/* || !this.isOnRoad*/ || !isTime || CONFIG.settings.noInterpolation) 
			{
				var lstate=this.states[this.states.length-1];
				var pos = lstate.gps;
				if (pos[0] != this.getPosition()[0] || pos[1] != this.getPosition()[1]) 
				{
				    this.setPosition(pos);
				    this.setRotation(null);
					this.updateFeature();
				} else {
					if (this.isDiscarded) {
						this.updateFeature();
					}
				}
				return;
			}
			this.setLastInterpolateTimestamp(ctime);
			// No enough data?
			if (this.states.length < 2)
				return;
			var res = this.calculateElapsedAverage(ctime);
			if (res) 
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
			var res=null;
			for (var i=this.states.length-2;i>=0;i--) 
			{
				var j = i+1;
				var sa = this.states[i];
				var sb = this.states[j];
				if (ctime >= sa.timestamp && ctime <= sb.timestamp) 
				{ 
					res = sa[proName];
					break;
				}
				if (sb.timestamp < ctime)
					break;
			}
			return res;
		},

		avg2 : function(ctime,proName) 
		{
			var res=null;
			for (var i=this.states.length-2;i>=0;i--) 
			{
				var j = i+1;
				var sa = this.states[i];
				var sb = this.states[j];
				if (ctime >= sa.timestamp && ctime <= sb.timestamp) 
				{ 
					res = [
					       	sa[proName][0]+(ctime-sa.timestamp) * (sb[proName][0]-sa[proName][0]) / (sb.timestamp-sa.timestamp),
					       	sa[proName][1]+(ctime-sa.timestamp) * (sb[proName][1]-sa[proName][1]) / (sb.timestamp-sa.timestamp)
				          ]; 
					break;
				}
				if (sb.timestamp < ctime)
					break;
			}
			return res;
		},

		avg : function(ctime,proName) 
		{
			var res=null;
			//console.log(this.states);
			for (var i=this.states.length-2;i>=0;i--) 
			{
				var j = i+1;
				var sa = this.states[i];
				var sb = this.states[j];
				if (ctime >= sa.timestamp && ctime <= sb.timestamp) 
				{ 
					res = sa[proName]+(ctime-sa.timestamp) * (sb[proName]-sa[proName]) / (sb.timestamp-sa.timestamp);
					break;
				}
				if (sb.timestamp < ctime)
					break;
			}
			/*if (res == null) {
				var arr=[];
				for (var i=this.states.length-1;i>=0;i--) if (i == 0 || i == this.states.length-1) {
					arr.push(Utils.formatDateTimeSec(new Date(this.states[i].timestamp)));
				} 
				console.log("AVG NULL BECAUSE SEARCHING "+Utils.formatDateTimeSec(new Date(ctime))+" | "+arr);
			}*/
			return res;
		},

		calculateElapsedAverage : function(ctime) 
		{
			var res=null;
			ctime-=CONFIG.math.displayDelay*1000;
			//console.log("SEARCHING FOR TIME "+Utils.formatDateTimeSec(new Date(ctime)));
			var ok = false;
			for (var i=this.states.length-2;i>=0;i--) 
			{
				var j = i+1;
				var sa = this.calcAVGState(i);
				var sb = this.calcAVGState(j);
				if (ctime >= sa.timestamp && ctime <= sb.timestamp) 
				{ 
					res = sa.elapsed+(ctime-sa.timestamp) * (sb.elapsed-sa.elapsed) / (sb.timestamp-sa.timestamp);
					//console.log("FOUND TIME INT ["+Utils.formatDateTimeSec(new Date(sa.timestamp))+" > "+Utils.formatDateTimeSec(new Date(sb.timestamp))+"]");
					ok=true;
					break;
				}
				if (sb.timestamp < ctime) {
					this.setSignalLostDelay(ctime-sb.timestamp);
					//console.log("BREAK ON "+formatTimeSec(new Date(ctime))+" | "+(ctime-sb.timestamp)/1000.0);
					return null;
				}
			}
			if (!ok) {
				if (this.states.length >= 2)
					console.log(this.code+" | NOT FOUND TIME "+Utils.formatDateTimeSec(new Date(ctime))+" | t-last="+(ctime-this.states[this.states.length-1].timestamp)/1000.0+" | t-first="+(ctime-this.states[0].timestamp)/1000.0);
			} else
				this.setSignalLostDelay(null);
			return res;
		},
		
		calcAVGState : function(pos) {
			if (!CONFIG.math.interpolateGPSAverage)
				return this.states[pos];
			var ssume=0;
			var ssumt=0;
			var cc=0;
			for (var i=pos;i>=0 && (pos-i)<CONFIG.math.interpolateGPSAverage;i--) {
				ssume+=this.states[i].elapsed;
				ssumt+=this.states[i].timestamp;
				cc++;
			}
			ssume/=cc;
			ssumt/=cc;
			return {elapsed : ssume,timestamp : ssumt};
		},

		pingCalculated : function(obj) {
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
				console.log(Math.round(state.elapsed*100.0*100.0)/100.0+"% PONG ["+pos[0]+","+pos[1]+"] "+new Date(state.timestamp));

				while (GUI.testLayer1.getSource().getFeatures().length > 10)
					GUI.testLayer1.getSource().removeFeature(GUI.testLayer1.getSource().getFeatures()[0]);
				while (GUI.testLayer.getSource().getFeatures().length > 10)
					GUI.testLayer.getSource().removeFeature(GUI.testLayer.getSource().getFeatures()[0]);
			} 

		},

		getOverallRank : function() {
			if (this.states.length) {
				return this.states[this.states.length-1].overallRank;
			}
			return "-";
		},
		getGroupRank : function() {
			if (this.states.length) {
				return this.states[this.states.length-1].groupRank;
			}
			return "-";
		},
		getGenderRank : function() {
			if (this.states.length) {
				return this.states[this.states.length-1].genderRank;
			}
			return "-";
		},
		
		ping : function(pos,freq,isSOS,ctime,alt,overallRank,groupRank,genderRank,_ELAPSED)
		{
			var llt = (new Date()).getTime(); 
			if (!ctime)
				ctime=llt;
			this.setLastRealDelay(llt-ctime);
			this.setLastPingTimestamp(llt);			
			var state = new ParticipantState({timestamp:ctime,gps:pos,isSOS:isSOS,freq:freq,alt:alt,overallRank:overallRank,groupRank:groupRank,genderRank:genderRank});
			//isSOS=true;
			if (isSOS || CONFIG.settings.noInterpolation)
			{
				if (isSOS)
					this.setIsSOS(true);				
				this.addState(state);
				return;
			}
			//----------------------------------------------------------
			var tracklen = this.track.getTrackLength();
			var tracklen1 = this.track.getTrackLengthInWGS84();
			var llstate = this.states.length >= 2 ? this.states[this.states.length-2] : null;
			var lstate = this.states.length ? this.states[this.states.length-1] : null;
			if (pos[0] == 0 && pos[1] == 0) {
				if (!lstate) return;
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
			
			console.log("!!! FOUND "+result.length+" | "+this.track.route.length+" | "+rr);
			//for (var i=0;i<this.track.route.length-1;i++) {

			//----------------------------------------------
			var rrect = IntersectionParams.newRect(pos[0]-rr, pos[0]-rr*coefy, rr, rr.coefy);
			for (var _i=0;_i<result.length;_i++)
			{
				var i = result[_i][4].index;
				
				/*var res = Intersection.intersectShapes(  
			              	IntersectionParams.newLine(new Point2D(tg[i][0],tg[i][1]),new Point2D(tg[i+1][0],tg[i+1][1]))  
			              , rrect  
			      		);
				if (res) 
				{
					var d3 = WGS84SPHERE.haversineDistance(tg[i],tg[i+1]);
					for (var q=0;q<res.length;q++) 
					{
						//Utils.disp
						var d1 = WGS84SPHERE.haversineDistance([res[q].x,res[q].y],tg[i]);
						var el1 = this.track.distancesElapsed[i]+(this.track.distancesElapsed[i+1]-this.track.distancesElapsed[i])*d1/d3;
						if (el1 < lelp)
							el1=lelp;
						if (minf == null || el1 < minf)
							minf=el1;
						console.log("Intersection candidate at "+i+" | "+Math.round(el1*100.0*100.0)/100.0);
					}
				}*/
				var res = Utils.interceptOnCircle(tg[i],tg[i+1],pos,rr);
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
				}
			}
			//---------------------------------------------			
			/*if (minf == null)
				console.error("MINF NULL");
			else
				console.log(">> MINF "+Math.round(minf*100.0*100.0)/100.0);*/
			
			if (minf == null) {
				state.setElapsed(nel);
				this.addState(state);
				return;
			}

			bestm=minf;
			if (bestm != null) 
			{
				var nel = bestm; //this.track.getElapsedFromPoint(best);
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
					llstate = this.states.length >= CONFIG.math.speedAndAccelerationAverageDegree*2 ? this.states[this.states.length-CONFIG.math.speedAndAccelerationAverageDegree*2] : null;
					lstate = this.states.length >= CONFIG.math.speedAndAccelerationAverageDegree ? this.states[this.states.length-CONFIG.math.speedAndAccelerationAverageDegree] : null;
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
			this.addState(state);
		},
		
		addState : function(state) {
			this.states.push(state);
			if (this.states.length > CONFIG.constraints.maxParticipantStateHistory && !this.isSOS)
				this.states.shift();
		},

		getLastState: function() {
			return this.states.length ? this.states[this.states.length-1] : null;
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

		getPopupHTML : function() {
			var pos = this.getPosition();
			if (this.isSOS || this.isDiscarded) {
				pos = this.getGPS();
			}
			var tlen = this.track.getTrackLength();
			var ctime = (new Date()).getTime();
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
			if (this.states.length) 
			{
				lstate = this.states[this.states.length-1];
				if (lstate.getSpeed() > 0) 
				{
					var spms = Math.ceil(lstate.getSpeed() * 100) / 100;
					spms/=1000.0;
					spms*=60*60;
					etxt1=parseFloat(spms).toFixed(2)+" km/h";
					var rot = -this.getRotation()*180/Math.PI; 
					if (rot < 0)
						rot+=360;
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
				}
				if (lstate.getAcceleration() > 0)
					etxt2=parseFloat(Math.ceil(lstate.getAcceleration() * 100) / 100).toFixed(2)+" m/s2";
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

},{"./Config":7,"./Point":15,"./Utils":18,"joose":20}],15:[function(require,module,exports){
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
},{"joose":20}],16:[function(require,module,exports){
var CONFIG = require('./Config');

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
                    color: "rgba(" + colorAlphaArray(part.color, 0.15).join(",") + ")"
                }),
                stroke: new ol.style.Stroke({
                    color: "rgba(255,255,255,0.5)",
                    width: 3
                })
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
				if (CONFIG.appearance.isShowImageCheckpoint)
					STYLES._genCheckpointImage(geombike, CONFIG.appearance.imageCheckpointSwimBike, styles);
				else if (GUI.isShowBike)
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
				if (CONFIG.appearance.isShowImageCheckpoint)
					STYLES._genCheckpointImage(geomrun, CONFIG.appearance.imageCheckpointBikeRun, styles);
				else if (GUI.isShowBike)
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
		
		var etxt="";
		var lstate = null;
		if (part.states.length) {
			lstate = part.states[part.states.length-1];
			etxt=" "+parseFloat(Math.ceil(lstate.getSpeed() * 100) / 100).toFixed(2)+" m/s";// | acc "+parseFloat(Math.ceil(lstate.getAcceleration() * 100) / 100).toFixed(2)+" m/s";
		}
		var zIndex = Math.round(part.getElapsed()*1000000)*1000+part.seqId;
		/*if (part == GUI.getSelectedParticipant()) {
			zIndex=1e20;
		}*/
		var styles=[];
		//-----------------------------------------------------------------------------------------------------------------------
		var ctime = (new Date()).getTime();
		var isTime = (ctime >= CONFIG.times.begin && ctime <= CONFIG.times.end);
		var isDirection = (lstate && lstate.getSpeed() > 0 && !part.isSOS && !part.isDiscarded && isTime);
		var animFrame = (ctime%3000)*Math.PI*2/3000.0;

        if (isTime) {
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
                    text: part.getDeviceId(),
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

},{"./Config":7}],17:[function(require,module,exports){
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
		
		// CALL ONLY ONCE ON INIT
		getElapsedFromPoint : function(point,start) 
		{
			var res=0.0;
			var brk=false;
			var cc = this.route;
			if (!start)
				start=0;
			for (var i=start;i<cc.length-1;i++) 
			{
				var a = cc[i];
				var c = cc[i+1];
				var b = point;
				var ac = Math.sqrt((a[0]-c[0])*(a[0]-c[0])+(a[1]-c[1])*(a[1]-c[1]));
				var ba = Math.sqrt((b[0]-a[0])*(b[0]-a[0])+(b[1]-a[1])*(b[1]-a[1]));
				var bc = Math.sqrt((b[0]-c[0])*(b[0]-c[0])+(b[1]-c[1])*(b[1]-c[1]));
				
				var minx = a[0] < b[0] ? a[0] : b[0];
				var miny = a[1] < b[1] ? a[1] : b[1];
				var maxx = a[0] > b[0] ? a[0] : b[0];
				var maxy = a[1] > b[1] ? a[1] : b[1];
				// ba > ac OR bc > ac
				if (b[0] < minx || b[0] > maxx || b[1] < miny || b[1] > maxy || ba > ac || bc > ac) 
				{
					res+=WGS84SPHERE.haversineDistance(a,c);
					continue;
				}
				res+=WGS84SPHERE.haversineDistance(a,b);
				break;
			}
			var len = this.getTrackLength();
			return res/len;
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
				if (!GUI.getIsSkipExtent()) {
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
},{"./Config":7,"./Participant":14,"./Utils":18,"joose":20,"rbush":21}],18:[function(require,module,exports){
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

},{"buffer":1}],19:[function(require,module,exports){
require('joose');
var Utils = require('./../app/Utils');
Class("StreamData",
{
    has:
    {
        isStopped : {
            is:   "rw",
            init : false	
        }
    },
    //--------------------------------------
    methods:
    {
        start : function(track,checker,pingInterval,callBackFnc)
        {
            var url = "http://liveortung.de/triathlon/rest/stream"; 
        	for (var i in track.participants) 
        	{
        		var part = track.participants[i];
        		part.__startTime = (new Date()).getTime() - 10*60*1000; 	// 10 minutes before;
        	}
        	//-------------------------------------------------------------------------        	
        	function doTick() 
        	{
        		if (this.isStopped)
        			return;
        		if (checker && !checker()) {
                    setTimeout(doTick,pingInterval*1000);
        			return;
        		}
                var json=[];
                var ctime = (new Date()).getTime();
                var mmap = {};
                for (var i in track.participants) 
                {
                	var pp = track.participants[i];
                	json.push({to : ctime,from : pp.__startTime,IMEI : pp.deviceId});
                	//console.log(pp.deviceId+" | "+new Date(pp.__startTime)+" > "+new Date(ctime));
                	//json.push({to : 900719925474099,from : 0,IMEI : pp.deviceId});
                	mmap[pp.deviceId]=pp;
                }
                function processData(data) 
                {
                	console.log("Process data size = "+data.length);
                	for (var i in data) 
                	{
                		var e = data[i];
                		//console.log("PROCESS : "+JSON.stringify(e));
                        var ctime = parseInt(e.EPOCH);
                        if (!ctime)
                             continue;
                		var part = mmap[e.IMEI];
                		if (!part) {
                			console.log("WRONG IMEI in StreamData.js : "+e.IMEI);
                			continue;
                		} else {
                			var ns = ctime+1;
                			if (part.__startTime < ns)
                				part.__startTime=ns;
                		}
                        delete e._id;
                        delete e.TS;
                        e.LON=parseInt(e.LON);
                        e.LAT=parseInt(e.LAT);
                        if (isNaN(e.LON) || isNaN(e.LAT))
                                continue;
                        if (e.ALT)
                                e.ALT=parseFloat(e.ALT);
                        if (e.TIME)
                                e.TIME=parseFloat(e.TIME);
                        if (e.HRT)
                                e.HRT=parseInt(e.HRT);
                        /*if (e.LON == 0 && e.LAT == 0)
                                continue;*/
                        //----------------------------------
                        var c = [e.LON / 1000000.0,e.LAT / 1000000.0];
                        part.ping(c,e.HRT,false/*SOS*/,ctime,e.ALT,0/*overall rank*/,0/*groupRank*/,0/*genderRank*/);
                        console.log(" >>> "+part.code+" | "+(Math.round(part.getElapsed()*100.0*100.0)/100.0)+"%"+" | PING AT POS "+c[0]+" | "+c[1]+" | "+Utils.formatDateTimeSec(new Date(ctime))) ;
                	}
                }
                //console.log(json);
                callBackFnc(url,json,processData);
                setTimeout(doTick,pingInterval*1000);
        	}
        	doTick();
        }
    }    
});



},{"./../app/Utils":18,"joose":20}],20:[function(require,module,exports){
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

},{"_process":5}],21:[function(require,module,exports){
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

},{}]},{},[11])
//# sourceMappingURL=data:application/json;charset:utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL0FwcERhdGEvUm9hbWluZy9ucG0vbm9kZV9tb2R1bGVzL2Jyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2Jyb3dzZXItcGFjay9fcHJlbHVkZS5qcyIsIi4uLy4uL0FwcERhdGEvUm9hbWluZy9ucG0vbm9kZV9tb2R1bGVzL2Jyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2J1ZmZlci9pbmRleC5qcyIsIi4uLy4uL0FwcERhdGEvUm9hbWluZy9ucG0vbm9kZV9tb2R1bGVzL2Jyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2J1ZmZlci9ub2RlX21vZHVsZXMvYmFzZTY0LWpzL2xpYi9iNjQuanMiLCIuLi8uLi9BcHBEYXRhL1JvYW1pbmcvbnBtL25vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9idWZmZXIvbm9kZV9tb2R1bGVzL2llZWU3NTQvaW5kZXguanMiLCIuLi8uLi9BcHBEYXRhL1JvYW1pbmcvbnBtL25vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9idWZmZXIvbm9kZV9tb2R1bGVzL2lzLWFycmF5L2luZGV4LmpzIiwiLi4vLi4vQXBwRGF0YS9Sb2FtaW5nL25wbS9ub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvcHJvY2Vzcy9icm93c2VyLmpzIiwianMvYXBwL0JhY2tlbmRTdHJlYW0uanMiLCJqcy9hcHAvQ29uZmlnLmpzIiwianMvYXBwL0RlbW9TaW11bGF0aW9uLmpzIiwianMvYXBwL0d1aS5qcyIsImpzL2FwcC9Ib3RTcG90LmpzIiwianMvYXBwL0luZGV4LmpzIiwianMvYXBwL0xpdmVTdHJlYW0uanMiLCJqcy9hcHAvTW92aW5nQ2FtLmpzIiwianMvYXBwL1BhcnRpY2lwYW50LmpzIiwianMvYXBwL1BvaW50LmpzIiwianMvYXBwL1N0eWxlcy5qcyIsImpzL2FwcC9UcmFjay5qcyIsImpzL2FwcC9VdGlscy5qcyIsImpzL25vZGVqcy9TdHJlYW1EYXRhLmpzIiwibm9kZV9tb2R1bGVzL2pvb3NlL2pvb3NlLWFsbC5qcyIsIm5vZGVfbW9kdWxlcy9yYnVzaC9yYnVzaC5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTtBQ0FBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzc1Q0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM1SEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDcEZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2pDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMxRkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzNHQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNsSEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3pDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2xqQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbkRBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbmNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDNUhBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1pBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbHZCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN2Q0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDMWdCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7OztBQ2xiQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7O0FDOWpCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7QUMzRkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7OztBQ2pwR0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EiLCJmaWxlIjoiZ2VuZXJhdGVkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXNDb250ZW50IjpbIihmdW5jdGlvbiBlKHQsbixyKXtmdW5jdGlvbiBzKG8sdSl7aWYoIW5bb10pe2lmKCF0W29dKXt2YXIgYT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2lmKCF1JiZhKXJldHVybiBhKG8sITApO2lmKGkpcmV0dXJuIGkobywhMCk7dmFyIGY9bmV3IEVycm9yKFwiQ2Fubm90IGZpbmQgbW9kdWxlICdcIitvK1wiJ1wiKTt0aHJvdyBmLmNvZGU9XCJNT0RVTEVfTk9UX0ZPVU5EXCIsZn12YXIgbD1uW29dPXtleHBvcnRzOnt9fTt0W29dWzBdLmNhbGwobC5leHBvcnRzLGZ1bmN0aW9uKGUpe3ZhciBuPXRbb11bMV1bZV07cmV0dXJuIHMobj9uOmUpfSxsLGwuZXhwb3J0cyxlLHQsbixyKX1yZXR1cm4gbltvXS5leHBvcnRzfXZhciBpPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7Zm9yKHZhciBvPTA7bzxyLmxlbmd0aDtvKyspcyhyW29dKTtyZXR1cm4gc30pIiwiLyohXG4gKiBUaGUgYnVmZmVyIG1vZHVsZSBmcm9tIG5vZGUuanMsIGZvciB0aGUgYnJvd3Nlci5cbiAqXG4gKiBAYXV0aG9yICAgRmVyb3NzIEFib3VraGFkaWplaCA8ZmVyb3NzQGZlcm9zcy5vcmc+IDxodHRwOi8vZmVyb3NzLm9yZz5cbiAqIEBsaWNlbnNlICBNSVRcbiAqL1xuXG52YXIgYmFzZTY0ID0gcmVxdWlyZSgnYmFzZTY0LWpzJylcbnZhciBpZWVlNzU0ID0gcmVxdWlyZSgnaWVlZTc1NCcpXG52YXIgaXNBcnJheSA9IHJlcXVpcmUoJ2lzLWFycmF5JylcblxuZXhwb3J0cy5CdWZmZXIgPSBCdWZmZXJcbmV4cG9ydHMuU2xvd0J1ZmZlciA9IFNsb3dCdWZmZXJcbmV4cG9ydHMuSU5TUEVDVF9NQVhfQllURVMgPSA1MFxuQnVmZmVyLnBvb2xTaXplID0gODE5MiAvLyBub3QgdXNlZCBieSB0aGlzIGltcGxlbWVudGF0aW9uXG5cbnZhciByb290UGFyZW50ID0ge31cblxuLyoqXG4gKiBJZiBgQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlRgOlxuICogICA9PT0gdHJ1ZSAgICBVc2UgVWludDhBcnJheSBpbXBsZW1lbnRhdGlvbiAoZmFzdGVzdClcbiAqICAgPT09IGZhbHNlICAgVXNlIE9iamVjdCBpbXBsZW1lbnRhdGlvbiAobW9zdCBjb21wYXRpYmxlLCBldmVuIElFNilcbiAqXG4gKiBCcm93c2VycyB0aGF0IHN1cHBvcnQgdHlwZWQgYXJyYXlzIGFyZSBJRSAxMCssIEZpcmVmb3ggNCssIENocm9tZSA3KywgU2FmYXJpIDUuMSssXG4gKiBPcGVyYSAxMS42KywgaU9TIDQuMisuXG4gKlxuICogTm90ZTpcbiAqXG4gKiAtIEltcGxlbWVudGF0aW9uIG11c3Qgc3VwcG9ydCBhZGRpbmcgbmV3IHByb3BlcnRpZXMgdG8gYFVpbnQ4QXJyYXlgIGluc3RhbmNlcy5cbiAqICAgRmlyZWZveCA0LTI5IGxhY2tlZCBzdXBwb3J0LCBmaXhlZCBpbiBGaXJlZm94IDMwKy5cbiAqICAgU2VlOiBodHRwczovL2J1Z3ppbGxhLm1vemlsbGEub3JnL3Nob3dfYnVnLmNnaT9pZD02OTU0MzguXG4gKlxuICogIC0gQ2hyb21lIDktMTAgaXMgbWlzc2luZyB0aGUgYFR5cGVkQXJyYXkucHJvdG90eXBlLnN1YmFycmF5YCBmdW5jdGlvbi5cbiAqXG4gKiAgLSBJRTEwIGhhcyBhIGJyb2tlbiBgVHlwZWRBcnJheS5wcm90b3R5cGUuc3ViYXJyYXlgIGZ1bmN0aW9uIHdoaWNoIHJldHVybnMgYXJyYXlzIG9mXG4gKiAgICBpbmNvcnJlY3QgbGVuZ3RoIGluIHNvbWUgc2l0dWF0aW9ucy5cbiAqXG4gKiBXZSBkZXRlY3QgdGhlc2UgYnVnZ3kgYnJvd3NlcnMgYW5kIHNldCBgQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlRgIHRvIGBmYWxzZWAgc28gdGhleSB3aWxsXG4gKiBnZXQgdGhlIE9iamVjdCBpbXBsZW1lbnRhdGlvbiwgd2hpY2ggaXMgc2xvd2VyIGJ1dCB3aWxsIHdvcmsgY29ycmVjdGx5LlxuICovXG5CdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCA9IChmdW5jdGlvbiAoKSB7XG4gIGZ1bmN0aW9uIEZvbyAoKSB7fVxuICB0cnkge1xuICAgIHZhciBidWYgPSBuZXcgQXJyYXlCdWZmZXIoMClcbiAgICB2YXIgYXJyID0gbmV3IFVpbnQ4QXJyYXkoYnVmKVxuICAgIGFyci5mb28gPSBmdW5jdGlvbiAoKSB7IHJldHVybiA0MiB9XG4gICAgYXJyLmNvbnN0cnVjdG9yID0gRm9vXG4gICAgcmV0dXJuIGFyci5mb28oKSA9PT0gNDIgJiYgLy8gdHlwZWQgYXJyYXkgaW5zdGFuY2VzIGNhbiBiZSBhdWdtZW50ZWRcbiAgICAgICAgYXJyLmNvbnN0cnVjdG9yID09PSBGb28gJiYgLy8gY29uc3RydWN0b3IgY2FuIGJlIHNldFxuICAgICAgICB0eXBlb2YgYXJyLnN1YmFycmF5ID09PSAnZnVuY3Rpb24nICYmIC8vIGNocm9tZSA5LTEwIGxhY2sgYHN1YmFycmF5YFxuICAgICAgICBuZXcgVWludDhBcnJheSgxKS5zdWJhcnJheSgxLCAxKS5ieXRlTGVuZ3RoID09PSAwIC8vIGllMTAgaGFzIGJyb2tlbiBgc3ViYXJyYXlgXG4gIH0gY2F0Y2ggKGUpIHtcbiAgICByZXR1cm4gZmFsc2VcbiAgfVxufSkoKVxuXG5mdW5jdGlvbiBrTWF4TGVuZ3RoICgpIHtcbiAgcmV0dXJuIEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUXG4gICAgPyAweDdmZmZmZmZmXG4gICAgOiAweDNmZmZmZmZmXG59XG5cbi8qKlxuICogQ2xhc3M6IEJ1ZmZlclxuICogPT09PT09PT09PT09PVxuICpcbiAqIFRoZSBCdWZmZXIgY29uc3RydWN0b3IgcmV0dXJucyBpbnN0YW5jZXMgb2YgYFVpbnQ4QXJyYXlgIHRoYXQgYXJlIGF1Z21lbnRlZFxuICogd2l0aCBmdW5jdGlvbiBwcm9wZXJ0aWVzIGZvciBhbGwgdGhlIG5vZGUgYEJ1ZmZlcmAgQVBJIGZ1bmN0aW9ucy4gV2UgdXNlXG4gKiBgVWludDhBcnJheWAgc28gdGhhdCBzcXVhcmUgYnJhY2tldCBub3RhdGlvbiB3b3JrcyBhcyBleHBlY3RlZCAtLSBpdCByZXR1cm5zXG4gKiBhIHNpbmdsZSBvY3RldC5cbiAqXG4gKiBCeSBhdWdtZW50aW5nIHRoZSBpbnN0YW5jZXMsIHdlIGNhbiBhdm9pZCBtb2RpZnlpbmcgdGhlIGBVaW50OEFycmF5YFxuICogcHJvdG90eXBlLlxuICovXG5mdW5jdGlvbiBCdWZmZXIgKGFyZykge1xuICBpZiAoISh0aGlzIGluc3RhbmNlb2YgQnVmZmVyKSkge1xuICAgIC8vIEF2b2lkIGdvaW5nIHRocm91Z2ggYW4gQXJndW1lbnRzQWRhcHRvclRyYW1wb2xpbmUgaW4gdGhlIGNvbW1vbiBjYXNlLlxuICAgIGlmIChhcmd1bWVudHMubGVuZ3RoID4gMSkgcmV0dXJuIG5ldyBCdWZmZXIoYXJnLCBhcmd1bWVudHNbMV0pXG4gICAgcmV0dXJuIG5ldyBCdWZmZXIoYXJnKVxuICB9XG5cbiAgdGhpcy5sZW5ndGggPSAwXG4gIHRoaXMucGFyZW50ID0gdW5kZWZpbmVkXG5cbiAgLy8gQ29tbW9uIGNhc2UuXG4gIGlmICh0eXBlb2YgYXJnID09PSAnbnVtYmVyJykge1xuICAgIHJldHVybiBmcm9tTnVtYmVyKHRoaXMsIGFyZylcbiAgfVxuXG4gIC8vIFNsaWdodGx5IGxlc3MgY29tbW9uIGNhc2UuXG4gIGlmICh0eXBlb2YgYXJnID09PSAnc3RyaW5nJykge1xuICAgIHJldHVybiBmcm9tU3RyaW5nKHRoaXMsIGFyZywgYXJndW1lbnRzLmxlbmd0aCA+IDEgPyBhcmd1bWVudHNbMV0gOiAndXRmOCcpXG4gIH1cblxuICAvLyBVbnVzdWFsLlxuICByZXR1cm4gZnJvbU9iamVjdCh0aGlzLCBhcmcpXG59XG5cbmZ1bmN0aW9uIGZyb21OdW1iZXIgKHRoYXQsIGxlbmd0aCkge1xuICB0aGF0ID0gYWxsb2NhdGUodGhhdCwgbGVuZ3RoIDwgMCA/IDAgOiBjaGVja2VkKGxlbmd0aCkgfCAwKVxuICBpZiAoIUJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW5ndGg7IGkrKykge1xuICAgICAgdGhhdFtpXSA9IDBcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHRoYXRcbn1cblxuZnVuY3Rpb24gZnJvbVN0cmluZyAodGhhdCwgc3RyaW5nLCBlbmNvZGluZykge1xuICBpZiAodHlwZW9mIGVuY29kaW5nICE9PSAnc3RyaW5nJyB8fCBlbmNvZGluZyA9PT0gJycpIGVuY29kaW5nID0gJ3V0ZjgnXG5cbiAgLy8gQXNzdW1wdGlvbjogYnl0ZUxlbmd0aCgpIHJldHVybiB2YWx1ZSBpcyBhbHdheXMgPCBrTWF4TGVuZ3RoLlxuICB2YXIgbGVuZ3RoID0gYnl0ZUxlbmd0aChzdHJpbmcsIGVuY29kaW5nKSB8IDBcbiAgdGhhdCA9IGFsbG9jYXRlKHRoYXQsIGxlbmd0aClcblxuICB0aGF0LndyaXRlKHN0cmluZywgZW5jb2RpbmcpXG4gIHJldHVybiB0aGF0XG59XG5cbmZ1bmN0aW9uIGZyb21PYmplY3QgKHRoYXQsIG9iamVjdCkge1xuICBpZiAoQnVmZmVyLmlzQnVmZmVyKG9iamVjdCkpIHJldHVybiBmcm9tQnVmZmVyKHRoYXQsIG9iamVjdClcblxuICBpZiAoaXNBcnJheShvYmplY3QpKSByZXR1cm4gZnJvbUFycmF5KHRoYXQsIG9iamVjdClcblxuICBpZiAob2JqZWN0ID09IG51bGwpIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdtdXN0IHN0YXJ0IHdpdGggbnVtYmVyLCBidWZmZXIsIGFycmF5IG9yIHN0cmluZycpXG4gIH1cblxuICBpZiAodHlwZW9mIEFycmF5QnVmZmVyICE9PSAndW5kZWZpbmVkJyAmJiBvYmplY3QuYnVmZmVyIGluc3RhbmNlb2YgQXJyYXlCdWZmZXIpIHtcbiAgICByZXR1cm4gZnJvbVR5cGVkQXJyYXkodGhhdCwgb2JqZWN0KVxuICB9XG5cbiAgaWYgKG9iamVjdC5sZW5ndGgpIHJldHVybiBmcm9tQXJyYXlMaWtlKHRoYXQsIG9iamVjdClcblxuICByZXR1cm4gZnJvbUpzb25PYmplY3QodGhhdCwgb2JqZWN0KVxufVxuXG5mdW5jdGlvbiBmcm9tQnVmZmVyICh0aGF0LCBidWZmZXIpIHtcbiAgdmFyIGxlbmd0aCA9IGNoZWNrZWQoYnVmZmVyLmxlbmd0aCkgfCAwXG4gIHRoYXQgPSBhbGxvY2F0ZSh0aGF0LCBsZW5ndGgpXG4gIGJ1ZmZlci5jb3B5KHRoYXQsIDAsIDAsIGxlbmd0aClcbiAgcmV0dXJuIHRoYXRcbn1cblxuZnVuY3Rpb24gZnJvbUFycmF5ICh0aGF0LCBhcnJheSkge1xuICB2YXIgbGVuZ3RoID0gY2hlY2tlZChhcnJheS5sZW5ndGgpIHwgMFxuICB0aGF0ID0gYWxsb2NhdGUodGhhdCwgbGVuZ3RoKVxuICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbmd0aDsgaSArPSAxKSB7XG4gICAgdGhhdFtpXSA9IGFycmF5W2ldICYgMjU1XG4gIH1cbiAgcmV0dXJuIHRoYXRcbn1cblxuLy8gRHVwbGljYXRlIG9mIGZyb21BcnJheSgpIHRvIGtlZXAgZnJvbUFycmF5KCkgbW9ub21vcnBoaWMuXG5mdW5jdGlvbiBmcm9tVHlwZWRBcnJheSAodGhhdCwgYXJyYXkpIHtcbiAgdmFyIGxlbmd0aCA9IGNoZWNrZWQoYXJyYXkubGVuZ3RoKSB8IDBcbiAgdGhhdCA9IGFsbG9jYXRlKHRoYXQsIGxlbmd0aClcbiAgLy8gVHJ1bmNhdGluZyB0aGUgZWxlbWVudHMgaXMgcHJvYmFibHkgbm90IHdoYXQgcGVvcGxlIGV4cGVjdCBmcm9tIHR5cGVkXG4gIC8vIGFycmF5cyB3aXRoIEJZVEVTX1BFUl9FTEVNRU5UID4gMSBidXQgaXQncyBjb21wYXRpYmxlIHdpdGggdGhlIGJlaGF2aW9yXG4gIC8vIG9mIHRoZSBvbGQgQnVmZmVyIGNvbnN0cnVjdG9yLlxuICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbmd0aDsgaSArPSAxKSB7XG4gICAgdGhhdFtpXSA9IGFycmF5W2ldICYgMjU1XG4gIH1cbiAgcmV0dXJuIHRoYXRcbn1cblxuZnVuY3Rpb24gZnJvbUFycmF5TGlrZSAodGhhdCwgYXJyYXkpIHtcbiAgdmFyIGxlbmd0aCA9IGNoZWNrZWQoYXJyYXkubGVuZ3RoKSB8IDBcbiAgdGhhdCA9IGFsbG9jYXRlKHRoYXQsIGxlbmd0aClcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW5ndGg7IGkgKz0gMSkge1xuICAgIHRoYXRbaV0gPSBhcnJheVtpXSAmIDI1NVxuICB9XG4gIHJldHVybiB0aGF0XG59XG5cbi8vIERlc2VyaWFsaXplIHsgdHlwZTogJ0J1ZmZlcicsIGRhdGE6IFsxLDIsMywuLi5dIH0gaW50byBhIEJ1ZmZlciBvYmplY3QuXG4vLyBSZXR1cm5zIGEgemVyby1sZW5ndGggYnVmZmVyIGZvciBpbnB1dHMgdGhhdCBkb24ndCBjb25mb3JtIHRvIHRoZSBzcGVjLlxuZnVuY3Rpb24gZnJvbUpzb25PYmplY3QgKHRoYXQsIG9iamVjdCkge1xuICB2YXIgYXJyYXlcbiAgdmFyIGxlbmd0aCA9IDBcblxuICBpZiAob2JqZWN0LnR5cGUgPT09ICdCdWZmZXInICYmIGlzQXJyYXkob2JqZWN0LmRhdGEpKSB7XG4gICAgYXJyYXkgPSBvYmplY3QuZGF0YVxuICAgIGxlbmd0aCA9IGNoZWNrZWQoYXJyYXkubGVuZ3RoKSB8IDBcbiAgfVxuICB0aGF0ID0gYWxsb2NhdGUodGhhdCwgbGVuZ3RoKVxuXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuZ3RoOyBpICs9IDEpIHtcbiAgICB0aGF0W2ldID0gYXJyYXlbaV0gJiAyNTVcbiAgfVxuICByZXR1cm4gdGhhdFxufVxuXG5mdW5jdGlvbiBhbGxvY2F0ZSAodGhhdCwgbGVuZ3RoKSB7XG4gIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIC8vIFJldHVybiBhbiBhdWdtZW50ZWQgYFVpbnQ4QXJyYXlgIGluc3RhbmNlLCBmb3IgYmVzdCBwZXJmb3JtYW5jZVxuICAgIHRoYXQgPSBCdWZmZXIuX2F1Z21lbnQobmV3IFVpbnQ4QXJyYXkobGVuZ3RoKSlcbiAgfSBlbHNlIHtcbiAgICAvLyBGYWxsYmFjazogUmV0dXJuIGFuIG9iamVjdCBpbnN0YW5jZSBvZiB0aGUgQnVmZmVyIGNsYXNzXG4gICAgdGhhdC5sZW5ndGggPSBsZW5ndGhcbiAgICB0aGF0Ll9pc0J1ZmZlciA9IHRydWVcbiAgfVxuXG4gIHZhciBmcm9tUG9vbCA9IGxlbmd0aCAhPT0gMCAmJiBsZW5ndGggPD0gQnVmZmVyLnBvb2xTaXplID4+PiAxXG4gIGlmIChmcm9tUG9vbCkgdGhhdC5wYXJlbnQgPSByb290UGFyZW50XG5cbiAgcmV0dXJuIHRoYXRcbn1cblxuZnVuY3Rpb24gY2hlY2tlZCAobGVuZ3RoKSB7XG4gIC8vIE5vdGU6IGNhbm5vdCB1c2UgYGxlbmd0aCA8IGtNYXhMZW5ndGhgIGhlcmUgYmVjYXVzZSB0aGF0IGZhaWxzIHdoZW5cbiAgLy8gbGVuZ3RoIGlzIE5hTiAod2hpY2ggaXMgb3RoZXJ3aXNlIGNvZXJjZWQgdG8gemVyby4pXG4gIGlmIChsZW5ndGggPj0ga01heExlbmd0aCgpKSB7XG4gICAgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ0F0dGVtcHQgdG8gYWxsb2NhdGUgQnVmZmVyIGxhcmdlciB0aGFuIG1heGltdW0gJyArXG4gICAgICAgICAgICAgICAgICAgICAgICAgJ3NpemU6IDB4JyArIGtNYXhMZW5ndGgoKS50b1N0cmluZygxNikgKyAnIGJ5dGVzJylcbiAgfVxuICByZXR1cm4gbGVuZ3RoIHwgMFxufVxuXG5mdW5jdGlvbiBTbG93QnVmZmVyIChzdWJqZWN0LCBlbmNvZGluZykge1xuICBpZiAoISh0aGlzIGluc3RhbmNlb2YgU2xvd0J1ZmZlcikpIHJldHVybiBuZXcgU2xvd0J1ZmZlcihzdWJqZWN0LCBlbmNvZGluZylcblxuICB2YXIgYnVmID0gbmV3IEJ1ZmZlcihzdWJqZWN0LCBlbmNvZGluZylcbiAgZGVsZXRlIGJ1Zi5wYXJlbnRcbiAgcmV0dXJuIGJ1ZlxufVxuXG5CdWZmZXIuaXNCdWZmZXIgPSBmdW5jdGlvbiBpc0J1ZmZlciAoYikge1xuICByZXR1cm4gISEoYiAhPSBudWxsICYmIGIuX2lzQnVmZmVyKVxufVxuXG5CdWZmZXIuY29tcGFyZSA9IGZ1bmN0aW9uIGNvbXBhcmUgKGEsIGIpIHtcbiAgaWYgKCFCdWZmZXIuaXNCdWZmZXIoYSkgfHwgIUJ1ZmZlci5pc0J1ZmZlcihiKSkge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ0FyZ3VtZW50cyBtdXN0IGJlIEJ1ZmZlcnMnKVxuICB9XG5cbiAgaWYgKGEgPT09IGIpIHJldHVybiAwXG5cbiAgdmFyIHggPSBhLmxlbmd0aFxuICB2YXIgeSA9IGIubGVuZ3RoXG5cbiAgdmFyIGkgPSAwXG4gIHZhciBsZW4gPSBNYXRoLm1pbih4LCB5KVxuICB3aGlsZSAoaSA8IGxlbikge1xuICAgIGlmIChhW2ldICE9PSBiW2ldKSBicmVha1xuXG4gICAgKytpXG4gIH1cblxuICBpZiAoaSAhPT0gbGVuKSB7XG4gICAgeCA9IGFbaV1cbiAgICB5ID0gYltpXVxuICB9XG5cbiAgaWYgKHggPCB5KSByZXR1cm4gLTFcbiAgaWYgKHkgPCB4KSByZXR1cm4gMVxuICByZXR1cm4gMFxufVxuXG5CdWZmZXIuaXNFbmNvZGluZyA9IGZ1bmN0aW9uIGlzRW5jb2RpbmcgKGVuY29kaW5nKSB7XG4gIHN3aXRjaCAoU3RyaW5nKGVuY29kaW5nKS50b0xvd2VyQ2FzZSgpKSB7XG4gICAgY2FzZSAnaGV4JzpcbiAgICBjYXNlICd1dGY4JzpcbiAgICBjYXNlICd1dGYtOCc6XG4gICAgY2FzZSAnYXNjaWknOlxuICAgIGNhc2UgJ2JpbmFyeSc6XG4gICAgY2FzZSAnYmFzZTY0JzpcbiAgICBjYXNlICdyYXcnOlxuICAgIGNhc2UgJ3VjczInOlxuICAgIGNhc2UgJ3Vjcy0yJzpcbiAgICBjYXNlICd1dGYxNmxlJzpcbiAgICBjYXNlICd1dGYtMTZsZSc6XG4gICAgICByZXR1cm4gdHJ1ZVxuICAgIGRlZmF1bHQ6XG4gICAgICByZXR1cm4gZmFsc2VcbiAgfVxufVxuXG5CdWZmZXIuY29uY2F0ID0gZnVuY3Rpb24gY29uY2F0IChsaXN0LCBsZW5ndGgpIHtcbiAgaWYgKCFpc0FycmF5KGxpc3QpKSB0aHJvdyBuZXcgVHlwZUVycm9yKCdsaXN0IGFyZ3VtZW50IG11c3QgYmUgYW4gQXJyYXkgb2YgQnVmZmVycy4nKVxuXG4gIGlmIChsaXN0Lmxlbmd0aCA9PT0gMCkge1xuICAgIHJldHVybiBuZXcgQnVmZmVyKDApXG4gIH0gZWxzZSBpZiAobGlzdC5sZW5ndGggPT09IDEpIHtcbiAgICByZXR1cm4gbGlzdFswXVxuICB9XG5cbiAgdmFyIGlcbiAgaWYgKGxlbmd0aCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgbGVuZ3RoID0gMFxuICAgIGZvciAoaSA9IDA7IGkgPCBsaXN0Lmxlbmd0aDsgaSsrKSB7XG4gICAgICBsZW5ndGggKz0gbGlzdFtpXS5sZW5ndGhcbiAgICB9XG4gIH1cblxuICB2YXIgYnVmID0gbmV3IEJ1ZmZlcihsZW5ndGgpXG4gIHZhciBwb3MgPSAwXG4gIGZvciAoaSA9IDA7IGkgPCBsaXN0Lmxlbmd0aDsgaSsrKSB7XG4gICAgdmFyIGl0ZW0gPSBsaXN0W2ldXG4gICAgaXRlbS5jb3B5KGJ1ZiwgcG9zKVxuICAgIHBvcyArPSBpdGVtLmxlbmd0aFxuICB9XG4gIHJldHVybiBidWZcbn1cblxuZnVuY3Rpb24gYnl0ZUxlbmd0aCAoc3RyaW5nLCBlbmNvZGluZykge1xuICBpZiAodHlwZW9mIHN0cmluZyAhPT0gJ3N0cmluZycpIHN0cmluZyA9ICcnICsgc3RyaW5nXG5cbiAgdmFyIGxlbiA9IHN0cmluZy5sZW5ndGhcbiAgaWYgKGxlbiA9PT0gMCkgcmV0dXJuIDBcblxuICAvLyBVc2UgYSBmb3IgbG9vcCB0byBhdm9pZCByZWN1cnNpb25cbiAgdmFyIGxvd2VyZWRDYXNlID0gZmFsc2VcbiAgZm9yICg7Oykge1xuICAgIHN3aXRjaCAoZW5jb2RpbmcpIHtcbiAgICAgIGNhc2UgJ2FzY2lpJzpcbiAgICAgIGNhc2UgJ2JpbmFyeSc6XG4gICAgICAvLyBEZXByZWNhdGVkXG4gICAgICBjYXNlICdyYXcnOlxuICAgICAgY2FzZSAncmF3cyc6XG4gICAgICAgIHJldHVybiBsZW5cbiAgICAgIGNhc2UgJ3V0ZjgnOlxuICAgICAgY2FzZSAndXRmLTgnOlxuICAgICAgICByZXR1cm4gdXRmOFRvQnl0ZXMoc3RyaW5nKS5sZW5ndGhcbiAgICAgIGNhc2UgJ3VjczInOlxuICAgICAgY2FzZSAndWNzLTInOlxuICAgICAgY2FzZSAndXRmMTZsZSc6XG4gICAgICBjYXNlICd1dGYtMTZsZSc6XG4gICAgICAgIHJldHVybiBsZW4gKiAyXG4gICAgICBjYXNlICdoZXgnOlxuICAgICAgICByZXR1cm4gbGVuID4+PiAxXG4gICAgICBjYXNlICdiYXNlNjQnOlxuICAgICAgICByZXR1cm4gYmFzZTY0VG9CeXRlcyhzdHJpbmcpLmxlbmd0aFxuICAgICAgZGVmYXVsdDpcbiAgICAgICAgaWYgKGxvd2VyZWRDYXNlKSByZXR1cm4gdXRmOFRvQnl0ZXMoc3RyaW5nKS5sZW5ndGggLy8gYXNzdW1lIHV0ZjhcbiAgICAgICAgZW5jb2RpbmcgPSAoJycgKyBlbmNvZGluZykudG9Mb3dlckNhc2UoKVxuICAgICAgICBsb3dlcmVkQ2FzZSA9IHRydWVcbiAgICB9XG4gIH1cbn1cbkJ1ZmZlci5ieXRlTGVuZ3RoID0gYnl0ZUxlbmd0aFxuXG4vLyBwcmUtc2V0IGZvciB2YWx1ZXMgdGhhdCBtYXkgZXhpc3QgaW4gdGhlIGZ1dHVyZVxuQnVmZmVyLnByb3RvdHlwZS5sZW5ndGggPSB1bmRlZmluZWRcbkJ1ZmZlci5wcm90b3R5cGUucGFyZW50ID0gdW5kZWZpbmVkXG5cbmZ1bmN0aW9uIHNsb3dUb1N0cmluZyAoZW5jb2RpbmcsIHN0YXJ0LCBlbmQpIHtcbiAgdmFyIGxvd2VyZWRDYXNlID0gZmFsc2VcblxuICBzdGFydCA9IHN0YXJ0IHwgMFxuICBlbmQgPSBlbmQgPT09IHVuZGVmaW5lZCB8fCBlbmQgPT09IEluZmluaXR5ID8gdGhpcy5sZW5ndGggOiBlbmQgfCAwXG5cbiAgaWYgKCFlbmNvZGluZykgZW5jb2RpbmcgPSAndXRmOCdcbiAgaWYgKHN0YXJ0IDwgMCkgc3RhcnQgPSAwXG4gIGlmIChlbmQgPiB0aGlzLmxlbmd0aCkgZW5kID0gdGhpcy5sZW5ndGhcbiAgaWYgKGVuZCA8PSBzdGFydCkgcmV0dXJuICcnXG5cbiAgd2hpbGUgKHRydWUpIHtcbiAgICBzd2l0Y2ggKGVuY29kaW5nKSB7XG4gICAgICBjYXNlICdoZXgnOlxuICAgICAgICByZXR1cm4gaGV4U2xpY2UodGhpcywgc3RhcnQsIGVuZClcblxuICAgICAgY2FzZSAndXRmOCc6XG4gICAgICBjYXNlICd1dGYtOCc6XG4gICAgICAgIHJldHVybiB1dGY4U2xpY2UodGhpcywgc3RhcnQsIGVuZClcblxuICAgICAgY2FzZSAnYXNjaWknOlxuICAgICAgICByZXR1cm4gYXNjaWlTbGljZSh0aGlzLCBzdGFydCwgZW5kKVxuXG4gICAgICBjYXNlICdiaW5hcnknOlxuICAgICAgICByZXR1cm4gYmluYXJ5U2xpY2UodGhpcywgc3RhcnQsIGVuZClcblxuICAgICAgY2FzZSAnYmFzZTY0JzpcbiAgICAgICAgcmV0dXJuIGJhc2U2NFNsaWNlKHRoaXMsIHN0YXJ0LCBlbmQpXG5cbiAgICAgIGNhc2UgJ3VjczInOlxuICAgICAgY2FzZSAndWNzLTInOlxuICAgICAgY2FzZSAndXRmMTZsZSc6XG4gICAgICBjYXNlICd1dGYtMTZsZSc6XG4gICAgICAgIHJldHVybiB1dGYxNmxlU2xpY2UodGhpcywgc3RhcnQsIGVuZClcblxuICAgICAgZGVmYXVsdDpcbiAgICAgICAgaWYgKGxvd2VyZWRDYXNlKSB0aHJvdyBuZXcgVHlwZUVycm9yKCdVbmtub3duIGVuY29kaW5nOiAnICsgZW5jb2RpbmcpXG4gICAgICAgIGVuY29kaW5nID0gKGVuY29kaW5nICsgJycpLnRvTG93ZXJDYXNlKClcbiAgICAgICAgbG93ZXJlZENhc2UgPSB0cnVlXG4gICAgfVxuICB9XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUudG9TdHJpbmcgPSBmdW5jdGlvbiB0b1N0cmluZyAoKSB7XG4gIHZhciBsZW5ndGggPSB0aGlzLmxlbmd0aCB8IDBcbiAgaWYgKGxlbmd0aCA9PT0gMCkgcmV0dXJuICcnXG4gIGlmIChhcmd1bWVudHMubGVuZ3RoID09PSAwKSByZXR1cm4gdXRmOFNsaWNlKHRoaXMsIDAsIGxlbmd0aClcbiAgcmV0dXJuIHNsb3dUb1N0cmluZy5hcHBseSh0aGlzLCBhcmd1bWVudHMpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUuZXF1YWxzID0gZnVuY3Rpb24gZXF1YWxzIChiKSB7XG4gIGlmICghQnVmZmVyLmlzQnVmZmVyKGIpKSB0aHJvdyBuZXcgVHlwZUVycm9yKCdBcmd1bWVudCBtdXN0IGJlIGEgQnVmZmVyJylcbiAgaWYgKHRoaXMgPT09IGIpIHJldHVybiB0cnVlXG4gIHJldHVybiBCdWZmZXIuY29tcGFyZSh0aGlzLCBiKSA9PT0gMFxufVxuXG5CdWZmZXIucHJvdG90eXBlLmluc3BlY3QgPSBmdW5jdGlvbiBpbnNwZWN0ICgpIHtcbiAgdmFyIHN0ciA9ICcnXG4gIHZhciBtYXggPSBleHBvcnRzLklOU1BFQ1RfTUFYX0JZVEVTXG4gIGlmICh0aGlzLmxlbmd0aCA+IDApIHtcbiAgICBzdHIgPSB0aGlzLnRvU3RyaW5nKCdoZXgnLCAwLCBtYXgpLm1hdGNoKC8uezJ9L2cpLmpvaW4oJyAnKVxuICAgIGlmICh0aGlzLmxlbmd0aCA+IG1heCkgc3RyICs9ICcgLi4uICdcbiAgfVxuICByZXR1cm4gJzxCdWZmZXIgJyArIHN0ciArICc+J1xufVxuXG5CdWZmZXIucHJvdG90eXBlLmNvbXBhcmUgPSBmdW5jdGlvbiBjb21wYXJlIChiKSB7XG4gIGlmICghQnVmZmVyLmlzQnVmZmVyKGIpKSB0aHJvdyBuZXcgVHlwZUVycm9yKCdBcmd1bWVudCBtdXN0IGJlIGEgQnVmZmVyJylcbiAgaWYgKHRoaXMgPT09IGIpIHJldHVybiAwXG4gIHJldHVybiBCdWZmZXIuY29tcGFyZSh0aGlzLCBiKVxufVxuXG5CdWZmZXIucHJvdG90eXBlLmluZGV4T2YgPSBmdW5jdGlvbiBpbmRleE9mICh2YWwsIGJ5dGVPZmZzZXQpIHtcbiAgaWYgKGJ5dGVPZmZzZXQgPiAweDdmZmZmZmZmKSBieXRlT2Zmc2V0ID0gMHg3ZmZmZmZmZlxuICBlbHNlIGlmIChieXRlT2Zmc2V0IDwgLTB4ODAwMDAwMDApIGJ5dGVPZmZzZXQgPSAtMHg4MDAwMDAwMFxuICBieXRlT2Zmc2V0ID4+PSAwXG5cbiAgaWYgKHRoaXMubGVuZ3RoID09PSAwKSByZXR1cm4gLTFcbiAgaWYgKGJ5dGVPZmZzZXQgPj0gdGhpcy5sZW5ndGgpIHJldHVybiAtMVxuXG4gIC8vIE5lZ2F0aXZlIG9mZnNldHMgc3RhcnQgZnJvbSB0aGUgZW5kIG9mIHRoZSBidWZmZXJcbiAgaWYgKGJ5dGVPZmZzZXQgPCAwKSBieXRlT2Zmc2V0ID0gTWF0aC5tYXgodGhpcy5sZW5ndGggKyBieXRlT2Zmc2V0LCAwKVxuXG4gIGlmICh0eXBlb2YgdmFsID09PSAnc3RyaW5nJykge1xuICAgIGlmICh2YWwubGVuZ3RoID09PSAwKSByZXR1cm4gLTEgLy8gc3BlY2lhbCBjYXNlOiBsb29raW5nIGZvciBlbXB0eSBzdHJpbmcgYWx3YXlzIGZhaWxzXG4gICAgcmV0dXJuIFN0cmluZy5wcm90b3R5cGUuaW5kZXhPZi5jYWxsKHRoaXMsIHZhbCwgYnl0ZU9mZnNldClcbiAgfVxuICBpZiAoQnVmZmVyLmlzQnVmZmVyKHZhbCkpIHtcbiAgICByZXR1cm4gYXJyYXlJbmRleE9mKHRoaXMsIHZhbCwgYnl0ZU9mZnNldClcbiAgfVxuICBpZiAodHlwZW9mIHZhbCA9PT0gJ251bWJlcicpIHtcbiAgICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQgJiYgVWludDhBcnJheS5wcm90b3R5cGUuaW5kZXhPZiA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgcmV0dXJuIFVpbnQ4QXJyYXkucHJvdG90eXBlLmluZGV4T2YuY2FsbCh0aGlzLCB2YWwsIGJ5dGVPZmZzZXQpXG4gICAgfVxuICAgIHJldHVybiBhcnJheUluZGV4T2YodGhpcywgWyB2YWwgXSwgYnl0ZU9mZnNldClcbiAgfVxuXG4gIGZ1bmN0aW9uIGFycmF5SW5kZXhPZiAoYXJyLCB2YWwsIGJ5dGVPZmZzZXQpIHtcbiAgICB2YXIgZm91bmRJbmRleCA9IC0xXG4gICAgZm9yICh2YXIgaSA9IDA7IGJ5dGVPZmZzZXQgKyBpIDwgYXJyLmxlbmd0aDsgaSsrKSB7XG4gICAgICBpZiAoYXJyW2J5dGVPZmZzZXQgKyBpXSA9PT0gdmFsW2ZvdW5kSW5kZXggPT09IC0xID8gMCA6IGkgLSBmb3VuZEluZGV4XSkge1xuICAgICAgICBpZiAoZm91bmRJbmRleCA9PT0gLTEpIGZvdW5kSW5kZXggPSBpXG4gICAgICAgIGlmIChpIC0gZm91bmRJbmRleCArIDEgPT09IHZhbC5sZW5ndGgpIHJldHVybiBieXRlT2Zmc2V0ICsgZm91bmRJbmRleFxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgZm91bmRJbmRleCA9IC0xXG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiAtMVxuICB9XG5cbiAgdGhyb3cgbmV3IFR5cGVFcnJvcigndmFsIG11c3QgYmUgc3RyaW5nLCBudW1iZXIgb3IgQnVmZmVyJylcbn1cblxuLy8gYGdldGAgd2lsbCBiZSByZW1vdmVkIGluIE5vZGUgMC4xMytcbkJ1ZmZlci5wcm90b3R5cGUuZ2V0ID0gZnVuY3Rpb24gZ2V0IChvZmZzZXQpIHtcbiAgY29uc29sZS5sb2coJy5nZXQoKSBpcyBkZXByZWNhdGVkLiBBY2Nlc3MgdXNpbmcgYXJyYXkgaW5kZXhlcyBpbnN0ZWFkLicpXG4gIHJldHVybiB0aGlzLnJlYWRVSW50OChvZmZzZXQpXG59XG5cbi8vIGBzZXRgIHdpbGwgYmUgcmVtb3ZlZCBpbiBOb2RlIDAuMTMrXG5CdWZmZXIucHJvdG90eXBlLnNldCA9IGZ1bmN0aW9uIHNldCAodiwgb2Zmc2V0KSB7XG4gIGNvbnNvbGUubG9nKCcuc2V0KCkgaXMgZGVwcmVjYXRlZC4gQWNjZXNzIHVzaW5nIGFycmF5IGluZGV4ZXMgaW5zdGVhZC4nKVxuICByZXR1cm4gdGhpcy53cml0ZVVJbnQ4KHYsIG9mZnNldClcbn1cblxuZnVuY3Rpb24gaGV4V3JpdGUgKGJ1Ziwgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCkge1xuICBvZmZzZXQgPSBOdW1iZXIob2Zmc2V0KSB8fCAwXG4gIHZhciByZW1haW5pbmcgPSBidWYubGVuZ3RoIC0gb2Zmc2V0XG4gIGlmICghbGVuZ3RoKSB7XG4gICAgbGVuZ3RoID0gcmVtYWluaW5nXG4gIH0gZWxzZSB7XG4gICAgbGVuZ3RoID0gTnVtYmVyKGxlbmd0aClcbiAgICBpZiAobGVuZ3RoID4gcmVtYWluaW5nKSB7XG4gICAgICBsZW5ndGggPSByZW1haW5pbmdcbiAgICB9XG4gIH1cblxuICAvLyBtdXN0IGJlIGFuIGV2ZW4gbnVtYmVyIG9mIGRpZ2l0c1xuICB2YXIgc3RyTGVuID0gc3RyaW5nLmxlbmd0aFxuICBpZiAoc3RyTGVuICUgMiAhPT0gMCkgdGhyb3cgbmV3IEVycm9yKCdJbnZhbGlkIGhleCBzdHJpbmcnKVxuXG4gIGlmIChsZW5ndGggPiBzdHJMZW4gLyAyKSB7XG4gICAgbGVuZ3RoID0gc3RyTGVuIC8gMlxuICB9XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuZ3RoOyBpKyspIHtcbiAgICB2YXIgcGFyc2VkID0gcGFyc2VJbnQoc3RyaW5nLnN1YnN0cihpICogMiwgMiksIDE2KVxuICAgIGlmIChpc05hTihwYXJzZWQpKSB0aHJvdyBuZXcgRXJyb3IoJ0ludmFsaWQgaGV4IHN0cmluZycpXG4gICAgYnVmW29mZnNldCArIGldID0gcGFyc2VkXG4gIH1cbiAgcmV0dXJuIGlcbn1cblxuZnVuY3Rpb24gdXRmOFdyaXRlIChidWYsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpIHtcbiAgcmV0dXJuIGJsaXRCdWZmZXIodXRmOFRvQnl0ZXMoc3RyaW5nLCBidWYubGVuZ3RoIC0gb2Zmc2V0KSwgYnVmLCBvZmZzZXQsIGxlbmd0aClcbn1cblxuZnVuY3Rpb24gYXNjaWlXcml0ZSAoYnVmLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKSB7XG4gIHJldHVybiBibGl0QnVmZmVyKGFzY2lpVG9CeXRlcyhzdHJpbmcpLCBidWYsIG9mZnNldCwgbGVuZ3RoKVxufVxuXG5mdW5jdGlvbiBiaW5hcnlXcml0ZSAoYnVmLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKSB7XG4gIHJldHVybiBhc2NpaVdyaXRlKGJ1Ziwgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aClcbn1cblxuZnVuY3Rpb24gYmFzZTY0V3JpdGUgKGJ1Ziwgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCkge1xuICByZXR1cm4gYmxpdEJ1ZmZlcihiYXNlNjRUb0J5dGVzKHN0cmluZyksIGJ1Ziwgb2Zmc2V0LCBsZW5ndGgpXG59XG5cbmZ1bmN0aW9uIHVjczJXcml0ZSAoYnVmLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKSB7XG4gIHJldHVybiBibGl0QnVmZmVyKHV0ZjE2bGVUb0J5dGVzKHN0cmluZywgYnVmLmxlbmd0aCAtIG9mZnNldCksIGJ1Ziwgb2Zmc2V0LCBsZW5ndGgpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGUgPSBmdW5jdGlvbiB3cml0ZSAoc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCwgZW5jb2RpbmcpIHtcbiAgLy8gQnVmZmVyI3dyaXRlKHN0cmluZylcbiAgaWYgKG9mZnNldCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgZW5jb2RpbmcgPSAndXRmOCdcbiAgICBsZW5ndGggPSB0aGlzLmxlbmd0aFxuICAgIG9mZnNldCA9IDBcbiAgLy8gQnVmZmVyI3dyaXRlKHN0cmluZywgZW5jb2RpbmcpXG4gIH0gZWxzZSBpZiAobGVuZ3RoID09PSB1bmRlZmluZWQgJiYgdHlwZW9mIG9mZnNldCA9PT0gJ3N0cmluZycpIHtcbiAgICBlbmNvZGluZyA9IG9mZnNldFxuICAgIGxlbmd0aCA9IHRoaXMubGVuZ3RoXG4gICAgb2Zmc2V0ID0gMFxuICAvLyBCdWZmZXIjd3JpdGUoc3RyaW5nLCBvZmZzZXRbLCBsZW5ndGhdWywgZW5jb2RpbmddKVxuICB9IGVsc2UgaWYgKGlzRmluaXRlKG9mZnNldCkpIHtcbiAgICBvZmZzZXQgPSBvZmZzZXQgfCAwXG4gICAgaWYgKGlzRmluaXRlKGxlbmd0aCkpIHtcbiAgICAgIGxlbmd0aCA9IGxlbmd0aCB8IDBcbiAgICAgIGlmIChlbmNvZGluZyA9PT0gdW5kZWZpbmVkKSBlbmNvZGluZyA9ICd1dGY4J1xuICAgIH0gZWxzZSB7XG4gICAgICBlbmNvZGluZyA9IGxlbmd0aFxuICAgICAgbGVuZ3RoID0gdW5kZWZpbmVkXG4gICAgfVxuICAvLyBsZWdhY3kgd3JpdGUoc3RyaW5nLCBlbmNvZGluZywgb2Zmc2V0LCBsZW5ndGgpIC0gcmVtb3ZlIGluIHYwLjEzXG4gIH0gZWxzZSB7XG4gICAgdmFyIHN3YXAgPSBlbmNvZGluZ1xuICAgIGVuY29kaW5nID0gb2Zmc2V0XG4gICAgb2Zmc2V0ID0gbGVuZ3RoIHwgMFxuICAgIGxlbmd0aCA9IHN3YXBcbiAgfVxuXG4gIHZhciByZW1haW5pbmcgPSB0aGlzLmxlbmd0aCAtIG9mZnNldFxuICBpZiAobGVuZ3RoID09PSB1bmRlZmluZWQgfHwgbGVuZ3RoID4gcmVtYWluaW5nKSBsZW5ndGggPSByZW1haW5pbmdcblxuICBpZiAoKHN0cmluZy5sZW5ndGggPiAwICYmIChsZW5ndGggPCAwIHx8IG9mZnNldCA8IDApKSB8fCBvZmZzZXQgPiB0aGlzLmxlbmd0aCkge1xuICAgIHRocm93IG5ldyBSYW5nZUVycm9yKCdhdHRlbXB0IHRvIHdyaXRlIG91dHNpZGUgYnVmZmVyIGJvdW5kcycpXG4gIH1cblxuICBpZiAoIWVuY29kaW5nKSBlbmNvZGluZyA9ICd1dGY4J1xuXG4gIHZhciBsb3dlcmVkQ2FzZSA9IGZhbHNlXG4gIGZvciAoOzspIHtcbiAgICBzd2l0Y2ggKGVuY29kaW5nKSB7XG4gICAgICBjYXNlICdoZXgnOlxuICAgICAgICByZXR1cm4gaGV4V3JpdGUodGhpcywgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aClcblxuICAgICAgY2FzZSAndXRmOCc6XG4gICAgICBjYXNlICd1dGYtOCc6XG4gICAgICAgIHJldHVybiB1dGY4V3JpdGUodGhpcywgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aClcblxuICAgICAgY2FzZSAnYXNjaWknOlxuICAgICAgICByZXR1cm4gYXNjaWlXcml0ZSh0aGlzLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKVxuXG4gICAgICBjYXNlICdiaW5hcnknOlxuICAgICAgICByZXR1cm4gYmluYXJ5V3JpdGUodGhpcywgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aClcblxuICAgICAgY2FzZSAnYmFzZTY0JzpcbiAgICAgICAgLy8gV2FybmluZzogbWF4TGVuZ3RoIG5vdCB0YWtlbiBpbnRvIGFjY291bnQgaW4gYmFzZTY0V3JpdGVcbiAgICAgICAgcmV0dXJuIGJhc2U2NFdyaXRlKHRoaXMsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpXG5cbiAgICAgIGNhc2UgJ3VjczInOlxuICAgICAgY2FzZSAndWNzLTInOlxuICAgICAgY2FzZSAndXRmMTZsZSc6XG4gICAgICBjYXNlICd1dGYtMTZsZSc6XG4gICAgICAgIHJldHVybiB1Y3MyV3JpdGUodGhpcywgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aClcblxuICAgICAgZGVmYXVsdDpcbiAgICAgICAgaWYgKGxvd2VyZWRDYXNlKSB0aHJvdyBuZXcgVHlwZUVycm9yKCdVbmtub3duIGVuY29kaW5nOiAnICsgZW5jb2RpbmcpXG4gICAgICAgIGVuY29kaW5nID0gKCcnICsgZW5jb2RpbmcpLnRvTG93ZXJDYXNlKClcbiAgICAgICAgbG93ZXJlZENhc2UgPSB0cnVlXG4gICAgfVxuICB9XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUudG9KU09OID0gZnVuY3Rpb24gdG9KU09OICgpIHtcbiAgcmV0dXJuIHtcbiAgICB0eXBlOiAnQnVmZmVyJyxcbiAgICBkYXRhOiBBcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbCh0aGlzLl9hcnIgfHwgdGhpcywgMClcbiAgfVxufVxuXG5mdW5jdGlvbiBiYXNlNjRTbGljZSAoYnVmLCBzdGFydCwgZW5kKSB7XG4gIGlmIChzdGFydCA9PT0gMCAmJiBlbmQgPT09IGJ1Zi5sZW5ndGgpIHtcbiAgICByZXR1cm4gYmFzZTY0LmZyb21CeXRlQXJyYXkoYnVmKVxuICB9IGVsc2Uge1xuICAgIHJldHVybiBiYXNlNjQuZnJvbUJ5dGVBcnJheShidWYuc2xpY2Uoc3RhcnQsIGVuZCkpXG4gIH1cbn1cblxuZnVuY3Rpb24gdXRmOFNsaWNlIChidWYsIHN0YXJ0LCBlbmQpIHtcbiAgdmFyIHJlcyA9ICcnXG4gIHZhciB0bXAgPSAnJ1xuICBlbmQgPSBNYXRoLm1pbihidWYubGVuZ3RoLCBlbmQpXG5cbiAgZm9yICh2YXIgaSA9IHN0YXJ0OyBpIDwgZW5kOyBpKyspIHtcbiAgICBpZiAoYnVmW2ldIDw9IDB4N0YpIHtcbiAgICAgIHJlcyArPSBkZWNvZGVVdGY4Q2hhcih0bXApICsgU3RyaW5nLmZyb21DaGFyQ29kZShidWZbaV0pXG4gICAgICB0bXAgPSAnJ1xuICAgIH0gZWxzZSB7XG4gICAgICB0bXAgKz0gJyUnICsgYnVmW2ldLnRvU3RyaW5nKDE2KVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiByZXMgKyBkZWNvZGVVdGY4Q2hhcih0bXApXG59XG5cbmZ1bmN0aW9uIGFzY2lpU2xpY2UgKGJ1Ziwgc3RhcnQsIGVuZCkge1xuICB2YXIgcmV0ID0gJydcbiAgZW5kID0gTWF0aC5taW4oYnVmLmxlbmd0aCwgZW5kKVxuXG4gIGZvciAodmFyIGkgPSBzdGFydDsgaSA8IGVuZDsgaSsrKSB7XG4gICAgcmV0ICs9IFN0cmluZy5mcm9tQ2hhckNvZGUoYnVmW2ldICYgMHg3RilcbiAgfVxuICByZXR1cm4gcmV0XG59XG5cbmZ1bmN0aW9uIGJpbmFyeVNsaWNlIChidWYsIHN0YXJ0LCBlbmQpIHtcbiAgdmFyIHJldCA9ICcnXG4gIGVuZCA9IE1hdGgubWluKGJ1Zi5sZW5ndGgsIGVuZClcblxuICBmb3IgKHZhciBpID0gc3RhcnQ7IGkgPCBlbmQ7IGkrKykge1xuICAgIHJldCArPSBTdHJpbmcuZnJvbUNoYXJDb2RlKGJ1ZltpXSlcbiAgfVxuICByZXR1cm4gcmV0XG59XG5cbmZ1bmN0aW9uIGhleFNsaWNlIChidWYsIHN0YXJ0LCBlbmQpIHtcbiAgdmFyIGxlbiA9IGJ1Zi5sZW5ndGhcblxuICBpZiAoIXN0YXJ0IHx8IHN0YXJ0IDwgMCkgc3RhcnQgPSAwXG4gIGlmICghZW5kIHx8IGVuZCA8IDAgfHwgZW5kID4gbGVuKSBlbmQgPSBsZW5cblxuICB2YXIgb3V0ID0gJydcbiAgZm9yICh2YXIgaSA9IHN0YXJ0OyBpIDwgZW5kOyBpKyspIHtcbiAgICBvdXQgKz0gdG9IZXgoYnVmW2ldKVxuICB9XG4gIHJldHVybiBvdXRcbn1cblxuZnVuY3Rpb24gdXRmMTZsZVNsaWNlIChidWYsIHN0YXJ0LCBlbmQpIHtcbiAgdmFyIGJ5dGVzID0gYnVmLnNsaWNlKHN0YXJ0LCBlbmQpXG4gIHZhciByZXMgPSAnJ1xuICBmb3IgKHZhciBpID0gMDsgaSA8IGJ5dGVzLmxlbmd0aDsgaSArPSAyKSB7XG4gICAgcmVzICs9IFN0cmluZy5mcm9tQ2hhckNvZGUoYnl0ZXNbaV0gKyBieXRlc1tpICsgMV0gKiAyNTYpXG4gIH1cbiAgcmV0dXJuIHJlc1xufVxuXG5CdWZmZXIucHJvdG90eXBlLnNsaWNlID0gZnVuY3Rpb24gc2xpY2UgKHN0YXJ0LCBlbmQpIHtcbiAgdmFyIGxlbiA9IHRoaXMubGVuZ3RoXG4gIHN0YXJ0ID0gfn5zdGFydFxuICBlbmQgPSBlbmQgPT09IHVuZGVmaW5lZCA/IGxlbiA6IH5+ZW5kXG5cbiAgaWYgKHN0YXJ0IDwgMCkge1xuICAgIHN0YXJ0ICs9IGxlblxuICAgIGlmIChzdGFydCA8IDApIHN0YXJ0ID0gMFxuICB9IGVsc2UgaWYgKHN0YXJ0ID4gbGVuKSB7XG4gICAgc3RhcnQgPSBsZW5cbiAgfVxuXG4gIGlmIChlbmQgPCAwKSB7XG4gICAgZW5kICs9IGxlblxuICAgIGlmIChlbmQgPCAwKSBlbmQgPSAwXG4gIH0gZWxzZSBpZiAoZW5kID4gbGVuKSB7XG4gICAgZW5kID0gbGVuXG4gIH1cblxuICBpZiAoZW5kIDwgc3RhcnQpIGVuZCA9IHN0YXJ0XG5cbiAgdmFyIG5ld0J1ZlxuICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICBuZXdCdWYgPSBCdWZmZXIuX2F1Z21lbnQodGhpcy5zdWJhcnJheShzdGFydCwgZW5kKSlcbiAgfSBlbHNlIHtcbiAgICB2YXIgc2xpY2VMZW4gPSBlbmQgLSBzdGFydFxuICAgIG5ld0J1ZiA9IG5ldyBCdWZmZXIoc2xpY2VMZW4sIHVuZGVmaW5lZClcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IHNsaWNlTGVuOyBpKyspIHtcbiAgICAgIG5ld0J1ZltpXSA9IHRoaXNbaSArIHN0YXJ0XVxuICAgIH1cbiAgfVxuXG4gIGlmIChuZXdCdWYubGVuZ3RoKSBuZXdCdWYucGFyZW50ID0gdGhpcy5wYXJlbnQgfHwgdGhpc1xuXG4gIHJldHVybiBuZXdCdWZcbn1cblxuLypcbiAqIE5lZWQgdG8gbWFrZSBzdXJlIHRoYXQgYnVmZmVyIGlzbid0IHRyeWluZyB0byB3cml0ZSBvdXQgb2YgYm91bmRzLlxuICovXG5mdW5jdGlvbiBjaGVja09mZnNldCAob2Zmc2V0LCBleHQsIGxlbmd0aCkge1xuICBpZiAoKG9mZnNldCAlIDEpICE9PSAwIHx8IG9mZnNldCA8IDApIHRocm93IG5ldyBSYW5nZUVycm9yKCdvZmZzZXQgaXMgbm90IHVpbnQnKVxuICBpZiAob2Zmc2V0ICsgZXh0ID4gbGVuZ3RoKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcignVHJ5aW5nIHRvIGFjY2VzcyBiZXlvbmQgYnVmZmVyIGxlbmd0aCcpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZFVJbnRMRSA9IGZ1bmN0aW9uIHJlYWRVSW50TEUgKG9mZnNldCwgYnl0ZUxlbmd0aCwgbm9Bc3NlcnQpIHtcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBieXRlTGVuZ3RoID0gYnl0ZUxlbmd0aCB8IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCBieXRlTGVuZ3RoLCB0aGlzLmxlbmd0aClcblxuICB2YXIgdmFsID0gdGhpc1tvZmZzZXRdXG4gIHZhciBtdWwgPSAxXG4gIHZhciBpID0gMFxuICB3aGlsZSAoKytpIDwgYnl0ZUxlbmd0aCAmJiAobXVsICo9IDB4MTAwKSkge1xuICAgIHZhbCArPSB0aGlzW29mZnNldCArIGldICogbXVsXG4gIH1cblxuICByZXR1cm4gdmFsXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZFVJbnRCRSA9IGZ1bmN0aW9uIHJlYWRVSW50QkUgKG9mZnNldCwgYnl0ZUxlbmd0aCwgbm9Bc3NlcnQpIHtcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBieXRlTGVuZ3RoID0gYnl0ZUxlbmd0aCB8IDBcbiAgaWYgKCFub0Fzc2VydCkge1xuICAgIGNoZWNrT2Zmc2V0KG9mZnNldCwgYnl0ZUxlbmd0aCwgdGhpcy5sZW5ndGgpXG4gIH1cblxuICB2YXIgdmFsID0gdGhpc1tvZmZzZXQgKyAtLWJ5dGVMZW5ndGhdXG4gIHZhciBtdWwgPSAxXG4gIHdoaWxlIChieXRlTGVuZ3RoID4gMCAmJiAobXVsICo9IDB4MTAwKSkge1xuICAgIHZhbCArPSB0aGlzW29mZnNldCArIC0tYnl0ZUxlbmd0aF0gKiBtdWxcbiAgfVxuXG4gIHJldHVybiB2YWxcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkVUludDggPSBmdW5jdGlvbiByZWFkVUludDggKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCAxLCB0aGlzLmxlbmd0aClcbiAgcmV0dXJuIHRoaXNbb2Zmc2V0XVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRVSW50MTZMRSA9IGZ1bmN0aW9uIHJlYWRVSW50MTZMRSAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDIsIHRoaXMubGVuZ3RoKVxuICByZXR1cm4gdGhpc1tvZmZzZXRdIHwgKHRoaXNbb2Zmc2V0ICsgMV0gPDwgOClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkVUludDE2QkUgPSBmdW5jdGlvbiByZWFkVUludDE2QkUgKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCAyLCB0aGlzLmxlbmd0aClcbiAgcmV0dXJuICh0aGlzW29mZnNldF0gPDwgOCkgfCB0aGlzW29mZnNldCArIDFdXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZFVJbnQzMkxFID0gZnVuY3Rpb24gcmVhZFVJbnQzMkxFIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgNCwgdGhpcy5sZW5ndGgpXG5cbiAgcmV0dXJuICgodGhpc1tvZmZzZXRdKSB8XG4gICAgICAodGhpc1tvZmZzZXQgKyAxXSA8PCA4KSB8XG4gICAgICAodGhpc1tvZmZzZXQgKyAyXSA8PCAxNikpICtcbiAgICAgICh0aGlzW29mZnNldCArIDNdICogMHgxMDAwMDAwKVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRVSW50MzJCRSA9IGZ1bmN0aW9uIHJlYWRVSW50MzJCRSAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDQsIHRoaXMubGVuZ3RoKVxuXG4gIHJldHVybiAodGhpc1tvZmZzZXRdICogMHgxMDAwMDAwKSArXG4gICAgKCh0aGlzW29mZnNldCArIDFdIDw8IDE2KSB8XG4gICAgKHRoaXNbb2Zmc2V0ICsgMl0gPDwgOCkgfFxuICAgIHRoaXNbb2Zmc2V0ICsgM10pXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEludExFID0gZnVuY3Rpb24gcmVhZEludExFIChvZmZzZXQsIGJ5dGVMZW5ndGgsIG5vQXNzZXJ0KSB7XG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgYnl0ZUxlbmd0aCA9IGJ5dGVMZW5ndGggfCAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgYnl0ZUxlbmd0aCwgdGhpcy5sZW5ndGgpXG5cbiAgdmFyIHZhbCA9IHRoaXNbb2Zmc2V0XVxuICB2YXIgbXVsID0gMVxuICB2YXIgaSA9IDBcbiAgd2hpbGUgKCsraSA8IGJ5dGVMZW5ndGggJiYgKG11bCAqPSAweDEwMCkpIHtcbiAgICB2YWwgKz0gdGhpc1tvZmZzZXQgKyBpXSAqIG11bFxuICB9XG4gIG11bCAqPSAweDgwXG5cbiAgaWYgKHZhbCA+PSBtdWwpIHZhbCAtPSBNYXRoLnBvdygyLCA4ICogYnl0ZUxlbmd0aClcblxuICByZXR1cm4gdmFsXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEludEJFID0gZnVuY3Rpb24gcmVhZEludEJFIChvZmZzZXQsIGJ5dGVMZW5ndGgsIG5vQXNzZXJ0KSB7XG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgYnl0ZUxlbmd0aCA9IGJ5dGVMZW5ndGggfCAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgYnl0ZUxlbmd0aCwgdGhpcy5sZW5ndGgpXG5cbiAgdmFyIGkgPSBieXRlTGVuZ3RoXG4gIHZhciBtdWwgPSAxXG4gIHZhciB2YWwgPSB0aGlzW29mZnNldCArIC0taV1cbiAgd2hpbGUgKGkgPiAwICYmIChtdWwgKj0gMHgxMDApKSB7XG4gICAgdmFsICs9IHRoaXNbb2Zmc2V0ICsgLS1pXSAqIG11bFxuICB9XG4gIG11bCAqPSAweDgwXG5cbiAgaWYgKHZhbCA+PSBtdWwpIHZhbCAtPSBNYXRoLnBvdygyLCA4ICogYnl0ZUxlbmd0aClcblxuICByZXR1cm4gdmFsXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEludDggPSBmdW5jdGlvbiByZWFkSW50OCAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDEsIHRoaXMubGVuZ3RoKVxuICBpZiAoISh0aGlzW29mZnNldF0gJiAweDgwKSkgcmV0dXJuICh0aGlzW29mZnNldF0pXG4gIHJldHVybiAoKDB4ZmYgLSB0aGlzW29mZnNldF0gKyAxKSAqIC0xKVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRJbnQxNkxFID0gZnVuY3Rpb24gcmVhZEludDE2TEUgKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCAyLCB0aGlzLmxlbmd0aClcbiAgdmFyIHZhbCA9IHRoaXNbb2Zmc2V0XSB8ICh0aGlzW29mZnNldCArIDFdIDw8IDgpXG4gIHJldHVybiAodmFsICYgMHg4MDAwKSA/IHZhbCB8IDB4RkZGRjAwMDAgOiB2YWxcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkSW50MTZCRSA9IGZ1bmN0aW9uIHJlYWRJbnQxNkJFIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgMiwgdGhpcy5sZW5ndGgpXG4gIHZhciB2YWwgPSB0aGlzW29mZnNldCArIDFdIHwgKHRoaXNbb2Zmc2V0XSA8PCA4KVxuICByZXR1cm4gKHZhbCAmIDB4ODAwMCkgPyB2YWwgfCAweEZGRkYwMDAwIDogdmFsXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEludDMyTEUgPSBmdW5jdGlvbiByZWFkSW50MzJMRSAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDQsIHRoaXMubGVuZ3RoKVxuXG4gIHJldHVybiAodGhpc1tvZmZzZXRdKSB8XG4gICAgKHRoaXNbb2Zmc2V0ICsgMV0gPDwgOCkgfFxuICAgICh0aGlzW29mZnNldCArIDJdIDw8IDE2KSB8XG4gICAgKHRoaXNbb2Zmc2V0ICsgM10gPDwgMjQpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEludDMyQkUgPSBmdW5jdGlvbiByZWFkSW50MzJCRSAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDQsIHRoaXMubGVuZ3RoKVxuXG4gIHJldHVybiAodGhpc1tvZmZzZXRdIDw8IDI0KSB8XG4gICAgKHRoaXNbb2Zmc2V0ICsgMV0gPDwgMTYpIHxcbiAgICAodGhpc1tvZmZzZXQgKyAyXSA8PCA4KSB8XG4gICAgKHRoaXNbb2Zmc2V0ICsgM10pXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEZsb2F0TEUgPSBmdW5jdGlvbiByZWFkRmxvYXRMRSAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDQsIHRoaXMubGVuZ3RoKVxuICByZXR1cm4gaWVlZTc1NC5yZWFkKHRoaXMsIG9mZnNldCwgdHJ1ZSwgMjMsIDQpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEZsb2F0QkUgPSBmdW5jdGlvbiByZWFkRmxvYXRCRSAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDQsIHRoaXMubGVuZ3RoKVxuICByZXR1cm4gaWVlZTc1NC5yZWFkKHRoaXMsIG9mZnNldCwgZmFsc2UsIDIzLCA0KVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWREb3VibGVMRSA9IGZ1bmN0aW9uIHJlYWREb3VibGVMRSAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDgsIHRoaXMubGVuZ3RoKVxuICByZXR1cm4gaWVlZTc1NC5yZWFkKHRoaXMsIG9mZnNldCwgdHJ1ZSwgNTIsIDgpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZERvdWJsZUJFID0gZnVuY3Rpb24gcmVhZERvdWJsZUJFIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgOCwgdGhpcy5sZW5ndGgpXG4gIHJldHVybiBpZWVlNzU0LnJlYWQodGhpcywgb2Zmc2V0LCBmYWxzZSwgNTIsIDgpXG59XG5cbmZ1bmN0aW9uIGNoZWNrSW50IChidWYsIHZhbHVlLCBvZmZzZXQsIGV4dCwgbWF4LCBtaW4pIHtcbiAgaWYgKCFCdWZmZXIuaXNCdWZmZXIoYnVmKSkgdGhyb3cgbmV3IFR5cGVFcnJvcignYnVmZmVyIG11c3QgYmUgYSBCdWZmZXIgaW5zdGFuY2UnKVxuICBpZiAodmFsdWUgPiBtYXggfHwgdmFsdWUgPCBtaW4pIHRocm93IG5ldyBSYW5nZUVycm9yKCd2YWx1ZSBpcyBvdXQgb2YgYm91bmRzJylcbiAgaWYgKG9mZnNldCArIGV4dCA+IGJ1Zi5sZW5ndGgpIHRocm93IG5ldyBSYW5nZUVycm9yKCdpbmRleCBvdXQgb2YgcmFuZ2UnKVxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlVUludExFID0gZnVuY3Rpb24gd3JpdGVVSW50TEUgKHZhbHVlLCBvZmZzZXQsIGJ5dGVMZW5ndGgsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgYnl0ZUxlbmd0aCA9IGJ5dGVMZW5ndGggfCAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIGJ5dGVMZW5ndGgsIE1hdGgucG93KDIsIDggKiBieXRlTGVuZ3RoKSwgMClcblxuICB2YXIgbXVsID0gMVxuICB2YXIgaSA9IDBcbiAgdGhpc1tvZmZzZXRdID0gdmFsdWUgJiAweEZGXG4gIHdoaWxlICgrK2kgPCBieXRlTGVuZ3RoICYmIChtdWwgKj0gMHgxMDApKSB7XG4gICAgdGhpc1tvZmZzZXQgKyBpXSA9ICh2YWx1ZSAvIG11bCkgJiAweEZGXG4gIH1cblxuICByZXR1cm4gb2Zmc2V0ICsgYnl0ZUxlbmd0aFxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlVUludEJFID0gZnVuY3Rpb24gd3JpdGVVSW50QkUgKHZhbHVlLCBvZmZzZXQsIGJ5dGVMZW5ndGgsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgYnl0ZUxlbmd0aCA9IGJ5dGVMZW5ndGggfCAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIGJ5dGVMZW5ndGgsIE1hdGgucG93KDIsIDggKiBieXRlTGVuZ3RoKSwgMClcblxuICB2YXIgaSA9IGJ5dGVMZW5ndGggLSAxXG4gIHZhciBtdWwgPSAxXG4gIHRoaXNbb2Zmc2V0ICsgaV0gPSB2YWx1ZSAmIDB4RkZcbiAgd2hpbGUgKC0taSA+PSAwICYmIChtdWwgKj0gMHgxMDApKSB7XG4gICAgdGhpc1tvZmZzZXQgKyBpXSA9ICh2YWx1ZSAvIG11bCkgJiAweEZGXG4gIH1cblxuICByZXR1cm4gb2Zmc2V0ICsgYnl0ZUxlbmd0aFxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlVUludDggPSBmdW5jdGlvbiB3cml0ZVVJbnQ4ICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgfCAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIDEsIDB4ZmYsIDApXG4gIGlmICghQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHZhbHVlID0gTWF0aC5mbG9vcih2YWx1ZSlcbiAgdGhpc1tvZmZzZXRdID0gdmFsdWVcbiAgcmV0dXJuIG9mZnNldCArIDFcbn1cblxuZnVuY3Rpb24gb2JqZWN0V3JpdGVVSW50MTYgKGJ1ZiwgdmFsdWUsIG9mZnNldCwgbGl0dGxlRW5kaWFuKSB7XG4gIGlmICh2YWx1ZSA8IDApIHZhbHVlID0gMHhmZmZmICsgdmFsdWUgKyAxXG4gIGZvciAodmFyIGkgPSAwLCBqID0gTWF0aC5taW4oYnVmLmxlbmd0aCAtIG9mZnNldCwgMik7IGkgPCBqOyBpKyspIHtcbiAgICBidWZbb2Zmc2V0ICsgaV0gPSAodmFsdWUgJiAoMHhmZiA8PCAoOCAqIChsaXR0bGVFbmRpYW4gPyBpIDogMSAtIGkpKSkpID4+PlxuICAgICAgKGxpdHRsZUVuZGlhbiA/IGkgOiAxIC0gaSkgKiA4XG4gIH1cbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZVVJbnQxNkxFID0gZnVuY3Rpb24gd3JpdGVVSW50MTZMRSAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCAyLCAweGZmZmYsIDApXG4gIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIHRoaXNbb2Zmc2V0XSA9IHZhbHVlXG4gICAgdGhpc1tvZmZzZXQgKyAxXSA9ICh2YWx1ZSA+Pj4gOClcbiAgfSBlbHNlIHtcbiAgICBvYmplY3RXcml0ZVVJbnQxNih0aGlzLCB2YWx1ZSwgb2Zmc2V0LCB0cnVlKVxuICB9XG4gIHJldHVybiBvZmZzZXQgKyAyXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVVSW50MTZCRSA9IGZ1bmN0aW9uIHdyaXRlVUludDE2QkUgKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgMiwgMHhmZmZmLCAwKVxuICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICB0aGlzW29mZnNldF0gPSAodmFsdWUgPj4+IDgpXG4gICAgdGhpc1tvZmZzZXQgKyAxXSA9IHZhbHVlXG4gIH0gZWxzZSB7XG4gICAgb2JqZWN0V3JpdGVVSW50MTYodGhpcywgdmFsdWUsIG9mZnNldCwgZmFsc2UpXG4gIH1cbiAgcmV0dXJuIG9mZnNldCArIDJcbn1cblxuZnVuY3Rpb24gb2JqZWN0V3JpdGVVSW50MzIgKGJ1ZiwgdmFsdWUsIG9mZnNldCwgbGl0dGxlRW5kaWFuKSB7XG4gIGlmICh2YWx1ZSA8IDApIHZhbHVlID0gMHhmZmZmZmZmZiArIHZhbHVlICsgMVxuICBmb3IgKHZhciBpID0gMCwgaiA9IE1hdGgubWluKGJ1Zi5sZW5ndGggLSBvZmZzZXQsIDQpOyBpIDwgajsgaSsrKSB7XG4gICAgYnVmW29mZnNldCArIGldID0gKHZhbHVlID4+PiAobGl0dGxlRW5kaWFuID8gaSA6IDMgLSBpKSAqIDgpICYgMHhmZlxuICB9XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVVSW50MzJMRSA9IGZ1bmN0aW9uIHdyaXRlVUludDMyTEUgKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgNCwgMHhmZmZmZmZmZiwgMClcbiAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgdGhpc1tvZmZzZXQgKyAzXSA9ICh2YWx1ZSA+Pj4gMjQpXG4gICAgdGhpc1tvZmZzZXQgKyAyXSA9ICh2YWx1ZSA+Pj4gMTYpXG4gICAgdGhpc1tvZmZzZXQgKyAxXSA9ICh2YWx1ZSA+Pj4gOClcbiAgICB0aGlzW29mZnNldF0gPSB2YWx1ZVxuICB9IGVsc2Uge1xuICAgIG9iamVjdFdyaXRlVUludDMyKHRoaXMsIHZhbHVlLCBvZmZzZXQsIHRydWUpXG4gIH1cbiAgcmV0dXJuIG9mZnNldCArIDRcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZVVJbnQzMkJFID0gZnVuY3Rpb24gd3JpdGVVSW50MzJCRSAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCA0LCAweGZmZmZmZmZmLCAwKVxuICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICB0aGlzW29mZnNldF0gPSAodmFsdWUgPj4+IDI0KVxuICAgIHRoaXNbb2Zmc2V0ICsgMV0gPSAodmFsdWUgPj4+IDE2KVxuICAgIHRoaXNbb2Zmc2V0ICsgMl0gPSAodmFsdWUgPj4+IDgpXG4gICAgdGhpc1tvZmZzZXQgKyAzXSA9IHZhbHVlXG4gIH0gZWxzZSB7XG4gICAgb2JqZWN0V3JpdGVVSW50MzIodGhpcywgdmFsdWUsIG9mZnNldCwgZmFsc2UpXG4gIH1cbiAgcmV0dXJuIG9mZnNldCArIDRcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUludExFID0gZnVuY3Rpb24gd3JpdGVJbnRMRSAodmFsdWUsIG9mZnNldCwgYnl0ZUxlbmd0aCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBpZiAoIW5vQXNzZXJ0KSB7XG4gICAgdmFyIGxpbWl0ID0gTWF0aC5wb3coMiwgOCAqIGJ5dGVMZW5ndGggLSAxKVxuXG4gICAgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgYnl0ZUxlbmd0aCwgbGltaXQgLSAxLCAtbGltaXQpXG4gIH1cblxuICB2YXIgaSA9IDBcbiAgdmFyIG11bCA9IDFcbiAgdmFyIHN1YiA9IHZhbHVlIDwgMCA/IDEgOiAwXG4gIHRoaXNbb2Zmc2V0XSA9IHZhbHVlICYgMHhGRlxuICB3aGlsZSAoKytpIDwgYnl0ZUxlbmd0aCAmJiAobXVsICo9IDB4MTAwKSkge1xuICAgIHRoaXNbb2Zmc2V0ICsgaV0gPSAoKHZhbHVlIC8gbXVsKSA+PiAwKSAtIHN1YiAmIDB4RkZcbiAgfVxuXG4gIHJldHVybiBvZmZzZXQgKyBieXRlTGVuZ3RoXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVJbnRCRSA9IGZ1bmN0aW9uIHdyaXRlSW50QkUgKHZhbHVlLCBvZmZzZXQsIGJ5dGVMZW5ndGgsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgaWYgKCFub0Fzc2VydCkge1xuICAgIHZhciBsaW1pdCA9IE1hdGgucG93KDIsIDggKiBieXRlTGVuZ3RoIC0gMSlcblxuICAgIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIGJ5dGVMZW5ndGgsIGxpbWl0IC0gMSwgLWxpbWl0KVxuICB9XG5cbiAgdmFyIGkgPSBieXRlTGVuZ3RoIC0gMVxuICB2YXIgbXVsID0gMVxuICB2YXIgc3ViID0gdmFsdWUgPCAwID8gMSA6IDBcbiAgdGhpc1tvZmZzZXQgKyBpXSA9IHZhbHVlICYgMHhGRlxuICB3aGlsZSAoLS1pID49IDAgJiYgKG11bCAqPSAweDEwMCkpIHtcbiAgICB0aGlzW29mZnNldCArIGldID0gKCh2YWx1ZSAvIG11bCkgPj4gMCkgLSBzdWIgJiAweEZGXG4gIH1cblxuICByZXR1cm4gb2Zmc2V0ICsgYnl0ZUxlbmd0aFxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlSW50OCA9IGZ1bmN0aW9uIHdyaXRlSW50OCAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCAxLCAweDdmLCAtMHg4MClcbiAgaWYgKCFCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkgdmFsdWUgPSBNYXRoLmZsb29yKHZhbHVlKVxuICBpZiAodmFsdWUgPCAwKSB2YWx1ZSA9IDB4ZmYgKyB2YWx1ZSArIDFcbiAgdGhpc1tvZmZzZXRdID0gdmFsdWVcbiAgcmV0dXJuIG9mZnNldCArIDFcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUludDE2TEUgPSBmdW5jdGlvbiB3cml0ZUludDE2TEUgKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgMiwgMHg3ZmZmLCAtMHg4MDAwKVxuICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICB0aGlzW29mZnNldF0gPSB2YWx1ZVxuICAgIHRoaXNbb2Zmc2V0ICsgMV0gPSAodmFsdWUgPj4+IDgpXG4gIH0gZWxzZSB7XG4gICAgb2JqZWN0V3JpdGVVSW50MTYodGhpcywgdmFsdWUsIG9mZnNldCwgdHJ1ZSlcbiAgfVxuICByZXR1cm4gb2Zmc2V0ICsgMlxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlSW50MTZCRSA9IGZ1bmN0aW9uIHdyaXRlSW50MTZCRSAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCAyLCAweDdmZmYsIC0weDgwMDApXG4gIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIHRoaXNbb2Zmc2V0XSA9ICh2YWx1ZSA+Pj4gOClcbiAgICB0aGlzW29mZnNldCArIDFdID0gdmFsdWVcbiAgfSBlbHNlIHtcbiAgICBvYmplY3RXcml0ZVVJbnQxNih0aGlzLCB2YWx1ZSwgb2Zmc2V0LCBmYWxzZSlcbiAgfVxuICByZXR1cm4gb2Zmc2V0ICsgMlxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlSW50MzJMRSA9IGZ1bmN0aW9uIHdyaXRlSW50MzJMRSAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCA0LCAweDdmZmZmZmZmLCAtMHg4MDAwMDAwMClcbiAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgdGhpc1tvZmZzZXRdID0gdmFsdWVcbiAgICB0aGlzW29mZnNldCArIDFdID0gKHZhbHVlID4+PiA4KVxuICAgIHRoaXNbb2Zmc2V0ICsgMl0gPSAodmFsdWUgPj4+IDE2KVxuICAgIHRoaXNbb2Zmc2V0ICsgM10gPSAodmFsdWUgPj4+IDI0KVxuICB9IGVsc2Uge1xuICAgIG9iamVjdFdyaXRlVUludDMyKHRoaXMsIHZhbHVlLCBvZmZzZXQsIHRydWUpXG4gIH1cbiAgcmV0dXJuIG9mZnNldCArIDRcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUludDMyQkUgPSBmdW5jdGlvbiB3cml0ZUludDMyQkUgKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgNCwgMHg3ZmZmZmZmZiwgLTB4ODAwMDAwMDApXG4gIGlmICh2YWx1ZSA8IDApIHZhbHVlID0gMHhmZmZmZmZmZiArIHZhbHVlICsgMVxuICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICB0aGlzW29mZnNldF0gPSAodmFsdWUgPj4+IDI0KVxuICAgIHRoaXNbb2Zmc2V0ICsgMV0gPSAodmFsdWUgPj4+IDE2KVxuICAgIHRoaXNbb2Zmc2V0ICsgMl0gPSAodmFsdWUgPj4+IDgpXG4gICAgdGhpc1tvZmZzZXQgKyAzXSA9IHZhbHVlXG4gIH0gZWxzZSB7XG4gICAgb2JqZWN0V3JpdGVVSW50MzIodGhpcywgdmFsdWUsIG9mZnNldCwgZmFsc2UpXG4gIH1cbiAgcmV0dXJuIG9mZnNldCArIDRcbn1cblxuZnVuY3Rpb24gY2hlY2tJRUVFNzU0IChidWYsIHZhbHVlLCBvZmZzZXQsIGV4dCwgbWF4LCBtaW4pIHtcbiAgaWYgKHZhbHVlID4gbWF4IHx8IHZhbHVlIDwgbWluKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcigndmFsdWUgaXMgb3V0IG9mIGJvdW5kcycpXG4gIGlmIChvZmZzZXQgKyBleHQgPiBidWYubGVuZ3RoKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcignaW5kZXggb3V0IG9mIHJhbmdlJylcbiAgaWYgKG9mZnNldCA8IDApIHRocm93IG5ldyBSYW5nZUVycm9yKCdpbmRleCBvdXQgb2YgcmFuZ2UnKVxufVxuXG5mdW5jdGlvbiB3cml0ZUZsb2F0IChidWYsIHZhbHVlLCBvZmZzZXQsIGxpdHRsZUVuZGlhbiwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkge1xuICAgIGNoZWNrSUVFRTc1NChidWYsIHZhbHVlLCBvZmZzZXQsIDQsIDMuNDAyODIzNDY2Mzg1Mjg4NmUrMzgsIC0zLjQwMjgyMzQ2NjM4NTI4ODZlKzM4KVxuICB9XG4gIGllZWU3NTQud3JpdGUoYnVmLCB2YWx1ZSwgb2Zmc2V0LCBsaXR0bGVFbmRpYW4sIDIzLCA0KVxuICByZXR1cm4gb2Zmc2V0ICsgNFxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlRmxvYXRMRSA9IGZ1bmN0aW9uIHdyaXRlRmxvYXRMRSAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgcmV0dXJuIHdyaXRlRmxvYXQodGhpcywgdmFsdWUsIG9mZnNldCwgdHJ1ZSwgbm9Bc3NlcnQpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVGbG9hdEJFID0gZnVuY3Rpb24gd3JpdGVGbG9hdEJFICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICByZXR1cm4gd3JpdGVGbG9hdCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCBmYWxzZSwgbm9Bc3NlcnQpXG59XG5cbmZ1bmN0aW9uIHdyaXRlRG91YmxlIChidWYsIHZhbHVlLCBvZmZzZXQsIGxpdHRsZUVuZGlhbiwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkge1xuICAgIGNoZWNrSUVFRTc1NChidWYsIHZhbHVlLCBvZmZzZXQsIDgsIDEuNzk3NjkzMTM0ODYyMzE1N0UrMzA4LCAtMS43OTc2OTMxMzQ4NjIzMTU3RSszMDgpXG4gIH1cbiAgaWVlZTc1NC53cml0ZShidWYsIHZhbHVlLCBvZmZzZXQsIGxpdHRsZUVuZGlhbiwgNTIsIDgpXG4gIHJldHVybiBvZmZzZXQgKyA4XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVEb3VibGVMRSA9IGZ1bmN0aW9uIHdyaXRlRG91YmxlTEUgKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHJldHVybiB3cml0ZURvdWJsZSh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCB0cnVlLCBub0Fzc2VydClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZURvdWJsZUJFID0gZnVuY3Rpb24gd3JpdGVEb3VibGVCRSAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgcmV0dXJuIHdyaXRlRG91YmxlKHRoaXMsIHZhbHVlLCBvZmZzZXQsIGZhbHNlLCBub0Fzc2VydClcbn1cblxuLy8gY29weSh0YXJnZXRCdWZmZXIsIHRhcmdldFN0YXJ0PTAsIHNvdXJjZVN0YXJ0PTAsIHNvdXJjZUVuZD1idWZmZXIubGVuZ3RoKVxuQnVmZmVyLnByb3RvdHlwZS5jb3B5ID0gZnVuY3Rpb24gY29weSAodGFyZ2V0LCB0YXJnZXRTdGFydCwgc3RhcnQsIGVuZCkge1xuICBpZiAoIXN0YXJ0KSBzdGFydCA9IDBcbiAgaWYgKCFlbmQgJiYgZW5kICE9PSAwKSBlbmQgPSB0aGlzLmxlbmd0aFxuICBpZiAodGFyZ2V0U3RhcnQgPj0gdGFyZ2V0Lmxlbmd0aCkgdGFyZ2V0U3RhcnQgPSB0YXJnZXQubGVuZ3RoXG4gIGlmICghdGFyZ2V0U3RhcnQpIHRhcmdldFN0YXJ0ID0gMFxuICBpZiAoZW5kID4gMCAmJiBlbmQgPCBzdGFydCkgZW5kID0gc3RhcnRcblxuICAvLyBDb3B5IDAgYnl0ZXM7IHdlJ3JlIGRvbmVcbiAgaWYgKGVuZCA9PT0gc3RhcnQpIHJldHVybiAwXG4gIGlmICh0YXJnZXQubGVuZ3RoID09PSAwIHx8IHRoaXMubGVuZ3RoID09PSAwKSByZXR1cm4gMFxuXG4gIC8vIEZhdGFsIGVycm9yIGNvbmRpdGlvbnNcbiAgaWYgKHRhcmdldFN0YXJ0IDwgMCkge1xuICAgIHRocm93IG5ldyBSYW5nZUVycm9yKCd0YXJnZXRTdGFydCBvdXQgb2YgYm91bmRzJylcbiAgfVxuICBpZiAoc3RhcnQgPCAwIHx8IHN0YXJ0ID49IHRoaXMubGVuZ3RoKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcignc291cmNlU3RhcnQgb3V0IG9mIGJvdW5kcycpXG4gIGlmIChlbmQgPCAwKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcignc291cmNlRW5kIG91dCBvZiBib3VuZHMnKVxuXG4gIC8vIEFyZSB3ZSBvb2I/XG4gIGlmIChlbmQgPiB0aGlzLmxlbmd0aCkgZW5kID0gdGhpcy5sZW5ndGhcbiAgaWYgKHRhcmdldC5sZW5ndGggLSB0YXJnZXRTdGFydCA8IGVuZCAtIHN0YXJ0KSB7XG4gICAgZW5kID0gdGFyZ2V0Lmxlbmd0aCAtIHRhcmdldFN0YXJ0ICsgc3RhcnRcbiAgfVxuXG4gIHZhciBsZW4gPSBlbmQgLSBzdGFydFxuXG4gIGlmIChsZW4gPCAxMDAwIHx8ICFCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuOyBpKyspIHtcbiAgICAgIHRhcmdldFtpICsgdGFyZ2V0U3RhcnRdID0gdGhpc1tpICsgc3RhcnRdXG4gICAgfVxuICB9IGVsc2Uge1xuICAgIHRhcmdldC5fc2V0KHRoaXMuc3ViYXJyYXkoc3RhcnQsIHN0YXJ0ICsgbGVuKSwgdGFyZ2V0U3RhcnQpXG4gIH1cblxuICByZXR1cm4gbGVuXG59XG5cbi8vIGZpbGwodmFsdWUsIHN0YXJ0PTAsIGVuZD1idWZmZXIubGVuZ3RoKVxuQnVmZmVyLnByb3RvdHlwZS5maWxsID0gZnVuY3Rpb24gZmlsbCAodmFsdWUsIHN0YXJ0LCBlbmQpIHtcbiAgaWYgKCF2YWx1ZSkgdmFsdWUgPSAwXG4gIGlmICghc3RhcnQpIHN0YXJ0ID0gMFxuICBpZiAoIWVuZCkgZW5kID0gdGhpcy5sZW5ndGhcblxuICBpZiAoZW5kIDwgc3RhcnQpIHRocm93IG5ldyBSYW5nZUVycm9yKCdlbmQgPCBzdGFydCcpXG5cbiAgLy8gRmlsbCAwIGJ5dGVzOyB3ZSdyZSBkb25lXG4gIGlmIChlbmQgPT09IHN0YXJ0KSByZXR1cm5cbiAgaWYgKHRoaXMubGVuZ3RoID09PSAwKSByZXR1cm5cblxuICBpZiAoc3RhcnQgPCAwIHx8IHN0YXJ0ID49IHRoaXMubGVuZ3RoKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcignc3RhcnQgb3V0IG9mIGJvdW5kcycpXG4gIGlmIChlbmQgPCAwIHx8IGVuZCA+IHRoaXMubGVuZ3RoKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcignZW5kIG91dCBvZiBib3VuZHMnKVxuXG4gIHZhciBpXG4gIGlmICh0eXBlb2YgdmFsdWUgPT09ICdudW1iZXInKSB7XG4gICAgZm9yIChpID0gc3RhcnQ7IGkgPCBlbmQ7IGkrKykge1xuICAgICAgdGhpc1tpXSA9IHZhbHVlXG4gICAgfVxuICB9IGVsc2Uge1xuICAgIHZhciBieXRlcyA9IHV0ZjhUb0J5dGVzKHZhbHVlLnRvU3RyaW5nKCkpXG4gICAgdmFyIGxlbiA9IGJ5dGVzLmxlbmd0aFxuICAgIGZvciAoaSA9IHN0YXJ0OyBpIDwgZW5kOyBpKyspIHtcbiAgICAgIHRoaXNbaV0gPSBieXRlc1tpICUgbGVuXVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiB0aGlzXG59XG5cbi8qKlxuICogQ3JlYXRlcyBhIG5ldyBgQXJyYXlCdWZmZXJgIHdpdGggdGhlICpjb3BpZWQqIG1lbW9yeSBvZiB0aGUgYnVmZmVyIGluc3RhbmNlLlxuICogQWRkZWQgaW4gTm9kZSAwLjEyLiBPbmx5IGF2YWlsYWJsZSBpbiBicm93c2VycyB0aGF0IHN1cHBvcnQgQXJyYXlCdWZmZXIuXG4gKi9cbkJ1ZmZlci5wcm90b3R5cGUudG9BcnJheUJ1ZmZlciA9IGZ1bmN0aW9uIHRvQXJyYXlCdWZmZXIgKCkge1xuICBpZiAodHlwZW9mIFVpbnQ4QXJyYXkgIT09ICd1bmRlZmluZWQnKSB7XG4gICAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgICByZXR1cm4gKG5ldyBCdWZmZXIodGhpcykpLmJ1ZmZlclxuICAgIH0gZWxzZSB7XG4gICAgICB2YXIgYnVmID0gbmV3IFVpbnQ4QXJyYXkodGhpcy5sZW5ndGgpXG4gICAgICBmb3IgKHZhciBpID0gMCwgbGVuID0gYnVmLmxlbmd0aDsgaSA8IGxlbjsgaSArPSAxKSB7XG4gICAgICAgIGJ1ZltpXSA9IHRoaXNbaV1cbiAgICAgIH1cbiAgICAgIHJldHVybiBidWYuYnVmZmVyXG4gICAgfVxuICB9IGVsc2Uge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ0J1ZmZlci50b0FycmF5QnVmZmVyIG5vdCBzdXBwb3J0ZWQgaW4gdGhpcyBicm93c2VyJylcbiAgfVxufVxuXG4vLyBIRUxQRVIgRlVOQ1RJT05TXG4vLyA9PT09PT09PT09PT09PT09XG5cbnZhciBCUCA9IEJ1ZmZlci5wcm90b3R5cGVcblxuLyoqXG4gKiBBdWdtZW50IGEgVWludDhBcnJheSAqaW5zdGFuY2UqIChub3QgdGhlIFVpbnQ4QXJyYXkgY2xhc3MhKSB3aXRoIEJ1ZmZlciBtZXRob2RzXG4gKi9cbkJ1ZmZlci5fYXVnbWVudCA9IGZ1bmN0aW9uIF9hdWdtZW50IChhcnIpIHtcbiAgYXJyLmNvbnN0cnVjdG9yID0gQnVmZmVyXG4gIGFyci5faXNCdWZmZXIgPSB0cnVlXG5cbiAgLy8gc2F2ZSByZWZlcmVuY2UgdG8gb3JpZ2luYWwgVWludDhBcnJheSBzZXQgbWV0aG9kIGJlZm9yZSBvdmVyd3JpdGluZ1xuICBhcnIuX3NldCA9IGFyci5zZXRcblxuICAvLyBkZXByZWNhdGVkLCB3aWxsIGJlIHJlbW92ZWQgaW4gbm9kZSAwLjEzK1xuICBhcnIuZ2V0ID0gQlAuZ2V0XG4gIGFyci5zZXQgPSBCUC5zZXRcblxuICBhcnIud3JpdGUgPSBCUC53cml0ZVxuICBhcnIudG9TdHJpbmcgPSBCUC50b1N0cmluZ1xuICBhcnIudG9Mb2NhbGVTdHJpbmcgPSBCUC50b1N0cmluZ1xuICBhcnIudG9KU09OID0gQlAudG9KU09OXG4gIGFyci5lcXVhbHMgPSBCUC5lcXVhbHNcbiAgYXJyLmNvbXBhcmUgPSBCUC5jb21wYXJlXG4gIGFyci5pbmRleE9mID0gQlAuaW5kZXhPZlxuICBhcnIuY29weSA9IEJQLmNvcHlcbiAgYXJyLnNsaWNlID0gQlAuc2xpY2VcbiAgYXJyLnJlYWRVSW50TEUgPSBCUC5yZWFkVUludExFXG4gIGFyci5yZWFkVUludEJFID0gQlAucmVhZFVJbnRCRVxuICBhcnIucmVhZFVJbnQ4ID0gQlAucmVhZFVJbnQ4XG4gIGFyci5yZWFkVUludDE2TEUgPSBCUC5yZWFkVUludDE2TEVcbiAgYXJyLnJlYWRVSW50MTZCRSA9IEJQLnJlYWRVSW50MTZCRVxuICBhcnIucmVhZFVJbnQzMkxFID0gQlAucmVhZFVJbnQzMkxFXG4gIGFyci5yZWFkVUludDMyQkUgPSBCUC5yZWFkVUludDMyQkVcbiAgYXJyLnJlYWRJbnRMRSA9IEJQLnJlYWRJbnRMRVxuICBhcnIucmVhZEludEJFID0gQlAucmVhZEludEJFXG4gIGFyci5yZWFkSW50OCA9IEJQLnJlYWRJbnQ4XG4gIGFyci5yZWFkSW50MTZMRSA9IEJQLnJlYWRJbnQxNkxFXG4gIGFyci5yZWFkSW50MTZCRSA9IEJQLnJlYWRJbnQxNkJFXG4gIGFyci5yZWFkSW50MzJMRSA9IEJQLnJlYWRJbnQzMkxFXG4gIGFyci5yZWFkSW50MzJCRSA9IEJQLnJlYWRJbnQzMkJFXG4gIGFyci5yZWFkRmxvYXRMRSA9IEJQLnJlYWRGbG9hdExFXG4gIGFyci5yZWFkRmxvYXRCRSA9IEJQLnJlYWRGbG9hdEJFXG4gIGFyci5yZWFkRG91YmxlTEUgPSBCUC5yZWFkRG91YmxlTEVcbiAgYXJyLnJlYWREb3VibGVCRSA9IEJQLnJlYWREb3VibGVCRVxuICBhcnIud3JpdGVVSW50OCA9IEJQLndyaXRlVUludDhcbiAgYXJyLndyaXRlVUludExFID0gQlAud3JpdGVVSW50TEVcbiAgYXJyLndyaXRlVUludEJFID0gQlAud3JpdGVVSW50QkVcbiAgYXJyLndyaXRlVUludDE2TEUgPSBCUC53cml0ZVVJbnQxNkxFXG4gIGFyci53cml0ZVVJbnQxNkJFID0gQlAud3JpdGVVSW50MTZCRVxuICBhcnIud3JpdGVVSW50MzJMRSA9IEJQLndyaXRlVUludDMyTEVcbiAgYXJyLndyaXRlVUludDMyQkUgPSBCUC53cml0ZVVJbnQzMkJFXG4gIGFyci53cml0ZUludExFID0gQlAud3JpdGVJbnRMRVxuICBhcnIud3JpdGVJbnRCRSA9IEJQLndyaXRlSW50QkVcbiAgYXJyLndyaXRlSW50OCA9IEJQLndyaXRlSW50OFxuICBhcnIud3JpdGVJbnQxNkxFID0gQlAud3JpdGVJbnQxNkxFXG4gIGFyci53cml0ZUludDE2QkUgPSBCUC53cml0ZUludDE2QkVcbiAgYXJyLndyaXRlSW50MzJMRSA9IEJQLndyaXRlSW50MzJMRVxuICBhcnIud3JpdGVJbnQzMkJFID0gQlAud3JpdGVJbnQzMkJFXG4gIGFyci53cml0ZUZsb2F0TEUgPSBCUC53cml0ZUZsb2F0TEVcbiAgYXJyLndyaXRlRmxvYXRCRSA9IEJQLndyaXRlRmxvYXRCRVxuICBhcnIud3JpdGVEb3VibGVMRSA9IEJQLndyaXRlRG91YmxlTEVcbiAgYXJyLndyaXRlRG91YmxlQkUgPSBCUC53cml0ZURvdWJsZUJFXG4gIGFyci5maWxsID0gQlAuZmlsbFxuICBhcnIuaW5zcGVjdCA9IEJQLmluc3BlY3RcbiAgYXJyLnRvQXJyYXlCdWZmZXIgPSBCUC50b0FycmF5QnVmZmVyXG5cbiAgcmV0dXJuIGFyclxufVxuXG52YXIgSU5WQUxJRF9CQVNFNjRfUkUgPSAvW14rXFwvMC05QS16XFwtXS9nXG5cbmZ1bmN0aW9uIGJhc2U2NGNsZWFuIChzdHIpIHtcbiAgLy8gTm9kZSBzdHJpcHMgb3V0IGludmFsaWQgY2hhcmFjdGVycyBsaWtlIFxcbiBhbmQgXFx0IGZyb20gdGhlIHN0cmluZywgYmFzZTY0LWpzIGRvZXMgbm90XG4gIHN0ciA9IHN0cmluZ3RyaW0oc3RyKS5yZXBsYWNlKElOVkFMSURfQkFTRTY0X1JFLCAnJylcbiAgLy8gTm9kZSBjb252ZXJ0cyBzdHJpbmdzIHdpdGggbGVuZ3RoIDwgMiB0byAnJ1xuICBpZiAoc3RyLmxlbmd0aCA8IDIpIHJldHVybiAnJ1xuICAvLyBOb2RlIGFsbG93cyBmb3Igbm9uLXBhZGRlZCBiYXNlNjQgc3RyaW5ncyAobWlzc2luZyB0cmFpbGluZyA9PT0pLCBiYXNlNjQtanMgZG9lcyBub3RcbiAgd2hpbGUgKHN0ci5sZW5ndGggJSA0ICE9PSAwKSB7XG4gICAgc3RyID0gc3RyICsgJz0nXG4gIH1cbiAgcmV0dXJuIHN0clxufVxuXG5mdW5jdGlvbiBzdHJpbmd0cmltIChzdHIpIHtcbiAgaWYgKHN0ci50cmltKSByZXR1cm4gc3RyLnRyaW0oKVxuICByZXR1cm4gc3RyLnJlcGxhY2UoL15cXHMrfFxccyskL2csICcnKVxufVxuXG5mdW5jdGlvbiB0b0hleCAobikge1xuICBpZiAobiA8IDE2KSByZXR1cm4gJzAnICsgbi50b1N0cmluZygxNilcbiAgcmV0dXJuIG4udG9TdHJpbmcoMTYpXG59XG5cbmZ1bmN0aW9uIHV0ZjhUb0J5dGVzIChzdHJpbmcsIHVuaXRzKSB7XG4gIHVuaXRzID0gdW5pdHMgfHwgSW5maW5pdHlcbiAgdmFyIGNvZGVQb2ludFxuICB2YXIgbGVuZ3RoID0gc3RyaW5nLmxlbmd0aFxuICB2YXIgbGVhZFN1cnJvZ2F0ZSA9IG51bGxcbiAgdmFyIGJ5dGVzID0gW11cbiAgdmFyIGkgPSAwXG5cbiAgZm9yICg7IGkgPCBsZW5ndGg7IGkrKykge1xuICAgIGNvZGVQb2ludCA9IHN0cmluZy5jaGFyQ29kZUF0KGkpXG5cbiAgICAvLyBpcyBzdXJyb2dhdGUgY29tcG9uZW50XG4gICAgaWYgKGNvZGVQb2ludCA+IDB4RDdGRiAmJiBjb2RlUG9pbnQgPCAweEUwMDApIHtcbiAgICAgIC8vIGxhc3QgY2hhciB3YXMgYSBsZWFkXG4gICAgICBpZiAobGVhZFN1cnJvZ2F0ZSkge1xuICAgICAgICAvLyAyIGxlYWRzIGluIGEgcm93XG4gICAgICAgIGlmIChjb2RlUG9pbnQgPCAweERDMDApIHtcbiAgICAgICAgICBpZiAoKHVuaXRzIC09IDMpID4gLTEpIGJ5dGVzLnB1c2goMHhFRiwgMHhCRiwgMHhCRClcbiAgICAgICAgICBsZWFkU3Vycm9nYXRlID0gY29kZVBvaW50XG4gICAgICAgICAgY29udGludWVcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAvLyB2YWxpZCBzdXJyb2dhdGUgcGFpclxuICAgICAgICAgIGNvZGVQb2ludCA9IGxlYWRTdXJyb2dhdGUgLSAweEQ4MDAgPDwgMTAgfCBjb2RlUG9pbnQgLSAweERDMDAgfCAweDEwMDAwXG4gICAgICAgICAgbGVhZFN1cnJvZ2F0ZSA9IG51bGxcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgLy8gbm8gbGVhZCB5ZXRcblxuICAgICAgICBpZiAoY29kZVBvaW50ID4gMHhEQkZGKSB7XG4gICAgICAgICAgLy8gdW5leHBlY3RlZCB0cmFpbFxuICAgICAgICAgIGlmICgodW5pdHMgLT0gMykgPiAtMSkgYnl0ZXMucHVzaCgweEVGLCAweEJGLCAweEJEKVxuICAgICAgICAgIGNvbnRpbnVlXG4gICAgICAgIH0gZWxzZSBpZiAoaSArIDEgPT09IGxlbmd0aCkge1xuICAgICAgICAgIC8vIHVucGFpcmVkIGxlYWRcbiAgICAgICAgICBpZiAoKHVuaXRzIC09IDMpID4gLTEpIGJ5dGVzLnB1c2goMHhFRiwgMHhCRiwgMHhCRClcbiAgICAgICAgICBjb250aW51ZVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIC8vIHZhbGlkIGxlYWRcbiAgICAgICAgICBsZWFkU3Vycm9nYXRlID0gY29kZVBvaW50XG4gICAgICAgICAgY29udGludWVcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0gZWxzZSBpZiAobGVhZFN1cnJvZ2F0ZSkge1xuICAgICAgLy8gdmFsaWQgYm1wIGNoYXIsIGJ1dCBsYXN0IGNoYXIgd2FzIGEgbGVhZFxuICAgICAgaWYgKCh1bml0cyAtPSAzKSA+IC0xKSBieXRlcy5wdXNoKDB4RUYsIDB4QkYsIDB4QkQpXG4gICAgICBsZWFkU3Vycm9nYXRlID0gbnVsbFxuICAgIH1cblxuICAgIC8vIGVuY29kZSB1dGY4XG4gICAgaWYgKGNvZGVQb2ludCA8IDB4ODApIHtcbiAgICAgIGlmICgodW5pdHMgLT0gMSkgPCAwKSBicmVha1xuICAgICAgYnl0ZXMucHVzaChjb2RlUG9pbnQpXG4gICAgfSBlbHNlIGlmIChjb2RlUG9pbnQgPCAweDgwMCkge1xuICAgICAgaWYgKCh1bml0cyAtPSAyKSA8IDApIGJyZWFrXG4gICAgICBieXRlcy5wdXNoKFxuICAgICAgICBjb2RlUG9pbnQgPj4gMHg2IHwgMHhDMCxcbiAgICAgICAgY29kZVBvaW50ICYgMHgzRiB8IDB4ODBcbiAgICAgIClcbiAgICB9IGVsc2UgaWYgKGNvZGVQb2ludCA8IDB4MTAwMDApIHtcbiAgICAgIGlmICgodW5pdHMgLT0gMykgPCAwKSBicmVha1xuICAgICAgYnl0ZXMucHVzaChcbiAgICAgICAgY29kZVBvaW50ID4+IDB4QyB8IDB4RTAsXG4gICAgICAgIGNvZGVQb2ludCA+PiAweDYgJiAweDNGIHwgMHg4MCxcbiAgICAgICAgY29kZVBvaW50ICYgMHgzRiB8IDB4ODBcbiAgICAgIClcbiAgICB9IGVsc2UgaWYgKGNvZGVQb2ludCA8IDB4MjAwMDAwKSB7XG4gICAgICBpZiAoKHVuaXRzIC09IDQpIDwgMCkgYnJlYWtcbiAgICAgIGJ5dGVzLnB1c2goXG4gICAgICAgIGNvZGVQb2ludCA+PiAweDEyIHwgMHhGMCxcbiAgICAgICAgY29kZVBvaW50ID4+IDB4QyAmIDB4M0YgfCAweDgwLFxuICAgICAgICBjb2RlUG9pbnQgPj4gMHg2ICYgMHgzRiB8IDB4ODAsXG4gICAgICAgIGNvZGVQb2ludCAmIDB4M0YgfCAweDgwXG4gICAgICApXG4gICAgfSBlbHNlIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignSW52YWxpZCBjb2RlIHBvaW50JylcbiAgICB9XG4gIH1cblxuICByZXR1cm4gYnl0ZXNcbn1cblxuZnVuY3Rpb24gYXNjaWlUb0J5dGVzIChzdHIpIHtcbiAgdmFyIGJ5dGVBcnJheSA9IFtdXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgc3RyLmxlbmd0aDsgaSsrKSB7XG4gICAgLy8gTm9kZSdzIGNvZGUgc2VlbXMgdG8gYmUgZG9pbmcgdGhpcyBhbmQgbm90ICYgMHg3Ri4uXG4gICAgYnl0ZUFycmF5LnB1c2goc3RyLmNoYXJDb2RlQXQoaSkgJiAweEZGKVxuICB9XG4gIHJldHVybiBieXRlQXJyYXlcbn1cblxuZnVuY3Rpb24gdXRmMTZsZVRvQnl0ZXMgKHN0ciwgdW5pdHMpIHtcbiAgdmFyIGMsIGhpLCBsb1xuICB2YXIgYnl0ZUFycmF5ID0gW11cbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBzdHIubGVuZ3RoOyBpKyspIHtcbiAgICBpZiAoKHVuaXRzIC09IDIpIDwgMCkgYnJlYWtcblxuICAgIGMgPSBzdHIuY2hhckNvZGVBdChpKVxuICAgIGhpID0gYyA+PiA4XG4gICAgbG8gPSBjICUgMjU2XG4gICAgYnl0ZUFycmF5LnB1c2gobG8pXG4gICAgYnl0ZUFycmF5LnB1c2goaGkpXG4gIH1cblxuICByZXR1cm4gYnl0ZUFycmF5XG59XG5cbmZ1bmN0aW9uIGJhc2U2NFRvQnl0ZXMgKHN0cikge1xuICByZXR1cm4gYmFzZTY0LnRvQnl0ZUFycmF5KGJhc2U2NGNsZWFuKHN0cikpXG59XG5cbmZ1bmN0aW9uIGJsaXRCdWZmZXIgKHNyYywgZHN0LCBvZmZzZXQsIGxlbmd0aCkge1xuICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbmd0aDsgaSsrKSB7XG4gICAgaWYgKChpICsgb2Zmc2V0ID49IGRzdC5sZW5ndGgpIHx8IChpID49IHNyYy5sZW5ndGgpKSBicmVha1xuICAgIGRzdFtpICsgb2Zmc2V0XSA9IHNyY1tpXVxuICB9XG4gIHJldHVybiBpXG59XG5cbmZ1bmN0aW9uIGRlY29kZVV0ZjhDaGFyIChzdHIpIHtcbiAgdHJ5IHtcbiAgICByZXR1cm4gZGVjb2RlVVJJQ29tcG9uZW50KHN0cilcbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgcmV0dXJuIFN0cmluZy5mcm9tQ2hhckNvZGUoMHhGRkZEKSAvLyBVVEYgOCBpbnZhbGlkIGNoYXJcbiAgfVxufVxuIiwidmFyIGxvb2t1cCA9ICdBQkNERUZHSElKS0xNTk9QUVJTVFVWV1hZWmFiY2RlZmdoaWprbG1ub3BxcnN0dXZ3eHl6MDEyMzQ1Njc4OSsvJztcblxuOyhmdW5jdGlvbiAoZXhwb3J0cykge1xuXHQndXNlIHN0cmljdCc7XG5cbiAgdmFyIEFyciA9ICh0eXBlb2YgVWludDhBcnJheSAhPT0gJ3VuZGVmaW5lZCcpXG4gICAgPyBVaW50OEFycmF5XG4gICAgOiBBcnJheVxuXG5cdHZhciBQTFVTICAgPSAnKycuY2hhckNvZGVBdCgwKVxuXHR2YXIgU0xBU0ggID0gJy8nLmNoYXJDb2RlQXQoMClcblx0dmFyIE5VTUJFUiA9ICcwJy5jaGFyQ29kZUF0KDApXG5cdHZhciBMT1dFUiAgPSAnYScuY2hhckNvZGVBdCgwKVxuXHR2YXIgVVBQRVIgID0gJ0EnLmNoYXJDb2RlQXQoMClcblx0dmFyIFBMVVNfVVJMX1NBRkUgPSAnLScuY2hhckNvZGVBdCgwKVxuXHR2YXIgU0xBU0hfVVJMX1NBRkUgPSAnXycuY2hhckNvZGVBdCgwKVxuXG5cdGZ1bmN0aW9uIGRlY29kZSAoZWx0KSB7XG5cdFx0dmFyIGNvZGUgPSBlbHQuY2hhckNvZGVBdCgwKVxuXHRcdGlmIChjb2RlID09PSBQTFVTIHx8XG5cdFx0ICAgIGNvZGUgPT09IFBMVVNfVVJMX1NBRkUpXG5cdFx0XHRyZXR1cm4gNjIgLy8gJysnXG5cdFx0aWYgKGNvZGUgPT09IFNMQVNIIHx8XG5cdFx0ICAgIGNvZGUgPT09IFNMQVNIX1VSTF9TQUZFKVxuXHRcdFx0cmV0dXJuIDYzIC8vICcvJ1xuXHRcdGlmIChjb2RlIDwgTlVNQkVSKVxuXHRcdFx0cmV0dXJuIC0xIC8vbm8gbWF0Y2hcblx0XHRpZiAoY29kZSA8IE5VTUJFUiArIDEwKVxuXHRcdFx0cmV0dXJuIGNvZGUgLSBOVU1CRVIgKyAyNiArIDI2XG5cdFx0aWYgKGNvZGUgPCBVUFBFUiArIDI2KVxuXHRcdFx0cmV0dXJuIGNvZGUgLSBVUFBFUlxuXHRcdGlmIChjb2RlIDwgTE9XRVIgKyAyNilcblx0XHRcdHJldHVybiBjb2RlIC0gTE9XRVIgKyAyNlxuXHR9XG5cblx0ZnVuY3Rpb24gYjY0VG9CeXRlQXJyYXkgKGI2NCkge1xuXHRcdHZhciBpLCBqLCBsLCB0bXAsIHBsYWNlSG9sZGVycywgYXJyXG5cblx0XHRpZiAoYjY0Lmxlbmd0aCAlIDQgPiAwKSB7XG5cdFx0XHR0aHJvdyBuZXcgRXJyb3IoJ0ludmFsaWQgc3RyaW5nLiBMZW5ndGggbXVzdCBiZSBhIG11bHRpcGxlIG9mIDQnKVxuXHRcdH1cblxuXHRcdC8vIHRoZSBudW1iZXIgb2YgZXF1YWwgc2lnbnMgKHBsYWNlIGhvbGRlcnMpXG5cdFx0Ly8gaWYgdGhlcmUgYXJlIHR3byBwbGFjZWhvbGRlcnMsIHRoYW4gdGhlIHR3byBjaGFyYWN0ZXJzIGJlZm9yZSBpdFxuXHRcdC8vIHJlcHJlc2VudCBvbmUgYnl0ZVxuXHRcdC8vIGlmIHRoZXJlIGlzIG9ubHkgb25lLCB0aGVuIHRoZSB0aHJlZSBjaGFyYWN0ZXJzIGJlZm9yZSBpdCByZXByZXNlbnQgMiBieXRlc1xuXHRcdC8vIHRoaXMgaXMganVzdCBhIGNoZWFwIGhhY2sgdG8gbm90IGRvIGluZGV4T2YgdHdpY2Vcblx0XHR2YXIgbGVuID0gYjY0Lmxlbmd0aFxuXHRcdHBsYWNlSG9sZGVycyA9ICc9JyA9PT0gYjY0LmNoYXJBdChsZW4gLSAyKSA/IDIgOiAnPScgPT09IGI2NC5jaGFyQXQobGVuIC0gMSkgPyAxIDogMFxuXG5cdFx0Ly8gYmFzZTY0IGlzIDQvMyArIHVwIHRvIHR3byBjaGFyYWN0ZXJzIG9mIHRoZSBvcmlnaW5hbCBkYXRhXG5cdFx0YXJyID0gbmV3IEFycihiNjQubGVuZ3RoICogMyAvIDQgLSBwbGFjZUhvbGRlcnMpXG5cblx0XHQvLyBpZiB0aGVyZSBhcmUgcGxhY2Vob2xkZXJzLCBvbmx5IGdldCB1cCB0byB0aGUgbGFzdCBjb21wbGV0ZSA0IGNoYXJzXG5cdFx0bCA9IHBsYWNlSG9sZGVycyA+IDAgPyBiNjQubGVuZ3RoIC0gNCA6IGI2NC5sZW5ndGhcblxuXHRcdHZhciBMID0gMFxuXG5cdFx0ZnVuY3Rpb24gcHVzaCAodikge1xuXHRcdFx0YXJyW0wrK10gPSB2XG5cdFx0fVxuXG5cdFx0Zm9yIChpID0gMCwgaiA9IDA7IGkgPCBsOyBpICs9IDQsIGogKz0gMykge1xuXHRcdFx0dG1wID0gKGRlY29kZShiNjQuY2hhckF0KGkpKSA8PCAxOCkgfCAoZGVjb2RlKGI2NC5jaGFyQXQoaSArIDEpKSA8PCAxMikgfCAoZGVjb2RlKGI2NC5jaGFyQXQoaSArIDIpKSA8PCA2KSB8IGRlY29kZShiNjQuY2hhckF0KGkgKyAzKSlcblx0XHRcdHB1c2goKHRtcCAmIDB4RkYwMDAwKSA+PiAxNilcblx0XHRcdHB1c2goKHRtcCAmIDB4RkYwMCkgPj4gOClcblx0XHRcdHB1c2godG1wICYgMHhGRilcblx0XHR9XG5cblx0XHRpZiAocGxhY2VIb2xkZXJzID09PSAyKSB7XG5cdFx0XHR0bXAgPSAoZGVjb2RlKGI2NC5jaGFyQXQoaSkpIDw8IDIpIHwgKGRlY29kZShiNjQuY2hhckF0KGkgKyAxKSkgPj4gNClcblx0XHRcdHB1c2godG1wICYgMHhGRilcblx0XHR9IGVsc2UgaWYgKHBsYWNlSG9sZGVycyA9PT0gMSkge1xuXHRcdFx0dG1wID0gKGRlY29kZShiNjQuY2hhckF0KGkpKSA8PCAxMCkgfCAoZGVjb2RlKGI2NC5jaGFyQXQoaSArIDEpKSA8PCA0KSB8IChkZWNvZGUoYjY0LmNoYXJBdChpICsgMikpID4+IDIpXG5cdFx0XHRwdXNoKCh0bXAgPj4gOCkgJiAweEZGKVxuXHRcdFx0cHVzaCh0bXAgJiAweEZGKVxuXHRcdH1cblxuXHRcdHJldHVybiBhcnJcblx0fVxuXG5cdGZ1bmN0aW9uIHVpbnQ4VG9CYXNlNjQgKHVpbnQ4KSB7XG5cdFx0dmFyIGksXG5cdFx0XHRleHRyYUJ5dGVzID0gdWludDgubGVuZ3RoICUgMywgLy8gaWYgd2UgaGF2ZSAxIGJ5dGUgbGVmdCwgcGFkIDIgYnl0ZXNcblx0XHRcdG91dHB1dCA9IFwiXCIsXG5cdFx0XHR0ZW1wLCBsZW5ndGhcblxuXHRcdGZ1bmN0aW9uIGVuY29kZSAobnVtKSB7XG5cdFx0XHRyZXR1cm4gbG9va3VwLmNoYXJBdChudW0pXG5cdFx0fVxuXG5cdFx0ZnVuY3Rpb24gdHJpcGxldFRvQmFzZTY0IChudW0pIHtcblx0XHRcdHJldHVybiBlbmNvZGUobnVtID4+IDE4ICYgMHgzRikgKyBlbmNvZGUobnVtID4+IDEyICYgMHgzRikgKyBlbmNvZGUobnVtID4+IDYgJiAweDNGKSArIGVuY29kZShudW0gJiAweDNGKVxuXHRcdH1cblxuXHRcdC8vIGdvIHRocm91Z2ggdGhlIGFycmF5IGV2ZXJ5IHRocmVlIGJ5dGVzLCB3ZSdsbCBkZWFsIHdpdGggdHJhaWxpbmcgc3R1ZmYgbGF0ZXJcblx0XHRmb3IgKGkgPSAwLCBsZW5ndGggPSB1aW50OC5sZW5ndGggLSBleHRyYUJ5dGVzOyBpIDwgbGVuZ3RoOyBpICs9IDMpIHtcblx0XHRcdHRlbXAgPSAodWludDhbaV0gPDwgMTYpICsgKHVpbnQ4W2kgKyAxXSA8PCA4KSArICh1aW50OFtpICsgMl0pXG5cdFx0XHRvdXRwdXQgKz0gdHJpcGxldFRvQmFzZTY0KHRlbXApXG5cdFx0fVxuXG5cdFx0Ly8gcGFkIHRoZSBlbmQgd2l0aCB6ZXJvcywgYnV0IG1ha2Ugc3VyZSB0byBub3QgZm9yZ2V0IHRoZSBleHRyYSBieXRlc1xuXHRcdHN3aXRjaCAoZXh0cmFCeXRlcykge1xuXHRcdFx0Y2FzZSAxOlxuXHRcdFx0XHR0ZW1wID0gdWludDhbdWludDgubGVuZ3RoIC0gMV1cblx0XHRcdFx0b3V0cHV0ICs9IGVuY29kZSh0ZW1wID4+IDIpXG5cdFx0XHRcdG91dHB1dCArPSBlbmNvZGUoKHRlbXAgPDwgNCkgJiAweDNGKVxuXHRcdFx0XHRvdXRwdXQgKz0gJz09J1xuXHRcdFx0XHRicmVha1xuXHRcdFx0Y2FzZSAyOlxuXHRcdFx0XHR0ZW1wID0gKHVpbnQ4W3VpbnQ4Lmxlbmd0aCAtIDJdIDw8IDgpICsgKHVpbnQ4W3VpbnQ4Lmxlbmd0aCAtIDFdKVxuXHRcdFx0XHRvdXRwdXQgKz0gZW5jb2RlKHRlbXAgPj4gMTApXG5cdFx0XHRcdG91dHB1dCArPSBlbmNvZGUoKHRlbXAgPj4gNCkgJiAweDNGKVxuXHRcdFx0XHRvdXRwdXQgKz0gZW5jb2RlKCh0ZW1wIDw8IDIpICYgMHgzRilcblx0XHRcdFx0b3V0cHV0ICs9ICc9J1xuXHRcdFx0XHRicmVha1xuXHRcdH1cblxuXHRcdHJldHVybiBvdXRwdXRcblx0fVxuXG5cdGV4cG9ydHMudG9CeXRlQXJyYXkgPSBiNjRUb0J5dGVBcnJheVxuXHRleHBvcnRzLmZyb21CeXRlQXJyYXkgPSB1aW50OFRvQmFzZTY0XG59KHR5cGVvZiBleHBvcnRzID09PSAndW5kZWZpbmVkJyA/ICh0aGlzLmJhc2U2NGpzID0ge30pIDogZXhwb3J0cykpXG4iLCJleHBvcnRzLnJlYWQgPSBmdW5jdGlvbiAoYnVmZmVyLCBvZmZzZXQsIGlzTEUsIG1MZW4sIG5CeXRlcykge1xuICB2YXIgZSwgbVxuICB2YXIgZUxlbiA9IG5CeXRlcyAqIDggLSBtTGVuIC0gMVxuICB2YXIgZU1heCA9ICgxIDw8IGVMZW4pIC0gMVxuICB2YXIgZUJpYXMgPSBlTWF4ID4+IDFcbiAgdmFyIG5CaXRzID0gLTdcbiAgdmFyIGkgPSBpc0xFID8gKG5CeXRlcyAtIDEpIDogMFxuICB2YXIgZCA9IGlzTEUgPyAtMSA6IDFcbiAgdmFyIHMgPSBidWZmZXJbb2Zmc2V0ICsgaV1cblxuICBpICs9IGRcblxuICBlID0gcyAmICgoMSA8PCAoLW5CaXRzKSkgLSAxKVxuICBzID4+PSAoLW5CaXRzKVxuICBuQml0cyArPSBlTGVuXG4gIGZvciAoOyBuQml0cyA+IDA7IGUgPSBlICogMjU2ICsgYnVmZmVyW29mZnNldCArIGldLCBpICs9IGQsIG5CaXRzIC09IDgpIHt9XG5cbiAgbSA9IGUgJiAoKDEgPDwgKC1uQml0cykpIC0gMSlcbiAgZSA+Pj0gKC1uQml0cylcbiAgbkJpdHMgKz0gbUxlblxuICBmb3IgKDsgbkJpdHMgPiAwOyBtID0gbSAqIDI1NiArIGJ1ZmZlcltvZmZzZXQgKyBpXSwgaSArPSBkLCBuQml0cyAtPSA4KSB7fVxuXG4gIGlmIChlID09PSAwKSB7XG4gICAgZSA9IDEgLSBlQmlhc1xuICB9IGVsc2UgaWYgKGUgPT09IGVNYXgpIHtcbiAgICByZXR1cm4gbSA/IE5hTiA6ICgocyA/IC0xIDogMSkgKiBJbmZpbml0eSlcbiAgfSBlbHNlIHtcbiAgICBtID0gbSArIE1hdGgucG93KDIsIG1MZW4pXG4gICAgZSA9IGUgLSBlQmlhc1xuICB9XG4gIHJldHVybiAocyA/IC0xIDogMSkgKiBtICogTWF0aC5wb3coMiwgZSAtIG1MZW4pXG59XG5cbmV4cG9ydHMud3JpdGUgPSBmdW5jdGlvbiAoYnVmZmVyLCB2YWx1ZSwgb2Zmc2V0LCBpc0xFLCBtTGVuLCBuQnl0ZXMpIHtcbiAgdmFyIGUsIG0sIGNcbiAgdmFyIGVMZW4gPSBuQnl0ZXMgKiA4IC0gbUxlbiAtIDFcbiAgdmFyIGVNYXggPSAoMSA8PCBlTGVuKSAtIDFcbiAgdmFyIGVCaWFzID0gZU1heCA+PiAxXG4gIHZhciBydCA9IChtTGVuID09PSAyMyA/IE1hdGgucG93KDIsIC0yNCkgLSBNYXRoLnBvdygyLCAtNzcpIDogMClcbiAgdmFyIGkgPSBpc0xFID8gMCA6IChuQnl0ZXMgLSAxKVxuICB2YXIgZCA9IGlzTEUgPyAxIDogLTFcbiAgdmFyIHMgPSB2YWx1ZSA8IDAgfHwgKHZhbHVlID09PSAwICYmIDEgLyB2YWx1ZSA8IDApID8gMSA6IDBcblxuICB2YWx1ZSA9IE1hdGguYWJzKHZhbHVlKVxuXG4gIGlmIChpc05hTih2YWx1ZSkgfHwgdmFsdWUgPT09IEluZmluaXR5KSB7XG4gICAgbSA9IGlzTmFOKHZhbHVlKSA/IDEgOiAwXG4gICAgZSA9IGVNYXhcbiAgfSBlbHNlIHtcbiAgICBlID0gTWF0aC5mbG9vcihNYXRoLmxvZyh2YWx1ZSkgLyBNYXRoLkxOMilcbiAgICBpZiAodmFsdWUgKiAoYyA9IE1hdGgucG93KDIsIC1lKSkgPCAxKSB7XG4gICAgICBlLS1cbiAgICAgIGMgKj0gMlxuICAgIH1cbiAgICBpZiAoZSArIGVCaWFzID49IDEpIHtcbiAgICAgIHZhbHVlICs9IHJ0IC8gY1xuICAgIH0gZWxzZSB7XG4gICAgICB2YWx1ZSArPSBydCAqIE1hdGgucG93KDIsIDEgLSBlQmlhcylcbiAgICB9XG4gICAgaWYgKHZhbHVlICogYyA+PSAyKSB7XG4gICAgICBlKytcbiAgICAgIGMgLz0gMlxuICAgIH1cblxuICAgIGlmIChlICsgZUJpYXMgPj0gZU1heCkge1xuICAgICAgbSA9IDBcbiAgICAgIGUgPSBlTWF4XG4gICAgfSBlbHNlIGlmIChlICsgZUJpYXMgPj0gMSkge1xuICAgICAgbSA9ICh2YWx1ZSAqIGMgLSAxKSAqIE1hdGgucG93KDIsIG1MZW4pXG4gICAgICBlID0gZSArIGVCaWFzXG4gICAgfSBlbHNlIHtcbiAgICAgIG0gPSB2YWx1ZSAqIE1hdGgucG93KDIsIGVCaWFzIC0gMSkgKiBNYXRoLnBvdygyLCBtTGVuKVxuICAgICAgZSA9IDBcbiAgICB9XG4gIH1cblxuICBmb3IgKDsgbUxlbiA+PSA4OyBidWZmZXJbb2Zmc2V0ICsgaV0gPSBtICYgMHhmZiwgaSArPSBkLCBtIC89IDI1NiwgbUxlbiAtPSA4KSB7fVxuXG4gIGUgPSAoZSA8PCBtTGVuKSB8IG1cbiAgZUxlbiArPSBtTGVuXG4gIGZvciAoOyBlTGVuID4gMDsgYnVmZmVyW29mZnNldCArIGldID0gZSAmIDB4ZmYsIGkgKz0gZCwgZSAvPSAyNTYsIGVMZW4gLT0gOCkge31cblxuICBidWZmZXJbb2Zmc2V0ICsgaSAtIGRdIHw9IHMgKiAxMjhcbn1cbiIsIlxuLyoqXG4gKiBpc0FycmF5XG4gKi9cblxudmFyIGlzQXJyYXkgPSBBcnJheS5pc0FycmF5O1xuXG4vKipcbiAqIHRvU3RyaW5nXG4gKi9cblxudmFyIHN0ciA9IE9iamVjdC5wcm90b3R5cGUudG9TdHJpbmc7XG5cbi8qKlxuICogV2hldGhlciBvciBub3QgdGhlIGdpdmVuIGB2YWxgXG4gKiBpcyBhbiBhcnJheS5cbiAqXG4gKiBleGFtcGxlOlxuICpcbiAqICAgICAgICBpc0FycmF5KFtdKTtcbiAqICAgICAgICAvLyA+IHRydWVcbiAqICAgICAgICBpc0FycmF5KGFyZ3VtZW50cyk7XG4gKiAgICAgICAgLy8gPiBmYWxzZVxuICogICAgICAgIGlzQXJyYXkoJycpO1xuICogICAgICAgIC8vID4gZmFsc2VcbiAqXG4gKiBAcGFyYW0ge21peGVkfSB2YWxcbiAqIEByZXR1cm4ge2Jvb2x9XG4gKi9cblxubW9kdWxlLmV4cG9ydHMgPSBpc0FycmF5IHx8IGZ1bmN0aW9uICh2YWwpIHtcbiAgcmV0dXJuICEhIHZhbCAmJiAnW29iamVjdCBBcnJheV0nID09IHN0ci5jYWxsKHZhbCk7XG59O1xuIiwiLy8gc2hpbSBmb3IgdXNpbmcgcHJvY2VzcyBpbiBicm93c2VyXG5cbnZhciBwcm9jZXNzID0gbW9kdWxlLmV4cG9ydHMgPSB7fTtcbnZhciBxdWV1ZSA9IFtdO1xudmFyIGRyYWluaW5nID0gZmFsc2U7XG52YXIgY3VycmVudFF1ZXVlO1xudmFyIHF1ZXVlSW5kZXggPSAtMTtcblxuZnVuY3Rpb24gY2xlYW5VcE5leHRUaWNrKCkge1xuICAgIGRyYWluaW5nID0gZmFsc2U7XG4gICAgaWYgKGN1cnJlbnRRdWV1ZS5sZW5ndGgpIHtcbiAgICAgICAgcXVldWUgPSBjdXJyZW50UXVldWUuY29uY2F0KHF1ZXVlKTtcbiAgICB9IGVsc2Uge1xuICAgICAgICBxdWV1ZUluZGV4ID0gLTE7XG4gICAgfVxuICAgIGlmIChxdWV1ZS5sZW5ndGgpIHtcbiAgICAgICAgZHJhaW5RdWV1ZSgpO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gZHJhaW5RdWV1ZSgpIHtcbiAgICBpZiAoZHJhaW5pbmcpIHtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB2YXIgdGltZW91dCA9IHNldFRpbWVvdXQoY2xlYW5VcE5leHRUaWNrKTtcbiAgICBkcmFpbmluZyA9IHRydWU7XG5cbiAgICB2YXIgbGVuID0gcXVldWUubGVuZ3RoO1xuICAgIHdoaWxlKGxlbikge1xuICAgICAgICBjdXJyZW50UXVldWUgPSBxdWV1ZTtcbiAgICAgICAgcXVldWUgPSBbXTtcbiAgICAgICAgd2hpbGUgKCsrcXVldWVJbmRleCA8IGxlbikge1xuICAgICAgICAgICAgY3VycmVudFF1ZXVlW3F1ZXVlSW5kZXhdLnJ1bigpO1xuICAgICAgICB9XG4gICAgICAgIHF1ZXVlSW5kZXggPSAtMTtcbiAgICAgICAgbGVuID0gcXVldWUubGVuZ3RoO1xuICAgIH1cbiAgICBjdXJyZW50UXVldWUgPSBudWxsO1xuICAgIGRyYWluaW5nID0gZmFsc2U7XG4gICAgY2xlYXJUaW1lb3V0KHRpbWVvdXQpO1xufVxuXG5wcm9jZXNzLm5leHRUaWNrID0gZnVuY3Rpb24gKGZ1bikge1xuICAgIHZhciBhcmdzID0gbmV3IEFycmF5KGFyZ3VtZW50cy5sZW5ndGggLSAxKTtcbiAgICBpZiAoYXJndW1lbnRzLmxlbmd0aCA+IDEpIHtcbiAgICAgICAgZm9yICh2YXIgaSA9IDE7IGkgPCBhcmd1bWVudHMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIGFyZ3NbaSAtIDFdID0gYXJndW1lbnRzW2ldO1xuICAgICAgICB9XG4gICAgfVxuICAgIHF1ZXVlLnB1c2gobmV3IEl0ZW0oZnVuLCBhcmdzKSk7XG4gICAgaWYgKHF1ZXVlLmxlbmd0aCA9PT0gMSAmJiAhZHJhaW5pbmcpIHtcbiAgICAgICAgc2V0VGltZW91dChkcmFpblF1ZXVlLCAwKTtcbiAgICB9XG59O1xuXG4vLyB2OCBsaWtlcyBwcmVkaWN0aWJsZSBvYmplY3RzXG5mdW5jdGlvbiBJdGVtKGZ1biwgYXJyYXkpIHtcbiAgICB0aGlzLmZ1biA9IGZ1bjtcbiAgICB0aGlzLmFycmF5ID0gYXJyYXk7XG59XG5JdGVtLnByb3RvdHlwZS5ydW4gPSBmdW5jdGlvbiAoKSB7XG4gICAgdGhpcy5mdW4uYXBwbHkobnVsbCwgdGhpcy5hcnJheSk7XG59O1xucHJvY2Vzcy50aXRsZSA9ICdicm93c2VyJztcbnByb2Nlc3MuYnJvd3NlciA9IHRydWU7XG5wcm9jZXNzLmVudiA9IHt9O1xucHJvY2Vzcy5hcmd2ID0gW107XG5wcm9jZXNzLnZlcnNpb24gPSAnJzsgLy8gZW1wdHkgc3RyaW5nIHRvIGF2b2lkIHJlZ2V4cCBpc3N1ZXNcbnByb2Nlc3MudmVyc2lvbnMgPSB7fTtcblxuZnVuY3Rpb24gbm9vcCgpIHt9XG5cbnByb2Nlc3Mub24gPSBub29wO1xucHJvY2Vzcy5hZGRMaXN0ZW5lciA9IG5vb3A7XG5wcm9jZXNzLm9uY2UgPSBub29wO1xucHJvY2Vzcy5vZmYgPSBub29wO1xucHJvY2Vzcy5yZW1vdmVMaXN0ZW5lciA9IG5vb3A7XG5wcm9jZXNzLnJlbW92ZUFsbExpc3RlbmVycyA9IG5vb3A7XG5wcm9jZXNzLmVtaXQgPSBub29wO1xuXG5wcm9jZXNzLmJpbmRpbmcgPSBmdW5jdGlvbiAobmFtZSkge1xuICAgIHRocm93IG5ldyBFcnJvcigncHJvY2Vzcy5iaW5kaW5nIGlzIG5vdCBzdXBwb3J0ZWQnKTtcbn07XG5cbi8vIFRPRE8oc2h0eWxtYW4pXG5wcm9jZXNzLmN3ZCA9IGZ1bmN0aW9uICgpIHsgcmV0dXJuICcvJyB9O1xucHJvY2Vzcy5jaGRpciA9IGZ1bmN0aW9uIChkaXIpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ3Byb2Nlc3MuY2hkaXIgaXMgbm90IHN1cHBvcnRlZCcpO1xufTtcbnByb2Nlc3MudW1hc2sgPSBmdW5jdGlvbigpIHsgcmV0dXJuIDA7IH07XG4iLCJyZXF1aXJlKCdqb29zZScpO1xyXG52YXIgVXRpbHMgPSByZXF1aXJlKCcuL1V0aWxzJyk7XHJcbnZhciBDT05GSUcgPSByZXF1aXJlKCcuL0NvbmZpZycpO1xyXG5DbGFzcyhcIkJhY2tlbmRTdHJlYW1cIixcclxue1xyXG4gICAgaGFzOlxyXG4gICAge1xyXG5cdFx0dXJsIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6ICh3aW5kb3cubG9jYXRpb24uaG9zdC5pbmRleE9mKFwibG9jYWxob3N0XCIpID09IDAgfHwgd2luZG93LmxvY2F0aW9uLmhvc3QuaW5kZXhPZihcIjEyNy4wLjAuMVwiKSA9PSAwKSA/IFwiaHR0cDovL2xvY2FsaG9zdDozMDAwL3N0cmVhbVwiIDogXCJub2RlL3N0cmVhbVwiXHJcblx0XHR9LFxyXG4gICAgfSxcclxuICAgIC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuICAgIG1ldGhvZHM6XHJcbiAgICB7XHJcbiAgICAgICAgc3RhcnQgOiBmdW5jdGlvbih0cmFjaylcclxuICAgICAgICB7ICAgIFxyXG4gICAgICAgIFx0dHJhY2sudGVzdDEoKTtcclxuICAgICAgICBcdC8vIFRFU1RcclxuICAgICAgICBcdGlmICgwID09IDEpIFxyXG4gICAgICAgIFx0e1xyXG4gICAgICAgIFx0XHR2YXIgY3RpbWUgPSAobmV3IERhdGUoKSkuZ2V0VGltZSgpO1xyXG4gICAgICAgIFx0XHR2YXIgY2M9MDtcclxuICAgICAgICBcdFx0c2V0SW50ZXJ2YWwoZnVuY3Rpb24oKSBcclxuICAgICAgICBcdFx0e1xyXG4gICAgICAgIFx0XHRcdGNjKys7XHJcbiAgICAgICAgICAgICAgICAgICAgZm9yICh2YXIgaSBpbiB0cmFjay5wYXJ0aWNpcGFudHMpIFxyXG4gICAgICAgICAgICAgICAgICAgIHtcclxuICAgICAgICAgICAgICAgICAgICBcdHZhciBkaWZmID0gKChuZXcgRGF0ZSgpKS5nZXRUaW1lKCktY3RpbWUpLzEwMDA7IC8vIHNlY29uZHNcclxuICAgICAgICBcdFx0XHRcdHZhciBlbHAgPSBjYy82MC4wOyAgXHJcbiAgICAgICAgICAgICAgICAgICAgXHRpZiAoZWxwID4gMSlcclxuICAgICAgICAgICAgICAgICAgICBcdFx0ZWxwPTE7XHJcbiAgICAgICAgICAgICAgICAgICAgXHR2YXIgcHAgPSB0cmFjay5wYXJ0aWNpcGFudHNbaV07XHJcbiAgICAgICAgICAgICAgICAgICAgXHQvL3ZhciBwb3MgPSB0cmFjay5fX2dldFBvc2l0aW9uQW5kUm90YXRpb25Gcm9tRWxhcHNlZChlbHApO1xyXG4gICAgICAgICAgICAgICAgICAgIFx0dmFyIHBvcyA9IHRyYWNrLmdldFBvc2l0aW9uQW5kUm90YXRpb25Gcm9tRWxhcHNlZChlbHApO1xyXG4gICAgICAgICAgICAgICAgICAgIFx0cHAucGluZ0NhbGN1bGF0ZWQoXHJcbiAgICAgICAgICAgICAgICAgICAgXHQgIHtcclxuICAgICAgICAgICAgICAgICAgICBcdCAgICAgICAgXCJpbWVpXCI6IFwiMTAwMFwiLFxyXG4gICAgICAgICAgICAgICAgICAgIFx0ICAgICAgICBcInNwZWVkXCI6IDAsXHJcbiAgICAgICAgICAgICAgICAgICAgXHQgICAgICAgIFwiZWxhcHNlZFwiOiAwLFxyXG4gICAgICAgICAgICAgICAgICAgIFx0ICAgICAgICBcInRpbWVzdGFtcFwiOiAobmV3IERhdGUoKSkuZ2V0VGltZSgpLFxyXG4gICAgICAgICAgICAgICAgICAgIFx0ICAgICAgICBcImdwc1wiOiBbTWF0aC5yb3VuZChwb3NbMF0qMTAwMDAwMC4wKS8xMDAwMDAwLjAsTWF0aC5yb3VuZChwb3NbMV0qMTAwMDAwMC4wKS8xMDAwMDAwLjBdLFxyXG4gICAgICAgICAgICAgICAgICAgIFx0ICAgICAgICBcImZyZXFcIjogMCxcclxuICAgICAgICAgICAgICAgICAgICBcdCAgICAgICAgXCJpc1NPU1wiOiBmYWxzZSxcclxuICAgICAgICAgICAgICAgICAgICBcdCAgICAgICAgXCJhY2NlbGVyYXRpb25cIjogMCxcclxuICAgICAgICAgICAgICAgICAgICBcdCAgICAgICAgXCJhbHRcIjogMCxcclxuICAgICAgICAgICAgICAgICAgICBcdCAgICAgICAgXCJvdmVyYWxsUmFua1wiOiAxLFxyXG4gICAgICAgICAgICAgICAgICAgIFx0ICAgICAgICBcImdlbmRlclJhbmtcIjogMSxcclxuICAgICAgICAgICAgICAgICAgICBcdCAgICAgICAgXCJncm91cFJhbmtcIjogMVxyXG4gICAgICAgICAgICAgICAgICAgIFx0ICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICBcdFx0fSwzMDAwKTtcclxuICAgICAgICBcdFx0cmV0dXJuO1xyXG4gICAgICAgIFx0fVxyXG4gICAgICAgIFx0Ly8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tICAgICAgICBcdFxyXG4gICAgXHRcdHZhciB1cmwgPSB0aGlzLnVybDtcclxuICAgICAgICBcdGZ1bmN0aW9uIGRvVGljaygpIFxyXG4gICAgICAgIFx0e1xyXG4gICAgICAgICAgICAgICAgdmFyIG1tYXAgPSB7fTtcclxuICAgICAgICAgICAgICAgIHZhciBjdGltZSA9IChuZXcgRGF0ZSgpKS5nZXRUaW1lKCk7XHJcbiAgICAgICAgICAgICAgICB2YXIganNvbiA9IFtdO1xyXG4gICAgICAgICAgICAgICAgZm9yICh2YXIgaSBpbiB0cmFjay5wYXJ0aWNpcGFudHMpIFxyXG4gICAgICAgICAgICAgICAge1xyXG4gICAgICAgICAgICAgICAgXHR2YXIgcHAgPSB0cmFjay5wYXJ0aWNpcGFudHNbaV07XHJcbiAgICAgICAgICAgICAgICBcdGlmIChwcC5pc0Zhdm9yaXRlKVxyXG4gICAgICAgICAgICAgICAgXHRcdG1tYXBbcHAuZGV2aWNlSWRdPXBwO1xyXG4gICAgICAgICAgICAgICAgXHR2YXIgcmVmdCA9IGN0aW1lIC0gMTAqNjAqMTAwMDtcclxuICAgICAgICAgICAgICAgIFx0aWYgKCFwcC5fX3N0YXJ0VGltZSB8fCBwcC5fX3N0YXJ0VGltZSA8IHJlZnQpIHtcclxuICAgICAgICAgICAgICAgIFx0XHRwcC5fX3N0YXJ0VGltZT1yZWZ0O1xyXG4gICAgICAgICAgICAgICAgXHR9XHJcbiAgICAgICAgICAgICAgICBcdGpzb24ucHVzaCh7c3RhcnQ6cHAuX19zdGFydFRpbWUsZW5kIDogY3RpbWUsaW1laTpwcC5kZXZpY2VJZH0pO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgaWYgKCFqc29uLmxlbmd0aClcclxuICAgICAgICAgICAgICAgIFx0cmV0dXJuO1xyXG4gICAgICAgICAgICAgICAgZnVuY3Rpb24gcHJvY2Vzc0RhdGEoZGF0YSkgXHJcbiAgICAgICAgICAgICAgICB7XHJcbiAgICAgICAgICAgICAgICBcdGZvciAodmFyIGkgaW4gZGF0YSkgXHJcbiAgICAgICAgICAgICAgICBcdHtcclxuICAgICAgICAgICAgICAgIFx0XHQvL2NvbnNvbGUud2FybihkYXRhW2ldKTtcclxuICAgICAgICAgICAgICAgIFx0XHR2YXIgcHAgPSBtbWFwW2RhdGFbaV0uaW1laV07XHJcbiAgICAgICAgICAgICAgICBcdFx0aWYgKHBwKSB7XHJcbiAgICAgICAgICAgICAgICBcdFx0XHRpZiAoZGF0YVtpXS50aW1lc3RhbXArMSA+IHBwLl9fc3RhcnRUaW1lKVxyXG4gICAgICAgICAgICAgICAgXHRcdFx0XHRwcC5fX3N0YXJ0VGltZT1kYXRhW2ldLnRpbWVzdGFtcCsxO1xyXG4gICAgICAgICAgICAgICAgXHRcdFx0cHAucGluZ0NhbGN1bGF0ZWQoZGF0YVtpXSk7XHJcbiAgICAgICAgICAgICAgICBcdFx0fVxyXG4gICAgICAgICAgICAgICAgXHR9XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAvL2NvbnNvbGUubG9nKGpzb24pO1xyXG4gICAgICAgICAgICAgICAgJC5hamF4KHtcclxuICAgICAgICAgICAgICAgICAgICB0eXBlOiBcIlBPU1RcIixcclxuICAgICAgICAgICAgICAgICAgICB1cmw6IHVybCxcclxuICAgICAgICAgICAgICAgICAgICBkYXRhOiBKU09OLnN0cmluZ2lmeShqc29uKSxcclxuICAgICAgICAgICAgICAgICAgICBjb250ZW50VHlwZTogXCJhcHBsaWNhdGlvbi9qc29uOyBjaGFyc2V0PXV0Zi04XCIsXHJcbiAgICAgICAgICAgICAgICAgICAgZGF0YVR5cGU6IFwianNvblwiLFxyXG4gICAgICAgICAgICAgICAgICAgIHN1Y2Nlc3M6IGZ1bmN0aW9uKGRhdGEpe1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBwcm9jZXNzRGF0YShkYXRhKTtcclxuICAgICAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgICAgICAgIGZhaWx1cmU6IGZ1bmN0aW9uKGVyck1zZykge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKFwiRVJST1IgZ2V0IGRhdGEgZnJvbSBiYWNrZW5kIFwiK2Vyck1zZylcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgIHNldFRpbWVvdXQoZG9UaWNrLENPTkZJRy50aW1lb3V0cy5zdHJlYW1EYXRhSW50ZXJ2YWwqMTAwMCk7XHJcbiAgICAgICAgXHR9XHJcbiAgICAgICAgXHRkb1RpY2soKTtcclxuICAgICAgICB9XHJcbiAgICB9ICAgIFxyXG59KTtcclxuIiwidmFyIFV0aWxzID0gcmVxdWlyZShcIi4vVXRpbHMuanNcIik7XHJcblxyXG52YXIgQ09ORklHID0gXHJcbntcclxuXHR0aW1lb3V0cyA6IC8vIGluIHNlY29uZHNcclxuXHR7XHJcblx0XHRkZXZpY2VUaW1lb3V0IDogNjAqNSxcclxuXHRcdGFuaW1hdGlvbkZyYW1lIDogVXRpbHMubW9iaWxlQW5kVGFibGV0Q2hlY2soKSA/IDAuNCA6IDAuMSxcclxuXHRcdGdwc0xvY2F0aW9uRGVidWdTaG93IDogNCxcdFx0Ly8gdGltZSB0byBzaG93IGdwcyBsb2NhdGlvbiAoZGVidWcpIGluZm9cclxuXHRcdHN0cmVhbURhdGFJbnRlcnZhbCA6IDEwIFx0XHQvKiBOT1JNQUwgMTAgc2Vjb25kcyAqL1xyXG5cdH0sXHJcblx0ZGlzdGFuY2VzIDogLy8gaW4gbVxyXG5cdHtcclxuXHRcdHN0YXlPblJvYWRUb2xlcmFuY2UgOiA1MDAsXHQvLyA1MDBtIHN0YXkgb24gcm9hZCB0b2xlcmFuY2VcclxuXHRcdGVsYXBzZWREaXJlY3Rpb25FcHNpbG9uIDogNTAwIC8vIDUwMG0gZGlyZWN0aW9uIHRvbGVyYW5jZSwgdG9vIGZhc3QgbW92ZW1lbnQgd2lsbCBkaXNjYXJkIFxyXG5cdH0sXHJcblx0Y29uc3RyYWludHMgOiB7XHJcblx0XHRiYWNrd2FyZHNFcHNpbG9uSW5NZXRlciA6IDQwMCwgLy8yMjAgbSBtb3ZlbWVudCBpbiB0aGUgYmFja3dhcmQgZGlyZWN0aW9uIHdpbGwgbm90IHRyaWdnZXIgbmV4dCBydW4gY291bnRlciBpbmNyZW1lbnRcdFx0XHJcblx0XHRtYXhTcGVlZCA6IDIwLFx0Ly9rbWhcclxuXHRcdG1heFBhcnRpY2lwYW50U3RhdGVIaXN0b3J5IDogMTAwMCwgLy8gbnVtYmVyIG9mIGVsZW1lbnRzXHJcblx0XHRwb3B1cEVuc3VyZVZpc2libGVXaWR0aCA6IDIwMCxcclxuXHRcdHBvcHVwRW5zdXJlVmlzaWJsZUhlaWdodDogMTIwXHJcblx0fSxcclxuXHRzaW11bGF0aW9uIDoge1xyXG5cdFx0cGluZ0ludGVydmFsIDogMTAsICAvLyBpbnRlcnZhbCBpbiBzZWNvbmRzIHRvIHBpbmcgd2l0aCBncHMgZGF0YVxyXG5cdFx0Z3BzSW5hY2N1cmFjeSA6IDgsIC8vOCwgIC8vIGVycm9yIHNpbXVsYXRpb24gaW4gTUVURVIgKGxvb2sgbWF0aC5ncHNJbmFjY3VyYWN5LCBtaW4gMS8yKVxyXG5cdFx0c3BlZWRDb2VmIDogMTAwXHJcblx0fSxcclxuXHRzZXR0aW5ncyA6IHtcclxuXHRcdG5vTWlkZGxlV2FyZSA6IDAsIFx0Ly8gU0tJUCBtaWRkbGUgd2FyZSBub2RlIGpzIGFwcFxyXG5cdFx0bm9JbnRlcnBvbGF0aW9uIDogMFx0Ly8gMSAtPiBubyBpbnRlcnBvbGF0aW9uIG9ubHkgcG9pbnRzXHJcblx0fSxcclxuXHRtYXRoIDoge1xyXG5cdFx0Z3BzSW5hY2N1cmFjeSA6IDMwLFx0Ly9UT0RPIDEzIG1pblxyXG5cdFx0c3BlZWRBbmRBY2NlbGVyYXRpb25BdmVyYWdlRGVncmVlIDogMixcdC8vIGNhbGN1bGF0aW9uIGJhc2VkIG9uIE4gc3RhdGVzIChhdmVyYWdlKSAoTUlOIDIpXHJcblx0XHRkaXNwbGF5RGVsYXkgOiA3MCxcdFx0XHRcdFx0XHQvLyBkaXNwbGF5IGRlbGF5IGluIFNFQ09ORFNcclxuXHRcdGludGVycG9sYXRlR1BTQXZlcmFnZSA6IDAgLy8gbnVtYmVyIG9mIHJlY2VudCB2YWx1ZXMgdG8gY2FsY3VsYXRlIGF2ZXJhZ2UgZ3BzIGZvciBwb3NpdGlvbiAoc21vb3RoaW5nIHRoZSBjdXJ2ZS5taW4gMCA9IE5PLDEgPSAyIHZhbHVlcyAoY3VycmVudCBhbmQgbGFzdCkpXHJcblx0fSxcclxuXHRjb25zdGFudHMgOiBcclxuXHR7XHJcblx0XHRhZ2VHcm91cHMgOiAgXHJcblx0XHRbXHJcblx0XHQge1xyXG5cdFx0XHQgZnJvbSA6IG51bGwsXHJcblx0XHRcdCB0byA6IDgsIFxyXG5cdFx0XHQgY29kZSA6IFwiRmlyc3RBZ2VHcm91cFwiXHJcblx0XHQgfVxyXG5cdFx0ICx7XHJcblx0XHRcdCBmcm9tIDogOCxcclxuXHRcdFx0IHRvIDogNDAsIFxyXG5cdFx0XHQgY29kZSA6IFwiTWlkZGxlQWdlR3JvdXBcIlxyXG5cdFx0IH1cclxuXHRcdCAse1xyXG5cdFx0XHQgZnJvbSA6IDQwLFxyXG5cdFx0XHQgdG8gOiBudWxsLCBcclxuXHRcdFx0IGNvZGUgOiBcIkxhc3RBZ2VHcm91cFwiXHJcblx0XHQgfVxyXG5cdFx0XVxyXG5cdH0sXHJcblxyXG5cdGV2ZW50IDoge1xyXG5cdFx0YmVnaW5UaW1lc3RhbXAgOiAobmV3IERhdGUoKSkuZ2V0VGltZSgpLFxyXG5cdFx0ZHVyYXRpb24gOiA2MCwgLy9NSU5VVEVTXHJcblx0XHRpZCA6IDNcclxuXHR9LFxyXG5cclxuXHRzZXJ2ZXIgOiB7XHJcblx0XHRwcmVmaXggOiBcIi90cmlhdGhsb24vXCJcclxuXHR9LFxyXG5cdFxyXG5cdGFwcGVhcmFuY2UgOiB7XHJcblx0XHRkZWJ1ZyA6IDEsXHJcblx0XHR0cmFja0NvbG9yU3dpbSA6ICcjNTY3NmZmJyxcclxuXHRcdHRyYWNrQ29sb3JCaWtlIDogJyNFMjAwNzQnLFxyXG5cdFx0dHJhY2tDb2xvclJ1biA6ICAnIzA3OWYzNicsXHJcblxyXG5cdFx0Ly8gTm90ZSB0aGUgc2VxdWVuY2UgaXMgYWx3YXlzIFN3aW0tQmlrZS1SdW4gLSBzbyAyIGNoYW5nZS1wb2ludHNcclxuXHRcdC8vIFRPRE8gUnVtZW4gLSBhZGQgc2NhbGUgaGVyZSwgbm90IGluIFN0eWxlcy5qc1xyXG5cdFx0aW1hZ2VTdGFydCA6IFwiaW1nL3N0YXJ0LnBuZ1wiLFxyXG5cdFx0aW1hZ2VGaW5pc2ggOiBcImltZy9maW5pc2gucG5nXCIsXHJcblx0XHRpbWFnZUNhbSA6IFwiaW1nL2NhbWVyYS5zdmdcIixcclxuXHRcdGltYWdlQ2hlY2twb2ludFN3aW1CaWtlIDogXCJpbWcvd3oxLnN2Z1wiLFxyXG5cdFx0aW1hZ2VDaGVja3BvaW50QmlrZVJ1biA6IFwiaW1nL3d6Mi5zdmdcIixcclxuXHRcdGlzU2hvd0ltYWdlQ2hlY2twb2ludCA6IHRydWUsXHJcblxyXG4gICAgICAgIC8vIHRoZSBkaXN0YW5jZSBiZXR3ZWVuIHRoZSBkaXJlY3Rpb24gaWNvbnMgLSBpbiBwaXhlbHMsXHJcbiAgICAgICAgLy8gaWYgc2V0IG5vbi1wb3NpdGl2ZSB2YWx1ZSAoMCBvciBsZXNzKSB0aGVuIGRvbid0IHNob3cgdGhlbSBhdCBhbGxcclxuXHRcdC8vZGlyZWN0aW9uSWNvbkJldHdlZW4gOiAyMDBcclxuXHRcdGRpcmVjdGlvbkljb25CZXR3ZWVuIDogLTFcclxuXHR9LFxyXG5cclxuICAgIGhvdHNwb3QgOiB7XHJcbiAgICAgICAgY2FtIDoge2ltYWdlIDpcImltZy9jYW1lcmEuc3ZnXCJ9LCAgLy8gdXNlIHRoZSBzYW1lIGltYWdlIGZvciBzdGF0aWMgY2FtZXJhcyBhcyBmb3IgdGhlIG1vdmluZyBvbmVzXHJcblx0XHRjYW1Td2ltQmlrZSA6IHtpbWFnZSA6IFwiaW1nL3d6MS5zdmdcIiwgc2NhbGUgOiAwLjA0MH0sXHJcblx0XHRjYW1CaWtlUnVuIDoge2ltYWdlIDogXCJpbWcvd3oyLnN2Z1wiLCBzY2FsZSA6IDAuMDQwfSxcclxuICAgICAgICB3YXRlciA6IHtpbWFnZSA6IFwiaW1nL3dhdGVyLnN2Z1wifSxcclxuICAgICAgICB1dHVybiA6IHtpbWFnZSA6IFwiaW1nL3V0dXJuLnN2Z1wifSxcclxuXHJcblx0XHRrbTEwIDoge2ltYWdlIDogXCJpbWcvMTBrbS5zdmdcIiwgc2NhbGUgOiAxLjV9LFxyXG5cdFx0a20yMCA6IHtpbWFnZSA6IFwiaW1nLzIwa20uc3ZnXCIsIHNjYWxlIDogMS41fSxcclxuXHRcdGttMzAgOiB7aW1hZ2UgOiBcImltZy8zMGttLnN2Z1wiLCBzY2FsZSA6IDEuNX0sXHJcblx0XHRrbTQwIDoge2ltYWdlIDogXCJpbWcvNDBrbS5zdmdcIiwgc2NhbGUgOiAxLjV9LFxyXG5cdFx0a202MCA6IHtpbWFnZSA6IFwiaW1nLzYwa20uc3ZnXCIsIHNjYWxlIDogMS41fSxcclxuXHRcdGttODAgOiB7aW1hZ2UgOiBcImltZy84MGttLnN2Z1wiLCBzY2FsZSA6IDEuNX0sXHJcblx0XHRrbTEwMCA6IHtpbWFnZSA6IFwiaW1nLzEwMGttLnN2Z1wiLCBzY2FsZSA6IDEuNX0sXHJcblx0XHRrbTEyMCA6IHtpbWFnZSA6IFwiaW1nLzEyMGttLnN2Z1wiLCBzY2FsZSA6IDEuNX0sXHJcblx0XHRrbTE0MCA6IHtpbWFnZSA6IFwiaW1nLzE0MGttLnN2Z1wiLCBzY2FsZSA6IDEuNX0sXHJcblx0XHRrbTE2MCA6IHtpbWFnZSA6IFwiaW1nLzE2MGttLnN2Z1wiLCBzY2FsZSA6IDEuNX0sXHJcblx0XHRrbTE4MCA6IHtpbWFnZSA6IFwiaW1nLzE4MGttLnN2Z1wiLCBzY2FsZSA6IDEuNX1cclxuICAgIH1cclxufTtcclxuXHJcbmZvciAodmFyIGkgaW4gQ09ORklHKVxyXG5cdGV4cG9ydHNbaV09Q09ORklHW2ldO1xyXG4iLCJ2YXIgVXRpbHMgPSByZXF1aXJlKCcuL1V0aWxzJyk7XHJcbnZhciBDT05GSUcgPSByZXF1aXJlKCcuL0NvbmZpZycpO1xyXG5cclxudmFyIERlbW9TaW11bGF0aW9uID0gZnVuY3Rpb24oKSB7XHJcblxyXG4gICAgY29uc29sZS5pbmZvKFwiU3RhcnRpbmcgZGVtbyBzaW11bGF0aW9uXCIpO1xyXG5cclxuICAgIHZhciBzY29lZiA9IDYqNSo1KjM7IC8vNSo0Oy8vKjM7Ly8qMzsvLzQuNzI5O1xyXG5cclxuICAgIC8vIGtlZXAgdHJhY2sgb2YgYWxsIHRoZSBzaW11bGF0aW9uIHBhcnRpY2lwYW50c1xyXG4gICAgdmFyIGNvdW50U2ltdWxhdGlvbnMgPSAwO1xyXG5cclxuICAgIHRoaXMuc2ltdWxhdGVQYXJ0aWNpcGFudCA9IGZ1bmN0aW9uKHBhcnQpIHtcclxuXHJcbiAgICAgICAgdmFyIHRyYWNrSW5TZWNvbmRzID0gMzAqc2NvZWYqKDErY291bnRTaW11bGF0aW9ucy83LjApO1xyXG4gICAgICAgIGNvdW50U2ltdWxhdGlvbnMrKztcclxuXHJcbiAgICAgICAgdmFyIHAwID0gVFJBQ0sucm91dGVbMF07XHJcbiAgICAgICAgdmFyIHJhbmRjb2VmID0gMDsvL0NPTkZJRy5zaW11bGF0aW9uLmdwc0luYWNjdXJhY3kgKiAwLjAwMDEgLyBVdGlscy5XR1M4NFNQSEVSRS5oYXZlcnNpbmVEaXN0YW5jZShwMCwgW3AwWzBdKzAuMDAwMSwgcDBbMV0rMC4wMDAxXSk7XHJcbiAgICAgICAgdmFyIHN0aW1lID0gKG5ldyBEYXRlKCkpLmdldFRpbWUoKTtcclxuICAgICAgICB2YXIgY29lZiA9IFRSQUNLLmdldFRyYWNrTGVuZ3RoKCkgLyBUUkFDSy5nZXRUcmFja0xlbmd0aEluV0dTODQoKTtcclxuICAgICAgICBzZXRJbnRlcnZhbChmdW5jdGlvbihlKSB7XHJcbiAgICAgICAgICAgIHZhciBjdGltZSA9IChuZXcgRGF0ZSgpKS5nZXRUaW1lKCk7XHJcbiAgICAgICAgICAgIHZhciBlbGFwc2VkID0gKChjdGltZSAtIHN0aW1lKS8xMDAwLjApL3RyYWNrSW5TZWNvbmRzO1xyXG4gICAgICAgICAgICB2YXIgcG9zID0gVFJBQ0suX19nZXRQb3NpdGlvbkFuZFJvdGF0aW9uRnJvbUVsYXBzZWQoZWxhcHNlZCAlIDEuMCk7XHJcbiAgICAgICAgICAgIHZhciBkaXN0MSA9IChNYXRoLnJhbmRvbSgpKjIuMC0xLjApICogcmFuZGNvZWY7XHJcbiAgICAgICAgICAgIHZhciBkaXN0MiA9ICAoTWF0aC5yYW5kb20oKSoyLjAtMS4wKSAgKiByYW5kY29lZjtcclxuICAgICAgICAgICAgdmFyIGFsdCA9IDEwMDAqTWF0aC5yYW5kb20oKTtcclxuICAgICAgICAgICAgdmFyIG92ZXJhbGxSYW5rID0gcGFyc2VJbnQoMjAqTWF0aC5yYW5kb20oKSkrMTtcclxuICAgICAgICAgICAgdmFyIGdyb3VwUmFuayA9IHBhcnNlSW50KDIwKk1hdGgucmFuZG9tKCkpKzE7XHJcbiAgICAgICAgICAgIHZhciBnZW5kZXJSYW5rID0gcGFyc2VJbnQoMjAqTWF0aC5yYW5kb20oKSkrMTtcclxuICAgICAgICAgICAgLy9wb3NbMF0rPWRpc3QxO1xyXG4gICAgICAgICAgICAvL3Bvc1sxXSs9ZGlzdDI7XHJcbiAgICAgICAgICAgIHBhcnQucGluZyhwb3MsODArTWF0aC5yYW5kb20oKSoxMCxmYWxzZSxjdGltZSxhbHQsb3ZlcmFsbFJhbmssZ3JvdXBSYW5rLGdlbmRlclJhbmssZWxhcHNlZCk7XHJcbiAgICAgICAgfSwgQ09ORklHLnNpbXVsYXRpb24ucGluZ0ludGVydmFsKjEwMDApO1xyXG4gICAgfTtcclxufTtcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gbmV3IERlbW9TaW11bGF0aW9uKCk7XHJcblxyXG5cclxuIiwidmFyIFV0aWxzPXJlcXVpcmUoJy4vVXRpbHMnKTtcclxudmFyIFNUWUxFUz1yZXF1aXJlKCcuL1N0eWxlcycpO1xyXG5yZXF1aXJlKCdqb29zZScpO1xyXG5yZXF1aXJlKCcuL1RyYWNrJyk7XHJcbnJlcXVpcmUoJy4vTGl2ZVN0cmVhbScpO1xyXG52YXIgQ09ORklHID0gcmVxdWlyZShcIi4vQ29uZmlnXCIpO1xyXG5cclxuQ2xhc3MoXCJHdWlcIiwgXHJcbntcclxuICAgIC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHQvLyBBTEwgQ09PUkRJTkFURVMgQVJFIElOIFdPUkxEIE1FUkNBVE9SXHJcbiAgICAvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcbiAgICBoYXM6IFxyXG5cdHtcclxuICAgIFx0aXNEZWJ1ZyA6IHtcclxuICAgIFx0XHRpcyA6IFwicndcIixcclxuICAgIFx0XHRpbml0IDogIVV0aWxzLm1vYmlsZUFuZFRhYmxldENoZWNrKCkgJiYgQ09ORklHLmFwcGVhcmFuY2UuZGVidWdcclxuICAgIFx0fSxcclxuXHRcdGlzV2lkZ2V0IDoge1xyXG5cdFx0XHRpbml0IDogZmFsc2VcclxuXHRcdH0sXHJcblx0XHRpc0RlYnVnU2hvd1Bvc2l0aW9uIDoge1xyXG5cdFx0XHQvLyBpZiBzZXQgdG8gdHJ1ZSBpdCB3aWxsIGFkZCBhbiBhYnNvbHV0ZSBlbGVtZW50IHNob3dpbmcgdGhlIGNvb3JkaW5hdGVzIGFib3ZlIHRoZSBtb3VzZSBsb2NhdGlvblxyXG5cdFx0XHRpbml0IDogZmFsc2VcclxuXHRcdH0sXHJcblx0XHRyZWNlaXZlck9uTWFwQ2xpY2sgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogW11cclxuXHRcdH0sXHJcbiAgICAgICAgd2lkdGggOiB7XHJcbiAgICAgICAgICAgIGlzOiAgIFwicndcIixcclxuICAgICAgICAgICAgaW5pdDogNzUwXHJcbiAgICAgICAgfSxcclxuICAgICAgICBoZWlnaHQ6IHtcclxuICAgICAgICAgICAgaXM6ICAgXCJyd1wiLFxyXG4gICAgICAgICAgICBpbml0OiA1MDBcclxuICAgICAgICB9LFxyXG5cdFx0dHJhY2sgOiB7XHJcblx0XHRcdGlzOiAgIFwicndcIlxyXG5cdFx0fSxcclxuXHRcdGVsZW1lbnRJZCA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiBcIm1hcFwiXHJcblx0XHR9LFxyXG5cdFx0aW5pdGlhbFBvcyA6IHtcdFxyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IG51bGxcclxuXHRcdH0sXHJcblx0XHRpbml0aWFsWm9vbSA6IHtcdFxyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IDEwXHJcblx0XHR9LFxyXG5cdFx0aXNTa2lwRXh0ZW50IDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IGZhbHNlXHJcblx0XHR9LFxyXG5cdFx0YmluZ01hcEtleSA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiAnQWlqdDNBc1dPTUUzaFBFRV9IcVJsVUtkY0JLcWU4ZEdSWkhfdi1MM0hfRkY2NHN2WE1ia3IxVDZ1X1dBU29ldCdcclxuXHRcdH0sXHJcblx0XHQvLy0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRcdG1hcCA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiBudWxsXHJcblx0XHR9LFxyXG5cdFx0dHJhY2tMYXllciA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiBudWxsXHJcblx0XHR9LFxyXG4gICAgICAgIGhvdHNwb3RzTGF5ZXIgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogbnVsbFxyXG5cdFx0fSxcclxuICAgICAgICBjYW1zTGF5ZXIgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogbnVsbFxyXG5cdFx0fSxcclxuXHRcdHBhcnRpY2lwYW50c0xheWVyIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IG51bGxcclxuXHRcdH0sXHJcblx0XHRkZWJ1Z0xheWVyR1BTIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IG51bGxcclxuXHRcdH0sXHRcclxuXHRcdHRlc3RMYXllciA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiBudWxsXHJcblx0XHR9LFx0XHJcblx0XHRcclxuXHRcdHNlbGVjdGVkUGFydGljaXBhbnQxIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IG51bGxcclxuXHRcdH0sXHJcblx0XHRzZWxlY3RlZFBhcnRpY2lwYW50MiA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiBudWxsXHJcblx0XHR9LFxyXG5cdFx0cG9wdXAxIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IG51bGxcclxuXHRcdH0sXHJcblx0XHRwb3B1cDIgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogbnVsbFxyXG5cdFx0fSxcclxuXHRcdGlzU2hvd1N3aW0gOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogdHJ1ZVxyXG5cdFx0fSxcclxuXHRcdGlzU2hvd0Jpa2UgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogdHJ1ZVxyXG5cdFx0fSxcclxuXHRcdGlzU2hvd1J1biA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiB0cnVlXHJcblx0XHR9LFxyXG5cdFx0c2VsZWN0TnVtIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IDFcclxuXHRcdH0sXHJcbiAgICAgICAgbGl2ZVN0cmVhbSA6IHtcclxuICAgICAgICAgICAgaW5pdDogbnVsbFxyXG4gICAgICAgIH1cclxuICAgIH0sXHJcbiAgICAvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0bWV0aG9kczogXHJcblx0e1xyXG4gICAgICAgIGluaXQ6IGZ1bmN0aW9uIChwYXJhbXMpICBcclxuXHRcdHtcclxuXHRcdFx0Ly8gaWYgaW4gd2lkZ2V0IG1vZGUgdGhlbiBkaXNhYmxlIGRlYnVnXHJcblx0XHRcdGlmICh0aGlzLmlzV2lkZ2V0KSB7XHJcblx0XHRcdFx0dGhpcy5pc0RlYnVnID0gZmFsc2U7XHJcblx0XHRcdH1cclxuXHJcblx0XHRcdHZhciBkZWZQb3MgPSBbMCwwXTtcclxuXHRcdFx0aWYgKHRoaXMuaW5pdGlhbFBvcykge1xyXG5cdFx0XHRcdGRlZlBvcyA9IHRoaXMuaW5pdGlhbFBvcztcclxuXHRcdFx0fSBlbHNlIGlmIChUUkFDSy5nZXRSb3V0ZSgpICYmIFRSQUNLLmdldFJvdXRlKCkubGVuZ3RoID4gMSkge1xyXG5cdFx0XHRcdGRlZlBvcyA9IFRSQUNLLmdldFJvdXRlKClbMF07XHJcblx0XHRcdH1cclxuXHRcdFx0Ly8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRcdFx0dmFyIGV4dGVudCA9IHRoaXMuaXNTa2lwRXh0ZW50ID8gbnVsbCA6IFRSQUNLLmdldFJvdXRlKCkgJiYgVFJBQ0suZ2V0Um91dGUoKS5sZW5ndGggPiAxID8gb2wucHJvai50cmFuc2Zvcm1FeHRlbnQoIChuZXcgb2wuZ2VvbS5MaW5lU3RyaW5nKFRSQUNLLmdldFJvdXRlKCkpKS5nZXRFeHRlbnQoKSAsICdFUFNHOjQzMjYnLCAnRVBTRzozODU3JykgOiBudWxsO1xyXG5cdFx0XHR0aGlzLnRyYWNrTGF5ZXIgPSBuZXcgb2wubGF5ZXIuVmVjdG9yKHtcclxuXHRcdFx0ICBzb3VyY2U6IG5ldyBvbC5zb3VyY2UuVmVjdG9yKCksXHJcblx0XHRcdCAgc3R5bGUgOiBTVFlMRVNbXCJ0cmFja1wiXVxyXG5cdFx0XHR9KTtcclxuXHRcdFx0dGhpcy5ob3RzcG90c0xheWVyID0gbmV3IG9sLmxheWVyLlZlY3Rvcih7XHJcblx0XHRcdCAgc291cmNlOiBuZXcgb2wuc291cmNlLlZlY3RvcigpLFxyXG5cdFx0XHQgIHN0eWxlIDogU1RZTEVTW1wiaG90c3BvdFwiXVxyXG5cdFx0XHR9KTtcclxuXHRcdFx0dGhpcy5wYXJ0aWNpcGFudHNMYXllciA9IG5ldyBvbC5sYXllci5WZWN0b3Ioe1xyXG5cdFx0XHQgIHNvdXJjZTogbmV3IG9sLnNvdXJjZS5WZWN0b3IoKSxcclxuXHRcdFx0ICBzdHlsZSA6IFNUWUxFU1tcInBhcnRpY2lwYW50XCJdXHJcblx0XHRcdH0pO1xyXG5cdFx0XHR0aGlzLmNhbXNMYXllciA9IG5ldyBvbC5sYXllci5WZWN0b3Ioe1xyXG5cdFx0XHRcdHNvdXJjZTogbmV3IG9sLnNvdXJjZS5WZWN0b3IoKSxcclxuXHRcdFx0XHRzdHlsZSA6IFNUWUxFU1tcImNhbVwiXVxyXG5cdFx0XHR9KTtcclxuXHRcdFx0aWYgKHRoaXMuaXNEZWJ1ZykgXHJcblx0XHRcdHtcclxuXHRcdFx0XHR0aGlzLmRlYnVnTGF5ZXJHUFMgPSBuZXcgb2wubGF5ZXIuVmVjdG9yKHtcclxuXHRcdFx0XHRcdCAgc291cmNlOiBuZXcgb2wuc291cmNlLlZlY3RvcigpLFxyXG5cdFx0XHRcdFx0ICBzdHlsZSA6IFNUWUxFU1tcImRlYnVnR1BTXCJdXHJcblx0XHRcdFx0fSk7XHJcblx0XHRcdFx0dGhpcy50ZXN0TGF5ZXIgPSBuZXcgb2wubGF5ZXIuVmVjdG9yKHtcclxuXHRcdFx0XHRcdCAgc291cmNlOiBuZXcgb2wuc291cmNlLlZlY3RvcigpLFxyXG5cdFx0XHRcdFx0ICBzdHlsZSA6IFNUWUxFU1tcInRlc3RcIl1cclxuXHRcdFx0XHR9KTtcclxuXHRcdFx0XHR0aGlzLnRlc3RMYXllcjEgPSBuZXcgb2wubGF5ZXIuVmVjdG9yKHtcclxuXHRcdFx0XHRcdCAgc291cmNlOiBuZXcgb2wuc291cmNlLlZlY3RvcigpLFxyXG5cdFx0XHRcdFx0ICBzdHlsZSA6IFNUWUxFU1tcInRlc3QxXCJdXHJcblx0XHRcdFx0fSk7XHJcblx0XHRcdH1cclxuXHRcdFx0Ly8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdFx0XHR2YXIgaW50cyA9IFtdO1xyXG5cdFx0XHR0aGlzLnBvcHVwMSA9IG5ldyBvbC5PdmVybGF5LlBvcHVwKHthbmk6ZmFsc2UscGFuTWFwSWZPdXRPZlZpZXcgOiBmYWxzZX0pO1xyXG5cdFx0XHR0aGlzLnBvcHVwMiA9IG5ldyBvbC5PdmVybGF5LlBvcHVwKHthbmk6ZmFsc2UscGFuTWFwSWZPdXRPZlZpZXcgOiBmYWxzZX0pO1xyXG5cdFx0XHR0aGlzLnBvcHVwMi5zZXRPZmZzZXQoWzAsMTc1XSk7XHJcblx0XHRcdHRoaXMubWFwID0gbmV3IG9sLk1hcCh7XHJcblx0XHRcdCAgcmVuZGVyZXIgOiBcImNhbnZhc1wiLFxyXG5cdFx0XHQgIHRhcmdldDogJ21hcCcsXHJcblx0XHRcdCAgbGF5ZXJzOiBbXHJcblx0XHRcdCAgICAgICAgICAgbmV3IG9sLmxheWVyLlRpbGUoe1xyXG5cdFx0XHQgICAgICAgICAgICAgICBzb3VyY2U6IG5ldyBvbC5zb3VyY2UuT1NNKClcclxuXHRcdFx0ICAgICAgICAgICB9KSxcclxuXHRcdFx0XHRcdHRoaXMudHJhY2tMYXllcixcclxuXHRcdFx0XHRcdHRoaXMuaG90c3BvdHNMYXllcixcclxuXHRcdFx0XHRcdHRoaXMuY2Ftc0xheWVyLFxyXG5cdFx0XHRcdFx0dGhpcy5wYXJ0aWNpcGFudHNMYXllclxyXG5cdFx0XHQgIF0sXHJcblx0XHRcdCAgY29udHJvbHM6IHRoaXMuaXNXaWRnZXQgPyBbXSA6IG9sLmNvbnRyb2wuZGVmYXVsdHMoKSxcclxuXHRcdFx0ICB2aWV3OiBuZXcgb2wuVmlldyh7XHJcblx0XHRcdFx0Y2VudGVyOiBvbC5wcm9qLnRyYW5zZm9ybShkZWZQb3MsICdFUFNHOjQzMjYnLCAnRVBTRzozODU3JyksXHJcblx0XHRcdFx0em9vbTogdGhpcy5pbml0aWFsWm9vbSxcclxuXHRcdFx0XHRtaW5ab29tOiB0aGlzLmlzV2lkZ2V0ID8gdGhpcy5pbml0aWFsWm9vbSA6IDgsXHJcblx0XHRcdFx0bWF4Wm9vbTogdGhpcy5pc1dpZGdldCA/IHRoaXMuaW5pdGlhbFpvb20gOiAxNyxcclxuXHRcdFx0XHRleHRlbnQgOiBleHRlbnQgPyBleHRlbnQgOiB1bmRlZmluZWRcclxuXHRcdFx0ICB9KVxyXG5cdFx0XHR9KTtcclxuXHRcdFx0XHJcblx0XHRcdGZvciAodmFyIGk9MDtpPGludHMubGVuZ3RoO2krKylcclxuXHRcdFx0XHR0aGlzLm1hcC5hZGRJbnRlcmFjdGlvbihpbnRzW2ldKTtcclxuXHRcdFx0dGhpcy5tYXAuYWRkT3ZlcmxheSh0aGlzLnBvcHVwMSk7XHJcblx0XHRcdHRoaXMubWFwLmFkZE92ZXJsYXkodGhpcy5wb3B1cDIpO1xyXG5cdFx0XHRpZiAodGhpcy5pc0RlYnVnKSB7IFxyXG5cdFx0XHRcdHRoaXMubWFwLmFkZExheWVyKHRoaXMuZGVidWdMYXllckdQUyk7XHJcblx0XHRcdFx0dGhpcy5tYXAuYWRkTGF5ZXIodGhpcy50ZXN0TGF5ZXIpO1xyXG5cdFx0XHRcdHRoaXMubWFwLmFkZExheWVyKHRoaXMudGVzdExheWVyMSk7XHJcblx0XHRcdH1cclxuXHRcdFx0VFJBQ0suaW5pdCgpO1xyXG5cdFx0XHR0aGlzLmFkZFRyYWNrRmVhdHVyZSgpO1xyXG5cdFx0XHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRcdFx0aWYgKCF0aGlzLmlzV2lkZ2V0KSB7XHJcblx0XHRcdFx0dGhpcy5tYXAub24oJ2NsaWNrJywgZnVuY3Rpb24gKGV2ZW50KSB7XHJcblx0XHRcdFx0XHRUUkFDSy5vbk1hcENsaWNrKGV2ZW50KTtcclxuXHRcdFx0XHRcdHZhciBzZWxlY3RlZFBhcnRpY2lwYW50cyA9IFtdO1xyXG5cdFx0XHRcdFx0dmFyIHNlbGVjdGVkSG90c3BvdCA9IG51bGw7XHJcblx0XHRcdFx0XHR0aGlzLm1hcC5mb3JFYWNoRmVhdHVyZUF0UGl4ZWwoZXZlbnQucGl4ZWwsIGZ1bmN0aW9uIChmZWF0dXJlLCBsYXllcikge1xyXG5cdFx0XHRcdFx0XHRpZiAobGF5ZXIgPT0gdGhpcy5wYXJ0aWNpcGFudHNMYXllcikge1xyXG5cdFx0XHRcdFx0XHRcdHNlbGVjdGVkUGFydGljaXBhbnRzLnB1c2goZmVhdHVyZSk7XHJcblx0XHRcdFx0XHRcdH0gZWxzZSBpZiAobGF5ZXIgPT0gdGhpcy5ob3RzcG90c0xheWVyKSB7XHJcblx0XHRcdFx0XHRcdFx0Ly8gYWxsb3cgb25seSBvbmUgaG90c3BvdCB0byBiZSBzZWxlY3RlZCBhdCBhIHRpbWVcclxuXHRcdFx0XHRcdFx0XHRpZiAoIXNlbGVjdGVkSG90c3BvdClcclxuXHRcdFx0XHRcdFx0XHRcdHNlbGVjdGVkSG90c3BvdCA9IGZlYXR1cmU7XHJcblx0XHRcdFx0XHRcdH1cclxuXHRcdFx0XHRcdH0sIHRoaXMpO1xyXG5cclxuXHRcdFx0XHRcdC8vIGZpcnN0IGlmIHRoZXJlIGFyZSBzZWxlY3RlZCBwYXJ0aWNpcGFudHMgdGhlbiBzaG93IHRoZWlyIHBvcHVwc1xyXG5cdFx0XHRcdFx0Ly8gYW5kIG9ubHkgaWYgdGhlcmUgYXJlIG5vdCB1c2UgdGhlIHNlbGVjdGVkIGhvdHNwb3QgaWYgdGhlcmUncyBhbnlcclxuXHRcdFx0XHRcdGlmIChzZWxlY3RlZFBhcnRpY2lwYW50cy5sZW5ndGgpIHtcclxuXHRcdFx0XHRcdFx0aWYgKHRoaXMuc2VsZWN0ZWRQYXJ0aWNpcGFudDEgPT0gbnVsbCkge1xyXG5cdFx0XHRcdFx0XHRcdHZhciBmZWF0ID0gdGhpcy5nZXRTZWxlY3RlZFBhcnRpY2lwYW50RnJvbUFycmF5Q3ljbGljKHNlbGVjdGVkUGFydGljaXBhbnRzKTtcclxuXHRcdFx0XHRcdFx0XHRpZiAoZmVhdClcclxuXHRcdFx0XHRcdFx0XHRcdHRoaXMuc2V0U2VsZWN0ZWRQYXJ0aWNpcGFudDEoZmVhdC5wYXJ0aWNpcGFudCk7XHJcblx0XHRcdFx0XHRcdFx0ZWxzZVxyXG5cdFx0XHRcdFx0XHRcdFx0dGhpcy5zZXRTZWxlY3RlZFBhcnRpY2lwYW50MShudWxsKTtcclxuXHRcdFx0XHRcdFx0XHR0aGlzLnNlbGVjdE51bSA9IDA7XHJcblx0XHRcdFx0XHRcdH0gZWxzZSBpZiAodGhpcy5zZWxlY3RlZFBhcnRpY2lwYW50MiA9PSBudWxsKSB7XHJcblx0XHRcdFx0XHRcdFx0dmFyIGZlYXQgPSB0aGlzLmdldFNlbGVjdGVkUGFydGljaXBhbnRGcm9tQXJyYXlDeWNsaWMoc2VsZWN0ZWRQYXJ0aWNpcGFudHMpO1xyXG5cdFx0XHRcdFx0XHRcdGlmIChmZWF0KVxyXG5cdFx0XHRcdFx0XHRcdFx0dGhpcy5zZXRTZWxlY3RlZFBhcnRpY2lwYW50MihmZWF0LnBhcnRpY2lwYW50KTtcclxuXHRcdFx0XHRcdFx0XHRlbHNlXHJcblx0XHRcdFx0XHRcdFx0XHR0aGlzLnNldFNlbGVjdGVkUGFydGljaXBhbnQyKG51bGwpO1xyXG5cdFx0XHRcdFx0XHRcdHRoaXMuc2VsZWN0TnVtID0gMTtcclxuXHRcdFx0XHRcdFx0fSBlbHNlIHtcclxuXHRcdFx0XHRcdFx0XHR0aGlzLnNlbGVjdE51bSA9ICh0aGlzLnNlbGVjdE51bSArIDEpICUgMjtcclxuXHRcdFx0XHRcdFx0XHRpZiAodGhpcy5zZWxlY3ROdW0gPT0gMCkge1xyXG5cdFx0XHRcdFx0XHRcdFx0dmFyIGZlYXQgPSB0aGlzLmdldFNlbGVjdGVkUGFydGljaXBhbnRGcm9tQXJyYXlDeWNsaWMoc2VsZWN0ZWRQYXJ0aWNpcGFudHMpO1xyXG5cdFx0XHRcdFx0XHRcdFx0aWYgKGZlYXQpXHJcblx0XHRcdFx0XHRcdFx0XHRcdHRoaXMuc2V0U2VsZWN0ZWRQYXJ0aWNpcGFudDEoZmVhdC5wYXJ0aWNpcGFudCk7XHJcblx0XHRcdFx0XHRcdFx0XHRlbHNlXHJcblx0XHRcdFx0XHRcdFx0XHRcdHRoaXMuc2V0U2VsZWN0ZWRQYXJ0aWNpcGFudDEobnVsbCk7XHJcblx0XHRcdFx0XHRcdFx0fSBlbHNlIHtcclxuXHRcdFx0XHRcdFx0XHRcdHZhciBmZWF0ID0gdGhpcy5nZXRTZWxlY3RlZFBhcnRpY2lwYW50RnJvbUFycmF5Q3ljbGljKHNlbGVjdGVkUGFydGljaXBhbnRzKTtcclxuXHRcdFx0XHRcdFx0XHRcdGlmIChmZWF0KVxyXG5cdFx0XHRcdFx0XHRcdFx0XHR0aGlzLnNldFNlbGVjdGVkUGFydGljaXBhbnQyKGZlYXQucGFydGljaXBhbnQpO1xyXG5cdFx0XHRcdFx0XHRcdFx0ZWxzZVxyXG5cdFx0XHRcdFx0XHRcdFx0XHR0aGlzLnNldFNlbGVjdGVkUGFydGljaXBhbnQyKG51bGwpO1xyXG5cdFx0XHRcdFx0XHRcdH1cclxuXHRcdFx0XHRcdFx0fVxyXG5cdFx0XHRcdFx0fSBlbHNlIHtcclxuXHRcdFx0XHRcdFx0dGhpcy5zZXRTZWxlY3RlZFBhcnRpY2lwYW50MShudWxsKTtcclxuXHRcdFx0XHRcdFx0dGhpcy5zZXRTZWxlY3RlZFBhcnRpY2lwYW50MihudWxsKTtcclxuXHJcblx0XHRcdFx0XHRcdGlmIChzZWxlY3RlZEhvdHNwb3QpIHtcclxuXHRcdFx0XHRcdFx0XHRzZWxlY3RlZEhvdHNwb3QuaG90c3BvdC5vbkNsaWNrKCk7XHJcblx0XHRcdFx0XHRcdH1cclxuXHRcdFx0XHRcdH1cclxuXHRcdFx0XHR9LCB0aGlzKTtcclxuXHJcblx0XHRcdFx0Ly8gY2hhbmdlIG1vdXNlIGN1cnNvciB3aGVuIG92ZXIgc3BlY2lmaWMgZmVhdHVyZXNcclxuXHRcdFx0XHR2YXIgc2VsZiA9IHRoaXM7XHJcblx0XHRcdFx0JCh0aGlzLm1hcC5nZXRWaWV3cG9ydCgpKS5vbignbW91c2Vtb3ZlJywgZnVuY3Rpb24gKGUpIHtcclxuXHRcdFx0XHRcdHZhciBwaXhlbCA9IHNlbGYubWFwLmdldEV2ZW50UGl4ZWwoZS5vcmlnaW5hbEV2ZW50KTtcclxuXHRcdFx0XHRcdHZhciBpc0NsaWNrYWJsZSA9IHNlbGYubWFwLmZvckVhY2hGZWF0dXJlQXRQaXhlbChwaXhlbCwgZnVuY3Rpb24gKGZlYXR1cmUsIGxheWVyKSB7XHJcblx0XHRcdFx0XHRcdGlmIChsYXllciA9PT0gc2VsZi5wYXJ0aWNpcGFudHNMYXllciB8fCBsYXllciA9PT0gc2VsZi5jYW1zTGF5ZXIpIHtcclxuXHRcdFx0XHRcdFx0XHQvLyBhbGwgcGFydGljaXBhbnRzIGFuZCBtb3ZpbmcgY2FtZXJhcyBhcmUgY2xpY2thYmxlXHJcblx0XHRcdFx0XHRcdFx0cmV0dXJuIHRydWU7XHJcblx0XHRcdFx0XHRcdH0gZWxzZSBpZiAobGF5ZXIgPT09IHNlbGYuaG90c3BvdHNMYXllcikge1xyXG5cdFx0XHRcdFx0XHRcdC8vIGdldCBcImNsaWNrYWJpbGl0eVwiIGZyb20gdGhlIGhvdHNwb3RcclxuXHRcdFx0XHRcdFx0XHRyZXR1cm4gZmVhdHVyZS5ob3RzcG90LmlzQ2xpY2thYmxlKCk7XHJcblx0XHRcdFx0XHRcdH1cclxuXHRcdFx0XHRcdH0pO1xyXG5cdFx0XHRcdFx0c2VsZi5tYXAuZ2V0Vmlld3BvcnQoKS5zdHlsZS5jdXJzb3IgPSBpc0NsaWNrYWJsZSA/ICdwb2ludGVyJyA6ICcnO1xyXG5cdFx0XHRcdH0pO1xyXG5cdFx0XHR9XHJcblx0XHRcdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRcdFx0aWYgKCF0aGlzLl9hbmltYXRpb25Jbml0KSB7XHJcblx0XHRcdFx0dGhpcy5fYW5pbWF0aW9uSW5pdD10cnVlO1xyXG5cdFx0XHRcdHNldEludGVydmFsKHRoaXMub25BbmltYXRpb24uYmluZCh0aGlzKSwgMTAwMCpDT05GSUcudGltZW91dHMuYW5pbWF0aW9uRnJhbWUgKTtcclxuXHRcdFx0fVxyXG5cclxuXHRcdFx0Ly8gaWYgdGhpcyBpcyBPTiB0aGVuIGl0IHdpbGwgc2hvdyB0aGUgY29vcmRpbmF0ZXMgcG9zaXRpb24gdW5kZXIgdGhlIG1vdXNlIGxvY2F0aW9uXHJcblx0XHRcdGlmICh0aGlzLmlzRGVidWdTaG93UG9zaXRpb24pIHtcclxuXHRcdFx0XHQkKFwiI21hcFwiKS5hcHBlbmQoJzxwIGlkPVwiZGVidWdTaG93UG9zaXRpb25cIj5FUFNHOjM4NTcgPHNwYW4gaWQ9XCJtb3VzZTM4NTdcIj48L3NwYW4+ICZuYnNwOyBFUFNHOjQzMjYgPHNwYW4gaWQ9XCJtb3VzZTQzMjZcIj48L3NwYW4+Jyk7XHJcblx0XHRcdFx0dGhpcy5tYXAub24oJ3BvaW50ZXJtb3ZlJywgZnVuY3Rpb24oZXZlbnQpIHtcclxuXHRcdFx0XHRcdHZhciBjb29yZDM4NTcgPSBldmVudC5jb29yZGluYXRlO1xyXG5cdFx0XHRcdFx0dmFyIGNvb3JkNDMyNiA9IG9sLnByb2oudHJhbnNmb3JtKGNvb3JkMzg1NywgJ0VQU0c6Mzg1NycsICdFUFNHOjQzMjYnKTtcclxuXHRcdFx0XHRcdCQoJyNtb3VzZTM4NTcnKS50ZXh0KG9sLmNvb3JkaW5hdGUudG9TdHJpbmdYWShjb29yZDM4NTcsIDIpKTtcclxuXHRcdFx0XHRcdCQoJyNtb3VzZTQzMjYnKS50ZXh0KG9sLmNvb3JkaW5hdGUudG9TdHJpbmdYWShjb29yZDQzMjYsIDE1KSk7XHJcblx0XHRcdFx0fSk7XHJcblx0XHRcdH1cclxuXHJcblx0XHRcdC8vIHBhc3MgdGhlIGlkIG9mIHRoZSBET00gZWxlbWVudFxyXG5cdFx0XHR0aGlzLmxpdmVTdHJlYW0gPSBuZXcgTGl2ZVN0cmVhbSh7aWQgOiBcImxpdmVTdHJlYW1cIn0pO1xyXG4gICAgICAgIH0sXHJcblx0XHRcclxuICAgICAgICBcclxuICAgICAgICBhZGRUcmFja0ZlYXR1cmUgOiBmdW5jdGlvbigpIHtcclxuICAgICAgICBcdFRSQUNLLmluaXQoKTtcclxuICAgICAgICBcdGlmIChUUkFDSy5mZWF0dXJlKSB7XHJcbiAgICAgICAgXHRcdHZhciBmdCA9IHRoaXMudHJhY2tMYXllci5nZXRTb3VyY2UoKS5nZXRGZWF0dXJlcygpO1xyXG4gICAgICAgIFx0XHR2YXIgb2s9ZmFsc2U7XHJcbiAgICAgICAgXHRcdGZvciAodmFyIGk9MDtpPGZ0Lmxlbmd0aDtpKyspIFxyXG4gICAgICAgIFx0XHR7XHJcbiAgICAgICAgXHRcdFx0aWYgKGZ0W2ldID09IFRSQUNLLmZlYXR1cmUpXHJcbiAgICAgICAgXHRcdFx0e1xyXG4gICAgICAgIFx0XHRcdFx0b2s9dHJ1ZTtcclxuICAgICAgICBcdFx0XHRcdGJyZWFrO1xyXG4gICAgICAgIFx0XHRcdH1cclxuICAgICAgICBcdFx0fVxyXG4gICAgICAgIFx0XHRpZiAoIW9rKVxyXG4gICAgICAgIFx0XHRcdHRoaXMudHJhY2tMYXllci5nZXRTb3VyY2UoKS5hZGRGZWF0dXJlKFRSQUNLLmZlYXR1cmUpO1xyXG4gICAgICAgIFx0fVxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgem9vbVRvVHJhY2sgOiBmdW5jdGlvbigpIHtcclxuICAgICAgICAgICAgdmFyIGV4dGVudCA9IFRSQUNLLmdldFJvdXRlKCkgJiYgVFJBQ0suZ2V0Um91dGUoKS5sZW5ndGggPiAxID8gb2wucHJvai50cmFuc2Zvcm1FeHRlbnQoIChuZXcgb2wuZ2VvbS5MaW5lU3RyaW5nKFRSQUNLLmdldFJvdXRlKCkpKS5nZXRFeHRlbnQoKSAsICdFUFNHOjQzMjYnLCAnRVBTRzozODU3JykgOiBudWxsO1xyXG4gICAgICAgICAgICBpZiAoZXh0ZW50KVxyXG4gICAgICAgICAgICBcdHRoaXMubWFwLmdldFZpZXcoKS5maXRFeHRlbnQoZXh0ZW50LHRoaXMubWFwLmdldFNpemUoKSk7XHJcbiAgICAgICAgfSxcclxuICAgICAgICBcclxuICAgICAgICBnZXRTZWxlY3RlZFBhcnRpY2lwYW50RnJvbUFycmF5Q3ljbGljIDogZnVuY3Rpb24oZmVhdHVyZXMpIHtcclxuICAgIFx0XHR2YXIgYXJyID0gW107XHJcbiAgICBcdFx0dmFyIHRtYXAgPSB7fTtcclxuICAgIFx0XHR2YXIgY3JyUG9zID0gMDtcclxuXHRcdFx0dmFyIHBvcz1udWxsO1xyXG4gICAgXHRcdGZvciAodmFyIGk9MDtpPGZlYXR1cmVzLmxlbmd0aDtpKyspIHtcclxuICAgIFx0XHRcdHZhciBmZWF0dXJlID0gZmVhdHVyZXNbaV07XHJcbiAgICBcdFx0XHR2YXIgaWQgPSBmZWF0dXJlLnBhcnRpY2lwYW50LmNvZGU7XHJcbiAgICBcdFx0XHRhcnIucHVzaChpZCk7XHJcbiAgICBcdFx0XHR0bWFwW2lkXT10cnVlO1xyXG5cdFx0XHRcdGlmIChpZCA9PSB0aGlzLnZyX2xhc3RzZWxlY3RlZCkge1xyXG5cdFx0XHRcdFx0cG9zPWk7XHJcblx0XHRcdFx0fVxyXG4gICAgXHRcdH1cclxuICAgIFx0XHR2YXIgc2FtZSA9IHRoaXMudnJfb2xkYmVzdGFyciAmJiBwb3MgIT0gbnVsbDsgXHJcbiAgICBcdFx0aWYgKHNhbWUpIFxyXG4gICAgXHRcdHtcclxuICAgIFx0XHRcdC8vIGFsbCBmcm9tIHRoZSBvbGQgY29udGFpbmVkIGluIHRoZSBuZXdcclxuICAgIFx0XHRcdGZvciAodmFyIGk9MDtpPHRoaXMudnJfb2xkYmVzdGFyci5sZW5ndGg7aSsrKSBcclxuICAgIFx0XHRcdHtcclxuICAgIFx0XHRcdFx0aWYgKCF0bWFwW3RoaXMudnJfb2xkYmVzdGFycltpXV0pIHtcclxuICAgIFx0XHRcdFx0XHRzYW1lPWZhbHNlO1xyXG4gICAgXHRcdFx0XHRcdGJyZWFrO1xyXG4gICAgXHRcdFx0XHR9XHJcbiAgICBcdFx0XHR9XHJcbiAgICBcdFx0fVxyXG4gICAgXHRcdGlmICghc2FtZSkge1xyXG4gICAgXHRcdFx0dGhpcy52cl9vbGRiZXN0YXJyPWFycjtcclxuICAgIFx0XHRcdHRoaXMudnJfbGFzdHNlbGVjdGVkPWFyclswXTtcclxuICAgIFx0XHRcdHJldHVybiBmZWF0dXJlc1swXTtcclxuICAgIFx0XHR9IGVsc2Uge1xyXG4gICAgXHRcdFx0dGhpcy52cl9sYXN0c2VsZWN0ZWQgPSBwb3MgPiAwID8gYXJyW3Bvcy0xXSA6IGFyclthcnIubGVuZ3RoLTFdOyAgICBcdFx0XHRcclxuICAgICAgICBcdFx0dmFyIHJlc3VsdEZlYXR1cmU7XHJcbiAgICBcdFx0XHRmb3IgKHZhciBpPTA7aTxmZWF0dXJlcy5sZW5ndGg7aSsrKSBcclxuICAgICAgICBcdFx0e1xyXG4gICAgICAgIFx0XHRcdHZhciBmZWF0dXJlID0gZmVhdHVyZXNbaV07XHJcbiAgICAgICAgXHRcdFx0dmFyIGlkID0gZmVhdHVyZS5wYXJ0aWNpcGFudC5jb2RlO1xyXG4gICAgICAgIFx0XHRcdGlmIChpZCA9PSB0aGlzLnZyX2xhc3RzZWxlY3RlZCkge1xyXG4gICAgICAgIFx0XHRcdFx0cmVzdWx0RmVhdHVyZT1mZWF0dXJlO1xyXG4gICAgICAgIFx0XHRcdFx0YnJlYWs7XHJcbiAgICAgICAgXHRcdFx0fVxyXG4gICAgICAgIFx0XHR9XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gcmVzdWx0RmVhdHVyZTtcclxuICAgIFx0XHR9XHJcbiAgICAgICAgfSxcclxuICAgICAgICBcclxuXHRcdHNob3dFcnJvciA6IGZ1bmN0aW9uKG1zZyxvbkNsb3NlQ2FsbGJhY2spXHJcblx0XHR7XHJcblx0XHRcdGFsZXJ0KFwiRVJST1IgOiBcIittc2cpO1xyXG5cdFx0XHRpZiAob25DbG9zZUNhbGxiYWNrKSBcclxuXHRcdFx0XHRvbkNsb3NlQ2FsbGJhY2soKTtcclxuXHRcdH0sXHJcblx0XHRcclxuXHRcdG9uQW5pbWF0aW9uIDogZnVuY3Rpb24oKVxyXG5cdFx0e1xyXG5cdFx0XHR2YXIgYXJyPVtdO1xyXG5cdFx0XHRmb3IgKHZhciBpcD0wO2lwPFRSQUNLLnBhcnRpY2lwYW50cy5sZW5ndGg7aXArKylcclxuXHRcdFx0e1xyXG5cdFx0XHRcdHZhciBwID0gVFJBQ0sucGFydGljaXBhbnRzW2lwXTtcclxuXHRcdFx0XHRpZiAocC5pc0Zhdm9yaXRlKVxyXG5cdFx0XHRcdHtcclxuXHRcdFx0XHRcdHAuaW50ZXJwb2xhdGUoKTtcclxuXHJcblx0XHRcdFx0XHQvLyB0aGlzIHdpbGwgYWRkIGluIHRoZSByYW5raW5nIHBvc2l0aW5nIG9ubHkgdGhlIHBhcnRpY2lwYW50cyB0aGUgaGFzIHRvIGJlIHRyYWNrZWRcclxuXHRcdFx0XHRcdC8vIHNvIG1vdmluZyBjYW1zIGFyZSBza2lwcGVkXHJcblx0XHRcdFx0XHRpZiAoIXAuX19za2lwVHJhY2tpbmdQb3MpXHJcblx0XHRcdFx0XHRcdGFyci5wdXNoKGlwKTtcclxuXHRcdFx0XHR9XHJcblx0XHRcdH1cclxuXHRcdFx0Ly8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0XHRcdC8vIHdlIGhhdmUgdG8gc29ydCB0aGVtIG90aGVyd2lzZSB0aGlzIF9fcG9zLCBfX3ByZXYsIF9fbmV4dCBhcmUgaXJyZWxldmFudFxyXG5cdFx0XHRhcnIuc29ydChmdW5jdGlvbihpcDEsIGlkMil7XHJcblx0XHRcdFx0cmV0dXJuIFRSQUNLLnBhcnRpY2lwYW50c1tpZDJdLmdldEVsYXBzZWQoKSAtIFRSQUNLLnBhcnRpY2lwYW50c1tpcDFdLmdldEVsYXBzZWQoKTtcclxuXHRcdFx0fSk7XHJcblx0XHRcdGZvciAodmFyIGlwPTA7aXA8YXJyLmxlbmd0aDtpcCsrKVxyXG5cdFx0XHR7XHJcblx0XHRcdFx0VFJBQ0sucGFydGljaXBhbnRzW2FycltpcF1dLl9fcG9zPWlwO1xyXG5cdFx0XHRcdGlmIChpcCA9PSAwKVxyXG5cdFx0XHRcdFx0ZGVsZXRlIFRSQUNLLnBhcnRpY2lwYW50c1thcnJbaXBdXS5fX3ByZXY7XHJcblx0XHRcdFx0ZWxzZVxyXG5cdFx0XHRcdFx0VFJBQ0sucGFydGljaXBhbnRzW2FycltpcF1dLl9fcHJldj1UUkFDSy5wYXJ0aWNpcGFudHNbYXJyW2lwLTFdXTtcclxuXHRcdFx0XHRpZiAoaXAgPT0gVFJBQ0sucGFydGljaXBhbnRzLmxlbmd0aC0xKVxyXG5cdFx0XHRcdFx0ZGVsZXRlICBUUkFDSy5wYXJ0aWNpcGFudHNbYXJyW2lwXV0uX19uZXh0O1xyXG5cdFx0XHRcdGVsc2VcclxuXHRcdFx0XHRcdFRSQUNLLnBhcnRpY2lwYW50c1thcnJbaXBdXS5fX25leHQ9VFJBQ0sucGFydGljaXBhbnRzW2FycltpcCsxXV07XHJcblx0XHRcdH1cclxuXHRcdFx0Ly8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0XHRcdGlmICh0aGlzLnNlbGVjdGVkUGFydGljaXBhbnQxKSBcclxuXHRcdFx0e1xyXG5cdFx0XHRcdHZhciBzcG9zID0gdGhpcy5zZWxlY3RlZFBhcnRpY2lwYW50MS5nZXRGZWF0dXJlKCkuZ2V0R2VvbWV0cnkoKS5nZXRDb29yZGluYXRlcygpO1xyXG5cdFx0XHRcdGlmICghdGhpcy5wb3B1cDEuaXNfc2hvd24pIHtcclxuXHRcdFx0XHQgICAgdGhpcy5wb3B1cDEuc2hvdyhzcG9zLCB0aGlzLnBvcHVwMS5sYXN0SFRNTD10aGlzLnNlbGVjdGVkUGFydGljaXBhbnQxLmdldFBvcHVwSFRNTCgpKTtcclxuXHRcdFx0XHQgICAgdGhpcy5wb3B1cDEuaXNfc2hvd249MTtcclxuXHRcdFx0XHR9IGVsc2Uge1xyXG5cdFx0XHRcdFx0aWYgKCF0aGlzLnBvcHVwMS5nZXRQb3NpdGlvbigpIHx8IHRoaXMucG9wdXAxLmdldFBvc2l0aW9uKClbMF0gIT0gc3Bvc1swXSB8fCB0aGlzLnBvcHVwMS5nZXRQb3NpdGlvbigpWzFdICE9IHNwb3NbMV0pXHJcblx0XHRcdFx0XHQgICAgdGhpcy5wb3B1cDEuc2V0UG9zaXRpb24oc3Bvcyk7XHJcblx0XHRcdFx0XHR2YXIgY3RpbWUgPSAobmV3IERhdGUoKSkuZ2V0VGltZSgpO1x0XHRcdCBcclxuXHRcdFx0XHRcdGlmICghdGhpcy5sYXN0UG9wdXBSZWZlcmVzaDEgfHwgY3RpbWUgLSB0aGlzLmxhc3RQb3B1cFJlZmVyZXNoMSA+IDIwMDApIFxyXG5cdFx0XHRcdFx0e1xyXG5cdFx0XHRcdFx0XHR0aGlzLmxhc3RQb3B1cFJlZmVyZXNoMT1jdGltZTtcclxuXHRcdFx0XHRcdCAgICB2YXIgcnIgPSB0aGlzLnNlbGVjdGVkUGFydGljaXBhbnQxLmdldFBvcHVwSFRNTCgpO1xyXG5cdFx0XHRcdFx0ICAgIGlmIChyciAhPSB0aGlzLnBvcHVwMS5sYXN0SFRNTCkge1xyXG5cdFx0XHRcdFx0ICAgIFx0dGhpcy5wb3B1cDEubGFzdEhUTUw9cnI7XHJcblx0XHRcdFx0XHRcdCAgICB0aGlzLnBvcHVwMS5jb250ZW50LmlubmVySFRNTD1ycjsgXHJcblx0XHRcdFx0XHQgICAgfVx0XHRcdFx0XHRcclxuXHRcdFx0XHRcdH1cclxuXHRcdFx0XHQgICAgdGhpcy5wb3B1cDEucGFuSW50b1ZpZXdfKHNwb3MpO1xyXG5cdFx0XHRcdH1cclxuXHRcdFx0fVxyXG5cdFx0XHRpZiAodGhpcy5zZWxlY3RlZFBhcnRpY2lwYW50MikgXHJcblx0XHRcdHtcclxuXHRcdFx0XHR2YXIgc3BvcyA9IHRoaXMuc2VsZWN0ZWRQYXJ0aWNpcGFudDIuZ2V0RmVhdHVyZSgpLmdldEdlb21ldHJ5KCkuZ2V0Q29vcmRpbmF0ZXMoKTtcclxuXHRcdFx0XHRpZiAoIXRoaXMucG9wdXAyLmlzX3Nob3duKSB7XHJcblx0XHRcdFx0ICAgIHRoaXMucG9wdXAyLnNob3coc3BvcywgdGhpcy5wb3B1cDIubGFzdEhUTUw9dGhpcy5zZWxlY3RlZFBhcnRpY2lwYW50Mi5nZXRQb3B1cEhUTUwoKSk7XHJcblx0XHRcdFx0ICAgIHRoaXMucG9wdXAyLmlzX3Nob3duPTE7XHJcblx0XHRcdFx0fSBlbHNlIHtcclxuXHRcdFx0XHRcdGlmICghdGhpcy5wb3B1cDIuZ2V0UG9zaXRpb24oKSB8fCB0aGlzLnBvcHVwMi5nZXRQb3NpdGlvbigpWzBdICE9IHNwb3NbMF0gfHwgdGhpcy5wb3B1cDIuZ2V0UG9zaXRpb24oKVsxXSAhPSBzcG9zWzFdKVxyXG5cdFx0XHRcdFx0ICAgIHRoaXMucG9wdXAyLnNldFBvc2l0aW9uKHNwb3MpO1xyXG5cdFx0XHRcdFx0dmFyIGN0aW1lID0gKG5ldyBEYXRlKCkpLmdldFRpbWUoKTtcdFx0XHQgXHJcblx0XHRcdFx0XHRpZiAoIXRoaXMubGFzdFBvcHVwUmVmZXJlc2gyIHx8IGN0aW1lIC0gdGhpcy5sYXN0UG9wdXBSZWZlcmVzaDIgPiAyMDAwKSBcclxuXHRcdFx0XHRcdHtcclxuXHRcdFx0XHRcdFx0dGhpcy5sYXN0UG9wdXBSZWZlcmVzaDI9Y3RpbWU7XHJcblx0XHRcdFx0XHQgICAgdmFyIHJyID0gdGhpcy5zZWxlY3RlZFBhcnRpY2lwYW50Mi5nZXRQb3B1cEhUTUwoKTtcclxuXHRcdFx0XHRcdCAgICBpZiAocnIgIT0gdGhpcy5wb3B1cDIubGFzdEhUTUwpIHtcclxuXHRcdFx0XHRcdCAgICBcdHRoaXMucG9wdXAyLmxhc3RIVE1MPXJyO1xyXG5cdFx0XHRcdFx0XHQgICAgdGhpcy5wb3B1cDIuY29udGVudC5pbm5lckhUTUw9cnI7IFxyXG5cdFx0XHRcdFx0ICAgIH1cdFx0XHRcdFx0XHJcblx0XHRcdFx0XHR9XHJcblx0XHRcdFx0ICAgIHRoaXMucG9wdXAyLnBhbkludG9WaWV3XyhzcG9zKTtcclxuXHRcdFx0XHR9XHJcblx0XHRcdH1cclxuXHRcdFx0Ly8tLS0tLS0tLS0tLS0tLS0tLS0tLVx0XHRcdFxyXG5cdFx0XHRpZiAodGhpcy5pc0RlYnVnKSAgXHJcblx0XHRcdFx0dGhpcy5kb0RlYnVnQW5pbWF0aW9uKCk7XHJcblx0XHR9LFxyXG5cdFx0XHJcblx0XHRzZXRTZWxlY3RlZFBhcnRpY2lwYW50MSA6IGZ1bmN0aW9uKHBhcnQsY2VudGVyKSBcclxuXHRcdHtcclxuXHRcdFx0aWYgKCEocGFydCBpbnN0YW5jZW9mIFBhcnRpY2lwYW50KSkge1xyXG5cdFx0XHRcdHZhciBwcD1wYXJ0O1xyXG5cdFx0XHRcdHBhcnQ9bnVsbDtcclxuXHRcdFx0XHRmb3IgKHZhciBpPTA7aTxUUkFDSy5wYXJ0aWNpcGFudHMubGVuZ3RoO2krKylcclxuXHRcdFx0XHRcdGlmIChUUkFDSy5wYXJ0aWNpcGFudHNbaV0uZGV2aWNlSWQgPT0gcHApIHtcclxuXHRcdFx0XHRcdFx0cGFydD1UUkFDSy5wYXJ0aWNpcGFudHNbaV07XHJcblx0XHRcdFx0XHRcdGJyZWFrO1xyXG5cdFx0XHRcdFx0fVxyXG5cdFx0XHR9XHJcblx0XHRcdHRoaXMuc2VsZWN0ZWRQYXJ0aWNpcGFudDE9cGFydDtcclxuXHRcdFx0aWYgKCFwYXJ0KSB7XHJcblx0XHRcdFx0dGhpcy5wb3B1cDEuaGlkZSgpO1xyXG5cdFx0XHRcdGRlbGV0ZSB0aGlzLnBvcHVwMS5pc19zaG93bjtcclxuXHRcdFx0fSBlbHNlIHtcclxuXHRcdFx0XHR0aGlzLmxhc3RQb3B1cFJlZmVyZXNoMT0wO1xyXG5cdFx0XHRcdGlmIChjZW50ZXIgJiYgR1VJLm1hcCAmJiBwYXJ0LmZlYXR1cmUpIHtcclxuXHRcdFx0XHRcdHZhciB4ID0gKHBhcnQuZmVhdHVyZS5nZXRHZW9tZXRyeSgpLmdldEV4dGVudCgpWzBdK3BhcnQuZmVhdHVyZS5nZXRHZW9tZXRyeSgpLmdldEV4dGVudCgpWzJdKS8yO1xyXG5cdFx0XHRcdFx0dmFyIHkgPSAocGFydC5mZWF0dXJlLmdldEdlb21ldHJ5KCkuZ2V0RXh0ZW50KClbMV0rcGFydC5mZWF0dXJlLmdldEdlb21ldHJ5KCkuZ2V0RXh0ZW50KClbM10pLzI7XHJcblx0XHRcdFx0XHRHVUkubWFwLmdldFZpZXcoKS5zZXRDZW50ZXIoW3gseV0pO1xyXG5cdFx0XHRcdH1cclxuXHRcdFx0fSBcclxuXHRcdH0sXHJcblxyXG5cdFx0c2V0U2VsZWN0ZWRQYXJ0aWNpcGFudDIgOiBmdW5jdGlvbihwYXJ0LGNlbnRlcikgXHJcblx0XHR7XHJcblx0XHRcdGlmICghKHBhcnQgaW5zdGFuY2VvZiBQYXJ0aWNpcGFudCkpIHtcclxuXHRcdFx0XHR2YXIgcHA9cGFydDtcclxuXHRcdFx0XHRwYXJ0PW51bGw7XHJcblx0XHRcdFx0Zm9yICh2YXIgaT0wO2k8VFJBQ0sucGFydGljaXBhbnRzLmxlbmd0aDtpKyspXHJcblx0XHRcdFx0XHRpZiAoVFJBQ0sucGFydGljaXBhbnRzW2ldLmRldmljZUlkID09IHBwKSB7XHJcblx0XHRcdFx0XHRcdHBhcnQ9VFJBQ0sucGFydGljaXBhbnRzW2ldO1xyXG5cdFx0XHRcdFx0XHRicmVhaztcclxuXHRcdFx0XHRcdH1cclxuXHRcdFx0fVxyXG5cdFx0XHR0aGlzLnNlbGVjdGVkUGFydGljaXBhbnQyPXBhcnQ7XHJcblx0XHRcdGlmICghcGFydCkge1xyXG5cdFx0XHRcdHRoaXMucG9wdXAyLmhpZGUoKTtcclxuXHRcdFx0XHRkZWxldGUgdGhpcy5wb3B1cDIuaXNfc2hvd247XHJcblx0XHRcdH0gZWxzZSB7XHJcblx0XHRcdFx0dGhpcy5sYXN0UG9wdXBSZWZlcmVzaDI9MDtcclxuXHRcdFx0XHRpZiAoY2VudGVyICYmIEdVSS5tYXAgJiYgcGFydC5mZWF0dXJlKSB7XHJcblx0XHRcdFx0XHR2YXIgeCA9IChwYXJ0LmZlYXR1cmUuZ2V0R2VvbWV0cnkoKS5nZXRFeHRlbnQoKVswXStwYXJ0LmZlYXR1cmUuZ2V0R2VvbWV0cnkoKS5nZXRFeHRlbnQoKVsyXSkvMjtcclxuXHRcdFx0XHRcdHZhciB5ID0gKHBhcnQuZmVhdHVyZS5nZXRHZW9tZXRyeSgpLmdldEV4dGVudCgpWzFdK3BhcnQuZmVhdHVyZS5nZXRHZW9tZXRyeSgpLmdldEV4dGVudCgpWzNdKS8yO1xyXG5cdFx0XHRcdFx0R1VJLm1hcC5nZXRWaWV3KCkuc2V0Q2VudGVyKFt4LHldKTtcclxuXHRcdFx0XHR9XHJcblx0XHRcdH0gXHJcblx0XHR9LFxyXG5cclxuXHRcdGRvRGVidWdBbmltYXRpb24gOiBmdW5jdGlvbigpIFxyXG5cdFx0e1xyXG5cdFx0XHR2YXIgY3RpbWUgPSAobmV3IERhdGUoKSkuZ2V0VGltZSgpO1xyXG5cdFx0XHR2YXIgdG9kZWw9W107XHJcblx0XHRcdHZhciByciA9IHRoaXMuZGVidWdMYXllckdQUy5nZXRTb3VyY2UoKS5nZXRGZWF0dXJlcygpO1xyXG5cdFx0XHRmb3IgKHZhciBpPTA7aTxyci5sZW5ndGg7aSsrKVxyXG5cdFx0XHR7XHJcblx0XHRcdFx0dmFyIGYgPSBycltpXTtcclxuXHRcdFx0XHRpZiAoY3RpbWUgLSBmLnRpbWVDcmVhdGVkIC0gQ09ORklHLm1hdGguZGlzcGxheURlbGF5KjEwMDAgPiBDT05GSUcudGltZW91dHMuZ3BzTG9jYXRpb25EZWJ1Z1Nob3cqMTAwMClcclxuXHRcdFx0XHRcdHRvZGVsLnB1c2goZik7XHJcblx0XHRcdFx0ZWxzZVxyXG5cdFx0XHRcdFx0Zi5jaGFuZ2VkKCk7XHJcblx0XHRcdH1cclxuXHRcdFx0aWYgKHRvZGVsLmxlbmd0aCkgXHJcblx0XHRcdHtcclxuXHRcdFx0XHRmb3IgKHZhciBpPTA7aTx0b2RlbC5sZW5ndGg7aSsrKVxyXG5cdFx0XHRcdFx0dGhpcy5kZWJ1Z0xheWVyR1BTLmdldFNvdXJjZSgpLnJlbW92ZUZlYXR1cmUodG9kZWxbaV0pO1xyXG5cdFx0XHR9XHJcblx0XHRcdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdFx0fSxcclxuXHRcdFxyXG5cdFx0cmVkcmF3IDogZnVuY3Rpb24oKSB7XHJcblx0XHRcdHRoaXMuZ2V0VHJhY2soKS5nZXRGZWF0dXJlKCkuY2hhbmdlZCgpO1xyXG5cdFx0fSxcclxuXHJcbiAgICAgICAgLyoqXHJcbiAgICAgICAgICogU2hvdyB0aGUgbGl2ZS1zdHJlYW1pbmcgY29udGFpbmVyLiBJZiB0aGUgcGFzc2VkICdzdHJlYW1JZCcgaXMgdmFsaWQgdGhlbiBpdCBvcGVucyBpdHMgc3RyZWFtIGRpcmVjdGx5LlxyXG4gICAgICAgICAqIEBwYXJhbSB7U3RyaW5nfSBbc3RyZWFtSWRdXHJcbiAgICAgICAgICogQHBhcmFtIHtGdW5jdGlvbn0gW2NvbXBsZXRlQ2FsbGJhY2tdXHJcbiAgICAgICAgICovXHJcbiAgICAgICAgc2hvd0xpdmVTdHJlYW0gOiBmdW5jdGlvbihzdHJlYW1JZCwgY29tcGxldGVDYWxsYmFjaykge1xyXG4gICAgICAgICAgICB0aGlzLmxpdmVTdHJlYW0uc2hvdyhzdHJlYW1JZCwgY29tcGxldGVDYWxsYmFjayk7XHJcbiAgICAgICAgfSxcclxuXHJcbiAgICAgICAgLyoqXHJcbiAgICAgICAgICogVG9nZ2xlIHRoZSBsaXZlLXN0cmVhbWluZyBjb250YWluZXIgY29udGFpbmVyXHJcblx0XHQgKiBAcGFyYW0ge0Z1bmN0aW9ufSBbY29tcGxldGVDYWxsYmFja11cclxuICAgICAgICAgKi9cclxuICAgICAgICB0b2dnbGVMaXZlU3RyZWFtOiBmdW5jdGlvbihjb21wbGV0ZUNhbGxiYWNrKSB7XHJcbiAgICAgICAgICAgIHJldHVybiB0aGlzLmxpdmVTdHJlYW0udG9nZ2xlKGNvbXBsZXRlQ2FsbGJhY2spO1xyXG4gICAgICAgIH1cclxuXHRcdFxyXG4gICAgfVxyXG59KTsiLCJyZXF1aXJlKCdqb29zZScpO1xyXG5yZXF1aXJlKCcuL1BvaW50Jyk7XHJcbnJlcXVpcmUoJy4vVXRpbHMnKTtcclxuXHJcbkNsYXNzKFwiSG90U3BvdFwiLCB7XHJcbiAgICBpc2EgOiBQb2ludCxcclxuXHJcbiAgICBoYXMgOiB7XHJcbiAgICAgICAgdHlwZSA6IHtcclxuICAgICAgICAgICAgaXMgOiBcInJvXCIsXHJcbiAgICAgICAgICAgIHJlcXVpcmVkIDogdHJ1ZSxcclxuICAgICAgICAgICAgaW5pdCA6IG51bGxcclxuICAgICAgICB9LFxyXG5cclxuICAgICAgICBjbGlja2FibGUgOiB7XHJcbiAgICAgICAgICAgIGluaXQgOiBmYWxzZVxyXG4gICAgICAgIH0sXHJcblxyXG4gICAgICAgIGxpdmVTdHJlYW0gOiB7XHJcbiAgICAgICAgICAgIGluaXQgOiBudWxsXHJcbiAgICAgICAgfVxyXG4gICAgfSxcclxuXHJcbiAgICBhZnRlciA6IHtcclxuICAgICAgICBpbml0IDogZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgICAgIHRoaXMuZmVhdHVyZS5ob3RzcG90PXRoaXM7XHJcbiAgICAgICAgICAgIEdVSS5ob3RzcG90c0xheWVyLmdldFNvdXJjZSgpLmFkZEZlYXR1cmUodGhpcy5mZWF0dXJlKTtcclxuICAgICAgICB9XHJcbiAgICB9LFxyXG5cclxuICAgIG1ldGhvZHMgOiB7XHJcbiAgICAgICAgb25DbGljayA6IGZ1bmN0aW9uKCkge1xyXG4gICAgICAgICAgICB2YXIgaXNDb25zdW1lZCA9IGZhbHNlO1xyXG5cclxuICAgICAgICAgICAgaWYgKHRoaXMuY2xpY2thYmxlKSB7XHJcbiAgICAgICAgICAgICAgICAvLyBmb3Igbm93IG9ubHkgaG90c3BvdHMgd2l0aCBhdHRhY2hlZCBsaXZlLXN0cmVhbSBjYW4gYmUgY2xpY2tlZFxyXG4gICAgICAgICAgICAgICAgaWYgKGlzRGVmaW5lZCh0aGlzLmxpdmVTdHJlYW0pKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgR1VJLnNob3dMaXZlU3RyZWFtKHRoaXMubGl2ZVN0cmVhbSk7XHJcbiAgICAgICAgICAgICAgICAgICAgLy8gd2VsbCB0aGlzIGV2ZW50IHNob3VsZCBiZSBjb25zdW1lZCBhbmQgbm90IGhhbmRsZWQgYW55IG1vcmUgKGxpa2Ugd2hlbiBjbGlja2VkIG9uIGFub3RoZXIgZmVhdHVyZVxyXG4gICAgICAgICAgICAgICAgICAgIGlzQ29uc3VtZWQgPSB0cnVlO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICByZXR1cm4gaXNDb25zdW1lZFxyXG4gICAgICAgIH0sXHJcblxyXG4gICAgICAgIGlzQ2xpY2thYmxlIDogZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgICAgIHJldHVybiB0aGlzLmNsaWNrYWJsZTtcclxuICAgICAgICB9XHJcblxyXG4gICAgfVxyXG59KTsiLCIvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5yZXF1aXJlKCcuL1RyYWNrJyk7XHJcbnJlcXVpcmUoJy4vR3VpJyk7XHJcbnJlcXVpcmUoJy4vUGFydGljaXBhbnQnKTtcclxucmVxdWlyZSgnLi9Nb3ZpbmdDYW0nKTtcclxucmVxdWlyZSgnLi9Ib3RTcG90Jyk7XHJcbnJlcXVpcmUoJy4vQmFja2VuZFN0cmVhbScpO1xyXG5yZXF1aXJlKCcuLy4uL25vZGVqcy9TdHJlYW1EYXRhJyk7XHJcbndpbmRvdy5DT05GSUcgPSByZXF1aXJlKCcuL0NvbmZpZycpO1xyXG52YXIgVXRpbHMgPSByZXF1aXJlKCcuL1V0aWxzJyk7XHJcbmZvciAodmFyIGUgaW4gVXRpbHMpXHJcbiAgICB3aW5kb3dbZV0gPSBVdGlsc1tlXTtcclxuLy8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuZnVuY3Rpb24gZ2V0U2VhcmNoUGFyYW1ldGVycygpIHtcclxuICAgIHZhciBwcm1zdHIgPSB3aW5kb3cubG9jYXRpb24uc2VhcmNoLnN1YnN0cigxKTtcclxuICAgIHJldHVybiBwcm1zdHIgIT0gbnVsbCAmJiBwcm1zdHIgIT0gXCJcIiA/IHRyYW5zZm9ybVRvQXNzb2NBcnJheShwcm1zdHIpIDoge307XHJcbn1cclxuZnVuY3Rpb24gdHJhbnNmb3JtVG9Bc3NvY0FycmF5KHBybXN0cikge1xyXG4gICAgdmFyIHBhcmFtcyA9IHt9O1xyXG4gICAgdmFyIHBybWFyciA9IHBybXN0ci5zcGxpdChcIiZcIik7XHJcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IHBybWFyci5sZW5ndGg7IGkrKykge1xyXG4gICAgICAgIHZhciB0bXBhcnIgPSBwcm1hcnJbaV0uc3BsaXQoXCI9XCIpO1xyXG4gICAgICAgIHBhcmFtc1t0bXBhcnJbMF1dID0gdG1wYXJyWzFdO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIHBhcmFtcztcclxufVxyXG52YXIgcGFyYW1zID0gZ2V0U2VhcmNoUGFyYW1ldGVycygpO1xyXG4vLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcbmlmIChwYXJhbXNbXCJkZWJ1Z1wiXSAmJiBwYXJhbXNbXCJkZWJ1Z1wiXSAhPSBcIjBcIikge1xyXG4gICAgY29uc29sZS53YXJuKFwiR09JTkcgVE8gREVCVUcgTU9ERS4uLlwiKTtcclxuICAgIENPTkZJRy50aW1lb3V0cy5hbmltYXRpb25GcmFtZSA9IDQ7IC8vIDQgc2VjXHJcbn1cclxuLy8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5pZiAocGFyYW1zW1wic2ltcGxlXCJdICYmIHBhcmFtc1tcInNpbXBsZVwiXSAhPSBcIjBcIikge1xyXG4gICAgY29uc29sZS53YXJuKFwiR09JTkcgVE8gU0lNUExFIE1PREUuLi5cIik7XHJcbiAgICBDT05GSUcuc2V0dGluZ3Mubm9NaWRkbGVXYXJlID0gMTtcclxuICAgIENPTkZJRy5zZXR0aW5ncy5ub0ludGVycG9sYXRpb24gPSAxO1xyXG59XHJcbi8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxudmFyIHRhYmxlRmF2b3JpdGVzID0gbnVsbDtcclxudmFyIHRhYmxlUGFydGljaXBhbnRzID0gbnVsbDtcclxuXHJcbmZ1bmN0aW9uIHNob3dNYXAoKSB7XHJcbiAgICAkKFwiI2xlZnRfcGFuZVwiKS5hZGRDbGFzcygnaGlkZScpO1xyXG4gICAgJChcIiNtYXBcIikucmVtb3ZlQ2xhc3MoJ2NvbC1zbS02IGNvbC1tZC04IGhpZGRlbi14cycpLmFkZENsYXNzKCdjb2wtc20tMTInKTtcclxuICAgICQod2luZG93KS5yZXNpemUoKTtcclxuICAgIGlmIChHVUkubWFwKVxyXG4gICAgICAgIEdVSS5tYXAudXBkYXRlU2l6ZSgpO1xyXG59XHJcbmZ1bmN0aW9uIHNob3dMZWZ0UGFuZSgpIHtcclxuICAgICQoXCIjbWFwXCIpLmFkZENsYXNzKCdjb2wtc20tNiBjb2wtbWQtOCBoaWRkZW4teHMnKS5yZW1vdmVDbGFzcygnY29sLXNtLTEyJyk7XHJcbiAgICAkKFwiI2xlZnRfcGFuZVwiKS5yZW1vdmVDbGFzcygnaGlkZScpO1xyXG4gICAgJCh3aW5kb3cpLnJlc2l6ZSgpO1xyXG4gICAgaWYgKEdVSS5tYXApXHJcbiAgICAgICAgR1VJLm1hcC51cGRhdGVTaXplKCk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGlzVGFiVmlzaWJsZSh0YWJJZCkge1xyXG4gICAgaWYgKCQoXCIjbGVmdF9wYW5lXCIpLmhhc0NsYXNzKFwiaGlkZVwiKSlcclxuICAgICAgICByZXR1cm4gZmFsc2U7XHJcbiAgICByZXR1cm4gISgkKCcjJyArIHRhYklkKS5oYXNDbGFzcygnaGlkZScpKTtcclxufVxyXG5cclxuZnVuY3Rpb24gc2hvd1RhYih0YWJJZCkge1xyXG4gICAgc2hvd0xlZnRQYW5lKCk7XHJcblxyXG4gICAgJCgnI3RhYmNvbnQnKS5maW5kKCdkaXZbcm9sZT1cInRhYnBhbmVsXCJdJykuYWRkQ2xhc3MoJ2hpZGUnKTtcclxuICAgICQoJyMnICsgdGFiSWQpLnJlbW92ZUNsYXNzKCdoaWRlJyk7XHJcblxyXG4gICAgaWYgKHRhYklkID09IFwicGFydGljaXBhbnRzXCIpIHtcclxuICAgICAgICBpbml0VGFibGVQYXJ0aWNpcGFudHMoKTtcclxuICAgIH0gZWxzZSBpZiAodGFiSWQgPT0gXCJmYXZvcml0ZXNcIikge1xyXG4gICAgICAgIGluaXRUYWJsZUZhdm9yaXRlcygpO1xyXG4gICAgfVxyXG59XHJcblxyXG5mdW5jdGlvbiBpbml0VGFibGVQYXJ0aWNpcGFudHMoKSB7XHJcbiAgICBpZiAoIXRhYmxlUGFydGljaXBhbnRzKSB7XHJcbiAgICAgICAgdmFyIGFyciA9IFBBUlRJQ0lQQU5UUztcclxuICAgICAgICB2YXIgcmVzID0gW107XHJcbiAgICAgICAgZm9yICh2YXIgaSBpbiBhcnIpIHtcclxuICAgICAgICAgICAgdmFyIHBhcnQgPSBhcnJbaV07XHJcbiAgICAgICAgICAgIHJlcy5wdXNoKHtcclxuICAgICAgICAgICAgICAgIGlkOiBwYXJ0LmlkLFxyXG4gICAgICAgICAgICAgICAgZm9sbG93OiBwYXJ0LmlzRmF2b3JpdGUsXHJcbiAgICAgICAgICAgICAgICBuYW1lOiBwYXJ0LmNvZGUsXHJcbiAgICAgICAgICAgICAgICBiaWI6IHBhcnQuc3RhcnRQb3MsXHJcbiAgICAgICAgICAgICAgICBnZW5kZXI6IHBhcnQuZ2VuZGVyLFxyXG4gICAgICAgICAgICAgICAgY291bnRyeTogcGFydC5jb3VudHJ5LFxyXG4gICAgICAgICAgICAgICAgYWdlR3JvdXA6IHBhcnQuYWdlR3JvdXAsXHJcbiAgICAgICAgICAgICAgICBhZ2U6IHBhcnQuYWdlLFxyXG4gICAgICAgICAgICAgICAgXCJvdmVyYWxsLXJhbmtcIjogcGFydC5nZXRPdmVyYWxsUmFuaygpLFxyXG4gICAgICAgICAgICAgICAgXCJnZW5kZXItcmFua1wiOiBwYXJ0LmdldEdlbmRlclJhbmsoKSxcclxuICAgICAgICAgICAgICAgIFwiZ3JvdXAtcmFua1wiOiBwYXJ0LmdldEdyb3VwUmFuaygpLFxyXG4gICAgICAgICAgICAgICAgXCJvY2N1cGF0aW9uXCI6IFwiXCJcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHRhYmxlUGFydGljaXBhbnRzID0gJCgnI3RhYmxlLXBhcnRpY2lwYW50cycpLkRhdGFUYWJsZSh7XHJcbiAgICAgICAgICAgIFwiaURpc3BsYXlMZW5ndGhcIjogNTAsXHJcbiAgICAgICAgICAgIFwiYkF1dG9XaWR0aFwiOiBmYWxzZSxcclxuICAgICAgICAgICAgXCJhYVNvcnRpbmdcIjogW1sxLCAnYXNjJ11dLFxyXG4gICAgICAgICAgICBkYXRhOiByZXMsXHJcbiAgICAgICAgICAgIGNvbHVtbnM6IFtcclxuICAgICAgICAgICAgICAgIHtcclxuICAgICAgICAgICAgICAgICAgICAvL2ZvbGxvd1xyXG4gICAgICAgICAgICAgICAgICAgIGNsYXNzTmFtZTogXCJkdC1ib2R5LWNlbnRlclwiLFxyXG4gICAgICAgICAgICAgICAgICAgIGRhdGE6IG51bGwsXHJcbiAgICAgICAgICAgICAgICAgICAgcmVuZGVyOiBmdW5jdGlvbiAoZGF0YSwgdHlwZSwgcm93KSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHZhciBmYXZJbWdTcmM7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChkYXRhLmZvbGxvdyA9PSAxKVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZmF2SW1nU3JjID0gXCJzdGFyX3NvbGlkLnN2Z1wiO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBlbHNlXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBmYXZJbWdTcmMgPSBcInN0YXIuc3ZnXCI7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBcIjxpbWcgZGF0YS1pZD0nXCIgKyBkYXRhLmlkICsgXCInIHNyYz0naW1nL1wiICsgZmF2SW1nU3JjICsgXCInIGNsYXNzPSd0YWJsZS1mYXZvcml0ZS1hZGQnLz5cIjtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9LFxyXG5cclxuICAgICAgICAgICAgICAgIHtkYXRhOiBcIm5hbWVcIn0sXHJcbiAgICAgICAgICAgICAgICB7ZGF0YTogXCJvdmVyYWxsLXJhbmtcIiwgY2xhc3NOYW1lOiBcImR0LWJvZHktY2VudGVyXCJ9LFxyXG4gICAgICAgICAgICAgICAge2RhdGE6IFwiZ3JvdXAtcmFua1wiLCBjbGFzc05hbWU6IFwiZHQtYm9keS1jZW50ZXJcIn0sXHJcbiAgICAgICAgICAgICAgICB7ZGF0YTogXCJnZW5kZXItcmFua1wiLCBjbGFzc05hbWU6IFwiZHQtYm9keS1jZW50ZXJcIn0sXHJcbiAgICAgICAgICAgICAgICB7ZGF0YTogXCJiaWJcIiwgY2xhc3NOYW1lOiBcImR0LWJvZHktY2VudGVyXCJ9LFxyXG4gICAgICAgICAgICAgICAge2RhdGE6IFwiZ2VuZGVyXCIsIGNsYXNzTmFtZTogXCJkdC1ib2R5LWNlbnRlclwifSxcclxuICAgICAgICAgICAgICAgIHtcclxuICAgICAgICAgICAgICAgICAgICBjbGFzc05hbWU6IFwiZHQtYm9keS1jZW50ZXJcIixcclxuICAgICAgICAgICAgICAgICAgICBkYXRhOiBudWxsLFxyXG4gICAgICAgICAgICAgICAgICAgIHJlbmRlcjogZnVuY3Rpb24gKGRhdGEsIHR5cGUsIHJvdykge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoIWRhdGEuY291bnRyeSlcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBcIlwiO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gJzxkaXYgY2xhc3M9XCJpbnZpc2libGVcIj4nICsgZGF0YS5jb3VudHJ5ICsgJzwvZGl2PjxmbGFnLWljb24ga2V5PVwiJyArIGRhdGEuY291bnRyeSArICdcIiB3aWR0aD1cIjQyXCI+PC9mbGFnLWljb24+JztcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgICAge1xyXG4gICAgICAgICAgICAgICAgICAgIC8vIGFnZSArIEdST1VQXHJcbiAgICAgICAgICAgICAgICAgICAgZGF0YTogbnVsbCxcclxuICAgICAgICAgICAgICAgICAgICByZW5kZXI6IGZ1bmN0aW9uIChkYXRhLCB0eXBlLCByb3cpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGRhdGEuYWdlO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgICAgICB7ZGF0YTogXCJvY2N1cGF0aW9uXCIsIGNsYXNzTmFtZTogXCJkdC1ib2R5LWNlbnRlclwifVxyXG4gICAgICAgICAgICBdLFxyXG4gICAgICAgICAgICB0YWJsZVRvb2xzOiB7XHJcbiAgICAgICAgICAgICAgICBzUm93U2VsZWN0OiBcIm9zXCIsXHJcbiAgICAgICAgICAgICAgICBhQnV0dG9uczogW11cclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0pO1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgICAkKFwiI3RhYmxlLXBhcnRpY2lwYW50c1wiKS5yZXNpemUoKTtcclxuICAgIH1cclxufVxyXG5cclxuZnVuY3Rpb24gaW5pdFRhYmxlRmF2b3JpdGVzKCkge1xyXG4gICAgaWYgKCF0YWJsZUZhdm9yaXRlcykge1xyXG4gICAgICAgIHZhciBhcnIgPSBQQVJUSUNJUEFOVFMuZmlsdGVyKGZ1bmN0aW9uICh2KSB7XHJcbiAgICAgICAgICAgIHJldHVybiB2LmlzRmF2b3JpdGU7XHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgdmFyIHJlcyA9IFtdO1xyXG4gICAgICAgIGZvciAodmFyIGkgaW4gYXJyKSB7XHJcbiAgICAgICAgICAgIHZhciBwYXJ0ID0gYXJyW2ldO1xyXG4gICAgICAgICAgICByZXMucHVzaCh7XHJcbiAgICAgICAgICAgICAgICBuYW1lOiBwYXJ0LmNvZGUsXHJcbiAgICAgICAgICAgICAgICBiaWI6IHBhcnQuc3RhcnRQb3MsXHJcbiAgICAgICAgICAgICAgICBnZW5kZXI6IHBhcnQuZ2VuZGVyLFxyXG4gICAgICAgICAgICAgICAgY291bnRyeTogcGFydC5jb3VudHJ5LFxyXG4gICAgICAgICAgICAgICAgYWdlR3JvdXA6IHBhcnQuYWdlR3JvdXAsXHJcbiAgICAgICAgICAgICAgICBhZ2U6IHBhcnQuYWdlXHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgIH1cclxuICAgICAgICB0YWJsZUZhdm9yaXRlcyA9ICQoJyN0YWJsZS1mYXZvcml0ZXMnKS5EYXRhVGFibGUoe1xyXG4gICAgICAgICAgICBcImRlc3Ryb3lcIjogdHJ1ZSxcclxuICAgICAgICAgICAgXCJpRGlzcGxheUxlbmd0aFwiOiA1MCxcclxuICAgICAgICAgICAgXCJiQXV0b1dpZHRoXCI6IGZhbHNlLFxyXG4gICAgICAgICAgICBcImFhU29ydGluZ1wiOiBbWzEsICdhc2MnXV0sXHJcbiAgICAgICAgICAgIGRhdGE6IHJlcyxcclxuICAgICAgICAgICAgY29sdW1uczogW1xyXG4gICAgICAgICAgICAgICAge2RhdGE6IFwibmFtZVwifSxcclxuICAgICAgICAgICAgICAgIHtkYXRhOiBcImJpYlwiLCBjbGFzc05hbWU6IFwiZHQtYm9keS1jZW50ZXJcIn0sXHJcbiAgICAgICAgICAgICAgICB7ZGF0YTogXCJnZW5kZXJcIiwgY2xhc3NOYW1lOiBcImR0LWJvZHktY2VudGVyXCJ9LFxyXG4gICAgICAgICAgICAgICAge1xyXG4gICAgICAgICAgICAgICAgICAgIGNsYXNzTmFtZTogXCJkdC1ib2R5LWNlbnRlclwiLFxyXG4gICAgICAgICAgICAgICAgICAgIGRhdGE6IG51bGwsXHJcbiAgICAgICAgICAgICAgICAgICAgcmVuZGVyOiBmdW5jdGlvbiAoZGF0YSwgdHlwZSwgcm93KSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmICghZGF0YS5jb3VudHJ5KVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIFwiXCI7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiAnPGRpdiBjbGFzcz1cImludmlzaWJsZVwiPicgKyBkYXRhLmNvdW50cnkgKyAnPC9kaXY+PGZsYWctaWNvbiBrZXk9XCInICsgZGF0YS5jb3VudHJ5ICsgJ1wiIHdpZHRoPVwiNDJcIj48L2ZsYWctaWNvbj4nO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgICAgICB7XHJcbiAgICAgICAgICAgICAgICAgICAgLy8gYWdlICsgR1JPVVBcclxuICAgICAgICAgICAgICAgICAgICBkYXRhOiBudWxsLFxyXG4gICAgICAgICAgICAgICAgICAgIHJlbmRlcjogZnVuY3Rpb24gKGRhdGEsIHR5cGUsIHJvdykge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gZGF0YS5hZ2U7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgICwgY2xhc3NOYW1lOiBcImR0LWJvZHktcmlnaHRcIlxyXG5cclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXSxcclxuICAgICAgICAgICAgdGFibGVUb29sczoge1xyXG4gICAgICAgICAgICAgICAgc1Jvd1NlbGVjdDogXCJvc1wiLFxyXG4gICAgICAgICAgICAgICAgYUJ1dHRvbnM6IFtdXHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9KTtcclxuICAgICAgICAkKCcjdGFibGUtZmF2b3JpdGVzJykub24oJ2NsaWNrJywgJ3RyJywgZnVuY3Rpb24gKGUpIHtcclxuICAgICAgICAgICAgaWYgKHRhYmxlRmF2b3JpdGVzLnJvdyh0aGlzKS5kYXRhKCkpIHtcclxuICAgICAgICAgICAgICAgIEdVSS5zZXRTZWxlY3RlZFBhcnRpY2lwYW50MSh0YWJsZUZhdm9yaXRlcy5yb3codGhpcykuZGF0YSgpLmNvZGUsIHRydWUpO1xyXG4gICAgICAgICAgICAgICAgR1VJLnNldFNlbGVjdGVkUGFydGljaXBhbnQyKG51bGwpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfSk7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICAgICQoXCIjdGFibGUtZmF2b3JpdGVzXCIpLnJlc2l6ZSgpO1xyXG4gICAgfVxyXG59XHJcblxyXG5mdW5jdGlvbiByZWZyZXNoVGFibGVzKCkge1xyXG4gICAgaWYgKHRhYmxlUGFydGljaXBhbnRzKSB7XHJcbiAgICAgICAgdmFyIGFyciA9IFBBUlRJQ0lQQU5UUztcclxuICAgICAgICB0YWJsZVBhcnRpY2lwYW50cy5jbGVhcigpO1xyXG4gICAgICAgIGFyci5mb3JFYWNoKGZ1bmN0aW9uIChwYXJ0KSB7XHJcbiAgICAgICAgICAgIHRhYmxlUGFydGljaXBhbnRzLnJvdy5hZGQoe1xyXG4gICAgICAgICAgICAgICAgaWQ6IHBhcnQuaWQsXHJcbiAgICAgICAgICAgICAgICBmb2xsb3c6IHBhcnQuaXNGYXZvcml0ZSxcclxuICAgICAgICAgICAgICAgIG5hbWU6IHBhcnQuY29kZSxcclxuICAgICAgICAgICAgICAgIGJpYjogcGFydC5zdGFydFBvcyxcclxuICAgICAgICAgICAgICAgIGdlbmRlcjogcGFydC5nZW5kZXIsXHJcbiAgICAgICAgICAgICAgICBjb3VudHJ5OiBwYXJ0LmNvdW50cnksXHJcbiAgICAgICAgICAgICAgICBhZ2VHcm91cDogcGFydC5hZ2VHcm91cCxcclxuICAgICAgICAgICAgICAgIGFnZTogcGFydC5hZ2UsXHJcbiAgICAgICAgICAgICAgICBcIm92ZXJhbGwtcmFua1wiOiBwYXJ0LmdldE92ZXJhbGxSYW5rKCksXHJcbiAgICAgICAgICAgICAgICBcImdlbmRlci1yYW5rXCI6IHBhcnQuZ2V0R2VuZGVyUmFuaygpLFxyXG4gICAgICAgICAgICAgICAgXCJncm91cC1yYW5rXCI6IHBhcnQuZ2V0R3JvdXBSYW5rKCksXHJcbiAgICAgICAgICAgICAgICBcIm9jY3VwYXRpb25cIjogXCJcIlxyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICB9KTtcclxuICAgICAgICB0YWJsZVBhcnRpY2lwYW50cy5kcmF3KCk7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKHRhYmxlRmF2b3JpdGVzKSB7XHJcbiAgICAgICAgdmFyIGFyciA9IFBBUlRJQ0lQQU5UUy5maWx0ZXIoZnVuY3Rpb24gKHYpIHtcclxuICAgICAgICAgICAgcmV0dXJuIHYuaXNGYXZvcml0ZTtcclxuICAgICAgICB9KTtcclxuICAgICAgICB0YWJsZUZhdm9yaXRlcy5jbGVhcigpO1xyXG4gICAgICAgIGFyci5mb3JFYWNoKGZ1bmN0aW9uIChwYXJ0KSB7XHJcbiAgICAgICAgICAgIHRhYmxlRmF2b3JpdGVzLnJvdy5hZGQoe1xyXG4gICAgICAgICAgICAgICAgbmFtZTogcGFydC5jb2RlLFxyXG4gICAgICAgICAgICAgICAgYmliOiBwYXJ0LnN0YXJ0UG9zLFxyXG4gICAgICAgICAgICAgICAgZ2VuZGVyOiBwYXJ0LmdlbmRlcixcclxuICAgICAgICAgICAgICAgIGNvdW50cnk6IHBhcnQuY291bnRyeSxcclxuICAgICAgICAgICAgICAgIGFnZUdyb3VwOiBwYXJ0LmFnZUdyb3VwLFxyXG4gICAgICAgICAgICAgICAgYWdlOiBwYXJ0LmFnZVxyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICB9KTtcclxuICAgICAgICB0YWJsZUZhdm9yaXRlcy5kcmF3KCk7XHJcbiAgICB9XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGNoYW5nZUZhdm9yaXRlKGlkKSB7XHJcbiAgICBmb3IgKHZhciBpIGluIFRSQUNLLnBhcnRpY2lwYW50cykge1xyXG4gICAgICAgIHZhciBwID0gVFJBQ0sucGFydGljaXBhbnRzW2ldO1xyXG4gICAgICAgIGlmIChwLmlkID09IGlkKSB7XHJcbiAgICAgICAgICAgIHAuaXNGYXZvcml0ZSA9ICFwLmlzRmF2b3JpdGU7XHJcbiAgICAgICAgICAgIGxvY2FsU3RvcmFnZS5zZXRJdGVtKFwiZmF2b3JpdGUtXCIgKyBwLmlkLCBwLmlzRmF2b3JpdGUgPyBcIjFcIiA6IFwiMFwiKTtcclxuICAgICAgICAgICAgcmVmcmVzaFRhYmxlcygpO1xyXG4gICAgICAgICAgICBicmVhaztcclxuICAgICAgICB9XHJcbiAgICB9XHJcbn1cclxuXHJcbi8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuLy8gdXNlIHRoaXMgaWYgeW91IHdhbnQgdG8gYnlwYXNzIGFsbCB0aGUgTm9kZUpTIGR5bmFtaWMgZXZlbnQgZ2V0XHJcbi8vIGl0IHdpbGwgc2ltdWxhdGUgYSBzdGF0aWMgZGF0YSByZXR1cm4gYnkgXCJkZW1vX3NpbXVsYXRpb25fZGF0YS5qc29uXCJcclxuLy93aW5kb3cuaXNERU1PX1NJTVVMQVRJT04gPSB0cnVlO1xyXG5cclxud2luZG93LlRSQUNLID0gbmV3IFRyYWNrKCk7XHJcbndpbmRvdy5HVUkgPSBuZXcgR3VpKHt0cmFjazogVFJBQ0ssIGlzU2tpcEV4dGVudCA6IHRydWUsIGluaXRpYWxab29tIDogMTR9KTtcclxud2luZG93LlBBUlRJQ0lQQU5UUyA9IFtdO1xyXG5cclxuLy8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG4kKGRvY3VtZW50KS5yZWFkeShmdW5jdGlvbiAoKSB7XHJcbiAgICBpZiAoVXRpbHMubW9iaWxlQW5kVGFibGV0Q2hlY2soKSlcclxuICAgICAgICAkKFwiYm9keVwiKS5hZGRDbGFzcyhcIm1vYmlsZVwiKTtcclxuXHJcbiAgICAvLyBFdmVudCBkYXRhIGxvYWRpbmcgLSByZWFsdGltZSBvciBoYXJkIHNpbXVsYXRlZFxyXG4gICAgLy8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG4gICAgdmFyIGV2ZW50RGF0YVVybDtcclxuICAgIGlmICh3aW5kb3cuaXNERU1PX1NJTVVMQVRJT04gPT09IHRydWUpIHtcclxuICAgICAgICAvLyBsb2FkIHRoZSBkZW1vIHNpbXVsYXRpb24gZ2VuZXJhdG9yXHJcbiAgICAgICAgdmFyIGRlbW9TaW11bGF0aW9uID0gcmVxdWlyZSgnLi9EZW1vU2ltdWxhdGlvbicpO1xyXG4gICAgICAgIC8vIHRoaXMgaXMgdGhlIGRhdGEgd2l0aCB0aGUgZGVtbyBwYXJ0aWNpcGFudHMvY2Ftc1xyXG4gICAgICAgIGV2ZW50RGF0YVVybCA9IFwiZGF0YS9kZW1vX3NpbXVsYXRpb25fZGF0YS5qc29uXCI7XHJcblxyXG4gICAgICAgIENPTkZJRy5tYXRoLmRpc3BsYXlEZWxheSA9IDEwOyAvLyBmaXggdGhpcyBhbmltYXRpb24gZGlzcGxheSBkZWxheSB0aW1lXHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICAgIHZhciBiYXNldXJsID0gKHdpbmRvdy5sb2NhdGlvbi5ob3N0LmluZGV4T2YoXCJsb2NhbGhvc3RcIikgPT0gMCB8fFxyXG4gICAgICAgIHdpbmRvdy5sb2NhdGlvbi5ob3N0LmluZGV4T2YoXCIxMjcuMC4wLjFcIikgPT0gMCkgPyBcImh0dHA6Ly9sb2NhbGhvc3Q6MzAwMC9cIiA6IFwibm9kZS9cIjtcclxuICAgICAgICBldmVudERhdGFVcmwgPSBiYXNldXJsICsgXCJldmVudFwiO1xyXG4gICAgfVxyXG5cclxuICAgICQuZ2V0SlNPTihldmVudERhdGFVcmwpLmRvbmUoZnVuY3Rpb24gKGRhdGEpIHtcclxuICAgICAgICBUUkFDSy5zZXRCaWtlU3RhcnRLTShkYXRhLmJpa2VTdGFydEtNKTtcclxuICAgICAgICBUUkFDSy5zZXRSdW5TdGFydEtNKGRhdGEucnVuU3RhcnRLTSk7XHJcbiAgICAgICAgVFJBQ0suc2V0Um91dGUoZGF0YS5yb3V0ZSk7XHJcbiAgICAgICAgQ09ORklHLnRpbWVzID0ge2JlZ2luOiBkYXRhLnRpbWVzLnN0YXJ0VGltZSAsIGVuZDogZGF0YS50aW1lcy5lbmRUaW1lIH07XHJcbiAgICAgICAgR1VJLmluaXQoKTtcclxuXHJcbiAgICAgICAgZnVuY3Rpb24gcHJvY2Vzc0VudHJ5KHBkYXRhLCBpc0NhbSkge1xyXG4gICAgICAgICAgICB2YXIgcGFydDtcclxuICAgICAgICAgICAgaWYgKGlzQ2FtKVxyXG4gICAgICAgICAgICAgICAgcGFydCA9IFRSQUNLLm5ld01vdmluZ0NhbShwZGF0YS5pZCwgcGRhdGEuZGV2aWNlSWQsIHBkYXRhLmNvZGUpO1xyXG4gICAgICAgICAgICBlbHNlXHJcbiAgICAgICAgICAgICAgICBwYXJ0ID0gVFJBQ0submV3UGFydGljaXBhbnQocGRhdGEuaWQsIHBkYXRhLmRldmljZUlkLCBwZGF0YS5jb2RlKTtcclxuICAgICAgICAgICAgcGFydC5zZXRDb2xvcihwZGF0YS5jb2xvcik7XHJcbiAgICAgICAgICAgIHBhcnQuc2V0QWdlR3JvdXAocGRhdGEuYWdlR3JvdXApO1xyXG4gICAgICAgICAgICBwYXJ0LnNldEFnZShwZGF0YS5hZ2UpO1xyXG4gICAgICAgICAgICBwYXJ0LnNldENvdW50cnkocGRhdGEuY291bnRyeSk7XHJcbiAgICAgICAgICAgIHBhcnQuc2V0U3RhcnRQb3MocGRhdGEuc3RhcnRQb3MpO1xyXG4gICAgICAgICAgICBwYXJ0LnNldEdlbmRlcihwZGF0YS5nZW5kZXIpO1xyXG4gICAgICAgICAgICBwYXJ0LnNldEljb24ocGRhdGEuaWNvbik7XHJcbiAgICAgICAgICAgIHBhcnQuc2V0SW1hZ2UocGRhdGEuaW1hZ2UpO1xyXG4gICAgICAgICAgICBpZiAoaXNDYW0gfHwgbG9jYWxTdG9yYWdlLmdldEl0ZW0oXCJmYXZvcml0ZS1cIiArIHBhcnQuaWQpID09IDEpXHJcbiAgICAgICAgICAgICAgICBwYXJ0LnNldElzRmF2b3JpdGUodHJ1ZSk7XHJcbiAgICAgICAgICAgIGlmICghaXNDYW0pXHJcbiAgICAgICAgICAgICAgICBQQVJUSUNJUEFOVFMucHVzaChwYXJ0KTtcclxuXHJcbiAgICAgICAgICAgIC8vIGlmIHRoaXMgaXMgYSBkZW1vIHNpbXVsYXRpb24gdGhlbiBzdGFydCBpdCBmb3IgZWFjaCBzaW5nbGUgZmF2b3VyaXRlLXBhcnRpY2lwYW50IG9yIGNhbVxyXG4gICAgICAgICAgICBpZiAod2luZG93LmlzREVNT19TSU1VTEFUSU9OID09PSB0cnVlKSB7XHJcbiAgICAgICAgICAgICAgICBpZiAocGFydC5nZXRJc0Zhdm9yaXRlKCkpIHtcclxuICAgICAgICAgICAgICAgICAgICBkZW1vU2ltdWxhdGlvbi5zaW11bGF0ZVBhcnRpY2lwYW50KHBhcnQpO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBmb3IgKHZhciBpIGluIGRhdGEucGFydGljaXBhbnRzKVxyXG4gICAgICAgICAgICBwcm9jZXNzRW50cnkoZGF0YS5wYXJ0aWNpcGFudHNbaV0sIGZhbHNlKTtcclxuICAgICAgICBmb3IgKHZhciBpIGluIGRhdGEuY2FtcylcclxuICAgICAgICAgICAgcHJvY2Vzc0VudHJ5KGRhdGEuY2Ftc1tpXSwgdHJ1ZSk7XHJcblxyXG4gICAgICAgIC8vIGlmIHRoaXMgaXMgbm90IGEgZGVtbyBzaW11bGF0aW9uIHN0YXJ0IGxpc3RlbmluZyBmb3IgdGhlIHJlYWx0aW1lIHBpbmdzXHJcbiAgICAgICAgaWYgKHdpbmRvdy5pc0RFTU9fU0lNVUxBVElPTiAhPT0gdHJ1ZSkge1xyXG4gICAgICAgICAgICBpZiAoQ09ORklHLnNldHRpbmdzLm5vTWlkZGxlV2FyZSkge1xyXG4gICAgICAgICAgICAgICAgZnVuY3Rpb24gZG9IVFRQKHVybCwganNvbiwgb25SZXFEb25lKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKGpzb24ubGVuZ3RoKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICQuYWpheCh7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0eXBlOiBcIlBPU1RcIixcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHVybDogdXJsLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZGF0YTogSlNPTi5zdHJpbmdpZnkoanNvbiksXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb250ZW50VHlwZTogXCJhcHBsaWNhdGlvbi9qc29uOyBjaGFyc2V0PXV0Zi04XCIsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBkYXRhVHlwZTogXCJqc29uXCIsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBzdWNjZXNzOiBmdW5jdGlvbiAoZGF0YSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG9uUmVxRG9uZShkYXRhKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBmYWlsdXJlOiBmdW5jdGlvbiAoZXJyTXNnKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcihcIkVSUk9SIGdldCBkYXRhIGZyb20gYmFja2VuZCBcIiArIGVyck1zZylcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgICAgIHZhciBzdHJlYW0gPSBuZXcgU3RyZWFtRGF0YSgpO1xyXG4gICAgICAgICAgICAgICAgc3RyZWFtLnN0YXJ0KFRSQUNLLCBmdW5jdGlvbiAoKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRydWU7XHJcbiAgICAgICAgICAgICAgICB9LCAxMCwgZG9IVFRQKTsgLy8gMTAgc2VjIHBpbmcgaW50LlxyXG4gICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgLy8gTk9STUFMIENBU0VcclxuICAgICAgICAgICAgICAgIHZhciBzdHJlYW0gPSBuZXcgQmFja2VuZFN0cmVhbSgpO1xyXG4gICAgICAgICAgICAgICAgc3RyZWFtLnN0YXJ0KFRSQUNLKTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIC8vIGFkZCBhbGwgdGhlIHN0YXRpYyBIb3RTcG90c1xyXG4gICAgICAgIHZhciBkeW5hbWljVHJhY2tIb3RzcG90cyA9IFtdO1xyXG4gICAgICAgIGZvciAodmFyIGsgPSAwOyBrIDwgSE9UU1BPVFMubGVuZ3RoOyBrKyspIHtcclxuICAgICAgICAgICAgdmFyIGhvdHNwb3REYXRhID0gSE9UU1BPVFNba107XHJcbiAgICAgICAgICAgIHZhciBob3RzcG90ID0gbmV3IEhvdFNwb3QoSE9UU1BPVFNba10pO1xyXG4gICAgICAgICAgICBpZiAoaG90c3BvdERhdGEucG9pbnQpIHtcclxuICAgICAgICAgICAgICAgIC8vIHRoaXMgaXMgYSBzdGF0aWMgaG90c3BvdCAtIGp1c3QgYSBmaXhlZCBwb2ludFxyXG4gICAgICAgICAgICAgICAgaG90c3BvdC5pbml0KEhPVFNQT1RTW2tdLnBvaW50KTtcclxuICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgIC8vIHRoaXMgaXMgYSBkeW5hbWljIEhvdFNwb3QgLSBkZXBlbmRpbmcgb24gdGhlIFRyYWNrXHJcbiAgICAgICAgICAgICAgICBkeW5hbWljVHJhY2tIb3RzcG90cy5wdXNoKGhvdHNwb3QpXHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgICAgVFJBQ0submV3SG90U3BvdHMoZHluYW1pY1RyYWNrSG90c3BvdHMpO1xyXG4gICAgfSkuZmFpbChmdW5jdGlvbiAoKSB7XHJcbiAgICAgICAgY29uc29sZS5lcnJvcihcIkVycm9yIGdldCBldmVudCBjb25maWd1cmF0aW9uIGZyb20gYmFja2VuZCFcIik7XHJcbiAgICB9KTtcclxuXHJcbiAgICAvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblxyXG4gICAgJChcIiNidXR0b25fc3dpbSwgI2J1dHRvbl9iaWtlLCAjYnV0dG9uX3J1blwiKS5cclxuICAgICAgICBjc3MoXCJiYWNrZ3JvdW5kLWNvbG9yXCIsIGZ1bmN0aW9uKCkge1xyXG4gICAgICAgICAgICByZXR1cm4gQ09ORklHLmFwcGVhcmFuY2VbXCJ0cmFja0NvbG9yXCIgKyAkKHRoaXMpLmRhdGEoXCJ0cmFja1wiKV07XHJcbiAgICAgICAgfSkuXHJcbiAgICAgICAgY2xpY2soZnVuY3Rpb24gKCkge1xyXG4gICAgICAgICAgICB2YXIgdHJhY2sgPSAkKHRoaXMpLmRhdGEoXCJ0cmFja1wiKTtcclxuICAgICAgICAgICAgJCh0aGlzKS50b2dnbGVDbGFzcyhcImluYWN0aXZlXCIpO1xyXG4gICAgICAgICAgICBHVUlbXCJpc1Nob3dcIiArIHRyYWNrXSA9ICEkKHRoaXMpLmhhc0NsYXNzKFwiaW5hY3RpdmVcIik7XHJcbiAgICAgICAgICAgIEdVSS5yZWRyYXcoKTtcclxuICAgICAgICB9KTtcclxuXHJcbiAgICAkKFwiI2J1dHRvbl9yYW5rLCAjYnV0dG9uX3BhcnRpY2lwYW50cywgI2J1dHRvbl9mYXZvcml0ZXNcIikuY2xpY2soZnVuY3Rpb24gKCkge1xyXG4gICAgICAgIHZhciBvcGVuVGFiSWQgPSAkKHRoaXMpLmRhdGEoXCJvcGVuXCIpO1xyXG4gICAgICAgIGlmIChpc1RhYlZpc2libGUob3BlblRhYklkKSlcclxuICAgICAgICAgICAgc2hvd01hcCgpO1xyXG4gICAgICAgIGVsc2VcclxuICAgICAgICAgICAgc2hvd1RhYihvcGVuVGFiSWQpO1xyXG4gICAgfSk7XHJcblxyXG4gICAgJChcIiN0YWJjb250XCIpLmZpbmQoXCIuY2xvc2VcIikuY2xpY2soZnVuY3Rpb24gKCkge1xyXG4gICAgICAgIHNob3dNYXAoKTtcclxuICAgIH0pO1xyXG5cclxuICAgICQoXCIjbGlua19wYXJ0bmVycywgI2xpbmtfbGVnYWxOb3RpY2UsICNidXR0b25fbGl2ZVN0cmVhbVwiKS5jbGljayhmdW5jdGlvbiAoKSB7XHJcbiAgICAgICAgdmFyICR0b0Nsb3NlID0gJChcIi5fY29udFZpc2libGVcIik7XHJcbiAgICAgICAgdmFyICR0b09wZW4gPSAkKFwiI1wiICsgJCh0aGlzKS5kYXRhKFwib3BlblwiKSk7XHJcbiAgICAgICAgdmFyIGlzTGl2ZVN0cmVhbUNsb3NlID0gJHRvQ2xvc2UuaXMoXCIjbGl2ZVN0cmVhbVwiKTtcclxuICAgICAgICB2YXIgaXNMaXZlU3RyZWFtT3BlbiA9ICR0b09wZW4uaXMoXCIjbGl2ZVN0cmVhbVwiKTtcclxuXHJcbiAgICAgICAgZnVuY3Rpb24gb3BlbigpIHtcclxuICAgICAgICAgICAgJHRvQ2xvc2UucmVtb3ZlQ2xhc3MoXCJfY29udFZpc2libGVcIik7XHJcblxyXG4gICAgICAgICAgICBpZiAoJHRvQ2xvc2UuaXMoJHRvT3BlbikpXHJcbiAgICAgICAgICAgICAgICByZXR1cm47XHJcblxyXG4gICAgICAgICAgICBpZiAoaXNMaXZlU3RyZWFtT3Blbikge1xyXG4gICAgICAgICAgICAgICAgdmFyIGlzU2hvd24gPSBHVUkudG9nZ2xlTGl2ZVN0cmVhbSgpO1xyXG4gICAgICAgICAgICAgICAgJHRvT3Blbi50b2dnbGVDbGFzcyhcIl9jb250VmlzaWJsZVwiLCBpc1Nob3duKTtcclxuICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgICR0b09wZW4uYWRkQ2xhc3MoXCJfY29udFZpc2libGVcIik7XHJcbiAgICAgICAgICAgICAgICAkdG9PcGVuLnNsaWRlRG93bigpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBpZiAoJHRvQ2xvc2UubGVuZ3RoKSB7XHJcbiAgICAgICAgICAgIGlmIChpc0xpdmVTdHJlYW1DbG9zZSkge1xyXG4gICAgICAgICAgICAgICAgR1VJLnRvZ2dsZUxpdmVTdHJlYW0ob3Blbik7XHJcbiAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAkdG9DbG9zZS5zbGlkZVVwKDQwMCwgb3Blbik7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICBvcGVuKCk7XHJcbiAgICAgICAgfVxyXG4gICAgfSk7XHJcblxyXG4gICAgJChcIiN0YWJsZS1wYXJ0aWNpcGFudHNcIikub24oXCJjbGlja1wiLCBcIi50YWJsZS1mYXZvcml0ZS1hZGRcIiwgZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgdmFyIGlkID0gJCh0aGlzKS5kYXRhKCdpZCcpO1xyXG4gICAgICAgIGNoYW5nZUZhdm9yaXRlKGlkKTtcclxuICAgIH0pO1xyXG59KTtcclxuXHJcbiIsInJlcXVpcmUoJ2pvb3NlJyk7XHJcbnJlcXVpcmUoJy4vVXRpbHMnKTtcclxuXHJcbkNsYXNzKFwiTGl2ZVN0cmVhbVwiLCB7XHJcbiAgICBoYXMgOiB7XHJcbiAgICAgICAgXyRjb21wIDoge1xyXG4gICAgICAgICAgICBpbml0OiBmdW5jdGlvbihjb25maWcpIHtcclxuICAgICAgICAgICAgICAgIHJldHVybiAkKCcjJyArIGNvbmZpZy5pZCk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9LFxyXG5cclxuICAgICAgICBfaXNTaG93biA6IHtcclxuICAgICAgICAgICBpbml0IDogZmFsc2VcclxuICAgICAgICB9LFxyXG5cclxuICAgICAgICBfaXNWYWxpZCA6IHtcclxuICAgICAgICAgICAgaW5pdCA6IGZhbHNlXHJcbiAgICAgICAgfVxyXG4gICAgfSxcclxuICAgIG1ldGhvZHM6IHtcclxuICAgICAgICBpbml0aWFsaXplOiBmdW5jdGlvbigpIHtcclxuICAgICAgICAgICAgdmFyIGxpdmVTdHJlYW1zID0gd2luZG93LkxJVkVfU1RSRUFNUztcclxuICAgICAgICAgICAgaWYgKCFsaXZlU3RyZWFtcyB8fCBsaXZlU3RyZWFtcy5sZW5ndGggPD0gMCkge1xyXG4gICAgICAgICAgICAgICAgY29uc29sZS53YXJuKFwiTm8gbGl2ZSBzdHJlYW1zIHNldFwiKTtcclxuICAgICAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgLy8gaW5pdGlhbGl6ZSB0aGUgc3RyZWFtc1xyXG4gICAgICAgICAgICB2YXIgc2VsZiA9IHRoaXM7XHJcbiAgICAgICAgICAgIHZhciBpID0gMDtcclxuICAgICAgICAgICAgdGhpcy5fJGNvbXAuZmluZChcIi5saXZlU3RyZWFtVGh1bWJcIikuYWRkQ2xhc3MoXCJpbmFjdGl2ZVwiKS5lYWNoKGZ1bmN0aW9uKCkge1xyXG4gICAgICAgICAgICAgICAgdmFyIHN0cmVhbSA9IGxpdmVTdHJlYW1zW2ldO1xyXG4gICAgICAgICAgICAgICAgaSsrO1xyXG4gICAgICAgICAgICAgICAgaWYgKCFzdHJlYW0pIHtcclxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gZmFsc2U7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAkKHRoaXMpLmFkZENsYXNzKFwidmFsaWRcIikuZGF0YShcImlkXCIsIHN0cmVhbS5pZCkuZGF0YShcInVybFwiLCBzdHJlYW0udXJsKTtcclxuXHJcbiAgICAgICAgICAgICAgICAvLyBhdCBsZWFzdCBvbmUgdmFsaWQgdGh1bWIgLSBzbyB0aGUgd2hvbGUgTGl2ZVN0cmVhbSBpcyB2YWxpZFxyXG4gICAgICAgICAgICAgICAgc2VsZi5faXNWYWxpZCA9IHRydWU7XHJcbiAgICAgICAgICAgIH0pLmZpbHRlcihcIi52YWxpZFwiKS5jbGljayhmdW5jdGlvbigpIHtcclxuICAgICAgICAgICAgICAgIHZhciAkdGhpcyA9ICQodGhpcyk7XHJcblxyXG4gICAgICAgICAgICAgICAgLy8gaWYgY2xpY2tlZCBvbiB0aGUgc2FtZSBhY3RpdmUgdGh1bWIgdGhlbiBza2lwIGl0XHJcbiAgICAgICAgICAgICAgICBpZiAoISR0aGlzLmhhc0NsYXNzKFwiaW5hY3RpdmVcIikpIHtcclxuICAgICAgICAgICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICAgICBzZWxmLl9zaG93U3RyZWFtKCR0aGlzKTtcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgfSxcclxuXHJcbiAgICAgICAgc2hvdzogZnVuY3Rpb24oc3RyZWFtSWQsIGNvbXBsZXRlQ2FsbGJhY2spIHtcclxuICAgICAgICAgICAgaWYgKCF0aGlzLl9pc1ZhbGlkKVxyXG4gICAgICAgICAgICAgICByZXR1cm47XHJcblxyXG4gICAgICAgICAgICB2YXIgJHRodW1iID0gbnVsbDtcclxuICAgICAgICAgICAgdmFyICR0aHVtYnMgPSB0aGlzLl8kY29tcC5maW5kKFwiLmxpdmVTdHJlYW1UaHVtYi52YWxpZFwiKTtcclxuICAgICAgICAgICAgaWYgKCFpc0RlZmluZWQoc3RyZWFtSWQpKSB7XHJcbiAgICAgICAgICAgICAgICAkdGh1bWIgPSAkdGh1bWJzLmVxKDApO1xyXG4gICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgJHRodW1icy5lYWNoKGZ1bmN0aW9uKCkge1xyXG4gICAgICAgICAgICAgICAgICAgIGlmIChzdHJlYW1JZCA9PT0gJCh0aGlzKS5kYXRhKFwiaWRcIikpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgJHRodW1iID0gJCh0aGlzKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICBpZiAoISR0aHVtYikge1xyXG4gICAgICAgICAgICAgICAgY29uc29sZS53YXJuKFwiTm8gc3RyZWFtIGZvciBpZCA6IFwiICsgc3RyZWFtSWQpO1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICB0aGlzLl9zaG93U3RyZWFtKCR0aHVtYiwgY29tcGxldGVDYWxsYmFjayk7XHJcbiAgICAgICAgfSxcclxuXHJcbiAgICAgICAgLyoqXHJcbiAgICAgICAgICpcclxuICAgICAgICAgKiBAcmV0dXJuIHtib29sZWFufVxyXG4gICAgICAgICAqL1xyXG4gICAgICAgIHRvZ2dsZSA6IGZ1bmN0aW9uKGNvbXBsZXRlQ2FsbGJhY2spIHtcclxuICAgICAgICAgICAgaWYgKCF0aGlzLl9pc1ZhbGlkKVxyXG4gICAgICAgICAgICAgICAgcmV0dXJuO1xyXG5cclxuICAgICAgICAgICAgLy8gaWYgc2hvd24gaGlkZSBvdGhlcndpc2Ugc2hvd1xyXG4gICAgICAgICAgICBpZiAodGhpcy5faXNTaG93bilcclxuICAgICAgICAgICAgICAgIHRoaXMuX2hpZGUoY29tcGxldGVDYWxsYmFjayk7XHJcbiAgICAgICAgICAgIGVsc2VcclxuICAgICAgICAgICAgICAgIHRoaXMuc2hvdyhjb21wbGV0ZUNhbGxiYWNrKTtcclxuXHJcbiAgICAgICAgICAgIHJldHVybiB0aGlzLl9pc1Nob3duO1xyXG4gICAgICAgIH0sXHJcblxyXG4gICAgICAgIC8qIFByaXZhdGUgTWV0aG9kcyAqL1xyXG5cclxuICAgICAgICBfaGlkZSA6IGZ1bmN0aW9uKGNvbXBsZXRlQ2FsbGJhY2spIHtcclxuICAgICAgICAgICAgdmFyIHNlbGYgPSB0aGlzO1xyXG4gICAgICAgICAgICB0aGlzLl8kY29tcC5zbGlkZVVwKDQwMCwgZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgICAgICAgICAvLyBzdG9wIHRoZSBzdHJlYW0gd2hlbiB3aG9sZSBwYW5lbCBoYXMgY29tcGxldGVkIGFuaW1hdGlvblxyXG4gICAgICAgICAgICAgICAgc2VsZi5fJGNvbXAuZmluZChcIi5saXZlU3RyZWFtUGxheWVyXCIpLmVtcHR5KCk7XHJcbiAgICAgICAgICAgICAgICBjb21wbGV0ZUNhbGxiYWNrKCk7XHJcbiAgICAgICAgICAgIH0pO1xyXG5cclxuICAgICAgICAgICAgdGhpcy5faXNTaG93biA9IGZhbHNlO1xyXG4gICAgICAgIH0sXHJcblxyXG4gICAgICAgIF9zaG93U3RyZWFtIDogZnVuY3Rpb24oJHRodW1iLCBjb21wbGV0ZUNhbGxiYWNrKSB7XHJcbiAgICAgICAgICAgIC8vIHRvZ2dsZSB0aGUgXCJpbmFjdGl2ZVwiIGNsYXNzXHJcbiAgICAgICAgICAgIHRoaXMuXyRjb21wLmZpbmQoXCIubGl2ZVN0cmVhbVRodW1iXCIpLmFkZENsYXNzKFwiaW5hY3RpdmVcIik7XHJcbiAgICAgICAgICAgICR0aHVtYi5yZW1vdmVDbGFzcyhcImluYWN0aXZlXCIpO1xyXG5cclxuICAgICAgICAgICAgLy8gc2hvdyB0aGUgbmV3IHN0cmVhbVxyXG4gICAgICAgICAgICB2YXIgdXJsID0gJHRodW1iLmRhdGEoXCJ1cmxcIik7XHJcbiAgICAgICAgICAgIHZhciAkcGxheWVyID0gdGhpcy5fJGNvbXAuZmluZChcIi5saXZlU3RyZWFtUGxheWVyXCIpO1xyXG4gICAgICAgICAgICAkcGxheWVyLmh0bWwoJzxpZnJhbWUgc3JjPScgKyB1cmwgKyAnP3dpZHRoPTQ5MCZoZWlnaHQ9Mjc1JmF1dG9QbGF5PXRydWUmbXV0ZT1mYWxzZVwiIHdpZHRoPVwiNDkwXCIgaGVpZ2h0PVwiMjc1XCIgZnJhbWVib3JkZXI9XCIwXCIgc2Nyb2xsaW5nPVwibm9cIiAnK1xyXG4gICAgICAgICAgICAnYWxsb3dmdWxsc2NyZWVuIHdlYmtpdGFsbG93ZnVsbHNjcmVlbiBtb3phbGxvd2Z1bGxzY3JlZW4gb2FsbG93ZnVsbHNjcmVlbiBtc2FsbG93ZnVsbHNjcmVlbj48L2lmcmFtZT4nKTtcclxuXHJcbiAgICAgICAgICAgIC8vIHNob3cgaWYgbm90IGFscmVhZHkgc2hvd25cclxuICAgICAgICAgICAgaWYgKCF0aGlzLl9pc1Nob3duKVxyXG4gICAgICAgICAgICAgICAgdGhpcy5fJGNvbXAuc2xpZGVEb3duKDQwMCwgY29tcGxldGVDYWxsYmFjayk7XHJcbiAgICAgICAgICAgIHRoaXMuX2lzU2hvd24gPSB0cnVlO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxufSk7IiwicmVxdWlyZSgnam9vc2UnKTtcclxucmVxdWlyZSgnLi9QYXJ0aWNpcGFudCcpO1xyXG5cclxuQ2xhc3MoXCJNb3ZpbmdDYW1cIiwge1xyXG4gICAgaXNhIDogUGFydGljaXBhbnQsXHJcblxyXG4gICAgb3ZlcnJpZGUgOiB7XHJcbiAgICAgICAgaW5pdEZlYXR1cmUgOiBmdW5jdGlvbigpIHtcclxuICAgICAgICAgICAgdGhpcy5mZWF0dXJlLmNhbT10aGlzO1xyXG4gICAgICAgICAgICBHVUkuY2Ftc0xheWVyLmdldFNvdXJjZSgpLmFkZEZlYXR1cmUodGhpcy5mZWF0dXJlKTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbn0pOyIsInJlcXVpcmUoJ2pvb3NlJyk7XHJcbnJlcXVpcmUoJy4vUG9pbnQnKTtcclxuXHJcbnZhciBDT05GSUcgPSByZXF1aXJlKCcuL0NvbmZpZycpO1xyXG52YXIgVXRpbHMgPSByZXF1aXJlKCcuL1V0aWxzJyk7XHJcblxyXG52YXIgY29lZnkgPSAwLjc1O1xyXG5cclxuQ2xhc3MoXCJQYXJ0aWNpcGFudFN0YXRlXCIsXHJcbntcclxuXHRoYXMgOiB7XHRcdFxyXG5cdFx0c3BlZWQgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogMFxyXG5cdFx0fSxcclxuXHRcdGVsYXBzZWQgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogMFxyXG5cdFx0fSxcclxuXHQgICAgdGltZXN0YW1wIDogXHJcblx0XHR7XHJcblx0ICAgICAgICBpczogICBcInJ3XCIsXHJcblx0ICAgICAgICBpbml0OiAwXHQvL2xvbiBsYXQgd29ybGQgbWVyY2F0b3JcclxuXHQgICAgfSxcclxuXHQgICAgZ3BzIDoge1xyXG5cdCAgICBcdGlzOiAgIFwicndcIixcclxuXHQgICAgICAgIGluaXQ6IFswLDBdXHQvL2xvbiBsYXQgd29ybGQgbWVyY2F0b3JcclxuXHQgICAgfSxcclxuXHRcdGZyZXEgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogMFxyXG5cdFx0fSxcclxuXHRcdGlzU09TIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IGZhbHNlXHJcblx0XHR9LFxyXG5cdFx0YWNjZWxlcmF0aW9uIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IDBcclxuXHRcdH0sXHJcblx0XHRhbHQgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogMFxyXG5cdFx0fSxcclxuXHRcdG92ZXJhbGxSYW5rIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IDBcclxuXHRcdH0sXHJcblx0XHRnZW5kZXJSYW5rIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IDBcclxuXHRcdH0sXHJcblx0XHRncm91cFJhbmsgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogMFxyXG5cdFx0fVxyXG5cdH1cclxufSk7XHRcdFxyXG4vLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuQ2xhc3MoXCJNb3ZpbmdQb2ludFwiLCB7XHJcblx0aXNhIDogUG9pbnQsXHJcblxyXG5cdGhhcyA6IHtcclxuXHRcdGRldmljZUlkIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IFwiREVWSUNFX0lEX05PVF9TRVRcIlxyXG5cdFx0fVxyXG5cdH1cclxufSk7XHJcbi8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5DbGFzcyhcIlBhcnRpY2lwYW50XCIsXHJcbntcclxuXHRpc2EgOiBNb3ZpbmdQb2ludCxcclxuXHJcbiAgICBoYXM6IFxyXG5cdHtcclxuICAgIFx0bGFzdFBpbmdUaW1lc3RhbXAgOiB7XHJcbiAgICBcdFx0aXMgOiBcInJ3XCIsXHJcbiAgICBcdFx0aW5pdCA6IG51bGxcclxuICAgIFx0fSxcclxuICAgIFx0c2lnbmFsTG9zdERlbGF5IDoge1xyXG4gICAgXHRcdGlzIDogXCJyd1wiLFxyXG4gICAgXHRcdGluaXQgOiBudWxsXHJcbiAgICBcdH0sXHJcbiAgICBcdGxhc3RSZWFsRGVsYXkgOiB7XHJcbiAgICBcdFx0aXMgOiBcInJ3XCIsXHJcbiAgICBcdFx0aW5pdCA6IDBcclxuICAgIFx0fSxcclxuICAgIFx0dHJhY2sgOiB7XHJcbiAgICBcdFx0aXMgOiBcInJ3XCJcclxuICAgIFx0fSxcclxuICAgIFx0c3RhdGVzIDoge1xyXG4gICAgXHRcdGlzIDogXCJyd1wiLFxyXG4gICAgXHRcdGluaXQgOiBudWxsIC8vW11cclxuICAgIFx0XHRcclxuICAgIFx0fSxcclxuXHRcdGlzVGltZWRPdXQgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogZmFsc2VcclxuXHRcdH0sXHJcblx0XHRpc0Rpc2NhcmRlZCA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiBmYWxzZVxyXG5cdFx0fSxcclxuXHRcdGlzU09TIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IGZhbHNlXHJcblx0XHR9LFxyXG5cdFx0aWNvbjoge1xyXG5cdFx0XHRpczogXCJyd1wiLFxyXG5cdCAgICAgICAgaW5pdDogXCJpbWcvcGxheWVyMS5wbmdcIlxyXG5cdCAgICB9LFxyXG5cdCAgICBpbWFnZSA6XHR7XHJcblx0ICAgICAgICBpczogICBcInJ3XCIsXHJcblx0ICAgICAgICBpbml0OiBcImltZy9wcm9maWxlMS5wbmdcIiAgLy8xMDB4MTAwXHJcblx0ICAgIH0sXHJcblx0ICAgIGNvbG9yIDoge1xyXG5cdCAgICAgICAgaXM6ICAgXCJyd1wiLFxyXG5cdCAgICAgICAgaW5pdDogXCIjZmZmXCJcclxuXHQgICAgfSxcclxuXHQgICAgbGFzdEludGVycG9sYXRlVGltZXN0YW1wIDoge1xyXG5cdCAgICBcdGlzIDogXCJyd1wiLFxyXG5cdCAgICBcdGluaXQgOiBudWxsXHJcblx0ICAgIH0sXHJcblx0ICAgIGFnZUdyb3VwIDoge1xyXG5cdCAgICBcdGlzIDogXCJyd1wiLFxyXG5cdCAgICBcdGluaXQgOiBcIi1cIlxyXG5cdCAgICB9LFxyXG5cdCAgICBhZ2UgOiB7XHJcblx0ICAgIFx0aXMgOiBcInJ3XCIsXHJcblx0ICAgIFx0aW5pdCA6IFwiLVwiXHJcblx0ICAgIH0sXHJcblx0ICAgIHJvdGF0aW9uIDoge1xyXG5cdCAgICBcdGlzIDogXCJyd1wiLFxyXG5cdCAgICBcdGluaXQgOiBudWxsIFxyXG5cdCAgICB9LCBcclxuXHQgICAgZWxhcHNlZCA6IHtcclxuXHQgICAgXHRpcyA6IFwicndcIixcclxuXHQgICAgXHRpbml0IDogMFxyXG5cdCAgICB9LFxyXG5cdFx0c2VxSWQgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogMFxyXG5cdFx0fSxcclxuXHRcdGNvdW50cnkgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogXCJHZXJtYW55XCJcclxuXHRcdH0sXHJcblx0XHRzdGFydFBvcyA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiAwXHJcblx0XHR9LFxyXG5cdFx0c3RhcnRUaW1lIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IDBcclxuXHRcdH0sXHJcblx0XHRnZW5kZXIgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogXCJNXCJcclxuXHRcdH0sXHJcblx0XHRpc0Zhdm9yaXRlIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IHRydWUgLyogdG9kbyBzZXQgZmFsc2UgKi9cclxuXHRcdH1cclxuICAgIH0sXHJcblx0YWZ0ZXIgOiB7XHJcblx0XHRpbml0IDogZnVuY3Rpb24ocG9zLCB0cmFjaykge1xyXG5cdFx0XHR0aGlzLnNldFRyYWNrKHRyYWNrKTtcclxuXHRcdFx0dmFyIGN0aW1lID0gKG5ldyBEYXRlKCkpLmdldFRpbWUoKTtcclxuXHRcdFx0dmFyIHN0YXRlID0gbmV3IFBhcnRpY2lwYW50U3RhdGUoe3RpbWVzdGFtcDoxLyogcGxhY2Vob2xkZXIgY3RpbWUgbm90IDAgKi8sZ3BzOnBvcyxpc1NPUzpmYWxzZSxmcmVxOjAsc3BlZWQ6MCxlbGFwc2VkOnRyYWNrLmdldEVsYXBzZWRGcm9tUG9pbnQocG9zKX0pO1xyXG5cdFx0XHR0aGlzLnNldEVsYXBzZWQoc3RhdGUuZWxhcHNlZCk7XHJcblx0XHRcdHRoaXMuc2V0U3RhdGVzKFtzdGF0ZV0pO1xyXG5cdFx0XHR0aGlzLnNldElzU09TKGZhbHNlKTtcclxuXHRcdFx0dGhpcy5zZXRJc0Rpc2NhcmRlZChmYWxzZSk7XHJcblxyXG5cdFx0XHRpZiAodGhpcy5mZWF0dXJlKSB7XHJcblx0XHRcdFx0dGhpcy5pbml0RmVhdHVyZSgpO1xyXG5cdFx0XHR9XHJcblx0XHRcdHRoaXMucGluZyhwb3MsMCxmYWxzZSwxIC8qIHBsYWNlaG9sZGVyIGN0aW1lIG5vdCAwICovLDAsMCwwLDAsMCk7XHJcblx0XHR9XHJcblx0fSxcclxuICAgIC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRtZXRob2RzOiBcclxuXHR7XHJcblx0XHRpbml0RmVhdHVyZSA6IGZ1bmN0aW9uKCkge1xyXG5cdFx0XHR0aGlzLmZlYXR1cmUucGFydGljaXBhbnQ9dGhpcztcclxuXHRcdFx0R1VJLnBhcnRpY2lwYW50c0xheWVyLmdldFNvdXJjZSgpLmFkZEZlYXR1cmUodGhpcy5mZWF0dXJlKTtcclxuXHRcdH0sXHJcblxyXG5cdFx0Z2V0SW5pdGlhbHMgOiBmdW5jdGlvbigpIHtcclxuXHRcdFx0dmFyIHR0ID0gdGhpcy5nZXRDb2RlKCkuc3BsaXQoXCIgXCIpO1xyXG5cdFx0XHRpZiAodHQubGVuZ3RoID49IDIpIHtcclxuXHRcdFx0XHRyZXR1cm4gdHRbMF1bMF0rdHRbMV1bMF07XHJcblx0XHRcdH1cclxuXHRcdFx0aWYgKHR0Lmxlbmd0aCA9PSAxKVxyXG5cdFx0XHRcdHJldHVybiB0dFswXVswXTtcclxuXHRcdFx0cmV0dXJuIFwiP1wiO1xyXG5cdFx0fSxcclxuXHRcdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdFx0Ly8gbWFpbiBmdW5jdGlvbiBjYWxsID4gXHJcblx0XHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRcdHVwZGF0ZUZlYXR1cmUgOiBmdW5jdGlvbigpIHtcclxuXHRcdFx0dmFyIG1wb3MgPSBvbC5wcm9qLnRyYW5zZm9ybSh0aGlzLmdldFBvc2l0aW9uKCksICdFUFNHOjQzMjYnLCAnRVBTRzozODU3Jyk7XHJcblx0XHRcdGlmICh0aGlzLmZlYXR1cmUpIFxyXG5cdFx0XHRcdHRoaXMuZmVhdHVyZS5zZXRHZW9tZXRyeShuZXcgb2wuZ2VvbS5Qb2ludChtcG9zKSk7XHJcblx0XHR9LFxyXG5cdFx0aW50ZXJwb2xhdGUgOiBmdW5jdGlvbigpIFxyXG5cdFx0e1xyXG5cdFx0XHRcclxuXHRcdFx0aWYgKCF0aGlzLnN0YXRlcy5sZW5ndGgpXHJcblx0XHRcdFx0cmV0dXJuO1xyXG5cdFx0XHR2YXIgY3RpbWU9KG5ldyBEYXRlKCkpLmdldFRpbWUoKTtcclxuXHRcdFx0dmFyIGlzVGltZSA9IChjdGltZSA+PSBDT05GSUcudGltZXMuYmVnaW4gJiYgY3RpbWUgPD0gQ09ORklHLnRpbWVzLmVuZCk7XHJcblx0XHRcdGlmICh0aGlzLmlzRGlzY2FyZGVkIHx8IHRoaXMuaXNTT1MvKiB8fCAhdGhpcy5pc09uUm9hZCovIHx8ICFpc1RpbWUgfHwgQ09ORklHLnNldHRpbmdzLm5vSW50ZXJwb2xhdGlvbikgXHJcblx0XHRcdHtcclxuXHRcdFx0XHR2YXIgbHN0YXRlPXRoaXMuc3RhdGVzW3RoaXMuc3RhdGVzLmxlbmd0aC0xXTtcclxuXHRcdFx0XHR2YXIgcG9zID0gbHN0YXRlLmdwcztcclxuXHRcdFx0XHRpZiAocG9zWzBdICE9IHRoaXMuZ2V0UG9zaXRpb24oKVswXSB8fCBwb3NbMV0gIT0gdGhpcy5nZXRQb3NpdGlvbigpWzFdKSBcclxuXHRcdFx0XHR7XHJcblx0XHRcdFx0ICAgIHRoaXMuc2V0UG9zaXRpb24ocG9zKTtcclxuXHRcdFx0XHQgICAgdGhpcy5zZXRSb3RhdGlvbihudWxsKTtcclxuXHRcdFx0XHRcdHRoaXMudXBkYXRlRmVhdHVyZSgpO1xyXG5cdFx0XHRcdH0gZWxzZSB7XHJcblx0XHRcdFx0XHRpZiAodGhpcy5pc0Rpc2NhcmRlZCkge1xyXG5cdFx0XHRcdFx0XHR0aGlzLnVwZGF0ZUZlYXR1cmUoKTtcclxuXHRcdFx0XHRcdH1cclxuXHRcdFx0XHR9XHJcblx0XHRcdFx0cmV0dXJuO1xyXG5cdFx0XHR9XHJcblx0XHRcdHRoaXMuc2V0TGFzdEludGVycG9sYXRlVGltZXN0YW1wKGN0aW1lKTtcclxuXHRcdFx0Ly8gTm8gZW5vdWdoIGRhdGE/XHJcblx0XHRcdGlmICh0aGlzLnN0YXRlcy5sZW5ndGggPCAyKVxyXG5cdFx0XHRcdHJldHVybjtcclxuXHRcdFx0dmFyIHJlcyA9IHRoaXMuY2FsY3VsYXRlRWxhcHNlZEF2ZXJhZ2UoY3RpbWUpO1xyXG5cdFx0XHRpZiAocmVzKSBcclxuXHRcdFx0e1xyXG5cdFx0XHRcdHZhciB0cmVzPXJlcztcclxuXHRcdFx0XHRpZiAodHJlcyA9PSB0aGlzLnRyYWNrLmxhcHMpXHJcblx0XHRcdFx0XHR0cmVzPTEuMDtcclxuXHRcdFx0XHRlbHNlXHJcblx0XHRcdFx0XHR0cmVzPXRyZXMlMTtcclxuXHRcdFx0XHR2YXIgdGthID0gdGhpcy50cmFjay5nZXRQb3NpdGlvbkFuZFJvdGF0aW9uRnJvbUVsYXBzZWQodHJlcyk7XHJcblx0XHRcdFx0dGhpcy5zZXRQb3NpdGlvbihbdGthWzBdLHRrYVsxXV0pO1xyXG5cdFx0XHRcdHRoaXMuc2V0Um90YXRpb24odGthWzJdKTtcclxuXHRcdFx0XHR0aGlzLnVwZGF0ZUZlYXR1cmUoKTtcclxuXHRcdFx0XHR0aGlzLnNldEVsYXBzZWQocmVzKTtcclxuXHRcdFx0fSBcclxuXHRcdH0sXHJcblxyXG5cdFx0bWluIDogZnVuY3Rpb24oY3RpbWUscHJvTmFtZSkgXHJcblx0XHR7XHJcblx0XHRcdHZhciByZXM9bnVsbDtcclxuXHRcdFx0Zm9yICh2YXIgaT10aGlzLnN0YXRlcy5sZW5ndGgtMjtpPj0wO2ktLSkgXHJcblx0XHRcdHtcclxuXHRcdFx0XHR2YXIgaiA9IGkrMTtcclxuXHRcdFx0XHR2YXIgc2EgPSB0aGlzLnN0YXRlc1tpXTtcclxuXHRcdFx0XHR2YXIgc2IgPSB0aGlzLnN0YXRlc1tqXTtcclxuXHRcdFx0XHRpZiAoY3RpbWUgPj0gc2EudGltZXN0YW1wICYmIGN0aW1lIDw9IHNiLnRpbWVzdGFtcCkgXHJcblx0XHRcdFx0eyBcclxuXHRcdFx0XHRcdHJlcyA9IHNhW3Byb05hbWVdO1xyXG5cdFx0XHRcdFx0YnJlYWs7XHJcblx0XHRcdFx0fVxyXG5cdFx0XHRcdGlmIChzYi50aW1lc3RhbXAgPCBjdGltZSlcclxuXHRcdFx0XHRcdGJyZWFrO1xyXG5cdFx0XHR9XHJcblx0XHRcdHJldHVybiByZXM7XHJcblx0XHR9LFxyXG5cclxuXHRcdGF2ZzIgOiBmdW5jdGlvbihjdGltZSxwcm9OYW1lKSBcclxuXHRcdHtcclxuXHRcdFx0dmFyIHJlcz1udWxsO1xyXG5cdFx0XHRmb3IgKHZhciBpPXRoaXMuc3RhdGVzLmxlbmd0aC0yO2k+PTA7aS0tKSBcclxuXHRcdFx0e1xyXG5cdFx0XHRcdHZhciBqID0gaSsxO1xyXG5cdFx0XHRcdHZhciBzYSA9IHRoaXMuc3RhdGVzW2ldO1xyXG5cdFx0XHRcdHZhciBzYiA9IHRoaXMuc3RhdGVzW2pdO1xyXG5cdFx0XHRcdGlmIChjdGltZSA+PSBzYS50aW1lc3RhbXAgJiYgY3RpbWUgPD0gc2IudGltZXN0YW1wKSBcclxuXHRcdFx0XHR7IFxyXG5cdFx0XHRcdFx0cmVzID0gW1xyXG5cdFx0XHRcdFx0ICAgICAgIFx0c2FbcHJvTmFtZV1bMF0rKGN0aW1lLXNhLnRpbWVzdGFtcCkgKiAoc2JbcHJvTmFtZV1bMF0tc2FbcHJvTmFtZV1bMF0pIC8gKHNiLnRpbWVzdGFtcC1zYS50aW1lc3RhbXApLFxyXG5cdFx0XHRcdFx0ICAgICAgIFx0c2FbcHJvTmFtZV1bMV0rKGN0aW1lLXNhLnRpbWVzdGFtcCkgKiAoc2JbcHJvTmFtZV1bMV0tc2FbcHJvTmFtZV1bMV0pIC8gKHNiLnRpbWVzdGFtcC1zYS50aW1lc3RhbXApXHJcblx0XHRcdFx0ICAgICAgICAgIF07IFxyXG5cdFx0XHRcdFx0YnJlYWs7XHJcblx0XHRcdFx0fVxyXG5cdFx0XHRcdGlmIChzYi50aW1lc3RhbXAgPCBjdGltZSlcclxuXHRcdFx0XHRcdGJyZWFrO1xyXG5cdFx0XHR9XHJcblx0XHRcdHJldHVybiByZXM7XHJcblx0XHR9LFxyXG5cclxuXHRcdGF2ZyA6IGZ1bmN0aW9uKGN0aW1lLHByb05hbWUpIFxyXG5cdFx0e1xyXG5cdFx0XHR2YXIgcmVzPW51bGw7XHJcblx0XHRcdC8vY29uc29sZS5sb2codGhpcy5zdGF0ZXMpO1xyXG5cdFx0XHRmb3IgKHZhciBpPXRoaXMuc3RhdGVzLmxlbmd0aC0yO2k+PTA7aS0tKSBcclxuXHRcdFx0e1xyXG5cdFx0XHRcdHZhciBqID0gaSsxO1xyXG5cdFx0XHRcdHZhciBzYSA9IHRoaXMuc3RhdGVzW2ldO1xyXG5cdFx0XHRcdHZhciBzYiA9IHRoaXMuc3RhdGVzW2pdO1xyXG5cdFx0XHRcdGlmIChjdGltZSA+PSBzYS50aW1lc3RhbXAgJiYgY3RpbWUgPD0gc2IudGltZXN0YW1wKSBcclxuXHRcdFx0XHR7IFxyXG5cdFx0XHRcdFx0cmVzID0gc2FbcHJvTmFtZV0rKGN0aW1lLXNhLnRpbWVzdGFtcCkgKiAoc2JbcHJvTmFtZV0tc2FbcHJvTmFtZV0pIC8gKHNiLnRpbWVzdGFtcC1zYS50aW1lc3RhbXApO1xyXG5cdFx0XHRcdFx0YnJlYWs7XHJcblx0XHRcdFx0fVxyXG5cdFx0XHRcdGlmIChzYi50aW1lc3RhbXAgPCBjdGltZSlcclxuXHRcdFx0XHRcdGJyZWFrO1xyXG5cdFx0XHR9XHJcblx0XHRcdC8qaWYgKHJlcyA9PSBudWxsKSB7XHJcblx0XHRcdFx0dmFyIGFycj1bXTtcclxuXHRcdFx0XHRmb3IgKHZhciBpPXRoaXMuc3RhdGVzLmxlbmd0aC0xO2k+PTA7aS0tKSBpZiAoaSA9PSAwIHx8IGkgPT0gdGhpcy5zdGF0ZXMubGVuZ3RoLTEpIHtcclxuXHRcdFx0XHRcdGFyci5wdXNoKFV0aWxzLmZvcm1hdERhdGVUaW1lU2VjKG5ldyBEYXRlKHRoaXMuc3RhdGVzW2ldLnRpbWVzdGFtcCkpKTtcclxuXHRcdFx0XHR9IFxyXG5cdFx0XHRcdGNvbnNvbGUubG9nKFwiQVZHIE5VTEwgQkVDQVVTRSBTRUFSQ0hJTkcgXCIrVXRpbHMuZm9ybWF0RGF0ZVRpbWVTZWMobmV3IERhdGUoY3RpbWUpKStcIiB8IFwiK2Fycik7XHJcblx0XHRcdH0qL1xyXG5cdFx0XHRyZXR1cm4gcmVzO1xyXG5cdFx0fSxcclxuXHJcblx0XHRjYWxjdWxhdGVFbGFwc2VkQXZlcmFnZSA6IGZ1bmN0aW9uKGN0aW1lKSBcclxuXHRcdHtcclxuXHRcdFx0dmFyIHJlcz1udWxsO1xyXG5cdFx0XHRjdGltZS09Q09ORklHLm1hdGguZGlzcGxheURlbGF5KjEwMDA7XHJcblx0XHRcdC8vY29uc29sZS5sb2coXCJTRUFSQ0hJTkcgRk9SIFRJTUUgXCIrVXRpbHMuZm9ybWF0RGF0ZVRpbWVTZWMobmV3IERhdGUoY3RpbWUpKSk7XHJcblx0XHRcdHZhciBvayA9IGZhbHNlO1xyXG5cdFx0XHRmb3IgKHZhciBpPXRoaXMuc3RhdGVzLmxlbmd0aC0yO2k+PTA7aS0tKSBcclxuXHRcdFx0e1xyXG5cdFx0XHRcdHZhciBqID0gaSsxO1xyXG5cdFx0XHRcdHZhciBzYSA9IHRoaXMuY2FsY0FWR1N0YXRlKGkpO1xyXG5cdFx0XHRcdHZhciBzYiA9IHRoaXMuY2FsY0FWR1N0YXRlKGopO1xyXG5cdFx0XHRcdGlmIChjdGltZSA+PSBzYS50aW1lc3RhbXAgJiYgY3RpbWUgPD0gc2IudGltZXN0YW1wKSBcclxuXHRcdFx0XHR7IFxyXG5cdFx0XHRcdFx0cmVzID0gc2EuZWxhcHNlZCsoY3RpbWUtc2EudGltZXN0YW1wKSAqIChzYi5lbGFwc2VkLXNhLmVsYXBzZWQpIC8gKHNiLnRpbWVzdGFtcC1zYS50aW1lc3RhbXApO1xyXG5cdFx0XHRcdFx0Ly9jb25zb2xlLmxvZyhcIkZPVU5EIFRJTUUgSU5UIFtcIitVdGlscy5mb3JtYXREYXRlVGltZVNlYyhuZXcgRGF0ZShzYS50aW1lc3RhbXApKStcIiA+IFwiK1V0aWxzLmZvcm1hdERhdGVUaW1lU2VjKG5ldyBEYXRlKHNiLnRpbWVzdGFtcCkpK1wiXVwiKTtcclxuXHRcdFx0XHRcdG9rPXRydWU7XHJcblx0XHRcdFx0XHRicmVhaztcclxuXHRcdFx0XHR9XHJcblx0XHRcdFx0aWYgKHNiLnRpbWVzdGFtcCA8IGN0aW1lKSB7XHJcblx0XHRcdFx0XHR0aGlzLnNldFNpZ25hbExvc3REZWxheShjdGltZS1zYi50aW1lc3RhbXApO1xyXG5cdFx0XHRcdFx0Ly9jb25zb2xlLmxvZyhcIkJSRUFLIE9OIFwiK2Zvcm1hdFRpbWVTZWMobmV3IERhdGUoY3RpbWUpKStcIiB8IFwiKyhjdGltZS1zYi50aW1lc3RhbXApLzEwMDAuMCk7XHJcblx0XHRcdFx0XHRyZXR1cm4gbnVsbDtcclxuXHRcdFx0XHR9XHJcblx0XHRcdH1cclxuXHRcdFx0aWYgKCFvaykge1xyXG5cdFx0XHRcdGlmICh0aGlzLnN0YXRlcy5sZW5ndGggPj0gMilcclxuXHRcdFx0XHRcdGNvbnNvbGUubG9nKHRoaXMuY29kZStcIiB8IE5PVCBGT1VORCBUSU1FIFwiK1V0aWxzLmZvcm1hdERhdGVUaW1lU2VjKG5ldyBEYXRlKGN0aW1lKSkrXCIgfCB0LWxhc3Q9XCIrKGN0aW1lLXRoaXMuc3RhdGVzW3RoaXMuc3RhdGVzLmxlbmd0aC0xXS50aW1lc3RhbXApLzEwMDAuMCtcIiB8IHQtZmlyc3Q9XCIrKGN0aW1lLXRoaXMuc3RhdGVzWzBdLnRpbWVzdGFtcCkvMTAwMC4wKTtcclxuXHRcdFx0fSBlbHNlXHJcblx0XHRcdFx0dGhpcy5zZXRTaWduYWxMb3N0RGVsYXkobnVsbCk7XHJcblx0XHRcdHJldHVybiByZXM7XHJcblx0XHR9LFxyXG5cdFx0XHJcblx0XHRjYWxjQVZHU3RhdGUgOiBmdW5jdGlvbihwb3MpIHtcclxuXHRcdFx0aWYgKCFDT05GSUcubWF0aC5pbnRlcnBvbGF0ZUdQU0F2ZXJhZ2UpXHJcblx0XHRcdFx0cmV0dXJuIHRoaXMuc3RhdGVzW3Bvc107XHJcblx0XHRcdHZhciBzc3VtZT0wO1xyXG5cdFx0XHR2YXIgc3N1bXQ9MDtcclxuXHRcdFx0dmFyIGNjPTA7XHJcblx0XHRcdGZvciAodmFyIGk9cG9zO2k+PTAgJiYgKHBvcy1pKTxDT05GSUcubWF0aC5pbnRlcnBvbGF0ZUdQU0F2ZXJhZ2U7aS0tKSB7XHJcblx0XHRcdFx0c3N1bWUrPXRoaXMuc3RhdGVzW2ldLmVsYXBzZWQ7XHJcblx0XHRcdFx0c3N1bXQrPXRoaXMuc3RhdGVzW2ldLnRpbWVzdGFtcDtcclxuXHRcdFx0XHRjYysrO1xyXG5cdFx0XHR9XHJcblx0XHRcdHNzdW1lLz1jYztcclxuXHRcdFx0c3N1bXQvPWNjO1xyXG5cdFx0XHRyZXR1cm4ge2VsYXBzZWQgOiBzc3VtZSx0aW1lc3RhbXAgOiBzc3VtdH07XHJcblx0XHR9LFxyXG5cclxuXHRcdHBpbmdDYWxjdWxhdGVkIDogZnVuY3Rpb24ob2JqKSB7XHJcblx0XHRcdHZhciBzdGF0ZSA9IG5ldyBQYXJ0aWNpcGFudFN0YXRlKG9iaik7XHJcblx0XHRcdHRoaXMuYWRkU3RhdGUoc3RhdGUpO1xyXG5cdFx0XHR2YXIgcG9zID0gc3RhdGUuZ3BzO1xyXG5cdFx0XHR2YXIgY29lZiA9IHRoaXMudHJhY2suZ2V0VHJhY2tMZW5ndGhJbldHUzg0KCkvdGhpcy50cmFjay5nZXRUcmFja0xlbmd0aCgpO1xyXG5cdFx0XHR2YXIgcnIgPSBDT05GSUcubWF0aC5ncHNJbmFjY3VyYWN5KmNvZWY7XHJcblx0XHRcdGlmICh0eXBlb2YgR1VJICE9IFwidW5kZWZpbmVkXCIgJiYgR1VJLmlzRGVidWcpIFxyXG5cdFx0XHR7XHJcblx0XHRcdFx0dmFyIHJpbmcgPSBbXHJcblx0XHRcdFx0ICAgICAgICAgICAgW3Bvc1swXS1yciwgcG9zWzFdLXJyKmNvZWZ5XSwgW3Bvc1swXStyciwgcG9zWzFdLXJyKmNvZWZ5XSxbcG9zWzBdK3JyLCBwb3NbMV0rcnIqY29lZnldLFtwb3NbMF0tcnIsIHBvc1sxXStycipjb2VmeV0sW3Bvc1swXS1yciwgcG9zWzFdLXJyKmNvZWZ5XVxyXG5cdFx0XHRcdCAgICAgICAgICBdO1xyXG5cdFx0XHRcdHZhciBwb2x5Z29uID0gbmV3IG9sLmdlb20uUG9seWdvbihbcmluZ10pO1xyXG5cdFx0XHRcdHBvbHlnb24udHJhbnNmb3JtKCdFUFNHOjQzMjYnLCAnRVBTRzozODU3Jyk7XHJcblx0XHRcdFx0dmFyIGZlYXR1cmUgPSBuZXcgb2wuRmVhdHVyZShwb2x5Z29uKTtcclxuXHRcdFx0XHRHVUkudGVzdExheWVyMS5nZXRTb3VyY2UoKS5hZGRGZWF0dXJlKGZlYXR1cmUpO1xyXG5cclxuXHRcdFx0XHR2YXIgbXBvcyA9IG9sLnByb2oudHJhbnNmb3JtKHBvcywgJ0VQU0c6NDMyNicsICdFUFNHOjM4NTcnKTtcclxuXHRcdFx0XHR2YXIgZmVhdHVyZSA9IG5ldyBvbC5GZWF0dXJlKG5ldyBvbC5nZW9tLlBvaW50KG1wb3MpKTtcclxuXHRcdFx0XHRHVUkudGVzdExheWVyLmdldFNvdXJjZSgpLmFkZEZlYXR1cmUoZmVhdHVyZSk7XHJcblx0XHRcdFx0Y29uc29sZS5sb2coTWF0aC5yb3VuZChzdGF0ZS5lbGFwc2VkKjEwMC4wKjEwMC4wKS8xMDAuMCtcIiUgUE9ORyBbXCIrcG9zWzBdK1wiLFwiK3Bvc1sxXStcIl0gXCIrbmV3IERhdGUoc3RhdGUudGltZXN0YW1wKSk7XHJcblxyXG5cdFx0XHRcdHdoaWxlIChHVUkudGVzdExheWVyMS5nZXRTb3VyY2UoKS5nZXRGZWF0dXJlcygpLmxlbmd0aCA+IDEwKVxyXG5cdFx0XHRcdFx0R1VJLnRlc3RMYXllcjEuZ2V0U291cmNlKCkucmVtb3ZlRmVhdHVyZShHVUkudGVzdExheWVyMS5nZXRTb3VyY2UoKS5nZXRGZWF0dXJlcygpWzBdKTtcclxuXHRcdFx0XHR3aGlsZSAoR1VJLnRlc3RMYXllci5nZXRTb3VyY2UoKS5nZXRGZWF0dXJlcygpLmxlbmd0aCA+IDEwKVxyXG5cdFx0XHRcdFx0R1VJLnRlc3RMYXllci5nZXRTb3VyY2UoKS5yZW1vdmVGZWF0dXJlKEdVSS50ZXN0TGF5ZXIuZ2V0U291cmNlKCkuZ2V0RmVhdHVyZXMoKVswXSk7XHJcblx0XHRcdH0gXHJcblxyXG5cdFx0fSxcclxuXHJcblx0XHRnZXRPdmVyYWxsUmFuayA6IGZ1bmN0aW9uKCkge1xyXG5cdFx0XHRpZiAodGhpcy5zdGF0ZXMubGVuZ3RoKSB7XHJcblx0XHRcdFx0cmV0dXJuIHRoaXMuc3RhdGVzW3RoaXMuc3RhdGVzLmxlbmd0aC0xXS5vdmVyYWxsUmFuaztcclxuXHRcdFx0fVxyXG5cdFx0XHRyZXR1cm4gXCItXCI7XHJcblx0XHR9LFxyXG5cdFx0Z2V0R3JvdXBSYW5rIDogZnVuY3Rpb24oKSB7XHJcblx0XHRcdGlmICh0aGlzLnN0YXRlcy5sZW5ndGgpIHtcclxuXHRcdFx0XHRyZXR1cm4gdGhpcy5zdGF0ZXNbdGhpcy5zdGF0ZXMubGVuZ3RoLTFdLmdyb3VwUmFuaztcclxuXHRcdFx0fVxyXG5cdFx0XHRyZXR1cm4gXCItXCI7XHJcblx0XHR9LFxyXG5cdFx0Z2V0R2VuZGVyUmFuayA6IGZ1bmN0aW9uKCkge1xyXG5cdFx0XHRpZiAodGhpcy5zdGF0ZXMubGVuZ3RoKSB7XHJcblx0XHRcdFx0cmV0dXJuIHRoaXMuc3RhdGVzW3RoaXMuc3RhdGVzLmxlbmd0aC0xXS5nZW5kZXJSYW5rO1xyXG5cdFx0XHR9XHJcblx0XHRcdHJldHVybiBcIi1cIjtcclxuXHRcdH0sXHJcblx0XHRcclxuXHRcdHBpbmcgOiBmdW5jdGlvbihwb3MsZnJlcSxpc1NPUyxjdGltZSxhbHQsb3ZlcmFsbFJhbmssZ3JvdXBSYW5rLGdlbmRlclJhbmssX0VMQVBTRUQpXHJcblx0XHR7XHJcblx0XHRcdHZhciBsbHQgPSAobmV3IERhdGUoKSkuZ2V0VGltZSgpOyBcclxuXHRcdFx0aWYgKCFjdGltZSlcclxuXHRcdFx0XHRjdGltZT1sbHQ7XHJcblx0XHRcdHRoaXMuc2V0TGFzdFJlYWxEZWxheShsbHQtY3RpbWUpO1xyXG5cdFx0XHR0aGlzLnNldExhc3RQaW5nVGltZXN0YW1wKGxsdCk7XHRcdFx0XHJcblx0XHRcdHZhciBzdGF0ZSA9IG5ldyBQYXJ0aWNpcGFudFN0YXRlKHt0aW1lc3RhbXA6Y3RpbWUsZ3BzOnBvcyxpc1NPUzppc1NPUyxmcmVxOmZyZXEsYWx0OmFsdCxvdmVyYWxsUmFuazpvdmVyYWxsUmFuayxncm91cFJhbms6Z3JvdXBSYW5rLGdlbmRlclJhbms6Z2VuZGVyUmFua30pO1xyXG5cdFx0XHQvL2lzU09TPXRydWU7XHJcblx0XHRcdGlmIChpc1NPUyB8fCBDT05GSUcuc2V0dGluZ3Mubm9JbnRlcnBvbGF0aW9uKVxyXG5cdFx0XHR7XHJcblx0XHRcdFx0aWYgKGlzU09TKVxyXG5cdFx0XHRcdFx0dGhpcy5zZXRJc1NPUyh0cnVlKTtcdFx0XHRcdFxyXG5cdFx0XHRcdHRoaXMuYWRkU3RhdGUoc3RhdGUpO1xyXG5cdFx0XHRcdHJldHVybjtcclxuXHRcdFx0fVxyXG5cdFx0XHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRcdFx0dmFyIHRyYWNrbGVuID0gdGhpcy50cmFjay5nZXRUcmFja0xlbmd0aCgpO1xyXG5cdFx0XHR2YXIgdHJhY2tsZW4xID0gdGhpcy50cmFjay5nZXRUcmFja0xlbmd0aEluV0dTODQoKTtcclxuXHRcdFx0dmFyIGxsc3RhdGUgPSB0aGlzLnN0YXRlcy5sZW5ndGggPj0gMiA/IHRoaXMuc3RhdGVzW3RoaXMuc3RhdGVzLmxlbmd0aC0yXSA6IG51bGw7XHJcblx0XHRcdHZhciBsc3RhdGUgPSB0aGlzLnN0YXRlcy5sZW5ndGggPyB0aGlzLnN0YXRlc1t0aGlzLnN0YXRlcy5sZW5ndGgtMV0gOiBudWxsO1xyXG5cdFx0XHRpZiAocG9zWzBdID09IDAgJiYgcG9zWzFdID09IDApIHtcclxuXHRcdFx0XHRpZiAoIWxzdGF0ZSkgcmV0dXJuO1xyXG5cdFx0XHRcdHBvcz1sc3RhdGUuZ3BzO1xyXG5cdFx0XHR9XHJcblx0XHRcdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdFx0XHR2YXIgYmVzdDtcclxuXHRcdFx0dmFyIGJlc3RtPW51bGw7XHJcblx0XHRcdHZhciBsZWxwID0gbHN0YXRlID8gbHN0YXRlLmdldEVsYXBzZWQoKSA6IDA7XHQvLyBsYXN0IGVsYXBzZWRcclxuXHRcdFx0dmFyIHRnID0gdGhpcy50cmFjay5yb3V0ZTtcclxuXHRcdFx0Ly8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0XHRcdC8vIE5FVyBBTEdcclxuXHRcdFx0dmFyIGNvZWYgPSB0aGlzLnRyYWNrLmdldFRyYWNrTGVuZ3RoSW5XR1M4NCgpL3RoaXMudHJhY2suZ2V0VHJhY2tMZW5ndGgoKTtcclxuXHRcdFx0dmFyIG1pbmYgPSBudWxsO1xyXG5cdFx0XHR2YXIgcnIgPSBDT05GSUcubWF0aC5ncHNJbmFjY3VyYWN5KmNvZWY7XHJcblx0XHRcdHZhciByZXN1bHQgPSB0aGlzLnRyYWNrLnJUcmVlLnNlYXJjaChbcG9zWzBdLXJyLCBwb3NbMV0tcnIqY29lZnksIHBvc1swXStyciwgcG9zWzFdK3JyKmNvZWZ5XSk7XHJcblx0XHRcdGlmICghcmVzdWx0KVxyXG5cdFx0XHRcdHJlc3VsdD1bXTtcclxuXHRcdFx0XHJcblx0XHRcdGNvbnNvbGUubG9nKFwiISEhIEZPVU5EIFwiK3Jlc3VsdC5sZW5ndGgrXCIgfCBcIit0aGlzLnRyYWNrLnJvdXRlLmxlbmd0aCtcIiB8IFwiK3JyKTtcclxuXHRcdFx0Ly9mb3IgKHZhciBpPTA7aTx0aGlzLnRyYWNrLnJvdXRlLmxlbmd0aC0xO2krKykge1xyXG5cclxuXHRcdFx0Ly8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0XHRcdHZhciBycmVjdCA9IEludGVyc2VjdGlvblBhcmFtcy5uZXdSZWN0KHBvc1swXS1yciwgcG9zWzBdLXJyKmNvZWZ5LCByciwgcnIuY29lZnkpO1xyXG5cdFx0XHRmb3IgKHZhciBfaT0wO19pPHJlc3VsdC5sZW5ndGg7X2krKylcclxuXHRcdFx0e1xyXG5cdFx0XHRcdHZhciBpID0gcmVzdWx0W19pXVs0XS5pbmRleDtcclxuXHRcdFx0XHRcclxuXHRcdFx0XHQvKnZhciByZXMgPSBJbnRlcnNlY3Rpb24uaW50ZXJzZWN0U2hhcGVzKCAgXHJcblx0XHRcdCAgICAgICAgICAgICAgXHRJbnRlcnNlY3Rpb25QYXJhbXMubmV3TGluZShuZXcgUG9pbnQyRCh0Z1tpXVswXSx0Z1tpXVsxXSksbmV3IFBvaW50MkQodGdbaSsxXVswXSx0Z1tpKzFdWzFdKSkgIFxyXG5cdFx0XHQgICAgICAgICAgICAgICwgcnJlY3QgIFxyXG5cdFx0XHQgICAgICBcdFx0KTtcclxuXHRcdFx0XHRpZiAocmVzKSBcclxuXHRcdFx0XHR7XHJcblx0XHRcdFx0XHR2YXIgZDMgPSBXR1M4NFNQSEVSRS5oYXZlcnNpbmVEaXN0YW5jZSh0Z1tpXSx0Z1tpKzFdKTtcclxuXHRcdFx0XHRcdGZvciAodmFyIHE9MDtxPHJlcy5sZW5ndGg7cSsrKSBcclxuXHRcdFx0XHRcdHtcclxuXHRcdFx0XHRcdFx0Ly9VdGlscy5kaXNwXHJcblx0XHRcdFx0XHRcdHZhciBkMSA9IFdHUzg0U1BIRVJFLmhhdmVyc2luZURpc3RhbmNlKFtyZXNbcV0ueCxyZXNbcV0ueV0sdGdbaV0pO1xyXG5cdFx0XHRcdFx0XHR2YXIgZWwxID0gdGhpcy50cmFjay5kaXN0YW5jZXNFbGFwc2VkW2ldKyh0aGlzLnRyYWNrLmRpc3RhbmNlc0VsYXBzZWRbaSsxXS10aGlzLnRyYWNrLmRpc3RhbmNlc0VsYXBzZWRbaV0pKmQxL2QzO1xyXG5cdFx0XHRcdFx0XHRpZiAoZWwxIDwgbGVscClcclxuXHRcdFx0XHRcdFx0XHRlbDE9bGVscDtcclxuXHRcdFx0XHRcdFx0aWYgKG1pbmYgPT0gbnVsbCB8fCBlbDEgPCBtaW5mKVxyXG5cdFx0XHRcdFx0XHRcdG1pbmY9ZWwxO1xyXG5cdFx0XHRcdFx0XHRjb25zb2xlLmxvZyhcIkludGVyc2VjdGlvbiBjYW5kaWRhdGUgYXQgXCIraStcIiB8IFwiK01hdGgucm91bmQoZWwxKjEwMC4wKjEwMC4wKS8xMDAuMCk7XHJcblx0XHRcdFx0XHR9XHJcblx0XHRcdFx0fSovXHJcblx0XHRcdFx0dmFyIHJlcyA9IFV0aWxzLmludGVyY2VwdE9uQ2lyY2xlKHRnW2ldLHRnW2krMV0scG9zLHJyKTtcclxuXHRcdFx0XHRpZiAocmVzKSBcclxuXHRcdFx0XHR7XHJcblx0XHRcdFx0XHQvLyBoYXMgaW50ZXJzZWN0aW9uICgyIHBvaW50cylcclxuXHRcdFx0XHRcdHZhciBkMSA9IFV0aWxzLmRpc3RwKHJlc1swXSx0Z1tpXSk7XHJcblx0XHRcdFx0XHR2YXIgZDIgPSBVdGlscy5kaXN0cChyZXNbMV0sdGdbaV0pO1xyXG5cdFx0XHRcdFx0dmFyIGQzID0gVXRpbHMuZGlzdHAodGdbaV0sdGdbaSsxXSk7XHJcblx0XHRcdFx0XHR2YXIgZWwxID0gdGhpcy50cmFjay5kaXN0YW5jZXNFbGFwc2VkW2ldKyh0aGlzLnRyYWNrLmRpc3RhbmNlc0VsYXBzZWRbaSsxXS10aGlzLnRyYWNrLmRpc3RhbmNlc0VsYXBzZWRbaV0pKmQxL2QzO1xyXG5cdFx0XHRcdFx0dmFyIGVsMiA9IHRoaXMudHJhY2suZGlzdGFuY2VzRWxhcHNlZFtpXSsodGhpcy50cmFjay5kaXN0YW5jZXNFbGFwc2VkW2krMV0tdGhpcy50cmFjay5kaXN0YW5jZXNFbGFwc2VkW2ldKSpkMi9kMztcclxuXHRcdFx0XHRcdC8vY29uc29sZS5sb2coXCJJbnRlcnNlY3Rpb24gY2FuZGlkYXRlIGF0IFwiK2krXCIgfCBcIitNYXRoLnJvdW5kKGVsMSoxMDAuMCoxMDAuMCkvMTAwLjArXCIgfCBcIitNYXRoLnJvdW5kKGVsMioxMDAuMCoxMDAuMCkvMTAwLjArXCIgfCBMRUxQPVwiK01hdGgucm91bmQobGVscCoxMDAuMCoxMDAuMCkvMTAwLjApO1xyXG5cdFx0XHRcdFx0aWYgKGVsMSA8IGxlbHApXHJcblx0XHRcdFx0XHRcdGVsMT1sZWxwO1xyXG5cdFx0XHRcdFx0aWYgKGVsMiA8IGxlbHApXHJcblx0XHRcdFx0XHRcdGVsMj1sZWxwO1xyXG5cdFx0XHRcdFx0Ly8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0XHRcdFx0XHRpZiAobWluZiA9PSBudWxsIHx8IGVsMSA8IG1pbmYpXHJcblx0XHRcdFx0XHRcdG1pbmY9ZWwxO1xyXG5cdFx0XHRcdFx0aWYgKGVsMiA8IG1pbmYpXHJcblx0XHRcdFx0XHRcdG1pbmY9ZWwyO1xyXG5cdFx0XHRcdH1cclxuXHRcdFx0fVxyXG5cdFx0XHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVx0XHRcdFxyXG5cdFx0XHQvKmlmIChtaW5mID09IG51bGwpXHJcblx0XHRcdFx0Y29uc29sZS5lcnJvcihcIk1JTkYgTlVMTFwiKTtcclxuXHRcdFx0ZWxzZVxyXG5cdFx0XHRcdGNvbnNvbGUubG9nKFwiPj4gTUlORiBcIitNYXRoLnJvdW5kKG1pbmYqMTAwLjAqMTAwLjApLzEwMC4wKTsqL1xyXG5cdFx0XHRcclxuXHRcdFx0aWYgKG1pbmYgPT0gbnVsbCkge1xyXG5cdFx0XHRcdHN0YXRlLnNldEVsYXBzZWQobmVsKTtcclxuXHRcdFx0XHR0aGlzLmFkZFN0YXRlKHN0YXRlKTtcclxuXHRcdFx0XHRyZXR1cm47XHJcblx0XHRcdH1cclxuXHJcblx0XHRcdGJlc3RtPW1pbmY7XHJcblx0XHRcdGlmIChiZXN0bSAhPSBudWxsKSBcclxuXHRcdFx0e1xyXG5cdFx0XHRcdHZhciBuZWwgPSBiZXN0bTsgLy90aGlzLnRyYWNrLmdldEVsYXBzZWRGcm9tUG9pbnQoYmVzdCk7XHJcblx0XHRcdFx0aWYgKGxzdGF0ZSkgXHJcblx0XHRcdFx0e1xyXG5cdFx0XHRcdFx0LyppZiAobmVsIDwgbHN0YXRlLmdldEVsYXBzZWQoKSkgXHJcblx0XHRcdFx0XHR7XHJcblx0XHRcdFx0XHRcdC8vIFdST05HIERJUkVDVElPTiBPUiBHUFMgREFUQSBXUk9ORz8gU0tJUC4uXHJcblx0XHRcdFx0XHRcdGlmICgobHN0YXRlLmdldEVsYXBzZWQoKS1uZWwpKnRyYWNrbGVuIDwgQ09ORklHLmNvbnN0cmFpbnRzLmJhY2t3YXJkc0Vwc2lsb25Jbk1ldGVyKSBcclxuXHRcdFx0XHRcdFx0XHRyZXR1cm47XHJcblx0XHRcdFx0XHRcdGRvICBcclxuXHRcdFx0XHRcdFx0e1xyXG5cdFx0XHRcdFx0XHRcdG5lbCs9MS4wO1xyXG5cdFx0XHRcdFx0XHR9IHdoaWxlIChuZWwgPCBsc3RhdGUuZ2V0RWxhcHNlZCgpKTtcclxuXHRcdFx0XHRcdH0qL1xyXG5cdFx0XHRcdFx0Ly8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdFx0XHRcdFx0aWYgKG5lbCA+IHRoaXMudHJhY2subGFwcykge1xyXG5cdFx0XHRcdFx0XHRuZWw9dGhpcy50cmFjay5sYXBzO1xyXG5cdFx0XHRcdFx0fVxyXG5cdFx0XHRcdFx0Ly8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdFx0XHRcdFx0bGxzdGF0ZSA9IHRoaXMuc3RhdGVzLmxlbmd0aCA+PSBDT05GSUcubWF0aC5zcGVlZEFuZEFjY2VsZXJhdGlvbkF2ZXJhZ2VEZWdyZWUqMiA/IHRoaXMuc3RhdGVzW3RoaXMuc3RhdGVzLmxlbmd0aC1DT05GSUcubWF0aC5zcGVlZEFuZEFjY2VsZXJhdGlvbkF2ZXJhZ2VEZWdyZWUqMl0gOiBudWxsO1xyXG5cdFx0XHRcdFx0bHN0YXRlID0gdGhpcy5zdGF0ZXMubGVuZ3RoID49IENPTkZJRy5tYXRoLnNwZWVkQW5kQWNjZWxlcmF0aW9uQXZlcmFnZURlZ3JlZSA/IHRoaXMuc3RhdGVzW3RoaXMuc3RhdGVzLmxlbmd0aC1DT05GSUcubWF0aC5zcGVlZEFuZEFjY2VsZXJhdGlvbkF2ZXJhZ2VEZWdyZWVdIDogbnVsbDtcclxuXHRcdFx0XHRcdGlmIChsc3RhdGUpICB7XHJcblx0XHRcdFx0XHRcdHN0YXRlLnNldFNwZWVkKCB0cmFja2xlbiAqIChuZWwtbHN0YXRlLmdldEVsYXBzZWQoKSkgKiAxMDAwIC8gKGN0aW1lLWxzdGF0ZS50aW1lc3RhbXApKTtcclxuXHRcdFx0XHRcdFx0aWYgKGxsc3RhdGUpIFxyXG5cdFx0XHRcdFx0XHRcdHN0YXRlLnNldEFjY2VsZXJhdGlvbiggKHN0YXRlLmdldFNwZWVkKCktbHN0YXRlLmdldFNwZWVkKCkpICogMTAwMCAvIChjdGltZS1sc3RhdGUudGltZXN0YW1wKSk7XHJcblx0XHRcdFx0XHR9XHJcblx0XHRcdFx0XHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0XHRcdFx0fVxyXG5cdFx0XHRcdHN0YXRlLnNldEVsYXBzZWQobmVsKTtcclxuXHRcdFx0fSBlbHNlIHtcclxuXHRcdFx0XHRpZiAobHN0YXRlKVxyXG5cdFx0XHRcdFx0c3RhdGUuc2V0RWxhcHNlZChsc3RhdGUuZ2V0RWxhcHNlZCgpKTtcclxuXHRcdFx0XHRpZiAobHN0YXRlLmdldEVsYXBzZWQoKSAhPSB0aGlzLnRyYWNrLmxhcHMpIHtcclxuXHRcdFx0XHRcdHRoaXMuc2V0SXNEaXNjYXJkZWQodHJ1ZSk7XHJcblx0XHRcdFx0fVxyXG5cdFx0XHR9XHJcblx0XHRcdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRcdFx0dGhpcy5hZGRTdGF0ZShzdGF0ZSk7XHJcblx0XHR9LFxyXG5cdFx0XHJcblx0XHRhZGRTdGF0ZSA6IGZ1bmN0aW9uKHN0YXRlKSB7XHJcblx0XHRcdHRoaXMuc3RhdGVzLnB1c2goc3RhdGUpO1xyXG5cdFx0XHRpZiAodGhpcy5zdGF0ZXMubGVuZ3RoID4gQ09ORklHLmNvbnN0cmFpbnRzLm1heFBhcnRpY2lwYW50U3RhdGVIaXN0b3J5ICYmICF0aGlzLmlzU09TKVxyXG5cdFx0XHRcdHRoaXMuc3RhdGVzLnNoaWZ0KCk7XHJcblx0XHR9LFxyXG5cclxuXHRcdGdldExhc3RTdGF0ZTogZnVuY3Rpb24oKSB7XHJcblx0XHRcdHJldHVybiB0aGlzLnN0YXRlcy5sZW5ndGggPyB0aGlzLnN0YXRlc1t0aGlzLnN0YXRlcy5sZW5ndGgtMV0gOiBudWxsO1xyXG5cdFx0fSxcclxuXHJcblx0XHRnZXRGcmVxIDogZnVuY3Rpb24oKSB7XHJcblx0XHRcdHZhciBsc3RhdGUgPSB0aGlzLmdldExhc3RTdGF0ZSgpO1xyXG5cdFx0XHRyZXR1cm4gbHN0YXRlID8gbHN0YXRlLmZyZXEgOiAwO1xyXG5cdFx0fSxcclxuXHJcblx0XHRnZXRTcGVlZCA6IGZ1bmN0aW9uKCkge1xyXG5cdFx0XHR2YXIgbHN0YXRlID0gdGhpcy5nZXRMYXN0U3RhdGUoKTtcclxuXHRcdFx0cmV0dXJuIGxzdGF0ZSA/IGxzdGF0ZS5zcGVlZCA6IDA7XHJcblx0XHR9LFxyXG5cclxuXHRcdGdldEdQUyA6IGZ1bmN0aW9uKCkge1xyXG5cdFx0XHR2YXIgbHN0YXRlID0gdGhpcy5nZXRMYXN0U3RhdGUoKTtcclxuXHRcdFx0cmV0dXJuIGxzdGF0ZSA/IGxzdGF0ZS5ncHMgOiB0aGlzLmdldFBvc2l0aW9uKCk7XHJcblx0XHR9LFxyXG5cclxuXHRcdGdldEVsYXBzZWQgOiBmdW5jdGlvbigpIHtcclxuXHRcdFx0dmFyIGxzdGF0ZSA9IHRoaXMuZ2V0TGFzdFN0YXRlKCk7XHJcblx0XHRcdHJldHVybiBsc3RhdGUgPyBsc3RhdGUuZWxhcHNlZCA6IDA7XHJcblx0XHR9LFxyXG5cclxuXHRcdGdldFBvcHVwSFRNTCA6IGZ1bmN0aW9uKCkge1xyXG5cdFx0XHR2YXIgcG9zID0gdGhpcy5nZXRQb3NpdGlvbigpO1xyXG5cdFx0XHRpZiAodGhpcy5pc1NPUyB8fCB0aGlzLmlzRGlzY2FyZGVkKSB7XHJcblx0XHRcdFx0cG9zID0gdGhpcy5nZXRHUFMoKTtcclxuXHRcdFx0fVxyXG5cdFx0XHR2YXIgdGxlbiA9IHRoaXMudHJhY2suZ2V0VHJhY2tMZW5ndGgoKTtcclxuXHRcdFx0dmFyIGN0aW1lID0gKG5ldyBEYXRlKCkpLmdldFRpbWUoKTtcclxuXHRcdFx0dmFyIGVsYXBzZWQgPSB0aGlzLmNhbGN1bGF0ZUVsYXBzZWRBdmVyYWdlKGN0aW1lKTtcclxuXHRcdFx0dmFyIHRwYXJ0ID0gdGhpcy50cmFjay5nZXRUcmFja1BhcnQoZWxhcHNlZCk7XHJcblx0XHRcdHZhciB0YXJnZXRLTTtcclxuXHRcdFx0dmFyIHBhcnRTdGFydDtcclxuXHRcdFx0dmFyIHRwYXJ0TW9yZTtcclxuXHRcdFx0aWYgKHRwYXJ0ID09IDApIHtcclxuXHRcdFx0XHR0cGFydHM9XCJTV0lNXCI7XHJcblx0XHRcdFx0dGFyZ2V0S009dGhpcy50cmFjay5iaWtlU3RhcnRLTTtcclxuXHRcdFx0XHRwYXJ0U3RhcnQ9MDtcclxuXHRcdFx0XHR0cGFydE1vcmU9XCJTV0lNXCI7XHJcblx0XHRcdH0gZWxzZSBpZiAodHBhcnQgPT0gMSkge1xyXG5cdFx0XHRcdHRwYXJ0cz1cIkJJS0VcIjtcclxuXHRcdFx0XHR0YXJnZXRLTT10aGlzLnRyYWNrLnJ1blN0YXJ0S007XHJcblx0XHRcdFx0cGFydFN0YXJ0PXRoaXMudHJhY2suYmlrZVN0YXJ0S007XHJcblx0XHRcdFx0dHBhcnRNb3JlPVwiUklERVwiO1xyXG5cdFx0XHR9IGVsc2UgaWYgKHRwYXJ0ID09IDIpIHsgXHJcblx0XHRcdFx0dHBhcnRzPVwiUlVOXCI7XHJcblx0XHRcdFx0dGFyZ2V0S009dGxlbi8xMDAwLjA7XHJcblx0XHRcdFx0cGFydFN0YXJ0PXRoaXMudHJhY2sucnVuU3RhcnRLTTtcclxuXHRcdFx0XHR0cGFydE1vcmU9XCJSVU5cIjtcclxuXHRcdFx0fVxyXG5cdFx0XHR2YXIgaHRtbD1cIjxkaXYgY2xhc3M9J3BvcHVwX2NvZGUnIHN0eWxlPSdjb2xvcjpyZ2JhKFwiK2NvbG9yQWxwaGFBcnJheSh0aGlzLmdldENvbG9yKCksMC45KS5qb2luKFwiLFwiKStcIiknPlwiK2VzY2FwZUhUTUwodGhpcy5nZXRDb2RlKCkpK1wiICgxKTwvZGl2PlwiO1xyXG5cdFx0XHR2YXIgZnJlcSA9IE1hdGgucm91bmQodGhpcy5nZXRGcmVxKCkpO1xyXG5cdFx0XHRpZiAoZnJlcSA+IDApIHtcclxuXHRcdFx0XHRodG1sKz1cIjxkaXYgY2xhc3NcIiArXHJcblx0XHRcdFx0XHRcdFwiPSdwb3B1cF9mcmVxJz5cIitmcmVxK1wiPC9kaXY+XCI7XHJcblx0XHRcdH1cclxuXHRcdFx0dmFyIGVsa20gPSBlbGFwc2VkKnRsZW4vMTAwMC4wO1xyXG5cdFx0XHR2YXIgZWxrbXMgPSBwYXJzZUZsb2F0KE1hdGgucm91bmQoZWxrbSAqIDEwMCkgLyAxMDApLnRvRml4ZWQoMik7XHRcdFx0XHJcblxyXG5cdFx0XHQvKnZhciByZWttID0gZWxhcHNlZCUxLjA7XHJcblx0XHRcdHJla209KDEuMC1yZWttKSp0bGVuLzEwMDAuMDtcclxuXHRcdFx0cmVrbSA9IHBhcnNlRmxvYXQoTWF0aC5yb3VuZChyZWttICogMTAwKSAvIDEwMCkudG9GaXhlZCgyKTsqL1x0XHRcdFxyXG5cdFx0XHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0XHRcdHZhciBlc3RmPW51bGw7XHJcblx0XHRcdHZhciBldHh0MT1udWxsO1xyXG5cdFx0XHR2YXIgZXR4dDI9bnVsbDtcclxuXHRcdFx0dmFyIGxzdGF0ZSA9IG51bGw7IFxyXG5cdFx0XHRpZiAodGhpcy5zdGF0ZXMubGVuZ3RoKSBcclxuXHRcdFx0e1xyXG5cdFx0XHRcdGxzdGF0ZSA9IHRoaXMuc3RhdGVzW3RoaXMuc3RhdGVzLmxlbmd0aC0xXTtcclxuXHRcdFx0XHRpZiAobHN0YXRlLmdldFNwZWVkKCkgPiAwKSBcclxuXHRcdFx0XHR7XHJcblx0XHRcdFx0XHR2YXIgc3BtcyA9IE1hdGguY2VpbChsc3RhdGUuZ2V0U3BlZWQoKSAqIDEwMCkgLyAxMDA7XHJcblx0XHRcdFx0XHRzcG1zLz0xMDAwLjA7XHJcblx0XHRcdFx0XHRzcG1zKj02MCo2MDtcclxuXHRcdFx0XHRcdGV0eHQxPXBhcnNlRmxvYXQoc3BtcykudG9GaXhlZCgyKStcIiBrbS9oXCI7XHJcblx0XHRcdFx0XHR2YXIgcm90ID0gLXRoaXMuZ2V0Um90YXRpb24oKSoxODAvTWF0aC5QSTsgXHJcblx0XHRcdFx0XHRpZiAocm90IDwgMClcclxuXHRcdFx0XHRcdFx0cm90Kz0zNjA7XHJcblx0XHRcdFx0XHRpZiAocm90ICE9IG51bGwpIFxyXG5cdFx0XHRcdFx0e1xyXG5cdFx0XHRcdFx0XHRpZiAocm90IDw9IDApIFxyXG5cdFx0XHRcdFx0XHRcdGV0eHQxKz1cIiBFXCI7XHJcblx0XHRcdFx0XHRcdGVsc2UgaWYgKHJvdCA8PSA0NSlcclxuXHRcdFx0XHRcdFx0XHRldHh0MSs9XCIgU0VcIjtcclxuXHRcdFx0XHRcdFx0ZWxzZSBpZiAocm90IDw9IDkwKVxyXG5cdFx0XHRcdFx0XHRcdGV0eHQxKz1cIiBTXCI7XHJcblx0XHRcdFx0XHRcdGVsc2UgaWYgKHJvdCA8PSAxMzUpXHJcblx0XHRcdFx0XHRcdFx0ZXR4dDErPVwiIFNXXCI7XHJcblx0XHRcdFx0XHRcdGVsc2UgaWYgKHJvdCA8PSAxODApXHJcblx0XHRcdFx0XHRcdFx0ZXR4dDErPVwiIFdcIjtcclxuXHRcdFx0XHRcdFx0ZWxzZSBpZiAocm90IDw9IDIyNSlcclxuXHRcdFx0XHRcdFx0XHRldHh0MSs9XCIgTldcIjtcclxuXHRcdFx0XHRcdFx0ZWxzZSBpZiAocm90IDw9IDI3MClcclxuXHRcdFx0XHRcdFx0XHRldHh0MSs9XCIgTlwiO1xyXG5cdFx0XHRcdFx0XHRlbHNlIFxyXG5cdFx0XHRcdFx0XHRcdGV0eHQxKz1cIiBORVwiO1xyXG5cdFx0XHRcdFx0fVxyXG5cdFx0XHRcdFx0ZXN0Zj1VdGlscy5mb3JtYXRUaW1lKG5ldyBEYXRlKCBjdGltZSArIHRhcmdldEtNKjEwMDAgLyBzcG1zKjEwMDAgKSk7ICBcclxuXHRcdFx0XHR9XHJcblx0XHRcdFx0aWYgKGxzdGF0ZS5nZXRBY2NlbGVyYXRpb24oKSA+IDApXHJcblx0XHRcdFx0XHRldHh0Mj1wYXJzZUZsb2F0KE1hdGguY2VpbChsc3RhdGUuZ2V0QWNjZWxlcmF0aW9uKCkgKiAxMDApIC8gMTAwKS50b0ZpeGVkKDIpK1wiIG0vczJcIjtcclxuXHRcdFx0fVxyXG5cdFx0XHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRcdFx0dmFyIHAxID0gMTAwKnRoaXMudHJhY2suYmlrZVN0YXJ0S00vKHRsZW4vMTAwMC4wKTtcclxuXHRcdFx0dmFyIHAyID0gMTAwKih0aGlzLnRyYWNrLnJ1blN0YXJ0S00tdGhpcy50cmFjay5iaWtlU3RhcnRLTSkvKHRsZW4vMTAwMC4wKTtcclxuXHRcdFx0dmFyIHAzID0gMTAwKih0bGVuLzEwMDAuMCAtIHRoaXMudHJhY2sucnVuU3RhcnRLTSkvKHRsZW4vMTAwMC4wKTtcclxuXHRcdFx0dmFyIHByZXR0eUNvb3JkPVxyXG5cdFx0XHRcdFwiPGRpdiBzdHlsZT0nb3BhY2l0eTowLjc7ZmxvYXQ6bGVmdDtvdmVyZmxvdzpoaWRkZW47aGVpZ2h0OjdweDt3aWR0aDpcIitwMStcIiU7YmFja2dyb3VuZC1jb2xvcjpcIitDT05GSUcuYXBwZWFyYW5jZS50cmFja0NvbG9yU3dpbStcIicvPlwiK1xyXG5cdFx0XHRcdFwiPGRpdiBzdHlsZT0nb3BhY2l0eTowLjc7ZmxvYXQ6bGVmdDtvdmVyZmxvdzpoaWRkZW47aGVpZ2h0OjdweDt3aWR0aDpcIitwMitcIiU7YmFja2dyb3VuZC1jb2xvcjpcIitDT05GSUcuYXBwZWFyYW5jZS50cmFja0NvbG9yQmlrZStcIicvPlwiK1xyXG5cdFx0XHRcdFwiPGRpdiBzdHlsZT0nb3BhY2l0eTowLjc7ZmxvYXQ6bGVmdDtvdmVyZmxvdzpoaWRkZW47aGVpZ2h0OjdweDt3aWR0aDpcIitwMytcIiU7YmFja2dyb3VuZC1jb2xvcjpcIitDT05GSUcuYXBwZWFyYW5jZS50cmFja0NvbG9yUnVuK1wiJy8+XCJcclxuXHRcdFx0XHQ7IC8vb2wuY29vcmRpbmF0ZS50b1N0cmluZ0hETVModGhpcy5nZXRQb3NpdGlvbigpLCAyKTtcclxuXHJcblx0XHRcdHZhciBpbWdkaXY7XHJcblx0XHRcdGlmICh0cGFydCA9PSAwKVxyXG5cdFx0XHRcdGltZ2Rpdj1cIjxpbWcgY2xhc3M9J3BvcHVwX3RyYWNrX21vZGUnIHN0eWxlPSdsZWZ0OlwiK2VsYXBzZWQqMTAwK1wiJScgc3JjPSdpbWcvc3dpbS5zdmcnLz5cIlxyXG5cdFx0XHRlbHNlIGlmICh0cGFydCA9PSAxKVxyXG5cdFx0XHRcdGltZ2Rpdj1cIjxpbWcgY2xhc3M9J3BvcHVwX3RyYWNrX21vZGUnIHN0eWxlPSdsZWZ0OlwiK2VsYXBzZWQqMTAwK1wiJScgc3JjPSdpbWcvYmlrZS5zdmcnLz5cIlxyXG5cdFx0XHRlbHNlIC8qaWYgKHRwYXJ0ID09IDIpKi9cclxuXHRcdFx0XHRpbWdkaXY9XCI8aW1nIGNsYXNzPSdwb3B1cF90cmFja19tb2RlJyBzdHlsZT0nbGVmdDpcIitlbGFwc2VkKjEwMCtcIiUnIHNyYz0naW1nL3J1bi5zdmcnLz5cIlxyXG5cdFxyXG5cclxuXHRcdFx0dmFyIHBhc3MgPSBNYXRoLnJvdW5kKChuZXcgRGF0ZSgpKS5nZXRUaW1lKCkvMzUwMCkgJSAzO1xyXG5cdFx0XHRodG1sKz1cIjx0YWJsZSBjbGFzcz0ncG9wdXBfdGFibGUnIHN0eWxlPSdiYWNrZ3JvdW5kLWltYWdlOnVybChcXFwiXCIrdGhpcy5nZXRJbWFnZSgpK1wiXFxcIiknPlwiO1xyXG5cdFx0XHR2YXIgaXNEdW1teT0hKGVsYXBzZWQgPiAwKTtcclxuXHRcdFx0aHRtbCs9XCI8dHI+PHRkIGNsYXNzPSdsYmwnPkVsYXBzZWQ8L3RkPjx0ZCBjbGFzcz0ndmFsdWUnPlwiKyhpc0R1bW15ID8gXCItXCIgOiBlbGttcytcIiBrbVwiKStcIjwvdGQ+PC90cj5cIjtcclxuXHRcdFx0aHRtbCs9XCI8dHI+PHRkIGNsYXNzPSdsYmwnPk1vcmUgdG8gXCIrdHBhcnRNb3JlK1wiPC90ZD48dGQgY2xhc3M9J3ZhbHVlJz5cIisoaXNEdW1teSA/IFwiLVwiIDogcGFyc2VGbG9hdChNYXRoLnJvdW5kKCh0YXJnZXRLTS1lbGttKSAqIDEwMCkgLyAxMDApLnRvRml4ZWQoMikgLyogcmVrbSAqLyArXCIga21cIikrXCI8L3RkPjwvdHI+XCI7XHJcblx0XHRcdGh0bWwrPVwiPHRyPjx0ZCBjbGFzcz0nbGJsJz5GaW5pc2ggXCIrIHRwYXJ0cy50b0xvd2VyQ2FzZSgpICtcIjwvdGQ+PHRkIGNsYXNzPSd2YWx1ZSc+XCIrKCFlc3RmID8gXCItXCIgOiBlc3RmKStcIjwvdGQ+PC90cj5cIjtcdFx0XHRcdFx0XHJcblx0XHRcdGh0bWwrPVwiPHRyPjx0ZCBjbGFzcz0nbGJsJz5TcGVlZDwvdGQ+PHRkIGNsYXNzPSd2YWx1ZSc+XCIrKCFpc0R1bW15ICYmIGV0eHQxID8gZXR4dDEgOiBcIi1cIikgKyBcIjwvdGQ+PC90cj5cIjtcclxuXHRcdFx0aHRtbCs9XCI8dHI+PHRkIGNsYXNzPSdsYmwnPkFjY2VsZXIuPC90ZD48dGQgY2xhc3M9J3ZhbHVlJz5cIisoIWlzRHVtbXkgJiYgZXR4dDIgPyBldHh0MiA6IFwiLVwiKSArXCI8L3RkPjwvdHI+XCI7XHJcblx0XHRcdGh0bWwrPVwiPHRyIHN0eWxlPSdoZWlnaHQ6MTAwJSc+PHRkPiZuYnNwOzwvdGQ+PHRkPiZuYnNwOzwvdGQ+PC90cj5cIjtcclxuXHRcdFx0aHRtbCtcIjwvdGFibGU+XCJcclxuXHRcdFx0Ly9odG1sKz1cIjxkaXYgY2xhc3M9J3BvcHVwX3NoYWRvdyc+XCIrcHJldHR5Q29vcmQraW1nZGl2K1wiPC9kaXY+XCI7XHJcblx0XHRcdFxyXG5cdFx0XHR2YXIgcmFuaz1cIi1cIjtcclxuXHRcdFx0aWYgKHRoaXMuX19wb3MgIT0gdW5kZWZpbmVkKVxyXG5cdFx0XHRcdHJhbms9dGhpcy5fX3BvcyArIDE7ICAgLy8gdGhlIGZpcnN0IHBvcyAtIHRoZSBGQVNURVNUIGlzIDBcclxuXHRcdFx0XHJcblx0XHRcdFxyXG5cdFx0XHRodG1sPVwiPGRpdiBjbGFzcz0ncG9wdXBfY29udGVudF9wcmcnPjxkaXYgc3R5bGU9J3dpZHRoOlwiK3AxK1wiJTtoZWlnaHQ6NnB4O2JhY2tncm91bmQtY29sb3I6XCIrQ09ORklHLmFwcGVhcmFuY2UudHJhY2tDb2xvclN3aW0rXCI7ZmxvYXQ6bGVmdDsnPjwvZGl2PjxkaXYgc3R5bGU9J3dpZHRoOlwiK3AyK1wiJTtoZWlnaHQ6NnB4O2JhY2tncm91bmQtY29sb3I6XCIrQ09ORklHLmFwcGVhcmFuY2UudHJhY2tDb2xvckJpa2UrXCI7ZmxvYXQ6bGVmdDsnPjwvZGl2PjxkaXYgc3R5bGU9J3dpZHRoOlwiK3AzK1wiJTtoZWlnaHQ6NnB4O2JhY2tncm91bmQtY29sb3I6XCIrQ09ORklHLmFwcGVhcmFuY2UudHJhY2tDb2xvclJ1bitcIjtmbG9hdDpsZWZ0Oyc+PC9kaXY+XCI7XHJcblx0XHRcdGh0bWwrPVwiPGRpdiBjbGFzcz0ncG9wdXBfdHJhY2tfcG9zJz48ZGl2IGNsYXNzPSdwb3B1cF90cmFja19wb3NfMScgc3R5bGU9J2xlZnQ6XCIrKGVsYXBzZWQqOTApK1wiJSc+PC9kaXY+PC9kaXY+XCI7XHJcblx0XHRcdGh0bWwrPVwiPC9kaXY+XCI7XHJcblx0XHRcdGh0bWwrPVwiPGltZyBjbGFzcz0ncG9wdXBfY29udGVudF9pbWcnIHNyYz0nXCIrdGhpcy5nZXRJbWFnZSgpK1wiJy8+XCI7XHJcblx0XHRcdGh0bWwrPVwiPGRpdiBjbGFzcz0ncG9wdXBfY29udGVudF8xJz5cIjtcclxuXHRcdFx0aHRtbCs9XCI8ZGl2IGNsYXNzPSdwb3B1cF9jb250ZW50X25hbWUnPlwiK2VzY2FwZUhUTUwodGhpcy5nZXRDb2RlKCkpK1wiPC9kaXY+XCI7XHJcblx0XHRcdGh0bWwrPVwiPGRpdiBjbGFzcz0ncG9wdXBfY29udGVudF9sMSc+XCIrdGhpcy5nZXRDb3VudHJ5KCkuc3Vic3RyaW5nKDAsMykudG9VcHBlckNhc2UoKStcIiB8IFBvczogXCIrcmFuaytcIiB8IFNwZWVkOiBcIisoIWlzRHVtbXkgJiYgZXR4dDEgPyBldHh0MSA6IFwiLVwiKStcIjwvZGl2PlwiO1xyXG5cdFx0XHR2YXIgcGFzcyA9IE1hdGgucm91bmQoKChuZXcgRGF0ZSgpKS5nZXRUaW1lKCkgLyAxMDAwIC8gNCkpJTI7XHJcblx0XHRcdGlmIChwYXNzID09IDApIHtcclxuXHRcdFx0XHRpZiAodGhpcy5fX3BvcyAhPSB1bmRlZmluZWQpIFxyXG5cdFx0XHRcdHtcclxuXHRcdFx0XHRcdHBhcnNlRmxvYXQoTWF0aC5yb3VuZChlbGttICogMTAwKSAvIDEwMCkudG9GaXhlZCgyKTtcclxuXHJcblx0XHRcdFx0XHQvLyB0aGlzLl9fbmV4dCBpcyB0aGUgcGFydGljaXBhbnQgYmVoaW5kIHRoaXMgb25lIChlLmcgdGhlIHNsb3dlciBvbmUgd2l0aCBsZXN0IGVsYXBzZWQgaW5kZXgpXHJcblx0XHRcdFx0XHQvLyBhbmQgdGhpcy5fX3ByZXYgaXMgdGhlIG9uZSBiZWZvcmUgdXNcclxuXHRcdFx0XHRcdC8vIHNvIGlmIHBhcnRpY2lwYW50IGlzIGluIHBvc2l0aW9uIDMgdGhlIG9uZSBiZWZvcmUgaGltIHdpbGwgYmUgMiBhbmQgdGhlIG9uZSBiZWhpbmQgaGltIHdpbGwgYmUgNFxyXG5cdFx0XHRcdFx0Ly8gKGUuZy4gXCJ0aGlzLl9fcG9zID09IDNcIiA9PiB0aGlzLl9fcHJldi5fX3BvcyA9PSAyIGFuZCB0aGlzLl9fcHJldi5fX25leHQgPT0gNFxyXG5cdFx0XHRcdFx0Ly8gZm9yIHRoZVxyXG5cclxuXHRcdFx0XHRcdGlmICh0aGlzLl9fcHJldiAmJiB0aGlzLl9fcHJldi5fX3BvcyAhPSB1bmRlZmluZWQgJiYgdGhpcy5nZXRTcGVlZCgpKSB7XHJcblx0XHRcdFx0XHRcdC8vIHdoYXQgaXMgdGhlIGRpZmZlcmVuY2UgYmV0d2VlbiBjdXJyZW50IG9uZSBhbmQgdGhlIG9uZSBiZWZvcmUgLSB3ZSB3aWxsIHJ1biBzbyBvdXIgc3BlZWRcclxuXHRcdFx0XHRcdFx0Ly8gd2hhdCB0aW1lIHdlIGFyZSBzaG9ydCAtIHNvIHdpbGwgYWRkIGEgbWludXMgaW4gZnJvbnQgb2YgdGhlIHRpbWVcclxuXHRcdFx0XHRcdFx0dmFyIGVsYXBzZWRwcmV2ID0gdGhpcy5fX3ByZXYuY2FsY3VsYXRlRWxhcHNlZEF2ZXJhZ2UoY3RpbWUpO1xyXG5cdFx0XHRcdFx0XHR2YXIgZHByZXYgPSAoKGVsYXBzZWRwcmV2IC0gZWxhcHNlZCkqdGhpcy50cmFjay5nZXRUcmFja0xlbmd0aCgpIC8gdGhpcy5nZXRTcGVlZCgpKS82MC4wO1xyXG5cdFx0XHRcdFx0XHRkcHJldiA9IHBhcnNlRmxvYXQoTWF0aC5yb3VuZChkcHJldiAqIDEwMCkgLyAxMDApLnRvRml4ZWQoMik7XHJcblx0XHRcdFx0XHRcdGh0bWwrPVwiPGRpdiBjbGFzcz0ncG9wdXBfY29udGVudF9sMic+R0FQIFBcIisodGhpcy5fX3ByZXYuX19wb3MgKyAxKStcIiA6IC1cIitkcHJlditcIiBNaW48L2Rpdj5cIjtcclxuXHRcdFx0XHRcdH0gZWxzZSB7XHJcblx0XHRcdFx0XHRcdGh0bWwrPVwiPGRpdiBjbGFzcz0ncG9wdXBfY29udGVudF9sMic+Jm5ic3A7PC9kaXY+XCI7XHJcblx0XHRcdFx0XHR9XHJcblxyXG5cdFx0XHRcdFx0aWYgKHRoaXMuX19uZXh0ICYmIHRoaXMuX19uZXh0Ll9fcG9zICE9IHVuZGVmaW5lZCAmJiB0aGlzLl9fbmV4dC5nZXRTcGVlZCgpKSB7XHJcblx0XHRcdFx0XHRcdC8vIHdoYXQgaXMgdGhlIGRpZmZlcmVuY2UgYmV0d2VlbiBjdXJyZW50IG9uZSBhbmQgdGhlIG9uZSBiZWhpbmQgLSB0aGlzIG90aGVyIG9uZSB3aWxsIHJ1biBzbyBoaXMgc3BlZWRcclxuXHRcdFx0XHRcdFx0Ly8gd2FodCB0aW1lIHdlIGFyZSBhaGVhZCAtIHNvIGEgcG9zaXRpdmUgdGltZVxyXG5cdFx0XHRcdFx0XHR2YXIgZWxhcHNlZG5leHQgPSB0aGlzLl9fbmV4dC5jYWxjdWxhdGVFbGFwc2VkQXZlcmFnZShjdGltZSk7XHJcblx0XHRcdFx0XHRcdHZhciBkbmV4dCA9ICgoZWxhcHNlZCAtIGVsYXBzZWRuZXh0KSp0aGlzLnRyYWNrLmdldFRyYWNrTGVuZ3RoKCkgLyB0aGlzLl9fbmV4dC5nZXRTcGVlZCgpKS82MC4wO1xyXG5cdFx0XHRcdFx0XHRkbmV4dCA9IHBhcnNlRmxvYXQoTWF0aC5yb3VuZChkbmV4dCAqIDEwMCkgLyAxMDApLnRvRml4ZWQoMik7XHJcblx0XHRcdFx0XHRcdGh0bWwrPVwiPGRpdiBjbGFzcz0ncG9wdXBfY29udGVudF9sMyc+R0FQIFBcIisodGhpcy5fX25leHQuX19wb3MgKyAxKStcIiA6IFwiK2RuZXh0K1wiIE1pbjwvZGl2PlwiO1xyXG5cdFx0XHRcdFx0fSBlbHNlIHtcclxuXHRcdFx0XHRcdFx0aHRtbCs9XCI8ZGl2IGNsYXNzPSdwb3B1cF9jb250ZW50X2wyJz4mbmJzcDs8L2Rpdj5cIjtcclxuXHRcdFx0XHRcdH1cclxuXHRcdFx0XHR9XHJcblx0XHRcdH0gZWxzZSB7XHJcblx0XHRcdFx0aHRtbCs9XCI8ZGl2IGNsYXNzPSdwb3B1cF9jb250ZW50X2wyJz5NT1JFIFRPICBcIit0cGFydE1vcmUrXCI6IFwiKyhpc0R1bW15ID8gXCItXCIgOiBwYXJzZUZsb2F0KE1hdGgucm91bmQoKHRhcmdldEtNLWVsa20pICogMTAwKSAvIDEwMCkudG9GaXhlZCgyKSAvKiByZWttICovICtcIiBrbVwiKStcIjwvZGl2PlwiO1xyXG5cdFx0XHRcdGh0bWwrPVwiPGRpdiBjbGFzcz0ncG9wdXBfY29udGVudF9sMyc+RklOSVNIIFwiKyB0cGFydHMgK1wiOiBcIisoIWVzdGYgPyBcIi1cIiA6IGVzdGYpK1wiPC9kaXY+XCI7XHJcblx0XHRcdH1cclxuXHRcdFx0aHRtbCs9XCI8L2Rpdj5cIjtcclxuXHRcdFx0cmV0dXJuIGh0bWw7XHJcblx0XHR9XHJcblx0XHRcclxuXHRcdFxyXG4gICAgfVxyXG59KTtcclxuIiwicmVxdWlyZSgnam9vc2UnKTtcclxuXHJcbkNsYXNzKFwiUG9pbnRcIiwge1xyXG4gICAgLy8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG4gICAgLy8gQUxMIENPT1JESU5BVEVTIEFSRSBJTiBXT1JMRCBNRVJDQVRPUlxyXG4gICAgLy8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cclxuICAgIGhhcyA6IHtcclxuICAgICAgICBjb2RlIDoge1xyXG4gICAgICAgICAgICBpcyA6IFwicndcIixcclxuICAgICAgICAgICAgaW5pdCA6IFwiQ09ERV9OT1RfU0VUXCJcclxuICAgICAgICB9LFxyXG4gICAgICAgIGlkIDoge1xyXG4gICAgICAgICAgICBpcyA6IFwicndcIixcclxuICAgICAgICAgICAgaW5pdCA6IFwiSURfTk9UX1NFVFwiXHJcbiAgICAgICAgfSxcclxuICAgICAgICBmZWF0dXJlIDoge1xyXG4gICAgICAgICAgICBpcyA6IFwicndcIixcclxuICAgICAgICAgICAgaW5pdCA6IG51bGxcclxuICAgICAgICB9LFxyXG4gICAgICAgIHBvc2l0aW9uIDoge1xyXG4gICAgICAgICAgICBpczogICBcInJ3XCIsXHJcbiAgICAgICAgICAgIGluaXQ6IFswLDBdXHQvL2xvbiBsYXQgd29ybGQgbWVyY2F0b3JcclxuICAgICAgICB9XHJcbiAgICB9LFxyXG5cclxuICAgIG1ldGhvZHMgOiB7XHJcbiAgICAgICAgaW5pdCA6IGZ1bmN0aW9uKHBvcykge1xyXG4gICAgICAgICAgICBpZiAodHlwZW9mIG9sICE9IFwidW5kZWZpbmVkXCIpIHtcclxuICAgICAgICAgICAgICAgIHZhciBnZW9tID0gbmV3IG9sLmdlb20uUG9pbnQocG9zKTtcclxuICAgICAgICAgICAgICAgIGdlb20udHJhbnNmb3JtKCdFUFNHOjQzMjYnLCAnRVBTRzozODU3Jyk7XHJcbiAgICAgICAgICAgICAgICB2YXIgZmVhdHVyZSA9IG5ldyBvbC5GZWF0dXJlKCk7XHJcbiAgICAgICAgICAgICAgICBmZWF0dXJlLnNldEdlb21ldHJ5KGdlb20pO1xyXG4gICAgICAgICAgICAgICAgdGhpcy5zZXRGZWF0dXJlKGZlYXR1cmUpO1xyXG5cclxuICAgICAgICAgICAgICAgIHRoaXMuc2V0UG9zaXRpb24ocG9zKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgIH1cclxufSk7IiwidmFyIENPTkZJRyA9IHJlcXVpcmUoJy4vQ29uZmlnJyk7XHJcblxyXG52YXIgU1RZTEVTPVxyXG57XHJcblx0Ly8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHQvLyBzdHlsZSBmdW5jdGlvbiBmb3IgdHJhY2tcclxuXHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdFx0XHJcblx0XCJfdHJhY2tcIjogZnVuY3Rpb24oZmVhdHVyZSxyZXNvbHV0aW9uKSBcclxuXHR7XHJcbiAgICAgICAgcmV0dXJuIFtcclxuICAgICAgICBdO1xyXG5cdH0sXHJcblxyXG5cdFwidGVzdFwiOiBmdW5jdGlvbihmZWF0dXJlLHJlc29sdXRpb24pIFxyXG5cdHtcclxuXHRcdHZhciBzdHlsZXM9W107XHJcbiAgICAgICAgc3R5bGVzLnB1c2gobmV3IG9sLnN0eWxlLlN0eWxlKHtcclxuICAgICAgICAgICAgaW1hZ2U6IG5ldyBvbC5zdHlsZS5DaXJjbGUoe1xyXG4gICAgICAgICAgICAgICAgcmFkaXVzOiAxNyxcclxuICAgICAgICAgICAgICAgIGZpbGw6IG5ldyBvbC5zdHlsZS5GaWxsKHtcclxuICAgICAgICAgICAgICAgICAgICBjb2xvcjogXCJyZ2JhKFwiICsgY29sb3JBbHBoYUFycmF5KHBhcnQuY29sb3IsIDAuMTUpLmpvaW4oXCIsXCIpICsgXCIpXCJcclxuICAgICAgICAgICAgICAgIH0pLFxyXG4gICAgICAgICAgICAgICAgc3Ryb2tlOiBuZXcgb2wuc3R5bGUuU3Ryb2tlKHtcclxuICAgICAgICAgICAgICAgICAgICBjb2xvcjogXCJyZ2JhKDI1NSwyNTUsMjU1LDAuNSlcIixcclxuICAgICAgICAgICAgICAgICAgICB3aWR0aDogM1xyXG4gICAgICAgICAgICAgICAgfSlcclxuICAgICAgICAgICAgfSlcclxuICAgICAgICB9KSk7XHJcbiAgICAgICAgcmV0dXJuIHN0eWxlcztcclxuXHR9LFxyXG5cclxuXHRcInRlc3QxXCI6IGZ1bmN0aW9uKGZlYXR1cmUscmVzb2x1dGlvbikgXHJcblx0e1xyXG5cdFx0dmFyIHN0eWxlcz1bXTtcclxuICAgICAgICBzdHlsZXMucHVzaChuZXcgb2wuc3R5bGUuU3R5bGUoe1xyXG4gICAgICAgICAgICAgc3Ryb2tlOiBuZXcgb2wuc3R5bGUuU3Ryb2tlKHtcclxuICAgICAgICAgICAgICAgICBjb2xvcjogXCJyZ2JhKDAsMCwwLDAuNClcIixcclxuICAgICAgICAgICAgICAgICB3aWR0aDogM1xyXG4gICAgICAgICAgICAgfSksXHJcblx0ICAgICAgICAgZmlsbDogbmV3IG9sLnN0eWxlLkZpbGwoe1xyXG5cdCAgICAgICAgICAgIGNvbG9yOiBcInJnYmEoNDAsMjU1LDQwLDAuMilcIlxyXG5cdCAgICAgICAgIH0pLFxyXG4gICAgICAgIH0pKTtcclxuICAgICAgICByZXR1cm4gc3R5bGVzO1xyXG5cdH0sXHJcblx0XCJ0cmFja1wiIDogZnVuY3Rpb24oZmVhdHVyZSxyZXNvbHV0aW9uKSBcclxuXHR7XHJcblx0XHR2YXIgc3R5bGVzPVtdO1xyXG5cdFx0dmFyIHRyYWNrPWZlYXR1cmUudHJhY2s7XHJcblx0XHRpZiAoIXRyYWNrKSB7XHJcblx0XHRcdGNvbnNvbGUubG9nKFwiUmVuZGVyaW5nIHRyYWNrIGZlYXR1cmUgd2l0aG91dCB0cmFjayBvYmplY3QhXCIpO1xyXG5cdFx0XHRyZXR1cm4gc3R5bGVzO1xyXG5cdFx0fVxyXG5cdFx0dmFyIGNvb3Jkcz1mZWF0dXJlLmdldEdlb21ldHJ5KCkuZ2V0Q29vcmRpbmF0ZXMoKTtcclxuXHRcdHZhciBnZW9tc3dpbT1jb29yZHM7XHJcblx0XHR2YXIgZ2VvbWJpa2U7XHJcblx0XHR2YXIgZ2VvbXJ1bjtcclxuXHRcdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdFx0XHJcblx0XHQvKnZhciB3dyA9IDguMC9yZXNvbHV0aW9uO1xyXG5cdFx0aWYgKHd3IDwgNi4wKVxyXG5cdFx0XHR3dz02LjA7Ki9cclxuXHRcdHZhciB3dz0xMC4wO1xyXG5cclxuXHRcdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdFx0aWYgKHRyYWNrICYmICFpc05hTih0cmFjay5iaWtlU3RhcnRLTSkpIFxyXG5cdFx0e1xyXG5cdFx0XHRmb3IgKHZhciBpPTA7aTx0cmFjay5kaXN0YW5jZXMubGVuZ3RoO2krKykge1xyXG5cdFx0XHRcdGlmICh0cmFjay5kaXN0YW5jZXNbaV0gPj0gdHJhY2suYmlrZVN0YXJ0S00qMTAwMCkge1xyXG5cdFx0XHRcdFx0YnJlYWs7XHJcblx0XHRcdFx0fVxyXG5cdFx0XHR9XHJcblx0XHRcdHZhciBqO1xyXG5cdFx0XHRpZiAoIWlzTmFOKHRyYWNrLnJ1blN0YXJ0S00pKSB7XHJcblx0XHRcdFx0Zm9yIChqPWk7ajx0cmFjay5kaXN0YW5jZXMubGVuZ3RoO2orKykge1xyXG5cdFx0XHRcdFx0aWYgKHRyYWNrLmRpc3RhbmNlc1tqXSA+PSB0cmFjay5ydW5TdGFydEtNKjEwMDApXHJcblx0XHRcdFx0XHRcdGJyZWFrO1xyXG5cdFx0XHRcdH1cclxuXHRcdFx0fSBlbHNlIHtcclxuXHRcdFx0XHRqPXRyYWNrLmRpc3RhbmNlcy5sZW5ndGg7XHJcblx0XHRcdH1cclxuXHRcdFx0Z2VvbXN3aW09Y29vcmRzLnNsaWNlKDAsaSk7XHJcblx0XHRcdGdlb21iaWtlPWNvb3Jkcy5zbGljZShpIDwgMSA/IGkgOiBpLTEsaik7XHJcblx0XHRcdGlmIChqIDwgdHJhY2suZGlzdGFuY2VzLmxlbmd0aClcclxuXHRcdFx0XHRnZW9tcnVuPWNvb3Jkcy5zbGljZShqIDwgMSA/IGogOiBqLTEsdHJhY2suZGlzdGFuY2VzLmxlbmd0aCk7XHJcblx0XHRcdGlmICghZ2VvbXN3aW0gfHwgIWdlb21zd2ltLmxlbmd0aClcclxuXHRcdFx0XHRnZW9tc3dpbT1udWxsO1xyXG5cdFx0XHRpZiAoIWdlb21iaWtlIHx8ICFnZW9tYmlrZS5sZW5ndGgpXHJcblx0XHRcdFx0Z2VvbWJpa2U9bnVsbDtcclxuXHRcdFx0aWYgKCFnZW9tcnVuIHx8ICFnZW9tcnVuLmxlbmd0aClcclxuICAgICAgICAgICAgICAgIGdlb21ydW49bnVsbDtcclxuXHRcdH1cclxuXHJcblxyXG4gICAgICAgIGlmIChnZW9tc3dpbSAmJiBHVUkuaXNTaG93U3dpbSkge1xyXG4gICAgICAgICAgICBzdHlsZXMucHVzaChuZXcgb2wuc3R5bGUuU3R5bGUoe1xyXG4gICAgICAgICAgICAgICAgICAgIGdlb21ldHJ5OiBuZXcgb2wuZ2VvbS5MaW5lU3RyaW5nKGdlb21zd2ltKSxcclxuICAgICAgICAgICAgICAgICAgICBzdHJva2U6IG5ldyBvbC5zdHlsZS5TdHJva2Uoe1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb2xvcjogQ09ORklHLmFwcGVhcmFuY2UudHJhY2tDb2xvclN3aW0sXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHdpZHRoOiB3d1xyXG4gICAgICAgICAgICAgICAgICAgIH0pXHJcbiAgICAgICAgICAgICAgICB9KVxyXG4gICAgICAgICAgICApO1xyXG4gICAgICAgICAgICBTVFlMRVMuX2dlbkRpcmVjdGlvbihnZW9tc3dpbSwgd3csIHJlc29sdXRpb24sIENPTkZJRy5hcHBlYXJhbmNlLnRyYWNrQ29sb3JTd2ltLCBzdHlsZXMpO1xyXG5cclxuICAgICAgICAgICAgU1RZTEVTLl9nZW5EaXN0YW5jZUttKHd3LCByZXNvbHV0aW9uLCBjb29yZHMsIHRyYWNrLmRpc3RhbmNlcywgMCwgaSwgc3R5bGVzKTtcclxuXHJcblx0XHRcdC8vIGZvciBub3cgZG9uJ3Qgc2hvdyB0aGlzIGNoZWNrcG9pbnRcclxuXHRcdFx0Ly9pZiAoR1VJLmlzU2hvd1N3aW0pXHJcblx0XHRcdC8vXHRTVFlMRVMuX2dlbkNoZWNrcG9pbnQoZ2VvbXN3aW0sIENPTkZJRy5hcHBlYXJhbmNlLnRyYWNrQ29sb3JTd2ltLCBzdHlsZXMpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBpZiAoZ2VvbWJpa2UgJiYgR1VJLmlzU2hvd0Jpa2UpXHJcbiAgICAgICAge1xyXG4gICAgICAgICAgICBzdHlsZXMucHVzaChuZXcgb2wuc3R5bGUuU3R5bGUoe1xyXG4gICAgICAgICAgICAgICAgICAgIGdlb21ldHJ5OiBuZXcgb2wuZ2VvbS5MaW5lU3RyaW5nKGdlb21iaWtlKSxcclxuICAgICAgICAgICAgICAgICAgICBzdHJva2U6IG5ldyBvbC5zdHlsZS5TdHJva2Uoe1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb2xvcjogQ09ORklHLmFwcGVhcmFuY2UudHJhY2tDb2xvckJpa2UsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHdpZHRoOiB3d1xyXG4gICAgICAgICAgICAgICAgICAgIH0pXHJcbiAgICAgICAgICAgICAgICB9KVxyXG4gICAgICAgICAgICApO1xyXG4gICAgICAgICAgICBTVFlMRVMuX2dlbkRpcmVjdGlvbihnZW9tYmlrZSwgd3csIHJlc29sdXRpb24sIENPTkZJRy5hcHBlYXJhbmNlLnRyYWNrQ29sb3JCaWtlLCBzdHlsZXMpO1xyXG5cclxuICAgICAgICAgICAgU1RZTEVTLl9nZW5EaXN0YW5jZUttKHd3LCByZXNvbHV0aW9uLCBjb29yZHMsIHRyYWNrLmRpc3RhbmNlcywgaSwgaiwgc3R5bGVzKTtcclxuXHJcblx0XHRcdC8vIGFkZCBjaGVja3BvaW50IGlmIHRoaXMgaXMgbm90IGFscmVhZHkgYWRkZWQgYXMgYSBob3RzcG90XHJcblx0XHRcdGlmICghdHJhY2suaXNBZGRlZEhvdFNwb3RTd2ltQmlrZSkge1xyXG5cdFx0XHRcdGlmIChDT05GSUcuYXBwZWFyYW5jZS5pc1Nob3dJbWFnZUNoZWNrcG9pbnQpXHJcblx0XHRcdFx0XHRTVFlMRVMuX2dlbkNoZWNrcG9pbnRJbWFnZShnZW9tYmlrZSwgQ09ORklHLmFwcGVhcmFuY2UuaW1hZ2VDaGVja3BvaW50U3dpbUJpa2UsIHN0eWxlcyk7XHJcblx0XHRcdFx0ZWxzZSBpZiAoR1VJLmlzU2hvd0Jpa2UpXHJcblx0XHRcdFx0XHRTVFlMRVMuX2dlbkNoZWNrcG9pbnQoZ2VvbWJpa2UsIENPTkZJRy5hcHBlYXJhbmNlLnRyYWNrQ29sb3JCaWtlLCBzdHlsZXMpO1xyXG5cdFx0XHR9XHJcbiAgICAgICAgfVxyXG5cdFx0aWYgKGdlb21ydW4gJiYgR1VJLmlzU2hvd1J1bilcclxuXHRcdHtcclxuXHRcdFx0c3R5bGVzLnB1c2gobmV3IG9sLnN0eWxlLlN0eWxlKHtcclxuICAgICAgICAgICAgICAgICAgICBnZW9tZXRyeTogbmV3IG9sLmdlb20uTGluZVN0cmluZyhnZW9tcnVuKSxcclxuICAgICAgICAgICAgICAgICAgICBzdHJva2U6IG5ldyBvbC5zdHlsZS5TdHJva2Uoe1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb2xvcjogQ09ORklHLmFwcGVhcmFuY2UudHJhY2tDb2xvclJ1bixcclxuICAgICAgICAgICAgICAgICAgICAgICAgd2lkdGg6IHd3XHJcbiAgICAgICAgICAgICAgICAgICAgfSlcclxuICAgICAgICAgICAgICAgIH0pXHJcbiAgICAgICAgICAgICk7XHJcbiAgICAgICAgICAgIFNUWUxFUy5fZ2VuRGlyZWN0aW9uKGdlb21ydW4sIHd3LCByZXNvbHV0aW9uLCBDT05GSUcuYXBwZWFyYW5jZS50cmFja0NvbG9yUnVuLCBzdHlsZXMpO1xyXG5cclxuICAgICAgICAgICAgU1RZTEVTLl9nZW5EaXN0YW5jZUttKHd3LCByZXNvbHV0aW9uLCBjb29yZHMsIHRyYWNrLmRpc3RhbmNlcywgaiwgdHJhY2suZGlzdGFuY2VzLmxlbmd0aCwgc3R5bGVzKTtcclxuXHJcblx0XHRcdC8vIGFkZCBjaGVja3BvaW50IGlmIHRoaXMgaXMgbm90IGFscmVhZHkgYWRkZWQgYXMgYSBob3RzcG90XHJcblx0XHRcdGlmICghdHJhY2suaXNBZGRlZEhvdFNwb3RCaWtlUnVuKSB7XHJcblx0XHRcdFx0aWYgKENPTkZJRy5hcHBlYXJhbmNlLmlzU2hvd0ltYWdlQ2hlY2twb2ludClcclxuXHRcdFx0XHRcdFNUWUxFUy5fZ2VuQ2hlY2twb2ludEltYWdlKGdlb21ydW4sIENPTkZJRy5hcHBlYXJhbmNlLmltYWdlQ2hlY2twb2ludEJpa2VSdW4sIHN0eWxlcyk7XHJcblx0XHRcdFx0ZWxzZSBpZiAoR1VJLmlzU2hvd0Jpa2UpXHJcblx0XHRcdFx0XHRTVFlMRVMuX2dlbkNoZWNrcG9pbnQoZ2VvbXJ1biwgQ09ORklHLmFwcGVhcmFuY2UudHJhY2tDb2xvclJ1biwgc3R5bGVzKTtcclxuXHRcdFx0fVxyXG4gICAgICAgIH1cclxuXHJcblx0XHQvLyBTVEFSVC1GSU5JU0ggLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRcdGlmIChjb29yZHMgJiYgY29vcmRzLmxlbmd0aCA+PSAyKVxyXG5cdFx0e1xyXG5cdFx0XHR2YXIgc3RhcnQgPSBjb29yZHNbMF07XHJcblx0XHRcdHZhciBlbmQgPSBjb29yZHNbMV07XHJcblx0XHRcdC8qdmFyIGR4ID0gZW5kWzBdIC0gc3RhcnRbMF07XHJcblx0XHRcdCB2YXIgZHkgPSBlbmRbMV0gLSBzdGFydFsxXTtcclxuXHRcdFx0IHZhciByb3RhdGlvbiA9IE1hdGguYXRhbjIoZHksIGR4KTtcclxuXHRcdFx0IHN0eWxlcy5wdXNoKG5ldyBvbC5zdHlsZS5TdHlsZShcclxuXHRcdFx0IHtcclxuXHRcdFx0IGdlb21ldHJ5OiBuZXcgb2wuZ2VvbS5Qb2ludChzdGFydCksXHJcblx0XHRcdCBpbWFnZTogbmV3IG9sLnN0eWxlLkljb24oe1xyXG5cdFx0XHQgc3JjOiAnaW1nL2JlZ2luLWVuZC1hcnJvdy5wbmcnLFxyXG5cdFx0XHQgc2NhbGUgOiAwLjQ1LFxyXG5cdFx0XHQgYW5jaG9yOiBbMC4wLCAwLjVdLFxyXG5cdFx0XHQgcm90YXRlV2l0aFZpZXc6IHRydWUsXHJcblx0XHRcdCByb3RhdGlvbjogLXJvdGF0aW9uLFxyXG5cdFx0XHQgb3BhY2l0eSA6IDFcclxuXHRcdFx0IH0pXHJcblx0XHRcdCB9KSk7Ki9cclxuXHJcblx0XHRcdC8vIGxvb3A/XHJcblx0XHRcdGVuZCA9IGNvb3Jkc1tjb29yZHMubGVuZ3RoLTFdO1xyXG5cdFx0XHRpZiAoZW5kWzBdICE9IHN0YXJ0WzBdIHx8IGVuZFsxXSAhPSBzdGFydFsxXSlcclxuXHRcdFx0e1xyXG5cdFx0XHRcdHZhciBzdGFydCA9IGNvb3Jkc1tjb29yZHMubGVuZ3RoLTJdO1xyXG5cdFx0XHRcdHZhciBkeCA9IGVuZFswXSAtIHN0YXJ0WzBdO1xyXG5cdFx0XHRcdHZhciBkeSA9IGVuZFsxXSAtIHN0YXJ0WzFdO1xyXG5cdFx0XHRcdHZhciByb3RhdGlvbiA9IE1hdGguYXRhbjIoZHksIGR4KTtcclxuXHRcdFx0XHRzdHlsZXMucHVzaChuZXcgb2wuc3R5bGUuU3R5bGUoXHJcblx0XHRcdFx0XHR7XHJcblx0XHRcdFx0XHRcdGdlb21ldHJ5OiBuZXcgb2wuZ2VvbS5Qb2ludChlbmQpLFxyXG5cdFx0XHRcdFx0XHRpbWFnZTogbmV3IG9sLnN0eWxlLkljb24oe1xyXG5cdFx0XHRcdFx0XHRcdHNyYzogQ09ORklHLmFwcGVhcmFuY2UuaW1hZ2VGaW5pc2gsXHJcblx0XHRcdFx0XHRcdFx0c2NhbGUgOiAwLjQ1LFxyXG5cdFx0XHRcdFx0XHRcdGFuY2hvcjogWzAuNSwgMC41XSxcclxuXHRcdFx0XHRcdFx0XHRyb3RhdGVXaXRoVmlldzogdHJ1ZSxcclxuXHRcdFx0XHRcdFx0XHQvL3JvdGF0aW9uOiAtcm90YXRpb24sXHJcblx0XHRcdFx0XHRcdFx0b3BhY2l0eSA6IDFcclxuXHRcdFx0XHRcdFx0fSlcclxuXHRcdFx0XHRcdH0pKTtcclxuXHRcdFx0fVxyXG5cdFx0fVxyXG5cclxuXHRcdHJldHVybiBzdHlsZXM7XHJcblx0fSxcclxuXHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0XCJkZWJ1Z0dQU1wiIDogZnVuY3Rpb24oZmVhdHVyZSxyZXNvbHV0aW9uKSBcclxuXHR7XHJcblx0XHR2YXIgY29lZiA9ICgobmV3IERhdGUoKSkuZ2V0VGltZSgpLWZlYXR1cmUudGltZUNyZWF0ZWQpLyhDT05GSUcudGltZW91dHMuZ3BzTG9jYXRpb25EZWJ1Z1Nob3cqMTAwMCk7XHJcblx0XHRpZiAoY29lZiA+IDEpXHJcblx0XHRcdHJldHVybiBbXTtcclxuXHRcdHJldHVybiBbXHJcblx0XHQgICAgICAgIG5ldyBvbC5zdHlsZS5TdHlsZSh7XHJcblx0XHQgICAgICAgIGltYWdlOiBuZXcgb2wuc3R5bGUuQ2lyY2xlKHtcclxuXHRcdCAgICAgICAgICAgIHJhZGl1czogY29lZioyMCxcclxuXHRcdCAgICAgICAgICAgIHN0cm9rZTogbmV3IG9sLnN0eWxlLlN0cm9rZSh7XHJcblx0XHQgICAgICAgICAgICBcdC8vZmVhdHVyZS5jb2xvclxyXG5cdFx0ICAgICAgICAgICAgICAgIGNvbG9yOiBjb2xvckFscGhhQXJyYXkoZmVhdHVyZS5jb2xvciwoMS4wLWNvZWYpKjEuMCksIFxyXG5cdFx0ICAgICAgICAgICAgICAgIHdpZHRoOiA0XHJcblx0XHQgICAgICAgICAgICB9KVxyXG5cdFx0ICAgICAgICAgIH0pXHJcblx0XHR9KV07XHJcblx0fSxcclxuXHRcclxuXHRcInBhcnRpY2lwYW50XCIgOiBmdW5jdGlvbihmZWF0dXJlLHJlc29sdXRpb24pIFxyXG5cdHtcclxuXHRcdC8vIFNLSVAgRFJBVyAoVE9ETyBPUFRJTUlaRSlcclxuXHRcdHZhciBwYXJ0ID0gZmVhdHVyZS5wYXJ0aWNpcGFudDtcclxuXHRcdGlmICghcGFydC5pc0Zhdm9yaXRlKVxyXG5cdFx0XHRyZXR1cm4gW107XHJcblx0XHRcclxuXHRcdHZhciBldHh0PVwiXCI7XHJcblx0XHR2YXIgbHN0YXRlID0gbnVsbDtcclxuXHRcdGlmIChwYXJ0LnN0YXRlcy5sZW5ndGgpIHtcclxuXHRcdFx0bHN0YXRlID0gcGFydC5zdGF0ZXNbcGFydC5zdGF0ZXMubGVuZ3RoLTFdO1xyXG5cdFx0XHRldHh0PVwiIFwiK3BhcnNlRmxvYXQoTWF0aC5jZWlsKGxzdGF0ZS5nZXRTcGVlZCgpICogMTAwKSAvIDEwMCkudG9GaXhlZCgyKStcIiBtL3NcIjsvLyB8IGFjYyBcIitwYXJzZUZsb2F0KE1hdGguY2VpbChsc3RhdGUuZ2V0QWNjZWxlcmF0aW9uKCkgKiAxMDApIC8gMTAwKS50b0ZpeGVkKDIpK1wiIG0vc1wiO1xyXG5cdFx0fVxyXG5cdFx0dmFyIHpJbmRleCA9IE1hdGgucm91bmQocGFydC5nZXRFbGFwc2VkKCkqMTAwMDAwMCkqMTAwMCtwYXJ0LnNlcUlkO1xyXG5cdFx0LyppZiAocGFydCA9PSBHVUkuZ2V0U2VsZWN0ZWRQYXJ0aWNpcGFudCgpKSB7XHJcblx0XHRcdHpJbmRleD0xZTIwO1xyXG5cdFx0fSovXHJcblx0XHR2YXIgc3R5bGVzPVtdO1xyXG5cdFx0Ly8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdFx0dmFyIGN0aW1lID0gKG5ldyBEYXRlKCkpLmdldFRpbWUoKTtcclxuXHRcdHZhciBpc1RpbWUgPSAoY3RpbWUgPj0gQ09ORklHLnRpbWVzLmJlZ2luICYmIGN0aW1lIDw9IENPTkZJRy50aW1lcy5lbmQpO1xyXG5cdFx0dmFyIGlzRGlyZWN0aW9uID0gKGxzdGF0ZSAmJiBsc3RhdGUuZ2V0U3BlZWQoKSA+IDAgJiYgIXBhcnQuaXNTT1MgJiYgIXBhcnQuaXNEaXNjYXJkZWQgJiYgaXNUaW1lKTtcclxuXHRcdHZhciBhbmltRnJhbWUgPSAoY3RpbWUlMzAwMCkqTWF0aC5QSSoyLzMwMDAuMDtcclxuXHJcbiAgICAgICAgaWYgKGlzVGltZSkge1xyXG4gICAgICAgICAgICBzdHlsZXMucHVzaChuZXcgb2wuc3R5bGUuU3R5bGUoe1xyXG4gICAgICAgICAgICAgICAgekluZGV4OiB6SW5kZXgsXHJcbiAgICAgICAgICAgICAgICBpbWFnZTogbmV3IG9sLnN0eWxlLkNpcmNsZSh7XHJcbiAgICAgICAgICAgICAgICAgICAgcmFkaXVzOiAxNyxcclxuICAgICAgICAgICAgICAgICAgICBmaWxsOiBuZXcgb2wuc3R5bGUuRmlsbCh7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbG9yOiBwYXJ0LmlzRGlzY2FyZGVkIHx8IHBhcnQuaXNTT1MgPyBcInJnYmEoMTkyLDAsMCxcIiArIChNYXRoLnNpbihhbmltRnJhbWUpICogMC43ICsgMC4zKSArIFwiKVwiIDogXCJyZ2JhKFwiICsgY29sb3JBbHBoYUFycmF5KHBhcnQuY29sb3IsIDAuODUpLmpvaW4oXCIsXCIpICsgXCIpXCJcclxuICAgICAgICAgICAgICAgICAgICB9KSxcclxuICAgICAgICAgICAgICAgICAgICBzdHJva2U6IG5ldyBvbC5zdHlsZS5TdHJva2Uoe1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb2xvcjogcGFydC5pc0Rpc2NhcmRlZCB8fCBwYXJ0LmlzU09TID8gXCJyZ2JhKDI1NSwwLDAsXCIgKyAoMS4wIC0gKE1hdGguc2luKGFuaW1GcmFtZSkgKiAwLjcgKyAwLjMpKSArIFwiKVwiIDogXCIjZmZmZmZmXCIsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHdpZHRoOiAzXHJcbiAgICAgICAgICAgICAgICAgICAgfSlcclxuICAgICAgICAgICAgICAgIH0pLFxyXG4gICAgICAgICAgICAgICAgdGV4dDogbmV3IG9sLnN0eWxlLlRleHQoe1xyXG4gICAgICAgICAgICAgICAgICAgIGZvbnQ6ICdub3JtYWwgMTNweCBMYXRvLVJlZ3VsYXInLFxyXG4gICAgICAgICAgICAgICAgICAgIGZpbGw6IG5ldyBvbC5zdHlsZS5GaWxsKHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29sb3I6ICcjRkZGRkZGJ1xyXG4gICAgICAgICAgICAgICAgICAgIH0pLFxyXG4gICAgICAgICAgICAgICAgICAgIHRleHQ6IHBhcnQuZ2V0SW5pdGlhbHMoKSxcclxuICAgICAgICAgICAgICAgICAgICBvZmZzZXRYOiAwLFxyXG4gICAgICAgICAgICAgICAgICAgIG9mZnNldFk6IDBcclxuICAgICAgICAgICAgICAgIH0pXHJcbiAgICAgICAgICAgIH0pKTtcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICBzdHlsZXMucHVzaChuZXcgb2wuc3R5bGUuU3R5bGUoe1xyXG4gICAgICAgICAgICAgICAgekluZGV4OiB6SW5kZXgsXHJcbiAgICAgICAgICAgICAgICBpbWFnZTogbmV3IG9sLnN0eWxlLkNpcmNsZSh7XHJcbiAgICAgICAgICAgICAgICAgICAgcmFkaXVzOiAxNyxcclxuICAgICAgICAgICAgICAgICAgICBmaWxsOiBuZXcgb2wuc3R5bGUuRmlsbCh7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbG9yOiBcInJnYmEoXCIgKyBjb2xvckFscGhhQXJyYXkocGFydC5jb2xvciwgMC4zNSkuam9pbihcIixcIikgKyBcIilcIlxyXG4gICAgICAgICAgICAgICAgICAgIH0pLFxyXG4gICAgICAgICAgICAgICAgICAgIHN0cm9rZTogbmV3IG9sLnN0eWxlLlN0cm9rZSh7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbG9yOiBcInJnYmEoMjU1LDI1NSwyNTUsMSlcIixcclxuICAgICAgICAgICAgICAgICAgICAgICAgd2lkdGg6IDNcclxuICAgICAgICAgICAgICAgICAgICB9KVxyXG4gICAgICAgICAgICAgICAgfSksXHJcbiAgICAgICAgICAgICAgICB0ZXh0OiBuZXcgb2wuc3R5bGUuVGV4dCh7XHJcbiAgICAgICAgICAgICAgICAgICAgZm9udDogJ25vcm1hbCAxM3B4IExhdG8tUmVndWxhcicsXHJcbiAgICAgICAgICAgICAgICAgICAgZmlsbDogbmV3IG9sLnN0eWxlLkZpbGwoe1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb2xvcjogJyMwMDAwMDAnXHJcbiAgICAgICAgICAgICAgICAgICAgfSksXHJcbiAgICAgICAgICAgICAgICAgICAgdGV4dDogcGFydC5nZXREZXZpY2VJZCgpLFxyXG4gICAgICAgICAgICAgICAgICAgIG9mZnNldFg6IDAsXHJcbiAgICAgICAgICAgICAgICAgICAgb2Zmc2V0WTogMjBcclxuICAgICAgICAgICAgICAgIH0pXHJcbiAgICAgICAgICAgIH0pKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgLy8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG4gICAgICAgIHN0eWxlcy5wdXNoKG5ldyBvbC5zdHlsZS5TdHlsZSh7XHJcbiAgICAgICAgICAgIHpJbmRleDogekluZGV4LFxyXG4gICAgICAgICAgICBpbWFnZTogbmV3IG9sLnN0eWxlLkNpcmNsZSh7XHJcbiAgICAgICAgICAgICAgICByYWRpdXM6IDE3LFxyXG4gICAgICAgICAgICAgICAgZmlsbDogbmV3IG9sLnN0eWxlLkZpbGwoe1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbG9yOiBwYXJ0LmlzRGlzY2FyZGVkIHx8IHBhcnQuaXNTT1MgPyBcInJnYmEoMTkyLDAsMCxcIiArIChNYXRoLnNpbihhbmltRnJhbWUpICogMC43ICsgMC4zKSArIFwiKVwiIDogXCJyZ2JhKFwiICsgY29sb3JBbHBoYUFycmF5KHBhcnQuY29sb3IsIDAuODUpLmpvaW4oXCIsXCIpICsgXCIpXCJcclxuICAgICAgICAgICAgICAgIH0pLFxyXG4gICAgICAgICAgICAgICAgc3Ryb2tlOiBuZXcgb2wuc3R5bGUuU3Ryb2tlKHtcclxuICAgICAgICAgICAgICAgICAgICBjb2xvcjogcGFydC5pc0Rpc2NhcmRlZCB8fCBwYXJ0LmlzU09TID8gXCJyZ2JhKDI1NSwwLDAsXCIgKyAoMS4wIC0gKE1hdGguc2luKGFuaW1GcmFtZSkgKiAwLjcgKyAwLjMpKSArIFwiKVwiIDogXCIjZmZmZmZmXCIsXHJcbiAgICAgICAgICAgICAgICAgICAgd2lkdGg6IDNcclxuICAgICAgICAgICAgICAgIH0pXHJcbiAgICAgICAgICAgIH0pLFxyXG4gICAgICAgICAgICB0ZXh0OiBuZXcgb2wuc3R5bGUuVGV4dCh7XHJcbiAgICAgICAgICAgICAgICBmb250OiAnbm9ybWFsIDEzcHggTGF0by1SZWd1bGFyJyxcclxuICAgICAgICAgICAgICAgIGZpbGw6IG5ldyBvbC5zdHlsZS5GaWxsKHtcclxuICAgICAgICAgICAgICAgICAgICBjb2xvcjogJyNGRkZGRkYnXHJcbiAgICAgICAgICAgICAgICB9KSxcclxuICAgICAgICAgICAgICAgIHRleHQ6IHBhcnQuZ2V0SW5pdGlhbHMoKSxcclxuICAgICAgICAgICAgICAgIG9mZnNldFg6IDAsXHJcbiAgICAgICAgICAgICAgICBvZmZzZXRZOiAwXHJcbiAgICAgICAgICAgIH0pXHJcbiAgICAgICAgfSkpO1xyXG5cclxuXHJcbiAgICAgICAgaWYgKGlzRGlyZWN0aW9uICYmIHBhcnQuZ2V0Um90YXRpb24oKSAhPSBudWxsKVxyXG4gICAgICAgIHtcclxuICAgICAgICAgICAgc3R5bGVzLnB1c2gobmV3IG9sLnN0eWxlLlN0eWxlKHtcclxuICAgICAgICAgICAgICAgIHpJbmRleDogekluZGV4LFxyXG4gICAgICAgICAgICAgICAgaW1hZ2U6IG5ldyBvbC5zdHlsZS5JY29uKCh7XHJcbiAgICAgICAgICAgICAgICAgICAgYW5jaG9yOiBbLTAuNSwwLjVdLFxyXG4gICAgICAgICAgICAgICAgICAgIGFuY2hvclhVbml0czogJ2ZyYWN0aW9uJyxcclxuICAgICAgICAgICAgICAgICAgICBhbmNob3JZVW5pdHM6ICdmcmFjdGlvbicsXHJcbiAgICAgICAgICAgICAgICAgICAgb3BhY2l0eTogMSxcclxuICAgICAgICAgICAgICAgICAgICBzcmMgOiByZW5kZXJBcnJvd0Jhc2U2NCg0OCw0OCxwYXJ0LmNvbG9yKSxcclxuXHRcdFx0XHRcdCAgc2NhbGUgOiAwLjU1LFxyXG5cdFx0XHRcdFx0ICByb3RhdGlvbiA6IC1wYXJ0LmdldFJvdGF0aW9uKClcclxuXHRcdFx0XHQgICB9KSlcclxuXHRcdFx0fSkpO1xyXG5cdFx0fVxyXG4gICAgICAgIFxyXG5cdFx0Lyp2YXIgY29lZiA9IHBhcnQudHJhY2suZ2V0VHJhY2tMZW5ndGhJbldHUzg0KCkvcGFydC50cmFjay5nZXRUcmFja0xlbmd0aCgpO1x0XHRcclxuXHRcdHZhciByciA9IENPTkZJRy5tYXRoLmdwc0luYWNjdXJhY3kqY29lZjtcdFx0XHJcbiAgICAgICAgc3R5bGVzLnB1c2gobmV3IG9sLnN0eWxlLlN0eWxlKHtcclxuICAgICAgICAgICAgekluZGV4OiB6SW5kZXgsXHJcbiAgICAgICAgICAgIGltYWdlOiBuZXcgb2wuc3R5bGUuQ2lyY2xlKHtcclxuICAgICAgICAgICAgXHRnZW9tZXRyeTogbmV3IG9sLmdlb20uUG9pbnQocGFydC5nZXRHUFMoKSksXHJcbiAgICAgICAgICAgICAgICByYWRpdXM6IDEwLCAvL3JyICogcmVzb2x1dGlvbixcclxuICAgICAgICAgICAgICAgIGZpbGw6IG5ldyBvbC5zdHlsZS5GaWxsKHtcclxuICAgICAgICAgICAgICAgICAgICBjb2xvcjogXCJyZ2JhKDI1NSwyNTUsMjU1LDAuOClcIlxyXG4gICAgICAgICAgICAgICAgfSksXHJcbiAgICAgICAgICAgICAgICBzdHJva2U6IG5ldyBvbC5zdHlsZS5TdHJva2Uoe1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbG9yOiBcInJnYmEoMCwwLDAsMSlcIixcclxuICAgICAgICAgICAgICAgICAgICB3aWR0aDogMVxyXG4gICAgICAgICAgICAgICAgfSlcclxuICAgICAgICAgICAgfSlcclxuICAgICAgICB9KSk7Ki9cclxuXHRcdHJldHVybiBzdHlsZXM7XHJcblx0fSxcclxuXHJcblx0XCJjYW1cIiA6IGZ1bmN0aW9uKGZlYXR1cmUsIHJlc29sdXRpb24pIHtcclxuXHRcdHZhciBzdHlsZXM9W107XHJcblxyXG5cdFx0dmFyIGNhbSA9IGZlYXR1cmUuY2FtO1xyXG5cclxuXHRcdHN0eWxlcy5wdXNoKG5ldyBvbC5zdHlsZS5TdHlsZSh7XHJcblx0XHRcdGltYWdlOiBuZXcgb2wuc3R5bGUuSWNvbigoe1xyXG5cdFx0XHRcdC8vIFRPRE8gUnVtZW4gLSBpdCdzIGJldHRlciBhbGwgaW1hZ2VzIHRvIGJlIHRoZSBzYW1lIHNpemUsIHNvIHRoZSBzYW1lIHNjYWxlXHJcblx0XHRcdFx0c2NhbGUgOiAwLjA0MCxcclxuXHRcdFx0XHRzcmMgOiBDT05GSUcuYXBwZWFyYW5jZS5pbWFnZUNhbS5zcGxpdChcIi5zdmdcIikuam9pbigoY2FtLnNlcUlkKzEpICsgXCIuc3ZnXCIpXHJcblx0XHRcdH0pKVxyXG5cdFx0fSkpO1xyXG5cclxuXHRcdHJldHVybiBzdHlsZXM7XHJcblx0fSxcclxuXHJcbiAgICBcImhvdHNwb3RcIiA6IGZ1bmN0aW9uKGZlYXR1cmUsIHJlc29sdXRpb24pIHtcclxuICAgICAgICB2YXIgc3R5bGVzPVtdO1xyXG5cclxuICAgICAgICB2YXIgaG90c3BvdCA9IGZlYXR1cmUuaG90c3BvdDtcclxuXHJcbiAgICAgICAgc3R5bGVzLnB1c2gobmV3IG9sLnN0eWxlLlN0eWxlKHtcclxuICAgICAgICAgICAgaW1hZ2U6IG5ldyBvbC5zdHlsZS5JY29uKCh7XHJcbiAgICAgICAgICAgICAgICBzY2FsZSA6IGhvdHNwb3QuZ2V0VHlwZSgpLnNjYWxlIHx8IDEsXHJcbiAgICAgICAgICAgICAgICBzcmMgOiBob3RzcG90LmdldFR5cGUoKS5pbWFnZVxyXG4gICAgICAgICAgICB9KSlcclxuICAgICAgICB9KSk7XHJcblxyXG4gICAgICAgIHJldHVybiBzdHlsZXM7XHJcbiAgICB9LFxyXG5cclxuXHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdC8vIFByaXZhdGUgbWV0aG9kc1xyXG5cdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblxyXG5cdF90cmFja1NlbGVjdGVkIDogbmV3IG9sLnN0eWxlLlN0eWxlKHtcclxuXHRcdHN0cm9rZTogbmV3IG9sLnN0eWxlLlN0cm9rZSh7XHJcblx0XHRcdGNvbG9yOiAnI0ZGNTA1MCcsXHJcblx0XHRcdHdpZHRoOiA0LjVcclxuXHRcdH0pXHJcblx0fSksXHJcblxyXG5cdF9nZW5DaGVja3BvaW50IDogZnVuY3Rpb24oZ2VvbWV0cnksIGNvbG9yLCBzdHlsZXMpIHtcclxuXHRcdHZhciBzdGFydCA9IGdlb21ldHJ5WzBdO1xyXG5cdFx0dmFyIGVuZCA9IGdlb21ldHJ5WzFdO1xyXG5cdFx0dmFyIGR4ID0gZW5kWzBdIC0gc3RhcnRbMF07XHJcblx0XHR2YXIgZHkgPSBlbmRbMV0gLSBzdGFydFsxXTtcclxuXHRcdHZhciByb3RhdGlvbiA9IE1hdGguYXRhbjIoZHksIGR4KTtcclxuXHJcblx0XHRzdHlsZXMucHVzaChuZXcgb2wuc3R5bGUuU3R5bGUoe1xyXG5cdFx0XHRnZW9tZXRyeTogbmV3IG9sLmdlb20uUG9pbnQoc3RhcnQpLFxyXG5cdFx0XHRpbWFnZTogbmV3IG9sLnN0eWxlLkljb24oe1xyXG5cdFx0XHRcdHNyYzogcmVuZGVyQm94QmFzZTY0KDE2LDE2LGNvbG9yKSxcclxuXHRcdFx0XHRzY2FsZSA6IDEsXHJcblx0XHRcdFx0YW5jaG9yOiBbMC45MiwgMC41XSxcclxuXHRcdFx0XHRyb3RhdGVXaXRoVmlldzogdHJ1ZSxcclxuXHRcdFx0XHRyb3RhdGlvbjogLXJvdGF0aW9uLFxyXG5cdFx0XHRcdG9wYWNpdHkgOiAwLjY1XHJcblx0XHRcdH0pXHJcblx0XHR9KSk7XHJcblx0fSxcclxuXHJcblx0X2dlbkNoZWNrcG9pbnRJbWFnZSA6IGZ1bmN0aW9uKGdlb21ldHJ5LCBpbWFnZSwgc3R5bGVzKSB7XHJcblx0XHR2YXIgc3RhcnQgPSBnZW9tZXRyeVswXTtcclxuXHRcdC8vdmFyIGVuZCA9IGdlb21ldHJ5WzFdO1xyXG5cdFx0Ly92YXIgZHggPSBlbmRbMF0gLSBzdGFydFswXTtcclxuXHRcdC8vdmFyIGR5ID0gZW5kWzFdIC0gc3RhcnRbMV07XHJcblx0XHQvL3ZhciByb3RhdGlvbiA9IE1hdGguYXRhbjIoZHksIGR4KTtcclxuXHJcblx0XHRzdHlsZXMucHVzaChuZXcgb2wuc3R5bGUuU3R5bGUoe1xyXG5cdFx0XHRnZW9tZXRyeTogbmV3IG9sLmdlb20uUG9pbnQoc3RhcnQpLFxyXG5cdFx0XHRpbWFnZTogbmV3IG9sLnN0eWxlLkljb24oe1xyXG5cdFx0XHRcdHNyYzogaW1hZ2UsXHJcblx0XHRcdFx0Ly9zY2FsZSA6IDAuNjUsXHJcblx0XHRcdFx0YW5jaG9yOiBbMC41LCAwLjVdLFxyXG5cdFx0XHRcdHJvdGF0ZVdpdGhWaWV3OiB0cnVlLFxyXG5cdFx0XHRcdC8vcm90YXRpb246IC1yb3RhdGlvbixcclxuXHRcdFx0XHRvcGFjaXR5IDogMVxyXG5cdFx0XHR9KVxyXG5cdFx0fSkpO1xyXG5cdH0sXHJcblxyXG5cdF9nZW5EaXJlY3Rpb24gOiBmdW5jdGlvbihwdHMsIHd3LCByZXNvbHV0aW9uLCBjb2xvciwgc3R5bGVzKSB7XHJcbiAgICAgICAgaWYgKENPTkZJRy5hcHBlYXJhbmNlLmRpcmVjdGlvbkljb25CZXR3ZWVuIDw9IDApIHtcclxuICAgICAgICAgICAgLy8gdGhpcyBtZWFucyBubyBuZWVkIHRvIHNob3cgdGhlIGRpcmVjdGlvbnNcclxuICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgdmFyIGNudCA9IDA7XHJcbiAgICAgICAgdmFyIGljbiA9IHJlbmRlckRpcmVjdGlvbkJhc2U2NCgxNiwgMTYsIGNvbG9yKTtcclxuICAgICAgICB2YXIgcmVzID0gMC4wO1xyXG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgcHRzLmxlbmd0aCAtIDE7IGkrKykge1xyXG4gICAgICAgICAgICB2YXIgc3RhcnQgPSBwdHNbaSArIDFdO1xyXG4gICAgICAgICAgICB2YXIgZW5kID0gcHRzW2ldO1xyXG4gICAgICAgICAgICB2YXIgZHggPSBlbmRbMF0gLSBzdGFydFswXTtcclxuICAgICAgICAgICAgdmFyIGR5ID0gZW5kWzFdIC0gc3RhcnRbMV07XHJcbiAgICAgICAgICAgIHZhciBsZW4gPSBNYXRoLnNxcnQoZHggKiBkeCArIGR5ICogZHkpIC8gcmVzb2x1dGlvbjtcclxuICAgICAgICAgICAgcmVzICs9IGxlbjtcclxuICAgICAgICAgICAgaWYgKGkgPT0gMCB8fCByZXMgPj0gQ09ORklHLmFwcGVhcmFuY2UuZGlyZWN0aW9uSWNvbkJldHdlZW4pIHtcclxuICAgICAgICAgICAgICAgIHJlcyA9IDA7XHJcbiAgICAgICAgICAgICAgICB2YXIgcm90YXRpb24gPSBNYXRoLmF0YW4yKGR5LCBkeCk7XHJcbiAgICAgICAgICAgICAgICBzdHlsZXMucHVzaChuZXcgb2wuc3R5bGUuU3R5bGUoe1xyXG4gICAgICAgICAgICAgICAgICAgIGdlb21ldHJ5OiBuZXcgb2wuZ2VvbS5Qb2ludChbKHN0YXJ0WzBdICsgZW5kWzBdKSAvIDIsIChzdGFydFsxXSArIGVuZFsxXSkgLyAyXSksXHJcbiAgICAgICAgICAgICAgICAgICAgaW1hZ2U6IG5ldyBvbC5zdHlsZS5JY29uKHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgc3JjOiBpY24sXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHNjYWxlOiB3dyAvIDEyLjAsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGFuY2hvcjogWzAuNSwgMC41XSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgcm90YXRlV2l0aFZpZXc6IHRydWUsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHJvdGF0aW9uOiAtcm90YXRpb24gKyBNYXRoLlBJLCAvLyBhZGQgMTgwIGRlZ3JlZXNcclxuICAgICAgICAgICAgICAgICAgICAgICAgb3BhY2l0eTogMVxyXG4gICAgICAgICAgICAgICAgICAgIH0pXHJcbiAgICAgICAgICAgICAgICB9KSk7XHJcbiAgICAgICAgICAgICAgICBjbnQrKztcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgIH0sXHJcblxyXG4gICAgX2dlbkRpc3RhbmNlS20gOiBmdW5jdGlvbih3dywgcmVzb2x1dGlvbixcclxuXHRcdFx0XHRcdFx0XHQgIGNvb3JkcywgZGlzdGFuY2VzLCBzdGFydERpc3RJbmRleCwgZW5kRGlzdEluZGV4LFxyXG5cdFx0XHRcdFx0XHRcdCAgc3R5bGVzKSB7XHJcbiAgICAgICAgLy8gVE9ETyBSdW1lbiAtIHN0aWxsIG5vdCByZWFkeSAtIGZvciBub3cgc3RhdGljIGhvdHNwb3RzIGFyZSB1c2VkXHJcbiAgICAgICAgaWYgKHRydWUpIHtyZXR1cm47fVxyXG5cclxuICAgICAgICB2YXIgaG90c3BvdHNLbSA9IFsyMCwgNDAsIDYwLCA4MCwgMTAwLCAxMjAsIDE0MCwgMTYwLCAxODBdO1xyXG5cclxuICAgICAgICBmdW5jdGlvbiBhZGRIb3RTcG90S00oa20sIHBvaW50KSB7XHJcbiAgICAgICAgICAgIC8vdmFyIGR4ID0gZW5kWzBdIC0gc3RhcnRbMF07XHJcbiAgICAgICAgICAgIC8vdmFyIGR5ID0gZW5kWzFdIC0gc3RhcnRbMV07XHJcbiAgICAgICAgICAgIC8vdmFyIHJvdGF0aW9uID0gTWF0aC5hdGFuMihkeSwgZHgpO1xyXG4gICAgICAgICAgICBzdHlsZXMucHVzaChuZXcgb2wuc3R5bGUuU3R5bGUoe1xyXG4gICAgICAgICAgICAgICAgLy9nZW9tZXRyeTogbmV3IG9sLmdlb20uUG9pbnQoWyhzdGFydFswXStlbmRbMF0pLzIsKHN0YXJ0WzFdK2VuZFsxXSkvMl0pLFxyXG4gICAgICAgICAgICAgICAgZ2VvbWV0cnk6IG5ldyBvbC5nZW9tLlBvaW50KFtwb2ludFswXSwgcG9pbnRbMV1dKSxcclxuICAgICAgICAgICAgICAgIGltYWdlOiBuZXcgb2wuc3R5bGUuSWNvbih7XHJcbiAgICAgICAgICAgICAgICAgICAgc3JjOiBcImltZy9cIiArIGttICsgXCJrbS5zdmdcIixcclxuICAgICAgICAgICAgICAgICAgICBzY2FsZTogMS41LFxyXG4gICAgICAgICAgICAgICAgICAgIHJvdGF0ZVdpdGhWaWV3OiB0cnVlLFxyXG4gICAgICAgICAgICAgICAgICAgIC8vcm90YXRpb246IC1yb3RhdGlvbiArIE1hdGguUEkvMiwgLy8gYWRkIDE4MCBkZWdyZWVzXHJcbiAgICAgICAgICAgICAgICAgICAgb3BhY2l0eSA6IDFcclxuICAgICAgICAgICAgICAgIH0pXHJcbiAgICAgICAgICAgIH0pKTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGZvciAodmFyIGkgPSBzdGFydERpc3RJbmRleDsgaSA8IGVuZERpc3RJbmRleDsgaSsrKSB7XHJcbiAgICAgICAgICAgIGlmICghaG90c3BvdHNLbS5sZW5ndGgpIHtcclxuXHRcdFx0XHRyZXR1cm47XHJcblx0XHRcdH1cclxuXHJcblx0XHRcdHZhciBkaXN0ID0gZGlzdGFuY2VzW2ldO1xyXG5cclxuXHRcdFx0aWYgKGRpc3QgPj0gaG90c3BvdHNLbVswXSoxMDAwKSB7XHJcblx0XHRcdFx0Ly8gZHJhdyB0aGUgZmlyc3QgaG90c3BvdCBhbmQgYW55IG5leHQgaWYgaXQncyBjb250YWluZWQgaW4gdGhlIHNhbWUgXCJkaXN0YW5jZVwiXHJcblx0XHRcdFx0dmFyIHJlbW92ZUhvdHNwb3RLbSA9IDA7XHJcblx0XHRcdFx0Zm9yICh2YXIgayA9IDAsIGxlbkhvdHNwb3RzS20gPSBob3RzcG90c0ttLmxlbmd0aDsgayA8IGxlbkhvdHNwb3RzS207IGsrKykge1xyXG5cdFx0XHRcdFx0aWYgKGRpc3QgPj0gaG90c3BvdHNLbVtrXSoxMDAwKSB7XHJcblx0XHRcdFx0XHRcdGFkZEhvdFNwb3RLTShob3RzcG90c0ttW2tdLCBjb29yZHNbaV0pO1xyXG5cdFx0XHRcdFx0XHRyZW1vdmVIb3RzcG90S20rKztcclxuXHRcdFx0XHRcdH0gZWxzZSB7XHJcblx0XHRcdFx0XHRcdGJyZWFrO1xyXG5cdFx0XHRcdFx0fVxyXG5cdFx0XHRcdH1cclxuXHRcdFx0XHQvLyByZW1vdmUgYWxsIHRoZSBhbHJlYWR5IGRyYXduIGhvdHNwb3RzXHJcblx0XHRcdFx0Zm9yICh2YXIgaiA9IDA7IGogPHJlbW92ZUhvdHNwb3RLbTsgaisrKSBob3RzcG90c0ttLnNoaWZ0KCk7XHJcblx0XHRcdH1cclxuICAgICAgICB9XHJcbiAgICB9XHJcbn07XHJcblxyXG5mb3IgKHZhciBpIGluIFNUWUxFUylcclxuXHRleHBvcnRzW2ldPVNUWUxFU1tpXTtcclxuIiwicmVxdWlyZSgnam9vc2UnKTtcclxucmVxdWlyZSgnLi9QYXJ0aWNpcGFudCcpO1xyXG5cclxudmFyIHJidXNoID0gcmVxdWlyZSgncmJ1c2gnKTtcclxudmFyIENPTkZJRyA9IHJlcXVpcmUoJy4vQ29uZmlnJyk7XHJcbnZhciBXR1M4NFNQSEVSRSA9IHJlcXVpcmUoJy4vVXRpbHMnKS5XR1M4NFNQSEVSRTtcclxuXHJcbkNsYXNzKFwiVHJhY2tcIiwgXHJcbntcdFxyXG4gICAgLy8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdC8vIEFMTCBDT09SRElOQVRFUyBBUkUgSU4gV09STEQgTUVSQ0FUT1JcclxuICAgIC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuICAgIGhhczogXHJcblx0e1xyXG4gICAgICAgIHJvdXRlIDoge1xyXG4gICAgICAgICAgICBpczogICBcInJ3XCJcclxuICAgICAgICB9LFxyXG4gICAgICAgIGRpc3RhbmNlcyA6IHtcclxuICAgICAgICAgICAgaXM6ICAgXCJyd1wiXHJcbiAgICAgICAgfSxcclxuICAgICAgICBkaXN0YW5jZXNFbGFwc2VkIDoge1xyXG4gICAgICAgICAgICBpczogICBcInJ3XCJcclxuICAgICAgICB9LFxyXG5cdFx0dG90YWxMZW5ndGggOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiXHJcblx0XHR9LFxyXG5cdFx0cGFydGljaXBhbnRzIDoge1xyXG5cdFx0XHRpczogICBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiBbXVxyXG5cdFx0fSxcclxuXHRcdGNhbXNDb3VudCA6IHtcclxuXHRcdFx0aXM6ICAgXCJyd1wiLFxyXG5cdFx0XHRpbml0OiAwXHJcblx0XHR9LFxyXG5cdFx0Ly8gaW4gRVBTRyAzODU3XHJcblx0XHRmZWF0dXJlIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IG51bGxcdFx0XHJcblx0XHR9LFxyXG5cdFx0aXNEaXJlY3Rpb25Db25zdHJhaW50IDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IGZhbHNlXHJcblx0XHR9LFxyXG5cdFx0XHJcblx0XHRkZWJ1Z1BhcnRpY2lwYW50IDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IG51bGxcclxuXHRcdH0sXHJcblx0XHRiaWtlU3RhcnRLTSA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiBudWxsXHJcblx0XHR9LFxyXG5cdFx0cnVuU3RhcnRLTSA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiBudWxsXHJcblx0XHR9LFxyXG5cdFx0bGFwcyA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiAxXHJcblx0XHR9LFxyXG5cdFx0dG90YWxQYXJ0aWNpcGFudHMgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogNTBcclxuXHRcdH0sXHJcblx0XHRyVHJlZSA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiByYnVzaCgxMClcclxuXHRcdH0sXHJcblxyXG5cdFx0aXNBZGRlZEhvdFNwb3RTd2ltQmlrZSA6IHtcclxuXHRcdFx0aW5pdCA6IGZhbHNlXHJcblx0XHR9LFxyXG5cdFx0aXNBZGRlZEhvdFNwb3RCaWtlUnVuIDoge1xyXG5cdFx0XHRpbml0IDogZmFsc2VcclxuXHRcdH1cclxuICAgIH0sXHJcbiAgICAvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0bWV0aG9kczogXHJcblx0e1x0XHRcclxuXHRcdHNldFJvdXRlIDogZnVuY3Rpb24odmFsKSB7XHJcblx0XHRcdHRoaXMucm91dGU9dmFsO1xyXG5cdFx0XHRkZWxldGUgdGhpcy5fbGVudG1wMTtcclxuXHRcdFx0ZGVsZXRlIHRoaXMuX2xlbnRtcDI7XHJcblx0XHR9LFxyXG5cdFx0XHJcblx0XHRnZXRCb3VuZGluZ0JveCA6IGZ1bmN0aW9uKCkge1xyXG5cdFx0XHR2YXIgbWlueD1udWxsLG1pbnk9bnVsbCxtYXh4PW51bGwsbWF4eT1udWxsO1xyXG5cdFx0XHRmb3IgKHZhciBpPTA7aTx0aGlzLnJvdXRlLmxlbmd0aDtpKyspXHJcblx0XHRcdHtcclxuXHRcdFx0XHR2YXIgcD10aGlzLnJvdXRlW2ldO1xyXG5cdFx0XHRcdGlmIChtaW54ID09IG51bGwgfHwgcFswXSA8IG1pbngpIG1pbng9cFswXTtcclxuXHRcdFx0XHRpZiAobWF4eCA9PSBudWxsIHx8IHBbMF0gPiBtYXh4KSBtYXh4PXBbMF07XHJcblx0XHRcdFx0aWYgKG1pbnkgPT0gbnVsbCB8fCBwWzFdIDwgbWlueSkgbWlueT1wWzFdO1xyXG5cdFx0XHRcdGlmIChtYXh5ID09IG51bGwgfHwgcFsxXSA+IG1heHkpIG1heHk9cFsxXTtcclxuXHRcdFx0fVxyXG5cdFx0XHRyZXR1cm4gW21pbngsbWlueSxtYXh4LG1heHldO1xyXG5cdFx0fSxcclxuXHRcdFxyXG5cdFx0Ly8gQ0FMTCBPTkxZIE9OQ0UgT04gSU5JVFxyXG5cdFx0Z2V0RWxhcHNlZEZyb21Qb2ludCA6IGZ1bmN0aW9uKHBvaW50LHN0YXJ0KSBcclxuXHRcdHtcclxuXHRcdFx0dmFyIHJlcz0wLjA7XHJcblx0XHRcdHZhciBicms9ZmFsc2U7XHJcblx0XHRcdHZhciBjYyA9IHRoaXMucm91dGU7XHJcblx0XHRcdGlmICghc3RhcnQpXHJcblx0XHRcdFx0c3RhcnQ9MDtcclxuXHRcdFx0Zm9yICh2YXIgaT1zdGFydDtpPGNjLmxlbmd0aC0xO2krKykgXHJcblx0XHRcdHtcclxuXHRcdFx0XHR2YXIgYSA9IGNjW2ldO1xyXG5cdFx0XHRcdHZhciBjID0gY2NbaSsxXTtcclxuXHRcdFx0XHR2YXIgYiA9IHBvaW50O1xyXG5cdFx0XHRcdHZhciBhYyA9IE1hdGguc3FydCgoYVswXS1jWzBdKSooYVswXS1jWzBdKSsoYVsxXS1jWzFdKSooYVsxXS1jWzFdKSk7XHJcblx0XHRcdFx0dmFyIGJhID0gTWF0aC5zcXJ0KChiWzBdLWFbMF0pKihiWzBdLWFbMF0pKyhiWzFdLWFbMV0pKihiWzFdLWFbMV0pKTtcclxuXHRcdFx0XHR2YXIgYmMgPSBNYXRoLnNxcnQoKGJbMF0tY1swXSkqKGJbMF0tY1swXSkrKGJbMV0tY1sxXSkqKGJbMV0tY1sxXSkpO1xyXG5cdFx0XHRcdFxyXG5cdFx0XHRcdHZhciBtaW54ID0gYVswXSA8IGJbMF0gPyBhWzBdIDogYlswXTtcclxuXHRcdFx0XHR2YXIgbWlueSA9IGFbMV0gPCBiWzFdID8gYVsxXSA6IGJbMV07XHJcblx0XHRcdFx0dmFyIG1heHggPSBhWzBdID4gYlswXSA/IGFbMF0gOiBiWzBdO1xyXG5cdFx0XHRcdHZhciBtYXh5ID0gYVsxXSA+IGJbMV0gPyBhWzFdIDogYlsxXTtcclxuXHRcdFx0XHQvLyBiYSA+IGFjIE9SIGJjID4gYWNcclxuXHRcdFx0XHRpZiAoYlswXSA8IG1pbnggfHwgYlswXSA+IG1heHggfHwgYlsxXSA8IG1pbnkgfHwgYlsxXSA+IG1heHkgfHwgYmEgPiBhYyB8fCBiYyA+IGFjKSBcclxuXHRcdFx0XHR7XHJcblx0XHRcdFx0XHRyZXMrPVdHUzg0U1BIRVJFLmhhdmVyc2luZURpc3RhbmNlKGEsYyk7XHJcblx0XHRcdFx0XHRjb250aW51ZTtcclxuXHRcdFx0XHR9XHJcblx0XHRcdFx0cmVzKz1XR1M4NFNQSEVSRS5oYXZlcnNpbmVEaXN0YW5jZShhLGIpO1xyXG5cdFx0XHRcdGJyZWFrO1xyXG5cdFx0XHR9XHJcblx0XHRcdHZhciBsZW4gPSB0aGlzLmdldFRyYWNrTGVuZ3RoKCk7XHJcblx0XHRcdHJldHVybiByZXMvbGVuO1xyXG5cdFx0fSxcclxuXHRcdFxyXG5cdFx0Ly8gZWxhcHNlZCBmcm9tIDAuLjFcclxuXHRcdGdldFBvc2l0aW9uQW5kUm90YXRpb25Gcm9tRWxhcHNlZCA6IGZ1bmN0aW9uKGVsYXBzZWQpIHtcclxuXHRcdFx0dmFyIHJyPW51bGw7XHJcblx0XHRcdHZhciBjYyA9IHRoaXMucm91dGU7XHJcblx0XHRcdFxyXG5cdFx0XHR2YXIgbGwgPSB0aGlzLmRpc3RhbmNlc0VsYXBzZWQubGVuZ3RoLTE7XHJcblx0XHRcdHZhciBzaSA9IDA7XHJcblxyXG5cdFx0XHQvLyBUT0RPIEZJWCBNRSBcclxuXHRcdFx0d2hpbGUgKHNpIDwgbGwgJiYgc2krNTAwIDwgbGwgJiYgdGhpcy5kaXN0YW5jZXNFbGFwc2VkW3NpKzUwMF0gPCBlbGFwc2VkICkge1xyXG5cdFx0XHRcdHNpKz01MDA7XHJcblx0XHRcdH1cclxuXHRcdFx0XHJcblx0XHRcdHdoaWxlIChzaSA8IGxsICYmIHNpKzI1MCA8IGxsICYmIHRoaXMuZGlzdGFuY2VzRWxhcHNlZFtzaSsyNTBdIDwgZWxhcHNlZCApIHtcclxuXHRcdFx0XHRzaSs9MjUwO1xyXG5cdFx0XHR9XHJcblx0XHRcdFxyXG5cdFx0XHR3aGlsZSAoc2kgPCBsbCAmJiBzaSsxMjUgPCBsbCAmJiB0aGlzLmRpc3RhbmNlc0VsYXBzZWRbc2krMTI1XSA8IGVsYXBzZWQgKSB7XHJcblx0XHRcdFx0c2krPTEyNTtcclxuXHRcdFx0fVxyXG5cclxuXHRcdFx0d2hpbGUgKHNpIDwgbGwgJiYgc2krNTAgPCBsbCAmJiB0aGlzLmRpc3RhbmNlc0VsYXBzZWRbc2krNTBdIDwgZWxhcHNlZCApIHtcclxuXHRcdFx0XHRzaSs9NTA7XHJcblx0XHRcdH1cclxuXHRcdFx0XHJcblx0XHRcdGZvciAodmFyIGk9c2k7aTxsbDtpKyspIFxyXG5cdFx0XHR7XHJcblx0XHRcdFx0LypkbyBcclxuXHRcdFx0XHR7XHJcblx0XHRcdFx0XHR2YXIgbSA9ICgoY2MubGVuZ3RoLTEraSkgPj4gMSk7XHJcblx0XHRcdFx0XHRpZiAobS1pID4gNSAmJiBlbGFwc2VkIDwgdGhpcy5kaXN0YW5jZXNFbGFwc2VkW21dKSB7XHJcblx0XHRcdFx0XHRcdGk9bTtcclxuXHRcdFx0XHRcdFx0Y29udGludWU7XHJcblx0XHRcdFx0XHR9XHJcblx0XHRcdFx0XHRicmVhaztcclxuXHRcdFx0XHR9IHdoaWxlICh0cnVlKTsqL1xyXG5cdFx0XHRcdGlmIChlbGFwc2VkID49IHRoaXMuZGlzdGFuY2VzRWxhcHNlZFtpXSAmJiBlbGFwc2VkIDw9IHRoaXMuZGlzdGFuY2VzRWxhcHNlZFtpKzFdKSBcclxuXHRcdFx0XHR7XHJcblx0XHRcdFx0XHRlbGFwc2VkLT10aGlzLmRpc3RhbmNlc0VsYXBzZWRbaV07XHJcblx0XHRcdFx0XHR2YXIgYWM9dGhpcy5kaXN0YW5jZXNFbGFwc2VkW2krMV0tdGhpcy5kaXN0YW5jZXNFbGFwc2VkW2ldO1xyXG5cdFx0XHRcdFx0dmFyIGEgPSBjY1tpXTtcclxuXHRcdFx0XHRcdHZhciBjID0gY2NbaSsxXTtcclxuXHRcdFx0XHRcdHZhciBkeCA9IGNbMF0gLSBhWzBdO1xyXG5cdFx0XHRcdFx0dmFyIGR5ID0gY1sxXSAtIGFbMV07XHJcblx0XHRcdFx0XHRycj1bIGFbMF0rKGNbMF0tYVswXSkqZWxhcHNlZC9hYyxhWzFdKyhjWzFdLWFbMV0pKmVsYXBzZWQvYWMsTWF0aC5hdGFuMihkeSwgZHgpXTtcclxuXHRcdFx0XHRcdGJyZWFrO1xyXG5cdFx0XHRcdH1cclxuXHRcdFx0fVxyXG5cdFx0XHRyZXR1cm4gcnI7XHJcblx0XHR9LFxyXG5cdFx0XHJcblx0XHRfX2dldFBvc2l0aW9uQW5kUm90YXRpb25Gcm9tRWxhcHNlZCA6IGZ1bmN0aW9uKGVsYXBzZWQpIHtcclxuXHRcdFx0ZWxhcHNlZCo9dGhpcy5nZXRUcmFja0xlbmd0aCgpO1xyXG5cdFx0XHR2YXIgcnI9bnVsbDtcclxuXHRcdFx0dmFyIGNjID0gdGhpcy5yb3V0ZTtcclxuXHRcdFx0Zm9yICh2YXIgaT0wO2k8Y2MubGVuZ3RoLTE7aSsrKSBcclxuXHRcdFx0e1xyXG5cdFx0XHRcdHZhciBhID0gY2NbaV07XHJcblx0XHRcdFx0dmFyIGMgPSBjY1tpKzFdO1xyXG5cdFx0XHRcdHZhciBhYyA9IFdHUzg0U1BIRVJFLmhhdmVyc2luZURpc3RhbmNlKGEsYyk7XHJcblx0XHRcdFx0aWYgKGVsYXBzZWQgPD0gYWMpIHtcclxuXHRcdFx0XHRcdHZhciBkeCA9IGNbMF0gLSBhWzBdO1xyXG5cdFx0XHRcdFx0dmFyIGR5ID0gY1sxXSAtIGFbMV07XHJcblx0XHRcdFx0XHRycj1bIGFbMF0rKGNbMF0tYVswXSkqZWxhcHNlZC9hYyxhWzFdKyhjWzFdLWFbMV0pKmVsYXBzZWQvYWMsTWF0aC5hdGFuMihkeSwgZHgpXTtcclxuXHRcdFx0XHRcdGJyZWFrO1xyXG5cdFx0XHRcdH1cclxuXHRcdFx0XHRlbGFwc2VkLT1hYztcclxuXHRcdFx0fVxyXG5cdFx0XHRyZXR1cm4gcnI7XHJcblx0XHR9LFxyXG5cclxuXHRcdFxyXG5cdFx0Z2V0VHJhY2tMZW5ndGggOiBmdW5jdGlvbigpIHtcclxuXHRcdFx0aWYgKHRoaXMuX2xlbnRtcDEpXHJcblx0XHRcdFx0cmV0dXJuIHRoaXMuX2xlbnRtcDE7XHJcblx0XHRcdHZhciByZXM9MC4wO1xyXG5cdFx0XHR2YXIgY2MgPSB0aGlzLnJvdXRlO1xyXG5cdFx0XHRmb3IgKHZhciBpPTA7aTxjYy5sZW5ndGgtMTtpKyspIFxyXG5cdFx0XHR7XHJcblx0XHRcdFx0dmFyIGEgPSBjY1tpXTtcclxuXHRcdFx0XHR2YXIgYiA9IGNjW2krMV07XHJcblx0XHRcdFx0dmFyIGQgPSBXR1M4NFNQSEVSRS5oYXZlcnNpbmVEaXN0YW5jZShhLGIpO1xyXG5cdFx0XHRcdGlmICghaXNOYU4oZCkgJiYgZCA+IDApIFxyXG5cdFx0XHRcdFx0cmVzKz1kO1xyXG5cdFx0XHR9XHJcblx0XHRcdHRoaXMuX2xlbnRtcDE9cmVzO1xyXG5cdFx0XHRyZXR1cm4gcmVzO1xyXG5cdFx0fSxcclxuXHJcblx0XHRnZXRUcmFja0xlbmd0aEluV0dTODQgOiBmdW5jdGlvbigpIHtcclxuXHRcdFx0aWYgKHRoaXMuX2xlbnRtcDIpXHJcblx0XHRcdFx0cmV0dXJuIHRoaXMuX2xlbnRtcDI7XHJcblx0XHRcdHZhciByZXM9MC4wO1xyXG5cdFx0XHR2YXIgY2MgPSB0aGlzLnJvdXRlO1xyXG5cdFx0XHRmb3IgKHZhciBpPTA7aTxjYy5sZW5ndGgtMTtpKyspIFxyXG5cdFx0XHR7XHJcblx0XHRcdFx0dmFyIGEgPSBjY1tpXTtcclxuXHRcdFx0XHR2YXIgYiA9IGNjW2krMV07XHJcblx0XHRcdFx0dmFyIGQgPSBNYXRoLnNxcnQoKGFbMF0tYlswXSkqKGFbMF0tYlswXSkrKGFbMV0tYlsxXSkqKGFbMV0tYlsxXSkpO1xyXG5cdFx0XHRcdGlmICghaXNOYU4oZCkgJiYgZCA+IDApIFxyXG5cdFx0XHRcdFx0cmVzKz1kO1xyXG5cdFx0XHR9XHJcblx0XHRcdHRoaXMuX2xlbnRtcDI9cmVzO1xyXG5cdFx0XHRyZXR1cm4gcmVzO1xyXG5cdFx0fSxcclxuXHJcblx0XHRnZXRDZW50ZXIgOiBmdW5jdGlvbigpIHtcclxuXHRcdFx0dmFyIGJiID0gdGhpcy5nZXRCb3VuZGluZ0JveCgpO1xyXG5cdFx0XHRyZXR1cm4gWyhiYlswXStiYlsyXSkvMi4wLChiYlsxXStiYlszXSkvMi4wXTtcclxuXHRcdH0sXHJcblx0XHRcclxuXHRcdGluaXQgOiBmdW5jdGlvbigpIFxyXG5cdFx0e1xyXG5cdFx0XHRpZiAoIXRoaXMucm91dGUpXHJcblx0XHRcdFx0cmV0dXJuO1xyXG5cdFx0XHQvLyAxKSBjYWxjdWxhdGUgdG90YWwgcm91dGUgbGVuZ3RoIGluIEtNIFxyXG5cdFx0XHR0aGlzLnVwZGF0ZUZlYXR1cmUoKTtcclxuXHRcdFx0aWYgKHR5cGVvZiB3aW5kb3cgIT0gXCJ1bmRlZmluZWRcIikgXHJcblx0XHRcdHtcclxuXHRcdFx0XHRpZiAoIUdVSS5nZXRJc1NraXBFeHRlbnQoKSkge1xyXG5cdFx0XHRcdFx0aWYgKHRoaXMuZmVhdHVyZSkge1xyXG5cdFx0XHRcdFx0XHRHVUkubWFwLmdldFZpZXcoKS5maXRFeHRlbnQodGhpcy5mZWF0dXJlLmdldEdlb21ldHJ5KCkuZ2V0RXh0ZW50KCksIEdVSS5tYXAuZ2V0U2l6ZSgpKTtcclxuXHRcdFx0XHRcdFx0Y29uc29sZS5sb2coXCJDdXJyZW50IGV4dGVudCA6IFwiICsgSlNPTi5zdHJpbmdpZnkodGhpcy5mZWF0dXJlLmdldEdlb21ldHJ5KCkuZ2V0RXh0ZW50KCkpKTtcclxuXHRcdFx0XHRcdH0gZWxzZSB7XHJcblx0XHRcdFx0XHRcdEdVSS5tYXAuZ2V0VmlldygpLmZpdEV4dGVudChbMTIzNDU5Mi4zNjM3MzQ1NTY4LCA2MjgyNzA2Ljg4OTY3NjQzNSwgMTI2NDM0OC40NjQzNzM3NjYsIDYzMjU2OTQuNzQzMTY0NzI1XSwgR1VJLm1hcC5nZXRTaXplKCkpO1xyXG5cdFx0XHRcdFx0fVxyXG5cdFx0XHRcdH1cclxuXHRcdFx0fVxyXG5cdFx0fSxcclxuXHRcdFxyXG5cdFx0Z2V0VHJhY2tQYXJ0IDogZnVuY3Rpb24oZWxhcHNlZCkge1xyXG5cdFx0XHR2YXIgbGVuID0gdGhpcy5nZXRUcmFja0xlbmd0aCgpO1xyXG5cdFx0XHR2YXIgZW0gPSAoZWxhcHNlZCUxLjApKmxlbjtcclxuXHRcdFx0aWYgKGVtID49IHRoaXMucnVuU3RhcnRLTSoxMDAwKSBcclxuXHRcdFx0XHRyZXR1cm4gMjtcclxuXHRcdFx0aWYgKGVtID49IHRoaXMuYmlrZVN0YXJ0S00qMTAwMCkgXHJcblx0XHRcdFx0cmV0dXJuIDE7XHJcblx0XHRcdHJldHVybiAwO1xyXG5cdFx0fSxcclxuXHRcdFxyXG5cdFx0dXBkYXRlRmVhdHVyZSA6IGZ1bmN0aW9uKCkgXHJcblx0XHR7XHJcblx0XHRcdHRoaXMuZGlzdGFuY2VzPVtdO1xyXG5cdFx0XHR2YXIgcmVzPTAuMDtcclxuXHRcdFx0dmFyIGNjID0gdGhpcy5yb3V0ZTtcclxuXHRcdFx0Zm9yICh2YXIgaT0wO2k8Y2MubGVuZ3RoLTE7aSsrKSBcclxuXHRcdFx0e1xyXG5cdFx0XHRcdHZhciBhID0gY2NbaV07XHJcblx0XHRcdFx0dmFyIGIgPSBjY1tpKzFdO1xyXG5cdFx0XHRcdHZhciBkID0gV0dTODRTUEhFUkUuaGF2ZXJzaW5lRGlzdGFuY2UoYSxiKTtcclxuXHRcdFx0XHR0aGlzLmRpc3RhbmNlcy5wdXNoKHJlcyk7XHJcblx0XHRcdFx0aWYgKCFpc05hTihkKSAmJiBkID4gMCkgXHJcblx0XHRcdFx0XHRyZXMrPWQ7XHJcblx0XHRcdH1cclxuXHRcdFx0dGhpcy5kaXN0YW5jZXMucHVzaChyZXMpO1xyXG5cdFx0XHR0aGlzLmRpc3RhbmNlc0VsYXBzZWQ9W107XHJcblx0XHRcdHZhciB0bCA9IHRoaXMuZ2V0VHJhY2tMZW5ndGgoKTtcclxuXHRcdFx0Zm9yICh2YXIgaT0wO2k8Y2MubGVuZ3RoO2krKykge1xyXG5cdFx0XHRcdHRoaXMuZGlzdGFuY2VzRWxhcHNlZC5wdXNoKHRoaXMuZGlzdGFuY2VzW2ldL3RsKTtcclxuXHRcdFx0fVxyXG5cdFx0XHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0XHRcdHRoaXMuclRyZWUuY2xlYXIoKTtcclxuXHRcdFx0dmFyIGFyciA9IFtdO1xyXG5cdFx0XHRmb3IgKHZhciBpPTA7aTx0aGlzLnJvdXRlLmxlbmd0aC0xO2krKykgXHJcblx0XHRcdHtcclxuXHRcdFx0XHR2YXIgeDEgPSB0aGlzLnJvdXRlW2ldWzBdO1xyXG5cdFx0XHRcdHZhciB5MSA9IHRoaXMucm91dGVbaV1bMV07XHJcblx0XHRcdFx0dmFyIHgyID0gdGhpcy5yb3V0ZVtpKzFdWzBdO1xyXG5cdFx0XHRcdHZhciB5MiA9IHRoaXMucm91dGVbaSsxXVsxXTtcclxuXHRcdFx0XHR2YXIgbWlueCA9IHgxIDwgeDIgPyB4MSA6IHgyO1xyXG5cdFx0XHRcdHZhciBtaW55ID0geTEgPCB5MiA/IHkxIDogeTI7XHJcblx0XHRcdFx0dmFyIG1heHggPSB4MSA+IHgyID8geDEgOiB4MjtcclxuXHRcdFx0XHR2YXIgbWF4eSA9IHkxID4geTIgPyB5MSA6IHkyO1xyXG5cdFx0XHRcdGFyci5wdXNoKFttaW54LG1pbnksbWF4eCxtYXh5LHsgaW5kZXggOiBpIH1dKTtcclxuXHRcdFx0fVxyXG5cdFx0XHR0aGlzLnJUcmVlLmxvYWQoYXJyKTtcclxuXHRcdFx0Ly8tLS0tLS0tLS0tLS0tLS0tLSAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRcdFx0aWYgKHR5cGVvZiB3aW5kb3cgIT0gXCJ1bmRlZmluZWRcIiAmJiB0aGlzLnJvdXRlICYmIHRoaXMucm91dGUubGVuZ3RoKSBcclxuXHRcdFx0e1xyXG5cdFx0XHRcdHZhciB3a3QgPSBbXTtcclxuXHRcdFx0XHRmb3IgKHZhciBpPTA7aTx0aGlzLnJvdXRlLmxlbmd0aDtpKyspIHtcclxuXHRcdFx0XHRcdHdrdC5wdXNoKHRoaXMucm91dGVbaV1bMF0rXCIgXCIrdGhpcy5yb3V0ZVtpXVsxXSk7XHJcblx0XHRcdFx0fVxyXG5cdFx0XHRcdHdrdD1cIkxJTkVTVFJJTkcoXCIrd2t0LmpvaW4oXCIsXCIpK1wiKVwiO1xyXG5cdFx0XHRcdHZhciBmb3JtYXQgPSBuZXcgb2wuZm9ybWF0LldLVCgpO1xyXG5cdFx0XHRcdGlmICghdGhpcy5mZWF0dXJlKSB7XHJcblx0XHRcdFx0XHR0aGlzLmZlYXR1cmUgPSBmb3JtYXQucmVhZEZlYXR1cmUod2t0KTtcclxuXHRcdFx0XHR9IGVsc2Uge1xyXG5cdFx0XHRcdFx0dGhpcy5mZWF0dXJlLnNldEdlb21ldHJ5KGZvcm1hdC5yZWFkRmVhdHVyZSh3a3QpLmdldEdlb21ldHJ5KCkpO1xyXG5cdFx0XHRcdH1cclxuXHRcdFx0XHR0aGlzLmZlYXR1cmUudHJhY2s9dGhpcztcclxuXHRcdFx0XHR0aGlzLmZlYXR1cmUuZ2V0R2VvbWV0cnkoKS50cmFuc2Zvcm0oJ0VQU0c6NDMyNicsICdFUFNHOjM4NTcnKTtcdFx0XHRcdFx0XHRcclxuXHRcdFx0XHQvL2NvbnNvbGUubG9nKFwiRkVBVFVSRSBUUkFDSyA6IFwiK3RoaXMuZmVhdHVyZS50cmFjayk7XHJcblx0XHRcdH0gZWxzZSB7XHJcblx0XHRcdFx0ZGVsZXRlIHRoaXMuZmVhdHVyZTtcclxuXHRcdFx0fVxyXG5cdFx0fSxcclxuXHJcblx0XHRnZXRSZWFsUGFydGljaXBhbnRzQ291bnQgOiBmdW5jdGlvbigpIHtcclxuXHRcdFx0cmV0dXJuIHRoaXMucGFydGljaXBhbnRzLmxlbmd0aCAtIHRoaXMuY2Ftc0NvdW50O1xyXG5cdFx0fSxcclxuXHRcdFxyXG5cdFx0bmV3UGFydGljaXBhbnQgOiBmdW5jdGlvbihpZCxkZXZpY2VJZCxuYW1lKVxyXG5cdFx0e1xyXG5cdFx0XHR2YXIgcGFydCA9IG5ldyBQYXJ0aWNpcGFudCh7aWQ6aWQsZGV2aWNlSWQ6ZGV2aWNlSWQsY29kZTpuYW1lfSk7XHJcblx0XHRcdHBhcnQuaW5pdCh0aGlzLnJvdXRlWzBdLHRoaXMpO1xyXG5cdFx0XHRwYXJ0LnNldFNlcUlkKHRoaXMucGFydGljaXBhbnRzLmxlbmd0aCk7XHJcblx0XHRcdHRoaXMucGFydGljaXBhbnRzLnB1c2gocGFydCk7XHJcblx0XHRcdHJldHVybiBwYXJ0O1xyXG5cdFx0fSxcclxuXHJcblx0XHRuZXdNb3ZpbmdDYW0gOiBmdW5jdGlvbihpZCxkZXZpY2VJZCxuYW1lKVxyXG5cdFx0e1xyXG5cdFx0XHR2YXIgY2FtID0gbmV3IE1vdmluZ0NhbSh7aWQ6aWQsZGV2aWNlSWQ6ZGV2aWNlSWQsY29kZTpuYW1lfSk7XHJcblx0XHRcdGNhbS5pbml0KHRoaXMucm91dGVbMF0sdGhpcyk7XHJcblx0XHRcdGNhbS5zZXRTZXFJZCh0aGlzLmNhbXNDb3VudCk7XHJcblx0XHRcdHRoaXMuY2Ftc0NvdW50Kys7XHJcblx0XHRcdGNhbS5fX3NraXBUcmFja2luZ1Bvcz10cnVlO1xyXG5cdFx0XHR0aGlzLnBhcnRpY2lwYW50cy5wdXNoKGNhbSk7XHJcblx0XHRcdHJldHVybiBjYW07XHJcblx0XHR9LFxyXG5cclxuXHRcdG5ld0hvdFNwb3RzIDogZnVuY3Rpb24oaG90c3BvdHMpIHtcclxuXHRcdFx0aWYgKCFob3RzcG90cyB8fCAhaG90c3BvdHMubGVuZ3RoKSB7XHJcblx0XHRcdFx0cmV0dXJuO1xyXG5cdFx0XHR9XHJcblxyXG5cdFx0XHQvLyBUT0RPIFJ1bWVuIC0gdGhpcyBpcyBDT1BZLVBBU1RFIGNvZGUgZm9ybSB0aGUgU3R5bGVzXHJcblx0XHRcdC8vIHNvIGxhdGVyIGl0IGhhcyB0byBiZSBpbiBvbmx5IG9uZSBwbGFjZSAtIGdldHRpbmcgdGhlIGdlb21ldHJpZXMgZm9yIGVhY2ggdHlwZSBkaXN0YW5jZVxyXG5cdFx0XHQvLyBtYXliZSBpbiB0aGUgc2FtZSBwbGFjZSBkaXN0YW5jZXMgYXJlIGNhbGN1bGF0ZWQuXHJcblx0XHRcdC8vIFRISVMgSVMgVEVNUE9SQVJZIFBBVENIIHRvIGdldCB0aGUgbmVlZGVkIHBvaW50c1xyXG5cdFx0XHRpZiAoIWlzTmFOKHRoaXMuYmlrZVN0YXJ0S00pKSB7XHJcblx0XHRcdFx0Zm9yICh2YXIgaT0wO2k8dGhpcy5kaXN0YW5jZXMubGVuZ3RoO2krKykge1xyXG5cdFx0XHRcdFx0aWYgKHRoaXMuZGlzdGFuY2VzW2ldID49IHRoaXMuYmlrZVN0YXJ0S00qMTAwMClcclxuXHRcdFx0XHRcdFx0YnJlYWs7XHJcblx0XHRcdFx0fVxyXG5cdFx0XHRcdHZhciBqO1xyXG5cdFx0XHRcdGlmICghaXNOYU4odGhpcy5ydW5TdGFydEtNKSkge1xyXG5cdFx0XHRcdFx0Zm9yIChqPWk7ajx0aGlzLmRpc3RhbmNlcy5sZW5ndGg7aisrKSB7XHJcblx0XHRcdFx0XHRcdGlmICh0aGlzLmRpc3RhbmNlc1tqXSA+PSB0aGlzLnJ1blN0YXJ0S00qMTAwMClcclxuXHRcdFx0XHRcdFx0XHRicmVhaztcclxuXHRcdFx0XHRcdH1cclxuXHRcdFx0XHR9IGVsc2Uge1xyXG5cdFx0XHRcdFx0aj10aGlzLmRpc3RhbmNlcy5sZW5ndGg7XHJcblx0XHRcdFx0fVxyXG5cdFx0XHRcdHZhciBjb29yZHM9dGhpcy5mZWF0dXJlLmdldEdlb21ldHJ5KCkuZ2V0Q29vcmRpbmF0ZXMoKTtcclxuXHRcdFx0XHR2YXIgZ2VvbXN3aW09Y29vcmRzLnNsaWNlKDAsaSk7XHJcblx0XHRcdFx0dmFyIGdlb21iaWtlPWNvb3Jkcy5zbGljZShpIDwgMSA/IGkgOiBpLTEsaik7XHJcblx0XHRcdFx0aWYgKGogPCB0aGlzLmRpc3RhbmNlcy5sZW5ndGgpXHJcblx0XHRcdFx0XHR2YXIgZ2VvbXJ1bj1jb29yZHMuc2xpY2UoaiA8IDEgPyBqIDogai0xLHRoaXMuZGlzdGFuY2VzLmxlbmd0aCk7XHJcblx0XHRcdFx0aWYgKCFnZW9tc3dpbS5sZW5ndGgpXHJcblx0XHRcdFx0XHRnZW9tc3dpbT1udWxsO1xyXG5cdFx0XHRcdGlmICghZ2VvbWJpa2UubGVuZ3RoKVxyXG5cdFx0XHRcdFx0Z2VvbWJpa2U9bnVsbDtcclxuXHRcdFx0XHRpZiAoIWdlb21ydW4ubGVuZ3RoKVxyXG5cdFx0XHRcdFx0Z2VvbXJ1bj1udWxsO1xyXG5cdFx0XHR9XHJcblxyXG5cdFx0XHRmb3IgKHZhciBpID0gMCwgbGVuID0gaG90c3BvdHMubGVuZ3RoOyBpIDwgbGVuOyBpKyspIHtcclxuXHRcdFx0XHR2YXIgaG90c3BvdCA9IGhvdHNwb3RzW2ldO1xyXG5cdFx0XHRcdHZhciBwb2ludDtcclxuXHRcdFx0XHRpZiAoaG90c3BvdC50eXBlID09PSBDT05GSUcuaG90c3BvdC5jYW1Td2ltQmlrZSkge1xyXG5cdFx0XHRcdFx0aWYgKHRoaXMuaXNBZGRlZEhvdFNwb3RTd2ltQmlrZSkgY29udGludWU7IC8vIG5vdCBhbGxvd2VkIHRvIGFkZCB0byBzYW1lIGhvdHNwb3RzXHJcblx0XHRcdFx0XHRpZiAoZ2VvbWJpa2UpIHtcclxuXHRcdFx0XHRcdFx0cG9pbnQgPSBvbC5wcm9qLnRyYW5zZm9ybShnZW9tYmlrZVswXSwgJ0VQU0c6Mzg1NycsICdFUFNHOjQzMjYnKTtcclxuXHRcdFx0XHRcdFx0dGhpcy5pc0FkZGVkSG90U3BvdFN3aW1CaWtlID0gdHJ1ZTtcclxuXHRcdFx0XHRcdH1cclxuXHRcdFx0XHR9IGVsc2UgaWYgKGhvdHNwb3QudHlwZSA9PT0gQ09ORklHLmhvdHNwb3QuY2FtQmlrZVJ1bikge1xyXG5cdFx0XHRcdFx0aWYgKHRoaXMuaXNBZGRlZEhvdFNwb3RCaWtlUnVuKSBjb250aW51ZTsgLy8gbm90IGFsbG93ZWQgdG8gYWRkIHRvIHNhbWUgaG90c3BvdHNcclxuXHRcdFx0XHRcdGlmIChnZW9tcnVuKSB7XHJcblx0XHRcdFx0XHRcdHBvaW50ID0gb2wucHJvai50cmFuc2Zvcm0oZ2VvbXJ1blswXSwgJ0VQU0c6Mzg1NycsICdFUFNHOjQzMjYnKTtcclxuXHRcdFx0XHRcdFx0dGhpcy5pc0FkZGVkSG90U3BvdEJpa2VSdW4gPSB0cnVlO1xyXG5cdFx0XHRcdFx0fVxyXG5cdFx0XHRcdH1cclxuXHRcdFx0XHRpZiAocG9pbnQpXHJcblx0XHRcdFx0XHRob3RzcG90LmluaXQocG9pbnQpO1xyXG5cdFx0XHR9XHJcblx0XHR9LFxyXG5cdFx0XHJcblx0XHRvbk1hcENsaWNrIDogZnVuY3Rpb24oZXZlbnQpIFxyXG5cdFx0e1xyXG5cdFx0XHRpZiAodGhpcy5kZWJ1Z1BhcnRpY2lwYW50KSBcclxuXHRcdFx0e1xyXG5cdFx0XHRcdHRoaXMuZGVidWdQYXJ0aWNpcGFudC5vbkRlYnVnQ2xpY2soZXZlbnQpO1xyXG5cdFx0XHR9XHJcblx0XHR9LFxyXG5cdFx0XHJcblx0XHR0ZXN0MSA6IGZ1bmN0aW9uKCkge1xyXG5cdFx0XHQvKmNvbnNvbGUubG9nKFwiI0JFR0lOTk5OTk5OTk5OTk5OTk5OTk5OTk5OTk5OTk5OTk5OTk5OTk5OXCIpXHJcblx0XHRcdGZvciAodmFyIGk9MDtpPDMwO2krKykgXHJcblx0XHRcdHtcclxuXHRcdFx0XHR2YXIgZWxhcHNlZCA9IGkvNjAuMDsgIC8vKCh0bSAtIHN0aW1lKS8xMDAwLjApL3RyYWNrSW5TZWNvbmRzICsgQ29uZmlnLnNpbXVsYXRpb24uc3RhcnRFbGFwc2VkO1xyXG5cdFx0XHRcdGlmIChlbGFwc2VkID4gMSlcclxuXHRcdFx0XHRcdGVsYXBzZWQ9MTtcclxuXHRcdFx0XHQvL3ZhciBwb3MgPSB0cmFjay5nZXRQb3NpdGlvbkFuZFJvdGF0aW9uRnJvbUVsYXBzZWQoZWxhcHNlZCk7XHJcblx0XHRcdFx0dmFyIHBvcyA9IHRoaXMuX19nZXRQb3NpdGlvbkFuZFJvdGF0aW9uRnJvbUVsYXBzZWQoZWxhcHNlZCk7XHJcblx0XHRcdFx0Y29uc29sZS5sb2coW01hdGgucm91bmQocG9zWzBdKjEwMDAwMDAuMCkvMTAwMDAwMC4wLE1hdGgucm91bmQocG9zWzFdKjEwMDAwMDAuMCkvMTAwMDAwMC4wXSk7XHJcblx0XHRcdH1cclxuXHRcdFx0Y29uc29sZS5sb2coXCIjRU5EXCIpOyovXHJcblx0XHR9XHJcblxyXG4gICAgfVxyXG59KTsiLCJ2YXIgdG9SYWRpYW5zID0gZnVuY3Rpb24oYW5nbGVEZWdyZWVzKSB7IHJldHVybiBhbmdsZURlZ3JlZXMgKiBNYXRoLlBJIC8gMTgwOyB9O1xyXG52YXIgdG9EZWdyZWVzID0gZnVuY3Rpb24oYW5nbGVSYWRpYW5zKSB7IHJldHVybiBhbmdsZVJhZGlhbnMgKiAxODAgLyBNYXRoLlBJOyB9O1xyXG5cclxudmFyIFdHUzg0U3BoZXJlID0gZnVuY3Rpb24ocmFkaXVzKSB7XHJcbiAgdGhpcy5yYWRpdXMgPSByYWRpdXM7XHJcbn07XHJcblxyXG5XR1M4NFNwaGVyZS5wcm90b3R5cGUuY29zaW5lRGlzdGFuY2UgPSBmdW5jdGlvbihjMSwgYzIpIHtcclxuICB2YXIgbGF0MSA9IHRvUmFkaWFucyhjMVsxXSk7XHJcbiAgdmFyIGxhdDIgPSB0b1JhZGlhbnMoYzJbMV0pO1xyXG4gIHZhciBkZWx0YUxvbiA9IHRvUmFkaWFucyhjMlswXSAtIGMxWzBdKTtcclxuICByZXR1cm4gdGhpcy5yYWRpdXMgKiBNYXRoLmFjb3MoXHJcbiAgICAgIE1hdGguc2luKGxhdDEpICogTWF0aC5zaW4obGF0MikgK1xyXG4gICAgICBNYXRoLmNvcyhsYXQxKSAqIE1hdGguY29zKGxhdDIpICogTWF0aC5jb3MoZGVsdGFMb24pKTtcclxufTtcclxuXHJcbldHUzg0U3BoZXJlLnByb3RvdHlwZS5nZW9kZXNpY0FyZWEgPSBmdW5jdGlvbihjb29yZGluYXRlcykge1xyXG4gIHZhciBhcmVhID0gMCwgbGVuID0gY29vcmRpbmF0ZXMubGVuZ3RoO1xyXG4gIHZhciB4MSA9IGNvb3JkaW5hdGVzW2xlbiAtIDFdWzBdO1xyXG4gIHZhciB5MSA9IGNvb3JkaW5hdGVzW2xlbiAtIDFdWzFdO1xyXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuOyBpKyspIHtcclxuICAgIHZhciB4MiA9IGNvb3JkaW5hdGVzW2ldWzBdLCB5MiA9IGNvb3JkaW5hdGVzW2ldWzFdO1xyXG4gICAgYXJlYSArPSB0b1JhZGlhbnMoeDIgLSB4MSkgKlxyXG4gICAgICAgICgyICsgTWF0aC5zaW4odG9SYWRpYW5zKHkxKSkgK1xyXG4gICAgICAgIE1hdGguc2luKHRvUmFkaWFucyh5MikpKTtcclxuICAgIHgxID0geDI7XHJcbiAgICB5MSA9IHkyO1xyXG4gIH1cclxuICByZXR1cm4gYXJlYSAqIHRoaXMucmFkaXVzICogdGhpcy5yYWRpdXMgLyAyLjA7XHJcbn07XHJcblxyXG5XR1M4NFNwaGVyZS5wcm90b3R5cGUuY3Jvc3NUcmFja0Rpc3RhbmNlID0gZnVuY3Rpb24oYzEsIGMyLCBjMykge1xyXG4gIHZhciBkMTMgPSB0aGlzLmNvc2luZURpc3RhbmNlKGMxLCBjMik7XHJcbiAgdmFyIHRoZXRhMTIgPSB0b1JhZGlhbnModGhpcy5pbml0aWFsQmVhcmluZyhjMSwgYzIpKTtcclxuICB2YXIgdGhldGExMyA9IHRvUmFkaWFucyh0aGlzLmluaXRpYWxCZWFyaW5nKGMxLCBjMykpO1xyXG4gIHJldHVybiB0aGlzLnJhZGl1cyAqXHJcbiAgICAgIE1hdGguYXNpbihNYXRoLnNpbihkMTMgLyB0aGlzLnJhZGl1cykgKiBNYXRoLnNpbih0aGV0YTEzIC0gdGhldGExMikpO1xyXG59O1xyXG5cclxuV0dTODRTcGhlcmUucHJvdG90eXBlLmVxdWlyZWN0YW5ndWxhckRpc3RhbmNlID0gZnVuY3Rpb24oYzEsIGMyKSB7XHJcbiAgdmFyIGxhdDEgPSB0b1JhZGlhbnMoYzFbMV0pO1xyXG4gIHZhciBsYXQyID0gdG9SYWRpYW5zKGMyWzFdKTtcclxuICB2YXIgZGVsdGFMb24gPSB0b1JhZGlhbnMoYzJbMF0gLSBjMVswXSk7XHJcbiAgdmFyIHggPSBkZWx0YUxvbiAqIE1hdGguY29zKChsYXQxICsgbGF0MikgLyAyKTtcclxuICB2YXIgeSA9IGxhdDIgLSBsYXQxO1xyXG4gIHJldHVybiB0aGlzLnJhZGl1cyAqIE1hdGguc3FydCh4ICogeCArIHkgKiB5KTtcclxufTtcclxuXHJcbldHUzg0U3BoZXJlLnByb3RvdHlwZS5maW5hbEJlYXJpbmcgPSBmdW5jdGlvbihjMSwgYzIpIHtcclxuICByZXR1cm4gKHRoaXMuaW5pdGlhbEJlYXJpbmcoYzIsIGMxKSArIDE4MCkgJSAzNjA7XHJcbn07XHJcblxyXG5XR1M4NFNwaGVyZS5wcm90b3R5cGUuaGF2ZXJzaW5lRGlzdGFuY2UgPSBmdW5jdGlvbihjMSwgYzIpIHtcclxuICB2YXIgbGF0MSA9IHRvUmFkaWFucyhjMVsxXSk7XHJcbiAgdmFyIGxhdDIgPSB0b1JhZGlhbnMoYzJbMV0pO1xyXG4gIHZhciBkZWx0YUxhdEJ5MiA9IChsYXQyIC0gbGF0MSkgLyAyO1xyXG4gIHZhciBkZWx0YUxvbkJ5MiA9IHRvUmFkaWFucyhjMlswXSAtIGMxWzBdKSAvIDI7XHJcbiAgdmFyIGEgPSBNYXRoLnNpbihkZWx0YUxhdEJ5MikgKiBNYXRoLnNpbihkZWx0YUxhdEJ5MikgK1xyXG4gICAgICBNYXRoLnNpbihkZWx0YUxvbkJ5MikgKiBNYXRoLnNpbihkZWx0YUxvbkJ5MikgKlxyXG4gICAgICBNYXRoLmNvcyhsYXQxKSAqIE1hdGguY29zKGxhdDIpO1xyXG4gIHJldHVybiAyICogdGhpcy5yYWRpdXMgKiBNYXRoLmF0YW4yKE1hdGguc3FydChhKSwgTWF0aC5zcXJ0KDEgLSBhKSk7XHJcbn07XHJcblxyXG5XR1M4NFNwaGVyZS5wcm90b3R5cGUuaW50ZXJwb2xhdGUgPSBmdW5jdGlvbihjMSwgYzIsIGZyYWN0aW9uKSB7XHJcbiAgdmFyIGxhdDEgPSB0b1JhZGlhbnMoYzFbMV0pO1xyXG4gIHZhciBsb24xID0gdG9SYWRpYW5zKGMxWzBdKTtcclxuICB2YXIgbGF0MiA9IHRvUmFkaWFucyhjMlsxXSk7XHJcbiAgdmFyIGxvbjIgPSB0b1JhZGlhbnMoYzJbMF0pO1xyXG4gIHZhciBjb3NMYXQxID0gTWF0aC5jb3MobGF0MSk7XHJcbiAgdmFyIHNpbkxhdDEgPSBNYXRoLnNpbihsYXQxKTtcclxuICB2YXIgY29zTGF0MiA9IE1hdGguY29zKGxhdDIpO1xyXG4gIHZhciBzaW5MYXQyID0gTWF0aC5zaW4obGF0Mik7XHJcbiAgdmFyIGNvc0RlbHRhTG9uID0gTWF0aC5jb3MobG9uMiAtIGxvbjEpO1xyXG4gIHZhciBkID0gc2luTGF0MSAqIHNpbkxhdDIgKyBjb3NMYXQxICogY29zTGF0MiAqIGNvc0RlbHRhTG9uO1xyXG4gIGlmICgxIDw9IGQpIHtcclxuICAgIHJldHVybiBjMi5zbGljZSgpO1xyXG4gIH1cclxuICBkID0gZnJhY3Rpb24gKiBNYXRoLmFjb3MoZCk7XHJcbiAgdmFyIGNvc0QgPSBNYXRoLmNvcyhkKTtcclxuICB2YXIgc2luRCA9IE1hdGguc2luKGQpO1xyXG4gIHZhciB5ID0gTWF0aC5zaW4obG9uMiAtIGxvbjEpICogY29zTGF0MjtcclxuICB2YXIgeCA9IGNvc0xhdDEgKiBzaW5MYXQyIC0gc2luTGF0MSAqIGNvc0xhdDIgKiBjb3NEZWx0YUxvbjtcclxuICB2YXIgdGhldGEgPSBNYXRoLmF0YW4yKHksIHgpO1xyXG4gIHZhciBsYXQgPSBNYXRoLmFzaW4oc2luTGF0MSAqIGNvc0QgKyBjb3NMYXQxICogc2luRCAqIE1hdGguY29zKHRoZXRhKSk7XHJcbiAgdmFyIGxvbiA9IGxvbjEgKyBNYXRoLmF0YW4yKE1hdGguc2luKHRoZXRhKSAqIHNpbkQgKiBjb3NMYXQxLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb3NEIC0gc2luTGF0MSAqIE1hdGguc2luKGxhdCkpO1xyXG4gIHJldHVybiBbdG9EZWdyZWVzKGxvbiksIHRvRGVncmVlcyhsYXQpXTtcclxufTtcclxuXHJcbldHUzg0U3BoZXJlLnByb3RvdHlwZS5pbml0aWFsQmVhcmluZyA9IGZ1bmN0aW9uKGMxLCBjMikge1xyXG4gIHZhciBsYXQxID0gdG9SYWRpYW5zKGMxWzFdKTtcclxuICB2YXIgbGF0MiA9IHRvUmFkaWFucyhjMlsxXSk7XHJcbiAgdmFyIGRlbHRhTG9uID0gdG9SYWRpYW5zKGMyWzBdIC0gYzFbMF0pO1xyXG4gIHZhciB5ID0gTWF0aC5zaW4oZGVsdGFMb24pICogTWF0aC5jb3MobGF0Mik7XHJcbiAgdmFyIHggPSBNYXRoLmNvcyhsYXQxKSAqIE1hdGguc2luKGxhdDIpIC1cclxuICAgICAgTWF0aC5zaW4obGF0MSkgKiBNYXRoLmNvcyhsYXQyKSAqIE1hdGguY29zKGRlbHRhTG9uKTtcclxuICByZXR1cm4gdG9EZWdyZWVzKE1hdGguYXRhbjIoeSwgeCkpO1xyXG59O1xyXG5cclxuV0dTODRTcGhlcmUucHJvdG90eXBlLm1heGltdW1MYXRpdHVkZSA9IGZ1bmN0aW9uKGJlYXJpbmcsIGxhdGl0dWRlKSB7XHJcbiAgcmV0dXJuIE1hdGguY29zKE1hdGguYWJzKE1hdGguc2luKHRvUmFkaWFucyhiZWFyaW5nKSkgKlxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICBNYXRoLmNvcyh0b1JhZGlhbnMobGF0aXR1ZGUpKSkpO1xyXG59O1xyXG5cclxuV0dTODRTcGhlcmUucHJvdG90eXBlLm1pZHBvaW50ID0gZnVuY3Rpb24oYzEsIGMyKSB7XHJcbiAgdmFyIGxhdDEgPSB0b1JhZGlhbnMoYzFbMV0pO1xyXG4gIHZhciBsYXQyID0gdG9SYWRpYW5zKGMyWzFdKTtcclxuICB2YXIgbG9uMSA9IHRvUmFkaWFucyhjMVswXSk7XHJcbiAgdmFyIGRlbHRhTG9uID0gdG9SYWRpYW5zKGMyWzBdIC0gYzFbMF0pO1xyXG4gIHZhciBCeCA9IE1hdGguY29zKGxhdDIpICogTWF0aC5jb3MoZGVsdGFMb24pO1xyXG4gIHZhciBCeSA9IE1hdGguY29zKGxhdDIpICogTWF0aC5zaW4oZGVsdGFMb24pO1xyXG4gIHZhciBjb3NMYXQxUGx1c0J4ID0gTWF0aC5jb3MobGF0MSkgKyBCeDtcclxuICB2YXIgbGF0ID0gTWF0aC5hdGFuMihNYXRoLnNpbihsYXQxKSArIE1hdGguc2luKGxhdDIpLFxyXG4gICAgICAgICAgICAgICAgICAgICAgIE1hdGguc3FydChjb3NMYXQxUGx1c0J4ICogY29zTGF0MVBsdXNCeCArIEJ5ICogQnkpKTtcclxuICB2YXIgbG9uID0gbG9uMSArIE1hdGguYXRhbjIoQnksIGNvc0xhdDFQbHVzQngpO1xyXG4gIHJldHVybiBbdG9EZWdyZWVzKGxvbiksIHRvRGVncmVlcyhsYXQpXTtcclxufTtcclxuXHJcbldHUzg0U3BoZXJlLnByb3RvdHlwZS5vZmZzZXQgPSBmdW5jdGlvbihjMSwgZGlzdGFuY2UsIGJlYXJpbmcpIHtcclxuICB2YXIgbGF0MSA9IHRvUmFkaWFucyhjMVsxXSk7XHJcbiAgdmFyIGxvbjEgPSB0b1JhZGlhbnMoYzFbMF0pO1xyXG4gIHZhciBkQnlSID0gZGlzdGFuY2UgLyB0aGlzLnJhZGl1cztcclxuICB2YXIgbGF0ID0gTWF0aC5hc2luKFxyXG4gICAgICBNYXRoLnNpbihsYXQxKSAqIE1hdGguY29zKGRCeVIpICtcclxuICAgICAgTWF0aC5jb3MobGF0MSkgKiBNYXRoLnNpbihkQnlSKSAqIE1hdGguY29zKGJlYXJpbmcpKTtcclxuICB2YXIgbG9uID0gbG9uMSArIE1hdGguYXRhbjIoXHJcbiAgICAgIE1hdGguc2luKGJlYXJpbmcpICogTWF0aC5zaW4oZEJ5UikgKiBNYXRoLmNvcyhsYXQxKSxcclxuICAgICAgTWF0aC5jb3MoZEJ5UikgLSBNYXRoLnNpbihsYXQxKSAqIE1hdGguc2luKGxhdCkpO1xyXG4gIHJldHVybiBbdG9EZWdyZWVzKGxvbiksIHRvRGVncmVlcyhsYXQpXTtcclxufTtcclxuXHJcbi8qKlxyXG4gKiBDaGVja3Mgd2hldGhlciBvYmplY3QgaXMgbm90IG51bGwgYW5kIG5vdCB1bmRlZmluZWRcclxuICogQHBhcmFtIHsqfSBvYmogb2JqZWN0IHRvIGJlIGNoZWNrZWRcclxuICogQHJldHVybiB7Ym9vbGVhbn1cclxuICovXHJcblxyXG5mdW5jdGlvbiBpc0RlZmluZWQob2JqKSB7XHJcbiAgICByZXR1cm4gbnVsbCAhPSBvYmogJiYgdW5kZWZpbmVkICE9IG9iajtcclxufVxyXG5cclxuZnVuY3Rpb24gaXNOdW1lcmljKHdoKSB7XHJcbiAgICByZXR1cm4gIWlzTmFOKHBhcnNlRmxvYXQod2gpKSAmJiBpc0Zpbml0ZSh3aCk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGlzRnVuY3Rpb24od2gpIHtcclxuICAgIGlmICghd2gpIHtcclxuICAgICAgICByZXR1cm4gZmFsc2U7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gKHdoIGluc3RhbmNlb2YgRnVuY3Rpb24gfHwgdHlwZW9mIHdoID09IFwiZnVuY3Rpb25cIik7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGlzU3RyaW5nTm90RW1wdHkod2gpIHtcclxuICAgIGlmICghd2gpIHtcclxuICAgICAgICByZXR1cm4gZmFsc2U7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gKHdoIGluc3RhbmNlb2YgU3RyaW5nIHx8IHR5cGVvZiB3aCA9PSBcInN0cmluZ1wiKTtcclxufVxyXG5cclxuZnVuY3Rpb24gaXNTdHIod2gpIHtcclxuICAgIHJldHVybiAod2ggaW5zdGFuY2VvZiBTdHJpbmcgfHwgdHlwZW9mIHdoID09PSBcInN0cmluZ1wiKTtcclxufVxyXG5cclxuZnVuY3Rpb24gaXNCb29sZWFuKHdoKSB7XHJcbiAgICByZXR1cm4gKHdoIGluc3RhbmNlb2YgQm9vbGVhbiB8fCB0eXBlb2Ygd2ggPT0gXCJib29sZWFuXCIpO1xyXG59XHJcblxyXG5mdW5jdGlvbiBteVRyaW0oeCkge1xyXG4gICAgcmV0dXJuIHgucmVwbGFjZSgvXlxccyt8XFxzKyQvZ20sJycpO1xyXG59XHJcblxyXG5mdW5jdGlvbiBteVRyaW1Db29yZGluYXRlKHgpIHtcclxuXHRkbyB7XHJcblx0XHR2YXIgaz14O1xyXG5cdFx0eD1teVRyaW0oeCk7XHJcblx0XHRpZiAoayAhPSB4KSBcclxuXHRcdFx0Y29udGludWU7XHJcblx0XHRpZiAoeC5sZW5ndGgpIFxyXG5cdFx0e1xyXG5cdFx0XHRpZiAoeFswXSA9PSBcIixcIilcclxuXHRcdFx0XHR4PXguc3Vic3RyaW5nKDEseC5sZW5ndGgpO1xyXG5cdFx0XHRlbHNlIGlmIChrW2subGVuZ3RoLTFdID09IFwiLFwiKVxyXG5cdFx0XHRcdHg9eC5zdWJzdHJpbmcoMCx4Lmxlbmd0aC0xKTtcclxuXHRcdFx0ZWxzZVxyXG5cdFx0XHRcdGJyZWFrO1xyXG5cdFx0XHRjb250aW51ZTtcclxuXHRcdH1cclxuXHRcdGJyZWFrO1xyXG5cdH0gd2hpbGUgKHRydWUpO1xyXG5cdHJldHVybiB4O1xyXG59XHJcblxyXG5cclxuZnVuY3Rpb24gY2xvc2VzdFByb2plY3Rpb25PZlBvaW50T25MaW5lKHgseSx4MSx5MSx4Mix5MikgXHJcbntcclxuXHR2YXIgc3RhdHVzO1xyXG5cdHZhciBQMT1udWxsO1xyXG5cdHZhciBQMj1udWxsO1xyXG5cdHZhciBQMz1udWxsO1xyXG5cdHZhciBQND1udWxsO1xyXG5cdHZhciBwMT1bXTtcclxuICAgIHZhciBwMj1bXTtcclxuICAgIHZhciBwMz1bXTtcclxuXHR2YXIgcDQ9W107XHJcbiAgICB2YXIgaW50ZXJzZWN0aW9uUG9pbnQ9bnVsbDtcclxuICAgIHZhciBkaXN0TWluUG9pbnQ9bnVsbDtcclxuICAgIHZhciBkZW5vbWluYXRvcj0wO1xyXG4gICAgdmFyIG5vbWluYXRvcj0wO1xyXG4gICAgdmFyIHU9MDtcclxuICAgIHZhciBkaXN0T3J0aG89MDtcclxuICAgIHZhciBkaXN0UDE9MDtcclxuICAgIHZhciBkaXN0UDI9MDtcclxuICAgIHZhciBkaXN0TWluPTA7XHJcbiAgICB2YXIgZGlzdE1heD0wO1xyXG4gICBcclxuICAgIGZ1bmN0aW9uIGludGVyc2VjdGlvbigpXHJcbiAgICB7XHJcbiAgICAgICAgdmFyIGF4ID0gcDFbMF0gKyB1ICogKHAyWzBdIC0gcDFbMF0pO1xyXG4gICAgICAgIHZhciBheSA9IHAxWzFdICsgdSAqIChwMlsxXSAtIHAxWzFdKTtcclxuICAgICAgICBwNCA9IFtheCwgYXldO1xyXG4gICAgICAgIGludGVyc2VjdGlvblBvaW50ID0gW2F4LGF5XTtcclxuICAgIH1cclxuXHJcbiAgICBmdW5jdGlvbiBkaXN0YW5jZSgpXHJcbiAgICB7XHJcbiAgICAgICAgdmFyIGF4ID0gcDFbMF0gKyB1ICogKHAyWzBdIC0gcDFbMF0pO1xyXG4gICAgICAgIHZhciBheSA9IHAxWzFdICsgdSAqIChwMlsxXSAtIHAxWzFdKTtcclxuICAgICAgICBwNCA9IFtheCwgYXldO1xyXG4gICAgICAgIGRpc3RPcnRobyA9IE1hdGguc3FydChNYXRoLnBvdygocDRbMF0gLSBwM1swXSksMikgKyBNYXRoLnBvdygocDRbMV0gLSBwM1sxXSksMikpO1xyXG4gICAgICAgIGRpc3RQMSAgICA9IE1hdGguc3FydChNYXRoLnBvdygocDFbMF0gLSBwM1swXSksMikgKyBNYXRoLnBvdygocDFbMV0gLSBwM1sxXSksMikpO1xyXG4gICAgICAgIGRpc3RQMiAgICA9IE1hdGguc3FydChNYXRoLnBvdygocDJbMF0gLSBwM1swXSksMikgKyBNYXRoLnBvdygocDJbMV0gLSBwM1sxXSksMikpO1xyXG4gICAgICAgIGlmKHU+PTAgJiYgdTw9MSlcclxuICAgICAgICB7ICAgZGlzdE1pbiA9IGRpc3RPcnRobztcclxuICAgICAgICAgICAgZGlzdE1pblBvaW50ID0gaW50ZXJzZWN0aW9uUG9pbnQ7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGVsc2VcclxuICAgICAgICB7ICAgaWYoZGlzdFAxIDw9IGRpc3RQMilcclxuICAgICAgICAgICAgeyAgIGRpc3RNaW4gPSBkaXN0UDE7XHJcbiAgICAgICAgICAgICAgICBkaXN0TWluUG9pbnQgPSBQMTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBlbHNlXHJcbiAgICAgICAgICAgIHsgICBkaXN0TWluID0gZGlzdFAyO1xyXG4gICAgICAgICAgICAgICAgZGlzdE1pblBvaW50ID0gUDI7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgICAgZGlzdE1heCA9IE1hdGgubWF4KE1hdGgubWF4KGRpc3RPcnRobywgZGlzdFAxKSwgZGlzdFAyKTtcclxuICAgIH1cclxuXHRQMSA9IFt4MSx5MV07XHJcblx0UDIgPSBbeDIseTJdO1xyXG5cdFAzID0gW3gseV07XHJcblx0cDEgPSBbeDEsIHkxXTtcclxuXHRwMiA9IFt4MiwgeTJdO1xyXG5cdHAzID0gW3gsIHldO1xyXG5cdGRlbm9taW5hdG9yID0gTWF0aC5wb3coTWF0aC5zcXJ0KE1hdGgucG93KHAyWzBdLXAxWzBdLDIpICsgTWF0aC5wb3cocDJbMV0tcDFbMV0sMikpLDIgKTtcclxuXHRub21pbmF0b3IgICA9IChwM1swXSAtIHAxWzBdKSAqIChwMlswXSAtIHAxWzBdKSArIChwM1sxXSAtIHAxWzFdKSAqIChwMlsxXSAtIHAxWzFdKTtcclxuXHRpZihkZW5vbWluYXRvcj09MClcclxuXHR7ICAgc3RhdHVzID0gXCJjb2luY2lkZW50YWxcIlxyXG5cdFx0dSA9IC05OTk7XHJcblx0fVxyXG5cdGVsc2VcclxuXHR7ICAgdSA9IG5vbWluYXRvciAvIGRlbm9taW5hdG9yO1xyXG5cdFx0aWYodSA+PTAgJiYgdSA8PSAxKVxyXG5cdFx0XHRzdGF0dXMgPSBcIm9ydGhvZ29uYWxcIjtcclxuXHRcdGVsc2VcclxuXHRcdFx0c3RhdHVzID0gXCJvYmxpcXVlXCI7XHJcblx0fVxyXG5cdGludGVyc2VjdGlvbigpO1xyXG5cdGRpc3RhbmNlKCk7XHJcblx0XHJcblx0cmV0dXJuIHsgc3RhdHVzIDogc3RhdHVzLCBwb3MgOiBkaXN0TWluUG9pbnQsIG1pbiA6IGRpc3RNaW4gfTtcclxufVxyXG5cclxuZnVuY3Rpb24gY29sb3JMdW1pbmFuY2UoaGV4LCBsdW0pIHtcclxuICAgIC8vIFZhbGlkYXRlIGhleCBzdHJpbmdcclxuICAgIGhleCA9IFN0cmluZyhoZXgpLnJlcGxhY2UoL1teMC05YS1mXS9naSwgXCJcIik7XHJcbiAgICBpZiAoaGV4Lmxlbmd0aCA8IDYpIHtcclxuICAgICAgICBoZXggPSBoZXgucmVwbGFjZSgvKC4pL2csICckMSQxJyk7XHJcbiAgICB9XHJcbiAgICBsdW0gPSBsdW0gfHwgMDtcclxuICAgIC8vIENvbnZlcnQgdG8gZGVjaW1hbCBhbmQgY2hhbmdlIGx1bWlub3NpdHlcclxuICAgIHZhciByZ2IgPSBcIiNcIixcclxuICAgICAgICBjO1xyXG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCAzOyArK2kpIHtcclxuICAgICAgICBjID0gcGFyc2VJbnQoaGV4LnN1YnN0cihpICogMiwgMiksIDE2KTtcclxuICAgICAgICBjID0gTWF0aC5yb3VuZChNYXRoLm1pbihNYXRoLm1heCgwLCBjICsgKGMgKiBsdW0pKSwgMjU1KSkudG9TdHJpbmcoMTYpO1xyXG4gICAgICAgIHJnYiArPSAoXCIwMFwiICsgYykuc3Vic3RyKGMubGVuZ3RoKTtcclxuICAgIH1cclxuICAgIHJldHVybiByZ2I7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGluY3JlYXNlQnJpZ2h0bmVzcyhoZXgsIHBlcmNlbnQpIFxyXG57XHJcbiAgICBoZXggPSBTdHJpbmcoaGV4KS5yZXBsYWNlKC9bXjAtOWEtZl0vZ2ksIFwiXCIpO1xyXG4gICAgaWYgKGhleC5sZW5ndGggPCA2KSB7XHJcbiAgICAgICAgaGV4ID0gaGV4LnJlcGxhY2UoLyguKS9nLCAnJDEkMScpO1xyXG4gICAgfVxyXG4gICAgdmFyIHJnYiA9IFwiI1wiLFxyXG4gICAgICAgIGM7XHJcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IDM7ICsraSkge1xyXG4gICAgICAgIGMgPSBwYXJzZUludChoZXguc3Vic3RyKGkgKiAyLCAyKSwgMTYpO1xyXG4gICAgICAgIGMgPSBwYXJzZUludCgoYyooMTAwLXBlcmNlbnQpKzI1NSpwZXJjZW50KS8xMDApO1xyXG4gICAgICAgIGlmIChjID4gMjU1KVxyXG4gICAgICAgIFx0Yz0yNTU7XHJcbiAgICAgICAgYz1jLnRvU3RyaW5nKDE2KTtcclxuICAgICAgICByZ2IgKz0gKFwiMDBcIiArIGMpLnN1YnN0cihjLmxlbmd0aCk7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gcmdiO1xyXG59XHJcblxyXG5mdW5jdGlvbiBjb2xvckFscGhhQXJyYXkoaGV4LCBhbHBoYSkge1xyXG4gICAgaGV4ID0gU3RyaW5nKGhleCkucmVwbGFjZSgvW14wLTlhLWZdL2dpLCBcIlwiKTtcclxuICAgIGlmIChoZXgubGVuZ3RoIDwgNikge1xyXG4gICAgICAgIGhleCA9IGhleC5yZXBsYWNlKC8oLikvZywgJyQxJDEnKTtcclxuICAgIH1cclxuICAgIHZhciByZXM9W107XHJcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IDM7ICsraSkge1xyXG4gICAgICAgIGMgPSBwYXJzZUludChoZXguc3Vic3RyKGkgKiAyLCAyKSwgMTYpO1xyXG4gICAgICAgIHJlcy5wdXNoKGMpO1xyXG4gICAgfVxyXG4gICAgcmVzLnB1c2goYWxwaGEpO1xyXG4gICAgcmV0dXJuIHJlcztcclxufVxyXG5cclxuZnVuY3Rpb24gZXNjYXBlSFRNTCh1bnNhZmUpIHtcclxuICAgIHJldHVybiB1bnNhZmVcclxuICAgICAgICAgLnJlcGxhY2UoLyYvZywgXCImYW1wO1wiKVxyXG4gICAgICAgICAucmVwbGFjZSgvPC9nLCBcIiZsdDtcIilcclxuICAgICAgICAgLnJlcGxhY2UoLz4vZywgXCImZ3Q7XCIpXHJcbiAgICAgICAgIC5yZXBsYWNlKC9cIi9nLCBcIiZxdW90O1wiKVxyXG4gICAgICAgICAucmVwbGFjZSgvJy9nLCBcIiYjMDM5O1wiKTtcclxuIH1cclxuXHJcbmZ1bmN0aW9uIGZvcm1hdE51bWJlcjIodmFsKSB7XHJcblx0cmV0dXJuIHBhcnNlRmxvYXQoTWF0aC5yb3VuZCh2YWwgKiAxMDApIC8gMTAwKS50b0ZpeGVkKDIpO1xyXG59XHJcbmZ1bmN0aW9uIGZvcm1hdERhdGUoZCkge1xyXG4gXHR2YXIgZGQgPSBkLmdldERhdGUoKTtcclxuICAgIHZhciBtbSA9IGQuZ2V0TW9udGgoKSsxOyAvL0phbnVhcnkgaXMgMCFcclxuICAgIHZhciB5eXl5ID0gZC5nZXRGdWxsWWVhcigpO1xyXG4gICAgaWYoZGQ8MTApe1xyXG4gICAgICAgIGRkPScwJytkZDtcclxuICAgIH0gXHJcbiAgICBpZihtbTwxMCl7XHJcbiAgICAgICAgbW09JzAnK21tO1xyXG4gICAgfSBcclxuICAgIHJldHVybiBkZCsnLicrbW0rJy4nK3l5eXk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGZvcm1hdFRpbWUoZCkge1xyXG4gICAgdmFyIGhoID0gZC5nZXRIb3VycygpO1xyXG4gICAgaWYoaGg8MTApe1xyXG4gICAgXHRoaD0nMCcraGg7XHJcbiAgICB9IFxyXG4gICAgdmFyIG1tID0gZC5nZXRNaW51dGVzKCk7XHJcbiAgICBpZihtbTwxMCl7XHJcbiAgICAgICAgbW09JzAnK21tO1xyXG4gICAgfSBcclxuICAgIHJldHVybiBoaCtcIjpcIittbTtcclxufVxyXG5cclxuZnVuY3Rpb24gZm9ybWF0RGF0ZVRpbWUoZCkge1xyXG5cdHJldHVybiBmb3JtYXREYXRlKGQpK1wiIFwiK2Zvcm1hdFRpbWUoZCk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGZvcm1hdERhdGVUaW1lU2VjKGQpIHtcclxuXHRyZXR1cm4gZm9ybWF0RGF0ZShkKStcIiBcIitmb3JtYXRUaW1lU2VjKGQpO1xyXG59XHJcblxyXG5mdW5jdGlvbiBmb3JtYXRUaW1lU2VjKGQpIHtcclxuICAgIHZhciBoaCA9IGQuZ2V0SG91cnMoKTtcclxuICAgIGlmKGhoPDEwKXtcclxuICAgIFx0aGg9JzAnK2hoO1xyXG4gICAgfSBcclxuICAgIHZhciBtbSA9IGQuZ2V0TWludXRlcygpO1xyXG4gICAgaWYobW08MTApe1xyXG4gICAgICAgIG1tPScwJyttbTtcclxuICAgIH0gXHJcbiAgICB2YXIgc3MgPSBkLmdldFNlY29uZHMoKTtcclxuICAgIGlmKHNzPDEwKXtcclxuICAgICAgICBzcz0nMCcrc3M7XHJcbiAgICB9IFxyXG4gICAgcmV0dXJuIGhoK1wiOlwiK21tK1wiOlwiK3NzO1xyXG59XHJcblxyXG5mdW5jdGlvbiByYWluYm93KG51bU9mU3RlcHMsIHN0ZXApIHtcclxuICAgIC8vIFRoaXMgZnVuY3Rpb24gZ2VuZXJhdGVzIHZpYnJhbnQsIFwiZXZlbmx5IHNwYWNlZFwiIGNvbG91cnMgKGkuZS4gbm8gY2x1c3RlcmluZykuIFRoaXMgaXMgaWRlYWwgZm9yIGNyZWF0aW5nIGVhc2lseSBkaXN0aW5ndWlzaGFibGUgdmlicmFudCBtYXJrZXJzIGluIEdvb2dsZSBNYXBzIGFuZCBvdGhlciBhcHBzLlxyXG4gICAgLy8gQWRhbSBDb2xlLCAyMDExLVNlcHQtMTRcclxuICAgIC8vIEhTViB0byBSQkcgYWRhcHRlZCBmcm9tOiBodHRwOi8vbWppamFja3Nvbi5jb20vMjAwOC8wMi9yZ2ItdG8taHNsLWFuZC1yZ2ItdG8taHN2LWNvbG9yLW1vZGVsLWNvbnZlcnNpb24tYWxnb3JpdGhtcy1pbi1qYXZhc2NyaXB0XHJcbiAgICB2YXIgciwgZywgYjtcclxuICAgIHZhciBoID0gc3RlcCAvIG51bU9mU3RlcHM7XHJcbiAgICB2YXIgaSA9IH5+KGggKiA2KTtcclxuICAgIHZhciBmID0gaCAqIDYgLSBpO1xyXG4gICAgdmFyIHEgPSAxIC0gZjtcclxuICAgIHN3aXRjaChpICUgNil7XHJcbiAgICAgICAgY2FzZSAwOiByID0gMSwgZyA9IGYsIGIgPSAwOyBicmVhaztcclxuICAgICAgICBjYXNlIDE6IHIgPSBxLCBnID0gMSwgYiA9IDA7IGJyZWFrO1xyXG4gICAgICAgIGNhc2UgMjogciA9IDAsIGcgPSAxLCBiID0gZjsgYnJlYWs7XHJcbiAgICAgICAgY2FzZSAzOiByID0gMCwgZyA9IHEsIGIgPSAxOyBicmVhaztcclxuICAgICAgICBjYXNlIDQ6IHIgPSBmLCBnID0gMCwgYiA9IDE7IGJyZWFrO1xyXG4gICAgICAgIGNhc2UgNTogciA9IDEsIGcgPSAwLCBiID0gcTsgYnJlYWs7XHJcbiAgICB9XHJcbiAgICB2YXIgYyA9IFwiI1wiICsgKFwiMDBcIiArICh+IH4ociAqIDI1NSkpLnRvU3RyaW5nKDE2KSkuc2xpY2UoLTIpICsgKFwiMDBcIiArICh+IH4oZyAqIDI1NSkpLnRvU3RyaW5nKDE2KSkuc2xpY2UoLTIpICsgKFwiMDBcIiArICh+IH4oYiAqIDI1NSkpLnRvU3RyaW5nKDE2KSkuc2xpY2UoLTIpO1xyXG4gICAgcmV0dXJuIChjKTtcclxufVxyXG5cclxuZnVuY3Rpb24gbW9iaWxlQW5kVGFibGV0Q2hlY2soKSBcclxue1xyXG5cdCAgaWYgKHR5cGVvZiBuYXZpZ2F0b3IgPT0gXCJ1bmRlZmluZWRcIilcclxuXHRcdCAgcmV0dXJuIGZhbHNlO1xyXG5cdCAgdmFyIGNoZWNrID0gZmFsc2U7XHJcblx0ICAoZnVuY3Rpb24oYSl7aWYoLyhhbmRyb2lkfGJiXFxkK3xtZWVnbykuK21vYmlsZXxhdmFudGdvfGJhZGFcXC98YmxhY2tiZXJyeXxibGF6ZXJ8Y29tcGFsfGVsYWluZXxmZW5uZWN8aGlwdG9wfGllbW9iaWxlfGlwKGhvbmV8b2QpfGlyaXN8a2luZGxlfGxnZSB8bWFlbW98bWlkcHxtbXB8bW9iaWxlLitmaXJlZm94fG5ldGZyb250fG9wZXJhIG0ob2J8aW4paXxwYWxtKCBvcyk/fHBob25lfHAoaXhpfHJlKVxcL3xwbHVja2VyfHBvY2tldHxwc3B8c2VyaWVzKDR8NikwfHN5bWJpYW58dHJlb3x1cFxcLihicm93c2VyfGxpbmspfHZvZGFmb25lfHdhcHx3aW5kb3dzIGNlfHhkYXx4aWlub3xhbmRyb2lkfGlwYWR8cGxheWJvb2t8c2lsay9pLnRlc3QoYSl8fC8xMjA3fDYzMTB8NjU5MHwzZ3NvfDR0aHB8NTBbMS02XWl8Nzcwc3w4MDJzfGEgd2F8YWJhY3xhYyhlcnxvb3xzXFwtKXxhaShrb3xybil8YWwoYXZ8Y2F8Y28pfGFtb2l8YW4oZXh8bnl8eXcpfGFwdHV8YXIoY2h8Z28pfGFzKHRlfHVzKXxhdHR3fGF1KGRpfFxcLW18ciB8cyApfGF2YW58YmUoY2t8bGx8bnEpfGJpKGxifHJkKXxibChhY3xheil8YnIoZXx2KXd8YnVtYnxid1xcLShufHUpfGM1NVxcL3xjYXBpfGNjd2F8Y2RtXFwtfGNlbGx8Y2h0bXxjbGRjfGNtZFxcLXxjbyhtcHxuZCl8Y3Jhd3xkYShpdHxsbHxuZyl8ZGJ0ZXxkY1xcLXN8ZGV2aXxkaWNhfGRtb2J8ZG8oY3xwKW98ZHMoMTJ8XFwtZCl8ZWwoNDl8YWkpfGVtKGwyfHVsKXxlcihpY3xrMCl8ZXNsOHxleihbNC03XTB8b3N8d2F8emUpfGZldGN8Zmx5KFxcLXxfKXxnMSB1fGc1NjB8Z2VuZXxnZlxcLTV8Z1xcLW1vfGdvKFxcLnd8b2QpfGdyKGFkfHVuKXxoYWllfGhjaXR8aGRcXC0obXxwfHQpfGhlaVxcLXxoaShwdHx0YSl8aHAoIGl8aXApfGhzXFwtY3xodChjKFxcLXwgfF98YXxnfHB8c3x0KXx0cCl8aHUoYXd8dGMpfGlcXC0oMjB8Z298bWEpfGkyMzB8aWFjKCB8XFwtfFxcLyl8aWJyb3xpZGVhfGlnMDF8aWtvbXxpbTFrfGlubm98aXBhcXxpcmlzfGphKHR8dilhfGpicm98amVtdXxqaWdzfGtkZGl8a2VqaXxrZ3QoIHxcXC8pfGtsb258a3B0IHxrd2NcXC18a3lvKGN8ayl8bGUobm98eGkpfGxnKCBnfFxcLyhrfGx8dSl8NTB8NTR8XFwtW2Etd10pfGxpYnd8bHlueHxtMVxcLXd8bTNnYXxtNTBcXC98bWEodGV8dWl8eG8pfG1jKDAxfDIxfGNhKXxtXFwtY3J8bWUocmN8cmkpfG1pKG84fG9hfHRzKXxtbWVmfG1vKDAxfDAyfGJpfGRlfGRvfHQoXFwtfCB8b3x2KXx6eil8bXQoNTB8cDF8diApfG13YnB8bXl3YXxuMTBbMC0yXXxuMjBbMi0zXXxuMzAoMHwyKXxuNTAoMHwyfDUpfG43KDAoMHwxKXwxMCl8bmUoKGN8bSlcXC18b258dGZ8d2Z8d2d8d3QpfG5vayg2fGkpfG56cGh8bzJpbXxvcCh0aXx3dil8b3Jhbnxvd2cxfHA4MDB8cGFuKGF8ZHx0KXxwZHhnfHBnKDEzfFxcLShbMS04XXxjKSl8cGhpbHxwaXJlfHBsKGF5fHVjKXxwblxcLTJ8cG8oY2t8cnR8c2UpfHByb3h8cHNpb3xwdFxcLWd8cWFcXC1hfHFjKDA3fDEyfDIxfDMyfDYwfFxcLVsyLTddfGlcXC0pfHF0ZWt8cjM4MHxyNjAwfHJha3N8cmltOXxybyh2ZXx6byl8czU1XFwvfHNhKGdlfG1hfG1tfG1zfG55fHZhKXxzYygwMXxoXFwtfG9vfHBcXC0pfHNka1xcL3xzZShjKFxcLXwwfDEpfDQ3fG1jfG5kfHJpKXxzZ2hcXC18c2hhcnxzaWUoXFwtfG0pfHNrXFwtMHxzbCg0NXxpZCl8c20oYWx8YXJ8YjN8aXR8dDUpfHNvKGZ0fG55KXxzcCgwMXxoXFwtfHZcXC18diApfHN5KDAxfG1iKXx0MigxOHw1MCl8dDYoMDB8MTB8MTgpfHRhKGd0fGxrKXx0Y2xcXC18dGRnXFwtfHRlbChpfG0pfHRpbVxcLXx0XFwtbW98dG8ocGx8c2gpfHRzKDcwfG1cXC18bTN8bTUpfHR4XFwtOXx1cChcXC5ifGcxfHNpKXx1dHN0fHY0MDB8djc1MHx2ZXJpfHZpKHJnfHRlKXx2ayg0MHw1WzAtM118XFwtdil8dm00MHx2b2RhfHZ1bGN8dngoNTJ8NTN8NjB8NjF8NzB8ODB8ODF8ODN8ODV8OTgpfHczYyhcXC18ICl8d2ViY3x3aGl0fHdpKGcgfG5jfG53KXx3bWxifHdvbnV8eDcwMHx5YXNcXC18eW91cnx6ZXRvfHp0ZVxcLS9pLnRlc3QoYS5zdWJzdHIoMCw0KSkpY2hlY2sgPSB0cnVlfSkobmF2aWdhdG9yLnVzZXJBZ2VudHx8bmF2aWdhdG9yLnZlbmRvcnx8d2luZG93Lm9wZXJhKTtcclxuXHQgIHJldHVybiBjaGVjaztcclxufVxyXG5cclxudmFyIFJFTkRFUkVEQVJST1dTPXt9O1xyXG5mdW5jdGlvbiByZW5kZXJBcnJvd0Jhc2U2NCh3aWR0aCxoZWlnaHQsY29sb3IpIFxyXG57XHJcblx0dmFyIGtleSA9IHdpZHRoK1wieFwiK2hlaWdodCtcIjpcIitjb2xvcjtcclxuXHRpZiAoUkVOREVSRURBUlJPV1Nba2V5XSlcclxuXHRcdHJldHVybiBSRU5ERVJFREFSUk9XU1trZXldO1xyXG5cdHZhciBicmRjb2wgPSBcIiNmZWZlZmVcIjsgLy9pbmNyZWFzZUJyaWdodG5lc3MoY29sb3IsOTkpO1xyXG5cdFxyXG5cdHZhciBzdmc9JzxzdmcgdmVyc2lvbj1cIjEuMVwiIGlkPVwiTGF5ZXJfMVwiIHhtbG5zPVwiaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmdcIiB4bWxuczp4bGluaz1cImh0dHA6Ly93d3cudzMub3JnLzE5OTkveGxpbmtcIiB4PVwiMHB4XCIgeT1cIjBweFwiIHdpZHRoPVwiJyt3aWR0aCsncHRcIiBoZWlnaHQ9XCInK2hlaWdodCsncHRcIiAnXHRcclxuXHQrJ3ZpZXdCb3g9XCIxMzcuODM0IC04Mi44MzMgMTE0IDkxLjMzM1wiIGVuYWJsZS1iYWNrZ3JvdW5kPVwibmV3IDEzNy44MzQgLTgyLjgzMyAxMTQgOTEuMzMzXCIgeG1sOnNwYWNlPVwicHJlc2VydmVcIj4nXHJcblx0Kyc8cGF0aCBmaWxsPVwibm9uZVwiIGQ9XCJNLTUxLTIuMTY3aDQ4djQ4aC00OFYtMi4xNjd6XCIvPidcclxuXHQrJzxjaXJjbGUgZGlzcGxheT1cIm5vbmVcIiBmaWxsPVwiIzYwNUNDOVwiIGN4PVwiNTEuMjg2XCIgY3k9XCItMzUuMjg2XCIgcj1cIjg4Ljc4NlwiLz4nXHJcblx0Kyc8cGF0aCBmaWxsPVwiIzYwNUNDOVwiIHN0cm9rZT1cIiNGRkZGRkZcIiBzdHJva2Utd2lkdGg9XCI0XCIgc3Ryb2tlLW1pdGVybGltaXQ9XCIxMFwiIGQ9XCJNMjM5LjUtMzYuOGwtOTIuNTU4LTM1LjY5IGM1LjIxNiwxMS4zMDQsOC4xMywyMy44ODcsOC4xMywzNy4xNTNjMCwxMi4xNy0yLjQ1MSwyMy43NjctNi44ODMsMzQuMzI3TDIzOS41LTM2Ljh6XCIvPidcclxuXHQrJzwvc3ZnPidcclxuXHR2YXIgc3ZnPXN2Zy5zcGxpdChcIiM2MDVDQzlcIikuam9pbihjb2xvcik7XHJcblx0dmFyIGNhbnZhcyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2NhbnZhcycpO1xyXG4gICAgY2FudmFzLndpZHRoID0gd2lkdGg7XHJcbiAgICBjYW52YXMuaGVpZ2h0ID0gaGVpZ2h0O1xyXG4gICAgY2FudmcoY2FudmFzLCBzdmcseyBpZ25vcmVNb3VzZTogdHJ1ZSwgaWdub3JlQW5pbWF0aW9uOiB0cnVlIH0pO1xyXG4gICAgcmV0dXJuIFJFTkRFUkVEQVJST1dTW2tleV09Y2FudmFzLnRvRGF0YVVSTCgpO1xyXG59XHJcblxyXG52YXIgUkVOREVSRURESVJFQ1RJT05TPXt9O1xyXG5mdW5jdGlvbiByZW5kZXJEaXJlY3Rpb25CYXNlNjQod2lkdGgsaGVpZ2h0LGNvbG9yKSBcclxue1xyXG5cdHZhciBrZXkgPSB3aWR0aCtcInhcIitoZWlnaHQrXCI6XCIrY29sb3I7XHJcblx0aWYgKFJFTkRFUkVERElSRUNUSU9OU1trZXldKVxyXG5cdFx0cmV0dXJuIFJFTkRFUkVERElSRUNUSU9OU1trZXldO1xyXG5cclxuXHR2YXIgc3ZnPSc8c3ZnIHdpZHRoPVwiJyt3aWR0aCsncHRcIiBoZWlnaHQ9XCInK2hlaWdodCsncHRcIiAnXHJcblxyXG5cdFx0Kyd2aWV3Qm94PVwiMTUgOSAxOS43NSAyOS41XCIgZW5hYmxlLWJhY2tncm91bmQ9XCJuZXcgMTUgOSAxOS43NSAyOS41XCIgeG1sOnNwYWNlPVwicHJlc2VydmVcIj4nXHJcblx0XHQrJzxwYXRoIGZpbGw9XCIjRkZGRUZGXCIgZD1cIk0xNy4xNywzMi45Mmw5LjE3LTkuMTdsLTkuMTctOS4xN0wyMCwxMS43NWwxMiwxMmwtMTIsMTJMMTcuMTcsMzIuOTJ6XCIvPidcclxuXHRcdCsnPHBhdGggZmlsbD1cIm5vbmVcIiBkPVwiTTAtMC4yNWg0OHY0OEgwVi0wLjI1elwiLz4nXHJcblxyXG5cdCsnPC9zdmc+JztcclxuXHJcblx0dmFyIHN2Zz1zdmcuc3BsaXQoXCIjMDAwMDAwXCIpLmpvaW4oY29sb3IpO1xyXG5cdHZhciBjYW52YXMgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdjYW52YXMnKTtcclxuICAgIGNhbnZhcy53aWR0aCA9IHdpZHRoO1xyXG4gICAgY2FudmFzLmhlaWdodCA9IGhlaWdodDtcclxuICAgIGNhbnZnKGNhbnZhcywgc3ZnLHsgaWdub3JlTW91c2U6IHRydWUsIGlnbm9yZUFuaW1hdGlvbjogdHJ1ZSB9KTtcclxuICAgIHJldHVybiBSRU5ERVJFRERJUkVDVElPTlNba2V5XT1jYW52YXMudG9EYXRhVVJMKCk7XHJcbn1cclxuXHJcbnZhciBSRU5ERVJFQk9YRVM9e307XHJcbmZ1bmN0aW9uIHJlbmRlckJveEJhc2U2NCh3aWR0aCxoZWlnaHQsY29sb3IpIFxyXG57XHJcblx0dmFyIGtleSA9IHdpZHRoK1wieFwiK2hlaWdodCtcIjpcIitjb2xvcjtcclxuXHRpZiAoUkVOREVSRUJPWEVTW2tleV0pXHJcblx0XHRyZXR1cm4gUkVOREVSRUJPWEVTW2tleV07XHJcblxyXG5cdHZhciBzdmc9Jzxzdmcgd2lkdGg9XCInK3dpZHRoKydwdFwiIGhlaWdodD1cIicraGVpZ2h0KydwdFwiIHZpZXdCb3g9XCIwIDAgNTEyIDUxMlwiIHZlcnNpb249XCIxLjFcIiB4bWxucz1cImh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnXCI+J1xyXG5cdCsnPGcgaWQ9XCIjZmZmZmZmZmZcIj4nXHJcblx0Kyc8cGF0aCBmaWxsPVwiI2ZmZmZmZlwiIG9wYWNpdHk9XCIxLjAwXCIgZD1cIiBNIDU1LjUwIDAuMDAgTCA0NTguNDUgMC4wMCBDIDQ3Mi40NCAwLjk5IDQ4Ni4wMyA3LjA5IDQ5NS43OCAxNy4yMyBDIDUwNS4zNCAyNi44OCA1MTEuMDEgNDAuMDQgNTEyLjAwIDUzLjU1IEwgNTEyLjAwIDQ1OC40NCBDIDUxMC45OSA0NzIuNDMgNTA0LjkwIDQ4Ni4wMSA0OTQuNzcgNDk1Ljc3IEMgNDg1LjExIDUwNS4zMiA0NzEuOTYgNTExLjAxIDQ1OC40NSA1MTIuMDAgTCA1My41NiA1MTIuMDAgQyAzOS41NyA1MTAuOTkgMjUuOTcgNTA0LjkxIDE2LjIyIDQ5NC43OCBDIDYuNjcgNDg1LjEyIDAuOTcgNDcxLjk3IDAuMDAgNDU4LjQ1IEwgMC4wMCA1NS41MCBDIDAuNDAgNDEuMDcgNi40NSAyNi44OSAxNi43NCAxNi43MyBDIDI2Ljg5IDYuNDUgNDEuMDcgMC40MSA1NS41MCAwLjAwIE0gNTYuOTAgNTYuOTAgQyA1Ni44NyAxODkuNjMgNTYuODYgMzIyLjM2IDU2LjkwIDQ1NS4wOSBDIDE4OS42MyA0NTUuMTIgMzIyLjM2IDQ1NS4xMiA0NTUuMDkgNDU1LjA5IEMgNDU1LjEyIDMyMi4zNiA0NTUuMTIgMTg5LjYzIDQ1NS4wOSA1Ni45MCBDIDMyMi4zNiA1Ni44NiAxODkuNjMgNTYuODcgNTYuOTAgNTYuOTAgWlwiIC8+J1xyXG5cdCsnPC9nPidcclxuXHQrJzxnIGlkPVwiIzAwMDAwMGZmXCI+J1xyXG5cdCsnPHBhdGggZmlsbD1cIiMwMDAwMDBcIiBvcGFjaXR5PVwiMS4wMFwiIGQ9XCIgTSA1Ni45MCA1Ni45MCBDIDE4OS42MyA1Ni44NyAzMjIuMzYgNTYuODYgNDU1LjA5IDU2LjkwIEMgNDU1LjEyIDE4OS42MyA0NTUuMTIgMzIyLjM2IDQ1NS4wOSA0NTUuMDkgQyAzMjIuMzYgNDU1LjEyIDE4OS42MyA0NTUuMTIgNTYuOTAgNDU1LjA5IEMgNTYuODYgMzIyLjM2IDU2Ljg3IDE4OS42MyA1Ni45MCA1Ni45MCBaXCIgLz4nXHJcblx0Kyc8L2c+J1xyXG5cdCsnPC9zdmc+JztcclxuXHJcblx0dmFyIHN2Zz1zdmcuc3BsaXQoXCIjMDAwMDAwXCIpLmpvaW4oY29sb3IpO1xyXG5cdHZhciBjYW52YXMgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdjYW52YXMnKTtcclxuICAgIGNhbnZhcy53aWR0aCA9IHdpZHRoO1xyXG4gICAgY2FudmFzLmhlaWdodCA9IGhlaWdodDtcclxuICAgIGNhbnZnKGNhbnZhcywgc3ZnLHsgaWdub3JlTW91c2U6IHRydWUsIGlnbm9yZUFuaW1hdGlvbjogdHJ1ZSB9KTtcclxuICAgIHJldHVybiBSRU5ERVJFQk9YRVNba2V5XT1jYW52YXMudG9EYXRhVVJMKCk7XHJcbn1cclxuXHJcblxyXG5mdW5jdGlvbiBpbnRlcmNlcHRPbkNpcmNsZShhLGIsYyxyKSB7XHJcblx0cmV0dXJuIGNpcmNsZUxpbmVJbnRlcnNlY3QoYVswXSxhWzFdLGJbMF0sYlsxXSxjWzBdLGNbMV0scik7XHRcclxufVxyXG5mdW5jdGlvbiBkaXN0cChwMSxwMikge1xyXG5cdCAgcmV0dXJuIE1hdGguc3FydCgocDJbMF0tcDFbMF0pKihwMlswXS1wMVswXSkrKHAyWzFdLXAxWzFdKSoocDJbMV0tcDFbMV0pKTtcclxufVxyXG5cclxuZnVuY3Rpb24gY2lyY2xlTGluZUludGVyc2VjdCh4MSwgeTEsIHgyLCB5MiwgY3gsIGN5LCBjciApIFxyXG57XHJcblx0ICBmdW5jdGlvbiBkaXN0KHgxLHkxLHgyLHkyKSB7XHJcblx0XHQgIHJldHVybiBNYXRoLnNxcnQoKHgyLXgxKSooeDIteDEpKyh5Mi15MSkqKHkyLXkxKSk7XHJcblx0ICB9XHJcblx0ICB2YXIgZHggPSB4MiAtIHgxO1xyXG5cdCAgdmFyIGR5ID0geTIgLSB5MTtcclxuXHQgIHZhciBhID0gZHggKiBkeCArIGR5ICogZHk7XHJcblx0ICB2YXIgYiA9IDIgKiAoZHggKiAoeDEgLSBjeCkgKyBkeSAqICh5MSAtIGN5KSk7XHJcblx0ICB2YXIgYyA9IGN4ICogY3ggKyBjeSAqIGN5O1xyXG5cdCAgYyArPSB4MSAqIHgxICsgeTEgKiB5MTtcclxuXHQgIGMgLT0gMiAqIChjeCAqIHgxICsgY3kgKiB5MSk7XHJcblx0ICBjIC09IGNyICogY3I7XHJcblx0ICB2YXIgYmI0YWMgPSBiICogYiAtIDQgKiBhICogYztcclxuXHQgIGlmIChiYjRhYyA8IDApIHsgIC8vIE5vdCBpbnRlcnNlY3RpbmdcclxuXHQgICAgcmV0dXJuIGZhbHNlO1xyXG5cdCAgfSBlbHNlIHtcclxuXHRcdHZhciBtdSA9ICgtYiArIE1hdGguc3FydCggYipiIC0gNCphKmMgKSkgLyAoMiphKTtcclxuXHRcdHZhciBpeDEgPSB4MSArIG11KihkeCk7XHJcblx0XHR2YXIgaXkxID0geTEgKyBtdSooZHkpO1xyXG5cdCAgICBtdSA9ICgtYiAtIE1hdGguc3FydChiKmIgLSA0KmEqYyApKSAvICgyKmEpO1xyXG5cdCAgICB2YXIgaXgyID0geDEgKyBtdSooZHgpO1xyXG5cdCAgICB2YXIgaXkyID0geTEgKyBtdSooZHkpO1xyXG5cclxuXHQgICAgLy8gVGhlIGludGVyc2VjdGlvbiBwb2ludHNcclxuXHQgICAgLy9lbGxpcHNlKGl4MSwgaXkxLCAxMCwgMTApO1xyXG5cdCAgICAvL2VsbGlwc2UoaXgyLCBpeTIsIDEwLCAxMCk7XHJcblx0ICAgIFxyXG5cdCAgICB2YXIgdGVzdFg7XHJcblx0ICAgIHZhciB0ZXN0WTtcclxuXHQgICAgLy8gRmlndXJlIG91dCB3aGljaCBwb2ludCBpcyBjbG9zZXIgdG8gdGhlIGNpcmNsZVxyXG5cdCAgICBpZiAoZGlzdCh4MSwgeTEsIGN4LCBjeSkgPCBkaXN0KHgyLCB5MiwgY3gsIGN5KSkge1xyXG5cdCAgICAgIHRlc3RYID0geDI7XHJcblx0ICAgICAgdGVzdFkgPSB5MjtcclxuXHQgICAgfSBlbHNlIHtcclxuXHQgICAgICB0ZXN0WCA9IHgxO1xyXG5cdCAgICAgIHRlc3RZID0geTE7XHJcblx0ICAgIH1cclxuXHQgICAgIFxyXG5cdCAgICBpZiAoZGlzdCh0ZXN0WCwgdGVzdFksIGl4MSwgaXkxKSA8IGRpc3QoeDEsIHkxLCB4MiwgeTIpIHx8IGRpc3QodGVzdFgsIHRlc3RZLCBpeDIsIGl5MikgPCBkaXN0KHgxLCB5MSwgeDIsIHkyKSkge1xyXG5cdCAgICAgIHJldHVybiBbIFtpeDEsaXkxXSxbaXgyLGl5Ml0gXTtcclxuXHQgICAgfSBlbHNlIHtcclxuXHQgICAgICByZXR1cm4gZmFsc2U7XHJcblx0ICAgIH1cclxuXHQgIH1cclxufVxyXG5cclxuZnVuY3Rpb24gZGVjb2RlQmFzZTY0SW1hZ2UoZGF0YVN0cmluZykge1xyXG5cdCAgdmFyIG1hdGNoZXMgPSBkYXRhU3RyaW5nLm1hdGNoKC9eZGF0YTooW0EtWmEtei0rXFwvXSspO2Jhc2U2NCwoLispJC8pLFxyXG5cdCAgICByZXNwb25zZSA9IHt9O1xyXG5cdCAgaWYgKG1hdGNoZXMubGVuZ3RoICE9PSAzKSB7XHJcblx0ICAgIHJldHVybiBuZXcgRXJyb3IoJ0ludmFsaWQgaW5wdXQgc3RyaW5nJyk7XHJcblx0ICB9XHJcblx0ICByZXNwb25zZS50eXBlID0gbWF0Y2hlc1sxXTtcclxuXHQgIHJlc3BvbnNlLmRhdGEgPSBuZXcgQnVmZmVyKG1hdGNoZXNbMl0sICdiYXNlNjQnKTtcclxuXHQgIHJldHVybiByZXNwb25zZTtcclxuXHR9XHJcblxyXG4vLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5leHBvcnRzLm15VHJpbT1teVRyaW07XHJcbmV4cG9ydHMubXlUcmltQ29vcmRpbmF0ZT1teVRyaW1Db29yZGluYXRlO1xyXG5leHBvcnRzLmNsb3Nlc3RQcm9qZWN0aW9uT2ZQb2ludE9uTGluZT1jbG9zZXN0UHJvamVjdGlvbk9mUG9pbnRPbkxpbmU7XHJcbmV4cG9ydHMuY29sb3JMdW1pbmFuY2U9Y29sb3JMdW1pbmFuY2U7XHJcbmV4cG9ydHMuaW5jcmVhc2VCcmlnaHRuZXNzPWluY3JlYXNlQnJpZ2h0bmVzcztcclxuZXhwb3J0cy5jb2xvckFscGhhQXJyYXk9Y29sb3JBbHBoYUFycmF5O1xyXG5leHBvcnRzLmVzY2FwZUhUTUw9ZXNjYXBlSFRNTDtcclxuZXhwb3J0cy5mb3JtYXROdW1iZXIyPWZvcm1hdE51bWJlcjI7XHJcbmV4cG9ydHMuZm9ybWF0RGF0ZVRpbWU9Zm9ybWF0RGF0ZVRpbWU7XHJcbmV4cG9ydHMuZm9ybWF0RGF0ZVRpbWVTZWM9Zm9ybWF0RGF0ZVRpbWVTZWM7XHJcbmV4cG9ydHMuZm9ybWF0RGF0ZT1mb3JtYXREYXRlO1xyXG5leHBvcnRzLmZvcm1hdFRpbWU9Zm9ybWF0VGltZTtcclxuZXhwb3J0cy5yYWluYm93PXJhaW5ib3c7XHJcbmV4cG9ydHMubW9iaWxlQW5kVGFibGV0Q2hlY2s9bW9iaWxlQW5kVGFibGV0Q2hlY2s7XHJcbmV4cG9ydHMucmVuZGVyQXJyb3dCYXNlNjQ9cmVuZGVyQXJyb3dCYXNlNjQ7XHJcbmV4cG9ydHMucmVuZGVyRGlyZWN0aW9uQmFzZTY0PXJlbmRlckRpcmVjdGlvbkJhc2U2NDtcclxuZXhwb3J0cy5yZW5kZXJCb3hCYXNlNjQ9cmVuZGVyQm94QmFzZTY0O1xyXG5leHBvcnRzLmludGVyY2VwdE9uQ2lyY2xlPWludGVyY2VwdE9uQ2lyY2xlO1xyXG5leHBvcnRzLmRpc3RwPWRpc3RwO1xyXG5leHBvcnRzLmNpcmNsZUxpbmVJbnRlcnNlY3Q9Y2lyY2xlTGluZUludGVyc2VjdDtcclxuZXhwb3J0cy5NT0JJTEU9bW9iaWxlQW5kVGFibGV0Q2hlY2soKTtcclxuZXhwb3J0cy5XR1M4NFNQSEVSRT1uZXcgV0dTODRTcGhlcmUoNjM3ODEzNyk7XHJcbmV4cG9ydHMuZm9ybWF0VGltZVNlYz1mb3JtYXRUaW1lU2VjO1xyXG5leHBvcnRzLmRlY29kZUJhc2U2NEltYWdlPWRlY29kZUJhc2U2NEltYWdlO1xyXG5leHBvcnRzLmlzRGVmaW5lZD1pc0RlZmluZWQ7IiwicmVxdWlyZSgnam9vc2UnKTtcclxudmFyIFV0aWxzID0gcmVxdWlyZSgnLi8uLi9hcHAvVXRpbHMnKTtcclxuQ2xhc3MoXCJTdHJlYW1EYXRhXCIsXHJcbntcclxuICAgIGhhczpcclxuICAgIHtcclxuICAgICAgICBpc1N0b3BwZWQgOiB7XHJcbiAgICAgICAgICAgIGlzOiAgIFwicndcIixcclxuICAgICAgICAgICAgaW5pdCA6IGZhbHNlXHRcclxuICAgICAgICB9XHJcbiAgICB9LFxyXG4gICAgLy8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG4gICAgbWV0aG9kczpcclxuICAgIHtcclxuICAgICAgICBzdGFydCA6IGZ1bmN0aW9uKHRyYWNrLGNoZWNrZXIscGluZ0ludGVydmFsLGNhbGxCYWNrRm5jKVxyXG4gICAgICAgIHtcclxuICAgICAgICAgICAgdmFyIHVybCA9IFwiaHR0cDovL2xpdmVvcnR1bmcuZGUvdHJpYXRobG9uL3Jlc3Qvc3RyZWFtXCI7IFxyXG4gICAgICAgIFx0Zm9yICh2YXIgaSBpbiB0cmFjay5wYXJ0aWNpcGFudHMpIFxyXG4gICAgICAgIFx0e1xyXG4gICAgICAgIFx0XHR2YXIgcGFydCA9IHRyYWNrLnBhcnRpY2lwYW50c1tpXTtcclxuICAgICAgICBcdFx0cGFydC5fX3N0YXJ0VGltZSA9IChuZXcgRGF0ZSgpKS5nZXRUaW1lKCkgLSAxMCo2MCoxMDAwOyBcdC8vIDEwIG1pbnV0ZXMgYmVmb3JlO1xyXG4gICAgICAgIFx0fVxyXG4gICAgICAgIFx0Ly8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tICAgICAgICBcdFxyXG4gICAgICAgIFx0ZnVuY3Rpb24gZG9UaWNrKCkgXHJcbiAgICAgICAgXHR7XHJcbiAgICAgICAgXHRcdGlmICh0aGlzLmlzU3RvcHBlZClcclxuICAgICAgICBcdFx0XHRyZXR1cm47XHJcbiAgICAgICAgXHRcdGlmIChjaGVja2VyICYmICFjaGVja2VyKCkpIHtcclxuICAgICAgICAgICAgICAgICAgICBzZXRUaW1lb3V0KGRvVGljayxwaW5nSW50ZXJ2YWwqMTAwMCk7XHJcbiAgICAgICAgXHRcdFx0cmV0dXJuO1xyXG4gICAgICAgIFx0XHR9XHJcbiAgICAgICAgICAgICAgICB2YXIganNvbj1bXTtcclxuICAgICAgICAgICAgICAgIHZhciBjdGltZSA9IChuZXcgRGF0ZSgpKS5nZXRUaW1lKCk7XHJcbiAgICAgICAgICAgICAgICB2YXIgbW1hcCA9IHt9O1xyXG4gICAgICAgICAgICAgICAgZm9yICh2YXIgaSBpbiB0cmFjay5wYXJ0aWNpcGFudHMpIFxyXG4gICAgICAgICAgICAgICAge1xyXG4gICAgICAgICAgICAgICAgXHR2YXIgcHAgPSB0cmFjay5wYXJ0aWNpcGFudHNbaV07XHJcbiAgICAgICAgICAgICAgICBcdGpzb24ucHVzaCh7dG8gOiBjdGltZSxmcm9tIDogcHAuX19zdGFydFRpbWUsSU1FSSA6IHBwLmRldmljZUlkfSk7XHJcbiAgICAgICAgICAgICAgICBcdC8vY29uc29sZS5sb2cocHAuZGV2aWNlSWQrXCIgfCBcIituZXcgRGF0ZShwcC5fX3N0YXJ0VGltZSkrXCIgPiBcIituZXcgRGF0ZShjdGltZSkpO1xyXG4gICAgICAgICAgICAgICAgXHQvL2pzb24ucHVzaCh7dG8gOiA5MDA3MTk5MjU0NzQwOTksZnJvbSA6IDAsSU1FSSA6IHBwLmRldmljZUlkfSk7XHJcbiAgICAgICAgICAgICAgICBcdG1tYXBbcHAuZGV2aWNlSWRdPXBwO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgZnVuY3Rpb24gcHJvY2Vzc0RhdGEoZGF0YSkgXHJcbiAgICAgICAgICAgICAgICB7XHJcbiAgICAgICAgICAgICAgICBcdGNvbnNvbGUubG9nKFwiUHJvY2VzcyBkYXRhIHNpemUgPSBcIitkYXRhLmxlbmd0aCk7XHJcbiAgICAgICAgICAgICAgICBcdGZvciAodmFyIGkgaW4gZGF0YSkgXHJcbiAgICAgICAgICAgICAgICBcdHtcclxuICAgICAgICAgICAgICAgIFx0XHR2YXIgZSA9IGRhdGFbaV07XHJcbiAgICAgICAgICAgICAgICBcdFx0Ly9jb25zb2xlLmxvZyhcIlBST0NFU1MgOiBcIitKU09OLnN0cmluZ2lmeShlKSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHZhciBjdGltZSA9IHBhcnNlSW50KGUuRVBPQ0gpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoIWN0aW1lKVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgICAgICAgICAgXHRcdHZhciBwYXJ0ID0gbW1hcFtlLklNRUldO1xyXG4gICAgICAgICAgICAgICAgXHRcdGlmICghcGFydCkge1xyXG4gICAgICAgICAgICAgICAgXHRcdFx0Y29uc29sZS5sb2coXCJXUk9ORyBJTUVJIGluIFN0cmVhbURhdGEuanMgOiBcIitlLklNRUkpO1xyXG4gICAgICAgICAgICAgICAgXHRcdFx0Y29udGludWU7XHJcbiAgICAgICAgICAgICAgICBcdFx0fSBlbHNlIHtcclxuICAgICAgICAgICAgICAgIFx0XHRcdHZhciBucyA9IGN0aW1lKzE7XHJcbiAgICAgICAgICAgICAgICBcdFx0XHRpZiAocGFydC5fX3N0YXJ0VGltZSA8IG5zKVxyXG4gICAgICAgICAgICAgICAgXHRcdFx0XHRwYXJ0Ll9fc3RhcnRUaW1lPW5zO1xyXG4gICAgICAgICAgICAgICAgXHRcdH1cclxuICAgICAgICAgICAgICAgICAgICAgICAgZGVsZXRlIGUuX2lkO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBkZWxldGUgZS5UUztcclxuICAgICAgICAgICAgICAgICAgICAgICAgZS5MT049cGFyc2VJbnQoZS5MT04pO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBlLkxBVD1wYXJzZUludChlLkxBVCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChpc05hTihlLkxPTikgfHwgaXNOYU4oZS5MQVQpKVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoZS5BTFQpXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZS5BTFQ9cGFyc2VGbG9hdChlLkFMVCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChlLlRJTUUpXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZS5USU1FPXBhcnNlRmxvYXQoZS5USU1FKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGUuSFJUKVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGUuSFJUPXBhcnNlSW50KGUuSFJUKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgLyppZiAoZS5MT04gPT0gMCAmJiBlLkxBVCA9PSAwKVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnRpbnVlOyovXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG4gICAgICAgICAgICAgICAgICAgICAgICB2YXIgYyA9IFtlLkxPTiAvIDEwMDAwMDAuMCxlLkxBVCAvIDEwMDAwMDAuMF07XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHBhcnQucGluZyhjLGUuSFJULGZhbHNlLypTT1MqLyxjdGltZSxlLkFMVCwwLypvdmVyYWxsIHJhbmsqLywwLypncm91cFJhbmsqLywwLypnZW5kZXJSYW5rKi8pO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmxvZyhcIiA+Pj4gXCIrcGFydC5jb2RlK1wiIHwgXCIrKE1hdGgucm91bmQocGFydC5nZXRFbGFwc2VkKCkqMTAwLjAqMTAwLjApLzEwMC4wKStcIiVcIitcIiB8IFBJTkcgQVQgUE9TIFwiK2NbMF0rXCIgfCBcIitjWzFdK1wiIHwgXCIrVXRpbHMuZm9ybWF0RGF0ZVRpbWVTZWMobmV3IERhdGUoY3RpbWUpKSkgO1xyXG4gICAgICAgICAgICAgICAgXHR9XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAvL2NvbnNvbGUubG9nKGpzb24pO1xyXG4gICAgICAgICAgICAgICAgY2FsbEJhY2tGbmModXJsLGpzb24scHJvY2Vzc0RhdGEpO1xyXG4gICAgICAgICAgICAgICAgc2V0VGltZW91dChkb1RpY2sscGluZ0ludGVydmFsKjEwMDApO1xyXG4gICAgICAgIFx0fVxyXG4gICAgICAgIFx0ZG9UaWNrKCk7XHJcbiAgICAgICAgfVxyXG4gICAgfSAgICBcclxufSk7XHJcblxyXG5cclxuIiwiOyFmdW5jdGlvbiAoKSB7O1xudmFyIEpvb3NlID0ge31cblxuLy8gY29uZmlndXJhdGlvbiBoYXNoXG5cbkpvb3NlLkMgICAgICAgICAgICAgPSB0eXBlb2YgSk9PU0VfQ0ZHICE9ICd1bmRlZmluZWQnID8gSk9PU0VfQ0ZHIDoge31cblxuSm9vc2UuaXNfSUUgICAgICAgICA9ICdcXHYnID09ICd2J1xuSm9vc2UuaXNfTm9kZUpTICAgICA9IEJvb2xlYW4odHlwZW9mIHByb2Nlc3MgIT0gJ3VuZGVmaW5lZCcgJiYgcHJvY2Vzcy5waWQpXG5cblxuSm9vc2UudG9wICAgICAgICAgICA9IEpvb3NlLmlzX05vZGVKUyAmJiBnbG9iYWwgfHwgdGhpc1xuXG5Kb29zZS5zdHViICAgICAgICAgID0gZnVuY3Rpb24gKCkge1xuICAgIHJldHVybiBmdW5jdGlvbiAoKSB7IHRocm93IG5ldyBFcnJvcihcIk1vZHVsZXMgY2FuIG5vdCBiZSBpbnN0YW50aWF0ZWRcIikgfVxufVxuXG5cbkpvb3NlLlZFUlNJT04gICAgICAgPSAoeyAvKlBLR1ZFUlNJT04qL1ZFUlNJT04gOiAnMy41MC4wJyB9KS5WRVJTSU9OXG5cblxuaWYgKHR5cGVvZiBtb2R1bGUgIT0gJ3VuZGVmaW5lZCcpIG1vZHVsZS5leHBvcnRzID0gSm9vc2Vcbi8qaWYgKCFKb29zZS5pc19Ob2RlSlMpICovXG50aGlzLkpvb3NlID0gSm9vc2VcblxuXG4vLyBTdGF0aWMgaGVscGVycyBmb3IgQXJyYXlzXG5Kb29zZS5BID0ge1xuXG4gICAgZWFjaCA6IGZ1bmN0aW9uIChhcnJheSwgZnVuYywgc2NvcGUpIHtcbiAgICAgICAgc2NvcGUgPSBzY29wZSB8fCB0aGlzXG4gICAgICAgIFxuICAgICAgICBmb3IgKHZhciBpID0gMCwgbGVuID0gYXJyYXkubGVuZ3RoOyBpIDwgbGVuOyBpKyspIFxuICAgICAgICAgICAgaWYgKGZ1bmMuY2FsbChzY29wZSwgYXJyYXlbaV0sIGkpID09PSBmYWxzZSkgcmV0dXJuIGZhbHNlXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBlYWNoUiA6IGZ1bmN0aW9uIChhcnJheSwgZnVuYywgc2NvcGUpIHtcbiAgICAgICAgc2NvcGUgPSBzY29wZSB8fCB0aGlzXG5cbiAgICAgICAgZm9yICh2YXIgaSA9IGFycmF5Lmxlbmd0aCAtIDE7IGkgPj0gMDsgaS0tKSBcbiAgICAgICAgICAgIGlmIChmdW5jLmNhbGwoc2NvcGUsIGFycmF5W2ldLCBpKSA9PT0gZmFsc2UpIHJldHVybiBmYWxzZVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgZXhpc3RzIDogZnVuY3Rpb24gKGFycmF5LCB2YWx1ZSkge1xuICAgICAgICBmb3IgKHZhciBpID0gMCwgbGVuID0gYXJyYXkubGVuZ3RoOyBpIDwgbGVuOyBpKyspIGlmIChhcnJheVtpXSA9PSB2YWx1ZSkgcmV0dXJuIHRydWVcbiAgICAgICAgICAgIFxuICAgICAgICByZXR1cm4gZmFsc2VcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIG1hcCA6IGZ1bmN0aW9uIChhcnJheSwgZnVuYywgc2NvcGUpIHtcbiAgICAgICAgc2NvcGUgPSBzY29wZSB8fCB0aGlzXG4gICAgICAgIFxuICAgICAgICB2YXIgcmVzID0gW11cbiAgICAgICAgXG4gICAgICAgIGZvciAodmFyIGkgPSAwLCBsZW4gPSBhcnJheS5sZW5ndGg7IGkgPCBsZW47IGkrKykgXG4gICAgICAgICAgICByZXMucHVzaCggZnVuYy5jYWxsKHNjb3BlLCBhcnJheVtpXSwgaSkgKVxuICAgICAgICAgICAgXG4gICAgICAgIHJldHVybiByZXNcbiAgICB9LFxuICAgIFxuXG4gICAgZ3JlcCA6IGZ1bmN0aW9uIChhcnJheSwgZnVuYykge1xuICAgICAgICB2YXIgYSA9IFtdXG4gICAgICAgIFxuICAgICAgICBKb29zZS5BLmVhY2goYXJyYXksIGZ1bmN0aW9uICh0KSB7XG4gICAgICAgICAgICBpZiAoZnVuYyh0KSkgYS5wdXNoKHQpXG4gICAgICAgIH0pXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gYVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgcmVtb3ZlIDogZnVuY3Rpb24gKGFycmF5LCByZW1vdmVFbGUpIHtcbiAgICAgICAgdmFyIGEgPSBbXVxuICAgICAgICBcbiAgICAgICAgSm9vc2UuQS5lYWNoKGFycmF5LCBmdW5jdGlvbiAodCkge1xuICAgICAgICAgICAgaWYgKHQgIT09IHJlbW92ZUVsZSkgYS5wdXNoKHQpXG4gICAgICAgIH0pXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gYVxuICAgIH1cbiAgICBcbn1cblxuLy8gU3RhdGljIGhlbHBlcnMgZm9yIFN0cmluZ3Ncbkpvb3NlLlMgPSB7XG4gICAgXG4gICAgc2FuZVNwbGl0IDogZnVuY3Rpb24gKHN0ciwgZGVsaW1ldGVyKSB7XG4gICAgICAgIHZhciByZXMgPSAoc3RyIHx8ICcnKS5zcGxpdChkZWxpbWV0ZXIpXG4gICAgICAgIFxuICAgICAgICBpZiAocmVzLmxlbmd0aCA9PSAxICYmICFyZXNbMF0pIHJlcy5zaGlmdCgpXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gcmVzXG4gICAgfSxcbiAgICBcblxuICAgIHVwcGVyY2FzZUZpcnN0IDogZnVuY3Rpb24gKHN0cmluZykgeyBcbiAgICAgICAgcmV0dXJuIHN0cmluZy5zdWJzdHIoMCwgMSkudG9VcHBlckNhc2UoKSArIHN0cmluZy5zdWJzdHIoMSwgc3RyaW5nLmxlbmd0aCAtIDEpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBzdHJUb0NsYXNzIDogZnVuY3Rpb24gKG5hbWUsIHRvcCkge1xuICAgICAgICB2YXIgY3VycmVudCA9IHRvcCB8fCBKb29zZS50b3BcbiAgICAgICAgXG4gICAgICAgIEpvb3NlLkEuZWFjaChuYW1lLnNwbGl0KCcuJyksIGZ1bmN0aW9uIChzZWdtZW50KSB7XG4gICAgICAgICAgICBpZiAoY3VycmVudCkgXG4gICAgICAgICAgICAgICAgY3VycmVudCA9IGN1cnJlbnRbIHNlZ21lbnQgXVxuICAgICAgICAgICAgZWxzZVxuICAgICAgICAgICAgICAgIHJldHVybiBmYWxzZVxuICAgICAgICB9KVxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIGN1cnJlbnRcbiAgICB9XG59XG5cbnZhciBiYXNlRnVuYyAgICA9IGZ1bmN0aW9uICgpIHt9XG5cbi8vIFN0YXRpYyBoZWxwZXJzIGZvciBvYmplY3RzXG5Kb29zZS5PID0ge1xuXG4gICAgZWFjaCA6IGZ1bmN0aW9uIChvYmplY3QsIGZ1bmMsIHNjb3BlKSB7XG4gICAgICAgIHNjb3BlID0gc2NvcGUgfHwgdGhpc1xuICAgICAgICBcbiAgICAgICAgZm9yICh2YXIgaSBpbiBvYmplY3QpIFxuICAgICAgICAgICAgaWYgKGZ1bmMuY2FsbChzY29wZSwgb2JqZWN0W2ldLCBpKSA9PT0gZmFsc2UpIHJldHVybiBmYWxzZVxuICAgICAgICBcbiAgICAgICAgaWYgKEpvb3NlLmlzX0lFKSBcbiAgICAgICAgICAgIHJldHVybiBKb29zZS5BLmVhY2goWyAndG9TdHJpbmcnLCAnY29uc3RydWN0b3InLCAnaGFzT3duUHJvcGVydHknIF0sIGZ1bmN0aW9uIChlbCkge1xuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIGlmIChvYmplY3QuaGFzT3duUHJvcGVydHkoZWwpKSByZXR1cm4gZnVuYy5jYWxsKHNjb3BlLCBvYmplY3RbZWxdLCBlbClcbiAgICAgICAgICAgIH0pXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBlYWNoT3duIDogZnVuY3Rpb24gKG9iamVjdCwgZnVuYywgc2NvcGUpIHtcbiAgICAgICAgc2NvcGUgPSBzY29wZSB8fCB0aGlzXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gSm9vc2UuTy5lYWNoKG9iamVjdCwgZnVuY3Rpb24gKHZhbHVlLCBuYW1lKSB7XG4gICAgICAgICAgICBpZiAob2JqZWN0Lmhhc093blByb3BlcnR5KG5hbWUpKSByZXR1cm4gZnVuYy5jYWxsKHNjb3BlLCB2YWx1ZSwgbmFtZSlcbiAgICAgICAgfSwgc2NvcGUpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBjb3B5IDogZnVuY3Rpb24gKHNvdXJjZSwgdGFyZ2V0KSB7XG4gICAgICAgIHRhcmdldCA9IHRhcmdldCB8fCB7fVxuICAgICAgICBcbiAgICAgICAgSm9vc2UuTy5lYWNoKHNvdXJjZSwgZnVuY3Rpb24gKHZhbHVlLCBuYW1lKSB7IHRhcmdldFtuYW1lXSA9IHZhbHVlIH0pXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gdGFyZ2V0XG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBjb3B5T3duIDogZnVuY3Rpb24gKHNvdXJjZSwgdGFyZ2V0KSB7XG4gICAgICAgIHRhcmdldCA9IHRhcmdldCB8fCB7fVxuICAgICAgICBcbiAgICAgICAgSm9vc2UuTy5lYWNoT3duKHNvdXJjZSwgZnVuY3Rpb24gKHZhbHVlLCBuYW1lKSB7IHRhcmdldFtuYW1lXSA9IHZhbHVlIH0pXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gdGFyZ2V0XG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBnZXRNdXRhYmxlQ29weSA6IGZ1bmN0aW9uIChvYmplY3QpIHtcbiAgICAgICAgYmFzZUZ1bmMucHJvdG90eXBlID0gb2JqZWN0XG4gICAgICAgIFxuICAgICAgICByZXR1cm4gbmV3IGJhc2VGdW5jKClcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGV4dGVuZCA6IGZ1bmN0aW9uICh0YXJnZXQsIHNvdXJjZSkge1xuICAgICAgICByZXR1cm4gSm9vc2UuTy5jb3B5KHNvdXJjZSwgdGFyZ2V0KVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgaXNFbXB0eSA6IGZ1bmN0aW9uIChvYmplY3QpIHtcbiAgICAgICAgZm9yICh2YXIgaSBpbiBvYmplY3QpIGlmIChvYmplY3QuaGFzT3duUHJvcGVydHkoaSkpIHJldHVybiBmYWxzZVxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIHRydWVcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGlzSW5zdGFuY2U6IGZ1bmN0aW9uIChvYmopIHtcbiAgICAgICAgcmV0dXJuIG9iaiAmJiBvYmoubWV0YSAmJiBvYmouY29uc3RydWN0b3IgPT0gb2JqLm1ldGEuY1xuICAgIH0sXG4gICAgXG4gICAgXG4gICAgaXNDbGFzcyA6IGZ1bmN0aW9uIChvYmopIHtcbiAgICAgICAgcmV0dXJuIG9iaiAmJiBvYmoubWV0YSAmJiBvYmoubWV0YS5jID09IG9ialxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgd2FudEFycmF5IDogZnVuY3Rpb24gKG9iaikge1xuICAgICAgICBpZiAob2JqIGluc3RhbmNlb2YgQXJyYXkpIHJldHVybiBvYmpcbiAgICAgICAgXG4gICAgICAgIHJldHVybiBbIG9iaiBdXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICAvLyB0aGlzIHdhcyBhIGJ1ZyBpbiBXZWJLaXQsIHdoaWNoIGdpdmVzIHR5cGVvZiAvIC8gPT0gJ2Z1bmN0aW9uJ1xuICAgIC8vIHNob3VsZCBiZSBtb25pdG9yZWQgYW5kIHJlbW92ZWQgYXQgc29tZSBwb2ludCBpbiB0aGUgZnV0dXJlXG4gICAgaXNGdW5jdGlvbiA6IGZ1bmN0aW9uIChvYmopIHtcbiAgICAgICAgcmV0dXJuIHR5cGVvZiBvYmogPT0gJ2Z1bmN0aW9uJyAmJiBvYmouY29uc3RydWN0b3IgIT0gLyAvLmNvbnN0cnVjdG9yXG4gICAgfVxufVxuXG5cbi8vaW5pdGlhbGl6ZXJzXG5cbkpvb3NlLkkgPSB7XG4gICAgQXJyYXkgICAgICAgOiBmdW5jdGlvbiAoKSB7IHJldHVybiBbXSB9LFxuICAgIE9iamVjdCAgICAgIDogZnVuY3Rpb24gKCkgeyByZXR1cm4ge30gfSxcbiAgICBGdW5jdGlvbiAgICA6IGZ1bmN0aW9uICgpIHsgcmV0dXJuIGFyZ3VtZW50cy5jYWxsZWUgfSxcbiAgICBOb3cgICAgICAgICA6IGZ1bmN0aW9uICgpIHsgcmV0dXJuIG5ldyBEYXRlKCkgfVxufTtcbkpvb3NlLlByb3RvID0gSm9vc2Uuc3R1YigpXG5cbkpvb3NlLlByb3RvLkVtcHR5ID0gSm9vc2Uuc3R1YigpXG4gICAgXG5Kb29zZS5Qcm90by5FbXB0eS5tZXRhID0ge307XG47KGZ1bmN0aW9uICgpIHtcblxuICAgIEpvb3NlLlByb3RvLk9iamVjdCA9IEpvb3NlLnN0dWIoKVxuICAgIFxuICAgIFxuICAgIHZhciBTVVBFUiA9IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgdmFyIHNlbGYgPSBTVVBFUi5jYWxsZXJcbiAgICAgICAgXG4gICAgICAgIGlmIChzZWxmID09IFNVUEVSQVJHKSBzZWxmID0gc2VsZi5jYWxsZXJcbiAgICAgICAgXG4gICAgICAgIGlmICghc2VsZi5TVVBFUikgdGhyb3cgXCJJbnZhbGlkIGNhbGwgdG8gU1VQRVJcIlxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIHNlbGYuU1VQRVJbc2VsZi5tZXRob2ROYW1lXS5hcHBseSh0aGlzLCBhcmd1bWVudHMpXG4gICAgfVxuICAgIFxuICAgIFxuICAgIHZhciBTVVBFUkFSRyA9IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuU1VQRVIuYXBwbHkodGhpcywgYXJndW1lbnRzWzBdKVxuICAgIH1cbiAgICBcbiAgICBcbiAgICBcbiAgICBKb29zZS5Qcm90by5PYmplY3QucHJvdG90eXBlID0ge1xuICAgICAgICBcbiAgICAgICAgU1VQRVJBUkcgOiBTVVBFUkFSRyxcbiAgICAgICAgU1VQRVIgOiBTVVBFUixcbiAgICAgICAgXG4gICAgICAgIElOTkVSIDogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgdGhyb3cgXCJJbnZhbGlkIGNhbGwgdG8gSU5ORVJcIlxuICAgICAgICB9LCAgICAgICAgICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBCVUlMRCA6IGZ1bmN0aW9uIChjb25maWcpIHtcbiAgICAgICAgICAgIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID09IDEgJiYgdHlwZW9mIGNvbmZpZyA9PSAnb2JqZWN0JyAmJiBjb25maWcgfHwge31cbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBpbml0aWFsaXplOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgdG9TdHJpbmc6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHJldHVybiBcImEgXCIgKyB0aGlzLm1ldGEubmFtZVxuICAgICAgICB9XG4gICAgICAgIFxuICAgIH1cbiAgICAgICAgXG4gICAgSm9vc2UuUHJvdG8uT2JqZWN0Lm1ldGEgPSB7XG4gICAgICAgIGNvbnN0cnVjdG9yICAgICA6IEpvb3NlLlByb3RvLk9iamVjdCxcbiAgICAgICAgXG4gICAgICAgIG1ldGhvZHMgICAgICAgICA6IEpvb3NlLk8uY29weShKb29zZS5Qcm90by5PYmplY3QucHJvdG90eXBlKSxcbiAgICAgICAgYXR0cmlidXRlcyAgICAgIDoge31cbiAgICB9XG4gICAgXG4gICAgSm9vc2UuUHJvdG8uT2JqZWN0LnByb3RvdHlwZS5tZXRhID0gSm9vc2UuUHJvdG8uT2JqZWN0Lm1ldGFcblxufSkoKTtcbjsoZnVuY3Rpb24gKCkge1xuXG4gICAgSm9vc2UuUHJvdG8uQ2xhc3MgPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmluaXRpYWxpemUodGhpcy5CVUlMRC5hcHBseSh0aGlzLCBhcmd1bWVudHMpKSB8fCB0aGlzXG4gICAgfVxuICAgIFxuICAgIHZhciBib290c3RyYXAgPSB7XG4gICAgICAgIFxuICAgICAgICBWRVJTSU9OICAgICAgICAgICAgIDogbnVsbCxcbiAgICAgICAgQVVUSE9SSVRZICAgICAgICAgICA6IG51bGwsXG4gICAgICAgIFxuICAgICAgICBjb25zdHJ1Y3RvciAgICAgICAgIDogSm9vc2UuUHJvdG8uQ2xhc3MsXG4gICAgICAgIHN1cGVyQ2xhc3MgICAgICAgICAgOiBudWxsLFxuICAgICAgICBcbiAgICAgICAgbmFtZSAgICAgICAgICAgICAgICA6IG51bGwsXG4gICAgICAgIFxuICAgICAgICBhdHRyaWJ1dGVzICAgICAgICAgIDogbnVsbCxcbiAgICAgICAgbWV0aG9kcyAgICAgICAgICAgICA6IG51bGwsXG4gICAgICAgIFxuICAgICAgICBtZXRhICAgICAgICAgICAgICAgIDogbnVsbCxcbiAgICAgICAgYyAgICAgICAgICAgICAgICAgICA6IG51bGwsXG4gICAgICAgIFxuICAgICAgICBkZWZhdWx0U3VwZXJDbGFzcyAgIDogSm9vc2UuUHJvdG8uT2JqZWN0LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIEJVSUxEIDogZnVuY3Rpb24gKG5hbWUsIGV4dGVuZCkge1xuICAgICAgICAgICAgdGhpcy5uYW1lID0gbmFtZVxuICAgICAgICAgICAgXG4gICAgICAgICAgICByZXR1cm4geyBfX2V4dGVuZF9fIDogZXh0ZW5kIHx8IHt9IH1cbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBpbml0aWFsaXplOiBmdW5jdGlvbiAocHJvcHMpIHtcbiAgICAgICAgICAgIHZhciBleHRlbmQgICAgICA9IHByb3BzLl9fZXh0ZW5kX19cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpcy5WRVJTSU9OICAgID0gZXh0ZW5kLlZFUlNJT05cbiAgICAgICAgICAgIHRoaXMuQVVUSE9SSVRZICA9IGV4dGVuZC5BVVRIT1JJVFlcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgZGVsZXRlIGV4dGVuZC5WRVJTSU9OXG4gICAgICAgICAgICBkZWxldGUgZXh0ZW5kLkFVVEhPUklUWVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLmMgPSB0aGlzLmV4dHJhY3RDb25zdHJ1Y3RvcihleHRlbmQpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXMuYWRhcHRDb25zdHJ1Y3Rvcih0aGlzLmMpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmIChleHRlbmQuY29uc3RydWN0b3JPbmx5KSB7XG4gICAgICAgICAgICAgICAgZGVsZXRlIGV4dGVuZC5jb25zdHJ1Y3Rvck9ubHlcbiAgICAgICAgICAgICAgICByZXR1cm5cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpcy5jb25zdHJ1Y3QoZXh0ZW5kKVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIGNvbnN0cnVjdCA6IGZ1bmN0aW9uIChleHRlbmQpIHtcbiAgICAgICAgICAgIGlmICghdGhpcy5wcmVwYXJlUHJvcHMoZXh0ZW5kKSkgcmV0dXJuXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciBzdXBlckNsYXNzID0gdGhpcy5zdXBlckNsYXNzID0gdGhpcy5leHRyYWN0U3VwZXJDbGFzcyhleHRlbmQpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXMucHJvY2Vzc1N1cGVyQ2xhc3Moc3VwZXJDbGFzcylcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpcy5hZGFwdFByb3RvdHlwZSh0aGlzLmMucHJvdG90eXBlKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLmZpbmFsaXplKGV4dGVuZClcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBmaW5hbGl6ZSA6IGZ1bmN0aW9uIChleHRlbmQpIHtcbiAgICAgICAgICAgIHRoaXMucHJvY2Vzc1N0ZW0oZXh0ZW5kKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLmV4dGVuZChleHRlbmQpXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgLy9pZiB0aGUgZXh0ZW5zaW9uIHJldHVybnMgZmFsc2UgZnJvbSB0aGlzIG1ldGhvZCBpdCBzaG91bGQgcmUtZW50ZXIgJ2NvbnN0cnVjdCdcbiAgICAgICAgcHJlcGFyZVByb3BzIDogZnVuY3Rpb24gKGV4dGVuZCkge1xuICAgICAgICAgICAgcmV0dXJuIHRydWVcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBleHRyYWN0Q29uc3RydWN0b3IgOiBmdW5jdGlvbiAoZXh0ZW5kKSB7XG4gICAgICAgICAgICB2YXIgcmVzID0gZXh0ZW5kLmhhc093blByb3BlcnR5KCdjb25zdHJ1Y3RvcicpID8gZXh0ZW5kLmNvbnN0cnVjdG9yIDogdGhpcy5kZWZhdWx0Q29uc3RydWN0b3IoKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBkZWxldGUgZXh0ZW5kLmNvbnN0cnVjdG9yXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHJldHVybiByZXNcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBleHRyYWN0U3VwZXJDbGFzcyA6IGZ1bmN0aW9uIChleHRlbmQpIHtcbiAgICAgICAgICAgIGlmIChleHRlbmQuaGFzT3duUHJvcGVydHkoJ2lzYScpICYmICFleHRlbmQuaXNhKSB0aHJvdyBuZXcgRXJyb3IoXCJBdHRlbXB0IHRvIGluaGVyaXQgZnJvbSB1bmRlZmluZWQgc3VwZXJjbGFzcyBbXCIgKyB0aGlzLm5hbWUgKyBcIl1cIilcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdmFyIHJlcyA9IGV4dGVuZC5pc2EgfHwgdGhpcy5kZWZhdWx0U3VwZXJDbGFzc1xuICAgICAgICAgICAgXG4gICAgICAgICAgICBkZWxldGUgZXh0ZW5kLmlzYVxuICAgICAgICAgICAgXG4gICAgICAgICAgICByZXR1cm4gcmVzXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgcHJvY2Vzc1N0ZW0gOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB2YXIgc3VwZXJNZXRhICAgICAgID0gdGhpcy5zdXBlckNsYXNzLm1ldGFcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpcy5tZXRob2RzICAgICAgICA9IEpvb3NlLk8uZ2V0TXV0YWJsZUNvcHkoc3VwZXJNZXRhLm1ldGhvZHMgfHwge30pXG4gICAgICAgICAgICB0aGlzLmF0dHJpYnV0ZXMgICAgID0gSm9vc2UuTy5nZXRNdXRhYmxlQ29weShzdXBlck1ldGEuYXR0cmlidXRlcyB8fCB7fSlcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBpbml0SW5zdGFuY2UgOiBmdW5jdGlvbiAoaW5zdGFuY2UsIHByb3BzKSB7XG4gICAgICAgICAgICBKb29zZS5PLmNvcHlPd24ocHJvcHMsIGluc3RhbmNlKVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIGRlZmF1bHRDb25zdHJ1Y3RvcjogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgcmV0dXJuIGZ1bmN0aW9uIChhcmcpIHtcbiAgICAgICAgICAgICAgICB2YXIgQlVJTEQgPSB0aGlzLkJVSUxEXG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgdmFyIGFyZ3MgPSBCVUlMRCAmJiBCVUlMRC5hcHBseSh0aGlzLCBhcmd1bWVudHMpIHx8IGFyZyB8fCB7fVxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIHZhciB0aGlzTWV0YSAgICA9IHRoaXMubWV0YVxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIHRoaXNNZXRhLmluaXRJbnN0YW5jZSh0aGlzLCBhcmdzKVxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIHJldHVybiB0aGlzTWV0YS5oYXNNZXRob2QoJ2luaXRpYWxpemUnKSAmJiB0aGlzLmluaXRpYWxpemUoYXJncykgfHwgdGhpc1xuICAgICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIHByb2Nlc3NTdXBlckNsYXNzOiBmdW5jdGlvbiAoc3VwZXJDbGFzcykge1xuICAgICAgICAgICAgdmFyIHN1cGVyUHJvdG8gICAgICA9IHN1cGVyQ2xhc3MucHJvdG90eXBlXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vbm9uLUpvb3NlIHN1cGVyY2xhc3Nlc1xuICAgICAgICAgICAgaWYgKCFzdXBlckNsYXNzLm1ldGEpIHtcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICB2YXIgZXh0ZW5kID0gSm9vc2UuTy5jb3B5KHN1cGVyUHJvdG8pXG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgZXh0ZW5kLmlzYSA9IEpvb3NlLlByb3RvLkVtcHR5XG4gICAgICAgICAgICAgICAgLy8gY2xlYXIgcG90ZW50aWFsIHZhbHVlIGluIHRoZSBgZXh0ZW5kLmNvbnN0cnVjdG9yYCB0byBwcmV2ZW50IGl0IGZyb20gYmVpbmcgbW9kaWZpZWRcbiAgICAgICAgICAgICAgICBkZWxldGUgZXh0ZW5kLmNvbnN0cnVjdG9yXG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgdmFyIG1ldGEgPSBuZXcgdGhpcy5kZWZhdWx0U3VwZXJDbGFzcy5tZXRhLmNvbnN0cnVjdG9yKG51bGwsIGV4dGVuZClcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBzdXBlckNsYXNzLm1ldGEgPSBzdXBlclByb3RvLm1ldGEgPSBtZXRhXG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgbWV0YS5jID0gc3VwZXJDbGFzc1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLmMucHJvdG90eXBlICAgID0gSm9vc2UuTy5nZXRNdXRhYmxlQ29weShzdXBlclByb3RvKVxuICAgICAgICAgICAgdGhpcy5jLnN1cGVyQ2xhc3MgICA9IHN1cGVyUHJvdG9cbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBhZGFwdENvbnN0cnVjdG9yOiBmdW5jdGlvbiAoYykge1xuICAgICAgICAgICAgYy5tZXRhID0gdGhpc1xuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAoIWMuaGFzT3duUHJvcGVydHkoJ3RvU3RyaW5nJykpIGMudG9TdHJpbmcgPSBmdW5jdGlvbiAoKSB7IHJldHVybiB0aGlzLm1ldGEubmFtZSB9XG4gICAgICAgIH0sXG4gICAgXG4gICAgICAgIFxuICAgICAgICBhZGFwdFByb3RvdHlwZTogZnVuY3Rpb24gKHByb3RvKSB7XG4gICAgICAgICAgICAvL3RoaXMgd2lsbCBmaXggd2VpcmQgc2VtYW50aWMgb2YgbmF0aXZlIFwiY29uc3RydWN0b3JcIiBwcm9wZXJ0eSB0byBtb3JlIGludHVpdGl2ZSAoaWRlYSBib3Jyb3dlZCBmcm9tIEV4dClcbiAgICAgICAgICAgIHByb3RvLmNvbnN0cnVjdG9yICAgPSB0aGlzLmNcbiAgICAgICAgICAgIHByb3RvLm1ldGEgICAgICAgICAgPSB0aGlzXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgYWRkTWV0aG9kOiBmdW5jdGlvbiAobmFtZSwgZnVuYykge1xuICAgICAgICAgICAgZnVuYy5TVVBFUiA9IHRoaXMuc3VwZXJDbGFzcy5wcm90b3R5cGVcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy9jaHJvbWUgZG9uJ3QgYWxsb3cgdG8gcmVkZWZpbmUgdGhlIFwibmFtZVwiIHByb3BlcnR5XG4gICAgICAgICAgICBmdW5jLm1ldGhvZE5hbWUgPSBuYW1lXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXMubWV0aG9kc1tuYW1lXSA9IGZ1bmNcbiAgICAgICAgICAgIHRoaXMuYy5wcm90b3R5cGVbbmFtZV0gPSBmdW5jXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgYWRkQXR0cmlidXRlOiBmdW5jdGlvbiAobmFtZSwgaW5pdCkge1xuICAgICAgICAgICAgdGhpcy5hdHRyaWJ1dGVzW25hbWVdID0gaW5pdFxuICAgICAgICAgICAgdGhpcy5jLnByb3RvdHlwZVtuYW1lXSA9IGluaXRcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICByZW1vdmVNZXRob2QgOiBmdW5jdGlvbiAobmFtZSkge1xuICAgICAgICAgICAgZGVsZXRlIHRoaXMubWV0aG9kc1tuYW1lXVxuICAgICAgICAgICAgZGVsZXRlIHRoaXMuYy5wcm90b3R5cGVbbmFtZV1cbiAgICAgICAgfSxcbiAgICBcbiAgICAgICAgXG4gICAgICAgIHJlbW92ZUF0dHJpYnV0ZTogZnVuY3Rpb24gKG5hbWUpIHtcbiAgICAgICAgICAgIGRlbGV0ZSB0aGlzLmF0dHJpYnV0ZXNbbmFtZV1cbiAgICAgICAgICAgIGRlbGV0ZSB0aGlzLmMucHJvdG90eXBlW25hbWVdXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgaGFzTWV0aG9kOiBmdW5jdGlvbiAobmFtZSkgeyBcbiAgICAgICAgICAgIHJldHVybiBCb29sZWFuKHRoaXMubWV0aG9kc1tuYW1lXSlcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBoYXNBdHRyaWJ1dGU6IGZ1bmN0aW9uIChuYW1lKSB7IFxuICAgICAgICAgICAgcmV0dXJuIHRoaXMuYXR0cmlidXRlc1tuYW1lXSAhPT0gdW5kZWZpbmVkXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgIFxuICAgICAgICBoYXNPd25NZXRob2Q6IGZ1bmN0aW9uIChuYW1lKSB7IFxuICAgICAgICAgICAgcmV0dXJuIHRoaXMuaGFzTWV0aG9kKG5hbWUpICYmIHRoaXMubWV0aG9kcy5oYXNPd25Qcm9wZXJ0eShuYW1lKVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIGhhc093bkF0dHJpYnV0ZTogZnVuY3Rpb24gKG5hbWUpIHsgXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5oYXNBdHRyaWJ1dGUobmFtZSkgJiYgdGhpcy5hdHRyaWJ1dGVzLmhhc093blByb3BlcnR5KG5hbWUpXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgZXh0ZW5kIDogZnVuY3Rpb24gKHByb3BzKSB7XG4gICAgICAgICAgICBKb29zZS5PLmVhY2hPd24ocHJvcHMsIGZ1bmN0aW9uICh2YWx1ZSwgbmFtZSkge1xuICAgICAgICAgICAgICAgIGlmIChuYW1lICE9ICdtZXRhJyAmJiBuYW1lICE9ICdjb25zdHJ1Y3RvcicpIFxuICAgICAgICAgICAgICAgICAgICBpZiAoSm9vc2UuTy5pc0Z1bmN0aW9uKHZhbHVlKSAmJiAhdmFsdWUubWV0YSkgXG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmFkZE1ldGhvZChuYW1lLCB2YWx1ZSkgXG4gICAgICAgICAgICAgICAgICAgIGVsc2UgXG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmFkZEF0dHJpYnV0ZShuYW1lLCB2YWx1ZSlcbiAgICAgICAgICAgIH0sIHRoaXMpXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgc3ViQ2xhc3NPZiA6IGZ1bmN0aW9uIChjbGFzc09iamVjdCwgZXh0ZW5kKSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5zdWJDbGFzcyhleHRlbmQsIG51bGwsIGNsYXNzT2JqZWN0KVxuICAgICAgICB9LFxuICAgIFxuICAgIFxuICAgICAgICBzdWJDbGFzcyA6IGZ1bmN0aW9uIChleHRlbmQsIG5hbWUsIGNsYXNzT2JqZWN0KSB7XG4gICAgICAgICAgICBleHRlbmQgICAgICA9IGV4dGVuZCAgICAgICAgfHwge31cbiAgICAgICAgICAgIGV4dGVuZC5pc2EgID0gY2xhc3NPYmplY3QgICB8fCB0aGlzLmNcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcmV0dXJuIG5ldyB0aGlzLmNvbnN0cnVjdG9yKG5hbWUsIGV4dGVuZCkuY1xuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIGluc3RhbnRpYXRlIDogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgdmFyIGYgPSBmdW5jdGlvbiAoKSB7fVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBmLnByb3RvdHlwZSA9IHRoaXMuYy5wcm90b3R5cGVcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdmFyIG9iaiA9IG5ldyBmKClcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcmV0dXJuIHRoaXMuYy5hcHBseShvYmosIGFyZ3VtZW50cykgfHwgb2JqXG4gICAgICAgIH1cbiAgICB9XG4gICAgXG4gICAgLy9taWNybyBib290c3RyYXBpbmdcbiAgICBcbiAgICBKb29zZS5Qcm90by5DbGFzcy5wcm90b3R5cGUgPSBKb29zZS5PLmdldE11dGFibGVDb3B5KEpvb3NlLlByb3RvLk9iamVjdC5wcm90b3R5cGUpXG4gICAgXG4gICAgSm9vc2UuTy5leHRlbmQoSm9vc2UuUHJvdG8uQ2xhc3MucHJvdG90eXBlLCBib290c3RyYXApXG4gICAgXG4gICAgSm9vc2UuUHJvdG8uQ2xhc3MucHJvdG90eXBlLm1ldGEgPSBuZXcgSm9vc2UuUHJvdG8uQ2xhc3MoJ0pvb3NlLlByb3RvLkNsYXNzJywgYm9vdHN0cmFwKVxuICAgIFxuICAgIFxuICAgIFxuICAgIEpvb3NlLlByb3RvLkNsYXNzLm1ldGEuYWRkTWV0aG9kKCdpc2EnLCBmdW5jdGlvbiAoc29tZUNsYXNzKSB7XG4gICAgICAgIHZhciBmID0gZnVuY3Rpb24gKCkge31cbiAgICAgICAgXG4gICAgICAgIGYucHJvdG90eXBlID0gdGhpcy5jLnByb3RvdHlwZVxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIG5ldyBmKCkgaW5zdGFuY2VvZiBzb21lQ2xhc3NcbiAgICB9KVxufSkoKTtcbkpvb3NlLk1hbmFnZWQgPSBKb29zZS5zdHViKClcblxuSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eSA9IG5ldyBKb29zZS5Qcm90by5DbGFzcygnSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eScsIHtcbiAgICBcbiAgICBuYW1lICAgICAgICAgICAgOiBudWxsLFxuICAgIFxuICAgIGluaXQgICAgICAgICAgICA6IG51bGwsXG4gICAgdmFsdWUgICAgICAgICAgIDogbnVsbCxcbiAgICBcbiAgICBkZWZpbmVkSW4gICAgICAgOiBudWxsLFxuICAgIFxuICAgIFxuICAgIGluaXRpYWxpemUgOiBmdW5jdGlvbiAocHJvcHMpIHtcbiAgICAgICAgSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5zdXBlckNsYXNzLmluaXRpYWxpemUuY2FsbCh0aGlzLCBwcm9wcylcbiAgICAgICAgXG4gICAgICAgIHRoaXMuY29tcHV0ZVZhbHVlKClcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGNvbXB1dGVWYWx1ZSA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgdGhpcy52YWx1ZSA9IHRoaXMuaW5pdFxuICAgIH0sICAgIFxuICAgIFxuICAgIFxuICAgIC8vdGFyZ2V0Q2xhc3MgaXMgc3RpbGwgb3BlbiBhdCB0aGlzIHN0YWdlXG4gICAgcHJlQXBwbHkgOiBmdW5jdGlvbiAodGFyZ2V0Q2xhc3MpIHtcbiAgICB9LFxuICAgIFxuXG4gICAgLy90YXJnZXRDbGFzcyBpcyBhbHJlYWR5IG9wZW4gYXQgdGhpcyBzdGFnZVxuICAgIHBvc3RVbkFwcGx5IDogZnVuY3Rpb24gKHRhcmdldENsYXNzKSB7XG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBhcHBseSA6IGZ1bmN0aW9uICh0YXJnZXQpIHtcbiAgICAgICAgdGFyZ2V0W3RoaXMubmFtZV0gPSB0aGlzLnZhbHVlXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBpc0FwcGxpZWRUbyA6IGZ1bmN0aW9uICh0YXJnZXQpIHtcbiAgICAgICAgcmV0dXJuIHRhcmdldFt0aGlzLm5hbWVdID09IHRoaXMudmFsdWVcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIHVuYXBwbHkgOiBmdW5jdGlvbiAoZnJvbSkge1xuICAgICAgICBpZiAoIXRoaXMuaXNBcHBsaWVkVG8oZnJvbSkpIHRocm93IFwiVW5hcHBseSBvZiBwcm9wZXJ0eSBbXCIgKyB0aGlzLm5hbWUgKyBcIl0gZnJvbSBbXCIgKyBmcm9tICsgXCJdIGZhaWxlZFwiXG4gICAgICAgIFxuICAgICAgICBkZWxldGUgZnJvbVt0aGlzLm5hbWVdXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBjbG9uZVByb3BzIDogZnVuY3Rpb24gKCkge1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgbmFtZSAgICAgICAgOiB0aGlzLm5hbWUsIFxuICAgICAgICAgICAgaW5pdCAgICAgICAgOiB0aGlzLmluaXQsXG4gICAgICAgICAgICBkZWZpbmVkSW4gICA6IHRoaXMuZGVmaW5lZEluXG4gICAgICAgIH1cbiAgICB9LFxuXG4gICAgXG4gICAgY2xvbmUgOiBmdW5jdGlvbiAobmFtZSkge1xuICAgICAgICB2YXIgcHJvcHMgPSB0aGlzLmNsb25lUHJvcHMoKVxuICAgICAgICBcbiAgICAgICAgcHJvcHMubmFtZSA9IG5hbWUgfHwgcHJvcHMubmFtZVxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIG5ldyB0aGlzLmNvbnN0cnVjdG9yKHByb3BzKVxuICAgIH1cbiAgICBcbiAgICBcbn0pLmM7XG5Kb29zZS5NYW5hZ2VkLlByb3BlcnR5LkNvbmZsaWN0TWFya2VyID0gbmV3IEpvb3NlLlByb3RvLkNsYXNzKCdKb29zZS5NYW5hZ2VkLlByb3BlcnR5LkNvbmZsaWN0TWFya2VyJywge1xuICAgIFxuICAgIGlzYSA6IEpvb3NlLk1hbmFnZWQuUHJvcGVydHksXG5cbiAgICBhcHBseSA6IGZ1bmN0aW9uICh0YXJnZXQpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQXR0ZW1wdCB0byBhcHBseSBDb25mbGljdE1hcmtlciBbXCIgKyB0aGlzLm5hbWUgKyBcIl0gdG8gW1wiICsgdGFyZ2V0ICsgXCJdXCIpXG4gICAgfVxuICAgIFxufSkuYztcbkpvb3NlLk1hbmFnZWQuUHJvcGVydHkuUmVxdWlyZW1lbnQgPSBuZXcgSm9vc2UuUHJvdG8uQ2xhc3MoJ0pvb3NlLk1hbmFnZWQuUHJvcGVydHkuUmVxdWlyZW1lbnQnLCB7XG4gICAgXG4gICAgaXNhIDogSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eSxcblxuICAgIFxuICAgIGFwcGx5IDogZnVuY3Rpb24gKHRhcmdldCkge1xuICAgICAgICBpZiAoIXRhcmdldC5tZXRhLmhhc01ldGhvZCh0aGlzLm5hbWUpKSBcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcIlJlcXVpcmVtZW50IFtcIiArIHRoaXMubmFtZSArIFwiXSwgZGVmaW5lZCBpbiBbXCIgKyB0aGlzLmRlZmluZWRJbi5kZWZpbmVkSW4ubmFtZSArIFwiXSBpcyBub3Qgc2F0aXNmaWVkIGZvciBjbGFzcyBbXCIgKyB0YXJnZXQgKyBcIl1cIilcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIHVuYXBwbHkgOiBmdW5jdGlvbiAoZnJvbSkge1xuICAgIH1cbiAgICBcbn0pLmM7XG5Kb29zZS5NYW5hZ2VkLlByb3BlcnR5LkF0dHJpYnV0ZSA9IG5ldyBKb29zZS5Qcm90by5DbGFzcygnSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5BdHRyaWJ1dGUnLCB7XG4gICAgXG4gICAgaXNhIDogSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eSxcbiAgICBcbiAgICBzbG90ICAgICAgICAgICAgICAgIDogbnVsbCxcbiAgICBcbiAgICBcbiAgICBpbml0aWFsaXplIDogZnVuY3Rpb24gKCkge1xuICAgICAgICBKb29zZS5NYW5hZ2VkLlByb3BlcnR5LkF0dHJpYnV0ZS5zdXBlckNsYXNzLmluaXRpYWxpemUuYXBwbHkodGhpcywgYXJndW1lbnRzKVxuICAgICAgICBcbiAgICAgICAgdGhpcy5zbG90ID0gdGhpcy5uYW1lXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBhcHBseSA6IGZ1bmN0aW9uICh0YXJnZXQpIHtcbiAgICAgICAgdGFyZ2V0LnByb3RvdHlwZVsgdGhpcy5zbG90IF0gPSB0aGlzLnZhbHVlXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBpc0FwcGxpZWRUbyA6IGZ1bmN0aW9uICh0YXJnZXQpIHtcbiAgICAgICAgcmV0dXJuIHRhcmdldC5wcm90b3R5cGVbIHRoaXMuc2xvdCBdID09IHRoaXMudmFsdWVcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIHVuYXBwbHkgOiBmdW5jdGlvbiAoZnJvbSkge1xuICAgICAgICBpZiAoIXRoaXMuaXNBcHBsaWVkVG8oZnJvbSkpIHRocm93IFwiVW5hcHBseSBvZiBwcm9wZXJ0eSBbXCIgKyB0aGlzLm5hbWUgKyBcIl0gZnJvbSBbXCIgKyBmcm9tICsgXCJdIGZhaWxlZFwiXG4gICAgICAgIFxuICAgICAgICBkZWxldGUgZnJvbS5wcm90b3R5cGVbdGhpcy5zbG90XVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgY2xlYXJWYWx1ZSA6IGZ1bmN0aW9uIChpbnN0YW5jZSkge1xuICAgICAgICBkZWxldGUgaW5zdGFuY2VbIHRoaXMuc2xvdCBdXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBoYXNWYWx1ZSA6IGZ1bmN0aW9uIChpbnN0YW5jZSkge1xuICAgICAgICByZXR1cm4gaW5zdGFuY2UuaGFzT3duUHJvcGVydHkodGhpcy5zbG90KVxuICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICBnZXRSYXdWYWx1ZUZyb20gOiBmdW5jdGlvbiAoaW5zdGFuY2UpIHtcbiAgICAgICAgcmV0dXJuIGluc3RhbmNlWyB0aGlzLnNsb3QgXVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgc2V0UmF3VmFsdWVUbyA6IGZ1bmN0aW9uIChpbnN0YW5jZSwgdmFsdWUpIHtcbiAgICAgICAgaW5zdGFuY2VbIHRoaXMuc2xvdCBdID0gdmFsdWVcbiAgICAgICAgXG4gICAgICAgIHJldHVybiB0aGlzXG4gICAgfVxuICAgIFxufSkuYztcbkpvb3NlLk1hbmFnZWQuUHJvcGVydHkuTWV0aG9kTW9kaWZpZXIgPSBuZXcgSm9vc2UuUHJvdG8uQ2xhc3MoJ0pvb3NlLk1hbmFnZWQuUHJvcGVydHkuTWV0aG9kTW9kaWZpZXInLCB7XG4gICAgXG4gICAgaXNhIDogSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eSxcblxuICAgIFxuICAgIHByZXBhcmVXcmFwcGVyIDogZnVuY3Rpb24gKCkge1xuICAgICAgICB0aHJvdyBcIkFic3RyYWN0IG1ldGhvZCBbcHJlcGFyZVdyYXBwZXJdIG9mIFwiICsgdGhpcyArIFwiIHdhcyBjYWxsZWRcIlxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgYXBwbHkgOiBmdW5jdGlvbiAodGFyZ2V0KSB7XG4gICAgICAgIHZhciBuYW1lICAgICAgICAgICAgPSB0aGlzLm5hbWVcbiAgICAgICAgdmFyIHRhcmdldFByb3RvICAgICA9IHRhcmdldC5wcm90b3R5cGVcbiAgICAgICAgdmFyIGlzT3duICAgICAgICAgICA9IHRhcmdldFByb3RvLmhhc093blByb3BlcnR5KG5hbWUpXG4gICAgICAgIHZhciBvcmlnaW5hbCAgICAgICAgPSB0YXJnZXRQcm90b1tuYW1lXVxuICAgICAgICB2YXIgc3VwZXJQcm90byAgICAgID0gdGFyZ2V0Lm1ldGEuc3VwZXJDbGFzcy5wcm90b3R5cGVcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICB2YXIgb3JpZ2luYWxDYWxsID0gaXNPd24gPyBvcmlnaW5hbCA6IGZ1bmN0aW9uICgpIHsgXG4gICAgICAgICAgICByZXR1cm4gc3VwZXJQcm90b1tuYW1lXS5hcHBseSh0aGlzLCBhcmd1bWVudHMpIFxuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICB2YXIgbWV0aG9kV3JhcHBlciA9IHRoaXMucHJlcGFyZVdyYXBwZXIoe1xuICAgICAgICAgICAgbmFtZSAgICAgICAgICAgIDogbmFtZSxcbiAgICAgICAgICAgIG1vZGlmaWVyICAgICAgICA6IHRoaXMudmFsdWUsIFxuICAgICAgICAgICAgXG4gICAgICAgICAgICBpc093biAgICAgICAgICAgOiBpc093bixcbiAgICAgICAgICAgIG9yaWdpbmFsQ2FsbCAgICA6IG9yaWdpbmFsQ2FsbCwgXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHN1cGVyUHJvdG8gICAgICA6IHN1cGVyUHJvdG8sXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRhcmdldCAgICAgICAgICA6IHRhcmdldFxuICAgICAgICB9KVxuICAgICAgICBcbiAgICAgICAgaWYgKGlzT3duKSBtZXRob2RXcmFwcGVyLl9fT1JJR0lOQUxfXyA9IG9yaWdpbmFsXG4gICAgICAgIFxuICAgICAgICBtZXRob2RXcmFwcGVyLl9fQ09OVEFJTl9fICAgPSB0aGlzLnZhbHVlXG4gICAgICAgIG1ldGhvZFdyYXBwZXIuX19NRVRIT0RfXyAgICA9IHRoaXNcbiAgICAgICAgXG4gICAgICAgIHRhcmdldFByb3RvW25hbWVdID0gbWV0aG9kV3JhcHBlclxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgaXNBcHBsaWVkVG8gOiBmdW5jdGlvbiAodGFyZ2V0KSB7XG4gICAgICAgIHZhciB0YXJnZXRDb250ID0gdGFyZ2V0LnByb3RvdHlwZVt0aGlzLm5hbWVdXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gdGFyZ2V0Q29udCAmJiB0YXJnZXRDb250Ll9fQ09OVEFJTl9fID09IHRoaXMudmFsdWVcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIHVuYXBwbHkgOiBmdW5jdGlvbiAoZnJvbSkge1xuICAgICAgICB2YXIgbmFtZSA9IHRoaXMubmFtZVxuICAgICAgICB2YXIgZnJvbVByb3RvID0gZnJvbS5wcm90b3R5cGVcbiAgICAgICAgdmFyIG9yaWdpbmFsID0gZnJvbVByb3RvW25hbWVdLl9fT1JJR0lOQUxfX1xuICAgICAgICBcbiAgICAgICAgaWYgKCF0aGlzLmlzQXBwbGllZFRvKGZyb20pKSB0aHJvdyBcIlVuYXBwbHkgb2YgbWV0aG9kIFtcIiArIG5hbWUgKyBcIl0gZnJvbSBjbGFzcyBbXCIgKyBmcm9tICsgXCJdIGZhaWxlZFwiXG4gICAgICAgIFxuICAgICAgICAvL2lmIG1vZGlmaWVyIHdhcyBhcHBsaWVkIHRvIG93biBtZXRob2QgLSByZXN0b3JlIGl0XG4gICAgICAgIGlmIChvcmlnaW5hbCkgXG4gICAgICAgICAgICBmcm9tUHJvdG9bbmFtZV0gPSBvcmlnaW5hbFxuICAgICAgICAvL290aGVyd2lzZSAtIGp1c3QgZGVsZXRlIGl0LCB0byByZXZlYWwgdGhlIGluaGVyaXRlZCBtZXRob2QgXG4gICAgICAgIGVsc2VcbiAgICAgICAgICAgIGRlbGV0ZSBmcm9tUHJvdG9bbmFtZV1cbiAgICB9XG4gICAgXG59KS5jO1xuSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5NZXRob2RNb2RpZmllci5PdmVycmlkZSA9IG5ldyBKb29zZS5Qcm90by5DbGFzcygnSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5NZXRob2RNb2RpZmllci5PdmVycmlkZScsIHtcbiAgICBcbiAgICBpc2EgOiBKb29zZS5NYW5hZ2VkLlByb3BlcnR5Lk1ldGhvZE1vZGlmaWVyLFxuXG4gICAgXG4gICAgcHJlcGFyZVdyYXBwZXIgOiBmdW5jdGlvbiAocGFyYW1zKSB7XG4gICAgICAgIFxuICAgICAgICB2YXIgbW9kaWZpZXIgICAgICAgID0gcGFyYW1zLm1vZGlmaWVyXG4gICAgICAgIHZhciBvcmlnaW5hbENhbGwgICAgPSBwYXJhbXMub3JpZ2luYWxDYWxsXG4gICAgICAgIHZhciBzdXBlclByb3RvICAgICAgPSBwYXJhbXMuc3VwZXJQcm90b1xuICAgICAgICB2YXIgc3VwZXJNZXRhQ29uc3QgID0gc3VwZXJQcm90by5tZXRhLmNvbnN0cnVjdG9yXG4gICAgICAgIFxuICAgICAgICAvL2NhbGwgdG8gSm9vc2UuUHJvdG8gbGV2ZWwsIHJlcXVpcmUgc29tZSBhZGRpdGlvbmFsIHByb2Nlc3NpbmdcbiAgICAgICAgdmFyIGlzQ2FsbFRvUHJvdG8gPSAoc3VwZXJNZXRhQ29uc3QgPT0gSm9vc2UuUHJvdG8uQ2xhc3MgfHwgc3VwZXJNZXRhQ29uc3QgPT0gSm9vc2UuUHJvdG8uT2JqZWN0KSAmJiAhKHBhcmFtcy5pc093biAmJiBvcmlnaW5hbENhbGwuSVNfT1ZFUlJJREUpIFxuICAgICAgICBcbiAgICAgICAgdmFyIG9yaWdpbmFsID0gb3JpZ2luYWxDYWxsXG4gICAgICAgIFxuICAgICAgICBpZiAoaXNDYWxsVG9Qcm90bykgb3JpZ2luYWwgPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB2YXIgYmVmb3JlU1VQRVIgPSB0aGlzLlNVUEVSXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXMuU1VQRVIgID0gc3VwZXJQcm90by5TVVBFUlxuICAgICAgICAgICAgXG4gICAgICAgICAgICB2YXIgcmVzID0gb3JpZ2luYWxDYWxsLmFwcGx5KHRoaXMsIGFyZ3VtZW50cylcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpcy5TVVBFUiA9IGJlZm9yZVNVUEVSXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHJldHVybiByZXNcbiAgICAgICAgfVxuXG4gICAgICAgIHZhciBvdmVycmlkZSA9IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdmFyIGJlZm9yZVNVUEVSID0gdGhpcy5TVVBFUlxuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLlNVUEVSICA9IG9yaWdpbmFsXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciByZXMgPSBtb2RpZmllci5hcHBseSh0aGlzLCBhcmd1bWVudHMpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXMuU1VQRVIgPSBiZWZvcmVTVVBFUlxuICAgICAgICAgICAgXG4gICAgICAgICAgICByZXR1cm4gcmVzXG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgICAgIG92ZXJyaWRlLklTX09WRVJSSURFID0gdHJ1ZVxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIG92ZXJyaWRlXG4gICAgfVxuICAgIFxuICAgIFxufSkuYztcbkpvb3NlLk1hbmFnZWQuUHJvcGVydHkuTWV0aG9kTW9kaWZpZXIuUHV0ID0gbmV3IEpvb3NlLlByb3RvLkNsYXNzKCdKb29zZS5NYW5hZ2VkLlByb3BlcnR5Lk1ldGhvZE1vZGlmaWVyLlB1dCcsIHtcbiAgICBcbiAgICBpc2EgOiBKb29zZS5NYW5hZ2VkLlByb3BlcnR5Lk1ldGhvZE1vZGlmaWVyLk92ZXJyaWRlLFxuXG5cbiAgICBwcmVwYXJlV3JhcHBlciA6IGZ1bmN0aW9uIChwYXJhbXMpIHtcbiAgICAgICAgXG4gICAgICAgIGlmIChwYXJhbXMuaXNPd24pIHRocm93IFwiTWV0aG9kIFtcIiArIHBhcmFtcy5uYW1lICsgXCJdIGlzIGFwcGx5aW5nIG92ZXIgc29tZXRoaW5nIFtcIiArIHBhcmFtcy5vcmlnaW5hbENhbGwgKyBcIl0gaW4gY2xhc3MgW1wiICsgcGFyYW1zLnRhcmdldCArIFwiXVwiXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5NZXRob2RNb2RpZmllci5QdXQuc3VwZXJDbGFzcy5wcmVwYXJlV3JhcHBlci5jYWxsKHRoaXMsIHBhcmFtcylcbiAgICB9XG4gICAgXG4gICAgXG59KS5jO1xuSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5NZXRob2RNb2RpZmllci5BZnRlciA9IG5ldyBKb29zZS5Qcm90by5DbGFzcygnSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5NZXRob2RNb2RpZmllci5BZnRlcicsIHtcbiAgICBcbiAgICBpc2EgOiBKb29zZS5NYW5hZ2VkLlByb3BlcnR5Lk1ldGhvZE1vZGlmaWVyLFxuXG4gICAgXG4gICAgcHJlcGFyZVdyYXBwZXIgOiBmdW5jdGlvbiAocGFyYW1zKSB7XG4gICAgICAgIFxuICAgICAgICB2YXIgbW9kaWZpZXIgICAgICAgID0gcGFyYW1zLm1vZGlmaWVyXG4gICAgICAgIHZhciBvcmlnaW5hbENhbGwgICAgPSBwYXJhbXMub3JpZ2luYWxDYWxsXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgdmFyIHJlcyA9IG9yaWdpbmFsQ2FsbC5hcHBseSh0aGlzLCBhcmd1bWVudHMpXG4gICAgICAgICAgICBtb2RpZmllci5hcHBseSh0aGlzLCBhcmd1bWVudHMpXG4gICAgICAgICAgICByZXR1cm4gcmVzXG4gICAgICAgIH1cbiAgICB9ICAgIFxuXG4gICAgXG59KS5jO1xuSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5NZXRob2RNb2RpZmllci5CZWZvcmUgPSBuZXcgSm9vc2UuUHJvdG8uQ2xhc3MoJ0pvb3NlLk1hbmFnZWQuUHJvcGVydHkuTWV0aG9kTW9kaWZpZXIuQmVmb3JlJywge1xuICAgIFxuICAgIGlzYSA6IEpvb3NlLk1hbmFnZWQuUHJvcGVydHkuTWV0aG9kTW9kaWZpZXIsXG5cbiAgICBcbiAgICBwcmVwYXJlV3JhcHBlciA6IGZ1bmN0aW9uIChwYXJhbXMpIHtcbiAgICAgICAgXG4gICAgICAgIHZhciBtb2RpZmllciAgICAgICAgPSBwYXJhbXMubW9kaWZpZXJcbiAgICAgICAgdmFyIG9yaWdpbmFsQ2FsbCAgICA9IHBhcmFtcy5vcmlnaW5hbENhbGxcbiAgICAgICAgXG4gICAgICAgIHJldHVybiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBtb2RpZmllci5hcHBseSh0aGlzLCBhcmd1bWVudHMpXG4gICAgICAgICAgICByZXR1cm4gb3JpZ2luYWxDYWxsLmFwcGx5KHRoaXMsIGFyZ3VtZW50cylcbiAgICAgICAgfVxuICAgIH1cbiAgICBcbn0pLmM7XG5Kb29zZS5NYW5hZ2VkLlByb3BlcnR5Lk1ldGhvZE1vZGlmaWVyLkFyb3VuZCA9IG5ldyBKb29zZS5Qcm90by5DbGFzcygnSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5NZXRob2RNb2RpZmllci5Bcm91bmQnLCB7XG4gICAgXG4gICAgaXNhIDogSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5NZXRob2RNb2RpZmllcixcblxuICAgIHByZXBhcmVXcmFwcGVyIDogZnVuY3Rpb24gKHBhcmFtcykge1xuICAgICAgICBcbiAgICAgICAgdmFyIG1vZGlmaWVyICAgICAgICA9IHBhcmFtcy5tb2RpZmllclxuICAgICAgICB2YXIgb3JpZ2luYWxDYWxsICAgID0gcGFyYW1zLm9yaWdpbmFsQ2FsbFxuICAgICAgICBcbiAgICAgICAgdmFyIG1lXG4gICAgICAgIFxuICAgICAgICB2YXIgYm91bmQgPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICByZXR1cm4gb3JpZ2luYWxDYWxsLmFwcGx5KG1lLCBhcmd1bWVudHMpXG4gICAgICAgIH1cbiAgICAgICAgICAgIFxuICAgICAgICByZXR1cm4gZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgbWUgPSB0aGlzXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciBib3VuZEFyciA9IFsgYm91bmQgXVxuICAgICAgICAgICAgYm91bmRBcnIucHVzaC5hcHBseShib3VuZEFyciwgYXJndW1lbnRzKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICByZXR1cm4gbW9kaWZpZXIuYXBwbHkodGhpcywgYm91bmRBcnIpXG4gICAgICAgIH1cbiAgICB9XG4gICAgXG59KS5jO1xuSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5NZXRob2RNb2RpZmllci5BdWdtZW50ID0gbmV3IEpvb3NlLlByb3RvLkNsYXNzKCdKb29zZS5NYW5hZ2VkLlByb3BlcnR5Lk1ldGhvZE1vZGlmaWVyLkF1Z21lbnQnLCB7XG4gICAgXG4gICAgaXNhIDogSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5NZXRob2RNb2RpZmllcixcblxuICAgIFxuICAgIHByZXBhcmVXcmFwcGVyIDogZnVuY3Rpb24gKHBhcmFtcykge1xuICAgICAgICBcbiAgICAgICAgdmFyIEFVR01FTlQgPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vcG9wdWxhdGUgY2FsbHN0YWNrIHRvIHRoZSBtb3N0IGRlZXAgbm9uLWF1Z21lbnQgbWV0aG9kXG4gICAgICAgICAgICB2YXIgY2FsbHN0YWNrID0gW11cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdmFyIHNlbGYgPSBBVUdNRU5UXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGRvIHtcbiAgICAgICAgICAgICAgICBjYWxsc3RhY2sucHVzaChzZWxmLklTX0FVR01FTlQgPyBzZWxmLl9fQ09OVEFJTl9fIDogc2VsZilcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBzZWxmID0gc2VsZi5JU19BVUdNRU5UICYmIChzZWxmLl9fT1JJR0lOQUxfXyB8fCBzZWxmLlNVUEVSW3NlbGYubWV0aG9kTmFtZV0pXG4gICAgICAgICAgICB9IHdoaWxlIChzZWxmKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vc2F2ZSBwcmV2aW91cyBJTk5FUlxuICAgICAgICAgICAgdmFyIGJlZm9yZUlOTkVSID0gdGhpcy5JTk5FUlxuICAgICAgICAgICAgXG4gICAgICAgICAgICAvL2NyZWF0ZSBuZXcgSU5ORVJcbiAgICAgICAgICAgIHRoaXMuSU5ORVIgPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgICAgdmFyIGlubmVyQ2FsbCA9IGNhbGxzdGFjay5wb3AoKVxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIHJldHVybiBpbm5lckNhbGwgPyBpbm5lckNhbGwuYXBwbHkodGhpcywgYXJndW1lbnRzKSA6IHVuZGVmaW5lZFxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgXG4gICAgICAgICAgICAvL2F1Z21lbnQgbW9kaWZpZXIgcmVzdWx0cyBpbiBoeXBvdGV0aWNhbCBJTk5FUiBjYWxsIG9mIHRoZSBzYW1lIG1ldGhvZCBpbiBzdWJjbGFzcyBcbiAgICAgICAgICAgIHZhciByZXMgPSB0aGlzLklOTkVSLmFwcGx5KHRoaXMsIGFyZ3VtZW50cylcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy9yZXN0b3JlIHByZXZpb3VzIElOTkVSIGNoYWluXG4gICAgICAgICAgICB0aGlzLklOTkVSID0gYmVmb3JlSU5ORVJcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcmV0dXJuIHJlc1xuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICBBVUdNRU5ULm1ldGhvZE5hbWUgID0gcGFyYW1zLm5hbWVcbiAgICAgICAgQVVHTUVOVC5TVVBFUiAgICAgICA9IHBhcmFtcy5zdXBlclByb3RvXG4gICAgICAgIEFVR01FTlQuSVNfQVVHTUVOVCAgPSB0cnVlXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gQVVHTUVOVFxuICAgIH1cbiAgICBcbn0pLmM7XG5Kb29zZS5NYW5hZ2VkLlByb3BlcnR5U2V0ID0gbmV3IEpvb3NlLlByb3RvLkNsYXNzKCdKb29zZS5NYW5hZ2VkLlByb3BlcnR5U2V0Jywge1xuICAgIFxuICAgIGlzYSAgICAgICAgICAgICAgICAgICAgICAgOiBKb29zZS5NYW5hZ2VkLlByb3BlcnR5LFxuXG4gICAgcHJvcGVydGllcyAgICAgICAgICAgICAgICA6IG51bGwsXG4gICAgXG4gICAgcHJvcGVydHlNZXRhQ2xhc3MgICAgICAgICA6IEpvb3NlLk1hbmFnZWQuUHJvcGVydHksXG4gICAgXG4gICAgXG4gICAgaW5pdGlhbGl6ZSA6IGZ1bmN0aW9uIChwcm9wcykge1xuICAgICAgICBKb29zZS5NYW5hZ2VkLlByb3BlcnR5U2V0LnN1cGVyQ2xhc3MuaW5pdGlhbGl6ZS5jYWxsKHRoaXMsIHByb3BzKVxuICAgICAgICBcbiAgICAgICAgLy9YWFggdGhpcyBndWFyZHMgdGhlIG1ldGEgcm9sZXMgOilcbiAgICAgICAgdGhpcy5wcm9wZXJ0aWVzID0gcHJvcHMucHJvcGVydGllcyB8fCB7fVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgYWRkUHJvcGVydHkgOiBmdW5jdGlvbiAobmFtZSwgcHJvcHMpIHtcbiAgICAgICAgdmFyIG1ldGFDbGFzcyA9IHByb3BzLm1ldGEgfHwgdGhpcy5wcm9wZXJ0eU1ldGFDbGFzc1xuICAgICAgICBkZWxldGUgcHJvcHMubWV0YVxuICAgICAgICBcbiAgICAgICAgcHJvcHMuZGVmaW5lZEluICAgICA9IHRoaXNcbiAgICAgICAgcHJvcHMubmFtZSAgICAgICAgICA9IG5hbWVcbiAgICAgICAgXG4gICAgICAgIHJldHVybiB0aGlzLnByb3BlcnRpZXNbbmFtZV0gPSBuZXcgbWV0YUNsYXNzKHByb3BzKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgYWRkUHJvcGVydHlPYmplY3QgOiBmdW5jdGlvbiAob2JqZWN0KSB7XG4gICAgICAgIHJldHVybiB0aGlzLnByb3BlcnRpZXNbb2JqZWN0Lm5hbWVdID0gb2JqZWN0XG4gICAgfSxcbiAgICBcbiAgICBcbiAgICByZW1vdmVQcm9wZXJ0eSA6IGZ1bmN0aW9uIChuYW1lKSB7XG4gICAgICAgIHZhciBwcm9wID0gdGhpcy5wcm9wZXJ0aWVzW25hbWVdXG4gICAgICAgIFxuICAgICAgICBkZWxldGUgdGhpcy5wcm9wZXJ0aWVzW25hbWVdXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gcHJvcFxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgaGF2ZVByb3BlcnR5IDogZnVuY3Rpb24gKG5hbWUpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMucHJvcGVydGllc1tuYW1lXSAhPSBudWxsXG4gICAgfSxcbiAgICBcblxuICAgIGhhdmVPd25Qcm9wZXJ0eSA6IGZ1bmN0aW9uIChuYW1lKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmhhdmVQcm9wZXJ0eShuYW1lKSAmJiB0aGlzLnByb3BlcnRpZXMuaGFzT3duUHJvcGVydHkobmFtZSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGdldFByb3BlcnR5IDogZnVuY3Rpb24gKG5hbWUpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMucHJvcGVydGllc1tuYW1lXVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgLy9pbmNsdWRlcyBpbmhlcml0ZWQgcHJvcGVydGllcyAocHJvYmFibHkgeW91IHdhbnRzICdlYWNoT3duJywgd2hpY2ggcHJvY2VzcyBvbmx5IFwib3duXCIgKGluY2x1ZGluZyBjb25zdW1lZCBmcm9tIFJvbGVzKSBwcm9wZXJ0aWVzKSBcbiAgICBlYWNoIDogZnVuY3Rpb24gKGZ1bmMsIHNjb3BlKSB7XG4gICAgICAgIEpvb3NlLk8uZWFjaCh0aGlzLnByb3BlcnRpZXMsIGZ1bmMsIHNjb3BlIHx8IHRoaXMpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBlYWNoT3duIDogZnVuY3Rpb24gKGZ1bmMsIHNjb3BlKSB7XG4gICAgICAgIEpvb3NlLk8uZWFjaE93bih0aGlzLnByb3BlcnRpZXMsIGZ1bmMsIHNjb3BlIHx8IHRoaXMpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICAvL3N5bm9ueW0gZm9yIGVhY2hcbiAgICBlYWNoQWxsIDogZnVuY3Rpb24gKGZ1bmMsIHNjb3BlKSB7XG4gICAgICAgIHRoaXMuZWFjaChmdW5jLCBzY29wZSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGNsb25lUHJvcHMgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHZhciBwcm9wcyA9IEpvb3NlLk1hbmFnZWQuUHJvcGVydHlTZXQuc3VwZXJDbGFzcy5jbG9uZVByb3BzLmNhbGwodGhpcylcbiAgICAgICAgXG4gICAgICAgIHByb3BzLnByb3BlcnR5TWV0YUNsYXNzICAgICA9IHRoaXMucHJvcGVydHlNZXRhQ2xhc3NcbiAgICAgICAgXG4gICAgICAgIHJldHVybiBwcm9wc1xuICAgIH0sXG4gICAgXG4gICAgXG4gICAgY2xvbmUgOiBmdW5jdGlvbiAobmFtZSkge1xuICAgICAgICB2YXIgY2xvbmUgPSB0aGlzLmNsZWFuQ2xvbmUobmFtZSlcbiAgICAgICAgXG4gICAgICAgIGNsb25lLnByb3BlcnRpZXMgPSBKb29zZS5PLmNvcHlPd24odGhpcy5wcm9wZXJ0aWVzKVxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIGNsb25lXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBjbGVhbkNsb25lIDogZnVuY3Rpb24gKG5hbWUpIHtcbiAgICAgICAgdmFyIHByb3BzID0gdGhpcy5jbG9uZVByb3BzKClcbiAgICAgICAgXG4gICAgICAgIHByb3BzLm5hbWUgPSBuYW1lIHx8IHByb3BzLm5hbWVcbiAgICAgICAgXG4gICAgICAgIHJldHVybiBuZXcgdGhpcy5jb25zdHJ1Y3Rvcihwcm9wcylcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGFsaWFzIDogZnVuY3Rpb24gKHdoYXQpIHtcbiAgICAgICAgdmFyIHByb3BzID0gdGhpcy5wcm9wZXJ0aWVzXG4gICAgICAgIFxuICAgICAgICBKb29zZS5PLmVhY2god2hhdCwgZnVuY3Rpb24gKGFsaWFzTmFtZSwgb3JpZ2luYWxOYW1lKSB7XG4gICAgICAgICAgICB2YXIgb3JpZ2luYWwgPSBwcm9wc1tvcmlnaW5hbE5hbWVdXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmIChvcmlnaW5hbCkgdGhpcy5hZGRQcm9wZXJ0eU9iamVjdChvcmlnaW5hbC5jbG9uZShhbGlhc05hbWUpKVxuICAgICAgICB9LCB0aGlzKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgZXhjbHVkZSA6IGZ1bmN0aW9uICh3aGF0KSB7XG4gICAgICAgIHZhciBwcm9wcyA9IHRoaXMucHJvcGVydGllc1xuICAgICAgICBcbiAgICAgICAgSm9vc2UuQS5lYWNoKHdoYXQsIGZ1bmN0aW9uIChuYW1lKSB7XG4gICAgICAgICAgICBkZWxldGUgcHJvcHNbbmFtZV1cbiAgICAgICAgfSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGJlZm9yZUNvbnN1bWVkQnkgOiBmdW5jdGlvbiAoKSB7XG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBmbGF0dGVuVG8gOiBmdW5jdGlvbiAodGFyZ2V0KSB7XG4gICAgICAgIHZhciB0YXJnZXRQcm9wcyA9IHRhcmdldC5wcm9wZXJ0aWVzXG4gICAgICAgIFxuICAgICAgICB0aGlzLmVhY2hPd24oZnVuY3Rpb24gKHByb3BlcnR5LCBuYW1lKSB7XG4gICAgICAgICAgICB2YXIgdGFyZ2V0UHJvcGVydHkgPSB0YXJnZXRQcm9wc1tuYW1lXVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAodGFyZ2V0UHJvcGVydHkgaW5zdGFuY2VvZiBKb29zZS5NYW5hZ2VkLlByb3BlcnR5LkNvbmZsaWN0TWFya2VyKSByZXR1cm5cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKCF0YXJnZXRQcm9wcy5oYXNPd25Qcm9wZXJ0eShuYW1lKSB8fCB0YXJnZXRQcm9wZXJ0eSA9PSBudWxsKSB7XG4gICAgICAgICAgICAgICAgdGFyZ2V0LmFkZFByb3BlcnR5T2JqZWN0KHByb3BlcnR5KVxuICAgICAgICAgICAgICAgIHJldHVyblxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAodGFyZ2V0UHJvcGVydHkgPT0gcHJvcGVydHkpIHJldHVyblxuICAgICAgICAgICAgXG4gICAgICAgICAgICB0YXJnZXQucmVtb3ZlUHJvcGVydHkobmFtZSlcbiAgICAgICAgICAgIHRhcmdldC5hZGRQcm9wZXJ0eShuYW1lLCB7XG4gICAgICAgICAgICAgICAgbWV0YSA6IEpvb3NlLk1hbmFnZWQuUHJvcGVydHkuQ29uZmxpY3RNYXJrZXJcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH0sIHRoaXMpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBjb21wb3NlVG8gOiBmdW5jdGlvbiAodGFyZ2V0KSB7XG4gICAgICAgIHRoaXMuZWFjaE93bihmdW5jdGlvbiAocHJvcGVydHksIG5hbWUpIHtcbiAgICAgICAgICAgIGlmICghdGFyZ2V0LmhhdmVPd25Qcm9wZXJ0eShuYW1lKSkgdGFyZ2V0LmFkZFByb3BlcnR5T2JqZWN0KHByb3BlcnR5KVxuICAgICAgICB9KVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgY29tcG9zZUZyb20gOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIGlmICghYXJndW1lbnRzLmxlbmd0aCkgcmV0dXJuXG4gICAgICAgIFxuICAgICAgICB2YXIgZmxhdHRlbmluZyA9IHRoaXMuY2xlYW5DbG9uZSgpXG4gICAgICAgIFxuICAgICAgICBKb29zZS5BLmVhY2goYXJndW1lbnRzLCBmdW5jdGlvbiAoYXJnKSB7XG4gICAgICAgICAgICB2YXIgaXNEZXNjcmlwdG9yICAgID0gIShhcmcgaW5zdGFuY2VvZiBKb29zZS5NYW5hZ2VkLlByb3BlcnR5U2V0KVxuICAgICAgICAgICAgdmFyIHByb3BTZXQgICAgICAgICA9IGlzRGVzY3JpcHRvciA/IGFyZy5wcm9wZXJ0eVNldCA6IGFyZ1xuICAgICAgICAgICAgXG4gICAgICAgICAgICBwcm9wU2V0LmJlZm9yZUNvbnN1bWVkQnkodGhpcywgZmxhdHRlbmluZylcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKGlzRGVzY3JpcHRvcikge1xuICAgICAgICAgICAgICAgIGlmIChhcmcuYWxpYXMgfHwgYXJnLmV4Y2x1ZGUpICAgcHJvcFNldCA9IHByb3BTZXQuY2xvbmUoKVxuICAgICAgICAgICAgICAgIGlmIChhcmcuYWxpYXMpICAgICAgICAgICAgICAgICAgcHJvcFNldC5hbGlhcyhhcmcuYWxpYXMpXG4gICAgICAgICAgICAgICAgaWYgKGFyZy5leGNsdWRlKSAgICAgICAgICAgICAgICBwcm9wU2V0LmV4Y2x1ZGUoYXJnLmV4Y2x1ZGUpXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHByb3BTZXQuZmxhdHRlblRvKGZsYXR0ZW5pbmcpXG4gICAgICAgIH0sIHRoaXMpXG4gICAgICAgIFxuICAgICAgICBmbGF0dGVuaW5nLmNvbXBvc2VUbyh0aGlzKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgcHJlQXBwbHkgOiBmdW5jdGlvbiAodGFyZ2V0KSB7XG4gICAgICAgIHRoaXMuZWFjaE93bihmdW5jdGlvbiAocHJvcGVydHkpIHtcbiAgICAgICAgICAgIHByb3BlcnR5LnByZUFwcGx5KHRhcmdldClcbiAgICAgICAgfSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGFwcGx5IDogZnVuY3Rpb24gKHRhcmdldCkge1xuICAgICAgICB0aGlzLmVhY2hPd24oZnVuY3Rpb24gKHByb3BlcnR5KSB7XG4gICAgICAgICAgICBwcm9wZXJ0eS5hcHBseSh0YXJnZXQpXG4gICAgICAgIH0pXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICB1bmFwcGx5IDogZnVuY3Rpb24gKGZyb20pIHtcbiAgICAgICAgdGhpcy5lYWNoT3duKGZ1bmN0aW9uIChwcm9wZXJ0eSkge1xuICAgICAgICAgICAgcHJvcGVydHkudW5hcHBseShmcm9tKVxuICAgICAgICB9KVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgcG9zdFVuQXBwbHkgOiBmdW5jdGlvbiAodGFyZ2V0KSB7XG4gICAgICAgIHRoaXMuZWFjaE93bihmdW5jdGlvbiAocHJvcGVydHkpIHtcbiAgICAgICAgICAgIHByb3BlcnR5LnBvc3RVbkFwcGx5KHRhcmdldClcbiAgICAgICAgfSlcbiAgICB9XG4gICAgXG59KS5jXG47XG52YXIgX19JRF9fID0gMVxuXG5cbkpvb3NlLk1hbmFnZWQuUHJvcGVydHlTZXQuTXV0YWJsZSA9IG5ldyBKb29zZS5Qcm90by5DbGFzcygnSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eVNldC5NdXRhYmxlJywge1xuICAgIFxuICAgIGlzYSAgICAgICAgICAgICAgICAgOiBKb29zZS5NYW5hZ2VkLlByb3BlcnR5U2V0LFxuXG4gICAgSUQgICAgICAgICAgICAgICAgICA6IG51bGwsXG4gICAgXG4gICAgZGVyaXZhdGl2ZXMgICAgICAgICA6IG51bGwsXG4gICAgXG4gICAgb3BlbmVkICAgICAgICAgICAgICA6IG51bGwsXG4gICAgXG4gICAgY29tcG9zZWRGcm9tICAgICAgICA6IG51bGwsXG4gICAgXG4gICAgXG4gICAgaW5pdGlhbGl6ZSA6IGZ1bmN0aW9uIChwcm9wcykge1xuICAgICAgICBKb29zZS5NYW5hZ2VkLlByb3BlcnR5U2V0Lk11dGFibGUuc3VwZXJDbGFzcy5pbml0aWFsaXplLmNhbGwodGhpcywgcHJvcHMpXG4gICAgICAgIFxuICAgICAgICAvL2luaXRpYWxseSBvcGVuZWRcbiAgICAgICAgdGhpcy5vcGVuZWQgICAgICAgICAgICAgPSAxXG4gICAgICAgIHRoaXMuZGVyaXZhdGl2ZXMgICAgICAgID0ge31cbiAgICAgICAgdGhpcy5JRCAgICAgICAgICAgICAgICAgPSBfX0lEX18rK1xuICAgICAgICB0aGlzLmNvbXBvc2VkRnJvbSAgICAgICA9IFtdXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBhZGRDb21wb3NlSW5mbyA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgdGhpcy5lbnN1cmVPcGVuKClcbiAgICAgICAgXG4gICAgICAgIEpvb3NlLkEuZWFjaChhcmd1bWVudHMsIGZ1bmN0aW9uIChhcmcpIHtcbiAgICAgICAgICAgIHRoaXMuY29tcG9zZWRGcm9tLnB1c2goYXJnKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB2YXIgcHJvcFNldCA9IGFyZyBpbnN0YW5jZW9mIEpvb3NlLk1hbmFnZWQuUHJvcGVydHlTZXQgPyBhcmcgOiBhcmcucHJvcGVydHlTZXRcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgIHByb3BTZXQuZGVyaXZhdGl2ZXNbdGhpcy5JRF0gPSB0aGlzXG4gICAgICAgIH0sIHRoaXMpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICByZW1vdmVDb21wb3NlSW5mbyA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgdGhpcy5lbnN1cmVPcGVuKClcbiAgICAgICAgXG4gICAgICAgIEpvb3NlLkEuZWFjaChhcmd1bWVudHMsIGZ1bmN0aW9uIChhcmcpIHtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdmFyIGkgPSAwXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHdoaWxlIChpIDwgdGhpcy5jb21wb3NlZEZyb20ubGVuZ3RoKSB7XG4gICAgICAgICAgICAgICAgdmFyIHByb3BTZXQgPSB0aGlzLmNvbXBvc2VkRnJvbVtpXVxuICAgICAgICAgICAgICAgIHByb3BTZXQgPSBwcm9wU2V0IGluc3RhbmNlb2YgSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eVNldCA/IHByb3BTZXQgOiBwcm9wU2V0LnByb3BlcnR5U2V0XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgaWYgKGFyZyA9PSBwcm9wU2V0KSB7XG4gICAgICAgICAgICAgICAgICAgIGRlbGV0ZSBwcm9wU2V0LmRlcml2YXRpdmVzW3RoaXMuSURdXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuY29tcG9zZWRGcm9tLnNwbGljZShpLCAxKVxuICAgICAgICAgICAgICAgIH0gZWxzZSBpKytcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIFxuICAgICAgICB9LCB0aGlzKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgZW5zdXJlT3BlbiA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgaWYgKCF0aGlzLm9wZW5lZCkgdGhyb3cgXCJNdXRhdGlvbiBvZiBjbG9zZWQgcHJvcGVydHkgc2V0OiBbXCIgKyB0aGlzLm5hbWUgKyBcIl1cIlxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgYWRkUHJvcGVydHkgOiBmdW5jdGlvbiAobmFtZSwgcHJvcHMpIHtcbiAgICAgICAgdGhpcy5lbnN1cmVPcGVuKClcbiAgICAgICAgXG4gICAgICAgIHJldHVybiBKb29zZS5NYW5hZ2VkLlByb3BlcnR5U2V0Lk11dGFibGUuc3VwZXJDbGFzcy5hZGRQcm9wZXJ0eS5jYWxsKHRoaXMsIG5hbWUsIHByb3BzKVxuICAgIH0sXG4gICAgXG5cbiAgICBhZGRQcm9wZXJ0eU9iamVjdCA6IGZ1bmN0aW9uIChvYmplY3QpIHtcbiAgICAgICAgdGhpcy5lbnN1cmVPcGVuKClcbiAgICAgICAgXG4gICAgICAgIHJldHVybiBKb29zZS5NYW5hZ2VkLlByb3BlcnR5U2V0Lk11dGFibGUuc3VwZXJDbGFzcy5hZGRQcm9wZXJ0eU9iamVjdC5jYWxsKHRoaXMsIG9iamVjdClcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIHJlbW92ZVByb3BlcnR5IDogZnVuY3Rpb24gKG5hbWUpIHtcbiAgICAgICAgdGhpcy5lbnN1cmVPcGVuKClcbiAgICAgICAgXG4gICAgICAgIHJldHVybiBKb29zZS5NYW5hZ2VkLlByb3BlcnR5U2V0Lk11dGFibGUuc3VwZXJDbGFzcy5yZW1vdmVQcm9wZXJ0eS5jYWxsKHRoaXMsIG5hbWUpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBjb21wb3NlRnJvbSA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgdGhpcy5lbnN1cmVPcGVuKClcbiAgICAgICAgXG4gICAgICAgIHJldHVybiBKb29zZS5NYW5hZ2VkLlByb3BlcnR5U2V0Lk11dGFibGUuc3VwZXJDbGFzcy5jb21wb3NlRnJvbS5hcHBseSh0aGlzLCB0aGlzLmNvbXBvc2VkRnJvbSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIG9wZW4gOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHRoaXMub3BlbmVkKytcbiAgICAgICAgXG4gICAgICAgIGlmICh0aGlzLm9wZW5lZCA9PSAxKSB7XG4gICAgICAgIFxuICAgICAgICAgICAgSm9vc2UuTy5lYWNoKHRoaXMuZGVyaXZhdGl2ZXMsIGZ1bmN0aW9uIChwcm9wU2V0KSB7XG4gICAgICAgICAgICAgICAgcHJvcFNldC5vcGVuKClcbiAgICAgICAgICAgIH0pXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXMuZGVDb21wb3NlKClcbiAgICAgICAgfVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgY2xvc2UgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIGlmICghdGhpcy5vcGVuZWQpIHRocm93IFwiVW5tYXRjaGVkICdjbG9zZScgb3BlcmF0aW9uIG9uIHByb3BlcnR5IHNldDogW1wiICsgdGhpcy5uYW1lICsgXCJdXCJcbiAgICAgICAgXG4gICAgICAgIGlmICh0aGlzLm9wZW5lZCA9PSAxKSB7XG4gICAgICAgICAgICB0aGlzLnJlQ29tcG9zZSgpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIEpvb3NlLk8uZWFjaCh0aGlzLmRlcml2YXRpdmVzLCBmdW5jdGlvbiAocHJvcFNldCkge1xuICAgICAgICAgICAgICAgIHByb3BTZXQuY2xvc2UoKVxuICAgICAgICAgICAgfSlcbiAgICAgICAgfVxuICAgICAgICB0aGlzLm9wZW5lZC0tXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICByZUNvbXBvc2UgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHRoaXMuY29tcG9zZUZyb20oKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgZGVDb21wb3NlIDogZnVuY3Rpb24gKCkge1xuICAgICAgICB0aGlzLmVhY2hPd24oZnVuY3Rpb24gKHByb3BlcnR5LCBuYW1lKSB7XG4gICAgICAgICAgICBpZiAocHJvcGVydHkuZGVmaW5lZEluICE9IHRoaXMpIHRoaXMucmVtb3ZlUHJvcGVydHkobmFtZSlcbiAgICAgICAgfSwgdGhpcylcbiAgICB9XG4gICAgXG59KS5jO1xuSm9vc2UuTWFuYWdlZC5TdGVtRWxlbWVudCA9IGZ1bmN0aW9uICgpIHsgdGhyb3cgXCJNb2R1bGVzIG1heSBub3QgYmUgaW5zdGFudGlhdGVkLlwiIH1cblxuSm9vc2UuTWFuYWdlZC5TdGVtRWxlbWVudC5BdHRyaWJ1dGVzID0gbmV3IEpvb3NlLlByb3RvLkNsYXNzKCdKb29zZS5NYW5hZ2VkLlN0ZW1FbGVtZW50LkF0dHJpYnV0ZXMnLCB7XG4gICAgXG4gICAgaXNhICAgICAgICAgICAgICAgICAgICAgOiBKb29zZS5NYW5hZ2VkLlByb3BlcnR5U2V0Lk11dGFibGUsXG4gICAgXG4gICAgcHJvcGVydHlNZXRhQ2xhc3MgICAgICAgOiBKb29zZS5NYW5hZ2VkLlByb3BlcnR5LkF0dHJpYnV0ZVxuICAgIFxufSkuY1xuO1xuSm9vc2UuTWFuYWdlZC5TdGVtRWxlbWVudC5NZXRob2RzID0gbmV3IEpvb3NlLlByb3RvLkNsYXNzKCdKb29zZS5NYW5hZ2VkLlN0ZW1FbGVtZW50Lk1ldGhvZHMnLCB7XG4gICAgXG4gICAgaXNhIDogSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eVNldC5NdXRhYmxlLFxuICAgIFxuICAgIHByb3BlcnR5TWV0YUNsYXNzIDogSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5NZXRob2RNb2RpZmllci5QdXQsXG5cbiAgICBcbiAgICBwcmVBcHBseSA6IGZ1bmN0aW9uICgpIHtcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIHBvc3RVbkFwcGx5IDogZnVuY3Rpb24gKCkge1xuICAgIH1cbiAgICBcbn0pLmM7XG5Kb29zZS5NYW5hZ2VkLlN0ZW1FbGVtZW50LlJlcXVpcmVtZW50cyA9IG5ldyBKb29zZS5Qcm90by5DbGFzcygnSm9vc2UuTWFuYWdlZC5TdGVtRWxlbWVudC5SZXF1aXJlbWVudHMnLCB7XG5cbiAgICBpc2EgICAgICAgICAgICAgICAgICAgICA6IEpvb3NlLk1hbmFnZWQuUHJvcGVydHlTZXQuTXV0YWJsZSxcbiAgICBcbiAgICBwcm9wZXJ0eU1ldGFDbGFzcyAgICAgICA6IEpvb3NlLk1hbmFnZWQuUHJvcGVydHkuUmVxdWlyZW1lbnQsXG4gICAgXG4gICAgXG4gICAgXG4gICAgYWxpYXMgOiBmdW5jdGlvbiAoKSB7XG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBleGNsdWRlIDogZnVuY3Rpb24gKCkge1xuICAgIH0sXG4gICAgXG4gICAgXG4gICAgZmxhdHRlblRvIDogZnVuY3Rpb24gKHRhcmdldCkge1xuICAgICAgICB0aGlzLmVhY2goZnVuY3Rpb24gKHByb3BlcnR5LCBuYW1lKSB7XG4gICAgICAgICAgICBpZiAoIXRhcmdldC5oYXZlUHJvcGVydHkobmFtZSkpIHRhcmdldC5hZGRQcm9wZXJ0eU9iamVjdChwcm9wZXJ0eSlcbiAgICAgICAgfSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGNvbXBvc2VUbyA6IGZ1bmN0aW9uICh0YXJnZXQpIHtcbiAgICAgICAgdGhpcy5mbGF0dGVuVG8odGFyZ2V0KVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgcHJlQXBwbHkgOiBmdW5jdGlvbiAoKSB7XG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBwb3N0VW5BcHBseSA6IGZ1bmN0aW9uICgpIHtcbiAgICB9XG4gICAgXG59KS5jO1xuSm9vc2UuTWFuYWdlZC5TdGVtRWxlbWVudC5NZXRob2RNb2RpZmllcnMgPSBuZXcgSm9vc2UuUHJvdG8uQ2xhc3MoJ0pvb3NlLk1hbmFnZWQuU3RlbUVsZW1lbnQuTWV0aG9kTW9kaWZpZXJzJywge1xuXG4gICAgaXNhICAgICAgICAgICAgICAgICAgICAgOiBKb29zZS5NYW5hZ2VkLlByb3BlcnR5U2V0Lk11dGFibGUsXG4gICAgXG4gICAgcHJvcGVydHlNZXRhQ2xhc3MgICAgICAgOiBudWxsLFxuICAgIFxuICAgIFxuICAgIGFkZFByb3BlcnR5IDogZnVuY3Rpb24gKG5hbWUsIHByb3BzKSB7XG4gICAgICAgIHZhciBtZXRhQ2xhc3MgPSBwcm9wcy5tZXRhXG4gICAgICAgIGRlbGV0ZSBwcm9wcy5tZXRhXG4gICAgICAgIFxuICAgICAgICBwcm9wcy5kZWZpbmVkSW4gICAgICAgICA9IHRoaXNcbiAgICAgICAgcHJvcHMubmFtZSAgICAgICAgICAgICAgPSBuYW1lXG4gICAgICAgIFxuICAgICAgICB2YXIgbW9kaWZpZXIgICAgICAgICAgICA9IG5ldyBtZXRhQ2xhc3MocHJvcHMpXG4gICAgICAgIHZhciBwcm9wZXJ0aWVzICAgICAgICAgID0gdGhpcy5wcm9wZXJ0aWVzXG4gICAgICAgIFxuICAgICAgICBpZiAoIXByb3BlcnRpZXNbbmFtZV0pIHByb3BlcnRpZXNbIG5hbWUgXSA9IFtdXG4gICAgICAgIFxuICAgICAgICBwcm9wZXJ0aWVzW25hbWVdLnB1c2gobW9kaWZpZXIpXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gbW9kaWZpZXJcbiAgICB9LFxuICAgIFxuXG4gICAgYWRkUHJvcGVydHlPYmplY3QgOiBmdW5jdGlvbiAob2JqZWN0KSB7XG4gICAgICAgIHZhciBuYW1lICAgICAgICAgICAgPSBvYmplY3QubmFtZVxuICAgICAgICB2YXIgcHJvcGVydGllcyAgICAgID0gdGhpcy5wcm9wZXJ0aWVzXG4gICAgICAgIFxuICAgICAgICBpZiAoIXByb3BlcnRpZXNbbmFtZV0pIHByb3BlcnRpZXNbbmFtZV0gPSBbXVxuICAgICAgICBcbiAgICAgICAgcHJvcGVydGllc1tuYW1lXS5wdXNoKG9iamVjdClcbiAgICAgICAgXG4gICAgICAgIHJldHVybiBvYmplY3RcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIC8vcmVtb3ZlIG9ubHkgdGhlIGxhc3QgbW9kaWZpZXJcbiAgICByZW1vdmVQcm9wZXJ0eSA6IGZ1bmN0aW9uIChuYW1lKSB7XG4gICAgICAgIGlmICghdGhpcy5oYXZlUHJvcGVydHkobmFtZSkpIHJldHVybiB1bmRlZmluZWRcbiAgICAgICAgXG4gICAgICAgIHZhciBwcm9wZXJ0aWVzICAgICAgPSB0aGlzLnByb3BlcnRpZXNcbiAgICAgICAgdmFyIG1vZGlmaWVyICAgICAgICA9IHByb3BlcnRpZXNbIG5hbWUgXS5wb3AoKVxuICAgICAgICBcbiAgICAgICAgLy9pZiBhbGwgbW9kaWZpZXJzIHdlcmUgcmVtb3ZlZCAtIGNsZWFyaW5nIHRoZSBwcm9wZXJ0aWVzXG4gICAgICAgIGlmICghcHJvcGVydGllc1tuYW1lXS5sZW5ndGgpIEpvb3NlLk1hbmFnZWQuU3RlbUVsZW1lbnQuTWV0aG9kTW9kaWZpZXJzLnN1cGVyQ2xhc3MucmVtb3ZlUHJvcGVydHkuY2FsbCh0aGlzLCBuYW1lKVxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIG1vZGlmaWVyXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBhbGlhcyA6IGZ1bmN0aW9uICgpIHtcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGV4Y2x1ZGUgOiBmdW5jdGlvbiAoKSB7XG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBmbGF0dGVuVG8gOiBmdW5jdGlvbiAodGFyZ2V0KSB7XG4gICAgICAgIHZhciB0YXJnZXRQcm9wcyA9IHRhcmdldC5wcm9wZXJ0aWVzXG4gICAgICAgIFxuICAgICAgICB0aGlzLmVhY2goZnVuY3Rpb24gKG1vZGlmaWVyc0FyciwgbmFtZSkge1xuICAgICAgICAgICAgdmFyIHRhcmdldE1vZGlmaWVyc0FyciA9IHRhcmdldFByb3BzW25hbWVdXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmICh0YXJnZXRNb2RpZmllcnNBcnIgPT0gbnVsbCkgdGFyZ2V0TW9kaWZpZXJzQXJyID0gdGFyZ2V0UHJvcHNbbmFtZV0gPSBbXVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBKb29zZS5BLmVhY2gobW9kaWZpZXJzQXJyLCBmdW5jdGlvbiAobW9kaWZpZXIpIHtcbiAgICAgICAgICAgICAgICBpZiAoIUpvb3NlLkEuZXhpc3RzKHRhcmdldE1vZGlmaWVyc0FyciwgbW9kaWZpZXIpKSB0YXJnZXRNb2RpZmllcnNBcnIucHVzaChtb2RpZmllcilcbiAgICAgICAgICAgIH0pXG4gICAgICAgICAgICBcbiAgICAgICAgfSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGNvbXBvc2VUbyA6IGZ1bmN0aW9uICh0YXJnZXQpIHtcbiAgICAgICAgdGhpcy5mbGF0dGVuVG8odGFyZ2V0KVxuICAgIH0sXG5cbiAgICBcbiAgICBkZUNvbXBvc2UgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHRoaXMuZWFjaChmdW5jdGlvbiAobW9kaWZpZXJzQXJyLCBuYW1lKSB7XG4gICAgICAgICAgICB2YXIgaSA9IDBcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgd2hpbGUgKGkgPCBtb2RpZmllcnNBcnIubGVuZ3RoKSBcbiAgICAgICAgICAgICAgICBpZiAobW9kaWZpZXJzQXJyW2ldLmRlZmluZWRJbiAhPSB0aGlzKSBcbiAgICAgICAgICAgICAgICAgICAgbW9kaWZpZXJzQXJyLnNwbGljZShpLCAxKVxuICAgICAgICAgICAgICAgIGVsc2UgXG4gICAgICAgICAgICAgICAgICAgIGkrK1xuICAgICAgICB9KVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgcHJlQXBwbHkgOiBmdW5jdGlvbiAodGFyZ2V0KSB7XG4gICAgfSxcblxuICAgIFxuICAgIHBvc3RVbkFwcGx5IDogZnVuY3Rpb24gKHRhcmdldCkge1xuICAgIH0sXG4gICAgXG4gICAgXG4gICAgYXBwbHkgOiBmdW5jdGlvbiAodGFyZ2V0KSB7XG4gICAgICAgIHRoaXMuZWFjaChmdW5jdGlvbiAobW9kaWZpZXJzQXJyLCBuYW1lKSB7XG4gICAgICAgICAgICBKb29zZS5BLmVhY2gobW9kaWZpZXJzQXJyLCBmdW5jdGlvbiAobW9kaWZpZXIpIHtcbiAgICAgICAgICAgICAgICBtb2RpZmllci5hcHBseSh0YXJnZXQpXG4gICAgICAgICAgICB9KVxuICAgICAgICB9KVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgdW5hcHBseSA6IGZ1bmN0aW9uIChmcm9tKSB7XG4gICAgICAgIHRoaXMuZWFjaChmdW5jdGlvbiAobW9kaWZpZXJzQXJyLCBuYW1lKSB7XG4gICAgICAgICAgICBmb3IgKHZhciBpID0gbW9kaWZpZXJzQXJyLmxlbmd0aCAtIDE7IGkgPj0wIDsgaS0tKSBtb2RpZmllcnNBcnJbaV0udW5hcHBseShmcm9tKVxuICAgICAgICB9KVxuICAgIH1cbiAgICBcbiAgICBcbiAgICBcbn0pLmM7XG5Kb29zZS5NYW5hZ2VkLlByb3BlcnR5U2V0LkNvbXBvc2l0aW9uID0gbmV3IEpvb3NlLlByb3RvLkNsYXNzKCdKb29zZS5NYW5hZ2VkLlByb3BlcnR5U2V0LkNvbXBvc2l0aW9uJywge1xuICAgIFxuICAgIGlzYSAgICAgICAgICAgICAgICAgICAgICAgICA6IEpvb3NlLk1hbmFnZWQuUHJvcGVydHlTZXQuTXV0YWJsZSxcbiAgICBcbiAgICBwcm9wZXJ0eU1ldGFDbGFzcyAgICAgICAgICAgOiBKb29zZS5NYW5hZ2VkLlByb3BlcnR5U2V0Lk11dGFibGUsXG4gICAgXG4gICAgcHJvY2Vzc09yZGVyICAgICAgICAgICAgICAgIDogbnVsbCxcblxuICAgIFxuICAgIGVhY2ggOiBmdW5jdGlvbiAoZnVuYywgc2NvcGUpIHtcbiAgICAgICAgdmFyIHByb3BzICAgPSB0aGlzLnByb3BlcnRpZXNcbiAgICAgICAgdmFyIHNjb3BlICAgPSBzY29wZSB8fCB0aGlzXG4gICAgICAgIFxuICAgICAgICBKb29zZS5BLmVhY2godGhpcy5wcm9jZXNzT3JkZXIsIGZ1bmN0aW9uIChuYW1lKSB7XG4gICAgICAgICAgICBmdW5jLmNhbGwoc2NvcGUsIHByb3BzW25hbWVdLCBuYW1lKVxuICAgICAgICB9KVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgZWFjaFIgOiBmdW5jdGlvbiAoZnVuYywgc2NvcGUpIHtcbiAgICAgICAgdmFyIHByb3BzICAgPSB0aGlzLnByb3BlcnRpZXNcbiAgICAgICAgdmFyIHNjb3BlICAgPSBzY29wZSB8fCB0aGlzXG4gICAgICAgIFxuICAgICAgICBKb29zZS5BLmVhY2hSKHRoaXMucHJvY2Vzc09yZGVyLCBmdW5jdGlvbiAobmFtZSkge1xuICAgICAgICAgICAgZnVuYy5jYWxsKHNjb3BlLCBwcm9wc1tuYW1lXSwgbmFtZSlcbiAgICAgICAgfSlcbiAgICAgICAgXG4gICAgICAgIFxuLy8gICAgICAgIHZhciBwcm9wcyAgICAgICAgICAgPSB0aGlzLnByb3BlcnRpZXNcbi8vICAgICAgICB2YXIgcHJvY2Vzc09yZGVyICAgID0gdGhpcy5wcm9jZXNzT3JkZXJcbi8vICAgICAgICBcbi8vICAgICAgICBmb3IodmFyIGkgPSBwcm9jZXNzT3JkZXIubGVuZ3RoIC0gMTsgaSA+PSAwOyBpLS0pIFxuLy8gICAgICAgICAgICBmdW5jLmNhbGwoc2NvcGUgfHwgdGhpcywgcHJvcHNbIHByb2Nlc3NPcmRlcltpXSBdLCBwcm9jZXNzT3JkZXJbaV0pXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBjbG9uZSA6IGZ1bmN0aW9uIChuYW1lKSB7XG4gICAgICAgIHZhciBjbG9uZSA9IHRoaXMuY2xlYW5DbG9uZShuYW1lKVxuICAgICAgICBcbiAgICAgICAgdGhpcy5lYWNoKGZ1bmN0aW9uIChwcm9wZXJ0eSkge1xuICAgICAgICAgICAgY2xvbmUuYWRkUHJvcGVydHlPYmplY3QocHJvcGVydHkuY2xvbmUoKSlcbiAgICAgICAgfSlcbiAgICAgICAgXG4gICAgICAgIHJldHVybiBjbG9uZVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgYWxpYXMgOiBmdW5jdGlvbiAod2hhdCkge1xuICAgICAgICB0aGlzLmVhY2goZnVuY3Rpb24gKHByb3BlcnR5KSB7XG4gICAgICAgICAgICBwcm9wZXJ0eS5hbGlhcyh3aGF0KVxuICAgICAgICB9KVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgZXhjbHVkZSA6IGZ1bmN0aW9uICh3aGF0KSB7XG4gICAgICAgIHRoaXMuZWFjaChmdW5jdGlvbiAocHJvcGVydHkpIHtcbiAgICAgICAgICAgIHByb3BlcnR5LmV4Y2x1ZGUod2hhdClcbiAgICAgICAgfSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGZsYXR0ZW5UbyA6IGZ1bmN0aW9uICh0YXJnZXQpIHtcbiAgICAgICAgdmFyIHRhcmdldFByb3BzID0gdGFyZ2V0LnByb3BlcnRpZXNcbiAgICAgICAgXG4gICAgICAgIHRoaXMuZWFjaChmdW5jdGlvbiAocHJvcGVydHksIG5hbWUpIHtcbiAgICAgICAgICAgIHZhciBzdWJUYXJnZXQgPSB0YXJnZXRQcm9wc1tuYW1lXSB8fCB0YXJnZXQuYWRkUHJvcGVydHkobmFtZSwge1xuICAgICAgICAgICAgICAgIG1ldGEgOiBwcm9wZXJ0eS5jb25zdHJ1Y3RvclxuICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcHJvcGVydHkuZmxhdHRlblRvKHN1YlRhcmdldClcbiAgICAgICAgfSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGNvbXBvc2VUbyA6IGZ1bmN0aW9uICh0YXJnZXQpIHtcbiAgICAgICAgdmFyIHRhcmdldFByb3BzID0gdGFyZ2V0LnByb3BlcnRpZXNcbiAgICAgICAgXG4gICAgICAgIHRoaXMuZWFjaChmdW5jdGlvbiAocHJvcGVydHksIG5hbWUpIHtcbiAgICAgICAgICAgIHZhciBzdWJUYXJnZXQgPSB0YXJnZXRQcm9wc1tuYW1lXSB8fCB0YXJnZXQuYWRkUHJvcGVydHkobmFtZSwge1xuICAgICAgICAgICAgICAgIG1ldGEgOiBwcm9wZXJ0eS5jb25zdHJ1Y3RvclxuICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcHJvcGVydHkuY29tcG9zZVRvKHN1YlRhcmdldClcbiAgICAgICAgfSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIFxuICAgIGRlQ29tcG9zZSA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgdGhpcy5lYWNoUihmdW5jdGlvbiAocHJvcGVydHkpIHtcbiAgICAgICAgICAgIHByb3BlcnR5Lm9wZW4oKVxuICAgICAgICB9KVxuICAgICAgICBcbiAgICAgICAgSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eVNldC5Db21wb3NpdGlvbi5zdXBlckNsYXNzLmRlQ29tcG9zZS5jYWxsKHRoaXMpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICByZUNvbXBvc2UgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIEpvb3NlLk1hbmFnZWQuUHJvcGVydHlTZXQuQ29tcG9zaXRpb24uc3VwZXJDbGFzcy5yZUNvbXBvc2UuY2FsbCh0aGlzKVxuICAgICAgICBcbiAgICAgICAgdGhpcy5lYWNoKGZ1bmN0aW9uIChwcm9wZXJ0eSkge1xuICAgICAgICAgICAgcHJvcGVydHkuY2xvc2UoKVxuICAgICAgICB9KVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgdW5hcHBseSA6IGZ1bmN0aW9uIChmcm9tKSB7XG4gICAgICAgIHRoaXMuZWFjaFIoZnVuY3Rpb24gKHByb3BlcnR5KSB7XG4gICAgICAgICAgICBwcm9wZXJ0eS51bmFwcGx5KGZyb20pXG4gICAgICAgIH0pXG4gICAgfVxuICAgIFxufSkuY1xuO1xuSm9vc2UuTWFuYWdlZC5TdGVtID0gbmV3IEpvb3NlLlByb3RvLkNsYXNzKCdKb29zZS5NYW5hZ2VkLlN0ZW0nLCB7XG4gICAgXG4gICAgaXNhICAgICAgICAgICAgICAgICAgOiBKb29zZS5NYW5hZ2VkLlByb3BlcnR5U2V0LkNvbXBvc2l0aW9uLFxuICAgIFxuICAgIHRhcmdldE1ldGEgICAgICAgICAgIDogbnVsbCxcbiAgICBcbiAgICBhdHRyaWJ1dGVzTUMgICAgICAgICA6IEpvb3NlLk1hbmFnZWQuU3RlbUVsZW1lbnQuQXR0cmlidXRlcyxcbiAgICBtZXRob2RzTUMgICAgICAgICAgICA6IEpvb3NlLk1hbmFnZWQuU3RlbUVsZW1lbnQuTWV0aG9kcyxcbiAgICByZXF1aXJlbWVudHNNQyAgICAgICA6IEpvb3NlLk1hbmFnZWQuU3RlbUVsZW1lbnQuUmVxdWlyZW1lbnRzLFxuICAgIG1ldGhvZHNNb2RpZmllcnNNQyAgIDogSm9vc2UuTWFuYWdlZC5TdGVtRWxlbWVudC5NZXRob2RNb2RpZmllcnMsXG4gICAgXG4gICAgcHJvY2Vzc09yZGVyICAgICAgICAgOiBbICdhdHRyaWJ1dGVzJywgJ21ldGhvZHMnLCAncmVxdWlyZW1lbnRzJywgJ21ldGhvZHNNb2RpZmllcnMnIF0sXG4gICAgXG4gICAgXG4gICAgaW5pdGlhbGl6ZSA6IGZ1bmN0aW9uIChwcm9wcykge1xuICAgICAgICBKb29zZS5NYW5hZ2VkLlN0ZW0uc3VwZXJDbGFzcy5pbml0aWFsaXplLmNhbGwodGhpcywgcHJvcHMpXG4gICAgICAgIFxuICAgICAgICB2YXIgdGFyZ2V0TWV0YSA9IHRoaXMudGFyZ2V0TWV0YVxuICAgICAgICBcbiAgICAgICAgdGhpcy5hZGRQcm9wZXJ0eSgnYXR0cmlidXRlcycsIHtcbiAgICAgICAgICAgIG1ldGEgOiB0aGlzLmF0dHJpYnV0ZXNNQyxcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy9pdCBjYW4gYmUgbm8gJ3RhcmdldE1ldGEnIGluIGNsb25lc1xuICAgICAgICAgICAgcHJvcGVydGllcyA6IHRhcmdldE1ldGEgPyB0YXJnZXRNZXRhLmF0dHJpYnV0ZXMgOiB7fVxuICAgICAgICB9KVxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIHRoaXMuYWRkUHJvcGVydHkoJ21ldGhvZHMnLCB7XG4gICAgICAgICAgICBtZXRhIDogdGhpcy5tZXRob2RzTUMsXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHByb3BlcnRpZXMgOiB0YXJnZXRNZXRhID8gdGFyZ2V0TWV0YS5tZXRob2RzIDoge31cbiAgICAgICAgfSlcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICB0aGlzLmFkZFByb3BlcnR5KCdyZXF1aXJlbWVudHMnLCB7XG4gICAgICAgICAgICBtZXRhIDogdGhpcy5yZXF1aXJlbWVudHNNQ1xuICAgICAgICB9KVxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIHRoaXMuYWRkUHJvcGVydHkoJ21ldGhvZHNNb2RpZmllcnMnLCB7XG4gICAgICAgICAgICBtZXRhIDogdGhpcy5tZXRob2RzTW9kaWZpZXJzTUNcbiAgICAgICAgfSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIHJlQ29tcG9zZSA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgdmFyIGMgICAgICAgPSB0aGlzLnRhcmdldE1ldGEuY1xuICAgICAgICBcbiAgICAgICAgdGhpcy5wcmVBcHBseShjKVxuICAgICAgICBcbiAgICAgICAgSm9vc2UuTWFuYWdlZC5TdGVtLnN1cGVyQ2xhc3MucmVDb21wb3NlLmNhbGwodGhpcylcbiAgICAgICAgXG4gICAgICAgIHRoaXMuYXBwbHkoYylcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGRlQ29tcG9zZSA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgdmFyIGMgICAgICAgPSB0aGlzLnRhcmdldE1ldGEuY1xuICAgICAgICBcbiAgICAgICAgdGhpcy51bmFwcGx5KGMpXG4gICAgICAgIFxuICAgICAgICBKb29zZS5NYW5hZ2VkLlN0ZW0uc3VwZXJDbGFzcy5kZUNvbXBvc2UuY2FsbCh0aGlzKVxuICAgICAgICBcbiAgICAgICAgdGhpcy5wb3N0VW5BcHBseShjKVxuICAgIH1cbiAgICBcbiAgICBcbn0pLmNcbjtcbkpvb3NlLk1hbmFnZWQuQnVpbGRlciA9IG5ldyBKb29zZS5Qcm90by5DbGFzcygnSm9vc2UuTWFuYWdlZC5CdWlsZGVyJywge1xuICAgIFxuICAgIHRhcmdldE1ldGEgICAgICAgICAgOiBudWxsLFxuICAgIFxuICAgIFxuICAgIF9idWlsZFN0YXJ0IDogZnVuY3Rpb24gKHRhcmdldE1ldGEsIHByb3BzKSB7XG4gICAgICAgIHRhcmdldE1ldGEuc3RlbS5vcGVuKClcbiAgICAgICAgXG4gICAgICAgIEpvb3NlLkEuZWFjaChbICd0cmFpdCcsICd0cmFpdHMnLCAncmVtb3ZlVHJhaXQnLCAncmVtb3ZlVHJhaXRzJywgJ2RvZXMnLCAnZG9lc25vdCcsICdkb2VzbnQnIF0sIGZ1bmN0aW9uIChidWlsZGVyKSB7XG4gICAgICAgICAgICBpZiAocHJvcHNbYnVpbGRlcl0pIHtcbiAgICAgICAgICAgICAgICB0aGlzW2J1aWxkZXJdKHRhcmdldE1ldGEsIHByb3BzW2J1aWxkZXJdKVxuICAgICAgICAgICAgICAgIGRlbGV0ZSBwcm9wc1tidWlsZGVyXVxuICAgICAgICAgICAgfVxuICAgICAgICB9LCB0aGlzKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgX2V4dGVuZCA6IGZ1bmN0aW9uIChwcm9wcykge1xuICAgICAgICBpZiAoSm9vc2UuTy5pc0VtcHR5KHByb3BzKSkgcmV0dXJuXG4gICAgICAgIFxuICAgICAgICB2YXIgdGFyZ2V0TWV0YSA9IHRoaXMudGFyZ2V0TWV0YVxuICAgICAgICBcbiAgICAgICAgdGhpcy5fYnVpbGRTdGFydCh0YXJnZXRNZXRhLCBwcm9wcylcbiAgICAgICAgXG4gICAgICAgIEpvb3NlLk8uZWFjaE93bihwcm9wcywgZnVuY3Rpb24gKHZhbHVlLCBuYW1lKSB7XG4gICAgICAgICAgICB2YXIgaGFuZGxlciA9IHRoaXNbbmFtZV1cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKCFoYW5kbGVyKSB0aHJvdyBuZXcgRXJyb3IoXCJVbmtub3duIGJ1aWxkZXIgW1wiICsgbmFtZSArIFwiXSB3YXMgdXNlZCBkdXJpbmcgZXh0ZW5kaW5nIG9mIFtcIiArIHRhcmdldE1ldGEuYyArIFwiXVwiKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBoYW5kbGVyLmNhbGwodGhpcywgdGFyZ2V0TWV0YSwgdmFsdWUpXG4gICAgICAgIH0sIHRoaXMpXG4gICAgICAgIFxuICAgICAgICB0aGlzLl9idWlsZENvbXBsZXRlKHRhcmdldE1ldGEsIHByb3BzKVxuICAgIH0sXG4gICAgXG5cbiAgICBfYnVpbGRDb21wbGV0ZSA6IGZ1bmN0aW9uICh0YXJnZXRNZXRhLCBwcm9wcykge1xuICAgICAgICB0YXJnZXRNZXRhLnN0ZW0uY2xvc2UoKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgbWV0aG9kcyA6IGZ1bmN0aW9uICh0YXJnZXRNZXRhLCBpbmZvKSB7XG4gICAgICAgIEpvb3NlLk8uZWFjaE93bihpbmZvLCBmdW5jdGlvbiAodmFsdWUsIG5hbWUpIHtcbiAgICAgICAgICAgIHRhcmdldE1ldGEuYWRkTWV0aG9kKG5hbWUsIHZhbHVlKVxuICAgICAgICB9KVxuICAgIH0sXG4gICAgXG5cbiAgICByZW1vdmVNZXRob2RzIDogZnVuY3Rpb24gKHRhcmdldE1ldGEsIGluZm8pIHtcbiAgICAgICAgSm9vc2UuQS5lYWNoKGluZm8sIGZ1bmN0aW9uIChuYW1lKSB7XG4gICAgICAgICAgICB0YXJnZXRNZXRhLnJlbW92ZU1ldGhvZChuYW1lKVxuICAgICAgICB9KVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgaGF2ZSA6IGZ1bmN0aW9uICh0YXJnZXRNZXRhLCBpbmZvKSB7XG4gICAgICAgIEpvb3NlLk8uZWFjaE93bihpbmZvLCBmdW5jdGlvbiAodmFsdWUsIG5hbWUpIHtcbiAgICAgICAgICAgIHRhcmdldE1ldGEuYWRkQXR0cmlidXRlKG5hbWUsIHZhbHVlKVxuICAgICAgICB9KVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgaGF2ZW5vdCA6IGZ1bmN0aW9uICh0YXJnZXRNZXRhLCBpbmZvKSB7XG4gICAgICAgIEpvb3NlLkEuZWFjaChpbmZvLCBmdW5jdGlvbiAobmFtZSkge1xuICAgICAgICAgICAgdGFyZ2V0TWV0YS5yZW1vdmVBdHRyaWJ1dGUobmFtZSlcbiAgICAgICAgfSlcbiAgICB9LFxuICAgIFxuXG4gICAgaGF2ZW50IDogZnVuY3Rpb24gKHRhcmdldE1ldGEsIGluZm8pIHtcbiAgICAgICAgdGhpcy5oYXZlbm90KHRhcmdldE1ldGEsIGluZm8pXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBhZnRlciA6IGZ1bmN0aW9uICh0YXJnZXRNZXRhLCBpbmZvKSB7XG4gICAgICAgIEpvb3NlLk8uZWFjaChpbmZvLCBmdW5jdGlvbiAodmFsdWUsIG5hbWUpIHtcbiAgICAgICAgICAgIHRhcmdldE1ldGEuYWRkTWV0aG9kTW9kaWZpZXIobmFtZSwgdmFsdWUsIEpvb3NlLk1hbmFnZWQuUHJvcGVydHkuTWV0aG9kTW9kaWZpZXIuQWZ0ZXIpXG4gICAgICAgIH0pXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBiZWZvcmUgOiBmdW5jdGlvbiAodGFyZ2V0TWV0YSwgaW5mbykge1xuICAgICAgICBKb29zZS5PLmVhY2goaW5mbywgZnVuY3Rpb24gKHZhbHVlLCBuYW1lKSB7XG4gICAgICAgICAgICB0YXJnZXRNZXRhLmFkZE1ldGhvZE1vZGlmaWVyKG5hbWUsIHZhbHVlLCBKb29zZS5NYW5hZ2VkLlByb3BlcnR5Lk1ldGhvZE1vZGlmaWVyLkJlZm9yZSlcbiAgICAgICAgfSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIG92ZXJyaWRlIDogZnVuY3Rpb24gKHRhcmdldE1ldGEsIGluZm8pIHtcbiAgICAgICAgSm9vc2UuTy5lYWNoKGluZm8sIGZ1bmN0aW9uICh2YWx1ZSwgbmFtZSkge1xuICAgICAgICAgICAgdGFyZ2V0TWV0YS5hZGRNZXRob2RNb2RpZmllcihuYW1lLCB2YWx1ZSwgSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5NZXRob2RNb2RpZmllci5PdmVycmlkZSlcbiAgICAgICAgfSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGFyb3VuZCA6IGZ1bmN0aW9uICh0YXJnZXRNZXRhLCBpbmZvKSB7XG4gICAgICAgIEpvb3NlLk8uZWFjaChpbmZvLCBmdW5jdGlvbiAodmFsdWUsIG5hbWUpIHtcbiAgICAgICAgICAgIHRhcmdldE1ldGEuYWRkTWV0aG9kTW9kaWZpZXIobmFtZSwgdmFsdWUsIEpvb3NlLk1hbmFnZWQuUHJvcGVydHkuTWV0aG9kTW9kaWZpZXIuQXJvdW5kKVxuICAgICAgICB9KVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgYXVnbWVudCA6IGZ1bmN0aW9uICh0YXJnZXRNZXRhLCBpbmZvKSB7XG4gICAgICAgIEpvb3NlLk8uZWFjaChpbmZvLCBmdW5jdGlvbiAodmFsdWUsIG5hbWUpIHtcbiAgICAgICAgICAgIHRhcmdldE1ldGEuYWRkTWV0aG9kTW9kaWZpZXIobmFtZSwgdmFsdWUsIEpvb3NlLk1hbmFnZWQuUHJvcGVydHkuTWV0aG9kTW9kaWZpZXIuQXVnbWVudClcbiAgICAgICAgfSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIHJlbW92ZU1vZGlmaWVyIDogZnVuY3Rpb24gKHRhcmdldE1ldGEsIGluZm8pIHtcbiAgICAgICAgSm9vc2UuQS5lYWNoKGluZm8sIGZ1bmN0aW9uIChuYW1lKSB7XG4gICAgICAgICAgICB0YXJnZXRNZXRhLnJlbW92ZU1ldGhvZE1vZGlmaWVyKG5hbWUpXG4gICAgICAgIH0pXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBkb2VzIDogZnVuY3Rpb24gKHRhcmdldE1ldGEsIGluZm8pIHtcbiAgICAgICAgSm9vc2UuQS5lYWNoKEpvb3NlLk8ud2FudEFycmF5KGluZm8pLCBmdW5jdGlvbiAoZGVzYykge1xuICAgICAgICAgICAgdGFyZ2V0TWV0YS5hZGRSb2xlKGRlc2MpXG4gICAgICAgIH0pXG4gICAgfSxcbiAgICBcblxuICAgIGRvZXNub3QgOiBmdW5jdGlvbiAodGFyZ2V0TWV0YSwgaW5mbykge1xuICAgICAgICBKb29zZS5BLmVhY2goSm9vc2UuTy53YW50QXJyYXkoaW5mbyksIGZ1bmN0aW9uIChkZXNjKSB7XG4gICAgICAgICAgICB0YXJnZXRNZXRhLnJlbW92ZVJvbGUoZGVzYylcbiAgICAgICAgfSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGRvZXNudCA6IGZ1bmN0aW9uICh0YXJnZXRNZXRhLCBpbmZvKSB7XG4gICAgICAgIHRoaXMuZG9lc25vdCh0YXJnZXRNZXRhLCBpbmZvKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgdHJhaXQgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHRoaXMudHJhaXRzLmFwcGx5KHRoaXMsIGFyZ3VtZW50cylcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIHRyYWl0cyA6IGZ1bmN0aW9uICh0YXJnZXRNZXRhLCBpbmZvKSB7XG4gICAgICAgIGlmICh0YXJnZXRNZXRhLmZpcnN0UGFzcykgcmV0dXJuXG4gICAgICAgIFxuICAgICAgICBpZiAoIXRhcmdldE1ldGEubWV0YS5pc0RldGFjaGVkKSB0aHJvdyBcIkNhbid0IGFwcGx5IHRyYWl0IHRvIG5vdCBkZXRhY2hlZCBjbGFzc1wiXG4gICAgICAgIFxuICAgICAgICB0YXJnZXRNZXRhLm1ldGEuZXh0ZW5kKHtcbiAgICAgICAgICAgIGRvZXMgOiBpbmZvXG4gICAgICAgIH0pXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICByZW1vdmVUcmFpdCA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgdGhpcy5yZW1vdmVUcmFpdHMuYXBwbHkodGhpcywgYXJndW1lbnRzKVxuICAgIH0sXG4gICAgIFxuICAgIFxuICAgIHJlbW92ZVRyYWl0cyA6IGZ1bmN0aW9uICh0YXJnZXRNZXRhLCBpbmZvKSB7XG4gICAgICAgIGlmICghdGFyZ2V0TWV0YS5tZXRhLmlzRGV0YWNoZWQpIHRocm93IFwiQ2FuJ3QgcmVtb3ZlIHRyYWl0IGZyb20gbm90IGRldGFjaGVkIGNsYXNzXCJcbiAgICAgICAgXG4gICAgICAgIHRhcmdldE1ldGEubWV0YS5leHRlbmQoe1xuICAgICAgICAgICAgZG9lc25vdCA6IGluZm9cbiAgICAgICAgfSlcbiAgICB9XG4gICAgXG4gICAgXG4gICAgXG59KS5jO1xuSm9vc2UuTWFuYWdlZC5DbGFzcyA9IG5ldyBKb29zZS5Qcm90by5DbGFzcygnSm9vc2UuTWFuYWdlZC5DbGFzcycsIHtcbiAgICBcbiAgICBpc2EgICAgICAgICAgICAgICAgICAgICAgICAgOiBKb29zZS5Qcm90by5DbGFzcyxcbiAgICBcbiAgICBzdGVtICAgICAgICAgICAgICAgICAgICAgICAgOiBudWxsLFxuICAgIHN0ZW1DbGFzcyAgICAgICAgICAgICAgICAgICA6IEpvb3NlLk1hbmFnZWQuU3RlbSxcbiAgICBzdGVtQ2xhc3NDcmVhdGVkICAgICAgICAgICAgOiBmYWxzZSxcbiAgICBcbiAgICBidWlsZGVyICAgICAgICAgICAgICAgICAgICAgOiBudWxsLFxuICAgIGJ1aWxkZXJDbGFzcyAgICAgICAgICAgICAgICA6IEpvb3NlLk1hbmFnZWQuQnVpbGRlcixcbiAgICBidWlsZGVyQ2xhc3NDcmVhdGVkICAgICAgICAgOiBmYWxzZSxcbiAgICBcbiAgICBpc0RldGFjaGVkICAgICAgICAgICAgICAgICAgOiBmYWxzZSxcbiAgICBmaXJzdFBhc3MgICAgICAgICAgICAgICAgICAgOiB0cnVlLFxuICAgIFxuICAgIC8vIGEgc3BlY2lhbCBpbnN0YW5jZSwgd2hpY2gsIHdoZW4gcGFzc2VkIGFzIDFzdCBhcmd1bWVudCB0byBjb25zdHJ1Y3Rvciwgc2lnbmlmaWVzIHRoYXQgY29uc3RydWN0b3Igc2hvdWxkXG4gICAgLy8gc2tpcHMgdHJhaXRzIHByb2Nlc3NpbmcgZm9yIHRoaXMgaW5zdGFuY2VcbiAgICBza2lwVHJhaXRzQW5jaG9yICAgICAgICAgICAgOiB7fSxcbiAgICBcbiAgICBcbiAgICAvL2J1aWxkIGZvciBtZXRhY2xhc3NlcyAtIGNvbGxlY3RzIHRyYWl0cyBmcm9tIHJvbGVzXG4gICAgQlVJTEQgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHZhciBzdXAgPSBKb29zZS5NYW5hZ2VkLkNsYXNzLnN1cGVyQ2xhc3MuQlVJTEQuYXBwbHkodGhpcywgYXJndW1lbnRzKVxuICAgICAgICBcbiAgICAgICAgdmFyIHByb3BzICAgPSBzdXAuX19leHRlbmRfX1xuICAgICAgICBcbiAgICAgICAgdmFyIHRyYWl0cyA9IEpvb3NlLk8ud2FudEFycmF5KHByb3BzLnRyYWl0IHx8IHByb3BzLnRyYWl0cyB8fCBbXSlcbiAgICAgICAgZGVsZXRlIHByb3BzLnRyYWl0XG4gICAgICAgIGRlbGV0ZSBwcm9wcy50cmFpdHNcbiAgICAgICAgXG4gICAgICAgIEpvb3NlLkEuZWFjaChKb29zZS5PLndhbnRBcnJheShwcm9wcy5kb2VzIHx8IFtdKSwgZnVuY3Rpb24gKGFyZykge1xuICAgICAgICAgICAgdmFyIHJvbGUgPSAoYXJnLm1ldGEgaW5zdGFuY2VvZiBKb29zZS5NYW5hZ2VkLkNsYXNzKSA/IGFyZyA6IGFyZy5yb2xlXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmIChyb2xlLm1ldGEubWV0YS5pc0RldGFjaGVkKSB0cmFpdHMucHVzaChyb2xlLm1ldGEuY29uc3RydWN0b3IpXG4gICAgICAgIH0pXG4gICAgICAgIFxuICAgICAgICBpZiAodHJhaXRzLmxlbmd0aCkgcHJvcHMudHJhaXRzID0gdHJhaXRzIFxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIHN1cFxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgaW5pdEluc3RhbmNlIDogZnVuY3Rpb24gKGluc3RhbmNlLCBwcm9wcykge1xuICAgICAgICBKb29zZS5PLmVhY2godGhpcy5hdHRyaWJ1dGVzLCBmdW5jdGlvbiAoYXR0cmlidXRlLCBuYW1lKSB7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmIChhdHRyaWJ1dGUgaW5zdGFuY2VvZiBKb29zZS5NYW5hZ2VkLkF0dHJpYnV0ZSkgXG4gICAgICAgICAgICAgICAgYXR0cmlidXRlLmluaXRGcm9tQ29uZmlnKGluc3RhbmNlLCBwcm9wcylcbiAgICAgICAgICAgIGVsc2UgXG4gICAgICAgICAgICAgICAgaWYgKHByb3BzLmhhc093blByb3BlcnR5KG5hbWUpKSBpbnN0YW5jZVtuYW1lXSA9IHByb3BzW25hbWVdXG4gICAgICAgIH0pXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICAvLyB3ZSBhcmUgdXNpbmcgdGhlIHNhbWUgY29uc3RydWN0b3IgZm9yIHVzdWFsIGFuZCBtZXRhLSBjbGFzc2VzXG4gICAgZGVmYXVsdENvbnN0cnVjdG9yOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHJldHVybiBmdW5jdGlvbiAoc2tpcFRyYWl0c0FuY2hvciwgcGFyYW1zKSB7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciB0aGlzTWV0YSAgICA9IHRoaXMubWV0YVxuICAgICAgICAgICAgdmFyIHNraXBUcmFpdHMgID0gc2tpcFRyYWl0c0FuY2hvciA9PSB0aGlzTWV0YS5za2lwVHJhaXRzQW5jaG9yXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciBCVUlMRCAgICAgICA9IHRoaXMuQlVJTERcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdmFyIHByb3BzICAgICAgID0gQlVJTEQgJiYgQlVJTEQuYXBwbHkodGhpcywgc2tpcFRyYWl0cyA/IHBhcmFtcyA6IGFyZ3VtZW50cykgfHwgKHNraXBUcmFpdHMgPyBwYXJhbXNbMF0gOiBza2lwVHJhaXRzQW5jaG9yKSB8fCB7fVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vIGVpdGhlciBsb29raW5nIGZvciB0cmFpdHMgaW4gX19leHRlbmRfXyAobWV0YS1jbGFzcykgb3IgaW4gdXN1YWwgcHJvcHMgKHVzdWFsIGNsYXNzKVxuICAgICAgICAgICAgdmFyIGV4dGVuZCAgPSBwcm9wcy5fX2V4dGVuZF9fIHx8IHByb3BzXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciB0cmFpdHMgPSBleHRlbmQudHJhaXQgfHwgZXh0ZW5kLnRyYWl0c1xuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAodHJhaXRzIHx8IGV4dGVuZC5kZXRhY2hlZCkge1xuICAgICAgICAgICAgICAgIGRlbGV0ZSBleHRlbmQudHJhaXRcbiAgICAgICAgICAgICAgICBkZWxldGUgZXh0ZW5kLnRyYWl0c1xuICAgICAgICAgICAgICAgIGRlbGV0ZSBleHRlbmQuZGV0YWNoZWRcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBpZiAoIXNraXBUcmFpdHMpIHtcbiAgICAgICAgICAgICAgICAgICAgdmFyIGNsYXNzV2l0aFRyYWl0ICA9IHRoaXNNZXRhLnN1YkNsYXNzKHsgZG9lcyA6IHRyYWl0cyB8fCBbXSB9LCB0aGlzTWV0YS5uYW1lKVxuICAgICAgICAgICAgICAgICAgICB2YXIgbWV0YSAgICAgICAgICAgID0gY2xhc3NXaXRoVHJhaXQubWV0YVxuICAgICAgICAgICAgICAgICAgICBtZXRhLmlzRGV0YWNoZWQgICAgID0gdHJ1ZVxuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIG1ldGEuaW5zdGFudGlhdGUodGhpc01ldGEuc2tpcFRyYWl0c0FuY2hvciwgYXJndW1lbnRzKVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpc01ldGEuaW5pdEluc3RhbmNlKHRoaXMsIHByb3BzKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICByZXR1cm4gdGhpc01ldGEuaGFzTWV0aG9kKCdpbml0aWFsaXplJykgJiYgdGhpcy5pbml0aWFsaXplKHByb3BzKSB8fCB0aGlzXG4gICAgICAgIH1cbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGZpbmFsaXplOiBmdW5jdGlvbiAoZXh0ZW5kKSB7XG4gICAgICAgIEpvb3NlLk1hbmFnZWQuQ2xhc3Muc3VwZXJDbGFzcy5maW5hbGl6ZS5jYWxsKHRoaXMsIGV4dGVuZClcbiAgICAgICAgXG4gICAgICAgIHRoaXMuc3RlbS5jbG9zZSgpXG4gICAgICAgIFxuICAgICAgICB0aGlzLmFmdGVyTXV0YXRlKClcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIHByb2Nlc3NTdGVtIDogZnVuY3Rpb24gKCkge1xuICAgICAgICBKb29zZS5NYW5hZ2VkLkNsYXNzLnN1cGVyQ2xhc3MucHJvY2Vzc1N0ZW0uY2FsbCh0aGlzKVxuICAgICAgICBcbiAgICAgICAgdGhpcy5idWlsZGVyICAgID0gbmV3IHRoaXMuYnVpbGRlckNsYXNzKHsgdGFyZ2V0TWV0YSA6IHRoaXMgfSlcbiAgICAgICAgdGhpcy5zdGVtICAgICAgID0gbmV3IHRoaXMuc3RlbUNsYXNzKHsgbmFtZSA6IHRoaXMubmFtZSwgdGFyZ2V0TWV0YSA6IHRoaXMgfSlcbiAgICAgICAgXG4gICAgICAgIHZhciBidWlsZGVyQ2xhc3MgPSB0aGlzLmdldENsYXNzSW5BdHRyaWJ1dGUoJ2J1aWxkZXJDbGFzcycpXG4gICAgICAgIFxuICAgICAgICBpZiAoYnVpbGRlckNsYXNzKSB7XG4gICAgICAgICAgICB0aGlzLmJ1aWxkZXJDbGFzc0NyZWF0ZWQgPSB0cnVlXG4gICAgICAgICAgICB0aGlzLmFkZEF0dHJpYnV0ZSgnYnVpbGRlckNsYXNzJywgdGhpcy5zdWJDbGFzc09mKGJ1aWxkZXJDbGFzcykpXG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICB2YXIgc3RlbUNsYXNzID0gdGhpcy5nZXRDbGFzc0luQXR0cmlidXRlKCdzdGVtQ2xhc3MnKVxuICAgICAgICBcbiAgICAgICAgaWYgKHN0ZW1DbGFzcykge1xuICAgICAgICAgICAgdGhpcy5zdGVtQ2xhc3NDcmVhdGVkID0gdHJ1ZVxuICAgICAgICAgICAgdGhpcy5hZGRBdHRyaWJ1dGUoJ3N0ZW1DbGFzcycsIHRoaXMuc3ViQ2xhc3NPZihzdGVtQ2xhc3MpKVxuICAgICAgICB9XG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBleHRlbmQgOiBmdW5jdGlvbiAocHJvcHMpIHtcbiAgICAgICAgaWYgKHByb3BzLmJ1aWxkZXIpIHtcbiAgICAgICAgICAgIHRoaXMuZ2V0QnVpbGRlclRhcmdldCgpLm1ldGEuZXh0ZW5kKHByb3BzLmJ1aWxkZXIpXG4gICAgICAgICAgICBkZWxldGUgcHJvcHMuYnVpbGRlclxuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICBpZiAocHJvcHMuc3RlbSkge1xuICAgICAgICAgICAgdGhpcy5nZXRTdGVtVGFyZ2V0KCkubWV0YS5leHRlbmQocHJvcHMuc3RlbSlcbiAgICAgICAgICAgIGRlbGV0ZSBwcm9wcy5zdGVtXG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgICAgIHRoaXMuYnVpbGRlci5fZXh0ZW5kKHByb3BzKVxuICAgICAgICBcbiAgICAgICAgdGhpcy5maXJzdFBhc3MgPSBmYWxzZVxuICAgICAgICBcbiAgICAgICAgaWYgKCF0aGlzLnN0ZW0ub3BlbmVkKSB0aGlzLmFmdGVyTXV0YXRlKClcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGdldEJ1aWxkZXJUYXJnZXQgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHZhciBidWlsZGVyQ2xhc3MgPSB0aGlzLmdldENsYXNzSW5BdHRyaWJ1dGUoJ2J1aWxkZXJDbGFzcycpXG4gICAgICAgIGlmICghYnVpbGRlckNsYXNzKSB0aHJvdyBcIkF0dGVtcHQgdG8gZXh0ZW5kIGEgYnVpbGRlciBvbiBub24tbWV0YSBjbGFzc1wiXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gYnVpbGRlckNsYXNzXG4gICAgfSxcbiAgICBcblxuICAgIGdldFN0ZW1UYXJnZXQgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHZhciBzdGVtQ2xhc3MgPSB0aGlzLmdldENsYXNzSW5BdHRyaWJ1dGUoJ3N0ZW1DbGFzcycpXG4gICAgICAgIGlmICghc3RlbUNsYXNzKSB0aHJvdyBcIkF0dGVtcHQgdG8gZXh0ZW5kIGEgc3RlbSBvbiBub24tbWV0YSBjbGFzc1wiXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gc3RlbUNsYXNzXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBnZXRDbGFzc0luQXR0cmlidXRlIDogZnVuY3Rpb24gKGF0dHJpYnV0ZU5hbWUpIHtcbiAgICAgICAgdmFyIGF0dHJDbGFzcyA9IHRoaXMuZ2V0QXR0cmlidXRlKGF0dHJpYnV0ZU5hbWUpXG4gICAgICAgIGlmIChhdHRyQ2xhc3MgaW5zdGFuY2VvZiBKb29zZS5NYW5hZ2VkLlByb3BlcnR5LkF0dHJpYnV0ZSkgYXR0ckNsYXNzID0gYXR0ckNsYXNzLnZhbHVlXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gYXR0ckNsYXNzXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBhZGRNZXRob2RNb2RpZmllcjogZnVuY3Rpb24gKG5hbWUsIGZ1bmMsIHR5cGUpIHtcbiAgICAgICAgdmFyIHByb3BzID0ge31cbiAgICAgICAgXG4gICAgICAgIHByb3BzLmluaXQgPSBmdW5jXG4gICAgICAgIHByb3BzLm1ldGEgPSB0eXBlXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gdGhpcy5zdGVtLnByb3BlcnRpZXMubWV0aG9kc01vZGlmaWVycy5hZGRQcm9wZXJ0eShuYW1lLCBwcm9wcylcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIHJlbW92ZU1ldGhvZE1vZGlmaWVyOiBmdW5jdGlvbiAobmFtZSkge1xuICAgICAgICByZXR1cm4gdGhpcy5zdGVtLnByb3BlcnRpZXMubWV0aG9kc01vZGlmaWVycy5yZW1vdmVQcm9wZXJ0eShuYW1lKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgYWRkTWV0aG9kOiBmdW5jdGlvbiAobmFtZSwgZnVuYywgcHJvcHMpIHtcbiAgICAgICAgcHJvcHMgPSBwcm9wcyB8fCB7fVxuICAgICAgICBwcm9wcy5pbml0ID0gZnVuY1xuICAgICAgICBcbiAgICAgICAgcmV0dXJuIHRoaXMuc3RlbS5wcm9wZXJ0aWVzLm1ldGhvZHMuYWRkUHJvcGVydHkobmFtZSwgcHJvcHMpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBhZGRBdHRyaWJ1dGU6IGZ1bmN0aW9uIChuYW1lLCBpbml0LCBwcm9wcykge1xuICAgICAgICBwcm9wcyA9IHByb3BzIHx8IHt9XG4gICAgICAgIHByb3BzLmluaXQgPSBpbml0XG4gICAgICAgIFxuICAgICAgICByZXR1cm4gdGhpcy5zdGVtLnByb3BlcnRpZXMuYXR0cmlidXRlcy5hZGRQcm9wZXJ0eShuYW1lLCBwcm9wcylcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIHJlbW92ZU1ldGhvZCA6IGZ1bmN0aW9uIChuYW1lKSB7XG4gICAgICAgIHJldHVybiB0aGlzLnN0ZW0ucHJvcGVydGllcy5tZXRob2RzLnJlbW92ZVByb3BlcnR5KG5hbWUpXG4gICAgfSxcblxuICAgIFxuICAgIHJlbW92ZUF0dHJpYnV0ZTogZnVuY3Rpb24gKG5hbWUpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuc3RlbS5wcm9wZXJ0aWVzLmF0dHJpYnV0ZXMucmVtb3ZlUHJvcGVydHkobmFtZSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGhhc01ldGhvZDogZnVuY3Rpb24gKG5hbWUpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuc3RlbS5wcm9wZXJ0aWVzLm1ldGhvZHMuaGF2ZVByb3BlcnR5KG5hbWUpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBoYXNBdHRyaWJ1dGU6IGZ1bmN0aW9uIChuYW1lKSB7IFxuICAgICAgICByZXR1cm4gdGhpcy5zdGVtLnByb3BlcnRpZXMuYXR0cmlidXRlcy5oYXZlUHJvcGVydHkobmFtZSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGhhc01ldGhvZE1vZGlmaWVyc0ZvciA6IGZ1bmN0aW9uIChuYW1lKSB7XG4gICAgICAgIHJldHVybiB0aGlzLnN0ZW0ucHJvcGVydGllcy5tZXRob2RzTW9kaWZpZXJzLmhhdmVQcm9wZXJ0eShuYW1lKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgaGFzT3duTWV0aG9kOiBmdW5jdGlvbiAobmFtZSkge1xuICAgICAgICByZXR1cm4gdGhpcy5zdGVtLnByb3BlcnRpZXMubWV0aG9kcy5oYXZlT3duUHJvcGVydHkobmFtZSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGhhc093bkF0dHJpYnV0ZTogZnVuY3Rpb24gKG5hbWUpIHsgXG4gICAgICAgIHJldHVybiB0aGlzLnN0ZW0ucHJvcGVydGllcy5hdHRyaWJ1dGVzLmhhdmVPd25Qcm9wZXJ0eShuYW1lKVxuICAgIH0sXG4gICAgXG5cbiAgICBnZXRNZXRob2QgOiBmdW5jdGlvbiAobmFtZSkge1xuICAgICAgICByZXR1cm4gdGhpcy5zdGVtLnByb3BlcnRpZXMubWV0aG9kcy5nZXRQcm9wZXJ0eShuYW1lKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgZ2V0QXR0cmlidXRlIDogZnVuY3Rpb24gKG5hbWUpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuc3RlbS5wcm9wZXJ0aWVzLmF0dHJpYnV0ZXMuZ2V0UHJvcGVydHkobmFtZSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGVhY2hSb2xlIDogZnVuY3Rpb24gKHJvbGVzLCBmdW5jLCBzY29wZSkge1xuICAgICAgICBKb29zZS5BLmVhY2gocm9sZXMsIGZ1bmN0aW9uIChhcmcsIGluZGV4KSB7XG4gICAgICAgICAgICB2YXIgcm9sZSA9IChhcmcubWV0YSBpbnN0YW5jZW9mIEpvb3NlLk1hbmFnZWQuQ2xhc3MpID8gYXJnIDogYXJnLnJvbGVcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgZnVuYy5jYWxsKHNjb3BlIHx8IHRoaXMsIGFyZywgcm9sZSwgaW5kZXgpXG4gICAgICAgIH0sIHRoaXMpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBhZGRSb2xlIDogZnVuY3Rpb24gKCkge1xuICAgICAgICBcbiAgICAgICAgdGhpcy5lYWNoUm9sZShhcmd1bWVudHMsIGZ1bmN0aW9uIChhcmcsIHJvbGUpIHtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpcy5iZWZvcmVSb2xlQWRkKHJvbGUpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciBkZXNjID0gYXJnXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vY29tcG9zZSBkZXNjcmlwdG9yIGNhbiBjb250YWluICdhbGlhcycgYW5kICdleGNsdWRlJyBmaWVsZHMsIGluIHRoaXMgY2FzZSBhY3R1YWwgcmVmZXJlbmNlIHNob3VsZCBiZSBzdG9yZWRcbiAgICAgICAgICAgIC8vaW50byAncHJvcGVydHlTZXQnIGZpZWxkXG4gICAgICAgICAgICBpZiAocm9sZSAhPSBhcmcpIHtcbiAgICAgICAgICAgICAgICBkZXNjLnByb3BlcnR5U2V0ID0gcm9sZS5tZXRhLnN0ZW1cbiAgICAgICAgICAgICAgICBkZWxldGUgZGVzYy5yb2xlXG4gICAgICAgICAgICB9IGVsc2VcbiAgICAgICAgICAgICAgICBkZXNjID0gZGVzYy5tZXRhLnN0ZW1cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpcy5zdGVtLmFkZENvbXBvc2VJbmZvKGRlc2MpXG4gICAgICAgICAgICBcbiAgICAgICAgfSwgdGhpcylcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGJlZm9yZVJvbGVBZGQgOiBmdW5jdGlvbiAocm9sZSkge1xuICAgICAgICB2YXIgcm9sZU1ldGEgPSByb2xlLm1ldGFcbiAgICAgICAgXG4gICAgICAgIGlmIChyb2xlTWV0YS5idWlsZGVyQ2xhc3NDcmVhdGVkKSB0aGlzLmdldEJ1aWxkZXJUYXJnZXQoKS5tZXRhLmV4dGVuZCh7XG4gICAgICAgICAgICBkb2VzIDogWyByb2xlTWV0YS5nZXRCdWlsZGVyVGFyZ2V0KCkgXVxuICAgICAgICB9KVxuICAgICAgICBcbiAgICAgICAgaWYgKHJvbGVNZXRhLnN0ZW1DbGFzc0NyZWF0ZWQpIHRoaXMuZ2V0U3RlbVRhcmdldCgpLm1ldGEuZXh0ZW5kKHtcbiAgICAgICAgICAgIGRvZXMgOiBbIHJvbGVNZXRhLmdldFN0ZW1UYXJnZXQoKSBdXG4gICAgICAgIH0pXG4gICAgICAgIFxuICAgICAgICBpZiAocm9sZU1ldGEubWV0YS5pc0RldGFjaGVkICYmICF0aGlzLmZpcnN0UGFzcykgdGhpcy5idWlsZGVyLnRyYWl0cyh0aGlzLCByb2xlTWV0YS5jb25zdHJ1Y3RvcilcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGJlZm9yZVJvbGVSZW1vdmUgOiBmdW5jdGlvbiAocm9sZSkge1xuICAgICAgICB2YXIgcm9sZU1ldGEgPSByb2xlLm1ldGFcbiAgICAgICAgXG4gICAgICAgIGlmIChyb2xlTWV0YS5idWlsZGVyQ2xhc3NDcmVhdGVkKSB0aGlzLmdldEJ1aWxkZXJUYXJnZXQoKS5tZXRhLmV4dGVuZCh7XG4gICAgICAgICAgICBkb2VzbnQgOiBbIHJvbGVNZXRhLmdldEJ1aWxkZXJUYXJnZXQoKSBdXG4gICAgICAgIH0pXG4gICAgICAgIFxuICAgICAgICBpZiAocm9sZU1ldGEuc3RlbUNsYXNzQ3JlYXRlZCkgdGhpcy5nZXRTdGVtVGFyZ2V0KCkubWV0YS5leHRlbmQoe1xuICAgICAgICAgICAgZG9lc250IDogWyByb2xlTWV0YS5nZXRTdGVtVGFyZ2V0KCkgXVxuICAgICAgICB9KVxuICAgICAgICBcbiAgICAgICAgaWYgKHJvbGVNZXRhLm1ldGEuaXNEZXRhY2hlZCAmJiAhdGhpcy5maXJzdFBhc3MpIHRoaXMuYnVpbGRlci5yZW1vdmVUcmFpdHModGhpcywgcm9sZU1ldGEuY29uc3RydWN0b3IpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICByZW1vdmVSb2xlIDogZnVuY3Rpb24gKCkge1xuICAgICAgICB0aGlzLmVhY2hSb2xlKGFyZ3VtZW50cywgZnVuY3Rpb24gKGFyZywgcm9sZSkge1xuICAgICAgICAgICAgdGhpcy5iZWZvcmVSb2xlUmVtb3ZlKHJvbGUpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXMuc3RlbS5yZW1vdmVDb21wb3NlSW5mbyhyb2xlLm1ldGEuc3RlbSlcbiAgICAgICAgfSwgdGhpcylcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGdldFJvbGVzIDogZnVuY3Rpb24gKCkge1xuICAgICAgICBcbiAgICAgICAgcmV0dXJuIEpvb3NlLkEubWFwKHRoaXMuc3RlbS5jb21wb3NlZEZyb20sIGZ1bmN0aW9uIChjb21wb3NlRGVzYykge1xuICAgICAgICAgICAgLy9jb21wb3NlIGRlc2NyaXB0b3IgY2FuIGNvbnRhaW4gJ2FsaWFzJyBhbmQgJ2V4Y2x1ZGUnIGZpZWxkcywgaW4gdGhpcyBjYXNlIGFjdHVhbCByZWZlcmVuY2UgaXMgc3RvcmVkXG4gICAgICAgICAgICAvL2ludG8gJ3Byb3BlcnR5U2V0JyBmaWVsZFxuICAgICAgICAgICAgaWYgKCEoY29tcG9zZURlc2MgaW5zdGFuY2VvZiBKb29zZS5NYW5hZ2VkLlByb3BlcnR5U2V0KSkgcmV0dXJuIGNvbXBvc2VEZXNjLnByb3BlcnR5U2V0XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHJldHVybiBjb21wb3NlRGVzYy50YXJnZXRNZXRhLmNcbiAgICAgICAgfSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGRvZXMgOiBmdW5jdGlvbiAocm9sZSkge1xuICAgICAgICB2YXIgbXlSb2xlcyA9IHRoaXMuZ2V0Um9sZXMoKVxuICAgICAgICBcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBteVJvbGVzLmxlbmd0aDsgaSsrKSBpZiAocm9sZSA9PSBteVJvbGVzW2ldKSByZXR1cm4gdHJ1ZVxuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IG15Um9sZXMubGVuZ3RoOyBpKyspIGlmIChteVJvbGVzW2ldLm1ldGEuZG9lcyhyb2xlKSkgcmV0dXJuIHRydWVcbiAgICAgICAgXG4gICAgICAgIHZhciBzdXBlck1ldGEgPSB0aGlzLnN1cGVyQ2xhc3MubWV0YVxuICAgICAgICBcbiAgICAgICAgLy8gY29uc2lkZXJpbmcgdGhlIGNhc2Ugb2YgaW5oZXJpdGluZyBmcm9tIG5vbi1Kb29zZSBjbGFzc2VzXG4gICAgICAgIGlmICh0aGlzLnN1cGVyQ2xhc3MgIT0gSm9vc2UuUHJvdG8uRW1wdHkgJiYgc3VwZXJNZXRhICYmIHN1cGVyTWV0YS5tZXRhICYmIHN1cGVyTWV0YS5tZXRhLmhhc01ldGhvZCgnZG9lcycpKSByZXR1cm4gc3VwZXJNZXRhLmRvZXMocm9sZSlcbiAgICAgICAgXG4gICAgICAgIHJldHVybiBmYWxzZVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgZ2V0TWV0aG9kcyA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuc3RlbS5wcm9wZXJ0aWVzLm1ldGhvZHNcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGdldEF0dHJpYnV0ZXMgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHJldHVybiB0aGlzLnN0ZW0ucHJvcGVydGllcy5hdHRyaWJ1dGVzXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBhZnRlck11dGF0ZSA6IGZ1bmN0aW9uICgpIHtcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGdldEN1cnJlbnRNZXRob2QgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIGZvciAodmFyIHdyYXBwZXIgPSBhcmd1bWVudHMuY2FsbGVlLmNhbGxlciwgY291bnQgPSAwOyB3cmFwcGVyICYmIGNvdW50IDwgNTsgd3JhcHBlciA9IHdyYXBwZXIuY2FsbGVyLCBjb3VudCsrKVxuICAgICAgICAgICAgaWYgKHdyYXBwZXIuX19NRVRIT0RfXykgcmV0dXJuIHdyYXBwZXIuX19NRVRIT0RfX1xuICAgICAgICBcbiAgICAgICAgcmV0dXJuIG51bGxcbiAgICB9XG4gICAgXG4gICAgXG59KS5jO1xuSm9vc2UuTWFuYWdlZC5Sb2xlID0gbmV3IEpvb3NlLk1hbmFnZWQuQ2xhc3MoJ0pvb3NlLk1hbmFnZWQuUm9sZScsIHtcbiAgICBcbiAgICBpc2EgICAgICAgICAgICAgICAgICAgICAgICAgOiBKb29zZS5NYW5hZ2VkLkNsYXNzLFxuICAgIFxuICAgIGhhdmUgOiB7XG4gICAgICAgIGRlZmF1bHRTdXBlckNsYXNzICAgICAgIDogSm9vc2UuUHJvdG8uRW1wdHksXG4gICAgICAgIFxuICAgICAgICBidWlsZGVyUm9sZSAgICAgICAgICAgICA6IG51bGwsXG4gICAgICAgIHN0ZW1Sb2xlICAgICAgICAgICAgICAgIDogbnVsbFxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgbWV0aG9kcyA6IHtcbiAgICAgICAgXG4gICAgICAgIGRlZmF1bHRDb25zdHJ1Y3RvciA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHJldHVybiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiUm9sZXMgY2FudCBiZSBpbnN0YW50aWF0ZWRcIilcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgXG5cbiAgICAgICAgcHJvY2Vzc1N1cGVyQ2xhc3MgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBpZiAodGhpcy5zdXBlckNsYXNzICE9IHRoaXMuZGVmYXVsdFN1cGVyQ2xhc3MpIHRocm93IG5ldyBFcnJvcihcIlJvbGVzIGNhbid0IGluaGVyaXQgZnJvbSBhbnl0aGluZ1wiKVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIGdldEJ1aWxkZXJUYXJnZXQgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBpZiAoIXRoaXMuYnVpbGRlclJvbGUpIHtcbiAgICAgICAgICAgICAgICB0aGlzLmJ1aWxkZXJSb2xlID0gbmV3IHRoaXMuY29uc3RydWN0b3IoKS5jXG4gICAgICAgICAgICAgICAgdGhpcy5idWlsZGVyQ2xhc3NDcmVhdGVkID0gdHJ1ZVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5idWlsZGVyUm9sZVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICBcbiAgICAgICAgZ2V0U3RlbVRhcmdldCA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIGlmICghdGhpcy5zdGVtUm9sZSkge1xuICAgICAgICAgICAgICAgIHRoaXMuc3RlbVJvbGUgPSBuZXcgdGhpcy5jb25zdHJ1Y3RvcigpLmNcbiAgICAgICAgICAgICAgICB0aGlzLnN0ZW1DbGFzc0NyZWF0ZWQgPSB0cnVlXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHJldHVybiB0aGlzLnN0ZW1Sb2xlXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgIFxuICAgICAgICBhZGRSZXF1aXJlbWVudCA6IGZ1bmN0aW9uIChtZXRob2ROYW1lKSB7XG4gICAgICAgICAgICB0aGlzLnN0ZW0ucHJvcGVydGllcy5yZXF1aXJlbWVudHMuYWRkUHJvcGVydHkobWV0aG9kTmFtZSwge30pXG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgfSxcbiAgICBcblxuICAgIHN0ZW0gOiB7XG4gICAgICAgIG1ldGhvZHMgOiB7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGFwcGx5IDogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgXG4gICAgICAgICAgICB1bmFwcGx5IDogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBidWlsZGVyIDoge1xuICAgICAgICBtZXRob2RzIDoge1xuICAgICAgICAgICAgcmVxdWlyZXMgOiBmdW5jdGlvbiAodGFyZ2V0Q2xhc3NNZXRhLCBpbmZvKSB7XG4gICAgICAgICAgICAgICAgSm9vc2UuQS5lYWNoKEpvb3NlLk8ud2FudEFycmF5KGluZm8pLCBmdW5jdGlvbiAobWV0aG9kTmFtZSkge1xuICAgICAgICAgICAgICAgICAgICB0YXJnZXRDbGFzc01ldGEuYWRkUmVxdWlyZW1lbnQobWV0aG9kTmFtZSlcbiAgICAgICAgICAgICAgICB9LCB0aGlzKVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuICAgIFxufSkuYztcbkpvb3NlLk1hbmFnZWQuQXR0cmlidXRlID0gbmV3IEpvb3NlLk1hbmFnZWQuQ2xhc3MoJ0pvb3NlLk1hbmFnZWQuQXR0cmlidXRlJywge1xuICAgIFxuICAgIGlzYSA6IEpvb3NlLk1hbmFnZWQuUHJvcGVydHkuQXR0cmlidXRlLFxuICAgIFxuICAgIGhhdmUgOiB7XG4gICAgICAgIGlzICAgICAgICAgICAgICA6IG51bGwsXG4gICAgICAgIFxuICAgICAgICBidWlsZGVyICAgICAgICAgOiBudWxsLFxuICAgICAgICBcbiAgICAgICAgaXNQcml2YXRlICAgICAgIDogZmFsc2UsXG4gICAgICAgIFxuICAgICAgICByb2xlICAgICAgICAgICAgOiBudWxsLFxuICAgICAgICBcbiAgICAgICAgcHVibGljTmFtZSAgICAgIDogbnVsbCxcbiAgICAgICAgc2V0dGVyTmFtZSAgICAgIDogbnVsbCxcbiAgICAgICAgZ2V0dGVyTmFtZSAgICAgIDogbnVsbCxcbiAgICAgICAgXG4gICAgICAgIC8vaW5kaWNhdGVzIHRoZSBsb2dpY2FsIHJlYWRhYmxlbmVzcy93cml0ZWFibGVuZXNzIG9mIHRoZSBhdHRyaWJ1dGVcbiAgICAgICAgcmVhZGFibGUgICAgICAgIDogZmFsc2UsXG4gICAgICAgIHdyaXRlYWJsZSAgICAgICA6IGZhbHNlLFxuICAgICAgICBcbiAgICAgICAgLy9pbmRpY2F0ZXMgdGhlIHBoeXNpY2FsIHByZXNlbnNlIG9mIHRoZSBhY2Nlc3NvciAobWF5IGJlIGFic2VudCBmb3IgXCJjb21iaW5lZFwiIGFjY2Vzc29ycyBmb3IgZXhhbXBsZSlcbiAgICAgICAgaGFzR2V0dGVyICAgICAgIDogZmFsc2UsXG4gICAgICAgIGhhc1NldHRlciAgICAgICA6IGZhbHNlLFxuICAgICAgICBcbiAgICAgICAgcmVxdWlyZWQgICAgICAgIDogZmFsc2UsXG4gICAgICAgIFxuICAgICAgICBjYW5JbmxpbmVTZXRSYXcgOiB0cnVlLFxuICAgICAgICBjYW5JbmxpbmVHZXRSYXcgOiB0cnVlXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBhZnRlciA6IHtcbiAgICAgICAgaW5pdGlhbGl6ZSA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHZhciBuYW1lID0gdGhpcy5uYW1lXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXMucHVibGljTmFtZSA9IG5hbWUucmVwbGFjZSgvXl8rLywgJycpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXMuc2xvdCA9IHRoaXMuaXNQcml2YXRlID8gJyQkJyArIG5hbWUgOiBuYW1lXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXMuc2V0dGVyTmFtZSA9IHRoaXMuc2V0dGVyTmFtZSB8fCB0aGlzLmdldFNldHRlck5hbWUoKVxuICAgICAgICAgICAgdGhpcy5nZXR0ZXJOYW1lID0gdGhpcy5nZXR0ZXJOYW1lIHx8IHRoaXMuZ2V0R2V0dGVyTmFtZSgpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXMucmVhZGFibGUgID0gdGhpcy5oYXNHZXR0ZXIgPSAvXnIvaS50ZXN0KHRoaXMuaXMpXG4gICAgICAgICAgICB0aGlzLndyaXRlYWJsZSA9IHRoaXMuaGFzU2V0dGVyID0gL14udy9pLnRlc3QodGhpcy5pcylcbiAgICAgICAgfVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgb3ZlcnJpZGUgOiB7XG4gICAgICAgIFxuICAgICAgICBjb21wdXRlVmFsdWUgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB2YXIgaW5pdCAgICA9IHRoaXMuaW5pdFxuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAoSm9vc2UuTy5pc0NsYXNzKGluaXQpIHx8ICFKb29zZS5PLmlzRnVuY3Rpb24oaW5pdCkpIHRoaXMuU1VQRVIoKVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIHByZUFwcGx5IDogZnVuY3Rpb24gKHRhcmdldENsYXNzKSB7XG4gICAgICAgICAgICB0YXJnZXRDbGFzcy5tZXRhLmV4dGVuZCh7XG4gICAgICAgICAgICAgICAgbWV0aG9kcyA6IHRoaXMuZ2V0QWNjZXNzb3JzRm9yKHRhcmdldENsYXNzKVxuICAgICAgICAgICAgfSlcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBwb3N0VW5BcHBseSA6IGZ1bmN0aW9uIChmcm9tKSB7XG4gICAgICAgICAgICBmcm9tLm1ldGEuZXh0ZW5kKHtcbiAgICAgICAgICAgICAgICByZW1vdmVNZXRob2RzIDogdGhpcy5nZXRBY2Nlc3NvcnNGcm9tKGZyb20pXG4gICAgICAgICAgICB9KVxuICAgICAgICB9XG4gICAgICAgIFxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgbWV0aG9kcyA6IHtcbiAgICAgICAgXG4gICAgICAgIGdldEFjY2Vzc29yc0ZvciA6IGZ1bmN0aW9uICh0YXJnZXRDbGFzcykge1xuICAgICAgICAgICAgdmFyIHRhcmdldE1ldGEgPSB0YXJnZXRDbGFzcy5tZXRhXG4gICAgICAgICAgICB2YXIgc2V0dGVyTmFtZSA9IHRoaXMuc2V0dGVyTmFtZVxuICAgICAgICAgICAgdmFyIGdldHRlck5hbWUgPSB0aGlzLmdldHRlck5hbWVcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdmFyIG1ldGhvZHMgPSB7fVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAodGhpcy5oYXNTZXR0ZXIgJiYgIXRhcmdldE1ldGEuaGFzTWV0aG9kKHNldHRlck5hbWUpKSB7XG4gICAgICAgICAgICAgICAgbWV0aG9kc1tzZXR0ZXJOYW1lXSA9IHRoaXMuZ2V0U2V0dGVyKClcbiAgICAgICAgICAgICAgICBtZXRob2RzW3NldHRlck5hbWVdLkFDQ0VTU09SX0ZST00gPSB0aGlzXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmICh0aGlzLmhhc0dldHRlciAmJiAhdGFyZ2V0TWV0YS5oYXNNZXRob2QoZ2V0dGVyTmFtZSkpIHtcbiAgICAgICAgICAgICAgICBtZXRob2RzW2dldHRlck5hbWVdID0gdGhpcy5nZXRHZXR0ZXIoKVxuICAgICAgICAgICAgICAgIG1ldGhvZHNbZ2V0dGVyTmFtZV0uQUNDRVNTT1JfRlJPTSA9IHRoaXNcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcmV0dXJuIG1ldGhvZHNcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBnZXRBY2Nlc3NvcnNGcm9tIDogZnVuY3Rpb24gKGZyb20pIHtcbiAgICAgICAgICAgIHZhciB0YXJnZXRNZXRhID0gZnJvbS5tZXRhXG4gICAgICAgICAgICB2YXIgc2V0dGVyTmFtZSA9IHRoaXMuc2V0dGVyTmFtZVxuICAgICAgICAgICAgdmFyIGdldHRlck5hbWUgPSB0aGlzLmdldHRlck5hbWVcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdmFyIHNldHRlciA9IHRoaXMuaGFzU2V0dGVyICYmIHRhcmdldE1ldGEuZ2V0TWV0aG9kKHNldHRlck5hbWUpXG4gICAgICAgICAgICB2YXIgZ2V0dGVyID0gdGhpcy5oYXNHZXR0ZXIgJiYgdGFyZ2V0TWV0YS5nZXRNZXRob2QoZ2V0dGVyTmFtZSlcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdmFyIHJlbW92ZU1ldGhvZHMgPSBbXVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAoc2V0dGVyICYmIHNldHRlci52YWx1ZS5BQ0NFU1NPUl9GUk9NID09IHRoaXMpIHJlbW92ZU1ldGhvZHMucHVzaChzZXR0ZXJOYW1lKVxuICAgICAgICAgICAgaWYgKGdldHRlciAmJiBnZXR0ZXIudmFsdWUuQUNDRVNTT1JfRlJPTSA9PSB0aGlzKSByZW1vdmVNZXRob2RzLnB1c2goZ2V0dGVyTmFtZSlcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcmV0dXJuIHJlbW92ZU1ldGhvZHNcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBnZXRHZXR0ZXJOYW1lIDogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgcmV0dXJuICdnZXQnICsgSm9vc2UuUy51cHBlcmNhc2VGaXJzdCh0aGlzLnB1YmxpY05hbWUpXG4gICAgICAgIH0sXG5cblxuICAgICAgICBnZXRTZXR0ZXJOYW1lIDogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgcmV0dXJuICdzZXQnICsgSm9vc2UuUy51cHBlcmNhc2VGaXJzdCh0aGlzLnB1YmxpY05hbWUpXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgZ2V0U2V0dGVyIDogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgdmFyIG1lICAgICAgPSB0aGlzXG4gICAgICAgICAgICB2YXIgc2xvdCAgICA9IG1lLnNsb3RcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKG1lLmNhbklubGluZVNldFJhdylcbiAgICAgICAgICAgICAgICByZXR1cm4gZnVuY3Rpb24gKHZhbHVlKSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXNbIHNsb3QgXSA9IHZhbHVlXG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gdGhpc1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGVsc2VcbiAgICAgICAgICAgICAgICByZXR1cm4gZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gbWUuc2V0UmF3VmFsdWVUby5hcHBseSh0aGlzLCBhcmd1bWVudHMpXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIGdldEdldHRlciA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHZhciBtZSAgICAgID0gdGhpc1xuICAgICAgICAgICAgdmFyIHNsb3QgICAgPSBtZS5zbG90XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmIChtZS5jYW5JbmxpbmVHZXRSYXcpXG4gICAgICAgICAgICAgICAgcmV0dXJuIGZ1bmN0aW9uICh2YWx1ZSkge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gdGhpc1sgc2xvdCBdXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZVxuICAgICAgICAgICAgICAgIHJldHVybiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBtZS5nZXRSYXdWYWx1ZUZyb20uYXBwbHkodGhpcywgYXJndW1lbnRzKVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBnZXRWYWx1ZUZyb20gOiBmdW5jdGlvbiAoaW5zdGFuY2UpIHtcbiAgICAgICAgICAgIHZhciBnZXR0ZXJOYW1lICAgICAgPSB0aGlzLmdldHRlck5hbWVcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKHRoaXMucmVhZGFibGUgJiYgaW5zdGFuY2UubWV0YS5oYXNNZXRob2QoZ2V0dGVyTmFtZSkpIHJldHVybiBpbnN0YW5jZVsgZ2V0dGVyTmFtZSBdKClcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcmV0dXJuIHRoaXMuZ2V0UmF3VmFsdWVGcm9tKGluc3RhbmNlKVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIHNldFZhbHVlVG8gOiBmdW5jdGlvbiAoaW5zdGFuY2UsIHZhbHVlKSB7XG4gICAgICAgICAgICB2YXIgc2V0dGVyTmFtZSAgICAgID0gdGhpcy5zZXR0ZXJOYW1lXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmICh0aGlzLndyaXRlYWJsZSAmJiBpbnN0YW5jZS5tZXRhLmhhc01ldGhvZChzZXR0ZXJOYW1lKSkgXG4gICAgICAgICAgICAgICAgaW5zdGFuY2VbIHNldHRlck5hbWUgXSh2YWx1ZSlcbiAgICAgICAgICAgIGVsc2VcbiAgICAgICAgICAgICAgICB0aGlzLnNldFJhd1ZhbHVlVG8oaW5zdGFuY2UsIHZhbHVlKVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIGluaXRGcm9tQ29uZmlnIDogZnVuY3Rpb24gKGluc3RhbmNlLCBjb25maWcpIHtcbiAgICAgICAgICAgIHZhciBuYW1lICAgICAgICAgICAgPSB0aGlzLm5hbWVcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdmFyIHZhbHVlLCBpc1NldCA9IGZhbHNlXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmIChjb25maWcuaGFzT3duUHJvcGVydHkobmFtZSkpIHtcbiAgICAgICAgICAgICAgICB2YWx1ZSA9IGNvbmZpZ1tuYW1lXVxuICAgICAgICAgICAgICAgIGlzU2V0ID0gdHJ1ZVxuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICB2YXIgaW5pdCAgICA9IHRoaXMuaW5pdFxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIC8vIHNpbXBsZSBmdW5jdGlvbiAobm90IGNsYXNzKSBoYXMgYmVlbiB1c2VkIGFzIFwiaW5pdFwiIHZhbHVlXG4gICAgICAgICAgICAgICAgaWYgKEpvb3NlLk8uaXNGdW5jdGlvbihpbml0KSAmJiAhSm9vc2UuTy5pc0NsYXNzKGluaXQpKSB7XG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICB2YWx1ZSA9IGluaXQuY2FsbChpbnN0YW5jZSwgY29uZmlnLCBuYW1lKVxuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgaXNTZXQgPSB0cnVlXG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAodGhpcy5idWlsZGVyKSB7XG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICB2YWx1ZSA9IGluc3RhbmNlWyB0aGlzLmJ1aWxkZXIucmVwbGFjZSgvXnRoaXNcXC4vLCAnJykgXShjb25maWcsIG5hbWUpXG4gICAgICAgICAgICAgICAgICAgIGlzU2V0ID0gdHJ1ZVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKGlzU2V0KVxuICAgICAgICAgICAgICAgIHRoaXMuc2V0UmF3VmFsdWVUbyhpbnN0YW5jZSwgdmFsdWUpXG4gICAgICAgICAgICBlbHNlIFxuICAgICAgICAgICAgICAgIGlmICh0aGlzLnJlcXVpcmVkKSB0aHJvdyBuZXcgRXJyb3IoXCJSZXF1aXJlZCBhdHRyaWJ1dGUgW1wiICsgbmFtZSArIFwiXSBpcyBtaXNzZWQgZHVyaW5nIGluaXRpYWxpemF0aW9uIG9mIFwiICsgaW5zdGFuY2UpXG4gICAgICAgIH1cbiAgICB9XG5cbn0pLmNcbjtcbkpvb3NlLk1hbmFnZWQuQXR0cmlidXRlLkJ1aWxkZXIgPSBuZXcgSm9vc2UuTWFuYWdlZC5Sb2xlKCdKb29zZS5NYW5hZ2VkLkF0dHJpYnV0ZS5CdWlsZGVyJywge1xuICAgIFxuICAgIFxuICAgIGhhdmUgOiB7XG4gICAgICAgIGRlZmF1bHRBdHRyaWJ1dGVDbGFzcyA6IEpvb3NlLk1hbmFnZWQuQXR0cmlidXRlXG4gICAgfSxcbiAgICBcbiAgICBidWlsZGVyIDoge1xuICAgICAgICBcbiAgICAgICAgbWV0aG9kcyA6IHtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaGFzIDogZnVuY3Rpb24gKHRhcmdldENsYXNzTWV0YSwgaW5mbykge1xuICAgICAgICAgICAgICAgIEpvb3NlLk8uZWFjaE93bihpbmZvLCBmdW5jdGlvbiAocHJvcHMsIG5hbWUpIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKHR5cGVvZiBwcm9wcyAhPSAnb2JqZWN0JyB8fCBwcm9wcyA9PSBudWxsIHx8IHByb3BzLmNvbnN0cnVjdG9yID09IC8gLy5jb25zdHJ1Y3RvcikgcHJvcHMgPSB7IGluaXQgOiBwcm9wcyB9XG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICBwcm9wcy5tZXRhID0gcHJvcHMubWV0YSB8fCB0YXJnZXRDbGFzc01ldGEuZGVmYXVsdEF0dHJpYnV0ZUNsYXNzXG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICBpZiAoL15fXy8udGVzdChuYW1lKSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgbmFtZSA9IG5hbWUucmVwbGFjZSgvXl8rLywgJycpXG4gICAgICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgICAgIHByb3BzLmlzUHJpdmF0ZSA9IHRydWVcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgdGFyZ2V0Q2xhc3NNZXRhLmFkZEF0dHJpYnV0ZShuYW1lLCBwcm9wcy5pbml0LCBwcm9wcylcbiAgICAgICAgICAgICAgICB9LCB0aGlzKVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgXG4gICAgICAgICAgICBoYXNub3QgOiBmdW5jdGlvbiAodGFyZ2V0Q2xhc3NNZXRhLCBpbmZvKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5oYXZlbm90KHRhcmdldENsYXNzTWV0YSwgaW5mbylcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaGFzbnQgOiBmdW5jdGlvbiAodGFyZ2V0Q2xhc3NNZXRhLCBpbmZvKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5oYXNub3QodGFyZ2V0Q2xhc3NNZXRhLCBpbmZvKVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgICAgICBcbiAgICB9XG4gICAgXG59KS5jXG47XG5Kb29zZS5NYW5hZ2VkLk15ID0gbmV3IEpvb3NlLk1hbmFnZWQuUm9sZSgnSm9vc2UuTWFuYWdlZC5NeScsIHtcbiAgICBcbiAgICBoYXZlIDoge1xuICAgICAgICBteUNsYXNzICAgICAgICAgICAgICAgICAgICAgICAgIDogbnVsbCxcbiAgICAgICAgXG4gICAgICAgIG5lZWRUb1JlQWxpYXMgICAgICAgICAgICAgICAgICAgOiBmYWxzZVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgbWV0aG9kcyA6IHtcbiAgICAgICAgY3JlYXRlTXkgOiBmdW5jdGlvbiAoZXh0ZW5kKSB7XG4gICAgICAgICAgICB2YXIgdGhpc01ldGEgPSB0aGlzLm1ldGFcbiAgICAgICAgICAgIHZhciBpc1JvbGUgPSB0aGlzIGluc3RhbmNlb2YgSm9vc2UuTWFuYWdlZC5Sb2xlXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciBteUV4dGVuZCA9IGV4dGVuZC5teSB8fCB7fVxuICAgICAgICAgICAgZGVsZXRlIGV4dGVuZC5teVxuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBTeW1iaW9udCB3aWxsIGdlbmVyYWxseSBoYXZlIHRoZSBzYW1lIG1ldGEgY2xhc3MgYXMgaXRzIGhvc3RlciwgZXhjZXB0aW5nIHRoZSBjYXNlcywgd2hlbiB0aGUgc3VwZXJjbGFzcyBhbHNvIGhhdmUgdGhlIHN5bWJpb250LiBcbiAgICAgICAgICAgIC8vIEluIHN1Y2ggY2FzZXMsIHRoZSBtZXRhIGNsYXNzIGZvciBzeW1iaW9udCB3aWxsIGJlIGluaGVyaXRlZCAodW5sZXNzIGV4cGxpY2l0bHkgc3BlY2lmaWVkKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB2YXIgc3VwZXJDbGFzc015ICAgID0gdGhpcy5zdXBlckNsYXNzLm1ldGEubXlDbGFzc1xuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAoIWlzUm9sZSAmJiAhbXlFeHRlbmQuaXNhICYmIHN1cGVyQ2xhc3NNeSkgbXlFeHRlbmQuaXNhID0gc3VwZXJDbGFzc015XG4gICAgICAgICAgICBcblxuICAgICAgICAgICAgaWYgKCFteUV4dGVuZC5tZXRhICYmICFteUV4dGVuZC5pc2EpIG15RXh0ZW5kLm1ldGEgPSB0aGlzLmNvbnN0cnVjdG9yXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciBjcmVhdGVkQ2xhc3MgICAgPSB0aGlzLm15Q2xhc3MgPSBDbGFzcyhteUV4dGVuZClcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdmFyIGMgICAgICAgICAgICAgICA9IHRoaXMuY1xuICAgICAgICAgICAgXG4gICAgICAgICAgICBjLnByb3RvdHlwZS5teSAgICAgID0gYy5teSA9IGlzUm9sZSA/IGNyZWF0ZWRDbGFzcyA6IG5ldyBjcmVhdGVkQ2xhc3MoeyBIT1NUIDogYyB9KVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLm5lZWRUb1JlQWxpYXMgPSB0cnVlXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgYWxpYXNTdGF0aWNNZXRob2RzIDogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgdGhpcy5uZWVkVG9SZUFsaWFzID0gZmFsc2VcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdmFyIGMgICAgICAgICAgID0gdGhpcy5jXG4gICAgICAgICAgICB2YXIgbXlQcm90byAgICAgPSB0aGlzLm15Q2xhc3MucHJvdG90eXBlXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIEpvb3NlLk8uZWFjaE93bihjLCBmdW5jdGlvbiAocHJvcGVydHksIG5hbWUpIHtcbiAgICAgICAgICAgICAgICBpZiAocHJvcGVydHkuSVNfQUxJQVMpIGRlbGV0ZSBjWyBuYW1lIF0gXG4gICAgICAgICAgICB9KVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLm15Q2xhc3MubWV0YS5zdGVtLnByb3BlcnRpZXMubWV0aG9kcy5lYWNoKGZ1bmN0aW9uIChtZXRob2QsIG5hbWUpIHtcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBpZiAoIWNbIG5hbWUgXSlcbiAgICAgICAgICAgICAgICAgICAgKGNbIG5hbWUgXSA9IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBteVByb3RvWyBuYW1lIF0uYXBwbHkoYy5teSwgYXJndW1lbnRzKVxuICAgICAgICAgICAgICAgICAgICB9KS5JU19BTElBUyA9IHRydWVcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH1cbiAgICB9LFxuICAgIFxuICAgIFxuICAgIG92ZXJyaWRlIDoge1xuICAgICAgICBcbiAgICAgICAgZXh0ZW5kIDogZnVuY3Rpb24gKHByb3BzKSB7XG4gICAgICAgICAgICB2YXIgbXlDbGFzcyA9IHRoaXMubXlDbGFzc1xuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAoIW15Q2xhc3MgJiYgdGhpcy5zdXBlckNsYXNzLm1ldGEubXlDbGFzcykgdGhpcy5jcmVhdGVNeShwcm9wcylcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKHByb3BzLm15KSB7XG4gICAgICAgICAgICAgICAgaWYgKCFteUNsYXNzKSBcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5jcmVhdGVNeShwcm9wcylcbiAgICAgICAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5uZWVkVG9SZUFsaWFzID0gdHJ1ZVxuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgbXlDbGFzcy5tZXRhLmV4dGVuZChwcm9wcy5teSlcbiAgICAgICAgICAgICAgICAgICAgZGVsZXRlIHByb3BzLm15XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLlNVUEVSKHByb3BzKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAodGhpcy5uZWVkVG9SZUFsaWFzICYmICEodGhpcyBpbnN0YW5jZW9mIEpvb3NlLk1hbmFnZWQuUm9sZSkpIHRoaXMuYWxpYXNTdGF0aWNNZXRob2RzKClcbiAgICAgICAgfSAgXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBiZWZvcmUgOiB7XG4gICAgICAgIFxuICAgICAgICBhZGRSb2xlIDogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgdmFyIG15U3RlbVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBKb29zZS5BLmVhY2goYXJndW1lbnRzLCBmdW5jdGlvbiAoYXJnKSB7XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgaWYgKCFhcmcpIHRocm93IG5ldyBFcnJvcihcIkF0dGVtcHQgdG8gY29uc3VtZSBhbiB1bmRlZmluZWQgUm9sZSBpbnRvIFtcIiArIHRoaXMubmFtZSArIFwiXVwiKVxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIC8vaW5zdGFuY2VvZiBDbGFzcyB0byBhbGxvdyB0cmVhdCBjbGFzc2VzIGFzIHJvbGVzXG4gICAgICAgICAgICAgICAgdmFyIHJvbGUgPSAoYXJnLm1ldGEgaW5zdGFuY2VvZiBKb29zZS5NYW5hZ2VkLkNsYXNzKSA/IGFyZyA6IGFyZy5yb2xlXG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgaWYgKHJvbGUubWV0YS5tZXRhLmhhc0F0dHJpYnV0ZSgnbXlDbGFzcycpICYmIHJvbGUubWV0YS5teUNsYXNzKSB7XG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICBpZiAoIXRoaXMubXlDbGFzcykge1xuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5jcmVhdGVNeSh7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbXkgOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRvZXMgOiByb2xlLm1ldGEubXlDbGFzc1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm5cbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgbXlTdGVtID0gdGhpcy5teUNsYXNzLm1ldGEuc3RlbVxuICAgICAgICAgICAgICAgICAgICBpZiAoIW15U3RlbS5vcGVuZWQpIG15U3RlbS5vcGVuKClcbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIG15U3RlbS5hZGRDb21wb3NlSW5mbyhyb2xlLm15Lm1ldGEuc3RlbSlcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9LCB0aGlzKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAobXlTdGVtKSB7XG4gICAgICAgICAgICAgICAgbXlTdGVtLmNsb3NlKClcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICB0aGlzLm5lZWRUb1JlQWxpYXMgPSB0cnVlXG4gICAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgcmVtb3ZlUm9sZSA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIGlmICghdGhpcy5teUNsYXNzKSByZXR1cm5cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdmFyIG15U3RlbSA9IHRoaXMubXlDbGFzcy5tZXRhLnN0ZW1cbiAgICAgICAgICAgIG15U3RlbS5vcGVuKClcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgSm9vc2UuQS5lYWNoKGFyZ3VtZW50cywgZnVuY3Rpb24gKHJvbGUpIHtcbiAgICAgICAgICAgICAgICBpZiAocm9sZS5tZXRhLm1ldGEuaGFzQXR0cmlidXRlKCdteUNsYXNzJykgJiYgcm9sZS5tZXRhLm15Q2xhc3MpIHtcbiAgICAgICAgICAgICAgICAgICAgbXlTdGVtLnJlbW92ZUNvbXBvc2VJbmZvKHJvbGUubXkubWV0YS5zdGVtKVxuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5uZWVkVG9SZUFsaWFzID0gdHJ1ZVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0sIHRoaXMpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIG15U3RlbS5jbG9zZSgpXG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgfVxuICAgIFxufSkuYztcbkpvb3NlLk5hbWVzcGFjZSA9IEpvb3NlLnN0dWIoKVxuXG5Kb29zZS5OYW1lc3BhY2UuQWJsZSA9IG5ldyBKb29zZS5NYW5hZ2VkLlJvbGUoJ0pvb3NlLk5hbWVzcGFjZS5BYmxlJywge1xuXG4gICAgaGF2ZSA6IHtcbiAgICAgICAgYm9keUZ1bmMgICAgICAgICAgICAgICAgOiBudWxsXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBiZWZvcmUgOiB7XG4gICAgICAgIGV4dGVuZCA6IGZ1bmN0aW9uIChleHRlbmQpIHtcbiAgICAgICAgICAgIGlmIChleHRlbmQuYm9keSkge1xuICAgICAgICAgICAgICAgIHRoaXMuYm9keUZ1bmMgPSBleHRlbmQuYm9keVxuICAgICAgICAgICAgICAgIGRlbGV0ZSBleHRlbmQuYm9keVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBhZnRlcjoge1xuICAgICAgICBcbiAgICAgICAgYWZ0ZXJNdXRhdGUgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB2YXIgYm9keUZ1bmMgPSB0aGlzLmJvZHlGdW5jXG4gICAgICAgICAgICBkZWxldGUgdGhpcy5ib2R5RnVuY1xuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAoYm9keUZ1bmMpIEpvb3NlLk5hbWVzcGFjZS5NYW5hZ2VyLm15LmV4ZWN1dGVJbih0aGlzLmMsIGJvZHlGdW5jKVxuICAgICAgICB9XG4gICAgfVxuICAgIFxufSkuYztcbkpvb3NlLk1hbmFnZWQuQm9vdHN0cmFwID0gbmV3IEpvb3NlLk1hbmFnZWQuUm9sZSgnSm9vc2UuTWFuYWdlZC5Cb290c3RyYXAnLCB7XG4gICAgXG4gICAgZG9lcyAgIDogWyBKb29zZS5OYW1lc3BhY2UuQWJsZSwgSm9vc2UuTWFuYWdlZC5NeSwgSm9vc2UuTWFuYWdlZC5BdHRyaWJ1dGUuQnVpbGRlciBdXG4gICAgXG59KS5jXG47XG5Kb29zZS5NZXRhID0gSm9vc2Uuc3R1YigpXG5cblxuSm9vc2UuTWV0YS5PYmplY3QgPSBuZXcgSm9vc2UuUHJvdG8uQ2xhc3MoJ0pvb3NlLk1ldGEuT2JqZWN0Jywge1xuICAgIFxuICAgIGlzYSAgICAgICAgICAgICA6IEpvb3NlLlByb3RvLk9iamVjdFxuICAgIFxufSkuY1xuXG5cbjtcbkpvb3NlLk1ldGEuQ2xhc3MgPSBuZXcgSm9vc2UuTWFuYWdlZC5DbGFzcygnSm9vc2UuTWV0YS5DbGFzcycsIHtcbiAgICBcbiAgICBpc2EgICAgICAgICAgICAgICAgICAgICAgICAgOiBKb29zZS5NYW5hZ2VkLkNsYXNzLFxuICAgIFxuICAgIGRvZXMgICAgICAgICAgICAgICAgICAgICAgICA6IEpvb3NlLk1hbmFnZWQuQm9vdHN0cmFwLFxuICAgIFxuICAgIGhhdmUgOiB7XG4gICAgICAgIGRlZmF1bHRTdXBlckNsYXNzICAgICAgIDogSm9vc2UuTWV0YS5PYmplY3RcbiAgICB9XG4gICAgXG59KS5jXG5cbjtcbkpvb3NlLk1ldGEuUm9sZSA9IG5ldyBKb29zZS5NZXRhLkNsYXNzKCdKb29zZS5NZXRhLlJvbGUnLCB7XG4gICAgXG4gICAgaXNhICAgICAgICAgICAgICAgICAgICAgICAgIDogSm9vc2UuTWFuYWdlZC5Sb2xlLFxuICAgIFxuICAgIGRvZXMgICAgICAgICAgICAgICAgICAgICAgICA6IEpvb3NlLk1hbmFnZWQuQm9vdHN0cmFwXG4gICAgXG59KS5jO1xuSm9vc2UuTmFtZXNwYWNlLktlZXBlciA9IG5ldyBKb29zZS5NZXRhLkNsYXNzKCdKb29zZS5OYW1lc3BhY2UuS2VlcGVyJywge1xuICAgIFxuICAgIGlzYSAgICAgICAgIDogSm9vc2UuTWV0YS5DbGFzcyxcbiAgICBcbiAgICBoYXZlICAgICAgICA6IHtcbiAgICAgICAgZXh0ZXJuYWxDb25zdHJ1Y3RvciAgICAgICAgICAgICA6IG51bGxcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIG1ldGhvZHM6IHtcbiAgICAgICAgXG4gICAgICAgIGRlZmF1bHRDb25zdHJ1Y3RvcjogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgXG4gICAgICAgICAgICByZXR1cm4gZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgIC8vY29uc3RydWN0b3JzIHNob3VsZCBhc3N1bWUgdGhhdCBtZXRhIGlzIGF0dGFjaGVkIHRvICdhcmd1bWVudHMuY2FsbGVlJyAobm90IHRvICd0aGlzJykgXG4gICAgICAgICAgICAgICAgdmFyIHRoaXNNZXRhID0gYXJndW1lbnRzLmNhbGxlZS5tZXRhXG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgaWYgKHRoaXNNZXRhIGluc3RhbmNlb2YgSm9vc2UuTmFtZXNwYWNlLktlZXBlcikgdGhyb3cgbmV3IEVycm9yKFwiTW9kdWxlIFtcIiArIHRoaXNNZXRhLmMgKyBcIl0gbWF5IG5vdCBiZSBpbnN0YW50aWF0ZWQuIEZvcmdvdCB0byAndXNlJyB0aGUgY2xhc3Mgd2l0aCB0aGUgc2FtZSBuYW1lP1wiKVxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIHZhciBleHRlcm5hbENvbnN0cnVjdG9yID0gdGhpc01ldGEuZXh0ZXJuYWxDb25zdHJ1Y3RvclxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIGlmICh0eXBlb2YgZXh0ZXJuYWxDb25zdHJ1Y3RvciA9PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICBleHRlcm5hbENvbnN0cnVjdG9yLm1ldGEgPSB0aGlzTWV0YVxuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGV4dGVybmFsQ29uc3RydWN0b3IuYXBwbHkodGhpcywgYXJndW1lbnRzKVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICB0aHJvdyBcIk5hbWVzcGFjZUtlZXBlciBvZiBbXCIgKyB0aGlzTWV0YS5uYW1lICsgXCJdIHdhcyBwbGFudGVkIGluY29ycmVjdGx5LlwiXG4gICAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgLy93aXRoQ2xhc3Mgc2hvdWxkIGJlIG5vdCBjb25zdHJ1Y3RlZCB5ZXQgb24gdGhpcyBzdGFnZSAoc2VlIEpvb3NlLlByb3RvLkNsYXNzLmNvbnN0cnVjdClcbiAgICAgICAgLy9pdCBzaG91bGQgYmUgb24gdGhlICdjb25zdHJ1Y3Rvck9ubHknIGxpZmUgc3RhZ2UgKHNob3VsZCBhbHJlYWR5IGhhdmUgY29uc3RydWN0b3IpXG4gICAgICAgIHBsYW50OiBmdW5jdGlvbiAod2l0aENsYXNzKSB7XG4gICAgICAgICAgICB2YXIga2VlcGVyID0gdGhpcy5jXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGtlZXBlci5tZXRhID0gd2l0aENsYXNzLm1ldGFcbiAgICAgICAgICAgIFxuICAgICAgICAgICAga2VlcGVyLm1ldGEuYyA9IGtlZXBlclxuICAgICAgICAgICAga2VlcGVyLm1ldGEuZXh0ZXJuYWxDb25zdHJ1Y3RvciA9IHdpdGhDbGFzc1xuICAgICAgICB9XG4gICAgfVxuICAgIFxufSkuY1xuXG5cbjtcbkpvb3NlLk5hbWVzcGFjZS5NYW5hZ2VyID0gbmV3IEpvb3NlLk1hbmFnZWQuQ2xhc3MoJ0pvb3NlLk5hbWVzcGFjZS5NYW5hZ2VyJywge1xuICAgIFxuICAgIGhhdmUgOiB7XG4gICAgICAgIGN1cnJlbnQgICAgIDogbnVsbFxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgbWV0aG9kcyA6IHtcbiAgICAgICAgXG4gICAgICAgIGluaXRpYWxpemUgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB0aGlzLmN1cnJlbnQgICAgPSBbIEpvb3NlLnRvcCBdXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgZ2V0Q3VycmVudDogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuY3VycmVudFswXVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIGV4ZWN1dGVJbiA6IGZ1bmN0aW9uIChucywgZnVuYykge1xuICAgICAgICAgICAgdmFyIGN1cnJlbnQgPSB0aGlzLmN1cnJlbnRcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgY3VycmVudC51bnNoaWZ0KG5zKVxuICAgICAgICAgICAgdmFyIHJlcyA9IGZ1bmMuY2FsbChucywgbnMpXG4gICAgICAgICAgICBjdXJyZW50LnNoaWZ0KClcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcmV0dXJuIHJlc1xuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIGVhcmx5Q3JlYXRlIDogZnVuY3Rpb24gKG5hbWUsIG1ldGFDbGFzcywgcHJvcHMpIHtcbiAgICAgICAgICAgIHByb3BzLmNvbnN0cnVjdG9yT25seSA9IHRydWVcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcmV0dXJuIG5ldyBtZXRhQ2xhc3MobmFtZSwgcHJvcHMpLmNcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICAvL3RoaXMgZnVuY3Rpb24gZXN0YWJsaXNoaW5nIHRoZSBmdWxsIFwibmFtZXNwYWNlIGNoYWluXCIgKGluY2x1ZGluZyB0aGUgbGFzdCBlbGVtZW50KVxuICAgICAgICBjcmVhdGUgOiBmdW5jdGlvbiAobnNOYW1lLCBtZXRhQ2xhc3MsIGV4dGVuZCkge1xuICAgICAgICAgICAgXG4gICAgICAgICAgICAvL2lmIG5vIG5hbWUgcHJvdmlkZWQsIHRoZW4gd2UgY3JlYXRpbmcgYW4gYW5vbnltb3VzIGNsYXNzLCBzbyBqdXN0IHNraXAgYWxsIHRoZSBuYW1lc3BhY2UgbWFuaXB1bGF0aW9uc1xuICAgICAgICAgICAgaWYgKCFuc05hbWUpIHJldHVybiBuZXcgbWV0YUNsYXNzKG5zTmFtZSwgZXh0ZW5kKS5jXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciBtZSA9IHRoaXNcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKC9eXFwuLy50ZXN0KG5zTmFtZSkpIHJldHVybiB0aGlzLmV4ZWN1dGVJbihKb29zZS50b3AsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gbWUuY3JlYXRlKG5zTmFtZS5yZXBsYWNlKC9eXFwuLywgJycpLCBtZXRhQ2xhc3MsIGV4dGVuZClcbiAgICAgICAgICAgIH0pXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciBwcm9wcyAgID0gZXh0ZW5kIHx8IHt9XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciBwYXJ0cyAgID0gSm9vc2UuUy5zYW5lU3BsaXQobnNOYW1lLCAnLicpXG4gICAgICAgICAgICB2YXIgb2JqZWN0ICA9IHRoaXMuZ2V0Q3VycmVudCgpXG4gICAgICAgICAgICB2YXIgc29GYXIgICA9IG9iamVjdCA9PSBKb29zZS50b3AgPyBbXSA6IEpvb3NlLlMuc2FuZVNwbGl0KG9iamVjdC5tZXRhLm5hbWUsICcuJylcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBwYXJ0cy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgICAgIHZhciBwYXJ0ICAgICAgICA9IHBhcnRzW2ldXG4gICAgICAgICAgICAgICAgdmFyIGlzTGFzdCAgICAgID0gaSA9PSBwYXJ0cy5sZW5ndGggLSAxXG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgaWYgKHBhcnQgPT0gXCJtZXRhXCIgfHwgcGFydCA9PSBcIm15XCIgfHwgIXBhcnQpIHRocm93IFwiTW9kdWxlIG5hbWUgW1wiICsgbnNOYW1lICsgXCJdIG1heSBub3QgaW5jbHVkZSBhIHBhcnQgY2FsbGVkICdtZXRhJyBvciAnbXknIG9yIGVtcHR5IHBhcnQuXCJcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICB2YXIgY3VyID0gICBvYmplY3RbcGFydF1cbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBzb0Zhci5wdXNoKHBhcnQpXG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgdmFyIHNvRmFyTmFtZSAgICAgICA9IHNvRmFyLmpvaW4oXCIuXCIpXG4gICAgICAgICAgICAgICAgdmFyIG5lZWRGaW5hbGl6ZSAgICA9IGZhbHNlXG4gICAgICAgICAgICAgICAgdmFyIG5zS2VlcGVyXG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgLy8gaWYgdGhlIG5hbWVzcGFjZSBzZWdtZW50IGlzIGVtcHR5XG4gICAgICAgICAgICAgICAgaWYgKHR5cGVvZiBjdXIgPT0gXCJ1bmRlZmluZWRcIikge1xuICAgICAgICAgICAgICAgICAgICBpZiAoaXNMYXN0KSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBwZXJmb3JtIFwiZWFybHkgY3JlYXRlXCIgd2hpY2gganVzdCBmaWxscyB0aGUgbmFtZXNwYWNlIHNlZ21lbnQgd2l0aCByaWdodCBjb25zdHJ1Y3RvclxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gdGhpcyBhbGxvd3MgdXMgdG8gaGF2ZSBhIHJpZ2h0IGNvbnN0cnVjdG9yIGluIHRoZSBuYW1lc3BhY2Ugc2VnbWVudCB3aGVuIHRoZSBgYm9keWAgd2lsbCBiZSBjYWxsZWRcbiAgICAgICAgICAgICAgICAgICAgICAgIG5zS2VlcGVyICAgICAgICA9IHRoaXMuZWFybHlDcmVhdGUoc29GYXJOYW1lLCBtZXRhQ2xhc3MsIHByb3BzKVxuICAgICAgICAgICAgICAgICAgICAgICAgbmVlZEZpbmFsaXplICAgID0gdHJ1ZVxuICAgICAgICAgICAgICAgICAgICB9IGVsc2VcbiAgICAgICAgICAgICAgICAgICAgICAgIG5zS2VlcGVyICAgICAgICA9IG5ldyBKb29zZS5OYW1lc3BhY2UuS2VlcGVyKHNvRmFyTmFtZSkuY1xuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgb2JqZWN0W3BhcnRdID0gbnNLZWVwZXJcbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIGN1ciA9IG5zS2VlcGVyXG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAoaXNMYXN0ICYmIGN1ciAmJiBjdXIubWV0YSkge1xuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgdmFyIGN1cnJlbnRNZXRhID0gY3VyLm1ldGFcbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIGlmIChtZXRhQ2xhc3MgPT0gSm9vc2UuTmFtZXNwYWNlLktlZXBlcilcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vYE1vZHVsZWAgb3ZlciBzb21ldGhpbmcgY2FzZSAtIGV4dGVuZCB0aGUgb3JpZ2luYWxcbiAgICAgICAgICAgICAgICAgICAgICAgIGN1cnJlbnRNZXRhLmV4dGVuZChwcm9wcylcbiAgICAgICAgICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChjdXJyZW50TWV0YSBpbnN0YW5jZW9mIEpvb3NlLk5hbWVzcGFjZS5LZWVwZXIpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjdXJyZW50TWV0YS5wbGFudCh0aGlzLmVhcmx5Q3JlYXRlKHNvRmFyTmFtZSwgbWV0YUNsYXNzLCBwcm9wcykpXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbmVlZEZpbmFsaXplID0gdHJ1ZVxuICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiRG91YmxlIGRlY2xhcmF0aW9uIG9mIFtcIiArIHNvRmFyTmFtZSArIFwiXVwiKVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIH0gZWxzZSBcbiAgICAgICAgICAgICAgICAgICAgaWYgKGlzTGFzdCAmJiAhKGN1ciAmJiBjdXIubWV0YSAmJiBjdXIubWV0YS5tZXRhKSkgdGhyb3cgXCJUcnlpbmcgdG8gc2V0dXAgbW9kdWxlIFwiICsgc29GYXJOYW1lICsgXCIgZmFpbGVkLiBUaGVyZSBpcyBhbHJlYWR5IHNvbWV0aGluZzogXCIgKyBjdXJcblxuICAgICAgICAgICAgICAgIC8vIGhvb2sgdG8gYWxsb3cgZW1iZWRkIHJlc291cmNlIGludG8gbWV0YVxuICAgICAgICAgICAgICAgIGlmIChpc0xhc3QpIHRoaXMucHJlcGFyZU1ldGEoY3VyLm1ldGEpXG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIGlmIChuZWVkRmluYWxpemUpIGN1ci5tZXRhLmNvbnN0cnVjdChwcm9wcylcbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgb2JqZWN0ID0gY3VyXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHJldHVybiBvYmplY3RcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBwcmVwYXJlTWV0YSA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBwcmVwYXJlUHJvcGVydGllcyA6IGZ1bmN0aW9uIChuYW1lLCBwcm9wcywgZGVmYXVsdE1ldGEsIGNhbGxiYWNrKSB7XG4gICAgICAgICAgICBpZiAobmFtZSAmJiB0eXBlb2YgbmFtZSAhPSAnc3RyaW5nJykge1xuICAgICAgICAgICAgICAgIHByb3BzICAgPSBuYW1lXG4gICAgICAgICAgICAgICAgbmFtZSAgICA9IG51bGxcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdmFyIG1ldGFcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKHByb3BzICYmIHByb3BzLm1ldGEpIHtcbiAgICAgICAgICAgICAgICBtZXRhID0gcHJvcHMubWV0YVxuICAgICAgICAgICAgICAgIGRlbGV0ZSBwcm9wcy5tZXRhXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmICghbWV0YSlcbiAgICAgICAgICAgICAgICBpZiAocHJvcHMgJiYgdHlwZW9mIHByb3BzLmlzYSA9PSAnZnVuY3Rpb24nICYmIHByb3BzLmlzYS5tZXRhKVxuICAgICAgICAgICAgICAgICAgICBtZXRhID0gcHJvcHMuaXNhLm1ldGEuY29uc3RydWN0b3JcbiAgICAgICAgICAgICAgICBlbHNlXG4gICAgICAgICAgICAgICAgICAgIG1ldGEgPSBkZWZhdWx0TWV0YVxuICAgICAgICAgICAgXG4gICAgICAgICAgICByZXR1cm4gY2FsbGJhY2suY2FsbCh0aGlzLCBuYW1lLCBtZXRhLCBwcm9wcylcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBnZXREZWZhdWx0SGVscGVyRm9yIDogZnVuY3Rpb24gKG1ldGFDbGFzcykge1xuICAgICAgICAgICAgdmFyIG1lID0gdGhpc1xuICAgICAgICAgICAgXG4gICAgICAgICAgICByZXR1cm4gZnVuY3Rpb24gKG5hbWUsIHByb3BzKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIG1lLnByZXBhcmVQcm9wZXJ0aWVzKG5hbWUsIHByb3BzLCBtZXRhQ2xhc3MsIGZ1bmN0aW9uIChuYW1lLCBtZXRhLCBwcm9wcykge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gbWUuY3JlYXRlKG5hbWUsIG1ldGEsIHByb3BzKVxuICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgcmVnaXN0ZXIgOiBmdW5jdGlvbiAoaGVscGVyTmFtZSwgbWV0YUNsYXNzLCBmdW5jKSB7XG4gICAgICAgICAgICB2YXIgbWUgPSB0aGlzXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmICh0aGlzLm1ldGEuaGFzTWV0aG9kKGhlbHBlck5hbWUpKSB7XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgdmFyIGhlbHBlciA9IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIG1lWyBoZWxwZXJOYW1lIF0uYXBwbHkobWUsIGFyZ3VtZW50cylcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgaWYgKCFKb29zZS50b3BbIGhlbHBlck5hbWUgXSkgICBKb29zZS50b3BbIGhlbHBlck5hbWUgXSAgICAgICAgID0gaGVscGVyXG4gICAgICAgICAgICAgICAgaWYgKCFKb29zZVsgaGVscGVyTmFtZSBdKSAgICAgICBKb29zZVsgaGVscGVyTmFtZSBdICAgICAgICAgICAgID0gaGVscGVyXG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgaWYgKEpvb3NlLmlzX05vZGVKUyAmJiB0eXBlb2YgZXhwb3J0cyAhPSAndW5kZWZpbmVkJykgICAgICAgICAgICBleHBvcnRzWyBoZWxwZXJOYW1lIF0gICAgPSBoZWxwZXJcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgdmFyIG1ldGhvZHMgPSB7fVxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIG1ldGhvZHNbIGhlbHBlck5hbWUgXSA9IGZ1bmMgfHwgdGhpcy5nZXREZWZhdWx0SGVscGVyRm9yKG1ldGFDbGFzcylcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICB0aGlzLm1ldGEuZXh0ZW5kKHtcbiAgICAgICAgICAgICAgICAgICAgbWV0aG9kcyA6IG1ldGhvZHNcbiAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIHRoaXMucmVnaXN0ZXIoaGVscGVyTmFtZSlcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBNb2R1bGUgOiBmdW5jdGlvbiAobmFtZSwgcHJvcHMpIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLnByZXBhcmVQcm9wZXJ0aWVzKG5hbWUsIHByb3BzLCBKb29zZS5OYW1lc3BhY2UuS2VlcGVyLCBmdW5jdGlvbiAobmFtZSwgbWV0YSwgcHJvcHMpIHtcbiAgICAgICAgICAgICAgICBpZiAodHlwZW9mIHByb3BzID09ICdmdW5jdGlvbicpIHByb3BzID0geyBib2R5IDogcHJvcHMgfSAgICBcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5jcmVhdGUobmFtZSwgbWV0YSwgcHJvcHMpXG4gICAgICAgICAgICB9KVxuICAgICAgICB9XG4gICAgfVxuICAgIFxufSkuY1xuXG5Kb29zZS5OYW1lc3BhY2UuTWFuYWdlci5teSA9IG5ldyBKb29zZS5OYW1lc3BhY2UuTWFuYWdlcigpXG5cbkpvb3NlLk5hbWVzcGFjZS5NYW5hZ2VyLm15LnJlZ2lzdGVyKCdDbGFzcycsIEpvb3NlLk1ldGEuQ2xhc3MpXG5Kb29zZS5OYW1lc3BhY2UuTWFuYWdlci5teS5yZWdpc3RlcignUm9sZScsIEpvb3NlLk1ldGEuUm9sZSlcbkpvb3NlLk5hbWVzcGFjZS5NYW5hZ2VyLm15LnJlZ2lzdGVyKCdNb2R1bGUnKVxuXG5cbi8vIGZvciB0aGUgcmVzdCBvZiB0aGUgcGFja2FnZVxudmFyIENsYXNzICAgICAgID0gSm9vc2UuQ2xhc3NcbnZhciBSb2xlICAgICAgICA9IEpvb3NlLlJvbGVcbjtcblJvbGUoJ0pvb3NlLkF0dHJpYnV0ZS5EZWxlZ2F0ZScsIHtcbiAgICBcbiAgICBoYXZlIDoge1xuICAgICAgICBoYW5kbGVzIDogbnVsbFxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgb3ZlcnJpZGUgOiB7XG4gICAgICAgIFxuICAgICAgICBlYWNoRGVsZWdhdGUgOiBmdW5jdGlvbiAoaGFuZGxlcywgZnVuYywgc2NvcGUpIHtcbiAgICAgICAgICAgIGlmICh0eXBlb2YgaGFuZGxlcyA9PSAnc3RyaW5nJykgcmV0dXJuIGZ1bmMuY2FsbChzY29wZSwgaGFuZGxlcywgaGFuZGxlcylcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKGhhbmRsZXMgaW5zdGFuY2VvZiBBcnJheSlcbiAgICAgICAgICAgICAgICByZXR1cm4gSm9vc2UuQS5lYWNoKGhhbmRsZXMsIGZ1bmN0aW9uIChkZWxlZ2F0ZVRvKSB7XG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICBmdW5jLmNhbGwoc2NvcGUsIGRlbGVnYXRlVG8sIGRlbGVnYXRlVG8pXG4gICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgIGlmIChoYW5kbGVzID09PSBPYmplY3QoaGFuZGxlcykpXG4gICAgICAgICAgICAgICAgSm9vc2UuTy5lYWNoT3duKGhhbmRsZXMsIGZ1bmN0aW9uIChkZWxlZ2F0ZVRvLCBoYW5kbGVBcykge1xuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgZnVuYy5jYWxsKHNjb3BlLCBoYW5kbGVBcywgZGVsZWdhdGVUbylcbiAgICAgICAgICAgICAgICB9KVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIGdldEFjY2Vzc29yc0ZvciA6IGZ1bmN0aW9uICh0YXJnZXRDbGFzcykge1xuICAgICAgICAgICAgdmFyIHRhcmdldE1ldGEgID0gdGFyZ2V0Q2xhc3MubWV0YVxuICAgICAgICAgICAgdmFyIG1ldGhvZHMgICAgID0gdGhpcy5TVVBFUih0YXJnZXRDbGFzcylcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdmFyIG1lICAgICAgPSB0aGlzXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXMuZWFjaERlbGVnYXRlKHRoaXMuaGFuZGxlcywgZnVuY3Rpb24gKGhhbmRsZUFzLCBkZWxlZ2F0ZVRvKSB7XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgaWYgKCF0YXJnZXRNZXRhLmhhc01ldGhvZChoYW5kbGVBcykpIHtcbiAgICAgICAgICAgICAgICAgICAgdmFyIGhhbmRsZXIgPSBtZXRob2RzWyBoYW5kbGVBcyBdID0gZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgdmFyIGF0dHJWYWx1ZSA9IG1lLmdldFZhbHVlRnJvbSh0aGlzKVxuICAgICAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gYXR0clZhbHVlWyBkZWxlZ2F0ZVRvIF0uYXBwbHkoYXR0clZhbHVlLCBhcmd1bWVudHMpXG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIGhhbmRsZXIuQUNDRVNTT1JfRlJPTSA9IG1lXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcmV0dXJuIG1ldGhvZHNcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBnZXRBY2Nlc3NvcnNGcm9tIDogZnVuY3Rpb24gKGZyb20pIHtcbiAgICAgICAgICAgIHZhciBtZXRob2RzID0gdGhpcy5TVVBFUihmcm9tKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB2YXIgbWUgICAgICAgICAgPSB0aGlzXG4gICAgICAgICAgICB2YXIgdGFyZ2V0TWV0YSAgPSBmcm9tLm1ldGFcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpcy5lYWNoRGVsZWdhdGUodGhpcy5oYW5kbGVzLCBmdW5jdGlvbiAoaGFuZGxlQXMpIHtcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICB2YXIgaGFuZGxlciA9IHRhcmdldE1ldGEuZ2V0TWV0aG9kKGhhbmRsZUFzKVxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIGlmIChoYW5kbGVyICYmIGhhbmRsZXIudmFsdWUuQUNDRVNTT1JfRlJPTSA9PSBtZSkgbWV0aG9kcy5wdXNoKGhhbmRsZUFzKVxuICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcmV0dXJuIG1ldGhvZHNcbiAgICAgICAgfVxuICAgIH1cbn0pXG5cbjtcblJvbGUoJ0pvb3NlLkF0dHJpYnV0ZS5UcmlnZ2VyJywge1xuICAgIFxuICAgIGhhdmUgOiB7XG4gICAgICAgIHRyaWdnZXIgICAgICAgIDogbnVsbFxuICAgIH0sIFxuXG4gICAgXG4gICAgYWZ0ZXIgOiB7XG4gICAgICAgIGluaXRpYWxpemUgOiBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgIGlmICh0aGlzLnRyaWdnZXIpIHtcbiAgICAgICAgICAgICAgICBpZiAoIXRoaXMud3JpdGVhYmxlKSB0aHJvdyBuZXcgRXJyb3IoXCJDYW4ndCB1c2UgYHRyaWdnZXJgIGZvciByZWFkLW9ubHkgYXR0cmlidXRlc1wiKVxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIHRoaXMuaGFzU2V0dGVyID0gdHJ1ZVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBvdmVycmlkZSA6IHtcbiAgICAgICAgXG4gICAgICAgIGdldFNldHRlciA6IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgdmFyIG9yaWdpbmFsICAgID0gdGhpcy5TVVBFUigpXG4gICAgICAgICAgICB2YXIgdHJpZ2dlciAgICAgPSB0aGlzLnRyaWdnZXJcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKCF0cmlnZ2VyKSByZXR1cm4gb3JpZ2luYWxcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdmFyIG1lICAgICAgPSB0aGlzXG4gICAgICAgICAgICB2YXIgaW5pdCAgICA9IEpvb3NlLk8uaXNGdW5jdGlvbihtZS5pbml0KSA/IG51bGwgOiBtZS5pbml0XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHJldHVybiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgICAgdmFyIG9sZFZhbHVlICAgID0gbWUuaGFzVmFsdWUodGhpcykgPyBtZS5nZXRWYWx1ZUZyb20odGhpcykgOiBpbml0XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgdmFyIHJlcyAgICAgICAgID0gb3JpZ2luYWwuYXBwbHkodGhpcywgYXJndW1lbnRzKVxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIHRyaWdnZXIuY2FsbCh0aGlzLCBtZS5nZXRWYWx1ZUZyb20odGhpcyksIG9sZFZhbHVlKVxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIHJldHVybiByZXNcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cbn0pICAgIFxuXG47XG5Sb2xlKCdKb29zZS5BdHRyaWJ1dGUuTGF6eScsIHtcbiAgICBcbiAgICBcbiAgICBoYXZlIDoge1xuICAgICAgICBsYXp5ICAgICAgICA6IG51bGxcbiAgICB9LCBcbiAgICBcbiAgICBcbiAgICBiZWZvcmUgOiB7XG4gICAgICAgIGNvbXB1dGVWYWx1ZSA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIGlmICh0eXBlb2YgdGhpcy5pbml0ID09ICdmdW5jdGlvbicgJiYgdGhpcy5sYXp5KSB7XG4gICAgICAgICAgICAgICAgdGhpcy5sYXp5ID0gdGhpcy5pbml0ICAgIFxuICAgICAgICAgICAgICAgIGRlbGV0ZSB0aGlzLmluaXQgICAgXG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGFmdGVyIDoge1xuICAgICAgICBpbml0aWFsaXplIDogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgaWYgKHRoaXMubGF6eSkgdGhpcy5yZWFkYWJsZSA9IHRoaXMuaGFzR2V0dGVyID0gdHJ1ZVxuICAgICAgICB9XG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBvdmVycmlkZSA6IHtcbiAgICAgICAgXG4gICAgICAgIGdldEdldHRlciA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHZhciBvcmlnaW5hbCAgICA9IHRoaXMuU1VQRVIoKVxuICAgICAgICAgICAgdmFyIGxhenkgICAgICAgID0gdGhpcy5sYXp5XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmICghbGF6eSkgcmV0dXJuIG9yaWdpbmFsXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciBtZSAgICAgID0gdGhpcyAgICBcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcmV0dXJuIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgICBpZiAoIW1lLmhhc1ZhbHVlKHRoaXMpKSB7XG4gICAgICAgICAgICAgICAgICAgIHZhciBpbml0aWFsaXplciA9IHR5cGVvZiBsYXp5ID09ICdmdW5jdGlvbicgPyBsYXp5IDogdGhpc1sgbGF6eS5yZXBsYWNlKC9edGhpc1xcLi8sICcnKSBdXG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICBtZS5zZXRWYWx1ZVRvKHRoaXMsIGluaXRpYWxpemVyLmFwcGx5KHRoaXMsIGFyZ3VtZW50cykpXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIHJldHVybiBvcmlnaW5hbC5jYWxsKHRoaXMpICAgIFxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxufSlcblxuO1xuUm9sZSgnSm9vc2UuQXR0cmlidXRlLkFjY2Vzc29yLkNvbWJpbmVkJywge1xuICAgIFxuICAgIFxuICAgIGhhdmUgOiB7XG4gICAgICAgIGlzQ29tYmluZWQgICAgICAgIDogZmFsc2VcbiAgICB9LCBcbiAgICBcbiAgICBcbiAgICBhZnRlciA6IHtcbiAgICAgICAgaW5pdGlhbGl6ZSA6IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgdGhpcy5pc0NvbWJpbmVkID0gdGhpcy5pc0NvbWJpbmVkIHx8IC8uLmMvaS50ZXN0KHRoaXMuaXMpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmICh0aGlzLmlzQ29tYmluZWQpIHtcbiAgICAgICAgICAgICAgICB0aGlzLnNsb3QgPSAnJCQnICsgdGhpcy5uYW1lXG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgdGhpcy5oYXNHZXR0ZXIgPSB0cnVlXG4gICAgICAgICAgICAgICAgdGhpcy5oYXNTZXR0ZXIgPSBmYWxzZVxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIHRoaXMuc2V0dGVyTmFtZSA9IHRoaXMuZ2V0dGVyTmFtZSA9IHRoaXMucHVibGljTmFtZVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBvdmVycmlkZSA6IHtcbiAgICAgICAgXG4gICAgICAgIGdldEdldHRlciA6IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgdmFyIGdldHRlciAgICA9IHRoaXMuU1VQRVIoKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAoIXRoaXMuaXNDb21iaW5lZCkgcmV0dXJuIGdldHRlclxuICAgICAgICAgICAgXG4gICAgICAgICAgICB2YXIgc2V0dGVyICAgID0gdGhpcy5nZXRTZXR0ZXIoKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB2YXIgbWUgPSB0aGlzXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHJldHVybiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgaWYgKCFhcmd1bWVudHMubGVuZ3RoKSB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChtZS5yZWFkYWJsZSkgcmV0dXJuIGdldHRlci5jYWxsKHRoaXMpXG4gICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcIkNhbGwgdG8gZ2V0dGVyIG9mIHVucmVhZGFibGUgYXR0cmlidXRlOiBbXCIgKyBtZS5uYW1lICsgXCJdXCIpXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIGlmIChtZS53cml0ZWFibGUpIHJldHVybiBzZXR0ZXIuYXBwbHkodGhpcywgYXJndW1lbnRzKVxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcIkNhbGwgdG8gc2V0dGVyIG9mIHJlYWQtb25seSBhdHRyaWJ1dGU6IFtcIiArIG1lLm5hbWUgKyBcIl1cIikgICAgXG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG4gICAgXG59KVxuXG47XG5Kb29zZS5NYW5hZ2VkLkF0dHJpYnV0ZS5tZXRhLmV4dGVuZCh7XG4gICAgZG9lcyA6IFsgSm9vc2UuQXR0cmlidXRlLkRlbGVnYXRlLCBKb29zZS5BdHRyaWJ1dGUuVHJpZ2dlciwgSm9vc2UuQXR0cmlidXRlLkxhenksIEpvb3NlLkF0dHJpYnV0ZS5BY2Nlc3Nvci5Db21iaW5lZCBdXG59KSAgICAgICAgICAgIFxuXG47XG5Sb2xlKCdKb29zZS5NZXRhLlNpbmdsZXRvbicsIHtcbiAgICBcbiAgICBoYXMgOiB7XG4gICAgICAgIGZvcmNlSW5zdGFuY2UgICAgICAgICAgIDogSm9vc2UuSS5PYmplY3QsXG4gICAgICAgIGluc3RhbmNlICAgICAgICAgICAgICAgIDogbnVsbFxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgXG4gICAgb3ZlcnJpZGUgOiB7XG4gICAgICAgIFxuICAgICAgICBkZWZhdWx0Q29uc3RydWN0b3IgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB2YXIgbWV0YSAgICAgICAgPSB0aGlzXG4gICAgICAgICAgICB2YXIgcHJldmlvdXMgICAgPSB0aGlzLlNVUEVSKClcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpcy5hZGFwdENvbnN0cnVjdG9yKHByZXZpb3VzKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICByZXR1cm4gZnVuY3Rpb24gKGZvcmNlSW5zdGFuY2UsIHBhcmFtcykge1xuICAgICAgICAgICAgICAgIGlmIChmb3JjZUluc3RhbmNlID09IG1ldGEuZm9yY2VJbnN0YW5jZSkgcmV0dXJuIHByZXZpb3VzLmFwcGx5KHRoaXMsIHBhcmFtcykgfHwgdGhpc1xuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIHZhciBpbnN0YW5jZSA9IG1ldGEuaW5zdGFuY2VcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBpZiAoaW5zdGFuY2UpIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKG1ldGEuaGFzTWV0aG9kKCdjb25maWd1cmUnKSkgaW5zdGFuY2UuY29uZmlndXJlLmFwcGx5KGluc3RhbmNlLCBhcmd1bWVudHMpXG4gICAgICAgICAgICAgICAgfSBlbHNlXG4gICAgICAgICAgICAgICAgICAgIG1ldGEuaW5zdGFuY2UgPSBuZXcgbWV0YS5jKG1ldGEuZm9yY2VJbnN0YW5jZSwgYXJndW1lbnRzKVxuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICByZXR1cm4gbWV0YS5pbnN0YW5jZVxuICAgICAgICAgICAgfVxuICAgICAgICB9ICAgICAgICBcbiAgICB9XG4gICAgXG5cbn0pXG5cblxuSm9vc2UuTmFtZXNwYWNlLk1hbmFnZXIubXkucmVnaXN0ZXIoJ1NpbmdsZXRvbicsIENsYXNzKHtcbiAgICBpc2EgICAgIDogSm9vc2UuTWV0YS5DbGFzcyxcbiAgICBtZXRhICAgIDogSm9vc2UuTWV0YS5DbGFzcyxcbiAgICBcbiAgICBkb2VzICAgIDogSm9vc2UuTWV0YS5TaW5nbGV0b25cbn0pKVxuO1xuO1xufSgpOztcbiIsIi8qXG4gKGMpIDIwMTMsIFZsYWRpbWlyIEFnYWZvbmtpblxuIFJCdXNoLCBhIEphdmFTY3JpcHQgbGlicmFyeSBmb3IgaGlnaC1wZXJmb3JtYW5jZSAyRCBzcGF0aWFsIGluZGV4aW5nIG9mIHBvaW50cyBhbmQgcmVjdGFuZ2xlcy5cbiBodHRwczovL2dpdGh1Yi5jb20vbW91cm5lci9yYnVzaFxuKi9cblxuKGZ1bmN0aW9uICgpIHsgJ3VzZSBzdHJpY3QnO1xuXG5mdW5jdGlvbiByYnVzaChtYXhFbnRyaWVzLCBmb3JtYXQpIHtcblxuICAgIC8vIGpzaGludCBuZXdjYXA6IGZhbHNlLCB2YWxpZHRoaXM6IHRydWVcbiAgICBpZiAoISh0aGlzIGluc3RhbmNlb2YgcmJ1c2gpKSByZXR1cm4gbmV3IHJidXNoKG1heEVudHJpZXMsIGZvcm1hdCk7XG5cbiAgICAvLyBtYXggZW50cmllcyBpbiBhIG5vZGUgaXMgOSBieSBkZWZhdWx0OyBtaW4gbm9kZSBmaWxsIGlzIDQwJSBmb3IgYmVzdCBwZXJmb3JtYW5jZVxuICAgIHRoaXMuX21heEVudHJpZXMgPSBNYXRoLm1heCg0LCBtYXhFbnRyaWVzIHx8IDkpO1xuICAgIHRoaXMuX21pbkVudHJpZXMgPSBNYXRoLm1heCgyLCBNYXRoLmNlaWwodGhpcy5fbWF4RW50cmllcyAqIDAuNCkpO1xuXG4gICAgaWYgKGZvcm1hdCkge1xuICAgICAgICB0aGlzLl9pbml0Rm9ybWF0KGZvcm1hdCk7XG4gICAgfVxuXG4gICAgdGhpcy5jbGVhcigpO1xufVxuXG5yYnVzaC5wcm90b3R5cGUgPSB7XG5cbiAgICBhbGw6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuX2FsbCh0aGlzLmRhdGEsIFtdKTtcbiAgICB9LFxuXG4gICAgc2VhcmNoOiBmdW5jdGlvbiAoYmJveCkge1xuXG4gICAgICAgIHZhciBub2RlID0gdGhpcy5kYXRhLFxuICAgICAgICAgICAgcmVzdWx0ID0gW10sXG4gICAgICAgICAgICB0b0JCb3ggPSB0aGlzLnRvQkJveDtcblxuICAgICAgICBpZiAoIWludGVyc2VjdHMoYmJveCwgbm9kZS5iYm94KSkgcmV0dXJuIHJlc3VsdDtcblxuICAgICAgICB2YXIgbm9kZXNUb1NlYXJjaCA9IFtdLFxuICAgICAgICAgICAgaSwgbGVuLCBjaGlsZCwgY2hpbGRCQm94O1xuXG4gICAgICAgIHdoaWxlIChub2RlKSB7XG4gICAgICAgICAgICBmb3IgKGkgPSAwLCBsZW4gPSBub2RlLmNoaWxkcmVuLmxlbmd0aDsgaSA8IGxlbjsgaSsrKSB7XG5cbiAgICAgICAgICAgICAgICBjaGlsZCA9IG5vZGUuY2hpbGRyZW5baV07XG4gICAgICAgICAgICAgICAgY2hpbGRCQm94ID0gbm9kZS5sZWFmID8gdG9CQm94KGNoaWxkKSA6IGNoaWxkLmJib3g7XG5cbiAgICAgICAgICAgICAgICBpZiAoaW50ZXJzZWN0cyhiYm94LCBjaGlsZEJCb3gpKSB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChub2RlLmxlYWYpIHJlc3VsdC5wdXNoKGNoaWxkKTtcbiAgICAgICAgICAgICAgICAgICAgZWxzZSBpZiAoY29udGFpbnMoYmJveCwgY2hpbGRCQm94KSkgdGhpcy5fYWxsKGNoaWxkLCByZXN1bHQpO1xuICAgICAgICAgICAgICAgICAgICBlbHNlIG5vZGVzVG9TZWFyY2gucHVzaChjaGlsZCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgbm9kZSA9IG5vZGVzVG9TZWFyY2gucG9wKCk7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gcmVzdWx0O1xuICAgIH0sXG5cbiAgICBjb2xsaWRlczogZnVuY3Rpb24gKGJib3gpIHtcblxuICAgICAgICB2YXIgbm9kZSA9IHRoaXMuZGF0YSxcbiAgICAgICAgICAgIHRvQkJveCA9IHRoaXMudG9CQm94O1xuXG4gICAgICAgIGlmICghaW50ZXJzZWN0cyhiYm94LCBub2RlLmJib3gpKSByZXR1cm4gZmFsc2U7XG5cbiAgICAgICAgdmFyIG5vZGVzVG9TZWFyY2ggPSBbXSxcbiAgICAgICAgICAgIGksIGxlbiwgY2hpbGQsIGNoaWxkQkJveDtcblxuICAgICAgICB3aGlsZSAobm9kZSkge1xuICAgICAgICAgICAgZm9yIChpID0gMCwgbGVuID0gbm9kZS5jaGlsZHJlbi5sZW5ndGg7IGkgPCBsZW47IGkrKykge1xuXG4gICAgICAgICAgICAgICAgY2hpbGQgPSBub2RlLmNoaWxkcmVuW2ldO1xuICAgICAgICAgICAgICAgIGNoaWxkQkJveCA9IG5vZGUubGVhZiA/IHRvQkJveChjaGlsZCkgOiBjaGlsZC5iYm94O1xuXG4gICAgICAgICAgICAgICAgaWYgKGludGVyc2VjdHMoYmJveCwgY2hpbGRCQm94KSkge1xuICAgICAgICAgICAgICAgICAgICBpZiAobm9kZS5sZWFmIHx8IGNvbnRhaW5zKGJib3gsIGNoaWxkQkJveCkpIHJldHVybiB0cnVlO1xuICAgICAgICAgICAgICAgICAgICBub2Rlc1RvU2VhcmNoLnB1c2goY2hpbGQpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIG5vZGUgPSBub2Rlc1RvU2VhcmNoLnBvcCgpO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH0sXG5cbiAgICBsb2FkOiBmdW5jdGlvbiAoZGF0YSkge1xuICAgICAgICBpZiAoIShkYXRhICYmIGRhdGEubGVuZ3RoKSkgcmV0dXJuIHRoaXM7XG5cbiAgICAgICAgaWYgKGRhdGEubGVuZ3RoIDwgdGhpcy5fbWluRW50cmllcykge1xuICAgICAgICAgICAgZm9yICh2YXIgaSA9IDAsIGxlbiA9IGRhdGEubGVuZ3RoOyBpIDwgbGVuOyBpKyspIHtcbiAgICAgICAgICAgICAgICB0aGlzLmluc2VydChkYXRhW2ldKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiB0aGlzO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gcmVjdXJzaXZlbHkgYnVpbGQgdGhlIHRyZWUgd2l0aCB0aGUgZ2l2ZW4gZGF0YSBmcm9tIHN0cmF0Y2ggdXNpbmcgT01UIGFsZ29yaXRobVxuICAgICAgICB2YXIgbm9kZSA9IHRoaXMuX2J1aWxkKGRhdGEuc2xpY2UoKSwgMCwgZGF0YS5sZW5ndGggLSAxLCAwKTtcblxuICAgICAgICBpZiAoIXRoaXMuZGF0YS5jaGlsZHJlbi5sZW5ndGgpIHtcbiAgICAgICAgICAgIC8vIHNhdmUgYXMgaXMgaWYgdHJlZSBpcyBlbXB0eVxuICAgICAgICAgICAgdGhpcy5kYXRhID0gbm9kZTtcblxuICAgICAgICB9IGVsc2UgaWYgKHRoaXMuZGF0YS5oZWlnaHQgPT09IG5vZGUuaGVpZ2h0KSB7XG4gICAgICAgICAgICAvLyBzcGxpdCByb290IGlmIHRyZWVzIGhhdmUgdGhlIHNhbWUgaGVpZ2h0XG4gICAgICAgICAgICB0aGlzLl9zcGxpdFJvb3QodGhpcy5kYXRhLCBub2RlKTtcblxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgaWYgKHRoaXMuZGF0YS5oZWlnaHQgPCBub2RlLmhlaWdodCkge1xuICAgICAgICAgICAgICAgIC8vIHN3YXAgdHJlZXMgaWYgaW5zZXJ0ZWQgb25lIGlzIGJpZ2dlclxuICAgICAgICAgICAgICAgIHZhciB0bXBOb2RlID0gdGhpcy5kYXRhO1xuICAgICAgICAgICAgICAgIHRoaXMuZGF0YSA9IG5vZGU7XG4gICAgICAgICAgICAgICAgbm9kZSA9IHRtcE5vZGU7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIGluc2VydCB0aGUgc21hbGwgdHJlZSBpbnRvIHRoZSBsYXJnZSB0cmVlIGF0IGFwcHJvcHJpYXRlIGxldmVsXG4gICAgICAgICAgICB0aGlzLl9pbnNlcnQobm9kZSwgdGhpcy5kYXRhLmhlaWdodCAtIG5vZGUuaGVpZ2h0IC0gMSwgdHJ1ZSk7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gdGhpcztcbiAgICB9LFxuXG4gICAgaW5zZXJ0OiBmdW5jdGlvbiAoaXRlbSkge1xuICAgICAgICBpZiAoaXRlbSkgdGhpcy5faW5zZXJ0KGl0ZW0sIHRoaXMuZGF0YS5oZWlnaHQgLSAxKTtcbiAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfSxcblxuICAgIGNsZWFyOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHRoaXMuZGF0YSA9IHtcbiAgICAgICAgICAgIGNoaWxkcmVuOiBbXSxcbiAgICAgICAgICAgIGhlaWdodDogMSxcbiAgICAgICAgICAgIGJib3g6IGVtcHR5KCksXG4gICAgICAgICAgICBsZWFmOiB0cnVlXG4gICAgICAgIH07XG4gICAgICAgIHJldHVybiB0aGlzO1xuICAgIH0sXG5cbiAgICByZW1vdmU6IGZ1bmN0aW9uIChpdGVtKSB7XG4gICAgICAgIGlmICghaXRlbSkgcmV0dXJuIHRoaXM7XG5cbiAgICAgICAgdmFyIG5vZGUgPSB0aGlzLmRhdGEsXG4gICAgICAgICAgICBiYm94ID0gdGhpcy50b0JCb3goaXRlbSksXG4gICAgICAgICAgICBwYXRoID0gW10sXG4gICAgICAgICAgICBpbmRleGVzID0gW10sXG4gICAgICAgICAgICBpLCBwYXJlbnQsIGluZGV4LCBnb2luZ1VwO1xuXG4gICAgICAgIC8vIGRlcHRoLWZpcnN0IGl0ZXJhdGl2ZSB0cmVlIHRyYXZlcnNhbFxuICAgICAgICB3aGlsZSAobm9kZSB8fCBwYXRoLmxlbmd0aCkge1xuXG4gICAgICAgICAgICBpZiAoIW5vZGUpIHsgLy8gZ28gdXBcbiAgICAgICAgICAgICAgICBub2RlID0gcGF0aC5wb3AoKTtcbiAgICAgICAgICAgICAgICBwYXJlbnQgPSBwYXRoW3BhdGgubGVuZ3RoIC0gMV07XG4gICAgICAgICAgICAgICAgaSA9IGluZGV4ZXMucG9wKCk7XG4gICAgICAgICAgICAgICAgZ29pbmdVcCA9IHRydWU7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmIChub2RlLmxlYWYpIHsgLy8gY2hlY2sgY3VycmVudCBub2RlXG4gICAgICAgICAgICAgICAgaW5kZXggPSBub2RlLmNoaWxkcmVuLmluZGV4T2YoaXRlbSk7XG5cbiAgICAgICAgICAgICAgICBpZiAoaW5kZXggIT09IC0xKSB7XG4gICAgICAgICAgICAgICAgICAgIC8vIGl0ZW0gZm91bmQsIHJlbW92ZSB0aGUgaXRlbSBhbmQgY29uZGVuc2UgdHJlZSB1cHdhcmRzXG4gICAgICAgICAgICAgICAgICAgIG5vZGUuY2hpbGRyZW4uc3BsaWNlKGluZGV4LCAxKTtcbiAgICAgICAgICAgICAgICAgICAgcGF0aC5wdXNoKG5vZGUpO1xuICAgICAgICAgICAgICAgICAgICB0aGlzLl9jb25kZW5zZShwYXRoKTtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAoIWdvaW5nVXAgJiYgIW5vZGUubGVhZiAmJiBjb250YWlucyhub2RlLmJib3gsIGJib3gpKSB7IC8vIGdvIGRvd25cbiAgICAgICAgICAgICAgICBwYXRoLnB1c2gobm9kZSk7XG4gICAgICAgICAgICAgICAgaW5kZXhlcy5wdXNoKGkpO1xuICAgICAgICAgICAgICAgIGkgPSAwO1xuICAgICAgICAgICAgICAgIHBhcmVudCA9IG5vZGU7XG4gICAgICAgICAgICAgICAgbm9kZSA9IG5vZGUuY2hpbGRyZW5bMF07XG5cbiAgICAgICAgICAgIH0gZWxzZSBpZiAocGFyZW50KSB7IC8vIGdvIHJpZ2h0XG4gICAgICAgICAgICAgICAgaSsrO1xuICAgICAgICAgICAgICAgIG5vZGUgPSBwYXJlbnQuY2hpbGRyZW5baV07XG4gICAgICAgICAgICAgICAgZ29pbmdVcCA9IGZhbHNlO1xuXG4gICAgICAgICAgICB9IGVsc2Ugbm9kZSA9IG51bGw7IC8vIG5vdGhpbmcgZm91bmRcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB0aGlzO1xuICAgIH0sXG5cbiAgICB0b0JCb3g6IGZ1bmN0aW9uIChpdGVtKSB7IHJldHVybiBpdGVtOyB9LFxuXG4gICAgY29tcGFyZU1pblg6IGZ1bmN0aW9uIChhLCBiKSB7IHJldHVybiBhWzBdIC0gYlswXTsgfSxcbiAgICBjb21wYXJlTWluWTogZnVuY3Rpb24gKGEsIGIpIHsgcmV0dXJuIGFbMV0gLSBiWzFdOyB9LFxuXG4gICAgdG9KU09OOiBmdW5jdGlvbiAoKSB7IHJldHVybiB0aGlzLmRhdGE7IH0sXG5cbiAgICBmcm9tSlNPTjogZnVuY3Rpb24gKGRhdGEpIHtcbiAgICAgICAgdGhpcy5kYXRhID0gZGF0YTtcbiAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfSxcblxuICAgIF9hbGw6IGZ1bmN0aW9uIChub2RlLCByZXN1bHQpIHtcbiAgICAgICAgdmFyIG5vZGVzVG9TZWFyY2ggPSBbXTtcbiAgICAgICAgd2hpbGUgKG5vZGUpIHtcbiAgICAgICAgICAgIGlmIChub2RlLmxlYWYpIHJlc3VsdC5wdXNoLmFwcGx5KHJlc3VsdCwgbm9kZS5jaGlsZHJlbik7XG4gICAgICAgICAgICBlbHNlIG5vZGVzVG9TZWFyY2gucHVzaC5hcHBseShub2Rlc1RvU2VhcmNoLCBub2RlLmNoaWxkcmVuKTtcblxuICAgICAgICAgICAgbm9kZSA9IG5vZGVzVG9TZWFyY2gucG9wKCk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICB9LFxuXG4gICAgX2J1aWxkOiBmdW5jdGlvbiAoaXRlbXMsIGxlZnQsIHJpZ2h0LCBoZWlnaHQpIHtcblxuICAgICAgICB2YXIgTiA9IHJpZ2h0IC0gbGVmdCArIDEsXG4gICAgICAgICAgICBNID0gdGhpcy5fbWF4RW50cmllcyxcbiAgICAgICAgICAgIG5vZGU7XG5cbiAgICAgICAgaWYgKE4gPD0gTSkge1xuICAgICAgICAgICAgLy8gcmVhY2hlZCBsZWFmIGxldmVsOyByZXR1cm4gbGVhZlxuICAgICAgICAgICAgbm9kZSA9IHtcbiAgICAgICAgICAgICAgICBjaGlsZHJlbjogaXRlbXMuc2xpY2UobGVmdCwgcmlnaHQgKyAxKSxcbiAgICAgICAgICAgICAgICBoZWlnaHQ6IDEsXG4gICAgICAgICAgICAgICAgYmJveDogbnVsbCxcbiAgICAgICAgICAgICAgICBsZWFmOiB0cnVlXG4gICAgICAgICAgICB9O1xuICAgICAgICAgICAgY2FsY0JCb3gobm9kZSwgdGhpcy50b0JCb3gpO1xuICAgICAgICAgICAgcmV0dXJuIG5vZGU7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoIWhlaWdodCkge1xuICAgICAgICAgICAgLy8gdGFyZ2V0IGhlaWdodCBvZiB0aGUgYnVsay1sb2FkZWQgdHJlZVxuICAgICAgICAgICAgaGVpZ2h0ID0gTWF0aC5jZWlsKE1hdGgubG9nKE4pIC8gTWF0aC5sb2coTSkpO1xuXG4gICAgICAgICAgICAvLyB0YXJnZXQgbnVtYmVyIG9mIHJvb3QgZW50cmllcyB0byBtYXhpbWl6ZSBzdG9yYWdlIHV0aWxpemF0aW9uXG4gICAgICAgICAgICBNID0gTWF0aC5jZWlsKE4gLyBNYXRoLnBvdyhNLCBoZWlnaHQgLSAxKSk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBUT0RPIGVsaW1pbmF0ZSByZWN1cnNpb24/XG5cbiAgICAgICAgbm9kZSA9IHtcbiAgICAgICAgICAgIGNoaWxkcmVuOiBbXSxcbiAgICAgICAgICAgIGhlaWdodDogaGVpZ2h0LFxuICAgICAgICAgICAgYmJveDogbnVsbFxuICAgICAgICB9O1xuXG4gICAgICAgIC8vIHNwbGl0IHRoZSBpdGVtcyBpbnRvIE0gbW9zdGx5IHNxdWFyZSB0aWxlc1xuXG4gICAgICAgIHZhciBOMiA9IE1hdGguY2VpbChOIC8gTSksXG4gICAgICAgICAgICBOMSA9IE4yICogTWF0aC5jZWlsKE1hdGguc3FydChNKSksXG4gICAgICAgICAgICBpLCBqLCByaWdodDIsIHJpZ2h0MztcblxuICAgICAgICBtdWx0aVNlbGVjdChpdGVtcywgbGVmdCwgcmlnaHQsIE4xLCB0aGlzLmNvbXBhcmVNaW5YKTtcblxuICAgICAgICBmb3IgKGkgPSBsZWZ0OyBpIDw9IHJpZ2h0OyBpICs9IE4xKSB7XG5cbiAgICAgICAgICAgIHJpZ2h0MiA9IE1hdGgubWluKGkgKyBOMSAtIDEsIHJpZ2h0KTtcblxuICAgICAgICAgICAgbXVsdGlTZWxlY3QoaXRlbXMsIGksIHJpZ2h0MiwgTjIsIHRoaXMuY29tcGFyZU1pblkpO1xuXG4gICAgICAgICAgICBmb3IgKGogPSBpOyBqIDw9IHJpZ2h0MjsgaiArPSBOMikge1xuXG4gICAgICAgICAgICAgICAgcmlnaHQzID0gTWF0aC5taW4oaiArIE4yIC0gMSwgcmlnaHQyKTtcblxuICAgICAgICAgICAgICAgIC8vIHBhY2sgZWFjaCBlbnRyeSByZWN1cnNpdmVseVxuICAgICAgICAgICAgICAgIG5vZGUuY2hpbGRyZW4ucHVzaCh0aGlzLl9idWlsZChpdGVtcywgaiwgcmlnaHQzLCBoZWlnaHQgLSAxKSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBjYWxjQkJveChub2RlLCB0aGlzLnRvQkJveCk7XG5cbiAgICAgICAgcmV0dXJuIG5vZGU7XG4gICAgfSxcblxuICAgIF9jaG9vc2VTdWJ0cmVlOiBmdW5jdGlvbiAoYmJveCwgbm9kZSwgbGV2ZWwsIHBhdGgpIHtcblxuICAgICAgICB2YXIgaSwgbGVuLCBjaGlsZCwgdGFyZ2V0Tm9kZSwgYXJlYSwgZW5sYXJnZW1lbnQsIG1pbkFyZWEsIG1pbkVubGFyZ2VtZW50O1xuXG4gICAgICAgIHdoaWxlICh0cnVlKSB7XG4gICAgICAgICAgICBwYXRoLnB1c2gobm9kZSk7XG5cbiAgICAgICAgICAgIGlmIChub2RlLmxlYWYgfHwgcGF0aC5sZW5ndGggLSAxID09PSBsZXZlbCkgYnJlYWs7XG5cbiAgICAgICAgICAgIG1pbkFyZWEgPSBtaW5FbmxhcmdlbWVudCA9IEluZmluaXR5O1xuXG4gICAgICAgICAgICBmb3IgKGkgPSAwLCBsZW4gPSBub2RlLmNoaWxkcmVuLmxlbmd0aDsgaSA8IGxlbjsgaSsrKSB7XG4gICAgICAgICAgICAgICAgY2hpbGQgPSBub2RlLmNoaWxkcmVuW2ldO1xuICAgICAgICAgICAgICAgIGFyZWEgPSBiYm94QXJlYShjaGlsZC5iYm94KTtcbiAgICAgICAgICAgICAgICBlbmxhcmdlbWVudCA9IGVubGFyZ2VkQXJlYShiYm94LCBjaGlsZC5iYm94KSAtIGFyZWE7XG5cbiAgICAgICAgICAgICAgICAvLyBjaG9vc2UgZW50cnkgd2l0aCB0aGUgbGVhc3QgYXJlYSBlbmxhcmdlbWVudFxuICAgICAgICAgICAgICAgIGlmIChlbmxhcmdlbWVudCA8IG1pbkVubGFyZ2VtZW50KSB7XG4gICAgICAgICAgICAgICAgICAgIG1pbkVubGFyZ2VtZW50ID0gZW5sYXJnZW1lbnQ7XG4gICAgICAgICAgICAgICAgICAgIG1pbkFyZWEgPSBhcmVhIDwgbWluQXJlYSA/IGFyZWEgOiBtaW5BcmVhO1xuICAgICAgICAgICAgICAgICAgICB0YXJnZXROb2RlID0gY2hpbGQ7XG5cbiAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKGVubGFyZ2VtZW50ID09PSBtaW5FbmxhcmdlbWVudCkge1xuICAgICAgICAgICAgICAgICAgICAvLyBvdGhlcndpc2UgY2hvb3NlIG9uZSB3aXRoIHRoZSBzbWFsbGVzdCBhcmVhXG4gICAgICAgICAgICAgICAgICAgIGlmIChhcmVhIDwgbWluQXJlYSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgbWluQXJlYSA9IGFyZWE7XG4gICAgICAgICAgICAgICAgICAgICAgICB0YXJnZXROb2RlID0gY2hpbGQ7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIG5vZGUgPSB0YXJnZXROb2RlO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIG5vZGU7XG4gICAgfSxcblxuICAgIF9pbnNlcnQ6IGZ1bmN0aW9uIChpdGVtLCBsZXZlbCwgaXNOb2RlKSB7XG5cbiAgICAgICAgdmFyIHRvQkJveCA9IHRoaXMudG9CQm94LFxuICAgICAgICAgICAgYmJveCA9IGlzTm9kZSA/IGl0ZW0uYmJveCA6IHRvQkJveChpdGVtKSxcbiAgICAgICAgICAgIGluc2VydFBhdGggPSBbXTtcblxuICAgICAgICAvLyBmaW5kIHRoZSBiZXN0IG5vZGUgZm9yIGFjY29tbW9kYXRpbmcgdGhlIGl0ZW0sIHNhdmluZyBhbGwgbm9kZXMgYWxvbmcgdGhlIHBhdGggdG9vXG4gICAgICAgIHZhciBub2RlID0gdGhpcy5fY2hvb3NlU3VidHJlZShiYm94LCB0aGlzLmRhdGEsIGxldmVsLCBpbnNlcnRQYXRoKTtcblxuICAgICAgICAvLyBwdXQgdGhlIGl0ZW0gaW50byB0aGUgbm9kZVxuICAgICAgICBub2RlLmNoaWxkcmVuLnB1c2goaXRlbSk7XG4gICAgICAgIGV4dGVuZChub2RlLmJib3gsIGJib3gpO1xuXG4gICAgICAgIC8vIHNwbGl0IG9uIG5vZGUgb3ZlcmZsb3c7IHByb3BhZ2F0ZSB1cHdhcmRzIGlmIG5lY2Vzc2FyeVxuICAgICAgICB3aGlsZSAobGV2ZWwgPj0gMCkge1xuICAgICAgICAgICAgaWYgKGluc2VydFBhdGhbbGV2ZWxdLmNoaWxkcmVuLmxlbmd0aCA+IHRoaXMuX21heEVudHJpZXMpIHtcbiAgICAgICAgICAgICAgICB0aGlzLl9zcGxpdChpbnNlcnRQYXRoLCBsZXZlbCk7XG4gICAgICAgICAgICAgICAgbGV2ZWwtLTtcbiAgICAgICAgICAgIH0gZWxzZSBicmVhaztcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIGFkanVzdCBiYm94ZXMgYWxvbmcgdGhlIGluc2VydGlvbiBwYXRoXG4gICAgICAgIHRoaXMuX2FkanVzdFBhcmVudEJCb3hlcyhiYm94LCBpbnNlcnRQYXRoLCBsZXZlbCk7XG4gICAgfSxcblxuICAgIC8vIHNwbGl0IG92ZXJmbG93ZWQgbm9kZSBpbnRvIHR3b1xuICAgIF9zcGxpdDogZnVuY3Rpb24gKGluc2VydFBhdGgsIGxldmVsKSB7XG5cbiAgICAgICAgdmFyIG5vZGUgPSBpbnNlcnRQYXRoW2xldmVsXSxcbiAgICAgICAgICAgIE0gPSBub2RlLmNoaWxkcmVuLmxlbmd0aCxcbiAgICAgICAgICAgIG0gPSB0aGlzLl9taW5FbnRyaWVzO1xuXG4gICAgICAgIHRoaXMuX2Nob29zZVNwbGl0QXhpcyhub2RlLCBtLCBNKTtcblxuICAgICAgICB2YXIgbmV3Tm9kZSA9IHtcbiAgICAgICAgICAgIGNoaWxkcmVuOiBub2RlLmNoaWxkcmVuLnNwbGljZSh0aGlzLl9jaG9vc2VTcGxpdEluZGV4KG5vZGUsIG0sIE0pKSxcbiAgICAgICAgICAgIGhlaWdodDogbm9kZS5oZWlnaHRcbiAgICAgICAgfTtcblxuICAgICAgICBpZiAobm9kZS5sZWFmKSBuZXdOb2RlLmxlYWYgPSB0cnVlO1xuXG4gICAgICAgIGNhbGNCQm94KG5vZGUsIHRoaXMudG9CQm94KTtcbiAgICAgICAgY2FsY0JCb3gobmV3Tm9kZSwgdGhpcy50b0JCb3gpO1xuXG4gICAgICAgIGlmIChsZXZlbCkgaW5zZXJ0UGF0aFtsZXZlbCAtIDFdLmNoaWxkcmVuLnB1c2gobmV3Tm9kZSk7XG4gICAgICAgIGVsc2UgdGhpcy5fc3BsaXRSb290KG5vZGUsIG5ld05vZGUpO1xuICAgIH0sXG5cbiAgICBfc3BsaXRSb290OiBmdW5jdGlvbiAobm9kZSwgbmV3Tm9kZSkge1xuICAgICAgICAvLyBzcGxpdCByb290IG5vZGVcbiAgICAgICAgdGhpcy5kYXRhID0ge1xuICAgICAgICAgICAgY2hpbGRyZW46IFtub2RlLCBuZXdOb2RlXSxcbiAgICAgICAgICAgIGhlaWdodDogbm9kZS5oZWlnaHQgKyAxXG4gICAgICAgIH07XG4gICAgICAgIGNhbGNCQm94KHRoaXMuZGF0YSwgdGhpcy50b0JCb3gpO1xuICAgIH0sXG5cbiAgICBfY2hvb3NlU3BsaXRJbmRleDogZnVuY3Rpb24gKG5vZGUsIG0sIE0pIHtcblxuICAgICAgICB2YXIgaSwgYmJveDEsIGJib3gyLCBvdmVybGFwLCBhcmVhLCBtaW5PdmVybGFwLCBtaW5BcmVhLCBpbmRleDtcblxuICAgICAgICBtaW5PdmVybGFwID0gbWluQXJlYSA9IEluZmluaXR5O1xuXG4gICAgICAgIGZvciAoaSA9IG07IGkgPD0gTSAtIG07IGkrKykge1xuICAgICAgICAgICAgYmJveDEgPSBkaXN0QkJveChub2RlLCAwLCBpLCB0aGlzLnRvQkJveCk7XG4gICAgICAgICAgICBiYm94MiA9IGRpc3RCQm94KG5vZGUsIGksIE0sIHRoaXMudG9CQm94KTtcblxuICAgICAgICAgICAgb3ZlcmxhcCA9IGludGVyc2VjdGlvbkFyZWEoYmJveDEsIGJib3gyKTtcbiAgICAgICAgICAgIGFyZWEgPSBiYm94QXJlYShiYm94MSkgKyBiYm94QXJlYShiYm94Mik7XG5cbiAgICAgICAgICAgIC8vIGNob29zZSBkaXN0cmlidXRpb24gd2l0aCBtaW5pbXVtIG92ZXJsYXBcbiAgICAgICAgICAgIGlmIChvdmVybGFwIDwgbWluT3ZlcmxhcCkge1xuICAgICAgICAgICAgICAgIG1pbk92ZXJsYXAgPSBvdmVybGFwO1xuICAgICAgICAgICAgICAgIGluZGV4ID0gaTtcblxuICAgICAgICAgICAgICAgIG1pbkFyZWEgPSBhcmVhIDwgbWluQXJlYSA/IGFyZWEgOiBtaW5BcmVhO1xuXG4gICAgICAgICAgICB9IGVsc2UgaWYgKG92ZXJsYXAgPT09IG1pbk92ZXJsYXApIHtcbiAgICAgICAgICAgICAgICAvLyBvdGhlcndpc2UgY2hvb3NlIGRpc3RyaWJ1dGlvbiB3aXRoIG1pbmltdW0gYXJlYVxuICAgICAgICAgICAgICAgIGlmIChhcmVhIDwgbWluQXJlYSkge1xuICAgICAgICAgICAgICAgICAgICBtaW5BcmVhID0gYXJlYTtcbiAgICAgICAgICAgICAgICAgICAgaW5kZXggPSBpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBpbmRleDtcbiAgICB9LFxuXG4gICAgLy8gc29ydHMgbm9kZSBjaGlsZHJlbiBieSB0aGUgYmVzdCBheGlzIGZvciBzcGxpdFxuICAgIF9jaG9vc2VTcGxpdEF4aXM6IGZ1bmN0aW9uIChub2RlLCBtLCBNKSB7XG5cbiAgICAgICAgdmFyIGNvbXBhcmVNaW5YID0gbm9kZS5sZWFmID8gdGhpcy5jb21wYXJlTWluWCA6IGNvbXBhcmVOb2RlTWluWCxcbiAgICAgICAgICAgIGNvbXBhcmVNaW5ZID0gbm9kZS5sZWFmID8gdGhpcy5jb21wYXJlTWluWSA6IGNvbXBhcmVOb2RlTWluWSxcbiAgICAgICAgICAgIHhNYXJnaW4gPSB0aGlzLl9hbGxEaXN0TWFyZ2luKG5vZGUsIG0sIE0sIGNvbXBhcmVNaW5YKSxcbiAgICAgICAgICAgIHlNYXJnaW4gPSB0aGlzLl9hbGxEaXN0TWFyZ2luKG5vZGUsIG0sIE0sIGNvbXBhcmVNaW5ZKTtcblxuICAgICAgICAvLyBpZiB0b3RhbCBkaXN0cmlidXRpb25zIG1hcmdpbiB2YWx1ZSBpcyBtaW5pbWFsIGZvciB4LCBzb3J0IGJ5IG1pblgsXG4gICAgICAgIC8vIG90aGVyd2lzZSBpdCdzIGFscmVhZHkgc29ydGVkIGJ5IG1pbllcbiAgICAgICAgaWYgKHhNYXJnaW4gPCB5TWFyZ2luKSBub2RlLmNoaWxkcmVuLnNvcnQoY29tcGFyZU1pblgpO1xuICAgIH0sXG5cbiAgICAvLyB0b3RhbCBtYXJnaW4gb2YgYWxsIHBvc3NpYmxlIHNwbGl0IGRpc3RyaWJ1dGlvbnMgd2hlcmUgZWFjaCBub2RlIGlzIGF0IGxlYXN0IG0gZnVsbFxuICAgIF9hbGxEaXN0TWFyZ2luOiBmdW5jdGlvbiAobm9kZSwgbSwgTSwgY29tcGFyZSkge1xuXG4gICAgICAgIG5vZGUuY2hpbGRyZW4uc29ydChjb21wYXJlKTtcblxuICAgICAgICB2YXIgdG9CQm94ID0gdGhpcy50b0JCb3gsXG4gICAgICAgICAgICBsZWZ0QkJveCA9IGRpc3RCQm94KG5vZGUsIDAsIG0sIHRvQkJveCksXG4gICAgICAgICAgICByaWdodEJCb3ggPSBkaXN0QkJveChub2RlLCBNIC0gbSwgTSwgdG9CQm94KSxcbiAgICAgICAgICAgIG1hcmdpbiA9IGJib3hNYXJnaW4obGVmdEJCb3gpICsgYmJveE1hcmdpbihyaWdodEJCb3gpLFxuICAgICAgICAgICAgaSwgY2hpbGQ7XG5cbiAgICAgICAgZm9yIChpID0gbTsgaSA8IE0gLSBtOyBpKyspIHtcbiAgICAgICAgICAgIGNoaWxkID0gbm9kZS5jaGlsZHJlbltpXTtcbiAgICAgICAgICAgIGV4dGVuZChsZWZ0QkJveCwgbm9kZS5sZWFmID8gdG9CQm94KGNoaWxkKSA6IGNoaWxkLmJib3gpO1xuICAgICAgICAgICAgbWFyZ2luICs9IGJib3hNYXJnaW4obGVmdEJCb3gpO1xuICAgICAgICB9XG5cbiAgICAgICAgZm9yIChpID0gTSAtIG0gLSAxOyBpID49IG07IGktLSkge1xuICAgICAgICAgICAgY2hpbGQgPSBub2RlLmNoaWxkcmVuW2ldO1xuICAgICAgICAgICAgZXh0ZW5kKHJpZ2h0QkJveCwgbm9kZS5sZWFmID8gdG9CQm94KGNoaWxkKSA6IGNoaWxkLmJib3gpO1xuICAgICAgICAgICAgbWFyZ2luICs9IGJib3hNYXJnaW4ocmlnaHRCQm94KTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBtYXJnaW47XG4gICAgfSxcblxuICAgIF9hZGp1c3RQYXJlbnRCQm94ZXM6IGZ1bmN0aW9uIChiYm94LCBwYXRoLCBsZXZlbCkge1xuICAgICAgICAvLyBhZGp1c3QgYmJveGVzIGFsb25nIHRoZSBnaXZlbiB0cmVlIHBhdGhcbiAgICAgICAgZm9yICh2YXIgaSA9IGxldmVsOyBpID49IDA7IGktLSkge1xuICAgICAgICAgICAgZXh0ZW5kKHBhdGhbaV0uYmJveCwgYmJveCk7XG4gICAgICAgIH1cbiAgICB9LFxuXG4gICAgX2NvbmRlbnNlOiBmdW5jdGlvbiAocGF0aCkge1xuICAgICAgICAvLyBnbyB0aHJvdWdoIHRoZSBwYXRoLCByZW1vdmluZyBlbXB0eSBub2RlcyBhbmQgdXBkYXRpbmcgYmJveGVzXG4gICAgICAgIGZvciAodmFyIGkgPSBwYXRoLmxlbmd0aCAtIDEsIHNpYmxpbmdzOyBpID49IDA7IGktLSkge1xuICAgICAgICAgICAgaWYgKHBhdGhbaV0uY2hpbGRyZW4ubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICAgICAgaWYgKGkgPiAwKSB7XG4gICAgICAgICAgICAgICAgICAgIHNpYmxpbmdzID0gcGF0aFtpIC0gMV0uY2hpbGRyZW47XG4gICAgICAgICAgICAgICAgICAgIHNpYmxpbmdzLnNwbGljZShzaWJsaW5ncy5pbmRleE9mKHBhdGhbaV0pLCAxKTtcblxuICAgICAgICAgICAgICAgIH0gZWxzZSB0aGlzLmNsZWFyKCk7XG5cbiAgICAgICAgICAgIH0gZWxzZSBjYWxjQkJveChwYXRoW2ldLCB0aGlzLnRvQkJveCk7XG4gICAgICAgIH1cbiAgICB9LFxuXG4gICAgX2luaXRGb3JtYXQ6IGZ1bmN0aW9uIChmb3JtYXQpIHtcbiAgICAgICAgLy8gZGF0YSBmb3JtYXQgKG1pblgsIG1pblksIG1heFgsIG1heFkgYWNjZXNzb3JzKVxuXG4gICAgICAgIC8vIHVzZXMgZXZhbC10eXBlIGZ1bmN0aW9uIGNvbXBpbGF0aW9uIGluc3RlYWQgb2YganVzdCBhY2NlcHRpbmcgYSB0b0JCb3ggZnVuY3Rpb25cbiAgICAgICAgLy8gYmVjYXVzZSB0aGUgYWxnb3JpdGhtcyBhcmUgdmVyeSBzZW5zaXRpdmUgdG8gc29ydGluZyBmdW5jdGlvbnMgcGVyZm9ybWFuY2UsXG4gICAgICAgIC8vIHNvIHRoZXkgc2hvdWxkIGJlIGRlYWQgc2ltcGxlIGFuZCB3aXRob3V0IGlubmVyIGNhbGxzXG5cbiAgICAgICAgLy8ganNoaW50IGV2aWw6IHRydWVcblxuICAgICAgICB2YXIgY29tcGFyZUFyciA9IFsncmV0dXJuIGEnLCAnIC0gYicsICc7J107XG5cbiAgICAgICAgdGhpcy5jb21wYXJlTWluWCA9IG5ldyBGdW5jdGlvbignYScsICdiJywgY29tcGFyZUFyci5qb2luKGZvcm1hdFswXSkpO1xuICAgICAgICB0aGlzLmNvbXBhcmVNaW5ZID0gbmV3IEZ1bmN0aW9uKCdhJywgJ2InLCBjb21wYXJlQXJyLmpvaW4oZm9ybWF0WzFdKSk7XG5cbiAgICAgICAgdGhpcy50b0JCb3ggPSBuZXcgRnVuY3Rpb24oJ2EnLCAncmV0dXJuIFthJyArIGZvcm1hdC5qb2luKCcsIGEnKSArICddOycpO1xuICAgIH1cbn07XG5cblxuLy8gY2FsY3VsYXRlIG5vZGUncyBiYm94IGZyb20gYmJveGVzIG9mIGl0cyBjaGlsZHJlblxuZnVuY3Rpb24gY2FsY0JCb3gobm9kZSwgdG9CQm94KSB7XG4gICAgbm9kZS5iYm94ID0gZGlzdEJCb3gobm9kZSwgMCwgbm9kZS5jaGlsZHJlbi5sZW5ndGgsIHRvQkJveCk7XG59XG5cbi8vIG1pbiBib3VuZGluZyByZWN0YW5nbGUgb2Ygbm9kZSBjaGlsZHJlbiBmcm9tIGsgdG8gcC0xXG5mdW5jdGlvbiBkaXN0QkJveChub2RlLCBrLCBwLCB0b0JCb3gpIHtcbiAgICB2YXIgYmJveCA9IGVtcHR5KCk7XG5cbiAgICBmb3IgKHZhciBpID0gaywgY2hpbGQ7IGkgPCBwOyBpKyspIHtcbiAgICAgICAgY2hpbGQgPSBub2RlLmNoaWxkcmVuW2ldO1xuICAgICAgICBleHRlbmQoYmJveCwgbm9kZS5sZWFmID8gdG9CQm94KGNoaWxkKSA6IGNoaWxkLmJib3gpO1xuICAgIH1cblxuICAgIHJldHVybiBiYm94O1xufVxuXG5mdW5jdGlvbiBlbXB0eSgpIHsgcmV0dXJuIFtJbmZpbml0eSwgSW5maW5pdHksIC1JbmZpbml0eSwgLUluZmluaXR5XTsgfVxuXG5mdW5jdGlvbiBleHRlbmQoYSwgYikge1xuICAgIGFbMF0gPSBNYXRoLm1pbihhWzBdLCBiWzBdKTtcbiAgICBhWzFdID0gTWF0aC5taW4oYVsxXSwgYlsxXSk7XG4gICAgYVsyXSA9IE1hdGgubWF4KGFbMl0sIGJbMl0pO1xuICAgIGFbM10gPSBNYXRoLm1heChhWzNdLCBiWzNdKTtcbiAgICByZXR1cm4gYTtcbn1cblxuZnVuY3Rpb24gY29tcGFyZU5vZGVNaW5YKGEsIGIpIHsgcmV0dXJuIGEuYmJveFswXSAtIGIuYmJveFswXTsgfVxuZnVuY3Rpb24gY29tcGFyZU5vZGVNaW5ZKGEsIGIpIHsgcmV0dXJuIGEuYmJveFsxXSAtIGIuYmJveFsxXTsgfVxuXG5mdW5jdGlvbiBiYm94QXJlYShhKSAgIHsgcmV0dXJuIChhWzJdIC0gYVswXSkgKiAoYVszXSAtIGFbMV0pOyB9XG5mdW5jdGlvbiBiYm94TWFyZ2luKGEpIHsgcmV0dXJuIChhWzJdIC0gYVswXSkgKyAoYVszXSAtIGFbMV0pOyB9XG5cbmZ1bmN0aW9uIGVubGFyZ2VkQXJlYShhLCBiKSB7XG4gICAgcmV0dXJuIChNYXRoLm1heChiWzJdLCBhWzJdKSAtIE1hdGgubWluKGJbMF0sIGFbMF0pKSAqXG4gICAgICAgICAgIChNYXRoLm1heChiWzNdLCBhWzNdKSAtIE1hdGgubWluKGJbMV0sIGFbMV0pKTtcbn1cblxuZnVuY3Rpb24gaW50ZXJzZWN0aW9uQXJlYShhLCBiKSB7XG4gICAgdmFyIG1pblggPSBNYXRoLm1heChhWzBdLCBiWzBdKSxcbiAgICAgICAgbWluWSA9IE1hdGgubWF4KGFbMV0sIGJbMV0pLFxuICAgICAgICBtYXhYID0gTWF0aC5taW4oYVsyXSwgYlsyXSksXG4gICAgICAgIG1heFkgPSBNYXRoLm1pbihhWzNdLCBiWzNdKTtcblxuICAgIHJldHVybiBNYXRoLm1heCgwLCBtYXhYIC0gbWluWCkgKlxuICAgICAgICAgICBNYXRoLm1heCgwLCBtYXhZIC0gbWluWSk7XG59XG5cbmZ1bmN0aW9uIGNvbnRhaW5zKGEsIGIpIHtcbiAgICByZXR1cm4gYVswXSA8PSBiWzBdICYmXG4gICAgICAgICAgIGFbMV0gPD0gYlsxXSAmJlxuICAgICAgICAgICBiWzJdIDw9IGFbMl0gJiZcbiAgICAgICAgICAgYlszXSA8PSBhWzNdO1xufVxuXG5mdW5jdGlvbiBpbnRlcnNlY3RzKGEsIGIpIHtcbiAgICByZXR1cm4gYlswXSA8PSBhWzJdICYmXG4gICAgICAgICAgIGJbMV0gPD0gYVszXSAmJlxuICAgICAgICAgICBiWzJdID49IGFbMF0gJiZcbiAgICAgICAgICAgYlszXSA+PSBhWzFdO1xufVxuXG4vLyBzb3J0IGFuIGFycmF5IHNvIHRoYXQgaXRlbXMgY29tZSBpbiBncm91cHMgb2YgbiB1bnNvcnRlZCBpdGVtcywgd2l0aCBncm91cHMgc29ydGVkIGJldHdlZW4gZWFjaCBvdGhlcjtcbi8vIGNvbWJpbmVzIHNlbGVjdGlvbiBhbGdvcml0aG0gd2l0aCBiaW5hcnkgZGl2aWRlICYgY29ucXVlciBhcHByb2FjaFxuXG5mdW5jdGlvbiBtdWx0aVNlbGVjdChhcnIsIGxlZnQsIHJpZ2h0LCBuLCBjb21wYXJlKSB7XG4gICAgdmFyIHN0YWNrID0gW2xlZnQsIHJpZ2h0XSxcbiAgICAgICAgbWlkO1xuXG4gICAgd2hpbGUgKHN0YWNrLmxlbmd0aCkge1xuICAgICAgICByaWdodCA9IHN0YWNrLnBvcCgpO1xuICAgICAgICBsZWZ0ID0gc3RhY2sucG9wKCk7XG5cbiAgICAgICAgaWYgKHJpZ2h0IC0gbGVmdCA8PSBuKSBjb250aW51ZTtcblxuICAgICAgICBtaWQgPSBsZWZ0ICsgTWF0aC5jZWlsKChyaWdodCAtIGxlZnQpIC8gbiAvIDIpICogbjtcbiAgICAgICAgc2VsZWN0KGFyciwgbGVmdCwgcmlnaHQsIG1pZCwgY29tcGFyZSk7XG5cbiAgICAgICAgc3RhY2sucHVzaChsZWZ0LCBtaWQsIG1pZCwgcmlnaHQpO1xuICAgIH1cbn1cblxuLy8gRmxveWQtUml2ZXN0IHNlbGVjdGlvbiBhbGdvcml0aG06XG4vLyBzb3J0IGFuIGFycmF5IGJldHdlZW4gbGVmdCBhbmQgcmlnaHQgKGluY2x1c2l2ZSkgc28gdGhhdCB0aGUgc21hbGxlc3QgayBlbGVtZW50cyBjb21lIGZpcnN0ICh1bm9yZGVyZWQpXG5mdW5jdGlvbiBzZWxlY3QoYXJyLCBsZWZ0LCByaWdodCwgaywgY29tcGFyZSkge1xuICAgIHZhciBuLCBpLCB6LCBzLCBzZCwgbmV3TGVmdCwgbmV3UmlnaHQsIHQsIGo7XG5cbiAgICB3aGlsZSAocmlnaHQgPiBsZWZ0KSB7XG4gICAgICAgIGlmIChyaWdodCAtIGxlZnQgPiA2MDApIHtcbiAgICAgICAgICAgIG4gPSByaWdodCAtIGxlZnQgKyAxO1xuICAgICAgICAgICAgaSA9IGsgLSBsZWZ0ICsgMTtcbiAgICAgICAgICAgIHogPSBNYXRoLmxvZyhuKTtcbiAgICAgICAgICAgIHMgPSAwLjUgKiBNYXRoLmV4cCgyICogeiAvIDMpO1xuICAgICAgICAgICAgc2QgPSAwLjUgKiBNYXRoLnNxcnQoeiAqIHMgKiAobiAtIHMpIC8gbikgKiAoaSAtIG4gLyAyIDwgMCA/IC0xIDogMSk7XG4gICAgICAgICAgICBuZXdMZWZ0ID0gTWF0aC5tYXgobGVmdCwgTWF0aC5mbG9vcihrIC0gaSAqIHMgLyBuICsgc2QpKTtcbiAgICAgICAgICAgIG5ld1JpZ2h0ID0gTWF0aC5taW4ocmlnaHQsIE1hdGguZmxvb3IoayArIChuIC0gaSkgKiBzIC8gbiArIHNkKSk7XG4gICAgICAgICAgICBzZWxlY3QoYXJyLCBuZXdMZWZ0LCBuZXdSaWdodCwgaywgY29tcGFyZSk7XG4gICAgICAgIH1cblxuICAgICAgICB0ID0gYXJyW2tdO1xuICAgICAgICBpID0gbGVmdDtcbiAgICAgICAgaiA9IHJpZ2h0O1xuXG4gICAgICAgIHN3YXAoYXJyLCBsZWZ0LCBrKTtcbiAgICAgICAgaWYgKGNvbXBhcmUoYXJyW3JpZ2h0XSwgdCkgPiAwKSBzd2FwKGFyciwgbGVmdCwgcmlnaHQpO1xuXG4gICAgICAgIHdoaWxlIChpIDwgaikge1xuICAgICAgICAgICAgc3dhcChhcnIsIGksIGopO1xuICAgICAgICAgICAgaSsrO1xuICAgICAgICAgICAgai0tO1xuICAgICAgICAgICAgd2hpbGUgKGNvbXBhcmUoYXJyW2ldLCB0KSA8IDApIGkrKztcbiAgICAgICAgICAgIHdoaWxlIChjb21wYXJlKGFycltqXSwgdCkgPiAwKSBqLS07XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoY29tcGFyZShhcnJbbGVmdF0sIHQpID09PSAwKSBzd2FwKGFyciwgbGVmdCwgaik7XG4gICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgaisrO1xuICAgICAgICAgICAgc3dhcChhcnIsIGosIHJpZ2h0KTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChqIDw9IGspIGxlZnQgPSBqICsgMTtcbiAgICAgICAgaWYgKGsgPD0gaikgcmlnaHQgPSBqIC0gMTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIHN3YXAoYXJyLCBpLCBqKSB7XG4gICAgdmFyIHRtcCA9IGFycltpXTtcbiAgICBhcnJbaV0gPSBhcnJbal07XG4gICAgYXJyW2pdID0gdG1wO1xufVxuXG5cbi8vIGV4cG9ydCBhcyBBTUQvQ29tbW9uSlMgbW9kdWxlIG9yIGdsb2JhbCB2YXJpYWJsZVxuaWYgKHR5cGVvZiBkZWZpbmUgPT09ICdmdW5jdGlvbicgJiYgZGVmaW5lLmFtZCkgZGVmaW5lKCdyYnVzaCcsIGZ1bmN0aW9uKCkgeyByZXR1cm4gcmJ1c2g7IH0pO1xuZWxzZSBpZiAodHlwZW9mIG1vZHVsZSAhPT0gJ3VuZGVmaW5lZCcpIG1vZHVsZS5leHBvcnRzID0gcmJ1c2g7XG5lbHNlIGlmICh0eXBlb2Ygc2VsZiAhPT0gJ3VuZGVmaW5lZCcpIHNlbGYucmJ1c2ggPSByYnVzaDtcbmVsc2Ugd2luZG93LnJidXNoID0gcmJ1c2g7XG5cbn0pKCk7XG4iXX0=
