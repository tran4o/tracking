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
require('./Track');
require('./GUI');
require('./Participant');
window.CONFIG=require('./Config');
var Utils=require('./Utils');
for (var e in Utils) 
	window[e]=Utils[e];

var draw;
var modify;
var select;

window.TRACK = new Track();
window.GUI = new Gui(
{
		track		: TRACK,
		initialZoom : 2
		//initialPos  : [lon,lat],
});

function errorRoute(err) {
	GUI.showError(err);
}

function initGUI() 
{
	if (GUI.is_init) {
		select.getFeatures().clear();
		return;
	}
	GUI.is_init=1;
	GUI.init({skipExtent:true});
	//-------------------------------------------------
	function store(forceClose) 
	{
		if (!GUI.getTrackLayer().getSource().getFeatures().length) {
			return null;
		}
		var trackData=GUI.getTrackLayer().getSource().getFeatures()[0].getGeometry().getCoordinates();
		if (forceClose) 
		{
			if (trackData[0][0] != trackData[trackData.length-1][0] || trackData[0][1] != trackData[trackData.length-1][1]) {
				trackData.push(trackData[0]);
				GUI.getTrackLayer().getSource().getFeatures()[0].getGeometry().setCoordinates(trackData);
			}
		}
		for (var i=0;i<trackData.length;i++)
			trackData[i]=ol.proj.transform(trackData[i], 'EPSG:3857','EPSG:4326');			
		$("#route_text_area").val(JSON.stringify(trackData));
		TRACK.setRoute(trackData);
		
		var str = (TRACK.getTrackLength()/1000.0)+" km";
		$("#route_info").val(str);
		return JSON.stringify(trackData);
	}
	//-------------------------------------------------
	select = new ol.interaction.Select({
		style: STYLES["trackselected"],
		layers: [GUI.trackLayer]
	});
	modify = new ol.interaction.Modify({
		features: select.getFeatures(),
		layers: [GUI.trackLayer]
	});
	//-------------------------------------------------
	draw = new ol.interaction.Draw({
	      source: GUI.trackLayer.getSource(),
	      type: "LineString"
	});
	draw.on('drawstart', function(e) {
		GUI.trackLayer.getSource().clear();
	});
	draw.on('drawend', function(e) {
		GUI.map.removeInteraction(draw);
		GUI.map.addInteraction(select);
		GUI.map.addInteraction(modify);
		store();
		if (!TRACK.feature)
			TRACK.feature=GUI.getTrackLayer().getSource().getFeatures()[0];
	});
	//-------------------------------------------------
	GUI.map.removeInteraction(select);
	GUI.map.removeInteraction(modify);
	GUI.map.addInteraction(draw);
	//-------------------------------------------------
	$("#button_erase").click(function(){
		GUI.trackLayer.getSource().clear();
		select.getFeatures().clear();
		GUI.map.removeInteraction(select);
		GUI.map.removeInteraction(modify);
		GUI.map.addInteraction(draw);
		store();
	});
	$("#button_navigate").click(function(){
		TRACK.generateFromLocations(TRACK.getRoute(),function() {
			TRACK.updateFeature();
			store();
		},function(msg) {
			GUI.showError(msg);
		},true);			
	});
	$("#button_join").click(function() {
		store(true);
	});
	$("#button_submit").click(function() {
		var data = store();
		GUI.onEditSave(data);			
		$(".fw-container").css("display","block");
	});
	$("#button_cancel").click(function() {
		$("#map").css("display","none");
		$(".fw-container").css("display","block");
	});
}
//-------------------------------------------------
function mapEdit(id,json,valBikeStart,valRunStart,onSubmit) 
{		
	//console.log("ID : "+id+" | JSON : "+json);
	$(".fw-container").css("display","none");
	$("#map").css("display","block");
	initGUI();
	GUI.trackLayer.getSource().clear();
	try {
		var trackData = JSON.parse(json);
		TRACK.setRoute(trackData);
		TRACK.bikeStartKM=parseFloat(valBikeStart);
		TRACK.runStartKM=parseFloat(valRunStart);
		if (isNaN(TRACK.bikeStartKM))
			TRACK.bikeStartKM=3.86;
		if (isNaN(TRACK.runStartKM))
			TRACK.runStartKM=180.25+TRACK.bikeStartKM;
		if (json && json != "") 
		{
			$("#route_text_area").val(json);

			var str = (TRACK.getTrackLength()/1000.0)+" km";
			$("#route_info").val(str);

			GUI.addTrackFeature();
			GUI.zoomToTrack();
			GUI.map.removeInteraction(draw);
			GUI.map.addInteraction(select);
			GUI.map.addInteraction(modify);
		}		
	} catch (e) {
		console.log("Unable to do mapEdit for "+json);
		console.error("Exception on mapEdit "+e);
	}		
	GUI.onEditSave = function(data) {
		$("#map").css("display","none");
		onSubmit(data);
	};
}

$(document).ready( function () 
{
	$(".mobile-show i").click(function() {
		$(".mobile-show").css("display","none"); 
		$(".fw-nav").css("height","auto"); 
	});
	//----------------------------------------
	window.EDITOR1 = new $.fn.dataTable.Editor( {
		ajax: '../participants',
		table: "#table-participants",
		idSrc: "id",
		fields: [ 
		    {
				label: "Start No",
				name: "startNo"
			},{
				label: "First name",
				name: "firstname"
			},{
				label: "Last name",
				name: "lastname"
			},{
				label: "Gender",
				name: "gender"
			},{
				label: "Nationality",
				name: "nationality"
			},{
				label: "Start group",
				name: "startGroup"
			},{
				label: "Club",
				name: "club"
			},{
				label: "Birth date",
				name: "birthDate",
			},{
				label: "Id",
				name: "id",
				type : "readonly"
			}			
		]
	} );

	window.EDITOR2 = new $.fn.dataTable.Editor( {
		ajax: '../starts',
		table: "#table-starts",
		idSrc: "id",
		fields: [{
					label: "Id",
					name: "id",
					type : "readonly"
				}, {
					label: "From No",
					name: "fromStartNo"
				}, {
					label: "To No",
					name: "toStartNo"
				}, {
					label: "Start Time",
					name: "startTime"
				}]
	} );

	var tableParticipants = $('#table-participants').DataTable( {
		dom: "Tfrtip",
		ajax: "../participants?mode=dtbl",
		columns: [
			{ data: "startNo",className : "dt-body-right" },
			{ data: "firstname" },
			{ data: "lastname" },
			{ data: "gender" },
			{ data: "nationality"},
			{ data: "startGroup" },
			{ data: "club"},
			{ data: "birthDate",className : "dt-body-right" },
			{ data: "id" }
		],
		tableTools: {
			sRowSelect: "os",
			aButtons: [
				{ sExtends: "editor_create", editor: EDITOR1 },
				{ sExtends: "editor_edit",   editor: EDITOR1 },
				{ sExtends: "editor_remove", editor: EDITOR1 }
			]
		}
	} );	
	
	var tableStarts = $('#table-starts').DataTable( {
		dom: "Tfrtip",
		ajax: "../starts",
		columns: [
			{ data: "fromStartNo" },
			{ data: "toStartNo" },
			{ data: "startTime" }
		],
		tableTools: {
			sRowSelect: "os",
			aButtons: [
				{ sExtends: "editor_create", editor: EDITOR2 },
				{ sExtends: "editor_edit",   editor: EDITOR2 },
				{ sExtends: "editor_remove", editor: EDITOR2 }
           ]
		}
	} );
	
	//-----------------------------------------------
	
	/*
	$("#nav1").click(function() {
		$("#nav1").addClass("active");
		$("#nav2").removeClass("active");
		$("#tab1").css("height","auto");
		$("#tab2").css("height","0");
	});
	$("#nav2").click(function() {
		$("#nav2").addClass("active");
		$("#nav1").removeClass("active");
		$("#tab2").css("height","auto");
		$("#tab1").css("height","0");
	});
	*/
	//-----------------------------------------------
});

},{"./Config":7,"./GUI":8,"./Participant":10,"./Track":13,"./Utils":14}],7:[function(require,module,exports){
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
		gpsInaccuracy : 0,  // error simulation in METER (look math.gpsInaccuracy, min 1/2)
	},
	settings : {
		noMiddleWare : 0, 	// SKIP middle ware node js app
		noInterpolation : 0	// 1 -> no interpolation only points
	},
	math : {
		gpsInaccuracy : 20,	//TODO 13 min
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

},{"./Utils.js":14}],8:[function(require,module,exports){
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
			{
				this.debugLayerGPS = new ol.layer.Vector({
					  source: new ol.source.Vector(),
					  style : STYLES["debugGPS"]
				});
				this.testLayer = new ol.layer.Vector({
					  source: new ol.source.Vector(),
					  style : STYLES["test"]
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
			if (this.isDebug) { 
				this.map.addLayer(this.debugLayerGPS);
				this.map.addLayer(this.testLayer);
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
},{"./Config":7,"./LiveStream":9,"./Styles":12,"./Track":13,"./Utils":14,"joose":15}],9:[function(require,module,exports){
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
},{"./Utils":14,"joose":15}],10:[function(require,module,exports){
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
			var result = this.track.rTree.search([pos[0]-rr, pos[1]-rr, pos[0]+rr, pos[1]+rr]);
			if (!result)
				result=[];
			//console.log("FOUND "+result.length+" | "+this.track.route.length+" | "+rr);
			//for (var i=0;i<this.track.route.length-1;i++) {

			//----------------------------------------------
			var dbgLine = [];
			for (var _i=0;_i<result.length;_i++)
			{
				var i = result[_i][4].index;
				
				if (typeof GUI != "undefined" && GUI.isDebug) 
					dbgLine.push([[tg[i][0], tg[i][1]], [tg[i+1][0], tg[i+1][1]]]);
				
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
			//------/---------------------------------------
			//console.log("OOOOOOP! "+dbgLine.length);
			//console.log(dbgLine);
			if (typeof GUI != "undefined" && GUI.isDebug) 
			{
				if (this.__dbgBox) {
					GUI.testLayer.getSource().removeFeature(this.__dbgBox);
					delete this.__dbgBox;
				}
				if (dbgLine.length) {
					var feature = new ol.Feature();
					var geom = new ol.geom.MultiLineString(dbgLine);
					geom.transform('EPSG:4326', 'EPSG:3857');
					feature.setGeometry(geom);
					GUI.testLayer.getSource().addFeature(feature);
				}
			} 
			//---------------------------------------------
			
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

},{"./Config":7,"./Point":11,"./Utils":14,"joose":15}],11:[function(require,module,exports){
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
},{"joose":15}],12:[function(require,module,exports){
var CONFIG = require('./Config');

var STYLES=
{
	//------------------------------------------------
	// style function for track
	//------------------------------------------------
		
	"_track": function(feature,resolution) 
	{
        return 
        [
        ];
	},

	"test": function(feature,resolution) 
	{
		var styles=[];
        styles.push(new ol.style.Style({
             stroke: new ol.style.Stroke({
                 color: "#0000FF",
                 width: 3
             })
         	}));
        return styles;
	},
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

},{"./Config":7}],13:[function(require,module,exports){
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
		}

    }
});
},{"./Config":7,"./Participant":10,"./Utils":14,"joose":15,"rbush":16}],14:[function(require,module,exports){
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

},{"buffer":1}],15:[function(require,module,exports){
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

},{"_process":5}],16:[function(require,module,exports){
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

},{}]},{},[6])
//# sourceMappingURL=data:application/json;charset:utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL0FwcERhdGEvUm9hbWluZy9ucG0vbm9kZV9tb2R1bGVzL2Jyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2Jyb3dzZXItcGFjay9fcHJlbHVkZS5qcyIsIi4uLy4uL0FwcERhdGEvUm9hbWluZy9ucG0vbm9kZV9tb2R1bGVzL2Jyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2J1ZmZlci9pbmRleC5qcyIsIi4uLy4uL0FwcERhdGEvUm9hbWluZy9ucG0vbm9kZV9tb2R1bGVzL2Jyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2J1ZmZlci9ub2RlX21vZHVsZXMvYmFzZTY0LWpzL2xpYi9iNjQuanMiLCIuLi8uLi9BcHBEYXRhL1JvYW1pbmcvbnBtL25vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9idWZmZXIvbm9kZV9tb2R1bGVzL2llZWU3NTQvaW5kZXguanMiLCIuLi8uLi9BcHBEYXRhL1JvYW1pbmcvbnBtL25vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9idWZmZXIvbm9kZV9tb2R1bGVzL2lzLWFycmF5L2luZGV4LmpzIiwiLi4vLi4vQXBwRGF0YS9Sb2FtaW5nL25wbS9ub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvcHJvY2Vzcy9icm93c2VyLmpzIiwianMvYXBwL0FkbWluLmpzIiwianMvYXBwL0NvbmZpZy5qcyIsImpzL2FwcC9HVUkuanMiLCJqcy9hcHAvTGl2ZVN0cmVhbS5qcyIsImpzL2FwcC9QYXJ0aWNpcGFudC5qcyIsImpzL2FwcC9Qb2ludC5qcyIsImpzL2FwcC9TdHlsZXMuanMiLCJqcy9hcHAvVHJhY2suanMiLCJqcy9hcHAvVXRpbHMuanMiLCJub2RlX21vZHVsZXMvam9vc2Uvam9vc2UtYWxsLmpzIiwibm9kZV9tb2R1bGVzL3JidXNoL3JidXNoLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBO0FDQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDNzVDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzVIQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNwRkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDakNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzFGQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdFJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2xIQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3RpQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM1SEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2p1QkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdkNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNqZkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7OztBQ3haQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7OztBQzlqQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7OztBQ2pwR0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EiLCJmaWxlIjoiZ2VuZXJhdGVkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXNDb250ZW50IjpbIihmdW5jdGlvbiBlKHQsbixyKXtmdW5jdGlvbiBzKG8sdSl7aWYoIW5bb10pe2lmKCF0W29dKXt2YXIgYT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2lmKCF1JiZhKXJldHVybiBhKG8sITApO2lmKGkpcmV0dXJuIGkobywhMCk7dmFyIGY9bmV3IEVycm9yKFwiQ2Fubm90IGZpbmQgbW9kdWxlICdcIitvK1wiJ1wiKTt0aHJvdyBmLmNvZGU9XCJNT0RVTEVfTk9UX0ZPVU5EXCIsZn12YXIgbD1uW29dPXtleHBvcnRzOnt9fTt0W29dWzBdLmNhbGwobC5leHBvcnRzLGZ1bmN0aW9uKGUpe3ZhciBuPXRbb11bMV1bZV07cmV0dXJuIHMobj9uOmUpfSxsLGwuZXhwb3J0cyxlLHQsbixyKX1yZXR1cm4gbltvXS5leHBvcnRzfXZhciBpPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7Zm9yKHZhciBvPTA7bzxyLmxlbmd0aDtvKyspcyhyW29dKTtyZXR1cm4gc30pIiwiLyohXG4gKiBUaGUgYnVmZmVyIG1vZHVsZSBmcm9tIG5vZGUuanMsIGZvciB0aGUgYnJvd3Nlci5cbiAqXG4gKiBAYXV0aG9yICAgRmVyb3NzIEFib3VraGFkaWplaCA8ZmVyb3NzQGZlcm9zcy5vcmc+IDxodHRwOi8vZmVyb3NzLm9yZz5cbiAqIEBsaWNlbnNlICBNSVRcbiAqL1xuXG52YXIgYmFzZTY0ID0gcmVxdWlyZSgnYmFzZTY0LWpzJylcbnZhciBpZWVlNzU0ID0gcmVxdWlyZSgnaWVlZTc1NCcpXG52YXIgaXNBcnJheSA9IHJlcXVpcmUoJ2lzLWFycmF5JylcblxuZXhwb3J0cy5CdWZmZXIgPSBCdWZmZXJcbmV4cG9ydHMuU2xvd0J1ZmZlciA9IFNsb3dCdWZmZXJcbmV4cG9ydHMuSU5TUEVDVF9NQVhfQllURVMgPSA1MFxuQnVmZmVyLnBvb2xTaXplID0gODE5MiAvLyBub3QgdXNlZCBieSB0aGlzIGltcGxlbWVudGF0aW9uXG5cbnZhciByb290UGFyZW50ID0ge31cblxuLyoqXG4gKiBJZiBgQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlRgOlxuICogICA9PT0gdHJ1ZSAgICBVc2UgVWludDhBcnJheSBpbXBsZW1lbnRhdGlvbiAoZmFzdGVzdClcbiAqICAgPT09IGZhbHNlICAgVXNlIE9iamVjdCBpbXBsZW1lbnRhdGlvbiAobW9zdCBjb21wYXRpYmxlLCBldmVuIElFNilcbiAqXG4gKiBCcm93c2VycyB0aGF0IHN1cHBvcnQgdHlwZWQgYXJyYXlzIGFyZSBJRSAxMCssIEZpcmVmb3ggNCssIENocm9tZSA3KywgU2FmYXJpIDUuMSssXG4gKiBPcGVyYSAxMS42KywgaU9TIDQuMisuXG4gKlxuICogTm90ZTpcbiAqXG4gKiAtIEltcGxlbWVudGF0aW9uIG11c3Qgc3VwcG9ydCBhZGRpbmcgbmV3IHByb3BlcnRpZXMgdG8gYFVpbnQ4QXJyYXlgIGluc3RhbmNlcy5cbiAqICAgRmlyZWZveCA0LTI5IGxhY2tlZCBzdXBwb3J0LCBmaXhlZCBpbiBGaXJlZm94IDMwKy5cbiAqICAgU2VlOiBodHRwczovL2J1Z3ppbGxhLm1vemlsbGEub3JnL3Nob3dfYnVnLmNnaT9pZD02OTU0MzguXG4gKlxuICogIC0gQ2hyb21lIDktMTAgaXMgbWlzc2luZyB0aGUgYFR5cGVkQXJyYXkucHJvdG90eXBlLnN1YmFycmF5YCBmdW5jdGlvbi5cbiAqXG4gKiAgLSBJRTEwIGhhcyBhIGJyb2tlbiBgVHlwZWRBcnJheS5wcm90b3R5cGUuc3ViYXJyYXlgIGZ1bmN0aW9uIHdoaWNoIHJldHVybnMgYXJyYXlzIG9mXG4gKiAgICBpbmNvcnJlY3QgbGVuZ3RoIGluIHNvbWUgc2l0dWF0aW9ucy5cbiAqXG4gKiBXZSBkZXRlY3QgdGhlc2UgYnVnZ3kgYnJvd3NlcnMgYW5kIHNldCBgQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlRgIHRvIGBmYWxzZWAgc28gdGhleSB3aWxsXG4gKiBnZXQgdGhlIE9iamVjdCBpbXBsZW1lbnRhdGlvbiwgd2hpY2ggaXMgc2xvd2VyIGJ1dCB3aWxsIHdvcmsgY29ycmVjdGx5LlxuICovXG5CdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCA9IChmdW5jdGlvbiAoKSB7XG4gIGZ1bmN0aW9uIEZvbyAoKSB7fVxuICB0cnkge1xuICAgIHZhciBidWYgPSBuZXcgQXJyYXlCdWZmZXIoMClcbiAgICB2YXIgYXJyID0gbmV3IFVpbnQ4QXJyYXkoYnVmKVxuICAgIGFyci5mb28gPSBmdW5jdGlvbiAoKSB7IHJldHVybiA0MiB9XG4gICAgYXJyLmNvbnN0cnVjdG9yID0gRm9vXG4gICAgcmV0dXJuIGFyci5mb28oKSA9PT0gNDIgJiYgLy8gdHlwZWQgYXJyYXkgaW5zdGFuY2VzIGNhbiBiZSBhdWdtZW50ZWRcbiAgICAgICAgYXJyLmNvbnN0cnVjdG9yID09PSBGb28gJiYgLy8gY29uc3RydWN0b3IgY2FuIGJlIHNldFxuICAgICAgICB0eXBlb2YgYXJyLnN1YmFycmF5ID09PSAnZnVuY3Rpb24nICYmIC8vIGNocm9tZSA5LTEwIGxhY2sgYHN1YmFycmF5YFxuICAgICAgICBuZXcgVWludDhBcnJheSgxKS5zdWJhcnJheSgxLCAxKS5ieXRlTGVuZ3RoID09PSAwIC8vIGllMTAgaGFzIGJyb2tlbiBgc3ViYXJyYXlgXG4gIH0gY2F0Y2ggKGUpIHtcbiAgICByZXR1cm4gZmFsc2VcbiAgfVxufSkoKVxuXG5mdW5jdGlvbiBrTWF4TGVuZ3RoICgpIHtcbiAgcmV0dXJuIEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUXG4gICAgPyAweDdmZmZmZmZmXG4gICAgOiAweDNmZmZmZmZmXG59XG5cbi8qKlxuICogQ2xhc3M6IEJ1ZmZlclxuICogPT09PT09PT09PT09PVxuICpcbiAqIFRoZSBCdWZmZXIgY29uc3RydWN0b3IgcmV0dXJucyBpbnN0YW5jZXMgb2YgYFVpbnQ4QXJyYXlgIHRoYXQgYXJlIGF1Z21lbnRlZFxuICogd2l0aCBmdW5jdGlvbiBwcm9wZXJ0aWVzIGZvciBhbGwgdGhlIG5vZGUgYEJ1ZmZlcmAgQVBJIGZ1bmN0aW9ucy4gV2UgdXNlXG4gKiBgVWludDhBcnJheWAgc28gdGhhdCBzcXVhcmUgYnJhY2tldCBub3RhdGlvbiB3b3JrcyBhcyBleHBlY3RlZCAtLSBpdCByZXR1cm5zXG4gKiBhIHNpbmdsZSBvY3RldC5cbiAqXG4gKiBCeSBhdWdtZW50aW5nIHRoZSBpbnN0YW5jZXMsIHdlIGNhbiBhdm9pZCBtb2RpZnlpbmcgdGhlIGBVaW50OEFycmF5YFxuICogcHJvdG90eXBlLlxuICovXG5mdW5jdGlvbiBCdWZmZXIgKGFyZykge1xuICBpZiAoISh0aGlzIGluc3RhbmNlb2YgQnVmZmVyKSkge1xuICAgIC8vIEF2b2lkIGdvaW5nIHRocm91Z2ggYW4gQXJndW1lbnRzQWRhcHRvclRyYW1wb2xpbmUgaW4gdGhlIGNvbW1vbiBjYXNlLlxuICAgIGlmIChhcmd1bWVudHMubGVuZ3RoID4gMSkgcmV0dXJuIG5ldyBCdWZmZXIoYXJnLCBhcmd1bWVudHNbMV0pXG4gICAgcmV0dXJuIG5ldyBCdWZmZXIoYXJnKVxuICB9XG5cbiAgdGhpcy5sZW5ndGggPSAwXG4gIHRoaXMucGFyZW50ID0gdW5kZWZpbmVkXG5cbiAgLy8gQ29tbW9uIGNhc2UuXG4gIGlmICh0eXBlb2YgYXJnID09PSAnbnVtYmVyJykge1xuICAgIHJldHVybiBmcm9tTnVtYmVyKHRoaXMsIGFyZylcbiAgfVxuXG4gIC8vIFNsaWdodGx5IGxlc3MgY29tbW9uIGNhc2UuXG4gIGlmICh0eXBlb2YgYXJnID09PSAnc3RyaW5nJykge1xuICAgIHJldHVybiBmcm9tU3RyaW5nKHRoaXMsIGFyZywgYXJndW1lbnRzLmxlbmd0aCA+IDEgPyBhcmd1bWVudHNbMV0gOiAndXRmOCcpXG4gIH1cblxuICAvLyBVbnVzdWFsLlxuICByZXR1cm4gZnJvbU9iamVjdCh0aGlzLCBhcmcpXG59XG5cbmZ1bmN0aW9uIGZyb21OdW1iZXIgKHRoYXQsIGxlbmd0aCkge1xuICB0aGF0ID0gYWxsb2NhdGUodGhhdCwgbGVuZ3RoIDwgMCA/IDAgOiBjaGVja2VkKGxlbmd0aCkgfCAwKVxuICBpZiAoIUJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW5ndGg7IGkrKykge1xuICAgICAgdGhhdFtpXSA9IDBcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHRoYXRcbn1cblxuZnVuY3Rpb24gZnJvbVN0cmluZyAodGhhdCwgc3RyaW5nLCBlbmNvZGluZykge1xuICBpZiAodHlwZW9mIGVuY29kaW5nICE9PSAnc3RyaW5nJyB8fCBlbmNvZGluZyA9PT0gJycpIGVuY29kaW5nID0gJ3V0ZjgnXG5cbiAgLy8gQXNzdW1wdGlvbjogYnl0ZUxlbmd0aCgpIHJldHVybiB2YWx1ZSBpcyBhbHdheXMgPCBrTWF4TGVuZ3RoLlxuICB2YXIgbGVuZ3RoID0gYnl0ZUxlbmd0aChzdHJpbmcsIGVuY29kaW5nKSB8IDBcbiAgdGhhdCA9IGFsbG9jYXRlKHRoYXQsIGxlbmd0aClcblxuICB0aGF0LndyaXRlKHN0cmluZywgZW5jb2RpbmcpXG4gIHJldHVybiB0aGF0XG59XG5cbmZ1bmN0aW9uIGZyb21PYmplY3QgKHRoYXQsIG9iamVjdCkge1xuICBpZiAoQnVmZmVyLmlzQnVmZmVyKG9iamVjdCkpIHJldHVybiBmcm9tQnVmZmVyKHRoYXQsIG9iamVjdClcblxuICBpZiAoaXNBcnJheShvYmplY3QpKSByZXR1cm4gZnJvbUFycmF5KHRoYXQsIG9iamVjdClcblxuICBpZiAob2JqZWN0ID09IG51bGwpIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdtdXN0IHN0YXJ0IHdpdGggbnVtYmVyLCBidWZmZXIsIGFycmF5IG9yIHN0cmluZycpXG4gIH1cblxuICBpZiAodHlwZW9mIEFycmF5QnVmZmVyICE9PSAndW5kZWZpbmVkJyAmJiBvYmplY3QuYnVmZmVyIGluc3RhbmNlb2YgQXJyYXlCdWZmZXIpIHtcbiAgICByZXR1cm4gZnJvbVR5cGVkQXJyYXkodGhhdCwgb2JqZWN0KVxuICB9XG5cbiAgaWYgKG9iamVjdC5sZW5ndGgpIHJldHVybiBmcm9tQXJyYXlMaWtlKHRoYXQsIG9iamVjdClcblxuICByZXR1cm4gZnJvbUpzb25PYmplY3QodGhhdCwgb2JqZWN0KVxufVxuXG5mdW5jdGlvbiBmcm9tQnVmZmVyICh0aGF0LCBidWZmZXIpIHtcbiAgdmFyIGxlbmd0aCA9IGNoZWNrZWQoYnVmZmVyLmxlbmd0aCkgfCAwXG4gIHRoYXQgPSBhbGxvY2F0ZSh0aGF0LCBsZW5ndGgpXG4gIGJ1ZmZlci5jb3B5KHRoYXQsIDAsIDAsIGxlbmd0aClcbiAgcmV0dXJuIHRoYXRcbn1cblxuZnVuY3Rpb24gZnJvbUFycmF5ICh0aGF0LCBhcnJheSkge1xuICB2YXIgbGVuZ3RoID0gY2hlY2tlZChhcnJheS5sZW5ndGgpIHwgMFxuICB0aGF0ID0gYWxsb2NhdGUodGhhdCwgbGVuZ3RoKVxuICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbmd0aDsgaSArPSAxKSB7XG4gICAgdGhhdFtpXSA9IGFycmF5W2ldICYgMjU1XG4gIH1cbiAgcmV0dXJuIHRoYXRcbn1cblxuLy8gRHVwbGljYXRlIG9mIGZyb21BcnJheSgpIHRvIGtlZXAgZnJvbUFycmF5KCkgbW9ub21vcnBoaWMuXG5mdW5jdGlvbiBmcm9tVHlwZWRBcnJheSAodGhhdCwgYXJyYXkpIHtcbiAgdmFyIGxlbmd0aCA9IGNoZWNrZWQoYXJyYXkubGVuZ3RoKSB8IDBcbiAgdGhhdCA9IGFsbG9jYXRlKHRoYXQsIGxlbmd0aClcbiAgLy8gVHJ1bmNhdGluZyB0aGUgZWxlbWVudHMgaXMgcHJvYmFibHkgbm90IHdoYXQgcGVvcGxlIGV4cGVjdCBmcm9tIHR5cGVkXG4gIC8vIGFycmF5cyB3aXRoIEJZVEVTX1BFUl9FTEVNRU5UID4gMSBidXQgaXQncyBjb21wYXRpYmxlIHdpdGggdGhlIGJlaGF2aW9yXG4gIC8vIG9mIHRoZSBvbGQgQnVmZmVyIGNvbnN0cnVjdG9yLlxuICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbmd0aDsgaSArPSAxKSB7XG4gICAgdGhhdFtpXSA9IGFycmF5W2ldICYgMjU1XG4gIH1cbiAgcmV0dXJuIHRoYXRcbn1cblxuZnVuY3Rpb24gZnJvbUFycmF5TGlrZSAodGhhdCwgYXJyYXkpIHtcbiAgdmFyIGxlbmd0aCA9IGNoZWNrZWQoYXJyYXkubGVuZ3RoKSB8IDBcbiAgdGhhdCA9IGFsbG9jYXRlKHRoYXQsIGxlbmd0aClcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW5ndGg7IGkgKz0gMSkge1xuICAgIHRoYXRbaV0gPSBhcnJheVtpXSAmIDI1NVxuICB9XG4gIHJldHVybiB0aGF0XG59XG5cbi8vIERlc2VyaWFsaXplIHsgdHlwZTogJ0J1ZmZlcicsIGRhdGE6IFsxLDIsMywuLi5dIH0gaW50byBhIEJ1ZmZlciBvYmplY3QuXG4vLyBSZXR1cm5zIGEgemVyby1sZW5ndGggYnVmZmVyIGZvciBpbnB1dHMgdGhhdCBkb24ndCBjb25mb3JtIHRvIHRoZSBzcGVjLlxuZnVuY3Rpb24gZnJvbUpzb25PYmplY3QgKHRoYXQsIG9iamVjdCkge1xuICB2YXIgYXJyYXlcbiAgdmFyIGxlbmd0aCA9IDBcblxuICBpZiAob2JqZWN0LnR5cGUgPT09ICdCdWZmZXInICYmIGlzQXJyYXkob2JqZWN0LmRhdGEpKSB7XG4gICAgYXJyYXkgPSBvYmplY3QuZGF0YVxuICAgIGxlbmd0aCA9IGNoZWNrZWQoYXJyYXkubGVuZ3RoKSB8IDBcbiAgfVxuICB0aGF0ID0gYWxsb2NhdGUodGhhdCwgbGVuZ3RoKVxuXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuZ3RoOyBpICs9IDEpIHtcbiAgICB0aGF0W2ldID0gYXJyYXlbaV0gJiAyNTVcbiAgfVxuICByZXR1cm4gdGhhdFxufVxuXG5mdW5jdGlvbiBhbGxvY2F0ZSAodGhhdCwgbGVuZ3RoKSB7XG4gIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIC8vIFJldHVybiBhbiBhdWdtZW50ZWQgYFVpbnQ4QXJyYXlgIGluc3RhbmNlLCBmb3IgYmVzdCBwZXJmb3JtYW5jZVxuICAgIHRoYXQgPSBCdWZmZXIuX2F1Z21lbnQobmV3IFVpbnQ4QXJyYXkobGVuZ3RoKSlcbiAgfSBlbHNlIHtcbiAgICAvLyBGYWxsYmFjazogUmV0dXJuIGFuIG9iamVjdCBpbnN0YW5jZSBvZiB0aGUgQnVmZmVyIGNsYXNzXG4gICAgdGhhdC5sZW5ndGggPSBsZW5ndGhcbiAgICB0aGF0Ll9pc0J1ZmZlciA9IHRydWVcbiAgfVxuXG4gIHZhciBmcm9tUG9vbCA9IGxlbmd0aCAhPT0gMCAmJiBsZW5ndGggPD0gQnVmZmVyLnBvb2xTaXplID4+PiAxXG4gIGlmIChmcm9tUG9vbCkgdGhhdC5wYXJlbnQgPSByb290UGFyZW50XG5cbiAgcmV0dXJuIHRoYXRcbn1cblxuZnVuY3Rpb24gY2hlY2tlZCAobGVuZ3RoKSB7XG4gIC8vIE5vdGU6IGNhbm5vdCB1c2UgYGxlbmd0aCA8IGtNYXhMZW5ndGhgIGhlcmUgYmVjYXVzZSB0aGF0IGZhaWxzIHdoZW5cbiAgLy8gbGVuZ3RoIGlzIE5hTiAod2hpY2ggaXMgb3RoZXJ3aXNlIGNvZXJjZWQgdG8gemVyby4pXG4gIGlmIChsZW5ndGggPj0ga01heExlbmd0aCgpKSB7XG4gICAgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ0F0dGVtcHQgdG8gYWxsb2NhdGUgQnVmZmVyIGxhcmdlciB0aGFuIG1heGltdW0gJyArXG4gICAgICAgICAgICAgICAgICAgICAgICAgJ3NpemU6IDB4JyArIGtNYXhMZW5ndGgoKS50b1N0cmluZygxNikgKyAnIGJ5dGVzJylcbiAgfVxuICByZXR1cm4gbGVuZ3RoIHwgMFxufVxuXG5mdW5jdGlvbiBTbG93QnVmZmVyIChzdWJqZWN0LCBlbmNvZGluZykge1xuICBpZiAoISh0aGlzIGluc3RhbmNlb2YgU2xvd0J1ZmZlcikpIHJldHVybiBuZXcgU2xvd0J1ZmZlcihzdWJqZWN0LCBlbmNvZGluZylcblxuICB2YXIgYnVmID0gbmV3IEJ1ZmZlcihzdWJqZWN0LCBlbmNvZGluZylcbiAgZGVsZXRlIGJ1Zi5wYXJlbnRcbiAgcmV0dXJuIGJ1ZlxufVxuXG5CdWZmZXIuaXNCdWZmZXIgPSBmdW5jdGlvbiBpc0J1ZmZlciAoYikge1xuICByZXR1cm4gISEoYiAhPSBudWxsICYmIGIuX2lzQnVmZmVyKVxufVxuXG5CdWZmZXIuY29tcGFyZSA9IGZ1bmN0aW9uIGNvbXBhcmUgKGEsIGIpIHtcbiAgaWYgKCFCdWZmZXIuaXNCdWZmZXIoYSkgfHwgIUJ1ZmZlci5pc0J1ZmZlcihiKSkge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ0FyZ3VtZW50cyBtdXN0IGJlIEJ1ZmZlcnMnKVxuICB9XG5cbiAgaWYgKGEgPT09IGIpIHJldHVybiAwXG5cbiAgdmFyIHggPSBhLmxlbmd0aFxuICB2YXIgeSA9IGIubGVuZ3RoXG5cbiAgdmFyIGkgPSAwXG4gIHZhciBsZW4gPSBNYXRoLm1pbih4LCB5KVxuICB3aGlsZSAoaSA8IGxlbikge1xuICAgIGlmIChhW2ldICE9PSBiW2ldKSBicmVha1xuXG4gICAgKytpXG4gIH1cblxuICBpZiAoaSAhPT0gbGVuKSB7XG4gICAgeCA9IGFbaV1cbiAgICB5ID0gYltpXVxuICB9XG5cbiAgaWYgKHggPCB5KSByZXR1cm4gLTFcbiAgaWYgKHkgPCB4KSByZXR1cm4gMVxuICByZXR1cm4gMFxufVxuXG5CdWZmZXIuaXNFbmNvZGluZyA9IGZ1bmN0aW9uIGlzRW5jb2RpbmcgKGVuY29kaW5nKSB7XG4gIHN3aXRjaCAoU3RyaW5nKGVuY29kaW5nKS50b0xvd2VyQ2FzZSgpKSB7XG4gICAgY2FzZSAnaGV4JzpcbiAgICBjYXNlICd1dGY4JzpcbiAgICBjYXNlICd1dGYtOCc6XG4gICAgY2FzZSAnYXNjaWknOlxuICAgIGNhc2UgJ2JpbmFyeSc6XG4gICAgY2FzZSAnYmFzZTY0JzpcbiAgICBjYXNlICdyYXcnOlxuICAgIGNhc2UgJ3VjczInOlxuICAgIGNhc2UgJ3Vjcy0yJzpcbiAgICBjYXNlICd1dGYxNmxlJzpcbiAgICBjYXNlICd1dGYtMTZsZSc6XG4gICAgICByZXR1cm4gdHJ1ZVxuICAgIGRlZmF1bHQ6XG4gICAgICByZXR1cm4gZmFsc2VcbiAgfVxufVxuXG5CdWZmZXIuY29uY2F0ID0gZnVuY3Rpb24gY29uY2F0IChsaXN0LCBsZW5ndGgpIHtcbiAgaWYgKCFpc0FycmF5KGxpc3QpKSB0aHJvdyBuZXcgVHlwZUVycm9yKCdsaXN0IGFyZ3VtZW50IG11c3QgYmUgYW4gQXJyYXkgb2YgQnVmZmVycy4nKVxuXG4gIGlmIChsaXN0Lmxlbmd0aCA9PT0gMCkge1xuICAgIHJldHVybiBuZXcgQnVmZmVyKDApXG4gIH0gZWxzZSBpZiAobGlzdC5sZW5ndGggPT09IDEpIHtcbiAgICByZXR1cm4gbGlzdFswXVxuICB9XG5cbiAgdmFyIGlcbiAgaWYgKGxlbmd0aCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgbGVuZ3RoID0gMFxuICAgIGZvciAoaSA9IDA7IGkgPCBsaXN0Lmxlbmd0aDsgaSsrKSB7XG4gICAgICBsZW5ndGggKz0gbGlzdFtpXS5sZW5ndGhcbiAgICB9XG4gIH1cblxuICB2YXIgYnVmID0gbmV3IEJ1ZmZlcihsZW5ndGgpXG4gIHZhciBwb3MgPSAwXG4gIGZvciAoaSA9IDA7IGkgPCBsaXN0Lmxlbmd0aDsgaSsrKSB7XG4gICAgdmFyIGl0ZW0gPSBsaXN0W2ldXG4gICAgaXRlbS5jb3B5KGJ1ZiwgcG9zKVxuICAgIHBvcyArPSBpdGVtLmxlbmd0aFxuICB9XG4gIHJldHVybiBidWZcbn1cblxuZnVuY3Rpb24gYnl0ZUxlbmd0aCAoc3RyaW5nLCBlbmNvZGluZykge1xuICBpZiAodHlwZW9mIHN0cmluZyAhPT0gJ3N0cmluZycpIHN0cmluZyA9ICcnICsgc3RyaW5nXG5cbiAgdmFyIGxlbiA9IHN0cmluZy5sZW5ndGhcbiAgaWYgKGxlbiA9PT0gMCkgcmV0dXJuIDBcblxuICAvLyBVc2UgYSBmb3IgbG9vcCB0byBhdm9pZCByZWN1cnNpb25cbiAgdmFyIGxvd2VyZWRDYXNlID0gZmFsc2VcbiAgZm9yICg7Oykge1xuICAgIHN3aXRjaCAoZW5jb2RpbmcpIHtcbiAgICAgIGNhc2UgJ2FzY2lpJzpcbiAgICAgIGNhc2UgJ2JpbmFyeSc6XG4gICAgICAvLyBEZXByZWNhdGVkXG4gICAgICBjYXNlICdyYXcnOlxuICAgICAgY2FzZSAncmF3cyc6XG4gICAgICAgIHJldHVybiBsZW5cbiAgICAgIGNhc2UgJ3V0ZjgnOlxuICAgICAgY2FzZSAndXRmLTgnOlxuICAgICAgICByZXR1cm4gdXRmOFRvQnl0ZXMoc3RyaW5nKS5sZW5ndGhcbiAgICAgIGNhc2UgJ3VjczInOlxuICAgICAgY2FzZSAndWNzLTInOlxuICAgICAgY2FzZSAndXRmMTZsZSc6XG4gICAgICBjYXNlICd1dGYtMTZsZSc6XG4gICAgICAgIHJldHVybiBsZW4gKiAyXG4gICAgICBjYXNlICdoZXgnOlxuICAgICAgICByZXR1cm4gbGVuID4+PiAxXG4gICAgICBjYXNlICdiYXNlNjQnOlxuICAgICAgICByZXR1cm4gYmFzZTY0VG9CeXRlcyhzdHJpbmcpLmxlbmd0aFxuICAgICAgZGVmYXVsdDpcbiAgICAgICAgaWYgKGxvd2VyZWRDYXNlKSByZXR1cm4gdXRmOFRvQnl0ZXMoc3RyaW5nKS5sZW5ndGggLy8gYXNzdW1lIHV0ZjhcbiAgICAgICAgZW5jb2RpbmcgPSAoJycgKyBlbmNvZGluZykudG9Mb3dlckNhc2UoKVxuICAgICAgICBsb3dlcmVkQ2FzZSA9IHRydWVcbiAgICB9XG4gIH1cbn1cbkJ1ZmZlci5ieXRlTGVuZ3RoID0gYnl0ZUxlbmd0aFxuXG4vLyBwcmUtc2V0IGZvciB2YWx1ZXMgdGhhdCBtYXkgZXhpc3QgaW4gdGhlIGZ1dHVyZVxuQnVmZmVyLnByb3RvdHlwZS5sZW5ndGggPSB1bmRlZmluZWRcbkJ1ZmZlci5wcm90b3R5cGUucGFyZW50ID0gdW5kZWZpbmVkXG5cbmZ1bmN0aW9uIHNsb3dUb1N0cmluZyAoZW5jb2RpbmcsIHN0YXJ0LCBlbmQpIHtcbiAgdmFyIGxvd2VyZWRDYXNlID0gZmFsc2VcblxuICBzdGFydCA9IHN0YXJ0IHwgMFxuICBlbmQgPSBlbmQgPT09IHVuZGVmaW5lZCB8fCBlbmQgPT09IEluZmluaXR5ID8gdGhpcy5sZW5ndGggOiBlbmQgfCAwXG5cbiAgaWYgKCFlbmNvZGluZykgZW5jb2RpbmcgPSAndXRmOCdcbiAgaWYgKHN0YXJ0IDwgMCkgc3RhcnQgPSAwXG4gIGlmIChlbmQgPiB0aGlzLmxlbmd0aCkgZW5kID0gdGhpcy5sZW5ndGhcbiAgaWYgKGVuZCA8PSBzdGFydCkgcmV0dXJuICcnXG5cbiAgd2hpbGUgKHRydWUpIHtcbiAgICBzd2l0Y2ggKGVuY29kaW5nKSB7XG4gICAgICBjYXNlICdoZXgnOlxuICAgICAgICByZXR1cm4gaGV4U2xpY2UodGhpcywgc3RhcnQsIGVuZClcblxuICAgICAgY2FzZSAndXRmOCc6XG4gICAgICBjYXNlICd1dGYtOCc6XG4gICAgICAgIHJldHVybiB1dGY4U2xpY2UodGhpcywgc3RhcnQsIGVuZClcblxuICAgICAgY2FzZSAnYXNjaWknOlxuICAgICAgICByZXR1cm4gYXNjaWlTbGljZSh0aGlzLCBzdGFydCwgZW5kKVxuXG4gICAgICBjYXNlICdiaW5hcnknOlxuICAgICAgICByZXR1cm4gYmluYXJ5U2xpY2UodGhpcywgc3RhcnQsIGVuZClcblxuICAgICAgY2FzZSAnYmFzZTY0JzpcbiAgICAgICAgcmV0dXJuIGJhc2U2NFNsaWNlKHRoaXMsIHN0YXJ0LCBlbmQpXG5cbiAgICAgIGNhc2UgJ3VjczInOlxuICAgICAgY2FzZSAndWNzLTInOlxuICAgICAgY2FzZSAndXRmMTZsZSc6XG4gICAgICBjYXNlICd1dGYtMTZsZSc6XG4gICAgICAgIHJldHVybiB1dGYxNmxlU2xpY2UodGhpcywgc3RhcnQsIGVuZClcblxuICAgICAgZGVmYXVsdDpcbiAgICAgICAgaWYgKGxvd2VyZWRDYXNlKSB0aHJvdyBuZXcgVHlwZUVycm9yKCdVbmtub3duIGVuY29kaW5nOiAnICsgZW5jb2RpbmcpXG4gICAgICAgIGVuY29kaW5nID0gKGVuY29kaW5nICsgJycpLnRvTG93ZXJDYXNlKClcbiAgICAgICAgbG93ZXJlZENhc2UgPSB0cnVlXG4gICAgfVxuICB9XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUudG9TdHJpbmcgPSBmdW5jdGlvbiB0b1N0cmluZyAoKSB7XG4gIHZhciBsZW5ndGggPSB0aGlzLmxlbmd0aCB8IDBcbiAgaWYgKGxlbmd0aCA9PT0gMCkgcmV0dXJuICcnXG4gIGlmIChhcmd1bWVudHMubGVuZ3RoID09PSAwKSByZXR1cm4gdXRmOFNsaWNlKHRoaXMsIDAsIGxlbmd0aClcbiAgcmV0dXJuIHNsb3dUb1N0cmluZy5hcHBseSh0aGlzLCBhcmd1bWVudHMpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUuZXF1YWxzID0gZnVuY3Rpb24gZXF1YWxzIChiKSB7XG4gIGlmICghQnVmZmVyLmlzQnVmZmVyKGIpKSB0aHJvdyBuZXcgVHlwZUVycm9yKCdBcmd1bWVudCBtdXN0IGJlIGEgQnVmZmVyJylcbiAgaWYgKHRoaXMgPT09IGIpIHJldHVybiB0cnVlXG4gIHJldHVybiBCdWZmZXIuY29tcGFyZSh0aGlzLCBiKSA9PT0gMFxufVxuXG5CdWZmZXIucHJvdG90eXBlLmluc3BlY3QgPSBmdW5jdGlvbiBpbnNwZWN0ICgpIHtcbiAgdmFyIHN0ciA9ICcnXG4gIHZhciBtYXggPSBleHBvcnRzLklOU1BFQ1RfTUFYX0JZVEVTXG4gIGlmICh0aGlzLmxlbmd0aCA+IDApIHtcbiAgICBzdHIgPSB0aGlzLnRvU3RyaW5nKCdoZXgnLCAwLCBtYXgpLm1hdGNoKC8uezJ9L2cpLmpvaW4oJyAnKVxuICAgIGlmICh0aGlzLmxlbmd0aCA+IG1heCkgc3RyICs9ICcgLi4uICdcbiAgfVxuICByZXR1cm4gJzxCdWZmZXIgJyArIHN0ciArICc+J1xufVxuXG5CdWZmZXIucHJvdG90eXBlLmNvbXBhcmUgPSBmdW5jdGlvbiBjb21wYXJlIChiKSB7XG4gIGlmICghQnVmZmVyLmlzQnVmZmVyKGIpKSB0aHJvdyBuZXcgVHlwZUVycm9yKCdBcmd1bWVudCBtdXN0IGJlIGEgQnVmZmVyJylcbiAgaWYgKHRoaXMgPT09IGIpIHJldHVybiAwXG4gIHJldHVybiBCdWZmZXIuY29tcGFyZSh0aGlzLCBiKVxufVxuXG5CdWZmZXIucHJvdG90eXBlLmluZGV4T2YgPSBmdW5jdGlvbiBpbmRleE9mICh2YWwsIGJ5dGVPZmZzZXQpIHtcbiAgaWYgKGJ5dGVPZmZzZXQgPiAweDdmZmZmZmZmKSBieXRlT2Zmc2V0ID0gMHg3ZmZmZmZmZlxuICBlbHNlIGlmIChieXRlT2Zmc2V0IDwgLTB4ODAwMDAwMDApIGJ5dGVPZmZzZXQgPSAtMHg4MDAwMDAwMFxuICBieXRlT2Zmc2V0ID4+PSAwXG5cbiAgaWYgKHRoaXMubGVuZ3RoID09PSAwKSByZXR1cm4gLTFcbiAgaWYgKGJ5dGVPZmZzZXQgPj0gdGhpcy5sZW5ndGgpIHJldHVybiAtMVxuXG4gIC8vIE5lZ2F0aXZlIG9mZnNldHMgc3RhcnQgZnJvbSB0aGUgZW5kIG9mIHRoZSBidWZmZXJcbiAgaWYgKGJ5dGVPZmZzZXQgPCAwKSBieXRlT2Zmc2V0ID0gTWF0aC5tYXgodGhpcy5sZW5ndGggKyBieXRlT2Zmc2V0LCAwKVxuXG4gIGlmICh0eXBlb2YgdmFsID09PSAnc3RyaW5nJykge1xuICAgIGlmICh2YWwubGVuZ3RoID09PSAwKSByZXR1cm4gLTEgLy8gc3BlY2lhbCBjYXNlOiBsb29raW5nIGZvciBlbXB0eSBzdHJpbmcgYWx3YXlzIGZhaWxzXG4gICAgcmV0dXJuIFN0cmluZy5wcm90b3R5cGUuaW5kZXhPZi5jYWxsKHRoaXMsIHZhbCwgYnl0ZU9mZnNldClcbiAgfVxuICBpZiAoQnVmZmVyLmlzQnVmZmVyKHZhbCkpIHtcbiAgICByZXR1cm4gYXJyYXlJbmRleE9mKHRoaXMsIHZhbCwgYnl0ZU9mZnNldClcbiAgfVxuICBpZiAodHlwZW9mIHZhbCA9PT0gJ251bWJlcicpIHtcbiAgICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQgJiYgVWludDhBcnJheS5wcm90b3R5cGUuaW5kZXhPZiA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgcmV0dXJuIFVpbnQ4QXJyYXkucHJvdG90eXBlLmluZGV4T2YuY2FsbCh0aGlzLCB2YWwsIGJ5dGVPZmZzZXQpXG4gICAgfVxuICAgIHJldHVybiBhcnJheUluZGV4T2YodGhpcywgWyB2YWwgXSwgYnl0ZU9mZnNldClcbiAgfVxuXG4gIGZ1bmN0aW9uIGFycmF5SW5kZXhPZiAoYXJyLCB2YWwsIGJ5dGVPZmZzZXQpIHtcbiAgICB2YXIgZm91bmRJbmRleCA9IC0xXG4gICAgZm9yICh2YXIgaSA9IDA7IGJ5dGVPZmZzZXQgKyBpIDwgYXJyLmxlbmd0aDsgaSsrKSB7XG4gICAgICBpZiAoYXJyW2J5dGVPZmZzZXQgKyBpXSA9PT0gdmFsW2ZvdW5kSW5kZXggPT09IC0xID8gMCA6IGkgLSBmb3VuZEluZGV4XSkge1xuICAgICAgICBpZiAoZm91bmRJbmRleCA9PT0gLTEpIGZvdW5kSW5kZXggPSBpXG4gICAgICAgIGlmIChpIC0gZm91bmRJbmRleCArIDEgPT09IHZhbC5sZW5ndGgpIHJldHVybiBieXRlT2Zmc2V0ICsgZm91bmRJbmRleFxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgZm91bmRJbmRleCA9IC0xXG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiAtMVxuICB9XG5cbiAgdGhyb3cgbmV3IFR5cGVFcnJvcigndmFsIG11c3QgYmUgc3RyaW5nLCBudW1iZXIgb3IgQnVmZmVyJylcbn1cblxuLy8gYGdldGAgd2lsbCBiZSByZW1vdmVkIGluIE5vZGUgMC4xMytcbkJ1ZmZlci5wcm90b3R5cGUuZ2V0ID0gZnVuY3Rpb24gZ2V0IChvZmZzZXQpIHtcbiAgY29uc29sZS5sb2coJy5nZXQoKSBpcyBkZXByZWNhdGVkLiBBY2Nlc3MgdXNpbmcgYXJyYXkgaW5kZXhlcyBpbnN0ZWFkLicpXG4gIHJldHVybiB0aGlzLnJlYWRVSW50OChvZmZzZXQpXG59XG5cbi8vIGBzZXRgIHdpbGwgYmUgcmVtb3ZlZCBpbiBOb2RlIDAuMTMrXG5CdWZmZXIucHJvdG90eXBlLnNldCA9IGZ1bmN0aW9uIHNldCAodiwgb2Zmc2V0KSB7XG4gIGNvbnNvbGUubG9nKCcuc2V0KCkgaXMgZGVwcmVjYXRlZC4gQWNjZXNzIHVzaW5nIGFycmF5IGluZGV4ZXMgaW5zdGVhZC4nKVxuICByZXR1cm4gdGhpcy53cml0ZVVJbnQ4KHYsIG9mZnNldClcbn1cblxuZnVuY3Rpb24gaGV4V3JpdGUgKGJ1Ziwgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCkge1xuICBvZmZzZXQgPSBOdW1iZXIob2Zmc2V0KSB8fCAwXG4gIHZhciByZW1haW5pbmcgPSBidWYubGVuZ3RoIC0gb2Zmc2V0XG4gIGlmICghbGVuZ3RoKSB7XG4gICAgbGVuZ3RoID0gcmVtYWluaW5nXG4gIH0gZWxzZSB7XG4gICAgbGVuZ3RoID0gTnVtYmVyKGxlbmd0aClcbiAgICBpZiAobGVuZ3RoID4gcmVtYWluaW5nKSB7XG4gICAgICBsZW5ndGggPSByZW1haW5pbmdcbiAgICB9XG4gIH1cblxuICAvLyBtdXN0IGJlIGFuIGV2ZW4gbnVtYmVyIG9mIGRpZ2l0c1xuICB2YXIgc3RyTGVuID0gc3RyaW5nLmxlbmd0aFxuICBpZiAoc3RyTGVuICUgMiAhPT0gMCkgdGhyb3cgbmV3IEVycm9yKCdJbnZhbGlkIGhleCBzdHJpbmcnKVxuXG4gIGlmIChsZW5ndGggPiBzdHJMZW4gLyAyKSB7XG4gICAgbGVuZ3RoID0gc3RyTGVuIC8gMlxuICB9XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuZ3RoOyBpKyspIHtcbiAgICB2YXIgcGFyc2VkID0gcGFyc2VJbnQoc3RyaW5nLnN1YnN0cihpICogMiwgMiksIDE2KVxuICAgIGlmIChpc05hTihwYXJzZWQpKSB0aHJvdyBuZXcgRXJyb3IoJ0ludmFsaWQgaGV4IHN0cmluZycpXG4gICAgYnVmW29mZnNldCArIGldID0gcGFyc2VkXG4gIH1cbiAgcmV0dXJuIGlcbn1cblxuZnVuY3Rpb24gdXRmOFdyaXRlIChidWYsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpIHtcbiAgcmV0dXJuIGJsaXRCdWZmZXIodXRmOFRvQnl0ZXMoc3RyaW5nLCBidWYubGVuZ3RoIC0gb2Zmc2V0KSwgYnVmLCBvZmZzZXQsIGxlbmd0aClcbn1cblxuZnVuY3Rpb24gYXNjaWlXcml0ZSAoYnVmLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKSB7XG4gIHJldHVybiBibGl0QnVmZmVyKGFzY2lpVG9CeXRlcyhzdHJpbmcpLCBidWYsIG9mZnNldCwgbGVuZ3RoKVxufVxuXG5mdW5jdGlvbiBiaW5hcnlXcml0ZSAoYnVmLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKSB7XG4gIHJldHVybiBhc2NpaVdyaXRlKGJ1Ziwgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aClcbn1cblxuZnVuY3Rpb24gYmFzZTY0V3JpdGUgKGJ1Ziwgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCkge1xuICByZXR1cm4gYmxpdEJ1ZmZlcihiYXNlNjRUb0J5dGVzKHN0cmluZyksIGJ1Ziwgb2Zmc2V0LCBsZW5ndGgpXG59XG5cbmZ1bmN0aW9uIHVjczJXcml0ZSAoYnVmLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKSB7XG4gIHJldHVybiBibGl0QnVmZmVyKHV0ZjE2bGVUb0J5dGVzKHN0cmluZywgYnVmLmxlbmd0aCAtIG9mZnNldCksIGJ1Ziwgb2Zmc2V0LCBsZW5ndGgpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGUgPSBmdW5jdGlvbiB3cml0ZSAoc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCwgZW5jb2RpbmcpIHtcbiAgLy8gQnVmZmVyI3dyaXRlKHN0cmluZylcbiAgaWYgKG9mZnNldCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgZW5jb2RpbmcgPSAndXRmOCdcbiAgICBsZW5ndGggPSB0aGlzLmxlbmd0aFxuICAgIG9mZnNldCA9IDBcbiAgLy8gQnVmZmVyI3dyaXRlKHN0cmluZywgZW5jb2RpbmcpXG4gIH0gZWxzZSBpZiAobGVuZ3RoID09PSB1bmRlZmluZWQgJiYgdHlwZW9mIG9mZnNldCA9PT0gJ3N0cmluZycpIHtcbiAgICBlbmNvZGluZyA9IG9mZnNldFxuICAgIGxlbmd0aCA9IHRoaXMubGVuZ3RoXG4gICAgb2Zmc2V0ID0gMFxuICAvLyBCdWZmZXIjd3JpdGUoc3RyaW5nLCBvZmZzZXRbLCBsZW5ndGhdWywgZW5jb2RpbmddKVxuICB9IGVsc2UgaWYgKGlzRmluaXRlKG9mZnNldCkpIHtcbiAgICBvZmZzZXQgPSBvZmZzZXQgfCAwXG4gICAgaWYgKGlzRmluaXRlKGxlbmd0aCkpIHtcbiAgICAgIGxlbmd0aCA9IGxlbmd0aCB8IDBcbiAgICAgIGlmIChlbmNvZGluZyA9PT0gdW5kZWZpbmVkKSBlbmNvZGluZyA9ICd1dGY4J1xuICAgIH0gZWxzZSB7XG4gICAgICBlbmNvZGluZyA9IGxlbmd0aFxuICAgICAgbGVuZ3RoID0gdW5kZWZpbmVkXG4gICAgfVxuICAvLyBsZWdhY3kgd3JpdGUoc3RyaW5nLCBlbmNvZGluZywgb2Zmc2V0LCBsZW5ndGgpIC0gcmVtb3ZlIGluIHYwLjEzXG4gIH0gZWxzZSB7XG4gICAgdmFyIHN3YXAgPSBlbmNvZGluZ1xuICAgIGVuY29kaW5nID0gb2Zmc2V0XG4gICAgb2Zmc2V0ID0gbGVuZ3RoIHwgMFxuICAgIGxlbmd0aCA9IHN3YXBcbiAgfVxuXG4gIHZhciByZW1haW5pbmcgPSB0aGlzLmxlbmd0aCAtIG9mZnNldFxuICBpZiAobGVuZ3RoID09PSB1bmRlZmluZWQgfHwgbGVuZ3RoID4gcmVtYWluaW5nKSBsZW5ndGggPSByZW1haW5pbmdcblxuICBpZiAoKHN0cmluZy5sZW5ndGggPiAwICYmIChsZW5ndGggPCAwIHx8IG9mZnNldCA8IDApKSB8fCBvZmZzZXQgPiB0aGlzLmxlbmd0aCkge1xuICAgIHRocm93IG5ldyBSYW5nZUVycm9yKCdhdHRlbXB0IHRvIHdyaXRlIG91dHNpZGUgYnVmZmVyIGJvdW5kcycpXG4gIH1cblxuICBpZiAoIWVuY29kaW5nKSBlbmNvZGluZyA9ICd1dGY4J1xuXG4gIHZhciBsb3dlcmVkQ2FzZSA9IGZhbHNlXG4gIGZvciAoOzspIHtcbiAgICBzd2l0Y2ggKGVuY29kaW5nKSB7XG4gICAgICBjYXNlICdoZXgnOlxuICAgICAgICByZXR1cm4gaGV4V3JpdGUodGhpcywgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aClcblxuICAgICAgY2FzZSAndXRmOCc6XG4gICAgICBjYXNlICd1dGYtOCc6XG4gICAgICAgIHJldHVybiB1dGY4V3JpdGUodGhpcywgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aClcblxuICAgICAgY2FzZSAnYXNjaWknOlxuICAgICAgICByZXR1cm4gYXNjaWlXcml0ZSh0aGlzLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKVxuXG4gICAgICBjYXNlICdiaW5hcnknOlxuICAgICAgICByZXR1cm4gYmluYXJ5V3JpdGUodGhpcywgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aClcblxuICAgICAgY2FzZSAnYmFzZTY0JzpcbiAgICAgICAgLy8gV2FybmluZzogbWF4TGVuZ3RoIG5vdCB0YWtlbiBpbnRvIGFjY291bnQgaW4gYmFzZTY0V3JpdGVcbiAgICAgICAgcmV0dXJuIGJhc2U2NFdyaXRlKHRoaXMsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpXG5cbiAgICAgIGNhc2UgJ3VjczInOlxuICAgICAgY2FzZSAndWNzLTInOlxuICAgICAgY2FzZSAndXRmMTZsZSc6XG4gICAgICBjYXNlICd1dGYtMTZsZSc6XG4gICAgICAgIHJldHVybiB1Y3MyV3JpdGUodGhpcywgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aClcblxuICAgICAgZGVmYXVsdDpcbiAgICAgICAgaWYgKGxvd2VyZWRDYXNlKSB0aHJvdyBuZXcgVHlwZUVycm9yKCdVbmtub3duIGVuY29kaW5nOiAnICsgZW5jb2RpbmcpXG4gICAgICAgIGVuY29kaW5nID0gKCcnICsgZW5jb2RpbmcpLnRvTG93ZXJDYXNlKClcbiAgICAgICAgbG93ZXJlZENhc2UgPSB0cnVlXG4gICAgfVxuICB9XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUudG9KU09OID0gZnVuY3Rpb24gdG9KU09OICgpIHtcbiAgcmV0dXJuIHtcbiAgICB0eXBlOiAnQnVmZmVyJyxcbiAgICBkYXRhOiBBcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbCh0aGlzLl9hcnIgfHwgdGhpcywgMClcbiAgfVxufVxuXG5mdW5jdGlvbiBiYXNlNjRTbGljZSAoYnVmLCBzdGFydCwgZW5kKSB7XG4gIGlmIChzdGFydCA9PT0gMCAmJiBlbmQgPT09IGJ1Zi5sZW5ndGgpIHtcbiAgICByZXR1cm4gYmFzZTY0LmZyb21CeXRlQXJyYXkoYnVmKVxuICB9IGVsc2Uge1xuICAgIHJldHVybiBiYXNlNjQuZnJvbUJ5dGVBcnJheShidWYuc2xpY2Uoc3RhcnQsIGVuZCkpXG4gIH1cbn1cblxuZnVuY3Rpb24gdXRmOFNsaWNlIChidWYsIHN0YXJ0LCBlbmQpIHtcbiAgdmFyIHJlcyA9ICcnXG4gIHZhciB0bXAgPSAnJ1xuICBlbmQgPSBNYXRoLm1pbihidWYubGVuZ3RoLCBlbmQpXG5cbiAgZm9yICh2YXIgaSA9IHN0YXJ0OyBpIDwgZW5kOyBpKyspIHtcbiAgICBpZiAoYnVmW2ldIDw9IDB4N0YpIHtcbiAgICAgIHJlcyArPSBkZWNvZGVVdGY4Q2hhcih0bXApICsgU3RyaW5nLmZyb21DaGFyQ29kZShidWZbaV0pXG4gICAgICB0bXAgPSAnJ1xuICAgIH0gZWxzZSB7XG4gICAgICB0bXAgKz0gJyUnICsgYnVmW2ldLnRvU3RyaW5nKDE2KVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiByZXMgKyBkZWNvZGVVdGY4Q2hhcih0bXApXG59XG5cbmZ1bmN0aW9uIGFzY2lpU2xpY2UgKGJ1Ziwgc3RhcnQsIGVuZCkge1xuICB2YXIgcmV0ID0gJydcbiAgZW5kID0gTWF0aC5taW4oYnVmLmxlbmd0aCwgZW5kKVxuXG4gIGZvciAodmFyIGkgPSBzdGFydDsgaSA8IGVuZDsgaSsrKSB7XG4gICAgcmV0ICs9IFN0cmluZy5mcm9tQ2hhckNvZGUoYnVmW2ldICYgMHg3RilcbiAgfVxuICByZXR1cm4gcmV0XG59XG5cbmZ1bmN0aW9uIGJpbmFyeVNsaWNlIChidWYsIHN0YXJ0LCBlbmQpIHtcbiAgdmFyIHJldCA9ICcnXG4gIGVuZCA9IE1hdGgubWluKGJ1Zi5sZW5ndGgsIGVuZClcblxuICBmb3IgKHZhciBpID0gc3RhcnQ7IGkgPCBlbmQ7IGkrKykge1xuICAgIHJldCArPSBTdHJpbmcuZnJvbUNoYXJDb2RlKGJ1ZltpXSlcbiAgfVxuICByZXR1cm4gcmV0XG59XG5cbmZ1bmN0aW9uIGhleFNsaWNlIChidWYsIHN0YXJ0LCBlbmQpIHtcbiAgdmFyIGxlbiA9IGJ1Zi5sZW5ndGhcblxuICBpZiAoIXN0YXJ0IHx8IHN0YXJ0IDwgMCkgc3RhcnQgPSAwXG4gIGlmICghZW5kIHx8IGVuZCA8IDAgfHwgZW5kID4gbGVuKSBlbmQgPSBsZW5cblxuICB2YXIgb3V0ID0gJydcbiAgZm9yICh2YXIgaSA9IHN0YXJ0OyBpIDwgZW5kOyBpKyspIHtcbiAgICBvdXQgKz0gdG9IZXgoYnVmW2ldKVxuICB9XG4gIHJldHVybiBvdXRcbn1cblxuZnVuY3Rpb24gdXRmMTZsZVNsaWNlIChidWYsIHN0YXJ0LCBlbmQpIHtcbiAgdmFyIGJ5dGVzID0gYnVmLnNsaWNlKHN0YXJ0LCBlbmQpXG4gIHZhciByZXMgPSAnJ1xuICBmb3IgKHZhciBpID0gMDsgaSA8IGJ5dGVzLmxlbmd0aDsgaSArPSAyKSB7XG4gICAgcmVzICs9IFN0cmluZy5mcm9tQ2hhckNvZGUoYnl0ZXNbaV0gKyBieXRlc1tpICsgMV0gKiAyNTYpXG4gIH1cbiAgcmV0dXJuIHJlc1xufVxuXG5CdWZmZXIucHJvdG90eXBlLnNsaWNlID0gZnVuY3Rpb24gc2xpY2UgKHN0YXJ0LCBlbmQpIHtcbiAgdmFyIGxlbiA9IHRoaXMubGVuZ3RoXG4gIHN0YXJ0ID0gfn5zdGFydFxuICBlbmQgPSBlbmQgPT09IHVuZGVmaW5lZCA/IGxlbiA6IH5+ZW5kXG5cbiAgaWYgKHN0YXJ0IDwgMCkge1xuICAgIHN0YXJ0ICs9IGxlblxuICAgIGlmIChzdGFydCA8IDApIHN0YXJ0ID0gMFxuICB9IGVsc2UgaWYgKHN0YXJ0ID4gbGVuKSB7XG4gICAgc3RhcnQgPSBsZW5cbiAgfVxuXG4gIGlmIChlbmQgPCAwKSB7XG4gICAgZW5kICs9IGxlblxuICAgIGlmIChlbmQgPCAwKSBlbmQgPSAwXG4gIH0gZWxzZSBpZiAoZW5kID4gbGVuKSB7XG4gICAgZW5kID0gbGVuXG4gIH1cblxuICBpZiAoZW5kIDwgc3RhcnQpIGVuZCA9IHN0YXJ0XG5cbiAgdmFyIG5ld0J1ZlxuICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICBuZXdCdWYgPSBCdWZmZXIuX2F1Z21lbnQodGhpcy5zdWJhcnJheShzdGFydCwgZW5kKSlcbiAgfSBlbHNlIHtcbiAgICB2YXIgc2xpY2VMZW4gPSBlbmQgLSBzdGFydFxuICAgIG5ld0J1ZiA9IG5ldyBCdWZmZXIoc2xpY2VMZW4sIHVuZGVmaW5lZClcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IHNsaWNlTGVuOyBpKyspIHtcbiAgICAgIG5ld0J1ZltpXSA9IHRoaXNbaSArIHN0YXJ0XVxuICAgIH1cbiAgfVxuXG4gIGlmIChuZXdCdWYubGVuZ3RoKSBuZXdCdWYucGFyZW50ID0gdGhpcy5wYXJlbnQgfHwgdGhpc1xuXG4gIHJldHVybiBuZXdCdWZcbn1cblxuLypcbiAqIE5lZWQgdG8gbWFrZSBzdXJlIHRoYXQgYnVmZmVyIGlzbid0IHRyeWluZyB0byB3cml0ZSBvdXQgb2YgYm91bmRzLlxuICovXG5mdW5jdGlvbiBjaGVja09mZnNldCAob2Zmc2V0LCBleHQsIGxlbmd0aCkge1xuICBpZiAoKG9mZnNldCAlIDEpICE9PSAwIHx8IG9mZnNldCA8IDApIHRocm93IG5ldyBSYW5nZUVycm9yKCdvZmZzZXQgaXMgbm90IHVpbnQnKVxuICBpZiAob2Zmc2V0ICsgZXh0ID4gbGVuZ3RoKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcignVHJ5aW5nIHRvIGFjY2VzcyBiZXlvbmQgYnVmZmVyIGxlbmd0aCcpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZFVJbnRMRSA9IGZ1bmN0aW9uIHJlYWRVSW50TEUgKG9mZnNldCwgYnl0ZUxlbmd0aCwgbm9Bc3NlcnQpIHtcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBieXRlTGVuZ3RoID0gYnl0ZUxlbmd0aCB8IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCBieXRlTGVuZ3RoLCB0aGlzLmxlbmd0aClcblxuICB2YXIgdmFsID0gdGhpc1tvZmZzZXRdXG4gIHZhciBtdWwgPSAxXG4gIHZhciBpID0gMFxuICB3aGlsZSAoKytpIDwgYnl0ZUxlbmd0aCAmJiAobXVsICo9IDB4MTAwKSkge1xuICAgIHZhbCArPSB0aGlzW29mZnNldCArIGldICogbXVsXG4gIH1cblxuICByZXR1cm4gdmFsXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZFVJbnRCRSA9IGZ1bmN0aW9uIHJlYWRVSW50QkUgKG9mZnNldCwgYnl0ZUxlbmd0aCwgbm9Bc3NlcnQpIHtcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBieXRlTGVuZ3RoID0gYnl0ZUxlbmd0aCB8IDBcbiAgaWYgKCFub0Fzc2VydCkge1xuICAgIGNoZWNrT2Zmc2V0KG9mZnNldCwgYnl0ZUxlbmd0aCwgdGhpcy5sZW5ndGgpXG4gIH1cblxuICB2YXIgdmFsID0gdGhpc1tvZmZzZXQgKyAtLWJ5dGVMZW5ndGhdXG4gIHZhciBtdWwgPSAxXG4gIHdoaWxlIChieXRlTGVuZ3RoID4gMCAmJiAobXVsICo9IDB4MTAwKSkge1xuICAgIHZhbCArPSB0aGlzW29mZnNldCArIC0tYnl0ZUxlbmd0aF0gKiBtdWxcbiAgfVxuXG4gIHJldHVybiB2YWxcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkVUludDggPSBmdW5jdGlvbiByZWFkVUludDggKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCAxLCB0aGlzLmxlbmd0aClcbiAgcmV0dXJuIHRoaXNbb2Zmc2V0XVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRVSW50MTZMRSA9IGZ1bmN0aW9uIHJlYWRVSW50MTZMRSAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDIsIHRoaXMubGVuZ3RoKVxuICByZXR1cm4gdGhpc1tvZmZzZXRdIHwgKHRoaXNbb2Zmc2V0ICsgMV0gPDwgOClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkVUludDE2QkUgPSBmdW5jdGlvbiByZWFkVUludDE2QkUgKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCAyLCB0aGlzLmxlbmd0aClcbiAgcmV0dXJuICh0aGlzW29mZnNldF0gPDwgOCkgfCB0aGlzW29mZnNldCArIDFdXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZFVJbnQzMkxFID0gZnVuY3Rpb24gcmVhZFVJbnQzMkxFIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgNCwgdGhpcy5sZW5ndGgpXG5cbiAgcmV0dXJuICgodGhpc1tvZmZzZXRdKSB8XG4gICAgICAodGhpc1tvZmZzZXQgKyAxXSA8PCA4KSB8XG4gICAgICAodGhpc1tvZmZzZXQgKyAyXSA8PCAxNikpICtcbiAgICAgICh0aGlzW29mZnNldCArIDNdICogMHgxMDAwMDAwKVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRVSW50MzJCRSA9IGZ1bmN0aW9uIHJlYWRVSW50MzJCRSAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDQsIHRoaXMubGVuZ3RoKVxuXG4gIHJldHVybiAodGhpc1tvZmZzZXRdICogMHgxMDAwMDAwKSArXG4gICAgKCh0aGlzW29mZnNldCArIDFdIDw8IDE2KSB8XG4gICAgKHRoaXNbb2Zmc2V0ICsgMl0gPDwgOCkgfFxuICAgIHRoaXNbb2Zmc2V0ICsgM10pXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEludExFID0gZnVuY3Rpb24gcmVhZEludExFIChvZmZzZXQsIGJ5dGVMZW5ndGgsIG5vQXNzZXJ0KSB7XG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgYnl0ZUxlbmd0aCA9IGJ5dGVMZW5ndGggfCAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgYnl0ZUxlbmd0aCwgdGhpcy5sZW5ndGgpXG5cbiAgdmFyIHZhbCA9IHRoaXNbb2Zmc2V0XVxuICB2YXIgbXVsID0gMVxuICB2YXIgaSA9IDBcbiAgd2hpbGUgKCsraSA8IGJ5dGVMZW5ndGggJiYgKG11bCAqPSAweDEwMCkpIHtcbiAgICB2YWwgKz0gdGhpc1tvZmZzZXQgKyBpXSAqIG11bFxuICB9XG4gIG11bCAqPSAweDgwXG5cbiAgaWYgKHZhbCA+PSBtdWwpIHZhbCAtPSBNYXRoLnBvdygyLCA4ICogYnl0ZUxlbmd0aClcblxuICByZXR1cm4gdmFsXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEludEJFID0gZnVuY3Rpb24gcmVhZEludEJFIChvZmZzZXQsIGJ5dGVMZW5ndGgsIG5vQXNzZXJ0KSB7XG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgYnl0ZUxlbmd0aCA9IGJ5dGVMZW5ndGggfCAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgYnl0ZUxlbmd0aCwgdGhpcy5sZW5ndGgpXG5cbiAgdmFyIGkgPSBieXRlTGVuZ3RoXG4gIHZhciBtdWwgPSAxXG4gIHZhciB2YWwgPSB0aGlzW29mZnNldCArIC0taV1cbiAgd2hpbGUgKGkgPiAwICYmIChtdWwgKj0gMHgxMDApKSB7XG4gICAgdmFsICs9IHRoaXNbb2Zmc2V0ICsgLS1pXSAqIG11bFxuICB9XG4gIG11bCAqPSAweDgwXG5cbiAgaWYgKHZhbCA+PSBtdWwpIHZhbCAtPSBNYXRoLnBvdygyLCA4ICogYnl0ZUxlbmd0aClcblxuICByZXR1cm4gdmFsXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEludDggPSBmdW5jdGlvbiByZWFkSW50OCAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDEsIHRoaXMubGVuZ3RoKVxuICBpZiAoISh0aGlzW29mZnNldF0gJiAweDgwKSkgcmV0dXJuICh0aGlzW29mZnNldF0pXG4gIHJldHVybiAoKDB4ZmYgLSB0aGlzW29mZnNldF0gKyAxKSAqIC0xKVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRJbnQxNkxFID0gZnVuY3Rpb24gcmVhZEludDE2TEUgKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCAyLCB0aGlzLmxlbmd0aClcbiAgdmFyIHZhbCA9IHRoaXNbb2Zmc2V0XSB8ICh0aGlzW29mZnNldCArIDFdIDw8IDgpXG4gIHJldHVybiAodmFsICYgMHg4MDAwKSA/IHZhbCB8IDB4RkZGRjAwMDAgOiB2YWxcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkSW50MTZCRSA9IGZ1bmN0aW9uIHJlYWRJbnQxNkJFIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgMiwgdGhpcy5sZW5ndGgpXG4gIHZhciB2YWwgPSB0aGlzW29mZnNldCArIDFdIHwgKHRoaXNbb2Zmc2V0XSA8PCA4KVxuICByZXR1cm4gKHZhbCAmIDB4ODAwMCkgPyB2YWwgfCAweEZGRkYwMDAwIDogdmFsXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEludDMyTEUgPSBmdW5jdGlvbiByZWFkSW50MzJMRSAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDQsIHRoaXMubGVuZ3RoKVxuXG4gIHJldHVybiAodGhpc1tvZmZzZXRdKSB8XG4gICAgKHRoaXNbb2Zmc2V0ICsgMV0gPDwgOCkgfFxuICAgICh0aGlzW29mZnNldCArIDJdIDw8IDE2KSB8XG4gICAgKHRoaXNbb2Zmc2V0ICsgM10gPDwgMjQpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEludDMyQkUgPSBmdW5jdGlvbiByZWFkSW50MzJCRSAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDQsIHRoaXMubGVuZ3RoKVxuXG4gIHJldHVybiAodGhpc1tvZmZzZXRdIDw8IDI0KSB8XG4gICAgKHRoaXNbb2Zmc2V0ICsgMV0gPDwgMTYpIHxcbiAgICAodGhpc1tvZmZzZXQgKyAyXSA8PCA4KSB8XG4gICAgKHRoaXNbb2Zmc2V0ICsgM10pXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEZsb2F0TEUgPSBmdW5jdGlvbiByZWFkRmxvYXRMRSAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDQsIHRoaXMubGVuZ3RoKVxuICByZXR1cm4gaWVlZTc1NC5yZWFkKHRoaXMsIG9mZnNldCwgdHJ1ZSwgMjMsIDQpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEZsb2F0QkUgPSBmdW5jdGlvbiByZWFkRmxvYXRCRSAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDQsIHRoaXMubGVuZ3RoKVxuICByZXR1cm4gaWVlZTc1NC5yZWFkKHRoaXMsIG9mZnNldCwgZmFsc2UsIDIzLCA0KVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWREb3VibGVMRSA9IGZ1bmN0aW9uIHJlYWREb3VibGVMRSAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDgsIHRoaXMubGVuZ3RoKVxuICByZXR1cm4gaWVlZTc1NC5yZWFkKHRoaXMsIG9mZnNldCwgdHJ1ZSwgNTIsIDgpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZERvdWJsZUJFID0gZnVuY3Rpb24gcmVhZERvdWJsZUJFIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgOCwgdGhpcy5sZW5ndGgpXG4gIHJldHVybiBpZWVlNzU0LnJlYWQodGhpcywgb2Zmc2V0LCBmYWxzZSwgNTIsIDgpXG59XG5cbmZ1bmN0aW9uIGNoZWNrSW50IChidWYsIHZhbHVlLCBvZmZzZXQsIGV4dCwgbWF4LCBtaW4pIHtcbiAgaWYgKCFCdWZmZXIuaXNCdWZmZXIoYnVmKSkgdGhyb3cgbmV3IFR5cGVFcnJvcignYnVmZmVyIG11c3QgYmUgYSBCdWZmZXIgaW5zdGFuY2UnKVxuICBpZiAodmFsdWUgPiBtYXggfHwgdmFsdWUgPCBtaW4pIHRocm93IG5ldyBSYW5nZUVycm9yKCd2YWx1ZSBpcyBvdXQgb2YgYm91bmRzJylcbiAgaWYgKG9mZnNldCArIGV4dCA+IGJ1Zi5sZW5ndGgpIHRocm93IG5ldyBSYW5nZUVycm9yKCdpbmRleCBvdXQgb2YgcmFuZ2UnKVxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlVUludExFID0gZnVuY3Rpb24gd3JpdGVVSW50TEUgKHZhbHVlLCBvZmZzZXQsIGJ5dGVMZW5ndGgsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgYnl0ZUxlbmd0aCA9IGJ5dGVMZW5ndGggfCAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIGJ5dGVMZW5ndGgsIE1hdGgucG93KDIsIDggKiBieXRlTGVuZ3RoKSwgMClcblxuICB2YXIgbXVsID0gMVxuICB2YXIgaSA9IDBcbiAgdGhpc1tvZmZzZXRdID0gdmFsdWUgJiAweEZGXG4gIHdoaWxlICgrK2kgPCBieXRlTGVuZ3RoICYmIChtdWwgKj0gMHgxMDApKSB7XG4gICAgdGhpc1tvZmZzZXQgKyBpXSA9ICh2YWx1ZSAvIG11bCkgJiAweEZGXG4gIH1cblxuICByZXR1cm4gb2Zmc2V0ICsgYnl0ZUxlbmd0aFxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlVUludEJFID0gZnVuY3Rpb24gd3JpdGVVSW50QkUgKHZhbHVlLCBvZmZzZXQsIGJ5dGVMZW5ndGgsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgYnl0ZUxlbmd0aCA9IGJ5dGVMZW5ndGggfCAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIGJ5dGVMZW5ndGgsIE1hdGgucG93KDIsIDggKiBieXRlTGVuZ3RoKSwgMClcblxuICB2YXIgaSA9IGJ5dGVMZW5ndGggLSAxXG4gIHZhciBtdWwgPSAxXG4gIHRoaXNbb2Zmc2V0ICsgaV0gPSB2YWx1ZSAmIDB4RkZcbiAgd2hpbGUgKC0taSA+PSAwICYmIChtdWwgKj0gMHgxMDApKSB7XG4gICAgdGhpc1tvZmZzZXQgKyBpXSA9ICh2YWx1ZSAvIG11bCkgJiAweEZGXG4gIH1cblxuICByZXR1cm4gb2Zmc2V0ICsgYnl0ZUxlbmd0aFxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlVUludDggPSBmdW5jdGlvbiB3cml0ZVVJbnQ4ICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgfCAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIDEsIDB4ZmYsIDApXG4gIGlmICghQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHZhbHVlID0gTWF0aC5mbG9vcih2YWx1ZSlcbiAgdGhpc1tvZmZzZXRdID0gdmFsdWVcbiAgcmV0dXJuIG9mZnNldCArIDFcbn1cblxuZnVuY3Rpb24gb2JqZWN0V3JpdGVVSW50MTYgKGJ1ZiwgdmFsdWUsIG9mZnNldCwgbGl0dGxlRW5kaWFuKSB7XG4gIGlmICh2YWx1ZSA8IDApIHZhbHVlID0gMHhmZmZmICsgdmFsdWUgKyAxXG4gIGZvciAodmFyIGkgPSAwLCBqID0gTWF0aC5taW4oYnVmLmxlbmd0aCAtIG9mZnNldCwgMik7IGkgPCBqOyBpKyspIHtcbiAgICBidWZbb2Zmc2V0ICsgaV0gPSAodmFsdWUgJiAoMHhmZiA8PCAoOCAqIChsaXR0bGVFbmRpYW4gPyBpIDogMSAtIGkpKSkpID4+PlxuICAgICAgKGxpdHRsZUVuZGlhbiA/IGkgOiAxIC0gaSkgKiA4XG4gIH1cbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZVVJbnQxNkxFID0gZnVuY3Rpb24gd3JpdGVVSW50MTZMRSAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCAyLCAweGZmZmYsIDApXG4gIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIHRoaXNbb2Zmc2V0XSA9IHZhbHVlXG4gICAgdGhpc1tvZmZzZXQgKyAxXSA9ICh2YWx1ZSA+Pj4gOClcbiAgfSBlbHNlIHtcbiAgICBvYmplY3RXcml0ZVVJbnQxNih0aGlzLCB2YWx1ZSwgb2Zmc2V0LCB0cnVlKVxuICB9XG4gIHJldHVybiBvZmZzZXQgKyAyXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVVSW50MTZCRSA9IGZ1bmN0aW9uIHdyaXRlVUludDE2QkUgKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgMiwgMHhmZmZmLCAwKVxuICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICB0aGlzW29mZnNldF0gPSAodmFsdWUgPj4+IDgpXG4gICAgdGhpc1tvZmZzZXQgKyAxXSA9IHZhbHVlXG4gIH0gZWxzZSB7XG4gICAgb2JqZWN0V3JpdGVVSW50MTYodGhpcywgdmFsdWUsIG9mZnNldCwgZmFsc2UpXG4gIH1cbiAgcmV0dXJuIG9mZnNldCArIDJcbn1cblxuZnVuY3Rpb24gb2JqZWN0V3JpdGVVSW50MzIgKGJ1ZiwgdmFsdWUsIG9mZnNldCwgbGl0dGxlRW5kaWFuKSB7XG4gIGlmICh2YWx1ZSA8IDApIHZhbHVlID0gMHhmZmZmZmZmZiArIHZhbHVlICsgMVxuICBmb3IgKHZhciBpID0gMCwgaiA9IE1hdGgubWluKGJ1Zi5sZW5ndGggLSBvZmZzZXQsIDQpOyBpIDwgajsgaSsrKSB7XG4gICAgYnVmW29mZnNldCArIGldID0gKHZhbHVlID4+PiAobGl0dGxlRW5kaWFuID8gaSA6IDMgLSBpKSAqIDgpICYgMHhmZlxuICB9XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVVSW50MzJMRSA9IGZ1bmN0aW9uIHdyaXRlVUludDMyTEUgKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgNCwgMHhmZmZmZmZmZiwgMClcbiAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgdGhpc1tvZmZzZXQgKyAzXSA9ICh2YWx1ZSA+Pj4gMjQpXG4gICAgdGhpc1tvZmZzZXQgKyAyXSA9ICh2YWx1ZSA+Pj4gMTYpXG4gICAgdGhpc1tvZmZzZXQgKyAxXSA9ICh2YWx1ZSA+Pj4gOClcbiAgICB0aGlzW29mZnNldF0gPSB2YWx1ZVxuICB9IGVsc2Uge1xuICAgIG9iamVjdFdyaXRlVUludDMyKHRoaXMsIHZhbHVlLCBvZmZzZXQsIHRydWUpXG4gIH1cbiAgcmV0dXJuIG9mZnNldCArIDRcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZVVJbnQzMkJFID0gZnVuY3Rpb24gd3JpdGVVSW50MzJCRSAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCA0LCAweGZmZmZmZmZmLCAwKVxuICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICB0aGlzW29mZnNldF0gPSAodmFsdWUgPj4+IDI0KVxuICAgIHRoaXNbb2Zmc2V0ICsgMV0gPSAodmFsdWUgPj4+IDE2KVxuICAgIHRoaXNbb2Zmc2V0ICsgMl0gPSAodmFsdWUgPj4+IDgpXG4gICAgdGhpc1tvZmZzZXQgKyAzXSA9IHZhbHVlXG4gIH0gZWxzZSB7XG4gICAgb2JqZWN0V3JpdGVVSW50MzIodGhpcywgdmFsdWUsIG9mZnNldCwgZmFsc2UpXG4gIH1cbiAgcmV0dXJuIG9mZnNldCArIDRcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUludExFID0gZnVuY3Rpb24gd3JpdGVJbnRMRSAodmFsdWUsIG9mZnNldCwgYnl0ZUxlbmd0aCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBpZiAoIW5vQXNzZXJ0KSB7XG4gICAgdmFyIGxpbWl0ID0gTWF0aC5wb3coMiwgOCAqIGJ5dGVMZW5ndGggLSAxKVxuXG4gICAgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgYnl0ZUxlbmd0aCwgbGltaXQgLSAxLCAtbGltaXQpXG4gIH1cblxuICB2YXIgaSA9IDBcbiAgdmFyIG11bCA9IDFcbiAgdmFyIHN1YiA9IHZhbHVlIDwgMCA/IDEgOiAwXG4gIHRoaXNbb2Zmc2V0XSA9IHZhbHVlICYgMHhGRlxuICB3aGlsZSAoKytpIDwgYnl0ZUxlbmd0aCAmJiAobXVsICo9IDB4MTAwKSkge1xuICAgIHRoaXNbb2Zmc2V0ICsgaV0gPSAoKHZhbHVlIC8gbXVsKSA+PiAwKSAtIHN1YiAmIDB4RkZcbiAgfVxuXG4gIHJldHVybiBvZmZzZXQgKyBieXRlTGVuZ3RoXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVJbnRCRSA9IGZ1bmN0aW9uIHdyaXRlSW50QkUgKHZhbHVlLCBvZmZzZXQsIGJ5dGVMZW5ndGgsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgaWYgKCFub0Fzc2VydCkge1xuICAgIHZhciBsaW1pdCA9IE1hdGgucG93KDIsIDggKiBieXRlTGVuZ3RoIC0gMSlcblxuICAgIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIGJ5dGVMZW5ndGgsIGxpbWl0IC0gMSwgLWxpbWl0KVxuICB9XG5cbiAgdmFyIGkgPSBieXRlTGVuZ3RoIC0gMVxuICB2YXIgbXVsID0gMVxuICB2YXIgc3ViID0gdmFsdWUgPCAwID8gMSA6IDBcbiAgdGhpc1tvZmZzZXQgKyBpXSA9IHZhbHVlICYgMHhGRlxuICB3aGlsZSAoLS1pID49IDAgJiYgKG11bCAqPSAweDEwMCkpIHtcbiAgICB0aGlzW29mZnNldCArIGldID0gKCh2YWx1ZSAvIG11bCkgPj4gMCkgLSBzdWIgJiAweEZGXG4gIH1cblxuICByZXR1cm4gb2Zmc2V0ICsgYnl0ZUxlbmd0aFxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlSW50OCA9IGZ1bmN0aW9uIHdyaXRlSW50OCAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCAxLCAweDdmLCAtMHg4MClcbiAgaWYgKCFCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkgdmFsdWUgPSBNYXRoLmZsb29yKHZhbHVlKVxuICBpZiAodmFsdWUgPCAwKSB2YWx1ZSA9IDB4ZmYgKyB2YWx1ZSArIDFcbiAgdGhpc1tvZmZzZXRdID0gdmFsdWVcbiAgcmV0dXJuIG9mZnNldCArIDFcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUludDE2TEUgPSBmdW5jdGlvbiB3cml0ZUludDE2TEUgKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgMiwgMHg3ZmZmLCAtMHg4MDAwKVxuICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICB0aGlzW29mZnNldF0gPSB2YWx1ZVxuICAgIHRoaXNbb2Zmc2V0ICsgMV0gPSAodmFsdWUgPj4+IDgpXG4gIH0gZWxzZSB7XG4gICAgb2JqZWN0V3JpdGVVSW50MTYodGhpcywgdmFsdWUsIG9mZnNldCwgdHJ1ZSlcbiAgfVxuICByZXR1cm4gb2Zmc2V0ICsgMlxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlSW50MTZCRSA9IGZ1bmN0aW9uIHdyaXRlSW50MTZCRSAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCAyLCAweDdmZmYsIC0weDgwMDApXG4gIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIHRoaXNbb2Zmc2V0XSA9ICh2YWx1ZSA+Pj4gOClcbiAgICB0aGlzW29mZnNldCArIDFdID0gdmFsdWVcbiAgfSBlbHNlIHtcbiAgICBvYmplY3RXcml0ZVVJbnQxNih0aGlzLCB2YWx1ZSwgb2Zmc2V0LCBmYWxzZSlcbiAgfVxuICByZXR1cm4gb2Zmc2V0ICsgMlxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlSW50MzJMRSA9IGZ1bmN0aW9uIHdyaXRlSW50MzJMRSAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCA0LCAweDdmZmZmZmZmLCAtMHg4MDAwMDAwMClcbiAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgdGhpc1tvZmZzZXRdID0gdmFsdWVcbiAgICB0aGlzW29mZnNldCArIDFdID0gKHZhbHVlID4+PiA4KVxuICAgIHRoaXNbb2Zmc2V0ICsgMl0gPSAodmFsdWUgPj4+IDE2KVxuICAgIHRoaXNbb2Zmc2V0ICsgM10gPSAodmFsdWUgPj4+IDI0KVxuICB9IGVsc2Uge1xuICAgIG9iamVjdFdyaXRlVUludDMyKHRoaXMsIHZhbHVlLCBvZmZzZXQsIHRydWUpXG4gIH1cbiAgcmV0dXJuIG9mZnNldCArIDRcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUludDMyQkUgPSBmdW5jdGlvbiB3cml0ZUludDMyQkUgKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgNCwgMHg3ZmZmZmZmZiwgLTB4ODAwMDAwMDApXG4gIGlmICh2YWx1ZSA8IDApIHZhbHVlID0gMHhmZmZmZmZmZiArIHZhbHVlICsgMVxuICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICB0aGlzW29mZnNldF0gPSAodmFsdWUgPj4+IDI0KVxuICAgIHRoaXNbb2Zmc2V0ICsgMV0gPSAodmFsdWUgPj4+IDE2KVxuICAgIHRoaXNbb2Zmc2V0ICsgMl0gPSAodmFsdWUgPj4+IDgpXG4gICAgdGhpc1tvZmZzZXQgKyAzXSA9IHZhbHVlXG4gIH0gZWxzZSB7XG4gICAgb2JqZWN0V3JpdGVVSW50MzIodGhpcywgdmFsdWUsIG9mZnNldCwgZmFsc2UpXG4gIH1cbiAgcmV0dXJuIG9mZnNldCArIDRcbn1cblxuZnVuY3Rpb24gY2hlY2tJRUVFNzU0IChidWYsIHZhbHVlLCBvZmZzZXQsIGV4dCwgbWF4LCBtaW4pIHtcbiAgaWYgKHZhbHVlID4gbWF4IHx8IHZhbHVlIDwgbWluKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcigndmFsdWUgaXMgb3V0IG9mIGJvdW5kcycpXG4gIGlmIChvZmZzZXQgKyBleHQgPiBidWYubGVuZ3RoKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcignaW5kZXggb3V0IG9mIHJhbmdlJylcbiAgaWYgKG9mZnNldCA8IDApIHRocm93IG5ldyBSYW5nZUVycm9yKCdpbmRleCBvdXQgb2YgcmFuZ2UnKVxufVxuXG5mdW5jdGlvbiB3cml0ZUZsb2F0IChidWYsIHZhbHVlLCBvZmZzZXQsIGxpdHRsZUVuZGlhbiwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkge1xuICAgIGNoZWNrSUVFRTc1NChidWYsIHZhbHVlLCBvZmZzZXQsIDQsIDMuNDAyODIzNDY2Mzg1Mjg4NmUrMzgsIC0zLjQwMjgyMzQ2NjM4NTI4ODZlKzM4KVxuICB9XG4gIGllZWU3NTQud3JpdGUoYnVmLCB2YWx1ZSwgb2Zmc2V0LCBsaXR0bGVFbmRpYW4sIDIzLCA0KVxuICByZXR1cm4gb2Zmc2V0ICsgNFxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlRmxvYXRMRSA9IGZ1bmN0aW9uIHdyaXRlRmxvYXRMRSAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgcmV0dXJuIHdyaXRlRmxvYXQodGhpcywgdmFsdWUsIG9mZnNldCwgdHJ1ZSwgbm9Bc3NlcnQpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVGbG9hdEJFID0gZnVuY3Rpb24gd3JpdGVGbG9hdEJFICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICByZXR1cm4gd3JpdGVGbG9hdCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCBmYWxzZSwgbm9Bc3NlcnQpXG59XG5cbmZ1bmN0aW9uIHdyaXRlRG91YmxlIChidWYsIHZhbHVlLCBvZmZzZXQsIGxpdHRsZUVuZGlhbiwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkge1xuICAgIGNoZWNrSUVFRTc1NChidWYsIHZhbHVlLCBvZmZzZXQsIDgsIDEuNzk3NjkzMTM0ODYyMzE1N0UrMzA4LCAtMS43OTc2OTMxMzQ4NjIzMTU3RSszMDgpXG4gIH1cbiAgaWVlZTc1NC53cml0ZShidWYsIHZhbHVlLCBvZmZzZXQsIGxpdHRsZUVuZGlhbiwgNTIsIDgpXG4gIHJldHVybiBvZmZzZXQgKyA4XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVEb3VibGVMRSA9IGZ1bmN0aW9uIHdyaXRlRG91YmxlTEUgKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHJldHVybiB3cml0ZURvdWJsZSh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCB0cnVlLCBub0Fzc2VydClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZURvdWJsZUJFID0gZnVuY3Rpb24gd3JpdGVEb3VibGVCRSAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgcmV0dXJuIHdyaXRlRG91YmxlKHRoaXMsIHZhbHVlLCBvZmZzZXQsIGZhbHNlLCBub0Fzc2VydClcbn1cblxuLy8gY29weSh0YXJnZXRCdWZmZXIsIHRhcmdldFN0YXJ0PTAsIHNvdXJjZVN0YXJ0PTAsIHNvdXJjZUVuZD1idWZmZXIubGVuZ3RoKVxuQnVmZmVyLnByb3RvdHlwZS5jb3B5ID0gZnVuY3Rpb24gY29weSAodGFyZ2V0LCB0YXJnZXRTdGFydCwgc3RhcnQsIGVuZCkge1xuICBpZiAoIXN0YXJ0KSBzdGFydCA9IDBcbiAgaWYgKCFlbmQgJiYgZW5kICE9PSAwKSBlbmQgPSB0aGlzLmxlbmd0aFxuICBpZiAodGFyZ2V0U3RhcnQgPj0gdGFyZ2V0Lmxlbmd0aCkgdGFyZ2V0U3RhcnQgPSB0YXJnZXQubGVuZ3RoXG4gIGlmICghdGFyZ2V0U3RhcnQpIHRhcmdldFN0YXJ0ID0gMFxuICBpZiAoZW5kID4gMCAmJiBlbmQgPCBzdGFydCkgZW5kID0gc3RhcnRcblxuICAvLyBDb3B5IDAgYnl0ZXM7IHdlJ3JlIGRvbmVcbiAgaWYgKGVuZCA9PT0gc3RhcnQpIHJldHVybiAwXG4gIGlmICh0YXJnZXQubGVuZ3RoID09PSAwIHx8IHRoaXMubGVuZ3RoID09PSAwKSByZXR1cm4gMFxuXG4gIC8vIEZhdGFsIGVycm9yIGNvbmRpdGlvbnNcbiAgaWYgKHRhcmdldFN0YXJ0IDwgMCkge1xuICAgIHRocm93IG5ldyBSYW5nZUVycm9yKCd0YXJnZXRTdGFydCBvdXQgb2YgYm91bmRzJylcbiAgfVxuICBpZiAoc3RhcnQgPCAwIHx8IHN0YXJ0ID49IHRoaXMubGVuZ3RoKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcignc291cmNlU3RhcnQgb3V0IG9mIGJvdW5kcycpXG4gIGlmIChlbmQgPCAwKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcignc291cmNlRW5kIG91dCBvZiBib3VuZHMnKVxuXG4gIC8vIEFyZSB3ZSBvb2I/XG4gIGlmIChlbmQgPiB0aGlzLmxlbmd0aCkgZW5kID0gdGhpcy5sZW5ndGhcbiAgaWYgKHRhcmdldC5sZW5ndGggLSB0YXJnZXRTdGFydCA8IGVuZCAtIHN0YXJ0KSB7XG4gICAgZW5kID0gdGFyZ2V0Lmxlbmd0aCAtIHRhcmdldFN0YXJ0ICsgc3RhcnRcbiAgfVxuXG4gIHZhciBsZW4gPSBlbmQgLSBzdGFydFxuXG4gIGlmIChsZW4gPCAxMDAwIHx8ICFCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuOyBpKyspIHtcbiAgICAgIHRhcmdldFtpICsgdGFyZ2V0U3RhcnRdID0gdGhpc1tpICsgc3RhcnRdXG4gICAgfVxuICB9IGVsc2Uge1xuICAgIHRhcmdldC5fc2V0KHRoaXMuc3ViYXJyYXkoc3RhcnQsIHN0YXJ0ICsgbGVuKSwgdGFyZ2V0U3RhcnQpXG4gIH1cblxuICByZXR1cm4gbGVuXG59XG5cbi8vIGZpbGwodmFsdWUsIHN0YXJ0PTAsIGVuZD1idWZmZXIubGVuZ3RoKVxuQnVmZmVyLnByb3RvdHlwZS5maWxsID0gZnVuY3Rpb24gZmlsbCAodmFsdWUsIHN0YXJ0LCBlbmQpIHtcbiAgaWYgKCF2YWx1ZSkgdmFsdWUgPSAwXG4gIGlmICghc3RhcnQpIHN0YXJ0ID0gMFxuICBpZiAoIWVuZCkgZW5kID0gdGhpcy5sZW5ndGhcblxuICBpZiAoZW5kIDwgc3RhcnQpIHRocm93IG5ldyBSYW5nZUVycm9yKCdlbmQgPCBzdGFydCcpXG5cbiAgLy8gRmlsbCAwIGJ5dGVzOyB3ZSdyZSBkb25lXG4gIGlmIChlbmQgPT09IHN0YXJ0KSByZXR1cm5cbiAgaWYgKHRoaXMubGVuZ3RoID09PSAwKSByZXR1cm5cblxuICBpZiAoc3RhcnQgPCAwIHx8IHN0YXJ0ID49IHRoaXMubGVuZ3RoKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcignc3RhcnQgb3V0IG9mIGJvdW5kcycpXG4gIGlmIChlbmQgPCAwIHx8IGVuZCA+IHRoaXMubGVuZ3RoKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcignZW5kIG91dCBvZiBib3VuZHMnKVxuXG4gIHZhciBpXG4gIGlmICh0eXBlb2YgdmFsdWUgPT09ICdudW1iZXInKSB7XG4gICAgZm9yIChpID0gc3RhcnQ7IGkgPCBlbmQ7IGkrKykge1xuICAgICAgdGhpc1tpXSA9IHZhbHVlXG4gICAgfVxuICB9IGVsc2Uge1xuICAgIHZhciBieXRlcyA9IHV0ZjhUb0J5dGVzKHZhbHVlLnRvU3RyaW5nKCkpXG4gICAgdmFyIGxlbiA9IGJ5dGVzLmxlbmd0aFxuICAgIGZvciAoaSA9IHN0YXJ0OyBpIDwgZW5kOyBpKyspIHtcbiAgICAgIHRoaXNbaV0gPSBieXRlc1tpICUgbGVuXVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiB0aGlzXG59XG5cbi8qKlxuICogQ3JlYXRlcyBhIG5ldyBgQXJyYXlCdWZmZXJgIHdpdGggdGhlICpjb3BpZWQqIG1lbW9yeSBvZiB0aGUgYnVmZmVyIGluc3RhbmNlLlxuICogQWRkZWQgaW4gTm9kZSAwLjEyLiBPbmx5IGF2YWlsYWJsZSBpbiBicm93c2VycyB0aGF0IHN1cHBvcnQgQXJyYXlCdWZmZXIuXG4gKi9cbkJ1ZmZlci5wcm90b3R5cGUudG9BcnJheUJ1ZmZlciA9IGZ1bmN0aW9uIHRvQXJyYXlCdWZmZXIgKCkge1xuICBpZiAodHlwZW9mIFVpbnQ4QXJyYXkgIT09ICd1bmRlZmluZWQnKSB7XG4gICAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgICByZXR1cm4gKG5ldyBCdWZmZXIodGhpcykpLmJ1ZmZlclxuICAgIH0gZWxzZSB7XG4gICAgICB2YXIgYnVmID0gbmV3IFVpbnQ4QXJyYXkodGhpcy5sZW5ndGgpXG4gICAgICBmb3IgKHZhciBpID0gMCwgbGVuID0gYnVmLmxlbmd0aDsgaSA8IGxlbjsgaSArPSAxKSB7XG4gICAgICAgIGJ1ZltpXSA9IHRoaXNbaV1cbiAgICAgIH1cbiAgICAgIHJldHVybiBidWYuYnVmZmVyXG4gICAgfVxuICB9IGVsc2Uge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ0J1ZmZlci50b0FycmF5QnVmZmVyIG5vdCBzdXBwb3J0ZWQgaW4gdGhpcyBicm93c2VyJylcbiAgfVxufVxuXG4vLyBIRUxQRVIgRlVOQ1RJT05TXG4vLyA9PT09PT09PT09PT09PT09XG5cbnZhciBCUCA9IEJ1ZmZlci5wcm90b3R5cGVcblxuLyoqXG4gKiBBdWdtZW50IGEgVWludDhBcnJheSAqaW5zdGFuY2UqIChub3QgdGhlIFVpbnQ4QXJyYXkgY2xhc3MhKSB3aXRoIEJ1ZmZlciBtZXRob2RzXG4gKi9cbkJ1ZmZlci5fYXVnbWVudCA9IGZ1bmN0aW9uIF9hdWdtZW50IChhcnIpIHtcbiAgYXJyLmNvbnN0cnVjdG9yID0gQnVmZmVyXG4gIGFyci5faXNCdWZmZXIgPSB0cnVlXG5cbiAgLy8gc2F2ZSByZWZlcmVuY2UgdG8gb3JpZ2luYWwgVWludDhBcnJheSBzZXQgbWV0aG9kIGJlZm9yZSBvdmVyd3JpdGluZ1xuICBhcnIuX3NldCA9IGFyci5zZXRcblxuICAvLyBkZXByZWNhdGVkLCB3aWxsIGJlIHJlbW92ZWQgaW4gbm9kZSAwLjEzK1xuICBhcnIuZ2V0ID0gQlAuZ2V0XG4gIGFyci5zZXQgPSBCUC5zZXRcblxuICBhcnIud3JpdGUgPSBCUC53cml0ZVxuICBhcnIudG9TdHJpbmcgPSBCUC50b1N0cmluZ1xuICBhcnIudG9Mb2NhbGVTdHJpbmcgPSBCUC50b1N0cmluZ1xuICBhcnIudG9KU09OID0gQlAudG9KU09OXG4gIGFyci5lcXVhbHMgPSBCUC5lcXVhbHNcbiAgYXJyLmNvbXBhcmUgPSBCUC5jb21wYXJlXG4gIGFyci5pbmRleE9mID0gQlAuaW5kZXhPZlxuICBhcnIuY29weSA9IEJQLmNvcHlcbiAgYXJyLnNsaWNlID0gQlAuc2xpY2VcbiAgYXJyLnJlYWRVSW50TEUgPSBCUC5yZWFkVUludExFXG4gIGFyci5yZWFkVUludEJFID0gQlAucmVhZFVJbnRCRVxuICBhcnIucmVhZFVJbnQ4ID0gQlAucmVhZFVJbnQ4XG4gIGFyci5yZWFkVUludDE2TEUgPSBCUC5yZWFkVUludDE2TEVcbiAgYXJyLnJlYWRVSW50MTZCRSA9IEJQLnJlYWRVSW50MTZCRVxuICBhcnIucmVhZFVJbnQzMkxFID0gQlAucmVhZFVJbnQzMkxFXG4gIGFyci5yZWFkVUludDMyQkUgPSBCUC5yZWFkVUludDMyQkVcbiAgYXJyLnJlYWRJbnRMRSA9IEJQLnJlYWRJbnRMRVxuICBhcnIucmVhZEludEJFID0gQlAucmVhZEludEJFXG4gIGFyci5yZWFkSW50OCA9IEJQLnJlYWRJbnQ4XG4gIGFyci5yZWFkSW50MTZMRSA9IEJQLnJlYWRJbnQxNkxFXG4gIGFyci5yZWFkSW50MTZCRSA9IEJQLnJlYWRJbnQxNkJFXG4gIGFyci5yZWFkSW50MzJMRSA9IEJQLnJlYWRJbnQzMkxFXG4gIGFyci5yZWFkSW50MzJCRSA9IEJQLnJlYWRJbnQzMkJFXG4gIGFyci5yZWFkRmxvYXRMRSA9IEJQLnJlYWRGbG9hdExFXG4gIGFyci5yZWFkRmxvYXRCRSA9IEJQLnJlYWRGbG9hdEJFXG4gIGFyci5yZWFkRG91YmxlTEUgPSBCUC5yZWFkRG91YmxlTEVcbiAgYXJyLnJlYWREb3VibGVCRSA9IEJQLnJlYWREb3VibGVCRVxuICBhcnIud3JpdGVVSW50OCA9IEJQLndyaXRlVUludDhcbiAgYXJyLndyaXRlVUludExFID0gQlAud3JpdGVVSW50TEVcbiAgYXJyLndyaXRlVUludEJFID0gQlAud3JpdGVVSW50QkVcbiAgYXJyLndyaXRlVUludDE2TEUgPSBCUC53cml0ZVVJbnQxNkxFXG4gIGFyci53cml0ZVVJbnQxNkJFID0gQlAud3JpdGVVSW50MTZCRVxuICBhcnIud3JpdGVVSW50MzJMRSA9IEJQLndyaXRlVUludDMyTEVcbiAgYXJyLndyaXRlVUludDMyQkUgPSBCUC53cml0ZVVJbnQzMkJFXG4gIGFyci53cml0ZUludExFID0gQlAud3JpdGVJbnRMRVxuICBhcnIud3JpdGVJbnRCRSA9IEJQLndyaXRlSW50QkVcbiAgYXJyLndyaXRlSW50OCA9IEJQLndyaXRlSW50OFxuICBhcnIud3JpdGVJbnQxNkxFID0gQlAud3JpdGVJbnQxNkxFXG4gIGFyci53cml0ZUludDE2QkUgPSBCUC53cml0ZUludDE2QkVcbiAgYXJyLndyaXRlSW50MzJMRSA9IEJQLndyaXRlSW50MzJMRVxuICBhcnIud3JpdGVJbnQzMkJFID0gQlAud3JpdGVJbnQzMkJFXG4gIGFyci53cml0ZUZsb2F0TEUgPSBCUC53cml0ZUZsb2F0TEVcbiAgYXJyLndyaXRlRmxvYXRCRSA9IEJQLndyaXRlRmxvYXRCRVxuICBhcnIud3JpdGVEb3VibGVMRSA9IEJQLndyaXRlRG91YmxlTEVcbiAgYXJyLndyaXRlRG91YmxlQkUgPSBCUC53cml0ZURvdWJsZUJFXG4gIGFyci5maWxsID0gQlAuZmlsbFxuICBhcnIuaW5zcGVjdCA9IEJQLmluc3BlY3RcbiAgYXJyLnRvQXJyYXlCdWZmZXIgPSBCUC50b0FycmF5QnVmZmVyXG5cbiAgcmV0dXJuIGFyclxufVxuXG52YXIgSU5WQUxJRF9CQVNFNjRfUkUgPSAvW14rXFwvMC05QS16XFwtXS9nXG5cbmZ1bmN0aW9uIGJhc2U2NGNsZWFuIChzdHIpIHtcbiAgLy8gTm9kZSBzdHJpcHMgb3V0IGludmFsaWQgY2hhcmFjdGVycyBsaWtlIFxcbiBhbmQgXFx0IGZyb20gdGhlIHN0cmluZywgYmFzZTY0LWpzIGRvZXMgbm90XG4gIHN0ciA9IHN0cmluZ3RyaW0oc3RyKS5yZXBsYWNlKElOVkFMSURfQkFTRTY0X1JFLCAnJylcbiAgLy8gTm9kZSBjb252ZXJ0cyBzdHJpbmdzIHdpdGggbGVuZ3RoIDwgMiB0byAnJ1xuICBpZiAoc3RyLmxlbmd0aCA8IDIpIHJldHVybiAnJ1xuICAvLyBOb2RlIGFsbG93cyBmb3Igbm9uLXBhZGRlZCBiYXNlNjQgc3RyaW5ncyAobWlzc2luZyB0cmFpbGluZyA9PT0pLCBiYXNlNjQtanMgZG9lcyBub3RcbiAgd2hpbGUgKHN0ci5sZW5ndGggJSA0ICE9PSAwKSB7XG4gICAgc3RyID0gc3RyICsgJz0nXG4gIH1cbiAgcmV0dXJuIHN0clxufVxuXG5mdW5jdGlvbiBzdHJpbmd0cmltIChzdHIpIHtcbiAgaWYgKHN0ci50cmltKSByZXR1cm4gc3RyLnRyaW0oKVxuICByZXR1cm4gc3RyLnJlcGxhY2UoL15cXHMrfFxccyskL2csICcnKVxufVxuXG5mdW5jdGlvbiB0b0hleCAobikge1xuICBpZiAobiA8IDE2KSByZXR1cm4gJzAnICsgbi50b1N0cmluZygxNilcbiAgcmV0dXJuIG4udG9TdHJpbmcoMTYpXG59XG5cbmZ1bmN0aW9uIHV0ZjhUb0J5dGVzIChzdHJpbmcsIHVuaXRzKSB7XG4gIHVuaXRzID0gdW5pdHMgfHwgSW5maW5pdHlcbiAgdmFyIGNvZGVQb2ludFxuICB2YXIgbGVuZ3RoID0gc3RyaW5nLmxlbmd0aFxuICB2YXIgbGVhZFN1cnJvZ2F0ZSA9IG51bGxcbiAgdmFyIGJ5dGVzID0gW11cbiAgdmFyIGkgPSAwXG5cbiAgZm9yICg7IGkgPCBsZW5ndGg7IGkrKykge1xuICAgIGNvZGVQb2ludCA9IHN0cmluZy5jaGFyQ29kZUF0KGkpXG5cbiAgICAvLyBpcyBzdXJyb2dhdGUgY29tcG9uZW50XG4gICAgaWYgKGNvZGVQb2ludCA+IDB4RDdGRiAmJiBjb2RlUG9pbnQgPCAweEUwMDApIHtcbiAgICAgIC8vIGxhc3QgY2hhciB3YXMgYSBsZWFkXG4gICAgICBpZiAobGVhZFN1cnJvZ2F0ZSkge1xuICAgICAgICAvLyAyIGxlYWRzIGluIGEgcm93XG4gICAgICAgIGlmIChjb2RlUG9pbnQgPCAweERDMDApIHtcbiAgICAgICAgICBpZiAoKHVuaXRzIC09IDMpID4gLTEpIGJ5dGVzLnB1c2goMHhFRiwgMHhCRiwgMHhCRClcbiAgICAgICAgICBsZWFkU3Vycm9nYXRlID0gY29kZVBvaW50XG4gICAgICAgICAgY29udGludWVcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAvLyB2YWxpZCBzdXJyb2dhdGUgcGFpclxuICAgICAgICAgIGNvZGVQb2ludCA9IGxlYWRTdXJyb2dhdGUgLSAweEQ4MDAgPDwgMTAgfCBjb2RlUG9pbnQgLSAweERDMDAgfCAweDEwMDAwXG4gICAgICAgICAgbGVhZFN1cnJvZ2F0ZSA9IG51bGxcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgLy8gbm8gbGVhZCB5ZXRcblxuICAgICAgICBpZiAoY29kZVBvaW50ID4gMHhEQkZGKSB7XG4gICAgICAgICAgLy8gdW5leHBlY3RlZCB0cmFpbFxuICAgICAgICAgIGlmICgodW5pdHMgLT0gMykgPiAtMSkgYnl0ZXMucHVzaCgweEVGLCAweEJGLCAweEJEKVxuICAgICAgICAgIGNvbnRpbnVlXG4gICAgICAgIH0gZWxzZSBpZiAoaSArIDEgPT09IGxlbmd0aCkge1xuICAgICAgICAgIC8vIHVucGFpcmVkIGxlYWRcbiAgICAgICAgICBpZiAoKHVuaXRzIC09IDMpID4gLTEpIGJ5dGVzLnB1c2goMHhFRiwgMHhCRiwgMHhCRClcbiAgICAgICAgICBjb250aW51ZVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIC8vIHZhbGlkIGxlYWRcbiAgICAgICAgICBsZWFkU3Vycm9nYXRlID0gY29kZVBvaW50XG4gICAgICAgICAgY29udGludWVcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0gZWxzZSBpZiAobGVhZFN1cnJvZ2F0ZSkge1xuICAgICAgLy8gdmFsaWQgYm1wIGNoYXIsIGJ1dCBsYXN0IGNoYXIgd2FzIGEgbGVhZFxuICAgICAgaWYgKCh1bml0cyAtPSAzKSA+IC0xKSBieXRlcy5wdXNoKDB4RUYsIDB4QkYsIDB4QkQpXG4gICAgICBsZWFkU3Vycm9nYXRlID0gbnVsbFxuICAgIH1cblxuICAgIC8vIGVuY29kZSB1dGY4XG4gICAgaWYgKGNvZGVQb2ludCA8IDB4ODApIHtcbiAgICAgIGlmICgodW5pdHMgLT0gMSkgPCAwKSBicmVha1xuICAgICAgYnl0ZXMucHVzaChjb2RlUG9pbnQpXG4gICAgfSBlbHNlIGlmIChjb2RlUG9pbnQgPCAweDgwMCkge1xuICAgICAgaWYgKCh1bml0cyAtPSAyKSA8IDApIGJyZWFrXG4gICAgICBieXRlcy5wdXNoKFxuICAgICAgICBjb2RlUG9pbnQgPj4gMHg2IHwgMHhDMCxcbiAgICAgICAgY29kZVBvaW50ICYgMHgzRiB8IDB4ODBcbiAgICAgIClcbiAgICB9IGVsc2UgaWYgKGNvZGVQb2ludCA8IDB4MTAwMDApIHtcbiAgICAgIGlmICgodW5pdHMgLT0gMykgPCAwKSBicmVha1xuICAgICAgYnl0ZXMucHVzaChcbiAgICAgICAgY29kZVBvaW50ID4+IDB4QyB8IDB4RTAsXG4gICAgICAgIGNvZGVQb2ludCA+PiAweDYgJiAweDNGIHwgMHg4MCxcbiAgICAgICAgY29kZVBvaW50ICYgMHgzRiB8IDB4ODBcbiAgICAgIClcbiAgICB9IGVsc2UgaWYgKGNvZGVQb2ludCA8IDB4MjAwMDAwKSB7XG4gICAgICBpZiAoKHVuaXRzIC09IDQpIDwgMCkgYnJlYWtcbiAgICAgIGJ5dGVzLnB1c2goXG4gICAgICAgIGNvZGVQb2ludCA+PiAweDEyIHwgMHhGMCxcbiAgICAgICAgY29kZVBvaW50ID4+IDB4QyAmIDB4M0YgfCAweDgwLFxuICAgICAgICBjb2RlUG9pbnQgPj4gMHg2ICYgMHgzRiB8IDB4ODAsXG4gICAgICAgIGNvZGVQb2ludCAmIDB4M0YgfCAweDgwXG4gICAgICApXG4gICAgfSBlbHNlIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignSW52YWxpZCBjb2RlIHBvaW50JylcbiAgICB9XG4gIH1cblxuICByZXR1cm4gYnl0ZXNcbn1cblxuZnVuY3Rpb24gYXNjaWlUb0J5dGVzIChzdHIpIHtcbiAgdmFyIGJ5dGVBcnJheSA9IFtdXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgc3RyLmxlbmd0aDsgaSsrKSB7XG4gICAgLy8gTm9kZSdzIGNvZGUgc2VlbXMgdG8gYmUgZG9pbmcgdGhpcyBhbmQgbm90ICYgMHg3Ri4uXG4gICAgYnl0ZUFycmF5LnB1c2goc3RyLmNoYXJDb2RlQXQoaSkgJiAweEZGKVxuICB9XG4gIHJldHVybiBieXRlQXJyYXlcbn1cblxuZnVuY3Rpb24gdXRmMTZsZVRvQnl0ZXMgKHN0ciwgdW5pdHMpIHtcbiAgdmFyIGMsIGhpLCBsb1xuICB2YXIgYnl0ZUFycmF5ID0gW11cbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBzdHIubGVuZ3RoOyBpKyspIHtcbiAgICBpZiAoKHVuaXRzIC09IDIpIDwgMCkgYnJlYWtcblxuICAgIGMgPSBzdHIuY2hhckNvZGVBdChpKVxuICAgIGhpID0gYyA+PiA4XG4gICAgbG8gPSBjICUgMjU2XG4gICAgYnl0ZUFycmF5LnB1c2gobG8pXG4gICAgYnl0ZUFycmF5LnB1c2goaGkpXG4gIH1cblxuICByZXR1cm4gYnl0ZUFycmF5XG59XG5cbmZ1bmN0aW9uIGJhc2U2NFRvQnl0ZXMgKHN0cikge1xuICByZXR1cm4gYmFzZTY0LnRvQnl0ZUFycmF5KGJhc2U2NGNsZWFuKHN0cikpXG59XG5cbmZ1bmN0aW9uIGJsaXRCdWZmZXIgKHNyYywgZHN0LCBvZmZzZXQsIGxlbmd0aCkge1xuICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbmd0aDsgaSsrKSB7XG4gICAgaWYgKChpICsgb2Zmc2V0ID49IGRzdC5sZW5ndGgpIHx8IChpID49IHNyYy5sZW5ndGgpKSBicmVha1xuICAgIGRzdFtpICsgb2Zmc2V0XSA9IHNyY1tpXVxuICB9XG4gIHJldHVybiBpXG59XG5cbmZ1bmN0aW9uIGRlY29kZVV0ZjhDaGFyIChzdHIpIHtcbiAgdHJ5IHtcbiAgICByZXR1cm4gZGVjb2RlVVJJQ29tcG9uZW50KHN0cilcbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgcmV0dXJuIFN0cmluZy5mcm9tQ2hhckNvZGUoMHhGRkZEKSAvLyBVVEYgOCBpbnZhbGlkIGNoYXJcbiAgfVxufVxuIiwidmFyIGxvb2t1cCA9ICdBQkNERUZHSElKS0xNTk9QUVJTVFVWV1hZWmFiY2RlZmdoaWprbG1ub3BxcnN0dXZ3eHl6MDEyMzQ1Njc4OSsvJztcblxuOyhmdW5jdGlvbiAoZXhwb3J0cykge1xuXHQndXNlIHN0cmljdCc7XG5cbiAgdmFyIEFyciA9ICh0eXBlb2YgVWludDhBcnJheSAhPT0gJ3VuZGVmaW5lZCcpXG4gICAgPyBVaW50OEFycmF5XG4gICAgOiBBcnJheVxuXG5cdHZhciBQTFVTICAgPSAnKycuY2hhckNvZGVBdCgwKVxuXHR2YXIgU0xBU0ggID0gJy8nLmNoYXJDb2RlQXQoMClcblx0dmFyIE5VTUJFUiA9ICcwJy5jaGFyQ29kZUF0KDApXG5cdHZhciBMT1dFUiAgPSAnYScuY2hhckNvZGVBdCgwKVxuXHR2YXIgVVBQRVIgID0gJ0EnLmNoYXJDb2RlQXQoMClcblx0dmFyIFBMVVNfVVJMX1NBRkUgPSAnLScuY2hhckNvZGVBdCgwKVxuXHR2YXIgU0xBU0hfVVJMX1NBRkUgPSAnXycuY2hhckNvZGVBdCgwKVxuXG5cdGZ1bmN0aW9uIGRlY29kZSAoZWx0KSB7XG5cdFx0dmFyIGNvZGUgPSBlbHQuY2hhckNvZGVBdCgwKVxuXHRcdGlmIChjb2RlID09PSBQTFVTIHx8XG5cdFx0ICAgIGNvZGUgPT09IFBMVVNfVVJMX1NBRkUpXG5cdFx0XHRyZXR1cm4gNjIgLy8gJysnXG5cdFx0aWYgKGNvZGUgPT09IFNMQVNIIHx8XG5cdFx0ICAgIGNvZGUgPT09IFNMQVNIX1VSTF9TQUZFKVxuXHRcdFx0cmV0dXJuIDYzIC8vICcvJ1xuXHRcdGlmIChjb2RlIDwgTlVNQkVSKVxuXHRcdFx0cmV0dXJuIC0xIC8vbm8gbWF0Y2hcblx0XHRpZiAoY29kZSA8IE5VTUJFUiArIDEwKVxuXHRcdFx0cmV0dXJuIGNvZGUgLSBOVU1CRVIgKyAyNiArIDI2XG5cdFx0aWYgKGNvZGUgPCBVUFBFUiArIDI2KVxuXHRcdFx0cmV0dXJuIGNvZGUgLSBVUFBFUlxuXHRcdGlmIChjb2RlIDwgTE9XRVIgKyAyNilcblx0XHRcdHJldHVybiBjb2RlIC0gTE9XRVIgKyAyNlxuXHR9XG5cblx0ZnVuY3Rpb24gYjY0VG9CeXRlQXJyYXkgKGI2NCkge1xuXHRcdHZhciBpLCBqLCBsLCB0bXAsIHBsYWNlSG9sZGVycywgYXJyXG5cblx0XHRpZiAoYjY0Lmxlbmd0aCAlIDQgPiAwKSB7XG5cdFx0XHR0aHJvdyBuZXcgRXJyb3IoJ0ludmFsaWQgc3RyaW5nLiBMZW5ndGggbXVzdCBiZSBhIG11bHRpcGxlIG9mIDQnKVxuXHRcdH1cblxuXHRcdC8vIHRoZSBudW1iZXIgb2YgZXF1YWwgc2lnbnMgKHBsYWNlIGhvbGRlcnMpXG5cdFx0Ly8gaWYgdGhlcmUgYXJlIHR3byBwbGFjZWhvbGRlcnMsIHRoYW4gdGhlIHR3byBjaGFyYWN0ZXJzIGJlZm9yZSBpdFxuXHRcdC8vIHJlcHJlc2VudCBvbmUgYnl0ZVxuXHRcdC8vIGlmIHRoZXJlIGlzIG9ubHkgb25lLCB0aGVuIHRoZSB0aHJlZSBjaGFyYWN0ZXJzIGJlZm9yZSBpdCByZXByZXNlbnQgMiBieXRlc1xuXHRcdC8vIHRoaXMgaXMganVzdCBhIGNoZWFwIGhhY2sgdG8gbm90IGRvIGluZGV4T2YgdHdpY2Vcblx0XHR2YXIgbGVuID0gYjY0Lmxlbmd0aFxuXHRcdHBsYWNlSG9sZGVycyA9ICc9JyA9PT0gYjY0LmNoYXJBdChsZW4gLSAyKSA/IDIgOiAnPScgPT09IGI2NC5jaGFyQXQobGVuIC0gMSkgPyAxIDogMFxuXG5cdFx0Ly8gYmFzZTY0IGlzIDQvMyArIHVwIHRvIHR3byBjaGFyYWN0ZXJzIG9mIHRoZSBvcmlnaW5hbCBkYXRhXG5cdFx0YXJyID0gbmV3IEFycihiNjQubGVuZ3RoICogMyAvIDQgLSBwbGFjZUhvbGRlcnMpXG5cblx0XHQvLyBpZiB0aGVyZSBhcmUgcGxhY2Vob2xkZXJzLCBvbmx5IGdldCB1cCB0byB0aGUgbGFzdCBjb21wbGV0ZSA0IGNoYXJzXG5cdFx0bCA9IHBsYWNlSG9sZGVycyA+IDAgPyBiNjQubGVuZ3RoIC0gNCA6IGI2NC5sZW5ndGhcblxuXHRcdHZhciBMID0gMFxuXG5cdFx0ZnVuY3Rpb24gcHVzaCAodikge1xuXHRcdFx0YXJyW0wrK10gPSB2XG5cdFx0fVxuXG5cdFx0Zm9yIChpID0gMCwgaiA9IDA7IGkgPCBsOyBpICs9IDQsIGogKz0gMykge1xuXHRcdFx0dG1wID0gKGRlY29kZShiNjQuY2hhckF0KGkpKSA8PCAxOCkgfCAoZGVjb2RlKGI2NC5jaGFyQXQoaSArIDEpKSA8PCAxMikgfCAoZGVjb2RlKGI2NC5jaGFyQXQoaSArIDIpKSA8PCA2KSB8IGRlY29kZShiNjQuY2hhckF0KGkgKyAzKSlcblx0XHRcdHB1c2goKHRtcCAmIDB4RkYwMDAwKSA+PiAxNilcblx0XHRcdHB1c2goKHRtcCAmIDB4RkYwMCkgPj4gOClcblx0XHRcdHB1c2godG1wICYgMHhGRilcblx0XHR9XG5cblx0XHRpZiAocGxhY2VIb2xkZXJzID09PSAyKSB7XG5cdFx0XHR0bXAgPSAoZGVjb2RlKGI2NC5jaGFyQXQoaSkpIDw8IDIpIHwgKGRlY29kZShiNjQuY2hhckF0KGkgKyAxKSkgPj4gNClcblx0XHRcdHB1c2godG1wICYgMHhGRilcblx0XHR9IGVsc2UgaWYgKHBsYWNlSG9sZGVycyA9PT0gMSkge1xuXHRcdFx0dG1wID0gKGRlY29kZShiNjQuY2hhckF0KGkpKSA8PCAxMCkgfCAoZGVjb2RlKGI2NC5jaGFyQXQoaSArIDEpKSA8PCA0KSB8IChkZWNvZGUoYjY0LmNoYXJBdChpICsgMikpID4+IDIpXG5cdFx0XHRwdXNoKCh0bXAgPj4gOCkgJiAweEZGKVxuXHRcdFx0cHVzaCh0bXAgJiAweEZGKVxuXHRcdH1cblxuXHRcdHJldHVybiBhcnJcblx0fVxuXG5cdGZ1bmN0aW9uIHVpbnQ4VG9CYXNlNjQgKHVpbnQ4KSB7XG5cdFx0dmFyIGksXG5cdFx0XHRleHRyYUJ5dGVzID0gdWludDgubGVuZ3RoICUgMywgLy8gaWYgd2UgaGF2ZSAxIGJ5dGUgbGVmdCwgcGFkIDIgYnl0ZXNcblx0XHRcdG91dHB1dCA9IFwiXCIsXG5cdFx0XHR0ZW1wLCBsZW5ndGhcblxuXHRcdGZ1bmN0aW9uIGVuY29kZSAobnVtKSB7XG5cdFx0XHRyZXR1cm4gbG9va3VwLmNoYXJBdChudW0pXG5cdFx0fVxuXG5cdFx0ZnVuY3Rpb24gdHJpcGxldFRvQmFzZTY0IChudW0pIHtcblx0XHRcdHJldHVybiBlbmNvZGUobnVtID4+IDE4ICYgMHgzRikgKyBlbmNvZGUobnVtID4+IDEyICYgMHgzRikgKyBlbmNvZGUobnVtID4+IDYgJiAweDNGKSArIGVuY29kZShudW0gJiAweDNGKVxuXHRcdH1cblxuXHRcdC8vIGdvIHRocm91Z2ggdGhlIGFycmF5IGV2ZXJ5IHRocmVlIGJ5dGVzLCB3ZSdsbCBkZWFsIHdpdGggdHJhaWxpbmcgc3R1ZmYgbGF0ZXJcblx0XHRmb3IgKGkgPSAwLCBsZW5ndGggPSB1aW50OC5sZW5ndGggLSBleHRyYUJ5dGVzOyBpIDwgbGVuZ3RoOyBpICs9IDMpIHtcblx0XHRcdHRlbXAgPSAodWludDhbaV0gPDwgMTYpICsgKHVpbnQ4W2kgKyAxXSA8PCA4KSArICh1aW50OFtpICsgMl0pXG5cdFx0XHRvdXRwdXQgKz0gdHJpcGxldFRvQmFzZTY0KHRlbXApXG5cdFx0fVxuXG5cdFx0Ly8gcGFkIHRoZSBlbmQgd2l0aCB6ZXJvcywgYnV0IG1ha2Ugc3VyZSB0byBub3QgZm9yZ2V0IHRoZSBleHRyYSBieXRlc1xuXHRcdHN3aXRjaCAoZXh0cmFCeXRlcykge1xuXHRcdFx0Y2FzZSAxOlxuXHRcdFx0XHR0ZW1wID0gdWludDhbdWludDgubGVuZ3RoIC0gMV1cblx0XHRcdFx0b3V0cHV0ICs9IGVuY29kZSh0ZW1wID4+IDIpXG5cdFx0XHRcdG91dHB1dCArPSBlbmNvZGUoKHRlbXAgPDwgNCkgJiAweDNGKVxuXHRcdFx0XHRvdXRwdXQgKz0gJz09J1xuXHRcdFx0XHRicmVha1xuXHRcdFx0Y2FzZSAyOlxuXHRcdFx0XHR0ZW1wID0gKHVpbnQ4W3VpbnQ4Lmxlbmd0aCAtIDJdIDw8IDgpICsgKHVpbnQ4W3VpbnQ4Lmxlbmd0aCAtIDFdKVxuXHRcdFx0XHRvdXRwdXQgKz0gZW5jb2RlKHRlbXAgPj4gMTApXG5cdFx0XHRcdG91dHB1dCArPSBlbmNvZGUoKHRlbXAgPj4gNCkgJiAweDNGKVxuXHRcdFx0XHRvdXRwdXQgKz0gZW5jb2RlKCh0ZW1wIDw8IDIpICYgMHgzRilcblx0XHRcdFx0b3V0cHV0ICs9ICc9J1xuXHRcdFx0XHRicmVha1xuXHRcdH1cblxuXHRcdHJldHVybiBvdXRwdXRcblx0fVxuXG5cdGV4cG9ydHMudG9CeXRlQXJyYXkgPSBiNjRUb0J5dGVBcnJheVxuXHRleHBvcnRzLmZyb21CeXRlQXJyYXkgPSB1aW50OFRvQmFzZTY0XG59KHR5cGVvZiBleHBvcnRzID09PSAndW5kZWZpbmVkJyA/ICh0aGlzLmJhc2U2NGpzID0ge30pIDogZXhwb3J0cykpXG4iLCJleHBvcnRzLnJlYWQgPSBmdW5jdGlvbiAoYnVmZmVyLCBvZmZzZXQsIGlzTEUsIG1MZW4sIG5CeXRlcykge1xuICB2YXIgZSwgbVxuICB2YXIgZUxlbiA9IG5CeXRlcyAqIDggLSBtTGVuIC0gMVxuICB2YXIgZU1heCA9ICgxIDw8IGVMZW4pIC0gMVxuICB2YXIgZUJpYXMgPSBlTWF4ID4+IDFcbiAgdmFyIG5CaXRzID0gLTdcbiAgdmFyIGkgPSBpc0xFID8gKG5CeXRlcyAtIDEpIDogMFxuICB2YXIgZCA9IGlzTEUgPyAtMSA6IDFcbiAgdmFyIHMgPSBidWZmZXJbb2Zmc2V0ICsgaV1cblxuICBpICs9IGRcblxuICBlID0gcyAmICgoMSA8PCAoLW5CaXRzKSkgLSAxKVxuICBzID4+PSAoLW5CaXRzKVxuICBuQml0cyArPSBlTGVuXG4gIGZvciAoOyBuQml0cyA+IDA7IGUgPSBlICogMjU2ICsgYnVmZmVyW29mZnNldCArIGldLCBpICs9IGQsIG5CaXRzIC09IDgpIHt9XG5cbiAgbSA9IGUgJiAoKDEgPDwgKC1uQml0cykpIC0gMSlcbiAgZSA+Pj0gKC1uQml0cylcbiAgbkJpdHMgKz0gbUxlblxuICBmb3IgKDsgbkJpdHMgPiAwOyBtID0gbSAqIDI1NiArIGJ1ZmZlcltvZmZzZXQgKyBpXSwgaSArPSBkLCBuQml0cyAtPSA4KSB7fVxuXG4gIGlmIChlID09PSAwKSB7XG4gICAgZSA9IDEgLSBlQmlhc1xuICB9IGVsc2UgaWYgKGUgPT09IGVNYXgpIHtcbiAgICByZXR1cm4gbSA/IE5hTiA6ICgocyA/IC0xIDogMSkgKiBJbmZpbml0eSlcbiAgfSBlbHNlIHtcbiAgICBtID0gbSArIE1hdGgucG93KDIsIG1MZW4pXG4gICAgZSA9IGUgLSBlQmlhc1xuICB9XG4gIHJldHVybiAocyA/IC0xIDogMSkgKiBtICogTWF0aC5wb3coMiwgZSAtIG1MZW4pXG59XG5cbmV4cG9ydHMud3JpdGUgPSBmdW5jdGlvbiAoYnVmZmVyLCB2YWx1ZSwgb2Zmc2V0LCBpc0xFLCBtTGVuLCBuQnl0ZXMpIHtcbiAgdmFyIGUsIG0sIGNcbiAgdmFyIGVMZW4gPSBuQnl0ZXMgKiA4IC0gbUxlbiAtIDFcbiAgdmFyIGVNYXggPSAoMSA8PCBlTGVuKSAtIDFcbiAgdmFyIGVCaWFzID0gZU1heCA+PiAxXG4gIHZhciBydCA9IChtTGVuID09PSAyMyA/IE1hdGgucG93KDIsIC0yNCkgLSBNYXRoLnBvdygyLCAtNzcpIDogMClcbiAgdmFyIGkgPSBpc0xFID8gMCA6IChuQnl0ZXMgLSAxKVxuICB2YXIgZCA9IGlzTEUgPyAxIDogLTFcbiAgdmFyIHMgPSB2YWx1ZSA8IDAgfHwgKHZhbHVlID09PSAwICYmIDEgLyB2YWx1ZSA8IDApID8gMSA6IDBcblxuICB2YWx1ZSA9IE1hdGguYWJzKHZhbHVlKVxuXG4gIGlmIChpc05hTih2YWx1ZSkgfHwgdmFsdWUgPT09IEluZmluaXR5KSB7XG4gICAgbSA9IGlzTmFOKHZhbHVlKSA/IDEgOiAwXG4gICAgZSA9IGVNYXhcbiAgfSBlbHNlIHtcbiAgICBlID0gTWF0aC5mbG9vcihNYXRoLmxvZyh2YWx1ZSkgLyBNYXRoLkxOMilcbiAgICBpZiAodmFsdWUgKiAoYyA9IE1hdGgucG93KDIsIC1lKSkgPCAxKSB7XG4gICAgICBlLS1cbiAgICAgIGMgKj0gMlxuICAgIH1cbiAgICBpZiAoZSArIGVCaWFzID49IDEpIHtcbiAgICAgIHZhbHVlICs9IHJ0IC8gY1xuICAgIH0gZWxzZSB7XG4gICAgICB2YWx1ZSArPSBydCAqIE1hdGgucG93KDIsIDEgLSBlQmlhcylcbiAgICB9XG4gICAgaWYgKHZhbHVlICogYyA+PSAyKSB7XG4gICAgICBlKytcbiAgICAgIGMgLz0gMlxuICAgIH1cblxuICAgIGlmIChlICsgZUJpYXMgPj0gZU1heCkge1xuICAgICAgbSA9IDBcbiAgICAgIGUgPSBlTWF4XG4gICAgfSBlbHNlIGlmIChlICsgZUJpYXMgPj0gMSkge1xuICAgICAgbSA9ICh2YWx1ZSAqIGMgLSAxKSAqIE1hdGgucG93KDIsIG1MZW4pXG4gICAgICBlID0gZSArIGVCaWFzXG4gICAgfSBlbHNlIHtcbiAgICAgIG0gPSB2YWx1ZSAqIE1hdGgucG93KDIsIGVCaWFzIC0gMSkgKiBNYXRoLnBvdygyLCBtTGVuKVxuICAgICAgZSA9IDBcbiAgICB9XG4gIH1cblxuICBmb3IgKDsgbUxlbiA+PSA4OyBidWZmZXJbb2Zmc2V0ICsgaV0gPSBtICYgMHhmZiwgaSArPSBkLCBtIC89IDI1NiwgbUxlbiAtPSA4KSB7fVxuXG4gIGUgPSAoZSA8PCBtTGVuKSB8IG1cbiAgZUxlbiArPSBtTGVuXG4gIGZvciAoOyBlTGVuID4gMDsgYnVmZmVyW29mZnNldCArIGldID0gZSAmIDB4ZmYsIGkgKz0gZCwgZSAvPSAyNTYsIGVMZW4gLT0gOCkge31cblxuICBidWZmZXJbb2Zmc2V0ICsgaSAtIGRdIHw9IHMgKiAxMjhcbn1cbiIsIlxuLyoqXG4gKiBpc0FycmF5XG4gKi9cblxudmFyIGlzQXJyYXkgPSBBcnJheS5pc0FycmF5O1xuXG4vKipcbiAqIHRvU3RyaW5nXG4gKi9cblxudmFyIHN0ciA9IE9iamVjdC5wcm90b3R5cGUudG9TdHJpbmc7XG5cbi8qKlxuICogV2hldGhlciBvciBub3QgdGhlIGdpdmVuIGB2YWxgXG4gKiBpcyBhbiBhcnJheS5cbiAqXG4gKiBleGFtcGxlOlxuICpcbiAqICAgICAgICBpc0FycmF5KFtdKTtcbiAqICAgICAgICAvLyA+IHRydWVcbiAqICAgICAgICBpc0FycmF5KGFyZ3VtZW50cyk7XG4gKiAgICAgICAgLy8gPiBmYWxzZVxuICogICAgICAgIGlzQXJyYXkoJycpO1xuICogICAgICAgIC8vID4gZmFsc2VcbiAqXG4gKiBAcGFyYW0ge21peGVkfSB2YWxcbiAqIEByZXR1cm4ge2Jvb2x9XG4gKi9cblxubW9kdWxlLmV4cG9ydHMgPSBpc0FycmF5IHx8IGZ1bmN0aW9uICh2YWwpIHtcbiAgcmV0dXJuICEhIHZhbCAmJiAnW29iamVjdCBBcnJheV0nID09IHN0ci5jYWxsKHZhbCk7XG59O1xuIiwiLy8gc2hpbSBmb3IgdXNpbmcgcHJvY2VzcyBpbiBicm93c2VyXG5cbnZhciBwcm9jZXNzID0gbW9kdWxlLmV4cG9ydHMgPSB7fTtcbnZhciBxdWV1ZSA9IFtdO1xudmFyIGRyYWluaW5nID0gZmFsc2U7XG52YXIgY3VycmVudFF1ZXVlO1xudmFyIHF1ZXVlSW5kZXggPSAtMTtcblxuZnVuY3Rpb24gY2xlYW5VcE5leHRUaWNrKCkge1xuICAgIGRyYWluaW5nID0gZmFsc2U7XG4gICAgaWYgKGN1cnJlbnRRdWV1ZS5sZW5ndGgpIHtcbiAgICAgICAgcXVldWUgPSBjdXJyZW50UXVldWUuY29uY2F0KHF1ZXVlKTtcbiAgICB9IGVsc2Uge1xuICAgICAgICBxdWV1ZUluZGV4ID0gLTE7XG4gICAgfVxuICAgIGlmIChxdWV1ZS5sZW5ndGgpIHtcbiAgICAgICAgZHJhaW5RdWV1ZSgpO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gZHJhaW5RdWV1ZSgpIHtcbiAgICBpZiAoZHJhaW5pbmcpIHtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB2YXIgdGltZW91dCA9IHNldFRpbWVvdXQoY2xlYW5VcE5leHRUaWNrKTtcbiAgICBkcmFpbmluZyA9IHRydWU7XG5cbiAgICB2YXIgbGVuID0gcXVldWUubGVuZ3RoO1xuICAgIHdoaWxlKGxlbikge1xuICAgICAgICBjdXJyZW50UXVldWUgPSBxdWV1ZTtcbiAgICAgICAgcXVldWUgPSBbXTtcbiAgICAgICAgd2hpbGUgKCsrcXVldWVJbmRleCA8IGxlbikge1xuICAgICAgICAgICAgY3VycmVudFF1ZXVlW3F1ZXVlSW5kZXhdLnJ1bigpO1xuICAgICAgICB9XG4gICAgICAgIHF1ZXVlSW5kZXggPSAtMTtcbiAgICAgICAgbGVuID0gcXVldWUubGVuZ3RoO1xuICAgIH1cbiAgICBjdXJyZW50UXVldWUgPSBudWxsO1xuICAgIGRyYWluaW5nID0gZmFsc2U7XG4gICAgY2xlYXJUaW1lb3V0KHRpbWVvdXQpO1xufVxuXG5wcm9jZXNzLm5leHRUaWNrID0gZnVuY3Rpb24gKGZ1bikge1xuICAgIHZhciBhcmdzID0gbmV3IEFycmF5KGFyZ3VtZW50cy5sZW5ndGggLSAxKTtcbiAgICBpZiAoYXJndW1lbnRzLmxlbmd0aCA+IDEpIHtcbiAgICAgICAgZm9yICh2YXIgaSA9IDE7IGkgPCBhcmd1bWVudHMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIGFyZ3NbaSAtIDFdID0gYXJndW1lbnRzW2ldO1xuICAgICAgICB9XG4gICAgfVxuICAgIHF1ZXVlLnB1c2gobmV3IEl0ZW0oZnVuLCBhcmdzKSk7XG4gICAgaWYgKHF1ZXVlLmxlbmd0aCA9PT0gMSAmJiAhZHJhaW5pbmcpIHtcbiAgICAgICAgc2V0VGltZW91dChkcmFpblF1ZXVlLCAwKTtcbiAgICB9XG59O1xuXG4vLyB2OCBsaWtlcyBwcmVkaWN0aWJsZSBvYmplY3RzXG5mdW5jdGlvbiBJdGVtKGZ1biwgYXJyYXkpIHtcbiAgICB0aGlzLmZ1biA9IGZ1bjtcbiAgICB0aGlzLmFycmF5ID0gYXJyYXk7XG59XG5JdGVtLnByb3RvdHlwZS5ydW4gPSBmdW5jdGlvbiAoKSB7XG4gICAgdGhpcy5mdW4uYXBwbHkobnVsbCwgdGhpcy5hcnJheSk7XG59O1xucHJvY2Vzcy50aXRsZSA9ICdicm93c2VyJztcbnByb2Nlc3MuYnJvd3NlciA9IHRydWU7XG5wcm9jZXNzLmVudiA9IHt9O1xucHJvY2Vzcy5hcmd2ID0gW107XG5wcm9jZXNzLnZlcnNpb24gPSAnJzsgLy8gZW1wdHkgc3RyaW5nIHRvIGF2b2lkIHJlZ2V4cCBpc3N1ZXNcbnByb2Nlc3MudmVyc2lvbnMgPSB7fTtcblxuZnVuY3Rpb24gbm9vcCgpIHt9XG5cbnByb2Nlc3Mub24gPSBub29wO1xucHJvY2Vzcy5hZGRMaXN0ZW5lciA9IG5vb3A7XG5wcm9jZXNzLm9uY2UgPSBub29wO1xucHJvY2Vzcy5vZmYgPSBub29wO1xucHJvY2Vzcy5yZW1vdmVMaXN0ZW5lciA9IG5vb3A7XG5wcm9jZXNzLnJlbW92ZUFsbExpc3RlbmVycyA9IG5vb3A7XG5wcm9jZXNzLmVtaXQgPSBub29wO1xuXG5wcm9jZXNzLmJpbmRpbmcgPSBmdW5jdGlvbiAobmFtZSkge1xuICAgIHRocm93IG5ldyBFcnJvcigncHJvY2Vzcy5iaW5kaW5nIGlzIG5vdCBzdXBwb3J0ZWQnKTtcbn07XG5cbi8vIFRPRE8oc2h0eWxtYW4pXG5wcm9jZXNzLmN3ZCA9IGZ1bmN0aW9uICgpIHsgcmV0dXJuICcvJyB9O1xucHJvY2Vzcy5jaGRpciA9IGZ1bmN0aW9uIChkaXIpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ3Byb2Nlc3MuY2hkaXIgaXMgbm90IHN1cHBvcnRlZCcpO1xufTtcbnByb2Nlc3MudW1hc2sgPSBmdW5jdGlvbigpIHsgcmV0dXJuIDA7IH07XG4iLCJyZXF1aXJlKCcuL1RyYWNrJyk7XHJcbnJlcXVpcmUoJy4vR1VJJyk7XHJcbnJlcXVpcmUoJy4vUGFydGljaXBhbnQnKTtcclxud2luZG93LkNPTkZJRz1yZXF1aXJlKCcuL0NvbmZpZycpO1xyXG52YXIgVXRpbHM9cmVxdWlyZSgnLi9VdGlscycpO1xyXG5mb3IgKHZhciBlIGluIFV0aWxzKSBcclxuXHR3aW5kb3dbZV09VXRpbHNbZV07XHJcblxyXG52YXIgZHJhdztcclxudmFyIG1vZGlmeTtcclxudmFyIHNlbGVjdDtcclxuXHJcbndpbmRvdy5UUkFDSyA9IG5ldyBUcmFjaygpO1xyXG53aW5kb3cuR1VJID0gbmV3IEd1aShcclxue1xyXG5cdFx0dHJhY2tcdFx0OiBUUkFDSyxcclxuXHRcdGluaXRpYWxab29tIDogMlxyXG5cdFx0Ly9pbml0aWFsUG9zICA6IFtsb24sbGF0XSxcclxufSk7XHJcblxyXG5mdW5jdGlvbiBlcnJvclJvdXRlKGVycikge1xyXG5cdEdVSS5zaG93RXJyb3IoZXJyKTtcclxufVxyXG5cclxuZnVuY3Rpb24gaW5pdEdVSSgpIFxyXG57XHJcblx0aWYgKEdVSS5pc19pbml0KSB7XHJcblx0XHRzZWxlY3QuZ2V0RmVhdHVyZXMoKS5jbGVhcigpO1xyXG5cdFx0cmV0dXJuO1xyXG5cdH1cclxuXHRHVUkuaXNfaW5pdD0xO1xyXG5cdEdVSS5pbml0KHtza2lwRXh0ZW50OnRydWV9KTtcclxuXHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRmdW5jdGlvbiBzdG9yZShmb3JjZUNsb3NlKSBcclxuXHR7XHJcblx0XHRpZiAoIUdVSS5nZXRUcmFja0xheWVyKCkuZ2V0U291cmNlKCkuZ2V0RmVhdHVyZXMoKS5sZW5ndGgpIHtcclxuXHRcdFx0cmV0dXJuIG51bGw7XHJcblx0XHR9XHJcblx0XHR2YXIgdHJhY2tEYXRhPUdVSS5nZXRUcmFja0xheWVyKCkuZ2V0U291cmNlKCkuZ2V0RmVhdHVyZXMoKVswXS5nZXRHZW9tZXRyeSgpLmdldENvb3JkaW5hdGVzKCk7XHJcblx0XHRpZiAoZm9yY2VDbG9zZSkgXHJcblx0XHR7XHJcblx0XHRcdGlmICh0cmFja0RhdGFbMF1bMF0gIT0gdHJhY2tEYXRhW3RyYWNrRGF0YS5sZW5ndGgtMV1bMF0gfHwgdHJhY2tEYXRhWzBdWzFdICE9IHRyYWNrRGF0YVt0cmFja0RhdGEubGVuZ3RoLTFdWzFdKSB7XHJcblx0XHRcdFx0dHJhY2tEYXRhLnB1c2godHJhY2tEYXRhWzBdKTtcclxuXHRcdFx0XHRHVUkuZ2V0VHJhY2tMYXllcigpLmdldFNvdXJjZSgpLmdldEZlYXR1cmVzKClbMF0uZ2V0R2VvbWV0cnkoKS5zZXRDb29yZGluYXRlcyh0cmFja0RhdGEpO1xyXG5cdFx0XHR9XHJcblx0XHR9XHJcblx0XHRmb3IgKHZhciBpPTA7aTx0cmFja0RhdGEubGVuZ3RoO2krKylcclxuXHRcdFx0dHJhY2tEYXRhW2ldPW9sLnByb2oudHJhbnNmb3JtKHRyYWNrRGF0YVtpXSwgJ0VQU0c6Mzg1NycsJ0VQU0c6NDMyNicpO1x0XHRcdFxyXG5cdFx0JChcIiNyb3V0ZV90ZXh0X2FyZWFcIikudmFsKEpTT04uc3RyaW5naWZ5KHRyYWNrRGF0YSkpO1xyXG5cdFx0VFJBQ0suc2V0Um91dGUodHJhY2tEYXRhKTtcclxuXHRcdFxyXG5cdFx0dmFyIHN0ciA9IChUUkFDSy5nZXRUcmFja0xlbmd0aCgpLzEwMDAuMCkrXCIga21cIjtcclxuXHRcdCQoXCIjcm91dGVfaW5mb1wiKS52YWwoc3RyKTtcclxuXHRcdHJldHVybiBKU09OLnN0cmluZ2lmeSh0cmFja0RhdGEpO1xyXG5cdH1cclxuXHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRzZWxlY3QgPSBuZXcgb2wuaW50ZXJhY3Rpb24uU2VsZWN0KHtcclxuXHRcdHN0eWxlOiBTVFlMRVNbXCJ0cmFja3NlbGVjdGVkXCJdLFxyXG5cdFx0bGF5ZXJzOiBbR1VJLnRyYWNrTGF5ZXJdXHJcblx0fSk7XHJcblx0bW9kaWZ5ID0gbmV3IG9sLmludGVyYWN0aW9uLk1vZGlmeSh7XHJcblx0XHRmZWF0dXJlczogc2VsZWN0LmdldEZlYXR1cmVzKCksXHJcblx0XHRsYXllcnM6IFtHVUkudHJhY2tMYXllcl1cclxuXHR9KTtcclxuXHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRkcmF3ID0gbmV3IG9sLmludGVyYWN0aW9uLkRyYXcoe1xyXG5cdCAgICAgIHNvdXJjZTogR1VJLnRyYWNrTGF5ZXIuZ2V0U291cmNlKCksXHJcblx0ICAgICAgdHlwZTogXCJMaW5lU3RyaW5nXCJcclxuXHR9KTtcclxuXHRkcmF3Lm9uKCdkcmF3c3RhcnQnLCBmdW5jdGlvbihlKSB7XHJcblx0XHRHVUkudHJhY2tMYXllci5nZXRTb3VyY2UoKS5jbGVhcigpO1xyXG5cdH0pO1xyXG5cdGRyYXcub24oJ2RyYXdlbmQnLCBmdW5jdGlvbihlKSB7XHJcblx0XHRHVUkubWFwLnJlbW92ZUludGVyYWN0aW9uKGRyYXcpO1xyXG5cdFx0R1VJLm1hcC5hZGRJbnRlcmFjdGlvbihzZWxlY3QpO1xyXG5cdFx0R1VJLm1hcC5hZGRJbnRlcmFjdGlvbihtb2RpZnkpO1xyXG5cdFx0c3RvcmUoKTtcclxuXHRcdGlmICghVFJBQ0suZmVhdHVyZSlcclxuXHRcdFx0VFJBQ0suZmVhdHVyZT1HVUkuZ2V0VHJhY2tMYXllcigpLmdldFNvdXJjZSgpLmdldEZlYXR1cmVzKClbMF07XHJcblx0fSk7XHJcblx0Ly8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0R1VJLm1hcC5yZW1vdmVJbnRlcmFjdGlvbihzZWxlY3QpO1xyXG5cdEdVSS5tYXAucmVtb3ZlSW50ZXJhY3Rpb24obW9kaWZ5KTtcclxuXHRHVUkubWFwLmFkZEludGVyYWN0aW9uKGRyYXcpO1xyXG5cdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdCQoXCIjYnV0dG9uX2VyYXNlXCIpLmNsaWNrKGZ1bmN0aW9uKCl7XHJcblx0XHRHVUkudHJhY2tMYXllci5nZXRTb3VyY2UoKS5jbGVhcigpO1xyXG5cdFx0c2VsZWN0LmdldEZlYXR1cmVzKCkuY2xlYXIoKTtcclxuXHRcdEdVSS5tYXAucmVtb3ZlSW50ZXJhY3Rpb24oc2VsZWN0KTtcclxuXHRcdEdVSS5tYXAucmVtb3ZlSW50ZXJhY3Rpb24obW9kaWZ5KTtcclxuXHRcdEdVSS5tYXAuYWRkSW50ZXJhY3Rpb24oZHJhdyk7XHJcblx0XHRzdG9yZSgpO1xyXG5cdH0pO1xyXG5cdCQoXCIjYnV0dG9uX25hdmlnYXRlXCIpLmNsaWNrKGZ1bmN0aW9uKCl7XHJcblx0XHRUUkFDSy5nZW5lcmF0ZUZyb21Mb2NhdGlvbnMoVFJBQ0suZ2V0Um91dGUoKSxmdW5jdGlvbigpIHtcclxuXHRcdFx0VFJBQ0sudXBkYXRlRmVhdHVyZSgpO1xyXG5cdFx0XHRzdG9yZSgpO1xyXG5cdFx0fSxmdW5jdGlvbihtc2cpIHtcclxuXHRcdFx0R1VJLnNob3dFcnJvcihtc2cpO1xyXG5cdFx0fSx0cnVlKTtcdFx0XHRcclxuXHR9KTtcclxuXHQkKFwiI2J1dHRvbl9qb2luXCIpLmNsaWNrKGZ1bmN0aW9uKCkge1xyXG5cdFx0c3RvcmUodHJ1ZSk7XHJcblx0fSk7XHJcblx0JChcIiNidXR0b25fc3VibWl0XCIpLmNsaWNrKGZ1bmN0aW9uKCkge1xyXG5cdFx0dmFyIGRhdGEgPSBzdG9yZSgpO1xyXG5cdFx0R1VJLm9uRWRpdFNhdmUoZGF0YSk7XHRcdFx0XHJcblx0XHQkKFwiLmZ3LWNvbnRhaW5lclwiKS5jc3MoXCJkaXNwbGF5XCIsXCJibG9ja1wiKTtcclxuXHR9KTtcclxuXHQkKFwiI2J1dHRvbl9jYW5jZWxcIikuY2xpY2soZnVuY3Rpb24oKSB7XHJcblx0XHQkKFwiI21hcFwiKS5jc3MoXCJkaXNwbGF5XCIsXCJub25lXCIpO1xyXG5cdFx0JChcIi5mdy1jb250YWluZXJcIikuY3NzKFwiZGlzcGxheVwiLFwiYmxvY2tcIik7XHJcblx0fSk7XHJcbn1cclxuLy8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcbmZ1bmN0aW9uIG1hcEVkaXQoaWQsanNvbix2YWxCaWtlU3RhcnQsdmFsUnVuU3RhcnQsb25TdWJtaXQpIFxyXG57XHRcdFxyXG5cdC8vY29uc29sZS5sb2coXCJJRCA6IFwiK2lkK1wiIHwgSlNPTiA6IFwiK2pzb24pO1xyXG5cdCQoXCIuZnctY29udGFpbmVyXCIpLmNzcyhcImRpc3BsYXlcIixcIm5vbmVcIik7XHJcblx0JChcIiNtYXBcIikuY3NzKFwiZGlzcGxheVwiLFwiYmxvY2tcIik7XHJcblx0aW5pdEdVSSgpO1xyXG5cdEdVSS50cmFja0xheWVyLmdldFNvdXJjZSgpLmNsZWFyKCk7XHJcblx0dHJ5IHtcclxuXHRcdHZhciB0cmFja0RhdGEgPSBKU09OLnBhcnNlKGpzb24pO1xyXG5cdFx0VFJBQ0suc2V0Um91dGUodHJhY2tEYXRhKTtcclxuXHRcdFRSQUNLLmJpa2VTdGFydEtNPXBhcnNlRmxvYXQodmFsQmlrZVN0YXJ0KTtcclxuXHRcdFRSQUNLLnJ1blN0YXJ0S009cGFyc2VGbG9hdCh2YWxSdW5TdGFydCk7XHJcblx0XHRpZiAoaXNOYU4oVFJBQ0suYmlrZVN0YXJ0S00pKVxyXG5cdFx0XHRUUkFDSy5iaWtlU3RhcnRLTT0zLjg2O1xyXG5cdFx0aWYgKGlzTmFOKFRSQUNLLnJ1blN0YXJ0S00pKVxyXG5cdFx0XHRUUkFDSy5ydW5TdGFydEtNPTE4MC4yNStUUkFDSy5iaWtlU3RhcnRLTTtcclxuXHRcdGlmIChqc29uICYmIGpzb24gIT0gXCJcIikgXHJcblx0XHR7XHJcblx0XHRcdCQoXCIjcm91dGVfdGV4dF9hcmVhXCIpLnZhbChqc29uKTtcclxuXHJcblx0XHRcdHZhciBzdHIgPSAoVFJBQ0suZ2V0VHJhY2tMZW5ndGgoKS8xMDAwLjApK1wiIGttXCI7XHJcblx0XHRcdCQoXCIjcm91dGVfaW5mb1wiKS52YWwoc3RyKTtcclxuXHJcblx0XHRcdEdVSS5hZGRUcmFja0ZlYXR1cmUoKTtcclxuXHRcdFx0R1VJLnpvb21Ub1RyYWNrKCk7XHJcblx0XHRcdEdVSS5tYXAucmVtb3ZlSW50ZXJhY3Rpb24oZHJhdyk7XHJcblx0XHRcdEdVSS5tYXAuYWRkSW50ZXJhY3Rpb24oc2VsZWN0KTtcclxuXHRcdFx0R1VJLm1hcC5hZGRJbnRlcmFjdGlvbihtb2RpZnkpO1xyXG5cdFx0fVx0XHRcclxuXHR9IGNhdGNoIChlKSB7XHJcblx0XHRjb25zb2xlLmxvZyhcIlVuYWJsZSB0byBkbyBtYXBFZGl0IGZvciBcIitqc29uKTtcclxuXHRcdGNvbnNvbGUuZXJyb3IoXCJFeGNlcHRpb24gb24gbWFwRWRpdCBcIitlKTtcclxuXHR9XHRcdFxyXG5cdEdVSS5vbkVkaXRTYXZlID0gZnVuY3Rpb24oZGF0YSkge1xyXG5cdFx0JChcIiNtYXBcIikuY3NzKFwiZGlzcGxheVwiLFwibm9uZVwiKTtcclxuXHRcdG9uU3VibWl0KGRhdGEpO1xyXG5cdH07XHJcbn1cclxuXHJcbiQoZG9jdW1lbnQpLnJlYWR5KCBmdW5jdGlvbiAoKSBcclxue1xyXG5cdCQoXCIubW9iaWxlLXNob3cgaVwiKS5jbGljayhmdW5jdGlvbigpIHtcclxuXHRcdCQoXCIubW9iaWxlLXNob3dcIikuY3NzKFwiZGlzcGxheVwiLFwibm9uZVwiKTsgXHJcblx0XHQkKFwiLmZ3LW5hdlwiKS5jc3MoXCJoZWlnaHRcIixcImF1dG9cIik7IFxyXG5cdH0pO1xyXG5cdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdHdpbmRvdy5FRElUT1IxID0gbmV3ICQuZm4uZGF0YVRhYmxlLkVkaXRvcigge1xyXG5cdFx0YWpheDogJy4uL3BhcnRpY2lwYW50cycsXHJcblx0XHR0YWJsZTogXCIjdGFibGUtcGFydGljaXBhbnRzXCIsXHJcblx0XHRpZFNyYzogXCJpZFwiLFxyXG5cdFx0ZmllbGRzOiBbIFxyXG5cdFx0ICAgIHtcclxuXHRcdFx0XHRsYWJlbDogXCJTdGFydCBOb1wiLFxyXG5cdFx0XHRcdG5hbWU6IFwic3RhcnROb1wiXHJcblx0XHRcdH0se1xyXG5cdFx0XHRcdGxhYmVsOiBcIkZpcnN0IG5hbWVcIixcclxuXHRcdFx0XHRuYW1lOiBcImZpcnN0bmFtZVwiXHJcblx0XHRcdH0se1xyXG5cdFx0XHRcdGxhYmVsOiBcIkxhc3QgbmFtZVwiLFxyXG5cdFx0XHRcdG5hbWU6IFwibGFzdG5hbWVcIlxyXG5cdFx0XHR9LHtcclxuXHRcdFx0XHRsYWJlbDogXCJHZW5kZXJcIixcclxuXHRcdFx0XHRuYW1lOiBcImdlbmRlclwiXHJcblx0XHRcdH0se1xyXG5cdFx0XHRcdGxhYmVsOiBcIk5hdGlvbmFsaXR5XCIsXHJcblx0XHRcdFx0bmFtZTogXCJuYXRpb25hbGl0eVwiXHJcblx0XHRcdH0se1xyXG5cdFx0XHRcdGxhYmVsOiBcIlN0YXJ0IGdyb3VwXCIsXHJcblx0XHRcdFx0bmFtZTogXCJzdGFydEdyb3VwXCJcclxuXHRcdFx0fSx7XHJcblx0XHRcdFx0bGFiZWw6IFwiQ2x1YlwiLFxyXG5cdFx0XHRcdG5hbWU6IFwiY2x1YlwiXHJcblx0XHRcdH0se1xyXG5cdFx0XHRcdGxhYmVsOiBcIkJpcnRoIGRhdGVcIixcclxuXHRcdFx0XHRuYW1lOiBcImJpcnRoRGF0ZVwiLFxyXG5cdFx0XHR9LHtcclxuXHRcdFx0XHRsYWJlbDogXCJJZFwiLFxyXG5cdFx0XHRcdG5hbWU6IFwiaWRcIixcclxuXHRcdFx0XHR0eXBlIDogXCJyZWFkb25seVwiXHJcblx0XHRcdH1cdFx0XHRcclxuXHRcdF1cclxuXHR9ICk7XHJcblxyXG5cdHdpbmRvdy5FRElUT1IyID0gbmV3ICQuZm4uZGF0YVRhYmxlLkVkaXRvcigge1xyXG5cdFx0YWpheDogJy4uL3N0YXJ0cycsXHJcblx0XHR0YWJsZTogXCIjdGFibGUtc3RhcnRzXCIsXHJcblx0XHRpZFNyYzogXCJpZFwiLFxyXG5cdFx0ZmllbGRzOiBbe1xyXG5cdFx0XHRcdFx0bGFiZWw6IFwiSWRcIixcclxuXHRcdFx0XHRcdG5hbWU6IFwiaWRcIixcclxuXHRcdFx0XHRcdHR5cGUgOiBcInJlYWRvbmx5XCJcclxuXHRcdFx0XHR9LCB7XHJcblx0XHRcdFx0XHRsYWJlbDogXCJGcm9tIE5vXCIsXHJcblx0XHRcdFx0XHRuYW1lOiBcImZyb21TdGFydE5vXCJcclxuXHRcdFx0XHR9LCB7XHJcblx0XHRcdFx0XHRsYWJlbDogXCJUbyBOb1wiLFxyXG5cdFx0XHRcdFx0bmFtZTogXCJ0b1N0YXJ0Tm9cIlxyXG5cdFx0XHRcdH0sIHtcclxuXHRcdFx0XHRcdGxhYmVsOiBcIlN0YXJ0IFRpbWVcIixcclxuXHRcdFx0XHRcdG5hbWU6IFwic3RhcnRUaW1lXCJcclxuXHRcdFx0XHR9XVxyXG5cdH0gKTtcclxuXHJcblx0dmFyIHRhYmxlUGFydGljaXBhbnRzID0gJCgnI3RhYmxlLXBhcnRpY2lwYW50cycpLkRhdGFUYWJsZSgge1xyXG5cdFx0ZG9tOiBcIlRmcnRpcFwiLFxyXG5cdFx0YWpheDogXCIuLi9wYXJ0aWNpcGFudHM/bW9kZT1kdGJsXCIsXHJcblx0XHRjb2x1bW5zOiBbXHJcblx0XHRcdHsgZGF0YTogXCJzdGFydE5vXCIsY2xhc3NOYW1lIDogXCJkdC1ib2R5LXJpZ2h0XCIgfSxcclxuXHRcdFx0eyBkYXRhOiBcImZpcnN0bmFtZVwiIH0sXHJcblx0XHRcdHsgZGF0YTogXCJsYXN0bmFtZVwiIH0sXHJcblx0XHRcdHsgZGF0YTogXCJnZW5kZXJcIiB9LFxyXG5cdFx0XHR7IGRhdGE6IFwibmF0aW9uYWxpdHlcIn0sXHJcblx0XHRcdHsgZGF0YTogXCJzdGFydEdyb3VwXCIgfSxcclxuXHRcdFx0eyBkYXRhOiBcImNsdWJcIn0sXHJcblx0XHRcdHsgZGF0YTogXCJiaXJ0aERhdGVcIixjbGFzc05hbWUgOiBcImR0LWJvZHktcmlnaHRcIiB9LFxyXG5cdFx0XHR7IGRhdGE6IFwiaWRcIiB9XHJcblx0XHRdLFxyXG5cdFx0dGFibGVUb29sczoge1xyXG5cdFx0XHRzUm93U2VsZWN0OiBcIm9zXCIsXHJcblx0XHRcdGFCdXR0b25zOiBbXHJcblx0XHRcdFx0eyBzRXh0ZW5kczogXCJlZGl0b3JfY3JlYXRlXCIsIGVkaXRvcjogRURJVE9SMSB9LFxyXG5cdFx0XHRcdHsgc0V4dGVuZHM6IFwiZWRpdG9yX2VkaXRcIiwgICBlZGl0b3I6IEVESVRPUjEgfSxcclxuXHRcdFx0XHR7IHNFeHRlbmRzOiBcImVkaXRvcl9yZW1vdmVcIiwgZWRpdG9yOiBFRElUT1IxIH1cclxuXHRcdFx0XVxyXG5cdFx0fVxyXG5cdH0gKTtcdFxyXG5cdFxyXG5cdHZhciB0YWJsZVN0YXJ0cyA9ICQoJyN0YWJsZS1zdGFydHMnKS5EYXRhVGFibGUoIHtcclxuXHRcdGRvbTogXCJUZnJ0aXBcIixcclxuXHRcdGFqYXg6IFwiLi4vc3RhcnRzXCIsXHJcblx0XHRjb2x1bW5zOiBbXHJcblx0XHRcdHsgZGF0YTogXCJmcm9tU3RhcnROb1wiIH0sXHJcblx0XHRcdHsgZGF0YTogXCJ0b1N0YXJ0Tm9cIiB9LFxyXG5cdFx0XHR7IGRhdGE6IFwic3RhcnRUaW1lXCIgfVxyXG5cdFx0XSxcclxuXHRcdHRhYmxlVG9vbHM6IHtcclxuXHRcdFx0c1Jvd1NlbGVjdDogXCJvc1wiLFxyXG5cdFx0XHRhQnV0dG9uczogW1xyXG5cdFx0XHRcdHsgc0V4dGVuZHM6IFwiZWRpdG9yX2NyZWF0ZVwiLCBlZGl0b3I6IEVESVRPUjIgfSxcclxuXHRcdFx0XHR7IHNFeHRlbmRzOiBcImVkaXRvcl9lZGl0XCIsICAgZWRpdG9yOiBFRElUT1IyIH0sXHJcblx0XHRcdFx0eyBzRXh0ZW5kczogXCJlZGl0b3JfcmVtb3ZlXCIsIGVkaXRvcjogRURJVE9SMiB9XHJcbiAgICAgICAgICAgXVxyXG5cdFx0fVxyXG5cdH0gKTtcclxuXHRcclxuXHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0XHJcblx0LypcclxuXHQkKFwiI25hdjFcIikuY2xpY2soZnVuY3Rpb24oKSB7XHJcblx0XHQkKFwiI25hdjFcIikuYWRkQ2xhc3MoXCJhY3RpdmVcIik7XHJcblx0XHQkKFwiI25hdjJcIikucmVtb3ZlQ2xhc3MoXCJhY3RpdmVcIik7XHJcblx0XHQkKFwiI3RhYjFcIikuY3NzKFwiaGVpZ2h0XCIsXCJhdXRvXCIpO1xyXG5cdFx0JChcIiN0YWIyXCIpLmNzcyhcImhlaWdodFwiLFwiMFwiKTtcclxuXHR9KTtcclxuXHQkKFwiI25hdjJcIikuY2xpY2soZnVuY3Rpb24oKSB7XHJcblx0XHQkKFwiI25hdjJcIikuYWRkQ2xhc3MoXCJhY3RpdmVcIik7XHJcblx0XHQkKFwiI25hdjFcIikucmVtb3ZlQ2xhc3MoXCJhY3RpdmVcIik7XHJcblx0XHQkKFwiI3RhYjJcIikuY3NzKFwiaGVpZ2h0XCIsXCJhdXRvXCIpO1xyXG5cdFx0JChcIiN0YWIxXCIpLmNzcyhcImhlaWdodFwiLFwiMFwiKTtcclxuXHR9KTtcclxuXHQqL1xyXG5cdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxufSk7XHJcbiIsInZhciBVdGlscyA9IHJlcXVpcmUoXCIuL1V0aWxzLmpzXCIpO1xyXG5cclxudmFyIENPTkZJRyA9IFxyXG57XHJcblx0dGltZW91dHMgOiAvLyBpbiBzZWNvbmRzXHJcblx0e1xyXG5cdFx0ZGV2aWNlVGltZW91dCA6IDYwKjUsXHJcblx0XHRhbmltYXRpb25GcmFtZSA6IFV0aWxzLm1vYmlsZUFuZFRhYmxldENoZWNrKCkgPyAwLjQgOiAwLjEsXHJcblx0XHRncHNMb2NhdGlvbkRlYnVnU2hvdyA6IDQsXHRcdC8vIHRpbWUgdG8gc2hvdyBncHMgbG9jYXRpb24gKGRlYnVnKSBpbmZvXHJcblx0XHRzdHJlYW1EYXRhSW50ZXJ2YWwgOiAxMCBcdFx0LyogTk9STUFMIDEwIHNlY29uZHMgKi9cclxuXHR9LFxyXG5cdGRpc3RhbmNlcyA6IC8vIGluIG1cclxuXHR7XHJcblx0XHRzdGF5T25Sb2FkVG9sZXJhbmNlIDogNTAwLFx0Ly8gNTAwbSBzdGF5IG9uIHJvYWQgdG9sZXJhbmNlXHJcblx0XHRlbGFwc2VkRGlyZWN0aW9uRXBzaWxvbiA6IDUwMCAvLyA1MDBtIGRpcmVjdGlvbiB0b2xlcmFuY2UsIHRvbyBmYXN0IG1vdmVtZW50IHdpbGwgZGlzY2FyZCBcclxuXHR9LFxyXG5cdGNvbnN0cmFpbnRzIDoge1xyXG5cdFx0YmFja3dhcmRzRXBzaWxvbkluTWV0ZXIgOiA0MDAsIC8vMjIwIG0gbW92ZW1lbnQgaW4gdGhlIGJhY2t3YXJkIGRpcmVjdGlvbiB3aWxsIG5vdCB0cmlnZ2VyIG5leHQgcnVuIGNvdW50ZXIgaW5jcmVtZW50XHRcdFxyXG5cdFx0bWF4U3BlZWQgOiAyMCxcdC8va21oXHJcblx0XHRtYXhQYXJ0aWNpcGFudFN0YXRlSGlzdG9yeSA6IDEwMDAsIC8vIG51bWJlciBvZiBlbGVtZW50c1xyXG5cdFx0cG9wdXBFbnN1cmVWaXNpYmxlV2lkdGggOiAyMDAsXHJcblx0XHRwb3B1cEVuc3VyZVZpc2libGVIZWlnaHQ6IDEyMFxyXG5cdH0sXHJcblx0c2ltdWxhdGlvbiA6IHtcclxuXHRcdHBpbmdJbnRlcnZhbCA6IDEwLCAvLyBpbnRlcnZhbCBpbiBzZWNvbmRzIHRvIHBpbmcgd2l0aCBncHMgZGF0YVxyXG5cdFx0Z3BzSW5hY2N1cmFjeSA6IDAsICAvLyBlcnJvciBzaW11bGF0aW9uIGluIE1FVEVSIChsb29rIG1hdGguZ3BzSW5hY2N1cmFjeSwgbWluIDEvMilcclxuXHR9LFxyXG5cdHNldHRpbmdzIDoge1xyXG5cdFx0bm9NaWRkbGVXYXJlIDogMCwgXHQvLyBTS0lQIG1pZGRsZSB3YXJlIG5vZGUganMgYXBwXHJcblx0XHRub0ludGVycG9sYXRpb24gOiAwXHQvLyAxIC0+IG5vIGludGVycG9sYXRpb24gb25seSBwb2ludHNcclxuXHR9LFxyXG5cdG1hdGggOiB7XHJcblx0XHRncHNJbmFjY3VyYWN5IDogMjAsXHQvL1RPRE8gMTMgbWluXHJcblx0XHRzcGVlZEFuZEFjY2VsZXJhdGlvbkF2ZXJhZ2VEZWdyZWUgOiAyLFx0Ly8gY2FsY3VsYXRpb24gYmFzZWQgb24gTiBzdGF0ZXMgKGF2ZXJhZ2UpIChNSU4gMilcclxuXHRcdGRpc3BsYXlEZWxheSA6IDgwLFx0XHRcdFx0XHRcdC8vIGRpc3BsYXkgZGVsYXkgaW4gU0VDT05EU1xyXG5cdFx0aW50ZXJwb2xhdGVHUFNBdmVyYWdlIDogMCwgLy8gbnVtYmVyIG9mIHJlY2VudCB2YWx1ZXMgdG8gY2FsY3VsYXRlIGF2ZXJhZ2UgZ3BzIGZvciBwb3NpdGlvbiAoc21vb3RoaW5nIHRoZSBjdXJ2ZS5taW4gMCA9IE5PLDEgPSAyIHZhbHVlcyAoY3VycmVudCBhbmQgbGFzdCkpXHJcblx0XHRyb2FkRGlzdGFuY2VCZXN0UG9pbnRDYWxjdWxhdGlvbkNvZWYgOiAwLjIgLy8gVE9ETyBFWFBMQUlOXHJcblx0fSxcclxuXHRjb25zdGFudHMgOiBcclxuXHR7XHJcblx0XHRhZ2VHcm91cHMgOiAgXHJcblx0XHRbXHJcblx0XHQge1xyXG5cdFx0XHQgZnJvbSA6IG51bGwsXHJcblx0XHRcdCB0byA6IDgsIFxyXG5cdFx0XHQgY29kZSA6IFwiRmlyc3RBZ2VHcm91cFwiXHJcblx0XHQgfVxyXG5cdFx0ICx7XHJcblx0XHRcdCBmcm9tIDogOCxcclxuXHRcdFx0IHRvIDogNDAsIFxyXG5cdFx0XHQgY29kZSA6IFwiTWlkZGxlQWdlR3JvdXBcIlxyXG5cdFx0IH1cclxuXHRcdCAse1xyXG5cdFx0XHQgZnJvbSA6IDQwLFxyXG5cdFx0XHQgdG8gOiBudWxsLCBcclxuXHRcdFx0IGNvZGUgOiBcIkxhc3RBZ2VHcm91cFwiXHJcblx0XHQgfVxyXG5cdFx0XVxyXG5cdH0sXHJcblxyXG5cdGV2ZW50IDoge1xyXG5cdFx0YmVnaW5UaW1lc3RhbXAgOiAobmV3IERhdGUoKSkuZ2V0VGltZSgpLFxyXG5cdFx0ZHVyYXRpb24gOiA2MCwgLy9NSU5VVEVTXHJcblx0XHRpZCA6IDNcclxuXHR9LFxyXG5cclxuXHRzZXJ2ZXIgOiB7XHJcblx0XHRwcmVmaXggOiBcIi90cmlhdGhsb24vXCJcclxuXHR9LFxyXG5cdFxyXG5cdGFwcGVhcmFuY2UgOiB7XHJcblx0XHRkZWJ1ZyA6IDAsXHJcblx0XHR0cmFja0NvbG9yU3dpbSA6ICcjNTY3NmZmJyxcclxuXHRcdHRyYWNrQ29sb3JCaWtlIDogJyNFMjAwNzQnLFxyXG5cdFx0dHJhY2tDb2xvclJ1biA6ICAnIzA3OWYzNicsXHJcblxyXG5cdFx0Ly8gTm90ZSB0aGUgc2VxdWVuY2UgaXMgYWx3YXlzIFN3aW0tQmlrZS1SdW4gLSBzbyAyIGNoYW5nZS1wb2ludHNcclxuXHRcdC8vIFRPRE8gUnVtZW4gLSBhZGQgc2NhbGUgaGVyZSwgbm90IGluIFN0eWxlcy5qc1xyXG5cdFx0aW1hZ2VTdGFydCA6IFwiaW1nL3N0YXJ0LnBuZ1wiLFxyXG5cdFx0aW1hZ2VGaW5pc2ggOiBcImltZy9maW5pc2gucG5nXCIsXHJcblx0XHRpbWFnZUNhbSA6IFwiaW1nL2NhbWVyYS5zdmdcIixcclxuXHRcdGltYWdlQ2hlY2twb2ludFN3aW1CaWtlIDogXCJpbWcvd3oxLnN2Z1wiLFxyXG5cdFx0aW1hZ2VDaGVja3BvaW50QmlrZVJ1biA6IFwiaW1nL3d6Mi5zdmdcIixcclxuXHRcdGlzU2hvd0ltYWdlQ2hlY2twb2ludCA6IHRydWUsXHJcblxyXG4gICAgICAgIC8vIHRoZSBkaXN0YW5jZSBiZXR3ZWVuIHRoZSBkaXJlY3Rpb24gaWNvbnMgLSBpbiBwaXhlbHMsXHJcbiAgICAgICAgLy8gaWYgc2V0IG5vbi1wb3NpdGl2ZSB2YWx1ZSAoMCBvciBsZXNzKSB0aGVuIGRvbid0IHNob3cgdGhlbSBhdCBhbGxcclxuXHRcdC8vZGlyZWN0aW9uSWNvbkJldHdlZW4gOiAyMDBcclxuXHRcdGRpcmVjdGlvbkljb25CZXR3ZWVuIDogLTFcclxuXHR9LFxyXG5cclxuICAgIGhvdHNwb3QgOiB7XHJcbiAgICAgICAgY2FtIDoge2ltYWdlIDpcImltZy9jYW1lcmEuc3ZnXCJ9LCAgLy8gdXNlIHRoZSBzYW1lIGltYWdlIGZvciBzdGF0aWMgY2FtZXJhcyBhcyBmb3IgdGhlIG1vdmluZyBvbmVzXHJcblx0XHRjYW1Td2ltQmlrZSA6IHtpbWFnZSA6IFwiaW1nL3d6MS5zdmdcIiwgc2NhbGUgOiAwLjA0MH0sXHJcblx0XHRjYW1CaWtlUnVuIDoge2ltYWdlIDogXCJpbWcvd3oyLnN2Z1wiLCBzY2FsZSA6IDAuMDQwfSxcclxuICAgICAgICB3YXRlciA6IHtpbWFnZSA6IFwiaW1nL3dhdGVyLnN2Z1wifSxcclxuICAgICAgICB1dHVybiA6IHtpbWFnZSA6IFwiaW1nL3V0dXJuLnN2Z1wifSxcclxuXHJcblx0XHRrbTEwIDoge2ltYWdlIDogXCJpbWcvMTBrbS5zdmdcIiwgc2NhbGUgOiAxLjV9LFxyXG5cdFx0a20yMCA6IHtpbWFnZSA6IFwiaW1nLzIwa20uc3ZnXCIsIHNjYWxlIDogMS41fSxcclxuXHRcdGttMzAgOiB7aW1hZ2UgOiBcImltZy8zMGttLnN2Z1wiLCBzY2FsZSA6IDEuNX0sXHJcblx0XHRrbTQwIDoge2ltYWdlIDogXCJpbWcvNDBrbS5zdmdcIiwgc2NhbGUgOiAxLjV9LFxyXG5cdFx0a202MCA6IHtpbWFnZSA6IFwiaW1nLzYwa20uc3ZnXCIsIHNjYWxlIDogMS41fSxcclxuXHRcdGttODAgOiB7aW1hZ2UgOiBcImltZy84MGttLnN2Z1wiLCBzY2FsZSA6IDEuNX0sXHJcblx0XHRrbTEwMCA6IHtpbWFnZSA6IFwiaW1nLzEwMGttLnN2Z1wiLCBzY2FsZSA6IDEuNX0sXHJcblx0XHRrbTEyMCA6IHtpbWFnZSA6IFwiaW1nLzEyMGttLnN2Z1wiLCBzY2FsZSA6IDEuNX0sXHJcblx0XHRrbTE0MCA6IHtpbWFnZSA6IFwiaW1nLzE0MGttLnN2Z1wiLCBzY2FsZSA6IDEuNX0sXHJcblx0XHRrbTE2MCA6IHtpbWFnZSA6IFwiaW1nLzE2MGttLnN2Z1wiLCBzY2FsZSA6IDEuNX0sXHJcblx0XHRrbTE4MCA6IHtpbWFnZSA6IFwiaW1nLzE4MGttLnN2Z1wiLCBzY2FsZSA6IDEuNX1cclxuICAgIH1cclxufTtcclxuXHJcbmZvciAodmFyIGkgaW4gQ09ORklHKVxyXG5cdGV4cG9ydHNbaV09Q09ORklHW2ldO1xyXG4iLCJ2YXIgVXRpbHM9cmVxdWlyZSgnLi9VdGlscycpO1xyXG52YXIgU1RZTEVTPXJlcXVpcmUoJy4vU3R5bGVzJyk7XHJcbnJlcXVpcmUoJ2pvb3NlJyk7XHJcbnJlcXVpcmUoJy4vVHJhY2snKTtcclxucmVxdWlyZSgnLi9MaXZlU3RyZWFtJyk7XHJcbnZhciBDT05GSUcgPSByZXF1aXJlKFwiLi9Db25maWdcIik7XHJcblxyXG5DbGFzcyhcIkd1aVwiLCBcclxue1xyXG4gICAgLy8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdC8vIEFMTCBDT09SRElOQVRFUyBBUkUgSU4gV09STEQgTUVSQ0FUT1JcclxuICAgIC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuICAgIGhhczogXHJcblx0e1xyXG4gICAgXHRpc0RlYnVnIDoge1xyXG4gICAgXHRcdGlzIDogXCJyd1wiLFxyXG4gICAgXHRcdGluaXQgOiAhVXRpbHMubW9iaWxlQW5kVGFibGV0Q2hlY2soKSAmJiBDT05GSUcuYXBwZWFyYW5jZS5kZWJ1Z1xyXG4gICAgXHR9LFxyXG5cdFx0aXNXaWRnZXQgOiB7XHJcblx0XHRcdGluaXQgOiBmYWxzZVxyXG5cdFx0fSxcclxuXHRcdGlzRGVidWdTaG93UG9zaXRpb24gOiB7XHJcblx0XHRcdC8vIGlmIHNldCB0byB0cnVlIGl0IHdpbGwgYWRkIGFuIGFic29sdXRlIGVsZW1lbnQgc2hvd2luZyB0aGUgY29vcmRpbmF0ZXMgYWJvdmUgdGhlIG1vdXNlIGxvY2F0aW9uXHJcblx0XHRcdGluaXQgOiBmYWxzZVxyXG5cdFx0fSxcclxuXHRcdHJlY2VpdmVyT25NYXBDbGljayA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiBbXVxyXG5cdFx0fSxcclxuICAgICAgICB3aWR0aCA6IHtcclxuICAgICAgICAgICAgaXM6ICAgXCJyd1wiLFxyXG4gICAgICAgICAgICBpbml0OiA3NTBcclxuICAgICAgICB9LFxyXG4gICAgICAgIGhlaWdodDoge1xyXG4gICAgICAgICAgICBpczogICBcInJ3XCIsXHJcbiAgICAgICAgICAgIGluaXQ6IDUwMFxyXG4gICAgICAgIH0sXHJcblx0XHR0cmFjayA6IHtcclxuXHRcdFx0aXM6ICAgXCJyd1wiXHJcblx0XHR9LFxyXG5cdFx0ZWxlbWVudElkIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IFwibWFwXCJcclxuXHRcdH0sXHJcblx0XHRpbml0aWFsUG9zIDoge1x0XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogbnVsbFxyXG5cdFx0fSxcclxuXHRcdGluaXRpYWxab29tIDoge1x0XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogMTBcclxuXHRcdH0sXHJcblx0XHRiaW5nTWFwS2V5IDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6ICdBaWp0M0FzV09NRTNoUEVFX0hxUmxVS2RjQktxZThkR1JaSF92LUwzSF9GRjY0c3ZYTWJrcjFUNnVfV0FTb2V0J1xyXG5cdFx0fSxcclxuXHRcdC8vLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdFx0bWFwIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IG51bGxcclxuXHRcdH0sXHJcblx0XHR0cmFja0xheWVyIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IG51bGxcclxuXHRcdH0sXHJcbiAgICAgICAgaG90c3BvdHNMYXllciA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiBudWxsXHJcblx0XHR9LFxyXG4gICAgICAgIGNhbXNMYXllciA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiBudWxsXHJcblx0XHR9LFxyXG5cdFx0cGFydGljaXBhbnRzTGF5ZXIgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogbnVsbFxyXG5cdFx0fSxcclxuXHRcdGRlYnVnTGF5ZXJHUFMgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogbnVsbFxyXG5cdFx0fSxcdFxyXG5cdFx0dGVzdExheWVyIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IG51bGxcclxuXHRcdH0sXHRcclxuXHRcdFxyXG5cdFx0c2VsZWN0ZWRQYXJ0aWNpcGFudDEgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogbnVsbFxyXG5cdFx0fSxcclxuXHRcdHNlbGVjdGVkUGFydGljaXBhbnQyIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IG51bGxcclxuXHRcdH0sXHJcblx0XHRwb3B1cDEgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogbnVsbFxyXG5cdFx0fSxcclxuXHRcdHBvcHVwMiA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiBudWxsXHJcblx0XHR9LFxyXG5cdFx0aXNTaG93U3dpbSA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiB0cnVlXHJcblx0XHR9LFxyXG5cdFx0aXNTaG93QmlrZSA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiB0cnVlXHJcblx0XHR9LFxyXG5cdFx0aXNTaG93UnVuIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IHRydWVcclxuXHRcdH0sXHJcblx0XHRzZWxlY3ROdW0gOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogMVxyXG5cdFx0fSxcclxuICAgICAgICBsaXZlU3RyZWFtIDoge1xyXG4gICAgICAgICAgICBpbml0OiBudWxsXHJcbiAgICAgICAgfVxyXG4gICAgfSxcclxuICAgIC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRtZXRob2RzOiBcclxuXHR7XHJcbiAgICAgICAgaW5pdDogZnVuY3Rpb24gKHBhcmFtcykgIFxyXG5cdFx0e1xyXG5cdFx0XHQvLyBpZiBpbiB3aWRnZXQgbW9kZSB0aGVuIGRpc2FibGUgZGVidWdcclxuXHRcdFx0aWYgKHRoaXMuaXNXaWRnZXQpIHtcclxuXHRcdFx0XHR0aGlzLmlzRGVidWcgPSBmYWxzZTtcclxuXHRcdFx0fVxyXG5cclxuXHRcdFx0dmFyIGRlZlBvcyA9IFswLDBdO1xyXG5cdFx0XHRpZiAodGhpcy5pbml0aWFsUG9zKSBcclxuXHRcdFx0XHRkZWZQb3M9dGhpcy5pbml0aWFsUG9zO1xyXG5cdFx0XHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdFx0XHR2YXIgZXh0ZW50ID0gcGFyYW1zICYmIHBhcmFtcy5za2lwRXh0ZW50ID8gbnVsbCA6IFRSQUNLLmdldFJvdXRlKCkgJiYgVFJBQ0suZ2V0Um91dGUoKS5sZW5ndGggPiAxID8gb2wucHJvai50cmFuc2Zvcm1FeHRlbnQoIChuZXcgb2wuZ2VvbS5MaW5lU3RyaW5nKFRSQUNLLmdldFJvdXRlKCkpKS5nZXRFeHRlbnQoKSAsICdFUFNHOjQzMjYnLCAnRVBTRzozODU3JykgOiBudWxsO1xyXG5cdFx0XHR0aGlzLnRyYWNrTGF5ZXIgPSBuZXcgb2wubGF5ZXIuVmVjdG9yKHtcclxuXHRcdFx0ICBzb3VyY2U6IG5ldyBvbC5zb3VyY2UuVmVjdG9yKCksXHJcblx0XHRcdCAgc3R5bGUgOiBTVFlMRVNbXCJ0cmFja1wiXVxyXG5cdFx0XHR9KTtcclxuXHRcdFx0dGhpcy5ob3RzcG90c0xheWVyID0gbmV3IG9sLmxheWVyLlZlY3Rvcih7XHJcblx0XHRcdCAgc291cmNlOiBuZXcgb2wuc291cmNlLlZlY3RvcigpLFxyXG5cdFx0XHQgIHN0eWxlIDogU1RZTEVTW1wiaG90c3BvdFwiXVxyXG5cdFx0XHR9KTtcclxuXHRcdFx0dGhpcy5wYXJ0aWNpcGFudHNMYXllciA9IG5ldyBvbC5sYXllci5WZWN0b3Ioe1xyXG5cdFx0XHQgIHNvdXJjZTogbmV3IG9sLnNvdXJjZS5WZWN0b3IoKSxcclxuXHRcdFx0ICBzdHlsZSA6IFNUWUxFU1tcInBhcnRpY2lwYW50XCJdXHJcblx0XHRcdH0pO1xyXG5cdFx0XHR0aGlzLmNhbXNMYXllciA9IG5ldyBvbC5sYXllci5WZWN0b3Ioe1xyXG5cdFx0XHRcdHNvdXJjZTogbmV3IG9sLnNvdXJjZS5WZWN0b3IoKSxcclxuXHRcdFx0XHRzdHlsZSA6IFNUWUxFU1tcImNhbVwiXVxyXG5cdFx0XHR9KTtcclxuXHRcdFx0aWYgKHRoaXMuaXNEZWJ1ZykgXHJcblx0XHRcdHtcclxuXHRcdFx0XHR0aGlzLmRlYnVnTGF5ZXJHUFMgPSBuZXcgb2wubGF5ZXIuVmVjdG9yKHtcclxuXHRcdFx0XHRcdCAgc291cmNlOiBuZXcgb2wuc291cmNlLlZlY3RvcigpLFxyXG5cdFx0XHRcdFx0ICBzdHlsZSA6IFNUWUxFU1tcImRlYnVnR1BTXCJdXHJcblx0XHRcdFx0fSk7XHJcblx0XHRcdFx0dGhpcy50ZXN0TGF5ZXIgPSBuZXcgb2wubGF5ZXIuVmVjdG9yKHtcclxuXHRcdFx0XHRcdCAgc291cmNlOiBuZXcgb2wuc291cmNlLlZlY3RvcigpLFxyXG5cdFx0XHRcdFx0ICBzdHlsZSA6IFNUWUxFU1tcInRlc3RcIl1cclxuXHRcdFx0XHR9KTtcclxuXHRcdFx0fVxyXG5cdFx0XHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0XHRcdHZhciBpbnRzID0gW107XHJcblx0XHRcdHRoaXMucG9wdXAxID0gbmV3IG9sLk92ZXJsYXkuUG9wdXAoe2FuaTpmYWxzZSxwYW5NYXBJZk91dE9mVmlldyA6IGZhbHNlfSk7XHJcblx0XHRcdHRoaXMucG9wdXAyID0gbmV3IG9sLk92ZXJsYXkuUG9wdXAoe2FuaTpmYWxzZSxwYW5NYXBJZk91dE9mVmlldyA6IGZhbHNlfSk7XHJcblx0XHRcdHRoaXMucG9wdXAyLnNldE9mZnNldChbMCwxNzVdKTtcclxuXHRcdFx0dGhpcy5tYXAgPSBuZXcgb2wuTWFwKHtcclxuXHRcdFx0ICByZW5kZXJlciA6IFwiY2FudmFzXCIsXHJcblx0XHRcdCAgdGFyZ2V0OiAnbWFwJyxcclxuXHRcdFx0ICBsYXllcnM6IFtcclxuXHRcdFx0ICAgICAgICAgICBuZXcgb2wubGF5ZXIuVGlsZSh7XHJcblx0XHRcdCAgICAgICAgICAgICAgIHNvdXJjZTogbmV3IG9sLnNvdXJjZS5PU00oKVxyXG5cdFx0XHQgICAgICAgICAgIH0pLFxyXG5cdFx0XHRcdFx0dGhpcy50cmFja0xheWVyLFxyXG5cdFx0XHRcdFx0dGhpcy5ob3RzcG90c0xheWVyLFxyXG5cdFx0XHRcdFx0dGhpcy5jYW1zTGF5ZXIsXHJcblx0XHRcdFx0XHR0aGlzLnBhcnRpY2lwYW50c0xheWVyXHJcblx0XHRcdCAgXSxcclxuXHRcdFx0ICBjb250cm9sczogdGhpcy5pc1dpZGdldCA/IFtdIDogb2wuY29udHJvbC5kZWZhdWx0cygpLFxyXG5cdFx0XHQgIHZpZXc6IG5ldyBvbC5WaWV3KHtcclxuXHRcdFx0XHRjZW50ZXI6IG9sLnByb2oudHJhbnNmb3JtKGRlZlBvcywgJ0VQU0c6NDMyNicsICdFUFNHOjM4NTcnKSxcclxuXHRcdFx0XHR6b29tOiB0aGlzLmdldEluaXRpYWxab29tKCksXHJcblx0XHRcdFx0bWluWm9vbTogdGhpcy5pc1dpZGdldCA/IHRoaXMuaW5pdGlhbFpvb20gOiAxMCxcclxuXHRcdFx0XHRtYXhab29tOiB0aGlzLmlzV2lkZ2V0ID8gdGhpcy5pbml0aWFsWm9vbSA6IDE3LFxyXG5cdFx0XHRcdGV4dGVudCA6IGV4dGVudCA/IGV4dGVudCA6IHVuZGVmaW5lZFxyXG5cdFx0XHQgIH0pXHJcblx0XHRcdH0pO1xyXG5cdFx0XHRcclxuXHRcdFx0Zm9yICh2YXIgaT0wO2k8aW50cy5sZW5ndGg7aSsrKVxyXG5cdFx0XHRcdHRoaXMubWFwLmFkZEludGVyYWN0aW9uKGludHNbaV0pO1xyXG5cdFx0XHR0aGlzLm1hcC5hZGRPdmVybGF5KHRoaXMucG9wdXAxKTtcclxuXHRcdFx0dGhpcy5tYXAuYWRkT3ZlcmxheSh0aGlzLnBvcHVwMik7XHJcblx0XHRcdGlmICh0aGlzLmlzRGVidWcpIHsgXHJcblx0XHRcdFx0dGhpcy5tYXAuYWRkTGF5ZXIodGhpcy5kZWJ1Z0xheWVyR1BTKTtcclxuXHRcdFx0XHR0aGlzLm1hcC5hZGRMYXllcih0aGlzLnRlc3RMYXllcik7XHJcblx0XHRcdH1cclxuXHRcdFx0VFJBQ0suaW5pdCgpO1xyXG5cdFx0XHR0aGlzLmFkZFRyYWNrRmVhdHVyZSgpO1xyXG5cdFx0XHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRcdFx0aWYgKCF0aGlzLmlzV2lkZ2V0KSB7XHJcblx0XHRcdFx0dGhpcy5tYXAub24oJ2NsaWNrJywgZnVuY3Rpb24gKGV2ZW50KSB7XHJcblx0XHRcdFx0XHRUUkFDSy5vbk1hcENsaWNrKGV2ZW50KTtcclxuXHRcdFx0XHRcdHZhciBzZWxlY3RlZFBhcnRpY2lwYW50cyA9IFtdO1xyXG5cdFx0XHRcdFx0dmFyIHNlbGVjdGVkSG90c3BvdCA9IG51bGw7XHJcblx0XHRcdFx0XHR0aGlzLm1hcC5mb3JFYWNoRmVhdHVyZUF0UGl4ZWwoZXZlbnQucGl4ZWwsIGZ1bmN0aW9uIChmZWF0dXJlLCBsYXllcikge1xyXG5cdFx0XHRcdFx0XHRpZiAobGF5ZXIgPT0gdGhpcy5wYXJ0aWNpcGFudHNMYXllcikge1xyXG5cdFx0XHRcdFx0XHRcdHNlbGVjdGVkUGFydGljaXBhbnRzLnB1c2goZmVhdHVyZSk7XHJcblx0XHRcdFx0XHRcdH0gZWxzZSBpZiAobGF5ZXIgPT0gdGhpcy5ob3RzcG90c0xheWVyKSB7XHJcblx0XHRcdFx0XHRcdFx0Ly8gYWxsb3cgb25seSBvbmUgaG90c3BvdCB0byBiZSBzZWxlY3RlZCBhdCBhIHRpbWVcclxuXHRcdFx0XHRcdFx0XHRpZiAoIXNlbGVjdGVkSG90c3BvdClcclxuXHRcdFx0XHRcdFx0XHRcdHNlbGVjdGVkSG90c3BvdCA9IGZlYXR1cmU7XHJcblx0XHRcdFx0XHRcdH1cclxuXHRcdFx0XHRcdH0sIHRoaXMpO1xyXG5cclxuXHRcdFx0XHRcdC8vIGZpcnN0IGlmIHRoZXJlIGFyZSBzZWxlY3RlZCBwYXJ0aWNpcGFudHMgdGhlbiBzaG93IHRoZWlyIHBvcHVwc1xyXG5cdFx0XHRcdFx0Ly8gYW5kIG9ubHkgaWYgdGhlcmUgYXJlIG5vdCB1c2UgdGhlIHNlbGVjdGVkIGhvdHNwb3QgaWYgdGhlcmUncyBhbnlcclxuXHRcdFx0XHRcdGlmIChzZWxlY3RlZFBhcnRpY2lwYW50cy5sZW5ndGgpIHtcclxuXHRcdFx0XHRcdFx0aWYgKHRoaXMuc2VsZWN0ZWRQYXJ0aWNpcGFudDEgPT0gbnVsbCkge1xyXG5cdFx0XHRcdFx0XHRcdHZhciBmZWF0ID0gdGhpcy5nZXRTZWxlY3RlZFBhcnRpY2lwYW50RnJvbUFycmF5Q3ljbGljKHNlbGVjdGVkUGFydGljaXBhbnRzKTtcclxuXHRcdFx0XHRcdFx0XHRpZiAoZmVhdClcclxuXHRcdFx0XHRcdFx0XHRcdHRoaXMuc2V0U2VsZWN0ZWRQYXJ0aWNpcGFudDEoZmVhdC5wYXJ0aWNpcGFudCk7XHJcblx0XHRcdFx0XHRcdFx0ZWxzZVxyXG5cdFx0XHRcdFx0XHRcdFx0dGhpcy5zZXRTZWxlY3RlZFBhcnRpY2lwYW50MShudWxsKTtcclxuXHRcdFx0XHRcdFx0XHR0aGlzLnNlbGVjdE51bSA9IDA7XHJcblx0XHRcdFx0XHRcdH0gZWxzZSBpZiAodGhpcy5zZWxlY3RlZFBhcnRpY2lwYW50MiA9PSBudWxsKSB7XHJcblx0XHRcdFx0XHRcdFx0dmFyIGZlYXQgPSB0aGlzLmdldFNlbGVjdGVkUGFydGljaXBhbnRGcm9tQXJyYXlDeWNsaWMoc2VsZWN0ZWRQYXJ0aWNpcGFudHMpO1xyXG5cdFx0XHRcdFx0XHRcdGlmIChmZWF0KVxyXG5cdFx0XHRcdFx0XHRcdFx0dGhpcy5zZXRTZWxlY3RlZFBhcnRpY2lwYW50MihmZWF0LnBhcnRpY2lwYW50KTtcclxuXHRcdFx0XHRcdFx0XHRlbHNlXHJcblx0XHRcdFx0XHRcdFx0XHR0aGlzLnNldFNlbGVjdGVkUGFydGljaXBhbnQyKG51bGwpO1xyXG5cdFx0XHRcdFx0XHRcdHRoaXMuc2VsZWN0TnVtID0gMTtcclxuXHRcdFx0XHRcdFx0fSBlbHNlIHtcclxuXHRcdFx0XHRcdFx0XHR0aGlzLnNlbGVjdE51bSA9ICh0aGlzLnNlbGVjdE51bSArIDEpICUgMjtcclxuXHRcdFx0XHRcdFx0XHRpZiAodGhpcy5zZWxlY3ROdW0gPT0gMCkge1xyXG5cdFx0XHRcdFx0XHRcdFx0dmFyIGZlYXQgPSB0aGlzLmdldFNlbGVjdGVkUGFydGljaXBhbnRGcm9tQXJyYXlDeWNsaWMoc2VsZWN0ZWRQYXJ0aWNpcGFudHMpO1xyXG5cdFx0XHRcdFx0XHRcdFx0aWYgKGZlYXQpXHJcblx0XHRcdFx0XHRcdFx0XHRcdHRoaXMuc2V0U2VsZWN0ZWRQYXJ0aWNpcGFudDEoZmVhdC5wYXJ0aWNpcGFudCk7XHJcblx0XHRcdFx0XHRcdFx0XHRlbHNlXHJcblx0XHRcdFx0XHRcdFx0XHRcdHRoaXMuc2V0U2VsZWN0ZWRQYXJ0aWNpcGFudDEobnVsbCk7XHJcblx0XHRcdFx0XHRcdFx0fSBlbHNlIHtcclxuXHRcdFx0XHRcdFx0XHRcdHZhciBmZWF0ID0gdGhpcy5nZXRTZWxlY3RlZFBhcnRpY2lwYW50RnJvbUFycmF5Q3ljbGljKHNlbGVjdGVkUGFydGljaXBhbnRzKTtcclxuXHRcdFx0XHRcdFx0XHRcdGlmIChmZWF0KVxyXG5cdFx0XHRcdFx0XHRcdFx0XHR0aGlzLnNldFNlbGVjdGVkUGFydGljaXBhbnQyKGZlYXQucGFydGljaXBhbnQpO1xyXG5cdFx0XHRcdFx0XHRcdFx0ZWxzZVxyXG5cdFx0XHRcdFx0XHRcdFx0XHR0aGlzLnNldFNlbGVjdGVkUGFydGljaXBhbnQyKG51bGwpO1xyXG5cdFx0XHRcdFx0XHRcdH1cclxuXHRcdFx0XHRcdFx0fVxyXG5cdFx0XHRcdFx0fSBlbHNlIHtcclxuXHRcdFx0XHRcdFx0dGhpcy5zZXRTZWxlY3RlZFBhcnRpY2lwYW50MShudWxsKTtcclxuXHRcdFx0XHRcdFx0dGhpcy5zZXRTZWxlY3RlZFBhcnRpY2lwYW50MihudWxsKTtcclxuXHJcblx0XHRcdFx0XHRcdGlmIChzZWxlY3RlZEhvdHNwb3QpIHtcclxuXHRcdFx0XHRcdFx0XHRzZWxlY3RlZEhvdHNwb3QuaG90c3BvdC5vbkNsaWNrKCk7XHJcblx0XHRcdFx0XHRcdH1cclxuXHRcdFx0XHRcdH1cclxuXHRcdFx0XHR9LCB0aGlzKTtcclxuXHJcblx0XHRcdFx0Ly8gY2hhbmdlIG1vdXNlIGN1cnNvciB3aGVuIG92ZXIgc3BlY2lmaWMgZmVhdHVyZXNcclxuXHRcdFx0XHR2YXIgc2VsZiA9IHRoaXM7XHJcblx0XHRcdFx0JCh0aGlzLm1hcC5nZXRWaWV3cG9ydCgpKS5vbignbW91c2Vtb3ZlJywgZnVuY3Rpb24gKGUpIHtcclxuXHRcdFx0XHRcdHZhciBwaXhlbCA9IHNlbGYubWFwLmdldEV2ZW50UGl4ZWwoZS5vcmlnaW5hbEV2ZW50KTtcclxuXHRcdFx0XHRcdHZhciBpc0NsaWNrYWJsZSA9IHNlbGYubWFwLmZvckVhY2hGZWF0dXJlQXRQaXhlbChwaXhlbCwgZnVuY3Rpb24gKGZlYXR1cmUsIGxheWVyKSB7XHJcblx0XHRcdFx0XHRcdGlmIChsYXllciA9PT0gc2VsZi5wYXJ0aWNpcGFudHNMYXllciB8fCBsYXllciA9PT0gc2VsZi5jYW1zTGF5ZXIpIHtcclxuXHRcdFx0XHRcdFx0XHQvLyBhbGwgcGFydGljaXBhbnRzIGFuZCBtb3ZpbmcgY2FtZXJhcyBhcmUgY2xpY2thYmxlXHJcblx0XHRcdFx0XHRcdFx0cmV0dXJuIHRydWU7XHJcblx0XHRcdFx0XHRcdH0gZWxzZSBpZiAobGF5ZXIgPT09IHNlbGYuaG90c3BvdHNMYXllcikge1xyXG5cdFx0XHRcdFx0XHRcdC8vIGdldCBcImNsaWNrYWJpbGl0eVwiIGZyb20gdGhlIGhvdHNwb3RcclxuXHRcdFx0XHRcdFx0XHRyZXR1cm4gZmVhdHVyZS5ob3RzcG90LmlzQ2xpY2thYmxlKCk7XHJcblx0XHRcdFx0XHRcdH1cclxuXHRcdFx0XHRcdH0pO1xyXG5cdFx0XHRcdFx0c2VsZi5tYXAuZ2V0Vmlld3BvcnQoKS5zdHlsZS5jdXJzb3IgPSBpc0NsaWNrYWJsZSA/ICdwb2ludGVyJyA6ICcnO1xyXG5cdFx0XHRcdH0pO1xyXG5cdFx0XHR9XHJcblx0XHRcdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRcdFx0aWYgKCF0aGlzLl9hbmltYXRpb25Jbml0KSB7XHJcblx0XHRcdFx0dGhpcy5fYW5pbWF0aW9uSW5pdD10cnVlO1xyXG5cdFx0XHRcdHNldEludGVydmFsKHRoaXMub25BbmltYXRpb24uYmluZCh0aGlzKSwgMTAwMCpDT05GSUcudGltZW91dHMuYW5pbWF0aW9uRnJhbWUgKTtcclxuXHRcdFx0fVxyXG5cclxuXHRcdFx0Ly8gaWYgdGhpcyBpcyBPTiB0aGVuIGl0IHdpbGwgc2hvdyB0aGUgY29vcmRpbmF0ZXMgcG9zaXRpb24gdW5kZXIgdGhlIG1vdXNlIGxvY2F0aW9uXHJcblx0XHRcdGlmICh0aGlzLmlzRGVidWdTaG93UG9zaXRpb24pIHtcclxuXHRcdFx0XHQkKFwiI21hcFwiKS5hcHBlbmQoJzxwIGlkPVwiZGVidWdTaG93UG9zaXRpb25cIj5FUFNHOjM4NTcgPHNwYW4gaWQ9XCJtb3VzZTM4NTdcIj48L3NwYW4+ICZuYnNwOyBFUFNHOjQzMjYgPHNwYW4gaWQ9XCJtb3VzZTQzMjZcIj48L3NwYW4+Jyk7XHJcblx0XHRcdFx0dGhpcy5tYXAub24oJ3BvaW50ZXJtb3ZlJywgZnVuY3Rpb24oZXZlbnQpIHtcclxuXHRcdFx0XHRcdHZhciBjb29yZDM4NTcgPSBldmVudC5jb29yZGluYXRlO1xyXG5cdFx0XHRcdFx0dmFyIGNvb3JkNDMyNiA9IG9sLnByb2oudHJhbnNmb3JtKGNvb3JkMzg1NywgJ0VQU0c6Mzg1NycsICdFUFNHOjQzMjYnKTtcclxuXHRcdFx0XHRcdCQoJyNtb3VzZTM4NTcnKS50ZXh0KG9sLmNvb3JkaW5hdGUudG9TdHJpbmdYWShjb29yZDM4NTcsIDIpKTtcclxuXHRcdFx0XHRcdCQoJyNtb3VzZTQzMjYnKS50ZXh0KG9sLmNvb3JkaW5hdGUudG9TdHJpbmdYWShjb29yZDQzMjYsIDE1KSk7XHJcblx0XHRcdFx0fSk7XHJcblx0XHRcdH1cclxuXHJcblx0XHRcdC8vIHBhc3MgdGhlIGlkIG9mIHRoZSBET00gZWxlbWVudFxyXG5cdFx0XHR0aGlzLmxpdmVTdHJlYW0gPSBuZXcgTGl2ZVN0cmVhbSh7aWQgOiBcImxpdmVTdHJlYW1cIn0pO1xyXG4gICAgICAgIH0sXHJcblx0XHRcclxuICAgICAgICBcclxuICAgICAgICBhZGRUcmFja0ZlYXR1cmUgOiBmdW5jdGlvbigpIHtcclxuICAgICAgICBcdFRSQUNLLmluaXQoKTtcclxuICAgICAgICBcdGlmIChUUkFDSy5mZWF0dXJlKSB7XHJcbiAgICAgICAgXHRcdHZhciBmdCA9IHRoaXMudHJhY2tMYXllci5nZXRTb3VyY2UoKS5nZXRGZWF0dXJlcygpO1xyXG4gICAgICAgIFx0XHR2YXIgb2s9ZmFsc2U7XHJcbiAgICAgICAgXHRcdGZvciAodmFyIGk9MDtpPGZ0Lmxlbmd0aDtpKyspIFxyXG4gICAgICAgIFx0XHR7XHJcbiAgICAgICAgXHRcdFx0aWYgKGZ0W2ldID09IFRSQUNLLmZlYXR1cmUpXHJcbiAgICAgICAgXHRcdFx0e1xyXG4gICAgICAgIFx0XHRcdFx0b2s9dHJ1ZTtcclxuICAgICAgICBcdFx0XHRcdGJyZWFrO1xyXG4gICAgICAgIFx0XHRcdH1cclxuICAgICAgICBcdFx0fVxyXG4gICAgICAgIFx0XHRpZiAoIW9rKVxyXG4gICAgICAgIFx0XHRcdHRoaXMudHJhY2tMYXllci5nZXRTb3VyY2UoKS5hZGRGZWF0dXJlKFRSQUNLLmZlYXR1cmUpO1xyXG4gICAgICAgIFx0fVxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgem9vbVRvVHJhY2sgOiBmdW5jdGlvbigpIHtcclxuICAgICAgICAgICAgdmFyIGV4dGVudCA9IFRSQUNLLmdldFJvdXRlKCkgJiYgVFJBQ0suZ2V0Um91dGUoKS5sZW5ndGggPiAxID8gb2wucHJvai50cmFuc2Zvcm1FeHRlbnQoIChuZXcgb2wuZ2VvbS5MaW5lU3RyaW5nKFRSQUNLLmdldFJvdXRlKCkpKS5nZXRFeHRlbnQoKSAsICdFUFNHOjQzMjYnLCAnRVBTRzozODU3JykgOiBudWxsO1xyXG4gICAgICAgICAgICBpZiAoZXh0ZW50KVxyXG4gICAgICAgICAgICBcdHRoaXMubWFwLmdldFZpZXcoKS5maXRFeHRlbnQoZXh0ZW50LHRoaXMubWFwLmdldFNpemUoKSk7XHJcbiAgICAgICAgfSxcclxuICAgICAgICBcclxuICAgICAgICBnZXRTZWxlY3RlZFBhcnRpY2lwYW50RnJvbUFycmF5Q3ljbGljIDogZnVuY3Rpb24oZmVhdHVyZXMpIHtcclxuICAgIFx0XHR2YXIgYXJyID0gW107XHJcbiAgICBcdFx0dmFyIHRtYXAgPSB7fTtcclxuICAgIFx0XHR2YXIgY3JyUG9zID0gMDtcclxuXHRcdFx0dmFyIHBvcz1udWxsO1xyXG4gICAgXHRcdGZvciAodmFyIGk9MDtpPGZlYXR1cmVzLmxlbmd0aDtpKyspIHtcclxuICAgIFx0XHRcdHZhciBmZWF0dXJlID0gZmVhdHVyZXNbaV07XHJcbiAgICBcdFx0XHR2YXIgaWQgPSBmZWF0dXJlLnBhcnRpY2lwYW50LmNvZGU7XHJcbiAgICBcdFx0XHRhcnIucHVzaChpZCk7XHJcbiAgICBcdFx0XHR0bWFwW2lkXT10cnVlO1xyXG5cdFx0XHRcdGlmIChpZCA9PSB0aGlzLnZyX2xhc3RzZWxlY3RlZCkge1xyXG5cdFx0XHRcdFx0cG9zPWk7XHJcblx0XHRcdFx0fVxyXG4gICAgXHRcdH1cclxuICAgIFx0XHR2YXIgc2FtZSA9IHRoaXMudnJfb2xkYmVzdGFyciAmJiBwb3MgIT0gbnVsbDsgXHJcbiAgICBcdFx0aWYgKHNhbWUpIFxyXG4gICAgXHRcdHtcclxuICAgIFx0XHRcdC8vIGFsbCBmcm9tIHRoZSBvbGQgY29udGFpbmVkIGluIHRoZSBuZXdcclxuICAgIFx0XHRcdGZvciAodmFyIGk9MDtpPHRoaXMudnJfb2xkYmVzdGFyci5sZW5ndGg7aSsrKSBcclxuICAgIFx0XHRcdHtcclxuICAgIFx0XHRcdFx0aWYgKCF0bWFwW3RoaXMudnJfb2xkYmVzdGFycltpXV0pIHtcclxuICAgIFx0XHRcdFx0XHRzYW1lPWZhbHNlO1xyXG4gICAgXHRcdFx0XHRcdGJyZWFrO1xyXG4gICAgXHRcdFx0XHR9XHJcbiAgICBcdFx0XHR9XHJcbiAgICBcdFx0fVxyXG4gICAgXHRcdGlmICghc2FtZSkge1xyXG4gICAgXHRcdFx0dGhpcy52cl9vbGRiZXN0YXJyPWFycjtcclxuICAgIFx0XHRcdHRoaXMudnJfbGFzdHNlbGVjdGVkPWFyclswXTtcclxuICAgIFx0XHRcdHJldHVybiBmZWF0dXJlc1swXTtcclxuICAgIFx0XHR9IGVsc2Uge1xyXG4gICAgXHRcdFx0dGhpcy52cl9sYXN0c2VsZWN0ZWQgPSBwb3MgPiAwID8gYXJyW3Bvcy0xXSA6IGFyclthcnIubGVuZ3RoLTFdOyAgICBcdFx0XHRcclxuICAgICAgICBcdFx0dmFyIHJlc3VsdEZlYXR1cmU7XHJcbiAgICBcdFx0XHRmb3IgKHZhciBpPTA7aTxmZWF0dXJlcy5sZW5ndGg7aSsrKSBcclxuICAgICAgICBcdFx0e1xyXG4gICAgICAgIFx0XHRcdHZhciBmZWF0dXJlID0gZmVhdHVyZXNbaV07XHJcbiAgICAgICAgXHRcdFx0dmFyIGlkID0gZmVhdHVyZS5wYXJ0aWNpcGFudC5jb2RlO1xyXG4gICAgICAgIFx0XHRcdGlmIChpZCA9PSB0aGlzLnZyX2xhc3RzZWxlY3RlZCkge1xyXG4gICAgICAgIFx0XHRcdFx0cmVzdWx0RmVhdHVyZT1mZWF0dXJlO1xyXG4gICAgICAgIFx0XHRcdFx0YnJlYWs7XHJcbiAgICAgICAgXHRcdFx0fVxyXG4gICAgICAgIFx0XHR9XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gcmVzdWx0RmVhdHVyZTtcclxuICAgIFx0XHR9XHJcbiAgICAgICAgfSxcclxuICAgICAgICBcclxuXHRcdHNob3dFcnJvciA6IGZ1bmN0aW9uKG1zZyxvbkNsb3NlQ2FsbGJhY2spXHJcblx0XHR7XHJcblx0XHRcdGFsZXJ0KFwiRVJST1IgOiBcIittc2cpO1xyXG5cdFx0XHRpZiAob25DbG9zZUNhbGxiYWNrKSBcclxuXHRcdFx0XHRvbkNsb3NlQ2FsbGJhY2soKTtcclxuXHRcdH0sXHJcblx0XHRcclxuXHRcdG9uQW5pbWF0aW9uIDogZnVuY3Rpb24oKVxyXG5cdFx0e1xyXG5cdFx0XHR2YXIgYXJyPVtdO1xyXG5cdFx0XHRmb3IgKHZhciBpcD0wO2lwPFRSQUNLLnBhcnRpY2lwYW50cy5sZW5ndGg7aXArKylcclxuXHRcdFx0e1xyXG5cdFx0XHRcdHZhciBwID0gVFJBQ0sucGFydGljaXBhbnRzW2lwXTtcclxuXHRcdFx0XHRpZiAocC5pc0Zhdm9yaXRlKVxyXG5cdFx0XHRcdHtcclxuXHRcdFx0XHRcdHAuaW50ZXJwb2xhdGUoKTtcclxuXHJcblx0XHRcdFx0XHQvLyB0aGlzIHdpbGwgYWRkIGluIHRoZSByYW5raW5nIHBvc2l0aW5nIG9ubHkgdGhlIHBhcnRpY2lwYW50cyB0aGUgaGFzIHRvIGJlIHRyYWNrZWRcclxuXHRcdFx0XHRcdC8vIHNvIG1vdmluZyBjYW1zIGFyZSBza2lwcGVkXHJcblx0XHRcdFx0XHRpZiAoIXAuX19za2lwVHJhY2tpbmdQb3MpXHJcblx0XHRcdFx0XHRcdGFyci5wdXNoKGlwKTtcclxuXHRcdFx0XHR9XHJcblx0XHRcdH1cclxuXHRcdFx0Ly8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0XHRcdC8vIHdlIGhhdmUgdG8gc29ydCB0aGVtIG90aGVyd2lzZSB0aGlzIF9fcG9zLCBfX3ByZXYsIF9fbmV4dCBhcmUgaXJyZWxldmFudFxyXG5cdFx0XHRhcnIuc29ydChmdW5jdGlvbihpcDEsIGlkMil7XHJcblx0XHRcdFx0cmV0dXJuIFRSQUNLLnBhcnRpY2lwYW50c1tpZDJdLmdldEVsYXBzZWQoKSAtIFRSQUNLLnBhcnRpY2lwYW50c1tpcDFdLmdldEVsYXBzZWQoKTtcclxuXHRcdFx0fSk7XHJcblx0XHRcdGZvciAodmFyIGlwPTA7aXA8YXJyLmxlbmd0aDtpcCsrKVxyXG5cdFx0XHR7XHJcblx0XHRcdFx0VFJBQ0sucGFydGljaXBhbnRzW2FycltpcF1dLl9fcG9zPWlwO1xyXG5cdFx0XHRcdGlmIChpcCA9PSAwKVxyXG5cdFx0XHRcdFx0ZGVsZXRlIFRSQUNLLnBhcnRpY2lwYW50c1thcnJbaXBdXS5fX3ByZXY7XHJcblx0XHRcdFx0ZWxzZVxyXG5cdFx0XHRcdFx0VFJBQ0sucGFydGljaXBhbnRzW2FycltpcF1dLl9fcHJldj1UUkFDSy5wYXJ0aWNpcGFudHNbYXJyW2lwLTFdXTtcclxuXHRcdFx0XHRpZiAoaXAgPT0gVFJBQ0sucGFydGljaXBhbnRzLmxlbmd0aC0xKVxyXG5cdFx0XHRcdFx0ZGVsZXRlICBUUkFDSy5wYXJ0aWNpcGFudHNbYXJyW2lwXV0uX19uZXh0O1xyXG5cdFx0XHRcdGVsc2VcclxuXHRcdFx0XHRcdFRSQUNLLnBhcnRpY2lwYW50c1thcnJbaXBdXS5fX25leHQ9VFJBQ0sucGFydGljaXBhbnRzW2FycltpcCsxXV07XHJcblx0XHRcdH1cclxuXHRcdFx0Ly8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0XHRcdGlmICh0aGlzLnNlbGVjdGVkUGFydGljaXBhbnQxKSBcclxuXHRcdFx0e1xyXG5cdFx0XHRcdHZhciBzcG9zID0gdGhpcy5zZWxlY3RlZFBhcnRpY2lwYW50MS5nZXRGZWF0dXJlKCkuZ2V0R2VvbWV0cnkoKS5nZXRDb29yZGluYXRlcygpO1xyXG5cdFx0XHRcdGlmICghdGhpcy5wb3B1cDEuaXNfc2hvd24pIHtcclxuXHRcdFx0XHQgICAgdGhpcy5wb3B1cDEuc2hvdyhzcG9zLCB0aGlzLnBvcHVwMS5sYXN0SFRNTD10aGlzLnNlbGVjdGVkUGFydGljaXBhbnQxLmdldFBvcHVwSFRNTCgpKTtcclxuXHRcdFx0XHQgICAgdGhpcy5wb3B1cDEuaXNfc2hvd249MTtcclxuXHRcdFx0XHR9IGVsc2Uge1xyXG5cdFx0XHRcdFx0aWYgKCF0aGlzLnBvcHVwMS5nZXRQb3NpdGlvbigpIHx8IHRoaXMucG9wdXAxLmdldFBvc2l0aW9uKClbMF0gIT0gc3Bvc1swXSB8fCB0aGlzLnBvcHVwMS5nZXRQb3NpdGlvbigpWzFdICE9IHNwb3NbMV0pXHJcblx0XHRcdFx0XHQgICAgdGhpcy5wb3B1cDEuc2V0UG9zaXRpb24oc3Bvcyk7XHJcblx0XHRcdFx0XHR2YXIgY3RpbWUgPSAobmV3IERhdGUoKSkuZ2V0VGltZSgpO1x0XHRcdCBcclxuXHRcdFx0XHRcdGlmICghdGhpcy5sYXN0UG9wdXBSZWZlcmVzaDEgfHwgY3RpbWUgLSB0aGlzLmxhc3RQb3B1cFJlZmVyZXNoMSA+IDIwMDApIFxyXG5cdFx0XHRcdFx0e1xyXG5cdFx0XHRcdFx0XHR0aGlzLmxhc3RQb3B1cFJlZmVyZXNoMT1jdGltZTtcclxuXHRcdFx0XHRcdCAgICB2YXIgcnIgPSB0aGlzLnNlbGVjdGVkUGFydGljaXBhbnQxLmdldFBvcHVwSFRNTCgpO1xyXG5cdFx0XHRcdFx0ICAgIGlmIChyciAhPSB0aGlzLnBvcHVwMS5sYXN0SFRNTCkge1xyXG5cdFx0XHRcdFx0ICAgIFx0dGhpcy5wb3B1cDEubGFzdEhUTUw9cnI7XHJcblx0XHRcdFx0XHRcdCAgICB0aGlzLnBvcHVwMS5jb250ZW50LmlubmVySFRNTD1ycjsgXHJcblx0XHRcdFx0XHQgICAgfVx0XHRcdFx0XHRcclxuXHRcdFx0XHRcdH1cclxuXHRcdFx0XHQgICAgdGhpcy5wb3B1cDEucGFuSW50b1ZpZXdfKHNwb3MpO1xyXG5cdFx0XHRcdH1cclxuXHRcdFx0fVxyXG5cdFx0XHRpZiAodGhpcy5zZWxlY3RlZFBhcnRpY2lwYW50MikgXHJcblx0XHRcdHtcclxuXHRcdFx0XHR2YXIgc3BvcyA9IHRoaXMuc2VsZWN0ZWRQYXJ0aWNpcGFudDIuZ2V0RmVhdHVyZSgpLmdldEdlb21ldHJ5KCkuZ2V0Q29vcmRpbmF0ZXMoKTtcclxuXHRcdFx0XHRpZiAoIXRoaXMucG9wdXAyLmlzX3Nob3duKSB7XHJcblx0XHRcdFx0ICAgIHRoaXMucG9wdXAyLnNob3coc3BvcywgdGhpcy5wb3B1cDIubGFzdEhUTUw9dGhpcy5zZWxlY3RlZFBhcnRpY2lwYW50Mi5nZXRQb3B1cEhUTUwoKSk7XHJcblx0XHRcdFx0ICAgIHRoaXMucG9wdXAyLmlzX3Nob3duPTE7XHJcblx0XHRcdFx0fSBlbHNlIHtcclxuXHRcdFx0XHRcdGlmICghdGhpcy5wb3B1cDIuZ2V0UG9zaXRpb24oKSB8fCB0aGlzLnBvcHVwMi5nZXRQb3NpdGlvbigpWzBdICE9IHNwb3NbMF0gfHwgdGhpcy5wb3B1cDIuZ2V0UG9zaXRpb24oKVsxXSAhPSBzcG9zWzFdKVxyXG5cdFx0XHRcdFx0ICAgIHRoaXMucG9wdXAyLnNldFBvc2l0aW9uKHNwb3MpO1xyXG5cdFx0XHRcdFx0dmFyIGN0aW1lID0gKG5ldyBEYXRlKCkpLmdldFRpbWUoKTtcdFx0XHQgXHJcblx0XHRcdFx0XHRpZiAoIXRoaXMubGFzdFBvcHVwUmVmZXJlc2gyIHx8IGN0aW1lIC0gdGhpcy5sYXN0UG9wdXBSZWZlcmVzaDIgPiAyMDAwKSBcclxuXHRcdFx0XHRcdHtcclxuXHRcdFx0XHRcdFx0dGhpcy5sYXN0UG9wdXBSZWZlcmVzaDI9Y3RpbWU7XHJcblx0XHRcdFx0XHQgICAgdmFyIHJyID0gdGhpcy5zZWxlY3RlZFBhcnRpY2lwYW50Mi5nZXRQb3B1cEhUTUwoKTtcclxuXHRcdFx0XHRcdCAgICBpZiAocnIgIT0gdGhpcy5wb3B1cDIubGFzdEhUTUwpIHtcclxuXHRcdFx0XHRcdCAgICBcdHRoaXMucG9wdXAyLmxhc3RIVE1MPXJyO1xyXG5cdFx0XHRcdFx0XHQgICAgdGhpcy5wb3B1cDIuY29udGVudC5pbm5lckhUTUw9cnI7IFxyXG5cdFx0XHRcdFx0ICAgIH1cdFx0XHRcdFx0XHJcblx0XHRcdFx0XHR9XHJcblx0XHRcdFx0ICAgIHRoaXMucG9wdXAyLnBhbkludG9WaWV3XyhzcG9zKTtcclxuXHRcdFx0XHR9XHJcblx0XHRcdH1cclxuXHRcdFx0Ly8tLS0tLS0tLS0tLS0tLS0tLS0tLVx0XHRcdFxyXG5cdFx0XHRpZiAodGhpcy5pc0RlYnVnKSAgXHJcblx0XHRcdFx0dGhpcy5kb0RlYnVnQW5pbWF0aW9uKCk7XHJcblx0XHR9LFxyXG5cdFx0XHJcblx0XHRzZXRTZWxlY3RlZFBhcnRpY2lwYW50MSA6IGZ1bmN0aW9uKHBhcnQsY2VudGVyKSBcclxuXHRcdHtcclxuXHRcdFx0aWYgKCEocGFydCBpbnN0YW5jZW9mIFBhcnRpY2lwYW50KSkge1xyXG5cdFx0XHRcdHZhciBwcD1wYXJ0O1xyXG5cdFx0XHRcdHBhcnQ9bnVsbDtcclxuXHRcdFx0XHRmb3IgKHZhciBpPTA7aTxUUkFDSy5wYXJ0aWNpcGFudHMubGVuZ3RoO2krKylcclxuXHRcdFx0XHRcdGlmIChUUkFDSy5wYXJ0aWNpcGFudHNbaV0uZGV2aWNlSWQgPT0gcHApIHtcclxuXHRcdFx0XHRcdFx0cGFydD1UUkFDSy5wYXJ0aWNpcGFudHNbaV07XHJcblx0XHRcdFx0XHRcdGJyZWFrO1xyXG5cdFx0XHRcdFx0fVxyXG5cdFx0XHR9XHJcblx0XHRcdHRoaXMuc2VsZWN0ZWRQYXJ0aWNpcGFudDE9cGFydDtcclxuXHRcdFx0aWYgKCFwYXJ0KSB7XHJcblx0XHRcdFx0dGhpcy5wb3B1cDEuaGlkZSgpO1xyXG5cdFx0XHRcdGRlbGV0ZSB0aGlzLnBvcHVwMS5pc19zaG93bjtcclxuXHRcdFx0fSBlbHNlIHtcclxuXHRcdFx0XHR0aGlzLmxhc3RQb3B1cFJlZmVyZXNoMT0wO1xyXG5cdFx0XHRcdGlmIChjZW50ZXIgJiYgR1VJLm1hcCAmJiBwYXJ0LmZlYXR1cmUpIHtcclxuXHRcdFx0XHRcdHZhciB4ID0gKHBhcnQuZmVhdHVyZS5nZXRHZW9tZXRyeSgpLmdldEV4dGVudCgpWzBdK3BhcnQuZmVhdHVyZS5nZXRHZW9tZXRyeSgpLmdldEV4dGVudCgpWzJdKS8yO1xyXG5cdFx0XHRcdFx0dmFyIHkgPSAocGFydC5mZWF0dXJlLmdldEdlb21ldHJ5KCkuZ2V0RXh0ZW50KClbMV0rcGFydC5mZWF0dXJlLmdldEdlb21ldHJ5KCkuZ2V0RXh0ZW50KClbM10pLzI7XHJcblx0XHRcdFx0XHRHVUkubWFwLmdldFZpZXcoKS5zZXRDZW50ZXIoW3gseV0pO1xyXG5cdFx0XHRcdH1cclxuXHRcdFx0fSBcclxuXHRcdH0sXHJcblxyXG5cdFx0c2V0U2VsZWN0ZWRQYXJ0aWNpcGFudDIgOiBmdW5jdGlvbihwYXJ0LGNlbnRlcikgXHJcblx0XHR7XHJcblx0XHRcdGlmICghKHBhcnQgaW5zdGFuY2VvZiBQYXJ0aWNpcGFudCkpIHtcclxuXHRcdFx0XHR2YXIgcHA9cGFydDtcclxuXHRcdFx0XHRwYXJ0PW51bGw7XHJcblx0XHRcdFx0Zm9yICh2YXIgaT0wO2k8VFJBQ0sucGFydGljaXBhbnRzLmxlbmd0aDtpKyspXHJcblx0XHRcdFx0XHRpZiAoVFJBQ0sucGFydGljaXBhbnRzW2ldLmRldmljZUlkID09IHBwKSB7XHJcblx0XHRcdFx0XHRcdHBhcnQ9VFJBQ0sucGFydGljaXBhbnRzW2ldO1xyXG5cdFx0XHRcdFx0XHRicmVhaztcclxuXHRcdFx0XHRcdH1cclxuXHRcdFx0fVxyXG5cdFx0XHR0aGlzLnNlbGVjdGVkUGFydGljaXBhbnQyPXBhcnQ7XHJcblx0XHRcdGlmICghcGFydCkge1xyXG5cdFx0XHRcdHRoaXMucG9wdXAyLmhpZGUoKTtcclxuXHRcdFx0XHRkZWxldGUgdGhpcy5wb3B1cDIuaXNfc2hvd247XHJcblx0XHRcdH0gZWxzZSB7XHJcblx0XHRcdFx0dGhpcy5sYXN0UG9wdXBSZWZlcmVzaDI9MDtcclxuXHRcdFx0XHRpZiAoY2VudGVyICYmIEdVSS5tYXAgJiYgcGFydC5mZWF0dXJlKSB7XHJcblx0XHRcdFx0XHR2YXIgeCA9IChwYXJ0LmZlYXR1cmUuZ2V0R2VvbWV0cnkoKS5nZXRFeHRlbnQoKVswXStwYXJ0LmZlYXR1cmUuZ2V0R2VvbWV0cnkoKS5nZXRFeHRlbnQoKVsyXSkvMjtcclxuXHRcdFx0XHRcdHZhciB5ID0gKHBhcnQuZmVhdHVyZS5nZXRHZW9tZXRyeSgpLmdldEV4dGVudCgpWzFdK3BhcnQuZmVhdHVyZS5nZXRHZW9tZXRyeSgpLmdldEV4dGVudCgpWzNdKS8yO1xyXG5cdFx0XHRcdFx0R1VJLm1hcC5nZXRWaWV3KCkuc2V0Q2VudGVyKFt4LHldKTtcclxuXHRcdFx0XHR9XHJcblx0XHRcdH0gXHJcblx0XHR9LFxyXG5cclxuXHRcdGRvRGVidWdBbmltYXRpb24gOiBmdW5jdGlvbigpIFxyXG5cdFx0e1xyXG5cdFx0XHR2YXIgY3RpbWUgPSAobmV3IERhdGUoKSkuZ2V0VGltZSgpO1xyXG5cdFx0XHR2YXIgdG9kZWw9W107XHJcblx0XHRcdHZhciByciA9IHRoaXMuZGVidWdMYXllckdQUy5nZXRTb3VyY2UoKS5nZXRGZWF0dXJlcygpO1xyXG5cdFx0XHRmb3IgKHZhciBpPTA7aTxyci5sZW5ndGg7aSsrKVxyXG5cdFx0XHR7XHJcblx0XHRcdFx0dmFyIGYgPSBycltpXTtcclxuXHRcdFx0XHRpZiAoY3RpbWUgLSBmLnRpbWVDcmVhdGVkIC0gQ09ORklHLm1hdGguZGlzcGxheURlbGF5KjEwMDAgPiBDT05GSUcudGltZW91dHMuZ3BzTG9jYXRpb25EZWJ1Z1Nob3cqMTAwMClcclxuXHRcdFx0XHRcdHRvZGVsLnB1c2goZik7XHJcblx0XHRcdFx0ZWxzZVxyXG5cdFx0XHRcdFx0Zi5jaGFuZ2VkKCk7XHJcblx0XHRcdH1cclxuXHRcdFx0aWYgKHRvZGVsLmxlbmd0aCkgXHJcblx0XHRcdHtcclxuXHRcdFx0XHRmb3IgKHZhciBpPTA7aTx0b2RlbC5sZW5ndGg7aSsrKVxyXG5cdFx0XHRcdFx0dGhpcy5kZWJ1Z0xheWVyR1BTLmdldFNvdXJjZSgpLnJlbW92ZUZlYXR1cmUodG9kZWxbaV0pO1xyXG5cdFx0XHR9XHJcblx0XHRcdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdFx0fSxcclxuXHRcdFxyXG5cdFx0cmVkcmF3IDogZnVuY3Rpb24oKSB7XHJcblx0XHRcdHRoaXMuZ2V0VHJhY2soKS5nZXRGZWF0dXJlKCkuY2hhbmdlZCgpO1xyXG5cdFx0fSxcclxuXHJcbiAgICAgICAgLyoqXHJcbiAgICAgICAgICogU2hvdyB0aGUgbGl2ZS1zdHJlYW1pbmcgY29udGFpbmVyLiBJZiB0aGUgcGFzc2VkICdzdHJlYW1JZCcgaXMgdmFsaWQgdGhlbiBpdCBvcGVucyBpdHMgc3RyZWFtIGRpcmVjdGx5LlxyXG4gICAgICAgICAqIEBwYXJhbSB7U3RyaW5nfSBbc3RyZWFtSWRdXHJcbiAgICAgICAgICogQHBhcmFtIHtGdW5jdGlvbn0gW2NvbXBsZXRlQ2FsbGJhY2tdXHJcbiAgICAgICAgICovXHJcbiAgICAgICAgc2hvd0xpdmVTdHJlYW0gOiBmdW5jdGlvbihzdHJlYW1JZCwgY29tcGxldGVDYWxsYmFjaykge1xyXG4gICAgICAgICAgICB0aGlzLmxpdmVTdHJlYW0uc2hvdyhzdHJlYW1JZCwgY29tcGxldGVDYWxsYmFjayk7XHJcbiAgICAgICAgfSxcclxuXHJcbiAgICAgICAgLyoqXHJcbiAgICAgICAgICogVG9nZ2xlIHRoZSBsaXZlLXN0cmVhbWluZyBjb250YWluZXIgY29udGFpbmVyXHJcblx0XHQgKiBAcGFyYW0ge0Z1bmN0aW9ufSBbY29tcGxldGVDYWxsYmFja11cclxuICAgICAgICAgKi9cclxuICAgICAgICB0b2dnbGVMaXZlU3RyZWFtOiBmdW5jdGlvbihjb21wbGV0ZUNhbGxiYWNrKSB7XHJcbiAgICAgICAgICAgIHJldHVybiB0aGlzLmxpdmVTdHJlYW0udG9nZ2xlKGNvbXBsZXRlQ2FsbGJhY2spO1xyXG4gICAgICAgIH1cclxuXHRcdFxyXG4gICAgfVxyXG59KTsiLCJyZXF1aXJlKCdqb29zZScpO1xyXG5yZXF1aXJlKCcuL1V0aWxzJyk7XHJcblxyXG5DbGFzcyhcIkxpdmVTdHJlYW1cIiwge1xyXG4gICAgaGFzIDoge1xyXG4gICAgICAgIF8kY29tcCA6IHtcclxuICAgICAgICAgICAgaW5pdDogZnVuY3Rpb24oY29uZmlnKSB7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gJCgnIycgKyBjb25maWcuaWQpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfSxcclxuXHJcbiAgICAgICAgX2lzU2hvd24gOiB7XHJcbiAgICAgICAgICAgaW5pdCA6IGZhbHNlXHJcbiAgICAgICAgfSxcclxuXHJcbiAgICAgICAgX2lzVmFsaWQgOiB7XHJcbiAgICAgICAgICAgIGluaXQgOiBmYWxzZVxyXG4gICAgICAgIH1cclxuICAgIH0sXHJcbiAgICBtZXRob2RzOiB7XHJcbiAgICAgICAgaW5pdGlhbGl6ZTogZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgICAgIHZhciBsaXZlU3RyZWFtcyA9IHdpbmRvdy5MSVZFX1NUUkVBTVM7XHJcbiAgICAgICAgICAgIGlmICghbGl2ZVN0cmVhbXMgfHwgbGl2ZVN0cmVhbXMubGVuZ3RoIDw9IDApIHtcclxuICAgICAgICAgICAgICAgIGNvbnNvbGUud2FybihcIk5vIGxpdmUgc3RyZWFtcyBzZXRcIik7XHJcbiAgICAgICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIC8vIGluaXRpYWxpemUgdGhlIHN0cmVhbXNcclxuICAgICAgICAgICAgdmFyIHNlbGYgPSB0aGlzO1xyXG4gICAgICAgICAgICB2YXIgaSA9IDA7XHJcbiAgICAgICAgICAgIHRoaXMuXyRjb21wLmZpbmQoXCIubGl2ZVN0cmVhbVRodW1iXCIpLmFkZENsYXNzKFwiaW5hY3RpdmVcIikuZWFjaChmdW5jdGlvbigpIHtcclxuICAgICAgICAgICAgICAgIHZhciBzdHJlYW0gPSBsaXZlU3RyZWFtc1tpXTtcclxuICAgICAgICAgICAgICAgIGkrKztcclxuICAgICAgICAgICAgICAgIGlmICghc3RyZWFtKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgJCh0aGlzKS5hZGRDbGFzcyhcInZhbGlkXCIpLmRhdGEoXCJpZFwiLCBzdHJlYW0uaWQpLmRhdGEoXCJ1cmxcIiwgc3RyZWFtLnVybCk7XHJcblxyXG4gICAgICAgICAgICAgICAgLy8gYXQgbGVhc3Qgb25lIHZhbGlkIHRodW1iIC0gc28gdGhlIHdob2xlIExpdmVTdHJlYW0gaXMgdmFsaWRcclxuICAgICAgICAgICAgICAgIHNlbGYuX2lzVmFsaWQgPSB0cnVlO1xyXG4gICAgICAgICAgICB9KS5maWx0ZXIoXCIudmFsaWRcIikuY2xpY2soZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgICAgICAgICB2YXIgJHRoaXMgPSAkKHRoaXMpO1xyXG5cclxuICAgICAgICAgICAgICAgIC8vIGlmIGNsaWNrZWQgb24gdGhlIHNhbWUgYWN0aXZlIHRodW1iIHRoZW4gc2tpcCBpdFxyXG4gICAgICAgICAgICAgICAgaWYgKCEkdGhpcy5oYXNDbGFzcyhcImluYWN0aXZlXCIpKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgICAgc2VsZi5fc2hvd1N0cmVhbSgkdGhpcyk7XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgIH0sXHJcblxyXG4gICAgICAgIHNob3c6IGZ1bmN0aW9uKHN0cmVhbUlkLCBjb21wbGV0ZUNhbGxiYWNrKSB7XHJcbiAgICAgICAgICAgIGlmICghdGhpcy5faXNWYWxpZClcclxuICAgICAgICAgICAgICAgcmV0dXJuO1xyXG5cclxuICAgICAgICAgICAgdmFyICR0aHVtYiA9IG51bGw7XHJcbiAgICAgICAgICAgIHZhciAkdGh1bWJzID0gdGhpcy5fJGNvbXAuZmluZChcIi5saXZlU3RyZWFtVGh1bWIudmFsaWRcIik7XHJcbiAgICAgICAgICAgIGlmICghaXNEZWZpbmVkKHN0cmVhbUlkKSkge1xyXG4gICAgICAgICAgICAgICAgJHRodW1iID0gJHRodW1icy5lcSgwKTtcclxuICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgICR0aHVtYnMuZWFjaChmdW5jdGlvbigpIHtcclxuICAgICAgICAgICAgICAgICAgICBpZiAoc3RyZWFtSWQgPT09ICQodGhpcykuZGF0YShcImlkXCIpKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICR0aHVtYiA9ICQodGhpcyk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBmYWxzZTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgaWYgKCEkdGh1bWIpIHtcclxuICAgICAgICAgICAgICAgIGNvbnNvbGUud2FybihcIk5vIHN0cmVhbSBmb3IgaWQgOiBcIiArIHN0cmVhbUlkKTtcclxuICAgICAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgdGhpcy5fc2hvd1N0cmVhbSgkdGh1bWIsIGNvbXBsZXRlQ2FsbGJhY2spO1xyXG4gICAgICAgIH0sXHJcblxyXG4gICAgICAgIC8qKlxyXG4gICAgICAgICAqXHJcbiAgICAgICAgICogQHJldHVybiB7Ym9vbGVhbn1cclxuICAgICAgICAgKi9cclxuICAgICAgICB0b2dnbGUgOiBmdW5jdGlvbihjb21wbGV0ZUNhbGxiYWNrKSB7XHJcbiAgICAgICAgICAgIGlmICghdGhpcy5faXNWYWxpZClcclxuICAgICAgICAgICAgICAgIHJldHVybjtcclxuXHJcbiAgICAgICAgICAgIC8vIGlmIHNob3duIGhpZGUgb3RoZXJ3aXNlIHNob3dcclxuICAgICAgICAgICAgaWYgKHRoaXMuX2lzU2hvd24pXHJcbiAgICAgICAgICAgICAgICB0aGlzLl9oaWRlKGNvbXBsZXRlQ2FsbGJhY2spO1xyXG4gICAgICAgICAgICBlbHNlXHJcbiAgICAgICAgICAgICAgICB0aGlzLnNob3coY29tcGxldGVDYWxsYmFjayk7XHJcblxyXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5faXNTaG93bjtcclxuICAgICAgICB9LFxyXG5cclxuICAgICAgICAvKiBQcml2YXRlIE1ldGhvZHMgKi9cclxuXHJcbiAgICAgICAgX2hpZGUgOiBmdW5jdGlvbihjb21wbGV0ZUNhbGxiYWNrKSB7XHJcbiAgICAgICAgICAgIHZhciBzZWxmID0gdGhpcztcclxuICAgICAgICAgICAgdGhpcy5fJGNvbXAuc2xpZGVVcCg0MDAsIGZ1bmN0aW9uKCkge1xyXG4gICAgICAgICAgICAgICAgLy8gc3RvcCB0aGUgc3RyZWFtIHdoZW4gd2hvbGUgcGFuZWwgaGFzIGNvbXBsZXRlZCBhbmltYXRpb25cclxuICAgICAgICAgICAgICAgIHNlbGYuXyRjb21wLmZpbmQoXCIubGl2ZVN0cmVhbVBsYXllclwiKS5lbXB0eSgpO1xyXG4gICAgICAgICAgICAgICAgY29tcGxldGVDYWxsYmFjaygpO1xyXG4gICAgICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgICAgIHRoaXMuX2lzU2hvd24gPSBmYWxzZTtcclxuICAgICAgICB9LFxyXG5cclxuICAgICAgICBfc2hvd1N0cmVhbSA6IGZ1bmN0aW9uKCR0aHVtYiwgY29tcGxldGVDYWxsYmFjaykge1xyXG4gICAgICAgICAgICAvLyB0b2dnbGUgdGhlIFwiaW5hY3RpdmVcIiBjbGFzc1xyXG4gICAgICAgICAgICB0aGlzLl8kY29tcC5maW5kKFwiLmxpdmVTdHJlYW1UaHVtYlwiKS5hZGRDbGFzcyhcImluYWN0aXZlXCIpO1xyXG4gICAgICAgICAgICAkdGh1bWIucmVtb3ZlQ2xhc3MoXCJpbmFjdGl2ZVwiKTtcclxuXHJcbiAgICAgICAgICAgIC8vIHNob3cgdGhlIG5ldyBzdHJlYW1cclxuICAgICAgICAgICAgdmFyIHVybCA9ICR0aHVtYi5kYXRhKFwidXJsXCIpO1xyXG4gICAgICAgICAgICB2YXIgJHBsYXllciA9IHRoaXMuXyRjb21wLmZpbmQoXCIubGl2ZVN0cmVhbVBsYXllclwiKTtcclxuICAgICAgICAgICAgJHBsYXllci5odG1sKCc8aWZyYW1lIHNyYz0nICsgdXJsICsgJz93aWR0aD00OTAmaGVpZ2h0PTI3NSZhdXRvUGxheT10cnVlJm11dGU9ZmFsc2VcIiB3aWR0aD1cIjQ5MFwiIGhlaWdodD1cIjI3NVwiIGZyYW1lYm9yZGVyPVwiMFwiIHNjcm9sbGluZz1cIm5vXCIgJytcclxuICAgICAgICAgICAgJ2FsbG93ZnVsbHNjcmVlbiB3ZWJraXRhbGxvd2Z1bGxzY3JlZW4gbW96YWxsb3dmdWxsc2NyZWVuIG9hbGxvd2Z1bGxzY3JlZW4gbXNhbGxvd2Z1bGxzY3JlZW4+PC9pZnJhbWU+Jyk7XHJcblxyXG4gICAgICAgICAgICAvLyBzaG93IGlmIG5vdCBhbHJlYWR5IHNob3duXHJcbiAgICAgICAgICAgIGlmICghdGhpcy5faXNTaG93bilcclxuICAgICAgICAgICAgICAgIHRoaXMuXyRjb21wLnNsaWRlRG93big0MDAsIGNvbXBsZXRlQ2FsbGJhY2spO1xyXG4gICAgICAgICAgICB0aGlzLl9pc1Nob3duID0gdHJ1ZTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbn0pOyIsInJlcXVpcmUoJ2pvb3NlJyk7XHJcbnJlcXVpcmUoJy4vUG9pbnQnKTtcclxuXHJcbnZhciBDT05GSUcgPSByZXF1aXJlKCcuL0NvbmZpZycpO1xyXG52YXIgVXRpbHMgPSByZXF1aXJlKCcuL1V0aWxzJyk7XHJcblxyXG5DbGFzcyhcIlBhcnRpY2lwYW50U3RhdGVcIixcclxue1xyXG5cdGhhcyA6IHtcdFx0XHJcblx0XHRzcGVlZCA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiAwXHJcblx0XHR9LFxyXG5cdFx0ZWxhcHNlZCA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiAwXHJcblx0XHR9LFxyXG5cdCAgICB0aW1lc3RhbXAgOiBcclxuXHRcdHtcclxuXHQgICAgICAgIGlzOiAgIFwicndcIixcclxuXHQgICAgICAgIGluaXQ6IFswLDBdXHQvL2xvbiBsYXQgd29ybGQgbWVyY2F0b3JcclxuXHQgICAgfSxcclxuXHQgICAgZ3BzIDoge1xyXG5cdCAgICBcdGlzOiAgIFwicndcIixcclxuXHQgICAgICAgIGluaXQ6IFswLDBdXHQvL2xvbiBsYXQgd29ybGQgbWVyY2F0b3JcclxuXHQgICAgfSxcclxuXHRcdGZyZXEgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogMFxyXG5cdFx0fSxcclxuXHRcdGlzU09TIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IGZhbHNlXHJcblx0XHR9LFxyXG5cdFx0YWNjZWxlcmF0aW9uIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IDBcclxuXHRcdH0sXHJcblx0XHRhbHQgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogMFxyXG5cdFx0fSxcclxuXHRcdG92ZXJhbGxSYW5rIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IDBcclxuXHRcdH0sXHJcblx0XHRnZW5kZXJSYW5rIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IDBcclxuXHRcdH0sXHJcblx0XHRncm91cFJhbmsgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogMFxyXG5cdFx0fVxyXG5cdH1cclxufSk7XHRcdFxyXG4vLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuQ2xhc3MoXCJNb3ZpbmdQb2ludFwiLCB7XHJcblx0aXNhIDogUG9pbnQsXHJcblxyXG5cdGhhcyA6IHtcclxuXHRcdGRldmljZUlkIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IFwiREVWSUNFX0lEX05PVF9TRVRcIlxyXG5cdFx0fVxyXG5cdH1cclxufSk7XHJcbi8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5DbGFzcyhcIlBhcnRpY2lwYW50XCIsXHJcbntcclxuXHRpc2EgOiBNb3ZpbmdQb2ludCxcclxuXHJcbiAgICBoYXM6IFxyXG5cdHtcclxuICAgIFx0bGFzdFBpbmdUaW1lc3RhbXAgOiB7XHJcbiAgICBcdFx0aXMgOiBcInJ3XCIsXHJcbiAgICBcdFx0aW5pdCA6IG51bGxcclxuICAgIFx0fSxcclxuICAgIFx0c2lnbmFsTG9zdERlbGF5IDoge1xyXG4gICAgXHRcdGlzIDogXCJyd1wiLFxyXG4gICAgXHRcdGluaXQgOiBudWxsXHJcbiAgICBcdH0sXHJcbiAgICBcdGxhc3RSZWFsRGVsYXkgOiB7XHJcbiAgICBcdFx0aXMgOiBcInJ3XCIsXHJcbiAgICBcdFx0aW5pdCA6IDBcclxuICAgIFx0fSxcclxuICAgIFx0dHJhY2sgOiB7XHJcbiAgICBcdFx0aXMgOiBcInJ3XCJcclxuICAgIFx0fSxcclxuICAgIFx0c3RhdGVzIDoge1xyXG4gICAgXHRcdGlzIDogXCJyd1wiLFxyXG4gICAgXHRcdGluaXQgOiBudWxsIC8vW11cclxuICAgIFx0XHRcclxuICAgIFx0fSxcclxuXHRcdGlzVGltZWRPdXQgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogZmFsc2VcclxuXHRcdH0sXHJcblx0XHRpc0Rpc2NhcmRlZCA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiBmYWxzZVxyXG5cdFx0fSxcclxuXHRcdGlzU09TIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IGZhbHNlXHJcblx0XHR9LFxyXG5cdFx0aWNvbjoge1xyXG5cdFx0XHRpczogXCJyd1wiLFxyXG5cdCAgICAgICAgaW5pdDogXCJpbWcvcGxheWVyMS5wbmdcIlxyXG5cdCAgICB9LFxyXG5cdCAgICBpbWFnZSA6XHR7XHJcblx0ICAgICAgICBpczogICBcInJ3XCIsXHJcblx0ICAgICAgICBpbml0OiBcImltZy9wcm9maWxlMS5wbmdcIiAgLy8xMDB4MTAwXHJcblx0ICAgIH0sXHJcblx0ICAgIGNvbG9yIDoge1xyXG5cdCAgICAgICAgaXM6ICAgXCJyd1wiLFxyXG5cdCAgICAgICAgaW5pdDogXCIjZmZmXCJcclxuXHQgICAgfSxcclxuXHQgICAgbGFzdEludGVycG9sYXRlVGltZXN0YW1wIDoge1xyXG5cdCAgICBcdGlzIDogXCJyd1wiLFxyXG5cdCAgICBcdGluaXQgOiBudWxsXHJcblx0ICAgIH0sXHJcblx0ICAgIGFnZUdyb3VwIDoge1xyXG5cdCAgICBcdGlzIDogXCJyd1wiLFxyXG5cdCAgICBcdGluaXQgOiBcIi1cIlxyXG5cdCAgICB9LFxyXG5cdCAgICBhZ2UgOiB7XHJcblx0ICAgIFx0aXMgOiBcInJ3XCIsXHJcblx0ICAgIFx0aW5pdCA6IFwiLVwiXHJcblx0ICAgIH0sXHJcblx0ICAgIHJvdGF0aW9uIDoge1xyXG5cdCAgICBcdGlzIDogXCJyd1wiLFxyXG5cdCAgICBcdGluaXQgOiBudWxsIFxyXG5cdCAgICB9LCBcclxuXHQgICAgZWxhcHNlZCA6IHtcclxuXHQgICAgXHRpcyA6IFwicndcIixcclxuXHQgICAgXHRpbml0IDogMFxyXG5cdCAgICB9LFxyXG5cdFx0c2VxSWQgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogMFxyXG5cdFx0fSxcclxuXHRcdGNvdW50cnkgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogXCJHZXJtYW55XCJcclxuXHRcdH0sXHJcblx0XHRzdGFydFBvcyA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiAwXHJcblx0XHR9LFxyXG5cdFx0c3RhcnRUaW1lIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IDBcclxuXHRcdH0sXHJcblx0XHRnZW5kZXIgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogXCJNXCJcclxuXHRcdH0sXHJcblx0XHRpc0Zhdm9yaXRlIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IHRydWUgLyogdG9kbyBzZXQgZmFsc2UgKi9cclxuXHRcdH1cclxuICAgIH0sXHJcblx0YWZ0ZXIgOiB7XHJcblx0XHRpbml0IDogZnVuY3Rpb24ocG9zLCB0cmFjaykge1xyXG5cdFx0XHR0aGlzLnNldFRyYWNrKHRyYWNrKTtcclxuXHRcdFx0dmFyIGN0aW1lID0gKG5ldyBEYXRlKCkpLmdldFRpbWUoKTtcclxuXHRcdFx0dmFyIHN0YXRlID0gbmV3IFBhcnRpY2lwYW50U3RhdGUoe3RpbWVzdGFtcDoxLyogcGxhY2Vob2xkZXIgY3RpbWUgbm90IDAgKi8sZ3BzOnBvcyxpc1NPUzpmYWxzZSxmcmVxOjAsc3BlZWQ6MCxlbGFwc2VkOnRyYWNrLmdldEVsYXBzZWRGcm9tUG9pbnQocG9zKX0pO1xyXG5cdFx0XHR0aGlzLnNldEVsYXBzZWQoc3RhdGUuZWxhcHNlZCk7XHJcblx0XHRcdHRoaXMuc2V0U3RhdGVzKFtzdGF0ZV0pO1xyXG5cdFx0XHR0aGlzLnNldElzU09TKGZhbHNlKTtcclxuXHRcdFx0dGhpcy5zZXRJc0Rpc2NhcmRlZChmYWxzZSk7XHJcblxyXG5cdFx0XHRpZiAodGhpcy5mZWF0dXJlKSB7XHJcblx0XHRcdFx0dGhpcy5pbml0RmVhdHVyZSgpO1xyXG5cdFx0XHR9XHJcblx0XHRcdHRoaXMucGluZyhwb3MsMCxmYWxzZSwxIC8qIHBsYWNlaG9sZGVyIGN0aW1lIG5vdCAwICovLDAsMCwwLDAsMCk7XHJcblx0XHR9XHJcblx0fSxcclxuICAgIC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRtZXRob2RzOiBcclxuXHR7XHJcblx0XHRpbml0RmVhdHVyZSA6IGZ1bmN0aW9uKCkge1xyXG5cdFx0XHR0aGlzLmZlYXR1cmUucGFydGljaXBhbnQ9dGhpcztcclxuXHRcdFx0R1VJLnBhcnRpY2lwYW50c0xheWVyLmdldFNvdXJjZSgpLmFkZEZlYXR1cmUodGhpcy5mZWF0dXJlKTtcclxuXHRcdH0sXHJcblxyXG5cdFx0Z2V0SW5pdGlhbHMgOiBmdW5jdGlvbigpIHtcclxuXHRcdFx0dmFyIHR0ID0gdGhpcy5nZXRDb2RlKCkuc3BsaXQoXCIgXCIpO1xyXG5cdFx0XHRpZiAodHQubGVuZ3RoID49IDIpIHtcclxuXHRcdFx0XHRyZXR1cm4gdHRbMF1bMF0rdHRbMV1bMF07XHJcblx0XHRcdH1cclxuXHRcdFx0aWYgKHR0Lmxlbmd0aCA9PSAxKVxyXG5cdFx0XHRcdHJldHVybiB0dFswXVswXTtcclxuXHRcdFx0cmV0dXJuIFwiP1wiO1xyXG5cdFx0fSxcclxuXHRcdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdFx0Ly8gbWFpbiBmdW5jdGlvbiBjYWxsID4gXHJcblx0XHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRcdHVwZGF0ZUZlYXR1cmUgOiBmdW5jdGlvbigpIHtcclxuXHRcdFx0dmFyIG1wb3MgPSBvbC5wcm9qLnRyYW5zZm9ybSh0aGlzLmdldFBvc2l0aW9uKCksICdFUFNHOjQzMjYnLCAnRVBTRzozODU3Jyk7XHJcblx0XHRcdGlmICh0aGlzLmZlYXR1cmUpIFxyXG5cdFx0XHRcdHRoaXMuZmVhdHVyZS5zZXRHZW9tZXRyeShuZXcgb2wuZ2VvbS5Qb2ludChtcG9zKSk7XHJcblx0XHR9LFxyXG5cdFx0aW50ZXJwb2xhdGUgOiBmdW5jdGlvbigpIFxyXG5cdFx0e1xyXG5cdFx0XHRcclxuXHRcdFx0aWYgKCF0aGlzLnN0YXRlcy5sZW5ndGgpXHJcblx0XHRcdFx0cmV0dXJuO1xyXG5cdFx0XHR2YXIgY3RpbWU9KG5ldyBEYXRlKCkpLmdldFRpbWUoKTtcclxuXHRcdFx0dmFyIGlzVGltZSA9IChjdGltZSA+PSBDT05GSUcudGltZXMuYmVnaW4gJiYgY3RpbWUgPD0gQ09ORklHLnRpbWVzLmVuZCk7XHJcblx0XHRcdGlmICh0aGlzLmlzRGlzY2FyZGVkIHx8IHRoaXMuaXNTT1MvKiB8fCAhdGhpcy5pc09uUm9hZCovIHx8ICFpc1RpbWUgfHwgQ09ORklHLnNldHRpbmdzLm5vSW50ZXJwb2xhdGlvbikgXHJcblx0XHRcdHtcclxuXHRcdFx0XHR2YXIgbHN0YXRlPXRoaXMuc3RhdGVzW3RoaXMuc3RhdGVzLmxlbmd0aC0xXTtcclxuXHRcdFx0XHR2YXIgcG9zID0gbHN0YXRlLmdwcztcclxuXHRcdFx0XHRpZiAocG9zWzBdICE9IHRoaXMuZ2V0UG9zaXRpb24oKVswXSB8fCBwb3NbMV0gIT0gdGhpcy5nZXRQb3NpdGlvbigpWzFdKSBcclxuXHRcdFx0XHR7XHJcblx0XHRcdFx0ICAgIHRoaXMuc2V0UG9zaXRpb24ocG9zKTtcclxuXHRcdFx0XHQgICAgdGhpcy5zZXRSb3RhdGlvbihudWxsKTtcclxuXHRcdFx0XHRcdHRoaXMudXBkYXRlRmVhdHVyZSgpO1xyXG5cdFx0XHRcdH0gZWxzZSB7XHJcblx0XHRcdFx0XHRpZiAodGhpcy5pc0Rpc2NhcmRlZCkge1xyXG5cdFx0XHRcdFx0XHR0aGlzLnVwZGF0ZUZlYXR1cmUoKTtcclxuXHRcdFx0XHRcdH1cclxuXHRcdFx0XHR9XHJcblx0XHRcdFx0cmV0dXJuO1xyXG5cdFx0XHR9XHJcblx0XHRcdHRoaXMuc2V0TGFzdEludGVycG9sYXRlVGltZXN0YW1wKGN0aW1lKTtcclxuXHRcdFx0Ly8gTm8gZW5vdWdoIGRhdGE/XHJcblx0XHRcdGlmICh0aGlzLnN0YXRlcy5sZW5ndGggPCAyKVxyXG5cdFx0XHRcdHJldHVybjtcclxuXHRcdFx0dmFyIHJlcyA9IHRoaXMuY2FsY3VsYXRlRWxhcHNlZEF2ZXJhZ2UoY3RpbWUpO1xyXG5cdFx0XHRpZiAocmVzKSBcclxuXHRcdFx0e1xyXG5cdFx0XHRcdHZhciB0cmVzPXJlcztcclxuXHRcdFx0XHRpZiAodHJlcyA9PSB0aGlzLnRyYWNrLmxhcHMpXHJcblx0XHRcdFx0XHR0cmVzPTEuMDtcclxuXHRcdFx0XHRlbHNlXHJcblx0XHRcdFx0XHR0cmVzPXRyZXMlMTtcclxuXHRcdFx0XHR2YXIgdGthID0gdGhpcy50cmFjay5nZXRQb3NpdGlvbkFuZFJvdGF0aW9uRnJvbUVsYXBzZWQodHJlcyk7XHJcblx0XHRcdFx0dGhpcy5zZXRQb3NpdGlvbihbdGthWzBdLHRrYVsxXV0pO1xyXG5cdFx0XHRcdHRoaXMuc2V0Um90YXRpb24odGthWzJdKTtcclxuXHRcdFx0XHR0aGlzLnVwZGF0ZUZlYXR1cmUoKTtcclxuXHRcdFx0XHR0aGlzLnNldEVsYXBzZWQocmVzKTtcclxuXHRcdFx0fSBcclxuXHRcdH0sXHJcblxyXG5cdFx0bWF4IDogZnVuY3Rpb24oY3RpbWUscHJvTmFtZSkgXHJcblx0XHR7XHJcblx0XHRcdHZhciByZXM9MDtcclxuXHRcdFx0Zm9yICh2YXIgaT10aGlzLnN0YXRlcy5sZW5ndGgtMjtpPj0wO2ktLSkgXHJcblx0XHRcdHtcclxuXHRcdFx0XHR2YXIgaiA9IGkrMTtcclxuXHRcdFx0XHR2YXIgc2EgPSB0aGlzLnN0YXRlc1tpXTtcclxuXHRcdFx0XHR2YXIgc2IgPSB0aGlzLnN0YXRlc1tqXTtcclxuXHRcdFx0XHRpZiAoY3RpbWUgPj0gc2EudGltZXN0YW1wICYmIGN0aW1lIDw9IHNiLnRpbWVzdGFtcCkgXHJcblx0XHRcdFx0eyBcclxuXHRcdFx0XHRcdHJlcyA9IHNhW3Byb05hbWVdO1xyXG5cdFx0XHRcdFx0YnJlYWs7XHJcblx0XHRcdFx0fVxyXG5cdFx0XHRcdGlmIChzYi50aW1lc3RhbXAgPCBjdGltZSlcclxuXHRcdFx0XHRcdGJyZWFrO1xyXG5cdFx0XHR9XHJcblx0XHRcdHJldHVybiByZXM7XHJcblx0XHR9LFxyXG5cclxuXHRcdGF2ZzIgOiBmdW5jdGlvbihjdGltZSxwcm9OYW1lKSBcclxuXHRcdHtcclxuXHRcdFx0dmFyIHJlcz1udWxsO1xyXG5cdFx0XHRmb3IgKHZhciBpPXRoaXMuc3RhdGVzLmxlbmd0aC0yO2k+PTA7aS0tKSBcclxuXHRcdFx0e1xyXG5cdFx0XHRcdHZhciBqID0gaSsxO1xyXG5cdFx0XHRcdHZhciBzYSA9IHRoaXMuc3RhdGVzW2ldO1xyXG5cdFx0XHRcdHZhciBzYiA9IHRoaXMuc3RhdGVzW2pdO1xyXG5cdFx0XHRcdGlmIChjdGltZSA+PSBzYS50aW1lc3RhbXAgJiYgY3RpbWUgPD0gc2IudGltZXN0YW1wKSBcclxuXHRcdFx0XHR7IFxyXG5cdFx0XHRcdFx0cmVzID0gW1xyXG5cdFx0XHRcdFx0ICAgICAgIFx0c2FbcHJvTmFtZV1bMF0rKGN0aW1lLXNhLnRpbWVzdGFtcCkgKiAoc2JbcHJvTmFtZV1bMF0tc2FbcHJvTmFtZV1bMF0pIC8gKHNiLnRpbWVzdGFtcC1zYS50aW1lc3RhbXApLFxyXG5cdFx0XHRcdFx0ICAgICAgIFx0c2FbcHJvTmFtZV1bMV0rKGN0aW1lLXNhLnRpbWVzdGFtcCkgKiAoc2JbcHJvTmFtZV1bMV0tc2FbcHJvTmFtZV1bMV0pIC8gKHNiLnRpbWVzdGFtcC1zYS50aW1lc3RhbXApXHJcblx0XHRcdFx0ICAgICAgICAgIF07IFxyXG5cdFx0XHRcdFx0YnJlYWs7XHJcblx0XHRcdFx0fVxyXG5cdFx0XHRcdGlmIChzYi50aW1lc3RhbXAgPCBjdGltZSlcclxuXHRcdFx0XHRcdGJyZWFrO1xyXG5cdFx0XHR9XHJcblx0XHRcdHJldHVybiByZXM7XHJcblx0XHR9LFxyXG5cclxuXHRcdGF2ZyA6IGZ1bmN0aW9uKGN0aW1lLHByb05hbWUpIFxyXG5cdFx0e1xyXG5cdFx0XHR2YXIgcmVzPW51bGw7XHJcblx0XHRcdC8vY29uc29sZS5sb2codGhpcy5zdGF0ZXMpO1xyXG5cdFx0XHRmb3IgKHZhciBpPXRoaXMuc3RhdGVzLmxlbmd0aC0yO2k+PTA7aS0tKSBcclxuXHRcdFx0e1xyXG5cdFx0XHRcdHZhciBqID0gaSsxO1xyXG5cdFx0XHRcdHZhciBzYSA9IHRoaXMuc3RhdGVzW2ldO1xyXG5cdFx0XHRcdHZhciBzYiA9IHRoaXMuc3RhdGVzW2pdO1xyXG5cdFx0XHRcdGlmIChjdGltZSA+PSBzYS50aW1lc3RhbXAgJiYgY3RpbWUgPD0gc2IudGltZXN0YW1wKSBcclxuXHRcdFx0XHR7IFxyXG5cdFx0XHRcdFx0cmVzID0gc2FbcHJvTmFtZV0rKGN0aW1lLXNhLnRpbWVzdGFtcCkgKiAoc2JbcHJvTmFtZV0tc2FbcHJvTmFtZV0pIC8gKHNiLnRpbWVzdGFtcC1zYS50aW1lc3RhbXApO1xyXG5cdFx0XHRcdFx0YnJlYWs7XHJcblx0XHRcdFx0fVxyXG5cdFx0XHRcdGlmIChzYi50aW1lc3RhbXAgPCBjdGltZSlcclxuXHRcdFx0XHRcdGJyZWFrO1xyXG5cdFx0XHR9XHJcblx0XHRcdHJldHVybiByZXM7XHJcblx0XHR9LFxyXG5cclxuXHRcdGNhbGN1bGF0ZUVsYXBzZWRBdmVyYWdlIDogZnVuY3Rpb24oY3RpbWUpIFxyXG5cdFx0e1xyXG5cdFx0XHR2YXIgcmVzPW51bGw7XHJcblx0XHRcdGN0aW1lLT1DT05GSUcubWF0aC5kaXNwbGF5RGVsYXkqMTAwMDtcclxuXHRcdFx0Ly9jb25zb2xlLmxvZyhcIlNFQVJDSElORyBGT1IgVElNRSBcIitVdGlscy5mb3JtYXREYXRlVGltZVNlYyhuZXcgRGF0ZShjdGltZSkpKTtcclxuXHRcdFx0dmFyIG9rID0gZmFsc2U7XHJcblx0XHRcdGZvciAodmFyIGk9dGhpcy5zdGF0ZXMubGVuZ3RoLTI7aT49MDtpLS0pIFxyXG5cdFx0XHR7XHJcblx0XHRcdFx0dmFyIGogPSBpKzE7XHJcblx0XHRcdFx0dmFyIHNhID0gdGhpcy5jYWxjQVZHU3RhdGUoaSk7XHJcblx0XHRcdFx0dmFyIHNiID0gdGhpcy5jYWxjQVZHU3RhdGUoaik7XHJcblx0XHRcdFx0aWYgKGN0aW1lID49IHNhLnRpbWVzdGFtcCAmJiBjdGltZSA8PSBzYi50aW1lc3RhbXApIFxyXG5cdFx0XHRcdHsgXHJcblx0XHRcdFx0XHRyZXMgPSBzYS5lbGFwc2VkKyhjdGltZS1zYS50aW1lc3RhbXApICogKHNiLmVsYXBzZWQtc2EuZWxhcHNlZCkgLyAoc2IudGltZXN0YW1wLXNhLnRpbWVzdGFtcCk7XHJcblx0XHRcdFx0XHQvL2NvbnNvbGUubG9nKFwiRk9VTkQgVElNRSBJTlQgW1wiK1V0aWxzLmZvcm1hdERhdGVUaW1lU2VjKG5ldyBEYXRlKHNhLnRpbWVzdGFtcCkpK1wiID4gXCIrVXRpbHMuZm9ybWF0RGF0ZVRpbWVTZWMobmV3IERhdGUoc2IudGltZXN0YW1wKSkrXCJdXCIpO1xyXG5cdFx0XHRcdFx0b2s9dHJ1ZTtcclxuXHRcdFx0XHRcdGJyZWFrO1xyXG5cdFx0XHRcdH1cclxuXHRcdFx0XHRpZiAoc2IudGltZXN0YW1wIDwgY3RpbWUpIHtcclxuXHRcdFx0XHRcdHRoaXMuc2V0U2lnbmFsTG9zdERlbGF5KGN0aW1lLXNiLnRpbWVzdGFtcCk7XHJcblx0XHRcdFx0XHQvL2NvbnNvbGUubG9nKFwiQlJFQUsgT04gXCIrZm9ybWF0VGltZVNlYyhuZXcgRGF0ZShjdGltZSkpK1wiIHwgXCIrKGN0aW1lLXNiLnRpbWVzdGFtcCkvMTAwMC4wKTtcclxuXHRcdFx0XHRcdHJldHVybiBudWxsO1xyXG5cdFx0XHRcdH1cclxuXHRcdFx0fVxyXG5cdFx0XHRpZiAoIW9rKSB7XHJcblx0XHRcdFx0aWYgKHRoaXMuc3RhdGVzLmxlbmd0aCA+PSAyKVxyXG5cdFx0XHRcdFx0Y29uc29sZS5sb2codGhpcy5jb2RlK1wiIHwgTk9UIEZPVU5EIFRJTUUgXCIrVXRpbHMuZm9ybWF0RGF0ZVRpbWVTZWMobmV3IERhdGUoY3RpbWUpKStcIiB8IHQtbGFzdD1cIisoY3RpbWUtdGhpcy5zdGF0ZXNbdGhpcy5zdGF0ZXMubGVuZ3RoLTFdLnRpbWVzdGFtcCkvMTAwMC4wK1wiIHwgdC1maXJzdD1cIisoY3RpbWUtdGhpcy5zdGF0ZXNbMF0udGltZXN0YW1wKS8xMDAwLjApO1xyXG5cdFx0XHR9IGVsc2VcclxuXHRcdFx0XHR0aGlzLnNldFNpZ25hbExvc3REZWxheShudWxsKTtcclxuXHRcdFx0cmV0dXJuIHJlcztcclxuXHRcdH0sXHJcblx0XHRcclxuXHRcdGNhbGNBVkdTdGF0ZSA6IGZ1bmN0aW9uKHBvcykge1xyXG5cdFx0XHRpZiAoIUNPTkZJRy5tYXRoLmludGVycG9sYXRlR1BTQXZlcmFnZSlcclxuXHRcdFx0XHRyZXR1cm4gdGhpcy5zdGF0ZXNbcG9zXTtcclxuXHRcdFx0dmFyIHNzdW1lPTA7XHJcblx0XHRcdHZhciBzc3VtdD0wO1xyXG5cdFx0XHR2YXIgY2M9MDtcclxuXHRcdFx0Zm9yICh2YXIgaT1wb3M7aT49MCAmJiAocG9zLWkpPENPTkZJRy5tYXRoLmludGVycG9sYXRlR1BTQXZlcmFnZTtpLS0pIHtcclxuXHRcdFx0XHRzc3VtZSs9dGhpcy5zdGF0ZXNbaV0uZWxhcHNlZDtcclxuXHRcdFx0XHRzc3VtdCs9dGhpcy5zdGF0ZXNbaV0udGltZXN0YW1wO1xyXG5cdFx0XHRcdGNjKys7XHJcblx0XHRcdH1cclxuXHRcdFx0c3N1bWUvPWNjO1xyXG5cdFx0XHRzc3VtdC89Y2M7XHJcblx0XHRcdHJldHVybiB7ZWxhcHNlZCA6IHNzdW1lLHRpbWVzdGFtcCA6IHNzdW10fTtcclxuXHRcdH0sXHJcblxyXG5cdFx0cGluZ0NhbGN1bGF0ZWQgOiBmdW5jdGlvbihvYmopIHtcclxuXHRcdFx0dmFyIHN0YXRlID0gbmV3IFBhcnRpY2lwYW50U3RhdGUob2JqKTtcclxuXHRcdFx0Ly9jb25zb2xlLndhcm4oc3RhdGUpO1xyXG5cdFx0XHR0aGlzLmFkZFN0YXRlKHN0YXRlKTtcclxuXHRcdH0sXHJcblxyXG5cdFx0Z2V0T3ZlcmFsbFJhbmsgOiBmdW5jdGlvbigpIHtcclxuXHRcdFx0aWYgKHRoaXMuc3RhdGVzLmxlbmd0aCkge1xyXG5cdFx0XHRcdHJldHVybiB0aGlzLnN0YXRlc1t0aGlzLnN0YXRlcy5sZW5ndGgtMV0ub3ZlcmFsbFJhbms7XHJcblx0XHRcdH1cclxuXHRcdFx0cmV0dXJuIFwiLVwiO1xyXG5cdFx0fSxcclxuXHRcdGdldEdyb3VwUmFuayA6IGZ1bmN0aW9uKCkge1xyXG5cdFx0XHRpZiAodGhpcy5zdGF0ZXMubGVuZ3RoKSB7XHJcblx0XHRcdFx0cmV0dXJuIHRoaXMuc3RhdGVzW3RoaXMuc3RhdGVzLmxlbmd0aC0xXS5ncm91cFJhbms7XHJcblx0XHRcdH1cclxuXHRcdFx0cmV0dXJuIFwiLVwiO1xyXG5cdFx0fSxcclxuXHRcdGdldEdlbmRlclJhbmsgOiBmdW5jdGlvbigpIHtcclxuXHRcdFx0aWYgKHRoaXMuc3RhdGVzLmxlbmd0aCkge1xyXG5cdFx0XHRcdHJldHVybiB0aGlzLnN0YXRlc1t0aGlzLnN0YXRlcy5sZW5ndGgtMV0uZ2VuZGVyUmFuaztcclxuXHRcdFx0fVxyXG5cdFx0XHRyZXR1cm4gXCItXCI7XHJcblx0XHR9LFxyXG5cdFx0XHJcblx0XHRwaW5nIDogZnVuY3Rpb24ocG9zLGZyZXEsaXNTT1MsY3RpbWUsYWx0LG92ZXJhbGxSYW5rLGdyb3VwUmFuayxnZW5kZXJSYW5rLF9FTEFQU0VEKVxyXG5cdFx0e1xyXG5cdFx0XHR2YXIgbGx0ID0gKG5ldyBEYXRlKCkpLmdldFRpbWUoKTsgXHJcblx0XHRcdGlmICghY3RpbWUpXHJcblx0XHRcdFx0Y3RpbWU9bGx0O1xyXG5cdFx0XHR0aGlzLnNldExhc3RSZWFsRGVsYXkobGx0LWN0aW1lKTtcclxuXHRcdFx0dGhpcy5zZXRMYXN0UGluZ1RpbWVzdGFtcChsbHQpO1x0XHRcdFxyXG5cdFx0XHR2YXIgc3RhdGUgPSBuZXcgUGFydGljaXBhbnRTdGF0ZSh7dGltZXN0YW1wOmN0aW1lLGdwczpwb3MsaXNTT1M6aXNTT1MsZnJlcTpmcmVxLGFsdDphbHQsb3ZlcmFsbFJhbms6b3ZlcmFsbFJhbmssZ3JvdXBSYW5rOmdyb3VwUmFuayxnZW5kZXJSYW5rOmdlbmRlclJhbmt9KTtcclxuXHRcdFx0Ly9pc1NPUz10cnVlO1xyXG5cdFx0XHRpZiAoaXNTT1MgfHwgQ09ORklHLnNldHRpbmdzLm5vSW50ZXJwb2xhdGlvbilcclxuXHRcdFx0e1xyXG5cdFx0XHRcdGlmIChpc1NPUylcclxuXHRcdFx0XHRcdHRoaXMuc2V0SXNTT1ModHJ1ZSk7XHRcdFx0XHRcclxuXHRcdFx0XHR0aGlzLmFkZFN0YXRlKHN0YXRlKTtcclxuXHRcdFx0XHRyZXR1cm47XHJcblx0XHRcdH1cclxuXHRcdFx0Ly8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0XHRcdHZhciB0cmFja2xlbiA9IHRoaXMudHJhY2suZ2V0VHJhY2tMZW5ndGgoKTtcclxuXHRcdFx0dmFyIHRyYWNrbGVuMSA9IHRoaXMudHJhY2suZ2V0VHJhY2tMZW5ndGhJbldHUzg0KCk7XHJcblx0XHRcdHZhciBsbHN0YXRlID0gdGhpcy5zdGF0ZXMubGVuZ3RoID49IDIgPyB0aGlzLnN0YXRlc1t0aGlzLnN0YXRlcy5sZW5ndGgtMl0gOiBudWxsO1xyXG5cdFx0XHR2YXIgbHN0YXRlID0gdGhpcy5zdGF0ZXMubGVuZ3RoID8gdGhpcy5zdGF0ZXNbdGhpcy5zdGF0ZXMubGVuZ3RoLTFdIDogbnVsbDtcclxuXHRcdFx0aWYgKHBvc1swXSA9PSAwICYmIHBvc1sxXSA9PSAwKSB7XHJcblx0XHRcdFx0aWYgKCFsc3RhdGUpIHJldHVybjtcclxuXHRcdFx0XHRwb3M9bHN0YXRlLmdwcztcclxuXHRcdFx0fVxyXG5cdFx0XHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRcdFx0dmFyIGJlc3Q7XHJcblx0XHRcdHZhciBiZXN0bT1udWxsO1xyXG5cdFx0XHR2YXIgbGVscCA9IGxzdGF0ZSA/IGxzdGF0ZS5nZXRFbGFwc2VkKCkgOiAwO1x0Ly8gbGFzdCBlbGFwc2VkXHJcblx0XHRcdHZhciB0ZyA9IHRoaXMudHJhY2sucm91dGU7XHJcblx0XHRcdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdFx0XHQvLyBORVcgQUxHXHJcblx0XHRcdHZhciBjb2VmID0gdGhpcy50cmFjay5nZXRUcmFja0xlbmd0aEluV0dTODQoKS90aGlzLnRyYWNrLmdldFRyYWNrTGVuZ3RoKCk7XHJcblx0XHRcdHZhciBtaW5mID0gbnVsbDtcclxuXHRcdFx0dmFyIHJyID0gQ09ORklHLm1hdGguZ3BzSW5hY2N1cmFjeSpjb2VmO1xyXG5cdFx0XHR2YXIgcmVzdWx0ID0gdGhpcy50cmFjay5yVHJlZS5zZWFyY2goW3Bvc1swXS1yciwgcG9zWzFdLXJyLCBwb3NbMF0rcnIsIHBvc1sxXStycl0pO1xyXG5cdFx0XHRpZiAoIXJlc3VsdClcclxuXHRcdFx0XHRyZXN1bHQ9W107XHJcblx0XHRcdC8vY29uc29sZS5sb2coXCJGT1VORCBcIityZXN1bHQubGVuZ3RoK1wiIHwgXCIrdGhpcy50cmFjay5yb3V0ZS5sZW5ndGgrXCIgfCBcIitycik7XHJcblx0XHRcdC8vZm9yICh2YXIgaT0wO2k8dGhpcy50cmFjay5yb3V0ZS5sZW5ndGgtMTtpKyspIHtcclxuXHJcblx0XHRcdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdFx0XHR2YXIgZGJnTGluZSA9IFtdO1xyXG5cdFx0XHRmb3IgKHZhciBfaT0wO19pPHJlc3VsdC5sZW5ndGg7X2krKylcclxuXHRcdFx0e1xyXG5cdFx0XHRcdHZhciBpID0gcmVzdWx0W19pXVs0XS5pbmRleDtcclxuXHRcdFx0XHRcclxuXHRcdFx0XHRpZiAodHlwZW9mIEdVSSAhPSBcInVuZGVmaW5lZFwiICYmIEdVSS5pc0RlYnVnKSBcclxuXHRcdFx0XHRcdGRiZ0xpbmUucHVzaChbW3RnW2ldWzBdLCB0Z1tpXVsxXV0sIFt0Z1tpKzFdWzBdLCB0Z1tpKzFdWzFdXV0pO1xyXG5cdFx0XHRcdFxyXG5cdFx0XHRcdHZhciByZXMgPSBVdGlscy5pbnRlcmNlcHRPbkNpcmNsZSh0Z1tpXSx0Z1tpKzFdLHBvcyxycik7XHJcblx0XHRcdFx0aWYgKHJlcykgXHJcblx0XHRcdFx0e1xyXG5cdFx0XHRcdFx0Ly8gaGFzIGludGVyc2VjdGlvbiAoMiBwb2ludHMpXHJcblx0XHRcdFx0XHR2YXIgZDEgPSBVdGlscy5kaXN0cChyZXNbMF0sdGdbaV0pO1xyXG5cdFx0XHRcdFx0dmFyIGQyID0gVXRpbHMuZGlzdHAocmVzWzFdLHRnW2ldKTtcclxuXHRcdFx0XHRcdHZhciBkMyA9IFV0aWxzLmRpc3RwKHRnW2ldLHRnW2krMV0pO1xyXG5cdFx0XHRcdFx0dmFyIGVsMSA9IHRoaXMudHJhY2suZGlzdGFuY2VzRWxhcHNlZFtpXSsodGhpcy50cmFjay5kaXN0YW5jZXNFbGFwc2VkW2krMV0tdGhpcy50cmFjay5kaXN0YW5jZXNFbGFwc2VkW2ldKSpkMS9kMztcclxuXHRcdFx0XHRcdHZhciBlbDIgPSB0aGlzLnRyYWNrLmRpc3RhbmNlc0VsYXBzZWRbaV0rKHRoaXMudHJhY2suZGlzdGFuY2VzRWxhcHNlZFtpKzFdLXRoaXMudHJhY2suZGlzdGFuY2VzRWxhcHNlZFtpXSkqZDIvZDM7XHJcblx0XHRcdFx0XHQvL2NvbnNvbGUubG9nKFwiSW50ZXJzZWN0aW9uIGNhbmRpZGF0ZSBhdCBcIitpK1wiIHwgXCIrZWwxK1wiIHwgXCIrZWwyKTtcclxuXHRcdFx0XHRcdGlmIChlbDEgPCBsZWxwKVxyXG5cdFx0XHRcdFx0XHRlbDE9bGVscDtcclxuXHRcdFx0XHRcdGlmIChlbDIgPCBsZWxwKVxyXG5cdFx0XHRcdFx0XHRlbDI9bGVscDtcclxuXHRcdFx0XHRcdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdFx0XHRcdFx0aWYgKG1pbmYgPT0gbnVsbCB8fCBlbDEgPCBtaW5mKVxyXG5cdFx0XHRcdFx0XHRtaW5mPWVsMTtcclxuXHRcdFx0XHRcdGlmIChlbDIgPCBtaW5mKVxyXG5cdFx0XHRcdFx0XHRtaW5mPWVsMjtcclxuXHRcdFx0XHR9XHJcblx0XHRcdH1cclxuXHRcdFx0Ly8tLS0tLS0vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0XHRcdC8vY29uc29sZS5sb2coXCJPT09PT09QISBcIitkYmdMaW5lLmxlbmd0aCk7XHJcblx0XHRcdC8vY29uc29sZS5sb2coZGJnTGluZSk7XHJcblx0XHRcdGlmICh0eXBlb2YgR1VJICE9IFwidW5kZWZpbmVkXCIgJiYgR1VJLmlzRGVidWcpIFxyXG5cdFx0XHR7XHJcblx0XHRcdFx0aWYgKHRoaXMuX19kYmdCb3gpIHtcclxuXHRcdFx0XHRcdEdVSS50ZXN0TGF5ZXIuZ2V0U291cmNlKCkucmVtb3ZlRmVhdHVyZSh0aGlzLl9fZGJnQm94KTtcclxuXHRcdFx0XHRcdGRlbGV0ZSB0aGlzLl9fZGJnQm94O1xyXG5cdFx0XHRcdH1cclxuXHRcdFx0XHRpZiAoZGJnTGluZS5sZW5ndGgpIHtcclxuXHRcdFx0XHRcdHZhciBmZWF0dXJlID0gbmV3IG9sLkZlYXR1cmUoKTtcclxuXHRcdFx0XHRcdHZhciBnZW9tID0gbmV3IG9sLmdlb20uTXVsdGlMaW5lU3RyaW5nKGRiZ0xpbmUpO1xyXG5cdFx0XHRcdFx0Z2VvbS50cmFuc2Zvcm0oJ0VQU0c6NDMyNicsICdFUFNHOjM4NTcnKTtcclxuXHRcdFx0XHRcdGZlYXR1cmUuc2V0R2VvbWV0cnkoZ2VvbSk7XHJcblx0XHRcdFx0XHRHVUkudGVzdExheWVyLmdldFNvdXJjZSgpLmFkZEZlYXR1cmUoZmVhdHVyZSk7XHJcblx0XHRcdFx0fVxyXG5cdFx0XHR9IFxyXG5cdFx0XHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdFx0XHRcclxuXHRcdFx0LyppZiAobWluZiA9PSBudWxsKVxyXG5cdFx0XHRcdGNvbnNvbGUuZXJyb3IoXCJNSU5GIE5VTEwgKFwiK3Jlc3VsdC5sZW5ndGgrXCIpIENPRUY9XCIrY29lZik7XHJcblx0XHRcdGVsc2VcclxuXHRcdFx0XHRjb25zb2xlLmxvZyhcIj4+IE1JTkYgXCIrbWluZitcIiAoXCIrbWluZip0aGlzLnRyYWNrLmdldFRyYWNrTGVuZ3RoKCkrXCIgbSkgQ09FRj1cIitjb2VmKTsqL1xyXG5cdFx0XHRcclxuXHRcdFx0Ly8gPz8gT0sgU0tJUCBESVNDQVJEISEhXHJcblx0XHRcdGlmIChtaW5mID09IG51bGwpIFxyXG5cdFx0XHRcdHJldHVybjtcclxuXHRcdFx0XHJcblx0XHRcdC8vIG1pbmYgPSBvdmVyYWxsIG1pbmltdW0gb2YgZWxhcHNlZCBpbnRlcnNlY3Rpb25zXHJcblx0XHRcdGlmIChtaW5mICE9IG51bGwpIFxyXG5cdFx0XHRcdGJlc3RtPW1pbmY7XHJcblx0XHRcdFxyXG5cdFx0XHQvL2NvbnNvbGUubG9nKFwiQkVTVE0gRk9SIFBJTkcgOiBcIitiZXN0bSk7XHJcblx0XHRcdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRcdFx0Ly9iZXN0bSA9IF9FTEFQU0VEOyAvLyhURVNUIEhBQ0sgT05MWSlcclxuXHRcdFx0aWYgKGJlc3RtICE9IG51bGwpIFxyXG5cdFx0XHR7XHJcblx0XHRcdFx0dmFyIG5lbCA9IGJlc3RtOyAvL3RoaXMudHJhY2suZ2V0RWxhcHNlZEZyb21Qb2ludChiZXN0KTtcclxuXHRcdFx0XHRpZiAobHN0YXRlKSBcclxuXHRcdFx0XHR7XHJcblx0XHRcdFx0XHQvKmlmIChuZWwgPCBsc3RhdGUuZ2V0RWxhcHNlZCgpKSBcclxuXHRcdFx0XHRcdHtcclxuXHRcdFx0XHRcdFx0Ly8gV1JPTkcgRElSRUNUSU9OIE9SIEdQUyBEQVRBIFdST05HPyBTS0lQLi5cclxuXHRcdFx0XHRcdFx0aWYgKChsc3RhdGUuZ2V0RWxhcHNlZCgpLW5lbCkqdHJhY2tsZW4gPCBDT05GSUcuY29uc3RyYWludHMuYmFja3dhcmRzRXBzaWxvbkluTWV0ZXIpIFxyXG5cdFx0XHRcdFx0XHRcdHJldHVybjtcclxuXHRcdFx0XHRcdFx0ZG8gIFxyXG5cdFx0XHRcdFx0XHR7XHJcblx0XHRcdFx0XHRcdFx0bmVsKz0xLjA7XHJcblx0XHRcdFx0XHRcdH0gd2hpbGUgKG5lbCA8IGxzdGF0ZS5nZXRFbGFwc2VkKCkpO1xyXG5cdFx0XHRcdFx0fSovXHJcblx0XHRcdFx0XHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0XHRcdFx0XHRpZiAobmVsID4gdGhpcy50cmFjay5sYXBzKSB7XHJcblx0XHRcdFx0XHRcdG5lbD10aGlzLnRyYWNrLmxhcHM7XHJcblx0XHRcdFx0XHR9XHJcblx0XHRcdFx0XHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0XHRcdFx0XHRsbHN0YXRlID0gdGhpcy5zdGF0ZXMubGVuZ3RoID49IENPTkZJRy5tYXRoLnNwZWVkQW5kQWNjZWxlcmF0aW9uQXZlcmFnZURlZ3JlZSoyID8gdGhpcy5zdGF0ZXNbdGhpcy5zdGF0ZXMubGVuZ3RoLUNPTkZJRy5tYXRoLnNwZWVkQW5kQWNjZWxlcmF0aW9uQXZlcmFnZURlZ3JlZSoyXSA6IG51bGw7XHJcblx0XHRcdFx0XHRsc3RhdGUgPSB0aGlzLnN0YXRlcy5sZW5ndGggPj0gQ09ORklHLm1hdGguc3BlZWRBbmRBY2NlbGVyYXRpb25BdmVyYWdlRGVncmVlID8gdGhpcy5zdGF0ZXNbdGhpcy5zdGF0ZXMubGVuZ3RoLUNPTkZJRy5tYXRoLnNwZWVkQW5kQWNjZWxlcmF0aW9uQXZlcmFnZURlZ3JlZV0gOiBudWxsO1xyXG5cdFx0XHRcdFx0aWYgKGxzdGF0ZSkgIHtcclxuXHRcdFx0XHRcdFx0c3RhdGUuc2V0U3BlZWQoIHRyYWNrbGVuICogKG5lbC1sc3RhdGUuZ2V0RWxhcHNlZCgpKSAqIDEwMDAgLyAoY3RpbWUtbHN0YXRlLnRpbWVzdGFtcCkpO1xyXG5cdFx0XHRcdFx0XHRpZiAobGxzdGF0ZSkgXHJcblx0XHRcdFx0XHRcdFx0c3RhdGUuc2V0QWNjZWxlcmF0aW9uKCAoc3RhdGUuZ2V0U3BlZWQoKS1sc3RhdGUuZ2V0U3BlZWQoKSkgKiAxMDAwIC8gKGN0aW1lLWxzdGF0ZS50aW1lc3RhbXApKTtcclxuXHRcdFx0XHRcdH1cclxuXHRcdFx0XHRcdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRcdFx0XHR9XHJcblx0XHRcdFx0c3RhdGUuc2V0RWxhcHNlZChuZWwpO1xyXG5cdFx0XHR9IGVsc2Uge1xyXG5cdFx0XHRcdGlmIChsc3RhdGUpXHJcblx0XHRcdFx0XHRzdGF0ZS5zZXRFbGFwc2VkKGxzdGF0ZS5nZXRFbGFwc2VkKCkpO1xyXG5cdFx0XHRcdGlmIChsc3RhdGUuZ2V0RWxhcHNlZCgpICE9IHRoaXMudHJhY2subGFwcykge1xyXG5cdFx0XHRcdFx0dGhpcy5zZXRJc0Rpc2NhcmRlZCh0cnVlKTtcclxuXHRcdFx0XHR9XHJcblx0XHRcdH1cclxuXHRcdFx0Ly8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdFx0XHR0aGlzLmFkZFN0YXRlKHN0YXRlKTtcclxuXHRcdFx0aWYgKHR5cGVvZiBHVUkgIT0gXCJ1bmRlZmluZWRcIiAmJiBHVUkuaXNEZWJ1ZyAmJiAhdGhpcy5nZXRJc0Rpc2NhcmRlZCgpKSBcclxuXHRcdFx0e1xyXG5cdFx0XHRcdHZhciBmZWF0dXJlID0gbmV3IG9sLkZlYXR1cmUoKTtcclxuXHRcdFx0XHR2YXIgZ2VvbSA9IG5ldyBvbC5nZW9tLlBvaW50KHN0YXRlLmdwcyk7XHJcblx0XHRcdFx0Z2VvbS50cmFuc2Zvcm0oJ0VQU0c6NDMyNicsICdFUFNHOjM4NTcnKTtcclxuXHRcdFx0XHRmZWF0dXJlLmNvbG9yPXRoaXMuY29sb3I7XHJcblx0XHRcdFx0ZmVhdHVyZS5zZXRHZW9tZXRyeShnZW9tKTtcclxuXHRcdFx0XHRmZWF0dXJlLnRpbWVDcmVhdGVkPWN0aW1lO1xyXG5cdFx0XHRcdEdVSS5kZWJ1Z0xheWVyR1BTLmdldFNvdXJjZSgpLmFkZEZlYXR1cmUoZmVhdHVyZSk7XHJcblx0XHRcdH1cclxuXHRcdH0sXHJcblx0XHRcclxuXHRcdGFkZFN0YXRlIDogZnVuY3Rpb24oc3RhdGUpIHtcclxuXHRcdFx0dGhpcy5zdGF0ZXMucHVzaChzdGF0ZSk7XHJcblx0XHRcdGlmICh0aGlzLnN0YXRlcy5sZW5ndGggPiBDT05GSUcuY29uc3RyYWludHMubWF4UGFydGljaXBhbnRTdGF0ZUhpc3RvcnkgJiYgIXRoaXMuaXNTT1MpXHJcblx0XHRcdFx0dGhpcy5zdGF0ZXMuc2hpZnQoKTtcclxuXHRcdH0sXHJcblxyXG5cdFx0Z2V0TGFzdFN0YXRlOiBmdW5jdGlvbigpIHtcclxuXHRcdFx0cmV0dXJuIHRoaXMuc3RhdGVzLmxlbmd0aCA/IHRoaXMuc3RhdGVzW3RoaXMuc3RhdGVzLmxlbmd0aC0xXSA6IG51bGw7XHJcblx0XHR9LFxyXG5cclxuXHRcdGdldEZyZXEgOiBmdW5jdGlvbigpIHtcclxuXHRcdFx0dmFyIGxzdGF0ZSA9IHRoaXMuZ2V0TGFzdFN0YXRlKCk7XHJcblx0XHRcdHJldHVybiBsc3RhdGUgPyBsc3RhdGUuZnJlcSA6IDA7XHJcblx0XHR9LFxyXG5cclxuXHRcdGdldFNwZWVkIDogZnVuY3Rpb24oKSB7XHJcblx0XHRcdHZhciBsc3RhdGUgPSB0aGlzLmdldExhc3RTdGF0ZSgpO1xyXG5cdFx0XHRyZXR1cm4gbHN0YXRlID8gbHN0YXRlLnNwZWVkIDogMDtcclxuXHRcdH0sXHJcblxyXG5cdFx0Z2V0R1BTIDogZnVuY3Rpb24oKSB7XHJcblx0XHRcdHZhciBsc3RhdGUgPSB0aGlzLmdldExhc3RTdGF0ZSgpO1xyXG5cdFx0XHRyZXR1cm4gbHN0YXRlID8gbHN0YXRlLmdwcyA6IHRoaXMuZ2V0UG9zaXRpb24oKTtcclxuXHRcdH0sXHJcblxyXG5cdFx0Z2V0RWxhcHNlZCA6IGZ1bmN0aW9uKCkge1xyXG5cdFx0XHR2YXIgbHN0YXRlID0gdGhpcy5nZXRMYXN0U3RhdGUoKTtcclxuXHRcdFx0cmV0dXJuIGxzdGF0ZSA/IGxzdGF0ZS5lbGFwc2VkIDogMDtcclxuXHRcdH0sXHJcblxyXG5cdFx0Z2V0UG9wdXBIVE1MIDogZnVuY3Rpb24oKSB7XHJcblx0XHRcdHZhciBwb3MgPSB0aGlzLmdldFBvc2l0aW9uKCk7XHJcblx0XHRcdGlmICh0aGlzLmlzU09TIHx8IHRoaXMuaXNEaXNjYXJkZWQpIHtcclxuXHRcdFx0XHRwb3MgPSB0aGlzLmdldEdQUygpO1xyXG5cdFx0XHR9XHJcblx0XHRcdHZhciB0bGVuID0gdGhpcy50cmFjay5nZXRUcmFja0xlbmd0aCgpO1xyXG5cdFx0XHR2YXIgY3RpbWUgPSAobmV3IERhdGUoKSkuZ2V0VGltZSgpO1xyXG5cdFx0XHR2YXIgZWxhcHNlZCA9IHRoaXMuY2FsY3VsYXRlRWxhcHNlZEF2ZXJhZ2UoY3RpbWUpO1xyXG5cdFx0XHR2YXIgdHBhcnQgPSB0aGlzLnRyYWNrLmdldFRyYWNrUGFydChlbGFwc2VkKTtcclxuXHRcdFx0dmFyIHRhcmdldEtNO1xyXG5cdFx0XHR2YXIgcGFydFN0YXJ0O1xyXG5cdFx0XHR2YXIgdHBhcnRNb3JlO1xyXG5cdFx0XHRpZiAodHBhcnQgPT0gMCkge1xyXG5cdFx0XHRcdHRwYXJ0cz1cIlNXSU1cIjtcclxuXHRcdFx0XHR0YXJnZXRLTT10aGlzLnRyYWNrLmJpa2VTdGFydEtNO1xyXG5cdFx0XHRcdHBhcnRTdGFydD0wO1xyXG5cdFx0XHRcdHRwYXJ0TW9yZT1cIlNXSU1cIjtcclxuXHRcdFx0fSBlbHNlIGlmICh0cGFydCA9PSAxKSB7XHJcblx0XHRcdFx0dHBhcnRzPVwiQklLRVwiO1xyXG5cdFx0XHRcdHRhcmdldEtNPXRoaXMudHJhY2sucnVuU3RhcnRLTTtcclxuXHRcdFx0XHRwYXJ0U3RhcnQ9dGhpcy50cmFjay5iaWtlU3RhcnRLTTtcclxuXHRcdFx0XHR0cGFydE1vcmU9XCJSSURFXCI7XHJcblx0XHRcdH0gZWxzZSBpZiAodHBhcnQgPT0gMikgeyBcclxuXHRcdFx0XHR0cGFydHM9XCJSVU5cIjtcclxuXHRcdFx0XHR0YXJnZXRLTT10bGVuLzEwMDAuMDtcclxuXHRcdFx0XHRwYXJ0U3RhcnQ9dGhpcy50cmFjay5ydW5TdGFydEtNO1xyXG5cdFx0XHRcdHRwYXJ0TW9yZT1cIlJVTlwiO1xyXG5cdFx0XHR9XHJcblx0XHRcdHZhciBodG1sPVwiPGRpdiBjbGFzcz0ncG9wdXBfY29kZScgc3R5bGU9J2NvbG9yOnJnYmEoXCIrY29sb3JBbHBoYUFycmF5KHRoaXMuZ2V0Q29sb3IoKSwwLjkpLmpvaW4oXCIsXCIpK1wiKSc+XCIrZXNjYXBlSFRNTCh0aGlzLmdldENvZGUoKSkrXCIgKDEpPC9kaXY+XCI7XHJcblx0XHRcdHZhciBmcmVxID0gTWF0aC5yb3VuZCh0aGlzLmdldEZyZXEoKSk7XHJcblx0XHRcdGlmIChmcmVxID4gMCkge1xyXG5cdFx0XHRcdGh0bWwrPVwiPGRpdiBjbGFzc1wiICtcclxuXHRcdFx0XHRcdFx0XCI9J3BvcHVwX2ZyZXEnPlwiK2ZyZXErXCI8L2Rpdj5cIjtcclxuXHRcdFx0fVxyXG5cdFx0XHR2YXIgZWxrbSA9IGVsYXBzZWQqdGxlbi8xMDAwLjA7XHJcblx0XHRcdHZhciBlbGttcyA9IHBhcnNlRmxvYXQoTWF0aC5yb3VuZChlbGttICogMTAwKSAvIDEwMCkudG9GaXhlZCgyKTtcdFx0XHRcclxuXHJcblx0XHRcdC8qdmFyIHJla20gPSBlbGFwc2VkJTEuMDtcclxuXHRcdFx0cmVrbT0oMS4wLXJla20pKnRsZW4vMTAwMC4wO1xyXG5cdFx0XHRyZWttID0gcGFyc2VGbG9hdChNYXRoLnJvdW5kKHJla20gKiAxMDApIC8gMTAwKS50b0ZpeGVkKDIpOyovXHRcdFx0XHJcblx0XHRcdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRcdFx0dmFyIGVzdGY9bnVsbDtcclxuXHRcdFx0dmFyIGV0eHQxPW51bGw7XHJcblx0XHRcdHZhciBldHh0Mj1udWxsO1xyXG5cdFx0XHR2YXIgbHN0YXRlID0gbnVsbDsgXHJcblx0XHRcdGlmICh0aGlzLnN0YXRlcy5sZW5ndGgpIFxyXG5cdFx0XHR7XHJcblx0XHRcdFx0bHN0YXRlID0gdGhpcy5zdGF0ZXNbdGhpcy5zdGF0ZXMubGVuZ3RoLTFdO1xyXG5cdFx0XHRcdGlmIChsc3RhdGUuZ2V0U3BlZWQoKSA+IDApIFxyXG5cdFx0XHRcdHtcclxuXHRcdFx0XHRcdHZhciBzcG1zID0gTWF0aC5jZWlsKGxzdGF0ZS5nZXRTcGVlZCgpICogMTAwKSAvIDEwMDtcclxuXHRcdFx0XHRcdHNwbXMvPTEwMDAuMDtcclxuXHRcdFx0XHRcdHNwbXMqPTYwKjYwO1xyXG5cdFx0XHRcdFx0ZXR4dDE9cGFyc2VGbG9hdChzcG1zKS50b0ZpeGVkKDIpK1wiIGttL2hcIjtcclxuXHRcdFx0XHRcdHZhciByb3QgPSAtdGhpcy5nZXRSb3RhdGlvbigpKjE4MC9NYXRoLlBJOyBcclxuXHRcdFx0XHRcdGlmIChyb3QgPCAwKVxyXG5cdFx0XHRcdFx0XHRyb3QrPTM2MDtcclxuXHRcdFx0XHRcdGlmIChyb3QgIT0gbnVsbCkgXHJcblx0XHRcdFx0XHR7XHJcblx0XHRcdFx0XHRcdGlmIChyb3QgPD0gMCkgXHJcblx0XHRcdFx0XHRcdFx0ZXR4dDErPVwiIEVcIjtcclxuXHRcdFx0XHRcdFx0ZWxzZSBpZiAocm90IDw9IDQ1KVxyXG5cdFx0XHRcdFx0XHRcdGV0eHQxKz1cIiBTRVwiO1xyXG5cdFx0XHRcdFx0XHRlbHNlIGlmIChyb3QgPD0gOTApXHJcblx0XHRcdFx0XHRcdFx0ZXR4dDErPVwiIFNcIjtcclxuXHRcdFx0XHRcdFx0ZWxzZSBpZiAocm90IDw9IDEzNSlcclxuXHRcdFx0XHRcdFx0XHRldHh0MSs9XCIgU1dcIjtcclxuXHRcdFx0XHRcdFx0ZWxzZSBpZiAocm90IDw9IDE4MClcclxuXHRcdFx0XHRcdFx0XHRldHh0MSs9XCIgV1wiO1xyXG5cdFx0XHRcdFx0XHRlbHNlIGlmIChyb3QgPD0gMjI1KVxyXG5cdFx0XHRcdFx0XHRcdGV0eHQxKz1cIiBOV1wiO1xyXG5cdFx0XHRcdFx0XHRlbHNlIGlmIChyb3QgPD0gMjcwKVxyXG5cdFx0XHRcdFx0XHRcdGV0eHQxKz1cIiBOXCI7XHJcblx0XHRcdFx0XHRcdGVsc2UgXHJcblx0XHRcdFx0XHRcdFx0ZXR4dDErPVwiIE5FXCI7XHJcblx0XHRcdFx0XHR9XHJcblx0XHRcdFx0XHRlc3RmPVV0aWxzLmZvcm1hdFRpbWUobmV3IERhdGUoIGN0aW1lICsgdGFyZ2V0S00qMTAwMCAvIHNwbXMqMTAwMCApKTsgIFxyXG5cdFx0XHRcdH1cclxuXHRcdFx0XHRpZiAobHN0YXRlLmdldEFjY2VsZXJhdGlvbigpID4gMClcclxuXHRcdFx0XHRcdGV0eHQyPXBhcnNlRmxvYXQoTWF0aC5jZWlsKGxzdGF0ZS5nZXRBY2NlbGVyYXRpb24oKSAqIDEwMCkgLyAxMDApLnRvRml4ZWQoMikrXCIgbS9zMlwiO1xyXG5cdFx0XHR9XHJcblx0XHRcdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdFx0XHR2YXIgcDEgPSAxMDAqdGhpcy50cmFjay5iaWtlU3RhcnRLTS8odGxlbi8xMDAwLjApO1xyXG5cdFx0XHR2YXIgcDIgPSAxMDAqKHRoaXMudHJhY2sucnVuU3RhcnRLTS10aGlzLnRyYWNrLmJpa2VTdGFydEtNKS8odGxlbi8xMDAwLjApO1xyXG5cdFx0XHR2YXIgcDMgPSAxMDAqKHRsZW4vMTAwMC4wIC0gdGhpcy50cmFjay5ydW5TdGFydEtNKS8odGxlbi8xMDAwLjApO1xyXG5cdFx0XHR2YXIgcHJldHR5Q29vcmQ9XHJcblx0XHRcdFx0XCI8ZGl2IHN0eWxlPSdvcGFjaXR5OjAuNztmbG9hdDpsZWZ0O292ZXJmbG93OmhpZGRlbjtoZWlnaHQ6N3B4O3dpZHRoOlwiK3AxK1wiJTtiYWNrZ3JvdW5kLWNvbG9yOlwiK0NPTkZJRy5hcHBlYXJhbmNlLnRyYWNrQ29sb3JTd2ltK1wiJy8+XCIrXHJcblx0XHRcdFx0XCI8ZGl2IHN0eWxlPSdvcGFjaXR5OjAuNztmbG9hdDpsZWZ0O292ZXJmbG93OmhpZGRlbjtoZWlnaHQ6N3B4O3dpZHRoOlwiK3AyK1wiJTtiYWNrZ3JvdW5kLWNvbG9yOlwiK0NPTkZJRy5hcHBlYXJhbmNlLnRyYWNrQ29sb3JCaWtlK1wiJy8+XCIrXHJcblx0XHRcdFx0XCI8ZGl2IHN0eWxlPSdvcGFjaXR5OjAuNztmbG9hdDpsZWZ0O292ZXJmbG93OmhpZGRlbjtoZWlnaHQ6N3B4O3dpZHRoOlwiK3AzK1wiJTtiYWNrZ3JvdW5kLWNvbG9yOlwiK0NPTkZJRy5hcHBlYXJhbmNlLnRyYWNrQ29sb3JSdW4rXCInLz5cIlxyXG5cdFx0XHRcdDsgLy9vbC5jb29yZGluYXRlLnRvU3RyaW5nSERNUyh0aGlzLmdldFBvc2l0aW9uKCksIDIpO1xyXG5cclxuXHRcdFx0dmFyIGltZ2RpdjtcclxuXHRcdFx0aWYgKHRwYXJ0ID09IDApXHJcblx0XHRcdFx0aW1nZGl2PVwiPGltZyBjbGFzcz0ncG9wdXBfdHJhY2tfbW9kZScgc3R5bGU9J2xlZnQ6XCIrZWxhcHNlZCoxMDArXCIlJyBzcmM9J2ltZy9zd2ltLnN2ZycvPlwiXHJcblx0XHRcdGVsc2UgaWYgKHRwYXJ0ID09IDEpXHJcblx0XHRcdFx0aW1nZGl2PVwiPGltZyBjbGFzcz0ncG9wdXBfdHJhY2tfbW9kZScgc3R5bGU9J2xlZnQ6XCIrZWxhcHNlZCoxMDArXCIlJyBzcmM9J2ltZy9iaWtlLnN2ZycvPlwiXHJcblx0XHRcdGVsc2UgLyppZiAodHBhcnQgPT0gMikqL1xyXG5cdFx0XHRcdGltZ2Rpdj1cIjxpbWcgY2xhc3M9J3BvcHVwX3RyYWNrX21vZGUnIHN0eWxlPSdsZWZ0OlwiK2VsYXBzZWQqMTAwK1wiJScgc3JjPSdpbWcvcnVuLnN2ZycvPlwiXHJcblx0XHJcblxyXG5cdFx0XHR2YXIgcGFzcyA9IE1hdGgucm91bmQoKG5ldyBEYXRlKCkpLmdldFRpbWUoKS8zNTAwKSAlIDM7XHJcblx0XHRcdGh0bWwrPVwiPHRhYmxlIGNsYXNzPSdwb3B1cF90YWJsZScgc3R5bGU9J2JhY2tncm91bmQtaW1hZ2U6dXJsKFxcXCJcIit0aGlzLmdldEltYWdlKCkrXCJcXFwiKSc+XCI7XHJcblx0XHRcdHZhciBpc0R1bW15PSEoZWxhcHNlZCA+IDApO1xyXG5cdFx0XHRodG1sKz1cIjx0cj48dGQgY2xhc3M9J2xibCc+RWxhcHNlZDwvdGQ+PHRkIGNsYXNzPSd2YWx1ZSc+XCIrKGlzRHVtbXkgPyBcIi1cIiA6IGVsa21zK1wiIGttXCIpK1wiPC90ZD48L3RyPlwiO1xyXG5cdFx0XHRodG1sKz1cIjx0cj48dGQgY2xhc3M9J2xibCc+TW9yZSB0byBcIit0cGFydE1vcmUrXCI8L3RkPjx0ZCBjbGFzcz0ndmFsdWUnPlwiKyhpc0R1bW15ID8gXCItXCIgOiBwYXJzZUZsb2F0KE1hdGgucm91bmQoKHRhcmdldEtNLWVsa20pICogMTAwKSAvIDEwMCkudG9GaXhlZCgyKSAvKiByZWttICovICtcIiBrbVwiKStcIjwvdGQ+PC90cj5cIjtcclxuXHRcdFx0aHRtbCs9XCI8dHI+PHRkIGNsYXNzPSdsYmwnPkZpbmlzaCBcIisgdHBhcnRzLnRvTG93ZXJDYXNlKCkgK1wiPC90ZD48dGQgY2xhc3M9J3ZhbHVlJz5cIisoIWVzdGYgPyBcIi1cIiA6IGVzdGYpK1wiPC90ZD48L3RyPlwiO1x0XHRcdFx0XHRcclxuXHRcdFx0aHRtbCs9XCI8dHI+PHRkIGNsYXNzPSdsYmwnPlNwZWVkPC90ZD48dGQgY2xhc3M9J3ZhbHVlJz5cIisoIWlzRHVtbXkgJiYgZXR4dDEgPyBldHh0MSA6IFwiLVwiKSArIFwiPC90ZD48L3RyPlwiO1xyXG5cdFx0XHRodG1sKz1cIjx0cj48dGQgY2xhc3M9J2xibCc+QWNjZWxlci48L3RkPjx0ZCBjbGFzcz0ndmFsdWUnPlwiKyghaXNEdW1teSAmJiBldHh0MiA/IGV0eHQyIDogXCItXCIpICtcIjwvdGQ+PC90cj5cIjtcclxuXHRcdFx0aHRtbCs9XCI8dHIgc3R5bGU9J2hlaWdodDoxMDAlJz48dGQ+Jm5ic3A7PC90ZD48dGQ+Jm5ic3A7PC90ZD48L3RyPlwiO1xyXG5cdFx0XHRodG1sK1wiPC90YWJsZT5cIlxyXG5cdFx0XHQvL2h0bWwrPVwiPGRpdiBjbGFzcz0ncG9wdXBfc2hhZG93Jz5cIitwcmV0dHlDb29yZCtpbWdkaXYrXCI8L2Rpdj5cIjtcclxuXHRcdFx0XHJcblx0XHRcdHZhciByYW5rPVwiLVwiO1xyXG5cdFx0XHRpZiAodGhpcy5fX3BvcyAhPSB1bmRlZmluZWQpXHJcblx0XHRcdFx0cmFuaz10aGlzLl9fcG9zICsgMTsgICAvLyB0aGUgZmlyc3QgcG9zIC0gdGhlIEZBU1RFU1QgaXMgMFxyXG5cdFx0XHRcclxuXHRcdFx0XHJcblx0XHRcdGh0bWw9XCI8ZGl2IGNsYXNzPSdwb3B1cF9jb250ZW50X3ByZyc+PGRpdiBzdHlsZT0nd2lkdGg6XCIrcDErXCIlO2hlaWdodDo2cHg7YmFja2dyb3VuZC1jb2xvcjpcIitDT05GSUcuYXBwZWFyYW5jZS50cmFja0NvbG9yU3dpbStcIjtmbG9hdDpsZWZ0Oyc+PC9kaXY+PGRpdiBzdHlsZT0nd2lkdGg6XCIrcDIrXCIlO2hlaWdodDo2cHg7YmFja2dyb3VuZC1jb2xvcjpcIitDT05GSUcuYXBwZWFyYW5jZS50cmFja0NvbG9yQmlrZStcIjtmbG9hdDpsZWZ0Oyc+PC9kaXY+PGRpdiBzdHlsZT0nd2lkdGg6XCIrcDMrXCIlO2hlaWdodDo2cHg7YmFja2dyb3VuZC1jb2xvcjpcIitDT05GSUcuYXBwZWFyYW5jZS50cmFja0NvbG9yUnVuK1wiO2Zsb2F0OmxlZnQ7Jz48L2Rpdj5cIjtcclxuXHRcdFx0aHRtbCs9XCI8ZGl2IGNsYXNzPSdwb3B1cF90cmFja19wb3MnPjxkaXYgY2xhc3M9J3BvcHVwX3RyYWNrX3Bvc18xJyBzdHlsZT0nbGVmdDpcIisoZWxhcHNlZCo5MCkrXCIlJz48L2Rpdj48L2Rpdj5cIjtcclxuXHRcdFx0aHRtbCs9XCI8L2Rpdj5cIjtcclxuXHRcdFx0aHRtbCs9XCI8aW1nIGNsYXNzPSdwb3B1cF9jb250ZW50X2ltZycgc3JjPSdcIit0aGlzLmdldEltYWdlKCkrXCInLz5cIjtcclxuXHRcdFx0aHRtbCs9XCI8ZGl2IGNsYXNzPSdwb3B1cF9jb250ZW50XzEnPlwiO1xyXG5cdFx0XHRodG1sKz1cIjxkaXYgY2xhc3M9J3BvcHVwX2NvbnRlbnRfbmFtZSc+XCIrZXNjYXBlSFRNTCh0aGlzLmdldENvZGUoKSkrXCI8L2Rpdj5cIjtcclxuXHRcdFx0aHRtbCs9XCI8ZGl2IGNsYXNzPSdwb3B1cF9jb250ZW50X2wxJz5cIit0aGlzLmdldENvdW50cnkoKS5zdWJzdHJpbmcoMCwzKS50b1VwcGVyQ2FzZSgpK1wiIHwgUG9zOiBcIityYW5rK1wiIHwgU3BlZWQ6IFwiKyghaXNEdW1teSAmJiBldHh0MSA/IGV0eHQxIDogXCItXCIpK1wiPC9kaXY+XCI7XHJcblx0XHRcdHZhciBwYXNzID0gTWF0aC5yb3VuZCgoKG5ldyBEYXRlKCkpLmdldFRpbWUoKSAvIDEwMDAgLyA0KSklMjtcclxuXHRcdFx0aWYgKHBhc3MgPT0gMCkge1xyXG5cdFx0XHRcdGlmICh0aGlzLl9fcG9zICE9IHVuZGVmaW5lZCkgXHJcblx0XHRcdFx0e1xyXG5cdFx0XHRcdFx0cGFyc2VGbG9hdChNYXRoLnJvdW5kKGVsa20gKiAxMDApIC8gMTAwKS50b0ZpeGVkKDIpO1xyXG5cclxuXHRcdFx0XHRcdC8vIHRoaXMuX19uZXh0IGlzIHRoZSBwYXJ0aWNpcGFudCBiZWhpbmQgdGhpcyBvbmUgKGUuZyB0aGUgc2xvd2VyIG9uZSB3aXRoIGxlc3QgZWxhcHNlZCBpbmRleClcclxuXHRcdFx0XHRcdC8vIGFuZCB0aGlzLl9fcHJldiBpcyB0aGUgb25lIGJlZm9yZSB1c1xyXG5cdFx0XHRcdFx0Ly8gc28gaWYgcGFydGljaXBhbnQgaXMgaW4gcG9zaXRpb24gMyB0aGUgb25lIGJlZm9yZSBoaW0gd2lsbCBiZSAyIGFuZCB0aGUgb25lIGJlaGluZCBoaW0gd2lsbCBiZSA0XHJcblx0XHRcdFx0XHQvLyAoZS5nLiBcInRoaXMuX19wb3MgPT0gM1wiID0+IHRoaXMuX19wcmV2Ll9fcG9zID09IDIgYW5kIHRoaXMuX19wcmV2Ll9fbmV4dCA9PSA0XHJcblx0XHRcdFx0XHQvLyBmb3IgdGhlXHJcblxyXG5cdFx0XHRcdFx0aWYgKHRoaXMuX19wcmV2ICYmIHRoaXMuX19wcmV2Ll9fcG9zICE9IHVuZGVmaW5lZCAmJiB0aGlzLmdldFNwZWVkKCkpIHtcclxuXHRcdFx0XHRcdFx0Ly8gd2hhdCBpcyB0aGUgZGlmZmVyZW5jZSBiZXR3ZWVuIGN1cnJlbnQgb25lIGFuZCB0aGUgb25lIGJlZm9yZSAtIHdlIHdpbGwgcnVuIHNvIG91ciBzcGVlZFxyXG5cdFx0XHRcdFx0XHQvLyB3aGF0IHRpbWUgd2UgYXJlIHNob3J0IC0gc28gd2lsbCBhZGQgYSBtaW51cyBpbiBmcm9udCBvZiB0aGUgdGltZVxyXG5cdFx0XHRcdFx0XHR2YXIgZWxhcHNlZHByZXYgPSB0aGlzLl9fcHJldi5jYWxjdWxhdGVFbGFwc2VkQXZlcmFnZShjdGltZSk7XHJcblx0XHRcdFx0XHRcdHZhciBkcHJldiA9ICgoZWxhcHNlZHByZXYgLSBlbGFwc2VkKSp0aGlzLnRyYWNrLmdldFRyYWNrTGVuZ3RoKCkgLyB0aGlzLmdldFNwZWVkKCkpLzYwLjA7XHJcblx0XHRcdFx0XHRcdGRwcmV2ID0gcGFyc2VGbG9hdChNYXRoLnJvdW5kKGRwcmV2ICogMTAwKSAvIDEwMCkudG9GaXhlZCgyKTtcclxuXHRcdFx0XHRcdFx0aHRtbCs9XCI8ZGl2IGNsYXNzPSdwb3B1cF9jb250ZW50X2wyJz5HQVAgUFwiKyh0aGlzLl9fcHJldi5fX3BvcyArIDEpK1wiIDogLVwiK2RwcmV2K1wiIE1pbjwvZGl2PlwiO1xyXG5cdFx0XHRcdFx0fSBlbHNlIHtcclxuXHRcdFx0XHRcdFx0aHRtbCs9XCI8ZGl2IGNsYXNzPSdwb3B1cF9jb250ZW50X2wyJz4mbmJzcDs8L2Rpdj5cIjtcclxuXHRcdFx0XHRcdH1cclxuXHJcblx0XHRcdFx0XHRpZiAodGhpcy5fX25leHQgJiYgdGhpcy5fX25leHQuX19wb3MgIT0gdW5kZWZpbmVkICYmIHRoaXMuX19uZXh0LmdldFNwZWVkKCkpIHtcclxuXHRcdFx0XHRcdFx0Ly8gd2hhdCBpcyB0aGUgZGlmZmVyZW5jZSBiZXR3ZWVuIGN1cnJlbnQgb25lIGFuZCB0aGUgb25lIGJlaGluZCAtIHRoaXMgb3RoZXIgb25lIHdpbGwgcnVuIHNvIGhpcyBzcGVlZFxyXG5cdFx0XHRcdFx0XHQvLyB3YWh0IHRpbWUgd2UgYXJlIGFoZWFkIC0gc28gYSBwb3NpdGl2ZSB0aW1lXHJcblx0XHRcdFx0XHRcdHZhciBlbGFwc2VkbmV4dCA9IHRoaXMuX19uZXh0LmNhbGN1bGF0ZUVsYXBzZWRBdmVyYWdlKGN0aW1lKTtcclxuXHRcdFx0XHRcdFx0dmFyIGRuZXh0ID0gKChlbGFwc2VkIC0gZWxhcHNlZG5leHQpKnRoaXMudHJhY2suZ2V0VHJhY2tMZW5ndGgoKSAvIHRoaXMuX19uZXh0LmdldFNwZWVkKCkpLzYwLjA7XHJcblx0XHRcdFx0XHRcdGRuZXh0ID0gcGFyc2VGbG9hdChNYXRoLnJvdW5kKGRuZXh0ICogMTAwKSAvIDEwMCkudG9GaXhlZCgyKTtcclxuXHRcdFx0XHRcdFx0aHRtbCs9XCI8ZGl2IGNsYXNzPSdwb3B1cF9jb250ZW50X2wzJz5HQVAgUFwiKyh0aGlzLl9fbmV4dC5fX3BvcyArIDEpK1wiIDogXCIrZG5leHQrXCIgTWluPC9kaXY+XCI7XHJcblx0XHRcdFx0XHR9IGVsc2Uge1xyXG5cdFx0XHRcdFx0XHRodG1sKz1cIjxkaXYgY2xhc3M9J3BvcHVwX2NvbnRlbnRfbDInPiZuYnNwOzwvZGl2PlwiO1xyXG5cdFx0XHRcdFx0fVxyXG5cdFx0XHRcdH1cclxuXHRcdFx0fSBlbHNlIHtcclxuXHRcdFx0XHRodG1sKz1cIjxkaXYgY2xhc3M9J3BvcHVwX2NvbnRlbnRfbDInPk1PUkUgVE8gIFwiK3RwYXJ0TW9yZStcIjogXCIrKGlzRHVtbXkgPyBcIi1cIiA6IHBhcnNlRmxvYXQoTWF0aC5yb3VuZCgodGFyZ2V0S00tZWxrbSkgKiAxMDApIC8gMTAwKS50b0ZpeGVkKDIpIC8qIHJla20gKi8gK1wiIGttXCIpK1wiPC9kaXY+XCI7XHJcblx0XHRcdFx0aHRtbCs9XCI8ZGl2IGNsYXNzPSdwb3B1cF9jb250ZW50X2wzJz5GSU5JU0ggXCIrIHRwYXJ0cyArXCI6IFwiKyghZXN0ZiA/IFwiLVwiIDogZXN0ZikrXCI8L2Rpdj5cIjtcclxuXHRcdFx0fVxyXG5cdFx0XHRodG1sKz1cIjwvZGl2PlwiO1xyXG5cdFx0XHRyZXR1cm4gaHRtbDtcclxuXHRcdH1cclxuXHRcdFxyXG5cdFx0XHJcbiAgICB9XHJcbn0pO1xyXG4iLCJyZXF1aXJlKCdqb29zZScpO1xyXG5cclxuQ2xhc3MoXCJQb2ludFwiLCB7XHJcbiAgICAvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcbiAgICAvLyBBTEwgQ09PUkRJTkFURVMgQVJFIElOIFdPUkxEIE1FUkNBVE9SXHJcbiAgICAvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblxyXG4gICAgaGFzIDoge1xyXG4gICAgICAgIGNvZGUgOiB7XHJcbiAgICAgICAgICAgIGlzIDogXCJyd1wiLFxyXG4gICAgICAgICAgICBpbml0IDogXCJDT0RFX05PVF9TRVRcIlxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgaWQgOiB7XHJcbiAgICAgICAgICAgIGlzIDogXCJyd1wiLFxyXG4gICAgICAgICAgICBpbml0IDogXCJJRF9OT1RfU0VUXCJcclxuICAgICAgICB9LFxyXG4gICAgICAgIGZlYXR1cmUgOiB7XHJcbiAgICAgICAgICAgIGlzIDogXCJyd1wiLFxyXG4gICAgICAgICAgICBpbml0IDogbnVsbFxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgcG9zaXRpb24gOiB7XHJcbiAgICAgICAgICAgIGlzOiAgIFwicndcIixcclxuICAgICAgICAgICAgaW5pdDogWzAsMF1cdC8vbG9uIGxhdCB3b3JsZCBtZXJjYXRvclxyXG4gICAgICAgIH1cclxuICAgIH0sXHJcblxyXG4gICAgbWV0aG9kcyA6IHtcclxuICAgICAgICBpbml0IDogZnVuY3Rpb24ocG9zKSB7XHJcbiAgICAgICAgICAgIGlmICh0eXBlb2Ygb2wgIT0gXCJ1bmRlZmluZWRcIikge1xyXG4gICAgICAgICAgICAgICAgdmFyIGdlb20gPSBuZXcgb2wuZ2VvbS5Qb2ludChwb3MpO1xyXG4gICAgICAgICAgICAgICAgZ2VvbS50cmFuc2Zvcm0oJ0VQU0c6NDMyNicsICdFUFNHOjM4NTcnKTtcclxuICAgICAgICAgICAgICAgIHZhciBmZWF0dXJlID0gbmV3IG9sLkZlYXR1cmUoKTtcclxuICAgICAgICAgICAgICAgIGZlYXR1cmUuc2V0R2VvbWV0cnkoZ2VvbSk7XHJcbiAgICAgICAgICAgICAgICB0aGlzLnNldEZlYXR1cmUoZmVhdHVyZSk7XHJcblxyXG4gICAgICAgICAgICAgICAgdGhpcy5zZXRQb3NpdGlvbihwb3MpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG59KTsiLCJ2YXIgQ09ORklHID0gcmVxdWlyZSgnLi9Db25maWcnKTtcclxuXHJcbnZhciBTVFlMRVM9XHJcbntcclxuXHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdC8vIHN0eWxlIGZ1bmN0aW9uIGZvciB0cmFja1xyXG5cdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0XHRcclxuXHRcIl90cmFja1wiOiBmdW5jdGlvbihmZWF0dXJlLHJlc29sdXRpb24pIFxyXG5cdHtcclxuICAgICAgICByZXR1cm4gXHJcbiAgICAgICAgW1xyXG4gICAgICAgIF07XHJcblx0fSxcclxuXHJcblx0XCJ0ZXN0XCI6IGZ1bmN0aW9uKGZlYXR1cmUscmVzb2x1dGlvbikgXHJcblx0e1xyXG5cdFx0dmFyIHN0eWxlcz1bXTtcclxuICAgICAgICBzdHlsZXMucHVzaChuZXcgb2wuc3R5bGUuU3R5bGUoe1xyXG4gICAgICAgICAgICAgc3Ryb2tlOiBuZXcgb2wuc3R5bGUuU3Ryb2tlKHtcclxuICAgICAgICAgICAgICAgICBjb2xvcjogXCIjMDAwMEZGXCIsXHJcbiAgICAgICAgICAgICAgICAgd2lkdGg6IDNcclxuICAgICAgICAgICAgIH0pXHJcbiAgICAgICAgIFx0fSkpO1xyXG4gICAgICAgIHJldHVybiBzdHlsZXM7XHJcblx0fSxcclxuXHRcInRyYWNrXCIgOiBmdW5jdGlvbihmZWF0dXJlLHJlc29sdXRpb24pIFxyXG5cdHtcclxuXHRcdHZhciBzdHlsZXM9W107XHJcblx0XHR2YXIgdHJhY2s9ZmVhdHVyZS50cmFjaztcclxuXHRcdHZhciBjb29yZHM9ZmVhdHVyZS5nZXRHZW9tZXRyeSgpLmdldENvb3JkaW5hdGVzKCk7XHJcblx0XHR2YXIgZ2VvbXN3aW09Y29vcmRzO1xyXG5cdFx0dmFyIGdlb21iaWtlO1xyXG5cdFx0dmFyIGdlb21ydW47XHJcblx0XHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRcdFxyXG5cdFx0Lyp2YXIgd3cgPSA4LjAvcmVzb2x1dGlvbjtcclxuXHRcdGlmICh3dyA8IDYuMClcclxuXHRcdFx0d3c9Ni4wOyovXHJcblx0XHR2YXIgd3c9MTAuMDtcclxuXHJcblx0XHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRcdGlmICh0cmFjayAmJiAhaXNOYU4odHJhY2suYmlrZVN0YXJ0S00pKSBcclxuXHRcdHtcclxuXHRcdFx0Zm9yICh2YXIgaT0wO2k8dHJhY2suZGlzdGFuY2VzLmxlbmd0aDtpKyspIHtcclxuXHRcdFx0XHRpZiAodHJhY2suZGlzdGFuY2VzW2ldID49IHRyYWNrLmJpa2VTdGFydEtNKjEwMDApXHJcblx0XHRcdFx0XHRicmVhaztcclxuXHRcdFx0fVxyXG5cdFx0XHR2YXIgajtcclxuXHRcdFx0aWYgKCFpc05hTih0cmFjay5ydW5TdGFydEtNKSkge1xyXG5cdFx0XHRcdGZvciAoaj1pO2o8dHJhY2suZGlzdGFuY2VzLmxlbmd0aDtqKyspIHtcclxuXHRcdFx0XHRcdGlmICh0cmFjay5kaXN0YW5jZXNbal0gPj0gdHJhY2sucnVuU3RhcnRLTSoxMDAwKVxyXG5cdFx0XHRcdFx0XHRicmVhaztcclxuXHRcdFx0XHR9XHJcblx0XHRcdH0gZWxzZSB7XHJcblx0XHRcdFx0aj10cmFjay5kaXN0YW5jZXMubGVuZ3RoO1xyXG5cdFx0XHR9XHJcblx0XHRcdGdlb21zd2ltPWNvb3Jkcy5zbGljZSgwLGkpO1xyXG5cdFx0XHRnZW9tYmlrZT1jb29yZHMuc2xpY2UoaSA8IDEgPyBpIDogaS0xLGopO1xyXG5cdFx0XHRpZiAoaiA8IHRyYWNrLmRpc3RhbmNlcy5sZW5ndGgpXHJcblx0XHRcdFx0Z2VvbXJ1bj1jb29yZHMuc2xpY2UoaiA8IDEgPyBqIDogai0xLHRyYWNrLmRpc3RhbmNlcy5sZW5ndGgpO1xyXG5cdFx0XHRpZiAoIWdlb21zd2ltLmxlbmd0aClcclxuXHRcdFx0XHRnZW9tc3dpbT1udWxsO1xyXG5cdFx0XHRpZiAoIWdlb21iaWtlLmxlbmd0aClcclxuXHRcdFx0XHRnZW9tYmlrZT1udWxsO1xyXG5cdFx0XHRpZiAoIWdlb21ydW4ubGVuZ3RoKVxyXG4gICAgICAgICAgICAgICAgZ2VvbXJ1bj1udWxsO1xyXG5cdFx0fVxyXG5cclxuXHJcbiAgICAgICAgaWYgKGdlb21zd2ltICYmIEdVSS5pc1Nob3dTd2ltKSB7XHJcbiAgICAgICAgICAgIHN0eWxlcy5wdXNoKG5ldyBvbC5zdHlsZS5TdHlsZSh7XHJcbiAgICAgICAgICAgICAgICAgICAgZ2VvbWV0cnk6IG5ldyBvbC5nZW9tLkxpbmVTdHJpbmcoZ2VvbXN3aW0pLFxyXG4gICAgICAgICAgICAgICAgICAgIHN0cm9rZTogbmV3IG9sLnN0eWxlLlN0cm9rZSh7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbG9yOiBDT05GSUcuYXBwZWFyYW5jZS50cmFja0NvbG9yU3dpbSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgd2lkdGg6IHd3XHJcbiAgICAgICAgICAgICAgICAgICAgfSlcclxuICAgICAgICAgICAgICAgIH0pXHJcbiAgICAgICAgICAgICk7XHJcbiAgICAgICAgICAgIFNUWUxFUy5fZ2VuRGlyZWN0aW9uKGdlb21zd2ltLCB3dywgcmVzb2x1dGlvbiwgQ09ORklHLmFwcGVhcmFuY2UudHJhY2tDb2xvclN3aW0sIHN0eWxlcyk7XHJcblxyXG4gICAgICAgICAgICBTVFlMRVMuX2dlbkRpc3RhbmNlS20od3csIHJlc29sdXRpb24sIGNvb3JkcywgdHJhY2suZGlzdGFuY2VzLCAwLCBpLCBzdHlsZXMpO1xyXG5cclxuXHRcdFx0Ly8gZm9yIG5vdyBkb24ndCBzaG93IHRoaXMgY2hlY2twb2ludFxyXG5cdFx0XHQvL2lmIChHVUkuaXNTaG93U3dpbSlcclxuXHRcdFx0Ly9cdFNUWUxFUy5fZ2VuQ2hlY2twb2ludChnZW9tc3dpbSwgQ09ORklHLmFwcGVhcmFuY2UudHJhY2tDb2xvclN3aW0sIHN0eWxlcyk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGlmIChnZW9tYmlrZSAmJiBHVUkuaXNTaG93QmlrZSlcclxuICAgICAgICB7XHJcbiAgICAgICAgICAgIHN0eWxlcy5wdXNoKG5ldyBvbC5zdHlsZS5TdHlsZSh7XHJcbiAgICAgICAgICAgICAgICAgICAgZ2VvbWV0cnk6IG5ldyBvbC5nZW9tLkxpbmVTdHJpbmcoZ2VvbWJpa2UpLFxyXG4gICAgICAgICAgICAgICAgICAgIHN0cm9rZTogbmV3IG9sLnN0eWxlLlN0cm9rZSh7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbG9yOiBDT05GSUcuYXBwZWFyYW5jZS50cmFja0NvbG9yQmlrZSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgd2lkdGg6IHd3XHJcbiAgICAgICAgICAgICAgICAgICAgfSlcclxuICAgICAgICAgICAgICAgIH0pXHJcbiAgICAgICAgICAgICk7XHJcbiAgICAgICAgICAgIFNUWUxFUy5fZ2VuRGlyZWN0aW9uKGdlb21iaWtlLCB3dywgcmVzb2x1dGlvbiwgQ09ORklHLmFwcGVhcmFuY2UudHJhY2tDb2xvckJpa2UsIHN0eWxlcyk7XHJcblxyXG4gICAgICAgICAgICBTVFlMRVMuX2dlbkRpc3RhbmNlS20od3csIHJlc29sdXRpb24sIGNvb3JkcywgdHJhY2suZGlzdGFuY2VzLCBpLCBqLCBzdHlsZXMpO1xyXG5cclxuXHRcdFx0Ly8gYWRkIGNoZWNrcG9pbnQgaWYgdGhpcyBpcyBub3QgYWxyZWFkeSBhZGRlZCBhcyBhIGhvdHNwb3RcclxuXHRcdFx0aWYgKCF0cmFjay5pc0FkZGVkSG90U3BvdFN3aW1CaWtlKSB7XHJcblx0XHRcdFx0aWYgKENPTkZJRy5hcHBlYXJhbmNlLmlzU2hvd0ltYWdlQ2hlY2twb2ludClcclxuXHRcdFx0XHRcdFNUWUxFUy5fZ2VuQ2hlY2twb2ludEltYWdlKGdlb21iaWtlLCBDT05GSUcuYXBwZWFyYW5jZS5pbWFnZUNoZWNrcG9pbnRTd2ltQmlrZSwgc3R5bGVzKTtcclxuXHRcdFx0XHRlbHNlIGlmIChHVUkuaXNTaG93QmlrZSlcclxuXHRcdFx0XHRcdFNUWUxFUy5fZ2VuQ2hlY2twb2ludChnZW9tYmlrZSwgQ09ORklHLmFwcGVhcmFuY2UudHJhY2tDb2xvckJpa2UsIHN0eWxlcyk7XHJcblx0XHRcdH1cclxuICAgICAgICB9XHJcblx0XHRpZiAoZ2VvbXJ1biAmJiBHVUkuaXNTaG93UnVuKVxyXG5cdFx0e1xyXG5cdFx0XHRzdHlsZXMucHVzaChuZXcgb2wuc3R5bGUuU3R5bGUoe1xyXG4gICAgICAgICAgICAgICAgICAgIGdlb21ldHJ5OiBuZXcgb2wuZ2VvbS5MaW5lU3RyaW5nKGdlb21ydW4pLFxyXG4gICAgICAgICAgICAgICAgICAgIHN0cm9rZTogbmV3IG9sLnN0eWxlLlN0cm9rZSh7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbG9yOiBDT05GSUcuYXBwZWFyYW5jZS50cmFja0NvbG9yUnVuLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICB3aWR0aDogd3dcclxuICAgICAgICAgICAgICAgICAgICB9KVxyXG4gICAgICAgICAgICAgICAgfSlcclxuICAgICAgICAgICAgKTtcclxuICAgICAgICAgICAgU1RZTEVTLl9nZW5EaXJlY3Rpb24oZ2VvbXJ1biwgd3csIHJlc29sdXRpb24sIENPTkZJRy5hcHBlYXJhbmNlLnRyYWNrQ29sb3JSdW4sIHN0eWxlcyk7XHJcblxyXG4gICAgICAgICAgICBTVFlMRVMuX2dlbkRpc3RhbmNlS20od3csIHJlc29sdXRpb24sIGNvb3JkcywgdHJhY2suZGlzdGFuY2VzLCBqLCB0cmFjay5kaXN0YW5jZXMubGVuZ3RoLCBzdHlsZXMpO1xyXG5cclxuXHRcdFx0Ly8gYWRkIGNoZWNrcG9pbnQgaWYgdGhpcyBpcyBub3QgYWxyZWFkeSBhZGRlZCBhcyBhIGhvdHNwb3RcclxuXHRcdFx0aWYgKCF0cmFjay5pc0FkZGVkSG90U3BvdEJpa2VSdW4pIHtcclxuXHRcdFx0XHRpZiAoQ09ORklHLmFwcGVhcmFuY2UuaXNTaG93SW1hZ2VDaGVja3BvaW50KVxyXG5cdFx0XHRcdFx0U1RZTEVTLl9nZW5DaGVja3BvaW50SW1hZ2UoZ2VvbXJ1biwgQ09ORklHLmFwcGVhcmFuY2UuaW1hZ2VDaGVja3BvaW50QmlrZVJ1biwgc3R5bGVzKTtcclxuXHRcdFx0XHRlbHNlIGlmIChHVUkuaXNTaG93QmlrZSlcclxuXHRcdFx0XHRcdFNUWUxFUy5fZ2VuQ2hlY2twb2ludChnZW9tcnVuLCBDT05GSUcuYXBwZWFyYW5jZS50cmFja0NvbG9yUnVuLCBzdHlsZXMpO1xyXG5cdFx0XHR9XHJcbiAgICAgICAgfVxyXG5cclxuXHRcdC8vIFNUQVJULUZJTklTSCAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdFx0aWYgKGNvb3JkcyAmJiBjb29yZHMubGVuZ3RoID49IDIpXHJcblx0XHR7XHJcblx0XHRcdHZhciBzdGFydCA9IGNvb3Jkc1swXTtcclxuXHRcdFx0dmFyIGVuZCA9IGNvb3Jkc1sxXTtcclxuXHRcdFx0Lyp2YXIgZHggPSBlbmRbMF0gLSBzdGFydFswXTtcclxuXHRcdFx0IHZhciBkeSA9IGVuZFsxXSAtIHN0YXJ0WzFdO1xyXG5cdFx0XHQgdmFyIHJvdGF0aW9uID0gTWF0aC5hdGFuMihkeSwgZHgpO1xyXG5cdFx0XHQgc3R5bGVzLnB1c2gobmV3IG9sLnN0eWxlLlN0eWxlKFxyXG5cdFx0XHQge1xyXG5cdFx0XHQgZ2VvbWV0cnk6IG5ldyBvbC5nZW9tLlBvaW50KHN0YXJ0KSxcclxuXHRcdFx0IGltYWdlOiBuZXcgb2wuc3R5bGUuSWNvbih7XHJcblx0XHRcdCBzcmM6ICdpbWcvYmVnaW4tZW5kLWFycm93LnBuZycsXHJcblx0XHRcdCBzY2FsZSA6IDAuNDUsXHJcblx0XHRcdCBhbmNob3I6IFswLjAsIDAuNV0sXHJcblx0XHRcdCByb3RhdGVXaXRoVmlldzogdHJ1ZSxcclxuXHRcdFx0IHJvdGF0aW9uOiAtcm90YXRpb24sXHJcblx0XHRcdCBvcGFjaXR5IDogMVxyXG5cdFx0XHQgfSlcclxuXHRcdFx0IH0pKTsqL1xyXG5cclxuXHRcdFx0Ly8gbG9vcD9cclxuXHRcdFx0ZW5kID0gY29vcmRzW2Nvb3Jkcy5sZW5ndGgtMV07XHJcblx0XHRcdGlmIChlbmRbMF0gIT0gc3RhcnRbMF0gfHwgZW5kWzFdICE9IHN0YXJ0WzFdKVxyXG5cdFx0XHR7XHJcblx0XHRcdFx0dmFyIHN0YXJ0ID0gY29vcmRzW2Nvb3Jkcy5sZW5ndGgtMl07XHJcblx0XHRcdFx0dmFyIGR4ID0gZW5kWzBdIC0gc3RhcnRbMF07XHJcblx0XHRcdFx0dmFyIGR5ID0gZW5kWzFdIC0gc3RhcnRbMV07XHJcblx0XHRcdFx0dmFyIHJvdGF0aW9uID0gTWF0aC5hdGFuMihkeSwgZHgpO1xyXG5cdFx0XHRcdHN0eWxlcy5wdXNoKG5ldyBvbC5zdHlsZS5TdHlsZShcclxuXHRcdFx0XHRcdHtcclxuXHRcdFx0XHRcdFx0Z2VvbWV0cnk6IG5ldyBvbC5nZW9tLlBvaW50KGVuZCksXHJcblx0XHRcdFx0XHRcdGltYWdlOiBuZXcgb2wuc3R5bGUuSWNvbih7XHJcblx0XHRcdFx0XHRcdFx0c3JjOiBDT05GSUcuYXBwZWFyYW5jZS5pbWFnZUZpbmlzaCxcclxuXHRcdFx0XHRcdFx0XHRzY2FsZSA6IDAuNDUsXHJcblx0XHRcdFx0XHRcdFx0YW5jaG9yOiBbMC41LCAwLjVdLFxyXG5cdFx0XHRcdFx0XHRcdHJvdGF0ZVdpdGhWaWV3OiB0cnVlLFxyXG5cdFx0XHRcdFx0XHRcdC8vcm90YXRpb246IC1yb3RhdGlvbixcclxuXHRcdFx0XHRcdFx0XHRvcGFjaXR5IDogMVxyXG5cdFx0XHRcdFx0XHR9KVxyXG5cdFx0XHRcdFx0fSkpO1xyXG5cdFx0XHR9XHJcblx0XHR9XHJcblxyXG5cdFx0cmV0dXJuIHN0eWxlcztcclxuXHR9LFxyXG5cdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRcImRlYnVnR1BTXCIgOiBmdW5jdGlvbihmZWF0dXJlLHJlc29sdXRpb24pIFxyXG5cdHtcclxuXHRcdHZhciBjb2VmID0gKChuZXcgRGF0ZSgpKS5nZXRUaW1lKCktZmVhdHVyZS50aW1lQ3JlYXRlZCkvKENPTkZJRy50aW1lb3V0cy5ncHNMb2NhdGlvbkRlYnVnU2hvdyoxMDAwKTtcclxuXHRcdGlmIChjb2VmID4gMSlcclxuXHRcdFx0cmV0dXJuIFtdO1xyXG5cdFx0cmV0dXJuIFtcclxuXHRcdCAgICAgICAgbmV3IG9sLnN0eWxlLlN0eWxlKHtcclxuXHRcdCAgICAgICAgaW1hZ2U6IG5ldyBvbC5zdHlsZS5DaXJjbGUoe1xyXG5cdFx0ICAgICAgICAgICAgcmFkaXVzOiBjb2VmKjIwLFxyXG5cdFx0ICAgICAgICAgICAgc3Ryb2tlOiBuZXcgb2wuc3R5bGUuU3Ryb2tlKHtcclxuXHRcdCAgICAgICAgICAgIFx0Ly9mZWF0dXJlLmNvbG9yXHJcblx0XHQgICAgICAgICAgICAgICAgY29sb3I6IGNvbG9yQWxwaGFBcnJheShmZWF0dXJlLmNvbG9yLCgxLjAtY29lZikqMS4wKSwgXHJcblx0XHQgICAgICAgICAgICAgICAgd2lkdGg6IDRcclxuXHRcdCAgICAgICAgICAgIH0pXHJcblx0XHQgICAgICAgICAgfSlcclxuXHRcdH0pXTtcclxuXHR9LFxyXG5cdFxyXG5cdFwicGFydGljaXBhbnRcIiA6IGZ1bmN0aW9uKGZlYXR1cmUscmVzb2x1dGlvbikgXHJcblx0e1xyXG5cdFx0Ly8gU0tJUCBEUkFXIChUT0RPIE9QVElNSVpFKVxyXG5cdFx0dmFyIHBhcnQgPSBmZWF0dXJlLnBhcnRpY2lwYW50O1xyXG5cdFx0aWYgKCFwYXJ0LmlzRmF2b3JpdGUpXHJcblx0XHRcdHJldHVybiBbXTtcclxuXHRcdFxyXG5cdFx0dmFyIGV0eHQ9XCJcIjtcclxuXHRcdHZhciBsc3RhdGUgPSBudWxsO1xyXG5cdFx0aWYgKHBhcnQuc3RhdGVzLmxlbmd0aCkge1xyXG5cdFx0XHRsc3RhdGUgPSBwYXJ0LnN0YXRlc1twYXJ0LnN0YXRlcy5sZW5ndGgtMV07XHJcblx0XHRcdGV0eHQ9XCIgXCIrcGFyc2VGbG9hdChNYXRoLmNlaWwobHN0YXRlLmdldFNwZWVkKCkgKiAxMDApIC8gMTAwKS50b0ZpeGVkKDIpK1wiIG0vc1wiOy8vIHwgYWNjIFwiK3BhcnNlRmxvYXQoTWF0aC5jZWlsKGxzdGF0ZS5nZXRBY2NlbGVyYXRpb24oKSAqIDEwMCkgLyAxMDApLnRvRml4ZWQoMikrXCIgbS9zXCI7XHJcblx0XHR9XHJcblx0XHR2YXIgekluZGV4ID0gTWF0aC5yb3VuZChwYXJ0LmdldEVsYXBzZWQoKSoxMDAwMDAwKSoxMDAwK3BhcnQuc2VxSWQ7XHJcblx0XHQvKmlmIChwYXJ0ID09IEdVSS5nZXRTZWxlY3RlZFBhcnRpY2lwYW50KCkpIHtcclxuXHRcdFx0ekluZGV4PTFlMjA7XHJcblx0XHR9Ki9cclxuXHRcdHZhciBzdHlsZXM9W107XHJcblx0XHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0XHR2YXIgY3RpbWUgPSAobmV3IERhdGUoKSkuZ2V0VGltZSgpO1xyXG5cdFx0dmFyIGlzVGltZSA9IChjdGltZSA+PSBDT05GSUcudGltZXMuYmVnaW4gJiYgY3RpbWUgPD0gQ09ORklHLnRpbWVzLmVuZCk7XHJcblx0XHR2YXIgaXNEaXJlY3Rpb24gPSAobHN0YXRlICYmIGxzdGF0ZS5nZXRTcGVlZCgpID4gMCAmJiAhcGFydC5pc1NPUyAmJiAhcGFydC5pc0Rpc2NhcmRlZCAmJiBpc1RpbWUpO1xyXG5cdFx0dmFyIGFuaW1GcmFtZSA9IChjdGltZSUzMDAwKSpNYXRoLlBJKjIvMzAwMC4wO1xyXG5cclxuICAgICAgICBpZiAoaXNUaW1lKSB7XHJcbiAgICAgICAgICAgIHN0eWxlcy5wdXNoKG5ldyBvbC5zdHlsZS5TdHlsZSh7XHJcbiAgICAgICAgICAgICAgICB6SW5kZXg6IHpJbmRleCxcclxuICAgICAgICAgICAgICAgIGltYWdlOiBuZXcgb2wuc3R5bGUuQ2lyY2xlKHtcclxuICAgICAgICAgICAgICAgICAgICByYWRpdXM6IDE3LFxyXG4gICAgICAgICAgICAgICAgICAgIGZpbGw6IG5ldyBvbC5zdHlsZS5GaWxsKHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29sb3I6IHBhcnQuaXNEaXNjYXJkZWQgfHwgcGFydC5pc1NPUyA/IFwicmdiYSgxOTIsMCwwLFwiICsgKE1hdGguc2luKGFuaW1GcmFtZSkgKiAwLjcgKyAwLjMpICsgXCIpXCIgOiBcInJnYmEoXCIgKyBjb2xvckFscGhhQXJyYXkocGFydC5jb2xvciwgMC44NSkuam9pbihcIixcIikgKyBcIilcIlxyXG4gICAgICAgICAgICAgICAgICAgIH0pLFxyXG4gICAgICAgICAgICAgICAgICAgIHN0cm9rZTogbmV3IG9sLnN0eWxlLlN0cm9rZSh7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbG9yOiBwYXJ0LmlzRGlzY2FyZGVkIHx8IHBhcnQuaXNTT1MgPyBcInJnYmEoMjU1LDAsMCxcIiArICgxLjAgLSAoTWF0aC5zaW4oYW5pbUZyYW1lKSAqIDAuNyArIDAuMykpICsgXCIpXCIgOiBcIiNmZmZmZmZcIixcclxuICAgICAgICAgICAgICAgICAgICAgICAgd2lkdGg6IDNcclxuICAgICAgICAgICAgICAgICAgICB9KVxyXG4gICAgICAgICAgICAgICAgfSksXHJcbiAgICAgICAgICAgICAgICB0ZXh0OiBuZXcgb2wuc3R5bGUuVGV4dCh7XHJcbiAgICAgICAgICAgICAgICAgICAgZm9udDogJ25vcm1hbCAxM3B4IExhdG8tUmVndWxhcicsXHJcbiAgICAgICAgICAgICAgICAgICAgZmlsbDogbmV3IG9sLnN0eWxlLkZpbGwoe1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb2xvcjogJyNGRkZGRkYnXHJcbiAgICAgICAgICAgICAgICAgICAgfSksXHJcbiAgICAgICAgICAgICAgICAgICAgdGV4dDogcGFydC5nZXRJbml0aWFscygpLFxyXG4gICAgICAgICAgICAgICAgICAgIG9mZnNldFg6IDAsXHJcbiAgICAgICAgICAgICAgICAgICAgb2Zmc2V0WTogMFxyXG4gICAgICAgICAgICAgICAgfSlcclxuICAgICAgICAgICAgfSkpO1xyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgIHN0eWxlcy5wdXNoKG5ldyBvbC5zdHlsZS5TdHlsZSh7XHJcbiAgICAgICAgICAgICAgICB6SW5kZXg6IHpJbmRleCxcclxuICAgICAgICAgICAgICAgIGltYWdlOiBuZXcgb2wuc3R5bGUuQ2lyY2xlKHtcclxuICAgICAgICAgICAgICAgICAgICByYWRpdXM6IDE3LFxyXG4gICAgICAgICAgICAgICAgICAgIGZpbGw6IG5ldyBvbC5zdHlsZS5GaWxsKHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29sb3I6IFwicmdiYShcIiArIGNvbG9yQWxwaGFBcnJheShwYXJ0LmNvbG9yLCAwLjM1KS5qb2luKFwiLFwiKSArIFwiKVwiXHJcbiAgICAgICAgICAgICAgICAgICAgfSksXHJcbiAgICAgICAgICAgICAgICAgICAgc3Ryb2tlOiBuZXcgb2wuc3R5bGUuU3Ryb2tlKHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29sb3I6IFwicmdiYSgyNTUsMjU1LDI1NSwxKVwiLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICB3aWR0aDogM1xyXG4gICAgICAgICAgICAgICAgICAgIH0pXHJcbiAgICAgICAgICAgICAgICB9KSxcclxuICAgICAgICAgICAgICAgIHRleHQ6IG5ldyBvbC5zdHlsZS5UZXh0KHtcclxuICAgICAgICAgICAgICAgICAgICBmb250OiAnbm9ybWFsIDEzcHggTGF0by1SZWd1bGFyJyxcclxuICAgICAgICAgICAgICAgICAgICBmaWxsOiBuZXcgb2wuc3R5bGUuRmlsbCh7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbG9yOiAnIzAwMDAwMCdcclxuICAgICAgICAgICAgICAgICAgICB9KSxcclxuICAgICAgICAgICAgICAgICAgICB0ZXh0OiBwYXJ0LmdldERldmljZUlkKCksXHJcbiAgICAgICAgICAgICAgICAgICAgb2Zmc2V0WDogMCxcclxuICAgICAgICAgICAgICAgICAgICBvZmZzZXRZOiAyMFxyXG4gICAgICAgICAgICAgICAgfSlcclxuICAgICAgICAgICAgfSkpO1xyXG4gICAgICAgIH1cclxuICAgICAgICAvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcbiAgICAgICAgc3R5bGVzLnB1c2gobmV3IG9sLnN0eWxlLlN0eWxlKHtcclxuICAgICAgICAgICAgekluZGV4OiB6SW5kZXgsXHJcbiAgICAgICAgICAgIGltYWdlOiBuZXcgb2wuc3R5bGUuQ2lyY2xlKHtcclxuICAgICAgICAgICAgICAgIHJhZGl1czogMTcsXHJcbiAgICAgICAgICAgICAgICBmaWxsOiBuZXcgb2wuc3R5bGUuRmlsbCh7XHJcbiAgICAgICAgICAgICAgICAgICAgY29sb3I6IHBhcnQuaXNEaXNjYXJkZWQgfHwgcGFydC5pc1NPUyA/IFwicmdiYSgxOTIsMCwwLFwiICsgKE1hdGguc2luKGFuaW1GcmFtZSkgKiAwLjcgKyAwLjMpICsgXCIpXCIgOiBcInJnYmEoXCIgKyBjb2xvckFscGhhQXJyYXkocGFydC5jb2xvciwgMC44NSkuam9pbihcIixcIikgKyBcIilcIlxyXG4gICAgICAgICAgICAgICAgfSksXHJcbiAgICAgICAgICAgICAgICBzdHJva2U6IG5ldyBvbC5zdHlsZS5TdHJva2Uoe1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbG9yOiBwYXJ0LmlzRGlzY2FyZGVkIHx8IHBhcnQuaXNTT1MgPyBcInJnYmEoMjU1LDAsMCxcIiArICgxLjAgLSAoTWF0aC5zaW4oYW5pbUZyYW1lKSAqIDAuNyArIDAuMykpICsgXCIpXCIgOiBcIiNmZmZmZmZcIixcclxuICAgICAgICAgICAgICAgICAgICB3aWR0aDogM1xyXG4gICAgICAgICAgICAgICAgfSlcclxuICAgICAgICAgICAgfSksXHJcbiAgICAgICAgICAgIHRleHQ6IG5ldyBvbC5zdHlsZS5UZXh0KHtcclxuICAgICAgICAgICAgICAgIGZvbnQ6ICdub3JtYWwgMTNweCBMYXRvLVJlZ3VsYXInLFxyXG4gICAgICAgICAgICAgICAgZmlsbDogbmV3IG9sLnN0eWxlLkZpbGwoe1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbG9yOiAnI0ZGRkZGRidcclxuICAgICAgICAgICAgICAgIH0pLFxyXG4gICAgICAgICAgICAgICAgdGV4dDogcGFydC5nZXRJbml0aWFscygpLFxyXG4gICAgICAgICAgICAgICAgb2Zmc2V0WDogMCxcclxuICAgICAgICAgICAgICAgIG9mZnNldFk6IDBcclxuICAgICAgICAgICAgfSlcclxuICAgICAgICB9KSk7XHJcblxyXG5cclxuICAgICAgICBpZiAoaXNEaXJlY3Rpb24gJiYgcGFydC5nZXRSb3RhdGlvbigpICE9IG51bGwpXHJcbiAgICAgICAge1xyXG4gICAgICAgICAgICBzdHlsZXMucHVzaChuZXcgb2wuc3R5bGUuU3R5bGUoe1xyXG4gICAgICAgICAgICAgICAgekluZGV4OiB6SW5kZXgsXHJcbiAgICAgICAgICAgICAgICBpbWFnZTogbmV3IG9sLnN0eWxlLkljb24oKHtcclxuICAgICAgICAgICAgICAgICAgICBhbmNob3I6IFstMC41LDAuNV0sXHJcbiAgICAgICAgICAgICAgICAgICAgYW5jaG9yWFVuaXRzOiAnZnJhY3Rpb24nLFxyXG4gICAgICAgICAgICAgICAgICAgIGFuY2hvcllVbml0czogJ2ZyYWN0aW9uJyxcclxuICAgICAgICAgICAgICAgICAgICBvcGFjaXR5OiAxLFxyXG4gICAgICAgICAgICAgICAgICAgIHNyYyA6IHJlbmRlckFycm93QmFzZTY0KDQ4LDQ4LHBhcnQuY29sb3IpLFxyXG5cdFx0XHRcdFx0ICBzY2FsZSA6IDAuNTUsXHJcblx0XHRcdFx0XHQgIHJvdGF0aW9uIDogLXBhcnQuZ2V0Um90YXRpb24oKVxyXG5cdFx0XHRcdCAgIH0pKVxyXG5cdFx0XHR9KSk7XHJcblx0XHR9XHJcbiAgICAgICAgXHJcblx0XHQvKnZhciBjb2VmID0gcGFydC50cmFjay5nZXRUcmFja0xlbmd0aEluV0dTODQoKS9wYXJ0LnRyYWNrLmdldFRyYWNrTGVuZ3RoKCk7XHRcdFxyXG5cdFx0dmFyIHJyID0gQ09ORklHLm1hdGguZ3BzSW5hY2N1cmFjeSpjb2VmO1x0XHRcclxuICAgICAgICBzdHlsZXMucHVzaChuZXcgb2wuc3R5bGUuU3R5bGUoe1xyXG4gICAgICAgICAgICB6SW5kZXg6IHpJbmRleCxcclxuICAgICAgICAgICAgaW1hZ2U6IG5ldyBvbC5zdHlsZS5DaXJjbGUoe1xyXG4gICAgICAgICAgICBcdGdlb21ldHJ5OiBuZXcgb2wuZ2VvbS5Qb2ludChwYXJ0LmdldEdQUygpKSxcclxuICAgICAgICAgICAgICAgIHJhZGl1czogMTAsIC8vcnIgKiByZXNvbHV0aW9uLFxyXG4gICAgICAgICAgICAgICAgZmlsbDogbmV3IG9sLnN0eWxlLkZpbGwoe1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbG9yOiBcInJnYmEoMjU1LDI1NSwyNTUsMC44KVwiXHJcbiAgICAgICAgICAgICAgICB9KSxcclxuICAgICAgICAgICAgICAgIHN0cm9rZTogbmV3IG9sLnN0eWxlLlN0cm9rZSh7XHJcbiAgICAgICAgICAgICAgICAgICAgY29sb3I6IFwicmdiYSgwLDAsMCwxKVwiLFxyXG4gICAgICAgICAgICAgICAgICAgIHdpZHRoOiAxXHJcbiAgICAgICAgICAgICAgICB9KVxyXG4gICAgICAgICAgICB9KVxyXG4gICAgICAgIH0pKTsqL1xyXG5cdFx0cmV0dXJuIHN0eWxlcztcclxuXHR9LFxyXG5cclxuXHRcImNhbVwiIDogZnVuY3Rpb24oZmVhdHVyZSwgcmVzb2x1dGlvbikge1xyXG5cdFx0dmFyIHN0eWxlcz1bXTtcclxuXHJcblx0XHR2YXIgY2FtID0gZmVhdHVyZS5jYW07XHJcblxyXG5cdFx0c3R5bGVzLnB1c2gobmV3IG9sLnN0eWxlLlN0eWxlKHtcclxuXHRcdFx0aW1hZ2U6IG5ldyBvbC5zdHlsZS5JY29uKCh7XHJcblx0XHRcdFx0Ly8gVE9ETyBSdW1lbiAtIGl0J3MgYmV0dGVyIGFsbCBpbWFnZXMgdG8gYmUgdGhlIHNhbWUgc2l6ZSwgc28gdGhlIHNhbWUgc2NhbGVcclxuXHRcdFx0XHRzY2FsZSA6IDAuMDQwLFxyXG5cdFx0XHRcdHNyYyA6IENPTkZJRy5hcHBlYXJhbmNlLmltYWdlQ2FtLnNwbGl0KFwiLnN2Z1wiKS5qb2luKChjYW0uc2VxSWQrMSkgKyBcIi5zdmdcIilcclxuXHRcdFx0fSkpXHJcblx0XHR9KSk7XHJcblxyXG5cdFx0cmV0dXJuIHN0eWxlcztcclxuXHR9LFxyXG5cclxuICAgIFwiaG90c3BvdFwiIDogZnVuY3Rpb24oZmVhdHVyZSwgcmVzb2x1dGlvbikge1xyXG4gICAgICAgIHZhciBzdHlsZXM9W107XHJcblxyXG4gICAgICAgIHZhciBob3RzcG90ID0gZmVhdHVyZS5ob3RzcG90O1xyXG5cclxuICAgICAgICBzdHlsZXMucHVzaChuZXcgb2wuc3R5bGUuU3R5bGUoe1xyXG4gICAgICAgICAgICBpbWFnZTogbmV3IG9sLnN0eWxlLkljb24oKHtcclxuICAgICAgICAgICAgICAgIHNjYWxlIDogaG90c3BvdC5nZXRUeXBlKCkuc2NhbGUgfHwgMSxcclxuICAgICAgICAgICAgICAgIHNyYyA6IGhvdHNwb3QuZ2V0VHlwZSgpLmltYWdlXHJcbiAgICAgICAgICAgIH0pKVxyXG4gICAgICAgIH0pKTtcclxuXHJcbiAgICAgICAgcmV0dXJuIHN0eWxlcztcclxuICAgIH0sXHJcblxyXG5cdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0Ly8gUHJpdmF0ZSBtZXRob2RzXHJcblx0Ly8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHJcblx0X3RyYWNrU2VsZWN0ZWQgOiBuZXcgb2wuc3R5bGUuU3R5bGUoe1xyXG5cdFx0c3Ryb2tlOiBuZXcgb2wuc3R5bGUuU3Ryb2tlKHtcclxuXHRcdFx0Y29sb3I6ICcjRkY1MDUwJyxcclxuXHRcdFx0d2lkdGg6IDQuNVxyXG5cdFx0fSlcclxuXHR9KSxcclxuXHJcblx0X2dlbkNoZWNrcG9pbnQgOiBmdW5jdGlvbihnZW9tZXRyeSwgY29sb3IsIHN0eWxlcykge1xyXG5cdFx0dmFyIHN0YXJ0ID0gZ2VvbWV0cnlbMF07XHJcblx0XHR2YXIgZW5kID0gZ2VvbWV0cnlbMV07XHJcblx0XHR2YXIgZHggPSBlbmRbMF0gLSBzdGFydFswXTtcclxuXHRcdHZhciBkeSA9IGVuZFsxXSAtIHN0YXJ0WzFdO1xyXG5cdFx0dmFyIHJvdGF0aW9uID0gTWF0aC5hdGFuMihkeSwgZHgpO1xyXG5cclxuXHRcdHN0eWxlcy5wdXNoKG5ldyBvbC5zdHlsZS5TdHlsZSh7XHJcblx0XHRcdGdlb21ldHJ5OiBuZXcgb2wuZ2VvbS5Qb2ludChzdGFydCksXHJcblx0XHRcdGltYWdlOiBuZXcgb2wuc3R5bGUuSWNvbih7XHJcblx0XHRcdFx0c3JjOiByZW5kZXJCb3hCYXNlNjQoMTYsMTYsY29sb3IpLFxyXG5cdFx0XHRcdHNjYWxlIDogMSxcclxuXHRcdFx0XHRhbmNob3I6IFswLjkyLCAwLjVdLFxyXG5cdFx0XHRcdHJvdGF0ZVdpdGhWaWV3OiB0cnVlLFxyXG5cdFx0XHRcdHJvdGF0aW9uOiAtcm90YXRpb24sXHJcblx0XHRcdFx0b3BhY2l0eSA6IDAuNjVcclxuXHRcdFx0fSlcclxuXHRcdH0pKTtcclxuXHR9LFxyXG5cclxuXHRfZ2VuQ2hlY2twb2ludEltYWdlIDogZnVuY3Rpb24oZ2VvbWV0cnksIGltYWdlLCBzdHlsZXMpIHtcclxuXHRcdHZhciBzdGFydCA9IGdlb21ldHJ5WzBdO1xyXG5cdFx0Ly92YXIgZW5kID0gZ2VvbWV0cnlbMV07XHJcblx0XHQvL3ZhciBkeCA9IGVuZFswXSAtIHN0YXJ0WzBdO1xyXG5cdFx0Ly92YXIgZHkgPSBlbmRbMV0gLSBzdGFydFsxXTtcclxuXHRcdC8vdmFyIHJvdGF0aW9uID0gTWF0aC5hdGFuMihkeSwgZHgpO1xyXG5cclxuXHRcdHN0eWxlcy5wdXNoKG5ldyBvbC5zdHlsZS5TdHlsZSh7XHJcblx0XHRcdGdlb21ldHJ5OiBuZXcgb2wuZ2VvbS5Qb2ludChzdGFydCksXHJcblx0XHRcdGltYWdlOiBuZXcgb2wuc3R5bGUuSWNvbih7XHJcblx0XHRcdFx0c3JjOiBpbWFnZSxcclxuXHRcdFx0XHQvL3NjYWxlIDogMC42NSxcclxuXHRcdFx0XHRhbmNob3I6IFswLjUsIDAuNV0sXHJcblx0XHRcdFx0cm90YXRlV2l0aFZpZXc6IHRydWUsXHJcblx0XHRcdFx0Ly9yb3RhdGlvbjogLXJvdGF0aW9uLFxyXG5cdFx0XHRcdG9wYWNpdHkgOiAxXHJcblx0XHRcdH0pXHJcblx0XHR9KSk7XHJcblx0fSxcclxuXHJcblx0X2dlbkRpcmVjdGlvbiA6IGZ1bmN0aW9uKHB0cywgd3csIHJlc29sdXRpb24sIGNvbG9yLCBzdHlsZXMpIHtcclxuICAgICAgICBpZiAoQ09ORklHLmFwcGVhcmFuY2UuZGlyZWN0aW9uSWNvbkJldHdlZW4gPD0gMCkge1xyXG4gICAgICAgICAgICAvLyB0aGlzIG1lYW5zIG5vIG5lZWQgdG8gc2hvdyB0aGUgZGlyZWN0aW9uc1xyXG4gICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICB2YXIgY250ID0gMDtcclxuICAgICAgICB2YXIgaWNuID0gcmVuZGVyRGlyZWN0aW9uQmFzZTY0KDE2LCAxNiwgY29sb3IpO1xyXG4gICAgICAgIHZhciByZXMgPSAwLjA7XHJcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBwdHMubGVuZ3RoIC0gMTsgaSsrKSB7XHJcbiAgICAgICAgICAgIHZhciBzdGFydCA9IHB0c1tpICsgMV07XHJcbiAgICAgICAgICAgIHZhciBlbmQgPSBwdHNbaV07XHJcbiAgICAgICAgICAgIHZhciBkeCA9IGVuZFswXSAtIHN0YXJ0WzBdO1xyXG4gICAgICAgICAgICB2YXIgZHkgPSBlbmRbMV0gLSBzdGFydFsxXTtcclxuICAgICAgICAgICAgdmFyIGxlbiA9IE1hdGguc3FydChkeCAqIGR4ICsgZHkgKiBkeSkgLyByZXNvbHV0aW9uO1xyXG4gICAgICAgICAgICByZXMgKz0gbGVuO1xyXG4gICAgICAgICAgICBpZiAoaSA9PSAwIHx8IHJlcyA+PSBDT05GSUcuYXBwZWFyYW5jZS5kaXJlY3Rpb25JY29uQmV0d2Vlbikge1xyXG4gICAgICAgICAgICAgICAgcmVzID0gMDtcclxuICAgICAgICAgICAgICAgIHZhciByb3RhdGlvbiA9IE1hdGguYXRhbjIoZHksIGR4KTtcclxuICAgICAgICAgICAgICAgIHN0eWxlcy5wdXNoKG5ldyBvbC5zdHlsZS5TdHlsZSh7XHJcbiAgICAgICAgICAgICAgICAgICAgZ2VvbWV0cnk6IG5ldyBvbC5nZW9tLlBvaW50KFsoc3RhcnRbMF0gKyBlbmRbMF0pIC8gMiwgKHN0YXJ0WzFdICsgZW5kWzFdKSAvIDJdKSxcclxuICAgICAgICAgICAgICAgICAgICBpbWFnZTogbmV3IG9sLnN0eWxlLkljb24oe1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBzcmM6IGljbixcclxuICAgICAgICAgICAgICAgICAgICAgICAgc2NhbGU6IHd3IC8gMTIuMCxcclxuICAgICAgICAgICAgICAgICAgICAgICAgYW5jaG9yOiBbMC41LCAwLjVdLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICByb3RhdGVXaXRoVmlldzogdHJ1ZSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgcm90YXRpb246IC1yb3RhdGlvbiArIE1hdGguUEksIC8vIGFkZCAxODAgZGVncmVlc1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBvcGFjaXR5OiAxXHJcbiAgICAgICAgICAgICAgICAgICAgfSlcclxuICAgICAgICAgICAgICAgIH0pKTtcclxuICAgICAgICAgICAgICAgIGNudCsrO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgfSxcclxuXHJcbiAgICBfZ2VuRGlzdGFuY2VLbSA6IGZ1bmN0aW9uKHd3LCByZXNvbHV0aW9uLFxyXG5cdFx0XHRcdFx0XHRcdCAgY29vcmRzLCBkaXN0YW5jZXMsIHN0YXJ0RGlzdEluZGV4LCBlbmREaXN0SW5kZXgsXHJcblx0XHRcdFx0XHRcdFx0ICBzdHlsZXMpIHtcclxuICAgICAgICAvLyBUT0RPIFJ1bWVuIC0gc3RpbGwgbm90IHJlYWR5IC0gZm9yIG5vdyBzdGF0aWMgaG90c3BvdHMgYXJlIHVzZWRcclxuICAgICAgICBpZiAodHJ1ZSkge3JldHVybjt9XHJcblxyXG4gICAgICAgIHZhciBob3RzcG90c0ttID0gWzIwLCA0MCwgNjAsIDgwLCAxMDAsIDEyMCwgMTQwLCAxNjAsIDE4MF07XHJcblxyXG4gICAgICAgIGZ1bmN0aW9uIGFkZEhvdFNwb3RLTShrbSwgcG9pbnQpIHtcclxuICAgICAgICAgICAgLy92YXIgZHggPSBlbmRbMF0gLSBzdGFydFswXTtcclxuICAgICAgICAgICAgLy92YXIgZHkgPSBlbmRbMV0gLSBzdGFydFsxXTtcclxuICAgICAgICAgICAgLy92YXIgcm90YXRpb24gPSBNYXRoLmF0YW4yKGR5LCBkeCk7XHJcbiAgICAgICAgICAgIHN0eWxlcy5wdXNoKG5ldyBvbC5zdHlsZS5TdHlsZSh7XHJcbiAgICAgICAgICAgICAgICAvL2dlb21ldHJ5OiBuZXcgb2wuZ2VvbS5Qb2ludChbKHN0YXJ0WzBdK2VuZFswXSkvMiwoc3RhcnRbMV0rZW5kWzFdKS8yXSksXHJcbiAgICAgICAgICAgICAgICBnZW9tZXRyeTogbmV3IG9sLmdlb20uUG9pbnQoW3BvaW50WzBdLCBwb2ludFsxXV0pLFxyXG4gICAgICAgICAgICAgICAgaW1hZ2U6IG5ldyBvbC5zdHlsZS5JY29uKHtcclxuICAgICAgICAgICAgICAgICAgICBzcmM6IFwiaW1nL1wiICsga20gKyBcImttLnN2Z1wiLFxyXG4gICAgICAgICAgICAgICAgICAgIHNjYWxlOiAxLjUsXHJcbiAgICAgICAgICAgICAgICAgICAgcm90YXRlV2l0aFZpZXc6IHRydWUsXHJcbiAgICAgICAgICAgICAgICAgICAgLy9yb3RhdGlvbjogLXJvdGF0aW9uICsgTWF0aC5QSS8yLCAvLyBhZGQgMTgwIGRlZ3JlZXNcclxuICAgICAgICAgICAgICAgICAgICBvcGFjaXR5IDogMVxyXG4gICAgICAgICAgICAgICAgfSlcclxuICAgICAgICAgICAgfSkpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgZm9yICh2YXIgaSA9IHN0YXJ0RGlzdEluZGV4OyBpIDwgZW5kRGlzdEluZGV4OyBpKyspIHtcclxuICAgICAgICAgICAgaWYgKCFob3RzcG90c0ttLmxlbmd0aCkge1xyXG5cdFx0XHRcdHJldHVybjtcclxuXHRcdFx0fVxyXG5cclxuXHRcdFx0dmFyIGRpc3QgPSBkaXN0YW5jZXNbaV07XHJcblxyXG5cdFx0XHRpZiAoZGlzdCA+PSBob3RzcG90c0ttWzBdKjEwMDApIHtcclxuXHRcdFx0XHQvLyBkcmF3IHRoZSBmaXJzdCBob3RzcG90IGFuZCBhbnkgbmV4dCBpZiBpdCdzIGNvbnRhaW5lZCBpbiB0aGUgc2FtZSBcImRpc3RhbmNlXCJcclxuXHRcdFx0XHR2YXIgcmVtb3ZlSG90c3BvdEttID0gMDtcclxuXHRcdFx0XHRmb3IgKHZhciBrID0gMCwgbGVuSG90c3BvdHNLbSA9IGhvdHNwb3RzS20ubGVuZ3RoOyBrIDwgbGVuSG90c3BvdHNLbTsgaysrKSB7XHJcblx0XHRcdFx0XHRpZiAoZGlzdCA+PSBob3RzcG90c0ttW2tdKjEwMDApIHtcclxuXHRcdFx0XHRcdFx0YWRkSG90U3BvdEtNKGhvdHNwb3RzS21ba10sIGNvb3Jkc1tpXSk7XHJcblx0XHRcdFx0XHRcdHJlbW92ZUhvdHNwb3RLbSsrO1xyXG5cdFx0XHRcdFx0fSBlbHNlIHtcclxuXHRcdFx0XHRcdFx0YnJlYWs7XHJcblx0XHRcdFx0XHR9XHJcblx0XHRcdFx0fVxyXG5cdFx0XHRcdC8vIHJlbW92ZSBhbGwgdGhlIGFscmVhZHkgZHJhd24gaG90c3BvdHNcclxuXHRcdFx0XHRmb3IgKHZhciBqID0gMDsgaiA8cmVtb3ZlSG90c3BvdEttOyBqKyspIGhvdHNwb3RzS20uc2hpZnQoKTtcclxuXHRcdFx0fVxyXG4gICAgICAgIH1cclxuICAgIH1cclxufTtcclxuXHJcbmZvciAodmFyIGkgaW4gU1RZTEVTKVxyXG5cdGV4cG9ydHNbaV09U1RZTEVTW2ldO1xyXG4iLCJyZXF1aXJlKCdqb29zZScpO1xyXG5yZXF1aXJlKCcuL1BhcnRpY2lwYW50Jyk7XHJcblxyXG52YXIgcmJ1c2ggPSByZXF1aXJlKCdyYnVzaCcpO1xyXG52YXIgQ09ORklHID0gcmVxdWlyZSgnLi9Db25maWcnKTtcclxudmFyIFdHUzg0U1BIRVJFID0gcmVxdWlyZSgnLi9VdGlscycpLldHUzg0U1BIRVJFO1xyXG5cclxuQ2xhc3MoXCJUcmFja1wiLCBcclxue1x0XHJcbiAgICAvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0Ly8gQUxMIENPT1JESU5BVEVTIEFSRSBJTiBXT1JMRCBNRVJDQVRPUlxyXG4gICAgLy8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG4gICAgaGFzOiBcclxuXHR7XHJcbiAgICAgICAgcm91dGUgOiB7XHJcbiAgICAgICAgICAgIGlzOiAgIFwicndcIlxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgZGlzdGFuY2VzIDoge1xyXG4gICAgICAgICAgICBpczogICBcInJ3XCJcclxuICAgICAgICB9LFxyXG4gICAgICAgIGRpc3RhbmNlc0VsYXBzZWQgOiB7XHJcbiAgICAgICAgICAgIGlzOiAgIFwicndcIlxyXG4gICAgICAgIH0sXHJcblx0XHR0b3RhbExlbmd0aCA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCJcclxuXHRcdH0sXHJcblx0XHRwYXJ0aWNpcGFudHMgOiB7XHJcblx0XHRcdGlzOiAgIFwicndcIixcclxuXHRcdFx0aW5pdCA6IFtdXHJcblx0XHR9LFxyXG5cdFx0Y2Ftc0NvdW50IDoge1xyXG5cdFx0XHRpczogICBcInJ3XCIsXHJcblx0XHRcdGluaXQ6IDBcclxuXHRcdH0sXHJcblx0XHQvLyBpbiBFUFNHIDM4NTdcclxuXHRcdGZlYXR1cmUgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogbnVsbFx0XHRcclxuXHRcdH0sXHJcblx0XHRpc0RpcmVjdGlvbkNvbnN0cmFpbnQgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogZmFsc2VcclxuXHRcdH0sXHJcblx0XHRcclxuXHRcdGRlYnVnUGFydGljaXBhbnQgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogbnVsbFxyXG5cdFx0fSxcclxuXHRcdGJpa2VTdGFydEtNIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IG51bGxcclxuXHRcdH0sXHJcblx0XHRydW5TdGFydEtNIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IG51bGxcclxuXHRcdH0sXHJcblx0XHRsYXBzIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IDFcclxuXHRcdH0sXHJcblx0XHR0b3RhbFBhcnRpY2lwYW50cyA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiA1MFxyXG5cdFx0fSxcclxuXHRcdHJUcmVlIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IHJidXNoKDEwKVxyXG5cdFx0fSxcclxuXHJcblx0XHRpc0FkZGVkSG90U3BvdFN3aW1CaWtlIDoge1xyXG5cdFx0XHRpbml0IDogZmFsc2VcclxuXHRcdH0sXHJcblx0XHRpc0FkZGVkSG90U3BvdEJpa2VSdW4gOiB7XHJcblx0XHRcdGluaXQgOiBmYWxzZVxyXG5cdFx0fVxyXG4gICAgfSxcclxuICAgIC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRtZXRob2RzOiBcclxuXHR7XHRcdFxyXG5cdFx0c2V0Um91dGUgOiBmdW5jdGlvbih2YWwpIHtcclxuXHRcdFx0dGhpcy5yb3V0ZT12YWw7XHJcblx0XHRcdGRlbGV0ZSB0aGlzLl9sZW50bXAxO1xyXG5cdFx0XHRkZWxldGUgdGhpcy5fbGVudG1wMjtcclxuXHRcdH0sXHJcblx0XHRcclxuXHRcdGdldEJvdW5kaW5nQm94IDogZnVuY3Rpb24oKSB7XHJcblx0XHRcdHZhciBtaW54PW51bGwsbWlueT1udWxsLG1heHg9bnVsbCxtYXh5PW51bGw7XHJcblx0XHRcdGZvciAodmFyIGk9MDtpPHRoaXMucm91dGUubGVuZ3RoO2krKylcclxuXHRcdFx0e1xyXG5cdFx0XHRcdHZhciBwPXRoaXMucm91dGVbaV07XHJcblx0XHRcdFx0aWYgKG1pbnggPT0gbnVsbCB8fCBwWzBdIDwgbWlueCkgbWlueD1wWzBdO1xyXG5cdFx0XHRcdGlmIChtYXh4ID09IG51bGwgfHwgcFswXSA+IG1heHgpIG1heHg9cFswXTtcclxuXHRcdFx0XHRpZiAobWlueSA9PSBudWxsIHx8IHBbMV0gPCBtaW55KSBtaW55PXBbMV07XHJcblx0XHRcdFx0aWYgKG1heHkgPT0gbnVsbCB8fCBwWzFdID4gbWF4eSkgbWF4eT1wWzFdO1xyXG5cdFx0XHR9XHJcblx0XHRcdHJldHVybiBbbWlueCxtaW55LG1heHgsbWF4eV07XHJcblx0XHR9LFxyXG5cdFx0XHJcblx0XHQvLyBDQUxMIE9OTFkgT05DRSBPTiBJTklUXHJcblx0XHRnZXRFbGFwc2VkRnJvbVBvaW50IDogZnVuY3Rpb24ocG9pbnQsc3RhcnQpIFxyXG5cdFx0e1xyXG5cdFx0XHR2YXIgcmVzPTAuMDtcclxuXHRcdFx0dmFyIGJyaz1mYWxzZTtcclxuXHRcdFx0dmFyIGNjID0gdGhpcy5yb3V0ZTtcclxuXHRcdFx0aWYgKCFzdGFydClcclxuXHRcdFx0XHRzdGFydD0wO1xyXG5cdFx0XHRmb3IgKHZhciBpPXN0YXJ0O2k8Y2MubGVuZ3RoLTE7aSsrKSBcclxuXHRcdFx0e1xyXG5cdFx0XHRcdHZhciBhID0gY2NbaV07XHJcblx0XHRcdFx0dmFyIGMgPSBjY1tpKzFdO1xyXG5cdFx0XHRcdHZhciBiID0gcG9pbnQ7XHJcblx0XHRcdFx0dmFyIGFjID0gTWF0aC5zcXJ0KChhWzBdLWNbMF0pKihhWzBdLWNbMF0pKyhhWzFdLWNbMV0pKihhWzFdLWNbMV0pKTtcclxuXHRcdFx0XHR2YXIgYmEgPSBNYXRoLnNxcnQoKGJbMF0tYVswXSkqKGJbMF0tYVswXSkrKGJbMV0tYVsxXSkqKGJbMV0tYVsxXSkpO1xyXG5cdFx0XHRcdHZhciBiYyA9IE1hdGguc3FydCgoYlswXS1jWzBdKSooYlswXS1jWzBdKSsoYlsxXS1jWzFdKSooYlsxXS1jWzFdKSk7XHJcblx0XHRcdFx0XHJcblx0XHRcdFx0dmFyIG1pbnggPSBhWzBdIDwgYlswXSA/IGFbMF0gOiBiWzBdO1xyXG5cdFx0XHRcdHZhciBtaW55ID0gYVsxXSA8IGJbMV0gPyBhWzFdIDogYlsxXTtcclxuXHRcdFx0XHR2YXIgbWF4eCA9IGFbMF0gPiBiWzBdID8gYVswXSA6IGJbMF07XHJcblx0XHRcdFx0dmFyIG1heHkgPSBhWzFdID4gYlsxXSA/IGFbMV0gOiBiWzFdO1xyXG5cdFx0XHRcdC8vIGJhID4gYWMgT1IgYmMgPiBhY1xyXG5cdFx0XHRcdGlmIChiWzBdIDwgbWlueCB8fCBiWzBdID4gbWF4eCB8fCBiWzFdIDwgbWlueSB8fCBiWzFdID4gbWF4eSB8fCBiYSA+IGFjIHx8IGJjID4gYWMpIFxyXG5cdFx0XHRcdHtcclxuXHRcdFx0XHRcdHJlcys9V0dTODRTUEhFUkUuaGF2ZXJzaW5lRGlzdGFuY2UoYSxjKTtcclxuXHRcdFx0XHRcdGNvbnRpbnVlO1xyXG5cdFx0XHRcdH1cclxuXHRcdFx0XHRyZXMrPVdHUzg0U1BIRVJFLmhhdmVyc2luZURpc3RhbmNlKGEsYik7XHJcblx0XHRcdFx0YnJlYWs7XHJcblx0XHRcdH1cclxuXHRcdFx0dmFyIGxlbiA9IHRoaXMuZ2V0VHJhY2tMZW5ndGgoKTtcclxuXHRcdFx0cmV0dXJuIHJlcy9sZW47XHJcblx0XHR9LFxyXG5cdFx0XHJcblx0XHQvLyBlbGFwc2VkIGZyb20gMC4uMVxyXG5cdFx0Z2V0UG9zaXRpb25BbmRSb3RhdGlvbkZyb21FbGFwc2VkIDogZnVuY3Rpb24oZWxhcHNlZCkge1xyXG5cdFx0XHR2YXIgcnI9bnVsbDtcclxuXHRcdFx0dmFyIGNjID0gdGhpcy5yb3V0ZTtcclxuXHRcdFx0XHJcblx0XHRcdHZhciBsbCA9IHRoaXMuZGlzdGFuY2VzRWxhcHNlZC5sZW5ndGgtMTtcclxuXHRcdFx0dmFyIHNpID0gMDtcclxuXHJcblx0XHRcdC8vIFRPRE8gRklYIE1FIFxyXG5cdFx0XHR3aGlsZSAoc2kgPCBsbCAmJiBzaSs1MDAgPCBsbCAmJiB0aGlzLmRpc3RhbmNlc0VsYXBzZWRbc2krNTAwXSA8IGVsYXBzZWQgKSB7XHJcblx0XHRcdFx0c2krPTUwMDtcclxuXHRcdFx0fVxyXG5cdFx0XHRcclxuXHRcdFx0d2hpbGUgKHNpIDwgbGwgJiYgc2krMjUwIDwgbGwgJiYgdGhpcy5kaXN0YW5jZXNFbGFwc2VkW3NpKzI1MF0gPCBlbGFwc2VkICkge1xyXG5cdFx0XHRcdHNpKz0yNTA7XHJcblx0XHRcdH1cclxuXHRcdFx0XHJcblx0XHRcdHdoaWxlIChzaSA8IGxsICYmIHNpKzEyNSA8IGxsICYmIHRoaXMuZGlzdGFuY2VzRWxhcHNlZFtzaSsxMjVdIDwgZWxhcHNlZCApIHtcclxuXHRcdFx0XHRzaSs9MTI1O1xyXG5cdFx0XHR9XHJcblxyXG5cdFx0XHR3aGlsZSAoc2kgPCBsbCAmJiBzaSs1MCA8IGxsICYmIHRoaXMuZGlzdGFuY2VzRWxhcHNlZFtzaSs1MF0gPCBlbGFwc2VkICkge1xyXG5cdFx0XHRcdHNpKz01MDtcclxuXHRcdFx0fVxyXG5cdFx0XHRcclxuXHRcdFx0Zm9yICh2YXIgaT1zaTtpPGxsO2krKykgXHJcblx0XHRcdHtcclxuXHRcdFx0XHQvKmRvIFxyXG5cdFx0XHRcdHtcclxuXHRcdFx0XHRcdHZhciBtID0gKChjYy5sZW5ndGgtMStpKSA+PiAxKTtcclxuXHRcdFx0XHRcdGlmIChtLWkgPiA1ICYmIGVsYXBzZWQgPCB0aGlzLmRpc3RhbmNlc0VsYXBzZWRbbV0pIHtcclxuXHRcdFx0XHRcdFx0aT1tO1xyXG5cdFx0XHRcdFx0XHRjb250aW51ZTtcclxuXHRcdFx0XHRcdH1cclxuXHRcdFx0XHRcdGJyZWFrO1xyXG5cdFx0XHRcdH0gd2hpbGUgKHRydWUpOyovXHJcblx0XHRcdFx0aWYgKGVsYXBzZWQgPj0gdGhpcy5kaXN0YW5jZXNFbGFwc2VkW2ldICYmIGVsYXBzZWQgPD0gdGhpcy5kaXN0YW5jZXNFbGFwc2VkW2krMV0pIFxyXG5cdFx0XHRcdHtcclxuXHRcdFx0XHRcdGVsYXBzZWQtPXRoaXMuZGlzdGFuY2VzRWxhcHNlZFtpXTtcclxuXHRcdFx0XHRcdHZhciBhYz10aGlzLmRpc3RhbmNlc0VsYXBzZWRbaSsxXS10aGlzLmRpc3RhbmNlc0VsYXBzZWRbaV07XHJcblx0XHRcdFx0XHR2YXIgYSA9IGNjW2ldO1xyXG5cdFx0XHRcdFx0dmFyIGMgPSBjY1tpKzFdO1xyXG5cdFx0XHRcdFx0dmFyIGR4ID0gY1swXSAtIGFbMF07XHJcblx0XHRcdFx0XHR2YXIgZHkgPSBjWzFdIC0gYVsxXTtcclxuXHRcdFx0XHRcdHJyPVsgYVswXSsoY1swXS1hWzBdKSplbGFwc2VkL2FjLGFbMV0rKGNbMV0tYVsxXSkqZWxhcHNlZC9hYyxNYXRoLmF0YW4yKGR5LCBkeCldO1xyXG5cdFx0XHRcdFx0YnJlYWs7XHJcblx0XHRcdFx0fVxyXG5cdFx0XHR9XHJcblx0XHRcdHJldHVybiBycjtcclxuXHRcdH0sXHJcblx0XHRcclxuXHRcdF9fZ2V0UG9zaXRpb25BbmRSb3RhdGlvbkZyb21FbGFwc2VkIDogZnVuY3Rpb24oZWxhcHNlZCkge1xyXG5cdFx0XHRlbGFwc2VkKj10aGlzLmdldFRyYWNrTGVuZ3RoKCk7XHJcblx0XHRcdHZhciBycj1udWxsO1xyXG5cdFx0XHR2YXIgY2MgPSB0aGlzLnJvdXRlO1xyXG5cdFx0XHRmb3IgKHZhciBpPTA7aTxjYy5sZW5ndGgtMTtpKyspIFxyXG5cdFx0XHR7XHJcblx0XHRcdFx0dmFyIGEgPSBjY1tpXTtcclxuXHRcdFx0XHR2YXIgYyA9IGNjW2krMV07XHJcblx0XHRcdFx0dmFyIGFjID0gV0dTODRTUEhFUkUuaGF2ZXJzaW5lRGlzdGFuY2UoYSxjKTtcclxuXHRcdFx0XHRpZiAoZWxhcHNlZCA8PSBhYykge1xyXG5cdFx0XHRcdFx0dmFyIGR4ID0gY1swXSAtIGFbMF07XHJcblx0XHRcdFx0XHR2YXIgZHkgPSBjWzFdIC0gYVsxXTtcclxuXHRcdFx0XHRcdHJyPVsgYVswXSsoY1swXS1hWzBdKSplbGFwc2VkL2FjLGFbMV0rKGNbMV0tYVsxXSkqZWxhcHNlZC9hYyxNYXRoLmF0YW4yKGR5LCBkeCldO1xyXG5cdFx0XHRcdFx0YnJlYWs7XHJcblx0XHRcdFx0fVxyXG5cdFx0XHRcdGVsYXBzZWQtPWFjO1xyXG5cdFx0XHR9XHJcblx0XHRcdHJldHVybiBycjtcclxuXHRcdH0sXHJcblxyXG5cdFx0XHJcblx0XHRnZXRUcmFja0xlbmd0aCA6IGZ1bmN0aW9uKCkge1xyXG5cdFx0XHRpZiAodGhpcy5fbGVudG1wMSlcclxuXHRcdFx0XHRyZXR1cm4gdGhpcy5fbGVudG1wMTtcclxuXHRcdFx0dmFyIHJlcz0wLjA7XHJcblx0XHRcdHZhciBjYyA9IHRoaXMucm91dGU7XHJcblx0XHRcdGZvciAodmFyIGk9MDtpPGNjLmxlbmd0aC0xO2krKykgXHJcblx0XHRcdHtcclxuXHRcdFx0XHR2YXIgYSA9IGNjW2ldO1xyXG5cdFx0XHRcdHZhciBiID0gY2NbaSsxXTtcclxuXHRcdFx0XHR2YXIgZCA9IFdHUzg0U1BIRVJFLmhhdmVyc2luZURpc3RhbmNlKGEsYik7XHJcblx0XHRcdFx0aWYgKCFpc05hTihkKSAmJiBkID4gMCkgXHJcblx0XHRcdFx0XHRyZXMrPWQ7XHJcblx0XHRcdH1cclxuXHRcdFx0dGhpcy5fbGVudG1wMT1yZXM7XHJcblx0XHRcdHJldHVybiByZXM7XHJcblx0XHR9LFxyXG5cclxuXHRcdGdldFRyYWNrTGVuZ3RoSW5XR1M4NCA6IGZ1bmN0aW9uKCkge1xyXG5cdFx0XHRpZiAodGhpcy5fbGVudG1wMilcclxuXHRcdFx0XHRyZXR1cm4gdGhpcy5fbGVudG1wMjtcclxuXHRcdFx0dmFyIHJlcz0wLjA7XHJcblx0XHRcdHZhciBjYyA9IHRoaXMucm91dGU7XHJcblx0XHRcdGZvciAodmFyIGk9MDtpPGNjLmxlbmd0aC0xO2krKykgXHJcblx0XHRcdHtcclxuXHRcdFx0XHR2YXIgYSA9IGNjW2ldO1xyXG5cdFx0XHRcdHZhciBiID0gY2NbaSsxXTtcclxuXHRcdFx0XHR2YXIgZCA9IE1hdGguc3FydCgoYVswXS1iWzBdKSooYVswXS1iWzBdKSsoYVsxXS1iWzFdKSooYVsxXS1iWzFdKSk7XHJcblx0XHRcdFx0aWYgKCFpc05hTihkKSAmJiBkID4gMCkgXHJcblx0XHRcdFx0XHRyZXMrPWQ7XHJcblx0XHRcdH1cclxuXHRcdFx0dGhpcy5fbGVudG1wMj1yZXM7XHJcblx0XHRcdHJldHVybiByZXM7XHJcblx0XHR9LFxyXG5cclxuXHRcdGdldENlbnRlciA6IGZ1bmN0aW9uKCkge1xyXG5cdFx0XHR2YXIgYmIgPSB0aGlzLmdldEJvdW5kaW5nQm94KCk7XHJcblx0XHRcdHJldHVybiBbKGJiWzBdK2JiWzJdKS8yLjAsKGJiWzFdK2JiWzNdKS8yLjBdO1xyXG5cdFx0fSxcclxuXHRcdFxyXG5cdFx0aW5pdCA6IGZ1bmN0aW9uKCkgXHJcblx0XHR7XHJcblx0XHRcdGlmICghdGhpcy5yb3V0ZSlcclxuXHRcdFx0XHRyZXR1cm47XHJcblx0XHRcdC8vIDEpIGNhbGN1bGF0ZSB0b3RhbCByb3V0ZSBsZW5ndGggaW4gS00gXHJcblx0XHRcdHRoaXMudXBkYXRlRmVhdHVyZSgpO1xyXG5cdFx0XHRpZiAodHlwZW9mIHdpbmRvdyAhPSBcInVuZGVmaW5lZFwiKSBcclxuXHRcdFx0XHRHVUkubWFwLmdldFZpZXcoKS5maXRFeHRlbnQodGhpcy5mZWF0dXJlLmdldEdlb21ldHJ5KCkuZ2V0RXh0ZW50KCksIEdVSS5tYXAuZ2V0U2l6ZSgpKTtcclxuXHRcdH0sXHJcblx0XHRcclxuXHRcdGdldFRyYWNrUGFydCA6IGZ1bmN0aW9uKGVsYXBzZWQpIHtcclxuXHRcdFx0dmFyIGxlbiA9IHRoaXMuZ2V0VHJhY2tMZW5ndGgoKTtcclxuXHRcdFx0dmFyIGVtID0gKGVsYXBzZWQlMS4wKSpsZW47XHJcblx0XHRcdGlmIChlbSA+PSB0aGlzLnJ1blN0YXJ0S00qMTAwMCkgXHJcblx0XHRcdFx0cmV0dXJuIDI7XHJcblx0XHRcdGlmIChlbSA+PSB0aGlzLmJpa2VTdGFydEtNKjEwMDApIFxyXG5cdFx0XHRcdHJldHVybiAxO1xyXG5cdFx0XHRyZXR1cm4gMDtcclxuXHRcdH0sXHJcblx0XHRcclxuXHRcdHVwZGF0ZUZlYXR1cmUgOiBmdW5jdGlvbigpIFxyXG5cdFx0e1xyXG5cdFx0XHR0aGlzLmRpc3RhbmNlcz1bXTtcclxuXHRcdFx0dmFyIHJlcz0wLjA7XHJcblx0XHRcdHZhciBjYyA9IHRoaXMucm91dGU7XHJcblx0XHRcdGZvciAodmFyIGk9MDtpPGNjLmxlbmd0aC0xO2krKykgXHJcblx0XHRcdHtcclxuXHRcdFx0XHR2YXIgYSA9IGNjW2ldO1xyXG5cdFx0XHRcdHZhciBiID0gY2NbaSsxXTtcclxuXHRcdFx0XHR2YXIgZCA9IFdHUzg0U1BIRVJFLmhhdmVyc2luZURpc3RhbmNlKGEsYik7XHJcblx0XHRcdFx0dGhpcy5kaXN0YW5jZXMucHVzaChyZXMpO1xyXG5cdFx0XHRcdGlmICghaXNOYU4oZCkgJiYgZCA+IDApIFxyXG5cdFx0XHRcdFx0cmVzKz1kO1xyXG5cdFx0XHR9XHJcblx0XHRcdHRoaXMuZGlzdGFuY2VzLnB1c2gocmVzKTtcclxuXHRcdFx0dGhpcy5kaXN0YW5jZXNFbGFwc2VkPVtdO1xyXG5cdFx0XHR2YXIgdGwgPSB0aGlzLmdldFRyYWNrTGVuZ3RoKCk7XHJcblx0XHRcdGZvciAodmFyIGk9MDtpPGNjLmxlbmd0aDtpKyspIHtcclxuXHRcdFx0XHR0aGlzLmRpc3RhbmNlc0VsYXBzZWQucHVzaCh0aGlzLmRpc3RhbmNlc1tpXS90bCk7XHJcblx0XHRcdH1cclxuXHRcdFx0Ly8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdFx0XHR0aGlzLnJUcmVlLmNsZWFyKCk7XHJcblx0XHRcdHZhciBhcnIgPSBbXTtcclxuXHRcdFx0Zm9yICh2YXIgaT0wO2k8dGhpcy5yb3V0ZS5sZW5ndGgtMTtpKyspIFxyXG5cdFx0XHR7XHJcblx0XHRcdFx0dmFyIHgxID0gdGhpcy5yb3V0ZVtpXVswXTtcclxuXHRcdFx0XHR2YXIgeTEgPSB0aGlzLnJvdXRlW2ldWzFdO1xyXG5cdFx0XHRcdHZhciB4MiA9IHRoaXMucm91dGVbaSsxXVswXTtcclxuXHRcdFx0XHR2YXIgeTIgPSB0aGlzLnJvdXRlW2krMV1bMV07XHJcblx0XHRcdFx0dmFyIG1pbnggPSB4MSA8IHgyID8geDEgOiB4MjtcclxuXHRcdFx0XHR2YXIgbWlueSA9IHkxIDwgeTIgPyB5MSA6IHkyO1xyXG5cdFx0XHRcdHZhciBtYXh4ID0geDEgPiB4MiA/IHgxIDogeDI7XHJcblx0XHRcdFx0dmFyIG1heHkgPSB5MSA+IHkyID8geTEgOiB5MjtcclxuXHRcdFx0XHRhcnIucHVzaChbbWlueCxtaW55LG1heHgsbWF4eSx7IGluZGV4IDogaSB9XSk7XHJcblx0XHRcdH1cclxuXHRcdFx0dGhpcy5yVHJlZS5sb2FkKGFycik7XHJcblx0XHRcdC8vLS0tLS0tLS0tLS0tLS0tLS0gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0XHRcdGlmICh0eXBlb2Ygd2luZG93ICE9IFwidW5kZWZpbmVkXCIpIFxyXG5cdFx0XHR7XHJcblx0XHRcdFx0dmFyIHdrdCA9IFtdO1xyXG5cdFx0XHRcdGZvciAodmFyIGk9MDtpPHRoaXMucm91dGUubGVuZ3RoO2krKykge1xyXG5cdFx0XHRcdFx0d2t0LnB1c2godGhpcy5yb3V0ZVtpXVswXStcIiBcIit0aGlzLnJvdXRlW2ldWzFdKTtcclxuXHRcdFx0XHR9XHJcblx0XHRcdFx0d2t0PVwiTElORVNUUklORyhcIit3a3Quam9pbihcIixcIikrXCIpXCI7XHJcblx0XHRcdFx0dmFyIGZvcm1hdCA9IG5ldyBvbC5mb3JtYXQuV0tUKCk7XHJcblx0XHRcdFx0aWYgKCF0aGlzLmZlYXR1cmUpIHtcclxuXHRcdFx0XHRcdHRoaXMuZmVhdHVyZSA9IGZvcm1hdC5yZWFkRmVhdHVyZSh3a3QpO1xyXG5cdFx0XHRcdH0gZWxzZSB7XHJcblx0XHRcdFx0XHR0aGlzLmZlYXR1cmUuc2V0R2VvbWV0cnkoZm9ybWF0LnJlYWRGZWF0dXJlKHdrdCkuZ2V0R2VvbWV0cnkoKSk7XHJcblx0XHRcdFx0fVxyXG5cdFx0XHRcdHRoaXMuZmVhdHVyZS50cmFjaz10aGlzO1xyXG5cdFx0XHRcdHRoaXMuZmVhdHVyZS5nZXRHZW9tZXRyeSgpLnRyYW5zZm9ybSgnRVBTRzo0MzI2JywgJ0VQU0c6Mzg1NycpO1x0XHRcdFx0XHRcdFxyXG5cdFx0XHR9XHJcblx0XHR9LFxyXG5cclxuXHRcdGdldFJlYWxQYXJ0aWNpcGFudHNDb3VudCA6IGZ1bmN0aW9uKCkge1xyXG5cdFx0XHRyZXR1cm4gdGhpcy5wYXJ0aWNpcGFudHMubGVuZ3RoIC0gdGhpcy5jYW1zQ291bnQ7XHJcblx0XHR9LFxyXG5cdFx0XHJcblx0XHRuZXdQYXJ0aWNpcGFudCA6IGZ1bmN0aW9uKGlkLGRldmljZUlkLG5hbWUpXHJcblx0XHR7XHJcblx0XHRcdHZhciBwYXJ0ID0gbmV3IFBhcnRpY2lwYW50KHtpZDppZCxkZXZpY2VJZDpkZXZpY2VJZCxjb2RlOm5hbWV9KTtcclxuXHRcdFx0cGFydC5pbml0KHRoaXMucm91dGVbMF0sdGhpcyk7XHJcblx0XHRcdHBhcnQuc2V0U2VxSWQodGhpcy5wYXJ0aWNpcGFudHMubGVuZ3RoKTtcclxuXHRcdFx0dGhpcy5wYXJ0aWNpcGFudHMucHVzaChwYXJ0KTtcclxuXHRcdFx0cmV0dXJuIHBhcnQ7XHJcblx0XHR9LFxyXG5cclxuXHRcdG5ld01vdmluZ0NhbSA6IGZ1bmN0aW9uKGlkLGRldmljZUlkLG5hbWUpXHJcblx0XHR7XHJcblx0XHRcdHZhciBjYW0gPSBuZXcgTW92aW5nQ2FtKHtpZDppZCxkZXZpY2VJZDpkZXZpY2VJZCxjb2RlOm5hbWV9KTtcclxuXHRcdFx0Y2FtLmluaXQodGhpcy5yb3V0ZVswXSx0aGlzKTtcclxuXHRcdFx0Y2FtLnNldFNlcUlkKHRoaXMuY2Ftc0NvdW50KTtcclxuXHRcdFx0dGhpcy5jYW1zQ291bnQrKztcclxuXHRcdFx0Y2FtLl9fc2tpcFRyYWNraW5nUG9zPXRydWU7XHJcblx0XHRcdHRoaXMucGFydGljaXBhbnRzLnB1c2goY2FtKTtcclxuXHRcdFx0cmV0dXJuIGNhbTtcclxuXHRcdH0sXHJcblxyXG5cdFx0bmV3SG90U3BvdHMgOiBmdW5jdGlvbihob3RzcG90cykge1xyXG5cdFx0XHRpZiAoIWhvdHNwb3RzIHx8ICFob3RzcG90cy5sZW5ndGgpIHtcclxuXHRcdFx0XHRyZXR1cm47XHJcblx0XHRcdH1cclxuXHJcblx0XHRcdC8vIFRPRE8gUnVtZW4gLSB0aGlzIGlzIENPUFktUEFTVEUgY29kZSBmb3JtIHRoZSBTdHlsZXNcclxuXHRcdFx0Ly8gc28gbGF0ZXIgaXQgaGFzIHRvIGJlIGluIG9ubHkgb25lIHBsYWNlIC0gZ2V0dGluZyB0aGUgZ2VvbWV0cmllcyBmb3IgZWFjaCB0eXBlIGRpc3RhbmNlXHJcblx0XHRcdC8vIG1heWJlIGluIHRoZSBzYW1lIHBsYWNlIGRpc3RhbmNlcyBhcmUgY2FsY3VsYXRlZC5cclxuXHRcdFx0Ly8gVEhJUyBJUyBURU1QT1JBUlkgUEFUQ0ggdG8gZ2V0IHRoZSBuZWVkZWQgcG9pbnRzXHJcblx0XHRcdGlmICghaXNOYU4odGhpcy5iaWtlU3RhcnRLTSkpIHtcclxuXHRcdFx0XHRmb3IgKHZhciBpPTA7aTx0aGlzLmRpc3RhbmNlcy5sZW5ndGg7aSsrKSB7XHJcblx0XHRcdFx0XHRpZiAodGhpcy5kaXN0YW5jZXNbaV0gPj0gdGhpcy5iaWtlU3RhcnRLTSoxMDAwKVxyXG5cdFx0XHRcdFx0XHRicmVhaztcclxuXHRcdFx0XHR9XHJcblx0XHRcdFx0dmFyIGo7XHJcblx0XHRcdFx0aWYgKCFpc05hTih0aGlzLnJ1blN0YXJ0S00pKSB7XHJcblx0XHRcdFx0XHRmb3IgKGo9aTtqPHRoaXMuZGlzdGFuY2VzLmxlbmd0aDtqKyspIHtcclxuXHRcdFx0XHRcdFx0aWYgKHRoaXMuZGlzdGFuY2VzW2pdID49IHRoaXMucnVuU3RhcnRLTSoxMDAwKVxyXG5cdFx0XHRcdFx0XHRcdGJyZWFrO1xyXG5cdFx0XHRcdFx0fVxyXG5cdFx0XHRcdH0gZWxzZSB7XHJcblx0XHRcdFx0XHRqPXRoaXMuZGlzdGFuY2VzLmxlbmd0aDtcclxuXHRcdFx0XHR9XHJcblx0XHRcdFx0dmFyIGNvb3Jkcz10aGlzLmZlYXR1cmUuZ2V0R2VvbWV0cnkoKS5nZXRDb29yZGluYXRlcygpO1xyXG5cdFx0XHRcdHZhciBnZW9tc3dpbT1jb29yZHMuc2xpY2UoMCxpKTtcclxuXHRcdFx0XHR2YXIgZ2VvbWJpa2U9Y29vcmRzLnNsaWNlKGkgPCAxID8gaSA6IGktMSxqKTtcclxuXHRcdFx0XHRpZiAoaiA8IHRoaXMuZGlzdGFuY2VzLmxlbmd0aClcclxuXHRcdFx0XHRcdHZhciBnZW9tcnVuPWNvb3Jkcy5zbGljZShqIDwgMSA/IGogOiBqLTEsdGhpcy5kaXN0YW5jZXMubGVuZ3RoKTtcclxuXHRcdFx0XHRpZiAoIWdlb21zd2ltLmxlbmd0aClcclxuXHRcdFx0XHRcdGdlb21zd2ltPW51bGw7XHJcblx0XHRcdFx0aWYgKCFnZW9tYmlrZS5sZW5ndGgpXHJcblx0XHRcdFx0XHRnZW9tYmlrZT1udWxsO1xyXG5cdFx0XHRcdGlmICghZ2VvbXJ1bi5sZW5ndGgpXHJcblx0XHRcdFx0XHRnZW9tcnVuPW51bGw7XHJcblx0XHRcdH1cclxuXHJcblx0XHRcdGZvciAodmFyIGkgPSAwLCBsZW4gPSBob3RzcG90cy5sZW5ndGg7IGkgPCBsZW47IGkrKykge1xyXG5cdFx0XHRcdHZhciBob3RzcG90ID0gaG90c3BvdHNbaV07XHJcblx0XHRcdFx0dmFyIHBvaW50O1xyXG5cdFx0XHRcdGlmIChob3RzcG90LnR5cGUgPT09IENPTkZJRy5ob3RzcG90LmNhbVN3aW1CaWtlKSB7XHJcblx0XHRcdFx0XHRpZiAodGhpcy5pc0FkZGVkSG90U3BvdFN3aW1CaWtlKSBjb250aW51ZTsgLy8gbm90IGFsbG93ZWQgdG8gYWRkIHRvIHNhbWUgaG90c3BvdHNcclxuXHRcdFx0XHRcdGlmIChnZW9tYmlrZSkge1xyXG5cdFx0XHRcdFx0XHRwb2ludCA9IG9sLnByb2oudHJhbnNmb3JtKGdlb21iaWtlWzBdLCAnRVBTRzozODU3JywgJ0VQU0c6NDMyNicpO1xyXG5cdFx0XHRcdFx0XHR0aGlzLmlzQWRkZWRIb3RTcG90U3dpbUJpa2UgPSB0cnVlO1xyXG5cdFx0XHRcdFx0fVxyXG5cdFx0XHRcdH0gZWxzZSBpZiAoaG90c3BvdC50eXBlID09PSBDT05GSUcuaG90c3BvdC5jYW1CaWtlUnVuKSB7XHJcblx0XHRcdFx0XHRpZiAodGhpcy5pc0FkZGVkSG90U3BvdEJpa2VSdW4pIGNvbnRpbnVlOyAvLyBub3QgYWxsb3dlZCB0byBhZGQgdG8gc2FtZSBob3RzcG90c1xyXG5cdFx0XHRcdFx0aWYgKGdlb21ydW4pIHtcclxuXHRcdFx0XHRcdFx0cG9pbnQgPSBvbC5wcm9qLnRyYW5zZm9ybShnZW9tcnVuWzBdLCAnRVBTRzozODU3JywgJ0VQU0c6NDMyNicpO1xyXG5cdFx0XHRcdFx0XHR0aGlzLmlzQWRkZWRIb3RTcG90QmlrZVJ1biA9IHRydWU7XHJcblx0XHRcdFx0XHR9XHJcblx0XHRcdFx0fVxyXG5cdFx0XHRcdGlmIChwb2ludClcclxuXHRcdFx0XHRcdGhvdHNwb3QuaW5pdChwb2ludCk7XHJcblx0XHRcdH1cclxuXHRcdH0sXHJcblx0XHRcclxuXHRcdG9uTWFwQ2xpY2sgOiBmdW5jdGlvbihldmVudCkgXHJcblx0XHR7XHJcblx0XHRcdGlmICh0aGlzLmRlYnVnUGFydGljaXBhbnQpIFxyXG5cdFx0XHR7XHJcblx0XHRcdFx0dGhpcy5kZWJ1Z1BhcnRpY2lwYW50Lm9uRGVidWdDbGljayhldmVudCk7XHJcblx0XHRcdH1cclxuXHRcdH1cclxuXHJcbiAgICB9XHJcbn0pOyIsInZhciB0b1JhZGlhbnMgPSBmdW5jdGlvbihhbmdsZURlZ3JlZXMpIHsgcmV0dXJuIGFuZ2xlRGVncmVlcyAqIE1hdGguUEkgLyAxODA7IH07XHJcbnZhciB0b0RlZ3JlZXMgPSBmdW5jdGlvbihhbmdsZVJhZGlhbnMpIHsgcmV0dXJuIGFuZ2xlUmFkaWFucyAqIDE4MCAvIE1hdGguUEk7IH07XHJcblxyXG52YXIgV0dTODRTcGhlcmUgPSBmdW5jdGlvbihyYWRpdXMpIHtcclxuICB0aGlzLnJhZGl1cyA9IHJhZGl1cztcclxufTtcclxuXHJcbldHUzg0U3BoZXJlLnByb3RvdHlwZS5jb3NpbmVEaXN0YW5jZSA9IGZ1bmN0aW9uKGMxLCBjMikge1xyXG4gIHZhciBsYXQxID0gdG9SYWRpYW5zKGMxWzFdKTtcclxuICB2YXIgbGF0MiA9IHRvUmFkaWFucyhjMlsxXSk7XHJcbiAgdmFyIGRlbHRhTG9uID0gdG9SYWRpYW5zKGMyWzBdIC0gYzFbMF0pO1xyXG4gIHJldHVybiB0aGlzLnJhZGl1cyAqIE1hdGguYWNvcyhcclxuICAgICAgTWF0aC5zaW4obGF0MSkgKiBNYXRoLnNpbihsYXQyKSArXHJcbiAgICAgIE1hdGguY29zKGxhdDEpICogTWF0aC5jb3MobGF0MikgKiBNYXRoLmNvcyhkZWx0YUxvbikpO1xyXG59O1xyXG5cclxuV0dTODRTcGhlcmUucHJvdG90eXBlLmdlb2Rlc2ljQXJlYSA9IGZ1bmN0aW9uKGNvb3JkaW5hdGVzKSB7XHJcbiAgdmFyIGFyZWEgPSAwLCBsZW4gPSBjb29yZGluYXRlcy5sZW5ndGg7XHJcbiAgdmFyIHgxID0gY29vcmRpbmF0ZXNbbGVuIC0gMV1bMF07XHJcbiAgdmFyIHkxID0gY29vcmRpbmF0ZXNbbGVuIC0gMV1bMV07XHJcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW47IGkrKykge1xyXG4gICAgdmFyIHgyID0gY29vcmRpbmF0ZXNbaV1bMF0sIHkyID0gY29vcmRpbmF0ZXNbaV1bMV07XHJcbiAgICBhcmVhICs9IHRvUmFkaWFucyh4MiAtIHgxKSAqXHJcbiAgICAgICAgKDIgKyBNYXRoLnNpbih0b1JhZGlhbnMoeTEpKSArXHJcbiAgICAgICAgTWF0aC5zaW4odG9SYWRpYW5zKHkyKSkpO1xyXG4gICAgeDEgPSB4MjtcclxuICAgIHkxID0geTI7XHJcbiAgfVxyXG4gIHJldHVybiBhcmVhICogdGhpcy5yYWRpdXMgKiB0aGlzLnJhZGl1cyAvIDIuMDtcclxufTtcclxuXHJcbldHUzg0U3BoZXJlLnByb3RvdHlwZS5jcm9zc1RyYWNrRGlzdGFuY2UgPSBmdW5jdGlvbihjMSwgYzIsIGMzKSB7XHJcbiAgdmFyIGQxMyA9IHRoaXMuY29zaW5lRGlzdGFuY2UoYzEsIGMyKTtcclxuICB2YXIgdGhldGExMiA9IHRvUmFkaWFucyh0aGlzLmluaXRpYWxCZWFyaW5nKGMxLCBjMikpO1xyXG4gIHZhciB0aGV0YTEzID0gdG9SYWRpYW5zKHRoaXMuaW5pdGlhbEJlYXJpbmcoYzEsIGMzKSk7XHJcbiAgcmV0dXJuIHRoaXMucmFkaXVzICpcclxuICAgICAgTWF0aC5hc2luKE1hdGguc2luKGQxMyAvIHRoaXMucmFkaXVzKSAqIE1hdGguc2luKHRoZXRhMTMgLSB0aGV0YTEyKSk7XHJcbn07XHJcblxyXG5XR1M4NFNwaGVyZS5wcm90b3R5cGUuZXF1aXJlY3Rhbmd1bGFyRGlzdGFuY2UgPSBmdW5jdGlvbihjMSwgYzIpIHtcclxuICB2YXIgbGF0MSA9IHRvUmFkaWFucyhjMVsxXSk7XHJcbiAgdmFyIGxhdDIgPSB0b1JhZGlhbnMoYzJbMV0pO1xyXG4gIHZhciBkZWx0YUxvbiA9IHRvUmFkaWFucyhjMlswXSAtIGMxWzBdKTtcclxuICB2YXIgeCA9IGRlbHRhTG9uICogTWF0aC5jb3MoKGxhdDEgKyBsYXQyKSAvIDIpO1xyXG4gIHZhciB5ID0gbGF0MiAtIGxhdDE7XHJcbiAgcmV0dXJuIHRoaXMucmFkaXVzICogTWF0aC5zcXJ0KHggKiB4ICsgeSAqIHkpO1xyXG59O1xyXG5cclxuV0dTODRTcGhlcmUucHJvdG90eXBlLmZpbmFsQmVhcmluZyA9IGZ1bmN0aW9uKGMxLCBjMikge1xyXG4gIHJldHVybiAodGhpcy5pbml0aWFsQmVhcmluZyhjMiwgYzEpICsgMTgwKSAlIDM2MDtcclxufTtcclxuXHJcbldHUzg0U3BoZXJlLnByb3RvdHlwZS5oYXZlcnNpbmVEaXN0YW5jZSA9IGZ1bmN0aW9uKGMxLCBjMikge1xyXG4gIHZhciBsYXQxID0gdG9SYWRpYW5zKGMxWzFdKTtcclxuICB2YXIgbGF0MiA9IHRvUmFkaWFucyhjMlsxXSk7XHJcbiAgdmFyIGRlbHRhTGF0QnkyID0gKGxhdDIgLSBsYXQxKSAvIDI7XHJcbiAgdmFyIGRlbHRhTG9uQnkyID0gdG9SYWRpYW5zKGMyWzBdIC0gYzFbMF0pIC8gMjtcclxuICB2YXIgYSA9IE1hdGguc2luKGRlbHRhTGF0QnkyKSAqIE1hdGguc2luKGRlbHRhTGF0QnkyKSArXHJcbiAgICAgIE1hdGguc2luKGRlbHRhTG9uQnkyKSAqIE1hdGguc2luKGRlbHRhTG9uQnkyKSAqXHJcbiAgICAgIE1hdGguY29zKGxhdDEpICogTWF0aC5jb3MobGF0Mik7XHJcbiAgcmV0dXJuIDIgKiB0aGlzLnJhZGl1cyAqIE1hdGguYXRhbjIoTWF0aC5zcXJ0KGEpLCBNYXRoLnNxcnQoMSAtIGEpKTtcclxufTtcclxuXHJcbldHUzg0U3BoZXJlLnByb3RvdHlwZS5pbnRlcnBvbGF0ZSA9IGZ1bmN0aW9uKGMxLCBjMiwgZnJhY3Rpb24pIHtcclxuICB2YXIgbGF0MSA9IHRvUmFkaWFucyhjMVsxXSk7XHJcbiAgdmFyIGxvbjEgPSB0b1JhZGlhbnMoYzFbMF0pO1xyXG4gIHZhciBsYXQyID0gdG9SYWRpYW5zKGMyWzFdKTtcclxuICB2YXIgbG9uMiA9IHRvUmFkaWFucyhjMlswXSk7XHJcbiAgdmFyIGNvc0xhdDEgPSBNYXRoLmNvcyhsYXQxKTtcclxuICB2YXIgc2luTGF0MSA9IE1hdGguc2luKGxhdDEpO1xyXG4gIHZhciBjb3NMYXQyID0gTWF0aC5jb3MobGF0Mik7XHJcbiAgdmFyIHNpbkxhdDIgPSBNYXRoLnNpbihsYXQyKTtcclxuICB2YXIgY29zRGVsdGFMb24gPSBNYXRoLmNvcyhsb24yIC0gbG9uMSk7XHJcbiAgdmFyIGQgPSBzaW5MYXQxICogc2luTGF0MiArIGNvc0xhdDEgKiBjb3NMYXQyICogY29zRGVsdGFMb247XHJcbiAgaWYgKDEgPD0gZCkge1xyXG4gICAgcmV0dXJuIGMyLnNsaWNlKCk7XHJcbiAgfVxyXG4gIGQgPSBmcmFjdGlvbiAqIE1hdGguYWNvcyhkKTtcclxuICB2YXIgY29zRCA9IE1hdGguY29zKGQpO1xyXG4gIHZhciBzaW5EID0gTWF0aC5zaW4oZCk7XHJcbiAgdmFyIHkgPSBNYXRoLnNpbihsb24yIC0gbG9uMSkgKiBjb3NMYXQyO1xyXG4gIHZhciB4ID0gY29zTGF0MSAqIHNpbkxhdDIgLSBzaW5MYXQxICogY29zTGF0MiAqIGNvc0RlbHRhTG9uO1xyXG4gIHZhciB0aGV0YSA9IE1hdGguYXRhbjIoeSwgeCk7XHJcbiAgdmFyIGxhdCA9IE1hdGguYXNpbihzaW5MYXQxICogY29zRCArIGNvc0xhdDEgKiBzaW5EICogTWF0aC5jb3ModGhldGEpKTtcclxuICB2YXIgbG9uID0gbG9uMSArIE1hdGguYXRhbjIoTWF0aC5zaW4odGhldGEpICogc2luRCAqIGNvc0xhdDEsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvc0QgLSBzaW5MYXQxICogTWF0aC5zaW4obGF0KSk7XHJcbiAgcmV0dXJuIFt0b0RlZ3JlZXMobG9uKSwgdG9EZWdyZWVzKGxhdCldO1xyXG59O1xyXG5cclxuV0dTODRTcGhlcmUucHJvdG90eXBlLmluaXRpYWxCZWFyaW5nID0gZnVuY3Rpb24oYzEsIGMyKSB7XHJcbiAgdmFyIGxhdDEgPSB0b1JhZGlhbnMoYzFbMV0pO1xyXG4gIHZhciBsYXQyID0gdG9SYWRpYW5zKGMyWzFdKTtcclxuICB2YXIgZGVsdGFMb24gPSB0b1JhZGlhbnMoYzJbMF0gLSBjMVswXSk7XHJcbiAgdmFyIHkgPSBNYXRoLnNpbihkZWx0YUxvbikgKiBNYXRoLmNvcyhsYXQyKTtcclxuICB2YXIgeCA9IE1hdGguY29zKGxhdDEpICogTWF0aC5zaW4obGF0MikgLVxyXG4gICAgICBNYXRoLnNpbihsYXQxKSAqIE1hdGguY29zKGxhdDIpICogTWF0aC5jb3MoZGVsdGFMb24pO1xyXG4gIHJldHVybiB0b0RlZ3JlZXMoTWF0aC5hdGFuMih5LCB4KSk7XHJcbn07XHJcblxyXG5XR1M4NFNwaGVyZS5wcm90b3R5cGUubWF4aW11bUxhdGl0dWRlID0gZnVuY3Rpb24oYmVhcmluZywgbGF0aXR1ZGUpIHtcclxuICByZXR1cm4gTWF0aC5jb3MoTWF0aC5hYnMoTWF0aC5zaW4odG9SYWRpYW5zKGJlYXJpbmcpKSAqXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgIE1hdGguY29zKHRvUmFkaWFucyhsYXRpdHVkZSkpKSk7XHJcbn07XHJcblxyXG5XR1M4NFNwaGVyZS5wcm90b3R5cGUubWlkcG9pbnQgPSBmdW5jdGlvbihjMSwgYzIpIHtcclxuICB2YXIgbGF0MSA9IHRvUmFkaWFucyhjMVsxXSk7XHJcbiAgdmFyIGxhdDIgPSB0b1JhZGlhbnMoYzJbMV0pO1xyXG4gIHZhciBsb24xID0gdG9SYWRpYW5zKGMxWzBdKTtcclxuICB2YXIgZGVsdGFMb24gPSB0b1JhZGlhbnMoYzJbMF0gLSBjMVswXSk7XHJcbiAgdmFyIEJ4ID0gTWF0aC5jb3MobGF0MikgKiBNYXRoLmNvcyhkZWx0YUxvbik7XHJcbiAgdmFyIEJ5ID0gTWF0aC5jb3MobGF0MikgKiBNYXRoLnNpbihkZWx0YUxvbik7XHJcbiAgdmFyIGNvc0xhdDFQbHVzQnggPSBNYXRoLmNvcyhsYXQxKSArIEJ4O1xyXG4gIHZhciBsYXQgPSBNYXRoLmF0YW4yKE1hdGguc2luKGxhdDEpICsgTWF0aC5zaW4obGF0MiksXHJcbiAgICAgICAgICAgICAgICAgICAgICAgTWF0aC5zcXJ0KGNvc0xhdDFQbHVzQnggKiBjb3NMYXQxUGx1c0J4ICsgQnkgKiBCeSkpO1xyXG4gIHZhciBsb24gPSBsb24xICsgTWF0aC5hdGFuMihCeSwgY29zTGF0MVBsdXNCeCk7XHJcbiAgcmV0dXJuIFt0b0RlZ3JlZXMobG9uKSwgdG9EZWdyZWVzKGxhdCldO1xyXG59O1xyXG5cclxuV0dTODRTcGhlcmUucHJvdG90eXBlLm9mZnNldCA9IGZ1bmN0aW9uKGMxLCBkaXN0YW5jZSwgYmVhcmluZykge1xyXG4gIHZhciBsYXQxID0gdG9SYWRpYW5zKGMxWzFdKTtcclxuICB2YXIgbG9uMSA9IHRvUmFkaWFucyhjMVswXSk7XHJcbiAgdmFyIGRCeVIgPSBkaXN0YW5jZSAvIHRoaXMucmFkaXVzO1xyXG4gIHZhciBsYXQgPSBNYXRoLmFzaW4oXHJcbiAgICAgIE1hdGguc2luKGxhdDEpICogTWF0aC5jb3MoZEJ5UikgK1xyXG4gICAgICBNYXRoLmNvcyhsYXQxKSAqIE1hdGguc2luKGRCeVIpICogTWF0aC5jb3MoYmVhcmluZykpO1xyXG4gIHZhciBsb24gPSBsb24xICsgTWF0aC5hdGFuMihcclxuICAgICAgTWF0aC5zaW4oYmVhcmluZykgKiBNYXRoLnNpbihkQnlSKSAqIE1hdGguY29zKGxhdDEpLFxyXG4gICAgICBNYXRoLmNvcyhkQnlSKSAtIE1hdGguc2luKGxhdDEpICogTWF0aC5zaW4obGF0KSk7XHJcbiAgcmV0dXJuIFt0b0RlZ3JlZXMobG9uKSwgdG9EZWdyZWVzKGxhdCldO1xyXG59O1xyXG5cclxuLyoqXHJcbiAqIENoZWNrcyB3aGV0aGVyIG9iamVjdCBpcyBub3QgbnVsbCBhbmQgbm90IHVuZGVmaW5lZFxyXG4gKiBAcGFyYW0geyp9IG9iaiBvYmplY3QgdG8gYmUgY2hlY2tlZFxyXG4gKiBAcmV0dXJuIHtib29sZWFufVxyXG4gKi9cclxuXHJcbmZ1bmN0aW9uIGlzRGVmaW5lZChvYmopIHtcclxuICAgIHJldHVybiBudWxsICE9IG9iaiAmJiB1bmRlZmluZWQgIT0gb2JqO1xyXG59XHJcblxyXG5mdW5jdGlvbiBpc051bWVyaWMod2gpIHtcclxuICAgIHJldHVybiAhaXNOYU4ocGFyc2VGbG9hdCh3aCkpICYmIGlzRmluaXRlKHdoKTtcclxufVxyXG5cclxuZnVuY3Rpb24gaXNGdW5jdGlvbih3aCkge1xyXG4gICAgaWYgKCF3aCkge1xyXG4gICAgICAgIHJldHVybiBmYWxzZTtcclxuICAgIH1cclxuICAgIHJldHVybiAod2ggaW5zdGFuY2VvZiBGdW5jdGlvbiB8fCB0eXBlb2Ygd2ggPT0gXCJmdW5jdGlvblwiKTtcclxufVxyXG5cclxuZnVuY3Rpb24gaXNTdHJpbmdOb3RFbXB0eSh3aCkge1xyXG4gICAgaWYgKCF3aCkge1xyXG4gICAgICAgIHJldHVybiBmYWxzZTtcclxuICAgIH1cclxuICAgIHJldHVybiAod2ggaW5zdGFuY2VvZiBTdHJpbmcgfHwgdHlwZW9mIHdoID09IFwic3RyaW5nXCIpO1xyXG59XHJcblxyXG5mdW5jdGlvbiBpc1N0cih3aCkge1xyXG4gICAgcmV0dXJuICh3aCBpbnN0YW5jZW9mIFN0cmluZyB8fCB0eXBlb2Ygd2ggPT09IFwic3RyaW5nXCIpO1xyXG59XHJcblxyXG5mdW5jdGlvbiBpc0Jvb2xlYW4od2gpIHtcclxuICAgIHJldHVybiAod2ggaW5zdGFuY2VvZiBCb29sZWFuIHx8IHR5cGVvZiB3aCA9PSBcImJvb2xlYW5cIik7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIG15VHJpbSh4KSB7XHJcbiAgICByZXR1cm4geC5yZXBsYWNlKC9eXFxzK3xcXHMrJC9nbSwnJyk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIG15VHJpbUNvb3JkaW5hdGUoeCkge1xyXG5cdGRvIHtcclxuXHRcdHZhciBrPXg7XHJcblx0XHR4PW15VHJpbSh4KTtcclxuXHRcdGlmIChrICE9IHgpIFxyXG5cdFx0XHRjb250aW51ZTtcclxuXHRcdGlmICh4Lmxlbmd0aCkgXHJcblx0XHR7XHJcblx0XHRcdGlmICh4WzBdID09IFwiLFwiKVxyXG5cdFx0XHRcdHg9eC5zdWJzdHJpbmcoMSx4Lmxlbmd0aCk7XHJcblx0XHRcdGVsc2UgaWYgKGtbay5sZW5ndGgtMV0gPT0gXCIsXCIpXHJcblx0XHRcdFx0eD14LnN1YnN0cmluZygwLHgubGVuZ3RoLTEpO1xyXG5cdFx0XHRlbHNlXHJcblx0XHRcdFx0YnJlYWs7XHJcblx0XHRcdGNvbnRpbnVlO1xyXG5cdFx0fVxyXG5cdFx0YnJlYWs7XHJcblx0fSB3aGlsZSAodHJ1ZSk7XHJcblx0cmV0dXJuIHg7XHJcbn1cclxuXHJcblxyXG5mdW5jdGlvbiBjbG9zZXN0UHJvamVjdGlvbk9mUG9pbnRPbkxpbmUoeCx5LHgxLHkxLHgyLHkyKSBcclxue1xyXG5cdHZhciBzdGF0dXM7XHJcblx0dmFyIFAxPW51bGw7XHJcblx0dmFyIFAyPW51bGw7XHJcblx0dmFyIFAzPW51bGw7XHJcblx0dmFyIFA0PW51bGw7XHJcblx0dmFyIHAxPVtdO1xyXG4gICAgdmFyIHAyPVtdO1xyXG4gICAgdmFyIHAzPVtdO1xyXG5cdHZhciBwND1bXTtcclxuICAgIHZhciBpbnRlcnNlY3Rpb25Qb2ludD1udWxsO1xyXG4gICAgdmFyIGRpc3RNaW5Qb2ludD1udWxsO1xyXG4gICAgdmFyIGRlbm9taW5hdG9yPTA7XHJcbiAgICB2YXIgbm9taW5hdG9yPTA7XHJcbiAgICB2YXIgdT0wO1xyXG4gICAgdmFyIGRpc3RPcnRobz0wO1xyXG4gICAgdmFyIGRpc3RQMT0wO1xyXG4gICAgdmFyIGRpc3RQMj0wO1xyXG4gICAgdmFyIGRpc3RNaW49MDtcclxuICAgIHZhciBkaXN0TWF4PTA7XHJcbiAgIFxyXG4gICAgZnVuY3Rpb24gaW50ZXJzZWN0aW9uKClcclxuICAgIHtcclxuICAgICAgICB2YXIgYXggPSBwMVswXSArIHUgKiAocDJbMF0gLSBwMVswXSk7XHJcbiAgICAgICAgdmFyIGF5ID0gcDFbMV0gKyB1ICogKHAyWzFdIC0gcDFbMV0pO1xyXG4gICAgICAgIHA0ID0gW2F4LCBheV07XHJcbiAgICAgICAgaW50ZXJzZWN0aW9uUG9pbnQgPSBbYXgsYXldO1xyXG4gICAgfVxyXG5cclxuICAgIGZ1bmN0aW9uIGRpc3RhbmNlKClcclxuICAgIHtcclxuICAgICAgICB2YXIgYXggPSBwMVswXSArIHUgKiAocDJbMF0gLSBwMVswXSk7XHJcbiAgICAgICAgdmFyIGF5ID0gcDFbMV0gKyB1ICogKHAyWzFdIC0gcDFbMV0pO1xyXG4gICAgICAgIHA0ID0gW2F4LCBheV07XHJcbiAgICAgICAgZGlzdE9ydGhvID0gTWF0aC5zcXJ0KE1hdGgucG93KChwNFswXSAtIHAzWzBdKSwyKSArIE1hdGgucG93KChwNFsxXSAtIHAzWzFdKSwyKSk7XHJcbiAgICAgICAgZGlzdFAxICAgID0gTWF0aC5zcXJ0KE1hdGgucG93KChwMVswXSAtIHAzWzBdKSwyKSArIE1hdGgucG93KChwMVsxXSAtIHAzWzFdKSwyKSk7XHJcbiAgICAgICAgZGlzdFAyICAgID0gTWF0aC5zcXJ0KE1hdGgucG93KChwMlswXSAtIHAzWzBdKSwyKSArIE1hdGgucG93KChwMlsxXSAtIHAzWzFdKSwyKSk7XHJcbiAgICAgICAgaWYodT49MCAmJiB1PD0xKVxyXG4gICAgICAgIHsgICBkaXN0TWluID0gZGlzdE9ydGhvO1xyXG4gICAgICAgICAgICBkaXN0TWluUG9pbnQgPSBpbnRlcnNlY3Rpb25Qb2ludDtcclxuICAgICAgICB9XHJcbiAgICAgICAgZWxzZVxyXG4gICAgICAgIHsgICBpZihkaXN0UDEgPD0gZGlzdFAyKVxyXG4gICAgICAgICAgICB7ICAgZGlzdE1pbiA9IGRpc3RQMTtcclxuICAgICAgICAgICAgICAgIGRpc3RNaW5Qb2ludCA9IFAxO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGVsc2VcclxuICAgICAgICAgICAgeyAgIGRpc3RNaW4gPSBkaXN0UDI7XHJcbiAgICAgICAgICAgICAgICBkaXN0TWluUG9pbnQgPSBQMjtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgICAgICBkaXN0TWF4ID0gTWF0aC5tYXgoTWF0aC5tYXgoZGlzdE9ydGhvLCBkaXN0UDEpLCBkaXN0UDIpO1xyXG4gICAgfVxyXG5cdFAxID0gW3gxLHkxXTtcclxuXHRQMiA9IFt4Mix5Ml07XHJcblx0UDMgPSBbeCx5XTtcclxuXHRwMSA9IFt4MSwgeTFdO1xyXG5cdHAyID0gW3gyLCB5Ml07XHJcblx0cDMgPSBbeCwgeV07XHJcblx0ZGVub21pbmF0b3IgPSBNYXRoLnBvdyhNYXRoLnNxcnQoTWF0aC5wb3cocDJbMF0tcDFbMF0sMikgKyBNYXRoLnBvdyhwMlsxXS1wMVsxXSwyKSksMiApO1xyXG5cdG5vbWluYXRvciAgID0gKHAzWzBdIC0gcDFbMF0pICogKHAyWzBdIC0gcDFbMF0pICsgKHAzWzFdIC0gcDFbMV0pICogKHAyWzFdIC0gcDFbMV0pO1xyXG5cdGlmKGRlbm9taW5hdG9yPT0wKVxyXG5cdHsgICBzdGF0dXMgPSBcImNvaW5jaWRlbnRhbFwiXHJcblx0XHR1ID0gLTk5OTtcclxuXHR9XHJcblx0ZWxzZVxyXG5cdHsgICB1ID0gbm9taW5hdG9yIC8gZGVub21pbmF0b3I7XHJcblx0XHRpZih1ID49MCAmJiB1IDw9IDEpXHJcblx0XHRcdHN0YXR1cyA9IFwib3J0aG9nb25hbFwiO1xyXG5cdFx0ZWxzZVxyXG5cdFx0XHRzdGF0dXMgPSBcIm9ibGlxdWVcIjtcclxuXHR9XHJcblx0aW50ZXJzZWN0aW9uKCk7XHJcblx0ZGlzdGFuY2UoKTtcclxuXHRcclxuXHRyZXR1cm4geyBzdGF0dXMgOiBzdGF0dXMsIHBvcyA6IGRpc3RNaW5Qb2ludCwgbWluIDogZGlzdE1pbiB9O1xyXG59XHJcblxyXG5mdW5jdGlvbiBjb2xvckx1bWluYW5jZShoZXgsIGx1bSkge1xyXG4gICAgLy8gVmFsaWRhdGUgaGV4IHN0cmluZ1xyXG4gICAgaGV4ID0gU3RyaW5nKGhleCkucmVwbGFjZSgvW14wLTlhLWZdL2dpLCBcIlwiKTtcclxuICAgIGlmIChoZXgubGVuZ3RoIDwgNikge1xyXG4gICAgICAgIGhleCA9IGhleC5yZXBsYWNlKC8oLikvZywgJyQxJDEnKTtcclxuICAgIH1cclxuICAgIGx1bSA9IGx1bSB8fCAwO1xyXG4gICAgLy8gQ29udmVydCB0byBkZWNpbWFsIGFuZCBjaGFuZ2UgbHVtaW5vc2l0eVxyXG4gICAgdmFyIHJnYiA9IFwiI1wiLFxyXG4gICAgICAgIGM7XHJcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IDM7ICsraSkge1xyXG4gICAgICAgIGMgPSBwYXJzZUludChoZXguc3Vic3RyKGkgKiAyLCAyKSwgMTYpO1xyXG4gICAgICAgIGMgPSBNYXRoLnJvdW5kKE1hdGgubWluKE1hdGgubWF4KDAsIGMgKyAoYyAqIGx1bSkpLCAyNTUpKS50b1N0cmluZygxNik7XHJcbiAgICAgICAgcmdiICs9IChcIjAwXCIgKyBjKS5zdWJzdHIoYy5sZW5ndGgpO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIHJnYjtcclxufVxyXG5cclxuZnVuY3Rpb24gaW5jcmVhc2VCcmlnaHRuZXNzKGhleCwgcGVyY2VudCkgXHJcbntcclxuICAgIGhleCA9IFN0cmluZyhoZXgpLnJlcGxhY2UoL1teMC05YS1mXS9naSwgXCJcIik7XHJcbiAgICBpZiAoaGV4Lmxlbmd0aCA8IDYpIHtcclxuICAgICAgICBoZXggPSBoZXgucmVwbGFjZSgvKC4pL2csICckMSQxJyk7XHJcbiAgICB9XHJcbiAgICB2YXIgcmdiID0gXCIjXCIsXHJcbiAgICAgICAgYztcclxuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgMzsgKytpKSB7XHJcbiAgICAgICAgYyA9IHBhcnNlSW50KGhleC5zdWJzdHIoaSAqIDIsIDIpLCAxNik7XHJcbiAgICAgICAgYyA9IHBhcnNlSW50KChjKigxMDAtcGVyY2VudCkrMjU1KnBlcmNlbnQpLzEwMCk7XHJcbiAgICAgICAgaWYgKGMgPiAyNTUpXHJcbiAgICAgICAgXHRjPTI1NTtcclxuICAgICAgICBjPWMudG9TdHJpbmcoMTYpO1xyXG4gICAgICAgIHJnYiArPSAoXCIwMFwiICsgYykuc3Vic3RyKGMubGVuZ3RoKTtcclxuICAgIH1cclxuICAgIHJldHVybiByZ2I7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGNvbG9yQWxwaGFBcnJheShoZXgsIGFscGhhKSB7XHJcbiAgICBoZXggPSBTdHJpbmcoaGV4KS5yZXBsYWNlKC9bXjAtOWEtZl0vZ2ksIFwiXCIpO1xyXG4gICAgaWYgKGhleC5sZW5ndGggPCA2KSB7XHJcbiAgICAgICAgaGV4ID0gaGV4LnJlcGxhY2UoLyguKS9nLCAnJDEkMScpO1xyXG4gICAgfVxyXG4gICAgdmFyIHJlcz1bXTtcclxuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgMzsgKytpKSB7XHJcbiAgICAgICAgYyA9IHBhcnNlSW50KGhleC5zdWJzdHIoaSAqIDIsIDIpLCAxNik7XHJcbiAgICAgICAgcmVzLnB1c2goYyk7XHJcbiAgICB9XHJcbiAgICByZXMucHVzaChhbHBoYSk7XHJcbiAgICByZXR1cm4gcmVzO1xyXG59XHJcblxyXG5mdW5jdGlvbiBlc2NhcGVIVE1MKHVuc2FmZSkge1xyXG4gICAgcmV0dXJuIHVuc2FmZVxyXG4gICAgICAgICAucmVwbGFjZSgvJi9nLCBcIiZhbXA7XCIpXHJcbiAgICAgICAgIC5yZXBsYWNlKC88L2csIFwiJmx0O1wiKVxyXG4gICAgICAgICAucmVwbGFjZSgvPi9nLCBcIiZndDtcIilcclxuICAgICAgICAgLnJlcGxhY2UoL1wiL2csIFwiJnF1b3Q7XCIpXHJcbiAgICAgICAgIC5yZXBsYWNlKC8nL2csIFwiJiMwMzk7XCIpO1xyXG4gfVxyXG5cclxuZnVuY3Rpb24gZm9ybWF0TnVtYmVyMih2YWwpIHtcclxuXHRyZXR1cm4gcGFyc2VGbG9hdChNYXRoLnJvdW5kKHZhbCAqIDEwMCkgLyAxMDApLnRvRml4ZWQoMik7XHJcbn1cclxuZnVuY3Rpb24gZm9ybWF0RGF0ZShkKSB7XHJcbiBcdHZhciBkZCA9IGQuZ2V0RGF0ZSgpO1xyXG4gICAgdmFyIG1tID0gZC5nZXRNb250aCgpKzE7IC8vSmFudWFyeSBpcyAwIVxyXG4gICAgdmFyIHl5eXkgPSBkLmdldEZ1bGxZZWFyKCk7XHJcbiAgICBpZihkZDwxMCl7XHJcbiAgICAgICAgZGQ9JzAnK2RkO1xyXG4gICAgfSBcclxuICAgIGlmKG1tPDEwKXtcclxuICAgICAgICBtbT0nMCcrbW07XHJcbiAgICB9IFxyXG4gICAgcmV0dXJuIGRkKycuJyttbSsnLicreXl5eTtcclxufVxyXG5cclxuZnVuY3Rpb24gZm9ybWF0VGltZShkKSB7XHJcbiAgICB2YXIgaGggPSBkLmdldEhvdXJzKCk7XHJcbiAgICBpZihoaDwxMCl7XHJcbiAgICBcdGhoPScwJytoaDtcclxuICAgIH0gXHJcbiAgICB2YXIgbW0gPSBkLmdldE1pbnV0ZXMoKTtcclxuICAgIGlmKG1tPDEwKXtcclxuICAgICAgICBtbT0nMCcrbW07XHJcbiAgICB9IFxyXG4gICAgcmV0dXJuIGhoK1wiOlwiK21tO1xyXG59XHJcblxyXG5mdW5jdGlvbiBmb3JtYXREYXRlVGltZShkKSB7XHJcblx0cmV0dXJuIGZvcm1hdERhdGUoZCkrXCIgXCIrZm9ybWF0VGltZShkKTtcclxufVxyXG5cclxuZnVuY3Rpb24gZm9ybWF0RGF0ZVRpbWVTZWMoZCkge1xyXG5cdHJldHVybiBmb3JtYXREYXRlKGQpK1wiIFwiK2Zvcm1hdFRpbWVTZWMoZCk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGZvcm1hdFRpbWVTZWMoZCkge1xyXG4gICAgdmFyIGhoID0gZC5nZXRIb3VycygpO1xyXG4gICAgaWYoaGg8MTApe1xyXG4gICAgXHRoaD0nMCcraGg7XHJcbiAgICB9IFxyXG4gICAgdmFyIG1tID0gZC5nZXRNaW51dGVzKCk7XHJcbiAgICBpZihtbTwxMCl7XHJcbiAgICAgICAgbW09JzAnK21tO1xyXG4gICAgfSBcclxuICAgIHZhciBzcyA9IGQuZ2V0U2Vjb25kcygpO1xyXG4gICAgaWYoc3M8MTApe1xyXG4gICAgICAgIHNzPScwJytzcztcclxuICAgIH0gXHJcbiAgICByZXR1cm4gaGgrXCI6XCIrbW0rXCI6XCIrc3M7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIHJhaW5ib3cobnVtT2ZTdGVwcywgc3RlcCkge1xyXG4gICAgLy8gVGhpcyBmdW5jdGlvbiBnZW5lcmF0ZXMgdmlicmFudCwgXCJldmVubHkgc3BhY2VkXCIgY29sb3VycyAoaS5lLiBubyBjbHVzdGVyaW5nKS4gVGhpcyBpcyBpZGVhbCBmb3IgY3JlYXRpbmcgZWFzaWx5IGRpc3Rpbmd1aXNoYWJsZSB2aWJyYW50IG1hcmtlcnMgaW4gR29vZ2xlIE1hcHMgYW5kIG90aGVyIGFwcHMuXHJcbiAgICAvLyBBZGFtIENvbGUsIDIwMTEtU2VwdC0xNFxyXG4gICAgLy8gSFNWIHRvIFJCRyBhZGFwdGVkIGZyb206IGh0dHA6Ly9tamlqYWNrc29uLmNvbS8yMDA4LzAyL3JnYi10by1oc2wtYW5kLXJnYi10by1oc3YtY29sb3ItbW9kZWwtY29udmVyc2lvbi1hbGdvcml0aG1zLWluLWphdmFzY3JpcHRcclxuICAgIHZhciByLCBnLCBiO1xyXG4gICAgdmFyIGggPSBzdGVwIC8gbnVtT2ZTdGVwcztcclxuICAgIHZhciBpID0gfn4oaCAqIDYpO1xyXG4gICAgdmFyIGYgPSBoICogNiAtIGk7XHJcbiAgICB2YXIgcSA9IDEgLSBmO1xyXG4gICAgc3dpdGNoKGkgJSA2KXtcclxuICAgICAgICBjYXNlIDA6IHIgPSAxLCBnID0gZiwgYiA9IDA7IGJyZWFrO1xyXG4gICAgICAgIGNhc2UgMTogciA9IHEsIGcgPSAxLCBiID0gMDsgYnJlYWs7XHJcbiAgICAgICAgY2FzZSAyOiByID0gMCwgZyA9IDEsIGIgPSBmOyBicmVhaztcclxuICAgICAgICBjYXNlIDM6IHIgPSAwLCBnID0gcSwgYiA9IDE7IGJyZWFrO1xyXG4gICAgICAgIGNhc2UgNDogciA9IGYsIGcgPSAwLCBiID0gMTsgYnJlYWs7XHJcbiAgICAgICAgY2FzZSA1OiByID0gMSwgZyA9IDAsIGIgPSBxOyBicmVhaztcclxuICAgIH1cclxuICAgIHZhciBjID0gXCIjXCIgKyAoXCIwMFwiICsgKH4gfihyICogMjU1KSkudG9TdHJpbmcoMTYpKS5zbGljZSgtMikgKyAoXCIwMFwiICsgKH4gfihnICogMjU1KSkudG9TdHJpbmcoMTYpKS5zbGljZSgtMikgKyAoXCIwMFwiICsgKH4gfihiICogMjU1KSkudG9TdHJpbmcoMTYpKS5zbGljZSgtMik7XHJcbiAgICByZXR1cm4gKGMpO1xyXG59XHJcblxyXG5mdW5jdGlvbiBtb2JpbGVBbmRUYWJsZXRDaGVjaygpIFxyXG57XHJcblx0ICBpZiAodHlwZW9mIG5hdmlnYXRvciA9PSBcInVuZGVmaW5lZFwiKVxyXG5cdFx0ICByZXR1cm4gZmFsc2U7XHJcblx0ICB2YXIgY2hlY2sgPSBmYWxzZTtcclxuXHQgIChmdW5jdGlvbihhKXtpZigvKGFuZHJvaWR8YmJcXGQrfG1lZWdvKS4rbW9iaWxlfGF2YW50Z298YmFkYVxcL3xibGFja2JlcnJ5fGJsYXplcnxjb21wYWx8ZWxhaW5lfGZlbm5lY3xoaXB0b3B8aWVtb2JpbGV8aXAoaG9uZXxvZCl8aXJpc3xraW5kbGV8bGdlIHxtYWVtb3xtaWRwfG1tcHxtb2JpbGUuK2ZpcmVmb3h8bmV0ZnJvbnR8b3BlcmEgbShvYnxpbilpfHBhbG0oIG9zKT98cGhvbmV8cChpeGl8cmUpXFwvfHBsdWNrZXJ8cG9ja2V0fHBzcHxzZXJpZXMoNHw2KTB8c3ltYmlhbnx0cmVvfHVwXFwuKGJyb3dzZXJ8bGluayl8dm9kYWZvbmV8d2FwfHdpbmRvd3MgY2V8eGRhfHhpaW5vfGFuZHJvaWR8aXBhZHxwbGF5Ym9va3xzaWxrL2kudGVzdChhKXx8LzEyMDd8NjMxMHw2NTkwfDNnc298NHRocHw1MFsxLTZdaXw3NzBzfDgwMnN8YSB3YXxhYmFjfGFjKGVyfG9vfHNcXC0pfGFpKGtvfHJuKXxhbChhdnxjYXxjbyl8YW1vaXxhbihleHxueXx5dyl8YXB0dXxhcihjaHxnbyl8YXModGV8dXMpfGF0dHd8YXUoZGl8XFwtbXxyIHxzICl8YXZhbnxiZShja3xsbHxucSl8YmkobGJ8cmQpfGJsKGFjfGF6KXxicihlfHYpd3xidW1ifGJ3XFwtKG58dSl8YzU1XFwvfGNhcGl8Y2N3YXxjZG1cXC18Y2VsbHxjaHRtfGNsZGN8Y21kXFwtfGNvKG1wfG5kKXxjcmF3fGRhKGl0fGxsfG5nKXxkYnRlfGRjXFwtc3xkZXZpfGRpY2F8ZG1vYnxkbyhjfHApb3xkcygxMnxcXC1kKXxlbCg0OXxhaSl8ZW0obDJ8dWwpfGVyKGljfGswKXxlc2w4fGV6KFs0LTddMHxvc3x3YXx6ZSl8ZmV0Y3xmbHkoXFwtfF8pfGcxIHV8ZzU2MHxnZW5lfGdmXFwtNXxnXFwtbW98Z28oXFwud3xvZCl8Z3IoYWR8dW4pfGhhaWV8aGNpdHxoZFxcLShtfHB8dCl8aGVpXFwtfGhpKHB0fHRhKXxocCggaXxpcCl8aHNcXC1jfGh0KGMoXFwtfCB8X3xhfGd8cHxzfHQpfHRwKXxodShhd3x0Yyl8aVxcLSgyMHxnb3xtYSl8aTIzMHxpYWMoIHxcXC18XFwvKXxpYnJvfGlkZWF8aWcwMXxpa29tfGltMWt8aW5ub3xpcGFxfGlyaXN8amEodHx2KWF8amJyb3xqZW11fGppZ3N8a2RkaXxrZWppfGtndCggfFxcLyl8a2xvbnxrcHQgfGt3Y1xcLXxreW8oY3xrKXxsZShub3x4aSl8bGcoIGd8XFwvKGt8bHx1KXw1MHw1NHxcXC1bYS13XSl8bGlid3xseW54fG0xXFwtd3xtM2dhfG01MFxcL3xtYSh0ZXx1aXx4byl8bWMoMDF8MjF8Y2EpfG1cXC1jcnxtZShyY3xyaSl8bWkobzh8b2F8dHMpfG1tZWZ8bW8oMDF8MDJ8Yml8ZGV8ZG98dChcXC18IHxvfHYpfHp6KXxtdCg1MHxwMXx2ICl8bXdicHxteXdhfG4xMFswLTJdfG4yMFsyLTNdfG4zMCgwfDIpfG41MCgwfDJ8NSl8bjcoMCgwfDEpfDEwKXxuZSgoY3xtKVxcLXxvbnx0Znx3Znx3Z3x3dCl8bm9rKDZ8aSl8bnpwaHxvMmltfG9wKHRpfHd2KXxvcmFufG93ZzF8cDgwMHxwYW4oYXxkfHQpfHBkeGd8cGcoMTN8XFwtKFsxLThdfGMpKXxwaGlsfHBpcmV8cGwoYXl8dWMpfHBuXFwtMnxwbyhja3xydHxzZSl8cHJveHxwc2lvfHB0XFwtZ3xxYVxcLWF8cWMoMDd8MTJ8MjF8MzJ8NjB8XFwtWzItN118aVxcLSl8cXRla3xyMzgwfHI2MDB8cmFrc3xyaW05fHJvKHZlfHpvKXxzNTVcXC98c2EoZ2V8bWF8bW18bXN8bnl8dmEpfHNjKDAxfGhcXC18b298cFxcLSl8c2RrXFwvfHNlKGMoXFwtfDB8MSl8NDd8bWN8bmR8cmkpfHNnaFxcLXxzaGFyfHNpZShcXC18bSl8c2tcXC0wfHNsKDQ1fGlkKXxzbShhbHxhcnxiM3xpdHx0NSl8c28oZnR8bnkpfHNwKDAxfGhcXC18dlxcLXx2ICl8c3koMDF8bWIpfHQyKDE4fDUwKXx0NigwMHwxMHwxOCl8dGEoZ3R8bGspfHRjbFxcLXx0ZGdcXC18dGVsKGl8bSl8dGltXFwtfHRcXC1tb3x0byhwbHxzaCl8dHMoNzB8bVxcLXxtM3xtNSl8dHhcXC05fHVwKFxcLmJ8ZzF8c2kpfHV0c3R8djQwMHx2NzUwfHZlcml8dmkocmd8dGUpfHZrKDQwfDVbMC0zXXxcXC12KXx2bTQwfHZvZGF8dnVsY3x2eCg1Mnw1M3w2MHw2MXw3MHw4MHw4MXw4M3w4NXw5OCl8dzNjKFxcLXwgKXx3ZWJjfHdoaXR8d2koZyB8bmN8bncpfHdtbGJ8d29udXx4NzAwfHlhc1xcLXx5b3VyfHpldG98enRlXFwtL2kudGVzdChhLnN1YnN0cigwLDQpKSljaGVjayA9IHRydWV9KShuYXZpZ2F0b3IudXNlckFnZW50fHxuYXZpZ2F0b3IudmVuZG9yfHx3aW5kb3cub3BlcmEpO1xyXG5cdCAgcmV0dXJuIGNoZWNrO1xyXG59XHJcblxyXG52YXIgUkVOREVSRURBUlJPV1M9e307XHJcbmZ1bmN0aW9uIHJlbmRlckFycm93QmFzZTY0KHdpZHRoLGhlaWdodCxjb2xvcikgXHJcbntcclxuXHR2YXIga2V5ID0gd2lkdGgrXCJ4XCIraGVpZ2h0K1wiOlwiK2NvbG9yO1xyXG5cdGlmIChSRU5ERVJFREFSUk9XU1trZXldKVxyXG5cdFx0cmV0dXJuIFJFTkRFUkVEQVJST1dTW2tleV07XHJcblx0dmFyIGJyZGNvbCA9IFwiI2ZlZmVmZVwiOyAvL2luY3JlYXNlQnJpZ2h0bmVzcyhjb2xvciw5OSk7XHJcblx0XHJcblx0dmFyIHN2Zz0nPHN2ZyB2ZXJzaW9uPVwiMS4xXCIgaWQ9XCJMYXllcl8xXCIgeG1sbnM9XCJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2Z1wiIHhtbG5zOnhsaW5rPVwiaHR0cDovL3d3dy53My5vcmcvMTk5OS94bGlua1wiIHg9XCIwcHhcIiB5PVwiMHB4XCIgd2lkdGg9XCInK3dpZHRoKydwdFwiIGhlaWdodD1cIicraGVpZ2h0KydwdFwiICdcdFxyXG5cdCsndmlld0JveD1cIjEzNy44MzQgLTgyLjgzMyAxMTQgOTEuMzMzXCIgZW5hYmxlLWJhY2tncm91bmQ9XCJuZXcgMTM3LjgzNCAtODIuODMzIDExNCA5MS4zMzNcIiB4bWw6c3BhY2U9XCJwcmVzZXJ2ZVwiPidcclxuXHQrJzxwYXRoIGZpbGw9XCJub25lXCIgZD1cIk0tNTEtMi4xNjdoNDh2NDhoLTQ4Vi0yLjE2N3pcIi8+J1xyXG5cdCsnPGNpcmNsZSBkaXNwbGF5PVwibm9uZVwiIGZpbGw9XCIjNjA1Q0M5XCIgY3g9XCI1MS4yODZcIiBjeT1cIi0zNS4yODZcIiByPVwiODguNzg2XCIvPidcclxuXHQrJzxwYXRoIGZpbGw9XCIjNjA1Q0M5XCIgc3Ryb2tlPVwiI0ZGRkZGRlwiIHN0cm9rZS13aWR0aD1cIjRcIiBzdHJva2UtbWl0ZXJsaW1pdD1cIjEwXCIgZD1cIk0yMzkuNS0zNi44bC05Mi41NTgtMzUuNjkgYzUuMjE2LDExLjMwNCw4LjEzLDIzLjg4Nyw4LjEzLDM3LjE1M2MwLDEyLjE3LTIuNDUxLDIzLjc2Ny02Ljg4MywzNC4zMjdMMjM5LjUtMzYuOHpcIi8+J1xyXG5cdCsnPC9zdmc+J1xyXG5cdHZhciBzdmc9c3ZnLnNwbGl0KFwiIzYwNUNDOVwiKS5qb2luKGNvbG9yKTtcclxuXHR2YXIgY2FudmFzID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnY2FudmFzJyk7XHJcbiAgICBjYW52YXMud2lkdGggPSB3aWR0aDtcclxuICAgIGNhbnZhcy5oZWlnaHQgPSBoZWlnaHQ7XHJcbiAgICBjYW52ZyhjYW52YXMsIHN2Zyx7IGlnbm9yZU1vdXNlOiB0cnVlLCBpZ25vcmVBbmltYXRpb246IHRydWUgfSk7XHJcbiAgICByZXR1cm4gUkVOREVSRURBUlJPV1Nba2V5XT1jYW52YXMudG9EYXRhVVJMKCk7XHJcbn1cclxuXHJcbnZhciBSRU5ERVJFRERJUkVDVElPTlM9e307XHJcbmZ1bmN0aW9uIHJlbmRlckRpcmVjdGlvbkJhc2U2NCh3aWR0aCxoZWlnaHQsY29sb3IpIFxyXG57XHJcblx0dmFyIGtleSA9IHdpZHRoK1wieFwiK2hlaWdodCtcIjpcIitjb2xvcjtcclxuXHRpZiAoUkVOREVSRURESVJFQ1RJT05TW2tleV0pXHJcblx0XHRyZXR1cm4gUkVOREVSRURESVJFQ1RJT05TW2tleV07XHJcblxyXG5cdHZhciBzdmc9Jzxzdmcgd2lkdGg9XCInK3dpZHRoKydwdFwiIGhlaWdodD1cIicraGVpZ2h0KydwdFwiICdcclxuXHJcblx0XHQrJ3ZpZXdCb3g9XCIxNSA5IDE5Ljc1IDI5LjVcIiBlbmFibGUtYmFja2dyb3VuZD1cIm5ldyAxNSA5IDE5Ljc1IDI5LjVcIiB4bWw6c3BhY2U9XCJwcmVzZXJ2ZVwiPidcclxuXHRcdCsnPHBhdGggZmlsbD1cIiNGRkZFRkZcIiBkPVwiTTE3LjE3LDMyLjkybDkuMTctOS4xN2wtOS4xNy05LjE3TDIwLDExLjc1bDEyLDEybC0xMiwxMkwxNy4xNywzMi45MnpcIi8+J1xyXG5cdFx0Kyc8cGF0aCBmaWxsPVwibm9uZVwiIGQ9XCJNMC0wLjI1aDQ4djQ4SDBWLTAuMjV6XCIvPidcclxuXHJcblx0Kyc8L3N2Zz4nO1xyXG5cclxuXHR2YXIgc3ZnPXN2Zy5zcGxpdChcIiMwMDAwMDBcIikuam9pbihjb2xvcik7XHJcblx0dmFyIGNhbnZhcyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2NhbnZhcycpO1xyXG4gICAgY2FudmFzLndpZHRoID0gd2lkdGg7XHJcbiAgICBjYW52YXMuaGVpZ2h0ID0gaGVpZ2h0O1xyXG4gICAgY2FudmcoY2FudmFzLCBzdmcseyBpZ25vcmVNb3VzZTogdHJ1ZSwgaWdub3JlQW5pbWF0aW9uOiB0cnVlIH0pO1xyXG4gICAgcmV0dXJuIFJFTkRFUkVERElSRUNUSU9OU1trZXldPWNhbnZhcy50b0RhdGFVUkwoKTtcclxufVxyXG5cclxudmFyIFJFTkRFUkVCT1hFUz17fTtcclxuZnVuY3Rpb24gcmVuZGVyQm94QmFzZTY0KHdpZHRoLGhlaWdodCxjb2xvcikgXHJcbntcclxuXHR2YXIga2V5ID0gd2lkdGgrXCJ4XCIraGVpZ2h0K1wiOlwiK2NvbG9yO1xyXG5cdGlmIChSRU5ERVJFQk9YRVNba2V5XSlcclxuXHRcdHJldHVybiBSRU5ERVJFQk9YRVNba2V5XTtcclxuXHJcblx0dmFyIHN2Zz0nPHN2ZyB3aWR0aD1cIicrd2lkdGgrJ3B0XCIgaGVpZ2h0PVwiJytoZWlnaHQrJ3B0XCIgdmlld0JveD1cIjAgMCA1MTIgNTEyXCIgdmVyc2lvbj1cIjEuMVwiIHhtbG5zPVwiaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmdcIj4nXHJcblx0Kyc8ZyBpZD1cIiNmZmZmZmZmZlwiPidcclxuXHQrJzxwYXRoIGZpbGw9XCIjZmZmZmZmXCIgb3BhY2l0eT1cIjEuMDBcIiBkPVwiIE0gNTUuNTAgMC4wMCBMIDQ1OC40NSAwLjAwIEMgNDcyLjQ0IDAuOTkgNDg2LjAzIDcuMDkgNDk1Ljc4IDE3LjIzIEMgNTA1LjM0IDI2Ljg4IDUxMS4wMSA0MC4wNCA1MTIuMDAgNTMuNTUgTCA1MTIuMDAgNDU4LjQ0IEMgNTEwLjk5IDQ3Mi40MyA1MDQuOTAgNDg2LjAxIDQ5NC43NyA0OTUuNzcgQyA0ODUuMTEgNTA1LjMyIDQ3MS45NiA1MTEuMDEgNDU4LjQ1IDUxMi4wMCBMIDUzLjU2IDUxMi4wMCBDIDM5LjU3IDUxMC45OSAyNS45NyA1MDQuOTEgMTYuMjIgNDk0Ljc4IEMgNi42NyA0ODUuMTIgMC45NyA0NzEuOTcgMC4wMCA0NTguNDUgTCAwLjAwIDU1LjUwIEMgMC40MCA0MS4wNyA2LjQ1IDI2Ljg5IDE2Ljc0IDE2LjczIEMgMjYuODkgNi40NSA0MS4wNyAwLjQxIDU1LjUwIDAuMDAgTSA1Ni45MCA1Ni45MCBDIDU2Ljg3IDE4OS42MyA1Ni44NiAzMjIuMzYgNTYuOTAgNDU1LjA5IEMgMTg5LjYzIDQ1NS4xMiAzMjIuMzYgNDU1LjEyIDQ1NS4wOSA0NTUuMDkgQyA0NTUuMTIgMzIyLjM2IDQ1NS4xMiAxODkuNjMgNDU1LjA5IDU2LjkwIEMgMzIyLjM2IDU2Ljg2IDE4OS42MyA1Ni44NyA1Ni45MCA1Ni45MCBaXCIgLz4nXHJcblx0Kyc8L2c+J1xyXG5cdCsnPGcgaWQ9XCIjMDAwMDAwZmZcIj4nXHJcblx0Kyc8cGF0aCBmaWxsPVwiIzAwMDAwMFwiIG9wYWNpdHk9XCIxLjAwXCIgZD1cIiBNIDU2LjkwIDU2LjkwIEMgMTg5LjYzIDU2Ljg3IDMyMi4zNiA1Ni44NiA0NTUuMDkgNTYuOTAgQyA0NTUuMTIgMTg5LjYzIDQ1NS4xMiAzMjIuMzYgNDU1LjA5IDQ1NS4wOSBDIDMyMi4zNiA0NTUuMTIgMTg5LjYzIDQ1NS4xMiA1Ni45MCA0NTUuMDkgQyA1Ni44NiAzMjIuMzYgNTYuODcgMTg5LjYzIDU2LjkwIDU2LjkwIFpcIiAvPidcclxuXHQrJzwvZz4nXHJcblx0Kyc8L3N2Zz4nO1xyXG5cclxuXHR2YXIgc3ZnPXN2Zy5zcGxpdChcIiMwMDAwMDBcIikuam9pbihjb2xvcik7XHJcblx0dmFyIGNhbnZhcyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2NhbnZhcycpO1xyXG4gICAgY2FudmFzLndpZHRoID0gd2lkdGg7XHJcbiAgICBjYW52YXMuaGVpZ2h0ID0gaGVpZ2h0O1xyXG4gICAgY2FudmcoY2FudmFzLCBzdmcseyBpZ25vcmVNb3VzZTogdHJ1ZSwgaWdub3JlQW5pbWF0aW9uOiB0cnVlIH0pO1xyXG4gICAgcmV0dXJuIFJFTkRFUkVCT1hFU1trZXldPWNhbnZhcy50b0RhdGFVUkwoKTtcclxufVxyXG5cclxuXHJcbmZ1bmN0aW9uIGludGVyY2VwdE9uQ2lyY2xlKGEsYixjLHIpIHtcclxuXHRyZXR1cm4gY2lyY2xlTGluZUludGVyc2VjdChhWzBdLGFbMV0sYlswXSxiWzFdLGNbMF0sY1sxXSxyKTtcdFxyXG59XHJcbmZ1bmN0aW9uIGRpc3RwKHAxLHAyKSB7XHJcblx0ICByZXR1cm4gTWF0aC5zcXJ0KChwMlswXS1wMVswXSkqKHAyWzBdLXAxWzBdKSsocDJbMV0tcDFbMV0pKihwMlsxXS1wMVsxXSkpO1xyXG59XHJcblxyXG5mdW5jdGlvbiBjaXJjbGVMaW5lSW50ZXJzZWN0KHgxLCB5MSwgeDIsIHkyLCBjeCwgY3ksIGNyICkgXHJcbntcclxuXHQgIGZ1bmN0aW9uIGRpc3QoeDEseTEseDIseTIpIHtcclxuXHRcdCAgcmV0dXJuIE1hdGguc3FydCgoeDIteDEpKih4Mi14MSkrKHkyLXkxKSooeTIteTEpKTtcclxuXHQgIH1cclxuXHQgIHZhciBkeCA9IHgyIC0geDE7XHJcblx0ICB2YXIgZHkgPSB5MiAtIHkxO1xyXG5cdCAgdmFyIGEgPSBkeCAqIGR4ICsgZHkgKiBkeTtcclxuXHQgIHZhciBiID0gMiAqIChkeCAqICh4MSAtIGN4KSArIGR5ICogKHkxIC0gY3kpKTtcclxuXHQgIHZhciBjID0gY3ggKiBjeCArIGN5ICogY3k7XHJcblx0ICBjICs9IHgxICogeDEgKyB5MSAqIHkxO1xyXG5cdCAgYyAtPSAyICogKGN4ICogeDEgKyBjeSAqIHkxKTtcclxuXHQgIGMgLT0gY3IgKiBjcjtcclxuXHQgIHZhciBiYjRhYyA9IGIgKiBiIC0gNCAqIGEgKiBjO1xyXG5cdCAgaWYgKGJiNGFjIDwgMCkgeyAgLy8gTm90IGludGVyc2VjdGluZ1xyXG5cdCAgICByZXR1cm4gZmFsc2U7XHJcblx0ICB9IGVsc2Uge1xyXG5cdFx0dmFyIG11ID0gKC1iICsgTWF0aC5zcXJ0KCBiKmIgLSA0KmEqYyApKSAvICgyKmEpO1xyXG5cdFx0dmFyIGl4MSA9IHgxICsgbXUqKGR4KTtcclxuXHRcdHZhciBpeTEgPSB5MSArIG11KihkeSk7XHJcblx0ICAgIG11ID0gKC1iIC0gTWF0aC5zcXJ0KGIqYiAtIDQqYSpjICkpIC8gKDIqYSk7XHJcblx0ICAgIHZhciBpeDIgPSB4MSArIG11KihkeCk7XHJcblx0ICAgIHZhciBpeTIgPSB5MSArIG11KihkeSk7XHJcblxyXG5cdCAgICAvLyBUaGUgaW50ZXJzZWN0aW9uIHBvaW50c1xyXG5cdCAgICAvL2VsbGlwc2UoaXgxLCBpeTEsIDEwLCAxMCk7XHJcblx0ICAgIC8vZWxsaXBzZShpeDIsIGl5MiwgMTAsIDEwKTtcclxuXHQgICAgXHJcblx0ICAgIHZhciB0ZXN0WDtcclxuXHQgICAgdmFyIHRlc3RZO1xyXG5cdCAgICAvLyBGaWd1cmUgb3V0IHdoaWNoIHBvaW50IGlzIGNsb3NlciB0byB0aGUgY2lyY2xlXHJcblx0ICAgIGlmIChkaXN0KHgxLCB5MSwgY3gsIGN5KSA8IGRpc3QoeDIsIHkyLCBjeCwgY3kpKSB7XHJcblx0ICAgICAgdGVzdFggPSB4MjtcclxuXHQgICAgICB0ZXN0WSA9IHkyO1xyXG5cdCAgICB9IGVsc2Uge1xyXG5cdCAgICAgIHRlc3RYID0geDE7XHJcblx0ICAgICAgdGVzdFkgPSB5MTtcclxuXHQgICAgfVxyXG5cdCAgICAgXHJcblx0ICAgIGlmIChkaXN0KHRlc3RYLCB0ZXN0WSwgaXgxLCBpeTEpIDwgZGlzdCh4MSwgeTEsIHgyLCB5MikgfHwgZGlzdCh0ZXN0WCwgdGVzdFksIGl4MiwgaXkyKSA8IGRpc3QoeDEsIHkxLCB4MiwgeTIpKSB7XHJcblx0ICAgICAgcmV0dXJuIFsgW2l4MSxpeTFdLFtpeDIsaXkyXSBdO1xyXG5cdCAgICB9IGVsc2Uge1xyXG5cdCAgICAgIHJldHVybiBmYWxzZTtcclxuXHQgICAgfVxyXG5cdCAgfVxyXG59XHJcblxyXG5mdW5jdGlvbiBkZWNvZGVCYXNlNjRJbWFnZShkYXRhU3RyaW5nKSB7XHJcblx0ICB2YXIgbWF0Y2hlcyA9IGRhdGFTdHJpbmcubWF0Y2goL15kYXRhOihbQS1aYS16LStcXC9dKyk7YmFzZTY0LCguKykkLyksXHJcblx0ICAgIHJlc3BvbnNlID0ge307XHJcblx0ICBpZiAobWF0Y2hlcy5sZW5ndGggIT09IDMpIHtcclxuXHQgICAgcmV0dXJuIG5ldyBFcnJvcignSW52YWxpZCBpbnB1dCBzdHJpbmcnKTtcclxuXHQgIH1cclxuXHQgIHJlc3BvbnNlLnR5cGUgPSBtYXRjaGVzWzFdO1xyXG5cdCAgcmVzcG9uc2UuZGF0YSA9IG5ldyBCdWZmZXIobWF0Y2hlc1syXSwgJ2Jhc2U2NCcpO1xyXG5cdCAgcmV0dXJuIHJlc3BvbnNlO1xyXG5cdH1cclxuXHJcbi8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcbmV4cG9ydHMubXlUcmltPW15VHJpbTtcclxuZXhwb3J0cy5teVRyaW1Db29yZGluYXRlPW15VHJpbUNvb3JkaW5hdGU7XHJcbmV4cG9ydHMuY2xvc2VzdFByb2plY3Rpb25PZlBvaW50T25MaW5lPWNsb3Nlc3RQcm9qZWN0aW9uT2ZQb2ludE9uTGluZTtcclxuZXhwb3J0cy5jb2xvckx1bWluYW5jZT1jb2xvckx1bWluYW5jZTtcclxuZXhwb3J0cy5pbmNyZWFzZUJyaWdodG5lc3M9aW5jcmVhc2VCcmlnaHRuZXNzO1xyXG5leHBvcnRzLmNvbG9yQWxwaGFBcnJheT1jb2xvckFscGhhQXJyYXk7XHJcbmV4cG9ydHMuZXNjYXBlSFRNTD1lc2NhcGVIVE1MO1xyXG5leHBvcnRzLmZvcm1hdE51bWJlcjI9Zm9ybWF0TnVtYmVyMjtcclxuZXhwb3J0cy5mb3JtYXREYXRlVGltZT1mb3JtYXREYXRlVGltZTtcclxuZXhwb3J0cy5mb3JtYXREYXRlVGltZVNlYz1mb3JtYXREYXRlVGltZVNlYztcclxuZXhwb3J0cy5mb3JtYXREYXRlPWZvcm1hdERhdGU7XHJcbmV4cG9ydHMuZm9ybWF0VGltZT1mb3JtYXRUaW1lO1xyXG5leHBvcnRzLnJhaW5ib3c9cmFpbmJvdztcclxuZXhwb3J0cy5tb2JpbGVBbmRUYWJsZXRDaGVjaz1tb2JpbGVBbmRUYWJsZXRDaGVjaztcclxuZXhwb3J0cy5yZW5kZXJBcnJvd0Jhc2U2ND1yZW5kZXJBcnJvd0Jhc2U2NDtcclxuZXhwb3J0cy5yZW5kZXJEaXJlY3Rpb25CYXNlNjQ9cmVuZGVyRGlyZWN0aW9uQmFzZTY0O1xyXG5leHBvcnRzLnJlbmRlckJveEJhc2U2ND1yZW5kZXJCb3hCYXNlNjQ7XHJcbmV4cG9ydHMuaW50ZXJjZXB0T25DaXJjbGU9aW50ZXJjZXB0T25DaXJjbGU7XHJcbmV4cG9ydHMuZGlzdHA9ZGlzdHA7XHJcbmV4cG9ydHMuY2lyY2xlTGluZUludGVyc2VjdD1jaXJjbGVMaW5lSW50ZXJzZWN0O1xyXG5leHBvcnRzLk1PQklMRT1tb2JpbGVBbmRUYWJsZXRDaGVjaygpO1xyXG5leHBvcnRzLldHUzg0U1BIRVJFPW5ldyBXR1M4NFNwaGVyZSg2Mzc4MTM3KTtcclxuZXhwb3J0cy5mb3JtYXRUaW1lU2VjPWZvcm1hdFRpbWVTZWM7XHJcbmV4cG9ydHMuZGVjb2RlQmFzZTY0SW1hZ2U9ZGVjb2RlQmFzZTY0SW1hZ2U7XHJcbmV4cG9ydHMuaXNEZWZpbmVkPWlzRGVmaW5lZDsiLCI7IWZ1bmN0aW9uICgpIHs7XG52YXIgSm9vc2UgPSB7fVxuXG4vLyBjb25maWd1cmF0aW9uIGhhc2hcblxuSm9vc2UuQyAgICAgICAgICAgICA9IHR5cGVvZiBKT09TRV9DRkcgIT0gJ3VuZGVmaW5lZCcgPyBKT09TRV9DRkcgOiB7fVxuXG5Kb29zZS5pc19JRSAgICAgICAgID0gJ1xcdicgPT0gJ3YnXG5Kb29zZS5pc19Ob2RlSlMgICAgID0gQm9vbGVhbih0eXBlb2YgcHJvY2VzcyAhPSAndW5kZWZpbmVkJyAmJiBwcm9jZXNzLnBpZClcblxuXG5Kb29zZS50b3AgICAgICAgICAgID0gSm9vc2UuaXNfTm9kZUpTICYmIGdsb2JhbCB8fCB0aGlzXG5cbkpvb3NlLnN0dWIgICAgICAgICAgPSBmdW5jdGlvbiAoKSB7XG4gICAgcmV0dXJuIGZ1bmN0aW9uICgpIHsgdGhyb3cgbmV3IEVycm9yKFwiTW9kdWxlcyBjYW4gbm90IGJlIGluc3RhbnRpYXRlZFwiKSB9XG59XG5cblxuSm9vc2UuVkVSU0lPTiAgICAgICA9ICh7IC8qUEtHVkVSU0lPTiovVkVSU0lPTiA6ICczLjUwLjAnIH0pLlZFUlNJT05cblxuXG5pZiAodHlwZW9mIG1vZHVsZSAhPSAndW5kZWZpbmVkJykgbW9kdWxlLmV4cG9ydHMgPSBKb29zZVxuLyppZiAoIUpvb3NlLmlzX05vZGVKUykgKi9cbnRoaXMuSm9vc2UgPSBKb29zZVxuXG5cbi8vIFN0YXRpYyBoZWxwZXJzIGZvciBBcnJheXNcbkpvb3NlLkEgPSB7XG5cbiAgICBlYWNoIDogZnVuY3Rpb24gKGFycmF5LCBmdW5jLCBzY29wZSkge1xuICAgICAgICBzY29wZSA9IHNjb3BlIHx8IHRoaXNcbiAgICAgICAgXG4gICAgICAgIGZvciAodmFyIGkgPSAwLCBsZW4gPSBhcnJheS5sZW5ndGg7IGkgPCBsZW47IGkrKykgXG4gICAgICAgICAgICBpZiAoZnVuYy5jYWxsKHNjb3BlLCBhcnJheVtpXSwgaSkgPT09IGZhbHNlKSByZXR1cm4gZmFsc2VcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGVhY2hSIDogZnVuY3Rpb24gKGFycmF5LCBmdW5jLCBzY29wZSkge1xuICAgICAgICBzY29wZSA9IHNjb3BlIHx8IHRoaXNcblxuICAgICAgICBmb3IgKHZhciBpID0gYXJyYXkubGVuZ3RoIC0gMTsgaSA+PSAwOyBpLS0pIFxuICAgICAgICAgICAgaWYgKGZ1bmMuY2FsbChzY29wZSwgYXJyYXlbaV0sIGkpID09PSBmYWxzZSkgcmV0dXJuIGZhbHNlXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBleGlzdHMgOiBmdW5jdGlvbiAoYXJyYXksIHZhbHVlKSB7XG4gICAgICAgIGZvciAodmFyIGkgPSAwLCBsZW4gPSBhcnJheS5sZW5ndGg7IGkgPCBsZW47IGkrKykgaWYgKGFycmF5W2ldID09IHZhbHVlKSByZXR1cm4gdHJ1ZVxuICAgICAgICAgICAgXG4gICAgICAgIHJldHVybiBmYWxzZVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgbWFwIDogZnVuY3Rpb24gKGFycmF5LCBmdW5jLCBzY29wZSkge1xuICAgICAgICBzY29wZSA9IHNjb3BlIHx8IHRoaXNcbiAgICAgICAgXG4gICAgICAgIHZhciByZXMgPSBbXVxuICAgICAgICBcbiAgICAgICAgZm9yICh2YXIgaSA9IDAsIGxlbiA9IGFycmF5Lmxlbmd0aDsgaSA8IGxlbjsgaSsrKSBcbiAgICAgICAgICAgIHJlcy5wdXNoKCBmdW5jLmNhbGwoc2NvcGUsIGFycmF5W2ldLCBpKSApXG4gICAgICAgICAgICBcbiAgICAgICAgcmV0dXJuIHJlc1xuICAgIH0sXG4gICAgXG5cbiAgICBncmVwIDogZnVuY3Rpb24gKGFycmF5LCBmdW5jKSB7XG4gICAgICAgIHZhciBhID0gW11cbiAgICAgICAgXG4gICAgICAgIEpvb3NlLkEuZWFjaChhcnJheSwgZnVuY3Rpb24gKHQpIHtcbiAgICAgICAgICAgIGlmIChmdW5jKHQpKSBhLnB1c2godClcbiAgICAgICAgfSlcbiAgICAgICAgXG4gICAgICAgIHJldHVybiBhXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICByZW1vdmUgOiBmdW5jdGlvbiAoYXJyYXksIHJlbW92ZUVsZSkge1xuICAgICAgICB2YXIgYSA9IFtdXG4gICAgICAgIFxuICAgICAgICBKb29zZS5BLmVhY2goYXJyYXksIGZ1bmN0aW9uICh0KSB7XG4gICAgICAgICAgICBpZiAodCAhPT0gcmVtb3ZlRWxlKSBhLnB1c2godClcbiAgICAgICAgfSlcbiAgICAgICAgXG4gICAgICAgIHJldHVybiBhXG4gICAgfVxuICAgIFxufVxuXG4vLyBTdGF0aWMgaGVscGVycyBmb3IgU3RyaW5nc1xuSm9vc2UuUyA9IHtcbiAgICBcbiAgICBzYW5lU3BsaXQgOiBmdW5jdGlvbiAoc3RyLCBkZWxpbWV0ZXIpIHtcbiAgICAgICAgdmFyIHJlcyA9IChzdHIgfHwgJycpLnNwbGl0KGRlbGltZXRlcilcbiAgICAgICAgXG4gICAgICAgIGlmIChyZXMubGVuZ3RoID09IDEgJiYgIXJlc1swXSkgcmVzLnNoaWZ0KClcbiAgICAgICAgXG4gICAgICAgIHJldHVybiByZXNcbiAgICB9LFxuICAgIFxuXG4gICAgdXBwZXJjYXNlRmlyc3QgOiBmdW5jdGlvbiAoc3RyaW5nKSB7IFxuICAgICAgICByZXR1cm4gc3RyaW5nLnN1YnN0cigwLCAxKS50b1VwcGVyQ2FzZSgpICsgc3RyaW5nLnN1YnN0cigxLCBzdHJpbmcubGVuZ3RoIC0gMSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIHN0clRvQ2xhc3MgOiBmdW5jdGlvbiAobmFtZSwgdG9wKSB7XG4gICAgICAgIHZhciBjdXJyZW50ID0gdG9wIHx8IEpvb3NlLnRvcFxuICAgICAgICBcbiAgICAgICAgSm9vc2UuQS5lYWNoKG5hbWUuc3BsaXQoJy4nKSwgZnVuY3Rpb24gKHNlZ21lbnQpIHtcbiAgICAgICAgICAgIGlmIChjdXJyZW50KSBcbiAgICAgICAgICAgICAgICBjdXJyZW50ID0gY3VycmVudFsgc2VnbWVudCBdXG4gICAgICAgICAgICBlbHNlXG4gICAgICAgICAgICAgICAgcmV0dXJuIGZhbHNlXG4gICAgICAgIH0pXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gY3VycmVudFxuICAgIH1cbn1cblxudmFyIGJhc2VGdW5jICAgID0gZnVuY3Rpb24gKCkge31cblxuLy8gU3RhdGljIGhlbHBlcnMgZm9yIG9iamVjdHNcbkpvb3NlLk8gPSB7XG5cbiAgICBlYWNoIDogZnVuY3Rpb24gKG9iamVjdCwgZnVuYywgc2NvcGUpIHtcbiAgICAgICAgc2NvcGUgPSBzY29wZSB8fCB0aGlzXG4gICAgICAgIFxuICAgICAgICBmb3IgKHZhciBpIGluIG9iamVjdCkgXG4gICAgICAgICAgICBpZiAoZnVuYy5jYWxsKHNjb3BlLCBvYmplY3RbaV0sIGkpID09PSBmYWxzZSkgcmV0dXJuIGZhbHNlXG4gICAgICAgIFxuICAgICAgICBpZiAoSm9vc2UuaXNfSUUpIFxuICAgICAgICAgICAgcmV0dXJuIEpvb3NlLkEuZWFjaChbICd0b1N0cmluZycsICdjb25zdHJ1Y3RvcicsICdoYXNPd25Qcm9wZXJ0eScgXSwgZnVuY3Rpb24gKGVsKSB7XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgaWYgKG9iamVjdC5oYXNPd25Qcm9wZXJ0eShlbCkpIHJldHVybiBmdW5jLmNhbGwoc2NvcGUsIG9iamVjdFtlbF0sIGVsKVxuICAgICAgICAgICAgfSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGVhY2hPd24gOiBmdW5jdGlvbiAob2JqZWN0LCBmdW5jLCBzY29wZSkge1xuICAgICAgICBzY29wZSA9IHNjb3BlIHx8IHRoaXNcbiAgICAgICAgXG4gICAgICAgIHJldHVybiBKb29zZS5PLmVhY2gob2JqZWN0LCBmdW5jdGlvbiAodmFsdWUsIG5hbWUpIHtcbiAgICAgICAgICAgIGlmIChvYmplY3QuaGFzT3duUHJvcGVydHkobmFtZSkpIHJldHVybiBmdW5jLmNhbGwoc2NvcGUsIHZhbHVlLCBuYW1lKVxuICAgICAgICB9LCBzY29wZSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGNvcHkgOiBmdW5jdGlvbiAoc291cmNlLCB0YXJnZXQpIHtcbiAgICAgICAgdGFyZ2V0ID0gdGFyZ2V0IHx8IHt9XG4gICAgICAgIFxuICAgICAgICBKb29zZS5PLmVhY2goc291cmNlLCBmdW5jdGlvbiAodmFsdWUsIG5hbWUpIHsgdGFyZ2V0W25hbWVdID0gdmFsdWUgfSlcbiAgICAgICAgXG4gICAgICAgIHJldHVybiB0YXJnZXRcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGNvcHlPd24gOiBmdW5jdGlvbiAoc291cmNlLCB0YXJnZXQpIHtcbiAgICAgICAgdGFyZ2V0ID0gdGFyZ2V0IHx8IHt9XG4gICAgICAgIFxuICAgICAgICBKb29zZS5PLmVhY2hPd24oc291cmNlLCBmdW5jdGlvbiAodmFsdWUsIG5hbWUpIHsgdGFyZ2V0W25hbWVdID0gdmFsdWUgfSlcbiAgICAgICAgXG4gICAgICAgIHJldHVybiB0YXJnZXRcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGdldE11dGFibGVDb3B5IDogZnVuY3Rpb24gKG9iamVjdCkge1xuICAgICAgICBiYXNlRnVuYy5wcm90b3R5cGUgPSBvYmplY3RcbiAgICAgICAgXG4gICAgICAgIHJldHVybiBuZXcgYmFzZUZ1bmMoKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgZXh0ZW5kIDogZnVuY3Rpb24gKHRhcmdldCwgc291cmNlKSB7XG4gICAgICAgIHJldHVybiBKb29zZS5PLmNvcHkoc291cmNlLCB0YXJnZXQpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBpc0VtcHR5IDogZnVuY3Rpb24gKG9iamVjdCkge1xuICAgICAgICBmb3IgKHZhciBpIGluIG9iamVjdCkgaWYgKG9iamVjdC5oYXNPd25Qcm9wZXJ0eShpKSkgcmV0dXJuIGZhbHNlXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gdHJ1ZVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgaXNJbnN0YW5jZTogZnVuY3Rpb24gKG9iaikge1xuICAgICAgICByZXR1cm4gb2JqICYmIG9iai5tZXRhICYmIG9iai5jb25zdHJ1Y3RvciA9PSBvYmoubWV0YS5jXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBpc0NsYXNzIDogZnVuY3Rpb24gKG9iaikge1xuICAgICAgICByZXR1cm4gb2JqICYmIG9iai5tZXRhICYmIG9iai5tZXRhLmMgPT0gb2JqXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICB3YW50QXJyYXkgOiBmdW5jdGlvbiAob2JqKSB7XG4gICAgICAgIGlmIChvYmogaW5zdGFuY2VvZiBBcnJheSkgcmV0dXJuIG9ialxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIFsgb2JqIF1cbiAgICB9LFxuICAgIFxuICAgIFxuICAgIC8vIHRoaXMgd2FzIGEgYnVnIGluIFdlYktpdCwgd2hpY2ggZ2l2ZXMgdHlwZW9mIC8gLyA9PSAnZnVuY3Rpb24nXG4gICAgLy8gc2hvdWxkIGJlIG1vbml0b3JlZCBhbmQgcmVtb3ZlZCBhdCBzb21lIHBvaW50IGluIHRoZSBmdXR1cmVcbiAgICBpc0Z1bmN0aW9uIDogZnVuY3Rpb24gKG9iaikge1xuICAgICAgICByZXR1cm4gdHlwZW9mIG9iaiA9PSAnZnVuY3Rpb24nICYmIG9iai5jb25zdHJ1Y3RvciAhPSAvIC8uY29uc3RydWN0b3JcbiAgICB9XG59XG5cblxuLy9pbml0aWFsaXplcnNcblxuSm9vc2UuSSA9IHtcbiAgICBBcnJheSAgICAgICA6IGZ1bmN0aW9uICgpIHsgcmV0dXJuIFtdIH0sXG4gICAgT2JqZWN0ICAgICAgOiBmdW5jdGlvbiAoKSB7IHJldHVybiB7fSB9LFxuICAgIEZ1bmN0aW9uICAgIDogZnVuY3Rpb24gKCkgeyByZXR1cm4gYXJndW1lbnRzLmNhbGxlZSB9LFxuICAgIE5vdyAgICAgICAgIDogZnVuY3Rpb24gKCkgeyByZXR1cm4gbmV3IERhdGUoKSB9XG59O1xuSm9vc2UuUHJvdG8gPSBKb29zZS5zdHViKClcblxuSm9vc2UuUHJvdG8uRW1wdHkgPSBKb29zZS5zdHViKClcbiAgICBcbkpvb3NlLlByb3RvLkVtcHR5Lm1ldGEgPSB7fTtcbjsoZnVuY3Rpb24gKCkge1xuXG4gICAgSm9vc2UuUHJvdG8uT2JqZWN0ID0gSm9vc2Uuc3R1YigpXG4gICAgXG4gICAgXG4gICAgdmFyIFNVUEVSID0gZnVuY3Rpb24gKCkge1xuICAgICAgICB2YXIgc2VsZiA9IFNVUEVSLmNhbGxlclxuICAgICAgICBcbiAgICAgICAgaWYgKHNlbGYgPT0gU1VQRVJBUkcpIHNlbGYgPSBzZWxmLmNhbGxlclxuICAgICAgICBcbiAgICAgICAgaWYgKCFzZWxmLlNVUEVSKSB0aHJvdyBcIkludmFsaWQgY2FsbCB0byBTVVBFUlwiXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gc2VsZi5TVVBFUltzZWxmLm1ldGhvZE5hbWVdLmFwcGx5KHRoaXMsIGFyZ3VtZW50cylcbiAgICB9XG4gICAgXG4gICAgXG4gICAgdmFyIFNVUEVSQVJHID0gZnVuY3Rpb24gKCkge1xuICAgICAgICByZXR1cm4gdGhpcy5TVVBFUi5hcHBseSh0aGlzLCBhcmd1bWVudHNbMF0pXG4gICAgfVxuICAgIFxuICAgIFxuICAgIFxuICAgIEpvb3NlLlByb3RvLk9iamVjdC5wcm90b3R5cGUgPSB7XG4gICAgICAgIFxuICAgICAgICBTVVBFUkFSRyA6IFNVUEVSQVJHLFxuICAgICAgICBTVVBFUiA6IFNVUEVSLFxuICAgICAgICBcbiAgICAgICAgSU5ORVIgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB0aHJvdyBcIkludmFsaWQgY2FsbCB0byBJTk5FUlwiXG4gICAgICAgIH0sICAgICAgICAgICAgICAgIFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIEJVSUxEIDogZnVuY3Rpb24gKGNvbmZpZykge1xuICAgICAgICAgICAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGggPT0gMSAmJiB0eXBlb2YgY29uZmlnID09ICdvYmplY3QnICYmIGNvbmZpZyB8fCB7fVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIGluaXRpYWxpemU6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICB0b1N0cmluZzogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgcmV0dXJuIFwiYSBcIiArIHRoaXMubWV0YS5uYW1lXG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgfVxuICAgICAgICBcbiAgICBKb29zZS5Qcm90by5PYmplY3QubWV0YSA9IHtcbiAgICAgICAgY29uc3RydWN0b3IgICAgIDogSm9vc2UuUHJvdG8uT2JqZWN0LFxuICAgICAgICBcbiAgICAgICAgbWV0aG9kcyAgICAgICAgIDogSm9vc2UuTy5jb3B5KEpvb3NlLlByb3RvLk9iamVjdC5wcm90b3R5cGUpLFxuICAgICAgICBhdHRyaWJ1dGVzICAgICAgOiB7fVxuICAgIH1cbiAgICBcbiAgICBKb29zZS5Qcm90by5PYmplY3QucHJvdG90eXBlLm1ldGEgPSBKb29zZS5Qcm90by5PYmplY3QubWV0YVxuXG59KSgpO1xuOyhmdW5jdGlvbiAoKSB7XG5cbiAgICBKb29zZS5Qcm90by5DbGFzcyA9IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuaW5pdGlhbGl6ZSh0aGlzLkJVSUxELmFwcGx5KHRoaXMsIGFyZ3VtZW50cykpIHx8IHRoaXNcbiAgICB9XG4gICAgXG4gICAgdmFyIGJvb3RzdHJhcCA9IHtcbiAgICAgICAgXG4gICAgICAgIFZFUlNJT04gICAgICAgICAgICAgOiBudWxsLFxuICAgICAgICBBVVRIT1JJVFkgICAgICAgICAgIDogbnVsbCxcbiAgICAgICAgXG4gICAgICAgIGNvbnN0cnVjdG9yICAgICAgICAgOiBKb29zZS5Qcm90by5DbGFzcyxcbiAgICAgICAgc3VwZXJDbGFzcyAgICAgICAgICA6IG51bGwsXG4gICAgICAgIFxuICAgICAgICBuYW1lICAgICAgICAgICAgICAgIDogbnVsbCxcbiAgICAgICAgXG4gICAgICAgIGF0dHJpYnV0ZXMgICAgICAgICAgOiBudWxsLFxuICAgICAgICBtZXRob2RzICAgICAgICAgICAgIDogbnVsbCxcbiAgICAgICAgXG4gICAgICAgIG1ldGEgICAgICAgICAgICAgICAgOiBudWxsLFxuICAgICAgICBjICAgICAgICAgICAgICAgICAgIDogbnVsbCxcbiAgICAgICAgXG4gICAgICAgIGRlZmF1bHRTdXBlckNsYXNzICAgOiBKb29zZS5Qcm90by5PYmplY3QsXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgQlVJTEQgOiBmdW5jdGlvbiAobmFtZSwgZXh0ZW5kKSB7XG4gICAgICAgICAgICB0aGlzLm5hbWUgPSBuYW1lXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHJldHVybiB7IF9fZXh0ZW5kX18gOiBleHRlbmQgfHwge30gfVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIGluaXRpYWxpemU6IGZ1bmN0aW9uIChwcm9wcykge1xuICAgICAgICAgICAgdmFyIGV4dGVuZCAgICAgID0gcHJvcHMuX19leHRlbmRfX1xuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLlZFUlNJT04gICAgPSBleHRlbmQuVkVSU0lPTlxuICAgICAgICAgICAgdGhpcy5BVVRIT1JJVFkgID0gZXh0ZW5kLkFVVEhPUklUWVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBkZWxldGUgZXh0ZW5kLlZFUlNJT05cbiAgICAgICAgICAgIGRlbGV0ZSBleHRlbmQuQVVUSE9SSVRZXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXMuYyA9IHRoaXMuZXh0cmFjdENvbnN0cnVjdG9yKGV4dGVuZClcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpcy5hZGFwdENvbnN0cnVjdG9yKHRoaXMuYylcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKGV4dGVuZC5jb25zdHJ1Y3Rvck9ubHkpIHtcbiAgICAgICAgICAgICAgICBkZWxldGUgZXh0ZW5kLmNvbnN0cnVjdG9yT25seVxuICAgICAgICAgICAgICAgIHJldHVyblxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLmNvbnN0cnVjdChleHRlbmQpXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgY29uc3RydWN0IDogZnVuY3Rpb24gKGV4dGVuZCkge1xuICAgICAgICAgICAgaWYgKCF0aGlzLnByZXBhcmVQcm9wcyhleHRlbmQpKSByZXR1cm5cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdmFyIHN1cGVyQ2xhc3MgPSB0aGlzLnN1cGVyQ2xhc3MgPSB0aGlzLmV4dHJhY3RTdXBlckNsYXNzKGV4dGVuZClcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpcy5wcm9jZXNzU3VwZXJDbGFzcyhzdXBlckNsYXNzKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLmFkYXB0UHJvdG90eXBlKHRoaXMuYy5wcm90b3R5cGUpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXMuZmluYWxpemUoZXh0ZW5kKVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIGZpbmFsaXplIDogZnVuY3Rpb24gKGV4dGVuZCkge1xuICAgICAgICAgICAgdGhpcy5wcm9jZXNzU3RlbShleHRlbmQpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXMuZXh0ZW5kKGV4dGVuZClcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICAvL2lmIHRoZSBleHRlbnNpb24gcmV0dXJucyBmYWxzZSBmcm9tIHRoaXMgbWV0aG9kIGl0IHNob3VsZCByZS1lbnRlciAnY29uc3RydWN0J1xuICAgICAgICBwcmVwYXJlUHJvcHMgOiBmdW5jdGlvbiAoZXh0ZW5kKSB7XG4gICAgICAgICAgICByZXR1cm4gdHJ1ZVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIGV4dHJhY3RDb25zdHJ1Y3RvciA6IGZ1bmN0aW9uIChleHRlbmQpIHtcbiAgICAgICAgICAgIHZhciByZXMgPSBleHRlbmQuaGFzT3duUHJvcGVydHkoJ2NvbnN0cnVjdG9yJykgPyBleHRlbmQuY29uc3RydWN0b3IgOiB0aGlzLmRlZmF1bHRDb25zdHJ1Y3RvcigpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGRlbGV0ZSBleHRlbmQuY29uc3RydWN0b3JcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcmV0dXJuIHJlc1xuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIGV4dHJhY3RTdXBlckNsYXNzIDogZnVuY3Rpb24gKGV4dGVuZCkge1xuICAgICAgICAgICAgaWYgKGV4dGVuZC5oYXNPd25Qcm9wZXJ0eSgnaXNhJykgJiYgIWV4dGVuZC5pc2EpIHRocm93IG5ldyBFcnJvcihcIkF0dGVtcHQgdG8gaW5oZXJpdCBmcm9tIHVuZGVmaW5lZCBzdXBlcmNsYXNzIFtcIiArIHRoaXMubmFtZSArIFwiXVwiKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB2YXIgcmVzID0gZXh0ZW5kLmlzYSB8fCB0aGlzLmRlZmF1bHRTdXBlckNsYXNzXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGRlbGV0ZSBleHRlbmQuaXNhXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHJldHVybiByZXNcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBwcm9jZXNzU3RlbSA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHZhciBzdXBlck1ldGEgICAgICAgPSB0aGlzLnN1cGVyQ2xhc3MubWV0YVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLm1ldGhvZHMgICAgICAgID0gSm9vc2UuTy5nZXRNdXRhYmxlQ29weShzdXBlck1ldGEubWV0aG9kcyB8fCB7fSlcbiAgICAgICAgICAgIHRoaXMuYXR0cmlidXRlcyAgICAgPSBKb29zZS5PLmdldE11dGFibGVDb3B5KHN1cGVyTWV0YS5hdHRyaWJ1dGVzIHx8IHt9KVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIGluaXRJbnN0YW5jZSA6IGZ1bmN0aW9uIChpbnN0YW5jZSwgcHJvcHMpIHtcbiAgICAgICAgICAgIEpvb3NlLk8uY29weU93bihwcm9wcywgaW5zdGFuY2UpXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgZGVmYXVsdENvbnN0cnVjdG9yOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICByZXR1cm4gZnVuY3Rpb24gKGFyZykge1xuICAgICAgICAgICAgICAgIHZhciBCVUlMRCA9IHRoaXMuQlVJTERcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICB2YXIgYXJncyA9IEJVSUxEICYmIEJVSUxELmFwcGx5KHRoaXMsIGFyZ3VtZW50cykgfHwgYXJnIHx8IHt9XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgdmFyIHRoaXNNZXRhICAgID0gdGhpcy5tZXRhXG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgdGhpc01ldGEuaW5pdEluc3RhbmNlKHRoaXMsIGFyZ3MpXG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgcmV0dXJuIHRoaXNNZXRhLmhhc01ldGhvZCgnaW5pdGlhbGl6ZScpICYmIHRoaXMuaW5pdGlhbGl6ZShhcmdzKSB8fCB0aGlzXG4gICAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgcHJvY2Vzc1N1cGVyQ2xhc3M6IGZ1bmN0aW9uIChzdXBlckNsYXNzKSB7XG4gICAgICAgICAgICB2YXIgc3VwZXJQcm90byAgICAgID0gc3VwZXJDbGFzcy5wcm90b3R5cGVcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy9ub24tSm9vc2Ugc3VwZXJjbGFzc2VzXG4gICAgICAgICAgICBpZiAoIXN1cGVyQ2xhc3MubWV0YSkge1xuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIHZhciBleHRlbmQgPSBKb29zZS5PLmNvcHkoc3VwZXJQcm90bylcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBleHRlbmQuaXNhID0gSm9vc2UuUHJvdG8uRW1wdHlcbiAgICAgICAgICAgICAgICAvLyBjbGVhciBwb3RlbnRpYWwgdmFsdWUgaW4gdGhlIGBleHRlbmQuY29uc3RydWN0b3JgIHRvIHByZXZlbnQgaXQgZnJvbSBiZWluZyBtb2RpZmllZFxuICAgICAgICAgICAgICAgIGRlbGV0ZSBleHRlbmQuY29uc3RydWN0b3JcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICB2YXIgbWV0YSA9IG5ldyB0aGlzLmRlZmF1bHRTdXBlckNsYXNzLm1ldGEuY29uc3RydWN0b3IobnVsbCwgZXh0ZW5kKVxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIHN1cGVyQ2xhc3MubWV0YSA9IHN1cGVyUHJvdG8ubWV0YSA9IG1ldGFcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBtZXRhLmMgPSBzdXBlckNsYXNzXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXMuYy5wcm90b3R5cGUgICAgPSBKb29zZS5PLmdldE11dGFibGVDb3B5KHN1cGVyUHJvdG8pXG4gICAgICAgICAgICB0aGlzLmMuc3VwZXJDbGFzcyAgID0gc3VwZXJQcm90b1xuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIGFkYXB0Q29uc3RydWN0b3I6IGZ1bmN0aW9uIChjKSB7XG4gICAgICAgICAgICBjLm1ldGEgPSB0aGlzXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmICghYy5oYXNPd25Qcm9wZXJ0eSgndG9TdHJpbmcnKSkgYy50b1N0cmluZyA9IGZ1bmN0aW9uICgpIHsgcmV0dXJuIHRoaXMubWV0YS5uYW1lIH1cbiAgICAgICAgfSxcbiAgICBcbiAgICAgICAgXG4gICAgICAgIGFkYXB0UHJvdG90eXBlOiBmdW5jdGlvbiAocHJvdG8pIHtcbiAgICAgICAgICAgIC8vdGhpcyB3aWxsIGZpeCB3ZWlyZCBzZW1hbnRpYyBvZiBuYXRpdmUgXCJjb25zdHJ1Y3RvclwiIHByb3BlcnR5IHRvIG1vcmUgaW50dWl0aXZlIChpZGVhIGJvcnJvd2VkIGZyb20gRXh0KVxuICAgICAgICAgICAgcHJvdG8uY29uc3RydWN0b3IgICA9IHRoaXMuY1xuICAgICAgICAgICAgcHJvdG8ubWV0YSAgICAgICAgICA9IHRoaXNcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBhZGRNZXRob2Q6IGZ1bmN0aW9uIChuYW1lLCBmdW5jKSB7XG4gICAgICAgICAgICBmdW5jLlNVUEVSID0gdGhpcy5zdXBlckNsYXNzLnByb3RvdHlwZVxuICAgICAgICAgICAgXG4gICAgICAgICAgICAvL2Nocm9tZSBkb24ndCBhbGxvdyB0byByZWRlZmluZSB0aGUgXCJuYW1lXCIgcHJvcGVydHlcbiAgICAgICAgICAgIGZ1bmMubWV0aG9kTmFtZSA9IG5hbWVcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpcy5tZXRob2RzW25hbWVdID0gZnVuY1xuICAgICAgICAgICAgdGhpcy5jLnByb3RvdHlwZVtuYW1lXSA9IGZ1bmNcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBhZGRBdHRyaWJ1dGU6IGZ1bmN0aW9uIChuYW1lLCBpbml0KSB7XG4gICAgICAgICAgICB0aGlzLmF0dHJpYnV0ZXNbbmFtZV0gPSBpbml0XG4gICAgICAgICAgICB0aGlzLmMucHJvdG90eXBlW25hbWVdID0gaW5pdFxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIHJlbW92ZU1ldGhvZCA6IGZ1bmN0aW9uIChuYW1lKSB7XG4gICAgICAgICAgICBkZWxldGUgdGhpcy5tZXRob2RzW25hbWVdXG4gICAgICAgICAgICBkZWxldGUgdGhpcy5jLnByb3RvdHlwZVtuYW1lXVxuICAgICAgICB9LFxuICAgIFxuICAgICAgICBcbiAgICAgICAgcmVtb3ZlQXR0cmlidXRlOiBmdW5jdGlvbiAobmFtZSkge1xuICAgICAgICAgICAgZGVsZXRlIHRoaXMuYXR0cmlidXRlc1tuYW1lXVxuICAgICAgICAgICAgZGVsZXRlIHRoaXMuYy5wcm90b3R5cGVbbmFtZV1cbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBoYXNNZXRob2Q6IGZ1bmN0aW9uIChuYW1lKSB7IFxuICAgICAgICAgICAgcmV0dXJuIEJvb2xlYW4odGhpcy5tZXRob2RzW25hbWVdKVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIGhhc0F0dHJpYnV0ZTogZnVuY3Rpb24gKG5hbWUpIHsgXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5hdHRyaWJ1dGVzW25hbWVdICE9PSB1bmRlZmluZWRcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgXG4gICAgICAgIGhhc093bk1ldGhvZDogZnVuY3Rpb24gKG5hbWUpIHsgXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5oYXNNZXRob2QobmFtZSkgJiYgdGhpcy5tZXRob2RzLmhhc093blByb3BlcnR5KG5hbWUpXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgaGFzT3duQXR0cmlidXRlOiBmdW5jdGlvbiAobmFtZSkgeyBcbiAgICAgICAgICAgIHJldHVybiB0aGlzLmhhc0F0dHJpYnV0ZShuYW1lKSAmJiB0aGlzLmF0dHJpYnV0ZXMuaGFzT3duUHJvcGVydHkobmFtZSlcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBleHRlbmQgOiBmdW5jdGlvbiAocHJvcHMpIHtcbiAgICAgICAgICAgIEpvb3NlLk8uZWFjaE93bihwcm9wcywgZnVuY3Rpb24gKHZhbHVlLCBuYW1lKSB7XG4gICAgICAgICAgICAgICAgaWYgKG5hbWUgIT0gJ21ldGEnICYmIG5hbWUgIT0gJ2NvbnN0cnVjdG9yJykgXG4gICAgICAgICAgICAgICAgICAgIGlmIChKb29zZS5PLmlzRnVuY3Rpb24odmFsdWUpICYmICF2YWx1ZS5tZXRhKSBcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuYWRkTWV0aG9kKG5hbWUsIHZhbHVlKSBcbiAgICAgICAgICAgICAgICAgICAgZWxzZSBcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuYWRkQXR0cmlidXRlKG5hbWUsIHZhbHVlKVxuICAgICAgICAgICAgfSwgdGhpcylcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBzdWJDbGFzc09mIDogZnVuY3Rpb24gKGNsYXNzT2JqZWN0LCBleHRlbmQpIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLnN1YkNsYXNzKGV4dGVuZCwgbnVsbCwgY2xhc3NPYmplY3QpXG4gICAgICAgIH0sXG4gICAgXG4gICAgXG4gICAgICAgIHN1YkNsYXNzIDogZnVuY3Rpb24gKGV4dGVuZCwgbmFtZSwgY2xhc3NPYmplY3QpIHtcbiAgICAgICAgICAgIGV4dGVuZCAgICAgID0gZXh0ZW5kICAgICAgICB8fCB7fVxuICAgICAgICAgICAgZXh0ZW5kLmlzYSAgPSBjbGFzc09iamVjdCAgIHx8IHRoaXMuY1xuICAgICAgICAgICAgXG4gICAgICAgICAgICByZXR1cm4gbmV3IHRoaXMuY29uc3RydWN0b3IobmFtZSwgZXh0ZW5kKS5jXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgaW5zdGFudGlhdGUgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB2YXIgZiA9IGZ1bmN0aW9uICgpIHt9XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGYucHJvdG90eXBlID0gdGhpcy5jLnByb3RvdHlwZVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB2YXIgb2JqID0gbmV3IGYoKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5jLmFwcGx5KG9iaiwgYXJndW1lbnRzKSB8fCBvYmpcbiAgICAgICAgfVxuICAgIH1cbiAgICBcbiAgICAvL21pY3JvIGJvb3RzdHJhcGluZ1xuICAgIFxuICAgIEpvb3NlLlByb3RvLkNsYXNzLnByb3RvdHlwZSA9IEpvb3NlLk8uZ2V0TXV0YWJsZUNvcHkoSm9vc2UuUHJvdG8uT2JqZWN0LnByb3RvdHlwZSlcbiAgICBcbiAgICBKb29zZS5PLmV4dGVuZChKb29zZS5Qcm90by5DbGFzcy5wcm90b3R5cGUsIGJvb3RzdHJhcClcbiAgICBcbiAgICBKb29zZS5Qcm90by5DbGFzcy5wcm90b3R5cGUubWV0YSA9IG5ldyBKb29zZS5Qcm90by5DbGFzcygnSm9vc2UuUHJvdG8uQ2xhc3MnLCBib290c3RyYXApXG4gICAgXG4gICAgXG4gICAgXG4gICAgSm9vc2UuUHJvdG8uQ2xhc3MubWV0YS5hZGRNZXRob2QoJ2lzYScsIGZ1bmN0aW9uIChzb21lQ2xhc3MpIHtcbiAgICAgICAgdmFyIGYgPSBmdW5jdGlvbiAoKSB7fVxuICAgICAgICBcbiAgICAgICAgZi5wcm90b3R5cGUgPSB0aGlzLmMucHJvdG90eXBlXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gbmV3IGYoKSBpbnN0YW5jZW9mIHNvbWVDbGFzc1xuICAgIH0pXG59KSgpO1xuSm9vc2UuTWFuYWdlZCA9IEpvb3NlLnN0dWIoKVxuXG5Kb29zZS5NYW5hZ2VkLlByb3BlcnR5ID0gbmV3IEpvb3NlLlByb3RvLkNsYXNzKCdKb29zZS5NYW5hZ2VkLlByb3BlcnR5Jywge1xuICAgIFxuICAgIG5hbWUgICAgICAgICAgICA6IG51bGwsXG4gICAgXG4gICAgaW5pdCAgICAgICAgICAgIDogbnVsbCxcbiAgICB2YWx1ZSAgICAgICAgICAgOiBudWxsLFxuICAgIFxuICAgIGRlZmluZWRJbiAgICAgICA6IG51bGwsXG4gICAgXG4gICAgXG4gICAgaW5pdGlhbGl6ZSA6IGZ1bmN0aW9uIChwcm9wcykge1xuICAgICAgICBKb29zZS5NYW5hZ2VkLlByb3BlcnR5LnN1cGVyQ2xhc3MuaW5pdGlhbGl6ZS5jYWxsKHRoaXMsIHByb3BzKVxuICAgICAgICBcbiAgICAgICAgdGhpcy5jb21wdXRlVmFsdWUoKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgY29tcHV0ZVZhbHVlIDogZnVuY3Rpb24gKCkge1xuICAgICAgICB0aGlzLnZhbHVlID0gdGhpcy5pbml0XG4gICAgfSwgICAgXG4gICAgXG4gICAgXG4gICAgLy90YXJnZXRDbGFzcyBpcyBzdGlsbCBvcGVuIGF0IHRoaXMgc3RhZ2VcbiAgICBwcmVBcHBseSA6IGZ1bmN0aW9uICh0YXJnZXRDbGFzcykge1xuICAgIH0sXG4gICAgXG5cbiAgICAvL3RhcmdldENsYXNzIGlzIGFscmVhZHkgb3BlbiBhdCB0aGlzIHN0YWdlXG4gICAgcG9zdFVuQXBwbHkgOiBmdW5jdGlvbiAodGFyZ2V0Q2xhc3MpIHtcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGFwcGx5IDogZnVuY3Rpb24gKHRhcmdldCkge1xuICAgICAgICB0YXJnZXRbdGhpcy5uYW1lXSA9IHRoaXMudmFsdWVcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGlzQXBwbGllZFRvIDogZnVuY3Rpb24gKHRhcmdldCkge1xuICAgICAgICByZXR1cm4gdGFyZ2V0W3RoaXMubmFtZV0gPT0gdGhpcy52YWx1ZVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgdW5hcHBseSA6IGZ1bmN0aW9uIChmcm9tKSB7XG4gICAgICAgIGlmICghdGhpcy5pc0FwcGxpZWRUbyhmcm9tKSkgdGhyb3cgXCJVbmFwcGx5IG9mIHByb3BlcnR5IFtcIiArIHRoaXMubmFtZSArIFwiXSBmcm9tIFtcIiArIGZyb20gKyBcIl0gZmFpbGVkXCJcbiAgICAgICAgXG4gICAgICAgIGRlbGV0ZSBmcm9tW3RoaXMubmFtZV1cbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGNsb25lUHJvcHMgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBuYW1lICAgICAgICA6IHRoaXMubmFtZSwgXG4gICAgICAgICAgICBpbml0ICAgICAgICA6IHRoaXMuaW5pdCxcbiAgICAgICAgICAgIGRlZmluZWRJbiAgIDogdGhpcy5kZWZpbmVkSW5cbiAgICAgICAgfVxuICAgIH0sXG5cbiAgICBcbiAgICBjbG9uZSA6IGZ1bmN0aW9uIChuYW1lKSB7XG4gICAgICAgIHZhciBwcm9wcyA9IHRoaXMuY2xvbmVQcm9wcygpXG4gICAgICAgIFxuICAgICAgICBwcm9wcy5uYW1lID0gbmFtZSB8fCBwcm9wcy5uYW1lXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gbmV3IHRoaXMuY29uc3RydWN0b3IocHJvcHMpXG4gICAgfVxuICAgIFxuICAgIFxufSkuYztcbkpvb3NlLk1hbmFnZWQuUHJvcGVydHkuQ29uZmxpY3RNYXJrZXIgPSBuZXcgSm9vc2UuUHJvdG8uQ2xhc3MoJ0pvb3NlLk1hbmFnZWQuUHJvcGVydHkuQ29uZmxpY3RNYXJrZXInLCB7XG4gICAgXG4gICAgaXNhIDogSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eSxcblxuICAgIGFwcGx5IDogZnVuY3Rpb24gKHRhcmdldCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJBdHRlbXB0IHRvIGFwcGx5IENvbmZsaWN0TWFya2VyIFtcIiArIHRoaXMubmFtZSArIFwiXSB0byBbXCIgKyB0YXJnZXQgKyBcIl1cIilcbiAgICB9XG4gICAgXG59KS5jO1xuSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5SZXF1aXJlbWVudCA9IG5ldyBKb29zZS5Qcm90by5DbGFzcygnSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5SZXF1aXJlbWVudCcsIHtcbiAgICBcbiAgICBpc2EgOiBKb29zZS5NYW5hZ2VkLlByb3BlcnR5LFxuXG4gICAgXG4gICAgYXBwbHkgOiBmdW5jdGlvbiAodGFyZ2V0KSB7XG4gICAgICAgIGlmICghdGFyZ2V0Lm1ldGEuaGFzTWV0aG9kKHRoaXMubmFtZSkpIFxuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiUmVxdWlyZW1lbnQgW1wiICsgdGhpcy5uYW1lICsgXCJdLCBkZWZpbmVkIGluIFtcIiArIHRoaXMuZGVmaW5lZEluLmRlZmluZWRJbi5uYW1lICsgXCJdIGlzIG5vdCBzYXRpc2ZpZWQgZm9yIGNsYXNzIFtcIiArIHRhcmdldCArIFwiXVwiKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgdW5hcHBseSA6IGZ1bmN0aW9uIChmcm9tKSB7XG4gICAgfVxuICAgIFxufSkuYztcbkpvb3NlLk1hbmFnZWQuUHJvcGVydHkuQXR0cmlidXRlID0gbmV3IEpvb3NlLlByb3RvLkNsYXNzKCdKb29zZS5NYW5hZ2VkLlByb3BlcnR5LkF0dHJpYnV0ZScsIHtcbiAgICBcbiAgICBpc2EgOiBKb29zZS5NYW5hZ2VkLlByb3BlcnR5LFxuICAgIFxuICAgIHNsb3QgICAgICAgICAgICAgICAgOiBudWxsLFxuICAgIFxuICAgIFxuICAgIGluaXRpYWxpemUgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIEpvb3NlLk1hbmFnZWQuUHJvcGVydHkuQXR0cmlidXRlLnN1cGVyQ2xhc3MuaW5pdGlhbGl6ZS5hcHBseSh0aGlzLCBhcmd1bWVudHMpXG4gICAgICAgIFxuICAgICAgICB0aGlzLnNsb3QgPSB0aGlzLm5hbWVcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGFwcGx5IDogZnVuY3Rpb24gKHRhcmdldCkge1xuICAgICAgICB0YXJnZXQucHJvdG90eXBlWyB0aGlzLnNsb3QgXSA9IHRoaXMudmFsdWVcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGlzQXBwbGllZFRvIDogZnVuY3Rpb24gKHRhcmdldCkge1xuICAgICAgICByZXR1cm4gdGFyZ2V0LnByb3RvdHlwZVsgdGhpcy5zbG90IF0gPT0gdGhpcy52YWx1ZVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgdW5hcHBseSA6IGZ1bmN0aW9uIChmcm9tKSB7XG4gICAgICAgIGlmICghdGhpcy5pc0FwcGxpZWRUbyhmcm9tKSkgdGhyb3cgXCJVbmFwcGx5IG9mIHByb3BlcnR5IFtcIiArIHRoaXMubmFtZSArIFwiXSBmcm9tIFtcIiArIGZyb20gKyBcIl0gZmFpbGVkXCJcbiAgICAgICAgXG4gICAgICAgIGRlbGV0ZSBmcm9tLnByb3RvdHlwZVt0aGlzLnNsb3RdXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBjbGVhclZhbHVlIDogZnVuY3Rpb24gKGluc3RhbmNlKSB7XG4gICAgICAgIGRlbGV0ZSBpbnN0YW5jZVsgdGhpcy5zbG90IF1cbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGhhc1ZhbHVlIDogZnVuY3Rpb24gKGluc3RhbmNlKSB7XG4gICAgICAgIHJldHVybiBpbnN0YW5jZS5oYXNPd25Qcm9wZXJ0eSh0aGlzLnNsb3QpXG4gICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgIGdldFJhd1ZhbHVlRnJvbSA6IGZ1bmN0aW9uIChpbnN0YW5jZSkge1xuICAgICAgICByZXR1cm4gaW5zdGFuY2VbIHRoaXMuc2xvdCBdXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBzZXRSYXdWYWx1ZVRvIDogZnVuY3Rpb24gKGluc3RhbmNlLCB2YWx1ZSkge1xuICAgICAgICBpbnN0YW5jZVsgdGhpcy5zbG90IF0gPSB2YWx1ZVxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIHRoaXNcbiAgICB9XG4gICAgXG59KS5jO1xuSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5NZXRob2RNb2RpZmllciA9IG5ldyBKb29zZS5Qcm90by5DbGFzcygnSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5NZXRob2RNb2RpZmllcicsIHtcbiAgICBcbiAgICBpc2EgOiBKb29zZS5NYW5hZ2VkLlByb3BlcnR5LFxuXG4gICAgXG4gICAgcHJlcGFyZVdyYXBwZXIgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHRocm93IFwiQWJzdHJhY3QgbWV0aG9kIFtwcmVwYXJlV3JhcHBlcl0gb2YgXCIgKyB0aGlzICsgXCIgd2FzIGNhbGxlZFwiXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBhcHBseSA6IGZ1bmN0aW9uICh0YXJnZXQpIHtcbiAgICAgICAgdmFyIG5hbWUgICAgICAgICAgICA9IHRoaXMubmFtZVxuICAgICAgICB2YXIgdGFyZ2V0UHJvdG8gICAgID0gdGFyZ2V0LnByb3RvdHlwZVxuICAgICAgICB2YXIgaXNPd24gICAgICAgICAgID0gdGFyZ2V0UHJvdG8uaGFzT3duUHJvcGVydHkobmFtZSlcbiAgICAgICAgdmFyIG9yaWdpbmFsICAgICAgICA9IHRhcmdldFByb3RvW25hbWVdXG4gICAgICAgIHZhciBzdXBlclByb3RvICAgICAgPSB0YXJnZXQubWV0YS5zdXBlckNsYXNzLnByb3RvdHlwZVxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIHZhciBvcmlnaW5hbENhbGwgPSBpc093biA/IG9yaWdpbmFsIDogZnVuY3Rpb24gKCkgeyBcbiAgICAgICAgICAgIHJldHVybiBzdXBlclByb3RvW25hbWVdLmFwcGx5KHRoaXMsIGFyZ3VtZW50cykgXG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgICAgIHZhciBtZXRob2RXcmFwcGVyID0gdGhpcy5wcmVwYXJlV3JhcHBlcih7XG4gICAgICAgICAgICBuYW1lICAgICAgICAgICAgOiBuYW1lLFxuICAgICAgICAgICAgbW9kaWZpZXIgICAgICAgIDogdGhpcy52YWx1ZSwgXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlzT3duICAgICAgICAgICA6IGlzT3duLFxuICAgICAgICAgICAgb3JpZ2luYWxDYWxsICAgIDogb3JpZ2luYWxDYWxsLCBcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgc3VwZXJQcm90byAgICAgIDogc3VwZXJQcm90byxcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGFyZ2V0ICAgICAgICAgIDogdGFyZ2V0XG4gICAgICAgIH0pXG4gICAgICAgIFxuICAgICAgICBpZiAoaXNPd24pIG1ldGhvZFdyYXBwZXIuX19PUklHSU5BTF9fID0gb3JpZ2luYWxcbiAgICAgICAgXG4gICAgICAgIG1ldGhvZFdyYXBwZXIuX19DT05UQUlOX18gICA9IHRoaXMudmFsdWVcbiAgICAgICAgbWV0aG9kV3JhcHBlci5fX01FVEhPRF9fICAgID0gdGhpc1xuICAgICAgICBcbiAgICAgICAgdGFyZ2V0UHJvdG9bbmFtZV0gPSBtZXRob2RXcmFwcGVyXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBpc0FwcGxpZWRUbyA6IGZ1bmN0aW9uICh0YXJnZXQpIHtcbiAgICAgICAgdmFyIHRhcmdldENvbnQgPSB0YXJnZXQucHJvdG90eXBlW3RoaXMubmFtZV1cbiAgICAgICAgXG4gICAgICAgIHJldHVybiB0YXJnZXRDb250ICYmIHRhcmdldENvbnQuX19DT05UQUlOX18gPT0gdGhpcy52YWx1ZVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgdW5hcHBseSA6IGZ1bmN0aW9uIChmcm9tKSB7XG4gICAgICAgIHZhciBuYW1lID0gdGhpcy5uYW1lXG4gICAgICAgIHZhciBmcm9tUHJvdG8gPSBmcm9tLnByb3RvdHlwZVxuICAgICAgICB2YXIgb3JpZ2luYWwgPSBmcm9tUHJvdG9bbmFtZV0uX19PUklHSU5BTF9fXG4gICAgICAgIFxuICAgICAgICBpZiAoIXRoaXMuaXNBcHBsaWVkVG8oZnJvbSkpIHRocm93IFwiVW5hcHBseSBvZiBtZXRob2QgW1wiICsgbmFtZSArIFwiXSBmcm9tIGNsYXNzIFtcIiArIGZyb20gKyBcIl0gZmFpbGVkXCJcbiAgICAgICAgXG4gICAgICAgIC8vaWYgbW9kaWZpZXIgd2FzIGFwcGxpZWQgdG8gb3duIG1ldGhvZCAtIHJlc3RvcmUgaXRcbiAgICAgICAgaWYgKG9yaWdpbmFsKSBcbiAgICAgICAgICAgIGZyb21Qcm90b1tuYW1lXSA9IG9yaWdpbmFsXG4gICAgICAgIC8vb3RoZXJ3aXNlIC0ganVzdCBkZWxldGUgaXQsIHRvIHJldmVhbCB0aGUgaW5oZXJpdGVkIG1ldGhvZCBcbiAgICAgICAgZWxzZVxuICAgICAgICAgICAgZGVsZXRlIGZyb21Qcm90b1tuYW1lXVxuICAgIH1cbiAgICBcbn0pLmM7XG5Kb29zZS5NYW5hZ2VkLlByb3BlcnR5Lk1ldGhvZE1vZGlmaWVyLk92ZXJyaWRlID0gbmV3IEpvb3NlLlByb3RvLkNsYXNzKCdKb29zZS5NYW5hZ2VkLlByb3BlcnR5Lk1ldGhvZE1vZGlmaWVyLk92ZXJyaWRlJywge1xuICAgIFxuICAgIGlzYSA6IEpvb3NlLk1hbmFnZWQuUHJvcGVydHkuTWV0aG9kTW9kaWZpZXIsXG5cbiAgICBcbiAgICBwcmVwYXJlV3JhcHBlciA6IGZ1bmN0aW9uIChwYXJhbXMpIHtcbiAgICAgICAgXG4gICAgICAgIHZhciBtb2RpZmllciAgICAgICAgPSBwYXJhbXMubW9kaWZpZXJcbiAgICAgICAgdmFyIG9yaWdpbmFsQ2FsbCAgICA9IHBhcmFtcy5vcmlnaW5hbENhbGxcbiAgICAgICAgdmFyIHN1cGVyUHJvdG8gICAgICA9IHBhcmFtcy5zdXBlclByb3RvXG4gICAgICAgIHZhciBzdXBlck1ldGFDb25zdCAgPSBzdXBlclByb3RvLm1ldGEuY29uc3RydWN0b3JcbiAgICAgICAgXG4gICAgICAgIC8vY2FsbCB0byBKb29zZS5Qcm90byBsZXZlbCwgcmVxdWlyZSBzb21lIGFkZGl0aW9uYWwgcHJvY2Vzc2luZ1xuICAgICAgICB2YXIgaXNDYWxsVG9Qcm90byA9IChzdXBlck1ldGFDb25zdCA9PSBKb29zZS5Qcm90by5DbGFzcyB8fCBzdXBlck1ldGFDb25zdCA9PSBKb29zZS5Qcm90by5PYmplY3QpICYmICEocGFyYW1zLmlzT3duICYmIG9yaWdpbmFsQ2FsbC5JU19PVkVSUklERSkgXG4gICAgICAgIFxuICAgICAgICB2YXIgb3JpZ2luYWwgPSBvcmlnaW5hbENhbGxcbiAgICAgICAgXG4gICAgICAgIGlmIChpc0NhbGxUb1Byb3RvKSBvcmlnaW5hbCA9IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHZhciBiZWZvcmVTVVBFUiA9IHRoaXMuU1VQRVJcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpcy5TVVBFUiAgPSBzdXBlclByb3RvLlNVUEVSXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciByZXMgPSBvcmlnaW5hbENhbGwuYXBwbHkodGhpcywgYXJndW1lbnRzKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLlNVUEVSID0gYmVmb3JlU1VQRVJcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcmV0dXJuIHJlc1xuICAgICAgICB9XG5cbiAgICAgICAgdmFyIG92ZXJyaWRlID0gZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgXG4gICAgICAgICAgICB2YXIgYmVmb3JlU1VQRVIgPSB0aGlzLlNVUEVSXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXMuU1VQRVIgID0gb3JpZ2luYWxcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdmFyIHJlcyA9IG1vZGlmaWVyLmFwcGx5KHRoaXMsIGFyZ3VtZW50cylcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpcy5TVVBFUiA9IGJlZm9yZVNVUEVSXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHJldHVybiByZXNcbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgb3ZlcnJpZGUuSVNfT1ZFUlJJREUgPSB0cnVlXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gb3ZlcnJpZGVcbiAgICB9XG4gICAgXG4gICAgXG59KS5jO1xuSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5NZXRob2RNb2RpZmllci5QdXQgPSBuZXcgSm9vc2UuUHJvdG8uQ2xhc3MoJ0pvb3NlLk1hbmFnZWQuUHJvcGVydHkuTWV0aG9kTW9kaWZpZXIuUHV0Jywge1xuICAgIFxuICAgIGlzYSA6IEpvb3NlLk1hbmFnZWQuUHJvcGVydHkuTWV0aG9kTW9kaWZpZXIuT3ZlcnJpZGUsXG5cblxuICAgIHByZXBhcmVXcmFwcGVyIDogZnVuY3Rpb24gKHBhcmFtcykge1xuICAgICAgICBcbiAgICAgICAgaWYgKHBhcmFtcy5pc093bikgdGhyb3cgXCJNZXRob2QgW1wiICsgcGFyYW1zLm5hbWUgKyBcIl0gaXMgYXBwbHlpbmcgb3ZlciBzb21ldGhpbmcgW1wiICsgcGFyYW1zLm9yaWdpbmFsQ2FsbCArIFwiXSBpbiBjbGFzcyBbXCIgKyBwYXJhbXMudGFyZ2V0ICsgXCJdXCJcbiAgICAgICAgXG4gICAgICAgIHJldHVybiBKb29zZS5NYW5hZ2VkLlByb3BlcnR5Lk1ldGhvZE1vZGlmaWVyLlB1dC5zdXBlckNsYXNzLnByZXBhcmVXcmFwcGVyLmNhbGwodGhpcywgcGFyYW1zKVxuICAgIH1cbiAgICBcbiAgICBcbn0pLmM7XG5Kb29zZS5NYW5hZ2VkLlByb3BlcnR5Lk1ldGhvZE1vZGlmaWVyLkFmdGVyID0gbmV3IEpvb3NlLlByb3RvLkNsYXNzKCdKb29zZS5NYW5hZ2VkLlByb3BlcnR5Lk1ldGhvZE1vZGlmaWVyLkFmdGVyJywge1xuICAgIFxuICAgIGlzYSA6IEpvb3NlLk1hbmFnZWQuUHJvcGVydHkuTWV0aG9kTW9kaWZpZXIsXG5cbiAgICBcbiAgICBwcmVwYXJlV3JhcHBlciA6IGZ1bmN0aW9uIChwYXJhbXMpIHtcbiAgICAgICAgXG4gICAgICAgIHZhciBtb2RpZmllciAgICAgICAgPSBwYXJhbXMubW9kaWZpZXJcbiAgICAgICAgdmFyIG9yaWdpbmFsQ2FsbCAgICA9IHBhcmFtcy5vcmlnaW5hbENhbGxcbiAgICAgICAgXG4gICAgICAgIHJldHVybiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB2YXIgcmVzID0gb3JpZ2luYWxDYWxsLmFwcGx5KHRoaXMsIGFyZ3VtZW50cylcbiAgICAgICAgICAgIG1vZGlmaWVyLmFwcGx5KHRoaXMsIGFyZ3VtZW50cylcbiAgICAgICAgICAgIHJldHVybiByZXNcbiAgICAgICAgfVxuICAgIH0gICAgXG5cbiAgICBcbn0pLmM7XG5Kb29zZS5NYW5hZ2VkLlByb3BlcnR5Lk1ldGhvZE1vZGlmaWVyLkJlZm9yZSA9IG5ldyBKb29zZS5Qcm90by5DbGFzcygnSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5NZXRob2RNb2RpZmllci5CZWZvcmUnLCB7XG4gICAgXG4gICAgaXNhIDogSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5NZXRob2RNb2RpZmllcixcblxuICAgIFxuICAgIHByZXBhcmVXcmFwcGVyIDogZnVuY3Rpb24gKHBhcmFtcykge1xuICAgICAgICBcbiAgICAgICAgdmFyIG1vZGlmaWVyICAgICAgICA9IHBhcmFtcy5tb2RpZmllclxuICAgICAgICB2YXIgb3JpZ2luYWxDYWxsICAgID0gcGFyYW1zLm9yaWdpbmFsQ2FsbFxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIG1vZGlmaWVyLmFwcGx5KHRoaXMsIGFyZ3VtZW50cylcbiAgICAgICAgICAgIHJldHVybiBvcmlnaW5hbENhbGwuYXBwbHkodGhpcywgYXJndW1lbnRzKVxuICAgICAgICB9XG4gICAgfVxuICAgIFxufSkuYztcbkpvb3NlLk1hbmFnZWQuUHJvcGVydHkuTWV0aG9kTW9kaWZpZXIuQXJvdW5kID0gbmV3IEpvb3NlLlByb3RvLkNsYXNzKCdKb29zZS5NYW5hZ2VkLlByb3BlcnR5Lk1ldGhvZE1vZGlmaWVyLkFyb3VuZCcsIHtcbiAgICBcbiAgICBpc2EgOiBKb29zZS5NYW5hZ2VkLlByb3BlcnR5Lk1ldGhvZE1vZGlmaWVyLFxuXG4gICAgcHJlcGFyZVdyYXBwZXIgOiBmdW5jdGlvbiAocGFyYW1zKSB7XG4gICAgICAgIFxuICAgICAgICB2YXIgbW9kaWZpZXIgICAgICAgID0gcGFyYW1zLm1vZGlmaWVyXG4gICAgICAgIHZhciBvcmlnaW5hbENhbGwgICAgPSBwYXJhbXMub3JpZ2luYWxDYWxsXG4gICAgICAgIFxuICAgICAgICB2YXIgbWVcbiAgICAgICAgXG4gICAgICAgIHZhciBib3VuZCA9IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHJldHVybiBvcmlnaW5hbENhbGwuYXBwbHkobWUsIGFyZ3VtZW50cylcbiAgICAgICAgfVxuICAgICAgICAgICAgXG4gICAgICAgIHJldHVybiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBtZSA9IHRoaXNcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdmFyIGJvdW5kQXJyID0gWyBib3VuZCBdXG4gICAgICAgICAgICBib3VuZEFyci5wdXNoLmFwcGx5KGJvdW5kQXJyLCBhcmd1bWVudHMpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHJldHVybiBtb2RpZmllci5hcHBseSh0aGlzLCBib3VuZEFycilcbiAgICAgICAgfVxuICAgIH1cbiAgICBcbn0pLmM7XG5Kb29zZS5NYW5hZ2VkLlByb3BlcnR5Lk1ldGhvZE1vZGlmaWVyLkF1Z21lbnQgPSBuZXcgSm9vc2UuUHJvdG8uQ2xhc3MoJ0pvb3NlLk1hbmFnZWQuUHJvcGVydHkuTWV0aG9kTW9kaWZpZXIuQXVnbWVudCcsIHtcbiAgICBcbiAgICBpc2EgOiBKb29zZS5NYW5hZ2VkLlByb3BlcnR5Lk1ldGhvZE1vZGlmaWVyLFxuXG4gICAgXG4gICAgcHJlcGFyZVdyYXBwZXIgOiBmdW5jdGlvbiAocGFyYW1zKSB7XG4gICAgICAgIFxuICAgICAgICB2YXIgQVVHTUVOVCA9IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy9wb3B1bGF0ZSBjYWxsc3RhY2sgdG8gdGhlIG1vc3QgZGVlcCBub24tYXVnbWVudCBtZXRob2RcbiAgICAgICAgICAgIHZhciBjYWxsc3RhY2sgPSBbXVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB2YXIgc2VsZiA9IEFVR01FTlRcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgZG8ge1xuICAgICAgICAgICAgICAgIGNhbGxzdGFjay5wdXNoKHNlbGYuSVNfQVVHTUVOVCA/IHNlbGYuX19DT05UQUlOX18gOiBzZWxmKVxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIHNlbGYgPSBzZWxmLklTX0FVR01FTlQgJiYgKHNlbGYuX19PUklHSU5BTF9fIHx8IHNlbGYuU1VQRVJbc2VsZi5tZXRob2ROYW1lXSlcbiAgICAgICAgICAgIH0gd2hpbGUgKHNlbGYpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy9zYXZlIHByZXZpb3VzIElOTkVSXG4gICAgICAgICAgICB2YXIgYmVmb3JlSU5ORVIgPSB0aGlzLklOTkVSXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vY3JlYXRlIG5ldyBJTk5FUlxuICAgICAgICAgICAgdGhpcy5JTk5FUiA9IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgICB2YXIgaW5uZXJDYWxsID0gY2FsbHN0YWNrLnBvcCgpXG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgcmV0dXJuIGlubmVyQ2FsbCA/IGlubmVyQ2FsbC5hcHBseSh0aGlzLCBhcmd1bWVudHMpIDogdW5kZWZpbmVkXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vYXVnbWVudCBtb2RpZmllciByZXN1bHRzIGluIGh5cG90ZXRpY2FsIElOTkVSIGNhbGwgb2YgdGhlIHNhbWUgbWV0aG9kIGluIHN1YmNsYXNzIFxuICAgICAgICAgICAgdmFyIHJlcyA9IHRoaXMuSU5ORVIuYXBwbHkodGhpcywgYXJndW1lbnRzKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICAvL3Jlc3RvcmUgcHJldmlvdXMgSU5ORVIgY2hhaW5cbiAgICAgICAgICAgIHRoaXMuSU5ORVIgPSBiZWZvcmVJTk5FUlxuICAgICAgICAgICAgXG4gICAgICAgICAgICByZXR1cm4gcmVzXG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgICAgIEFVR01FTlQubWV0aG9kTmFtZSAgPSBwYXJhbXMubmFtZVxuICAgICAgICBBVUdNRU5ULlNVUEVSICAgICAgID0gcGFyYW1zLnN1cGVyUHJvdG9cbiAgICAgICAgQVVHTUVOVC5JU19BVUdNRU5UICA9IHRydWVcbiAgICAgICAgXG4gICAgICAgIHJldHVybiBBVUdNRU5UXG4gICAgfVxuICAgIFxufSkuYztcbkpvb3NlLk1hbmFnZWQuUHJvcGVydHlTZXQgPSBuZXcgSm9vc2UuUHJvdG8uQ2xhc3MoJ0pvb3NlLk1hbmFnZWQuUHJvcGVydHlTZXQnLCB7XG4gICAgXG4gICAgaXNhICAgICAgICAgICAgICAgICAgICAgICA6IEpvb3NlLk1hbmFnZWQuUHJvcGVydHksXG5cbiAgICBwcm9wZXJ0aWVzICAgICAgICAgICAgICAgIDogbnVsbCxcbiAgICBcbiAgICBwcm9wZXJ0eU1ldGFDbGFzcyAgICAgICAgIDogSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eSxcbiAgICBcbiAgICBcbiAgICBpbml0aWFsaXplIDogZnVuY3Rpb24gKHByb3BzKSB7XG4gICAgICAgIEpvb3NlLk1hbmFnZWQuUHJvcGVydHlTZXQuc3VwZXJDbGFzcy5pbml0aWFsaXplLmNhbGwodGhpcywgcHJvcHMpXG4gICAgICAgIFxuICAgICAgICAvL1hYWCB0aGlzIGd1YXJkcyB0aGUgbWV0YSByb2xlcyA6KVxuICAgICAgICB0aGlzLnByb3BlcnRpZXMgPSBwcm9wcy5wcm9wZXJ0aWVzIHx8IHt9XG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBhZGRQcm9wZXJ0eSA6IGZ1bmN0aW9uIChuYW1lLCBwcm9wcykge1xuICAgICAgICB2YXIgbWV0YUNsYXNzID0gcHJvcHMubWV0YSB8fCB0aGlzLnByb3BlcnR5TWV0YUNsYXNzXG4gICAgICAgIGRlbGV0ZSBwcm9wcy5tZXRhXG4gICAgICAgIFxuICAgICAgICBwcm9wcy5kZWZpbmVkSW4gICAgID0gdGhpc1xuICAgICAgICBwcm9wcy5uYW1lICAgICAgICAgID0gbmFtZVxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIHRoaXMucHJvcGVydGllc1tuYW1lXSA9IG5ldyBtZXRhQ2xhc3MocHJvcHMpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBhZGRQcm9wZXJ0eU9iamVjdCA6IGZ1bmN0aW9uIChvYmplY3QpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMucHJvcGVydGllc1tvYmplY3QubmFtZV0gPSBvYmplY3RcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIHJlbW92ZVByb3BlcnR5IDogZnVuY3Rpb24gKG5hbWUpIHtcbiAgICAgICAgdmFyIHByb3AgPSB0aGlzLnByb3BlcnRpZXNbbmFtZV1cbiAgICAgICAgXG4gICAgICAgIGRlbGV0ZSB0aGlzLnByb3BlcnRpZXNbbmFtZV1cbiAgICAgICAgXG4gICAgICAgIHJldHVybiBwcm9wXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBoYXZlUHJvcGVydHkgOiBmdW5jdGlvbiAobmFtZSkge1xuICAgICAgICByZXR1cm4gdGhpcy5wcm9wZXJ0aWVzW25hbWVdICE9IG51bGxcbiAgICB9LFxuICAgIFxuXG4gICAgaGF2ZU93blByb3BlcnR5IDogZnVuY3Rpb24gKG5hbWUpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuaGF2ZVByb3BlcnR5KG5hbWUpICYmIHRoaXMucHJvcGVydGllcy5oYXNPd25Qcm9wZXJ0eShuYW1lKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgZ2V0UHJvcGVydHkgOiBmdW5jdGlvbiAobmFtZSkge1xuICAgICAgICByZXR1cm4gdGhpcy5wcm9wZXJ0aWVzW25hbWVdXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICAvL2luY2x1ZGVzIGluaGVyaXRlZCBwcm9wZXJ0aWVzIChwcm9iYWJseSB5b3Ugd2FudHMgJ2VhY2hPd24nLCB3aGljaCBwcm9jZXNzIG9ubHkgXCJvd25cIiAoaW5jbHVkaW5nIGNvbnN1bWVkIGZyb20gUm9sZXMpIHByb3BlcnRpZXMpIFxuICAgIGVhY2ggOiBmdW5jdGlvbiAoZnVuYywgc2NvcGUpIHtcbiAgICAgICAgSm9vc2UuTy5lYWNoKHRoaXMucHJvcGVydGllcywgZnVuYywgc2NvcGUgfHwgdGhpcylcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGVhY2hPd24gOiBmdW5jdGlvbiAoZnVuYywgc2NvcGUpIHtcbiAgICAgICAgSm9vc2UuTy5lYWNoT3duKHRoaXMucHJvcGVydGllcywgZnVuYywgc2NvcGUgfHwgdGhpcylcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIC8vc3lub255bSBmb3IgZWFjaFxuICAgIGVhY2hBbGwgOiBmdW5jdGlvbiAoZnVuYywgc2NvcGUpIHtcbiAgICAgICAgdGhpcy5lYWNoKGZ1bmMsIHNjb3BlKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgY2xvbmVQcm9wcyA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgdmFyIHByb3BzID0gSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eVNldC5zdXBlckNsYXNzLmNsb25lUHJvcHMuY2FsbCh0aGlzKVxuICAgICAgICBcbiAgICAgICAgcHJvcHMucHJvcGVydHlNZXRhQ2xhc3MgICAgID0gdGhpcy5wcm9wZXJ0eU1ldGFDbGFzc1xuICAgICAgICBcbiAgICAgICAgcmV0dXJuIHByb3BzXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBjbG9uZSA6IGZ1bmN0aW9uIChuYW1lKSB7XG4gICAgICAgIHZhciBjbG9uZSA9IHRoaXMuY2xlYW5DbG9uZShuYW1lKVxuICAgICAgICBcbiAgICAgICAgY2xvbmUucHJvcGVydGllcyA9IEpvb3NlLk8uY29weU93bih0aGlzLnByb3BlcnRpZXMpXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gY2xvbmVcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGNsZWFuQ2xvbmUgOiBmdW5jdGlvbiAobmFtZSkge1xuICAgICAgICB2YXIgcHJvcHMgPSB0aGlzLmNsb25lUHJvcHMoKVxuICAgICAgICBcbiAgICAgICAgcHJvcHMubmFtZSA9IG5hbWUgfHwgcHJvcHMubmFtZVxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIG5ldyB0aGlzLmNvbnN0cnVjdG9yKHByb3BzKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgYWxpYXMgOiBmdW5jdGlvbiAod2hhdCkge1xuICAgICAgICB2YXIgcHJvcHMgPSB0aGlzLnByb3BlcnRpZXNcbiAgICAgICAgXG4gICAgICAgIEpvb3NlLk8uZWFjaCh3aGF0LCBmdW5jdGlvbiAoYWxpYXNOYW1lLCBvcmlnaW5hbE5hbWUpIHtcbiAgICAgICAgICAgIHZhciBvcmlnaW5hbCA9IHByb3BzW29yaWdpbmFsTmFtZV1cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKG9yaWdpbmFsKSB0aGlzLmFkZFByb3BlcnR5T2JqZWN0KG9yaWdpbmFsLmNsb25lKGFsaWFzTmFtZSkpXG4gICAgICAgIH0sIHRoaXMpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBleGNsdWRlIDogZnVuY3Rpb24gKHdoYXQpIHtcbiAgICAgICAgdmFyIHByb3BzID0gdGhpcy5wcm9wZXJ0aWVzXG4gICAgICAgIFxuICAgICAgICBKb29zZS5BLmVhY2god2hhdCwgZnVuY3Rpb24gKG5hbWUpIHtcbiAgICAgICAgICAgIGRlbGV0ZSBwcm9wc1tuYW1lXVxuICAgICAgICB9KVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgYmVmb3JlQ29uc3VtZWRCeSA6IGZ1bmN0aW9uICgpIHtcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGZsYXR0ZW5UbyA6IGZ1bmN0aW9uICh0YXJnZXQpIHtcbiAgICAgICAgdmFyIHRhcmdldFByb3BzID0gdGFyZ2V0LnByb3BlcnRpZXNcbiAgICAgICAgXG4gICAgICAgIHRoaXMuZWFjaE93bihmdW5jdGlvbiAocHJvcGVydHksIG5hbWUpIHtcbiAgICAgICAgICAgIHZhciB0YXJnZXRQcm9wZXJ0eSA9IHRhcmdldFByb3BzW25hbWVdXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmICh0YXJnZXRQcm9wZXJ0eSBpbnN0YW5jZW9mIEpvb3NlLk1hbmFnZWQuUHJvcGVydHkuQ29uZmxpY3RNYXJrZXIpIHJldHVyblxuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAoIXRhcmdldFByb3BzLmhhc093blByb3BlcnR5KG5hbWUpIHx8IHRhcmdldFByb3BlcnR5ID09IG51bGwpIHtcbiAgICAgICAgICAgICAgICB0YXJnZXQuYWRkUHJvcGVydHlPYmplY3QocHJvcGVydHkpXG4gICAgICAgICAgICAgICAgcmV0dXJuXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmICh0YXJnZXRQcm9wZXJ0eSA9PSBwcm9wZXJ0eSkgcmV0dXJuXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRhcmdldC5yZW1vdmVQcm9wZXJ0eShuYW1lKVxuICAgICAgICAgICAgdGFyZ2V0LmFkZFByb3BlcnR5KG5hbWUsIHtcbiAgICAgICAgICAgICAgICBtZXRhIDogSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5Db25mbGljdE1hcmtlclxuICAgICAgICAgICAgfSlcbiAgICAgICAgfSwgdGhpcylcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGNvbXBvc2VUbyA6IGZ1bmN0aW9uICh0YXJnZXQpIHtcbiAgICAgICAgdGhpcy5lYWNoT3duKGZ1bmN0aW9uIChwcm9wZXJ0eSwgbmFtZSkge1xuICAgICAgICAgICAgaWYgKCF0YXJnZXQuaGF2ZU93blByb3BlcnR5KG5hbWUpKSB0YXJnZXQuYWRkUHJvcGVydHlPYmplY3QocHJvcGVydHkpXG4gICAgICAgIH0pXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBjb21wb3NlRnJvbSA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgaWYgKCFhcmd1bWVudHMubGVuZ3RoKSByZXR1cm5cbiAgICAgICAgXG4gICAgICAgIHZhciBmbGF0dGVuaW5nID0gdGhpcy5jbGVhbkNsb25lKClcbiAgICAgICAgXG4gICAgICAgIEpvb3NlLkEuZWFjaChhcmd1bWVudHMsIGZ1bmN0aW9uIChhcmcpIHtcbiAgICAgICAgICAgIHZhciBpc0Rlc2NyaXB0b3IgICAgPSAhKGFyZyBpbnN0YW5jZW9mIEpvb3NlLk1hbmFnZWQuUHJvcGVydHlTZXQpXG4gICAgICAgICAgICB2YXIgcHJvcFNldCAgICAgICAgID0gaXNEZXNjcmlwdG9yID8gYXJnLnByb3BlcnR5U2V0IDogYXJnXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHByb3BTZXQuYmVmb3JlQ29uc3VtZWRCeSh0aGlzLCBmbGF0dGVuaW5nKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAoaXNEZXNjcmlwdG9yKSB7XG4gICAgICAgICAgICAgICAgaWYgKGFyZy5hbGlhcyB8fCBhcmcuZXhjbHVkZSkgICBwcm9wU2V0ID0gcHJvcFNldC5jbG9uZSgpXG4gICAgICAgICAgICAgICAgaWYgKGFyZy5hbGlhcykgICAgICAgICAgICAgICAgICBwcm9wU2V0LmFsaWFzKGFyZy5hbGlhcylcbiAgICAgICAgICAgICAgICBpZiAoYXJnLmV4Y2x1ZGUpICAgICAgICAgICAgICAgIHByb3BTZXQuZXhjbHVkZShhcmcuZXhjbHVkZSlcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcHJvcFNldC5mbGF0dGVuVG8oZmxhdHRlbmluZylcbiAgICAgICAgfSwgdGhpcylcbiAgICAgICAgXG4gICAgICAgIGZsYXR0ZW5pbmcuY29tcG9zZVRvKHRoaXMpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBwcmVBcHBseSA6IGZ1bmN0aW9uICh0YXJnZXQpIHtcbiAgICAgICAgdGhpcy5lYWNoT3duKGZ1bmN0aW9uIChwcm9wZXJ0eSkge1xuICAgICAgICAgICAgcHJvcGVydHkucHJlQXBwbHkodGFyZ2V0KVxuICAgICAgICB9KVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgYXBwbHkgOiBmdW5jdGlvbiAodGFyZ2V0KSB7XG4gICAgICAgIHRoaXMuZWFjaE93bihmdW5jdGlvbiAocHJvcGVydHkpIHtcbiAgICAgICAgICAgIHByb3BlcnR5LmFwcGx5KHRhcmdldClcbiAgICAgICAgfSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIHVuYXBwbHkgOiBmdW5jdGlvbiAoZnJvbSkge1xuICAgICAgICB0aGlzLmVhY2hPd24oZnVuY3Rpb24gKHByb3BlcnR5KSB7XG4gICAgICAgICAgICBwcm9wZXJ0eS51bmFwcGx5KGZyb20pXG4gICAgICAgIH0pXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBwb3N0VW5BcHBseSA6IGZ1bmN0aW9uICh0YXJnZXQpIHtcbiAgICAgICAgdGhpcy5lYWNoT3duKGZ1bmN0aW9uIChwcm9wZXJ0eSkge1xuICAgICAgICAgICAgcHJvcGVydHkucG9zdFVuQXBwbHkodGFyZ2V0KVxuICAgICAgICB9KVxuICAgIH1cbiAgICBcbn0pLmNcbjtcbnZhciBfX0lEX18gPSAxXG5cblxuSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eVNldC5NdXRhYmxlID0gbmV3IEpvb3NlLlByb3RvLkNsYXNzKCdKb29zZS5NYW5hZ2VkLlByb3BlcnR5U2V0Lk11dGFibGUnLCB7XG4gICAgXG4gICAgaXNhICAgICAgICAgICAgICAgICA6IEpvb3NlLk1hbmFnZWQuUHJvcGVydHlTZXQsXG5cbiAgICBJRCAgICAgICAgICAgICAgICAgIDogbnVsbCxcbiAgICBcbiAgICBkZXJpdmF0aXZlcyAgICAgICAgIDogbnVsbCxcbiAgICBcbiAgICBvcGVuZWQgICAgICAgICAgICAgIDogbnVsbCxcbiAgICBcbiAgICBjb21wb3NlZEZyb20gICAgICAgIDogbnVsbCxcbiAgICBcbiAgICBcbiAgICBpbml0aWFsaXplIDogZnVuY3Rpb24gKHByb3BzKSB7XG4gICAgICAgIEpvb3NlLk1hbmFnZWQuUHJvcGVydHlTZXQuTXV0YWJsZS5zdXBlckNsYXNzLmluaXRpYWxpemUuY2FsbCh0aGlzLCBwcm9wcylcbiAgICAgICAgXG4gICAgICAgIC8vaW5pdGlhbGx5IG9wZW5lZFxuICAgICAgICB0aGlzLm9wZW5lZCAgICAgICAgICAgICA9IDFcbiAgICAgICAgdGhpcy5kZXJpdmF0aXZlcyAgICAgICAgPSB7fVxuICAgICAgICB0aGlzLklEICAgICAgICAgICAgICAgICA9IF9fSURfXysrXG4gICAgICAgIHRoaXMuY29tcG9zZWRGcm9tICAgICAgID0gW11cbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGFkZENvbXBvc2VJbmZvIDogZnVuY3Rpb24gKCkge1xuICAgICAgICB0aGlzLmVuc3VyZU9wZW4oKVxuICAgICAgICBcbiAgICAgICAgSm9vc2UuQS5lYWNoKGFyZ3VtZW50cywgZnVuY3Rpb24gKGFyZykge1xuICAgICAgICAgICAgdGhpcy5jb21wb3NlZEZyb20ucHVzaChhcmcpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciBwcm9wU2V0ID0gYXJnIGluc3RhbmNlb2YgSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eVNldCA/IGFyZyA6IGFyZy5wcm9wZXJ0eVNldFxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgcHJvcFNldC5kZXJpdmF0aXZlc1t0aGlzLklEXSA9IHRoaXNcbiAgICAgICAgfSwgdGhpcylcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIHJlbW92ZUNvbXBvc2VJbmZvIDogZnVuY3Rpb24gKCkge1xuICAgICAgICB0aGlzLmVuc3VyZU9wZW4oKVxuICAgICAgICBcbiAgICAgICAgSm9vc2UuQS5lYWNoKGFyZ3VtZW50cywgZnVuY3Rpb24gKGFyZykge1xuICAgICAgICAgICAgXG4gICAgICAgICAgICB2YXIgaSA9IDBcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgd2hpbGUgKGkgPCB0aGlzLmNvbXBvc2VkRnJvbS5sZW5ndGgpIHtcbiAgICAgICAgICAgICAgICB2YXIgcHJvcFNldCA9IHRoaXMuY29tcG9zZWRGcm9tW2ldXG4gICAgICAgICAgICAgICAgcHJvcFNldCA9IHByb3BTZXQgaW5zdGFuY2VvZiBKb29zZS5NYW5hZ2VkLlByb3BlcnR5U2V0ID8gcHJvcFNldCA6IHByb3BTZXQucHJvcGVydHlTZXRcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBpZiAoYXJnID09IHByb3BTZXQpIHtcbiAgICAgICAgICAgICAgICAgICAgZGVsZXRlIHByb3BTZXQuZGVyaXZhdGl2ZXNbdGhpcy5JRF1cbiAgICAgICAgICAgICAgICAgICAgdGhpcy5jb21wb3NlZEZyb20uc3BsaWNlKGksIDEpXG4gICAgICAgICAgICAgICAgfSBlbHNlIGkrK1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgXG4gICAgICAgIH0sIHRoaXMpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBlbnN1cmVPcGVuIDogZnVuY3Rpb24gKCkge1xuICAgICAgICBpZiAoIXRoaXMub3BlbmVkKSB0aHJvdyBcIk11dGF0aW9uIG9mIGNsb3NlZCBwcm9wZXJ0eSBzZXQ6IFtcIiArIHRoaXMubmFtZSArIFwiXVwiXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBhZGRQcm9wZXJ0eSA6IGZ1bmN0aW9uIChuYW1lLCBwcm9wcykge1xuICAgICAgICB0aGlzLmVuc3VyZU9wZW4oKVxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIEpvb3NlLk1hbmFnZWQuUHJvcGVydHlTZXQuTXV0YWJsZS5zdXBlckNsYXNzLmFkZFByb3BlcnR5LmNhbGwodGhpcywgbmFtZSwgcHJvcHMpXG4gICAgfSxcbiAgICBcblxuICAgIGFkZFByb3BlcnR5T2JqZWN0IDogZnVuY3Rpb24gKG9iamVjdCkge1xuICAgICAgICB0aGlzLmVuc3VyZU9wZW4oKVxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIEpvb3NlLk1hbmFnZWQuUHJvcGVydHlTZXQuTXV0YWJsZS5zdXBlckNsYXNzLmFkZFByb3BlcnR5T2JqZWN0LmNhbGwodGhpcywgb2JqZWN0KVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgcmVtb3ZlUHJvcGVydHkgOiBmdW5jdGlvbiAobmFtZSkge1xuICAgICAgICB0aGlzLmVuc3VyZU9wZW4oKVxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIEpvb3NlLk1hbmFnZWQuUHJvcGVydHlTZXQuTXV0YWJsZS5zdXBlckNsYXNzLnJlbW92ZVByb3BlcnR5LmNhbGwodGhpcywgbmFtZSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGNvbXBvc2VGcm9tIDogZnVuY3Rpb24gKCkge1xuICAgICAgICB0aGlzLmVuc3VyZU9wZW4oKVxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIEpvb3NlLk1hbmFnZWQuUHJvcGVydHlTZXQuTXV0YWJsZS5zdXBlckNsYXNzLmNvbXBvc2VGcm9tLmFwcGx5KHRoaXMsIHRoaXMuY29tcG9zZWRGcm9tKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgb3BlbiA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgdGhpcy5vcGVuZWQrK1xuICAgICAgICBcbiAgICAgICAgaWYgKHRoaXMub3BlbmVkID09IDEpIHtcbiAgICAgICAgXG4gICAgICAgICAgICBKb29zZS5PLmVhY2godGhpcy5kZXJpdmF0aXZlcywgZnVuY3Rpb24gKHByb3BTZXQpIHtcbiAgICAgICAgICAgICAgICBwcm9wU2V0Lm9wZW4oKVxuICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpcy5kZUNvbXBvc2UoKVxuICAgICAgICB9XG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBjbG9zZSA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgaWYgKCF0aGlzLm9wZW5lZCkgdGhyb3cgXCJVbm1hdGNoZWQgJ2Nsb3NlJyBvcGVyYXRpb24gb24gcHJvcGVydHkgc2V0OiBbXCIgKyB0aGlzLm5hbWUgKyBcIl1cIlxuICAgICAgICBcbiAgICAgICAgaWYgKHRoaXMub3BlbmVkID09IDEpIHtcbiAgICAgICAgICAgIHRoaXMucmVDb21wb3NlKClcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgSm9vc2UuTy5lYWNoKHRoaXMuZGVyaXZhdGl2ZXMsIGZ1bmN0aW9uIChwcm9wU2V0KSB7XG4gICAgICAgICAgICAgICAgcHJvcFNldC5jbG9zZSgpXG4gICAgICAgICAgICB9KVxuICAgICAgICB9XG4gICAgICAgIHRoaXMub3BlbmVkLS1cbiAgICB9LFxuICAgIFxuICAgIFxuICAgIHJlQ29tcG9zZSA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgdGhpcy5jb21wb3NlRnJvbSgpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBkZUNvbXBvc2UgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHRoaXMuZWFjaE93bihmdW5jdGlvbiAocHJvcGVydHksIG5hbWUpIHtcbiAgICAgICAgICAgIGlmIChwcm9wZXJ0eS5kZWZpbmVkSW4gIT0gdGhpcykgdGhpcy5yZW1vdmVQcm9wZXJ0eShuYW1lKVxuICAgICAgICB9LCB0aGlzKVxuICAgIH1cbiAgICBcbn0pLmM7XG5Kb29zZS5NYW5hZ2VkLlN0ZW1FbGVtZW50ID0gZnVuY3Rpb24gKCkgeyB0aHJvdyBcIk1vZHVsZXMgbWF5IG5vdCBiZSBpbnN0YW50aWF0ZWQuXCIgfVxuXG5Kb29zZS5NYW5hZ2VkLlN0ZW1FbGVtZW50LkF0dHJpYnV0ZXMgPSBuZXcgSm9vc2UuUHJvdG8uQ2xhc3MoJ0pvb3NlLk1hbmFnZWQuU3RlbUVsZW1lbnQuQXR0cmlidXRlcycsIHtcbiAgICBcbiAgICBpc2EgICAgICAgICAgICAgICAgICAgICA6IEpvb3NlLk1hbmFnZWQuUHJvcGVydHlTZXQuTXV0YWJsZSxcbiAgICBcbiAgICBwcm9wZXJ0eU1ldGFDbGFzcyAgICAgICA6IEpvb3NlLk1hbmFnZWQuUHJvcGVydHkuQXR0cmlidXRlXG4gICAgXG59KS5jXG47XG5Kb29zZS5NYW5hZ2VkLlN0ZW1FbGVtZW50Lk1ldGhvZHMgPSBuZXcgSm9vc2UuUHJvdG8uQ2xhc3MoJ0pvb3NlLk1hbmFnZWQuU3RlbUVsZW1lbnQuTWV0aG9kcycsIHtcbiAgICBcbiAgICBpc2EgOiBKb29zZS5NYW5hZ2VkLlByb3BlcnR5U2V0Lk11dGFibGUsXG4gICAgXG4gICAgcHJvcGVydHlNZXRhQ2xhc3MgOiBKb29zZS5NYW5hZ2VkLlByb3BlcnR5Lk1ldGhvZE1vZGlmaWVyLlB1dCxcblxuICAgIFxuICAgIHByZUFwcGx5IDogZnVuY3Rpb24gKCkge1xuICAgIH0sXG4gICAgXG4gICAgXG4gICAgcG9zdFVuQXBwbHkgOiBmdW5jdGlvbiAoKSB7XG4gICAgfVxuICAgIFxufSkuYztcbkpvb3NlLk1hbmFnZWQuU3RlbUVsZW1lbnQuUmVxdWlyZW1lbnRzID0gbmV3IEpvb3NlLlByb3RvLkNsYXNzKCdKb29zZS5NYW5hZ2VkLlN0ZW1FbGVtZW50LlJlcXVpcmVtZW50cycsIHtcblxuICAgIGlzYSAgICAgICAgICAgICAgICAgICAgIDogSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eVNldC5NdXRhYmxlLFxuICAgIFxuICAgIHByb3BlcnR5TWV0YUNsYXNzICAgICAgIDogSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5SZXF1aXJlbWVudCxcbiAgICBcbiAgICBcbiAgICBcbiAgICBhbGlhcyA6IGZ1bmN0aW9uICgpIHtcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGV4Y2x1ZGUgOiBmdW5jdGlvbiAoKSB7XG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBmbGF0dGVuVG8gOiBmdW5jdGlvbiAodGFyZ2V0KSB7XG4gICAgICAgIHRoaXMuZWFjaChmdW5jdGlvbiAocHJvcGVydHksIG5hbWUpIHtcbiAgICAgICAgICAgIGlmICghdGFyZ2V0LmhhdmVQcm9wZXJ0eShuYW1lKSkgdGFyZ2V0LmFkZFByb3BlcnR5T2JqZWN0KHByb3BlcnR5KVxuICAgICAgICB9KVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgY29tcG9zZVRvIDogZnVuY3Rpb24gKHRhcmdldCkge1xuICAgICAgICB0aGlzLmZsYXR0ZW5Ubyh0YXJnZXQpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBwcmVBcHBseSA6IGZ1bmN0aW9uICgpIHtcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIHBvc3RVbkFwcGx5IDogZnVuY3Rpb24gKCkge1xuICAgIH1cbiAgICBcbn0pLmM7XG5Kb29zZS5NYW5hZ2VkLlN0ZW1FbGVtZW50Lk1ldGhvZE1vZGlmaWVycyA9IG5ldyBKb29zZS5Qcm90by5DbGFzcygnSm9vc2UuTWFuYWdlZC5TdGVtRWxlbWVudC5NZXRob2RNb2RpZmllcnMnLCB7XG5cbiAgICBpc2EgICAgICAgICAgICAgICAgICAgICA6IEpvb3NlLk1hbmFnZWQuUHJvcGVydHlTZXQuTXV0YWJsZSxcbiAgICBcbiAgICBwcm9wZXJ0eU1ldGFDbGFzcyAgICAgICA6IG51bGwsXG4gICAgXG4gICAgXG4gICAgYWRkUHJvcGVydHkgOiBmdW5jdGlvbiAobmFtZSwgcHJvcHMpIHtcbiAgICAgICAgdmFyIG1ldGFDbGFzcyA9IHByb3BzLm1ldGFcbiAgICAgICAgZGVsZXRlIHByb3BzLm1ldGFcbiAgICAgICAgXG4gICAgICAgIHByb3BzLmRlZmluZWRJbiAgICAgICAgID0gdGhpc1xuICAgICAgICBwcm9wcy5uYW1lICAgICAgICAgICAgICA9IG5hbWVcbiAgICAgICAgXG4gICAgICAgIHZhciBtb2RpZmllciAgICAgICAgICAgID0gbmV3IG1ldGFDbGFzcyhwcm9wcylcbiAgICAgICAgdmFyIHByb3BlcnRpZXMgICAgICAgICAgPSB0aGlzLnByb3BlcnRpZXNcbiAgICAgICAgXG4gICAgICAgIGlmICghcHJvcGVydGllc1tuYW1lXSkgcHJvcGVydGllc1sgbmFtZSBdID0gW11cbiAgICAgICAgXG4gICAgICAgIHByb3BlcnRpZXNbbmFtZV0ucHVzaChtb2RpZmllcilcbiAgICAgICAgXG4gICAgICAgIHJldHVybiBtb2RpZmllclxuICAgIH0sXG4gICAgXG5cbiAgICBhZGRQcm9wZXJ0eU9iamVjdCA6IGZ1bmN0aW9uIChvYmplY3QpIHtcbiAgICAgICAgdmFyIG5hbWUgICAgICAgICAgICA9IG9iamVjdC5uYW1lXG4gICAgICAgIHZhciBwcm9wZXJ0aWVzICAgICAgPSB0aGlzLnByb3BlcnRpZXNcbiAgICAgICAgXG4gICAgICAgIGlmICghcHJvcGVydGllc1tuYW1lXSkgcHJvcGVydGllc1tuYW1lXSA9IFtdXG4gICAgICAgIFxuICAgICAgICBwcm9wZXJ0aWVzW25hbWVdLnB1c2gob2JqZWN0KVxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIG9iamVjdFxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgLy9yZW1vdmUgb25seSB0aGUgbGFzdCBtb2RpZmllclxuICAgIHJlbW92ZVByb3BlcnR5IDogZnVuY3Rpb24gKG5hbWUpIHtcbiAgICAgICAgaWYgKCF0aGlzLmhhdmVQcm9wZXJ0eShuYW1lKSkgcmV0dXJuIHVuZGVmaW5lZFxuICAgICAgICBcbiAgICAgICAgdmFyIHByb3BlcnRpZXMgICAgICA9IHRoaXMucHJvcGVydGllc1xuICAgICAgICB2YXIgbW9kaWZpZXIgICAgICAgID0gcHJvcGVydGllc1sgbmFtZSBdLnBvcCgpXG4gICAgICAgIFxuICAgICAgICAvL2lmIGFsbCBtb2RpZmllcnMgd2VyZSByZW1vdmVkIC0gY2xlYXJpbmcgdGhlIHByb3BlcnRpZXNcbiAgICAgICAgaWYgKCFwcm9wZXJ0aWVzW25hbWVdLmxlbmd0aCkgSm9vc2UuTWFuYWdlZC5TdGVtRWxlbWVudC5NZXRob2RNb2RpZmllcnMuc3VwZXJDbGFzcy5yZW1vdmVQcm9wZXJ0eS5jYWxsKHRoaXMsIG5hbWUpXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gbW9kaWZpZXJcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGFsaWFzIDogZnVuY3Rpb24gKCkge1xuICAgIH0sXG4gICAgXG4gICAgXG4gICAgZXhjbHVkZSA6IGZ1bmN0aW9uICgpIHtcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGZsYXR0ZW5UbyA6IGZ1bmN0aW9uICh0YXJnZXQpIHtcbiAgICAgICAgdmFyIHRhcmdldFByb3BzID0gdGFyZ2V0LnByb3BlcnRpZXNcbiAgICAgICAgXG4gICAgICAgIHRoaXMuZWFjaChmdW5jdGlvbiAobW9kaWZpZXJzQXJyLCBuYW1lKSB7XG4gICAgICAgICAgICB2YXIgdGFyZ2V0TW9kaWZpZXJzQXJyID0gdGFyZ2V0UHJvcHNbbmFtZV1cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKHRhcmdldE1vZGlmaWVyc0FyciA9PSBudWxsKSB0YXJnZXRNb2RpZmllcnNBcnIgPSB0YXJnZXRQcm9wc1tuYW1lXSA9IFtdXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIEpvb3NlLkEuZWFjaChtb2RpZmllcnNBcnIsIGZ1bmN0aW9uIChtb2RpZmllcikge1xuICAgICAgICAgICAgICAgIGlmICghSm9vc2UuQS5leGlzdHModGFyZ2V0TW9kaWZpZXJzQXJyLCBtb2RpZmllcikpIHRhcmdldE1vZGlmaWVyc0Fyci5wdXNoKG1vZGlmaWVyKVxuICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIFxuICAgICAgICB9KVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgY29tcG9zZVRvIDogZnVuY3Rpb24gKHRhcmdldCkge1xuICAgICAgICB0aGlzLmZsYXR0ZW5Ubyh0YXJnZXQpXG4gICAgfSxcblxuICAgIFxuICAgIGRlQ29tcG9zZSA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgdGhpcy5lYWNoKGZ1bmN0aW9uIChtb2RpZmllcnNBcnIsIG5hbWUpIHtcbiAgICAgICAgICAgIHZhciBpID0gMFxuICAgICAgICAgICAgXG4gICAgICAgICAgICB3aGlsZSAoaSA8IG1vZGlmaWVyc0Fyci5sZW5ndGgpIFxuICAgICAgICAgICAgICAgIGlmIChtb2RpZmllcnNBcnJbaV0uZGVmaW5lZEluICE9IHRoaXMpIFxuICAgICAgICAgICAgICAgICAgICBtb2RpZmllcnNBcnIuc3BsaWNlKGksIDEpXG4gICAgICAgICAgICAgICAgZWxzZSBcbiAgICAgICAgICAgICAgICAgICAgaSsrXG4gICAgICAgIH0pXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBwcmVBcHBseSA6IGZ1bmN0aW9uICh0YXJnZXQpIHtcbiAgICB9LFxuXG4gICAgXG4gICAgcG9zdFVuQXBwbHkgOiBmdW5jdGlvbiAodGFyZ2V0KSB7XG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBhcHBseSA6IGZ1bmN0aW9uICh0YXJnZXQpIHtcbiAgICAgICAgdGhpcy5lYWNoKGZ1bmN0aW9uIChtb2RpZmllcnNBcnIsIG5hbWUpIHtcbiAgICAgICAgICAgIEpvb3NlLkEuZWFjaChtb2RpZmllcnNBcnIsIGZ1bmN0aW9uIChtb2RpZmllcikge1xuICAgICAgICAgICAgICAgIG1vZGlmaWVyLmFwcGx5KHRhcmdldClcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH0pXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICB1bmFwcGx5IDogZnVuY3Rpb24gKGZyb20pIHtcbiAgICAgICAgdGhpcy5lYWNoKGZ1bmN0aW9uIChtb2RpZmllcnNBcnIsIG5hbWUpIHtcbiAgICAgICAgICAgIGZvciAodmFyIGkgPSBtb2RpZmllcnNBcnIubGVuZ3RoIC0gMTsgaSA+PTAgOyBpLS0pIG1vZGlmaWVyc0FycltpXS51bmFwcGx5KGZyb20pXG4gICAgICAgIH0pXG4gICAgfVxuICAgIFxuICAgIFxuICAgIFxufSkuYztcbkpvb3NlLk1hbmFnZWQuUHJvcGVydHlTZXQuQ29tcG9zaXRpb24gPSBuZXcgSm9vc2UuUHJvdG8uQ2xhc3MoJ0pvb3NlLk1hbmFnZWQuUHJvcGVydHlTZXQuQ29tcG9zaXRpb24nLCB7XG4gICAgXG4gICAgaXNhICAgICAgICAgICAgICAgICAgICAgICAgIDogSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eVNldC5NdXRhYmxlLFxuICAgIFxuICAgIHByb3BlcnR5TWV0YUNsYXNzICAgICAgICAgICA6IEpvb3NlLk1hbmFnZWQuUHJvcGVydHlTZXQuTXV0YWJsZSxcbiAgICBcbiAgICBwcm9jZXNzT3JkZXIgICAgICAgICAgICAgICAgOiBudWxsLFxuXG4gICAgXG4gICAgZWFjaCA6IGZ1bmN0aW9uIChmdW5jLCBzY29wZSkge1xuICAgICAgICB2YXIgcHJvcHMgICA9IHRoaXMucHJvcGVydGllc1xuICAgICAgICB2YXIgc2NvcGUgICA9IHNjb3BlIHx8IHRoaXNcbiAgICAgICAgXG4gICAgICAgIEpvb3NlLkEuZWFjaCh0aGlzLnByb2Nlc3NPcmRlciwgZnVuY3Rpb24gKG5hbWUpIHtcbiAgICAgICAgICAgIGZ1bmMuY2FsbChzY29wZSwgcHJvcHNbbmFtZV0sIG5hbWUpXG4gICAgICAgIH0pXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBlYWNoUiA6IGZ1bmN0aW9uIChmdW5jLCBzY29wZSkge1xuICAgICAgICB2YXIgcHJvcHMgICA9IHRoaXMucHJvcGVydGllc1xuICAgICAgICB2YXIgc2NvcGUgICA9IHNjb3BlIHx8IHRoaXNcbiAgICAgICAgXG4gICAgICAgIEpvb3NlLkEuZWFjaFIodGhpcy5wcm9jZXNzT3JkZXIsIGZ1bmN0aW9uIChuYW1lKSB7XG4gICAgICAgICAgICBmdW5jLmNhbGwoc2NvcGUsIHByb3BzW25hbWVdLCBuYW1lKVxuICAgICAgICB9KVxuICAgICAgICBcbiAgICAgICAgXG4vLyAgICAgICAgdmFyIHByb3BzICAgICAgICAgICA9IHRoaXMucHJvcGVydGllc1xuLy8gICAgICAgIHZhciBwcm9jZXNzT3JkZXIgICAgPSB0aGlzLnByb2Nlc3NPcmRlclxuLy8gICAgICAgIFxuLy8gICAgICAgIGZvcih2YXIgaSA9IHByb2Nlc3NPcmRlci5sZW5ndGggLSAxOyBpID49IDA7IGktLSkgXG4vLyAgICAgICAgICAgIGZ1bmMuY2FsbChzY29wZSB8fCB0aGlzLCBwcm9wc1sgcHJvY2Vzc09yZGVyW2ldIF0sIHByb2Nlc3NPcmRlcltpXSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGNsb25lIDogZnVuY3Rpb24gKG5hbWUpIHtcbiAgICAgICAgdmFyIGNsb25lID0gdGhpcy5jbGVhbkNsb25lKG5hbWUpXG4gICAgICAgIFxuICAgICAgICB0aGlzLmVhY2goZnVuY3Rpb24gKHByb3BlcnR5KSB7XG4gICAgICAgICAgICBjbG9uZS5hZGRQcm9wZXJ0eU9iamVjdChwcm9wZXJ0eS5jbG9uZSgpKVxuICAgICAgICB9KVxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIGNsb25lXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBhbGlhcyA6IGZ1bmN0aW9uICh3aGF0KSB7XG4gICAgICAgIHRoaXMuZWFjaChmdW5jdGlvbiAocHJvcGVydHkpIHtcbiAgICAgICAgICAgIHByb3BlcnR5LmFsaWFzKHdoYXQpXG4gICAgICAgIH0pXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBleGNsdWRlIDogZnVuY3Rpb24gKHdoYXQpIHtcbiAgICAgICAgdGhpcy5lYWNoKGZ1bmN0aW9uIChwcm9wZXJ0eSkge1xuICAgICAgICAgICAgcHJvcGVydHkuZXhjbHVkZSh3aGF0KVxuICAgICAgICB9KVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgZmxhdHRlblRvIDogZnVuY3Rpb24gKHRhcmdldCkge1xuICAgICAgICB2YXIgdGFyZ2V0UHJvcHMgPSB0YXJnZXQucHJvcGVydGllc1xuICAgICAgICBcbiAgICAgICAgdGhpcy5lYWNoKGZ1bmN0aW9uIChwcm9wZXJ0eSwgbmFtZSkge1xuICAgICAgICAgICAgdmFyIHN1YlRhcmdldCA9IHRhcmdldFByb3BzW25hbWVdIHx8IHRhcmdldC5hZGRQcm9wZXJ0eShuYW1lLCB7XG4gICAgICAgICAgICAgICAgbWV0YSA6IHByb3BlcnR5LmNvbnN0cnVjdG9yXG4gICAgICAgICAgICB9KVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBwcm9wZXJ0eS5mbGF0dGVuVG8oc3ViVGFyZ2V0KVxuICAgICAgICB9KVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgY29tcG9zZVRvIDogZnVuY3Rpb24gKHRhcmdldCkge1xuICAgICAgICB2YXIgdGFyZ2V0UHJvcHMgPSB0YXJnZXQucHJvcGVydGllc1xuICAgICAgICBcbiAgICAgICAgdGhpcy5lYWNoKGZ1bmN0aW9uIChwcm9wZXJ0eSwgbmFtZSkge1xuICAgICAgICAgICAgdmFyIHN1YlRhcmdldCA9IHRhcmdldFByb3BzW25hbWVdIHx8IHRhcmdldC5hZGRQcm9wZXJ0eShuYW1lLCB7XG4gICAgICAgICAgICAgICAgbWV0YSA6IHByb3BlcnR5LmNvbnN0cnVjdG9yXG4gICAgICAgICAgICB9KVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBwcm9wZXJ0eS5jb21wb3NlVG8oc3ViVGFyZ2V0KVxuICAgICAgICB9KVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgXG4gICAgZGVDb21wb3NlIDogZnVuY3Rpb24gKCkge1xuICAgICAgICB0aGlzLmVhY2hSKGZ1bmN0aW9uIChwcm9wZXJ0eSkge1xuICAgICAgICAgICAgcHJvcGVydHkub3BlbigpXG4gICAgICAgIH0pXG4gICAgICAgIFxuICAgICAgICBKb29zZS5NYW5hZ2VkLlByb3BlcnR5U2V0LkNvbXBvc2l0aW9uLnN1cGVyQ2xhc3MuZGVDb21wb3NlLmNhbGwodGhpcylcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIHJlQ29tcG9zZSA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eVNldC5Db21wb3NpdGlvbi5zdXBlckNsYXNzLnJlQ29tcG9zZS5jYWxsKHRoaXMpXG4gICAgICAgIFxuICAgICAgICB0aGlzLmVhY2goZnVuY3Rpb24gKHByb3BlcnR5KSB7XG4gICAgICAgICAgICBwcm9wZXJ0eS5jbG9zZSgpXG4gICAgICAgIH0pXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICB1bmFwcGx5IDogZnVuY3Rpb24gKGZyb20pIHtcbiAgICAgICAgdGhpcy5lYWNoUihmdW5jdGlvbiAocHJvcGVydHkpIHtcbiAgICAgICAgICAgIHByb3BlcnR5LnVuYXBwbHkoZnJvbSlcbiAgICAgICAgfSlcbiAgICB9XG4gICAgXG59KS5jXG47XG5Kb29zZS5NYW5hZ2VkLlN0ZW0gPSBuZXcgSm9vc2UuUHJvdG8uQ2xhc3MoJ0pvb3NlLk1hbmFnZWQuU3RlbScsIHtcbiAgICBcbiAgICBpc2EgICAgICAgICAgICAgICAgICA6IEpvb3NlLk1hbmFnZWQuUHJvcGVydHlTZXQuQ29tcG9zaXRpb24sXG4gICAgXG4gICAgdGFyZ2V0TWV0YSAgICAgICAgICAgOiBudWxsLFxuICAgIFxuICAgIGF0dHJpYnV0ZXNNQyAgICAgICAgIDogSm9vc2UuTWFuYWdlZC5TdGVtRWxlbWVudC5BdHRyaWJ1dGVzLFxuICAgIG1ldGhvZHNNQyAgICAgICAgICAgIDogSm9vc2UuTWFuYWdlZC5TdGVtRWxlbWVudC5NZXRob2RzLFxuICAgIHJlcXVpcmVtZW50c01DICAgICAgIDogSm9vc2UuTWFuYWdlZC5TdGVtRWxlbWVudC5SZXF1aXJlbWVudHMsXG4gICAgbWV0aG9kc01vZGlmaWVyc01DICAgOiBKb29zZS5NYW5hZ2VkLlN0ZW1FbGVtZW50Lk1ldGhvZE1vZGlmaWVycyxcbiAgICBcbiAgICBwcm9jZXNzT3JkZXIgICAgICAgICA6IFsgJ2F0dHJpYnV0ZXMnLCAnbWV0aG9kcycsICdyZXF1aXJlbWVudHMnLCAnbWV0aG9kc01vZGlmaWVycycgXSxcbiAgICBcbiAgICBcbiAgICBpbml0aWFsaXplIDogZnVuY3Rpb24gKHByb3BzKSB7XG4gICAgICAgIEpvb3NlLk1hbmFnZWQuU3RlbS5zdXBlckNsYXNzLmluaXRpYWxpemUuY2FsbCh0aGlzLCBwcm9wcylcbiAgICAgICAgXG4gICAgICAgIHZhciB0YXJnZXRNZXRhID0gdGhpcy50YXJnZXRNZXRhXG4gICAgICAgIFxuICAgICAgICB0aGlzLmFkZFByb3BlcnR5KCdhdHRyaWJ1dGVzJywge1xuICAgICAgICAgICAgbWV0YSA6IHRoaXMuYXR0cmlidXRlc01DLFxuICAgICAgICAgICAgXG4gICAgICAgICAgICAvL2l0IGNhbiBiZSBubyAndGFyZ2V0TWV0YScgaW4gY2xvbmVzXG4gICAgICAgICAgICBwcm9wZXJ0aWVzIDogdGFyZ2V0TWV0YSA/IHRhcmdldE1ldGEuYXR0cmlidXRlcyA6IHt9XG4gICAgICAgIH0pXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgdGhpcy5hZGRQcm9wZXJ0eSgnbWV0aG9kcycsIHtcbiAgICAgICAgICAgIG1ldGEgOiB0aGlzLm1ldGhvZHNNQyxcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcHJvcGVydGllcyA6IHRhcmdldE1ldGEgPyB0YXJnZXRNZXRhLm1ldGhvZHMgOiB7fVxuICAgICAgICB9KVxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIHRoaXMuYWRkUHJvcGVydHkoJ3JlcXVpcmVtZW50cycsIHtcbiAgICAgICAgICAgIG1ldGEgOiB0aGlzLnJlcXVpcmVtZW50c01DXG4gICAgICAgIH0pXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgdGhpcy5hZGRQcm9wZXJ0eSgnbWV0aG9kc01vZGlmaWVycycsIHtcbiAgICAgICAgICAgIG1ldGEgOiB0aGlzLm1ldGhvZHNNb2RpZmllcnNNQ1xuICAgICAgICB9KVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgcmVDb21wb3NlIDogZnVuY3Rpb24gKCkge1xuICAgICAgICB2YXIgYyAgICAgICA9IHRoaXMudGFyZ2V0TWV0YS5jXG4gICAgICAgIFxuICAgICAgICB0aGlzLnByZUFwcGx5KGMpXG4gICAgICAgIFxuICAgICAgICBKb29zZS5NYW5hZ2VkLlN0ZW0uc3VwZXJDbGFzcy5yZUNvbXBvc2UuY2FsbCh0aGlzKVxuICAgICAgICBcbiAgICAgICAgdGhpcy5hcHBseShjKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgZGVDb21wb3NlIDogZnVuY3Rpb24gKCkge1xuICAgICAgICB2YXIgYyAgICAgICA9IHRoaXMudGFyZ2V0TWV0YS5jXG4gICAgICAgIFxuICAgICAgICB0aGlzLnVuYXBwbHkoYylcbiAgICAgICAgXG4gICAgICAgIEpvb3NlLk1hbmFnZWQuU3RlbS5zdXBlckNsYXNzLmRlQ29tcG9zZS5jYWxsKHRoaXMpXG4gICAgICAgIFxuICAgICAgICB0aGlzLnBvc3RVbkFwcGx5KGMpXG4gICAgfVxuICAgIFxuICAgIFxufSkuY1xuO1xuSm9vc2UuTWFuYWdlZC5CdWlsZGVyID0gbmV3IEpvb3NlLlByb3RvLkNsYXNzKCdKb29zZS5NYW5hZ2VkLkJ1aWxkZXInLCB7XG4gICAgXG4gICAgdGFyZ2V0TWV0YSAgICAgICAgICA6IG51bGwsXG4gICAgXG4gICAgXG4gICAgX2J1aWxkU3RhcnQgOiBmdW5jdGlvbiAodGFyZ2V0TWV0YSwgcHJvcHMpIHtcbiAgICAgICAgdGFyZ2V0TWV0YS5zdGVtLm9wZW4oKVxuICAgICAgICBcbiAgICAgICAgSm9vc2UuQS5lYWNoKFsgJ3RyYWl0JywgJ3RyYWl0cycsICdyZW1vdmVUcmFpdCcsICdyZW1vdmVUcmFpdHMnLCAnZG9lcycsICdkb2Vzbm90JywgJ2RvZXNudCcgXSwgZnVuY3Rpb24gKGJ1aWxkZXIpIHtcbiAgICAgICAgICAgIGlmIChwcm9wc1tidWlsZGVyXSkge1xuICAgICAgICAgICAgICAgIHRoaXNbYnVpbGRlcl0odGFyZ2V0TWV0YSwgcHJvcHNbYnVpbGRlcl0pXG4gICAgICAgICAgICAgICAgZGVsZXRlIHByb3BzW2J1aWxkZXJdXG4gICAgICAgICAgICB9XG4gICAgICAgIH0sIHRoaXMpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBfZXh0ZW5kIDogZnVuY3Rpb24gKHByb3BzKSB7XG4gICAgICAgIGlmIChKb29zZS5PLmlzRW1wdHkocHJvcHMpKSByZXR1cm5cbiAgICAgICAgXG4gICAgICAgIHZhciB0YXJnZXRNZXRhID0gdGhpcy50YXJnZXRNZXRhXG4gICAgICAgIFxuICAgICAgICB0aGlzLl9idWlsZFN0YXJ0KHRhcmdldE1ldGEsIHByb3BzKVxuICAgICAgICBcbiAgICAgICAgSm9vc2UuTy5lYWNoT3duKHByb3BzLCBmdW5jdGlvbiAodmFsdWUsIG5hbWUpIHtcbiAgICAgICAgICAgIHZhciBoYW5kbGVyID0gdGhpc1tuYW1lXVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAoIWhhbmRsZXIpIHRocm93IG5ldyBFcnJvcihcIlVua25vd24gYnVpbGRlciBbXCIgKyBuYW1lICsgXCJdIHdhcyB1c2VkIGR1cmluZyBleHRlbmRpbmcgb2YgW1wiICsgdGFyZ2V0TWV0YS5jICsgXCJdXCIpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGhhbmRsZXIuY2FsbCh0aGlzLCB0YXJnZXRNZXRhLCB2YWx1ZSlcbiAgICAgICAgfSwgdGhpcylcbiAgICAgICAgXG4gICAgICAgIHRoaXMuX2J1aWxkQ29tcGxldGUodGFyZ2V0TWV0YSwgcHJvcHMpXG4gICAgfSxcbiAgICBcblxuICAgIF9idWlsZENvbXBsZXRlIDogZnVuY3Rpb24gKHRhcmdldE1ldGEsIHByb3BzKSB7XG4gICAgICAgIHRhcmdldE1ldGEuc3RlbS5jbG9zZSgpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBtZXRob2RzIDogZnVuY3Rpb24gKHRhcmdldE1ldGEsIGluZm8pIHtcbiAgICAgICAgSm9vc2UuTy5lYWNoT3duKGluZm8sIGZ1bmN0aW9uICh2YWx1ZSwgbmFtZSkge1xuICAgICAgICAgICAgdGFyZ2V0TWV0YS5hZGRNZXRob2QobmFtZSwgdmFsdWUpXG4gICAgICAgIH0pXG4gICAgfSxcbiAgICBcblxuICAgIHJlbW92ZU1ldGhvZHMgOiBmdW5jdGlvbiAodGFyZ2V0TWV0YSwgaW5mbykge1xuICAgICAgICBKb29zZS5BLmVhY2goaW5mbywgZnVuY3Rpb24gKG5hbWUpIHtcbiAgICAgICAgICAgIHRhcmdldE1ldGEucmVtb3ZlTWV0aG9kKG5hbWUpXG4gICAgICAgIH0pXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBoYXZlIDogZnVuY3Rpb24gKHRhcmdldE1ldGEsIGluZm8pIHtcbiAgICAgICAgSm9vc2UuTy5lYWNoT3duKGluZm8sIGZ1bmN0aW9uICh2YWx1ZSwgbmFtZSkge1xuICAgICAgICAgICAgdGFyZ2V0TWV0YS5hZGRBdHRyaWJ1dGUobmFtZSwgdmFsdWUpXG4gICAgICAgIH0pXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBoYXZlbm90IDogZnVuY3Rpb24gKHRhcmdldE1ldGEsIGluZm8pIHtcbiAgICAgICAgSm9vc2UuQS5lYWNoKGluZm8sIGZ1bmN0aW9uIChuYW1lKSB7XG4gICAgICAgICAgICB0YXJnZXRNZXRhLnJlbW92ZUF0dHJpYnV0ZShuYW1lKVxuICAgICAgICB9KVxuICAgIH0sXG4gICAgXG5cbiAgICBoYXZlbnQgOiBmdW5jdGlvbiAodGFyZ2V0TWV0YSwgaW5mbykge1xuICAgICAgICB0aGlzLmhhdmVub3QodGFyZ2V0TWV0YSwgaW5mbylcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGFmdGVyIDogZnVuY3Rpb24gKHRhcmdldE1ldGEsIGluZm8pIHtcbiAgICAgICAgSm9vc2UuTy5lYWNoKGluZm8sIGZ1bmN0aW9uICh2YWx1ZSwgbmFtZSkge1xuICAgICAgICAgICAgdGFyZ2V0TWV0YS5hZGRNZXRob2RNb2RpZmllcihuYW1lLCB2YWx1ZSwgSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5NZXRob2RNb2RpZmllci5BZnRlcilcbiAgICAgICAgfSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGJlZm9yZSA6IGZ1bmN0aW9uICh0YXJnZXRNZXRhLCBpbmZvKSB7XG4gICAgICAgIEpvb3NlLk8uZWFjaChpbmZvLCBmdW5jdGlvbiAodmFsdWUsIG5hbWUpIHtcbiAgICAgICAgICAgIHRhcmdldE1ldGEuYWRkTWV0aG9kTW9kaWZpZXIobmFtZSwgdmFsdWUsIEpvb3NlLk1hbmFnZWQuUHJvcGVydHkuTWV0aG9kTW9kaWZpZXIuQmVmb3JlKVxuICAgICAgICB9KVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgb3ZlcnJpZGUgOiBmdW5jdGlvbiAodGFyZ2V0TWV0YSwgaW5mbykge1xuICAgICAgICBKb29zZS5PLmVhY2goaW5mbywgZnVuY3Rpb24gKHZhbHVlLCBuYW1lKSB7XG4gICAgICAgICAgICB0YXJnZXRNZXRhLmFkZE1ldGhvZE1vZGlmaWVyKG5hbWUsIHZhbHVlLCBKb29zZS5NYW5hZ2VkLlByb3BlcnR5Lk1ldGhvZE1vZGlmaWVyLk92ZXJyaWRlKVxuICAgICAgICB9KVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgYXJvdW5kIDogZnVuY3Rpb24gKHRhcmdldE1ldGEsIGluZm8pIHtcbiAgICAgICAgSm9vc2UuTy5lYWNoKGluZm8sIGZ1bmN0aW9uICh2YWx1ZSwgbmFtZSkge1xuICAgICAgICAgICAgdGFyZ2V0TWV0YS5hZGRNZXRob2RNb2RpZmllcihuYW1lLCB2YWx1ZSwgSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5NZXRob2RNb2RpZmllci5Bcm91bmQpXG4gICAgICAgIH0pXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBhdWdtZW50IDogZnVuY3Rpb24gKHRhcmdldE1ldGEsIGluZm8pIHtcbiAgICAgICAgSm9vc2UuTy5lYWNoKGluZm8sIGZ1bmN0aW9uICh2YWx1ZSwgbmFtZSkge1xuICAgICAgICAgICAgdGFyZ2V0TWV0YS5hZGRNZXRob2RNb2RpZmllcihuYW1lLCB2YWx1ZSwgSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5NZXRob2RNb2RpZmllci5BdWdtZW50KVxuICAgICAgICB9KVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgcmVtb3ZlTW9kaWZpZXIgOiBmdW5jdGlvbiAodGFyZ2V0TWV0YSwgaW5mbykge1xuICAgICAgICBKb29zZS5BLmVhY2goaW5mbywgZnVuY3Rpb24gKG5hbWUpIHtcbiAgICAgICAgICAgIHRhcmdldE1ldGEucmVtb3ZlTWV0aG9kTW9kaWZpZXIobmFtZSlcbiAgICAgICAgfSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGRvZXMgOiBmdW5jdGlvbiAodGFyZ2V0TWV0YSwgaW5mbykge1xuICAgICAgICBKb29zZS5BLmVhY2goSm9vc2UuTy53YW50QXJyYXkoaW5mbyksIGZ1bmN0aW9uIChkZXNjKSB7XG4gICAgICAgICAgICB0YXJnZXRNZXRhLmFkZFJvbGUoZGVzYylcbiAgICAgICAgfSlcbiAgICB9LFxuICAgIFxuXG4gICAgZG9lc25vdCA6IGZ1bmN0aW9uICh0YXJnZXRNZXRhLCBpbmZvKSB7XG4gICAgICAgIEpvb3NlLkEuZWFjaChKb29zZS5PLndhbnRBcnJheShpbmZvKSwgZnVuY3Rpb24gKGRlc2MpIHtcbiAgICAgICAgICAgIHRhcmdldE1ldGEucmVtb3ZlUm9sZShkZXNjKVxuICAgICAgICB9KVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgZG9lc250IDogZnVuY3Rpb24gKHRhcmdldE1ldGEsIGluZm8pIHtcbiAgICAgICAgdGhpcy5kb2Vzbm90KHRhcmdldE1ldGEsIGluZm8pXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICB0cmFpdCA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgdGhpcy50cmFpdHMuYXBwbHkodGhpcywgYXJndW1lbnRzKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgdHJhaXRzIDogZnVuY3Rpb24gKHRhcmdldE1ldGEsIGluZm8pIHtcbiAgICAgICAgaWYgKHRhcmdldE1ldGEuZmlyc3RQYXNzKSByZXR1cm5cbiAgICAgICAgXG4gICAgICAgIGlmICghdGFyZ2V0TWV0YS5tZXRhLmlzRGV0YWNoZWQpIHRocm93IFwiQ2FuJ3QgYXBwbHkgdHJhaXQgdG8gbm90IGRldGFjaGVkIGNsYXNzXCJcbiAgICAgICAgXG4gICAgICAgIHRhcmdldE1ldGEubWV0YS5leHRlbmQoe1xuICAgICAgICAgICAgZG9lcyA6IGluZm9cbiAgICAgICAgfSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIHJlbW92ZVRyYWl0IDogZnVuY3Rpb24gKCkge1xuICAgICAgICB0aGlzLnJlbW92ZVRyYWl0cy5hcHBseSh0aGlzLCBhcmd1bWVudHMpXG4gICAgfSxcbiAgICAgXG4gICAgXG4gICAgcmVtb3ZlVHJhaXRzIDogZnVuY3Rpb24gKHRhcmdldE1ldGEsIGluZm8pIHtcbiAgICAgICAgaWYgKCF0YXJnZXRNZXRhLm1ldGEuaXNEZXRhY2hlZCkgdGhyb3cgXCJDYW4ndCByZW1vdmUgdHJhaXQgZnJvbSBub3QgZGV0YWNoZWQgY2xhc3NcIlxuICAgICAgICBcbiAgICAgICAgdGFyZ2V0TWV0YS5tZXRhLmV4dGVuZCh7XG4gICAgICAgICAgICBkb2Vzbm90IDogaW5mb1xuICAgICAgICB9KVxuICAgIH1cbiAgICBcbiAgICBcbiAgICBcbn0pLmM7XG5Kb29zZS5NYW5hZ2VkLkNsYXNzID0gbmV3IEpvb3NlLlByb3RvLkNsYXNzKCdKb29zZS5NYW5hZ2VkLkNsYXNzJywge1xuICAgIFxuICAgIGlzYSAgICAgICAgICAgICAgICAgICAgICAgICA6IEpvb3NlLlByb3RvLkNsYXNzLFxuICAgIFxuICAgIHN0ZW0gICAgICAgICAgICAgICAgICAgICAgICA6IG51bGwsXG4gICAgc3RlbUNsYXNzICAgICAgICAgICAgICAgICAgIDogSm9vc2UuTWFuYWdlZC5TdGVtLFxuICAgIHN0ZW1DbGFzc0NyZWF0ZWQgICAgICAgICAgICA6IGZhbHNlLFxuICAgIFxuICAgIGJ1aWxkZXIgICAgICAgICAgICAgICAgICAgICA6IG51bGwsXG4gICAgYnVpbGRlckNsYXNzICAgICAgICAgICAgICAgIDogSm9vc2UuTWFuYWdlZC5CdWlsZGVyLFxuICAgIGJ1aWxkZXJDbGFzc0NyZWF0ZWQgICAgICAgICA6IGZhbHNlLFxuICAgIFxuICAgIGlzRGV0YWNoZWQgICAgICAgICAgICAgICAgICA6IGZhbHNlLFxuICAgIGZpcnN0UGFzcyAgICAgICAgICAgICAgICAgICA6IHRydWUsXG4gICAgXG4gICAgLy8gYSBzcGVjaWFsIGluc3RhbmNlLCB3aGljaCwgd2hlbiBwYXNzZWQgYXMgMXN0IGFyZ3VtZW50IHRvIGNvbnN0cnVjdG9yLCBzaWduaWZpZXMgdGhhdCBjb25zdHJ1Y3RvciBzaG91bGRcbiAgICAvLyBza2lwcyB0cmFpdHMgcHJvY2Vzc2luZyBmb3IgdGhpcyBpbnN0YW5jZVxuICAgIHNraXBUcmFpdHNBbmNob3IgICAgICAgICAgICA6IHt9LFxuICAgIFxuICAgIFxuICAgIC8vYnVpbGQgZm9yIG1ldGFjbGFzc2VzIC0gY29sbGVjdHMgdHJhaXRzIGZyb20gcm9sZXNcbiAgICBCVUlMRCA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgdmFyIHN1cCA9IEpvb3NlLk1hbmFnZWQuQ2xhc3Muc3VwZXJDbGFzcy5CVUlMRC5hcHBseSh0aGlzLCBhcmd1bWVudHMpXG4gICAgICAgIFxuICAgICAgICB2YXIgcHJvcHMgICA9IHN1cC5fX2V4dGVuZF9fXG4gICAgICAgIFxuICAgICAgICB2YXIgdHJhaXRzID0gSm9vc2UuTy53YW50QXJyYXkocHJvcHMudHJhaXQgfHwgcHJvcHMudHJhaXRzIHx8IFtdKVxuICAgICAgICBkZWxldGUgcHJvcHMudHJhaXRcbiAgICAgICAgZGVsZXRlIHByb3BzLnRyYWl0c1xuICAgICAgICBcbiAgICAgICAgSm9vc2UuQS5lYWNoKEpvb3NlLk8ud2FudEFycmF5KHByb3BzLmRvZXMgfHwgW10pLCBmdW5jdGlvbiAoYXJnKSB7XG4gICAgICAgICAgICB2YXIgcm9sZSA9IChhcmcubWV0YSBpbnN0YW5jZW9mIEpvb3NlLk1hbmFnZWQuQ2xhc3MpID8gYXJnIDogYXJnLnJvbGVcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKHJvbGUubWV0YS5tZXRhLmlzRGV0YWNoZWQpIHRyYWl0cy5wdXNoKHJvbGUubWV0YS5jb25zdHJ1Y3RvcilcbiAgICAgICAgfSlcbiAgICAgICAgXG4gICAgICAgIGlmICh0cmFpdHMubGVuZ3RoKSBwcm9wcy50cmFpdHMgPSB0cmFpdHMgXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gc3VwXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBpbml0SW5zdGFuY2UgOiBmdW5jdGlvbiAoaW5zdGFuY2UsIHByb3BzKSB7XG4gICAgICAgIEpvb3NlLk8uZWFjaCh0aGlzLmF0dHJpYnV0ZXMsIGZ1bmN0aW9uIChhdHRyaWJ1dGUsIG5hbWUpIHtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKGF0dHJpYnV0ZSBpbnN0YW5jZW9mIEpvb3NlLk1hbmFnZWQuQXR0cmlidXRlKSBcbiAgICAgICAgICAgICAgICBhdHRyaWJ1dGUuaW5pdEZyb21Db25maWcoaW5zdGFuY2UsIHByb3BzKVxuICAgICAgICAgICAgZWxzZSBcbiAgICAgICAgICAgICAgICBpZiAocHJvcHMuaGFzT3duUHJvcGVydHkobmFtZSkpIGluc3RhbmNlW25hbWVdID0gcHJvcHNbbmFtZV1cbiAgICAgICAgfSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIC8vIHdlIGFyZSB1c2luZyB0aGUgc2FtZSBjb25zdHJ1Y3RvciBmb3IgdXN1YWwgYW5kIG1ldGEtIGNsYXNzZXNcbiAgICBkZWZhdWx0Q29uc3RydWN0b3I6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgcmV0dXJuIGZ1bmN0aW9uIChza2lwVHJhaXRzQW5jaG9yLCBwYXJhbXMpIHtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdmFyIHRoaXNNZXRhICAgID0gdGhpcy5tZXRhXG4gICAgICAgICAgICB2YXIgc2tpcFRyYWl0cyAgPSBza2lwVHJhaXRzQW5jaG9yID09IHRoaXNNZXRhLnNraXBUcmFpdHNBbmNob3JcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdmFyIEJVSUxEICAgICAgID0gdGhpcy5CVUlMRFxuICAgICAgICAgICAgXG4gICAgICAgICAgICB2YXIgcHJvcHMgICAgICAgPSBCVUlMRCAmJiBCVUlMRC5hcHBseSh0aGlzLCBza2lwVHJhaXRzID8gcGFyYW1zIDogYXJndW1lbnRzKSB8fCAoc2tpcFRyYWl0cyA/IHBhcmFtc1swXSA6IHNraXBUcmFpdHNBbmNob3IpIHx8IHt9XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gZWl0aGVyIGxvb2tpbmcgZm9yIHRyYWl0cyBpbiBfX2V4dGVuZF9fIChtZXRhLWNsYXNzKSBvciBpbiB1c3VhbCBwcm9wcyAodXN1YWwgY2xhc3MpXG4gICAgICAgICAgICB2YXIgZXh0ZW5kICA9IHByb3BzLl9fZXh0ZW5kX18gfHwgcHJvcHNcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdmFyIHRyYWl0cyA9IGV4dGVuZC50cmFpdCB8fCBleHRlbmQudHJhaXRzXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmICh0cmFpdHMgfHwgZXh0ZW5kLmRldGFjaGVkKSB7XG4gICAgICAgICAgICAgICAgZGVsZXRlIGV4dGVuZC50cmFpdFxuICAgICAgICAgICAgICAgIGRlbGV0ZSBleHRlbmQudHJhaXRzXG4gICAgICAgICAgICAgICAgZGVsZXRlIGV4dGVuZC5kZXRhY2hlZFxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIGlmICghc2tpcFRyYWl0cykge1xuICAgICAgICAgICAgICAgICAgICB2YXIgY2xhc3NXaXRoVHJhaXQgID0gdGhpc01ldGEuc3ViQ2xhc3MoeyBkb2VzIDogdHJhaXRzIHx8IFtdIH0sIHRoaXNNZXRhLm5hbWUpXG4gICAgICAgICAgICAgICAgICAgIHZhciBtZXRhICAgICAgICAgICAgPSBjbGFzc1dpdGhUcmFpdC5tZXRhXG4gICAgICAgICAgICAgICAgICAgIG1ldGEuaXNEZXRhY2hlZCAgICAgPSB0cnVlXG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gbWV0YS5pbnN0YW50aWF0ZSh0aGlzTWV0YS5za2lwVHJhaXRzQW5jaG9yLCBhcmd1bWVudHMpXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzTWV0YS5pbml0SW5zdGFuY2UodGhpcywgcHJvcHMpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHJldHVybiB0aGlzTWV0YS5oYXNNZXRob2QoJ2luaXRpYWxpemUnKSAmJiB0aGlzLmluaXRpYWxpemUocHJvcHMpIHx8IHRoaXNcbiAgICAgICAgfVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgZmluYWxpemU6IGZ1bmN0aW9uIChleHRlbmQpIHtcbiAgICAgICAgSm9vc2UuTWFuYWdlZC5DbGFzcy5zdXBlckNsYXNzLmZpbmFsaXplLmNhbGwodGhpcywgZXh0ZW5kKVxuICAgICAgICBcbiAgICAgICAgdGhpcy5zdGVtLmNsb3NlKClcbiAgICAgICAgXG4gICAgICAgIHRoaXMuYWZ0ZXJNdXRhdGUoKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgcHJvY2Vzc1N0ZW0gOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIEpvb3NlLk1hbmFnZWQuQ2xhc3Muc3VwZXJDbGFzcy5wcm9jZXNzU3RlbS5jYWxsKHRoaXMpXG4gICAgICAgIFxuICAgICAgICB0aGlzLmJ1aWxkZXIgICAgPSBuZXcgdGhpcy5idWlsZGVyQ2xhc3MoeyB0YXJnZXRNZXRhIDogdGhpcyB9KVxuICAgICAgICB0aGlzLnN0ZW0gICAgICAgPSBuZXcgdGhpcy5zdGVtQ2xhc3MoeyBuYW1lIDogdGhpcy5uYW1lLCB0YXJnZXRNZXRhIDogdGhpcyB9KVxuICAgICAgICBcbiAgICAgICAgdmFyIGJ1aWxkZXJDbGFzcyA9IHRoaXMuZ2V0Q2xhc3NJbkF0dHJpYnV0ZSgnYnVpbGRlckNsYXNzJylcbiAgICAgICAgXG4gICAgICAgIGlmIChidWlsZGVyQ2xhc3MpIHtcbiAgICAgICAgICAgIHRoaXMuYnVpbGRlckNsYXNzQ3JlYXRlZCA9IHRydWVcbiAgICAgICAgICAgIHRoaXMuYWRkQXR0cmlidXRlKCdidWlsZGVyQ2xhc3MnLCB0aGlzLnN1YkNsYXNzT2YoYnVpbGRlckNsYXNzKSlcbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIHZhciBzdGVtQ2xhc3MgPSB0aGlzLmdldENsYXNzSW5BdHRyaWJ1dGUoJ3N0ZW1DbGFzcycpXG4gICAgICAgIFxuICAgICAgICBpZiAoc3RlbUNsYXNzKSB7XG4gICAgICAgICAgICB0aGlzLnN0ZW1DbGFzc0NyZWF0ZWQgPSB0cnVlXG4gICAgICAgICAgICB0aGlzLmFkZEF0dHJpYnV0ZSgnc3RlbUNsYXNzJywgdGhpcy5zdWJDbGFzc09mKHN0ZW1DbGFzcykpXG4gICAgICAgIH1cbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGV4dGVuZCA6IGZ1bmN0aW9uIChwcm9wcykge1xuICAgICAgICBpZiAocHJvcHMuYnVpbGRlcikge1xuICAgICAgICAgICAgdGhpcy5nZXRCdWlsZGVyVGFyZ2V0KCkubWV0YS5leHRlbmQocHJvcHMuYnVpbGRlcilcbiAgICAgICAgICAgIGRlbGV0ZSBwcm9wcy5idWlsZGVyXG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgICAgIGlmIChwcm9wcy5zdGVtKSB7XG4gICAgICAgICAgICB0aGlzLmdldFN0ZW1UYXJnZXQoKS5tZXRhLmV4dGVuZChwcm9wcy5zdGVtKVxuICAgICAgICAgICAgZGVsZXRlIHByb3BzLnN0ZW1cbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgdGhpcy5idWlsZGVyLl9leHRlbmQocHJvcHMpXG4gICAgICAgIFxuICAgICAgICB0aGlzLmZpcnN0UGFzcyA9IGZhbHNlXG4gICAgICAgIFxuICAgICAgICBpZiAoIXRoaXMuc3RlbS5vcGVuZWQpIHRoaXMuYWZ0ZXJNdXRhdGUoKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgZ2V0QnVpbGRlclRhcmdldCA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgdmFyIGJ1aWxkZXJDbGFzcyA9IHRoaXMuZ2V0Q2xhc3NJbkF0dHJpYnV0ZSgnYnVpbGRlckNsYXNzJylcbiAgICAgICAgaWYgKCFidWlsZGVyQ2xhc3MpIHRocm93IFwiQXR0ZW1wdCB0byBleHRlbmQgYSBidWlsZGVyIG9uIG5vbi1tZXRhIGNsYXNzXCJcbiAgICAgICAgXG4gICAgICAgIHJldHVybiBidWlsZGVyQ2xhc3NcbiAgICB9LFxuICAgIFxuXG4gICAgZ2V0U3RlbVRhcmdldCA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgdmFyIHN0ZW1DbGFzcyA9IHRoaXMuZ2V0Q2xhc3NJbkF0dHJpYnV0ZSgnc3RlbUNsYXNzJylcbiAgICAgICAgaWYgKCFzdGVtQ2xhc3MpIHRocm93IFwiQXR0ZW1wdCB0byBleHRlbmQgYSBzdGVtIG9uIG5vbi1tZXRhIGNsYXNzXCJcbiAgICAgICAgXG4gICAgICAgIHJldHVybiBzdGVtQ2xhc3NcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGdldENsYXNzSW5BdHRyaWJ1dGUgOiBmdW5jdGlvbiAoYXR0cmlidXRlTmFtZSkge1xuICAgICAgICB2YXIgYXR0ckNsYXNzID0gdGhpcy5nZXRBdHRyaWJ1dGUoYXR0cmlidXRlTmFtZSlcbiAgICAgICAgaWYgKGF0dHJDbGFzcyBpbnN0YW5jZW9mIEpvb3NlLk1hbmFnZWQuUHJvcGVydHkuQXR0cmlidXRlKSBhdHRyQ2xhc3MgPSBhdHRyQ2xhc3MudmFsdWVcbiAgICAgICAgXG4gICAgICAgIHJldHVybiBhdHRyQ2xhc3NcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGFkZE1ldGhvZE1vZGlmaWVyOiBmdW5jdGlvbiAobmFtZSwgZnVuYywgdHlwZSkge1xuICAgICAgICB2YXIgcHJvcHMgPSB7fVxuICAgICAgICBcbiAgICAgICAgcHJvcHMuaW5pdCA9IGZ1bmNcbiAgICAgICAgcHJvcHMubWV0YSA9IHR5cGVcbiAgICAgICAgXG4gICAgICAgIHJldHVybiB0aGlzLnN0ZW0ucHJvcGVydGllcy5tZXRob2RzTW9kaWZpZXJzLmFkZFByb3BlcnR5KG5hbWUsIHByb3BzKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgcmVtb3ZlTWV0aG9kTW9kaWZpZXI6IGZ1bmN0aW9uIChuYW1lKSB7XG4gICAgICAgIHJldHVybiB0aGlzLnN0ZW0ucHJvcGVydGllcy5tZXRob2RzTW9kaWZpZXJzLnJlbW92ZVByb3BlcnR5KG5hbWUpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBhZGRNZXRob2Q6IGZ1bmN0aW9uIChuYW1lLCBmdW5jLCBwcm9wcykge1xuICAgICAgICBwcm9wcyA9IHByb3BzIHx8IHt9XG4gICAgICAgIHByb3BzLmluaXQgPSBmdW5jXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gdGhpcy5zdGVtLnByb3BlcnRpZXMubWV0aG9kcy5hZGRQcm9wZXJ0eShuYW1lLCBwcm9wcylcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGFkZEF0dHJpYnV0ZTogZnVuY3Rpb24gKG5hbWUsIGluaXQsIHByb3BzKSB7XG4gICAgICAgIHByb3BzID0gcHJvcHMgfHwge31cbiAgICAgICAgcHJvcHMuaW5pdCA9IGluaXRcbiAgICAgICAgXG4gICAgICAgIHJldHVybiB0aGlzLnN0ZW0ucHJvcGVydGllcy5hdHRyaWJ1dGVzLmFkZFByb3BlcnR5KG5hbWUsIHByb3BzKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgcmVtb3ZlTWV0aG9kIDogZnVuY3Rpb24gKG5hbWUpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuc3RlbS5wcm9wZXJ0aWVzLm1ldGhvZHMucmVtb3ZlUHJvcGVydHkobmFtZSlcbiAgICB9LFxuXG4gICAgXG4gICAgcmVtb3ZlQXR0cmlidXRlOiBmdW5jdGlvbiAobmFtZSkge1xuICAgICAgICByZXR1cm4gdGhpcy5zdGVtLnByb3BlcnRpZXMuYXR0cmlidXRlcy5yZW1vdmVQcm9wZXJ0eShuYW1lKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgaGFzTWV0aG9kOiBmdW5jdGlvbiAobmFtZSkge1xuICAgICAgICByZXR1cm4gdGhpcy5zdGVtLnByb3BlcnRpZXMubWV0aG9kcy5oYXZlUHJvcGVydHkobmFtZSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGhhc0F0dHJpYnV0ZTogZnVuY3Rpb24gKG5hbWUpIHsgXG4gICAgICAgIHJldHVybiB0aGlzLnN0ZW0ucHJvcGVydGllcy5hdHRyaWJ1dGVzLmhhdmVQcm9wZXJ0eShuYW1lKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgaGFzTWV0aG9kTW9kaWZpZXJzRm9yIDogZnVuY3Rpb24gKG5hbWUpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuc3RlbS5wcm9wZXJ0aWVzLm1ldGhvZHNNb2RpZmllcnMuaGF2ZVByb3BlcnR5KG5hbWUpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBoYXNPd25NZXRob2Q6IGZ1bmN0aW9uIChuYW1lKSB7XG4gICAgICAgIHJldHVybiB0aGlzLnN0ZW0ucHJvcGVydGllcy5tZXRob2RzLmhhdmVPd25Qcm9wZXJ0eShuYW1lKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgaGFzT3duQXR0cmlidXRlOiBmdW5jdGlvbiAobmFtZSkgeyBcbiAgICAgICAgcmV0dXJuIHRoaXMuc3RlbS5wcm9wZXJ0aWVzLmF0dHJpYnV0ZXMuaGF2ZU93blByb3BlcnR5KG5hbWUpXG4gICAgfSxcbiAgICBcblxuICAgIGdldE1ldGhvZCA6IGZ1bmN0aW9uIChuYW1lKSB7XG4gICAgICAgIHJldHVybiB0aGlzLnN0ZW0ucHJvcGVydGllcy5tZXRob2RzLmdldFByb3BlcnR5KG5hbWUpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBnZXRBdHRyaWJ1dGUgOiBmdW5jdGlvbiAobmFtZSkge1xuICAgICAgICByZXR1cm4gdGhpcy5zdGVtLnByb3BlcnRpZXMuYXR0cmlidXRlcy5nZXRQcm9wZXJ0eShuYW1lKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgZWFjaFJvbGUgOiBmdW5jdGlvbiAocm9sZXMsIGZ1bmMsIHNjb3BlKSB7XG4gICAgICAgIEpvb3NlLkEuZWFjaChyb2xlcywgZnVuY3Rpb24gKGFyZywgaW5kZXgpIHtcbiAgICAgICAgICAgIHZhciByb2xlID0gKGFyZy5tZXRhIGluc3RhbmNlb2YgSm9vc2UuTWFuYWdlZC5DbGFzcykgPyBhcmcgOiBhcmcucm9sZVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBmdW5jLmNhbGwoc2NvcGUgfHwgdGhpcywgYXJnLCByb2xlLCBpbmRleClcbiAgICAgICAgfSwgdGhpcylcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGFkZFJvbGUgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIFxuICAgICAgICB0aGlzLmVhY2hSb2xlKGFyZ3VtZW50cywgZnVuY3Rpb24gKGFyZywgcm9sZSkge1xuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLmJlZm9yZVJvbGVBZGQocm9sZSlcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdmFyIGRlc2MgPSBhcmdcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy9jb21wb3NlIGRlc2NyaXB0b3IgY2FuIGNvbnRhaW4gJ2FsaWFzJyBhbmQgJ2V4Y2x1ZGUnIGZpZWxkcywgaW4gdGhpcyBjYXNlIGFjdHVhbCByZWZlcmVuY2Ugc2hvdWxkIGJlIHN0b3JlZFxuICAgICAgICAgICAgLy9pbnRvICdwcm9wZXJ0eVNldCcgZmllbGRcbiAgICAgICAgICAgIGlmIChyb2xlICE9IGFyZykge1xuICAgICAgICAgICAgICAgIGRlc2MucHJvcGVydHlTZXQgPSByb2xlLm1ldGEuc3RlbVxuICAgICAgICAgICAgICAgIGRlbGV0ZSBkZXNjLnJvbGVcbiAgICAgICAgICAgIH0gZWxzZVxuICAgICAgICAgICAgICAgIGRlc2MgPSBkZXNjLm1ldGEuc3RlbVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLnN0ZW0uYWRkQ29tcG9zZUluZm8oZGVzYylcbiAgICAgICAgICAgIFxuICAgICAgICB9LCB0aGlzKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgYmVmb3JlUm9sZUFkZCA6IGZ1bmN0aW9uIChyb2xlKSB7XG4gICAgICAgIHZhciByb2xlTWV0YSA9IHJvbGUubWV0YVxuICAgICAgICBcbiAgICAgICAgaWYgKHJvbGVNZXRhLmJ1aWxkZXJDbGFzc0NyZWF0ZWQpIHRoaXMuZ2V0QnVpbGRlclRhcmdldCgpLm1ldGEuZXh0ZW5kKHtcbiAgICAgICAgICAgIGRvZXMgOiBbIHJvbGVNZXRhLmdldEJ1aWxkZXJUYXJnZXQoKSBdXG4gICAgICAgIH0pXG4gICAgICAgIFxuICAgICAgICBpZiAocm9sZU1ldGEuc3RlbUNsYXNzQ3JlYXRlZCkgdGhpcy5nZXRTdGVtVGFyZ2V0KCkubWV0YS5leHRlbmQoe1xuICAgICAgICAgICAgZG9lcyA6IFsgcm9sZU1ldGEuZ2V0U3RlbVRhcmdldCgpIF1cbiAgICAgICAgfSlcbiAgICAgICAgXG4gICAgICAgIGlmIChyb2xlTWV0YS5tZXRhLmlzRGV0YWNoZWQgJiYgIXRoaXMuZmlyc3RQYXNzKSB0aGlzLmJ1aWxkZXIudHJhaXRzKHRoaXMsIHJvbGVNZXRhLmNvbnN0cnVjdG9yKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgYmVmb3JlUm9sZVJlbW92ZSA6IGZ1bmN0aW9uIChyb2xlKSB7XG4gICAgICAgIHZhciByb2xlTWV0YSA9IHJvbGUubWV0YVxuICAgICAgICBcbiAgICAgICAgaWYgKHJvbGVNZXRhLmJ1aWxkZXJDbGFzc0NyZWF0ZWQpIHRoaXMuZ2V0QnVpbGRlclRhcmdldCgpLm1ldGEuZXh0ZW5kKHtcbiAgICAgICAgICAgIGRvZXNudCA6IFsgcm9sZU1ldGEuZ2V0QnVpbGRlclRhcmdldCgpIF1cbiAgICAgICAgfSlcbiAgICAgICAgXG4gICAgICAgIGlmIChyb2xlTWV0YS5zdGVtQ2xhc3NDcmVhdGVkKSB0aGlzLmdldFN0ZW1UYXJnZXQoKS5tZXRhLmV4dGVuZCh7XG4gICAgICAgICAgICBkb2VzbnQgOiBbIHJvbGVNZXRhLmdldFN0ZW1UYXJnZXQoKSBdXG4gICAgICAgIH0pXG4gICAgICAgIFxuICAgICAgICBpZiAocm9sZU1ldGEubWV0YS5pc0RldGFjaGVkICYmICF0aGlzLmZpcnN0UGFzcykgdGhpcy5idWlsZGVyLnJlbW92ZVRyYWl0cyh0aGlzLCByb2xlTWV0YS5jb25zdHJ1Y3RvcilcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIHJlbW92ZVJvbGUgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHRoaXMuZWFjaFJvbGUoYXJndW1lbnRzLCBmdW5jdGlvbiAoYXJnLCByb2xlKSB7XG4gICAgICAgICAgICB0aGlzLmJlZm9yZVJvbGVSZW1vdmUocm9sZSlcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpcy5zdGVtLnJlbW92ZUNvbXBvc2VJbmZvKHJvbGUubWV0YS5zdGVtKVxuICAgICAgICB9LCB0aGlzKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgZ2V0Um9sZXMgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIFxuICAgICAgICByZXR1cm4gSm9vc2UuQS5tYXAodGhpcy5zdGVtLmNvbXBvc2VkRnJvbSwgZnVuY3Rpb24gKGNvbXBvc2VEZXNjKSB7XG4gICAgICAgICAgICAvL2NvbXBvc2UgZGVzY3JpcHRvciBjYW4gY29udGFpbiAnYWxpYXMnIGFuZCAnZXhjbHVkZScgZmllbGRzLCBpbiB0aGlzIGNhc2UgYWN0dWFsIHJlZmVyZW5jZSBpcyBzdG9yZWRcbiAgICAgICAgICAgIC8vaW50byAncHJvcGVydHlTZXQnIGZpZWxkXG4gICAgICAgICAgICBpZiAoIShjb21wb3NlRGVzYyBpbnN0YW5jZW9mIEpvb3NlLk1hbmFnZWQuUHJvcGVydHlTZXQpKSByZXR1cm4gY29tcG9zZURlc2MucHJvcGVydHlTZXRcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcmV0dXJuIGNvbXBvc2VEZXNjLnRhcmdldE1ldGEuY1xuICAgICAgICB9KVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgZG9lcyA6IGZ1bmN0aW9uIChyb2xlKSB7XG4gICAgICAgIHZhciBteVJvbGVzID0gdGhpcy5nZXRSb2xlcygpXG4gICAgICAgIFxuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IG15Um9sZXMubGVuZ3RoOyBpKyspIGlmIChyb2xlID09IG15Um9sZXNbaV0pIHJldHVybiB0cnVlXG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgbXlSb2xlcy5sZW5ndGg7IGkrKykgaWYgKG15Um9sZXNbaV0ubWV0YS5kb2VzKHJvbGUpKSByZXR1cm4gdHJ1ZVxuICAgICAgICBcbiAgICAgICAgdmFyIHN1cGVyTWV0YSA9IHRoaXMuc3VwZXJDbGFzcy5tZXRhXG4gICAgICAgIFxuICAgICAgICAvLyBjb25zaWRlcmluZyB0aGUgY2FzZSBvZiBpbmhlcml0aW5nIGZyb20gbm9uLUpvb3NlIGNsYXNzZXNcbiAgICAgICAgaWYgKHRoaXMuc3VwZXJDbGFzcyAhPSBKb29zZS5Qcm90by5FbXB0eSAmJiBzdXBlck1ldGEgJiYgc3VwZXJNZXRhLm1ldGEgJiYgc3VwZXJNZXRhLm1ldGEuaGFzTWV0aG9kKCdkb2VzJykpIHJldHVybiBzdXBlck1ldGEuZG9lcyhyb2xlKVxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIGZhbHNlXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBnZXRNZXRob2RzIDogZnVuY3Rpb24gKCkge1xuICAgICAgICByZXR1cm4gdGhpcy5zdGVtLnByb3BlcnRpZXMubWV0aG9kc1xuICAgIH0sXG4gICAgXG4gICAgXG4gICAgZ2V0QXR0cmlidXRlcyA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuc3RlbS5wcm9wZXJ0aWVzLmF0dHJpYnV0ZXNcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGFmdGVyTXV0YXRlIDogZnVuY3Rpb24gKCkge1xuICAgIH0sXG4gICAgXG4gICAgXG4gICAgZ2V0Q3VycmVudE1ldGhvZCA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgZm9yICh2YXIgd3JhcHBlciA9IGFyZ3VtZW50cy5jYWxsZWUuY2FsbGVyLCBjb3VudCA9IDA7IHdyYXBwZXIgJiYgY291bnQgPCA1OyB3cmFwcGVyID0gd3JhcHBlci5jYWxsZXIsIGNvdW50KyspXG4gICAgICAgICAgICBpZiAod3JhcHBlci5fX01FVEhPRF9fKSByZXR1cm4gd3JhcHBlci5fX01FVEhPRF9fXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gbnVsbFxuICAgIH1cbiAgICBcbiAgICBcbn0pLmM7XG5Kb29zZS5NYW5hZ2VkLlJvbGUgPSBuZXcgSm9vc2UuTWFuYWdlZC5DbGFzcygnSm9vc2UuTWFuYWdlZC5Sb2xlJywge1xuICAgIFxuICAgIGlzYSAgICAgICAgICAgICAgICAgICAgICAgICA6IEpvb3NlLk1hbmFnZWQuQ2xhc3MsXG4gICAgXG4gICAgaGF2ZSA6IHtcbiAgICAgICAgZGVmYXVsdFN1cGVyQ2xhc3MgICAgICAgOiBKb29zZS5Qcm90by5FbXB0eSxcbiAgICAgICAgXG4gICAgICAgIGJ1aWxkZXJSb2xlICAgICAgICAgICAgIDogbnVsbCxcbiAgICAgICAgc3RlbVJvbGUgICAgICAgICAgICAgICAgOiBudWxsXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBtZXRob2RzIDoge1xuICAgICAgICBcbiAgICAgICAgZGVmYXVsdENvbnN0cnVjdG9yIDogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgcmV0dXJuIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJSb2xlcyBjYW50IGJlIGluc3RhbnRpYXRlZFwiKVxuICAgICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICBcblxuICAgICAgICBwcm9jZXNzU3VwZXJDbGFzcyA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIGlmICh0aGlzLnN1cGVyQ2xhc3MgIT0gdGhpcy5kZWZhdWx0U3VwZXJDbGFzcykgdGhyb3cgbmV3IEVycm9yKFwiUm9sZXMgY2FuJ3QgaW5oZXJpdCBmcm9tIGFueXRoaW5nXCIpXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgZ2V0QnVpbGRlclRhcmdldCA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIGlmICghdGhpcy5idWlsZGVyUm9sZSkge1xuICAgICAgICAgICAgICAgIHRoaXMuYnVpbGRlclJvbGUgPSBuZXcgdGhpcy5jb25zdHJ1Y3RvcigpLmNcbiAgICAgICAgICAgICAgICB0aGlzLmJ1aWxkZXJDbGFzc0NyZWF0ZWQgPSB0cnVlXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHJldHVybiB0aGlzLmJ1aWxkZXJSb2xlXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgIFxuICAgICAgICBnZXRTdGVtVGFyZ2V0IDogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgaWYgKCF0aGlzLnN0ZW1Sb2xlKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5zdGVtUm9sZSA9IG5ldyB0aGlzLmNvbnN0cnVjdG9yKCkuY1xuICAgICAgICAgICAgICAgIHRoaXMuc3RlbUNsYXNzQ3JlYXRlZCA9IHRydWVcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcmV0dXJuIHRoaXMuc3RlbVJvbGVcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgXG4gICAgICAgIGFkZFJlcXVpcmVtZW50IDogZnVuY3Rpb24gKG1ldGhvZE5hbWUpIHtcbiAgICAgICAgICAgIHRoaXMuc3RlbS5wcm9wZXJ0aWVzLnJlcXVpcmVtZW50cy5hZGRQcm9wZXJ0eShtZXRob2ROYW1lLCB7fSlcbiAgICAgICAgfVxuICAgICAgICBcbiAgICB9LFxuICAgIFxuXG4gICAgc3RlbSA6IHtcbiAgICAgICAgbWV0aG9kcyA6IHtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgYXBwbHkgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHVuYXBwbHkgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGJ1aWxkZXIgOiB7XG4gICAgICAgIG1ldGhvZHMgOiB7XG4gICAgICAgICAgICByZXF1aXJlcyA6IGZ1bmN0aW9uICh0YXJnZXRDbGFzc01ldGEsIGluZm8pIHtcbiAgICAgICAgICAgICAgICBKb29zZS5BLmVhY2goSm9vc2UuTy53YW50QXJyYXkoaW5mbyksIGZ1bmN0aW9uIChtZXRob2ROYW1lKSB7XG4gICAgICAgICAgICAgICAgICAgIHRhcmdldENsYXNzTWV0YS5hZGRSZXF1aXJlbWVudChtZXRob2ROYW1lKVxuICAgICAgICAgICAgICAgIH0sIHRoaXMpXG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG4gICAgXG59KS5jO1xuSm9vc2UuTWFuYWdlZC5BdHRyaWJ1dGUgPSBuZXcgSm9vc2UuTWFuYWdlZC5DbGFzcygnSm9vc2UuTWFuYWdlZC5BdHRyaWJ1dGUnLCB7XG4gICAgXG4gICAgaXNhIDogSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5BdHRyaWJ1dGUsXG4gICAgXG4gICAgaGF2ZSA6IHtcbiAgICAgICAgaXMgICAgICAgICAgICAgIDogbnVsbCxcbiAgICAgICAgXG4gICAgICAgIGJ1aWxkZXIgICAgICAgICA6IG51bGwsXG4gICAgICAgIFxuICAgICAgICBpc1ByaXZhdGUgICAgICAgOiBmYWxzZSxcbiAgICAgICAgXG4gICAgICAgIHJvbGUgICAgICAgICAgICA6IG51bGwsXG4gICAgICAgIFxuICAgICAgICBwdWJsaWNOYW1lICAgICAgOiBudWxsLFxuICAgICAgICBzZXR0ZXJOYW1lICAgICAgOiBudWxsLFxuICAgICAgICBnZXR0ZXJOYW1lICAgICAgOiBudWxsLFxuICAgICAgICBcbiAgICAgICAgLy9pbmRpY2F0ZXMgdGhlIGxvZ2ljYWwgcmVhZGFibGVuZXNzL3dyaXRlYWJsZW5lc3Mgb2YgdGhlIGF0dHJpYnV0ZVxuICAgICAgICByZWFkYWJsZSAgICAgICAgOiBmYWxzZSxcbiAgICAgICAgd3JpdGVhYmxlICAgICAgIDogZmFsc2UsXG4gICAgICAgIFxuICAgICAgICAvL2luZGljYXRlcyB0aGUgcGh5c2ljYWwgcHJlc2Vuc2Ugb2YgdGhlIGFjY2Vzc29yIChtYXkgYmUgYWJzZW50IGZvciBcImNvbWJpbmVkXCIgYWNjZXNzb3JzIGZvciBleGFtcGxlKVxuICAgICAgICBoYXNHZXR0ZXIgICAgICAgOiBmYWxzZSxcbiAgICAgICAgaGFzU2V0dGVyICAgICAgIDogZmFsc2UsXG4gICAgICAgIFxuICAgICAgICByZXF1aXJlZCAgICAgICAgOiBmYWxzZSxcbiAgICAgICAgXG4gICAgICAgIGNhbklubGluZVNldFJhdyA6IHRydWUsXG4gICAgICAgIGNhbklubGluZUdldFJhdyA6IHRydWVcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGFmdGVyIDoge1xuICAgICAgICBpbml0aWFsaXplIDogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgdmFyIG5hbWUgPSB0aGlzLm5hbWVcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpcy5wdWJsaWNOYW1lID0gbmFtZS5yZXBsYWNlKC9eXysvLCAnJylcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpcy5zbG90ID0gdGhpcy5pc1ByaXZhdGUgPyAnJCQnICsgbmFtZSA6IG5hbWVcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpcy5zZXR0ZXJOYW1lID0gdGhpcy5zZXR0ZXJOYW1lIHx8IHRoaXMuZ2V0U2V0dGVyTmFtZSgpXG4gICAgICAgICAgICB0aGlzLmdldHRlck5hbWUgPSB0aGlzLmdldHRlck5hbWUgfHwgdGhpcy5nZXRHZXR0ZXJOYW1lKClcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpcy5yZWFkYWJsZSAgPSB0aGlzLmhhc0dldHRlciA9IC9eci9pLnRlc3QodGhpcy5pcylcbiAgICAgICAgICAgIHRoaXMud3JpdGVhYmxlID0gdGhpcy5oYXNTZXR0ZXIgPSAvXi53L2kudGVzdCh0aGlzLmlzKVxuICAgICAgICB9XG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBvdmVycmlkZSA6IHtcbiAgICAgICAgXG4gICAgICAgIGNvbXB1dGVWYWx1ZSA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHZhciBpbml0ICAgID0gdGhpcy5pbml0XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmIChKb29zZS5PLmlzQ2xhc3MoaW5pdCkgfHwgIUpvb3NlLk8uaXNGdW5jdGlvbihpbml0KSkgdGhpcy5TVVBFUigpXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgcHJlQXBwbHkgOiBmdW5jdGlvbiAodGFyZ2V0Q2xhc3MpIHtcbiAgICAgICAgICAgIHRhcmdldENsYXNzLm1ldGEuZXh0ZW5kKHtcbiAgICAgICAgICAgICAgICBtZXRob2RzIDogdGhpcy5nZXRBY2Nlc3NvcnNGb3IodGFyZ2V0Q2xhc3MpXG4gICAgICAgICAgICB9KVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIHBvc3RVbkFwcGx5IDogZnVuY3Rpb24gKGZyb20pIHtcbiAgICAgICAgICAgIGZyb20ubWV0YS5leHRlbmQoe1xuICAgICAgICAgICAgICAgIHJlbW92ZU1ldGhvZHMgOiB0aGlzLmdldEFjY2Vzc29yc0Zyb20oZnJvbSlcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBtZXRob2RzIDoge1xuICAgICAgICBcbiAgICAgICAgZ2V0QWNjZXNzb3JzRm9yIDogZnVuY3Rpb24gKHRhcmdldENsYXNzKSB7XG4gICAgICAgICAgICB2YXIgdGFyZ2V0TWV0YSA9IHRhcmdldENsYXNzLm1ldGFcbiAgICAgICAgICAgIHZhciBzZXR0ZXJOYW1lID0gdGhpcy5zZXR0ZXJOYW1lXG4gICAgICAgICAgICB2YXIgZ2V0dGVyTmFtZSA9IHRoaXMuZ2V0dGVyTmFtZVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB2YXIgbWV0aG9kcyA9IHt9XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmICh0aGlzLmhhc1NldHRlciAmJiAhdGFyZ2V0TWV0YS5oYXNNZXRob2Qoc2V0dGVyTmFtZSkpIHtcbiAgICAgICAgICAgICAgICBtZXRob2RzW3NldHRlck5hbWVdID0gdGhpcy5nZXRTZXR0ZXIoKVxuICAgICAgICAgICAgICAgIG1ldGhvZHNbc2V0dGVyTmFtZV0uQUNDRVNTT1JfRlJPTSA9IHRoaXNcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKHRoaXMuaGFzR2V0dGVyICYmICF0YXJnZXRNZXRhLmhhc01ldGhvZChnZXR0ZXJOYW1lKSkge1xuICAgICAgICAgICAgICAgIG1ldGhvZHNbZ2V0dGVyTmFtZV0gPSB0aGlzLmdldEdldHRlcigpXG4gICAgICAgICAgICAgICAgbWV0aG9kc1tnZXR0ZXJOYW1lXS5BQ0NFU1NPUl9GUk9NID0gdGhpc1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgXG4gICAgICAgICAgICByZXR1cm4gbWV0aG9kc1xuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIGdldEFjY2Vzc29yc0Zyb20gOiBmdW5jdGlvbiAoZnJvbSkge1xuICAgICAgICAgICAgdmFyIHRhcmdldE1ldGEgPSBmcm9tLm1ldGFcbiAgICAgICAgICAgIHZhciBzZXR0ZXJOYW1lID0gdGhpcy5zZXR0ZXJOYW1lXG4gICAgICAgICAgICB2YXIgZ2V0dGVyTmFtZSA9IHRoaXMuZ2V0dGVyTmFtZVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB2YXIgc2V0dGVyID0gdGhpcy5oYXNTZXR0ZXIgJiYgdGFyZ2V0TWV0YS5nZXRNZXRob2Qoc2V0dGVyTmFtZSlcbiAgICAgICAgICAgIHZhciBnZXR0ZXIgPSB0aGlzLmhhc0dldHRlciAmJiB0YXJnZXRNZXRhLmdldE1ldGhvZChnZXR0ZXJOYW1lKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB2YXIgcmVtb3ZlTWV0aG9kcyA9IFtdXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmIChzZXR0ZXIgJiYgc2V0dGVyLnZhbHVlLkFDQ0VTU09SX0ZST00gPT0gdGhpcykgcmVtb3ZlTWV0aG9kcy5wdXNoKHNldHRlck5hbWUpXG4gICAgICAgICAgICBpZiAoZ2V0dGVyICYmIGdldHRlci52YWx1ZS5BQ0NFU1NPUl9GUk9NID09IHRoaXMpIHJlbW92ZU1ldGhvZHMucHVzaChnZXR0ZXJOYW1lKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICByZXR1cm4gcmVtb3ZlTWV0aG9kc1xuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIGdldEdldHRlck5hbWUgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICByZXR1cm4gJ2dldCcgKyBKb29zZS5TLnVwcGVyY2FzZUZpcnN0KHRoaXMucHVibGljTmFtZSlcbiAgICAgICAgfSxcblxuXG4gICAgICAgIGdldFNldHRlck5hbWUgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICByZXR1cm4gJ3NldCcgKyBKb29zZS5TLnVwcGVyY2FzZUZpcnN0KHRoaXMucHVibGljTmFtZSlcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBnZXRTZXR0ZXIgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB2YXIgbWUgICAgICA9IHRoaXNcbiAgICAgICAgICAgIHZhciBzbG90ICAgID0gbWUuc2xvdFxuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAobWUuY2FuSW5saW5lU2V0UmF3KVxuICAgICAgICAgICAgICAgIHJldHVybiBmdW5jdGlvbiAodmFsdWUpIHtcbiAgICAgICAgICAgICAgICAgICAgdGhpc1sgc2xvdCBdID0gdmFsdWVcbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB0aGlzXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZVxuICAgICAgICAgICAgICAgIHJldHVybiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBtZS5zZXRSYXdWYWx1ZVRvLmFwcGx5KHRoaXMsIGFyZ3VtZW50cylcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgZ2V0R2V0dGVyIDogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgdmFyIG1lICAgICAgPSB0aGlzXG4gICAgICAgICAgICB2YXIgc2xvdCAgICA9IG1lLnNsb3RcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKG1lLmNhbklubGluZUdldFJhdylcbiAgICAgICAgICAgICAgICByZXR1cm4gZnVuY3Rpb24gKHZhbHVlKSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB0aGlzWyBzbG90IF1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICBlbHNlXG4gICAgICAgICAgICAgICAgcmV0dXJuIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIG1lLmdldFJhd1ZhbHVlRnJvbS5hcHBseSh0aGlzLCBhcmd1bWVudHMpXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIGdldFZhbHVlRnJvbSA6IGZ1bmN0aW9uIChpbnN0YW5jZSkge1xuICAgICAgICAgICAgdmFyIGdldHRlck5hbWUgICAgICA9IHRoaXMuZ2V0dGVyTmFtZVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAodGhpcy5yZWFkYWJsZSAmJiBpbnN0YW5jZS5tZXRhLmhhc01ldGhvZChnZXR0ZXJOYW1lKSkgcmV0dXJuIGluc3RhbmNlWyBnZXR0ZXJOYW1lIF0oKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5nZXRSYXdWYWx1ZUZyb20oaW5zdGFuY2UpXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgc2V0VmFsdWVUbyA6IGZ1bmN0aW9uIChpbnN0YW5jZSwgdmFsdWUpIHtcbiAgICAgICAgICAgIHZhciBzZXR0ZXJOYW1lICAgICAgPSB0aGlzLnNldHRlck5hbWVcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKHRoaXMud3JpdGVhYmxlICYmIGluc3RhbmNlLm1ldGEuaGFzTWV0aG9kKHNldHRlck5hbWUpKSBcbiAgICAgICAgICAgICAgICBpbnN0YW5jZVsgc2V0dGVyTmFtZSBdKHZhbHVlKVxuICAgICAgICAgICAgZWxzZVxuICAgICAgICAgICAgICAgIHRoaXMuc2V0UmF3VmFsdWVUbyhpbnN0YW5jZSwgdmFsdWUpXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgaW5pdEZyb21Db25maWcgOiBmdW5jdGlvbiAoaW5zdGFuY2UsIGNvbmZpZykge1xuICAgICAgICAgICAgdmFyIG5hbWUgICAgICAgICAgICA9IHRoaXMubmFtZVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB2YXIgdmFsdWUsIGlzU2V0ID0gZmFsc2VcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKGNvbmZpZy5oYXNPd25Qcm9wZXJ0eShuYW1lKSkge1xuICAgICAgICAgICAgICAgIHZhbHVlID0gY29uZmlnW25hbWVdXG4gICAgICAgICAgICAgICAgaXNTZXQgPSB0cnVlXG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHZhciBpbml0ICAgID0gdGhpcy5pbml0XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgLy8gc2ltcGxlIGZ1bmN0aW9uIChub3QgY2xhc3MpIGhhcyBiZWVuIHVzZWQgYXMgXCJpbml0XCIgdmFsdWVcbiAgICAgICAgICAgICAgICBpZiAoSm9vc2UuTy5pc0Z1bmN0aW9uKGluaXQpICYmICFKb29zZS5PLmlzQ2xhc3MoaW5pdCkpIHtcbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIHZhbHVlID0gaW5pdC5jYWxsKGluc3RhbmNlLCBjb25maWcsIG5hbWUpXG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICBpc1NldCA9IHRydWVcbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgfSBlbHNlIGlmICh0aGlzLmJ1aWxkZXIpIHtcbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIHZhbHVlID0gaW5zdGFuY2VbIHRoaXMuYnVpbGRlci5yZXBsYWNlKC9edGhpc1xcLi8sICcnKSBdKGNvbmZpZywgbmFtZSlcbiAgICAgICAgICAgICAgICAgICAgaXNTZXQgPSB0cnVlXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAoaXNTZXQpXG4gICAgICAgICAgICAgICAgdGhpcy5zZXRSYXdWYWx1ZVRvKGluc3RhbmNlLCB2YWx1ZSlcbiAgICAgICAgICAgIGVsc2UgXG4gICAgICAgICAgICAgICAgaWYgKHRoaXMucmVxdWlyZWQpIHRocm93IG5ldyBFcnJvcihcIlJlcXVpcmVkIGF0dHJpYnV0ZSBbXCIgKyBuYW1lICsgXCJdIGlzIG1pc3NlZCBkdXJpbmcgaW5pdGlhbGl6YXRpb24gb2YgXCIgKyBpbnN0YW5jZSlcbiAgICAgICAgfVxuICAgIH1cblxufSkuY1xuO1xuSm9vc2UuTWFuYWdlZC5BdHRyaWJ1dGUuQnVpbGRlciA9IG5ldyBKb29zZS5NYW5hZ2VkLlJvbGUoJ0pvb3NlLk1hbmFnZWQuQXR0cmlidXRlLkJ1aWxkZXInLCB7XG4gICAgXG4gICAgXG4gICAgaGF2ZSA6IHtcbiAgICAgICAgZGVmYXVsdEF0dHJpYnV0ZUNsYXNzIDogSm9vc2UuTWFuYWdlZC5BdHRyaWJ1dGVcbiAgICB9LFxuICAgIFxuICAgIGJ1aWxkZXIgOiB7XG4gICAgICAgIFxuICAgICAgICBtZXRob2RzIDoge1xuICAgICAgICAgICAgXG4gICAgICAgICAgICBoYXMgOiBmdW5jdGlvbiAodGFyZ2V0Q2xhc3NNZXRhLCBpbmZvKSB7XG4gICAgICAgICAgICAgICAgSm9vc2UuTy5lYWNoT3duKGluZm8sIGZ1bmN0aW9uIChwcm9wcywgbmFtZSkge1xuICAgICAgICAgICAgICAgICAgICBpZiAodHlwZW9mIHByb3BzICE9ICdvYmplY3QnIHx8IHByb3BzID09IG51bGwgfHwgcHJvcHMuY29uc3RydWN0b3IgPT0gLyAvLmNvbnN0cnVjdG9yKSBwcm9wcyA9IHsgaW5pdCA6IHByb3BzIH1cbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIHByb3BzLm1ldGEgPSBwcm9wcy5tZXRhIHx8IHRhcmdldENsYXNzTWV0YS5kZWZhdWx0QXR0cmlidXRlQ2xhc3NcbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIGlmICgvXl9fLy50ZXN0KG5hbWUpKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBuYW1lID0gbmFtZS5yZXBsYWNlKC9eXysvLCAnJylcbiAgICAgICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICAgICAgcHJvcHMuaXNQcml2YXRlID0gdHJ1ZVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICB0YXJnZXRDbGFzc01ldGEuYWRkQXR0cmlidXRlKG5hbWUsIHByb3BzLmluaXQsIHByb3BzKVxuICAgICAgICAgICAgICAgIH0sIHRoaXMpXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGhhc25vdCA6IGZ1bmN0aW9uICh0YXJnZXRDbGFzc01ldGEsIGluZm8pIHtcbiAgICAgICAgICAgICAgICB0aGlzLmhhdmVub3QodGFyZ2V0Q2xhc3NNZXRhLCBpbmZvKVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgXG4gICAgICAgICAgICBoYXNudCA6IGZ1bmN0aW9uICh0YXJnZXRDbGFzc01ldGEsIGluZm8pIHtcbiAgICAgICAgICAgICAgICB0aGlzLmhhc25vdCh0YXJnZXRDbGFzc01ldGEsIGluZm8pXG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgICAgIFxuICAgIH1cbiAgICBcbn0pLmNcbjtcbkpvb3NlLk1hbmFnZWQuTXkgPSBuZXcgSm9vc2UuTWFuYWdlZC5Sb2xlKCdKb29zZS5NYW5hZ2VkLk15Jywge1xuICAgIFxuICAgIGhhdmUgOiB7XG4gICAgICAgIG15Q2xhc3MgICAgICAgICAgICAgICAgICAgICAgICAgOiBudWxsLFxuICAgICAgICBcbiAgICAgICAgbmVlZFRvUmVBbGlhcyAgICAgICAgICAgICAgICAgICA6IGZhbHNlXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBtZXRob2RzIDoge1xuICAgICAgICBjcmVhdGVNeSA6IGZ1bmN0aW9uIChleHRlbmQpIHtcbiAgICAgICAgICAgIHZhciB0aGlzTWV0YSA9IHRoaXMubWV0YVxuICAgICAgICAgICAgdmFyIGlzUm9sZSA9IHRoaXMgaW5zdGFuY2VvZiBKb29zZS5NYW5hZ2VkLlJvbGVcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdmFyIG15RXh0ZW5kID0gZXh0ZW5kLm15IHx8IHt9XG4gICAgICAgICAgICBkZWxldGUgZXh0ZW5kLm15XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vIFN5bWJpb250IHdpbGwgZ2VuZXJhbGx5IGhhdmUgdGhlIHNhbWUgbWV0YSBjbGFzcyBhcyBpdHMgaG9zdGVyLCBleGNlcHRpbmcgdGhlIGNhc2VzLCB3aGVuIHRoZSBzdXBlcmNsYXNzIGFsc28gaGF2ZSB0aGUgc3ltYmlvbnQuIFxuICAgICAgICAgICAgLy8gSW4gc3VjaCBjYXNlcywgdGhlIG1ldGEgY2xhc3MgZm9yIHN5bWJpb250IHdpbGwgYmUgaW5oZXJpdGVkICh1bmxlc3MgZXhwbGljaXRseSBzcGVjaWZpZWQpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciBzdXBlckNsYXNzTXkgICAgPSB0aGlzLnN1cGVyQ2xhc3MubWV0YS5teUNsYXNzXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmICghaXNSb2xlICYmICFteUV4dGVuZC5pc2EgJiYgc3VwZXJDbGFzc015KSBteUV4dGVuZC5pc2EgPSBzdXBlckNsYXNzTXlcbiAgICAgICAgICAgIFxuXG4gICAgICAgICAgICBpZiAoIW15RXh0ZW5kLm1ldGEgJiYgIW15RXh0ZW5kLmlzYSkgbXlFeHRlbmQubWV0YSA9IHRoaXMuY29uc3RydWN0b3JcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdmFyIGNyZWF0ZWRDbGFzcyAgICA9IHRoaXMubXlDbGFzcyA9IENsYXNzKG15RXh0ZW5kKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB2YXIgYyAgICAgICAgICAgICAgID0gdGhpcy5jXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGMucHJvdG90eXBlLm15ICAgICAgPSBjLm15ID0gaXNSb2xlID8gY3JlYXRlZENsYXNzIDogbmV3IGNyZWF0ZWRDbGFzcyh7IEhPU1QgOiBjIH0pXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXMubmVlZFRvUmVBbGlhcyA9IHRydWVcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBhbGlhc1N0YXRpY01ldGhvZHMgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB0aGlzLm5lZWRUb1JlQWxpYXMgPSBmYWxzZVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB2YXIgYyAgICAgICAgICAgPSB0aGlzLmNcbiAgICAgICAgICAgIHZhciBteVByb3RvICAgICA9IHRoaXMubXlDbGFzcy5wcm90b3R5cGVcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgSm9vc2UuTy5lYWNoT3duKGMsIGZ1bmN0aW9uIChwcm9wZXJ0eSwgbmFtZSkge1xuICAgICAgICAgICAgICAgIGlmIChwcm9wZXJ0eS5JU19BTElBUykgZGVsZXRlIGNbIG5hbWUgXSBcbiAgICAgICAgICAgIH0pXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXMubXlDbGFzcy5tZXRhLnN0ZW0ucHJvcGVydGllcy5tZXRob2RzLmVhY2goZnVuY3Rpb24gKG1ldGhvZCwgbmFtZSkge1xuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIGlmICghY1sgbmFtZSBdKVxuICAgICAgICAgICAgICAgICAgICAoY1sgbmFtZSBdID0gZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIG15UHJvdG9bIG5hbWUgXS5hcHBseShjLm15LCBhcmd1bWVudHMpXG4gICAgICAgICAgICAgICAgICAgIH0pLklTX0FMSUFTID0gdHJ1ZVxuICAgICAgICAgICAgfSlcbiAgICAgICAgfVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgb3ZlcnJpZGUgOiB7XG4gICAgICAgIFxuICAgICAgICBleHRlbmQgOiBmdW5jdGlvbiAocHJvcHMpIHtcbiAgICAgICAgICAgIHZhciBteUNsYXNzID0gdGhpcy5teUNsYXNzXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmICghbXlDbGFzcyAmJiB0aGlzLnN1cGVyQ2xhc3MubWV0YS5teUNsYXNzKSB0aGlzLmNyZWF0ZU15KHByb3BzKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAocHJvcHMubXkpIHtcbiAgICAgICAgICAgICAgICBpZiAoIW15Q2xhc3MpIFxuICAgICAgICAgICAgICAgICAgICB0aGlzLmNyZWF0ZU15KHByb3BzKVxuICAgICAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLm5lZWRUb1JlQWxpYXMgPSB0cnVlXG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICBteUNsYXNzLm1ldGEuZXh0ZW5kKHByb3BzLm15KVxuICAgICAgICAgICAgICAgICAgICBkZWxldGUgcHJvcHMubXlcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXMuU1VQRVIocHJvcHMpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmICh0aGlzLm5lZWRUb1JlQWxpYXMgJiYgISh0aGlzIGluc3RhbmNlb2YgSm9vc2UuTWFuYWdlZC5Sb2xlKSkgdGhpcy5hbGlhc1N0YXRpY01ldGhvZHMoKVxuICAgICAgICB9ICBcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGJlZm9yZSA6IHtcbiAgICAgICAgXG4gICAgICAgIGFkZFJvbGUgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB2YXIgbXlTdGVtXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIEpvb3NlLkEuZWFjaChhcmd1bWVudHMsIGZ1bmN0aW9uIChhcmcpIHtcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBpZiAoIWFyZykgdGhyb3cgbmV3IEVycm9yKFwiQXR0ZW1wdCB0byBjb25zdW1lIGFuIHVuZGVmaW5lZCBSb2xlIGludG8gW1wiICsgdGhpcy5uYW1lICsgXCJdXCIpXG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgLy9pbnN0YW5jZW9mIENsYXNzIHRvIGFsbG93IHRyZWF0IGNsYXNzZXMgYXMgcm9sZXNcbiAgICAgICAgICAgICAgICB2YXIgcm9sZSA9IChhcmcubWV0YSBpbnN0YW5jZW9mIEpvb3NlLk1hbmFnZWQuQ2xhc3MpID8gYXJnIDogYXJnLnJvbGVcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBpZiAocm9sZS5tZXRhLm1ldGEuaGFzQXR0cmlidXRlKCdteUNsYXNzJykgJiYgcm9sZS5tZXRhLm15Q2xhc3MpIHtcbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIGlmICghdGhpcy5teUNsYXNzKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmNyZWF0ZU15KHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBteSA6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZG9lcyA6IHJvbGUubWV0YS5teUNsYXNzXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVyblxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICBteVN0ZW0gPSB0aGlzLm15Q2xhc3MubWV0YS5zdGVtXG4gICAgICAgICAgICAgICAgICAgIGlmICghbXlTdGVtLm9wZW5lZCkgbXlTdGVtLm9wZW4oKVxuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgbXlTdGVtLmFkZENvbXBvc2VJbmZvKHJvbGUubXkubWV0YS5zdGVtKVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0sIHRoaXMpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmIChteVN0ZW0pIHtcbiAgICAgICAgICAgICAgICBteVN0ZW0uY2xvc2UoKVxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIHRoaXMubmVlZFRvUmVBbGlhcyA9IHRydWVcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICByZW1vdmVSb2xlIDogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgaWYgKCF0aGlzLm15Q2xhc3MpIHJldHVyblxuICAgICAgICAgICAgXG4gICAgICAgICAgICB2YXIgbXlTdGVtID0gdGhpcy5teUNsYXNzLm1ldGEuc3RlbVxuICAgICAgICAgICAgbXlTdGVtLm9wZW4oKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBKb29zZS5BLmVhY2goYXJndW1lbnRzLCBmdW5jdGlvbiAocm9sZSkge1xuICAgICAgICAgICAgICAgIGlmIChyb2xlLm1ldGEubWV0YS5oYXNBdHRyaWJ1dGUoJ215Q2xhc3MnKSAmJiByb2xlLm1ldGEubXlDbGFzcykge1xuICAgICAgICAgICAgICAgICAgICBteVN0ZW0ucmVtb3ZlQ29tcG9zZUluZm8ocm9sZS5teS5tZXRhLnN0ZW0pXG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICB0aGlzLm5lZWRUb1JlQWxpYXMgPSB0cnVlXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSwgdGhpcylcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgbXlTdGVtLmNsb3NlKClcbiAgICAgICAgfVxuICAgICAgICBcbiAgICB9XG4gICAgXG59KS5jO1xuSm9vc2UuTmFtZXNwYWNlID0gSm9vc2Uuc3R1YigpXG5cbkpvb3NlLk5hbWVzcGFjZS5BYmxlID0gbmV3IEpvb3NlLk1hbmFnZWQuUm9sZSgnSm9vc2UuTmFtZXNwYWNlLkFibGUnLCB7XG5cbiAgICBoYXZlIDoge1xuICAgICAgICBib2R5RnVuYyAgICAgICAgICAgICAgICA6IG51bGxcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGJlZm9yZSA6IHtcbiAgICAgICAgZXh0ZW5kIDogZnVuY3Rpb24gKGV4dGVuZCkge1xuICAgICAgICAgICAgaWYgKGV4dGVuZC5ib2R5KSB7XG4gICAgICAgICAgICAgICAgdGhpcy5ib2R5RnVuYyA9IGV4dGVuZC5ib2R5XG4gICAgICAgICAgICAgICAgZGVsZXRlIGV4dGVuZC5ib2R5XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGFmdGVyOiB7XG4gICAgICAgIFxuICAgICAgICBhZnRlck11dGF0ZSA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHZhciBib2R5RnVuYyA9IHRoaXMuYm9keUZ1bmNcbiAgICAgICAgICAgIGRlbGV0ZSB0aGlzLmJvZHlGdW5jXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmIChib2R5RnVuYykgSm9vc2UuTmFtZXNwYWNlLk1hbmFnZXIubXkuZXhlY3V0ZUluKHRoaXMuYywgYm9keUZ1bmMpXG4gICAgICAgIH1cbiAgICB9XG4gICAgXG59KS5jO1xuSm9vc2UuTWFuYWdlZC5Cb290c3RyYXAgPSBuZXcgSm9vc2UuTWFuYWdlZC5Sb2xlKCdKb29zZS5NYW5hZ2VkLkJvb3RzdHJhcCcsIHtcbiAgICBcbiAgICBkb2VzICAgOiBbIEpvb3NlLk5hbWVzcGFjZS5BYmxlLCBKb29zZS5NYW5hZ2VkLk15LCBKb29zZS5NYW5hZ2VkLkF0dHJpYnV0ZS5CdWlsZGVyIF1cbiAgICBcbn0pLmNcbjtcbkpvb3NlLk1ldGEgPSBKb29zZS5zdHViKClcblxuXG5Kb29zZS5NZXRhLk9iamVjdCA9IG5ldyBKb29zZS5Qcm90by5DbGFzcygnSm9vc2UuTWV0YS5PYmplY3QnLCB7XG4gICAgXG4gICAgaXNhICAgICAgICAgICAgIDogSm9vc2UuUHJvdG8uT2JqZWN0XG4gICAgXG59KS5jXG5cblxuO1xuSm9vc2UuTWV0YS5DbGFzcyA9IG5ldyBKb29zZS5NYW5hZ2VkLkNsYXNzKCdKb29zZS5NZXRhLkNsYXNzJywge1xuICAgIFxuICAgIGlzYSAgICAgICAgICAgICAgICAgICAgICAgICA6IEpvb3NlLk1hbmFnZWQuQ2xhc3MsXG4gICAgXG4gICAgZG9lcyAgICAgICAgICAgICAgICAgICAgICAgIDogSm9vc2UuTWFuYWdlZC5Cb290c3RyYXAsXG4gICAgXG4gICAgaGF2ZSA6IHtcbiAgICAgICAgZGVmYXVsdFN1cGVyQ2xhc3MgICAgICAgOiBKb29zZS5NZXRhLk9iamVjdFxuICAgIH1cbiAgICBcbn0pLmNcblxuO1xuSm9vc2UuTWV0YS5Sb2xlID0gbmV3IEpvb3NlLk1ldGEuQ2xhc3MoJ0pvb3NlLk1ldGEuUm9sZScsIHtcbiAgICBcbiAgICBpc2EgICAgICAgICAgICAgICAgICAgICAgICAgOiBKb29zZS5NYW5hZ2VkLlJvbGUsXG4gICAgXG4gICAgZG9lcyAgICAgICAgICAgICAgICAgICAgICAgIDogSm9vc2UuTWFuYWdlZC5Cb290c3RyYXBcbiAgICBcbn0pLmM7XG5Kb29zZS5OYW1lc3BhY2UuS2VlcGVyID0gbmV3IEpvb3NlLk1ldGEuQ2xhc3MoJ0pvb3NlLk5hbWVzcGFjZS5LZWVwZXInLCB7XG4gICAgXG4gICAgaXNhICAgICAgICAgOiBKb29zZS5NZXRhLkNsYXNzLFxuICAgIFxuICAgIGhhdmUgICAgICAgIDoge1xuICAgICAgICBleHRlcm5hbENvbnN0cnVjdG9yICAgICAgICAgICAgIDogbnVsbFxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgbWV0aG9kczoge1xuICAgICAgICBcbiAgICAgICAgZGVmYXVsdENvbnN0cnVjdG9yOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHJldHVybiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgICAgLy9jb25zdHJ1Y3RvcnMgc2hvdWxkIGFzc3VtZSB0aGF0IG1ldGEgaXMgYXR0YWNoZWQgdG8gJ2FyZ3VtZW50cy5jYWxsZWUnIChub3QgdG8gJ3RoaXMnKSBcbiAgICAgICAgICAgICAgICB2YXIgdGhpc01ldGEgPSBhcmd1bWVudHMuY2FsbGVlLm1ldGFcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBpZiAodGhpc01ldGEgaW5zdGFuY2VvZiBKb29zZS5OYW1lc3BhY2UuS2VlcGVyKSB0aHJvdyBuZXcgRXJyb3IoXCJNb2R1bGUgW1wiICsgdGhpc01ldGEuYyArIFwiXSBtYXkgbm90IGJlIGluc3RhbnRpYXRlZC4gRm9yZ290IHRvICd1c2UnIHRoZSBjbGFzcyB3aXRoIHRoZSBzYW1lIG5hbWU/XCIpXG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgdmFyIGV4dGVybmFsQ29uc3RydWN0b3IgPSB0aGlzTWV0YS5leHRlcm5hbENvbnN0cnVjdG9yXG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgaWYgKHR5cGVvZiBleHRlcm5hbENvbnN0cnVjdG9yID09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIGV4dGVybmFsQ29uc3RydWN0b3IubWV0YSA9IHRoaXNNZXRhXG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gZXh0ZXJuYWxDb25zdHJ1Y3Rvci5hcHBseSh0aGlzLCBhcmd1bWVudHMpXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIHRocm93IFwiTmFtZXNwYWNlS2VlcGVyIG9mIFtcIiArIHRoaXNNZXRhLm5hbWUgKyBcIl0gd2FzIHBsYW50ZWQgaW5jb3JyZWN0bHkuXCJcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICAvL3dpdGhDbGFzcyBzaG91bGQgYmUgbm90IGNvbnN0cnVjdGVkIHlldCBvbiB0aGlzIHN0YWdlIChzZWUgSm9vc2UuUHJvdG8uQ2xhc3MuY29uc3RydWN0KVxuICAgICAgICAvL2l0IHNob3VsZCBiZSBvbiB0aGUgJ2NvbnN0cnVjdG9yT25seScgbGlmZSBzdGFnZSAoc2hvdWxkIGFscmVhZHkgaGF2ZSBjb25zdHJ1Y3RvcilcbiAgICAgICAgcGxhbnQ6IGZ1bmN0aW9uICh3aXRoQ2xhc3MpIHtcbiAgICAgICAgICAgIHZhciBrZWVwZXIgPSB0aGlzLmNcbiAgICAgICAgICAgIFxuICAgICAgICAgICAga2VlcGVyLm1ldGEgPSB3aXRoQ2xhc3MubWV0YVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBrZWVwZXIubWV0YS5jID0ga2VlcGVyXG4gICAgICAgICAgICBrZWVwZXIubWV0YS5leHRlcm5hbENvbnN0cnVjdG9yID0gd2l0aENsYXNzXG4gICAgICAgIH1cbiAgICB9XG4gICAgXG59KS5jXG5cblxuO1xuSm9vc2UuTmFtZXNwYWNlLk1hbmFnZXIgPSBuZXcgSm9vc2UuTWFuYWdlZC5DbGFzcygnSm9vc2UuTmFtZXNwYWNlLk1hbmFnZXInLCB7XG4gICAgXG4gICAgaGF2ZSA6IHtcbiAgICAgICAgY3VycmVudCAgICAgOiBudWxsXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBtZXRob2RzIDoge1xuICAgICAgICBcbiAgICAgICAgaW5pdGlhbGl6ZSA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHRoaXMuY3VycmVudCAgICA9IFsgSm9vc2UudG9wIF1cbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBnZXRDdXJyZW50OiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5jdXJyZW50WzBdXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgZXhlY3V0ZUluIDogZnVuY3Rpb24gKG5zLCBmdW5jKSB7XG4gICAgICAgICAgICB2YXIgY3VycmVudCA9IHRoaXMuY3VycmVudFxuICAgICAgICAgICAgXG4gICAgICAgICAgICBjdXJyZW50LnVuc2hpZnQobnMpXG4gICAgICAgICAgICB2YXIgcmVzID0gZnVuYy5jYWxsKG5zLCBucylcbiAgICAgICAgICAgIGN1cnJlbnQuc2hpZnQoKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICByZXR1cm4gcmVzXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgZWFybHlDcmVhdGUgOiBmdW5jdGlvbiAobmFtZSwgbWV0YUNsYXNzLCBwcm9wcykge1xuICAgICAgICAgICAgcHJvcHMuY29uc3RydWN0b3JPbmx5ID0gdHJ1ZVxuICAgICAgICAgICAgXG4gICAgICAgICAgICByZXR1cm4gbmV3IG1ldGFDbGFzcyhuYW1lLCBwcm9wcykuY1xuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIC8vdGhpcyBmdW5jdGlvbiBlc3RhYmxpc2hpbmcgdGhlIGZ1bGwgXCJuYW1lc3BhY2UgY2hhaW5cIiAoaW5jbHVkaW5nIHRoZSBsYXN0IGVsZW1lbnQpXG4gICAgICAgIGNyZWF0ZSA6IGZ1bmN0aW9uIChuc05hbWUsIG1ldGFDbGFzcywgZXh0ZW5kKSB7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vaWYgbm8gbmFtZSBwcm92aWRlZCwgdGhlbiB3ZSBjcmVhdGluZyBhbiBhbm9ueW1vdXMgY2xhc3MsIHNvIGp1c3Qgc2tpcCBhbGwgdGhlIG5hbWVzcGFjZSBtYW5pcHVsYXRpb25zXG4gICAgICAgICAgICBpZiAoIW5zTmFtZSkgcmV0dXJuIG5ldyBtZXRhQ2xhc3MobnNOYW1lLCBleHRlbmQpLmNcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdmFyIG1lID0gdGhpc1xuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAoL15cXC4vLnRlc3QobnNOYW1lKSkgcmV0dXJuIHRoaXMuZXhlY3V0ZUluKEpvb3NlLnRvcCwgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgIHJldHVybiBtZS5jcmVhdGUobnNOYW1lLnJlcGxhY2UoL15cXC4vLCAnJyksIG1ldGFDbGFzcywgZXh0ZW5kKVxuICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdmFyIHByb3BzICAgPSBleHRlbmQgfHwge31cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdmFyIHBhcnRzICAgPSBKb29zZS5TLnNhbmVTcGxpdChuc05hbWUsICcuJylcbiAgICAgICAgICAgIHZhciBvYmplY3QgID0gdGhpcy5nZXRDdXJyZW50KClcbiAgICAgICAgICAgIHZhciBzb0ZhciAgID0gb2JqZWN0ID09IEpvb3NlLnRvcCA/IFtdIDogSm9vc2UuUy5zYW5lU3BsaXQob2JqZWN0Lm1ldGEubmFtZSwgJy4nKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IHBhcnRzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICAgICAgdmFyIHBhcnQgICAgICAgID0gcGFydHNbaV1cbiAgICAgICAgICAgICAgICB2YXIgaXNMYXN0ICAgICAgPSBpID09IHBhcnRzLmxlbmd0aCAtIDFcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBpZiAocGFydCA9PSBcIm1ldGFcIiB8fCBwYXJ0ID09IFwibXlcIiB8fCAhcGFydCkgdGhyb3cgXCJNb2R1bGUgbmFtZSBbXCIgKyBuc05hbWUgKyBcIl0gbWF5IG5vdCBpbmNsdWRlIGEgcGFydCBjYWxsZWQgJ21ldGEnIG9yICdteScgb3IgZW1wdHkgcGFydC5cIlxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIHZhciBjdXIgPSAgIG9iamVjdFtwYXJ0XVxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIHNvRmFyLnB1c2gocGFydClcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICB2YXIgc29GYXJOYW1lICAgICAgID0gc29GYXIuam9pbihcIi5cIilcbiAgICAgICAgICAgICAgICB2YXIgbmVlZEZpbmFsaXplICAgID0gZmFsc2VcbiAgICAgICAgICAgICAgICB2YXIgbnNLZWVwZXJcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAvLyBpZiB0aGUgbmFtZXNwYWNlIHNlZ21lbnQgaXMgZW1wdHlcbiAgICAgICAgICAgICAgICBpZiAodHlwZW9mIGN1ciA9PSBcInVuZGVmaW5lZFwiKSB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChpc0xhc3QpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIHBlcmZvcm0gXCJlYXJseSBjcmVhdGVcIiB3aGljaCBqdXN0IGZpbGxzIHRoZSBuYW1lc3BhY2Ugc2VnbWVudCB3aXRoIHJpZ2h0IGNvbnN0cnVjdG9yXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyB0aGlzIGFsbG93cyB1cyB0byBoYXZlIGEgcmlnaHQgY29uc3RydWN0b3IgaW4gdGhlIG5hbWVzcGFjZSBzZWdtZW50IHdoZW4gdGhlIGBib2R5YCB3aWxsIGJlIGNhbGxlZFxuICAgICAgICAgICAgICAgICAgICAgICAgbnNLZWVwZXIgICAgICAgID0gdGhpcy5lYXJseUNyZWF0ZShzb0Zhck5hbWUsIG1ldGFDbGFzcywgcHJvcHMpXG4gICAgICAgICAgICAgICAgICAgICAgICBuZWVkRmluYWxpemUgICAgPSB0cnVlXG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZVxuICAgICAgICAgICAgICAgICAgICAgICAgbnNLZWVwZXIgICAgICAgID0gbmV3IEpvb3NlLk5hbWVzcGFjZS5LZWVwZXIoc29GYXJOYW1lKS5jXG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICBvYmplY3RbcGFydF0gPSBuc0tlZXBlclxuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgY3VyID0gbnNLZWVwZXJcbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgfSBlbHNlIGlmIChpc0xhc3QgJiYgY3VyICYmIGN1ci5tZXRhKSB7XG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICB2YXIgY3VycmVudE1ldGEgPSBjdXIubWV0YVxuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgaWYgKG1ldGFDbGFzcyA9PSBKb29zZS5OYW1lc3BhY2UuS2VlcGVyKVxuICAgICAgICAgICAgICAgICAgICAgICAgLy9gTW9kdWxlYCBvdmVyIHNvbWV0aGluZyBjYXNlIC0gZXh0ZW5kIHRoZSBvcmlnaW5hbFxuICAgICAgICAgICAgICAgICAgICAgICAgY3VycmVudE1ldGEuZXh0ZW5kKHByb3BzKVxuICAgICAgICAgICAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGN1cnJlbnRNZXRhIGluc3RhbmNlb2YgSm9vc2UuTmFtZXNwYWNlLktlZXBlcikge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGN1cnJlbnRNZXRhLnBsYW50KHRoaXMuZWFybHlDcmVhdGUoc29GYXJOYW1lLCBtZXRhQ2xhc3MsIHByb3BzKSlcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBuZWVkRmluYWxpemUgPSB0cnVlXG4gICAgICAgICAgICAgICAgICAgICAgICB9IGVsc2VcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJEb3VibGUgZGVjbGFyYXRpb24gb2YgW1wiICsgc29GYXJOYW1lICsgXCJdXCIpXG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgfSBlbHNlIFxuICAgICAgICAgICAgICAgICAgICBpZiAoaXNMYXN0ICYmICEoY3VyICYmIGN1ci5tZXRhICYmIGN1ci5tZXRhLm1ldGEpKSB0aHJvdyBcIlRyeWluZyB0byBzZXR1cCBtb2R1bGUgXCIgKyBzb0Zhck5hbWUgKyBcIiBmYWlsZWQuIFRoZXJlIGlzIGFscmVhZHkgc29tZXRoaW5nOiBcIiArIGN1clxuXG4gICAgICAgICAgICAgICAgLy8gaG9vayB0byBhbGxvdyBlbWJlZGQgcmVzb3VyY2UgaW50byBtZXRhXG4gICAgICAgICAgICAgICAgaWYgKGlzTGFzdCkgdGhpcy5wcmVwYXJlTWV0YShjdXIubWV0YSlcbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgaWYgKG5lZWRGaW5hbGl6ZSkgY3VyLm1ldGEuY29uc3RydWN0KHByb3BzKVxuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBvYmplY3QgPSBjdXJcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcmV0dXJuIG9iamVjdFxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIHByZXBhcmVNZXRhIDogZnVuY3Rpb24gKCkge1xuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIHByZXBhcmVQcm9wZXJ0aWVzIDogZnVuY3Rpb24gKG5hbWUsIHByb3BzLCBkZWZhdWx0TWV0YSwgY2FsbGJhY2spIHtcbiAgICAgICAgICAgIGlmIChuYW1lICYmIHR5cGVvZiBuYW1lICE9ICdzdHJpbmcnKSB7XG4gICAgICAgICAgICAgICAgcHJvcHMgICA9IG5hbWVcbiAgICAgICAgICAgICAgICBuYW1lICAgID0gbnVsbFxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB2YXIgbWV0YVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAocHJvcHMgJiYgcHJvcHMubWV0YSkge1xuICAgICAgICAgICAgICAgIG1ldGEgPSBwcm9wcy5tZXRhXG4gICAgICAgICAgICAgICAgZGVsZXRlIHByb3BzLm1ldGFcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKCFtZXRhKVxuICAgICAgICAgICAgICAgIGlmIChwcm9wcyAmJiB0eXBlb2YgcHJvcHMuaXNhID09ICdmdW5jdGlvbicgJiYgcHJvcHMuaXNhLm1ldGEpXG4gICAgICAgICAgICAgICAgICAgIG1ldGEgPSBwcm9wcy5pc2EubWV0YS5jb25zdHJ1Y3RvclxuICAgICAgICAgICAgICAgIGVsc2VcbiAgICAgICAgICAgICAgICAgICAgbWV0YSA9IGRlZmF1bHRNZXRhXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHJldHVybiBjYWxsYmFjay5jYWxsKHRoaXMsIG5hbWUsIG1ldGEsIHByb3BzKVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIGdldERlZmF1bHRIZWxwZXJGb3IgOiBmdW5jdGlvbiAobWV0YUNsYXNzKSB7XG4gICAgICAgICAgICB2YXIgbWUgPSB0aGlzXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHJldHVybiBmdW5jdGlvbiAobmFtZSwgcHJvcHMpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gbWUucHJlcGFyZVByb3BlcnRpZXMobmFtZSwgcHJvcHMsIG1ldGFDbGFzcywgZnVuY3Rpb24gKG5hbWUsIG1ldGEsIHByb3BzKSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBtZS5jcmVhdGUobmFtZSwgbWV0YSwgcHJvcHMpXG4gICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICByZWdpc3RlciA6IGZ1bmN0aW9uIChoZWxwZXJOYW1lLCBtZXRhQ2xhc3MsIGZ1bmMpIHtcbiAgICAgICAgICAgIHZhciBtZSA9IHRoaXNcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKHRoaXMubWV0YS5oYXNNZXRob2QoaGVscGVyTmFtZSkpIHtcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICB2YXIgaGVscGVyID0gZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gbWVbIGhlbHBlck5hbWUgXS5hcHBseShtZSwgYXJndW1lbnRzKVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBpZiAoIUpvb3NlLnRvcFsgaGVscGVyTmFtZSBdKSAgIEpvb3NlLnRvcFsgaGVscGVyTmFtZSBdICAgICAgICAgPSBoZWxwZXJcbiAgICAgICAgICAgICAgICBpZiAoIUpvb3NlWyBoZWxwZXJOYW1lIF0pICAgICAgIEpvb3NlWyBoZWxwZXJOYW1lIF0gICAgICAgICAgICAgPSBoZWxwZXJcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBpZiAoSm9vc2UuaXNfTm9kZUpTICYmIHR5cGVvZiBleHBvcnRzICE9ICd1bmRlZmluZWQnKSAgICAgICAgICAgIGV4cG9ydHNbIGhlbHBlck5hbWUgXSAgICA9IGhlbHBlclxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICB2YXIgbWV0aG9kcyA9IHt9XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgbWV0aG9kc1sgaGVscGVyTmFtZSBdID0gZnVuYyB8fCB0aGlzLmdldERlZmF1bHRIZWxwZXJGb3IobWV0YUNsYXNzKVxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIHRoaXMubWV0YS5leHRlbmQoe1xuICAgICAgICAgICAgICAgICAgICBtZXRob2RzIDogbWV0aG9kc1xuICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgdGhpcy5yZWdpc3RlcihoZWxwZXJOYW1lKVxuICAgICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIE1vZHVsZSA6IGZ1bmN0aW9uIChuYW1lLCBwcm9wcykge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMucHJlcGFyZVByb3BlcnRpZXMobmFtZSwgcHJvcHMsIEpvb3NlLk5hbWVzcGFjZS5LZWVwZXIsIGZ1bmN0aW9uIChuYW1lLCBtZXRhLCBwcm9wcykge1xuICAgICAgICAgICAgICAgIGlmICh0eXBlb2YgcHJvcHMgPT0gJ2Z1bmN0aW9uJykgcHJvcHMgPSB7IGJvZHkgOiBwcm9wcyB9ICAgIFxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLmNyZWF0ZShuYW1lLCBtZXRhLCBwcm9wcylcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH1cbiAgICB9XG4gICAgXG59KS5jXG5cbkpvb3NlLk5hbWVzcGFjZS5NYW5hZ2VyLm15ID0gbmV3IEpvb3NlLk5hbWVzcGFjZS5NYW5hZ2VyKClcblxuSm9vc2UuTmFtZXNwYWNlLk1hbmFnZXIubXkucmVnaXN0ZXIoJ0NsYXNzJywgSm9vc2UuTWV0YS5DbGFzcylcbkpvb3NlLk5hbWVzcGFjZS5NYW5hZ2VyLm15LnJlZ2lzdGVyKCdSb2xlJywgSm9vc2UuTWV0YS5Sb2xlKVxuSm9vc2UuTmFtZXNwYWNlLk1hbmFnZXIubXkucmVnaXN0ZXIoJ01vZHVsZScpXG5cblxuLy8gZm9yIHRoZSByZXN0IG9mIHRoZSBwYWNrYWdlXG52YXIgQ2xhc3MgICAgICAgPSBKb29zZS5DbGFzc1xudmFyIFJvbGUgICAgICAgID0gSm9vc2UuUm9sZVxuO1xuUm9sZSgnSm9vc2UuQXR0cmlidXRlLkRlbGVnYXRlJywge1xuICAgIFxuICAgIGhhdmUgOiB7XG4gICAgICAgIGhhbmRsZXMgOiBudWxsXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBvdmVycmlkZSA6IHtcbiAgICAgICAgXG4gICAgICAgIGVhY2hEZWxlZ2F0ZSA6IGZ1bmN0aW9uIChoYW5kbGVzLCBmdW5jLCBzY29wZSkge1xuICAgICAgICAgICAgaWYgKHR5cGVvZiBoYW5kbGVzID09ICdzdHJpbmcnKSByZXR1cm4gZnVuYy5jYWxsKHNjb3BlLCBoYW5kbGVzLCBoYW5kbGVzKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAoaGFuZGxlcyBpbnN0YW5jZW9mIEFycmF5KVxuICAgICAgICAgICAgICAgIHJldHVybiBKb29zZS5BLmVhY2goaGFuZGxlcywgZnVuY3Rpb24gKGRlbGVnYXRlVG8pIHtcbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIGZ1bmMuY2FsbChzY29wZSwgZGVsZWdhdGVUbywgZGVsZWdhdGVUbylcbiAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKGhhbmRsZXMgPT09IE9iamVjdChoYW5kbGVzKSlcbiAgICAgICAgICAgICAgICBKb29zZS5PLmVhY2hPd24oaGFuZGxlcywgZnVuY3Rpb24gKGRlbGVnYXRlVG8sIGhhbmRsZUFzKSB7XG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICBmdW5jLmNhbGwoc2NvcGUsIGhhbmRsZUFzLCBkZWxlZ2F0ZVRvKVxuICAgICAgICAgICAgICAgIH0pXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgZ2V0QWNjZXNzb3JzRm9yIDogZnVuY3Rpb24gKHRhcmdldENsYXNzKSB7XG4gICAgICAgICAgICB2YXIgdGFyZ2V0TWV0YSAgPSB0YXJnZXRDbGFzcy5tZXRhXG4gICAgICAgICAgICB2YXIgbWV0aG9kcyAgICAgPSB0aGlzLlNVUEVSKHRhcmdldENsYXNzKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB2YXIgbWUgICAgICA9IHRoaXNcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpcy5lYWNoRGVsZWdhdGUodGhpcy5oYW5kbGVzLCBmdW5jdGlvbiAoaGFuZGxlQXMsIGRlbGVnYXRlVG8pIHtcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBpZiAoIXRhcmdldE1ldGEuaGFzTWV0aG9kKGhhbmRsZUFzKSkge1xuICAgICAgICAgICAgICAgICAgICB2YXIgaGFuZGxlciA9IG1ldGhvZHNbIGhhbmRsZUFzIF0gPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICB2YXIgYXR0clZhbHVlID0gbWUuZ2V0VmFsdWVGcm9tKHRoaXMpXG4gICAgICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBhdHRyVmFsdWVbIGRlbGVnYXRlVG8gXS5hcHBseShhdHRyVmFsdWUsIGFyZ3VtZW50cylcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgaGFuZGxlci5BQ0NFU1NPUl9GUk9NID0gbWVcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KVxuICAgICAgICAgICAgXG4gICAgICAgICAgICByZXR1cm4gbWV0aG9kc1xuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIGdldEFjY2Vzc29yc0Zyb20gOiBmdW5jdGlvbiAoZnJvbSkge1xuICAgICAgICAgICAgdmFyIG1ldGhvZHMgPSB0aGlzLlNVUEVSKGZyb20pXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciBtZSAgICAgICAgICA9IHRoaXNcbiAgICAgICAgICAgIHZhciB0YXJnZXRNZXRhICA9IGZyb20ubWV0YVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLmVhY2hEZWxlZ2F0ZSh0aGlzLmhhbmRsZXMsIGZ1bmN0aW9uIChoYW5kbGVBcykge1xuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIHZhciBoYW5kbGVyID0gdGFyZ2V0TWV0YS5nZXRNZXRob2QoaGFuZGxlQXMpXG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgaWYgKGhhbmRsZXIgJiYgaGFuZGxlci52YWx1ZS5BQ0NFU1NPUl9GUk9NID09IG1lKSBtZXRob2RzLnB1c2goaGFuZGxlQXMpXG4gICAgICAgICAgICB9KVxuICAgICAgICAgICAgXG4gICAgICAgICAgICByZXR1cm4gbWV0aG9kc1xuICAgICAgICB9XG4gICAgfVxufSlcblxuO1xuUm9sZSgnSm9vc2UuQXR0cmlidXRlLlRyaWdnZXInLCB7XG4gICAgXG4gICAgaGF2ZSA6IHtcbiAgICAgICAgdHJpZ2dlciAgICAgICAgOiBudWxsXG4gICAgfSwgXG5cbiAgICBcbiAgICBhZnRlciA6IHtcbiAgICAgICAgaW5pdGlhbGl6ZSA6IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgaWYgKHRoaXMudHJpZ2dlcikge1xuICAgICAgICAgICAgICAgIGlmICghdGhpcy53cml0ZWFibGUpIHRocm93IG5ldyBFcnJvcihcIkNhbid0IHVzZSBgdHJpZ2dlcmAgZm9yIHJlYWQtb25seSBhdHRyaWJ1dGVzXCIpXG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgdGhpcy5oYXNTZXR0ZXIgPSB0cnVlXG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9LFxuICAgIFxuICAgIFxuICAgIG92ZXJyaWRlIDoge1xuICAgICAgICBcbiAgICAgICAgZ2V0U2V0dGVyIDogZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICB2YXIgb3JpZ2luYWwgICAgPSB0aGlzLlNVUEVSKClcbiAgICAgICAgICAgIHZhciB0cmlnZ2VyICAgICA9IHRoaXMudHJpZ2dlclxuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAoIXRyaWdnZXIpIHJldHVybiBvcmlnaW5hbFxuICAgICAgICAgICAgXG4gICAgICAgICAgICB2YXIgbWUgICAgICA9IHRoaXNcbiAgICAgICAgICAgIHZhciBpbml0ICAgID0gSm9vc2UuTy5pc0Z1bmN0aW9uKG1lLmluaXQpID8gbnVsbCA6IG1lLmluaXRcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcmV0dXJuIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgICB2YXIgb2xkVmFsdWUgICAgPSBtZS5oYXNWYWx1ZSh0aGlzKSA/IG1lLmdldFZhbHVlRnJvbSh0aGlzKSA6IGluaXRcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICB2YXIgcmVzICAgICAgICAgPSBvcmlnaW5hbC5hcHBseSh0aGlzLCBhcmd1bWVudHMpXG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgdHJpZ2dlci5jYWxsKHRoaXMsIG1lLmdldFZhbHVlRnJvbSh0aGlzKSwgb2xkVmFsdWUpXG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgcmV0dXJuIHJlc1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxufSkgICAgXG5cbjtcblJvbGUoJ0pvb3NlLkF0dHJpYnV0ZS5MYXp5Jywge1xuICAgIFxuICAgIFxuICAgIGhhdmUgOiB7XG4gICAgICAgIGxhenkgICAgICAgIDogbnVsbFxuICAgIH0sIFxuICAgIFxuICAgIFxuICAgIGJlZm9yZSA6IHtcbiAgICAgICAgY29tcHV0ZVZhbHVlIDogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgaWYgKHR5cGVvZiB0aGlzLmluaXQgPT0gJ2Z1bmN0aW9uJyAmJiB0aGlzLmxhenkpIHtcbiAgICAgICAgICAgICAgICB0aGlzLmxhenkgPSB0aGlzLmluaXQgICAgXG4gICAgICAgICAgICAgICAgZGVsZXRlIHRoaXMuaW5pdCAgICBcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgYWZ0ZXIgOiB7XG4gICAgICAgIGluaXRpYWxpemUgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBpZiAodGhpcy5sYXp5KSB0aGlzLnJlYWRhYmxlID0gdGhpcy5oYXNHZXR0ZXIgPSB0cnVlXG4gICAgICAgIH1cbiAgICB9LFxuICAgIFxuICAgIFxuICAgIG92ZXJyaWRlIDoge1xuICAgICAgICBcbiAgICAgICAgZ2V0R2V0dGVyIDogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgdmFyIG9yaWdpbmFsICAgID0gdGhpcy5TVVBFUigpXG4gICAgICAgICAgICB2YXIgbGF6eSAgICAgICAgPSB0aGlzLmxhenlcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKCFsYXp5KSByZXR1cm4gb3JpZ2luYWxcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdmFyIG1lICAgICAgPSB0aGlzICAgIFxuICAgICAgICAgICAgXG4gICAgICAgICAgICByZXR1cm4gZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgIGlmICghbWUuaGFzVmFsdWUodGhpcykpIHtcbiAgICAgICAgICAgICAgICAgICAgdmFyIGluaXRpYWxpemVyID0gdHlwZW9mIGxhenkgPT0gJ2Z1bmN0aW9uJyA/IGxhenkgOiB0aGlzWyBsYXp5LnJlcGxhY2UoL150aGlzXFwuLywgJycpIF1cbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIG1lLnNldFZhbHVlVG8odGhpcywgaW5pdGlhbGl6ZXIuYXBwbHkodGhpcywgYXJndW1lbnRzKSlcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgcmV0dXJuIG9yaWdpbmFsLmNhbGwodGhpcykgICAgXG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG59KVxuXG47XG5Sb2xlKCdKb29zZS5BdHRyaWJ1dGUuQWNjZXNzb3IuQ29tYmluZWQnLCB7XG4gICAgXG4gICAgXG4gICAgaGF2ZSA6IHtcbiAgICAgICAgaXNDb21iaW5lZCAgICAgICAgOiBmYWxzZVxuICAgIH0sIFxuICAgIFxuICAgIFxuICAgIGFmdGVyIDoge1xuICAgICAgICBpbml0aWFsaXplIDogZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICB0aGlzLmlzQ29tYmluZWQgPSB0aGlzLmlzQ29tYmluZWQgfHwgLy4uYy9pLnRlc3QodGhpcy5pcylcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKHRoaXMuaXNDb21iaW5lZCkge1xuICAgICAgICAgICAgICAgIHRoaXMuc2xvdCA9ICckJCcgKyB0aGlzLm5hbWVcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICB0aGlzLmhhc0dldHRlciA9IHRydWVcbiAgICAgICAgICAgICAgICB0aGlzLmhhc1NldHRlciA9IGZhbHNlXG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgdGhpcy5zZXR0ZXJOYW1lID0gdGhpcy5nZXR0ZXJOYW1lID0gdGhpcy5wdWJsaWNOYW1lXG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9LFxuICAgIFxuICAgIFxuICAgIG92ZXJyaWRlIDoge1xuICAgICAgICBcbiAgICAgICAgZ2V0R2V0dGVyIDogZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICB2YXIgZ2V0dGVyICAgID0gdGhpcy5TVVBFUigpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmICghdGhpcy5pc0NvbWJpbmVkKSByZXR1cm4gZ2V0dGVyXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciBzZXR0ZXIgICAgPSB0aGlzLmdldFNldHRlcigpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciBtZSA9IHRoaXNcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcmV0dXJuIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBpZiAoIWFyZ3VtZW50cy5sZW5ndGgpIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKG1lLnJlYWRhYmxlKSByZXR1cm4gZ2V0dGVyLmNhbGwodGhpcylcbiAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ2FsbCB0byBnZXR0ZXIgb2YgdW5yZWFkYWJsZSBhdHRyaWJ1dGU6IFtcIiArIG1lLm5hbWUgKyBcIl1cIilcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgaWYgKG1lLndyaXRlYWJsZSkgcmV0dXJuIHNldHRlci5hcHBseSh0aGlzLCBhcmd1bWVudHMpXG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ2FsbCB0byBzZXR0ZXIgb2YgcmVhZC1vbmx5IGF0dHJpYnV0ZTogW1wiICsgbWUubmFtZSArIFwiXVwiKSAgICBcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cbiAgICBcbn0pXG5cbjtcbkpvb3NlLk1hbmFnZWQuQXR0cmlidXRlLm1ldGEuZXh0ZW5kKHtcbiAgICBkb2VzIDogWyBKb29zZS5BdHRyaWJ1dGUuRGVsZWdhdGUsIEpvb3NlLkF0dHJpYnV0ZS5UcmlnZ2VyLCBKb29zZS5BdHRyaWJ1dGUuTGF6eSwgSm9vc2UuQXR0cmlidXRlLkFjY2Vzc29yLkNvbWJpbmVkIF1cbn0pICAgICAgICAgICAgXG5cbjtcblJvbGUoJ0pvb3NlLk1ldGEuU2luZ2xldG9uJywge1xuICAgIFxuICAgIGhhcyA6IHtcbiAgICAgICAgZm9yY2VJbnN0YW5jZSAgICAgICAgICAgOiBKb29zZS5JLk9iamVjdCxcbiAgICAgICAgaW5zdGFuY2UgICAgICAgICAgICAgICAgOiBudWxsXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBcbiAgICBvdmVycmlkZSA6IHtcbiAgICAgICAgXG4gICAgICAgIGRlZmF1bHRDb25zdHJ1Y3RvciA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHZhciBtZXRhICAgICAgICA9IHRoaXNcbiAgICAgICAgICAgIHZhciBwcmV2aW91cyAgICA9IHRoaXMuU1VQRVIoKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLmFkYXB0Q29uc3RydWN0b3IocHJldmlvdXMpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHJldHVybiBmdW5jdGlvbiAoZm9yY2VJbnN0YW5jZSwgcGFyYW1zKSB7XG4gICAgICAgICAgICAgICAgaWYgKGZvcmNlSW5zdGFuY2UgPT0gbWV0YS5mb3JjZUluc3RhbmNlKSByZXR1cm4gcHJldmlvdXMuYXBwbHkodGhpcywgcGFyYW1zKSB8fCB0aGlzXG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgdmFyIGluc3RhbmNlID0gbWV0YS5pbnN0YW5jZVxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIGlmIChpbnN0YW5jZSkge1xuICAgICAgICAgICAgICAgICAgICBpZiAobWV0YS5oYXNNZXRob2QoJ2NvbmZpZ3VyZScpKSBpbnN0YW5jZS5jb25maWd1cmUuYXBwbHkoaW5zdGFuY2UsIGFyZ3VtZW50cylcbiAgICAgICAgICAgICAgICB9IGVsc2VcbiAgICAgICAgICAgICAgICAgICAgbWV0YS5pbnN0YW5jZSA9IG5ldyBtZXRhLmMobWV0YS5mb3JjZUluc3RhbmNlLCBhcmd1bWVudHMpXG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIHJldHVybiBtZXRhLmluc3RhbmNlXG4gICAgICAgICAgICB9XG4gICAgICAgIH0gICAgICAgIFxuICAgIH1cbiAgICBcblxufSlcblxuXG5Kb29zZS5OYW1lc3BhY2UuTWFuYWdlci5teS5yZWdpc3RlcignU2luZ2xldG9uJywgQ2xhc3Moe1xuICAgIGlzYSAgICAgOiBKb29zZS5NZXRhLkNsYXNzLFxuICAgIG1ldGEgICAgOiBKb29zZS5NZXRhLkNsYXNzLFxuICAgIFxuICAgIGRvZXMgICAgOiBKb29zZS5NZXRhLlNpbmdsZXRvblxufSkpXG47XG47XG59KCk7O1xuIiwiLypcbiAoYykgMjAxMywgVmxhZGltaXIgQWdhZm9ua2luXG4gUkJ1c2gsIGEgSmF2YVNjcmlwdCBsaWJyYXJ5IGZvciBoaWdoLXBlcmZvcm1hbmNlIDJEIHNwYXRpYWwgaW5kZXhpbmcgb2YgcG9pbnRzIGFuZCByZWN0YW5nbGVzLlxuIGh0dHBzOi8vZ2l0aHViLmNvbS9tb3VybmVyL3JidXNoXG4qL1xuXG4oZnVuY3Rpb24gKCkgeyAndXNlIHN0cmljdCc7XG5cbmZ1bmN0aW9uIHJidXNoKG1heEVudHJpZXMsIGZvcm1hdCkge1xuXG4gICAgLy8ganNoaW50IG5ld2NhcDogZmFsc2UsIHZhbGlkdGhpczogdHJ1ZVxuICAgIGlmICghKHRoaXMgaW5zdGFuY2VvZiByYnVzaCkpIHJldHVybiBuZXcgcmJ1c2gobWF4RW50cmllcywgZm9ybWF0KTtcblxuICAgIC8vIG1heCBlbnRyaWVzIGluIGEgbm9kZSBpcyA5IGJ5IGRlZmF1bHQ7IG1pbiBub2RlIGZpbGwgaXMgNDAlIGZvciBiZXN0IHBlcmZvcm1hbmNlXG4gICAgdGhpcy5fbWF4RW50cmllcyA9IE1hdGgubWF4KDQsIG1heEVudHJpZXMgfHwgOSk7XG4gICAgdGhpcy5fbWluRW50cmllcyA9IE1hdGgubWF4KDIsIE1hdGguY2VpbCh0aGlzLl9tYXhFbnRyaWVzICogMC40KSk7XG5cbiAgICBpZiAoZm9ybWF0KSB7XG4gICAgICAgIHRoaXMuX2luaXRGb3JtYXQoZm9ybWF0KTtcbiAgICB9XG5cbiAgICB0aGlzLmNsZWFyKCk7XG59XG5cbnJidXNoLnByb3RvdHlwZSA9IHtcblxuICAgIGFsbDogZnVuY3Rpb24gKCkge1xuICAgICAgICByZXR1cm4gdGhpcy5fYWxsKHRoaXMuZGF0YSwgW10pO1xuICAgIH0sXG5cbiAgICBzZWFyY2g6IGZ1bmN0aW9uIChiYm94KSB7XG5cbiAgICAgICAgdmFyIG5vZGUgPSB0aGlzLmRhdGEsXG4gICAgICAgICAgICByZXN1bHQgPSBbXSxcbiAgICAgICAgICAgIHRvQkJveCA9IHRoaXMudG9CQm94O1xuXG4gICAgICAgIGlmICghaW50ZXJzZWN0cyhiYm94LCBub2RlLmJib3gpKSByZXR1cm4gcmVzdWx0O1xuXG4gICAgICAgIHZhciBub2Rlc1RvU2VhcmNoID0gW10sXG4gICAgICAgICAgICBpLCBsZW4sIGNoaWxkLCBjaGlsZEJCb3g7XG5cbiAgICAgICAgd2hpbGUgKG5vZGUpIHtcbiAgICAgICAgICAgIGZvciAoaSA9IDAsIGxlbiA9IG5vZGUuY2hpbGRyZW4ubGVuZ3RoOyBpIDwgbGVuOyBpKyspIHtcblxuICAgICAgICAgICAgICAgIGNoaWxkID0gbm9kZS5jaGlsZHJlbltpXTtcbiAgICAgICAgICAgICAgICBjaGlsZEJCb3ggPSBub2RlLmxlYWYgPyB0b0JCb3goY2hpbGQpIDogY2hpbGQuYmJveDtcblxuICAgICAgICAgICAgICAgIGlmIChpbnRlcnNlY3RzKGJib3gsIGNoaWxkQkJveCkpIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKG5vZGUubGVhZikgcmVzdWx0LnB1c2goY2hpbGQpO1xuICAgICAgICAgICAgICAgICAgICBlbHNlIGlmIChjb250YWlucyhiYm94LCBjaGlsZEJCb3gpKSB0aGlzLl9hbGwoY2hpbGQsIHJlc3VsdCk7XG4gICAgICAgICAgICAgICAgICAgIGVsc2Ugbm9kZXNUb1NlYXJjaC5wdXNoKGNoaWxkKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBub2RlID0gbm9kZXNUb1NlYXJjaC5wb3AoKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgfSxcblxuICAgIGNvbGxpZGVzOiBmdW5jdGlvbiAoYmJveCkge1xuXG4gICAgICAgIHZhciBub2RlID0gdGhpcy5kYXRhLFxuICAgICAgICAgICAgdG9CQm94ID0gdGhpcy50b0JCb3g7XG5cbiAgICAgICAgaWYgKCFpbnRlcnNlY3RzKGJib3gsIG5vZGUuYmJveCkpIHJldHVybiBmYWxzZTtcblxuICAgICAgICB2YXIgbm9kZXNUb1NlYXJjaCA9IFtdLFxuICAgICAgICAgICAgaSwgbGVuLCBjaGlsZCwgY2hpbGRCQm94O1xuXG4gICAgICAgIHdoaWxlIChub2RlKSB7XG4gICAgICAgICAgICBmb3IgKGkgPSAwLCBsZW4gPSBub2RlLmNoaWxkcmVuLmxlbmd0aDsgaSA8IGxlbjsgaSsrKSB7XG5cbiAgICAgICAgICAgICAgICBjaGlsZCA9IG5vZGUuY2hpbGRyZW5baV07XG4gICAgICAgICAgICAgICAgY2hpbGRCQm94ID0gbm9kZS5sZWFmID8gdG9CQm94KGNoaWxkKSA6IGNoaWxkLmJib3g7XG5cbiAgICAgICAgICAgICAgICBpZiAoaW50ZXJzZWN0cyhiYm94LCBjaGlsZEJCb3gpKSB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChub2RlLmxlYWYgfHwgY29udGFpbnMoYmJveCwgY2hpbGRCQm94KSkgcmV0dXJuIHRydWU7XG4gICAgICAgICAgICAgICAgICAgIG5vZGVzVG9TZWFyY2gucHVzaChjaGlsZCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgbm9kZSA9IG5vZGVzVG9TZWFyY2gucG9wKCk7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgfSxcblxuICAgIGxvYWQ6IGZ1bmN0aW9uIChkYXRhKSB7XG4gICAgICAgIGlmICghKGRhdGEgJiYgZGF0YS5sZW5ndGgpKSByZXR1cm4gdGhpcztcblxuICAgICAgICBpZiAoZGF0YS5sZW5ndGggPCB0aGlzLl9taW5FbnRyaWVzKSB7XG4gICAgICAgICAgICBmb3IgKHZhciBpID0gMCwgbGVuID0gZGF0YS5sZW5ndGg7IGkgPCBsZW47IGkrKykge1xuICAgICAgICAgICAgICAgIHRoaXMuaW5zZXJ0KGRhdGFbaV0pO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgICAgIH1cblxuICAgICAgICAvLyByZWN1cnNpdmVseSBidWlsZCB0aGUgdHJlZSB3aXRoIHRoZSBnaXZlbiBkYXRhIGZyb20gc3RyYXRjaCB1c2luZyBPTVQgYWxnb3JpdGhtXG4gICAgICAgIHZhciBub2RlID0gdGhpcy5fYnVpbGQoZGF0YS5zbGljZSgpLCAwLCBkYXRhLmxlbmd0aCAtIDEsIDApO1xuXG4gICAgICAgIGlmICghdGhpcy5kYXRhLmNoaWxkcmVuLmxlbmd0aCkge1xuICAgICAgICAgICAgLy8gc2F2ZSBhcyBpcyBpZiB0cmVlIGlzIGVtcHR5XG4gICAgICAgICAgICB0aGlzLmRhdGEgPSBub2RlO1xuXG4gICAgICAgIH0gZWxzZSBpZiAodGhpcy5kYXRhLmhlaWdodCA9PT0gbm9kZS5oZWlnaHQpIHtcbiAgICAgICAgICAgIC8vIHNwbGl0IHJvb3QgaWYgdHJlZXMgaGF2ZSB0aGUgc2FtZSBoZWlnaHRcbiAgICAgICAgICAgIHRoaXMuX3NwbGl0Um9vdCh0aGlzLmRhdGEsIG5vZGUpO1xuXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBpZiAodGhpcy5kYXRhLmhlaWdodCA8IG5vZGUuaGVpZ2h0KSB7XG4gICAgICAgICAgICAgICAgLy8gc3dhcCB0cmVlcyBpZiBpbnNlcnRlZCBvbmUgaXMgYmlnZ2VyXG4gICAgICAgICAgICAgICAgdmFyIHRtcE5vZGUgPSB0aGlzLmRhdGE7XG4gICAgICAgICAgICAgICAgdGhpcy5kYXRhID0gbm9kZTtcbiAgICAgICAgICAgICAgICBub2RlID0gdG1wTm9kZTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gaW5zZXJ0IHRoZSBzbWFsbCB0cmVlIGludG8gdGhlIGxhcmdlIHRyZWUgYXQgYXBwcm9wcmlhdGUgbGV2ZWxcbiAgICAgICAgICAgIHRoaXMuX2luc2VydChub2RlLCB0aGlzLmRhdGEuaGVpZ2h0IC0gbm9kZS5oZWlnaHQgLSAxLCB0cnVlKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB0aGlzO1xuICAgIH0sXG5cbiAgICBpbnNlcnQ6IGZ1bmN0aW9uIChpdGVtKSB7XG4gICAgICAgIGlmIChpdGVtKSB0aGlzLl9pbnNlcnQoaXRlbSwgdGhpcy5kYXRhLmhlaWdodCAtIDEpO1xuICAgICAgICByZXR1cm4gdGhpcztcbiAgICB9LFxuXG4gICAgY2xlYXI6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgdGhpcy5kYXRhID0ge1xuICAgICAgICAgICAgY2hpbGRyZW46IFtdLFxuICAgICAgICAgICAgaGVpZ2h0OiAxLFxuICAgICAgICAgICAgYmJveDogZW1wdHkoKSxcbiAgICAgICAgICAgIGxlYWY6IHRydWVcbiAgICAgICAgfTtcbiAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfSxcblxuICAgIHJlbW92ZTogZnVuY3Rpb24gKGl0ZW0pIHtcbiAgICAgICAgaWYgKCFpdGVtKSByZXR1cm4gdGhpcztcblxuICAgICAgICB2YXIgbm9kZSA9IHRoaXMuZGF0YSxcbiAgICAgICAgICAgIGJib3ggPSB0aGlzLnRvQkJveChpdGVtKSxcbiAgICAgICAgICAgIHBhdGggPSBbXSxcbiAgICAgICAgICAgIGluZGV4ZXMgPSBbXSxcbiAgICAgICAgICAgIGksIHBhcmVudCwgaW5kZXgsIGdvaW5nVXA7XG5cbiAgICAgICAgLy8gZGVwdGgtZmlyc3QgaXRlcmF0aXZlIHRyZWUgdHJhdmVyc2FsXG4gICAgICAgIHdoaWxlIChub2RlIHx8IHBhdGgubGVuZ3RoKSB7XG5cbiAgICAgICAgICAgIGlmICghbm9kZSkgeyAvLyBnbyB1cFxuICAgICAgICAgICAgICAgIG5vZGUgPSBwYXRoLnBvcCgpO1xuICAgICAgICAgICAgICAgIHBhcmVudCA9IHBhdGhbcGF0aC5sZW5ndGggLSAxXTtcbiAgICAgICAgICAgICAgICBpID0gaW5kZXhlcy5wb3AoKTtcbiAgICAgICAgICAgICAgICBnb2luZ1VwID0gdHJ1ZTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKG5vZGUubGVhZikgeyAvLyBjaGVjayBjdXJyZW50IG5vZGVcbiAgICAgICAgICAgICAgICBpbmRleCA9IG5vZGUuY2hpbGRyZW4uaW5kZXhPZihpdGVtKTtcblxuICAgICAgICAgICAgICAgIGlmIChpbmRleCAhPT0gLTEpIHtcbiAgICAgICAgICAgICAgICAgICAgLy8gaXRlbSBmb3VuZCwgcmVtb3ZlIHRoZSBpdGVtIGFuZCBjb25kZW5zZSB0cmVlIHVwd2FyZHNcbiAgICAgICAgICAgICAgICAgICAgbm9kZS5jaGlsZHJlbi5zcGxpY2UoaW5kZXgsIDEpO1xuICAgICAgICAgICAgICAgICAgICBwYXRoLnB1c2gobm9kZSk7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX2NvbmRlbnNlKHBhdGgpO1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gdGhpcztcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmICghZ29pbmdVcCAmJiAhbm9kZS5sZWFmICYmIGNvbnRhaW5zKG5vZGUuYmJveCwgYmJveCkpIHsgLy8gZ28gZG93blxuICAgICAgICAgICAgICAgIHBhdGgucHVzaChub2RlKTtcbiAgICAgICAgICAgICAgICBpbmRleGVzLnB1c2goaSk7XG4gICAgICAgICAgICAgICAgaSA9IDA7XG4gICAgICAgICAgICAgICAgcGFyZW50ID0gbm9kZTtcbiAgICAgICAgICAgICAgICBub2RlID0gbm9kZS5jaGlsZHJlblswXTtcblxuICAgICAgICAgICAgfSBlbHNlIGlmIChwYXJlbnQpIHsgLy8gZ28gcmlnaHRcbiAgICAgICAgICAgICAgICBpKys7XG4gICAgICAgICAgICAgICAgbm9kZSA9IHBhcmVudC5jaGlsZHJlbltpXTtcbiAgICAgICAgICAgICAgICBnb2luZ1VwID0gZmFsc2U7XG5cbiAgICAgICAgICAgIH0gZWxzZSBub2RlID0gbnVsbDsgLy8gbm90aGluZyBmb3VuZFxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfSxcblxuICAgIHRvQkJveDogZnVuY3Rpb24gKGl0ZW0pIHsgcmV0dXJuIGl0ZW07IH0sXG5cbiAgICBjb21wYXJlTWluWDogZnVuY3Rpb24gKGEsIGIpIHsgcmV0dXJuIGFbMF0gLSBiWzBdOyB9LFxuICAgIGNvbXBhcmVNaW5ZOiBmdW5jdGlvbiAoYSwgYikgeyByZXR1cm4gYVsxXSAtIGJbMV07IH0sXG5cbiAgICB0b0pTT046IGZ1bmN0aW9uICgpIHsgcmV0dXJuIHRoaXMuZGF0YTsgfSxcblxuICAgIGZyb21KU09OOiBmdW5jdGlvbiAoZGF0YSkge1xuICAgICAgICB0aGlzLmRhdGEgPSBkYXRhO1xuICAgICAgICByZXR1cm4gdGhpcztcbiAgICB9LFxuXG4gICAgX2FsbDogZnVuY3Rpb24gKG5vZGUsIHJlc3VsdCkge1xuICAgICAgICB2YXIgbm9kZXNUb1NlYXJjaCA9IFtdO1xuICAgICAgICB3aGlsZSAobm9kZSkge1xuICAgICAgICAgICAgaWYgKG5vZGUubGVhZikgcmVzdWx0LnB1c2guYXBwbHkocmVzdWx0LCBub2RlLmNoaWxkcmVuKTtcbiAgICAgICAgICAgIGVsc2Ugbm9kZXNUb1NlYXJjaC5wdXNoLmFwcGx5KG5vZGVzVG9TZWFyY2gsIG5vZGUuY2hpbGRyZW4pO1xuXG4gICAgICAgICAgICBub2RlID0gbm9kZXNUb1NlYXJjaC5wb3AoKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gcmVzdWx0O1xuICAgIH0sXG5cbiAgICBfYnVpbGQ6IGZ1bmN0aW9uIChpdGVtcywgbGVmdCwgcmlnaHQsIGhlaWdodCkge1xuXG4gICAgICAgIHZhciBOID0gcmlnaHQgLSBsZWZ0ICsgMSxcbiAgICAgICAgICAgIE0gPSB0aGlzLl9tYXhFbnRyaWVzLFxuICAgICAgICAgICAgbm9kZTtcblxuICAgICAgICBpZiAoTiA8PSBNKSB7XG4gICAgICAgICAgICAvLyByZWFjaGVkIGxlYWYgbGV2ZWw7IHJldHVybiBsZWFmXG4gICAgICAgICAgICBub2RlID0ge1xuICAgICAgICAgICAgICAgIGNoaWxkcmVuOiBpdGVtcy5zbGljZShsZWZ0LCByaWdodCArIDEpLFxuICAgICAgICAgICAgICAgIGhlaWdodDogMSxcbiAgICAgICAgICAgICAgICBiYm94OiBudWxsLFxuICAgICAgICAgICAgICAgIGxlYWY6IHRydWVcbiAgICAgICAgICAgIH07XG4gICAgICAgICAgICBjYWxjQkJveChub2RlLCB0aGlzLnRvQkJveCk7XG4gICAgICAgICAgICByZXR1cm4gbm9kZTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICghaGVpZ2h0KSB7XG4gICAgICAgICAgICAvLyB0YXJnZXQgaGVpZ2h0IG9mIHRoZSBidWxrLWxvYWRlZCB0cmVlXG4gICAgICAgICAgICBoZWlnaHQgPSBNYXRoLmNlaWwoTWF0aC5sb2coTikgLyBNYXRoLmxvZyhNKSk7XG5cbiAgICAgICAgICAgIC8vIHRhcmdldCBudW1iZXIgb2Ygcm9vdCBlbnRyaWVzIHRvIG1heGltaXplIHN0b3JhZ2UgdXRpbGl6YXRpb25cbiAgICAgICAgICAgIE0gPSBNYXRoLmNlaWwoTiAvIE1hdGgucG93KE0sIGhlaWdodCAtIDEpKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFRPRE8gZWxpbWluYXRlIHJlY3Vyc2lvbj9cblxuICAgICAgICBub2RlID0ge1xuICAgICAgICAgICAgY2hpbGRyZW46IFtdLFxuICAgICAgICAgICAgaGVpZ2h0OiBoZWlnaHQsXG4gICAgICAgICAgICBiYm94OiBudWxsXG4gICAgICAgIH07XG5cbiAgICAgICAgLy8gc3BsaXQgdGhlIGl0ZW1zIGludG8gTSBtb3N0bHkgc3F1YXJlIHRpbGVzXG5cbiAgICAgICAgdmFyIE4yID0gTWF0aC5jZWlsKE4gLyBNKSxcbiAgICAgICAgICAgIE4xID0gTjIgKiBNYXRoLmNlaWwoTWF0aC5zcXJ0KE0pKSxcbiAgICAgICAgICAgIGksIGosIHJpZ2h0MiwgcmlnaHQzO1xuXG4gICAgICAgIG11bHRpU2VsZWN0KGl0ZW1zLCBsZWZ0LCByaWdodCwgTjEsIHRoaXMuY29tcGFyZU1pblgpO1xuXG4gICAgICAgIGZvciAoaSA9IGxlZnQ7IGkgPD0gcmlnaHQ7IGkgKz0gTjEpIHtcblxuICAgICAgICAgICAgcmlnaHQyID0gTWF0aC5taW4oaSArIE4xIC0gMSwgcmlnaHQpO1xuXG4gICAgICAgICAgICBtdWx0aVNlbGVjdChpdGVtcywgaSwgcmlnaHQyLCBOMiwgdGhpcy5jb21wYXJlTWluWSk7XG5cbiAgICAgICAgICAgIGZvciAoaiA9IGk7IGogPD0gcmlnaHQyOyBqICs9IE4yKSB7XG5cbiAgICAgICAgICAgICAgICByaWdodDMgPSBNYXRoLm1pbihqICsgTjIgLSAxLCByaWdodDIpO1xuXG4gICAgICAgICAgICAgICAgLy8gcGFjayBlYWNoIGVudHJ5IHJlY3Vyc2l2ZWx5XG4gICAgICAgICAgICAgICAgbm9kZS5jaGlsZHJlbi5wdXNoKHRoaXMuX2J1aWxkKGl0ZW1zLCBqLCByaWdodDMsIGhlaWdodCAtIDEpKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGNhbGNCQm94KG5vZGUsIHRoaXMudG9CQm94KTtcblxuICAgICAgICByZXR1cm4gbm9kZTtcbiAgICB9LFxuXG4gICAgX2Nob29zZVN1YnRyZWU6IGZ1bmN0aW9uIChiYm94LCBub2RlLCBsZXZlbCwgcGF0aCkge1xuXG4gICAgICAgIHZhciBpLCBsZW4sIGNoaWxkLCB0YXJnZXROb2RlLCBhcmVhLCBlbmxhcmdlbWVudCwgbWluQXJlYSwgbWluRW5sYXJnZW1lbnQ7XG5cbiAgICAgICAgd2hpbGUgKHRydWUpIHtcbiAgICAgICAgICAgIHBhdGgucHVzaChub2RlKTtcblxuICAgICAgICAgICAgaWYgKG5vZGUubGVhZiB8fCBwYXRoLmxlbmd0aCAtIDEgPT09IGxldmVsKSBicmVhaztcblxuICAgICAgICAgICAgbWluQXJlYSA9IG1pbkVubGFyZ2VtZW50ID0gSW5maW5pdHk7XG5cbiAgICAgICAgICAgIGZvciAoaSA9IDAsIGxlbiA9IG5vZGUuY2hpbGRyZW4ubGVuZ3RoOyBpIDwgbGVuOyBpKyspIHtcbiAgICAgICAgICAgICAgICBjaGlsZCA9IG5vZGUuY2hpbGRyZW5baV07XG4gICAgICAgICAgICAgICAgYXJlYSA9IGJib3hBcmVhKGNoaWxkLmJib3gpO1xuICAgICAgICAgICAgICAgIGVubGFyZ2VtZW50ID0gZW5sYXJnZWRBcmVhKGJib3gsIGNoaWxkLmJib3gpIC0gYXJlYTtcblxuICAgICAgICAgICAgICAgIC8vIGNob29zZSBlbnRyeSB3aXRoIHRoZSBsZWFzdCBhcmVhIGVubGFyZ2VtZW50XG4gICAgICAgICAgICAgICAgaWYgKGVubGFyZ2VtZW50IDwgbWluRW5sYXJnZW1lbnQpIHtcbiAgICAgICAgICAgICAgICAgICAgbWluRW5sYXJnZW1lbnQgPSBlbmxhcmdlbWVudDtcbiAgICAgICAgICAgICAgICAgICAgbWluQXJlYSA9IGFyZWEgPCBtaW5BcmVhID8gYXJlYSA6IG1pbkFyZWE7XG4gICAgICAgICAgICAgICAgICAgIHRhcmdldE5vZGUgPSBjaGlsZDtcblxuICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAoZW5sYXJnZW1lbnQgPT09IG1pbkVubGFyZ2VtZW50KSB7XG4gICAgICAgICAgICAgICAgICAgIC8vIG90aGVyd2lzZSBjaG9vc2Ugb25lIHdpdGggdGhlIHNtYWxsZXN0IGFyZWFcbiAgICAgICAgICAgICAgICAgICAgaWYgKGFyZWEgPCBtaW5BcmVhKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBtaW5BcmVhID0gYXJlYTtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRhcmdldE5vZGUgPSBjaGlsZDtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgbm9kZSA9IHRhcmdldE5vZGU7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gbm9kZTtcbiAgICB9LFxuXG4gICAgX2luc2VydDogZnVuY3Rpb24gKGl0ZW0sIGxldmVsLCBpc05vZGUpIHtcblxuICAgICAgICB2YXIgdG9CQm94ID0gdGhpcy50b0JCb3gsXG4gICAgICAgICAgICBiYm94ID0gaXNOb2RlID8gaXRlbS5iYm94IDogdG9CQm94KGl0ZW0pLFxuICAgICAgICAgICAgaW5zZXJ0UGF0aCA9IFtdO1xuXG4gICAgICAgIC8vIGZpbmQgdGhlIGJlc3Qgbm9kZSBmb3IgYWNjb21tb2RhdGluZyB0aGUgaXRlbSwgc2F2aW5nIGFsbCBub2RlcyBhbG9uZyB0aGUgcGF0aCB0b29cbiAgICAgICAgdmFyIG5vZGUgPSB0aGlzLl9jaG9vc2VTdWJ0cmVlKGJib3gsIHRoaXMuZGF0YSwgbGV2ZWwsIGluc2VydFBhdGgpO1xuXG4gICAgICAgIC8vIHB1dCB0aGUgaXRlbSBpbnRvIHRoZSBub2RlXG4gICAgICAgIG5vZGUuY2hpbGRyZW4ucHVzaChpdGVtKTtcbiAgICAgICAgZXh0ZW5kKG5vZGUuYmJveCwgYmJveCk7XG5cbiAgICAgICAgLy8gc3BsaXQgb24gbm9kZSBvdmVyZmxvdzsgcHJvcGFnYXRlIHVwd2FyZHMgaWYgbmVjZXNzYXJ5XG4gICAgICAgIHdoaWxlIChsZXZlbCA+PSAwKSB7XG4gICAgICAgICAgICBpZiAoaW5zZXJ0UGF0aFtsZXZlbF0uY2hpbGRyZW4ubGVuZ3RoID4gdGhpcy5fbWF4RW50cmllcykge1xuICAgICAgICAgICAgICAgIHRoaXMuX3NwbGl0KGluc2VydFBhdGgsIGxldmVsKTtcbiAgICAgICAgICAgICAgICBsZXZlbC0tO1xuICAgICAgICAgICAgfSBlbHNlIGJyZWFrO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gYWRqdXN0IGJib3hlcyBhbG9uZyB0aGUgaW5zZXJ0aW9uIHBhdGhcbiAgICAgICAgdGhpcy5fYWRqdXN0UGFyZW50QkJveGVzKGJib3gsIGluc2VydFBhdGgsIGxldmVsKTtcbiAgICB9LFxuXG4gICAgLy8gc3BsaXQgb3ZlcmZsb3dlZCBub2RlIGludG8gdHdvXG4gICAgX3NwbGl0OiBmdW5jdGlvbiAoaW5zZXJ0UGF0aCwgbGV2ZWwpIHtcblxuICAgICAgICB2YXIgbm9kZSA9IGluc2VydFBhdGhbbGV2ZWxdLFxuICAgICAgICAgICAgTSA9IG5vZGUuY2hpbGRyZW4ubGVuZ3RoLFxuICAgICAgICAgICAgbSA9IHRoaXMuX21pbkVudHJpZXM7XG5cbiAgICAgICAgdGhpcy5fY2hvb3NlU3BsaXRBeGlzKG5vZGUsIG0sIE0pO1xuXG4gICAgICAgIHZhciBuZXdOb2RlID0ge1xuICAgICAgICAgICAgY2hpbGRyZW46IG5vZGUuY2hpbGRyZW4uc3BsaWNlKHRoaXMuX2Nob29zZVNwbGl0SW5kZXgobm9kZSwgbSwgTSkpLFxuICAgICAgICAgICAgaGVpZ2h0OiBub2RlLmhlaWdodFxuICAgICAgICB9O1xuXG4gICAgICAgIGlmIChub2RlLmxlYWYpIG5ld05vZGUubGVhZiA9IHRydWU7XG5cbiAgICAgICAgY2FsY0JCb3gobm9kZSwgdGhpcy50b0JCb3gpO1xuICAgICAgICBjYWxjQkJveChuZXdOb2RlLCB0aGlzLnRvQkJveCk7XG5cbiAgICAgICAgaWYgKGxldmVsKSBpbnNlcnRQYXRoW2xldmVsIC0gMV0uY2hpbGRyZW4ucHVzaChuZXdOb2RlKTtcbiAgICAgICAgZWxzZSB0aGlzLl9zcGxpdFJvb3Qobm9kZSwgbmV3Tm9kZSk7XG4gICAgfSxcblxuICAgIF9zcGxpdFJvb3Q6IGZ1bmN0aW9uIChub2RlLCBuZXdOb2RlKSB7XG4gICAgICAgIC8vIHNwbGl0IHJvb3Qgbm9kZVxuICAgICAgICB0aGlzLmRhdGEgPSB7XG4gICAgICAgICAgICBjaGlsZHJlbjogW25vZGUsIG5ld05vZGVdLFxuICAgICAgICAgICAgaGVpZ2h0OiBub2RlLmhlaWdodCArIDFcbiAgICAgICAgfTtcbiAgICAgICAgY2FsY0JCb3godGhpcy5kYXRhLCB0aGlzLnRvQkJveCk7XG4gICAgfSxcblxuICAgIF9jaG9vc2VTcGxpdEluZGV4OiBmdW5jdGlvbiAobm9kZSwgbSwgTSkge1xuXG4gICAgICAgIHZhciBpLCBiYm94MSwgYmJveDIsIG92ZXJsYXAsIGFyZWEsIG1pbk92ZXJsYXAsIG1pbkFyZWEsIGluZGV4O1xuXG4gICAgICAgIG1pbk92ZXJsYXAgPSBtaW5BcmVhID0gSW5maW5pdHk7XG5cbiAgICAgICAgZm9yIChpID0gbTsgaSA8PSBNIC0gbTsgaSsrKSB7XG4gICAgICAgICAgICBiYm94MSA9IGRpc3RCQm94KG5vZGUsIDAsIGksIHRoaXMudG9CQm94KTtcbiAgICAgICAgICAgIGJib3gyID0gZGlzdEJCb3gobm9kZSwgaSwgTSwgdGhpcy50b0JCb3gpO1xuXG4gICAgICAgICAgICBvdmVybGFwID0gaW50ZXJzZWN0aW9uQXJlYShiYm94MSwgYmJveDIpO1xuICAgICAgICAgICAgYXJlYSA9IGJib3hBcmVhKGJib3gxKSArIGJib3hBcmVhKGJib3gyKTtcblxuICAgICAgICAgICAgLy8gY2hvb3NlIGRpc3RyaWJ1dGlvbiB3aXRoIG1pbmltdW0gb3ZlcmxhcFxuICAgICAgICAgICAgaWYgKG92ZXJsYXAgPCBtaW5PdmVybGFwKSB7XG4gICAgICAgICAgICAgICAgbWluT3ZlcmxhcCA9IG92ZXJsYXA7XG4gICAgICAgICAgICAgICAgaW5kZXggPSBpO1xuXG4gICAgICAgICAgICAgICAgbWluQXJlYSA9IGFyZWEgPCBtaW5BcmVhID8gYXJlYSA6IG1pbkFyZWE7XG5cbiAgICAgICAgICAgIH0gZWxzZSBpZiAob3ZlcmxhcCA9PT0gbWluT3ZlcmxhcCkge1xuICAgICAgICAgICAgICAgIC8vIG90aGVyd2lzZSBjaG9vc2UgZGlzdHJpYnV0aW9uIHdpdGggbWluaW11bSBhcmVhXG4gICAgICAgICAgICAgICAgaWYgKGFyZWEgPCBtaW5BcmVhKSB7XG4gICAgICAgICAgICAgICAgICAgIG1pbkFyZWEgPSBhcmVhO1xuICAgICAgICAgICAgICAgICAgICBpbmRleCA9IGk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIGluZGV4O1xuICAgIH0sXG5cbiAgICAvLyBzb3J0cyBub2RlIGNoaWxkcmVuIGJ5IHRoZSBiZXN0IGF4aXMgZm9yIHNwbGl0XG4gICAgX2Nob29zZVNwbGl0QXhpczogZnVuY3Rpb24gKG5vZGUsIG0sIE0pIHtcblxuICAgICAgICB2YXIgY29tcGFyZU1pblggPSBub2RlLmxlYWYgPyB0aGlzLmNvbXBhcmVNaW5YIDogY29tcGFyZU5vZGVNaW5YLFxuICAgICAgICAgICAgY29tcGFyZU1pblkgPSBub2RlLmxlYWYgPyB0aGlzLmNvbXBhcmVNaW5ZIDogY29tcGFyZU5vZGVNaW5ZLFxuICAgICAgICAgICAgeE1hcmdpbiA9IHRoaXMuX2FsbERpc3RNYXJnaW4obm9kZSwgbSwgTSwgY29tcGFyZU1pblgpLFxuICAgICAgICAgICAgeU1hcmdpbiA9IHRoaXMuX2FsbERpc3RNYXJnaW4obm9kZSwgbSwgTSwgY29tcGFyZU1pblkpO1xuXG4gICAgICAgIC8vIGlmIHRvdGFsIGRpc3RyaWJ1dGlvbnMgbWFyZ2luIHZhbHVlIGlzIG1pbmltYWwgZm9yIHgsIHNvcnQgYnkgbWluWCxcbiAgICAgICAgLy8gb3RoZXJ3aXNlIGl0J3MgYWxyZWFkeSBzb3J0ZWQgYnkgbWluWVxuICAgICAgICBpZiAoeE1hcmdpbiA8IHlNYXJnaW4pIG5vZGUuY2hpbGRyZW4uc29ydChjb21wYXJlTWluWCk7XG4gICAgfSxcblxuICAgIC8vIHRvdGFsIG1hcmdpbiBvZiBhbGwgcG9zc2libGUgc3BsaXQgZGlzdHJpYnV0aW9ucyB3aGVyZSBlYWNoIG5vZGUgaXMgYXQgbGVhc3QgbSBmdWxsXG4gICAgX2FsbERpc3RNYXJnaW46IGZ1bmN0aW9uIChub2RlLCBtLCBNLCBjb21wYXJlKSB7XG5cbiAgICAgICAgbm9kZS5jaGlsZHJlbi5zb3J0KGNvbXBhcmUpO1xuXG4gICAgICAgIHZhciB0b0JCb3ggPSB0aGlzLnRvQkJveCxcbiAgICAgICAgICAgIGxlZnRCQm94ID0gZGlzdEJCb3gobm9kZSwgMCwgbSwgdG9CQm94KSxcbiAgICAgICAgICAgIHJpZ2h0QkJveCA9IGRpc3RCQm94KG5vZGUsIE0gLSBtLCBNLCB0b0JCb3gpLFxuICAgICAgICAgICAgbWFyZ2luID0gYmJveE1hcmdpbihsZWZ0QkJveCkgKyBiYm94TWFyZ2luKHJpZ2h0QkJveCksXG4gICAgICAgICAgICBpLCBjaGlsZDtcblxuICAgICAgICBmb3IgKGkgPSBtOyBpIDwgTSAtIG07IGkrKykge1xuICAgICAgICAgICAgY2hpbGQgPSBub2RlLmNoaWxkcmVuW2ldO1xuICAgICAgICAgICAgZXh0ZW5kKGxlZnRCQm94LCBub2RlLmxlYWYgPyB0b0JCb3goY2hpbGQpIDogY2hpbGQuYmJveCk7XG4gICAgICAgICAgICBtYXJnaW4gKz0gYmJveE1hcmdpbihsZWZ0QkJveCk7XG4gICAgICAgIH1cblxuICAgICAgICBmb3IgKGkgPSBNIC0gbSAtIDE7IGkgPj0gbTsgaS0tKSB7XG4gICAgICAgICAgICBjaGlsZCA9IG5vZGUuY2hpbGRyZW5baV07XG4gICAgICAgICAgICBleHRlbmQocmlnaHRCQm94LCBub2RlLmxlYWYgPyB0b0JCb3goY2hpbGQpIDogY2hpbGQuYmJveCk7XG4gICAgICAgICAgICBtYXJnaW4gKz0gYmJveE1hcmdpbihyaWdodEJCb3gpO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIG1hcmdpbjtcbiAgICB9LFxuXG4gICAgX2FkanVzdFBhcmVudEJCb3hlczogZnVuY3Rpb24gKGJib3gsIHBhdGgsIGxldmVsKSB7XG4gICAgICAgIC8vIGFkanVzdCBiYm94ZXMgYWxvbmcgdGhlIGdpdmVuIHRyZWUgcGF0aFxuICAgICAgICBmb3IgKHZhciBpID0gbGV2ZWw7IGkgPj0gMDsgaS0tKSB7XG4gICAgICAgICAgICBleHRlbmQocGF0aFtpXS5iYm94LCBiYm94KTtcbiAgICAgICAgfVxuICAgIH0sXG5cbiAgICBfY29uZGVuc2U6IGZ1bmN0aW9uIChwYXRoKSB7XG4gICAgICAgIC8vIGdvIHRocm91Z2ggdGhlIHBhdGgsIHJlbW92aW5nIGVtcHR5IG5vZGVzIGFuZCB1cGRhdGluZyBiYm94ZXNcbiAgICAgICAgZm9yICh2YXIgaSA9IHBhdGgubGVuZ3RoIC0gMSwgc2libGluZ3M7IGkgPj0gMDsgaS0tKSB7XG4gICAgICAgICAgICBpZiAocGF0aFtpXS5jaGlsZHJlbi5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgICAgICBpZiAoaSA+IDApIHtcbiAgICAgICAgICAgICAgICAgICAgc2libGluZ3MgPSBwYXRoW2kgLSAxXS5jaGlsZHJlbjtcbiAgICAgICAgICAgICAgICAgICAgc2libGluZ3Muc3BsaWNlKHNpYmxpbmdzLmluZGV4T2YocGF0aFtpXSksIDEpO1xuXG4gICAgICAgICAgICAgICAgfSBlbHNlIHRoaXMuY2xlYXIoKTtcblxuICAgICAgICAgICAgfSBlbHNlIGNhbGNCQm94KHBhdGhbaV0sIHRoaXMudG9CQm94KTtcbiAgICAgICAgfVxuICAgIH0sXG5cbiAgICBfaW5pdEZvcm1hdDogZnVuY3Rpb24gKGZvcm1hdCkge1xuICAgICAgICAvLyBkYXRhIGZvcm1hdCAobWluWCwgbWluWSwgbWF4WCwgbWF4WSBhY2Nlc3NvcnMpXG5cbiAgICAgICAgLy8gdXNlcyBldmFsLXR5cGUgZnVuY3Rpb24gY29tcGlsYXRpb24gaW5zdGVhZCBvZiBqdXN0IGFjY2VwdGluZyBhIHRvQkJveCBmdW5jdGlvblxuICAgICAgICAvLyBiZWNhdXNlIHRoZSBhbGdvcml0aG1zIGFyZSB2ZXJ5IHNlbnNpdGl2ZSB0byBzb3J0aW5nIGZ1bmN0aW9ucyBwZXJmb3JtYW5jZSxcbiAgICAgICAgLy8gc28gdGhleSBzaG91bGQgYmUgZGVhZCBzaW1wbGUgYW5kIHdpdGhvdXQgaW5uZXIgY2FsbHNcblxuICAgICAgICAvLyBqc2hpbnQgZXZpbDogdHJ1ZVxuXG4gICAgICAgIHZhciBjb21wYXJlQXJyID0gWydyZXR1cm4gYScsICcgLSBiJywgJzsnXTtcblxuICAgICAgICB0aGlzLmNvbXBhcmVNaW5YID0gbmV3IEZ1bmN0aW9uKCdhJywgJ2InLCBjb21wYXJlQXJyLmpvaW4oZm9ybWF0WzBdKSk7XG4gICAgICAgIHRoaXMuY29tcGFyZU1pblkgPSBuZXcgRnVuY3Rpb24oJ2EnLCAnYicsIGNvbXBhcmVBcnIuam9pbihmb3JtYXRbMV0pKTtcblxuICAgICAgICB0aGlzLnRvQkJveCA9IG5ldyBGdW5jdGlvbignYScsICdyZXR1cm4gW2EnICsgZm9ybWF0LmpvaW4oJywgYScpICsgJ107Jyk7XG4gICAgfVxufTtcblxuXG4vLyBjYWxjdWxhdGUgbm9kZSdzIGJib3ggZnJvbSBiYm94ZXMgb2YgaXRzIGNoaWxkcmVuXG5mdW5jdGlvbiBjYWxjQkJveChub2RlLCB0b0JCb3gpIHtcbiAgICBub2RlLmJib3ggPSBkaXN0QkJveChub2RlLCAwLCBub2RlLmNoaWxkcmVuLmxlbmd0aCwgdG9CQm94KTtcbn1cblxuLy8gbWluIGJvdW5kaW5nIHJlY3RhbmdsZSBvZiBub2RlIGNoaWxkcmVuIGZyb20gayB0byBwLTFcbmZ1bmN0aW9uIGRpc3RCQm94KG5vZGUsIGssIHAsIHRvQkJveCkge1xuICAgIHZhciBiYm94ID0gZW1wdHkoKTtcblxuICAgIGZvciAodmFyIGkgPSBrLCBjaGlsZDsgaSA8IHA7IGkrKykge1xuICAgICAgICBjaGlsZCA9IG5vZGUuY2hpbGRyZW5baV07XG4gICAgICAgIGV4dGVuZChiYm94LCBub2RlLmxlYWYgPyB0b0JCb3goY2hpbGQpIDogY2hpbGQuYmJveCk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGJib3g7XG59XG5cbmZ1bmN0aW9uIGVtcHR5KCkgeyByZXR1cm4gW0luZmluaXR5LCBJbmZpbml0eSwgLUluZmluaXR5LCAtSW5maW5pdHldOyB9XG5cbmZ1bmN0aW9uIGV4dGVuZChhLCBiKSB7XG4gICAgYVswXSA9IE1hdGgubWluKGFbMF0sIGJbMF0pO1xuICAgIGFbMV0gPSBNYXRoLm1pbihhWzFdLCBiWzFdKTtcbiAgICBhWzJdID0gTWF0aC5tYXgoYVsyXSwgYlsyXSk7XG4gICAgYVszXSA9IE1hdGgubWF4KGFbM10sIGJbM10pO1xuICAgIHJldHVybiBhO1xufVxuXG5mdW5jdGlvbiBjb21wYXJlTm9kZU1pblgoYSwgYikgeyByZXR1cm4gYS5iYm94WzBdIC0gYi5iYm94WzBdOyB9XG5mdW5jdGlvbiBjb21wYXJlTm9kZU1pblkoYSwgYikgeyByZXR1cm4gYS5iYm94WzFdIC0gYi5iYm94WzFdOyB9XG5cbmZ1bmN0aW9uIGJib3hBcmVhKGEpICAgeyByZXR1cm4gKGFbMl0gLSBhWzBdKSAqIChhWzNdIC0gYVsxXSk7IH1cbmZ1bmN0aW9uIGJib3hNYXJnaW4oYSkgeyByZXR1cm4gKGFbMl0gLSBhWzBdKSArIChhWzNdIC0gYVsxXSk7IH1cblxuZnVuY3Rpb24gZW5sYXJnZWRBcmVhKGEsIGIpIHtcbiAgICByZXR1cm4gKE1hdGgubWF4KGJbMl0sIGFbMl0pIC0gTWF0aC5taW4oYlswXSwgYVswXSkpICpcbiAgICAgICAgICAgKE1hdGgubWF4KGJbM10sIGFbM10pIC0gTWF0aC5taW4oYlsxXSwgYVsxXSkpO1xufVxuXG5mdW5jdGlvbiBpbnRlcnNlY3Rpb25BcmVhKGEsIGIpIHtcbiAgICB2YXIgbWluWCA9IE1hdGgubWF4KGFbMF0sIGJbMF0pLFxuICAgICAgICBtaW5ZID0gTWF0aC5tYXgoYVsxXSwgYlsxXSksXG4gICAgICAgIG1heFggPSBNYXRoLm1pbihhWzJdLCBiWzJdKSxcbiAgICAgICAgbWF4WSA9IE1hdGgubWluKGFbM10sIGJbM10pO1xuXG4gICAgcmV0dXJuIE1hdGgubWF4KDAsIG1heFggLSBtaW5YKSAqXG4gICAgICAgICAgIE1hdGgubWF4KDAsIG1heFkgLSBtaW5ZKTtcbn1cblxuZnVuY3Rpb24gY29udGFpbnMoYSwgYikge1xuICAgIHJldHVybiBhWzBdIDw9IGJbMF0gJiZcbiAgICAgICAgICAgYVsxXSA8PSBiWzFdICYmXG4gICAgICAgICAgIGJbMl0gPD0gYVsyXSAmJlxuICAgICAgICAgICBiWzNdIDw9IGFbM107XG59XG5cbmZ1bmN0aW9uIGludGVyc2VjdHMoYSwgYikge1xuICAgIHJldHVybiBiWzBdIDw9IGFbMl0gJiZcbiAgICAgICAgICAgYlsxXSA8PSBhWzNdICYmXG4gICAgICAgICAgIGJbMl0gPj0gYVswXSAmJlxuICAgICAgICAgICBiWzNdID49IGFbMV07XG59XG5cbi8vIHNvcnQgYW4gYXJyYXkgc28gdGhhdCBpdGVtcyBjb21lIGluIGdyb3VwcyBvZiBuIHVuc29ydGVkIGl0ZW1zLCB3aXRoIGdyb3VwcyBzb3J0ZWQgYmV0d2VlbiBlYWNoIG90aGVyO1xuLy8gY29tYmluZXMgc2VsZWN0aW9uIGFsZ29yaXRobSB3aXRoIGJpbmFyeSBkaXZpZGUgJiBjb25xdWVyIGFwcHJvYWNoXG5cbmZ1bmN0aW9uIG11bHRpU2VsZWN0KGFyciwgbGVmdCwgcmlnaHQsIG4sIGNvbXBhcmUpIHtcbiAgICB2YXIgc3RhY2sgPSBbbGVmdCwgcmlnaHRdLFxuICAgICAgICBtaWQ7XG5cbiAgICB3aGlsZSAoc3RhY2subGVuZ3RoKSB7XG4gICAgICAgIHJpZ2h0ID0gc3RhY2sucG9wKCk7XG4gICAgICAgIGxlZnQgPSBzdGFjay5wb3AoKTtcblxuICAgICAgICBpZiAocmlnaHQgLSBsZWZ0IDw9IG4pIGNvbnRpbnVlO1xuXG4gICAgICAgIG1pZCA9IGxlZnQgKyBNYXRoLmNlaWwoKHJpZ2h0IC0gbGVmdCkgLyBuIC8gMikgKiBuO1xuICAgICAgICBzZWxlY3QoYXJyLCBsZWZ0LCByaWdodCwgbWlkLCBjb21wYXJlKTtcblxuICAgICAgICBzdGFjay5wdXNoKGxlZnQsIG1pZCwgbWlkLCByaWdodCk7XG4gICAgfVxufVxuXG4vLyBGbG95ZC1SaXZlc3Qgc2VsZWN0aW9uIGFsZ29yaXRobTpcbi8vIHNvcnQgYW4gYXJyYXkgYmV0d2VlbiBsZWZ0IGFuZCByaWdodCAoaW5jbHVzaXZlKSBzbyB0aGF0IHRoZSBzbWFsbGVzdCBrIGVsZW1lbnRzIGNvbWUgZmlyc3QgKHVub3JkZXJlZClcbmZ1bmN0aW9uIHNlbGVjdChhcnIsIGxlZnQsIHJpZ2h0LCBrLCBjb21wYXJlKSB7XG4gICAgdmFyIG4sIGksIHosIHMsIHNkLCBuZXdMZWZ0LCBuZXdSaWdodCwgdCwgajtcblxuICAgIHdoaWxlIChyaWdodCA+IGxlZnQpIHtcbiAgICAgICAgaWYgKHJpZ2h0IC0gbGVmdCA+IDYwMCkge1xuICAgICAgICAgICAgbiA9IHJpZ2h0IC0gbGVmdCArIDE7XG4gICAgICAgICAgICBpID0gayAtIGxlZnQgKyAxO1xuICAgICAgICAgICAgeiA9IE1hdGgubG9nKG4pO1xuICAgICAgICAgICAgcyA9IDAuNSAqIE1hdGguZXhwKDIgKiB6IC8gMyk7XG4gICAgICAgICAgICBzZCA9IDAuNSAqIE1hdGguc3FydCh6ICogcyAqIChuIC0gcykgLyBuKSAqIChpIC0gbiAvIDIgPCAwID8gLTEgOiAxKTtcbiAgICAgICAgICAgIG5ld0xlZnQgPSBNYXRoLm1heChsZWZ0LCBNYXRoLmZsb29yKGsgLSBpICogcyAvIG4gKyBzZCkpO1xuICAgICAgICAgICAgbmV3UmlnaHQgPSBNYXRoLm1pbihyaWdodCwgTWF0aC5mbG9vcihrICsgKG4gLSBpKSAqIHMgLyBuICsgc2QpKTtcbiAgICAgICAgICAgIHNlbGVjdChhcnIsIG5ld0xlZnQsIG5ld1JpZ2h0LCBrLCBjb21wYXJlKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHQgPSBhcnJba107XG4gICAgICAgIGkgPSBsZWZ0O1xuICAgICAgICBqID0gcmlnaHQ7XG5cbiAgICAgICAgc3dhcChhcnIsIGxlZnQsIGspO1xuICAgICAgICBpZiAoY29tcGFyZShhcnJbcmlnaHRdLCB0KSA+IDApIHN3YXAoYXJyLCBsZWZ0LCByaWdodCk7XG5cbiAgICAgICAgd2hpbGUgKGkgPCBqKSB7XG4gICAgICAgICAgICBzd2FwKGFyciwgaSwgaik7XG4gICAgICAgICAgICBpKys7XG4gICAgICAgICAgICBqLS07XG4gICAgICAgICAgICB3aGlsZSAoY29tcGFyZShhcnJbaV0sIHQpIDwgMCkgaSsrO1xuICAgICAgICAgICAgd2hpbGUgKGNvbXBhcmUoYXJyW2pdLCB0KSA+IDApIGotLTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChjb21wYXJlKGFycltsZWZ0XSwgdCkgPT09IDApIHN3YXAoYXJyLCBsZWZ0LCBqKTtcbiAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICBqKys7XG4gICAgICAgICAgICBzd2FwKGFyciwgaiwgcmlnaHQpO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGogPD0gaykgbGVmdCA9IGogKyAxO1xuICAgICAgICBpZiAoayA8PSBqKSByaWdodCA9IGogLSAxO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gc3dhcChhcnIsIGksIGopIHtcbiAgICB2YXIgdG1wID0gYXJyW2ldO1xuICAgIGFycltpXSA9IGFycltqXTtcbiAgICBhcnJbal0gPSB0bXA7XG59XG5cblxuLy8gZXhwb3J0IGFzIEFNRC9Db21tb25KUyBtb2R1bGUgb3IgZ2xvYmFsIHZhcmlhYmxlXG5pZiAodHlwZW9mIGRlZmluZSA9PT0gJ2Z1bmN0aW9uJyAmJiBkZWZpbmUuYW1kKSBkZWZpbmUoJ3JidXNoJywgZnVuY3Rpb24oKSB7IHJldHVybiByYnVzaDsgfSk7XG5lbHNlIGlmICh0eXBlb2YgbW9kdWxlICE9PSAndW5kZWZpbmVkJykgbW9kdWxlLmV4cG9ydHMgPSByYnVzaDtcbmVsc2UgaWYgKHR5cGVvZiBzZWxmICE9PSAndW5kZWZpbmVkJykgc2VsZi5yYnVzaCA9IHJidXNoO1xuZWxzZSB3aW5kb3cucmJ1c2ggPSByYnVzaDtcblxufSkoKTtcbiJdfQ==
