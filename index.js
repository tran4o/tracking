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
        	//-------------------------------------------------------------------------        	
    		var delay = -(new Date()).getTimezoneOffset()*60*1000;	// 120 for gmt+2
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
                	json.push({start:pp.__startTime-delay,end : ctime-delay,imei:pp.deviceId});
                }
                if (!json.length)
                	return;
                function processData(data) 
                {
                	for (var i in data) 
                	{
                		data[i].timestamp+=delay;
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

},{"./Config":7,"./Utils":17,"joose":18}],7:[function(require,module,exports){
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
		pingInterval : 10, // interval in seconds to ping with gps data
		gpsInaccuracy : 0  // error simulation in METER (look math.gpsInaccuracy, min 1/2)
	},	
	math : {
		gpsInaccuracy : 3,	//TODO 13 min
		speedAndAccelerationAverageDegree : 2,	// calculation based on N states (average) (MIN 2)
		displayDelay : 80,						// display delay in SECONDS
		interpolateGPSAverage : 0, // number of recent values to calculate average gps for position (smoothing the curve.min 0 = NO,1 = 2 values (current and last))
		roadDistanceBestPointCalculationCoef : 0.2 // TODO EXPLAIN
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

},{"./Utils.js":17}],8:[function(require,module,exports){
var Utils=require('./Utils');
var STYLES=require('./Styles');
require('joose');
require('./Track');
require('./LiveStream');

Class("Gui", 
{
    //--------------------------------------
	// ALL COORDINATES ARE IN WORLD MERCATOR
    //--------------------------------------
    has: 
	{
    	isDebug : {
    		is : "rw",
    		init : !Utils.mobileAndTabletCheck()
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
			if (this.initialPos) 
				defPos=this.initialPos;
			//---------------------------------------------
			var extent = params && params.skipExtent ? null : TRACK.getRoute() && TRACK.getRoute().length > 1 ? ol.proj.transformExtent( (new ol.geom.LineString(TRACK.getRoute())).getExtent() , 'EPSG:4326', 'EPSG:3857') : null;
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
			this.debugLayerGPS = new ol.layer.Vector({
				  source: new ol.source.Vector(),
				  style : STYLES["debugGPS"]
			});
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
				zoom: this.getInitialZoom(),
				minZoom: this.isWidget ? this.initialZoom : 10,
				maxZoom: this.isWidget ? this.initialZoom : 17,
				extent : extent ? extent : undefined
			  })
			});
			
			for (var i=0;i<ints.length;i++)
				this.map.addInteraction(ints[i]);
			this.map.addOverlay(this.popup1);
			this.map.addOverlay(this.popup2);
			if (this.isDebug) 
				this.map.addLayer(this.debugLayerGPS);
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
					arr.push(ip);
				}
			}
			//-------------------------------------------------------
			for (var ip=0;ip<TRACK.participants.length;ip++) 
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
},{"./LiveStream":11,"./Styles":15,"./Track":16,"./Utils":17,"joose":18}],9:[function(require,module,exports){
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
},{"./Point":14,"./Utils":17,"joose":18}],10:[function(require,module,exports){
//---------------------------------------------------------------------------------------------------------
require('./Track');
require('./GUI');
require('./Participant');
require('./MovingCam');
require('./HotSpot');
require('./BackendStream');
window.CONFIG=require('./Config');
var Utils=require('./Utils');
for (var e in Utils) 
	window[e]=Utils[e];
//---------------------------------------------------------------------------------------------------------
function getSearchParameters() {
    var prmstr = window.location.search.substr(1);
    return prmstr != null && prmstr != "" ? transformToAssocArray(prmstr) : {};
}
function transformToAssocArray( prmstr ) {
  var params = {};
  var prmarr = prmstr.split("&");
  for ( var i = 0; i < prmarr.length; i++) {
      var tmparr = prmarr[i].split("=");
      params[tmparr[0]] = tmparr[1];
  }
  return params;
}
var params = getSearchParameters();
//-----------------------------------------------
if (params["debug"] && params["debug"] != "0") 
{
	// DEBUG MODE CONFIGURATIOn
	CONFIG.timeouts.animationFrame=4; // 4 sec
}
//-----------------------------------------------
var tableFavorites=null;
var tableParticipants=null;
var tableRank=null;

function showMap() {
	$("#left_pane").addClass('hide');
	$("#map").removeClass('col-sm-6').removeClass('col-md-8').removeClass('hidden-xs').addClass('col-sm-12');
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

function isTabVisible(tabname) {
	if ($("#left_pane").hasClass("hide"))
		return false;			
	if (tabname.indexOf('#') == -1) {
		tabname = '#' + tabname;
	}
	return !($(tabname).hasClass('hide'));
}
function showTab( tabname ) {
	$('#tabcont').find('div[role="tabpanel"]').addClass('hide');
	if (tabname.indexOf('#') == -1) {
		tabname = '#' + tabname;
	}
	$(tabname).removeClass('hide');
}

function showParticipants() {
	showLeftPane();
	showTab("part");
	if (!tableParticipants)
	{
        tableParticipants = $('#table-participants').DataTable( {
			"iDisplayLength" : 50,
			"bAutoWidth": false,
			"aaSorting": [[2,'asc']],
			//ajax: CONFIG.server.prefix+"rest/participant/",
			data : function()  {
				return PARTICIPANTS;
			},	
			columns: [
				{ 
					//follow
					className : "dt-body-center", 
					data: null,
					render: function ( data, type, row ) 
					{
						if (data.follow == 1)
							return "<div class='invisible'>1</div><img src='img/favorite.png' class='table-favorite-add'/>";
						return "<div class='invisible'>0</div><img src='img/favorite-add.png' class='table-favorite-add'/>";
					} 
							
				},
				{ data: "name" },
				{ data: "bib",className : "dt-body-center" },
				{ data: "gender",className : "dt-body-center" },
				{ 
					className : "dt-body-center", 
					data: null,
					render: function ( data, type, row ) 
					{
						if (!data.country)
							return "";
						return '<div class="invisible">'+data.country+'</div><flag-icon key="'+data.country+'" width="42"></flag-icon>';
					} 					
				},
				{ 
					// age + GROUP
					data: null,
                    className : "dt-body-right",
					render: function ( data, type, row ) 
					{
						var age = parseInt(data.age);
						return data.ageGroup+" ("+age+")";
					}

				}
	
			],
			tableTools: {
				sRowSelect: "os",
				aButtons: [			           
	           ]
			}
		} );
	} else {
		$("#table-participants").resize();  
	}
}

function showFavs() 
{
	showLeftPane();
	showTab("favs");
	if (!tableFavorites) 
	{
		tableFavorites = $('#table-favorites').DataTable( {
			"iDisplayLength" : 50,
			"bAutoWidth": false,
			"aaSorting": [[1,'asc']],
			data : function () {
				var arr = PARTICIPANTS;//.filter(function(v){ return v.isFavorite; });
				var res = [];
				for (var i in arr) 
				{
					var part = arr[i];
					res.push({name : part.name,bib : part.startPos,gender : part.gender,country : part.country,ageGroup : part.ageGroup,age : part.age});
				}
				console.log(res);
				return res;
			},	
			columns: [
				{ data: "name" },
				{ data: "bib",className : "dt-body-center" },
                { data: "gender",className : "dt-body-center" },
                {
                    className : "dt-body-center",
                    data: null,
					render: function ( data, type, row ) 
					{
						if (!data.country)
							return "";
						return '<div class="invisible">'+data.country+'</div><flag-icon key="'+data.country+'" width="42"></flag-icon>';
					} 
				},
				{ 
					// age + GROUP
					data: null,
					render: function ( data, type, row ) 
					{
						var age = parseInt(data.age);
						return data.ageGroup+" ("+age+")";
					} 
					,className : "dt-body-right"

				}
			],
			tableTools: {
				sRowSelect: "os",
				aButtons: [			           
	           ]
			}
		} );
		$('#table-favorites').find('tbody').on( 'click', 'tr', function (e) {
			if (tableFavorites.row( this ).data()) {
				GUI.setSelectedParticipant1(tableFavorites.row( this ).data().code,true);
				GUI.setSelectedParticipant2(null);
			}
		} );
	} else {
		$("#table-favorites").resize();  
	}
}

function showRank() 
{
	showLeftPane();
	showTab("rank");
	if (!tableRank) 
	{
		var arr = PARTICIPANTS;//.filter(function(v){ return v.isFavorite; });
		var data = [];
		for (var i in arr) 
		{
			var part = arr[i];
			console.log(part);
			data.push({"name" : part.code,"bib" : part.startPos,"gender" : part.gender,"country" : part.country,"ageGroup" : part.ageGroup,"age" : part.age,"overall-rank":part.overallRank,"gender-rank" : part.genderRank,"group-rank" : part.groupRank,"occupation" : ""});
		}
		console.log(data);

		tableRank = $('#table-ranking').DataTable( {
			"iDisplayLength" : 50,
			"bAutoWidth": false,
			"aaSorting": [[1,'asc']],
			//ajax: "script/participants-example.json",
			data : data,
			columns: [
				{ data: "name" },
				{ data: "overall-rank",className : "dt-body-center" },
				{ data: "group-rank",className : "dt-body-center" },
				{ data: "gender-rank",className : "dt-body-center" },
				{ data: "bib",className : "dt-body-center" },
				{ data: "gender",className : "dt-body-center" },
                {
                    className : "dt-body-center",
                    data: null,
                    render: function ( data, type, row )
                    {
                        if (!data.country)
                            return "";
                        return '<div class="invisible">'+data.country+'</div><flag-icon key="'+data.country+'" width="42"></flag-icon>';
                    }
                },
				{ 
					// age + GROUP
					data: null,
					render: function ( data, type, row ) 
					{
						var age = parseInt(data.age);
						return data.ageGroup+" ("+age+")";
					} 
				},
				{ data: "occupation",className : "dt-body-center" }
			],
			tableTools: {
				sRowSelect: "os",
				aButtons: [			           
	           ]
			}
		} );
	} else {
		$("#table-favorites").resize();  
	}
}

function showDetails() {
	showLeftPane();
	showTab("dtls");
}

//--------------------------------------------------------------------------
window.TRACK = new Track();
window.GUI = new Gui({ track : TRACK });
window.PARTICIPANTS=[];
function errorRoute(err) {
	GUI.showError(err);
}
//--------------------------------------------------------------------------
function initGUI() 
{
    // add all the static HotSpots
    var dynamicTrackHotspots = [];
	for (var k=0;k<HOTSPOTS.length;k++)	{
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
}
//--------------------------------------------------------------------------
$(document).ready( function () 
{
	if (Utils.mobileAndTabletCheck())
		$("body").addClass("mobile");
	//--------------------------------------------------------------------------
	var baseurl = (window.location.host.indexOf("localhost") == 0 || window.location.host.indexOf("127.0.0.1") == 0) ? "http://localhost:3000/" : "node/"; 
	//--------------------------------------------------------------------------
	$.getJSON(baseurl+"event",function(data) 
	{
		var delay = -(new Date()).getTimezoneOffset()*60*1000;	// 120 for gmt+2
		var camc = 0;
		TRACK.setBikeStartKM(data.bikeStartKM);
		TRACK.setRunStartKM(data.runStartKM);
		TRACK.setRoute(data.route);
		CONFIG.times={begin : data.times.startTime+delay, end : data.times.endTime+delay };
		GUI.init({skipExtent:true});
		var stream = new BackendStream();
		function processEntry(pdata,isCam) {
			var part; 
			if (isCam)
				part=TRACK.newMovingCam(pdata.id,pdata.deviceId,pdata.code,camc++);
			else
				part=TRACK.newParticipant(pdata.id,pdata.deviceId,pdata.code);
			part.setColor(pdata.color);
			part.setAgeGroup(pdata.ageGroup);
			part.setAge(pdata.age);
			part.setCountry(pdata.country);
			part.setStartPos(pdata.startPos);
			part.setGender(pdata.gender);
			part.setIcon(pdata.icon);
			part.setImage(pdata.image);
			if (isCam || localStorage.getItem("favorite-"+part.id) == 1)
				part.setIsFavorite(true);
			if (!isCam) 
				PARTICIPANTS.push(part);
		}
		for (var i in data.participants) 
			processEntry(data.participants[i],false);
		for (var i in data.cams) 
			processEntry(data.cams[i],true);
		stream.start(TRACK);
		initGUI();
	}).fail(function() {
    	console.error("Error get event configuration from backend!");
	});
	//--------------------------------------------------------------------------
	$("#button_swim").css("background-color",CONFIG.appearance.trackColorSwim).click(function() {
		if ($(this).hasClass("inactive"))
		{
			$(this).removeClass("inactive");
			GUI.isShowSwim=true;
		} else {
			$(this).addClass("inactive");
			GUI.isShowSwim=false;
		}
		GUI.redraw();
	});

	$("#button_bike").css("background-color",CONFIG.appearance.trackColorBike).click(function() {
		if ($(this).hasClass("inactive"))
		{
			$(this).removeClass("inactive");
			GUI.isShowBike=true;
		} else {
			$(this).addClass("inactive");
			GUI.isShowBike=false;
		}
		GUI.redraw();
	});

	$("#button_run").css("background-color",CONFIG.appearance.trackColorRun).click(function() {
		if ($(this).hasClass("inactive"))
		{
			$(this).removeClass("inactive");
			GUI.isShowRun=true;
		} else {
			$(this).addClass("inactive");
			GUI.isShowRun=false;
		}
		GUI.redraw();
	});

	$("#button_participants").click(function() {
		if (isTabVisible("part"))
			showMap();
		else
			showParticipants();
	});

	$("#button_favorites").click(function() {
		if (isTabVisible("favs"))
			showMap();
		else
			showFavs();
	});

	$("#button_rank").click(function() {
		if (isTabVisible("rank"))
			showMap();
		else
			showRank();
	});

	$("#tabcont").find(".close").click(function() {
		showMap();
	});


	$("#link_partners, #link_legalNotice, #button_liveStream").click(function() {
		// TODO Rumen - don't like it, will have to fix it later
		var $toClose = $("._contVisible");
		var $toOpen = $("#" + $(this).data("open"));
		var isLiveStreamClose = $toClose.is("#liveStream");
		var isLiveStreamOpen = $toOpen.is("#liveStream");

		var self = this;
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

});


},{"./BackendStream":6,"./Config":7,"./GUI":8,"./HotSpot":9,"./MovingCam":12,"./Participant":13,"./Track":16,"./Utils":17}],11:[function(require,module,exports){
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
            $player.html('<iframe src=' + url + '?width=490&height=275&autoPlay=true&mute=false" width="490" height="275" frameborder="0" scrolling="no"> </iframe>');

            // show if not already shown
            if (!this._isShown)
                this._$comp.slideDown(400, completeCallback);
            this._isShown = true;
        }
    }
});
},{"./Utils":17,"joose":18}],12:[function(require,module,exports){
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
},{"./Participant":13,"joose":18}],13:[function(require,module,exports){
require('joose');
require('./Point');

var CONFIG = require('./Config');
var Utils = require('./Utils');

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
	        init: [0,0]	//lon lat world mercator
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
			
			// TEST
			/*if (!this.__time)
				this.__time = (new Date()).getTime();
			else {
				var dur = ((new Date()).getTime()-this.__time);
				var tt = dur/100000.0;
				if (tt > 1)
					tt=1;
				var tka = this.track.getPositionAndRotationFromElapsed(tt);
				this.setPosition([tka[0],tka[1]]);
				this.setRotation(tka[2]);
				this.updateFeature();
				this.setElapsed(res);
			}
			return;*/
			// TEST
			
			
			if (!this.states.length)
				return;
			var ctime=(new Date()).getTime();
			var isTime = (ctime >= CONFIG.times.begin && ctime <= CONFIG.times.end);
			if (this.isDiscarded || this.isSOS/* || !this.isOnRoad*/ || !isTime) 
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

		max : function(ctime,proName) 
		{
			var res=0;
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
			//console.warn(state);
			this.addState(state);
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
			
			if (isSOS) {
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
			var result = this.track.rTree.search([pos[0]-rr, pos[1]-rr, pos[0]+rr, pos[1]+rr]);
			if (!result)
				result=[];
			//console.log("FOUND "+result.length+" | "+this.track.route.length+" | "+rr);
			//for (var i=0;i<this.track.route.length-1;i++) {
			for (var _i=0;_i<result.length;_i++)
			{
				var i = result[_i][4].index;
				var res = Utils.interceptOnCircle(tg[i],tg[i+1],pos,rr);
				if (res) 
				{
					// has intersection (2 points)
					var d1 = Utils.distp(res[0],tg[i]);
					var d2 = Utils.distp(res[1],tg[i]);
					var d3 = Utils.distp(tg[i],tg[i+1]);
					var el1 = this.track.distancesElapsed[i]+(this.track.distancesElapsed[i+1]-this.track.distancesElapsed[i])*d1/d3;
					var el2 = this.track.distancesElapsed[i]+(this.track.distancesElapsed[i+1]-this.track.distancesElapsed[i])*d2/d3;
					//console.log("Intersection candidate at "+i+" | "+el1+" | "+el2);
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
			
			/*if (minf == null)
				console.error("MINF NULL ("+result.length+") COEF="+coef);
			else
				console.log(">> MINF "+minf+" ("+minf*this.track.getTrackLength()+" m) COEF="+coef);*/
			
			// ?? OK SKIP DISCARD!!!
			if (minf == null) 
				return;
			
			// minf = overall minimum of elapsed intersections
			if (minf != null) 
				bestm=minf;
			
			//console.log("BESTM FOR PING : "+bestm);
			//-----------------------------------------------------------
			//bestm = _ELAPSED; //(TEST HACK ONLY)
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
			if (typeof GUI != "undefined" && GUI.isDebug && !this.getIsDiscarded()) 
			{
				var feature = new ol.Feature();
				var geom = new ol.geom.Point(state.gps);
				geom.transform('EPSG:4326', 'EPSG:3857');
				feature.color=this.color;
				feature.setGeometry(geom);
				feature.timeCreated=ctime;
				GUI.debugLayerGPS.getSource().addFeature(feature);
			}
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
				rank=this.track.participants.length-this.__pos;
			
			
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
					parseFloat(Math.round(elkm * 100) / 100).toFixed(2)

					if (this.__next && this.getSpeed()) {
						var pel = this.__next.calculateElapsedAverage(ctime);
						var dnext = ((pel-elapsed)*this.track.getTrackLength() / this.getSpeed())/60.0;
						dnext = parseFloat(Math.round(dnext * 100) / 100).toFixed(2);
						html+="<div class='popup_content_l3'>GAP P"+(this.track.participants.length-this.__next.__pos)+" : "+dnext+" Min</div>";
					} else {
						html+="<div class='popup_content_l2'>&nbsp;</div>";
					}
					
					if (this.__prev && this.__prev.getSpeed()) {
						var pel = this.__prev.calculateElapsedAverage(ctime);
						var dprev = ((elapsed-pel)*this.track.getTrackLength() / this.__prev.getSpeed())/60.0;
						dprev = parseFloat(Math.round(dprev * 100) / 100).toFixed(2);
						html+="<div class='popup_content_l2'>GAP P"+(this.track.participants.length-this.__prev.__pos)+" : "+dprev+" Min</div>";
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

},{"./Config":7,"./Point":14,"./Utils":17,"joose":18}],14:[function(require,module,exports){
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
},{"joose":18}],15:[function(require,module,exports){
var CONFIG = require('./Config');

var STYLES=
{
	//------------------------------------------------
	// style function for track
	//------------------------------------------------
	"track" : function(feature,resolution) 
	{
		var styles=[];
		var track=feature.track;
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
				if (track.distances[i] >= track.bikeStartKM*1000)
					break;
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
			if (!geomswim.length)
				geomswim=null;
			if (!geombike.length)
				geombike=null;
			if (!geomrun.length)
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

},{"./Config":7}],16:[function(require,module,exports){
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
		movingCams : {
			is:   "rw",
			init : []
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
				GUI.map.getView().fitExtent(this.feature.getGeometry().getExtent(), GUI.map.getSize());
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
			if (typeof window != "undefined") 
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
			}
		},
		
		newParticipant : function(id,deviceId,name)
		{
			var part = new Participant({id:id,deviceId:deviceId,code:name});
			part.init(this.route[0],this);
			part.setSeqId(this.participants.length);
			this.participants.push(part);
			return part;
		},

		newMovingCam : function(id,deviceId,name,seqId)
		{
			var cam = new MovingCam({id:id,deviceId:deviceId,code:name});
			cam.init(this.route[0],this);
			cam.setSeqId(seqId);
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
		}

    }
});
},{"./Config":7,"./Participant":13,"./Utils":17,"joose":18,"rbush":19}],17:[function(require,module,exports){
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

},{"buffer":1}],18:[function(require,module,exports){
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

},{"_process":5}],19:[function(require,module,exports){
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

},{}]},{},[10])
//# sourceMappingURL=data:application/json;charset:utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL0FwcERhdGEvUm9hbWluZy9ucG0vbm9kZV9tb2R1bGVzL2Jyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2Jyb3dzZXItcGFjay9fcHJlbHVkZS5qcyIsIi4uLy4uL0FwcERhdGEvUm9hbWluZy9ucG0vbm9kZV9tb2R1bGVzL2Jyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2J1ZmZlci9pbmRleC5qcyIsIi4uLy4uL0FwcERhdGEvUm9hbWluZy9ucG0vbm9kZV9tb2R1bGVzL2Jyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2J1ZmZlci9ub2RlX21vZHVsZXMvYmFzZTY0LWpzL2xpYi9iNjQuanMiLCIuLi8uLi9BcHBEYXRhL1JvYW1pbmcvbnBtL25vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9idWZmZXIvbm9kZV9tb2R1bGVzL2llZWU3NTQvaW5kZXguanMiLCIuLi8uLi9BcHBEYXRhL1JvYW1pbmcvbnBtL25vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9idWZmZXIvbm9kZV9tb2R1bGVzL2lzLWFycmF5L2luZGV4LmpzIiwiLi4vLi4vQXBwRGF0YS9Sb2FtaW5nL25wbS9ub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvcHJvY2Vzcy9icm93c2VyLmpzIiwianMvYXBwL0JhY2tlbmRTdHJlYW0uanMiLCJqcy9hcHAvQ29uZmlnLmpzIiwianMvYXBwL0dVSS5qcyIsImpzL2FwcC9Ib3RTcG90LmpzIiwianMvYXBwL0luZGV4LmpzIiwianMvYXBwL0xpdmVTdHJlYW0uanMiLCJqcy9hcHAvTW92aW5nQ2FtLmpzIiwianMvYXBwL1BhcnRpY2lwYW50LmpzIiwianMvYXBwL1BvaW50LmpzIiwianMvYXBwL1N0eWxlcy5qcyIsImpzL2FwcC9UcmFjay5qcyIsImpzL2FwcC9VdGlscy5qcyIsIm5vZGVfbW9kdWxlcy9qb29zZS9qb29zZS1hbGwuanMiLCJub2RlX21vZHVsZXMvcmJ1c2gvcmJ1c2guanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7QUNBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM3NUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDNUhBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BGQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNqQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDMUZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3hFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzdHQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNoaEJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ25EQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDL2FBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzNIQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNaQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDN3JCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN2Q0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM5ZEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7OztBQ2xaQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7OztBQzlqQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7OztBQ2pwR0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EiLCJmaWxlIjoiZ2VuZXJhdGVkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXNDb250ZW50IjpbIihmdW5jdGlvbiBlKHQsbixyKXtmdW5jdGlvbiBzKG8sdSl7aWYoIW5bb10pe2lmKCF0W29dKXt2YXIgYT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2lmKCF1JiZhKXJldHVybiBhKG8sITApO2lmKGkpcmV0dXJuIGkobywhMCk7dmFyIGY9bmV3IEVycm9yKFwiQ2Fubm90IGZpbmQgbW9kdWxlICdcIitvK1wiJ1wiKTt0aHJvdyBmLmNvZGU9XCJNT0RVTEVfTk9UX0ZPVU5EXCIsZn12YXIgbD1uW29dPXtleHBvcnRzOnt9fTt0W29dWzBdLmNhbGwobC5leHBvcnRzLGZ1bmN0aW9uKGUpe3ZhciBuPXRbb11bMV1bZV07cmV0dXJuIHMobj9uOmUpfSxsLGwuZXhwb3J0cyxlLHQsbixyKX1yZXR1cm4gbltvXS5leHBvcnRzfXZhciBpPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7Zm9yKHZhciBvPTA7bzxyLmxlbmd0aDtvKyspcyhyW29dKTtyZXR1cm4gc30pIiwiLyohXG4gKiBUaGUgYnVmZmVyIG1vZHVsZSBmcm9tIG5vZGUuanMsIGZvciB0aGUgYnJvd3Nlci5cbiAqXG4gKiBAYXV0aG9yICAgRmVyb3NzIEFib3VraGFkaWplaCA8ZmVyb3NzQGZlcm9zcy5vcmc+IDxodHRwOi8vZmVyb3NzLm9yZz5cbiAqIEBsaWNlbnNlICBNSVRcbiAqL1xuXG52YXIgYmFzZTY0ID0gcmVxdWlyZSgnYmFzZTY0LWpzJylcbnZhciBpZWVlNzU0ID0gcmVxdWlyZSgnaWVlZTc1NCcpXG52YXIgaXNBcnJheSA9IHJlcXVpcmUoJ2lzLWFycmF5JylcblxuZXhwb3J0cy5CdWZmZXIgPSBCdWZmZXJcbmV4cG9ydHMuU2xvd0J1ZmZlciA9IFNsb3dCdWZmZXJcbmV4cG9ydHMuSU5TUEVDVF9NQVhfQllURVMgPSA1MFxuQnVmZmVyLnBvb2xTaXplID0gODE5MiAvLyBub3QgdXNlZCBieSB0aGlzIGltcGxlbWVudGF0aW9uXG5cbnZhciByb290UGFyZW50ID0ge31cblxuLyoqXG4gKiBJZiBgQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlRgOlxuICogICA9PT0gdHJ1ZSAgICBVc2UgVWludDhBcnJheSBpbXBsZW1lbnRhdGlvbiAoZmFzdGVzdClcbiAqICAgPT09IGZhbHNlICAgVXNlIE9iamVjdCBpbXBsZW1lbnRhdGlvbiAobW9zdCBjb21wYXRpYmxlLCBldmVuIElFNilcbiAqXG4gKiBCcm93c2VycyB0aGF0IHN1cHBvcnQgdHlwZWQgYXJyYXlzIGFyZSBJRSAxMCssIEZpcmVmb3ggNCssIENocm9tZSA3KywgU2FmYXJpIDUuMSssXG4gKiBPcGVyYSAxMS42KywgaU9TIDQuMisuXG4gKlxuICogTm90ZTpcbiAqXG4gKiAtIEltcGxlbWVudGF0aW9uIG11c3Qgc3VwcG9ydCBhZGRpbmcgbmV3IHByb3BlcnRpZXMgdG8gYFVpbnQ4QXJyYXlgIGluc3RhbmNlcy5cbiAqICAgRmlyZWZveCA0LTI5IGxhY2tlZCBzdXBwb3J0LCBmaXhlZCBpbiBGaXJlZm94IDMwKy5cbiAqICAgU2VlOiBodHRwczovL2J1Z3ppbGxhLm1vemlsbGEub3JnL3Nob3dfYnVnLmNnaT9pZD02OTU0MzguXG4gKlxuICogIC0gQ2hyb21lIDktMTAgaXMgbWlzc2luZyB0aGUgYFR5cGVkQXJyYXkucHJvdG90eXBlLnN1YmFycmF5YCBmdW5jdGlvbi5cbiAqXG4gKiAgLSBJRTEwIGhhcyBhIGJyb2tlbiBgVHlwZWRBcnJheS5wcm90b3R5cGUuc3ViYXJyYXlgIGZ1bmN0aW9uIHdoaWNoIHJldHVybnMgYXJyYXlzIG9mXG4gKiAgICBpbmNvcnJlY3QgbGVuZ3RoIGluIHNvbWUgc2l0dWF0aW9ucy5cbiAqXG4gKiBXZSBkZXRlY3QgdGhlc2UgYnVnZ3kgYnJvd3NlcnMgYW5kIHNldCBgQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlRgIHRvIGBmYWxzZWAgc28gdGhleSB3aWxsXG4gKiBnZXQgdGhlIE9iamVjdCBpbXBsZW1lbnRhdGlvbiwgd2hpY2ggaXMgc2xvd2VyIGJ1dCB3aWxsIHdvcmsgY29ycmVjdGx5LlxuICovXG5CdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCA9IChmdW5jdGlvbiAoKSB7XG4gIGZ1bmN0aW9uIEZvbyAoKSB7fVxuICB0cnkge1xuICAgIHZhciBidWYgPSBuZXcgQXJyYXlCdWZmZXIoMClcbiAgICB2YXIgYXJyID0gbmV3IFVpbnQ4QXJyYXkoYnVmKVxuICAgIGFyci5mb28gPSBmdW5jdGlvbiAoKSB7IHJldHVybiA0MiB9XG4gICAgYXJyLmNvbnN0cnVjdG9yID0gRm9vXG4gICAgcmV0dXJuIGFyci5mb28oKSA9PT0gNDIgJiYgLy8gdHlwZWQgYXJyYXkgaW5zdGFuY2VzIGNhbiBiZSBhdWdtZW50ZWRcbiAgICAgICAgYXJyLmNvbnN0cnVjdG9yID09PSBGb28gJiYgLy8gY29uc3RydWN0b3IgY2FuIGJlIHNldFxuICAgICAgICB0eXBlb2YgYXJyLnN1YmFycmF5ID09PSAnZnVuY3Rpb24nICYmIC8vIGNocm9tZSA5LTEwIGxhY2sgYHN1YmFycmF5YFxuICAgICAgICBuZXcgVWludDhBcnJheSgxKS5zdWJhcnJheSgxLCAxKS5ieXRlTGVuZ3RoID09PSAwIC8vIGllMTAgaGFzIGJyb2tlbiBgc3ViYXJyYXlgXG4gIH0gY2F0Y2ggKGUpIHtcbiAgICByZXR1cm4gZmFsc2VcbiAgfVxufSkoKVxuXG5mdW5jdGlvbiBrTWF4TGVuZ3RoICgpIHtcbiAgcmV0dXJuIEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUXG4gICAgPyAweDdmZmZmZmZmXG4gICAgOiAweDNmZmZmZmZmXG59XG5cbi8qKlxuICogQ2xhc3M6IEJ1ZmZlclxuICogPT09PT09PT09PT09PVxuICpcbiAqIFRoZSBCdWZmZXIgY29uc3RydWN0b3IgcmV0dXJucyBpbnN0YW5jZXMgb2YgYFVpbnQ4QXJyYXlgIHRoYXQgYXJlIGF1Z21lbnRlZFxuICogd2l0aCBmdW5jdGlvbiBwcm9wZXJ0aWVzIGZvciBhbGwgdGhlIG5vZGUgYEJ1ZmZlcmAgQVBJIGZ1bmN0aW9ucy4gV2UgdXNlXG4gKiBgVWludDhBcnJheWAgc28gdGhhdCBzcXVhcmUgYnJhY2tldCBub3RhdGlvbiB3b3JrcyBhcyBleHBlY3RlZCAtLSBpdCByZXR1cm5zXG4gKiBhIHNpbmdsZSBvY3RldC5cbiAqXG4gKiBCeSBhdWdtZW50aW5nIHRoZSBpbnN0YW5jZXMsIHdlIGNhbiBhdm9pZCBtb2RpZnlpbmcgdGhlIGBVaW50OEFycmF5YFxuICogcHJvdG90eXBlLlxuICovXG5mdW5jdGlvbiBCdWZmZXIgKGFyZykge1xuICBpZiAoISh0aGlzIGluc3RhbmNlb2YgQnVmZmVyKSkge1xuICAgIC8vIEF2b2lkIGdvaW5nIHRocm91Z2ggYW4gQXJndW1lbnRzQWRhcHRvclRyYW1wb2xpbmUgaW4gdGhlIGNvbW1vbiBjYXNlLlxuICAgIGlmIChhcmd1bWVudHMubGVuZ3RoID4gMSkgcmV0dXJuIG5ldyBCdWZmZXIoYXJnLCBhcmd1bWVudHNbMV0pXG4gICAgcmV0dXJuIG5ldyBCdWZmZXIoYXJnKVxuICB9XG5cbiAgdGhpcy5sZW5ndGggPSAwXG4gIHRoaXMucGFyZW50ID0gdW5kZWZpbmVkXG5cbiAgLy8gQ29tbW9uIGNhc2UuXG4gIGlmICh0eXBlb2YgYXJnID09PSAnbnVtYmVyJykge1xuICAgIHJldHVybiBmcm9tTnVtYmVyKHRoaXMsIGFyZylcbiAgfVxuXG4gIC8vIFNsaWdodGx5IGxlc3MgY29tbW9uIGNhc2UuXG4gIGlmICh0eXBlb2YgYXJnID09PSAnc3RyaW5nJykge1xuICAgIHJldHVybiBmcm9tU3RyaW5nKHRoaXMsIGFyZywgYXJndW1lbnRzLmxlbmd0aCA+IDEgPyBhcmd1bWVudHNbMV0gOiAndXRmOCcpXG4gIH1cblxuICAvLyBVbnVzdWFsLlxuICByZXR1cm4gZnJvbU9iamVjdCh0aGlzLCBhcmcpXG59XG5cbmZ1bmN0aW9uIGZyb21OdW1iZXIgKHRoYXQsIGxlbmd0aCkge1xuICB0aGF0ID0gYWxsb2NhdGUodGhhdCwgbGVuZ3RoIDwgMCA/IDAgOiBjaGVja2VkKGxlbmd0aCkgfCAwKVxuICBpZiAoIUJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW5ndGg7IGkrKykge1xuICAgICAgdGhhdFtpXSA9IDBcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHRoYXRcbn1cblxuZnVuY3Rpb24gZnJvbVN0cmluZyAodGhhdCwgc3RyaW5nLCBlbmNvZGluZykge1xuICBpZiAodHlwZW9mIGVuY29kaW5nICE9PSAnc3RyaW5nJyB8fCBlbmNvZGluZyA9PT0gJycpIGVuY29kaW5nID0gJ3V0ZjgnXG5cbiAgLy8gQXNzdW1wdGlvbjogYnl0ZUxlbmd0aCgpIHJldHVybiB2YWx1ZSBpcyBhbHdheXMgPCBrTWF4TGVuZ3RoLlxuICB2YXIgbGVuZ3RoID0gYnl0ZUxlbmd0aChzdHJpbmcsIGVuY29kaW5nKSB8IDBcbiAgdGhhdCA9IGFsbG9jYXRlKHRoYXQsIGxlbmd0aClcblxuICB0aGF0LndyaXRlKHN0cmluZywgZW5jb2RpbmcpXG4gIHJldHVybiB0aGF0XG59XG5cbmZ1bmN0aW9uIGZyb21PYmplY3QgKHRoYXQsIG9iamVjdCkge1xuICBpZiAoQnVmZmVyLmlzQnVmZmVyKG9iamVjdCkpIHJldHVybiBmcm9tQnVmZmVyKHRoYXQsIG9iamVjdClcblxuICBpZiAoaXNBcnJheShvYmplY3QpKSByZXR1cm4gZnJvbUFycmF5KHRoYXQsIG9iamVjdClcblxuICBpZiAob2JqZWN0ID09IG51bGwpIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdtdXN0IHN0YXJ0IHdpdGggbnVtYmVyLCBidWZmZXIsIGFycmF5IG9yIHN0cmluZycpXG4gIH1cblxuICBpZiAodHlwZW9mIEFycmF5QnVmZmVyICE9PSAndW5kZWZpbmVkJyAmJiBvYmplY3QuYnVmZmVyIGluc3RhbmNlb2YgQXJyYXlCdWZmZXIpIHtcbiAgICByZXR1cm4gZnJvbVR5cGVkQXJyYXkodGhhdCwgb2JqZWN0KVxuICB9XG5cbiAgaWYgKG9iamVjdC5sZW5ndGgpIHJldHVybiBmcm9tQXJyYXlMaWtlKHRoYXQsIG9iamVjdClcblxuICByZXR1cm4gZnJvbUpzb25PYmplY3QodGhhdCwgb2JqZWN0KVxufVxuXG5mdW5jdGlvbiBmcm9tQnVmZmVyICh0aGF0LCBidWZmZXIpIHtcbiAgdmFyIGxlbmd0aCA9IGNoZWNrZWQoYnVmZmVyLmxlbmd0aCkgfCAwXG4gIHRoYXQgPSBhbGxvY2F0ZSh0aGF0LCBsZW5ndGgpXG4gIGJ1ZmZlci5jb3B5KHRoYXQsIDAsIDAsIGxlbmd0aClcbiAgcmV0dXJuIHRoYXRcbn1cblxuZnVuY3Rpb24gZnJvbUFycmF5ICh0aGF0LCBhcnJheSkge1xuICB2YXIgbGVuZ3RoID0gY2hlY2tlZChhcnJheS5sZW5ndGgpIHwgMFxuICB0aGF0ID0gYWxsb2NhdGUodGhhdCwgbGVuZ3RoKVxuICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbmd0aDsgaSArPSAxKSB7XG4gICAgdGhhdFtpXSA9IGFycmF5W2ldICYgMjU1XG4gIH1cbiAgcmV0dXJuIHRoYXRcbn1cblxuLy8gRHVwbGljYXRlIG9mIGZyb21BcnJheSgpIHRvIGtlZXAgZnJvbUFycmF5KCkgbW9ub21vcnBoaWMuXG5mdW5jdGlvbiBmcm9tVHlwZWRBcnJheSAodGhhdCwgYXJyYXkpIHtcbiAgdmFyIGxlbmd0aCA9IGNoZWNrZWQoYXJyYXkubGVuZ3RoKSB8IDBcbiAgdGhhdCA9IGFsbG9jYXRlKHRoYXQsIGxlbmd0aClcbiAgLy8gVHJ1bmNhdGluZyB0aGUgZWxlbWVudHMgaXMgcHJvYmFibHkgbm90IHdoYXQgcGVvcGxlIGV4cGVjdCBmcm9tIHR5cGVkXG4gIC8vIGFycmF5cyB3aXRoIEJZVEVTX1BFUl9FTEVNRU5UID4gMSBidXQgaXQncyBjb21wYXRpYmxlIHdpdGggdGhlIGJlaGF2aW9yXG4gIC8vIG9mIHRoZSBvbGQgQnVmZmVyIGNvbnN0cnVjdG9yLlxuICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbmd0aDsgaSArPSAxKSB7XG4gICAgdGhhdFtpXSA9IGFycmF5W2ldICYgMjU1XG4gIH1cbiAgcmV0dXJuIHRoYXRcbn1cblxuZnVuY3Rpb24gZnJvbUFycmF5TGlrZSAodGhhdCwgYXJyYXkpIHtcbiAgdmFyIGxlbmd0aCA9IGNoZWNrZWQoYXJyYXkubGVuZ3RoKSB8IDBcbiAgdGhhdCA9IGFsbG9jYXRlKHRoYXQsIGxlbmd0aClcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW5ndGg7IGkgKz0gMSkge1xuICAgIHRoYXRbaV0gPSBhcnJheVtpXSAmIDI1NVxuICB9XG4gIHJldHVybiB0aGF0XG59XG5cbi8vIERlc2VyaWFsaXplIHsgdHlwZTogJ0J1ZmZlcicsIGRhdGE6IFsxLDIsMywuLi5dIH0gaW50byBhIEJ1ZmZlciBvYmplY3QuXG4vLyBSZXR1cm5zIGEgemVyby1sZW5ndGggYnVmZmVyIGZvciBpbnB1dHMgdGhhdCBkb24ndCBjb25mb3JtIHRvIHRoZSBzcGVjLlxuZnVuY3Rpb24gZnJvbUpzb25PYmplY3QgKHRoYXQsIG9iamVjdCkge1xuICB2YXIgYXJyYXlcbiAgdmFyIGxlbmd0aCA9IDBcblxuICBpZiAob2JqZWN0LnR5cGUgPT09ICdCdWZmZXInICYmIGlzQXJyYXkob2JqZWN0LmRhdGEpKSB7XG4gICAgYXJyYXkgPSBvYmplY3QuZGF0YVxuICAgIGxlbmd0aCA9IGNoZWNrZWQoYXJyYXkubGVuZ3RoKSB8IDBcbiAgfVxuICB0aGF0ID0gYWxsb2NhdGUodGhhdCwgbGVuZ3RoKVxuXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuZ3RoOyBpICs9IDEpIHtcbiAgICB0aGF0W2ldID0gYXJyYXlbaV0gJiAyNTVcbiAgfVxuICByZXR1cm4gdGhhdFxufVxuXG5mdW5jdGlvbiBhbGxvY2F0ZSAodGhhdCwgbGVuZ3RoKSB7XG4gIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIC8vIFJldHVybiBhbiBhdWdtZW50ZWQgYFVpbnQ4QXJyYXlgIGluc3RhbmNlLCBmb3IgYmVzdCBwZXJmb3JtYW5jZVxuICAgIHRoYXQgPSBCdWZmZXIuX2F1Z21lbnQobmV3IFVpbnQ4QXJyYXkobGVuZ3RoKSlcbiAgfSBlbHNlIHtcbiAgICAvLyBGYWxsYmFjazogUmV0dXJuIGFuIG9iamVjdCBpbnN0YW5jZSBvZiB0aGUgQnVmZmVyIGNsYXNzXG4gICAgdGhhdC5sZW5ndGggPSBsZW5ndGhcbiAgICB0aGF0Ll9pc0J1ZmZlciA9IHRydWVcbiAgfVxuXG4gIHZhciBmcm9tUG9vbCA9IGxlbmd0aCAhPT0gMCAmJiBsZW5ndGggPD0gQnVmZmVyLnBvb2xTaXplID4+PiAxXG4gIGlmIChmcm9tUG9vbCkgdGhhdC5wYXJlbnQgPSByb290UGFyZW50XG5cbiAgcmV0dXJuIHRoYXRcbn1cblxuZnVuY3Rpb24gY2hlY2tlZCAobGVuZ3RoKSB7XG4gIC8vIE5vdGU6IGNhbm5vdCB1c2UgYGxlbmd0aCA8IGtNYXhMZW5ndGhgIGhlcmUgYmVjYXVzZSB0aGF0IGZhaWxzIHdoZW5cbiAgLy8gbGVuZ3RoIGlzIE5hTiAod2hpY2ggaXMgb3RoZXJ3aXNlIGNvZXJjZWQgdG8gemVyby4pXG4gIGlmIChsZW5ndGggPj0ga01heExlbmd0aCgpKSB7XG4gICAgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ0F0dGVtcHQgdG8gYWxsb2NhdGUgQnVmZmVyIGxhcmdlciB0aGFuIG1heGltdW0gJyArXG4gICAgICAgICAgICAgICAgICAgICAgICAgJ3NpemU6IDB4JyArIGtNYXhMZW5ndGgoKS50b1N0cmluZygxNikgKyAnIGJ5dGVzJylcbiAgfVxuICByZXR1cm4gbGVuZ3RoIHwgMFxufVxuXG5mdW5jdGlvbiBTbG93QnVmZmVyIChzdWJqZWN0LCBlbmNvZGluZykge1xuICBpZiAoISh0aGlzIGluc3RhbmNlb2YgU2xvd0J1ZmZlcikpIHJldHVybiBuZXcgU2xvd0J1ZmZlcihzdWJqZWN0LCBlbmNvZGluZylcblxuICB2YXIgYnVmID0gbmV3IEJ1ZmZlcihzdWJqZWN0LCBlbmNvZGluZylcbiAgZGVsZXRlIGJ1Zi5wYXJlbnRcbiAgcmV0dXJuIGJ1ZlxufVxuXG5CdWZmZXIuaXNCdWZmZXIgPSBmdW5jdGlvbiBpc0J1ZmZlciAoYikge1xuICByZXR1cm4gISEoYiAhPSBudWxsICYmIGIuX2lzQnVmZmVyKVxufVxuXG5CdWZmZXIuY29tcGFyZSA9IGZ1bmN0aW9uIGNvbXBhcmUgKGEsIGIpIHtcbiAgaWYgKCFCdWZmZXIuaXNCdWZmZXIoYSkgfHwgIUJ1ZmZlci5pc0J1ZmZlcihiKSkge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ0FyZ3VtZW50cyBtdXN0IGJlIEJ1ZmZlcnMnKVxuICB9XG5cbiAgaWYgKGEgPT09IGIpIHJldHVybiAwXG5cbiAgdmFyIHggPSBhLmxlbmd0aFxuICB2YXIgeSA9IGIubGVuZ3RoXG5cbiAgdmFyIGkgPSAwXG4gIHZhciBsZW4gPSBNYXRoLm1pbih4LCB5KVxuICB3aGlsZSAoaSA8IGxlbikge1xuICAgIGlmIChhW2ldICE9PSBiW2ldKSBicmVha1xuXG4gICAgKytpXG4gIH1cblxuICBpZiAoaSAhPT0gbGVuKSB7XG4gICAgeCA9IGFbaV1cbiAgICB5ID0gYltpXVxuICB9XG5cbiAgaWYgKHggPCB5KSByZXR1cm4gLTFcbiAgaWYgKHkgPCB4KSByZXR1cm4gMVxuICByZXR1cm4gMFxufVxuXG5CdWZmZXIuaXNFbmNvZGluZyA9IGZ1bmN0aW9uIGlzRW5jb2RpbmcgKGVuY29kaW5nKSB7XG4gIHN3aXRjaCAoU3RyaW5nKGVuY29kaW5nKS50b0xvd2VyQ2FzZSgpKSB7XG4gICAgY2FzZSAnaGV4JzpcbiAgICBjYXNlICd1dGY4JzpcbiAgICBjYXNlICd1dGYtOCc6XG4gICAgY2FzZSAnYXNjaWknOlxuICAgIGNhc2UgJ2JpbmFyeSc6XG4gICAgY2FzZSAnYmFzZTY0JzpcbiAgICBjYXNlICdyYXcnOlxuICAgIGNhc2UgJ3VjczInOlxuICAgIGNhc2UgJ3Vjcy0yJzpcbiAgICBjYXNlICd1dGYxNmxlJzpcbiAgICBjYXNlICd1dGYtMTZsZSc6XG4gICAgICByZXR1cm4gdHJ1ZVxuICAgIGRlZmF1bHQ6XG4gICAgICByZXR1cm4gZmFsc2VcbiAgfVxufVxuXG5CdWZmZXIuY29uY2F0ID0gZnVuY3Rpb24gY29uY2F0IChsaXN0LCBsZW5ndGgpIHtcbiAgaWYgKCFpc0FycmF5KGxpc3QpKSB0aHJvdyBuZXcgVHlwZUVycm9yKCdsaXN0IGFyZ3VtZW50IG11c3QgYmUgYW4gQXJyYXkgb2YgQnVmZmVycy4nKVxuXG4gIGlmIChsaXN0Lmxlbmd0aCA9PT0gMCkge1xuICAgIHJldHVybiBuZXcgQnVmZmVyKDApXG4gIH0gZWxzZSBpZiAobGlzdC5sZW5ndGggPT09IDEpIHtcbiAgICByZXR1cm4gbGlzdFswXVxuICB9XG5cbiAgdmFyIGlcbiAgaWYgKGxlbmd0aCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgbGVuZ3RoID0gMFxuICAgIGZvciAoaSA9IDA7IGkgPCBsaXN0Lmxlbmd0aDsgaSsrKSB7XG4gICAgICBsZW5ndGggKz0gbGlzdFtpXS5sZW5ndGhcbiAgICB9XG4gIH1cblxuICB2YXIgYnVmID0gbmV3IEJ1ZmZlcihsZW5ndGgpXG4gIHZhciBwb3MgPSAwXG4gIGZvciAoaSA9IDA7IGkgPCBsaXN0Lmxlbmd0aDsgaSsrKSB7XG4gICAgdmFyIGl0ZW0gPSBsaXN0W2ldXG4gICAgaXRlbS5jb3B5KGJ1ZiwgcG9zKVxuICAgIHBvcyArPSBpdGVtLmxlbmd0aFxuICB9XG4gIHJldHVybiBidWZcbn1cblxuZnVuY3Rpb24gYnl0ZUxlbmd0aCAoc3RyaW5nLCBlbmNvZGluZykge1xuICBpZiAodHlwZW9mIHN0cmluZyAhPT0gJ3N0cmluZycpIHN0cmluZyA9ICcnICsgc3RyaW5nXG5cbiAgdmFyIGxlbiA9IHN0cmluZy5sZW5ndGhcbiAgaWYgKGxlbiA9PT0gMCkgcmV0dXJuIDBcblxuICAvLyBVc2UgYSBmb3IgbG9vcCB0byBhdm9pZCByZWN1cnNpb25cbiAgdmFyIGxvd2VyZWRDYXNlID0gZmFsc2VcbiAgZm9yICg7Oykge1xuICAgIHN3aXRjaCAoZW5jb2RpbmcpIHtcbiAgICAgIGNhc2UgJ2FzY2lpJzpcbiAgICAgIGNhc2UgJ2JpbmFyeSc6XG4gICAgICAvLyBEZXByZWNhdGVkXG4gICAgICBjYXNlICdyYXcnOlxuICAgICAgY2FzZSAncmF3cyc6XG4gICAgICAgIHJldHVybiBsZW5cbiAgICAgIGNhc2UgJ3V0ZjgnOlxuICAgICAgY2FzZSAndXRmLTgnOlxuICAgICAgICByZXR1cm4gdXRmOFRvQnl0ZXMoc3RyaW5nKS5sZW5ndGhcbiAgICAgIGNhc2UgJ3VjczInOlxuICAgICAgY2FzZSAndWNzLTInOlxuICAgICAgY2FzZSAndXRmMTZsZSc6XG4gICAgICBjYXNlICd1dGYtMTZsZSc6XG4gICAgICAgIHJldHVybiBsZW4gKiAyXG4gICAgICBjYXNlICdoZXgnOlxuICAgICAgICByZXR1cm4gbGVuID4+PiAxXG4gICAgICBjYXNlICdiYXNlNjQnOlxuICAgICAgICByZXR1cm4gYmFzZTY0VG9CeXRlcyhzdHJpbmcpLmxlbmd0aFxuICAgICAgZGVmYXVsdDpcbiAgICAgICAgaWYgKGxvd2VyZWRDYXNlKSByZXR1cm4gdXRmOFRvQnl0ZXMoc3RyaW5nKS5sZW5ndGggLy8gYXNzdW1lIHV0ZjhcbiAgICAgICAgZW5jb2RpbmcgPSAoJycgKyBlbmNvZGluZykudG9Mb3dlckNhc2UoKVxuICAgICAgICBsb3dlcmVkQ2FzZSA9IHRydWVcbiAgICB9XG4gIH1cbn1cbkJ1ZmZlci5ieXRlTGVuZ3RoID0gYnl0ZUxlbmd0aFxuXG4vLyBwcmUtc2V0IGZvciB2YWx1ZXMgdGhhdCBtYXkgZXhpc3QgaW4gdGhlIGZ1dHVyZVxuQnVmZmVyLnByb3RvdHlwZS5sZW5ndGggPSB1bmRlZmluZWRcbkJ1ZmZlci5wcm90b3R5cGUucGFyZW50ID0gdW5kZWZpbmVkXG5cbmZ1bmN0aW9uIHNsb3dUb1N0cmluZyAoZW5jb2RpbmcsIHN0YXJ0LCBlbmQpIHtcbiAgdmFyIGxvd2VyZWRDYXNlID0gZmFsc2VcblxuICBzdGFydCA9IHN0YXJ0IHwgMFxuICBlbmQgPSBlbmQgPT09IHVuZGVmaW5lZCB8fCBlbmQgPT09IEluZmluaXR5ID8gdGhpcy5sZW5ndGggOiBlbmQgfCAwXG5cbiAgaWYgKCFlbmNvZGluZykgZW5jb2RpbmcgPSAndXRmOCdcbiAgaWYgKHN0YXJ0IDwgMCkgc3RhcnQgPSAwXG4gIGlmIChlbmQgPiB0aGlzLmxlbmd0aCkgZW5kID0gdGhpcy5sZW5ndGhcbiAgaWYgKGVuZCA8PSBzdGFydCkgcmV0dXJuICcnXG5cbiAgd2hpbGUgKHRydWUpIHtcbiAgICBzd2l0Y2ggKGVuY29kaW5nKSB7XG4gICAgICBjYXNlICdoZXgnOlxuICAgICAgICByZXR1cm4gaGV4U2xpY2UodGhpcywgc3RhcnQsIGVuZClcblxuICAgICAgY2FzZSAndXRmOCc6XG4gICAgICBjYXNlICd1dGYtOCc6XG4gICAgICAgIHJldHVybiB1dGY4U2xpY2UodGhpcywgc3RhcnQsIGVuZClcblxuICAgICAgY2FzZSAnYXNjaWknOlxuICAgICAgICByZXR1cm4gYXNjaWlTbGljZSh0aGlzLCBzdGFydCwgZW5kKVxuXG4gICAgICBjYXNlICdiaW5hcnknOlxuICAgICAgICByZXR1cm4gYmluYXJ5U2xpY2UodGhpcywgc3RhcnQsIGVuZClcblxuICAgICAgY2FzZSAnYmFzZTY0JzpcbiAgICAgICAgcmV0dXJuIGJhc2U2NFNsaWNlKHRoaXMsIHN0YXJ0LCBlbmQpXG5cbiAgICAgIGNhc2UgJ3VjczInOlxuICAgICAgY2FzZSAndWNzLTInOlxuICAgICAgY2FzZSAndXRmMTZsZSc6XG4gICAgICBjYXNlICd1dGYtMTZsZSc6XG4gICAgICAgIHJldHVybiB1dGYxNmxlU2xpY2UodGhpcywgc3RhcnQsIGVuZClcblxuICAgICAgZGVmYXVsdDpcbiAgICAgICAgaWYgKGxvd2VyZWRDYXNlKSB0aHJvdyBuZXcgVHlwZUVycm9yKCdVbmtub3duIGVuY29kaW5nOiAnICsgZW5jb2RpbmcpXG4gICAgICAgIGVuY29kaW5nID0gKGVuY29kaW5nICsgJycpLnRvTG93ZXJDYXNlKClcbiAgICAgICAgbG93ZXJlZENhc2UgPSB0cnVlXG4gICAgfVxuICB9XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUudG9TdHJpbmcgPSBmdW5jdGlvbiB0b1N0cmluZyAoKSB7XG4gIHZhciBsZW5ndGggPSB0aGlzLmxlbmd0aCB8IDBcbiAgaWYgKGxlbmd0aCA9PT0gMCkgcmV0dXJuICcnXG4gIGlmIChhcmd1bWVudHMubGVuZ3RoID09PSAwKSByZXR1cm4gdXRmOFNsaWNlKHRoaXMsIDAsIGxlbmd0aClcbiAgcmV0dXJuIHNsb3dUb1N0cmluZy5hcHBseSh0aGlzLCBhcmd1bWVudHMpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUuZXF1YWxzID0gZnVuY3Rpb24gZXF1YWxzIChiKSB7XG4gIGlmICghQnVmZmVyLmlzQnVmZmVyKGIpKSB0aHJvdyBuZXcgVHlwZUVycm9yKCdBcmd1bWVudCBtdXN0IGJlIGEgQnVmZmVyJylcbiAgaWYgKHRoaXMgPT09IGIpIHJldHVybiB0cnVlXG4gIHJldHVybiBCdWZmZXIuY29tcGFyZSh0aGlzLCBiKSA9PT0gMFxufVxuXG5CdWZmZXIucHJvdG90eXBlLmluc3BlY3QgPSBmdW5jdGlvbiBpbnNwZWN0ICgpIHtcbiAgdmFyIHN0ciA9ICcnXG4gIHZhciBtYXggPSBleHBvcnRzLklOU1BFQ1RfTUFYX0JZVEVTXG4gIGlmICh0aGlzLmxlbmd0aCA+IDApIHtcbiAgICBzdHIgPSB0aGlzLnRvU3RyaW5nKCdoZXgnLCAwLCBtYXgpLm1hdGNoKC8uezJ9L2cpLmpvaW4oJyAnKVxuICAgIGlmICh0aGlzLmxlbmd0aCA+IG1heCkgc3RyICs9ICcgLi4uICdcbiAgfVxuICByZXR1cm4gJzxCdWZmZXIgJyArIHN0ciArICc+J1xufVxuXG5CdWZmZXIucHJvdG90eXBlLmNvbXBhcmUgPSBmdW5jdGlvbiBjb21wYXJlIChiKSB7XG4gIGlmICghQnVmZmVyLmlzQnVmZmVyKGIpKSB0aHJvdyBuZXcgVHlwZUVycm9yKCdBcmd1bWVudCBtdXN0IGJlIGEgQnVmZmVyJylcbiAgaWYgKHRoaXMgPT09IGIpIHJldHVybiAwXG4gIHJldHVybiBCdWZmZXIuY29tcGFyZSh0aGlzLCBiKVxufVxuXG5CdWZmZXIucHJvdG90eXBlLmluZGV4T2YgPSBmdW5jdGlvbiBpbmRleE9mICh2YWwsIGJ5dGVPZmZzZXQpIHtcbiAgaWYgKGJ5dGVPZmZzZXQgPiAweDdmZmZmZmZmKSBieXRlT2Zmc2V0ID0gMHg3ZmZmZmZmZlxuICBlbHNlIGlmIChieXRlT2Zmc2V0IDwgLTB4ODAwMDAwMDApIGJ5dGVPZmZzZXQgPSAtMHg4MDAwMDAwMFxuICBieXRlT2Zmc2V0ID4+PSAwXG5cbiAgaWYgKHRoaXMubGVuZ3RoID09PSAwKSByZXR1cm4gLTFcbiAgaWYgKGJ5dGVPZmZzZXQgPj0gdGhpcy5sZW5ndGgpIHJldHVybiAtMVxuXG4gIC8vIE5lZ2F0aXZlIG9mZnNldHMgc3RhcnQgZnJvbSB0aGUgZW5kIG9mIHRoZSBidWZmZXJcbiAgaWYgKGJ5dGVPZmZzZXQgPCAwKSBieXRlT2Zmc2V0ID0gTWF0aC5tYXgodGhpcy5sZW5ndGggKyBieXRlT2Zmc2V0LCAwKVxuXG4gIGlmICh0eXBlb2YgdmFsID09PSAnc3RyaW5nJykge1xuICAgIGlmICh2YWwubGVuZ3RoID09PSAwKSByZXR1cm4gLTEgLy8gc3BlY2lhbCBjYXNlOiBsb29raW5nIGZvciBlbXB0eSBzdHJpbmcgYWx3YXlzIGZhaWxzXG4gICAgcmV0dXJuIFN0cmluZy5wcm90b3R5cGUuaW5kZXhPZi5jYWxsKHRoaXMsIHZhbCwgYnl0ZU9mZnNldClcbiAgfVxuICBpZiAoQnVmZmVyLmlzQnVmZmVyKHZhbCkpIHtcbiAgICByZXR1cm4gYXJyYXlJbmRleE9mKHRoaXMsIHZhbCwgYnl0ZU9mZnNldClcbiAgfVxuICBpZiAodHlwZW9mIHZhbCA9PT0gJ251bWJlcicpIHtcbiAgICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQgJiYgVWludDhBcnJheS5wcm90b3R5cGUuaW5kZXhPZiA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgcmV0dXJuIFVpbnQ4QXJyYXkucHJvdG90eXBlLmluZGV4T2YuY2FsbCh0aGlzLCB2YWwsIGJ5dGVPZmZzZXQpXG4gICAgfVxuICAgIHJldHVybiBhcnJheUluZGV4T2YodGhpcywgWyB2YWwgXSwgYnl0ZU9mZnNldClcbiAgfVxuXG4gIGZ1bmN0aW9uIGFycmF5SW5kZXhPZiAoYXJyLCB2YWwsIGJ5dGVPZmZzZXQpIHtcbiAgICB2YXIgZm91bmRJbmRleCA9IC0xXG4gICAgZm9yICh2YXIgaSA9IDA7IGJ5dGVPZmZzZXQgKyBpIDwgYXJyLmxlbmd0aDsgaSsrKSB7XG4gICAgICBpZiAoYXJyW2J5dGVPZmZzZXQgKyBpXSA9PT0gdmFsW2ZvdW5kSW5kZXggPT09IC0xID8gMCA6IGkgLSBmb3VuZEluZGV4XSkge1xuICAgICAgICBpZiAoZm91bmRJbmRleCA9PT0gLTEpIGZvdW5kSW5kZXggPSBpXG4gICAgICAgIGlmIChpIC0gZm91bmRJbmRleCArIDEgPT09IHZhbC5sZW5ndGgpIHJldHVybiBieXRlT2Zmc2V0ICsgZm91bmRJbmRleFxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgZm91bmRJbmRleCA9IC0xXG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiAtMVxuICB9XG5cbiAgdGhyb3cgbmV3IFR5cGVFcnJvcigndmFsIG11c3QgYmUgc3RyaW5nLCBudW1iZXIgb3IgQnVmZmVyJylcbn1cblxuLy8gYGdldGAgd2lsbCBiZSByZW1vdmVkIGluIE5vZGUgMC4xMytcbkJ1ZmZlci5wcm90b3R5cGUuZ2V0ID0gZnVuY3Rpb24gZ2V0IChvZmZzZXQpIHtcbiAgY29uc29sZS5sb2coJy5nZXQoKSBpcyBkZXByZWNhdGVkLiBBY2Nlc3MgdXNpbmcgYXJyYXkgaW5kZXhlcyBpbnN0ZWFkLicpXG4gIHJldHVybiB0aGlzLnJlYWRVSW50OChvZmZzZXQpXG59XG5cbi8vIGBzZXRgIHdpbGwgYmUgcmVtb3ZlZCBpbiBOb2RlIDAuMTMrXG5CdWZmZXIucHJvdG90eXBlLnNldCA9IGZ1bmN0aW9uIHNldCAodiwgb2Zmc2V0KSB7XG4gIGNvbnNvbGUubG9nKCcuc2V0KCkgaXMgZGVwcmVjYXRlZC4gQWNjZXNzIHVzaW5nIGFycmF5IGluZGV4ZXMgaW5zdGVhZC4nKVxuICByZXR1cm4gdGhpcy53cml0ZVVJbnQ4KHYsIG9mZnNldClcbn1cblxuZnVuY3Rpb24gaGV4V3JpdGUgKGJ1Ziwgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCkge1xuICBvZmZzZXQgPSBOdW1iZXIob2Zmc2V0KSB8fCAwXG4gIHZhciByZW1haW5pbmcgPSBidWYubGVuZ3RoIC0gb2Zmc2V0XG4gIGlmICghbGVuZ3RoKSB7XG4gICAgbGVuZ3RoID0gcmVtYWluaW5nXG4gIH0gZWxzZSB7XG4gICAgbGVuZ3RoID0gTnVtYmVyKGxlbmd0aClcbiAgICBpZiAobGVuZ3RoID4gcmVtYWluaW5nKSB7XG4gICAgICBsZW5ndGggPSByZW1haW5pbmdcbiAgICB9XG4gIH1cblxuICAvLyBtdXN0IGJlIGFuIGV2ZW4gbnVtYmVyIG9mIGRpZ2l0c1xuICB2YXIgc3RyTGVuID0gc3RyaW5nLmxlbmd0aFxuICBpZiAoc3RyTGVuICUgMiAhPT0gMCkgdGhyb3cgbmV3IEVycm9yKCdJbnZhbGlkIGhleCBzdHJpbmcnKVxuXG4gIGlmIChsZW5ndGggPiBzdHJMZW4gLyAyKSB7XG4gICAgbGVuZ3RoID0gc3RyTGVuIC8gMlxuICB9XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuZ3RoOyBpKyspIHtcbiAgICB2YXIgcGFyc2VkID0gcGFyc2VJbnQoc3RyaW5nLnN1YnN0cihpICogMiwgMiksIDE2KVxuICAgIGlmIChpc05hTihwYXJzZWQpKSB0aHJvdyBuZXcgRXJyb3IoJ0ludmFsaWQgaGV4IHN0cmluZycpXG4gICAgYnVmW29mZnNldCArIGldID0gcGFyc2VkXG4gIH1cbiAgcmV0dXJuIGlcbn1cblxuZnVuY3Rpb24gdXRmOFdyaXRlIChidWYsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpIHtcbiAgcmV0dXJuIGJsaXRCdWZmZXIodXRmOFRvQnl0ZXMoc3RyaW5nLCBidWYubGVuZ3RoIC0gb2Zmc2V0KSwgYnVmLCBvZmZzZXQsIGxlbmd0aClcbn1cblxuZnVuY3Rpb24gYXNjaWlXcml0ZSAoYnVmLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKSB7XG4gIHJldHVybiBibGl0QnVmZmVyKGFzY2lpVG9CeXRlcyhzdHJpbmcpLCBidWYsIG9mZnNldCwgbGVuZ3RoKVxufVxuXG5mdW5jdGlvbiBiaW5hcnlXcml0ZSAoYnVmLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKSB7XG4gIHJldHVybiBhc2NpaVdyaXRlKGJ1Ziwgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aClcbn1cblxuZnVuY3Rpb24gYmFzZTY0V3JpdGUgKGJ1Ziwgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCkge1xuICByZXR1cm4gYmxpdEJ1ZmZlcihiYXNlNjRUb0J5dGVzKHN0cmluZyksIGJ1Ziwgb2Zmc2V0LCBsZW5ndGgpXG59XG5cbmZ1bmN0aW9uIHVjczJXcml0ZSAoYnVmLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKSB7XG4gIHJldHVybiBibGl0QnVmZmVyKHV0ZjE2bGVUb0J5dGVzKHN0cmluZywgYnVmLmxlbmd0aCAtIG9mZnNldCksIGJ1Ziwgb2Zmc2V0LCBsZW5ndGgpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGUgPSBmdW5jdGlvbiB3cml0ZSAoc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCwgZW5jb2RpbmcpIHtcbiAgLy8gQnVmZmVyI3dyaXRlKHN0cmluZylcbiAgaWYgKG9mZnNldCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgZW5jb2RpbmcgPSAndXRmOCdcbiAgICBsZW5ndGggPSB0aGlzLmxlbmd0aFxuICAgIG9mZnNldCA9IDBcbiAgLy8gQnVmZmVyI3dyaXRlKHN0cmluZywgZW5jb2RpbmcpXG4gIH0gZWxzZSBpZiAobGVuZ3RoID09PSB1bmRlZmluZWQgJiYgdHlwZW9mIG9mZnNldCA9PT0gJ3N0cmluZycpIHtcbiAgICBlbmNvZGluZyA9IG9mZnNldFxuICAgIGxlbmd0aCA9IHRoaXMubGVuZ3RoXG4gICAgb2Zmc2V0ID0gMFxuICAvLyBCdWZmZXIjd3JpdGUoc3RyaW5nLCBvZmZzZXRbLCBsZW5ndGhdWywgZW5jb2RpbmddKVxuICB9IGVsc2UgaWYgKGlzRmluaXRlKG9mZnNldCkpIHtcbiAgICBvZmZzZXQgPSBvZmZzZXQgfCAwXG4gICAgaWYgKGlzRmluaXRlKGxlbmd0aCkpIHtcbiAgICAgIGxlbmd0aCA9IGxlbmd0aCB8IDBcbiAgICAgIGlmIChlbmNvZGluZyA9PT0gdW5kZWZpbmVkKSBlbmNvZGluZyA9ICd1dGY4J1xuICAgIH0gZWxzZSB7XG4gICAgICBlbmNvZGluZyA9IGxlbmd0aFxuICAgICAgbGVuZ3RoID0gdW5kZWZpbmVkXG4gICAgfVxuICAvLyBsZWdhY3kgd3JpdGUoc3RyaW5nLCBlbmNvZGluZywgb2Zmc2V0LCBsZW5ndGgpIC0gcmVtb3ZlIGluIHYwLjEzXG4gIH0gZWxzZSB7XG4gICAgdmFyIHN3YXAgPSBlbmNvZGluZ1xuICAgIGVuY29kaW5nID0gb2Zmc2V0XG4gICAgb2Zmc2V0ID0gbGVuZ3RoIHwgMFxuICAgIGxlbmd0aCA9IHN3YXBcbiAgfVxuXG4gIHZhciByZW1haW5pbmcgPSB0aGlzLmxlbmd0aCAtIG9mZnNldFxuICBpZiAobGVuZ3RoID09PSB1bmRlZmluZWQgfHwgbGVuZ3RoID4gcmVtYWluaW5nKSBsZW5ndGggPSByZW1haW5pbmdcblxuICBpZiAoKHN0cmluZy5sZW5ndGggPiAwICYmIChsZW5ndGggPCAwIHx8IG9mZnNldCA8IDApKSB8fCBvZmZzZXQgPiB0aGlzLmxlbmd0aCkge1xuICAgIHRocm93IG5ldyBSYW5nZUVycm9yKCdhdHRlbXB0IHRvIHdyaXRlIG91dHNpZGUgYnVmZmVyIGJvdW5kcycpXG4gIH1cblxuICBpZiAoIWVuY29kaW5nKSBlbmNvZGluZyA9ICd1dGY4J1xuXG4gIHZhciBsb3dlcmVkQ2FzZSA9IGZhbHNlXG4gIGZvciAoOzspIHtcbiAgICBzd2l0Y2ggKGVuY29kaW5nKSB7XG4gICAgICBjYXNlICdoZXgnOlxuICAgICAgICByZXR1cm4gaGV4V3JpdGUodGhpcywgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aClcblxuICAgICAgY2FzZSAndXRmOCc6XG4gICAgICBjYXNlICd1dGYtOCc6XG4gICAgICAgIHJldHVybiB1dGY4V3JpdGUodGhpcywgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aClcblxuICAgICAgY2FzZSAnYXNjaWknOlxuICAgICAgICByZXR1cm4gYXNjaWlXcml0ZSh0aGlzLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKVxuXG4gICAgICBjYXNlICdiaW5hcnknOlxuICAgICAgICByZXR1cm4gYmluYXJ5V3JpdGUodGhpcywgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aClcblxuICAgICAgY2FzZSAnYmFzZTY0JzpcbiAgICAgICAgLy8gV2FybmluZzogbWF4TGVuZ3RoIG5vdCB0YWtlbiBpbnRvIGFjY291bnQgaW4gYmFzZTY0V3JpdGVcbiAgICAgICAgcmV0dXJuIGJhc2U2NFdyaXRlKHRoaXMsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpXG5cbiAgICAgIGNhc2UgJ3VjczInOlxuICAgICAgY2FzZSAndWNzLTInOlxuICAgICAgY2FzZSAndXRmMTZsZSc6XG4gICAgICBjYXNlICd1dGYtMTZsZSc6XG4gICAgICAgIHJldHVybiB1Y3MyV3JpdGUodGhpcywgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aClcblxuICAgICAgZGVmYXVsdDpcbiAgICAgICAgaWYgKGxvd2VyZWRDYXNlKSB0aHJvdyBuZXcgVHlwZUVycm9yKCdVbmtub3duIGVuY29kaW5nOiAnICsgZW5jb2RpbmcpXG4gICAgICAgIGVuY29kaW5nID0gKCcnICsgZW5jb2RpbmcpLnRvTG93ZXJDYXNlKClcbiAgICAgICAgbG93ZXJlZENhc2UgPSB0cnVlXG4gICAgfVxuICB9XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUudG9KU09OID0gZnVuY3Rpb24gdG9KU09OICgpIHtcbiAgcmV0dXJuIHtcbiAgICB0eXBlOiAnQnVmZmVyJyxcbiAgICBkYXRhOiBBcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbCh0aGlzLl9hcnIgfHwgdGhpcywgMClcbiAgfVxufVxuXG5mdW5jdGlvbiBiYXNlNjRTbGljZSAoYnVmLCBzdGFydCwgZW5kKSB7XG4gIGlmIChzdGFydCA9PT0gMCAmJiBlbmQgPT09IGJ1Zi5sZW5ndGgpIHtcbiAgICByZXR1cm4gYmFzZTY0LmZyb21CeXRlQXJyYXkoYnVmKVxuICB9IGVsc2Uge1xuICAgIHJldHVybiBiYXNlNjQuZnJvbUJ5dGVBcnJheShidWYuc2xpY2Uoc3RhcnQsIGVuZCkpXG4gIH1cbn1cblxuZnVuY3Rpb24gdXRmOFNsaWNlIChidWYsIHN0YXJ0LCBlbmQpIHtcbiAgdmFyIHJlcyA9ICcnXG4gIHZhciB0bXAgPSAnJ1xuICBlbmQgPSBNYXRoLm1pbihidWYubGVuZ3RoLCBlbmQpXG5cbiAgZm9yICh2YXIgaSA9IHN0YXJ0OyBpIDwgZW5kOyBpKyspIHtcbiAgICBpZiAoYnVmW2ldIDw9IDB4N0YpIHtcbiAgICAgIHJlcyArPSBkZWNvZGVVdGY4Q2hhcih0bXApICsgU3RyaW5nLmZyb21DaGFyQ29kZShidWZbaV0pXG4gICAgICB0bXAgPSAnJ1xuICAgIH0gZWxzZSB7XG4gICAgICB0bXAgKz0gJyUnICsgYnVmW2ldLnRvU3RyaW5nKDE2KVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiByZXMgKyBkZWNvZGVVdGY4Q2hhcih0bXApXG59XG5cbmZ1bmN0aW9uIGFzY2lpU2xpY2UgKGJ1Ziwgc3RhcnQsIGVuZCkge1xuICB2YXIgcmV0ID0gJydcbiAgZW5kID0gTWF0aC5taW4oYnVmLmxlbmd0aCwgZW5kKVxuXG4gIGZvciAodmFyIGkgPSBzdGFydDsgaSA8IGVuZDsgaSsrKSB7XG4gICAgcmV0ICs9IFN0cmluZy5mcm9tQ2hhckNvZGUoYnVmW2ldICYgMHg3RilcbiAgfVxuICByZXR1cm4gcmV0XG59XG5cbmZ1bmN0aW9uIGJpbmFyeVNsaWNlIChidWYsIHN0YXJ0LCBlbmQpIHtcbiAgdmFyIHJldCA9ICcnXG4gIGVuZCA9IE1hdGgubWluKGJ1Zi5sZW5ndGgsIGVuZClcblxuICBmb3IgKHZhciBpID0gc3RhcnQ7IGkgPCBlbmQ7IGkrKykge1xuICAgIHJldCArPSBTdHJpbmcuZnJvbUNoYXJDb2RlKGJ1ZltpXSlcbiAgfVxuICByZXR1cm4gcmV0XG59XG5cbmZ1bmN0aW9uIGhleFNsaWNlIChidWYsIHN0YXJ0LCBlbmQpIHtcbiAgdmFyIGxlbiA9IGJ1Zi5sZW5ndGhcblxuICBpZiAoIXN0YXJ0IHx8IHN0YXJ0IDwgMCkgc3RhcnQgPSAwXG4gIGlmICghZW5kIHx8IGVuZCA8IDAgfHwgZW5kID4gbGVuKSBlbmQgPSBsZW5cblxuICB2YXIgb3V0ID0gJydcbiAgZm9yICh2YXIgaSA9IHN0YXJ0OyBpIDwgZW5kOyBpKyspIHtcbiAgICBvdXQgKz0gdG9IZXgoYnVmW2ldKVxuICB9XG4gIHJldHVybiBvdXRcbn1cblxuZnVuY3Rpb24gdXRmMTZsZVNsaWNlIChidWYsIHN0YXJ0LCBlbmQpIHtcbiAgdmFyIGJ5dGVzID0gYnVmLnNsaWNlKHN0YXJ0LCBlbmQpXG4gIHZhciByZXMgPSAnJ1xuICBmb3IgKHZhciBpID0gMDsgaSA8IGJ5dGVzLmxlbmd0aDsgaSArPSAyKSB7XG4gICAgcmVzICs9IFN0cmluZy5mcm9tQ2hhckNvZGUoYnl0ZXNbaV0gKyBieXRlc1tpICsgMV0gKiAyNTYpXG4gIH1cbiAgcmV0dXJuIHJlc1xufVxuXG5CdWZmZXIucHJvdG90eXBlLnNsaWNlID0gZnVuY3Rpb24gc2xpY2UgKHN0YXJ0LCBlbmQpIHtcbiAgdmFyIGxlbiA9IHRoaXMubGVuZ3RoXG4gIHN0YXJ0ID0gfn5zdGFydFxuICBlbmQgPSBlbmQgPT09IHVuZGVmaW5lZCA/IGxlbiA6IH5+ZW5kXG5cbiAgaWYgKHN0YXJ0IDwgMCkge1xuICAgIHN0YXJ0ICs9IGxlblxuICAgIGlmIChzdGFydCA8IDApIHN0YXJ0ID0gMFxuICB9IGVsc2UgaWYgKHN0YXJ0ID4gbGVuKSB7XG4gICAgc3RhcnQgPSBsZW5cbiAgfVxuXG4gIGlmIChlbmQgPCAwKSB7XG4gICAgZW5kICs9IGxlblxuICAgIGlmIChlbmQgPCAwKSBlbmQgPSAwXG4gIH0gZWxzZSBpZiAoZW5kID4gbGVuKSB7XG4gICAgZW5kID0gbGVuXG4gIH1cblxuICBpZiAoZW5kIDwgc3RhcnQpIGVuZCA9IHN0YXJ0XG5cbiAgdmFyIG5ld0J1ZlxuICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICBuZXdCdWYgPSBCdWZmZXIuX2F1Z21lbnQodGhpcy5zdWJhcnJheShzdGFydCwgZW5kKSlcbiAgfSBlbHNlIHtcbiAgICB2YXIgc2xpY2VMZW4gPSBlbmQgLSBzdGFydFxuICAgIG5ld0J1ZiA9IG5ldyBCdWZmZXIoc2xpY2VMZW4sIHVuZGVmaW5lZClcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IHNsaWNlTGVuOyBpKyspIHtcbiAgICAgIG5ld0J1ZltpXSA9IHRoaXNbaSArIHN0YXJ0XVxuICAgIH1cbiAgfVxuXG4gIGlmIChuZXdCdWYubGVuZ3RoKSBuZXdCdWYucGFyZW50ID0gdGhpcy5wYXJlbnQgfHwgdGhpc1xuXG4gIHJldHVybiBuZXdCdWZcbn1cblxuLypcbiAqIE5lZWQgdG8gbWFrZSBzdXJlIHRoYXQgYnVmZmVyIGlzbid0IHRyeWluZyB0byB3cml0ZSBvdXQgb2YgYm91bmRzLlxuICovXG5mdW5jdGlvbiBjaGVja09mZnNldCAob2Zmc2V0LCBleHQsIGxlbmd0aCkge1xuICBpZiAoKG9mZnNldCAlIDEpICE9PSAwIHx8IG9mZnNldCA8IDApIHRocm93IG5ldyBSYW5nZUVycm9yKCdvZmZzZXQgaXMgbm90IHVpbnQnKVxuICBpZiAob2Zmc2V0ICsgZXh0ID4gbGVuZ3RoKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcignVHJ5aW5nIHRvIGFjY2VzcyBiZXlvbmQgYnVmZmVyIGxlbmd0aCcpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZFVJbnRMRSA9IGZ1bmN0aW9uIHJlYWRVSW50TEUgKG9mZnNldCwgYnl0ZUxlbmd0aCwgbm9Bc3NlcnQpIHtcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBieXRlTGVuZ3RoID0gYnl0ZUxlbmd0aCB8IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCBieXRlTGVuZ3RoLCB0aGlzLmxlbmd0aClcblxuICB2YXIgdmFsID0gdGhpc1tvZmZzZXRdXG4gIHZhciBtdWwgPSAxXG4gIHZhciBpID0gMFxuICB3aGlsZSAoKytpIDwgYnl0ZUxlbmd0aCAmJiAobXVsICo9IDB4MTAwKSkge1xuICAgIHZhbCArPSB0aGlzW29mZnNldCArIGldICogbXVsXG4gIH1cblxuICByZXR1cm4gdmFsXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZFVJbnRCRSA9IGZ1bmN0aW9uIHJlYWRVSW50QkUgKG9mZnNldCwgYnl0ZUxlbmd0aCwgbm9Bc3NlcnQpIHtcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBieXRlTGVuZ3RoID0gYnl0ZUxlbmd0aCB8IDBcbiAgaWYgKCFub0Fzc2VydCkge1xuICAgIGNoZWNrT2Zmc2V0KG9mZnNldCwgYnl0ZUxlbmd0aCwgdGhpcy5sZW5ndGgpXG4gIH1cblxuICB2YXIgdmFsID0gdGhpc1tvZmZzZXQgKyAtLWJ5dGVMZW5ndGhdXG4gIHZhciBtdWwgPSAxXG4gIHdoaWxlIChieXRlTGVuZ3RoID4gMCAmJiAobXVsICo9IDB4MTAwKSkge1xuICAgIHZhbCArPSB0aGlzW29mZnNldCArIC0tYnl0ZUxlbmd0aF0gKiBtdWxcbiAgfVxuXG4gIHJldHVybiB2YWxcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkVUludDggPSBmdW5jdGlvbiByZWFkVUludDggKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCAxLCB0aGlzLmxlbmd0aClcbiAgcmV0dXJuIHRoaXNbb2Zmc2V0XVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRVSW50MTZMRSA9IGZ1bmN0aW9uIHJlYWRVSW50MTZMRSAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDIsIHRoaXMubGVuZ3RoKVxuICByZXR1cm4gdGhpc1tvZmZzZXRdIHwgKHRoaXNbb2Zmc2V0ICsgMV0gPDwgOClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkVUludDE2QkUgPSBmdW5jdGlvbiByZWFkVUludDE2QkUgKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCAyLCB0aGlzLmxlbmd0aClcbiAgcmV0dXJuICh0aGlzW29mZnNldF0gPDwgOCkgfCB0aGlzW29mZnNldCArIDFdXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZFVJbnQzMkxFID0gZnVuY3Rpb24gcmVhZFVJbnQzMkxFIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgNCwgdGhpcy5sZW5ndGgpXG5cbiAgcmV0dXJuICgodGhpc1tvZmZzZXRdKSB8XG4gICAgICAodGhpc1tvZmZzZXQgKyAxXSA8PCA4KSB8XG4gICAgICAodGhpc1tvZmZzZXQgKyAyXSA8PCAxNikpICtcbiAgICAgICh0aGlzW29mZnNldCArIDNdICogMHgxMDAwMDAwKVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRVSW50MzJCRSA9IGZ1bmN0aW9uIHJlYWRVSW50MzJCRSAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDQsIHRoaXMubGVuZ3RoKVxuXG4gIHJldHVybiAodGhpc1tvZmZzZXRdICogMHgxMDAwMDAwKSArXG4gICAgKCh0aGlzW29mZnNldCArIDFdIDw8IDE2KSB8XG4gICAgKHRoaXNbb2Zmc2V0ICsgMl0gPDwgOCkgfFxuICAgIHRoaXNbb2Zmc2V0ICsgM10pXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEludExFID0gZnVuY3Rpb24gcmVhZEludExFIChvZmZzZXQsIGJ5dGVMZW5ndGgsIG5vQXNzZXJ0KSB7XG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgYnl0ZUxlbmd0aCA9IGJ5dGVMZW5ndGggfCAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgYnl0ZUxlbmd0aCwgdGhpcy5sZW5ndGgpXG5cbiAgdmFyIHZhbCA9IHRoaXNbb2Zmc2V0XVxuICB2YXIgbXVsID0gMVxuICB2YXIgaSA9IDBcbiAgd2hpbGUgKCsraSA8IGJ5dGVMZW5ndGggJiYgKG11bCAqPSAweDEwMCkpIHtcbiAgICB2YWwgKz0gdGhpc1tvZmZzZXQgKyBpXSAqIG11bFxuICB9XG4gIG11bCAqPSAweDgwXG5cbiAgaWYgKHZhbCA+PSBtdWwpIHZhbCAtPSBNYXRoLnBvdygyLCA4ICogYnl0ZUxlbmd0aClcblxuICByZXR1cm4gdmFsXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEludEJFID0gZnVuY3Rpb24gcmVhZEludEJFIChvZmZzZXQsIGJ5dGVMZW5ndGgsIG5vQXNzZXJ0KSB7XG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgYnl0ZUxlbmd0aCA9IGJ5dGVMZW5ndGggfCAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgYnl0ZUxlbmd0aCwgdGhpcy5sZW5ndGgpXG5cbiAgdmFyIGkgPSBieXRlTGVuZ3RoXG4gIHZhciBtdWwgPSAxXG4gIHZhciB2YWwgPSB0aGlzW29mZnNldCArIC0taV1cbiAgd2hpbGUgKGkgPiAwICYmIChtdWwgKj0gMHgxMDApKSB7XG4gICAgdmFsICs9IHRoaXNbb2Zmc2V0ICsgLS1pXSAqIG11bFxuICB9XG4gIG11bCAqPSAweDgwXG5cbiAgaWYgKHZhbCA+PSBtdWwpIHZhbCAtPSBNYXRoLnBvdygyLCA4ICogYnl0ZUxlbmd0aClcblxuICByZXR1cm4gdmFsXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEludDggPSBmdW5jdGlvbiByZWFkSW50OCAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDEsIHRoaXMubGVuZ3RoKVxuICBpZiAoISh0aGlzW29mZnNldF0gJiAweDgwKSkgcmV0dXJuICh0aGlzW29mZnNldF0pXG4gIHJldHVybiAoKDB4ZmYgLSB0aGlzW29mZnNldF0gKyAxKSAqIC0xKVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRJbnQxNkxFID0gZnVuY3Rpb24gcmVhZEludDE2TEUgKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCAyLCB0aGlzLmxlbmd0aClcbiAgdmFyIHZhbCA9IHRoaXNbb2Zmc2V0XSB8ICh0aGlzW29mZnNldCArIDFdIDw8IDgpXG4gIHJldHVybiAodmFsICYgMHg4MDAwKSA/IHZhbCB8IDB4RkZGRjAwMDAgOiB2YWxcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkSW50MTZCRSA9IGZ1bmN0aW9uIHJlYWRJbnQxNkJFIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgMiwgdGhpcy5sZW5ndGgpXG4gIHZhciB2YWwgPSB0aGlzW29mZnNldCArIDFdIHwgKHRoaXNbb2Zmc2V0XSA8PCA4KVxuICByZXR1cm4gKHZhbCAmIDB4ODAwMCkgPyB2YWwgfCAweEZGRkYwMDAwIDogdmFsXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEludDMyTEUgPSBmdW5jdGlvbiByZWFkSW50MzJMRSAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDQsIHRoaXMubGVuZ3RoKVxuXG4gIHJldHVybiAodGhpc1tvZmZzZXRdKSB8XG4gICAgKHRoaXNbb2Zmc2V0ICsgMV0gPDwgOCkgfFxuICAgICh0aGlzW29mZnNldCArIDJdIDw8IDE2KSB8XG4gICAgKHRoaXNbb2Zmc2V0ICsgM10gPDwgMjQpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEludDMyQkUgPSBmdW5jdGlvbiByZWFkSW50MzJCRSAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDQsIHRoaXMubGVuZ3RoKVxuXG4gIHJldHVybiAodGhpc1tvZmZzZXRdIDw8IDI0KSB8XG4gICAgKHRoaXNbb2Zmc2V0ICsgMV0gPDwgMTYpIHxcbiAgICAodGhpc1tvZmZzZXQgKyAyXSA8PCA4KSB8XG4gICAgKHRoaXNbb2Zmc2V0ICsgM10pXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEZsb2F0TEUgPSBmdW5jdGlvbiByZWFkRmxvYXRMRSAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDQsIHRoaXMubGVuZ3RoKVxuICByZXR1cm4gaWVlZTc1NC5yZWFkKHRoaXMsIG9mZnNldCwgdHJ1ZSwgMjMsIDQpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEZsb2F0QkUgPSBmdW5jdGlvbiByZWFkRmxvYXRCRSAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDQsIHRoaXMubGVuZ3RoKVxuICByZXR1cm4gaWVlZTc1NC5yZWFkKHRoaXMsIG9mZnNldCwgZmFsc2UsIDIzLCA0KVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWREb3VibGVMRSA9IGZ1bmN0aW9uIHJlYWREb3VibGVMRSAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDgsIHRoaXMubGVuZ3RoKVxuICByZXR1cm4gaWVlZTc1NC5yZWFkKHRoaXMsIG9mZnNldCwgdHJ1ZSwgNTIsIDgpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZERvdWJsZUJFID0gZnVuY3Rpb24gcmVhZERvdWJsZUJFIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgOCwgdGhpcy5sZW5ndGgpXG4gIHJldHVybiBpZWVlNzU0LnJlYWQodGhpcywgb2Zmc2V0LCBmYWxzZSwgNTIsIDgpXG59XG5cbmZ1bmN0aW9uIGNoZWNrSW50IChidWYsIHZhbHVlLCBvZmZzZXQsIGV4dCwgbWF4LCBtaW4pIHtcbiAgaWYgKCFCdWZmZXIuaXNCdWZmZXIoYnVmKSkgdGhyb3cgbmV3IFR5cGVFcnJvcignYnVmZmVyIG11c3QgYmUgYSBCdWZmZXIgaW5zdGFuY2UnKVxuICBpZiAodmFsdWUgPiBtYXggfHwgdmFsdWUgPCBtaW4pIHRocm93IG5ldyBSYW5nZUVycm9yKCd2YWx1ZSBpcyBvdXQgb2YgYm91bmRzJylcbiAgaWYgKG9mZnNldCArIGV4dCA+IGJ1Zi5sZW5ndGgpIHRocm93IG5ldyBSYW5nZUVycm9yKCdpbmRleCBvdXQgb2YgcmFuZ2UnKVxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlVUludExFID0gZnVuY3Rpb24gd3JpdGVVSW50TEUgKHZhbHVlLCBvZmZzZXQsIGJ5dGVMZW5ndGgsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgYnl0ZUxlbmd0aCA9IGJ5dGVMZW5ndGggfCAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIGJ5dGVMZW5ndGgsIE1hdGgucG93KDIsIDggKiBieXRlTGVuZ3RoKSwgMClcblxuICB2YXIgbXVsID0gMVxuICB2YXIgaSA9IDBcbiAgdGhpc1tvZmZzZXRdID0gdmFsdWUgJiAweEZGXG4gIHdoaWxlICgrK2kgPCBieXRlTGVuZ3RoICYmIChtdWwgKj0gMHgxMDApKSB7XG4gICAgdGhpc1tvZmZzZXQgKyBpXSA9ICh2YWx1ZSAvIG11bCkgJiAweEZGXG4gIH1cblxuICByZXR1cm4gb2Zmc2V0ICsgYnl0ZUxlbmd0aFxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlVUludEJFID0gZnVuY3Rpb24gd3JpdGVVSW50QkUgKHZhbHVlLCBvZmZzZXQsIGJ5dGVMZW5ndGgsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgYnl0ZUxlbmd0aCA9IGJ5dGVMZW5ndGggfCAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIGJ5dGVMZW5ndGgsIE1hdGgucG93KDIsIDggKiBieXRlTGVuZ3RoKSwgMClcblxuICB2YXIgaSA9IGJ5dGVMZW5ndGggLSAxXG4gIHZhciBtdWwgPSAxXG4gIHRoaXNbb2Zmc2V0ICsgaV0gPSB2YWx1ZSAmIDB4RkZcbiAgd2hpbGUgKC0taSA+PSAwICYmIChtdWwgKj0gMHgxMDApKSB7XG4gICAgdGhpc1tvZmZzZXQgKyBpXSA9ICh2YWx1ZSAvIG11bCkgJiAweEZGXG4gIH1cblxuICByZXR1cm4gb2Zmc2V0ICsgYnl0ZUxlbmd0aFxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlVUludDggPSBmdW5jdGlvbiB3cml0ZVVJbnQ4ICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgfCAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIDEsIDB4ZmYsIDApXG4gIGlmICghQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHZhbHVlID0gTWF0aC5mbG9vcih2YWx1ZSlcbiAgdGhpc1tvZmZzZXRdID0gdmFsdWVcbiAgcmV0dXJuIG9mZnNldCArIDFcbn1cblxuZnVuY3Rpb24gb2JqZWN0V3JpdGVVSW50MTYgKGJ1ZiwgdmFsdWUsIG9mZnNldCwgbGl0dGxlRW5kaWFuKSB7XG4gIGlmICh2YWx1ZSA8IDApIHZhbHVlID0gMHhmZmZmICsgdmFsdWUgKyAxXG4gIGZvciAodmFyIGkgPSAwLCBqID0gTWF0aC5taW4oYnVmLmxlbmd0aCAtIG9mZnNldCwgMik7IGkgPCBqOyBpKyspIHtcbiAgICBidWZbb2Zmc2V0ICsgaV0gPSAodmFsdWUgJiAoMHhmZiA8PCAoOCAqIChsaXR0bGVFbmRpYW4gPyBpIDogMSAtIGkpKSkpID4+PlxuICAgICAgKGxpdHRsZUVuZGlhbiA/IGkgOiAxIC0gaSkgKiA4XG4gIH1cbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZVVJbnQxNkxFID0gZnVuY3Rpb24gd3JpdGVVSW50MTZMRSAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCAyLCAweGZmZmYsIDApXG4gIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIHRoaXNbb2Zmc2V0XSA9IHZhbHVlXG4gICAgdGhpc1tvZmZzZXQgKyAxXSA9ICh2YWx1ZSA+Pj4gOClcbiAgfSBlbHNlIHtcbiAgICBvYmplY3RXcml0ZVVJbnQxNih0aGlzLCB2YWx1ZSwgb2Zmc2V0LCB0cnVlKVxuICB9XG4gIHJldHVybiBvZmZzZXQgKyAyXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVVSW50MTZCRSA9IGZ1bmN0aW9uIHdyaXRlVUludDE2QkUgKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgMiwgMHhmZmZmLCAwKVxuICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICB0aGlzW29mZnNldF0gPSAodmFsdWUgPj4+IDgpXG4gICAgdGhpc1tvZmZzZXQgKyAxXSA9IHZhbHVlXG4gIH0gZWxzZSB7XG4gICAgb2JqZWN0V3JpdGVVSW50MTYodGhpcywgdmFsdWUsIG9mZnNldCwgZmFsc2UpXG4gIH1cbiAgcmV0dXJuIG9mZnNldCArIDJcbn1cblxuZnVuY3Rpb24gb2JqZWN0V3JpdGVVSW50MzIgKGJ1ZiwgdmFsdWUsIG9mZnNldCwgbGl0dGxlRW5kaWFuKSB7XG4gIGlmICh2YWx1ZSA8IDApIHZhbHVlID0gMHhmZmZmZmZmZiArIHZhbHVlICsgMVxuICBmb3IgKHZhciBpID0gMCwgaiA9IE1hdGgubWluKGJ1Zi5sZW5ndGggLSBvZmZzZXQsIDQpOyBpIDwgajsgaSsrKSB7XG4gICAgYnVmW29mZnNldCArIGldID0gKHZhbHVlID4+PiAobGl0dGxlRW5kaWFuID8gaSA6IDMgLSBpKSAqIDgpICYgMHhmZlxuICB9XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVVSW50MzJMRSA9IGZ1bmN0aW9uIHdyaXRlVUludDMyTEUgKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgNCwgMHhmZmZmZmZmZiwgMClcbiAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgdGhpc1tvZmZzZXQgKyAzXSA9ICh2YWx1ZSA+Pj4gMjQpXG4gICAgdGhpc1tvZmZzZXQgKyAyXSA9ICh2YWx1ZSA+Pj4gMTYpXG4gICAgdGhpc1tvZmZzZXQgKyAxXSA9ICh2YWx1ZSA+Pj4gOClcbiAgICB0aGlzW29mZnNldF0gPSB2YWx1ZVxuICB9IGVsc2Uge1xuICAgIG9iamVjdFdyaXRlVUludDMyKHRoaXMsIHZhbHVlLCBvZmZzZXQsIHRydWUpXG4gIH1cbiAgcmV0dXJuIG9mZnNldCArIDRcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZVVJbnQzMkJFID0gZnVuY3Rpb24gd3JpdGVVSW50MzJCRSAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCA0LCAweGZmZmZmZmZmLCAwKVxuICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICB0aGlzW29mZnNldF0gPSAodmFsdWUgPj4+IDI0KVxuICAgIHRoaXNbb2Zmc2V0ICsgMV0gPSAodmFsdWUgPj4+IDE2KVxuICAgIHRoaXNbb2Zmc2V0ICsgMl0gPSAodmFsdWUgPj4+IDgpXG4gICAgdGhpc1tvZmZzZXQgKyAzXSA9IHZhbHVlXG4gIH0gZWxzZSB7XG4gICAgb2JqZWN0V3JpdGVVSW50MzIodGhpcywgdmFsdWUsIG9mZnNldCwgZmFsc2UpXG4gIH1cbiAgcmV0dXJuIG9mZnNldCArIDRcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUludExFID0gZnVuY3Rpb24gd3JpdGVJbnRMRSAodmFsdWUsIG9mZnNldCwgYnl0ZUxlbmd0aCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBpZiAoIW5vQXNzZXJ0KSB7XG4gICAgdmFyIGxpbWl0ID0gTWF0aC5wb3coMiwgOCAqIGJ5dGVMZW5ndGggLSAxKVxuXG4gICAgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgYnl0ZUxlbmd0aCwgbGltaXQgLSAxLCAtbGltaXQpXG4gIH1cblxuICB2YXIgaSA9IDBcbiAgdmFyIG11bCA9IDFcbiAgdmFyIHN1YiA9IHZhbHVlIDwgMCA/IDEgOiAwXG4gIHRoaXNbb2Zmc2V0XSA9IHZhbHVlICYgMHhGRlxuICB3aGlsZSAoKytpIDwgYnl0ZUxlbmd0aCAmJiAobXVsICo9IDB4MTAwKSkge1xuICAgIHRoaXNbb2Zmc2V0ICsgaV0gPSAoKHZhbHVlIC8gbXVsKSA+PiAwKSAtIHN1YiAmIDB4RkZcbiAgfVxuXG4gIHJldHVybiBvZmZzZXQgKyBieXRlTGVuZ3RoXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVJbnRCRSA9IGZ1bmN0aW9uIHdyaXRlSW50QkUgKHZhbHVlLCBvZmZzZXQsIGJ5dGVMZW5ndGgsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgaWYgKCFub0Fzc2VydCkge1xuICAgIHZhciBsaW1pdCA9IE1hdGgucG93KDIsIDggKiBieXRlTGVuZ3RoIC0gMSlcblxuICAgIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIGJ5dGVMZW5ndGgsIGxpbWl0IC0gMSwgLWxpbWl0KVxuICB9XG5cbiAgdmFyIGkgPSBieXRlTGVuZ3RoIC0gMVxuICB2YXIgbXVsID0gMVxuICB2YXIgc3ViID0gdmFsdWUgPCAwID8gMSA6IDBcbiAgdGhpc1tvZmZzZXQgKyBpXSA9IHZhbHVlICYgMHhGRlxuICB3aGlsZSAoLS1pID49IDAgJiYgKG11bCAqPSAweDEwMCkpIHtcbiAgICB0aGlzW29mZnNldCArIGldID0gKCh2YWx1ZSAvIG11bCkgPj4gMCkgLSBzdWIgJiAweEZGXG4gIH1cblxuICByZXR1cm4gb2Zmc2V0ICsgYnl0ZUxlbmd0aFxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlSW50OCA9IGZ1bmN0aW9uIHdyaXRlSW50OCAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCAxLCAweDdmLCAtMHg4MClcbiAgaWYgKCFCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkgdmFsdWUgPSBNYXRoLmZsb29yKHZhbHVlKVxuICBpZiAodmFsdWUgPCAwKSB2YWx1ZSA9IDB4ZmYgKyB2YWx1ZSArIDFcbiAgdGhpc1tvZmZzZXRdID0gdmFsdWVcbiAgcmV0dXJuIG9mZnNldCArIDFcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUludDE2TEUgPSBmdW5jdGlvbiB3cml0ZUludDE2TEUgKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgMiwgMHg3ZmZmLCAtMHg4MDAwKVxuICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICB0aGlzW29mZnNldF0gPSB2YWx1ZVxuICAgIHRoaXNbb2Zmc2V0ICsgMV0gPSAodmFsdWUgPj4+IDgpXG4gIH0gZWxzZSB7XG4gICAgb2JqZWN0V3JpdGVVSW50MTYodGhpcywgdmFsdWUsIG9mZnNldCwgdHJ1ZSlcbiAgfVxuICByZXR1cm4gb2Zmc2V0ICsgMlxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlSW50MTZCRSA9IGZ1bmN0aW9uIHdyaXRlSW50MTZCRSAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCAyLCAweDdmZmYsIC0weDgwMDApXG4gIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIHRoaXNbb2Zmc2V0XSA9ICh2YWx1ZSA+Pj4gOClcbiAgICB0aGlzW29mZnNldCArIDFdID0gdmFsdWVcbiAgfSBlbHNlIHtcbiAgICBvYmplY3RXcml0ZVVJbnQxNih0aGlzLCB2YWx1ZSwgb2Zmc2V0LCBmYWxzZSlcbiAgfVxuICByZXR1cm4gb2Zmc2V0ICsgMlxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlSW50MzJMRSA9IGZ1bmN0aW9uIHdyaXRlSW50MzJMRSAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCA0LCAweDdmZmZmZmZmLCAtMHg4MDAwMDAwMClcbiAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgdGhpc1tvZmZzZXRdID0gdmFsdWVcbiAgICB0aGlzW29mZnNldCArIDFdID0gKHZhbHVlID4+PiA4KVxuICAgIHRoaXNbb2Zmc2V0ICsgMl0gPSAodmFsdWUgPj4+IDE2KVxuICAgIHRoaXNbb2Zmc2V0ICsgM10gPSAodmFsdWUgPj4+IDI0KVxuICB9IGVsc2Uge1xuICAgIG9iamVjdFdyaXRlVUludDMyKHRoaXMsIHZhbHVlLCBvZmZzZXQsIHRydWUpXG4gIH1cbiAgcmV0dXJuIG9mZnNldCArIDRcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUludDMyQkUgPSBmdW5jdGlvbiB3cml0ZUludDMyQkUgKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgNCwgMHg3ZmZmZmZmZiwgLTB4ODAwMDAwMDApXG4gIGlmICh2YWx1ZSA8IDApIHZhbHVlID0gMHhmZmZmZmZmZiArIHZhbHVlICsgMVxuICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICB0aGlzW29mZnNldF0gPSAodmFsdWUgPj4+IDI0KVxuICAgIHRoaXNbb2Zmc2V0ICsgMV0gPSAodmFsdWUgPj4+IDE2KVxuICAgIHRoaXNbb2Zmc2V0ICsgMl0gPSAodmFsdWUgPj4+IDgpXG4gICAgdGhpc1tvZmZzZXQgKyAzXSA9IHZhbHVlXG4gIH0gZWxzZSB7XG4gICAgb2JqZWN0V3JpdGVVSW50MzIodGhpcywgdmFsdWUsIG9mZnNldCwgZmFsc2UpXG4gIH1cbiAgcmV0dXJuIG9mZnNldCArIDRcbn1cblxuZnVuY3Rpb24gY2hlY2tJRUVFNzU0IChidWYsIHZhbHVlLCBvZmZzZXQsIGV4dCwgbWF4LCBtaW4pIHtcbiAgaWYgKHZhbHVlID4gbWF4IHx8IHZhbHVlIDwgbWluKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcigndmFsdWUgaXMgb3V0IG9mIGJvdW5kcycpXG4gIGlmIChvZmZzZXQgKyBleHQgPiBidWYubGVuZ3RoKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcignaW5kZXggb3V0IG9mIHJhbmdlJylcbiAgaWYgKG9mZnNldCA8IDApIHRocm93IG5ldyBSYW5nZUVycm9yKCdpbmRleCBvdXQgb2YgcmFuZ2UnKVxufVxuXG5mdW5jdGlvbiB3cml0ZUZsb2F0IChidWYsIHZhbHVlLCBvZmZzZXQsIGxpdHRsZUVuZGlhbiwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkge1xuICAgIGNoZWNrSUVFRTc1NChidWYsIHZhbHVlLCBvZmZzZXQsIDQsIDMuNDAyODIzNDY2Mzg1Mjg4NmUrMzgsIC0zLjQwMjgyMzQ2NjM4NTI4ODZlKzM4KVxuICB9XG4gIGllZWU3NTQud3JpdGUoYnVmLCB2YWx1ZSwgb2Zmc2V0LCBsaXR0bGVFbmRpYW4sIDIzLCA0KVxuICByZXR1cm4gb2Zmc2V0ICsgNFxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlRmxvYXRMRSA9IGZ1bmN0aW9uIHdyaXRlRmxvYXRMRSAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgcmV0dXJuIHdyaXRlRmxvYXQodGhpcywgdmFsdWUsIG9mZnNldCwgdHJ1ZSwgbm9Bc3NlcnQpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVGbG9hdEJFID0gZnVuY3Rpb24gd3JpdGVGbG9hdEJFICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICByZXR1cm4gd3JpdGVGbG9hdCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCBmYWxzZSwgbm9Bc3NlcnQpXG59XG5cbmZ1bmN0aW9uIHdyaXRlRG91YmxlIChidWYsIHZhbHVlLCBvZmZzZXQsIGxpdHRsZUVuZGlhbiwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkge1xuICAgIGNoZWNrSUVFRTc1NChidWYsIHZhbHVlLCBvZmZzZXQsIDgsIDEuNzk3NjkzMTM0ODYyMzE1N0UrMzA4LCAtMS43OTc2OTMxMzQ4NjIzMTU3RSszMDgpXG4gIH1cbiAgaWVlZTc1NC53cml0ZShidWYsIHZhbHVlLCBvZmZzZXQsIGxpdHRsZUVuZGlhbiwgNTIsIDgpXG4gIHJldHVybiBvZmZzZXQgKyA4XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVEb3VibGVMRSA9IGZ1bmN0aW9uIHdyaXRlRG91YmxlTEUgKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHJldHVybiB3cml0ZURvdWJsZSh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCB0cnVlLCBub0Fzc2VydClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZURvdWJsZUJFID0gZnVuY3Rpb24gd3JpdGVEb3VibGVCRSAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgcmV0dXJuIHdyaXRlRG91YmxlKHRoaXMsIHZhbHVlLCBvZmZzZXQsIGZhbHNlLCBub0Fzc2VydClcbn1cblxuLy8gY29weSh0YXJnZXRCdWZmZXIsIHRhcmdldFN0YXJ0PTAsIHNvdXJjZVN0YXJ0PTAsIHNvdXJjZUVuZD1idWZmZXIubGVuZ3RoKVxuQnVmZmVyLnByb3RvdHlwZS5jb3B5ID0gZnVuY3Rpb24gY29weSAodGFyZ2V0LCB0YXJnZXRTdGFydCwgc3RhcnQsIGVuZCkge1xuICBpZiAoIXN0YXJ0KSBzdGFydCA9IDBcbiAgaWYgKCFlbmQgJiYgZW5kICE9PSAwKSBlbmQgPSB0aGlzLmxlbmd0aFxuICBpZiAodGFyZ2V0U3RhcnQgPj0gdGFyZ2V0Lmxlbmd0aCkgdGFyZ2V0U3RhcnQgPSB0YXJnZXQubGVuZ3RoXG4gIGlmICghdGFyZ2V0U3RhcnQpIHRhcmdldFN0YXJ0ID0gMFxuICBpZiAoZW5kID4gMCAmJiBlbmQgPCBzdGFydCkgZW5kID0gc3RhcnRcblxuICAvLyBDb3B5IDAgYnl0ZXM7IHdlJ3JlIGRvbmVcbiAgaWYgKGVuZCA9PT0gc3RhcnQpIHJldHVybiAwXG4gIGlmICh0YXJnZXQubGVuZ3RoID09PSAwIHx8IHRoaXMubGVuZ3RoID09PSAwKSByZXR1cm4gMFxuXG4gIC8vIEZhdGFsIGVycm9yIGNvbmRpdGlvbnNcbiAgaWYgKHRhcmdldFN0YXJ0IDwgMCkge1xuICAgIHRocm93IG5ldyBSYW5nZUVycm9yKCd0YXJnZXRTdGFydCBvdXQgb2YgYm91bmRzJylcbiAgfVxuICBpZiAoc3RhcnQgPCAwIHx8IHN0YXJ0ID49IHRoaXMubGVuZ3RoKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcignc291cmNlU3RhcnQgb3V0IG9mIGJvdW5kcycpXG4gIGlmIChlbmQgPCAwKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcignc291cmNlRW5kIG91dCBvZiBib3VuZHMnKVxuXG4gIC8vIEFyZSB3ZSBvb2I/XG4gIGlmIChlbmQgPiB0aGlzLmxlbmd0aCkgZW5kID0gdGhpcy5sZW5ndGhcbiAgaWYgKHRhcmdldC5sZW5ndGggLSB0YXJnZXRTdGFydCA8IGVuZCAtIHN0YXJ0KSB7XG4gICAgZW5kID0gdGFyZ2V0Lmxlbmd0aCAtIHRhcmdldFN0YXJ0ICsgc3RhcnRcbiAgfVxuXG4gIHZhciBsZW4gPSBlbmQgLSBzdGFydFxuXG4gIGlmIChsZW4gPCAxMDAwIHx8ICFCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuOyBpKyspIHtcbiAgICAgIHRhcmdldFtpICsgdGFyZ2V0U3RhcnRdID0gdGhpc1tpICsgc3RhcnRdXG4gICAgfVxuICB9IGVsc2Uge1xuICAgIHRhcmdldC5fc2V0KHRoaXMuc3ViYXJyYXkoc3RhcnQsIHN0YXJ0ICsgbGVuKSwgdGFyZ2V0U3RhcnQpXG4gIH1cblxuICByZXR1cm4gbGVuXG59XG5cbi8vIGZpbGwodmFsdWUsIHN0YXJ0PTAsIGVuZD1idWZmZXIubGVuZ3RoKVxuQnVmZmVyLnByb3RvdHlwZS5maWxsID0gZnVuY3Rpb24gZmlsbCAodmFsdWUsIHN0YXJ0LCBlbmQpIHtcbiAgaWYgKCF2YWx1ZSkgdmFsdWUgPSAwXG4gIGlmICghc3RhcnQpIHN0YXJ0ID0gMFxuICBpZiAoIWVuZCkgZW5kID0gdGhpcy5sZW5ndGhcblxuICBpZiAoZW5kIDwgc3RhcnQpIHRocm93IG5ldyBSYW5nZUVycm9yKCdlbmQgPCBzdGFydCcpXG5cbiAgLy8gRmlsbCAwIGJ5dGVzOyB3ZSdyZSBkb25lXG4gIGlmIChlbmQgPT09IHN0YXJ0KSByZXR1cm5cbiAgaWYgKHRoaXMubGVuZ3RoID09PSAwKSByZXR1cm5cblxuICBpZiAoc3RhcnQgPCAwIHx8IHN0YXJ0ID49IHRoaXMubGVuZ3RoKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcignc3RhcnQgb3V0IG9mIGJvdW5kcycpXG4gIGlmIChlbmQgPCAwIHx8IGVuZCA+IHRoaXMubGVuZ3RoKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcignZW5kIG91dCBvZiBib3VuZHMnKVxuXG4gIHZhciBpXG4gIGlmICh0eXBlb2YgdmFsdWUgPT09ICdudW1iZXInKSB7XG4gICAgZm9yIChpID0gc3RhcnQ7IGkgPCBlbmQ7IGkrKykge1xuICAgICAgdGhpc1tpXSA9IHZhbHVlXG4gICAgfVxuICB9IGVsc2Uge1xuICAgIHZhciBieXRlcyA9IHV0ZjhUb0J5dGVzKHZhbHVlLnRvU3RyaW5nKCkpXG4gICAgdmFyIGxlbiA9IGJ5dGVzLmxlbmd0aFxuICAgIGZvciAoaSA9IHN0YXJ0OyBpIDwgZW5kOyBpKyspIHtcbiAgICAgIHRoaXNbaV0gPSBieXRlc1tpICUgbGVuXVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiB0aGlzXG59XG5cbi8qKlxuICogQ3JlYXRlcyBhIG5ldyBgQXJyYXlCdWZmZXJgIHdpdGggdGhlICpjb3BpZWQqIG1lbW9yeSBvZiB0aGUgYnVmZmVyIGluc3RhbmNlLlxuICogQWRkZWQgaW4gTm9kZSAwLjEyLiBPbmx5IGF2YWlsYWJsZSBpbiBicm93c2VycyB0aGF0IHN1cHBvcnQgQXJyYXlCdWZmZXIuXG4gKi9cbkJ1ZmZlci5wcm90b3R5cGUudG9BcnJheUJ1ZmZlciA9IGZ1bmN0aW9uIHRvQXJyYXlCdWZmZXIgKCkge1xuICBpZiAodHlwZW9mIFVpbnQ4QXJyYXkgIT09ICd1bmRlZmluZWQnKSB7XG4gICAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgICByZXR1cm4gKG5ldyBCdWZmZXIodGhpcykpLmJ1ZmZlclxuICAgIH0gZWxzZSB7XG4gICAgICB2YXIgYnVmID0gbmV3IFVpbnQ4QXJyYXkodGhpcy5sZW5ndGgpXG4gICAgICBmb3IgKHZhciBpID0gMCwgbGVuID0gYnVmLmxlbmd0aDsgaSA8IGxlbjsgaSArPSAxKSB7XG4gICAgICAgIGJ1ZltpXSA9IHRoaXNbaV1cbiAgICAgIH1cbiAgICAgIHJldHVybiBidWYuYnVmZmVyXG4gICAgfVxuICB9IGVsc2Uge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ0J1ZmZlci50b0FycmF5QnVmZmVyIG5vdCBzdXBwb3J0ZWQgaW4gdGhpcyBicm93c2VyJylcbiAgfVxufVxuXG4vLyBIRUxQRVIgRlVOQ1RJT05TXG4vLyA9PT09PT09PT09PT09PT09XG5cbnZhciBCUCA9IEJ1ZmZlci5wcm90b3R5cGVcblxuLyoqXG4gKiBBdWdtZW50IGEgVWludDhBcnJheSAqaW5zdGFuY2UqIChub3QgdGhlIFVpbnQ4QXJyYXkgY2xhc3MhKSB3aXRoIEJ1ZmZlciBtZXRob2RzXG4gKi9cbkJ1ZmZlci5fYXVnbWVudCA9IGZ1bmN0aW9uIF9hdWdtZW50IChhcnIpIHtcbiAgYXJyLmNvbnN0cnVjdG9yID0gQnVmZmVyXG4gIGFyci5faXNCdWZmZXIgPSB0cnVlXG5cbiAgLy8gc2F2ZSByZWZlcmVuY2UgdG8gb3JpZ2luYWwgVWludDhBcnJheSBzZXQgbWV0aG9kIGJlZm9yZSBvdmVyd3JpdGluZ1xuICBhcnIuX3NldCA9IGFyci5zZXRcblxuICAvLyBkZXByZWNhdGVkLCB3aWxsIGJlIHJlbW92ZWQgaW4gbm9kZSAwLjEzK1xuICBhcnIuZ2V0ID0gQlAuZ2V0XG4gIGFyci5zZXQgPSBCUC5zZXRcblxuICBhcnIud3JpdGUgPSBCUC53cml0ZVxuICBhcnIudG9TdHJpbmcgPSBCUC50b1N0cmluZ1xuICBhcnIudG9Mb2NhbGVTdHJpbmcgPSBCUC50b1N0cmluZ1xuICBhcnIudG9KU09OID0gQlAudG9KU09OXG4gIGFyci5lcXVhbHMgPSBCUC5lcXVhbHNcbiAgYXJyLmNvbXBhcmUgPSBCUC5jb21wYXJlXG4gIGFyci5pbmRleE9mID0gQlAuaW5kZXhPZlxuICBhcnIuY29weSA9IEJQLmNvcHlcbiAgYXJyLnNsaWNlID0gQlAuc2xpY2VcbiAgYXJyLnJlYWRVSW50TEUgPSBCUC5yZWFkVUludExFXG4gIGFyci5yZWFkVUludEJFID0gQlAucmVhZFVJbnRCRVxuICBhcnIucmVhZFVJbnQ4ID0gQlAucmVhZFVJbnQ4XG4gIGFyci5yZWFkVUludDE2TEUgPSBCUC5yZWFkVUludDE2TEVcbiAgYXJyLnJlYWRVSW50MTZCRSA9IEJQLnJlYWRVSW50MTZCRVxuICBhcnIucmVhZFVJbnQzMkxFID0gQlAucmVhZFVJbnQzMkxFXG4gIGFyci5yZWFkVUludDMyQkUgPSBCUC5yZWFkVUludDMyQkVcbiAgYXJyLnJlYWRJbnRMRSA9IEJQLnJlYWRJbnRMRVxuICBhcnIucmVhZEludEJFID0gQlAucmVhZEludEJFXG4gIGFyci5yZWFkSW50OCA9IEJQLnJlYWRJbnQ4XG4gIGFyci5yZWFkSW50MTZMRSA9IEJQLnJlYWRJbnQxNkxFXG4gIGFyci5yZWFkSW50MTZCRSA9IEJQLnJlYWRJbnQxNkJFXG4gIGFyci5yZWFkSW50MzJMRSA9IEJQLnJlYWRJbnQzMkxFXG4gIGFyci5yZWFkSW50MzJCRSA9IEJQLnJlYWRJbnQzMkJFXG4gIGFyci5yZWFkRmxvYXRMRSA9IEJQLnJlYWRGbG9hdExFXG4gIGFyci5yZWFkRmxvYXRCRSA9IEJQLnJlYWRGbG9hdEJFXG4gIGFyci5yZWFkRG91YmxlTEUgPSBCUC5yZWFkRG91YmxlTEVcbiAgYXJyLnJlYWREb3VibGVCRSA9IEJQLnJlYWREb3VibGVCRVxuICBhcnIud3JpdGVVSW50OCA9IEJQLndyaXRlVUludDhcbiAgYXJyLndyaXRlVUludExFID0gQlAud3JpdGVVSW50TEVcbiAgYXJyLndyaXRlVUludEJFID0gQlAud3JpdGVVSW50QkVcbiAgYXJyLndyaXRlVUludDE2TEUgPSBCUC53cml0ZVVJbnQxNkxFXG4gIGFyci53cml0ZVVJbnQxNkJFID0gQlAud3JpdGVVSW50MTZCRVxuICBhcnIud3JpdGVVSW50MzJMRSA9IEJQLndyaXRlVUludDMyTEVcbiAgYXJyLndyaXRlVUludDMyQkUgPSBCUC53cml0ZVVJbnQzMkJFXG4gIGFyci53cml0ZUludExFID0gQlAud3JpdGVJbnRMRVxuICBhcnIud3JpdGVJbnRCRSA9IEJQLndyaXRlSW50QkVcbiAgYXJyLndyaXRlSW50OCA9IEJQLndyaXRlSW50OFxuICBhcnIud3JpdGVJbnQxNkxFID0gQlAud3JpdGVJbnQxNkxFXG4gIGFyci53cml0ZUludDE2QkUgPSBCUC53cml0ZUludDE2QkVcbiAgYXJyLndyaXRlSW50MzJMRSA9IEJQLndyaXRlSW50MzJMRVxuICBhcnIud3JpdGVJbnQzMkJFID0gQlAud3JpdGVJbnQzMkJFXG4gIGFyci53cml0ZUZsb2F0TEUgPSBCUC53cml0ZUZsb2F0TEVcbiAgYXJyLndyaXRlRmxvYXRCRSA9IEJQLndyaXRlRmxvYXRCRVxuICBhcnIud3JpdGVEb3VibGVMRSA9IEJQLndyaXRlRG91YmxlTEVcbiAgYXJyLndyaXRlRG91YmxlQkUgPSBCUC53cml0ZURvdWJsZUJFXG4gIGFyci5maWxsID0gQlAuZmlsbFxuICBhcnIuaW5zcGVjdCA9IEJQLmluc3BlY3RcbiAgYXJyLnRvQXJyYXlCdWZmZXIgPSBCUC50b0FycmF5QnVmZmVyXG5cbiAgcmV0dXJuIGFyclxufVxuXG52YXIgSU5WQUxJRF9CQVNFNjRfUkUgPSAvW14rXFwvMC05QS16XFwtXS9nXG5cbmZ1bmN0aW9uIGJhc2U2NGNsZWFuIChzdHIpIHtcbiAgLy8gTm9kZSBzdHJpcHMgb3V0IGludmFsaWQgY2hhcmFjdGVycyBsaWtlIFxcbiBhbmQgXFx0IGZyb20gdGhlIHN0cmluZywgYmFzZTY0LWpzIGRvZXMgbm90XG4gIHN0ciA9IHN0cmluZ3RyaW0oc3RyKS5yZXBsYWNlKElOVkFMSURfQkFTRTY0X1JFLCAnJylcbiAgLy8gTm9kZSBjb252ZXJ0cyBzdHJpbmdzIHdpdGggbGVuZ3RoIDwgMiB0byAnJ1xuICBpZiAoc3RyLmxlbmd0aCA8IDIpIHJldHVybiAnJ1xuICAvLyBOb2RlIGFsbG93cyBmb3Igbm9uLXBhZGRlZCBiYXNlNjQgc3RyaW5ncyAobWlzc2luZyB0cmFpbGluZyA9PT0pLCBiYXNlNjQtanMgZG9lcyBub3RcbiAgd2hpbGUgKHN0ci5sZW5ndGggJSA0ICE9PSAwKSB7XG4gICAgc3RyID0gc3RyICsgJz0nXG4gIH1cbiAgcmV0dXJuIHN0clxufVxuXG5mdW5jdGlvbiBzdHJpbmd0cmltIChzdHIpIHtcbiAgaWYgKHN0ci50cmltKSByZXR1cm4gc3RyLnRyaW0oKVxuICByZXR1cm4gc3RyLnJlcGxhY2UoL15cXHMrfFxccyskL2csICcnKVxufVxuXG5mdW5jdGlvbiB0b0hleCAobikge1xuICBpZiAobiA8IDE2KSByZXR1cm4gJzAnICsgbi50b1N0cmluZygxNilcbiAgcmV0dXJuIG4udG9TdHJpbmcoMTYpXG59XG5cbmZ1bmN0aW9uIHV0ZjhUb0J5dGVzIChzdHJpbmcsIHVuaXRzKSB7XG4gIHVuaXRzID0gdW5pdHMgfHwgSW5maW5pdHlcbiAgdmFyIGNvZGVQb2ludFxuICB2YXIgbGVuZ3RoID0gc3RyaW5nLmxlbmd0aFxuICB2YXIgbGVhZFN1cnJvZ2F0ZSA9IG51bGxcbiAgdmFyIGJ5dGVzID0gW11cbiAgdmFyIGkgPSAwXG5cbiAgZm9yICg7IGkgPCBsZW5ndGg7IGkrKykge1xuICAgIGNvZGVQb2ludCA9IHN0cmluZy5jaGFyQ29kZUF0KGkpXG5cbiAgICAvLyBpcyBzdXJyb2dhdGUgY29tcG9uZW50XG4gICAgaWYgKGNvZGVQb2ludCA+IDB4RDdGRiAmJiBjb2RlUG9pbnQgPCAweEUwMDApIHtcbiAgICAgIC8vIGxhc3QgY2hhciB3YXMgYSBsZWFkXG4gICAgICBpZiAobGVhZFN1cnJvZ2F0ZSkge1xuICAgICAgICAvLyAyIGxlYWRzIGluIGEgcm93XG4gICAgICAgIGlmIChjb2RlUG9pbnQgPCAweERDMDApIHtcbiAgICAgICAgICBpZiAoKHVuaXRzIC09IDMpID4gLTEpIGJ5dGVzLnB1c2goMHhFRiwgMHhCRiwgMHhCRClcbiAgICAgICAgICBsZWFkU3Vycm9nYXRlID0gY29kZVBvaW50XG4gICAgICAgICAgY29udGludWVcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAvLyB2YWxpZCBzdXJyb2dhdGUgcGFpclxuICAgICAgICAgIGNvZGVQb2ludCA9IGxlYWRTdXJyb2dhdGUgLSAweEQ4MDAgPDwgMTAgfCBjb2RlUG9pbnQgLSAweERDMDAgfCAweDEwMDAwXG4gICAgICAgICAgbGVhZFN1cnJvZ2F0ZSA9IG51bGxcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgLy8gbm8gbGVhZCB5ZXRcblxuICAgICAgICBpZiAoY29kZVBvaW50ID4gMHhEQkZGKSB7XG4gICAgICAgICAgLy8gdW5leHBlY3RlZCB0cmFpbFxuICAgICAgICAgIGlmICgodW5pdHMgLT0gMykgPiAtMSkgYnl0ZXMucHVzaCgweEVGLCAweEJGLCAweEJEKVxuICAgICAgICAgIGNvbnRpbnVlXG4gICAgICAgIH0gZWxzZSBpZiAoaSArIDEgPT09IGxlbmd0aCkge1xuICAgICAgICAgIC8vIHVucGFpcmVkIGxlYWRcbiAgICAgICAgICBpZiAoKHVuaXRzIC09IDMpID4gLTEpIGJ5dGVzLnB1c2goMHhFRiwgMHhCRiwgMHhCRClcbiAgICAgICAgICBjb250aW51ZVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIC8vIHZhbGlkIGxlYWRcbiAgICAgICAgICBsZWFkU3Vycm9nYXRlID0gY29kZVBvaW50XG4gICAgICAgICAgY29udGludWVcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0gZWxzZSBpZiAobGVhZFN1cnJvZ2F0ZSkge1xuICAgICAgLy8gdmFsaWQgYm1wIGNoYXIsIGJ1dCBsYXN0IGNoYXIgd2FzIGEgbGVhZFxuICAgICAgaWYgKCh1bml0cyAtPSAzKSA+IC0xKSBieXRlcy5wdXNoKDB4RUYsIDB4QkYsIDB4QkQpXG4gICAgICBsZWFkU3Vycm9nYXRlID0gbnVsbFxuICAgIH1cblxuICAgIC8vIGVuY29kZSB1dGY4XG4gICAgaWYgKGNvZGVQb2ludCA8IDB4ODApIHtcbiAgICAgIGlmICgodW5pdHMgLT0gMSkgPCAwKSBicmVha1xuICAgICAgYnl0ZXMucHVzaChjb2RlUG9pbnQpXG4gICAgfSBlbHNlIGlmIChjb2RlUG9pbnQgPCAweDgwMCkge1xuICAgICAgaWYgKCh1bml0cyAtPSAyKSA8IDApIGJyZWFrXG4gICAgICBieXRlcy5wdXNoKFxuICAgICAgICBjb2RlUG9pbnQgPj4gMHg2IHwgMHhDMCxcbiAgICAgICAgY29kZVBvaW50ICYgMHgzRiB8IDB4ODBcbiAgICAgIClcbiAgICB9IGVsc2UgaWYgKGNvZGVQb2ludCA8IDB4MTAwMDApIHtcbiAgICAgIGlmICgodW5pdHMgLT0gMykgPCAwKSBicmVha1xuICAgICAgYnl0ZXMucHVzaChcbiAgICAgICAgY29kZVBvaW50ID4+IDB4QyB8IDB4RTAsXG4gICAgICAgIGNvZGVQb2ludCA+PiAweDYgJiAweDNGIHwgMHg4MCxcbiAgICAgICAgY29kZVBvaW50ICYgMHgzRiB8IDB4ODBcbiAgICAgIClcbiAgICB9IGVsc2UgaWYgKGNvZGVQb2ludCA8IDB4MjAwMDAwKSB7XG4gICAgICBpZiAoKHVuaXRzIC09IDQpIDwgMCkgYnJlYWtcbiAgICAgIGJ5dGVzLnB1c2goXG4gICAgICAgIGNvZGVQb2ludCA+PiAweDEyIHwgMHhGMCxcbiAgICAgICAgY29kZVBvaW50ID4+IDB4QyAmIDB4M0YgfCAweDgwLFxuICAgICAgICBjb2RlUG9pbnQgPj4gMHg2ICYgMHgzRiB8IDB4ODAsXG4gICAgICAgIGNvZGVQb2ludCAmIDB4M0YgfCAweDgwXG4gICAgICApXG4gICAgfSBlbHNlIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignSW52YWxpZCBjb2RlIHBvaW50JylcbiAgICB9XG4gIH1cblxuICByZXR1cm4gYnl0ZXNcbn1cblxuZnVuY3Rpb24gYXNjaWlUb0J5dGVzIChzdHIpIHtcbiAgdmFyIGJ5dGVBcnJheSA9IFtdXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgc3RyLmxlbmd0aDsgaSsrKSB7XG4gICAgLy8gTm9kZSdzIGNvZGUgc2VlbXMgdG8gYmUgZG9pbmcgdGhpcyBhbmQgbm90ICYgMHg3Ri4uXG4gICAgYnl0ZUFycmF5LnB1c2goc3RyLmNoYXJDb2RlQXQoaSkgJiAweEZGKVxuICB9XG4gIHJldHVybiBieXRlQXJyYXlcbn1cblxuZnVuY3Rpb24gdXRmMTZsZVRvQnl0ZXMgKHN0ciwgdW5pdHMpIHtcbiAgdmFyIGMsIGhpLCBsb1xuICB2YXIgYnl0ZUFycmF5ID0gW11cbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBzdHIubGVuZ3RoOyBpKyspIHtcbiAgICBpZiAoKHVuaXRzIC09IDIpIDwgMCkgYnJlYWtcblxuICAgIGMgPSBzdHIuY2hhckNvZGVBdChpKVxuICAgIGhpID0gYyA+PiA4XG4gICAgbG8gPSBjICUgMjU2XG4gICAgYnl0ZUFycmF5LnB1c2gobG8pXG4gICAgYnl0ZUFycmF5LnB1c2goaGkpXG4gIH1cblxuICByZXR1cm4gYnl0ZUFycmF5XG59XG5cbmZ1bmN0aW9uIGJhc2U2NFRvQnl0ZXMgKHN0cikge1xuICByZXR1cm4gYmFzZTY0LnRvQnl0ZUFycmF5KGJhc2U2NGNsZWFuKHN0cikpXG59XG5cbmZ1bmN0aW9uIGJsaXRCdWZmZXIgKHNyYywgZHN0LCBvZmZzZXQsIGxlbmd0aCkge1xuICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbmd0aDsgaSsrKSB7XG4gICAgaWYgKChpICsgb2Zmc2V0ID49IGRzdC5sZW5ndGgpIHx8IChpID49IHNyYy5sZW5ndGgpKSBicmVha1xuICAgIGRzdFtpICsgb2Zmc2V0XSA9IHNyY1tpXVxuICB9XG4gIHJldHVybiBpXG59XG5cbmZ1bmN0aW9uIGRlY29kZVV0ZjhDaGFyIChzdHIpIHtcbiAgdHJ5IHtcbiAgICByZXR1cm4gZGVjb2RlVVJJQ29tcG9uZW50KHN0cilcbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgcmV0dXJuIFN0cmluZy5mcm9tQ2hhckNvZGUoMHhGRkZEKSAvLyBVVEYgOCBpbnZhbGlkIGNoYXJcbiAgfVxufVxuIiwidmFyIGxvb2t1cCA9ICdBQkNERUZHSElKS0xNTk9QUVJTVFVWV1hZWmFiY2RlZmdoaWprbG1ub3BxcnN0dXZ3eHl6MDEyMzQ1Njc4OSsvJztcblxuOyhmdW5jdGlvbiAoZXhwb3J0cykge1xuXHQndXNlIHN0cmljdCc7XG5cbiAgdmFyIEFyciA9ICh0eXBlb2YgVWludDhBcnJheSAhPT0gJ3VuZGVmaW5lZCcpXG4gICAgPyBVaW50OEFycmF5XG4gICAgOiBBcnJheVxuXG5cdHZhciBQTFVTICAgPSAnKycuY2hhckNvZGVBdCgwKVxuXHR2YXIgU0xBU0ggID0gJy8nLmNoYXJDb2RlQXQoMClcblx0dmFyIE5VTUJFUiA9ICcwJy5jaGFyQ29kZUF0KDApXG5cdHZhciBMT1dFUiAgPSAnYScuY2hhckNvZGVBdCgwKVxuXHR2YXIgVVBQRVIgID0gJ0EnLmNoYXJDb2RlQXQoMClcblx0dmFyIFBMVVNfVVJMX1NBRkUgPSAnLScuY2hhckNvZGVBdCgwKVxuXHR2YXIgU0xBU0hfVVJMX1NBRkUgPSAnXycuY2hhckNvZGVBdCgwKVxuXG5cdGZ1bmN0aW9uIGRlY29kZSAoZWx0KSB7XG5cdFx0dmFyIGNvZGUgPSBlbHQuY2hhckNvZGVBdCgwKVxuXHRcdGlmIChjb2RlID09PSBQTFVTIHx8XG5cdFx0ICAgIGNvZGUgPT09IFBMVVNfVVJMX1NBRkUpXG5cdFx0XHRyZXR1cm4gNjIgLy8gJysnXG5cdFx0aWYgKGNvZGUgPT09IFNMQVNIIHx8XG5cdFx0ICAgIGNvZGUgPT09IFNMQVNIX1VSTF9TQUZFKVxuXHRcdFx0cmV0dXJuIDYzIC8vICcvJ1xuXHRcdGlmIChjb2RlIDwgTlVNQkVSKVxuXHRcdFx0cmV0dXJuIC0xIC8vbm8gbWF0Y2hcblx0XHRpZiAoY29kZSA8IE5VTUJFUiArIDEwKVxuXHRcdFx0cmV0dXJuIGNvZGUgLSBOVU1CRVIgKyAyNiArIDI2XG5cdFx0aWYgKGNvZGUgPCBVUFBFUiArIDI2KVxuXHRcdFx0cmV0dXJuIGNvZGUgLSBVUFBFUlxuXHRcdGlmIChjb2RlIDwgTE9XRVIgKyAyNilcblx0XHRcdHJldHVybiBjb2RlIC0gTE9XRVIgKyAyNlxuXHR9XG5cblx0ZnVuY3Rpb24gYjY0VG9CeXRlQXJyYXkgKGI2NCkge1xuXHRcdHZhciBpLCBqLCBsLCB0bXAsIHBsYWNlSG9sZGVycywgYXJyXG5cblx0XHRpZiAoYjY0Lmxlbmd0aCAlIDQgPiAwKSB7XG5cdFx0XHR0aHJvdyBuZXcgRXJyb3IoJ0ludmFsaWQgc3RyaW5nLiBMZW5ndGggbXVzdCBiZSBhIG11bHRpcGxlIG9mIDQnKVxuXHRcdH1cblxuXHRcdC8vIHRoZSBudW1iZXIgb2YgZXF1YWwgc2lnbnMgKHBsYWNlIGhvbGRlcnMpXG5cdFx0Ly8gaWYgdGhlcmUgYXJlIHR3byBwbGFjZWhvbGRlcnMsIHRoYW4gdGhlIHR3byBjaGFyYWN0ZXJzIGJlZm9yZSBpdFxuXHRcdC8vIHJlcHJlc2VudCBvbmUgYnl0ZVxuXHRcdC8vIGlmIHRoZXJlIGlzIG9ubHkgb25lLCB0aGVuIHRoZSB0aHJlZSBjaGFyYWN0ZXJzIGJlZm9yZSBpdCByZXByZXNlbnQgMiBieXRlc1xuXHRcdC8vIHRoaXMgaXMganVzdCBhIGNoZWFwIGhhY2sgdG8gbm90IGRvIGluZGV4T2YgdHdpY2Vcblx0XHR2YXIgbGVuID0gYjY0Lmxlbmd0aFxuXHRcdHBsYWNlSG9sZGVycyA9ICc9JyA9PT0gYjY0LmNoYXJBdChsZW4gLSAyKSA/IDIgOiAnPScgPT09IGI2NC5jaGFyQXQobGVuIC0gMSkgPyAxIDogMFxuXG5cdFx0Ly8gYmFzZTY0IGlzIDQvMyArIHVwIHRvIHR3byBjaGFyYWN0ZXJzIG9mIHRoZSBvcmlnaW5hbCBkYXRhXG5cdFx0YXJyID0gbmV3IEFycihiNjQubGVuZ3RoICogMyAvIDQgLSBwbGFjZUhvbGRlcnMpXG5cblx0XHQvLyBpZiB0aGVyZSBhcmUgcGxhY2Vob2xkZXJzLCBvbmx5IGdldCB1cCB0byB0aGUgbGFzdCBjb21wbGV0ZSA0IGNoYXJzXG5cdFx0bCA9IHBsYWNlSG9sZGVycyA+IDAgPyBiNjQubGVuZ3RoIC0gNCA6IGI2NC5sZW5ndGhcblxuXHRcdHZhciBMID0gMFxuXG5cdFx0ZnVuY3Rpb24gcHVzaCAodikge1xuXHRcdFx0YXJyW0wrK10gPSB2XG5cdFx0fVxuXG5cdFx0Zm9yIChpID0gMCwgaiA9IDA7IGkgPCBsOyBpICs9IDQsIGogKz0gMykge1xuXHRcdFx0dG1wID0gKGRlY29kZShiNjQuY2hhckF0KGkpKSA8PCAxOCkgfCAoZGVjb2RlKGI2NC5jaGFyQXQoaSArIDEpKSA8PCAxMikgfCAoZGVjb2RlKGI2NC5jaGFyQXQoaSArIDIpKSA8PCA2KSB8IGRlY29kZShiNjQuY2hhckF0KGkgKyAzKSlcblx0XHRcdHB1c2goKHRtcCAmIDB4RkYwMDAwKSA+PiAxNilcblx0XHRcdHB1c2goKHRtcCAmIDB4RkYwMCkgPj4gOClcblx0XHRcdHB1c2godG1wICYgMHhGRilcblx0XHR9XG5cblx0XHRpZiAocGxhY2VIb2xkZXJzID09PSAyKSB7XG5cdFx0XHR0bXAgPSAoZGVjb2RlKGI2NC5jaGFyQXQoaSkpIDw8IDIpIHwgKGRlY29kZShiNjQuY2hhckF0KGkgKyAxKSkgPj4gNClcblx0XHRcdHB1c2godG1wICYgMHhGRilcblx0XHR9IGVsc2UgaWYgKHBsYWNlSG9sZGVycyA9PT0gMSkge1xuXHRcdFx0dG1wID0gKGRlY29kZShiNjQuY2hhckF0KGkpKSA8PCAxMCkgfCAoZGVjb2RlKGI2NC5jaGFyQXQoaSArIDEpKSA8PCA0KSB8IChkZWNvZGUoYjY0LmNoYXJBdChpICsgMikpID4+IDIpXG5cdFx0XHRwdXNoKCh0bXAgPj4gOCkgJiAweEZGKVxuXHRcdFx0cHVzaCh0bXAgJiAweEZGKVxuXHRcdH1cblxuXHRcdHJldHVybiBhcnJcblx0fVxuXG5cdGZ1bmN0aW9uIHVpbnQ4VG9CYXNlNjQgKHVpbnQ4KSB7XG5cdFx0dmFyIGksXG5cdFx0XHRleHRyYUJ5dGVzID0gdWludDgubGVuZ3RoICUgMywgLy8gaWYgd2UgaGF2ZSAxIGJ5dGUgbGVmdCwgcGFkIDIgYnl0ZXNcblx0XHRcdG91dHB1dCA9IFwiXCIsXG5cdFx0XHR0ZW1wLCBsZW5ndGhcblxuXHRcdGZ1bmN0aW9uIGVuY29kZSAobnVtKSB7XG5cdFx0XHRyZXR1cm4gbG9va3VwLmNoYXJBdChudW0pXG5cdFx0fVxuXG5cdFx0ZnVuY3Rpb24gdHJpcGxldFRvQmFzZTY0IChudW0pIHtcblx0XHRcdHJldHVybiBlbmNvZGUobnVtID4+IDE4ICYgMHgzRikgKyBlbmNvZGUobnVtID4+IDEyICYgMHgzRikgKyBlbmNvZGUobnVtID4+IDYgJiAweDNGKSArIGVuY29kZShudW0gJiAweDNGKVxuXHRcdH1cblxuXHRcdC8vIGdvIHRocm91Z2ggdGhlIGFycmF5IGV2ZXJ5IHRocmVlIGJ5dGVzLCB3ZSdsbCBkZWFsIHdpdGggdHJhaWxpbmcgc3R1ZmYgbGF0ZXJcblx0XHRmb3IgKGkgPSAwLCBsZW5ndGggPSB1aW50OC5sZW5ndGggLSBleHRyYUJ5dGVzOyBpIDwgbGVuZ3RoOyBpICs9IDMpIHtcblx0XHRcdHRlbXAgPSAodWludDhbaV0gPDwgMTYpICsgKHVpbnQ4W2kgKyAxXSA8PCA4KSArICh1aW50OFtpICsgMl0pXG5cdFx0XHRvdXRwdXQgKz0gdHJpcGxldFRvQmFzZTY0KHRlbXApXG5cdFx0fVxuXG5cdFx0Ly8gcGFkIHRoZSBlbmQgd2l0aCB6ZXJvcywgYnV0IG1ha2Ugc3VyZSB0byBub3QgZm9yZ2V0IHRoZSBleHRyYSBieXRlc1xuXHRcdHN3aXRjaCAoZXh0cmFCeXRlcykge1xuXHRcdFx0Y2FzZSAxOlxuXHRcdFx0XHR0ZW1wID0gdWludDhbdWludDgubGVuZ3RoIC0gMV1cblx0XHRcdFx0b3V0cHV0ICs9IGVuY29kZSh0ZW1wID4+IDIpXG5cdFx0XHRcdG91dHB1dCArPSBlbmNvZGUoKHRlbXAgPDwgNCkgJiAweDNGKVxuXHRcdFx0XHRvdXRwdXQgKz0gJz09J1xuXHRcdFx0XHRicmVha1xuXHRcdFx0Y2FzZSAyOlxuXHRcdFx0XHR0ZW1wID0gKHVpbnQ4W3VpbnQ4Lmxlbmd0aCAtIDJdIDw8IDgpICsgKHVpbnQ4W3VpbnQ4Lmxlbmd0aCAtIDFdKVxuXHRcdFx0XHRvdXRwdXQgKz0gZW5jb2RlKHRlbXAgPj4gMTApXG5cdFx0XHRcdG91dHB1dCArPSBlbmNvZGUoKHRlbXAgPj4gNCkgJiAweDNGKVxuXHRcdFx0XHRvdXRwdXQgKz0gZW5jb2RlKCh0ZW1wIDw8IDIpICYgMHgzRilcblx0XHRcdFx0b3V0cHV0ICs9ICc9J1xuXHRcdFx0XHRicmVha1xuXHRcdH1cblxuXHRcdHJldHVybiBvdXRwdXRcblx0fVxuXG5cdGV4cG9ydHMudG9CeXRlQXJyYXkgPSBiNjRUb0J5dGVBcnJheVxuXHRleHBvcnRzLmZyb21CeXRlQXJyYXkgPSB1aW50OFRvQmFzZTY0XG59KHR5cGVvZiBleHBvcnRzID09PSAndW5kZWZpbmVkJyA/ICh0aGlzLmJhc2U2NGpzID0ge30pIDogZXhwb3J0cykpXG4iLCJleHBvcnRzLnJlYWQgPSBmdW5jdGlvbiAoYnVmZmVyLCBvZmZzZXQsIGlzTEUsIG1MZW4sIG5CeXRlcykge1xuICB2YXIgZSwgbVxuICB2YXIgZUxlbiA9IG5CeXRlcyAqIDggLSBtTGVuIC0gMVxuICB2YXIgZU1heCA9ICgxIDw8IGVMZW4pIC0gMVxuICB2YXIgZUJpYXMgPSBlTWF4ID4+IDFcbiAgdmFyIG5CaXRzID0gLTdcbiAgdmFyIGkgPSBpc0xFID8gKG5CeXRlcyAtIDEpIDogMFxuICB2YXIgZCA9IGlzTEUgPyAtMSA6IDFcbiAgdmFyIHMgPSBidWZmZXJbb2Zmc2V0ICsgaV1cblxuICBpICs9IGRcblxuICBlID0gcyAmICgoMSA8PCAoLW5CaXRzKSkgLSAxKVxuICBzID4+PSAoLW5CaXRzKVxuICBuQml0cyArPSBlTGVuXG4gIGZvciAoOyBuQml0cyA+IDA7IGUgPSBlICogMjU2ICsgYnVmZmVyW29mZnNldCArIGldLCBpICs9IGQsIG5CaXRzIC09IDgpIHt9XG5cbiAgbSA9IGUgJiAoKDEgPDwgKC1uQml0cykpIC0gMSlcbiAgZSA+Pj0gKC1uQml0cylcbiAgbkJpdHMgKz0gbUxlblxuICBmb3IgKDsgbkJpdHMgPiAwOyBtID0gbSAqIDI1NiArIGJ1ZmZlcltvZmZzZXQgKyBpXSwgaSArPSBkLCBuQml0cyAtPSA4KSB7fVxuXG4gIGlmIChlID09PSAwKSB7XG4gICAgZSA9IDEgLSBlQmlhc1xuICB9IGVsc2UgaWYgKGUgPT09IGVNYXgpIHtcbiAgICByZXR1cm4gbSA/IE5hTiA6ICgocyA/IC0xIDogMSkgKiBJbmZpbml0eSlcbiAgfSBlbHNlIHtcbiAgICBtID0gbSArIE1hdGgucG93KDIsIG1MZW4pXG4gICAgZSA9IGUgLSBlQmlhc1xuICB9XG4gIHJldHVybiAocyA/IC0xIDogMSkgKiBtICogTWF0aC5wb3coMiwgZSAtIG1MZW4pXG59XG5cbmV4cG9ydHMud3JpdGUgPSBmdW5jdGlvbiAoYnVmZmVyLCB2YWx1ZSwgb2Zmc2V0LCBpc0xFLCBtTGVuLCBuQnl0ZXMpIHtcbiAgdmFyIGUsIG0sIGNcbiAgdmFyIGVMZW4gPSBuQnl0ZXMgKiA4IC0gbUxlbiAtIDFcbiAgdmFyIGVNYXggPSAoMSA8PCBlTGVuKSAtIDFcbiAgdmFyIGVCaWFzID0gZU1heCA+PiAxXG4gIHZhciBydCA9IChtTGVuID09PSAyMyA/IE1hdGgucG93KDIsIC0yNCkgLSBNYXRoLnBvdygyLCAtNzcpIDogMClcbiAgdmFyIGkgPSBpc0xFID8gMCA6IChuQnl0ZXMgLSAxKVxuICB2YXIgZCA9IGlzTEUgPyAxIDogLTFcbiAgdmFyIHMgPSB2YWx1ZSA8IDAgfHwgKHZhbHVlID09PSAwICYmIDEgLyB2YWx1ZSA8IDApID8gMSA6IDBcblxuICB2YWx1ZSA9IE1hdGguYWJzKHZhbHVlKVxuXG4gIGlmIChpc05hTih2YWx1ZSkgfHwgdmFsdWUgPT09IEluZmluaXR5KSB7XG4gICAgbSA9IGlzTmFOKHZhbHVlKSA/IDEgOiAwXG4gICAgZSA9IGVNYXhcbiAgfSBlbHNlIHtcbiAgICBlID0gTWF0aC5mbG9vcihNYXRoLmxvZyh2YWx1ZSkgLyBNYXRoLkxOMilcbiAgICBpZiAodmFsdWUgKiAoYyA9IE1hdGgucG93KDIsIC1lKSkgPCAxKSB7XG4gICAgICBlLS1cbiAgICAgIGMgKj0gMlxuICAgIH1cbiAgICBpZiAoZSArIGVCaWFzID49IDEpIHtcbiAgICAgIHZhbHVlICs9IHJ0IC8gY1xuICAgIH0gZWxzZSB7XG4gICAgICB2YWx1ZSArPSBydCAqIE1hdGgucG93KDIsIDEgLSBlQmlhcylcbiAgICB9XG4gICAgaWYgKHZhbHVlICogYyA+PSAyKSB7XG4gICAgICBlKytcbiAgICAgIGMgLz0gMlxuICAgIH1cblxuICAgIGlmIChlICsgZUJpYXMgPj0gZU1heCkge1xuICAgICAgbSA9IDBcbiAgICAgIGUgPSBlTWF4XG4gICAgfSBlbHNlIGlmIChlICsgZUJpYXMgPj0gMSkge1xuICAgICAgbSA9ICh2YWx1ZSAqIGMgLSAxKSAqIE1hdGgucG93KDIsIG1MZW4pXG4gICAgICBlID0gZSArIGVCaWFzXG4gICAgfSBlbHNlIHtcbiAgICAgIG0gPSB2YWx1ZSAqIE1hdGgucG93KDIsIGVCaWFzIC0gMSkgKiBNYXRoLnBvdygyLCBtTGVuKVxuICAgICAgZSA9IDBcbiAgICB9XG4gIH1cblxuICBmb3IgKDsgbUxlbiA+PSA4OyBidWZmZXJbb2Zmc2V0ICsgaV0gPSBtICYgMHhmZiwgaSArPSBkLCBtIC89IDI1NiwgbUxlbiAtPSA4KSB7fVxuXG4gIGUgPSAoZSA8PCBtTGVuKSB8IG1cbiAgZUxlbiArPSBtTGVuXG4gIGZvciAoOyBlTGVuID4gMDsgYnVmZmVyW29mZnNldCArIGldID0gZSAmIDB4ZmYsIGkgKz0gZCwgZSAvPSAyNTYsIGVMZW4gLT0gOCkge31cblxuICBidWZmZXJbb2Zmc2V0ICsgaSAtIGRdIHw9IHMgKiAxMjhcbn1cbiIsIlxuLyoqXG4gKiBpc0FycmF5XG4gKi9cblxudmFyIGlzQXJyYXkgPSBBcnJheS5pc0FycmF5O1xuXG4vKipcbiAqIHRvU3RyaW5nXG4gKi9cblxudmFyIHN0ciA9IE9iamVjdC5wcm90b3R5cGUudG9TdHJpbmc7XG5cbi8qKlxuICogV2hldGhlciBvciBub3QgdGhlIGdpdmVuIGB2YWxgXG4gKiBpcyBhbiBhcnJheS5cbiAqXG4gKiBleGFtcGxlOlxuICpcbiAqICAgICAgICBpc0FycmF5KFtdKTtcbiAqICAgICAgICAvLyA+IHRydWVcbiAqICAgICAgICBpc0FycmF5KGFyZ3VtZW50cyk7XG4gKiAgICAgICAgLy8gPiBmYWxzZVxuICogICAgICAgIGlzQXJyYXkoJycpO1xuICogICAgICAgIC8vID4gZmFsc2VcbiAqXG4gKiBAcGFyYW0ge21peGVkfSB2YWxcbiAqIEByZXR1cm4ge2Jvb2x9XG4gKi9cblxubW9kdWxlLmV4cG9ydHMgPSBpc0FycmF5IHx8IGZ1bmN0aW9uICh2YWwpIHtcbiAgcmV0dXJuICEhIHZhbCAmJiAnW29iamVjdCBBcnJheV0nID09IHN0ci5jYWxsKHZhbCk7XG59O1xuIiwiLy8gc2hpbSBmb3IgdXNpbmcgcHJvY2VzcyBpbiBicm93c2VyXG5cbnZhciBwcm9jZXNzID0gbW9kdWxlLmV4cG9ydHMgPSB7fTtcbnZhciBxdWV1ZSA9IFtdO1xudmFyIGRyYWluaW5nID0gZmFsc2U7XG52YXIgY3VycmVudFF1ZXVlO1xudmFyIHF1ZXVlSW5kZXggPSAtMTtcblxuZnVuY3Rpb24gY2xlYW5VcE5leHRUaWNrKCkge1xuICAgIGRyYWluaW5nID0gZmFsc2U7XG4gICAgaWYgKGN1cnJlbnRRdWV1ZS5sZW5ndGgpIHtcbiAgICAgICAgcXVldWUgPSBjdXJyZW50UXVldWUuY29uY2F0KHF1ZXVlKTtcbiAgICB9IGVsc2Uge1xuICAgICAgICBxdWV1ZUluZGV4ID0gLTE7XG4gICAgfVxuICAgIGlmIChxdWV1ZS5sZW5ndGgpIHtcbiAgICAgICAgZHJhaW5RdWV1ZSgpO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gZHJhaW5RdWV1ZSgpIHtcbiAgICBpZiAoZHJhaW5pbmcpIHtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB2YXIgdGltZW91dCA9IHNldFRpbWVvdXQoY2xlYW5VcE5leHRUaWNrKTtcbiAgICBkcmFpbmluZyA9IHRydWU7XG5cbiAgICB2YXIgbGVuID0gcXVldWUubGVuZ3RoO1xuICAgIHdoaWxlKGxlbikge1xuICAgICAgICBjdXJyZW50UXVldWUgPSBxdWV1ZTtcbiAgICAgICAgcXVldWUgPSBbXTtcbiAgICAgICAgd2hpbGUgKCsrcXVldWVJbmRleCA8IGxlbikge1xuICAgICAgICAgICAgY3VycmVudFF1ZXVlW3F1ZXVlSW5kZXhdLnJ1bigpO1xuICAgICAgICB9XG4gICAgICAgIHF1ZXVlSW5kZXggPSAtMTtcbiAgICAgICAgbGVuID0gcXVldWUubGVuZ3RoO1xuICAgIH1cbiAgICBjdXJyZW50UXVldWUgPSBudWxsO1xuICAgIGRyYWluaW5nID0gZmFsc2U7XG4gICAgY2xlYXJUaW1lb3V0KHRpbWVvdXQpO1xufVxuXG5wcm9jZXNzLm5leHRUaWNrID0gZnVuY3Rpb24gKGZ1bikge1xuICAgIHZhciBhcmdzID0gbmV3IEFycmF5KGFyZ3VtZW50cy5sZW5ndGggLSAxKTtcbiAgICBpZiAoYXJndW1lbnRzLmxlbmd0aCA+IDEpIHtcbiAgICAgICAgZm9yICh2YXIgaSA9IDE7IGkgPCBhcmd1bWVudHMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIGFyZ3NbaSAtIDFdID0gYXJndW1lbnRzW2ldO1xuICAgICAgICB9XG4gICAgfVxuICAgIHF1ZXVlLnB1c2gobmV3IEl0ZW0oZnVuLCBhcmdzKSk7XG4gICAgaWYgKHF1ZXVlLmxlbmd0aCA9PT0gMSAmJiAhZHJhaW5pbmcpIHtcbiAgICAgICAgc2V0VGltZW91dChkcmFpblF1ZXVlLCAwKTtcbiAgICB9XG59O1xuXG4vLyB2OCBsaWtlcyBwcmVkaWN0aWJsZSBvYmplY3RzXG5mdW5jdGlvbiBJdGVtKGZ1biwgYXJyYXkpIHtcbiAgICB0aGlzLmZ1biA9IGZ1bjtcbiAgICB0aGlzLmFycmF5ID0gYXJyYXk7XG59XG5JdGVtLnByb3RvdHlwZS5ydW4gPSBmdW5jdGlvbiAoKSB7XG4gICAgdGhpcy5mdW4uYXBwbHkobnVsbCwgdGhpcy5hcnJheSk7XG59O1xucHJvY2Vzcy50aXRsZSA9ICdicm93c2VyJztcbnByb2Nlc3MuYnJvd3NlciA9IHRydWU7XG5wcm9jZXNzLmVudiA9IHt9O1xucHJvY2Vzcy5hcmd2ID0gW107XG5wcm9jZXNzLnZlcnNpb24gPSAnJzsgLy8gZW1wdHkgc3RyaW5nIHRvIGF2b2lkIHJlZ2V4cCBpc3N1ZXNcbnByb2Nlc3MudmVyc2lvbnMgPSB7fTtcblxuZnVuY3Rpb24gbm9vcCgpIHt9XG5cbnByb2Nlc3Mub24gPSBub29wO1xucHJvY2Vzcy5hZGRMaXN0ZW5lciA9IG5vb3A7XG5wcm9jZXNzLm9uY2UgPSBub29wO1xucHJvY2Vzcy5vZmYgPSBub29wO1xucHJvY2Vzcy5yZW1vdmVMaXN0ZW5lciA9IG5vb3A7XG5wcm9jZXNzLnJlbW92ZUFsbExpc3RlbmVycyA9IG5vb3A7XG5wcm9jZXNzLmVtaXQgPSBub29wO1xuXG5wcm9jZXNzLmJpbmRpbmcgPSBmdW5jdGlvbiAobmFtZSkge1xuICAgIHRocm93IG5ldyBFcnJvcigncHJvY2Vzcy5iaW5kaW5nIGlzIG5vdCBzdXBwb3J0ZWQnKTtcbn07XG5cbi8vIFRPRE8oc2h0eWxtYW4pXG5wcm9jZXNzLmN3ZCA9IGZ1bmN0aW9uICgpIHsgcmV0dXJuICcvJyB9O1xucHJvY2Vzcy5jaGRpciA9IGZ1bmN0aW9uIChkaXIpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ3Byb2Nlc3MuY2hkaXIgaXMgbm90IHN1cHBvcnRlZCcpO1xufTtcbnByb2Nlc3MudW1hc2sgPSBmdW5jdGlvbigpIHsgcmV0dXJuIDA7IH07XG4iLCJyZXF1aXJlKCdqb29zZScpO1xyXG52YXIgVXRpbHMgPSByZXF1aXJlKCcuL1V0aWxzJyk7XHJcbnZhciBDT05GSUcgPSByZXF1aXJlKCcuL0NvbmZpZycpO1xyXG5DbGFzcyhcIkJhY2tlbmRTdHJlYW1cIixcclxue1xyXG4gICAgaGFzOlxyXG4gICAge1xyXG5cdFx0dXJsIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6ICh3aW5kb3cubG9jYXRpb24uaG9zdC5pbmRleE9mKFwibG9jYWxob3N0XCIpID09IDAgfHwgd2luZG93LmxvY2F0aW9uLmhvc3QuaW5kZXhPZihcIjEyNy4wLjAuMVwiKSA9PSAwKSA/IFwiaHR0cDovL2xvY2FsaG9zdDozMDAwL3N0cmVhbVwiIDogXCJub2RlL3N0cmVhbVwiXHJcblx0XHR9LFxyXG4gICAgfSxcclxuICAgIC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuICAgIG1ldGhvZHM6XHJcbiAgICB7XHJcbiAgICAgICAgc3RhcnQgOiBmdW5jdGlvbih0cmFjaylcclxuICAgICAgICB7ICAgICAgICBcdFxyXG4gICAgICAgIFx0Ly8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tICAgICAgICBcdFxyXG4gICAgXHRcdHZhciBkZWxheSA9IC0obmV3IERhdGUoKSkuZ2V0VGltZXpvbmVPZmZzZXQoKSo2MCoxMDAwO1x0Ly8gMTIwIGZvciBnbXQrMlxyXG4gICAgXHRcdHZhciB1cmwgPSB0aGlzLnVybDtcclxuICAgICAgICBcdGZ1bmN0aW9uIGRvVGljaygpIFxyXG4gICAgICAgIFx0e1xyXG4gICAgICAgICAgICAgICAgdmFyIG1tYXAgPSB7fTtcclxuICAgICAgICAgICAgICAgIHZhciBjdGltZSA9IChuZXcgRGF0ZSgpKS5nZXRUaW1lKCk7XHJcbiAgICAgICAgICAgICAgICB2YXIganNvbiA9IFtdO1xyXG4gICAgICAgICAgICAgICAgZm9yICh2YXIgaSBpbiB0cmFjay5wYXJ0aWNpcGFudHMpIFxyXG4gICAgICAgICAgICAgICAge1xyXG4gICAgICAgICAgICAgICAgXHR2YXIgcHAgPSB0cmFjay5wYXJ0aWNpcGFudHNbaV07XHJcbiAgICAgICAgICAgICAgICBcdGlmIChwcC5pc0Zhdm9yaXRlKVxyXG4gICAgICAgICAgICAgICAgXHRcdG1tYXBbcHAuZGV2aWNlSWRdPXBwO1xyXG4gICAgICAgICAgICAgICAgXHR2YXIgcmVmdCA9IGN0aW1lIC0gMTAqNjAqMTAwMDtcclxuICAgICAgICAgICAgICAgIFx0aWYgKCFwcC5fX3N0YXJ0VGltZSB8fCBwcC5fX3N0YXJ0VGltZSA8IHJlZnQpIHtcclxuICAgICAgICAgICAgICAgIFx0XHRwcC5fX3N0YXJ0VGltZT1yZWZ0O1xyXG4gICAgICAgICAgICAgICAgXHR9XHJcbiAgICAgICAgICAgICAgICBcdGpzb24ucHVzaCh7c3RhcnQ6cHAuX19zdGFydFRpbWUtZGVsYXksZW5kIDogY3RpbWUtZGVsYXksaW1laTpwcC5kZXZpY2VJZH0pO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgaWYgKCFqc29uLmxlbmd0aClcclxuICAgICAgICAgICAgICAgIFx0cmV0dXJuO1xyXG4gICAgICAgICAgICAgICAgZnVuY3Rpb24gcHJvY2Vzc0RhdGEoZGF0YSkgXHJcbiAgICAgICAgICAgICAgICB7XHJcbiAgICAgICAgICAgICAgICBcdGZvciAodmFyIGkgaW4gZGF0YSkgXHJcbiAgICAgICAgICAgICAgICBcdHtcclxuICAgICAgICAgICAgICAgIFx0XHRkYXRhW2ldLnRpbWVzdGFtcCs9ZGVsYXk7XHJcbiAgICAgICAgICAgICAgICBcdFx0Ly9jb25zb2xlLndhcm4oZGF0YVtpXSk7XHJcbiAgICAgICAgICAgICAgICBcdFx0dmFyIHBwID0gbW1hcFtkYXRhW2ldLmltZWldO1xyXG4gICAgICAgICAgICAgICAgXHRcdGlmIChwcCkge1xyXG4gICAgICAgICAgICAgICAgXHRcdFx0aWYgKGRhdGFbaV0udGltZXN0YW1wKzEgPiBwcC5fX3N0YXJ0VGltZSlcclxuICAgICAgICAgICAgICAgIFx0XHRcdFx0cHAuX19zdGFydFRpbWU9ZGF0YVtpXS50aW1lc3RhbXArMTtcclxuICAgICAgICAgICAgICAgIFx0XHRcdHBwLnBpbmdDYWxjdWxhdGVkKGRhdGFbaV0pO1xyXG4gICAgICAgICAgICAgICAgXHRcdH1cclxuICAgICAgICAgICAgICAgIFx0fVxyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgLy9jb25zb2xlLmxvZyhqc29uKTtcclxuICAgICAgICAgICAgICAgICQuYWpheCh7XHJcbiAgICAgICAgICAgICAgICAgICAgdHlwZTogXCJQT1NUXCIsXHJcbiAgICAgICAgICAgICAgICAgICAgdXJsOiB1cmwsXHJcbiAgICAgICAgICAgICAgICAgICAgZGF0YTogSlNPTi5zdHJpbmdpZnkoanNvbiksXHJcbiAgICAgICAgICAgICAgICAgICAgY29udGVudFR5cGU6IFwiYXBwbGljYXRpb24vanNvbjsgY2hhcnNldD11dGYtOFwiLFxyXG4gICAgICAgICAgICAgICAgICAgIGRhdGFUeXBlOiBcImpzb25cIixcclxuICAgICAgICAgICAgICAgICAgICBzdWNjZXNzOiBmdW5jdGlvbihkYXRhKXtcclxuICAgICAgICAgICAgICAgICAgICAgICAgcHJvY2Vzc0RhdGEoZGF0YSk7XHJcbiAgICAgICAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgICAgICAgICBmYWlsdXJlOiBmdW5jdGlvbihlcnJNc2cpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcihcIkVSUk9SIGdldCBkYXRhIGZyb20gYmFja2VuZCBcIitlcnJNc2cpXHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICBzZXRUaW1lb3V0KGRvVGljayxDT05GSUcudGltZW91dHMuc3RyZWFtRGF0YUludGVydmFsKjEwMDApO1xyXG4gICAgICAgIFx0fVxyXG4gICAgICAgIFx0ZG9UaWNrKCk7XHJcbiAgICAgICAgfVxyXG4gICAgfSAgICBcclxufSk7XHJcbiIsInZhciBVdGlscyA9IHJlcXVpcmUoXCIuL1V0aWxzLmpzXCIpO1xyXG5cclxudmFyIENPTkZJRyA9IFxyXG57XHJcblx0dGltZW91dHMgOiAvLyBpbiBzZWNvbmRzXHJcblx0e1xyXG5cdFx0ZGV2aWNlVGltZW91dCA6IDYwKjUsXHJcblx0XHRhbmltYXRpb25GcmFtZSA6IFV0aWxzLm1vYmlsZUFuZFRhYmxldENoZWNrKCkgPyAwLjQgOiAwLjEsXHJcblx0XHRncHNMb2NhdGlvbkRlYnVnU2hvdyA6IDQsXHRcdC8vIHRpbWUgdG8gc2hvdyBncHMgbG9jYXRpb24gKGRlYnVnKSBpbmZvXHJcblx0XHRzdHJlYW1EYXRhSW50ZXJ2YWwgOiAxMCBcdFx0LyogTk9STUFMIDEwIHNlY29uZHMgKi9cclxuXHR9LFxyXG5cdGRpc3RhbmNlcyA6IC8vIGluIG1cclxuXHR7XHJcblx0XHRzdGF5T25Sb2FkVG9sZXJhbmNlIDogNTAwLFx0Ly8gNTAwbSBzdGF5IG9uIHJvYWQgdG9sZXJhbmNlXHJcblx0XHRlbGFwc2VkRGlyZWN0aW9uRXBzaWxvbiA6IDUwMCAvLyA1MDBtIGRpcmVjdGlvbiB0b2xlcmFuY2UsIHRvbyBmYXN0IG1vdmVtZW50IHdpbGwgZGlzY2FyZCBcclxuXHR9LFxyXG5cdGNvbnN0cmFpbnRzIDoge1xyXG5cdFx0YmFja3dhcmRzRXBzaWxvbkluTWV0ZXIgOiA0MDAsIC8vMjIwIG0gbW92ZW1lbnQgaW4gdGhlIGJhY2t3YXJkIGRpcmVjdGlvbiB3aWxsIG5vdCB0cmlnZ2VyIG5leHQgcnVuIGNvdW50ZXIgaW5jcmVtZW50XHRcdFxyXG5cdFx0bWF4U3BlZWQgOiAyMCxcdC8va21oXHJcblx0XHRtYXhQYXJ0aWNpcGFudFN0YXRlSGlzdG9yeSA6IDEwMDAsIC8vIG51bWJlciBvZiBlbGVtZW50c1xyXG5cdFx0cG9wdXBFbnN1cmVWaXNpYmxlV2lkdGggOiAyMDAsXHJcblx0XHRwb3B1cEVuc3VyZVZpc2libGVIZWlnaHQ6IDEyMFxyXG5cdH0sXHJcblx0c2ltdWxhdGlvbiA6IHtcclxuXHRcdHBpbmdJbnRlcnZhbCA6IDEwLCAvLyBpbnRlcnZhbCBpbiBzZWNvbmRzIHRvIHBpbmcgd2l0aCBncHMgZGF0YVxyXG5cdFx0Z3BzSW5hY2N1cmFjeSA6IDAgIC8vIGVycm9yIHNpbXVsYXRpb24gaW4gTUVURVIgKGxvb2sgbWF0aC5ncHNJbmFjY3VyYWN5LCBtaW4gMS8yKVxyXG5cdH0sXHRcclxuXHRtYXRoIDoge1xyXG5cdFx0Z3BzSW5hY2N1cmFjeSA6IDMsXHQvL1RPRE8gMTMgbWluXHJcblx0XHRzcGVlZEFuZEFjY2VsZXJhdGlvbkF2ZXJhZ2VEZWdyZWUgOiAyLFx0Ly8gY2FsY3VsYXRpb24gYmFzZWQgb24gTiBzdGF0ZXMgKGF2ZXJhZ2UpIChNSU4gMilcclxuXHRcdGRpc3BsYXlEZWxheSA6IDgwLFx0XHRcdFx0XHRcdC8vIGRpc3BsYXkgZGVsYXkgaW4gU0VDT05EU1xyXG5cdFx0aW50ZXJwb2xhdGVHUFNBdmVyYWdlIDogMCwgLy8gbnVtYmVyIG9mIHJlY2VudCB2YWx1ZXMgdG8gY2FsY3VsYXRlIGF2ZXJhZ2UgZ3BzIGZvciBwb3NpdGlvbiAoc21vb3RoaW5nIHRoZSBjdXJ2ZS5taW4gMCA9IE5PLDEgPSAyIHZhbHVlcyAoY3VycmVudCBhbmQgbGFzdCkpXHJcblx0XHRyb2FkRGlzdGFuY2VCZXN0UG9pbnRDYWxjdWxhdGlvbkNvZWYgOiAwLjIgLy8gVE9ETyBFWFBMQUlOXHJcblx0fSxcclxuXHRjb25zdGFudHMgOiBcclxuXHR7XHJcblx0XHRhZ2VHcm91cHMgOiAgXHJcblx0XHRbXHJcblx0XHQge1xyXG5cdFx0XHQgZnJvbSA6IG51bGwsXHJcblx0XHRcdCB0byA6IDgsIFxyXG5cdFx0XHQgY29kZSA6IFwiRmlyc3RBZ2VHcm91cFwiXHJcblx0XHQgfVxyXG5cdFx0ICx7XHJcblx0XHRcdCBmcm9tIDogOCxcclxuXHRcdFx0IHRvIDogNDAsIFxyXG5cdFx0XHQgY29kZSA6IFwiTWlkZGxlQWdlR3JvdXBcIlxyXG5cdFx0IH1cclxuXHRcdCAse1xyXG5cdFx0XHQgZnJvbSA6IDQwLFxyXG5cdFx0XHQgdG8gOiBudWxsLCBcclxuXHRcdFx0IGNvZGUgOiBcIkxhc3RBZ2VHcm91cFwiXHJcblx0XHQgfVxyXG5cdFx0XVxyXG5cdH0sXHJcblxyXG5cdGV2ZW50IDoge1xyXG5cdFx0YmVnaW5UaW1lc3RhbXAgOiAobmV3IERhdGUoKSkuZ2V0VGltZSgpLFxyXG5cdFx0ZHVyYXRpb24gOiA2MCwgLy9NSU5VVEVTXHJcblx0XHRpZCA6IDNcclxuXHR9LFxyXG5cclxuXHRzZXJ2ZXIgOiB7XHJcblx0XHRwcmVmaXggOiBcIi90cmlhdGhsb24vXCJcclxuXHR9LFxyXG5cdFxyXG5cdGFwcGVhcmFuY2UgOiB7XHJcblx0XHR0cmFja0NvbG9yU3dpbSA6ICcjNTY3NmZmJyxcclxuXHRcdHRyYWNrQ29sb3JCaWtlIDogJyNFMjAwNzQnLFxyXG5cdFx0dHJhY2tDb2xvclJ1biA6ICAnIzA3OWYzNicsXHJcblxyXG5cdFx0Ly8gTm90ZSB0aGUgc2VxdWVuY2UgaXMgYWx3YXlzIFN3aW0tQmlrZS1SdW4gLSBzbyAyIGNoYW5nZS1wb2ludHNcclxuXHRcdC8vIFRPRE8gUnVtZW4gLSBhZGQgc2NhbGUgaGVyZSwgbm90IGluIFN0eWxlcy5qc1xyXG5cdFx0aW1hZ2VTdGFydCA6IFwiaW1nL3N0YXJ0LnBuZ1wiLFxyXG5cdFx0aW1hZ2VGaW5pc2ggOiBcImltZy9maW5pc2gucG5nXCIsXHJcblx0XHRpbWFnZUNhbSA6IFwiaW1nL2NhbWVyYS5zdmdcIixcclxuXHRcdGltYWdlQ2hlY2twb2ludFN3aW1CaWtlIDogXCJpbWcvd3oxLnN2Z1wiLFxyXG5cdFx0aW1hZ2VDaGVja3BvaW50QmlrZVJ1biA6IFwiaW1nL3d6Mi5zdmdcIixcclxuXHRcdGlzU2hvd0ltYWdlQ2hlY2twb2ludCA6IHRydWUsXHJcblxyXG4gICAgICAgIC8vIHRoZSBkaXN0YW5jZSBiZXR3ZWVuIHRoZSBkaXJlY3Rpb24gaWNvbnMgLSBpbiBwaXhlbHMsXHJcbiAgICAgICAgLy8gaWYgc2V0IG5vbi1wb3NpdGl2ZSB2YWx1ZSAoMCBvciBsZXNzKSB0aGVuIGRvbid0IHNob3cgdGhlbSBhdCBhbGxcclxuXHRcdC8vZGlyZWN0aW9uSWNvbkJldHdlZW4gOiAyMDBcclxuXHRcdGRpcmVjdGlvbkljb25CZXR3ZWVuIDogLTFcclxuXHR9LFxyXG5cclxuICAgIGhvdHNwb3QgOiB7XHJcbiAgICAgICAgY2FtIDoge2ltYWdlIDpcImltZy9jYW1lcmEuc3ZnXCJ9LCAgLy8gdXNlIHRoZSBzYW1lIGltYWdlIGZvciBzdGF0aWMgY2FtZXJhcyBhcyBmb3IgdGhlIG1vdmluZyBvbmVzXHJcblx0XHRjYW1Td2ltQmlrZSA6IHtpbWFnZSA6IFwiaW1nL3d6MS5zdmdcIiwgc2NhbGUgOiAwLjA0MH0sXHJcblx0XHRjYW1CaWtlUnVuIDoge2ltYWdlIDogXCJpbWcvd3oyLnN2Z1wiLCBzY2FsZSA6IDAuMDQwfSxcclxuICAgICAgICB3YXRlciA6IHtpbWFnZSA6IFwiaW1nL3dhdGVyLnN2Z1wifSxcclxuICAgICAgICB1dHVybiA6IHtpbWFnZSA6IFwiaW1nL3V0dXJuLnN2Z1wifSxcclxuXHJcblx0XHRrbTEwIDoge2ltYWdlIDogXCJpbWcvMTBrbS5zdmdcIiwgc2NhbGUgOiAxLjV9LFxyXG5cdFx0a20yMCA6IHtpbWFnZSA6IFwiaW1nLzIwa20uc3ZnXCIsIHNjYWxlIDogMS41fSxcclxuXHRcdGttMzAgOiB7aW1hZ2UgOiBcImltZy8zMGttLnN2Z1wiLCBzY2FsZSA6IDEuNX0sXHJcblx0XHRrbTQwIDoge2ltYWdlIDogXCJpbWcvNDBrbS5zdmdcIiwgc2NhbGUgOiAxLjV9LFxyXG5cdFx0a202MCA6IHtpbWFnZSA6IFwiaW1nLzYwa20uc3ZnXCIsIHNjYWxlIDogMS41fSxcclxuXHRcdGttODAgOiB7aW1hZ2UgOiBcImltZy84MGttLnN2Z1wiLCBzY2FsZSA6IDEuNX0sXHJcblx0XHRrbTEwMCA6IHtpbWFnZSA6IFwiaW1nLzEwMGttLnN2Z1wiLCBzY2FsZSA6IDEuNX0sXHJcblx0XHRrbTEyMCA6IHtpbWFnZSA6IFwiaW1nLzEyMGttLnN2Z1wiLCBzY2FsZSA6IDEuNX0sXHJcblx0XHRrbTE0MCA6IHtpbWFnZSA6IFwiaW1nLzE0MGttLnN2Z1wiLCBzY2FsZSA6IDEuNX0sXHJcblx0XHRrbTE2MCA6IHtpbWFnZSA6IFwiaW1nLzE2MGttLnN2Z1wiLCBzY2FsZSA6IDEuNX0sXHJcblx0XHRrbTE4MCA6IHtpbWFnZSA6IFwiaW1nLzE4MGttLnN2Z1wiLCBzY2FsZSA6IDEuNX1cclxuICAgIH1cclxufTtcclxuXHJcbmZvciAodmFyIGkgaW4gQ09ORklHKVxyXG5cdGV4cG9ydHNbaV09Q09ORklHW2ldO1xyXG4iLCJ2YXIgVXRpbHM9cmVxdWlyZSgnLi9VdGlscycpO1xyXG52YXIgU1RZTEVTPXJlcXVpcmUoJy4vU3R5bGVzJyk7XHJcbnJlcXVpcmUoJ2pvb3NlJyk7XHJcbnJlcXVpcmUoJy4vVHJhY2snKTtcclxucmVxdWlyZSgnLi9MaXZlU3RyZWFtJyk7XHJcblxyXG5DbGFzcyhcIkd1aVwiLCBcclxue1xyXG4gICAgLy8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdC8vIEFMTCBDT09SRElOQVRFUyBBUkUgSU4gV09STEQgTUVSQ0FUT1JcclxuICAgIC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuICAgIGhhczogXHJcblx0e1xyXG4gICAgXHRpc0RlYnVnIDoge1xyXG4gICAgXHRcdGlzIDogXCJyd1wiLFxyXG4gICAgXHRcdGluaXQgOiAhVXRpbHMubW9iaWxlQW5kVGFibGV0Q2hlY2soKVxyXG4gICAgXHR9LFxyXG5cdFx0aXNXaWRnZXQgOiB7XHJcblx0XHRcdGluaXQgOiBmYWxzZVxyXG5cdFx0fSxcclxuXHRcdGlzRGVidWdTaG93UG9zaXRpb24gOiB7XHJcblx0XHRcdC8vIGlmIHNldCB0byB0cnVlIGl0IHdpbGwgYWRkIGFuIGFic29sdXRlIGVsZW1lbnQgc2hvd2luZyB0aGUgY29vcmRpbmF0ZXMgYWJvdmUgdGhlIG1vdXNlIGxvY2F0aW9uXHJcblx0XHRcdGluaXQgOiBmYWxzZVxyXG5cdFx0fSxcclxuXHRcdHJlY2VpdmVyT25NYXBDbGljayA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiBbXVxyXG5cdFx0fSxcclxuICAgICAgICB3aWR0aCA6IHtcclxuICAgICAgICAgICAgaXM6ICAgXCJyd1wiLFxyXG4gICAgICAgICAgICBpbml0OiA3NTBcclxuICAgICAgICB9LFxyXG4gICAgICAgIGhlaWdodDoge1xyXG4gICAgICAgICAgICBpczogICBcInJ3XCIsXHJcbiAgICAgICAgICAgIGluaXQ6IDUwMFxyXG4gICAgICAgIH0sXHJcblx0XHR0cmFjayA6IHtcclxuXHRcdFx0aXM6ICAgXCJyd1wiXHJcblx0XHR9LFxyXG5cdFx0ZWxlbWVudElkIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IFwibWFwXCJcclxuXHRcdH0sXHJcblx0XHRpbml0aWFsUG9zIDoge1x0XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogbnVsbFxyXG5cdFx0fSxcclxuXHRcdGluaXRpYWxab29tIDoge1x0XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogMTBcclxuXHRcdH0sXHJcblx0XHRiaW5nTWFwS2V5IDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6ICdBaWp0M0FzV09NRTNoUEVFX0hxUmxVS2RjQktxZThkR1JaSF92LUwzSF9GRjY0c3ZYTWJrcjFUNnVfV0FTb2V0J1xyXG5cdFx0fSxcclxuXHRcdC8vLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdFx0bWFwIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IG51bGxcclxuXHRcdH0sXHJcblx0XHR0cmFja0xheWVyIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IG51bGxcclxuXHRcdH0sXHJcbiAgICAgICAgaG90c3BvdHNMYXllciA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiBudWxsXHJcblx0XHR9LFxyXG4gICAgICAgIGNhbXNMYXllciA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiBudWxsXHJcblx0XHR9LFxyXG5cdFx0cGFydGljaXBhbnRzTGF5ZXIgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogbnVsbFxyXG5cdFx0fSxcclxuXHRcdGRlYnVnTGF5ZXJHUFMgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogbnVsbFxyXG5cdFx0fSxcdFxyXG5cdFx0c2VsZWN0ZWRQYXJ0aWNpcGFudDEgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogbnVsbFxyXG5cdFx0fSxcclxuXHRcdHNlbGVjdGVkUGFydGljaXBhbnQyIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IG51bGxcclxuXHRcdH0sXHJcblx0XHRwb3B1cDEgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogbnVsbFxyXG5cdFx0fSxcclxuXHRcdHBvcHVwMiA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiBudWxsXHJcblx0XHR9LFxyXG5cdFx0aXNTaG93U3dpbSA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiB0cnVlXHJcblx0XHR9LFxyXG5cdFx0aXNTaG93QmlrZSA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiB0cnVlXHJcblx0XHR9LFxyXG5cdFx0aXNTaG93UnVuIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IHRydWVcclxuXHRcdH0sXHJcblx0XHRzZWxlY3ROdW0gOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogMVxyXG5cdFx0fSxcclxuICAgICAgICBsaXZlU3RyZWFtIDoge1xyXG4gICAgICAgICAgICBpbml0OiBudWxsXHJcbiAgICAgICAgfVxyXG4gICAgfSxcclxuICAgIC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRtZXRob2RzOiBcclxuXHR7XHJcbiAgICAgICAgaW5pdDogZnVuY3Rpb24gKHBhcmFtcykgIFxyXG5cdFx0e1xyXG5cdFx0XHQvLyBpZiBpbiB3aWRnZXQgbW9kZSB0aGVuIGRpc2FibGUgZGVidWdcclxuXHRcdFx0aWYgKHRoaXMuaXNXaWRnZXQpIHtcclxuXHRcdFx0XHR0aGlzLmlzRGVidWcgPSBmYWxzZTtcclxuXHRcdFx0fVxyXG5cclxuXHRcdFx0dmFyIGRlZlBvcyA9IFswLDBdO1xyXG5cdFx0XHRpZiAodGhpcy5pbml0aWFsUG9zKSBcclxuXHRcdFx0XHRkZWZQb3M9dGhpcy5pbml0aWFsUG9zO1xyXG5cdFx0XHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdFx0XHR2YXIgZXh0ZW50ID0gcGFyYW1zICYmIHBhcmFtcy5za2lwRXh0ZW50ID8gbnVsbCA6IFRSQUNLLmdldFJvdXRlKCkgJiYgVFJBQ0suZ2V0Um91dGUoKS5sZW5ndGggPiAxID8gb2wucHJvai50cmFuc2Zvcm1FeHRlbnQoIChuZXcgb2wuZ2VvbS5MaW5lU3RyaW5nKFRSQUNLLmdldFJvdXRlKCkpKS5nZXRFeHRlbnQoKSAsICdFUFNHOjQzMjYnLCAnRVBTRzozODU3JykgOiBudWxsO1xyXG5cdFx0XHR0aGlzLnRyYWNrTGF5ZXIgPSBuZXcgb2wubGF5ZXIuVmVjdG9yKHtcclxuXHRcdFx0ICBzb3VyY2U6IG5ldyBvbC5zb3VyY2UuVmVjdG9yKCksXHJcblx0XHRcdCAgc3R5bGUgOiBTVFlMRVNbXCJ0cmFja1wiXVxyXG5cdFx0XHR9KTtcclxuXHRcdFx0dGhpcy5ob3RzcG90c0xheWVyID0gbmV3IG9sLmxheWVyLlZlY3Rvcih7XHJcblx0XHRcdCAgc291cmNlOiBuZXcgb2wuc291cmNlLlZlY3RvcigpLFxyXG5cdFx0XHQgIHN0eWxlIDogU1RZTEVTW1wiaG90c3BvdFwiXVxyXG5cdFx0XHR9KTtcclxuXHRcdFx0dGhpcy5wYXJ0aWNpcGFudHNMYXllciA9IG5ldyBvbC5sYXllci5WZWN0b3Ioe1xyXG5cdFx0XHQgIHNvdXJjZTogbmV3IG9sLnNvdXJjZS5WZWN0b3IoKSxcclxuXHRcdFx0ICBzdHlsZSA6IFNUWUxFU1tcInBhcnRpY2lwYW50XCJdXHJcblx0XHRcdH0pO1xyXG5cdFx0XHR0aGlzLmNhbXNMYXllciA9IG5ldyBvbC5sYXllci5WZWN0b3Ioe1xyXG5cdFx0XHRcdHNvdXJjZTogbmV3IG9sLnNvdXJjZS5WZWN0b3IoKSxcclxuXHRcdFx0XHRzdHlsZSA6IFNUWUxFU1tcImNhbVwiXVxyXG5cdFx0XHR9KTtcclxuXHRcdFx0aWYgKHRoaXMuaXNEZWJ1ZylcclxuXHRcdFx0dGhpcy5kZWJ1Z0xheWVyR1BTID0gbmV3IG9sLmxheWVyLlZlY3Rvcih7XHJcblx0XHRcdFx0ICBzb3VyY2U6IG5ldyBvbC5zb3VyY2UuVmVjdG9yKCksXHJcblx0XHRcdFx0ICBzdHlsZSA6IFNUWUxFU1tcImRlYnVnR1BTXCJdXHJcblx0XHRcdH0pO1xyXG5cdFx0XHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0XHRcdHZhciBpbnRzID0gW107XHJcblx0XHRcdHRoaXMucG9wdXAxID0gbmV3IG9sLk92ZXJsYXkuUG9wdXAoe2FuaTpmYWxzZSxwYW5NYXBJZk91dE9mVmlldyA6IGZhbHNlfSk7XHJcblx0XHRcdHRoaXMucG9wdXAyID0gbmV3IG9sLk92ZXJsYXkuUG9wdXAoe2FuaTpmYWxzZSxwYW5NYXBJZk91dE9mVmlldyA6IGZhbHNlfSk7XHJcblx0XHRcdHRoaXMucG9wdXAyLnNldE9mZnNldChbMCwxNzVdKTtcclxuXHRcdFx0dGhpcy5tYXAgPSBuZXcgb2wuTWFwKHtcclxuXHRcdFx0ICByZW5kZXJlciA6IFwiY2FudmFzXCIsXHJcblx0XHRcdCAgdGFyZ2V0OiAnbWFwJyxcclxuXHRcdFx0ICBsYXllcnM6IFtcclxuXHRcdFx0ICAgICAgICAgICBuZXcgb2wubGF5ZXIuVGlsZSh7XHJcblx0XHRcdCAgICAgICAgICAgICAgIHNvdXJjZTogbmV3IG9sLnNvdXJjZS5PU00oKVxyXG5cdFx0XHQgICAgICAgICAgIH0pLFxyXG5cdFx0XHRcdFx0dGhpcy50cmFja0xheWVyLFxyXG5cdFx0XHRcdFx0dGhpcy5ob3RzcG90c0xheWVyLFxyXG5cdFx0XHRcdFx0dGhpcy5jYW1zTGF5ZXIsXHJcblx0XHRcdFx0XHR0aGlzLnBhcnRpY2lwYW50c0xheWVyXHJcblx0XHRcdCAgXSxcclxuXHRcdFx0ICBjb250cm9sczogdGhpcy5pc1dpZGdldCA/IFtdIDogb2wuY29udHJvbC5kZWZhdWx0cygpLFxyXG5cdFx0XHQgIHZpZXc6IG5ldyBvbC5WaWV3KHtcclxuXHRcdFx0XHRjZW50ZXI6IG9sLnByb2oudHJhbnNmb3JtKGRlZlBvcywgJ0VQU0c6NDMyNicsICdFUFNHOjM4NTcnKSxcclxuXHRcdFx0XHR6b29tOiB0aGlzLmdldEluaXRpYWxab29tKCksXHJcblx0XHRcdFx0bWluWm9vbTogdGhpcy5pc1dpZGdldCA/IHRoaXMuaW5pdGlhbFpvb20gOiAxMCxcclxuXHRcdFx0XHRtYXhab29tOiB0aGlzLmlzV2lkZ2V0ID8gdGhpcy5pbml0aWFsWm9vbSA6IDE3LFxyXG5cdFx0XHRcdGV4dGVudCA6IGV4dGVudCA/IGV4dGVudCA6IHVuZGVmaW5lZFxyXG5cdFx0XHQgIH0pXHJcblx0XHRcdH0pO1xyXG5cdFx0XHRcclxuXHRcdFx0Zm9yICh2YXIgaT0wO2k8aW50cy5sZW5ndGg7aSsrKVxyXG5cdFx0XHRcdHRoaXMubWFwLmFkZEludGVyYWN0aW9uKGludHNbaV0pO1xyXG5cdFx0XHR0aGlzLm1hcC5hZGRPdmVybGF5KHRoaXMucG9wdXAxKTtcclxuXHRcdFx0dGhpcy5tYXAuYWRkT3ZlcmxheSh0aGlzLnBvcHVwMik7XHJcblx0XHRcdGlmICh0aGlzLmlzRGVidWcpIFxyXG5cdFx0XHRcdHRoaXMubWFwLmFkZExheWVyKHRoaXMuZGVidWdMYXllckdQUyk7XHJcblx0XHRcdFRSQUNLLmluaXQoKTtcclxuXHRcdFx0dGhpcy5hZGRUcmFja0ZlYXR1cmUoKTtcclxuXHRcdFx0Ly8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0XHRcdGlmICghdGhpcy5pc1dpZGdldCkge1xyXG5cdFx0XHRcdHRoaXMubWFwLm9uKCdjbGljaycsIGZ1bmN0aW9uIChldmVudCkge1xyXG5cdFx0XHRcdFx0VFJBQ0sub25NYXBDbGljayhldmVudCk7XHJcblx0XHRcdFx0XHR2YXIgc2VsZWN0ZWRQYXJ0aWNpcGFudHMgPSBbXTtcclxuXHRcdFx0XHRcdHZhciBzZWxlY3RlZEhvdHNwb3QgPSBudWxsO1xyXG5cdFx0XHRcdFx0dGhpcy5tYXAuZm9yRWFjaEZlYXR1cmVBdFBpeGVsKGV2ZW50LnBpeGVsLCBmdW5jdGlvbiAoZmVhdHVyZSwgbGF5ZXIpIHtcclxuXHRcdFx0XHRcdFx0aWYgKGxheWVyID09IHRoaXMucGFydGljaXBhbnRzTGF5ZXIpIHtcclxuXHRcdFx0XHRcdFx0XHRzZWxlY3RlZFBhcnRpY2lwYW50cy5wdXNoKGZlYXR1cmUpO1xyXG5cdFx0XHRcdFx0XHR9IGVsc2UgaWYgKGxheWVyID09IHRoaXMuaG90c3BvdHNMYXllcikge1xyXG5cdFx0XHRcdFx0XHRcdC8vIGFsbG93IG9ubHkgb25lIGhvdHNwb3QgdG8gYmUgc2VsZWN0ZWQgYXQgYSB0aW1lXHJcblx0XHRcdFx0XHRcdFx0aWYgKCFzZWxlY3RlZEhvdHNwb3QpXHJcblx0XHRcdFx0XHRcdFx0XHRzZWxlY3RlZEhvdHNwb3QgPSBmZWF0dXJlO1xyXG5cdFx0XHRcdFx0XHR9XHJcblx0XHRcdFx0XHR9LCB0aGlzKTtcclxuXHJcblx0XHRcdFx0XHQvLyBmaXJzdCBpZiB0aGVyZSBhcmUgc2VsZWN0ZWQgcGFydGljaXBhbnRzIHRoZW4gc2hvdyB0aGVpciBwb3B1cHNcclxuXHRcdFx0XHRcdC8vIGFuZCBvbmx5IGlmIHRoZXJlIGFyZSBub3QgdXNlIHRoZSBzZWxlY3RlZCBob3RzcG90IGlmIHRoZXJlJ3MgYW55XHJcblx0XHRcdFx0XHRpZiAoc2VsZWN0ZWRQYXJ0aWNpcGFudHMubGVuZ3RoKSB7XHJcblx0XHRcdFx0XHRcdGlmICh0aGlzLnNlbGVjdGVkUGFydGljaXBhbnQxID09IG51bGwpIHtcclxuXHRcdFx0XHRcdFx0XHR2YXIgZmVhdCA9IHRoaXMuZ2V0U2VsZWN0ZWRQYXJ0aWNpcGFudEZyb21BcnJheUN5Y2xpYyhzZWxlY3RlZFBhcnRpY2lwYW50cyk7XHJcblx0XHRcdFx0XHRcdFx0aWYgKGZlYXQpXHJcblx0XHRcdFx0XHRcdFx0XHR0aGlzLnNldFNlbGVjdGVkUGFydGljaXBhbnQxKGZlYXQucGFydGljaXBhbnQpO1xyXG5cdFx0XHRcdFx0XHRcdGVsc2VcclxuXHRcdFx0XHRcdFx0XHRcdHRoaXMuc2V0U2VsZWN0ZWRQYXJ0aWNpcGFudDEobnVsbCk7XHJcblx0XHRcdFx0XHRcdFx0dGhpcy5zZWxlY3ROdW0gPSAwO1xyXG5cdFx0XHRcdFx0XHR9IGVsc2UgaWYgKHRoaXMuc2VsZWN0ZWRQYXJ0aWNpcGFudDIgPT0gbnVsbCkge1xyXG5cdFx0XHRcdFx0XHRcdHZhciBmZWF0ID0gdGhpcy5nZXRTZWxlY3RlZFBhcnRpY2lwYW50RnJvbUFycmF5Q3ljbGljKHNlbGVjdGVkUGFydGljaXBhbnRzKTtcclxuXHRcdFx0XHRcdFx0XHRpZiAoZmVhdClcclxuXHRcdFx0XHRcdFx0XHRcdHRoaXMuc2V0U2VsZWN0ZWRQYXJ0aWNpcGFudDIoZmVhdC5wYXJ0aWNpcGFudCk7XHJcblx0XHRcdFx0XHRcdFx0ZWxzZVxyXG5cdFx0XHRcdFx0XHRcdFx0dGhpcy5zZXRTZWxlY3RlZFBhcnRpY2lwYW50MihudWxsKTtcclxuXHRcdFx0XHRcdFx0XHR0aGlzLnNlbGVjdE51bSA9IDE7XHJcblx0XHRcdFx0XHRcdH0gZWxzZSB7XHJcblx0XHRcdFx0XHRcdFx0dGhpcy5zZWxlY3ROdW0gPSAodGhpcy5zZWxlY3ROdW0gKyAxKSAlIDI7XHJcblx0XHRcdFx0XHRcdFx0aWYgKHRoaXMuc2VsZWN0TnVtID09IDApIHtcclxuXHRcdFx0XHRcdFx0XHRcdHZhciBmZWF0ID0gdGhpcy5nZXRTZWxlY3RlZFBhcnRpY2lwYW50RnJvbUFycmF5Q3ljbGljKHNlbGVjdGVkUGFydGljaXBhbnRzKTtcclxuXHRcdFx0XHRcdFx0XHRcdGlmIChmZWF0KVxyXG5cdFx0XHRcdFx0XHRcdFx0XHR0aGlzLnNldFNlbGVjdGVkUGFydGljaXBhbnQxKGZlYXQucGFydGljaXBhbnQpO1xyXG5cdFx0XHRcdFx0XHRcdFx0ZWxzZVxyXG5cdFx0XHRcdFx0XHRcdFx0XHR0aGlzLnNldFNlbGVjdGVkUGFydGljaXBhbnQxKG51bGwpO1xyXG5cdFx0XHRcdFx0XHRcdH0gZWxzZSB7XHJcblx0XHRcdFx0XHRcdFx0XHR2YXIgZmVhdCA9IHRoaXMuZ2V0U2VsZWN0ZWRQYXJ0aWNpcGFudEZyb21BcnJheUN5Y2xpYyhzZWxlY3RlZFBhcnRpY2lwYW50cyk7XHJcblx0XHRcdFx0XHRcdFx0XHRpZiAoZmVhdClcclxuXHRcdFx0XHRcdFx0XHRcdFx0dGhpcy5zZXRTZWxlY3RlZFBhcnRpY2lwYW50MihmZWF0LnBhcnRpY2lwYW50KTtcclxuXHRcdFx0XHRcdFx0XHRcdGVsc2VcclxuXHRcdFx0XHRcdFx0XHRcdFx0dGhpcy5zZXRTZWxlY3RlZFBhcnRpY2lwYW50MihudWxsKTtcclxuXHRcdFx0XHRcdFx0XHR9XHJcblx0XHRcdFx0XHRcdH1cclxuXHRcdFx0XHRcdH0gZWxzZSB7XHJcblx0XHRcdFx0XHRcdHRoaXMuc2V0U2VsZWN0ZWRQYXJ0aWNpcGFudDEobnVsbCk7XHJcblx0XHRcdFx0XHRcdHRoaXMuc2V0U2VsZWN0ZWRQYXJ0aWNpcGFudDIobnVsbCk7XHJcblxyXG5cdFx0XHRcdFx0XHRpZiAoc2VsZWN0ZWRIb3RzcG90KSB7XHJcblx0XHRcdFx0XHRcdFx0c2VsZWN0ZWRIb3RzcG90LmhvdHNwb3Qub25DbGljaygpO1xyXG5cdFx0XHRcdFx0XHR9XHJcblx0XHRcdFx0XHR9XHJcblx0XHRcdFx0fSwgdGhpcyk7XHJcblxyXG5cdFx0XHRcdC8vIGNoYW5nZSBtb3VzZSBjdXJzb3Igd2hlbiBvdmVyIHNwZWNpZmljIGZlYXR1cmVzXHJcblx0XHRcdFx0dmFyIHNlbGYgPSB0aGlzO1xyXG5cdFx0XHRcdCQodGhpcy5tYXAuZ2V0Vmlld3BvcnQoKSkub24oJ21vdXNlbW92ZScsIGZ1bmN0aW9uIChlKSB7XHJcblx0XHRcdFx0XHR2YXIgcGl4ZWwgPSBzZWxmLm1hcC5nZXRFdmVudFBpeGVsKGUub3JpZ2luYWxFdmVudCk7XHJcblx0XHRcdFx0XHR2YXIgaXNDbGlja2FibGUgPSBzZWxmLm1hcC5mb3JFYWNoRmVhdHVyZUF0UGl4ZWwocGl4ZWwsIGZ1bmN0aW9uIChmZWF0dXJlLCBsYXllcikge1xyXG5cdFx0XHRcdFx0XHRpZiAobGF5ZXIgPT09IHNlbGYucGFydGljaXBhbnRzTGF5ZXIgfHwgbGF5ZXIgPT09IHNlbGYuY2Ftc0xheWVyKSB7XHJcblx0XHRcdFx0XHRcdFx0Ly8gYWxsIHBhcnRpY2lwYW50cyBhbmQgbW92aW5nIGNhbWVyYXMgYXJlIGNsaWNrYWJsZVxyXG5cdFx0XHRcdFx0XHRcdHJldHVybiB0cnVlO1xyXG5cdFx0XHRcdFx0XHR9IGVsc2UgaWYgKGxheWVyID09PSBzZWxmLmhvdHNwb3RzTGF5ZXIpIHtcclxuXHRcdFx0XHRcdFx0XHQvLyBnZXQgXCJjbGlja2FiaWxpdHlcIiBmcm9tIHRoZSBob3RzcG90XHJcblx0XHRcdFx0XHRcdFx0cmV0dXJuIGZlYXR1cmUuaG90c3BvdC5pc0NsaWNrYWJsZSgpO1xyXG5cdFx0XHRcdFx0XHR9XHJcblx0XHRcdFx0XHR9KTtcclxuXHRcdFx0XHRcdHNlbGYubWFwLmdldFZpZXdwb3J0KCkuc3R5bGUuY3Vyc29yID0gaXNDbGlja2FibGUgPyAncG9pbnRlcicgOiAnJztcclxuXHRcdFx0XHR9KTtcclxuXHRcdFx0fVxyXG5cdFx0XHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0XHRcdGlmICghdGhpcy5fYW5pbWF0aW9uSW5pdCkge1xyXG5cdFx0XHRcdHRoaXMuX2FuaW1hdGlvbkluaXQ9dHJ1ZTtcclxuXHRcdFx0XHRzZXRJbnRlcnZhbCh0aGlzLm9uQW5pbWF0aW9uLmJpbmQodGhpcyksIDEwMDAqQ09ORklHLnRpbWVvdXRzLmFuaW1hdGlvbkZyYW1lICk7XHJcblx0XHRcdH1cclxuXHJcblx0XHRcdC8vIGlmIHRoaXMgaXMgT04gdGhlbiBpdCB3aWxsIHNob3cgdGhlIGNvb3JkaW5hdGVzIHBvc2l0aW9uIHVuZGVyIHRoZSBtb3VzZSBsb2NhdGlvblxyXG5cdFx0XHRpZiAodGhpcy5pc0RlYnVnU2hvd1Bvc2l0aW9uKSB7XHJcblx0XHRcdFx0JChcIiNtYXBcIikuYXBwZW5kKCc8cCBpZD1cImRlYnVnU2hvd1Bvc2l0aW9uXCI+RVBTRzozODU3IDxzcGFuIGlkPVwibW91c2UzODU3XCI+PC9zcGFuPiAmbmJzcDsgRVBTRzo0MzI2IDxzcGFuIGlkPVwibW91c2U0MzI2XCI+PC9zcGFuPicpO1xyXG5cdFx0XHRcdHRoaXMubWFwLm9uKCdwb2ludGVybW92ZScsIGZ1bmN0aW9uKGV2ZW50KSB7XHJcblx0XHRcdFx0XHR2YXIgY29vcmQzODU3ID0gZXZlbnQuY29vcmRpbmF0ZTtcclxuXHRcdFx0XHRcdHZhciBjb29yZDQzMjYgPSBvbC5wcm9qLnRyYW5zZm9ybShjb29yZDM4NTcsICdFUFNHOjM4NTcnLCAnRVBTRzo0MzI2Jyk7XHJcblx0XHRcdFx0XHQkKCcjbW91c2UzODU3JykudGV4dChvbC5jb29yZGluYXRlLnRvU3RyaW5nWFkoY29vcmQzODU3LCAyKSk7XHJcblx0XHRcdFx0XHQkKCcjbW91c2U0MzI2JykudGV4dChvbC5jb29yZGluYXRlLnRvU3RyaW5nWFkoY29vcmQ0MzI2LCAxNSkpO1xyXG5cdFx0XHRcdH0pO1xyXG5cdFx0XHR9XHJcblxyXG5cdFx0XHQvLyBwYXNzIHRoZSBpZCBvZiB0aGUgRE9NIGVsZW1lbnRcclxuXHRcdFx0dGhpcy5saXZlU3RyZWFtID0gbmV3IExpdmVTdHJlYW0oe2lkIDogXCJsaXZlU3RyZWFtXCJ9KTtcclxuICAgICAgICB9LFxyXG5cdFx0XHJcbiAgICAgICAgXHJcbiAgICAgICAgYWRkVHJhY2tGZWF0dXJlIDogZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgXHRUUkFDSy5pbml0KCk7XHJcbiAgICAgICAgXHRpZiAoVFJBQ0suZmVhdHVyZSkge1xyXG4gICAgICAgIFx0XHR2YXIgZnQgPSB0aGlzLnRyYWNrTGF5ZXIuZ2V0U291cmNlKCkuZ2V0RmVhdHVyZXMoKTtcclxuICAgICAgICBcdFx0dmFyIG9rPWZhbHNlO1xyXG4gICAgICAgIFx0XHRmb3IgKHZhciBpPTA7aTxmdC5sZW5ndGg7aSsrKSBcclxuICAgICAgICBcdFx0e1xyXG4gICAgICAgIFx0XHRcdGlmIChmdFtpXSA9PSBUUkFDSy5mZWF0dXJlKVxyXG4gICAgICAgIFx0XHRcdHtcclxuICAgICAgICBcdFx0XHRcdG9rPXRydWU7XHJcbiAgICAgICAgXHRcdFx0XHRicmVhaztcclxuICAgICAgICBcdFx0XHR9XHJcbiAgICAgICAgXHRcdH1cclxuICAgICAgICBcdFx0aWYgKCFvaylcclxuICAgICAgICBcdFx0XHR0aGlzLnRyYWNrTGF5ZXIuZ2V0U291cmNlKCkuYWRkRmVhdHVyZShUUkFDSy5mZWF0dXJlKTtcclxuICAgICAgICBcdH1cclxuICAgICAgICB9LFxyXG4gICAgICAgIHpvb21Ub1RyYWNrIDogZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgICAgIHZhciBleHRlbnQgPSBUUkFDSy5nZXRSb3V0ZSgpICYmIFRSQUNLLmdldFJvdXRlKCkubGVuZ3RoID4gMSA/IG9sLnByb2oudHJhbnNmb3JtRXh0ZW50KCAobmV3IG9sLmdlb20uTGluZVN0cmluZyhUUkFDSy5nZXRSb3V0ZSgpKSkuZ2V0RXh0ZW50KCkgLCAnRVBTRzo0MzI2JywgJ0VQU0c6Mzg1NycpIDogbnVsbDtcclxuICAgICAgICAgICAgaWYgKGV4dGVudClcclxuICAgICAgICAgICAgXHR0aGlzLm1hcC5nZXRWaWV3KCkuZml0RXh0ZW50KGV4dGVudCx0aGlzLm1hcC5nZXRTaXplKCkpO1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgXHJcbiAgICAgICAgZ2V0U2VsZWN0ZWRQYXJ0aWNpcGFudEZyb21BcnJheUN5Y2xpYyA6IGZ1bmN0aW9uKGZlYXR1cmVzKSB7XHJcbiAgICBcdFx0dmFyIGFyciA9IFtdO1xyXG4gICAgXHRcdHZhciB0bWFwID0ge307XHJcbiAgICBcdFx0dmFyIGNyclBvcyA9IDA7XHJcblx0XHRcdHZhciBwb3M9bnVsbDtcclxuICAgIFx0XHRmb3IgKHZhciBpPTA7aTxmZWF0dXJlcy5sZW5ndGg7aSsrKSB7XHJcbiAgICBcdFx0XHR2YXIgZmVhdHVyZSA9IGZlYXR1cmVzW2ldO1xyXG4gICAgXHRcdFx0dmFyIGlkID0gZmVhdHVyZS5wYXJ0aWNpcGFudC5jb2RlO1xyXG4gICAgXHRcdFx0YXJyLnB1c2goaWQpO1xyXG4gICAgXHRcdFx0dG1hcFtpZF09dHJ1ZTtcclxuXHRcdFx0XHRpZiAoaWQgPT0gdGhpcy52cl9sYXN0c2VsZWN0ZWQpIHtcclxuXHRcdFx0XHRcdHBvcz1pO1xyXG5cdFx0XHRcdH1cclxuICAgIFx0XHR9XHJcbiAgICBcdFx0dmFyIHNhbWUgPSB0aGlzLnZyX29sZGJlc3RhcnIgJiYgcG9zICE9IG51bGw7IFxyXG4gICAgXHRcdGlmIChzYW1lKSBcclxuICAgIFx0XHR7XHJcbiAgICBcdFx0XHQvLyBhbGwgZnJvbSB0aGUgb2xkIGNvbnRhaW5lZCBpbiB0aGUgbmV3XHJcbiAgICBcdFx0XHRmb3IgKHZhciBpPTA7aTx0aGlzLnZyX29sZGJlc3RhcnIubGVuZ3RoO2krKykgXHJcbiAgICBcdFx0XHR7XHJcbiAgICBcdFx0XHRcdGlmICghdG1hcFt0aGlzLnZyX29sZGJlc3RhcnJbaV1dKSB7XHJcbiAgICBcdFx0XHRcdFx0c2FtZT1mYWxzZTtcclxuICAgIFx0XHRcdFx0XHRicmVhaztcclxuICAgIFx0XHRcdFx0fVxyXG4gICAgXHRcdFx0fVxyXG4gICAgXHRcdH1cclxuICAgIFx0XHRpZiAoIXNhbWUpIHtcclxuICAgIFx0XHRcdHRoaXMudnJfb2xkYmVzdGFycj1hcnI7XHJcbiAgICBcdFx0XHR0aGlzLnZyX2xhc3RzZWxlY3RlZD1hcnJbMF07XHJcbiAgICBcdFx0XHRyZXR1cm4gZmVhdHVyZXNbMF07XHJcbiAgICBcdFx0fSBlbHNlIHtcclxuICAgIFx0XHRcdHRoaXMudnJfbGFzdHNlbGVjdGVkID0gcG9zID4gMCA/IGFycltwb3MtMV0gOiBhcnJbYXJyLmxlbmd0aC0xXTsgICAgXHRcdFx0XHJcbiAgICAgICAgXHRcdHZhciByZXN1bHRGZWF0dXJlO1xyXG4gICAgXHRcdFx0Zm9yICh2YXIgaT0wO2k8ZmVhdHVyZXMubGVuZ3RoO2krKykgXHJcbiAgICAgICAgXHRcdHtcclxuICAgICAgICBcdFx0XHR2YXIgZmVhdHVyZSA9IGZlYXR1cmVzW2ldO1xyXG4gICAgICAgIFx0XHRcdHZhciBpZCA9IGZlYXR1cmUucGFydGljaXBhbnQuY29kZTtcclxuICAgICAgICBcdFx0XHRpZiAoaWQgPT0gdGhpcy52cl9sYXN0c2VsZWN0ZWQpIHtcclxuICAgICAgICBcdFx0XHRcdHJlc3VsdEZlYXR1cmU9ZmVhdHVyZTtcclxuICAgICAgICBcdFx0XHRcdGJyZWFrO1xyXG4gICAgICAgIFx0XHRcdH1cclxuICAgICAgICBcdFx0fVxyXG4gICAgICAgICAgICAgICAgcmV0dXJuIHJlc3VsdEZlYXR1cmU7XHJcbiAgICBcdFx0fVxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgXHJcblx0XHRzaG93RXJyb3IgOiBmdW5jdGlvbihtc2csb25DbG9zZUNhbGxiYWNrKSBcclxuXHRcdHtcclxuXHRcdFx0YWxlcnQoXCJFUlJPUiA6IFwiK21zZyk7XHJcblx0XHRcdGlmIChvbkNsb3NlQ2FsbGJhY2spIFxyXG5cdFx0XHRcdG9uQ2xvc2VDYWxsYmFjaygpO1xyXG5cdFx0fSxcclxuXHRcdFxyXG5cdFx0b25BbmltYXRpb24gOiBmdW5jdGlvbigpIFxyXG5cdFx0e1xyXG5cdFx0XHR2YXIgYXJyPVtdO1xyXG5cdFx0XHRmb3IgKHZhciBpcD0wO2lwPFRSQUNLLnBhcnRpY2lwYW50cy5sZW5ndGg7aXArKykgIFxyXG5cdFx0XHR7XHJcblx0XHRcdFx0dmFyIHAgPSBUUkFDSy5wYXJ0aWNpcGFudHNbaXBdO1xyXG5cdFx0XHRcdGlmIChwLmlzRmF2b3JpdGUpIFxyXG5cdFx0XHRcdHtcclxuXHRcdFx0XHRcdHAuaW50ZXJwb2xhdGUoKTtcclxuXHRcdFx0XHRcdGFyci5wdXNoKGlwKTtcclxuXHRcdFx0XHR9XHJcblx0XHRcdH1cclxuXHRcdFx0Ly8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0XHRcdGZvciAodmFyIGlwPTA7aXA8VFJBQ0sucGFydGljaXBhbnRzLmxlbmd0aDtpcCsrKSBcclxuXHRcdFx0e1xyXG5cdFx0XHRcdFRSQUNLLnBhcnRpY2lwYW50c1thcnJbaXBdXS5fX3Bvcz1pcDtcclxuXHRcdFx0XHRpZiAoaXAgPT0gMClcclxuXHRcdFx0XHRcdGRlbGV0ZSBUUkFDSy5wYXJ0aWNpcGFudHNbYXJyW2lwXV0uX19wcmV2O1xyXG5cdFx0XHRcdGVsc2VcclxuXHRcdFx0XHRcdFRSQUNLLnBhcnRpY2lwYW50c1thcnJbaXBdXS5fX3ByZXY9VFJBQ0sucGFydGljaXBhbnRzW2FycltpcC0xXV07XHJcblx0XHRcdFx0aWYgKGlwID09IFRSQUNLLnBhcnRpY2lwYW50cy5sZW5ndGgtMSlcclxuXHRcdFx0XHRcdGRlbGV0ZSAgVFJBQ0sucGFydGljaXBhbnRzW2FycltpcF1dLl9fbmV4dDtcclxuXHRcdFx0XHRlbHNlXHJcblx0XHRcdFx0XHRUUkFDSy5wYXJ0aWNpcGFudHNbYXJyW2lwXV0uX19uZXh0PVRSQUNLLnBhcnRpY2lwYW50c1thcnJbaXArMV1dO1xyXG5cdFx0XHR9XHJcblx0XHRcdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdFx0XHRpZiAodGhpcy5zZWxlY3RlZFBhcnRpY2lwYW50MSkgXHJcblx0XHRcdHtcclxuXHRcdFx0XHR2YXIgc3BvcyA9IHRoaXMuc2VsZWN0ZWRQYXJ0aWNpcGFudDEuZ2V0RmVhdHVyZSgpLmdldEdlb21ldHJ5KCkuZ2V0Q29vcmRpbmF0ZXMoKTtcclxuXHRcdFx0XHRpZiAoIXRoaXMucG9wdXAxLmlzX3Nob3duKSB7XHJcblx0XHRcdFx0ICAgIHRoaXMucG9wdXAxLnNob3coc3BvcywgdGhpcy5wb3B1cDEubGFzdEhUTUw9dGhpcy5zZWxlY3RlZFBhcnRpY2lwYW50MS5nZXRQb3B1cEhUTUwoKSk7XHJcblx0XHRcdFx0ICAgIHRoaXMucG9wdXAxLmlzX3Nob3duPTE7XHJcblx0XHRcdFx0fSBlbHNlIHtcclxuXHRcdFx0XHRcdGlmICghdGhpcy5wb3B1cDEuZ2V0UG9zaXRpb24oKSB8fCB0aGlzLnBvcHVwMS5nZXRQb3NpdGlvbigpWzBdICE9IHNwb3NbMF0gfHwgdGhpcy5wb3B1cDEuZ2V0UG9zaXRpb24oKVsxXSAhPSBzcG9zWzFdKVxyXG5cdFx0XHRcdFx0ICAgIHRoaXMucG9wdXAxLnNldFBvc2l0aW9uKHNwb3MpO1xyXG5cdFx0XHRcdFx0dmFyIGN0aW1lID0gKG5ldyBEYXRlKCkpLmdldFRpbWUoKTtcdFx0XHQgXHJcblx0XHRcdFx0XHRpZiAoIXRoaXMubGFzdFBvcHVwUmVmZXJlc2gxIHx8IGN0aW1lIC0gdGhpcy5sYXN0UG9wdXBSZWZlcmVzaDEgPiAyMDAwKSBcclxuXHRcdFx0XHRcdHtcclxuXHRcdFx0XHRcdFx0dGhpcy5sYXN0UG9wdXBSZWZlcmVzaDE9Y3RpbWU7XHJcblx0XHRcdFx0XHQgICAgdmFyIHJyID0gdGhpcy5zZWxlY3RlZFBhcnRpY2lwYW50MS5nZXRQb3B1cEhUTUwoKTtcclxuXHRcdFx0XHRcdCAgICBpZiAocnIgIT0gdGhpcy5wb3B1cDEubGFzdEhUTUwpIHtcclxuXHRcdFx0XHRcdCAgICBcdHRoaXMucG9wdXAxLmxhc3RIVE1MPXJyO1xyXG5cdFx0XHRcdFx0XHQgICAgdGhpcy5wb3B1cDEuY29udGVudC5pbm5lckhUTUw9cnI7IFxyXG5cdFx0XHRcdFx0ICAgIH1cdFx0XHRcdFx0XHJcblx0XHRcdFx0XHR9XHJcblx0XHRcdFx0ICAgIHRoaXMucG9wdXAxLnBhbkludG9WaWV3XyhzcG9zKTtcclxuXHRcdFx0XHR9XHJcblx0XHRcdH1cclxuXHRcdFx0aWYgKHRoaXMuc2VsZWN0ZWRQYXJ0aWNpcGFudDIpIFxyXG5cdFx0XHR7XHJcblx0XHRcdFx0dmFyIHNwb3MgPSB0aGlzLnNlbGVjdGVkUGFydGljaXBhbnQyLmdldEZlYXR1cmUoKS5nZXRHZW9tZXRyeSgpLmdldENvb3JkaW5hdGVzKCk7XHJcblx0XHRcdFx0aWYgKCF0aGlzLnBvcHVwMi5pc19zaG93bikge1xyXG5cdFx0XHRcdCAgICB0aGlzLnBvcHVwMi5zaG93KHNwb3MsIHRoaXMucG9wdXAyLmxhc3RIVE1MPXRoaXMuc2VsZWN0ZWRQYXJ0aWNpcGFudDIuZ2V0UG9wdXBIVE1MKCkpO1xyXG5cdFx0XHRcdCAgICB0aGlzLnBvcHVwMi5pc19zaG93bj0xO1xyXG5cdFx0XHRcdH0gZWxzZSB7XHJcblx0XHRcdFx0XHRpZiAoIXRoaXMucG9wdXAyLmdldFBvc2l0aW9uKCkgfHwgdGhpcy5wb3B1cDIuZ2V0UG9zaXRpb24oKVswXSAhPSBzcG9zWzBdIHx8IHRoaXMucG9wdXAyLmdldFBvc2l0aW9uKClbMV0gIT0gc3Bvc1sxXSlcclxuXHRcdFx0XHRcdCAgICB0aGlzLnBvcHVwMi5zZXRQb3NpdGlvbihzcG9zKTtcclxuXHRcdFx0XHRcdHZhciBjdGltZSA9IChuZXcgRGF0ZSgpKS5nZXRUaW1lKCk7XHRcdFx0IFxyXG5cdFx0XHRcdFx0aWYgKCF0aGlzLmxhc3RQb3B1cFJlZmVyZXNoMiB8fCBjdGltZSAtIHRoaXMubGFzdFBvcHVwUmVmZXJlc2gyID4gMjAwMCkgXHJcblx0XHRcdFx0XHR7XHJcblx0XHRcdFx0XHRcdHRoaXMubGFzdFBvcHVwUmVmZXJlc2gyPWN0aW1lO1xyXG5cdFx0XHRcdFx0ICAgIHZhciByciA9IHRoaXMuc2VsZWN0ZWRQYXJ0aWNpcGFudDIuZ2V0UG9wdXBIVE1MKCk7XHJcblx0XHRcdFx0XHQgICAgaWYgKHJyICE9IHRoaXMucG9wdXAyLmxhc3RIVE1MKSB7XHJcblx0XHRcdFx0XHQgICAgXHR0aGlzLnBvcHVwMi5sYXN0SFRNTD1ycjtcclxuXHRcdFx0XHRcdFx0ICAgIHRoaXMucG9wdXAyLmNvbnRlbnQuaW5uZXJIVE1MPXJyOyBcclxuXHRcdFx0XHRcdCAgICB9XHRcdFx0XHRcdFxyXG5cdFx0XHRcdFx0fVxyXG5cdFx0XHRcdCAgICB0aGlzLnBvcHVwMi5wYW5JbnRvVmlld18oc3Bvcyk7XHJcblx0XHRcdFx0fVxyXG5cdFx0XHR9XHJcblx0XHRcdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS1cdFx0XHRcclxuXHRcdFx0aWYgKHRoaXMuaXNEZWJ1ZykgIFxyXG5cdFx0XHRcdHRoaXMuZG9EZWJ1Z0FuaW1hdGlvbigpO1xyXG5cdFx0fSxcclxuXHRcdFxyXG5cdFx0c2V0U2VsZWN0ZWRQYXJ0aWNpcGFudDEgOiBmdW5jdGlvbihwYXJ0LGNlbnRlcikgXHJcblx0XHR7XHJcblx0XHRcdGlmICghKHBhcnQgaW5zdGFuY2VvZiBQYXJ0aWNpcGFudCkpIHtcclxuXHRcdFx0XHR2YXIgcHA9cGFydDtcclxuXHRcdFx0XHRwYXJ0PW51bGw7XHJcblx0XHRcdFx0Zm9yICh2YXIgaT0wO2k8VFJBQ0sucGFydGljaXBhbnRzLmxlbmd0aDtpKyspXHJcblx0XHRcdFx0XHRpZiAoVFJBQ0sucGFydGljaXBhbnRzW2ldLmRldmljZUlkID09IHBwKSB7XHJcblx0XHRcdFx0XHRcdHBhcnQ9VFJBQ0sucGFydGljaXBhbnRzW2ldO1xyXG5cdFx0XHRcdFx0XHRicmVhaztcclxuXHRcdFx0XHRcdH1cclxuXHRcdFx0fVxyXG5cdFx0XHR0aGlzLnNlbGVjdGVkUGFydGljaXBhbnQxPXBhcnQ7XHJcblx0XHRcdGlmICghcGFydCkge1xyXG5cdFx0XHRcdHRoaXMucG9wdXAxLmhpZGUoKTtcclxuXHRcdFx0XHRkZWxldGUgdGhpcy5wb3B1cDEuaXNfc2hvd247XHJcblx0XHRcdH0gZWxzZSB7XHJcblx0XHRcdFx0dGhpcy5sYXN0UG9wdXBSZWZlcmVzaDE9MDtcclxuXHRcdFx0XHRpZiAoY2VudGVyICYmIEdVSS5tYXAgJiYgcGFydC5mZWF0dXJlKSB7XHJcblx0XHRcdFx0XHR2YXIgeCA9IChwYXJ0LmZlYXR1cmUuZ2V0R2VvbWV0cnkoKS5nZXRFeHRlbnQoKVswXStwYXJ0LmZlYXR1cmUuZ2V0R2VvbWV0cnkoKS5nZXRFeHRlbnQoKVsyXSkvMjtcclxuXHRcdFx0XHRcdHZhciB5ID0gKHBhcnQuZmVhdHVyZS5nZXRHZW9tZXRyeSgpLmdldEV4dGVudCgpWzFdK3BhcnQuZmVhdHVyZS5nZXRHZW9tZXRyeSgpLmdldEV4dGVudCgpWzNdKS8yO1xyXG5cdFx0XHRcdFx0R1VJLm1hcC5nZXRWaWV3KCkuc2V0Q2VudGVyKFt4LHldKTtcclxuXHRcdFx0XHR9XHJcblx0XHRcdH0gXHJcblx0XHR9LFxyXG5cclxuXHRcdHNldFNlbGVjdGVkUGFydGljaXBhbnQyIDogZnVuY3Rpb24ocGFydCxjZW50ZXIpIFxyXG5cdFx0e1xyXG5cdFx0XHRpZiAoIShwYXJ0IGluc3RhbmNlb2YgUGFydGljaXBhbnQpKSB7XHJcblx0XHRcdFx0dmFyIHBwPXBhcnQ7XHJcblx0XHRcdFx0cGFydD1udWxsO1xyXG5cdFx0XHRcdGZvciAodmFyIGk9MDtpPFRSQUNLLnBhcnRpY2lwYW50cy5sZW5ndGg7aSsrKVxyXG5cdFx0XHRcdFx0aWYgKFRSQUNLLnBhcnRpY2lwYW50c1tpXS5kZXZpY2VJZCA9PSBwcCkge1xyXG5cdFx0XHRcdFx0XHRwYXJ0PVRSQUNLLnBhcnRpY2lwYW50c1tpXTtcclxuXHRcdFx0XHRcdFx0YnJlYWs7XHJcblx0XHRcdFx0XHR9XHJcblx0XHRcdH1cclxuXHRcdFx0dGhpcy5zZWxlY3RlZFBhcnRpY2lwYW50Mj1wYXJ0O1xyXG5cdFx0XHRpZiAoIXBhcnQpIHtcclxuXHRcdFx0XHR0aGlzLnBvcHVwMi5oaWRlKCk7XHJcblx0XHRcdFx0ZGVsZXRlIHRoaXMucG9wdXAyLmlzX3Nob3duO1xyXG5cdFx0XHR9IGVsc2Uge1xyXG5cdFx0XHRcdHRoaXMubGFzdFBvcHVwUmVmZXJlc2gyPTA7XHJcblx0XHRcdFx0aWYgKGNlbnRlciAmJiBHVUkubWFwICYmIHBhcnQuZmVhdHVyZSkge1xyXG5cdFx0XHRcdFx0dmFyIHggPSAocGFydC5mZWF0dXJlLmdldEdlb21ldHJ5KCkuZ2V0RXh0ZW50KClbMF0rcGFydC5mZWF0dXJlLmdldEdlb21ldHJ5KCkuZ2V0RXh0ZW50KClbMl0pLzI7XHJcblx0XHRcdFx0XHR2YXIgeSA9IChwYXJ0LmZlYXR1cmUuZ2V0R2VvbWV0cnkoKS5nZXRFeHRlbnQoKVsxXStwYXJ0LmZlYXR1cmUuZ2V0R2VvbWV0cnkoKS5nZXRFeHRlbnQoKVszXSkvMjtcclxuXHRcdFx0XHRcdEdVSS5tYXAuZ2V0VmlldygpLnNldENlbnRlcihbeCx5XSk7XHJcblx0XHRcdFx0fVxyXG5cdFx0XHR9IFxyXG5cdFx0fSxcclxuXHJcblx0XHRkb0RlYnVnQW5pbWF0aW9uIDogZnVuY3Rpb24oKSBcclxuXHRcdHtcclxuXHRcdFx0dmFyIGN0aW1lID0gKG5ldyBEYXRlKCkpLmdldFRpbWUoKTtcclxuXHRcdFx0dmFyIHRvZGVsPVtdO1xyXG5cdFx0XHR2YXIgcnIgPSB0aGlzLmRlYnVnTGF5ZXJHUFMuZ2V0U291cmNlKCkuZ2V0RmVhdHVyZXMoKTtcclxuXHRcdFx0Zm9yICh2YXIgaT0wO2k8cnIubGVuZ3RoO2krKylcclxuXHRcdFx0e1xyXG5cdFx0XHRcdHZhciBmID0gcnJbaV07XHJcblx0XHRcdFx0aWYgKGN0aW1lIC0gZi50aW1lQ3JlYXRlZCAtIENPTkZJRy5tYXRoLmRpc3BsYXlEZWxheSoxMDAwID4gQ09ORklHLnRpbWVvdXRzLmdwc0xvY2F0aW9uRGVidWdTaG93KjEwMDApXHJcblx0XHRcdFx0XHR0b2RlbC5wdXNoKGYpO1xyXG5cdFx0XHRcdGVsc2VcclxuXHRcdFx0XHRcdGYuY2hhbmdlZCgpO1xyXG5cdFx0XHR9XHJcblx0XHRcdGlmICh0b2RlbC5sZW5ndGgpIFxyXG5cdFx0XHR7XHJcblx0XHRcdFx0Zm9yICh2YXIgaT0wO2k8dG9kZWwubGVuZ3RoO2krKylcclxuXHRcdFx0XHRcdHRoaXMuZGVidWdMYXllckdQUy5nZXRTb3VyY2UoKS5yZW1vdmVGZWF0dXJlKHRvZGVsW2ldKTtcclxuXHRcdFx0fVxyXG5cdFx0XHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRcdH0sXHJcblx0XHRcclxuXHRcdHJlZHJhdyA6IGZ1bmN0aW9uKCkge1xyXG5cdFx0XHR0aGlzLmdldFRyYWNrKCkuZ2V0RmVhdHVyZSgpLmNoYW5nZWQoKTtcclxuXHRcdH0sXHJcblxyXG4gICAgICAgIC8qKlxyXG4gICAgICAgICAqIFNob3cgdGhlIGxpdmUtc3RyZWFtaW5nIGNvbnRhaW5lci4gSWYgdGhlIHBhc3NlZCAnc3RyZWFtSWQnIGlzIHZhbGlkIHRoZW4gaXQgb3BlbnMgaXRzIHN0cmVhbSBkaXJlY3RseS5cclxuICAgICAgICAgKiBAcGFyYW0ge1N0cmluZ30gW3N0cmVhbUlkXVxyXG4gICAgICAgICAqIEBwYXJhbSB7RnVuY3Rpb259IFtjb21wbGV0ZUNhbGxiYWNrXVxyXG4gICAgICAgICAqL1xyXG4gICAgICAgIHNob3dMaXZlU3RyZWFtIDogZnVuY3Rpb24oc3RyZWFtSWQsIGNvbXBsZXRlQ2FsbGJhY2spIHtcclxuICAgICAgICAgICAgdGhpcy5saXZlU3RyZWFtLnNob3coc3RyZWFtSWQsIGNvbXBsZXRlQ2FsbGJhY2spO1xyXG4gICAgICAgIH0sXHJcblxyXG4gICAgICAgIC8qKlxyXG4gICAgICAgICAqIFRvZ2dsZSB0aGUgbGl2ZS1zdHJlYW1pbmcgY29udGFpbmVyIGNvbnRhaW5lclxyXG5cdFx0ICogQHBhcmFtIHtGdW5jdGlvbn0gW2NvbXBsZXRlQ2FsbGJhY2tdXHJcbiAgICAgICAgICovXHJcbiAgICAgICAgdG9nZ2xlTGl2ZVN0cmVhbTogZnVuY3Rpb24oY29tcGxldGVDYWxsYmFjaykge1xyXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5saXZlU3RyZWFtLnRvZ2dsZShjb21wbGV0ZUNhbGxiYWNrKTtcclxuICAgICAgICB9XHJcblx0XHRcclxuICAgIH1cclxufSk7IiwicmVxdWlyZSgnam9vc2UnKTtcclxucmVxdWlyZSgnLi9Qb2ludCcpO1xyXG5yZXF1aXJlKCcuL1V0aWxzJyk7XHJcblxyXG5DbGFzcyhcIkhvdFNwb3RcIiwge1xyXG4gICAgaXNhIDogUG9pbnQsXHJcblxyXG4gICAgaGFzIDoge1xyXG4gICAgICAgIHR5cGUgOiB7XHJcbiAgICAgICAgICAgIGlzIDogXCJyb1wiLFxyXG4gICAgICAgICAgICByZXF1aXJlZCA6IHRydWUsXHJcbiAgICAgICAgICAgIGluaXQgOiBudWxsXHJcbiAgICAgICAgfSxcclxuXHJcbiAgICAgICAgY2xpY2thYmxlIDoge1xyXG4gICAgICAgICAgICBpbml0IDogZmFsc2VcclxuICAgICAgICB9LFxyXG5cclxuICAgICAgICBsaXZlU3RyZWFtIDoge1xyXG4gICAgICAgICAgICBpbml0IDogbnVsbFxyXG4gICAgICAgIH1cclxuICAgIH0sXHJcblxyXG4gICAgYWZ0ZXIgOiB7XHJcbiAgICAgICAgaW5pdCA6IGZ1bmN0aW9uKCkge1xyXG4gICAgICAgICAgICB0aGlzLmZlYXR1cmUuaG90c3BvdD10aGlzO1xyXG4gICAgICAgICAgICBHVUkuaG90c3BvdHNMYXllci5nZXRTb3VyY2UoKS5hZGRGZWF0dXJlKHRoaXMuZmVhdHVyZSk7XHJcbiAgICAgICAgfVxyXG4gICAgfSxcclxuXHJcbiAgICBtZXRob2RzIDoge1xyXG4gICAgICAgIG9uQ2xpY2sgOiBmdW5jdGlvbigpIHtcclxuICAgICAgICAgICAgdmFyIGlzQ29uc3VtZWQgPSBmYWxzZTtcclxuXHJcbiAgICAgICAgICAgIGlmICh0aGlzLmNsaWNrYWJsZSkge1xyXG4gICAgICAgICAgICAgICAgLy8gZm9yIG5vdyBvbmx5IGhvdHNwb3RzIHdpdGggYXR0YWNoZWQgbGl2ZS1zdHJlYW0gY2FuIGJlIGNsaWNrZWRcclxuICAgICAgICAgICAgICAgIGlmIChpc0RlZmluZWQodGhpcy5saXZlU3RyZWFtKSkge1xyXG4gICAgICAgICAgICAgICAgICAgIEdVSS5zaG93TGl2ZVN0cmVhbSh0aGlzLmxpdmVTdHJlYW0pO1xyXG4gICAgICAgICAgICAgICAgICAgIC8vIHdlbGwgdGhpcyBldmVudCBzaG91bGQgYmUgY29uc3VtZWQgYW5kIG5vdCBoYW5kbGVkIGFueSBtb3JlIChsaWtlIHdoZW4gY2xpY2tlZCBvbiBhbm90aGVyIGZlYXR1cmVcclxuICAgICAgICAgICAgICAgICAgICBpc0NvbnN1bWVkID0gdHJ1ZTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgcmV0dXJuIGlzQ29uc3VtZWRcclxuICAgICAgICB9LFxyXG5cclxuICAgICAgICBpc0NsaWNrYWJsZSA6IGZ1bmN0aW9uKCkge1xyXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5jbGlja2FibGU7XHJcbiAgICAgICAgfVxyXG5cclxuICAgIH1cclxufSk7IiwiLy8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxucmVxdWlyZSgnLi9UcmFjaycpO1xyXG5yZXF1aXJlKCcuL0dVSScpO1xyXG5yZXF1aXJlKCcuL1BhcnRpY2lwYW50Jyk7XHJcbnJlcXVpcmUoJy4vTW92aW5nQ2FtJyk7XHJcbnJlcXVpcmUoJy4vSG90U3BvdCcpO1xyXG5yZXF1aXJlKCcuL0JhY2tlbmRTdHJlYW0nKTtcclxud2luZG93LkNPTkZJRz1yZXF1aXJlKCcuL0NvbmZpZycpO1xyXG52YXIgVXRpbHM9cmVxdWlyZSgnLi9VdGlscycpO1xyXG5mb3IgKHZhciBlIGluIFV0aWxzKSBcclxuXHR3aW5kb3dbZV09VXRpbHNbZV07XHJcbi8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcbmZ1bmN0aW9uIGdldFNlYXJjaFBhcmFtZXRlcnMoKSB7XHJcbiAgICB2YXIgcHJtc3RyID0gd2luZG93LmxvY2F0aW9uLnNlYXJjaC5zdWJzdHIoMSk7XHJcbiAgICByZXR1cm4gcHJtc3RyICE9IG51bGwgJiYgcHJtc3RyICE9IFwiXCIgPyB0cmFuc2Zvcm1Ub0Fzc29jQXJyYXkocHJtc3RyKSA6IHt9O1xyXG59XHJcbmZ1bmN0aW9uIHRyYW5zZm9ybVRvQXNzb2NBcnJheSggcHJtc3RyICkge1xyXG4gIHZhciBwYXJhbXMgPSB7fTtcclxuICB2YXIgcHJtYXJyID0gcHJtc3RyLnNwbGl0KFwiJlwiKTtcclxuICBmb3IgKCB2YXIgaSA9IDA7IGkgPCBwcm1hcnIubGVuZ3RoOyBpKyspIHtcclxuICAgICAgdmFyIHRtcGFyciA9IHBybWFycltpXS5zcGxpdChcIj1cIik7XHJcbiAgICAgIHBhcmFtc1t0bXBhcnJbMF1dID0gdG1wYXJyWzFdO1xyXG4gIH1cclxuICByZXR1cm4gcGFyYW1zO1xyXG59XHJcbnZhciBwYXJhbXMgPSBnZXRTZWFyY2hQYXJhbWV0ZXJzKCk7XHJcbi8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuaWYgKHBhcmFtc1tcImRlYnVnXCJdICYmIHBhcmFtc1tcImRlYnVnXCJdICE9IFwiMFwiKSBcclxue1xyXG5cdC8vIERFQlVHIE1PREUgQ09ORklHVVJBVElPblxyXG5cdENPTkZJRy50aW1lb3V0cy5hbmltYXRpb25GcmFtZT00OyAvLyA0IHNlY1xyXG59XHJcbi8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxudmFyIHRhYmxlRmF2b3JpdGVzPW51bGw7XHJcbnZhciB0YWJsZVBhcnRpY2lwYW50cz1udWxsO1xyXG52YXIgdGFibGVSYW5rPW51bGw7XHJcblxyXG5mdW5jdGlvbiBzaG93TWFwKCkge1xyXG5cdCQoXCIjbGVmdF9wYW5lXCIpLmFkZENsYXNzKCdoaWRlJyk7XHJcblx0JChcIiNtYXBcIikucmVtb3ZlQ2xhc3MoJ2NvbC1zbS02JykucmVtb3ZlQ2xhc3MoJ2NvbC1tZC04JykucmVtb3ZlQ2xhc3MoJ2hpZGRlbi14cycpLmFkZENsYXNzKCdjb2wtc20tMTInKTtcclxuXHQkKHdpbmRvdykucmVzaXplKCk7XHJcblx0aWYgKEdVSS5tYXApXHJcblx0XHRHVUkubWFwLnVwZGF0ZVNpemUoKTtcclxufVxyXG5mdW5jdGlvbiBzaG93TGVmdFBhbmUoKSB7XHJcblx0JChcIiNtYXBcIikuYWRkQ2xhc3MoJ2NvbC1zbS02IGNvbC1tZC04IGhpZGRlbi14cycpLnJlbW92ZUNsYXNzKCdjb2wtc20tMTInKTtcclxuXHQkKFwiI2xlZnRfcGFuZVwiKS5yZW1vdmVDbGFzcygnaGlkZScpO1xyXG5cdCQod2luZG93KS5yZXNpemUoKTtcclxuXHRpZiAoR1VJLm1hcClcclxuXHRcdEdVSS5tYXAudXBkYXRlU2l6ZSgpO1xyXG59XHJcblxyXG5mdW5jdGlvbiBpc1RhYlZpc2libGUodGFibmFtZSkge1xyXG5cdGlmICgkKFwiI2xlZnRfcGFuZVwiKS5oYXNDbGFzcyhcImhpZGVcIikpXHJcblx0XHRyZXR1cm4gZmFsc2U7XHRcdFx0XHJcblx0aWYgKHRhYm5hbWUuaW5kZXhPZignIycpID09IC0xKSB7XHJcblx0XHR0YWJuYW1lID0gJyMnICsgdGFibmFtZTtcclxuXHR9XHJcblx0cmV0dXJuICEoJCh0YWJuYW1lKS5oYXNDbGFzcygnaGlkZScpKTtcclxufVxyXG5mdW5jdGlvbiBzaG93VGFiKCB0YWJuYW1lICkge1xyXG5cdCQoJyN0YWJjb250JykuZmluZCgnZGl2W3JvbGU9XCJ0YWJwYW5lbFwiXScpLmFkZENsYXNzKCdoaWRlJyk7XHJcblx0aWYgKHRhYm5hbWUuaW5kZXhPZignIycpID09IC0xKSB7XHJcblx0XHR0YWJuYW1lID0gJyMnICsgdGFibmFtZTtcclxuXHR9XHJcblx0JCh0YWJuYW1lKS5yZW1vdmVDbGFzcygnaGlkZScpO1xyXG59XHJcblxyXG5mdW5jdGlvbiBzaG93UGFydGljaXBhbnRzKCkge1xyXG5cdHNob3dMZWZ0UGFuZSgpO1xyXG5cdHNob3dUYWIoXCJwYXJ0XCIpO1xyXG5cdGlmICghdGFibGVQYXJ0aWNpcGFudHMpXHJcblx0e1xyXG4gICAgICAgIHRhYmxlUGFydGljaXBhbnRzID0gJCgnI3RhYmxlLXBhcnRpY2lwYW50cycpLkRhdGFUYWJsZSgge1xyXG5cdFx0XHRcImlEaXNwbGF5TGVuZ3RoXCIgOiA1MCxcclxuXHRcdFx0XCJiQXV0b1dpZHRoXCI6IGZhbHNlLFxyXG5cdFx0XHRcImFhU29ydGluZ1wiOiBbWzIsJ2FzYyddXSxcclxuXHRcdFx0Ly9hamF4OiBDT05GSUcuc2VydmVyLnByZWZpeCtcInJlc3QvcGFydGljaXBhbnQvXCIsXHJcblx0XHRcdGRhdGEgOiBmdW5jdGlvbigpICB7XHJcblx0XHRcdFx0cmV0dXJuIFBBUlRJQ0lQQU5UUztcclxuXHRcdFx0fSxcdFxyXG5cdFx0XHRjb2x1bW5zOiBbXHJcblx0XHRcdFx0eyBcclxuXHRcdFx0XHRcdC8vZm9sbG93XHJcblx0XHRcdFx0XHRjbGFzc05hbWUgOiBcImR0LWJvZHktY2VudGVyXCIsIFxyXG5cdFx0XHRcdFx0ZGF0YTogbnVsbCxcclxuXHRcdFx0XHRcdHJlbmRlcjogZnVuY3Rpb24gKCBkYXRhLCB0eXBlLCByb3cgKSBcclxuXHRcdFx0XHRcdHtcclxuXHRcdFx0XHRcdFx0aWYgKGRhdGEuZm9sbG93ID09IDEpXHJcblx0XHRcdFx0XHRcdFx0cmV0dXJuIFwiPGRpdiBjbGFzcz0naW52aXNpYmxlJz4xPC9kaXY+PGltZyBzcmM9J2ltZy9mYXZvcml0ZS5wbmcnIGNsYXNzPSd0YWJsZS1mYXZvcml0ZS1hZGQnLz5cIjtcclxuXHRcdFx0XHRcdFx0cmV0dXJuIFwiPGRpdiBjbGFzcz0naW52aXNpYmxlJz4wPC9kaXY+PGltZyBzcmM9J2ltZy9mYXZvcml0ZS1hZGQucG5nJyBjbGFzcz0ndGFibGUtZmF2b3JpdGUtYWRkJy8+XCI7XHJcblx0XHRcdFx0XHR9IFxyXG5cdFx0XHRcdFx0XHRcdFxyXG5cdFx0XHRcdH0sXHJcblx0XHRcdFx0eyBkYXRhOiBcIm5hbWVcIiB9LFxyXG5cdFx0XHRcdHsgZGF0YTogXCJiaWJcIixjbGFzc05hbWUgOiBcImR0LWJvZHktY2VudGVyXCIgfSxcclxuXHRcdFx0XHR7IGRhdGE6IFwiZ2VuZGVyXCIsY2xhc3NOYW1lIDogXCJkdC1ib2R5LWNlbnRlclwiIH0sXHJcblx0XHRcdFx0eyBcclxuXHRcdFx0XHRcdGNsYXNzTmFtZSA6IFwiZHQtYm9keS1jZW50ZXJcIiwgXHJcblx0XHRcdFx0XHRkYXRhOiBudWxsLFxyXG5cdFx0XHRcdFx0cmVuZGVyOiBmdW5jdGlvbiAoIGRhdGEsIHR5cGUsIHJvdyApIFxyXG5cdFx0XHRcdFx0e1xyXG5cdFx0XHRcdFx0XHRpZiAoIWRhdGEuY291bnRyeSlcclxuXHRcdFx0XHRcdFx0XHRyZXR1cm4gXCJcIjtcclxuXHRcdFx0XHRcdFx0cmV0dXJuICc8ZGl2IGNsYXNzPVwiaW52aXNpYmxlXCI+JytkYXRhLmNvdW50cnkrJzwvZGl2PjxmbGFnLWljb24ga2V5PVwiJytkYXRhLmNvdW50cnkrJ1wiIHdpZHRoPVwiNDJcIj48L2ZsYWctaWNvbj4nO1xyXG5cdFx0XHRcdFx0fSBcdFx0XHRcdFx0XHJcblx0XHRcdFx0fSxcclxuXHRcdFx0XHR7IFxyXG5cdFx0XHRcdFx0Ly8gYWdlICsgR1JPVVBcclxuXHRcdFx0XHRcdGRhdGE6IG51bGwsXHJcbiAgICAgICAgICAgICAgICAgICAgY2xhc3NOYW1lIDogXCJkdC1ib2R5LXJpZ2h0XCIsXHJcblx0XHRcdFx0XHRyZW5kZXI6IGZ1bmN0aW9uICggZGF0YSwgdHlwZSwgcm93ICkgXHJcblx0XHRcdFx0XHR7XHJcblx0XHRcdFx0XHRcdHZhciBhZ2UgPSBwYXJzZUludChkYXRhLmFnZSk7XHJcblx0XHRcdFx0XHRcdHJldHVybiBkYXRhLmFnZUdyb3VwK1wiIChcIithZ2UrXCIpXCI7XHJcblx0XHRcdFx0XHR9XHJcblxyXG5cdFx0XHRcdH1cclxuXHRcclxuXHRcdFx0XSxcclxuXHRcdFx0dGFibGVUb29sczoge1xyXG5cdFx0XHRcdHNSb3dTZWxlY3Q6IFwib3NcIixcclxuXHRcdFx0XHRhQnV0dG9uczogW1x0XHRcdCAgICAgICAgICAgXHJcblx0ICAgICAgICAgICBdXHJcblx0XHRcdH1cclxuXHRcdH0gKTtcclxuXHR9IGVsc2Uge1xyXG5cdFx0JChcIiN0YWJsZS1wYXJ0aWNpcGFudHNcIikucmVzaXplKCk7ICBcclxuXHR9XHJcbn1cclxuXHJcbmZ1bmN0aW9uIHNob3dGYXZzKCkgXHJcbntcclxuXHRzaG93TGVmdFBhbmUoKTtcclxuXHRzaG93VGFiKFwiZmF2c1wiKTtcclxuXHRpZiAoIXRhYmxlRmF2b3JpdGVzKSBcclxuXHR7XHJcblx0XHR0YWJsZUZhdm9yaXRlcyA9ICQoJyN0YWJsZS1mYXZvcml0ZXMnKS5EYXRhVGFibGUoIHtcclxuXHRcdFx0XCJpRGlzcGxheUxlbmd0aFwiIDogNTAsXHJcblx0XHRcdFwiYkF1dG9XaWR0aFwiOiBmYWxzZSxcclxuXHRcdFx0XCJhYVNvcnRpbmdcIjogW1sxLCdhc2MnXV0sXHJcblx0XHRcdGRhdGEgOiBmdW5jdGlvbiAoKSB7XHJcblx0XHRcdFx0dmFyIGFyciA9IFBBUlRJQ0lQQU5UUzsvLy5maWx0ZXIoZnVuY3Rpb24odil7IHJldHVybiB2LmlzRmF2b3JpdGU7IH0pO1xyXG5cdFx0XHRcdHZhciByZXMgPSBbXTtcclxuXHRcdFx0XHRmb3IgKHZhciBpIGluIGFycikgXHJcblx0XHRcdFx0e1xyXG5cdFx0XHRcdFx0dmFyIHBhcnQgPSBhcnJbaV07XHJcblx0XHRcdFx0XHRyZXMucHVzaCh7bmFtZSA6IHBhcnQubmFtZSxiaWIgOiBwYXJ0LnN0YXJ0UG9zLGdlbmRlciA6IHBhcnQuZ2VuZGVyLGNvdW50cnkgOiBwYXJ0LmNvdW50cnksYWdlR3JvdXAgOiBwYXJ0LmFnZUdyb3VwLGFnZSA6IHBhcnQuYWdlfSk7XHJcblx0XHRcdFx0fVxyXG5cdFx0XHRcdGNvbnNvbGUubG9nKHJlcyk7XHJcblx0XHRcdFx0cmV0dXJuIHJlcztcclxuXHRcdFx0fSxcdFxyXG5cdFx0XHRjb2x1bW5zOiBbXHJcblx0XHRcdFx0eyBkYXRhOiBcIm5hbWVcIiB9LFxyXG5cdFx0XHRcdHsgZGF0YTogXCJiaWJcIixjbGFzc05hbWUgOiBcImR0LWJvZHktY2VudGVyXCIgfSxcclxuICAgICAgICAgICAgICAgIHsgZGF0YTogXCJnZW5kZXJcIixjbGFzc05hbWUgOiBcImR0LWJvZHktY2VudGVyXCIgfSxcclxuICAgICAgICAgICAgICAgIHtcclxuICAgICAgICAgICAgICAgICAgICBjbGFzc05hbWUgOiBcImR0LWJvZHktY2VudGVyXCIsXHJcbiAgICAgICAgICAgICAgICAgICAgZGF0YTogbnVsbCxcclxuXHRcdFx0XHRcdHJlbmRlcjogZnVuY3Rpb24gKCBkYXRhLCB0eXBlLCByb3cgKSBcclxuXHRcdFx0XHRcdHtcclxuXHRcdFx0XHRcdFx0aWYgKCFkYXRhLmNvdW50cnkpXHJcblx0XHRcdFx0XHRcdFx0cmV0dXJuIFwiXCI7XHJcblx0XHRcdFx0XHRcdHJldHVybiAnPGRpdiBjbGFzcz1cImludmlzaWJsZVwiPicrZGF0YS5jb3VudHJ5Kyc8L2Rpdj48ZmxhZy1pY29uIGtleT1cIicrZGF0YS5jb3VudHJ5KydcIiB3aWR0aD1cIjQyXCI+PC9mbGFnLWljb24+JztcclxuXHRcdFx0XHRcdH0gXHJcblx0XHRcdFx0fSxcclxuXHRcdFx0XHR7IFxyXG5cdFx0XHRcdFx0Ly8gYWdlICsgR1JPVVBcclxuXHRcdFx0XHRcdGRhdGE6IG51bGwsXHJcblx0XHRcdFx0XHRyZW5kZXI6IGZ1bmN0aW9uICggZGF0YSwgdHlwZSwgcm93ICkgXHJcblx0XHRcdFx0XHR7XHJcblx0XHRcdFx0XHRcdHZhciBhZ2UgPSBwYXJzZUludChkYXRhLmFnZSk7XHJcblx0XHRcdFx0XHRcdHJldHVybiBkYXRhLmFnZUdyb3VwK1wiIChcIithZ2UrXCIpXCI7XHJcblx0XHRcdFx0XHR9IFxyXG5cdFx0XHRcdFx0LGNsYXNzTmFtZSA6IFwiZHQtYm9keS1yaWdodFwiXHJcblxyXG5cdFx0XHRcdH1cclxuXHRcdFx0XSxcclxuXHRcdFx0dGFibGVUb29sczoge1xyXG5cdFx0XHRcdHNSb3dTZWxlY3Q6IFwib3NcIixcclxuXHRcdFx0XHRhQnV0dG9uczogW1x0XHRcdCAgICAgICAgICAgXHJcblx0ICAgICAgICAgICBdXHJcblx0XHRcdH1cclxuXHRcdH0gKTtcclxuXHRcdCQoJyN0YWJsZS1mYXZvcml0ZXMnKS5maW5kKCd0Ym9keScpLm9uKCAnY2xpY2snLCAndHInLCBmdW5jdGlvbiAoZSkge1xyXG5cdFx0XHRpZiAodGFibGVGYXZvcml0ZXMucm93KCB0aGlzICkuZGF0YSgpKSB7XHJcblx0XHRcdFx0R1VJLnNldFNlbGVjdGVkUGFydGljaXBhbnQxKHRhYmxlRmF2b3JpdGVzLnJvdyggdGhpcyApLmRhdGEoKS5jb2RlLHRydWUpO1xyXG5cdFx0XHRcdEdVSS5zZXRTZWxlY3RlZFBhcnRpY2lwYW50MihudWxsKTtcclxuXHRcdFx0fVxyXG5cdFx0fSApO1xyXG5cdH0gZWxzZSB7XHJcblx0XHQkKFwiI3RhYmxlLWZhdm9yaXRlc1wiKS5yZXNpemUoKTsgIFxyXG5cdH1cclxufVxyXG5cclxuZnVuY3Rpb24gc2hvd1JhbmsoKSBcclxue1xyXG5cdHNob3dMZWZ0UGFuZSgpO1xyXG5cdHNob3dUYWIoXCJyYW5rXCIpO1xyXG5cdGlmICghdGFibGVSYW5rKSBcclxuXHR7XHJcblx0XHR2YXIgYXJyID0gUEFSVElDSVBBTlRTOy8vLmZpbHRlcihmdW5jdGlvbih2KXsgcmV0dXJuIHYuaXNGYXZvcml0ZTsgfSk7XHJcblx0XHR2YXIgZGF0YSA9IFtdO1xyXG5cdFx0Zm9yICh2YXIgaSBpbiBhcnIpIFxyXG5cdFx0e1xyXG5cdFx0XHR2YXIgcGFydCA9IGFycltpXTtcclxuXHRcdFx0Y29uc29sZS5sb2cocGFydCk7XHJcblx0XHRcdGRhdGEucHVzaCh7XCJuYW1lXCIgOiBwYXJ0LmNvZGUsXCJiaWJcIiA6IHBhcnQuc3RhcnRQb3MsXCJnZW5kZXJcIiA6IHBhcnQuZ2VuZGVyLFwiY291bnRyeVwiIDogcGFydC5jb3VudHJ5LFwiYWdlR3JvdXBcIiA6IHBhcnQuYWdlR3JvdXAsXCJhZ2VcIiA6IHBhcnQuYWdlLFwib3ZlcmFsbC1yYW5rXCI6cGFydC5vdmVyYWxsUmFuayxcImdlbmRlci1yYW5rXCIgOiBwYXJ0LmdlbmRlclJhbmssXCJncm91cC1yYW5rXCIgOiBwYXJ0Lmdyb3VwUmFuayxcIm9jY3VwYXRpb25cIiA6IFwiXCJ9KTtcclxuXHRcdH1cclxuXHRcdGNvbnNvbGUubG9nKGRhdGEpO1xyXG5cclxuXHRcdHRhYmxlUmFuayA9ICQoJyN0YWJsZS1yYW5raW5nJykuRGF0YVRhYmxlKCB7XHJcblx0XHRcdFwiaURpc3BsYXlMZW5ndGhcIiA6IDUwLFxyXG5cdFx0XHRcImJBdXRvV2lkdGhcIjogZmFsc2UsXHJcblx0XHRcdFwiYWFTb3J0aW5nXCI6IFtbMSwnYXNjJ11dLFxyXG5cdFx0XHQvL2FqYXg6IFwic2NyaXB0L3BhcnRpY2lwYW50cy1leGFtcGxlLmpzb25cIixcclxuXHRcdFx0ZGF0YSA6IGRhdGEsXHJcblx0XHRcdGNvbHVtbnM6IFtcclxuXHRcdFx0XHR7IGRhdGE6IFwibmFtZVwiIH0sXHJcblx0XHRcdFx0eyBkYXRhOiBcIm92ZXJhbGwtcmFua1wiLGNsYXNzTmFtZSA6IFwiZHQtYm9keS1jZW50ZXJcIiB9LFxyXG5cdFx0XHRcdHsgZGF0YTogXCJncm91cC1yYW5rXCIsY2xhc3NOYW1lIDogXCJkdC1ib2R5LWNlbnRlclwiIH0sXHJcblx0XHRcdFx0eyBkYXRhOiBcImdlbmRlci1yYW5rXCIsY2xhc3NOYW1lIDogXCJkdC1ib2R5LWNlbnRlclwiIH0sXHJcblx0XHRcdFx0eyBkYXRhOiBcImJpYlwiLGNsYXNzTmFtZSA6IFwiZHQtYm9keS1jZW50ZXJcIiB9LFxyXG5cdFx0XHRcdHsgZGF0YTogXCJnZW5kZXJcIixjbGFzc05hbWUgOiBcImR0LWJvZHktY2VudGVyXCIgfSxcclxuICAgICAgICAgICAgICAgIHtcclxuICAgICAgICAgICAgICAgICAgICBjbGFzc05hbWUgOiBcImR0LWJvZHktY2VudGVyXCIsXHJcbiAgICAgICAgICAgICAgICAgICAgZGF0YTogbnVsbCxcclxuICAgICAgICAgICAgICAgICAgICByZW5kZXI6IGZ1bmN0aW9uICggZGF0YSwgdHlwZSwgcm93IClcclxuICAgICAgICAgICAgICAgICAgICB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmICghZGF0YS5jb3VudHJ5KVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIFwiXCI7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiAnPGRpdiBjbGFzcz1cImludmlzaWJsZVwiPicrZGF0YS5jb3VudHJ5Kyc8L2Rpdj48ZmxhZy1pY29uIGtleT1cIicrZGF0YS5jb3VudHJ5KydcIiB3aWR0aD1cIjQyXCI+PC9mbGFnLWljb24+JztcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9LFxyXG5cdFx0XHRcdHsgXHJcblx0XHRcdFx0XHQvLyBhZ2UgKyBHUk9VUFxyXG5cdFx0XHRcdFx0ZGF0YTogbnVsbCxcclxuXHRcdFx0XHRcdHJlbmRlcjogZnVuY3Rpb24gKCBkYXRhLCB0eXBlLCByb3cgKSBcclxuXHRcdFx0XHRcdHtcclxuXHRcdFx0XHRcdFx0dmFyIGFnZSA9IHBhcnNlSW50KGRhdGEuYWdlKTtcclxuXHRcdFx0XHRcdFx0cmV0dXJuIGRhdGEuYWdlR3JvdXArXCIgKFwiK2FnZStcIilcIjtcclxuXHRcdFx0XHRcdH0gXHJcblx0XHRcdFx0fSxcclxuXHRcdFx0XHR7IGRhdGE6IFwib2NjdXBhdGlvblwiLGNsYXNzTmFtZSA6IFwiZHQtYm9keS1jZW50ZXJcIiB9XHJcblx0XHRcdF0sXHJcblx0XHRcdHRhYmxlVG9vbHM6IHtcclxuXHRcdFx0XHRzUm93U2VsZWN0OiBcIm9zXCIsXHJcblx0XHRcdFx0YUJ1dHRvbnM6IFtcdFx0XHQgICAgICAgICAgIFxyXG5cdCAgICAgICAgICAgXVxyXG5cdFx0XHR9XHJcblx0XHR9ICk7XHJcblx0fSBlbHNlIHtcclxuXHRcdCQoXCIjdGFibGUtZmF2b3JpdGVzXCIpLnJlc2l6ZSgpOyAgXHJcblx0fVxyXG59XHJcblxyXG5mdW5jdGlvbiBzaG93RGV0YWlscygpIHtcclxuXHRzaG93TGVmdFBhbmUoKTtcclxuXHRzaG93VGFiKFwiZHRsc1wiKTtcclxufVxyXG5cclxuLy8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG53aW5kb3cuVFJBQ0sgPSBuZXcgVHJhY2soKTtcclxud2luZG93LkdVSSA9IG5ldyBHdWkoeyB0cmFjayA6IFRSQUNLIH0pO1xyXG53aW5kb3cuUEFSVElDSVBBTlRTPVtdO1xyXG5mdW5jdGlvbiBlcnJvclJvdXRlKGVycikge1xyXG5cdEdVSS5zaG93RXJyb3IoZXJyKTtcclxufVxyXG4vLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcbmZ1bmN0aW9uIGluaXRHVUkoKSBcclxue1xyXG4gICAgLy8gYWRkIGFsbCB0aGUgc3RhdGljIEhvdFNwb3RzXHJcbiAgICB2YXIgZHluYW1pY1RyYWNrSG90c3BvdHMgPSBbXTtcclxuXHRmb3IgKHZhciBrPTA7azxIT1RTUE9UUy5sZW5ndGg7aysrKVx0e1xyXG5cdFx0dmFyIGhvdHNwb3REYXRhID0gSE9UU1BPVFNba107XHJcblx0XHR2YXIgaG90c3BvdCA9IG5ldyBIb3RTcG90KEhPVFNQT1RTW2tdKTtcclxuXHRcdGlmIChob3RzcG90RGF0YS5wb2ludCkge1xyXG5cdFx0XHQvLyB0aGlzIGlzIGEgc3RhdGljIGhvdHNwb3QgLSBqdXN0IGEgZml4ZWQgcG9pbnRcclxuXHRcdFx0aG90c3BvdC5pbml0KEhPVFNQT1RTW2tdLnBvaW50KTtcclxuXHRcdH0gZWxzZSB7XHJcblx0XHRcdC8vIHRoaXMgaXMgYSBkeW5hbWljIEhvdFNwb3QgLSBkZXBlbmRpbmcgb24gdGhlIFRyYWNrXHJcblx0XHRcdGR5bmFtaWNUcmFja0hvdHNwb3RzLnB1c2goaG90c3BvdClcclxuXHRcdH1cclxuICAgIH1cclxuXHRUUkFDSy5uZXdIb3RTcG90cyhkeW5hbWljVHJhY2tIb3RzcG90cyk7XHJcbn1cclxuLy8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG4kKGRvY3VtZW50KS5yZWFkeSggZnVuY3Rpb24gKCkgXHJcbntcclxuXHRpZiAoVXRpbHMubW9iaWxlQW5kVGFibGV0Q2hlY2soKSlcclxuXHRcdCQoXCJib2R5XCIpLmFkZENsYXNzKFwibW9iaWxlXCIpO1xyXG5cdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHR2YXIgYmFzZXVybCA9ICh3aW5kb3cubG9jYXRpb24uaG9zdC5pbmRleE9mKFwibG9jYWxob3N0XCIpID09IDAgfHwgd2luZG93LmxvY2F0aW9uLmhvc3QuaW5kZXhPZihcIjEyNy4wLjAuMVwiKSA9PSAwKSA/IFwiaHR0cDovL2xvY2FsaG9zdDozMDAwL1wiIDogXCJub2RlL1wiOyBcclxuXHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0JC5nZXRKU09OKGJhc2V1cmwrXCJldmVudFwiLGZ1bmN0aW9uKGRhdGEpIFxyXG5cdHtcclxuXHRcdHZhciBkZWxheSA9IC0obmV3IERhdGUoKSkuZ2V0VGltZXpvbmVPZmZzZXQoKSo2MCoxMDAwO1x0Ly8gMTIwIGZvciBnbXQrMlxyXG5cdFx0dmFyIGNhbWMgPSAwO1xyXG5cdFx0VFJBQ0suc2V0QmlrZVN0YXJ0S00oZGF0YS5iaWtlU3RhcnRLTSk7XHJcblx0XHRUUkFDSy5zZXRSdW5TdGFydEtNKGRhdGEucnVuU3RhcnRLTSk7XHJcblx0XHRUUkFDSy5zZXRSb3V0ZShkYXRhLnJvdXRlKTtcclxuXHRcdENPTkZJRy50aW1lcz17YmVnaW4gOiBkYXRhLnRpbWVzLnN0YXJ0VGltZStkZWxheSwgZW5kIDogZGF0YS50aW1lcy5lbmRUaW1lK2RlbGF5IH07XHJcblx0XHRHVUkuaW5pdCh7c2tpcEV4dGVudDp0cnVlfSk7XHJcblx0XHR2YXIgc3RyZWFtID0gbmV3IEJhY2tlbmRTdHJlYW0oKTtcclxuXHRcdGZ1bmN0aW9uIHByb2Nlc3NFbnRyeShwZGF0YSxpc0NhbSkge1xyXG5cdFx0XHR2YXIgcGFydDsgXHJcblx0XHRcdGlmIChpc0NhbSlcclxuXHRcdFx0XHRwYXJ0PVRSQUNLLm5ld01vdmluZ0NhbShwZGF0YS5pZCxwZGF0YS5kZXZpY2VJZCxwZGF0YS5jb2RlLGNhbWMrKyk7XHJcblx0XHRcdGVsc2VcclxuXHRcdFx0XHRwYXJ0PVRSQUNLLm5ld1BhcnRpY2lwYW50KHBkYXRhLmlkLHBkYXRhLmRldmljZUlkLHBkYXRhLmNvZGUpO1xyXG5cdFx0XHRwYXJ0LnNldENvbG9yKHBkYXRhLmNvbG9yKTtcclxuXHRcdFx0cGFydC5zZXRBZ2VHcm91cChwZGF0YS5hZ2VHcm91cCk7XHJcblx0XHRcdHBhcnQuc2V0QWdlKHBkYXRhLmFnZSk7XHJcblx0XHRcdHBhcnQuc2V0Q291bnRyeShwZGF0YS5jb3VudHJ5KTtcclxuXHRcdFx0cGFydC5zZXRTdGFydFBvcyhwZGF0YS5zdGFydFBvcyk7XHJcblx0XHRcdHBhcnQuc2V0R2VuZGVyKHBkYXRhLmdlbmRlcik7XHJcblx0XHRcdHBhcnQuc2V0SWNvbihwZGF0YS5pY29uKTtcclxuXHRcdFx0cGFydC5zZXRJbWFnZShwZGF0YS5pbWFnZSk7XHJcblx0XHRcdGlmIChpc0NhbSB8fCBsb2NhbFN0b3JhZ2UuZ2V0SXRlbShcImZhdm9yaXRlLVwiK3BhcnQuaWQpID09IDEpXHJcblx0XHRcdFx0cGFydC5zZXRJc0Zhdm9yaXRlKHRydWUpO1xyXG5cdFx0XHRpZiAoIWlzQ2FtKSBcclxuXHRcdFx0XHRQQVJUSUNJUEFOVFMucHVzaChwYXJ0KTtcclxuXHRcdH1cclxuXHRcdGZvciAodmFyIGkgaW4gZGF0YS5wYXJ0aWNpcGFudHMpIFxyXG5cdFx0XHRwcm9jZXNzRW50cnkoZGF0YS5wYXJ0aWNpcGFudHNbaV0sZmFsc2UpO1xyXG5cdFx0Zm9yICh2YXIgaSBpbiBkYXRhLmNhbXMpIFxyXG5cdFx0XHRwcm9jZXNzRW50cnkoZGF0YS5jYW1zW2ldLHRydWUpO1xyXG5cdFx0c3RyZWFtLnN0YXJ0KFRSQUNLKTtcclxuXHRcdGluaXRHVUkoKTtcclxuXHR9KS5mYWlsKGZ1bmN0aW9uKCkge1xyXG4gICAgXHRjb25zb2xlLmVycm9yKFwiRXJyb3IgZ2V0IGV2ZW50IGNvbmZpZ3VyYXRpb24gZnJvbSBiYWNrZW5kIVwiKTtcclxuXHR9KTtcclxuXHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0JChcIiNidXR0b25fc3dpbVwiKS5jc3MoXCJiYWNrZ3JvdW5kLWNvbG9yXCIsQ09ORklHLmFwcGVhcmFuY2UudHJhY2tDb2xvclN3aW0pLmNsaWNrKGZ1bmN0aW9uKCkge1xyXG5cdFx0aWYgKCQodGhpcykuaGFzQ2xhc3MoXCJpbmFjdGl2ZVwiKSlcclxuXHRcdHtcclxuXHRcdFx0JCh0aGlzKS5yZW1vdmVDbGFzcyhcImluYWN0aXZlXCIpO1xyXG5cdFx0XHRHVUkuaXNTaG93U3dpbT10cnVlO1xyXG5cdFx0fSBlbHNlIHtcclxuXHRcdFx0JCh0aGlzKS5hZGRDbGFzcyhcImluYWN0aXZlXCIpO1xyXG5cdFx0XHRHVUkuaXNTaG93U3dpbT1mYWxzZTtcclxuXHRcdH1cclxuXHRcdEdVSS5yZWRyYXcoKTtcclxuXHR9KTtcclxuXHJcblx0JChcIiNidXR0b25fYmlrZVwiKS5jc3MoXCJiYWNrZ3JvdW5kLWNvbG9yXCIsQ09ORklHLmFwcGVhcmFuY2UudHJhY2tDb2xvckJpa2UpLmNsaWNrKGZ1bmN0aW9uKCkge1xyXG5cdFx0aWYgKCQodGhpcykuaGFzQ2xhc3MoXCJpbmFjdGl2ZVwiKSlcclxuXHRcdHtcclxuXHRcdFx0JCh0aGlzKS5yZW1vdmVDbGFzcyhcImluYWN0aXZlXCIpO1xyXG5cdFx0XHRHVUkuaXNTaG93QmlrZT10cnVlO1xyXG5cdFx0fSBlbHNlIHtcclxuXHRcdFx0JCh0aGlzKS5hZGRDbGFzcyhcImluYWN0aXZlXCIpO1xyXG5cdFx0XHRHVUkuaXNTaG93QmlrZT1mYWxzZTtcclxuXHRcdH1cclxuXHRcdEdVSS5yZWRyYXcoKTtcclxuXHR9KTtcclxuXHJcblx0JChcIiNidXR0b25fcnVuXCIpLmNzcyhcImJhY2tncm91bmQtY29sb3JcIixDT05GSUcuYXBwZWFyYW5jZS50cmFja0NvbG9yUnVuKS5jbGljayhmdW5jdGlvbigpIHtcclxuXHRcdGlmICgkKHRoaXMpLmhhc0NsYXNzKFwiaW5hY3RpdmVcIikpXHJcblx0XHR7XHJcblx0XHRcdCQodGhpcykucmVtb3ZlQ2xhc3MoXCJpbmFjdGl2ZVwiKTtcclxuXHRcdFx0R1VJLmlzU2hvd1J1bj10cnVlO1xyXG5cdFx0fSBlbHNlIHtcclxuXHRcdFx0JCh0aGlzKS5hZGRDbGFzcyhcImluYWN0aXZlXCIpO1xyXG5cdFx0XHRHVUkuaXNTaG93UnVuPWZhbHNlO1xyXG5cdFx0fVxyXG5cdFx0R1VJLnJlZHJhdygpO1xyXG5cdH0pO1xyXG5cclxuXHQkKFwiI2J1dHRvbl9wYXJ0aWNpcGFudHNcIikuY2xpY2soZnVuY3Rpb24oKSB7XHJcblx0XHRpZiAoaXNUYWJWaXNpYmxlKFwicGFydFwiKSlcclxuXHRcdFx0c2hvd01hcCgpO1xyXG5cdFx0ZWxzZVxyXG5cdFx0XHRzaG93UGFydGljaXBhbnRzKCk7XHJcblx0fSk7XHJcblxyXG5cdCQoXCIjYnV0dG9uX2Zhdm9yaXRlc1wiKS5jbGljayhmdW5jdGlvbigpIHtcclxuXHRcdGlmIChpc1RhYlZpc2libGUoXCJmYXZzXCIpKVxyXG5cdFx0XHRzaG93TWFwKCk7XHJcblx0XHRlbHNlXHJcblx0XHRcdHNob3dGYXZzKCk7XHJcblx0fSk7XHJcblxyXG5cdCQoXCIjYnV0dG9uX3JhbmtcIikuY2xpY2soZnVuY3Rpb24oKSB7XHJcblx0XHRpZiAoaXNUYWJWaXNpYmxlKFwicmFua1wiKSlcclxuXHRcdFx0c2hvd01hcCgpO1xyXG5cdFx0ZWxzZVxyXG5cdFx0XHRzaG93UmFuaygpO1xyXG5cdH0pO1xyXG5cclxuXHQkKFwiI3RhYmNvbnRcIikuZmluZChcIi5jbG9zZVwiKS5jbGljayhmdW5jdGlvbigpIHtcclxuXHRcdHNob3dNYXAoKTtcclxuXHR9KTtcclxuXHJcblxyXG5cdCQoXCIjbGlua19wYXJ0bmVycywgI2xpbmtfbGVnYWxOb3RpY2UsICNidXR0b25fbGl2ZVN0cmVhbVwiKS5jbGljayhmdW5jdGlvbigpIHtcclxuXHRcdC8vIFRPRE8gUnVtZW4gLSBkb24ndCBsaWtlIGl0LCB3aWxsIGhhdmUgdG8gZml4IGl0IGxhdGVyXHJcblx0XHR2YXIgJHRvQ2xvc2UgPSAkKFwiLl9jb250VmlzaWJsZVwiKTtcclxuXHRcdHZhciAkdG9PcGVuID0gJChcIiNcIiArICQodGhpcykuZGF0YShcIm9wZW5cIikpO1xyXG5cdFx0dmFyIGlzTGl2ZVN0cmVhbUNsb3NlID0gJHRvQ2xvc2UuaXMoXCIjbGl2ZVN0cmVhbVwiKTtcclxuXHRcdHZhciBpc0xpdmVTdHJlYW1PcGVuID0gJHRvT3Blbi5pcyhcIiNsaXZlU3RyZWFtXCIpO1xyXG5cclxuXHRcdHZhciBzZWxmID0gdGhpcztcclxuXHRcdGZ1bmN0aW9uIG9wZW4oKSB7XHJcblx0XHRcdCR0b0Nsb3NlLnJlbW92ZUNsYXNzKFwiX2NvbnRWaXNpYmxlXCIpO1xyXG5cclxuXHRcdFx0aWYgKCR0b0Nsb3NlLmlzKCR0b09wZW4pKVxyXG5cdFx0XHRcdHJldHVybjtcclxuXHJcblx0XHRcdGlmIChpc0xpdmVTdHJlYW1PcGVuKSB7XHJcblx0XHRcdFx0dmFyIGlzU2hvd24gPSBHVUkudG9nZ2xlTGl2ZVN0cmVhbSgpO1xyXG5cdFx0XHRcdCR0b09wZW4udG9nZ2xlQ2xhc3MoXCJfY29udFZpc2libGVcIiwgaXNTaG93bik7XHJcblx0XHRcdH0gZWxzZSB7XHJcblx0XHRcdFx0JHRvT3Blbi5hZGRDbGFzcyhcIl9jb250VmlzaWJsZVwiKTtcclxuXHRcdFx0XHQkdG9PcGVuLnNsaWRlRG93bigpO1xyXG5cdFx0XHR9XHJcblx0XHR9XHJcblxyXG5cdFx0aWYgKCR0b0Nsb3NlLmxlbmd0aCkge1xyXG5cdFx0XHRpZiAoaXNMaXZlU3RyZWFtQ2xvc2UpIHtcclxuXHRcdFx0XHRHVUkudG9nZ2xlTGl2ZVN0cmVhbShvcGVuKTtcclxuXHRcdFx0fSBlbHNlIHtcclxuXHRcdFx0XHQkdG9DbG9zZS5zbGlkZVVwKDQwMCwgb3Blbik7XHJcblx0XHRcdH1cclxuXHRcdH0gZWxzZSB7XHJcblx0XHRcdG9wZW4oKTtcclxuXHRcdH1cclxuXHR9KTtcclxuXHJcbn0pO1xyXG5cclxuIiwicmVxdWlyZSgnam9vc2UnKTtcclxucmVxdWlyZSgnLi9VdGlscycpO1xyXG5cclxuQ2xhc3MoXCJMaXZlU3RyZWFtXCIsIHtcclxuICAgIGhhcyA6IHtcclxuICAgICAgICBfJGNvbXAgOiB7XHJcbiAgICAgICAgICAgIGluaXQ6IGZ1bmN0aW9uKGNvbmZpZykge1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuICQoJyMnICsgY29uZmlnLmlkKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0sXHJcblxyXG4gICAgICAgIF9pc1Nob3duIDoge1xyXG4gICAgICAgICAgIGluaXQgOiBmYWxzZVxyXG4gICAgICAgIH0sXHJcblxyXG4gICAgICAgIF9pc1ZhbGlkIDoge1xyXG4gICAgICAgICAgICBpbml0IDogZmFsc2VcclxuICAgICAgICB9XHJcbiAgICB9LFxyXG4gICAgbWV0aG9kczoge1xyXG4gICAgICAgIGluaXRpYWxpemU6IGZ1bmN0aW9uKCkge1xyXG4gICAgICAgICAgICB2YXIgbGl2ZVN0cmVhbXMgPSB3aW5kb3cuTElWRV9TVFJFQU1TO1xyXG4gICAgICAgICAgICBpZiAoIWxpdmVTdHJlYW1zIHx8IGxpdmVTdHJlYW1zLmxlbmd0aCA8PSAwKSB7XHJcbiAgICAgICAgICAgICAgICBjb25zb2xlLndhcm4oXCJObyBsaXZlIHN0cmVhbXMgc2V0XCIpO1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICAvLyBpbml0aWFsaXplIHRoZSBzdHJlYW1zXHJcbiAgICAgICAgICAgIHZhciBzZWxmID0gdGhpcztcclxuICAgICAgICAgICAgdmFyIGkgPSAwO1xyXG4gICAgICAgICAgICB0aGlzLl8kY29tcC5maW5kKFwiLmxpdmVTdHJlYW1UaHVtYlwiKS5hZGRDbGFzcyhcImluYWN0aXZlXCIpLmVhY2goZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgICAgICAgICB2YXIgc3RyZWFtID0gbGl2ZVN0cmVhbXNbaV07XHJcbiAgICAgICAgICAgICAgICBpKys7XHJcbiAgICAgICAgICAgICAgICBpZiAoIXN0cmVhbSkge1xyXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBmYWxzZTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICQodGhpcykuYWRkQ2xhc3MoXCJ2YWxpZFwiKS5kYXRhKFwiaWRcIiwgc3RyZWFtLmlkKS5kYXRhKFwidXJsXCIsIHN0cmVhbS51cmwpO1xyXG5cclxuICAgICAgICAgICAgICAgIC8vIGF0IGxlYXN0IG9uZSB2YWxpZCB0aHVtYiAtIHNvIHRoZSB3aG9sZSBMaXZlU3RyZWFtIGlzIHZhbGlkXHJcbiAgICAgICAgICAgICAgICBzZWxmLl9pc1ZhbGlkID0gdHJ1ZTtcclxuICAgICAgICAgICAgfSkuZmlsdGVyKFwiLnZhbGlkXCIpLmNsaWNrKGZ1bmN0aW9uKCkge1xyXG4gICAgICAgICAgICAgICAgdmFyICR0aGlzID0gJCh0aGlzKTtcclxuXHJcbiAgICAgICAgICAgICAgICAvLyBpZiBjbGlja2VkIG9uIHRoZSBzYW1lIGFjdGl2ZSB0aHVtYiB0aGVuIHNraXAgaXRcclxuICAgICAgICAgICAgICAgIGlmICghJHRoaXMuaGFzQ2xhc3MoXCJpbmFjdGl2ZVwiKSkge1xyXG4gICAgICAgICAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgICAgIHNlbGYuX3Nob3dTdHJlYW0oJHRoaXMpO1xyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICB9LFxyXG5cclxuICAgICAgICBzaG93OiBmdW5jdGlvbihzdHJlYW1JZCwgY29tcGxldGVDYWxsYmFjaykge1xyXG4gICAgICAgICAgICBpZiAoIXRoaXMuX2lzVmFsaWQpXHJcbiAgICAgICAgICAgICAgIHJldHVybjtcclxuXHJcbiAgICAgICAgICAgIHZhciAkdGh1bWIgPSBudWxsO1xyXG4gICAgICAgICAgICB2YXIgJHRodW1icyA9IHRoaXMuXyRjb21wLmZpbmQoXCIubGl2ZVN0cmVhbVRodW1iLnZhbGlkXCIpO1xyXG4gICAgICAgICAgICBpZiAoIWlzRGVmaW5lZChzdHJlYW1JZCkpIHtcclxuICAgICAgICAgICAgICAgICR0aHVtYiA9ICR0aHVtYnMuZXEoMCk7XHJcbiAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAkdGh1bWJzLmVhY2goZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKHN0cmVhbUlkID09PSAkKHRoaXMpLmRhdGEoXCJpZFwiKSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAkdGh1bWIgPSAkKHRoaXMpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gZmFsc2U7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIGlmICghJHRodW1iKSB7XHJcbiAgICAgICAgICAgICAgICBjb25zb2xlLndhcm4oXCJObyBzdHJlYW0gZm9yIGlkIDogXCIgKyBzdHJlYW1JZCk7XHJcbiAgICAgICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIHRoaXMuX3Nob3dTdHJlYW0oJHRodW1iLCBjb21wbGV0ZUNhbGxiYWNrKTtcclxuICAgICAgICB9LFxyXG5cclxuICAgICAgICAvKipcclxuICAgICAgICAgKlxyXG4gICAgICAgICAqIEByZXR1cm4ge2Jvb2xlYW59XHJcbiAgICAgICAgICovXHJcbiAgICAgICAgdG9nZ2xlIDogZnVuY3Rpb24oY29tcGxldGVDYWxsYmFjaykge1xyXG4gICAgICAgICAgICBpZiAoIXRoaXMuX2lzVmFsaWQpXHJcbiAgICAgICAgICAgICAgICByZXR1cm47XHJcblxyXG4gICAgICAgICAgICAvLyBpZiBzaG93biBoaWRlIG90aGVyd2lzZSBzaG93XHJcbiAgICAgICAgICAgIGlmICh0aGlzLl9pc1Nob3duKVxyXG4gICAgICAgICAgICAgICAgdGhpcy5faGlkZShjb21wbGV0ZUNhbGxiYWNrKTtcclxuICAgICAgICAgICAgZWxzZVxyXG4gICAgICAgICAgICAgICAgdGhpcy5zaG93KGNvbXBsZXRlQ2FsbGJhY2spO1xyXG5cclxuICAgICAgICAgICAgcmV0dXJuIHRoaXMuX2lzU2hvd247XHJcbiAgICAgICAgfSxcclxuXHJcbiAgICAgICAgLyogUHJpdmF0ZSBNZXRob2RzICovXHJcblxyXG4gICAgICAgIF9oaWRlIDogZnVuY3Rpb24oY29tcGxldGVDYWxsYmFjaykge1xyXG4gICAgICAgICAgICB2YXIgc2VsZiA9IHRoaXM7XHJcbiAgICAgICAgICAgIHRoaXMuXyRjb21wLnNsaWRlVXAoNDAwLCBmdW5jdGlvbigpIHtcclxuICAgICAgICAgICAgICAgIC8vIHN0b3AgdGhlIHN0cmVhbSB3aGVuIHdob2xlIHBhbmVsIGhhcyBjb21wbGV0ZWQgYW5pbWF0aW9uXHJcbiAgICAgICAgICAgICAgICBzZWxmLl8kY29tcC5maW5kKFwiLmxpdmVTdHJlYW1QbGF5ZXJcIikuZW1wdHkoKTtcclxuICAgICAgICAgICAgICAgIGNvbXBsZXRlQ2FsbGJhY2soKTtcclxuICAgICAgICAgICAgfSk7XHJcblxyXG4gICAgICAgICAgICB0aGlzLl9pc1Nob3duID0gZmFsc2U7XHJcbiAgICAgICAgfSxcclxuXHJcbiAgICAgICAgX3Nob3dTdHJlYW0gOiBmdW5jdGlvbigkdGh1bWIsIGNvbXBsZXRlQ2FsbGJhY2spIHtcclxuICAgICAgICAgICAgLy8gdG9nZ2xlIHRoZSBcImluYWN0aXZlXCIgY2xhc3NcclxuICAgICAgICAgICAgdGhpcy5fJGNvbXAuZmluZChcIi5saXZlU3RyZWFtVGh1bWJcIikuYWRkQ2xhc3MoXCJpbmFjdGl2ZVwiKTtcclxuICAgICAgICAgICAgJHRodW1iLnJlbW92ZUNsYXNzKFwiaW5hY3RpdmVcIik7XHJcblxyXG4gICAgICAgICAgICAvLyBzaG93IHRoZSBuZXcgc3RyZWFtXHJcbiAgICAgICAgICAgIHZhciB1cmwgPSAkdGh1bWIuZGF0YShcInVybFwiKTtcclxuICAgICAgICAgICAgdmFyICRwbGF5ZXIgPSB0aGlzLl8kY29tcC5maW5kKFwiLmxpdmVTdHJlYW1QbGF5ZXJcIik7XHJcbiAgICAgICAgICAgICRwbGF5ZXIuaHRtbCgnPGlmcmFtZSBzcmM9JyArIHVybCArICc/d2lkdGg9NDkwJmhlaWdodD0yNzUmYXV0b1BsYXk9dHJ1ZSZtdXRlPWZhbHNlXCIgd2lkdGg9XCI0OTBcIiBoZWlnaHQ9XCIyNzVcIiBmcmFtZWJvcmRlcj1cIjBcIiBzY3JvbGxpbmc9XCJub1wiPiA8L2lmcmFtZT4nKTtcclxuXHJcbiAgICAgICAgICAgIC8vIHNob3cgaWYgbm90IGFscmVhZHkgc2hvd25cclxuICAgICAgICAgICAgaWYgKCF0aGlzLl9pc1Nob3duKVxyXG4gICAgICAgICAgICAgICAgdGhpcy5fJGNvbXAuc2xpZGVEb3duKDQwMCwgY29tcGxldGVDYWxsYmFjayk7XHJcbiAgICAgICAgICAgIHRoaXMuX2lzU2hvd24gPSB0cnVlO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxufSk7IiwicmVxdWlyZSgnam9vc2UnKTtcclxucmVxdWlyZSgnLi9QYXJ0aWNpcGFudCcpO1xyXG5cclxuQ2xhc3MoXCJNb3ZpbmdDYW1cIiwge1xyXG4gICAgaXNhIDogUGFydGljaXBhbnQsXHJcblxyXG4gICAgb3ZlcnJpZGUgOiB7XHJcbiAgICAgICAgaW5pdEZlYXR1cmUgOiBmdW5jdGlvbigpIHtcclxuICAgICAgICAgICAgdGhpcy5mZWF0dXJlLmNhbT10aGlzO1xyXG4gICAgICAgICAgICBHVUkuY2Ftc0xheWVyLmdldFNvdXJjZSgpLmFkZEZlYXR1cmUodGhpcy5mZWF0dXJlKTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbn0pOyIsInJlcXVpcmUoJ2pvb3NlJyk7XHJcbnJlcXVpcmUoJy4vUG9pbnQnKTtcclxuXHJcbnZhciBDT05GSUcgPSByZXF1aXJlKCcuL0NvbmZpZycpO1xyXG52YXIgVXRpbHMgPSByZXF1aXJlKCcuL1V0aWxzJyk7XHJcblxyXG5DbGFzcyhcIlBhcnRpY2lwYW50U3RhdGVcIixcclxue1xyXG5cdGhhcyA6IHtcdFx0XHJcblx0XHRzcGVlZCA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiAwXHJcblx0XHR9LFxyXG5cdFx0ZWxhcHNlZCA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiAwXHJcblx0XHR9LFxyXG5cdCAgICB0aW1lc3RhbXAgOiBcclxuXHRcdHtcclxuXHQgICAgICAgIGlzOiAgIFwicndcIixcclxuXHQgICAgICAgIGluaXQ6IFswLDBdXHQvL2xvbiBsYXQgd29ybGQgbWVyY2F0b3JcclxuXHQgICAgfSxcclxuXHQgICAgZ3BzIDoge1xyXG5cdCAgICBcdGlzOiAgIFwicndcIixcclxuXHQgICAgICAgIGluaXQ6IFswLDBdXHQvL2xvbiBsYXQgd29ybGQgbWVyY2F0b3JcclxuXHQgICAgfSxcclxuXHRcdGZyZXEgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogMFxyXG5cdFx0fSxcclxuXHRcdGlzU09TIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IGZhbHNlXHJcblx0XHR9LFxyXG5cdFx0YWNjZWxlcmF0aW9uIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IDBcclxuXHRcdH0sXHJcblx0XHRhbHQgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogMFxyXG5cdFx0fSxcclxuXHRcdG92ZXJhbGxSYW5rIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IDBcclxuXHRcdH0sXHJcblx0XHRnZW5kZXJSYW5rIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IDBcclxuXHRcdH0sXHJcblx0XHRncm91cFJhbmsgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogMFxyXG5cdFx0fVxyXG5cdH1cclxufSk7XHRcdFxyXG4vLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuQ2xhc3MoXCJNb3ZpbmdQb2ludFwiLCB7XHJcblx0aXNhIDogUG9pbnQsXHJcblxyXG5cdGhhcyA6IHtcclxuXHRcdGRldmljZUlkIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IFwiREVWSUNFX0lEX05PVF9TRVRcIlxyXG5cdFx0fVxyXG5cdH1cclxufSk7XHJcbi8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5DbGFzcyhcIlBhcnRpY2lwYW50XCIsXHJcbntcclxuXHRpc2EgOiBNb3ZpbmdQb2ludCxcclxuXHJcbiAgICBoYXM6IFxyXG5cdHtcclxuICAgIFx0bGFzdFBpbmdUaW1lc3RhbXAgOiB7XHJcbiAgICBcdFx0aXMgOiBcInJ3XCIsXHJcbiAgICBcdFx0aW5pdCA6IG51bGxcclxuICAgIFx0fSxcclxuICAgIFx0c2lnbmFsTG9zdERlbGF5IDoge1xyXG4gICAgXHRcdGlzIDogXCJyd1wiLFxyXG4gICAgXHRcdGluaXQgOiBudWxsXHJcbiAgICBcdH0sXHJcbiAgICBcdGxhc3RSZWFsRGVsYXkgOiB7XHJcbiAgICBcdFx0aXMgOiBcInJ3XCIsXHJcbiAgICBcdFx0aW5pdCA6IDBcclxuICAgIFx0fSxcclxuICAgIFx0dHJhY2sgOiB7XHJcbiAgICBcdFx0aXMgOiBcInJ3XCJcclxuICAgIFx0fSxcclxuICAgIFx0c3RhdGVzIDoge1xyXG4gICAgXHRcdGlzIDogXCJyd1wiLFxyXG4gICAgXHRcdGluaXQgOiBudWxsIC8vW11cclxuICAgIFx0XHRcclxuICAgIFx0fSxcclxuXHRcdGlzVGltZWRPdXQgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogZmFsc2VcclxuXHRcdH0sXHJcblx0XHRpc0Rpc2NhcmRlZCA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiBmYWxzZVxyXG5cdFx0fSxcclxuXHRcdGlzU09TIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IGZhbHNlXHJcblx0XHR9LFxyXG5cdFx0aWNvbjoge1xyXG5cdFx0XHRpczogXCJyd1wiLFxyXG5cdCAgICAgICAgaW5pdDogXCJpbWcvcGxheWVyMS5wbmdcIlxyXG5cdCAgICB9LFxyXG5cdCAgICBpbWFnZSA6XHR7XHJcblx0ICAgICAgICBpczogICBcInJ3XCIsXHJcblx0ICAgICAgICBpbml0OiBcImltZy9wcm9maWxlMS5wbmdcIiAgLy8xMDB4MTAwXHJcblx0ICAgIH0sXHJcblx0ICAgIGNvbG9yIDoge1xyXG5cdCAgICAgICAgaXM6ICAgXCJyd1wiLFxyXG5cdCAgICAgICAgaW5pdDogXCIjZmZmXCJcclxuXHQgICAgfSxcclxuXHQgICAgbGFzdEludGVycG9sYXRlVGltZXN0YW1wIDoge1xyXG5cdCAgICBcdGlzIDogXCJyd1wiLFxyXG5cdCAgICBcdGluaXQgOiBudWxsXHJcblx0ICAgIH0sXHJcblx0ICAgIGFnZUdyb3VwIDoge1xyXG5cdCAgICBcdGlzIDogXCJyd1wiLFxyXG5cdCAgICBcdGluaXQgOiBcIi1cIlxyXG5cdCAgICB9LFxyXG5cdCAgICBhZ2UgOiB7XHJcblx0ICAgIFx0aXMgOiBcInJ3XCIsXHJcblx0ICAgIFx0aW5pdCA6IFwiLVwiXHJcblx0ICAgIH0sXHJcblx0ICAgIHJvdGF0aW9uIDoge1xyXG5cdCAgICBcdGlzIDogXCJyd1wiLFxyXG5cdCAgICBcdGluaXQgOiBudWxsIFxyXG5cdCAgICB9LCBcclxuXHQgICAgZWxhcHNlZCA6IHtcclxuXHQgICAgXHRpcyA6IFwicndcIixcclxuXHQgICAgXHRpbml0IDogMFxyXG5cdCAgICB9LFxyXG5cdFx0c2VxSWQgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogMFxyXG5cdFx0fSxcclxuXHRcdGNvdW50cnkgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogXCJHZXJtYW55XCJcclxuXHRcdH0sXHJcblx0XHRzdGFydFBvcyA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiAwXHJcblx0XHR9LFxyXG5cdFx0c3RhcnRUaW1lIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IDBcclxuXHRcdH0sXHJcblx0XHRnZW5kZXIgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogXCJNXCJcclxuXHRcdH0sXHJcblx0XHRpc0Zhdm9yaXRlIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IHRydWUgLyogdG9kbyBzZXQgZmFsc2UgKi9cclxuXHRcdH1cclxuICAgIH0sXHJcblx0YWZ0ZXIgOiB7XHJcblx0XHRpbml0IDogZnVuY3Rpb24ocG9zLCB0cmFjaykge1xyXG5cdFx0XHR0aGlzLnNldFRyYWNrKHRyYWNrKTtcclxuXHRcdFx0dmFyIGN0aW1lID0gKG5ldyBEYXRlKCkpLmdldFRpbWUoKTtcclxuXHRcdFx0dmFyIHN0YXRlID0gbmV3IFBhcnRpY2lwYW50U3RhdGUoe3RpbWVzdGFtcDoxLyogcGxhY2Vob2xkZXIgY3RpbWUgbm90IDAgKi8sZ3BzOnBvcyxpc1NPUzpmYWxzZSxmcmVxOjAsc3BlZWQ6MCxlbGFwc2VkOnRyYWNrLmdldEVsYXBzZWRGcm9tUG9pbnQocG9zKX0pO1xyXG5cdFx0XHR0aGlzLnNldEVsYXBzZWQoc3RhdGUuZWxhcHNlZCk7XHJcblx0XHRcdHRoaXMuc2V0U3RhdGVzKFtzdGF0ZV0pO1xyXG5cdFx0XHR0aGlzLnNldElzU09TKGZhbHNlKTtcclxuXHRcdFx0dGhpcy5zZXRJc0Rpc2NhcmRlZChmYWxzZSk7XHJcblxyXG5cdFx0XHRpZiAodGhpcy5mZWF0dXJlKSB7XHJcblx0XHRcdFx0dGhpcy5pbml0RmVhdHVyZSgpO1xyXG5cdFx0XHR9XHJcblx0XHRcdHRoaXMucGluZyhwb3MsMCxmYWxzZSwxIC8qIHBsYWNlaG9sZGVyIGN0aW1lIG5vdCAwICovLDAsMCwwLDAsMCk7XHJcblx0XHR9XHJcblx0fSxcclxuICAgIC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRtZXRob2RzOiBcclxuXHR7XHJcblx0XHRpbml0RmVhdHVyZSA6IGZ1bmN0aW9uKCkge1xyXG5cdFx0XHR0aGlzLmZlYXR1cmUucGFydGljaXBhbnQ9dGhpcztcclxuXHRcdFx0R1VJLnBhcnRpY2lwYW50c0xheWVyLmdldFNvdXJjZSgpLmFkZEZlYXR1cmUodGhpcy5mZWF0dXJlKTtcclxuXHRcdH0sXHJcblxyXG5cdFx0Z2V0SW5pdGlhbHMgOiBmdW5jdGlvbigpIHtcclxuXHRcdFx0dmFyIHR0ID0gdGhpcy5nZXRDb2RlKCkuc3BsaXQoXCIgXCIpO1xyXG5cdFx0XHRpZiAodHQubGVuZ3RoID49IDIpIHtcclxuXHRcdFx0XHRyZXR1cm4gdHRbMF1bMF0rdHRbMV1bMF07XHJcblx0XHRcdH1cclxuXHRcdFx0aWYgKHR0Lmxlbmd0aCA9PSAxKVxyXG5cdFx0XHRcdHJldHVybiB0dFswXVswXTtcclxuXHRcdFx0cmV0dXJuIFwiP1wiO1xyXG5cdFx0fSxcclxuXHRcdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdFx0Ly8gbWFpbiBmdW5jdGlvbiBjYWxsID4gXHJcblx0XHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRcdHVwZGF0ZUZlYXR1cmUgOiBmdW5jdGlvbigpIHtcclxuXHRcdFx0dmFyIG1wb3MgPSBvbC5wcm9qLnRyYW5zZm9ybSh0aGlzLmdldFBvc2l0aW9uKCksICdFUFNHOjQzMjYnLCAnRVBTRzozODU3Jyk7XHJcblx0XHRcdGlmICh0aGlzLmZlYXR1cmUpIFxyXG5cdFx0XHRcdHRoaXMuZmVhdHVyZS5zZXRHZW9tZXRyeShuZXcgb2wuZ2VvbS5Qb2ludChtcG9zKSk7XHJcblx0XHR9LFxyXG5cdFx0aW50ZXJwb2xhdGUgOiBmdW5jdGlvbigpIFxyXG5cdFx0e1xyXG5cdFx0XHRcclxuXHRcdFx0Ly8gVEVTVFxyXG5cdFx0XHQvKmlmICghdGhpcy5fX3RpbWUpXHJcblx0XHRcdFx0dGhpcy5fX3RpbWUgPSAobmV3IERhdGUoKSkuZ2V0VGltZSgpO1xyXG5cdFx0XHRlbHNlIHtcclxuXHRcdFx0XHR2YXIgZHVyID0gKChuZXcgRGF0ZSgpKS5nZXRUaW1lKCktdGhpcy5fX3RpbWUpO1xyXG5cdFx0XHRcdHZhciB0dCA9IGR1ci8xMDAwMDAuMDtcclxuXHRcdFx0XHRpZiAodHQgPiAxKVxyXG5cdFx0XHRcdFx0dHQ9MTtcclxuXHRcdFx0XHR2YXIgdGthID0gdGhpcy50cmFjay5nZXRQb3NpdGlvbkFuZFJvdGF0aW9uRnJvbUVsYXBzZWQodHQpO1xyXG5cdFx0XHRcdHRoaXMuc2V0UG9zaXRpb24oW3RrYVswXSx0a2FbMV1dKTtcclxuXHRcdFx0XHR0aGlzLnNldFJvdGF0aW9uKHRrYVsyXSk7XHJcblx0XHRcdFx0dGhpcy51cGRhdGVGZWF0dXJlKCk7XHJcblx0XHRcdFx0dGhpcy5zZXRFbGFwc2VkKHJlcyk7XHJcblx0XHRcdH1cclxuXHRcdFx0cmV0dXJuOyovXHJcblx0XHRcdC8vIFRFU1RcclxuXHRcdFx0XHJcblx0XHRcdFxyXG5cdFx0XHRpZiAoIXRoaXMuc3RhdGVzLmxlbmd0aClcclxuXHRcdFx0XHRyZXR1cm47XHJcblx0XHRcdHZhciBjdGltZT0obmV3IERhdGUoKSkuZ2V0VGltZSgpO1xyXG5cdFx0XHR2YXIgaXNUaW1lID0gKGN0aW1lID49IENPTkZJRy50aW1lcy5iZWdpbiAmJiBjdGltZSA8PSBDT05GSUcudGltZXMuZW5kKTtcclxuXHRcdFx0aWYgKHRoaXMuaXNEaXNjYXJkZWQgfHwgdGhpcy5pc1NPUy8qIHx8ICF0aGlzLmlzT25Sb2FkKi8gfHwgIWlzVGltZSkgXHJcblx0XHRcdHtcclxuXHRcdFx0XHR2YXIgbHN0YXRlPXRoaXMuc3RhdGVzW3RoaXMuc3RhdGVzLmxlbmd0aC0xXTtcclxuXHRcdFx0XHR2YXIgcG9zID0gbHN0YXRlLmdwcztcclxuXHRcdFx0XHRpZiAocG9zWzBdICE9IHRoaXMuZ2V0UG9zaXRpb24oKVswXSB8fCBwb3NbMV0gIT0gdGhpcy5nZXRQb3NpdGlvbigpWzFdKSBcclxuXHRcdFx0XHR7XHJcblx0XHRcdFx0ICAgIHRoaXMuc2V0UG9zaXRpb24ocG9zKTtcclxuXHRcdFx0XHQgICAgdGhpcy5zZXRSb3RhdGlvbihudWxsKTtcclxuXHRcdFx0XHRcdHRoaXMudXBkYXRlRmVhdHVyZSgpO1xyXG5cdFx0XHRcdH0gZWxzZSB7XHJcblx0XHRcdFx0XHRpZiAodGhpcy5pc0Rpc2NhcmRlZCkge1xyXG5cdFx0XHRcdFx0XHR0aGlzLnVwZGF0ZUZlYXR1cmUoKTtcclxuXHRcdFx0XHRcdH1cclxuXHRcdFx0XHR9XHJcblx0XHRcdFx0cmV0dXJuO1xyXG5cdFx0XHR9XHJcblx0XHRcdHRoaXMuc2V0TGFzdEludGVycG9sYXRlVGltZXN0YW1wKGN0aW1lKTtcclxuXHRcdFx0Ly8gTm8gZW5vdWdoIGRhdGE/XHJcblx0XHRcdGlmICh0aGlzLnN0YXRlcy5sZW5ndGggPCAyKVxyXG5cdFx0XHRcdHJldHVybjtcclxuXHRcdFx0dmFyIHJlcyA9IHRoaXMuY2FsY3VsYXRlRWxhcHNlZEF2ZXJhZ2UoY3RpbWUpO1xyXG5cdFx0XHRpZiAocmVzKSBcclxuXHRcdFx0e1xyXG5cdFx0XHRcdHZhciB0cmVzPXJlcztcclxuXHRcdFx0XHRpZiAodHJlcyA9PSB0aGlzLnRyYWNrLmxhcHMpXHJcblx0XHRcdFx0XHR0cmVzPTEuMDtcclxuXHRcdFx0XHRlbHNlXHJcblx0XHRcdFx0XHR0cmVzPXRyZXMlMTtcclxuXHRcdFx0XHR2YXIgdGthID0gdGhpcy50cmFjay5nZXRQb3NpdGlvbkFuZFJvdGF0aW9uRnJvbUVsYXBzZWQodHJlcyk7XHJcblx0XHRcdFx0dGhpcy5zZXRQb3NpdGlvbihbdGthWzBdLHRrYVsxXV0pO1xyXG5cdFx0XHRcdHRoaXMuc2V0Um90YXRpb24odGthWzJdKTtcclxuXHRcdFx0XHR0aGlzLnVwZGF0ZUZlYXR1cmUoKTtcclxuXHRcdFx0XHR0aGlzLnNldEVsYXBzZWQocmVzKTtcclxuXHRcdFx0fSBcclxuXHRcdH0sXHJcblxyXG5cdFx0bWF4IDogZnVuY3Rpb24oY3RpbWUscHJvTmFtZSkgXHJcblx0XHR7XHJcblx0XHRcdHZhciByZXM9MDtcclxuXHRcdFx0Zm9yICh2YXIgaT10aGlzLnN0YXRlcy5sZW5ndGgtMjtpPj0wO2ktLSkgXHJcblx0XHRcdHtcclxuXHRcdFx0XHR2YXIgaiA9IGkrMTtcclxuXHRcdFx0XHR2YXIgc2EgPSB0aGlzLnN0YXRlc1tpXTtcclxuXHRcdFx0XHR2YXIgc2IgPSB0aGlzLnN0YXRlc1tqXTtcclxuXHRcdFx0XHRpZiAoY3RpbWUgPj0gc2EudGltZXN0YW1wICYmIGN0aW1lIDw9IHNiLnRpbWVzdGFtcCkgXHJcblx0XHRcdFx0eyBcclxuXHRcdFx0XHRcdHJlcyA9IHNhW3Byb05hbWVdO1xyXG5cdFx0XHRcdFx0YnJlYWs7XHJcblx0XHRcdFx0fVxyXG5cdFx0XHRcdGlmIChzYi50aW1lc3RhbXAgPCBjdGltZSlcclxuXHRcdFx0XHRcdGJyZWFrO1xyXG5cdFx0XHR9XHJcblx0XHRcdHJldHVybiByZXM7XHJcblx0XHR9LFxyXG5cclxuXHRcdGF2ZzIgOiBmdW5jdGlvbihjdGltZSxwcm9OYW1lKSBcclxuXHRcdHtcclxuXHRcdFx0dmFyIHJlcz1udWxsO1xyXG5cdFx0XHRmb3IgKHZhciBpPXRoaXMuc3RhdGVzLmxlbmd0aC0yO2k+PTA7aS0tKSBcclxuXHRcdFx0e1xyXG5cdFx0XHRcdHZhciBqID0gaSsxO1xyXG5cdFx0XHRcdHZhciBzYSA9IHRoaXMuc3RhdGVzW2ldO1xyXG5cdFx0XHRcdHZhciBzYiA9IHRoaXMuc3RhdGVzW2pdO1xyXG5cdFx0XHRcdGlmIChjdGltZSA+PSBzYS50aW1lc3RhbXAgJiYgY3RpbWUgPD0gc2IudGltZXN0YW1wKSBcclxuXHRcdFx0XHR7IFxyXG5cdFx0XHRcdFx0cmVzID0gW1xyXG5cdFx0XHRcdFx0ICAgICAgIFx0c2FbcHJvTmFtZV1bMF0rKGN0aW1lLXNhLnRpbWVzdGFtcCkgKiAoc2JbcHJvTmFtZV1bMF0tc2FbcHJvTmFtZV1bMF0pIC8gKHNiLnRpbWVzdGFtcC1zYS50aW1lc3RhbXApLFxyXG5cdFx0XHRcdFx0ICAgICAgIFx0c2FbcHJvTmFtZV1bMV0rKGN0aW1lLXNhLnRpbWVzdGFtcCkgKiAoc2JbcHJvTmFtZV1bMV0tc2FbcHJvTmFtZV1bMV0pIC8gKHNiLnRpbWVzdGFtcC1zYS50aW1lc3RhbXApXHJcblx0XHRcdFx0ICAgICAgICAgIF07IFxyXG5cdFx0XHRcdFx0YnJlYWs7XHJcblx0XHRcdFx0fVxyXG5cdFx0XHRcdGlmIChzYi50aW1lc3RhbXAgPCBjdGltZSlcclxuXHRcdFx0XHRcdGJyZWFrO1xyXG5cdFx0XHR9XHJcblx0XHRcdHJldHVybiByZXM7XHJcblx0XHR9LFxyXG5cclxuXHRcdGF2ZyA6IGZ1bmN0aW9uKGN0aW1lLHByb05hbWUpIFxyXG5cdFx0e1xyXG5cdFx0XHR2YXIgcmVzPW51bGw7XHJcblx0XHRcdC8vY29uc29sZS5sb2codGhpcy5zdGF0ZXMpO1xyXG5cdFx0XHRmb3IgKHZhciBpPXRoaXMuc3RhdGVzLmxlbmd0aC0yO2k+PTA7aS0tKSBcclxuXHRcdFx0e1xyXG5cdFx0XHRcdHZhciBqID0gaSsxO1xyXG5cdFx0XHRcdHZhciBzYSA9IHRoaXMuc3RhdGVzW2ldO1xyXG5cdFx0XHRcdHZhciBzYiA9IHRoaXMuc3RhdGVzW2pdO1xyXG5cdFx0XHRcdGlmIChjdGltZSA+PSBzYS50aW1lc3RhbXAgJiYgY3RpbWUgPD0gc2IudGltZXN0YW1wKSBcclxuXHRcdFx0XHR7IFxyXG5cdFx0XHRcdFx0cmVzID0gc2FbcHJvTmFtZV0rKGN0aW1lLXNhLnRpbWVzdGFtcCkgKiAoc2JbcHJvTmFtZV0tc2FbcHJvTmFtZV0pIC8gKHNiLnRpbWVzdGFtcC1zYS50aW1lc3RhbXApO1xyXG5cdFx0XHRcdFx0YnJlYWs7XHJcblx0XHRcdFx0fVxyXG5cdFx0XHRcdGlmIChzYi50aW1lc3RhbXAgPCBjdGltZSlcclxuXHRcdFx0XHRcdGJyZWFrO1xyXG5cdFx0XHR9XHJcblx0XHRcdHJldHVybiByZXM7XHJcblx0XHR9LFxyXG5cclxuXHRcdGNhbGN1bGF0ZUVsYXBzZWRBdmVyYWdlIDogZnVuY3Rpb24oY3RpbWUpIFxyXG5cdFx0e1xyXG5cdFx0XHR2YXIgcmVzPW51bGw7XHJcblx0XHRcdGN0aW1lLT1DT05GSUcubWF0aC5kaXNwbGF5RGVsYXkqMTAwMDtcclxuXHRcdFx0Ly9jb25zb2xlLmxvZyhcIlNFQVJDSElORyBGT1IgVElNRSBcIitVdGlscy5mb3JtYXREYXRlVGltZVNlYyhuZXcgRGF0ZShjdGltZSkpKTtcclxuXHRcdFx0dmFyIG9rID0gZmFsc2U7XHJcblx0XHRcdGZvciAodmFyIGk9dGhpcy5zdGF0ZXMubGVuZ3RoLTI7aT49MDtpLS0pIFxyXG5cdFx0XHR7XHJcblx0XHRcdFx0dmFyIGogPSBpKzE7XHJcblx0XHRcdFx0dmFyIHNhID0gdGhpcy5jYWxjQVZHU3RhdGUoaSk7XHJcblx0XHRcdFx0dmFyIHNiID0gdGhpcy5jYWxjQVZHU3RhdGUoaik7XHJcblx0XHRcdFx0aWYgKGN0aW1lID49IHNhLnRpbWVzdGFtcCAmJiBjdGltZSA8PSBzYi50aW1lc3RhbXApIFxyXG5cdFx0XHRcdHsgXHJcblx0XHRcdFx0XHRyZXMgPSBzYS5lbGFwc2VkKyhjdGltZS1zYS50aW1lc3RhbXApICogKHNiLmVsYXBzZWQtc2EuZWxhcHNlZCkgLyAoc2IudGltZXN0YW1wLXNhLnRpbWVzdGFtcCk7XHJcblx0XHRcdFx0XHQvL2NvbnNvbGUubG9nKFwiRk9VTkQgVElNRSBJTlQgW1wiK1V0aWxzLmZvcm1hdERhdGVUaW1lU2VjKG5ldyBEYXRlKHNhLnRpbWVzdGFtcCkpK1wiID4gXCIrVXRpbHMuZm9ybWF0RGF0ZVRpbWVTZWMobmV3IERhdGUoc2IudGltZXN0YW1wKSkrXCJdXCIpO1xyXG5cdFx0XHRcdFx0b2s9dHJ1ZTtcclxuXHRcdFx0XHRcdGJyZWFrO1xyXG5cdFx0XHRcdH1cclxuXHRcdFx0XHRpZiAoc2IudGltZXN0YW1wIDwgY3RpbWUpIHtcclxuXHRcdFx0XHRcdHRoaXMuc2V0U2lnbmFsTG9zdERlbGF5KGN0aW1lLXNiLnRpbWVzdGFtcCk7XHJcblx0XHRcdFx0XHQvL2NvbnNvbGUubG9nKFwiQlJFQUsgT04gXCIrZm9ybWF0VGltZVNlYyhuZXcgRGF0ZShjdGltZSkpK1wiIHwgXCIrKGN0aW1lLXNiLnRpbWVzdGFtcCkvMTAwMC4wKTtcclxuXHRcdFx0XHRcdHJldHVybiBudWxsO1xyXG5cdFx0XHRcdH1cclxuXHRcdFx0fVxyXG5cdFx0XHRpZiAoIW9rKSB7XHJcblx0XHRcdFx0aWYgKHRoaXMuc3RhdGVzLmxlbmd0aCA+PSAyKVxyXG5cdFx0XHRcdFx0Y29uc29sZS5sb2codGhpcy5jb2RlK1wiIHwgTk9UIEZPVU5EIFRJTUUgXCIrVXRpbHMuZm9ybWF0RGF0ZVRpbWVTZWMobmV3IERhdGUoY3RpbWUpKStcIiB8IHQtbGFzdD1cIisoY3RpbWUtdGhpcy5zdGF0ZXNbdGhpcy5zdGF0ZXMubGVuZ3RoLTFdLnRpbWVzdGFtcCkvMTAwMC4wK1wiIHwgdC1maXJzdD1cIisoY3RpbWUtdGhpcy5zdGF0ZXNbMF0udGltZXN0YW1wKS8xMDAwLjApO1xyXG5cdFx0XHR9IGVsc2VcclxuXHRcdFx0XHR0aGlzLnNldFNpZ25hbExvc3REZWxheShudWxsKTtcclxuXHRcdFx0cmV0dXJuIHJlcztcclxuXHRcdH0sXHJcblx0XHRcclxuXHRcdGNhbGNBVkdTdGF0ZSA6IGZ1bmN0aW9uKHBvcykge1xyXG5cdFx0XHRpZiAoIUNPTkZJRy5tYXRoLmludGVycG9sYXRlR1BTQXZlcmFnZSlcclxuXHRcdFx0XHRyZXR1cm4gdGhpcy5zdGF0ZXNbcG9zXTtcclxuXHRcdFx0dmFyIHNzdW1lPTA7XHJcblx0XHRcdHZhciBzc3VtdD0wO1xyXG5cdFx0XHR2YXIgY2M9MDtcclxuXHRcdFx0Zm9yICh2YXIgaT1wb3M7aT49MCAmJiAocG9zLWkpPENPTkZJRy5tYXRoLmludGVycG9sYXRlR1BTQXZlcmFnZTtpLS0pIHtcclxuXHRcdFx0XHRzc3VtZSs9dGhpcy5zdGF0ZXNbaV0uZWxhcHNlZDtcclxuXHRcdFx0XHRzc3VtdCs9dGhpcy5zdGF0ZXNbaV0udGltZXN0YW1wO1xyXG5cdFx0XHRcdGNjKys7XHJcblx0XHRcdH1cclxuXHRcdFx0c3N1bWUvPWNjO1xyXG5cdFx0XHRzc3VtdC89Y2M7XHJcblx0XHRcdHJldHVybiB7ZWxhcHNlZCA6IHNzdW1lLHRpbWVzdGFtcCA6IHNzdW10fTtcclxuXHRcdH0sXHJcblxyXG5cdFx0cGluZ0NhbGN1bGF0ZWQgOiBmdW5jdGlvbihvYmopIHtcclxuXHRcdFx0dmFyIHN0YXRlID0gbmV3IFBhcnRpY2lwYW50U3RhdGUob2JqKTtcclxuXHRcdFx0Ly9jb25zb2xlLndhcm4oc3RhdGUpO1xyXG5cdFx0XHR0aGlzLmFkZFN0YXRlKHN0YXRlKTtcclxuXHRcdH0sXHJcblx0XHRcclxuXHRcdHBpbmcgOiBmdW5jdGlvbihwb3MsZnJlcSxpc1NPUyxjdGltZSxhbHQsb3ZlcmFsbFJhbmssZ3JvdXBSYW5rLGdlbmRlclJhbmssX0VMQVBTRUQpXHJcblx0XHR7XHJcblx0XHRcdHZhciBsbHQgPSAobmV3IERhdGUoKSkuZ2V0VGltZSgpOyBcclxuXHRcdFx0aWYgKCFjdGltZSlcclxuXHRcdFx0XHRjdGltZT1sbHQ7XHJcblx0XHRcdHRoaXMuc2V0TGFzdFJlYWxEZWxheShsbHQtY3RpbWUpO1xyXG5cdFx0XHR0aGlzLnNldExhc3RQaW5nVGltZXN0YW1wKGxsdCk7XHRcdFx0XHJcblx0XHRcdHZhciBzdGF0ZSA9IG5ldyBQYXJ0aWNpcGFudFN0YXRlKHt0aW1lc3RhbXA6Y3RpbWUsZ3BzOnBvcyxpc1NPUzppc1NPUyxmcmVxOmZyZXEsYWx0OmFsdCxvdmVyYWxsUmFuazpvdmVyYWxsUmFuayxncm91cFJhbms6Z3JvdXBSYW5rLGdlbmRlclJhbms6Z2VuZGVyUmFua30pO1xyXG5cdFx0XHQvL2lzU09TPXRydWU7XHJcblx0XHRcdFxyXG5cdFx0XHRpZiAoaXNTT1MpIHtcclxuXHRcdFx0XHR0aGlzLnNldElzU09TKHRydWUpOyBcclxuXHRcdFx0XHR0aGlzLmFkZFN0YXRlKHN0YXRlKTtcclxuXHRcdFx0XHRyZXR1cm47XHJcblx0XHRcdH1cclxuXHRcdFx0Ly8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0XHRcdHZhciB0cmFja2xlbiA9IHRoaXMudHJhY2suZ2V0VHJhY2tMZW5ndGgoKTtcclxuXHRcdFx0dmFyIHRyYWNrbGVuMSA9IHRoaXMudHJhY2suZ2V0VHJhY2tMZW5ndGhJbldHUzg0KCk7XHJcblx0XHRcdHZhciBsbHN0YXRlID0gdGhpcy5zdGF0ZXMubGVuZ3RoID49IDIgPyB0aGlzLnN0YXRlc1t0aGlzLnN0YXRlcy5sZW5ndGgtMl0gOiBudWxsO1xyXG5cdFx0XHR2YXIgbHN0YXRlID0gdGhpcy5zdGF0ZXMubGVuZ3RoID8gdGhpcy5zdGF0ZXNbdGhpcy5zdGF0ZXMubGVuZ3RoLTFdIDogbnVsbDtcclxuXHRcdFx0aWYgKHBvc1swXSA9PSAwICYmIHBvc1sxXSA9PSAwKSB7XHJcblx0XHRcdFx0aWYgKCFsc3RhdGUpIHJldHVybjtcclxuXHRcdFx0XHRwb3M9bHN0YXRlLmdwcztcclxuXHRcdFx0fVxyXG5cdFx0XHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRcdFx0dmFyIGJlc3Q7XHJcblx0XHRcdHZhciBiZXN0bT1udWxsO1xyXG5cdFx0XHR2YXIgbGVscCA9IGxzdGF0ZSA/IGxzdGF0ZS5nZXRFbGFwc2VkKCkgOiAwO1x0Ly8gbGFzdCBlbGFwc2VkXHJcblx0XHRcdHZhciB0ZyA9IHRoaXMudHJhY2sucm91dGU7XHJcblx0XHRcdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdFx0XHQvLyBORVcgQUxHXHJcblx0XHRcdHZhciBjb2VmID0gdGhpcy50cmFjay5nZXRUcmFja0xlbmd0aEluV0dTODQoKS90aGlzLnRyYWNrLmdldFRyYWNrTGVuZ3RoKCk7XHJcblx0XHRcdHZhciBtaW5mID0gbnVsbDtcclxuXHRcdFx0dmFyIHJyID0gQ09ORklHLm1hdGguZ3BzSW5hY2N1cmFjeSpjb2VmO1xyXG5cdFx0XHR2YXIgcmVzdWx0ID0gdGhpcy50cmFjay5yVHJlZS5zZWFyY2goW3Bvc1swXS1yciwgcG9zWzFdLXJyLCBwb3NbMF0rcnIsIHBvc1sxXStycl0pO1xyXG5cdFx0XHRpZiAoIXJlc3VsdClcclxuXHRcdFx0XHRyZXN1bHQ9W107XHJcblx0XHRcdC8vY29uc29sZS5sb2coXCJGT1VORCBcIityZXN1bHQubGVuZ3RoK1wiIHwgXCIrdGhpcy50cmFjay5yb3V0ZS5sZW5ndGgrXCIgfCBcIitycik7XHJcblx0XHRcdC8vZm9yICh2YXIgaT0wO2k8dGhpcy50cmFjay5yb3V0ZS5sZW5ndGgtMTtpKyspIHtcclxuXHRcdFx0Zm9yICh2YXIgX2k9MDtfaTxyZXN1bHQubGVuZ3RoO19pKyspXHJcblx0XHRcdHtcclxuXHRcdFx0XHR2YXIgaSA9IHJlc3VsdFtfaV1bNF0uaW5kZXg7XHJcblx0XHRcdFx0dmFyIHJlcyA9IFV0aWxzLmludGVyY2VwdE9uQ2lyY2xlKHRnW2ldLHRnW2krMV0scG9zLHJyKTtcclxuXHRcdFx0XHRpZiAocmVzKSBcclxuXHRcdFx0XHR7XHJcblx0XHRcdFx0XHQvLyBoYXMgaW50ZXJzZWN0aW9uICgyIHBvaW50cylcclxuXHRcdFx0XHRcdHZhciBkMSA9IFV0aWxzLmRpc3RwKHJlc1swXSx0Z1tpXSk7XHJcblx0XHRcdFx0XHR2YXIgZDIgPSBVdGlscy5kaXN0cChyZXNbMV0sdGdbaV0pO1xyXG5cdFx0XHRcdFx0dmFyIGQzID0gVXRpbHMuZGlzdHAodGdbaV0sdGdbaSsxXSk7XHJcblx0XHRcdFx0XHR2YXIgZWwxID0gdGhpcy50cmFjay5kaXN0YW5jZXNFbGFwc2VkW2ldKyh0aGlzLnRyYWNrLmRpc3RhbmNlc0VsYXBzZWRbaSsxXS10aGlzLnRyYWNrLmRpc3RhbmNlc0VsYXBzZWRbaV0pKmQxL2QzO1xyXG5cdFx0XHRcdFx0dmFyIGVsMiA9IHRoaXMudHJhY2suZGlzdGFuY2VzRWxhcHNlZFtpXSsodGhpcy50cmFjay5kaXN0YW5jZXNFbGFwc2VkW2krMV0tdGhpcy50cmFjay5kaXN0YW5jZXNFbGFwc2VkW2ldKSpkMi9kMztcclxuXHRcdFx0XHRcdC8vY29uc29sZS5sb2coXCJJbnRlcnNlY3Rpb24gY2FuZGlkYXRlIGF0IFwiK2krXCIgfCBcIitlbDErXCIgfCBcIitlbDIpO1xyXG5cdFx0XHRcdFx0aWYgKGVsMSA8IGxlbHApXHJcblx0XHRcdFx0XHRcdGVsMT1sZWxwO1xyXG5cdFx0XHRcdFx0aWYgKGVsMiA8IGxlbHApXHJcblx0XHRcdFx0XHRcdGVsMj1sZWxwO1xyXG5cdFx0XHRcdFx0Ly8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0XHRcdFx0XHRpZiAobWluZiA9PSBudWxsIHx8IGVsMSA8IG1pbmYpXHJcblx0XHRcdFx0XHRcdG1pbmY9ZWwxO1xyXG5cdFx0XHRcdFx0aWYgKGVsMiA8IG1pbmYpXHJcblx0XHRcdFx0XHRcdG1pbmY9ZWwyO1xyXG5cdFx0XHRcdH1cclxuXHRcdFx0fVxyXG5cdFx0XHRcclxuXHRcdFx0LyppZiAobWluZiA9PSBudWxsKVxyXG5cdFx0XHRcdGNvbnNvbGUuZXJyb3IoXCJNSU5GIE5VTEwgKFwiK3Jlc3VsdC5sZW5ndGgrXCIpIENPRUY9XCIrY29lZik7XHJcblx0XHRcdGVsc2VcclxuXHRcdFx0XHRjb25zb2xlLmxvZyhcIj4+IE1JTkYgXCIrbWluZitcIiAoXCIrbWluZip0aGlzLnRyYWNrLmdldFRyYWNrTGVuZ3RoKCkrXCIgbSkgQ09FRj1cIitjb2VmKTsqL1xyXG5cdFx0XHRcclxuXHRcdFx0Ly8gPz8gT0sgU0tJUCBESVNDQVJEISEhXHJcblx0XHRcdGlmIChtaW5mID09IG51bGwpIFxyXG5cdFx0XHRcdHJldHVybjtcclxuXHRcdFx0XHJcblx0XHRcdC8vIG1pbmYgPSBvdmVyYWxsIG1pbmltdW0gb2YgZWxhcHNlZCBpbnRlcnNlY3Rpb25zXHJcblx0XHRcdGlmIChtaW5mICE9IG51bGwpIFxyXG5cdFx0XHRcdGJlc3RtPW1pbmY7XHJcblx0XHRcdFxyXG5cdFx0XHQvL2NvbnNvbGUubG9nKFwiQkVTVE0gRk9SIFBJTkcgOiBcIitiZXN0bSk7XHJcblx0XHRcdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRcdFx0Ly9iZXN0bSA9IF9FTEFQU0VEOyAvLyhURVNUIEhBQ0sgT05MWSlcclxuXHRcdFx0aWYgKGJlc3RtICE9IG51bGwpIFxyXG5cdFx0XHR7XHJcblx0XHRcdFx0dmFyIG5lbCA9IGJlc3RtOyAvL3RoaXMudHJhY2suZ2V0RWxhcHNlZEZyb21Qb2ludChiZXN0KTtcclxuXHRcdFx0XHRpZiAobHN0YXRlKSBcclxuXHRcdFx0XHR7XHJcblx0XHRcdFx0XHQvKmlmIChuZWwgPCBsc3RhdGUuZ2V0RWxhcHNlZCgpKSBcclxuXHRcdFx0XHRcdHtcclxuXHRcdFx0XHRcdFx0Ly8gV1JPTkcgRElSRUNUSU9OIE9SIEdQUyBEQVRBIFdST05HPyBTS0lQLi5cclxuXHRcdFx0XHRcdFx0aWYgKChsc3RhdGUuZ2V0RWxhcHNlZCgpLW5lbCkqdHJhY2tsZW4gPCBDT05GSUcuY29uc3RyYWludHMuYmFja3dhcmRzRXBzaWxvbkluTWV0ZXIpIFxyXG5cdFx0XHRcdFx0XHRcdHJldHVybjtcclxuXHRcdFx0XHRcdFx0ZG8gIFxyXG5cdFx0XHRcdFx0XHR7XHJcblx0XHRcdFx0XHRcdFx0bmVsKz0xLjA7XHJcblx0XHRcdFx0XHRcdH0gd2hpbGUgKG5lbCA8IGxzdGF0ZS5nZXRFbGFwc2VkKCkpO1xyXG5cdFx0XHRcdFx0fSovXHJcblx0XHRcdFx0XHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0XHRcdFx0XHRpZiAobmVsID4gdGhpcy50cmFjay5sYXBzKSB7XHJcblx0XHRcdFx0XHRcdG5lbD10aGlzLnRyYWNrLmxhcHM7XHJcblx0XHRcdFx0XHR9XHJcblx0XHRcdFx0XHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0XHRcdFx0XHRsbHN0YXRlID0gdGhpcy5zdGF0ZXMubGVuZ3RoID49IENPTkZJRy5tYXRoLnNwZWVkQW5kQWNjZWxlcmF0aW9uQXZlcmFnZURlZ3JlZSoyID8gdGhpcy5zdGF0ZXNbdGhpcy5zdGF0ZXMubGVuZ3RoLUNPTkZJRy5tYXRoLnNwZWVkQW5kQWNjZWxlcmF0aW9uQXZlcmFnZURlZ3JlZSoyXSA6IG51bGw7XHJcblx0XHRcdFx0XHRsc3RhdGUgPSB0aGlzLnN0YXRlcy5sZW5ndGggPj0gQ09ORklHLm1hdGguc3BlZWRBbmRBY2NlbGVyYXRpb25BdmVyYWdlRGVncmVlID8gdGhpcy5zdGF0ZXNbdGhpcy5zdGF0ZXMubGVuZ3RoLUNPTkZJRy5tYXRoLnNwZWVkQW5kQWNjZWxlcmF0aW9uQXZlcmFnZURlZ3JlZV0gOiBudWxsO1xyXG5cdFx0XHRcdFx0aWYgKGxzdGF0ZSkgIHtcclxuXHRcdFx0XHRcdFx0c3RhdGUuc2V0U3BlZWQoIHRyYWNrbGVuICogKG5lbC1sc3RhdGUuZ2V0RWxhcHNlZCgpKSAqIDEwMDAgLyAoY3RpbWUtbHN0YXRlLnRpbWVzdGFtcCkpO1xyXG5cdFx0XHRcdFx0XHRpZiAobGxzdGF0ZSkgXHJcblx0XHRcdFx0XHRcdFx0c3RhdGUuc2V0QWNjZWxlcmF0aW9uKCAoc3RhdGUuZ2V0U3BlZWQoKS1sc3RhdGUuZ2V0U3BlZWQoKSkgKiAxMDAwIC8gKGN0aW1lLWxzdGF0ZS50aW1lc3RhbXApKTtcclxuXHRcdFx0XHRcdH1cclxuXHRcdFx0XHRcdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRcdFx0XHR9XHJcblx0XHRcdFx0c3RhdGUuc2V0RWxhcHNlZChuZWwpO1xyXG5cdFx0XHR9IGVsc2Uge1xyXG5cdFx0XHRcdGlmIChsc3RhdGUpXHJcblx0XHRcdFx0XHRzdGF0ZS5zZXRFbGFwc2VkKGxzdGF0ZS5nZXRFbGFwc2VkKCkpO1xyXG5cdFx0XHRcdGlmIChsc3RhdGUuZ2V0RWxhcHNlZCgpICE9IHRoaXMudHJhY2subGFwcykge1xyXG5cdFx0XHRcdFx0dGhpcy5zZXRJc0Rpc2NhcmRlZCh0cnVlKTtcclxuXHRcdFx0XHR9XHJcblx0XHRcdH1cclxuXHRcdFx0Ly8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdFx0XHR0aGlzLmFkZFN0YXRlKHN0YXRlKTtcclxuXHRcdFx0aWYgKHR5cGVvZiBHVUkgIT0gXCJ1bmRlZmluZWRcIiAmJiBHVUkuaXNEZWJ1ZyAmJiAhdGhpcy5nZXRJc0Rpc2NhcmRlZCgpKSBcclxuXHRcdFx0e1xyXG5cdFx0XHRcdHZhciBmZWF0dXJlID0gbmV3IG9sLkZlYXR1cmUoKTtcclxuXHRcdFx0XHR2YXIgZ2VvbSA9IG5ldyBvbC5nZW9tLlBvaW50KHN0YXRlLmdwcyk7XHJcblx0XHRcdFx0Z2VvbS50cmFuc2Zvcm0oJ0VQU0c6NDMyNicsICdFUFNHOjM4NTcnKTtcclxuXHRcdFx0XHRmZWF0dXJlLmNvbG9yPXRoaXMuY29sb3I7XHJcblx0XHRcdFx0ZmVhdHVyZS5zZXRHZW9tZXRyeShnZW9tKTtcclxuXHRcdFx0XHRmZWF0dXJlLnRpbWVDcmVhdGVkPWN0aW1lO1xyXG5cdFx0XHRcdEdVSS5kZWJ1Z0xheWVyR1BTLmdldFNvdXJjZSgpLmFkZEZlYXR1cmUoZmVhdHVyZSk7XHJcblx0XHRcdH1cclxuXHRcdH0sXHJcblx0XHRcclxuXHRcdGFkZFN0YXRlIDogZnVuY3Rpb24oc3RhdGUpIHtcclxuXHRcdFx0dGhpcy5zdGF0ZXMucHVzaChzdGF0ZSk7XHJcblx0XHRcdGlmICh0aGlzLnN0YXRlcy5sZW5ndGggPiBDT05GSUcuY29uc3RyYWludHMubWF4UGFydGljaXBhbnRTdGF0ZUhpc3RvcnkgJiYgIXRoaXMuaXNTT1MpXHJcblx0XHRcdFx0dGhpcy5zdGF0ZXMuc2hpZnQoKTtcclxuXHRcdH0sXHJcblxyXG5cdFx0Z2V0TGFzdFN0YXRlOiBmdW5jdGlvbigpIHtcclxuXHRcdFx0cmV0dXJuIHRoaXMuc3RhdGVzLmxlbmd0aCA/IHRoaXMuc3RhdGVzW3RoaXMuc3RhdGVzLmxlbmd0aC0xXSA6IG51bGw7XHJcblx0XHR9LFxyXG5cclxuXHRcdGdldEZyZXEgOiBmdW5jdGlvbigpIHtcclxuXHRcdFx0dmFyIGxzdGF0ZSA9IHRoaXMuZ2V0TGFzdFN0YXRlKCk7XHJcblx0XHRcdHJldHVybiBsc3RhdGUgPyBsc3RhdGUuZnJlcSA6IDA7XHJcblx0XHR9LFxyXG5cclxuXHRcdGdldFNwZWVkIDogZnVuY3Rpb24oKSB7XHJcblx0XHRcdHZhciBsc3RhdGUgPSB0aGlzLmdldExhc3RTdGF0ZSgpO1xyXG5cdFx0XHRyZXR1cm4gbHN0YXRlID8gbHN0YXRlLnNwZWVkIDogMDtcclxuXHRcdH0sXHJcblxyXG5cdFx0Z2V0R1BTIDogZnVuY3Rpb24oKSB7XHJcblx0XHRcdHZhciBsc3RhdGUgPSB0aGlzLmdldExhc3RTdGF0ZSgpO1xyXG5cdFx0XHRyZXR1cm4gbHN0YXRlID8gbHN0YXRlLmdwcyA6IHRoaXMuZ2V0UG9zaXRpb24oKTtcclxuXHRcdH0sXHJcblxyXG5cdFx0Z2V0RWxhcHNlZCA6IGZ1bmN0aW9uKCkge1xyXG5cdFx0XHR2YXIgbHN0YXRlID0gdGhpcy5nZXRMYXN0U3RhdGUoKTtcclxuXHRcdFx0cmV0dXJuIGxzdGF0ZSA/IGxzdGF0ZS5lbGFwc2VkIDogMDtcclxuXHRcdH0sXHJcblxyXG5cdFx0Z2V0UG9wdXBIVE1MIDogZnVuY3Rpb24oKSB7XHJcblx0XHRcdHZhciBwb3MgPSB0aGlzLmdldFBvc2l0aW9uKCk7XHJcblx0XHRcdGlmICh0aGlzLmlzU09TIHx8IHRoaXMuaXNEaXNjYXJkZWQpIHtcclxuXHRcdFx0XHRwb3MgPSB0aGlzLmdldEdQUygpO1xyXG5cdFx0XHR9XHJcblx0XHRcdHZhciB0bGVuID0gdGhpcy50cmFjay5nZXRUcmFja0xlbmd0aCgpO1xyXG5cdFx0XHR2YXIgY3RpbWUgPSAobmV3IERhdGUoKSkuZ2V0VGltZSgpO1xyXG5cdFx0XHR2YXIgZWxhcHNlZCA9IHRoaXMuY2FsY3VsYXRlRWxhcHNlZEF2ZXJhZ2UoY3RpbWUpO1xyXG5cdFx0XHR2YXIgdHBhcnQgPSB0aGlzLnRyYWNrLmdldFRyYWNrUGFydChlbGFwc2VkKTtcclxuXHRcdFx0dmFyIHRhcmdldEtNO1xyXG5cdFx0XHR2YXIgcGFydFN0YXJ0O1xyXG5cdFx0XHR2YXIgdHBhcnRNb3JlO1xyXG5cdFx0XHRpZiAodHBhcnQgPT0gMCkge1xyXG5cdFx0XHRcdHRwYXJ0cz1cIlNXSU1cIjtcclxuXHRcdFx0XHR0YXJnZXRLTT10aGlzLnRyYWNrLmJpa2VTdGFydEtNO1xyXG5cdFx0XHRcdHBhcnRTdGFydD0wO1xyXG5cdFx0XHRcdHRwYXJ0TW9yZT1cIlNXSU1cIjtcclxuXHRcdFx0fSBlbHNlIGlmICh0cGFydCA9PSAxKSB7XHJcblx0XHRcdFx0dHBhcnRzPVwiQklLRVwiO1xyXG5cdFx0XHRcdHRhcmdldEtNPXRoaXMudHJhY2sucnVuU3RhcnRLTTtcclxuXHRcdFx0XHRwYXJ0U3RhcnQ9dGhpcy50cmFjay5iaWtlU3RhcnRLTTtcclxuXHRcdFx0XHR0cGFydE1vcmU9XCJSSURFXCI7XHJcblx0XHRcdH0gZWxzZSBpZiAodHBhcnQgPT0gMikgeyBcclxuXHRcdFx0XHR0cGFydHM9XCJSVU5cIjtcclxuXHRcdFx0XHR0YXJnZXRLTT10bGVuLzEwMDAuMDtcclxuXHRcdFx0XHRwYXJ0U3RhcnQ9dGhpcy50cmFjay5ydW5TdGFydEtNO1xyXG5cdFx0XHRcdHRwYXJ0TW9yZT1cIlJVTlwiO1xyXG5cdFx0XHR9XHJcblx0XHRcdHZhciBodG1sPVwiPGRpdiBjbGFzcz0ncG9wdXBfY29kZScgc3R5bGU9J2NvbG9yOnJnYmEoXCIrY29sb3JBbHBoYUFycmF5KHRoaXMuZ2V0Q29sb3IoKSwwLjkpLmpvaW4oXCIsXCIpK1wiKSc+XCIrZXNjYXBlSFRNTCh0aGlzLmdldENvZGUoKSkrXCIgKDEpPC9kaXY+XCI7XHJcblx0XHRcdHZhciBmcmVxID0gTWF0aC5yb3VuZCh0aGlzLmdldEZyZXEoKSk7XHJcblx0XHRcdGlmIChmcmVxID4gMCkge1xyXG5cdFx0XHRcdGh0bWwrPVwiPGRpdiBjbGFzc1wiICtcclxuXHRcdFx0XHRcdFx0XCI9J3BvcHVwX2ZyZXEnPlwiK2ZyZXErXCI8L2Rpdj5cIjtcclxuXHRcdFx0fVxyXG5cdFx0XHR2YXIgZWxrbSA9IGVsYXBzZWQqdGxlbi8xMDAwLjA7XHJcblx0XHRcdHZhciBlbGttcyA9IHBhcnNlRmxvYXQoTWF0aC5yb3VuZChlbGttICogMTAwKSAvIDEwMCkudG9GaXhlZCgyKTtcdFx0XHRcclxuXHJcblx0XHRcdC8qdmFyIHJla20gPSBlbGFwc2VkJTEuMDtcclxuXHRcdFx0cmVrbT0oMS4wLXJla20pKnRsZW4vMTAwMC4wO1xyXG5cdFx0XHRyZWttID0gcGFyc2VGbG9hdChNYXRoLnJvdW5kKHJla20gKiAxMDApIC8gMTAwKS50b0ZpeGVkKDIpOyovXHRcdFx0XHJcblx0XHRcdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRcdFx0dmFyIGVzdGY9bnVsbDtcclxuXHRcdFx0dmFyIGV0eHQxPW51bGw7XHJcblx0XHRcdHZhciBldHh0Mj1udWxsO1xyXG5cdFx0XHR2YXIgbHN0YXRlID0gbnVsbDsgXHJcblx0XHRcdGlmICh0aGlzLnN0YXRlcy5sZW5ndGgpIFxyXG5cdFx0XHR7XHJcblx0XHRcdFx0bHN0YXRlID0gdGhpcy5zdGF0ZXNbdGhpcy5zdGF0ZXMubGVuZ3RoLTFdO1xyXG5cdFx0XHRcdGlmIChsc3RhdGUuZ2V0U3BlZWQoKSA+IDApIFxyXG5cdFx0XHRcdHtcclxuXHRcdFx0XHRcdHZhciBzcG1zID0gTWF0aC5jZWlsKGxzdGF0ZS5nZXRTcGVlZCgpICogMTAwKSAvIDEwMDtcclxuXHRcdFx0XHRcdHNwbXMvPTEwMDAuMDtcclxuXHRcdFx0XHRcdHNwbXMqPTYwKjYwO1xyXG5cdFx0XHRcdFx0ZXR4dDE9cGFyc2VGbG9hdChzcG1zKS50b0ZpeGVkKDIpK1wiIGttL2hcIjtcclxuXHRcdFx0XHRcdHZhciByb3QgPSAtdGhpcy5nZXRSb3RhdGlvbigpKjE4MC9NYXRoLlBJOyBcclxuXHRcdFx0XHRcdGlmIChyb3QgPCAwKVxyXG5cdFx0XHRcdFx0XHRyb3QrPTM2MDtcclxuXHRcdFx0XHRcdGlmIChyb3QgIT0gbnVsbCkgXHJcblx0XHRcdFx0XHR7XHJcblx0XHRcdFx0XHRcdGlmIChyb3QgPD0gMCkgXHJcblx0XHRcdFx0XHRcdFx0ZXR4dDErPVwiIEVcIjtcclxuXHRcdFx0XHRcdFx0ZWxzZSBpZiAocm90IDw9IDQ1KVxyXG5cdFx0XHRcdFx0XHRcdGV0eHQxKz1cIiBTRVwiO1xyXG5cdFx0XHRcdFx0XHRlbHNlIGlmIChyb3QgPD0gOTApXHJcblx0XHRcdFx0XHRcdFx0ZXR4dDErPVwiIFNcIjtcclxuXHRcdFx0XHRcdFx0ZWxzZSBpZiAocm90IDw9IDEzNSlcclxuXHRcdFx0XHRcdFx0XHRldHh0MSs9XCIgU1dcIjtcclxuXHRcdFx0XHRcdFx0ZWxzZSBpZiAocm90IDw9IDE4MClcclxuXHRcdFx0XHRcdFx0XHRldHh0MSs9XCIgV1wiO1xyXG5cdFx0XHRcdFx0XHRlbHNlIGlmIChyb3QgPD0gMjI1KVxyXG5cdFx0XHRcdFx0XHRcdGV0eHQxKz1cIiBOV1wiO1xyXG5cdFx0XHRcdFx0XHRlbHNlIGlmIChyb3QgPD0gMjcwKVxyXG5cdFx0XHRcdFx0XHRcdGV0eHQxKz1cIiBOXCI7XHJcblx0XHRcdFx0XHRcdGVsc2UgXHJcblx0XHRcdFx0XHRcdFx0ZXR4dDErPVwiIE5FXCI7XHJcblx0XHRcdFx0XHR9XHJcblx0XHRcdFx0XHRlc3RmPVV0aWxzLmZvcm1hdFRpbWUobmV3IERhdGUoIGN0aW1lICsgdGFyZ2V0S00qMTAwMCAvIHNwbXMqMTAwMCApKTsgIFxyXG5cdFx0XHRcdH1cclxuXHRcdFx0XHRpZiAobHN0YXRlLmdldEFjY2VsZXJhdGlvbigpID4gMClcclxuXHRcdFx0XHRcdGV0eHQyPXBhcnNlRmxvYXQoTWF0aC5jZWlsKGxzdGF0ZS5nZXRBY2NlbGVyYXRpb24oKSAqIDEwMCkgLyAxMDApLnRvRml4ZWQoMikrXCIgbS9zMlwiO1xyXG5cdFx0XHR9XHJcblx0XHRcdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdFx0XHR2YXIgcDEgPSAxMDAqdGhpcy50cmFjay5iaWtlU3RhcnRLTS8odGxlbi8xMDAwLjApO1xyXG5cdFx0XHR2YXIgcDIgPSAxMDAqKHRoaXMudHJhY2sucnVuU3RhcnRLTS10aGlzLnRyYWNrLmJpa2VTdGFydEtNKS8odGxlbi8xMDAwLjApO1xyXG5cdFx0XHR2YXIgcDMgPSAxMDAqKHRsZW4vMTAwMC4wIC0gdGhpcy50cmFjay5ydW5TdGFydEtNKS8odGxlbi8xMDAwLjApO1xyXG5cdFx0XHR2YXIgcHJldHR5Q29vcmQ9XHJcblx0XHRcdFx0XCI8ZGl2IHN0eWxlPSdvcGFjaXR5OjAuNztmbG9hdDpsZWZ0O292ZXJmbG93OmhpZGRlbjtoZWlnaHQ6N3B4O3dpZHRoOlwiK3AxK1wiJTtiYWNrZ3JvdW5kLWNvbG9yOlwiK0NPTkZJRy5hcHBlYXJhbmNlLnRyYWNrQ29sb3JTd2ltK1wiJy8+XCIrXHJcblx0XHRcdFx0XCI8ZGl2IHN0eWxlPSdvcGFjaXR5OjAuNztmbG9hdDpsZWZ0O292ZXJmbG93OmhpZGRlbjtoZWlnaHQ6N3B4O3dpZHRoOlwiK3AyK1wiJTtiYWNrZ3JvdW5kLWNvbG9yOlwiK0NPTkZJRy5hcHBlYXJhbmNlLnRyYWNrQ29sb3JCaWtlK1wiJy8+XCIrXHJcblx0XHRcdFx0XCI8ZGl2IHN0eWxlPSdvcGFjaXR5OjAuNztmbG9hdDpsZWZ0O292ZXJmbG93OmhpZGRlbjtoZWlnaHQ6N3B4O3dpZHRoOlwiK3AzK1wiJTtiYWNrZ3JvdW5kLWNvbG9yOlwiK0NPTkZJRy5hcHBlYXJhbmNlLnRyYWNrQ29sb3JSdW4rXCInLz5cIlxyXG5cdFx0XHRcdDsgLy9vbC5jb29yZGluYXRlLnRvU3RyaW5nSERNUyh0aGlzLmdldFBvc2l0aW9uKCksIDIpO1xyXG5cclxuXHRcdFx0dmFyIGltZ2RpdjtcclxuXHRcdFx0aWYgKHRwYXJ0ID09IDApXHJcblx0XHRcdFx0aW1nZGl2PVwiPGltZyBjbGFzcz0ncG9wdXBfdHJhY2tfbW9kZScgc3R5bGU9J2xlZnQ6XCIrZWxhcHNlZCoxMDArXCIlJyBzcmM9J2ltZy9zd2ltLnN2ZycvPlwiXHJcblx0XHRcdGVsc2UgaWYgKHRwYXJ0ID09IDEpXHJcblx0XHRcdFx0aW1nZGl2PVwiPGltZyBjbGFzcz0ncG9wdXBfdHJhY2tfbW9kZScgc3R5bGU9J2xlZnQ6XCIrZWxhcHNlZCoxMDArXCIlJyBzcmM9J2ltZy9iaWtlLnN2ZycvPlwiXHJcblx0XHRcdGVsc2UgLyppZiAodHBhcnQgPT0gMikqL1xyXG5cdFx0XHRcdGltZ2Rpdj1cIjxpbWcgY2xhc3M9J3BvcHVwX3RyYWNrX21vZGUnIHN0eWxlPSdsZWZ0OlwiK2VsYXBzZWQqMTAwK1wiJScgc3JjPSdpbWcvcnVuLnN2ZycvPlwiXHJcblx0XHJcblxyXG5cdFx0XHR2YXIgcGFzcyA9IE1hdGgucm91bmQoKG5ldyBEYXRlKCkpLmdldFRpbWUoKS8zNTAwKSAlIDM7XHJcblx0XHRcdGh0bWwrPVwiPHRhYmxlIGNsYXNzPSdwb3B1cF90YWJsZScgc3R5bGU9J2JhY2tncm91bmQtaW1hZ2U6dXJsKFxcXCJcIit0aGlzLmdldEltYWdlKCkrXCJcXFwiKSc+XCI7XHJcblx0XHRcdHZhciBpc0R1bW15PSEoZWxhcHNlZCA+IDApO1xyXG5cdFx0XHRodG1sKz1cIjx0cj48dGQgY2xhc3M9J2xibCc+RWxhcHNlZDwvdGQ+PHRkIGNsYXNzPSd2YWx1ZSc+XCIrKGlzRHVtbXkgPyBcIi1cIiA6IGVsa21zK1wiIGttXCIpK1wiPC90ZD48L3RyPlwiO1xyXG5cdFx0XHRodG1sKz1cIjx0cj48dGQgY2xhc3M9J2xibCc+TW9yZSB0byBcIit0cGFydE1vcmUrXCI8L3RkPjx0ZCBjbGFzcz0ndmFsdWUnPlwiKyhpc0R1bW15ID8gXCItXCIgOiBwYXJzZUZsb2F0KE1hdGgucm91bmQoKHRhcmdldEtNLWVsa20pICogMTAwKSAvIDEwMCkudG9GaXhlZCgyKSAvKiByZWttICovICtcIiBrbVwiKStcIjwvdGQ+PC90cj5cIjtcclxuXHRcdFx0aHRtbCs9XCI8dHI+PHRkIGNsYXNzPSdsYmwnPkZpbmlzaCBcIisgdHBhcnRzLnRvTG93ZXJDYXNlKCkgK1wiPC90ZD48dGQgY2xhc3M9J3ZhbHVlJz5cIisoIWVzdGYgPyBcIi1cIiA6IGVzdGYpK1wiPC90ZD48L3RyPlwiO1x0XHRcdFx0XHRcclxuXHRcdFx0aHRtbCs9XCI8dHI+PHRkIGNsYXNzPSdsYmwnPlNwZWVkPC90ZD48dGQgY2xhc3M9J3ZhbHVlJz5cIisoIWlzRHVtbXkgJiYgZXR4dDEgPyBldHh0MSA6IFwiLVwiKSArIFwiPC90ZD48L3RyPlwiO1xyXG5cdFx0XHRodG1sKz1cIjx0cj48dGQgY2xhc3M9J2xibCc+QWNjZWxlci48L3RkPjx0ZCBjbGFzcz0ndmFsdWUnPlwiKyghaXNEdW1teSAmJiBldHh0MiA/IGV0eHQyIDogXCItXCIpICtcIjwvdGQ+PC90cj5cIjtcclxuXHRcdFx0aHRtbCs9XCI8dHIgc3R5bGU9J2hlaWdodDoxMDAlJz48dGQ+Jm5ic3A7PC90ZD48dGQ+Jm5ic3A7PC90ZD48L3RyPlwiO1xyXG5cdFx0XHRodG1sK1wiPC90YWJsZT5cIlxyXG5cdFx0XHQvL2h0bWwrPVwiPGRpdiBjbGFzcz0ncG9wdXBfc2hhZG93Jz5cIitwcmV0dHlDb29yZCtpbWdkaXYrXCI8L2Rpdj5cIjtcclxuXHRcdFx0XHJcblx0XHRcdHZhciByYW5rPVwiLVwiO1xyXG5cdFx0XHRpZiAodGhpcy5fX3BvcyAhPSB1bmRlZmluZWQpXHJcblx0XHRcdFx0cmFuaz10aGlzLnRyYWNrLnBhcnRpY2lwYW50cy5sZW5ndGgtdGhpcy5fX3BvcztcclxuXHRcdFx0XHJcblx0XHRcdFxyXG5cdFx0XHRodG1sPVwiPGRpdiBjbGFzcz0ncG9wdXBfY29udGVudF9wcmcnPjxkaXYgc3R5bGU9J3dpZHRoOlwiK3AxK1wiJTtoZWlnaHQ6NnB4O2JhY2tncm91bmQtY29sb3I6XCIrQ09ORklHLmFwcGVhcmFuY2UudHJhY2tDb2xvclN3aW0rXCI7ZmxvYXQ6bGVmdDsnPjwvZGl2PjxkaXYgc3R5bGU9J3dpZHRoOlwiK3AyK1wiJTtoZWlnaHQ6NnB4O2JhY2tncm91bmQtY29sb3I6XCIrQ09ORklHLmFwcGVhcmFuY2UudHJhY2tDb2xvckJpa2UrXCI7ZmxvYXQ6bGVmdDsnPjwvZGl2PjxkaXYgc3R5bGU9J3dpZHRoOlwiK3AzK1wiJTtoZWlnaHQ6NnB4O2JhY2tncm91bmQtY29sb3I6XCIrQ09ORklHLmFwcGVhcmFuY2UudHJhY2tDb2xvclJ1bitcIjtmbG9hdDpsZWZ0Oyc+PC9kaXY+XCI7XHJcblx0XHRcdGh0bWwrPVwiPGRpdiBjbGFzcz0ncG9wdXBfdHJhY2tfcG9zJz48ZGl2IGNsYXNzPSdwb3B1cF90cmFja19wb3NfMScgc3R5bGU9J2xlZnQ6XCIrKGVsYXBzZWQqOTApK1wiJSc+PC9kaXY+PC9kaXY+XCI7XHJcblx0XHRcdGh0bWwrPVwiPC9kaXY+XCI7XHJcblx0XHRcdGh0bWwrPVwiPGltZyBjbGFzcz0ncG9wdXBfY29udGVudF9pbWcnIHNyYz0nXCIrdGhpcy5nZXRJbWFnZSgpK1wiJy8+XCI7XHJcblx0XHRcdGh0bWwrPVwiPGRpdiBjbGFzcz0ncG9wdXBfY29udGVudF8xJz5cIjtcclxuXHRcdFx0aHRtbCs9XCI8ZGl2IGNsYXNzPSdwb3B1cF9jb250ZW50X25hbWUnPlwiK2VzY2FwZUhUTUwodGhpcy5nZXRDb2RlKCkpK1wiPC9kaXY+XCI7XHJcblx0XHRcdGh0bWwrPVwiPGRpdiBjbGFzcz0ncG9wdXBfY29udGVudF9sMSc+XCIrdGhpcy5nZXRDb3VudHJ5KCkuc3Vic3RyaW5nKDAsMykudG9VcHBlckNhc2UoKStcIiB8IFBvczogXCIrcmFuaytcIiB8IFNwZWVkOiBcIisoIWlzRHVtbXkgJiYgZXR4dDEgPyBldHh0MSA6IFwiLVwiKStcIjwvZGl2PlwiO1xyXG5cdFx0XHR2YXIgcGFzcyA9IE1hdGgucm91bmQoKChuZXcgRGF0ZSgpKS5nZXRUaW1lKCkgLyAxMDAwIC8gNCkpJTI7XHJcblx0XHRcdGlmIChwYXNzID09IDApIHtcclxuXHRcdFx0XHRpZiAodGhpcy5fX3BvcyAhPSB1bmRlZmluZWQpIFxyXG5cdFx0XHRcdHtcclxuXHRcdFx0XHRcdHBhcnNlRmxvYXQoTWF0aC5yb3VuZChlbGttICogMTAwKSAvIDEwMCkudG9GaXhlZCgyKVxyXG5cclxuXHRcdFx0XHRcdGlmICh0aGlzLl9fbmV4dCAmJiB0aGlzLmdldFNwZWVkKCkpIHtcclxuXHRcdFx0XHRcdFx0dmFyIHBlbCA9IHRoaXMuX19uZXh0LmNhbGN1bGF0ZUVsYXBzZWRBdmVyYWdlKGN0aW1lKTtcclxuXHRcdFx0XHRcdFx0dmFyIGRuZXh0ID0gKChwZWwtZWxhcHNlZCkqdGhpcy50cmFjay5nZXRUcmFja0xlbmd0aCgpIC8gdGhpcy5nZXRTcGVlZCgpKS82MC4wO1xyXG5cdFx0XHRcdFx0XHRkbmV4dCA9IHBhcnNlRmxvYXQoTWF0aC5yb3VuZChkbmV4dCAqIDEwMCkgLyAxMDApLnRvRml4ZWQoMik7XHJcblx0XHRcdFx0XHRcdGh0bWwrPVwiPGRpdiBjbGFzcz0ncG9wdXBfY29udGVudF9sMyc+R0FQIFBcIisodGhpcy50cmFjay5wYXJ0aWNpcGFudHMubGVuZ3RoLXRoaXMuX19uZXh0Ll9fcG9zKStcIiA6IFwiK2RuZXh0K1wiIE1pbjwvZGl2PlwiO1xyXG5cdFx0XHRcdFx0fSBlbHNlIHtcclxuXHRcdFx0XHRcdFx0aHRtbCs9XCI8ZGl2IGNsYXNzPSdwb3B1cF9jb250ZW50X2wyJz4mbmJzcDs8L2Rpdj5cIjtcclxuXHRcdFx0XHRcdH1cclxuXHRcdFx0XHRcdFxyXG5cdFx0XHRcdFx0aWYgKHRoaXMuX19wcmV2ICYmIHRoaXMuX19wcmV2LmdldFNwZWVkKCkpIHtcclxuXHRcdFx0XHRcdFx0dmFyIHBlbCA9IHRoaXMuX19wcmV2LmNhbGN1bGF0ZUVsYXBzZWRBdmVyYWdlKGN0aW1lKTtcclxuXHRcdFx0XHRcdFx0dmFyIGRwcmV2ID0gKChlbGFwc2VkLXBlbCkqdGhpcy50cmFjay5nZXRUcmFja0xlbmd0aCgpIC8gdGhpcy5fX3ByZXYuZ2V0U3BlZWQoKSkvNjAuMDtcclxuXHRcdFx0XHRcdFx0ZHByZXYgPSBwYXJzZUZsb2F0KE1hdGgucm91bmQoZHByZXYgKiAxMDApIC8gMTAwKS50b0ZpeGVkKDIpO1xyXG5cdFx0XHRcdFx0XHRodG1sKz1cIjxkaXYgY2xhc3M9J3BvcHVwX2NvbnRlbnRfbDInPkdBUCBQXCIrKHRoaXMudHJhY2sucGFydGljaXBhbnRzLmxlbmd0aC10aGlzLl9fcHJldi5fX3BvcykrXCIgOiBcIitkcHJlditcIiBNaW48L2Rpdj5cIjtcclxuXHRcdFx0XHRcdH0gZWxzZSB7XHJcblx0XHRcdFx0XHRcdGh0bWwrPVwiPGRpdiBjbGFzcz0ncG9wdXBfY29udGVudF9sMic+Jm5ic3A7PC9kaXY+XCI7XHJcblx0XHRcdFx0XHR9IFxyXG5cdFx0XHRcdFx0XHJcblx0XHRcdFx0fVxyXG5cdFx0XHR9IGVsc2Uge1xyXG5cdFx0XHRcdGh0bWwrPVwiPGRpdiBjbGFzcz0ncG9wdXBfY29udGVudF9sMic+TU9SRSBUTyAgXCIrdHBhcnRNb3JlK1wiOiBcIisoaXNEdW1teSA/IFwiLVwiIDogcGFyc2VGbG9hdChNYXRoLnJvdW5kKCh0YXJnZXRLTS1lbGttKSAqIDEwMCkgLyAxMDApLnRvRml4ZWQoMikgLyogcmVrbSAqLyArXCIga21cIikrXCI8L2Rpdj5cIjtcclxuXHRcdFx0XHRodG1sKz1cIjxkaXYgY2xhc3M9J3BvcHVwX2NvbnRlbnRfbDMnPkZJTklTSCBcIisgdHBhcnRzICtcIjogXCIrKCFlc3RmID8gXCItXCIgOiBlc3RmKStcIjwvZGl2PlwiO1xyXG5cdFx0XHR9XHJcblx0XHRcdGh0bWwrPVwiPC9kaXY+XCI7XHJcblx0XHRcdHJldHVybiBodG1sO1xyXG5cdFx0fVxyXG5cdFx0XHJcblx0XHRcclxuICAgIH1cclxufSk7XHJcbiIsInJlcXVpcmUoJ2pvb3NlJyk7XHJcblxyXG5DbGFzcyhcIlBvaW50XCIsIHtcclxuICAgIC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuICAgIC8vIEFMTCBDT09SRElOQVRFUyBBUkUgSU4gV09STEQgTUVSQ0FUT1JcclxuICAgIC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHJcbiAgICBoYXMgOiB7XHJcbiAgICAgICAgY29kZSA6IHtcclxuICAgICAgICAgICAgaXMgOiBcInJ3XCIsXHJcbiAgICAgICAgICAgIGluaXQgOiBcIkNPREVfTk9UX1NFVFwiXHJcbiAgICAgICAgfSxcclxuICAgICAgICBpZCA6IHtcclxuICAgICAgICAgICAgaXMgOiBcInJ3XCIsXHJcbiAgICAgICAgICAgIGluaXQgOiBcIklEX05PVF9TRVRcIlxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgZmVhdHVyZSA6IHtcclxuICAgICAgICAgICAgaXMgOiBcInJ3XCIsXHJcbiAgICAgICAgICAgIGluaXQgOiBudWxsXHJcbiAgICAgICAgfSxcclxuICAgICAgICBwb3NpdGlvbiA6IHtcclxuICAgICAgICAgICAgaXM6ICAgXCJyd1wiLFxyXG4gICAgICAgICAgICBpbml0OiBbMCwwXVx0Ly9sb24gbGF0IHdvcmxkIG1lcmNhdG9yXHJcbiAgICAgICAgfVxyXG4gICAgfSxcclxuXHJcbiAgICBtZXRob2RzIDoge1xyXG4gICAgICAgIGluaXQgOiBmdW5jdGlvbihwb3MpIHtcclxuICAgICAgICAgICAgaWYgKHR5cGVvZiBvbCAhPSBcInVuZGVmaW5lZFwiKSB7XHJcbiAgICAgICAgICAgICAgICB2YXIgZ2VvbSA9IG5ldyBvbC5nZW9tLlBvaW50KHBvcyk7XHJcbiAgICAgICAgICAgICAgICBnZW9tLnRyYW5zZm9ybSgnRVBTRzo0MzI2JywgJ0VQU0c6Mzg1NycpO1xyXG4gICAgICAgICAgICAgICAgdmFyIGZlYXR1cmUgPSBuZXcgb2wuRmVhdHVyZSgpO1xyXG4gICAgICAgICAgICAgICAgZmVhdHVyZS5zZXRHZW9tZXRyeShnZW9tKTtcclxuICAgICAgICAgICAgICAgIHRoaXMuc2V0RmVhdHVyZShmZWF0dXJlKTtcclxuXHJcbiAgICAgICAgICAgICAgICB0aGlzLnNldFBvc2l0aW9uKHBvcyk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICB9XHJcbn0pOyIsInZhciBDT05GSUcgPSByZXF1aXJlKCcuL0NvbmZpZycpO1xyXG5cclxudmFyIFNUWUxFUz1cclxue1xyXG5cdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0Ly8gc3R5bGUgZnVuY3Rpb24gZm9yIHRyYWNrXHJcblx0Ly8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRcInRyYWNrXCIgOiBmdW5jdGlvbihmZWF0dXJlLHJlc29sdXRpb24pIFxyXG5cdHtcclxuXHRcdHZhciBzdHlsZXM9W107XHJcblx0XHR2YXIgdHJhY2s9ZmVhdHVyZS50cmFjaztcclxuXHRcdHZhciBjb29yZHM9ZmVhdHVyZS5nZXRHZW9tZXRyeSgpLmdldENvb3JkaW5hdGVzKCk7XHJcblx0XHR2YXIgZ2VvbXN3aW09Y29vcmRzO1xyXG5cdFx0dmFyIGdlb21iaWtlO1xyXG5cdFx0dmFyIGdlb21ydW47XHJcblx0XHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRcdFxyXG5cdFx0Lyp2YXIgd3cgPSA4LjAvcmVzb2x1dGlvbjtcclxuXHRcdGlmICh3dyA8IDYuMClcclxuXHRcdFx0d3c9Ni4wOyovXHJcblx0XHR2YXIgd3c9MTAuMDtcclxuXHJcblx0XHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRcdGlmICh0cmFjayAmJiAhaXNOYU4odHJhY2suYmlrZVN0YXJ0S00pKSBcclxuXHRcdHtcclxuXHRcdFx0Zm9yICh2YXIgaT0wO2k8dHJhY2suZGlzdGFuY2VzLmxlbmd0aDtpKyspIHtcclxuXHRcdFx0XHRpZiAodHJhY2suZGlzdGFuY2VzW2ldID49IHRyYWNrLmJpa2VTdGFydEtNKjEwMDApXHJcblx0XHRcdFx0XHRicmVhaztcclxuXHRcdFx0fVxyXG5cdFx0XHR2YXIgajtcclxuXHRcdFx0aWYgKCFpc05hTih0cmFjay5ydW5TdGFydEtNKSkge1xyXG5cdFx0XHRcdGZvciAoaj1pO2o8dHJhY2suZGlzdGFuY2VzLmxlbmd0aDtqKyspIHtcclxuXHRcdFx0XHRcdGlmICh0cmFjay5kaXN0YW5jZXNbal0gPj0gdHJhY2sucnVuU3RhcnRLTSoxMDAwKVxyXG5cdFx0XHRcdFx0XHRicmVhaztcclxuXHRcdFx0XHR9XHJcblx0XHRcdH0gZWxzZSB7XHJcblx0XHRcdFx0aj10cmFjay5kaXN0YW5jZXMubGVuZ3RoO1xyXG5cdFx0XHR9XHJcblx0XHRcdGdlb21zd2ltPWNvb3Jkcy5zbGljZSgwLGkpO1xyXG5cdFx0XHRnZW9tYmlrZT1jb29yZHMuc2xpY2UoaSA8IDEgPyBpIDogaS0xLGopO1xyXG5cdFx0XHRpZiAoaiA8IHRyYWNrLmRpc3RhbmNlcy5sZW5ndGgpXHJcblx0XHRcdFx0Z2VvbXJ1bj1jb29yZHMuc2xpY2UoaiA8IDEgPyBqIDogai0xLHRyYWNrLmRpc3RhbmNlcy5sZW5ndGgpO1xyXG5cdFx0XHRpZiAoIWdlb21zd2ltLmxlbmd0aClcclxuXHRcdFx0XHRnZW9tc3dpbT1udWxsO1xyXG5cdFx0XHRpZiAoIWdlb21iaWtlLmxlbmd0aClcclxuXHRcdFx0XHRnZW9tYmlrZT1udWxsO1xyXG5cdFx0XHRpZiAoIWdlb21ydW4ubGVuZ3RoKVxyXG4gICAgICAgICAgICAgICAgZ2VvbXJ1bj1udWxsO1xyXG5cdFx0fVxyXG5cclxuXHJcbiAgICAgICAgaWYgKGdlb21zd2ltICYmIEdVSS5pc1Nob3dTd2ltKSB7XHJcbiAgICAgICAgICAgIHN0eWxlcy5wdXNoKG5ldyBvbC5zdHlsZS5TdHlsZSh7XHJcbiAgICAgICAgICAgICAgICAgICAgZ2VvbWV0cnk6IG5ldyBvbC5nZW9tLkxpbmVTdHJpbmcoZ2VvbXN3aW0pLFxyXG4gICAgICAgICAgICAgICAgICAgIHN0cm9rZTogbmV3IG9sLnN0eWxlLlN0cm9rZSh7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbG9yOiBDT05GSUcuYXBwZWFyYW5jZS50cmFja0NvbG9yU3dpbSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgd2lkdGg6IHd3XHJcbiAgICAgICAgICAgICAgICAgICAgfSlcclxuICAgICAgICAgICAgICAgIH0pXHJcbiAgICAgICAgICAgICk7XHJcbiAgICAgICAgICAgIFNUWUxFUy5fZ2VuRGlyZWN0aW9uKGdlb21zd2ltLCB3dywgcmVzb2x1dGlvbiwgQ09ORklHLmFwcGVhcmFuY2UudHJhY2tDb2xvclN3aW0sIHN0eWxlcyk7XHJcblxyXG4gICAgICAgICAgICBTVFlMRVMuX2dlbkRpc3RhbmNlS20od3csIHJlc29sdXRpb24sIGNvb3JkcywgdHJhY2suZGlzdGFuY2VzLCAwLCBpLCBzdHlsZXMpO1xyXG5cclxuXHRcdFx0Ly8gZm9yIG5vdyBkb24ndCBzaG93IHRoaXMgY2hlY2twb2ludFxyXG5cdFx0XHQvL2lmIChHVUkuaXNTaG93U3dpbSlcclxuXHRcdFx0Ly9cdFNUWUxFUy5fZ2VuQ2hlY2twb2ludChnZW9tc3dpbSwgQ09ORklHLmFwcGVhcmFuY2UudHJhY2tDb2xvclN3aW0sIHN0eWxlcyk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGlmIChnZW9tYmlrZSAmJiBHVUkuaXNTaG93QmlrZSlcclxuICAgICAgICB7XHJcbiAgICAgICAgICAgIHN0eWxlcy5wdXNoKG5ldyBvbC5zdHlsZS5TdHlsZSh7XHJcbiAgICAgICAgICAgICAgICAgICAgZ2VvbWV0cnk6IG5ldyBvbC5nZW9tLkxpbmVTdHJpbmcoZ2VvbWJpa2UpLFxyXG4gICAgICAgICAgICAgICAgICAgIHN0cm9rZTogbmV3IG9sLnN0eWxlLlN0cm9rZSh7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbG9yOiBDT05GSUcuYXBwZWFyYW5jZS50cmFja0NvbG9yQmlrZSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgd2lkdGg6IHd3XHJcbiAgICAgICAgICAgICAgICAgICAgfSlcclxuICAgICAgICAgICAgICAgIH0pXHJcbiAgICAgICAgICAgICk7XHJcbiAgICAgICAgICAgIFNUWUxFUy5fZ2VuRGlyZWN0aW9uKGdlb21iaWtlLCB3dywgcmVzb2x1dGlvbiwgQ09ORklHLmFwcGVhcmFuY2UudHJhY2tDb2xvckJpa2UsIHN0eWxlcyk7XHJcblxyXG4gICAgICAgICAgICBTVFlMRVMuX2dlbkRpc3RhbmNlS20od3csIHJlc29sdXRpb24sIGNvb3JkcywgdHJhY2suZGlzdGFuY2VzLCBpLCBqLCBzdHlsZXMpO1xyXG5cclxuXHRcdFx0Ly8gYWRkIGNoZWNrcG9pbnQgaWYgdGhpcyBpcyBub3QgYWxyZWFkeSBhZGRlZCBhcyBhIGhvdHNwb3RcclxuXHRcdFx0aWYgKCF0cmFjay5pc0FkZGVkSG90U3BvdFN3aW1CaWtlKSB7XHJcblx0XHRcdFx0aWYgKENPTkZJRy5hcHBlYXJhbmNlLmlzU2hvd0ltYWdlQ2hlY2twb2ludClcclxuXHRcdFx0XHRcdFNUWUxFUy5fZ2VuQ2hlY2twb2ludEltYWdlKGdlb21iaWtlLCBDT05GSUcuYXBwZWFyYW5jZS5pbWFnZUNoZWNrcG9pbnRTd2ltQmlrZSwgc3R5bGVzKTtcclxuXHRcdFx0XHRlbHNlIGlmIChHVUkuaXNTaG93QmlrZSlcclxuXHRcdFx0XHRcdFNUWUxFUy5fZ2VuQ2hlY2twb2ludChnZW9tYmlrZSwgQ09ORklHLmFwcGVhcmFuY2UudHJhY2tDb2xvckJpa2UsIHN0eWxlcyk7XHJcblx0XHRcdH1cclxuICAgICAgICB9XHJcblx0XHRpZiAoZ2VvbXJ1biAmJiBHVUkuaXNTaG93UnVuKVxyXG5cdFx0e1xyXG5cdFx0XHRzdHlsZXMucHVzaChuZXcgb2wuc3R5bGUuU3R5bGUoe1xyXG4gICAgICAgICAgICAgICAgICAgIGdlb21ldHJ5OiBuZXcgb2wuZ2VvbS5MaW5lU3RyaW5nKGdlb21ydW4pLFxyXG4gICAgICAgICAgICAgICAgICAgIHN0cm9rZTogbmV3IG9sLnN0eWxlLlN0cm9rZSh7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbG9yOiBDT05GSUcuYXBwZWFyYW5jZS50cmFja0NvbG9yUnVuLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICB3aWR0aDogd3dcclxuICAgICAgICAgICAgICAgICAgICB9KVxyXG4gICAgICAgICAgICAgICAgfSlcclxuICAgICAgICAgICAgKTtcclxuICAgICAgICAgICAgU1RZTEVTLl9nZW5EaXJlY3Rpb24oZ2VvbXJ1biwgd3csIHJlc29sdXRpb24sIENPTkZJRy5hcHBlYXJhbmNlLnRyYWNrQ29sb3JSdW4sIHN0eWxlcyk7XHJcblxyXG4gICAgICAgICAgICBTVFlMRVMuX2dlbkRpc3RhbmNlS20od3csIHJlc29sdXRpb24sIGNvb3JkcywgdHJhY2suZGlzdGFuY2VzLCBqLCB0cmFjay5kaXN0YW5jZXMubGVuZ3RoLCBzdHlsZXMpO1xyXG5cclxuXHRcdFx0Ly8gYWRkIGNoZWNrcG9pbnQgaWYgdGhpcyBpcyBub3QgYWxyZWFkeSBhZGRlZCBhcyBhIGhvdHNwb3RcclxuXHRcdFx0aWYgKCF0cmFjay5pc0FkZGVkSG90U3BvdEJpa2VSdW4pIHtcclxuXHRcdFx0XHRpZiAoQ09ORklHLmFwcGVhcmFuY2UuaXNTaG93SW1hZ2VDaGVja3BvaW50KVxyXG5cdFx0XHRcdFx0U1RZTEVTLl9nZW5DaGVja3BvaW50SW1hZ2UoZ2VvbXJ1biwgQ09ORklHLmFwcGVhcmFuY2UuaW1hZ2VDaGVja3BvaW50QmlrZVJ1biwgc3R5bGVzKTtcclxuXHRcdFx0XHRlbHNlIGlmIChHVUkuaXNTaG93QmlrZSlcclxuXHRcdFx0XHRcdFNUWUxFUy5fZ2VuQ2hlY2twb2ludChnZW9tcnVuLCBDT05GSUcuYXBwZWFyYW5jZS50cmFja0NvbG9yUnVuLCBzdHlsZXMpO1xyXG5cdFx0XHR9XHJcbiAgICAgICAgfVxyXG5cclxuXHRcdC8vIFNUQVJULUZJTklTSCAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdFx0aWYgKGNvb3JkcyAmJiBjb29yZHMubGVuZ3RoID49IDIpXHJcblx0XHR7XHJcblx0XHRcdHZhciBzdGFydCA9IGNvb3Jkc1swXTtcclxuXHRcdFx0dmFyIGVuZCA9IGNvb3Jkc1sxXTtcclxuXHRcdFx0Lyp2YXIgZHggPSBlbmRbMF0gLSBzdGFydFswXTtcclxuXHRcdFx0IHZhciBkeSA9IGVuZFsxXSAtIHN0YXJ0WzFdO1xyXG5cdFx0XHQgdmFyIHJvdGF0aW9uID0gTWF0aC5hdGFuMihkeSwgZHgpO1xyXG5cdFx0XHQgc3R5bGVzLnB1c2gobmV3IG9sLnN0eWxlLlN0eWxlKFxyXG5cdFx0XHQge1xyXG5cdFx0XHQgZ2VvbWV0cnk6IG5ldyBvbC5nZW9tLlBvaW50KHN0YXJ0KSxcclxuXHRcdFx0IGltYWdlOiBuZXcgb2wuc3R5bGUuSWNvbih7XHJcblx0XHRcdCBzcmM6ICdpbWcvYmVnaW4tZW5kLWFycm93LnBuZycsXHJcblx0XHRcdCBzY2FsZSA6IDAuNDUsXHJcblx0XHRcdCBhbmNob3I6IFswLjAsIDAuNV0sXHJcblx0XHRcdCByb3RhdGVXaXRoVmlldzogdHJ1ZSxcclxuXHRcdFx0IHJvdGF0aW9uOiAtcm90YXRpb24sXHJcblx0XHRcdCBvcGFjaXR5IDogMVxyXG5cdFx0XHQgfSlcclxuXHRcdFx0IH0pKTsqL1xyXG5cclxuXHRcdFx0Ly8gbG9vcD9cclxuXHRcdFx0ZW5kID0gY29vcmRzW2Nvb3Jkcy5sZW5ndGgtMV07XHJcblx0XHRcdGlmIChlbmRbMF0gIT0gc3RhcnRbMF0gfHwgZW5kWzFdICE9IHN0YXJ0WzFdKVxyXG5cdFx0XHR7XHJcblx0XHRcdFx0dmFyIHN0YXJ0ID0gY29vcmRzW2Nvb3Jkcy5sZW5ndGgtMl07XHJcblx0XHRcdFx0dmFyIGR4ID0gZW5kWzBdIC0gc3RhcnRbMF07XHJcblx0XHRcdFx0dmFyIGR5ID0gZW5kWzFdIC0gc3RhcnRbMV07XHJcblx0XHRcdFx0dmFyIHJvdGF0aW9uID0gTWF0aC5hdGFuMihkeSwgZHgpO1xyXG5cdFx0XHRcdHN0eWxlcy5wdXNoKG5ldyBvbC5zdHlsZS5TdHlsZShcclxuXHRcdFx0XHRcdHtcclxuXHRcdFx0XHRcdFx0Z2VvbWV0cnk6IG5ldyBvbC5nZW9tLlBvaW50KGVuZCksXHJcblx0XHRcdFx0XHRcdGltYWdlOiBuZXcgb2wuc3R5bGUuSWNvbih7XHJcblx0XHRcdFx0XHRcdFx0c3JjOiBDT05GSUcuYXBwZWFyYW5jZS5pbWFnZUZpbmlzaCxcclxuXHRcdFx0XHRcdFx0XHRzY2FsZSA6IDAuNDUsXHJcblx0XHRcdFx0XHRcdFx0YW5jaG9yOiBbMC41LCAwLjVdLFxyXG5cdFx0XHRcdFx0XHRcdHJvdGF0ZVdpdGhWaWV3OiB0cnVlLFxyXG5cdFx0XHRcdFx0XHRcdC8vcm90YXRpb246IC1yb3RhdGlvbixcclxuXHRcdFx0XHRcdFx0XHRvcGFjaXR5IDogMVxyXG5cdFx0XHRcdFx0XHR9KVxyXG5cdFx0XHRcdFx0fSkpO1xyXG5cdFx0XHR9XHJcblx0XHR9XHJcblxyXG5cdFx0cmV0dXJuIHN0eWxlcztcclxuXHR9LFxyXG5cdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRcImRlYnVnR1BTXCIgOiBmdW5jdGlvbihmZWF0dXJlLHJlc29sdXRpb24pIFxyXG5cdHtcclxuXHRcdHZhciBjb2VmID0gKChuZXcgRGF0ZSgpKS5nZXRUaW1lKCktZmVhdHVyZS50aW1lQ3JlYXRlZCkvKENPTkZJRy50aW1lb3V0cy5ncHNMb2NhdGlvbkRlYnVnU2hvdyoxMDAwKTtcclxuXHRcdGlmIChjb2VmID4gMSlcclxuXHRcdFx0cmV0dXJuIFtdO1xyXG5cdFx0cmV0dXJuIFtcclxuXHRcdCAgICAgICAgbmV3IG9sLnN0eWxlLlN0eWxlKHtcclxuXHRcdCAgICAgICAgaW1hZ2U6IG5ldyBvbC5zdHlsZS5DaXJjbGUoe1xyXG5cdFx0ICAgICAgICAgICAgcmFkaXVzOiBjb2VmKjIwLFxyXG5cdFx0ICAgICAgICAgICAgc3Ryb2tlOiBuZXcgb2wuc3R5bGUuU3Ryb2tlKHtcclxuXHRcdCAgICAgICAgICAgIFx0Ly9mZWF0dXJlLmNvbG9yXHJcblx0XHQgICAgICAgICAgICAgICAgY29sb3I6IGNvbG9yQWxwaGFBcnJheShmZWF0dXJlLmNvbG9yLCgxLjAtY29lZikqMS4wKSwgXHJcblx0XHQgICAgICAgICAgICAgICAgd2lkdGg6IDRcclxuXHRcdCAgICAgICAgICAgIH0pXHJcblx0XHQgICAgICAgICAgfSlcclxuXHRcdH0pXTtcclxuXHR9LFxyXG5cdFxyXG5cdFwicGFydGljaXBhbnRcIiA6IGZ1bmN0aW9uKGZlYXR1cmUscmVzb2x1dGlvbikgXHJcblx0e1xyXG5cdFx0Ly8gU0tJUCBEUkFXIChUT0RPIE9QVElNSVpFKVxyXG5cdFx0dmFyIHBhcnQgPSBmZWF0dXJlLnBhcnRpY2lwYW50O1xyXG5cdFx0aWYgKCFwYXJ0LmlzRmF2b3JpdGUpXHJcblx0XHRcdHJldHVybiBbXTtcclxuXHRcdFxyXG5cdFx0dmFyIGV0eHQ9XCJcIjtcclxuXHRcdHZhciBsc3RhdGUgPSBudWxsO1xyXG5cdFx0aWYgKHBhcnQuc3RhdGVzLmxlbmd0aCkge1xyXG5cdFx0XHRsc3RhdGUgPSBwYXJ0LnN0YXRlc1twYXJ0LnN0YXRlcy5sZW5ndGgtMV07XHJcblx0XHRcdGV0eHQ9XCIgXCIrcGFyc2VGbG9hdChNYXRoLmNlaWwobHN0YXRlLmdldFNwZWVkKCkgKiAxMDApIC8gMTAwKS50b0ZpeGVkKDIpK1wiIG0vc1wiOy8vIHwgYWNjIFwiK3BhcnNlRmxvYXQoTWF0aC5jZWlsKGxzdGF0ZS5nZXRBY2NlbGVyYXRpb24oKSAqIDEwMCkgLyAxMDApLnRvRml4ZWQoMikrXCIgbS9zXCI7XHJcblx0XHR9XHJcblx0XHR2YXIgekluZGV4ID0gTWF0aC5yb3VuZChwYXJ0LmdldEVsYXBzZWQoKSoxMDAwMDAwKSoxMDAwK3BhcnQuc2VxSWQ7XHJcblx0XHQvKmlmIChwYXJ0ID09IEdVSS5nZXRTZWxlY3RlZFBhcnRpY2lwYW50KCkpIHtcclxuXHRcdFx0ekluZGV4PTFlMjA7XHJcblx0XHR9Ki9cclxuXHRcdHZhciBzdHlsZXM9W107XHJcblx0XHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0XHR2YXIgY3RpbWUgPSAobmV3IERhdGUoKSkuZ2V0VGltZSgpO1xyXG5cdFx0dmFyIGlzVGltZSA9IChjdGltZSA+PSBDT05GSUcudGltZXMuYmVnaW4gJiYgY3RpbWUgPD0gQ09ORklHLnRpbWVzLmVuZCk7XHJcblx0XHR2YXIgaXNEaXJlY3Rpb24gPSAobHN0YXRlICYmIGxzdGF0ZS5nZXRTcGVlZCgpID4gMCAmJiAhcGFydC5pc1NPUyAmJiAhcGFydC5pc0Rpc2NhcmRlZCAmJiBpc1RpbWUpO1xyXG5cdFx0dmFyIGFuaW1GcmFtZSA9IChjdGltZSUzMDAwKSpNYXRoLlBJKjIvMzAwMC4wO1xyXG5cclxuICAgICAgICBpZiAoaXNUaW1lKSB7XHJcbiAgICAgICAgICAgIHN0eWxlcy5wdXNoKG5ldyBvbC5zdHlsZS5TdHlsZSh7XHJcbiAgICAgICAgICAgICAgICB6SW5kZXg6IHpJbmRleCxcclxuICAgICAgICAgICAgICAgIGltYWdlOiBuZXcgb2wuc3R5bGUuQ2lyY2xlKHtcclxuICAgICAgICAgICAgICAgICAgICByYWRpdXM6IDE3LFxyXG4gICAgICAgICAgICAgICAgICAgIGZpbGw6IG5ldyBvbC5zdHlsZS5GaWxsKHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29sb3I6IHBhcnQuaXNEaXNjYXJkZWQgfHwgcGFydC5pc1NPUyA/IFwicmdiYSgxOTIsMCwwLFwiICsgKE1hdGguc2luKGFuaW1GcmFtZSkgKiAwLjcgKyAwLjMpICsgXCIpXCIgOiBcInJnYmEoXCIgKyBjb2xvckFscGhhQXJyYXkocGFydC5jb2xvciwgMC44NSkuam9pbihcIixcIikgKyBcIilcIlxyXG4gICAgICAgICAgICAgICAgICAgIH0pLFxyXG4gICAgICAgICAgICAgICAgICAgIHN0cm9rZTogbmV3IG9sLnN0eWxlLlN0cm9rZSh7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbG9yOiBwYXJ0LmlzRGlzY2FyZGVkIHx8IHBhcnQuaXNTT1MgPyBcInJnYmEoMjU1LDAsMCxcIiArICgxLjAgLSAoTWF0aC5zaW4oYW5pbUZyYW1lKSAqIDAuNyArIDAuMykpICsgXCIpXCIgOiBcIiNmZmZmZmZcIixcclxuICAgICAgICAgICAgICAgICAgICAgICAgd2lkdGg6IDNcclxuICAgICAgICAgICAgICAgICAgICB9KVxyXG4gICAgICAgICAgICAgICAgfSksXHJcbiAgICAgICAgICAgICAgICB0ZXh0OiBuZXcgb2wuc3R5bGUuVGV4dCh7XHJcbiAgICAgICAgICAgICAgICAgICAgZm9udDogJ25vcm1hbCAxM3B4IExhdG8tUmVndWxhcicsXHJcbiAgICAgICAgICAgICAgICAgICAgZmlsbDogbmV3IG9sLnN0eWxlLkZpbGwoe1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb2xvcjogJyNGRkZGRkYnXHJcbiAgICAgICAgICAgICAgICAgICAgfSksXHJcbiAgICAgICAgICAgICAgICAgICAgdGV4dDogcGFydC5nZXRJbml0aWFscygpLFxyXG4gICAgICAgICAgICAgICAgICAgIG9mZnNldFg6IDAsXHJcbiAgICAgICAgICAgICAgICAgICAgb2Zmc2V0WTogMFxyXG4gICAgICAgICAgICAgICAgfSlcclxuICAgICAgICAgICAgfSkpO1xyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgIHN0eWxlcy5wdXNoKG5ldyBvbC5zdHlsZS5TdHlsZSh7XHJcbiAgICAgICAgICAgICAgICB6SW5kZXg6IHpJbmRleCxcclxuICAgICAgICAgICAgICAgIGltYWdlOiBuZXcgb2wuc3R5bGUuQ2lyY2xlKHtcclxuICAgICAgICAgICAgICAgICAgICByYWRpdXM6IDE3LFxyXG4gICAgICAgICAgICAgICAgICAgIGZpbGw6IG5ldyBvbC5zdHlsZS5GaWxsKHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29sb3I6IFwicmdiYShcIiArIGNvbG9yQWxwaGFBcnJheShwYXJ0LmNvbG9yLCAwLjM1KS5qb2luKFwiLFwiKSArIFwiKVwiXHJcbiAgICAgICAgICAgICAgICAgICAgfSksXHJcbiAgICAgICAgICAgICAgICAgICAgc3Ryb2tlOiBuZXcgb2wuc3R5bGUuU3Ryb2tlKHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29sb3I6IFwicmdiYSgyNTUsMjU1LDI1NSwxKVwiLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICB3aWR0aDogM1xyXG4gICAgICAgICAgICAgICAgICAgIH0pXHJcbiAgICAgICAgICAgICAgICB9KSxcclxuICAgICAgICAgICAgICAgIHRleHQ6IG5ldyBvbC5zdHlsZS5UZXh0KHtcclxuICAgICAgICAgICAgICAgICAgICBmb250OiAnbm9ybWFsIDEzcHggTGF0by1SZWd1bGFyJyxcclxuICAgICAgICAgICAgICAgICAgICBmaWxsOiBuZXcgb2wuc3R5bGUuRmlsbCh7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbG9yOiAnIzAwMDAwMCdcclxuICAgICAgICAgICAgICAgICAgICB9KSxcclxuICAgICAgICAgICAgICAgICAgICB0ZXh0OiBwYXJ0LmdldERldmljZUlkKCksXHJcbiAgICAgICAgICAgICAgICAgICAgb2Zmc2V0WDogMCxcclxuICAgICAgICAgICAgICAgICAgICBvZmZzZXRZOiAyMFxyXG4gICAgICAgICAgICAgICAgfSlcclxuICAgICAgICAgICAgfSkpO1xyXG4gICAgICAgIH1cclxuICAgICAgICAvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcbiAgICAgICAgc3R5bGVzLnB1c2gobmV3IG9sLnN0eWxlLlN0eWxlKHtcclxuICAgICAgICAgICAgekluZGV4OiB6SW5kZXgsXHJcbiAgICAgICAgICAgIGltYWdlOiBuZXcgb2wuc3R5bGUuQ2lyY2xlKHtcclxuICAgICAgICAgICAgICAgIHJhZGl1czogMTcsXHJcbiAgICAgICAgICAgICAgICBmaWxsOiBuZXcgb2wuc3R5bGUuRmlsbCh7XHJcbiAgICAgICAgICAgICAgICAgICAgY29sb3I6IHBhcnQuaXNEaXNjYXJkZWQgfHwgcGFydC5pc1NPUyA/IFwicmdiYSgxOTIsMCwwLFwiICsgKE1hdGguc2luKGFuaW1GcmFtZSkgKiAwLjcgKyAwLjMpICsgXCIpXCIgOiBcInJnYmEoXCIgKyBjb2xvckFscGhhQXJyYXkocGFydC5jb2xvciwgMC44NSkuam9pbihcIixcIikgKyBcIilcIlxyXG4gICAgICAgICAgICAgICAgfSksXHJcbiAgICAgICAgICAgICAgICBzdHJva2U6IG5ldyBvbC5zdHlsZS5TdHJva2Uoe1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbG9yOiBwYXJ0LmlzRGlzY2FyZGVkIHx8IHBhcnQuaXNTT1MgPyBcInJnYmEoMjU1LDAsMCxcIiArICgxLjAgLSAoTWF0aC5zaW4oYW5pbUZyYW1lKSAqIDAuNyArIDAuMykpICsgXCIpXCIgOiBcIiNmZmZmZmZcIixcclxuICAgICAgICAgICAgICAgICAgICB3aWR0aDogM1xyXG4gICAgICAgICAgICAgICAgfSlcclxuICAgICAgICAgICAgfSksXHJcbiAgICAgICAgICAgIHRleHQ6IG5ldyBvbC5zdHlsZS5UZXh0KHtcclxuICAgICAgICAgICAgICAgIGZvbnQ6ICdub3JtYWwgMTNweCBMYXRvLVJlZ3VsYXInLFxyXG4gICAgICAgICAgICAgICAgZmlsbDogbmV3IG9sLnN0eWxlLkZpbGwoe1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbG9yOiAnI0ZGRkZGRidcclxuICAgICAgICAgICAgICAgIH0pLFxyXG4gICAgICAgICAgICAgICAgdGV4dDogcGFydC5nZXRJbml0aWFscygpLFxyXG4gICAgICAgICAgICAgICAgb2Zmc2V0WDogMCxcclxuICAgICAgICAgICAgICAgIG9mZnNldFk6IDBcclxuICAgICAgICAgICAgfSlcclxuICAgICAgICB9KSk7XHJcblxyXG5cclxuICAgICAgICBpZiAoaXNEaXJlY3Rpb24gJiYgcGFydC5nZXRSb3RhdGlvbigpICE9IG51bGwpXHJcbiAgICAgICAge1xyXG4gICAgICAgICAgICBzdHlsZXMucHVzaChuZXcgb2wuc3R5bGUuU3R5bGUoe1xyXG4gICAgICAgICAgICAgICAgekluZGV4OiB6SW5kZXgsXHJcbiAgICAgICAgICAgICAgICBpbWFnZTogbmV3IG9sLnN0eWxlLkljb24oKHtcclxuICAgICAgICAgICAgICAgICAgICBhbmNob3I6IFstMC41LDAuNV0sXHJcbiAgICAgICAgICAgICAgICAgICAgYW5jaG9yWFVuaXRzOiAnZnJhY3Rpb24nLFxyXG4gICAgICAgICAgICAgICAgICAgIGFuY2hvcllVbml0czogJ2ZyYWN0aW9uJyxcclxuICAgICAgICAgICAgICAgICAgICBvcGFjaXR5OiAxLFxyXG4gICAgICAgICAgICAgICAgICAgIHNyYyA6IHJlbmRlckFycm93QmFzZTY0KDQ4LDQ4LHBhcnQuY29sb3IpLFxyXG5cdFx0XHRcdFx0ICBzY2FsZSA6IDAuNTUsXHJcblx0XHRcdFx0XHQgIHJvdGF0aW9uIDogLXBhcnQuZ2V0Um90YXRpb24oKVxyXG5cdFx0XHRcdCAgIH0pKVxyXG5cdFx0XHR9KSk7XHJcblx0XHR9XHJcbiAgICAgICAgXHJcblx0XHQvKnZhciBjb2VmID0gcGFydC50cmFjay5nZXRUcmFja0xlbmd0aEluV0dTODQoKS9wYXJ0LnRyYWNrLmdldFRyYWNrTGVuZ3RoKCk7XHRcdFxyXG5cdFx0dmFyIHJyID0gQ09ORklHLm1hdGguZ3BzSW5hY2N1cmFjeSpjb2VmO1x0XHRcclxuICAgICAgICBzdHlsZXMucHVzaChuZXcgb2wuc3R5bGUuU3R5bGUoe1xyXG4gICAgICAgICAgICB6SW5kZXg6IHpJbmRleCxcclxuICAgICAgICAgICAgaW1hZ2U6IG5ldyBvbC5zdHlsZS5DaXJjbGUoe1xyXG4gICAgICAgICAgICBcdGdlb21ldHJ5OiBuZXcgb2wuZ2VvbS5Qb2ludChwYXJ0LmdldEdQUygpKSxcclxuICAgICAgICAgICAgICAgIHJhZGl1czogMTAsIC8vcnIgKiByZXNvbHV0aW9uLFxyXG4gICAgICAgICAgICAgICAgZmlsbDogbmV3IG9sLnN0eWxlLkZpbGwoe1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbG9yOiBcInJnYmEoMjU1LDI1NSwyNTUsMC44KVwiXHJcbiAgICAgICAgICAgICAgICB9KSxcclxuICAgICAgICAgICAgICAgIHN0cm9rZTogbmV3IG9sLnN0eWxlLlN0cm9rZSh7XHJcbiAgICAgICAgICAgICAgICAgICAgY29sb3I6IFwicmdiYSgwLDAsMCwxKVwiLFxyXG4gICAgICAgICAgICAgICAgICAgIHdpZHRoOiAxXHJcbiAgICAgICAgICAgICAgICB9KVxyXG4gICAgICAgICAgICB9KVxyXG4gICAgICAgIH0pKTsqL1xyXG5cdFx0cmV0dXJuIHN0eWxlcztcclxuXHR9LFxyXG5cclxuXHRcImNhbVwiIDogZnVuY3Rpb24oZmVhdHVyZSwgcmVzb2x1dGlvbikge1xyXG5cdFx0dmFyIHN0eWxlcz1bXTtcclxuXHJcblx0XHR2YXIgY2FtID0gZmVhdHVyZS5jYW07XHJcblxyXG5cdFx0c3R5bGVzLnB1c2gobmV3IG9sLnN0eWxlLlN0eWxlKHtcclxuXHRcdFx0aW1hZ2U6IG5ldyBvbC5zdHlsZS5JY29uKCh7XHJcblx0XHRcdFx0Ly8gVE9ETyBSdW1lbiAtIGl0J3MgYmV0dGVyIGFsbCBpbWFnZXMgdG8gYmUgdGhlIHNhbWUgc2l6ZSwgc28gdGhlIHNhbWUgc2NhbGVcclxuXHRcdFx0XHRzY2FsZSA6IDAuMDQwLFxyXG5cdFx0XHRcdHNyYyA6IENPTkZJRy5hcHBlYXJhbmNlLmltYWdlQ2FtLnNwbGl0KFwiLnN2Z1wiKS5qb2luKChjYW0uc2VxSWQrMSkgKyBcIi5zdmdcIilcclxuXHRcdFx0fSkpXHJcblx0XHR9KSk7XHJcblxyXG5cdFx0cmV0dXJuIHN0eWxlcztcclxuXHR9LFxyXG5cclxuICAgIFwiaG90c3BvdFwiIDogZnVuY3Rpb24oZmVhdHVyZSwgcmVzb2x1dGlvbikge1xyXG4gICAgICAgIHZhciBzdHlsZXM9W107XHJcblxyXG4gICAgICAgIHZhciBob3RzcG90ID0gZmVhdHVyZS5ob3RzcG90O1xyXG5cclxuICAgICAgICBzdHlsZXMucHVzaChuZXcgb2wuc3R5bGUuU3R5bGUoe1xyXG4gICAgICAgICAgICBpbWFnZTogbmV3IG9sLnN0eWxlLkljb24oKHtcclxuICAgICAgICAgICAgICAgIHNjYWxlIDogaG90c3BvdC5nZXRUeXBlKCkuc2NhbGUgfHwgMSxcclxuICAgICAgICAgICAgICAgIHNyYyA6IGhvdHNwb3QuZ2V0VHlwZSgpLmltYWdlXHJcbiAgICAgICAgICAgIH0pKVxyXG4gICAgICAgIH0pKTtcclxuXHJcbiAgICAgICAgcmV0dXJuIHN0eWxlcztcclxuICAgIH0sXHJcblxyXG5cdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0Ly8gUHJpdmF0ZSBtZXRob2RzXHJcblx0Ly8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHJcblx0X3RyYWNrU2VsZWN0ZWQgOiBuZXcgb2wuc3R5bGUuU3R5bGUoe1xyXG5cdFx0c3Ryb2tlOiBuZXcgb2wuc3R5bGUuU3Ryb2tlKHtcclxuXHRcdFx0Y29sb3I6ICcjRkY1MDUwJyxcclxuXHRcdFx0d2lkdGg6IDQuNVxyXG5cdFx0fSlcclxuXHR9KSxcclxuXHJcblx0X2dlbkNoZWNrcG9pbnQgOiBmdW5jdGlvbihnZW9tZXRyeSwgY29sb3IsIHN0eWxlcykge1xyXG5cdFx0dmFyIHN0YXJ0ID0gZ2VvbWV0cnlbMF07XHJcblx0XHR2YXIgZW5kID0gZ2VvbWV0cnlbMV07XHJcblx0XHR2YXIgZHggPSBlbmRbMF0gLSBzdGFydFswXTtcclxuXHRcdHZhciBkeSA9IGVuZFsxXSAtIHN0YXJ0WzFdO1xyXG5cdFx0dmFyIHJvdGF0aW9uID0gTWF0aC5hdGFuMihkeSwgZHgpO1xyXG5cclxuXHRcdHN0eWxlcy5wdXNoKG5ldyBvbC5zdHlsZS5TdHlsZSh7XHJcblx0XHRcdGdlb21ldHJ5OiBuZXcgb2wuZ2VvbS5Qb2ludChzdGFydCksXHJcblx0XHRcdGltYWdlOiBuZXcgb2wuc3R5bGUuSWNvbih7XHJcblx0XHRcdFx0c3JjOiByZW5kZXJCb3hCYXNlNjQoMTYsMTYsY29sb3IpLFxyXG5cdFx0XHRcdHNjYWxlIDogMSxcclxuXHRcdFx0XHRhbmNob3I6IFswLjkyLCAwLjVdLFxyXG5cdFx0XHRcdHJvdGF0ZVdpdGhWaWV3OiB0cnVlLFxyXG5cdFx0XHRcdHJvdGF0aW9uOiAtcm90YXRpb24sXHJcblx0XHRcdFx0b3BhY2l0eSA6IDAuNjVcclxuXHRcdFx0fSlcclxuXHRcdH0pKTtcclxuXHR9LFxyXG5cclxuXHRfZ2VuQ2hlY2twb2ludEltYWdlIDogZnVuY3Rpb24oZ2VvbWV0cnksIGltYWdlLCBzdHlsZXMpIHtcclxuXHRcdHZhciBzdGFydCA9IGdlb21ldHJ5WzBdO1xyXG5cdFx0Ly92YXIgZW5kID0gZ2VvbWV0cnlbMV07XHJcblx0XHQvL3ZhciBkeCA9IGVuZFswXSAtIHN0YXJ0WzBdO1xyXG5cdFx0Ly92YXIgZHkgPSBlbmRbMV0gLSBzdGFydFsxXTtcclxuXHRcdC8vdmFyIHJvdGF0aW9uID0gTWF0aC5hdGFuMihkeSwgZHgpO1xyXG5cclxuXHRcdHN0eWxlcy5wdXNoKG5ldyBvbC5zdHlsZS5TdHlsZSh7XHJcblx0XHRcdGdlb21ldHJ5OiBuZXcgb2wuZ2VvbS5Qb2ludChzdGFydCksXHJcblx0XHRcdGltYWdlOiBuZXcgb2wuc3R5bGUuSWNvbih7XHJcblx0XHRcdFx0c3JjOiBpbWFnZSxcclxuXHRcdFx0XHQvL3NjYWxlIDogMC42NSxcclxuXHRcdFx0XHRhbmNob3I6IFswLjUsIDAuNV0sXHJcblx0XHRcdFx0cm90YXRlV2l0aFZpZXc6IHRydWUsXHJcblx0XHRcdFx0Ly9yb3RhdGlvbjogLXJvdGF0aW9uLFxyXG5cdFx0XHRcdG9wYWNpdHkgOiAxXHJcblx0XHRcdH0pXHJcblx0XHR9KSk7XHJcblx0fSxcclxuXHJcblx0X2dlbkRpcmVjdGlvbiA6IGZ1bmN0aW9uKHB0cywgd3csIHJlc29sdXRpb24sIGNvbG9yLCBzdHlsZXMpIHtcclxuICAgICAgICBpZiAoQ09ORklHLmFwcGVhcmFuY2UuZGlyZWN0aW9uSWNvbkJldHdlZW4gPD0gMCkge1xyXG4gICAgICAgICAgICAvLyB0aGlzIG1lYW5zIG5vIG5lZWQgdG8gc2hvdyB0aGUgZGlyZWN0aW9uc1xyXG4gICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICB2YXIgY250ID0gMDtcclxuICAgICAgICB2YXIgaWNuID0gcmVuZGVyRGlyZWN0aW9uQmFzZTY0KDE2LCAxNiwgY29sb3IpO1xyXG4gICAgICAgIHZhciByZXMgPSAwLjA7XHJcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBwdHMubGVuZ3RoIC0gMTsgaSsrKSB7XHJcbiAgICAgICAgICAgIHZhciBzdGFydCA9IHB0c1tpICsgMV07XHJcbiAgICAgICAgICAgIHZhciBlbmQgPSBwdHNbaV07XHJcbiAgICAgICAgICAgIHZhciBkeCA9IGVuZFswXSAtIHN0YXJ0WzBdO1xyXG4gICAgICAgICAgICB2YXIgZHkgPSBlbmRbMV0gLSBzdGFydFsxXTtcclxuICAgICAgICAgICAgdmFyIGxlbiA9IE1hdGguc3FydChkeCAqIGR4ICsgZHkgKiBkeSkgLyByZXNvbHV0aW9uO1xyXG4gICAgICAgICAgICByZXMgKz0gbGVuO1xyXG4gICAgICAgICAgICBpZiAoaSA9PSAwIHx8IHJlcyA+PSBDT05GSUcuYXBwZWFyYW5jZS5kaXJlY3Rpb25JY29uQmV0d2Vlbikge1xyXG4gICAgICAgICAgICAgICAgcmVzID0gMDtcclxuICAgICAgICAgICAgICAgIHZhciByb3RhdGlvbiA9IE1hdGguYXRhbjIoZHksIGR4KTtcclxuICAgICAgICAgICAgICAgIHN0eWxlcy5wdXNoKG5ldyBvbC5zdHlsZS5TdHlsZSh7XHJcbiAgICAgICAgICAgICAgICAgICAgZ2VvbWV0cnk6IG5ldyBvbC5nZW9tLlBvaW50KFsoc3RhcnRbMF0gKyBlbmRbMF0pIC8gMiwgKHN0YXJ0WzFdICsgZW5kWzFdKSAvIDJdKSxcclxuICAgICAgICAgICAgICAgICAgICBpbWFnZTogbmV3IG9sLnN0eWxlLkljb24oe1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBzcmM6IGljbixcclxuICAgICAgICAgICAgICAgICAgICAgICAgc2NhbGU6IHd3IC8gMTIuMCxcclxuICAgICAgICAgICAgICAgICAgICAgICAgYW5jaG9yOiBbMC41LCAwLjVdLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICByb3RhdGVXaXRoVmlldzogdHJ1ZSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgcm90YXRpb246IC1yb3RhdGlvbiArIE1hdGguUEksIC8vIGFkZCAxODAgZGVncmVlc1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBvcGFjaXR5OiAxXHJcbiAgICAgICAgICAgICAgICAgICAgfSlcclxuICAgICAgICAgICAgICAgIH0pKTtcclxuICAgICAgICAgICAgICAgIGNudCsrO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgfSxcclxuXHJcbiAgICBfZ2VuRGlzdGFuY2VLbSA6IGZ1bmN0aW9uKHd3LCByZXNvbHV0aW9uLFxyXG5cdFx0XHRcdFx0XHRcdCAgY29vcmRzLCBkaXN0YW5jZXMsIHN0YXJ0RGlzdEluZGV4LCBlbmREaXN0SW5kZXgsXHJcblx0XHRcdFx0XHRcdFx0ICBzdHlsZXMpIHtcclxuICAgICAgICAvLyBUT0RPIFJ1bWVuIC0gc3RpbGwgbm90IHJlYWR5IC0gZm9yIG5vdyBzdGF0aWMgaG90c3BvdHMgYXJlIHVzZWRcclxuICAgICAgICBpZiAodHJ1ZSkge3JldHVybjt9XHJcblxyXG4gICAgICAgIHZhciBob3RzcG90c0ttID0gWzIwLCA0MCwgNjAsIDgwLCAxMDAsIDEyMCwgMTQwLCAxNjAsIDE4MF07XHJcblxyXG4gICAgICAgIGZ1bmN0aW9uIGFkZEhvdFNwb3RLTShrbSwgcG9pbnQpIHtcclxuICAgICAgICAgICAgLy92YXIgZHggPSBlbmRbMF0gLSBzdGFydFswXTtcclxuICAgICAgICAgICAgLy92YXIgZHkgPSBlbmRbMV0gLSBzdGFydFsxXTtcclxuICAgICAgICAgICAgLy92YXIgcm90YXRpb24gPSBNYXRoLmF0YW4yKGR5LCBkeCk7XHJcbiAgICAgICAgICAgIHN0eWxlcy5wdXNoKG5ldyBvbC5zdHlsZS5TdHlsZSh7XHJcbiAgICAgICAgICAgICAgICAvL2dlb21ldHJ5OiBuZXcgb2wuZ2VvbS5Qb2ludChbKHN0YXJ0WzBdK2VuZFswXSkvMiwoc3RhcnRbMV0rZW5kWzFdKS8yXSksXHJcbiAgICAgICAgICAgICAgICBnZW9tZXRyeTogbmV3IG9sLmdlb20uUG9pbnQoW3BvaW50WzBdLCBwb2ludFsxXV0pLFxyXG4gICAgICAgICAgICAgICAgaW1hZ2U6IG5ldyBvbC5zdHlsZS5JY29uKHtcclxuICAgICAgICAgICAgICAgICAgICBzcmM6IFwiaW1nL1wiICsga20gKyBcImttLnN2Z1wiLFxyXG4gICAgICAgICAgICAgICAgICAgIHNjYWxlOiAxLjUsXHJcbiAgICAgICAgICAgICAgICAgICAgcm90YXRlV2l0aFZpZXc6IHRydWUsXHJcbiAgICAgICAgICAgICAgICAgICAgLy9yb3RhdGlvbjogLXJvdGF0aW9uICsgTWF0aC5QSS8yLCAvLyBhZGQgMTgwIGRlZ3JlZXNcclxuICAgICAgICAgICAgICAgICAgICBvcGFjaXR5IDogMVxyXG4gICAgICAgICAgICAgICAgfSlcclxuICAgICAgICAgICAgfSkpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgZm9yICh2YXIgaSA9IHN0YXJ0RGlzdEluZGV4OyBpIDwgZW5kRGlzdEluZGV4OyBpKyspIHtcclxuICAgICAgICAgICAgaWYgKCFob3RzcG90c0ttLmxlbmd0aCkge1xyXG5cdFx0XHRcdHJldHVybjtcclxuXHRcdFx0fVxyXG5cclxuXHRcdFx0dmFyIGRpc3QgPSBkaXN0YW5jZXNbaV07XHJcblxyXG5cdFx0XHRpZiAoZGlzdCA+PSBob3RzcG90c0ttWzBdKjEwMDApIHtcclxuXHRcdFx0XHQvLyBkcmF3IHRoZSBmaXJzdCBob3RzcG90IGFuZCBhbnkgbmV4dCBpZiBpdCdzIGNvbnRhaW5lZCBpbiB0aGUgc2FtZSBcImRpc3RhbmNlXCJcclxuXHRcdFx0XHR2YXIgcmVtb3ZlSG90c3BvdEttID0gMDtcclxuXHRcdFx0XHRmb3IgKHZhciBrID0gMCwgbGVuSG90c3BvdHNLbSA9IGhvdHNwb3RzS20ubGVuZ3RoOyBrIDwgbGVuSG90c3BvdHNLbTsgaysrKSB7XHJcblx0XHRcdFx0XHRpZiAoZGlzdCA+PSBob3RzcG90c0ttW2tdKjEwMDApIHtcclxuXHRcdFx0XHRcdFx0YWRkSG90U3BvdEtNKGhvdHNwb3RzS21ba10sIGNvb3Jkc1tpXSk7XHJcblx0XHRcdFx0XHRcdHJlbW92ZUhvdHNwb3RLbSsrO1xyXG5cdFx0XHRcdFx0fSBlbHNlIHtcclxuXHRcdFx0XHRcdFx0YnJlYWs7XHJcblx0XHRcdFx0XHR9XHJcblx0XHRcdFx0fVxyXG5cdFx0XHRcdC8vIHJlbW92ZSBhbGwgdGhlIGFscmVhZHkgZHJhd24gaG90c3BvdHNcclxuXHRcdFx0XHRmb3IgKHZhciBqID0gMDsgaiA8cmVtb3ZlSG90c3BvdEttOyBqKyspIGhvdHNwb3RzS20uc2hpZnQoKTtcclxuXHRcdFx0fVxyXG4gICAgICAgIH1cclxuICAgIH1cclxufTtcclxuXHJcbmZvciAodmFyIGkgaW4gU1RZTEVTKVxyXG5cdGV4cG9ydHNbaV09U1RZTEVTW2ldO1xyXG4iLCJyZXF1aXJlKCdqb29zZScpO1xyXG5yZXF1aXJlKCcuL1BhcnRpY2lwYW50Jyk7XHJcblxyXG52YXIgcmJ1c2ggPSByZXF1aXJlKCdyYnVzaCcpO1xyXG52YXIgQ09ORklHID0gcmVxdWlyZSgnLi9Db25maWcnKTtcclxudmFyIFdHUzg0U1BIRVJFID0gcmVxdWlyZSgnLi9VdGlscycpLldHUzg0U1BIRVJFO1xyXG5cclxuQ2xhc3MoXCJUcmFja1wiLCBcclxue1x0XHJcbiAgICAvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0Ly8gQUxMIENPT1JESU5BVEVTIEFSRSBJTiBXT1JMRCBNRVJDQVRPUlxyXG4gICAgLy8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG4gICAgaGFzOiBcclxuXHR7XHJcbiAgICAgICAgcm91dGUgOiB7XHJcbiAgICAgICAgICAgIGlzOiAgIFwicndcIlxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgZGlzdGFuY2VzIDoge1xyXG4gICAgICAgICAgICBpczogICBcInJ3XCJcclxuICAgICAgICB9LFxyXG4gICAgICAgIGRpc3RhbmNlc0VsYXBzZWQgOiB7XHJcbiAgICAgICAgICAgIGlzOiAgIFwicndcIlxyXG4gICAgICAgIH0sXHJcblx0XHR0b3RhbExlbmd0aCA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCJcclxuXHRcdH0sXHJcblx0XHRwYXJ0aWNpcGFudHMgOiB7XHJcblx0XHRcdGlzOiAgIFwicndcIixcclxuXHRcdFx0aW5pdCA6IFtdXHJcblx0XHR9LFxyXG5cdFx0bW92aW5nQ2FtcyA6IHtcclxuXHRcdFx0aXM6ICAgXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogW11cclxuXHRcdH0sXHJcblx0XHQvLyBpbiBFUFNHIDM4NTdcclxuXHRcdGZlYXR1cmUgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogbnVsbFx0XHRcclxuXHRcdH0sXHJcblx0XHRpc0RpcmVjdGlvbkNvbnN0cmFpbnQgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogZmFsc2VcclxuXHRcdH0sXHJcblx0XHRcclxuXHRcdGRlYnVnUGFydGljaXBhbnQgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogbnVsbFxyXG5cdFx0fSxcclxuXHRcdGJpa2VTdGFydEtNIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IG51bGxcclxuXHRcdH0sXHJcblx0XHRydW5TdGFydEtNIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IG51bGxcclxuXHRcdH0sXHJcblx0XHRsYXBzIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IDFcclxuXHRcdH0sXHJcblx0XHR0b3RhbFBhcnRpY2lwYW50cyA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiA1MFxyXG5cdFx0fSxcclxuXHRcdHJUcmVlIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IHJidXNoKDEwKVxyXG5cdFx0fSxcclxuXHJcblx0XHRpc0FkZGVkSG90U3BvdFN3aW1CaWtlIDoge1xyXG5cdFx0XHRpbml0IDogZmFsc2VcclxuXHRcdH0sXHJcblx0XHRpc0FkZGVkSG90U3BvdEJpa2VSdW4gOiB7XHJcblx0XHRcdGluaXQgOiBmYWxzZVxyXG5cdFx0fVxyXG4gICAgfSxcclxuICAgIC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRtZXRob2RzOiBcclxuXHR7XHRcdFxyXG5cdFx0c2V0Um91dGUgOiBmdW5jdGlvbih2YWwpIHtcclxuXHRcdFx0dGhpcy5yb3V0ZT12YWw7XHJcblx0XHRcdGRlbGV0ZSB0aGlzLl9sZW50bXAxO1xyXG5cdFx0XHRkZWxldGUgdGhpcy5fbGVudG1wMjtcclxuXHRcdH0sXHJcblx0XHRcclxuXHRcdGdldEJvdW5kaW5nQm94IDogZnVuY3Rpb24oKSB7XHJcblx0XHRcdHZhciBtaW54PW51bGwsbWlueT1udWxsLG1heHg9bnVsbCxtYXh5PW51bGw7XHJcblx0XHRcdGZvciAodmFyIGk9MDtpPHRoaXMucm91dGUubGVuZ3RoO2krKylcclxuXHRcdFx0e1xyXG5cdFx0XHRcdHZhciBwPXRoaXMucm91dGVbaV07XHJcblx0XHRcdFx0aWYgKG1pbnggPT0gbnVsbCB8fCBwWzBdIDwgbWlueCkgbWlueD1wWzBdO1xyXG5cdFx0XHRcdGlmIChtYXh4ID09IG51bGwgfHwgcFswXSA+IG1heHgpIG1heHg9cFswXTtcclxuXHRcdFx0XHRpZiAobWlueSA9PSBudWxsIHx8IHBbMV0gPCBtaW55KSBtaW55PXBbMV07XHJcblx0XHRcdFx0aWYgKG1heHkgPT0gbnVsbCB8fCBwWzFdID4gbWF4eSkgbWF4eT1wWzFdO1xyXG5cdFx0XHR9XHJcblx0XHRcdHJldHVybiBbbWlueCxtaW55LG1heHgsbWF4eV07XHJcblx0XHR9LFxyXG5cdFx0XHJcblx0XHQvLyBDQUxMIE9OTFkgT05DRSBPTiBJTklUXHJcblx0XHRnZXRFbGFwc2VkRnJvbVBvaW50IDogZnVuY3Rpb24ocG9pbnQsc3RhcnQpIFxyXG5cdFx0e1xyXG5cdFx0XHR2YXIgcmVzPTAuMDtcclxuXHRcdFx0dmFyIGJyaz1mYWxzZTtcclxuXHRcdFx0dmFyIGNjID0gdGhpcy5yb3V0ZTtcclxuXHRcdFx0aWYgKCFzdGFydClcclxuXHRcdFx0XHRzdGFydD0wO1xyXG5cdFx0XHRmb3IgKHZhciBpPXN0YXJ0O2k8Y2MubGVuZ3RoLTE7aSsrKSBcclxuXHRcdFx0e1xyXG5cdFx0XHRcdHZhciBhID0gY2NbaV07XHJcblx0XHRcdFx0dmFyIGMgPSBjY1tpKzFdO1xyXG5cdFx0XHRcdHZhciBiID0gcG9pbnQ7XHJcblx0XHRcdFx0dmFyIGFjID0gTWF0aC5zcXJ0KChhWzBdLWNbMF0pKihhWzBdLWNbMF0pKyhhWzFdLWNbMV0pKihhWzFdLWNbMV0pKTtcclxuXHRcdFx0XHR2YXIgYmEgPSBNYXRoLnNxcnQoKGJbMF0tYVswXSkqKGJbMF0tYVswXSkrKGJbMV0tYVsxXSkqKGJbMV0tYVsxXSkpO1xyXG5cdFx0XHRcdHZhciBiYyA9IE1hdGguc3FydCgoYlswXS1jWzBdKSooYlswXS1jWzBdKSsoYlsxXS1jWzFdKSooYlsxXS1jWzFdKSk7XHJcblx0XHRcdFx0XHJcblx0XHRcdFx0dmFyIG1pbnggPSBhWzBdIDwgYlswXSA/IGFbMF0gOiBiWzBdO1xyXG5cdFx0XHRcdHZhciBtaW55ID0gYVsxXSA8IGJbMV0gPyBhWzFdIDogYlsxXTtcclxuXHRcdFx0XHR2YXIgbWF4eCA9IGFbMF0gPiBiWzBdID8gYVswXSA6IGJbMF07XHJcblx0XHRcdFx0dmFyIG1heHkgPSBhWzFdID4gYlsxXSA/IGFbMV0gOiBiWzFdO1xyXG5cdFx0XHRcdC8vIGJhID4gYWMgT1IgYmMgPiBhY1xyXG5cdFx0XHRcdGlmIChiWzBdIDwgbWlueCB8fCBiWzBdID4gbWF4eCB8fCBiWzFdIDwgbWlueSB8fCBiWzFdID4gbWF4eSB8fCBiYSA+IGFjIHx8IGJjID4gYWMpIFxyXG5cdFx0XHRcdHtcclxuXHRcdFx0XHRcdHJlcys9V0dTODRTUEhFUkUuaGF2ZXJzaW5lRGlzdGFuY2UoYSxjKTtcclxuXHRcdFx0XHRcdGNvbnRpbnVlO1xyXG5cdFx0XHRcdH1cclxuXHRcdFx0XHRyZXMrPVdHUzg0U1BIRVJFLmhhdmVyc2luZURpc3RhbmNlKGEsYik7XHJcblx0XHRcdFx0YnJlYWs7XHJcblx0XHRcdH1cclxuXHRcdFx0dmFyIGxlbiA9IHRoaXMuZ2V0VHJhY2tMZW5ndGgoKTtcclxuXHRcdFx0cmV0dXJuIHJlcy9sZW47XHJcblx0XHR9LFxyXG5cdFx0XHJcblx0XHQvLyBlbGFwc2VkIGZyb20gMC4uMVxyXG5cdFx0Z2V0UG9zaXRpb25BbmRSb3RhdGlvbkZyb21FbGFwc2VkIDogZnVuY3Rpb24oZWxhcHNlZCkge1xyXG5cdFx0XHR2YXIgcnI9bnVsbDtcclxuXHRcdFx0dmFyIGNjID0gdGhpcy5yb3V0ZTtcclxuXHRcdFx0XHJcblx0XHRcdHZhciBsbCA9IHRoaXMuZGlzdGFuY2VzRWxhcHNlZC5sZW5ndGgtMTtcclxuXHRcdFx0dmFyIHNpID0gMDtcclxuXHJcblx0XHRcdC8vIFRPRE8gRklYIE1FIFxyXG5cdFx0XHR3aGlsZSAoc2kgPCBsbCAmJiBzaSs1MDAgPCBsbCAmJiB0aGlzLmRpc3RhbmNlc0VsYXBzZWRbc2krNTAwXSA8IGVsYXBzZWQgKSB7XHJcblx0XHRcdFx0c2krPTUwMDtcclxuXHRcdFx0fVxyXG5cdFx0XHRcclxuXHRcdFx0d2hpbGUgKHNpIDwgbGwgJiYgc2krMjUwIDwgbGwgJiYgdGhpcy5kaXN0YW5jZXNFbGFwc2VkW3NpKzI1MF0gPCBlbGFwc2VkICkge1xyXG5cdFx0XHRcdHNpKz0yNTA7XHJcblx0XHRcdH1cclxuXHRcdFx0XHJcblx0XHRcdHdoaWxlIChzaSA8IGxsICYmIHNpKzEyNSA8IGxsICYmIHRoaXMuZGlzdGFuY2VzRWxhcHNlZFtzaSsxMjVdIDwgZWxhcHNlZCApIHtcclxuXHRcdFx0XHRzaSs9MTI1O1xyXG5cdFx0XHR9XHJcblxyXG5cdFx0XHR3aGlsZSAoc2kgPCBsbCAmJiBzaSs1MCA8IGxsICYmIHRoaXMuZGlzdGFuY2VzRWxhcHNlZFtzaSs1MF0gPCBlbGFwc2VkICkge1xyXG5cdFx0XHRcdHNpKz01MDtcclxuXHRcdFx0fVxyXG5cdFx0XHRcclxuXHRcdFx0Zm9yICh2YXIgaT1zaTtpPGxsO2krKykgXHJcblx0XHRcdHtcclxuXHRcdFx0XHQvKmRvIFxyXG5cdFx0XHRcdHtcclxuXHRcdFx0XHRcdHZhciBtID0gKChjYy5sZW5ndGgtMStpKSA+PiAxKTtcclxuXHRcdFx0XHRcdGlmIChtLWkgPiA1ICYmIGVsYXBzZWQgPCB0aGlzLmRpc3RhbmNlc0VsYXBzZWRbbV0pIHtcclxuXHRcdFx0XHRcdFx0aT1tO1xyXG5cdFx0XHRcdFx0XHRjb250aW51ZTtcclxuXHRcdFx0XHRcdH1cclxuXHRcdFx0XHRcdGJyZWFrO1xyXG5cdFx0XHRcdH0gd2hpbGUgKHRydWUpOyovXHJcblx0XHRcdFx0aWYgKGVsYXBzZWQgPj0gdGhpcy5kaXN0YW5jZXNFbGFwc2VkW2ldICYmIGVsYXBzZWQgPD0gdGhpcy5kaXN0YW5jZXNFbGFwc2VkW2krMV0pIFxyXG5cdFx0XHRcdHtcclxuXHRcdFx0XHRcdGVsYXBzZWQtPXRoaXMuZGlzdGFuY2VzRWxhcHNlZFtpXTtcclxuXHRcdFx0XHRcdHZhciBhYz10aGlzLmRpc3RhbmNlc0VsYXBzZWRbaSsxXS10aGlzLmRpc3RhbmNlc0VsYXBzZWRbaV07XHJcblx0XHRcdFx0XHR2YXIgYSA9IGNjW2ldO1xyXG5cdFx0XHRcdFx0dmFyIGMgPSBjY1tpKzFdO1xyXG5cdFx0XHRcdFx0dmFyIGR4ID0gY1swXSAtIGFbMF07XHJcblx0XHRcdFx0XHR2YXIgZHkgPSBjWzFdIC0gYVsxXTtcclxuXHRcdFx0XHRcdHJyPVsgYVswXSsoY1swXS1hWzBdKSplbGFwc2VkL2FjLGFbMV0rKGNbMV0tYVsxXSkqZWxhcHNlZC9hYyxNYXRoLmF0YW4yKGR5LCBkeCldO1xyXG5cdFx0XHRcdFx0YnJlYWs7XHJcblx0XHRcdFx0fVxyXG5cdFx0XHR9XHJcblx0XHRcdHJldHVybiBycjtcclxuXHRcdH0sXHJcblx0XHRcclxuXHRcdF9fZ2V0UG9zaXRpb25BbmRSb3RhdGlvbkZyb21FbGFwc2VkIDogZnVuY3Rpb24oZWxhcHNlZCkge1xyXG5cdFx0XHRlbGFwc2VkKj10aGlzLmdldFRyYWNrTGVuZ3RoKCk7XHJcblx0XHRcdHZhciBycj1udWxsO1xyXG5cdFx0XHR2YXIgY2MgPSB0aGlzLnJvdXRlO1xyXG5cdFx0XHRmb3IgKHZhciBpPTA7aTxjYy5sZW5ndGgtMTtpKyspIFxyXG5cdFx0XHR7XHJcblx0XHRcdFx0dmFyIGEgPSBjY1tpXTtcclxuXHRcdFx0XHR2YXIgYyA9IGNjW2krMV07XHJcblx0XHRcdFx0dmFyIGFjID0gV0dTODRTUEhFUkUuaGF2ZXJzaW5lRGlzdGFuY2UoYSxjKTtcclxuXHRcdFx0XHRpZiAoZWxhcHNlZCA8PSBhYykge1xyXG5cdFx0XHRcdFx0dmFyIGR4ID0gY1swXSAtIGFbMF07XHJcblx0XHRcdFx0XHR2YXIgZHkgPSBjWzFdIC0gYVsxXTtcclxuXHRcdFx0XHRcdHJyPVsgYVswXSsoY1swXS1hWzBdKSplbGFwc2VkL2FjLGFbMV0rKGNbMV0tYVsxXSkqZWxhcHNlZC9hYyxNYXRoLmF0YW4yKGR5LCBkeCldO1xyXG5cdFx0XHRcdFx0YnJlYWs7XHJcblx0XHRcdFx0fVxyXG5cdFx0XHRcdGVsYXBzZWQtPWFjO1xyXG5cdFx0XHR9XHJcblx0XHRcdHJldHVybiBycjtcclxuXHRcdH0sXHJcblxyXG5cdFx0XHJcblx0XHRnZXRUcmFja0xlbmd0aCA6IGZ1bmN0aW9uKCkge1xyXG5cdFx0XHRpZiAodGhpcy5fbGVudG1wMSlcclxuXHRcdFx0XHRyZXR1cm4gdGhpcy5fbGVudG1wMTtcclxuXHRcdFx0dmFyIHJlcz0wLjA7XHJcblx0XHRcdHZhciBjYyA9IHRoaXMucm91dGU7XHJcblx0XHRcdGZvciAodmFyIGk9MDtpPGNjLmxlbmd0aC0xO2krKykgXHJcblx0XHRcdHtcclxuXHRcdFx0XHR2YXIgYSA9IGNjW2ldO1xyXG5cdFx0XHRcdHZhciBiID0gY2NbaSsxXTtcclxuXHRcdFx0XHR2YXIgZCA9IFdHUzg0U1BIRVJFLmhhdmVyc2luZURpc3RhbmNlKGEsYik7XHJcblx0XHRcdFx0aWYgKCFpc05hTihkKSAmJiBkID4gMCkgXHJcblx0XHRcdFx0XHRyZXMrPWQ7XHJcblx0XHRcdH1cclxuXHRcdFx0dGhpcy5fbGVudG1wMT1yZXM7XHJcblx0XHRcdHJldHVybiByZXM7XHJcblx0XHR9LFxyXG5cclxuXHRcdGdldFRyYWNrTGVuZ3RoSW5XR1M4NCA6IGZ1bmN0aW9uKCkge1xyXG5cdFx0XHRpZiAodGhpcy5fbGVudG1wMilcclxuXHRcdFx0XHRyZXR1cm4gdGhpcy5fbGVudG1wMjtcclxuXHRcdFx0dmFyIHJlcz0wLjA7XHJcblx0XHRcdHZhciBjYyA9IHRoaXMucm91dGU7XHJcblx0XHRcdGZvciAodmFyIGk9MDtpPGNjLmxlbmd0aC0xO2krKykgXHJcblx0XHRcdHtcclxuXHRcdFx0XHR2YXIgYSA9IGNjW2ldO1xyXG5cdFx0XHRcdHZhciBiID0gY2NbaSsxXTtcclxuXHRcdFx0XHR2YXIgZCA9IE1hdGguc3FydCgoYVswXS1iWzBdKSooYVswXS1iWzBdKSsoYVsxXS1iWzFdKSooYVsxXS1iWzFdKSk7XHJcblx0XHRcdFx0aWYgKCFpc05hTihkKSAmJiBkID4gMCkgXHJcblx0XHRcdFx0XHRyZXMrPWQ7XHJcblx0XHRcdH1cclxuXHRcdFx0dGhpcy5fbGVudG1wMj1yZXM7XHJcblx0XHRcdHJldHVybiByZXM7XHJcblx0XHR9LFxyXG5cclxuXHRcdGdldENlbnRlciA6IGZ1bmN0aW9uKCkge1xyXG5cdFx0XHR2YXIgYmIgPSB0aGlzLmdldEJvdW5kaW5nQm94KCk7XHJcblx0XHRcdHJldHVybiBbKGJiWzBdK2JiWzJdKS8yLjAsKGJiWzFdK2JiWzNdKS8yLjBdO1xyXG5cdFx0fSxcclxuXHRcdFxyXG5cdFx0aW5pdCA6IGZ1bmN0aW9uKCkgXHJcblx0XHR7XHJcblx0XHRcdGlmICghdGhpcy5yb3V0ZSlcclxuXHRcdFx0XHRyZXR1cm47XHJcblx0XHRcdC8vIDEpIGNhbGN1bGF0ZSB0b3RhbCByb3V0ZSBsZW5ndGggaW4gS00gXHJcblx0XHRcdHRoaXMudXBkYXRlRmVhdHVyZSgpO1xyXG5cdFx0XHRpZiAodHlwZW9mIHdpbmRvdyAhPSBcInVuZGVmaW5lZFwiKSBcclxuXHRcdFx0XHRHVUkubWFwLmdldFZpZXcoKS5maXRFeHRlbnQodGhpcy5mZWF0dXJlLmdldEdlb21ldHJ5KCkuZ2V0RXh0ZW50KCksIEdVSS5tYXAuZ2V0U2l6ZSgpKTtcclxuXHRcdH0sXHJcblx0XHRcclxuXHRcdGdldFRyYWNrUGFydCA6IGZ1bmN0aW9uKGVsYXBzZWQpIHtcclxuXHRcdFx0dmFyIGxlbiA9IHRoaXMuZ2V0VHJhY2tMZW5ndGgoKTtcclxuXHRcdFx0dmFyIGVtID0gKGVsYXBzZWQlMS4wKSpsZW47XHJcblx0XHRcdGlmIChlbSA+PSB0aGlzLnJ1blN0YXJ0S00qMTAwMCkgXHJcblx0XHRcdFx0cmV0dXJuIDI7XHJcblx0XHRcdGlmIChlbSA+PSB0aGlzLmJpa2VTdGFydEtNKjEwMDApIFxyXG5cdFx0XHRcdHJldHVybiAxO1xyXG5cdFx0XHRyZXR1cm4gMDtcclxuXHRcdH0sXHJcblx0XHRcclxuXHRcdHVwZGF0ZUZlYXR1cmUgOiBmdW5jdGlvbigpIFxyXG5cdFx0e1xyXG5cdFx0XHR0aGlzLmRpc3RhbmNlcz1bXTtcclxuXHRcdFx0dmFyIHJlcz0wLjA7XHJcblx0XHRcdHZhciBjYyA9IHRoaXMucm91dGU7XHJcblx0XHRcdGZvciAodmFyIGk9MDtpPGNjLmxlbmd0aC0xO2krKykgXHJcblx0XHRcdHtcclxuXHRcdFx0XHR2YXIgYSA9IGNjW2ldO1xyXG5cdFx0XHRcdHZhciBiID0gY2NbaSsxXTtcclxuXHRcdFx0XHR2YXIgZCA9IFdHUzg0U1BIRVJFLmhhdmVyc2luZURpc3RhbmNlKGEsYik7XHJcblx0XHRcdFx0dGhpcy5kaXN0YW5jZXMucHVzaChyZXMpO1xyXG5cdFx0XHRcdGlmICghaXNOYU4oZCkgJiYgZCA+IDApIFxyXG5cdFx0XHRcdFx0cmVzKz1kO1xyXG5cdFx0XHR9XHJcblx0XHRcdHRoaXMuZGlzdGFuY2VzLnB1c2gocmVzKTtcclxuXHRcdFx0dGhpcy5kaXN0YW5jZXNFbGFwc2VkPVtdO1xyXG5cdFx0XHR2YXIgdGwgPSB0aGlzLmdldFRyYWNrTGVuZ3RoKCk7XHJcblx0XHRcdGZvciAodmFyIGk9MDtpPGNjLmxlbmd0aDtpKyspIHtcclxuXHRcdFx0XHR0aGlzLmRpc3RhbmNlc0VsYXBzZWQucHVzaCh0aGlzLmRpc3RhbmNlc1tpXS90bCk7XHJcblx0XHRcdH1cclxuXHRcdFx0Ly8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdFx0XHR0aGlzLnJUcmVlLmNsZWFyKCk7XHJcblx0XHRcdHZhciBhcnIgPSBbXTtcclxuXHRcdFx0Zm9yICh2YXIgaT0wO2k8dGhpcy5yb3V0ZS5sZW5ndGgtMTtpKyspIFxyXG5cdFx0XHR7XHJcblx0XHRcdFx0dmFyIHgxID0gdGhpcy5yb3V0ZVtpXVswXTtcclxuXHRcdFx0XHR2YXIgeTEgPSB0aGlzLnJvdXRlW2ldWzFdO1xyXG5cdFx0XHRcdHZhciB4MiA9IHRoaXMucm91dGVbaSsxXVswXTtcclxuXHRcdFx0XHR2YXIgeTIgPSB0aGlzLnJvdXRlW2krMV1bMV07XHJcblx0XHRcdFx0dmFyIG1pbnggPSB4MSA8IHgyID8geDEgOiB4MjtcclxuXHRcdFx0XHR2YXIgbWlueSA9IHkxIDwgeTIgPyB5MSA6IHkyO1xyXG5cdFx0XHRcdHZhciBtYXh4ID0geDEgPiB4MiA/IHgxIDogeDI7XHJcblx0XHRcdFx0dmFyIG1heHkgPSB5MSA+IHkyID8geTEgOiB5MjtcclxuXHRcdFx0XHRhcnIucHVzaChbbWlueCxtaW55LG1heHgsbWF4eSx7IGluZGV4IDogaSB9XSk7XHJcblx0XHRcdH1cclxuXHRcdFx0dGhpcy5yVHJlZS5sb2FkKGFycik7XHJcblx0XHRcdC8vLS0tLS0tLS0tLS0tLS0tLS0gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0XHRcdGlmICh0eXBlb2Ygd2luZG93ICE9IFwidW5kZWZpbmVkXCIpIFxyXG5cdFx0XHR7XHJcblx0XHRcdFx0dmFyIHdrdCA9IFtdO1xyXG5cdFx0XHRcdGZvciAodmFyIGk9MDtpPHRoaXMucm91dGUubGVuZ3RoO2krKykge1xyXG5cdFx0XHRcdFx0d2t0LnB1c2godGhpcy5yb3V0ZVtpXVswXStcIiBcIit0aGlzLnJvdXRlW2ldWzFdKTtcclxuXHRcdFx0XHR9XHJcblx0XHRcdFx0d2t0PVwiTElORVNUUklORyhcIit3a3Quam9pbihcIixcIikrXCIpXCI7XHJcblx0XHRcdFx0dmFyIGZvcm1hdCA9IG5ldyBvbC5mb3JtYXQuV0tUKCk7XHJcblx0XHRcdFx0aWYgKCF0aGlzLmZlYXR1cmUpIHtcclxuXHRcdFx0XHRcdHRoaXMuZmVhdHVyZSA9IGZvcm1hdC5yZWFkRmVhdHVyZSh3a3QpO1xyXG5cdFx0XHRcdH0gZWxzZSB7XHJcblx0XHRcdFx0XHR0aGlzLmZlYXR1cmUuc2V0R2VvbWV0cnkoZm9ybWF0LnJlYWRGZWF0dXJlKHdrdCkuZ2V0R2VvbWV0cnkoKSk7XHJcblx0XHRcdFx0fVxyXG5cdFx0XHRcdHRoaXMuZmVhdHVyZS50cmFjaz10aGlzO1xyXG5cdFx0XHRcdHRoaXMuZmVhdHVyZS5nZXRHZW9tZXRyeSgpLnRyYW5zZm9ybSgnRVBTRzo0MzI2JywgJ0VQU0c6Mzg1NycpO1x0XHRcdFx0XHRcdFxyXG5cdFx0XHR9XHJcblx0XHR9LFxyXG5cdFx0XHJcblx0XHRuZXdQYXJ0aWNpcGFudCA6IGZ1bmN0aW9uKGlkLGRldmljZUlkLG5hbWUpXHJcblx0XHR7XHJcblx0XHRcdHZhciBwYXJ0ID0gbmV3IFBhcnRpY2lwYW50KHtpZDppZCxkZXZpY2VJZDpkZXZpY2VJZCxjb2RlOm5hbWV9KTtcclxuXHRcdFx0cGFydC5pbml0KHRoaXMucm91dGVbMF0sdGhpcyk7XHJcblx0XHRcdHBhcnQuc2V0U2VxSWQodGhpcy5wYXJ0aWNpcGFudHMubGVuZ3RoKTtcclxuXHRcdFx0dGhpcy5wYXJ0aWNpcGFudHMucHVzaChwYXJ0KTtcclxuXHRcdFx0cmV0dXJuIHBhcnQ7XHJcblx0XHR9LFxyXG5cclxuXHRcdG5ld01vdmluZ0NhbSA6IGZ1bmN0aW9uKGlkLGRldmljZUlkLG5hbWUsc2VxSWQpXHJcblx0XHR7XHJcblx0XHRcdHZhciBjYW0gPSBuZXcgTW92aW5nQ2FtKHtpZDppZCxkZXZpY2VJZDpkZXZpY2VJZCxjb2RlOm5hbWV9KTtcclxuXHRcdFx0Y2FtLmluaXQodGhpcy5yb3V0ZVswXSx0aGlzKTtcclxuXHRcdFx0Y2FtLnNldFNlcUlkKHNlcUlkKTtcclxuXHRcdFx0dGhpcy5wYXJ0aWNpcGFudHMucHVzaChjYW0pO1xyXG5cdFx0XHRyZXR1cm4gY2FtO1xyXG5cdFx0fSxcclxuXHJcblx0XHRuZXdIb3RTcG90cyA6IGZ1bmN0aW9uKGhvdHNwb3RzKSB7XHJcblx0XHRcdGlmICghaG90c3BvdHMgfHwgIWhvdHNwb3RzLmxlbmd0aCkge1xyXG5cdFx0XHRcdHJldHVybjtcclxuXHRcdFx0fVxyXG5cclxuXHRcdFx0Ly8gVE9ETyBSdW1lbiAtIHRoaXMgaXMgQ09QWS1QQVNURSBjb2RlIGZvcm0gdGhlIFN0eWxlc1xyXG5cdFx0XHQvLyBzbyBsYXRlciBpdCBoYXMgdG8gYmUgaW4gb25seSBvbmUgcGxhY2UgLSBnZXR0aW5nIHRoZSBnZW9tZXRyaWVzIGZvciBlYWNoIHR5cGUgZGlzdGFuY2VcclxuXHRcdFx0Ly8gbWF5YmUgaW4gdGhlIHNhbWUgcGxhY2UgZGlzdGFuY2VzIGFyZSBjYWxjdWxhdGVkLlxyXG5cdFx0XHQvLyBUSElTIElTIFRFTVBPUkFSWSBQQVRDSCB0byBnZXQgdGhlIG5lZWRlZCBwb2ludHNcclxuXHRcdFx0aWYgKCFpc05hTih0aGlzLmJpa2VTdGFydEtNKSkge1xyXG5cdFx0XHRcdGZvciAodmFyIGk9MDtpPHRoaXMuZGlzdGFuY2VzLmxlbmd0aDtpKyspIHtcclxuXHRcdFx0XHRcdGlmICh0aGlzLmRpc3RhbmNlc1tpXSA+PSB0aGlzLmJpa2VTdGFydEtNKjEwMDApXHJcblx0XHRcdFx0XHRcdGJyZWFrO1xyXG5cdFx0XHRcdH1cclxuXHRcdFx0XHR2YXIgajtcclxuXHRcdFx0XHRpZiAoIWlzTmFOKHRoaXMucnVuU3RhcnRLTSkpIHtcclxuXHRcdFx0XHRcdGZvciAoaj1pO2o8dGhpcy5kaXN0YW5jZXMubGVuZ3RoO2orKykge1xyXG5cdFx0XHRcdFx0XHRpZiAodGhpcy5kaXN0YW5jZXNbal0gPj0gdGhpcy5ydW5TdGFydEtNKjEwMDApXHJcblx0XHRcdFx0XHRcdFx0YnJlYWs7XHJcblx0XHRcdFx0XHR9XHJcblx0XHRcdFx0fSBlbHNlIHtcclxuXHRcdFx0XHRcdGo9dGhpcy5kaXN0YW5jZXMubGVuZ3RoO1xyXG5cdFx0XHRcdH1cclxuXHRcdFx0XHR2YXIgY29vcmRzPXRoaXMuZmVhdHVyZS5nZXRHZW9tZXRyeSgpLmdldENvb3JkaW5hdGVzKCk7XHJcblx0XHRcdFx0dmFyIGdlb21zd2ltPWNvb3Jkcy5zbGljZSgwLGkpO1xyXG5cdFx0XHRcdHZhciBnZW9tYmlrZT1jb29yZHMuc2xpY2UoaSA8IDEgPyBpIDogaS0xLGopO1xyXG5cdFx0XHRcdGlmIChqIDwgdGhpcy5kaXN0YW5jZXMubGVuZ3RoKVxyXG5cdFx0XHRcdFx0dmFyIGdlb21ydW49Y29vcmRzLnNsaWNlKGogPCAxID8gaiA6IGotMSx0aGlzLmRpc3RhbmNlcy5sZW5ndGgpO1xyXG5cdFx0XHRcdGlmICghZ2VvbXN3aW0ubGVuZ3RoKVxyXG5cdFx0XHRcdFx0Z2VvbXN3aW09bnVsbDtcclxuXHRcdFx0XHRpZiAoIWdlb21iaWtlLmxlbmd0aClcclxuXHRcdFx0XHRcdGdlb21iaWtlPW51bGw7XHJcblx0XHRcdFx0aWYgKCFnZW9tcnVuLmxlbmd0aClcclxuXHRcdFx0XHRcdGdlb21ydW49bnVsbDtcclxuXHRcdFx0fVxyXG5cclxuXHRcdFx0Zm9yICh2YXIgaSA9IDAsIGxlbiA9IGhvdHNwb3RzLmxlbmd0aDsgaSA8IGxlbjsgaSsrKSB7XHJcblx0XHRcdFx0dmFyIGhvdHNwb3QgPSBob3RzcG90c1tpXTtcclxuXHRcdFx0XHR2YXIgcG9pbnQ7XHJcblx0XHRcdFx0aWYgKGhvdHNwb3QudHlwZSA9PT0gQ09ORklHLmhvdHNwb3QuY2FtU3dpbUJpa2UpIHtcclxuXHRcdFx0XHRcdGlmICh0aGlzLmlzQWRkZWRIb3RTcG90U3dpbUJpa2UpIGNvbnRpbnVlOyAvLyBub3QgYWxsb3dlZCB0byBhZGQgdG8gc2FtZSBob3RzcG90c1xyXG5cdFx0XHRcdFx0aWYgKGdlb21iaWtlKSB7XHJcblx0XHRcdFx0XHRcdHBvaW50ID0gb2wucHJvai50cmFuc2Zvcm0oZ2VvbWJpa2VbMF0sICdFUFNHOjM4NTcnLCAnRVBTRzo0MzI2Jyk7XHJcblx0XHRcdFx0XHRcdHRoaXMuaXNBZGRlZEhvdFNwb3RTd2ltQmlrZSA9IHRydWU7XHJcblx0XHRcdFx0XHR9XHJcblx0XHRcdFx0fSBlbHNlIGlmIChob3RzcG90LnR5cGUgPT09IENPTkZJRy5ob3RzcG90LmNhbUJpa2VSdW4pIHtcclxuXHRcdFx0XHRcdGlmICh0aGlzLmlzQWRkZWRIb3RTcG90QmlrZVJ1bikgY29udGludWU7IC8vIG5vdCBhbGxvd2VkIHRvIGFkZCB0byBzYW1lIGhvdHNwb3RzXHJcblx0XHRcdFx0XHRpZiAoZ2VvbXJ1bikge1xyXG5cdFx0XHRcdFx0XHRwb2ludCA9IG9sLnByb2oudHJhbnNmb3JtKGdlb21ydW5bMF0sICdFUFNHOjM4NTcnLCAnRVBTRzo0MzI2Jyk7XHJcblx0XHRcdFx0XHRcdHRoaXMuaXNBZGRlZEhvdFNwb3RCaWtlUnVuID0gdHJ1ZTtcclxuXHRcdFx0XHRcdH1cclxuXHRcdFx0XHR9XHJcblx0XHRcdFx0aWYgKHBvaW50KVxyXG5cdFx0XHRcdFx0aG90c3BvdC5pbml0KHBvaW50KTtcclxuXHRcdFx0fVxyXG5cdFx0fSxcclxuXHRcdFxyXG5cdFx0b25NYXBDbGljayA6IGZ1bmN0aW9uKGV2ZW50KSBcclxuXHRcdHtcclxuXHRcdFx0aWYgKHRoaXMuZGVidWdQYXJ0aWNpcGFudCkgXHJcblx0XHRcdHtcclxuXHRcdFx0XHR0aGlzLmRlYnVnUGFydGljaXBhbnQub25EZWJ1Z0NsaWNrKGV2ZW50KTtcclxuXHRcdFx0fVxyXG5cdFx0fVxyXG5cclxuICAgIH1cclxufSk7IiwidmFyIHRvUmFkaWFucyA9IGZ1bmN0aW9uKGFuZ2xlRGVncmVlcykgeyByZXR1cm4gYW5nbGVEZWdyZWVzICogTWF0aC5QSSAvIDE4MDsgfTtcclxudmFyIHRvRGVncmVlcyA9IGZ1bmN0aW9uKGFuZ2xlUmFkaWFucykgeyByZXR1cm4gYW5nbGVSYWRpYW5zICogMTgwIC8gTWF0aC5QSTsgfTtcclxuXHJcbnZhciBXR1M4NFNwaGVyZSA9IGZ1bmN0aW9uKHJhZGl1cykge1xyXG4gIHRoaXMucmFkaXVzID0gcmFkaXVzO1xyXG59O1xyXG5cclxuV0dTODRTcGhlcmUucHJvdG90eXBlLmNvc2luZURpc3RhbmNlID0gZnVuY3Rpb24oYzEsIGMyKSB7XHJcbiAgdmFyIGxhdDEgPSB0b1JhZGlhbnMoYzFbMV0pO1xyXG4gIHZhciBsYXQyID0gdG9SYWRpYW5zKGMyWzFdKTtcclxuICB2YXIgZGVsdGFMb24gPSB0b1JhZGlhbnMoYzJbMF0gLSBjMVswXSk7XHJcbiAgcmV0dXJuIHRoaXMucmFkaXVzICogTWF0aC5hY29zKFxyXG4gICAgICBNYXRoLnNpbihsYXQxKSAqIE1hdGguc2luKGxhdDIpICtcclxuICAgICAgTWF0aC5jb3MobGF0MSkgKiBNYXRoLmNvcyhsYXQyKSAqIE1hdGguY29zKGRlbHRhTG9uKSk7XHJcbn07XHJcblxyXG5XR1M4NFNwaGVyZS5wcm90b3R5cGUuZ2VvZGVzaWNBcmVhID0gZnVuY3Rpb24oY29vcmRpbmF0ZXMpIHtcclxuICB2YXIgYXJlYSA9IDAsIGxlbiA9IGNvb3JkaW5hdGVzLmxlbmd0aDtcclxuICB2YXIgeDEgPSBjb29yZGluYXRlc1tsZW4gLSAxXVswXTtcclxuICB2YXIgeTEgPSBjb29yZGluYXRlc1tsZW4gLSAxXVsxXTtcclxuICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbjsgaSsrKSB7XHJcbiAgICB2YXIgeDIgPSBjb29yZGluYXRlc1tpXVswXSwgeTIgPSBjb29yZGluYXRlc1tpXVsxXTtcclxuICAgIGFyZWEgKz0gdG9SYWRpYW5zKHgyIC0geDEpICpcclxuICAgICAgICAoMiArIE1hdGguc2luKHRvUmFkaWFucyh5MSkpICtcclxuICAgICAgICBNYXRoLnNpbih0b1JhZGlhbnMoeTIpKSk7XHJcbiAgICB4MSA9IHgyO1xyXG4gICAgeTEgPSB5MjtcclxuICB9XHJcbiAgcmV0dXJuIGFyZWEgKiB0aGlzLnJhZGl1cyAqIHRoaXMucmFkaXVzIC8gMi4wO1xyXG59O1xyXG5cclxuV0dTODRTcGhlcmUucHJvdG90eXBlLmNyb3NzVHJhY2tEaXN0YW5jZSA9IGZ1bmN0aW9uKGMxLCBjMiwgYzMpIHtcclxuICB2YXIgZDEzID0gdGhpcy5jb3NpbmVEaXN0YW5jZShjMSwgYzIpO1xyXG4gIHZhciB0aGV0YTEyID0gdG9SYWRpYW5zKHRoaXMuaW5pdGlhbEJlYXJpbmcoYzEsIGMyKSk7XHJcbiAgdmFyIHRoZXRhMTMgPSB0b1JhZGlhbnModGhpcy5pbml0aWFsQmVhcmluZyhjMSwgYzMpKTtcclxuICByZXR1cm4gdGhpcy5yYWRpdXMgKlxyXG4gICAgICBNYXRoLmFzaW4oTWF0aC5zaW4oZDEzIC8gdGhpcy5yYWRpdXMpICogTWF0aC5zaW4odGhldGExMyAtIHRoZXRhMTIpKTtcclxufTtcclxuXHJcbldHUzg0U3BoZXJlLnByb3RvdHlwZS5lcXVpcmVjdGFuZ3VsYXJEaXN0YW5jZSA9IGZ1bmN0aW9uKGMxLCBjMikge1xyXG4gIHZhciBsYXQxID0gdG9SYWRpYW5zKGMxWzFdKTtcclxuICB2YXIgbGF0MiA9IHRvUmFkaWFucyhjMlsxXSk7XHJcbiAgdmFyIGRlbHRhTG9uID0gdG9SYWRpYW5zKGMyWzBdIC0gYzFbMF0pO1xyXG4gIHZhciB4ID0gZGVsdGFMb24gKiBNYXRoLmNvcygobGF0MSArIGxhdDIpIC8gMik7XHJcbiAgdmFyIHkgPSBsYXQyIC0gbGF0MTtcclxuICByZXR1cm4gdGhpcy5yYWRpdXMgKiBNYXRoLnNxcnQoeCAqIHggKyB5ICogeSk7XHJcbn07XHJcblxyXG5XR1M4NFNwaGVyZS5wcm90b3R5cGUuZmluYWxCZWFyaW5nID0gZnVuY3Rpb24oYzEsIGMyKSB7XHJcbiAgcmV0dXJuICh0aGlzLmluaXRpYWxCZWFyaW5nKGMyLCBjMSkgKyAxODApICUgMzYwO1xyXG59O1xyXG5cclxuV0dTODRTcGhlcmUucHJvdG90eXBlLmhhdmVyc2luZURpc3RhbmNlID0gZnVuY3Rpb24oYzEsIGMyKSB7XHJcbiAgdmFyIGxhdDEgPSB0b1JhZGlhbnMoYzFbMV0pO1xyXG4gIHZhciBsYXQyID0gdG9SYWRpYW5zKGMyWzFdKTtcclxuICB2YXIgZGVsdGFMYXRCeTIgPSAobGF0MiAtIGxhdDEpIC8gMjtcclxuICB2YXIgZGVsdGFMb25CeTIgPSB0b1JhZGlhbnMoYzJbMF0gLSBjMVswXSkgLyAyO1xyXG4gIHZhciBhID0gTWF0aC5zaW4oZGVsdGFMYXRCeTIpICogTWF0aC5zaW4oZGVsdGFMYXRCeTIpICtcclxuICAgICAgTWF0aC5zaW4oZGVsdGFMb25CeTIpICogTWF0aC5zaW4oZGVsdGFMb25CeTIpICpcclxuICAgICAgTWF0aC5jb3MobGF0MSkgKiBNYXRoLmNvcyhsYXQyKTtcclxuICByZXR1cm4gMiAqIHRoaXMucmFkaXVzICogTWF0aC5hdGFuMihNYXRoLnNxcnQoYSksIE1hdGguc3FydCgxIC0gYSkpO1xyXG59O1xyXG5cclxuV0dTODRTcGhlcmUucHJvdG90eXBlLmludGVycG9sYXRlID0gZnVuY3Rpb24oYzEsIGMyLCBmcmFjdGlvbikge1xyXG4gIHZhciBsYXQxID0gdG9SYWRpYW5zKGMxWzFdKTtcclxuICB2YXIgbG9uMSA9IHRvUmFkaWFucyhjMVswXSk7XHJcbiAgdmFyIGxhdDIgPSB0b1JhZGlhbnMoYzJbMV0pO1xyXG4gIHZhciBsb24yID0gdG9SYWRpYW5zKGMyWzBdKTtcclxuICB2YXIgY29zTGF0MSA9IE1hdGguY29zKGxhdDEpO1xyXG4gIHZhciBzaW5MYXQxID0gTWF0aC5zaW4obGF0MSk7XHJcbiAgdmFyIGNvc0xhdDIgPSBNYXRoLmNvcyhsYXQyKTtcclxuICB2YXIgc2luTGF0MiA9IE1hdGguc2luKGxhdDIpO1xyXG4gIHZhciBjb3NEZWx0YUxvbiA9IE1hdGguY29zKGxvbjIgLSBsb24xKTtcclxuICB2YXIgZCA9IHNpbkxhdDEgKiBzaW5MYXQyICsgY29zTGF0MSAqIGNvc0xhdDIgKiBjb3NEZWx0YUxvbjtcclxuICBpZiAoMSA8PSBkKSB7XHJcbiAgICByZXR1cm4gYzIuc2xpY2UoKTtcclxuICB9XHJcbiAgZCA9IGZyYWN0aW9uICogTWF0aC5hY29zKGQpO1xyXG4gIHZhciBjb3NEID0gTWF0aC5jb3MoZCk7XHJcbiAgdmFyIHNpbkQgPSBNYXRoLnNpbihkKTtcclxuICB2YXIgeSA9IE1hdGguc2luKGxvbjIgLSBsb24xKSAqIGNvc0xhdDI7XHJcbiAgdmFyIHggPSBjb3NMYXQxICogc2luTGF0MiAtIHNpbkxhdDEgKiBjb3NMYXQyICogY29zRGVsdGFMb247XHJcbiAgdmFyIHRoZXRhID0gTWF0aC5hdGFuMih5LCB4KTtcclxuICB2YXIgbGF0ID0gTWF0aC5hc2luKHNpbkxhdDEgKiBjb3NEICsgY29zTGF0MSAqIHNpbkQgKiBNYXRoLmNvcyh0aGV0YSkpO1xyXG4gIHZhciBsb24gPSBsb24xICsgTWF0aC5hdGFuMihNYXRoLnNpbih0aGV0YSkgKiBzaW5EICogY29zTGF0MSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29zRCAtIHNpbkxhdDEgKiBNYXRoLnNpbihsYXQpKTtcclxuICByZXR1cm4gW3RvRGVncmVlcyhsb24pLCB0b0RlZ3JlZXMobGF0KV07XHJcbn07XHJcblxyXG5XR1M4NFNwaGVyZS5wcm90b3R5cGUuaW5pdGlhbEJlYXJpbmcgPSBmdW5jdGlvbihjMSwgYzIpIHtcclxuICB2YXIgbGF0MSA9IHRvUmFkaWFucyhjMVsxXSk7XHJcbiAgdmFyIGxhdDIgPSB0b1JhZGlhbnMoYzJbMV0pO1xyXG4gIHZhciBkZWx0YUxvbiA9IHRvUmFkaWFucyhjMlswXSAtIGMxWzBdKTtcclxuICB2YXIgeSA9IE1hdGguc2luKGRlbHRhTG9uKSAqIE1hdGguY29zKGxhdDIpO1xyXG4gIHZhciB4ID0gTWF0aC5jb3MobGF0MSkgKiBNYXRoLnNpbihsYXQyKSAtXHJcbiAgICAgIE1hdGguc2luKGxhdDEpICogTWF0aC5jb3MobGF0MikgKiBNYXRoLmNvcyhkZWx0YUxvbik7XHJcbiAgcmV0dXJuIHRvRGVncmVlcyhNYXRoLmF0YW4yKHksIHgpKTtcclxufTtcclxuXHJcbldHUzg0U3BoZXJlLnByb3RvdHlwZS5tYXhpbXVtTGF0aXR1ZGUgPSBmdW5jdGlvbihiZWFyaW5nLCBsYXRpdHVkZSkge1xyXG4gIHJldHVybiBNYXRoLmNvcyhNYXRoLmFicyhNYXRoLnNpbih0b1JhZGlhbnMoYmVhcmluZykpICpcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgTWF0aC5jb3ModG9SYWRpYW5zKGxhdGl0dWRlKSkpKTtcclxufTtcclxuXHJcbldHUzg0U3BoZXJlLnByb3RvdHlwZS5taWRwb2ludCA9IGZ1bmN0aW9uKGMxLCBjMikge1xyXG4gIHZhciBsYXQxID0gdG9SYWRpYW5zKGMxWzFdKTtcclxuICB2YXIgbGF0MiA9IHRvUmFkaWFucyhjMlsxXSk7XHJcbiAgdmFyIGxvbjEgPSB0b1JhZGlhbnMoYzFbMF0pO1xyXG4gIHZhciBkZWx0YUxvbiA9IHRvUmFkaWFucyhjMlswXSAtIGMxWzBdKTtcclxuICB2YXIgQnggPSBNYXRoLmNvcyhsYXQyKSAqIE1hdGguY29zKGRlbHRhTG9uKTtcclxuICB2YXIgQnkgPSBNYXRoLmNvcyhsYXQyKSAqIE1hdGguc2luKGRlbHRhTG9uKTtcclxuICB2YXIgY29zTGF0MVBsdXNCeCA9IE1hdGguY29zKGxhdDEpICsgQng7XHJcbiAgdmFyIGxhdCA9IE1hdGguYXRhbjIoTWF0aC5zaW4obGF0MSkgKyBNYXRoLnNpbihsYXQyKSxcclxuICAgICAgICAgICAgICAgICAgICAgICBNYXRoLnNxcnQoY29zTGF0MVBsdXNCeCAqIGNvc0xhdDFQbHVzQnggKyBCeSAqIEJ5KSk7XHJcbiAgdmFyIGxvbiA9IGxvbjEgKyBNYXRoLmF0YW4yKEJ5LCBjb3NMYXQxUGx1c0J4KTtcclxuICByZXR1cm4gW3RvRGVncmVlcyhsb24pLCB0b0RlZ3JlZXMobGF0KV07XHJcbn07XHJcblxyXG5XR1M4NFNwaGVyZS5wcm90b3R5cGUub2Zmc2V0ID0gZnVuY3Rpb24oYzEsIGRpc3RhbmNlLCBiZWFyaW5nKSB7XHJcbiAgdmFyIGxhdDEgPSB0b1JhZGlhbnMoYzFbMV0pO1xyXG4gIHZhciBsb24xID0gdG9SYWRpYW5zKGMxWzBdKTtcclxuICB2YXIgZEJ5UiA9IGRpc3RhbmNlIC8gdGhpcy5yYWRpdXM7XHJcbiAgdmFyIGxhdCA9IE1hdGguYXNpbihcclxuICAgICAgTWF0aC5zaW4obGF0MSkgKiBNYXRoLmNvcyhkQnlSKSArXHJcbiAgICAgIE1hdGguY29zKGxhdDEpICogTWF0aC5zaW4oZEJ5UikgKiBNYXRoLmNvcyhiZWFyaW5nKSk7XHJcbiAgdmFyIGxvbiA9IGxvbjEgKyBNYXRoLmF0YW4yKFxyXG4gICAgICBNYXRoLnNpbihiZWFyaW5nKSAqIE1hdGguc2luKGRCeVIpICogTWF0aC5jb3MobGF0MSksXHJcbiAgICAgIE1hdGguY29zKGRCeVIpIC0gTWF0aC5zaW4obGF0MSkgKiBNYXRoLnNpbihsYXQpKTtcclxuICByZXR1cm4gW3RvRGVncmVlcyhsb24pLCB0b0RlZ3JlZXMobGF0KV07XHJcbn07XHJcblxyXG4vKipcclxuICogQ2hlY2tzIHdoZXRoZXIgb2JqZWN0IGlzIG5vdCBudWxsIGFuZCBub3QgdW5kZWZpbmVkXHJcbiAqIEBwYXJhbSB7Kn0gb2JqIG9iamVjdCB0byBiZSBjaGVja2VkXHJcbiAqIEByZXR1cm4ge2Jvb2xlYW59XHJcbiAqL1xyXG5cclxuZnVuY3Rpb24gaXNEZWZpbmVkKG9iaikge1xyXG4gICAgcmV0dXJuIG51bGwgIT0gb2JqICYmIHVuZGVmaW5lZCAhPSBvYmo7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGlzTnVtZXJpYyh3aCkge1xyXG4gICAgcmV0dXJuICFpc05hTihwYXJzZUZsb2F0KHdoKSkgJiYgaXNGaW5pdGUod2gpO1xyXG59XHJcblxyXG5mdW5jdGlvbiBpc0Z1bmN0aW9uKHdoKSB7XHJcbiAgICBpZiAoIXdoKSB7XHJcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuICh3aCBpbnN0YW5jZW9mIEZ1bmN0aW9uIHx8IHR5cGVvZiB3aCA9PSBcImZ1bmN0aW9uXCIpO1xyXG59XHJcblxyXG5mdW5jdGlvbiBpc1N0cmluZ05vdEVtcHR5KHdoKSB7XHJcbiAgICBpZiAoIXdoKSB7XHJcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuICh3aCBpbnN0YW5jZW9mIFN0cmluZyB8fCB0eXBlb2Ygd2ggPT0gXCJzdHJpbmdcIik7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGlzU3RyKHdoKSB7XHJcbiAgICByZXR1cm4gKHdoIGluc3RhbmNlb2YgU3RyaW5nIHx8IHR5cGVvZiB3aCA9PT0gXCJzdHJpbmdcIik7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGlzQm9vbGVhbih3aCkge1xyXG4gICAgcmV0dXJuICh3aCBpbnN0YW5jZW9mIEJvb2xlYW4gfHwgdHlwZW9mIHdoID09IFwiYm9vbGVhblwiKTtcclxufVxyXG5cclxuZnVuY3Rpb24gbXlUcmltKHgpIHtcclxuICAgIHJldHVybiB4LnJlcGxhY2UoL15cXHMrfFxccyskL2dtLCcnKTtcclxufVxyXG5cclxuZnVuY3Rpb24gbXlUcmltQ29vcmRpbmF0ZSh4KSB7XHJcblx0ZG8ge1xyXG5cdFx0dmFyIGs9eDtcclxuXHRcdHg9bXlUcmltKHgpO1xyXG5cdFx0aWYgKGsgIT0geCkgXHJcblx0XHRcdGNvbnRpbnVlO1xyXG5cdFx0aWYgKHgubGVuZ3RoKSBcclxuXHRcdHtcclxuXHRcdFx0aWYgKHhbMF0gPT0gXCIsXCIpXHJcblx0XHRcdFx0eD14LnN1YnN0cmluZygxLHgubGVuZ3RoKTtcclxuXHRcdFx0ZWxzZSBpZiAoa1trLmxlbmd0aC0xXSA9PSBcIixcIilcclxuXHRcdFx0XHR4PXguc3Vic3RyaW5nKDAseC5sZW5ndGgtMSk7XHJcblx0XHRcdGVsc2VcclxuXHRcdFx0XHRicmVhaztcclxuXHRcdFx0Y29udGludWU7XHJcblx0XHR9XHJcblx0XHRicmVhaztcclxuXHR9IHdoaWxlICh0cnVlKTtcclxuXHRyZXR1cm4geDtcclxufVxyXG5cclxuXHJcbmZ1bmN0aW9uIGNsb3Nlc3RQcm9qZWN0aW9uT2ZQb2ludE9uTGluZSh4LHkseDEseTEseDIseTIpIFxyXG57XHJcblx0dmFyIHN0YXR1cztcclxuXHR2YXIgUDE9bnVsbDtcclxuXHR2YXIgUDI9bnVsbDtcclxuXHR2YXIgUDM9bnVsbDtcclxuXHR2YXIgUDQ9bnVsbDtcclxuXHR2YXIgcDE9W107XHJcbiAgICB2YXIgcDI9W107XHJcbiAgICB2YXIgcDM9W107XHJcblx0dmFyIHA0PVtdO1xyXG4gICAgdmFyIGludGVyc2VjdGlvblBvaW50PW51bGw7XHJcbiAgICB2YXIgZGlzdE1pblBvaW50PW51bGw7XHJcbiAgICB2YXIgZGVub21pbmF0b3I9MDtcclxuICAgIHZhciBub21pbmF0b3I9MDtcclxuICAgIHZhciB1PTA7XHJcbiAgICB2YXIgZGlzdE9ydGhvPTA7XHJcbiAgICB2YXIgZGlzdFAxPTA7XHJcbiAgICB2YXIgZGlzdFAyPTA7XHJcbiAgICB2YXIgZGlzdE1pbj0wO1xyXG4gICAgdmFyIGRpc3RNYXg9MDtcclxuICAgXHJcbiAgICBmdW5jdGlvbiBpbnRlcnNlY3Rpb24oKVxyXG4gICAge1xyXG4gICAgICAgIHZhciBheCA9IHAxWzBdICsgdSAqIChwMlswXSAtIHAxWzBdKTtcclxuICAgICAgICB2YXIgYXkgPSBwMVsxXSArIHUgKiAocDJbMV0gLSBwMVsxXSk7XHJcbiAgICAgICAgcDQgPSBbYXgsIGF5XTtcclxuICAgICAgICBpbnRlcnNlY3Rpb25Qb2ludCA9IFtheCxheV07XHJcbiAgICB9XHJcblxyXG4gICAgZnVuY3Rpb24gZGlzdGFuY2UoKVxyXG4gICAge1xyXG4gICAgICAgIHZhciBheCA9IHAxWzBdICsgdSAqIChwMlswXSAtIHAxWzBdKTtcclxuICAgICAgICB2YXIgYXkgPSBwMVsxXSArIHUgKiAocDJbMV0gLSBwMVsxXSk7XHJcbiAgICAgICAgcDQgPSBbYXgsIGF5XTtcclxuICAgICAgICBkaXN0T3J0aG8gPSBNYXRoLnNxcnQoTWF0aC5wb3coKHA0WzBdIC0gcDNbMF0pLDIpICsgTWF0aC5wb3coKHA0WzFdIC0gcDNbMV0pLDIpKTtcclxuICAgICAgICBkaXN0UDEgICAgPSBNYXRoLnNxcnQoTWF0aC5wb3coKHAxWzBdIC0gcDNbMF0pLDIpICsgTWF0aC5wb3coKHAxWzFdIC0gcDNbMV0pLDIpKTtcclxuICAgICAgICBkaXN0UDIgICAgPSBNYXRoLnNxcnQoTWF0aC5wb3coKHAyWzBdIC0gcDNbMF0pLDIpICsgTWF0aC5wb3coKHAyWzFdIC0gcDNbMV0pLDIpKTtcclxuICAgICAgICBpZih1Pj0wICYmIHU8PTEpXHJcbiAgICAgICAgeyAgIGRpc3RNaW4gPSBkaXN0T3J0aG87XHJcbiAgICAgICAgICAgIGRpc3RNaW5Qb2ludCA9IGludGVyc2VjdGlvblBvaW50O1xyXG4gICAgICAgIH1cclxuICAgICAgICBlbHNlXHJcbiAgICAgICAgeyAgIGlmKGRpc3RQMSA8PSBkaXN0UDIpXHJcbiAgICAgICAgICAgIHsgICBkaXN0TWluID0gZGlzdFAxO1xyXG4gICAgICAgICAgICAgICAgZGlzdE1pblBvaW50ID0gUDE7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgZWxzZVxyXG4gICAgICAgICAgICB7ICAgZGlzdE1pbiA9IGRpc3RQMjtcclxuICAgICAgICAgICAgICAgIGRpc3RNaW5Qb2ludCA9IFAyO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGRpc3RNYXggPSBNYXRoLm1heChNYXRoLm1heChkaXN0T3J0aG8sIGRpc3RQMSksIGRpc3RQMik7XHJcbiAgICB9XHJcblx0UDEgPSBbeDEseTFdO1xyXG5cdFAyID0gW3gyLHkyXTtcclxuXHRQMyA9IFt4LHldO1xyXG5cdHAxID0gW3gxLCB5MV07XHJcblx0cDIgPSBbeDIsIHkyXTtcclxuXHRwMyA9IFt4LCB5XTtcclxuXHRkZW5vbWluYXRvciA9IE1hdGgucG93KE1hdGguc3FydChNYXRoLnBvdyhwMlswXS1wMVswXSwyKSArIE1hdGgucG93KHAyWzFdLXAxWzFdLDIpKSwyICk7XHJcblx0bm9taW5hdG9yICAgPSAocDNbMF0gLSBwMVswXSkgKiAocDJbMF0gLSBwMVswXSkgKyAocDNbMV0gLSBwMVsxXSkgKiAocDJbMV0gLSBwMVsxXSk7XHJcblx0aWYoZGVub21pbmF0b3I9PTApXHJcblx0eyAgIHN0YXR1cyA9IFwiY29pbmNpZGVudGFsXCJcclxuXHRcdHUgPSAtOTk5O1xyXG5cdH1cclxuXHRlbHNlXHJcblx0eyAgIHUgPSBub21pbmF0b3IgLyBkZW5vbWluYXRvcjtcclxuXHRcdGlmKHUgPj0wICYmIHUgPD0gMSlcclxuXHRcdFx0c3RhdHVzID0gXCJvcnRob2dvbmFsXCI7XHJcblx0XHRlbHNlXHJcblx0XHRcdHN0YXR1cyA9IFwib2JsaXF1ZVwiO1xyXG5cdH1cclxuXHRpbnRlcnNlY3Rpb24oKTtcclxuXHRkaXN0YW5jZSgpO1xyXG5cdFxyXG5cdHJldHVybiB7IHN0YXR1cyA6IHN0YXR1cywgcG9zIDogZGlzdE1pblBvaW50LCBtaW4gOiBkaXN0TWluIH07XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGNvbG9yTHVtaW5hbmNlKGhleCwgbHVtKSB7XHJcbiAgICAvLyBWYWxpZGF0ZSBoZXggc3RyaW5nXHJcbiAgICBoZXggPSBTdHJpbmcoaGV4KS5yZXBsYWNlKC9bXjAtOWEtZl0vZ2ksIFwiXCIpO1xyXG4gICAgaWYgKGhleC5sZW5ndGggPCA2KSB7XHJcbiAgICAgICAgaGV4ID0gaGV4LnJlcGxhY2UoLyguKS9nLCAnJDEkMScpO1xyXG4gICAgfVxyXG4gICAgbHVtID0gbHVtIHx8IDA7XHJcbiAgICAvLyBDb252ZXJ0IHRvIGRlY2ltYWwgYW5kIGNoYW5nZSBsdW1pbm9zaXR5XHJcbiAgICB2YXIgcmdiID0gXCIjXCIsXHJcbiAgICAgICAgYztcclxuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgMzsgKytpKSB7XHJcbiAgICAgICAgYyA9IHBhcnNlSW50KGhleC5zdWJzdHIoaSAqIDIsIDIpLCAxNik7XHJcbiAgICAgICAgYyA9IE1hdGgucm91bmQoTWF0aC5taW4oTWF0aC5tYXgoMCwgYyArIChjICogbHVtKSksIDI1NSkpLnRvU3RyaW5nKDE2KTtcclxuICAgICAgICByZ2IgKz0gKFwiMDBcIiArIGMpLnN1YnN0cihjLmxlbmd0aCk7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gcmdiO1xyXG59XHJcblxyXG5mdW5jdGlvbiBpbmNyZWFzZUJyaWdodG5lc3MoaGV4LCBwZXJjZW50KSBcclxue1xyXG4gICAgaGV4ID0gU3RyaW5nKGhleCkucmVwbGFjZSgvW14wLTlhLWZdL2dpLCBcIlwiKTtcclxuICAgIGlmIChoZXgubGVuZ3RoIDwgNikge1xyXG4gICAgICAgIGhleCA9IGhleC5yZXBsYWNlKC8oLikvZywgJyQxJDEnKTtcclxuICAgIH1cclxuICAgIHZhciByZ2IgPSBcIiNcIixcclxuICAgICAgICBjO1xyXG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCAzOyArK2kpIHtcclxuICAgICAgICBjID0gcGFyc2VJbnQoaGV4LnN1YnN0cihpICogMiwgMiksIDE2KTtcclxuICAgICAgICBjID0gcGFyc2VJbnQoKGMqKDEwMC1wZXJjZW50KSsyNTUqcGVyY2VudCkvMTAwKTtcclxuICAgICAgICBpZiAoYyA+IDI1NSlcclxuICAgICAgICBcdGM9MjU1O1xyXG4gICAgICAgIGM9Yy50b1N0cmluZygxNik7XHJcbiAgICAgICAgcmdiICs9IChcIjAwXCIgKyBjKS5zdWJzdHIoYy5sZW5ndGgpO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIHJnYjtcclxufVxyXG5cclxuZnVuY3Rpb24gY29sb3JBbHBoYUFycmF5KGhleCwgYWxwaGEpIHtcclxuICAgIGhleCA9IFN0cmluZyhoZXgpLnJlcGxhY2UoL1teMC05YS1mXS9naSwgXCJcIik7XHJcbiAgICBpZiAoaGV4Lmxlbmd0aCA8IDYpIHtcclxuICAgICAgICBoZXggPSBoZXgucmVwbGFjZSgvKC4pL2csICckMSQxJyk7XHJcbiAgICB9XHJcbiAgICB2YXIgcmVzPVtdO1xyXG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCAzOyArK2kpIHtcclxuICAgICAgICBjID0gcGFyc2VJbnQoaGV4LnN1YnN0cihpICogMiwgMiksIDE2KTtcclxuICAgICAgICByZXMucHVzaChjKTtcclxuICAgIH1cclxuICAgIHJlcy5wdXNoKGFscGhhKTtcclxuICAgIHJldHVybiByZXM7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGVzY2FwZUhUTUwodW5zYWZlKSB7XHJcbiAgICByZXR1cm4gdW5zYWZlXHJcbiAgICAgICAgIC5yZXBsYWNlKC8mL2csIFwiJmFtcDtcIilcclxuICAgICAgICAgLnJlcGxhY2UoLzwvZywgXCImbHQ7XCIpXHJcbiAgICAgICAgIC5yZXBsYWNlKC8+L2csIFwiJmd0O1wiKVxyXG4gICAgICAgICAucmVwbGFjZSgvXCIvZywgXCImcXVvdDtcIilcclxuICAgICAgICAgLnJlcGxhY2UoLycvZywgXCImIzAzOTtcIik7XHJcbiB9XHJcblxyXG5mdW5jdGlvbiBmb3JtYXROdW1iZXIyKHZhbCkge1xyXG5cdHJldHVybiBwYXJzZUZsb2F0KE1hdGgucm91bmQodmFsICogMTAwKSAvIDEwMCkudG9GaXhlZCgyKTtcclxufVxyXG5mdW5jdGlvbiBmb3JtYXREYXRlKGQpIHtcclxuIFx0dmFyIGRkID0gZC5nZXREYXRlKCk7XHJcbiAgICB2YXIgbW0gPSBkLmdldE1vbnRoKCkrMTsgLy9KYW51YXJ5IGlzIDAhXHJcbiAgICB2YXIgeXl5eSA9IGQuZ2V0RnVsbFllYXIoKTtcclxuICAgIGlmKGRkPDEwKXtcclxuICAgICAgICBkZD0nMCcrZGQ7XHJcbiAgICB9IFxyXG4gICAgaWYobW08MTApe1xyXG4gICAgICAgIG1tPScwJyttbTtcclxuICAgIH0gXHJcbiAgICByZXR1cm4gZGQrJy4nK21tKycuJyt5eXl5O1xyXG59XHJcblxyXG5mdW5jdGlvbiBmb3JtYXRUaW1lKGQpIHtcclxuICAgIHZhciBoaCA9IGQuZ2V0SG91cnMoKTtcclxuICAgIGlmKGhoPDEwKXtcclxuICAgIFx0aGg9JzAnK2hoO1xyXG4gICAgfSBcclxuICAgIHZhciBtbSA9IGQuZ2V0TWludXRlcygpO1xyXG4gICAgaWYobW08MTApe1xyXG4gICAgICAgIG1tPScwJyttbTtcclxuICAgIH0gXHJcbiAgICByZXR1cm4gaGgrXCI6XCIrbW07XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGZvcm1hdERhdGVUaW1lKGQpIHtcclxuXHRyZXR1cm4gZm9ybWF0RGF0ZShkKStcIiBcIitmb3JtYXRUaW1lKGQpO1xyXG59XHJcblxyXG5mdW5jdGlvbiBmb3JtYXREYXRlVGltZVNlYyhkKSB7XHJcblx0cmV0dXJuIGZvcm1hdERhdGUoZCkrXCIgXCIrZm9ybWF0VGltZVNlYyhkKTtcclxufVxyXG5cclxuZnVuY3Rpb24gZm9ybWF0VGltZVNlYyhkKSB7XHJcbiAgICB2YXIgaGggPSBkLmdldEhvdXJzKCk7XHJcbiAgICBpZihoaDwxMCl7XHJcbiAgICBcdGhoPScwJytoaDtcclxuICAgIH0gXHJcbiAgICB2YXIgbW0gPSBkLmdldE1pbnV0ZXMoKTtcclxuICAgIGlmKG1tPDEwKXtcclxuICAgICAgICBtbT0nMCcrbW07XHJcbiAgICB9IFxyXG4gICAgdmFyIHNzID0gZC5nZXRTZWNvbmRzKCk7XHJcbiAgICBpZihzczwxMCl7XHJcbiAgICAgICAgc3M9JzAnK3NzO1xyXG4gICAgfSBcclxuICAgIHJldHVybiBoaCtcIjpcIittbStcIjpcIitzcztcclxufVxyXG5cclxuZnVuY3Rpb24gcmFpbmJvdyhudW1PZlN0ZXBzLCBzdGVwKSB7XHJcbiAgICAvLyBUaGlzIGZ1bmN0aW9uIGdlbmVyYXRlcyB2aWJyYW50LCBcImV2ZW5seSBzcGFjZWRcIiBjb2xvdXJzIChpLmUuIG5vIGNsdXN0ZXJpbmcpLiBUaGlzIGlzIGlkZWFsIGZvciBjcmVhdGluZyBlYXNpbHkgZGlzdGluZ3Vpc2hhYmxlIHZpYnJhbnQgbWFya2VycyBpbiBHb29nbGUgTWFwcyBhbmQgb3RoZXIgYXBwcy5cclxuICAgIC8vIEFkYW0gQ29sZSwgMjAxMS1TZXB0LTE0XHJcbiAgICAvLyBIU1YgdG8gUkJHIGFkYXB0ZWQgZnJvbTogaHR0cDovL21qaWphY2tzb24uY29tLzIwMDgvMDIvcmdiLXRvLWhzbC1hbmQtcmdiLXRvLWhzdi1jb2xvci1tb2RlbC1jb252ZXJzaW9uLWFsZ29yaXRobXMtaW4tamF2YXNjcmlwdFxyXG4gICAgdmFyIHIsIGcsIGI7XHJcbiAgICB2YXIgaCA9IHN0ZXAgLyBudW1PZlN0ZXBzO1xyXG4gICAgdmFyIGkgPSB+fihoICogNik7XHJcbiAgICB2YXIgZiA9IGggKiA2IC0gaTtcclxuICAgIHZhciBxID0gMSAtIGY7XHJcbiAgICBzd2l0Y2goaSAlIDYpe1xyXG4gICAgICAgIGNhc2UgMDogciA9IDEsIGcgPSBmLCBiID0gMDsgYnJlYWs7XHJcbiAgICAgICAgY2FzZSAxOiByID0gcSwgZyA9IDEsIGIgPSAwOyBicmVhaztcclxuICAgICAgICBjYXNlIDI6IHIgPSAwLCBnID0gMSwgYiA9IGY7IGJyZWFrO1xyXG4gICAgICAgIGNhc2UgMzogciA9IDAsIGcgPSBxLCBiID0gMTsgYnJlYWs7XHJcbiAgICAgICAgY2FzZSA0OiByID0gZiwgZyA9IDAsIGIgPSAxOyBicmVhaztcclxuICAgICAgICBjYXNlIDU6IHIgPSAxLCBnID0gMCwgYiA9IHE7IGJyZWFrO1xyXG4gICAgfVxyXG4gICAgdmFyIGMgPSBcIiNcIiArIChcIjAwXCIgKyAofiB+KHIgKiAyNTUpKS50b1N0cmluZygxNikpLnNsaWNlKC0yKSArIChcIjAwXCIgKyAofiB+KGcgKiAyNTUpKS50b1N0cmluZygxNikpLnNsaWNlKC0yKSArIChcIjAwXCIgKyAofiB+KGIgKiAyNTUpKS50b1N0cmluZygxNikpLnNsaWNlKC0yKTtcclxuICAgIHJldHVybiAoYyk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIG1vYmlsZUFuZFRhYmxldENoZWNrKCkgXHJcbntcclxuXHQgIGlmICh0eXBlb2YgbmF2aWdhdG9yID09IFwidW5kZWZpbmVkXCIpXHJcblx0XHQgIHJldHVybiBmYWxzZTtcclxuXHQgIHZhciBjaGVjayA9IGZhbHNlO1xyXG5cdCAgKGZ1bmN0aW9uKGEpe2lmKC8oYW5kcm9pZHxiYlxcZCt8bWVlZ28pLittb2JpbGV8YXZhbnRnb3xiYWRhXFwvfGJsYWNrYmVycnl8YmxhemVyfGNvbXBhbHxlbGFpbmV8ZmVubmVjfGhpcHRvcHxpZW1vYmlsZXxpcChob25lfG9kKXxpcmlzfGtpbmRsZXxsZ2UgfG1hZW1vfG1pZHB8bW1wfG1vYmlsZS4rZmlyZWZveHxuZXRmcm9udHxvcGVyYSBtKG9ifGluKWl8cGFsbSggb3MpP3xwaG9uZXxwKGl4aXxyZSlcXC98cGx1Y2tlcnxwb2NrZXR8cHNwfHNlcmllcyg0fDYpMHxzeW1iaWFufHRyZW98dXBcXC4oYnJvd3NlcnxsaW5rKXx2b2RhZm9uZXx3YXB8d2luZG93cyBjZXx4ZGF8eGlpbm98YW5kcm9pZHxpcGFkfHBsYXlib29rfHNpbGsvaS50ZXN0KGEpfHwvMTIwN3w2MzEwfDY1OTB8M2dzb3w0dGhwfDUwWzEtNl1pfDc3MHN8ODAyc3xhIHdhfGFiYWN8YWMoZXJ8b298c1xcLSl8YWkoa298cm4pfGFsKGF2fGNhfGNvKXxhbW9pfGFuKGV4fG55fHl3KXxhcHR1fGFyKGNofGdvKXxhcyh0ZXx1cyl8YXR0d3xhdShkaXxcXC1tfHIgfHMgKXxhdmFufGJlKGNrfGxsfG5xKXxiaShsYnxyZCl8YmwoYWN8YXopfGJyKGV8dil3fGJ1bWJ8YndcXC0obnx1KXxjNTVcXC98Y2FwaXxjY3dhfGNkbVxcLXxjZWxsfGNodG18Y2xkY3xjbWRcXC18Y28obXB8bmQpfGNyYXd8ZGEoaXR8bGx8bmcpfGRidGV8ZGNcXC1zfGRldml8ZGljYXxkbW9ifGRvKGN8cClvfGRzKDEyfFxcLWQpfGVsKDQ5fGFpKXxlbShsMnx1bCl8ZXIoaWN8azApfGVzbDh8ZXooWzQtN10wfG9zfHdhfHplKXxmZXRjfGZseShcXC18Xyl8ZzEgdXxnNTYwfGdlbmV8Z2ZcXC01fGdcXC1tb3xnbyhcXC53fG9kKXxncihhZHx1bil8aGFpZXxoY2l0fGhkXFwtKG18cHx0KXxoZWlcXC18aGkocHR8dGEpfGhwKCBpfGlwKXxoc1xcLWN8aHQoYyhcXC18IHxffGF8Z3xwfHN8dCl8dHApfGh1KGF3fHRjKXxpXFwtKDIwfGdvfG1hKXxpMjMwfGlhYyggfFxcLXxcXC8pfGlicm98aWRlYXxpZzAxfGlrb218aW0xa3xpbm5vfGlwYXF8aXJpc3xqYSh0fHYpYXxqYnJvfGplbXV8amlnc3xrZGRpfGtlaml8a2d0KCB8XFwvKXxrbG9ufGtwdCB8a3djXFwtfGt5byhjfGspfGxlKG5vfHhpKXxsZyggZ3xcXC8oa3xsfHUpfDUwfDU0fFxcLVthLXddKXxsaWJ3fGx5bnh8bTFcXC13fG0zZ2F8bTUwXFwvfG1hKHRlfHVpfHhvKXxtYygwMXwyMXxjYSl8bVxcLWNyfG1lKHJjfHJpKXxtaShvOHxvYXx0cyl8bW1lZnxtbygwMXwwMnxiaXxkZXxkb3x0KFxcLXwgfG98dil8enopfG10KDUwfHAxfHYgKXxtd2JwfG15d2F8bjEwWzAtMl18bjIwWzItM118bjMwKDB8Mil8bjUwKDB8Mnw1KXxuNygwKDB8MSl8MTApfG5lKChjfG0pXFwtfG9ufHRmfHdmfHdnfHd0KXxub2soNnxpKXxuenBofG8yaW18b3AodGl8d3YpfG9yYW58b3dnMXxwODAwfHBhbihhfGR8dCl8cGR4Z3xwZygxM3xcXC0oWzEtOF18YykpfHBoaWx8cGlyZXxwbChheXx1Yyl8cG5cXC0yfHBvKGNrfHJ0fHNlKXxwcm94fHBzaW98cHRcXC1nfHFhXFwtYXxxYygwN3wxMnwyMXwzMnw2MHxcXC1bMi03XXxpXFwtKXxxdGVrfHIzODB8cjYwMHxyYWtzfHJpbTl8cm8odmV8em8pfHM1NVxcL3xzYShnZXxtYXxtbXxtc3xueXx2YSl8c2MoMDF8aFxcLXxvb3xwXFwtKXxzZGtcXC98c2UoYyhcXC18MHwxKXw0N3xtY3xuZHxyaSl8c2doXFwtfHNoYXJ8c2llKFxcLXxtKXxza1xcLTB8c2woNDV8aWQpfHNtKGFsfGFyfGIzfGl0fHQ1KXxzbyhmdHxueSl8c3AoMDF8aFxcLXx2XFwtfHYgKXxzeSgwMXxtYil8dDIoMTh8NTApfHQ2KDAwfDEwfDE4KXx0YShndHxsayl8dGNsXFwtfHRkZ1xcLXx0ZWwoaXxtKXx0aW1cXC18dFxcLW1vfHRvKHBsfHNoKXx0cyg3MHxtXFwtfG0zfG01KXx0eFxcLTl8dXAoXFwuYnxnMXxzaSl8dXRzdHx2NDAwfHY3NTB8dmVyaXx2aShyZ3x0ZSl8dmsoNDB8NVswLTNdfFxcLXYpfHZtNDB8dm9kYXx2dWxjfHZ4KDUyfDUzfDYwfDYxfDcwfDgwfDgxfDgzfDg1fDk4KXx3M2MoXFwtfCApfHdlYmN8d2hpdHx3aShnIHxuY3xudyl8d21sYnx3b251fHg3MDB8eWFzXFwtfHlvdXJ8emV0b3x6dGVcXC0vaS50ZXN0KGEuc3Vic3RyKDAsNCkpKWNoZWNrID0gdHJ1ZX0pKG5hdmlnYXRvci51c2VyQWdlbnR8fG5hdmlnYXRvci52ZW5kb3J8fHdpbmRvdy5vcGVyYSk7XHJcblx0ICByZXR1cm4gY2hlY2s7XHJcbn1cclxuXHJcbnZhciBSRU5ERVJFREFSUk9XUz17fTtcclxuZnVuY3Rpb24gcmVuZGVyQXJyb3dCYXNlNjQod2lkdGgsaGVpZ2h0LGNvbG9yKSBcclxue1xyXG5cdHZhciBrZXkgPSB3aWR0aCtcInhcIitoZWlnaHQrXCI6XCIrY29sb3I7XHJcblx0aWYgKFJFTkRFUkVEQVJST1dTW2tleV0pXHJcblx0XHRyZXR1cm4gUkVOREVSRURBUlJPV1Nba2V5XTtcclxuXHR2YXIgYnJkY29sID0gXCIjZmVmZWZlXCI7IC8vaW5jcmVhc2VCcmlnaHRuZXNzKGNvbG9yLDk5KTtcclxuXHRcclxuXHR2YXIgc3ZnPSc8c3ZnIHZlcnNpb249XCIxLjFcIiBpZD1cIkxheWVyXzFcIiB4bWxucz1cImh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnXCIgeG1sbnM6eGxpbms9XCJodHRwOi8vd3d3LnczLm9yZy8xOTk5L3hsaW5rXCIgeD1cIjBweFwiIHk9XCIwcHhcIiB3aWR0aD1cIicrd2lkdGgrJ3B0XCIgaGVpZ2h0PVwiJytoZWlnaHQrJ3B0XCIgJ1x0XHJcblx0Kyd2aWV3Qm94PVwiMTM3LjgzNCAtODIuODMzIDExNCA5MS4zMzNcIiBlbmFibGUtYmFja2dyb3VuZD1cIm5ldyAxMzcuODM0IC04Mi44MzMgMTE0IDkxLjMzM1wiIHhtbDpzcGFjZT1cInByZXNlcnZlXCI+J1xyXG5cdCsnPHBhdGggZmlsbD1cIm5vbmVcIiBkPVwiTS01MS0yLjE2N2g0OHY0OGgtNDhWLTIuMTY3elwiLz4nXHJcblx0Kyc8Y2lyY2xlIGRpc3BsYXk9XCJub25lXCIgZmlsbD1cIiM2MDVDQzlcIiBjeD1cIjUxLjI4NlwiIGN5PVwiLTM1LjI4NlwiIHI9XCI4OC43ODZcIi8+J1xyXG5cdCsnPHBhdGggZmlsbD1cIiM2MDVDQzlcIiBzdHJva2U9XCIjRkZGRkZGXCIgc3Ryb2tlLXdpZHRoPVwiNFwiIHN0cm9rZS1taXRlcmxpbWl0PVwiMTBcIiBkPVwiTTIzOS41LTM2LjhsLTkyLjU1OC0zNS42OSBjNS4yMTYsMTEuMzA0LDguMTMsMjMuODg3LDguMTMsMzcuMTUzYzAsMTIuMTctMi40NTEsMjMuNzY3LTYuODgzLDM0LjMyN0wyMzkuNS0zNi44elwiLz4nXHJcblx0Kyc8L3N2Zz4nXHJcblx0dmFyIHN2Zz1zdmcuc3BsaXQoXCIjNjA1Q0M5XCIpLmpvaW4oY29sb3IpO1xyXG5cdHZhciBjYW52YXMgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdjYW52YXMnKTtcclxuICAgIGNhbnZhcy53aWR0aCA9IHdpZHRoO1xyXG4gICAgY2FudmFzLmhlaWdodCA9IGhlaWdodDtcclxuICAgIGNhbnZnKGNhbnZhcywgc3ZnLHsgaWdub3JlTW91c2U6IHRydWUsIGlnbm9yZUFuaW1hdGlvbjogdHJ1ZSB9KTtcclxuICAgIHJldHVybiBSRU5ERVJFREFSUk9XU1trZXldPWNhbnZhcy50b0RhdGFVUkwoKTtcclxufVxyXG5cclxudmFyIFJFTkRFUkVERElSRUNUSU9OUz17fTtcclxuZnVuY3Rpb24gcmVuZGVyRGlyZWN0aW9uQmFzZTY0KHdpZHRoLGhlaWdodCxjb2xvcikgXHJcbntcclxuXHR2YXIga2V5ID0gd2lkdGgrXCJ4XCIraGVpZ2h0K1wiOlwiK2NvbG9yO1xyXG5cdGlmIChSRU5ERVJFRERJUkVDVElPTlNba2V5XSlcclxuXHRcdHJldHVybiBSRU5ERVJFRERJUkVDVElPTlNba2V5XTtcclxuXHJcblx0dmFyIHN2Zz0nPHN2ZyB3aWR0aD1cIicrd2lkdGgrJ3B0XCIgaGVpZ2h0PVwiJytoZWlnaHQrJ3B0XCIgJ1xyXG5cclxuXHRcdCsndmlld0JveD1cIjE1IDkgMTkuNzUgMjkuNVwiIGVuYWJsZS1iYWNrZ3JvdW5kPVwibmV3IDE1IDkgMTkuNzUgMjkuNVwiIHhtbDpzcGFjZT1cInByZXNlcnZlXCI+J1xyXG5cdFx0Kyc8cGF0aCBmaWxsPVwiI0ZGRkVGRlwiIGQ9XCJNMTcuMTcsMzIuOTJsOS4xNy05LjE3bC05LjE3LTkuMTdMMjAsMTEuNzVsMTIsMTJsLTEyLDEyTDE3LjE3LDMyLjkyelwiLz4nXHJcblx0XHQrJzxwYXRoIGZpbGw9XCJub25lXCIgZD1cIk0wLTAuMjVoNDh2NDhIMFYtMC4yNXpcIi8+J1xyXG5cclxuXHQrJzwvc3ZnPic7XHJcblxyXG5cdHZhciBzdmc9c3ZnLnNwbGl0KFwiIzAwMDAwMFwiKS5qb2luKGNvbG9yKTtcclxuXHR2YXIgY2FudmFzID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnY2FudmFzJyk7XHJcbiAgICBjYW52YXMud2lkdGggPSB3aWR0aDtcclxuICAgIGNhbnZhcy5oZWlnaHQgPSBoZWlnaHQ7XHJcbiAgICBjYW52ZyhjYW52YXMsIHN2Zyx7IGlnbm9yZU1vdXNlOiB0cnVlLCBpZ25vcmVBbmltYXRpb246IHRydWUgfSk7XHJcbiAgICByZXR1cm4gUkVOREVSRURESVJFQ1RJT05TW2tleV09Y2FudmFzLnRvRGF0YVVSTCgpO1xyXG59XHJcblxyXG52YXIgUkVOREVSRUJPWEVTPXt9O1xyXG5mdW5jdGlvbiByZW5kZXJCb3hCYXNlNjQod2lkdGgsaGVpZ2h0LGNvbG9yKSBcclxue1xyXG5cdHZhciBrZXkgPSB3aWR0aCtcInhcIitoZWlnaHQrXCI6XCIrY29sb3I7XHJcblx0aWYgKFJFTkRFUkVCT1hFU1trZXldKVxyXG5cdFx0cmV0dXJuIFJFTkRFUkVCT1hFU1trZXldO1xyXG5cclxuXHR2YXIgc3ZnPSc8c3ZnIHdpZHRoPVwiJyt3aWR0aCsncHRcIiBoZWlnaHQ9XCInK2hlaWdodCsncHRcIiB2aWV3Qm94PVwiMCAwIDUxMiA1MTJcIiB2ZXJzaW9uPVwiMS4xXCIgeG1sbnM9XCJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2Z1wiPidcclxuXHQrJzxnIGlkPVwiI2ZmZmZmZmZmXCI+J1xyXG5cdCsnPHBhdGggZmlsbD1cIiNmZmZmZmZcIiBvcGFjaXR5PVwiMS4wMFwiIGQ9XCIgTSA1NS41MCAwLjAwIEwgNDU4LjQ1IDAuMDAgQyA0NzIuNDQgMC45OSA0ODYuMDMgNy4wOSA0OTUuNzggMTcuMjMgQyA1MDUuMzQgMjYuODggNTExLjAxIDQwLjA0IDUxMi4wMCA1My41NSBMIDUxMi4wMCA0NTguNDQgQyA1MTAuOTkgNDcyLjQzIDUwNC45MCA0ODYuMDEgNDk0Ljc3IDQ5NS43NyBDIDQ4NS4xMSA1MDUuMzIgNDcxLjk2IDUxMS4wMSA0NTguNDUgNTEyLjAwIEwgNTMuNTYgNTEyLjAwIEMgMzkuNTcgNTEwLjk5IDI1Ljk3IDUwNC45MSAxNi4yMiA0OTQuNzggQyA2LjY3IDQ4NS4xMiAwLjk3IDQ3MS45NyAwLjAwIDQ1OC40NSBMIDAuMDAgNTUuNTAgQyAwLjQwIDQxLjA3IDYuNDUgMjYuODkgMTYuNzQgMTYuNzMgQyAyNi44OSA2LjQ1IDQxLjA3IDAuNDEgNTUuNTAgMC4wMCBNIDU2LjkwIDU2LjkwIEMgNTYuODcgMTg5LjYzIDU2Ljg2IDMyMi4zNiA1Ni45MCA0NTUuMDkgQyAxODkuNjMgNDU1LjEyIDMyMi4zNiA0NTUuMTIgNDU1LjA5IDQ1NS4wOSBDIDQ1NS4xMiAzMjIuMzYgNDU1LjEyIDE4OS42MyA0NTUuMDkgNTYuOTAgQyAzMjIuMzYgNTYuODYgMTg5LjYzIDU2Ljg3IDU2LjkwIDU2LjkwIFpcIiAvPidcclxuXHQrJzwvZz4nXHJcblx0Kyc8ZyBpZD1cIiMwMDAwMDBmZlwiPidcclxuXHQrJzxwYXRoIGZpbGw9XCIjMDAwMDAwXCIgb3BhY2l0eT1cIjEuMDBcIiBkPVwiIE0gNTYuOTAgNTYuOTAgQyAxODkuNjMgNTYuODcgMzIyLjM2IDU2Ljg2IDQ1NS4wOSA1Ni45MCBDIDQ1NS4xMiAxODkuNjMgNDU1LjEyIDMyMi4zNiA0NTUuMDkgNDU1LjA5IEMgMzIyLjM2IDQ1NS4xMiAxODkuNjMgNDU1LjEyIDU2LjkwIDQ1NS4wOSBDIDU2Ljg2IDMyMi4zNiA1Ni44NyAxODkuNjMgNTYuOTAgNTYuOTAgWlwiIC8+J1xyXG5cdCsnPC9nPidcclxuXHQrJzwvc3ZnPic7XHJcblxyXG5cdHZhciBzdmc9c3ZnLnNwbGl0KFwiIzAwMDAwMFwiKS5qb2luKGNvbG9yKTtcclxuXHR2YXIgY2FudmFzID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnY2FudmFzJyk7XHJcbiAgICBjYW52YXMud2lkdGggPSB3aWR0aDtcclxuICAgIGNhbnZhcy5oZWlnaHQgPSBoZWlnaHQ7XHJcbiAgICBjYW52ZyhjYW52YXMsIHN2Zyx7IGlnbm9yZU1vdXNlOiB0cnVlLCBpZ25vcmVBbmltYXRpb246IHRydWUgfSk7XHJcbiAgICByZXR1cm4gUkVOREVSRUJPWEVTW2tleV09Y2FudmFzLnRvRGF0YVVSTCgpO1xyXG59XHJcblxyXG5cclxuZnVuY3Rpb24gaW50ZXJjZXB0T25DaXJjbGUoYSxiLGMscikge1xyXG5cdHJldHVybiBjaXJjbGVMaW5lSW50ZXJzZWN0KGFbMF0sYVsxXSxiWzBdLGJbMV0sY1swXSxjWzFdLHIpO1x0XHJcbn1cclxuZnVuY3Rpb24gZGlzdHAocDEscDIpIHtcclxuXHQgIHJldHVybiBNYXRoLnNxcnQoKHAyWzBdLXAxWzBdKSoocDJbMF0tcDFbMF0pKyhwMlsxXS1wMVsxXSkqKHAyWzFdLXAxWzFdKSk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGNpcmNsZUxpbmVJbnRlcnNlY3QoeDEsIHkxLCB4MiwgeTIsIGN4LCBjeSwgY3IgKSBcclxue1xyXG5cdCAgZnVuY3Rpb24gZGlzdCh4MSx5MSx4Mix5Mikge1xyXG5cdFx0ICByZXR1cm4gTWF0aC5zcXJ0KCh4Mi14MSkqKHgyLXgxKSsoeTIteTEpKih5Mi15MSkpO1xyXG5cdCAgfVxyXG5cdCAgdmFyIGR4ID0geDIgLSB4MTtcclxuXHQgIHZhciBkeSA9IHkyIC0geTE7XHJcblx0ICB2YXIgYSA9IGR4ICogZHggKyBkeSAqIGR5O1xyXG5cdCAgdmFyIGIgPSAyICogKGR4ICogKHgxIC0gY3gpICsgZHkgKiAoeTEgLSBjeSkpO1xyXG5cdCAgdmFyIGMgPSBjeCAqIGN4ICsgY3kgKiBjeTtcclxuXHQgIGMgKz0geDEgKiB4MSArIHkxICogeTE7XHJcblx0ICBjIC09IDIgKiAoY3ggKiB4MSArIGN5ICogeTEpO1xyXG5cdCAgYyAtPSBjciAqIGNyO1xyXG5cdCAgdmFyIGJiNGFjID0gYiAqIGIgLSA0ICogYSAqIGM7XHJcblx0ICBpZiAoYmI0YWMgPCAwKSB7ICAvLyBOb3QgaW50ZXJzZWN0aW5nXHJcblx0ICAgIHJldHVybiBmYWxzZTtcclxuXHQgIH0gZWxzZSB7XHJcblx0XHR2YXIgbXUgPSAoLWIgKyBNYXRoLnNxcnQoIGIqYiAtIDQqYSpjICkpIC8gKDIqYSk7XHJcblx0XHR2YXIgaXgxID0geDEgKyBtdSooZHgpO1xyXG5cdFx0dmFyIGl5MSA9IHkxICsgbXUqKGR5KTtcclxuXHQgICAgbXUgPSAoLWIgLSBNYXRoLnNxcnQoYipiIC0gNCphKmMgKSkgLyAoMiphKTtcclxuXHQgICAgdmFyIGl4MiA9IHgxICsgbXUqKGR4KTtcclxuXHQgICAgdmFyIGl5MiA9IHkxICsgbXUqKGR5KTtcclxuXHJcblx0ICAgIC8vIFRoZSBpbnRlcnNlY3Rpb24gcG9pbnRzXHJcblx0ICAgIC8vZWxsaXBzZShpeDEsIGl5MSwgMTAsIDEwKTtcclxuXHQgICAgLy9lbGxpcHNlKGl4MiwgaXkyLCAxMCwgMTApO1xyXG5cdCAgICBcclxuXHQgICAgdmFyIHRlc3RYO1xyXG5cdCAgICB2YXIgdGVzdFk7XHJcblx0ICAgIC8vIEZpZ3VyZSBvdXQgd2hpY2ggcG9pbnQgaXMgY2xvc2VyIHRvIHRoZSBjaXJjbGVcclxuXHQgICAgaWYgKGRpc3QoeDEsIHkxLCBjeCwgY3kpIDwgZGlzdCh4MiwgeTIsIGN4LCBjeSkpIHtcclxuXHQgICAgICB0ZXN0WCA9IHgyO1xyXG5cdCAgICAgIHRlc3RZID0geTI7XHJcblx0ICAgIH0gZWxzZSB7XHJcblx0ICAgICAgdGVzdFggPSB4MTtcclxuXHQgICAgICB0ZXN0WSA9IHkxO1xyXG5cdCAgICB9XHJcblx0ICAgICBcclxuXHQgICAgaWYgKGRpc3QodGVzdFgsIHRlc3RZLCBpeDEsIGl5MSkgPCBkaXN0KHgxLCB5MSwgeDIsIHkyKSB8fCBkaXN0KHRlc3RYLCB0ZXN0WSwgaXgyLCBpeTIpIDwgZGlzdCh4MSwgeTEsIHgyLCB5MikpIHtcclxuXHQgICAgICByZXR1cm4gWyBbaXgxLGl5MV0sW2l4MixpeTJdIF07XHJcblx0ICAgIH0gZWxzZSB7XHJcblx0ICAgICAgcmV0dXJuIGZhbHNlO1xyXG5cdCAgICB9XHJcblx0ICB9XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGRlY29kZUJhc2U2NEltYWdlKGRhdGFTdHJpbmcpIHtcclxuXHQgIHZhciBtYXRjaGVzID0gZGF0YVN0cmluZy5tYXRjaCgvXmRhdGE6KFtBLVphLXotK1xcL10rKTtiYXNlNjQsKC4rKSQvKSxcclxuXHQgICAgcmVzcG9uc2UgPSB7fTtcclxuXHQgIGlmIChtYXRjaGVzLmxlbmd0aCAhPT0gMykge1xyXG5cdCAgICByZXR1cm4gbmV3IEVycm9yKCdJbnZhbGlkIGlucHV0IHN0cmluZycpO1xyXG5cdCAgfVxyXG5cdCAgcmVzcG9uc2UudHlwZSA9IG1hdGNoZXNbMV07XHJcblx0ICByZXNwb25zZS5kYXRhID0gbmV3IEJ1ZmZlcihtYXRjaGVzWzJdLCAnYmFzZTY0Jyk7XHJcblx0ICByZXR1cm4gcmVzcG9uc2U7XHJcblx0fVxyXG5cclxuLy8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuZXhwb3J0cy5teVRyaW09bXlUcmltO1xyXG5leHBvcnRzLm15VHJpbUNvb3JkaW5hdGU9bXlUcmltQ29vcmRpbmF0ZTtcclxuZXhwb3J0cy5jbG9zZXN0UHJvamVjdGlvbk9mUG9pbnRPbkxpbmU9Y2xvc2VzdFByb2plY3Rpb25PZlBvaW50T25MaW5lO1xyXG5leHBvcnRzLmNvbG9yTHVtaW5hbmNlPWNvbG9yTHVtaW5hbmNlO1xyXG5leHBvcnRzLmluY3JlYXNlQnJpZ2h0bmVzcz1pbmNyZWFzZUJyaWdodG5lc3M7XHJcbmV4cG9ydHMuY29sb3JBbHBoYUFycmF5PWNvbG9yQWxwaGFBcnJheTtcclxuZXhwb3J0cy5lc2NhcGVIVE1MPWVzY2FwZUhUTUw7XHJcbmV4cG9ydHMuZm9ybWF0TnVtYmVyMj1mb3JtYXROdW1iZXIyO1xyXG5leHBvcnRzLmZvcm1hdERhdGVUaW1lPWZvcm1hdERhdGVUaW1lO1xyXG5leHBvcnRzLmZvcm1hdERhdGVUaW1lU2VjPWZvcm1hdERhdGVUaW1lU2VjO1xyXG5leHBvcnRzLmZvcm1hdERhdGU9Zm9ybWF0RGF0ZTtcclxuZXhwb3J0cy5mb3JtYXRUaW1lPWZvcm1hdFRpbWU7XHJcbmV4cG9ydHMucmFpbmJvdz1yYWluYm93O1xyXG5leHBvcnRzLm1vYmlsZUFuZFRhYmxldENoZWNrPW1vYmlsZUFuZFRhYmxldENoZWNrO1xyXG5leHBvcnRzLnJlbmRlckFycm93QmFzZTY0PXJlbmRlckFycm93QmFzZTY0O1xyXG5leHBvcnRzLnJlbmRlckRpcmVjdGlvbkJhc2U2ND1yZW5kZXJEaXJlY3Rpb25CYXNlNjQ7XHJcbmV4cG9ydHMucmVuZGVyQm94QmFzZTY0PXJlbmRlckJveEJhc2U2NDtcclxuZXhwb3J0cy5pbnRlcmNlcHRPbkNpcmNsZT1pbnRlcmNlcHRPbkNpcmNsZTtcclxuZXhwb3J0cy5kaXN0cD1kaXN0cDtcclxuZXhwb3J0cy5jaXJjbGVMaW5lSW50ZXJzZWN0PWNpcmNsZUxpbmVJbnRlcnNlY3Q7XHJcbmV4cG9ydHMuTU9CSUxFPW1vYmlsZUFuZFRhYmxldENoZWNrKCk7XHJcbmV4cG9ydHMuV0dTODRTUEhFUkU9bmV3IFdHUzg0U3BoZXJlKDYzNzgxMzcpO1xyXG5leHBvcnRzLmZvcm1hdFRpbWVTZWM9Zm9ybWF0VGltZVNlYztcclxuZXhwb3J0cy5kZWNvZGVCYXNlNjRJbWFnZT1kZWNvZGVCYXNlNjRJbWFnZTtcclxuZXhwb3J0cy5pc0RlZmluZWQ9aXNEZWZpbmVkOyIsIjshZnVuY3Rpb24gKCkgeztcbnZhciBKb29zZSA9IHt9XG5cbi8vIGNvbmZpZ3VyYXRpb24gaGFzaFxuXG5Kb29zZS5DICAgICAgICAgICAgID0gdHlwZW9mIEpPT1NFX0NGRyAhPSAndW5kZWZpbmVkJyA/IEpPT1NFX0NGRyA6IHt9XG5cbkpvb3NlLmlzX0lFICAgICAgICAgPSAnXFx2JyA9PSAndidcbkpvb3NlLmlzX05vZGVKUyAgICAgPSBCb29sZWFuKHR5cGVvZiBwcm9jZXNzICE9ICd1bmRlZmluZWQnICYmIHByb2Nlc3MucGlkKVxuXG5cbkpvb3NlLnRvcCAgICAgICAgICAgPSBKb29zZS5pc19Ob2RlSlMgJiYgZ2xvYmFsIHx8IHRoaXNcblxuSm9vc2Uuc3R1YiAgICAgICAgICA9IGZ1bmN0aW9uICgpIHtcbiAgICByZXR1cm4gZnVuY3Rpb24gKCkgeyB0aHJvdyBuZXcgRXJyb3IoXCJNb2R1bGVzIGNhbiBub3QgYmUgaW5zdGFudGlhdGVkXCIpIH1cbn1cblxuXG5Kb29zZS5WRVJTSU9OICAgICAgID0gKHsgLypQS0dWRVJTSU9OKi9WRVJTSU9OIDogJzMuNTAuMCcgfSkuVkVSU0lPTlxuXG5cbmlmICh0eXBlb2YgbW9kdWxlICE9ICd1bmRlZmluZWQnKSBtb2R1bGUuZXhwb3J0cyA9IEpvb3NlXG4vKmlmICghSm9vc2UuaXNfTm9kZUpTKSAqL1xudGhpcy5Kb29zZSA9IEpvb3NlXG5cblxuLy8gU3RhdGljIGhlbHBlcnMgZm9yIEFycmF5c1xuSm9vc2UuQSA9IHtcblxuICAgIGVhY2ggOiBmdW5jdGlvbiAoYXJyYXksIGZ1bmMsIHNjb3BlKSB7XG4gICAgICAgIHNjb3BlID0gc2NvcGUgfHwgdGhpc1xuICAgICAgICBcbiAgICAgICAgZm9yICh2YXIgaSA9IDAsIGxlbiA9IGFycmF5Lmxlbmd0aDsgaSA8IGxlbjsgaSsrKSBcbiAgICAgICAgICAgIGlmIChmdW5jLmNhbGwoc2NvcGUsIGFycmF5W2ldLCBpKSA9PT0gZmFsc2UpIHJldHVybiBmYWxzZVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgZWFjaFIgOiBmdW5jdGlvbiAoYXJyYXksIGZ1bmMsIHNjb3BlKSB7XG4gICAgICAgIHNjb3BlID0gc2NvcGUgfHwgdGhpc1xuXG4gICAgICAgIGZvciAodmFyIGkgPSBhcnJheS5sZW5ndGggLSAxOyBpID49IDA7IGktLSkgXG4gICAgICAgICAgICBpZiAoZnVuYy5jYWxsKHNjb3BlLCBhcnJheVtpXSwgaSkgPT09IGZhbHNlKSByZXR1cm4gZmFsc2VcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGV4aXN0cyA6IGZ1bmN0aW9uIChhcnJheSwgdmFsdWUpIHtcbiAgICAgICAgZm9yICh2YXIgaSA9IDAsIGxlbiA9IGFycmF5Lmxlbmd0aDsgaSA8IGxlbjsgaSsrKSBpZiAoYXJyYXlbaV0gPT0gdmFsdWUpIHJldHVybiB0cnVlXG4gICAgICAgICAgICBcbiAgICAgICAgcmV0dXJuIGZhbHNlXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBtYXAgOiBmdW5jdGlvbiAoYXJyYXksIGZ1bmMsIHNjb3BlKSB7XG4gICAgICAgIHNjb3BlID0gc2NvcGUgfHwgdGhpc1xuICAgICAgICBcbiAgICAgICAgdmFyIHJlcyA9IFtdXG4gICAgICAgIFxuICAgICAgICBmb3IgKHZhciBpID0gMCwgbGVuID0gYXJyYXkubGVuZ3RoOyBpIDwgbGVuOyBpKyspIFxuICAgICAgICAgICAgcmVzLnB1c2goIGZ1bmMuY2FsbChzY29wZSwgYXJyYXlbaV0sIGkpIClcbiAgICAgICAgICAgIFxuICAgICAgICByZXR1cm4gcmVzXG4gICAgfSxcbiAgICBcblxuICAgIGdyZXAgOiBmdW5jdGlvbiAoYXJyYXksIGZ1bmMpIHtcbiAgICAgICAgdmFyIGEgPSBbXVxuICAgICAgICBcbiAgICAgICAgSm9vc2UuQS5lYWNoKGFycmF5LCBmdW5jdGlvbiAodCkge1xuICAgICAgICAgICAgaWYgKGZ1bmModCkpIGEucHVzaCh0KVxuICAgICAgICB9KVxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIGFcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIHJlbW92ZSA6IGZ1bmN0aW9uIChhcnJheSwgcmVtb3ZlRWxlKSB7XG4gICAgICAgIHZhciBhID0gW11cbiAgICAgICAgXG4gICAgICAgIEpvb3NlLkEuZWFjaChhcnJheSwgZnVuY3Rpb24gKHQpIHtcbiAgICAgICAgICAgIGlmICh0ICE9PSByZW1vdmVFbGUpIGEucHVzaCh0KVxuICAgICAgICB9KVxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIGFcbiAgICB9XG4gICAgXG59XG5cbi8vIFN0YXRpYyBoZWxwZXJzIGZvciBTdHJpbmdzXG5Kb29zZS5TID0ge1xuICAgIFxuICAgIHNhbmVTcGxpdCA6IGZ1bmN0aW9uIChzdHIsIGRlbGltZXRlcikge1xuICAgICAgICB2YXIgcmVzID0gKHN0ciB8fCAnJykuc3BsaXQoZGVsaW1ldGVyKVxuICAgICAgICBcbiAgICAgICAgaWYgKHJlcy5sZW5ndGggPT0gMSAmJiAhcmVzWzBdKSByZXMuc2hpZnQoKVxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIHJlc1xuICAgIH0sXG4gICAgXG5cbiAgICB1cHBlcmNhc2VGaXJzdCA6IGZ1bmN0aW9uIChzdHJpbmcpIHsgXG4gICAgICAgIHJldHVybiBzdHJpbmcuc3Vic3RyKDAsIDEpLnRvVXBwZXJDYXNlKCkgKyBzdHJpbmcuc3Vic3RyKDEsIHN0cmluZy5sZW5ndGggLSAxKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgc3RyVG9DbGFzcyA6IGZ1bmN0aW9uIChuYW1lLCB0b3ApIHtcbiAgICAgICAgdmFyIGN1cnJlbnQgPSB0b3AgfHwgSm9vc2UudG9wXG4gICAgICAgIFxuICAgICAgICBKb29zZS5BLmVhY2gobmFtZS5zcGxpdCgnLicpLCBmdW5jdGlvbiAoc2VnbWVudCkge1xuICAgICAgICAgICAgaWYgKGN1cnJlbnQpIFxuICAgICAgICAgICAgICAgIGN1cnJlbnQgPSBjdXJyZW50WyBzZWdtZW50IF1cbiAgICAgICAgICAgIGVsc2VcbiAgICAgICAgICAgICAgICByZXR1cm4gZmFsc2VcbiAgICAgICAgfSlcbiAgICAgICAgXG4gICAgICAgIHJldHVybiBjdXJyZW50XG4gICAgfVxufVxuXG52YXIgYmFzZUZ1bmMgICAgPSBmdW5jdGlvbiAoKSB7fVxuXG4vLyBTdGF0aWMgaGVscGVycyBmb3Igb2JqZWN0c1xuSm9vc2UuTyA9IHtcblxuICAgIGVhY2ggOiBmdW5jdGlvbiAob2JqZWN0LCBmdW5jLCBzY29wZSkge1xuICAgICAgICBzY29wZSA9IHNjb3BlIHx8IHRoaXNcbiAgICAgICAgXG4gICAgICAgIGZvciAodmFyIGkgaW4gb2JqZWN0KSBcbiAgICAgICAgICAgIGlmIChmdW5jLmNhbGwoc2NvcGUsIG9iamVjdFtpXSwgaSkgPT09IGZhbHNlKSByZXR1cm4gZmFsc2VcbiAgICAgICAgXG4gICAgICAgIGlmIChKb29zZS5pc19JRSkgXG4gICAgICAgICAgICByZXR1cm4gSm9vc2UuQS5lYWNoKFsgJ3RvU3RyaW5nJywgJ2NvbnN0cnVjdG9yJywgJ2hhc093blByb3BlcnR5JyBdLCBmdW5jdGlvbiAoZWwpIHtcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBpZiAob2JqZWN0Lmhhc093blByb3BlcnR5KGVsKSkgcmV0dXJuIGZ1bmMuY2FsbChzY29wZSwgb2JqZWN0W2VsXSwgZWwpXG4gICAgICAgICAgICB9KVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgZWFjaE93biA6IGZ1bmN0aW9uIChvYmplY3QsIGZ1bmMsIHNjb3BlKSB7XG4gICAgICAgIHNjb3BlID0gc2NvcGUgfHwgdGhpc1xuICAgICAgICBcbiAgICAgICAgcmV0dXJuIEpvb3NlLk8uZWFjaChvYmplY3QsIGZ1bmN0aW9uICh2YWx1ZSwgbmFtZSkge1xuICAgICAgICAgICAgaWYgKG9iamVjdC5oYXNPd25Qcm9wZXJ0eShuYW1lKSkgcmV0dXJuIGZ1bmMuY2FsbChzY29wZSwgdmFsdWUsIG5hbWUpXG4gICAgICAgIH0sIHNjb3BlKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgY29weSA6IGZ1bmN0aW9uIChzb3VyY2UsIHRhcmdldCkge1xuICAgICAgICB0YXJnZXQgPSB0YXJnZXQgfHwge31cbiAgICAgICAgXG4gICAgICAgIEpvb3NlLk8uZWFjaChzb3VyY2UsIGZ1bmN0aW9uICh2YWx1ZSwgbmFtZSkgeyB0YXJnZXRbbmFtZV0gPSB2YWx1ZSB9KVxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIHRhcmdldFxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgY29weU93biA6IGZ1bmN0aW9uIChzb3VyY2UsIHRhcmdldCkge1xuICAgICAgICB0YXJnZXQgPSB0YXJnZXQgfHwge31cbiAgICAgICAgXG4gICAgICAgIEpvb3NlLk8uZWFjaE93bihzb3VyY2UsIGZ1bmN0aW9uICh2YWx1ZSwgbmFtZSkgeyB0YXJnZXRbbmFtZV0gPSB2YWx1ZSB9KVxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIHRhcmdldFxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgZ2V0TXV0YWJsZUNvcHkgOiBmdW5jdGlvbiAob2JqZWN0KSB7XG4gICAgICAgIGJhc2VGdW5jLnByb3RvdHlwZSA9IG9iamVjdFxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIG5ldyBiYXNlRnVuYygpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBleHRlbmQgOiBmdW5jdGlvbiAodGFyZ2V0LCBzb3VyY2UpIHtcbiAgICAgICAgcmV0dXJuIEpvb3NlLk8uY29weShzb3VyY2UsIHRhcmdldClcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGlzRW1wdHkgOiBmdW5jdGlvbiAob2JqZWN0KSB7XG4gICAgICAgIGZvciAodmFyIGkgaW4gb2JqZWN0KSBpZiAob2JqZWN0Lmhhc093blByb3BlcnR5KGkpKSByZXR1cm4gZmFsc2VcbiAgICAgICAgXG4gICAgICAgIHJldHVybiB0cnVlXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBpc0luc3RhbmNlOiBmdW5jdGlvbiAob2JqKSB7XG4gICAgICAgIHJldHVybiBvYmogJiYgb2JqLm1ldGEgJiYgb2JqLmNvbnN0cnVjdG9yID09IG9iai5tZXRhLmNcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGlzQ2xhc3MgOiBmdW5jdGlvbiAob2JqKSB7XG4gICAgICAgIHJldHVybiBvYmogJiYgb2JqLm1ldGEgJiYgb2JqLm1ldGEuYyA9PSBvYmpcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIHdhbnRBcnJheSA6IGZ1bmN0aW9uIChvYmopIHtcbiAgICAgICAgaWYgKG9iaiBpbnN0YW5jZW9mIEFycmF5KSByZXR1cm4gb2JqXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gWyBvYmogXVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgLy8gdGhpcyB3YXMgYSBidWcgaW4gV2ViS2l0LCB3aGljaCBnaXZlcyB0eXBlb2YgLyAvID09ICdmdW5jdGlvbidcbiAgICAvLyBzaG91bGQgYmUgbW9uaXRvcmVkIGFuZCByZW1vdmVkIGF0IHNvbWUgcG9pbnQgaW4gdGhlIGZ1dHVyZVxuICAgIGlzRnVuY3Rpb24gOiBmdW5jdGlvbiAob2JqKSB7XG4gICAgICAgIHJldHVybiB0eXBlb2Ygb2JqID09ICdmdW5jdGlvbicgJiYgb2JqLmNvbnN0cnVjdG9yICE9IC8gLy5jb25zdHJ1Y3RvclxuICAgIH1cbn1cblxuXG4vL2luaXRpYWxpemVyc1xuXG5Kb29zZS5JID0ge1xuICAgIEFycmF5ICAgICAgIDogZnVuY3Rpb24gKCkgeyByZXR1cm4gW10gfSxcbiAgICBPYmplY3QgICAgICA6IGZ1bmN0aW9uICgpIHsgcmV0dXJuIHt9IH0sXG4gICAgRnVuY3Rpb24gICAgOiBmdW5jdGlvbiAoKSB7IHJldHVybiBhcmd1bWVudHMuY2FsbGVlIH0sXG4gICAgTm93ICAgICAgICAgOiBmdW5jdGlvbiAoKSB7IHJldHVybiBuZXcgRGF0ZSgpIH1cbn07XG5Kb29zZS5Qcm90byA9IEpvb3NlLnN0dWIoKVxuXG5Kb29zZS5Qcm90by5FbXB0eSA9IEpvb3NlLnN0dWIoKVxuICAgIFxuSm9vc2UuUHJvdG8uRW1wdHkubWV0YSA9IHt9O1xuOyhmdW5jdGlvbiAoKSB7XG5cbiAgICBKb29zZS5Qcm90by5PYmplY3QgPSBKb29zZS5zdHViKClcbiAgICBcbiAgICBcbiAgICB2YXIgU1VQRVIgPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHZhciBzZWxmID0gU1VQRVIuY2FsbGVyXG4gICAgICAgIFxuICAgICAgICBpZiAoc2VsZiA9PSBTVVBFUkFSRykgc2VsZiA9IHNlbGYuY2FsbGVyXG4gICAgICAgIFxuICAgICAgICBpZiAoIXNlbGYuU1VQRVIpIHRocm93IFwiSW52YWxpZCBjYWxsIHRvIFNVUEVSXCJcbiAgICAgICAgXG4gICAgICAgIHJldHVybiBzZWxmLlNVUEVSW3NlbGYubWV0aG9kTmFtZV0uYXBwbHkodGhpcywgYXJndW1lbnRzKVxuICAgIH1cbiAgICBcbiAgICBcbiAgICB2YXIgU1VQRVJBUkcgPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHJldHVybiB0aGlzLlNVUEVSLmFwcGx5KHRoaXMsIGFyZ3VtZW50c1swXSlcbiAgICB9XG4gICAgXG4gICAgXG4gICAgXG4gICAgSm9vc2UuUHJvdG8uT2JqZWN0LnByb3RvdHlwZSA9IHtcbiAgICAgICAgXG4gICAgICAgIFNVUEVSQVJHIDogU1VQRVJBUkcsXG4gICAgICAgIFNVUEVSIDogU1VQRVIsXG4gICAgICAgIFxuICAgICAgICBJTk5FUiA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHRocm93IFwiSW52YWxpZCBjYWxsIHRvIElOTkVSXCJcbiAgICAgICAgfSwgICAgICAgICAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgQlVJTEQgOiBmdW5jdGlvbiAoY29uZmlnKSB7XG4gICAgICAgICAgICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aCA9PSAxICYmIHR5cGVvZiBjb25maWcgPT0gJ29iamVjdCcgJiYgY29uZmlnIHx8IHt9XG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgaW5pdGlhbGl6ZTogZnVuY3Rpb24gKCkge1xuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIHRvU3RyaW5nOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICByZXR1cm4gXCJhIFwiICsgdGhpcy5tZXRhLm5hbWVcbiAgICAgICAgfVxuICAgICAgICBcbiAgICB9XG4gICAgICAgIFxuICAgIEpvb3NlLlByb3RvLk9iamVjdC5tZXRhID0ge1xuICAgICAgICBjb25zdHJ1Y3RvciAgICAgOiBKb29zZS5Qcm90by5PYmplY3QsXG4gICAgICAgIFxuICAgICAgICBtZXRob2RzICAgICAgICAgOiBKb29zZS5PLmNvcHkoSm9vc2UuUHJvdG8uT2JqZWN0LnByb3RvdHlwZSksXG4gICAgICAgIGF0dHJpYnV0ZXMgICAgICA6IHt9XG4gICAgfVxuICAgIFxuICAgIEpvb3NlLlByb3RvLk9iamVjdC5wcm90b3R5cGUubWV0YSA9IEpvb3NlLlByb3RvLk9iamVjdC5tZXRhXG5cbn0pKCk7XG47KGZ1bmN0aW9uICgpIHtcblxuICAgIEpvb3NlLlByb3RvLkNsYXNzID0gZnVuY3Rpb24gKCkge1xuICAgICAgICByZXR1cm4gdGhpcy5pbml0aWFsaXplKHRoaXMuQlVJTEQuYXBwbHkodGhpcywgYXJndW1lbnRzKSkgfHwgdGhpc1xuICAgIH1cbiAgICBcbiAgICB2YXIgYm9vdHN0cmFwID0ge1xuICAgICAgICBcbiAgICAgICAgVkVSU0lPTiAgICAgICAgICAgICA6IG51bGwsXG4gICAgICAgIEFVVEhPUklUWSAgICAgICAgICAgOiBudWxsLFxuICAgICAgICBcbiAgICAgICAgY29uc3RydWN0b3IgICAgICAgICA6IEpvb3NlLlByb3RvLkNsYXNzLFxuICAgICAgICBzdXBlckNsYXNzICAgICAgICAgIDogbnVsbCxcbiAgICAgICAgXG4gICAgICAgIG5hbWUgICAgICAgICAgICAgICAgOiBudWxsLFxuICAgICAgICBcbiAgICAgICAgYXR0cmlidXRlcyAgICAgICAgICA6IG51bGwsXG4gICAgICAgIG1ldGhvZHMgICAgICAgICAgICAgOiBudWxsLFxuICAgICAgICBcbiAgICAgICAgbWV0YSAgICAgICAgICAgICAgICA6IG51bGwsXG4gICAgICAgIGMgICAgICAgICAgICAgICAgICAgOiBudWxsLFxuICAgICAgICBcbiAgICAgICAgZGVmYXVsdFN1cGVyQ2xhc3MgICA6IEpvb3NlLlByb3RvLk9iamVjdCxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBCVUlMRCA6IGZ1bmN0aW9uIChuYW1lLCBleHRlbmQpIHtcbiAgICAgICAgICAgIHRoaXMubmFtZSA9IG5hbWVcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcmV0dXJuIHsgX19leHRlbmRfXyA6IGV4dGVuZCB8fCB7fSB9XG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgaW5pdGlhbGl6ZTogZnVuY3Rpb24gKHByb3BzKSB7XG4gICAgICAgICAgICB2YXIgZXh0ZW5kICAgICAgPSBwcm9wcy5fX2V4dGVuZF9fXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXMuVkVSU0lPTiAgICA9IGV4dGVuZC5WRVJTSU9OXG4gICAgICAgICAgICB0aGlzLkFVVEhPUklUWSAgPSBleHRlbmQuQVVUSE9SSVRZXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGRlbGV0ZSBleHRlbmQuVkVSU0lPTlxuICAgICAgICAgICAgZGVsZXRlIGV4dGVuZC5BVVRIT1JJVFlcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpcy5jID0gdGhpcy5leHRyYWN0Q29uc3RydWN0b3IoZXh0ZW5kKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLmFkYXB0Q29uc3RydWN0b3IodGhpcy5jKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAoZXh0ZW5kLmNvbnN0cnVjdG9yT25seSkge1xuICAgICAgICAgICAgICAgIGRlbGV0ZSBleHRlbmQuY29uc3RydWN0b3JPbmx5XG4gICAgICAgICAgICAgICAgcmV0dXJuXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXMuY29uc3RydWN0KGV4dGVuZClcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBjb25zdHJ1Y3QgOiBmdW5jdGlvbiAoZXh0ZW5kKSB7XG4gICAgICAgICAgICBpZiAoIXRoaXMucHJlcGFyZVByb3BzKGV4dGVuZCkpIHJldHVyblxuICAgICAgICAgICAgXG4gICAgICAgICAgICB2YXIgc3VwZXJDbGFzcyA9IHRoaXMuc3VwZXJDbGFzcyA9IHRoaXMuZXh0cmFjdFN1cGVyQ2xhc3MoZXh0ZW5kKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLnByb2Nlc3NTdXBlckNsYXNzKHN1cGVyQ2xhc3MpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXMuYWRhcHRQcm90b3R5cGUodGhpcy5jLnByb3RvdHlwZSlcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpcy5maW5hbGl6ZShleHRlbmQpXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgZmluYWxpemUgOiBmdW5jdGlvbiAoZXh0ZW5kKSB7XG4gICAgICAgICAgICB0aGlzLnByb2Nlc3NTdGVtKGV4dGVuZClcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpcy5leHRlbmQoZXh0ZW5kKVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIC8vaWYgdGhlIGV4dGVuc2lvbiByZXR1cm5zIGZhbHNlIGZyb20gdGhpcyBtZXRob2QgaXQgc2hvdWxkIHJlLWVudGVyICdjb25zdHJ1Y3QnXG4gICAgICAgIHByZXBhcmVQcm9wcyA6IGZ1bmN0aW9uIChleHRlbmQpIHtcbiAgICAgICAgICAgIHJldHVybiB0cnVlXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgZXh0cmFjdENvbnN0cnVjdG9yIDogZnVuY3Rpb24gKGV4dGVuZCkge1xuICAgICAgICAgICAgdmFyIHJlcyA9IGV4dGVuZC5oYXNPd25Qcm9wZXJ0eSgnY29uc3RydWN0b3InKSA/IGV4dGVuZC5jb25zdHJ1Y3RvciA6IHRoaXMuZGVmYXVsdENvbnN0cnVjdG9yKClcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgZGVsZXRlIGV4dGVuZC5jb25zdHJ1Y3RvclxuICAgICAgICAgICAgXG4gICAgICAgICAgICByZXR1cm4gcmVzXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgZXh0cmFjdFN1cGVyQ2xhc3MgOiBmdW5jdGlvbiAoZXh0ZW5kKSB7XG4gICAgICAgICAgICBpZiAoZXh0ZW5kLmhhc093blByb3BlcnR5KCdpc2EnKSAmJiAhZXh0ZW5kLmlzYSkgdGhyb3cgbmV3IEVycm9yKFwiQXR0ZW1wdCB0byBpbmhlcml0IGZyb20gdW5kZWZpbmVkIHN1cGVyY2xhc3MgW1wiICsgdGhpcy5uYW1lICsgXCJdXCIpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciByZXMgPSBleHRlbmQuaXNhIHx8IHRoaXMuZGVmYXVsdFN1cGVyQ2xhc3NcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgZGVsZXRlIGV4dGVuZC5pc2FcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcmV0dXJuIHJlc1xuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIHByb2Nlc3NTdGVtIDogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgdmFyIHN1cGVyTWV0YSAgICAgICA9IHRoaXMuc3VwZXJDbGFzcy5tZXRhXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXMubWV0aG9kcyAgICAgICAgPSBKb29zZS5PLmdldE11dGFibGVDb3B5KHN1cGVyTWV0YS5tZXRob2RzIHx8IHt9KVxuICAgICAgICAgICAgdGhpcy5hdHRyaWJ1dGVzICAgICA9IEpvb3NlLk8uZ2V0TXV0YWJsZUNvcHkoc3VwZXJNZXRhLmF0dHJpYnV0ZXMgfHwge30pXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgaW5pdEluc3RhbmNlIDogZnVuY3Rpb24gKGluc3RhbmNlLCBwcm9wcykge1xuICAgICAgICAgICAgSm9vc2UuTy5jb3B5T3duKHByb3BzLCBpbnN0YW5jZSlcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBkZWZhdWx0Q29uc3RydWN0b3I6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHJldHVybiBmdW5jdGlvbiAoYXJnKSB7XG4gICAgICAgICAgICAgICAgdmFyIEJVSUxEID0gdGhpcy5CVUlMRFxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIHZhciBhcmdzID0gQlVJTEQgJiYgQlVJTEQuYXBwbHkodGhpcywgYXJndW1lbnRzKSB8fCBhcmcgfHwge31cbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICB2YXIgdGhpc01ldGEgICAgPSB0aGlzLm1ldGFcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICB0aGlzTWV0YS5pbml0SW5zdGFuY2UodGhpcywgYXJncylcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICByZXR1cm4gdGhpc01ldGEuaGFzTWV0aG9kKCdpbml0aWFsaXplJykgJiYgdGhpcy5pbml0aWFsaXplKGFyZ3MpIHx8IHRoaXNcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBwcm9jZXNzU3VwZXJDbGFzczogZnVuY3Rpb24gKHN1cGVyQ2xhc3MpIHtcbiAgICAgICAgICAgIHZhciBzdXBlclByb3RvICAgICAgPSBzdXBlckNsYXNzLnByb3RvdHlwZVxuICAgICAgICAgICAgXG4gICAgICAgICAgICAvL25vbi1Kb29zZSBzdXBlcmNsYXNzZXNcbiAgICAgICAgICAgIGlmICghc3VwZXJDbGFzcy5tZXRhKSB7XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgdmFyIGV4dGVuZCA9IEpvb3NlLk8uY29weShzdXBlclByb3RvKVxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIGV4dGVuZC5pc2EgPSBKb29zZS5Qcm90by5FbXB0eVxuICAgICAgICAgICAgICAgIC8vIGNsZWFyIHBvdGVudGlhbCB2YWx1ZSBpbiB0aGUgYGV4dGVuZC5jb25zdHJ1Y3RvcmAgdG8gcHJldmVudCBpdCBmcm9tIGJlaW5nIG1vZGlmaWVkXG4gICAgICAgICAgICAgICAgZGVsZXRlIGV4dGVuZC5jb25zdHJ1Y3RvclxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIHZhciBtZXRhID0gbmV3IHRoaXMuZGVmYXVsdFN1cGVyQ2xhc3MubWV0YS5jb25zdHJ1Y3RvcihudWxsLCBleHRlbmQpXG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgc3VwZXJDbGFzcy5tZXRhID0gc3VwZXJQcm90by5tZXRhID0gbWV0YVxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIG1ldGEuYyA9IHN1cGVyQ2xhc3NcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpcy5jLnByb3RvdHlwZSAgICA9IEpvb3NlLk8uZ2V0TXV0YWJsZUNvcHkoc3VwZXJQcm90bylcbiAgICAgICAgICAgIHRoaXMuYy5zdXBlckNsYXNzICAgPSBzdXBlclByb3RvXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgYWRhcHRDb25zdHJ1Y3RvcjogZnVuY3Rpb24gKGMpIHtcbiAgICAgICAgICAgIGMubWV0YSA9IHRoaXNcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKCFjLmhhc093blByb3BlcnR5KCd0b1N0cmluZycpKSBjLnRvU3RyaW5nID0gZnVuY3Rpb24gKCkgeyByZXR1cm4gdGhpcy5tZXRhLm5hbWUgfVxuICAgICAgICB9LFxuICAgIFxuICAgICAgICBcbiAgICAgICAgYWRhcHRQcm90b3R5cGU6IGZ1bmN0aW9uIChwcm90bykge1xuICAgICAgICAgICAgLy90aGlzIHdpbGwgZml4IHdlaXJkIHNlbWFudGljIG9mIG5hdGl2ZSBcImNvbnN0cnVjdG9yXCIgcHJvcGVydHkgdG8gbW9yZSBpbnR1aXRpdmUgKGlkZWEgYm9ycm93ZWQgZnJvbSBFeHQpXG4gICAgICAgICAgICBwcm90by5jb25zdHJ1Y3RvciAgID0gdGhpcy5jXG4gICAgICAgICAgICBwcm90by5tZXRhICAgICAgICAgID0gdGhpc1xuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIGFkZE1ldGhvZDogZnVuY3Rpb24gKG5hbWUsIGZ1bmMpIHtcbiAgICAgICAgICAgIGZ1bmMuU1VQRVIgPSB0aGlzLnN1cGVyQ2xhc3MucHJvdG90eXBlXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vY2hyb21lIGRvbid0IGFsbG93IHRvIHJlZGVmaW5lIHRoZSBcIm5hbWVcIiBwcm9wZXJ0eVxuICAgICAgICAgICAgZnVuYy5tZXRob2ROYW1lID0gbmFtZVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLm1ldGhvZHNbbmFtZV0gPSBmdW5jXG4gICAgICAgICAgICB0aGlzLmMucHJvdG90eXBlW25hbWVdID0gZnVuY1xuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIGFkZEF0dHJpYnV0ZTogZnVuY3Rpb24gKG5hbWUsIGluaXQpIHtcbiAgICAgICAgICAgIHRoaXMuYXR0cmlidXRlc1tuYW1lXSA9IGluaXRcbiAgICAgICAgICAgIHRoaXMuYy5wcm90b3R5cGVbbmFtZV0gPSBpbml0XG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgcmVtb3ZlTWV0aG9kIDogZnVuY3Rpb24gKG5hbWUpIHtcbiAgICAgICAgICAgIGRlbGV0ZSB0aGlzLm1ldGhvZHNbbmFtZV1cbiAgICAgICAgICAgIGRlbGV0ZSB0aGlzLmMucHJvdG90eXBlW25hbWVdXG4gICAgICAgIH0sXG4gICAgXG4gICAgICAgIFxuICAgICAgICByZW1vdmVBdHRyaWJ1dGU6IGZ1bmN0aW9uIChuYW1lKSB7XG4gICAgICAgICAgICBkZWxldGUgdGhpcy5hdHRyaWJ1dGVzW25hbWVdXG4gICAgICAgICAgICBkZWxldGUgdGhpcy5jLnByb3RvdHlwZVtuYW1lXVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIGhhc01ldGhvZDogZnVuY3Rpb24gKG5hbWUpIHsgXG4gICAgICAgICAgICByZXR1cm4gQm9vbGVhbih0aGlzLm1ldGhvZHNbbmFtZV0pXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgaGFzQXR0cmlidXRlOiBmdW5jdGlvbiAobmFtZSkgeyBcbiAgICAgICAgICAgIHJldHVybiB0aGlzLmF0dHJpYnV0ZXNbbmFtZV0gIT09IHVuZGVmaW5lZFxuICAgICAgICB9LFxuICAgICAgICBcbiAgICBcbiAgICAgICAgaGFzT3duTWV0aG9kOiBmdW5jdGlvbiAobmFtZSkgeyBcbiAgICAgICAgICAgIHJldHVybiB0aGlzLmhhc01ldGhvZChuYW1lKSAmJiB0aGlzLm1ldGhvZHMuaGFzT3duUHJvcGVydHkobmFtZSlcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBoYXNPd25BdHRyaWJ1dGU6IGZ1bmN0aW9uIChuYW1lKSB7IFxuICAgICAgICAgICAgcmV0dXJuIHRoaXMuaGFzQXR0cmlidXRlKG5hbWUpICYmIHRoaXMuYXR0cmlidXRlcy5oYXNPd25Qcm9wZXJ0eShuYW1lKVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIGV4dGVuZCA6IGZ1bmN0aW9uIChwcm9wcykge1xuICAgICAgICAgICAgSm9vc2UuTy5lYWNoT3duKHByb3BzLCBmdW5jdGlvbiAodmFsdWUsIG5hbWUpIHtcbiAgICAgICAgICAgICAgICBpZiAobmFtZSAhPSAnbWV0YScgJiYgbmFtZSAhPSAnY29uc3RydWN0b3InKSBcbiAgICAgICAgICAgICAgICAgICAgaWYgKEpvb3NlLk8uaXNGdW5jdGlvbih2YWx1ZSkgJiYgIXZhbHVlLm1ldGEpIFxuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5hZGRNZXRob2QobmFtZSwgdmFsdWUpIFxuICAgICAgICAgICAgICAgICAgICBlbHNlIFxuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5hZGRBdHRyaWJ1dGUobmFtZSwgdmFsdWUpXG4gICAgICAgICAgICB9LCB0aGlzKVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIHN1YkNsYXNzT2YgOiBmdW5jdGlvbiAoY2xhc3NPYmplY3QsIGV4dGVuZCkge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuc3ViQ2xhc3MoZXh0ZW5kLCBudWxsLCBjbGFzc09iamVjdClcbiAgICAgICAgfSxcbiAgICBcbiAgICBcbiAgICAgICAgc3ViQ2xhc3MgOiBmdW5jdGlvbiAoZXh0ZW5kLCBuYW1lLCBjbGFzc09iamVjdCkge1xuICAgICAgICAgICAgZXh0ZW5kICAgICAgPSBleHRlbmQgICAgICAgIHx8IHt9XG4gICAgICAgICAgICBleHRlbmQuaXNhICA9IGNsYXNzT2JqZWN0ICAgfHwgdGhpcy5jXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHJldHVybiBuZXcgdGhpcy5jb25zdHJ1Y3RvcihuYW1lLCBleHRlbmQpLmNcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBpbnN0YW50aWF0ZSA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHZhciBmID0gZnVuY3Rpb24gKCkge31cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgZi5wcm90b3R5cGUgPSB0aGlzLmMucHJvdG90eXBlXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciBvYmogPSBuZXcgZigpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHJldHVybiB0aGlzLmMuYXBwbHkob2JqLCBhcmd1bWVudHMpIHx8IG9ialxuICAgICAgICB9XG4gICAgfVxuICAgIFxuICAgIC8vbWljcm8gYm9vdHN0cmFwaW5nXG4gICAgXG4gICAgSm9vc2UuUHJvdG8uQ2xhc3MucHJvdG90eXBlID0gSm9vc2UuTy5nZXRNdXRhYmxlQ29weShKb29zZS5Qcm90by5PYmplY3QucHJvdG90eXBlKVxuICAgIFxuICAgIEpvb3NlLk8uZXh0ZW5kKEpvb3NlLlByb3RvLkNsYXNzLnByb3RvdHlwZSwgYm9vdHN0cmFwKVxuICAgIFxuICAgIEpvb3NlLlByb3RvLkNsYXNzLnByb3RvdHlwZS5tZXRhID0gbmV3IEpvb3NlLlByb3RvLkNsYXNzKCdKb29zZS5Qcm90by5DbGFzcycsIGJvb3RzdHJhcClcbiAgICBcbiAgICBcbiAgICBcbiAgICBKb29zZS5Qcm90by5DbGFzcy5tZXRhLmFkZE1ldGhvZCgnaXNhJywgZnVuY3Rpb24gKHNvbWVDbGFzcykge1xuICAgICAgICB2YXIgZiA9IGZ1bmN0aW9uICgpIHt9XG4gICAgICAgIFxuICAgICAgICBmLnByb3RvdHlwZSA9IHRoaXMuYy5wcm90b3R5cGVcbiAgICAgICAgXG4gICAgICAgIHJldHVybiBuZXcgZigpIGluc3RhbmNlb2Ygc29tZUNsYXNzXG4gICAgfSlcbn0pKCk7XG5Kb29zZS5NYW5hZ2VkID0gSm9vc2Uuc3R1YigpXG5cbkpvb3NlLk1hbmFnZWQuUHJvcGVydHkgPSBuZXcgSm9vc2UuUHJvdG8uQ2xhc3MoJ0pvb3NlLk1hbmFnZWQuUHJvcGVydHknLCB7XG4gICAgXG4gICAgbmFtZSAgICAgICAgICAgIDogbnVsbCxcbiAgICBcbiAgICBpbml0ICAgICAgICAgICAgOiBudWxsLFxuICAgIHZhbHVlICAgICAgICAgICA6IG51bGwsXG4gICAgXG4gICAgZGVmaW5lZEluICAgICAgIDogbnVsbCxcbiAgICBcbiAgICBcbiAgICBpbml0aWFsaXplIDogZnVuY3Rpb24gKHByb3BzKSB7XG4gICAgICAgIEpvb3NlLk1hbmFnZWQuUHJvcGVydHkuc3VwZXJDbGFzcy5pbml0aWFsaXplLmNhbGwodGhpcywgcHJvcHMpXG4gICAgICAgIFxuICAgICAgICB0aGlzLmNvbXB1dGVWYWx1ZSgpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBjb21wdXRlVmFsdWUgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHRoaXMudmFsdWUgPSB0aGlzLmluaXRcbiAgICB9LCAgICBcbiAgICBcbiAgICBcbiAgICAvL3RhcmdldENsYXNzIGlzIHN0aWxsIG9wZW4gYXQgdGhpcyBzdGFnZVxuICAgIHByZUFwcGx5IDogZnVuY3Rpb24gKHRhcmdldENsYXNzKSB7XG4gICAgfSxcbiAgICBcblxuICAgIC8vdGFyZ2V0Q2xhc3MgaXMgYWxyZWFkeSBvcGVuIGF0IHRoaXMgc3RhZ2VcbiAgICBwb3N0VW5BcHBseSA6IGZ1bmN0aW9uICh0YXJnZXRDbGFzcykge1xuICAgIH0sXG4gICAgXG4gICAgXG4gICAgYXBwbHkgOiBmdW5jdGlvbiAodGFyZ2V0KSB7XG4gICAgICAgIHRhcmdldFt0aGlzLm5hbWVdID0gdGhpcy52YWx1ZVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgaXNBcHBsaWVkVG8gOiBmdW5jdGlvbiAodGFyZ2V0KSB7XG4gICAgICAgIHJldHVybiB0YXJnZXRbdGhpcy5uYW1lXSA9PSB0aGlzLnZhbHVlXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICB1bmFwcGx5IDogZnVuY3Rpb24gKGZyb20pIHtcbiAgICAgICAgaWYgKCF0aGlzLmlzQXBwbGllZFRvKGZyb20pKSB0aHJvdyBcIlVuYXBwbHkgb2YgcHJvcGVydHkgW1wiICsgdGhpcy5uYW1lICsgXCJdIGZyb20gW1wiICsgZnJvbSArIFwiXSBmYWlsZWRcIlxuICAgICAgICBcbiAgICAgICAgZGVsZXRlIGZyb21bdGhpcy5uYW1lXVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgY2xvbmVQcm9wcyA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIG5hbWUgICAgICAgIDogdGhpcy5uYW1lLCBcbiAgICAgICAgICAgIGluaXQgICAgICAgIDogdGhpcy5pbml0LFxuICAgICAgICAgICAgZGVmaW5lZEluICAgOiB0aGlzLmRlZmluZWRJblxuICAgICAgICB9XG4gICAgfSxcblxuICAgIFxuICAgIGNsb25lIDogZnVuY3Rpb24gKG5hbWUpIHtcbiAgICAgICAgdmFyIHByb3BzID0gdGhpcy5jbG9uZVByb3BzKClcbiAgICAgICAgXG4gICAgICAgIHByb3BzLm5hbWUgPSBuYW1lIHx8IHByb3BzLm5hbWVcbiAgICAgICAgXG4gICAgICAgIHJldHVybiBuZXcgdGhpcy5jb25zdHJ1Y3Rvcihwcm9wcylcbiAgICB9XG4gICAgXG4gICAgXG59KS5jO1xuSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5Db25mbGljdE1hcmtlciA9IG5ldyBKb29zZS5Qcm90by5DbGFzcygnSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5Db25mbGljdE1hcmtlcicsIHtcbiAgICBcbiAgICBpc2EgOiBKb29zZS5NYW5hZ2VkLlByb3BlcnR5LFxuXG4gICAgYXBwbHkgOiBmdW5jdGlvbiAodGFyZ2V0KSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcIkF0dGVtcHQgdG8gYXBwbHkgQ29uZmxpY3RNYXJrZXIgW1wiICsgdGhpcy5uYW1lICsgXCJdIHRvIFtcIiArIHRhcmdldCArIFwiXVwiKVxuICAgIH1cbiAgICBcbn0pLmM7XG5Kb29zZS5NYW5hZ2VkLlByb3BlcnR5LlJlcXVpcmVtZW50ID0gbmV3IEpvb3NlLlByb3RvLkNsYXNzKCdKb29zZS5NYW5hZ2VkLlByb3BlcnR5LlJlcXVpcmVtZW50Jywge1xuICAgIFxuICAgIGlzYSA6IEpvb3NlLk1hbmFnZWQuUHJvcGVydHksXG5cbiAgICBcbiAgICBhcHBseSA6IGZ1bmN0aW9uICh0YXJnZXQpIHtcbiAgICAgICAgaWYgKCF0YXJnZXQubWV0YS5oYXNNZXRob2QodGhpcy5uYW1lKSkgXG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJSZXF1aXJlbWVudCBbXCIgKyB0aGlzLm5hbWUgKyBcIl0sIGRlZmluZWQgaW4gW1wiICsgdGhpcy5kZWZpbmVkSW4uZGVmaW5lZEluLm5hbWUgKyBcIl0gaXMgbm90IHNhdGlzZmllZCBmb3IgY2xhc3MgW1wiICsgdGFyZ2V0ICsgXCJdXCIpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICB1bmFwcGx5IDogZnVuY3Rpb24gKGZyb20pIHtcbiAgICB9XG4gICAgXG59KS5jO1xuSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5BdHRyaWJ1dGUgPSBuZXcgSm9vc2UuUHJvdG8uQ2xhc3MoJ0pvb3NlLk1hbmFnZWQuUHJvcGVydHkuQXR0cmlidXRlJywge1xuICAgIFxuICAgIGlzYSA6IEpvb3NlLk1hbmFnZWQuUHJvcGVydHksXG4gICAgXG4gICAgc2xvdCAgICAgICAgICAgICAgICA6IG51bGwsXG4gICAgXG4gICAgXG4gICAgaW5pdGlhbGl6ZSA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5BdHRyaWJ1dGUuc3VwZXJDbGFzcy5pbml0aWFsaXplLmFwcGx5KHRoaXMsIGFyZ3VtZW50cylcbiAgICAgICAgXG4gICAgICAgIHRoaXMuc2xvdCA9IHRoaXMubmFtZVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgYXBwbHkgOiBmdW5jdGlvbiAodGFyZ2V0KSB7XG4gICAgICAgIHRhcmdldC5wcm90b3R5cGVbIHRoaXMuc2xvdCBdID0gdGhpcy52YWx1ZVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgaXNBcHBsaWVkVG8gOiBmdW5jdGlvbiAodGFyZ2V0KSB7XG4gICAgICAgIHJldHVybiB0YXJnZXQucHJvdG90eXBlWyB0aGlzLnNsb3QgXSA9PSB0aGlzLnZhbHVlXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICB1bmFwcGx5IDogZnVuY3Rpb24gKGZyb20pIHtcbiAgICAgICAgaWYgKCF0aGlzLmlzQXBwbGllZFRvKGZyb20pKSB0aHJvdyBcIlVuYXBwbHkgb2YgcHJvcGVydHkgW1wiICsgdGhpcy5uYW1lICsgXCJdIGZyb20gW1wiICsgZnJvbSArIFwiXSBmYWlsZWRcIlxuICAgICAgICBcbiAgICAgICAgZGVsZXRlIGZyb20ucHJvdG90eXBlW3RoaXMuc2xvdF1cbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGNsZWFyVmFsdWUgOiBmdW5jdGlvbiAoaW5zdGFuY2UpIHtcbiAgICAgICAgZGVsZXRlIGluc3RhbmNlWyB0aGlzLnNsb3QgXVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgaGFzVmFsdWUgOiBmdW5jdGlvbiAoaW5zdGFuY2UpIHtcbiAgICAgICAgcmV0dXJuIGluc3RhbmNlLmhhc093blByb3BlcnR5KHRoaXMuc2xvdClcbiAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgZ2V0UmF3VmFsdWVGcm9tIDogZnVuY3Rpb24gKGluc3RhbmNlKSB7XG4gICAgICAgIHJldHVybiBpbnN0YW5jZVsgdGhpcy5zbG90IF1cbiAgICB9LFxuICAgIFxuICAgIFxuICAgIHNldFJhd1ZhbHVlVG8gOiBmdW5jdGlvbiAoaW5zdGFuY2UsIHZhbHVlKSB7XG4gICAgICAgIGluc3RhbmNlWyB0aGlzLnNsb3QgXSA9IHZhbHVlXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gdGhpc1xuICAgIH1cbiAgICBcbn0pLmM7XG5Kb29zZS5NYW5hZ2VkLlByb3BlcnR5Lk1ldGhvZE1vZGlmaWVyID0gbmV3IEpvb3NlLlByb3RvLkNsYXNzKCdKb29zZS5NYW5hZ2VkLlByb3BlcnR5Lk1ldGhvZE1vZGlmaWVyJywge1xuICAgIFxuICAgIGlzYSA6IEpvb3NlLk1hbmFnZWQuUHJvcGVydHksXG5cbiAgICBcbiAgICBwcmVwYXJlV3JhcHBlciA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgdGhyb3cgXCJBYnN0cmFjdCBtZXRob2QgW3ByZXBhcmVXcmFwcGVyXSBvZiBcIiArIHRoaXMgKyBcIiB3YXMgY2FsbGVkXCJcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGFwcGx5IDogZnVuY3Rpb24gKHRhcmdldCkge1xuICAgICAgICB2YXIgbmFtZSAgICAgICAgICAgID0gdGhpcy5uYW1lXG4gICAgICAgIHZhciB0YXJnZXRQcm90byAgICAgPSB0YXJnZXQucHJvdG90eXBlXG4gICAgICAgIHZhciBpc093biAgICAgICAgICAgPSB0YXJnZXRQcm90by5oYXNPd25Qcm9wZXJ0eShuYW1lKVxuICAgICAgICB2YXIgb3JpZ2luYWwgICAgICAgID0gdGFyZ2V0UHJvdG9bbmFtZV1cbiAgICAgICAgdmFyIHN1cGVyUHJvdG8gICAgICA9IHRhcmdldC5tZXRhLnN1cGVyQ2xhc3MucHJvdG90eXBlXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgdmFyIG9yaWdpbmFsQ2FsbCA9IGlzT3duID8gb3JpZ2luYWwgOiBmdW5jdGlvbiAoKSB7IFxuICAgICAgICAgICAgcmV0dXJuIHN1cGVyUHJvdG9bbmFtZV0uYXBwbHkodGhpcywgYXJndW1lbnRzKSBcbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgdmFyIG1ldGhvZFdyYXBwZXIgPSB0aGlzLnByZXBhcmVXcmFwcGVyKHtcbiAgICAgICAgICAgIG5hbWUgICAgICAgICAgICA6IG5hbWUsXG4gICAgICAgICAgICBtb2RpZmllciAgICAgICAgOiB0aGlzLnZhbHVlLCBcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaXNPd24gICAgICAgICAgIDogaXNPd24sXG4gICAgICAgICAgICBvcmlnaW5hbENhbGwgICAgOiBvcmlnaW5hbENhbGwsIFxuICAgICAgICAgICAgXG4gICAgICAgICAgICBzdXBlclByb3RvICAgICAgOiBzdXBlclByb3RvLFxuICAgICAgICAgICAgXG4gICAgICAgICAgICB0YXJnZXQgICAgICAgICAgOiB0YXJnZXRcbiAgICAgICAgfSlcbiAgICAgICAgXG4gICAgICAgIGlmIChpc093bikgbWV0aG9kV3JhcHBlci5fX09SSUdJTkFMX18gPSBvcmlnaW5hbFxuICAgICAgICBcbiAgICAgICAgbWV0aG9kV3JhcHBlci5fX0NPTlRBSU5fXyAgID0gdGhpcy52YWx1ZVxuICAgICAgICBtZXRob2RXcmFwcGVyLl9fTUVUSE9EX18gICAgPSB0aGlzXG4gICAgICAgIFxuICAgICAgICB0YXJnZXRQcm90b1tuYW1lXSA9IG1ldGhvZFdyYXBwZXJcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGlzQXBwbGllZFRvIDogZnVuY3Rpb24gKHRhcmdldCkge1xuICAgICAgICB2YXIgdGFyZ2V0Q29udCA9IHRhcmdldC5wcm90b3R5cGVbdGhpcy5uYW1lXVxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIHRhcmdldENvbnQgJiYgdGFyZ2V0Q29udC5fX0NPTlRBSU5fXyA9PSB0aGlzLnZhbHVlXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICB1bmFwcGx5IDogZnVuY3Rpb24gKGZyb20pIHtcbiAgICAgICAgdmFyIG5hbWUgPSB0aGlzLm5hbWVcbiAgICAgICAgdmFyIGZyb21Qcm90byA9IGZyb20ucHJvdG90eXBlXG4gICAgICAgIHZhciBvcmlnaW5hbCA9IGZyb21Qcm90b1tuYW1lXS5fX09SSUdJTkFMX19cbiAgICAgICAgXG4gICAgICAgIGlmICghdGhpcy5pc0FwcGxpZWRUbyhmcm9tKSkgdGhyb3cgXCJVbmFwcGx5IG9mIG1ldGhvZCBbXCIgKyBuYW1lICsgXCJdIGZyb20gY2xhc3MgW1wiICsgZnJvbSArIFwiXSBmYWlsZWRcIlxuICAgICAgICBcbiAgICAgICAgLy9pZiBtb2RpZmllciB3YXMgYXBwbGllZCB0byBvd24gbWV0aG9kIC0gcmVzdG9yZSBpdFxuICAgICAgICBpZiAob3JpZ2luYWwpIFxuICAgICAgICAgICAgZnJvbVByb3RvW25hbWVdID0gb3JpZ2luYWxcbiAgICAgICAgLy9vdGhlcndpc2UgLSBqdXN0IGRlbGV0ZSBpdCwgdG8gcmV2ZWFsIHRoZSBpbmhlcml0ZWQgbWV0aG9kIFxuICAgICAgICBlbHNlXG4gICAgICAgICAgICBkZWxldGUgZnJvbVByb3RvW25hbWVdXG4gICAgfVxuICAgIFxufSkuYztcbkpvb3NlLk1hbmFnZWQuUHJvcGVydHkuTWV0aG9kTW9kaWZpZXIuT3ZlcnJpZGUgPSBuZXcgSm9vc2UuUHJvdG8uQ2xhc3MoJ0pvb3NlLk1hbmFnZWQuUHJvcGVydHkuTWV0aG9kTW9kaWZpZXIuT3ZlcnJpZGUnLCB7XG4gICAgXG4gICAgaXNhIDogSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5NZXRob2RNb2RpZmllcixcblxuICAgIFxuICAgIHByZXBhcmVXcmFwcGVyIDogZnVuY3Rpb24gKHBhcmFtcykge1xuICAgICAgICBcbiAgICAgICAgdmFyIG1vZGlmaWVyICAgICAgICA9IHBhcmFtcy5tb2RpZmllclxuICAgICAgICB2YXIgb3JpZ2luYWxDYWxsICAgID0gcGFyYW1zLm9yaWdpbmFsQ2FsbFxuICAgICAgICB2YXIgc3VwZXJQcm90byAgICAgID0gcGFyYW1zLnN1cGVyUHJvdG9cbiAgICAgICAgdmFyIHN1cGVyTWV0YUNvbnN0ICA9IHN1cGVyUHJvdG8ubWV0YS5jb25zdHJ1Y3RvclxuICAgICAgICBcbiAgICAgICAgLy9jYWxsIHRvIEpvb3NlLlByb3RvIGxldmVsLCByZXF1aXJlIHNvbWUgYWRkaXRpb25hbCBwcm9jZXNzaW5nXG4gICAgICAgIHZhciBpc0NhbGxUb1Byb3RvID0gKHN1cGVyTWV0YUNvbnN0ID09IEpvb3NlLlByb3RvLkNsYXNzIHx8IHN1cGVyTWV0YUNvbnN0ID09IEpvb3NlLlByb3RvLk9iamVjdCkgJiYgIShwYXJhbXMuaXNPd24gJiYgb3JpZ2luYWxDYWxsLklTX09WRVJSSURFKSBcbiAgICAgICAgXG4gICAgICAgIHZhciBvcmlnaW5hbCA9IG9yaWdpbmFsQ2FsbFxuICAgICAgICBcbiAgICAgICAgaWYgKGlzQ2FsbFRvUHJvdG8pIG9yaWdpbmFsID0gZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgdmFyIGJlZm9yZVNVUEVSID0gdGhpcy5TVVBFUlxuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLlNVUEVSICA9IHN1cGVyUHJvdG8uU1VQRVJcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdmFyIHJlcyA9IG9yaWdpbmFsQ2FsbC5hcHBseSh0aGlzLCBhcmd1bWVudHMpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXMuU1VQRVIgPSBiZWZvcmVTVVBFUlxuICAgICAgICAgICAgXG4gICAgICAgICAgICByZXR1cm4gcmVzXG4gICAgICAgIH1cblxuICAgICAgICB2YXIgb3ZlcnJpZGUgPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciBiZWZvcmVTVVBFUiA9IHRoaXMuU1VQRVJcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpcy5TVVBFUiAgPSBvcmlnaW5hbFxuICAgICAgICAgICAgXG4gICAgICAgICAgICB2YXIgcmVzID0gbW9kaWZpZXIuYXBwbHkodGhpcywgYXJndW1lbnRzKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLlNVUEVSID0gYmVmb3JlU1VQRVJcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcmV0dXJuIHJlc1xuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICBvdmVycmlkZS5JU19PVkVSUklERSA9IHRydWVcbiAgICAgICAgXG4gICAgICAgIHJldHVybiBvdmVycmlkZVxuICAgIH1cbiAgICBcbiAgICBcbn0pLmM7XG5Kb29zZS5NYW5hZ2VkLlByb3BlcnR5Lk1ldGhvZE1vZGlmaWVyLlB1dCA9IG5ldyBKb29zZS5Qcm90by5DbGFzcygnSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5NZXRob2RNb2RpZmllci5QdXQnLCB7XG4gICAgXG4gICAgaXNhIDogSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5NZXRob2RNb2RpZmllci5PdmVycmlkZSxcblxuXG4gICAgcHJlcGFyZVdyYXBwZXIgOiBmdW5jdGlvbiAocGFyYW1zKSB7XG4gICAgICAgIFxuICAgICAgICBpZiAocGFyYW1zLmlzT3duKSB0aHJvdyBcIk1ldGhvZCBbXCIgKyBwYXJhbXMubmFtZSArIFwiXSBpcyBhcHBseWluZyBvdmVyIHNvbWV0aGluZyBbXCIgKyBwYXJhbXMub3JpZ2luYWxDYWxsICsgXCJdIGluIGNsYXNzIFtcIiArIHBhcmFtcy50YXJnZXQgKyBcIl1cIlxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIEpvb3NlLk1hbmFnZWQuUHJvcGVydHkuTWV0aG9kTW9kaWZpZXIuUHV0LnN1cGVyQ2xhc3MucHJlcGFyZVdyYXBwZXIuY2FsbCh0aGlzLCBwYXJhbXMpXG4gICAgfVxuICAgIFxuICAgIFxufSkuYztcbkpvb3NlLk1hbmFnZWQuUHJvcGVydHkuTWV0aG9kTW9kaWZpZXIuQWZ0ZXIgPSBuZXcgSm9vc2UuUHJvdG8uQ2xhc3MoJ0pvb3NlLk1hbmFnZWQuUHJvcGVydHkuTWV0aG9kTW9kaWZpZXIuQWZ0ZXInLCB7XG4gICAgXG4gICAgaXNhIDogSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5NZXRob2RNb2RpZmllcixcblxuICAgIFxuICAgIHByZXBhcmVXcmFwcGVyIDogZnVuY3Rpb24gKHBhcmFtcykge1xuICAgICAgICBcbiAgICAgICAgdmFyIG1vZGlmaWVyICAgICAgICA9IHBhcmFtcy5tb2RpZmllclxuICAgICAgICB2YXIgb3JpZ2luYWxDYWxsICAgID0gcGFyYW1zLm9yaWdpbmFsQ2FsbFxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHZhciByZXMgPSBvcmlnaW5hbENhbGwuYXBwbHkodGhpcywgYXJndW1lbnRzKVxuICAgICAgICAgICAgbW9kaWZpZXIuYXBwbHkodGhpcywgYXJndW1lbnRzKVxuICAgICAgICAgICAgcmV0dXJuIHJlc1xuICAgICAgICB9XG4gICAgfSAgICBcblxuICAgIFxufSkuYztcbkpvb3NlLk1hbmFnZWQuUHJvcGVydHkuTWV0aG9kTW9kaWZpZXIuQmVmb3JlID0gbmV3IEpvb3NlLlByb3RvLkNsYXNzKCdKb29zZS5NYW5hZ2VkLlByb3BlcnR5Lk1ldGhvZE1vZGlmaWVyLkJlZm9yZScsIHtcbiAgICBcbiAgICBpc2EgOiBKb29zZS5NYW5hZ2VkLlByb3BlcnR5Lk1ldGhvZE1vZGlmaWVyLFxuXG4gICAgXG4gICAgcHJlcGFyZVdyYXBwZXIgOiBmdW5jdGlvbiAocGFyYW1zKSB7XG4gICAgICAgIFxuICAgICAgICB2YXIgbW9kaWZpZXIgICAgICAgID0gcGFyYW1zLm1vZGlmaWVyXG4gICAgICAgIHZhciBvcmlnaW5hbENhbGwgICAgPSBwYXJhbXMub3JpZ2luYWxDYWxsXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgbW9kaWZpZXIuYXBwbHkodGhpcywgYXJndW1lbnRzKVxuICAgICAgICAgICAgcmV0dXJuIG9yaWdpbmFsQ2FsbC5hcHBseSh0aGlzLCBhcmd1bWVudHMpXG4gICAgICAgIH1cbiAgICB9XG4gICAgXG59KS5jO1xuSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5NZXRob2RNb2RpZmllci5Bcm91bmQgPSBuZXcgSm9vc2UuUHJvdG8uQ2xhc3MoJ0pvb3NlLk1hbmFnZWQuUHJvcGVydHkuTWV0aG9kTW9kaWZpZXIuQXJvdW5kJywge1xuICAgIFxuICAgIGlzYSA6IEpvb3NlLk1hbmFnZWQuUHJvcGVydHkuTWV0aG9kTW9kaWZpZXIsXG5cbiAgICBwcmVwYXJlV3JhcHBlciA6IGZ1bmN0aW9uIChwYXJhbXMpIHtcbiAgICAgICAgXG4gICAgICAgIHZhciBtb2RpZmllciAgICAgICAgPSBwYXJhbXMubW9kaWZpZXJcbiAgICAgICAgdmFyIG9yaWdpbmFsQ2FsbCAgICA9IHBhcmFtcy5vcmlnaW5hbENhbGxcbiAgICAgICAgXG4gICAgICAgIHZhciBtZVxuICAgICAgICBcbiAgICAgICAgdmFyIGJvdW5kID0gZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgcmV0dXJuIG9yaWdpbmFsQ2FsbC5hcHBseShtZSwgYXJndW1lbnRzKVxuICAgICAgICB9XG4gICAgICAgICAgICBcbiAgICAgICAgcmV0dXJuIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIG1lID0gdGhpc1xuICAgICAgICAgICAgXG4gICAgICAgICAgICB2YXIgYm91bmRBcnIgPSBbIGJvdW5kIF1cbiAgICAgICAgICAgIGJvdW5kQXJyLnB1c2guYXBwbHkoYm91bmRBcnIsIGFyZ3VtZW50cylcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcmV0dXJuIG1vZGlmaWVyLmFwcGx5KHRoaXMsIGJvdW5kQXJyKVxuICAgICAgICB9XG4gICAgfVxuICAgIFxufSkuYztcbkpvb3NlLk1hbmFnZWQuUHJvcGVydHkuTWV0aG9kTW9kaWZpZXIuQXVnbWVudCA9IG5ldyBKb29zZS5Qcm90by5DbGFzcygnSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5NZXRob2RNb2RpZmllci5BdWdtZW50Jywge1xuICAgIFxuICAgIGlzYSA6IEpvb3NlLk1hbmFnZWQuUHJvcGVydHkuTWV0aG9kTW9kaWZpZXIsXG5cbiAgICBcbiAgICBwcmVwYXJlV3JhcHBlciA6IGZ1bmN0aW9uIChwYXJhbXMpIHtcbiAgICAgICAgXG4gICAgICAgIHZhciBBVUdNRU5UID0gZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgXG4gICAgICAgICAgICAvL3BvcHVsYXRlIGNhbGxzdGFjayB0byB0aGUgbW9zdCBkZWVwIG5vbi1hdWdtZW50IG1ldGhvZFxuICAgICAgICAgICAgdmFyIGNhbGxzdGFjayA9IFtdXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciBzZWxmID0gQVVHTUVOVFxuICAgICAgICAgICAgXG4gICAgICAgICAgICBkbyB7XG4gICAgICAgICAgICAgICAgY2FsbHN0YWNrLnB1c2goc2VsZi5JU19BVUdNRU5UID8gc2VsZi5fX0NPTlRBSU5fXyA6IHNlbGYpXG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgc2VsZiA9IHNlbGYuSVNfQVVHTUVOVCAmJiAoc2VsZi5fX09SSUdJTkFMX18gfHwgc2VsZi5TVVBFUltzZWxmLm1ldGhvZE5hbWVdKVxuICAgICAgICAgICAgfSB3aGlsZSAoc2VsZilcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgXG4gICAgICAgICAgICAvL3NhdmUgcHJldmlvdXMgSU5ORVJcbiAgICAgICAgICAgIHZhciBiZWZvcmVJTk5FUiA9IHRoaXMuSU5ORVJcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy9jcmVhdGUgbmV3IElOTkVSXG4gICAgICAgICAgICB0aGlzLklOTkVSID0gZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgIHZhciBpbm5lckNhbGwgPSBjYWxsc3RhY2sucG9wKClcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICByZXR1cm4gaW5uZXJDYWxsID8gaW5uZXJDYWxsLmFwcGx5KHRoaXMsIGFyZ3VtZW50cykgOiB1bmRlZmluZWRcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy9hdWdtZW50IG1vZGlmaWVyIHJlc3VsdHMgaW4gaHlwb3RldGljYWwgSU5ORVIgY2FsbCBvZiB0aGUgc2FtZSBtZXRob2QgaW4gc3ViY2xhc3MgXG4gICAgICAgICAgICB2YXIgcmVzID0gdGhpcy5JTk5FUi5hcHBseSh0aGlzLCBhcmd1bWVudHMpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vcmVzdG9yZSBwcmV2aW91cyBJTk5FUiBjaGFpblxuICAgICAgICAgICAgdGhpcy5JTk5FUiA9IGJlZm9yZUlOTkVSXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHJldHVybiByZXNcbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgQVVHTUVOVC5tZXRob2ROYW1lICA9IHBhcmFtcy5uYW1lXG4gICAgICAgIEFVR01FTlQuU1VQRVIgICAgICAgPSBwYXJhbXMuc3VwZXJQcm90b1xuICAgICAgICBBVUdNRU5ULklTX0FVR01FTlQgID0gdHJ1ZVxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIEFVR01FTlRcbiAgICB9XG4gICAgXG59KS5jO1xuSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eVNldCA9IG5ldyBKb29zZS5Qcm90by5DbGFzcygnSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eVNldCcsIHtcbiAgICBcbiAgICBpc2EgICAgICAgICAgICAgICAgICAgICAgIDogSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eSxcblxuICAgIHByb3BlcnRpZXMgICAgICAgICAgICAgICAgOiBudWxsLFxuICAgIFxuICAgIHByb3BlcnR5TWV0YUNsYXNzICAgICAgICAgOiBKb29zZS5NYW5hZ2VkLlByb3BlcnR5LFxuICAgIFxuICAgIFxuICAgIGluaXRpYWxpemUgOiBmdW5jdGlvbiAocHJvcHMpIHtcbiAgICAgICAgSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eVNldC5zdXBlckNsYXNzLmluaXRpYWxpemUuY2FsbCh0aGlzLCBwcm9wcylcbiAgICAgICAgXG4gICAgICAgIC8vWFhYIHRoaXMgZ3VhcmRzIHRoZSBtZXRhIHJvbGVzIDopXG4gICAgICAgIHRoaXMucHJvcGVydGllcyA9IHByb3BzLnByb3BlcnRpZXMgfHwge31cbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGFkZFByb3BlcnR5IDogZnVuY3Rpb24gKG5hbWUsIHByb3BzKSB7XG4gICAgICAgIHZhciBtZXRhQ2xhc3MgPSBwcm9wcy5tZXRhIHx8IHRoaXMucHJvcGVydHlNZXRhQ2xhc3NcbiAgICAgICAgZGVsZXRlIHByb3BzLm1ldGFcbiAgICAgICAgXG4gICAgICAgIHByb3BzLmRlZmluZWRJbiAgICAgPSB0aGlzXG4gICAgICAgIHByb3BzLm5hbWUgICAgICAgICAgPSBuYW1lXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gdGhpcy5wcm9wZXJ0aWVzW25hbWVdID0gbmV3IG1ldGFDbGFzcyhwcm9wcylcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGFkZFByb3BlcnR5T2JqZWN0IDogZnVuY3Rpb24gKG9iamVjdCkge1xuICAgICAgICByZXR1cm4gdGhpcy5wcm9wZXJ0aWVzW29iamVjdC5uYW1lXSA9IG9iamVjdFxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgcmVtb3ZlUHJvcGVydHkgOiBmdW5jdGlvbiAobmFtZSkge1xuICAgICAgICB2YXIgcHJvcCA9IHRoaXMucHJvcGVydGllc1tuYW1lXVxuICAgICAgICBcbiAgICAgICAgZGVsZXRlIHRoaXMucHJvcGVydGllc1tuYW1lXVxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIHByb3BcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGhhdmVQcm9wZXJ0eSA6IGZ1bmN0aW9uIChuYW1lKSB7XG4gICAgICAgIHJldHVybiB0aGlzLnByb3BlcnRpZXNbbmFtZV0gIT0gbnVsbFxuICAgIH0sXG4gICAgXG5cbiAgICBoYXZlT3duUHJvcGVydHkgOiBmdW5jdGlvbiAobmFtZSkge1xuICAgICAgICByZXR1cm4gdGhpcy5oYXZlUHJvcGVydHkobmFtZSkgJiYgdGhpcy5wcm9wZXJ0aWVzLmhhc093blByb3BlcnR5KG5hbWUpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBnZXRQcm9wZXJ0eSA6IGZ1bmN0aW9uIChuYW1lKSB7XG4gICAgICAgIHJldHVybiB0aGlzLnByb3BlcnRpZXNbbmFtZV1cbiAgICB9LFxuICAgIFxuICAgIFxuICAgIC8vaW5jbHVkZXMgaW5oZXJpdGVkIHByb3BlcnRpZXMgKHByb2JhYmx5IHlvdSB3YW50cyAnZWFjaE93bicsIHdoaWNoIHByb2Nlc3Mgb25seSBcIm93blwiIChpbmNsdWRpbmcgY29uc3VtZWQgZnJvbSBSb2xlcykgcHJvcGVydGllcykgXG4gICAgZWFjaCA6IGZ1bmN0aW9uIChmdW5jLCBzY29wZSkge1xuICAgICAgICBKb29zZS5PLmVhY2godGhpcy5wcm9wZXJ0aWVzLCBmdW5jLCBzY29wZSB8fCB0aGlzKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgZWFjaE93biA6IGZ1bmN0aW9uIChmdW5jLCBzY29wZSkge1xuICAgICAgICBKb29zZS5PLmVhY2hPd24odGhpcy5wcm9wZXJ0aWVzLCBmdW5jLCBzY29wZSB8fCB0aGlzKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgLy9zeW5vbnltIGZvciBlYWNoXG4gICAgZWFjaEFsbCA6IGZ1bmN0aW9uIChmdW5jLCBzY29wZSkge1xuICAgICAgICB0aGlzLmVhY2goZnVuYywgc2NvcGUpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBjbG9uZVByb3BzIDogZnVuY3Rpb24gKCkge1xuICAgICAgICB2YXIgcHJvcHMgPSBKb29zZS5NYW5hZ2VkLlByb3BlcnR5U2V0LnN1cGVyQ2xhc3MuY2xvbmVQcm9wcy5jYWxsKHRoaXMpXG4gICAgICAgIFxuICAgICAgICBwcm9wcy5wcm9wZXJ0eU1ldGFDbGFzcyAgICAgPSB0aGlzLnByb3BlcnR5TWV0YUNsYXNzXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gcHJvcHNcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGNsb25lIDogZnVuY3Rpb24gKG5hbWUpIHtcbiAgICAgICAgdmFyIGNsb25lID0gdGhpcy5jbGVhbkNsb25lKG5hbWUpXG4gICAgICAgIFxuICAgICAgICBjbG9uZS5wcm9wZXJ0aWVzID0gSm9vc2UuTy5jb3B5T3duKHRoaXMucHJvcGVydGllcylcbiAgICAgICAgXG4gICAgICAgIHJldHVybiBjbG9uZVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgY2xlYW5DbG9uZSA6IGZ1bmN0aW9uIChuYW1lKSB7XG4gICAgICAgIHZhciBwcm9wcyA9IHRoaXMuY2xvbmVQcm9wcygpXG4gICAgICAgIFxuICAgICAgICBwcm9wcy5uYW1lID0gbmFtZSB8fCBwcm9wcy5uYW1lXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gbmV3IHRoaXMuY29uc3RydWN0b3IocHJvcHMpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBhbGlhcyA6IGZ1bmN0aW9uICh3aGF0KSB7XG4gICAgICAgIHZhciBwcm9wcyA9IHRoaXMucHJvcGVydGllc1xuICAgICAgICBcbiAgICAgICAgSm9vc2UuTy5lYWNoKHdoYXQsIGZ1bmN0aW9uIChhbGlhc05hbWUsIG9yaWdpbmFsTmFtZSkge1xuICAgICAgICAgICAgdmFyIG9yaWdpbmFsID0gcHJvcHNbb3JpZ2luYWxOYW1lXVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAob3JpZ2luYWwpIHRoaXMuYWRkUHJvcGVydHlPYmplY3Qob3JpZ2luYWwuY2xvbmUoYWxpYXNOYW1lKSlcbiAgICAgICAgfSwgdGhpcylcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGV4Y2x1ZGUgOiBmdW5jdGlvbiAod2hhdCkge1xuICAgICAgICB2YXIgcHJvcHMgPSB0aGlzLnByb3BlcnRpZXNcbiAgICAgICAgXG4gICAgICAgIEpvb3NlLkEuZWFjaCh3aGF0LCBmdW5jdGlvbiAobmFtZSkge1xuICAgICAgICAgICAgZGVsZXRlIHByb3BzW25hbWVdXG4gICAgICAgIH0pXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBiZWZvcmVDb25zdW1lZEJ5IDogZnVuY3Rpb24gKCkge1xuICAgIH0sXG4gICAgXG4gICAgXG4gICAgZmxhdHRlblRvIDogZnVuY3Rpb24gKHRhcmdldCkge1xuICAgICAgICB2YXIgdGFyZ2V0UHJvcHMgPSB0YXJnZXQucHJvcGVydGllc1xuICAgICAgICBcbiAgICAgICAgdGhpcy5lYWNoT3duKGZ1bmN0aW9uIChwcm9wZXJ0eSwgbmFtZSkge1xuICAgICAgICAgICAgdmFyIHRhcmdldFByb3BlcnR5ID0gdGFyZ2V0UHJvcHNbbmFtZV1cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKHRhcmdldFByb3BlcnR5IGluc3RhbmNlb2YgSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5Db25mbGljdE1hcmtlcikgcmV0dXJuXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmICghdGFyZ2V0UHJvcHMuaGFzT3duUHJvcGVydHkobmFtZSkgfHwgdGFyZ2V0UHJvcGVydHkgPT0gbnVsbCkge1xuICAgICAgICAgICAgICAgIHRhcmdldC5hZGRQcm9wZXJ0eU9iamVjdChwcm9wZXJ0eSlcbiAgICAgICAgICAgICAgICByZXR1cm5cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKHRhcmdldFByb3BlcnR5ID09IHByb3BlcnR5KSByZXR1cm5cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGFyZ2V0LnJlbW92ZVByb3BlcnR5KG5hbWUpXG4gICAgICAgICAgICB0YXJnZXQuYWRkUHJvcGVydHkobmFtZSwge1xuICAgICAgICAgICAgICAgIG1ldGEgOiBKb29zZS5NYW5hZ2VkLlByb3BlcnR5LkNvbmZsaWN0TWFya2VyXG4gICAgICAgICAgICB9KVxuICAgICAgICB9LCB0aGlzKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgY29tcG9zZVRvIDogZnVuY3Rpb24gKHRhcmdldCkge1xuICAgICAgICB0aGlzLmVhY2hPd24oZnVuY3Rpb24gKHByb3BlcnR5LCBuYW1lKSB7XG4gICAgICAgICAgICBpZiAoIXRhcmdldC5oYXZlT3duUHJvcGVydHkobmFtZSkpIHRhcmdldC5hZGRQcm9wZXJ0eU9iamVjdChwcm9wZXJ0eSlcbiAgICAgICAgfSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGNvbXBvc2VGcm9tIDogZnVuY3Rpb24gKCkge1xuICAgICAgICBpZiAoIWFyZ3VtZW50cy5sZW5ndGgpIHJldHVyblxuICAgICAgICBcbiAgICAgICAgdmFyIGZsYXR0ZW5pbmcgPSB0aGlzLmNsZWFuQ2xvbmUoKVxuICAgICAgICBcbiAgICAgICAgSm9vc2UuQS5lYWNoKGFyZ3VtZW50cywgZnVuY3Rpb24gKGFyZykge1xuICAgICAgICAgICAgdmFyIGlzRGVzY3JpcHRvciAgICA9ICEoYXJnIGluc3RhbmNlb2YgSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eVNldClcbiAgICAgICAgICAgIHZhciBwcm9wU2V0ICAgICAgICAgPSBpc0Rlc2NyaXB0b3IgPyBhcmcucHJvcGVydHlTZXQgOiBhcmdcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcHJvcFNldC5iZWZvcmVDb25zdW1lZEJ5KHRoaXMsIGZsYXR0ZW5pbmcpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmIChpc0Rlc2NyaXB0b3IpIHtcbiAgICAgICAgICAgICAgICBpZiAoYXJnLmFsaWFzIHx8IGFyZy5leGNsdWRlKSAgIHByb3BTZXQgPSBwcm9wU2V0LmNsb25lKClcbiAgICAgICAgICAgICAgICBpZiAoYXJnLmFsaWFzKSAgICAgICAgICAgICAgICAgIHByb3BTZXQuYWxpYXMoYXJnLmFsaWFzKVxuICAgICAgICAgICAgICAgIGlmIChhcmcuZXhjbHVkZSkgICAgICAgICAgICAgICAgcHJvcFNldC5leGNsdWRlKGFyZy5leGNsdWRlKVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBwcm9wU2V0LmZsYXR0ZW5UbyhmbGF0dGVuaW5nKVxuICAgICAgICB9LCB0aGlzKVxuICAgICAgICBcbiAgICAgICAgZmxhdHRlbmluZy5jb21wb3NlVG8odGhpcylcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIHByZUFwcGx5IDogZnVuY3Rpb24gKHRhcmdldCkge1xuICAgICAgICB0aGlzLmVhY2hPd24oZnVuY3Rpb24gKHByb3BlcnR5KSB7XG4gICAgICAgICAgICBwcm9wZXJ0eS5wcmVBcHBseSh0YXJnZXQpXG4gICAgICAgIH0pXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBhcHBseSA6IGZ1bmN0aW9uICh0YXJnZXQpIHtcbiAgICAgICAgdGhpcy5lYWNoT3duKGZ1bmN0aW9uIChwcm9wZXJ0eSkge1xuICAgICAgICAgICAgcHJvcGVydHkuYXBwbHkodGFyZ2V0KVxuICAgICAgICB9KVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgdW5hcHBseSA6IGZ1bmN0aW9uIChmcm9tKSB7XG4gICAgICAgIHRoaXMuZWFjaE93bihmdW5jdGlvbiAocHJvcGVydHkpIHtcbiAgICAgICAgICAgIHByb3BlcnR5LnVuYXBwbHkoZnJvbSlcbiAgICAgICAgfSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIHBvc3RVbkFwcGx5IDogZnVuY3Rpb24gKHRhcmdldCkge1xuICAgICAgICB0aGlzLmVhY2hPd24oZnVuY3Rpb24gKHByb3BlcnR5KSB7XG4gICAgICAgICAgICBwcm9wZXJ0eS5wb3N0VW5BcHBseSh0YXJnZXQpXG4gICAgICAgIH0pXG4gICAgfVxuICAgIFxufSkuY1xuO1xudmFyIF9fSURfXyA9IDFcblxuXG5Kb29zZS5NYW5hZ2VkLlByb3BlcnR5U2V0Lk11dGFibGUgPSBuZXcgSm9vc2UuUHJvdG8uQ2xhc3MoJ0pvb3NlLk1hbmFnZWQuUHJvcGVydHlTZXQuTXV0YWJsZScsIHtcbiAgICBcbiAgICBpc2EgICAgICAgICAgICAgICAgIDogSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eVNldCxcblxuICAgIElEICAgICAgICAgICAgICAgICAgOiBudWxsLFxuICAgIFxuICAgIGRlcml2YXRpdmVzICAgICAgICAgOiBudWxsLFxuICAgIFxuICAgIG9wZW5lZCAgICAgICAgICAgICAgOiBudWxsLFxuICAgIFxuICAgIGNvbXBvc2VkRnJvbSAgICAgICAgOiBudWxsLFxuICAgIFxuICAgIFxuICAgIGluaXRpYWxpemUgOiBmdW5jdGlvbiAocHJvcHMpIHtcbiAgICAgICAgSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eVNldC5NdXRhYmxlLnN1cGVyQ2xhc3MuaW5pdGlhbGl6ZS5jYWxsKHRoaXMsIHByb3BzKVxuICAgICAgICBcbiAgICAgICAgLy9pbml0aWFsbHkgb3BlbmVkXG4gICAgICAgIHRoaXMub3BlbmVkICAgICAgICAgICAgID0gMVxuICAgICAgICB0aGlzLmRlcml2YXRpdmVzICAgICAgICA9IHt9XG4gICAgICAgIHRoaXMuSUQgICAgICAgICAgICAgICAgID0gX19JRF9fKytcbiAgICAgICAgdGhpcy5jb21wb3NlZEZyb20gICAgICAgPSBbXVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgYWRkQ29tcG9zZUluZm8gOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHRoaXMuZW5zdXJlT3BlbigpXG4gICAgICAgIFxuICAgICAgICBKb29zZS5BLmVhY2goYXJndW1lbnRzLCBmdW5jdGlvbiAoYXJnKSB7XG4gICAgICAgICAgICB0aGlzLmNvbXBvc2VkRnJvbS5wdXNoKGFyZylcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdmFyIHByb3BTZXQgPSBhcmcgaW5zdGFuY2VvZiBKb29zZS5NYW5hZ2VkLlByb3BlcnR5U2V0ID8gYXJnIDogYXJnLnByb3BlcnR5U2V0XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICBwcm9wU2V0LmRlcml2YXRpdmVzW3RoaXMuSURdID0gdGhpc1xuICAgICAgICB9LCB0aGlzKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgcmVtb3ZlQ29tcG9zZUluZm8gOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHRoaXMuZW5zdXJlT3BlbigpXG4gICAgICAgIFxuICAgICAgICBKb29zZS5BLmVhY2goYXJndW1lbnRzLCBmdW5jdGlvbiAoYXJnKSB7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciBpID0gMFxuICAgICAgICAgICAgXG4gICAgICAgICAgICB3aGlsZSAoaSA8IHRoaXMuY29tcG9zZWRGcm9tLmxlbmd0aCkge1xuICAgICAgICAgICAgICAgIHZhciBwcm9wU2V0ID0gdGhpcy5jb21wb3NlZEZyb21baV1cbiAgICAgICAgICAgICAgICBwcm9wU2V0ID0gcHJvcFNldCBpbnN0YW5jZW9mIEpvb3NlLk1hbmFnZWQuUHJvcGVydHlTZXQgPyBwcm9wU2V0IDogcHJvcFNldC5wcm9wZXJ0eVNldFxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIGlmIChhcmcgPT0gcHJvcFNldCkge1xuICAgICAgICAgICAgICAgICAgICBkZWxldGUgcHJvcFNldC5kZXJpdmF0aXZlc1t0aGlzLklEXVxuICAgICAgICAgICAgICAgICAgICB0aGlzLmNvbXBvc2VkRnJvbS5zcGxpY2UoaSwgMSlcbiAgICAgICAgICAgICAgICB9IGVsc2UgaSsrXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBcbiAgICAgICAgfSwgdGhpcylcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGVuc3VyZU9wZW4gOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIGlmICghdGhpcy5vcGVuZWQpIHRocm93IFwiTXV0YXRpb24gb2YgY2xvc2VkIHByb3BlcnR5IHNldDogW1wiICsgdGhpcy5uYW1lICsgXCJdXCJcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGFkZFByb3BlcnR5IDogZnVuY3Rpb24gKG5hbWUsIHByb3BzKSB7XG4gICAgICAgIHRoaXMuZW5zdXJlT3BlbigpXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eVNldC5NdXRhYmxlLnN1cGVyQ2xhc3MuYWRkUHJvcGVydHkuY2FsbCh0aGlzLCBuYW1lLCBwcm9wcylcbiAgICB9LFxuICAgIFxuXG4gICAgYWRkUHJvcGVydHlPYmplY3QgOiBmdW5jdGlvbiAob2JqZWN0KSB7XG4gICAgICAgIHRoaXMuZW5zdXJlT3BlbigpXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eVNldC5NdXRhYmxlLnN1cGVyQ2xhc3MuYWRkUHJvcGVydHlPYmplY3QuY2FsbCh0aGlzLCBvYmplY3QpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICByZW1vdmVQcm9wZXJ0eSA6IGZ1bmN0aW9uIChuYW1lKSB7XG4gICAgICAgIHRoaXMuZW5zdXJlT3BlbigpXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eVNldC5NdXRhYmxlLnN1cGVyQ2xhc3MucmVtb3ZlUHJvcGVydHkuY2FsbCh0aGlzLCBuYW1lKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgY29tcG9zZUZyb20gOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHRoaXMuZW5zdXJlT3BlbigpXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eVNldC5NdXRhYmxlLnN1cGVyQ2xhc3MuY29tcG9zZUZyb20uYXBwbHkodGhpcywgdGhpcy5jb21wb3NlZEZyb20pXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBvcGVuIDogZnVuY3Rpb24gKCkge1xuICAgICAgICB0aGlzLm9wZW5lZCsrXG4gICAgICAgIFxuICAgICAgICBpZiAodGhpcy5vcGVuZWQgPT0gMSkge1xuICAgICAgICBcbiAgICAgICAgICAgIEpvb3NlLk8uZWFjaCh0aGlzLmRlcml2YXRpdmVzLCBmdW5jdGlvbiAocHJvcFNldCkge1xuICAgICAgICAgICAgICAgIHByb3BTZXQub3BlbigpXG4gICAgICAgICAgICB9KVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLmRlQ29tcG9zZSgpXG4gICAgICAgIH1cbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGNsb3NlIDogZnVuY3Rpb24gKCkge1xuICAgICAgICBpZiAoIXRoaXMub3BlbmVkKSB0aHJvdyBcIlVubWF0Y2hlZCAnY2xvc2UnIG9wZXJhdGlvbiBvbiBwcm9wZXJ0eSBzZXQ6IFtcIiArIHRoaXMubmFtZSArIFwiXVwiXG4gICAgICAgIFxuICAgICAgICBpZiAodGhpcy5vcGVuZWQgPT0gMSkge1xuICAgICAgICAgICAgdGhpcy5yZUNvbXBvc2UoKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBKb29zZS5PLmVhY2godGhpcy5kZXJpdmF0aXZlcywgZnVuY3Rpb24gKHByb3BTZXQpIHtcbiAgICAgICAgICAgICAgICBwcm9wU2V0LmNsb3NlKClcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5vcGVuZWQtLVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgcmVDb21wb3NlIDogZnVuY3Rpb24gKCkge1xuICAgICAgICB0aGlzLmNvbXBvc2VGcm9tKClcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGRlQ29tcG9zZSA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgdGhpcy5lYWNoT3duKGZ1bmN0aW9uIChwcm9wZXJ0eSwgbmFtZSkge1xuICAgICAgICAgICAgaWYgKHByb3BlcnR5LmRlZmluZWRJbiAhPSB0aGlzKSB0aGlzLnJlbW92ZVByb3BlcnR5KG5hbWUpXG4gICAgICAgIH0sIHRoaXMpXG4gICAgfVxuICAgIFxufSkuYztcbkpvb3NlLk1hbmFnZWQuU3RlbUVsZW1lbnQgPSBmdW5jdGlvbiAoKSB7IHRocm93IFwiTW9kdWxlcyBtYXkgbm90IGJlIGluc3RhbnRpYXRlZC5cIiB9XG5cbkpvb3NlLk1hbmFnZWQuU3RlbUVsZW1lbnQuQXR0cmlidXRlcyA9IG5ldyBKb29zZS5Qcm90by5DbGFzcygnSm9vc2UuTWFuYWdlZC5TdGVtRWxlbWVudC5BdHRyaWJ1dGVzJywge1xuICAgIFxuICAgIGlzYSAgICAgICAgICAgICAgICAgICAgIDogSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eVNldC5NdXRhYmxlLFxuICAgIFxuICAgIHByb3BlcnR5TWV0YUNsYXNzICAgICAgIDogSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5BdHRyaWJ1dGVcbiAgICBcbn0pLmNcbjtcbkpvb3NlLk1hbmFnZWQuU3RlbUVsZW1lbnQuTWV0aG9kcyA9IG5ldyBKb29zZS5Qcm90by5DbGFzcygnSm9vc2UuTWFuYWdlZC5TdGVtRWxlbWVudC5NZXRob2RzJywge1xuICAgIFxuICAgIGlzYSA6IEpvb3NlLk1hbmFnZWQuUHJvcGVydHlTZXQuTXV0YWJsZSxcbiAgICBcbiAgICBwcm9wZXJ0eU1ldGFDbGFzcyA6IEpvb3NlLk1hbmFnZWQuUHJvcGVydHkuTWV0aG9kTW9kaWZpZXIuUHV0LFxuXG4gICAgXG4gICAgcHJlQXBwbHkgOiBmdW5jdGlvbiAoKSB7XG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBwb3N0VW5BcHBseSA6IGZ1bmN0aW9uICgpIHtcbiAgICB9XG4gICAgXG59KS5jO1xuSm9vc2UuTWFuYWdlZC5TdGVtRWxlbWVudC5SZXF1aXJlbWVudHMgPSBuZXcgSm9vc2UuUHJvdG8uQ2xhc3MoJ0pvb3NlLk1hbmFnZWQuU3RlbUVsZW1lbnQuUmVxdWlyZW1lbnRzJywge1xuXG4gICAgaXNhICAgICAgICAgICAgICAgICAgICAgOiBKb29zZS5NYW5hZ2VkLlByb3BlcnR5U2V0Lk11dGFibGUsXG4gICAgXG4gICAgcHJvcGVydHlNZXRhQ2xhc3MgICAgICAgOiBKb29zZS5NYW5hZ2VkLlByb3BlcnR5LlJlcXVpcmVtZW50LFxuICAgIFxuICAgIFxuICAgIFxuICAgIGFsaWFzIDogZnVuY3Rpb24gKCkge1xuICAgIH0sXG4gICAgXG4gICAgXG4gICAgZXhjbHVkZSA6IGZ1bmN0aW9uICgpIHtcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGZsYXR0ZW5UbyA6IGZ1bmN0aW9uICh0YXJnZXQpIHtcbiAgICAgICAgdGhpcy5lYWNoKGZ1bmN0aW9uIChwcm9wZXJ0eSwgbmFtZSkge1xuICAgICAgICAgICAgaWYgKCF0YXJnZXQuaGF2ZVByb3BlcnR5KG5hbWUpKSB0YXJnZXQuYWRkUHJvcGVydHlPYmplY3QocHJvcGVydHkpXG4gICAgICAgIH0pXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBjb21wb3NlVG8gOiBmdW5jdGlvbiAodGFyZ2V0KSB7XG4gICAgICAgIHRoaXMuZmxhdHRlblRvKHRhcmdldClcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIHByZUFwcGx5IDogZnVuY3Rpb24gKCkge1xuICAgIH0sXG4gICAgXG4gICAgXG4gICAgcG9zdFVuQXBwbHkgOiBmdW5jdGlvbiAoKSB7XG4gICAgfVxuICAgIFxufSkuYztcbkpvb3NlLk1hbmFnZWQuU3RlbUVsZW1lbnQuTWV0aG9kTW9kaWZpZXJzID0gbmV3IEpvb3NlLlByb3RvLkNsYXNzKCdKb29zZS5NYW5hZ2VkLlN0ZW1FbGVtZW50Lk1ldGhvZE1vZGlmaWVycycsIHtcblxuICAgIGlzYSAgICAgICAgICAgICAgICAgICAgIDogSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eVNldC5NdXRhYmxlLFxuICAgIFxuICAgIHByb3BlcnR5TWV0YUNsYXNzICAgICAgIDogbnVsbCxcbiAgICBcbiAgICBcbiAgICBhZGRQcm9wZXJ0eSA6IGZ1bmN0aW9uIChuYW1lLCBwcm9wcykge1xuICAgICAgICB2YXIgbWV0YUNsYXNzID0gcHJvcHMubWV0YVxuICAgICAgICBkZWxldGUgcHJvcHMubWV0YVxuICAgICAgICBcbiAgICAgICAgcHJvcHMuZGVmaW5lZEluICAgICAgICAgPSB0aGlzXG4gICAgICAgIHByb3BzLm5hbWUgICAgICAgICAgICAgID0gbmFtZVxuICAgICAgICBcbiAgICAgICAgdmFyIG1vZGlmaWVyICAgICAgICAgICAgPSBuZXcgbWV0YUNsYXNzKHByb3BzKVxuICAgICAgICB2YXIgcHJvcGVydGllcyAgICAgICAgICA9IHRoaXMucHJvcGVydGllc1xuICAgICAgICBcbiAgICAgICAgaWYgKCFwcm9wZXJ0aWVzW25hbWVdKSBwcm9wZXJ0aWVzWyBuYW1lIF0gPSBbXVxuICAgICAgICBcbiAgICAgICAgcHJvcGVydGllc1tuYW1lXS5wdXNoKG1vZGlmaWVyKVxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIG1vZGlmaWVyXG4gICAgfSxcbiAgICBcblxuICAgIGFkZFByb3BlcnR5T2JqZWN0IDogZnVuY3Rpb24gKG9iamVjdCkge1xuICAgICAgICB2YXIgbmFtZSAgICAgICAgICAgID0gb2JqZWN0Lm5hbWVcbiAgICAgICAgdmFyIHByb3BlcnRpZXMgICAgICA9IHRoaXMucHJvcGVydGllc1xuICAgICAgICBcbiAgICAgICAgaWYgKCFwcm9wZXJ0aWVzW25hbWVdKSBwcm9wZXJ0aWVzW25hbWVdID0gW11cbiAgICAgICAgXG4gICAgICAgIHByb3BlcnRpZXNbbmFtZV0ucHVzaChvYmplY3QpXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gb2JqZWN0XG4gICAgfSxcbiAgICBcbiAgICBcbiAgICAvL3JlbW92ZSBvbmx5IHRoZSBsYXN0IG1vZGlmaWVyXG4gICAgcmVtb3ZlUHJvcGVydHkgOiBmdW5jdGlvbiAobmFtZSkge1xuICAgICAgICBpZiAoIXRoaXMuaGF2ZVByb3BlcnR5KG5hbWUpKSByZXR1cm4gdW5kZWZpbmVkXG4gICAgICAgIFxuICAgICAgICB2YXIgcHJvcGVydGllcyAgICAgID0gdGhpcy5wcm9wZXJ0aWVzXG4gICAgICAgIHZhciBtb2RpZmllciAgICAgICAgPSBwcm9wZXJ0aWVzWyBuYW1lIF0ucG9wKClcbiAgICAgICAgXG4gICAgICAgIC8vaWYgYWxsIG1vZGlmaWVycyB3ZXJlIHJlbW92ZWQgLSBjbGVhcmluZyB0aGUgcHJvcGVydGllc1xuICAgICAgICBpZiAoIXByb3BlcnRpZXNbbmFtZV0ubGVuZ3RoKSBKb29zZS5NYW5hZ2VkLlN0ZW1FbGVtZW50Lk1ldGhvZE1vZGlmaWVycy5zdXBlckNsYXNzLnJlbW92ZVByb3BlcnR5LmNhbGwodGhpcywgbmFtZSlcbiAgICAgICAgXG4gICAgICAgIHJldHVybiBtb2RpZmllclxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgYWxpYXMgOiBmdW5jdGlvbiAoKSB7XG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBleGNsdWRlIDogZnVuY3Rpb24gKCkge1xuICAgIH0sXG4gICAgXG4gICAgXG4gICAgZmxhdHRlblRvIDogZnVuY3Rpb24gKHRhcmdldCkge1xuICAgICAgICB2YXIgdGFyZ2V0UHJvcHMgPSB0YXJnZXQucHJvcGVydGllc1xuICAgICAgICBcbiAgICAgICAgdGhpcy5lYWNoKGZ1bmN0aW9uIChtb2RpZmllcnNBcnIsIG5hbWUpIHtcbiAgICAgICAgICAgIHZhciB0YXJnZXRNb2RpZmllcnNBcnIgPSB0YXJnZXRQcm9wc1tuYW1lXVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAodGFyZ2V0TW9kaWZpZXJzQXJyID09IG51bGwpIHRhcmdldE1vZGlmaWVyc0FyciA9IHRhcmdldFByb3BzW25hbWVdID0gW11cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgSm9vc2UuQS5lYWNoKG1vZGlmaWVyc0FyciwgZnVuY3Rpb24gKG1vZGlmaWVyKSB7XG4gICAgICAgICAgICAgICAgaWYgKCFKb29zZS5BLmV4aXN0cyh0YXJnZXRNb2RpZmllcnNBcnIsIG1vZGlmaWVyKSkgdGFyZ2V0TW9kaWZpZXJzQXJyLnB1c2gobW9kaWZpZXIpXG4gICAgICAgICAgICB9KVxuICAgICAgICAgICAgXG4gICAgICAgIH0pXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBjb21wb3NlVG8gOiBmdW5jdGlvbiAodGFyZ2V0KSB7XG4gICAgICAgIHRoaXMuZmxhdHRlblRvKHRhcmdldClcbiAgICB9LFxuXG4gICAgXG4gICAgZGVDb21wb3NlIDogZnVuY3Rpb24gKCkge1xuICAgICAgICB0aGlzLmVhY2goZnVuY3Rpb24gKG1vZGlmaWVyc0FyciwgbmFtZSkge1xuICAgICAgICAgICAgdmFyIGkgPSAwXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHdoaWxlIChpIDwgbW9kaWZpZXJzQXJyLmxlbmd0aCkgXG4gICAgICAgICAgICAgICAgaWYgKG1vZGlmaWVyc0FycltpXS5kZWZpbmVkSW4gIT0gdGhpcykgXG4gICAgICAgICAgICAgICAgICAgIG1vZGlmaWVyc0Fyci5zcGxpY2UoaSwgMSlcbiAgICAgICAgICAgICAgICBlbHNlIFxuICAgICAgICAgICAgICAgICAgICBpKytcbiAgICAgICAgfSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIHByZUFwcGx5IDogZnVuY3Rpb24gKHRhcmdldCkge1xuICAgIH0sXG5cbiAgICBcbiAgICBwb3N0VW5BcHBseSA6IGZ1bmN0aW9uICh0YXJnZXQpIHtcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGFwcGx5IDogZnVuY3Rpb24gKHRhcmdldCkge1xuICAgICAgICB0aGlzLmVhY2goZnVuY3Rpb24gKG1vZGlmaWVyc0FyciwgbmFtZSkge1xuICAgICAgICAgICAgSm9vc2UuQS5lYWNoKG1vZGlmaWVyc0FyciwgZnVuY3Rpb24gKG1vZGlmaWVyKSB7XG4gICAgICAgICAgICAgICAgbW9kaWZpZXIuYXBwbHkodGFyZ2V0KVxuICAgICAgICAgICAgfSlcbiAgICAgICAgfSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIHVuYXBwbHkgOiBmdW5jdGlvbiAoZnJvbSkge1xuICAgICAgICB0aGlzLmVhY2goZnVuY3Rpb24gKG1vZGlmaWVyc0FyciwgbmFtZSkge1xuICAgICAgICAgICAgZm9yICh2YXIgaSA9IG1vZGlmaWVyc0Fyci5sZW5ndGggLSAxOyBpID49MCA7IGktLSkgbW9kaWZpZXJzQXJyW2ldLnVuYXBwbHkoZnJvbSlcbiAgICAgICAgfSlcbiAgICB9XG4gICAgXG4gICAgXG4gICAgXG59KS5jO1xuSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eVNldC5Db21wb3NpdGlvbiA9IG5ldyBKb29zZS5Qcm90by5DbGFzcygnSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eVNldC5Db21wb3NpdGlvbicsIHtcbiAgICBcbiAgICBpc2EgICAgICAgICAgICAgICAgICAgICAgICAgOiBKb29zZS5NYW5hZ2VkLlByb3BlcnR5U2V0Lk11dGFibGUsXG4gICAgXG4gICAgcHJvcGVydHlNZXRhQ2xhc3MgICAgICAgICAgIDogSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eVNldC5NdXRhYmxlLFxuICAgIFxuICAgIHByb2Nlc3NPcmRlciAgICAgICAgICAgICAgICA6IG51bGwsXG5cbiAgICBcbiAgICBlYWNoIDogZnVuY3Rpb24gKGZ1bmMsIHNjb3BlKSB7XG4gICAgICAgIHZhciBwcm9wcyAgID0gdGhpcy5wcm9wZXJ0aWVzXG4gICAgICAgIHZhciBzY29wZSAgID0gc2NvcGUgfHwgdGhpc1xuICAgICAgICBcbiAgICAgICAgSm9vc2UuQS5lYWNoKHRoaXMucHJvY2Vzc09yZGVyLCBmdW5jdGlvbiAobmFtZSkge1xuICAgICAgICAgICAgZnVuYy5jYWxsKHNjb3BlLCBwcm9wc1tuYW1lXSwgbmFtZSlcbiAgICAgICAgfSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGVhY2hSIDogZnVuY3Rpb24gKGZ1bmMsIHNjb3BlKSB7XG4gICAgICAgIHZhciBwcm9wcyAgID0gdGhpcy5wcm9wZXJ0aWVzXG4gICAgICAgIHZhciBzY29wZSAgID0gc2NvcGUgfHwgdGhpc1xuICAgICAgICBcbiAgICAgICAgSm9vc2UuQS5lYWNoUih0aGlzLnByb2Nlc3NPcmRlciwgZnVuY3Rpb24gKG5hbWUpIHtcbiAgICAgICAgICAgIGZ1bmMuY2FsbChzY29wZSwgcHJvcHNbbmFtZV0sIG5hbWUpXG4gICAgICAgIH0pXG4gICAgICAgIFxuICAgICAgICBcbi8vICAgICAgICB2YXIgcHJvcHMgICAgICAgICAgID0gdGhpcy5wcm9wZXJ0aWVzXG4vLyAgICAgICAgdmFyIHByb2Nlc3NPcmRlciAgICA9IHRoaXMucHJvY2Vzc09yZGVyXG4vLyAgICAgICAgXG4vLyAgICAgICAgZm9yKHZhciBpID0gcHJvY2Vzc09yZGVyLmxlbmd0aCAtIDE7IGkgPj0gMDsgaS0tKSBcbi8vICAgICAgICAgICAgZnVuYy5jYWxsKHNjb3BlIHx8IHRoaXMsIHByb3BzWyBwcm9jZXNzT3JkZXJbaV0gXSwgcHJvY2Vzc09yZGVyW2ldKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgY2xvbmUgOiBmdW5jdGlvbiAobmFtZSkge1xuICAgICAgICB2YXIgY2xvbmUgPSB0aGlzLmNsZWFuQ2xvbmUobmFtZSlcbiAgICAgICAgXG4gICAgICAgIHRoaXMuZWFjaChmdW5jdGlvbiAocHJvcGVydHkpIHtcbiAgICAgICAgICAgIGNsb25lLmFkZFByb3BlcnR5T2JqZWN0KHByb3BlcnR5LmNsb25lKCkpXG4gICAgICAgIH0pXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gY2xvbmVcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGFsaWFzIDogZnVuY3Rpb24gKHdoYXQpIHtcbiAgICAgICAgdGhpcy5lYWNoKGZ1bmN0aW9uIChwcm9wZXJ0eSkge1xuICAgICAgICAgICAgcHJvcGVydHkuYWxpYXMod2hhdClcbiAgICAgICAgfSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGV4Y2x1ZGUgOiBmdW5jdGlvbiAod2hhdCkge1xuICAgICAgICB0aGlzLmVhY2goZnVuY3Rpb24gKHByb3BlcnR5KSB7XG4gICAgICAgICAgICBwcm9wZXJ0eS5leGNsdWRlKHdoYXQpXG4gICAgICAgIH0pXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBmbGF0dGVuVG8gOiBmdW5jdGlvbiAodGFyZ2V0KSB7XG4gICAgICAgIHZhciB0YXJnZXRQcm9wcyA9IHRhcmdldC5wcm9wZXJ0aWVzXG4gICAgICAgIFxuICAgICAgICB0aGlzLmVhY2goZnVuY3Rpb24gKHByb3BlcnR5LCBuYW1lKSB7XG4gICAgICAgICAgICB2YXIgc3ViVGFyZ2V0ID0gdGFyZ2V0UHJvcHNbbmFtZV0gfHwgdGFyZ2V0LmFkZFByb3BlcnR5KG5hbWUsIHtcbiAgICAgICAgICAgICAgICBtZXRhIDogcHJvcGVydHkuY29uc3RydWN0b3JcbiAgICAgICAgICAgIH0pXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHByb3BlcnR5LmZsYXR0ZW5UbyhzdWJUYXJnZXQpXG4gICAgICAgIH0pXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBjb21wb3NlVG8gOiBmdW5jdGlvbiAodGFyZ2V0KSB7XG4gICAgICAgIHZhciB0YXJnZXRQcm9wcyA9IHRhcmdldC5wcm9wZXJ0aWVzXG4gICAgICAgIFxuICAgICAgICB0aGlzLmVhY2goZnVuY3Rpb24gKHByb3BlcnR5LCBuYW1lKSB7XG4gICAgICAgICAgICB2YXIgc3ViVGFyZ2V0ID0gdGFyZ2V0UHJvcHNbbmFtZV0gfHwgdGFyZ2V0LmFkZFByb3BlcnR5KG5hbWUsIHtcbiAgICAgICAgICAgICAgICBtZXRhIDogcHJvcGVydHkuY29uc3RydWN0b3JcbiAgICAgICAgICAgIH0pXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHByb3BlcnR5LmNvbXBvc2VUbyhzdWJUYXJnZXQpXG4gICAgICAgIH0pXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBcbiAgICBkZUNvbXBvc2UgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHRoaXMuZWFjaFIoZnVuY3Rpb24gKHByb3BlcnR5KSB7XG4gICAgICAgICAgICBwcm9wZXJ0eS5vcGVuKClcbiAgICAgICAgfSlcbiAgICAgICAgXG4gICAgICAgIEpvb3NlLk1hbmFnZWQuUHJvcGVydHlTZXQuQ29tcG9zaXRpb24uc3VwZXJDbGFzcy5kZUNvbXBvc2UuY2FsbCh0aGlzKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgcmVDb21wb3NlIDogZnVuY3Rpb24gKCkge1xuICAgICAgICBKb29zZS5NYW5hZ2VkLlByb3BlcnR5U2V0LkNvbXBvc2l0aW9uLnN1cGVyQ2xhc3MucmVDb21wb3NlLmNhbGwodGhpcylcbiAgICAgICAgXG4gICAgICAgIHRoaXMuZWFjaChmdW5jdGlvbiAocHJvcGVydHkpIHtcbiAgICAgICAgICAgIHByb3BlcnR5LmNsb3NlKClcbiAgICAgICAgfSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIHVuYXBwbHkgOiBmdW5jdGlvbiAoZnJvbSkge1xuICAgICAgICB0aGlzLmVhY2hSKGZ1bmN0aW9uIChwcm9wZXJ0eSkge1xuICAgICAgICAgICAgcHJvcGVydHkudW5hcHBseShmcm9tKVxuICAgICAgICB9KVxuICAgIH1cbiAgICBcbn0pLmNcbjtcbkpvb3NlLk1hbmFnZWQuU3RlbSA9IG5ldyBKb29zZS5Qcm90by5DbGFzcygnSm9vc2UuTWFuYWdlZC5TdGVtJywge1xuICAgIFxuICAgIGlzYSAgICAgICAgICAgICAgICAgIDogSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eVNldC5Db21wb3NpdGlvbixcbiAgICBcbiAgICB0YXJnZXRNZXRhICAgICAgICAgICA6IG51bGwsXG4gICAgXG4gICAgYXR0cmlidXRlc01DICAgICAgICAgOiBKb29zZS5NYW5hZ2VkLlN0ZW1FbGVtZW50LkF0dHJpYnV0ZXMsXG4gICAgbWV0aG9kc01DICAgICAgICAgICAgOiBKb29zZS5NYW5hZ2VkLlN0ZW1FbGVtZW50Lk1ldGhvZHMsXG4gICAgcmVxdWlyZW1lbnRzTUMgICAgICAgOiBKb29zZS5NYW5hZ2VkLlN0ZW1FbGVtZW50LlJlcXVpcmVtZW50cyxcbiAgICBtZXRob2RzTW9kaWZpZXJzTUMgICA6IEpvb3NlLk1hbmFnZWQuU3RlbUVsZW1lbnQuTWV0aG9kTW9kaWZpZXJzLFxuICAgIFxuICAgIHByb2Nlc3NPcmRlciAgICAgICAgIDogWyAnYXR0cmlidXRlcycsICdtZXRob2RzJywgJ3JlcXVpcmVtZW50cycsICdtZXRob2RzTW9kaWZpZXJzJyBdLFxuICAgIFxuICAgIFxuICAgIGluaXRpYWxpemUgOiBmdW5jdGlvbiAocHJvcHMpIHtcbiAgICAgICAgSm9vc2UuTWFuYWdlZC5TdGVtLnN1cGVyQ2xhc3MuaW5pdGlhbGl6ZS5jYWxsKHRoaXMsIHByb3BzKVxuICAgICAgICBcbiAgICAgICAgdmFyIHRhcmdldE1ldGEgPSB0aGlzLnRhcmdldE1ldGFcbiAgICAgICAgXG4gICAgICAgIHRoaXMuYWRkUHJvcGVydHkoJ2F0dHJpYnV0ZXMnLCB7XG4gICAgICAgICAgICBtZXRhIDogdGhpcy5hdHRyaWJ1dGVzTUMsXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vaXQgY2FuIGJlIG5vICd0YXJnZXRNZXRhJyBpbiBjbG9uZXNcbiAgICAgICAgICAgIHByb3BlcnRpZXMgOiB0YXJnZXRNZXRhID8gdGFyZ2V0TWV0YS5hdHRyaWJ1dGVzIDoge31cbiAgICAgICAgfSlcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICB0aGlzLmFkZFByb3BlcnR5KCdtZXRob2RzJywge1xuICAgICAgICAgICAgbWV0YSA6IHRoaXMubWV0aG9kc01DLFxuICAgICAgICAgICAgXG4gICAgICAgICAgICBwcm9wZXJ0aWVzIDogdGFyZ2V0TWV0YSA/IHRhcmdldE1ldGEubWV0aG9kcyA6IHt9XG4gICAgICAgIH0pXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgdGhpcy5hZGRQcm9wZXJ0eSgncmVxdWlyZW1lbnRzJywge1xuICAgICAgICAgICAgbWV0YSA6IHRoaXMucmVxdWlyZW1lbnRzTUNcbiAgICAgICAgfSlcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICB0aGlzLmFkZFByb3BlcnR5KCdtZXRob2RzTW9kaWZpZXJzJywge1xuICAgICAgICAgICAgbWV0YSA6IHRoaXMubWV0aG9kc01vZGlmaWVyc01DXG4gICAgICAgIH0pXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICByZUNvbXBvc2UgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHZhciBjICAgICAgID0gdGhpcy50YXJnZXRNZXRhLmNcbiAgICAgICAgXG4gICAgICAgIHRoaXMucHJlQXBwbHkoYylcbiAgICAgICAgXG4gICAgICAgIEpvb3NlLk1hbmFnZWQuU3RlbS5zdXBlckNsYXNzLnJlQ29tcG9zZS5jYWxsKHRoaXMpXG4gICAgICAgIFxuICAgICAgICB0aGlzLmFwcGx5KGMpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBkZUNvbXBvc2UgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHZhciBjICAgICAgID0gdGhpcy50YXJnZXRNZXRhLmNcbiAgICAgICAgXG4gICAgICAgIHRoaXMudW5hcHBseShjKVxuICAgICAgICBcbiAgICAgICAgSm9vc2UuTWFuYWdlZC5TdGVtLnN1cGVyQ2xhc3MuZGVDb21wb3NlLmNhbGwodGhpcylcbiAgICAgICAgXG4gICAgICAgIHRoaXMucG9zdFVuQXBwbHkoYylcbiAgICB9XG4gICAgXG4gICAgXG59KS5jXG47XG5Kb29zZS5NYW5hZ2VkLkJ1aWxkZXIgPSBuZXcgSm9vc2UuUHJvdG8uQ2xhc3MoJ0pvb3NlLk1hbmFnZWQuQnVpbGRlcicsIHtcbiAgICBcbiAgICB0YXJnZXRNZXRhICAgICAgICAgIDogbnVsbCxcbiAgICBcbiAgICBcbiAgICBfYnVpbGRTdGFydCA6IGZ1bmN0aW9uICh0YXJnZXRNZXRhLCBwcm9wcykge1xuICAgICAgICB0YXJnZXRNZXRhLnN0ZW0ub3BlbigpXG4gICAgICAgIFxuICAgICAgICBKb29zZS5BLmVhY2goWyAndHJhaXQnLCAndHJhaXRzJywgJ3JlbW92ZVRyYWl0JywgJ3JlbW92ZVRyYWl0cycsICdkb2VzJywgJ2RvZXNub3QnLCAnZG9lc250JyBdLCBmdW5jdGlvbiAoYnVpbGRlcikge1xuICAgICAgICAgICAgaWYgKHByb3BzW2J1aWxkZXJdKSB7XG4gICAgICAgICAgICAgICAgdGhpc1tidWlsZGVyXSh0YXJnZXRNZXRhLCBwcm9wc1tidWlsZGVyXSlcbiAgICAgICAgICAgICAgICBkZWxldGUgcHJvcHNbYnVpbGRlcl1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfSwgdGhpcylcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIF9leHRlbmQgOiBmdW5jdGlvbiAocHJvcHMpIHtcbiAgICAgICAgaWYgKEpvb3NlLk8uaXNFbXB0eShwcm9wcykpIHJldHVyblxuICAgICAgICBcbiAgICAgICAgdmFyIHRhcmdldE1ldGEgPSB0aGlzLnRhcmdldE1ldGFcbiAgICAgICAgXG4gICAgICAgIHRoaXMuX2J1aWxkU3RhcnQodGFyZ2V0TWV0YSwgcHJvcHMpXG4gICAgICAgIFxuICAgICAgICBKb29zZS5PLmVhY2hPd24ocHJvcHMsIGZ1bmN0aW9uICh2YWx1ZSwgbmFtZSkge1xuICAgICAgICAgICAgdmFyIGhhbmRsZXIgPSB0aGlzW25hbWVdXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmICghaGFuZGxlcikgdGhyb3cgbmV3IEVycm9yKFwiVW5rbm93biBidWlsZGVyIFtcIiArIG5hbWUgKyBcIl0gd2FzIHVzZWQgZHVyaW5nIGV4dGVuZGluZyBvZiBbXCIgKyB0YXJnZXRNZXRhLmMgKyBcIl1cIilcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaGFuZGxlci5jYWxsKHRoaXMsIHRhcmdldE1ldGEsIHZhbHVlKVxuICAgICAgICB9LCB0aGlzKVxuICAgICAgICBcbiAgICAgICAgdGhpcy5fYnVpbGRDb21wbGV0ZSh0YXJnZXRNZXRhLCBwcm9wcylcbiAgICB9LFxuICAgIFxuXG4gICAgX2J1aWxkQ29tcGxldGUgOiBmdW5jdGlvbiAodGFyZ2V0TWV0YSwgcHJvcHMpIHtcbiAgICAgICAgdGFyZ2V0TWV0YS5zdGVtLmNsb3NlKClcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIG1ldGhvZHMgOiBmdW5jdGlvbiAodGFyZ2V0TWV0YSwgaW5mbykge1xuICAgICAgICBKb29zZS5PLmVhY2hPd24oaW5mbywgZnVuY3Rpb24gKHZhbHVlLCBuYW1lKSB7XG4gICAgICAgICAgICB0YXJnZXRNZXRhLmFkZE1ldGhvZChuYW1lLCB2YWx1ZSlcbiAgICAgICAgfSlcbiAgICB9LFxuICAgIFxuXG4gICAgcmVtb3ZlTWV0aG9kcyA6IGZ1bmN0aW9uICh0YXJnZXRNZXRhLCBpbmZvKSB7XG4gICAgICAgIEpvb3NlLkEuZWFjaChpbmZvLCBmdW5jdGlvbiAobmFtZSkge1xuICAgICAgICAgICAgdGFyZ2V0TWV0YS5yZW1vdmVNZXRob2QobmFtZSlcbiAgICAgICAgfSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGhhdmUgOiBmdW5jdGlvbiAodGFyZ2V0TWV0YSwgaW5mbykge1xuICAgICAgICBKb29zZS5PLmVhY2hPd24oaW5mbywgZnVuY3Rpb24gKHZhbHVlLCBuYW1lKSB7XG4gICAgICAgICAgICB0YXJnZXRNZXRhLmFkZEF0dHJpYnV0ZShuYW1lLCB2YWx1ZSlcbiAgICAgICAgfSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGhhdmVub3QgOiBmdW5jdGlvbiAodGFyZ2V0TWV0YSwgaW5mbykge1xuICAgICAgICBKb29zZS5BLmVhY2goaW5mbywgZnVuY3Rpb24gKG5hbWUpIHtcbiAgICAgICAgICAgIHRhcmdldE1ldGEucmVtb3ZlQXR0cmlidXRlKG5hbWUpXG4gICAgICAgIH0pXG4gICAgfSxcbiAgICBcblxuICAgIGhhdmVudCA6IGZ1bmN0aW9uICh0YXJnZXRNZXRhLCBpbmZvKSB7XG4gICAgICAgIHRoaXMuaGF2ZW5vdCh0YXJnZXRNZXRhLCBpbmZvKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgYWZ0ZXIgOiBmdW5jdGlvbiAodGFyZ2V0TWV0YSwgaW5mbykge1xuICAgICAgICBKb29zZS5PLmVhY2goaW5mbywgZnVuY3Rpb24gKHZhbHVlLCBuYW1lKSB7XG4gICAgICAgICAgICB0YXJnZXRNZXRhLmFkZE1ldGhvZE1vZGlmaWVyKG5hbWUsIHZhbHVlLCBKb29zZS5NYW5hZ2VkLlByb3BlcnR5Lk1ldGhvZE1vZGlmaWVyLkFmdGVyKVxuICAgICAgICB9KVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgYmVmb3JlIDogZnVuY3Rpb24gKHRhcmdldE1ldGEsIGluZm8pIHtcbiAgICAgICAgSm9vc2UuTy5lYWNoKGluZm8sIGZ1bmN0aW9uICh2YWx1ZSwgbmFtZSkge1xuICAgICAgICAgICAgdGFyZ2V0TWV0YS5hZGRNZXRob2RNb2RpZmllcihuYW1lLCB2YWx1ZSwgSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5NZXRob2RNb2RpZmllci5CZWZvcmUpXG4gICAgICAgIH0pXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBvdmVycmlkZSA6IGZ1bmN0aW9uICh0YXJnZXRNZXRhLCBpbmZvKSB7XG4gICAgICAgIEpvb3NlLk8uZWFjaChpbmZvLCBmdW5jdGlvbiAodmFsdWUsIG5hbWUpIHtcbiAgICAgICAgICAgIHRhcmdldE1ldGEuYWRkTWV0aG9kTW9kaWZpZXIobmFtZSwgdmFsdWUsIEpvb3NlLk1hbmFnZWQuUHJvcGVydHkuTWV0aG9kTW9kaWZpZXIuT3ZlcnJpZGUpXG4gICAgICAgIH0pXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBhcm91bmQgOiBmdW5jdGlvbiAodGFyZ2V0TWV0YSwgaW5mbykge1xuICAgICAgICBKb29zZS5PLmVhY2goaW5mbywgZnVuY3Rpb24gKHZhbHVlLCBuYW1lKSB7XG4gICAgICAgICAgICB0YXJnZXRNZXRhLmFkZE1ldGhvZE1vZGlmaWVyKG5hbWUsIHZhbHVlLCBKb29zZS5NYW5hZ2VkLlByb3BlcnR5Lk1ldGhvZE1vZGlmaWVyLkFyb3VuZClcbiAgICAgICAgfSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGF1Z21lbnQgOiBmdW5jdGlvbiAodGFyZ2V0TWV0YSwgaW5mbykge1xuICAgICAgICBKb29zZS5PLmVhY2goaW5mbywgZnVuY3Rpb24gKHZhbHVlLCBuYW1lKSB7XG4gICAgICAgICAgICB0YXJnZXRNZXRhLmFkZE1ldGhvZE1vZGlmaWVyKG5hbWUsIHZhbHVlLCBKb29zZS5NYW5hZ2VkLlByb3BlcnR5Lk1ldGhvZE1vZGlmaWVyLkF1Z21lbnQpXG4gICAgICAgIH0pXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICByZW1vdmVNb2RpZmllciA6IGZ1bmN0aW9uICh0YXJnZXRNZXRhLCBpbmZvKSB7XG4gICAgICAgIEpvb3NlLkEuZWFjaChpbmZvLCBmdW5jdGlvbiAobmFtZSkge1xuICAgICAgICAgICAgdGFyZ2V0TWV0YS5yZW1vdmVNZXRob2RNb2RpZmllcihuYW1lKVxuICAgICAgICB9KVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgZG9lcyA6IGZ1bmN0aW9uICh0YXJnZXRNZXRhLCBpbmZvKSB7XG4gICAgICAgIEpvb3NlLkEuZWFjaChKb29zZS5PLndhbnRBcnJheShpbmZvKSwgZnVuY3Rpb24gKGRlc2MpIHtcbiAgICAgICAgICAgIHRhcmdldE1ldGEuYWRkUm9sZShkZXNjKVxuICAgICAgICB9KVxuICAgIH0sXG4gICAgXG5cbiAgICBkb2Vzbm90IDogZnVuY3Rpb24gKHRhcmdldE1ldGEsIGluZm8pIHtcbiAgICAgICAgSm9vc2UuQS5lYWNoKEpvb3NlLk8ud2FudEFycmF5KGluZm8pLCBmdW5jdGlvbiAoZGVzYykge1xuICAgICAgICAgICAgdGFyZ2V0TWV0YS5yZW1vdmVSb2xlKGRlc2MpXG4gICAgICAgIH0pXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBkb2VzbnQgOiBmdW5jdGlvbiAodGFyZ2V0TWV0YSwgaW5mbykge1xuICAgICAgICB0aGlzLmRvZXNub3QodGFyZ2V0TWV0YSwgaW5mbylcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIHRyYWl0IDogZnVuY3Rpb24gKCkge1xuICAgICAgICB0aGlzLnRyYWl0cy5hcHBseSh0aGlzLCBhcmd1bWVudHMpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICB0cmFpdHMgOiBmdW5jdGlvbiAodGFyZ2V0TWV0YSwgaW5mbykge1xuICAgICAgICBpZiAodGFyZ2V0TWV0YS5maXJzdFBhc3MpIHJldHVyblxuICAgICAgICBcbiAgICAgICAgaWYgKCF0YXJnZXRNZXRhLm1ldGEuaXNEZXRhY2hlZCkgdGhyb3cgXCJDYW4ndCBhcHBseSB0cmFpdCB0byBub3QgZGV0YWNoZWQgY2xhc3NcIlxuICAgICAgICBcbiAgICAgICAgdGFyZ2V0TWV0YS5tZXRhLmV4dGVuZCh7XG4gICAgICAgICAgICBkb2VzIDogaW5mb1xuICAgICAgICB9KVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgcmVtb3ZlVHJhaXQgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHRoaXMucmVtb3ZlVHJhaXRzLmFwcGx5KHRoaXMsIGFyZ3VtZW50cylcbiAgICB9LFxuICAgICBcbiAgICBcbiAgICByZW1vdmVUcmFpdHMgOiBmdW5jdGlvbiAodGFyZ2V0TWV0YSwgaW5mbykge1xuICAgICAgICBpZiAoIXRhcmdldE1ldGEubWV0YS5pc0RldGFjaGVkKSB0aHJvdyBcIkNhbid0IHJlbW92ZSB0cmFpdCBmcm9tIG5vdCBkZXRhY2hlZCBjbGFzc1wiXG4gICAgICAgIFxuICAgICAgICB0YXJnZXRNZXRhLm1ldGEuZXh0ZW5kKHtcbiAgICAgICAgICAgIGRvZXNub3QgOiBpbmZvXG4gICAgICAgIH0pXG4gICAgfVxuICAgIFxuICAgIFxuICAgIFxufSkuYztcbkpvb3NlLk1hbmFnZWQuQ2xhc3MgPSBuZXcgSm9vc2UuUHJvdG8uQ2xhc3MoJ0pvb3NlLk1hbmFnZWQuQ2xhc3MnLCB7XG4gICAgXG4gICAgaXNhICAgICAgICAgICAgICAgICAgICAgICAgIDogSm9vc2UuUHJvdG8uQ2xhc3MsXG4gICAgXG4gICAgc3RlbSAgICAgICAgICAgICAgICAgICAgICAgIDogbnVsbCxcbiAgICBzdGVtQ2xhc3MgICAgICAgICAgICAgICAgICAgOiBKb29zZS5NYW5hZ2VkLlN0ZW0sXG4gICAgc3RlbUNsYXNzQ3JlYXRlZCAgICAgICAgICAgIDogZmFsc2UsXG4gICAgXG4gICAgYnVpbGRlciAgICAgICAgICAgICAgICAgICAgIDogbnVsbCxcbiAgICBidWlsZGVyQ2xhc3MgICAgICAgICAgICAgICAgOiBKb29zZS5NYW5hZ2VkLkJ1aWxkZXIsXG4gICAgYnVpbGRlckNsYXNzQ3JlYXRlZCAgICAgICAgIDogZmFsc2UsXG4gICAgXG4gICAgaXNEZXRhY2hlZCAgICAgICAgICAgICAgICAgIDogZmFsc2UsXG4gICAgZmlyc3RQYXNzICAgICAgICAgICAgICAgICAgIDogdHJ1ZSxcbiAgICBcbiAgICAvLyBhIHNwZWNpYWwgaW5zdGFuY2UsIHdoaWNoLCB3aGVuIHBhc3NlZCBhcyAxc3QgYXJndW1lbnQgdG8gY29uc3RydWN0b3IsIHNpZ25pZmllcyB0aGF0IGNvbnN0cnVjdG9yIHNob3VsZFxuICAgIC8vIHNraXBzIHRyYWl0cyBwcm9jZXNzaW5nIGZvciB0aGlzIGluc3RhbmNlXG4gICAgc2tpcFRyYWl0c0FuY2hvciAgICAgICAgICAgIDoge30sXG4gICAgXG4gICAgXG4gICAgLy9idWlsZCBmb3IgbWV0YWNsYXNzZXMgLSBjb2xsZWN0cyB0cmFpdHMgZnJvbSByb2xlc1xuICAgIEJVSUxEIDogZnVuY3Rpb24gKCkge1xuICAgICAgICB2YXIgc3VwID0gSm9vc2UuTWFuYWdlZC5DbGFzcy5zdXBlckNsYXNzLkJVSUxELmFwcGx5KHRoaXMsIGFyZ3VtZW50cylcbiAgICAgICAgXG4gICAgICAgIHZhciBwcm9wcyAgID0gc3VwLl9fZXh0ZW5kX19cbiAgICAgICAgXG4gICAgICAgIHZhciB0cmFpdHMgPSBKb29zZS5PLndhbnRBcnJheShwcm9wcy50cmFpdCB8fCBwcm9wcy50cmFpdHMgfHwgW10pXG4gICAgICAgIGRlbGV0ZSBwcm9wcy50cmFpdFxuICAgICAgICBkZWxldGUgcHJvcHMudHJhaXRzXG4gICAgICAgIFxuICAgICAgICBKb29zZS5BLmVhY2goSm9vc2UuTy53YW50QXJyYXkocHJvcHMuZG9lcyB8fCBbXSksIGZ1bmN0aW9uIChhcmcpIHtcbiAgICAgICAgICAgIHZhciByb2xlID0gKGFyZy5tZXRhIGluc3RhbmNlb2YgSm9vc2UuTWFuYWdlZC5DbGFzcykgPyBhcmcgOiBhcmcucm9sZVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAocm9sZS5tZXRhLm1ldGEuaXNEZXRhY2hlZCkgdHJhaXRzLnB1c2gocm9sZS5tZXRhLmNvbnN0cnVjdG9yKVxuICAgICAgICB9KVxuICAgICAgICBcbiAgICAgICAgaWYgKHRyYWl0cy5sZW5ndGgpIHByb3BzLnRyYWl0cyA9IHRyYWl0cyBcbiAgICAgICAgXG4gICAgICAgIHJldHVybiBzdXBcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGluaXRJbnN0YW5jZSA6IGZ1bmN0aW9uIChpbnN0YW5jZSwgcHJvcHMpIHtcbiAgICAgICAgSm9vc2UuTy5lYWNoKHRoaXMuYXR0cmlidXRlcywgZnVuY3Rpb24gKGF0dHJpYnV0ZSwgbmFtZSkge1xuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAoYXR0cmlidXRlIGluc3RhbmNlb2YgSm9vc2UuTWFuYWdlZC5BdHRyaWJ1dGUpIFxuICAgICAgICAgICAgICAgIGF0dHJpYnV0ZS5pbml0RnJvbUNvbmZpZyhpbnN0YW5jZSwgcHJvcHMpXG4gICAgICAgICAgICBlbHNlIFxuICAgICAgICAgICAgICAgIGlmIChwcm9wcy5oYXNPd25Qcm9wZXJ0eShuYW1lKSkgaW5zdGFuY2VbbmFtZV0gPSBwcm9wc1tuYW1lXVxuICAgICAgICB9KVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgLy8gd2UgYXJlIHVzaW5nIHRoZSBzYW1lIGNvbnN0cnVjdG9yIGZvciB1c3VhbCBhbmQgbWV0YS0gY2xhc3Nlc1xuICAgIGRlZmF1bHRDb25zdHJ1Y3RvcjogZnVuY3Rpb24gKCkge1xuICAgICAgICByZXR1cm4gZnVuY3Rpb24gKHNraXBUcmFpdHNBbmNob3IsIHBhcmFtcykge1xuICAgICAgICAgICAgXG4gICAgICAgICAgICB2YXIgdGhpc01ldGEgICAgPSB0aGlzLm1ldGFcbiAgICAgICAgICAgIHZhciBza2lwVHJhaXRzICA9IHNraXBUcmFpdHNBbmNob3IgPT0gdGhpc01ldGEuc2tpcFRyYWl0c0FuY2hvclxuICAgICAgICAgICAgXG4gICAgICAgICAgICB2YXIgQlVJTEQgICAgICAgPSB0aGlzLkJVSUxEXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciBwcm9wcyAgICAgICA9IEJVSUxEICYmIEJVSUxELmFwcGx5KHRoaXMsIHNraXBUcmFpdHMgPyBwYXJhbXMgOiBhcmd1bWVudHMpIHx8IChza2lwVHJhaXRzID8gcGFyYW1zWzBdIDogc2tpcFRyYWl0c0FuY2hvcikgfHwge31cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBlaXRoZXIgbG9va2luZyBmb3IgdHJhaXRzIGluIF9fZXh0ZW5kX18gKG1ldGEtY2xhc3MpIG9yIGluIHVzdWFsIHByb3BzICh1c3VhbCBjbGFzcylcbiAgICAgICAgICAgIHZhciBleHRlbmQgID0gcHJvcHMuX19leHRlbmRfXyB8fCBwcm9wc1xuICAgICAgICAgICAgXG4gICAgICAgICAgICB2YXIgdHJhaXRzID0gZXh0ZW5kLnRyYWl0IHx8IGV4dGVuZC50cmFpdHNcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKHRyYWl0cyB8fCBleHRlbmQuZGV0YWNoZWQpIHtcbiAgICAgICAgICAgICAgICBkZWxldGUgZXh0ZW5kLnRyYWl0XG4gICAgICAgICAgICAgICAgZGVsZXRlIGV4dGVuZC50cmFpdHNcbiAgICAgICAgICAgICAgICBkZWxldGUgZXh0ZW5kLmRldGFjaGVkXG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgaWYgKCFza2lwVHJhaXRzKSB7XG4gICAgICAgICAgICAgICAgICAgIHZhciBjbGFzc1dpdGhUcmFpdCAgPSB0aGlzTWV0YS5zdWJDbGFzcyh7IGRvZXMgOiB0cmFpdHMgfHwgW10gfSwgdGhpc01ldGEubmFtZSlcbiAgICAgICAgICAgICAgICAgICAgdmFyIG1ldGEgICAgICAgICAgICA9IGNsYXNzV2l0aFRyYWl0Lm1ldGFcbiAgICAgICAgICAgICAgICAgICAgbWV0YS5pc0RldGFjaGVkICAgICA9IHRydWVcbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBtZXRhLmluc3RhbnRpYXRlKHRoaXNNZXRhLnNraXBUcmFpdHNBbmNob3IsIGFyZ3VtZW50cylcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXNNZXRhLmluaXRJbnN0YW5jZSh0aGlzLCBwcm9wcylcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcmV0dXJuIHRoaXNNZXRhLmhhc01ldGhvZCgnaW5pdGlhbGl6ZScpICYmIHRoaXMuaW5pdGlhbGl6ZShwcm9wcykgfHwgdGhpc1xuICAgICAgICB9XG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBmaW5hbGl6ZTogZnVuY3Rpb24gKGV4dGVuZCkge1xuICAgICAgICBKb29zZS5NYW5hZ2VkLkNsYXNzLnN1cGVyQ2xhc3MuZmluYWxpemUuY2FsbCh0aGlzLCBleHRlbmQpXG4gICAgICAgIFxuICAgICAgICB0aGlzLnN0ZW0uY2xvc2UoKVxuICAgICAgICBcbiAgICAgICAgdGhpcy5hZnRlck11dGF0ZSgpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBwcm9jZXNzU3RlbSA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgSm9vc2UuTWFuYWdlZC5DbGFzcy5zdXBlckNsYXNzLnByb2Nlc3NTdGVtLmNhbGwodGhpcylcbiAgICAgICAgXG4gICAgICAgIHRoaXMuYnVpbGRlciAgICA9IG5ldyB0aGlzLmJ1aWxkZXJDbGFzcyh7IHRhcmdldE1ldGEgOiB0aGlzIH0pXG4gICAgICAgIHRoaXMuc3RlbSAgICAgICA9IG5ldyB0aGlzLnN0ZW1DbGFzcyh7IG5hbWUgOiB0aGlzLm5hbWUsIHRhcmdldE1ldGEgOiB0aGlzIH0pXG4gICAgICAgIFxuICAgICAgICB2YXIgYnVpbGRlckNsYXNzID0gdGhpcy5nZXRDbGFzc0luQXR0cmlidXRlKCdidWlsZGVyQ2xhc3MnKVxuICAgICAgICBcbiAgICAgICAgaWYgKGJ1aWxkZXJDbGFzcykge1xuICAgICAgICAgICAgdGhpcy5idWlsZGVyQ2xhc3NDcmVhdGVkID0gdHJ1ZVxuICAgICAgICAgICAgdGhpcy5hZGRBdHRyaWJ1dGUoJ2J1aWxkZXJDbGFzcycsIHRoaXMuc3ViQ2xhc3NPZihidWlsZGVyQ2xhc3MpKVxuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgdmFyIHN0ZW1DbGFzcyA9IHRoaXMuZ2V0Q2xhc3NJbkF0dHJpYnV0ZSgnc3RlbUNsYXNzJylcbiAgICAgICAgXG4gICAgICAgIGlmIChzdGVtQ2xhc3MpIHtcbiAgICAgICAgICAgIHRoaXMuc3RlbUNsYXNzQ3JlYXRlZCA9IHRydWVcbiAgICAgICAgICAgIHRoaXMuYWRkQXR0cmlidXRlKCdzdGVtQ2xhc3MnLCB0aGlzLnN1YkNsYXNzT2Yoc3RlbUNsYXNzKSlcbiAgICAgICAgfVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgZXh0ZW5kIDogZnVuY3Rpb24gKHByb3BzKSB7XG4gICAgICAgIGlmIChwcm9wcy5idWlsZGVyKSB7XG4gICAgICAgICAgICB0aGlzLmdldEJ1aWxkZXJUYXJnZXQoKS5tZXRhLmV4dGVuZChwcm9wcy5idWlsZGVyKVxuICAgICAgICAgICAgZGVsZXRlIHByb3BzLmJ1aWxkZXJcbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgaWYgKHByb3BzLnN0ZW0pIHtcbiAgICAgICAgICAgIHRoaXMuZ2V0U3RlbVRhcmdldCgpLm1ldGEuZXh0ZW5kKHByb3BzLnN0ZW0pXG4gICAgICAgICAgICBkZWxldGUgcHJvcHMuc3RlbVxuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICB0aGlzLmJ1aWxkZXIuX2V4dGVuZChwcm9wcylcbiAgICAgICAgXG4gICAgICAgIHRoaXMuZmlyc3RQYXNzID0gZmFsc2VcbiAgICAgICAgXG4gICAgICAgIGlmICghdGhpcy5zdGVtLm9wZW5lZCkgdGhpcy5hZnRlck11dGF0ZSgpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBnZXRCdWlsZGVyVGFyZ2V0IDogZnVuY3Rpb24gKCkge1xuICAgICAgICB2YXIgYnVpbGRlckNsYXNzID0gdGhpcy5nZXRDbGFzc0luQXR0cmlidXRlKCdidWlsZGVyQ2xhc3MnKVxuICAgICAgICBpZiAoIWJ1aWxkZXJDbGFzcykgdGhyb3cgXCJBdHRlbXB0IHRvIGV4dGVuZCBhIGJ1aWxkZXIgb24gbm9uLW1ldGEgY2xhc3NcIlxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIGJ1aWxkZXJDbGFzc1xuICAgIH0sXG4gICAgXG5cbiAgICBnZXRTdGVtVGFyZ2V0IDogZnVuY3Rpb24gKCkge1xuICAgICAgICB2YXIgc3RlbUNsYXNzID0gdGhpcy5nZXRDbGFzc0luQXR0cmlidXRlKCdzdGVtQ2xhc3MnKVxuICAgICAgICBpZiAoIXN0ZW1DbGFzcykgdGhyb3cgXCJBdHRlbXB0IHRvIGV4dGVuZCBhIHN0ZW0gb24gbm9uLW1ldGEgY2xhc3NcIlxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIHN0ZW1DbGFzc1xuICAgIH0sXG4gICAgXG4gICAgXG4gICAgZ2V0Q2xhc3NJbkF0dHJpYnV0ZSA6IGZ1bmN0aW9uIChhdHRyaWJ1dGVOYW1lKSB7XG4gICAgICAgIHZhciBhdHRyQ2xhc3MgPSB0aGlzLmdldEF0dHJpYnV0ZShhdHRyaWJ1dGVOYW1lKVxuICAgICAgICBpZiAoYXR0ckNsYXNzIGluc3RhbmNlb2YgSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5BdHRyaWJ1dGUpIGF0dHJDbGFzcyA9IGF0dHJDbGFzcy52YWx1ZVxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIGF0dHJDbGFzc1xuICAgIH0sXG4gICAgXG4gICAgXG4gICAgYWRkTWV0aG9kTW9kaWZpZXI6IGZ1bmN0aW9uIChuYW1lLCBmdW5jLCB0eXBlKSB7XG4gICAgICAgIHZhciBwcm9wcyA9IHt9XG4gICAgICAgIFxuICAgICAgICBwcm9wcy5pbml0ID0gZnVuY1xuICAgICAgICBwcm9wcy5tZXRhID0gdHlwZVxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIHRoaXMuc3RlbS5wcm9wZXJ0aWVzLm1ldGhvZHNNb2RpZmllcnMuYWRkUHJvcGVydHkobmFtZSwgcHJvcHMpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICByZW1vdmVNZXRob2RNb2RpZmllcjogZnVuY3Rpb24gKG5hbWUpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuc3RlbS5wcm9wZXJ0aWVzLm1ldGhvZHNNb2RpZmllcnMucmVtb3ZlUHJvcGVydHkobmFtZSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGFkZE1ldGhvZDogZnVuY3Rpb24gKG5hbWUsIGZ1bmMsIHByb3BzKSB7XG4gICAgICAgIHByb3BzID0gcHJvcHMgfHwge31cbiAgICAgICAgcHJvcHMuaW5pdCA9IGZ1bmNcbiAgICAgICAgXG4gICAgICAgIHJldHVybiB0aGlzLnN0ZW0ucHJvcGVydGllcy5tZXRob2RzLmFkZFByb3BlcnR5KG5hbWUsIHByb3BzKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgYWRkQXR0cmlidXRlOiBmdW5jdGlvbiAobmFtZSwgaW5pdCwgcHJvcHMpIHtcbiAgICAgICAgcHJvcHMgPSBwcm9wcyB8fCB7fVxuICAgICAgICBwcm9wcy5pbml0ID0gaW5pdFxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIHRoaXMuc3RlbS5wcm9wZXJ0aWVzLmF0dHJpYnV0ZXMuYWRkUHJvcGVydHkobmFtZSwgcHJvcHMpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICByZW1vdmVNZXRob2QgOiBmdW5jdGlvbiAobmFtZSkge1xuICAgICAgICByZXR1cm4gdGhpcy5zdGVtLnByb3BlcnRpZXMubWV0aG9kcy5yZW1vdmVQcm9wZXJ0eShuYW1lKVxuICAgIH0sXG5cbiAgICBcbiAgICByZW1vdmVBdHRyaWJ1dGU6IGZ1bmN0aW9uIChuYW1lKSB7XG4gICAgICAgIHJldHVybiB0aGlzLnN0ZW0ucHJvcGVydGllcy5hdHRyaWJ1dGVzLnJlbW92ZVByb3BlcnR5KG5hbWUpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBoYXNNZXRob2Q6IGZ1bmN0aW9uIChuYW1lKSB7XG4gICAgICAgIHJldHVybiB0aGlzLnN0ZW0ucHJvcGVydGllcy5tZXRob2RzLmhhdmVQcm9wZXJ0eShuYW1lKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgaGFzQXR0cmlidXRlOiBmdW5jdGlvbiAobmFtZSkgeyBcbiAgICAgICAgcmV0dXJuIHRoaXMuc3RlbS5wcm9wZXJ0aWVzLmF0dHJpYnV0ZXMuaGF2ZVByb3BlcnR5KG5hbWUpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBoYXNNZXRob2RNb2RpZmllcnNGb3IgOiBmdW5jdGlvbiAobmFtZSkge1xuICAgICAgICByZXR1cm4gdGhpcy5zdGVtLnByb3BlcnRpZXMubWV0aG9kc01vZGlmaWVycy5oYXZlUHJvcGVydHkobmFtZSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGhhc093bk1ldGhvZDogZnVuY3Rpb24gKG5hbWUpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuc3RlbS5wcm9wZXJ0aWVzLm1ldGhvZHMuaGF2ZU93blByb3BlcnR5KG5hbWUpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBoYXNPd25BdHRyaWJ1dGU6IGZ1bmN0aW9uIChuYW1lKSB7IFxuICAgICAgICByZXR1cm4gdGhpcy5zdGVtLnByb3BlcnRpZXMuYXR0cmlidXRlcy5oYXZlT3duUHJvcGVydHkobmFtZSlcbiAgICB9LFxuICAgIFxuXG4gICAgZ2V0TWV0aG9kIDogZnVuY3Rpb24gKG5hbWUpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuc3RlbS5wcm9wZXJ0aWVzLm1ldGhvZHMuZ2V0UHJvcGVydHkobmFtZSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGdldEF0dHJpYnV0ZSA6IGZ1bmN0aW9uIChuYW1lKSB7XG4gICAgICAgIHJldHVybiB0aGlzLnN0ZW0ucHJvcGVydGllcy5hdHRyaWJ1dGVzLmdldFByb3BlcnR5KG5hbWUpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBlYWNoUm9sZSA6IGZ1bmN0aW9uIChyb2xlcywgZnVuYywgc2NvcGUpIHtcbiAgICAgICAgSm9vc2UuQS5lYWNoKHJvbGVzLCBmdW5jdGlvbiAoYXJnLCBpbmRleCkge1xuICAgICAgICAgICAgdmFyIHJvbGUgPSAoYXJnLm1ldGEgaW5zdGFuY2VvZiBKb29zZS5NYW5hZ2VkLkNsYXNzKSA/IGFyZyA6IGFyZy5yb2xlXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGZ1bmMuY2FsbChzY29wZSB8fCB0aGlzLCBhcmcsIHJvbGUsIGluZGV4KVxuICAgICAgICB9LCB0aGlzKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgYWRkUm9sZSA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgXG4gICAgICAgIHRoaXMuZWFjaFJvbGUoYXJndW1lbnRzLCBmdW5jdGlvbiAoYXJnLCByb2xlKSB7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXMuYmVmb3JlUm9sZUFkZChyb2xlKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB2YXIgZGVzYyA9IGFyZ1xuICAgICAgICAgICAgXG4gICAgICAgICAgICAvL2NvbXBvc2UgZGVzY3JpcHRvciBjYW4gY29udGFpbiAnYWxpYXMnIGFuZCAnZXhjbHVkZScgZmllbGRzLCBpbiB0aGlzIGNhc2UgYWN0dWFsIHJlZmVyZW5jZSBzaG91bGQgYmUgc3RvcmVkXG4gICAgICAgICAgICAvL2ludG8gJ3Byb3BlcnR5U2V0JyBmaWVsZFxuICAgICAgICAgICAgaWYgKHJvbGUgIT0gYXJnKSB7XG4gICAgICAgICAgICAgICAgZGVzYy5wcm9wZXJ0eVNldCA9IHJvbGUubWV0YS5zdGVtXG4gICAgICAgICAgICAgICAgZGVsZXRlIGRlc2Mucm9sZVxuICAgICAgICAgICAgfSBlbHNlXG4gICAgICAgICAgICAgICAgZGVzYyA9IGRlc2MubWV0YS5zdGVtXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXMuc3RlbS5hZGRDb21wb3NlSW5mbyhkZXNjKVxuICAgICAgICAgICAgXG4gICAgICAgIH0sIHRoaXMpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBiZWZvcmVSb2xlQWRkIDogZnVuY3Rpb24gKHJvbGUpIHtcbiAgICAgICAgdmFyIHJvbGVNZXRhID0gcm9sZS5tZXRhXG4gICAgICAgIFxuICAgICAgICBpZiAocm9sZU1ldGEuYnVpbGRlckNsYXNzQ3JlYXRlZCkgdGhpcy5nZXRCdWlsZGVyVGFyZ2V0KCkubWV0YS5leHRlbmQoe1xuICAgICAgICAgICAgZG9lcyA6IFsgcm9sZU1ldGEuZ2V0QnVpbGRlclRhcmdldCgpIF1cbiAgICAgICAgfSlcbiAgICAgICAgXG4gICAgICAgIGlmIChyb2xlTWV0YS5zdGVtQ2xhc3NDcmVhdGVkKSB0aGlzLmdldFN0ZW1UYXJnZXQoKS5tZXRhLmV4dGVuZCh7XG4gICAgICAgICAgICBkb2VzIDogWyByb2xlTWV0YS5nZXRTdGVtVGFyZ2V0KCkgXVxuICAgICAgICB9KVxuICAgICAgICBcbiAgICAgICAgaWYgKHJvbGVNZXRhLm1ldGEuaXNEZXRhY2hlZCAmJiAhdGhpcy5maXJzdFBhc3MpIHRoaXMuYnVpbGRlci50cmFpdHModGhpcywgcm9sZU1ldGEuY29uc3RydWN0b3IpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBiZWZvcmVSb2xlUmVtb3ZlIDogZnVuY3Rpb24gKHJvbGUpIHtcbiAgICAgICAgdmFyIHJvbGVNZXRhID0gcm9sZS5tZXRhXG4gICAgICAgIFxuICAgICAgICBpZiAocm9sZU1ldGEuYnVpbGRlckNsYXNzQ3JlYXRlZCkgdGhpcy5nZXRCdWlsZGVyVGFyZ2V0KCkubWV0YS5leHRlbmQoe1xuICAgICAgICAgICAgZG9lc250IDogWyByb2xlTWV0YS5nZXRCdWlsZGVyVGFyZ2V0KCkgXVxuICAgICAgICB9KVxuICAgICAgICBcbiAgICAgICAgaWYgKHJvbGVNZXRhLnN0ZW1DbGFzc0NyZWF0ZWQpIHRoaXMuZ2V0U3RlbVRhcmdldCgpLm1ldGEuZXh0ZW5kKHtcbiAgICAgICAgICAgIGRvZXNudCA6IFsgcm9sZU1ldGEuZ2V0U3RlbVRhcmdldCgpIF1cbiAgICAgICAgfSlcbiAgICAgICAgXG4gICAgICAgIGlmIChyb2xlTWV0YS5tZXRhLmlzRGV0YWNoZWQgJiYgIXRoaXMuZmlyc3RQYXNzKSB0aGlzLmJ1aWxkZXIucmVtb3ZlVHJhaXRzKHRoaXMsIHJvbGVNZXRhLmNvbnN0cnVjdG9yKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgcmVtb3ZlUm9sZSA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgdGhpcy5lYWNoUm9sZShhcmd1bWVudHMsIGZ1bmN0aW9uIChhcmcsIHJvbGUpIHtcbiAgICAgICAgICAgIHRoaXMuYmVmb3JlUm9sZVJlbW92ZShyb2xlKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLnN0ZW0ucmVtb3ZlQ29tcG9zZUluZm8ocm9sZS5tZXRhLnN0ZW0pXG4gICAgICAgIH0sIHRoaXMpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBnZXRSb2xlcyA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgXG4gICAgICAgIHJldHVybiBKb29zZS5BLm1hcCh0aGlzLnN0ZW0uY29tcG9zZWRGcm9tLCBmdW5jdGlvbiAoY29tcG9zZURlc2MpIHtcbiAgICAgICAgICAgIC8vY29tcG9zZSBkZXNjcmlwdG9yIGNhbiBjb250YWluICdhbGlhcycgYW5kICdleGNsdWRlJyBmaWVsZHMsIGluIHRoaXMgY2FzZSBhY3R1YWwgcmVmZXJlbmNlIGlzIHN0b3JlZFxuICAgICAgICAgICAgLy9pbnRvICdwcm9wZXJ0eVNldCcgZmllbGRcbiAgICAgICAgICAgIGlmICghKGNvbXBvc2VEZXNjIGluc3RhbmNlb2YgSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eVNldCkpIHJldHVybiBjb21wb3NlRGVzYy5wcm9wZXJ0eVNldFxuICAgICAgICAgICAgXG4gICAgICAgICAgICByZXR1cm4gY29tcG9zZURlc2MudGFyZ2V0TWV0YS5jXG4gICAgICAgIH0pXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBkb2VzIDogZnVuY3Rpb24gKHJvbGUpIHtcbiAgICAgICAgdmFyIG15Um9sZXMgPSB0aGlzLmdldFJvbGVzKClcbiAgICAgICAgXG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgbXlSb2xlcy5sZW5ndGg7IGkrKykgaWYgKHJvbGUgPT0gbXlSb2xlc1tpXSkgcmV0dXJuIHRydWVcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBteVJvbGVzLmxlbmd0aDsgaSsrKSBpZiAobXlSb2xlc1tpXS5tZXRhLmRvZXMocm9sZSkpIHJldHVybiB0cnVlXG4gICAgICAgIFxuICAgICAgICB2YXIgc3VwZXJNZXRhID0gdGhpcy5zdXBlckNsYXNzLm1ldGFcbiAgICAgICAgXG4gICAgICAgIC8vIGNvbnNpZGVyaW5nIHRoZSBjYXNlIG9mIGluaGVyaXRpbmcgZnJvbSBub24tSm9vc2UgY2xhc3Nlc1xuICAgICAgICBpZiAodGhpcy5zdXBlckNsYXNzICE9IEpvb3NlLlByb3RvLkVtcHR5ICYmIHN1cGVyTWV0YSAmJiBzdXBlck1ldGEubWV0YSAmJiBzdXBlck1ldGEubWV0YS5oYXNNZXRob2QoJ2RvZXMnKSkgcmV0dXJuIHN1cGVyTWV0YS5kb2VzKHJvbGUpXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gZmFsc2VcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGdldE1ldGhvZHMgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHJldHVybiB0aGlzLnN0ZW0ucHJvcGVydGllcy5tZXRob2RzXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBnZXRBdHRyaWJ1dGVzIDogZnVuY3Rpb24gKCkge1xuICAgICAgICByZXR1cm4gdGhpcy5zdGVtLnByb3BlcnRpZXMuYXR0cmlidXRlc1xuICAgIH0sXG4gICAgXG4gICAgXG4gICAgYWZ0ZXJNdXRhdGUgOiBmdW5jdGlvbiAoKSB7XG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBnZXRDdXJyZW50TWV0aG9kIDogZnVuY3Rpb24gKCkge1xuICAgICAgICBmb3IgKHZhciB3cmFwcGVyID0gYXJndW1lbnRzLmNhbGxlZS5jYWxsZXIsIGNvdW50ID0gMDsgd3JhcHBlciAmJiBjb3VudCA8IDU7IHdyYXBwZXIgPSB3cmFwcGVyLmNhbGxlciwgY291bnQrKylcbiAgICAgICAgICAgIGlmICh3cmFwcGVyLl9fTUVUSE9EX18pIHJldHVybiB3cmFwcGVyLl9fTUVUSE9EX19cbiAgICAgICAgXG4gICAgICAgIHJldHVybiBudWxsXG4gICAgfVxuICAgIFxuICAgIFxufSkuYztcbkpvb3NlLk1hbmFnZWQuUm9sZSA9IG5ldyBKb29zZS5NYW5hZ2VkLkNsYXNzKCdKb29zZS5NYW5hZ2VkLlJvbGUnLCB7XG4gICAgXG4gICAgaXNhICAgICAgICAgICAgICAgICAgICAgICAgIDogSm9vc2UuTWFuYWdlZC5DbGFzcyxcbiAgICBcbiAgICBoYXZlIDoge1xuICAgICAgICBkZWZhdWx0U3VwZXJDbGFzcyAgICAgICA6IEpvb3NlLlByb3RvLkVtcHR5LFxuICAgICAgICBcbiAgICAgICAgYnVpbGRlclJvbGUgICAgICAgICAgICAgOiBudWxsLFxuICAgICAgICBzdGVtUm9sZSAgICAgICAgICAgICAgICA6IG51bGxcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIG1ldGhvZHMgOiB7XG4gICAgICAgIFxuICAgICAgICBkZWZhdWx0Q29uc3RydWN0b3IgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICByZXR1cm4gZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcIlJvbGVzIGNhbnQgYmUgaW5zdGFudGlhdGVkXCIpXG4gICAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIFxuXG4gICAgICAgIHByb2Nlc3NTdXBlckNsYXNzIDogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgaWYgKHRoaXMuc3VwZXJDbGFzcyAhPSB0aGlzLmRlZmF1bHRTdXBlckNsYXNzKSB0aHJvdyBuZXcgRXJyb3IoXCJSb2xlcyBjYW4ndCBpbmhlcml0IGZyb20gYW55dGhpbmdcIilcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBnZXRCdWlsZGVyVGFyZ2V0IDogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgaWYgKCF0aGlzLmJ1aWxkZXJSb2xlKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5idWlsZGVyUm9sZSA9IG5ldyB0aGlzLmNvbnN0cnVjdG9yKCkuY1xuICAgICAgICAgICAgICAgIHRoaXMuYnVpbGRlckNsYXNzQ3JlYXRlZCA9IHRydWVcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcmV0dXJuIHRoaXMuYnVpbGRlclJvbGVcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgXG4gICAgICAgIGdldFN0ZW1UYXJnZXQgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBpZiAoIXRoaXMuc3RlbVJvbGUpIHtcbiAgICAgICAgICAgICAgICB0aGlzLnN0ZW1Sb2xlID0gbmV3IHRoaXMuY29uc3RydWN0b3IoKS5jXG4gICAgICAgICAgICAgICAgdGhpcy5zdGVtQ2xhc3NDcmVhdGVkID0gdHJ1ZVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5zdGVtUm9sZVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICBcbiAgICAgICAgYWRkUmVxdWlyZW1lbnQgOiBmdW5jdGlvbiAobWV0aG9kTmFtZSkge1xuICAgICAgICAgICAgdGhpcy5zdGVtLnByb3BlcnRpZXMucmVxdWlyZW1lbnRzLmFkZFByb3BlcnR5KG1ldGhvZE5hbWUsIHt9KVxuICAgICAgICB9XG4gICAgICAgIFxuICAgIH0sXG4gICAgXG5cbiAgICBzdGVtIDoge1xuICAgICAgICBtZXRob2RzIDoge1xuICAgICAgICAgICAgXG4gICAgICAgICAgICBhcHBseSA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdW5hcHBseSA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgYnVpbGRlciA6IHtcbiAgICAgICAgbWV0aG9kcyA6IHtcbiAgICAgICAgICAgIHJlcXVpcmVzIDogZnVuY3Rpb24gKHRhcmdldENsYXNzTWV0YSwgaW5mbykge1xuICAgICAgICAgICAgICAgIEpvb3NlLkEuZWFjaChKb29zZS5PLndhbnRBcnJheShpbmZvKSwgZnVuY3Rpb24gKG1ldGhvZE5hbWUpIHtcbiAgICAgICAgICAgICAgICAgICAgdGFyZ2V0Q2xhc3NNZXRhLmFkZFJlcXVpcmVtZW50KG1ldGhvZE5hbWUpXG4gICAgICAgICAgICAgICAgfSwgdGhpcylcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cbiAgICBcbn0pLmM7XG5Kb29zZS5NYW5hZ2VkLkF0dHJpYnV0ZSA9IG5ldyBKb29zZS5NYW5hZ2VkLkNsYXNzKCdKb29zZS5NYW5hZ2VkLkF0dHJpYnV0ZScsIHtcbiAgICBcbiAgICBpc2EgOiBKb29zZS5NYW5hZ2VkLlByb3BlcnR5LkF0dHJpYnV0ZSxcbiAgICBcbiAgICBoYXZlIDoge1xuICAgICAgICBpcyAgICAgICAgICAgICAgOiBudWxsLFxuICAgICAgICBcbiAgICAgICAgYnVpbGRlciAgICAgICAgIDogbnVsbCxcbiAgICAgICAgXG4gICAgICAgIGlzUHJpdmF0ZSAgICAgICA6IGZhbHNlLFxuICAgICAgICBcbiAgICAgICAgcm9sZSAgICAgICAgICAgIDogbnVsbCxcbiAgICAgICAgXG4gICAgICAgIHB1YmxpY05hbWUgICAgICA6IG51bGwsXG4gICAgICAgIHNldHRlck5hbWUgICAgICA6IG51bGwsXG4gICAgICAgIGdldHRlck5hbWUgICAgICA6IG51bGwsXG4gICAgICAgIFxuICAgICAgICAvL2luZGljYXRlcyB0aGUgbG9naWNhbCByZWFkYWJsZW5lc3Mvd3JpdGVhYmxlbmVzcyBvZiB0aGUgYXR0cmlidXRlXG4gICAgICAgIHJlYWRhYmxlICAgICAgICA6IGZhbHNlLFxuICAgICAgICB3cml0ZWFibGUgICAgICAgOiBmYWxzZSxcbiAgICAgICAgXG4gICAgICAgIC8vaW5kaWNhdGVzIHRoZSBwaHlzaWNhbCBwcmVzZW5zZSBvZiB0aGUgYWNjZXNzb3IgKG1heSBiZSBhYnNlbnQgZm9yIFwiY29tYmluZWRcIiBhY2Nlc3NvcnMgZm9yIGV4YW1wbGUpXG4gICAgICAgIGhhc0dldHRlciAgICAgICA6IGZhbHNlLFxuICAgICAgICBoYXNTZXR0ZXIgICAgICAgOiBmYWxzZSxcbiAgICAgICAgXG4gICAgICAgIHJlcXVpcmVkICAgICAgICA6IGZhbHNlLFxuICAgICAgICBcbiAgICAgICAgY2FuSW5saW5lU2V0UmF3IDogdHJ1ZSxcbiAgICAgICAgY2FuSW5saW5lR2V0UmF3IDogdHJ1ZVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgYWZ0ZXIgOiB7XG4gICAgICAgIGluaXRpYWxpemUgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB2YXIgbmFtZSA9IHRoaXMubmFtZVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLnB1YmxpY05hbWUgPSBuYW1lLnJlcGxhY2UoL15fKy8sICcnKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLnNsb3QgPSB0aGlzLmlzUHJpdmF0ZSA/ICckJCcgKyBuYW1lIDogbmFtZVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLnNldHRlck5hbWUgPSB0aGlzLnNldHRlck5hbWUgfHwgdGhpcy5nZXRTZXR0ZXJOYW1lKClcbiAgICAgICAgICAgIHRoaXMuZ2V0dGVyTmFtZSA9IHRoaXMuZ2V0dGVyTmFtZSB8fCB0aGlzLmdldEdldHRlck5hbWUoKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLnJlYWRhYmxlICA9IHRoaXMuaGFzR2V0dGVyID0gL15yL2kudGVzdCh0aGlzLmlzKVxuICAgICAgICAgICAgdGhpcy53cml0ZWFibGUgPSB0aGlzLmhhc1NldHRlciA9IC9eLncvaS50ZXN0KHRoaXMuaXMpXG4gICAgICAgIH1cbiAgICB9LFxuICAgIFxuICAgIFxuICAgIG92ZXJyaWRlIDoge1xuICAgICAgICBcbiAgICAgICAgY29tcHV0ZVZhbHVlIDogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgdmFyIGluaXQgICAgPSB0aGlzLmluaXRcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKEpvb3NlLk8uaXNDbGFzcyhpbml0KSB8fCAhSm9vc2UuTy5pc0Z1bmN0aW9uKGluaXQpKSB0aGlzLlNVUEVSKClcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBwcmVBcHBseSA6IGZ1bmN0aW9uICh0YXJnZXRDbGFzcykge1xuICAgICAgICAgICAgdGFyZ2V0Q2xhc3MubWV0YS5leHRlbmQoe1xuICAgICAgICAgICAgICAgIG1ldGhvZHMgOiB0aGlzLmdldEFjY2Vzc29yc0Zvcih0YXJnZXRDbGFzcylcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgcG9zdFVuQXBwbHkgOiBmdW5jdGlvbiAoZnJvbSkge1xuICAgICAgICAgICAgZnJvbS5tZXRhLmV4dGVuZCh7XG4gICAgICAgICAgICAgICAgcmVtb3ZlTWV0aG9kcyA6IHRoaXMuZ2V0QWNjZXNzb3JzRnJvbShmcm9tKVxuICAgICAgICAgICAgfSlcbiAgICAgICAgfVxuICAgICAgICBcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIG1ldGhvZHMgOiB7XG4gICAgICAgIFxuICAgICAgICBnZXRBY2Nlc3NvcnNGb3IgOiBmdW5jdGlvbiAodGFyZ2V0Q2xhc3MpIHtcbiAgICAgICAgICAgIHZhciB0YXJnZXRNZXRhID0gdGFyZ2V0Q2xhc3MubWV0YVxuICAgICAgICAgICAgdmFyIHNldHRlck5hbWUgPSB0aGlzLnNldHRlck5hbWVcbiAgICAgICAgICAgIHZhciBnZXR0ZXJOYW1lID0gdGhpcy5nZXR0ZXJOYW1lXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciBtZXRob2RzID0ge31cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKHRoaXMuaGFzU2V0dGVyICYmICF0YXJnZXRNZXRhLmhhc01ldGhvZChzZXR0ZXJOYW1lKSkge1xuICAgICAgICAgICAgICAgIG1ldGhvZHNbc2V0dGVyTmFtZV0gPSB0aGlzLmdldFNldHRlcigpXG4gICAgICAgICAgICAgICAgbWV0aG9kc1tzZXR0ZXJOYW1lXS5BQ0NFU1NPUl9GUk9NID0gdGhpc1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAodGhpcy5oYXNHZXR0ZXIgJiYgIXRhcmdldE1ldGEuaGFzTWV0aG9kKGdldHRlck5hbWUpKSB7XG4gICAgICAgICAgICAgICAgbWV0aG9kc1tnZXR0ZXJOYW1lXSA9IHRoaXMuZ2V0R2V0dGVyKClcbiAgICAgICAgICAgICAgICBtZXRob2RzW2dldHRlck5hbWVdLkFDQ0VTU09SX0ZST00gPSB0aGlzXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHJldHVybiBtZXRob2RzXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgZ2V0QWNjZXNzb3JzRnJvbSA6IGZ1bmN0aW9uIChmcm9tKSB7XG4gICAgICAgICAgICB2YXIgdGFyZ2V0TWV0YSA9IGZyb20ubWV0YVxuICAgICAgICAgICAgdmFyIHNldHRlck5hbWUgPSB0aGlzLnNldHRlck5hbWVcbiAgICAgICAgICAgIHZhciBnZXR0ZXJOYW1lID0gdGhpcy5nZXR0ZXJOYW1lXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciBzZXR0ZXIgPSB0aGlzLmhhc1NldHRlciAmJiB0YXJnZXRNZXRhLmdldE1ldGhvZChzZXR0ZXJOYW1lKVxuICAgICAgICAgICAgdmFyIGdldHRlciA9IHRoaXMuaGFzR2V0dGVyICYmIHRhcmdldE1ldGEuZ2V0TWV0aG9kKGdldHRlck5hbWUpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciByZW1vdmVNZXRob2RzID0gW11cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKHNldHRlciAmJiBzZXR0ZXIudmFsdWUuQUNDRVNTT1JfRlJPTSA9PSB0aGlzKSByZW1vdmVNZXRob2RzLnB1c2goc2V0dGVyTmFtZSlcbiAgICAgICAgICAgIGlmIChnZXR0ZXIgJiYgZ2V0dGVyLnZhbHVlLkFDQ0VTU09SX0ZST00gPT0gdGhpcykgcmVtb3ZlTWV0aG9kcy5wdXNoKGdldHRlck5hbWUpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHJldHVybiByZW1vdmVNZXRob2RzXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgZ2V0R2V0dGVyTmFtZSA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHJldHVybiAnZ2V0JyArIEpvb3NlLlMudXBwZXJjYXNlRmlyc3QodGhpcy5wdWJsaWNOYW1lKVxuICAgICAgICB9LFxuXG5cbiAgICAgICAgZ2V0U2V0dGVyTmFtZSA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHJldHVybiAnc2V0JyArIEpvb3NlLlMudXBwZXJjYXNlRmlyc3QodGhpcy5wdWJsaWNOYW1lKVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIGdldFNldHRlciA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHZhciBtZSAgICAgID0gdGhpc1xuICAgICAgICAgICAgdmFyIHNsb3QgICAgPSBtZS5zbG90XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmIChtZS5jYW5JbmxpbmVTZXRSYXcpXG4gICAgICAgICAgICAgICAgcmV0dXJuIGZ1bmN0aW9uICh2YWx1ZSkge1xuICAgICAgICAgICAgICAgICAgICB0aGlzWyBzbG90IF0gPSB2YWx1ZVxuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRoaXNcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICBlbHNlXG4gICAgICAgICAgICAgICAgcmV0dXJuIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIG1lLnNldFJhd1ZhbHVlVG8uYXBwbHkodGhpcywgYXJndW1lbnRzKVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBnZXRHZXR0ZXIgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB2YXIgbWUgICAgICA9IHRoaXNcbiAgICAgICAgICAgIHZhciBzbG90ICAgID0gbWUuc2xvdFxuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAobWUuY2FuSW5saW5lR2V0UmF3KVxuICAgICAgICAgICAgICAgIHJldHVybiBmdW5jdGlvbiAodmFsdWUpIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRoaXNbIHNsb3QgXVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGVsc2VcbiAgICAgICAgICAgICAgICByZXR1cm4gZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gbWUuZ2V0UmF3VmFsdWVGcm9tLmFwcGx5KHRoaXMsIGFyZ3VtZW50cylcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgZ2V0VmFsdWVGcm9tIDogZnVuY3Rpb24gKGluc3RhbmNlKSB7XG4gICAgICAgICAgICB2YXIgZ2V0dGVyTmFtZSAgICAgID0gdGhpcy5nZXR0ZXJOYW1lXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmICh0aGlzLnJlYWRhYmxlICYmIGluc3RhbmNlLm1ldGEuaGFzTWV0aG9kKGdldHRlck5hbWUpKSByZXR1cm4gaW5zdGFuY2VbIGdldHRlck5hbWUgXSgpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHJldHVybiB0aGlzLmdldFJhd1ZhbHVlRnJvbShpbnN0YW5jZSlcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBzZXRWYWx1ZVRvIDogZnVuY3Rpb24gKGluc3RhbmNlLCB2YWx1ZSkge1xuICAgICAgICAgICAgdmFyIHNldHRlck5hbWUgICAgICA9IHRoaXMuc2V0dGVyTmFtZVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAodGhpcy53cml0ZWFibGUgJiYgaW5zdGFuY2UubWV0YS5oYXNNZXRob2Qoc2V0dGVyTmFtZSkpIFxuICAgICAgICAgICAgICAgIGluc3RhbmNlWyBzZXR0ZXJOYW1lIF0odmFsdWUpXG4gICAgICAgICAgICBlbHNlXG4gICAgICAgICAgICAgICAgdGhpcy5zZXRSYXdWYWx1ZVRvKGluc3RhbmNlLCB2YWx1ZSlcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBpbml0RnJvbUNvbmZpZyA6IGZ1bmN0aW9uIChpbnN0YW5jZSwgY29uZmlnKSB7XG4gICAgICAgICAgICB2YXIgbmFtZSAgICAgICAgICAgID0gdGhpcy5uYW1lXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciB2YWx1ZSwgaXNTZXQgPSBmYWxzZVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAoY29uZmlnLmhhc093blByb3BlcnR5KG5hbWUpKSB7XG4gICAgICAgICAgICAgICAgdmFsdWUgPSBjb25maWdbbmFtZV1cbiAgICAgICAgICAgICAgICBpc1NldCA9IHRydWVcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgdmFyIGluaXQgICAgPSB0aGlzLmluaXRcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAvLyBzaW1wbGUgZnVuY3Rpb24gKG5vdCBjbGFzcykgaGFzIGJlZW4gdXNlZCBhcyBcImluaXRcIiB2YWx1ZVxuICAgICAgICAgICAgICAgIGlmIChKb29zZS5PLmlzRnVuY3Rpb24oaW5pdCkgJiYgIUpvb3NlLk8uaXNDbGFzcyhpbml0KSkge1xuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgdmFsdWUgPSBpbml0LmNhbGwoaW5zdGFuY2UsIGNvbmZpZywgbmFtZSlcbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIGlzU2V0ID0gdHJ1ZVxuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKHRoaXMuYnVpbGRlcikge1xuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgdmFsdWUgPSBpbnN0YW5jZVsgdGhpcy5idWlsZGVyLnJlcGxhY2UoL150aGlzXFwuLywgJycpIF0oY29uZmlnLCBuYW1lKVxuICAgICAgICAgICAgICAgICAgICBpc1NldCA9IHRydWVcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmIChpc1NldClcbiAgICAgICAgICAgICAgICB0aGlzLnNldFJhd1ZhbHVlVG8oaW5zdGFuY2UsIHZhbHVlKVxuICAgICAgICAgICAgZWxzZSBcbiAgICAgICAgICAgICAgICBpZiAodGhpcy5yZXF1aXJlZCkgdGhyb3cgbmV3IEVycm9yKFwiUmVxdWlyZWQgYXR0cmlidXRlIFtcIiArIG5hbWUgKyBcIl0gaXMgbWlzc2VkIGR1cmluZyBpbml0aWFsaXphdGlvbiBvZiBcIiArIGluc3RhbmNlKVxuICAgICAgICB9XG4gICAgfVxuXG59KS5jXG47XG5Kb29zZS5NYW5hZ2VkLkF0dHJpYnV0ZS5CdWlsZGVyID0gbmV3IEpvb3NlLk1hbmFnZWQuUm9sZSgnSm9vc2UuTWFuYWdlZC5BdHRyaWJ1dGUuQnVpbGRlcicsIHtcbiAgICBcbiAgICBcbiAgICBoYXZlIDoge1xuICAgICAgICBkZWZhdWx0QXR0cmlidXRlQ2xhc3MgOiBKb29zZS5NYW5hZ2VkLkF0dHJpYnV0ZVxuICAgIH0sXG4gICAgXG4gICAgYnVpbGRlciA6IHtcbiAgICAgICAgXG4gICAgICAgIG1ldGhvZHMgOiB7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGhhcyA6IGZ1bmN0aW9uICh0YXJnZXRDbGFzc01ldGEsIGluZm8pIHtcbiAgICAgICAgICAgICAgICBKb29zZS5PLmVhY2hPd24oaW5mbywgZnVuY3Rpb24gKHByb3BzLCBuYW1lKSB7XG4gICAgICAgICAgICAgICAgICAgIGlmICh0eXBlb2YgcHJvcHMgIT0gJ29iamVjdCcgfHwgcHJvcHMgPT0gbnVsbCB8fCBwcm9wcy5jb25zdHJ1Y3RvciA9PSAvIC8uY29uc3RydWN0b3IpIHByb3BzID0geyBpbml0IDogcHJvcHMgfVxuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgcHJvcHMubWV0YSA9IHByb3BzLm1ldGEgfHwgdGFyZ2V0Q2xhc3NNZXRhLmRlZmF1bHRBdHRyaWJ1dGVDbGFzc1xuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgaWYgKC9eX18vLnRlc3QobmFtZSkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIG5hbWUgPSBuYW1lLnJlcGxhY2UoL15fKy8sICcnKVxuICAgICAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgICAgICBwcm9wcy5pc1ByaXZhdGUgPSB0cnVlXG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIHRhcmdldENsYXNzTWV0YS5hZGRBdHRyaWJ1dGUobmFtZSwgcHJvcHMuaW5pdCwgcHJvcHMpXG4gICAgICAgICAgICAgICAgfSwgdGhpcylcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaGFzbm90IDogZnVuY3Rpb24gKHRhcmdldENsYXNzTWV0YSwgaW5mbykge1xuICAgICAgICAgICAgICAgIHRoaXMuaGF2ZW5vdCh0YXJnZXRDbGFzc01ldGEsIGluZm8pXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGhhc250IDogZnVuY3Rpb24gKHRhcmdldENsYXNzTWV0YSwgaW5mbykge1xuICAgICAgICAgICAgICAgIHRoaXMuaGFzbm90KHRhcmdldENsYXNzTWV0YSwgaW5mbylcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICAgICAgXG4gICAgfVxuICAgIFxufSkuY1xuO1xuSm9vc2UuTWFuYWdlZC5NeSA9IG5ldyBKb29zZS5NYW5hZ2VkLlJvbGUoJ0pvb3NlLk1hbmFnZWQuTXknLCB7XG4gICAgXG4gICAgaGF2ZSA6IHtcbiAgICAgICAgbXlDbGFzcyAgICAgICAgICAgICAgICAgICAgICAgICA6IG51bGwsXG4gICAgICAgIFxuICAgICAgICBuZWVkVG9SZUFsaWFzICAgICAgICAgICAgICAgICAgIDogZmFsc2VcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIG1ldGhvZHMgOiB7XG4gICAgICAgIGNyZWF0ZU15IDogZnVuY3Rpb24gKGV4dGVuZCkge1xuICAgICAgICAgICAgdmFyIHRoaXNNZXRhID0gdGhpcy5tZXRhXG4gICAgICAgICAgICB2YXIgaXNSb2xlID0gdGhpcyBpbnN0YW5jZW9mIEpvb3NlLk1hbmFnZWQuUm9sZVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB2YXIgbXlFeHRlbmQgPSBleHRlbmQubXkgfHwge31cbiAgICAgICAgICAgIGRlbGV0ZSBleHRlbmQubXlcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gU3ltYmlvbnQgd2lsbCBnZW5lcmFsbHkgaGF2ZSB0aGUgc2FtZSBtZXRhIGNsYXNzIGFzIGl0cyBob3N0ZXIsIGV4Y2VwdGluZyB0aGUgY2FzZXMsIHdoZW4gdGhlIHN1cGVyY2xhc3MgYWxzbyBoYXZlIHRoZSBzeW1iaW9udC4gXG4gICAgICAgICAgICAvLyBJbiBzdWNoIGNhc2VzLCB0aGUgbWV0YSBjbGFzcyBmb3Igc3ltYmlvbnQgd2lsbCBiZSBpbmhlcml0ZWQgKHVubGVzcyBleHBsaWNpdGx5IHNwZWNpZmllZClcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdmFyIHN1cGVyQ2xhc3NNeSAgICA9IHRoaXMuc3VwZXJDbGFzcy5tZXRhLm15Q2xhc3NcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKCFpc1JvbGUgJiYgIW15RXh0ZW5kLmlzYSAmJiBzdXBlckNsYXNzTXkpIG15RXh0ZW5kLmlzYSA9IHN1cGVyQ2xhc3NNeVxuICAgICAgICAgICAgXG5cbiAgICAgICAgICAgIGlmICghbXlFeHRlbmQubWV0YSAmJiAhbXlFeHRlbmQuaXNhKSBteUV4dGVuZC5tZXRhID0gdGhpcy5jb25zdHJ1Y3RvclxuICAgICAgICAgICAgXG4gICAgICAgICAgICB2YXIgY3JlYXRlZENsYXNzICAgID0gdGhpcy5teUNsYXNzID0gQ2xhc3MobXlFeHRlbmQpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciBjICAgICAgICAgICAgICAgPSB0aGlzLmNcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgYy5wcm90b3R5cGUubXkgICAgICA9IGMubXkgPSBpc1JvbGUgPyBjcmVhdGVkQ2xhc3MgOiBuZXcgY3JlYXRlZENsYXNzKHsgSE9TVCA6IGMgfSlcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpcy5uZWVkVG9SZUFsaWFzID0gdHJ1ZVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIGFsaWFzU3RhdGljTWV0aG9kcyA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHRoaXMubmVlZFRvUmVBbGlhcyA9IGZhbHNlXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciBjICAgICAgICAgICA9IHRoaXMuY1xuICAgICAgICAgICAgdmFyIG15UHJvdG8gICAgID0gdGhpcy5teUNsYXNzLnByb3RvdHlwZVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBKb29zZS5PLmVhY2hPd24oYywgZnVuY3Rpb24gKHByb3BlcnR5LCBuYW1lKSB7XG4gICAgICAgICAgICAgICAgaWYgKHByb3BlcnR5LklTX0FMSUFTKSBkZWxldGUgY1sgbmFtZSBdIFxuICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpcy5teUNsYXNzLm1ldGEuc3RlbS5wcm9wZXJ0aWVzLm1ldGhvZHMuZWFjaChmdW5jdGlvbiAobWV0aG9kLCBuYW1lKSB7XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgaWYgKCFjWyBuYW1lIF0pXG4gICAgICAgICAgICAgICAgICAgIChjWyBuYW1lIF0gPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gbXlQcm90b1sgbmFtZSBdLmFwcGx5KGMubXksIGFyZ3VtZW50cylcbiAgICAgICAgICAgICAgICAgICAgfSkuSVNfQUxJQVMgPSB0cnVlXG4gICAgICAgICAgICB9KVxuICAgICAgICB9XG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBvdmVycmlkZSA6IHtcbiAgICAgICAgXG4gICAgICAgIGV4dGVuZCA6IGZ1bmN0aW9uIChwcm9wcykge1xuICAgICAgICAgICAgdmFyIG15Q2xhc3MgPSB0aGlzLm15Q2xhc3NcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKCFteUNsYXNzICYmIHRoaXMuc3VwZXJDbGFzcy5tZXRhLm15Q2xhc3MpIHRoaXMuY3JlYXRlTXkocHJvcHMpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmIChwcm9wcy5teSkge1xuICAgICAgICAgICAgICAgIGlmICghbXlDbGFzcykgXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuY3JlYXRlTXkocHJvcHMpXG4gICAgICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMubmVlZFRvUmVBbGlhcyA9IHRydWVcbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIG15Q2xhc3MubWV0YS5leHRlbmQocHJvcHMubXkpXG4gICAgICAgICAgICAgICAgICAgIGRlbGV0ZSBwcm9wcy5teVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpcy5TVVBFUihwcm9wcylcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKHRoaXMubmVlZFRvUmVBbGlhcyAmJiAhKHRoaXMgaW5zdGFuY2VvZiBKb29zZS5NYW5hZ2VkLlJvbGUpKSB0aGlzLmFsaWFzU3RhdGljTWV0aG9kcygpXG4gICAgICAgIH0gIFxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgYmVmb3JlIDoge1xuICAgICAgICBcbiAgICAgICAgYWRkUm9sZSA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHZhciBteVN0ZW1cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgSm9vc2UuQS5lYWNoKGFyZ3VtZW50cywgZnVuY3Rpb24gKGFyZykge1xuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIGlmICghYXJnKSB0aHJvdyBuZXcgRXJyb3IoXCJBdHRlbXB0IHRvIGNvbnN1bWUgYW4gdW5kZWZpbmVkIFJvbGUgaW50byBbXCIgKyB0aGlzLm5hbWUgKyBcIl1cIilcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAvL2luc3RhbmNlb2YgQ2xhc3MgdG8gYWxsb3cgdHJlYXQgY2xhc3NlcyBhcyByb2xlc1xuICAgICAgICAgICAgICAgIHZhciByb2xlID0gKGFyZy5tZXRhIGluc3RhbmNlb2YgSm9vc2UuTWFuYWdlZC5DbGFzcykgPyBhcmcgOiBhcmcucm9sZVxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIGlmIChyb2xlLm1ldGEubWV0YS5oYXNBdHRyaWJ1dGUoJ215Q2xhc3MnKSAmJiByb2xlLm1ldGEubXlDbGFzcykge1xuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgaWYgKCF0aGlzLm15Q2xhc3MpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuY3JlYXRlTXkoe1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG15IDoge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBkb2VzIDogcm9sZS5tZXRhLm15Q2xhc3NcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuXG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIG15U3RlbSA9IHRoaXMubXlDbGFzcy5tZXRhLnN0ZW1cbiAgICAgICAgICAgICAgICAgICAgaWYgKCFteVN0ZW0ub3BlbmVkKSBteVN0ZW0ub3BlbigpXG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICBteVN0ZW0uYWRkQ29tcG9zZUluZm8ocm9sZS5teS5tZXRhLnN0ZW0pXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSwgdGhpcylcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKG15U3RlbSkge1xuICAgICAgICAgICAgICAgIG15U3RlbS5jbG9zZSgpXG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgdGhpcy5uZWVkVG9SZUFsaWFzID0gdHJ1ZVxuICAgICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIHJlbW92ZVJvbGUgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBpZiAoIXRoaXMubXlDbGFzcykgcmV0dXJuXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciBteVN0ZW0gPSB0aGlzLm15Q2xhc3MubWV0YS5zdGVtXG4gICAgICAgICAgICBteVN0ZW0ub3BlbigpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIEpvb3NlLkEuZWFjaChhcmd1bWVudHMsIGZ1bmN0aW9uIChyb2xlKSB7XG4gICAgICAgICAgICAgICAgaWYgKHJvbGUubWV0YS5tZXRhLmhhc0F0dHJpYnV0ZSgnbXlDbGFzcycpICYmIHJvbGUubWV0YS5teUNsYXNzKSB7XG4gICAgICAgICAgICAgICAgICAgIG15U3RlbS5yZW1vdmVDb21wb3NlSW5mbyhyb2xlLm15Lm1ldGEuc3RlbSlcbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIHRoaXMubmVlZFRvUmVBbGlhcyA9IHRydWVcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9LCB0aGlzKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBteVN0ZW0uY2xvc2UoKVxuICAgICAgICB9XG4gICAgICAgIFxuICAgIH1cbiAgICBcbn0pLmM7XG5Kb29zZS5OYW1lc3BhY2UgPSBKb29zZS5zdHViKClcblxuSm9vc2UuTmFtZXNwYWNlLkFibGUgPSBuZXcgSm9vc2UuTWFuYWdlZC5Sb2xlKCdKb29zZS5OYW1lc3BhY2UuQWJsZScsIHtcblxuICAgIGhhdmUgOiB7XG4gICAgICAgIGJvZHlGdW5jICAgICAgICAgICAgICAgIDogbnVsbFxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgYmVmb3JlIDoge1xuICAgICAgICBleHRlbmQgOiBmdW5jdGlvbiAoZXh0ZW5kKSB7XG4gICAgICAgICAgICBpZiAoZXh0ZW5kLmJvZHkpIHtcbiAgICAgICAgICAgICAgICB0aGlzLmJvZHlGdW5jID0gZXh0ZW5kLmJvZHlcbiAgICAgICAgICAgICAgICBkZWxldGUgZXh0ZW5kLmJvZHlcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgYWZ0ZXI6IHtcbiAgICAgICAgXG4gICAgICAgIGFmdGVyTXV0YXRlIDogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgdmFyIGJvZHlGdW5jID0gdGhpcy5ib2R5RnVuY1xuICAgICAgICAgICAgZGVsZXRlIHRoaXMuYm9keUZ1bmNcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKGJvZHlGdW5jKSBKb29zZS5OYW1lc3BhY2UuTWFuYWdlci5teS5leGVjdXRlSW4odGhpcy5jLCBib2R5RnVuYylcbiAgICAgICAgfVxuICAgIH1cbiAgICBcbn0pLmM7XG5Kb29zZS5NYW5hZ2VkLkJvb3RzdHJhcCA9IG5ldyBKb29zZS5NYW5hZ2VkLlJvbGUoJ0pvb3NlLk1hbmFnZWQuQm9vdHN0cmFwJywge1xuICAgIFxuICAgIGRvZXMgICA6IFsgSm9vc2UuTmFtZXNwYWNlLkFibGUsIEpvb3NlLk1hbmFnZWQuTXksIEpvb3NlLk1hbmFnZWQuQXR0cmlidXRlLkJ1aWxkZXIgXVxuICAgIFxufSkuY1xuO1xuSm9vc2UuTWV0YSA9IEpvb3NlLnN0dWIoKVxuXG5cbkpvb3NlLk1ldGEuT2JqZWN0ID0gbmV3IEpvb3NlLlByb3RvLkNsYXNzKCdKb29zZS5NZXRhLk9iamVjdCcsIHtcbiAgICBcbiAgICBpc2EgICAgICAgICAgICAgOiBKb29zZS5Qcm90by5PYmplY3RcbiAgICBcbn0pLmNcblxuXG47XG5Kb29zZS5NZXRhLkNsYXNzID0gbmV3IEpvb3NlLk1hbmFnZWQuQ2xhc3MoJ0pvb3NlLk1ldGEuQ2xhc3MnLCB7XG4gICAgXG4gICAgaXNhICAgICAgICAgICAgICAgICAgICAgICAgIDogSm9vc2UuTWFuYWdlZC5DbGFzcyxcbiAgICBcbiAgICBkb2VzICAgICAgICAgICAgICAgICAgICAgICAgOiBKb29zZS5NYW5hZ2VkLkJvb3RzdHJhcCxcbiAgICBcbiAgICBoYXZlIDoge1xuICAgICAgICBkZWZhdWx0U3VwZXJDbGFzcyAgICAgICA6IEpvb3NlLk1ldGEuT2JqZWN0XG4gICAgfVxuICAgIFxufSkuY1xuXG47XG5Kb29zZS5NZXRhLlJvbGUgPSBuZXcgSm9vc2UuTWV0YS5DbGFzcygnSm9vc2UuTWV0YS5Sb2xlJywge1xuICAgIFxuICAgIGlzYSAgICAgICAgICAgICAgICAgICAgICAgICA6IEpvb3NlLk1hbmFnZWQuUm9sZSxcbiAgICBcbiAgICBkb2VzICAgICAgICAgICAgICAgICAgICAgICAgOiBKb29zZS5NYW5hZ2VkLkJvb3RzdHJhcFxuICAgIFxufSkuYztcbkpvb3NlLk5hbWVzcGFjZS5LZWVwZXIgPSBuZXcgSm9vc2UuTWV0YS5DbGFzcygnSm9vc2UuTmFtZXNwYWNlLktlZXBlcicsIHtcbiAgICBcbiAgICBpc2EgICAgICAgICA6IEpvb3NlLk1ldGEuQ2xhc3MsXG4gICAgXG4gICAgaGF2ZSAgICAgICAgOiB7XG4gICAgICAgIGV4dGVybmFsQ29uc3RydWN0b3IgICAgICAgICAgICAgOiBudWxsXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBtZXRob2RzOiB7XG4gICAgICAgIFxuICAgICAgICBkZWZhdWx0Q29uc3RydWN0b3I6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcmV0dXJuIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgICAvL2NvbnN0cnVjdG9ycyBzaG91bGQgYXNzdW1lIHRoYXQgbWV0YSBpcyBhdHRhY2hlZCB0byAnYXJndW1lbnRzLmNhbGxlZScgKG5vdCB0byAndGhpcycpIFxuICAgICAgICAgICAgICAgIHZhciB0aGlzTWV0YSA9IGFyZ3VtZW50cy5jYWxsZWUubWV0YVxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIGlmICh0aGlzTWV0YSBpbnN0YW5jZW9mIEpvb3NlLk5hbWVzcGFjZS5LZWVwZXIpIHRocm93IG5ldyBFcnJvcihcIk1vZHVsZSBbXCIgKyB0aGlzTWV0YS5jICsgXCJdIG1heSBub3QgYmUgaW5zdGFudGlhdGVkLiBGb3Jnb3QgdG8gJ3VzZScgdGhlIGNsYXNzIHdpdGggdGhlIHNhbWUgbmFtZT9cIilcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICB2YXIgZXh0ZXJuYWxDb25zdHJ1Y3RvciA9IHRoaXNNZXRhLmV4dGVybmFsQ29uc3RydWN0b3JcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBpZiAodHlwZW9mIGV4dGVybmFsQ29uc3RydWN0b3IgPT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgZXh0ZXJuYWxDb25zdHJ1Y3Rvci5tZXRhID0gdGhpc01ldGFcbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBleHRlcm5hbENvbnN0cnVjdG9yLmFwcGx5KHRoaXMsIGFyZ3VtZW50cylcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgdGhyb3cgXCJOYW1lc3BhY2VLZWVwZXIgb2YgW1wiICsgdGhpc01ldGEubmFtZSArIFwiXSB3YXMgcGxhbnRlZCBpbmNvcnJlY3RseS5cIlxuICAgICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIC8vd2l0aENsYXNzIHNob3VsZCBiZSBub3QgY29uc3RydWN0ZWQgeWV0IG9uIHRoaXMgc3RhZ2UgKHNlZSBKb29zZS5Qcm90by5DbGFzcy5jb25zdHJ1Y3QpXG4gICAgICAgIC8vaXQgc2hvdWxkIGJlIG9uIHRoZSAnY29uc3RydWN0b3JPbmx5JyBsaWZlIHN0YWdlIChzaG91bGQgYWxyZWFkeSBoYXZlIGNvbnN0cnVjdG9yKVxuICAgICAgICBwbGFudDogZnVuY3Rpb24gKHdpdGhDbGFzcykge1xuICAgICAgICAgICAgdmFyIGtlZXBlciA9IHRoaXMuY1xuICAgICAgICAgICAgXG4gICAgICAgICAgICBrZWVwZXIubWV0YSA9IHdpdGhDbGFzcy5tZXRhXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGtlZXBlci5tZXRhLmMgPSBrZWVwZXJcbiAgICAgICAgICAgIGtlZXBlci5tZXRhLmV4dGVybmFsQ29uc3RydWN0b3IgPSB3aXRoQ2xhc3NcbiAgICAgICAgfVxuICAgIH1cbiAgICBcbn0pLmNcblxuXG47XG5Kb29zZS5OYW1lc3BhY2UuTWFuYWdlciA9IG5ldyBKb29zZS5NYW5hZ2VkLkNsYXNzKCdKb29zZS5OYW1lc3BhY2UuTWFuYWdlcicsIHtcbiAgICBcbiAgICBoYXZlIDoge1xuICAgICAgICBjdXJyZW50ICAgICA6IG51bGxcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIG1ldGhvZHMgOiB7XG4gICAgICAgIFxuICAgICAgICBpbml0aWFsaXplIDogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgdGhpcy5jdXJyZW50ICAgID0gWyBKb29zZS50b3AgXVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIGdldEN1cnJlbnQ6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLmN1cnJlbnRbMF1cbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBleGVjdXRlSW4gOiBmdW5jdGlvbiAobnMsIGZ1bmMpIHtcbiAgICAgICAgICAgIHZhciBjdXJyZW50ID0gdGhpcy5jdXJyZW50XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGN1cnJlbnQudW5zaGlmdChucylcbiAgICAgICAgICAgIHZhciByZXMgPSBmdW5jLmNhbGwobnMsIG5zKVxuICAgICAgICAgICAgY3VycmVudC5zaGlmdCgpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHJldHVybiByZXNcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBlYXJseUNyZWF0ZSA6IGZ1bmN0aW9uIChuYW1lLCBtZXRhQ2xhc3MsIHByb3BzKSB7XG4gICAgICAgICAgICBwcm9wcy5jb25zdHJ1Y3Rvck9ubHkgPSB0cnVlXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHJldHVybiBuZXcgbWV0YUNsYXNzKG5hbWUsIHByb3BzKS5jXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgLy90aGlzIGZ1bmN0aW9uIGVzdGFibGlzaGluZyB0aGUgZnVsbCBcIm5hbWVzcGFjZSBjaGFpblwiIChpbmNsdWRpbmcgdGhlIGxhc3QgZWxlbWVudClcbiAgICAgICAgY3JlYXRlIDogZnVuY3Rpb24gKG5zTmFtZSwgbWV0YUNsYXNzLCBleHRlbmQpIHtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy9pZiBubyBuYW1lIHByb3ZpZGVkLCB0aGVuIHdlIGNyZWF0aW5nIGFuIGFub255bW91cyBjbGFzcywgc28ganVzdCBza2lwIGFsbCB0aGUgbmFtZXNwYWNlIG1hbmlwdWxhdGlvbnNcbiAgICAgICAgICAgIGlmICghbnNOYW1lKSByZXR1cm4gbmV3IG1ldGFDbGFzcyhuc05hbWUsIGV4dGVuZCkuY1xuICAgICAgICAgICAgXG4gICAgICAgICAgICB2YXIgbWUgPSB0aGlzXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmICgvXlxcLi8udGVzdChuc05hbWUpKSByZXR1cm4gdGhpcy5leGVjdXRlSW4oSm9vc2UudG9wLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIG1lLmNyZWF0ZShuc05hbWUucmVwbGFjZSgvXlxcLi8sICcnKSwgbWV0YUNsYXNzLCBleHRlbmQpXG4gICAgICAgICAgICB9KVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB2YXIgcHJvcHMgICA9IGV4dGVuZCB8fCB7fVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB2YXIgcGFydHMgICA9IEpvb3NlLlMuc2FuZVNwbGl0KG5zTmFtZSwgJy4nKVxuICAgICAgICAgICAgdmFyIG9iamVjdCAgPSB0aGlzLmdldEN1cnJlbnQoKVxuICAgICAgICAgICAgdmFyIHNvRmFyICAgPSBvYmplY3QgPT0gSm9vc2UudG9wID8gW10gOiBKb29zZS5TLnNhbmVTcGxpdChvYmplY3QubWV0YS5uYW1lLCAnLicpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgcGFydHMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgICAgICB2YXIgcGFydCAgICAgICAgPSBwYXJ0c1tpXVxuICAgICAgICAgICAgICAgIHZhciBpc0xhc3QgICAgICA9IGkgPT0gcGFydHMubGVuZ3RoIC0gMVxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIGlmIChwYXJ0ID09IFwibWV0YVwiIHx8IHBhcnQgPT0gXCJteVwiIHx8ICFwYXJ0KSB0aHJvdyBcIk1vZHVsZSBuYW1lIFtcIiArIG5zTmFtZSArIFwiXSBtYXkgbm90IGluY2x1ZGUgYSBwYXJ0IGNhbGxlZCAnbWV0YScgb3IgJ215JyBvciBlbXB0eSBwYXJ0LlwiXG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgdmFyIGN1ciA9ICAgb2JqZWN0W3BhcnRdXG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgc29GYXIucHVzaChwYXJ0KVxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIHZhciBzb0Zhck5hbWUgICAgICAgPSBzb0Zhci5qb2luKFwiLlwiKVxuICAgICAgICAgICAgICAgIHZhciBuZWVkRmluYWxpemUgICAgPSBmYWxzZVxuICAgICAgICAgICAgICAgIHZhciBuc0tlZXBlclxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIC8vIGlmIHRoZSBuYW1lc3BhY2Ugc2VnbWVudCBpcyBlbXB0eVxuICAgICAgICAgICAgICAgIGlmICh0eXBlb2YgY3VyID09IFwidW5kZWZpbmVkXCIpIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGlzTGFzdCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgLy8gcGVyZm9ybSBcImVhcmx5IGNyZWF0ZVwiIHdoaWNoIGp1c3QgZmlsbHMgdGhlIG5hbWVzcGFjZSBzZWdtZW50IHdpdGggcmlnaHQgY29uc3RydWN0b3JcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIHRoaXMgYWxsb3dzIHVzIHRvIGhhdmUgYSByaWdodCBjb25zdHJ1Y3RvciBpbiB0aGUgbmFtZXNwYWNlIHNlZ21lbnQgd2hlbiB0aGUgYGJvZHlgIHdpbGwgYmUgY2FsbGVkXG4gICAgICAgICAgICAgICAgICAgICAgICBuc0tlZXBlciAgICAgICAgPSB0aGlzLmVhcmx5Q3JlYXRlKHNvRmFyTmFtZSwgbWV0YUNsYXNzLCBwcm9wcylcbiAgICAgICAgICAgICAgICAgICAgICAgIG5lZWRGaW5hbGl6ZSAgICA9IHRydWVcbiAgICAgICAgICAgICAgICAgICAgfSBlbHNlXG4gICAgICAgICAgICAgICAgICAgICAgICBuc0tlZXBlciAgICAgICAgPSBuZXcgSm9vc2UuTmFtZXNwYWNlLktlZXBlcihzb0Zhck5hbWUpLmNcbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIG9iamVjdFtwYXJ0XSA9IG5zS2VlcGVyXG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICBjdXIgPSBuc0tlZXBlclxuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKGlzTGFzdCAmJiBjdXIgJiYgY3VyLm1ldGEpIHtcbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIHZhciBjdXJyZW50TWV0YSA9IGN1ci5tZXRhXG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICBpZiAobWV0YUNsYXNzID09IEpvb3NlLk5hbWVzcGFjZS5LZWVwZXIpXG4gICAgICAgICAgICAgICAgICAgICAgICAvL2BNb2R1bGVgIG92ZXIgc29tZXRoaW5nIGNhc2UgLSBleHRlbmQgdGhlIG9yaWdpbmFsXG4gICAgICAgICAgICAgICAgICAgICAgICBjdXJyZW50TWV0YS5leHRlbmQocHJvcHMpXG4gICAgICAgICAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoY3VycmVudE1ldGEgaW5zdGFuY2VvZiBKb29zZS5OYW1lc3BhY2UuS2VlcGVyKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY3VycmVudE1ldGEucGxhbnQodGhpcy5lYXJseUNyZWF0ZShzb0Zhck5hbWUsIG1ldGFDbGFzcywgcHJvcHMpKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG5lZWRGaW5hbGl6ZSA9IHRydWVcbiAgICAgICAgICAgICAgICAgICAgICAgIH0gZWxzZVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcIkRvdWJsZSBkZWNsYXJhdGlvbiBvZiBbXCIgKyBzb0Zhck5hbWUgKyBcIl1cIilcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICB9IGVsc2UgXG4gICAgICAgICAgICAgICAgICAgIGlmIChpc0xhc3QgJiYgIShjdXIgJiYgY3VyLm1ldGEgJiYgY3VyLm1ldGEubWV0YSkpIHRocm93IFwiVHJ5aW5nIHRvIHNldHVwIG1vZHVsZSBcIiArIHNvRmFyTmFtZSArIFwiIGZhaWxlZC4gVGhlcmUgaXMgYWxyZWFkeSBzb21ldGhpbmc6IFwiICsgY3VyXG5cbiAgICAgICAgICAgICAgICAvLyBob29rIHRvIGFsbG93IGVtYmVkZCByZXNvdXJjZSBpbnRvIG1ldGFcbiAgICAgICAgICAgICAgICBpZiAoaXNMYXN0KSB0aGlzLnByZXBhcmVNZXRhKGN1ci5tZXRhKVxuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBpZiAobmVlZEZpbmFsaXplKSBjdXIubWV0YS5jb25zdHJ1Y3QocHJvcHMpXG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIG9iamVjdCA9IGN1clxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgXG4gICAgICAgICAgICByZXR1cm4gb2JqZWN0XG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgcHJlcGFyZU1ldGEgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgcHJlcGFyZVByb3BlcnRpZXMgOiBmdW5jdGlvbiAobmFtZSwgcHJvcHMsIGRlZmF1bHRNZXRhLCBjYWxsYmFjaykge1xuICAgICAgICAgICAgaWYgKG5hbWUgJiYgdHlwZW9mIG5hbWUgIT0gJ3N0cmluZycpIHtcbiAgICAgICAgICAgICAgICBwcm9wcyAgID0gbmFtZVxuICAgICAgICAgICAgICAgIG5hbWUgICAgPSBudWxsXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciBtZXRhXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmIChwcm9wcyAmJiBwcm9wcy5tZXRhKSB7XG4gICAgICAgICAgICAgICAgbWV0YSA9IHByb3BzLm1ldGFcbiAgICAgICAgICAgICAgICBkZWxldGUgcHJvcHMubWV0YVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAoIW1ldGEpXG4gICAgICAgICAgICAgICAgaWYgKHByb3BzICYmIHR5cGVvZiBwcm9wcy5pc2EgPT0gJ2Z1bmN0aW9uJyAmJiBwcm9wcy5pc2EubWV0YSlcbiAgICAgICAgICAgICAgICAgICAgbWV0YSA9IHByb3BzLmlzYS5tZXRhLmNvbnN0cnVjdG9yXG4gICAgICAgICAgICAgICAgZWxzZVxuICAgICAgICAgICAgICAgICAgICBtZXRhID0gZGVmYXVsdE1ldGFcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcmV0dXJuIGNhbGxiYWNrLmNhbGwodGhpcywgbmFtZSwgbWV0YSwgcHJvcHMpXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgZ2V0RGVmYXVsdEhlbHBlckZvciA6IGZ1bmN0aW9uIChtZXRhQ2xhc3MpIHtcbiAgICAgICAgICAgIHZhciBtZSA9IHRoaXNcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcmV0dXJuIGZ1bmN0aW9uIChuYW1lLCBwcm9wcykge1xuICAgICAgICAgICAgICAgIHJldHVybiBtZS5wcmVwYXJlUHJvcGVydGllcyhuYW1lLCBwcm9wcywgbWV0YUNsYXNzLCBmdW5jdGlvbiAobmFtZSwgbWV0YSwgcHJvcHMpIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIG1lLmNyZWF0ZShuYW1lLCBtZXRhLCBwcm9wcylcbiAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIHJlZ2lzdGVyIDogZnVuY3Rpb24gKGhlbHBlck5hbWUsIG1ldGFDbGFzcywgZnVuYykge1xuICAgICAgICAgICAgdmFyIG1lID0gdGhpc1xuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAodGhpcy5tZXRhLmhhc01ldGhvZChoZWxwZXJOYW1lKSkge1xuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIHZhciBoZWxwZXIgPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBtZVsgaGVscGVyTmFtZSBdLmFwcGx5KG1lLCBhcmd1bWVudHMpXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIGlmICghSm9vc2UudG9wWyBoZWxwZXJOYW1lIF0pICAgSm9vc2UudG9wWyBoZWxwZXJOYW1lIF0gICAgICAgICA9IGhlbHBlclxuICAgICAgICAgICAgICAgIGlmICghSm9vc2VbIGhlbHBlck5hbWUgXSkgICAgICAgSm9vc2VbIGhlbHBlck5hbWUgXSAgICAgICAgICAgICA9IGhlbHBlclxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIGlmIChKb29zZS5pc19Ob2RlSlMgJiYgdHlwZW9mIGV4cG9ydHMgIT0gJ3VuZGVmaW5lZCcpICAgICAgICAgICAgZXhwb3J0c1sgaGVscGVyTmFtZSBdICAgID0gaGVscGVyXG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHZhciBtZXRob2RzID0ge31cbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBtZXRob2RzWyBoZWxwZXJOYW1lIF0gPSBmdW5jIHx8IHRoaXMuZ2V0RGVmYXVsdEhlbHBlckZvcihtZXRhQ2xhc3MpXG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgdGhpcy5tZXRhLmV4dGVuZCh7XG4gICAgICAgICAgICAgICAgICAgIG1ldGhvZHMgOiBtZXRob2RzXG4gICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICB0aGlzLnJlZ2lzdGVyKGhlbHBlck5hbWUpXG4gICAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgTW9kdWxlIDogZnVuY3Rpb24gKG5hbWUsIHByb3BzKSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5wcmVwYXJlUHJvcGVydGllcyhuYW1lLCBwcm9wcywgSm9vc2UuTmFtZXNwYWNlLktlZXBlciwgZnVuY3Rpb24gKG5hbWUsIG1ldGEsIHByb3BzKSB7XG4gICAgICAgICAgICAgICAgaWYgKHR5cGVvZiBwcm9wcyA9PSAnZnVuY3Rpb24nKSBwcm9wcyA9IHsgYm9keSA6IHByb3BzIH0gICAgXG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuY3JlYXRlKG5hbWUsIG1ldGEsIHByb3BzKVxuICAgICAgICAgICAgfSlcbiAgICAgICAgfVxuICAgIH1cbiAgICBcbn0pLmNcblxuSm9vc2UuTmFtZXNwYWNlLk1hbmFnZXIubXkgPSBuZXcgSm9vc2UuTmFtZXNwYWNlLk1hbmFnZXIoKVxuXG5Kb29zZS5OYW1lc3BhY2UuTWFuYWdlci5teS5yZWdpc3RlcignQ2xhc3MnLCBKb29zZS5NZXRhLkNsYXNzKVxuSm9vc2UuTmFtZXNwYWNlLk1hbmFnZXIubXkucmVnaXN0ZXIoJ1JvbGUnLCBKb29zZS5NZXRhLlJvbGUpXG5Kb29zZS5OYW1lc3BhY2UuTWFuYWdlci5teS5yZWdpc3RlcignTW9kdWxlJylcblxuXG4vLyBmb3IgdGhlIHJlc3Qgb2YgdGhlIHBhY2thZ2VcbnZhciBDbGFzcyAgICAgICA9IEpvb3NlLkNsYXNzXG52YXIgUm9sZSAgICAgICAgPSBKb29zZS5Sb2xlXG47XG5Sb2xlKCdKb29zZS5BdHRyaWJ1dGUuRGVsZWdhdGUnLCB7XG4gICAgXG4gICAgaGF2ZSA6IHtcbiAgICAgICAgaGFuZGxlcyA6IG51bGxcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIG92ZXJyaWRlIDoge1xuICAgICAgICBcbiAgICAgICAgZWFjaERlbGVnYXRlIDogZnVuY3Rpb24gKGhhbmRsZXMsIGZ1bmMsIHNjb3BlKSB7XG4gICAgICAgICAgICBpZiAodHlwZW9mIGhhbmRsZXMgPT0gJ3N0cmluZycpIHJldHVybiBmdW5jLmNhbGwoc2NvcGUsIGhhbmRsZXMsIGhhbmRsZXMpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmIChoYW5kbGVzIGluc3RhbmNlb2YgQXJyYXkpXG4gICAgICAgICAgICAgICAgcmV0dXJuIEpvb3NlLkEuZWFjaChoYW5kbGVzLCBmdW5jdGlvbiAoZGVsZWdhdGVUbykge1xuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgZnVuYy5jYWxsKHNjb3BlLCBkZWxlZ2F0ZVRvLCBkZWxlZ2F0ZVRvKVxuICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAoaGFuZGxlcyA9PT0gT2JqZWN0KGhhbmRsZXMpKVxuICAgICAgICAgICAgICAgIEpvb3NlLk8uZWFjaE93bihoYW5kbGVzLCBmdW5jdGlvbiAoZGVsZWdhdGVUbywgaGFuZGxlQXMpIHtcbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIGZ1bmMuY2FsbChzY29wZSwgaGFuZGxlQXMsIGRlbGVnYXRlVG8pXG4gICAgICAgICAgICAgICAgfSlcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBnZXRBY2Nlc3NvcnNGb3IgOiBmdW5jdGlvbiAodGFyZ2V0Q2xhc3MpIHtcbiAgICAgICAgICAgIHZhciB0YXJnZXRNZXRhICA9IHRhcmdldENsYXNzLm1ldGFcbiAgICAgICAgICAgIHZhciBtZXRob2RzICAgICA9IHRoaXMuU1VQRVIodGFyZ2V0Q2xhc3MpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciBtZSAgICAgID0gdGhpc1xuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLmVhY2hEZWxlZ2F0ZSh0aGlzLmhhbmRsZXMsIGZ1bmN0aW9uIChoYW5kbGVBcywgZGVsZWdhdGVUbykge1xuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIGlmICghdGFyZ2V0TWV0YS5oYXNNZXRob2QoaGFuZGxlQXMpKSB7XG4gICAgICAgICAgICAgICAgICAgIHZhciBoYW5kbGVyID0gbWV0aG9kc1sgaGFuZGxlQXMgXSA9IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHZhciBhdHRyVmFsdWUgPSBtZS5nZXRWYWx1ZUZyb20odGhpcylcbiAgICAgICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGF0dHJWYWx1ZVsgZGVsZWdhdGVUbyBdLmFwcGx5KGF0dHJWYWx1ZSwgYXJndW1lbnRzKVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICBoYW5kbGVyLkFDQ0VTU09SX0ZST00gPSBtZVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHJldHVybiBtZXRob2RzXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgZ2V0QWNjZXNzb3JzRnJvbSA6IGZ1bmN0aW9uIChmcm9tKSB7XG4gICAgICAgICAgICB2YXIgbWV0aG9kcyA9IHRoaXMuU1VQRVIoZnJvbSlcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdmFyIG1lICAgICAgICAgID0gdGhpc1xuICAgICAgICAgICAgdmFyIHRhcmdldE1ldGEgID0gZnJvbS5tZXRhXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXMuZWFjaERlbGVnYXRlKHRoaXMuaGFuZGxlcywgZnVuY3Rpb24gKGhhbmRsZUFzKSB7XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgdmFyIGhhbmRsZXIgPSB0YXJnZXRNZXRhLmdldE1ldGhvZChoYW5kbGVBcylcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBpZiAoaGFuZGxlciAmJiBoYW5kbGVyLnZhbHVlLkFDQ0VTU09SX0ZST00gPT0gbWUpIG1ldGhvZHMucHVzaChoYW5kbGVBcylcbiAgICAgICAgICAgIH0pXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHJldHVybiBtZXRob2RzXG4gICAgICAgIH1cbiAgICB9XG59KVxuXG47XG5Sb2xlKCdKb29zZS5BdHRyaWJ1dGUuVHJpZ2dlcicsIHtcbiAgICBcbiAgICBoYXZlIDoge1xuICAgICAgICB0cmlnZ2VyICAgICAgICA6IG51bGxcbiAgICB9LCBcblxuICAgIFxuICAgIGFmdGVyIDoge1xuICAgICAgICBpbml0aWFsaXplIDogZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICBpZiAodGhpcy50cmlnZ2VyKSB7XG4gICAgICAgICAgICAgICAgaWYgKCF0aGlzLndyaXRlYWJsZSkgdGhyb3cgbmV3IEVycm9yKFwiQ2FuJ3QgdXNlIGB0cmlnZ2VyYCBmb3IgcmVhZC1vbmx5IGF0dHJpYnV0ZXNcIilcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICB0aGlzLmhhc1NldHRlciA9IHRydWVcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgb3ZlcnJpZGUgOiB7XG4gICAgICAgIFxuICAgICAgICBnZXRTZXR0ZXIgOiBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgIHZhciBvcmlnaW5hbCAgICA9IHRoaXMuU1VQRVIoKVxuICAgICAgICAgICAgdmFyIHRyaWdnZXIgICAgID0gdGhpcy50cmlnZ2VyXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmICghdHJpZ2dlcikgcmV0dXJuIG9yaWdpbmFsXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciBtZSAgICAgID0gdGhpc1xuICAgICAgICAgICAgdmFyIGluaXQgICAgPSBKb29zZS5PLmlzRnVuY3Rpb24obWUuaW5pdCkgPyBudWxsIDogbWUuaW5pdFxuICAgICAgICAgICAgXG4gICAgICAgICAgICByZXR1cm4gZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgIHZhciBvbGRWYWx1ZSAgICA9IG1lLmhhc1ZhbHVlKHRoaXMpID8gbWUuZ2V0VmFsdWVGcm9tKHRoaXMpIDogaW5pdFxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIHZhciByZXMgICAgICAgICA9IG9yaWdpbmFsLmFwcGx5KHRoaXMsIGFyZ3VtZW50cylcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICB0cmlnZ2VyLmNhbGwodGhpcywgbWUuZ2V0VmFsdWVGcm9tKHRoaXMpLCBvbGRWYWx1ZSlcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICByZXR1cm4gcmVzXG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG59KSAgICBcblxuO1xuUm9sZSgnSm9vc2UuQXR0cmlidXRlLkxhenknLCB7XG4gICAgXG4gICAgXG4gICAgaGF2ZSA6IHtcbiAgICAgICAgbGF6eSAgICAgICAgOiBudWxsXG4gICAgfSwgXG4gICAgXG4gICAgXG4gICAgYmVmb3JlIDoge1xuICAgICAgICBjb21wdXRlVmFsdWUgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBpZiAodHlwZW9mIHRoaXMuaW5pdCA9PSAnZnVuY3Rpb24nICYmIHRoaXMubGF6eSkge1xuICAgICAgICAgICAgICAgIHRoaXMubGF6eSA9IHRoaXMuaW5pdCAgICBcbiAgICAgICAgICAgICAgICBkZWxldGUgdGhpcy5pbml0ICAgIFxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBhZnRlciA6IHtcbiAgICAgICAgaW5pdGlhbGl6ZSA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIGlmICh0aGlzLmxhenkpIHRoaXMucmVhZGFibGUgPSB0aGlzLmhhc0dldHRlciA9IHRydWVcbiAgICAgICAgfVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgb3ZlcnJpZGUgOiB7XG4gICAgICAgIFxuICAgICAgICBnZXRHZXR0ZXIgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB2YXIgb3JpZ2luYWwgICAgPSB0aGlzLlNVUEVSKClcbiAgICAgICAgICAgIHZhciBsYXp5ICAgICAgICA9IHRoaXMubGF6eVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAoIWxhenkpIHJldHVybiBvcmlnaW5hbFxuICAgICAgICAgICAgXG4gICAgICAgICAgICB2YXIgbWUgICAgICA9IHRoaXMgICAgXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHJldHVybiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgICAgaWYgKCFtZS5oYXNWYWx1ZSh0aGlzKSkge1xuICAgICAgICAgICAgICAgICAgICB2YXIgaW5pdGlhbGl6ZXIgPSB0eXBlb2YgbGF6eSA9PSAnZnVuY3Rpb24nID8gbGF6eSA6IHRoaXNbIGxhenkucmVwbGFjZSgvXnRoaXNcXC4vLCAnJykgXVxuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgbWUuc2V0VmFsdWVUbyh0aGlzLCBpbml0aWFsaXplci5hcHBseSh0aGlzLCBhcmd1bWVudHMpKVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICByZXR1cm4gb3JpZ2luYWwuY2FsbCh0aGlzKSAgICBcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cbn0pXG5cbjtcblJvbGUoJ0pvb3NlLkF0dHJpYnV0ZS5BY2Nlc3Nvci5Db21iaW5lZCcsIHtcbiAgICBcbiAgICBcbiAgICBoYXZlIDoge1xuICAgICAgICBpc0NvbWJpbmVkICAgICAgICA6IGZhbHNlXG4gICAgfSwgXG4gICAgXG4gICAgXG4gICAgYWZ0ZXIgOiB7XG4gICAgICAgIGluaXRpYWxpemUgOiBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgIHRoaXMuaXNDb21iaW5lZCA9IHRoaXMuaXNDb21iaW5lZCB8fCAvLi5jL2kudGVzdCh0aGlzLmlzKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAodGhpcy5pc0NvbWJpbmVkKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5zbG90ID0gJyQkJyArIHRoaXMubmFtZVxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIHRoaXMuaGFzR2V0dGVyID0gdHJ1ZVxuICAgICAgICAgICAgICAgIHRoaXMuaGFzU2V0dGVyID0gZmFsc2VcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICB0aGlzLnNldHRlck5hbWUgPSB0aGlzLmdldHRlck5hbWUgPSB0aGlzLnB1YmxpY05hbWVcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgb3ZlcnJpZGUgOiB7XG4gICAgICAgIFxuICAgICAgICBnZXRHZXR0ZXIgOiBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgIHZhciBnZXR0ZXIgICAgPSB0aGlzLlNVUEVSKClcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKCF0aGlzLmlzQ29tYmluZWQpIHJldHVybiBnZXR0ZXJcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdmFyIHNldHRlciAgICA9IHRoaXMuZ2V0U2V0dGVyKClcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdmFyIG1lID0gdGhpc1xuICAgICAgICAgICAgXG4gICAgICAgICAgICByZXR1cm4gZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIGlmICghYXJndW1lbnRzLmxlbmd0aCkge1xuICAgICAgICAgICAgICAgICAgICBpZiAobWUucmVhZGFibGUpIHJldHVybiBnZXR0ZXIuY2FsbCh0aGlzKVxuICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDYWxsIHRvIGdldHRlciBvZiB1bnJlYWRhYmxlIGF0dHJpYnV0ZTogW1wiICsgbWUubmFtZSArIFwiXVwiKVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBpZiAobWUud3JpdGVhYmxlKSByZXR1cm4gc2V0dGVyLmFwcGx5KHRoaXMsIGFyZ3VtZW50cylcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDYWxsIHRvIHNldHRlciBvZiByZWFkLW9ubHkgYXR0cmlidXRlOiBbXCIgKyBtZS5uYW1lICsgXCJdXCIpICAgIFxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuICAgIFxufSlcblxuO1xuSm9vc2UuTWFuYWdlZC5BdHRyaWJ1dGUubWV0YS5leHRlbmQoe1xuICAgIGRvZXMgOiBbIEpvb3NlLkF0dHJpYnV0ZS5EZWxlZ2F0ZSwgSm9vc2UuQXR0cmlidXRlLlRyaWdnZXIsIEpvb3NlLkF0dHJpYnV0ZS5MYXp5LCBKb29zZS5BdHRyaWJ1dGUuQWNjZXNzb3IuQ29tYmluZWQgXVxufSkgICAgICAgICAgICBcblxuO1xuUm9sZSgnSm9vc2UuTWV0YS5TaW5nbGV0b24nLCB7XG4gICAgXG4gICAgaGFzIDoge1xuICAgICAgICBmb3JjZUluc3RhbmNlICAgICAgICAgICA6IEpvb3NlLkkuT2JqZWN0LFxuICAgICAgICBpbnN0YW5jZSAgICAgICAgICAgICAgICA6IG51bGxcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIFxuICAgIG92ZXJyaWRlIDoge1xuICAgICAgICBcbiAgICAgICAgZGVmYXVsdENvbnN0cnVjdG9yIDogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgdmFyIG1ldGEgICAgICAgID0gdGhpc1xuICAgICAgICAgICAgdmFyIHByZXZpb3VzICAgID0gdGhpcy5TVVBFUigpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXMuYWRhcHRDb25zdHJ1Y3RvcihwcmV2aW91cylcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcmV0dXJuIGZ1bmN0aW9uIChmb3JjZUluc3RhbmNlLCBwYXJhbXMpIHtcbiAgICAgICAgICAgICAgICBpZiAoZm9yY2VJbnN0YW5jZSA9PSBtZXRhLmZvcmNlSW5zdGFuY2UpIHJldHVybiBwcmV2aW91cy5hcHBseSh0aGlzLCBwYXJhbXMpIHx8IHRoaXNcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICB2YXIgaW5zdGFuY2UgPSBtZXRhLmluc3RhbmNlXG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgaWYgKGluc3RhbmNlKSB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChtZXRhLmhhc01ldGhvZCgnY29uZmlndXJlJykpIGluc3RhbmNlLmNvbmZpZ3VyZS5hcHBseShpbnN0YW5jZSwgYXJndW1lbnRzKVxuICAgICAgICAgICAgICAgIH0gZWxzZVxuICAgICAgICAgICAgICAgICAgICBtZXRhLmluc3RhbmNlID0gbmV3IG1ldGEuYyhtZXRhLmZvcmNlSW5zdGFuY2UsIGFyZ3VtZW50cylcbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgcmV0dXJuIG1ldGEuaW5zdGFuY2VcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSAgICAgICAgXG4gICAgfVxuICAgIFxuXG59KVxuXG5cbkpvb3NlLk5hbWVzcGFjZS5NYW5hZ2VyLm15LnJlZ2lzdGVyKCdTaW5nbGV0b24nLCBDbGFzcyh7XG4gICAgaXNhICAgICA6IEpvb3NlLk1ldGEuQ2xhc3MsXG4gICAgbWV0YSAgICA6IEpvb3NlLk1ldGEuQ2xhc3MsXG4gICAgXG4gICAgZG9lcyAgICA6IEpvb3NlLk1ldGEuU2luZ2xldG9uXG59KSlcbjtcbjtcbn0oKTs7XG4iLCIvKlxuIChjKSAyMDEzLCBWbGFkaW1pciBBZ2Fmb25raW5cbiBSQnVzaCwgYSBKYXZhU2NyaXB0IGxpYnJhcnkgZm9yIGhpZ2gtcGVyZm9ybWFuY2UgMkQgc3BhdGlhbCBpbmRleGluZyBvZiBwb2ludHMgYW5kIHJlY3RhbmdsZXMuXG4gaHR0cHM6Ly9naXRodWIuY29tL21vdXJuZXIvcmJ1c2hcbiovXG5cbihmdW5jdGlvbiAoKSB7ICd1c2Ugc3RyaWN0JztcblxuZnVuY3Rpb24gcmJ1c2gobWF4RW50cmllcywgZm9ybWF0KSB7XG5cbiAgICAvLyBqc2hpbnQgbmV3Y2FwOiBmYWxzZSwgdmFsaWR0aGlzOiB0cnVlXG4gICAgaWYgKCEodGhpcyBpbnN0YW5jZW9mIHJidXNoKSkgcmV0dXJuIG5ldyByYnVzaChtYXhFbnRyaWVzLCBmb3JtYXQpO1xuXG4gICAgLy8gbWF4IGVudHJpZXMgaW4gYSBub2RlIGlzIDkgYnkgZGVmYXVsdDsgbWluIG5vZGUgZmlsbCBpcyA0MCUgZm9yIGJlc3QgcGVyZm9ybWFuY2VcbiAgICB0aGlzLl9tYXhFbnRyaWVzID0gTWF0aC5tYXgoNCwgbWF4RW50cmllcyB8fCA5KTtcbiAgICB0aGlzLl9taW5FbnRyaWVzID0gTWF0aC5tYXgoMiwgTWF0aC5jZWlsKHRoaXMuX21heEVudHJpZXMgKiAwLjQpKTtcblxuICAgIGlmIChmb3JtYXQpIHtcbiAgICAgICAgdGhpcy5faW5pdEZvcm1hdChmb3JtYXQpO1xuICAgIH1cblxuICAgIHRoaXMuY2xlYXIoKTtcbn1cblxucmJ1c2gucHJvdG90eXBlID0ge1xuXG4gICAgYWxsOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHJldHVybiB0aGlzLl9hbGwodGhpcy5kYXRhLCBbXSk7XG4gICAgfSxcblxuICAgIHNlYXJjaDogZnVuY3Rpb24gKGJib3gpIHtcblxuICAgICAgICB2YXIgbm9kZSA9IHRoaXMuZGF0YSxcbiAgICAgICAgICAgIHJlc3VsdCA9IFtdLFxuICAgICAgICAgICAgdG9CQm94ID0gdGhpcy50b0JCb3g7XG5cbiAgICAgICAgaWYgKCFpbnRlcnNlY3RzKGJib3gsIG5vZGUuYmJveCkpIHJldHVybiByZXN1bHQ7XG5cbiAgICAgICAgdmFyIG5vZGVzVG9TZWFyY2ggPSBbXSxcbiAgICAgICAgICAgIGksIGxlbiwgY2hpbGQsIGNoaWxkQkJveDtcblxuICAgICAgICB3aGlsZSAobm9kZSkge1xuICAgICAgICAgICAgZm9yIChpID0gMCwgbGVuID0gbm9kZS5jaGlsZHJlbi5sZW5ndGg7IGkgPCBsZW47IGkrKykge1xuXG4gICAgICAgICAgICAgICAgY2hpbGQgPSBub2RlLmNoaWxkcmVuW2ldO1xuICAgICAgICAgICAgICAgIGNoaWxkQkJveCA9IG5vZGUubGVhZiA/IHRvQkJveChjaGlsZCkgOiBjaGlsZC5iYm94O1xuXG4gICAgICAgICAgICAgICAgaWYgKGludGVyc2VjdHMoYmJveCwgY2hpbGRCQm94KSkge1xuICAgICAgICAgICAgICAgICAgICBpZiAobm9kZS5sZWFmKSByZXN1bHQucHVzaChjaGlsZCk7XG4gICAgICAgICAgICAgICAgICAgIGVsc2UgaWYgKGNvbnRhaW5zKGJib3gsIGNoaWxkQkJveCkpIHRoaXMuX2FsbChjaGlsZCwgcmVzdWx0KTtcbiAgICAgICAgICAgICAgICAgICAgZWxzZSBub2Rlc1RvU2VhcmNoLnB1c2goY2hpbGQpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIG5vZGUgPSBub2Rlc1RvU2VhcmNoLnBvcCgpO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICB9LFxuXG4gICAgY29sbGlkZXM6IGZ1bmN0aW9uIChiYm94KSB7XG5cbiAgICAgICAgdmFyIG5vZGUgPSB0aGlzLmRhdGEsXG4gICAgICAgICAgICB0b0JCb3ggPSB0aGlzLnRvQkJveDtcblxuICAgICAgICBpZiAoIWludGVyc2VjdHMoYmJveCwgbm9kZS5iYm94KSkgcmV0dXJuIGZhbHNlO1xuXG4gICAgICAgIHZhciBub2Rlc1RvU2VhcmNoID0gW10sXG4gICAgICAgICAgICBpLCBsZW4sIGNoaWxkLCBjaGlsZEJCb3g7XG5cbiAgICAgICAgd2hpbGUgKG5vZGUpIHtcbiAgICAgICAgICAgIGZvciAoaSA9IDAsIGxlbiA9IG5vZGUuY2hpbGRyZW4ubGVuZ3RoOyBpIDwgbGVuOyBpKyspIHtcblxuICAgICAgICAgICAgICAgIGNoaWxkID0gbm9kZS5jaGlsZHJlbltpXTtcbiAgICAgICAgICAgICAgICBjaGlsZEJCb3ggPSBub2RlLmxlYWYgPyB0b0JCb3goY2hpbGQpIDogY2hpbGQuYmJveDtcblxuICAgICAgICAgICAgICAgIGlmIChpbnRlcnNlY3RzKGJib3gsIGNoaWxkQkJveCkpIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKG5vZGUubGVhZiB8fCBjb250YWlucyhiYm94LCBjaGlsZEJCb3gpKSByZXR1cm4gdHJ1ZTtcbiAgICAgICAgICAgICAgICAgICAgbm9kZXNUb1NlYXJjaC5wdXNoKGNoaWxkKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBub2RlID0gbm9kZXNUb1NlYXJjaC5wb3AoKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9LFxuXG4gICAgbG9hZDogZnVuY3Rpb24gKGRhdGEpIHtcbiAgICAgICAgaWYgKCEoZGF0YSAmJiBkYXRhLmxlbmd0aCkpIHJldHVybiB0aGlzO1xuXG4gICAgICAgIGlmIChkYXRhLmxlbmd0aCA8IHRoaXMuX21pbkVudHJpZXMpIHtcbiAgICAgICAgICAgIGZvciAodmFyIGkgPSAwLCBsZW4gPSBkYXRhLmxlbmd0aDsgaSA8IGxlbjsgaSsrKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5pbnNlcnQoZGF0YVtpXSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gdGhpcztcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIHJlY3Vyc2l2ZWx5IGJ1aWxkIHRoZSB0cmVlIHdpdGggdGhlIGdpdmVuIGRhdGEgZnJvbSBzdHJhdGNoIHVzaW5nIE9NVCBhbGdvcml0aG1cbiAgICAgICAgdmFyIG5vZGUgPSB0aGlzLl9idWlsZChkYXRhLnNsaWNlKCksIDAsIGRhdGEubGVuZ3RoIC0gMSwgMCk7XG5cbiAgICAgICAgaWYgKCF0aGlzLmRhdGEuY2hpbGRyZW4ubGVuZ3RoKSB7XG4gICAgICAgICAgICAvLyBzYXZlIGFzIGlzIGlmIHRyZWUgaXMgZW1wdHlcbiAgICAgICAgICAgIHRoaXMuZGF0YSA9IG5vZGU7XG5cbiAgICAgICAgfSBlbHNlIGlmICh0aGlzLmRhdGEuaGVpZ2h0ID09PSBub2RlLmhlaWdodCkge1xuICAgICAgICAgICAgLy8gc3BsaXQgcm9vdCBpZiB0cmVlcyBoYXZlIHRoZSBzYW1lIGhlaWdodFxuICAgICAgICAgICAgdGhpcy5fc3BsaXRSb290KHRoaXMuZGF0YSwgbm9kZSk7XG5cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGlmICh0aGlzLmRhdGEuaGVpZ2h0IDwgbm9kZS5oZWlnaHQpIHtcbiAgICAgICAgICAgICAgICAvLyBzd2FwIHRyZWVzIGlmIGluc2VydGVkIG9uZSBpcyBiaWdnZXJcbiAgICAgICAgICAgICAgICB2YXIgdG1wTm9kZSA9IHRoaXMuZGF0YTtcbiAgICAgICAgICAgICAgICB0aGlzLmRhdGEgPSBub2RlO1xuICAgICAgICAgICAgICAgIG5vZGUgPSB0bXBOb2RlO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBpbnNlcnQgdGhlIHNtYWxsIHRyZWUgaW50byB0aGUgbGFyZ2UgdHJlZSBhdCBhcHByb3ByaWF0ZSBsZXZlbFxuICAgICAgICAgICAgdGhpcy5faW5zZXJ0KG5vZGUsIHRoaXMuZGF0YS5oZWlnaHQgLSBub2RlLmhlaWdodCAtIDEsIHRydWUpO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfSxcblxuICAgIGluc2VydDogZnVuY3Rpb24gKGl0ZW0pIHtcbiAgICAgICAgaWYgKGl0ZW0pIHRoaXMuX2luc2VydChpdGVtLCB0aGlzLmRhdGEuaGVpZ2h0IC0gMSk7XG4gICAgICAgIHJldHVybiB0aGlzO1xuICAgIH0sXG5cbiAgICBjbGVhcjogZnVuY3Rpb24gKCkge1xuICAgICAgICB0aGlzLmRhdGEgPSB7XG4gICAgICAgICAgICBjaGlsZHJlbjogW10sXG4gICAgICAgICAgICBoZWlnaHQ6IDEsXG4gICAgICAgICAgICBiYm94OiBlbXB0eSgpLFxuICAgICAgICAgICAgbGVhZjogdHJ1ZVxuICAgICAgICB9O1xuICAgICAgICByZXR1cm4gdGhpcztcbiAgICB9LFxuXG4gICAgcmVtb3ZlOiBmdW5jdGlvbiAoaXRlbSkge1xuICAgICAgICBpZiAoIWl0ZW0pIHJldHVybiB0aGlzO1xuXG4gICAgICAgIHZhciBub2RlID0gdGhpcy5kYXRhLFxuICAgICAgICAgICAgYmJveCA9IHRoaXMudG9CQm94KGl0ZW0pLFxuICAgICAgICAgICAgcGF0aCA9IFtdLFxuICAgICAgICAgICAgaW5kZXhlcyA9IFtdLFxuICAgICAgICAgICAgaSwgcGFyZW50LCBpbmRleCwgZ29pbmdVcDtcblxuICAgICAgICAvLyBkZXB0aC1maXJzdCBpdGVyYXRpdmUgdHJlZSB0cmF2ZXJzYWxcbiAgICAgICAgd2hpbGUgKG5vZGUgfHwgcGF0aC5sZW5ndGgpIHtcblxuICAgICAgICAgICAgaWYgKCFub2RlKSB7IC8vIGdvIHVwXG4gICAgICAgICAgICAgICAgbm9kZSA9IHBhdGgucG9wKCk7XG4gICAgICAgICAgICAgICAgcGFyZW50ID0gcGF0aFtwYXRoLmxlbmd0aCAtIDFdO1xuICAgICAgICAgICAgICAgIGkgPSBpbmRleGVzLnBvcCgpO1xuICAgICAgICAgICAgICAgIGdvaW5nVXAgPSB0cnVlO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAobm9kZS5sZWFmKSB7IC8vIGNoZWNrIGN1cnJlbnQgbm9kZVxuICAgICAgICAgICAgICAgIGluZGV4ID0gbm9kZS5jaGlsZHJlbi5pbmRleE9mKGl0ZW0pO1xuXG4gICAgICAgICAgICAgICAgaWYgKGluZGV4ICE9PSAtMSkge1xuICAgICAgICAgICAgICAgICAgICAvLyBpdGVtIGZvdW5kLCByZW1vdmUgdGhlIGl0ZW0gYW5kIGNvbmRlbnNlIHRyZWUgdXB3YXJkc1xuICAgICAgICAgICAgICAgICAgICBub2RlLmNoaWxkcmVuLnNwbGljZShpbmRleCwgMSk7XG4gICAgICAgICAgICAgICAgICAgIHBhdGgucHVzaChub2RlKTtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5fY29uZGVuc2UocGF0aCk7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB0aGlzO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKCFnb2luZ1VwICYmICFub2RlLmxlYWYgJiYgY29udGFpbnMobm9kZS5iYm94LCBiYm94KSkgeyAvLyBnbyBkb3duXG4gICAgICAgICAgICAgICAgcGF0aC5wdXNoKG5vZGUpO1xuICAgICAgICAgICAgICAgIGluZGV4ZXMucHVzaChpKTtcbiAgICAgICAgICAgICAgICBpID0gMDtcbiAgICAgICAgICAgICAgICBwYXJlbnQgPSBub2RlO1xuICAgICAgICAgICAgICAgIG5vZGUgPSBub2RlLmNoaWxkcmVuWzBdO1xuXG4gICAgICAgICAgICB9IGVsc2UgaWYgKHBhcmVudCkgeyAvLyBnbyByaWdodFxuICAgICAgICAgICAgICAgIGkrKztcbiAgICAgICAgICAgICAgICBub2RlID0gcGFyZW50LmNoaWxkcmVuW2ldO1xuICAgICAgICAgICAgICAgIGdvaW5nVXAgPSBmYWxzZTtcblxuICAgICAgICAgICAgfSBlbHNlIG5vZGUgPSBudWxsOyAvLyBub3RoaW5nIGZvdW5kXG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gdGhpcztcbiAgICB9LFxuXG4gICAgdG9CQm94OiBmdW5jdGlvbiAoaXRlbSkgeyByZXR1cm4gaXRlbTsgfSxcblxuICAgIGNvbXBhcmVNaW5YOiBmdW5jdGlvbiAoYSwgYikgeyByZXR1cm4gYVswXSAtIGJbMF07IH0sXG4gICAgY29tcGFyZU1pblk6IGZ1bmN0aW9uIChhLCBiKSB7IHJldHVybiBhWzFdIC0gYlsxXTsgfSxcblxuICAgIHRvSlNPTjogZnVuY3Rpb24gKCkgeyByZXR1cm4gdGhpcy5kYXRhOyB9LFxuXG4gICAgZnJvbUpTT046IGZ1bmN0aW9uIChkYXRhKSB7XG4gICAgICAgIHRoaXMuZGF0YSA9IGRhdGE7XG4gICAgICAgIHJldHVybiB0aGlzO1xuICAgIH0sXG5cbiAgICBfYWxsOiBmdW5jdGlvbiAobm9kZSwgcmVzdWx0KSB7XG4gICAgICAgIHZhciBub2Rlc1RvU2VhcmNoID0gW107XG4gICAgICAgIHdoaWxlIChub2RlKSB7XG4gICAgICAgICAgICBpZiAobm9kZS5sZWFmKSByZXN1bHQucHVzaC5hcHBseShyZXN1bHQsIG5vZGUuY2hpbGRyZW4pO1xuICAgICAgICAgICAgZWxzZSBub2Rlc1RvU2VhcmNoLnB1c2guYXBwbHkobm9kZXNUb1NlYXJjaCwgbm9kZS5jaGlsZHJlbik7XG5cbiAgICAgICAgICAgIG5vZGUgPSBub2Rlc1RvU2VhcmNoLnBvcCgpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgfSxcblxuICAgIF9idWlsZDogZnVuY3Rpb24gKGl0ZW1zLCBsZWZ0LCByaWdodCwgaGVpZ2h0KSB7XG5cbiAgICAgICAgdmFyIE4gPSByaWdodCAtIGxlZnQgKyAxLFxuICAgICAgICAgICAgTSA9IHRoaXMuX21heEVudHJpZXMsXG4gICAgICAgICAgICBub2RlO1xuXG4gICAgICAgIGlmIChOIDw9IE0pIHtcbiAgICAgICAgICAgIC8vIHJlYWNoZWQgbGVhZiBsZXZlbDsgcmV0dXJuIGxlYWZcbiAgICAgICAgICAgIG5vZGUgPSB7XG4gICAgICAgICAgICAgICAgY2hpbGRyZW46IGl0ZW1zLnNsaWNlKGxlZnQsIHJpZ2h0ICsgMSksXG4gICAgICAgICAgICAgICAgaGVpZ2h0OiAxLFxuICAgICAgICAgICAgICAgIGJib3g6IG51bGwsXG4gICAgICAgICAgICAgICAgbGVhZjogdHJ1ZVxuICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIGNhbGNCQm94KG5vZGUsIHRoaXMudG9CQm94KTtcbiAgICAgICAgICAgIHJldHVybiBub2RlO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKCFoZWlnaHQpIHtcbiAgICAgICAgICAgIC8vIHRhcmdldCBoZWlnaHQgb2YgdGhlIGJ1bGstbG9hZGVkIHRyZWVcbiAgICAgICAgICAgIGhlaWdodCA9IE1hdGguY2VpbChNYXRoLmxvZyhOKSAvIE1hdGgubG9nKE0pKTtcblxuICAgICAgICAgICAgLy8gdGFyZ2V0IG51bWJlciBvZiByb290IGVudHJpZXMgdG8gbWF4aW1pemUgc3RvcmFnZSB1dGlsaXphdGlvblxuICAgICAgICAgICAgTSA9IE1hdGguY2VpbChOIC8gTWF0aC5wb3coTSwgaGVpZ2h0IC0gMSkpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gVE9ETyBlbGltaW5hdGUgcmVjdXJzaW9uP1xuXG4gICAgICAgIG5vZGUgPSB7XG4gICAgICAgICAgICBjaGlsZHJlbjogW10sXG4gICAgICAgICAgICBoZWlnaHQ6IGhlaWdodCxcbiAgICAgICAgICAgIGJib3g6IG51bGxcbiAgICAgICAgfTtcblxuICAgICAgICAvLyBzcGxpdCB0aGUgaXRlbXMgaW50byBNIG1vc3RseSBzcXVhcmUgdGlsZXNcblxuICAgICAgICB2YXIgTjIgPSBNYXRoLmNlaWwoTiAvIE0pLFxuICAgICAgICAgICAgTjEgPSBOMiAqIE1hdGguY2VpbChNYXRoLnNxcnQoTSkpLFxuICAgICAgICAgICAgaSwgaiwgcmlnaHQyLCByaWdodDM7XG5cbiAgICAgICAgbXVsdGlTZWxlY3QoaXRlbXMsIGxlZnQsIHJpZ2h0LCBOMSwgdGhpcy5jb21wYXJlTWluWCk7XG5cbiAgICAgICAgZm9yIChpID0gbGVmdDsgaSA8PSByaWdodDsgaSArPSBOMSkge1xuXG4gICAgICAgICAgICByaWdodDIgPSBNYXRoLm1pbihpICsgTjEgLSAxLCByaWdodCk7XG5cbiAgICAgICAgICAgIG11bHRpU2VsZWN0KGl0ZW1zLCBpLCByaWdodDIsIE4yLCB0aGlzLmNvbXBhcmVNaW5ZKTtcblxuICAgICAgICAgICAgZm9yIChqID0gaTsgaiA8PSByaWdodDI7IGogKz0gTjIpIHtcblxuICAgICAgICAgICAgICAgIHJpZ2h0MyA9IE1hdGgubWluKGogKyBOMiAtIDEsIHJpZ2h0Mik7XG5cbiAgICAgICAgICAgICAgICAvLyBwYWNrIGVhY2ggZW50cnkgcmVjdXJzaXZlbHlcbiAgICAgICAgICAgICAgICBub2RlLmNoaWxkcmVuLnB1c2godGhpcy5fYnVpbGQoaXRlbXMsIGosIHJpZ2h0MywgaGVpZ2h0IC0gMSkpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgY2FsY0JCb3gobm9kZSwgdGhpcy50b0JCb3gpO1xuXG4gICAgICAgIHJldHVybiBub2RlO1xuICAgIH0sXG5cbiAgICBfY2hvb3NlU3VidHJlZTogZnVuY3Rpb24gKGJib3gsIG5vZGUsIGxldmVsLCBwYXRoKSB7XG5cbiAgICAgICAgdmFyIGksIGxlbiwgY2hpbGQsIHRhcmdldE5vZGUsIGFyZWEsIGVubGFyZ2VtZW50LCBtaW5BcmVhLCBtaW5FbmxhcmdlbWVudDtcblxuICAgICAgICB3aGlsZSAodHJ1ZSkge1xuICAgICAgICAgICAgcGF0aC5wdXNoKG5vZGUpO1xuXG4gICAgICAgICAgICBpZiAobm9kZS5sZWFmIHx8IHBhdGgubGVuZ3RoIC0gMSA9PT0gbGV2ZWwpIGJyZWFrO1xuXG4gICAgICAgICAgICBtaW5BcmVhID0gbWluRW5sYXJnZW1lbnQgPSBJbmZpbml0eTtcblxuICAgICAgICAgICAgZm9yIChpID0gMCwgbGVuID0gbm9kZS5jaGlsZHJlbi5sZW5ndGg7IGkgPCBsZW47IGkrKykge1xuICAgICAgICAgICAgICAgIGNoaWxkID0gbm9kZS5jaGlsZHJlbltpXTtcbiAgICAgICAgICAgICAgICBhcmVhID0gYmJveEFyZWEoY2hpbGQuYmJveCk7XG4gICAgICAgICAgICAgICAgZW5sYXJnZW1lbnQgPSBlbmxhcmdlZEFyZWEoYmJveCwgY2hpbGQuYmJveCkgLSBhcmVhO1xuXG4gICAgICAgICAgICAgICAgLy8gY2hvb3NlIGVudHJ5IHdpdGggdGhlIGxlYXN0IGFyZWEgZW5sYXJnZW1lbnRcbiAgICAgICAgICAgICAgICBpZiAoZW5sYXJnZW1lbnQgPCBtaW5FbmxhcmdlbWVudCkge1xuICAgICAgICAgICAgICAgICAgICBtaW5FbmxhcmdlbWVudCA9IGVubGFyZ2VtZW50O1xuICAgICAgICAgICAgICAgICAgICBtaW5BcmVhID0gYXJlYSA8IG1pbkFyZWEgPyBhcmVhIDogbWluQXJlYTtcbiAgICAgICAgICAgICAgICAgICAgdGFyZ2V0Tm9kZSA9IGNoaWxkO1xuXG4gICAgICAgICAgICAgICAgfSBlbHNlIGlmIChlbmxhcmdlbWVudCA9PT0gbWluRW5sYXJnZW1lbnQpIHtcbiAgICAgICAgICAgICAgICAgICAgLy8gb3RoZXJ3aXNlIGNob29zZSBvbmUgd2l0aCB0aGUgc21hbGxlc3QgYXJlYVxuICAgICAgICAgICAgICAgICAgICBpZiAoYXJlYSA8IG1pbkFyZWEpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIG1pbkFyZWEgPSBhcmVhO1xuICAgICAgICAgICAgICAgICAgICAgICAgdGFyZ2V0Tm9kZSA9IGNoaWxkO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBub2RlID0gdGFyZ2V0Tm9kZTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBub2RlO1xuICAgIH0sXG5cbiAgICBfaW5zZXJ0OiBmdW5jdGlvbiAoaXRlbSwgbGV2ZWwsIGlzTm9kZSkge1xuXG4gICAgICAgIHZhciB0b0JCb3ggPSB0aGlzLnRvQkJveCxcbiAgICAgICAgICAgIGJib3ggPSBpc05vZGUgPyBpdGVtLmJib3ggOiB0b0JCb3goaXRlbSksXG4gICAgICAgICAgICBpbnNlcnRQYXRoID0gW107XG5cbiAgICAgICAgLy8gZmluZCB0aGUgYmVzdCBub2RlIGZvciBhY2NvbW1vZGF0aW5nIHRoZSBpdGVtLCBzYXZpbmcgYWxsIG5vZGVzIGFsb25nIHRoZSBwYXRoIHRvb1xuICAgICAgICB2YXIgbm9kZSA9IHRoaXMuX2Nob29zZVN1YnRyZWUoYmJveCwgdGhpcy5kYXRhLCBsZXZlbCwgaW5zZXJ0UGF0aCk7XG5cbiAgICAgICAgLy8gcHV0IHRoZSBpdGVtIGludG8gdGhlIG5vZGVcbiAgICAgICAgbm9kZS5jaGlsZHJlbi5wdXNoKGl0ZW0pO1xuICAgICAgICBleHRlbmQobm9kZS5iYm94LCBiYm94KTtcblxuICAgICAgICAvLyBzcGxpdCBvbiBub2RlIG92ZXJmbG93OyBwcm9wYWdhdGUgdXB3YXJkcyBpZiBuZWNlc3NhcnlcbiAgICAgICAgd2hpbGUgKGxldmVsID49IDApIHtcbiAgICAgICAgICAgIGlmIChpbnNlcnRQYXRoW2xldmVsXS5jaGlsZHJlbi5sZW5ndGggPiB0aGlzLl9tYXhFbnRyaWVzKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5fc3BsaXQoaW5zZXJ0UGF0aCwgbGV2ZWwpO1xuICAgICAgICAgICAgICAgIGxldmVsLS07XG4gICAgICAgICAgICB9IGVsc2UgYnJlYWs7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBhZGp1c3QgYmJveGVzIGFsb25nIHRoZSBpbnNlcnRpb24gcGF0aFxuICAgICAgICB0aGlzLl9hZGp1c3RQYXJlbnRCQm94ZXMoYmJveCwgaW5zZXJ0UGF0aCwgbGV2ZWwpO1xuICAgIH0sXG5cbiAgICAvLyBzcGxpdCBvdmVyZmxvd2VkIG5vZGUgaW50byB0d29cbiAgICBfc3BsaXQ6IGZ1bmN0aW9uIChpbnNlcnRQYXRoLCBsZXZlbCkge1xuXG4gICAgICAgIHZhciBub2RlID0gaW5zZXJ0UGF0aFtsZXZlbF0sXG4gICAgICAgICAgICBNID0gbm9kZS5jaGlsZHJlbi5sZW5ndGgsXG4gICAgICAgICAgICBtID0gdGhpcy5fbWluRW50cmllcztcblxuICAgICAgICB0aGlzLl9jaG9vc2VTcGxpdEF4aXMobm9kZSwgbSwgTSk7XG5cbiAgICAgICAgdmFyIG5ld05vZGUgPSB7XG4gICAgICAgICAgICBjaGlsZHJlbjogbm9kZS5jaGlsZHJlbi5zcGxpY2UodGhpcy5fY2hvb3NlU3BsaXRJbmRleChub2RlLCBtLCBNKSksXG4gICAgICAgICAgICBoZWlnaHQ6IG5vZGUuaGVpZ2h0XG4gICAgICAgIH07XG5cbiAgICAgICAgaWYgKG5vZGUubGVhZikgbmV3Tm9kZS5sZWFmID0gdHJ1ZTtcblxuICAgICAgICBjYWxjQkJveChub2RlLCB0aGlzLnRvQkJveCk7XG4gICAgICAgIGNhbGNCQm94KG5ld05vZGUsIHRoaXMudG9CQm94KTtcblxuICAgICAgICBpZiAobGV2ZWwpIGluc2VydFBhdGhbbGV2ZWwgLSAxXS5jaGlsZHJlbi5wdXNoKG5ld05vZGUpO1xuICAgICAgICBlbHNlIHRoaXMuX3NwbGl0Um9vdChub2RlLCBuZXdOb2RlKTtcbiAgICB9LFxuXG4gICAgX3NwbGl0Um9vdDogZnVuY3Rpb24gKG5vZGUsIG5ld05vZGUpIHtcbiAgICAgICAgLy8gc3BsaXQgcm9vdCBub2RlXG4gICAgICAgIHRoaXMuZGF0YSA9IHtcbiAgICAgICAgICAgIGNoaWxkcmVuOiBbbm9kZSwgbmV3Tm9kZV0sXG4gICAgICAgICAgICBoZWlnaHQ6IG5vZGUuaGVpZ2h0ICsgMVxuICAgICAgICB9O1xuICAgICAgICBjYWxjQkJveCh0aGlzLmRhdGEsIHRoaXMudG9CQm94KTtcbiAgICB9LFxuXG4gICAgX2Nob29zZVNwbGl0SW5kZXg6IGZ1bmN0aW9uIChub2RlLCBtLCBNKSB7XG5cbiAgICAgICAgdmFyIGksIGJib3gxLCBiYm94Miwgb3ZlcmxhcCwgYXJlYSwgbWluT3ZlcmxhcCwgbWluQXJlYSwgaW5kZXg7XG5cbiAgICAgICAgbWluT3ZlcmxhcCA9IG1pbkFyZWEgPSBJbmZpbml0eTtcblxuICAgICAgICBmb3IgKGkgPSBtOyBpIDw9IE0gLSBtOyBpKyspIHtcbiAgICAgICAgICAgIGJib3gxID0gZGlzdEJCb3gobm9kZSwgMCwgaSwgdGhpcy50b0JCb3gpO1xuICAgICAgICAgICAgYmJveDIgPSBkaXN0QkJveChub2RlLCBpLCBNLCB0aGlzLnRvQkJveCk7XG5cbiAgICAgICAgICAgIG92ZXJsYXAgPSBpbnRlcnNlY3Rpb25BcmVhKGJib3gxLCBiYm94Mik7XG4gICAgICAgICAgICBhcmVhID0gYmJveEFyZWEoYmJveDEpICsgYmJveEFyZWEoYmJveDIpO1xuXG4gICAgICAgICAgICAvLyBjaG9vc2UgZGlzdHJpYnV0aW9uIHdpdGggbWluaW11bSBvdmVybGFwXG4gICAgICAgICAgICBpZiAob3ZlcmxhcCA8IG1pbk92ZXJsYXApIHtcbiAgICAgICAgICAgICAgICBtaW5PdmVybGFwID0gb3ZlcmxhcDtcbiAgICAgICAgICAgICAgICBpbmRleCA9IGk7XG5cbiAgICAgICAgICAgICAgICBtaW5BcmVhID0gYXJlYSA8IG1pbkFyZWEgPyBhcmVhIDogbWluQXJlYTtcblxuICAgICAgICAgICAgfSBlbHNlIGlmIChvdmVybGFwID09PSBtaW5PdmVybGFwKSB7XG4gICAgICAgICAgICAgICAgLy8gb3RoZXJ3aXNlIGNob29zZSBkaXN0cmlidXRpb24gd2l0aCBtaW5pbXVtIGFyZWFcbiAgICAgICAgICAgICAgICBpZiAoYXJlYSA8IG1pbkFyZWEpIHtcbiAgICAgICAgICAgICAgICAgICAgbWluQXJlYSA9IGFyZWE7XG4gICAgICAgICAgICAgICAgICAgIGluZGV4ID0gaTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gaW5kZXg7XG4gICAgfSxcblxuICAgIC8vIHNvcnRzIG5vZGUgY2hpbGRyZW4gYnkgdGhlIGJlc3QgYXhpcyBmb3Igc3BsaXRcbiAgICBfY2hvb3NlU3BsaXRBeGlzOiBmdW5jdGlvbiAobm9kZSwgbSwgTSkge1xuXG4gICAgICAgIHZhciBjb21wYXJlTWluWCA9IG5vZGUubGVhZiA/IHRoaXMuY29tcGFyZU1pblggOiBjb21wYXJlTm9kZU1pblgsXG4gICAgICAgICAgICBjb21wYXJlTWluWSA9IG5vZGUubGVhZiA/IHRoaXMuY29tcGFyZU1pblkgOiBjb21wYXJlTm9kZU1pblksXG4gICAgICAgICAgICB4TWFyZ2luID0gdGhpcy5fYWxsRGlzdE1hcmdpbihub2RlLCBtLCBNLCBjb21wYXJlTWluWCksXG4gICAgICAgICAgICB5TWFyZ2luID0gdGhpcy5fYWxsRGlzdE1hcmdpbihub2RlLCBtLCBNLCBjb21wYXJlTWluWSk7XG5cbiAgICAgICAgLy8gaWYgdG90YWwgZGlzdHJpYnV0aW9ucyBtYXJnaW4gdmFsdWUgaXMgbWluaW1hbCBmb3IgeCwgc29ydCBieSBtaW5YLFxuICAgICAgICAvLyBvdGhlcndpc2UgaXQncyBhbHJlYWR5IHNvcnRlZCBieSBtaW5ZXG4gICAgICAgIGlmICh4TWFyZ2luIDwgeU1hcmdpbikgbm9kZS5jaGlsZHJlbi5zb3J0KGNvbXBhcmVNaW5YKTtcbiAgICB9LFxuXG4gICAgLy8gdG90YWwgbWFyZ2luIG9mIGFsbCBwb3NzaWJsZSBzcGxpdCBkaXN0cmlidXRpb25zIHdoZXJlIGVhY2ggbm9kZSBpcyBhdCBsZWFzdCBtIGZ1bGxcbiAgICBfYWxsRGlzdE1hcmdpbjogZnVuY3Rpb24gKG5vZGUsIG0sIE0sIGNvbXBhcmUpIHtcblxuICAgICAgICBub2RlLmNoaWxkcmVuLnNvcnQoY29tcGFyZSk7XG5cbiAgICAgICAgdmFyIHRvQkJveCA9IHRoaXMudG9CQm94LFxuICAgICAgICAgICAgbGVmdEJCb3ggPSBkaXN0QkJveChub2RlLCAwLCBtLCB0b0JCb3gpLFxuICAgICAgICAgICAgcmlnaHRCQm94ID0gZGlzdEJCb3gobm9kZSwgTSAtIG0sIE0sIHRvQkJveCksXG4gICAgICAgICAgICBtYXJnaW4gPSBiYm94TWFyZ2luKGxlZnRCQm94KSArIGJib3hNYXJnaW4ocmlnaHRCQm94KSxcbiAgICAgICAgICAgIGksIGNoaWxkO1xuXG4gICAgICAgIGZvciAoaSA9IG07IGkgPCBNIC0gbTsgaSsrKSB7XG4gICAgICAgICAgICBjaGlsZCA9IG5vZGUuY2hpbGRyZW5baV07XG4gICAgICAgICAgICBleHRlbmQobGVmdEJCb3gsIG5vZGUubGVhZiA/IHRvQkJveChjaGlsZCkgOiBjaGlsZC5iYm94KTtcbiAgICAgICAgICAgIG1hcmdpbiArPSBiYm94TWFyZ2luKGxlZnRCQm94KTtcbiAgICAgICAgfVxuXG4gICAgICAgIGZvciAoaSA9IE0gLSBtIC0gMTsgaSA+PSBtOyBpLS0pIHtcbiAgICAgICAgICAgIGNoaWxkID0gbm9kZS5jaGlsZHJlbltpXTtcbiAgICAgICAgICAgIGV4dGVuZChyaWdodEJCb3gsIG5vZGUubGVhZiA/IHRvQkJveChjaGlsZCkgOiBjaGlsZC5iYm94KTtcbiAgICAgICAgICAgIG1hcmdpbiArPSBiYm94TWFyZ2luKHJpZ2h0QkJveCk7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gbWFyZ2luO1xuICAgIH0sXG5cbiAgICBfYWRqdXN0UGFyZW50QkJveGVzOiBmdW5jdGlvbiAoYmJveCwgcGF0aCwgbGV2ZWwpIHtcbiAgICAgICAgLy8gYWRqdXN0IGJib3hlcyBhbG9uZyB0aGUgZ2l2ZW4gdHJlZSBwYXRoXG4gICAgICAgIGZvciAodmFyIGkgPSBsZXZlbDsgaSA+PSAwOyBpLS0pIHtcbiAgICAgICAgICAgIGV4dGVuZChwYXRoW2ldLmJib3gsIGJib3gpO1xuICAgICAgICB9XG4gICAgfSxcblxuICAgIF9jb25kZW5zZTogZnVuY3Rpb24gKHBhdGgpIHtcbiAgICAgICAgLy8gZ28gdGhyb3VnaCB0aGUgcGF0aCwgcmVtb3ZpbmcgZW1wdHkgbm9kZXMgYW5kIHVwZGF0aW5nIGJib3hlc1xuICAgICAgICBmb3IgKHZhciBpID0gcGF0aC5sZW5ndGggLSAxLCBzaWJsaW5nczsgaSA+PSAwOyBpLS0pIHtcbiAgICAgICAgICAgIGlmIChwYXRoW2ldLmNoaWxkcmVuLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgICAgICAgIGlmIChpID4gMCkge1xuICAgICAgICAgICAgICAgICAgICBzaWJsaW5ncyA9IHBhdGhbaSAtIDFdLmNoaWxkcmVuO1xuICAgICAgICAgICAgICAgICAgICBzaWJsaW5ncy5zcGxpY2Uoc2libGluZ3MuaW5kZXhPZihwYXRoW2ldKSwgMSk7XG5cbiAgICAgICAgICAgICAgICB9IGVsc2UgdGhpcy5jbGVhcigpO1xuXG4gICAgICAgICAgICB9IGVsc2UgY2FsY0JCb3gocGF0aFtpXSwgdGhpcy50b0JCb3gpO1xuICAgICAgICB9XG4gICAgfSxcblxuICAgIF9pbml0Rm9ybWF0OiBmdW5jdGlvbiAoZm9ybWF0KSB7XG4gICAgICAgIC8vIGRhdGEgZm9ybWF0IChtaW5YLCBtaW5ZLCBtYXhYLCBtYXhZIGFjY2Vzc29ycylcblxuICAgICAgICAvLyB1c2VzIGV2YWwtdHlwZSBmdW5jdGlvbiBjb21waWxhdGlvbiBpbnN0ZWFkIG9mIGp1c3QgYWNjZXB0aW5nIGEgdG9CQm94IGZ1bmN0aW9uXG4gICAgICAgIC8vIGJlY2F1c2UgdGhlIGFsZ29yaXRobXMgYXJlIHZlcnkgc2Vuc2l0aXZlIHRvIHNvcnRpbmcgZnVuY3Rpb25zIHBlcmZvcm1hbmNlLFxuICAgICAgICAvLyBzbyB0aGV5IHNob3VsZCBiZSBkZWFkIHNpbXBsZSBhbmQgd2l0aG91dCBpbm5lciBjYWxsc1xuXG4gICAgICAgIC8vIGpzaGludCBldmlsOiB0cnVlXG5cbiAgICAgICAgdmFyIGNvbXBhcmVBcnIgPSBbJ3JldHVybiBhJywgJyAtIGInLCAnOyddO1xuXG4gICAgICAgIHRoaXMuY29tcGFyZU1pblggPSBuZXcgRnVuY3Rpb24oJ2EnLCAnYicsIGNvbXBhcmVBcnIuam9pbihmb3JtYXRbMF0pKTtcbiAgICAgICAgdGhpcy5jb21wYXJlTWluWSA9IG5ldyBGdW5jdGlvbignYScsICdiJywgY29tcGFyZUFyci5qb2luKGZvcm1hdFsxXSkpO1xuXG4gICAgICAgIHRoaXMudG9CQm94ID0gbmV3IEZ1bmN0aW9uKCdhJywgJ3JldHVybiBbYScgKyBmb3JtYXQuam9pbignLCBhJykgKyAnXTsnKTtcbiAgICB9XG59O1xuXG5cbi8vIGNhbGN1bGF0ZSBub2RlJ3MgYmJveCBmcm9tIGJib3hlcyBvZiBpdHMgY2hpbGRyZW5cbmZ1bmN0aW9uIGNhbGNCQm94KG5vZGUsIHRvQkJveCkge1xuICAgIG5vZGUuYmJveCA9IGRpc3RCQm94KG5vZGUsIDAsIG5vZGUuY2hpbGRyZW4ubGVuZ3RoLCB0b0JCb3gpO1xufVxuXG4vLyBtaW4gYm91bmRpbmcgcmVjdGFuZ2xlIG9mIG5vZGUgY2hpbGRyZW4gZnJvbSBrIHRvIHAtMVxuZnVuY3Rpb24gZGlzdEJCb3gobm9kZSwgaywgcCwgdG9CQm94KSB7XG4gICAgdmFyIGJib3ggPSBlbXB0eSgpO1xuXG4gICAgZm9yICh2YXIgaSA9IGssIGNoaWxkOyBpIDwgcDsgaSsrKSB7XG4gICAgICAgIGNoaWxkID0gbm9kZS5jaGlsZHJlbltpXTtcbiAgICAgICAgZXh0ZW5kKGJib3gsIG5vZGUubGVhZiA/IHRvQkJveChjaGlsZCkgOiBjaGlsZC5iYm94KTtcbiAgICB9XG5cbiAgICByZXR1cm4gYmJveDtcbn1cblxuZnVuY3Rpb24gZW1wdHkoKSB7IHJldHVybiBbSW5maW5pdHksIEluZmluaXR5LCAtSW5maW5pdHksIC1JbmZpbml0eV07IH1cblxuZnVuY3Rpb24gZXh0ZW5kKGEsIGIpIHtcbiAgICBhWzBdID0gTWF0aC5taW4oYVswXSwgYlswXSk7XG4gICAgYVsxXSA9IE1hdGgubWluKGFbMV0sIGJbMV0pO1xuICAgIGFbMl0gPSBNYXRoLm1heChhWzJdLCBiWzJdKTtcbiAgICBhWzNdID0gTWF0aC5tYXgoYVszXSwgYlszXSk7XG4gICAgcmV0dXJuIGE7XG59XG5cbmZ1bmN0aW9uIGNvbXBhcmVOb2RlTWluWChhLCBiKSB7IHJldHVybiBhLmJib3hbMF0gLSBiLmJib3hbMF07IH1cbmZ1bmN0aW9uIGNvbXBhcmVOb2RlTWluWShhLCBiKSB7IHJldHVybiBhLmJib3hbMV0gLSBiLmJib3hbMV07IH1cblxuZnVuY3Rpb24gYmJveEFyZWEoYSkgICB7IHJldHVybiAoYVsyXSAtIGFbMF0pICogKGFbM10gLSBhWzFdKTsgfVxuZnVuY3Rpb24gYmJveE1hcmdpbihhKSB7IHJldHVybiAoYVsyXSAtIGFbMF0pICsgKGFbM10gLSBhWzFdKTsgfVxuXG5mdW5jdGlvbiBlbmxhcmdlZEFyZWEoYSwgYikge1xuICAgIHJldHVybiAoTWF0aC5tYXgoYlsyXSwgYVsyXSkgLSBNYXRoLm1pbihiWzBdLCBhWzBdKSkgKlxuICAgICAgICAgICAoTWF0aC5tYXgoYlszXSwgYVszXSkgLSBNYXRoLm1pbihiWzFdLCBhWzFdKSk7XG59XG5cbmZ1bmN0aW9uIGludGVyc2VjdGlvbkFyZWEoYSwgYikge1xuICAgIHZhciBtaW5YID0gTWF0aC5tYXgoYVswXSwgYlswXSksXG4gICAgICAgIG1pblkgPSBNYXRoLm1heChhWzFdLCBiWzFdKSxcbiAgICAgICAgbWF4WCA9IE1hdGgubWluKGFbMl0sIGJbMl0pLFxuICAgICAgICBtYXhZID0gTWF0aC5taW4oYVszXSwgYlszXSk7XG5cbiAgICByZXR1cm4gTWF0aC5tYXgoMCwgbWF4WCAtIG1pblgpICpcbiAgICAgICAgICAgTWF0aC5tYXgoMCwgbWF4WSAtIG1pblkpO1xufVxuXG5mdW5jdGlvbiBjb250YWlucyhhLCBiKSB7XG4gICAgcmV0dXJuIGFbMF0gPD0gYlswXSAmJlxuICAgICAgICAgICBhWzFdIDw9IGJbMV0gJiZcbiAgICAgICAgICAgYlsyXSA8PSBhWzJdICYmXG4gICAgICAgICAgIGJbM10gPD0gYVszXTtcbn1cblxuZnVuY3Rpb24gaW50ZXJzZWN0cyhhLCBiKSB7XG4gICAgcmV0dXJuIGJbMF0gPD0gYVsyXSAmJlxuICAgICAgICAgICBiWzFdIDw9IGFbM10gJiZcbiAgICAgICAgICAgYlsyXSA+PSBhWzBdICYmXG4gICAgICAgICAgIGJbM10gPj0gYVsxXTtcbn1cblxuLy8gc29ydCBhbiBhcnJheSBzbyB0aGF0IGl0ZW1zIGNvbWUgaW4gZ3JvdXBzIG9mIG4gdW5zb3J0ZWQgaXRlbXMsIHdpdGggZ3JvdXBzIHNvcnRlZCBiZXR3ZWVuIGVhY2ggb3RoZXI7XG4vLyBjb21iaW5lcyBzZWxlY3Rpb24gYWxnb3JpdGhtIHdpdGggYmluYXJ5IGRpdmlkZSAmIGNvbnF1ZXIgYXBwcm9hY2hcblxuZnVuY3Rpb24gbXVsdGlTZWxlY3QoYXJyLCBsZWZ0LCByaWdodCwgbiwgY29tcGFyZSkge1xuICAgIHZhciBzdGFjayA9IFtsZWZ0LCByaWdodF0sXG4gICAgICAgIG1pZDtcblxuICAgIHdoaWxlIChzdGFjay5sZW5ndGgpIHtcbiAgICAgICAgcmlnaHQgPSBzdGFjay5wb3AoKTtcbiAgICAgICAgbGVmdCA9IHN0YWNrLnBvcCgpO1xuXG4gICAgICAgIGlmIChyaWdodCAtIGxlZnQgPD0gbikgY29udGludWU7XG5cbiAgICAgICAgbWlkID0gbGVmdCArIE1hdGguY2VpbCgocmlnaHQgLSBsZWZ0KSAvIG4gLyAyKSAqIG47XG4gICAgICAgIHNlbGVjdChhcnIsIGxlZnQsIHJpZ2h0LCBtaWQsIGNvbXBhcmUpO1xuXG4gICAgICAgIHN0YWNrLnB1c2gobGVmdCwgbWlkLCBtaWQsIHJpZ2h0KTtcbiAgICB9XG59XG5cbi8vIEZsb3lkLVJpdmVzdCBzZWxlY3Rpb24gYWxnb3JpdGhtOlxuLy8gc29ydCBhbiBhcnJheSBiZXR3ZWVuIGxlZnQgYW5kIHJpZ2h0IChpbmNsdXNpdmUpIHNvIHRoYXQgdGhlIHNtYWxsZXN0IGsgZWxlbWVudHMgY29tZSBmaXJzdCAodW5vcmRlcmVkKVxuZnVuY3Rpb24gc2VsZWN0KGFyciwgbGVmdCwgcmlnaHQsIGssIGNvbXBhcmUpIHtcbiAgICB2YXIgbiwgaSwgeiwgcywgc2QsIG5ld0xlZnQsIG5ld1JpZ2h0LCB0LCBqO1xuXG4gICAgd2hpbGUgKHJpZ2h0ID4gbGVmdCkge1xuICAgICAgICBpZiAocmlnaHQgLSBsZWZ0ID4gNjAwKSB7XG4gICAgICAgICAgICBuID0gcmlnaHQgLSBsZWZ0ICsgMTtcbiAgICAgICAgICAgIGkgPSBrIC0gbGVmdCArIDE7XG4gICAgICAgICAgICB6ID0gTWF0aC5sb2cobik7XG4gICAgICAgICAgICBzID0gMC41ICogTWF0aC5leHAoMiAqIHogLyAzKTtcbiAgICAgICAgICAgIHNkID0gMC41ICogTWF0aC5zcXJ0KHogKiBzICogKG4gLSBzKSAvIG4pICogKGkgLSBuIC8gMiA8IDAgPyAtMSA6IDEpO1xuICAgICAgICAgICAgbmV3TGVmdCA9IE1hdGgubWF4KGxlZnQsIE1hdGguZmxvb3IoayAtIGkgKiBzIC8gbiArIHNkKSk7XG4gICAgICAgICAgICBuZXdSaWdodCA9IE1hdGgubWluKHJpZ2h0LCBNYXRoLmZsb29yKGsgKyAobiAtIGkpICogcyAvIG4gKyBzZCkpO1xuICAgICAgICAgICAgc2VsZWN0KGFyciwgbmV3TGVmdCwgbmV3UmlnaHQsIGssIGNvbXBhcmUpO1xuICAgICAgICB9XG5cbiAgICAgICAgdCA9IGFycltrXTtcbiAgICAgICAgaSA9IGxlZnQ7XG4gICAgICAgIGogPSByaWdodDtcblxuICAgICAgICBzd2FwKGFyciwgbGVmdCwgayk7XG4gICAgICAgIGlmIChjb21wYXJlKGFycltyaWdodF0sIHQpID4gMCkgc3dhcChhcnIsIGxlZnQsIHJpZ2h0KTtcblxuICAgICAgICB3aGlsZSAoaSA8IGopIHtcbiAgICAgICAgICAgIHN3YXAoYXJyLCBpLCBqKTtcbiAgICAgICAgICAgIGkrKztcbiAgICAgICAgICAgIGotLTtcbiAgICAgICAgICAgIHdoaWxlIChjb21wYXJlKGFycltpXSwgdCkgPCAwKSBpKys7XG4gICAgICAgICAgICB3aGlsZSAoY29tcGFyZShhcnJbal0sIHQpID4gMCkgai0tO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGNvbXBhcmUoYXJyW2xlZnRdLCB0KSA9PT0gMCkgc3dhcChhcnIsIGxlZnQsIGopO1xuICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgIGorKztcbiAgICAgICAgICAgIHN3YXAoYXJyLCBqLCByaWdodCk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoaiA8PSBrKSBsZWZ0ID0gaiArIDE7XG4gICAgICAgIGlmIChrIDw9IGopIHJpZ2h0ID0gaiAtIDE7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBzd2FwKGFyciwgaSwgaikge1xuICAgIHZhciB0bXAgPSBhcnJbaV07XG4gICAgYXJyW2ldID0gYXJyW2pdO1xuICAgIGFycltqXSA9IHRtcDtcbn1cblxuXG4vLyBleHBvcnQgYXMgQU1EL0NvbW1vbkpTIG1vZHVsZSBvciBnbG9iYWwgdmFyaWFibGVcbmlmICh0eXBlb2YgZGVmaW5lID09PSAnZnVuY3Rpb24nICYmIGRlZmluZS5hbWQpIGRlZmluZSgncmJ1c2gnLCBmdW5jdGlvbigpIHsgcmV0dXJuIHJidXNoOyB9KTtcbmVsc2UgaWYgKHR5cGVvZiBtb2R1bGUgIT09ICd1bmRlZmluZWQnKSBtb2R1bGUuZXhwb3J0cyA9IHJidXNoO1xuZWxzZSBpZiAodHlwZW9mIHNlbGYgIT09ICd1bmRlZmluZWQnKSBzZWxmLnJidXNoID0gcmJ1c2g7XG5lbHNlIHdpbmRvdy5yYnVzaCA9IHJidXNoO1xuXG59KSgpO1xuIl19
