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
var STYLES=require('./Styles');
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
	function store(forceClose,e) 
	{
		var feat;
		if (!GUI.getTrackLayer().getSource().getFeatures().length) {
			if (e && e.feature) {
				feat=e.feature;    
			} else {
				return null;
			}
		} else {
			feat = GUI.getTrackLayer().getSource().getFeatures()[0];
		}
		var trackData=feat.getGeometry().getCoordinates();
		if (forceClose) 
		{
			if (trackData[0][0] != trackData[trackData.length-1][0] || trackData[0][1] != trackData[trackData.length-1][1]) {
				trackData.push(trackData[0]);
				feat.getGeometry().setCoordinates(trackData);
			}
		}
		for (var i=0;i<trackData.length;i++)
			trackData[i]=ol.proj.transform(trackData[i], 'EPSG:3857','EPSG:4326');			
		$("#route_text_area").val(JSON.stringify(trackData));

		TRACK.setRoute(trackData);
		TRACK.updateFeature();
		GUI.trackLayer.getSource().clear();
		GUI.addTrackFeature();
		
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
		store(false,e);
		// POST CLEANUP OF DOBLE FEATURE (on draw submit)
		setTimeout(function() 
		{
			var feats = GUI.trackLayer.getSource().getFeatures();
			var todel=[];
			for (var i in feats) {
				var feat = feats[i];
				if (!feat.track) {
					todel.push(feat);
				}
			}
			for (var i in todel) {
				var feat = todel[i];
				GUI.trackLayer.getSource().removeFeature(feat);
			}
		},0);
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
		GUI.getTrackLayer().getSource().clear()
		delete TRACK.feature;
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
	var trackData;
	try {
		trackData = JSON.parse(json);
	} catch (e) {
		console.log("Unable to do mapEdit for "+json);
		trackData=[];
	}		
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
	GUI.onEditSave = function(data) {
		$("#map").css("display","none");
		onSubmit(data);
	};
}

$(document).ready( function () 
{
	$(".button-assignments").click(function() {
		window.open("assignment.html", '_blank');
	});
	$(".button-status").click(function() {
		window.open("status.html", '_blank');
	});
	$(".button-gpx").click(function() {
		window.open("gpx.html", '_blank');
	});
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

	window.EDITOR3 = new $.fn.dataTable.Editor( {
		ajax: '../events',
		table: "#table-events",
		idSrc: "id",
		fields: [{
					label: "Code",
					name: "code"
				 },{
					label: "Start",
					name: "startTime"
				}, {
					label: "End",
					name: "endTime"
				}, {
					label: "Track",
					name: "track"
				}, {
					label: "Bike start km",
					name: "bikeStartKM"
				}, {
					label: "Run start km",
					name: "runStartKM"
				},{
					label: "Id",
					name: "id",
					type : "readonly"
				}]
	});

	
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
			{ data: "birthDate",className : "dt-body-right" }
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
	
	var tableEvents = $('#table-events').DataTable( {
		dom: "Tfrtip",
		ajax: "../events",
		columns: [
			{ data: "code" },
			{ data: "startTime" },
			{ data: "endTime" },
			{ 
				// track
				data: null,
				render: function ( data, type, row ) 
				{
					if (!data["track"])
						return "";
					var tpos = null;
					try {
						tpos=JSON.parse(data["track"]);
					} catch(e) {
					}
					var res;
					if (!tpos || !tpos.length)
						res="0 km";
					else {
						var tr = new Track();
						tr.setRoute(tpos);
						res = formatNumber2(tr.getTrackLength()/1000.0)+" km";
					}
					if (data["run-count"] && parseInt(data["run-count"]) > 1)
						res="<b>"+data["run-count"]+"x</b> "+res;
					if (data["begin-time"] && data["end-time"])
						res=data["begin-time"]+"-"+data["end-time"]+" ("+res+")";
					return res;
				} 
			},
			{ data: "bikeStartKM",className : "dt-body-right" },
			{ data: "runStartKM",className : "dt-body-right" }
		],
		tableTools: {
			sRowSelect: "os",
			aButtons: [
			    { sExtends: "editor_create", editor : EDITOR3 },
				{ sExtends: "editor_edit",   fnClick : function () {
					EDITOR3
		            .title( 'Edit event configuration' )
		            .buttons( [
                               { label: 'Save', fn: function() { this.submit(); } },
                               { label: 'Map', fn: function() {
                            	   var dt = tableEvents.rows(".selected").data()[0];
                            	   var that=this;
                            	   mapEdit(dt.id,$("#DTE_Field_track").val(),$("#DTE_Field_bikeStartKM").val(),$("#DTE_Field_runStartKM").val(),function(data) {
                            		   $("#DTE_Field_track").val(data);
                            	   });
                                } },
                                { label: 'Starts', fn: function() {
                                	var eid = $("#DTE_Field_id").val();
                                	if (!eid || !eid.length) {
                                		alert("Only on saved event possible!");
                                		return;
                                	}
                                	 var win = window.open("starts.html?id="+eid+"&title="+encodeURIComponent($("#DTE_Field_code").val()+" "+$("#DTE_Field_startTime").val()+" > "+$("#DTE_Field_endTime").val()), '_blank');
                                	 win.focus();
                                } }
                             ] )
		                    .edit( tableEvents.row( '.selected' ).node() );
				     } 
				},
				{ sExtends: "editor_remove", editor: EDITOR3 }
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

},{"./Config":7,"./GUI":8,"./Participant":10,"./Styles":12,"./Track":13,"./Utils":14}],7:[function(require,module,exports){
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
		gpsInaccuracy : 150,						 //TODO 13 min ? 
		speedAndAccelerationAverageDegree : 2,	// calculation based on N states (average) (MIN 2)
		displayDelay : 80,						// display delay in SECONDS
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
		
		setSelectedParticipant1 : function(part,center) {
			// TODO Rumen - merge setSelectedParticipant1 and setSelectedParticipant2 in only one method
			// TODO Rumen - and use only it - probably merge them together also with setSelectedParticipant
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
},{"./Utils":14,"joose":15}],10:[function(require,module,exports){
require('joose');
require('./Point');

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
			var state = new ParticipantState({timestamp:1/* placeholder ctime not 0 */,gps:pos,isSOS:false,freq:0,speed:0,elapsed:0});
			this.setElapsed(state.elapsed);
			this.setStates([state]);
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
					//console.log("MIN FOR "+proName+" | "+res+" | "+JSON.stringify(this.states[i]));
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
				console.log(this.getCode()+" | "+Math.round(state.elapsed*100.0*100.0)/100.0+"% PONG ["+pos[0]+","+pos[1]+"] "+new Date(state.timestamp)+" | "+state.debugInfo);

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
			//console.log("!!! FOUND "+result.length+" | "+this.track.route.length+" | "+rr);
			//----------------------------------------------
			var debugInfo={};
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
						if (el1 < lelp)
							continue; 				// SKIP < LELP
						if (minf == null || el1 < minf) {
							if (debugInfo) {
								debugInfo.best=i;
								debugInfo.point=[res[q].x,res[q].y];
								debugInfo.value=el1;
							}
							minf=el1;
						}
						//console.log("Intersection candidate at "+i+" | "+Math.round(el1*100.0*100.0)/100.0);
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
			/*if (minf == null)
				console.error("MINF NULL");
			else
				console.log(">> MINF "+Math.round(minf*100.0*100.0)/100.0);*/
			if (debugInfo)
				state.debugInfo=debugInfo;
			//console.log("STATTTTTTEEEEE : "+JSON.stringify(state));
			if (minf == null) {
				state.setElapsed(lelp);
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

},{"./Config":7,"./Point":11,"./Utils":14,"joose":15,"kld-intersections":16}],11:[function(require,module,exports){
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
},{"./Config":7,"./Participant":10,"./Utils":14,"joose":15,"rbush":26}],14:[function(require,module,exports){
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
// expose module classes

exports.Intersection = require('./lib/Intersection');
exports.IntersectionParams = require('./lib/IntersectionParams');

// expose affine module classes
exports.Point2D = require('kld-affine').Point2D;

},{"./lib/Intersection":17,"./lib/IntersectionParams":18,"kld-affine":19}],17:[function(require,module,exports){
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

},{"kld-affine":19,"kld-polynomial":23}],18:[function(require,module,exports){
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
},{}],19:[function(require,module,exports){
// expose classes

exports.Point2D = require('./lib/Point2D');
exports.Vector2D = require('./lib/Vector2D');
exports.Matrix2D = require('./lib/Matrix2D');

},{"./lib/Matrix2D":20,"./lib/Point2D":21,"./lib/Vector2D":22}],20:[function(require,module,exports){
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
},{}],21:[function(require,module,exports){
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

},{}],22:[function(require,module,exports){
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

},{}],23:[function(require,module,exports){
// expose classes

exports.Polynomial = require('./lib/Polynomial');
exports.SqrtPolynomial = require('./lib/SqrtPolynomial');

},{"./lib/Polynomial":24,"./lib/SqrtPolynomial":25}],24:[function(require,module,exports){
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

},{}],25:[function(require,module,exports){
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

},{"./Polynomial":24}],26:[function(require,module,exports){
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
//# sourceMappingURL=data:application/json;charset:utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL0FwcERhdGEvUm9hbWluZy9ucG0vbm9kZV9tb2R1bGVzL2Jyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2Jyb3dzZXItcGFjay9fcHJlbHVkZS5qcyIsIi4uLy4uL0FwcERhdGEvUm9hbWluZy9ucG0vbm9kZV9tb2R1bGVzL2Jyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2J1ZmZlci9pbmRleC5qcyIsIi4uLy4uL0FwcERhdGEvUm9hbWluZy9ucG0vbm9kZV9tb2R1bGVzL2Jyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2J1ZmZlci9ub2RlX21vZHVsZXMvYmFzZTY0LWpzL2xpYi9iNjQuanMiLCIuLi8uLi9BcHBEYXRhL1JvYW1pbmcvbnBtL25vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9idWZmZXIvbm9kZV9tb2R1bGVzL2llZWU3NTQvaW5kZXguanMiLCIuLi8uLi9BcHBEYXRhL1JvYW1pbmcvbnBtL25vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9idWZmZXIvbm9kZV9tb2R1bGVzL2lzLWFycmF5L2luZGV4LmpzIiwiLi4vLi4vQXBwRGF0YS9Sb2FtaW5nL25wbS9ub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvcHJvY2Vzcy9icm93c2VyLmpzIiwianMvYXBwL0FkbWluLmpzIiwianMvYXBwL0NvbmZpZy5qcyIsImpzL2FwcC9HVUkuanMiLCJqcy9hcHAvTGl2ZVN0cmVhbS5qcyIsImpzL2FwcC9QYXJ0aWNpcGFudC5qcyIsImpzL2FwcC9Qb2ludC5qcyIsImpzL2FwcC9TdHlsZXMuanMiLCJqcy9hcHAvVHJhY2suanMiLCJqcy9hcHAvVXRpbHMuanMiLCJub2RlX21vZHVsZXMvam9vc2Uvam9vc2UtYWxsLmpzIiwibm9kZV9tb2R1bGVzL2tsZC1pbnRlcnNlY3Rpb25zL2luZGV4LmpzIiwibm9kZV9tb2R1bGVzL2tsZC1pbnRlcnNlY3Rpb25zL2xpYi9JbnRlcnNlY3Rpb24uanMiLCJub2RlX21vZHVsZXMva2xkLWludGVyc2VjdGlvbnMvbGliL0ludGVyc2VjdGlvblBhcmFtcy5qcyIsIm5vZGVfbW9kdWxlcy9rbGQtaW50ZXJzZWN0aW9ucy9ub2RlX21vZHVsZXMva2xkLWFmZmluZS9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9rbGQtaW50ZXJzZWN0aW9ucy9ub2RlX21vZHVsZXMva2xkLWFmZmluZS9saWIvTWF0cml4MkQuanMiLCJub2RlX21vZHVsZXMva2xkLWludGVyc2VjdGlvbnMvbm9kZV9tb2R1bGVzL2tsZC1hZmZpbmUvbGliL1BvaW50MkQuanMiLCJub2RlX21vZHVsZXMva2xkLWludGVyc2VjdGlvbnMvbm9kZV9tb2R1bGVzL2tsZC1hZmZpbmUvbGliL1ZlY3RvcjJELmpzIiwibm9kZV9tb2R1bGVzL2tsZC1pbnRlcnNlY3Rpb25zL25vZGVfbW9kdWxlcy9rbGQtcG9seW5vbWlhbC9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9rbGQtaW50ZXJzZWN0aW9ucy9ub2RlX21vZHVsZXMva2xkLXBvbHlub21pYWwvbGliL1BvbHlub21pYWwuanMiLCJub2RlX21vZHVsZXMva2xkLWludGVyc2VjdGlvbnMvbm9kZV9tb2R1bGVzL2tsZC1wb2x5bm9taWFsL2xpYi9TcXJ0UG9seW5vbWlhbC5qcyIsIm5vZGVfbW9kdWxlcy9yYnVzaC9yYnVzaC5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTtBQ0FBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzc1Q0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM1SEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDcEZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2pDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMxRkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN4WEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BIQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN2akJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDL0hBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMxeEJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3ZDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzVpQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7O0FDNVpBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7Ozs7O0FDOWpCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7O0FDanBHQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1BBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbHVEQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDaENBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNMQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3hhQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQy9LQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMxT0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNKQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN0bkJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzVEQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSIsImZpbGUiOiJnZW5lcmF0ZWQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlc0NvbnRlbnQiOlsiKGZ1bmN0aW9uIGUodCxuLHIpe2Z1bmN0aW9uIHMobyx1KXtpZighbltvXSl7aWYoIXRbb10pe3ZhciBhPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7aWYoIXUmJmEpcmV0dXJuIGEobywhMCk7aWYoaSlyZXR1cm4gaShvLCEwKTt2YXIgZj1uZXcgRXJyb3IoXCJDYW5ub3QgZmluZCBtb2R1bGUgJ1wiK28rXCInXCIpO3Rocm93IGYuY29kZT1cIk1PRFVMRV9OT1RfRk9VTkRcIixmfXZhciBsPW5bb109e2V4cG9ydHM6e319O3Rbb11bMF0uY2FsbChsLmV4cG9ydHMsZnVuY3Rpb24oZSl7dmFyIG49dFtvXVsxXVtlXTtyZXR1cm4gcyhuP246ZSl9LGwsbC5leHBvcnRzLGUsdCxuLHIpfXJldHVybiBuW29dLmV4cG9ydHN9dmFyIGk9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtmb3IodmFyIG89MDtvPHIubGVuZ3RoO28rKylzKHJbb10pO3JldHVybiBzfSkiLCIvKiFcbiAqIFRoZSBidWZmZXIgbW9kdWxlIGZyb20gbm9kZS5qcywgZm9yIHRoZSBicm93c2VyLlxuICpcbiAqIEBhdXRob3IgICBGZXJvc3MgQWJvdWtoYWRpamVoIDxmZXJvc3NAZmVyb3NzLm9yZz4gPGh0dHA6Ly9mZXJvc3Mub3JnPlxuICogQGxpY2Vuc2UgIE1JVFxuICovXG5cbnZhciBiYXNlNjQgPSByZXF1aXJlKCdiYXNlNjQtanMnKVxudmFyIGllZWU3NTQgPSByZXF1aXJlKCdpZWVlNzU0JylcbnZhciBpc0FycmF5ID0gcmVxdWlyZSgnaXMtYXJyYXknKVxuXG5leHBvcnRzLkJ1ZmZlciA9IEJ1ZmZlclxuZXhwb3J0cy5TbG93QnVmZmVyID0gU2xvd0J1ZmZlclxuZXhwb3J0cy5JTlNQRUNUX01BWF9CWVRFUyA9IDUwXG5CdWZmZXIucG9vbFNpemUgPSA4MTkyIC8vIG5vdCB1c2VkIGJ5IHRoaXMgaW1wbGVtZW50YXRpb25cblxudmFyIHJvb3RQYXJlbnQgPSB7fVxuXG4vKipcbiAqIElmIGBCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVGA6XG4gKiAgID09PSB0cnVlICAgIFVzZSBVaW50OEFycmF5IGltcGxlbWVudGF0aW9uIChmYXN0ZXN0KVxuICogICA9PT0gZmFsc2UgICBVc2UgT2JqZWN0IGltcGxlbWVudGF0aW9uIChtb3N0IGNvbXBhdGlibGUsIGV2ZW4gSUU2KVxuICpcbiAqIEJyb3dzZXJzIHRoYXQgc3VwcG9ydCB0eXBlZCBhcnJheXMgYXJlIElFIDEwKywgRmlyZWZveCA0KywgQ2hyb21lIDcrLCBTYWZhcmkgNS4xKyxcbiAqIE9wZXJhIDExLjYrLCBpT1MgNC4yKy5cbiAqXG4gKiBOb3RlOlxuICpcbiAqIC0gSW1wbGVtZW50YXRpb24gbXVzdCBzdXBwb3J0IGFkZGluZyBuZXcgcHJvcGVydGllcyB0byBgVWludDhBcnJheWAgaW5zdGFuY2VzLlxuICogICBGaXJlZm94IDQtMjkgbGFja2VkIHN1cHBvcnQsIGZpeGVkIGluIEZpcmVmb3ggMzArLlxuICogICBTZWU6IGh0dHBzOi8vYnVnemlsbGEubW96aWxsYS5vcmcvc2hvd19idWcuY2dpP2lkPTY5NTQzOC5cbiAqXG4gKiAgLSBDaHJvbWUgOS0xMCBpcyBtaXNzaW5nIHRoZSBgVHlwZWRBcnJheS5wcm90b3R5cGUuc3ViYXJyYXlgIGZ1bmN0aW9uLlxuICpcbiAqICAtIElFMTAgaGFzIGEgYnJva2VuIGBUeXBlZEFycmF5LnByb3RvdHlwZS5zdWJhcnJheWAgZnVuY3Rpb24gd2hpY2ggcmV0dXJucyBhcnJheXMgb2ZcbiAqICAgIGluY29ycmVjdCBsZW5ndGggaW4gc29tZSBzaXR1YXRpb25zLlxuICpcbiAqIFdlIGRldGVjdCB0aGVzZSBidWdneSBicm93c2VycyBhbmQgc2V0IGBCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVGAgdG8gYGZhbHNlYCBzbyB0aGV5IHdpbGxcbiAqIGdldCB0aGUgT2JqZWN0IGltcGxlbWVudGF0aW9uLCB3aGljaCBpcyBzbG93ZXIgYnV0IHdpbGwgd29yayBjb3JyZWN0bHkuXG4gKi9cbkJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUID0gKGZ1bmN0aW9uICgpIHtcbiAgZnVuY3Rpb24gRm9vICgpIHt9XG4gIHRyeSB7XG4gICAgdmFyIGJ1ZiA9IG5ldyBBcnJheUJ1ZmZlcigwKVxuICAgIHZhciBhcnIgPSBuZXcgVWludDhBcnJheShidWYpXG4gICAgYXJyLmZvbyA9IGZ1bmN0aW9uICgpIHsgcmV0dXJuIDQyIH1cbiAgICBhcnIuY29uc3RydWN0b3IgPSBGb29cbiAgICByZXR1cm4gYXJyLmZvbygpID09PSA0MiAmJiAvLyB0eXBlZCBhcnJheSBpbnN0YW5jZXMgY2FuIGJlIGF1Z21lbnRlZFxuICAgICAgICBhcnIuY29uc3RydWN0b3IgPT09IEZvbyAmJiAvLyBjb25zdHJ1Y3RvciBjYW4gYmUgc2V0XG4gICAgICAgIHR5cGVvZiBhcnIuc3ViYXJyYXkgPT09ICdmdW5jdGlvbicgJiYgLy8gY2hyb21lIDktMTAgbGFjayBgc3ViYXJyYXlgXG4gICAgICAgIG5ldyBVaW50OEFycmF5KDEpLnN1YmFycmF5KDEsIDEpLmJ5dGVMZW5ndGggPT09IDAgLy8gaWUxMCBoYXMgYnJva2VuIGBzdWJhcnJheWBcbiAgfSBjYXRjaCAoZSkge1xuICAgIHJldHVybiBmYWxzZVxuICB9XG59KSgpXG5cbmZ1bmN0aW9uIGtNYXhMZW5ndGggKCkge1xuICByZXR1cm4gQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlRcbiAgICA/IDB4N2ZmZmZmZmZcbiAgICA6IDB4M2ZmZmZmZmZcbn1cblxuLyoqXG4gKiBDbGFzczogQnVmZmVyXG4gKiA9PT09PT09PT09PT09XG4gKlxuICogVGhlIEJ1ZmZlciBjb25zdHJ1Y3RvciByZXR1cm5zIGluc3RhbmNlcyBvZiBgVWludDhBcnJheWAgdGhhdCBhcmUgYXVnbWVudGVkXG4gKiB3aXRoIGZ1bmN0aW9uIHByb3BlcnRpZXMgZm9yIGFsbCB0aGUgbm9kZSBgQnVmZmVyYCBBUEkgZnVuY3Rpb25zLiBXZSB1c2VcbiAqIGBVaW50OEFycmF5YCBzbyB0aGF0IHNxdWFyZSBicmFja2V0IG5vdGF0aW9uIHdvcmtzIGFzIGV4cGVjdGVkIC0tIGl0IHJldHVybnNcbiAqIGEgc2luZ2xlIG9jdGV0LlxuICpcbiAqIEJ5IGF1Z21lbnRpbmcgdGhlIGluc3RhbmNlcywgd2UgY2FuIGF2b2lkIG1vZGlmeWluZyB0aGUgYFVpbnQ4QXJyYXlgXG4gKiBwcm90b3R5cGUuXG4gKi9cbmZ1bmN0aW9uIEJ1ZmZlciAoYXJnKSB7XG4gIGlmICghKHRoaXMgaW5zdGFuY2VvZiBCdWZmZXIpKSB7XG4gICAgLy8gQXZvaWQgZ29pbmcgdGhyb3VnaCBhbiBBcmd1bWVudHNBZGFwdG9yVHJhbXBvbGluZSBpbiB0aGUgY29tbW9uIGNhc2UuXG4gICAgaWYgKGFyZ3VtZW50cy5sZW5ndGggPiAxKSByZXR1cm4gbmV3IEJ1ZmZlcihhcmcsIGFyZ3VtZW50c1sxXSlcbiAgICByZXR1cm4gbmV3IEJ1ZmZlcihhcmcpXG4gIH1cblxuICB0aGlzLmxlbmd0aCA9IDBcbiAgdGhpcy5wYXJlbnQgPSB1bmRlZmluZWRcblxuICAvLyBDb21tb24gY2FzZS5cbiAgaWYgKHR5cGVvZiBhcmcgPT09ICdudW1iZXInKSB7XG4gICAgcmV0dXJuIGZyb21OdW1iZXIodGhpcywgYXJnKVxuICB9XG5cbiAgLy8gU2xpZ2h0bHkgbGVzcyBjb21tb24gY2FzZS5cbiAgaWYgKHR5cGVvZiBhcmcgPT09ICdzdHJpbmcnKSB7XG4gICAgcmV0dXJuIGZyb21TdHJpbmcodGhpcywgYXJnLCBhcmd1bWVudHMubGVuZ3RoID4gMSA/IGFyZ3VtZW50c1sxXSA6ICd1dGY4JylcbiAgfVxuXG4gIC8vIFVudXN1YWwuXG4gIHJldHVybiBmcm9tT2JqZWN0KHRoaXMsIGFyZylcbn1cblxuZnVuY3Rpb24gZnJvbU51bWJlciAodGhhdCwgbGVuZ3RoKSB7XG4gIHRoYXQgPSBhbGxvY2F0ZSh0aGF0LCBsZW5ndGggPCAwID8gMCA6IGNoZWNrZWQobGVuZ3RoKSB8IDApXG4gIGlmICghQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbmd0aDsgaSsrKSB7XG4gICAgICB0aGF0W2ldID0gMFxuICAgIH1cbiAgfVxuICByZXR1cm4gdGhhdFxufVxuXG5mdW5jdGlvbiBmcm9tU3RyaW5nICh0aGF0LCBzdHJpbmcsIGVuY29kaW5nKSB7XG4gIGlmICh0eXBlb2YgZW5jb2RpbmcgIT09ICdzdHJpbmcnIHx8IGVuY29kaW5nID09PSAnJykgZW5jb2RpbmcgPSAndXRmOCdcblxuICAvLyBBc3N1bXB0aW9uOiBieXRlTGVuZ3RoKCkgcmV0dXJuIHZhbHVlIGlzIGFsd2F5cyA8IGtNYXhMZW5ndGguXG4gIHZhciBsZW5ndGggPSBieXRlTGVuZ3RoKHN0cmluZywgZW5jb2RpbmcpIHwgMFxuICB0aGF0ID0gYWxsb2NhdGUodGhhdCwgbGVuZ3RoKVxuXG4gIHRoYXQud3JpdGUoc3RyaW5nLCBlbmNvZGluZylcbiAgcmV0dXJuIHRoYXRcbn1cblxuZnVuY3Rpb24gZnJvbU9iamVjdCAodGhhdCwgb2JqZWN0KSB7XG4gIGlmIChCdWZmZXIuaXNCdWZmZXIob2JqZWN0KSkgcmV0dXJuIGZyb21CdWZmZXIodGhhdCwgb2JqZWN0KVxuXG4gIGlmIChpc0FycmF5KG9iamVjdCkpIHJldHVybiBmcm9tQXJyYXkodGhhdCwgb2JqZWN0KVxuXG4gIGlmIChvYmplY3QgPT0gbnVsbCkge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ211c3Qgc3RhcnQgd2l0aCBudW1iZXIsIGJ1ZmZlciwgYXJyYXkgb3Igc3RyaW5nJylcbiAgfVxuXG4gIGlmICh0eXBlb2YgQXJyYXlCdWZmZXIgIT09ICd1bmRlZmluZWQnICYmIG9iamVjdC5idWZmZXIgaW5zdGFuY2VvZiBBcnJheUJ1ZmZlcikge1xuICAgIHJldHVybiBmcm9tVHlwZWRBcnJheSh0aGF0LCBvYmplY3QpXG4gIH1cblxuICBpZiAob2JqZWN0Lmxlbmd0aCkgcmV0dXJuIGZyb21BcnJheUxpa2UodGhhdCwgb2JqZWN0KVxuXG4gIHJldHVybiBmcm9tSnNvbk9iamVjdCh0aGF0LCBvYmplY3QpXG59XG5cbmZ1bmN0aW9uIGZyb21CdWZmZXIgKHRoYXQsIGJ1ZmZlcikge1xuICB2YXIgbGVuZ3RoID0gY2hlY2tlZChidWZmZXIubGVuZ3RoKSB8IDBcbiAgdGhhdCA9IGFsbG9jYXRlKHRoYXQsIGxlbmd0aClcbiAgYnVmZmVyLmNvcHkodGhhdCwgMCwgMCwgbGVuZ3RoKVxuICByZXR1cm4gdGhhdFxufVxuXG5mdW5jdGlvbiBmcm9tQXJyYXkgKHRoYXQsIGFycmF5KSB7XG4gIHZhciBsZW5ndGggPSBjaGVja2VkKGFycmF5Lmxlbmd0aCkgfCAwXG4gIHRoYXQgPSBhbGxvY2F0ZSh0aGF0LCBsZW5ndGgpXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuZ3RoOyBpICs9IDEpIHtcbiAgICB0aGF0W2ldID0gYXJyYXlbaV0gJiAyNTVcbiAgfVxuICByZXR1cm4gdGhhdFxufVxuXG4vLyBEdXBsaWNhdGUgb2YgZnJvbUFycmF5KCkgdG8ga2VlcCBmcm9tQXJyYXkoKSBtb25vbW9ycGhpYy5cbmZ1bmN0aW9uIGZyb21UeXBlZEFycmF5ICh0aGF0LCBhcnJheSkge1xuICB2YXIgbGVuZ3RoID0gY2hlY2tlZChhcnJheS5sZW5ndGgpIHwgMFxuICB0aGF0ID0gYWxsb2NhdGUodGhhdCwgbGVuZ3RoKVxuICAvLyBUcnVuY2F0aW5nIHRoZSBlbGVtZW50cyBpcyBwcm9iYWJseSBub3Qgd2hhdCBwZW9wbGUgZXhwZWN0IGZyb20gdHlwZWRcbiAgLy8gYXJyYXlzIHdpdGggQllURVNfUEVSX0VMRU1FTlQgPiAxIGJ1dCBpdCdzIGNvbXBhdGlibGUgd2l0aCB0aGUgYmVoYXZpb3JcbiAgLy8gb2YgdGhlIG9sZCBCdWZmZXIgY29uc3RydWN0b3IuXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuZ3RoOyBpICs9IDEpIHtcbiAgICB0aGF0W2ldID0gYXJyYXlbaV0gJiAyNTVcbiAgfVxuICByZXR1cm4gdGhhdFxufVxuXG5mdW5jdGlvbiBmcm9tQXJyYXlMaWtlICh0aGF0LCBhcnJheSkge1xuICB2YXIgbGVuZ3RoID0gY2hlY2tlZChhcnJheS5sZW5ndGgpIHwgMFxuICB0aGF0ID0gYWxsb2NhdGUodGhhdCwgbGVuZ3RoKVxuICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbmd0aDsgaSArPSAxKSB7XG4gICAgdGhhdFtpXSA9IGFycmF5W2ldICYgMjU1XG4gIH1cbiAgcmV0dXJuIHRoYXRcbn1cblxuLy8gRGVzZXJpYWxpemUgeyB0eXBlOiAnQnVmZmVyJywgZGF0YTogWzEsMiwzLC4uLl0gfSBpbnRvIGEgQnVmZmVyIG9iamVjdC5cbi8vIFJldHVybnMgYSB6ZXJvLWxlbmd0aCBidWZmZXIgZm9yIGlucHV0cyB0aGF0IGRvbid0IGNvbmZvcm0gdG8gdGhlIHNwZWMuXG5mdW5jdGlvbiBmcm9tSnNvbk9iamVjdCAodGhhdCwgb2JqZWN0KSB7XG4gIHZhciBhcnJheVxuICB2YXIgbGVuZ3RoID0gMFxuXG4gIGlmIChvYmplY3QudHlwZSA9PT0gJ0J1ZmZlcicgJiYgaXNBcnJheShvYmplY3QuZGF0YSkpIHtcbiAgICBhcnJheSA9IG9iamVjdC5kYXRhXG4gICAgbGVuZ3RoID0gY2hlY2tlZChhcnJheS5sZW5ndGgpIHwgMFxuICB9XG4gIHRoYXQgPSBhbGxvY2F0ZSh0aGF0LCBsZW5ndGgpXG5cbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW5ndGg7IGkgKz0gMSkge1xuICAgIHRoYXRbaV0gPSBhcnJheVtpXSAmIDI1NVxuICB9XG4gIHJldHVybiB0aGF0XG59XG5cbmZ1bmN0aW9uIGFsbG9jYXRlICh0aGF0LCBsZW5ndGgpIHtcbiAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgLy8gUmV0dXJuIGFuIGF1Z21lbnRlZCBgVWludDhBcnJheWAgaW5zdGFuY2UsIGZvciBiZXN0IHBlcmZvcm1hbmNlXG4gICAgdGhhdCA9IEJ1ZmZlci5fYXVnbWVudChuZXcgVWludDhBcnJheShsZW5ndGgpKVxuICB9IGVsc2Uge1xuICAgIC8vIEZhbGxiYWNrOiBSZXR1cm4gYW4gb2JqZWN0IGluc3RhbmNlIG9mIHRoZSBCdWZmZXIgY2xhc3NcbiAgICB0aGF0Lmxlbmd0aCA9IGxlbmd0aFxuICAgIHRoYXQuX2lzQnVmZmVyID0gdHJ1ZVxuICB9XG5cbiAgdmFyIGZyb21Qb29sID0gbGVuZ3RoICE9PSAwICYmIGxlbmd0aCA8PSBCdWZmZXIucG9vbFNpemUgPj4+IDFcbiAgaWYgKGZyb21Qb29sKSB0aGF0LnBhcmVudCA9IHJvb3RQYXJlbnRcblxuICByZXR1cm4gdGhhdFxufVxuXG5mdW5jdGlvbiBjaGVja2VkIChsZW5ndGgpIHtcbiAgLy8gTm90ZTogY2Fubm90IHVzZSBgbGVuZ3RoIDwga01heExlbmd0aGAgaGVyZSBiZWNhdXNlIHRoYXQgZmFpbHMgd2hlblxuICAvLyBsZW5ndGggaXMgTmFOICh3aGljaCBpcyBvdGhlcndpc2UgY29lcmNlZCB0byB6ZXJvLilcbiAgaWYgKGxlbmd0aCA+PSBrTWF4TGVuZ3RoKCkpIHtcbiAgICB0aHJvdyBuZXcgUmFuZ2VFcnJvcignQXR0ZW1wdCB0byBhbGxvY2F0ZSBCdWZmZXIgbGFyZ2VyIHRoYW4gbWF4aW11bSAnICtcbiAgICAgICAgICAgICAgICAgICAgICAgICAnc2l6ZTogMHgnICsga01heExlbmd0aCgpLnRvU3RyaW5nKDE2KSArICcgYnl0ZXMnKVxuICB9XG4gIHJldHVybiBsZW5ndGggfCAwXG59XG5cbmZ1bmN0aW9uIFNsb3dCdWZmZXIgKHN1YmplY3QsIGVuY29kaW5nKSB7XG4gIGlmICghKHRoaXMgaW5zdGFuY2VvZiBTbG93QnVmZmVyKSkgcmV0dXJuIG5ldyBTbG93QnVmZmVyKHN1YmplY3QsIGVuY29kaW5nKVxuXG4gIHZhciBidWYgPSBuZXcgQnVmZmVyKHN1YmplY3QsIGVuY29kaW5nKVxuICBkZWxldGUgYnVmLnBhcmVudFxuICByZXR1cm4gYnVmXG59XG5cbkJ1ZmZlci5pc0J1ZmZlciA9IGZ1bmN0aW9uIGlzQnVmZmVyIChiKSB7XG4gIHJldHVybiAhIShiICE9IG51bGwgJiYgYi5faXNCdWZmZXIpXG59XG5cbkJ1ZmZlci5jb21wYXJlID0gZnVuY3Rpb24gY29tcGFyZSAoYSwgYikge1xuICBpZiAoIUJ1ZmZlci5pc0J1ZmZlcihhKSB8fCAhQnVmZmVyLmlzQnVmZmVyKGIpKSB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcignQXJndW1lbnRzIG11c3QgYmUgQnVmZmVycycpXG4gIH1cblxuICBpZiAoYSA9PT0gYikgcmV0dXJuIDBcblxuICB2YXIgeCA9IGEubGVuZ3RoXG4gIHZhciB5ID0gYi5sZW5ndGhcblxuICB2YXIgaSA9IDBcbiAgdmFyIGxlbiA9IE1hdGgubWluKHgsIHkpXG4gIHdoaWxlIChpIDwgbGVuKSB7XG4gICAgaWYgKGFbaV0gIT09IGJbaV0pIGJyZWFrXG5cbiAgICArK2lcbiAgfVxuXG4gIGlmIChpICE9PSBsZW4pIHtcbiAgICB4ID0gYVtpXVxuICAgIHkgPSBiW2ldXG4gIH1cblxuICBpZiAoeCA8IHkpIHJldHVybiAtMVxuICBpZiAoeSA8IHgpIHJldHVybiAxXG4gIHJldHVybiAwXG59XG5cbkJ1ZmZlci5pc0VuY29kaW5nID0gZnVuY3Rpb24gaXNFbmNvZGluZyAoZW5jb2RpbmcpIHtcbiAgc3dpdGNoIChTdHJpbmcoZW5jb2RpbmcpLnRvTG93ZXJDYXNlKCkpIHtcbiAgICBjYXNlICdoZXgnOlxuICAgIGNhc2UgJ3V0ZjgnOlxuICAgIGNhc2UgJ3V0Zi04JzpcbiAgICBjYXNlICdhc2NpaSc6XG4gICAgY2FzZSAnYmluYXJ5JzpcbiAgICBjYXNlICdiYXNlNjQnOlxuICAgIGNhc2UgJ3Jhdyc6XG4gICAgY2FzZSAndWNzMic6XG4gICAgY2FzZSAndWNzLTInOlxuICAgIGNhc2UgJ3V0ZjE2bGUnOlxuICAgIGNhc2UgJ3V0Zi0xNmxlJzpcbiAgICAgIHJldHVybiB0cnVlXG4gICAgZGVmYXVsdDpcbiAgICAgIHJldHVybiBmYWxzZVxuICB9XG59XG5cbkJ1ZmZlci5jb25jYXQgPSBmdW5jdGlvbiBjb25jYXQgKGxpc3QsIGxlbmd0aCkge1xuICBpZiAoIWlzQXJyYXkobGlzdCkpIHRocm93IG5ldyBUeXBlRXJyb3IoJ2xpc3QgYXJndW1lbnQgbXVzdCBiZSBhbiBBcnJheSBvZiBCdWZmZXJzLicpXG5cbiAgaWYgKGxpc3QubGVuZ3RoID09PSAwKSB7XG4gICAgcmV0dXJuIG5ldyBCdWZmZXIoMClcbiAgfSBlbHNlIGlmIChsaXN0Lmxlbmd0aCA9PT0gMSkge1xuICAgIHJldHVybiBsaXN0WzBdXG4gIH1cblxuICB2YXIgaVxuICBpZiAobGVuZ3RoID09PSB1bmRlZmluZWQpIHtcbiAgICBsZW5ndGggPSAwXG4gICAgZm9yIChpID0gMDsgaSA8IGxpc3QubGVuZ3RoOyBpKyspIHtcbiAgICAgIGxlbmd0aCArPSBsaXN0W2ldLmxlbmd0aFxuICAgIH1cbiAgfVxuXG4gIHZhciBidWYgPSBuZXcgQnVmZmVyKGxlbmd0aClcbiAgdmFyIHBvcyA9IDBcbiAgZm9yIChpID0gMDsgaSA8IGxpc3QubGVuZ3RoOyBpKyspIHtcbiAgICB2YXIgaXRlbSA9IGxpc3RbaV1cbiAgICBpdGVtLmNvcHkoYnVmLCBwb3MpXG4gICAgcG9zICs9IGl0ZW0ubGVuZ3RoXG4gIH1cbiAgcmV0dXJuIGJ1ZlxufVxuXG5mdW5jdGlvbiBieXRlTGVuZ3RoIChzdHJpbmcsIGVuY29kaW5nKSB7XG4gIGlmICh0eXBlb2Ygc3RyaW5nICE9PSAnc3RyaW5nJykgc3RyaW5nID0gJycgKyBzdHJpbmdcblxuICB2YXIgbGVuID0gc3RyaW5nLmxlbmd0aFxuICBpZiAobGVuID09PSAwKSByZXR1cm4gMFxuXG4gIC8vIFVzZSBhIGZvciBsb29wIHRvIGF2b2lkIHJlY3Vyc2lvblxuICB2YXIgbG93ZXJlZENhc2UgPSBmYWxzZVxuICBmb3IgKDs7KSB7XG4gICAgc3dpdGNoIChlbmNvZGluZykge1xuICAgICAgY2FzZSAnYXNjaWknOlxuICAgICAgY2FzZSAnYmluYXJ5JzpcbiAgICAgIC8vIERlcHJlY2F0ZWRcbiAgICAgIGNhc2UgJ3Jhdyc6XG4gICAgICBjYXNlICdyYXdzJzpcbiAgICAgICAgcmV0dXJuIGxlblxuICAgICAgY2FzZSAndXRmOCc6XG4gICAgICBjYXNlICd1dGYtOCc6XG4gICAgICAgIHJldHVybiB1dGY4VG9CeXRlcyhzdHJpbmcpLmxlbmd0aFxuICAgICAgY2FzZSAndWNzMic6XG4gICAgICBjYXNlICd1Y3MtMic6XG4gICAgICBjYXNlICd1dGYxNmxlJzpcbiAgICAgIGNhc2UgJ3V0Zi0xNmxlJzpcbiAgICAgICAgcmV0dXJuIGxlbiAqIDJcbiAgICAgIGNhc2UgJ2hleCc6XG4gICAgICAgIHJldHVybiBsZW4gPj4+IDFcbiAgICAgIGNhc2UgJ2Jhc2U2NCc6XG4gICAgICAgIHJldHVybiBiYXNlNjRUb0J5dGVzKHN0cmluZykubGVuZ3RoXG4gICAgICBkZWZhdWx0OlxuICAgICAgICBpZiAobG93ZXJlZENhc2UpIHJldHVybiB1dGY4VG9CeXRlcyhzdHJpbmcpLmxlbmd0aCAvLyBhc3N1bWUgdXRmOFxuICAgICAgICBlbmNvZGluZyA9ICgnJyArIGVuY29kaW5nKS50b0xvd2VyQ2FzZSgpXG4gICAgICAgIGxvd2VyZWRDYXNlID0gdHJ1ZVxuICAgIH1cbiAgfVxufVxuQnVmZmVyLmJ5dGVMZW5ndGggPSBieXRlTGVuZ3RoXG5cbi8vIHByZS1zZXQgZm9yIHZhbHVlcyB0aGF0IG1heSBleGlzdCBpbiB0aGUgZnV0dXJlXG5CdWZmZXIucHJvdG90eXBlLmxlbmd0aCA9IHVuZGVmaW5lZFxuQnVmZmVyLnByb3RvdHlwZS5wYXJlbnQgPSB1bmRlZmluZWRcblxuZnVuY3Rpb24gc2xvd1RvU3RyaW5nIChlbmNvZGluZywgc3RhcnQsIGVuZCkge1xuICB2YXIgbG93ZXJlZENhc2UgPSBmYWxzZVxuXG4gIHN0YXJ0ID0gc3RhcnQgfCAwXG4gIGVuZCA9IGVuZCA9PT0gdW5kZWZpbmVkIHx8IGVuZCA9PT0gSW5maW5pdHkgPyB0aGlzLmxlbmd0aCA6IGVuZCB8IDBcblxuICBpZiAoIWVuY29kaW5nKSBlbmNvZGluZyA9ICd1dGY4J1xuICBpZiAoc3RhcnQgPCAwKSBzdGFydCA9IDBcbiAgaWYgKGVuZCA+IHRoaXMubGVuZ3RoKSBlbmQgPSB0aGlzLmxlbmd0aFxuICBpZiAoZW5kIDw9IHN0YXJ0KSByZXR1cm4gJydcblxuICB3aGlsZSAodHJ1ZSkge1xuICAgIHN3aXRjaCAoZW5jb2RpbmcpIHtcbiAgICAgIGNhc2UgJ2hleCc6XG4gICAgICAgIHJldHVybiBoZXhTbGljZSh0aGlzLCBzdGFydCwgZW5kKVxuXG4gICAgICBjYXNlICd1dGY4JzpcbiAgICAgIGNhc2UgJ3V0Zi04JzpcbiAgICAgICAgcmV0dXJuIHV0ZjhTbGljZSh0aGlzLCBzdGFydCwgZW5kKVxuXG4gICAgICBjYXNlICdhc2NpaSc6XG4gICAgICAgIHJldHVybiBhc2NpaVNsaWNlKHRoaXMsIHN0YXJ0LCBlbmQpXG5cbiAgICAgIGNhc2UgJ2JpbmFyeSc6XG4gICAgICAgIHJldHVybiBiaW5hcnlTbGljZSh0aGlzLCBzdGFydCwgZW5kKVxuXG4gICAgICBjYXNlICdiYXNlNjQnOlxuICAgICAgICByZXR1cm4gYmFzZTY0U2xpY2UodGhpcywgc3RhcnQsIGVuZClcblxuICAgICAgY2FzZSAndWNzMic6XG4gICAgICBjYXNlICd1Y3MtMic6XG4gICAgICBjYXNlICd1dGYxNmxlJzpcbiAgICAgIGNhc2UgJ3V0Zi0xNmxlJzpcbiAgICAgICAgcmV0dXJuIHV0ZjE2bGVTbGljZSh0aGlzLCBzdGFydCwgZW5kKVxuXG4gICAgICBkZWZhdWx0OlxuICAgICAgICBpZiAobG93ZXJlZENhc2UpIHRocm93IG5ldyBUeXBlRXJyb3IoJ1Vua25vd24gZW5jb2Rpbmc6ICcgKyBlbmNvZGluZylcbiAgICAgICAgZW5jb2RpbmcgPSAoZW5jb2RpbmcgKyAnJykudG9Mb3dlckNhc2UoKVxuICAgICAgICBsb3dlcmVkQ2FzZSA9IHRydWVcbiAgICB9XG4gIH1cbn1cblxuQnVmZmVyLnByb3RvdHlwZS50b1N0cmluZyA9IGZ1bmN0aW9uIHRvU3RyaW5nICgpIHtcbiAgdmFyIGxlbmd0aCA9IHRoaXMubGVuZ3RoIHwgMFxuICBpZiAobGVuZ3RoID09PSAwKSByZXR1cm4gJydcbiAgaWYgKGFyZ3VtZW50cy5sZW5ndGggPT09IDApIHJldHVybiB1dGY4U2xpY2UodGhpcywgMCwgbGVuZ3RoKVxuICByZXR1cm4gc2xvd1RvU3RyaW5nLmFwcGx5KHRoaXMsIGFyZ3VtZW50cylcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5lcXVhbHMgPSBmdW5jdGlvbiBlcXVhbHMgKGIpIHtcbiAgaWYgKCFCdWZmZXIuaXNCdWZmZXIoYikpIHRocm93IG5ldyBUeXBlRXJyb3IoJ0FyZ3VtZW50IG11c3QgYmUgYSBCdWZmZXInKVxuICBpZiAodGhpcyA9PT0gYikgcmV0dXJuIHRydWVcbiAgcmV0dXJuIEJ1ZmZlci5jb21wYXJlKHRoaXMsIGIpID09PSAwXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUuaW5zcGVjdCA9IGZ1bmN0aW9uIGluc3BlY3QgKCkge1xuICB2YXIgc3RyID0gJydcbiAgdmFyIG1heCA9IGV4cG9ydHMuSU5TUEVDVF9NQVhfQllURVNcbiAgaWYgKHRoaXMubGVuZ3RoID4gMCkge1xuICAgIHN0ciA9IHRoaXMudG9TdHJpbmcoJ2hleCcsIDAsIG1heCkubWF0Y2goLy57Mn0vZykuam9pbignICcpXG4gICAgaWYgKHRoaXMubGVuZ3RoID4gbWF4KSBzdHIgKz0gJyAuLi4gJ1xuICB9XG4gIHJldHVybiAnPEJ1ZmZlciAnICsgc3RyICsgJz4nXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUuY29tcGFyZSA9IGZ1bmN0aW9uIGNvbXBhcmUgKGIpIHtcbiAgaWYgKCFCdWZmZXIuaXNCdWZmZXIoYikpIHRocm93IG5ldyBUeXBlRXJyb3IoJ0FyZ3VtZW50IG11c3QgYmUgYSBCdWZmZXInKVxuICBpZiAodGhpcyA9PT0gYikgcmV0dXJuIDBcbiAgcmV0dXJuIEJ1ZmZlci5jb21wYXJlKHRoaXMsIGIpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUuaW5kZXhPZiA9IGZ1bmN0aW9uIGluZGV4T2YgKHZhbCwgYnl0ZU9mZnNldCkge1xuICBpZiAoYnl0ZU9mZnNldCA+IDB4N2ZmZmZmZmYpIGJ5dGVPZmZzZXQgPSAweDdmZmZmZmZmXG4gIGVsc2UgaWYgKGJ5dGVPZmZzZXQgPCAtMHg4MDAwMDAwMCkgYnl0ZU9mZnNldCA9IC0weDgwMDAwMDAwXG4gIGJ5dGVPZmZzZXQgPj49IDBcblxuICBpZiAodGhpcy5sZW5ndGggPT09IDApIHJldHVybiAtMVxuICBpZiAoYnl0ZU9mZnNldCA+PSB0aGlzLmxlbmd0aCkgcmV0dXJuIC0xXG5cbiAgLy8gTmVnYXRpdmUgb2Zmc2V0cyBzdGFydCBmcm9tIHRoZSBlbmQgb2YgdGhlIGJ1ZmZlclxuICBpZiAoYnl0ZU9mZnNldCA8IDApIGJ5dGVPZmZzZXQgPSBNYXRoLm1heCh0aGlzLmxlbmd0aCArIGJ5dGVPZmZzZXQsIDApXG5cbiAgaWYgKHR5cGVvZiB2YWwgPT09ICdzdHJpbmcnKSB7XG4gICAgaWYgKHZhbC5sZW5ndGggPT09IDApIHJldHVybiAtMSAvLyBzcGVjaWFsIGNhc2U6IGxvb2tpbmcgZm9yIGVtcHR5IHN0cmluZyBhbHdheXMgZmFpbHNcbiAgICByZXR1cm4gU3RyaW5nLnByb3RvdHlwZS5pbmRleE9mLmNhbGwodGhpcywgdmFsLCBieXRlT2Zmc2V0KVxuICB9XG4gIGlmIChCdWZmZXIuaXNCdWZmZXIodmFsKSkge1xuICAgIHJldHVybiBhcnJheUluZGV4T2YodGhpcywgdmFsLCBieXRlT2Zmc2V0KVxuICB9XG4gIGlmICh0eXBlb2YgdmFsID09PSAnbnVtYmVyJykge1xuICAgIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCAmJiBVaW50OEFycmF5LnByb3RvdHlwZS5pbmRleE9mID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICByZXR1cm4gVWludDhBcnJheS5wcm90b3R5cGUuaW5kZXhPZi5jYWxsKHRoaXMsIHZhbCwgYnl0ZU9mZnNldClcbiAgICB9XG4gICAgcmV0dXJuIGFycmF5SW5kZXhPZih0aGlzLCBbIHZhbCBdLCBieXRlT2Zmc2V0KVxuICB9XG5cbiAgZnVuY3Rpb24gYXJyYXlJbmRleE9mIChhcnIsIHZhbCwgYnl0ZU9mZnNldCkge1xuICAgIHZhciBmb3VuZEluZGV4ID0gLTFcbiAgICBmb3IgKHZhciBpID0gMDsgYnl0ZU9mZnNldCArIGkgPCBhcnIubGVuZ3RoOyBpKyspIHtcbiAgICAgIGlmIChhcnJbYnl0ZU9mZnNldCArIGldID09PSB2YWxbZm91bmRJbmRleCA9PT0gLTEgPyAwIDogaSAtIGZvdW5kSW5kZXhdKSB7XG4gICAgICAgIGlmIChmb3VuZEluZGV4ID09PSAtMSkgZm91bmRJbmRleCA9IGlcbiAgICAgICAgaWYgKGkgLSBmb3VuZEluZGV4ICsgMSA9PT0gdmFsLmxlbmd0aCkgcmV0dXJuIGJ5dGVPZmZzZXQgKyBmb3VuZEluZGV4XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBmb3VuZEluZGV4ID0gLTFcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIC0xXG4gIH1cblxuICB0aHJvdyBuZXcgVHlwZUVycm9yKCd2YWwgbXVzdCBiZSBzdHJpbmcsIG51bWJlciBvciBCdWZmZXInKVxufVxuXG4vLyBgZ2V0YCB3aWxsIGJlIHJlbW92ZWQgaW4gTm9kZSAwLjEzK1xuQnVmZmVyLnByb3RvdHlwZS5nZXQgPSBmdW5jdGlvbiBnZXQgKG9mZnNldCkge1xuICBjb25zb2xlLmxvZygnLmdldCgpIGlzIGRlcHJlY2F0ZWQuIEFjY2VzcyB1c2luZyBhcnJheSBpbmRleGVzIGluc3RlYWQuJylcbiAgcmV0dXJuIHRoaXMucmVhZFVJbnQ4KG9mZnNldClcbn1cblxuLy8gYHNldGAgd2lsbCBiZSByZW1vdmVkIGluIE5vZGUgMC4xMytcbkJ1ZmZlci5wcm90b3R5cGUuc2V0ID0gZnVuY3Rpb24gc2V0ICh2LCBvZmZzZXQpIHtcbiAgY29uc29sZS5sb2coJy5zZXQoKSBpcyBkZXByZWNhdGVkLiBBY2Nlc3MgdXNpbmcgYXJyYXkgaW5kZXhlcyBpbnN0ZWFkLicpXG4gIHJldHVybiB0aGlzLndyaXRlVUludDgodiwgb2Zmc2V0KVxufVxuXG5mdW5jdGlvbiBoZXhXcml0ZSAoYnVmLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKSB7XG4gIG9mZnNldCA9IE51bWJlcihvZmZzZXQpIHx8IDBcbiAgdmFyIHJlbWFpbmluZyA9IGJ1Zi5sZW5ndGggLSBvZmZzZXRcbiAgaWYgKCFsZW5ndGgpIHtcbiAgICBsZW5ndGggPSByZW1haW5pbmdcbiAgfSBlbHNlIHtcbiAgICBsZW5ndGggPSBOdW1iZXIobGVuZ3RoKVxuICAgIGlmIChsZW5ndGggPiByZW1haW5pbmcpIHtcbiAgICAgIGxlbmd0aCA9IHJlbWFpbmluZ1xuICAgIH1cbiAgfVxuXG4gIC8vIG11c3QgYmUgYW4gZXZlbiBudW1iZXIgb2YgZGlnaXRzXG4gIHZhciBzdHJMZW4gPSBzdHJpbmcubGVuZ3RoXG4gIGlmIChzdHJMZW4gJSAyICE9PSAwKSB0aHJvdyBuZXcgRXJyb3IoJ0ludmFsaWQgaGV4IHN0cmluZycpXG5cbiAgaWYgKGxlbmd0aCA+IHN0ckxlbiAvIDIpIHtcbiAgICBsZW5ndGggPSBzdHJMZW4gLyAyXG4gIH1cbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW5ndGg7IGkrKykge1xuICAgIHZhciBwYXJzZWQgPSBwYXJzZUludChzdHJpbmcuc3Vic3RyKGkgKiAyLCAyKSwgMTYpXG4gICAgaWYgKGlzTmFOKHBhcnNlZCkpIHRocm93IG5ldyBFcnJvcignSW52YWxpZCBoZXggc3RyaW5nJylcbiAgICBidWZbb2Zmc2V0ICsgaV0gPSBwYXJzZWRcbiAgfVxuICByZXR1cm4gaVxufVxuXG5mdW5jdGlvbiB1dGY4V3JpdGUgKGJ1Ziwgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCkge1xuICByZXR1cm4gYmxpdEJ1ZmZlcih1dGY4VG9CeXRlcyhzdHJpbmcsIGJ1Zi5sZW5ndGggLSBvZmZzZXQpLCBidWYsIG9mZnNldCwgbGVuZ3RoKVxufVxuXG5mdW5jdGlvbiBhc2NpaVdyaXRlIChidWYsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpIHtcbiAgcmV0dXJuIGJsaXRCdWZmZXIoYXNjaWlUb0J5dGVzKHN0cmluZyksIGJ1Ziwgb2Zmc2V0LCBsZW5ndGgpXG59XG5cbmZ1bmN0aW9uIGJpbmFyeVdyaXRlIChidWYsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpIHtcbiAgcmV0dXJuIGFzY2lpV3JpdGUoYnVmLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKVxufVxuXG5mdW5jdGlvbiBiYXNlNjRXcml0ZSAoYnVmLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKSB7XG4gIHJldHVybiBibGl0QnVmZmVyKGJhc2U2NFRvQnl0ZXMoc3RyaW5nKSwgYnVmLCBvZmZzZXQsIGxlbmd0aClcbn1cblxuZnVuY3Rpb24gdWNzMldyaXRlIChidWYsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpIHtcbiAgcmV0dXJuIGJsaXRCdWZmZXIodXRmMTZsZVRvQnl0ZXMoc3RyaW5nLCBidWYubGVuZ3RoIC0gb2Zmc2V0KSwgYnVmLCBvZmZzZXQsIGxlbmd0aClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZSA9IGZ1bmN0aW9uIHdyaXRlIChzdHJpbmcsIG9mZnNldCwgbGVuZ3RoLCBlbmNvZGluZykge1xuICAvLyBCdWZmZXIjd3JpdGUoc3RyaW5nKVxuICBpZiAob2Zmc2V0ID09PSB1bmRlZmluZWQpIHtcbiAgICBlbmNvZGluZyA9ICd1dGY4J1xuICAgIGxlbmd0aCA9IHRoaXMubGVuZ3RoXG4gICAgb2Zmc2V0ID0gMFxuICAvLyBCdWZmZXIjd3JpdGUoc3RyaW5nLCBlbmNvZGluZylcbiAgfSBlbHNlIGlmIChsZW5ndGggPT09IHVuZGVmaW5lZCAmJiB0eXBlb2Ygb2Zmc2V0ID09PSAnc3RyaW5nJykge1xuICAgIGVuY29kaW5nID0gb2Zmc2V0XG4gICAgbGVuZ3RoID0gdGhpcy5sZW5ndGhcbiAgICBvZmZzZXQgPSAwXG4gIC8vIEJ1ZmZlciN3cml0ZShzdHJpbmcsIG9mZnNldFssIGxlbmd0aF1bLCBlbmNvZGluZ10pXG4gIH0gZWxzZSBpZiAoaXNGaW5pdGUob2Zmc2V0KSkge1xuICAgIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgICBpZiAoaXNGaW5pdGUobGVuZ3RoKSkge1xuICAgICAgbGVuZ3RoID0gbGVuZ3RoIHwgMFxuICAgICAgaWYgKGVuY29kaW5nID09PSB1bmRlZmluZWQpIGVuY29kaW5nID0gJ3V0ZjgnXG4gICAgfSBlbHNlIHtcbiAgICAgIGVuY29kaW5nID0gbGVuZ3RoXG4gICAgICBsZW5ndGggPSB1bmRlZmluZWRcbiAgICB9XG4gIC8vIGxlZ2FjeSB3cml0ZShzdHJpbmcsIGVuY29kaW5nLCBvZmZzZXQsIGxlbmd0aCkgLSByZW1vdmUgaW4gdjAuMTNcbiAgfSBlbHNlIHtcbiAgICB2YXIgc3dhcCA9IGVuY29kaW5nXG4gICAgZW5jb2RpbmcgPSBvZmZzZXRcbiAgICBvZmZzZXQgPSBsZW5ndGggfCAwXG4gICAgbGVuZ3RoID0gc3dhcFxuICB9XG5cbiAgdmFyIHJlbWFpbmluZyA9IHRoaXMubGVuZ3RoIC0gb2Zmc2V0XG4gIGlmIChsZW5ndGggPT09IHVuZGVmaW5lZCB8fCBsZW5ndGggPiByZW1haW5pbmcpIGxlbmd0aCA9IHJlbWFpbmluZ1xuXG4gIGlmICgoc3RyaW5nLmxlbmd0aCA+IDAgJiYgKGxlbmd0aCA8IDAgfHwgb2Zmc2V0IDwgMCkpIHx8IG9mZnNldCA+IHRoaXMubGVuZ3RoKSB7XG4gICAgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ2F0dGVtcHQgdG8gd3JpdGUgb3V0c2lkZSBidWZmZXIgYm91bmRzJylcbiAgfVxuXG4gIGlmICghZW5jb2RpbmcpIGVuY29kaW5nID0gJ3V0ZjgnXG5cbiAgdmFyIGxvd2VyZWRDYXNlID0gZmFsc2VcbiAgZm9yICg7Oykge1xuICAgIHN3aXRjaCAoZW5jb2RpbmcpIHtcbiAgICAgIGNhc2UgJ2hleCc6XG4gICAgICAgIHJldHVybiBoZXhXcml0ZSh0aGlzLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKVxuXG4gICAgICBjYXNlICd1dGY4JzpcbiAgICAgIGNhc2UgJ3V0Zi04JzpcbiAgICAgICAgcmV0dXJuIHV0ZjhXcml0ZSh0aGlzLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKVxuXG4gICAgICBjYXNlICdhc2NpaSc6XG4gICAgICAgIHJldHVybiBhc2NpaVdyaXRlKHRoaXMsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpXG5cbiAgICAgIGNhc2UgJ2JpbmFyeSc6XG4gICAgICAgIHJldHVybiBiaW5hcnlXcml0ZSh0aGlzLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKVxuXG4gICAgICBjYXNlICdiYXNlNjQnOlxuICAgICAgICAvLyBXYXJuaW5nOiBtYXhMZW5ndGggbm90IHRha2VuIGludG8gYWNjb3VudCBpbiBiYXNlNjRXcml0ZVxuICAgICAgICByZXR1cm4gYmFzZTY0V3JpdGUodGhpcywgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aClcblxuICAgICAgY2FzZSAndWNzMic6XG4gICAgICBjYXNlICd1Y3MtMic6XG4gICAgICBjYXNlICd1dGYxNmxlJzpcbiAgICAgIGNhc2UgJ3V0Zi0xNmxlJzpcbiAgICAgICAgcmV0dXJuIHVjczJXcml0ZSh0aGlzLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKVxuXG4gICAgICBkZWZhdWx0OlxuICAgICAgICBpZiAobG93ZXJlZENhc2UpIHRocm93IG5ldyBUeXBlRXJyb3IoJ1Vua25vd24gZW5jb2Rpbmc6ICcgKyBlbmNvZGluZylcbiAgICAgICAgZW5jb2RpbmcgPSAoJycgKyBlbmNvZGluZykudG9Mb3dlckNhc2UoKVxuICAgICAgICBsb3dlcmVkQ2FzZSA9IHRydWVcbiAgICB9XG4gIH1cbn1cblxuQnVmZmVyLnByb3RvdHlwZS50b0pTT04gPSBmdW5jdGlvbiB0b0pTT04gKCkge1xuICByZXR1cm4ge1xuICAgIHR5cGU6ICdCdWZmZXInLFxuICAgIGRhdGE6IEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKHRoaXMuX2FyciB8fCB0aGlzLCAwKVxuICB9XG59XG5cbmZ1bmN0aW9uIGJhc2U2NFNsaWNlIChidWYsIHN0YXJ0LCBlbmQpIHtcbiAgaWYgKHN0YXJ0ID09PSAwICYmIGVuZCA9PT0gYnVmLmxlbmd0aCkge1xuICAgIHJldHVybiBiYXNlNjQuZnJvbUJ5dGVBcnJheShidWYpXG4gIH0gZWxzZSB7XG4gICAgcmV0dXJuIGJhc2U2NC5mcm9tQnl0ZUFycmF5KGJ1Zi5zbGljZShzdGFydCwgZW5kKSlcbiAgfVxufVxuXG5mdW5jdGlvbiB1dGY4U2xpY2UgKGJ1Ziwgc3RhcnQsIGVuZCkge1xuICB2YXIgcmVzID0gJydcbiAgdmFyIHRtcCA9ICcnXG4gIGVuZCA9IE1hdGgubWluKGJ1Zi5sZW5ndGgsIGVuZClcblxuICBmb3IgKHZhciBpID0gc3RhcnQ7IGkgPCBlbmQ7IGkrKykge1xuICAgIGlmIChidWZbaV0gPD0gMHg3Rikge1xuICAgICAgcmVzICs9IGRlY29kZVV0ZjhDaGFyKHRtcCkgKyBTdHJpbmcuZnJvbUNoYXJDb2RlKGJ1ZltpXSlcbiAgICAgIHRtcCA9ICcnXG4gICAgfSBlbHNlIHtcbiAgICAgIHRtcCArPSAnJScgKyBidWZbaV0udG9TdHJpbmcoMTYpXG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHJlcyArIGRlY29kZVV0ZjhDaGFyKHRtcClcbn1cblxuZnVuY3Rpb24gYXNjaWlTbGljZSAoYnVmLCBzdGFydCwgZW5kKSB7XG4gIHZhciByZXQgPSAnJ1xuICBlbmQgPSBNYXRoLm1pbihidWYubGVuZ3RoLCBlbmQpXG5cbiAgZm9yICh2YXIgaSA9IHN0YXJ0OyBpIDwgZW5kOyBpKyspIHtcbiAgICByZXQgKz0gU3RyaW5nLmZyb21DaGFyQ29kZShidWZbaV0gJiAweDdGKVxuICB9XG4gIHJldHVybiByZXRcbn1cblxuZnVuY3Rpb24gYmluYXJ5U2xpY2UgKGJ1Ziwgc3RhcnQsIGVuZCkge1xuICB2YXIgcmV0ID0gJydcbiAgZW5kID0gTWF0aC5taW4oYnVmLmxlbmd0aCwgZW5kKVxuXG4gIGZvciAodmFyIGkgPSBzdGFydDsgaSA8IGVuZDsgaSsrKSB7XG4gICAgcmV0ICs9IFN0cmluZy5mcm9tQ2hhckNvZGUoYnVmW2ldKVxuICB9XG4gIHJldHVybiByZXRcbn1cblxuZnVuY3Rpb24gaGV4U2xpY2UgKGJ1Ziwgc3RhcnQsIGVuZCkge1xuICB2YXIgbGVuID0gYnVmLmxlbmd0aFxuXG4gIGlmICghc3RhcnQgfHwgc3RhcnQgPCAwKSBzdGFydCA9IDBcbiAgaWYgKCFlbmQgfHwgZW5kIDwgMCB8fCBlbmQgPiBsZW4pIGVuZCA9IGxlblxuXG4gIHZhciBvdXQgPSAnJ1xuICBmb3IgKHZhciBpID0gc3RhcnQ7IGkgPCBlbmQ7IGkrKykge1xuICAgIG91dCArPSB0b0hleChidWZbaV0pXG4gIH1cbiAgcmV0dXJuIG91dFxufVxuXG5mdW5jdGlvbiB1dGYxNmxlU2xpY2UgKGJ1Ziwgc3RhcnQsIGVuZCkge1xuICB2YXIgYnl0ZXMgPSBidWYuc2xpY2Uoc3RhcnQsIGVuZClcbiAgdmFyIHJlcyA9ICcnXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgYnl0ZXMubGVuZ3RoOyBpICs9IDIpIHtcbiAgICByZXMgKz0gU3RyaW5nLmZyb21DaGFyQ29kZShieXRlc1tpXSArIGJ5dGVzW2kgKyAxXSAqIDI1NilcbiAgfVxuICByZXR1cm4gcmVzXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUuc2xpY2UgPSBmdW5jdGlvbiBzbGljZSAoc3RhcnQsIGVuZCkge1xuICB2YXIgbGVuID0gdGhpcy5sZW5ndGhcbiAgc3RhcnQgPSB+fnN0YXJ0XG4gIGVuZCA9IGVuZCA9PT0gdW5kZWZpbmVkID8gbGVuIDogfn5lbmRcblxuICBpZiAoc3RhcnQgPCAwKSB7XG4gICAgc3RhcnQgKz0gbGVuXG4gICAgaWYgKHN0YXJ0IDwgMCkgc3RhcnQgPSAwXG4gIH0gZWxzZSBpZiAoc3RhcnQgPiBsZW4pIHtcbiAgICBzdGFydCA9IGxlblxuICB9XG5cbiAgaWYgKGVuZCA8IDApIHtcbiAgICBlbmQgKz0gbGVuXG4gICAgaWYgKGVuZCA8IDApIGVuZCA9IDBcbiAgfSBlbHNlIGlmIChlbmQgPiBsZW4pIHtcbiAgICBlbmQgPSBsZW5cbiAgfVxuXG4gIGlmIChlbmQgPCBzdGFydCkgZW5kID0gc3RhcnRcblxuICB2YXIgbmV3QnVmXG4gIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIG5ld0J1ZiA9IEJ1ZmZlci5fYXVnbWVudCh0aGlzLnN1YmFycmF5KHN0YXJ0LCBlbmQpKVxuICB9IGVsc2Uge1xuICAgIHZhciBzbGljZUxlbiA9IGVuZCAtIHN0YXJ0XG4gICAgbmV3QnVmID0gbmV3IEJ1ZmZlcihzbGljZUxlbiwgdW5kZWZpbmVkKVxuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgc2xpY2VMZW47IGkrKykge1xuICAgICAgbmV3QnVmW2ldID0gdGhpc1tpICsgc3RhcnRdXG4gICAgfVxuICB9XG5cbiAgaWYgKG5ld0J1Zi5sZW5ndGgpIG5ld0J1Zi5wYXJlbnQgPSB0aGlzLnBhcmVudCB8fCB0aGlzXG5cbiAgcmV0dXJuIG5ld0J1ZlxufVxuXG4vKlxuICogTmVlZCB0byBtYWtlIHN1cmUgdGhhdCBidWZmZXIgaXNuJ3QgdHJ5aW5nIHRvIHdyaXRlIG91dCBvZiBib3VuZHMuXG4gKi9cbmZ1bmN0aW9uIGNoZWNrT2Zmc2V0IChvZmZzZXQsIGV4dCwgbGVuZ3RoKSB7XG4gIGlmICgob2Zmc2V0ICUgMSkgIT09IDAgfHwgb2Zmc2V0IDwgMCkgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ29mZnNldCBpcyBub3QgdWludCcpXG4gIGlmIChvZmZzZXQgKyBleHQgPiBsZW5ndGgpIHRocm93IG5ldyBSYW5nZUVycm9yKCdUcnlpbmcgdG8gYWNjZXNzIGJleW9uZCBidWZmZXIgbGVuZ3RoJylcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkVUludExFID0gZnVuY3Rpb24gcmVhZFVJbnRMRSAob2Zmc2V0LCBieXRlTGVuZ3RoLCBub0Fzc2VydCkge1xuICBvZmZzZXQgPSBvZmZzZXQgfCAwXG4gIGJ5dGVMZW5ndGggPSBieXRlTGVuZ3RoIHwgMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIGJ5dGVMZW5ndGgsIHRoaXMubGVuZ3RoKVxuXG4gIHZhciB2YWwgPSB0aGlzW29mZnNldF1cbiAgdmFyIG11bCA9IDFcbiAgdmFyIGkgPSAwXG4gIHdoaWxlICgrK2kgPCBieXRlTGVuZ3RoICYmIChtdWwgKj0gMHgxMDApKSB7XG4gICAgdmFsICs9IHRoaXNbb2Zmc2V0ICsgaV0gKiBtdWxcbiAgfVxuXG4gIHJldHVybiB2YWxcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkVUludEJFID0gZnVuY3Rpb24gcmVhZFVJbnRCRSAob2Zmc2V0LCBieXRlTGVuZ3RoLCBub0Fzc2VydCkge1xuICBvZmZzZXQgPSBvZmZzZXQgfCAwXG4gIGJ5dGVMZW5ndGggPSBieXRlTGVuZ3RoIHwgMFxuICBpZiAoIW5vQXNzZXJ0KSB7XG4gICAgY2hlY2tPZmZzZXQob2Zmc2V0LCBieXRlTGVuZ3RoLCB0aGlzLmxlbmd0aClcbiAgfVxuXG4gIHZhciB2YWwgPSB0aGlzW29mZnNldCArIC0tYnl0ZUxlbmd0aF1cbiAgdmFyIG11bCA9IDFcbiAgd2hpbGUgKGJ5dGVMZW5ndGggPiAwICYmIChtdWwgKj0gMHgxMDApKSB7XG4gICAgdmFsICs9IHRoaXNbb2Zmc2V0ICsgLS1ieXRlTGVuZ3RoXSAqIG11bFxuICB9XG5cbiAgcmV0dXJuIHZhbFxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRVSW50OCA9IGZ1bmN0aW9uIHJlYWRVSW50OCAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDEsIHRoaXMubGVuZ3RoKVxuICByZXR1cm4gdGhpc1tvZmZzZXRdXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZFVJbnQxNkxFID0gZnVuY3Rpb24gcmVhZFVJbnQxNkxFIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgMiwgdGhpcy5sZW5ndGgpXG4gIHJldHVybiB0aGlzW29mZnNldF0gfCAodGhpc1tvZmZzZXQgKyAxXSA8PCA4KVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRVSW50MTZCRSA9IGZ1bmN0aW9uIHJlYWRVSW50MTZCRSAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDIsIHRoaXMubGVuZ3RoKVxuICByZXR1cm4gKHRoaXNbb2Zmc2V0XSA8PCA4KSB8IHRoaXNbb2Zmc2V0ICsgMV1cbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkVUludDMyTEUgPSBmdW5jdGlvbiByZWFkVUludDMyTEUgKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCA0LCB0aGlzLmxlbmd0aClcblxuICByZXR1cm4gKCh0aGlzW29mZnNldF0pIHxcbiAgICAgICh0aGlzW29mZnNldCArIDFdIDw8IDgpIHxcbiAgICAgICh0aGlzW29mZnNldCArIDJdIDw8IDE2KSkgK1xuICAgICAgKHRoaXNbb2Zmc2V0ICsgM10gKiAweDEwMDAwMDApXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZFVJbnQzMkJFID0gZnVuY3Rpb24gcmVhZFVJbnQzMkJFIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgNCwgdGhpcy5sZW5ndGgpXG5cbiAgcmV0dXJuICh0aGlzW29mZnNldF0gKiAweDEwMDAwMDApICtcbiAgICAoKHRoaXNbb2Zmc2V0ICsgMV0gPDwgMTYpIHxcbiAgICAodGhpc1tvZmZzZXQgKyAyXSA8PCA4KSB8XG4gICAgdGhpc1tvZmZzZXQgKyAzXSlcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkSW50TEUgPSBmdW5jdGlvbiByZWFkSW50TEUgKG9mZnNldCwgYnl0ZUxlbmd0aCwgbm9Bc3NlcnQpIHtcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBieXRlTGVuZ3RoID0gYnl0ZUxlbmd0aCB8IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCBieXRlTGVuZ3RoLCB0aGlzLmxlbmd0aClcblxuICB2YXIgdmFsID0gdGhpc1tvZmZzZXRdXG4gIHZhciBtdWwgPSAxXG4gIHZhciBpID0gMFxuICB3aGlsZSAoKytpIDwgYnl0ZUxlbmd0aCAmJiAobXVsICo9IDB4MTAwKSkge1xuICAgIHZhbCArPSB0aGlzW29mZnNldCArIGldICogbXVsXG4gIH1cbiAgbXVsICo9IDB4ODBcblxuICBpZiAodmFsID49IG11bCkgdmFsIC09IE1hdGgucG93KDIsIDggKiBieXRlTGVuZ3RoKVxuXG4gIHJldHVybiB2YWxcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkSW50QkUgPSBmdW5jdGlvbiByZWFkSW50QkUgKG9mZnNldCwgYnl0ZUxlbmd0aCwgbm9Bc3NlcnQpIHtcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBieXRlTGVuZ3RoID0gYnl0ZUxlbmd0aCB8IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCBieXRlTGVuZ3RoLCB0aGlzLmxlbmd0aClcblxuICB2YXIgaSA9IGJ5dGVMZW5ndGhcbiAgdmFyIG11bCA9IDFcbiAgdmFyIHZhbCA9IHRoaXNbb2Zmc2V0ICsgLS1pXVxuICB3aGlsZSAoaSA+IDAgJiYgKG11bCAqPSAweDEwMCkpIHtcbiAgICB2YWwgKz0gdGhpc1tvZmZzZXQgKyAtLWldICogbXVsXG4gIH1cbiAgbXVsICo9IDB4ODBcblxuICBpZiAodmFsID49IG11bCkgdmFsIC09IE1hdGgucG93KDIsIDggKiBieXRlTGVuZ3RoKVxuXG4gIHJldHVybiB2YWxcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkSW50OCA9IGZ1bmN0aW9uIHJlYWRJbnQ4IChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgMSwgdGhpcy5sZW5ndGgpXG4gIGlmICghKHRoaXNbb2Zmc2V0XSAmIDB4ODApKSByZXR1cm4gKHRoaXNbb2Zmc2V0XSlcbiAgcmV0dXJuICgoMHhmZiAtIHRoaXNbb2Zmc2V0XSArIDEpICogLTEpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEludDE2TEUgPSBmdW5jdGlvbiByZWFkSW50MTZMRSAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDIsIHRoaXMubGVuZ3RoKVxuICB2YXIgdmFsID0gdGhpc1tvZmZzZXRdIHwgKHRoaXNbb2Zmc2V0ICsgMV0gPDwgOClcbiAgcmV0dXJuICh2YWwgJiAweDgwMDApID8gdmFsIHwgMHhGRkZGMDAwMCA6IHZhbFxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRJbnQxNkJFID0gZnVuY3Rpb24gcmVhZEludDE2QkUgKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCAyLCB0aGlzLmxlbmd0aClcbiAgdmFyIHZhbCA9IHRoaXNbb2Zmc2V0ICsgMV0gfCAodGhpc1tvZmZzZXRdIDw8IDgpXG4gIHJldHVybiAodmFsICYgMHg4MDAwKSA/IHZhbCB8IDB4RkZGRjAwMDAgOiB2YWxcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkSW50MzJMRSA9IGZ1bmN0aW9uIHJlYWRJbnQzMkxFIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgNCwgdGhpcy5sZW5ndGgpXG5cbiAgcmV0dXJuICh0aGlzW29mZnNldF0pIHxcbiAgICAodGhpc1tvZmZzZXQgKyAxXSA8PCA4KSB8XG4gICAgKHRoaXNbb2Zmc2V0ICsgMl0gPDwgMTYpIHxcbiAgICAodGhpc1tvZmZzZXQgKyAzXSA8PCAyNClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkSW50MzJCRSA9IGZ1bmN0aW9uIHJlYWRJbnQzMkJFIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgNCwgdGhpcy5sZW5ndGgpXG5cbiAgcmV0dXJuICh0aGlzW29mZnNldF0gPDwgMjQpIHxcbiAgICAodGhpc1tvZmZzZXQgKyAxXSA8PCAxNikgfFxuICAgICh0aGlzW29mZnNldCArIDJdIDw8IDgpIHxcbiAgICAodGhpc1tvZmZzZXQgKyAzXSlcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkRmxvYXRMRSA9IGZ1bmN0aW9uIHJlYWRGbG9hdExFIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgNCwgdGhpcy5sZW5ndGgpXG4gIHJldHVybiBpZWVlNzU0LnJlYWQodGhpcywgb2Zmc2V0LCB0cnVlLCAyMywgNClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkRmxvYXRCRSA9IGZ1bmN0aW9uIHJlYWRGbG9hdEJFIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgNCwgdGhpcy5sZW5ndGgpXG4gIHJldHVybiBpZWVlNzU0LnJlYWQodGhpcywgb2Zmc2V0LCBmYWxzZSwgMjMsIDQpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZERvdWJsZUxFID0gZnVuY3Rpb24gcmVhZERvdWJsZUxFIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgOCwgdGhpcy5sZW5ndGgpXG4gIHJldHVybiBpZWVlNzU0LnJlYWQodGhpcywgb2Zmc2V0LCB0cnVlLCA1MiwgOClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkRG91YmxlQkUgPSBmdW5jdGlvbiByZWFkRG91YmxlQkUgKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCA4LCB0aGlzLmxlbmd0aClcbiAgcmV0dXJuIGllZWU3NTQucmVhZCh0aGlzLCBvZmZzZXQsIGZhbHNlLCA1MiwgOClcbn1cblxuZnVuY3Rpb24gY2hlY2tJbnQgKGJ1ZiwgdmFsdWUsIG9mZnNldCwgZXh0LCBtYXgsIG1pbikge1xuICBpZiAoIUJ1ZmZlci5pc0J1ZmZlcihidWYpKSB0aHJvdyBuZXcgVHlwZUVycm9yKCdidWZmZXIgbXVzdCBiZSBhIEJ1ZmZlciBpbnN0YW5jZScpXG4gIGlmICh2YWx1ZSA+IG1heCB8fCB2YWx1ZSA8IG1pbikgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ3ZhbHVlIGlzIG91dCBvZiBib3VuZHMnKVxuICBpZiAob2Zmc2V0ICsgZXh0ID4gYnVmLmxlbmd0aCkgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ2luZGV4IG91dCBvZiByYW5nZScpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVVSW50TEUgPSBmdW5jdGlvbiB3cml0ZVVJbnRMRSAodmFsdWUsIG9mZnNldCwgYnl0ZUxlbmd0aCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBieXRlTGVuZ3RoID0gYnl0ZUxlbmd0aCB8IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgYnl0ZUxlbmd0aCwgTWF0aC5wb3coMiwgOCAqIGJ5dGVMZW5ndGgpLCAwKVxuXG4gIHZhciBtdWwgPSAxXG4gIHZhciBpID0gMFxuICB0aGlzW29mZnNldF0gPSB2YWx1ZSAmIDB4RkZcbiAgd2hpbGUgKCsraSA8IGJ5dGVMZW5ndGggJiYgKG11bCAqPSAweDEwMCkpIHtcbiAgICB0aGlzW29mZnNldCArIGldID0gKHZhbHVlIC8gbXVsKSAmIDB4RkZcbiAgfVxuXG4gIHJldHVybiBvZmZzZXQgKyBieXRlTGVuZ3RoXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVVSW50QkUgPSBmdW5jdGlvbiB3cml0ZVVJbnRCRSAodmFsdWUsIG9mZnNldCwgYnl0ZUxlbmd0aCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBieXRlTGVuZ3RoID0gYnl0ZUxlbmd0aCB8IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgYnl0ZUxlbmd0aCwgTWF0aC5wb3coMiwgOCAqIGJ5dGVMZW5ndGgpLCAwKVxuXG4gIHZhciBpID0gYnl0ZUxlbmd0aCAtIDFcbiAgdmFyIG11bCA9IDFcbiAgdGhpc1tvZmZzZXQgKyBpXSA9IHZhbHVlICYgMHhGRlxuICB3aGlsZSAoLS1pID49IDAgJiYgKG11bCAqPSAweDEwMCkpIHtcbiAgICB0aGlzW29mZnNldCArIGldID0gKHZhbHVlIC8gbXVsKSAmIDB4RkZcbiAgfVxuXG4gIHJldHVybiBvZmZzZXQgKyBieXRlTGVuZ3RoXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVVSW50OCA9IGZ1bmN0aW9uIHdyaXRlVUludDggKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgMSwgMHhmZiwgMClcbiAgaWYgKCFCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkgdmFsdWUgPSBNYXRoLmZsb29yKHZhbHVlKVxuICB0aGlzW29mZnNldF0gPSB2YWx1ZVxuICByZXR1cm4gb2Zmc2V0ICsgMVxufVxuXG5mdW5jdGlvbiBvYmplY3RXcml0ZVVJbnQxNiAoYnVmLCB2YWx1ZSwgb2Zmc2V0LCBsaXR0bGVFbmRpYW4pIHtcbiAgaWYgKHZhbHVlIDwgMCkgdmFsdWUgPSAweGZmZmYgKyB2YWx1ZSArIDFcbiAgZm9yICh2YXIgaSA9IDAsIGogPSBNYXRoLm1pbihidWYubGVuZ3RoIC0gb2Zmc2V0LCAyKTsgaSA8IGo7IGkrKykge1xuICAgIGJ1ZltvZmZzZXQgKyBpXSA9ICh2YWx1ZSAmICgweGZmIDw8ICg4ICogKGxpdHRsZUVuZGlhbiA/IGkgOiAxIC0gaSkpKSkgPj4+XG4gICAgICAobGl0dGxlRW5kaWFuID8gaSA6IDEgLSBpKSAqIDhcbiAgfVxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlVUludDE2TEUgPSBmdW5jdGlvbiB3cml0ZVVJbnQxNkxFICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgfCAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIDIsIDB4ZmZmZiwgMClcbiAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgdGhpc1tvZmZzZXRdID0gdmFsdWVcbiAgICB0aGlzW29mZnNldCArIDFdID0gKHZhbHVlID4+PiA4KVxuICB9IGVsc2Uge1xuICAgIG9iamVjdFdyaXRlVUludDE2KHRoaXMsIHZhbHVlLCBvZmZzZXQsIHRydWUpXG4gIH1cbiAgcmV0dXJuIG9mZnNldCArIDJcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZVVJbnQxNkJFID0gZnVuY3Rpb24gd3JpdGVVSW50MTZCRSAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCAyLCAweGZmZmYsIDApXG4gIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIHRoaXNbb2Zmc2V0XSA9ICh2YWx1ZSA+Pj4gOClcbiAgICB0aGlzW29mZnNldCArIDFdID0gdmFsdWVcbiAgfSBlbHNlIHtcbiAgICBvYmplY3RXcml0ZVVJbnQxNih0aGlzLCB2YWx1ZSwgb2Zmc2V0LCBmYWxzZSlcbiAgfVxuICByZXR1cm4gb2Zmc2V0ICsgMlxufVxuXG5mdW5jdGlvbiBvYmplY3RXcml0ZVVJbnQzMiAoYnVmLCB2YWx1ZSwgb2Zmc2V0LCBsaXR0bGVFbmRpYW4pIHtcbiAgaWYgKHZhbHVlIDwgMCkgdmFsdWUgPSAweGZmZmZmZmZmICsgdmFsdWUgKyAxXG4gIGZvciAodmFyIGkgPSAwLCBqID0gTWF0aC5taW4oYnVmLmxlbmd0aCAtIG9mZnNldCwgNCk7IGkgPCBqOyBpKyspIHtcbiAgICBidWZbb2Zmc2V0ICsgaV0gPSAodmFsdWUgPj4+IChsaXR0bGVFbmRpYW4gPyBpIDogMyAtIGkpICogOCkgJiAweGZmXG4gIH1cbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZVVJbnQzMkxFID0gZnVuY3Rpb24gd3JpdGVVSW50MzJMRSAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCA0LCAweGZmZmZmZmZmLCAwKVxuICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICB0aGlzW29mZnNldCArIDNdID0gKHZhbHVlID4+PiAyNClcbiAgICB0aGlzW29mZnNldCArIDJdID0gKHZhbHVlID4+PiAxNilcbiAgICB0aGlzW29mZnNldCArIDFdID0gKHZhbHVlID4+PiA4KVxuICAgIHRoaXNbb2Zmc2V0XSA9IHZhbHVlXG4gIH0gZWxzZSB7XG4gICAgb2JqZWN0V3JpdGVVSW50MzIodGhpcywgdmFsdWUsIG9mZnNldCwgdHJ1ZSlcbiAgfVxuICByZXR1cm4gb2Zmc2V0ICsgNFxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlVUludDMyQkUgPSBmdW5jdGlvbiB3cml0ZVVJbnQzMkJFICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgfCAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIDQsIDB4ZmZmZmZmZmYsIDApXG4gIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIHRoaXNbb2Zmc2V0XSA9ICh2YWx1ZSA+Pj4gMjQpXG4gICAgdGhpc1tvZmZzZXQgKyAxXSA9ICh2YWx1ZSA+Pj4gMTYpXG4gICAgdGhpc1tvZmZzZXQgKyAyXSA9ICh2YWx1ZSA+Pj4gOClcbiAgICB0aGlzW29mZnNldCArIDNdID0gdmFsdWVcbiAgfSBlbHNlIHtcbiAgICBvYmplY3RXcml0ZVVJbnQzMih0aGlzLCB2YWx1ZSwgb2Zmc2V0LCBmYWxzZSlcbiAgfVxuICByZXR1cm4gb2Zmc2V0ICsgNFxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlSW50TEUgPSBmdW5jdGlvbiB3cml0ZUludExFICh2YWx1ZSwgb2Zmc2V0LCBieXRlTGVuZ3RoLCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgfCAwXG4gIGlmICghbm9Bc3NlcnQpIHtcbiAgICB2YXIgbGltaXQgPSBNYXRoLnBvdygyLCA4ICogYnl0ZUxlbmd0aCAtIDEpXG5cbiAgICBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCBieXRlTGVuZ3RoLCBsaW1pdCAtIDEsIC1saW1pdClcbiAgfVxuXG4gIHZhciBpID0gMFxuICB2YXIgbXVsID0gMVxuICB2YXIgc3ViID0gdmFsdWUgPCAwID8gMSA6IDBcbiAgdGhpc1tvZmZzZXRdID0gdmFsdWUgJiAweEZGXG4gIHdoaWxlICgrK2kgPCBieXRlTGVuZ3RoICYmIChtdWwgKj0gMHgxMDApKSB7XG4gICAgdGhpc1tvZmZzZXQgKyBpXSA9ICgodmFsdWUgLyBtdWwpID4+IDApIC0gc3ViICYgMHhGRlxuICB9XG5cbiAgcmV0dXJuIG9mZnNldCArIGJ5dGVMZW5ndGhcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUludEJFID0gZnVuY3Rpb24gd3JpdGVJbnRCRSAodmFsdWUsIG9mZnNldCwgYnl0ZUxlbmd0aCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBpZiAoIW5vQXNzZXJ0KSB7XG4gICAgdmFyIGxpbWl0ID0gTWF0aC5wb3coMiwgOCAqIGJ5dGVMZW5ndGggLSAxKVxuXG4gICAgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgYnl0ZUxlbmd0aCwgbGltaXQgLSAxLCAtbGltaXQpXG4gIH1cblxuICB2YXIgaSA9IGJ5dGVMZW5ndGggLSAxXG4gIHZhciBtdWwgPSAxXG4gIHZhciBzdWIgPSB2YWx1ZSA8IDAgPyAxIDogMFxuICB0aGlzW29mZnNldCArIGldID0gdmFsdWUgJiAweEZGXG4gIHdoaWxlICgtLWkgPj0gMCAmJiAobXVsICo9IDB4MTAwKSkge1xuICAgIHRoaXNbb2Zmc2V0ICsgaV0gPSAoKHZhbHVlIC8gbXVsKSA+PiAwKSAtIHN1YiAmIDB4RkZcbiAgfVxuXG4gIHJldHVybiBvZmZzZXQgKyBieXRlTGVuZ3RoXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVJbnQ4ID0gZnVuY3Rpb24gd3JpdGVJbnQ4ICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgfCAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIDEsIDB4N2YsIC0weDgwKVxuICBpZiAoIUJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB2YWx1ZSA9IE1hdGguZmxvb3IodmFsdWUpXG4gIGlmICh2YWx1ZSA8IDApIHZhbHVlID0gMHhmZiArIHZhbHVlICsgMVxuICB0aGlzW29mZnNldF0gPSB2YWx1ZVxuICByZXR1cm4gb2Zmc2V0ICsgMVxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlSW50MTZMRSA9IGZ1bmN0aW9uIHdyaXRlSW50MTZMRSAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCAyLCAweDdmZmYsIC0weDgwMDApXG4gIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIHRoaXNbb2Zmc2V0XSA9IHZhbHVlXG4gICAgdGhpc1tvZmZzZXQgKyAxXSA9ICh2YWx1ZSA+Pj4gOClcbiAgfSBlbHNlIHtcbiAgICBvYmplY3RXcml0ZVVJbnQxNih0aGlzLCB2YWx1ZSwgb2Zmc2V0LCB0cnVlKVxuICB9XG4gIHJldHVybiBvZmZzZXQgKyAyXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVJbnQxNkJFID0gZnVuY3Rpb24gd3JpdGVJbnQxNkJFICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgfCAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIDIsIDB4N2ZmZiwgLTB4ODAwMClcbiAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgdGhpc1tvZmZzZXRdID0gKHZhbHVlID4+PiA4KVxuICAgIHRoaXNbb2Zmc2V0ICsgMV0gPSB2YWx1ZVxuICB9IGVsc2Uge1xuICAgIG9iamVjdFdyaXRlVUludDE2KHRoaXMsIHZhbHVlLCBvZmZzZXQsIGZhbHNlKVxuICB9XG4gIHJldHVybiBvZmZzZXQgKyAyXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVJbnQzMkxFID0gZnVuY3Rpb24gd3JpdGVJbnQzMkxFICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgfCAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIDQsIDB4N2ZmZmZmZmYsIC0weDgwMDAwMDAwKVxuICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICB0aGlzW29mZnNldF0gPSB2YWx1ZVxuICAgIHRoaXNbb2Zmc2V0ICsgMV0gPSAodmFsdWUgPj4+IDgpXG4gICAgdGhpc1tvZmZzZXQgKyAyXSA9ICh2YWx1ZSA+Pj4gMTYpXG4gICAgdGhpc1tvZmZzZXQgKyAzXSA9ICh2YWx1ZSA+Pj4gMjQpXG4gIH0gZWxzZSB7XG4gICAgb2JqZWN0V3JpdGVVSW50MzIodGhpcywgdmFsdWUsIG9mZnNldCwgdHJ1ZSlcbiAgfVxuICByZXR1cm4gb2Zmc2V0ICsgNFxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlSW50MzJCRSA9IGZ1bmN0aW9uIHdyaXRlSW50MzJCRSAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCA0LCAweDdmZmZmZmZmLCAtMHg4MDAwMDAwMClcbiAgaWYgKHZhbHVlIDwgMCkgdmFsdWUgPSAweGZmZmZmZmZmICsgdmFsdWUgKyAxXG4gIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIHRoaXNbb2Zmc2V0XSA9ICh2YWx1ZSA+Pj4gMjQpXG4gICAgdGhpc1tvZmZzZXQgKyAxXSA9ICh2YWx1ZSA+Pj4gMTYpXG4gICAgdGhpc1tvZmZzZXQgKyAyXSA9ICh2YWx1ZSA+Pj4gOClcbiAgICB0aGlzW29mZnNldCArIDNdID0gdmFsdWVcbiAgfSBlbHNlIHtcbiAgICBvYmplY3RXcml0ZVVJbnQzMih0aGlzLCB2YWx1ZSwgb2Zmc2V0LCBmYWxzZSlcbiAgfVxuICByZXR1cm4gb2Zmc2V0ICsgNFxufVxuXG5mdW5jdGlvbiBjaGVja0lFRUU3NTQgKGJ1ZiwgdmFsdWUsIG9mZnNldCwgZXh0LCBtYXgsIG1pbikge1xuICBpZiAodmFsdWUgPiBtYXggfHwgdmFsdWUgPCBtaW4pIHRocm93IG5ldyBSYW5nZUVycm9yKCd2YWx1ZSBpcyBvdXQgb2YgYm91bmRzJylcbiAgaWYgKG9mZnNldCArIGV4dCA+IGJ1Zi5sZW5ndGgpIHRocm93IG5ldyBSYW5nZUVycm9yKCdpbmRleCBvdXQgb2YgcmFuZ2UnKVxuICBpZiAob2Zmc2V0IDwgMCkgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ2luZGV4IG91dCBvZiByYW5nZScpXG59XG5cbmZ1bmN0aW9uIHdyaXRlRmxvYXQgKGJ1ZiwgdmFsdWUsIG9mZnNldCwgbGl0dGxlRW5kaWFuLCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSB7XG4gICAgY2hlY2tJRUVFNzU0KGJ1ZiwgdmFsdWUsIG9mZnNldCwgNCwgMy40MDI4MjM0NjYzODUyODg2ZSszOCwgLTMuNDAyODIzNDY2Mzg1Mjg4NmUrMzgpXG4gIH1cbiAgaWVlZTc1NC53cml0ZShidWYsIHZhbHVlLCBvZmZzZXQsIGxpdHRsZUVuZGlhbiwgMjMsIDQpXG4gIHJldHVybiBvZmZzZXQgKyA0XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVGbG9hdExFID0gZnVuY3Rpb24gd3JpdGVGbG9hdExFICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICByZXR1cm4gd3JpdGVGbG9hdCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCB0cnVlLCBub0Fzc2VydClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUZsb2F0QkUgPSBmdW5jdGlvbiB3cml0ZUZsb2F0QkUgKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHJldHVybiB3cml0ZUZsb2F0KHRoaXMsIHZhbHVlLCBvZmZzZXQsIGZhbHNlLCBub0Fzc2VydClcbn1cblxuZnVuY3Rpb24gd3JpdGVEb3VibGUgKGJ1ZiwgdmFsdWUsIG9mZnNldCwgbGl0dGxlRW5kaWFuLCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSB7XG4gICAgY2hlY2tJRUVFNzU0KGJ1ZiwgdmFsdWUsIG9mZnNldCwgOCwgMS43OTc2OTMxMzQ4NjIzMTU3RSszMDgsIC0xLjc5NzY5MzEzNDg2MjMxNTdFKzMwOClcbiAgfVxuICBpZWVlNzU0LndyaXRlKGJ1ZiwgdmFsdWUsIG9mZnNldCwgbGl0dGxlRW5kaWFuLCA1MiwgOClcbiAgcmV0dXJuIG9mZnNldCArIDhcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZURvdWJsZUxFID0gZnVuY3Rpb24gd3JpdGVEb3VibGVMRSAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgcmV0dXJuIHdyaXRlRG91YmxlKHRoaXMsIHZhbHVlLCBvZmZzZXQsIHRydWUsIG5vQXNzZXJ0KVxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlRG91YmxlQkUgPSBmdW5jdGlvbiB3cml0ZURvdWJsZUJFICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICByZXR1cm4gd3JpdGVEb3VibGUodGhpcywgdmFsdWUsIG9mZnNldCwgZmFsc2UsIG5vQXNzZXJ0KVxufVxuXG4vLyBjb3B5KHRhcmdldEJ1ZmZlciwgdGFyZ2V0U3RhcnQ9MCwgc291cmNlU3RhcnQ9MCwgc291cmNlRW5kPWJ1ZmZlci5sZW5ndGgpXG5CdWZmZXIucHJvdG90eXBlLmNvcHkgPSBmdW5jdGlvbiBjb3B5ICh0YXJnZXQsIHRhcmdldFN0YXJ0LCBzdGFydCwgZW5kKSB7XG4gIGlmICghc3RhcnQpIHN0YXJ0ID0gMFxuICBpZiAoIWVuZCAmJiBlbmQgIT09IDApIGVuZCA9IHRoaXMubGVuZ3RoXG4gIGlmICh0YXJnZXRTdGFydCA+PSB0YXJnZXQubGVuZ3RoKSB0YXJnZXRTdGFydCA9IHRhcmdldC5sZW5ndGhcbiAgaWYgKCF0YXJnZXRTdGFydCkgdGFyZ2V0U3RhcnQgPSAwXG4gIGlmIChlbmQgPiAwICYmIGVuZCA8IHN0YXJ0KSBlbmQgPSBzdGFydFxuXG4gIC8vIENvcHkgMCBieXRlczsgd2UncmUgZG9uZVxuICBpZiAoZW5kID09PSBzdGFydCkgcmV0dXJuIDBcbiAgaWYgKHRhcmdldC5sZW5ndGggPT09IDAgfHwgdGhpcy5sZW5ndGggPT09IDApIHJldHVybiAwXG5cbiAgLy8gRmF0YWwgZXJyb3IgY29uZGl0aW9uc1xuICBpZiAodGFyZ2V0U3RhcnQgPCAwKSB7XG4gICAgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ3RhcmdldFN0YXJ0IG91dCBvZiBib3VuZHMnKVxuICB9XG4gIGlmIChzdGFydCA8IDAgfHwgc3RhcnQgPj0gdGhpcy5sZW5ndGgpIHRocm93IG5ldyBSYW5nZUVycm9yKCdzb3VyY2VTdGFydCBvdXQgb2YgYm91bmRzJylcbiAgaWYgKGVuZCA8IDApIHRocm93IG5ldyBSYW5nZUVycm9yKCdzb3VyY2VFbmQgb3V0IG9mIGJvdW5kcycpXG5cbiAgLy8gQXJlIHdlIG9vYj9cbiAgaWYgKGVuZCA+IHRoaXMubGVuZ3RoKSBlbmQgPSB0aGlzLmxlbmd0aFxuICBpZiAodGFyZ2V0Lmxlbmd0aCAtIHRhcmdldFN0YXJ0IDwgZW5kIC0gc3RhcnQpIHtcbiAgICBlbmQgPSB0YXJnZXQubGVuZ3RoIC0gdGFyZ2V0U3RhcnQgKyBzdGFydFxuICB9XG5cbiAgdmFyIGxlbiA9IGVuZCAtIHN0YXJ0XG5cbiAgaWYgKGxlbiA8IDEwMDAgfHwgIUJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW47IGkrKykge1xuICAgICAgdGFyZ2V0W2kgKyB0YXJnZXRTdGFydF0gPSB0aGlzW2kgKyBzdGFydF1cbiAgICB9XG4gIH0gZWxzZSB7XG4gICAgdGFyZ2V0Ll9zZXQodGhpcy5zdWJhcnJheShzdGFydCwgc3RhcnQgKyBsZW4pLCB0YXJnZXRTdGFydClcbiAgfVxuXG4gIHJldHVybiBsZW5cbn1cblxuLy8gZmlsbCh2YWx1ZSwgc3RhcnQ9MCwgZW5kPWJ1ZmZlci5sZW5ndGgpXG5CdWZmZXIucHJvdG90eXBlLmZpbGwgPSBmdW5jdGlvbiBmaWxsICh2YWx1ZSwgc3RhcnQsIGVuZCkge1xuICBpZiAoIXZhbHVlKSB2YWx1ZSA9IDBcbiAgaWYgKCFzdGFydCkgc3RhcnQgPSAwXG4gIGlmICghZW5kKSBlbmQgPSB0aGlzLmxlbmd0aFxuXG4gIGlmIChlbmQgPCBzdGFydCkgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ2VuZCA8IHN0YXJ0JylcblxuICAvLyBGaWxsIDAgYnl0ZXM7IHdlJ3JlIGRvbmVcbiAgaWYgKGVuZCA9PT0gc3RhcnQpIHJldHVyblxuICBpZiAodGhpcy5sZW5ndGggPT09IDApIHJldHVyblxuXG4gIGlmIChzdGFydCA8IDAgfHwgc3RhcnQgPj0gdGhpcy5sZW5ndGgpIHRocm93IG5ldyBSYW5nZUVycm9yKCdzdGFydCBvdXQgb2YgYm91bmRzJylcbiAgaWYgKGVuZCA8IDAgfHwgZW5kID4gdGhpcy5sZW5ndGgpIHRocm93IG5ldyBSYW5nZUVycm9yKCdlbmQgb3V0IG9mIGJvdW5kcycpXG5cbiAgdmFyIGlcbiAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gJ251bWJlcicpIHtcbiAgICBmb3IgKGkgPSBzdGFydDsgaSA8IGVuZDsgaSsrKSB7XG4gICAgICB0aGlzW2ldID0gdmFsdWVcbiAgICB9XG4gIH0gZWxzZSB7XG4gICAgdmFyIGJ5dGVzID0gdXRmOFRvQnl0ZXModmFsdWUudG9TdHJpbmcoKSlcbiAgICB2YXIgbGVuID0gYnl0ZXMubGVuZ3RoXG4gICAgZm9yIChpID0gc3RhcnQ7IGkgPCBlbmQ7IGkrKykge1xuICAgICAgdGhpc1tpXSA9IGJ5dGVzW2kgJSBsZW5dXG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHRoaXNcbn1cblxuLyoqXG4gKiBDcmVhdGVzIGEgbmV3IGBBcnJheUJ1ZmZlcmAgd2l0aCB0aGUgKmNvcGllZCogbWVtb3J5IG9mIHRoZSBidWZmZXIgaW5zdGFuY2UuXG4gKiBBZGRlZCBpbiBOb2RlIDAuMTIuIE9ubHkgYXZhaWxhYmxlIGluIGJyb3dzZXJzIHRoYXQgc3VwcG9ydCBBcnJheUJ1ZmZlci5cbiAqL1xuQnVmZmVyLnByb3RvdHlwZS50b0FycmF5QnVmZmVyID0gZnVuY3Rpb24gdG9BcnJheUJ1ZmZlciAoKSB7XG4gIGlmICh0eXBlb2YgVWludDhBcnJheSAhPT0gJ3VuZGVmaW5lZCcpIHtcbiAgICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICAgIHJldHVybiAobmV3IEJ1ZmZlcih0aGlzKSkuYnVmZmVyXG4gICAgfSBlbHNlIHtcbiAgICAgIHZhciBidWYgPSBuZXcgVWludDhBcnJheSh0aGlzLmxlbmd0aClcbiAgICAgIGZvciAodmFyIGkgPSAwLCBsZW4gPSBidWYubGVuZ3RoOyBpIDwgbGVuOyBpICs9IDEpIHtcbiAgICAgICAgYnVmW2ldID0gdGhpc1tpXVxuICAgICAgfVxuICAgICAgcmV0dXJuIGJ1Zi5idWZmZXJcbiAgICB9XG4gIH0gZWxzZSB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcignQnVmZmVyLnRvQXJyYXlCdWZmZXIgbm90IHN1cHBvcnRlZCBpbiB0aGlzIGJyb3dzZXInKVxuICB9XG59XG5cbi8vIEhFTFBFUiBGVU5DVElPTlNcbi8vID09PT09PT09PT09PT09PT1cblxudmFyIEJQID0gQnVmZmVyLnByb3RvdHlwZVxuXG4vKipcbiAqIEF1Z21lbnQgYSBVaW50OEFycmF5ICppbnN0YW5jZSogKG5vdCB0aGUgVWludDhBcnJheSBjbGFzcyEpIHdpdGggQnVmZmVyIG1ldGhvZHNcbiAqL1xuQnVmZmVyLl9hdWdtZW50ID0gZnVuY3Rpb24gX2F1Z21lbnQgKGFycikge1xuICBhcnIuY29uc3RydWN0b3IgPSBCdWZmZXJcbiAgYXJyLl9pc0J1ZmZlciA9IHRydWVcblxuICAvLyBzYXZlIHJlZmVyZW5jZSB0byBvcmlnaW5hbCBVaW50OEFycmF5IHNldCBtZXRob2QgYmVmb3JlIG92ZXJ3cml0aW5nXG4gIGFyci5fc2V0ID0gYXJyLnNldFxuXG4gIC8vIGRlcHJlY2F0ZWQsIHdpbGwgYmUgcmVtb3ZlZCBpbiBub2RlIDAuMTMrXG4gIGFyci5nZXQgPSBCUC5nZXRcbiAgYXJyLnNldCA9IEJQLnNldFxuXG4gIGFyci53cml0ZSA9IEJQLndyaXRlXG4gIGFyci50b1N0cmluZyA9IEJQLnRvU3RyaW5nXG4gIGFyci50b0xvY2FsZVN0cmluZyA9IEJQLnRvU3RyaW5nXG4gIGFyci50b0pTT04gPSBCUC50b0pTT05cbiAgYXJyLmVxdWFscyA9IEJQLmVxdWFsc1xuICBhcnIuY29tcGFyZSA9IEJQLmNvbXBhcmVcbiAgYXJyLmluZGV4T2YgPSBCUC5pbmRleE9mXG4gIGFyci5jb3B5ID0gQlAuY29weVxuICBhcnIuc2xpY2UgPSBCUC5zbGljZVxuICBhcnIucmVhZFVJbnRMRSA9IEJQLnJlYWRVSW50TEVcbiAgYXJyLnJlYWRVSW50QkUgPSBCUC5yZWFkVUludEJFXG4gIGFyci5yZWFkVUludDggPSBCUC5yZWFkVUludDhcbiAgYXJyLnJlYWRVSW50MTZMRSA9IEJQLnJlYWRVSW50MTZMRVxuICBhcnIucmVhZFVJbnQxNkJFID0gQlAucmVhZFVJbnQxNkJFXG4gIGFyci5yZWFkVUludDMyTEUgPSBCUC5yZWFkVUludDMyTEVcbiAgYXJyLnJlYWRVSW50MzJCRSA9IEJQLnJlYWRVSW50MzJCRVxuICBhcnIucmVhZEludExFID0gQlAucmVhZEludExFXG4gIGFyci5yZWFkSW50QkUgPSBCUC5yZWFkSW50QkVcbiAgYXJyLnJlYWRJbnQ4ID0gQlAucmVhZEludDhcbiAgYXJyLnJlYWRJbnQxNkxFID0gQlAucmVhZEludDE2TEVcbiAgYXJyLnJlYWRJbnQxNkJFID0gQlAucmVhZEludDE2QkVcbiAgYXJyLnJlYWRJbnQzMkxFID0gQlAucmVhZEludDMyTEVcbiAgYXJyLnJlYWRJbnQzMkJFID0gQlAucmVhZEludDMyQkVcbiAgYXJyLnJlYWRGbG9hdExFID0gQlAucmVhZEZsb2F0TEVcbiAgYXJyLnJlYWRGbG9hdEJFID0gQlAucmVhZEZsb2F0QkVcbiAgYXJyLnJlYWREb3VibGVMRSA9IEJQLnJlYWREb3VibGVMRVxuICBhcnIucmVhZERvdWJsZUJFID0gQlAucmVhZERvdWJsZUJFXG4gIGFyci53cml0ZVVJbnQ4ID0gQlAud3JpdGVVSW50OFxuICBhcnIud3JpdGVVSW50TEUgPSBCUC53cml0ZVVJbnRMRVxuICBhcnIud3JpdGVVSW50QkUgPSBCUC53cml0ZVVJbnRCRVxuICBhcnIud3JpdGVVSW50MTZMRSA9IEJQLndyaXRlVUludDE2TEVcbiAgYXJyLndyaXRlVUludDE2QkUgPSBCUC53cml0ZVVJbnQxNkJFXG4gIGFyci53cml0ZVVJbnQzMkxFID0gQlAud3JpdGVVSW50MzJMRVxuICBhcnIud3JpdGVVSW50MzJCRSA9IEJQLndyaXRlVUludDMyQkVcbiAgYXJyLndyaXRlSW50TEUgPSBCUC53cml0ZUludExFXG4gIGFyci53cml0ZUludEJFID0gQlAud3JpdGVJbnRCRVxuICBhcnIud3JpdGVJbnQ4ID0gQlAud3JpdGVJbnQ4XG4gIGFyci53cml0ZUludDE2TEUgPSBCUC53cml0ZUludDE2TEVcbiAgYXJyLndyaXRlSW50MTZCRSA9IEJQLndyaXRlSW50MTZCRVxuICBhcnIud3JpdGVJbnQzMkxFID0gQlAud3JpdGVJbnQzMkxFXG4gIGFyci53cml0ZUludDMyQkUgPSBCUC53cml0ZUludDMyQkVcbiAgYXJyLndyaXRlRmxvYXRMRSA9IEJQLndyaXRlRmxvYXRMRVxuICBhcnIud3JpdGVGbG9hdEJFID0gQlAud3JpdGVGbG9hdEJFXG4gIGFyci53cml0ZURvdWJsZUxFID0gQlAud3JpdGVEb3VibGVMRVxuICBhcnIud3JpdGVEb3VibGVCRSA9IEJQLndyaXRlRG91YmxlQkVcbiAgYXJyLmZpbGwgPSBCUC5maWxsXG4gIGFyci5pbnNwZWN0ID0gQlAuaW5zcGVjdFxuICBhcnIudG9BcnJheUJ1ZmZlciA9IEJQLnRvQXJyYXlCdWZmZXJcblxuICByZXR1cm4gYXJyXG59XG5cbnZhciBJTlZBTElEX0JBU0U2NF9SRSA9IC9bXitcXC8wLTlBLXpcXC1dL2dcblxuZnVuY3Rpb24gYmFzZTY0Y2xlYW4gKHN0cikge1xuICAvLyBOb2RlIHN0cmlwcyBvdXQgaW52YWxpZCBjaGFyYWN0ZXJzIGxpa2UgXFxuIGFuZCBcXHQgZnJvbSB0aGUgc3RyaW5nLCBiYXNlNjQtanMgZG9lcyBub3RcbiAgc3RyID0gc3RyaW5ndHJpbShzdHIpLnJlcGxhY2UoSU5WQUxJRF9CQVNFNjRfUkUsICcnKVxuICAvLyBOb2RlIGNvbnZlcnRzIHN0cmluZ3Mgd2l0aCBsZW5ndGggPCAyIHRvICcnXG4gIGlmIChzdHIubGVuZ3RoIDwgMikgcmV0dXJuICcnXG4gIC8vIE5vZGUgYWxsb3dzIGZvciBub24tcGFkZGVkIGJhc2U2NCBzdHJpbmdzIChtaXNzaW5nIHRyYWlsaW5nID09PSksIGJhc2U2NC1qcyBkb2VzIG5vdFxuICB3aGlsZSAoc3RyLmxlbmd0aCAlIDQgIT09IDApIHtcbiAgICBzdHIgPSBzdHIgKyAnPSdcbiAgfVxuICByZXR1cm4gc3RyXG59XG5cbmZ1bmN0aW9uIHN0cmluZ3RyaW0gKHN0cikge1xuICBpZiAoc3RyLnRyaW0pIHJldHVybiBzdHIudHJpbSgpXG4gIHJldHVybiBzdHIucmVwbGFjZSgvXlxccyt8XFxzKyQvZywgJycpXG59XG5cbmZ1bmN0aW9uIHRvSGV4IChuKSB7XG4gIGlmIChuIDwgMTYpIHJldHVybiAnMCcgKyBuLnRvU3RyaW5nKDE2KVxuICByZXR1cm4gbi50b1N0cmluZygxNilcbn1cblxuZnVuY3Rpb24gdXRmOFRvQnl0ZXMgKHN0cmluZywgdW5pdHMpIHtcbiAgdW5pdHMgPSB1bml0cyB8fCBJbmZpbml0eVxuICB2YXIgY29kZVBvaW50XG4gIHZhciBsZW5ndGggPSBzdHJpbmcubGVuZ3RoXG4gIHZhciBsZWFkU3Vycm9nYXRlID0gbnVsbFxuICB2YXIgYnl0ZXMgPSBbXVxuICB2YXIgaSA9IDBcblxuICBmb3IgKDsgaSA8IGxlbmd0aDsgaSsrKSB7XG4gICAgY29kZVBvaW50ID0gc3RyaW5nLmNoYXJDb2RlQXQoaSlcblxuICAgIC8vIGlzIHN1cnJvZ2F0ZSBjb21wb25lbnRcbiAgICBpZiAoY29kZVBvaW50ID4gMHhEN0ZGICYmIGNvZGVQb2ludCA8IDB4RTAwMCkge1xuICAgICAgLy8gbGFzdCBjaGFyIHdhcyBhIGxlYWRcbiAgICAgIGlmIChsZWFkU3Vycm9nYXRlKSB7XG4gICAgICAgIC8vIDIgbGVhZHMgaW4gYSByb3dcbiAgICAgICAgaWYgKGNvZGVQb2ludCA8IDB4REMwMCkge1xuICAgICAgICAgIGlmICgodW5pdHMgLT0gMykgPiAtMSkgYnl0ZXMucHVzaCgweEVGLCAweEJGLCAweEJEKVxuICAgICAgICAgIGxlYWRTdXJyb2dhdGUgPSBjb2RlUG9pbnRcbiAgICAgICAgICBjb250aW51ZVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIC8vIHZhbGlkIHN1cnJvZ2F0ZSBwYWlyXG4gICAgICAgICAgY29kZVBvaW50ID0gbGVhZFN1cnJvZ2F0ZSAtIDB4RDgwMCA8PCAxMCB8IGNvZGVQb2ludCAtIDB4REMwMCB8IDB4MTAwMDBcbiAgICAgICAgICBsZWFkU3Vycm9nYXRlID0gbnVsbFxuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICAvLyBubyBsZWFkIHlldFxuXG4gICAgICAgIGlmIChjb2RlUG9pbnQgPiAweERCRkYpIHtcbiAgICAgICAgICAvLyB1bmV4cGVjdGVkIHRyYWlsXG4gICAgICAgICAgaWYgKCh1bml0cyAtPSAzKSA+IC0xKSBieXRlcy5wdXNoKDB4RUYsIDB4QkYsIDB4QkQpXG4gICAgICAgICAgY29udGludWVcbiAgICAgICAgfSBlbHNlIGlmIChpICsgMSA9PT0gbGVuZ3RoKSB7XG4gICAgICAgICAgLy8gdW5wYWlyZWQgbGVhZFxuICAgICAgICAgIGlmICgodW5pdHMgLT0gMykgPiAtMSkgYnl0ZXMucHVzaCgweEVGLCAweEJGLCAweEJEKVxuICAgICAgICAgIGNvbnRpbnVlXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgLy8gdmFsaWQgbGVhZFxuICAgICAgICAgIGxlYWRTdXJyb2dhdGUgPSBjb2RlUG9pbnRcbiAgICAgICAgICBjb250aW51ZVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfSBlbHNlIGlmIChsZWFkU3Vycm9nYXRlKSB7XG4gICAgICAvLyB2YWxpZCBibXAgY2hhciwgYnV0IGxhc3QgY2hhciB3YXMgYSBsZWFkXG4gICAgICBpZiAoKHVuaXRzIC09IDMpID4gLTEpIGJ5dGVzLnB1c2goMHhFRiwgMHhCRiwgMHhCRClcbiAgICAgIGxlYWRTdXJyb2dhdGUgPSBudWxsXG4gICAgfVxuXG4gICAgLy8gZW5jb2RlIHV0ZjhcbiAgICBpZiAoY29kZVBvaW50IDwgMHg4MCkge1xuICAgICAgaWYgKCh1bml0cyAtPSAxKSA8IDApIGJyZWFrXG4gICAgICBieXRlcy5wdXNoKGNvZGVQb2ludClcbiAgICB9IGVsc2UgaWYgKGNvZGVQb2ludCA8IDB4ODAwKSB7XG4gICAgICBpZiAoKHVuaXRzIC09IDIpIDwgMCkgYnJlYWtcbiAgICAgIGJ5dGVzLnB1c2goXG4gICAgICAgIGNvZGVQb2ludCA+PiAweDYgfCAweEMwLFxuICAgICAgICBjb2RlUG9pbnQgJiAweDNGIHwgMHg4MFxuICAgICAgKVxuICAgIH0gZWxzZSBpZiAoY29kZVBvaW50IDwgMHgxMDAwMCkge1xuICAgICAgaWYgKCh1bml0cyAtPSAzKSA8IDApIGJyZWFrXG4gICAgICBieXRlcy5wdXNoKFxuICAgICAgICBjb2RlUG9pbnQgPj4gMHhDIHwgMHhFMCxcbiAgICAgICAgY29kZVBvaW50ID4+IDB4NiAmIDB4M0YgfCAweDgwLFxuICAgICAgICBjb2RlUG9pbnQgJiAweDNGIHwgMHg4MFxuICAgICAgKVxuICAgIH0gZWxzZSBpZiAoY29kZVBvaW50IDwgMHgyMDAwMDApIHtcbiAgICAgIGlmICgodW5pdHMgLT0gNCkgPCAwKSBicmVha1xuICAgICAgYnl0ZXMucHVzaChcbiAgICAgICAgY29kZVBvaW50ID4+IDB4MTIgfCAweEYwLFxuICAgICAgICBjb2RlUG9pbnQgPj4gMHhDICYgMHgzRiB8IDB4ODAsXG4gICAgICAgIGNvZGVQb2ludCA+PiAweDYgJiAweDNGIHwgMHg4MCxcbiAgICAgICAgY29kZVBvaW50ICYgMHgzRiB8IDB4ODBcbiAgICAgIClcbiAgICB9IGVsc2Uge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdJbnZhbGlkIGNvZGUgcG9pbnQnKVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiBieXRlc1xufVxuXG5mdW5jdGlvbiBhc2NpaVRvQnl0ZXMgKHN0cikge1xuICB2YXIgYnl0ZUFycmF5ID0gW11cbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBzdHIubGVuZ3RoOyBpKyspIHtcbiAgICAvLyBOb2RlJ3MgY29kZSBzZWVtcyB0byBiZSBkb2luZyB0aGlzIGFuZCBub3QgJiAweDdGLi5cbiAgICBieXRlQXJyYXkucHVzaChzdHIuY2hhckNvZGVBdChpKSAmIDB4RkYpXG4gIH1cbiAgcmV0dXJuIGJ5dGVBcnJheVxufVxuXG5mdW5jdGlvbiB1dGYxNmxlVG9CeXRlcyAoc3RyLCB1bml0cykge1xuICB2YXIgYywgaGksIGxvXG4gIHZhciBieXRlQXJyYXkgPSBbXVxuICBmb3IgKHZhciBpID0gMDsgaSA8IHN0ci5sZW5ndGg7IGkrKykge1xuICAgIGlmICgodW5pdHMgLT0gMikgPCAwKSBicmVha1xuXG4gICAgYyA9IHN0ci5jaGFyQ29kZUF0KGkpXG4gICAgaGkgPSBjID4+IDhcbiAgICBsbyA9IGMgJSAyNTZcbiAgICBieXRlQXJyYXkucHVzaChsbylcbiAgICBieXRlQXJyYXkucHVzaChoaSlcbiAgfVxuXG4gIHJldHVybiBieXRlQXJyYXlcbn1cblxuZnVuY3Rpb24gYmFzZTY0VG9CeXRlcyAoc3RyKSB7XG4gIHJldHVybiBiYXNlNjQudG9CeXRlQXJyYXkoYmFzZTY0Y2xlYW4oc3RyKSlcbn1cblxuZnVuY3Rpb24gYmxpdEJ1ZmZlciAoc3JjLCBkc3QsIG9mZnNldCwgbGVuZ3RoKSB7XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuZ3RoOyBpKyspIHtcbiAgICBpZiAoKGkgKyBvZmZzZXQgPj0gZHN0Lmxlbmd0aCkgfHwgKGkgPj0gc3JjLmxlbmd0aCkpIGJyZWFrXG4gICAgZHN0W2kgKyBvZmZzZXRdID0gc3JjW2ldXG4gIH1cbiAgcmV0dXJuIGlcbn1cblxuZnVuY3Rpb24gZGVjb2RlVXRmOENoYXIgKHN0cikge1xuICB0cnkge1xuICAgIHJldHVybiBkZWNvZGVVUklDb21wb25lbnQoc3RyKVxuICB9IGNhdGNoIChlcnIpIHtcbiAgICByZXR1cm4gU3RyaW5nLmZyb21DaGFyQ29kZSgweEZGRkQpIC8vIFVURiA4IGludmFsaWQgY2hhclxuICB9XG59XG4iLCJ2YXIgbG9va3VwID0gJ0FCQ0RFRkdISUpLTE1OT1BRUlNUVVZXWFlaYWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXowMTIzNDU2Nzg5Ky8nO1xuXG47KGZ1bmN0aW9uIChleHBvcnRzKSB7XG5cdCd1c2Ugc3RyaWN0JztcblxuICB2YXIgQXJyID0gKHR5cGVvZiBVaW50OEFycmF5ICE9PSAndW5kZWZpbmVkJylcbiAgICA/IFVpbnQ4QXJyYXlcbiAgICA6IEFycmF5XG5cblx0dmFyIFBMVVMgICA9ICcrJy5jaGFyQ29kZUF0KDApXG5cdHZhciBTTEFTSCAgPSAnLycuY2hhckNvZGVBdCgwKVxuXHR2YXIgTlVNQkVSID0gJzAnLmNoYXJDb2RlQXQoMClcblx0dmFyIExPV0VSICA9ICdhJy5jaGFyQ29kZUF0KDApXG5cdHZhciBVUFBFUiAgPSAnQScuY2hhckNvZGVBdCgwKVxuXHR2YXIgUExVU19VUkxfU0FGRSA9ICctJy5jaGFyQ29kZUF0KDApXG5cdHZhciBTTEFTSF9VUkxfU0FGRSA9ICdfJy5jaGFyQ29kZUF0KDApXG5cblx0ZnVuY3Rpb24gZGVjb2RlIChlbHQpIHtcblx0XHR2YXIgY29kZSA9IGVsdC5jaGFyQ29kZUF0KDApXG5cdFx0aWYgKGNvZGUgPT09IFBMVVMgfHxcblx0XHQgICAgY29kZSA9PT0gUExVU19VUkxfU0FGRSlcblx0XHRcdHJldHVybiA2MiAvLyAnKydcblx0XHRpZiAoY29kZSA9PT0gU0xBU0ggfHxcblx0XHQgICAgY29kZSA9PT0gU0xBU0hfVVJMX1NBRkUpXG5cdFx0XHRyZXR1cm4gNjMgLy8gJy8nXG5cdFx0aWYgKGNvZGUgPCBOVU1CRVIpXG5cdFx0XHRyZXR1cm4gLTEgLy9ubyBtYXRjaFxuXHRcdGlmIChjb2RlIDwgTlVNQkVSICsgMTApXG5cdFx0XHRyZXR1cm4gY29kZSAtIE5VTUJFUiArIDI2ICsgMjZcblx0XHRpZiAoY29kZSA8IFVQUEVSICsgMjYpXG5cdFx0XHRyZXR1cm4gY29kZSAtIFVQUEVSXG5cdFx0aWYgKGNvZGUgPCBMT1dFUiArIDI2KVxuXHRcdFx0cmV0dXJuIGNvZGUgLSBMT1dFUiArIDI2XG5cdH1cblxuXHRmdW5jdGlvbiBiNjRUb0J5dGVBcnJheSAoYjY0KSB7XG5cdFx0dmFyIGksIGosIGwsIHRtcCwgcGxhY2VIb2xkZXJzLCBhcnJcblxuXHRcdGlmIChiNjQubGVuZ3RoICUgNCA+IDApIHtcblx0XHRcdHRocm93IG5ldyBFcnJvcignSW52YWxpZCBzdHJpbmcuIExlbmd0aCBtdXN0IGJlIGEgbXVsdGlwbGUgb2YgNCcpXG5cdFx0fVxuXG5cdFx0Ly8gdGhlIG51bWJlciBvZiBlcXVhbCBzaWducyAocGxhY2UgaG9sZGVycylcblx0XHQvLyBpZiB0aGVyZSBhcmUgdHdvIHBsYWNlaG9sZGVycywgdGhhbiB0aGUgdHdvIGNoYXJhY3RlcnMgYmVmb3JlIGl0XG5cdFx0Ly8gcmVwcmVzZW50IG9uZSBieXRlXG5cdFx0Ly8gaWYgdGhlcmUgaXMgb25seSBvbmUsIHRoZW4gdGhlIHRocmVlIGNoYXJhY3RlcnMgYmVmb3JlIGl0IHJlcHJlc2VudCAyIGJ5dGVzXG5cdFx0Ly8gdGhpcyBpcyBqdXN0IGEgY2hlYXAgaGFjayB0byBub3QgZG8gaW5kZXhPZiB0d2ljZVxuXHRcdHZhciBsZW4gPSBiNjQubGVuZ3RoXG5cdFx0cGxhY2VIb2xkZXJzID0gJz0nID09PSBiNjQuY2hhckF0KGxlbiAtIDIpID8gMiA6ICc9JyA9PT0gYjY0LmNoYXJBdChsZW4gLSAxKSA/IDEgOiAwXG5cblx0XHQvLyBiYXNlNjQgaXMgNC8zICsgdXAgdG8gdHdvIGNoYXJhY3RlcnMgb2YgdGhlIG9yaWdpbmFsIGRhdGFcblx0XHRhcnIgPSBuZXcgQXJyKGI2NC5sZW5ndGggKiAzIC8gNCAtIHBsYWNlSG9sZGVycylcblxuXHRcdC8vIGlmIHRoZXJlIGFyZSBwbGFjZWhvbGRlcnMsIG9ubHkgZ2V0IHVwIHRvIHRoZSBsYXN0IGNvbXBsZXRlIDQgY2hhcnNcblx0XHRsID0gcGxhY2VIb2xkZXJzID4gMCA/IGI2NC5sZW5ndGggLSA0IDogYjY0Lmxlbmd0aFxuXG5cdFx0dmFyIEwgPSAwXG5cblx0XHRmdW5jdGlvbiBwdXNoICh2KSB7XG5cdFx0XHRhcnJbTCsrXSA9IHZcblx0XHR9XG5cblx0XHRmb3IgKGkgPSAwLCBqID0gMDsgaSA8IGw7IGkgKz0gNCwgaiArPSAzKSB7XG5cdFx0XHR0bXAgPSAoZGVjb2RlKGI2NC5jaGFyQXQoaSkpIDw8IDE4KSB8IChkZWNvZGUoYjY0LmNoYXJBdChpICsgMSkpIDw8IDEyKSB8IChkZWNvZGUoYjY0LmNoYXJBdChpICsgMikpIDw8IDYpIHwgZGVjb2RlKGI2NC5jaGFyQXQoaSArIDMpKVxuXHRcdFx0cHVzaCgodG1wICYgMHhGRjAwMDApID4+IDE2KVxuXHRcdFx0cHVzaCgodG1wICYgMHhGRjAwKSA+PiA4KVxuXHRcdFx0cHVzaCh0bXAgJiAweEZGKVxuXHRcdH1cblxuXHRcdGlmIChwbGFjZUhvbGRlcnMgPT09IDIpIHtcblx0XHRcdHRtcCA9IChkZWNvZGUoYjY0LmNoYXJBdChpKSkgPDwgMikgfCAoZGVjb2RlKGI2NC5jaGFyQXQoaSArIDEpKSA+PiA0KVxuXHRcdFx0cHVzaCh0bXAgJiAweEZGKVxuXHRcdH0gZWxzZSBpZiAocGxhY2VIb2xkZXJzID09PSAxKSB7XG5cdFx0XHR0bXAgPSAoZGVjb2RlKGI2NC5jaGFyQXQoaSkpIDw8IDEwKSB8IChkZWNvZGUoYjY0LmNoYXJBdChpICsgMSkpIDw8IDQpIHwgKGRlY29kZShiNjQuY2hhckF0KGkgKyAyKSkgPj4gMilcblx0XHRcdHB1c2goKHRtcCA+PiA4KSAmIDB4RkYpXG5cdFx0XHRwdXNoKHRtcCAmIDB4RkYpXG5cdFx0fVxuXG5cdFx0cmV0dXJuIGFyclxuXHR9XG5cblx0ZnVuY3Rpb24gdWludDhUb0Jhc2U2NCAodWludDgpIHtcblx0XHR2YXIgaSxcblx0XHRcdGV4dHJhQnl0ZXMgPSB1aW50OC5sZW5ndGggJSAzLCAvLyBpZiB3ZSBoYXZlIDEgYnl0ZSBsZWZ0LCBwYWQgMiBieXRlc1xuXHRcdFx0b3V0cHV0ID0gXCJcIixcblx0XHRcdHRlbXAsIGxlbmd0aFxuXG5cdFx0ZnVuY3Rpb24gZW5jb2RlIChudW0pIHtcblx0XHRcdHJldHVybiBsb29rdXAuY2hhckF0KG51bSlcblx0XHR9XG5cblx0XHRmdW5jdGlvbiB0cmlwbGV0VG9CYXNlNjQgKG51bSkge1xuXHRcdFx0cmV0dXJuIGVuY29kZShudW0gPj4gMTggJiAweDNGKSArIGVuY29kZShudW0gPj4gMTIgJiAweDNGKSArIGVuY29kZShudW0gPj4gNiAmIDB4M0YpICsgZW5jb2RlKG51bSAmIDB4M0YpXG5cdFx0fVxuXG5cdFx0Ly8gZ28gdGhyb3VnaCB0aGUgYXJyYXkgZXZlcnkgdGhyZWUgYnl0ZXMsIHdlJ2xsIGRlYWwgd2l0aCB0cmFpbGluZyBzdHVmZiBsYXRlclxuXHRcdGZvciAoaSA9IDAsIGxlbmd0aCA9IHVpbnQ4Lmxlbmd0aCAtIGV4dHJhQnl0ZXM7IGkgPCBsZW5ndGg7IGkgKz0gMykge1xuXHRcdFx0dGVtcCA9ICh1aW50OFtpXSA8PCAxNikgKyAodWludDhbaSArIDFdIDw8IDgpICsgKHVpbnQ4W2kgKyAyXSlcblx0XHRcdG91dHB1dCArPSB0cmlwbGV0VG9CYXNlNjQodGVtcClcblx0XHR9XG5cblx0XHQvLyBwYWQgdGhlIGVuZCB3aXRoIHplcm9zLCBidXQgbWFrZSBzdXJlIHRvIG5vdCBmb3JnZXQgdGhlIGV4dHJhIGJ5dGVzXG5cdFx0c3dpdGNoIChleHRyYUJ5dGVzKSB7XG5cdFx0XHRjYXNlIDE6XG5cdFx0XHRcdHRlbXAgPSB1aW50OFt1aW50OC5sZW5ndGggLSAxXVxuXHRcdFx0XHRvdXRwdXQgKz0gZW5jb2RlKHRlbXAgPj4gMilcblx0XHRcdFx0b3V0cHV0ICs9IGVuY29kZSgodGVtcCA8PCA0KSAmIDB4M0YpXG5cdFx0XHRcdG91dHB1dCArPSAnPT0nXG5cdFx0XHRcdGJyZWFrXG5cdFx0XHRjYXNlIDI6XG5cdFx0XHRcdHRlbXAgPSAodWludDhbdWludDgubGVuZ3RoIC0gMl0gPDwgOCkgKyAodWludDhbdWludDgubGVuZ3RoIC0gMV0pXG5cdFx0XHRcdG91dHB1dCArPSBlbmNvZGUodGVtcCA+PiAxMClcblx0XHRcdFx0b3V0cHV0ICs9IGVuY29kZSgodGVtcCA+PiA0KSAmIDB4M0YpXG5cdFx0XHRcdG91dHB1dCArPSBlbmNvZGUoKHRlbXAgPDwgMikgJiAweDNGKVxuXHRcdFx0XHRvdXRwdXQgKz0gJz0nXG5cdFx0XHRcdGJyZWFrXG5cdFx0fVxuXG5cdFx0cmV0dXJuIG91dHB1dFxuXHR9XG5cblx0ZXhwb3J0cy50b0J5dGVBcnJheSA9IGI2NFRvQnl0ZUFycmF5XG5cdGV4cG9ydHMuZnJvbUJ5dGVBcnJheSA9IHVpbnQ4VG9CYXNlNjRcbn0odHlwZW9mIGV4cG9ydHMgPT09ICd1bmRlZmluZWQnID8gKHRoaXMuYmFzZTY0anMgPSB7fSkgOiBleHBvcnRzKSlcbiIsImV4cG9ydHMucmVhZCA9IGZ1bmN0aW9uIChidWZmZXIsIG9mZnNldCwgaXNMRSwgbUxlbiwgbkJ5dGVzKSB7XG4gIHZhciBlLCBtXG4gIHZhciBlTGVuID0gbkJ5dGVzICogOCAtIG1MZW4gLSAxXG4gIHZhciBlTWF4ID0gKDEgPDwgZUxlbikgLSAxXG4gIHZhciBlQmlhcyA9IGVNYXggPj4gMVxuICB2YXIgbkJpdHMgPSAtN1xuICB2YXIgaSA9IGlzTEUgPyAobkJ5dGVzIC0gMSkgOiAwXG4gIHZhciBkID0gaXNMRSA/IC0xIDogMVxuICB2YXIgcyA9IGJ1ZmZlcltvZmZzZXQgKyBpXVxuXG4gIGkgKz0gZFxuXG4gIGUgPSBzICYgKCgxIDw8ICgtbkJpdHMpKSAtIDEpXG4gIHMgPj49ICgtbkJpdHMpXG4gIG5CaXRzICs9IGVMZW5cbiAgZm9yICg7IG5CaXRzID4gMDsgZSA9IGUgKiAyNTYgKyBidWZmZXJbb2Zmc2V0ICsgaV0sIGkgKz0gZCwgbkJpdHMgLT0gOCkge31cblxuICBtID0gZSAmICgoMSA8PCAoLW5CaXRzKSkgLSAxKVxuICBlID4+PSAoLW5CaXRzKVxuICBuQml0cyArPSBtTGVuXG4gIGZvciAoOyBuQml0cyA+IDA7IG0gPSBtICogMjU2ICsgYnVmZmVyW29mZnNldCArIGldLCBpICs9IGQsIG5CaXRzIC09IDgpIHt9XG5cbiAgaWYgKGUgPT09IDApIHtcbiAgICBlID0gMSAtIGVCaWFzXG4gIH0gZWxzZSBpZiAoZSA9PT0gZU1heCkge1xuICAgIHJldHVybiBtID8gTmFOIDogKChzID8gLTEgOiAxKSAqIEluZmluaXR5KVxuICB9IGVsc2Uge1xuICAgIG0gPSBtICsgTWF0aC5wb3coMiwgbUxlbilcbiAgICBlID0gZSAtIGVCaWFzXG4gIH1cbiAgcmV0dXJuIChzID8gLTEgOiAxKSAqIG0gKiBNYXRoLnBvdygyLCBlIC0gbUxlbilcbn1cblxuZXhwb3J0cy53cml0ZSA9IGZ1bmN0aW9uIChidWZmZXIsIHZhbHVlLCBvZmZzZXQsIGlzTEUsIG1MZW4sIG5CeXRlcykge1xuICB2YXIgZSwgbSwgY1xuICB2YXIgZUxlbiA9IG5CeXRlcyAqIDggLSBtTGVuIC0gMVxuICB2YXIgZU1heCA9ICgxIDw8IGVMZW4pIC0gMVxuICB2YXIgZUJpYXMgPSBlTWF4ID4+IDFcbiAgdmFyIHJ0ID0gKG1MZW4gPT09IDIzID8gTWF0aC5wb3coMiwgLTI0KSAtIE1hdGgucG93KDIsIC03NykgOiAwKVxuICB2YXIgaSA9IGlzTEUgPyAwIDogKG5CeXRlcyAtIDEpXG4gIHZhciBkID0gaXNMRSA/IDEgOiAtMVxuICB2YXIgcyA9IHZhbHVlIDwgMCB8fCAodmFsdWUgPT09IDAgJiYgMSAvIHZhbHVlIDwgMCkgPyAxIDogMFxuXG4gIHZhbHVlID0gTWF0aC5hYnModmFsdWUpXG5cbiAgaWYgKGlzTmFOKHZhbHVlKSB8fCB2YWx1ZSA9PT0gSW5maW5pdHkpIHtcbiAgICBtID0gaXNOYU4odmFsdWUpID8gMSA6IDBcbiAgICBlID0gZU1heFxuICB9IGVsc2Uge1xuICAgIGUgPSBNYXRoLmZsb29yKE1hdGgubG9nKHZhbHVlKSAvIE1hdGguTE4yKVxuICAgIGlmICh2YWx1ZSAqIChjID0gTWF0aC5wb3coMiwgLWUpKSA8IDEpIHtcbiAgICAgIGUtLVxuICAgICAgYyAqPSAyXG4gICAgfVxuICAgIGlmIChlICsgZUJpYXMgPj0gMSkge1xuICAgICAgdmFsdWUgKz0gcnQgLyBjXG4gICAgfSBlbHNlIHtcbiAgICAgIHZhbHVlICs9IHJ0ICogTWF0aC5wb3coMiwgMSAtIGVCaWFzKVxuICAgIH1cbiAgICBpZiAodmFsdWUgKiBjID49IDIpIHtcbiAgICAgIGUrK1xuICAgICAgYyAvPSAyXG4gICAgfVxuXG4gICAgaWYgKGUgKyBlQmlhcyA+PSBlTWF4KSB7XG4gICAgICBtID0gMFxuICAgICAgZSA9IGVNYXhcbiAgICB9IGVsc2UgaWYgKGUgKyBlQmlhcyA+PSAxKSB7XG4gICAgICBtID0gKHZhbHVlICogYyAtIDEpICogTWF0aC5wb3coMiwgbUxlbilcbiAgICAgIGUgPSBlICsgZUJpYXNcbiAgICB9IGVsc2Uge1xuICAgICAgbSA9IHZhbHVlICogTWF0aC5wb3coMiwgZUJpYXMgLSAxKSAqIE1hdGgucG93KDIsIG1MZW4pXG4gICAgICBlID0gMFxuICAgIH1cbiAgfVxuXG4gIGZvciAoOyBtTGVuID49IDg7IGJ1ZmZlcltvZmZzZXQgKyBpXSA9IG0gJiAweGZmLCBpICs9IGQsIG0gLz0gMjU2LCBtTGVuIC09IDgpIHt9XG5cbiAgZSA9IChlIDw8IG1MZW4pIHwgbVxuICBlTGVuICs9IG1MZW5cbiAgZm9yICg7IGVMZW4gPiAwOyBidWZmZXJbb2Zmc2V0ICsgaV0gPSBlICYgMHhmZiwgaSArPSBkLCBlIC89IDI1NiwgZUxlbiAtPSA4KSB7fVxuXG4gIGJ1ZmZlcltvZmZzZXQgKyBpIC0gZF0gfD0gcyAqIDEyOFxufVxuIiwiXG4vKipcbiAqIGlzQXJyYXlcbiAqL1xuXG52YXIgaXNBcnJheSA9IEFycmF5LmlzQXJyYXk7XG5cbi8qKlxuICogdG9TdHJpbmdcbiAqL1xuXG52YXIgc3RyID0gT2JqZWN0LnByb3RvdHlwZS50b1N0cmluZztcblxuLyoqXG4gKiBXaGV0aGVyIG9yIG5vdCB0aGUgZ2l2ZW4gYHZhbGBcbiAqIGlzIGFuIGFycmF5LlxuICpcbiAqIGV4YW1wbGU6XG4gKlxuICogICAgICAgIGlzQXJyYXkoW10pO1xuICogICAgICAgIC8vID4gdHJ1ZVxuICogICAgICAgIGlzQXJyYXkoYXJndW1lbnRzKTtcbiAqICAgICAgICAvLyA+IGZhbHNlXG4gKiAgICAgICAgaXNBcnJheSgnJyk7XG4gKiAgICAgICAgLy8gPiBmYWxzZVxuICpcbiAqIEBwYXJhbSB7bWl4ZWR9IHZhbFxuICogQHJldHVybiB7Ym9vbH1cbiAqL1xuXG5tb2R1bGUuZXhwb3J0cyA9IGlzQXJyYXkgfHwgZnVuY3Rpb24gKHZhbCkge1xuICByZXR1cm4gISEgdmFsICYmICdbb2JqZWN0IEFycmF5XScgPT0gc3RyLmNhbGwodmFsKTtcbn07XG4iLCIvLyBzaGltIGZvciB1c2luZyBwcm9jZXNzIGluIGJyb3dzZXJcblxudmFyIHByb2Nlc3MgPSBtb2R1bGUuZXhwb3J0cyA9IHt9O1xudmFyIHF1ZXVlID0gW107XG52YXIgZHJhaW5pbmcgPSBmYWxzZTtcbnZhciBjdXJyZW50UXVldWU7XG52YXIgcXVldWVJbmRleCA9IC0xO1xuXG5mdW5jdGlvbiBjbGVhblVwTmV4dFRpY2soKSB7XG4gICAgZHJhaW5pbmcgPSBmYWxzZTtcbiAgICBpZiAoY3VycmVudFF1ZXVlLmxlbmd0aCkge1xuICAgICAgICBxdWV1ZSA9IGN1cnJlbnRRdWV1ZS5jb25jYXQocXVldWUpO1xuICAgIH0gZWxzZSB7XG4gICAgICAgIHF1ZXVlSW5kZXggPSAtMTtcbiAgICB9XG4gICAgaWYgKHF1ZXVlLmxlbmd0aCkge1xuICAgICAgICBkcmFpblF1ZXVlKCk7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBkcmFpblF1ZXVlKCkge1xuICAgIGlmIChkcmFpbmluZykge1xuICAgICAgICByZXR1cm47XG4gICAgfVxuICAgIHZhciB0aW1lb3V0ID0gc2V0VGltZW91dChjbGVhblVwTmV4dFRpY2spO1xuICAgIGRyYWluaW5nID0gdHJ1ZTtcblxuICAgIHZhciBsZW4gPSBxdWV1ZS5sZW5ndGg7XG4gICAgd2hpbGUobGVuKSB7XG4gICAgICAgIGN1cnJlbnRRdWV1ZSA9IHF1ZXVlO1xuICAgICAgICBxdWV1ZSA9IFtdO1xuICAgICAgICB3aGlsZSAoKytxdWV1ZUluZGV4IDwgbGVuKSB7XG4gICAgICAgICAgICBjdXJyZW50UXVldWVbcXVldWVJbmRleF0ucnVuKCk7XG4gICAgICAgIH1cbiAgICAgICAgcXVldWVJbmRleCA9IC0xO1xuICAgICAgICBsZW4gPSBxdWV1ZS5sZW5ndGg7XG4gICAgfVxuICAgIGN1cnJlbnRRdWV1ZSA9IG51bGw7XG4gICAgZHJhaW5pbmcgPSBmYWxzZTtcbiAgICBjbGVhclRpbWVvdXQodGltZW91dCk7XG59XG5cbnByb2Nlc3MubmV4dFRpY2sgPSBmdW5jdGlvbiAoZnVuKSB7XG4gICAgdmFyIGFyZ3MgPSBuZXcgQXJyYXkoYXJndW1lbnRzLmxlbmd0aCAtIDEpO1xuICAgIGlmIChhcmd1bWVudHMubGVuZ3RoID4gMSkge1xuICAgICAgICBmb3IgKHZhciBpID0gMTsgaSA8IGFyZ3VtZW50cy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgYXJnc1tpIC0gMV0gPSBhcmd1bWVudHNbaV07XG4gICAgICAgIH1cbiAgICB9XG4gICAgcXVldWUucHVzaChuZXcgSXRlbShmdW4sIGFyZ3MpKTtcbiAgICBpZiAocXVldWUubGVuZ3RoID09PSAxICYmICFkcmFpbmluZykge1xuICAgICAgICBzZXRUaW1lb3V0KGRyYWluUXVldWUsIDApO1xuICAgIH1cbn07XG5cbi8vIHY4IGxpa2VzIHByZWRpY3RpYmxlIG9iamVjdHNcbmZ1bmN0aW9uIEl0ZW0oZnVuLCBhcnJheSkge1xuICAgIHRoaXMuZnVuID0gZnVuO1xuICAgIHRoaXMuYXJyYXkgPSBhcnJheTtcbn1cbkl0ZW0ucHJvdG90eXBlLnJ1biA9IGZ1bmN0aW9uICgpIHtcbiAgICB0aGlzLmZ1bi5hcHBseShudWxsLCB0aGlzLmFycmF5KTtcbn07XG5wcm9jZXNzLnRpdGxlID0gJ2Jyb3dzZXInO1xucHJvY2Vzcy5icm93c2VyID0gdHJ1ZTtcbnByb2Nlc3MuZW52ID0ge307XG5wcm9jZXNzLmFyZ3YgPSBbXTtcbnByb2Nlc3MudmVyc2lvbiA9ICcnOyAvLyBlbXB0eSBzdHJpbmcgdG8gYXZvaWQgcmVnZXhwIGlzc3Vlc1xucHJvY2Vzcy52ZXJzaW9ucyA9IHt9O1xuXG5mdW5jdGlvbiBub29wKCkge31cblxucHJvY2Vzcy5vbiA9IG5vb3A7XG5wcm9jZXNzLmFkZExpc3RlbmVyID0gbm9vcDtcbnByb2Nlc3Mub25jZSA9IG5vb3A7XG5wcm9jZXNzLm9mZiA9IG5vb3A7XG5wcm9jZXNzLnJlbW92ZUxpc3RlbmVyID0gbm9vcDtcbnByb2Nlc3MucmVtb3ZlQWxsTGlzdGVuZXJzID0gbm9vcDtcbnByb2Nlc3MuZW1pdCA9IG5vb3A7XG5cbnByb2Nlc3MuYmluZGluZyA9IGZ1bmN0aW9uIChuYW1lKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdwcm9jZXNzLmJpbmRpbmcgaXMgbm90IHN1cHBvcnRlZCcpO1xufTtcblxuLy8gVE9ETyhzaHR5bG1hbilcbnByb2Nlc3MuY3dkID0gZnVuY3Rpb24gKCkgeyByZXR1cm4gJy8nIH07XG5wcm9jZXNzLmNoZGlyID0gZnVuY3Rpb24gKGRpcikge1xuICAgIHRocm93IG5ldyBFcnJvcigncHJvY2Vzcy5jaGRpciBpcyBub3Qgc3VwcG9ydGVkJyk7XG59O1xucHJvY2Vzcy51bWFzayA9IGZ1bmN0aW9uKCkgeyByZXR1cm4gMDsgfTtcbiIsInJlcXVpcmUoJy4vVHJhY2snKTtcclxucmVxdWlyZSgnLi9HVUknKTtcclxucmVxdWlyZSgnLi9QYXJ0aWNpcGFudCcpO1xyXG53aW5kb3cuQ09ORklHPXJlcXVpcmUoJy4vQ29uZmlnJyk7XHJcbnZhciBTVFlMRVM9cmVxdWlyZSgnLi9TdHlsZXMnKTtcclxudmFyIFV0aWxzPXJlcXVpcmUoJy4vVXRpbHMnKTtcclxuZm9yICh2YXIgZSBpbiBVdGlscykgXHJcblx0d2luZG93W2VdPVV0aWxzW2VdO1xyXG5cclxudmFyIGRyYXc7XHJcbnZhciBtb2RpZnk7XHJcbnZhciBzZWxlY3Q7XHJcblxyXG53aW5kb3cuVFJBQ0sgPSBuZXcgVHJhY2soKTtcclxud2luZG93LkdVSSA9IG5ldyBHdWkoXHJcbntcclxuXHRcdHRyYWNrXHRcdDogVFJBQ0ssXHJcblx0XHRpbml0aWFsWm9vbSA6IDJcclxuXHRcdC8vaW5pdGlhbFBvcyAgOiBbbG9uLGxhdF0sXHJcbn0pO1xyXG5cclxuZnVuY3Rpb24gZXJyb3JSb3V0ZShlcnIpIHtcclxuXHRHVUkuc2hvd0Vycm9yKGVycik7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGluaXRHVUkoKSBcclxue1xyXG5cdGlmIChHVUkuaXNfaW5pdCkge1xyXG5cdFx0c2VsZWN0LmdldEZlYXR1cmVzKCkuY2xlYXIoKTtcclxuXHRcdHJldHVybjtcclxuXHR9XHJcblx0R1VJLmlzX2luaXQ9MTtcclxuXHRHVUkuaW5pdCh7c2tpcEV4dGVudDp0cnVlfSk7XHJcblx0Ly8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0ZnVuY3Rpb24gc3RvcmUoZm9yY2VDbG9zZSxlKSBcclxuXHR7XHJcblx0XHR2YXIgZmVhdDtcclxuXHRcdGlmICghR1VJLmdldFRyYWNrTGF5ZXIoKS5nZXRTb3VyY2UoKS5nZXRGZWF0dXJlcygpLmxlbmd0aCkge1xyXG5cdFx0XHRpZiAoZSAmJiBlLmZlYXR1cmUpIHtcclxuXHRcdFx0XHRmZWF0PWUuZmVhdHVyZTsgICAgXHJcblx0XHRcdH0gZWxzZSB7XHJcblx0XHRcdFx0cmV0dXJuIG51bGw7XHJcblx0XHRcdH1cclxuXHRcdH0gZWxzZSB7XHJcblx0XHRcdGZlYXQgPSBHVUkuZ2V0VHJhY2tMYXllcigpLmdldFNvdXJjZSgpLmdldEZlYXR1cmVzKClbMF07XHJcblx0XHR9XHJcblx0XHR2YXIgdHJhY2tEYXRhPWZlYXQuZ2V0R2VvbWV0cnkoKS5nZXRDb29yZGluYXRlcygpO1xyXG5cdFx0aWYgKGZvcmNlQ2xvc2UpIFxyXG5cdFx0e1xyXG5cdFx0XHRpZiAodHJhY2tEYXRhWzBdWzBdICE9IHRyYWNrRGF0YVt0cmFja0RhdGEubGVuZ3RoLTFdWzBdIHx8IHRyYWNrRGF0YVswXVsxXSAhPSB0cmFja0RhdGFbdHJhY2tEYXRhLmxlbmd0aC0xXVsxXSkge1xyXG5cdFx0XHRcdHRyYWNrRGF0YS5wdXNoKHRyYWNrRGF0YVswXSk7XHJcblx0XHRcdFx0ZmVhdC5nZXRHZW9tZXRyeSgpLnNldENvb3JkaW5hdGVzKHRyYWNrRGF0YSk7XHJcblx0XHRcdH1cclxuXHRcdH1cclxuXHRcdGZvciAodmFyIGk9MDtpPHRyYWNrRGF0YS5sZW5ndGg7aSsrKVxyXG5cdFx0XHR0cmFja0RhdGFbaV09b2wucHJvai50cmFuc2Zvcm0odHJhY2tEYXRhW2ldLCAnRVBTRzozODU3JywnRVBTRzo0MzI2Jyk7XHRcdFx0XHJcblx0XHQkKFwiI3JvdXRlX3RleHRfYXJlYVwiKS52YWwoSlNPTi5zdHJpbmdpZnkodHJhY2tEYXRhKSk7XHJcblxyXG5cdFx0VFJBQ0suc2V0Um91dGUodHJhY2tEYXRhKTtcclxuXHRcdFRSQUNLLnVwZGF0ZUZlYXR1cmUoKTtcclxuXHRcdEdVSS50cmFja0xheWVyLmdldFNvdXJjZSgpLmNsZWFyKCk7XHJcblx0XHRHVUkuYWRkVHJhY2tGZWF0dXJlKCk7XHJcblx0XHRcclxuXHRcdHZhciBzdHIgPSAoVFJBQ0suZ2V0VHJhY2tMZW5ndGgoKS8xMDAwLjApK1wiIGttXCI7XHJcblx0XHQkKFwiI3JvdXRlX2luZm9cIikudmFsKHN0cik7XHJcblx0XHRyZXR1cm4gSlNPTi5zdHJpbmdpZnkodHJhY2tEYXRhKTtcclxuXHR9XHJcblx0Ly8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0c2VsZWN0ID0gbmV3IG9sLmludGVyYWN0aW9uLlNlbGVjdCh7XHJcblx0XHRzdHlsZTogU1RZTEVTW1widHJhY2tzZWxlY3RlZFwiXSxcclxuXHRcdGxheWVyczogW0dVSS50cmFja0xheWVyXVxyXG5cdH0pO1xyXG5cdG1vZGlmeSA9IG5ldyBvbC5pbnRlcmFjdGlvbi5Nb2RpZnkoe1xyXG5cdFx0ZmVhdHVyZXM6IHNlbGVjdC5nZXRGZWF0dXJlcygpLFxyXG5cdFx0bGF5ZXJzOiBbR1VJLnRyYWNrTGF5ZXJdXHJcblx0fSk7XHJcblx0Ly8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0ZHJhdyA9IG5ldyBvbC5pbnRlcmFjdGlvbi5EcmF3KHtcclxuXHQgICAgICBzb3VyY2U6IEdVSS50cmFja0xheWVyLmdldFNvdXJjZSgpLFxyXG5cdCAgICAgIHR5cGU6IFwiTGluZVN0cmluZ1wiXHJcblx0fSk7XHJcblx0ZHJhdy5vbignZHJhd3N0YXJ0JywgZnVuY3Rpb24oZSkge1xyXG5cdFx0R1VJLnRyYWNrTGF5ZXIuZ2V0U291cmNlKCkuY2xlYXIoKTtcclxuXHR9KTtcclxuXHRkcmF3Lm9uKCdkcmF3ZW5kJywgZnVuY3Rpb24oZSkge1xyXG5cdFx0R1VJLm1hcC5yZW1vdmVJbnRlcmFjdGlvbihkcmF3KTtcclxuXHRcdEdVSS5tYXAuYWRkSW50ZXJhY3Rpb24oc2VsZWN0KTtcclxuXHRcdEdVSS5tYXAuYWRkSW50ZXJhY3Rpb24obW9kaWZ5KTtcclxuXHRcdHN0b3JlKGZhbHNlLGUpO1xyXG5cdFx0Ly8gUE9TVCBDTEVBTlVQIE9GIERPQkxFIEZFQVRVUkUgKG9uIGRyYXcgc3VibWl0KVxyXG5cdFx0c2V0VGltZW91dChmdW5jdGlvbigpIFxyXG5cdFx0e1xyXG5cdFx0XHR2YXIgZmVhdHMgPSBHVUkudHJhY2tMYXllci5nZXRTb3VyY2UoKS5nZXRGZWF0dXJlcygpO1xyXG5cdFx0XHR2YXIgdG9kZWw9W107XHJcblx0XHRcdGZvciAodmFyIGkgaW4gZmVhdHMpIHtcclxuXHRcdFx0XHR2YXIgZmVhdCA9IGZlYXRzW2ldO1xyXG5cdFx0XHRcdGlmICghZmVhdC50cmFjaykge1xyXG5cdFx0XHRcdFx0dG9kZWwucHVzaChmZWF0KTtcclxuXHRcdFx0XHR9XHJcblx0XHRcdH1cclxuXHRcdFx0Zm9yICh2YXIgaSBpbiB0b2RlbCkge1xyXG5cdFx0XHRcdHZhciBmZWF0ID0gdG9kZWxbaV07XHJcblx0XHRcdFx0R1VJLnRyYWNrTGF5ZXIuZ2V0U291cmNlKCkucmVtb3ZlRmVhdHVyZShmZWF0KTtcclxuXHRcdFx0fVxyXG5cdFx0fSwwKTtcclxuXHR9KTtcclxuXHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRHVUkubWFwLnJlbW92ZUludGVyYWN0aW9uKHNlbGVjdCk7XHJcblx0R1VJLm1hcC5yZW1vdmVJbnRlcmFjdGlvbihtb2RpZnkpO1xyXG5cdEdVSS5tYXAuYWRkSW50ZXJhY3Rpb24oZHJhdyk7XHJcblx0Ly8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0JChcIiNidXR0b25fZXJhc2VcIikuY2xpY2soZnVuY3Rpb24oKXtcclxuXHRcdEdVSS50cmFja0xheWVyLmdldFNvdXJjZSgpLmNsZWFyKCk7XHJcblx0XHRzZWxlY3QuZ2V0RmVhdHVyZXMoKS5jbGVhcigpO1xyXG5cdFx0R1VJLm1hcC5yZW1vdmVJbnRlcmFjdGlvbihzZWxlY3QpO1xyXG5cdFx0R1VJLm1hcC5yZW1vdmVJbnRlcmFjdGlvbihtb2RpZnkpO1xyXG5cdFx0R1VJLm1hcC5hZGRJbnRlcmFjdGlvbihkcmF3KTtcclxuXHRcdHN0b3JlKCk7XHJcblx0XHRHVUkuZ2V0VHJhY2tMYXllcigpLmdldFNvdXJjZSgpLmNsZWFyKClcclxuXHRcdGRlbGV0ZSBUUkFDSy5mZWF0dXJlO1xyXG5cdH0pO1xyXG5cdCQoXCIjYnV0dG9uX25hdmlnYXRlXCIpLmNsaWNrKGZ1bmN0aW9uKCl7XHJcblx0XHRUUkFDSy5nZW5lcmF0ZUZyb21Mb2NhdGlvbnMoVFJBQ0suZ2V0Um91dGUoKSxmdW5jdGlvbigpIHtcclxuXHRcdFx0VFJBQ0sudXBkYXRlRmVhdHVyZSgpO1xyXG5cdFx0XHRzdG9yZSgpO1xyXG5cdFx0fSxmdW5jdGlvbihtc2cpIHtcclxuXHRcdFx0R1VJLnNob3dFcnJvcihtc2cpO1xyXG5cdFx0fSx0cnVlKTtcdFx0XHRcclxuXHR9KTtcclxuXHQkKFwiI2J1dHRvbl9qb2luXCIpLmNsaWNrKGZ1bmN0aW9uKCkge1xyXG5cdFx0c3RvcmUodHJ1ZSk7XHJcblx0fSk7XHJcblx0JChcIiNidXR0b25fc3VibWl0XCIpLmNsaWNrKGZ1bmN0aW9uKCkge1xyXG5cdFx0dmFyIGRhdGEgPSBzdG9yZSgpO1xyXG5cdFx0R1VJLm9uRWRpdFNhdmUoZGF0YSk7XHRcdFx0XHJcblx0XHQkKFwiLmZ3LWNvbnRhaW5lclwiKS5jc3MoXCJkaXNwbGF5XCIsXCJibG9ja1wiKTtcclxuXHR9KTtcclxuXHQkKFwiI2J1dHRvbl9jYW5jZWxcIikuY2xpY2soZnVuY3Rpb24oKSB7XHJcblx0XHQkKFwiI21hcFwiKS5jc3MoXCJkaXNwbGF5XCIsXCJub25lXCIpO1xyXG5cdFx0JChcIi5mdy1jb250YWluZXJcIikuY3NzKFwiZGlzcGxheVwiLFwiYmxvY2tcIik7XHJcblx0fSk7XHJcbn1cclxuLy8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcbmZ1bmN0aW9uIG1hcEVkaXQoaWQsanNvbix2YWxCaWtlU3RhcnQsdmFsUnVuU3RhcnQsb25TdWJtaXQpIFxyXG57XHRcdFxyXG5cdC8vY29uc29sZS5sb2coXCJJRCA6IFwiK2lkK1wiIHwgSlNPTiA6IFwiK2pzb24pO1xyXG5cdCQoXCIuZnctY29udGFpbmVyXCIpLmNzcyhcImRpc3BsYXlcIixcIm5vbmVcIik7XHJcblx0JChcIiNtYXBcIikuY3NzKFwiZGlzcGxheVwiLFwiYmxvY2tcIik7XHJcblx0aW5pdEdVSSgpO1xyXG5cdEdVSS50cmFja0xheWVyLmdldFNvdXJjZSgpLmNsZWFyKCk7XHJcblx0dmFyIHRyYWNrRGF0YTtcclxuXHR0cnkge1xyXG5cdFx0dHJhY2tEYXRhID0gSlNPTi5wYXJzZShqc29uKTtcclxuXHR9IGNhdGNoIChlKSB7XHJcblx0XHRjb25zb2xlLmxvZyhcIlVuYWJsZSB0byBkbyBtYXBFZGl0IGZvciBcIitqc29uKTtcclxuXHRcdHRyYWNrRGF0YT1bXTtcclxuXHR9XHRcdFxyXG5cdFRSQUNLLnNldFJvdXRlKHRyYWNrRGF0YSk7XHJcblx0VFJBQ0suYmlrZVN0YXJ0S009cGFyc2VGbG9hdCh2YWxCaWtlU3RhcnQpO1xyXG5cdFRSQUNLLnJ1blN0YXJ0S009cGFyc2VGbG9hdCh2YWxSdW5TdGFydCk7XHJcblx0aWYgKGlzTmFOKFRSQUNLLmJpa2VTdGFydEtNKSlcclxuXHRcdFRSQUNLLmJpa2VTdGFydEtNPTMuODY7XHJcblx0aWYgKGlzTmFOKFRSQUNLLnJ1blN0YXJ0S00pKVxyXG5cdFx0VFJBQ0sucnVuU3RhcnRLTT0xODAuMjUrVFJBQ0suYmlrZVN0YXJ0S007XHJcblx0aWYgKGpzb24gJiYganNvbiAhPSBcIlwiKSBcclxuXHR7XHJcblx0XHQkKFwiI3JvdXRlX3RleHRfYXJlYVwiKS52YWwoanNvbik7XHJcblx0XHR2YXIgc3RyID0gKFRSQUNLLmdldFRyYWNrTGVuZ3RoKCkvMTAwMC4wKStcIiBrbVwiO1xyXG5cdFx0JChcIiNyb3V0ZV9pbmZvXCIpLnZhbChzdHIpO1xyXG5cdFx0R1VJLmFkZFRyYWNrRmVhdHVyZSgpO1xyXG5cdFx0R1VJLnpvb21Ub1RyYWNrKCk7XHJcblx0XHRHVUkubWFwLnJlbW92ZUludGVyYWN0aW9uKGRyYXcpO1xyXG5cdFx0R1VJLm1hcC5hZGRJbnRlcmFjdGlvbihzZWxlY3QpO1xyXG5cdFx0R1VJLm1hcC5hZGRJbnRlcmFjdGlvbihtb2RpZnkpO1xyXG5cdH1cdFx0XHJcblx0R1VJLm9uRWRpdFNhdmUgPSBmdW5jdGlvbihkYXRhKSB7XHJcblx0XHQkKFwiI21hcFwiKS5jc3MoXCJkaXNwbGF5XCIsXCJub25lXCIpO1xyXG5cdFx0b25TdWJtaXQoZGF0YSk7XHJcblx0fTtcclxufVxyXG5cclxuJChkb2N1bWVudCkucmVhZHkoIGZ1bmN0aW9uICgpIFxyXG57XHJcblx0JChcIi5idXR0b24tYXNzaWdubWVudHNcIikuY2xpY2soZnVuY3Rpb24oKSB7XHJcblx0XHR3aW5kb3cub3BlbihcImFzc2lnbm1lbnQuaHRtbFwiLCAnX2JsYW5rJyk7XHJcblx0fSk7XHJcblx0JChcIi5idXR0b24tc3RhdHVzXCIpLmNsaWNrKGZ1bmN0aW9uKCkge1xyXG5cdFx0d2luZG93Lm9wZW4oXCJzdGF0dXMuaHRtbFwiLCAnX2JsYW5rJyk7XHJcblx0fSk7XHJcblx0JChcIi5idXR0b24tZ3B4XCIpLmNsaWNrKGZ1bmN0aW9uKCkge1xyXG5cdFx0d2luZG93Lm9wZW4oXCJncHguaHRtbFwiLCAnX2JsYW5rJyk7XHJcblx0fSk7XHJcblx0JChcIi5tb2JpbGUtc2hvdyBpXCIpLmNsaWNrKGZ1bmN0aW9uKCkge1xyXG5cdFx0JChcIi5tb2JpbGUtc2hvd1wiKS5jc3MoXCJkaXNwbGF5XCIsXCJub25lXCIpOyBcclxuXHRcdCQoXCIuZnctbmF2XCIpLmNzcyhcImhlaWdodFwiLFwiYXV0b1wiKTsgXHJcblx0fSk7XHJcblx0Ly8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0d2luZG93LkVESVRPUjEgPSBuZXcgJC5mbi5kYXRhVGFibGUuRWRpdG9yKCB7XHJcblx0XHRhamF4OiAnLi4vcGFydGljaXBhbnRzJyxcclxuXHRcdHRhYmxlOiBcIiN0YWJsZS1wYXJ0aWNpcGFudHNcIixcclxuXHRcdGlkU3JjOiBcImlkXCIsXHJcblx0XHRmaWVsZHM6IFsgXHJcblx0XHQgICAge1xyXG5cdFx0XHRcdGxhYmVsOiBcIlN0YXJ0IE5vXCIsXHJcblx0XHRcdFx0bmFtZTogXCJzdGFydE5vXCJcclxuXHRcdFx0fSx7XHJcblx0XHRcdFx0bGFiZWw6IFwiRmlyc3QgbmFtZVwiLFxyXG5cdFx0XHRcdG5hbWU6IFwiZmlyc3RuYW1lXCJcclxuXHRcdFx0fSx7XHJcblx0XHRcdFx0bGFiZWw6IFwiTGFzdCBuYW1lXCIsXHJcblx0XHRcdFx0bmFtZTogXCJsYXN0bmFtZVwiXHJcblx0XHRcdH0se1xyXG5cdFx0XHRcdGxhYmVsOiBcIkdlbmRlclwiLFxyXG5cdFx0XHRcdG5hbWU6IFwiZ2VuZGVyXCJcclxuXHRcdFx0fSx7XHJcblx0XHRcdFx0bGFiZWw6IFwiTmF0aW9uYWxpdHlcIixcclxuXHRcdFx0XHRuYW1lOiBcIm5hdGlvbmFsaXR5XCJcclxuXHRcdFx0fSx7XHJcblx0XHRcdFx0bGFiZWw6IFwiU3RhcnQgZ3JvdXBcIixcclxuXHRcdFx0XHRuYW1lOiBcInN0YXJ0R3JvdXBcIlxyXG5cdFx0XHR9LHtcclxuXHRcdFx0XHRsYWJlbDogXCJDbHViXCIsXHJcblx0XHRcdFx0bmFtZTogXCJjbHViXCJcclxuXHRcdFx0fSx7XHJcblx0XHRcdFx0bGFiZWw6IFwiQmlydGggZGF0ZVwiLFxyXG5cdFx0XHRcdG5hbWU6IFwiYmlydGhEYXRlXCIsXHJcblx0XHRcdH0se1xyXG5cdFx0XHRcdGxhYmVsOiBcIklkXCIsXHJcblx0XHRcdFx0bmFtZTogXCJpZFwiLFxyXG5cdFx0XHRcdHR5cGUgOiBcInJlYWRvbmx5XCJcclxuXHRcdFx0fVx0XHRcdFxyXG5cdFx0XVxyXG5cdH0gKTtcclxuXHJcblx0d2luZG93LkVESVRPUjMgPSBuZXcgJC5mbi5kYXRhVGFibGUuRWRpdG9yKCB7XHJcblx0XHRhamF4OiAnLi4vZXZlbnRzJyxcclxuXHRcdHRhYmxlOiBcIiN0YWJsZS1ldmVudHNcIixcclxuXHRcdGlkU3JjOiBcImlkXCIsXHJcblx0XHRmaWVsZHM6IFt7XHJcblx0XHRcdFx0XHRsYWJlbDogXCJDb2RlXCIsXHJcblx0XHRcdFx0XHRuYW1lOiBcImNvZGVcIlxyXG5cdFx0XHRcdCB9LHtcclxuXHRcdFx0XHRcdGxhYmVsOiBcIlN0YXJ0XCIsXHJcblx0XHRcdFx0XHRuYW1lOiBcInN0YXJ0VGltZVwiXHJcblx0XHRcdFx0fSwge1xyXG5cdFx0XHRcdFx0bGFiZWw6IFwiRW5kXCIsXHJcblx0XHRcdFx0XHRuYW1lOiBcImVuZFRpbWVcIlxyXG5cdFx0XHRcdH0sIHtcclxuXHRcdFx0XHRcdGxhYmVsOiBcIlRyYWNrXCIsXHJcblx0XHRcdFx0XHRuYW1lOiBcInRyYWNrXCJcclxuXHRcdFx0XHR9LCB7XHJcblx0XHRcdFx0XHRsYWJlbDogXCJCaWtlIHN0YXJ0IGttXCIsXHJcblx0XHRcdFx0XHRuYW1lOiBcImJpa2VTdGFydEtNXCJcclxuXHRcdFx0XHR9LCB7XHJcblx0XHRcdFx0XHRsYWJlbDogXCJSdW4gc3RhcnQga21cIixcclxuXHRcdFx0XHRcdG5hbWU6IFwicnVuU3RhcnRLTVwiXHJcblx0XHRcdFx0fSx7XHJcblx0XHRcdFx0XHRsYWJlbDogXCJJZFwiLFxyXG5cdFx0XHRcdFx0bmFtZTogXCJpZFwiLFxyXG5cdFx0XHRcdFx0dHlwZSA6IFwicmVhZG9ubHlcIlxyXG5cdFx0XHRcdH1dXHJcblx0fSk7XHJcblxyXG5cdFxyXG5cdHZhciB0YWJsZVBhcnRpY2lwYW50cyA9ICQoJyN0YWJsZS1wYXJ0aWNpcGFudHMnKS5EYXRhVGFibGUoIHtcclxuXHRcdGRvbTogXCJUZnJ0aXBcIixcclxuXHRcdGFqYXg6IFwiLi4vcGFydGljaXBhbnRzP21vZGU9ZHRibFwiLFxyXG5cdFx0Y29sdW1uczogW1xyXG5cdFx0XHR7IGRhdGE6IFwic3RhcnROb1wiLGNsYXNzTmFtZSA6IFwiZHQtYm9keS1yaWdodFwiIH0sXHJcblx0XHRcdHsgZGF0YTogXCJmaXJzdG5hbWVcIiB9LFxyXG5cdFx0XHR7IGRhdGE6IFwibGFzdG5hbWVcIiB9LFxyXG5cdFx0XHR7IGRhdGE6IFwiZ2VuZGVyXCIgfSxcclxuXHRcdFx0eyBkYXRhOiBcIm5hdGlvbmFsaXR5XCJ9LFxyXG5cdFx0XHR7IGRhdGE6IFwic3RhcnRHcm91cFwiIH0sXHJcblx0XHRcdHsgZGF0YTogXCJjbHViXCJ9LFxyXG5cdFx0XHR7IGRhdGE6IFwiYmlydGhEYXRlXCIsY2xhc3NOYW1lIDogXCJkdC1ib2R5LXJpZ2h0XCIgfVxyXG5cdFx0XSxcclxuXHRcdHRhYmxlVG9vbHM6IHtcclxuXHRcdFx0c1Jvd1NlbGVjdDogXCJvc1wiLFxyXG5cdFx0XHRhQnV0dG9uczogW1xyXG5cdFx0XHRcdHsgc0V4dGVuZHM6IFwiZWRpdG9yX2NyZWF0ZVwiLCBlZGl0b3I6IEVESVRPUjEgfSxcclxuXHRcdFx0XHR7IHNFeHRlbmRzOiBcImVkaXRvcl9lZGl0XCIsICAgZWRpdG9yOiBFRElUT1IxIH0sXHJcblx0XHRcdFx0eyBzRXh0ZW5kczogXCJlZGl0b3JfcmVtb3ZlXCIsIGVkaXRvcjogRURJVE9SMSB9XHJcblx0XHRcdF1cclxuXHRcdH1cclxuXHR9ICk7XHRcclxuXHRcclxuXHR2YXIgdGFibGVFdmVudHMgPSAkKCcjdGFibGUtZXZlbnRzJykuRGF0YVRhYmxlKCB7XHJcblx0XHRkb206IFwiVGZydGlwXCIsXHJcblx0XHRhamF4OiBcIi4uL2V2ZW50c1wiLFxyXG5cdFx0Y29sdW1uczogW1xyXG5cdFx0XHR7IGRhdGE6IFwiY29kZVwiIH0sXHJcblx0XHRcdHsgZGF0YTogXCJzdGFydFRpbWVcIiB9LFxyXG5cdFx0XHR7IGRhdGE6IFwiZW5kVGltZVwiIH0sXHJcblx0XHRcdHsgXHJcblx0XHRcdFx0Ly8gdHJhY2tcclxuXHRcdFx0XHRkYXRhOiBudWxsLFxyXG5cdFx0XHRcdHJlbmRlcjogZnVuY3Rpb24gKCBkYXRhLCB0eXBlLCByb3cgKSBcclxuXHRcdFx0XHR7XHJcblx0XHRcdFx0XHRpZiAoIWRhdGFbXCJ0cmFja1wiXSlcclxuXHRcdFx0XHRcdFx0cmV0dXJuIFwiXCI7XHJcblx0XHRcdFx0XHR2YXIgdHBvcyA9IG51bGw7XHJcblx0XHRcdFx0XHR0cnkge1xyXG5cdFx0XHRcdFx0XHR0cG9zPUpTT04ucGFyc2UoZGF0YVtcInRyYWNrXCJdKTtcclxuXHRcdFx0XHRcdH0gY2F0Y2goZSkge1xyXG5cdFx0XHRcdFx0fVxyXG5cdFx0XHRcdFx0dmFyIHJlcztcclxuXHRcdFx0XHRcdGlmICghdHBvcyB8fCAhdHBvcy5sZW5ndGgpXHJcblx0XHRcdFx0XHRcdHJlcz1cIjAga21cIjtcclxuXHRcdFx0XHRcdGVsc2Uge1xyXG5cdFx0XHRcdFx0XHR2YXIgdHIgPSBuZXcgVHJhY2soKTtcclxuXHRcdFx0XHRcdFx0dHIuc2V0Um91dGUodHBvcyk7XHJcblx0XHRcdFx0XHRcdHJlcyA9IGZvcm1hdE51bWJlcjIodHIuZ2V0VHJhY2tMZW5ndGgoKS8xMDAwLjApK1wiIGttXCI7XHJcblx0XHRcdFx0XHR9XHJcblx0XHRcdFx0XHRpZiAoZGF0YVtcInJ1bi1jb3VudFwiXSAmJiBwYXJzZUludChkYXRhW1wicnVuLWNvdW50XCJdKSA+IDEpXHJcblx0XHRcdFx0XHRcdHJlcz1cIjxiPlwiK2RhdGFbXCJydW4tY291bnRcIl0rXCJ4PC9iPiBcIityZXM7XHJcblx0XHRcdFx0XHRpZiAoZGF0YVtcImJlZ2luLXRpbWVcIl0gJiYgZGF0YVtcImVuZC10aW1lXCJdKVxyXG5cdFx0XHRcdFx0XHRyZXM9ZGF0YVtcImJlZ2luLXRpbWVcIl0rXCItXCIrZGF0YVtcImVuZC10aW1lXCJdK1wiIChcIityZXMrXCIpXCI7XHJcblx0XHRcdFx0XHRyZXR1cm4gcmVzO1xyXG5cdFx0XHRcdH0gXHJcblx0XHRcdH0sXHJcblx0XHRcdHsgZGF0YTogXCJiaWtlU3RhcnRLTVwiLGNsYXNzTmFtZSA6IFwiZHQtYm9keS1yaWdodFwiIH0sXHJcblx0XHRcdHsgZGF0YTogXCJydW5TdGFydEtNXCIsY2xhc3NOYW1lIDogXCJkdC1ib2R5LXJpZ2h0XCIgfVxyXG5cdFx0XSxcclxuXHRcdHRhYmxlVG9vbHM6IHtcclxuXHRcdFx0c1Jvd1NlbGVjdDogXCJvc1wiLFxyXG5cdFx0XHRhQnV0dG9uczogW1xyXG5cdFx0XHQgICAgeyBzRXh0ZW5kczogXCJlZGl0b3JfY3JlYXRlXCIsIGVkaXRvciA6IEVESVRPUjMgfSxcclxuXHRcdFx0XHR7IHNFeHRlbmRzOiBcImVkaXRvcl9lZGl0XCIsICAgZm5DbGljayA6IGZ1bmN0aW9uICgpIHtcclxuXHRcdFx0XHRcdEVESVRPUjNcclxuXHRcdCAgICAgICAgICAgIC50aXRsZSggJ0VkaXQgZXZlbnQgY29uZmlndXJhdGlvbicgKVxyXG5cdFx0ICAgICAgICAgICAgLmJ1dHRvbnMoIFtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHsgbGFiZWw6ICdTYXZlJywgZm46IGZ1bmN0aW9uKCkgeyB0aGlzLnN1Ym1pdCgpOyB9IH0sXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB7IGxhYmVsOiAnTWFwJywgZm46IGZ1bmN0aW9uKCkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgXHQgICB2YXIgZHQgPSB0YWJsZUV2ZW50cy5yb3dzKFwiLnNlbGVjdGVkXCIpLmRhdGEoKVswXTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIFx0ICAgdmFyIHRoYXQ9dGhpcztcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIFx0ICAgbWFwRWRpdChkdC5pZCwkKFwiI0RURV9GaWVsZF90cmFja1wiKS52YWwoKSwkKFwiI0RURV9GaWVsZF9iaWtlU3RhcnRLTVwiKS52YWwoKSwkKFwiI0RURV9GaWVsZF9ydW5TdGFydEtNXCIpLnZhbCgpLGZ1bmN0aW9uKGRhdGEpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIFx0XHQgICAkKFwiI0RURV9GaWVsZF90cmFja1wiKS52YWwoZGF0YSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBcdCAgIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0gfSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB7IGxhYmVsOiAnU3RhcnRzJywgZm46IGZ1bmN0aW9uKCkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFx0dmFyIGVpZCA9ICQoXCIjRFRFX0ZpZWxkX2lkXCIpLnZhbCgpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFx0aWYgKCFlaWQgfHwgIWVpZC5sZW5ndGgpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBcdFx0YWxlcnQoXCJPbmx5IG9uIHNhdmVkIGV2ZW50IHBvc3NpYmxlIVwiKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBcdFx0cmV0dXJuO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFx0fVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFx0IHZhciB3aW4gPSB3aW5kb3cub3BlbihcInN0YXJ0cy5odG1sP2lkPVwiK2VpZCtcIiZ0aXRsZT1cIitlbmNvZGVVUklDb21wb25lbnQoJChcIiNEVEVfRmllbGRfY29kZVwiKS52YWwoKStcIiBcIiskKFwiI0RURV9GaWVsZF9zdGFydFRpbWVcIikudmFsKCkrXCIgPiBcIiskKFwiI0RURV9GaWVsZF9lbmRUaW1lXCIpLnZhbCgpKSwgJ19ibGFuaycpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFx0IHdpbi5mb2N1cygpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0gfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgIF0gKVxyXG5cdFx0ICAgICAgICAgICAgICAgICAgICAuZWRpdCggdGFibGVFdmVudHMucm93KCAnLnNlbGVjdGVkJyApLm5vZGUoKSApO1xyXG5cdFx0XHRcdCAgICAgfSBcclxuXHRcdFx0XHR9LFxyXG5cdFx0XHRcdHsgc0V4dGVuZHM6IFwiZWRpdG9yX3JlbW92ZVwiLCBlZGl0b3I6IEVESVRPUjMgfVxyXG4gICAgICAgICAgIF1cclxuXHRcdH1cclxuXHR9ICk7XHJcblx0XHJcblx0Ly8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdFxyXG5cdC8qXHJcblx0JChcIiNuYXYxXCIpLmNsaWNrKGZ1bmN0aW9uKCkge1xyXG5cdFx0JChcIiNuYXYxXCIpLmFkZENsYXNzKFwiYWN0aXZlXCIpO1xyXG5cdFx0JChcIiNuYXYyXCIpLnJlbW92ZUNsYXNzKFwiYWN0aXZlXCIpO1xyXG5cdFx0JChcIiN0YWIxXCIpLmNzcyhcImhlaWdodFwiLFwiYXV0b1wiKTtcclxuXHRcdCQoXCIjdGFiMlwiKS5jc3MoXCJoZWlnaHRcIixcIjBcIik7XHJcblx0fSk7XHJcblx0JChcIiNuYXYyXCIpLmNsaWNrKGZ1bmN0aW9uKCkge1xyXG5cdFx0JChcIiNuYXYyXCIpLmFkZENsYXNzKFwiYWN0aXZlXCIpO1xyXG5cdFx0JChcIiNuYXYxXCIpLnJlbW92ZUNsYXNzKFwiYWN0aXZlXCIpO1xyXG5cdFx0JChcIiN0YWIyXCIpLmNzcyhcImhlaWdodFwiLFwiYXV0b1wiKTtcclxuXHRcdCQoXCIjdGFiMVwiKS5jc3MoXCJoZWlnaHRcIixcIjBcIik7XHJcblx0fSk7XHJcblx0Ki9cclxuXHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcbn0pO1xyXG4iLCJ2YXIgVXRpbHMgPSByZXF1aXJlKFwiLi9VdGlscy5qc1wiKTtcclxuXHJcbnZhciBDT05GSUcgPSBcclxue1xyXG5cdHRpbWVvdXRzIDogLy8gaW4gc2Vjb25kc1xyXG5cdHtcclxuXHRcdGRldmljZVRpbWVvdXQgOiA2MCo1LFxyXG5cdFx0YW5pbWF0aW9uRnJhbWUgOiBVdGlscy5tb2JpbGVBbmRUYWJsZXRDaGVjaygpID8gMC40IDogMC4xLFxyXG5cdFx0Z3BzTG9jYXRpb25EZWJ1Z1Nob3cgOiA0LFx0XHQvLyB0aW1lIHRvIHNob3cgZ3BzIGxvY2F0aW9uIChkZWJ1ZykgaW5mb1xyXG5cdFx0c3RyZWFtRGF0YUludGVydmFsIDogMTAgXHRcdC8qIE5PUk1BTCAxMCBzZWNvbmRzICovXHJcblx0fSxcclxuXHRkaXN0YW5jZXMgOiAvLyBpbiBtXHJcblx0e1xyXG5cdFx0c3RheU9uUm9hZFRvbGVyYW5jZSA6IDUwMCxcdC8vIDUwMG0gc3RheSBvbiByb2FkIHRvbGVyYW5jZVxyXG5cdFx0ZWxhcHNlZERpcmVjdGlvbkVwc2lsb24gOiA1MDAgLy8gNTAwbSBkaXJlY3Rpb24gdG9sZXJhbmNlLCB0b28gZmFzdCBtb3ZlbWVudCB3aWxsIGRpc2NhcmQgXHJcblx0fSxcclxuXHRjb25zdHJhaW50cyA6IHtcclxuXHRcdGJhY2t3YXJkc0Vwc2lsb25Jbk1ldGVyIDogNDAwLCAvLzIyMCBtIG1vdmVtZW50IGluIHRoZSBiYWNrd2FyZCBkaXJlY3Rpb24gd2lsbCBub3QgdHJpZ2dlciBuZXh0IHJ1biBjb3VudGVyIGluY3JlbWVudFx0XHRcclxuXHRcdG1heFNwZWVkIDogMjAsXHQvL2ttaFxyXG5cdFx0bWF4UGFydGljaXBhbnRTdGF0ZUhpc3RvcnkgOiAxMDAwLCAvLyBudW1iZXIgb2YgZWxlbWVudHNcclxuXHRcdHBvcHVwRW5zdXJlVmlzaWJsZVdpZHRoIDogMjAwLFxyXG5cdFx0cG9wdXBFbnN1cmVWaXNpYmxlSGVpZ2h0OiAxMjBcclxuXHR9LFxyXG5cdHNpbXVsYXRpb24gOiB7XHJcblx0XHRwaW5nSW50ZXJ2YWwgOiAxMCwgIC8vIGludGVydmFsIGluIHNlY29uZHMgdG8gcGluZyB3aXRoIGdwcyBkYXRhXHJcblx0XHRncHNJbmFjY3VyYWN5IDogNCwgLy84LCAgLy8gZXJyb3Igc2ltdWxhdGlvbiBpbiBNRVRFUiAobG9vayBtYXRoLmdwc0luYWNjdXJhY3ksIG1pbiAxLzIpXHJcblx0XHRzcGVlZENvZWYgOiAxMDBcclxuXHR9LFxyXG5cdHNldHRpbmdzIDoge1xyXG5cdFx0bm9NaWRkbGVXYXJlIDogMCwgXHQvLyBTS0lQIG1pZGRsZSB3YXJlIG5vZGUganMgYXBwXHJcblx0XHRub0ludGVycG9sYXRpb24gOiAwXHQvLyAxIC0+IG5vIGludGVycG9sYXRpb24gb25seSBwb2ludHNcclxuXHR9LFxyXG5cdG1hdGggOiB7XHJcblx0XHRwcm9qZWN0aW9uU2NhbGVZIDogMC43NSxcdFx0XHRcdC8vIFRPRE8gRVhQTEFJTiAocmVjdGFuZ2UgY3JlYXRpb24gaW4gd29ybGQgbWVyY2F0b3IgY29lZiB5IFxyXG5cdFx0Z3BzSW5hY2N1cmFjeSA6IDE1MCxcdFx0XHRcdFx0XHQgLy9UT0RPIDEzIG1pbiA/IFxyXG5cdFx0c3BlZWRBbmRBY2NlbGVyYXRpb25BdmVyYWdlRGVncmVlIDogMixcdC8vIGNhbGN1bGF0aW9uIGJhc2VkIG9uIE4gc3RhdGVzIChhdmVyYWdlKSAoTUlOIDIpXHJcblx0XHRkaXNwbGF5RGVsYXkgOiA4MCxcdFx0XHRcdFx0XHQvLyBkaXNwbGF5IGRlbGF5IGluIFNFQ09ORFNcclxuXHRcdGludGVycG9sYXRlR1BTQXZlcmFnZSA6IDAgLy8gbnVtYmVyIG9mIHJlY2VudCB2YWx1ZXMgdG8gY2FsY3VsYXRlIGF2ZXJhZ2UgZ3BzIGZvciBwb3NpdGlvbiAoc21vb3RoaW5nIHRoZSBjdXJ2ZS5taW4gMCA9IE5PLDEgPSAyIHZhbHVlcyAoY3VycmVudCBhbmQgbGFzdCkpXHJcblx0fSxcclxuXHRjb25zdGFudHMgOiBcclxuXHR7XHJcblx0XHRhZ2VHcm91cHMgOiAgXHJcblx0XHRbXHJcblx0XHQge1xyXG5cdFx0XHQgZnJvbSA6IG51bGwsXHJcblx0XHRcdCB0byA6IDgsIFxyXG5cdFx0XHQgY29kZSA6IFwiRmlyc3RBZ2VHcm91cFwiXHJcblx0XHQgfVxyXG5cdFx0ICx7XHJcblx0XHRcdCBmcm9tIDogOCxcclxuXHRcdFx0IHRvIDogNDAsIFxyXG5cdFx0XHQgY29kZSA6IFwiTWlkZGxlQWdlR3JvdXBcIlxyXG5cdFx0IH1cclxuXHRcdCAse1xyXG5cdFx0XHQgZnJvbSA6IDQwLFxyXG5cdFx0XHQgdG8gOiBudWxsLCBcclxuXHRcdFx0IGNvZGUgOiBcIkxhc3RBZ2VHcm91cFwiXHJcblx0XHQgfVxyXG5cdFx0XVxyXG5cdH0sXHJcblxyXG5cdGV2ZW50IDoge1xyXG5cdFx0YmVnaW5UaW1lc3RhbXAgOiAobmV3IERhdGUoKSkuZ2V0VGltZSgpLFxyXG5cdFx0ZHVyYXRpb24gOiA2MCwgLy9NSU5VVEVTXHJcblx0XHRpZCA6IDNcclxuXHR9LFxyXG5cclxuXHRzZXJ2ZXIgOiB7XHJcblx0XHRwcmVmaXggOiBcIi90cmlhdGhsb24vXCJcclxuXHR9LFxyXG5cdFxyXG5cdGFwcGVhcmFuY2UgOiB7XHJcblx0XHRkZWJ1ZyA6IDAsXHJcblx0XHR0cmFja0NvbG9yU3dpbSA6ICcjNTY3NmZmJyxcclxuXHRcdHRyYWNrQ29sb3JCaWtlIDogJyNFMjAwNzQnLFxyXG5cdFx0dHJhY2tDb2xvclJ1biA6ICAnIzA3OWYzNicsXHJcblxyXG5cdFx0Ly8gTm90ZSB0aGUgc2VxdWVuY2UgaXMgYWx3YXlzIFN3aW0tQmlrZS1SdW4gLSBzbyAyIGNoYW5nZS1wb2ludHNcclxuXHRcdC8vIFRPRE8gUnVtZW4gLSBhZGQgc2NhbGUgaGVyZSwgbm90IGluIFN0eWxlcy5qc1xyXG5cdFx0aW1hZ2VTdGFydCA6IFwiaW1nL3N0YXJ0LnBuZ1wiLFxyXG5cdFx0aW1hZ2VGaW5pc2ggOiBcImltZy9maW5pc2gucG5nXCIsXHJcblx0XHRpbWFnZUNhbSA6IFwiaW1nL2NhbWVyYS5zdmdcIixcclxuXHRcdGltYWdlQ2hlY2twb2ludFN3aW1CaWtlIDogXCJpbWcvd3oxLnN2Z1wiLFxyXG5cdFx0aW1hZ2VDaGVja3BvaW50QmlrZVJ1biA6IFwiaW1nL3d6Mi5zdmdcIixcclxuXHRcdGlzU2hvd0NoZWNrcG9pbnRJbWFnZSA6IGZhbHNlLCAvKiBzaG93IGFuIGltYWdlIG9uIHRoZSBjaGVja3BvaW50cyAoZS5nIG9uIHRoZSBjaGFuZ2luZyBXWiBwb2ludHMgKi9cclxuXHRcdGlzU2hvd0NoZWNrcG9pbnQgOiBmYWxzZSwgIC8qIHNob3cgYW4gc3F1YXJlIG9uIHRoZSBzYW1lIGNvbG9yIG9uIHRoZSBjaGVja3BvaW50cywgb25seSBpZiBpc1Nob3dDaGVja3BvaW50SW1hZ2UgaXMgbm90IHRydWUqL1xyXG5cclxuICAgICAgICAvLyB0aGUgZGlzdGFuY2UgYmV0d2VlbiB0aGUgZGlyZWN0aW9uIGljb25zIC0gaW4gcGl4ZWxzLFxyXG4gICAgICAgIC8vIGlmIHNldCBub24tcG9zaXRpdmUgdmFsdWUgKDAgb3IgbGVzcykgdGhlbiBkb24ndCBzaG93IHRoZW0gYXQgYWxsXHJcblx0XHQvL2RpcmVjdGlvbkljb25CZXR3ZWVuIDogMjAwXHJcblx0XHRkaXJlY3Rpb25JY29uQmV0d2VlbiA6IC0xXHJcblx0fSxcclxuXHJcbiAgICBob3RzcG90IDoge1xyXG4gICAgICAgIGNhbSA6IHtpbWFnZSA6XCJpbWcvY2FtZXJhLnN2Z1wifSwgIC8vIHVzZSB0aGUgc2FtZSBpbWFnZSBmb3Igc3RhdGljIGNhbWVyYXMgYXMgZm9yIHRoZSBtb3Zpbmcgb25lc1xyXG5cdFx0Y2FtU3dpbUJpa2UgOiB7aW1hZ2UgOiBcImltZy93ejEuc3ZnXCJ9LFxyXG5cdFx0Y2FtQmlrZVJ1biA6IHtpbWFnZSA6IFwiaW1nL3d6Mi5zdmdcIn0sXHJcbiAgICAgICAgd2F0ZXIgOiB7aW1hZ2UgOiBcImltZy93YXRlci5zdmdcIn0sXHJcbiAgICAgICAgdXR1cm4gOiB7aW1hZ2UgOiBcImltZy91dHVybi5zdmdcIn0sXHJcblxyXG5cdFx0a20xMCA6IHtpbWFnZSA6IFwiaW1nLzEwa20uc3ZnXCIsIHNjYWxlIDogMS41fSxcclxuXHRcdGttMjAgOiB7aW1hZ2UgOiBcImltZy8yMGttLnN2Z1wiLCBzY2FsZSA6IDEuNX0sXHJcblx0XHRrbTMwIDoge2ltYWdlIDogXCJpbWcvMzBrbS5zdmdcIiwgc2NhbGUgOiAxLjV9LFxyXG5cdFx0a200MCA6IHtpbWFnZSA6IFwiaW1nLzQwa20uc3ZnXCIsIHNjYWxlIDogMS41fSxcclxuXHRcdGttNjAgOiB7aW1hZ2UgOiBcImltZy82MGttLnN2Z1wiLCBzY2FsZSA6IDEuNX0sXHJcblx0XHRrbTgwIDoge2ltYWdlIDogXCJpbWcvODBrbS5zdmdcIiwgc2NhbGUgOiAxLjV9LFxyXG5cdFx0a20xMDAgOiB7aW1hZ2UgOiBcImltZy8xMDBrbS5zdmdcIiwgc2NhbGUgOiAxLjV9LFxyXG5cdFx0a20xMjAgOiB7aW1hZ2UgOiBcImltZy8xMjBrbS5zdmdcIiwgc2NhbGUgOiAxLjV9LFxyXG5cdFx0a20xNDAgOiB7aW1hZ2UgOiBcImltZy8xNDBrbS5zdmdcIiwgc2NhbGUgOiAxLjV9LFxyXG5cdFx0a20xNjAgOiB7aW1hZ2UgOiBcImltZy8xNjBrbS5zdmdcIiwgc2NhbGUgOiAxLjV9LFxyXG5cdFx0a20xODAgOiB7aW1hZ2UgOiBcImltZy8xODBrbS5zdmdcIiwgc2NhbGUgOiAxLjV9XHJcbiAgICB9XHJcbn07XHJcblxyXG5mb3IgKHZhciBpIGluIENPTkZJRylcclxuXHRleHBvcnRzW2ldPUNPTkZJR1tpXTtcclxuIiwidmFyIFV0aWxzPXJlcXVpcmUoJy4vVXRpbHMnKTtcclxudmFyIFNUWUxFUz1yZXF1aXJlKCcuL1N0eWxlcycpO1xyXG5yZXF1aXJlKCdqb29zZScpO1xyXG5yZXF1aXJlKCcuL1RyYWNrJyk7XHJcbnJlcXVpcmUoJy4vTGl2ZVN0cmVhbScpO1xyXG52YXIgQ09ORklHID0gcmVxdWlyZShcIi4vQ29uZmlnXCIpO1xyXG5cclxuQ2xhc3MoXCJHdWlcIiwgXHJcbntcclxuICAgIC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHQvLyBBTEwgQ09PUkRJTkFURVMgQVJFIElOIFdPUkxEIE1FUkNBVE9SXHJcbiAgICAvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcbiAgICBoYXM6IFxyXG5cdHtcclxuICAgIFx0aXNEZWJ1ZyA6IHtcclxuICAgIFx0XHRpcyA6IFwicndcIixcclxuICAgIFx0XHRpbml0IDogIVV0aWxzLm1vYmlsZUFuZFRhYmxldENoZWNrKCkgJiYgQ09ORklHLmFwcGVhcmFuY2UuZGVidWdcclxuICAgIFx0fSxcclxuXHRcdGlzV2lkZ2V0IDoge1xyXG5cdFx0XHRpbml0IDogZmFsc2VcclxuXHRcdH0sXHJcblx0XHRpc0RlYnVnU2hvd1Bvc2l0aW9uIDoge1xyXG5cdFx0XHQvLyBpZiBzZXQgdG8gdHJ1ZSBpdCB3aWxsIGFkZCBhbiBhYnNvbHV0ZSBlbGVtZW50IHNob3dpbmcgdGhlIGNvb3JkaW5hdGVzIGFib3ZlIHRoZSBtb3VzZSBsb2NhdGlvblxyXG5cdFx0XHRpbml0IDogZmFsc2VcclxuXHRcdH0sXHJcblx0XHRyZWNlaXZlck9uTWFwQ2xpY2sgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogW11cclxuXHRcdH0sXHJcbiAgICAgICAgd2lkdGggOiB7XHJcbiAgICAgICAgICAgIGlzOiAgIFwicndcIixcclxuICAgICAgICAgICAgaW5pdDogNzUwXHJcbiAgICAgICAgfSxcclxuICAgICAgICBoZWlnaHQ6IHtcclxuICAgICAgICAgICAgaXM6ICAgXCJyd1wiLFxyXG4gICAgICAgICAgICBpbml0OiA1MDBcclxuICAgICAgICB9LFxyXG5cdFx0dHJhY2sgOiB7XHJcblx0XHRcdGlzOiAgIFwicndcIlxyXG5cdFx0fSxcclxuXHRcdGVsZW1lbnRJZCA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiBcIm1hcFwiXHJcblx0XHR9LFxyXG5cdFx0aW5pdGlhbFBvcyA6IHtcdFxyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IG51bGxcclxuXHRcdH0sXHJcblx0XHRpbml0aWFsWm9vbSA6IHtcdFxyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IDEwXHJcblx0XHR9LFxyXG5cdFx0aXNTa2lwRXh0ZW50IDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IGZhbHNlXHJcblx0XHR9LFxyXG5cdFx0YmluZ01hcEtleSA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiAnQWlqdDNBc1dPTUUzaFBFRV9IcVJsVUtkY0JLcWU4ZEdSWkhfdi1MM0hfRkY2NHN2WE1ia3IxVDZ1X1dBU29ldCdcclxuXHRcdH0sXHJcblx0XHQvLy0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRcdG1hcCA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiBudWxsXHJcblx0XHR9LFxyXG5cdFx0dHJhY2tMYXllciA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiBudWxsXHJcblx0XHR9LFxyXG4gICAgICAgIGhvdHNwb3RzTGF5ZXIgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogbnVsbFxyXG5cdFx0fSxcclxuICAgICAgICBjYW1zTGF5ZXIgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogbnVsbFxyXG5cdFx0fSxcclxuXHRcdHBhcnRpY2lwYW50c0xheWVyIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IG51bGxcclxuXHRcdH0sXHJcblx0XHRkZWJ1Z0xheWVyR1BTIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IG51bGxcclxuXHRcdH0sXHRcclxuXHRcdHRlc3RMYXllciA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiBudWxsXHJcblx0XHR9LFx0XHJcblx0XHR0ZXN0TGF5ZXIxIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IG51bGxcclxuXHRcdH0sXHRcclxuXHRcdHRlc3RMYXllcjIgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogbnVsbFxyXG5cdFx0fSxcdFxyXG5cdFx0XHJcblx0XHRzZWxlY3RlZFBhcnRpY2lwYW50MSA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiBudWxsXHJcblx0XHR9LFxyXG5cdFx0c2VsZWN0ZWRQYXJ0aWNpcGFudDIgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogbnVsbFxyXG5cdFx0fSxcclxuXHRcdHBvcHVwMSA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiBudWxsXHJcblx0XHR9LFxyXG5cdFx0cG9wdXAyIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IG51bGxcclxuXHRcdH0sXHJcblx0XHRpc1Nob3dTd2ltIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IHRydWVcclxuXHRcdH0sXHJcblx0XHRpc1Nob3dCaWtlIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IHRydWVcclxuXHRcdH0sXHJcblx0XHRpc1Nob3dSdW4gOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogdHJ1ZVxyXG5cdFx0fSxcclxuXHRcdHNlbGVjdE51bSA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiAxXHJcblx0XHR9LFxyXG4gICAgICAgIGxpdmVTdHJlYW0gOiB7XHJcbiAgICAgICAgICAgIGluaXQ6IG51bGxcclxuICAgICAgICB9XHJcbiAgICB9LFxyXG4gICAgLy8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdG1ldGhvZHM6IFxyXG5cdHtcclxuICAgICAgICBpbml0OiBmdW5jdGlvbiAocGFyYW1zKSAgXHJcblx0XHR7XHJcblx0XHRcdC8vIGlmIGluIHdpZGdldCBtb2RlIHRoZW4gZGlzYWJsZSBkZWJ1Z1xyXG5cdFx0XHRpZiAodGhpcy5pc1dpZGdldCkge1xyXG5cdFx0XHRcdHRoaXMuaXNEZWJ1ZyA9IGZhbHNlO1xyXG5cdFx0XHR9XHJcblxyXG5cdFx0XHR2YXIgZGVmUG9zID0gWzAsMF07XHJcblx0XHRcdGlmICh0aGlzLmluaXRpYWxQb3MpIHtcclxuXHRcdFx0XHRkZWZQb3MgPSB0aGlzLmluaXRpYWxQb3M7XHJcblx0XHRcdH0gZWxzZSBpZiAoVFJBQ0suZ2V0Um91dGUoKSAmJiBUUkFDSy5nZXRSb3V0ZSgpLmxlbmd0aCA+IDEpIHtcclxuXHRcdFx0XHRkZWZQb3MgPSBUUkFDSy5nZXRSb3V0ZSgpWzBdO1xyXG5cdFx0XHR9XHJcblx0XHRcdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0XHRcdHZhciBleHRlbnQgPSB0aGlzLmlzU2tpcEV4dGVudCA/IG51bGwgOiBUUkFDSy5nZXRSb3V0ZSgpICYmIFRSQUNLLmdldFJvdXRlKCkubGVuZ3RoID4gMSA/IG9sLnByb2oudHJhbnNmb3JtRXh0ZW50KCAobmV3IG9sLmdlb20uTGluZVN0cmluZyhUUkFDSy5nZXRSb3V0ZSgpKSkuZ2V0RXh0ZW50KCkgLCAnRVBTRzo0MzI2JywgJ0VQU0c6Mzg1NycpIDogbnVsbDtcclxuXHRcdFx0dGhpcy50cmFja0xheWVyID0gbmV3IG9sLmxheWVyLlZlY3Rvcih7XHJcblx0XHRcdCAgc291cmNlOiBuZXcgb2wuc291cmNlLlZlY3RvcigpLFxyXG5cdFx0XHQgIHN0eWxlIDogU1RZTEVTW1widHJhY2tcIl1cclxuXHRcdFx0fSk7XHJcblx0XHRcdHRoaXMuaG90c3BvdHNMYXllciA9IG5ldyBvbC5sYXllci5WZWN0b3Ioe1xyXG5cdFx0XHQgIHNvdXJjZTogbmV3IG9sLnNvdXJjZS5WZWN0b3IoKSxcclxuXHRcdFx0ICBzdHlsZSA6IFNUWUxFU1tcImhvdHNwb3RcIl1cclxuXHRcdFx0fSk7XHJcblx0XHRcdHRoaXMucGFydGljaXBhbnRzTGF5ZXIgPSBuZXcgb2wubGF5ZXIuVmVjdG9yKHtcclxuXHRcdFx0ICBzb3VyY2U6IG5ldyBvbC5zb3VyY2UuVmVjdG9yKCksXHJcblx0XHRcdCAgc3R5bGUgOiBTVFlMRVNbXCJwYXJ0aWNpcGFudFwiXVxyXG5cdFx0XHR9KTtcclxuXHRcdFx0dGhpcy5jYW1zTGF5ZXIgPSBuZXcgb2wubGF5ZXIuVmVjdG9yKHtcclxuXHRcdFx0XHRzb3VyY2U6IG5ldyBvbC5zb3VyY2UuVmVjdG9yKCksXHJcblx0XHRcdFx0c3R5bGUgOiBTVFlMRVNbXCJjYW1cIl1cclxuXHRcdFx0fSk7XHJcblx0XHRcdGlmICh0aGlzLmlzRGVidWcpIFxyXG5cdFx0XHR7XHJcblx0XHRcdFx0dGhpcy5kZWJ1Z0xheWVyR1BTID0gbmV3IG9sLmxheWVyLlZlY3Rvcih7XHJcblx0XHRcdFx0XHQgIHNvdXJjZTogbmV3IG9sLnNvdXJjZS5WZWN0b3IoKSxcclxuXHRcdFx0XHRcdCAgc3R5bGUgOiBTVFlMRVNbXCJkZWJ1Z0dQU1wiXVxyXG5cdFx0XHRcdH0pO1xyXG5cdFx0XHRcdHRoaXMudGVzdExheWVyID0gbmV3IG9sLmxheWVyLlZlY3Rvcih7XHJcblx0XHRcdFx0XHQgIHNvdXJjZTogbmV3IG9sLnNvdXJjZS5WZWN0b3IoKSxcclxuXHRcdFx0XHRcdCAgc3R5bGUgOiBTVFlMRVNbXCJ0ZXN0XCJdXHJcblx0XHRcdFx0fSk7XHJcblx0XHRcdFx0dGhpcy50ZXN0TGF5ZXIxID0gbmV3IG9sLmxheWVyLlZlY3Rvcih7XHJcblx0XHRcdFx0XHQgIHNvdXJjZTogbmV3IG9sLnNvdXJjZS5WZWN0b3IoKSxcclxuXHRcdFx0XHRcdCAgc3R5bGUgOiBTVFlMRVNbXCJ0ZXN0MVwiXVxyXG5cdFx0XHRcdH0pO1xyXG5cdFx0XHRcdHRoaXMudGVzdExheWVyMiA9IG5ldyBvbC5sYXllci5WZWN0b3Ioe1xyXG5cdFx0XHRcdFx0ICBzb3VyY2U6IG5ldyBvbC5zb3VyY2UuVmVjdG9yKCksXHJcblx0XHRcdFx0ICBcdHN0eWxlIDogU1RZTEVTW1widGVzdDJcIl1cclxuXHRcdFx0XHR9KTtcclxuXHRcdFx0fVxyXG5cdFx0XHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0XHRcdHZhciBpbnRzID0gW107XHJcblx0XHRcdHRoaXMucG9wdXAxID0gbmV3IG9sLk92ZXJsYXkuUG9wdXAoe2FuaTpmYWxzZSxwYW5NYXBJZk91dE9mVmlldyA6IGZhbHNlfSk7XHJcblx0XHRcdHRoaXMucG9wdXAyID0gbmV3IG9sLk92ZXJsYXkuUG9wdXAoe2FuaTpmYWxzZSxwYW5NYXBJZk91dE9mVmlldyA6IGZhbHNlfSk7XHJcblx0XHRcdHRoaXMucG9wdXAyLnNldE9mZnNldChbMCwxNzVdKTtcclxuXHRcdFx0dGhpcy5tYXAgPSBuZXcgb2wuTWFwKHtcclxuXHRcdFx0ICByZW5kZXJlciA6IFwiY2FudmFzXCIsXHJcblx0XHRcdCAgdGFyZ2V0OiAnbWFwJyxcclxuXHRcdFx0ICBsYXllcnM6IFtcclxuXHRcdFx0ICAgICAgICAgICBuZXcgb2wubGF5ZXIuVGlsZSh7XHJcblx0XHRcdCAgICAgICAgICAgICAgIHNvdXJjZTogbmV3IG9sLnNvdXJjZS5PU00oKVxyXG5cdFx0XHQgICAgICAgICAgIH0pLFxyXG5cdFx0XHRcdFx0dGhpcy50cmFja0xheWVyLFxyXG5cdFx0XHRcdFx0dGhpcy5ob3RzcG90c0xheWVyLFxyXG5cdFx0XHRcdFx0dGhpcy5jYW1zTGF5ZXIsXHJcblx0XHRcdFx0XHR0aGlzLnBhcnRpY2lwYW50c0xheWVyXHJcblx0XHRcdCAgXSxcclxuXHRcdFx0ICBjb250cm9sczogdGhpcy5pc1dpZGdldCA/IFtdIDogb2wuY29udHJvbC5kZWZhdWx0cygpLFxyXG5cdFx0XHQgIHZpZXc6IG5ldyBvbC5WaWV3KHtcclxuXHRcdFx0XHRjZW50ZXI6IG9sLnByb2oudHJhbnNmb3JtKGRlZlBvcywgJ0VQU0c6NDMyNicsICdFUFNHOjM4NTcnKSxcclxuXHRcdFx0XHR6b29tOiB0aGlzLmluaXRpYWxab29tLFxyXG5cdFx0XHRcdG1pblpvb206IHRoaXMuaXNXaWRnZXQgPyB0aGlzLmluaXRpYWxab29tIDogOCxcclxuXHRcdFx0XHRtYXhab29tOiB0aGlzLmlzV2lkZ2V0ID8gdGhpcy5pbml0aWFsWm9vbSA6IChDT05GSUcuYXBwZWFyYW5jZS5kZWJ1ZyA/IDIwIDogMTcpLFxyXG5cdFx0XHRcdGV4dGVudCA6IGV4dGVudCA/IGV4dGVudCA6IHVuZGVmaW5lZFxyXG5cdFx0XHQgIH0pXHJcblx0XHRcdH0pO1xyXG5cdFx0XHRcclxuXHRcdFx0Zm9yICh2YXIgaT0wO2k8aW50cy5sZW5ndGg7aSsrKVxyXG5cdFx0XHRcdHRoaXMubWFwLmFkZEludGVyYWN0aW9uKGludHNbaV0pO1xyXG5cdFx0XHR0aGlzLm1hcC5hZGRPdmVybGF5KHRoaXMucG9wdXAxKTtcclxuXHRcdFx0dGhpcy5tYXAuYWRkT3ZlcmxheSh0aGlzLnBvcHVwMik7XHJcblx0XHRcdGlmICh0aGlzLmlzRGVidWcpIHsgXHJcblx0XHRcdFx0dGhpcy5tYXAuYWRkTGF5ZXIodGhpcy5kZWJ1Z0xheWVyR1BTKTtcclxuXHRcdFx0XHR0aGlzLm1hcC5hZGRMYXllcih0aGlzLnRlc3RMYXllcik7XHJcblx0XHRcdFx0dGhpcy5tYXAuYWRkTGF5ZXIodGhpcy50ZXN0TGF5ZXIxKTtcclxuXHRcdFx0XHR0aGlzLm1hcC5hZGRMYXllcih0aGlzLnRlc3RMYXllcjIpO1xyXG5cdFx0XHR9XHJcblx0XHRcdFRSQUNLLmluaXQoKTtcclxuXHRcdFx0dGhpcy5hZGRUcmFja0ZlYXR1cmUoKTtcclxuXHRcdFx0Ly8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0XHRcdGlmICghdGhpcy5pc1dpZGdldCkge1xyXG5cdFx0XHRcdHRoaXMubWFwLm9uKCdjbGljaycsIGZ1bmN0aW9uIChldmVudCkge1xyXG5cdFx0XHRcdFx0VFJBQ0sub25NYXBDbGljayhldmVudCk7XHJcblx0XHRcdFx0XHR2YXIgc2VsZWN0ZWRQYXJ0aWNpcGFudHMgPSBbXTtcclxuXHRcdFx0XHRcdHZhciBzZWxlY3RlZEhvdHNwb3QgPSBudWxsO1xyXG5cdFx0XHRcdFx0dGhpcy5tYXAuZm9yRWFjaEZlYXR1cmVBdFBpeGVsKGV2ZW50LnBpeGVsLCBmdW5jdGlvbiAoZmVhdHVyZSwgbGF5ZXIpIHtcclxuXHRcdFx0XHRcdFx0aWYgKGxheWVyID09IHRoaXMucGFydGljaXBhbnRzTGF5ZXIpIHtcclxuXHRcdFx0XHRcdFx0XHRzZWxlY3RlZFBhcnRpY2lwYW50cy5wdXNoKGZlYXR1cmUpO1xyXG5cdFx0XHRcdFx0XHR9IGVsc2UgaWYgKGxheWVyID09IHRoaXMuaG90c3BvdHNMYXllcikge1xyXG5cdFx0XHRcdFx0XHRcdC8vIGFsbG93IG9ubHkgb25lIGhvdHNwb3QgdG8gYmUgc2VsZWN0ZWQgYXQgYSB0aW1lXHJcblx0XHRcdFx0XHRcdFx0aWYgKCFzZWxlY3RlZEhvdHNwb3QpXHJcblx0XHRcdFx0XHRcdFx0XHRzZWxlY3RlZEhvdHNwb3QgPSBmZWF0dXJlO1xyXG5cdFx0XHRcdFx0XHR9XHJcblx0XHRcdFx0XHR9LCB0aGlzKTtcclxuXHJcblx0XHRcdFx0XHQvLyBmaXJzdCBpZiB0aGVyZSBhcmUgc2VsZWN0ZWQgcGFydGljaXBhbnRzIHRoZW4gc2hvdyB0aGVpciBwb3B1cHNcclxuXHRcdFx0XHRcdC8vIGFuZCBvbmx5IGlmIHRoZXJlIGFyZSBub3QgdXNlIHRoZSBzZWxlY3RlZCBob3RzcG90IGlmIHRoZXJlJ3MgYW55XHJcblx0XHRcdFx0XHRpZiAoc2VsZWN0ZWRQYXJ0aWNpcGFudHMubGVuZ3RoKSB7XHJcblx0XHRcdFx0XHRcdGlmICh0aGlzLnNlbGVjdGVkUGFydGljaXBhbnQxID09IG51bGwpIHtcclxuXHRcdFx0XHRcdFx0XHR2YXIgZmVhdCA9IHRoaXMuZ2V0U2VsZWN0ZWRQYXJ0aWNpcGFudEZyb21BcnJheUN5Y2xpYyhzZWxlY3RlZFBhcnRpY2lwYW50cyk7XHJcblx0XHRcdFx0XHRcdFx0aWYgKGZlYXQpXHJcblx0XHRcdFx0XHRcdFx0XHR0aGlzLnNldFNlbGVjdGVkUGFydGljaXBhbnQxKGZlYXQucGFydGljaXBhbnQpO1xyXG5cdFx0XHRcdFx0XHRcdGVsc2VcclxuXHRcdFx0XHRcdFx0XHRcdHRoaXMuc2V0U2VsZWN0ZWRQYXJ0aWNpcGFudDEobnVsbCk7XHJcblx0XHRcdFx0XHRcdFx0dGhpcy5zZWxlY3ROdW0gPSAwO1xyXG5cdFx0XHRcdFx0XHR9IGVsc2UgaWYgKHRoaXMuc2VsZWN0ZWRQYXJ0aWNpcGFudDIgPT0gbnVsbCkge1xyXG5cdFx0XHRcdFx0XHRcdHZhciBmZWF0ID0gdGhpcy5nZXRTZWxlY3RlZFBhcnRpY2lwYW50RnJvbUFycmF5Q3ljbGljKHNlbGVjdGVkUGFydGljaXBhbnRzKTtcclxuXHRcdFx0XHRcdFx0XHRpZiAoZmVhdClcclxuXHRcdFx0XHRcdFx0XHRcdHRoaXMuc2V0U2VsZWN0ZWRQYXJ0aWNpcGFudDIoZmVhdC5wYXJ0aWNpcGFudCk7XHJcblx0XHRcdFx0XHRcdFx0ZWxzZVxyXG5cdFx0XHRcdFx0XHRcdFx0dGhpcy5zZXRTZWxlY3RlZFBhcnRpY2lwYW50MihudWxsKTtcclxuXHRcdFx0XHRcdFx0XHR0aGlzLnNlbGVjdE51bSA9IDE7XHJcblx0XHRcdFx0XHRcdH0gZWxzZSB7XHJcblx0XHRcdFx0XHRcdFx0dGhpcy5zZWxlY3ROdW0gPSAodGhpcy5zZWxlY3ROdW0gKyAxKSAlIDI7XHJcblx0XHRcdFx0XHRcdFx0aWYgKHRoaXMuc2VsZWN0TnVtID09IDApIHtcclxuXHRcdFx0XHRcdFx0XHRcdHZhciBmZWF0ID0gdGhpcy5nZXRTZWxlY3RlZFBhcnRpY2lwYW50RnJvbUFycmF5Q3ljbGljKHNlbGVjdGVkUGFydGljaXBhbnRzKTtcclxuXHRcdFx0XHRcdFx0XHRcdGlmIChmZWF0KVxyXG5cdFx0XHRcdFx0XHRcdFx0XHR0aGlzLnNldFNlbGVjdGVkUGFydGljaXBhbnQxKGZlYXQucGFydGljaXBhbnQpO1xyXG5cdFx0XHRcdFx0XHRcdFx0ZWxzZVxyXG5cdFx0XHRcdFx0XHRcdFx0XHR0aGlzLnNldFNlbGVjdGVkUGFydGljaXBhbnQxKG51bGwpO1xyXG5cdFx0XHRcdFx0XHRcdH0gZWxzZSB7XHJcblx0XHRcdFx0XHRcdFx0XHR2YXIgZmVhdCA9IHRoaXMuZ2V0U2VsZWN0ZWRQYXJ0aWNpcGFudEZyb21BcnJheUN5Y2xpYyhzZWxlY3RlZFBhcnRpY2lwYW50cyk7XHJcblx0XHRcdFx0XHRcdFx0XHRpZiAoZmVhdClcclxuXHRcdFx0XHRcdFx0XHRcdFx0dGhpcy5zZXRTZWxlY3RlZFBhcnRpY2lwYW50MihmZWF0LnBhcnRpY2lwYW50KTtcclxuXHRcdFx0XHRcdFx0XHRcdGVsc2VcclxuXHRcdFx0XHRcdFx0XHRcdFx0dGhpcy5zZXRTZWxlY3RlZFBhcnRpY2lwYW50MihudWxsKTtcclxuXHRcdFx0XHRcdFx0XHR9XHJcblx0XHRcdFx0XHRcdH1cclxuXHRcdFx0XHRcdH0gZWxzZSB7XHJcblx0XHRcdFx0XHRcdHRoaXMuc2V0U2VsZWN0ZWRQYXJ0aWNpcGFudDEobnVsbCk7XHJcblx0XHRcdFx0XHRcdHRoaXMuc2V0U2VsZWN0ZWRQYXJ0aWNpcGFudDIobnVsbCk7XHJcblxyXG5cdFx0XHRcdFx0XHRpZiAoc2VsZWN0ZWRIb3RzcG90KSB7XHJcblx0XHRcdFx0XHRcdFx0c2VsZWN0ZWRIb3RzcG90LmhvdHNwb3Qub25DbGljaygpO1xyXG5cdFx0XHRcdFx0XHR9XHJcblx0XHRcdFx0XHR9XHJcblx0XHRcdFx0fSwgdGhpcyk7XHJcblxyXG5cdFx0XHRcdC8vIGNoYW5nZSBtb3VzZSBjdXJzb3Igd2hlbiBvdmVyIHNwZWNpZmljIGZlYXR1cmVzXHJcblx0XHRcdFx0dmFyIHNlbGYgPSB0aGlzO1xyXG5cdFx0XHRcdCQodGhpcy5tYXAuZ2V0Vmlld3BvcnQoKSkub24oJ21vdXNlbW92ZScsIGZ1bmN0aW9uIChlKSB7XHJcblx0XHRcdFx0XHR2YXIgcGl4ZWwgPSBzZWxmLm1hcC5nZXRFdmVudFBpeGVsKGUub3JpZ2luYWxFdmVudCk7XHJcblx0XHRcdFx0XHR2YXIgaXNDbGlja2FibGUgPSBzZWxmLm1hcC5mb3JFYWNoRmVhdHVyZUF0UGl4ZWwocGl4ZWwsIGZ1bmN0aW9uIChmZWF0dXJlLCBsYXllcikge1xyXG5cdFx0XHRcdFx0XHRpZiAobGF5ZXIgPT09IHNlbGYucGFydGljaXBhbnRzTGF5ZXIgfHwgbGF5ZXIgPT09IHNlbGYuY2Ftc0xheWVyKSB7XHJcblx0XHRcdFx0XHRcdFx0Ly8gYWxsIHBhcnRpY2lwYW50cyBhbmQgbW92aW5nIGNhbWVyYXMgYXJlIGNsaWNrYWJsZVxyXG5cdFx0XHRcdFx0XHRcdHJldHVybiB0cnVlO1xyXG5cdFx0XHRcdFx0XHR9IGVsc2UgaWYgKGxheWVyID09PSBzZWxmLmhvdHNwb3RzTGF5ZXIpIHtcclxuXHRcdFx0XHRcdFx0XHQvLyBnZXQgXCJjbGlja2FiaWxpdHlcIiBmcm9tIHRoZSBob3RzcG90XHJcblx0XHRcdFx0XHRcdFx0cmV0dXJuIGZlYXR1cmUuaG90c3BvdC5pc0NsaWNrYWJsZSgpO1xyXG5cdFx0XHRcdFx0XHR9XHJcblx0XHRcdFx0XHR9KTtcclxuXHRcdFx0XHRcdHNlbGYubWFwLmdldFZpZXdwb3J0KCkuc3R5bGUuY3Vyc29yID0gaXNDbGlja2FibGUgPyAncG9pbnRlcicgOiAnJztcclxuXHRcdFx0XHR9KTtcclxuXHRcdFx0fVxyXG5cdFx0XHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0XHRcdGlmICghdGhpcy5fYW5pbWF0aW9uSW5pdCkge1xyXG5cdFx0XHRcdHRoaXMuX2FuaW1hdGlvbkluaXQ9dHJ1ZTtcclxuXHRcdFx0XHRzZXRJbnRlcnZhbCh0aGlzLm9uQW5pbWF0aW9uLmJpbmQodGhpcyksIDEwMDAqQ09ORklHLnRpbWVvdXRzLmFuaW1hdGlvbkZyYW1lICk7XHJcblx0XHRcdH1cclxuXHJcblx0XHRcdC8vIGlmIHRoaXMgaXMgT04gdGhlbiBpdCB3aWxsIHNob3cgdGhlIGNvb3JkaW5hdGVzIHBvc2l0aW9uIHVuZGVyIHRoZSBtb3VzZSBsb2NhdGlvblxyXG5cdFx0XHRpZiAodGhpcy5pc0RlYnVnU2hvd1Bvc2l0aW9uKSB7XHJcblx0XHRcdFx0JChcIiNtYXBcIikuYXBwZW5kKCc8cCBpZD1cImRlYnVnU2hvd1Bvc2l0aW9uXCI+RVBTRzozODU3IDxzcGFuIGlkPVwibW91c2UzODU3XCI+PC9zcGFuPiAmbmJzcDsgRVBTRzo0MzI2IDxzcGFuIGlkPVwibW91c2U0MzI2XCI+PC9zcGFuPicpO1xyXG5cdFx0XHRcdHRoaXMubWFwLm9uKCdwb2ludGVybW92ZScsIGZ1bmN0aW9uKGV2ZW50KSB7XHJcblx0XHRcdFx0XHR2YXIgY29vcmQzODU3ID0gZXZlbnQuY29vcmRpbmF0ZTtcclxuXHRcdFx0XHRcdHZhciBjb29yZDQzMjYgPSBvbC5wcm9qLnRyYW5zZm9ybShjb29yZDM4NTcsICdFUFNHOjM4NTcnLCAnRVBTRzo0MzI2Jyk7XHJcblx0XHRcdFx0XHQkKCcjbW91c2UzODU3JykudGV4dChvbC5jb29yZGluYXRlLnRvU3RyaW5nWFkoY29vcmQzODU3LCAyKSk7XHJcblx0XHRcdFx0XHQkKCcjbW91c2U0MzI2JykudGV4dChvbC5jb29yZGluYXRlLnRvU3RyaW5nWFkoY29vcmQ0MzI2LCAxNSkpO1xyXG5cdFx0XHRcdH0pO1xyXG5cdFx0XHR9XHJcblxyXG5cdFx0XHQvLyBwYXNzIHRoZSBpZCBvZiB0aGUgRE9NIGVsZW1lbnRcclxuXHRcdFx0dGhpcy5saXZlU3RyZWFtID0gbmV3IExpdmVTdHJlYW0oe2lkIDogXCJsaXZlU3RyZWFtXCJ9KTtcclxuICAgICAgICB9LFxyXG5cdFx0XHJcbiAgICAgICAgXHJcbiAgICAgICAgYWRkVHJhY2tGZWF0dXJlIDogZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgXHRUUkFDSy5pbml0KCk7XHJcbiAgICAgICAgXHRpZiAoVFJBQ0suZmVhdHVyZSkge1xyXG4gICAgICAgIFx0XHR2YXIgZnQgPSB0aGlzLnRyYWNrTGF5ZXIuZ2V0U291cmNlKCkuZ2V0RmVhdHVyZXMoKTtcclxuICAgICAgICBcdFx0dmFyIG9rPWZhbHNlO1xyXG4gICAgICAgIFx0XHRmb3IgKHZhciBpPTA7aTxmdC5sZW5ndGg7aSsrKSBcclxuICAgICAgICBcdFx0e1xyXG4gICAgICAgIFx0XHRcdGlmIChmdFtpXSA9PSBUUkFDSy5mZWF0dXJlKVxyXG4gICAgICAgIFx0XHRcdHtcclxuICAgICAgICBcdFx0XHRcdG9rPXRydWU7XHJcbiAgICAgICAgXHRcdFx0XHRicmVhaztcclxuICAgICAgICBcdFx0XHR9XHJcbiAgICAgICAgXHRcdH1cclxuICAgICAgICBcdFx0aWYgKCFvaylcclxuICAgICAgICBcdFx0XHR0aGlzLnRyYWNrTGF5ZXIuZ2V0U291cmNlKCkuYWRkRmVhdHVyZShUUkFDSy5mZWF0dXJlKTtcclxuICAgICAgICBcdH1cclxuICAgICAgICB9LFxyXG4gICAgICAgIHpvb21Ub1RyYWNrIDogZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgICAgIHZhciBleHRlbnQgPSBUUkFDSy5nZXRSb3V0ZSgpICYmIFRSQUNLLmdldFJvdXRlKCkubGVuZ3RoID4gMSA/IG9sLnByb2oudHJhbnNmb3JtRXh0ZW50KCAobmV3IG9sLmdlb20uTGluZVN0cmluZyhUUkFDSy5nZXRSb3V0ZSgpKSkuZ2V0RXh0ZW50KCkgLCAnRVBTRzo0MzI2JywgJ0VQU0c6Mzg1NycpIDogbnVsbDtcclxuICAgICAgICAgICAgaWYgKGV4dGVudClcclxuICAgICAgICAgICAgXHR0aGlzLm1hcC5nZXRWaWV3KCkuZml0RXh0ZW50KGV4dGVudCx0aGlzLm1hcC5nZXRTaXplKCkpO1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgXHJcbiAgICAgICAgZ2V0U2VsZWN0ZWRQYXJ0aWNpcGFudEZyb21BcnJheUN5Y2xpYyA6IGZ1bmN0aW9uKGZlYXR1cmVzKSB7XHJcbiAgICBcdFx0dmFyIGFyciA9IFtdO1xyXG4gICAgXHRcdHZhciB0bWFwID0ge307XHJcbiAgICBcdFx0dmFyIGNyclBvcyA9IDA7XHJcblx0XHRcdHZhciBwb3M9bnVsbDtcclxuICAgIFx0XHRmb3IgKHZhciBpPTA7aTxmZWF0dXJlcy5sZW5ndGg7aSsrKSB7XHJcbiAgICBcdFx0XHR2YXIgZmVhdHVyZSA9IGZlYXR1cmVzW2ldO1xyXG4gICAgXHRcdFx0dmFyIGlkID0gZmVhdHVyZS5wYXJ0aWNpcGFudC5jb2RlO1xyXG4gICAgXHRcdFx0YXJyLnB1c2goaWQpO1xyXG4gICAgXHRcdFx0dG1hcFtpZF09dHJ1ZTtcclxuXHRcdFx0XHRpZiAoaWQgPT0gdGhpcy52cl9sYXN0c2VsZWN0ZWQpIHtcclxuXHRcdFx0XHRcdHBvcz1pO1xyXG5cdFx0XHRcdH1cclxuICAgIFx0XHR9XHJcbiAgICBcdFx0dmFyIHNhbWUgPSB0aGlzLnZyX29sZGJlc3RhcnIgJiYgcG9zICE9IG51bGw7IFxyXG4gICAgXHRcdGlmIChzYW1lKSBcclxuICAgIFx0XHR7XHJcbiAgICBcdFx0XHQvLyBhbGwgZnJvbSB0aGUgb2xkIGNvbnRhaW5lZCBpbiB0aGUgbmV3XHJcbiAgICBcdFx0XHRmb3IgKHZhciBpPTA7aTx0aGlzLnZyX29sZGJlc3RhcnIubGVuZ3RoO2krKykgXHJcbiAgICBcdFx0XHR7XHJcbiAgICBcdFx0XHRcdGlmICghdG1hcFt0aGlzLnZyX29sZGJlc3RhcnJbaV1dKSB7XHJcbiAgICBcdFx0XHRcdFx0c2FtZT1mYWxzZTtcclxuICAgIFx0XHRcdFx0XHRicmVhaztcclxuICAgIFx0XHRcdFx0fVxyXG4gICAgXHRcdFx0fVxyXG4gICAgXHRcdH1cclxuICAgIFx0XHRpZiAoIXNhbWUpIHtcclxuICAgIFx0XHRcdHRoaXMudnJfb2xkYmVzdGFycj1hcnI7XHJcbiAgICBcdFx0XHR0aGlzLnZyX2xhc3RzZWxlY3RlZD1hcnJbMF07XHJcbiAgICBcdFx0XHRyZXR1cm4gZmVhdHVyZXNbMF07XHJcbiAgICBcdFx0fSBlbHNlIHtcclxuICAgIFx0XHRcdHRoaXMudnJfbGFzdHNlbGVjdGVkID0gcG9zID4gMCA/IGFycltwb3MtMV0gOiBhcnJbYXJyLmxlbmd0aC0xXTsgICAgXHRcdFx0XHJcbiAgICAgICAgXHRcdHZhciByZXN1bHRGZWF0dXJlO1xyXG4gICAgXHRcdFx0Zm9yICh2YXIgaT0wO2k8ZmVhdHVyZXMubGVuZ3RoO2krKykgXHJcbiAgICAgICAgXHRcdHtcclxuICAgICAgICBcdFx0XHR2YXIgZmVhdHVyZSA9IGZlYXR1cmVzW2ldO1xyXG4gICAgICAgIFx0XHRcdHZhciBpZCA9IGZlYXR1cmUucGFydGljaXBhbnQuY29kZTtcclxuICAgICAgICBcdFx0XHRpZiAoaWQgPT0gdGhpcy52cl9sYXN0c2VsZWN0ZWQpIHtcclxuICAgICAgICBcdFx0XHRcdHJlc3VsdEZlYXR1cmU9ZmVhdHVyZTtcclxuICAgICAgICBcdFx0XHRcdGJyZWFrO1xyXG4gICAgICAgIFx0XHRcdH1cclxuICAgICAgICBcdFx0fVxyXG4gICAgICAgICAgICAgICAgcmV0dXJuIHJlc3VsdEZlYXR1cmU7XHJcbiAgICBcdFx0fVxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgXHJcblx0XHRzaG93RXJyb3IgOiBmdW5jdGlvbihtc2csb25DbG9zZUNhbGxiYWNrKVxyXG5cdFx0e1xyXG5cdFx0XHRhbGVydChcIkVSUk9SIDogXCIrbXNnKTtcclxuXHRcdFx0aWYgKG9uQ2xvc2VDYWxsYmFjaykgXHJcblx0XHRcdFx0b25DbG9zZUNhbGxiYWNrKCk7XHJcblx0XHR9LFxyXG5cdFx0XHJcblx0XHRvbkFuaW1hdGlvbiA6IGZ1bmN0aW9uKClcclxuXHRcdHtcclxuXHRcdFx0dmFyIGFycj1bXTtcclxuXHRcdFx0Zm9yICh2YXIgaXA9MDtpcDxUUkFDSy5wYXJ0aWNpcGFudHMubGVuZ3RoO2lwKyspXHJcblx0XHRcdHtcclxuXHRcdFx0XHR2YXIgcCA9IFRSQUNLLnBhcnRpY2lwYW50c1tpcF07XHJcblx0XHRcdFx0aWYgKHAuaXNGYXZvcml0ZSlcclxuXHRcdFx0XHR7XHJcblx0XHRcdFx0XHRwLmludGVycG9sYXRlKCk7XHJcblxyXG5cdFx0XHRcdFx0Ly8gdGhpcyB3aWxsIGFkZCBpbiB0aGUgcmFua2luZyBwb3NpdGluZyBvbmx5IHRoZSBwYXJ0aWNpcGFudHMgdGhlIGhhcyB0byBiZSB0cmFja2VkXHJcblx0XHRcdFx0XHQvLyBzbyBtb3ZpbmcgY2FtcyBhcmUgc2tpcHBlZFxyXG5cdFx0XHRcdFx0aWYgKCFwLl9fc2tpcFRyYWNraW5nUG9zKVxyXG5cdFx0XHRcdFx0XHRhcnIucHVzaChpcCk7XHJcblx0XHRcdFx0fVxyXG5cdFx0XHR9XHJcblx0XHRcdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdFx0XHQvLyB3ZSBoYXZlIHRvIHNvcnQgdGhlbSBvdGhlcndpc2UgdGhpcyBfX3BvcywgX19wcmV2LCBfX25leHQgYXJlIGlycmVsZXZhbnRcclxuXHRcdFx0YXJyLnNvcnQoZnVuY3Rpb24oaXAxLCBpZDIpe1xyXG5cdFx0XHRcdHJldHVybiBUUkFDSy5wYXJ0aWNpcGFudHNbaWQyXS5nZXRFbGFwc2VkKCkgLSBUUkFDSy5wYXJ0aWNpcGFudHNbaXAxXS5nZXRFbGFwc2VkKCk7XHJcblx0XHRcdH0pO1xyXG5cdFx0XHRmb3IgKHZhciBpcD0wO2lwPGFyci5sZW5ndGg7aXArKylcclxuXHRcdFx0e1xyXG5cdFx0XHRcdFRSQUNLLnBhcnRpY2lwYW50c1thcnJbaXBdXS5fX3Bvcz1pcDtcclxuXHRcdFx0XHRpZiAoaXAgPT0gMClcclxuXHRcdFx0XHRcdGRlbGV0ZSBUUkFDSy5wYXJ0aWNpcGFudHNbYXJyW2lwXV0uX19wcmV2O1xyXG5cdFx0XHRcdGVsc2VcclxuXHRcdFx0XHRcdFRSQUNLLnBhcnRpY2lwYW50c1thcnJbaXBdXS5fX3ByZXY9VFJBQ0sucGFydGljaXBhbnRzW2FycltpcC0xXV07XHJcblx0XHRcdFx0aWYgKGlwID09IFRSQUNLLnBhcnRpY2lwYW50cy5sZW5ndGgtMSlcclxuXHRcdFx0XHRcdGRlbGV0ZSAgVFJBQ0sucGFydGljaXBhbnRzW2FycltpcF1dLl9fbmV4dDtcclxuXHRcdFx0XHRlbHNlXHJcblx0XHRcdFx0XHRUUkFDSy5wYXJ0aWNpcGFudHNbYXJyW2lwXV0uX19uZXh0PVRSQUNLLnBhcnRpY2lwYW50c1thcnJbaXArMV1dO1xyXG5cdFx0XHR9XHJcblx0XHRcdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdFx0XHRpZiAodGhpcy5zZWxlY3RlZFBhcnRpY2lwYW50MSkgXHJcblx0XHRcdHtcclxuXHRcdFx0XHR2YXIgc3BvcyA9IHRoaXMuc2VsZWN0ZWRQYXJ0aWNpcGFudDEuZ2V0RmVhdHVyZSgpLmdldEdlb21ldHJ5KCkuZ2V0Q29vcmRpbmF0ZXMoKTtcclxuXHRcdFx0XHRpZiAoIXRoaXMucG9wdXAxLmlzX3Nob3duKSB7XHJcblx0XHRcdFx0ICAgIHRoaXMucG9wdXAxLnNob3coc3BvcywgdGhpcy5wb3B1cDEubGFzdEhUTUw9dGhpcy5zZWxlY3RlZFBhcnRpY2lwYW50MS5nZXRQb3B1cEhUTUwoKSk7XHJcblx0XHRcdFx0ICAgIHRoaXMucG9wdXAxLmlzX3Nob3duPTE7XHJcblx0XHRcdFx0fSBlbHNlIHtcclxuXHRcdFx0XHRcdGlmICghdGhpcy5wb3B1cDEuZ2V0UG9zaXRpb24oKSB8fCB0aGlzLnBvcHVwMS5nZXRQb3NpdGlvbigpWzBdICE9IHNwb3NbMF0gfHwgdGhpcy5wb3B1cDEuZ2V0UG9zaXRpb24oKVsxXSAhPSBzcG9zWzFdKVxyXG5cdFx0XHRcdFx0ICAgIHRoaXMucG9wdXAxLnNldFBvc2l0aW9uKHNwb3MpO1xyXG5cdFx0XHRcdFx0dmFyIGN0aW1lID0gKG5ldyBEYXRlKCkpLmdldFRpbWUoKTtcdFx0XHQgXHJcblx0XHRcdFx0XHRpZiAoIXRoaXMubGFzdFBvcHVwUmVmZXJlc2gxIHx8IGN0aW1lIC0gdGhpcy5sYXN0UG9wdXBSZWZlcmVzaDEgPiAyMDAwKSBcclxuXHRcdFx0XHRcdHtcclxuXHRcdFx0XHRcdFx0dGhpcy5sYXN0UG9wdXBSZWZlcmVzaDE9Y3RpbWU7XHJcblx0XHRcdFx0XHQgICAgdmFyIHJyID0gdGhpcy5zZWxlY3RlZFBhcnRpY2lwYW50MS5nZXRQb3B1cEhUTUwoKTtcclxuXHRcdFx0XHRcdCAgICBpZiAocnIgIT0gdGhpcy5wb3B1cDEubGFzdEhUTUwpIHtcclxuXHRcdFx0XHRcdCAgICBcdHRoaXMucG9wdXAxLmxhc3RIVE1MPXJyO1xyXG5cdFx0XHRcdFx0XHQgICAgdGhpcy5wb3B1cDEuY29udGVudC5pbm5lckhUTUw9cnI7IFxyXG5cdFx0XHRcdFx0ICAgIH1cdFx0XHRcdFx0XHJcblx0XHRcdFx0XHR9XHJcblx0XHRcdFx0ICAgIHRoaXMucG9wdXAxLnBhbkludG9WaWV3XyhzcG9zKTtcclxuXHRcdFx0XHR9XHJcblx0XHRcdH1cclxuXHRcdFx0aWYgKHRoaXMuc2VsZWN0ZWRQYXJ0aWNpcGFudDIpIFxyXG5cdFx0XHR7XHJcblx0XHRcdFx0dmFyIHNwb3MgPSB0aGlzLnNlbGVjdGVkUGFydGljaXBhbnQyLmdldEZlYXR1cmUoKS5nZXRHZW9tZXRyeSgpLmdldENvb3JkaW5hdGVzKCk7XHJcblx0XHRcdFx0aWYgKCF0aGlzLnBvcHVwMi5pc19zaG93bikge1xyXG5cdFx0XHRcdCAgICB0aGlzLnBvcHVwMi5zaG93KHNwb3MsIHRoaXMucG9wdXAyLmxhc3RIVE1MPXRoaXMuc2VsZWN0ZWRQYXJ0aWNpcGFudDIuZ2V0UG9wdXBIVE1MKCkpO1xyXG5cdFx0XHRcdCAgICB0aGlzLnBvcHVwMi5pc19zaG93bj0xO1xyXG5cdFx0XHRcdH0gZWxzZSB7XHJcblx0XHRcdFx0XHRpZiAoIXRoaXMucG9wdXAyLmdldFBvc2l0aW9uKCkgfHwgdGhpcy5wb3B1cDIuZ2V0UG9zaXRpb24oKVswXSAhPSBzcG9zWzBdIHx8IHRoaXMucG9wdXAyLmdldFBvc2l0aW9uKClbMV0gIT0gc3Bvc1sxXSlcclxuXHRcdFx0XHRcdCAgICB0aGlzLnBvcHVwMi5zZXRQb3NpdGlvbihzcG9zKTtcclxuXHRcdFx0XHRcdHZhciBjdGltZSA9IChuZXcgRGF0ZSgpKS5nZXRUaW1lKCk7XHRcdFx0IFxyXG5cdFx0XHRcdFx0aWYgKCF0aGlzLmxhc3RQb3B1cFJlZmVyZXNoMiB8fCBjdGltZSAtIHRoaXMubGFzdFBvcHVwUmVmZXJlc2gyID4gMjAwMCkgXHJcblx0XHRcdFx0XHR7XHJcblx0XHRcdFx0XHRcdHRoaXMubGFzdFBvcHVwUmVmZXJlc2gyPWN0aW1lO1xyXG5cdFx0XHRcdFx0ICAgIHZhciByciA9IHRoaXMuc2VsZWN0ZWRQYXJ0aWNpcGFudDIuZ2V0UG9wdXBIVE1MKCk7XHJcblx0XHRcdFx0XHQgICAgaWYgKHJyICE9IHRoaXMucG9wdXAyLmxhc3RIVE1MKSB7XHJcblx0XHRcdFx0XHQgICAgXHR0aGlzLnBvcHVwMi5sYXN0SFRNTD1ycjtcclxuXHRcdFx0XHRcdFx0ICAgIHRoaXMucG9wdXAyLmNvbnRlbnQuaW5uZXJIVE1MPXJyOyBcclxuXHRcdFx0XHRcdCAgICB9XHRcdFx0XHRcdFxyXG5cdFx0XHRcdFx0fVxyXG5cdFx0XHRcdCAgICB0aGlzLnBvcHVwMi5wYW5JbnRvVmlld18oc3Bvcyk7XHJcblx0XHRcdFx0fVxyXG5cdFx0XHR9XHJcblx0XHRcdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS1cdFx0XHRcclxuXHRcdFx0aWYgKHRoaXMuaXNEZWJ1ZykgIFxyXG5cdFx0XHRcdHRoaXMuZG9EZWJ1Z0FuaW1hdGlvbigpO1xyXG5cdFx0fSxcclxuXHRcdFxyXG5cdFx0c2V0U2VsZWN0ZWRQYXJ0aWNpcGFudDEgOiBmdW5jdGlvbihwYXJ0LGNlbnRlcikge1xyXG5cdFx0XHQvLyBUT0RPIFJ1bWVuIC0gbWVyZ2Ugc2V0U2VsZWN0ZWRQYXJ0aWNpcGFudDEgYW5kIHNldFNlbGVjdGVkUGFydGljaXBhbnQyIGluIG9ubHkgb25lIG1ldGhvZFxyXG5cdFx0XHQvLyBUT0RPIFJ1bWVuIC0gYW5kIHVzZSBvbmx5IGl0IC0gcHJvYmFibHkgbWVyZ2UgdGhlbSB0b2dldGhlciBhbHNvIHdpdGggc2V0U2VsZWN0ZWRQYXJ0aWNpcGFudFxyXG5cdFx0XHR0aGlzLnNlbGVjdGVkUGFydGljaXBhbnQxPXBhcnQ7XHJcblx0XHRcdGlmICghcGFydCkge1xyXG5cdFx0XHRcdHRoaXMucG9wdXAxLmhpZGUoKTtcclxuXHRcdFx0XHRkZWxldGUgdGhpcy5wb3B1cDEuaXNfc2hvd247XHJcblx0XHRcdH0gZWxzZSB7XHJcblx0XHRcdFx0dGhpcy5sYXN0UG9wdXBSZWZlcmVzaDE9MDtcclxuXHRcdFx0XHRpZiAoY2VudGVyICYmIEdVSS5tYXAgJiYgcGFydC5mZWF0dXJlKSB7XHJcblx0XHRcdFx0XHR2YXIgeCA9IChwYXJ0LmZlYXR1cmUuZ2V0R2VvbWV0cnkoKS5nZXRFeHRlbnQoKVswXStwYXJ0LmZlYXR1cmUuZ2V0R2VvbWV0cnkoKS5nZXRFeHRlbnQoKVsyXSkvMjtcclxuXHRcdFx0XHRcdHZhciB5ID0gKHBhcnQuZmVhdHVyZS5nZXRHZW9tZXRyeSgpLmdldEV4dGVudCgpWzFdK3BhcnQuZmVhdHVyZS5nZXRHZW9tZXRyeSgpLmdldEV4dGVudCgpWzNdKS8yO1xyXG5cdFx0XHRcdFx0R1VJLm1hcC5nZXRWaWV3KCkuc2V0Q2VudGVyKFt4LHldKTtcclxuXHRcdFx0XHR9XHJcblx0XHRcdH0gXHJcblx0XHR9LFxyXG5cclxuXHRcdHNldFNlbGVjdGVkUGFydGljaXBhbnQyIDogZnVuY3Rpb24ocGFydCxjZW50ZXIpIHtcclxuXHRcdFx0dGhpcy5zZWxlY3RlZFBhcnRpY2lwYW50Mj1wYXJ0O1xyXG5cdFx0XHRpZiAoIXBhcnQpIHtcclxuXHRcdFx0XHR0aGlzLnBvcHVwMi5oaWRlKCk7XHJcblx0XHRcdFx0ZGVsZXRlIHRoaXMucG9wdXAyLmlzX3Nob3duO1xyXG5cdFx0XHR9IGVsc2Uge1xyXG5cdFx0XHRcdHRoaXMubGFzdFBvcHVwUmVmZXJlc2gyPTA7XHJcblx0XHRcdFx0aWYgKGNlbnRlciAmJiBHVUkubWFwICYmIHBhcnQuZmVhdHVyZSkge1xyXG5cdFx0XHRcdFx0dmFyIHggPSAocGFydC5mZWF0dXJlLmdldEdlb21ldHJ5KCkuZ2V0RXh0ZW50KClbMF0rcGFydC5mZWF0dXJlLmdldEdlb21ldHJ5KCkuZ2V0RXh0ZW50KClbMl0pLzI7XHJcblx0XHRcdFx0XHR2YXIgeSA9IChwYXJ0LmZlYXR1cmUuZ2V0R2VvbWV0cnkoKS5nZXRFeHRlbnQoKVsxXStwYXJ0LmZlYXR1cmUuZ2V0R2VvbWV0cnkoKS5nZXRFeHRlbnQoKVszXSkvMjtcclxuXHRcdFx0XHRcdEdVSS5tYXAuZ2V0VmlldygpLnNldENlbnRlcihbeCx5XSk7XHJcblx0XHRcdFx0fVxyXG5cdFx0XHR9IFxyXG5cdFx0fSxcclxuXHJcblx0XHRzZXRTZWxlY3RlZFBhcnRpY2lwYW50IDogZnVuY3Rpb24ocGFydCkge1xyXG5cdFx0XHRpZiAoIXRoaXMucG9wdXAxLmlzX3Nob3duKSAge1xyXG5cdFx0XHRcdHRoaXMuc2V0U2VsZWN0ZWRQYXJ0aWNpcGFudDEocGFydCwgdHJ1ZSk7XHJcblx0XHRcdH0gZWxzZSBpZiAoIXRoaXMucG9wdXAyLmlzX3Nob3duKSB7XHJcblx0XHRcdFx0dGhpcy5zZXRTZWxlY3RlZFBhcnRpY2lwYW50MihwYXJ0LCB0cnVlKTtcclxuXHRcdFx0fSBlbHNlIHtcclxuXHRcdFx0XHR0aGlzLnNldFNlbGVjdGVkUGFydGljaXBhbnQxKHBhcnQsIHRydWUpO1xyXG5cdFx0XHR9XHJcblx0XHR9LFxyXG5cclxuXHRcdGRvRGVidWdBbmltYXRpb24gOiBmdW5jdGlvbigpIFxyXG5cdFx0e1xyXG5cdFx0XHR2YXIgY3RpbWUgPSAobmV3IERhdGUoKSkuZ2V0VGltZSgpO1xyXG5cdFx0XHR2YXIgdG9kZWw9W107XHJcblx0XHRcdHZhciByciA9IHRoaXMuZGVidWdMYXllckdQUy5nZXRTb3VyY2UoKS5nZXRGZWF0dXJlcygpO1xyXG5cdFx0XHRmb3IgKHZhciBpPTA7aTxyci5sZW5ndGg7aSsrKVxyXG5cdFx0XHR7XHJcblx0XHRcdFx0dmFyIGYgPSBycltpXTtcclxuXHRcdFx0XHRpZiAoY3RpbWUgLSBmLnRpbWVDcmVhdGVkIC0gQ09ORklHLm1hdGguZGlzcGxheURlbGF5KjEwMDAgPiBDT05GSUcudGltZW91dHMuZ3BzTG9jYXRpb25EZWJ1Z1Nob3cqMTAwMClcclxuXHRcdFx0XHRcdHRvZGVsLnB1c2goZik7XHJcblx0XHRcdFx0ZWxzZVxyXG5cdFx0XHRcdFx0Zi5jaGFuZ2VkKCk7XHJcblx0XHRcdH1cclxuXHRcdFx0aWYgKHRvZGVsLmxlbmd0aCkgXHJcblx0XHRcdHtcclxuXHRcdFx0XHRmb3IgKHZhciBpPTA7aTx0b2RlbC5sZW5ndGg7aSsrKVxyXG5cdFx0XHRcdFx0dGhpcy5kZWJ1Z0xheWVyR1BTLmdldFNvdXJjZSgpLnJlbW92ZUZlYXR1cmUodG9kZWxbaV0pO1xyXG5cdFx0XHR9XHJcblx0XHRcdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdFx0fSxcclxuXHRcdFxyXG5cdFx0cmVkcmF3IDogZnVuY3Rpb24oKSB7XHJcblx0XHRcdHRoaXMuZ2V0VHJhY2soKS5nZXRGZWF0dXJlKCkuY2hhbmdlZCgpO1xyXG5cdFx0fSxcclxuXHJcbiAgICAgICAgLyoqXHJcbiAgICAgICAgICogU2hvdyB0aGUgbGl2ZS1zdHJlYW1pbmcgY29udGFpbmVyLiBJZiB0aGUgcGFzc2VkICdzdHJlYW1JZCcgaXMgdmFsaWQgdGhlbiBpdCBvcGVucyBpdHMgc3RyZWFtIGRpcmVjdGx5LlxyXG4gICAgICAgICAqIEBwYXJhbSB7U3RyaW5nfSBbc3RyZWFtSWRdXHJcbiAgICAgICAgICogQHBhcmFtIHtGdW5jdGlvbn0gW2NvbXBsZXRlQ2FsbGJhY2tdXHJcbiAgICAgICAgICovXHJcbiAgICAgICAgc2hvd0xpdmVTdHJlYW0gOiBmdW5jdGlvbihzdHJlYW1JZCwgY29tcGxldGVDYWxsYmFjaykge1xyXG4gICAgICAgICAgICB0aGlzLmxpdmVTdHJlYW0uc2hvdyhzdHJlYW1JZCwgY29tcGxldGVDYWxsYmFjayk7XHJcbiAgICAgICAgfSxcclxuXHJcbiAgICAgICAgLyoqXHJcbiAgICAgICAgICogVG9nZ2xlIHRoZSBsaXZlLXN0cmVhbWluZyBjb250YWluZXIgY29udGFpbmVyXHJcblx0XHQgKiBAcGFyYW0ge0Z1bmN0aW9ufSBbY29tcGxldGVDYWxsYmFja11cclxuICAgICAgICAgKi9cclxuICAgICAgICB0b2dnbGVMaXZlU3RyZWFtOiBmdW5jdGlvbihjb21wbGV0ZUNhbGxiYWNrKSB7XHJcbiAgICAgICAgICAgIHJldHVybiB0aGlzLmxpdmVTdHJlYW0udG9nZ2xlKGNvbXBsZXRlQ2FsbGJhY2spO1xyXG4gICAgICAgIH1cclxuXHRcdFxyXG4gICAgfVxyXG59KTsiLCJyZXF1aXJlKCdqb29zZScpO1xyXG5yZXF1aXJlKCcuL1V0aWxzJyk7XHJcblxyXG5DbGFzcyhcIkxpdmVTdHJlYW1cIiwge1xyXG4gICAgaGFzIDoge1xyXG4gICAgICAgIF8kY29tcCA6IHtcclxuICAgICAgICAgICAgaW5pdDogZnVuY3Rpb24oY29uZmlnKSB7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gJCgnIycgKyBjb25maWcuaWQpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfSxcclxuXHJcbiAgICAgICAgX2lzU2hvd24gOiB7XHJcbiAgICAgICAgICAgaW5pdCA6IGZhbHNlXHJcbiAgICAgICAgfSxcclxuXHJcbiAgICAgICAgX2lzVmFsaWQgOiB7XHJcbiAgICAgICAgICAgIGluaXQgOiBmYWxzZVxyXG4gICAgICAgIH1cclxuICAgIH0sXHJcbiAgICBtZXRob2RzOiB7XHJcbiAgICAgICAgaW5pdGlhbGl6ZTogZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgICAgIHZhciBsaXZlU3RyZWFtcyA9IHdpbmRvdy5MSVZFX1NUUkVBTVM7XHJcbiAgICAgICAgICAgIGlmICghbGl2ZVN0cmVhbXMgfHwgbGl2ZVN0cmVhbXMubGVuZ3RoIDw9IDApIHtcclxuICAgICAgICAgICAgICAgIGNvbnNvbGUud2FybihcIk5vIGxpdmUgc3RyZWFtcyBzZXRcIik7XHJcbiAgICAgICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIC8vIGluaXRpYWxpemUgdGhlIHN0cmVhbXNcclxuICAgICAgICAgICAgdmFyIHNlbGYgPSB0aGlzO1xyXG4gICAgICAgICAgICB2YXIgaSA9IDA7XHJcbiAgICAgICAgICAgIHRoaXMuXyRjb21wLmZpbmQoXCIubGl2ZVN0cmVhbVRodW1iXCIpLmFkZENsYXNzKFwiaW5hY3RpdmVcIikuZWFjaChmdW5jdGlvbigpIHtcclxuICAgICAgICAgICAgICAgIHZhciBzdHJlYW0gPSBsaXZlU3RyZWFtc1tpXTtcclxuICAgICAgICAgICAgICAgIGkrKztcclxuICAgICAgICAgICAgICAgIGlmICghc3RyZWFtKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgJCh0aGlzKS5hZGRDbGFzcyhcInZhbGlkXCIpLmRhdGEoXCJpZFwiLCBzdHJlYW0uaWQpLmRhdGEoXCJ1cmxcIiwgc3RyZWFtLnVybCk7XHJcblxyXG4gICAgICAgICAgICAgICAgLy8gYXQgbGVhc3Qgb25lIHZhbGlkIHRodW1iIC0gc28gdGhlIHdob2xlIExpdmVTdHJlYW0gaXMgdmFsaWRcclxuICAgICAgICAgICAgICAgIHNlbGYuX2lzVmFsaWQgPSB0cnVlO1xyXG4gICAgICAgICAgICB9KS5maWx0ZXIoXCIudmFsaWRcIikuY2xpY2soZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgICAgICAgICB2YXIgJHRoaXMgPSAkKHRoaXMpO1xyXG5cclxuICAgICAgICAgICAgICAgIC8vIGlmIGNsaWNrZWQgb24gdGhlIHNhbWUgYWN0aXZlIHRodW1iIHRoZW4gc2tpcCBpdFxyXG4gICAgICAgICAgICAgICAgaWYgKCEkdGhpcy5oYXNDbGFzcyhcImluYWN0aXZlXCIpKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgICAgc2VsZi5fc2hvd1N0cmVhbSgkdGhpcyk7XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgIH0sXHJcblxyXG4gICAgICAgIHNob3c6IGZ1bmN0aW9uKHN0cmVhbUlkLCBjb21wbGV0ZUNhbGxiYWNrKSB7XHJcbiAgICAgICAgICAgIGlmICghdGhpcy5faXNWYWxpZClcclxuICAgICAgICAgICAgICAgcmV0dXJuO1xyXG5cclxuICAgICAgICAgICAgdmFyICR0aHVtYiA9IG51bGw7XHJcbiAgICAgICAgICAgIHZhciAkdGh1bWJzID0gdGhpcy5fJGNvbXAuZmluZChcIi5saXZlU3RyZWFtVGh1bWIudmFsaWRcIik7XHJcbiAgICAgICAgICAgIGlmICghaXNEZWZpbmVkKHN0cmVhbUlkKSkge1xyXG4gICAgICAgICAgICAgICAgJHRodW1iID0gJHRodW1icy5lcSgwKTtcclxuICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgICR0aHVtYnMuZWFjaChmdW5jdGlvbigpIHtcclxuICAgICAgICAgICAgICAgICAgICBpZiAoc3RyZWFtSWQgPT09ICQodGhpcykuZGF0YShcImlkXCIpKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICR0aHVtYiA9ICQodGhpcyk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBmYWxzZTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgaWYgKCEkdGh1bWIpIHtcclxuICAgICAgICAgICAgICAgIGNvbnNvbGUud2FybihcIk5vIHN0cmVhbSBmb3IgaWQgOiBcIiArIHN0cmVhbUlkKTtcclxuICAgICAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgdGhpcy5fc2hvd1N0cmVhbSgkdGh1bWIsIGNvbXBsZXRlQ2FsbGJhY2spO1xyXG4gICAgICAgIH0sXHJcblxyXG4gICAgICAgIC8qKlxyXG4gICAgICAgICAqXHJcbiAgICAgICAgICogQHJldHVybiB7Ym9vbGVhbn1cclxuICAgICAgICAgKi9cclxuICAgICAgICB0b2dnbGUgOiBmdW5jdGlvbihjb21wbGV0ZUNhbGxiYWNrKSB7XHJcbiAgICAgICAgICAgIGlmICghdGhpcy5faXNWYWxpZClcclxuICAgICAgICAgICAgICAgIHJldHVybjtcclxuXHJcbiAgICAgICAgICAgIC8vIGlmIHNob3duIGhpZGUgb3RoZXJ3aXNlIHNob3dcclxuICAgICAgICAgICAgaWYgKHRoaXMuX2lzU2hvd24pXHJcbiAgICAgICAgICAgICAgICB0aGlzLl9oaWRlKGNvbXBsZXRlQ2FsbGJhY2spO1xyXG4gICAgICAgICAgICBlbHNlXHJcbiAgICAgICAgICAgICAgICB0aGlzLnNob3coY29tcGxldGVDYWxsYmFjayk7XHJcblxyXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5faXNTaG93bjtcclxuICAgICAgICB9LFxyXG5cclxuICAgICAgICAvKiBQcml2YXRlIE1ldGhvZHMgKi9cclxuXHJcbiAgICAgICAgX2hpZGUgOiBmdW5jdGlvbihjb21wbGV0ZUNhbGxiYWNrKSB7XHJcbiAgICAgICAgICAgIHZhciBzZWxmID0gdGhpcztcclxuICAgICAgICAgICAgdGhpcy5fJGNvbXAuc2xpZGVVcCg0MDAsIGZ1bmN0aW9uKCkge1xyXG4gICAgICAgICAgICAgICAgLy8gc3RvcCB0aGUgc3RyZWFtIHdoZW4gd2hvbGUgcGFuZWwgaGFzIGNvbXBsZXRlZCBhbmltYXRpb25cclxuICAgICAgICAgICAgICAgIHNlbGYuXyRjb21wLmZpbmQoXCIubGl2ZVN0cmVhbVBsYXllclwiKS5lbXB0eSgpO1xyXG4gICAgICAgICAgICAgICAgY29tcGxldGVDYWxsYmFjaygpO1xyXG4gICAgICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgICAgIHRoaXMuX2lzU2hvd24gPSBmYWxzZTtcclxuICAgICAgICB9LFxyXG5cclxuICAgICAgICBfc2hvd1N0cmVhbSA6IGZ1bmN0aW9uKCR0aHVtYiwgY29tcGxldGVDYWxsYmFjaykge1xyXG4gICAgICAgICAgICAvLyB0b2dnbGUgdGhlIFwiaW5hY3RpdmVcIiBjbGFzc1xyXG4gICAgICAgICAgICB0aGlzLl8kY29tcC5maW5kKFwiLmxpdmVTdHJlYW1UaHVtYlwiKS5hZGRDbGFzcyhcImluYWN0aXZlXCIpO1xyXG4gICAgICAgICAgICAkdGh1bWIucmVtb3ZlQ2xhc3MoXCJpbmFjdGl2ZVwiKTtcclxuXHJcbiAgICAgICAgICAgIC8vIHNob3cgdGhlIG5ldyBzdHJlYW1cclxuICAgICAgICAgICAgdmFyIHVybCA9ICR0aHVtYi5kYXRhKFwidXJsXCIpO1xyXG4gICAgICAgICAgICB2YXIgJHBsYXllciA9IHRoaXMuXyRjb21wLmZpbmQoXCIubGl2ZVN0cmVhbVBsYXllclwiKTtcclxuXHJcbiAgICAgICAgICAgIC8vIHdpZHRoPTQ5MCZoZWlnaHQ9Mjc1JlxyXG4gICAgICAgICAgICAvLyB3aWR0aD1cIjQ5MFwiIGhlaWdodD1cIjI3NVwiXHJcbiAgICAgICAgICAgICRwbGF5ZXIuaHRtbCgnPGlmcmFtZSBzcmM9JyArIHVybCArICc/YXV0b1BsYXk9dHJ1ZSZtdXRlPWZhbHNlXCIgZnJhbWVib3JkZXI9XCIwXCIgc2Nyb2xsaW5nPVwibm9cIiAnK1xyXG4gICAgICAgICAgICAnYWxsb3dmdWxsc2NyZWVuIHdlYmtpdGFsbG93ZnVsbHNjcmVlbiBtb3phbGxvd2Z1bGxzY3JlZW4gb2FsbG93ZnVsbHNjcmVlbiBtc2FsbG93ZnVsbHNjcmVlbj48L2lmcmFtZT4nKTtcclxuXHJcbiAgICAgICAgICAgIC8vIHNob3cgaWYgbm90IGFscmVhZHkgc2hvd25cclxuICAgICAgICAgICAgaWYgKCF0aGlzLl9pc1Nob3duKVxyXG4gICAgICAgICAgICAgICAgdGhpcy5fJGNvbXAuc2xpZGVEb3duKDQwMCwgY29tcGxldGVDYWxsYmFjayk7XHJcbiAgICAgICAgICAgIHRoaXMuX2lzU2hvd24gPSB0cnVlO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxufSk7IiwicmVxdWlyZSgnam9vc2UnKTtcclxucmVxdWlyZSgnLi9Qb2ludCcpO1xyXG5cclxudmFyIENPTkZJRyA9IHJlcXVpcmUoJy4vQ29uZmlnJyk7XHJcbnZhciBVdGlscyA9IHJlcXVpcmUoJy4vVXRpbHMnKTtcclxudmFyIEludGVyc2VjdGlvbiA9IHJlcXVpcmUoXCJrbGQtaW50ZXJzZWN0aW9uc1wiKS5JbnRlcnNlY3Rpb247XHJcbnZhciBQb2ludDJEID0gcmVxdWlyZShcImtsZC1pbnRlcnNlY3Rpb25zXCIpLlBvaW50MkQ7XHJcblxyXG52YXIgY29lZnkgPSBDT05GSUcubWF0aC5wcm9qZWN0aW9uU2NhbGVZO1xyXG5DbGFzcyhcIlBhcnRpY2lwYW50U3RhdGVcIixcclxue1xyXG5cdGhhcyA6IHtcdFx0XHJcbiAgICBcdGRlYnVnSW5mbyA6IHtcclxuICAgIFx0XHRpcyA6IFwicndcIixcclxuICAgIFx0XHRpbml0IDogbnVsbFxyXG4gICAgXHR9LFxyXG5cdFx0c3BlZWQgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogMFxyXG5cdFx0fSxcclxuXHRcdGVsYXBzZWQgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogMFxyXG5cdFx0fSxcclxuXHQgICAgdGltZXN0YW1wIDogXHJcblx0XHR7XHJcblx0ICAgICAgICBpczogICBcInJ3XCIsXHJcblx0ICAgICAgICBpbml0OiAwXHQvL2xvbiBsYXQgd29ybGQgbWVyY2F0b3JcclxuXHQgICAgfSxcclxuXHQgICAgZ3BzIDoge1xyXG5cdCAgICBcdGlzOiAgIFwicndcIixcclxuXHQgICAgICAgIGluaXQ6IFswLDBdXHQvL2xvbiBsYXQgd29ybGQgbWVyY2F0b3JcclxuXHQgICAgfSxcclxuXHRcdGZyZXEgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogMFxyXG5cdFx0fSxcclxuXHRcdGlzU09TIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IGZhbHNlXHJcblx0XHR9LFxyXG5cdFx0YWNjZWxlcmF0aW9uIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IDBcclxuXHRcdH0sXHJcblx0XHRhbHQgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogMFxyXG5cdFx0fSxcclxuXHRcdG92ZXJhbGxSYW5rIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IDBcclxuXHRcdH0sXHJcblx0XHRnZW5kZXJSYW5rIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IDBcclxuXHRcdH0sXHJcblx0XHRncm91cFJhbmsgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogMFxyXG5cdFx0fVxyXG5cdH1cclxufSk7XHRcdFxyXG4vLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuQ2xhc3MoXCJNb3ZpbmdQb2ludFwiLCB7XHJcblx0aXNhIDogUG9pbnQsXHJcblxyXG5cdGhhcyA6IHtcclxuXHRcdGRldmljZUlkIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IFwiREVWSUNFX0lEX05PVF9TRVRcIlxyXG5cdFx0fVxyXG5cdH1cclxufSk7XHJcbi8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5DbGFzcyhcIlBhcnRpY2lwYW50XCIsXHJcbntcclxuXHRpc2EgOiBNb3ZpbmdQb2ludCxcclxuXHJcbiAgICBoYXM6IFxyXG5cdHtcdFxyXG4gICAgXHRsYXN0UGluZ1RpbWVzdGFtcCA6IHtcclxuICAgIFx0XHRpcyA6IFwicndcIixcclxuICAgIFx0XHRpbml0IDogbnVsbFxyXG4gICAgXHR9LFxyXG4gICAgXHRzaWduYWxMb3N0RGVsYXkgOiB7XHJcbiAgICBcdFx0aXMgOiBcInJ3XCIsXHJcbiAgICBcdFx0aW5pdCA6IG51bGxcclxuICAgIFx0fSxcclxuICAgIFx0bGFzdFJlYWxEZWxheSA6IHtcclxuICAgIFx0XHRpcyA6IFwicndcIixcclxuICAgIFx0XHRpbml0IDogMFxyXG4gICAgXHR9LFxyXG4gICAgXHR0cmFjayA6IHtcclxuICAgIFx0XHRpcyA6IFwicndcIlxyXG4gICAgXHR9LFxyXG4gICAgXHRzdGF0ZXMgOiB7XHJcbiAgICBcdFx0aXMgOiBcInJ3XCIsXHJcbiAgICBcdFx0aW5pdCA6IG51bGwgLy9bXVxyXG4gICAgXHRcdFxyXG4gICAgXHR9LFxyXG5cdFx0aXNUaW1lZE91dCA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiBmYWxzZVxyXG5cdFx0fSxcclxuXHRcdGlzRGlzY2FyZGVkIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IGZhbHNlXHJcblx0XHR9LFxyXG5cdFx0aXNTT1MgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogZmFsc2VcclxuXHRcdH0sXHJcblx0XHRpY29uOiB7XHJcblx0XHRcdGlzOiBcInJ3XCIsXHJcblx0ICAgICAgICBpbml0OiBcImltZy9wbGF5ZXIxLnBuZ1wiXHJcblx0ICAgIH0sXHJcblx0ICAgIGltYWdlIDpcdHtcclxuXHQgICAgICAgIGlzOiAgIFwicndcIixcclxuXHQgICAgICAgIGluaXQ6IFwiaW1nL3Byb2ZpbGUxLnBuZ1wiICAvLzEwMHgxMDBcclxuXHQgICAgfSxcclxuXHQgICAgY29sb3IgOiB7XHJcblx0ICAgICAgICBpczogICBcInJ3XCIsXHJcblx0ICAgICAgICBpbml0OiBcIiNmZmZcIlxyXG5cdCAgICB9LFxyXG5cdCAgICBsYXN0SW50ZXJwb2xhdGVUaW1lc3RhbXAgOiB7XHJcblx0ICAgIFx0aXMgOiBcInJ3XCIsXHJcblx0ICAgIFx0aW5pdCA6IG51bGxcclxuXHQgICAgfSxcclxuXHQgICAgYWdlR3JvdXAgOiB7XHJcblx0ICAgIFx0aXMgOiBcInJ3XCIsXHJcblx0ICAgIFx0aW5pdCA6IFwiLVwiXHJcblx0ICAgIH0sXHJcblx0ICAgIGFnZSA6IHtcclxuXHQgICAgXHRpcyA6IFwicndcIixcclxuXHQgICAgXHRpbml0IDogXCItXCJcclxuXHQgICAgfSxcclxuXHQgICAgcm90YXRpb24gOiB7XHJcblx0ICAgIFx0aXMgOiBcInJ3XCIsXHJcblx0ICAgIFx0aW5pdCA6IG51bGwgXHJcblx0ICAgIH0sIFxyXG5cdCAgICBlbGFwc2VkIDoge1xyXG5cdCAgICBcdGlzIDogXCJyd1wiLFxyXG5cdCAgICBcdGluaXQgOiAwXHJcblx0ICAgIH0sXHJcblx0XHRzZXFJZCA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiAwXHJcblx0XHR9LFxyXG5cdFx0Y291bnRyeSA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiBcIkdlcm1hbnlcIlxyXG5cdFx0fSxcclxuXHRcdHN0YXJ0UG9zIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IDBcclxuXHRcdH0sXHJcblx0XHRzdGFydFRpbWUgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogMFxyXG5cdFx0fSxcclxuXHRcdGdlbmRlciA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiBcIk1cIlxyXG5cdFx0fSxcclxuXHRcdGlzRmF2b3JpdGUgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogdHJ1ZSAvKiB0b2RvIHNldCBmYWxzZSAqL1xyXG5cdFx0fVxyXG4gICAgfSxcclxuXHRhZnRlciA6IHtcclxuXHRcdGluaXQgOiBmdW5jdGlvbihwb3MsIHRyYWNrKSB7XHJcblx0XHRcdHRoaXMuc2V0VHJhY2sodHJhY2spO1xyXG5cdFx0XHR2YXIgY3RpbWUgPSAobmV3IERhdGUoKSkuZ2V0VGltZSgpO1xyXG5cdFx0XHR2YXIgc3RhdGUgPSBuZXcgUGFydGljaXBhbnRTdGF0ZSh7dGltZXN0YW1wOjEvKiBwbGFjZWhvbGRlciBjdGltZSBub3QgMCAqLyxncHM6cG9zLGlzU09TOmZhbHNlLGZyZXE6MCxzcGVlZDowLGVsYXBzZWQ6MH0pO1xyXG5cdFx0XHR0aGlzLnNldEVsYXBzZWQoc3RhdGUuZWxhcHNlZCk7XHJcblx0XHRcdHRoaXMuc2V0U3RhdGVzKFtzdGF0ZV0pO1xyXG5cdFx0XHR0aGlzLnNldElzU09TKGZhbHNlKTtcclxuXHRcdFx0dGhpcy5zZXRJc0Rpc2NhcmRlZChmYWxzZSk7XHJcblxyXG5cdFx0XHRpZiAodGhpcy5mZWF0dXJlKSB7XHJcblx0XHRcdFx0dGhpcy5pbml0RmVhdHVyZSgpO1xyXG5cdFx0XHR9XHJcblx0XHRcdHRoaXMucGluZ0NhbGN1bGF0ZWQoc3RhdGUpO1xyXG5cdFx0fVxyXG5cdH0sXHJcbiAgICAvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0bWV0aG9kczogXHJcblx0e1xyXG5cdFx0aW5pdEZlYXR1cmUgOiBmdW5jdGlvbigpIHtcclxuXHRcdFx0dGhpcy5mZWF0dXJlLnBhcnRpY2lwYW50PXRoaXM7XHJcblx0XHRcdEdVSS5wYXJ0aWNpcGFudHNMYXllci5nZXRTb3VyY2UoKS5hZGRGZWF0dXJlKHRoaXMuZmVhdHVyZSk7XHJcblx0XHR9LFxyXG5cclxuXHRcdGdldEluaXRpYWxzIDogZnVuY3Rpb24oKSB7XHJcblx0XHRcdHZhciB0dCA9IHRoaXMuZ2V0Q29kZSgpLnNwbGl0KFwiIFwiKTtcclxuXHRcdFx0aWYgKHR0Lmxlbmd0aCA+PSAyKSB7XHJcblx0XHRcdFx0cmV0dXJuIHR0WzBdWzBdK3R0WzFdWzBdO1xyXG5cdFx0XHR9XHJcblx0XHRcdGlmICh0dC5sZW5ndGggPT0gMSlcclxuXHRcdFx0XHRyZXR1cm4gdHRbMF1bMF07XHJcblx0XHRcdHJldHVybiBcIj9cIjtcclxuXHRcdH0sXHJcblx0XHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRcdC8vIG1haW4gZnVuY3Rpb24gY2FsbCA+IFxyXG5cdFx0Ly8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0XHR1cGRhdGVGZWF0dXJlIDogZnVuY3Rpb24oKSB7XHJcblx0XHRcdHZhciBtcG9zID0gb2wucHJvai50cmFuc2Zvcm0odGhpcy5nZXRQb3NpdGlvbigpLCAnRVBTRzo0MzI2JywgJ0VQU0c6Mzg1NycpO1xyXG5cdFx0XHRpZiAodGhpcy5mZWF0dXJlKSBcclxuXHRcdFx0XHR0aGlzLmZlYXR1cmUuc2V0R2VvbWV0cnkobmV3IG9sLmdlb20uUG9pbnQobXBvcykpO1xyXG5cdFx0fSxcclxuXHRcdGludGVycG9sYXRlIDogZnVuY3Rpb24oKSBcclxuXHRcdHtcclxuXHRcdFx0XHJcblx0XHRcdGlmICghdGhpcy5zdGF0ZXMubGVuZ3RoKVxyXG5cdFx0XHRcdHJldHVybjtcclxuXHRcdFx0dmFyIGN0aW1lPShuZXcgRGF0ZSgpKS5nZXRUaW1lKCk7XHJcblx0XHRcdHZhciBpc1RpbWUgPSAoY3RpbWUgPj0gQ09ORklHLnRpbWVzLmJlZ2luICYmIGN0aW1lIDw9IENPTkZJRy50aW1lcy5lbmQpO1xyXG5cdFx0XHRpZiAodGhpcy5pc0Rpc2NhcmRlZCB8fCB0aGlzLmlzU09TLyogfHwgIXRoaXMuaXNPblJvYWQqLyB8fCAhaXNUaW1lIHx8IENPTkZJRy5zZXR0aW5ncy5ub0ludGVycG9sYXRpb24pIFxyXG5cdFx0XHR7XHJcblx0XHRcdFx0dmFyIGxzdGF0ZT10aGlzLnN0YXRlc1t0aGlzLnN0YXRlcy5sZW5ndGgtMV07XHJcblx0XHRcdFx0dmFyIHBvcyA9IGxzdGF0ZS5ncHM7XHJcblx0XHRcdFx0aWYgKHBvc1swXSAhPSB0aGlzLmdldFBvc2l0aW9uKClbMF0gfHwgcG9zWzFdICE9IHRoaXMuZ2V0UG9zaXRpb24oKVsxXSkgXHJcblx0XHRcdFx0e1xyXG5cdFx0XHRcdCAgICB0aGlzLnNldFBvc2l0aW9uKHBvcyk7XHJcblx0XHRcdFx0ICAgIHRoaXMuc2V0Um90YXRpb24obnVsbCk7XHJcblx0XHRcdFx0XHR0aGlzLnVwZGF0ZUZlYXR1cmUoKTtcclxuXHRcdFx0XHR9IGVsc2Uge1xyXG5cdFx0XHRcdFx0aWYgKHRoaXMuaXNEaXNjYXJkZWQpIHtcclxuXHRcdFx0XHRcdFx0dGhpcy51cGRhdGVGZWF0dXJlKCk7XHJcblx0XHRcdFx0XHR9XHJcblx0XHRcdFx0fVxyXG5cdFx0XHRcdHJldHVybjtcclxuXHRcdFx0fVxyXG5cdFx0XHR0aGlzLnNldExhc3RJbnRlcnBvbGF0ZVRpbWVzdGFtcChjdGltZSk7XHJcblx0XHRcdC8vIE5vIGVub3VnaCBkYXRhP1xyXG5cdFx0XHRpZiAodGhpcy5zdGF0ZXMubGVuZ3RoIDwgMilcclxuXHRcdFx0XHRyZXR1cm47XHJcblx0XHRcdHZhciByZXMgPSB0aGlzLmNhbGN1bGF0ZUVsYXBzZWRBdmVyYWdlKGN0aW1lKTtcclxuXHRcdFx0aWYgKHJlcykgXHJcblx0XHRcdHtcclxuXHRcdFx0XHR2YXIgdHJlcz1yZXM7XHJcblx0XHRcdFx0aWYgKHRyZXMgPT0gdGhpcy50cmFjay5sYXBzKVxyXG5cdFx0XHRcdFx0dHJlcz0xLjA7XHJcblx0XHRcdFx0ZWxzZVxyXG5cdFx0XHRcdFx0dHJlcz10cmVzJTE7XHJcblx0XHRcdFx0dmFyIHRrYSA9IHRoaXMudHJhY2suZ2V0UG9zaXRpb25BbmRSb3RhdGlvbkZyb21FbGFwc2VkKHRyZXMpO1xyXG5cdFx0XHRcdHRoaXMuc2V0UG9zaXRpb24oW3RrYVswXSx0a2FbMV1dKTtcclxuXHRcdFx0XHR0aGlzLnNldFJvdGF0aW9uKHRrYVsyXSk7XHJcblx0XHRcdFx0dGhpcy51cGRhdGVGZWF0dXJlKCk7XHJcblx0XHRcdFx0dGhpcy5zZXRFbGFwc2VkKHJlcyk7XHJcblx0XHRcdH0gXHJcblx0XHR9LFxyXG5cclxuXHRcdG1pbiA6IGZ1bmN0aW9uKGN0aW1lLHByb05hbWUpIFxyXG5cdFx0e1xyXG5cdFx0XHR2YXIgcmVzPW51bGw7XHJcblx0XHRcdGZvciAodmFyIGk9dGhpcy5zdGF0ZXMubGVuZ3RoLTI7aT49MDtpLS0pIFxyXG5cdFx0XHR7XHJcblx0XHRcdFx0dmFyIGogPSBpKzE7XHJcblx0XHRcdFx0dmFyIHNhID0gdGhpcy5zdGF0ZXNbaV07XHJcblx0XHRcdFx0dmFyIHNiID0gdGhpcy5zdGF0ZXNbal07XHJcblx0XHRcdFx0aWYgKGN0aW1lID49IHNhLnRpbWVzdGFtcCAmJiBjdGltZSA8PSBzYi50aW1lc3RhbXApIFxyXG5cdFx0XHRcdHsgXHJcblx0XHRcdFx0XHRyZXMgPSBzYVtwcm9OYW1lXTtcclxuXHRcdFx0XHRcdC8vY29uc29sZS5sb2coXCJNSU4gRk9SIFwiK3Byb05hbWUrXCIgfCBcIityZXMrXCIgfCBcIitKU09OLnN0cmluZ2lmeSh0aGlzLnN0YXRlc1tpXSkpO1xyXG5cdFx0XHRcdFx0YnJlYWs7XHJcblx0XHRcdFx0fVxyXG5cdFx0XHRcdGlmIChzYi50aW1lc3RhbXAgPCBjdGltZSlcclxuXHRcdFx0XHRcdGJyZWFrO1xyXG5cdFx0XHR9XHJcblx0XHRcdHJldHVybiByZXM7XHJcblx0XHR9LFxyXG5cclxuXHRcdGF2ZzIgOiBmdW5jdGlvbihjdGltZSxwcm9OYW1lKSBcclxuXHRcdHtcclxuXHRcdFx0dmFyIHJlcz1udWxsO1xyXG5cdFx0XHRmb3IgKHZhciBpPXRoaXMuc3RhdGVzLmxlbmd0aC0yO2k+PTA7aS0tKSBcclxuXHRcdFx0e1xyXG5cdFx0XHRcdHZhciBqID0gaSsxO1xyXG5cdFx0XHRcdHZhciBzYSA9IHRoaXMuc3RhdGVzW2ldO1xyXG5cdFx0XHRcdHZhciBzYiA9IHRoaXMuc3RhdGVzW2pdO1xyXG5cdFx0XHRcdGlmIChjdGltZSA+PSBzYS50aW1lc3RhbXAgJiYgY3RpbWUgPD0gc2IudGltZXN0YW1wKSBcclxuXHRcdFx0XHR7IFxyXG5cdFx0XHRcdFx0cmVzID0gW1xyXG5cdFx0XHRcdFx0ICAgICAgIFx0c2FbcHJvTmFtZV1bMF0rKGN0aW1lLXNhLnRpbWVzdGFtcCkgKiAoc2JbcHJvTmFtZV1bMF0tc2FbcHJvTmFtZV1bMF0pIC8gKHNiLnRpbWVzdGFtcC1zYS50aW1lc3RhbXApLFxyXG5cdFx0XHRcdFx0ICAgICAgIFx0c2FbcHJvTmFtZV1bMV0rKGN0aW1lLXNhLnRpbWVzdGFtcCkgKiAoc2JbcHJvTmFtZV1bMV0tc2FbcHJvTmFtZV1bMV0pIC8gKHNiLnRpbWVzdGFtcC1zYS50aW1lc3RhbXApXHJcblx0XHRcdFx0ICAgICAgICAgIF07IFxyXG5cdFx0XHRcdFx0YnJlYWs7XHJcblx0XHRcdFx0fVxyXG5cdFx0XHRcdGlmIChzYi50aW1lc3RhbXAgPCBjdGltZSlcclxuXHRcdFx0XHRcdGJyZWFrO1xyXG5cdFx0XHR9XHJcblx0XHRcdHJldHVybiByZXM7XHJcblx0XHR9LFxyXG5cclxuXHRcdGF2ZyA6IGZ1bmN0aW9uKGN0aW1lLHByb05hbWUpIFxyXG5cdFx0e1xyXG5cdFx0XHR2YXIgcmVzPW51bGw7XHJcblx0XHRcdC8vY29uc29sZS5sb2codGhpcy5zdGF0ZXMpO1xyXG5cdFx0XHRmb3IgKHZhciBpPXRoaXMuc3RhdGVzLmxlbmd0aC0yO2k+PTA7aS0tKSBcclxuXHRcdFx0e1xyXG5cdFx0XHRcdHZhciBqID0gaSsxO1xyXG5cdFx0XHRcdHZhciBzYSA9IHRoaXMuc3RhdGVzW2ldO1xyXG5cdFx0XHRcdHZhciBzYiA9IHRoaXMuc3RhdGVzW2pdO1xyXG5cdFx0XHRcdGlmIChjdGltZSA+PSBzYS50aW1lc3RhbXAgJiYgY3RpbWUgPD0gc2IudGltZXN0YW1wKSBcclxuXHRcdFx0XHR7IFxyXG5cdFx0XHRcdFx0cmVzID0gc2FbcHJvTmFtZV0rKGN0aW1lLXNhLnRpbWVzdGFtcCkgKiAoc2JbcHJvTmFtZV0tc2FbcHJvTmFtZV0pIC8gKHNiLnRpbWVzdGFtcC1zYS50aW1lc3RhbXApO1xyXG5cdFx0XHRcdFx0YnJlYWs7XHJcblx0XHRcdFx0fVxyXG5cdFx0XHRcdGlmIChzYi50aW1lc3RhbXAgPCBjdGltZSlcclxuXHRcdFx0XHRcdGJyZWFrO1xyXG5cdFx0XHR9XHJcblx0XHRcdC8qaWYgKHJlcyA9PSBudWxsKSB7XHJcblx0XHRcdFx0dmFyIGFycj1bXTtcclxuXHRcdFx0XHRmb3IgKHZhciBpPXRoaXMuc3RhdGVzLmxlbmd0aC0xO2k+PTA7aS0tKSBpZiAoaSA9PSAwIHx8IGkgPT0gdGhpcy5zdGF0ZXMubGVuZ3RoLTEpIHtcclxuXHRcdFx0XHRcdGFyci5wdXNoKFV0aWxzLmZvcm1hdERhdGVUaW1lU2VjKG5ldyBEYXRlKHRoaXMuc3RhdGVzW2ldLnRpbWVzdGFtcCkpKTtcclxuXHRcdFx0XHR9IFxyXG5cdFx0XHRcdGNvbnNvbGUubG9nKFwiQVZHIE5VTEwgQkVDQVVTRSBTRUFSQ0hJTkcgXCIrVXRpbHMuZm9ybWF0RGF0ZVRpbWVTZWMobmV3IERhdGUoY3RpbWUpKStcIiB8IFwiK2Fycik7XHJcblx0XHRcdH0qL1xyXG5cdFx0XHRyZXR1cm4gcmVzO1xyXG5cdFx0fSxcclxuXHJcblx0XHRjYWxjdWxhdGVFbGFwc2VkQXZlcmFnZSA6IGZ1bmN0aW9uKGN0aW1lKSBcclxuXHRcdHtcclxuXHRcdFx0dmFyIHJlcz1udWxsO1xyXG5cdFx0XHRjdGltZS09Q09ORklHLm1hdGguZGlzcGxheURlbGF5KjEwMDA7XHJcblx0XHRcdC8vY29uc29sZS5sb2coXCJTRUFSQ0hJTkcgRk9SIFRJTUUgXCIrVXRpbHMuZm9ybWF0RGF0ZVRpbWVTZWMobmV3IERhdGUoY3RpbWUpKSk7XHJcblx0XHRcdHZhciBvayA9IGZhbHNlO1xyXG5cdFx0XHRmb3IgKHZhciBpPXRoaXMuc3RhdGVzLmxlbmd0aC0yO2k+PTA7aS0tKSBcclxuXHRcdFx0e1xyXG5cdFx0XHRcdHZhciBqID0gaSsxO1xyXG5cdFx0XHRcdHZhciBzYSA9IHRoaXMuY2FsY0FWR1N0YXRlKGkpO1xyXG5cdFx0XHRcdHZhciBzYiA9IHRoaXMuY2FsY0FWR1N0YXRlKGopO1xyXG5cdFx0XHRcdGlmIChjdGltZSA+PSBzYS50aW1lc3RhbXAgJiYgY3RpbWUgPD0gc2IudGltZXN0YW1wKSBcclxuXHRcdFx0XHR7IFxyXG5cdFx0XHRcdFx0cmVzID0gc2EuZWxhcHNlZCsoY3RpbWUtc2EudGltZXN0YW1wKSAqIChzYi5lbGFwc2VkLXNhLmVsYXBzZWQpIC8gKHNiLnRpbWVzdGFtcC1zYS50aW1lc3RhbXApO1xyXG5cdFx0XHRcdFx0Ly9jb25zb2xlLmxvZyhcIkZPVU5EIFRJTUUgSU5UIFtcIitVdGlscy5mb3JtYXREYXRlVGltZVNlYyhuZXcgRGF0ZShzYS50aW1lc3RhbXApKStcIiA+IFwiK1V0aWxzLmZvcm1hdERhdGVUaW1lU2VjKG5ldyBEYXRlKHNiLnRpbWVzdGFtcCkpK1wiXVwiKTtcclxuXHRcdFx0XHRcdG9rPXRydWU7XHJcblx0XHRcdFx0XHRicmVhaztcclxuXHRcdFx0XHR9XHJcblx0XHRcdFx0aWYgKHNiLnRpbWVzdGFtcCA8IGN0aW1lKSB7XHJcblx0XHRcdFx0XHR0aGlzLnNldFNpZ25hbExvc3REZWxheShjdGltZS1zYi50aW1lc3RhbXApO1xyXG5cdFx0XHRcdFx0Ly9jb25zb2xlLmxvZyhcIkJSRUFLIE9OIFwiK2Zvcm1hdFRpbWVTZWMobmV3IERhdGUoY3RpbWUpKStcIiB8IFwiKyhjdGltZS1zYi50aW1lc3RhbXApLzEwMDAuMCk7XHJcblx0XHRcdFx0XHRyZXR1cm4gbnVsbDtcclxuXHRcdFx0XHR9XHJcblx0XHRcdH1cclxuXHRcdFx0aWYgKCFvaykge1xyXG5cdFx0XHRcdGlmICh0aGlzLnN0YXRlcy5sZW5ndGggPj0gMilcclxuXHRcdFx0XHRcdGNvbnNvbGUubG9nKHRoaXMuY29kZStcIiB8IE5PVCBGT1VORCBUSU1FIFwiK1V0aWxzLmZvcm1hdERhdGVUaW1lU2VjKG5ldyBEYXRlKGN0aW1lKSkrXCIgfCB0LWxhc3Q9XCIrKGN0aW1lLXRoaXMuc3RhdGVzW3RoaXMuc3RhdGVzLmxlbmd0aC0xXS50aW1lc3RhbXApLzEwMDAuMCtcIiB8IHQtZmlyc3Q9XCIrKGN0aW1lLXRoaXMuc3RhdGVzWzBdLnRpbWVzdGFtcCkvMTAwMC4wKTtcclxuXHRcdFx0fSBlbHNlXHJcblx0XHRcdFx0dGhpcy5zZXRTaWduYWxMb3N0RGVsYXkobnVsbCk7XHJcblx0XHRcdHJldHVybiByZXM7XHJcblx0XHR9LFxyXG5cdFx0XHJcblx0XHRjYWxjQVZHU3RhdGUgOiBmdW5jdGlvbihwb3MpIHtcclxuXHRcdFx0aWYgKCFDT05GSUcubWF0aC5pbnRlcnBvbGF0ZUdQU0F2ZXJhZ2UpXHJcblx0XHRcdFx0cmV0dXJuIHRoaXMuc3RhdGVzW3Bvc107XHJcblx0XHRcdHZhciBzc3VtZT0wO1xyXG5cdFx0XHR2YXIgc3N1bXQ9MDtcclxuXHRcdFx0dmFyIGNjPTA7XHJcblx0XHRcdGZvciAodmFyIGk9cG9zO2k+PTAgJiYgKHBvcy1pKTxDT05GSUcubWF0aC5pbnRlcnBvbGF0ZUdQU0F2ZXJhZ2U7aS0tKSB7XHJcblx0XHRcdFx0c3N1bWUrPXRoaXMuc3RhdGVzW2ldLmVsYXBzZWQ7XHJcblx0XHRcdFx0c3N1bXQrPXRoaXMuc3RhdGVzW2ldLnRpbWVzdGFtcDtcclxuXHRcdFx0XHRjYysrO1xyXG5cdFx0XHR9XHJcblx0XHRcdHNzdW1lLz1jYztcclxuXHRcdFx0c3N1bXQvPWNjO1xyXG5cdFx0XHRyZXR1cm4ge2VsYXBzZWQgOiBzc3VtZSx0aW1lc3RhbXAgOiBzc3VtdH07XHJcblx0XHR9LFxyXG5cclxuXHRcdHBpbmdDYWxjdWxhdGVkIDogZnVuY3Rpb24ob2JqKSB7XHJcblx0XHRcdHZhciBzdGF0ZSA9IG5ldyBQYXJ0aWNpcGFudFN0YXRlKG9iaik7XHJcblx0XHRcdHRoaXMuYWRkU3RhdGUoc3RhdGUpO1xyXG5cdFx0XHR2YXIgcG9zID0gc3RhdGUuZ3BzO1xyXG5cdFx0XHR2YXIgY29lZiA9IHRoaXMudHJhY2suZ2V0VHJhY2tMZW5ndGhJbldHUzg0KCkvdGhpcy50cmFjay5nZXRUcmFja0xlbmd0aCgpO1xyXG5cdFx0XHR2YXIgcnIgPSBDT05GSUcubWF0aC5ncHNJbmFjY3VyYWN5KmNvZWY7XHJcblx0XHRcdGlmICh0eXBlb2YgR1VJICE9IFwidW5kZWZpbmVkXCIgJiYgR1VJLmlzRGVidWcpIFxyXG5cdFx0XHR7XHJcblx0XHRcdFx0dmFyIHJpbmcgPSBbXHJcblx0XHRcdFx0ICAgICAgICAgICAgW3Bvc1swXS1yciwgcG9zWzFdLXJyKmNvZWZ5XSwgW3Bvc1swXStyciwgcG9zWzFdLXJyKmNvZWZ5XSxbcG9zWzBdK3JyLCBwb3NbMV0rcnIqY29lZnldLFtwb3NbMF0tcnIsIHBvc1sxXStycipjb2VmeV0sW3Bvc1swXS1yciwgcG9zWzFdLXJyKmNvZWZ5XVxyXG5cdCBcdFx0XHQgICAgICAgICAgXTtcclxuXHRcdFx0XHR2YXIgcG9seWdvbiA9IG5ldyBvbC5nZW9tLlBvbHlnb24oW3JpbmddKTtcclxuXHRcdFx0XHRwb2x5Z29uLnRyYW5zZm9ybSgnRVBTRzo0MzI2JywgJ0VQU0c6Mzg1NycpO1xyXG5cdFx0XHRcdHZhciBmZWF0dXJlID0gbmV3IG9sLkZlYXR1cmUocG9seWdvbik7XHJcblx0XHRcdFx0R1VJLnRlc3RMYXllcjEuZ2V0U291cmNlKCkuYWRkRmVhdHVyZShmZWF0dXJlKTtcclxuXHJcblx0XHRcdFx0dmFyIG1wb3MgPSBvbC5wcm9qLnRyYW5zZm9ybShwb3MsICdFUFNHOjQzMjYnLCAnRVBTRzozODU3Jyk7XHJcblx0XHRcdFx0dmFyIGZlYXR1cmUgPSBuZXcgb2wuRmVhdHVyZShuZXcgb2wuZ2VvbS5Qb2ludChtcG9zKSk7XHJcblx0XHRcdFx0R1VJLnRlc3RMYXllci5nZXRTb3VyY2UoKS5hZGRGZWF0dXJlKGZlYXR1cmUpO1xyXG5cdFx0XHRcdGNvbnNvbGUubG9nKHRoaXMuZ2V0Q29kZSgpK1wiIHwgXCIrTWF0aC5yb3VuZChzdGF0ZS5lbGFwc2VkKjEwMC4wKjEwMC4wKS8xMDAuMCtcIiUgUE9ORyBbXCIrcG9zWzBdK1wiLFwiK3Bvc1sxXStcIl0gXCIrbmV3IERhdGUoc3RhdGUudGltZXN0YW1wKStcIiB8IFwiK3N0YXRlLmRlYnVnSW5mbyk7XHJcblxyXG5cdFx0XHRcdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdFx0XHRcdGlmIChzdGF0ZS5kZWJ1Z0luZm8gJiYgc3RhdGUuZGVidWdJbmZvLnBvaW50ICYmIHN0YXRlLmRlYnVnSW5mby5iZXN0KSBcclxuXHRcdFx0XHR7XHJcblx0XHRcdFx0XHR2YXIgbXBvcyA9IG9sLnByb2oudHJhbnNmb3JtKHN0YXRlLmRlYnVnSW5mby5wb2ludCwgJ0VQU0c6NDMyNicsICdFUFNHOjM4NTcnKTtcclxuXHRcdFx0XHRcdHZhciBmZWF0dXJlID0gbmV3IG9sLkZlYXR1cmUobmV3IG9sLmdlb20uUG9pbnQobXBvcykpO1xyXG5cdFx0XHRcdFx0aWYgKHRoaXMuX19vbGRGZWF0dXJlMSlcclxuXHRcdFx0XHRcdFx0R1VJLnRlc3RMYXllcjIuZ2V0U291cmNlKCkucmVtb3ZlRmVhdHVyZSh0aGlzLl9fb2xkRmVhdHVyZTEpO1xyXG5cdFx0XHRcdFx0R1VJLnRlc3RMYXllcjIuZ2V0U291cmNlKCkuYWRkRmVhdHVyZShmZWF0dXJlKTtcclxuXHRcdFx0XHRcdGZlYXR1cmUuZGVidWdJbmZvPXN0YXRlLmRlYnVnSW5mbztcclxuXHRcdFx0XHRcdHRoaXMuX19vbGRGZWF0dXJlMT1mZWF0dXJlO1xyXG5cclxuXHRcdFx0XHRcdHZhciBwMSA9IHRoaXMudHJhY2sucm91dGVbc3RhdGUuZGVidWdJbmZvLmJlc3RdO1xyXG5cdFx0XHRcdFx0dmFyIHAyID0gdGhpcy50cmFjay5yb3V0ZVtzdGF0ZS5kZWJ1Z0luZm8uYmVzdCsxXTtcclxuXHRcdFx0XHRcdHZhciBsaW5lID0gbmV3IG9sLmdlb20uTGluZVN0cmluZyhbIHAxLHAyIF0pO1xyXG5cdFx0XHRcdFx0bGluZS50cmFuc2Zvcm0oJ0VQU0c6NDMyNicsICdFUFNHOjM4NTcnKTtcclxuXHRcdFx0XHRcdFxyXG5cdFx0XHRcdFx0aWYgKHRoaXMuX19vbGRGZWF0dXJlMilcclxuXHRcdFx0XHRcdFx0R1VJLnRlc3RMYXllcjIuZ2V0U291cmNlKCkucmVtb3ZlRmVhdHVyZSh0aGlzLl9fb2xkRmVhdHVyZTIpO1xyXG5cdFx0XHRcdFx0dmFyIGZlYXR1cmUgPSBuZXcgb2wuRmVhdHVyZShsaW5lKTtcclxuXHRcdFx0XHRcdGZlYXR1cmUuZGVidWdJbmZvPXN0YXRlLmRlYnVnSW5mbztcclxuXHRcdFx0XHRcdEdVSS50ZXN0TGF5ZXIyLmdldFNvdXJjZSgpLmFkZEZlYXR1cmUoZmVhdHVyZSk7XHJcblx0XHRcdFx0XHR0aGlzLl9fb2xkRmVhdHVyZTI9ZmVhdHVyZTtcclxuXHRcdFx0XHR9XHJcblx0XHRcdFx0XHJcblx0XHRcdFx0d2hpbGUgKEdVSS50ZXN0TGF5ZXIxLmdldFNvdXJjZSgpLmdldEZlYXR1cmVzKCkubGVuZ3RoID4gMTAwKVxyXG5cdFx0XHRcdFx0R1VJLnRlc3RMYXllcjEuZ2V0U291cmNlKCkucmVtb3ZlRmVhdHVyZShHVUkudGVzdExheWVyMS5nZXRTb3VyY2UoKS5nZXRGZWF0dXJlcygpWzBdKTtcclxuXHRcdFx0XHR3aGlsZSAoR1VJLnRlc3RMYXllci5nZXRTb3VyY2UoKS5nZXRGZWF0dXJlcygpLmxlbmd0aCA+IDEwMClcclxuXHRcdFx0XHRcdEdVSS50ZXN0TGF5ZXIuZ2V0U291cmNlKCkucmVtb3ZlRmVhdHVyZShHVUkudGVzdExheWVyLmdldFNvdXJjZSgpLmdldEZlYXR1cmVzKClbMF0pO1xyXG5cdFx0XHR9IFxyXG5cclxuXHRcdH0sXHJcblxyXG5cdFx0Z2V0T3ZlcmFsbFJhbmsgOiBmdW5jdGlvbigpIHtcclxuXHRcdFx0aWYgKHRoaXMuc3RhdGVzLmxlbmd0aCkge1xyXG5cdFx0XHRcdHJldHVybiB0aGlzLnN0YXRlc1t0aGlzLnN0YXRlcy5sZW5ndGgtMV0ub3ZlcmFsbFJhbms7XHJcblx0XHRcdH1cclxuXHRcdFx0cmV0dXJuIFwiLVwiO1xyXG5cdFx0fSxcclxuXHRcdGdldEdyb3VwUmFuayA6IGZ1bmN0aW9uKCkge1xyXG5cdFx0XHRpZiAodGhpcy5zdGF0ZXMubGVuZ3RoKSB7XHJcblx0XHRcdFx0cmV0dXJuIHRoaXMuc3RhdGVzW3RoaXMuc3RhdGVzLmxlbmd0aC0xXS5ncm91cFJhbms7XHJcblx0XHRcdH1cclxuXHRcdFx0cmV0dXJuIFwiLVwiO1xyXG5cdFx0fSxcclxuXHRcdGdldEdlbmRlclJhbmsgOiBmdW5jdGlvbigpIHtcclxuXHRcdFx0aWYgKHRoaXMuc3RhdGVzLmxlbmd0aCkge1xyXG5cdFx0XHRcdHJldHVybiB0aGlzLnN0YXRlc1t0aGlzLnN0YXRlcy5sZW5ndGgtMV0uZ2VuZGVyUmFuaztcclxuXHRcdFx0fVxyXG5cdFx0XHRyZXR1cm4gXCItXCI7XHJcblx0XHR9LFxyXG5cdFx0XHJcblx0XHRwaW5nIDogZnVuY3Rpb24ocG9zLGZyZXEsaXNTT1MsY3RpbWUsYWx0LG92ZXJhbGxSYW5rLGdyb3VwUmFuayxnZW5kZXJSYW5rLF9FTEFQU0VEKVxyXG5cdFx0e1xyXG5cdFx0XHR2YXIgbGx0ID0gKG5ldyBEYXRlKCkpLmdldFRpbWUoKTsgXHJcblx0XHRcdGlmICghY3RpbWUpXHJcblx0XHRcdFx0Y3RpbWU9bGx0O1xyXG5cdFx0XHR0aGlzLnNldExhc3RSZWFsRGVsYXkobGx0LWN0aW1lKTtcclxuXHRcdFx0dGhpcy5zZXRMYXN0UGluZ1RpbWVzdGFtcChsbHQpO1x0XHRcdFxyXG5cdFx0XHR2YXIgc3RhdGUgPSBuZXcgUGFydGljaXBhbnRTdGF0ZSh7dGltZXN0YW1wOmN0aW1lLGdwczpwb3MsaXNTT1M6aXNTT1MsZnJlcTpmcmVxLGFsdDphbHQsb3ZlcmFsbFJhbms6b3ZlcmFsbFJhbmssZ3JvdXBSYW5rOmdyb3VwUmFuayxnZW5kZXJSYW5rOmdlbmRlclJhbmt9KTtcclxuXHRcdFx0Ly9pc1NPUz10cnVlO1xyXG5cdFx0XHRpZiAoaXNTT1MgfHwgQ09ORklHLnNldHRpbmdzLm5vSW50ZXJwb2xhdGlvbilcclxuXHRcdFx0e1xyXG5cdFx0XHRcdGlmIChpc1NPUylcclxuXHRcdFx0XHRcdHRoaXMuc2V0SXNTT1ModHJ1ZSk7XHRcdFx0XHRcclxuXHRcdFx0XHR0aGlzLmFkZFN0YXRlKHN0YXRlKTtcclxuXHRcdFx0XHRyZXR1cm47XHJcblx0XHRcdH1cclxuXHRcdFx0Ly8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0XHRcdHZhciB0cmFja2xlbiA9IHRoaXMudHJhY2suZ2V0VHJhY2tMZW5ndGgoKTtcclxuXHRcdFx0dmFyIHRyYWNrbGVuMSA9IHRoaXMudHJhY2suZ2V0VHJhY2tMZW5ndGhJbldHUzg0KCk7XHJcblx0XHRcdHZhciBsbHN0YXRlID0gdGhpcy5zdGF0ZXMubGVuZ3RoID49IDIgPyB0aGlzLnN0YXRlc1t0aGlzLnN0YXRlcy5sZW5ndGgtMl0gOiBudWxsO1xyXG5cdFx0XHR2YXIgbHN0YXRlID0gdGhpcy5zdGF0ZXMubGVuZ3RoID8gdGhpcy5zdGF0ZXNbdGhpcy5zdGF0ZXMubGVuZ3RoLTFdIDogbnVsbDtcclxuXHRcdFx0aWYgKHBvc1swXSA9PSAwICYmIHBvc1sxXSA9PSAwKSB7XHJcblx0XHRcdFx0aWYgKCFsc3RhdGUpIHJldHVybjtcclxuXHRcdFx0XHRwb3M9bHN0YXRlLmdwcztcclxuXHRcdFx0fVxyXG5cdFx0XHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRcdFx0dmFyIGJlc3Q7XHJcblx0XHRcdHZhciBiZXN0bT1udWxsO1xyXG5cdFx0XHR2YXIgbGVscCA9IGxzdGF0ZSA/IGxzdGF0ZS5nZXRFbGFwc2VkKCkgOiAwO1x0Ly8gbGFzdCBlbGFwc2VkXHJcblx0XHRcdHZhciB0ZyA9IHRoaXMudHJhY2sucm91dGU7XHJcblx0XHRcdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdFx0XHQvLyBORVcgQUxHXHJcblx0XHRcdHZhciBjb2VmID0gdGhpcy50cmFjay5nZXRUcmFja0xlbmd0aEluV0dTODQoKS90aGlzLnRyYWNrLmdldFRyYWNrTGVuZ3RoKCk7XHJcblx0XHRcdHZhciBtaW5mID0gbnVsbDtcclxuXHRcdFx0dmFyIHJyID0gQ09ORklHLm1hdGguZ3BzSW5hY2N1cmFjeSpjb2VmO1xyXG5cdFx0XHR2YXIgcmVzdWx0ID0gdGhpcy50cmFjay5yVHJlZS5zZWFyY2goW3Bvc1swXS1yciwgcG9zWzFdLXJyKmNvZWZ5LCBwb3NbMF0rcnIsIHBvc1sxXStycipjb2VmeV0pO1xyXG5cdFx0XHRpZiAoIXJlc3VsdClcclxuXHRcdFx0XHRyZXN1bHQ9W107XHJcblx0XHRcdC8vY29uc29sZS5sb2coXCIhISEgRk9VTkQgXCIrcmVzdWx0Lmxlbmd0aCtcIiB8IFwiK3RoaXMudHJhY2sucm91dGUubGVuZ3RoK1wiIHwgXCIrcnIpO1xyXG5cdFx0XHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRcdFx0dmFyIGRlYnVnSW5mbz17fTtcclxuXHRcdFx0Zm9yICh2YXIgX2k9MDtfaTxyZXN1bHQubGVuZ3RoO19pKyspXHJcblx0XHRcdHtcclxuXHRcdFx0XHR2YXIgaSA9IHJlc3VsdFtfaV1bNF0uaW5kZXg7XHJcblx0XHRcdFx0Ly9hMSxhMixyMSxyMlxyXG5cdFx0XHRcdHZhciByZXMgPSBJbnRlcnNlY3Rpb24uaW50ZXJzZWN0TGluZVJlY3RhbmdsZShcclxuXHRcdFx0XHRcdFx0XHRuZXcgUG9pbnQyRCh0Z1tpXVswXSx0Z1tpXVsxXSksXHJcblx0XHRcdFx0XHRcdFx0bmV3IFBvaW50MkQodGdbaSsxXVswXSx0Z1tpKzFdWzFdKSxcclxuXHRcdFx0XHRcdFx0XHRuZXcgUG9pbnQyRChwb3NbMF0tcnIscG9zWzFdLXJyKmNvZWZ5KSxcclxuXHRcdFx0XHRcdFx0XHRuZXcgUG9pbnQyRChwb3NbMF0rcnIscG9zWzFdK3JyKmNvZWZ5KVxyXG5cdFx0XHRcdFx0XHQpO1xyXG5cdFx0XHRcdC8vY29uc29sZS5sb2cocmVzKTtcclxuXHRcdFx0XHRpZiAocmVzICYmIHJlcy5wb2ludHMgJiYgcmVzLnBvaW50cy5sZW5ndGgpIFxyXG5cdFx0XHRcdHtcclxuXHRcdFx0XHRcdC8vVXRpbHMuZGlzcFxyXG5cdFx0XHRcdFx0dmFyIGQzID0gVXRpbHMuV0dTODRTUEhFUkUuaGF2ZXJzaW5lRGlzdGFuY2UodGdbaV0sdGdbaSsxXSk7XHJcblx0XHRcdFx0XHRyZXM9cmVzLnBvaW50cztcclxuXHRcdFx0XHRcdGZvciAodmFyIHE9MDtxPHJlcy5sZW5ndGg7cSsrKSBcclxuXHRcdFx0XHRcdHtcclxuXHRcdFx0XHRcdFx0Ly9VdGlscy5kaXNwXHJcblx0XHRcdFx0XHRcdHZhciBkMSA9IFV0aWxzLldHUzg0U1BIRVJFLmhhdmVyc2luZURpc3RhbmNlKFtyZXNbcV0ueCxyZXNbcV0ueV0sdGdbaV0pO1xyXG5cdFx0XHRcdFx0XHR2YXIgZWwxID0gdGhpcy50cmFjay5kaXN0YW5jZXNFbGFwc2VkW2ldKyh0aGlzLnRyYWNrLmRpc3RhbmNlc0VsYXBzZWRbaSsxXS10aGlzLnRyYWNrLmRpc3RhbmNlc0VsYXBzZWRbaV0pKmQxL2QzO1xyXG5cdFx0XHRcdFx0XHRpZiAoZWwxIDwgbGVscClcclxuXHRcdFx0XHRcdFx0XHRjb250aW51ZTsgXHRcdFx0XHQvLyBTS0lQIDwgTEVMUFxyXG5cdFx0XHRcdFx0XHRpZiAobWluZiA9PSBudWxsIHx8IGVsMSA8IG1pbmYpIHtcclxuXHRcdFx0XHRcdFx0XHRpZiAoZGVidWdJbmZvKSB7XHJcblx0XHRcdFx0XHRcdFx0XHRkZWJ1Z0luZm8uYmVzdD1pO1xyXG5cdFx0XHRcdFx0XHRcdFx0ZGVidWdJbmZvLnBvaW50PVtyZXNbcV0ueCxyZXNbcV0ueV07XHJcblx0XHRcdFx0XHRcdFx0XHRkZWJ1Z0luZm8udmFsdWU9ZWwxO1xyXG5cdFx0XHRcdFx0XHRcdH1cclxuXHRcdFx0XHRcdFx0XHRtaW5mPWVsMTtcclxuXHRcdFx0XHRcdFx0fVxyXG5cdFx0XHRcdFx0XHQvL2NvbnNvbGUubG9nKFwiSW50ZXJzZWN0aW9uIGNhbmRpZGF0ZSBhdCBcIitpK1wiIHwgXCIrTWF0aC5yb3VuZChlbDEqMTAwLjAqMTAwLjApLzEwMC4wKTtcclxuXHRcdFx0XHRcdH1cclxuXHRcdFx0XHR9XHJcblx0XHRcdFx0Lyp2YXIgcmVzID0gVXRpbHMuaW50ZXJjZXB0T25DaXJjbGUodGdbaV0sdGdbaSsxXSxwb3MscnIpO1xyXG5cdFx0XHRcdGlmIChyZXMpIFxyXG5cdFx0XHRcdHtcclxuXHRcdFx0XHRcdC8vIGhhcyBpbnRlcnNlY3Rpb24gKDIgcG9pbnRzKVxyXG5cdFx0XHRcdFx0dmFyIGQxID0gVXRpbHMuZGlzdHAocmVzWzBdLHRnW2ldKTtcclxuXHRcdFx0XHRcdHZhciBkMiA9IFV0aWxzLmRpc3RwKHJlc1sxXSx0Z1tpXSk7XHJcblx0XHRcdFx0XHR2YXIgZDMgPSBVdGlscy5kaXN0cCh0Z1tpXSx0Z1tpKzFdKTtcclxuXHRcdFx0XHRcdHZhciBlbDEgPSB0aGlzLnRyYWNrLmRpc3RhbmNlc0VsYXBzZWRbaV0rKHRoaXMudHJhY2suZGlzdGFuY2VzRWxhcHNlZFtpKzFdLXRoaXMudHJhY2suZGlzdGFuY2VzRWxhcHNlZFtpXSkqZDEvZDM7XHJcblx0XHRcdFx0XHR2YXIgZWwyID0gdGhpcy50cmFjay5kaXN0YW5jZXNFbGFwc2VkW2ldKyh0aGlzLnRyYWNrLmRpc3RhbmNlc0VsYXBzZWRbaSsxXS10aGlzLnRyYWNrLmRpc3RhbmNlc0VsYXBzZWRbaV0pKmQyL2QzO1xyXG5cdFx0XHRcdFx0Ly9jb25zb2xlLmxvZyhcIkludGVyc2VjdGlvbiBjYW5kaWRhdGUgYXQgXCIraStcIiB8IFwiK01hdGgucm91bmQoZWwxKjEwMC4wKjEwMC4wKS8xMDAuMCtcIiB8IFwiK01hdGgucm91bmQoZWwyKjEwMC4wKjEwMC4wKS8xMDAuMCtcIiB8IExFTFA9XCIrTWF0aC5yb3VuZChsZWxwKjEwMC4wKjEwMC4wKS8xMDAuMCk7XHJcblx0XHRcdFx0XHRpZiAoZWwxIDwgbGVscClcclxuXHRcdFx0XHRcdFx0ZWwxPWxlbHA7XHJcblx0XHRcdFx0XHRpZiAoZWwyIDwgbGVscClcclxuXHRcdFx0XHRcdFx0ZWwyPWxlbHA7XHJcblx0XHRcdFx0XHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRcdFx0XHRcdGlmIChtaW5mID09IG51bGwgfHwgZWwxIDwgbWluZilcclxuXHRcdFx0XHRcdFx0bWluZj1lbDE7XHJcblx0XHRcdFx0XHRpZiAoZWwyIDwgbWluZilcclxuXHRcdFx0XHRcdFx0bWluZj1lbDI7XHJcblx0XHRcdFx0fSovXHJcblx0XHRcdH1cclxuXHRcdFx0Ly8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cdFx0XHRcclxuXHRcdFx0LyppZiAobWluZiA9PSBudWxsKVxyXG5cdFx0XHRcdGNvbnNvbGUuZXJyb3IoXCJNSU5GIE5VTExcIik7XHJcblx0XHRcdGVsc2VcclxuXHRcdFx0XHRjb25zb2xlLmxvZyhcIj4+IE1JTkYgXCIrTWF0aC5yb3VuZChtaW5mKjEwMC4wKjEwMC4wKS8xMDAuMCk7Ki9cclxuXHRcdFx0aWYgKGRlYnVnSW5mbylcclxuXHRcdFx0XHRzdGF0ZS5kZWJ1Z0luZm89ZGVidWdJbmZvO1xyXG5cdFx0XHQvL2NvbnNvbGUubG9nKFwiU1RBVFRUVFRURUVFRUUgOiBcIitKU09OLnN0cmluZ2lmeShzdGF0ZSkpO1xyXG5cdFx0XHRpZiAobWluZiA9PSBudWxsKSB7XHJcblx0XHRcdFx0c3RhdGUuc2V0RWxhcHNlZChsZWxwKTtcclxuXHRcdFx0XHR0aGlzLmFkZFN0YXRlKHN0YXRlKTtcclxuXHRcdFx0XHRyZXR1cm47XHJcblx0XHRcdH1cclxuXHJcblx0XHRcdGJlc3RtPW1pbmY7XHJcblx0XHRcdGlmIChiZXN0bSAhPSBudWxsKSBcclxuXHRcdFx0e1xyXG5cdFx0XHRcdHZhciBuZWwgPSBiZXN0bTsgXHJcblx0XHRcdFx0aWYgKGxzdGF0ZSkgXHJcblx0XHRcdFx0e1xyXG5cdFx0XHRcdFx0LyppZiAobmVsIDwgbHN0YXRlLmdldEVsYXBzZWQoKSkgXHJcblx0XHRcdFx0XHR7XHJcblx0XHRcdFx0XHRcdC8vIFdST05HIERJUkVDVElPTiBPUiBHUFMgREFUQSBXUk9ORz8gU0tJUC4uXHJcblx0XHRcdFx0XHRcdGlmICgobHN0YXRlLmdldEVsYXBzZWQoKS1uZWwpKnRyYWNrbGVuIDwgQ09ORklHLmNvbnN0cmFpbnRzLmJhY2t3YXJkc0Vwc2lsb25Jbk1ldGVyKSBcclxuXHRcdFx0XHRcdFx0XHRyZXR1cm47XHJcblx0XHRcdFx0XHRcdGRvICBcclxuXHRcdFx0XHRcdFx0e1xyXG5cdFx0XHRcdFx0XHRcdG5lbCs9MS4wO1xyXG5cdFx0XHRcdFx0XHR9IHdoaWxlIChuZWwgPCBsc3RhdGUuZ2V0RWxhcHNlZCgpKTtcclxuXHRcdFx0XHRcdH0qL1xyXG5cdFx0XHRcdFx0Ly8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdFx0XHRcdFx0aWYgKG5lbCA+IHRoaXMudHJhY2subGFwcykge1xyXG5cdFx0XHRcdFx0XHRuZWw9dGhpcy50cmFjay5sYXBzO1xyXG5cdFx0XHRcdFx0fVxyXG5cdFx0XHRcdFx0Ly8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdFx0XHRcdFx0bGxzdGF0ZSA9IHRoaXMuc3RhdGVzLmxlbmd0aCA+PSBDT05GSUcubWF0aC5zcGVlZEFuZEFjY2VsZXJhdGlvbkF2ZXJhZ2VEZWdyZWUqMiA/IHRoaXMuc3RhdGVzW3RoaXMuc3RhdGVzLmxlbmd0aC1DT05GSUcubWF0aC5zcGVlZEFuZEFjY2VsZXJhdGlvbkF2ZXJhZ2VEZWdyZWUqMl0gOiBudWxsO1xyXG5cdFx0XHRcdFx0bHN0YXRlID0gdGhpcy5zdGF0ZXMubGVuZ3RoID49IENPTkZJRy5tYXRoLnNwZWVkQW5kQWNjZWxlcmF0aW9uQXZlcmFnZURlZ3JlZSA/IHRoaXMuc3RhdGVzW3RoaXMuc3RhdGVzLmxlbmd0aC1DT05GSUcubWF0aC5zcGVlZEFuZEFjY2VsZXJhdGlvbkF2ZXJhZ2VEZWdyZWVdIDogbnVsbDtcclxuXHRcdFx0XHRcdGlmIChsc3RhdGUpICB7XHJcblx0XHRcdFx0XHRcdHN0YXRlLnNldFNwZWVkKCB0cmFja2xlbiAqIChuZWwtbHN0YXRlLmdldEVsYXBzZWQoKSkgKiAxMDAwIC8gKGN0aW1lLWxzdGF0ZS50aW1lc3RhbXApKTtcclxuXHRcdFx0XHRcdFx0aWYgKGxsc3RhdGUpIFxyXG5cdFx0XHRcdFx0XHRcdHN0YXRlLnNldEFjY2VsZXJhdGlvbiggKHN0YXRlLmdldFNwZWVkKCktbHN0YXRlLmdldFNwZWVkKCkpICogMTAwMCAvIChjdGltZS1sc3RhdGUudGltZXN0YW1wKSk7XHJcblx0XHRcdFx0XHR9XHJcblx0XHRcdFx0XHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0XHRcdFx0fVxyXG5cdFx0XHRcdHN0YXRlLnNldEVsYXBzZWQobmVsKTtcclxuXHRcdFx0fSBlbHNlIHtcclxuXHRcdFx0XHRpZiAobHN0YXRlKVxyXG5cdFx0XHRcdFx0c3RhdGUuc2V0RWxhcHNlZChsc3RhdGUuZ2V0RWxhcHNlZCgpKTtcclxuXHRcdFx0XHRpZiAobHN0YXRlLmdldEVsYXBzZWQoKSAhPSB0aGlzLnRyYWNrLmxhcHMpIHtcclxuXHRcdFx0XHRcdHRoaXMuc2V0SXNEaXNjYXJkZWQodHJ1ZSk7XHJcblx0XHRcdFx0fVxyXG5cdFx0XHR9XHJcblx0XHRcdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRcdFx0dGhpcy5hZGRTdGF0ZShzdGF0ZSk7XHJcblx0XHR9LFxyXG5cdFx0XHJcblx0XHRhZGRTdGF0ZSA6IGZ1bmN0aW9uKHN0YXRlKSB7XHJcblx0XHRcdHRoaXMuc3RhdGVzLnB1c2goc3RhdGUpO1xyXG5cdFx0XHRpZiAodGhpcy5zdGF0ZXMubGVuZ3RoID4gQ09ORklHLmNvbnN0cmFpbnRzLm1heFBhcnRpY2lwYW50U3RhdGVIaXN0b3J5ICYmICF0aGlzLmlzU09TKVxyXG5cdFx0XHRcdHRoaXMuc3RhdGVzLnNoaWZ0KCk7XHJcblx0XHR9LFxyXG5cclxuXHRcdGdldExhc3RTdGF0ZTogZnVuY3Rpb24oKSB7XHJcblx0XHRcdHJldHVybiB0aGlzLnN0YXRlcy5sZW5ndGggPyB0aGlzLnN0YXRlc1t0aGlzLnN0YXRlcy5sZW5ndGgtMV0gOiBudWxsO1xyXG5cdFx0fSxcclxuXHJcblx0XHRnZXRGcmVxIDogZnVuY3Rpb24oKSB7XHJcblx0XHRcdHZhciBsc3RhdGUgPSB0aGlzLmdldExhc3RTdGF0ZSgpO1xyXG5cdFx0XHRyZXR1cm4gbHN0YXRlID8gbHN0YXRlLmZyZXEgOiAwO1xyXG5cdFx0fSxcclxuXHJcblx0XHRnZXRTcGVlZCA6IGZ1bmN0aW9uKCkge1xyXG5cdFx0XHR2YXIgbHN0YXRlID0gdGhpcy5nZXRMYXN0U3RhdGUoKTtcclxuXHRcdFx0cmV0dXJuIGxzdGF0ZSA/IGxzdGF0ZS5zcGVlZCA6IDA7XHJcblx0XHR9LFxyXG5cclxuXHRcdGdldEdQUyA6IGZ1bmN0aW9uKCkge1xyXG5cdFx0XHR2YXIgbHN0YXRlID0gdGhpcy5nZXRMYXN0U3RhdGUoKTtcclxuXHRcdFx0cmV0dXJuIGxzdGF0ZSA/IGxzdGF0ZS5ncHMgOiB0aGlzLmdldFBvc2l0aW9uKCk7XHJcblx0XHR9LFxyXG5cclxuXHRcdGdldEVsYXBzZWQgOiBmdW5jdGlvbigpIHtcclxuXHRcdFx0dmFyIGxzdGF0ZSA9IHRoaXMuZ2V0TGFzdFN0YXRlKCk7XHJcblx0XHRcdHJldHVybiBsc3RhdGUgPyBsc3RhdGUuZWxhcHNlZCA6IDA7XHJcblx0XHR9LFxyXG5cclxuXHRcdGdldFBvcHVwSFRNTCA6IGZ1bmN0aW9uKCkge1xyXG5cdFx0XHR2YXIgcG9zID0gdGhpcy5nZXRQb3NpdGlvbigpO1xyXG5cdFx0XHRpZiAodGhpcy5pc1NPUyB8fCB0aGlzLmlzRGlzY2FyZGVkKSB7XHJcblx0XHRcdFx0cG9zID0gdGhpcy5nZXRHUFMoKTtcclxuXHRcdFx0fVxyXG5cdFx0XHR2YXIgdGxlbiA9IHRoaXMudHJhY2suZ2V0VHJhY2tMZW5ndGgoKTtcclxuXHRcdFx0dmFyIGN0aW1lID0gKG5ldyBEYXRlKCkpLmdldFRpbWUoKTtcclxuXHRcdFx0dmFyIGVsYXBzZWQgPSB0aGlzLmNhbGN1bGF0ZUVsYXBzZWRBdmVyYWdlKGN0aW1lKTtcclxuXHRcdFx0dmFyIHRwYXJ0ID0gdGhpcy50cmFjay5nZXRUcmFja1BhcnQoZWxhcHNlZCk7XHJcblx0XHRcdHZhciB0YXJnZXRLTTtcclxuXHRcdFx0dmFyIHBhcnRTdGFydDtcclxuXHRcdFx0dmFyIHRwYXJ0TW9yZTtcclxuXHRcdFx0aWYgKHRwYXJ0ID09IDApIHtcclxuXHRcdFx0XHR0cGFydHM9XCJTV0lNXCI7XHJcblx0XHRcdFx0dGFyZ2V0S009dGhpcy50cmFjay5iaWtlU3RhcnRLTTtcclxuXHRcdFx0XHRwYXJ0U3RhcnQ9MDtcclxuXHRcdFx0XHR0cGFydE1vcmU9XCJTV0lNXCI7XHJcblx0XHRcdH0gZWxzZSBpZiAodHBhcnQgPT0gMSkge1xyXG5cdFx0XHRcdHRwYXJ0cz1cIkJJS0VcIjtcclxuXHRcdFx0XHR0YXJnZXRLTT10aGlzLnRyYWNrLnJ1blN0YXJ0S007XHJcblx0XHRcdFx0cGFydFN0YXJ0PXRoaXMudHJhY2suYmlrZVN0YXJ0S007XHJcblx0XHRcdFx0dHBhcnRNb3JlPVwiUklERVwiO1xyXG5cdFx0XHR9IGVsc2UgaWYgKHRwYXJ0ID09IDIpIHsgXHJcblx0XHRcdFx0dHBhcnRzPVwiUlVOXCI7XHJcblx0XHRcdFx0dGFyZ2V0S009dGxlbi8xMDAwLjA7XHJcblx0XHRcdFx0cGFydFN0YXJ0PXRoaXMudHJhY2sucnVuU3RhcnRLTTtcclxuXHRcdFx0XHR0cGFydE1vcmU9XCJSVU5cIjtcclxuXHRcdFx0fVxyXG5cdFx0XHR2YXIgaHRtbD1cIjxkaXYgY2xhc3M9J3BvcHVwX2NvZGUnIHN0eWxlPSdjb2xvcjpyZ2JhKFwiK2NvbG9yQWxwaGFBcnJheSh0aGlzLmdldENvbG9yKCksMC45KS5qb2luKFwiLFwiKStcIiknPlwiK2VzY2FwZUhUTUwodGhpcy5nZXRDb2RlKCkpK1wiICgxKTwvZGl2PlwiO1xyXG5cdFx0XHR2YXIgZnJlcSA9IE1hdGgucm91bmQodGhpcy5nZXRGcmVxKCkpO1xyXG5cdFx0XHRpZiAoZnJlcSA+IDApIHtcclxuXHRcdFx0XHRodG1sKz1cIjxkaXYgY2xhc3NcIiArXHJcblx0XHRcdFx0XHRcdFwiPSdwb3B1cF9mcmVxJz5cIitmcmVxK1wiPC9kaXY+XCI7XHJcblx0XHRcdH1cclxuXHRcdFx0dmFyIGVsa20gPSBlbGFwc2VkKnRsZW4vMTAwMC4wO1xyXG5cdFx0XHR2YXIgZWxrbXMgPSBwYXJzZUZsb2F0KE1hdGgucm91bmQoZWxrbSAqIDEwMCkgLyAxMDApLnRvRml4ZWQoMik7XHRcdFx0XHJcblxyXG5cdFx0XHQvKnZhciByZWttID0gZWxhcHNlZCUxLjA7XHJcblx0XHRcdHJla209KDEuMC1yZWttKSp0bGVuLzEwMDAuMDtcclxuXHRcdFx0cmVrbSA9IHBhcnNlRmxvYXQoTWF0aC5yb3VuZChyZWttICogMTAwKSAvIDEwMCkudG9GaXhlZCgyKTsqL1x0XHRcdFxyXG5cdFx0XHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0XHRcdHZhciBlc3RmPW51bGw7XHJcblx0XHRcdHZhciBldHh0MT1udWxsO1xyXG5cdFx0XHR2YXIgZXR4dDI9bnVsbDtcclxuXHRcdFx0dmFyIGxzdGF0ZSA9IG51bGw7IFxyXG5cdFx0XHRpZiAodGhpcy5zdGF0ZXMubGVuZ3RoKSBcclxuXHRcdFx0e1xyXG5cdFx0XHRcdGxzdGF0ZSA9IHRoaXMuc3RhdGVzW3RoaXMuc3RhdGVzLmxlbmd0aC0xXTtcclxuXHRcdFx0XHRpZiAobHN0YXRlLmdldFNwZWVkKCkgPiAwKSBcclxuXHRcdFx0XHR7XHJcblx0XHRcdFx0XHR2YXIgc3BtcyA9IE1hdGguY2VpbChsc3RhdGUuZ2V0U3BlZWQoKSAqIDEwMCkgLyAxMDA7XHJcblx0XHRcdFx0XHRzcG1zLz0xMDAwLjA7XHJcblx0XHRcdFx0XHRzcG1zKj02MCo2MDtcclxuXHRcdFx0XHRcdGV0eHQxPXBhcnNlRmxvYXQoc3BtcykudG9GaXhlZCgyKStcIiBrbS9oXCI7XHJcblx0XHRcdFx0XHR2YXIgcm90ID0gLXRoaXMuZ2V0Um90YXRpb24oKSoxODAvTWF0aC5QSTsgXHJcblx0XHRcdFx0XHRpZiAocm90IDwgMClcclxuXHRcdFx0XHRcdFx0cm90Kz0zNjA7XHJcblx0XHRcdFx0XHRpZiAocm90ICE9IG51bGwpIFxyXG5cdFx0XHRcdFx0e1xyXG5cdFx0XHRcdFx0XHRpZiAocm90IDw9IDApIFxyXG5cdFx0XHRcdFx0XHRcdGV0eHQxKz1cIiBFXCI7XHJcblx0XHRcdFx0XHRcdGVsc2UgaWYgKHJvdCA8PSA0NSlcclxuXHRcdFx0XHRcdFx0XHRldHh0MSs9XCIgU0VcIjtcclxuXHRcdFx0XHRcdFx0ZWxzZSBpZiAocm90IDw9IDkwKVxyXG5cdFx0XHRcdFx0XHRcdGV0eHQxKz1cIiBTXCI7XHJcblx0XHRcdFx0XHRcdGVsc2UgaWYgKHJvdCA8PSAxMzUpXHJcblx0XHRcdFx0XHRcdFx0ZXR4dDErPVwiIFNXXCI7XHJcblx0XHRcdFx0XHRcdGVsc2UgaWYgKHJvdCA8PSAxODApXHJcblx0XHRcdFx0XHRcdFx0ZXR4dDErPVwiIFdcIjtcclxuXHRcdFx0XHRcdFx0ZWxzZSBpZiAocm90IDw9IDIyNSlcclxuXHRcdFx0XHRcdFx0XHRldHh0MSs9XCIgTldcIjtcclxuXHRcdFx0XHRcdFx0ZWxzZSBpZiAocm90IDw9IDI3MClcclxuXHRcdFx0XHRcdFx0XHRldHh0MSs9XCIgTlwiO1xyXG5cdFx0XHRcdFx0XHRlbHNlIFxyXG5cdFx0XHRcdFx0XHRcdGV0eHQxKz1cIiBORVwiO1xyXG5cdFx0XHRcdFx0fVxyXG5cdFx0XHRcdFx0ZXN0Zj1VdGlscy5mb3JtYXRUaW1lKG5ldyBEYXRlKCBjdGltZSArIHRhcmdldEtNKjEwMDAgLyBzcG1zKjEwMDAgKSk7ICBcclxuXHRcdFx0XHR9XHJcblx0XHRcdFx0aWYgKGxzdGF0ZS5nZXRBY2NlbGVyYXRpb24oKSA+IDApXHJcblx0XHRcdFx0XHRldHh0Mj1wYXJzZUZsb2F0KE1hdGguY2VpbChsc3RhdGUuZ2V0QWNjZWxlcmF0aW9uKCkgKiAxMDApIC8gMTAwKS50b0ZpeGVkKDIpK1wiIG0vczJcIjtcclxuXHRcdFx0fVxyXG5cdFx0XHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRcdFx0dmFyIHAxID0gMTAwKnRoaXMudHJhY2suYmlrZVN0YXJ0S00vKHRsZW4vMTAwMC4wKTtcclxuXHRcdFx0dmFyIHAyID0gMTAwKih0aGlzLnRyYWNrLnJ1blN0YXJ0S00tdGhpcy50cmFjay5iaWtlU3RhcnRLTSkvKHRsZW4vMTAwMC4wKTtcclxuXHRcdFx0dmFyIHAzID0gMTAwKih0bGVuLzEwMDAuMCAtIHRoaXMudHJhY2sucnVuU3RhcnRLTSkvKHRsZW4vMTAwMC4wKTtcclxuXHRcdFx0dmFyIHByZXR0eUNvb3JkPVxyXG5cdFx0XHRcdFwiPGRpdiBzdHlsZT0nb3BhY2l0eTowLjc7ZmxvYXQ6bGVmdDtvdmVyZmxvdzpoaWRkZW47aGVpZ2h0OjdweDt3aWR0aDpcIitwMStcIiU7YmFja2dyb3VuZC1jb2xvcjpcIitDT05GSUcuYXBwZWFyYW5jZS50cmFja0NvbG9yU3dpbStcIicvPlwiK1xyXG5cdFx0XHRcdFwiPGRpdiBzdHlsZT0nb3BhY2l0eTowLjc7ZmxvYXQ6bGVmdDtvdmVyZmxvdzpoaWRkZW47aGVpZ2h0OjdweDt3aWR0aDpcIitwMitcIiU7YmFja2dyb3VuZC1jb2xvcjpcIitDT05GSUcuYXBwZWFyYW5jZS50cmFja0NvbG9yQmlrZStcIicvPlwiK1xyXG5cdFx0XHRcdFwiPGRpdiBzdHlsZT0nb3BhY2l0eTowLjc7ZmxvYXQ6bGVmdDtvdmVyZmxvdzpoaWRkZW47aGVpZ2h0OjdweDt3aWR0aDpcIitwMytcIiU7YmFja2dyb3VuZC1jb2xvcjpcIitDT05GSUcuYXBwZWFyYW5jZS50cmFja0NvbG9yUnVuK1wiJy8+XCJcclxuXHRcdFx0XHQ7IC8vb2wuY29vcmRpbmF0ZS50b1N0cmluZ0hETVModGhpcy5nZXRQb3NpdGlvbigpLCAyKTtcclxuXHJcblx0XHRcdHZhciBpbWdkaXY7XHJcblx0XHRcdGlmICh0cGFydCA9PSAwKVxyXG5cdFx0XHRcdGltZ2Rpdj1cIjxpbWcgY2xhc3M9J3BvcHVwX3RyYWNrX21vZGUnIHN0eWxlPSdsZWZ0OlwiK2VsYXBzZWQqMTAwK1wiJScgc3JjPSdpbWcvc3dpbS5zdmcnLz5cIlxyXG5cdFx0XHRlbHNlIGlmICh0cGFydCA9PSAxKVxyXG5cdFx0XHRcdGltZ2Rpdj1cIjxpbWcgY2xhc3M9J3BvcHVwX3RyYWNrX21vZGUnIHN0eWxlPSdsZWZ0OlwiK2VsYXBzZWQqMTAwK1wiJScgc3JjPSdpbWcvYmlrZS5zdmcnLz5cIlxyXG5cdFx0XHRlbHNlIC8qaWYgKHRwYXJ0ID09IDIpKi9cclxuXHRcdFx0XHRpbWdkaXY9XCI8aW1nIGNsYXNzPSdwb3B1cF90cmFja19tb2RlJyBzdHlsZT0nbGVmdDpcIitlbGFwc2VkKjEwMCtcIiUnIHNyYz0naW1nL3J1bi5zdmcnLz5cIlxyXG5cdFxyXG5cclxuXHRcdFx0dmFyIHBhc3MgPSBNYXRoLnJvdW5kKChuZXcgRGF0ZSgpKS5nZXRUaW1lKCkvMzUwMCkgJSAzO1xyXG5cdFx0XHRodG1sKz1cIjx0YWJsZSBjbGFzcz0ncG9wdXBfdGFibGUnIHN0eWxlPSdiYWNrZ3JvdW5kLWltYWdlOnVybChcXFwiXCIrdGhpcy5nZXRJbWFnZSgpK1wiXFxcIiknPlwiO1xyXG5cdFx0XHR2YXIgaXNEdW1teT0hKGVsYXBzZWQgPiAwKTtcclxuXHRcdFx0aHRtbCs9XCI8dHI+PHRkIGNsYXNzPSdsYmwnPkVsYXBzZWQ8L3RkPjx0ZCBjbGFzcz0ndmFsdWUnPlwiKyhpc0R1bW15ID8gXCItXCIgOiBlbGttcytcIiBrbVwiKStcIjwvdGQ+PC90cj5cIjtcclxuXHRcdFx0aHRtbCs9XCI8dHI+PHRkIGNsYXNzPSdsYmwnPk1vcmUgdG8gXCIrdHBhcnRNb3JlK1wiPC90ZD48dGQgY2xhc3M9J3ZhbHVlJz5cIisoaXNEdW1teSA/IFwiLVwiIDogcGFyc2VGbG9hdChNYXRoLnJvdW5kKCh0YXJnZXRLTS1lbGttKSAqIDEwMCkgLyAxMDApLnRvRml4ZWQoMikgLyogcmVrbSAqLyArXCIga21cIikrXCI8L3RkPjwvdHI+XCI7XHJcblx0XHRcdGh0bWwrPVwiPHRyPjx0ZCBjbGFzcz0nbGJsJz5GaW5pc2ggXCIrIHRwYXJ0cy50b0xvd2VyQ2FzZSgpICtcIjwvdGQ+PHRkIGNsYXNzPSd2YWx1ZSc+XCIrKCFlc3RmID8gXCItXCIgOiBlc3RmKStcIjwvdGQ+PC90cj5cIjtcdFx0XHRcdFx0XHJcblx0XHRcdGh0bWwrPVwiPHRyPjx0ZCBjbGFzcz0nbGJsJz5TcGVlZDwvdGQ+PHRkIGNsYXNzPSd2YWx1ZSc+XCIrKCFpc0R1bW15ICYmIGV0eHQxID8gZXR4dDEgOiBcIi1cIikgKyBcIjwvdGQ+PC90cj5cIjtcclxuXHRcdFx0aHRtbCs9XCI8dHI+PHRkIGNsYXNzPSdsYmwnPkFjY2VsZXIuPC90ZD48dGQgY2xhc3M9J3ZhbHVlJz5cIisoIWlzRHVtbXkgJiYgZXR4dDIgPyBldHh0MiA6IFwiLVwiKSArXCI8L3RkPjwvdHI+XCI7XHJcblx0XHRcdGh0bWwrPVwiPHRyIHN0eWxlPSdoZWlnaHQ6MTAwJSc+PHRkPiZuYnNwOzwvdGQ+PHRkPiZuYnNwOzwvdGQ+PC90cj5cIjtcclxuXHRcdFx0aHRtbCtcIjwvdGFibGU+XCJcclxuXHRcdFx0Ly9odG1sKz1cIjxkaXYgY2xhc3M9J3BvcHVwX3NoYWRvdyc+XCIrcHJldHR5Q29vcmQraW1nZGl2K1wiPC9kaXY+XCI7XHJcblx0XHRcdFxyXG5cdFx0XHR2YXIgcmFuaz1cIi1cIjtcclxuXHRcdFx0aWYgKHRoaXMuX19wb3MgIT0gdW5kZWZpbmVkKVxyXG5cdFx0XHRcdHJhbms9dGhpcy5fX3BvcyArIDE7ICAgLy8gdGhlIGZpcnN0IHBvcyAtIHRoZSBGQVNURVNUIGlzIDBcclxuXHRcdFx0XHJcblx0XHRcdFxyXG5cdFx0XHRodG1sPVwiPGRpdiBjbGFzcz0ncG9wdXBfY29udGVudF9wcmcnPjxkaXYgc3R5bGU9J3dpZHRoOlwiK3AxK1wiJTtoZWlnaHQ6NnB4O2JhY2tncm91bmQtY29sb3I6XCIrQ09ORklHLmFwcGVhcmFuY2UudHJhY2tDb2xvclN3aW0rXCI7ZmxvYXQ6bGVmdDsnPjwvZGl2PjxkaXYgc3R5bGU9J3dpZHRoOlwiK3AyK1wiJTtoZWlnaHQ6NnB4O2JhY2tncm91bmQtY29sb3I6XCIrQ09ORklHLmFwcGVhcmFuY2UudHJhY2tDb2xvckJpa2UrXCI7ZmxvYXQ6bGVmdDsnPjwvZGl2PjxkaXYgc3R5bGU9J3dpZHRoOlwiK3AzK1wiJTtoZWlnaHQ6NnB4O2JhY2tncm91bmQtY29sb3I6XCIrQ09ORklHLmFwcGVhcmFuY2UudHJhY2tDb2xvclJ1bitcIjtmbG9hdDpsZWZ0Oyc+PC9kaXY+XCI7XHJcblx0XHRcdGh0bWwrPVwiPGRpdiBjbGFzcz0ncG9wdXBfdHJhY2tfcG9zJz48ZGl2IGNsYXNzPSdwb3B1cF90cmFja19wb3NfMScgc3R5bGU9J2xlZnQ6XCIrKGVsYXBzZWQqOTApK1wiJSc+PC9kaXY+PC9kaXY+XCI7XHJcblx0XHRcdGh0bWwrPVwiPC9kaXY+XCI7XHJcblx0XHRcdGh0bWwrPVwiPGltZyBjbGFzcz0ncG9wdXBfY29udGVudF9pbWcnIHNyYz0nXCIrdGhpcy5nZXRJbWFnZSgpK1wiJy8+XCI7XHJcblx0XHRcdGh0bWwrPVwiPGRpdiBjbGFzcz0ncG9wdXBfY29udGVudF8xJz5cIjtcclxuXHRcdFx0aHRtbCs9XCI8ZGl2IGNsYXNzPSdwb3B1cF9jb250ZW50X25hbWUnPlwiK2VzY2FwZUhUTUwodGhpcy5nZXRDb2RlKCkpK1wiPC9kaXY+XCI7XHJcblx0XHRcdGh0bWwrPVwiPGRpdiBjbGFzcz0ncG9wdXBfY29udGVudF9sMSc+XCIrdGhpcy5nZXRDb3VudHJ5KCkuc3Vic3RyaW5nKDAsMykudG9VcHBlckNhc2UoKStcIiB8IFBvczogXCIrcmFuaytcIiB8IFNwZWVkOiBcIisoIWlzRHVtbXkgJiYgZXR4dDEgPyBldHh0MSA6IFwiLVwiKStcIjwvZGl2PlwiO1xyXG5cdFx0XHR2YXIgcGFzcyA9IE1hdGgucm91bmQoKChuZXcgRGF0ZSgpKS5nZXRUaW1lKCkgLyAxMDAwIC8gNCkpJTI7XHJcblx0XHRcdGlmIChwYXNzID09IDApIHtcclxuXHRcdFx0XHRpZiAodGhpcy5fX3BvcyAhPSB1bmRlZmluZWQpIFxyXG5cdFx0XHRcdHtcclxuXHRcdFx0XHRcdHBhcnNlRmxvYXQoTWF0aC5yb3VuZChlbGttICogMTAwKSAvIDEwMCkudG9GaXhlZCgyKTtcclxuXHJcblx0XHRcdFx0XHQvLyB0aGlzLl9fbmV4dCBpcyB0aGUgcGFydGljaXBhbnQgYmVoaW5kIHRoaXMgb25lIChlLmcgdGhlIHNsb3dlciBvbmUgd2l0aCBsZXN0IGVsYXBzZWQgaW5kZXgpXHJcblx0XHRcdFx0XHQvLyBhbmQgdGhpcy5fX3ByZXYgaXMgdGhlIG9uZSBiZWZvcmUgdXNcclxuXHRcdFx0XHRcdC8vIHNvIGlmIHBhcnRpY2lwYW50IGlzIGluIHBvc2l0aW9uIDMgdGhlIG9uZSBiZWZvcmUgaGltIHdpbGwgYmUgMiBhbmQgdGhlIG9uZSBiZWhpbmQgaGltIHdpbGwgYmUgNFxyXG5cdFx0XHRcdFx0Ly8gKGUuZy4gXCJ0aGlzLl9fcG9zID09IDNcIiA9PiB0aGlzLl9fcHJldi5fX3BvcyA9PSAyIGFuZCB0aGlzLl9fcHJldi5fX25leHQgPT0gNFxyXG5cdFx0XHRcdFx0Ly8gZm9yIHRoZVxyXG5cclxuXHRcdFx0XHRcdGlmICh0aGlzLl9fcHJldiAmJiB0aGlzLl9fcHJldi5fX3BvcyAhPSB1bmRlZmluZWQgJiYgdGhpcy5nZXRTcGVlZCgpKSB7XHJcblx0XHRcdFx0XHRcdC8vIHdoYXQgaXMgdGhlIGRpZmZlcmVuY2UgYmV0d2VlbiBjdXJyZW50IG9uZSBhbmQgdGhlIG9uZSBiZWZvcmUgLSB3ZSB3aWxsIHJ1biBzbyBvdXIgc3BlZWRcclxuXHRcdFx0XHRcdFx0Ly8gd2hhdCB0aW1lIHdlIGFyZSBzaG9ydCAtIHNvIHdpbGwgYWRkIGEgbWludXMgaW4gZnJvbnQgb2YgdGhlIHRpbWVcclxuXHRcdFx0XHRcdFx0dmFyIGVsYXBzZWRwcmV2ID0gdGhpcy5fX3ByZXYuY2FsY3VsYXRlRWxhcHNlZEF2ZXJhZ2UoY3RpbWUpO1xyXG5cdFx0XHRcdFx0XHR2YXIgZHByZXYgPSAoKGVsYXBzZWRwcmV2IC0gZWxhcHNlZCkqdGhpcy50cmFjay5nZXRUcmFja0xlbmd0aCgpIC8gdGhpcy5nZXRTcGVlZCgpKS82MC4wO1xyXG5cdFx0XHRcdFx0XHRkcHJldiA9IHBhcnNlRmxvYXQoTWF0aC5yb3VuZChkcHJldiAqIDEwMCkgLyAxMDApLnRvRml4ZWQoMik7XHJcblx0XHRcdFx0XHRcdGh0bWwrPVwiPGRpdiBjbGFzcz0ncG9wdXBfY29udGVudF9sMic+R0FQIFBcIisodGhpcy5fX3ByZXYuX19wb3MgKyAxKStcIiA6IC1cIitkcHJlditcIiBNaW48L2Rpdj5cIjtcclxuXHRcdFx0XHRcdH0gZWxzZSB7XHJcblx0XHRcdFx0XHRcdGh0bWwrPVwiPGRpdiBjbGFzcz0ncG9wdXBfY29udGVudF9sMic+Jm5ic3A7PC9kaXY+XCI7XHJcblx0XHRcdFx0XHR9XHJcblxyXG5cdFx0XHRcdFx0aWYgKHRoaXMuX19uZXh0ICYmIHRoaXMuX19uZXh0Ll9fcG9zICE9IHVuZGVmaW5lZCAmJiB0aGlzLl9fbmV4dC5nZXRTcGVlZCgpKSB7XHJcblx0XHRcdFx0XHRcdC8vIHdoYXQgaXMgdGhlIGRpZmZlcmVuY2UgYmV0d2VlbiBjdXJyZW50IG9uZSBhbmQgdGhlIG9uZSBiZWhpbmQgLSB0aGlzIG90aGVyIG9uZSB3aWxsIHJ1biBzbyBoaXMgc3BlZWRcclxuXHRcdFx0XHRcdFx0Ly8gd2FodCB0aW1lIHdlIGFyZSBhaGVhZCAtIHNvIGEgcG9zaXRpdmUgdGltZVxyXG5cdFx0XHRcdFx0XHR2YXIgZWxhcHNlZG5leHQgPSB0aGlzLl9fbmV4dC5jYWxjdWxhdGVFbGFwc2VkQXZlcmFnZShjdGltZSk7XHJcblx0XHRcdFx0XHRcdHZhciBkbmV4dCA9ICgoZWxhcHNlZCAtIGVsYXBzZWRuZXh0KSp0aGlzLnRyYWNrLmdldFRyYWNrTGVuZ3RoKCkgLyB0aGlzLl9fbmV4dC5nZXRTcGVlZCgpKS82MC4wO1xyXG5cdFx0XHRcdFx0XHRkbmV4dCA9IHBhcnNlRmxvYXQoTWF0aC5yb3VuZChkbmV4dCAqIDEwMCkgLyAxMDApLnRvRml4ZWQoMik7XHJcblx0XHRcdFx0XHRcdGh0bWwrPVwiPGRpdiBjbGFzcz0ncG9wdXBfY29udGVudF9sMyc+R0FQIFBcIisodGhpcy5fX25leHQuX19wb3MgKyAxKStcIiA6IFwiK2RuZXh0K1wiIE1pbjwvZGl2PlwiO1xyXG5cdFx0XHRcdFx0fSBlbHNlIHtcclxuXHRcdFx0XHRcdFx0aHRtbCs9XCI8ZGl2IGNsYXNzPSdwb3B1cF9jb250ZW50X2wyJz4mbmJzcDs8L2Rpdj5cIjtcclxuXHRcdFx0XHRcdH1cclxuXHRcdFx0XHR9XHJcblx0XHRcdH0gZWxzZSB7XHJcblx0XHRcdFx0aHRtbCs9XCI8ZGl2IGNsYXNzPSdwb3B1cF9jb250ZW50X2wyJz5NT1JFIFRPICBcIit0cGFydE1vcmUrXCI6IFwiKyhpc0R1bW15ID8gXCItXCIgOiBwYXJzZUZsb2F0KE1hdGgucm91bmQoKHRhcmdldEtNLWVsa20pICogMTAwKSAvIDEwMCkudG9GaXhlZCgyKSAvKiByZWttICovICtcIiBrbVwiKStcIjwvZGl2PlwiO1xyXG5cdFx0XHRcdGh0bWwrPVwiPGRpdiBjbGFzcz0ncG9wdXBfY29udGVudF9sMyc+RklOSVNIIFwiKyB0cGFydHMgK1wiOiBcIisoIWVzdGYgPyBcIi1cIiA6IGVzdGYpK1wiPC9kaXY+XCI7XHJcblx0XHRcdH1cclxuXHRcdFx0aHRtbCs9XCI8L2Rpdj5cIjtcclxuXHRcdFx0cmV0dXJuIGh0bWw7XHJcblx0XHR9XHJcblx0XHRcclxuXHRcdFxyXG4gICAgfVxyXG59KTtcclxuIiwicmVxdWlyZSgnam9vc2UnKTtcclxuXHJcbkNsYXNzKFwiUG9pbnRcIiwge1xyXG4gICAgLy8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG4gICAgLy8gQUxMIENPT1JESU5BVEVTIEFSRSBJTiBXT1JMRCBNRVJDQVRPUlxyXG4gICAgLy8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cclxuICAgIGhhcyA6IHtcclxuICAgICAgICBjb2RlIDoge1xyXG4gICAgICAgICAgICBpcyA6IFwicndcIixcclxuICAgICAgICAgICAgaW5pdCA6IFwiQ09ERV9OT1RfU0VUXCJcclxuICAgICAgICB9LFxyXG4gICAgICAgIGlkIDoge1xyXG4gICAgICAgICAgICBpcyA6IFwicndcIixcclxuICAgICAgICAgICAgaW5pdCA6IFwiSURfTk9UX1NFVFwiXHJcbiAgICAgICAgfSxcclxuICAgICAgICBmZWF0dXJlIDoge1xyXG4gICAgICAgICAgICBpcyA6IFwicndcIixcclxuICAgICAgICAgICAgaW5pdCA6IG51bGxcclxuICAgICAgICB9LFxyXG4gICAgICAgIHBvc2l0aW9uIDoge1xyXG4gICAgICAgICAgICBpczogICBcInJ3XCIsXHJcbiAgICAgICAgICAgIGluaXQ6IFswLDBdXHQvL2xvbiBsYXQgd29ybGQgbWVyY2F0b3JcclxuICAgICAgICB9XHJcbiAgICB9LFxyXG5cclxuICAgIG1ldGhvZHMgOiB7XHJcbiAgICAgICAgaW5pdCA6IGZ1bmN0aW9uKHBvcykge1xyXG4gICAgICAgICAgICBpZiAodHlwZW9mIG9sICE9IFwidW5kZWZpbmVkXCIpIHtcclxuICAgICAgICAgICAgICAgIHZhciBnZW9tID0gbmV3IG9sLmdlb20uUG9pbnQocG9zKTtcclxuICAgICAgICAgICAgICAgIGdlb20udHJhbnNmb3JtKCdFUFNHOjQzMjYnLCAnRVBTRzozODU3Jyk7XHJcbiAgICAgICAgICAgICAgICB2YXIgZmVhdHVyZSA9IG5ldyBvbC5GZWF0dXJlKCk7XHJcbiAgICAgICAgICAgICAgICBmZWF0dXJlLnNldEdlb21ldHJ5KGdlb20pO1xyXG4gICAgICAgICAgICAgICAgdGhpcy5zZXRGZWF0dXJlKGZlYXR1cmUpO1xyXG5cclxuICAgICAgICAgICAgICAgIHRoaXMuc2V0UG9zaXRpb24ocG9zKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgIH1cclxufSk7IiwidmFyIENPTkZJRyA9IHJlcXVpcmUoJy4vQ29uZmlnJyk7XHJcblxyXG52YXIgU1RZTEVTPVxyXG57XHJcblx0Ly8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHQvLyBzdHlsZSBmdW5jdGlvbiBmb3IgdHJhY2tcclxuXHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdFx0XHJcblx0XCJfdHJhY2tcIjogZnVuY3Rpb24oZmVhdHVyZSxyZXNvbHV0aW9uKSBcclxuXHR7XHJcbiAgICAgICAgcmV0dXJuIFtcclxuICAgICAgICBdO1xyXG5cdH0sXHJcblxyXG5cdFwidGVzdFwiOiBmdW5jdGlvbihmZWF0dXJlLHJlc29sdXRpb24pIFxyXG5cdHtcclxuXHRcdHZhciBzdHlsZXM9W107XHJcbiAgICAgICAgc3R5bGVzLnB1c2gobmV3IG9sLnN0eWxlLlN0eWxlKHtcclxuICAgICAgICAgICAgaW1hZ2U6IG5ldyBvbC5zdHlsZS5DaXJjbGUoe1xyXG4gICAgICAgICAgICAgICAgcmFkaXVzOiAxNyxcclxuICAgICAgICAgICAgICAgIGZpbGw6IG5ldyBvbC5zdHlsZS5GaWxsKHtcclxuICAgICAgICAgICAgICAgICAgICBjb2xvcjogXCJyZ2JhKDI1NSwyNTUsMjU1LDAuNSlcIlxyXG4gICAgICAgICAgICAgICAgfSksXHJcbiAgICAgICAgICAgICAgICBzdHJva2U6IG5ldyBvbC5zdHlsZS5TdHJva2Uoe1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbG9yOiBcInJnYmEoMjU1LDI1NSwyNTUsMSlcIixcclxuICAgICAgICAgICAgICAgICAgICB3aWR0aDogM1xyXG4gICAgICAgICAgICAgICAgfSlcclxuICAgICAgICAgICAgfSlcclxuICAgICAgICB9KSk7XHJcbiAgICAgICAgcmV0dXJuIHN0eWxlcztcclxuXHR9LFxyXG5cclxuXHRcInRlc3QyXCI6IGZ1bmN0aW9uKGZlYXR1cmUscmVzb2x1dGlvbikgXHJcblx0e1xyXG5cdFx0dmFyIHN0eWxlcz1bXTtcclxuICAgICAgICBzdHlsZXMucHVzaChuZXcgb2wuc3R5bGUuU3R5bGUoe1xyXG4gICAgICAgICAgICBzdHJva2U6IG5ldyBvbC5zdHlsZS5TdHJva2Uoe1xyXG4gICAgICAgICAgICAgICAgY29sb3I6IFwicmdiYSgyNTUsMjU1LDAsMSlcIixcclxuICAgICAgICAgICAgICAgIHdpZHRoOiAzXHJcbiAgICAgICAgICAgIH0pLFxyXG5cdCAgICAgICAgaW1hZ2U6IG5ldyBvbC5zdHlsZS5DaXJjbGUoe1xyXG5cdCAgICAgICAgICAgIHJhZGl1czogNyxcclxuXHQgICAgICAgICAgICBzdHJva2U6IG5ldyBvbC5zdHlsZS5TdHJva2Uoe1xyXG5cdCAgICAgICAgICAgIFx0Ly9mZWF0dXJlLmNvbG9yXHJcblx0ICAgICAgICAgICAgICAgIGNvbG9yOiBcInJnYmEoMjU1LDI1NSwwLDEpXCIsXHJcblx0ICAgICAgICAgICAgICAgIHdpZHRoOiAzXHJcblx0ICAgICAgICAgICAgfSksXHJcblx0ICAgICAgICAgICAgZmlsbDogbmV3IG9sLnN0eWxlLlN0cm9rZSh7XHJcblx0ICAgICAgICAgICAgXHQvL2ZlYXR1cmUuY29sb3JcclxuXHQgICAgICAgICAgICAgICAgY29sb3I6IFwicmdiYSgyNTUsMjU1LDAsMC43KVwiLFxyXG5cdCAgICAgICAgICAgICAgICB3aWR0aDogM1xyXG5cdCAgICAgICAgICAgIH0pXHJcblx0ICAgICAgICB9KSxcclxuXHQgICAgICAgIHRleHQ6IG5ldyBvbC5zdHlsZS5UZXh0KHtcclxuXHQgICAgICAgICAgICBmb250OiAnYm9sZCAxNXB4IExhdG8tUmVndWxhcicsXHJcblx0ICAgICAgICAgICAgZmlsbDogbmV3IG9sLnN0eWxlLkZpbGwoe1xyXG5cdCAgICAgICAgICAgICAgICBjb2xvcjogJ3JnYmEoMjU1LDI1NSwwLDEpJ1xyXG5cdCAgICAgICAgICAgIH0pLFxyXG5cdCAgICAgICAgICAgIHRleHQ6IGZlYXR1cmUuZ2V0R2VvbWV0cnkoKSBpbnN0YW5jZW9mIG9sLmdlb20uUG9pbnQgPyAoTWF0aC5yb3VuZChmZWF0dXJlLmRlYnVnSW5mby52YWx1ZSoxMDAqMTAwLjApLzEwMC4wKStcIiVcIiA6IFwiXCIsXHJcblx0ICAgICAgICAgICAgb2Zmc2V0WDogIDAsXHJcblx0ICAgICAgICAgICAgb2Zmc2V0WSA6IDE2XHJcblx0ICAgICAgICB9KVxyXG4gICAgICAgIH0pKTtcclxuICAgICAgICByZXR1cm4gc3R5bGVzO1xyXG5cdH0sXHJcblxyXG5cdFwidGVzdDFcIjogZnVuY3Rpb24oZmVhdHVyZSxyZXNvbHV0aW9uKSBcclxuXHR7XHJcblx0XHR2YXIgc3R5bGVzPVtdO1xyXG4gICAgICAgIHN0eWxlcy5wdXNoKG5ldyBvbC5zdHlsZS5TdHlsZSh7XHJcbiAgICAgICAgICAgICBzdHJva2U6IG5ldyBvbC5zdHlsZS5TdHJva2Uoe1xyXG4gICAgICAgICAgICAgICAgIGNvbG9yOiBcInJnYmEoMCwwLDAsMC40KVwiLFxyXG4gICAgICAgICAgICAgICAgIHdpZHRoOiAzXHJcbiAgICAgICAgICAgICB9KSxcclxuXHQgICAgICAgICBmaWxsOiBuZXcgb2wuc3R5bGUuRmlsbCh7XHJcblx0ICAgICAgICAgICAgY29sb3I6IFwicmdiYSg0MCwyNTUsNDAsMC4yKVwiXHJcblx0ICAgICAgICAgfSksXHJcbiAgICAgICAgfSkpO1xyXG4gICAgICAgIHJldHVybiBzdHlsZXM7XHJcblx0fSxcclxuXHRcInRyYWNrXCIgOiBmdW5jdGlvbihmZWF0dXJlLHJlc29sdXRpb24pIFxyXG5cdHtcclxuXHRcdHZhciBzdHlsZXM9W107XHJcblx0XHR2YXIgdHJhY2s9ZmVhdHVyZS50cmFjaztcclxuXHRcdGlmICghdHJhY2spIHtcclxuXHRcdFx0Y29uc29sZS5sb2coXCJSZW5kZXJpbmcgdHJhY2sgZmVhdHVyZSB3aXRob3V0IHRyYWNrIG9iamVjdCFcIik7XHJcblx0XHRcdHJldHVybiBzdHlsZXM7XHJcblx0XHR9XHJcblx0XHR2YXIgY29vcmRzPWZlYXR1cmUuZ2V0R2VvbWV0cnkoKS5nZXRDb29yZGluYXRlcygpO1xyXG5cdFx0dmFyIGdlb21zd2ltPWNvb3JkcztcclxuXHRcdHZhciBnZW9tYmlrZTtcclxuXHRcdHZhciBnZW9tcnVuO1xyXG5cdFx0Ly8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0XHRcclxuXHRcdC8qdmFyIHd3ID0gOC4wL3Jlc29sdXRpb247XHJcblx0XHRpZiAod3cgPCA2LjApXHJcblx0XHRcdHd3PTYuMDsqL1xyXG5cdFx0dmFyIHd3PTEwLjA7XHJcblxyXG5cdFx0Ly8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0XHRpZiAodHJhY2sgJiYgIWlzTmFOKHRyYWNrLmJpa2VTdGFydEtNKSkgXHJcblx0XHR7XHJcblx0XHRcdGZvciAodmFyIGk9MDtpPHRyYWNrLmRpc3RhbmNlcy5sZW5ndGg7aSsrKSB7XHJcblx0XHRcdFx0aWYgKHRyYWNrLmRpc3RhbmNlc1tpXSA+PSB0cmFjay5iaWtlU3RhcnRLTSoxMDAwKSB7XHJcblx0XHRcdFx0XHRicmVhaztcclxuXHRcdFx0XHR9XHJcblx0XHRcdH1cclxuXHRcdFx0dmFyIGo7XHJcblx0XHRcdGlmICghaXNOYU4odHJhY2sucnVuU3RhcnRLTSkpIHtcclxuXHRcdFx0XHRmb3IgKGo9aTtqPHRyYWNrLmRpc3RhbmNlcy5sZW5ndGg7aisrKSB7XHJcblx0XHRcdFx0XHRpZiAodHJhY2suZGlzdGFuY2VzW2pdID49IHRyYWNrLnJ1blN0YXJ0S00qMTAwMClcclxuXHRcdFx0XHRcdFx0YnJlYWs7XHJcblx0XHRcdFx0fVxyXG5cdFx0XHR9IGVsc2Uge1xyXG5cdFx0XHRcdGo9dHJhY2suZGlzdGFuY2VzLmxlbmd0aDtcclxuXHRcdFx0fVxyXG5cdFx0XHRnZW9tc3dpbT1jb29yZHMuc2xpY2UoMCxpKTtcclxuXHRcdFx0Z2VvbWJpa2U9Y29vcmRzLnNsaWNlKGkgPCAxID8gaSA6IGktMSxqKTtcclxuXHRcdFx0aWYgKGogPCB0cmFjay5kaXN0YW5jZXMubGVuZ3RoKVxyXG5cdFx0XHRcdGdlb21ydW49Y29vcmRzLnNsaWNlKGogPCAxID8gaiA6IGotMSx0cmFjay5kaXN0YW5jZXMubGVuZ3RoKTtcclxuXHRcdFx0aWYgKCFnZW9tc3dpbSB8fCAhZ2VvbXN3aW0ubGVuZ3RoKVxyXG5cdFx0XHRcdGdlb21zd2ltPW51bGw7XHJcblx0XHRcdGlmICghZ2VvbWJpa2UgfHwgIWdlb21iaWtlLmxlbmd0aClcclxuXHRcdFx0XHRnZW9tYmlrZT1udWxsO1xyXG5cdFx0XHRpZiAoIWdlb21ydW4gfHwgIWdlb21ydW4ubGVuZ3RoKVxyXG4gICAgICAgICAgICAgICAgZ2VvbXJ1bj1udWxsO1xyXG5cdFx0fVxyXG5cclxuXHJcbiAgICAgICAgaWYgKGdlb21zd2ltICYmIEdVSS5pc1Nob3dTd2ltKSB7XHJcbiAgICAgICAgICAgIHN0eWxlcy5wdXNoKG5ldyBvbC5zdHlsZS5TdHlsZSh7XHJcbiAgICAgICAgICAgICAgICAgICAgZ2VvbWV0cnk6IG5ldyBvbC5nZW9tLkxpbmVTdHJpbmcoZ2VvbXN3aW0pLFxyXG4gICAgICAgICAgICAgICAgICAgIHN0cm9rZTogbmV3IG9sLnN0eWxlLlN0cm9rZSh7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbG9yOiBDT05GSUcuYXBwZWFyYW5jZS50cmFja0NvbG9yU3dpbSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgd2lkdGg6IHd3XHJcbiAgICAgICAgICAgICAgICAgICAgfSlcclxuICAgICAgICAgICAgICAgIH0pXHJcbiAgICAgICAgICAgICk7XHJcbiAgICAgICAgICAgIFNUWUxFUy5fZ2VuRGlyZWN0aW9uKGdlb21zd2ltLCB3dywgcmVzb2x1dGlvbiwgQ09ORklHLmFwcGVhcmFuY2UudHJhY2tDb2xvclN3aW0sIHN0eWxlcyk7XHJcblxyXG4gICAgICAgICAgICBTVFlMRVMuX2dlbkRpc3RhbmNlS20od3csIHJlc29sdXRpb24sIGNvb3JkcywgdHJhY2suZGlzdGFuY2VzLCAwLCBpLCBzdHlsZXMpO1xyXG5cclxuXHRcdFx0Ly8gZm9yIG5vdyBkb24ndCBzaG93IHRoaXMgY2hlY2twb2ludFxyXG5cdFx0XHQvL2lmIChHVUkuaXNTaG93U3dpbSlcclxuXHRcdFx0Ly9cdFNUWUxFUy5fZ2VuQ2hlY2twb2ludChnZW9tc3dpbSwgQ09ORklHLmFwcGVhcmFuY2UudHJhY2tDb2xvclN3aW0sIHN0eWxlcyk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGlmIChnZW9tYmlrZSAmJiBHVUkuaXNTaG93QmlrZSlcclxuICAgICAgICB7XHJcbiAgICAgICAgICAgIHN0eWxlcy5wdXNoKG5ldyBvbC5zdHlsZS5TdHlsZSh7XHJcbiAgICAgICAgICAgICAgICAgICAgZ2VvbWV0cnk6IG5ldyBvbC5nZW9tLkxpbmVTdHJpbmcoZ2VvbWJpa2UpLFxyXG4gICAgICAgICAgICAgICAgICAgIHN0cm9rZTogbmV3IG9sLnN0eWxlLlN0cm9rZSh7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbG9yOiBDT05GSUcuYXBwZWFyYW5jZS50cmFja0NvbG9yQmlrZSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgd2lkdGg6IHd3XHJcbiAgICAgICAgICAgICAgICAgICAgfSlcclxuICAgICAgICAgICAgICAgIH0pXHJcbiAgICAgICAgICAgICk7XHJcbiAgICAgICAgICAgIFNUWUxFUy5fZ2VuRGlyZWN0aW9uKGdlb21iaWtlLCB3dywgcmVzb2x1dGlvbiwgQ09ORklHLmFwcGVhcmFuY2UudHJhY2tDb2xvckJpa2UsIHN0eWxlcyk7XHJcblxyXG4gICAgICAgICAgICBTVFlMRVMuX2dlbkRpc3RhbmNlS20od3csIHJlc29sdXRpb24sIGNvb3JkcywgdHJhY2suZGlzdGFuY2VzLCBpLCBqLCBzdHlsZXMpO1xyXG5cclxuXHRcdFx0Ly8gYWRkIGNoZWNrcG9pbnQgaWYgdGhpcyBpcyBub3QgYWxyZWFkeSBhZGRlZCBhcyBhIGhvdHNwb3RcclxuXHRcdFx0aWYgKCF0cmFjay5pc0FkZGVkSG90U3BvdFN3aW1CaWtlKSB7XHJcblx0XHRcdFx0aWYgKENPTkZJRy5hcHBlYXJhbmNlLmlzU2hvd0NoZWNrcG9pbnRJbWFnZSlcclxuXHRcdFx0XHRcdFNUWUxFUy5fZ2VuQ2hlY2twb2ludEltYWdlKGdlb21iaWtlLCBDT05GSUcuYXBwZWFyYW5jZS5pbWFnZUNoZWNrcG9pbnRTd2ltQmlrZSwgc3R5bGVzKTtcclxuXHRcdFx0XHRlbHNlIGlmIChDT05GSUcuYXBwZWFyYW5jZS5pc1Nob3dDaGVja3BvaW50ICYmIEdVSS5pc1Nob3dCaWtlKVxyXG5cdFx0XHRcdFx0U1RZTEVTLl9nZW5DaGVja3BvaW50KGdlb21iaWtlLCBDT05GSUcuYXBwZWFyYW5jZS50cmFja0NvbG9yQmlrZSwgc3R5bGVzKTtcclxuXHRcdFx0fVxyXG4gICAgICAgIH1cclxuXHRcdGlmIChnZW9tcnVuICYmIEdVSS5pc1Nob3dSdW4pXHJcblx0XHR7XHJcblx0XHRcdHN0eWxlcy5wdXNoKG5ldyBvbC5zdHlsZS5TdHlsZSh7XHJcbiAgICAgICAgICAgICAgICAgICAgZ2VvbWV0cnk6IG5ldyBvbC5nZW9tLkxpbmVTdHJpbmcoZ2VvbXJ1biksXHJcbiAgICAgICAgICAgICAgICAgICAgc3Ryb2tlOiBuZXcgb2wuc3R5bGUuU3Ryb2tlKHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29sb3I6IENPTkZJRy5hcHBlYXJhbmNlLnRyYWNrQ29sb3JSdW4sXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHdpZHRoOiB3d1xyXG4gICAgICAgICAgICAgICAgICAgIH0pXHJcbiAgICAgICAgICAgICAgICB9KVxyXG4gICAgICAgICAgICApO1xyXG4gICAgICAgICAgICBTVFlMRVMuX2dlbkRpcmVjdGlvbihnZW9tcnVuLCB3dywgcmVzb2x1dGlvbiwgQ09ORklHLmFwcGVhcmFuY2UudHJhY2tDb2xvclJ1biwgc3R5bGVzKTtcclxuXHJcbiAgICAgICAgICAgIFNUWUxFUy5fZ2VuRGlzdGFuY2VLbSh3dywgcmVzb2x1dGlvbiwgY29vcmRzLCB0cmFjay5kaXN0YW5jZXMsIGosIHRyYWNrLmRpc3RhbmNlcy5sZW5ndGgsIHN0eWxlcyk7XHJcblxyXG5cdFx0XHQvLyBhZGQgY2hlY2twb2ludCBpZiB0aGlzIGlzIG5vdCBhbHJlYWR5IGFkZGVkIGFzIGEgaG90c3BvdFxyXG5cdFx0XHRpZiAoIXRyYWNrLmlzQWRkZWRIb3RTcG90QmlrZVJ1bikge1xyXG5cdFx0XHRcdGlmIChDT05GSUcuYXBwZWFyYW5jZS5pc1Nob3dDaGVja3BvaW50SW1hZ2UpXHJcblx0XHRcdFx0XHRTVFlMRVMuX2dlbkNoZWNrcG9pbnRJbWFnZShnZW9tcnVuLCBDT05GSUcuYXBwZWFyYW5jZS5pbWFnZUNoZWNrcG9pbnRCaWtlUnVuLCBzdHlsZXMpO1xyXG5cdFx0XHRcdGVsc2UgaWYgKENPTkZJRy5hcHBlYXJhbmNlLmlzU2hvd0NoZWNrcG9pbnQgJiYgR1VJLmlzU2hvd0Jpa2UpXHJcblx0XHRcdFx0XHRTVFlMRVMuX2dlbkNoZWNrcG9pbnQoZ2VvbXJ1biwgQ09ORklHLmFwcGVhcmFuY2UudHJhY2tDb2xvclJ1biwgc3R5bGVzKTtcclxuXHRcdFx0fVxyXG4gICAgICAgIH1cclxuXHJcblx0XHQvLyBTVEFSVC1GSU5JU0ggLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRcdGlmIChjb29yZHMgJiYgY29vcmRzLmxlbmd0aCA+PSAyKVxyXG5cdFx0e1xyXG5cdFx0XHR2YXIgc3RhcnQgPSBjb29yZHNbMF07XHJcblx0XHRcdHZhciBlbmQgPSBjb29yZHNbMV07XHJcblx0XHRcdC8qdmFyIGR4ID0gZW5kWzBdIC0gc3RhcnRbMF07XHJcblx0XHRcdCB2YXIgZHkgPSBlbmRbMV0gLSBzdGFydFsxXTtcclxuXHRcdFx0IHZhciByb3RhdGlvbiA9IE1hdGguYXRhbjIoZHksIGR4KTtcclxuXHRcdFx0IHN0eWxlcy5wdXNoKG5ldyBvbC5zdHlsZS5TdHlsZShcclxuXHRcdFx0IHtcclxuXHRcdFx0IGdlb21ldHJ5OiBuZXcgb2wuZ2VvbS5Qb2ludChzdGFydCksXHJcblx0XHRcdCBpbWFnZTogbmV3IG9sLnN0eWxlLkljb24oe1xyXG5cdFx0XHQgc3JjOiAnaW1nL2JlZ2luLWVuZC1hcnJvdy5wbmcnLFxyXG5cdFx0XHQgc2NhbGUgOiAwLjQ1LFxyXG5cdFx0XHQgYW5jaG9yOiBbMC4wLCAwLjVdLFxyXG5cdFx0XHQgcm90YXRlV2l0aFZpZXc6IHRydWUsXHJcblx0XHRcdCByb3RhdGlvbjogLXJvdGF0aW9uLFxyXG5cdFx0XHQgb3BhY2l0eSA6IDFcclxuXHRcdFx0IH0pXHJcblx0XHRcdCB9KSk7Ki9cclxuXHJcblx0XHRcdC8vIGxvb3A/XHJcblx0XHRcdGVuZCA9IGNvb3Jkc1tjb29yZHMubGVuZ3RoLTFdO1xyXG5cdFx0XHRpZiAoZW5kWzBdICE9IHN0YXJ0WzBdIHx8IGVuZFsxXSAhPSBzdGFydFsxXSlcclxuXHRcdFx0e1xyXG5cdFx0XHRcdHZhciBzdGFydCA9IGNvb3Jkc1tjb29yZHMubGVuZ3RoLTJdO1xyXG5cdFx0XHRcdHZhciBkeCA9IGVuZFswXSAtIHN0YXJ0WzBdO1xyXG5cdFx0XHRcdHZhciBkeSA9IGVuZFsxXSAtIHN0YXJ0WzFdO1xyXG5cdFx0XHRcdHZhciByb3RhdGlvbiA9IE1hdGguYXRhbjIoZHksIGR4KTtcclxuXHRcdFx0XHRzdHlsZXMucHVzaChuZXcgb2wuc3R5bGUuU3R5bGUoXHJcblx0XHRcdFx0XHR7XHJcblx0XHRcdFx0XHRcdGdlb21ldHJ5OiBuZXcgb2wuZ2VvbS5Qb2ludChlbmQpLFxyXG5cdFx0XHRcdFx0XHRpbWFnZTogbmV3IG9sLnN0eWxlLkljb24oe1xyXG5cdFx0XHRcdFx0XHRcdHNyYzogQ09ORklHLmFwcGVhcmFuY2UuaW1hZ2VGaW5pc2gsXHJcblx0XHRcdFx0XHRcdFx0c2NhbGUgOiAwLjQ1LFxyXG5cdFx0XHRcdFx0XHRcdGFuY2hvcjogWzAuNSwgMC41XSxcclxuXHRcdFx0XHRcdFx0XHRyb3RhdGVXaXRoVmlldzogdHJ1ZSxcclxuXHRcdFx0XHRcdFx0XHQvL3JvdGF0aW9uOiAtcm90YXRpb24sXHJcblx0XHRcdFx0XHRcdFx0b3BhY2l0eSA6IDFcclxuXHRcdFx0XHRcdFx0fSlcclxuXHRcdFx0XHRcdH0pKTtcclxuXHRcdFx0fVxyXG5cdFx0fVxyXG5cclxuXHRcdHJldHVybiBzdHlsZXM7XHJcblx0fSxcclxuXHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0XCJkZWJ1Z0dQU1wiIDogZnVuY3Rpb24oZmVhdHVyZSxyZXNvbHV0aW9uKSBcclxuXHR7XHJcblx0XHR2YXIgY29lZiA9ICgobmV3IERhdGUoKSkuZ2V0VGltZSgpLWZlYXR1cmUudGltZUNyZWF0ZWQpLyhDT05GSUcudGltZW91dHMuZ3BzTG9jYXRpb25EZWJ1Z1Nob3cqMTAwMCk7XHJcblx0XHRpZiAoY29lZiA+IDEpXHJcblx0XHRcdHJldHVybiBbXTtcclxuXHRcdHJldHVybiBbXHJcblx0XHQgICAgICAgIG5ldyBvbC5zdHlsZS5TdHlsZSh7XHJcblx0XHQgICAgICAgIGltYWdlOiBuZXcgb2wuc3R5bGUuQ2lyY2xlKHtcclxuXHRcdCAgICAgICAgICAgIHJhZGl1czogY29lZioyMCxcclxuXHRcdCAgICAgICAgICAgIHN0cm9rZTogbmV3IG9sLnN0eWxlLlN0cm9rZSh7XHJcblx0XHQgICAgICAgICAgICBcdC8vZmVhdHVyZS5jb2xvclxyXG5cdFx0ICAgICAgICAgICAgICAgIGNvbG9yOiBjb2xvckFscGhhQXJyYXkoZmVhdHVyZS5jb2xvciwoMS4wLWNvZWYpKjEuMCksIFxyXG5cdFx0ICAgICAgICAgICAgICAgIHdpZHRoOiA0XHJcblx0XHQgICAgICAgICAgICB9KVxyXG5cdFx0ICAgICAgICAgIH0pXHJcblx0XHR9KV07XHJcblx0fSxcclxuXHRcclxuXHRcInBhcnRpY2lwYW50XCIgOiBmdW5jdGlvbihmZWF0dXJlLHJlc29sdXRpb24pIFxyXG5cdHtcclxuXHRcdC8vIFNLSVAgRFJBVyAoVE9ETyBPUFRJTUlaRSlcclxuXHRcdHZhciBwYXJ0ID0gZmVhdHVyZS5wYXJ0aWNpcGFudDtcclxuXHRcdGlmICghcGFydC5pc0Zhdm9yaXRlKVxyXG5cdFx0XHRyZXR1cm4gW107XHJcblx0XHRcclxuXHRcdHZhciBldHh0PVwiXCI7XHJcblx0XHR2YXIgbHN0YXRlID0gbnVsbDtcclxuXHRcdGlmIChwYXJ0LnN0YXRlcy5sZW5ndGgpIHtcclxuXHRcdFx0bHN0YXRlID0gcGFydC5zdGF0ZXNbcGFydC5zdGF0ZXMubGVuZ3RoLTFdO1xyXG5cdFx0XHRldHh0PVwiIFwiK3BhcnNlRmxvYXQoTWF0aC5jZWlsKGxzdGF0ZS5nZXRTcGVlZCgpICogMTAwKSAvIDEwMCkudG9GaXhlZCgyKStcIiBtL3NcIjsvLyB8IGFjYyBcIitwYXJzZUZsb2F0KE1hdGguY2VpbChsc3RhdGUuZ2V0QWNjZWxlcmF0aW9uKCkgKiAxMDApIC8gMTAwKS50b0ZpeGVkKDIpK1wiIG0vc1wiO1xyXG5cdFx0fVxyXG5cdFx0dmFyIHpJbmRleCA9IE1hdGgucm91bmQocGFydC5nZXRFbGFwc2VkKCkqMTAwMDAwMCkqMTAwMCtwYXJ0LnNlcUlkO1xyXG5cdFx0LyppZiAocGFydCA9PSBHVUkuZ2V0U2VsZWN0ZWRQYXJ0aWNpcGFudCgpKSB7XHJcblx0XHRcdHpJbmRleD0xZTIwO1xyXG5cdFx0fSovXHJcblx0XHR2YXIgc3R5bGVzPVtdO1xyXG5cdFx0Ly8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdFx0dmFyIGN0aW1lID0gKG5ldyBEYXRlKCkpLmdldFRpbWUoKTtcclxuXHRcdHZhciBpc1RpbWUgPSAoY3RpbWUgPj0gQ09ORklHLnRpbWVzLmJlZ2luICYmIGN0aW1lIDw9IENPTkZJRy50aW1lcy5lbmQpO1xyXG5cdFx0dmFyIGlzRGlyZWN0aW9uID0gKGxzdGF0ZSAmJiBsc3RhdGUuZ2V0U3BlZWQoKSA+IDAgJiYgIXBhcnQuaXNTT1MgJiYgIXBhcnQuaXNEaXNjYXJkZWQgJiYgaXNUaW1lKTtcclxuXHRcdHZhciBhbmltRnJhbWUgPSAoY3RpbWUlMzAwMCkqTWF0aC5QSSoyLzMwMDAuMDtcclxuXHJcbiAgICAgICAgaWYgKGlzVGltZSkge1xyXG4gICAgICAgICAgICBzdHlsZXMucHVzaChuZXcgb2wuc3R5bGUuU3R5bGUoe1xyXG4gICAgICAgICAgICAgICAgekluZGV4OiB6SW5kZXgsXHJcbiAgICAgICAgICAgICAgICBpbWFnZTogbmV3IG9sLnN0eWxlLkNpcmNsZSh7XHJcbiAgICAgICAgICAgICAgICAgICAgcmFkaXVzOiAxNyxcclxuICAgICAgICAgICAgICAgICAgICBmaWxsOiBuZXcgb2wuc3R5bGUuRmlsbCh7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbG9yOiBwYXJ0LmlzRGlzY2FyZGVkIHx8IHBhcnQuaXNTT1MgPyBcInJnYmEoMTkyLDAsMCxcIiArIChNYXRoLnNpbihhbmltRnJhbWUpICogMC43ICsgMC4zKSArIFwiKVwiIDogXCJyZ2JhKFwiICsgY29sb3JBbHBoYUFycmF5KHBhcnQuY29sb3IsIDAuODUpLmpvaW4oXCIsXCIpICsgXCIpXCJcclxuICAgICAgICAgICAgICAgICAgICB9KSxcclxuICAgICAgICAgICAgICAgICAgICBzdHJva2U6IG5ldyBvbC5zdHlsZS5TdHJva2Uoe1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb2xvcjogcGFydC5pc0Rpc2NhcmRlZCB8fCBwYXJ0LmlzU09TID8gXCJyZ2JhKDI1NSwwLDAsXCIgKyAoMS4wIC0gKE1hdGguc2luKGFuaW1GcmFtZSkgKiAwLjcgKyAwLjMpKSArIFwiKVwiIDogXCIjZmZmZmZmXCIsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHdpZHRoOiAzXHJcbiAgICAgICAgICAgICAgICAgICAgfSlcclxuICAgICAgICAgICAgICAgIH0pLFxyXG4gICAgICAgICAgICAgICAgdGV4dDogbmV3IG9sLnN0eWxlLlRleHQoe1xyXG4gICAgICAgICAgICAgICAgICAgIGZvbnQ6ICdub3JtYWwgMTNweCBMYXRvLVJlZ3VsYXInLFxyXG4gICAgICAgICAgICAgICAgICAgIGZpbGw6IG5ldyBvbC5zdHlsZS5GaWxsKHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29sb3I6ICcjRkZGRkZGJ1xyXG4gICAgICAgICAgICAgICAgICAgIH0pLFxyXG4gICAgICAgICAgICAgICAgICAgIHRleHQ6IHBhcnQuZ2V0SW5pdGlhbHMoKSxcclxuICAgICAgICAgICAgICAgICAgICBvZmZzZXRYOiAwLFxyXG4gICAgICAgICAgICAgICAgICAgIG9mZnNldFk6IDBcclxuICAgICAgICAgICAgICAgIH0pXHJcbiAgICAgICAgICAgIH0pKTtcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICBzdHlsZXMucHVzaChuZXcgb2wuc3R5bGUuU3R5bGUoe1xyXG4gICAgICAgICAgICAgICAgekluZGV4OiB6SW5kZXgsXHJcbiAgICAgICAgICAgICAgICBpbWFnZTogbmV3IG9sLnN0eWxlLkNpcmNsZSh7XHJcbiAgICAgICAgICAgICAgICAgICAgcmFkaXVzOiAxNyxcclxuICAgICAgICAgICAgICAgICAgICBmaWxsOiBuZXcgb2wuc3R5bGUuRmlsbCh7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbG9yOiBcInJnYmEoXCIgKyBjb2xvckFscGhhQXJyYXkocGFydC5jb2xvciwgMC4zNSkuam9pbihcIixcIikgKyBcIilcIlxyXG4gICAgICAgICAgICAgICAgICAgIH0pLFxyXG4gICAgICAgICAgICAgICAgICAgIHN0cm9rZTogbmV3IG9sLnN0eWxlLlN0cm9rZSh7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbG9yOiBcInJnYmEoMjU1LDI1NSwyNTUsMSlcIixcclxuICAgICAgICAgICAgICAgICAgICAgICAgd2lkdGg6IDNcclxuICAgICAgICAgICAgICAgICAgICB9KVxyXG4gICAgICAgICAgICAgICAgfSksXHJcbiAgICAgICAgICAgICAgICB0ZXh0OiBuZXcgb2wuc3R5bGUuVGV4dCh7XHJcbiAgICAgICAgICAgICAgICAgICAgZm9udDogJ25vcm1hbCAxM3B4IExhdG8tUmVndWxhcicsXHJcbiAgICAgICAgICAgICAgICAgICAgZmlsbDogbmV3IG9sLnN0eWxlLkZpbGwoe1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb2xvcjogJyMwMDAwMDAnXHJcbiAgICAgICAgICAgICAgICAgICAgfSksXHJcbiAgICAgICAgICAgICAgICAgICAgdGV4dDogcGFydC5nZXREZXZpY2VJZCgpLFxyXG4gICAgICAgICAgICAgICAgICAgIG9mZnNldFg6IDAsXHJcbiAgICAgICAgICAgICAgICAgICAgb2Zmc2V0WTogMjBcclxuICAgICAgICAgICAgICAgIH0pXHJcbiAgICAgICAgICAgIH0pKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgLy8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG4gICAgICAgIHN0eWxlcy5wdXNoKG5ldyBvbC5zdHlsZS5TdHlsZSh7XHJcbiAgICAgICAgICAgIHpJbmRleDogekluZGV4LFxyXG4gICAgICAgICAgICBpbWFnZTogbmV3IG9sLnN0eWxlLkNpcmNsZSh7XHJcbiAgICAgICAgICAgICAgICByYWRpdXM6IDE3LFxyXG4gICAgICAgICAgICAgICAgZmlsbDogbmV3IG9sLnN0eWxlLkZpbGwoe1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbG9yOiBwYXJ0LmlzRGlzY2FyZGVkIHx8IHBhcnQuaXNTT1MgPyBcInJnYmEoMTkyLDAsMCxcIiArIChNYXRoLnNpbihhbmltRnJhbWUpICogMC43ICsgMC4zKSArIFwiKVwiIDogXCJyZ2JhKFwiICsgY29sb3JBbHBoYUFycmF5KHBhcnQuY29sb3IsIDAuODUpLmpvaW4oXCIsXCIpICsgXCIpXCJcclxuICAgICAgICAgICAgICAgIH0pLFxyXG4gICAgICAgICAgICAgICAgc3Ryb2tlOiBuZXcgb2wuc3R5bGUuU3Ryb2tlKHtcclxuICAgICAgICAgICAgICAgICAgICBjb2xvcjogcGFydC5pc0Rpc2NhcmRlZCB8fCBwYXJ0LmlzU09TID8gXCJyZ2JhKDI1NSwwLDAsXCIgKyAoMS4wIC0gKE1hdGguc2luKGFuaW1GcmFtZSkgKiAwLjcgKyAwLjMpKSArIFwiKVwiIDogXCIjZmZmZmZmXCIsXHJcbiAgICAgICAgICAgICAgICAgICAgd2lkdGg6IDNcclxuICAgICAgICAgICAgICAgIH0pXHJcbiAgICAgICAgICAgIH0pLFxyXG4gICAgICAgICAgICB0ZXh0OiBuZXcgb2wuc3R5bGUuVGV4dCh7XHJcbiAgICAgICAgICAgICAgICBmb250OiAnbm9ybWFsIDEzcHggTGF0by1SZWd1bGFyJyxcclxuICAgICAgICAgICAgICAgIGZpbGw6IG5ldyBvbC5zdHlsZS5GaWxsKHtcclxuICAgICAgICAgICAgICAgICAgICBjb2xvcjogJyNGRkZGRkYnXHJcbiAgICAgICAgICAgICAgICB9KSxcclxuICAgICAgICAgICAgICAgIHRleHQ6IHBhcnQuZ2V0SW5pdGlhbHMoKSxcclxuICAgICAgICAgICAgICAgIG9mZnNldFg6IDAsXHJcbiAgICAgICAgICAgICAgICBvZmZzZXRZOiAwXHJcbiAgICAgICAgICAgIH0pXHJcbiAgICAgICAgfSkpO1xyXG5cclxuXHJcbiAgICAgICAgaWYgKGlzRGlyZWN0aW9uICYmIHBhcnQuZ2V0Um90YXRpb24oKSAhPSBudWxsKVxyXG4gICAgICAgIHtcclxuICAgICAgICAgICAgc3R5bGVzLnB1c2gobmV3IG9sLnN0eWxlLlN0eWxlKHtcclxuICAgICAgICAgICAgICAgIHpJbmRleDogekluZGV4LFxyXG4gICAgICAgICAgICAgICAgaW1hZ2U6IG5ldyBvbC5zdHlsZS5JY29uKCh7XHJcbiAgICAgICAgICAgICAgICAgICAgYW5jaG9yOiBbLTAuNSwwLjVdLFxyXG4gICAgICAgICAgICAgICAgICAgIGFuY2hvclhVbml0czogJ2ZyYWN0aW9uJyxcclxuICAgICAgICAgICAgICAgICAgICBhbmNob3JZVW5pdHM6ICdmcmFjdGlvbicsXHJcbiAgICAgICAgICAgICAgICAgICAgb3BhY2l0eTogMSxcclxuICAgICAgICAgICAgICAgICAgICBzcmMgOiByZW5kZXJBcnJvd0Jhc2U2NCg0OCw0OCxwYXJ0LmNvbG9yKSxcclxuXHRcdFx0XHRcdCAgc2NhbGUgOiAwLjU1LFxyXG5cdFx0XHRcdFx0ICByb3RhdGlvbiA6IC1wYXJ0LmdldFJvdGF0aW9uKClcclxuXHRcdFx0XHQgICB9KSlcclxuXHRcdFx0fSkpO1xyXG5cdFx0fVxyXG4gICAgICAgIFxyXG5cdFx0Lyp2YXIgY29lZiA9IHBhcnQudHJhY2suZ2V0VHJhY2tMZW5ndGhJbldHUzg0KCkvcGFydC50cmFjay5nZXRUcmFja0xlbmd0aCgpO1x0XHRcclxuXHRcdHZhciByciA9IENPTkZJRy5tYXRoLmdwc0luYWNjdXJhY3kqY29lZjtcdFx0XHJcbiAgICAgICAgc3R5bGVzLnB1c2gobmV3IG9sLnN0eWxlLlN0eWxlKHtcclxuICAgICAgICAgICAgekluZGV4OiB6SW5kZXgsXHJcbiAgICAgICAgICAgIGltYWdlOiBuZXcgb2wuc3R5bGUuQ2lyY2xlKHtcclxuICAgICAgICAgICAgXHRnZW9tZXRyeTogbmV3IG9sLmdlb20uUG9pbnQocGFydC5nZXRHUFMoKSksXHJcbiAgICAgICAgICAgICAgICByYWRpdXM6IDEwLCAvL3JyICogcmVzb2x1dGlvbixcclxuICAgICAgICAgICAgICAgIGZpbGw6IG5ldyBvbC5zdHlsZS5GaWxsKHtcclxuICAgICAgICAgICAgICAgICAgICBjb2xvcjogXCJyZ2JhKDI1NSwyNTUsMjU1LDAuOClcIlxyXG4gICAgICAgICAgICAgICAgfSksXHJcbiAgICAgICAgICAgICAgICBzdHJva2U6IG5ldyBvbC5zdHlsZS5TdHJva2Uoe1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbG9yOiBcInJnYmEoMCwwLDAsMSlcIixcclxuICAgICAgICAgICAgICAgICAgICB3aWR0aDogMVxyXG4gICAgICAgICAgICAgICAgfSlcclxuICAgICAgICAgICAgfSlcclxuICAgICAgICB9KSk7Ki9cclxuXHRcdHJldHVybiBzdHlsZXM7XHJcblx0fSxcclxuXHJcblx0XCJjYW1cIiA6IGZ1bmN0aW9uKGZlYXR1cmUsIHJlc29sdXRpb24pIHtcclxuXHRcdHZhciBzdHlsZXM9W107XHJcblxyXG5cdFx0dmFyIGNhbSA9IGZlYXR1cmUuY2FtO1xyXG5cclxuXHRcdHN0eWxlcy5wdXNoKG5ldyBvbC5zdHlsZS5TdHlsZSh7XHJcblx0XHRcdGltYWdlOiBuZXcgb2wuc3R5bGUuSWNvbigoe1xyXG5cdFx0XHRcdC8vIFRPRE8gUnVtZW4gLSBpdCdzIGJldHRlciBhbGwgaW1hZ2VzIHRvIGJlIHRoZSBzYW1lIHNpemUsIHNvIHRoZSBzYW1lIHNjYWxlXHJcblx0XHRcdFx0c2NhbGUgOiAwLjA0MCxcclxuXHRcdFx0XHRzcmMgOiBDT05GSUcuYXBwZWFyYW5jZS5pbWFnZUNhbS5zcGxpdChcIi5zdmdcIikuam9pbigoY2FtLnNlcUlkKzEpICsgXCIuc3ZnXCIpXHJcblx0XHRcdH0pKVxyXG5cdFx0fSkpO1xyXG5cclxuXHRcdHJldHVybiBzdHlsZXM7XHJcblx0fSxcclxuXHJcbiAgICBcImhvdHNwb3RcIiA6IGZ1bmN0aW9uKGZlYXR1cmUsIHJlc29sdXRpb24pIHtcclxuICAgICAgICB2YXIgc3R5bGVzPVtdO1xyXG5cclxuICAgICAgICB2YXIgaG90c3BvdCA9IGZlYXR1cmUuaG90c3BvdDtcclxuXHJcbiAgICAgICAgc3R5bGVzLnB1c2gobmV3IG9sLnN0eWxlLlN0eWxlKHtcclxuICAgICAgICAgICAgaW1hZ2U6IG5ldyBvbC5zdHlsZS5JY29uKCh7XHJcbiAgICAgICAgICAgICAgICBzY2FsZSA6IGhvdHNwb3QuZ2V0VHlwZSgpLnNjYWxlIHx8IDEsXHJcbiAgICAgICAgICAgICAgICBzcmMgOiBob3RzcG90LmdldFR5cGUoKS5pbWFnZVxyXG4gICAgICAgICAgICB9KSlcclxuICAgICAgICB9KSk7XHJcblxyXG4gICAgICAgIHJldHVybiBzdHlsZXM7XHJcbiAgICB9LFxyXG5cclxuXHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdC8vIFByaXZhdGUgbWV0aG9kc1xyXG5cdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblxyXG5cdF90cmFja1NlbGVjdGVkIDogbmV3IG9sLnN0eWxlLlN0eWxlKHtcclxuXHRcdHN0cm9rZTogbmV3IG9sLnN0eWxlLlN0cm9rZSh7XHJcblx0XHRcdGNvbG9yOiAnI0ZGNTA1MCcsXHJcblx0XHRcdHdpZHRoOiA0LjVcclxuXHRcdH0pXHJcblx0fSksXHJcblxyXG5cdF9nZW5DaGVja3BvaW50IDogZnVuY3Rpb24oZ2VvbWV0cnksIGNvbG9yLCBzdHlsZXMpIHtcclxuXHRcdHZhciBzdGFydCA9IGdlb21ldHJ5WzBdO1xyXG5cdFx0dmFyIGVuZCA9IGdlb21ldHJ5WzFdO1xyXG5cdFx0dmFyIGR4ID0gZW5kWzBdIC0gc3RhcnRbMF07XHJcblx0XHR2YXIgZHkgPSBlbmRbMV0gLSBzdGFydFsxXTtcclxuXHRcdHZhciByb3RhdGlvbiA9IE1hdGguYXRhbjIoZHksIGR4KTtcclxuXHJcblx0XHRzdHlsZXMucHVzaChuZXcgb2wuc3R5bGUuU3R5bGUoe1xyXG5cdFx0XHRnZW9tZXRyeTogbmV3IG9sLmdlb20uUG9pbnQoc3RhcnQpLFxyXG5cdFx0XHRpbWFnZTogbmV3IG9sLnN0eWxlLkljb24oe1xyXG5cdFx0XHRcdHNyYzogcmVuZGVyQm94QmFzZTY0KDE2LDE2LGNvbG9yKSxcclxuXHRcdFx0XHRzY2FsZSA6IDEsXHJcblx0XHRcdFx0YW5jaG9yOiBbMC45MiwgMC41XSxcclxuXHRcdFx0XHRyb3RhdGVXaXRoVmlldzogdHJ1ZSxcclxuXHRcdFx0XHRyb3RhdGlvbjogLXJvdGF0aW9uLFxyXG5cdFx0XHRcdG9wYWNpdHkgOiAwLjY1XHJcblx0XHRcdH0pXHJcblx0XHR9KSk7XHJcblx0fSxcclxuXHJcblx0X2dlbkNoZWNrcG9pbnRJbWFnZSA6IGZ1bmN0aW9uKGdlb21ldHJ5LCBpbWFnZSwgc3R5bGVzKSB7XHJcblx0XHR2YXIgc3RhcnQgPSBnZW9tZXRyeVswXTtcclxuXHRcdC8vdmFyIGVuZCA9IGdlb21ldHJ5WzFdO1xyXG5cdFx0Ly92YXIgZHggPSBlbmRbMF0gLSBzdGFydFswXTtcclxuXHRcdC8vdmFyIGR5ID0gZW5kWzFdIC0gc3RhcnRbMV07XHJcblx0XHQvL3ZhciByb3RhdGlvbiA9IE1hdGguYXRhbjIoZHksIGR4KTtcclxuXHJcblx0XHRzdHlsZXMucHVzaChuZXcgb2wuc3R5bGUuU3R5bGUoe1xyXG5cdFx0XHRnZW9tZXRyeTogbmV3IG9sLmdlb20uUG9pbnQoc3RhcnQpLFxyXG5cdFx0XHRpbWFnZTogbmV3IG9sLnN0eWxlLkljb24oe1xyXG5cdFx0XHRcdHNyYzogaW1hZ2UsXHJcblx0XHRcdFx0Ly9zY2FsZSA6IDAuNjUsXHJcblx0XHRcdFx0YW5jaG9yOiBbMC41LCAwLjVdLFxyXG5cdFx0XHRcdHJvdGF0ZVdpdGhWaWV3OiB0cnVlLFxyXG5cdFx0XHRcdC8vcm90YXRpb246IC1yb3RhdGlvbixcclxuXHRcdFx0XHRvcGFjaXR5IDogMVxyXG5cdFx0XHR9KVxyXG5cdFx0fSkpO1xyXG5cdH0sXHJcblxyXG5cdF9nZW5EaXJlY3Rpb24gOiBmdW5jdGlvbihwdHMsIHd3LCByZXNvbHV0aW9uLCBjb2xvciwgc3R5bGVzKSB7XHJcbiAgICAgICAgaWYgKENPTkZJRy5hcHBlYXJhbmNlLmRpcmVjdGlvbkljb25CZXR3ZWVuIDw9IDApIHtcclxuICAgICAgICAgICAgLy8gdGhpcyBtZWFucyBubyBuZWVkIHRvIHNob3cgdGhlIGRpcmVjdGlvbnNcclxuICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgdmFyIGNudCA9IDA7XHJcbiAgICAgICAgdmFyIGljbiA9IHJlbmRlckRpcmVjdGlvbkJhc2U2NCgxNiwgMTYsIGNvbG9yKTtcclxuICAgICAgICB2YXIgcmVzID0gMC4wO1xyXG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgcHRzLmxlbmd0aCAtIDE7IGkrKykge1xyXG4gICAgICAgICAgICB2YXIgc3RhcnQgPSBwdHNbaSArIDFdO1xyXG4gICAgICAgICAgICB2YXIgZW5kID0gcHRzW2ldO1xyXG4gICAgICAgICAgICB2YXIgZHggPSBlbmRbMF0gLSBzdGFydFswXTtcclxuICAgICAgICAgICAgdmFyIGR5ID0gZW5kWzFdIC0gc3RhcnRbMV07XHJcbiAgICAgICAgICAgIHZhciBsZW4gPSBNYXRoLnNxcnQoZHggKiBkeCArIGR5ICogZHkpIC8gcmVzb2x1dGlvbjtcclxuICAgICAgICAgICAgcmVzICs9IGxlbjtcclxuICAgICAgICAgICAgaWYgKGkgPT0gMCB8fCByZXMgPj0gQ09ORklHLmFwcGVhcmFuY2UuZGlyZWN0aW9uSWNvbkJldHdlZW4pIHtcclxuICAgICAgICAgICAgICAgIHJlcyA9IDA7XHJcbiAgICAgICAgICAgICAgICB2YXIgcm90YXRpb24gPSBNYXRoLmF0YW4yKGR5LCBkeCk7XHJcbiAgICAgICAgICAgICAgICBzdHlsZXMucHVzaChuZXcgb2wuc3R5bGUuU3R5bGUoe1xyXG4gICAgICAgICAgICAgICAgICAgIGdlb21ldHJ5OiBuZXcgb2wuZ2VvbS5Qb2ludChbKHN0YXJ0WzBdICsgZW5kWzBdKSAvIDIsIChzdGFydFsxXSArIGVuZFsxXSkgLyAyXSksXHJcbiAgICAgICAgICAgICAgICAgICAgaW1hZ2U6IG5ldyBvbC5zdHlsZS5JY29uKHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgc3JjOiBpY24sXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHNjYWxlOiB3dyAvIDEyLjAsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGFuY2hvcjogWzAuNSwgMC41XSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgcm90YXRlV2l0aFZpZXc6IHRydWUsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHJvdGF0aW9uOiAtcm90YXRpb24gKyBNYXRoLlBJLCAvLyBhZGQgMTgwIGRlZ3JlZXNcclxuICAgICAgICAgICAgICAgICAgICAgICAgb3BhY2l0eTogMVxyXG4gICAgICAgICAgICAgICAgICAgIH0pXHJcbiAgICAgICAgICAgICAgICB9KSk7XHJcbiAgICAgICAgICAgICAgICBjbnQrKztcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgIH0sXHJcblxyXG4gICAgX2dlbkRpc3RhbmNlS20gOiBmdW5jdGlvbih3dywgcmVzb2x1dGlvbixcclxuXHRcdFx0XHRcdFx0XHQgIGNvb3JkcywgZGlzdGFuY2VzLCBzdGFydERpc3RJbmRleCwgZW5kRGlzdEluZGV4LFxyXG5cdFx0XHRcdFx0XHRcdCAgc3R5bGVzKSB7XHJcbiAgICAgICAgLy8gVE9ETyBSdW1lbiAtIHN0aWxsIG5vdCByZWFkeSAtIGZvciBub3cgc3RhdGljIGhvdHNwb3RzIGFyZSB1c2VkXHJcbiAgICAgICAgaWYgKHRydWUpIHtyZXR1cm47fVxyXG5cclxuICAgICAgICB2YXIgaG90c3BvdHNLbSA9IFsyMCwgNDAsIDYwLCA4MCwgMTAwLCAxMjAsIDE0MCwgMTYwLCAxODBdO1xyXG5cclxuICAgICAgICBmdW5jdGlvbiBhZGRIb3RTcG90S00oa20sIHBvaW50KSB7XHJcbiAgICAgICAgICAgIC8vdmFyIGR4ID0gZW5kWzBdIC0gc3RhcnRbMF07XHJcbiAgICAgICAgICAgIC8vdmFyIGR5ID0gZW5kWzFdIC0gc3RhcnRbMV07XHJcbiAgICAgICAgICAgIC8vdmFyIHJvdGF0aW9uID0gTWF0aC5hdGFuMihkeSwgZHgpO1xyXG4gICAgICAgICAgICBzdHlsZXMucHVzaChuZXcgb2wuc3R5bGUuU3R5bGUoe1xyXG4gICAgICAgICAgICAgICAgLy9nZW9tZXRyeTogbmV3IG9sLmdlb20uUG9pbnQoWyhzdGFydFswXStlbmRbMF0pLzIsKHN0YXJ0WzFdK2VuZFsxXSkvMl0pLFxyXG4gICAgICAgICAgICAgICAgZ2VvbWV0cnk6IG5ldyBvbC5nZW9tLlBvaW50KFtwb2ludFswXSwgcG9pbnRbMV1dKSxcclxuICAgICAgICAgICAgICAgIGltYWdlOiBuZXcgb2wuc3R5bGUuSWNvbih7XHJcbiAgICAgICAgICAgICAgICAgICAgc3JjOiBcImltZy9cIiArIGttICsgXCJrbS5zdmdcIixcclxuICAgICAgICAgICAgICAgICAgICBzY2FsZTogMS41LFxyXG4gICAgICAgICAgICAgICAgICAgIHJvdGF0ZVdpdGhWaWV3OiB0cnVlLFxyXG4gICAgICAgICAgICAgICAgICAgIC8vcm90YXRpb246IC1yb3RhdGlvbiArIE1hdGguUEkvMiwgLy8gYWRkIDE4MCBkZWdyZWVzXHJcbiAgICAgICAgICAgICAgICAgICAgb3BhY2l0eSA6IDFcclxuICAgICAgICAgICAgICAgIH0pXHJcbiAgICAgICAgICAgIH0pKTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGZvciAodmFyIGkgPSBzdGFydERpc3RJbmRleDsgaSA8IGVuZERpc3RJbmRleDsgaSsrKSB7XHJcbiAgICAgICAgICAgIGlmICghaG90c3BvdHNLbS5sZW5ndGgpIHtcclxuXHRcdFx0XHRyZXR1cm47XHJcblx0XHRcdH1cclxuXHJcblx0XHRcdHZhciBkaXN0ID0gZGlzdGFuY2VzW2ldO1xyXG5cclxuXHRcdFx0aWYgKGRpc3QgPj0gaG90c3BvdHNLbVswXSoxMDAwKSB7XHJcblx0XHRcdFx0Ly8gZHJhdyB0aGUgZmlyc3QgaG90c3BvdCBhbmQgYW55IG5leHQgaWYgaXQncyBjb250YWluZWQgaW4gdGhlIHNhbWUgXCJkaXN0YW5jZVwiXHJcblx0XHRcdFx0dmFyIHJlbW92ZUhvdHNwb3RLbSA9IDA7XHJcblx0XHRcdFx0Zm9yICh2YXIgayA9IDAsIGxlbkhvdHNwb3RzS20gPSBob3RzcG90c0ttLmxlbmd0aDsgayA8IGxlbkhvdHNwb3RzS207IGsrKykge1xyXG5cdFx0XHRcdFx0aWYgKGRpc3QgPj0gaG90c3BvdHNLbVtrXSoxMDAwKSB7XHJcblx0XHRcdFx0XHRcdGFkZEhvdFNwb3RLTShob3RzcG90c0ttW2tdLCBjb29yZHNbaV0pO1xyXG5cdFx0XHRcdFx0XHRyZW1vdmVIb3RzcG90S20rKztcclxuXHRcdFx0XHRcdH0gZWxzZSB7XHJcblx0XHRcdFx0XHRcdGJyZWFrO1xyXG5cdFx0XHRcdFx0fVxyXG5cdFx0XHRcdH1cclxuXHRcdFx0XHQvLyByZW1vdmUgYWxsIHRoZSBhbHJlYWR5IGRyYXduIGhvdHNwb3RzXHJcblx0XHRcdFx0Zm9yICh2YXIgaiA9IDA7IGogPHJlbW92ZUhvdHNwb3RLbTsgaisrKSBob3RzcG90c0ttLnNoaWZ0KCk7XHJcblx0XHRcdH1cclxuICAgICAgICB9XHJcbiAgICB9XHJcbn07XHJcblxyXG5mb3IgKHZhciBpIGluIFNUWUxFUylcclxuXHRleHBvcnRzW2ldPVNUWUxFU1tpXTtcclxuIiwicmVxdWlyZSgnam9vc2UnKTtcclxucmVxdWlyZSgnLi9QYXJ0aWNpcGFudCcpO1xyXG5cclxudmFyIHJidXNoID0gcmVxdWlyZSgncmJ1c2gnKTtcclxudmFyIENPTkZJRyA9IHJlcXVpcmUoJy4vQ29uZmlnJyk7XHJcbnZhciBXR1M4NFNQSEVSRSA9IHJlcXVpcmUoJy4vVXRpbHMnKS5XR1M4NFNQSEVSRTtcclxuXHJcbkNsYXNzKFwiVHJhY2tcIiwgXHJcbntcdFxyXG4gICAgLy8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdC8vIEFMTCBDT09SRElOQVRFUyBBUkUgSU4gV09STEQgTUVSQ0FUT1JcclxuICAgIC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuICAgIGhhczogXHJcblx0e1xyXG4gICAgICAgIHJvdXRlIDoge1xyXG4gICAgICAgICAgICBpczogICBcInJ3XCJcclxuICAgICAgICB9LFxyXG4gICAgICAgIGRpc3RhbmNlcyA6IHtcclxuICAgICAgICAgICAgaXM6ICAgXCJyd1wiXHJcbiAgICAgICAgfSxcclxuICAgICAgICBkaXN0YW5jZXNFbGFwc2VkIDoge1xyXG4gICAgICAgICAgICBpczogICBcInJ3XCJcclxuICAgICAgICB9LFxyXG5cdFx0dG90YWxMZW5ndGggOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiXHJcblx0XHR9LFxyXG5cdFx0cGFydGljaXBhbnRzIDoge1xyXG5cdFx0XHRpczogICBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiBbXVxyXG5cdFx0fSxcclxuXHRcdGNhbXNDb3VudCA6IHtcclxuXHRcdFx0aXM6ICAgXCJyd1wiLFxyXG5cdFx0XHRpbml0OiAwXHJcblx0XHR9LFxyXG5cdFx0Ly8gaW4gRVBTRyAzODU3XHJcblx0XHRmZWF0dXJlIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IG51bGxcdFx0XHJcblx0XHR9LFxyXG5cdFx0aXNEaXJlY3Rpb25Db25zdHJhaW50IDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IGZhbHNlXHJcblx0XHR9LFxyXG5cdFx0XHJcblx0XHRkZWJ1Z1BhcnRpY2lwYW50IDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IG51bGxcclxuXHRcdH0sXHJcblx0XHRiaWtlU3RhcnRLTSA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiBudWxsXHJcblx0XHR9LFxyXG5cdFx0cnVuU3RhcnRLTSA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiBudWxsXHJcblx0XHR9LFxyXG5cdFx0bGFwcyA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiAxXHJcblx0XHR9LFxyXG5cdFx0dG90YWxQYXJ0aWNpcGFudHMgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogNTBcclxuXHRcdH0sXHJcblx0XHRyVHJlZSA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiByYnVzaCgxMClcclxuXHRcdH0sXHJcblxyXG5cdFx0aXNBZGRlZEhvdFNwb3RTd2ltQmlrZSA6IHtcclxuXHRcdFx0aW5pdCA6IGZhbHNlXHJcblx0XHR9LFxyXG5cdFx0aXNBZGRlZEhvdFNwb3RCaWtlUnVuIDoge1xyXG5cdFx0XHRpbml0IDogZmFsc2VcclxuXHRcdH1cclxuICAgIH0sXHJcbiAgICAvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0bWV0aG9kczogXHJcblx0e1x0XHRcclxuXHRcdHNldFJvdXRlIDogZnVuY3Rpb24odmFsKSB7XHJcblx0XHRcdHRoaXMucm91dGU9dmFsO1xyXG5cdFx0XHRkZWxldGUgdGhpcy5fbGVudG1wMTtcclxuXHRcdFx0ZGVsZXRlIHRoaXMuX2xlbnRtcDI7XHJcblx0XHR9LFxyXG5cdFx0XHJcblx0XHRnZXRCb3VuZGluZ0JveCA6IGZ1bmN0aW9uKCkge1xyXG5cdFx0XHR2YXIgbWlueD1udWxsLG1pbnk9bnVsbCxtYXh4PW51bGwsbWF4eT1udWxsO1xyXG5cdFx0XHRmb3IgKHZhciBpPTA7aTx0aGlzLnJvdXRlLmxlbmd0aDtpKyspXHJcblx0XHRcdHtcclxuXHRcdFx0XHR2YXIgcD10aGlzLnJvdXRlW2ldO1xyXG5cdFx0XHRcdGlmIChtaW54ID09IG51bGwgfHwgcFswXSA8IG1pbngpIG1pbng9cFswXTtcclxuXHRcdFx0XHRpZiAobWF4eCA9PSBudWxsIHx8IHBbMF0gPiBtYXh4KSBtYXh4PXBbMF07XHJcblx0XHRcdFx0aWYgKG1pbnkgPT0gbnVsbCB8fCBwWzFdIDwgbWlueSkgbWlueT1wWzFdO1xyXG5cdFx0XHRcdGlmIChtYXh5ID09IG51bGwgfHwgcFsxXSA+IG1heHkpIG1heHk9cFsxXTtcclxuXHRcdFx0fVxyXG5cdFx0XHRyZXR1cm4gW21pbngsbWlueSxtYXh4LG1heHldO1xyXG5cdFx0fSxcclxuXHRcdFxyXG5cdFx0Ly8gZWxhcHNlZCBmcm9tIDAuLjFcclxuXHRcdGdldFBvc2l0aW9uQW5kUm90YXRpb25Gcm9tRWxhcHNlZCA6IGZ1bmN0aW9uKGVsYXBzZWQpIHtcclxuXHRcdFx0dmFyIHJyPW51bGw7XHJcblx0XHRcdHZhciBjYyA9IHRoaXMucm91dGU7XHJcblx0XHRcdFxyXG5cdFx0XHR2YXIgbGwgPSB0aGlzLmRpc3RhbmNlc0VsYXBzZWQubGVuZ3RoLTE7XHJcblx0XHRcdHZhciBzaSA9IDA7XHJcblxyXG5cdFx0XHQvLyBUT0RPIEZJWCBNRSBcclxuXHRcdFx0d2hpbGUgKHNpIDwgbGwgJiYgc2krNTAwIDwgbGwgJiYgdGhpcy5kaXN0YW5jZXNFbGFwc2VkW3NpKzUwMF0gPCBlbGFwc2VkICkge1xyXG5cdFx0XHRcdHNpKz01MDA7XHJcblx0XHRcdH1cclxuXHRcdFx0XHJcblx0XHRcdHdoaWxlIChzaSA8IGxsICYmIHNpKzI1MCA8IGxsICYmIHRoaXMuZGlzdGFuY2VzRWxhcHNlZFtzaSsyNTBdIDwgZWxhcHNlZCApIHtcclxuXHRcdFx0XHRzaSs9MjUwO1xyXG5cdFx0XHR9XHJcblx0XHRcdFxyXG5cdFx0XHR3aGlsZSAoc2kgPCBsbCAmJiBzaSsxMjUgPCBsbCAmJiB0aGlzLmRpc3RhbmNlc0VsYXBzZWRbc2krMTI1XSA8IGVsYXBzZWQgKSB7XHJcblx0XHRcdFx0c2krPTEyNTtcclxuXHRcdFx0fVxyXG5cclxuXHRcdFx0d2hpbGUgKHNpIDwgbGwgJiYgc2krNTAgPCBsbCAmJiB0aGlzLmRpc3RhbmNlc0VsYXBzZWRbc2krNTBdIDwgZWxhcHNlZCApIHtcclxuXHRcdFx0XHRzaSs9NTA7XHJcblx0XHRcdH1cclxuXHRcdFx0XHJcblx0XHRcdGZvciAodmFyIGk9c2k7aTxsbDtpKyspIFxyXG5cdFx0XHR7XHJcblx0XHRcdFx0LypkbyBcclxuXHRcdFx0XHR7XHJcblx0XHRcdFx0XHR2YXIgbSA9ICgoY2MubGVuZ3RoLTEraSkgPj4gMSk7XHJcblx0XHRcdFx0XHRpZiAobS1pID4gNSAmJiBlbGFwc2VkIDwgdGhpcy5kaXN0YW5jZXNFbGFwc2VkW21dKSB7XHJcblx0XHRcdFx0XHRcdGk9bTtcclxuXHRcdFx0XHRcdFx0Y29udGludWU7XHJcblx0XHRcdFx0XHR9XHJcblx0XHRcdFx0XHRicmVhaztcclxuXHRcdFx0XHR9IHdoaWxlICh0cnVlKTsqL1xyXG5cdFx0XHRcdGlmIChlbGFwc2VkID49IHRoaXMuZGlzdGFuY2VzRWxhcHNlZFtpXSAmJiBlbGFwc2VkIDw9IHRoaXMuZGlzdGFuY2VzRWxhcHNlZFtpKzFdKSBcclxuXHRcdFx0XHR7XHJcblx0XHRcdFx0XHRlbGFwc2VkLT10aGlzLmRpc3RhbmNlc0VsYXBzZWRbaV07XHJcblx0XHRcdFx0XHR2YXIgYWM9dGhpcy5kaXN0YW5jZXNFbGFwc2VkW2krMV0tdGhpcy5kaXN0YW5jZXNFbGFwc2VkW2ldO1xyXG5cdFx0XHRcdFx0dmFyIGEgPSBjY1tpXTtcclxuXHRcdFx0XHRcdHZhciBjID0gY2NbaSsxXTtcclxuXHRcdFx0XHRcdHZhciBkeCA9IGNbMF0gLSBhWzBdO1xyXG5cdFx0XHRcdFx0dmFyIGR5ID0gY1sxXSAtIGFbMV07XHJcblx0XHRcdFx0XHRycj1bIGFbMF0rKGNbMF0tYVswXSkqZWxhcHNlZC9hYyxhWzFdKyhjWzFdLWFbMV0pKmVsYXBzZWQvYWMsTWF0aC5hdGFuMihkeSwgZHgpXTtcclxuXHRcdFx0XHRcdGJyZWFrO1xyXG5cdFx0XHRcdH1cclxuXHRcdFx0fVxyXG5cdFx0XHRyZXR1cm4gcnI7XHJcblx0XHR9LFxyXG5cdFx0XHJcblx0XHRfX2dldFBvc2l0aW9uQW5kUm90YXRpb25Gcm9tRWxhcHNlZCA6IGZ1bmN0aW9uKGVsYXBzZWQpIHtcclxuXHRcdFx0ZWxhcHNlZCo9dGhpcy5nZXRUcmFja0xlbmd0aCgpO1xyXG5cdFx0XHR2YXIgcnI9bnVsbDtcclxuXHRcdFx0dmFyIGNjID0gdGhpcy5yb3V0ZTtcclxuXHRcdFx0Zm9yICh2YXIgaT0wO2k8Y2MubGVuZ3RoLTE7aSsrKSBcclxuXHRcdFx0e1xyXG5cdFx0XHRcdHZhciBhID0gY2NbaV07XHJcblx0XHRcdFx0dmFyIGMgPSBjY1tpKzFdO1xyXG5cdFx0XHRcdHZhciBhYyA9IFdHUzg0U1BIRVJFLmhhdmVyc2luZURpc3RhbmNlKGEsYyk7XHJcblx0XHRcdFx0aWYgKGVsYXBzZWQgPD0gYWMpIHtcclxuXHRcdFx0XHRcdHZhciBkeCA9IGNbMF0gLSBhWzBdO1xyXG5cdFx0XHRcdFx0dmFyIGR5ID0gY1sxXSAtIGFbMV07XHJcblx0XHRcdFx0XHRycj1bIGFbMF0rKGNbMF0tYVswXSkqZWxhcHNlZC9hYyxhWzFdKyhjWzFdLWFbMV0pKmVsYXBzZWQvYWMsTWF0aC5hdGFuMihkeSwgZHgpXTtcclxuXHRcdFx0XHRcdGJyZWFrO1xyXG5cdFx0XHRcdH1cclxuXHRcdFx0XHRlbGFwc2VkLT1hYztcclxuXHRcdFx0fVxyXG5cdFx0XHRyZXR1cm4gcnI7XHJcblx0XHR9LFxyXG5cclxuXHRcdFxyXG5cdFx0Z2V0VHJhY2tMZW5ndGggOiBmdW5jdGlvbigpIHtcclxuXHRcdFx0aWYgKHRoaXMuX2xlbnRtcDEpXHJcblx0XHRcdFx0cmV0dXJuIHRoaXMuX2xlbnRtcDE7XHJcblx0XHRcdHZhciByZXM9MC4wO1xyXG5cdFx0XHR2YXIgY2MgPSB0aGlzLnJvdXRlO1xyXG5cdFx0XHRmb3IgKHZhciBpPTA7aTxjYy5sZW5ndGgtMTtpKyspIFxyXG5cdFx0XHR7XHJcblx0XHRcdFx0dmFyIGEgPSBjY1tpXTtcclxuXHRcdFx0XHR2YXIgYiA9IGNjW2krMV07XHJcblx0XHRcdFx0dmFyIGQgPSBXR1M4NFNQSEVSRS5oYXZlcnNpbmVEaXN0YW5jZShhLGIpO1xyXG5cdFx0XHRcdGlmICghaXNOYU4oZCkgJiYgZCA+IDApIFxyXG5cdFx0XHRcdFx0cmVzKz1kO1xyXG5cdFx0XHR9XHJcblx0XHRcdHRoaXMuX2xlbnRtcDE9cmVzO1xyXG5cdFx0XHRyZXR1cm4gcmVzO1xyXG5cdFx0fSxcclxuXHJcblx0XHRnZXRUcmFja0xlbmd0aEluV0dTODQgOiBmdW5jdGlvbigpIHtcclxuXHRcdFx0aWYgKHRoaXMuX2xlbnRtcDIpXHJcblx0XHRcdFx0cmV0dXJuIHRoaXMuX2xlbnRtcDI7XHJcblx0XHRcdHZhciByZXM9MC4wO1xyXG5cdFx0XHR2YXIgY2MgPSB0aGlzLnJvdXRlO1xyXG5cdFx0XHRmb3IgKHZhciBpPTA7aTxjYy5sZW5ndGgtMTtpKyspIFxyXG5cdFx0XHR7XHJcblx0XHRcdFx0dmFyIGEgPSBjY1tpXTtcclxuXHRcdFx0XHR2YXIgYiA9IGNjW2krMV07XHJcblx0XHRcdFx0dmFyIGQgPSBNYXRoLnNxcnQoKGFbMF0tYlswXSkqKGFbMF0tYlswXSkrKGFbMV0tYlsxXSkqKGFbMV0tYlsxXSkpO1xyXG5cdFx0XHRcdGlmICghaXNOYU4oZCkgJiYgZCA+IDApIFxyXG5cdFx0XHRcdFx0cmVzKz1kO1xyXG5cdFx0XHR9XHJcblx0XHRcdHRoaXMuX2xlbnRtcDI9cmVzO1xyXG5cdFx0XHRyZXR1cm4gcmVzO1xyXG5cdFx0fSxcclxuXHJcblx0XHRnZXRDZW50ZXIgOiBmdW5jdGlvbigpIHtcclxuXHRcdFx0dmFyIGJiID0gdGhpcy5nZXRCb3VuZGluZ0JveCgpO1xyXG5cdFx0XHRyZXR1cm4gWyhiYlswXStiYlsyXSkvMi4wLChiYlsxXStiYlszXSkvMi4wXTtcclxuXHRcdH0sXHJcblx0XHRcclxuXHRcdGluaXQgOiBmdW5jdGlvbigpIFxyXG5cdFx0e1xyXG5cdFx0XHRpZiAoIXRoaXMucm91dGUpXHJcblx0XHRcdFx0cmV0dXJuO1xyXG5cdFx0XHQvLyAxKSBjYWxjdWxhdGUgdG90YWwgcm91dGUgbGVuZ3RoIGluIEtNIFxyXG5cdFx0XHR0aGlzLnVwZGF0ZUZlYXR1cmUoKTtcclxuXHRcdFx0aWYgKHR5cGVvZiB3aW5kb3cgIT0gXCJ1bmRlZmluZWRcIikgXHJcblx0XHRcdHtcclxuXHRcdFx0XHRpZiAoIUdVSS5nZXRJc1NraXBFeHRlbnQoKSkge1xyXG5cdFx0XHRcdFx0aWYgKHRoaXMuZmVhdHVyZSkge1xyXG5cdFx0XHRcdFx0XHRHVUkubWFwLmdldFZpZXcoKS5maXRFeHRlbnQodGhpcy5mZWF0dXJlLmdldEdlb21ldHJ5KCkuZ2V0RXh0ZW50KCksIEdVSS5tYXAuZ2V0U2l6ZSgpKTtcclxuXHRcdFx0XHRcdFx0Y29uc29sZS5sb2coXCJDdXJyZW50IGV4dGVudCA6IFwiICsgSlNPTi5zdHJpbmdpZnkodGhpcy5mZWF0dXJlLmdldEdlb21ldHJ5KCkuZ2V0RXh0ZW50KCkpKTtcclxuXHRcdFx0XHRcdH0gZWxzZSB7XHJcblx0XHRcdFx0XHRcdEdVSS5tYXAuZ2V0VmlldygpLmZpdEV4dGVudChbMTIzNDU5Mi4zNjM3MzQ1NTY4LCA2MjgyNzA2Ljg4OTY3NjQzNSwgMTI2NDM0OC40NjQzNzM3NjYsIDYzMjU2OTQuNzQzMTY0NzI1XSwgR1VJLm1hcC5nZXRTaXplKCkpO1xyXG5cdFx0XHRcdFx0fVxyXG5cdFx0XHRcdH1cclxuXHRcdFx0fVxyXG5cdFx0fSxcclxuXHRcdFxyXG5cdFx0Z2V0VHJhY2tQYXJ0IDogZnVuY3Rpb24oZWxhcHNlZCkge1xyXG5cdFx0XHR2YXIgbGVuID0gdGhpcy5nZXRUcmFja0xlbmd0aCgpO1xyXG5cdFx0XHR2YXIgZW0gPSAoZWxhcHNlZCUxLjApKmxlbjtcclxuXHRcdFx0aWYgKGVtID49IHRoaXMucnVuU3RhcnRLTSoxMDAwKSBcclxuXHRcdFx0XHRyZXR1cm4gMjtcclxuXHRcdFx0aWYgKGVtID49IHRoaXMuYmlrZVN0YXJ0S00qMTAwMCkgXHJcblx0XHRcdFx0cmV0dXJuIDE7XHJcblx0XHRcdHJldHVybiAwO1xyXG5cdFx0fSxcclxuXHRcdFxyXG5cdFx0dXBkYXRlRmVhdHVyZSA6IGZ1bmN0aW9uKCkgXHJcblx0XHR7XHJcblx0XHRcdHRoaXMuZGlzdGFuY2VzPVtdO1xyXG5cdFx0XHR2YXIgcmVzPTAuMDtcclxuXHRcdFx0dmFyIGNjID0gdGhpcy5yb3V0ZTtcclxuXHRcdFx0Zm9yICh2YXIgaT0wO2k8Y2MubGVuZ3RoLTE7aSsrKSBcclxuXHRcdFx0e1xyXG5cdFx0XHRcdHZhciBhID0gY2NbaV07XHJcblx0XHRcdFx0dmFyIGIgPSBjY1tpKzFdO1xyXG5cdFx0XHRcdHZhciBkID0gV0dTODRTUEhFUkUuaGF2ZXJzaW5lRGlzdGFuY2UoYSxiKTtcclxuXHRcdFx0XHR0aGlzLmRpc3RhbmNlcy5wdXNoKHJlcyk7XHJcblx0XHRcdFx0aWYgKCFpc05hTihkKSAmJiBkID4gMCkgXHJcblx0XHRcdFx0XHRyZXMrPWQ7XHJcblx0XHRcdH1cclxuXHRcdFx0dGhpcy5kaXN0YW5jZXMucHVzaChyZXMpO1xyXG5cdFx0XHR0aGlzLmRpc3RhbmNlc0VsYXBzZWQ9W107XHJcblx0XHRcdHZhciB0bCA9IHRoaXMuZ2V0VHJhY2tMZW5ndGgoKTtcclxuXHRcdFx0Zm9yICh2YXIgaT0wO2k8Y2MubGVuZ3RoO2krKykge1xyXG5cdFx0XHRcdHRoaXMuZGlzdGFuY2VzRWxhcHNlZC5wdXNoKHRoaXMuZGlzdGFuY2VzW2ldL3RsKTtcclxuXHRcdFx0fVxyXG5cdFx0XHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0XHRcdHRoaXMuclRyZWUuY2xlYXIoKTtcclxuXHRcdFx0dmFyIGFyciA9IFtdO1xyXG5cdFx0XHRmb3IgKHZhciBpPTA7aTx0aGlzLnJvdXRlLmxlbmd0aC0xO2krKykgXHJcblx0XHRcdHtcclxuXHRcdFx0XHR2YXIgeDEgPSB0aGlzLnJvdXRlW2ldWzBdO1xyXG5cdFx0XHRcdHZhciB5MSA9IHRoaXMucm91dGVbaV1bMV07XHJcblx0XHRcdFx0dmFyIHgyID0gdGhpcy5yb3V0ZVtpKzFdWzBdO1xyXG5cdFx0XHRcdHZhciB5MiA9IHRoaXMucm91dGVbaSsxXVsxXTtcclxuXHRcdFx0XHR2YXIgbWlueCA9IHgxIDwgeDIgPyB4MSA6IHgyO1xyXG5cdFx0XHRcdHZhciBtaW55ID0geTEgPCB5MiA/IHkxIDogeTI7XHJcblx0XHRcdFx0dmFyIG1heHggPSB4MSA+IHgyID8geDEgOiB4MjtcclxuXHRcdFx0XHR2YXIgbWF4eSA9IHkxID4geTIgPyB5MSA6IHkyO1xyXG5cdFx0XHRcdGFyci5wdXNoKFttaW54LG1pbnksbWF4eCxtYXh5LHsgaW5kZXggOiBpIH1dKTtcclxuXHRcdFx0fVxyXG5cdFx0XHR0aGlzLnJUcmVlLmxvYWQoYXJyKTtcclxuXHRcdFx0Ly8tLS0tLS0tLS0tLS0tLS0tLSAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRcdFx0aWYgKHR5cGVvZiB3aW5kb3cgIT0gXCJ1bmRlZmluZWRcIiAmJiB0aGlzLnJvdXRlICYmIHRoaXMucm91dGUubGVuZ3RoKSBcclxuXHRcdFx0e1xyXG5cdFx0XHRcdHZhciB3a3QgPSBbXTtcclxuXHRcdFx0XHRmb3IgKHZhciBpPTA7aTx0aGlzLnJvdXRlLmxlbmd0aDtpKyspIHtcclxuXHRcdFx0XHRcdHdrdC5wdXNoKHRoaXMucm91dGVbaV1bMF0rXCIgXCIrdGhpcy5yb3V0ZVtpXVsxXSk7XHJcblx0XHRcdFx0fVxyXG5cdFx0XHRcdHdrdD1cIkxJTkVTVFJJTkcoXCIrd2t0LmpvaW4oXCIsXCIpK1wiKVwiO1xyXG5cdFx0XHRcdHZhciBmb3JtYXQgPSBuZXcgb2wuZm9ybWF0LldLVCgpO1xyXG5cdFx0XHRcdGlmICghdGhpcy5mZWF0dXJlKSB7XHJcblx0XHRcdFx0XHR0aGlzLmZlYXR1cmUgPSBmb3JtYXQucmVhZEZlYXR1cmUod2t0KTtcclxuXHRcdFx0XHR9IGVsc2Uge1xyXG5cdFx0XHRcdFx0dGhpcy5mZWF0dXJlLnNldEdlb21ldHJ5KGZvcm1hdC5yZWFkRmVhdHVyZSh3a3QpLmdldEdlb21ldHJ5KCkpO1xyXG5cdFx0XHRcdH1cclxuXHRcdFx0XHR0aGlzLmZlYXR1cmUudHJhY2s9dGhpcztcclxuXHRcdFx0XHR0aGlzLmZlYXR1cmUuZ2V0R2VvbWV0cnkoKS50cmFuc2Zvcm0oJ0VQU0c6NDMyNicsICdFUFNHOjM4NTcnKTtcdFx0XHRcdFx0XHRcclxuXHRcdFx0XHQvL2NvbnNvbGUubG9nKFwiRkVBVFVSRSBUUkFDSyA6IFwiK3RoaXMuZmVhdHVyZS50cmFjayk7XHJcblx0XHRcdH0gZWxzZSB7XHJcblx0XHRcdFx0ZGVsZXRlIHRoaXMuZmVhdHVyZTtcclxuXHRcdFx0fVxyXG5cdFx0fSxcclxuXHJcblx0XHRnZXRSZWFsUGFydGljaXBhbnRzQ291bnQgOiBmdW5jdGlvbigpIHtcclxuXHRcdFx0cmV0dXJuIHRoaXMucGFydGljaXBhbnRzLmxlbmd0aCAtIHRoaXMuY2Ftc0NvdW50O1xyXG5cdFx0fSxcclxuXHJcblx0XHRnZXRQYXJ0aWNpcGFudEJ5SWQgOiBmdW5jdGlvbihpZCkge1xyXG5cdFx0XHQvLyBUT0RPIFJ1bWVuIC0gaXQgd291bGQgYmUgZ29vZCB0byBob2xkIGEgbWFwIG9mIHRoZSB0eXBlIGlkIC0+IFBhcnRpY2lwYW50XHJcblx0XHRcdGlmICh0aGlzLnBhcnRpY2lwYW50cykge1xyXG5cdFx0XHRcdGZvciAodmFyIGkgPSAwLCBsZW4gPSB0aGlzLnBhcnRpY2lwYW50cy5sZW5ndGg7IGkgPCBsZW47IGkrKykge1xyXG5cdFx0XHRcdFx0IGlmICh0aGlzLnBhcnRpY2lwYW50c1tpXS5pZCA9PT0gaWQpIHtcclxuXHRcdFx0XHRcdFx0IHJldHVybiB0aGlzLnBhcnRpY2lwYW50c1tpXTtcclxuXHRcdFx0XHRcdCB9XHJcblx0XHRcdFx0fVxyXG5cdFx0XHR9XHJcblx0XHRcdHJldHVybiBudWxsO1xyXG5cdFx0fSxcclxuXHRcdFxyXG5cdFx0bmV3UGFydGljaXBhbnQgOiBmdW5jdGlvbihpZCxkZXZpY2VJZCxuYW1lKVxyXG5cdFx0e1xyXG5cdFx0XHR2YXIgcGFydCA9IG5ldyBQYXJ0aWNpcGFudCh7aWQ6aWQsZGV2aWNlSWQ6ZGV2aWNlSWQsY29kZTpuYW1lfSk7XHJcblx0XHRcdHBhcnQuaW5pdCh0aGlzLnJvdXRlWzBdLHRoaXMpO1xyXG5cdFx0XHRwYXJ0LnNldFNlcUlkKHRoaXMucGFydGljaXBhbnRzLmxlbmd0aCk7XHJcblx0XHRcdHRoaXMucGFydGljaXBhbnRzLnB1c2gocGFydCk7XHJcblx0XHRcdHJldHVybiBwYXJ0O1xyXG5cdFx0fSxcclxuXHJcblx0XHRuZXdNb3ZpbmdDYW0gOiBmdW5jdGlvbihpZCxkZXZpY2VJZCxuYW1lKVxyXG5cdFx0e1xyXG5cdFx0XHR2YXIgY2FtID0gbmV3IE1vdmluZ0NhbSh7aWQ6aWQsZGV2aWNlSWQ6ZGV2aWNlSWQsY29kZTpuYW1lfSk7XHJcblx0XHRcdGNhbS5pbml0KHRoaXMucm91dGVbMF0sdGhpcyk7XHJcblx0XHRcdGNhbS5zZXRTZXFJZCh0aGlzLmNhbXNDb3VudCk7XHJcblx0XHRcdHRoaXMuY2Ftc0NvdW50Kys7XHJcblx0XHRcdGNhbS5fX3NraXBUcmFja2luZ1Bvcz10cnVlO1xyXG5cdFx0XHR0aGlzLnBhcnRpY2lwYW50cy5wdXNoKGNhbSk7XHJcblx0XHRcdHJldHVybiBjYW07XHJcblx0XHR9LFxyXG5cclxuXHRcdG5ld0hvdFNwb3RzIDogZnVuY3Rpb24oaG90c3BvdHMpIHtcclxuXHRcdFx0aWYgKCFob3RzcG90cyB8fCAhaG90c3BvdHMubGVuZ3RoKSB7XHJcblx0XHRcdFx0cmV0dXJuO1xyXG5cdFx0XHR9XHJcblxyXG5cdFx0XHQvLyBUT0RPIFJ1bWVuIC0gdGhpcyBpcyBDT1BZLVBBU1RFIGNvZGUgZm9ybSB0aGUgU3R5bGVzXHJcblx0XHRcdC8vIHNvIGxhdGVyIGl0IGhhcyB0byBiZSBpbiBvbmx5IG9uZSBwbGFjZSAtIGdldHRpbmcgdGhlIGdlb21ldHJpZXMgZm9yIGVhY2ggdHlwZSBkaXN0YW5jZVxyXG5cdFx0XHQvLyBtYXliZSBpbiB0aGUgc2FtZSBwbGFjZSBkaXN0YW5jZXMgYXJlIGNhbGN1bGF0ZWQuXHJcblx0XHRcdC8vIFRISVMgSVMgVEVNUE9SQVJZIFBBVENIIHRvIGdldCB0aGUgbmVlZGVkIHBvaW50c1xyXG5cdFx0XHRpZiAoIWlzTmFOKHRoaXMuYmlrZVN0YXJ0S00pKSB7XHJcblx0XHRcdFx0Zm9yICh2YXIgaT0wO2k8dGhpcy5kaXN0YW5jZXMubGVuZ3RoO2krKykge1xyXG5cdFx0XHRcdFx0aWYgKHRoaXMuZGlzdGFuY2VzW2ldID49IHRoaXMuYmlrZVN0YXJ0S00qMTAwMClcclxuXHRcdFx0XHRcdFx0YnJlYWs7XHJcblx0XHRcdFx0fVxyXG5cdFx0XHRcdHZhciBqO1xyXG5cdFx0XHRcdGlmICghaXNOYU4odGhpcy5ydW5TdGFydEtNKSkge1xyXG5cdFx0XHRcdFx0Zm9yIChqPWk7ajx0aGlzLmRpc3RhbmNlcy5sZW5ndGg7aisrKSB7XHJcblx0XHRcdFx0XHRcdGlmICh0aGlzLmRpc3RhbmNlc1tqXSA+PSB0aGlzLnJ1blN0YXJ0S00qMTAwMClcclxuXHRcdFx0XHRcdFx0XHRicmVhaztcclxuXHRcdFx0XHRcdH1cclxuXHRcdFx0XHR9IGVsc2Uge1xyXG5cdFx0XHRcdFx0aj10aGlzLmRpc3RhbmNlcy5sZW5ndGg7XHJcblx0XHRcdFx0fVxyXG5cdFx0XHRcdHZhciBjb29yZHM9dGhpcy5mZWF0dXJlLmdldEdlb21ldHJ5KCkuZ2V0Q29vcmRpbmF0ZXMoKTtcclxuXHRcdFx0XHR2YXIgZ2VvbXN3aW09Y29vcmRzLnNsaWNlKDAsaSk7XHJcblx0XHRcdFx0dmFyIGdlb21iaWtlPWNvb3Jkcy5zbGljZShpIDwgMSA/IGkgOiBpLTEsaik7XHJcblx0XHRcdFx0aWYgKGogPCB0aGlzLmRpc3RhbmNlcy5sZW5ndGgpXHJcblx0XHRcdFx0XHR2YXIgZ2VvbXJ1bj1jb29yZHMuc2xpY2UoaiA8IDEgPyBqIDogai0xLHRoaXMuZGlzdGFuY2VzLmxlbmd0aCk7XHJcblx0XHRcdFx0aWYgKCFnZW9tc3dpbS5sZW5ndGgpXHJcblx0XHRcdFx0XHRnZW9tc3dpbT1udWxsO1xyXG5cdFx0XHRcdGlmICghZ2VvbWJpa2UubGVuZ3RoKVxyXG5cdFx0XHRcdFx0Z2VvbWJpa2U9bnVsbDtcclxuXHRcdFx0XHRpZiAoIWdlb21ydW4ubGVuZ3RoKVxyXG5cdFx0XHRcdFx0Z2VvbXJ1bj1udWxsO1xyXG5cdFx0XHR9XHJcblxyXG5cdFx0XHRmb3IgKHZhciBpID0gMCwgbGVuID0gaG90c3BvdHMubGVuZ3RoOyBpIDwgbGVuOyBpKyspIHtcclxuXHRcdFx0XHR2YXIgaG90c3BvdCA9IGhvdHNwb3RzW2ldO1xyXG5cdFx0XHRcdHZhciBwb2ludDtcclxuXHRcdFx0XHRpZiAoaG90c3BvdC50eXBlID09PSBDT05GSUcuaG90c3BvdC5jYW1Td2ltQmlrZSkge1xyXG5cdFx0XHRcdFx0aWYgKHRoaXMuaXNBZGRlZEhvdFNwb3RTd2ltQmlrZSkgY29udGludWU7IC8vIG5vdCBhbGxvd2VkIHRvIGFkZCB0byBzYW1lIGhvdHNwb3RzXHJcblx0XHRcdFx0XHRpZiAoZ2VvbWJpa2UpIHtcclxuXHRcdFx0XHRcdFx0cG9pbnQgPSBvbC5wcm9qLnRyYW5zZm9ybShnZW9tYmlrZVswXSwgJ0VQU0c6Mzg1NycsICdFUFNHOjQzMjYnKTtcclxuXHRcdFx0XHRcdFx0dGhpcy5pc0FkZGVkSG90U3BvdFN3aW1CaWtlID0gdHJ1ZTtcclxuXHRcdFx0XHRcdH1cclxuXHRcdFx0XHR9IGVsc2UgaWYgKGhvdHNwb3QudHlwZSA9PT0gQ09ORklHLmhvdHNwb3QuY2FtQmlrZVJ1bikge1xyXG5cdFx0XHRcdFx0aWYgKHRoaXMuaXNBZGRlZEhvdFNwb3RCaWtlUnVuKSBjb250aW51ZTsgLy8gbm90IGFsbG93ZWQgdG8gYWRkIHRvIHNhbWUgaG90c3BvdHNcclxuXHRcdFx0XHRcdGlmIChnZW9tcnVuKSB7XHJcblx0XHRcdFx0XHRcdHBvaW50ID0gb2wucHJvai50cmFuc2Zvcm0oZ2VvbXJ1blswXSwgJ0VQU0c6Mzg1NycsICdFUFNHOjQzMjYnKTtcclxuXHRcdFx0XHRcdFx0dGhpcy5pc0FkZGVkSG90U3BvdEJpa2VSdW4gPSB0cnVlO1xyXG5cdFx0XHRcdFx0fVxyXG5cdFx0XHRcdH1cclxuXHRcdFx0XHRpZiAocG9pbnQpXHJcblx0XHRcdFx0XHRob3RzcG90LmluaXQocG9pbnQpO1xyXG5cdFx0XHR9XHJcblx0XHR9LFxyXG5cdFx0XHJcblx0XHRvbk1hcENsaWNrIDogZnVuY3Rpb24oZXZlbnQpIFxyXG5cdFx0e1xyXG5cdFx0XHRpZiAodGhpcy5kZWJ1Z1BhcnRpY2lwYW50KSBcclxuXHRcdFx0e1xyXG5cdFx0XHRcdHRoaXMuZGVidWdQYXJ0aWNpcGFudC5vbkRlYnVnQ2xpY2soZXZlbnQpO1xyXG5cdFx0XHR9XHJcblx0XHR9LFxyXG5cdFx0XHJcblx0XHR0ZXN0MSA6IGZ1bmN0aW9uKCkge1xyXG5cdFx0XHQvKmNvbnNvbGUubG9nKFwiI0JFR0lOTk5OTk5OTk5OTk5OTk5OTk5OTk5OTk5OTk5OTk5OTk5OTk5OXCIpXHJcblx0XHRcdGZvciAodmFyIGk9MDtpPDMwO2krKykgXHJcblx0XHRcdHtcclxuXHRcdFx0XHR2YXIgZWxhcHNlZCA9IGkvNjAuMDsgIC8vKCh0bSAtIHN0aW1lKS8xMDAwLjApL3RyYWNrSW5TZWNvbmRzICsgQ29uZmlnLnNpbXVsYXRpb24uc3RhcnRFbGFwc2VkO1xyXG5cdFx0XHRcdGlmIChlbGFwc2VkID4gMSlcclxuXHRcdFx0XHRcdGVsYXBzZWQ9MTtcclxuXHRcdFx0XHQvL3ZhciBwb3MgPSB0cmFjay5nZXRQb3NpdGlvbkFuZFJvdGF0aW9uRnJvbUVsYXBzZWQoZWxhcHNlZCk7XHJcblx0XHRcdFx0dmFyIHBvcyA9IHRoaXMuX19nZXRQb3NpdGlvbkFuZFJvdGF0aW9uRnJvbUVsYXBzZWQoZWxhcHNlZCk7XHJcblx0XHRcdFx0Y29uc29sZS5sb2coW01hdGgucm91bmQocG9zWzBdKjEwMDAwMDAuMCkvMTAwMDAwMC4wLE1hdGgucm91bmQocG9zWzFdKjEwMDAwMDAuMCkvMTAwMDAwMC4wXSk7XHJcblx0XHRcdH1cclxuXHRcdFx0Y29uc29sZS5sb2coXCIjRU5EXCIpOyovXHJcblx0XHR9XHJcblxyXG4gICAgfVxyXG59KTsiLCJ2YXIgdG9SYWRpYW5zID0gZnVuY3Rpb24oYW5nbGVEZWdyZWVzKSB7IHJldHVybiBhbmdsZURlZ3JlZXMgKiBNYXRoLlBJIC8gMTgwOyB9O1xyXG52YXIgdG9EZWdyZWVzID0gZnVuY3Rpb24oYW5nbGVSYWRpYW5zKSB7IHJldHVybiBhbmdsZVJhZGlhbnMgKiAxODAgLyBNYXRoLlBJOyB9O1xyXG5cclxudmFyIFdHUzg0U3BoZXJlID0gZnVuY3Rpb24ocmFkaXVzKSB7XHJcbiAgdGhpcy5yYWRpdXMgPSByYWRpdXM7XHJcbn07XHJcblxyXG5XR1M4NFNwaGVyZS5wcm90b3R5cGUuY29zaW5lRGlzdGFuY2UgPSBmdW5jdGlvbihjMSwgYzIpIHtcclxuICB2YXIgbGF0MSA9IHRvUmFkaWFucyhjMVsxXSk7XHJcbiAgdmFyIGxhdDIgPSB0b1JhZGlhbnMoYzJbMV0pO1xyXG4gIHZhciBkZWx0YUxvbiA9IHRvUmFkaWFucyhjMlswXSAtIGMxWzBdKTtcclxuICByZXR1cm4gdGhpcy5yYWRpdXMgKiBNYXRoLmFjb3MoXHJcbiAgICAgIE1hdGguc2luKGxhdDEpICogTWF0aC5zaW4obGF0MikgK1xyXG4gICAgICBNYXRoLmNvcyhsYXQxKSAqIE1hdGguY29zKGxhdDIpICogTWF0aC5jb3MoZGVsdGFMb24pKTtcclxufTtcclxuXHJcbldHUzg0U3BoZXJlLnByb3RvdHlwZS5nZW9kZXNpY0FyZWEgPSBmdW5jdGlvbihjb29yZGluYXRlcykge1xyXG4gIHZhciBhcmVhID0gMCwgbGVuID0gY29vcmRpbmF0ZXMubGVuZ3RoO1xyXG4gIHZhciB4MSA9IGNvb3JkaW5hdGVzW2xlbiAtIDFdWzBdO1xyXG4gIHZhciB5MSA9IGNvb3JkaW5hdGVzW2xlbiAtIDFdWzFdO1xyXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuOyBpKyspIHtcclxuICAgIHZhciB4MiA9IGNvb3JkaW5hdGVzW2ldWzBdLCB5MiA9IGNvb3JkaW5hdGVzW2ldWzFdO1xyXG4gICAgYXJlYSArPSB0b1JhZGlhbnMoeDIgLSB4MSkgKlxyXG4gICAgICAgICgyICsgTWF0aC5zaW4odG9SYWRpYW5zKHkxKSkgK1xyXG4gICAgICAgIE1hdGguc2luKHRvUmFkaWFucyh5MikpKTtcclxuICAgIHgxID0geDI7XHJcbiAgICB5MSA9IHkyO1xyXG4gIH1cclxuICByZXR1cm4gYXJlYSAqIHRoaXMucmFkaXVzICogdGhpcy5yYWRpdXMgLyAyLjA7XHJcbn07XHJcblxyXG5XR1M4NFNwaGVyZS5wcm90b3R5cGUuY3Jvc3NUcmFja0Rpc3RhbmNlID0gZnVuY3Rpb24oYzEsIGMyLCBjMykge1xyXG4gIHZhciBkMTMgPSB0aGlzLmNvc2luZURpc3RhbmNlKGMxLCBjMik7XHJcbiAgdmFyIHRoZXRhMTIgPSB0b1JhZGlhbnModGhpcy5pbml0aWFsQmVhcmluZyhjMSwgYzIpKTtcclxuICB2YXIgdGhldGExMyA9IHRvUmFkaWFucyh0aGlzLmluaXRpYWxCZWFyaW5nKGMxLCBjMykpO1xyXG4gIHJldHVybiB0aGlzLnJhZGl1cyAqXHJcbiAgICAgIE1hdGguYXNpbihNYXRoLnNpbihkMTMgLyB0aGlzLnJhZGl1cykgKiBNYXRoLnNpbih0aGV0YTEzIC0gdGhldGExMikpO1xyXG59O1xyXG5cclxuV0dTODRTcGhlcmUucHJvdG90eXBlLmVxdWlyZWN0YW5ndWxhckRpc3RhbmNlID0gZnVuY3Rpb24oYzEsIGMyKSB7XHJcbiAgdmFyIGxhdDEgPSB0b1JhZGlhbnMoYzFbMV0pO1xyXG4gIHZhciBsYXQyID0gdG9SYWRpYW5zKGMyWzFdKTtcclxuICB2YXIgZGVsdGFMb24gPSB0b1JhZGlhbnMoYzJbMF0gLSBjMVswXSk7XHJcbiAgdmFyIHggPSBkZWx0YUxvbiAqIE1hdGguY29zKChsYXQxICsgbGF0MikgLyAyKTtcclxuICB2YXIgeSA9IGxhdDIgLSBsYXQxO1xyXG4gIHJldHVybiB0aGlzLnJhZGl1cyAqIE1hdGguc3FydCh4ICogeCArIHkgKiB5KTtcclxufTtcclxuXHJcbldHUzg0U3BoZXJlLnByb3RvdHlwZS5maW5hbEJlYXJpbmcgPSBmdW5jdGlvbihjMSwgYzIpIHtcclxuICByZXR1cm4gKHRoaXMuaW5pdGlhbEJlYXJpbmcoYzIsIGMxKSArIDE4MCkgJSAzNjA7XHJcbn07XHJcblxyXG5XR1M4NFNwaGVyZS5wcm90b3R5cGUuaGF2ZXJzaW5lRGlzdGFuY2UgPSBmdW5jdGlvbihjMSwgYzIpIHtcclxuICB2YXIgbGF0MSA9IHRvUmFkaWFucyhjMVsxXSk7XHJcbiAgdmFyIGxhdDIgPSB0b1JhZGlhbnMoYzJbMV0pO1xyXG4gIHZhciBkZWx0YUxhdEJ5MiA9IChsYXQyIC0gbGF0MSkgLyAyO1xyXG4gIHZhciBkZWx0YUxvbkJ5MiA9IHRvUmFkaWFucyhjMlswXSAtIGMxWzBdKSAvIDI7XHJcbiAgdmFyIGEgPSBNYXRoLnNpbihkZWx0YUxhdEJ5MikgKiBNYXRoLnNpbihkZWx0YUxhdEJ5MikgK1xyXG4gICAgICBNYXRoLnNpbihkZWx0YUxvbkJ5MikgKiBNYXRoLnNpbihkZWx0YUxvbkJ5MikgKlxyXG4gICAgICBNYXRoLmNvcyhsYXQxKSAqIE1hdGguY29zKGxhdDIpO1xyXG4gIHJldHVybiAyICogdGhpcy5yYWRpdXMgKiBNYXRoLmF0YW4yKE1hdGguc3FydChhKSwgTWF0aC5zcXJ0KDEgLSBhKSk7XHJcbn07XHJcblxyXG5XR1M4NFNwaGVyZS5wcm90b3R5cGUuaW50ZXJwb2xhdGUgPSBmdW5jdGlvbihjMSwgYzIsIGZyYWN0aW9uKSB7XHJcbiAgdmFyIGxhdDEgPSB0b1JhZGlhbnMoYzFbMV0pO1xyXG4gIHZhciBsb24xID0gdG9SYWRpYW5zKGMxWzBdKTtcclxuICB2YXIgbGF0MiA9IHRvUmFkaWFucyhjMlsxXSk7XHJcbiAgdmFyIGxvbjIgPSB0b1JhZGlhbnMoYzJbMF0pO1xyXG4gIHZhciBjb3NMYXQxID0gTWF0aC5jb3MobGF0MSk7XHJcbiAgdmFyIHNpbkxhdDEgPSBNYXRoLnNpbihsYXQxKTtcclxuICB2YXIgY29zTGF0MiA9IE1hdGguY29zKGxhdDIpO1xyXG4gIHZhciBzaW5MYXQyID0gTWF0aC5zaW4obGF0Mik7XHJcbiAgdmFyIGNvc0RlbHRhTG9uID0gTWF0aC5jb3MobG9uMiAtIGxvbjEpO1xyXG4gIHZhciBkID0gc2luTGF0MSAqIHNpbkxhdDIgKyBjb3NMYXQxICogY29zTGF0MiAqIGNvc0RlbHRhTG9uO1xyXG4gIGlmICgxIDw9IGQpIHtcclxuICAgIHJldHVybiBjMi5zbGljZSgpO1xyXG4gIH1cclxuICBkID0gZnJhY3Rpb24gKiBNYXRoLmFjb3MoZCk7XHJcbiAgdmFyIGNvc0QgPSBNYXRoLmNvcyhkKTtcclxuICB2YXIgc2luRCA9IE1hdGguc2luKGQpO1xyXG4gIHZhciB5ID0gTWF0aC5zaW4obG9uMiAtIGxvbjEpICogY29zTGF0MjtcclxuICB2YXIgeCA9IGNvc0xhdDEgKiBzaW5MYXQyIC0gc2luTGF0MSAqIGNvc0xhdDIgKiBjb3NEZWx0YUxvbjtcclxuICB2YXIgdGhldGEgPSBNYXRoLmF0YW4yKHksIHgpO1xyXG4gIHZhciBsYXQgPSBNYXRoLmFzaW4oc2luTGF0MSAqIGNvc0QgKyBjb3NMYXQxICogc2luRCAqIE1hdGguY29zKHRoZXRhKSk7XHJcbiAgdmFyIGxvbiA9IGxvbjEgKyBNYXRoLmF0YW4yKE1hdGguc2luKHRoZXRhKSAqIHNpbkQgKiBjb3NMYXQxLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb3NEIC0gc2luTGF0MSAqIE1hdGguc2luKGxhdCkpO1xyXG4gIHJldHVybiBbdG9EZWdyZWVzKGxvbiksIHRvRGVncmVlcyhsYXQpXTtcclxufTtcclxuXHJcbldHUzg0U3BoZXJlLnByb3RvdHlwZS5pbml0aWFsQmVhcmluZyA9IGZ1bmN0aW9uKGMxLCBjMikge1xyXG4gIHZhciBsYXQxID0gdG9SYWRpYW5zKGMxWzFdKTtcclxuICB2YXIgbGF0MiA9IHRvUmFkaWFucyhjMlsxXSk7XHJcbiAgdmFyIGRlbHRhTG9uID0gdG9SYWRpYW5zKGMyWzBdIC0gYzFbMF0pO1xyXG4gIHZhciB5ID0gTWF0aC5zaW4oZGVsdGFMb24pICogTWF0aC5jb3MobGF0Mik7XHJcbiAgdmFyIHggPSBNYXRoLmNvcyhsYXQxKSAqIE1hdGguc2luKGxhdDIpIC1cclxuICAgICAgTWF0aC5zaW4obGF0MSkgKiBNYXRoLmNvcyhsYXQyKSAqIE1hdGguY29zKGRlbHRhTG9uKTtcclxuICByZXR1cm4gdG9EZWdyZWVzKE1hdGguYXRhbjIoeSwgeCkpO1xyXG59O1xyXG5cclxuV0dTODRTcGhlcmUucHJvdG90eXBlLm1heGltdW1MYXRpdHVkZSA9IGZ1bmN0aW9uKGJlYXJpbmcsIGxhdGl0dWRlKSB7XHJcbiAgcmV0dXJuIE1hdGguY29zKE1hdGguYWJzKE1hdGguc2luKHRvUmFkaWFucyhiZWFyaW5nKSkgKlxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICBNYXRoLmNvcyh0b1JhZGlhbnMobGF0aXR1ZGUpKSkpO1xyXG59O1xyXG5cclxuV0dTODRTcGhlcmUucHJvdG90eXBlLm1pZHBvaW50ID0gZnVuY3Rpb24oYzEsIGMyKSB7XHJcbiAgdmFyIGxhdDEgPSB0b1JhZGlhbnMoYzFbMV0pO1xyXG4gIHZhciBsYXQyID0gdG9SYWRpYW5zKGMyWzFdKTtcclxuICB2YXIgbG9uMSA9IHRvUmFkaWFucyhjMVswXSk7XHJcbiAgdmFyIGRlbHRhTG9uID0gdG9SYWRpYW5zKGMyWzBdIC0gYzFbMF0pO1xyXG4gIHZhciBCeCA9IE1hdGguY29zKGxhdDIpICogTWF0aC5jb3MoZGVsdGFMb24pO1xyXG4gIHZhciBCeSA9IE1hdGguY29zKGxhdDIpICogTWF0aC5zaW4oZGVsdGFMb24pO1xyXG4gIHZhciBjb3NMYXQxUGx1c0J4ID0gTWF0aC5jb3MobGF0MSkgKyBCeDtcclxuICB2YXIgbGF0ID0gTWF0aC5hdGFuMihNYXRoLnNpbihsYXQxKSArIE1hdGguc2luKGxhdDIpLFxyXG4gICAgICAgICAgICAgICAgICAgICAgIE1hdGguc3FydChjb3NMYXQxUGx1c0J4ICogY29zTGF0MVBsdXNCeCArIEJ5ICogQnkpKTtcclxuICB2YXIgbG9uID0gbG9uMSArIE1hdGguYXRhbjIoQnksIGNvc0xhdDFQbHVzQngpO1xyXG4gIHJldHVybiBbdG9EZWdyZWVzKGxvbiksIHRvRGVncmVlcyhsYXQpXTtcclxufTtcclxuXHJcbldHUzg0U3BoZXJlLnByb3RvdHlwZS5vZmZzZXQgPSBmdW5jdGlvbihjMSwgZGlzdGFuY2UsIGJlYXJpbmcpIHtcclxuICB2YXIgbGF0MSA9IHRvUmFkaWFucyhjMVsxXSk7XHJcbiAgdmFyIGxvbjEgPSB0b1JhZGlhbnMoYzFbMF0pO1xyXG4gIHZhciBkQnlSID0gZGlzdGFuY2UgLyB0aGlzLnJhZGl1cztcclxuICB2YXIgbGF0ID0gTWF0aC5hc2luKFxyXG4gICAgICBNYXRoLnNpbihsYXQxKSAqIE1hdGguY29zKGRCeVIpICtcclxuICAgICAgTWF0aC5jb3MobGF0MSkgKiBNYXRoLnNpbihkQnlSKSAqIE1hdGguY29zKGJlYXJpbmcpKTtcclxuICB2YXIgbG9uID0gbG9uMSArIE1hdGguYXRhbjIoXHJcbiAgICAgIE1hdGguc2luKGJlYXJpbmcpICogTWF0aC5zaW4oZEJ5UikgKiBNYXRoLmNvcyhsYXQxKSxcclxuICAgICAgTWF0aC5jb3MoZEJ5UikgLSBNYXRoLnNpbihsYXQxKSAqIE1hdGguc2luKGxhdCkpO1xyXG4gIHJldHVybiBbdG9EZWdyZWVzKGxvbiksIHRvRGVncmVlcyhsYXQpXTtcclxufTtcclxuXHJcbi8qKlxyXG4gKiBDaGVja3Mgd2hldGhlciBvYmplY3QgaXMgbm90IG51bGwgYW5kIG5vdCB1bmRlZmluZWRcclxuICogQHBhcmFtIHsqfSBvYmogb2JqZWN0IHRvIGJlIGNoZWNrZWRcclxuICogQHJldHVybiB7Ym9vbGVhbn1cclxuICovXHJcblxyXG5mdW5jdGlvbiBpc0RlZmluZWQob2JqKSB7XHJcbiAgICByZXR1cm4gbnVsbCAhPSBvYmogJiYgdW5kZWZpbmVkICE9IG9iajtcclxufVxyXG5cclxuZnVuY3Rpb24gaXNOdW1lcmljKHdoKSB7XHJcbiAgICByZXR1cm4gIWlzTmFOKHBhcnNlRmxvYXQod2gpKSAmJiBpc0Zpbml0ZSh3aCk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGlzRnVuY3Rpb24od2gpIHtcclxuICAgIGlmICghd2gpIHtcclxuICAgICAgICByZXR1cm4gZmFsc2U7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gKHdoIGluc3RhbmNlb2YgRnVuY3Rpb24gfHwgdHlwZW9mIHdoID09IFwiZnVuY3Rpb25cIik7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGlzU3RyaW5nTm90RW1wdHkod2gpIHtcclxuICAgIGlmICghd2gpIHtcclxuICAgICAgICByZXR1cm4gZmFsc2U7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gKHdoIGluc3RhbmNlb2YgU3RyaW5nIHx8IHR5cGVvZiB3aCA9PSBcInN0cmluZ1wiKTtcclxufVxyXG5cclxuZnVuY3Rpb24gaXNTdHIod2gpIHtcclxuICAgIHJldHVybiAod2ggaW5zdGFuY2VvZiBTdHJpbmcgfHwgdHlwZW9mIHdoID09PSBcInN0cmluZ1wiKTtcclxufVxyXG5cclxuZnVuY3Rpb24gaXNCb29sZWFuKHdoKSB7XHJcbiAgICByZXR1cm4gKHdoIGluc3RhbmNlb2YgQm9vbGVhbiB8fCB0eXBlb2Ygd2ggPT0gXCJib29sZWFuXCIpO1xyXG59XHJcblxyXG5mdW5jdGlvbiBteVRyaW0oeCkge1xyXG4gICAgcmV0dXJuIHgucmVwbGFjZSgvXlxccyt8XFxzKyQvZ20sJycpO1xyXG59XHJcblxyXG5mdW5jdGlvbiBteVRyaW1Db29yZGluYXRlKHgpIHtcclxuXHRkbyB7XHJcblx0XHR2YXIgaz14O1xyXG5cdFx0eD1teVRyaW0oeCk7XHJcblx0XHRpZiAoayAhPSB4KSBcclxuXHRcdFx0Y29udGludWU7XHJcblx0XHRpZiAoeC5sZW5ndGgpIFxyXG5cdFx0e1xyXG5cdFx0XHRpZiAoeFswXSA9PSBcIixcIilcclxuXHRcdFx0XHR4PXguc3Vic3RyaW5nKDEseC5sZW5ndGgpO1xyXG5cdFx0XHRlbHNlIGlmIChrW2subGVuZ3RoLTFdID09IFwiLFwiKVxyXG5cdFx0XHRcdHg9eC5zdWJzdHJpbmcoMCx4Lmxlbmd0aC0xKTtcclxuXHRcdFx0ZWxzZVxyXG5cdFx0XHRcdGJyZWFrO1xyXG5cdFx0XHRjb250aW51ZTtcclxuXHRcdH1cclxuXHRcdGJyZWFrO1xyXG5cdH0gd2hpbGUgKHRydWUpO1xyXG5cdHJldHVybiB4O1xyXG59XHJcblxyXG5cclxuZnVuY3Rpb24gY2xvc2VzdFByb2plY3Rpb25PZlBvaW50T25MaW5lKHgseSx4MSx5MSx4Mix5MikgXHJcbntcclxuXHR2YXIgc3RhdHVzO1xyXG5cdHZhciBQMT1udWxsO1xyXG5cdHZhciBQMj1udWxsO1xyXG5cdHZhciBQMz1udWxsO1xyXG5cdHZhciBQND1udWxsO1xyXG5cdHZhciBwMT1bXTtcclxuICAgIHZhciBwMj1bXTtcclxuICAgIHZhciBwMz1bXTtcclxuXHR2YXIgcDQ9W107XHJcbiAgICB2YXIgaW50ZXJzZWN0aW9uUG9pbnQ9bnVsbDtcclxuICAgIHZhciBkaXN0TWluUG9pbnQ9bnVsbDtcclxuICAgIHZhciBkZW5vbWluYXRvcj0wO1xyXG4gICAgdmFyIG5vbWluYXRvcj0wO1xyXG4gICAgdmFyIHU9MDtcclxuICAgIHZhciBkaXN0T3J0aG89MDtcclxuICAgIHZhciBkaXN0UDE9MDtcclxuICAgIHZhciBkaXN0UDI9MDtcclxuICAgIHZhciBkaXN0TWluPTA7XHJcbiAgICB2YXIgZGlzdE1heD0wO1xyXG4gICBcclxuICAgIGZ1bmN0aW9uIGludGVyc2VjdGlvbigpXHJcbiAgICB7XHJcbiAgICAgICAgdmFyIGF4ID0gcDFbMF0gKyB1ICogKHAyWzBdIC0gcDFbMF0pO1xyXG4gICAgICAgIHZhciBheSA9IHAxWzFdICsgdSAqIChwMlsxXSAtIHAxWzFdKTtcclxuICAgICAgICBwNCA9IFtheCwgYXldO1xyXG4gICAgICAgIGludGVyc2VjdGlvblBvaW50ID0gW2F4LGF5XTtcclxuICAgIH1cclxuXHJcbiAgICBmdW5jdGlvbiBkaXN0YW5jZSgpXHJcbiAgICB7XHJcbiAgICAgICAgdmFyIGF4ID0gcDFbMF0gKyB1ICogKHAyWzBdIC0gcDFbMF0pO1xyXG4gICAgICAgIHZhciBheSA9IHAxWzFdICsgdSAqIChwMlsxXSAtIHAxWzFdKTtcclxuICAgICAgICBwNCA9IFtheCwgYXldO1xyXG4gICAgICAgIGRpc3RPcnRobyA9IE1hdGguc3FydChNYXRoLnBvdygocDRbMF0gLSBwM1swXSksMikgKyBNYXRoLnBvdygocDRbMV0gLSBwM1sxXSksMikpO1xyXG4gICAgICAgIGRpc3RQMSAgICA9IE1hdGguc3FydChNYXRoLnBvdygocDFbMF0gLSBwM1swXSksMikgKyBNYXRoLnBvdygocDFbMV0gLSBwM1sxXSksMikpO1xyXG4gICAgICAgIGRpc3RQMiAgICA9IE1hdGguc3FydChNYXRoLnBvdygocDJbMF0gLSBwM1swXSksMikgKyBNYXRoLnBvdygocDJbMV0gLSBwM1sxXSksMikpO1xyXG4gICAgICAgIGlmKHU+PTAgJiYgdTw9MSlcclxuICAgICAgICB7ICAgZGlzdE1pbiA9IGRpc3RPcnRobztcclxuICAgICAgICAgICAgZGlzdE1pblBvaW50ID0gaW50ZXJzZWN0aW9uUG9pbnQ7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGVsc2VcclxuICAgICAgICB7ICAgaWYoZGlzdFAxIDw9IGRpc3RQMilcclxuICAgICAgICAgICAgeyAgIGRpc3RNaW4gPSBkaXN0UDE7XHJcbiAgICAgICAgICAgICAgICBkaXN0TWluUG9pbnQgPSBQMTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBlbHNlXHJcbiAgICAgICAgICAgIHsgICBkaXN0TWluID0gZGlzdFAyO1xyXG4gICAgICAgICAgICAgICAgZGlzdE1pblBvaW50ID0gUDI7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgICAgZGlzdE1heCA9IE1hdGgubWF4KE1hdGgubWF4KGRpc3RPcnRobywgZGlzdFAxKSwgZGlzdFAyKTtcclxuICAgIH1cclxuXHRQMSA9IFt4MSx5MV07XHJcblx0UDIgPSBbeDIseTJdO1xyXG5cdFAzID0gW3gseV07XHJcblx0cDEgPSBbeDEsIHkxXTtcclxuXHRwMiA9IFt4MiwgeTJdO1xyXG5cdHAzID0gW3gsIHldO1xyXG5cdGRlbm9taW5hdG9yID0gTWF0aC5wb3coTWF0aC5zcXJ0KE1hdGgucG93KHAyWzBdLXAxWzBdLDIpICsgTWF0aC5wb3cocDJbMV0tcDFbMV0sMikpLDIgKTtcclxuXHRub21pbmF0b3IgICA9IChwM1swXSAtIHAxWzBdKSAqIChwMlswXSAtIHAxWzBdKSArIChwM1sxXSAtIHAxWzFdKSAqIChwMlsxXSAtIHAxWzFdKTtcclxuXHRpZihkZW5vbWluYXRvcj09MClcclxuXHR7ICAgc3RhdHVzID0gXCJjb2luY2lkZW50YWxcIlxyXG5cdFx0dSA9IC05OTk7XHJcblx0fVxyXG5cdGVsc2VcclxuXHR7ICAgdSA9IG5vbWluYXRvciAvIGRlbm9taW5hdG9yO1xyXG5cdFx0aWYodSA+PTAgJiYgdSA8PSAxKVxyXG5cdFx0XHRzdGF0dXMgPSBcIm9ydGhvZ29uYWxcIjtcclxuXHRcdGVsc2VcclxuXHRcdFx0c3RhdHVzID0gXCJvYmxpcXVlXCI7XHJcblx0fVxyXG5cdGludGVyc2VjdGlvbigpO1xyXG5cdGRpc3RhbmNlKCk7XHJcblx0XHJcblx0cmV0dXJuIHsgc3RhdHVzIDogc3RhdHVzLCBwb3MgOiBkaXN0TWluUG9pbnQsIG1pbiA6IGRpc3RNaW4gfTtcclxufVxyXG5cclxuZnVuY3Rpb24gY29sb3JMdW1pbmFuY2UoaGV4LCBsdW0pIHtcclxuICAgIC8vIFZhbGlkYXRlIGhleCBzdHJpbmdcclxuICAgIGhleCA9IFN0cmluZyhoZXgpLnJlcGxhY2UoL1teMC05YS1mXS9naSwgXCJcIik7XHJcbiAgICBpZiAoaGV4Lmxlbmd0aCA8IDYpIHtcclxuICAgICAgICBoZXggPSBoZXgucmVwbGFjZSgvKC4pL2csICckMSQxJyk7XHJcbiAgICB9XHJcbiAgICBsdW0gPSBsdW0gfHwgMDtcclxuICAgIC8vIENvbnZlcnQgdG8gZGVjaW1hbCBhbmQgY2hhbmdlIGx1bWlub3NpdHlcclxuICAgIHZhciByZ2IgPSBcIiNcIixcclxuICAgICAgICBjO1xyXG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCAzOyArK2kpIHtcclxuICAgICAgICBjID0gcGFyc2VJbnQoaGV4LnN1YnN0cihpICogMiwgMiksIDE2KTtcclxuICAgICAgICBjID0gTWF0aC5yb3VuZChNYXRoLm1pbihNYXRoLm1heCgwLCBjICsgKGMgKiBsdW0pKSwgMjU1KSkudG9TdHJpbmcoMTYpO1xyXG4gICAgICAgIHJnYiArPSAoXCIwMFwiICsgYykuc3Vic3RyKGMubGVuZ3RoKTtcclxuICAgIH1cclxuICAgIHJldHVybiByZ2I7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGluY3JlYXNlQnJpZ2h0bmVzcyhoZXgsIHBlcmNlbnQpIFxyXG57XHJcbiAgICBoZXggPSBTdHJpbmcoaGV4KS5yZXBsYWNlKC9bXjAtOWEtZl0vZ2ksIFwiXCIpO1xyXG4gICAgaWYgKGhleC5sZW5ndGggPCA2KSB7XHJcbiAgICAgICAgaGV4ID0gaGV4LnJlcGxhY2UoLyguKS9nLCAnJDEkMScpO1xyXG4gICAgfVxyXG4gICAgdmFyIHJnYiA9IFwiI1wiLFxyXG4gICAgICAgIGM7XHJcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IDM7ICsraSkge1xyXG4gICAgICAgIGMgPSBwYXJzZUludChoZXguc3Vic3RyKGkgKiAyLCAyKSwgMTYpO1xyXG4gICAgICAgIGMgPSBwYXJzZUludCgoYyooMTAwLXBlcmNlbnQpKzI1NSpwZXJjZW50KS8xMDApO1xyXG4gICAgICAgIGlmIChjID4gMjU1KVxyXG4gICAgICAgIFx0Yz0yNTU7XHJcbiAgICAgICAgYz1jLnRvU3RyaW5nKDE2KTtcclxuICAgICAgICByZ2IgKz0gKFwiMDBcIiArIGMpLnN1YnN0cihjLmxlbmd0aCk7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gcmdiO1xyXG59XHJcblxyXG5mdW5jdGlvbiBjb2xvckFscGhhQXJyYXkoaGV4LCBhbHBoYSkge1xyXG4gICAgaGV4ID0gU3RyaW5nKGhleCkucmVwbGFjZSgvW14wLTlhLWZdL2dpLCBcIlwiKTtcclxuICAgIGlmIChoZXgubGVuZ3RoIDwgNikge1xyXG4gICAgICAgIGhleCA9IGhleC5yZXBsYWNlKC8oLikvZywgJyQxJDEnKTtcclxuICAgIH1cclxuICAgIHZhciByZXM9W107XHJcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IDM7ICsraSkge1xyXG4gICAgICAgIGMgPSBwYXJzZUludChoZXguc3Vic3RyKGkgKiAyLCAyKSwgMTYpO1xyXG4gICAgICAgIHJlcy5wdXNoKGMpO1xyXG4gICAgfVxyXG4gICAgcmVzLnB1c2goYWxwaGEpO1xyXG4gICAgcmV0dXJuIHJlcztcclxufVxyXG5cclxuZnVuY3Rpb24gZXNjYXBlSFRNTCh1bnNhZmUpIHtcclxuICAgIHJldHVybiB1bnNhZmVcclxuICAgICAgICAgLnJlcGxhY2UoLyYvZywgXCImYW1wO1wiKVxyXG4gICAgICAgICAucmVwbGFjZSgvPC9nLCBcIiZsdDtcIilcclxuICAgICAgICAgLnJlcGxhY2UoLz4vZywgXCImZ3Q7XCIpXHJcbiAgICAgICAgIC5yZXBsYWNlKC9cIi9nLCBcIiZxdW90O1wiKVxyXG4gICAgICAgICAucmVwbGFjZSgvJy9nLCBcIiYjMDM5O1wiKTtcclxuIH1cclxuXHJcbmZ1bmN0aW9uIGZvcm1hdE51bWJlcjIodmFsKSB7XHJcblx0cmV0dXJuIHBhcnNlRmxvYXQoTWF0aC5yb3VuZCh2YWwgKiAxMDApIC8gMTAwKS50b0ZpeGVkKDIpO1xyXG59XHJcbmZ1bmN0aW9uIGZvcm1hdERhdGUoZCkge1xyXG4gXHR2YXIgZGQgPSBkLmdldERhdGUoKTtcclxuICAgIHZhciBtbSA9IGQuZ2V0TW9udGgoKSsxOyAvL0phbnVhcnkgaXMgMCFcclxuICAgIHZhciB5eXl5ID0gZC5nZXRGdWxsWWVhcigpO1xyXG4gICAgaWYoZGQ8MTApe1xyXG4gICAgICAgIGRkPScwJytkZDtcclxuICAgIH0gXHJcbiAgICBpZihtbTwxMCl7XHJcbiAgICAgICAgbW09JzAnK21tO1xyXG4gICAgfSBcclxuICAgIHJldHVybiBkZCsnLicrbW0rJy4nK3l5eXk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGZvcm1hdFRpbWUoZCkge1xyXG4gICAgdmFyIGhoID0gZC5nZXRIb3VycygpO1xyXG4gICAgaWYoaGg8MTApe1xyXG4gICAgXHRoaD0nMCcraGg7XHJcbiAgICB9IFxyXG4gICAgdmFyIG1tID0gZC5nZXRNaW51dGVzKCk7XHJcbiAgICBpZihtbTwxMCl7XHJcbiAgICAgICAgbW09JzAnK21tO1xyXG4gICAgfSBcclxuICAgIHJldHVybiBoaCtcIjpcIittbTtcclxufVxyXG5cclxuZnVuY3Rpb24gZm9ybWF0RGF0ZVRpbWUoZCkge1xyXG5cdHJldHVybiBmb3JtYXREYXRlKGQpK1wiIFwiK2Zvcm1hdFRpbWUoZCk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGZvcm1hdERhdGVUaW1lU2VjKGQpIHtcclxuXHRyZXR1cm4gZm9ybWF0RGF0ZShkKStcIiBcIitmb3JtYXRUaW1lU2VjKGQpO1xyXG59XHJcblxyXG5mdW5jdGlvbiBmb3JtYXRUaW1lU2VjKGQpIHtcclxuICAgIHZhciBoaCA9IGQuZ2V0SG91cnMoKTtcclxuICAgIGlmKGhoPDEwKXtcclxuICAgIFx0aGg9JzAnK2hoO1xyXG4gICAgfSBcclxuICAgIHZhciBtbSA9IGQuZ2V0TWludXRlcygpO1xyXG4gICAgaWYobW08MTApe1xyXG4gICAgICAgIG1tPScwJyttbTtcclxuICAgIH0gXHJcbiAgICB2YXIgc3MgPSBkLmdldFNlY29uZHMoKTtcclxuICAgIGlmKHNzPDEwKXtcclxuICAgICAgICBzcz0nMCcrc3M7XHJcbiAgICB9IFxyXG4gICAgcmV0dXJuIGhoK1wiOlwiK21tK1wiOlwiK3NzO1xyXG59XHJcblxyXG5mdW5jdGlvbiByYWluYm93KG51bU9mU3RlcHMsIHN0ZXApIHtcclxuICAgIC8vIFRoaXMgZnVuY3Rpb24gZ2VuZXJhdGVzIHZpYnJhbnQsIFwiZXZlbmx5IHNwYWNlZFwiIGNvbG91cnMgKGkuZS4gbm8gY2x1c3RlcmluZykuIFRoaXMgaXMgaWRlYWwgZm9yIGNyZWF0aW5nIGVhc2lseSBkaXN0aW5ndWlzaGFibGUgdmlicmFudCBtYXJrZXJzIGluIEdvb2dsZSBNYXBzIGFuZCBvdGhlciBhcHBzLlxyXG4gICAgLy8gQWRhbSBDb2xlLCAyMDExLVNlcHQtMTRcclxuICAgIC8vIEhTViB0byBSQkcgYWRhcHRlZCBmcm9tOiBodHRwOi8vbWppamFja3Nvbi5jb20vMjAwOC8wMi9yZ2ItdG8taHNsLWFuZC1yZ2ItdG8taHN2LWNvbG9yLW1vZGVsLWNvbnZlcnNpb24tYWxnb3JpdGhtcy1pbi1qYXZhc2NyaXB0XHJcbiAgICB2YXIgciwgZywgYjtcclxuICAgIHZhciBoID0gc3RlcCAvIG51bU9mU3RlcHM7XHJcbiAgICB2YXIgaSA9IH5+KGggKiA2KTtcclxuICAgIHZhciBmID0gaCAqIDYgLSBpO1xyXG4gICAgdmFyIHEgPSAxIC0gZjtcclxuICAgIHN3aXRjaChpICUgNil7XHJcbiAgICAgICAgY2FzZSAwOiByID0gMSwgZyA9IGYsIGIgPSAwOyBicmVhaztcclxuICAgICAgICBjYXNlIDE6IHIgPSBxLCBnID0gMSwgYiA9IDA7IGJyZWFrO1xyXG4gICAgICAgIGNhc2UgMjogciA9IDAsIGcgPSAxLCBiID0gZjsgYnJlYWs7XHJcbiAgICAgICAgY2FzZSAzOiByID0gMCwgZyA9IHEsIGIgPSAxOyBicmVhaztcclxuICAgICAgICBjYXNlIDQ6IHIgPSBmLCBnID0gMCwgYiA9IDE7IGJyZWFrO1xyXG4gICAgICAgIGNhc2UgNTogciA9IDEsIGcgPSAwLCBiID0gcTsgYnJlYWs7XHJcbiAgICB9XHJcbiAgICB2YXIgYyA9IFwiI1wiICsgKFwiMDBcIiArICh+IH4ociAqIDI1NSkpLnRvU3RyaW5nKDE2KSkuc2xpY2UoLTIpICsgKFwiMDBcIiArICh+IH4oZyAqIDI1NSkpLnRvU3RyaW5nKDE2KSkuc2xpY2UoLTIpICsgKFwiMDBcIiArICh+IH4oYiAqIDI1NSkpLnRvU3RyaW5nKDE2KSkuc2xpY2UoLTIpO1xyXG4gICAgcmV0dXJuIChjKTtcclxufVxyXG5cclxuZnVuY3Rpb24gbW9iaWxlQW5kVGFibGV0Q2hlY2soKSBcclxue1xyXG5cdCAgaWYgKHR5cGVvZiBuYXZpZ2F0b3IgPT0gXCJ1bmRlZmluZWRcIilcclxuXHRcdCAgcmV0dXJuIGZhbHNlO1xyXG5cdCAgdmFyIGNoZWNrID0gZmFsc2U7XHJcblx0ICAoZnVuY3Rpb24oYSl7aWYoLyhhbmRyb2lkfGJiXFxkK3xtZWVnbykuK21vYmlsZXxhdmFudGdvfGJhZGFcXC98YmxhY2tiZXJyeXxibGF6ZXJ8Y29tcGFsfGVsYWluZXxmZW5uZWN8aGlwdG9wfGllbW9iaWxlfGlwKGhvbmV8b2QpfGlyaXN8a2luZGxlfGxnZSB8bWFlbW98bWlkcHxtbXB8bW9iaWxlLitmaXJlZm94fG5ldGZyb250fG9wZXJhIG0ob2J8aW4paXxwYWxtKCBvcyk/fHBob25lfHAoaXhpfHJlKVxcL3xwbHVja2VyfHBvY2tldHxwc3B8c2VyaWVzKDR8NikwfHN5bWJpYW58dHJlb3x1cFxcLihicm93c2VyfGxpbmspfHZvZGFmb25lfHdhcHx3aW5kb3dzIGNlfHhkYXx4aWlub3xhbmRyb2lkfGlwYWR8cGxheWJvb2t8c2lsay9pLnRlc3QoYSl8fC8xMjA3fDYzMTB8NjU5MHwzZ3NvfDR0aHB8NTBbMS02XWl8Nzcwc3w4MDJzfGEgd2F8YWJhY3xhYyhlcnxvb3xzXFwtKXxhaShrb3xybil8YWwoYXZ8Y2F8Y28pfGFtb2l8YW4oZXh8bnl8eXcpfGFwdHV8YXIoY2h8Z28pfGFzKHRlfHVzKXxhdHR3fGF1KGRpfFxcLW18ciB8cyApfGF2YW58YmUoY2t8bGx8bnEpfGJpKGxifHJkKXxibChhY3xheil8YnIoZXx2KXd8YnVtYnxid1xcLShufHUpfGM1NVxcL3xjYXBpfGNjd2F8Y2RtXFwtfGNlbGx8Y2h0bXxjbGRjfGNtZFxcLXxjbyhtcHxuZCl8Y3Jhd3xkYShpdHxsbHxuZyl8ZGJ0ZXxkY1xcLXN8ZGV2aXxkaWNhfGRtb2J8ZG8oY3xwKW98ZHMoMTJ8XFwtZCl8ZWwoNDl8YWkpfGVtKGwyfHVsKXxlcihpY3xrMCl8ZXNsOHxleihbNC03XTB8b3N8d2F8emUpfGZldGN8Zmx5KFxcLXxfKXxnMSB1fGc1NjB8Z2VuZXxnZlxcLTV8Z1xcLW1vfGdvKFxcLnd8b2QpfGdyKGFkfHVuKXxoYWllfGhjaXR8aGRcXC0obXxwfHQpfGhlaVxcLXxoaShwdHx0YSl8aHAoIGl8aXApfGhzXFwtY3xodChjKFxcLXwgfF98YXxnfHB8c3x0KXx0cCl8aHUoYXd8dGMpfGlcXC0oMjB8Z298bWEpfGkyMzB8aWFjKCB8XFwtfFxcLyl8aWJyb3xpZGVhfGlnMDF8aWtvbXxpbTFrfGlubm98aXBhcXxpcmlzfGphKHR8dilhfGpicm98amVtdXxqaWdzfGtkZGl8a2VqaXxrZ3QoIHxcXC8pfGtsb258a3B0IHxrd2NcXC18a3lvKGN8ayl8bGUobm98eGkpfGxnKCBnfFxcLyhrfGx8dSl8NTB8NTR8XFwtW2Etd10pfGxpYnd8bHlueHxtMVxcLXd8bTNnYXxtNTBcXC98bWEodGV8dWl8eG8pfG1jKDAxfDIxfGNhKXxtXFwtY3J8bWUocmN8cmkpfG1pKG84fG9hfHRzKXxtbWVmfG1vKDAxfDAyfGJpfGRlfGRvfHQoXFwtfCB8b3x2KXx6eil8bXQoNTB8cDF8diApfG13YnB8bXl3YXxuMTBbMC0yXXxuMjBbMi0zXXxuMzAoMHwyKXxuNTAoMHwyfDUpfG43KDAoMHwxKXwxMCl8bmUoKGN8bSlcXC18b258dGZ8d2Z8d2d8d3QpfG5vayg2fGkpfG56cGh8bzJpbXxvcCh0aXx3dil8b3Jhbnxvd2cxfHA4MDB8cGFuKGF8ZHx0KXxwZHhnfHBnKDEzfFxcLShbMS04XXxjKSl8cGhpbHxwaXJlfHBsKGF5fHVjKXxwblxcLTJ8cG8oY2t8cnR8c2UpfHByb3h8cHNpb3xwdFxcLWd8cWFcXC1hfHFjKDA3fDEyfDIxfDMyfDYwfFxcLVsyLTddfGlcXC0pfHF0ZWt8cjM4MHxyNjAwfHJha3N8cmltOXxybyh2ZXx6byl8czU1XFwvfHNhKGdlfG1hfG1tfG1zfG55fHZhKXxzYygwMXxoXFwtfG9vfHBcXC0pfHNka1xcL3xzZShjKFxcLXwwfDEpfDQ3fG1jfG5kfHJpKXxzZ2hcXC18c2hhcnxzaWUoXFwtfG0pfHNrXFwtMHxzbCg0NXxpZCl8c20oYWx8YXJ8YjN8aXR8dDUpfHNvKGZ0fG55KXxzcCgwMXxoXFwtfHZcXC18diApfHN5KDAxfG1iKXx0MigxOHw1MCl8dDYoMDB8MTB8MTgpfHRhKGd0fGxrKXx0Y2xcXC18dGRnXFwtfHRlbChpfG0pfHRpbVxcLXx0XFwtbW98dG8ocGx8c2gpfHRzKDcwfG1cXC18bTN8bTUpfHR4XFwtOXx1cChcXC5ifGcxfHNpKXx1dHN0fHY0MDB8djc1MHx2ZXJpfHZpKHJnfHRlKXx2ayg0MHw1WzAtM118XFwtdil8dm00MHx2b2RhfHZ1bGN8dngoNTJ8NTN8NjB8NjF8NzB8ODB8ODF8ODN8ODV8OTgpfHczYyhcXC18ICl8d2ViY3x3aGl0fHdpKGcgfG5jfG53KXx3bWxifHdvbnV8eDcwMHx5YXNcXC18eW91cnx6ZXRvfHp0ZVxcLS9pLnRlc3QoYS5zdWJzdHIoMCw0KSkpY2hlY2sgPSB0cnVlfSkobmF2aWdhdG9yLnVzZXJBZ2VudHx8bmF2aWdhdG9yLnZlbmRvcnx8d2luZG93Lm9wZXJhKTtcclxuXHQgIHJldHVybiBjaGVjaztcclxufVxyXG5cclxudmFyIFJFTkRFUkVEQVJST1dTPXt9O1xyXG5mdW5jdGlvbiByZW5kZXJBcnJvd0Jhc2U2NCh3aWR0aCxoZWlnaHQsY29sb3IpIFxyXG57XHJcblx0dmFyIGtleSA9IHdpZHRoK1wieFwiK2hlaWdodCtcIjpcIitjb2xvcjtcclxuXHRpZiAoUkVOREVSRURBUlJPV1Nba2V5XSlcclxuXHRcdHJldHVybiBSRU5ERVJFREFSUk9XU1trZXldO1xyXG5cdHZhciBicmRjb2wgPSBcIiNmZWZlZmVcIjsgLy9pbmNyZWFzZUJyaWdodG5lc3MoY29sb3IsOTkpO1xyXG5cdFxyXG5cdHZhciBzdmc9JzxzdmcgdmVyc2lvbj1cIjEuMVwiIGlkPVwiTGF5ZXJfMVwiIHhtbG5zPVwiaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmdcIiB4bWxuczp4bGluaz1cImh0dHA6Ly93d3cudzMub3JnLzE5OTkveGxpbmtcIiB4PVwiMHB4XCIgeT1cIjBweFwiIHdpZHRoPVwiJyt3aWR0aCsncHRcIiBoZWlnaHQ9XCInK2hlaWdodCsncHRcIiAnXHRcclxuXHQrJ3ZpZXdCb3g9XCIxMzcuODM0IC04Mi44MzMgMTE0IDkxLjMzM1wiIGVuYWJsZS1iYWNrZ3JvdW5kPVwibmV3IDEzNy44MzQgLTgyLjgzMyAxMTQgOTEuMzMzXCIgeG1sOnNwYWNlPVwicHJlc2VydmVcIj4nXHJcblx0Kyc8cGF0aCBmaWxsPVwibm9uZVwiIGQ9XCJNLTUxLTIuMTY3aDQ4djQ4aC00OFYtMi4xNjd6XCIvPidcclxuXHQrJzxjaXJjbGUgZGlzcGxheT1cIm5vbmVcIiBmaWxsPVwiIzYwNUNDOVwiIGN4PVwiNTEuMjg2XCIgY3k9XCItMzUuMjg2XCIgcj1cIjg4Ljc4NlwiLz4nXHJcblx0Kyc8cGF0aCBmaWxsPVwiIzYwNUNDOVwiIHN0cm9rZT1cIiNGRkZGRkZcIiBzdHJva2Utd2lkdGg9XCI0XCIgc3Ryb2tlLW1pdGVybGltaXQ9XCIxMFwiIGQ9XCJNMjM5LjUtMzYuOGwtOTIuNTU4LTM1LjY5IGM1LjIxNiwxMS4zMDQsOC4xMywyMy44ODcsOC4xMywzNy4xNTNjMCwxMi4xNy0yLjQ1MSwyMy43NjctNi44ODMsMzQuMzI3TDIzOS41LTM2Ljh6XCIvPidcclxuXHQrJzwvc3ZnPidcclxuXHR2YXIgc3ZnPXN2Zy5zcGxpdChcIiM2MDVDQzlcIikuam9pbihjb2xvcik7XHJcblx0dmFyIGNhbnZhcyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2NhbnZhcycpO1xyXG4gICAgY2FudmFzLndpZHRoID0gd2lkdGg7XHJcbiAgICBjYW52YXMuaGVpZ2h0ID0gaGVpZ2h0O1xyXG4gICAgY2FudmcoY2FudmFzLCBzdmcseyBpZ25vcmVNb3VzZTogdHJ1ZSwgaWdub3JlQW5pbWF0aW9uOiB0cnVlIH0pO1xyXG4gICAgcmV0dXJuIFJFTkRFUkVEQVJST1dTW2tleV09Y2FudmFzLnRvRGF0YVVSTCgpO1xyXG59XHJcblxyXG52YXIgUkVOREVSRURESVJFQ1RJT05TPXt9O1xyXG5mdW5jdGlvbiByZW5kZXJEaXJlY3Rpb25CYXNlNjQod2lkdGgsaGVpZ2h0LGNvbG9yKSBcclxue1xyXG5cdHZhciBrZXkgPSB3aWR0aCtcInhcIitoZWlnaHQrXCI6XCIrY29sb3I7XHJcblx0aWYgKFJFTkRFUkVERElSRUNUSU9OU1trZXldKVxyXG5cdFx0cmV0dXJuIFJFTkRFUkVERElSRUNUSU9OU1trZXldO1xyXG5cclxuXHR2YXIgc3ZnPSc8c3ZnIHdpZHRoPVwiJyt3aWR0aCsncHRcIiBoZWlnaHQ9XCInK2hlaWdodCsncHRcIiAnXHJcblxyXG5cdFx0Kyd2aWV3Qm94PVwiMTUgOSAxOS43NSAyOS41XCIgZW5hYmxlLWJhY2tncm91bmQ9XCJuZXcgMTUgOSAxOS43NSAyOS41XCIgeG1sOnNwYWNlPVwicHJlc2VydmVcIj4nXHJcblx0XHQrJzxwYXRoIGZpbGw9XCIjRkZGRUZGXCIgZD1cIk0xNy4xNywzMi45Mmw5LjE3LTkuMTdsLTkuMTctOS4xN0wyMCwxMS43NWwxMiwxMmwtMTIsMTJMMTcuMTcsMzIuOTJ6XCIvPidcclxuXHRcdCsnPHBhdGggZmlsbD1cIm5vbmVcIiBkPVwiTTAtMC4yNWg0OHY0OEgwVi0wLjI1elwiLz4nXHJcblxyXG5cdCsnPC9zdmc+JztcclxuXHJcblx0dmFyIHN2Zz1zdmcuc3BsaXQoXCIjMDAwMDAwXCIpLmpvaW4oY29sb3IpO1xyXG5cdHZhciBjYW52YXMgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdjYW52YXMnKTtcclxuICAgIGNhbnZhcy53aWR0aCA9IHdpZHRoO1xyXG4gICAgY2FudmFzLmhlaWdodCA9IGhlaWdodDtcclxuICAgIGNhbnZnKGNhbnZhcywgc3ZnLHsgaWdub3JlTW91c2U6IHRydWUsIGlnbm9yZUFuaW1hdGlvbjogdHJ1ZSB9KTtcclxuICAgIHJldHVybiBSRU5ERVJFRERJUkVDVElPTlNba2V5XT1jYW52YXMudG9EYXRhVVJMKCk7XHJcbn1cclxuXHJcbnZhciBSRU5ERVJFQk9YRVM9e307XHJcbmZ1bmN0aW9uIHJlbmRlckJveEJhc2U2NCh3aWR0aCxoZWlnaHQsY29sb3IpIFxyXG57XHJcblx0dmFyIGtleSA9IHdpZHRoK1wieFwiK2hlaWdodCtcIjpcIitjb2xvcjtcclxuXHRpZiAoUkVOREVSRUJPWEVTW2tleV0pXHJcblx0XHRyZXR1cm4gUkVOREVSRUJPWEVTW2tleV07XHJcblxyXG5cdHZhciBzdmc9Jzxzdmcgd2lkdGg9XCInK3dpZHRoKydwdFwiIGhlaWdodD1cIicraGVpZ2h0KydwdFwiIHZpZXdCb3g9XCIwIDAgNTEyIDUxMlwiIHZlcnNpb249XCIxLjFcIiB4bWxucz1cImh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnXCI+J1xyXG5cdCsnPGcgaWQ9XCIjZmZmZmZmZmZcIj4nXHJcblx0Kyc8cGF0aCBmaWxsPVwiI2ZmZmZmZlwiIG9wYWNpdHk9XCIxLjAwXCIgZD1cIiBNIDU1LjUwIDAuMDAgTCA0NTguNDUgMC4wMCBDIDQ3Mi40NCAwLjk5IDQ4Ni4wMyA3LjA5IDQ5NS43OCAxNy4yMyBDIDUwNS4zNCAyNi44OCA1MTEuMDEgNDAuMDQgNTEyLjAwIDUzLjU1IEwgNTEyLjAwIDQ1OC40NCBDIDUxMC45OSA0NzIuNDMgNTA0LjkwIDQ4Ni4wMSA0OTQuNzcgNDk1Ljc3IEMgNDg1LjExIDUwNS4zMiA0NzEuOTYgNTExLjAxIDQ1OC40NSA1MTIuMDAgTCA1My41NiA1MTIuMDAgQyAzOS41NyA1MTAuOTkgMjUuOTcgNTA0LjkxIDE2LjIyIDQ5NC43OCBDIDYuNjcgNDg1LjEyIDAuOTcgNDcxLjk3IDAuMDAgNDU4LjQ1IEwgMC4wMCA1NS41MCBDIDAuNDAgNDEuMDcgNi40NSAyNi44OSAxNi43NCAxNi43MyBDIDI2Ljg5IDYuNDUgNDEuMDcgMC40MSA1NS41MCAwLjAwIE0gNTYuOTAgNTYuOTAgQyA1Ni44NyAxODkuNjMgNTYuODYgMzIyLjM2IDU2LjkwIDQ1NS4wOSBDIDE4OS42MyA0NTUuMTIgMzIyLjM2IDQ1NS4xMiA0NTUuMDkgNDU1LjA5IEMgNDU1LjEyIDMyMi4zNiA0NTUuMTIgMTg5LjYzIDQ1NS4wOSA1Ni45MCBDIDMyMi4zNiA1Ni44NiAxODkuNjMgNTYuODcgNTYuOTAgNTYuOTAgWlwiIC8+J1xyXG5cdCsnPC9nPidcclxuXHQrJzxnIGlkPVwiIzAwMDAwMGZmXCI+J1xyXG5cdCsnPHBhdGggZmlsbD1cIiMwMDAwMDBcIiBvcGFjaXR5PVwiMS4wMFwiIGQ9XCIgTSA1Ni45MCA1Ni45MCBDIDE4OS42MyA1Ni44NyAzMjIuMzYgNTYuODYgNDU1LjA5IDU2LjkwIEMgNDU1LjEyIDE4OS42MyA0NTUuMTIgMzIyLjM2IDQ1NS4wOSA0NTUuMDkgQyAzMjIuMzYgNDU1LjEyIDE4OS42MyA0NTUuMTIgNTYuOTAgNDU1LjA5IEMgNTYuODYgMzIyLjM2IDU2Ljg3IDE4OS42MyA1Ni45MCA1Ni45MCBaXCIgLz4nXHJcblx0Kyc8L2c+J1xyXG5cdCsnPC9zdmc+JztcclxuXHJcblx0dmFyIHN2Zz1zdmcuc3BsaXQoXCIjMDAwMDAwXCIpLmpvaW4oY29sb3IpO1xyXG5cdHZhciBjYW52YXMgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdjYW52YXMnKTtcclxuICAgIGNhbnZhcy53aWR0aCA9IHdpZHRoO1xyXG4gICAgY2FudmFzLmhlaWdodCA9IGhlaWdodDtcclxuICAgIGNhbnZnKGNhbnZhcywgc3ZnLHsgaWdub3JlTW91c2U6IHRydWUsIGlnbm9yZUFuaW1hdGlvbjogdHJ1ZSB9KTtcclxuICAgIHJldHVybiBSRU5ERVJFQk9YRVNba2V5XT1jYW52YXMudG9EYXRhVVJMKCk7XHJcbn1cclxuXHJcblxyXG5mdW5jdGlvbiBpbnRlcmNlcHRPbkNpcmNsZShhLGIsYyxyKSB7XHJcblx0cmV0dXJuIGNpcmNsZUxpbmVJbnRlcnNlY3QoYVswXSxhWzFdLGJbMF0sYlsxXSxjWzBdLGNbMV0scik7XHRcclxufVxyXG5mdW5jdGlvbiBkaXN0cChwMSxwMikge1xyXG5cdCAgcmV0dXJuIE1hdGguc3FydCgocDJbMF0tcDFbMF0pKihwMlswXS1wMVswXSkrKHAyWzFdLXAxWzFdKSoocDJbMV0tcDFbMV0pKTtcclxufVxyXG5cclxuZnVuY3Rpb24gY2lyY2xlTGluZUludGVyc2VjdCh4MSwgeTEsIHgyLCB5MiwgY3gsIGN5LCBjciApIFxyXG57XHJcblx0ICBmdW5jdGlvbiBkaXN0KHgxLHkxLHgyLHkyKSB7XHJcblx0XHQgIHJldHVybiBNYXRoLnNxcnQoKHgyLXgxKSooeDIteDEpKyh5Mi15MSkqKHkyLXkxKSk7XHJcblx0ICB9XHJcblx0ICB2YXIgZHggPSB4MiAtIHgxO1xyXG5cdCAgdmFyIGR5ID0geTIgLSB5MTtcclxuXHQgIHZhciBhID0gZHggKiBkeCArIGR5ICogZHk7XHJcblx0ICB2YXIgYiA9IDIgKiAoZHggKiAoeDEgLSBjeCkgKyBkeSAqICh5MSAtIGN5KSk7XHJcblx0ICB2YXIgYyA9IGN4ICogY3ggKyBjeSAqIGN5O1xyXG5cdCAgYyArPSB4MSAqIHgxICsgeTEgKiB5MTtcclxuXHQgIGMgLT0gMiAqIChjeCAqIHgxICsgY3kgKiB5MSk7XHJcblx0ICBjIC09IGNyICogY3I7XHJcblx0ICB2YXIgYmI0YWMgPSBiICogYiAtIDQgKiBhICogYztcclxuXHQgIGlmIChiYjRhYyA8IDApIHsgIC8vIE5vdCBpbnRlcnNlY3RpbmdcclxuXHQgICAgcmV0dXJuIGZhbHNlO1xyXG5cdCAgfSBlbHNlIHtcclxuXHRcdHZhciBtdSA9ICgtYiArIE1hdGguc3FydCggYipiIC0gNCphKmMgKSkgLyAoMiphKTtcclxuXHRcdHZhciBpeDEgPSB4MSArIG11KihkeCk7XHJcblx0XHR2YXIgaXkxID0geTEgKyBtdSooZHkpO1xyXG5cdCAgICBtdSA9ICgtYiAtIE1hdGguc3FydChiKmIgLSA0KmEqYyApKSAvICgyKmEpO1xyXG5cdCAgICB2YXIgaXgyID0geDEgKyBtdSooZHgpO1xyXG5cdCAgICB2YXIgaXkyID0geTEgKyBtdSooZHkpO1xyXG5cclxuXHQgICAgLy8gVGhlIGludGVyc2VjdGlvbiBwb2ludHNcclxuXHQgICAgLy9lbGxpcHNlKGl4MSwgaXkxLCAxMCwgMTApO1xyXG5cdCAgICAvL2VsbGlwc2UoaXgyLCBpeTIsIDEwLCAxMCk7XHJcblx0ICAgIFxyXG5cdCAgICB2YXIgdGVzdFg7XHJcblx0ICAgIHZhciB0ZXN0WTtcclxuXHQgICAgLy8gRmlndXJlIG91dCB3aGljaCBwb2ludCBpcyBjbG9zZXIgdG8gdGhlIGNpcmNsZVxyXG5cdCAgICBpZiAoZGlzdCh4MSwgeTEsIGN4LCBjeSkgPCBkaXN0KHgyLCB5MiwgY3gsIGN5KSkge1xyXG5cdCAgICAgIHRlc3RYID0geDI7XHJcblx0ICAgICAgdGVzdFkgPSB5MjtcclxuXHQgICAgfSBlbHNlIHtcclxuXHQgICAgICB0ZXN0WCA9IHgxO1xyXG5cdCAgICAgIHRlc3RZID0geTE7XHJcblx0ICAgIH1cclxuXHQgICAgIFxyXG5cdCAgICBpZiAoZGlzdCh0ZXN0WCwgdGVzdFksIGl4MSwgaXkxKSA8IGRpc3QoeDEsIHkxLCB4MiwgeTIpIHx8IGRpc3QodGVzdFgsIHRlc3RZLCBpeDIsIGl5MikgPCBkaXN0KHgxLCB5MSwgeDIsIHkyKSkge1xyXG5cdCAgICAgIHJldHVybiBbIFtpeDEsaXkxXSxbaXgyLGl5Ml0gXTtcclxuXHQgICAgfSBlbHNlIHtcclxuXHQgICAgICByZXR1cm4gZmFsc2U7XHJcblx0ICAgIH1cclxuXHQgIH1cclxufVxyXG5cclxuZnVuY3Rpb24gZGVjb2RlQmFzZTY0SW1hZ2UoZGF0YVN0cmluZykge1xyXG5cdCAgdmFyIG1hdGNoZXMgPSBkYXRhU3RyaW5nLm1hdGNoKC9eZGF0YTooW0EtWmEtei0rXFwvXSspO2Jhc2U2NCwoLispJC8pLFxyXG5cdCAgICByZXNwb25zZSA9IHt9O1xyXG5cdCAgaWYgKG1hdGNoZXMubGVuZ3RoICE9PSAzKSB7XHJcblx0ICAgIHJldHVybiBuZXcgRXJyb3IoJ0ludmFsaWQgaW5wdXQgc3RyaW5nJyk7XHJcblx0ICB9XHJcblx0ICByZXNwb25zZS50eXBlID0gbWF0Y2hlc1sxXTtcclxuXHQgIHJlc3BvbnNlLmRhdGEgPSBuZXcgQnVmZmVyKG1hdGNoZXNbMl0sICdiYXNlNjQnKTtcclxuXHQgIHJldHVybiByZXNwb25zZTtcclxuXHR9XHJcblxyXG4vLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5leHBvcnRzLm15VHJpbT1teVRyaW07XHJcbmV4cG9ydHMubXlUcmltQ29vcmRpbmF0ZT1teVRyaW1Db29yZGluYXRlO1xyXG5leHBvcnRzLmNsb3Nlc3RQcm9qZWN0aW9uT2ZQb2ludE9uTGluZT1jbG9zZXN0UHJvamVjdGlvbk9mUG9pbnRPbkxpbmU7XHJcbmV4cG9ydHMuY29sb3JMdW1pbmFuY2U9Y29sb3JMdW1pbmFuY2U7XHJcbmV4cG9ydHMuaW5jcmVhc2VCcmlnaHRuZXNzPWluY3JlYXNlQnJpZ2h0bmVzcztcclxuZXhwb3J0cy5jb2xvckFscGhhQXJyYXk9Y29sb3JBbHBoYUFycmF5O1xyXG5leHBvcnRzLmVzY2FwZUhUTUw9ZXNjYXBlSFRNTDtcclxuZXhwb3J0cy5mb3JtYXROdW1iZXIyPWZvcm1hdE51bWJlcjI7XHJcbmV4cG9ydHMuZm9ybWF0RGF0ZVRpbWU9Zm9ybWF0RGF0ZVRpbWU7XHJcbmV4cG9ydHMuZm9ybWF0RGF0ZVRpbWVTZWM9Zm9ybWF0RGF0ZVRpbWVTZWM7XHJcbmV4cG9ydHMuZm9ybWF0RGF0ZT1mb3JtYXREYXRlO1xyXG5leHBvcnRzLmZvcm1hdFRpbWU9Zm9ybWF0VGltZTtcclxuZXhwb3J0cy5yYWluYm93PXJhaW5ib3c7XHJcbmV4cG9ydHMubW9iaWxlQW5kVGFibGV0Q2hlY2s9bW9iaWxlQW5kVGFibGV0Q2hlY2s7XHJcbmV4cG9ydHMucmVuZGVyQXJyb3dCYXNlNjQ9cmVuZGVyQXJyb3dCYXNlNjQ7XHJcbmV4cG9ydHMucmVuZGVyRGlyZWN0aW9uQmFzZTY0PXJlbmRlckRpcmVjdGlvbkJhc2U2NDtcclxuZXhwb3J0cy5yZW5kZXJCb3hCYXNlNjQ9cmVuZGVyQm94QmFzZTY0O1xyXG5leHBvcnRzLmludGVyY2VwdE9uQ2lyY2xlPWludGVyY2VwdE9uQ2lyY2xlO1xyXG5leHBvcnRzLmRpc3RwPWRpc3RwO1xyXG5leHBvcnRzLmNpcmNsZUxpbmVJbnRlcnNlY3Q9Y2lyY2xlTGluZUludGVyc2VjdDtcclxuZXhwb3J0cy5NT0JJTEU9bW9iaWxlQW5kVGFibGV0Q2hlY2soKTtcclxuZXhwb3J0cy5XR1M4NFNQSEVSRT1uZXcgV0dTODRTcGhlcmUoNjM3ODEzNyk7XHJcbmV4cG9ydHMuZm9ybWF0VGltZVNlYz1mb3JtYXRUaW1lU2VjO1xyXG5leHBvcnRzLmRlY29kZUJhc2U2NEltYWdlPWRlY29kZUJhc2U2NEltYWdlO1xyXG5leHBvcnRzLmlzRGVmaW5lZD1pc0RlZmluZWQ7IiwiOyFmdW5jdGlvbiAoKSB7O1xudmFyIEpvb3NlID0ge31cblxuLy8gY29uZmlndXJhdGlvbiBoYXNoXG5cbkpvb3NlLkMgICAgICAgICAgICAgPSB0eXBlb2YgSk9PU0VfQ0ZHICE9ICd1bmRlZmluZWQnID8gSk9PU0VfQ0ZHIDoge31cblxuSm9vc2UuaXNfSUUgICAgICAgICA9ICdcXHYnID09ICd2J1xuSm9vc2UuaXNfTm9kZUpTICAgICA9IEJvb2xlYW4odHlwZW9mIHByb2Nlc3MgIT0gJ3VuZGVmaW5lZCcgJiYgcHJvY2Vzcy5waWQpXG5cblxuSm9vc2UudG9wICAgICAgICAgICA9IEpvb3NlLmlzX05vZGVKUyAmJiBnbG9iYWwgfHwgdGhpc1xuXG5Kb29zZS5zdHViICAgICAgICAgID0gZnVuY3Rpb24gKCkge1xuICAgIHJldHVybiBmdW5jdGlvbiAoKSB7IHRocm93IG5ldyBFcnJvcihcIk1vZHVsZXMgY2FuIG5vdCBiZSBpbnN0YW50aWF0ZWRcIikgfVxufVxuXG5cbkpvb3NlLlZFUlNJT04gICAgICAgPSAoeyAvKlBLR1ZFUlNJT04qL1ZFUlNJT04gOiAnMy41MC4wJyB9KS5WRVJTSU9OXG5cblxuaWYgKHR5cGVvZiBtb2R1bGUgIT0gJ3VuZGVmaW5lZCcpIG1vZHVsZS5leHBvcnRzID0gSm9vc2Vcbi8qaWYgKCFKb29zZS5pc19Ob2RlSlMpICovXG50aGlzLkpvb3NlID0gSm9vc2VcblxuXG4vLyBTdGF0aWMgaGVscGVycyBmb3IgQXJyYXlzXG5Kb29zZS5BID0ge1xuXG4gICAgZWFjaCA6IGZ1bmN0aW9uIChhcnJheSwgZnVuYywgc2NvcGUpIHtcbiAgICAgICAgc2NvcGUgPSBzY29wZSB8fCB0aGlzXG4gICAgICAgIFxuICAgICAgICBmb3IgKHZhciBpID0gMCwgbGVuID0gYXJyYXkubGVuZ3RoOyBpIDwgbGVuOyBpKyspIFxuICAgICAgICAgICAgaWYgKGZ1bmMuY2FsbChzY29wZSwgYXJyYXlbaV0sIGkpID09PSBmYWxzZSkgcmV0dXJuIGZhbHNlXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBlYWNoUiA6IGZ1bmN0aW9uIChhcnJheSwgZnVuYywgc2NvcGUpIHtcbiAgICAgICAgc2NvcGUgPSBzY29wZSB8fCB0aGlzXG5cbiAgICAgICAgZm9yICh2YXIgaSA9IGFycmF5Lmxlbmd0aCAtIDE7IGkgPj0gMDsgaS0tKSBcbiAgICAgICAgICAgIGlmIChmdW5jLmNhbGwoc2NvcGUsIGFycmF5W2ldLCBpKSA9PT0gZmFsc2UpIHJldHVybiBmYWxzZVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgZXhpc3RzIDogZnVuY3Rpb24gKGFycmF5LCB2YWx1ZSkge1xuICAgICAgICBmb3IgKHZhciBpID0gMCwgbGVuID0gYXJyYXkubGVuZ3RoOyBpIDwgbGVuOyBpKyspIGlmIChhcnJheVtpXSA9PSB2YWx1ZSkgcmV0dXJuIHRydWVcbiAgICAgICAgICAgIFxuICAgICAgICByZXR1cm4gZmFsc2VcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIG1hcCA6IGZ1bmN0aW9uIChhcnJheSwgZnVuYywgc2NvcGUpIHtcbiAgICAgICAgc2NvcGUgPSBzY29wZSB8fCB0aGlzXG4gICAgICAgIFxuICAgICAgICB2YXIgcmVzID0gW11cbiAgICAgICAgXG4gICAgICAgIGZvciAodmFyIGkgPSAwLCBsZW4gPSBhcnJheS5sZW5ndGg7IGkgPCBsZW47IGkrKykgXG4gICAgICAgICAgICByZXMucHVzaCggZnVuYy5jYWxsKHNjb3BlLCBhcnJheVtpXSwgaSkgKVxuICAgICAgICAgICAgXG4gICAgICAgIHJldHVybiByZXNcbiAgICB9LFxuICAgIFxuXG4gICAgZ3JlcCA6IGZ1bmN0aW9uIChhcnJheSwgZnVuYykge1xuICAgICAgICB2YXIgYSA9IFtdXG4gICAgICAgIFxuICAgICAgICBKb29zZS5BLmVhY2goYXJyYXksIGZ1bmN0aW9uICh0KSB7XG4gICAgICAgICAgICBpZiAoZnVuYyh0KSkgYS5wdXNoKHQpXG4gICAgICAgIH0pXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gYVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgcmVtb3ZlIDogZnVuY3Rpb24gKGFycmF5LCByZW1vdmVFbGUpIHtcbiAgICAgICAgdmFyIGEgPSBbXVxuICAgICAgICBcbiAgICAgICAgSm9vc2UuQS5lYWNoKGFycmF5LCBmdW5jdGlvbiAodCkge1xuICAgICAgICAgICAgaWYgKHQgIT09IHJlbW92ZUVsZSkgYS5wdXNoKHQpXG4gICAgICAgIH0pXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gYVxuICAgIH1cbiAgICBcbn1cblxuLy8gU3RhdGljIGhlbHBlcnMgZm9yIFN0cmluZ3Ncbkpvb3NlLlMgPSB7XG4gICAgXG4gICAgc2FuZVNwbGl0IDogZnVuY3Rpb24gKHN0ciwgZGVsaW1ldGVyKSB7XG4gICAgICAgIHZhciByZXMgPSAoc3RyIHx8ICcnKS5zcGxpdChkZWxpbWV0ZXIpXG4gICAgICAgIFxuICAgICAgICBpZiAocmVzLmxlbmd0aCA9PSAxICYmICFyZXNbMF0pIHJlcy5zaGlmdCgpXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gcmVzXG4gICAgfSxcbiAgICBcblxuICAgIHVwcGVyY2FzZUZpcnN0IDogZnVuY3Rpb24gKHN0cmluZykgeyBcbiAgICAgICAgcmV0dXJuIHN0cmluZy5zdWJzdHIoMCwgMSkudG9VcHBlckNhc2UoKSArIHN0cmluZy5zdWJzdHIoMSwgc3RyaW5nLmxlbmd0aCAtIDEpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBzdHJUb0NsYXNzIDogZnVuY3Rpb24gKG5hbWUsIHRvcCkge1xuICAgICAgICB2YXIgY3VycmVudCA9IHRvcCB8fCBKb29zZS50b3BcbiAgICAgICAgXG4gICAgICAgIEpvb3NlLkEuZWFjaChuYW1lLnNwbGl0KCcuJyksIGZ1bmN0aW9uIChzZWdtZW50KSB7XG4gICAgICAgICAgICBpZiAoY3VycmVudCkgXG4gICAgICAgICAgICAgICAgY3VycmVudCA9IGN1cnJlbnRbIHNlZ21lbnQgXVxuICAgICAgICAgICAgZWxzZVxuICAgICAgICAgICAgICAgIHJldHVybiBmYWxzZVxuICAgICAgICB9KVxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIGN1cnJlbnRcbiAgICB9XG59XG5cbnZhciBiYXNlRnVuYyAgICA9IGZ1bmN0aW9uICgpIHt9XG5cbi8vIFN0YXRpYyBoZWxwZXJzIGZvciBvYmplY3RzXG5Kb29zZS5PID0ge1xuXG4gICAgZWFjaCA6IGZ1bmN0aW9uIChvYmplY3QsIGZ1bmMsIHNjb3BlKSB7XG4gICAgICAgIHNjb3BlID0gc2NvcGUgfHwgdGhpc1xuICAgICAgICBcbiAgICAgICAgZm9yICh2YXIgaSBpbiBvYmplY3QpIFxuICAgICAgICAgICAgaWYgKGZ1bmMuY2FsbChzY29wZSwgb2JqZWN0W2ldLCBpKSA9PT0gZmFsc2UpIHJldHVybiBmYWxzZVxuICAgICAgICBcbiAgICAgICAgaWYgKEpvb3NlLmlzX0lFKSBcbiAgICAgICAgICAgIHJldHVybiBKb29zZS5BLmVhY2goWyAndG9TdHJpbmcnLCAnY29uc3RydWN0b3InLCAnaGFzT3duUHJvcGVydHknIF0sIGZ1bmN0aW9uIChlbCkge1xuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIGlmIChvYmplY3QuaGFzT3duUHJvcGVydHkoZWwpKSByZXR1cm4gZnVuYy5jYWxsKHNjb3BlLCBvYmplY3RbZWxdLCBlbClcbiAgICAgICAgICAgIH0pXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBlYWNoT3duIDogZnVuY3Rpb24gKG9iamVjdCwgZnVuYywgc2NvcGUpIHtcbiAgICAgICAgc2NvcGUgPSBzY29wZSB8fCB0aGlzXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gSm9vc2UuTy5lYWNoKG9iamVjdCwgZnVuY3Rpb24gKHZhbHVlLCBuYW1lKSB7XG4gICAgICAgICAgICBpZiAob2JqZWN0Lmhhc093blByb3BlcnR5KG5hbWUpKSByZXR1cm4gZnVuYy5jYWxsKHNjb3BlLCB2YWx1ZSwgbmFtZSlcbiAgICAgICAgfSwgc2NvcGUpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBjb3B5IDogZnVuY3Rpb24gKHNvdXJjZSwgdGFyZ2V0KSB7XG4gICAgICAgIHRhcmdldCA9IHRhcmdldCB8fCB7fVxuICAgICAgICBcbiAgICAgICAgSm9vc2UuTy5lYWNoKHNvdXJjZSwgZnVuY3Rpb24gKHZhbHVlLCBuYW1lKSB7IHRhcmdldFtuYW1lXSA9IHZhbHVlIH0pXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gdGFyZ2V0XG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBjb3B5T3duIDogZnVuY3Rpb24gKHNvdXJjZSwgdGFyZ2V0KSB7XG4gICAgICAgIHRhcmdldCA9IHRhcmdldCB8fCB7fVxuICAgICAgICBcbiAgICAgICAgSm9vc2UuTy5lYWNoT3duKHNvdXJjZSwgZnVuY3Rpb24gKHZhbHVlLCBuYW1lKSB7IHRhcmdldFtuYW1lXSA9IHZhbHVlIH0pXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gdGFyZ2V0XG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBnZXRNdXRhYmxlQ29weSA6IGZ1bmN0aW9uIChvYmplY3QpIHtcbiAgICAgICAgYmFzZUZ1bmMucHJvdG90eXBlID0gb2JqZWN0XG4gICAgICAgIFxuICAgICAgICByZXR1cm4gbmV3IGJhc2VGdW5jKClcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGV4dGVuZCA6IGZ1bmN0aW9uICh0YXJnZXQsIHNvdXJjZSkge1xuICAgICAgICByZXR1cm4gSm9vc2UuTy5jb3B5KHNvdXJjZSwgdGFyZ2V0KVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgaXNFbXB0eSA6IGZ1bmN0aW9uIChvYmplY3QpIHtcbiAgICAgICAgZm9yICh2YXIgaSBpbiBvYmplY3QpIGlmIChvYmplY3QuaGFzT3duUHJvcGVydHkoaSkpIHJldHVybiBmYWxzZVxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIHRydWVcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGlzSW5zdGFuY2U6IGZ1bmN0aW9uIChvYmopIHtcbiAgICAgICAgcmV0dXJuIG9iaiAmJiBvYmoubWV0YSAmJiBvYmouY29uc3RydWN0b3IgPT0gb2JqLm1ldGEuY1xuICAgIH0sXG4gICAgXG4gICAgXG4gICAgaXNDbGFzcyA6IGZ1bmN0aW9uIChvYmopIHtcbiAgICAgICAgcmV0dXJuIG9iaiAmJiBvYmoubWV0YSAmJiBvYmoubWV0YS5jID09IG9ialxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgd2FudEFycmF5IDogZnVuY3Rpb24gKG9iaikge1xuICAgICAgICBpZiAob2JqIGluc3RhbmNlb2YgQXJyYXkpIHJldHVybiBvYmpcbiAgICAgICAgXG4gICAgICAgIHJldHVybiBbIG9iaiBdXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICAvLyB0aGlzIHdhcyBhIGJ1ZyBpbiBXZWJLaXQsIHdoaWNoIGdpdmVzIHR5cGVvZiAvIC8gPT0gJ2Z1bmN0aW9uJ1xuICAgIC8vIHNob3VsZCBiZSBtb25pdG9yZWQgYW5kIHJlbW92ZWQgYXQgc29tZSBwb2ludCBpbiB0aGUgZnV0dXJlXG4gICAgaXNGdW5jdGlvbiA6IGZ1bmN0aW9uIChvYmopIHtcbiAgICAgICAgcmV0dXJuIHR5cGVvZiBvYmogPT0gJ2Z1bmN0aW9uJyAmJiBvYmouY29uc3RydWN0b3IgIT0gLyAvLmNvbnN0cnVjdG9yXG4gICAgfVxufVxuXG5cbi8vaW5pdGlhbGl6ZXJzXG5cbkpvb3NlLkkgPSB7XG4gICAgQXJyYXkgICAgICAgOiBmdW5jdGlvbiAoKSB7IHJldHVybiBbXSB9LFxuICAgIE9iamVjdCAgICAgIDogZnVuY3Rpb24gKCkgeyByZXR1cm4ge30gfSxcbiAgICBGdW5jdGlvbiAgICA6IGZ1bmN0aW9uICgpIHsgcmV0dXJuIGFyZ3VtZW50cy5jYWxsZWUgfSxcbiAgICBOb3cgICAgICAgICA6IGZ1bmN0aW9uICgpIHsgcmV0dXJuIG5ldyBEYXRlKCkgfVxufTtcbkpvb3NlLlByb3RvID0gSm9vc2Uuc3R1YigpXG5cbkpvb3NlLlByb3RvLkVtcHR5ID0gSm9vc2Uuc3R1YigpXG4gICAgXG5Kb29zZS5Qcm90by5FbXB0eS5tZXRhID0ge307XG47KGZ1bmN0aW9uICgpIHtcblxuICAgIEpvb3NlLlByb3RvLk9iamVjdCA9IEpvb3NlLnN0dWIoKVxuICAgIFxuICAgIFxuICAgIHZhciBTVVBFUiA9IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgdmFyIHNlbGYgPSBTVVBFUi5jYWxsZXJcbiAgICAgICAgXG4gICAgICAgIGlmIChzZWxmID09IFNVUEVSQVJHKSBzZWxmID0gc2VsZi5jYWxsZXJcbiAgICAgICAgXG4gICAgICAgIGlmICghc2VsZi5TVVBFUikgdGhyb3cgXCJJbnZhbGlkIGNhbGwgdG8gU1VQRVJcIlxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIHNlbGYuU1VQRVJbc2VsZi5tZXRob2ROYW1lXS5hcHBseSh0aGlzLCBhcmd1bWVudHMpXG4gICAgfVxuICAgIFxuICAgIFxuICAgIHZhciBTVVBFUkFSRyA9IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuU1VQRVIuYXBwbHkodGhpcywgYXJndW1lbnRzWzBdKVxuICAgIH1cbiAgICBcbiAgICBcbiAgICBcbiAgICBKb29zZS5Qcm90by5PYmplY3QucHJvdG90eXBlID0ge1xuICAgICAgICBcbiAgICAgICAgU1VQRVJBUkcgOiBTVVBFUkFSRyxcbiAgICAgICAgU1VQRVIgOiBTVVBFUixcbiAgICAgICAgXG4gICAgICAgIElOTkVSIDogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgdGhyb3cgXCJJbnZhbGlkIGNhbGwgdG8gSU5ORVJcIlxuICAgICAgICB9LCAgICAgICAgICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBCVUlMRCA6IGZ1bmN0aW9uIChjb25maWcpIHtcbiAgICAgICAgICAgIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID09IDEgJiYgdHlwZW9mIGNvbmZpZyA9PSAnb2JqZWN0JyAmJiBjb25maWcgfHwge31cbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBpbml0aWFsaXplOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgdG9TdHJpbmc6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHJldHVybiBcImEgXCIgKyB0aGlzLm1ldGEubmFtZVxuICAgICAgICB9XG4gICAgICAgIFxuICAgIH1cbiAgICAgICAgXG4gICAgSm9vc2UuUHJvdG8uT2JqZWN0Lm1ldGEgPSB7XG4gICAgICAgIGNvbnN0cnVjdG9yICAgICA6IEpvb3NlLlByb3RvLk9iamVjdCxcbiAgICAgICAgXG4gICAgICAgIG1ldGhvZHMgICAgICAgICA6IEpvb3NlLk8uY29weShKb29zZS5Qcm90by5PYmplY3QucHJvdG90eXBlKSxcbiAgICAgICAgYXR0cmlidXRlcyAgICAgIDoge31cbiAgICB9XG4gICAgXG4gICAgSm9vc2UuUHJvdG8uT2JqZWN0LnByb3RvdHlwZS5tZXRhID0gSm9vc2UuUHJvdG8uT2JqZWN0Lm1ldGFcblxufSkoKTtcbjsoZnVuY3Rpb24gKCkge1xuXG4gICAgSm9vc2UuUHJvdG8uQ2xhc3MgPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmluaXRpYWxpemUodGhpcy5CVUlMRC5hcHBseSh0aGlzLCBhcmd1bWVudHMpKSB8fCB0aGlzXG4gICAgfVxuICAgIFxuICAgIHZhciBib290c3RyYXAgPSB7XG4gICAgICAgIFxuICAgICAgICBWRVJTSU9OICAgICAgICAgICAgIDogbnVsbCxcbiAgICAgICAgQVVUSE9SSVRZICAgICAgICAgICA6IG51bGwsXG4gICAgICAgIFxuICAgICAgICBjb25zdHJ1Y3RvciAgICAgICAgIDogSm9vc2UuUHJvdG8uQ2xhc3MsXG4gICAgICAgIHN1cGVyQ2xhc3MgICAgICAgICAgOiBudWxsLFxuICAgICAgICBcbiAgICAgICAgbmFtZSAgICAgICAgICAgICAgICA6IG51bGwsXG4gICAgICAgIFxuICAgICAgICBhdHRyaWJ1dGVzICAgICAgICAgIDogbnVsbCxcbiAgICAgICAgbWV0aG9kcyAgICAgICAgICAgICA6IG51bGwsXG4gICAgICAgIFxuICAgICAgICBtZXRhICAgICAgICAgICAgICAgIDogbnVsbCxcbiAgICAgICAgYyAgICAgICAgICAgICAgICAgICA6IG51bGwsXG4gICAgICAgIFxuICAgICAgICBkZWZhdWx0U3VwZXJDbGFzcyAgIDogSm9vc2UuUHJvdG8uT2JqZWN0LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIEJVSUxEIDogZnVuY3Rpb24gKG5hbWUsIGV4dGVuZCkge1xuICAgICAgICAgICAgdGhpcy5uYW1lID0gbmFtZVxuICAgICAgICAgICAgXG4gICAgICAgICAgICByZXR1cm4geyBfX2V4dGVuZF9fIDogZXh0ZW5kIHx8IHt9IH1cbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBpbml0aWFsaXplOiBmdW5jdGlvbiAocHJvcHMpIHtcbiAgICAgICAgICAgIHZhciBleHRlbmQgICAgICA9IHByb3BzLl9fZXh0ZW5kX19cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpcy5WRVJTSU9OICAgID0gZXh0ZW5kLlZFUlNJT05cbiAgICAgICAgICAgIHRoaXMuQVVUSE9SSVRZICA9IGV4dGVuZC5BVVRIT1JJVFlcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgZGVsZXRlIGV4dGVuZC5WRVJTSU9OXG4gICAgICAgICAgICBkZWxldGUgZXh0ZW5kLkFVVEhPUklUWVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLmMgPSB0aGlzLmV4dHJhY3RDb25zdHJ1Y3RvcihleHRlbmQpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXMuYWRhcHRDb25zdHJ1Y3Rvcih0aGlzLmMpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmIChleHRlbmQuY29uc3RydWN0b3JPbmx5KSB7XG4gICAgICAgICAgICAgICAgZGVsZXRlIGV4dGVuZC5jb25zdHJ1Y3Rvck9ubHlcbiAgICAgICAgICAgICAgICByZXR1cm5cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpcy5jb25zdHJ1Y3QoZXh0ZW5kKVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIGNvbnN0cnVjdCA6IGZ1bmN0aW9uIChleHRlbmQpIHtcbiAgICAgICAgICAgIGlmICghdGhpcy5wcmVwYXJlUHJvcHMoZXh0ZW5kKSkgcmV0dXJuXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciBzdXBlckNsYXNzID0gdGhpcy5zdXBlckNsYXNzID0gdGhpcy5leHRyYWN0U3VwZXJDbGFzcyhleHRlbmQpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXMucHJvY2Vzc1N1cGVyQ2xhc3Moc3VwZXJDbGFzcylcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpcy5hZGFwdFByb3RvdHlwZSh0aGlzLmMucHJvdG90eXBlKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLmZpbmFsaXplKGV4dGVuZClcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBmaW5hbGl6ZSA6IGZ1bmN0aW9uIChleHRlbmQpIHtcbiAgICAgICAgICAgIHRoaXMucHJvY2Vzc1N0ZW0oZXh0ZW5kKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLmV4dGVuZChleHRlbmQpXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgLy9pZiB0aGUgZXh0ZW5zaW9uIHJldHVybnMgZmFsc2UgZnJvbSB0aGlzIG1ldGhvZCBpdCBzaG91bGQgcmUtZW50ZXIgJ2NvbnN0cnVjdCdcbiAgICAgICAgcHJlcGFyZVByb3BzIDogZnVuY3Rpb24gKGV4dGVuZCkge1xuICAgICAgICAgICAgcmV0dXJuIHRydWVcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBleHRyYWN0Q29uc3RydWN0b3IgOiBmdW5jdGlvbiAoZXh0ZW5kKSB7XG4gICAgICAgICAgICB2YXIgcmVzID0gZXh0ZW5kLmhhc093blByb3BlcnR5KCdjb25zdHJ1Y3RvcicpID8gZXh0ZW5kLmNvbnN0cnVjdG9yIDogdGhpcy5kZWZhdWx0Q29uc3RydWN0b3IoKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBkZWxldGUgZXh0ZW5kLmNvbnN0cnVjdG9yXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHJldHVybiByZXNcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBleHRyYWN0U3VwZXJDbGFzcyA6IGZ1bmN0aW9uIChleHRlbmQpIHtcbiAgICAgICAgICAgIGlmIChleHRlbmQuaGFzT3duUHJvcGVydHkoJ2lzYScpICYmICFleHRlbmQuaXNhKSB0aHJvdyBuZXcgRXJyb3IoXCJBdHRlbXB0IHRvIGluaGVyaXQgZnJvbSB1bmRlZmluZWQgc3VwZXJjbGFzcyBbXCIgKyB0aGlzLm5hbWUgKyBcIl1cIilcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdmFyIHJlcyA9IGV4dGVuZC5pc2EgfHwgdGhpcy5kZWZhdWx0U3VwZXJDbGFzc1xuICAgICAgICAgICAgXG4gICAgICAgICAgICBkZWxldGUgZXh0ZW5kLmlzYVxuICAgICAgICAgICAgXG4gICAgICAgICAgICByZXR1cm4gcmVzXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgcHJvY2Vzc1N0ZW0gOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB2YXIgc3VwZXJNZXRhICAgICAgID0gdGhpcy5zdXBlckNsYXNzLm1ldGFcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpcy5tZXRob2RzICAgICAgICA9IEpvb3NlLk8uZ2V0TXV0YWJsZUNvcHkoc3VwZXJNZXRhLm1ldGhvZHMgfHwge30pXG4gICAgICAgICAgICB0aGlzLmF0dHJpYnV0ZXMgICAgID0gSm9vc2UuTy5nZXRNdXRhYmxlQ29weShzdXBlck1ldGEuYXR0cmlidXRlcyB8fCB7fSlcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBpbml0SW5zdGFuY2UgOiBmdW5jdGlvbiAoaW5zdGFuY2UsIHByb3BzKSB7XG4gICAgICAgICAgICBKb29zZS5PLmNvcHlPd24ocHJvcHMsIGluc3RhbmNlKVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIGRlZmF1bHRDb25zdHJ1Y3RvcjogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgcmV0dXJuIGZ1bmN0aW9uIChhcmcpIHtcbiAgICAgICAgICAgICAgICB2YXIgQlVJTEQgPSB0aGlzLkJVSUxEXG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgdmFyIGFyZ3MgPSBCVUlMRCAmJiBCVUlMRC5hcHBseSh0aGlzLCBhcmd1bWVudHMpIHx8IGFyZyB8fCB7fVxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIHZhciB0aGlzTWV0YSAgICA9IHRoaXMubWV0YVxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIHRoaXNNZXRhLmluaXRJbnN0YW5jZSh0aGlzLCBhcmdzKVxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIHJldHVybiB0aGlzTWV0YS5oYXNNZXRob2QoJ2luaXRpYWxpemUnKSAmJiB0aGlzLmluaXRpYWxpemUoYXJncykgfHwgdGhpc1xuICAgICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIHByb2Nlc3NTdXBlckNsYXNzOiBmdW5jdGlvbiAoc3VwZXJDbGFzcykge1xuICAgICAgICAgICAgdmFyIHN1cGVyUHJvdG8gICAgICA9IHN1cGVyQ2xhc3MucHJvdG90eXBlXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vbm9uLUpvb3NlIHN1cGVyY2xhc3Nlc1xuICAgICAgICAgICAgaWYgKCFzdXBlckNsYXNzLm1ldGEpIHtcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICB2YXIgZXh0ZW5kID0gSm9vc2UuTy5jb3B5KHN1cGVyUHJvdG8pXG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgZXh0ZW5kLmlzYSA9IEpvb3NlLlByb3RvLkVtcHR5XG4gICAgICAgICAgICAgICAgLy8gY2xlYXIgcG90ZW50aWFsIHZhbHVlIGluIHRoZSBgZXh0ZW5kLmNvbnN0cnVjdG9yYCB0byBwcmV2ZW50IGl0IGZyb20gYmVpbmcgbW9kaWZpZWRcbiAgICAgICAgICAgICAgICBkZWxldGUgZXh0ZW5kLmNvbnN0cnVjdG9yXG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgdmFyIG1ldGEgPSBuZXcgdGhpcy5kZWZhdWx0U3VwZXJDbGFzcy5tZXRhLmNvbnN0cnVjdG9yKG51bGwsIGV4dGVuZClcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBzdXBlckNsYXNzLm1ldGEgPSBzdXBlclByb3RvLm1ldGEgPSBtZXRhXG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgbWV0YS5jID0gc3VwZXJDbGFzc1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLmMucHJvdG90eXBlICAgID0gSm9vc2UuTy5nZXRNdXRhYmxlQ29weShzdXBlclByb3RvKVxuICAgICAgICAgICAgdGhpcy5jLnN1cGVyQ2xhc3MgICA9IHN1cGVyUHJvdG9cbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBhZGFwdENvbnN0cnVjdG9yOiBmdW5jdGlvbiAoYykge1xuICAgICAgICAgICAgYy5tZXRhID0gdGhpc1xuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAoIWMuaGFzT3duUHJvcGVydHkoJ3RvU3RyaW5nJykpIGMudG9TdHJpbmcgPSBmdW5jdGlvbiAoKSB7IHJldHVybiB0aGlzLm1ldGEubmFtZSB9XG4gICAgICAgIH0sXG4gICAgXG4gICAgICAgIFxuICAgICAgICBhZGFwdFByb3RvdHlwZTogZnVuY3Rpb24gKHByb3RvKSB7XG4gICAgICAgICAgICAvL3RoaXMgd2lsbCBmaXggd2VpcmQgc2VtYW50aWMgb2YgbmF0aXZlIFwiY29uc3RydWN0b3JcIiBwcm9wZXJ0eSB0byBtb3JlIGludHVpdGl2ZSAoaWRlYSBib3Jyb3dlZCBmcm9tIEV4dClcbiAgICAgICAgICAgIHByb3RvLmNvbnN0cnVjdG9yICAgPSB0aGlzLmNcbiAgICAgICAgICAgIHByb3RvLm1ldGEgICAgICAgICAgPSB0aGlzXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgYWRkTWV0aG9kOiBmdW5jdGlvbiAobmFtZSwgZnVuYykge1xuICAgICAgICAgICAgZnVuYy5TVVBFUiA9IHRoaXMuc3VwZXJDbGFzcy5wcm90b3R5cGVcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy9jaHJvbWUgZG9uJ3QgYWxsb3cgdG8gcmVkZWZpbmUgdGhlIFwibmFtZVwiIHByb3BlcnR5XG4gICAgICAgICAgICBmdW5jLm1ldGhvZE5hbWUgPSBuYW1lXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXMubWV0aG9kc1tuYW1lXSA9IGZ1bmNcbiAgICAgICAgICAgIHRoaXMuYy5wcm90b3R5cGVbbmFtZV0gPSBmdW5jXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgYWRkQXR0cmlidXRlOiBmdW5jdGlvbiAobmFtZSwgaW5pdCkge1xuICAgICAgICAgICAgdGhpcy5hdHRyaWJ1dGVzW25hbWVdID0gaW5pdFxuICAgICAgICAgICAgdGhpcy5jLnByb3RvdHlwZVtuYW1lXSA9IGluaXRcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICByZW1vdmVNZXRob2QgOiBmdW5jdGlvbiAobmFtZSkge1xuICAgICAgICAgICAgZGVsZXRlIHRoaXMubWV0aG9kc1tuYW1lXVxuICAgICAgICAgICAgZGVsZXRlIHRoaXMuYy5wcm90b3R5cGVbbmFtZV1cbiAgICAgICAgfSxcbiAgICBcbiAgICAgICAgXG4gICAgICAgIHJlbW92ZUF0dHJpYnV0ZTogZnVuY3Rpb24gKG5hbWUpIHtcbiAgICAgICAgICAgIGRlbGV0ZSB0aGlzLmF0dHJpYnV0ZXNbbmFtZV1cbiAgICAgICAgICAgIGRlbGV0ZSB0aGlzLmMucHJvdG90eXBlW25hbWVdXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgaGFzTWV0aG9kOiBmdW5jdGlvbiAobmFtZSkgeyBcbiAgICAgICAgICAgIHJldHVybiBCb29sZWFuKHRoaXMubWV0aG9kc1tuYW1lXSlcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBoYXNBdHRyaWJ1dGU6IGZ1bmN0aW9uIChuYW1lKSB7IFxuICAgICAgICAgICAgcmV0dXJuIHRoaXMuYXR0cmlidXRlc1tuYW1lXSAhPT0gdW5kZWZpbmVkXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgIFxuICAgICAgICBoYXNPd25NZXRob2Q6IGZ1bmN0aW9uIChuYW1lKSB7IFxuICAgICAgICAgICAgcmV0dXJuIHRoaXMuaGFzTWV0aG9kKG5hbWUpICYmIHRoaXMubWV0aG9kcy5oYXNPd25Qcm9wZXJ0eShuYW1lKVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIGhhc093bkF0dHJpYnV0ZTogZnVuY3Rpb24gKG5hbWUpIHsgXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5oYXNBdHRyaWJ1dGUobmFtZSkgJiYgdGhpcy5hdHRyaWJ1dGVzLmhhc093blByb3BlcnR5KG5hbWUpXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgZXh0ZW5kIDogZnVuY3Rpb24gKHByb3BzKSB7XG4gICAgICAgICAgICBKb29zZS5PLmVhY2hPd24ocHJvcHMsIGZ1bmN0aW9uICh2YWx1ZSwgbmFtZSkge1xuICAgICAgICAgICAgICAgIGlmIChuYW1lICE9ICdtZXRhJyAmJiBuYW1lICE9ICdjb25zdHJ1Y3RvcicpIFxuICAgICAgICAgICAgICAgICAgICBpZiAoSm9vc2UuTy5pc0Z1bmN0aW9uKHZhbHVlKSAmJiAhdmFsdWUubWV0YSkgXG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmFkZE1ldGhvZChuYW1lLCB2YWx1ZSkgXG4gICAgICAgICAgICAgICAgICAgIGVsc2UgXG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmFkZEF0dHJpYnV0ZShuYW1lLCB2YWx1ZSlcbiAgICAgICAgICAgIH0sIHRoaXMpXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgc3ViQ2xhc3NPZiA6IGZ1bmN0aW9uIChjbGFzc09iamVjdCwgZXh0ZW5kKSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5zdWJDbGFzcyhleHRlbmQsIG51bGwsIGNsYXNzT2JqZWN0KVxuICAgICAgICB9LFxuICAgIFxuICAgIFxuICAgICAgICBzdWJDbGFzcyA6IGZ1bmN0aW9uIChleHRlbmQsIG5hbWUsIGNsYXNzT2JqZWN0KSB7XG4gICAgICAgICAgICBleHRlbmQgICAgICA9IGV4dGVuZCAgICAgICAgfHwge31cbiAgICAgICAgICAgIGV4dGVuZC5pc2EgID0gY2xhc3NPYmplY3QgICB8fCB0aGlzLmNcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcmV0dXJuIG5ldyB0aGlzLmNvbnN0cnVjdG9yKG5hbWUsIGV4dGVuZCkuY1xuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIGluc3RhbnRpYXRlIDogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgdmFyIGYgPSBmdW5jdGlvbiAoKSB7fVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBmLnByb3RvdHlwZSA9IHRoaXMuYy5wcm90b3R5cGVcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdmFyIG9iaiA9IG5ldyBmKClcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcmV0dXJuIHRoaXMuYy5hcHBseShvYmosIGFyZ3VtZW50cykgfHwgb2JqXG4gICAgICAgIH1cbiAgICB9XG4gICAgXG4gICAgLy9taWNybyBib290c3RyYXBpbmdcbiAgICBcbiAgICBKb29zZS5Qcm90by5DbGFzcy5wcm90b3R5cGUgPSBKb29zZS5PLmdldE11dGFibGVDb3B5KEpvb3NlLlByb3RvLk9iamVjdC5wcm90b3R5cGUpXG4gICAgXG4gICAgSm9vc2UuTy5leHRlbmQoSm9vc2UuUHJvdG8uQ2xhc3MucHJvdG90eXBlLCBib290c3RyYXApXG4gICAgXG4gICAgSm9vc2UuUHJvdG8uQ2xhc3MucHJvdG90eXBlLm1ldGEgPSBuZXcgSm9vc2UuUHJvdG8uQ2xhc3MoJ0pvb3NlLlByb3RvLkNsYXNzJywgYm9vdHN0cmFwKVxuICAgIFxuICAgIFxuICAgIFxuICAgIEpvb3NlLlByb3RvLkNsYXNzLm1ldGEuYWRkTWV0aG9kKCdpc2EnLCBmdW5jdGlvbiAoc29tZUNsYXNzKSB7XG4gICAgICAgIHZhciBmID0gZnVuY3Rpb24gKCkge31cbiAgICAgICAgXG4gICAgICAgIGYucHJvdG90eXBlID0gdGhpcy5jLnByb3RvdHlwZVxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIG5ldyBmKCkgaW5zdGFuY2VvZiBzb21lQ2xhc3NcbiAgICB9KVxufSkoKTtcbkpvb3NlLk1hbmFnZWQgPSBKb29zZS5zdHViKClcblxuSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eSA9IG5ldyBKb29zZS5Qcm90by5DbGFzcygnSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eScsIHtcbiAgICBcbiAgICBuYW1lICAgICAgICAgICAgOiBudWxsLFxuICAgIFxuICAgIGluaXQgICAgICAgICAgICA6IG51bGwsXG4gICAgdmFsdWUgICAgICAgICAgIDogbnVsbCxcbiAgICBcbiAgICBkZWZpbmVkSW4gICAgICAgOiBudWxsLFxuICAgIFxuICAgIFxuICAgIGluaXRpYWxpemUgOiBmdW5jdGlvbiAocHJvcHMpIHtcbiAgICAgICAgSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5zdXBlckNsYXNzLmluaXRpYWxpemUuY2FsbCh0aGlzLCBwcm9wcylcbiAgICAgICAgXG4gICAgICAgIHRoaXMuY29tcHV0ZVZhbHVlKClcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGNvbXB1dGVWYWx1ZSA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgdGhpcy52YWx1ZSA9IHRoaXMuaW5pdFxuICAgIH0sICAgIFxuICAgIFxuICAgIFxuICAgIC8vdGFyZ2V0Q2xhc3MgaXMgc3RpbGwgb3BlbiBhdCB0aGlzIHN0YWdlXG4gICAgcHJlQXBwbHkgOiBmdW5jdGlvbiAodGFyZ2V0Q2xhc3MpIHtcbiAgICB9LFxuICAgIFxuXG4gICAgLy90YXJnZXRDbGFzcyBpcyBhbHJlYWR5IG9wZW4gYXQgdGhpcyBzdGFnZVxuICAgIHBvc3RVbkFwcGx5IDogZnVuY3Rpb24gKHRhcmdldENsYXNzKSB7XG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBhcHBseSA6IGZ1bmN0aW9uICh0YXJnZXQpIHtcbiAgICAgICAgdGFyZ2V0W3RoaXMubmFtZV0gPSB0aGlzLnZhbHVlXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBpc0FwcGxpZWRUbyA6IGZ1bmN0aW9uICh0YXJnZXQpIHtcbiAgICAgICAgcmV0dXJuIHRhcmdldFt0aGlzLm5hbWVdID09IHRoaXMudmFsdWVcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIHVuYXBwbHkgOiBmdW5jdGlvbiAoZnJvbSkge1xuICAgICAgICBpZiAoIXRoaXMuaXNBcHBsaWVkVG8oZnJvbSkpIHRocm93IFwiVW5hcHBseSBvZiBwcm9wZXJ0eSBbXCIgKyB0aGlzLm5hbWUgKyBcIl0gZnJvbSBbXCIgKyBmcm9tICsgXCJdIGZhaWxlZFwiXG4gICAgICAgIFxuICAgICAgICBkZWxldGUgZnJvbVt0aGlzLm5hbWVdXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBjbG9uZVByb3BzIDogZnVuY3Rpb24gKCkge1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgbmFtZSAgICAgICAgOiB0aGlzLm5hbWUsIFxuICAgICAgICAgICAgaW5pdCAgICAgICAgOiB0aGlzLmluaXQsXG4gICAgICAgICAgICBkZWZpbmVkSW4gICA6IHRoaXMuZGVmaW5lZEluXG4gICAgICAgIH1cbiAgICB9LFxuXG4gICAgXG4gICAgY2xvbmUgOiBmdW5jdGlvbiAobmFtZSkge1xuICAgICAgICB2YXIgcHJvcHMgPSB0aGlzLmNsb25lUHJvcHMoKVxuICAgICAgICBcbiAgICAgICAgcHJvcHMubmFtZSA9IG5hbWUgfHwgcHJvcHMubmFtZVxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIG5ldyB0aGlzLmNvbnN0cnVjdG9yKHByb3BzKVxuICAgIH1cbiAgICBcbiAgICBcbn0pLmM7XG5Kb29zZS5NYW5hZ2VkLlByb3BlcnR5LkNvbmZsaWN0TWFya2VyID0gbmV3IEpvb3NlLlByb3RvLkNsYXNzKCdKb29zZS5NYW5hZ2VkLlByb3BlcnR5LkNvbmZsaWN0TWFya2VyJywge1xuICAgIFxuICAgIGlzYSA6IEpvb3NlLk1hbmFnZWQuUHJvcGVydHksXG5cbiAgICBhcHBseSA6IGZ1bmN0aW9uICh0YXJnZXQpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQXR0ZW1wdCB0byBhcHBseSBDb25mbGljdE1hcmtlciBbXCIgKyB0aGlzLm5hbWUgKyBcIl0gdG8gW1wiICsgdGFyZ2V0ICsgXCJdXCIpXG4gICAgfVxuICAgIFxufSkuYztcbkpvb3NlLk1hbmFnZWQuUHJvcGVydHkuUmVxdWlyZW1lbnQgPSBuZXcgSm9vc2UuUHJvdG8uQ2xhc3MoJ0pvb3NlLk1hbmFnZWQuUHJvcGVydHkuUmVxdWlyZW1lbnQnLCB7XG4gICAgXG4gICAgaXNhIDogSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eSxcblxuICAgIFxuICAgIGFwcGx5IDogZnVuY3Rpb24gKHRhcmdldCkge1xuICAgICAgICBpZiAoIXRhcmdldC5tZXRhLmhhc01ldGhvZCh0aGlzLm5hbWUpKSBcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcIlJlcXVpcmVtZW50IFtcIiArIHRoaXMubmFtZSArIFwiXSwgZGVmaW5lZCBpbiBbXCIgKyB0aGlzLmRlZmluZWRJbi5kZWZpbmVkSW4ubmFtZSArIFwiXSBpcyBub3Qgc2F0aXNmaWVkIGZvciBjbGFzcyBbXCIgKyB0YXJnZXQgKyBcIl1cIilcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIHVuYXBwbHkgOiBmdW5jdGlvbiAoZnJvbSkge1xuICAgIH1cbiAgICBcbn0pLmM7XG5Kb29zZS5NYW5hZ2VkLlByb3BlcnR5LkF0dHJpYnV0ZSA9IG5ldyBKb29zZS5Qcm90by5DbGFzcygnSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5BdHRyaWJ1dGUnLCB7XG4gICAgXG4gICAgaXNhIDogSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eSxcbiAgICBcbiAgICBzbG90ICAgICAgICAgICAgICAgIDogbnVsbCxcbiAgICBcbiAgICBcbiAgICBpbml0aWFsaXplIDogZnVuY3Rpb24gKCkge1xuICAgICAgICBKb29zZS5NYW5hZ2VkLlByb3BlcnR5LkF0dHJpYnV0ZS5zdXBlckNsYXNzLmluaXRpYWxpemUuYXBwbHkodGhpcywgYXJndW1lbnRzKVxuICAgICAgICBcbiAgICAgICAgdGhpcy5zbG90ID0gdGhpcy5uYW1lXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBhcHBseSA6IGZ1bmN0aW9uICh0YXJnZXQpIHtcbiAgICAgICAgdGFyZ2V0LnByb3RvdHlwZVsgdGhpcy5zbG90IF0gPSB0aGlzLnZhbHVlXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBpc0FwcGxpZWRUbyA6IGZ1bmN0aW9uICh0YXJnZXQpIHtcbiAgICAgICAgcmV0dXJuIHRhcmdldC5wcm90b3R5cGVbIHRoaXMuc2xvdCBdID09IHRoaXMudmFsdWVcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIHVuYXBwbHkgOiBmdW5jdGlvbiAoZnJvbSkge1xuICAgICAgICBpZiAoIXRoaXMuaXNBcHBsaWVkVG8oZnJvbSkpIHRocm93IFwiVW5hcHBseSBvZiBwcm9wZXJ0eSBbXCIgKyB0aGlzLm5hbWUgKyBcIl0gZnJvbSBbXCIgKyBmcm9tICsgXCJdIGZhaWxlZFwiXG4gICAgICAgIFxuICAgICAgICBkZWxldGUgZnJvbS5wcm90b3R5cGVbdGhpcy5zbG90XVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgY2xlYXJWYWx1ZSA6IGZ1bmN0aW9uIChpbnN0YW5jZSkge1xuICAgICAgICBkZWxldGUgaW5zdGFuY2VbIHRoaXMuc2xvdCBdXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBoYXNWYWx1ZSA6IGZ1bmN0aW9uIChpbnN0YW5jZSkge1xuICAgICAgICByZXR1cm4gaW5zdGFuY2UuaGFzT3duUHJvcGVydHkodGhpcy5zbG90KVxuICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICBnZXRSYXdWYWx1ZUZyb20gOiBmdW5jdGlvbiAoaW5zdGFuY2UpIHtcbiAgICAgICAgcmV0dXJuIGluc3RhbmNlWyB0aGlzLnNsb3QgXVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgc2V0UmF3VmFsdWVUbyA6IGZ1bmN0aW9uIChpbnN0YW5jZSwgdmFsdWUpIHtcbiAgICAgICAgaW5zdGFuY2VbIHRoaXMuc2xvdCBdID0gdmFsdWVcbiAgICAgICAgXG4gICAgICAgIHJldHVybiB0aGlzXG4gICAgfVxuICAgIFxufSkuYztcbkpvb3NlLk1hbmFnZWQuUHJvcGVydHkuTWV0aG9kTW9kaWZpZXIgPSBuZXcgSm9vc2UuUHJvdG8uQ2xhc3MoJ0pvb3NlLk1hbmFnZWQuUHJvcGVydHkuTWV0aG9kTW9kaWZpZXInLCB7XG4gICAgXG4gICAgaXNhIDogSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eSxcblxuICAgIFxuICAgIHByZXBhcmVXcmFwcGVyIDogZnVuY3Rpb24gKCkge1xuICAgICAgICB0aHJvdyBcIkFic3RyYWN0IG1ldGhvZCBbcHJlcGFyZVdyYXBwZXJdIG9mIFwiICsgdGhpcyArIFwiIHdhcyBjYWxsZWRcIlxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgYXBwbHkgOiBmdW5jdGlvbiAodGFyZ2V0KSB7XG4gICAgICAgIHZhciBuYW1lICAgICAgICAgICAgPSB0aGlzLm5hbWVcbiAgICAgICAgdmFyIHRhcmdldFByb3RvICAgICA9IHRhcmdldC5wcm90b3R5cGVcbiAgICAgICAgdmFyIGlzT3duICAgICAgICAgICA9IHRhcmdldFByb3RvLmhhc093blByb3BlcnR5KG5hbWUpXG4gICAgICAgIHZhciBvcmlnaW5hbCAgICAgICAgPSB0YXJnZXRQcm90b1tuYW1lXVxuICAgICAgICB2YXIgc3VwZXJQcm90byAgICAgID0gdGFyZ2V0Lm1ldGEuc3VwZXJDbGFzcy5wcm90b3R5cGVcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICB2YXIgb3JpZ2luYWxDYWxsID0gaXNPd24gPyBvcmlnaW5hbCA6IGZ1bmN0aW9uICgpIHsgXG4gICAgICAgICAgICByZXR1cm4gc3VwZXJQcm90b1tuYW1lXS5hcHBseSh0aGlzLCBhcmd1bWVudHMpIFxuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICB2YXIgbWV0aG9kV3JhcHBlciA9IHRoaXMucHJlcGFyZVdyYXBwZXIoe1xuICAgICAgICAgICAgbmFtZSAgICAgICAgICAgIDogbmFtZSxcbiAgICAgICAgICAgIG1vZGlmaWVyICAgICAgICA6IHRoaXMudmFsdWUsIFxuICAgICAgICAgICAgXG4gICAgICAgICAgICBpc093biAgICAgICAgICAgOiBpc093bixcbiAgICAgICAgICAgIG9yaWdpbmFsQ2FsbCAgICA6IG9yaWdpbmFsQ2FsbCwgXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHN1cGVyUHJvdG8gICAgICA6IHN1cGVyUHJvdG8sXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRhcmdldCAgICAgICAgICA6IHRhcmdldFxuICAgICAgICB9KVxuICAgICAgICBcbiAgICAgICAgaWYgKGlzT3duKSBtZXRob2RXcmFwcGVyLl9fT1JJR0lOQUxfXyA9IG9yaWdpbmFsXG4gICAgICAgIFxuICAgICAgICBtZXRob2RXcmFwcGVyLl9fQ09OVEFJTl9fICAgPSB0aGlzLnZhbHVlXG4gICAgICAgIG1ldGhvZFdyYXBwZXIuX19NRVRIT0RfXyAgICA9IHRoaXNcbiAgICAgICAgXG4gICAgICAgIHRhcmdldFByb3RvW25hbWVdID0gbWV0aG9kV3JhcHBlclxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgaXNBcHBsaWVkVG8gOiBmdW5jdGlvbiAodGFyZ2V0KSB7XG4gICAgICAgIHZhciB0YXJnZXRDb250ID0gdGFyZ2V0LnByb3RvdHlwZVt0aGlzLm5hbWVdXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gdGFyZ2V0Q29udCAmJiB0YXJnZXRDb250Ll9fQ09OVEFJTl9fID09IHRoaXMudmFsdWVcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIHVuYXBwbHkgOiBmdW5jdGlvbiAoZnJvbSkge1xuICAgICAgICB2YXIgbmFtZSA9IHRoaXMubmFtZVxuICAgICAgICB2YXIgZnJvbVByb3RvID0gZnJvbS5wcm90b3R5cGVcbiAgICAgICAgdmFyIG9yaWdpbmFsID0gZnJvbVByb3RvW25hbWVdLl9fT1JJR0lOQUxfX1xuICAgICAgICBcbiAgICAgICAgaWYgKCF0aGlzLmlzQXBwbGllZFRvKGZyb20pKSB0aHJvdyBcIlVuYXBwbHkgb2YgbWV0aG9kIFtcIiArIG5hbWUgKyBcIl0gZnJvbSBjbGFzcyBbXCIgKyBmcm9tICsgXCJdIGZhaWxlZFwiXG4gICAgICAgIFxuICAgICAgICAvL2lmIG1vZGlmaWVyIHdhcyBhcHBsaWVkIHRvIG93biBtZXRob2QgLSByZXN0b3JlIGl0XG4gICAgICAgIGlmIChvcmlnaW5hbCkgXG4gICAgICAgICAgICBmcm9tUHJvdG9bbmFtZV0gPSBvcmlnaW5hbFxuICAgICAgICAvL290aGVyd2lzZSAtIGp1c3QgZGVsZXRlIGl0LCB0byByZXZlYWwgdGhlIGluaGVyaXRlZCBtZXRob2QgXG4gICAgICAgIGVsc2VcbiAgICAgICAgICAgIGRlbGV0ZSBmcm9tUHJvdG9bbmFtZV1cbiAgICB9XG4gICAgXG59KS5jO1xuSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5NZXRob2RNb2RpZmllci5PdmVycmlkZSA9IG5ldyBKb29zZS5Qcm90by5DbGFzcygnSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5NZXRob2RNb2RpZmllci5PdmVycmlkZScsIHtcbiAgICBcbiAgICBpc2EgOiBKb29zZS5NYW5hZ2VkLlByb3BlcnR5Lk1ldGhvZE1vZGlmaWVyLFxuXG4gICAgXG4gICAgcHJlcGFyZVdyYXBwZXIgOiBmdW5jdGlvbiAocGFyYW1zKSB7XG4gICAgICAgIFxuICAgICAgICB2YXIgbW9kaWZpZXIgICAgICAgID0gcGFyYW1zLm1vZGlmaWVyXG4gICAgICAgIHZhciBvcmlnaW5hbENhbGwgICAgPSBwYXJhbXMub3JpZ2luYWxDYWxsXG4gICAgICAgIHZhciBzdXBlclByb3RvICAgICAgPSBwYXJhbXMuc3VwZXJQcm90b1xuICAgICAgICB2YXIgc3VwZXJNZXRhQ29uc3QgID0gc3VwZXJQcm90by5tZXRhLmNvbnN0cnVjdG9yXG4gICAgICAgIFxuICAgICAgICAvL2NhbGwgdG8gSm9vc2UuUHJvdG8gbGV2ZWwsIHJlcXVpcmUgc29tZSBhZGRpdGlvbmFsIHByb2Nlc3NpbmdcbiAgICAgICAgdmFyIGlzQ2FsbFRvUHJvdG8gPSAoc3VwZXJNZXRhQ29uc3QgPT0gSm9vc2UuUHJvdG8uQ2xhc3MgfHwgc3VwZXJNZXRhQ29uc3QgPT0gSm9vc2UuUHJvdG8uT2JqZWN0KSAmJiAhKHBhcmFtcy5pc093biAmJiBvcmlnaW5hbENhbGwuSVNfT1ZFUlJJREUpIFxuICAgICAgICBcbiAgICAgICAgdmFyIG9yaWdpbmFsID0gb3JpZ2luYWxDYWxsXG4gICAgICAgIFxuICAgICAgICBpZiAoaXNDYWxsVG9Qcm90bykgb3JpZ2luYWwgPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB2YXIgYmVmb3JlU1VQRVIgPSB0aGlzLlNVUEVSXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXMuU1VQRVIgID0gc3VwZXJQcm90by5TVVBFUlxuICAgICAgICAgICAgXG4gICAgICAgICAgICB2YXIgcmVzID0gb3JpZ2luYWxDYWxsLmFwcGx5KHRoaXMsIGFyZ3VtZW50cylcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpcy5TVVBFUiA9IGJlZm9yZVNVUEVSXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHJldHVybiByZXNcbiAgICAgICAgfVxuXG4gICAgICAgIHZhciBvdmVycmlkZSA9IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdmFyIGJlZm9yZVNVUEVSID0gdGhpcy5TVVBFUlxuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLlNVUEVSICA9IG9yaWdpbmFsXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciByZXMgPSBtb2RpZmllci5hcHBseSh0aGlzLCBhcmd1bWVudHMpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXMuU1VQRVIgPSBiZWZvcmVTVVBFUlxuICAgICAgICAgICAgXG4gICAgICAgICAgICByZXR1cm4gcmVzXG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgICAgIG92ZXJyaWRlLklTX09WRVJSSURFID0gdHJ1ZVxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIG92ZXJyaWRlXG4gICAgfVxuICAgIFxuICAgIFxufSkuYztcbkpvb3NlLk1hbmFnZWQuUHJvcGVydHkuTWV0aG9kTW9kaWZpZXIuUHV0ID0gbmV3IEpvb3NlLlByb3RvLkNsYXNzKCdKb29zZS5NYW5hZ2VkLlByb3BlcnR5Lk1ldGhvZE1vZGlmaWVyLlB1dCcsIHtcbiAgICBcbiAgICBpc2EgOiBKb29zZS5NYW5hZ2VkLlByb3BlcnR5Lk1ldGhvZE1vZGlmaWVyLk92ZXJyaWRlLFxuXG5cbiAgICBwcmVwYXJlV3JhcHBlciA6IGZ1bmN0aW9uIChwYXJhbXMpIHtcbiAgICAgICAgXG4gICAgICAgIGlmIChwYXJhbXMuaXNPd24pIHRocm93IFwiTWV0aG9kIFtcIiArIHBhcmFtcy5uYW1lICsgXCJdIGlzIGFwcGx5aW5nIG92ZXIgc29tZXRoaW5nIFtcIiArIHBhcmFtcy5vcmlnaW5hbENhbGwgKyBcIl0gaW4gY2xhc3MgW1wiICsgcGFyYW1zLnRhcmdldCArIFwiXVwiXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5NZXRob2RNb2RpZmllci5QdXQuc3VwZXJDbGFzcy5wcmVwYXJlV3JhcHBlci5jYWxsKHRoaXMsIHBhcmFtcylcbiAgICB9XG4gICAgXG4gICAgXG59KS5jO1xuSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5NZXRob2RNb2RpZmllci5BZnRlciA9IG5ldyBKb29zZS5Qcm90by5DbGFzcygnSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5NZXRob2RNb2RpZmllci5BZnRlcicsIHtcbiAgICBcbiAgICBpc2EgOiBKb29zZS5NYW5hZ2VkLlByb3BlcnR5Lk1ldGhvZE1vZGlmaWVyLFxuXG4gICAgXG4gICAgcHJlcGFyZVdyYXBwZXIgOiBmdW5jdGlvbiAocGFyYW1zKSB7XG4gICAgICAgIFxuICAgICAgICB2YXIgbW9kaWZpZXIgICAgICAgID0gcGFyYW1zLm1vZGlmaWVyXG4gICAgICAgIHZhciBvcmlnaW5hbENhbGwgICAgPSBwYXJhbXMub3JpZ2luYWxDYWxsXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgdmFyIHJlcyA9IG9yaWdpbmFsQ2FsbC5hcHBseSh0aGlzLCBhcmd1bWVudHMpXG4gICAgICAgICAgICBtb2RpZmllci5hcHBseSh0aGlzLCBhcmd1bWVudHMpXG4gICAgICAgICAgICByZXR1cm4gcmVzXG4gICAgICAgIH1cbiAgICB9ICAgIFxuXG4gICAgXG59KS5jO1xuSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5NZXRob2RNb2RpZmllci5CZWZvcmUgPSBuZXcgSm9vc2UuUHJvdG8uQ2xhc3MoJ0pvb3NlLk1hbmFnZWQuUHJvcGVydHkuTWV0aG9kTW9kaWZpZXIuQmVmb3JlJywge1xuICAgIFxuICAgIGlzYSA6IEpvb3NlLk1hbmFnZWQuUHJvcGVydHkuTWV0aG9kTW9kaWZpZXIsXG5cbiAgICBcbiAgICBwcmVwYXJlV3JhcHBlciA6IGZ1bmN0aW9uIChwYXJhbXMpIHtcbiAgICAgICAgXG4gICAgICAgIHZhciBtb2RpZmllciAgICAgICAgPSBwYXJhbXMubW9kaWZpZXJcbiAgICAgICAgdmFyIG9yaWdpbmFsQ2FsbCAgICA9IHBhcmFtcy5vcmlnaW5hbENhbGxcbiAgICAgICAgXG4gICAgICAgIHJldHVybiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBtb2RpZmllci5hcHBseSh0aGlzLCBhcmd1bWVudHMpXG4gICAgICAgICAgICByZXR1cm4gb3JpZ2luYWxDYWxsLmFwcGx5KHRoaXMsIGFyZ3VtZW50cylcbiAgICAgICAgfVxuICAgIH1cbiAgICBcbn0pLmM7XG5Kb29zZS5NYW5hZ2VkLlByb3BlcnR5Lk1ldGhvZE1vZGlmaWVyLkFyb3VuZCA9IG5ldyBKb29zZS5Qcm90by5DbGFzcygnSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5NZXRob2RNb2RpZmllci5Bcm91bmQnLCB7XG4gICAgXG4gICAgaXNhIDogSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5NZXRob2RNb2RpZmllcixcblxuICAgIHByZXBhcmVXcmFwcGVyIDogZnVuY3Rpb24gKHBhcmFtcykge1xuICAgICAgICBcbiAgICAgICAgdmFyIG1vZGlmaWVyICAgICAgICA9IHBhcmFtcy5tb2RpZmllclxuICAgICAgICB2YXIgb3JpZ2luYWxDYWxsICAgID0gcGFyYW1zLm9yaWdpbmFsQ2FsbFxuICAgICAgICBcbiAgICAgICAgdmFyIG1lXG4gICAgICAgIFxuICAgICAgICB2YXIgYm91bmQgPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICByZXR1cm4gb3JpZ2luYWxDYWxsLmFwcGx5KG1lLCBhcmd1bWVudHMpXG4gICAgICAgIH1cbiAgICAgICAgICAgIFxuICAgICAgICByZXR1cm4gZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgbWUgPSB0aGlzXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciBib3VuZEFyciA9IFsgYm91bmQgXVxuICAgICAgICAgICAgYm91bmRBcnIucHVzaC5hcHBseShib3VuZEFyciwgYXJndW1lbnRzKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICByZXR1cm4gbW9kaWZpZXIuYXBwbHkodGhpcywgYm91bmRBcnIpXG4gICAgICAgIH1cbiAgICB9XG4gICAgXG59KS5jO1xuSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5NZXRob2RNb2RpZmllci5BdWdtZW50ID0gbmV3IEpvb3NlLlByb3RvLkNsYXNzKCdKb29zZS5NYW5hZ2VkLlByb3BlcnR5Lk1ldGhvZE1vZGlmaWVyLkF1Z21lbnQnLCB7XG4gICAgXG4gICAgaXNhIDogSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5NZXRob2RNb2RpZmllcixcblxuICAgIFxuICAgIHByZXBhcmVXcmFwcGVyIDogZnVuY3Rpb24gKHBhcmFtcykge1xuICAgICAgICBcbiAgICAgICAgdmFyIEFVR01FTlQgPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vcG9wdWxhdGUgY2FsbHN0YWNrIHRvIHRoZSBtb3N0IGRlZXAgbm9uLWF1Z21lbnQgbWV0aG9kXG4gICAgICAgICAgICB2YXIgY2FsbHN0YWNrID0gW11cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdmFyIHNlbGYgPSBBVUdNRU5UXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGRvIHtcbiAgICAgICAgICAgICAgICBjYWxsc3RhY2sucHVzaChzZWxmLklTX0FVR01FTlQgPyBzZWxmLl9fQ09OVEFJTl9fIDogc2VsZilcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBzZWxmID0gc2VsZi5JU19BVUdNRU5UICYmIChzZWxmLl9fT1JJR0lOQUxfXyB8fCBzZWxmLlNVUEVSW3NlbGYubWV0aG9kTmFtZV0pXG4gICAgICAgICAgICB9IHdoaWxlIChzZWxmKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vc2F2ZSBwcmV2aW91cyBJTk5FUlxuICAgICAgICAgICAgdmFyIGJlZm9yZUlOTkVSID0gdGhpcy5JTk5FUlxuICAgICAgICAgICAgXG4gICAgICAgICAgICAvL2NyZWF0ZSBuZXcgSU5ORVJcbiAgICAgICAgICAgIHRoaXMuSU5ORVIgPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgICAgdmFyIGlubmVyQ2FsbCA9IGNhbGxzdGFjay5wb3AoKVxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIHJldHVybiBpbm5lckNhbGwgPyBpbm5lckNhbGwuYXBwbHkodGhpcywgYXJndW1lbnRzKSA6IHVuZGVmaW5lZFxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgXG4gICAgICAgICAgICAvL2F1Z21lbnQgbW9kaWZpZXIgcmVzdWx0cyBpbiBoeXBvdGV0aWNhbCBJTk5FUiBjYWxsIG9mIHRoZSBzYW1lIG1ldGhvZCBpbiBzdWJjbGFzcyBcbiAgICAgICAgICAgIHZhciByZXMgPSB0aGlzLklOTkVSLmFwcGx5KHRoaXMsIGFyZ3VtZW50cylcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy9yZXN0b3JlIHByZXZpb3VzIElOTkVSIGNoYWluXG4gICAgICAgICAgICB0aGlzLklOTkVSID0gYmVmb3JlSU5ORVJcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcmV0dXJuIHJlc1xuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICBBVUdNRU5ULm1ldGhvZE5hbWUgID0gcGFyYW1zLm5hbWVcbiAgICAgICAgQVVHTUVOVC5TVVBFUiAgICAgICA9IHBhcmFtcy5zdXBlclByb3RvXG4gICAgICAgIEFVR01FTlQuSVNfQVVHTUVOVCAgPSB0cnVlXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gQVVHTUVOVFxuICAgIH1cbiAgICBcbn0pLmM7XG5Kb29zZS5NYW5hZ2VkLlByb3BlcnR5U2V0ID0gbmV3IEpvb3NlLlByb3RvLkNsYXNzKCdKb29zZS5NYW5hZ2VkLlByb3BlcnR5U2V0Jywge1xuICAgIFxuICAgIGlzYSAgICAgICAgICAgICAgICAgICAgICAgOiBKb29zZS5NYW5hZ2VkLlByb3BlcnR5LFxuXG4gICAgcHJvcGVydGllcyAgICAgICAgICAgICAgICA6IG51bGwsXG4gICAgXG4gICAgcHJvcGVydHlNZXRhQ2xhc3MgICAgICAgICA6IEpvb3NlLk1hbmFnZWQuUHJvcGVydHksXG4gICAgXG4gICAgXG4gICAgaW5pdGlhbGl6ZSA6IGZ1bmN0aW9uIChwcm9wcykge1xuICAgICAgICBKb29zZS5NYW5hZ2VkLlByb3BlcnR5U2V0LnN1cGVyQ2xhc3MuaW5pdGlhbGl6ZS5jYWxsKHRoaXMsIHByb3BzKVxuICAgICAgICBcbiAgICAgICAgLy9YWFggdGhpcyBndWFyZHMgdGhlIG1ldGEgcm9sZXMgOilcbiAgICAgICAgdGhpcy5wcm9wZXJ0aWVzID0gcHJvcHMucHJvcGVydGllcyB8fCB7fVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgYWRkUHJvcGVydHkgOiBmdW5jdGlvbiAobmFtZSwgcHJvcHMpIHtcbiAgICAgICAgdmFyIG1ldGFDbGFzcyA9IHByb3BzLm1ldGEgfHwgdGhpcy5wcm9wZXJ0eU1ldGFDbGFzc1xuICAgICAgICBkZWxldGUgcHJvcHMubWV0YVxuICAgICAgICBcbiAgICAgICAgcHJvcHMuZGVmaW5lZEluICAgICA9IHRoaXNcbiAgICAgICAgcHJvcHMubmFtZSAgICAgICAgICA9IG5hbWVcbiAgICAgICAgXG4gICAgICAgIHJldHVybiB0aGlzLnByb3BlcnRpZXNbbmFtZV0gPSBuZXcgbWV0YUNsYXNzKHByb3BzKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgYWRkUHJvcGVydHlPYmplY3QgOiBmdW5jdGlvbiAob2JqZWN0KSB7XG4gICAgICAgIHJldHVybiB0aGlzLnByb3BlcnRpZXNbb2JqZWN0Lm5hbWVdID0gb2JqZWN0XG4gICAgfSxcbiAgICBcbiAgICBcbiAgICByZW1vdmVQcm9wZXJ0eSA6IGZ1bmN0aW9uIChuYW1lKSB7XG4gICAgICAgIHZhciBwcm9wID0gdGhpcy5wcm9wZXJ0aWVzW25hbWVdXG4gICAgICAgIFxuICAgICAgICBkZWxldGUgdGhpcy5wcm9wZXJ0aWVzW25hbWVdXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gcHJvcFxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgaGF2ZVByb3BlcnR5IDogZnVuY3Rpb24gKG5hbWUpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMucHJvcGVydGllc1tuYW1lXSAhPSBudWxsXG4gICAgfSxcbiAgICBcblxuICAgIGhhdmVPd25Qcm9wZXJ0eSA6IGZ1bmN0aW9uIChuYW1lKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmhhdmVQcm9wZXJ0eShuYW1lKSAmJiB0aGlzLnByb3BlcnRpZXMuaGFzT3duUHJvcGVydHkobmFtZSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGdldFByb3BlcnR5IDogZnVuY3Rpb24gKG5hbWUpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMucHJvcGVydGllc1tuYW1lXVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgLy9pbmNsdWRlcyBpbmhlcml0ZWQgcHJvcGVydGllcyAocHJvYmFibHkgeW91IHdhbnRzICdlYWNoT3duJywgd2hpY2ggcHJvY2VzcyBvbmx5IFwib3duXCIgKGluY2x1ZGluZyBjb25zdW1lZCBmcm9tIFJvbGVzKSBwcm9wZXJ0aWVzKSBcbiAgICBlYWNoIDogZnVuY3Rpb24gKGZ1bmMsIHNjb3BlKSB7XG4gICAgICAgIEpvb3NlLk8uZWFjaCh0aGlzLnByb3BlcnRpZXMsIGZ1bmMsIHNjb3BlIHx8IHRoaXMpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBlYWNoT3duIDogZnVuY3Rpb24gKGZ1bmMsIHNjb3BlKSB7XG4gICAgICAgIEpvb3NlLk8uZWFjaE93bih0aGlzLnByb3BlcnRpZXMsIGZ1bmMsIHNjb3BlIHx8IHRoaXMpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICAvL3N5bm9ueW0gZm9yIGVhY2hcbiAgICBlYWNoQWxsIDogZnVuY3Rpb24gKGZ1bmMsIHNjb3BlKSB7XG4gICAgICAgIHRoaXMuZWFjaChmdW5jLCBzY29wZSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGNsb25lUHJvcHMgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHZhciBwcm9wcyA9IEpvb3NlLk1hbmFnZWQuUHJvcGVydHlTZXQuc3VwZXJDbGFzcy5jbG9uZVByb3BzLmNhbGwodGhpcylcbiAgICAgICAgXG4gICAgICAgIHByb3BzLnByb3BlcnR5TWV0YUNsYXNzICAgICA9IHRoaXMucHJvcGVydHlNZXRhQ2xhc3NcbiAgICAgICAgXG4gICAgICAgIHJldHVybiBwcm9wc1xuICAgIH0sXG4gICAgXG4gICAgXG4gICAgY2xvbmUgOiBmdW5jdGlvbiAobmFtZSkge1xuICAgICAgICB2YXIgY2xvbmUgPSB0aGlzLmNsZWFuQ2xvbmUobmFtZSlcbiAgICAgICAgXG4gICAgICAgIGNsb25lLnByb3BlcnRpZXMgPSBKb29zZS5PLmNvcHlPd24odGhpcy5wcm9wZXJ0aWVzKVxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIGNsb25lXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBjbGVhbkNsb25lIDogZnVuY3Rpb24gKG5hbWUpIHtcbiAgICAgICAgdmFyIHByb3BzID0gdGhpcy5jbG9uZVByb3BzKClcbiAgICAgICAgXG4gICAgICAgIHByb3BzLm5hbWUgPSBuYW1lIHx8IHByb3BzLm5hbWVcbiAgICAgICAgXG4gICAgICAgIHJldHVybiBuZXcgdGhpcy5jb25zdHJ1Y3Rvcihwcm9wcylcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGFsaWFzIDogZnVuY3Rpb24gKHdoYXQpIHtcbiAgICAgICAgdmFyIHByb3BzID0gdGhpcy5wcm9wZXJ0aWVzXG4gICAgICAgIFxuICAgICAgICBKb29zZS5PLmVhY2god2hhdCwgZnVuY3Rpb24gKGFsaWFzTmFtZSwgb3JpZ2luYWxOYW1lKSB7XG4gICAgICAgICAgICB2YXIgb3JpZ2luYWwgPSBwcm9wc1tvcmlnaW5hbE5hbWVdXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmIChvcmlnaW5hbCkgdGhpcy5hZGRQcm9wZXJ0eU9iamVjdChvcmlnaW5hbC5jbG9uZShhbGlhc05hbWUpKVxuICAgICAgICB9LCB0aGlzKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgZXhjbHVkZSA6IGZ1bmN0aW9uICh3aGF0KSB7XG4gICAgICAgIHZhciBwcm9wcyA9IHRoaXMucHJvcGVydGllc1xuICAgICAgICBcbiAgICAgICAgSm9vc2UuQS5lYWNoKHdoYXQsIGZ1bmN0aW9uIChuYW1lKSB7XG4gICAgICAgICAgICBkZWxldGUgcHJvcHNbbmFtZV1cbiAgICAgICAgfSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGJlZm9yZUNvbnN1bWVkQnkgOiBmdW5jdGlvbiAoKSB7XG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBmbGF0dGVuVG8gOiBmdW5jdGlvbiAodGFyZ2V0KSB7XG4gICAgICAgIHZhciB0YXJnZXRQcm9wcyA9IHRhcmdldC5wcm9wZXJ0aWVzXG4gICAgICAgIFxuICAgICAgICB0aGlzLmVhY2hPd24oZnVuY3Rpb24gKHByb3BlcnR5LCBuYW1lKSB7XG4gICAgICAgICAgICB2YXIgdGFyZ2V0UHJvcGVydHkgPSB0YXJnZXRQcm9wc1tuYW1lXVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAodGFyZ2V0UHJvcGVydHkgaW5zdGFuY2VvZiBKb29zZS5NYW5hZ2VkLlByb3BlcnR5LkNvbmZsaWN0TWFya2VyKSByZXR1cm5cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKCF0YXJnZXRQcm9wcy5oYXNPd25Qcm9wZXJ0eShuYW1lKSB8fCB0YXJnZXRQcm9wZXJ0eSA9PSBudWxsKSB7XG4gICAgICAgICAgICAgICAgdGFyZ2V0LmFkZFByb3BlcnR5T2JqZWN0KHByb3BlcnR5KVxuICAgICAgICAgICAgICAgIHJldHVyblxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAodGFyZ2V0UHJvcGVydHkgPT0gcHJvcGVydHkpIHJldHVyblxuICAgICAgICAgICAgXG4gICAgICAgICAgICB0YXJnZXQucmVtb3ZlUHJvcGVydHkobmFtZSlcbiAgICAgICAgICAgIHRhcmdldC5hZGRQcm9wZXJ0eShuYW1lLCB7XG4gICAgICAgICAgICAgICAgbWV0YSA6IEpvb3NlLk1hbmFnZWQuUHJvcGVydHkuQ29uZmxpY3RNYXJrZXJcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH0sIHRoaXMpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBjb21wb3NlVG8gOiBmdW5jdGlvbiAodGFyZ2V0KSB7XG4gICAgICAgIHRoaXMuZWFjaE93bihmdW5jdGlvbiAocHJvcGVydHksIG5hbWUpIHtcbiAgICAgICAgICAgIGlmICghdGFyZ2V0LmhhdmVPd25Qcm9wZXJ0eShuYW1lKSkgdGFyZ2V0LmFkZFByb3BlcnR5T2JqZWN0KHByb3BlcnR5KVxuICAgICAgICB9KVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgY29tcG9zZUZyb20gOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIGlmICghYXJndW1lbnRzLmxlbmd0aCkgcmV0dXJuXG4gICAgICAgIFxuICAgICAgICB2YXIgZmxhdHRlbmluZyA9IHRoaXMuY2xlYW5DbG9uZSgpXG4gICAgICAgIFxuICAgICAgICBKb29zZS5BLmVhY2goYXJndW1lbnRzLCBmdW5jdGlvbiAoYXJnKSB7XG4gICAgICAgICAgICB2YXIgaXNEZXNjcmlwdG9yICAgID0gIShhcmcgaW5zdGFuY2VvZiBKb29zZS5NYW5hZ2VkLlByb3BlcnR5U2V0KVxuICAgICAgICAgICAgdmFyIHByb3BTZXQgICAgICAgICA9IGlzRGVzY3JpcHRvciA/IGFyZy5wcm9wZXJ0eVNldCA6IGFyZ1xuICAgICAgICAgICAgXG4gICAgICAgICAgICBwcm9wU2V0LmJlZm9yZUNvbnN1bWVkQnkodGhpcywgZmxhdHRlbmluZylcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKGlzRGVzY3JpcHRvcikge1xuICAgICAgICAgICAgICAgIGlmIChhcmcuYWxpYXMgfHwgYXJnLmV4Y2x1ZGUpICAgcHJvcFNldCA9IHByb3BTZXQuY2xvbmUoKVxuICAgICAgICAgICAgICAgIGlmIChhcmcuYWxpYXMpICAgICAgICAgICAgICAgICAgcHJvcFNldC5hbGlhcyhhcmcuYWxpYXMpXG4gICAgICAgICAgICAgICAgaWYgKGFyZy5leGNsdWRlKSAgICAgICAgICAgICAgICBwcm9wU2V0LmV4Y2x1ZGUoYXJnLmV4Y2x1ZGUpXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHByb3BTZXQuZmxhdHRlblRvKGZsYXR0ZW5pbmcpXG4gICAgICAgIH0sIHRoaXMpXG4gICAgICAgIFxuICAgICAgICBmbGF0dGVuaW5nLmNvbXBvc2VUbyh0aGlzKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgcHJlQXBwbHkgOiBmdW5jdGlvbiAodGFyZ2V0KSB7XG4gICAgICAgIHRoaXMuZWFjaE93bihmdW5jdGlvbiAocHJvcGVydHkpIHtcbiAgICAgICAgICAgIHByb3BlcnR5LnByZUFwcGx5KHRhcmdldClcbiAgICAgICAgfSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGFwcGx5IDogZnVuY3Rpb24gKHRhcmdldCkge1xuICAgICAgICB0aGlzLmVhY2hPd24oZnVuY3Rpb24gKHByb3BlcnR5KSB7XG4gICAgICAgICAgICBwcm9wZXJ0eS5hcHBseSh0YXJnZXQpXG4gICAgICAgIH0pXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICB1bmFwcGx5IDogZnVuY3Rpb24gKGZyb20pIHtcbiAgICAgICAgdGhpcy5lYWNoT3duKGZ1bmN0aW9uIChwcm9wZXJ0eSkge1xuICAgICAgICAgICAgcHJvcGVydHkudW5hcHBseShmcm9tKVxuICAgICAgICB9KVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgcG9zdFVuQXBwbHkgOiBmdW5jdGlvbiAodGFyZ2V0KSB7XG4gICAgICAgIHRoaXMuZWFjaE93bihmdW5jdGlvbiAocHJvcGVydHkpIHtcbiAgICAgICAgICAgIHByb3BlcnR5LnBvc3RVbkFwcGx5KHRhcmdldClcbiAgICAgICAgfSlcbiAgICB9XG4gICAgXG59KS5jXG47XG52YXIgX19JRF9fID0gMVxuXG5cbkpvb3NlLk1hbmFnZWQuUHJvcGVydHlTZXQuTXV0YWJsZSA9IG5ldyBKb29zZS5Qcm90by5DbGFzcygnSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eVNldC5NdXRhYmxlJywge1xuICAgIFxuICAgIGlzYSAgICAgICAgICAgICAgICAgOiBKb29zZS5NYW5hZ2VkLlByb3BlcnR5U2V0LFxuXG4gICAgSUQgICAgICAgICAgICAgICAgICA6IG51bGwsXG4gICAgXG4gICAgZGVyaXZhdGl2ZXMgICAgICAgICA6IG51bGwsXG4gICAgXG4gICAgb3BlbmVkICAgICAgICAgICAgICA6IG51bGwsXG4gICAgXG4gICAgY29tcG9zZWRGcm9tICAgICAgICA6IG51bGwsXG4gICAgXG4gICAgXG4gICAgaW5pdGlhbGl6ZSA6IGZ1bmN0aW9uIChwcm9wcykge1xuICAgICAgICBKb29zZS5NYW5hZ2VkLlByb3BlcnR5U2V0Lk11dGFibGUuc3VwZXJDbGFzcy5pbml0aWFsaXplLmNhbGwodGhpcywgcHJvcHMpXG4gICAgICAgIFxuICAgICAgICAvL2luaXRpYWxseSBvcGVuZWRcbiAgICAgICAgdGhpcy5vcGVuZWQgICAgICAgICAgICAgPSAxXG4gICAgICAgIHRoaXMuZGVyaXZhdGl2ZXMgICAgICAgID0ge31cbiAgICAgICAgdGhpcy5JRCAgICAgICAgICAgICAgICAgPSBfX0lEX18rK1xuICAgICAgICB0aGlzLmNvbXBvc2VkRnJvbSAgICAgICA9IFtdXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBhZGRDb21wb3NlSW5mbyA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgdGhpcy5lbnN1cmVPcGVuKClcbiAgICAgICAgXG4gICAgICAgIEpvb3NlLkEuZWFjaChhcmd1bWVudHMsIGZ1bmN0aW9uIChhcmcpIHtcbiAgICAgICAgICAgIHRoaXMuY29tcG9zZWRGcm9tLnB1c2goYXJnKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB2YXIgcHJvcFNldCA9IGFyZyBpbnN0YW5jZW9mIEpvb3NlLk1hbmFnZWQuUHJvcGVydHlTZXQgPyBhcmcgOiBhcmcucHJvcGVydHlTZXRcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgIHByb3BTZXQuZGVyaXZhdGl2ZXNbdGhpcy5JRF0gPSB0aGlzXG4gICAgICAgIH0sIHRoaXMpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICByZW1vdmVDb21wb3NlSW5mbyA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgdGhpcy5lbnN1cmVPcGVuKClcbiAgICAgICAgXG4gICAgICAgIEpvb3NlLkEuZWFjaChhcmd1bWVudHMsIGZ1bmN0aW9uIChhcmcpIHtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdmFyIGkgPSAwXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHdoaWxlIChpIDwgdGhpcy5jb21wb3NlZEZyb20ubGVuZ3RoKSB7XG4gICAgICAgICAgICAgICAgdmFyIHByb3BTZXQgPSB0aGlzLmNvbXBvc2VkRnJvbVtpXVxuICAgICAgICAgICAgICAgIHByb3BTZXQgPSBwcm9wU2V0IGluc3RhbmNlb2YgSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eVNldCA/IHByb3BTZXQgOiBwcm9wU2V0LnByb3BlcnR5U2V0XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgaWYgKGFyZyA9PSBwcm9wU2V0KSB7XG4gICAgICAgICAgICAgICAgICAgIGRlbGV0ZSBwcm9wU2V0LmRlcml2YXRpdmVzW3RoaXMuSURdXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuY29tcG9zZWRGcm9tLnNwbGljZShpLCAxKVxuICAgICAgICAgICAgICAgIH0gZWxzZSBpKytcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIFxuICAgICAgICB9LCB0aGlzKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgZW5zdXJlT3BlbiA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgaWYgKCF0aGlzLm9wZW5lZCkgdGhyb3cgXCJNdXRhdGlvbiBvZiBjbG9zZWQgcHJvcGVydHkgc2V0OiBbXCIgKyB0aGlzLm5hbWUgKyBcIl1cIlxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgYWRkUHJvcGVydHkgOiBmdW5jdGlvbiAobmFtZSwgcHJvcHMpIHtcbiAgICAgICAgdGhpcy5lbnN1cmVPcGVuKClcbiAgICAgICAgXG4gICAgICAgIHJldHVybiBKb29zZS5NYW5hZ2VkLlByb3BlcnR5U2V0Lk11dGFibGUuc3VwZXJDbGFzcy5hZGRQcm9wZXJ0eS5jYWxsKHRoaXMsIG5hbWUsIHByb3BzKVxuICAgIH0sXG4gICAgXG5cbiAgICBhZGRQcm9wZXJ0eU9iamVjdCA6IGZ1bmN0aW9uIChvYmplY3QpIHtcbiAgICAgICAgdGhpcy5lbnN1cmVPcGVuKClcbiAgICAgICAgXG4gICAgICAgIHJldHVybiBKb29zZS5NYW5hZ2VkLlByb3BlcnR5U2V0Lk11dGFibGUuc3VwZXJDbGFzcy5hZGRQcm9wZXJ0eU9iamVjdC5jYWxsKHRoaXMsIG9iamVjdClcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIHJlbW92ZVByb3BlcnR5IDogZnVuY3Rpb24gKG5hbWUpIHtcbiAgICAgICAgdGhpcy5lbnN1cmVPcGVuKClcbiAgICAgICAgXG4gICAgICAgIHJldHVybiBKb29zZS5NYW5hZ2VkLlByb3BlcnR5U2V0Lk11dGFibGUuc3VwZXJDbGFzcy5yZW1vdmVQcm9wZXJ0eS5jYWxsKHRoaXMsIG5hbWUpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBjb21wb3NlRnJvbSA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgdGhpcy5lbnN1cmVPcGVuKClcbiAgICAgICAgXG4gICAgICAgIHJldHVybiBKb29zZS5NYW5hZ2VkLlByb3BlcnR5U2V0Lk11dGFibGUuc3VwZXJDbGFzcy5jb21wb3NlRnJvbS5hcHBseSh0aGlzLCB0aGlzLmNvbXBvc2VkRnJvbSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIG9wZW4gOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHRoaXMub3BlbmVkKytcbiAgICAgICAgXG4gICAgICAgIGlmICh0aGlzLm9wZW5lZCA9PSAxKSB7XG4gICAgICAgIFxuICAgICAgICAgICAgSm9vc2UuTy5lYWNoKHRoaXMuZGVyaXZhdGl2ZXMsIGZ1bmN0aW9uIChwcm9wU2V0KSB7XG4gICAgICAgICAgICAgICAgcHJvcFNldC5vcGVuKClcbiAgICAgICAgICAgIH0pXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXMuZGVDb21wb3NlKClcbiAgICAgICAgfVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgY2xvc2UgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIGlmICghdGhpcy5vcGVuZWQpIHRocm93IFwiVW5tYXRjaGVkICdjbG9zZScgb3BlcmF0aW9uIG9uIHByb3BlcnR5IHNldDogW1wiICsgdGhpcy5uYW1lICsgXCJdXCJcbiAgICAgICAgXG4gICAgICAgIGlmICh0aGlzLm9wZW5lZCA9PSAxKSB7XG4gICAgICAgICAgICB0aGlzLnJlQ29tcG9zZSgpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIEpvb3NlLk8uZWFjaCh0aGlzLmRlcml2YXRpdmVzLCBmdW5jdGlvbiAocHJvcFNldCkge1xuICAgICAgICAgICAgICAgIHByb3BTZXQuY2xvc2UoKVxuICAgICAgICAgICAgfSlcbiAgICAgICAgfVxuICAgICAgICB0aGlzLm9wZW5lZC0tXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICByZUNvbXBvc2UgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHRoaXMuY29tcG9zZUZyb20oKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgZGVDb21wb3NlIDogZnVuY3Rpb24gKCkge1xuICAgICAgICB0aGlzLmVhY2hPd24oZnVuY3Rpb24gKHByb3BlcnR5LCBuYW1lKSB7XG4gICAgICAgICAgICBpZiAocHJvcGVydHkuZGVmaW5lZEluICE9IHRoaXMpIHRoaXMucmVtb3ZlUHJvcGVydHkobmFtZSlcbiAgICAgICAgfSwgdGhpcylcbiAgICB9XG4gICAgXG59KS5jO1xuSm9vc2UuTWFuYWdlZC5TdGVtRWxlbWVudCA9IGZ1bmN0aW9uICgpIHsgdGhyb3cgXCJNb2R1bGVzIG1heSBub3QgYmUgaW5zdGFudGlhdGVkLlwiIH1cblxuSm9vc2UuTWFuYWdlZC5TdGVtRWxlbWVudC5BdHRyaWJ1dGVzID0gbmV3IEpvb3NlLlByb3RvLkNsYXNzKCdKb29zZS5NYW5hZ2VkLlN0ZW1FbGVtZW50LkF0dHJpYnV0ZXMnLCB7XG4gICAgXG4gICAgaXNhICAgICAgICAgICAgICAgICAgICAgOiBKb29zZS5NYW5hZ2VkLlByb3BlcnR5U2V0Lk11dGFibGUsXG4gICAgXG4gICAgcHJvcGVydHlNZXRhQ2xhc3MgICAgICAgOiBKb29zZS5NYW5hZ2VkLlByb3BlcnR5LkF0dHJpYnV0ZVxuICAgIFxufSkuY1xuO1xuSm9vc2UuTWFuYWdlZC5TdGVtRWxlbWVudC5NZXRob2RzID0gbmV3IEpvb3NlLlByb3RvLkNsYXNzKCdKb29zZS5NYW5hZ2VkLlN0ZW1FbGVtZW50Lk1ldGhvZHMnLCB7XG4gICAgXG4gICAgaXNhIDogSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eVNldC5NdXRhYmxlLFxuICAgIFxuICAgIHByb3BlcnR5TWV0YUNsYXNzIDogSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5NZXRob2RNb2RpZmllci5QdXQsXG5cbiAgICBcbiAgICBwcmVBcHBseSA6IGZ1bmN0aW9uICgpIHtcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIHBvc3RVbkFwcGx5IDogZnVuY3Rpb24gKCkge1xuICAgIH1cbiAgICBcbn0pLmM7XG5Kb29zZS5NYW5hZ2VkLlN0ZW1FbGVtZW50LlJlcXVpcmVtZW50cyA9IG5ldyBKb29zZS5Qcm90by5DbGFzcygnSm9vc2UuTWFuYWdlZC5TdGVtRWxlbWVudC5SZXF1aXJlbWVudHMnLCB7XG5cbiAgICBpc2EgICAgICAgICAgICAgICAgICAgICA6IEpvb3NlLk1hbmFnZWQuUHJvcGVydHlTZXQuTXV0YWJsZSxcbiAgICBcbiAgICBwcm9wZXJ0eU1ldGFDbGFzcyAgICAgICA6IEpvb3NlLk1hbmFnZWQuUHJvcGVydHkuUmVxdWlyZW1lbnQsXG4gICAgXG4gICAgXG4gICAgXG4gICAgYWxpYXMgOiBmdW5jdGlvbiAoKSB7XG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBleGNsdWRlIDogZnVuY3Rpb24gKCkge1xuICAgIH0sXG4gICAgXG4gICAgXG4gICAgZmxhdHRlblRvIDogZnVuY3Rpb24gKHRhcmdldCkge1xuICAgICAgICB0aGlzLmVhY2goZnVuY3Rpb24gKHByb3BlcnR5LCBuYW1lKSB7XG4gICAgICAgICAgICBpZiAoIXRhcmdldC5oYXZlUHJvcGVydHkobmFtZSkpIHRhcmdldC5hZGRQcm9wZXJ0eU9iamVjdChwcm9wZXJ0eSlcbiAgICAgICAgfSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGNvbXBvc2VUbyA6IGZ1bmN0aW9uICh0YXJnZXQpIHtcbiAgICAgICAgdGhpcy5mbGF0dGVuVG8odGFyZ2V0KVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgcHJlQXBwbHkgOiBmdW5jdGlvbiAoKSB7XG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBwb3N0VW5BcHBseSA6IGZ1bmN0aW9uICgpIHtcbiAgICB9XG4gICAgXG59KS5jO1xuSm9vc2UuTWFuYWdlZC5TdGVtRWxlbWVudC5NZXRob2RNb2RpZmllcnMgPSBuZXcgSm9vc2UuUHJvdG8uQ2xhc3MoJ0pvb3NlLk1hbmFnZWQuU3RlbUVsZW1lbnQuTWV0aG9kTW9kaWZpZXJzJywge1xuXG4gICAgaXNhICAgICAgICAgICAgICAgICAgICAgOiBKb29zZS5NYW5hZ2VkLlByb3BlcnR5U2V0Lk11dGFibGUsXG4gICAgXG4gICAgcHJvcGVydHlNZXRhQ2xhc3MgICAgICAgOiBudWxsLFxuICAgIFxuICAgIFxuICAgIGFkZFByb3BlcnR5IDogZnVuY3Rpb24gKG5hbWUsIHByb3BzKSB7XG4gICAgICAgIHZhciBtZXRhQ2xhc3MgPSBwcm9wcy5tZXRhXG4gICAgICAgIGRlbGV0ZSBwcm9wcy5tZXRhXG4gICAgICAgIFxuICAgICAgICBwcm9wcy5kZWZpbmVkSW4gICAgICAgICA9IHRoaXNcbiAgICAgICAgcHJvcHMubmFtZSAgICAgICAgICAgICAgPSBuYW1lXG4gICAgICAgIFxuICAgICAgICB2YXIgbW9kaWZpZXIgICAgICAgICAgICA9IG5ldyBtZXRhQ2xhc3MocHJvcHMpXG4gICAgICAgIHZhciBwcm9wZXJ0aWVzICAgICAgICAgID0gdGhpcy5wcm9wZXJ0aWVzXG4gICAgICAgIFxuICAgICAgICBpZiAoIXByb3BlcnRpZXNbbmFtZV0pIHByb3BlcnRpZXNbIG5hbWUgXSA9IFtdXG4gICAgICAgIFxuICAgICAgICBwcm9wZXJ0aWVzW25hbWVdLnB1c2gobW9kaWZpZXIpXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gbW9kaWZpZXJcbiAgICB9LFxuICAgIFxuXG4gICAgYWRkUHJvcGVydHlPYmplY3QgOiBmdW5jdGlvbiAob2JqZWN0KSB7XG4gICAgICAgIHZhciBuYW1lICAgICAgICAgICAgPSBvYmplY3QubmFtZVxuICAgICAgICB2YXIgcHJvcGVydGllcyAgICAgID0gdGhpcy5wcm9wZXJ0aWVzXG4gICAgICAgIFxuICAgICAgICBpZiAoIXByb3BlcnRpZXNbbmFtZV0pIHByb3BlcnRpZXNbbmFtZV0gPSBbXVxuICAgICAgICBcbiAgICAgICAgcHJvcGVydGllc1tuYW1lXS5wdXNoKG9iamVjdClcbiAgICAgICAgXG4gICAgICAgIHJldHVybiBvYmplY3RcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIC8vcmVtb3ZlIG9ubHkgdGhlIGxhc3QgbW9kaWZpZXJcbiAgICByZW1vdmVQcm9wZXJ0eSA6IGZ1bmN0aW9uIChuYW1lKSB7XG4gICAgICAgIGlmICghdGhpcy5oYXZlUHJvcGVydHkobmFtZSkpIHJldHVybiB1bmRlZmluZWRcbiAgICAgICAgXG4gICAgICAgIHZhciBwcm9wZXJ0aWVzICAgICAgPSB0aGlzLnByb3BlcnRpZXNcbiAgICAgICAgdmFyIG1vZGlmaWVyICAgICAgICA9IHByb3BlcnRpZXNbIG5hbWUgXS5wb3AoKVxuICAgICAgICBcbiAgICAgICAgLy9pZiBhbGwgbW9kaWZpZXJzIHdlcmUgcmVtb3ZlZCAtIGNsZWFyaW5nIHRoZSBwcm9wZXJ0aWVzXG4gICAgICAgIGlmICghcHJvcGVydGllc1tuYW1lXS5sZW5ndGgpIEpvb3NlLk1hbmFnZWQuU3RlbUVsZW1lbnQuTWV0aG9kTW9kaWZpZXJzLnN1cGVyQ2xhc3MucmVtb3ZlUHJvcGVydHkuY2FsbCh0aGlzLCBuYW1lKVxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIG1vZGlmaWVyXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBhbGlhcyA6IGZ1bmN0aW9uICgpIHtcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGV4Y2x1ZGUgOiBmdW5jdGlvbiAoKSB7XG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBmbGF0dGVuVG8gOiBmdW5jdGlvbiAodGFyZ2V0KSB7XG4gICAgICAgIHZhciB0YXJnZXRQcm9wcyA9IHRhcmdldC5wcm9wZXJ0aWVzXG4gICAgICAgIFxuICAgICAgICB0aGlzLmVhY2goZnVuY3Rpb24gKG1vZGlmaWVyc0FyciwgbmFtZSkge1xuICAgICAgICAgICAgdmFyIHRhcmdldE1vZGlmaWVyc0FyciA9IHRhcmdldFByb3BzW25hbWVdXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmICh0YXJnZXRNb2RpZmllcnNBcnIgPT0gbnVsbCkgdGFyZ2V0TW9kaWZpZXJzQXJyID0gdGFyZ2V0UHJvcHNbbmFtZV0gPSBbXVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBKb29zZS5BLmVhY2gobW9kaWZpZXJzQXJyLCBmdW5jdGlvbiAobW9kaWZpZXIpIHtcbiAgICAgICAgICAgICAgICBpZiAoIUpvb3NlLkEuZXhpc3RzKHRhcmdldE1vZGlmaWVyc0FyciwgbW9kaWZpZXIpKSB0YXJnZXRNb2RpZmllcnNBcnIucHVzaChtb2RpZmllcilcbiAgICAgICAgICAgIH0pXG4gICAgICAgICAgICBcbiAgICAgICAgfSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGNvbXBvc2VUbyA6IGZ1bmN0aW9uICh0YXJnZXQpIHtcbiAgICAgICAgdGhpcy5mbGF0dGVuVG8odGFyZ2V0KVxuICAgIH0sXG5cbiAgICBcbiAgICBkZUNvbXBvc2UgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHRoaXMuZWFjaChmdW5jdGlvbiAobW9kaWZpZXJzQXJyLCBuYW1lKSB7XG4gICAgICAgICAgICB2YXIgaSA9IDBcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgd2hpbGUgKGkgPCBtb2RpZmllcnNBcnIubGVuZ3RoKSBcbiAgICAgICAgICAgICAgICBpZiAobW9kaWZpZXJzQXJyW2ldLmRlZmluZWRJbiAhPSB0aGlzKSBcbiAgICAgICAgICAgICAgICAgICAgbW9kaWZpZXJzQXJyLnNwbGljZShpLCAxKVxuICAgICAgICAgICAgICAgIGVsc2UgXG4gICAgICAgICAgICAgICAgICAgIGkrK1xuICAgICAgICB9KVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgcHJlQXBwbHkgOiBmdW5jdGlvbiAodGFyZ2V0KSB7XG4gICAgfSxcblxuICAgIFxuICAgIHBvc3RVbkFwcGx5IDogZnVuY3Rpb24gKHRhcmdldCkge1xuICAgIH0sXG4gICAgXG4gICAgXG4gICAgYXBwbHkgOiBmdW5jdGlvbiAodGFyZ2V0KSB7XG4gICAgICAgIHRoaXMuZWFjaChmdW5jdGlvbiAobW9kaWZpZXJzQXJyLCBuYW1lKSB7XG4gICAgICAgICAgICBKb29zZS5BLmVhY2gobW9kaWZpZXJzQXJyLCBmdW5jdGlvbiAobW9kaWZpZXIpIHtcbiAgICAgICAgICAgICAgICBtb2RpZmllci5hcHBseSh0YXJnZXQpXG4gICAgICAgICAgICB9KVxuICAgICAgICB9KVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgdW5hcHBseSA6IGZ1bmN0aW9uIChmcm9tKSB7XG4gICAgICAgIHRoaXMuZWFjaChmdW5jdGlvbiAobW9kaWZpZXJzQXJyLCBuYW1lKSB7XG4gICAgICAgICAgICBmb3IgKHZhciBpID0gbW9kaWZpZXJzQXJyLmxlbmd0aCAtIDE7IGkgPj0wIDsgaS0tKSBtb2RpZmllcnNBcnJbaV0udW5hcHBseShmcm9tKVxuICAgICAgICB9KVxuICAgIH1cbiAgICBcbiAgICBcbiAgICBcbn0pLmM7XG5Kb29zZS5NYW5hZ2VkLlByb3BlcnR5U2V0LkNvbXBvc2l0aW9uID0gbmV3IEpvb3NlLlByb3RvLkNsYXNzKCdKb29zZS5NYW5hZ2VkLlByb3BlcnR5U2V0LkNvbXBvc2l0aW9uJywge1xuICAgIFxuICAgIGlzYSAgICAgICAgICAgICAgICAgICAgICAgICA6IEpvb3NlLk1hbmFnZWQuUHJvcGVydHlTZXQuTXV0YWJsZSxcbiAgICBcbiAgICBwcm9wZXJ0eU1ldGFDbGFzcyAgICAgICAgICAgOiBKb29zZS5NYW5hZ2VkLlByb3BlcnR5U2V0Lk11dGFibGUsXG4gICAgXG4gICAgcHJvY2Vzc09yZGVyICAgICAgICAgICAgICAgIDogbnVsbCxcblxuICAgIFxuICAgIGVhY2ggOiBmdW5jdGlvbiAoZnVuYywgc2NvcGUpIHtcbiAgICAgICAgdmFyIHByb3BzICAgPSB0aGlzLnByb3BlcnRpZXNcbiAgICAgICAgdmFyIHNjb3BlICAgPSBzY29wZSB8fCB0aGlzXG4gICAgICAgIFxuICAgICAgICBKb29zZS5BLmVhY2godGhpcy5wcm9jZXNzT3JkZXIsIGZ1bmN0aW9uIChuYW1lKSB7XG4gICAgICAgICAgICBmdW5jLmNhbGwoc2NvcGUsIHByb3BzW25hbWVdLCBuYW1lKVxuICAgICAgICB9KVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgZWFjaFIgOiBmdW5jdGlvbiAoZnVuYywgc2NvcGUpIHtcbiAgICAgICAgdmFyIHByb3BzICAgPSB0aGlzLnByb3BlcnRpZXNcbiAgICAgICAgdmFyIHNjb3BlICAgPSBzY29wZSB8fCB0aGlzXG4gICAgICAgIFxuICAgICAgICBKb29zZS5BLmVhY2hSKHRoaXMucHJvY2Vzc09yZGVyLCBmdW5jdGlvbiAobmFtZSkge1xuICAgICAgICAgICAgZnVuYy5jYWxsKHNjb3BlLCBwcm9wc1tuYW1lXSwgbmFtZSlcbiAgICAgICAgfSlcbiAgICAgICAgXG4gICAgICAgIFxuLy8gICAgICAgIHZhciBwcm9wcyAgICAgICAgICAgPSB0aGlzLnByb3BlcnRpZXNcbi8vICAgICAgICB2YXIgcHJvY2Vzc09yZGVyICAgID0gdGhpcy5wcm9jZXNzT3JkZXJcbi8vICAgICAgICBcbi8vICAgICAgICBmb3IodmFyIGkgPSBwcm9jZXNzT3JkZXIubGVuZ3RoIC0gMTsgaSA+PSAwOyBpLS0pIFxuLy8gICAgICAgICAgICBmdW5jLmNhbGwoc2NvcGUgfHwgdGhpcywgcHJvcHNbIHByb2Nlc3NPcmRlcltpXSBdLCBwcm9jZXNzT3JkZXJbaV0pXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBjbG9uZSA6IGZ1bmN0aW9uIChuYW1lKSB7XG4gICAgICAgIHZhciBjbG9uZSA9IHRoaXMuY2xlYW5DbG9uZShuYW1lKVxuICAgICAgICBcbiAgICAgICAgdGhpcy5lYWNoKGZ1bmN0aW9uIChwcm9wZXJ0eSkge1xuICAgICAgICAgICAgY2xvbmUuYWRkUHJvcGVydHlPYmplY3QocHJvcGVydHkuY2xvbmUoKSlcbiAgICAgICAgfSlcbiAgICAgICAgXG4gICAgICAgIHJldHVybiBjbG9uZVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgYWxpYXMgOiBmdW5jdGlvbiAod2hhdCkge1xuICAgICAgICB0aGlzLmVhY2goZnVuY3Rpb24gKHByb3BlcnR5KSB7XG4gICAgICAgICAgICBwcm9wZXJ0eS5hbGlhcyh3aGF0KVxuICAgICAgICB9KVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgZXhjbHVkZSA6IGZ1bmN0aW9uICh3aGF0KSB7XG4gICAgICAgIHRoaXMuZWFjaChmdW5jdGlvbiAocHJvcGVydHkpIHtcbiAgICAgICAgICAgIHByb3BlcnR5LmV4Y2x1ZGUod2hhdClcbiAgICAgICAgfSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGZsYXR0ZW5UbyA6IGZ1bmN0aW9uICh0YXJnZXQpIHtcbiAgICAgICAgdmFyIHRhcmdldFByb3BzID0gdGFyZ2V0LnByb3BlcnRpZXNcbiAgICAgICAgXG4gICAgICAgIHRoaXMuZWFjaChmdW5jdGlvbiAocHJvcGVydHksIG5hbWUpIHtcbiAgICAgICAgICAgIHZhciBzdWJUYXJnZXQgPSB0YXJnZXRQcm9wc1tuYW1lXSB8fCB0YXJnZXQuYWRkUHJvcGVydHkobmFtZSwge1xuICAgICAgICAgICAgICAgIG1ldGEgOiBwcm9wZXJ0eS5jb25zdHJ1Y3RvclxuICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcHJvcGVydHkuZmxhdHRlblRvKHN1YlRhcmdldClcbiAgICAgICAgfSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGNvbXBvc2VUbyA6IGZ1bmN0aW9uICh0YXJnZXQpIHtcbiAgICAgICAgdmFyIHRhcmdldFByb3BzID0gdGFyZ2V0LnByb3BlcnRpZXNcbiAgICAgICAgXG4gICAgICAgIHRoaXMuZWFjaChmdW5jdGlvbiAocHJvcGVydHksIG5hbWUpIHtcbiAgICAgICAgICAgIHZhciBzdWJUYXJnZXQgPSB0YXJnZXRQcm9wc1tuYW1lXSB8fCB0YXJnZXQuYWRkUHJvcGVydHkobmFtZSwge1xuICAgICAgICAgICAgICAgIG1ldGEgOiBwcm9wZXJ0eS5jb25zdHJ1Y3RvclxuICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcHJvcGVydHkuY29tcG9zZVRvKHN1YlRhcmdldClcbiAgICAgICAgfSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIFxuICAgIGRlQ29tcG9zZSA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgdGhpcy5lYWNoUihmdW5jdGlvbiAocHJvcGVydHkpIHtcbiAgICAgICAgICAgIHByb3BlcnR5Lm9wZW4oKVxuICAgICAgICB9KVxuICAgICAgICBcbiAgICAgICAgSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eVNldC5Db21wb3NpdGlvbi5zdXBlckNsYXNzLmRlQ29tcG9zZS5jYWxsKHRoaXMpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICByZUNvbXBvc2UgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIEpvb3NlLk1hbmFnZWQuUHJvcGVydHlTZXQuQ29tcG9zaXRpb24uc3VwZXJDbGFzcy5yZUNvbXBvc2UuY2FsbCh0aGlzKVxuICAgICAgICBcbiAgICAgICAgdGhpcy5lYWNoKGZ1bmN0aW9uIChwcm9wZXJ0eSkge1xuICAgICAgICAgICAgcHJvcGVydHkuY2xvc2UoKVxuICAgICAgICB9KVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgdW5hcHBseSA6IGZ1bmN0aW9uIChmcm9tKSB7XG4gICAgICAgIHRoaXMuZWFjaFIoZnVuY3Rpb24gKHByb3BlcnR5KSB7XG4gICAgICAgICAgICBwcm9wZXJ0eS51bmFwcGx5KGZyb20pXG4gICAgICAgIH0pXG4gICAgfVxuICAgIFxufSkuY1xuO1xuSm9vc2UuTWFuYWdlZC5TdGVtID0gbmV3IEpvb3NlLlByb3RvLkNsYXNzKCdKb29zZS5NYW5hZ2VkLlN0ZW0nLCB7XG4gICAgXG4gICAgaXNhICAgICAgICAgICAgICAgICAgOiBKb29zZS5NYW5hZ2VkLlByb3BlcnR5U2V0LkNvbXBvc2l0aW9uLFxuICAgIFxuICAgIHRhcmdldE1ldGEgICAgICAgICAgIDogbnVsbCxcbiAgICBcbiAgICBhdHRyaWJ1dGVzTUMgICAgICAgICA6IEpvb3NlLk1hbmFnZWQuU3RlbUVsZW1lbnQuQXR0cmlidXRlcyxcbiAgICBtZXRob2RzTUMgICAgICAgICAgICA6IEpvb3NlLk1hbmFnZWQuU3RlbUVsZW1lbnQuTWV0aG9kcyxcbiAgICByZXF1aXJlbWVudHNNQyAgICAgICA6IEpvb3NlLk1hbmFnZWQuU3RlbUVsZW1lbnQuUmVxdWlyZW1lbnRzLFxuICAgIG1ldGhvZHNNb2RpZmllcnNNQyAgIDogSm9vc2UuTWFuYWdlZC5TdGVtRWxlbWVudC5NZXRob2RNb2RpZmllcnMsXG4gICAgXG4gICAgcHJvY2Vzc09yZGVyICAgICAgICAgOiBbICdhdHRyaWJ1dGVzJywgJ21ldGhvZHMnLCAncmVxdWlyZW1lbnRzJywgJ21ldGhvZHNNb2RpZmllcnMnIF0sXG4gICAgXG4gICAgXG4gICAgaW5pdGlhbGl6ZSA6IGZ1bmN0aW9uIChwcm9wcykge1xuICAgICAgICBKb29zZS5NYW5hZ2VkLlN0ZW0uc3VwZXJDbGFzcy5pbml0aWFsaXplLmNhbGwodGhpcywgcHJvcHMpXG4gICAgICAgIFxuICAgICAgICB2YXIgdGFyZ2V0TWV0YSA9IHRoaXMudGFyZ2V0TWV0YVxuICAgICAgICBcbiAgICAgICAgdGhpcy5hZGRQcm9wZXJ0eSgnYXR0cmlidXRlcycsIHtcbiAgICAgICAgICAgIG1ldGEgOiB0aGlzLmF0dHJpYnV0ZXNNQyxcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy9pdCBjYW4gYmUgbm8gJ3RhcmdldE1ldGEnIGluIGNsb25lc1xuICAgICAgICAgICAgcHJvcGVydGllcyA6IHRhcmdldE1ldGEgPyB0YXJnZXRNZXRhLmF0dHJpYnV0ZXMgOiB7fVxuICAgICAgICB9KVxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIHRoaXMuYWRkUHJvcGVydHkoJ21ldGhvZHMnLCB7XG4gICAgICAgICAgICBtZXRhIDogdGhpcy5tZXRob2RzTUMsXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHByb3BlcnRpZXMgOiB0YXJnZXRNZXRhID8gdGFyZ2V0TWV0YS5tZXRob2RzIDoge31cbiAgICAgICAgfSlcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICB0aGlzLmFkZFByb3BlcnR5KCdyZXF1aXJlbWVudHMnLCB7XG4gICAgICAgICAgICBtZXRhIDogdGhpcy5yZXF1aXJlbWVudHNNQ1xuICAgICAgICB9KVxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIHRoaXMuYWRkUHJvcGVydHkoJ21ldGhvZHNNb2RpZmllcnMnLCB7XG4gICAgICAgICAgICBtZXRhIDogdGhpcy5tZXRob2RzTW9kaWZpZXJzTUNcbiAgICAgICAgfSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIHJlQ29tcG9zZSA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgdmFyIGMgICAgICAgPSB0aGlzLnRhcmdldE1ldGEuY1xuICAgICAgICBcbiAgICAgICAgdGhpcy5wcmVBcHBseShjKVxuICAgICAgICBcbiAgICAgICAgSm9vc2UuTWFuYWdlZC5TdGVtLnN1cGVyQ2xhc3MucmVDb21wb3NlLmNhbGwodGhpcylcbiAgICAgICAgXG4gICAgICAgIHRoaXMuYXBwbHkoYylcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGRlQ29tcG9zZSA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgdmFyIGMgICAgICAgPSB0aGlzLnRhcmdldE1ldGEuY1xuICAgICAgICBcbiAgICAgICAgdGhpcy51bmFwcGx5KGMpXG4gICAgICAgIFxuICAgICAgICBKb29zZS5NYW5hZ2VkLlN0ZW0uc3VwZXJDbGFzcy5kZUNvbXBvc2UuY2FsbCh0aGlzKVxuICAgICAgICBcbiAgICAgICAgdGhpcy5wb3N0VW5BcHBseShjKVxuICAgIH1cbiAgICBcbiAgICBcbn0pLmNcbjtcbkpvb3NlLk1hbmFnZWQuQnVpbGRlciA9IG5ldyBKb29zZS5Qcm90by5DbGFzcygnSm9vc2UuTWFuYWdlZC5CdWlsZGVyJywge1xuICAgIFxuICAgIHRhcmdldE1ldGEgICAgICAgICAgOiBudWxsLFxuICAgIFxuICAgIFxuICAgIF9idWlsZFN0YXJ0IDogZnVuY3Rpb24gKHRhcmdldE1ldGEsIHByb3BzKSB7XG4gICAgICAgIHRhcmdldE1ldGEuc3RlbS5vcGVuKClcbiAgICAgICAgXG4gICAgICAgIEpvb3NlLkEuZWFjaChbICd0cmFpdCcsICd0cmFpdHMnLCAncmVtb3ZlVHJhaXQnLCAncmVtb3ZlVHJhaXRzJywgJ2RvZXMnLCAnZG9lc25vdCcsICdkb2VzbnQnIF0sIGZ1bmN0aW9uIChidWlsZGVyKSB7XG4gICAgICAgICAgICBpZiAocHJvcHNbYnVpbGRlcl0pIHtcbiAgICAgICAgICAgICAgICB0aGlzW2J1aWxkZXJdKHRhcmdldE1ldGEsIHByb3BzW2J1aWxkZXJdKVxuICAgICAgICAgICAgICAgIGRlbGV0ZSBwcm9wc1tidWlsZGVyXVxuICAgICAgICAgICAgfVxuICAgICAgICB9LCB0aGlzKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgX2V4dGVuZCA6IGZ1bmN0aW9uIChwcm9wcykge1xuICAgICAgICBpZiAoSm9vc2UuTy5pc0VtcHR5KHByb3BzKSkgcmV0dXJuXG4gICAgICAgIFxuICAgICAgICB2YXIgdGFyZ2V0TWV0YSA9IHRoaXMudGFyZ2V0TWV0YVxuICAgICAgICBcbiAgICAgICAgdGhpcy5fYnVpbGRTdGFydCh0YXJnZXRNZXRhLCBwcm9wcylcbiAgICAgICAgXG4gICAgICAgIEpvb3NlLk8uZWFjaE93bihwcm9wcywgZnVuY3Rpb24gKHZhbHVlLCBuYW1lKSB7XG4gICAgICAgICAgICB2YXIgaGFuZGxlciA9IHRoaXNbbmFtZV1cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKCFoYW5kbGVyKSB0aHJvdyBuZXcgRXJyb3IoXCJVbmtub3duIGJ1aWxkZXIgW1wiICsgbmFtZSArIFwiXSB3YXMgdXNlZCBkdXJpbmcgZXh0ZW5kaW5nIG9mIFtcIiArIHRhcmdldE1ldGEuYyArIFwiXVwiKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBoYW5kbGVyLmNhbGwodGhpcywgdGFyZ2V0TWV0YSwgdmFsdWUpXG4gICAgICAgIH0sIHRoaXMpXG4gICAgICAgIFxuICAgICAgICB0aGlzLl9idWlsZENvbXBsZXRlKHRhcmdldE1ldGEsIHByb3BzKVxuICAgIH0sXG4gICAgXG5cbiAgICBfYnVpbGRDb21wbGV0ZSA6IGZ1bmN0aW9uICh0YXJnZXRNZXRhLCBwcm9wcykge1xuICAgICAgICB0YXJnZXRNZXRhLnN0ZW0uY2xvc2UoKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgbWV0aG9kcyA6IGZ1bmN0aW9uICh0YXJnZXRNZXRhLCBpbmZvKSB7XG4gICAgICAgIEpvb3NlLk8uZWFjaE93bihpbmZvLCBmdW5jdGlvbiAodmFsdWUsIG5hbWUpIHtcbiAgICAgICAgICAgIHRhcmdldE1ldGEuYWRkTWV0aG9kKG5hbWUsIHZhbHVlKVxuICAgICAgICB9KVxuICAgIH0sXG4gICAgXG5cbiAgICByZW1vdmVNZXRob2RzIDogZnVuY3Rpb24gKHRhcmdldE1ldGEsIGluZm8pIHtcbiAgICAgICAgSm9vc2UuQS5lYWNoKGluZm8sIGZ1bmN0aW9uIChuYW1lKSB7XG4gICAgICAgICAgICB0YXJnZXRNZXRhLnJlbW92ZU1ldGhvZChuYW1lKVxuICAgICAgICB9KVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgaGF2ZSA6IGZ1bmN0aW9uICh0YXJnZXRNZXRhLCBpbmZvKSB7XG4gICAgICAgIEpvb3NlLk8uZWFjaE93bihpbmZvLCBmdW5jdGlvbiAodmFsdWUsIG5hbWUpIHtcbiAgICAgICAgICAgIHRhcmdldE1ldGEuYWRkQXR0cmlidXRlKG5hbWUsIHZhbHVlKVxuICAgICAgICB9KVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgaGF2ZW5vdCA6IGZ1bmN0aW9uICh0YXJnZXRNZXRhLCBpbmZvKSB7XG4gICAgICAgIEpvb3NlLkEuZWFjaChpbmZvLCBmdW5jdGlvbiAobmFtZSkge1xuICAgICAgICAgICAgdGFyZ2V0TWV0YS5yZW1vdmVBdHRyaWJ1dGUobmFtZSlcbiAgICAgICAgfSlcbiAgICB9LFxuICAgIFxuXG4gICAgaGF2ZW50IDogZnVuY3Rpb24gKHRhcmdldE1ldGEsIGluZm8pIHtcbiAgICAgICAgdGhpcy5oYXZlbm90KHRhcmdldE1ldGEsIGluZm8pXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBhZnRlciA6IGZ1bmN0aW9uICh0YXJnZXRNZXRhLCBpbmZvKSB7XG4gICAgICAgIEpvb3NlLk8uZWFjaChpbmZvLCBmdW5jdGlvbiAodmFsdWUsIG5hbWUpIHtcbiAgICAgICAgICAgIHRhcmdldE1ldGEuYWRkTWV0aG9kTW9kaWZpZXIobmFtZSwgdmFsdWUsIEpvb3NlLk1hbmFnZWQuUHJvcGVydHkuTWV0aG9kTW9kaWZpZXIuQWZ0ZXIpXG4gICAgICAgIH0pXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBiZWZvcmUgOiBmdW5jdGlvbiAodGFyZ2V0TWV0YSwgaW5mbykge1xuICAgICAgICBKb29zZS5PLmVhY2goaW5mbywgZnVuY3Rpb24gKHZhbHVlLCBuYW1lKSB7XG4gICAgICAgICAgICB0YXJnZXRNZXRhLmFkZE1ldGhvZE1vZGlmaWVyKG5hbWUsIHZhbHVlLCBKb29zZS5NYW5hZ2VkLlByb3BlcnR5Lk1ldGhvZE1vZGlmaWVyLkJlZm9yZSlcbiAgICAgICAgfSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIG92ZXJyaWRlIDogZnVuY3Rpb24gKHRhcmdldE1ldGEsIGluZm8pIHtcbiAgICAgICAgSm9vc2UuTy5lYWNoKGluZm8sIGZ1bmN0aW9uICh2YWx1ZSwgbmFtZSkge1xuICAgICAgICAgICAgdGFyZ2V0TWV0YS5hZGRNZXRob2RNb2RpZmllcihuYW1lLCB2YWx1ZSwgSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5NZXRob2RNb2RpZmllci5PdmVycmlkZSlcbiAgICAgICAgfSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGFyb3VuZCA6IGZ1bmN0aW9uICh0YXJnZXRNZXRhLCBpbmZvKSB7XG4gICAgICAgIEpvb3NlLk8uZWFjaChpbmZvLCBmdW5jdGlvbiAodmFsdWUsIG5hbWUpIHtcbiAgICAgICAgICAgIHRhcmdldE1ldGEuYWRkTWV0aG9kTW9kaWZpZXIobmFtZSwgdmFsdWUsIEpvb3NlLk1hbmFnZWQuUHJvcGVydHkuTWV0aG9kTW9kaWZpZXIuQXJvdW5kKVxuICAgICAgICB9KVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgYXVnbWVudCA6IGZ1bmN0aW9uICh0YXJnZXRNZXRhLCBpbmZvKSB7XG4gICAgICAgIEpvb3NlLk8uZWFjaChpbmZvLCBmdW5jdGlvbiAodmFsdWUsIG5hbWUpIHtcbiAgICAgICAgICAgIHRhcmdldE1ldGEuYWRkTWV0aG9kTW9kaWZpZXIobmFtZSwgdmFsdWUsIEpvb3NlLk1hbmFnZWQuUHJvcGVydHkuTWV0aG9kTW9kaWZpZXIuQXVnbWVudClcbiAgICAgICAgfSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIHJlbW92ZU1vZGlmaWVyIDogZnVuY3Rpb24gKHRhcmdldE1ldGEsIGluZm8pIHtcbiAgICAgICAgSm9vc2UuQS5lYWNoKGluZm8sIGZ1bmN0aW9uIChuYW1lKSB7XG4gICAgICAgICAgICB0YXJnZXRNZXRhLnJlbW92ZU1ldGhvZE1vZGlmaWVyKG5hbWUpXG4gICAgICAgIH0pXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBkb2VzIDogZnVuY3Rpb24gKHRhcmdldE1ldGEsIGluZm8pIHtcbiAgICAgICAgSm9vc2UuQS5lYWNoKEpvb3NlLk8ud2FudEFycmF5KGluZm8pLCBmdW5jdGlvbiAoZGVzYykge1xuICAgICAgICAgICAgdGFyZ2V0TWV0YS5hZGRSb2xlKGRlc2MpXG4gICAgICAgIH0pXG4gICAgfSxcbiAgICBcblxuICAgIGRvZXNub3QgOiBmdW5jdGlvbiAodGFyZ2V0TWV0YSwgaW5mbykge1xuICAgICAgICBKb29zZS5BLmVhY2goSm9vc2UuTy53YW50QXJyYXkoaW5mbyksIGZ1bmN0aW9uIChkZXNjKSB7XG4gICAgICAgICAgICB0YXJnZXRNZXRhLnJlbW92ZVJvbGUoZGVzYylcbiAgICAgICAgfSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGRvZXNudCA6IGZ1bmN0aW9uICh0YXJnZXRNZXRhLCBpbmZvKSB7XG4gICAgICAgIHRoaXMuZG9lc25vdCh0YXJnZXRNZXRhLCBpbmZvKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgdHJhaXQgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHRoaXMudHJhaXRzLmFwcGx5KHRoaXMsIGFyZ3VtZW50cylcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIHRyYWl0cyA6IGZ1bmN0aW9uICh0YXJnZXRNZXRhLCBpbmZvKSB7XG4gICAgICAgIGlmICh0YXJnZXRNZXRhLmZpcnN0UGFzcykgcmV0dXJuXG4gICAgICAgIFxuICAgICAgICBpZiAoIXRhcmdldE1ldGEubWV0YS5pc0RldGFjaGVkKSB0aHJvdyBcIkNhbid0IGFwcGx5IHRyYWl0IHRvIG5vdCBkZXRhY2hlZCBjbGFzc1wiXG4gICAgICAgIFxuICAgICAgICB0YXJnZXRNZXRhLm1ldGEuZXh0ZW5kKHtcbiAgICAgICAgICAgIGRvZXMgOiBpbmZvXG4gICAgICAgIH0pXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICByZW1vdmVUcmFpdCA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgdGhpcy5yZW1vdmVUcmFpdHMuYXBwbHkodGhpcywgYXJndW1lbnRzKVxuICAgIH0sXG4gICAgIFxuICAgIFxuICAgIHJlbW92ZVRyYWl0cyA6IGZ1bmN0aW9uICh0YXJnZXRNZXRhLCBpbmZvKSB7XG4gICAgICAgIGlmICghdGFyZ2V0TWV0YS5tZXRhLmlzRGV0YWNoZWQpIHRocm93IFwiQ2FuJ3QgcmVtb3ZlIHRyYWl0IGZyb20gbm90IGRldGFjaGVkIGNsYXNzXCJcbiAgICAgICAgXG4gICAgICAgIHRhcmdldE1ldGEubWV0YS5leHRlbmQoe1xuICAgICAgICAgICAgZG9lc25vdCA6IGluZm9cbiAgICAgICAgfSlcbiAgICB9XG4gICAgXG4gICAgXG4gICAgXG59KS5jO1xuSm9vc2UuTWFuYWdlZC5DbGFzcyA9IG5ldyBKb29zZS5Qcm90by5DbGFzcygnSm9vc2UuTWFuYWdlZC5DbGFzcycsIHtcbiAgICBcbiAgICBpc2EgICAgICAgICAgICAgICAgICAgICAgICAgOiBKb29zZS5Qcm90by5DbGFzcyxcbiAgICBcbiAgICBzdGVtICAgICAgICAgICAgICAgICAgICAgICAgOiBudWxsLFxuICAgIHN0ZW1DbGFzcyAgICAgICAgICAgICAgICAgICA6IEpvb3NlLk1hbmFnZWQuU3RlbSxcbiAgICBzdGVtQ2xhc3NDcmVhdGVkICAgICAgICAgICAgOiBmYWxzZSxcbiAgICBcbiAgICBidWlsZGVyICAgICAgICAgICAgICAgICAgICAgOiBudWxsLFxuICAgIGJ1aWxkZXJDbGFzcyAgICAgICAgICAgICAgICA6IEpvb3NlLk1hbmFnZWQuQnVpbGRlcixcbiAgICBidWlsZGVyQ2xhc3NDcmVhdGVkICAgICAgICAgOiBmYWxzZSxcbiAgICBcbiAgICBpc0RldGFjaGVkICAgICAgICAgICAgICAgICAgOiBmYWxzZSxcbiAgICBmaXJzdFBhc3MgICAgICAgICAgICAgICAgICAgOiB0cnVlLFxuICAgIFxuICAgIC8vIGEgc3BlY2lhbCBpbnN0YW5jZSwgd2hpY2gsIHdoZW4gcGFzc2VkIGFzIDFzdCBhcmd1bWVudCB0byBjb25zdHJ1Y3Rvciwgc2lnbmlmaWVzIHRoYXQgY29uc3RydWN0b3Igc2hvdWxkXG4gICAgLy8gc2tpcHMgdHJhaXRzIHByb2Nlc3NpbmcgZm9yIHRoaXMgaW5zdGFuY2VcbiAgICBza2lwVHJhaXRzQW5jaG9yICAgICAgICAgICAgOiB7fSxcbiAgICBcbiAgICBcbiAgICAvL2J1aWxkIGZvciBtZXRhY2xhc3NlcyAtIGNvbGxlY3RzIHRyYWl0cyBmcm9tIHJvbGVzXG4gICAgQlVJTEQgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHZhciBzdXAgPSBKb29zZS5NYW5hZ2VkLkNsYXNzLnN1cGVyQ2xhc3MuQlVJTEQuYXBwbHkodGhpcywgYXJndW1lbnRzKVxuICAgICAgICBcbiAgICAgICAgdmFyIHByb3BzICAgPSBzdXAuX19leHRlbmRfX1xuICAgICAgICBcbiAgICAgICAgdmFyIHRyYWl0cyA9IEpvb3NlLk8ud2FudEFycmF5KHByb3BzLnRyYWl0IHx8IHByb3BzLnRyYWl0cyB8fCBbXSlcbiAgICAgICAgZGVsZXRlIHByb3BzLnRyYWl0XG4gICAgICAgIGRlbGV0ZSBwcm9wcy50cmFpdHNcbiAgICAgICAgXG4gICAgICAgIEpvb3NlLkEuZWFjaChKb29zZS5PLndhbnRBcnJheShwcm9wcy5kb2VzIHx8IFtdKSwgZnVuY3Rpb24gKGFyZykge1xuICAgICAgICAgICAgdmFyIHJvbGUgPSAoYXJnLm1ldGEgaW5zdGFuY2VvZiBKb29zZS5NYW5hZ2VkLkNsYXNzKSA/IGFyZyA6IGFyZy5yb2xlXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmIChyb2xlLm1ldGEubWV0YS5pc0RldGFjaGVkKSB0cmFpdHMucHVzaChyb2xlLm1ldGEuY29uc3RydWN0b3IpXG4gICAgICAgIH0pXG4gICAgICAgIFxuICAgICAgICBpZiAodHJhaXRzLmxlbmd0aCkgcHJvcHMudHJhaXRzID0gdHJhaXRzIFxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIHN1cFxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgaW5pdEluc3RhbmNlIDogZnVuY3Rpb24gKGluc3RhbmNlLCBwcm9wcykge1xuICAgICAgICBKb29zZS5PLmVhY2godGhpcy5hdHRyaWJ1dGVzLCBmdW5jdGlvbiAoYXR0cmlidXRlLCBuYW1lKSB7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmIChhdHRyaWJ1dGUgaW5zdGFuY2VvZiBKb29zZS5NYW5hZ2VkLkF0dHJpYnV0ZSkgXG4gICAgICAgICAgICAgICAgYXR0cmlidXRlLmluaXRGcm9tQ29uZmlnKGluc3RhbmNlLCBwcm9wcylcbiAgICAgICAgICAgIGVsc2UgXG4gICAgICAgICAgICAgICAgaWYgKHByb3BzLmhhc093blByb3BlcnR5KG5hbWUpKSBpbnN0YW5jZVtuYW1lXSA9IHByb3BzW25hbWVdXG4gICAgICAgIH0pXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICAvLyB3ZSBhcmUgdXNpbmcgdGhlIHNhbWUgY29uc3RydWN0b3IgZm9yIHVzdWFsIGFuZCBtZXRhLSBjbGFzc2VzXG4gICAgZGVmYXVsdENvbnN0cnVjdG9yOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHJldHVybiBmdW5jdGlvbiAoc2tpcFRyYWl0c0FuY2hvciwgcGFyYW1zKSB7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciB0aGlzTWV0YSAgICA9IHRoaXMubWV0YVxuICAgICAgICAgICAgdmFyIHNraXBUcmFpdHMgID0gc2tpcFRyYWl0c0FuY2hvciA9PSB0aGlzTWV0YS5za2lwVHJhaXRzQW5jaG9yXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciBCVUlMRCAgICAgICA9IHRoaXMuQlVJTERcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdmFyIHByb3BzICAgICAgID0gQlVJTEQgJiYgQlVJTEQuYXBwbHkodGhpcywgc2tpcFRyYWl0cyA/IHBhcmFtcyA6IGFyZ3VtZW50cykgfHwgKHNraXBUcmFpdHMgPyBwYXJhbXNbMF0gOiBza2lwVHJhaXRzQW5jaG9yKSB8fCB7fVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vIGVpdGhlciBsb29raW5nIGZvciB0cmFpdHMgaW4gX19leHRlbmRfXyAobWV0YS1jbGFzcykgb3IgaW4gdXN1YWwgcHJvcHMgKHVzdWFsIGNsYXNzKVxuICAgICAgICAgICAgdmFyIGV4dGVuZCAgPSBwcm9wcy5fX2V4dGVuZF9fIHx8IHByb3BzXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciB0cmFpdHMgPSBleHRlbmQudHJhaXQgfHwgZXh0ZW5kLnRyYWl0c1xuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAodHJhaXRzIHx8IGV4dGVuZC5kZXRhY2hlZCkge1xuICAgICAgICAgICAgICAgIGRlbGV0ZSBleHRlbmQudHJhaXRcbiAgICAgICAgICAgICAgICBkZWxldGUgZXh0ZW5kLnRyYWl0c1xuICAgICAgICAgICAgICAgIGRlbGV0ZSBleHRlbmQuZGV0YWNoZWRcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBpZiAoIXNraXBUcmFpdHMpIHtcbiAgICAgICAgICAgICAgICAgICAgdmFyIGNsYXNzV2l0aFRyYWl0ICA9IHRoaXNNZXRhLnN1YkNsYXNzKHsgZG9lcyA6IHRyYWl0cyB8fCBbXSB9LCB0aGlzTWV0YS5uYW1lKVxuICAgICAgICAgICAgICAgICAgICB2YXIgbWV0YSAgICAgICAgICAgID0gY2xhc3NXaXRoVHJhaXQubWV0YVxuICAgICAgICAgICAgICAgICAgICBtZXRhLmlzRGV0YWNoZWQgICAgID0gdHJ1ZVxuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIG1ldGEuaW5zdGFudGlhdGUodGhpc01ldGEuc2tpcFRyYWl0c0FuY2hvciwgYXJndW1lbnRzKVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpc01ldGEuaW5pdEluc3RhbmNlKHRoaXMsIHByb3BzKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICByZXR1cm4gdGhpc01ldGEuaGFzTWV0aG9kKCdpbml0aWFsaXplJykgJiYgdGhpcy5pbml0aWFsaXplKHByb3BzKSB8fCB0aGlzXG4gICAgICAgIH1cbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGZpbmFsaXplOiBmdW5jdGlvbiAoZXh0ZW5kKSB7XG4gICAgICAgIEpvb3NlLk1hbmFnZWQuQ2xhc3Muc3VwZXJDbGFzcy5maW5hbGl6ZS5jYWxsKHRoaXMsIGV4dGVuZClcbiAgICAgICAgXG4gICAgICAgIHRoaXMuc3RlbS5jbG9zZSgpXG4gICAgICAgIFxuICAgICAgICB0aGlzLmFmdGVyTXV0YXRlKClcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIHByb2Nlc3NTdGVtIDogZnVuY3Rpb24gKCkge1xuICAgICAgICBKb29zZS5NYW5hZ2VkLkNsYXNzLnN1cGVyQ2xhc3MucHJvY2Vzc1N0ZW0uY2FsbCh0aGlzKVxuICAgICAgICBcbiAgICAgICAgdGhpcy5idWlsZGVyICAgID0gbmV3IHRoaXMuYnVpbGRlckNsYXNzKHsgdGFyZ2V0TWV0YSA6IHRoaXMgfSlcbiAgICAgICAgdGhpcy5zdGVtICAgICAgID0gbmV3IHRoaXMuc3RlbUNsYXNzKHsgbmFtZSA6IHRoaXMubmFtZSwgdGFyZ2V0TWV0YSA6IHRoaXMgfSlcbiAgICAgICAgXG4gICAgICAgIHZhciBidWlsZGVyQ2xhc3MgPSB0aGlzLmdldENsYXNzSW5BdHRyaWJ1dGUoJ2J1aWxkZXJDbGFzcycpXG4gICAgICAgIFxuICAgICAgICBpZiAoYnVpbGRlckNsYXNzKSB7XG4gICAgICAgICAgICB0aGlzLmJ1aWxkZXJDbGFzc0NyZWF0ZWQgPSB0cnVlXG4gICAgICAgICAgICB0aGlzLmFkZEF0dHJpYnV0ZSgnYnVpbGRlckNsYXNzJywgdGhpcy5zdWJDbGFzc09mKGJ1aWxkZXJDbGFzcykpXG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICB2YXIgc3RlbUNsYXNzID0gdGhpcy5nZXRDbGFzc0luQXR0cmlidXRlKCdzdGVtQ2xhc3MnKVxuICAgICAgICBcbiAgICAgICAgaWYgKHN0ZW1DbGFzcykge1xuICAgICAgICAgICAgdGhpcy5zdGVtQ2xhc3NDcmVhdGVkID0gdHJ1ZVxuICAgICAgICAgICAgdGhpcy5hZGRBdHRyaWJ1dGUoJ3N0ZW1DbGFzcycsIHRoaXMuc3ViQ2xhc3NPZihzdGVtQ2xhc3MpKVxuICAgICAgICB9XG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBleHRlbmQgOiBmdW5jdGlvbiAocHJvcHMpIHtcbiAgICAgICAgaWYgKHByb3BzLmJ1aWxkZXIpIHtcbiAgICAgICAgICAgIHRoaXMuZ2V0QnVpbGRlclRhcmdldCgpLm1ldGEuZXh0ZW5kKHByb3BzLmJ1aWxkZXIpXG4gICAgICAgICAgICBkZWxldGUgcHJvcHMuYnVpbGRlclxuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICBpZiAocHJvcHMuc3RlbSkge1xuICAgICAgICAgICAgdGhpcy5nZXRTdGVtVGFyZ2V0KCkubWV0YS5leHRlbmQocHJvcHMuc3RlbSlcbiAgICAgICAgICAgIGRlbGV0ZSBwcm9wcy5zdGVtXG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgICAgIHRoaXMuYnVpbGRlci5fZXh0ZW5kKHByb3BzKVxuICAgICAgICBcbiAgICAgICAgdGhpcy5maXJzdFBhc3MgPSBmYWxzZVxuICAgICAgICBcbiAgICAgICAgaWYgKCF0aGlzLnN0ZW0ub3BlbmVkKSB0aGlzLmFmdGVyTXV0YXRlKClcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGdldEJ1aWxkZXJUYXJnZXQgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHZhciBidWlsZGVyQ2xhc3MgPSB0aGlzLmdldENsYXNzSW5BdHRyaWJ1dGUoJ2J1aWxkZXJDbGFzcycpXG4gICAgICAgIGlmICghYnVpbGRlckNsYXNzKSB0aHJvdyBcIkF0dGVtcHQgdG8gZXh0ZW5kIGEgYnVpbGRlciBvbiBub24tbWV0YSBjbGFzc1wiXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gYnVpbGRlckNsYXNzXG4gICAgfSxcbiAgICBcblxuICAgIGdldFN0ZW1UYXJnZXQgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHZhciBzdGVtQ2xhc3MgPSB0aGlzLmdldENsYXNzSW5BdHRyaWJ1dGUoJ3N0ZW1DbGFzcycpXG4gICAgICAgIGlmICghc3RlbUNsYXNzKSB0aHJvdyBcIkF0dGVtcHQgdG8gZXh0ZW5kIGEgc3RlbSBvbiBub24tbWV0YSBjbGFzc1wiXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gc3RlbUNsYXNzXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBnZXRDbGFzc0luQXR0cmlidXRlIDogZnVuY3Rpb24gKGF0dHJpYnV0ZU5hbWUpIHtcbiAgICAgICAgdmFyIGF0dHJDbGFzcyA9IHRoaXMuZ2V0QXR0cmlidXRlKGF0dHJpYnV0ZU5hbWUpXG4gICAgICAgIGlmIChhdHRyQ2xhc3MgaW5zdGFuY2VvZiBKb29zZS5NYW5hZ2VkLlByb3BlcnR5LkF0dHJpYnV0ZSkgYXR0ckNsYXNzID0gYXR0ckNsYXNzLnZhbHVlXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gYXR0ckNsYXNzXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBhZGRNZXRob2RNb2RpZmllcjogZnVuY3Rpb24gKG5hbWUsIGZ1bmMsIHR5cGUpIHtcbiAgICAgICAgdmFyIHByb3BzID0ge31cbiAgICAgICAgXG4gICAgICAgIHByb3BzLmluaXQgPSBmdW5jXG4gICAgICAgIHByb3BzLm1ldGEgPSB0eXBlXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gdGhpcy5zdGVtLnByb3BlcnRpZXMubWV0aG9kc01vZGlmaWVycy5hZGRQcm9wZXJ0eShuYW1lLCBwcm9wcylcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIHJlbW92ZU1ldGhvZE1vZGlmaWVyOiBmdW5jdGlvbiAobmFtZSkge1xuICAgICAgICByZXR1cm4gdGhpcy5zdGVtLnByb3BlcnRpZXMubWV0aG9kc01vZGlmaWVycy5yZW1vdmVQcm9wZXJ0eShuYW1lKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgYWRkTWV0aG9kOiBmdW5jdGlvbiAobmFtZSwgZnVuYywgcHJvcHMpIHtcbiAgICAgICAgcHJvcHMgPSBwcm9wcyB8fCB7fVxuICAgICAgICBwcm9wcy5pbml0ID0gZnVuY1xuICAgICAgICBcbiAgICAgICAgcmV0dXJuIHRoaXMuc3RlbS5wcm9wZXJ0aWVzLm1ldGhvZHMuYWRkUHJvcGVydHkobmFtZSwgcHJvcHMpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBhZGRBdHRyaWJ1dGU6IGZ1bmN0aW9uIChuYW1lLCBpbml0LCBwcm9wcykge1xuICAgICAgICBwcm9wcyA9IHByb3BzIHx8IHt9XG4gICAgICAgIHByb3BzLmluaXQgPSBpbml0XG4gICAgICAgIFxuICAgICAgICByZXR1cm4gdGhpcy5zdGVtLnByb3BlcnRpZXMuYXR0cmlidXRlcy5hZGRQcm9wZXJ0eShuYW1lLCBwcm9wcylcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIHJlbW92ZU1ldGhvZCA6IGZ1bmN0aW9uIChuYW1lKSB7XG4gICAgICAgIHJldHVybiB0aGlzLnN0ZW0ucHJvcGVydGllcy5tZXRob2RzLnJlbW92ZVByb3BlcnR5KG5hbWUpXG4gICAgfSxcblxuICAgIFxuICAgIHJlbW92ZUF0dHJpYnV0ZTogZnVuY3Rpb24gKG5hbWUpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuc3RlbS5wcm9wZXJ0aWVzLmF0dHJpYnV0ZXMucmVtb3ZlUHJvcGVydHkobmFtZSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGhhc01ldGhvZDogZnVuY3Rpb24gKG5hbWUpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuc3RlbS5wcm9wZXJ0aWVzLm1ldGhvZHMuaGF2ZVByb3BlcnR5KG5hbWUpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBoYXNBdHRyaWJ1dGU6IGZ1bmN0aW9uIChuYW1lKSB7IFxuICAgICAgICByZXR1cm4gdGhpcy5zdGVtLnByb3BlcnRpZXMuYXR0cmlidXRlcy5oYXZlUHJvcGVydHkobmFtZSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGhhc01ldGhvZE1vZGlmaWVyc0ZvciA6IGZ1bmN0aW9uIChuYW1lKSB7XG4gICAgICAgIHJldHVybiB0aGlzLnN0ZW0ucHJvcGVydGllcy5tZXRob2RzTW9kaWZpZXJzLmhhdmVQcm9wZXJ0eShuYW1lKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgaGFzT3duTWV0aG9kOiBmdW5jdGlvbiAobmFtZSkge1xuICAgICAgICByZXR1cm4gdGhpcy5zdGVtLnByb3BlcnRpZXMubWV0aG9kcy5oYXZlT3duUHJvcGVydHkobmFtZSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGhhc093bkF0dHJpYnV0ZTogZnVuY3Rpb24gKG5hbWUpIHsgXG4gICAgICAgIHJldHVybiB0aGlzLnN0ZW0ucHJvcGVydGllcy5hdHRyaWJ1dGVzLmhhdmVPd25Qcm9wZXJ0eShuYW1lKVxuICAgIH0sXG4gICAgXG5cbiAgICBnZXRNZXRob2QgOiBmdW5jdGlvbiAobmFtZSkge1xuICAgICAgICByZXR1cm4gdGhpcy5zdGVtLnByb3BlcnRpZXMubWV0aG9kcy5nZXRQcm9wZXJ0eShuYW1lKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgZ2V0QXR0cmlidXRlIDogZnVuY3Rpb24gKG5hbWUpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuc3RlbS5wcm9wZXJ0aWVzLmF0dHJpYnV0ZXMuZ2V0UHJvcGVydHkobmFtZSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGVhY2hSb2xlIDogZnVuY3Rpb24gKHJvbGVzLCBmdW5jLCBzY29wZSkge1xuICAgICAgICBKb29zZS5BLmVhY2gocm9sZXMsIGZ1bmN0aW9uIChhcmcsIGluZGV4KSB7XG4gICAgICAgICAgICB2YXIgcm9sZSA9IChhcmcubWV0YSBpbnN0YW5jZW9mIEpvb3NlLk1hbmFnZWQuQ2xhc3MpID8gYXJnIDogYXJnLnJvbGVcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgZnVuYy5jYWxsKHNjb3BlIHx8IHRoaXMsIGFyZywgcm9sZSwgaW5kZXgpXG4gICAgICAgIH0sIHRoaXMpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBhZGRSb2xlIDogZnVuY3Rpb24gKCkge1xuICAgICAgICBcbiAgICAgICAgdGhpcy5lYWNoUm9sZShhcmd1bWVudHMsIGZ1bmN0aW9uIChhcmcsIHJvbGUpIHtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpcy5iZWZvcmVSb2xlQWRkKHJvbGUpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciBkZXNjID0gYXJnXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vY29tcG9zZSBkZXNjcmlwdG9yIGNhbiBjb250YWluICdhbGlhcycgYW5kICdleGNsdWRlJyBmaWVsZHMsIGluIHRoaXMgY2FzZSBhY3R1YWwgcmVmZXJlbmNlIHNob3VsZCBiZSBzdG9yZWRcbiAgICAgICAgICAgIC8vaW50byAncHJvcGVydHlTZXQnIGZpZWxkXG4gICAgICAgICAgICBpZiAocm9sZSAhPSBhcmcpIHtcbiAgICAgICAgICAgICAgICBkZXNjLnByb3BlcnR5U2V0ID0gcm9sZS5tZXRhLnN0ZW1cbiAgICAgICAgICAgICAgICBkZWxldGUgZGVzYy5yb2xlXG4gICAgICAgICAgICB9IGVsc2VcbiAgICAgICAgICAgICAgICBkZXNjID0gZGVzYy5tZXRhLnN0ZW1cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpcy5zdGVtLmFkZENvbXBvc2VJbmZvKGRlc2MpXG4gICAgICAgICAgICBcbiAgICAgICAgfSwgdGhpcylcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGJlZm9yZVJvbGVBZGQgOiBmdW5jdGlvbiAocm9sZSkge1xuICAgICAgICB2YXIgcm9sZU1ldGEgPSByb2xlLm1ldGFcbiAgICAgICAgXG4gICAgICAgIGlmIChyb2xlTWV0YS5idWlsZGVyQ2xhc3NDcmVhdGVkKSB0aGlzLmdldEJ1aWxkZXJUYXJnZXQoKS5tZXRhLmV4dGVuZCh7XG4gICAgICAgICAgICBkb2VzIDogWyByb2xlTWV0YS5nZXRCdWlsZGVyVGFyZ2V0KCkgXVxuICAgICAgICB9KVxuICAgICAgICBcbiAgICAgICAgaWYgKHJvbGVNZXRhLnN0ZW1DbGFzc0NyZWF0ZWQpIHRoaXMuZ2V0U3RlbVRhcmdldCgpLm1ldGEuZXh0ZW5kKHtcbiAgICAgICAgICAgIGRvZXMgOiBbIHJvbGVNZXRhLmdldFN0ZW1UYXJnZXQoKSBdXG4gICAgICAgIH0pXG4gICAgICAgIFxuICAgICAgICBpZiAocm9sZU1ldGEubWV0YS5pc0RldGFjaGVkICYmICF0aGlzLmZpcnN0UGFzcykgdGhpcy5idWlsZGVyLnRyYWl0cyh0aGlzLCByb2xlTWV0YS5jb25zdHJ1Y3RvcilcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGJlZm9yZVJvbGVSZW1vdmUgOiBmdW5jdGlvbiAocm9sZSkge1xuICAgICAgICB2YXIgcm9sZU1ldGEgPSByb2xlLm1ldGFcbiAgICAgICAgXG4gICAgICAgIGlmIChyb2xlTWV0YS5idWlsZGVyQ2xhc3NDcmVhdGVkKSB0aGlzLmdldEJ1aWxkZXJUYXJnZXQoKS5tZXRhLmV4dGVuZCh7XG4gICAgICAgICAgICBkb2VzbnQgOiBbIHJvbGVNZXRhLmdldEJ1aWxkZXJUYXJnZXQoKSBdXG4gICAgICAgIH0pXG4gICAgICAgIFxuICAgICAgICBpZiAocm9sZU1ldGEuc3RlbUNsYXNzQ3JlYXRlZCkgdGhpcy5nZXRTdGVtVGFyZ2V0KCkubWV0YS5leHRlbmQoe1xuICAgICAgICAgICAgZG9lc250IDogWyByb2xlTWV0YS5nZXRTdGVtVGFyZ2V0KCkgXVxuICAgICAgICB9KVxuICAgICAgICBcbiAgICAgICAgaWYgKHJvbGVNZXRhLm1ldGEuaXNEZXRhY2hlZCAmJiAhdGhpcy5maXJzdFBhc3MpIHRoaXMuYnVpbGRlci5yZW1vdmVUcmFpdHModGhpcywgcm9sZU1ldGEuY29uc3RydWN0b3IpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICByZW1vdmVSb2xlIDogZnVuY3Rpb24gKCkge1xuICAgICAgICB0aGlzLmVhY2hSb2xlKGFyZ3VtZW50cywgZnVuY3Rpb24gKGFyZywgcm9sZSkge1xuICAgICAgICAgICAgdGhpcy5iZWZvcmVSb2xlUmVtb3ZlKHJvbGUpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXMuc3RlbS5yZW1vdmVDb21wb3NlSW5mbyhyb2xlLm1ldGEuc3RlbSlcbiAgICAgICAgfSwgdGhpcylcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGdldFJvbGVzIDogZnVuY3Rpb24gKCkge1xuICAgICAgICBcbiAgICAgICAgcmV0dXJuIEpvb3NlLkEubWFwKHRoaXMuc3RlbS5jb21wb3NlZEZyb20sIGZ1bmN0aW9uIChjb21wb3NlRGVzYykge1xuICAgICAgICAgICAgLy9jb21wb3NlIGRlc2NyaXB0b3IgY2FuIGNvbnRhaW4gJ2FsaWFzJyBhbmQgJ2V4Y2x1ZGUnIGZpZWxkcywgaW4gdGhpcyBjYXNlIGFjdHVhbCByZWZlcmVuY2UgaXMgc3RvcmVkXG4gICAgICAgICAgICAvL2ludG8gJ3Byb3BlcnR5U2V0JyBmaWVsZFxuICAgICAgICAgICAgaWYgKCEoY29tcG9zZURlc2MgaW5zdGFuY2VvZiBKb29zZS5NYW5hZ2VkLlByb3BlcnR5U2V0KSkgcmV0dXJuIGNvbXBvc2VEZXNjLnByb3BlcnR5U2V0XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHJldHVybiBjb21wb3NlRGVzYy50YXJnZXRNZXRhLmNcbiAgICAgICAgfSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGRvZXMgOiBmdW5jdGlvbiAocm9sZSkge1xuICAgICAgICB2YXIgbXlSb2xlcyA9IHRoaXMuZ2V0Um9sZXMoKVxuICAgICAgICBcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBteVJvbGVzLmxlbmd0aDsgaSsrKSBpZiAocm9sZSA9PSBteVJvbGVzW2ldKSByZXR1cm4gdHJ1ZVxuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IG15Um9sZXMubGVuZ3RoOyBpKyspIGlmIChteVJvbGVzW2ldLm1ldGEuZG9lcyhyb2xlKSkgcmV0dXJuIHRydWVcbiAgICAgICAgXG4gICAgICAgIHZhciBzdXBlck1ldGEgPSB0aGlzLnN1cGVyQ2xhc3MubWV0YVxuICAgICAgICBcbiAgICAgICAgLy8gY29uc2lkZXJpbmcgdGhlIGNhc2Ugb2YgaW5oZXJpdGluZyBmcm9tIG5vbi1Kb29zZSBjbGFzc2VzXG4gICAgICAgIGlmICh0aGlzLnN1cGVyQ2xhc3MgIT0gSm9vc2UuUHJvdG8uRW1wdHkgJiYgc3VwZXJNZXRhICYmIHN1cGVyTWV0YS5tZXRhICYmIHN1cGVyTWV0YS5tZXRhLmhhc01ldGhvZCgnZG9lcycpKSByZXR1cm4gc3VwZXJNZXRhLmRvZXMocm9sZSlcbiAgICAgICAgXG4gICAgICAgIHJldHVybiBmYWxzZVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgZ2V0TWV0aG9kcyA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuc3RlbS5wcm9wZXJ0aWVzLm1ldGhvZHNcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGdldEF0dHJpYnV0ZXMgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHJldHVybiB0aGlzLnN0ZW0ucHJvcGVydGllcy5hdHRyaWJ1dGVzXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBhZnRlck11dGF0ZSA6IGZ1bmN0aW9uICgpIHtcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGdldEN1cnJlbnRNZXRob2QgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIGZvciAodmFyIHdyYXBwZXIgPSBhcmd1bWVudHMuY2FsbGVlLmNhbGxlciwgY291bnQgPSAwOyB3cmFwcGVyICYmIGNvdW50IDwgNTsgd3JhcHBlciA9IHdyYXBwZXIuY2FsbGVyLCBjb3VudCsrKVxuICAgICAgICAgICAgaWYgKHdyYXBwZXIuX19NRVRIT0RfXykgcmV0dXJuIHdyYXBwZXIuX19NRVRIT0RfX1xuICAgICAgICBcbiAgICAgICAgcmV0dXJuIG51bGxcbiAgICB9XG4gICAgXG4gICAgXG59KS5jO1xuSm9vc2UuTWFuYWdlZC5Sb2xlID0gbmV3IEpvb3NlLk1hbmFnZWQuQ2xhc3MoJ0pvb3NlLk1hbmFnZWQuUm9sZScsIHtcbiAgICBcbiAgICBpc2EgICAgICAgICAgICAgICAgICAgICAgICAgOiBKb29zZS5NYW5hZ2VkLkNsYXNzLFxuICAgIFxuICAgIGhhdmUgOiB7XG4gICAgICAgIGRlZmF1bHRTdXBlckNsYXNzICAgICAgIDogSm9vc2UuUHJvdG8uRW1wdHksXG4gICAgICAgIFxuICAgICAgICBidWlsZGVyUm9sZSAgICAgICAgICAgICA6IG51bGwsXG4gICAgICAgIHN0ZW1Sb2xlICAgICAgICAgICAgICAgIDogbnVsbFxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgbWV0aG9kcyA6IHtcbiAgICAgICAgXG4gICAgICAgIGRlZmF1bHRDb25zdHJ1Y3RvciA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHJldHVybiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiUm9sZXMgY2FudCBiZSBpbnN0YW50aWF0ZWRcIilcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgXG5cbiAgICAgICAgcHJvY2Vzc1N1cGVyQ2xhc3MgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBpZiAodGhpcy5zdXBlckNsYXNzICE9IHRoaXMuZGVmYXVsdFN1cGVyQ2xhc3MpIHRocm93IG5ldyBFcnJvcihcIlJvbGVzIGNhbid0IGluaGVyaXQgZnJvbSBhbnl0aGluZ1wiKVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIGdldEJ1aWxkZXJUYXJnZXQgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBpZiAoIXRoaXMuYnVpbGRlclJvbGUpIHtcbiAgICAgICAgICAgICAgICB0aGlzLmJ1aWxkZXJSb2xlID0gbmV3IHRoaXMuY29uc3RydWN0b3IoKS5jXG4gICAgICAgICAgICAgICAgdGhpcy5idWlsZGVyQ2xhc3NDcmVhdGVkID0gdHJ1ZVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5idWlsZGVyUm9sZVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICBcbiAgICAgICAgZ2V0U3RlbVRhcmdldCA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIGlmICghdGhpcy5zdGVtUm9sZSkge1xuICAgICAgICAgICAgICAgIHRoaXMuc3RlbVJvbGUgPSBuZXcgdGhpcy5jb25zdHJ1Y3RvcigpLmNcbiAgICAgICAgICAgICAgICB0aGlzLnN0ZW1DbGFzc0NyZWF0ZWQgPSB0cnVlXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHJldHVybiB0aGlzLnN0ZW1Sb2xlXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgIFxuICAgICAgICBhZGRSZXF1aXJlbWVudCA6IGZ1bmN0aW9uIChtZXRob2ROYW1lKSB7XG4gICAgICAgICAgICB0aGlzLnN0ZW0ucHJvcGVydGllcy5yZXF1aXJlbWVudHMuYWRkUHJvcGVydHkobWV0aG9kTmFtZSwge30pXG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgfSxcbiAgICBcblxuICAgIHN0ZW0gOiB7XG4gICAgICAgIG1ldGhvZHMgOiB7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGFwcGx5IDogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgXG4gICAgICAgICAgICB1bmFwcGx5IDogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBidWlsZGVyIDoge1xuICAgICAgICBtZXRob2RzIDoge1xuICAgICAgICAgICAgcmVxdWlyZXMgOiBmdW5jdGlvbiAodGFyZ2V0Q2xhc3NNZXRhLCBpbmZvKSB7XG4gICAgICAgICAgICAgICAgSm9vc2UuQS5lYWNoKEpvb3NlLk8ud2FudEFycmF5KGluZm8pLCBmdW5jdGlvbiAobWV0aG9kTmFtZSkge1xuICAgICAgICAgICAgICAgICAgICB0YXJnZXRDbGFzc01ldGEuYWRkUmVxdWlyZW1lbnQobWV0aG9kTmFtZSlcbiAgICAgICAgICAgICAgICB9LCB0aGlzKVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuICAgIFxufSkuYztcbkpvb3NlLk1hbmFnZWQuQXR0cmlidXRlID0gbmV3IEpvb3NlLk1hbmFnZWQuQ2xhc3MoJ0pvb3NlLk1hbmFnZWQuQXR0cmlidXRlJywge1xuICAgIFxuICAgIGlzYSA6IEpvb3NlLk1hbmFnZWQuUHJvcGVydHkuQXR0cmlidXRlLFxuICAgIFxuICAgIGhhdmUgOiB7XG4gICAgICAgIGlzICAgICAgICAgICAgICA6IG51bGwsXG4gICAgICAgIFxuICAgICAgICBidWlsZGVyICAgICAgICAgOiBudWxsLFxuICAgICAgICBcbiAgICAgICAgaXNQcml2YXRlICAgICAgIDogZmFsc2UsXG4gICAgICAgIFxuICAgICAgICByb2xlICAgICAgICAgICAgOiBudWxsLFxuICAgICAgICBcbiAgICAgICAgcHVibGljTmFtZSAgICAgIDogbnVsbCxcbiAgICAgICAgc2V0dGVyTmFtZSAgICAgIDogbnVsbCxcbiAgICAgICAgZ2V0dGVyTmFtZSAgICAgIDogbnVsbCxcbiAgICAgICAgXG4gICAgICAgIC8vaW5kaWNhdGVzIHRoZSBsb2dpY2FsIHJlYWRhYmxlbmVzcy93cml0ZWFibGVuZXNzIG9mIHRoZSBhdHRyaWJ1dGVcbiAgICAgICAgcmVhZGFibGUgICAgICAgIDogZmFsc2UsXG4gICAgICAgIHdyaXRlYWJsZSAgICAgICA6IGZhbHNlLFxuICAgICAgICBcbiAgICAgICAgLy9pbmRpY2F0ZXMgdGhlIHBoeXNpY2FsIHByZXNlbnNlIG9mIHRoZSBhY2Nlc3NvciAobWF5IGJlIGFic2VudCBmb3IgXCJjb21iaW5lZFwiIGFjY2Vzc29ycyBmb3IgZXhhbXBsZSlcbiAgICAgICAgaGFzR2V0dGVyICAgICAgIDogZmFsc2UsXG4gICAgICAgIGhhc1NldHRlciAgICAgICA6IGZhbHNlLFxuICAgICAgICBcbiAgICAgICAgcmVxdWlyZWQgICAgICAgIDogZmFsc2UsXG4gICAgICAgIFxuICAgICAgICBjYW5JbmxpbmVTZXRSYXcgOiB0cnVlLFxuICAgICAgICBjYW5JbmxpbmVHZXRSYXcgOiB0cnVlXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBhZnRlciA6IHtcbiAgICAgICAgaW5pdGlhbGl6ZSA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHZhciBuYW1lID0gdGhpcy5uYW1lXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXMucHVibGljTmFtZSA9IG5hbWUucmVwbGFjZSgvXl8rLywgJycpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXMuc2xvdCA9IHRoaXMuaXNQcml2YXRlID8gJyQkJyArIG5hbWUgOiBuYW1lXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXMuc2V0dGVyTmFtZSA9IHRoaXMuc2V0dGVyTmFtZSB8fCB0aGlzLmdldFNldHRlck5hbWUoKVxuICAgICAgICAgICAgdGhpcy5nZXR0ZXJOYW1lID0gdGhpcy5nZXR0ZXJOYW1lIHx8IHRoaXMuZ2V0R2V0dGVyTmFtZSgpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXMucmVhZGFibGUgID0gdGhpcy5oYXNHZXR0ZXIgPSAvXnIvaS50ZXN0KHRoaXMuaXMpXG4gICAgICAgICAgICB0aGlzLndyaXRlYWJsZSA9IHRoaXMuaGFzU2V0dGVyID0gL14udy9pLnRlc3QodGhpcy5pcylcbiAgICAgICAgfVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgb3ZlcnJpZGUgOiB7XG4gICAgICAgIFxuICAgICAgICBjb21wdXRlVmFsdWUgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB2YXIgaW5pdCAgICA9IHRoaXMuaW5pdFxuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAoSm9vc2UuTy5pc0NsYXNzKGluaXQpIHx8ICFKb29zZS5PLmlzRnVuY3Rpb24oaW5pdCkpIHRoaXMuU1VQRVIoKVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIHByZUFwcGx5IDogZnVuY3Rpb24gKHRhcmdldENsYXNzKSB7XG4gICAgICAgICAgICB0YXJnZXRDbGFzcy5tZXRhLmV4dGVuZCh7XG4gICAgICAgICAgICAgICAgbWV0aG9kcyA6IHRoaXMuZ2V0QWNjZXNzb3JzRm9yKHRhcmdldENsYXNzKVxuICAgICAgICAgICAgfSlcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBwb3N0VW5BcHBseSA6IGZ1bmN0aW9uIChmcm9tKSB7XG4gICAgICAgICAgICBmcm9tLm1ldGEuZXh0ZW5kKHtcbiAgICAgICAgICAgICAgICByZW1vdmVNZXRob2RzIDogdGhpcy5nZXRBY2Nlc3NvcnNGcm9tKGZyb20pXG4gICAgICAgICAgICB9KVxuICAgICAgICB9XG4gICAgICAgIFxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgbWV0aG9kcyA6IHtcbiAgICAgICAgXG4gICAgICAgIGdldEFjY2Vzc29yc0ZvciA6IGZ1bmN0aW9uICh0YXJnZXRDbGFzcykge1xuICAgICAgICAgICAgdmFyIHRhcmdldE1ldGEgPSB0YXJnZXRDbGFzcy5tZXRhXG4gICAgICAgICAgICB2YXIgc2V0dGVyTmFtZSA9IHRoaXMuc2V0dGVyTmFtZVxuICAgICAgICAgICAgdmFyIGdldHRlck5hbWUgPSB0aGlzLmdldHRlck5hbWVcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdmFyIG1ldGhvZHMgPSB7fVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAodGhpcy5oYXNTZXR0ZXIgJiYgIXRhcmdldE1ldGEuaGFzTWV0aG9kKHNldHRlck5hbWUpKSB7XG4gICAgICAgICAgICAgICAgbWV0aG9kc1tzZXR0ZXJOYW1lXSA9IHRoaXMuZ2V0U2V0dGVyKClcbiAgICAgICAgICAgICAgICBtZXRob2RzW3NldHRlck5hbWVdLkFDQ0VTU09SX0ZST00gPSB0aGlzXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmICh0aGlzLmhhc0dldHRlciAmJiAhdGFyZ2V0TWV0YS5oYXNNZXRob2QoZ2V0dGVyTmFtZSkpIHtcbiAgICAgICAgICAgICAgICBtZXRob2RzW2dldHRlck5hbWVdID0gdGhpcy5nZXRHZXR0ZXIoKVxuICAgICAgICAgICAgICAgIG1ldGhvZHNbZ2V0dGVyTmFtZV0uQUNDRVNTT1JfRlJPTSA9IHRoaXNcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcmV0dXJuIG1ldGhvZHNcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBnZXRBY2Nlc3NvcnNGcm9tIDogZnVuY3Rpb24gKGZyb20pIHtcbiAgICAgICAgICAgIHZhciB0YXJnZXRNZXRhID0gZnJvbS5tZXRhXG4gICAgICAgICAgICB2YXIgc2V0dGVyTmFtZSA9IHRoaXMuc2V0dGVyTmFtZVxuICAgICAgICAgICAgdmFyIGdldHRlck5hbWUgPSB0aGlzLmdldHRlck5hbWVcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdmFyIHNldHRlciA9IHRoaXMuaGFzU2V0dGVyICYmIHRhcmdldE1ldGEuZ2V0TWV0aG9kKHNldHRlck5hbWUpXG4gICAgICAgICAgICB2YXIgZ2V0dGVyID0gdGhpcy5oYXNHZXR0ZXIgJiYgdGFyZ2V0TWV0YS5nZXRNZXRob2QoZ2V0dGVyTmFtZSlcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdmFyIHJlbW92ZU1ldGhvZHMgPSBbXVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAoc2V0dGVyICYmIHNldHRlci52YWx1ZS5BQ0NFU1NPUl9GUk9NID09IHRoaXMpIHJlbW92ZU1ldGhvZHMucHVzaChzZXR0ZXJOYW1lKVxuICAgICAgICAgICAgaWYgKGdldHRlciAmJiBnZXR0ZXIudmFsdWUuQUNDRVNTT1JfRlJPTSA9PSB0aGlzKSByZW1vdmVNZXRob2RzLnB1c2goZ2V0dGVyTmFtZSlcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcmV0dXJuIHJlbW92ZU1ldGhvZHNcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBnZXRHZXR0ZXJOYW1lIDogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgcmV0dXJuICdnZXQnICsgSm9vc2UuUy51cHBlcmNhc2VGaXJzdCh0aGlzLnB1YmxpY05hbWUpXG4gICAgICAgIH0sXG5cblxuICAgICAgICBnZXRTZXR0ZXJOYW1lIDogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgcmV0dXJuICdzZXQnICsgSm9vc2UuUy51cHBlcmNhc2VGaXJzdCh0aGlzLnB1YmxpY05hbWUpXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgZ2V0U2V0dGVyIDogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgdmFyIG1lICAgICAgPSB0aGlzXG4gICAgICAgICAgICB2YXIgc2xvdCAgICA9IG1lLnNsb3RcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKG1lLmNhbklubGluZVNldFJhdylcbiAgICAgICAgICAgICAgICByZXR1cm4gZnVuY3Rpb24gKHZhbHVlKSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXNbIHNsb3QgXSA9IHZhbHVlXG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gdGhpc1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGVsc2VcbiAgICAgICAgICAgICAgICByZXR1cm4gZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gbWUuc2V0UmF3VmFsdWVUby5hcHBseSh0aGlzLCBhcmd1bWVudHMpXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIGdldEdldHRlciA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHZhciBtZSAgICAgID0gdGhpc1xuICAgICAgICAgICAgdmFyIHNsb3QgICAgPSBtZS5zbG90XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmIChtZS5jYW5JbmxpbmVHZXRSYXcpXG4gICAgICAgICAgICAgICAgcmV0dXJuIGZ1bmN0aW9uICh2YWx1ZSkge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gdGhpc1sgc2xvdCBdXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZVxuICAgICAgICAgICAgICAgIHJldHVybiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBtZS5nZXRSYXdWYWx1ZUZyb20uYXBwbHkodGhpcywgYXJndW1lbnRzKVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBnZXRWYWx1ZUZyb20gOiBmdW5jdGlvbiAoaW5zdGFuY2UpIHtcbiAgICAgICAgICAgIHZhciBnZXR0ZXJOYW1lICAgICAgPSB0aGlzLmdldHRlck5hbWVcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKHRoaXMucmVhZGFibGUgJiYgaW5zdGFuY2UubWV0YS5oYXNNZXRob2QoZ2V0dGVyTmFtZSkpIHJldHVybiBpbnN0YW5jZVsgZ2V0dGVyTmFtZSBdKClcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcmV0dXJuIHRoaXMuZ2V0UmF3VmFsdWVGcm9tKGluc3RhbmNlKVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIHNldFZhbHVlVG8gOiBmdW5jdGlvbiAoaW5zdGFuY2UsIHZhbHVlKSB7XG4gICAgICAgICAgICB2YXIgc2V0dGVyTmFtZSAgICAgID0gdGhpcy5zZXR0ZXJOYW1lXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmICh0aGlzLndyaXRlYWJsZSAmJiBpbnN0YW5jZS5tZXRhLmhhc01ldGhvZChzZXR0ZXJOYW1lKSkgXG4gICAgICAgICAgICAgICAgaW5zdGFuY2VbIHNldHRlck5hbWUgXSh2YWx1ZSlcbiAgICAgICAgICAgIGVsc2VcbiAgICAgICAgICAgICAgICB0aGlzLnNldFJhd1ZhbHVlVG8oaW5zdGFuY2UsIHZhbHVlKVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIGluaXRGcm9tQ29uZmlnIDogZnVuY3Rpb24gKGluc3RhbmNlLCBjb25maWcpIHtcbiAgICAgICAgICAgIHZhciBuYW1lICAgICAgICAgICAgPSB0aGlzLm5hbWVcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdmFyIHZhbHVlLCBpc1NldCA9IGZhbHNlXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmIChjb25maWcuaGFzT3duUHJvcGVydHkobmFtZSkpIHtcbiAgICAgICAgICAgICAgICB2YWx1ZSA9IGNvbmZpZ1tuYW1lXVxuICAgICAgICAgICAgICAgIGlzU2V0ID0gdHJ1ZVxuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICB2YXIgaW5pdCAgICA9IHRoaXMuaW5pdFxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIC8vIHNpbXBsZSBmdW5jdGlvbiAobm90IGNsYXNzKSBoYXMgYmVlbiB1c2VkIGFzIFwiaW5pdFwiIHZhbHVlXG4gICAgICAgICAgICAgICAgaWYgKEpvb3NlLk8uaXNGdW5jdGlvbihpbml0KSAmJiAhSm9vc2UuTy5pc0NsYXNzKGluaXQpKSB7XG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICB2YWx1ZSA9IGluaXQuY2FsbChpbnN0YW5jZSwgY29uZmlnLCBuYW1lKVxuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgaXNTZXQgPSB0cnVlXG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAodGhpcy5idWlsZGVyKSB7XG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICB2YWx1ZSA9IGluc3RhbmNlWyB0aGlzLmJ1aWxkZXIucmVwbGFjZSgvXnRoaXNcXC4vLCAnJykgXShjb25maWcsIG5hbWUpXG4gICAgICAgICAgICAgICAgICAgIGlzU2V0ID0gdHJ1ZVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKGlzU2V0KVxuICAgICAgICAgICAgICAgIHRoaXMuc2V0UmF3VmFsdWVUbyhpbnN0YW5jZSwgdmFsdWUpXG4gICAgICAgICAgICBlbHNlIFxuICAgICAgICAgICAgICAgIGlmICh0aGlzLnJlcXVpcmVkKSB0aHJvdyBuZXcgRXJyb3IoXCJSZXF1aXJlZCBhdHRyaWJ1dGUgW1wiICsgbmFtZSArIFwiXSBpcyBtaXNzZWQgZHVyaW5nIGluaXRpYWxpemF0aW9uIG9mIFwiICsgaW5zdGFuY2UpXG4gICAgICAgIH1cbiAgICB9XG5cbn0pLmNcbjtcbkpvb3NlLk1hbmFnZWQuQXR0cmlidXRlLkJ1aWxkZXIgPSBuZXcgSm9vc2UuTWFuYWdlZC5Sb2xlKCdKb29zZS5NYW5hZ2VkLkF0dHJpYnV0ZS5CdWlsZGVyJywge1xuICAgIFxuICAgIFxuICAgIGhhdmUgOiB7XG4gICAgICAgIGRlZmF1bHRBdHRyaWJ1dGVDbGFzcyA6IEpvb3NlLk1hbmFnZWQuQXR0cmlidXRlXG4gICAgfSxcbiAgICBcbiAgICBidWlsZGVyIDoge1xuICAgICAgICBcbiAgICAgICAgbWV0aG9kcyA6IHtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaGFzIDogZnVuY3Rpb24gKHRhcmdldENsYXNzTWV0YSwgaW5mbykge1xuICAgICAgICAgICAgICAgIEpvb3NlLk8uZWFjaE93bihpbmZvLCBmdW5jdGlvbiAocHJvcHMsIG5hbWUpIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKHR5cGVvZiBwcm9wcyAhPSAnb2JqZWN0JyB8fCBwcm9wcyA9PSBudWxsIHx8IHByb3BzLmNvbnN0cnVjdG9yID09IC8gLy5jb25zdHJ1Y3RvcikgcHJvcHMgPSB7IGluaXQgOiBwcm9wcyB9XG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICBwcm9wcy5tZXRhID0gcHJvcHMubWV0YSB8fCB0YXJnZXRDbGFzc01ldGEuZGVmYXVsdEF0dHJpYnV0ZUNsYXNzXG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICBpZiAoL15fXy8udGVzdChuYW1lKSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgbmFtZSA9IG5hbWUucmVwbGFjZSgvXl8rLywgJycpXG4gICAgICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgICAgIHByb3BzLmlzUHJpdmF0ZSA9IHRydWVcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgdGFyZ2V0Q2xhc3NNZXRhLmFkZEF0dHJpYnV0ZShuYW1lLCBwcm9wcy5pbml0LCBwcm9wcylcbiAgICAgICAgICAgICAgICB9LCB0aGlzKVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgXG4gICAgICAgICAgICBoYXNub3QgOiBmdW5jdGlvbiAodGFyZ2V0Q2xhc3NNZXRhLCBpbmZvKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5oYXZlbm90KHRhcmdldENsYXNzTWV0YSwgaW5mbylcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaGFzbnQgOiBmdW5jdGlvbiAodGFyZ2V0Q2xhc3NNZXRhLCBpbmZvKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5oYXNub3QodGFyZ2V0Q2xhc3NNZXRhLCBpbmZvKVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgICAgICBcbiAgICB9XG4gICAgXG59KS5jXG47XG5Kb29zZS5NYW5hZ2VkLk15ID0gbmV3IEpvb3NlLk1hbmFnZWQuUm9sZSgnSm9vc2UuTWFuYWdlZC5NeScsIHtcbiAgICBcbiAgICBoYXZlIDoge1xuICAgICAgICBteUNsYXNzICAgICAgICAgICAgICAgICAgICAgICAgIDogbnVsbCxcbiAgICAgICAgXG4gICAgICAgIG5lZWRUb1JlQWxpYXMgICAgICAgICAgICAgICAgICAgOiBmYWxzZVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgbWV0aG9kcyA6IHtcbiAgICAgICAgY3JlYXRlTXkgOiBmdW5jdGlvbiAoZXh0ZW5kKSB7XG4gICAgICAgICAgICB2YXIgdGhpc01ldGEgPSB0aGlzLm1ldGFcbiAgICAgICAgICAgIHZhciBpc1JvbGUgPSB0aGlzIGluc3RhbmNlb2YgSm9vc2UuTWFuYWdlZC5Sb2xlXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciBteUV4dGVuZCA9IGV4dGVuZC5teSB8fCB7fVxuICAgICAgICAgICAgZGVsZXRlIGV4dGVuZC5teVxuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBTeW1iaW9udCB3aWxsIGdlbmVyYWxseSBoYXZlIHRoZSBzYW1lIG1ldGEgY2xhc3MgYXMgaXRzIGhvc3RlciwgZXhjZXB0aW5nIHRoZSBjYXNlcywgd2hlbiB0aGUgc3VwZXJjbGFzcyBhbHNvIGhhdmUgdGhlIHN5bWJpb250LiBcbiAgICAgICAgICAgIC8vIEluIHN1Y2ggY2FzZXMsIHRoZSBtZXRhIGNsYXNzIGZvciBzeW1iaW9udCB3aWxsIGJlIGluaGVyaXRlZCAodW5sZXNzIGV4cGxpY2l0bHkgc3BlY2lmaWVkKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB2YXIgc3VwZXJDbGFzc015ICAgID0gdGhpcy5zdXBlckNsYXNzLm1ldGEubXlDbGFzc1xuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAoIWlzUm9sZSAmJiAhbXlFeHRlbmQuaXNhICYmIHN1cGVyQ2xhc3NNeSkgbXlFeHRlbmQuaXNhID0gc3VwZXJDbGFzc015XG4gICAgICAgICAgICBcblxuICAgICAgICAgICAgaWYgKCFteUV4dGVuZC5tZXRhICYmICFteUV4dGVuZC5pc2EpIG15RXh0ZW5kLm1ldGEgPSB0aGlzLmNvbnN0cnVjdG9yXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciBjcmVhdGVkQ2xhc3MgICAgPSB0aGlzLm15Q2xhc3MgPSBDbGFzcyhteUV4dGVuZClcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdmFyIGMgICAgICAgICAgICAgICA9IHRoaXMuY1xuICAgICAgICAgICAgXG4gICAgICAgICAgICBjLnByb3RvdHlwZS5teSAgICAgID0gYy5teSA9IGlzUm9sZSA/IGNyZWF0ZWRDbGFzcyA6IG5ldyBjcmVhdGVkQ2xhc3MoeyBIT1NUIDogYyB9KVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLm5lZWRUb1JlQWxpYXMgPSB0cnVlXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgYWxpYXNTdGF0aWNNZXRob2RzIDogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgdGhpcy5uZWVkVG9SZUFsaWFzID0gZmFsc2VcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdmFyIGMgICAgICAgICAgID0gdGhpcy5jXG4gICAgICAgICAgICB2YXIgbXlQcm90byAgICAgPSB0aGlzLm15Q2xhc3MucHJvdG90eXBlXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIEpvb3NlLk8uZWFjaE93bihjLCBmdW5jdGlvbiAocHJvcGVydHksIG5hbWUpIHtcbiAgICAgICAgICAgICAgICBpZiAocHJvcGVydHkuSVNfQUxJQVMpIGRlbGV0ZSBjWyBuYW1lIF0gXG4gICAgICAgICAgICB9KVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLm15Q2xhc3MubWV0YS5zdGVtLnByb3BlcnRpZXMubWV0aG9kcy5lYWNoKGZ1bmN0aW9uIChtZXRob2QsIG5hbWUpIHtcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBpZiAoIWNbIG5hbWUgXSlcbiAgICAgICAgICAgICAgICAgICAgKGNbIG5hbWUgXSA9IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBteVByb3RvWyBuYW1lIF0uYXBwbHkoYy5teSwgYXJndW1lbnRzKVxuICAgICAgICAgICAgICAgICAgICB9KS5JU19BTElBUyA9IHRydWVcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH1cbiAgICB9LFxuICAgIFxuICAgIFxuICAgIG92ZXJyaWRlIDoge1xuICAgICAgICBcbiAgICAgICAgZXh0ZW5kIDogZnVuY3Rpb24gKHByb3BzKSB7XG4gICAgICAgICAgICB2YXIgbXlDbGFzcyA9IHRoaXMubXlDbGFzc1xuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAoIW15Q2xhc3MgJiYgdGhpcy5zdXBlckNsYXNzLm1ldGEubXlDbGFzcykgdGhpcy5jcmVhdGVNeShwcm9wcylcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKHByb3BzLm15KSB7XG4gICAgICAgICAgICAgICAgaWYgKCFteUNsYXNzKSBcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5jcmVhdGVNeShwcm9wcylcbiAgICAgICAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5uZWVkVG9SZUFsaWFzID0gdHJ1ZVxuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgbXlDbGFzcy5tZXRhLmV4dGVuZChwcm9wcy5teSlcbiAgICAgICAgICAgICAgICAgICAgZGVsZXRlIHByb3BzLm15XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLlNVUEVSKHByb3BzKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAodGhpcy5uZWVkVG9SZUFsaWFzICYmICEodGhpcyBpbnN0YW5jZW9mIEpvb3NlLk1hbmFnZWQuUm9sZSkpIHRoaXMuYWxpYXNTdGF0aWNNZXRob2RzKClcbiAgICAgICAgfSAgXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBiZWZvcmUgOiB7XG4gICAgICAgIFxuICAgICAgICBhZGRSb2xlIDogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgdmFyIG15U3RlbVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBKb29zZS5BLmVhY2goYXJndW1lbnRzLCBmdW5jdGlvbiAoYXJnKSB7XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgaWYgKCFhcmcpIHRocm93IG5ldyBFcnJvcihcIkF0dGVtcHQgdG8gY29uc3VtZSBhbiB1bmRlZmluZWQgUm9sZSBpbnRvIFtcIiArIHRoaXMubmFtZSArIFwiXVwiKVxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIC8vaW5zdGFuY2VvZiBDbGFzcyB0byBhbGxvdyB0cmVhdCBjbGFzc2VzIGFzIHJvbGVzXG4gICAgICAgICAgICAgICAgdmFyIHJvbGUgPSAoYXJnLm1ldGEgaW5zdGFuY2VvZiBKb29zZS5NYW5hZ2VkLkNsYXNzKSA/IGFyZyA6IGFyZy5yb2xlXG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgaWYgKHJvbGUubWV0YS5tZXRhLmhhc0F0dHJpYnV0ZSgnbXlDbGFzcycpICYmIHJvbGUubWV0YS5teUNsYXNzKSB7XG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICBpZiAoIXRoaXMubXlDbGFzcykge1xuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5jcmVhdGVNeSh7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbXkgOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRvZXMgOiByb2xlLm1ldGEubXlDbGFzc1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm5cbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgbXlTdGVtID0gdGhpcy5teUNsYXNzLm1ldGEuc3RlbVxuICAgICAgICAgICAgICAgICAgICBpZiAoIW15U3RlbS5vcGVuZWQpIG15U3RlbS5vcGVuKClcbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIG15U3RlbS5hZGRDb21wb3NlSW5mbyhyb2xlLm15Lm1ldGEuc3RlbSlcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9LCB0aGlzKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAobXlTdGVtKSB7XG4gICAgICAgICAgICAgICAgbXlTdGVtLmNsb3NlKClcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICB0aGlzLm5lZWRUb1JlQWxpYXMgPSB0cnVlXG4gICAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgcmVtb3ZlUm9sZSA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIGlmICghdGhpcy5teUNsYXNzKSByZXR1cm5cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdmFyIG15U3RlbSA9IHRoaXMubXlDbGFzcy5tZXRhLnN0ZW1cbiAgICAgICAgICAgIG15U3RlbS5vcGVuKClcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgSm9vc2UuQS5lYWNoKGFyZ3VtZW50cywgZnVuY3Rpb24gKHJvbGUpIHtcbiAgICAgICAgICAgICAgICBpZiAocm9sZS5tZXRhLm1ldGEuaGFzQXR0cmlidXRlKCdteUNsYXNzJykgJiYgcm9sZS5tZXRhLm15Q2xhc3MpIHtcbiAgICAgICAgICAgICAgICAgICAgbXlTdGVtLnJlbW92ZUNvbXBvc2VJbmZvKHJvbGUubXkubWV0YS5zdGVtKVxuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5uZWVkVG9SZUFsaWFzID0gdHJ1ZVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0sIHRoaXMpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIG15U3RlbS5jbG9zZSgpXG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgfVxuICAgIFxufSkuYztcbkpvb3NlLk5hbWVzcGFjZSA9IEpvb3NlLnN0dWIoKVxuXG5Kb29zZS5OYW1lc3BhY2UuQWJsZSA9IG5ldyBKb29zZS5NYW5hZ2VkLlJvbGUoJ0pvb3NlLk5hbWVzcGFjZS5BYmxlJywge1xuXG4gICAgaGF2ZSA6IHtcbiAgICAgICAgYm9keUZ1bmMgICAgICAgICAgICAgICAgOiBudWxsXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBiZWZvcmUgOiB7XG4gICAgICAgIGV4dGVuZCA6IGZ1bmN0aW9uIChleHRlbmQpIHtcbiAgICAgICAgICAgIGlmIChleHRlbmQuYm9keSkge1xuICAgICAgICAgICAgICAgIHRoaXMuYm9keUZ1bmMgPSBleHRlbmQuYm9keVxuICAgICAgICAgICAgICAgIGRlbGV0ZSBleHRlbmQuYm9keVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBhZnRlcjoge1xuICAgICAgICBcbiAgICAgICAgYWZ0ZXJNdXRhdGUgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB2YXIgYm9keUZ1bmMgPSB0aGlzLmJvZHlGdW5jXG4gICAgICAgICAgICBkZWxldGUgdGhpcy5ib2R5RnVuY1xuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAoYm9keUZ1bmMpIEpvb3NlLk5hbWVzcGFjZS5NYW5hZ2VyLm15LmV4ZWN1dGVJbih0aGlzLmMsIGJvZHlGdW5jKVxuICAgICAgICB9XG4gICAgfVxuICAgIFxufSkuYztcbkpvb3NlLk1hbmFnZWQuQm9vdHN0cmFwID0gbmV3IEpvb3NlLk1hbmFnZWQuUm9sZSgnSm9vc2UuTWFuYWdlZC5Cb290c3RyYXAnLCB7XG4gICAgXG4gICAgZG9lcyAgIDogWyBKb29zZS5OYW1lc3BhY2UuQWJsZSwgSm9vc2UuTWFuYWdlZC5NeSwgSm9vc2UuTWFuYWdlZC5BdHRyaWJ1dGUuQnVpbGRlciBdXG4gICAgXG59KS5jXG47XG5Kb29zZS5NZXRhID0gSm9vc2Uuc3R1YigpXG5cblxuSm9vc2UuTWV0YS5PYmplY3QgPSBuZXcgSm9vc2UuUHJvdG8uQ2xhc3MoJ0pvb3NlLk1ldGEuT2JqZWN0Jywge1xuICAgIFxuICAgIGlzYSAgICAgICAgICAgICA6IEpvb3NlLlByb3RvLk9iamVjdFxuICAgIFxufSkuY1xuXG5cbjtcbkpvb3NlLk1ldGEuQ2xhc3MgPSBuZXcgSm9vc2UuTWFuYWdlZC5DbGFzcygnSm9vc2UuTWV0YS5DbGFzcycsIHtcbiAgICBcbiAgICBpc2EgICAgICAgICAgICAgICAgICAgICAgICAgOiBKb29zZS5NYW5hZ2VkLkNsYXNzLFxuICAgIFxuICAgIGRvZXMgICAgICAgICAgICAgICAgICAgICAgICA6IEpvb3NlLk1hbmFnZWQuQm9vdHN0cmFwLFxuICAgIFxuICAgIGhhdmUgOiB7XG4gICAgICAgIGRlZmF1bHRTdXBlckNsYXNzICAgICAgIDogSm9vc2UuTWV0YS5PYmplY3RcbiAgICB9XG4gICAgXG59KS5jXG5cbjtcbkpvb3NlLk1ldGEuUm9sZSA9IG5ldyBKb29zZS5NZXRhLkNsYXNzKCdKb29zZS5NZXRhLlJvbGUnLCB7XG4gICAgXG4gICAgaXNhICAgICAgICAgICAgICAgICAgICAgICAgIDogSm9vc2UuTWFuYWdlZC5Sb2xlLFxuICAgIFxuICAgIGRvZXMgICAgICAgICAgICAgICAgICAgICAgICA6IEpvb3NlLk1hbmFnZWQuQm9vdHN0cmFwXG4gICAgXG59KS5jO1xuSm9vc2UuTmFtZXNwYWNlLktlZXBlciA9IG5ldyBKb29zZS5NZXRhLkNsYXNzKCdKb29zZS5OYW1lc3BhY2UuS2VlcGVyJywge1xuICAgIFxuICAgIGlzYSAgICAgICAgIDogSm9vc2UuTWV0YS5DbGFzcyxcbiAgICBcbiAgICBoYXZlICAgICAgICA6IHtcbiAgICAgICAgZXh0ZXJuYWxDb25zdHJ1Y3RvciAgICAgICAgICAgICA6IG51bGxcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIG1ldGhvZHM6IHtcbiAgICAgICAgXG4gICAgICAgIGRlZmF1bHRDb25zdHJ1Y3RvcjogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgXG4gICAgICAgICAgICByZXR1cm4gZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgIC8vY29uc3RydWN0b3JzIHNob3VsZCBhc3N1bWUgdGhhdCBtZXRhIGlzIGF0dGFjaGVkIHRvICdhcmd1bWVudHMuY2FsbGVlJyAobm90IHRvICd0aGlzJykgXG4gICAgICAgICAgICAgICAgdmFyIHRoaXNNZXRhID0gYXJndW1lbnRzLmNhbGxlZS5tZXRhXG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgaWYgKHRoaXNNZXRhIGluc3RhbmNlb2YgSm9vc2UuTmFtZXNwYWNlLktlZXBlcikgdGhyb3cgbmV3IEVycm9yKFwiTW9kdWxlIFtcIiArIHRoaXNNZXRhLmMgKyBcIl0gbWF5IG5vdCBiZSBpbnN0YW50aWF0ZWQuIEZvcmdvdCB0byAndXNlJyB0aGUgY2xhc3Mgd2l0aCB0aGUgc2FtZSBuYW1lP1wiKVxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIHZhciBleHRlcm5hbENvbnN0cnVjdG9yID0gdGhpc01ldGEuZXh0ZXJuYWxDb25zdHJ1Y3RvclxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIGlmICh0eXBlb2YgZXh0ZXJuYWxDb25zdHJ1Y3RvciA9PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICBleHRlcm5hbENvbnN0cnVjdG9yLm1ldGEgPSB0aGlzTWV0YVxuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGV4dGVybmFsQ29uc3RydWN0b3IuYXBwbHkodGhpcywgYXJndW1lbnRzKVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICB0aHJvdyBcIk5hbWVzcGFjZUtlZXBlciBvZiBbXCIgKyB0aGlzTWV0YS5uYW1lICsgXCJdIHdhcyBwbGFudGVkIGluY29ycmVjdGx5LlwiXG4gICAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgLy93aXRoQ2xhc3Mgc2hvdWxkIGJlIG5vdCBjb25zdHJ1Y3RlZCB5ZXQgb24gdGhpcyBzdGFnZSAoc2VlIEpvb3NlLlByb3RvLkNsYXNzLmNvbnN0cnVjdClcbiAgICAgICAgLy9pdCBzaG91bGQgYmUgb24gdGhlICdjb25zdHJ1Y3Rvck9ubHknIGxpZmUgc3RhZ2UgKHNob3VsZCBhbHJlYWR5IGhhdmUgY29uc3RydWN0b3IpXG4gICAgICAgIHBsYW50OiBmdW5jdGlvbiAod2l0aENsYXNzKSB7XG4gICAgICAgICAgICB2YXIga2VlcGVyID0gdGhpcy5jXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGtlZXBlci5tZXRhID0gd2l0aENsYXNzLm1ldGFcbiAgICAgICAgICAgIFxuICAgICAgICAgICAga2VlcGVyLm1ldGEuYyA9IGtlZXBlclxuICAgICAgICAgICAga2VlcGVyLm1ldGEuZXh0ZXJuYWxDb25zdHJ1Y3RvciA9IHdpdGhDbGFzc1xuICAgICAgICB9XG4gICAgfVxuICAgIFxufSkuY1xuXG5cbjtcbkpvb3NlLk5hbWVzcGFjZS5NYW5hZ2VyID0gbmV3IEpvb3NlLk1hbmFnZWQuQ2xhc3MoJ0pvb3NlLk5hbWVzcGFjZS5NYW5hZ2VyJywge1xuICAgIFxuICAgIGhhdmUgOiB7XG4gICAgICAgIGN1cnJlbnQgICAgIDogbnVsbFxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgbWV0aG9kcyA6IHtcbiAgICAgICAgXG4gICAgICAgIGluaXRpYWxpemUgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB0aGlzLmN1cnJlbnQgICAgPSBbIEpvb3NlLnRvcCBdXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgZ2V0Q3VycmVudDogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuY3VycmVudFswXVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIGV4ZWN1dGVJbiA6IGZ1bmN0aW9uIChucywgZnVuYykge1xuICAgICAgICAgICAgdmFyIGN1cnJlbnQgPSB0aGlzLmN1cnJlbnRcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgY3VycmVudC51bnNoaWZ0KG5zKVxuICAgICAgICAgICAgdmFyIHJlcyA9IGZ1bmMuY2FsbChucywgbnMpXG4gICAgICAgICAgICBjdXJyZW50LnNoaWZ0KClcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcmV0dXJuIHJlc1xuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIGVhcmx5Q3JlYXRlIDogZnVuY3Rpb24gKG5hbWUsIG1ldGFDbGFzcywgcHJvcHMpIHtcbiAgICAgICAgICAgIHByb3BzLmNvbnN0cnVjdG9yT25seSA9IHRydWVcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcmV0dXJuIG5ldyBtZXRhQ2xhc3MobmFtZSwgcHJvcHMpLmNcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICAvL3RoaXMgZnVuY3Rpb24gZXN0YWJsaXNoaW5nIHRoZSBmdWxsIFwibmFtZXNwYWNlIGNoYWluXCIgKGluY2x1ZGluZyB0aGUgbGFzdCBlbGVtZW50KVxuICAgICAgICBjcmVhdGUgOiBmdW5jdGlvbiAobnNOYW1lLCBtZXRhQ2xhc3MsIGV4dGVuZCkge1xuICAgICAgICAgICAgXG4gICAgICAgICAgICAvL2lmIG5vIG5hbWUgcHJvdmlkZWQsIHRoZW4gd2UgY3JlYXRpbmcgYW4gYW5vbnltb3VzIGNsYXNzLCBzbyBqdXN0IHNraXAgYWxsIHRoZSBuYW1lc3BhY2UgbWFuaXB1bGF0aW9uc1xuICAgICAgICAgICAgaWYgKCFuc05hbWUpIHJldHVybiBuZXcgbWV0YUNsYXNzKG5zTmFtZSwgZXh0ZW5kKS5jXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciBtZSA9IHRoaXNcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKC9eXFwuLy50ZXN0KG5zTmFtZSkpIHJldHVybiB0aGlzLmV4ZWN1dGVJbihKb29zZS50b3AsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gbWUuY3JlYXRlKG5zTmFtZS5yZXBsYWNlKC9eXFwuLywgJycpLCBtZXRhQ2xhc3MsIGV4dGVuZClcbiAgICAgICAgICAgIH0pXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciBwcm9wcyAgID0gZXh0ZW5kIHx8IHt9XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciBwYXJ0cyAgID0gSm9vc2UuUy5zYW5lU3BsaXQobnNOYW1lLCAnLicpXG4gICAgICAgICAgICB2YXIgb2JqZWN0ICA9IHRoaXMuZ2V0Q3VycmVudCgpXG4gICAgICAgICAgICB2YXIgc29GYXIgICA9IG9iamVjdCA9PSBKb29zZS50b3AgPyBbXSA6IEpvb3NlLlMuc2FuZVNwbGl0KG9iamVjdC5tZXRhLm5hbWUsICcuJylcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBwYXJ0cy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgICAgIHZhciBwYXJ0ICAgICAgICA9IHBhcnRzW2ldXG4gICAgICAgICAgICAgICAgdmFyIGlzTGFzdCAgICAgID0gaSA9PSBwYXJ0cy5sZW5ndGggLSAxXG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgaWYgKHBhcnQgPT0gXCJtZXRhXCIgfHwgcGFydCA9PSBcIm15XCIgfHwgIXBhcnQpIHRocm93IFwiTW9kdWxlIG5hbWUgW1wiICsgbnNOYW1lICsgXCJdIG1heSBub3QgaW5jbHVkZSBhIHBhcnQgY2FsbGVkICdtZXRhJyBvciAnbXknIG9yIGVtcHR5IHBhcnQuXCJcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICB2YXIgY3VyID0gICBvYmplY3RbcGFydF1cbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBzb0Zhci5wdXNoKHBhcnQpXG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgdmFyIHNvRmFyTmFtZSAgICAgICA9IHNvRmFyLmpvaW4oXCIuXCIpXG4gICAgICAgICAgICAgICAgdmFyIG5lZWRGaW5hbGl6ZSAgICA9IGZhbHNlXG4gICAgICAgICAgICAgICAgdmFyIG5zS2VlcGVyXG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgLy8gaWYgdGhlIG5hbWVzcGFjZSBzZWdtZW50IGlzIGVtcHR5XG4gICAgICAgICAgICAgICAgaWYgKHR5cGVvZiBjdXIgPT0gXCJ1bmRlZmluZWRcIikge1xuICAgICAgICAgICAgICAgICAgICBpZiAoaXNMYXN0KSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBwZXJmb3JtIFwiZWFybHkgY3JlYXRlXCIgd2hpY2gganVzdCBmaWxscyB0aGUgbmFtZXNwYWNlIHNlZ21lbnQgd2l0aCByaWdodCBjb25zdHJ1Y3RvclxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gdGhpcyBhbGxvd3MgdXMgdG8gaGF2ZSBhIHJpZ2h0IGNvbnN0cnVjdG9yIGluIHRoZSBuYW1lc3BhY2Ugc2VnbWVudCB3aGVuIHRoZSBgYm9keWAgd2lsbCBiZSBjYWxsZWRcbiAgICAgICAgICAgICAgICAgICAgICAgIG5zS2VlcGVyICAgICAgICA9IHRoaXMuZWFybHlDcmVhdGUoc29GYXJOYW1lLCBtZXRhQ2xhc3MsIHByb3BzKVxuICAgICAgICAgICAgICAgICAgICAgICAgbmVlZEZpbmFsaXplICAgID0gdHJ1ZVxuICAgICAgICAgICAgICAgICAgICB9IGVsc2VcbiAgICAgICAgICAgICAgICAgICAgICAgIG5zS2VlcGVyICAgICAgICA9IG5ldyBKb29zZS5OYW1lc3BhY2UuS2VlcGVyKHNvRmFyTmFtZSkuY1xuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgb2JqZWN0W3BhcnRdID0gbnNLZWVwZXJcbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIGN1ciA9IG5zS2VlcGVyXG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAoaXNMYXN0ICYmIGN1ciAmJiBjdXIubWV0YSkge1xuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgdmFyIGN1cnJlbnRNZXRhID0gY3VyLm1ldGFcbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIGlmIChtZXRhQ2xhc3MgPT0gSm9vc2UuTmFtZXNwYWNlLktlZXBlcilcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vYE1vZHVsZWAgb3ZlciBzb21ldGhpbmcgY2FzZSAtIGV4dGVuZCB0aGUgb3JpZ2luYWxcbiAgICAgICAgICAgICAgICAgICAgICAgIGN1cnJlbnRNZXRhLmV4dGVuZChwcm9wcylcbiAgICAgICAgICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChjdXJyZW50TWV0YSBpbnN0YW5jZW9mIEpvb3NlLk5hbWVzcGFjZS5LZWVwZXIpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjdXJyZW50TWV0YS5wbGFudCh0aGlzLmVhcmx5Q3JlYXRlKHNvRmFyTmFtZSwgbWV0YUNsYXNzLCBwcm9wcykpXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbmVlZEZpbmFsaXplID0gdHJ1ZVxuICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiRG91YmxlIGRlY2xhcmF0aW9uIG9mIFtcIiArIHNvRmFyTmFtZSArIFwiXVwiKVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIH0gZWxzZSBcbiAgICAgICAgICAgICAgICAgICAgaWYgKGlzTGFzdCAmJiAhKGN1ciAmJiBjdXIubWV0YSAmJiBjdXIubWV0YS5tZXRhKSkgdGhyb3cgXCJUcnlpbmcgdG8gc2V0dXAgbW9kdWxlIFwiICsgc29GYXJOYW1lICsgXCIgZmFpbGVkLiBUaGVyZSBpcyBhbHJlYWR5IHNvbWV0aGluZzogXCIgKyBjdXJcblxuICAgICAgICAgICAgICAgIC8vIGhvb2sgdG8gYWxsb3cgZW1iZWRkIHJlc291cmNlIGludG8gbWV0YVxuICAgICAgICAgICAgICAgIGlmIChpc0xhc3QpIHRoaXMucHJlcGFyZU1ldGEoY3VyLm1ldGEpXG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIGlmIChuZWVkRmluYWxpemUpIGN1ci5tZXRhLmNvbnN0cnVjdChwcm9wcylcbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgb2JqZWN0ID0gY3VyXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHJldHVybiBvYmplY3RcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBwcmVwYXJlTWV0YSA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBwcmVwYXJlUHJvcGVydGllcyA6IGZ1bmN0aW9uIChuYW1lLCBwcm9wcywgZGVmYXVsdE1ldGEsIGNhbGxiYWNrKSB7XG4gICAgICAgICAgICBpZiAobmFtZSAmJiB0eXBlb2YgbmFtZSAhPSAnc3RyaW5nJykge1xuICAgICAgICAgICAgICAgIHByb3BzICAgPSBuYW1lXG4gICAgICAgICAgICAgICAgbmFtZSAgICA9IG51bGxcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdmFyIG1ldGFcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKHByb3BzICYmIHByb3BzLm1ldGEpIHtcbiAgICAgICAgICAgICAgICBtZXRhID0gcHJvcHMubWV0YVxuICAgICAgICAgICAgICAgIGRlbGV0ZSBwcm9wcy5tZXRhXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmICghbWV0YSlcbiAgICAgICAgICAgICAgICBpZiAocHJvcHMgJiYgdHlwZW9mIHByb3BzLmlzYSA9PSAnZnVuY3Rpb24nICYmIHByb3BzLmlzYS5tZXRhKVxuICAgICAgICAgICAgICAgICAgICBtZXRhID0gcHJvcHMuaXNhLm1ldGEuY29uc3RydWN0b3JcbiAgICAgICAgICAgICAgICBlbHNlXG4gICAgICAgICAgICAgICAgICAgIG1ldGEgPSBkZWZhdWx0TWV0YVxuICAgICAgICAgICAgXG4gICAgICAgICAgICByZXR1cm4gY2FsbGJhY2suY2FsbCh0aGlzLCBuYW1lLCBtZXRhLCBwcm9wcylcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBnZXREZWZhdWx0SGVscGVyRm9yIDogZnVuY3Rpb24gKG1ldGFDbGFzcykge1xuICAgICAgICAgICAgdmFyIG1lID0gdGhpc1xuICAgICAgICAgICAgXG4gICAgICAgICAgICByZXR1cm4gZnVuY3Rpb24gKG5hbWUsIHByb3BzKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIG1lLnByZXBhcmVQcm9wZXJ0aWVzKG5hbWUsIHByb3BzLCBtZXRhQ2xhc3MsIGZ1bmN0aW9uIChuYW1lLCBtZXRhLCBwcm9wcykge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gbWUuY3JlYXRlKG5hbWUsIG1ldGEsIHByb3BzKVxuICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgcmVnaXN0ZXIgOiBmdW5jdGlvbiAoaGVscGVyTmFtZSwgbWV0YUNsYXNzLCBmdW5jKSB7XG4gICAgICAgICAgICB2YXIgbWUgPSB0aGlzXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmICh0aGlzLm1ldGEuaGFzTWV0aG9kKGhlbHBlck5hbWUpKSB7XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgdmFyIGhlbHBlciA9IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIG1lWyBoZWxwZXJOYW1lIF0uYXBwbHkobWUsIGFyZ3VtZW50cylcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgaWYgKCFKb29zZS50b3BbIGhlbHBlck5hbWUgXSkgICBKb29zZS50b3BbIGhlbHBlck5hbWUgXSAgICAgICAgID0gaGVscGVyXG4gICAgICAgICAgICAgICAgaWYgKCFKb29zZVsgaGVscGVyTmFtZSBdKSAgICAgICBKb29zZVsgaGVscGVyTmFtZSBdICAgICAgICAgICAgID0gaGVscGVyXG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgaWYgKEpvb3NlLmlzX05vZGVKUyAmJiB0eXBlb2YgZXhwb3J0cyAhPSAndW5kZWZpbmVkJykgICAgICAgICAgICBleHBvcnRzWyBoZWxwZXJOYW1lIF0gICAgPSBoZWxwZXJcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgdmFyIG1ldGhvZHMgPSB7fVxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIG1ldGhvZHNbIGhlbHBlck5hbWUgXSA9IGZ1bmMgfHwgdGhpcy5nZXREZWZhdWx0SGVscGVyRm9yKG1ldGFDbGFzcylcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICB0aGlzLm1ldGEuZXh0ZW5kKHtcbiAgICAgICAgICAgICAgICAgICAgbWV0aG9kcyA6IG1ldGhvZHNcbiAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIHRoaXMucmVnaXN0ZXIoaGVscGVyTmFtZSlcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBNb2R1bGUgOiBmdW5jdGlvbiAobmFtZSwgcHJvcHMpIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLnByZXBhcmVQcm9wZXJ0aWVzKG5hbWUsIHByb3BzLCBKb29zZS5OYW1lc3BhY2UuS2VlcGVyLCBmdW5jdGlvbiAobmFtZSwgbWV0YSwgcHJvcHMpIHtcbiAgICAgICAgICAgICAgICBpZiAodHlwZW9mIHByb3BzID09ICdmdW5jdGlvbicpIHByb3BzID0geyBib2R5IDogcHJvcHMgfSAgICBcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5jcmVhdGUobmFtZSwgbWV0YSwgcHJvcHMpXG4gICAgICAgICAgICB9KVxuICAgICAgICB9XG4gICAgfVxuICAgIFxufSkuY1xuXG5Kb29zZS5OYW1lc3BhY2UuTWFuYWdlci5teSA9IG5ldyBKb29zZS5OYW1lc3BhY2UuTWFuYWdlcigpXG5cbkpvb3NlLk5hbWVzcGFjZS5NYW5hZ2VyLm15LnJlZ2lzdGVyKCdDbGFzcycsIEpvb3NlLk1ldGEuQ2xhc3MpXG5Kb29zZS5OYW1lc3BhY2UuTWFuYWdlci5teS5yZWdpc3RlcignUm9sZScsIEpvb3NlLk1ldGEuUm9sZSlcbkpvb3NlLk5hbWVzcGFjZS5NYW5hZ2VyLm15LnJlZ2lzdGVyKCdNb2R1bGUnKVxuXG5cbi8vIGZvciB0aGUgcmVzdCBvZiB0aGUgcGFja2FnZVxudmFyIENsYXNzICAgICAgID0gSm9vc2UuQ2xhc3NcbnZhciBSb2xlICAgICAgICA9IEpvb3NlLlJvbGVcbjtcblJvbGUoJ0pvb3NlLkF0dHJpYnV0ZS5EZWxlZ2F0ZScsIHtcbiAgICBcbiAgICBoYXZlIDoge1xuICAgICAgICBoYW5kbGVzIDogbnVsbFxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgb3ZlcnJpZGUgOiB7XG4gICAgICAgIFxuICAgICAgICBlYWNoRGVsZWdhdGUgOiBmdW5jdGlvbiAoaGFuZGxlcywgZnVuYywgc2NvcGUpIHtcbiAgICAgICAgICAgIGlmICh0eXBlb2YgaGFuZGxlcyA9PSAnc3RyaW5nJykgcmV0dXJuIGZ1bmMuY2FsbChzY29wZSwgaGFuZGxlcywgaGFuZGxlcylcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKGhhbmRsZXMgaW5zdGFuY2VvZiBBcnJheSlcbiAgICAgICAgICAgICAgICByZXR1cm4gSm9vc2UuQS5lYWNoKGhhbmRsZXMsIGZ1bmN0aW9uIChkZWxlZ2F0ZVRvKSB7XG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICBmdW5jLmNhbGwoc2NvcGUsIGRlbGVnYXRlVG8sIGRlbGVnYXRlVG8pXG4gICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgIGlmIChoYW5kbGVzID09PSBPYmplY3QoaGFuZGxlcykpXG4gICAgICAgICAgICAgICAgSm9vc2UuTy5lYWNoT3duKGhhbmRsZXMsIGZ1bmN0aW9uIChkZWxlZ2F0ZVRvLCBoYW5kbGVBcykge1xuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgZnVuYy5jYWxsKHNjb3BlLCBoYW5kbGVBcywgZGVsZWdhdGVUbylcbiAgICAgICAgICAgICAgICB9KVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIGdldEFjY2Vzc29yc0ZvciA6IGZ1bmN0aW9uICh0YXJnZXRDbGFzcykge1xuICAgICAgICAgICAgdmFyIHRhcmdldE1ldGEgID0gdGFyZ2V0Q2xhc3MubWV0YVxuICAgICAgICAgICAgdmFyIG1ldGhvZHMgICAgID0gdGhpcy5TVVBFUih0YXJnZXRDbGFzcylcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdmFyIG1lICAgICAgPSB0aGlzXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXMuZWFjaERlbGVnYXRlKHRoaXMuaGFuZGxlcywgZnVuY3Rpb24gKGhhbmRsZUFzLCBkZWxlZ2F0ZVRvKSB7XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgaWYgKCF0YXJnZXRNZXRhLmhhc01ldGhvZChoYW5kbGVBcykpIHtcbiAgICAgICAgICAgICAgICAgICAgdmFyIGhhbmRsZXIgPSBtZXRob2RzWyBoYW5kbGVBcyBdID0gZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgdmFyIGF0dHJWYWx1ZSA9IG1lLmdldFZhbHVlRnJvbSh0aGlzKVxuICAgICAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gYXR0clZhbHVlWyBkZWxlZ2F0ZVRvIF0uYXBwbHkoYXR0clZhbHVlLCBhcmd1bWVudHMpXG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIGhhbmRsZXIuQUNDRVNTT1JfRlJPTSA9IG1lXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcmV0dXJuIG1ldGhvZHNcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBnZXRBY2Nlc3NvcnNGcm9tIDogZnVuY3Rpb24gKGZyb20pIHtcbiAgICAgICAgICAgIHZhciBtZXRob2RzID0gdGhpcy5TVVBFUihmcm9tKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB2YXIgbWUgICAgICAgICAgPSB0aGlzXG4gICAgICAgICAgICB2YXIgdGFyZ2V0TWV0YSAgPSBmcm9tLm1ldGFcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpcy5lYWNoRGVsZWdhdGUodGhpcy5oYW5kbGVzLCBmdW5jdGlvbiAoaGFuZGxlQXMpIHtcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICB2YXIgaGFuZGxlciA9IHRhcmdldE1ldGEuZ2V0TWV0aG9kKGhhbmRsZUFzKVxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIGlmIChoYW5kbGVyICYmIGhhbmRsZXIudmFsdWUuQUNDRVNTT1JfRlJPTSA9PSBtZSkgbWV0aG9kcy5wdXNoKGhhbmRsZUFzKVxuICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcmV0dXJuIG1ldGhvZHNcbiAgICAgICAgfVxuICAgIH1cbn0pXG5cbjtcblJvbGUoJ0pvb3NlLkF0dHJpYnV0ZS5UcmlnZ2VyJywge1xuICAgIFxuICAgIGhhdmUgOiB7XG4gICAgICAgIHRyaWdnZXIgICAgICAgIDogbnVsbFxuICAgIH0sIFxuXG4gICAgXG4gICAgYWZ0ZXIgOiB7XG4gICAgICAgIGluaXRpYWxpemUgOiBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgIGlmICh0aGlzLnRyaWdnZXIpIHtcbiAgICAgICAgICAgICAgICBpZiAoIXRoaXMud3JpdGVhYmxlKSB0aHJvdyBuZXcgRXJyb3IoXCJDYW4ndCB1c2UgYHRyaWdnZXJgIGZvciByZWFkLW9ubHkgYXR0cmlidXRlc1wiKVxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIHRoaXMuaGFzU2V0dGVyID0gdHJ1ZVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBvdmVycmlkZSA6IHtcbiAgICAgICAgXG4gICAgICAgIGdldFNldHRlciA6IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgdmFyIG9yaWdpbmFsICAgID0gdGhpcy5TVVBFUigpXG4gICAgICAgICAgICB2YXIgdHJpZ2dlciAgICAgPSB0aGlzLnRyaWdnZXJcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKCF0cmlnZ2VyKSByZXR1cm4gb3JpZ2luYWxcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdmFyIG1lICAgICAgPSB0aGlzXG4gICAgICAgICAgICB2YXIgaW5pdCAgICA9IEpvb3NlLk8uaXNGdW5jdGlvbihtZS5pbml0KSA/IG51bGwgOiBtZS5pbml0XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHJldHVybiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgICAgdmFyIG9sZFZhbHVlICAgID0gbWUuaGFzVmFsdWUodGhpcykgPyBtZS5nZXRWYWx1ZUZyb20odGhpcykgOiBpbml0XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgdmFyIHJlcyAgICAgICAgID0gb3JpZ2luYWwuYXBwbHkodGhpcywgYXJndW1lbnRzKVxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIHRyaWdnZXIuY2FsbCh0aGlzLCBtZS5nZXRWYWx1ZUZyb20odGhpcyksIG9sZFZhbHVlKVxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIHJldHVybiByZXNcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cbn0pICAgIFxuXG47XG5Sb2xlKCdKb29zZS5BdHRyaWJ1dGUuTGF6eScsIHtcbiAgICBcbiAgICBcbiAgICBoYXZlIDoge1xuICAgICAgICBsYXp5ICAgICAgICA6IG51bGxcbiAgICB9LCBcbiAgICBcbiAgICBcbiAgICBiZWZvcmUgOiB7XG4gICAgICAgIGNvbXB1dGVWYWx1ZSA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIGlmICh0eXBlb2YgdGhpcy5pbml0ID09ICdmdW5jdGlvbicgJiYgdGhpcy5sYXp5KSB7XG4gICAgICAgICAgICAgICAgdGhpcy5sYXp5ID0gdGhpcy5pbml0ICAgIFxuICAgICAgICAgICAgICAgIGRlbGV0ZSB0aGlzLmluaXQgICAgXG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGFmdGVyIDoge1xuICAgICAgICBpbml0aWFsaXplIDogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgaWYgKHRoaXMubGF6eSkgdGhpcy5yZWFkYWJsZSA9IHRoaXMuaGFzR2V0dGVyID0gdHJ1ZVxuICAgICAgICB9XG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBvdmVycmlkZSA6IHtcbiAgICAgICAgXG4gICAgICAgIGdldEdldHRlciA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHZhciBvcmlnaW5hbCAgICA9IHRoaXMuU1VQRVIoKVxuICAgICAgICAgICAgdmFyIGxhenkgICAgICAgID0gdGhpcy5sYXp5XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmICghbGF6eSkgcmV0dXJuIG9yaWdpbmFsXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciBtZSAgICAgID0gdGhpcyAgICBcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcmV0dXJuIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgICBpZiAoIW1lLmhhc1ZhbHVlKHRoaXMpKSB7XG4gICAgICAgICAgICAgICAgICAgIHZhciBpbml0aWFsaXplciA9IHR5cGVvZiBsYXp5ID09ICdmdW5jdGlvbicgPyBsYXp5IDogdGhpc1sgbGF6eS5yZXBsYWNlKC9edGhpc1xcLi8sICcnKSBdXG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICBtZS5zZXRWYWx1ZVRvKHRoaXMsIGluaXRpYWxpemVyLmFwcGx5KHRoaXMsIGFyZ3VtZW50cykpXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIHJldHVybiBvcmlnaW5hbC5jYWxsKHRoaXMpICAgIFxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxufSlcblxuO1xuUm9sZSgnSm9vc2UuQXR0cmlidXRlLkFjY2Vzc29yLkNvbWJpbmVkJywge1xuICAgIFxuICAgIFxuICAgIGhhdmUgOiB7XG4gICAgICAgIGlzQ29tYmluZWQgICAgICAgIDogZmFsc2VcbiAgICB9LCBcbiAgICBcbiAgICBcbiAgICBhZnRlciA6IHtcbiAgICAgICAgaW5pdGlhbGl6ZSA6IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgdGhpcy5pc0NvbWJpbmVkID0gdGhpcy5pc0NvbWJpbmVkIHx8IC8uLmMvaS50ZXN0KHRoaXMuaXMpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmICh0aGlzLmlzQ29tYmluZWQpIHtcbiAgICAgICAgICAgICAgICB0aGlzLnNsb3QgPSAnJCQnICsgdGhpcy5uYW1lXG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgdGhpcy5oYXNHZXR0ZXIgPSB0cnVlXG4gICAgICAgICAgICAgICAgdGhpcy5oYXNTZXR0ZXIgPSBmYWxzZVxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIHRoaXMuc2V0dGVyTmFtZSA9IHRoaXMuZ2V0dGVyTmFtZSA9IHRoaXMucHVibGljTmFtZVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBvdmVycmlkZSA6IHtcbiAgICAgICAgXG4gICAgICAgIGdldEdldHRlciA6IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgdmFyIGdldHRlciAgICA9IHRoaXMuU1VQRVIoKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAoIXRoaXMuaXNDb21iaW5lZCkgcmV0dXJuIGdldHRlclxuICAgICAgICAgICAgXG4gICAgICAgICAgICB2YXIgc2V0dGVyICAgID0gdGhpcy5nZXRTZXR0ZXIoKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB2YXIgbWUgPSB0aGlzXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHJldHVybiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgaWYgKCFhcmd1bWVudHMubGVuZ3RoKSB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChtZS5yZWFkYWJsZSkgcmV0dXJuIGdldHRlci5jYWxsKHRoaXMpXG4gICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcIkNhbGwgdG8gZ2V0dGVyIG9mIHVucmVhZGFibGUgYXR0cmlidXRlOiBbXCIgKyBtZS5uYW1lICsgXCJdXCIpXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIGlmIChtZS53cml0ZWFibGUpIHJldHVybiBzZXR0ZXIuYXBwbHkodGhpcywgYXJndW1lbnRzKVxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcIkNhbGwgdG8gc2V0dGVyIG9mIHJlYWQtb25seSBhdHRyaWJ1dGU6IFtcIiArIG1lLm5hbWUgKyBcIl1cIikgICAgXG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG4gICAgXG59KVxuXG47XG5Kb29zZS5NYW5hZ2VkLkF0dHJpYnV0ZS5tZXRhLmV4dGVuZCh7XG4gICAgZG9lcyA6IFsgSm9vc2UuQXR0cmlidXRlLkRlbGVnYXRlLCBKb29zZS5BdHRyaWJ1dGUuVHJpZ2dlciwgSm9vc2UuQXR0cmlidXRlLkxhenksIEpvb3NlLkF0dHJpYnV0ZS5BY2Nlc3Nvci5Db21iaW5lZCBdXG59KSAgICAgICAgICAgIFxuXG47XG5Sb2xlKCdKb29zZS5NZXRhLlNpbmdsZXRvbicsIHtcbiAgICBcbiAgICBoYXMgOiB7XG4gICAgICAgIGZvcmNlSW5zdGFuY2UgICAgICAgICAgIDogSm9vc2UuSS5PYmplY3QsXG4gICAgICAgIGluc3RhbmNlICAgICAgICAgICAgICAgIDogbnVsbFxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgXG4gICAgb3ZlcnJpZGUgOiB7XG4gICAgICAgIFxuICAgICAgICBkZWZhdWx0Q29uc3RydWN0b3IgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB2YXIgbWV0YSAgICAgICAgPSB0aGlzXG4gICAgICAgICAgICB2YXIgcHJldmlvdXMgICAgPSB0aGlzLlNVUEVSKClcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpcy5hZGFwdENvbnN0cnVjdG9yKHByZXZpb3VzKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICByZXR1cm4gZnVuY3Rpb24gKGZvcmNlSW5zdGFuY2UsIHBhcmFtcykge1xuICAgICAgICAgICAgICAgIGlmIChmb3JjZUluc3RhbmNlID09IG1ldGEuZm9yY2VJbnN0YW5jZSkgcmV0dXJuIHByZXZpb3VzLmFwcGx5KHRoaXMsIHBhcmFtcykgfHwgdGhpc1xuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIHZhciBpbnN0YW5jZSA9IG1ldGEuaW5zdGFuY2VcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBpZiAoaW5zdGFuY2UpIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKG1ldGEuaGFzTWV0aG9kKCdjb25maWd1cmUnKSkgaW5zdGFuY2UuY29uZmlndXJlLmFwcGx5KGluc3RhbmNlLCBhcmd1bWVudHMpXG4gICAgICAgICAgICAgICAgfSBlbHNlXG4gICAgICAgICAgICAgICAgICAgIG1ldGEuaW5zdGFuY2UgPSBuZXcgbWV0YS5jKG1ldGEuZm9yY2VJbnN0YW5jZSwgYXJndW1lbnRzKVxuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICByZXR1cm4gbWV0YS5pbnN0YW5jZVxuICAgICAgICAgICAgfVxuICAgICAgICB9ICAgICAgICBcbiAgICB9XG4gICAgXG5cbn0pXG5cblxuSm9vc2UuTmFtZXNwYWNlLk1hbmFnZXIubXkucmVnaXN0ZXIoJ1NpbmdsZXRvbicsIENsYXNzKHtcbiAgICBpc2EgICAgIDogSm9vc2UuTWV0YS5DbGFzcyxcbiAgICBtZXRhICAgIDogSm9vc2UuTWV0YS5DbGFzcyxcbiAgICBcbiAgICBkb2VzICAgIDogSm9vc2UuTWV0YS5TaW5nbGV0b25cbn0pKVxuO1xuO1xufSgpOztcbiIsIi8vIGV4cG9zZSBtb2R1bGUgY2xhc3Nlc1xyXG5cclxuZXhwb3J0cy5JbnRlcnNlY3Rpb24gPSByZXF1aXJlKCcuL2xpYi9JbnRlcnNlY3Rpb24nKTtcclxuZXhwb3J0cy5JbnRlcnNlY3Rpb25QYXJhbXMgPSByZXF1aXJlKCcuL2xpYi9JbnRlcnNlY3Rpb25QYXJhbXMnKTtcclxuXHJcbi8vIGV4cG9zZSBhZmZpbmUgbW9kdWxlIGNsYXNzZXNcclxuZXhwb3J0cy5Qb2ludDJEID0gcmVxdWlyZSgna2xkLWFmZmluZScpLlBvaW50MkQ7XHJcbiIsIi8qKlxyXG4gKlxyXG4gKiAgSW50ZXJzZWN0aW9uLmpzXHJcbiAqXHJcbiAqICBjb3B5cmlnaHQgMjAwMiwgMjAxMyBLZXZpbiBMaW5kc2V5XHJcbiAqXHJcbiAqL1xyXG5cclxudmFyIFBvaW50MkQgPSByZXF1aXJlKCdrbGQtYWZmaW5lJykuUG9pbnQyRCxcclxuICAgIFZlY3RvcjJEID0gcmVxdWlyZSgna2xkLWFmZmluZScpLlZlY3RvcjJELFxyXG4gICAgUG9seW5vbWlhbCA9IHJlcXVpcmUoJ2tsZC1wb2x5bm9taWFsJykuUG9seW5vbWlhbDtcclxuXHJcbi8qKlxyXG4gKiAgSW50ZXJzZWN0aW9uXHJcbiAqL1xyXG5mdW5jdGlvbiBJbnRlcnNlY3Rpb24oc3RhdHVzKSB7XHJcbiAgICB0aGlzLmluaXQoc3RhdHVzKTtcclxufVxyXG5cclxuLyoqXHJcbiAqICBpbml0XHJcbiAqXHJcbiAqICBAcGFyYW0ge1N0cmluZ30gc3RhdHVzXHJcbiAqICBAcmV0dXJucyB7SW50ZXJzZWN0aW9ufVxyXG4gKi9cclxuSW50ZXJzZWN0aW9uLnByb3RvdHlwZS5pbml0ID0gZnVuY3Rpb24oc3RhdHVzKSB7XHJcbiAgICB0aGlzLnN0YXR1cyA9IHN0YXR1cztcclxuICAgIHRoaXMucG9pbnRzID0gbmV3IEFycmF5KCk7XHJcbn07XHJcblxyXG4vKipcclxuICogIGFwcGVuZFBvaW50XHJcbiAqXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IHBvaW50XHJcbiAqL1xyXG5JbnRlcnNlY3Rpb24ucHJvdG90eXBlLmFwcGVuZFBvaW50ID0gZnVuY3Rpb24ocG9pbnQpIHtcclxuICAgIHRoaXMucG9pbnRzLnB1c2gocG9pbnQpO1xyXG59O1xyXG5cclxuLyoqXHJcbiAqICBhcHBlbmRQb2ludHNcclxuICpcclxuICogIEBwYXJhbSB7QXJyYXk8UG9pbnQyRD59IHBvaW50c1xyXG4gKi9cclxuSW50ZXJzZWN0aW9uLnByb3RvdHlwZS5hcHBlbmRQb2ludHMgPSBmdW5jdGlvbihwb2ludHMpIHtcclxuICAgIHRoaXMucG9pbnRzID0gdGhpcy5wb2ludHMuY29uY2F0KHBvaW50cyk7XHJcbn07XHJcblxyXG4vLyBzdGF0aWMgbWV0aG9kc1xyXG5cclxuLyoqXHJcbiAqICBpbnRlcnNlY3RTaGFwZXNcclxuICpcclxuICogIEBwYXJhbSB7SW50ZXJzZWN0aW9uUGFyYW1zfSBzaGFwZTFcclxuICogIEBwYXJhbSB7SW50ZXJzZWN0aW9uUGFyYW1zfSBzaGFwZTJcclxuICogIEByZXR1cm5zIHtJbnRlcnNlY3Rpb259XHJcbiAqL1xyXG5JbnRlcnNlY3Rpb24uaW50ZXJzZWN0U2hhcGVzID0gZnVuY3Rpb24oc2hhcGUxLCBzaGFwZTIpIHtcclxuICAgIHZhciBpcDEgPSBzaGFwZTEuZ2V0SW50ZXJzZWN0aW9uUGFyYW1zKCk7XHJcbiAgICB2YXIgaXAyID0gc2hhcGUyLmdldEludGVyc2VjdGlvblBhcmFtcygpO1xyXG4gICAgdmFyIHJlc3VsdDtcclxuXHJcbiAgICBpZiAoIGlwMSAhPSBudWxsICYmIGlwMiAhPSBudWxsICkge1xyXG4gICAgICAgIGlmICggaXAxLm5hbWUgPT0gXCJQYXRoXCIgKSB7XHJcbiAgICAgICAgICAgIHJlc3VsdCA9IEludGVyc2VjdGlvbi5pbnRlcnNlY3RQYXRoU2hhcGUoc2hhcGUxLCBzaGFwZTIpO1xyXG4gICAgICAgIH0gZWxzZSBpZiAoIGlwMi5uYW1lID09IFwiUGF0aFwiICkge1xyXG4gICAgICAgICAgICByZXN1bHQgPSBJbnRlcnNlY3Rpb24uaW50ZXJzZWN0UGF0aFNoYXBlKHNoYXBlMiwgc2hhcGUxKTtcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICB2YXIgbWV0aG9kO1xyXG4gICAgICAgICAgICB2YXIgcGFyYW1zO1xyXG5cclxuICAgICAgICAgICAgaWYgKCBpcDEubmFtZSA8IGlwMi5uYW1lICkge1xyXG4gICAgICAgICAgICAgICAgbWV0aG9kID0gXCJpbnRlcnNlY3RcIiArIGlwMS5uYW1lICsgaXAyLm5hbWU7XHJcbiAgICAgICAgICAgICAgICBwYXJhbXMgPSBpcDEucGFyYW1zLmNvbmNhdCggaXAyLnBhcmFtcyApO1xyXG4gICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgbWV0aG9kID0gXCJpbnRlcnNlY3RcIiArIGlwMi5uYW1lICsgaXAxLm5hbWU7XHJcbiAgICAgICAgICAgICAgICBwYXJhbXMgPSBpcDIucGFyYW1zLmNvbmNhdCggaXAxLnBhcmFtcyApO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICBpZiAoICEobWV0aG9kIGluIEludGVyc2VjdGlvbikgKVxyXG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiSW50ZXJzZWN0aW9uIG5vdCBhdmFpbGFibGU6IFwiICsgbWV0aG9kKTtcclxuXHJcbiAgICAgICAgICAgIHJlc3VsdCA9IEludGVyc2VjdGlvblttZXRob2RdLmFwcGx5KG51bGwsIHBhcmFtcyk7XHJcbiAgICAgICAgfVxyXG4gICAgfSBlbHNlIHtcclxuICAgICAgICByZXN1bHQgPSBuZXcgSW50ZXJzZWN0aW9uKFwiTm8gSW50ZXJzZWN0aW9uXCIpO1xyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiByZXN1bHQ7XHJcbn07XHJcblxyXG4vKipcclxuICogIGludGVyc2VjdFBhdGhTaGFwZVxyXG4gKlxyXG4gKiAgQHBhcmFtIHtJbnRlcnNlY3Rpb25QYXJhbXN9IHBhdGhcclxuICogIEBwYXJhbSB7SW50ZXJzZWN0aW9uUGFyYW1zfSBzaGFwZVxyXG4gKiAgQHJldHVybnMge0ludGVyc2VjdGlvbn1cclxuICovXHJcbkludGVyc2VjdGlvbi5pbnRlcnNlY3RQYXRoU2hhcGUgPSBmdW5jdGlvbihwYXRoLCBzaGFwZSkge1xyXG4gICAgcmV0dXJuIHBhdGguaW50ZXJzZWN0U2hhcGUoc2hhcGUpO1xyXG59O1xyXG5cclxuLyoqXHJcbiAqICBpbnRlcnNlY3RCZXppZXIyQmV6aWVyMlxyXG4gKlxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBhMVxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBhMlxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBhM1xyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBiMVxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBiMlxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBiM1xyXG4gKiAgQHJldHVybnMge0ludGVyc2VjdGlvbn1cclxuICovXHJcbkludGVyc2VjdGlvbi5pbnRlcnNlY3RCZXppZXIyQmV6aWVyMiA9IGZ1bmN0aW9uKGExLCBhMiwgYTMsIGIxLCBiMiwgYjMpIHtcclxuICAgIHZhciBhLCBiO1xyXG4gICAgdmFyIGMxMiwgYzExLCBjMTA7XHJcbiAgICB2YXIgYzIyLCBjMjEsIGMyMDtcclxuICAgIHZhciByZXN1bHQgPSBuZXcgSW50ZXJzZWN0aW9uKFwiTm8gSW50ZXJzZWN0aW9uXCIpO1xyXG4gICAgdmFyIHBvbHk7XHJcblxyXG4gICAgYSA9IGEyLm11bHRpcGx5KC0yKTtcclxuICAgIGMxMiA9IGExLmFkZChhLmFkZChhMykpO1xyXG5cclxuICAgIGEgPSBhMS5tdWx0aXBseSgtMik7XHJcbiAgICBiID0gYTIubXVsdGlwbHkoMik7XHJcbiAgICBjMTEgPSBhLmFkZChiKTtcclxuXHJcbiAgICBjMTAgPSBuZXcgUG9pbnQyRChhMS54LCBhMS55KTtcclxuXHJcbiAgICBhID0gYjIubXVsdGlwbHkoLTIpO1xyXG4gICAgYzIyID0gYjEuYWRkKGEuYWRkKGIzKSk7XHJcblxyXG4gICAgYSA9IGIxLm11bHRpcGx5KC0yKTtcclxuICAgIGIgPSBiMi5tdWx0aXBseSgyKTtcclxuICAgIGMyMSA9IGEuYWRkKGIpO1xyXG5cclxuICAgIGMyMCA9IG5ldyBQb2ludDJEKGIxLngsIGIxLnkpO1xyXG5cclxuICAgIGlmICggYzEyLnkgPT0gMCApIHtcclxuICAgICAgICB2YXIgdjAgPSBjMTIueCooYzEwLnkgLSBjMjAueSk7XHJcbiAgICAgICAgdmFyIHYxID0gdjAgLSBjMTEueCpjMTEueTtcclxuICAgICAgICB2YXIgdjIgPSB2MCArIHYxO1xyXG4gICAgICAgIHZhciB2MyA9IGMxMS55KmMxMS55O1xyXG5cclxuICAgICAgICBwb2x5ID0gbmV3IFBvbHlub21pYWwoXHJcbiAgICAgICAgICAgIGMxMi54KmMyMi55KmMyMi55LFxyXG4gICAgICAgICAgICAyKmMxMi54KmMyMS55KmMyMi55LFxyXG4gICAgICAgICAgICBjMTIueCpjMjEueSpjMjEueSAtIGMyMi54KnYzIC0gYzIyLnkqdjAgLSBjMjIueSp2MSxcclxuICAgICAgICAgICAgLWMyMS54KnYzIC0gYzIxLnkqdjAgLSBjMjEueSp2MSxcclxuICAgICAgICAgICAgKGMxMC54IC0gYzIwLngpKnYzICsgKGMxMC55IC0gYzIwLnkpKnYxXHJcbiAgICAgICAgKTtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgICAgdmFyIHYwID0gYzEyLngqYzIyLnkgLSBjMTIueSpjMjIueDtcclxuICAgICAgICB2YXIgdjEgPSBjMTIueCpjMjEueSAtIGMyMS54KmMxMi55O1xyXG4gICAgICAgIHZhciB2MiA9IGMxMS54KmMxMi55IC0gYzExLnkqYzEyLng7XHJcbiAgICAgICAgdmFyIHYzID0gYzEwLnkgLSBjMjAueTtcclxuICAgICAgICB2YXIgdjQgPSBjMTIueSooYzEwLnggLSBjMjAueCkgLSBjMTIueCp2MztcclxuICAgICAgICB2YXIgdjUgPSAtYzExLnkqdjIgKyBjMTIueSp2NDtcclxuICAgICAgICB2YXIgdjYgPSB2Mip2MjtcclxuXHJcbiAgICAgICAgcG9seSA9IG5ldyBQb2x5bm9taWFsKFxyXG4gICAgICAgICAgICB2MCp2MCxcclxuICAgICAgICAgICAgMip2MCp2MSxcclxuICAgICAgICAgICAgKC1jMjIueSp2NiArIGMxMi55KnYxKnYxICsgYzEyLnkqdjAqdjQgKyB2MCp2NSkgLyBjMTIueSxcclxuICAgICAgICAgICAgKC1jMjEueSp2NiArIGMxMi55KnYxKnY0ICsgdjEqdjUpIC8gYzEyLnksXHJcbiAgICAgICAgICAgICh2Myp2NiArIHY0KnY1KSAvIGMxMi55XHJcbiAgICAgICAgKTtcclxuICAgIH1cclxuXHJcbiAgICB2YXIgcm9vdHMgPSBwb2x5LmdldFJvb3RzKCk7XHJcbiAgICBmb3IgKCB2YXIgaSA9IDA7IGkgPCByb290cy5sZW5ndGg7IGkrKyApIHtcclxuICAgICAgICB2YXIgcyA9IHJvb3RzW2ldO1xyXG5cclxuICAgICAgICBpZiAoIDAgPD0gcyAmJiBzIDw9IDEgKSB7XHJcbiAgICAgICAgICAgIHZhciB4Um9vdHMgPSBuZXcgUG9seW5vbWlhbChcclxuICAgICAgICAgICAgICAgIGMxMi54LFxyXG4gICAgICAgICAgICAgICAgYzExLngsXHJcbiAgICAgICAgICAgICAgICBjMTAueCAtIGMyMC54IC0gcypjMjEueCAtIHMqcypjMjIueFxyXG4gICAgICAgICAgICApLmdldFJvb3RzKCk7XHJcbiAgICAgICAgICAgIHZhciB5Um9vdHMgPSBuZXcgUG9seW5vbWlhbChcclxuICAgICAgICAgICAgICAgIGMxMi55LFxyXG4gICAgICAgICAgICAgICAgYzExLnksXHJcbiAgICAgICAgICAgICAgICBjMTAueSAtIGMyMC55IC0gcypjMjEueSAtIHMqcypjMjIueVxyXG4gICAgICAgICAgICApLmdldFJvb3RzKCk7XHJcblxyXG4gICAgICAgICAgICBpZiAoIHhSb290cy5sZW5ndGggPiAwICYmIHlSb290cy5sZW5ndGggPiAwICkge1xyXG4gICAgICAgICAgICAgICAgdmFyIFRPTEVSQU5DRSA9IDFlLTQ7XHJcblxyXG4gICAgICAgICAgICAgICAgY2hlY2tSb290czpcclxuICAgICAgICAgICAgICAgIGZvciAoIHZhciBqID0gMDsgaiA8IHhSb290cy5sZW5ndGg7IGorKyApIHtcclxuICAgICAgICAgICAgICAgICAgICB2YXIgeFJvb3QgPSB4Um9vdHNbal07XHJcblxyXG4gICAgICAgICAgICAgICAgICAgIGlmICggMCA8PSB4Um9vdCAmJiB4Um9vdCA8PSAxICkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBmb3IgKCB2YXIgayA9IDA7IGsgPCB5Um9vdHMubGVuZ3RoOyBrKysgKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoIE1hdGguYWJzKCB4Um9vdCAtIHlSb290c1trXSApIDwgVE9MRVJBTkNFICkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJlc3VsdC5wb2ludHMucHVzaCggYzIyLm11bHRpcGx5KHMqcykuYWRkKGMyMS5tdWx0aXBseShzKS5hZGQoYzIwKSkgKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBicmVhayBjaGVja1Jvb3RzO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIGlmICggcmVzdWx0LnBvaW50cy5sZW5ndGggPiAwICkgcmVzdWx0LnN0YXR1cyA9IFwiSW50ZXJzZWN0aW9uXCI7XHJcblxyXG4gICAgcmV0dXJuIHJlc3VsdDtcclxufTtcclxuXHJcblxyXG4vKipcclxuICogIGludGVyc2VjdEJlemllcjJCZXppZXIzXHJcbiAqXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IGExXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IGEyXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IGEzXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IGIxXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IGIyXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IGIzXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IGI0XHJcbiAqICBAcmV0dXJucyB7SW50ZXJzZWN0aW9ufVxyXG4gKi9cclxuSW50ZXJzZWN0aW9uLmludGVyc2VjdEJlemllcjJCZXppZXIzID0gZnVuY3Rpb24oYTEsIGEyLCBhMywgYjEsIGIyLCBiMywgYjQpIHtcclxuICAgIHZhciBhLCBiLGMsIGQ7XHJcbiAgICB2YXIgYzEyLCBjMTEsIGMxMDtcclxuICAgIHZhciBjMjMsIGMyMiwgYzIxLCBjMjA7XHJcbiAgICB2YXIgcmVzdWx0ID0gbmV3IEludGVyc2VjdGlvbihcIk5vIEludGVyc2VjdGlvblwiKTtcclxuXHJcbiAgICBhID0gYTIubXVsdGlwbHkoLTIpO1xyXG4gICAgYzEyID0gYTEuYWRkKGEuYWRkKGEzKSk7XHJcblxyXG4gICAgYSA9IGExLm11bHRpcGx5KC0yKTtcclxuICAgIGIgPSBhMi5tdWx0aXBseSgyKTtcclxuICAgIGMxMSA9IGEuYWRkKGIpO1xyXG5cclxuICAgIGMxMCA9IG5ldyBQb2ludDJEKGExLngsIGExLnkpO1xyXG5cclxuICAgIGEgPSBiMS5tdWx0aXBseSgtMSk7XHJcbiAgICBiID0gYjIubXVsdGlwbHkoMyk7XHJcbiAgICBjID0gYjMubXVsdGlwbHkoLTMpO1xyXG4gICAgZCA9IGEuYWRkKGIuYWRkKGMuYWRkKGI0KSkpO1xyXG4gICAgYzIzID0gbmV3IFZlY3RvcjJEKGQueCwgZC55KTtcclxuXHJcbiAgICBhID0gYjEubXVsdGlwbHkoMyk7XHJcbiAgICBiID0gYjIubXVsdGlwbHkoLTYpO1xyXG4gICAgYyA9IGIzLm11bHRpcGx5KDMpO1xyXG4gICAgZCA9IGEuYWRkKGIuYWRkKGMpKTtcclxuICAgIGMyMiA9IG5ldyBWZWN0b3IyRChkLngsIGQueSk7XHJcblxyXG4gICAgYSA9IGIxLm11bHRpcGx5KC0zKTtcclxuICAgIGIgPSBiMi5tdWx0aXBseSgzKTtcclxuICAgIGMgPSBhLmFkZChiKTtcclxuICAgIGMyMSA9IG5ldyBWZWN0b3IyRChjLngsIGMueSk7XHJcblxyXG4gICAgYzIwID0gbmV3IFZlY3RvcjJEKGIxLngsIGIxLnkpO1xyXG5cclxuICAgIHZhciBjMTB4MiA9IGMxMC54KmMxMC54O1xyXG4gICAgdmFyIGMxMHkyID0gYzEwLnkqYzEwLnk7XHJcbiAgICB2YXIgYzExeDIgPSBjMTEueCpjMTEueDtcclxuICAgIHZhciBjMTF5MiA9IGMxMS55KmMxMS55O1xyXG4gICAgdmFyIGMxMngyID0gYzEyLngqYzEyLng7XHJcbiAgICB2YXIgYzEyeTIgPSBjMTIueSpjMTIueTtcclxuICAgIHZhciBjMjB4MiA9IGMyMC54KmMyMC54O1xyXG4gICAgdmFyIGMyMHkyID0gYzIwLnkqYzIwLnk7XHJcbiAgICB2YXIgYzIxeDIgPSBjMjEueCpjMjEueDtcclxuICAgIHZhciBjMjF5MiA9IGMyMS55KmMyMS55O1xyXG4gICAgdmFyIGMyMngyID0gYzIyLngqYzIyLng7XHJcbiAgICB2YXIgYzIyeTIgPSBjMjIueSpjMjIueTtcclxuICAgIHZhciBjMjN4MiA9IGMyMy54KmMyMy54O1xyXG4gICAgdmFyIGMyM3kyID0gYzIzLnkqYzIzLnk7XHJcblxyXG4gICAgdmFyIHBvbHkgPSBuZXcgUG9seW5vbWlhbChcclxuICAgICAgICAtMipjMTIueCpjMTIueSpjMjMueCpjMjMueSArIGMxMngyKmMyM3kyICsgYzEyeTIqYzIzeDIsXHJcbiAgICAgICAgLTIqYzEyLngqYzEyLnkqYzIyLngqYzIzLnkgLSAyKmMxMi54KmMxMi55KmMyMi55KmMyMy54ICsgMipjMTJ5MipjMjIueCpjMjMueCArXHJcbiAgICAgICAgICAgIDIqYzEyeDIqYzIyLnkqYzIzLnksXHJcbiAgICAgICAgLTIqYzEyLngqYzIxLngqYzEyLnkqYzIzLnkgLSAyKmMxMi54KmMxMi55KmMyMS55KmMyMy54IC0gMipjMTIueCpjMTIueSpjMjIueCpjMjIueSArXHJcbiAgICAgICAgICAgIDIqYzIxLngqYzEyeTIqYzIzLnggKyBjMTJ5MipjMjJ4MiArIGMxMngyKigyKmMyMS55KmMyMy55ICsgYzIyeTIpLFxyXG4gICAgICAgIDIqYzEwLngqYzEyLngqYzEyLnkqYzIzLnkgKyAyKmMxMC55KmMxMi54KmMxMi55KmMyMy54ICsgYzExLngqYzExLnkqYzEyLngqYzIzLnkgK1xyXG4gICAgICAgICAgICBjMTEueCpjMTEueSpjMTIueSpjMjMueCAtIDIqYzIwLngqYzEyLngqYzEyLnkqYzIzLnkgLSAyKmMxMi54KmMyMC55KmMxMi55KmMyMy54IC1cclxuICAgICAgICAgICAgMipjMTIueCpjMjEueCpjMTIueSpjMjIueSAtIDIqYzEyLngqYzEyLnkqYzIxLnkqYzIyLnggLSAyKmMxMC54KmMxMnkyKmMyMy54IC1cclxuICAgICAgICAgICAgMipjMTAueSpjMTJ4MipjMjMueSArIDIqYzIwLngqYzEyeTIqYzIzLnggKyAyKmMyMS54KmMxMnkyKmMyMi54IC1cclxuICAgICAgICAgICAgYzExeTIqYzEyLngqYzIzLnggLSBjMTF4MipjMTIueSpjMjMueSArIGMxMngyKigyKmMyMC55KmMyMy55ICsgMipjMjEueSpjMjIueSksXHJcbiAgICAgICAgMipjMTAueCpjMTIueCpjMTIueSpjMjIueSArIDIqYzEwLnkqYzEyLngqYzEyLnkqYzIyLnggKyBjMTEueCpjMTEueSpjMTIueCpjMjIueSArXHJcbiAgICAgICAgICAgIGMxMS54KmMxMS55KmMxMi55KmMyMi54IC0gMipjMjAueCpjMTIueCpjMTIueSpjMjIueSAtIDIqYzEyLngqYzIwLnkqYzEyLnkqYzIyLnggLVxyXG4gICAgICAgICAgICAyKmMxMi54KmMyMS54KmMxMi55KmMyMS55IC0gMipjMTAueCpjMTJ5MipjMjIueCAtIDIqYzEwLnkqYzEyeDIqYzIyLnkgK1xyXG4gICAgICAgICAgICAyKmMyMC54KmMxMnkyKmMyMi54IC0gYzExeTIqYzEyLngqYzIyLnggLSBjMTF4MipjMTIueSpjMjIueSArIGMyMXgyKmMxMnkyICtcclxuICAgICAgICAgICAgYzEyeDIqKDIqYzIwLnkqYzIyLnkgKyBjMjF5MiksXHJcbiAgICAgICAgMipjMTAueCpjMTIueCpjMTIueSpjMjEueSArIDIqYzEwLnkqYzEyLngqYzIxLngqYzEyLnkgKyBjMTEueCpjMTEueSpjMTIueCpjMjEueSArXHJcbiAgICAgICAgICAgIGMxMS54KmMxMS55KmMyMS54KmMxMi55IC0gMipjMjAueCpjMTIueCpjMTIueSpjMjEueSAtIDIqYzEyLngqYzIwLnkqYzIxLngqYzEyLnkgLVxyXG4gICAgICAgICAgICAyKmMxMC54KmMyMS54KmMxMnkyIC0gMipjMTAueSpjMTJ4MipjMjEueSArIDIqYzIwLngqYzIxLngqYzEyeTIgLVxyXG4gICAgICAgICAgICBjMTF5MipjMTIueCpjMjEueCAtIGMxMXgyKmMxMi55KmMyMS55ICsgMipjMTJ4MipjMjAueSpjMjEueSxcclxuICAgICAgICAtMipjMTAueCpjMTAueSpjMTIueCpjMTIueSAtIGMxMC54KmMxMS54KmMxMS55KmMxMi55IC0gYzEwLnkqYzExLngqYzExLnkqYzEyLnggK1xyXG4gICAgICAgICAgICAyKmMxMC54KmMxMi54KmMyMC55KmMxMi55ICsgMipjMTAueSpjMjAueCpjMTIueCpjMTIueSArIGMxMS54KmMyMC54KmMxMS55KmMxMi55ICtcclxuICAgICAgICAgICAgYzExLngqYzExLnkqYzEyLngqYzIwLnkgLSAyKmMyMC54KmMxMi54KmMyMC55KmMxMi55IC0gMipjMTAueCpjMjAueCpjMTJ5MiArXHJcbiAgICAgICAgICAgIGMxMC54KmMxMXkyKmMxMi54ICsgYzEwLnkqYzExeDIqYzEyLnkgLSAyKmMxMC55KmMxMngyKmMyMC55IC1cclxuICAgICAgICAgICAgYzIwLngqYzExeTIqYzEyLnggLSBjMTF4MipjMjAueSpjMTIueSArIGMxMHgyKmMxMnkyICsgYzEweTIqYzEyeDIgK1xyXG4gICAgICAgICAgICBjMjB4MipjMTJ5MiArIGMxMngyKmMyMHkyXHJcbiAgICApO1xyXG4gICAgdmFyIHJvb3RzID0gcG9seS5nZXRSb290c0luSW50ZXJ2YWwoMCwxKTtcclxuXHJcbiAgICBmb3IgKCB2YXIgaSA9IDA7IGkgPCByb290cy5sZW5ndGg7IGkrKyApIHtcclxuICAgICAgICB2YXIgcyA9IHJvb3RzW2ldO1xyXG4gICAgICAgIHZhciB4Um9vdHMgPSBuZXcgUG9seW5vbWlhbChcclxuICAgICAgICAgICAgYzEyLngsXHJcbiAgICAgICAgICAgIGMxMS54LFxyXG4gICAgICAgICAgICBjMTAueCAtIGMyMC54IC0gcypjMjEueCAtIHMqcypjMjIueCAtIHMqcypzKmMyMy54XHJcbiAgICAgICAgKS5nZXRSb290cygpO1xyXG4gICAgICAgIHZhciB5Um9vdHMgPSBuZXcgUG9seW5vbWlhbChcclxuICAgICAgICAgICAgYzEyLnksXHJcbiAgICAgICAgICAgIGMxMS55LFxyXG4gICAgICAgICAgICBjMTAueSAtIGMyMC55IC0gcypjMjEueSAtIHMqcypjMjIueSAtIHMqcypzKmMyMy55XHJcbiAgICAgICAgKS5nZXRSb290cygpO1xyXG5cclxuICAgICAgICBpZiAoIHhSb290cy5sZW5ndGggPiAwICYmIHlSb290cy5sZW5ndGggPiAwICkge1xyXG4gICAgICAgICAgICB2YXIgVE9MRVJBTkNFID0gMWUtNDtcclxuXHJcbiAgICAgICAgICAgIGNoZWNrUm9vdHM6XHJcbiAgICAgICAgICAgIGZvciAoIHZhciBqID0gMDsgaiA8IHhSb290cy5sZW5ndGg7IGorKyApIHtcclxuICAgICAgICAgICAgICAgIHZhciB4Um9vdCA9IHhSb290c1tqXTtcclxuXHJcbiAgICAgICAgICAgICAgICBpZiAoIDAgPD0geFJvb3QgJiYgeFJvb3QgPD0gMSApIHtcclxuICAgICAgICAgICAgICAgICAgICBmb3IgKCB2YXIgayA9IDA7IGsgPCB5Um9vdHMubGVuZ3RoOyBrKysgKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmICggTWF0aC5hYnMoIHhSb290IC0geVJvb3RzW2tdICkgPCBUT0xFUkFOQ0UgKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXN1bHQucG9pbnRzLnB1c2goXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYzIzLm11bHRpcGx5KHMqcypzKS5hZGQoYzIyLm11bHRpcGx5KHMqcykuYWRkKGMyMS5tdWx0aXBseShzKS5hZGQoYzIwKSkpXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICApO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWsgY2hlY2tSb290cztcclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICBpZiAoIHJlc3VsdC5wb2ludHMubGVuZ3RoID4gMCApIHJlc3VsdC5zdGF0dXMgPSBcIkludGVyc2VjdGlvblwiO1xyXG5cclxuICAgIHJldHVybiByZXN1bHQ7XHJcblxyXG59O1xyXG5cclxuXHJcbi8qKlxyXG4gKiAgaW50ZXJzZWN0QmV6aWVyMkNpcmNsZVxyXG4gKlxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBwMVxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBwMlxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBwM1xyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBjXHJcbiAqICBAcGFyYW0ge051bWJlcn0gclxyXG4gKiAgQHJldHVybnMge0ludGVyc2VjdGlvbn1cclxuICovXHJcbkludGVyc2VjdGlvbi5pbnRlcnNlY3RCZXppZXIyQ2lyY2xlID0gZnVuY3Rpb24ocDEsIHAyLCBwMywgYywgcikge1xyXG4gICAgcmV0dXJuIEludGVyc2VjdGlvbi5pbnRlcnNlY3RCZXppZXIyRWxsaXBzZShwMSwgcDIsIHAzLCBjLCByLCByKTtcclxufTtcclxuXHJcblxyXG4vKipcclxuICogIGludGVyc2VjdEJlemllcjJFbGxpcHNlXHJcbiAqXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IHAxXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IHAyXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IHAzXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IGVjXHJcbiAqICBAcGFyYW0ge051bWJlcn0gcnhcclxuICogIEBwYXJhbSB7TnVtYmVyfSByeVxyXG4gKiAgQHJldHVybnMge0ludGVyc2VjdGlvbn1cclxuICovXHJcbkludGVyc2VjdGlvbi5pbnRlcnNlY3RCZXppZXIyRWxsaXBzZSA9IGZ1bmN0aW9uKHAxLCBwMiwgcDMsIGVjLCByeCwgcnkpIHtcclxuICAgIHZhciBhLCBiOyAgICAgICAvLyB0ZW1wb3JhcnkgdmFyaWFibGVzXHJcbiAgICB2YXIgYzIsIGMxLCBjMDsgLy8gY29lZmZpY2llbnRzIG9mIHF1YWRyYXRpY1xyXG4gICAgdmFyIHJlc3VsdCA9IG5ldyBJbnRlcnNlY3Rpb24oXCJObyBJbnRlcnNlY3Rpb25cIik7XHJcblxyXG4gICAgYSA9IHAyLm11bHRpcGx5KC0yKTtcclxuICAgIGMyID0gcDEuYWRkKGEuYWRkKHAzKSk7XHJcblxyXG4gICAgYSA9IHAxLm11bHRpcGx5KC0yKTtcclxuICAgIGIgPSBwMi5tdWx0aXBseSgyKTtcclxuICAgIGMxID0gYS5hZGQoYik7XHJcblxyXG4gICAgYzAgPSBuZXcgUG9pbnQyRChwMS54LCBwMS55KTtcclxuXHJcbiAgICB2YXIgcnhyeCAgPSByeCpyeDtcclxuICAgIHZhciByeXJ5ICA9IHJ5KnJ5O1xyXG4gICAgdmFyIHJvb3RzID0gbmV3IFBvbHlub21pYWwoXHJcbiAgICAgICAgcnlyeSpjMi54KmMyLnggKyByeHJ4KmMyLnkqYzIueSxcclxuICAgICAgICAyKihyeXJ5KmMyLngqYzEueCArIHJ4cngqYzIueSpjMS55KSxcclxuICAgICAgICByeXJ5KigyKmMyLngqYzAueCArIGMxLngqYzEueCkgKyByeHJ4KigyKmMyLnkqYzAueStjMS55KmMxLnkpIC1cclxuICAgICAgICAgICAgMioocnlyeSplYy54KmMyLnggKyByeHJ4KmVjLnkqYzIueSksXHJcbiAgICAgICAgMioocnlyeSpjMS54KihjMC54LWVjLngpICsgcnhyeCpjMS55KihjMC55LWVjLnkpKSxcclxuICAgICAgICByeXJ5KihjMC54KmMwLngrZWMueCplYy54KSArIHJ4cngqKGMwLnkqYzAueSArIGVjLnkqZWMueSkgLVxyXG4gICAgICAgICAgICAyKihyeXJ5KmVjLngqYzAueCArIHJ4cngqZWMueSpjMC55KSAtIHJ4cngqcnlyeVxyXG4gICAgKS5nZXRSb290cygpO1xyXG5cclxuICAgIGZvciAoIHZhciBpID0gMDsgaSA8IHJvb3RzLmxlbmd0aDsgaSsrICkge1xyXG4gICAgICAgIHZhciB0ID0gcm9vdHNbaV07XHJcblxyXG4gICAgICAgIGlmICggMCA8PSB0ICYmIHQgPD0gMSApXHJcbiAgICAgICAgICAgIHJlc3VsdC5wb2ludHMucHVzaCggYzIubXVsdGlwbHkodCp0KS5hZGQoYzEubXVsdGlwbHkodCkuYWRkKGMwKSkgKTtcclxuICAgIH1cclxuXHJcbiAgICBpZiAoIHJlc3VsdC5wb2ludHMubGVuZ3RoID4gMCApIHJlc3VsdC5zdGF0dXMgPSBcIkludGVyc2VjdGlvblwiO1xyXG5cclxuICAgIHJldHVybiByZXN1bHQ7XHJcbn07XHJcblxyXG5cclxuLyoqXHJcbiAqICBpbnRlcnNlY3RCZXppZXIyTGluZVxyXG4gKlxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBwMVxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBwMlxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBwM1xyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBhMVxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBhMlxyXG4gKiAgQHJldHVybnMge0ludGVyc2VjdGlvbn1cclxuICovXHJcbkludGVyc2VjdGlvbi5pbnRlcnNlY3RCZXppZXIyTGluZSA9IGZ1bmN0aW9uKHAxLCBwMiwgcDMsIGExLCBhMikge1xyXG4gICAgdmFyIGEsIGI7ICAgICAgICAgICAgIC8vIHRlbXBvcmFyeSB2YXJpYWJsZXNcclxuICAgIHZhciBjMiwgYzEsIGMwOyAgICAgICAvLyBjb2VmZmljaWVudHMgb2YgcXVhZHJhdGljXHJcbiAgICB2YXIgY2w7ICAgICAgICAgICAgICAgLy8gYyBjb2VmZmljaWVudCBmb3Igbm9ybWFsIGZvcm0gb2YgbGluZVxyXG4gICAgdmFyIG47ICAgICAgICAgICAgICAgIC8vIG5vcm1hbCBmb3Igbm9ybWFsIGZvcm0gb2YgbGluZVxyXG4gICAgdmFyIG1pbiA9IGExLm1pbihhMik7IC8vIHVzZWQgdG8gZGV0ZXJtaW5lIGlmIHBvaW50IGlzIG9uIGxpbmUgc2VnbWVudFxyXG4gICAgdmFyIG1heCA9IGExLm1heChhMik7IC8vIHVzZWQgdG8gZGV0ZXJtaW5lIGlmIHBvaW50IGlzIG9uIGxpbmUgc2VnbWVudFxyXG4gICAgdmFyIHJlc3VsdCA9IG5ldyBJbnRlcnNlY3Rpb24oXCJObyBJbnRlcnNlY3Rpb25cIik7XHJcblxyXG4gICAgYSA9IHAyLm11bHRpcGx5KC0yKTtcclxuICAgIGMyID0gcDEuYWRkKGEuYWRkKHAzKSk7XHJcblxyXG4gICAgYSA9IHAxLm11bHRpcGx5KC0yKTtcclxuICAgIGIgPSBwMi5tdWx0aXBseSgyKTtcclxuICAgIGMxID0gYS5hZGQoYik7XHJcblxyXG4gICAgYzAgPSBuZXcgUG9pbnQyRChwMS54LCBwMS55KTtcclxuXHJcbiAgICAvLyBDb252ZXJ0IGxpbmUgdG8gbm9ybWFsIGZvcm06IGF4ICsgYnkgKyBjID0gMFxyXG4gICAgLy8gRmluZCBub3JtYWwgdG8gbGluZTogbmVnYXRpdmUgaW52ZXJzZSBvZiBvcmlnaW5hbCBsaW5lJ3Mgc2xvcGVcclxuICAgIG4gPSBuZXcgVmVjdG9yMkQoYTEueSAtIGEyLnksIGEyLnggLSBhMS54KTtcclxuXHJcbiAgICAvLyBEZXRlcm1pbmUgbmV3IGMgY29lZmZpY2llbnRcclxuICAgIGNsID0gYTEueCphMi55IC0gYTIueCphMS55O1xyXG5cclxuICAgIC8vIFRyYW5zZm9ybSBjdWJpYyBjb2VmZmljaWVudHMgdG8gbGluZSdzIGNvb3JkaW5hdGUgc3lzdGVtIGFuZCBmaW5kIHJvb3RzXHJcbiAgICAvLyBvZiBjdWJpY1xyXG4gICAgcm9vdHMgPSBuZXcgUG9seW5vbWlhbChcclxuICAgICAgICBuLmRvdChjMiksXHJcbiAgICAgICAgbi5kb3QoYzEpLFxyXG4gICAgICAgIG4uZG90KGMwKSArIGNsXHJcbiAgICApLmdldFJvb3RzKCk7XHJcblxyXG4gICAgLy8gQW55IHJvb3RzIGluIGNsb3NlZCBpbnRlcnZhbCBbMCwxXSBhcmUgaW50ZXJzZWN0aW9ucyBvbiBCZXppZXIsIGJ1dFxyXG4gICAgLy8gbWlnaHQgbm90IGJlIG9uIHRoZSBsaW5lIHNlZ21lbnQuXHJcbiAgICAvLyBGaW5kIGludGVyc2VjdGlvbnMgYW5kIGNhbGN1bGF0ZSBwb2ludCBjb29yZGluYXRlc1xyXG4gICAgZm9yICggdmFyIGkgPSAwOyBpIDwgcm9vdHMubGVuZ3RoOyBpKysgKSB7XHJcbiAgICAgICAgdmFyIHQgPSByb290c1tpXTtcclxuXHJcbiAgICAgICAgaWYgKCAwIDw9IHQgJiYgdCA8PSAxICkge1xyXG4gICAgICAgICAgICAvLyBXZSdyZSB3aXRoaW4gdGhlIEJlemllciBjdXJ2ZVxyXG4gICAgICAgICAgICAvLyBGaW5kIHBvaW50IG9uIEJlemllclxyXG4gICAgICAgICAgICB2YXIgcDQgPSBwMS5sZXJwKHAyLCB0KTtcclxuICAgICAgICAgICAgdmFyIHA1ID0gcDIubGVycChwMywgdCk7XHJcblxyXG4gICAgICAgICAgICB2YXIgcDYgPSBwNC5sZXJwKHA1LCB0KTtcclxuXHJcbiAgICAgICAgICAgIC8vIFNlZSBpZiBwb2ludCBpcyBvbiBsaW5lIHNlZ21lbnRcclxuICAgICAgICAgICAgLy8gSGFkIHRvIG1ha2Ugc3BlY2lhbCBjYXNlcyBmb3IgdmVydGljYWwgYW5kIGhvcml6b250YWwgbGluZXMgZHVlXHJcbiAgICAgICAgICAgIC8vIHRvIHNsaWdodCBlcnJvcnMgaW4gY2FsY3VsYXRpb24gb2YgcDZcclxuICAgICAgICAgICAgaWYgKCBhMS54ID09IGEyLnggKSB7XHJcbiAgICAgICAgICAgICAgICBpZiAoIG1pbi55IDw9IHA2LnkgJiYgcDYueSA8PSBtYXgueSApIHtcclxuICAgICAgICAgICAgICAgICAgICByZXN1bHQuc3RhdHVzID0gXCJJbnRlcnNlY3Rpb25cIjtcclxuICAgICAgICAgICAgICAgICAgICByZXN1bHQuYXBwZW5kUG9pbnQoIHA2ICk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0gZWxzZSBpZiAoIGExLnkgPT0gYTIueSApIHtcclxuICAgICAgICAgICAgICAgIGlmICggbWluLnggPD0gcDYueCAmJiBwNi54IDw9IG1heC54ICkge1xyXG4gICAgICAgICAgICAgICAgICAgIHJlc3VsdC5zdGF0dXMgPSBcIkludGVyc2VjdGlvblwiO1xyXG4gICAgICAgICAgICAgICAgICAgIHJlc3VsdC5hcHBlbmRQb2ludCggcDYgKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSBlbHNlIGlmIChtaW4ueCA8PSBwNi54ICYmIHA2LnggPD0gbWF4LnggJiYgbWluLnkgPD0gcDYueSAmJiBwNi55IDw9IG1heC55KSB7XHJcbiAgICAgICAgICAgICAgICByZXN1bHQuc3RhdHVzID0gXCJJbnRlcnNlY3Rpb25cIjtcclxuICAgICAgICAgICAgICAgIHJlc3VsdC5hcHBlbmRQb2ludCggcDYgKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gcmVzdWx0O1xyXG59O1xyXG5cclxuXHJcbi8qKlxyXG4gKiAgaW50ZXJzZWN0QmV6aWVyMlBvbHlnb25cclxuICpcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gcDFcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gcDJcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gcDNcclxuICogIEBwYXJhbSB7QXJyYXk8UG9pbnQyRD59IHBvaW50c1xyXG4gKiAgQHJldHVybnMge0ludGVyc2VjdGlvbn1cclxuICovXHJcbkludGVyc2VjdGlvbi5pbnRlcnNlY3RCZXppZXIyUG9seWdvbiA9IGZ1bmN0aW9uKHAxLCBwMiwgcDMsIHBvaW50cykge1xyXG4gICAgdmFyIHJlc3VsdCA9IG5ldyBJbnRlcnNlY3Rpb24oXCJObyBJbnRlcnNlY3Rpb25cIik7XHJcbiAgICB2YXIgbGVuZ3RoID0gcG9pbnRzLmxlbmd0aDtcclxuXHJcbiAgICBmb3IgKCB2YXIgaSA9IDA7IGkgPCBsZW5ndGg7IGkrKyApIHtcclxuICAgICAgICB2YXIgYTEgPSBwb2ludHNbaV07XHJcbiAgICAgICAgdmFyIGEyID0gcG9pbnRzWyhpKzEpICUgbGVuZ3RoXTtcclxuICAgICAgICB2YXIgaW50ZXIgPSBJbnRlcnNlY3Rpb24uaW50ZXJzZWN0QmV6aWVyMkxpbmUocDEsIHAyLCBwMywgYTEsIGEyKTtcclxuXHJcbiAgICAgICAgcmVzdWx0LmFwcGVuZFBvaW50cyhpbnRlci5wb2ludHMpO1xyXG4gICAgfVxyXG5cclxuICAgIGlmICggcmVzdWx0LnBvaW50cy5sZW5ndGggPiAwICkgcmVzdWx0LnN0YXR1cyA9IFwiSW50ZXJzZWN0aW9uXCI7XHJcblxyXG4gICAgcmV0dXJuIHJlc3VsdDtcclxufTtcclxuXHJcblxyXG4vKipcclxuICogIGludGVyc2VjdEJlemllcjJSZWN0YW5nbGVcclxuICpcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gcDFcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gcDJcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gcDNcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gcjFcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gcjJcclxuICogIEByZXR1cm5zIHtJbnRlcnNlY3Rpb259XHJcbiAqL1xyXG5JbnRlcnNlY3Rpb24uaW50ZXJzZWN0QmV6aWVyMlJlY3RhbmdsZSA9IGZ1bmN0aW9uKHAxLCBwMiwgcDMsIHIxLCByMikge1xyXG4gICAgdmFyIG1pbiAgICAgICAgPSByMS5taW4ocjIpO1xyXG4gICAgdmFyIG1heCAgICAgICAgPSByMS5tYXgocjIpO1xyXG4gICAgdmFyIHRvcFJpZ2h0ICAgPSBuZXcgUG9pbnQyRCggbWF4LngsIG1pbi55ICk7XHJcbiAgICB2YXIgYm90dG9tTGVmdCA9IG5ldyBQb2ludDJEKCBtaW4ueCwgbWF4LnkgKTtcclxuXHJcbiAgICB2YXIgaW50ZXIxID0gSW50ZXJzZWN0aW9uLmludGVyc2VjdEJlemllcjJMaW5lKHAxLCBwMiwgcDMsIG1pbiwgdG9wUmlnaHQpO1xyXG4gICAgdmFyIGludGVyMiA9IEludGVyc2VjdGlvbi5pbnRlcnNlY3RCZXppZXIyTGluZShwMSwgcDIsIHAzLCB0b3BSaWdodCwgbWF4KTtcclxuICAgIHZhciBpbnRlcjMgPSBJbnRlcnNlY3Rpb24uaW50ZXJzZWN0QmV6aWVyMkxpbmUocDEsIHAyLCBwMywgbWF4LCBib3R0b21MZWZ0KTtcclxuICAgIHZhciBpbnRlcjQgPSBJbnRlcnNlY3Rpb24uaW50ZXJzZWN0QmV6aWVyMkxpbmUocDEsIHAyLCBwMywgYm90dG9tTGVmdCwgbWluKTtcclxuXHJcbiAgICB2YXIgcmVzdWx0ID0gbmV3IEludGVyc2VjdGlvbihcIk5vIEludGVyc2VjdGlvblwiKTtcclxuXHJcbiAgICByZXN1bHQuYXBwZW5kUG9pbnRzKGludGVyMS5wb2ludHMpO1xyXG4gICAgcmVzdWx0LmFwcGVuZFBvaW50cyhpbnRlcjIucG9pbnRzKTtcclxuICAgIHJlc3VsdC5hcHBlbmRQb2ludHMoaW50ZXIzLnBvaW50cyk7XHJcbiAgICByZXN1bHQuYXBwZW5kUG9pbnRzKGludGVyNC5wb2ludHMpO1xyXG5cclxuICAgIGlmICggcmVzdWx0LnBvaW50cy5sZW5ndGggPiAwICkgcmVzdWx0LnN0YXR1cyA9IFwiSW50ZXJzZWN0aW9uXCI7XHJcblxyXG4gICAgcmV0dXJuIHJlc3VsdDtcclxufTtcclxuXHJcblxyXG4vKipcclxuICogIGludGVyc2VjdEJlemllcjNCZXppZXIzXHJcbiAqXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IGExXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IGEyXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IGEzXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IGE0XHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IGIxXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IGIyXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IGIzXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IGI0XHJcbiAqICBAcmV0dXJucyB7SW50ZXJzZWN0aW9ufVxyXG4gKi9cclxuSW50ZXJzZWN0aW9uLmludGVyc2VjdEJlemllcjNCZXppZXIzID0gZnVuY3Rpb24oYTEsIGEyLCBhMywgYTQsIGIxLCBiMiwgYjMsIGI0KSB7XHJcbiAgICB2YXIgYSwgYiwgYywgZDsgICAgICAgICAvLyB0ZW1wb3JhcnkgdmFyaWFibGVzXHJcbiAgICB2YXIgYzEzLCBjMTIsIGMxMSwgYzEwOyAvLyBjb2VmZmljaWVudHMgb2YgY3ViaWNcclxuICAgIHZhciBjMjMsIGMyMiwgYzIxLCBjMjA7IC8vIGNvZWZmaWNpZW50cyBvZiBjdWJpY1xyXG4gICAgdmFyIHJlc3VsdCA9IG5ldyBJbnRlcnNlY3Rpb24oXCJObyBJbnRlcnNlY3Rpb25cIik7XHJcblxyXG4gICAgLy8gQ2FsY3VsYXRlIHRoZSBjb2VmZmljaWVudHMgb2YgY3ViaWMgcG9seW5vbWlhbFxyXG4gICAgYSA9IGExLm11bHRpcGx5KC0xKTtcclxuICAgIGIgPSBhMi5tdWx0aXBseSgzKTtcclxuICAgIGMgPSBhMy5tdWx0aXBseSgtMyk7XHJcbiAgICBkID0gYS5hZGQoYi5hZGQoYy5hZGQoYTQpKSk7XHJcbiAgICBjMTMgPSBuZXcgVmVjdG9yMkQoZC54LCBkLnkpO1xyXG5cclxuICAgIGEgPSBhMS5tdWx0aXBseSgzKTtcclxuICAgIGIgPSBhMi5tdWx0aXBseSgtNik7XHJcbiAgICBjID0gYTMubXVsdGlwbHkoMyk7XHJcbiAgICBkID0gYS5hZGQoYi5hZGQoYykpO1xyXG4gICAgYzEyID0gbmV3IFZlY3RvcjJEKGQueCwgZC55KTtcclxuXHJcbiAgICBhID0gYTEubXVsdGlwbHkoLTMpO1xyXG4gICAgYiA9IGEyLm11bHRpcGx5KDMpO1xyXG4gICAgYyA9IGEuYWRkKGIpO1xyXG4gICAgYzExID0gbmV3IFZlY3RvcjJEKGMueCwgYy55KTtcclxuXHJcbiAgICBjMTAgPSBuZXcgVmVjdG9yMkQoYTEueCwgYTEueSk7XHJcblxyXG4gICAgYSA9IGIxLm11bHRpcGx5KC0xKTtcclxuICAgIGIgPSBiMi5tdWx0aXBseSgzKTtcclxuICAgIGMgPSBiMy5tdWx0aXBseSgtMyk7XHJcbiAgICBkID0gYS5hZGQoYi5hZGQoYy5hZGQoYjQpKSk7XHJcbiAgICBjMjMgPSBuZXcgVmVjdG9yMkQoZC54LCBkLnkpO1xyXG5cclxuICAgIGEgPSBiMS5tdWx0aXBseSgzKTtcclxuICAgIGIgPSBiMi5tdWx0aXBseSgtNik7XHJcbiAgICBjID0gYjMubXVsdGlwbHkoMyk7XHJcbiAgICBkID0gYS5hZGQoYi5hZGQoYykpO1xyXG4gICAgYzIyID0gbmV3IFZlY3RvcjJEKGQueCwgZC55KTtcclxuXHJcbiAgICBhID0gYjEubXVsdGlwbHkoLTMpO1xyXG4gICAgYiA9IGIyLm11bHRpcGx5KDMpO1xyXG4gICAgYyA9IGEuYWRkKGIpO1xyXG4gICAgYzIxID0gbmV3IFZlY3RvcjJEKGMueCwgYy55KTtcclxuXHJcbiAgICBjMjAgPSBuZXcgVmVjdG9yMkQoYjEueCwgYjEueSk7XHJcblxyXG4gICAgdmFyIGMxMHgyID0gYzEwLngqYzEwLng7XHJcbiAgICB2YXIgYzEweDMgPSBjMTAueCpjMTAueCpjMTAueDtcclxuICAgIHZhciBjMTB5MiA9IGMxMC55KmMxMC55O1xyXG4gICAgdmFyIGMxMHkzID0gYzEwLnkqYzEwLnkqYzEwLnk7XHJcbiAgICB2YXIgYzExeDIgPSBjMTEueCpjMTEueDtcclxuICAgIHZhciBjMTF4MyA9IGMxMS54KmMxMS54KmMxMS54O1xyXG4gICAgdmFyIGMxMXkyID0gYzExLnkqYzExLnk7XHJcbiAgICB2YXIgYzExeTMgPSBjMTEueSpjMTEueSpjMTEueTtcclxuICAgIHZhciBjMTJ4MiA9IGMxMi54KmMxMi54O1xyXG4gICAgdmFyIGMxMngzID0gYzEyLngqYzEyLngqYzEyLng7XHJcbiAgICB2YXIgYzEyeTIgPSBjMTIueSpjMTIueTtcclxuICAgIHZhciBjMTJ5MyA9IGMxMi55KmMxMi55KmMxMi55O1xyXG4gICAgdmFyIGMxM3gyID0gYzEzLngqYzEzLng7XHJcbiAgICB2YXIgYzEzeDMgPSBjMTMueCpjMTMueCpjMTMueDtcclxuICAgIHZhciBjMTN5MiA9IGMxMy55KmMxMy55O1xyXG4gICAgdmFyIGMxM3kzID0gYzEzLnkqYzEzLnkqYzEzLnk7XHJcbiAgICB2YXIgYzIweDIgPSBjMjAueCpjMjAueDtcclxuICAgIHZhciBjMjB4MyA9IGMyMC54KmMyMC54KmMyMC54O1xyXG4gICAgdmFyIGMyMHkyID0gYzIwLnkqYzIwLnk7XHJcbiAgICB2YXIgYzIweTMgPSBjMjAueSpjMjAueSpjMjAueTtcclxuICAgIHZhciBjMjF4MiA9IGMyMS54KmMyMS54O1xyXG4gICAgdmFyIGMyMXgzID0gYzIxLngqYzIxLngqYzIxLng7XHJcbiAgICB2YXIgYzIxeTIgPSBjMjEueSpjMjEueTtcclxuICAgIHZhciBjMjJ4MiA9IGMyMi54KmMyMi54O1xyXG4gICAgdmFyIGMyMngzID0gYzIyLngqYzIyLngqYzIyLng7XHJcbiAgICB2YXIgYzIyeTIgPSBjMjIueSpjMjIueTtcclxuICAgIHZhciBjMjN4MiA9IGMyMy54KmMyMy54O1xyXG4gICAgdmFyIGMyM3gzID0gYzIzLngqYzIzLngqYzIzLng7XHJcbiAgICB2YXIgYzIzeTIgPSBjMjMueSpjMjMueTtcclxuICAgIHZhciBjMjN5MyA9IGMyMy55KmMyMy55KmMyMy55O1xyXG4gICAgdmFyIHBvbHkgPSBuZXcgUG9seW5vbWlhbChcclxuICAgICAgICAtYzEzeDMqYzIzeTMgKyBjMTN5MypjMjN4MyAtIDMqYzEzLngqYzEzeTIqYzIzeDIqYzIzLnkgK1xyXG4gICAgICAgICAgICAzKmMxM3gyKmMxMy55KmMyMy54KmMyM3kyLFxyXG4gICAgICAgIC02KmMxMy54KmMyMi54KmMxM3kyKmMyMy54KmMyMy55ICsgNipjMTN4MipjMTMueSpjMjIueSpjMjMueCpjMjMueSArIDMqYzIyLngqYzEzeTMqYzIzeDIgLVxyXG4gICAgICAgICAgICAzKmMxM3gzKmMyMi55KmMyM3kyIC0gMypjMTMueCpjMTN5MipjMjIueSpjMjN4MiArIDMqYzEzeDIqYzIyLngqYzEzLnkqYzIzeTIsXHJcbiAgICAgICAgLTYqYzIxLngqYzEzLngqYzEzeTIqYzIzLngqYzIzLnkgLSA2KmMxMy54KmMyMi54KmMxM3kyKmMyMi55KmMyMy54ICsgNipjMTN4MipjMjIueCpjMTMueSpjMjIueSpjMjMueSArXHJcbiAgICAgICAgICAgIDMqYzIxLngqYzEzeTMqYzIzeDIgKyAzKmMyMngyKmMxM3kzKmMyMy54ICsgMypjMjEueCpjMTN4MipjMTMueSpjMjN5MiAtIDMqYzEzLngqYzIxLnkqYzEzeTIqYzIzeDIgLVxyXG4gICAgICAgICAgICAzKmMxMy54KmMyMngyKmMxM3kyKmMyMy55ICsgYzEzeDIqYzEzLnkqYzIzLngqKDYqYzIxLnkqYzIzLnkgKyAzKmMyMnkyKSArIGMxM3gzKigtYzIxLnkqYzIzeTIgLVxyXG4gICAgICAgICAgICAyKmMyMnkyKmMyMy55IC0gYzIzLnkqKDIqYzIxLnkqYzIzLnkgKyBjMjJ5MikpLFxyXG4gICAgICAgIGMxMS54KmMxMi55KmMxMy54KmMxMy55KmMyMy54KmMyMy55IC0gYzExLnkqYzEyLngqYzEzLngqYzEzLnkqYzIzLngqYzIzLnkgKyA2KmMyMS54KmMyMi54KmMxM3kzKmMyMy54ICtcclxuICAgICAgICAgICAgMypjMTEueCpjMTIueCpjMTMueCpjMTMueSpjMjN5MiArIDYqYzEwLngqYzEzLngqYzEzeTIqYzIzLngqYzIzLnkgLSAzKmMxMS54KmMxMi54KmMxM3kyKmMyMy54KmMyMy55IC1cclxuICAgICAgICAgICAgMypjMTEueSpjMTIueSpjMTMueCpjMTMueSpjMjN4MiAtIDYqYzEwLnkqYzEzeDIqYzEzLnkqYzIzLngqYzIzLnkgLSA2KmMyMC54KmMxMy54KmMxM3kyKmMyMy54KmMyMy55ICtcclxuICAgICAgICAgICAgMypjMTEueSpjMTIueSpjMTN4MipjMjMueCpjMjMueSAtIDIqYzEyLngqYzEyeTIqYzEzLngqYzIzLngqYzIzLnkgLSA2KmMyMS54KmMxMy54KmMyMi54KmMxM3kyKmMyMy55IC1cclxuICAgICAgICAgICAgNipjMjEueCpjMTMueCpjMTN5MipjMjIueSpjMjMueCAtIDYqYzEzLngqYzIxLnkqYzIyLngqYzEzeTIqYzIzLnggKyA2KmMyMS54KmMxM3gyKmMxMy55KmMyMi55KmMyMy55ICtcclxuICAgICAgICAgICAgMipjMTJ4MipjMTIueSpjMTMueSpjMjMueCpjMjMueSArIGMyMngzKmMxM3kzIC0gMypjMTAueCpjMTN5MypjMjN4MiArIDMqYzEwLnkqYzEzeDMqYzIzeTIgK1xyXG4gICAgICAgICAgICAzKmMyMC54KmMxM3kzKmMyM3gyICsgYzEyeTMqYzEzLngqYzIzeDIgLSBjMTJ4MypjMTMueSpjMjN5MiAtIDMqYzEwLngqYzEzeDIqYzEzLnkqYzIzeTIgK1xyXG4gICAgICAgICAgICAzKmMxMC55KmMxMy54KmMxM3kyKmMyM3gyIC0gMipjMTEueCpjMTIueSpjMTN4MipjMjN5MiArIGMxMS54KmMxMi55KmMxM3kyKmMyM3gyIC0gYzExLnkqYzEyLngqYzEzeDIqYzIzeTIgK1xyXG4gICAgICAgICAgICAyKmMxMS55KmMxMi54KmMxM3kyKmMyM3gyICsgMypjMjAueCpjMTN4MipjMTMueSpjMjN5MiAtIGMxMi54KmMxMnkyKmMxMy55KmMyM3gyIC1cclxuICAgICAgICAgICAgMypjMjAueSpjMTMueCpjMTN5MipjMjN4MiArIGMxMngyKmMxMi55KmMxMy54KmMyM3kyIC0gMypjMTMueCpjMjJ4MipjMTN5MipjMjIueSArXHJcbiAgICAgICAgICAgIGMxM3gyKmMxMy55KmMyMy54Kig2KmMyMC55KmMyMy55ICsgNipjMjEueSpjMjIueSkgKyBjMTN4MipjMjIueCpjMTMueSooNipjMjEueSpjMjMueSArIDMqYzIyeTIpICtcclxuICAgICAgICAgICAgYzEzeDMqKC0yKmMyMS55KmMyMi55KmMyMy55IC0gYzIwLnkqYzIzeTIgLSBjMjIueSooMipjMjEueSpjMjMueSArIGMyMnkyKSAtIGMyMy55KigyKmMyMC55KmMyMy55ICsgMipjMjEueSpjMjIueSkpLFxyXG4gICAgICAgIDYqYzExLngqYzEyLngqYzEzLngqYzEzLnkqYzIyLnkqYzIzLnkgKyBjMTEueCpjMTIueSpjMTMueCpjMjIueCpjMTMueSpjMjMueSArIGMxMS54KmMxMi55KmMxMy54KmMxMy55KmMyMi55KmMyMy54IC1cclxuICAgICAgICAgICAgYzExLnkqYzEyLngqYzEzLngqYzIyLngqYzEzLnkqYzIzLnkgLSBjMTEueSpjMTIueCpjMTMueCpjMTMueSpjMjIueSpjMjMueCAtIDYqYzExLnkqYzEyLnkqYzEzLngqYzIyLngqYzEzLnkqYzIzLnggLVxyXG4gICAgICAgICAgICA2KmMxMC54KmMyMi54KmMxM3kzKmMyMy54ICsgNipjMjAueCpjMjIueCpjMTN5MypjMjMueCArIDYqYzEwLnkqYzEzeDMqYzIyLnkqYzIzLnkgKyAyKmMxMnkzKmMxMy54KmMyMi54KmMyMy54IC1cclxuICAgICAgICAgICAgMipjMTJ4MypjMTMueSpjMjIueSpjMjMueSArIDYqYzEwLngqYzEzLngqYzIyLngqYzEzeTIqYzIzLnkgKyA2KmMxMC54KmMxMy54KmMxM3kyKmMyMi55KmMyMy54ICtcclxuICAgICAgICAgICAgNipjMTAueSpjMTMueCpjMjIueCpjMTN5MipjMjMueCAtIDMqYzExLngqYzEyLngqYzIyLngqYzEzeTIqYzIzLnkgLSAzKmMxMS54KmMxMi54KmMxM3kyKmMyMi55KmMyMy54ICtcclxuICAgICAgICAgICAgMipjMTEueCpjMTIueSpjMjIueCpjMTN5MipjMjMueCArIDQqYzExLnkqYzEyLngqYzIyLngqYzEzeTIqYzIzLnggLSA2KmMxMC54KmMxM3gyKmMxMy55KmMyMi55KmMyMy55IC1cclxuICAgICAgICAgICAgNipjMTAueSpjMTN4MipjMjIueCpjMTMueSpjMjMueSAtIDYqYzEwLnkqYzEzeDIqYzEzLnkqYzIyLnkqYzIzLnggLSA0KmMxMS54KmMxMi55KmMxM3gyKmMyMi55KmMyMy55IC1cclxuICAgICAgICAgICAgNipjMjAueCpjMTMueCpjMjIueCpjMTN5MipjMjMueSAtIDYqYzIwLngqYzEzLngqYzEzeTIqYzIyLnkqYzIzLnggLSAyKmMxMS55KmMxMi54KmMxM3gyKmMyMi55KmMyMy55ICtcclxuICAgICAgICAgICAgMypjMTEueSpjMTIueSpjMTN4MipjMjIueCpjMjMueSArIDMqYzExLnkqYzEyLnkqYzEzeDIqYzIyLnkqYzIzLnggLSAyKmMxMi54KmMxMnkyKmMxMy54KmMyMi54KmMyMy55IC1cclxuICAgICAgICAgICAgMipjMTIueCpjMTJ5MipjMTMueCpjMjIueSpjMjMueCAtIDIqYzEyLngqYzEyeTIqYzIyLngqYzEzLnkqYzIzLnggLSA2KmMyMC55KmMxMy54KmMyMi54KmMxM3kyKmMyMy54IC1cclxuICAgICAgICAgICAgNipjMjEueCpjMTMueCpjMjEueSpjMTN5MipjMjMueCAtIDYqYzIxLngqYzEzLngqYzIyLngqYzEzeTIqYzIyLnkgKyA2KmMyMC54KmMxM3gyKmMxMy55KmMyMi55KmMyMy55ICtcclxuICAgICAgICAgICAgMipjMTJ4MipjMTIueSpjMTMueCpjMjIueSpjMjMueSArIDIqYzEyeDIqYzEyLnkqYzIyLngqYzEzLnkqYzIzLnkgKyAyKmMxMngyKmMxMi55KmMxMy55KmMyMi55KmMyMy54ICtcclxuICAgICAgICAgICAgMypjMjEueCpjMjJ4MipjMTN5MyArIDMqYzIxeDIqYzEzeTMqYzIzLnggLSAzKmMxMy54KmMyMS55KmMyMngyKmMxM3kyIC0gMypjMjF4MipjMTMueCpjMTN5MipjMjMueSArXHJcbiAgICAgICAgICAgIGMxM3gyKmMyMi54KmMxMy55Kig2KmMyMC55KmMyMy55ICsgNipjMjEueSpjMjIueSkgKyBjMTN4MipjMTMueSpjMjMueCooNipjMjAueSpjMjIueSArIDMqYzIxeTIpICtcclxuICAgICAgICAgICAgYzIxLngqYzEzeDIqYzEzLnkqKDYqYzIxLnkqYzIzLnkgKyAzKmMyMnkyKSArIGMxM3gzKigtMipjMjAueSpjMjIueSpjMjMueSAtIGMyMy55KigyKmMyMC55KmMyMi55ICsgYzIxeTIpIC1cclxuICAgICAgICAgICAgYzIxLnkqKDIqYzIxLnkqYzIzLnkgKyBjMjJ5MikgLSBjMjIueSooMipjMjAueSpjMjMueSArIDIqYzIxLnkqYzIyLnkpKSxcclxuICAgICAgICBjMTEueCpjMjEueCpjMTIueSpjMTMueCpjMTMueSpjMjMueSArIGMxMS54KmMxMi55KmMxMy54KmMyMS55KmMxMy55KmMyMy54ICsgYzExLngqYzEyLnkqYzEzLngqYzIyLngqYzEzLnkqYzIyLnkgLVxyXG4gICAgICAgICAgICBjMTEueSpjMTIueCpjMjEueCpjMTMueCpjMTMueSpjMjMueSAtIGMxMS55KmMxMi54KmMxMy54KmMyMS55KmMxMy55KmMyMy54IC0gYzExLnkqYzEyLngqYzEzLngqYzIyLngqYzEzLnkqYzIyLnkgLVxyXG4gICAgICAgICAgICA2KmMxMS55KmMyMS54KmMxMi55KmMxMy54KmMxMy55KmMyMy54IC0gNipjMTAueCpjMjEueCpjMTN5MypjMjMueCArIDYqYzIwLngqYzIxLngqYzEzeTMqYzIzLnggK1xyXG4gICAgICAgICAgICAyKmMyMS54KmMxMnkzKmMxMy54KmMyMy54ICsgNipjMTAueCpjMjEueCpjMTMueCpjMTN5MipjMjMueSArIDYqYzEwLngqYzEzLngqYzIxLnkqYzEzeTIqYzIzLnggK1xyXG4gICAgICAgICAgICA2KmMxMC54KmMxMy54KmMyMi54KmMxM3kyKmMyMi55ICsgNipjMTAueSpjMjEueCpjMTMueCpjMTN5MipjMjMueCAtIDMqYzExLngqYzEyLngqYzIxLngqYzEzeTIqYzIzLnkgLVxyXG4gICAgICAgICAgICAzKmMxMS54KmMxMi54KmMyMS55KmMxM3kyKmMyMy54IC0gMypjMTEueCpjMTIueCpjMjIueCpjMTN5MipjMjIueSArIDIqYzExLngqYzIxLngqYzEyLnkqYzEzeTIqYzIzLnggK1xyXG4gICAgICAgICAgICA0KmMxMS55KmMxMi54KmMyMS54KmMxM3kyKmMyMy54IC0gNipjMTAueSpjMjEueCpjMTN4MipjMTMueSpjMjMueSAtIDYqYzEwLnkqYzEzeDIqYzIxLnkqYzEzLnkqYzIzLnggLVxyXG4gICAgICAgICAgICA2KmMxMC55KmMxM3gyKmMyMi54KmMxMy55KmMyMi55IC0gNipjMjAueCpjMjEueCpjMTMueCpjMTN5MipjMjMueSAtIDYqYzIwLngqYzEzLngqYzIxLnkqYzEzeTIqYzIzLnggLVxyXG4gICAgICAgICAgICA2KmMyMC54KmMxMy54KmMyMi54KmMxM3kyKmMyMi55ICsgMypjMTEueSpjMjEueCpjMTIueSpjMTN4MipjMjMueSAtIDMqYzExLnkqYzEyLnkqYzEzLngqYzIyeDIqYzEzLnkgK1xyXG4gICAgICAgICAgICAzKmMxMS55KmMxMi55KmMxM3gyKmMyMS55KmMyMy54ICsgMypjMTEueSpjMTIueSpjMTN4MipjMjIueCpjMjIueSAtIDIqYzEyLngqYzIxLngqYzEyeTIqYzEzLngqYzIzLnkgLVxyXG4gICAgICAgICAgICAyKmMxMi54KmMyMS54KmMxMnkyKmMxMy55KmMyMy54IC0gMipjMTIueCpjMTJ5MipjMTMueCpjMjEueSpjMjMueCAtIDIqYzEyLngqYzEyeTIqYzEzLngqYzIyLngqYzIyLnkgLVxyXG4gICAgICAgICAgICA2KmMyMC55KmMyMS54KmMxMy54KmMxM3kyKmMyMy54IC0gNipjMjEueCpjMTMueCpjMjEueSpjMjIueCpjMTN5MiArIDYqYzIwLnkqYzEzeDIqYzIxLnkqYzEzLnkqYzIzLnggK1xyXG4gICAgICAgICAgICAyKmMxMngyKmMyMS54KmMxMi55KmMxMy55KmMyMy55ICsgMipjMTJ4MipjMTIueSpjMjEueSpjMTMueSpjMjMueCArIDIqYzEyeDIqYzEyLnkqYzIyLngqYzEzLnkqYzIyLnkgLVxyXG4gICAgICAgICAgICAzKmMxMC54KmMyMngyKmMxM3kzICsgMypjMjAueCpjMjJ4MipjMTN5MyArIDMqYzIxeDIqYzIyLngqYzEzeTMgKyBjMTJ5MypjMTMueCpjMjJ4MiArXHJcbiAgICAgICAgICAgIDMqYzEwLnkqYzEzLngqYzIyeDIqYzEzeTIgKyBjMTEueCpjMTIueSpjMjJ4MipjMTN5MiArIDIqYzExLnkqYzEyLngqYzIyeDIqYzEzeTIgLVxyXG4gICAgICAgICAgICBjMTIueCpjMTJ5MipjMjJ4MipjMTMueSAtIDMqYzIwLnkqYzEzLngqYzIyeDIqYzEzeTIgLSAzKmMyMXgyKmMxMy54KmMxM3kyKmMyMi55ICtcclxuICAgICAgICAgICAgYzEyeDIqYzEyLnkqYzEzLngqKDIqYzIxLnkqYzIzLnkgKyBjMjJ5MikgKyBjMTEueCpjMTIueCpjMTMueCpjMTMueSooNipjMjEueSpjMjMueSArIDMqYzIyeTIpICtcclxuICAgICAgICAgICAgYzIxLngqYzEzeDIqYzEzLnkqKDYqYzIwLnkqYzIzLnkgKyA2KmMyMS55KmMyMi55KSArIGMxMngzKmMxMy55KigtMipjMjEueSpjMjMueSAtIGMyMnkyKSArXHJcbiAgICAgICAgICAgIGMxMC55KmMxM3gzKig2KmMyMS55KmMyMy55ICsgMypjMjJ5MikgKyBjMTEueSpjMTIueCpjMTN4MiooLTIqYzIxLnkqYzIzLnkgLSBjMjJ5MikgK1xyXG4gICAgICAgICAgICBjMTEueCpjMTIueSpjMTN4MiooLTQqYzIxLnkqYzIzLnkgLSAyKmMyMnkyKSArIGMxMC54KmMxM3gyKmMxMy55KigtNipjMjEueSpjMjMueSAtIDMqYzIyeTIpICtcclxuICAgICAgICAgICAgYzEzeDIqYzIyLngqYzEzLnkqKDYqYzIwLnkqYzIyLnkgKyAzKmMyMXkyKSArIGMyMC54KmMxM3gyKmMxMy55Kig2KmMyMS55KmMyMy55ICsgMypjMjJ5MikgK1xyXG4gICAgICAgICAgICBjMTN4MyooLTIqYzIwLnkqYzIxLnkqYzIzLnkgLSBjMjIueSooMipjMjAueSpjMjIueSArIGMyMXkyKSAtIGMyMC55KigyKmMyMS55KmMyMy55ICsgYzIyeTIpIC1cclxuICAgICAgICAgICAgYzIxLnkqKDIqYzIwLnkqYzIzLnkgKyAyKmMyMS55KmMyMi55KSksXHJcbiAgICAgICAgLWMxMC54KmMxMS54KmMxMi55KmMxMy54KmMxMy55KmMyMy55ICsgYzEwLngqYzExLnkqYzEyLngqYzEzLngqYzEzLnkqYzIzLnkgKyA2KmMxMC54KmMxMS55KmMxMi55KmMxMy54KmMxMy55KmMyMy54IC1cclxuICAgICAgICAgICAgNipjMTAueSpjMTEueCpjMTIueCpjMTMueCpjMTMueSpjMjMueSAtIGMxMC55KmMxMS54KmMxMi55KmMxMy54KmMxMy55KmMyMy54ICsgYzEwLnkqYzExLnkqYzEyLngqYzEzLngqYzEzLnkqYzIzLnggK1xyXG4gICAgICAgICAgICBjMTEueCpjMTEueSpjMTIueCpjMTIueSpjMTMueCpjMjMueSAtIGMxMS54KmMxMS55KmMxMi54KmMxMi55KmMxMy55KmMyMy54ICsgYzExLngqYzIwLngqYzEyLnkqYzEzLngqYzEzLnkqYzIzLnkgK1xyXG4gICAgICAgICAgICBjMTEueCpjMjAueSpjMTIueSpjMTMueCpjMTMueSpjMjMueCArIGMxMS54KmMyMS54KmMxMi55KmMxMy54KmMxMy55KmMyMi55ICsgYzExLngqYzEyLnkqYzEzLngqYzIxLnkqYzIyLngqYzEzLnkgLVxyXG4gICAgICAgICAgICBjMjAueCpjMTEueSpjMTIueCpjMTMueCpjMTMueSpjMjMueSAtIDYqYzIwLngqYzExLnkqYzEyLnkqYzEzLngqYzEzLnkqYzIzLnggLSBjMTEueSpjMTIueCpjMjAueSpjMTMueCpjMTMueSpjMjMueCAtXHJcbiAgICAgICAgICAgIGMxMS55KmMxMi54KmMyMS54KmMxMy54KmMxMy55KmMyMi55IC0gYzExLnkqYzEyLngqYzEzLngqYzIxLnkqYzIyLngqYzEzLnkgLSA2KmMxMS55KmMyMS54KmMxMi55KmMxMy54KmMyMi54KmMxMy55IC1cclxuICAgICAgICAgICAgNipjMTAueCpjMjAueCpjMTN5MypjMjMueCAtIDYqYzEwLngqYzIxLngqYzIyLngqYzEzeTMgLSAyKmMxMC54KmMxMnkzKmMxMy54KmMyMy54ICsgNipjMjAueCpjMjEueCpjMjIueCpjMTN5MyArXHJcbiAgICAgICAgICAgIDIqYzIwLngqYzEyeTMqYzEzLngqYzIzLnggKyAyKmMyMS54KmMxMnkzKmMxMy54KmMyMi54ICsgMipjMTAueSpjMTJ4MypjMTMueSpjMjMueSAtIDYqYzEwLngqYzEwLnkqYzEzLngqYzEzeTIqYzIzLnggK1xyXG4gICAgICAgICAgICAzKmMxMC54KmMxMS54KmMxMi54KmMxM3kyKmMyMy55IC0gMipjMTAueCpjMTEueCpjMTIueSpjMTN5MipjMjMueCAtIDQqYzEwLngqYzExLnkqYzEyLngqYzEzeTIqYzIzLnggK1xyXG4gICAgICAgICAgICAzKmMxMC55KmMxMS54KmMxMi54KmMxM3kyKmMyMy54ICsgNipjMTAueCpjMTAueSpjMTN4MipjMTMueSpjMjMueSArIDYqYzEwLngqYzIwLngqYzEzLngqYzEzeTIqYzIzLnkgLVxyXG4gICAgICAgICAgICAzKmMxMC54KmMxMS55KmMxMi55KmMxM3gyKmMyMy55ICsgMipjMTAueCpjMTIueCpjMTJ5MipjMTMueCpjMjMueSArIDIqYzEwLngqYzEyLngqYzEyeTIqYzEzLnkqYzIzLnggK1xyXG4gICAgICAgICAgICA2KmMxMC54KmMyMC55KmMxMy54KmMxM3kyKmMyMy54ICsgNipjMTAueCpjMjEueCpjMTMueCpjMTN5MipjMjIueSArIDYqYzEwLngqYzEzLngqYzIxLnkqYzIyLngqYzEzeTIgK1xyXG4gICAgICAgICAgICA0KmMxMC55KmMxMS54KmMxMi55KmMxM3gyKmMyMy55ICsgNipjMTAueSpjMjAueCpjMTMueCpjMTN5MipjMjMueCArIDIqYzEwLnkqYzExLnkqYzEyLngqYzEzeDIqYzIzLnkgLVxyXG4gICAgICAgICAgICAzKmMxMC55KmMxMS55KmMxMi55KmMxM3gyKmMyMy54ICsgMipjMTAueSpjMTIueCpjMTJ5MipjMTMueCpjMjMueCArIDYqYzEwLnkqYzIxLngqYzEzLngqYzIyLngqYzEzeTIgLVxyXG4gICAgICAgICAgICAzKmMxMS54KmMyMC54KmMxMi54KmMxM3kyKmMyMy55ICsgMipjMTEueCpjMjAueCpjMTIueSpjMTN5MipjMjMueCArIGMxMS54KmMxMS55KmMxMnkyKmMxMy54KmMyMy54IC1cclxuICAgICAgICAgICAgMypjMTEueCpjMTIueCpjMjAueSpjMTN5MipjMjMueCAtIDMqYzExLngqYzEyLngqYzIxLngqYzEzeTIqYzIyLnkgLSAzKmMxMS54KmMxMi54KmMyMS55KmMyMi54KmMxM3kyICtcclxuICAgICAgICAgICAgMipjMTEueCpjMjEueCpjMTIueSpjMjIueCpjMTN5MiArIDQqYzIwLngqYzExLnkqYzEyLngqYzEzeTIqYzIzLnggKyA0KmMxMS55KmMxMi54KmMyMS54KmMyMi54KmMxM3kyIC1cclxuICAgICAgICAgICAgMipjMTAueCpjMTJ4MipjMTIueSpjMTMueSpjMjMueSAtIDYqYzEwLnkqYzIwLngqYzEzeDIqYzEzLnkqYzIzLnkgLSA2KmMxMC55KmMyMC55KmMxM3gyKmMxMy55KmMyMy54IC1cclxuICAgICAgICAgICAgNipjMTAueSpjMjEueCpjMTN4MipjMTMueSpjMjIueSAtIDIqYzEwLnkqYzEyeDIqYzEyLnkqYzEzLngqYzIzLnkgLSAyKmMxMC55KmMxMngyKmMxMi55KmMxMy55KmMyMy54IC1cclxuICAgICAgICAgICAgNipjMTAueSpjMTN4MipjMjEueSpjMjIueCpjMTMueSAtIGMxMS54KmMxMS55KmMxMngyKmMxMy55KmMyMy55IC0gMipjMTEueCpjMTF5MipjMTMueCpjMTMueSpjMjMueCArXHJcbiAgICAgICAgICAgIDMqYzIwLngqYzExLnkqYzEyLnkqYzEzeDIqYzIzLnkgLSAyKmMyMC54KmMxMi54KmMxMnkyKmMxMy54KmMyMy55IC0gMipjMjAueCpjMTIueCpjMTJ5MipjMTMueSpjMjMueCAtXHJcbiAgICAgICAgICAgIDYqYzIwLngqYzIwLnkqYzEzLngqYzEzeTIqYzIzLnggLSA2KmMyMC54KmMyMS54KmMxMy54KmMxM3kyKmMyMi55IC0gNipjMjAueCpjMTMueCpjMjEueSpjMjIueCpjMTN5MiArXHJcbiAgICAgICAgICAgIDMqYzExLnkqYzIwLnkqYzEyLnkqYzEzeDIqYzIzLnggKyAzKmMxMS55KmMyMS54KmMxMi55KmMxM3gyKmMyMi55ICsgMypjMTEueSpjMTIueSpjMTN4MipjMjEueSpjMjIueCAtXHJcbiAgICAgICAgICAgIDIqYzEyLngqYzIwLnkqYzEyeTIqYzEzLngqYzIzLnggLSAyKmMxMi54KmMyMS54KmMxMnkyKmMxMy54KmMyMi55IC0gMipjMTIueCpjMjEueCpjMTJ5MipjMjIueCpjMTMueSAtXHJcbiAgICAgICAgICAgIDIqYzEyLngqYzEyeTIqYzEzLngqYzIxLnkqYzIyLnggLSA2KmMyMC55KmMyMS54KmMxMy54KmMyMi54KmMxM3kyIC0gYzExeTIqYzEyLngqYzEyLnkqYzEzLngqYzIzLnggK1xyXG4gICAgICAgICAgICAyKmMyMC54KmMxMngyKmMxMi55KmMxMy55KmMyMy55ICsgNipjMjAueSpjMTN4MipjMjEueSpjMjIueCpjMTMueSArIDIqYzExeDIqYzExLnkqYzEzLngqYzEzLnkqYzIzLnkgK1xyXG4gICAgICAgICAgICBjMTF4MipjMTIueCpjMTIueSpjMTMueSpjMjMueSArIDIqYzEyeDIqYzIwLnkqYzEyLnkqYzEzLnkqYzIzLnggKyAyKmMxMngyKmMyMS54KmMxMi55KmMxMy55KmMyMi55ICtcclxuICAgICAgICAgICAgMipjMTJ4MipjMTIueSpjMjEueSpjMjIueCpjMTMueSArIGMyMXgzKmMxM3kzICsgMypjMTB4MipjMTN5MypjMjMueCAtIDMqYzEweTIqYzEzeDMqYzIzLnkgK1xyXG4gICAgICAgICAgICAzKmMyMHgyKmMxM3kzKmMyMy54ICsgYzExeTMqYzEzeDIqYzIzLnggLSBjMTF4MypjMTN5MipjMjMueSAtIGMxMS54KmMxMXkyKmMxM3gyKmMyMy55ICtcclxuICAgICAgICAgICAgYzExeDIqYzExLnkqYzEzeTIqYzIzLnggLSAzKmMxMHgyKmMxMy54KmMxM3kyKmMyMy55ICsgMypjMTB5MipjMTN4MipjMTMueSpjMjMueCAtIGMxMXgyKmMxMnkyKmMxMy54KmMyMy55ICtcclxuICAgICAgICAgICAgYzExeTIqYzEyeDIqYzEzLnkqYzIzLnggLSAzKmMyMXgyKmMxMy54KmMyMS55KmMxM3kyIC0gMypjMjB4MipjMTMueCpjMTN5MipjMjMueSArIDMqYzIweTIqYzEzeDIqYzEzLnkqYzIzLnggK1xyXG4gICAgICAgICAgICBjMTEueCpjMTIueCpjMTMueCpjMTMueSooNipjMjAueSpjMjMueSArIDYqYzIxLnkqYzIyLnkpICsgYzEyeDMqYzEzLnkqKC0yKmMyMC55KmMyMy55IC0gMipjMjEueSpjMjIueSkgK1xyXG4gICAgICAgICAgICBjMTAueSpjMTN4MyooNipjMjAueSpjMjMueSArIDYqYzIxLnkqYzIyLnkpICsgYzExLnkqYzEyLngqYzEzeDIqKC0yKmMyMC55KmMyMy55IC0gMipjMjEueSpjMjIueSkgK1xyXG4gICAgICAgICAgICBjMTJ4MipjMTIueSpjMTMueCooMipjMjAueSpjMjMueSArIDIqYzIxLnkqYzIyLnkpICsgYzExLngqYzEyLnkqYzEzeDIqKC00KmMyMC55KmMyMy55IC0gNCpjMjEueSpjMjIueSkgK1xyXG4gICAgICAgICAgICBjMTAueCpjMTN4MipjMTMueSooLTYqYzIwLnkqYzIzLnkgLSA2KmMyMS55KmMyMi55KSArIGMyMC54KmMxM3gyKmMxMy55Kig2KmMyMC55KmMyMy55ICsgNipjMjEueSpjMjIueSkgK1xyXG4gICAgICAgICAgICBjMjEueCpjMTN4MipjMTMueSooNipjMjAueSpjMjIueSArIDMqYzIxeTIpICsgYzEzeDMqKC0yKmMyMC55KmMyMS55KmMyMi55IC0gYzIweTIqYzIzLnkgLVxyXG4gICAgICAgICAgICBjMjEueSooMipjMjAueSpjMjIueSArIGMyMXkyKSAtIGMyMC55KigyKmMyMC55KmMyMy55ICsgMipjMjEueSpjMjIueSkpLFxyXG4gICAgICAgIC1jMTAueCpjMTEueCpjMTIueSpjMTMueCpjMTMueSpjMjIueSArIGMxMC54KmMxMS55KmMxMi54KmMxMy54KmMxMy55KmMyMi55ICsgNipjMTAueCpjMTEueSpjMTIueSpjMTMueCpjMjIueCpjMTMueSAtXHJcbiAgICAgICAgICAgIDYqYzEwLnkqYzExLngqYzEyLngqYzEzLngqYzEzLnkqYzIyLnkgLSBjMTAueSpjMTEueCpjMTIueSpjMTMueCpjMjIueCpjMTMueSArIGMxMC55KmMxMS55KmMxMi54KmMxMy54KmMyMi54KmMxMy55ICtcclxuICAgICAgICAgICAgYzExLngqYzExLnkqYzEyLngqYzEyLnkqYzEzLngqYzIyLnkgLSBjMTEueCpjMTEueSpjMTIueCpjMTIueSpjMjIueCpjMTMueSArIGMxMS54KmMyMC54KmMxMi55KmMxMy54KmMxMy55KmMyMi55ICtcclxuICAgICAgICAgICAgYzExLngqYzIwLnkqYzEyLnkqYzEzLngqYzIyLngqYzEzLnkgKyBjMTEueCpjMjEueCpjMTIueSpjMTMueCpjMjEueSpjMTMueSAtIGMyMC54KmMxMS55KmMxMi54KmMxMy54KmMxMy55KmMyMi55IC1cclxuICAgICAgICAgICAgNipjMjAueCpjMTEueSpjMTIueSpjMTMueCpjMjIueCpjMTMueSAtIGMxMS55KmMxMi54KmMyMC55KmMxMy54KmMyMi54KmMxMy55IC0gYzExLnkqYzEyLngqYzIxLngqYzEzLngqYzIxLnkqYzEzLnkgLVxyXG4gICAgICAgICAgICA2KmMxMC54KmMyMC54KmMyMi54KmMxM3kzIC0gMipjMTAueCpjMTJ5MypjMTMueCpjMjIueCArIDIqYzIwLngqYzEyeTMqYzEzLngqYzIyLnggKyAyKmMxMC55KmMxMngzKmMxMy55KmMyMi55IC1cclxuICAgICAgICAgICAgNipjMTAueCpjMTAueSpjMTMueCpjMjIueCpjMTN5MiArIDMqYzEwLngqYzExLngqYzEyLngqYzEzeTIqYzIyLnkgLSAyKmMxMC54KmMxMS54KmMxMi55KmMyMi54KmMxM3kyIC1cclxuICAgICAgICAgICAgNCpjMTAueCpjMTEueSpjMTIueCpjMjIueCpjMTN5MiArIDMqYzEwLnkqYzExLngqYzEyLngqYzIyLngqYzEzeTIgKyA2KmMxMC54KmMxMC55KmMxM3gyKmMxMy55KmMyMi55ICtcclxuICAgICAgICAgICAgNipjMTAueCpjMjAueCpjMTMueCpjMTN5MipjMjIueSAtIDMqYzEwLngqYzExLnkqYzEyLnkqYzEzeDIqYzIyLnkgKyAyKmMxMC54KmMxMi54KmMxMnkyKmMxMy54KmMyMi55ICtcclxuICAgICAgICAgICAgMipjMTAueCpjMTIueCpjMTJ5MipjMjIueCpjMTMueSArIDYqYzEwLngqYzIwLnkqYzEzLngqYzIyLngqYzEzeTIgKyA2KmMxMC54KmMyMS54KmMxMy54KmMyMS55KmMxM3kyICtcclxuICAgICAgICAgICAgNCpjMTAueSpjMTEueCpjMTIueSpjMTN4MipjMjIueSArIDYqYzEwLnkqYzIwLngqYzEzLngqYzIyLngqYzEzeTIgKyAyKmMxMC55KmMxMS55KmMxMi54KmMxM3gyKmMyMi55IC1cclxuICAgICAgICAgICAgMypjMTAueSpjMTEueSpjMTIueSpjMTN4MipjMjIueCArIDIqYzEwLnkqYzEyLngqYzEyeTIqYzEzLngqYzIyLnggLSAzKmMxMS54KmMyMC54KmMxMi54KmMxM3kyKmMyMi55ICtcclxuICAgICAgICAgICAgMipjMTEueCpjMjAueCpjMTIueSpjMjIueCpjMTN5MiArIGMxMS54KmMxMS55KmMxMnkyKmMxMy54KmMyMi54IC0gMypjMTEueCpjMTIueCpjMjAueSpjMjIueCpjMTN5MiAtXHJcbiAgICAgICAgICAgIDMqYzExLngqYzEyLngqYzIxLngqYzIxLnkqYzEzeTIgKyA0KmMyMC54KmMxMS55KmMxMi54KmMyMi54KmMxM3kyIC0gMipjMTAueCpjMTJ4MipjMTIueSpjMTMueSpjMjIueSAtXHJcbiAgICAgICAgICAgIDYqYzEwLnkqYzIwLngqYzEzeDIqYzEzLnkqYzIyLnkgLSA2KmMxMC55KmMyMC55KmMxM3gyKmMyMi54KmMxMy55IC0gNipjMTAueSpjMjEueCpjMTN4MipjMjEueSpjMTMueSAtXHJcbiAgICAgICAgICAgIDIqYzEwLnkqYzEyeDIqYzEyLnkqYzEzLngqYzIyLnkgLSAyKmMxMC55KmMxMngyKmMxMi55KmMyMi54KmMxMy55IC0gYzExLngqYzExLnkqYzEyeDIqYzEzLnkqYzIyLnkgLVxyXG4gICAgICAgICAgICAyKmMxMS54KmMxMXkyKmMxMy54KmMyMi54KmMxMy55ICsgMypjMjAueCpjMTEueSpjMTIueSpjMTN4MipjMjIueSAtIDIqYzIwLngqYzEyLngqYzEyeTIqYzEzLngqYzIyLnkgLVxyXG4gICAgICAgICAgICAyKmMyMC54KmMxMi54KmMxMnkyKmMyMi54KmMxMy55IC0gNipjMjAueCpjMjAueSpjMTMueCpjMjIueCpjMTN5MiAtIDYqYzIwLngqYzIxLngqYzEzLngqYzIxLnkqYzEzeTIgK1xyXG4gICAgICAgICAgICAzKmMxMS55KmMyMC55KmMxMi55KmMxM3gyKmMyMi54ICsgMypjMTEueSpjMjEueCpjMTIueSpjMTN4MipjMjEueSAtIDIqYzEyLngqYzIwLnkqYzEyeTIqYzEzLngqYzIyLnggLVxyXG4gICAgICAgICAgICAyKmMxMi54KmMyMS54KmMxMnkyKmMxMy54KmMyMS55IC0gYzExeTIqYzEyLngqYzEyLnkqYzEzLngqYzIyLnggKyAyKmMyMC54KmMxMngyKmMxMi55KmMxMy55KmMyMi55IC1cclxuICAgICAgICAgICAgMypjMTEueSpjMjF4MipjMTIueSpjMTMueCpjMTMueSArIDYqYzIwLnkqYzIxLngqYzEzeDIqYzIxLnkqYzEzLnkgKyAyKmMxMXgyKmMxMS55KmMxMy54KmMxMy55KmMyMi55ICtcclxuICAgICAgICAgICAgYzExeDIqYzEyLngqYzEyLnkqYzEzLnkqYzIyLnkgKyAyKmMxMngyKmMyMC55KmMxMi55KmMyMi54KmMxMy55ICsgMipjMTJ4MipjMjEueCpjMTIueSpjMjEueSpjMTMueSAtXHJcbiAgICAgICAgICAgIDMqYzEwLngqYzIxeDIqYzEzeTMgKyAzKmMyMC54KmMyMXgyKmMxM3kzICsgMypjMTB4MipjMjIueCpjMTN5MyAtIDMqYzEweTIqYzEzeDMqYzIyLnkgKyAzKmMyMHgyKmMyMi54KmMxM3kzICtcclxuICAgICAgICAgICAgYzIxeDIqYzEyeTMqYzEzLnggKyBjMTF5MypjMTN4MipjMjIueCAtIGMxMXgzKmMxM3kyKmMyMi55ICsgMypjMTAueSpjMjF4MipjMTMueCpjMTN5MiAtXHJcbiAgICAgICAgICAgIGMxMS54KmMxMXkyKmMxM3gyKmMyMi55ICsgYzExLngqYzIxeDIqYzEyLnkqYzEzeTIgKyAyKmMxMS55KmMxMi54KmMyMXgyKmMxM3kyICsgYzExeDIqYzExLnkqYzIyLngqYzEzeTIgLVxyXG4gICAgICAgICAgICBjMTIueCpjMjF4MipjMTJ5MipjMTMueSAtIDMqYzIwLnkqYzIxeDIqYzEzLngqYzEzeTIgLSAzKmMxMHgyKmMxMy54KmMxM3kyKmMyMi55ICsgMypjMTB5MipjMTN4MipjMjIueCpjMTMueSAtXHJcbiAgICAgICAgICAgIGMxMXgyKmMxMnkyKmMxMy54KmMyMi55ICsgYzExeTIqYzEyeDIqYzIyLngqYzEzLnkgLSAzKmMyMHgyKmMxMy54KmMxM3kyKmMyMi55ICsgMypjMjB5MipjMTN4MipjMjIueCpjMTMueSArXHJcbiAgICAgICAgICAgIGMxMngyKmMxMi55KmMxMy54KigyKmMyMC55KmMyMi55ICsgYzIxeTIpICsgYzExLngqYzEyLngqYzEzLngqYzEzLnkqKDYqYzIwLnkqYzIyLnkgKyAzKmMyMXkyKSArXHJcbiAgICAgICAgICAgIGMxMngzKmMxMy55KigtMipjMjAueSpjMjIueSAtIGMyMXkyKSArIGMxMC55KmMxM3gzKig2KmMyMC55KmMyMi55ICsgMypjMjF5MikgK1xyXG4gICAgICAgICAgICBjMTEueSpjMTIueCpjMTN4MiooLTIqYzIwLnkqYzIyLnkgLSBjMjF5MikgKyBjMTEueCpjMTIueSpjMTN4MiooLTQqYzIwLnkqYzIyLnkgLSAyKmMyMXkyKSArXHJcbiAgICAgICAgICAgIGMxMC54KmMxM3gyKmMxMy55KigtNipjMjAueSpjMjIueSAtIDMqYzIxeTIpICsgYzIwLngqYzEzeDIqYzEzLnkqKDYqYzIwLnkqYzIyLnkgKyAzKmMyMXkyKSArXHJcbiAgICAgICAgICAgIGMxM3gzKigtMipjMjAueSpjMjF5MiAtIGMyMHkyKmMyMi55IC0gYzIwLnkqKDIqYzIwLnkqYzIyLnkgKyBjMjF5MikpLFxyXG4gICAgICAgIC1jMTAueCpjMTEueCpjMTIueSpjMTMueCpjMjEueSpjMTMueSArIGMxMC54KmMxMS55KmMxMi54KmMxMy54KmMyMS55KmMxMy55ICsgNipjMTAueCpjMTEueSpjMjEueCpjMTIueSpjMTMueCpjMTMueSAtXHJcbiAgICAgICAgICAgIDYqYzEwLnkqYzExLngqYzEyLngqYzEzLngqYzIxLnkqYzEzLnkgLSBjMTAueSpjMTEueCpjMjEueCpjMTIueSpjMTMueCpjMTMueSArIGMxMC55KmMxMS55KmMxMi54KmMyMS54KmMxMy54KmMxMy55IC1cclxuICAgICAgICAgICAgYzExLngqYzExLnkqYzEyLngqYzIxLngqYzEyLnkqYzEzLnkgKyBjMTEueCpjMTEueSpjMTIueCpjMTIueSpjMTMueCpjMjEueSArIGMxMS54KmMyMC54KmMxMi55KmMxMy54KmMyMS55KmMxMy55ICtcclxuICAgICAgICAgICAgNipjMTEueCpjMTIueCpjMjAueSpjMTMueCpjMjEueSpjMTMueSArIGMxMS54KmMyMC55KmMyMS54KmMxMi55KmMxMy54KmMxMy55IC0gYzIwLngqYzExLnkqYzEyLngqYzEzLngqYzIxLnkqYzEzLnkgLVxyXG4gICAgICAgICAgICA2KmMyMC54KmMxMS55KmMyMS54KmMxMi55KmMxMy54KmMxMy55IC0gYzExLnkqYzEyLngqYzIwLnkqYzIxLngqYzEzLngqYzEzLnkgLSA2KmMxMC54KmMyMC54KmMyMS54KmMxM3kzIC1cclxuICAgICAgICAgICAgMipjMTAueCpjMjEueCpjMTJ5MypjMTMueCArIDYqYzEwLnkqYzIwLnkqYzEzeDMqYzIxLnkgKyAyKmMyMC54KmMyMS54KmMxMnkzKmMxMy54ICsgMipjMTAueSpjMTJ4MypjMjEueSpjMTMueSAtXHJcbiAgICAgICAgICAgIDIqYzEyeDMqYzIwLnkqYzIxLnkqYzEzLnkgLSA2KmMxMC54KmMxMC55KmMyMS54KmMxMy54KmMxM3kyICsgMypjMTAueCpjMTEueCpjMTIueCpjMjEueSpjMTN5MiAtXHJcbiAgICAgICAgICAgIDIqYzEwLngqYzExLngqYzIxLngqYzEyLnkqYzEzeTIgLSA0KmMxMC54KmMxMS55KmMxMi54KmMyMS54KmMxM3kyICsgMypjMTAueSpjMTEueCpjMTIueCpjMjEueCpjMTN5MiArXHJcbiAgICAgICAgICAgIDYqYzEwLngqYzEwLnkqYzEzeDIqYzIxLnkqYzEzLnkgKyA2KmMxMC54KmMyMC54KmMxMy54KmMyMS55KmMxM3kyIC0gMypjMTAueCpjMTEueSpjMTIueSpjMTN4MipjMjEueSArXHJcbiAgICAgICAgICAgIDIqYzEwLngqYzEyLngqYzIxLngqYzEyeTIqYzEzLnkgKyAyKmMxMC54KmMxMi54KmMxMnkyKmMxMy54KmMyMS55ICsgNipjMTAueCpjMjAueSpjMjEueCpjMTMueCpjMTN5MiArXHJcbiAgICAgICAgICAgIDQqYzEwLnkqYzExLngqYzEyLnkqYzEzeDIqYzIxLnkgKyA2KmMxMC55KmMyMC54KmMyMS54KmMxMy54KmMxM3kyICsgMipjMTAueSpjMTEueSpjMTIueCpjMTN4MipjMjEueSAtXHJcbiAgICAgICAgICAgIDMqYzEwLnkqYzExLnkqYzIxLngqYzEyLnkqYzEzeDIgKyAyKmMxMC55KmMxMi54KmMyMS54KmMxMnkyKmMxMy54IC0gMypjMTEueCpjMjAueCpjMTIueCpjMjEueSpjMTN5MiArXHJcbiAgICAgICAgICAgIDIqYzExLngqYzIwLngqYzIxLngqYzEyLnkqYzEzeTIgKyBjMTEueCpjMTEueSpjMjEueCpjMTJ5MipjMTMueCAtIDMqYzExLngqYzEyLngqYzIwLnkqYzIxLngqYzEzeTIgK1xyXG4gICAgICAgICAgICA0KmMyMC54KmMxMS55KmMxMi54KmMyMS54KmMxM3kyIC0gNipjMTAueCpjMjAueSpjMTN4MipjMjEueSpjMTMueSAtIDIqYzEwLngqYzEyeDIqYzEyLnkqYzIxLnkqYzEzLnkgLVxyXG4gICAgICAgICAgICA2KmMxMC55KmMyMC54KmMxM3gyKmMyMS55KmMxMy55IC0gNipjMTAueSpjMjAueSpjMjEueCpjMTN4MipjMTMueSAtIDIqYzEwLnkqYzEyeDIqYzIxLngqYzEyLnkqYzEzLnkgLVxyXG4gICAgICAgICAgICAyKmMxMC55KmMxMngyKmMxMi55KmMxMy54KmMyMS55IC0gYzExLngqYzExLnkqYzEyeDIqYzIxLnkqYzEzLnkgLSA0KmMxMS54KmMyMC55KmMxMi55KmMxM3gyKmMyMS55IC1cclxuICAgICAgICAgICAgMipjMTEueCpjMTF5MipjMjEueCpjMTMueCpjMTMueSArIDMqYzIwLngqYzExLnkqYzEyLnkqYzEzeDIqYzIxLnkgLSAyKmMyMC54KmMxMi54KmMyMS54KmMxMnkyKmMxMy55IC1cclxuICAgICAgICAgICAgMipjMjAueCpjMTIueCpjMTJ5MipjMTMueCpjMjEueSAtIDYqYzIwLngqYzIwLnkqYzIxLngqYzEzLngqYzEzeTIgLSAyKmMxMS55KmMxMi54KmMyMC55KmMxM3gyKmMyMS55ICtcclxuICAgICAgICAgICAgMypjMTEueSpjMjAueSpjMjEueCpjMTIueSpjMTN4MiAtIDIqYzEyLngqYzIwLnkqYzIxLngqYzEyeTIqYzEzLnggLSBjMTF5MipjMTIueCpjMjEueCpjMTIueSpjMTMueCArXHJcbiAgICAgICAgICAgIDYqYzIwLngqYzIwLnkqYzEzeDIqYzIxLnkqYzEzLnkgKyAyKmMyMC54KmMxMngyKmMxMi55KmMyMS55KmMxMy55ICsgMipjMTF4MipjMTEueSpjMTMueCpjMjEueSpjMTMueSArXHJcbiAgICAgICAgICAgIGMxMXgyKmMxMi54KmMxMi55KmMyMS55KmMxMy55ICsgMipjMTJ4MipjMjAueSpjMjEueCpjMTIueSpjMTMueSArIDIqYzEyeDIqYzIwLnkqYzEyLnkqYzEzLngqYzIxLnkgK1xyXG4gICAgICAgICAgICAzKmMxMHgyKmMyMS54KmMxM3kzIC0gMypjMTB5MipjMTN4MypjMjEueSArIDMqYzIweDIqYzIxLngqYzEzeTMgKyBjMTF5MypjMjEueCpjMTN4MiAtIGMxMXgzKmMyMS55KmMxM3kyIC1cclxuICAgICAgICAgICAgMypjMjB5MipjMTN4MypjMjEueSAtIGMxMS54KmMxMXkyKmMxM3gyKmMyMS55ICsgYzExeDIqYzExLnkqYzIxLngqYzEzeTIgLSAzKmMxMHgyKmMxMy54KmMyMS55KmMxM3kyICtcclxuICAgICAgICAgICAgMypjMTB5MipjMjEueCpjMTN4MipjMTMueSAtIGMxMXgyKmMxMnkyKmMxMy54KmMyMS55ICsgYzExeTIqYzEyeDIqYzIxLngqYzEzLnkgLSAzKmMyMHgyKmMxMy54KmMyMS55KmMxM3kyICtcclxuICAgICAgICAgICAgMypjMjB5MipjMjEueCpjMTN4MipjMTMueSxcclxuICAgICAgICBjMTAueCpjMTAueSpjMTEueCpjMTIueSpjMTMueCpjMTMueSAtIGMxMC54KmMxMC55KmMxMS55KmMxMi54KmMxMy54KmMxMy55ICsgYzEwLngqYzExLngqYzExLnkqYzEyLngqYzEyLnkqYzEzLnkgLVxyXG4gICAgICAgICAgICBjMTAueSpjMTEueCpjMTEueSpjMTIueCpjMTIueSpjMTMueCAtIGMxMC54KmMxMS54KmMyMC55KmMxMi55KmMxMy54KmMxMy55ICsgNipjMTAueCpjMjAueCpjMTEueSpjMTIueSpjMTMueCpjMTMueSArXHJcbiAgICAgICAgICAgIGMxMC54KmMxMS55KmMxMi54KmMyMC55KmMxMy54KmMxMy55IC0gYzEwLnkqYzExLngqYzIwLngqYzEyLnkqYzEzLngqYzEzLnkgLSA2KmMxMC55KmMxMS54KmMxMi54KmMyMC55KmMxMy54KmMxMy55ICtcclxuICAgICAgICAgICAgYzEwLnkqYzIwLngqYzExLnkqYzEyLngqYzEzLngqYzEzLnkgLSBjMTEueCpjMjAueCpjMTEueSpjMTIueCpjMTIueSpjMTMueSArIGMxMS54KmMxMS55KmMxMi54KmMyMC55KmMxMi55KmMxMy54ICtcclxuICAgICAgICAgICAgYzExLngqYzIwLngqYzIwLnkqYzEyLnkqYzEzLngqYzEzLnkgLSBjMjAueCpjMTEueSpjMTIueCpjMjAueSpjMTMueCpjMTMueSAtIDIqYzEwLngqYzIwLngqYzEyeTMqYzEzLnggK1xyXG4gICAgICAgICAgICAyKmMxMC55KmMxMngzKmMyMC55KmMxMy55IC0gMypjMTAueCpjMTAueSpjMTEueCpjMTIueCpjMTN5MiAtIDYqYzEwLngqYzEwLnkqYzIwLngqYzEzLngqYzEzeTIgK1xyXG4gICAgICAgICAgICAzKmMxMC54KmMxMC55KmMxMS55KmMxMi55KmMxM3gyIC0gMipjMTAueCpjMTAueSpjMTIueCpjMTJ5MipjMTMueCAtIDIqYzEwLngqYzExLngqYzIwLngqYzEyLnkqYzEzeTIgLVxyXG4gICAgICAgICAgICBjMTAueCpjMTEueCpjMTEueSpjMTJ5MipjMTMueCArIDMqYzEwLngqYzExLngqYzEyLngqYzIwLnkqYzEzeTIgLSA0KmMxMC54KmMyMC54KmMxMS55KmMxMi54KmMxM3kyICtcclxuICAgICAgICAgICAgMypjMTAueSpjMTEueCpjMjAueCpjMTIueCpjMTN5MiArIDYqYzEwLngqYzEwLnkqYzIwLnkqYzEzeDIqYzEzLnkgKyAyKmMxMC54KmMxMC55KmMxMngyKmMxMi55KmMxMy55ICtcclxuICAgICAgICAgICAgMipjMTAueCpjMTEueCpjMTF5MipjMTMueCpjMTMueSArIDIqYzEwLngqYzIwLngqYzEyLngqYzEyeTIqYzEzLnkgKyA2KmMxMC54KmMyMC54KmMyMC55KmMxMy54KmMxM3kyIC1cclxuICAgICAgICAgICAgMypjMTAueCpjMTEueSpjMjAueSpjMTIueSpjMTN4MiArIDIqYzEwLngqYzEyLngqYzIwLnkqYzEyeTIqYzEzLnggKyBjMTAueCpjMTF5MipjMTIueCpjMTIueSpjMTMueCArXHJcbiAgICAgICAgICAgIGMxMC55KmMxMS54KmMxMS55KmMxMngyKmMxMy55ICsgNCpjMTAueSpjMTEueCpjMjAueSpjMTIueSpjMTN4MiAtIDMqYzEwLnkqYzIwLngqYzExLnkqYzEyLnkqYzEzeDIgK1xyXG4gICAgICAgICAgICAyKmMxMC55KmMyMC54KmMxMi54KmMxMnkyKmMxMy54ICsgMipjMTAueSpjMTEueSpjMTIueCpjMjAueSpjMTN4MiArIGMxMS54KmMyMC54KmMxMS55KmMxMnkyKmMxMy54IC1cclxuICAgICAgICAgICAgMypjMTEueCpjMjAueCpjMTIueCpjMjAueSpjMTN5MiAtIDIqYzEwLngqYzEyeDIqYzIwLnkqYzEyLnkqYzEzLnkgLSA2KmMxMC55KmMyMC54KmMyMC55KmMxM3gyKmMxMy55IC1cclxuICAgICAgICAgICAgMipjMTAueSpjMjAueCpjMTJ4MipjMTIueSpjMTMueSAtIDIqYzEwLnkqYzExeDIqYzExLnkqYzEzLngqYzEzLnkgLSBjMTAueSpjMTF4MipjMTIueCpjMTIueSpjMTMueSAtXHJcbiAgICAgICAgICAgIDIqYzEwLnkqYzEyeDIqYzIwLnkqYzEyLnkqYzEzLnggLSAyKmMxMS54KmMyMC54KmMxMXkyKmMxMy54KmMxMy55IC0gYzExLngqYzExLnkqYzEyeDIqYzIwLnkqYzEzLnkgK1xyXG4gICAgICAgICAgICAzKmMyMC54KmMxMS55KmMyMC55KmMxMi55KmMxM3gyIC0gMipjMjAueCpjMTIueCpjMjAueSpjMTJ5MipjMTMueCAtIGMyMC54KmMxMXkyKmMxMi54KmMxMi55KmMxMy54ICtcclxuICAgICAgICAgICAgMypjMTB5MipjMTEueCpjMTIueCpjMTMueCpjMTMueSArIDMqYzExLngqYzEyLngqYzIweTIqYzEzLngqYzEzLnkgKyAyKmMyMC54KmMxMngyKmMyMC55KmMxMi55KmMxMy55IC1cclxuICAgICAgICAgICAgMypjMTB4MipjMTEueSpjMTIueSpjMTMueCpjMTMueSArIDIqYzExeDIqYzExLnkqYzIwLnkqYzEzLngqYzEzLnkgKyBjMTF4MipjMTIueCpjMjAueSpjMTIueSpjMTMueSAtXHJcbiAgICAgICAgICAgIDMqYzIweDIqYzExLnkqYzEyLnkqYzEzLngqYzEzLnkgLSBjMTB4MypjMTN5MyArIGMxMHkzKmMxM3gzICsgYzIweDMqYzEzeTMgLSBjMjB5MypjMTN4MyAtXHJcbiAgICAgICAgICAgIDMqYzEwLngqYzIweDIqYzEzeTMgLSBjMTAueCpjMTF5MypjMTN4MiArIDMqYzEweDIqYzIwLngqYzEzeTMgKyBjMTAueSpjMTF4MypjMTN5MiArXHJcbiAgICAgICAgICAgIDMqYzEwLnkqYzIweTIqYzEzeDMgKyBjMjAueCpjMTF5MypjMTN4MiArIGMxMHgyKmMxMnkzKmMxMy54IC0gMypjMTB5MipjMjAueSpjMTN4MyAtIGMxMHkyKmMxMngzKmMxMy55ICtcclxuICAgICAgICAgICAgYzIweDIqYzEyeTMqYzEzLnggLSBjMTF4MypjMjAueSpjMTN5MiAtIGMxMngzKmMyMHkyKmMxMy55IC0gYzEwLngqYzExeDIqYzExLnkqYzEzeTIgK1xyXG4gICAgICAgICAgICBjMTAueSpjMTEueCpjMTF5MipjMTN4MiAtIDMqYzEwLngqYzEweTIqYzEzeDIqYzEzLnkgLSBjMTAueCpjMTF5MipjMTJ4MipjMTMueSArIGMxMC55KmMxMXgyKmMxMnkyKmMxMy54IC1cclxuICAgICAgICAgICAgYzExLngqYzExeTIqYzIwLnkqYzEzeDIgKyAzKmMxMHgyKmMxMC55KmMxMy54KmMxM3kyICsgYzEweDIqYzExLngqYzEyLnkqYzEzeTIgK1xyXG4gICAgICAgICAgICAyKmMxMHgyKmMxMS55KmMxMi54KmMxM3kyIC0gMipjMTB5MipjMTEueCpjMTIueSpjMTN4MiAtIGMxMHkyKmMxMS55KmMxMi54KmMxM3gyICsgYzExeDIqYzIwLngqYzExLnkqYzEzeTIgLVxyXG4gICAgICAgICAgICAzKmMxMC54KmMyMHkyKmMxM3gyKmMxMy55ICsgMypjMTAueSpjMjB4MipjMTMueCpjMTN5MiArIGMxMS54KmMyMHgyKmMxMi55KmMxM3kyIC0gMipjMTEueCpjMjB5MipjMTIueSpjMTN4MiArXHJcbiAgICAgICAgICAgIGMyMC54KmMxMXkyKmMxMngyKmMxMy55IC0gYzExLnkqYzEyLngqYzIweTIqYzEzeDIgLSBjMTB4MipjMTIueCpjMTJ5MipjMTMueSAtIDMqYzEweDIqYzIwLnkqYzEzLngqYzEzeTIgK1xyXG4gICAgICAgICAgICAzKmMxMHkyKmMyMC54KmMxM3gyKmMxMy55ICsgYzEweTIqYzEyeDIqYzEyLnkqYzEzLnggLSBjMTF4MipjMjAueSpjMTJ5MipjMTMueCArIDIqYzIweDIqYzExLnkqYzEyLngqYzEzeTIgK1xyXG4gICAgICAgICAgICAzKmMyMC54KmMyMHkyKmMxM3gyKmMxMy55IC0gYzIweDIqYzEyLngqYzEyeTIqYzEzLnkgLSAzKmMyMHgyKmMyMC55KmMxMy54KmMxM3kyICsgYzEyeDIqYzIweTIqYzEyLnkqYzEzLnhcclxuICAgICk7XHJcbiAgICB2YXIgcm9vdHMgPSBwb2x5LmdldFJvb3RzSW5JbnRlcnZhbCgwLDEpO1xyXG5cclxuICAgIGZvciAoIHZhciBpID0gMDsgaSA8IHJvb3RzLmxlbmd0aDsgaSsrICkge1xyXG4gICAgICAgIHZhciBzID0gcm9vdHNbaV07XHJcbiAgICAgICAgdmFyIHhSb290cyA9IG5ldyBQb2x5bm9taWFsKFxyXG4gICAgICAgICAgICBjMTMueCxcclxuICAgICAgICAgICAgYzEyLngsXHJcbiAgICAgICAgICAgIGMxMS54LFxyXG4gICAgICAgICAgICBjMTAueCAtIGMyMC54IC0gcypjMjEueCAtIHMqcypjMjIueCAtIHMqcypzKmMyMy54XHJcbiAgICAgICAgKS5nZXRSb290cygpO1xyXG4gICAgICAgIHZhciB5Um9vdHMgPSBuZXcgUG9seW5vbWlhbChcclxuICAgICAgICAgICAgYzEzLnksXHJcbiAgICAgICAgICAgIGMxMi55LFxyXG4gICAgICAgICAgICBjMTEueSxcclxuICAgICAgICAgICAgYzEwLnkgLSBjMjAueSAtIHMqYzIxLnkgLSBzKnMqYzIyLnkgLSBzKnMqcypjMjMueVxyXG4gICAgICAgICkuZ2V0Um9vdHMoKTtcclxuXHJcbiAgICAgICAgaWYgKCB4Um9vdHMubGVuZ3RoID4gMCAmJiB5Um9vdHMubGVuZ3RoID4gMCApIHtcclxuICAgICAgICAgICAgdmFyIFRPTEVSQU5DRSA9IDFlLTQ7XHJcblxyXG4gICAgICAgICAgICBjaGVja1Jvb3RzOlxyXG4gICAgICAgICAgICBmb3IgKCB2YXIgaiA9IDA7IGogPCB4Um9vdHMubGVuZ3RoOyBqKysgKSB7XHJcbiAgICAgICAgICAgICAgICB2YXIgeFJvb3QgPSB4Um9vdHNbal07XHJcblxyXG4gICAgICAgICAgICAgICAgaWYgKCAwIDw9IHhSb290ICYmIHhSb290IDw9IDEgKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgZm9yICggdmFyIGsgPSAwOyBrIDwgeVJvb3RzLmxlbmd0aDsgaysrICkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoIE1hdGguYWJzKCB4Um9vdCAtIHlSb290c1trXSApIDwgVE9MRVJBTkNFICkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcmVzdWx0LnBvaW50cy5wdXNoKFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGMyMy5tdWx0aXBseShzKnMqcykuYWRkKGMyMi5tdWx0aXBseShzKnMpLmFkZChjMjEubXVsdGlwbHkocykuYWRkKGMyMCkpKVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrIGNoZWNrUm9vdHM7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKCByZXN1bHQucG9pbnRzLmxlbmd0aCA+IDAgKSByZXN1bHQuc3RhdHVzID0gXCJJbnRlcnNlY3Rpb25cIjtcclxuXHJcbiAgICByZXR1cm4gcmVzdWx0O1xyXG59O1xyXG5cclxuXHJcbi8qKlxyXG4gKiAgaW50ZXJzZWN0QmV6aWVyM0NpcmNsZVxyXG4gKlxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBwMVxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBwMlxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBwM1xyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBwNFxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBjXHJcbiAqICBAcGFyYW0ge051bWJlcn0gclxyXG4gKiAgQHJldHVybnMge0ludGVyc2VjdGlvbn1cclxuICovXHJcbkludGVyc2VjdGlvbi5pbnRlcnNlY3RCZXppZXIzQ2lyY2xlID0gZnVuY3Rpb24ocDEsIHAyLCBwMywgcDQsIGMsIHIpIHtcclxuICAgIHJldHVybiBJbnRlcnNlY3Rpb24uaW50ZXJzZWN0QmV6aWVyM0VsbGlwc2UocDEsIHAyLCBwMywgcDQsIGMsIHIsIHIpO1xyXG59O1xyXG5cclxuXHJcbi8qKlxyXG4gKiAgaW50ZXJzZWN0QmV6aWVyM0VsbGlwc2VcclxuICpcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gcDFcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gcDJcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gcDNcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gcDRcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gZWNcclxuICogIEBwYXJhbSB7TnVtYmVyfSByeFxyXG4gKiAgQHBhcmFtIHtOdW1iZXJ9IHJ5XHJcbiAqICBAcmV0dXJucyB7SW50ZXJzZWN0aW9ufVxyXG4gKi9cclxuSW50ZXJzZWN0aW9uLmludGVyc2VjdEJlemllcjNFbGxpcHNlID0gZnVuY3Rpb24ocDEsIHAyLCBwMywgcDQsIGVjLCByeCwgcnkpIHtcclxuICAgIHZhciBhLCBiLCBjLCBkOyAgICAgICAvLyB0ZW1wb3JhcnkgdmFyaWFibGVzXHJcbiAgICB2YXIgYzMsIGMyLCBjMSwgYzA7ICAgLy8gY29lZmZpY2llbnRzIG9mIGN1YmljXHJcbiAgICB2YXIgcmVzdWx0ID0gbmV3IEludGVyc2VjdGlvbihcIk5vIEludGVyc2VjdGlvblwiKTtcclxuXHJcbiAgICAvLyBDYWxjdWxhdGUgdGhlIGNvZWZmaWNpZW50cyBvZiBjdWJpYyBwb2x5bm9taWFsXHJcbiAgICBhID0gcDEubXVsdGlwbHkoLTEpO1xyXG4gICAgYiA9IHAyLm11bHRpcGx5KDMpO1xyXG4gICAgYyA9IHAzLm11bHRpcGx5KC0zKTtcclxuICAgIGQgPSBhLmFkZChiLmFkZChjLmFkZChwNCkpKTtcclxuICAgIGMzID0gbmV3IFZlY3RvcjJEKGQueCwgZC55KTtcclxuXHJcbiAgICBhID0gcDEubXVsdGlwbHkoMyk7XHJcbiAgICBiID0gcDIubXVsdGlwbHkoLTYpO1xyXG4gICAgYyA9IHAzLm11bHRpcGx5KDMpO1xyXG4gICAgZCA9IGEuYWRkKGIuYWRkKGMpKTtcclxuICAgIGMyID0gbmV3IFZlY3RvcjJEKGQueCwgZC55KTtcclxuXHJcbiAgICBhID0gcDEubXVsdGlwbHkoLTMpO1xyXG4gICAgYiA9IHAyLm11bHRpcGx5KDMpO1xyXG4gICAgYyA9IGEuYWRkKGIpO1xyXG4gICAgYzEgPSBuZXcgVmVjdG9yMkQoYy54LCBjLnkpO1xyXG5cclxuICAgIGMwID0gbmV3IFZlY3RvcjJEKHAxLngsIHAxLnkpO1xyXG5cclxuICAgIHZhciByeHJ4ICA9IHJ4KnJ4O1xyXG4gICAgdmFyIHJ5cnkgID0gcnkqcnk7XHJcbiAgICB2YXIgcG9seSA9IG5ldyBQb2x5bm9taWFsKFxyXG4gICAgICAgIGMzLngqYzMueCpyeXJ5ICsgYzMueSpjMy55KnJ4cngsXHJcbiAgICAgICAgMiooYzMueCpjMi54KnJ5cnkgKyBjMy55KmMyLnkqcnhyeCksXHJcbiAgICAgICAgMiooYzMueCpjMS54KnJ5cnkgKyBjMy55KmMxLnkqcnhyeCkgKyBjMi54KmMyLngqcnlyeSArIGMyLnkqYzIueSpyeHJ4LFxyXG4gICAgICAgIDIqYzMueCpyeXJ5KihjMC54IC0gZWMueCkgKyAyKmMzLnkqcnhyeCooYzAueSAtIGVjLnkpICtcclxuICAgICAgICAgICAgMiooYzIueCpjMS54KnJ5cnkgKyBjMi55KmMxLnkqcnhyeCksXHJcbiAgICAgICAgMipjMi54KnJ5cnkqKGMwLnggLSBlYy54KSArIDIqYzIueSpyeHJ4KihjMC55IC0gZWMueSkgK1xyXG4gICAgICAgICAgICBjMS54KmMxLngqcnlyeSArIGMxLnkqYzEueSpyeHJ4LFxyXG4gICAgICAgIDIqYzEueCpyeXJ5KihjMC54IC0gZWMueCkgKyAyKmMxLnkqcnhyeCooYzAueSAtIGVjLnkpLFxyXG4gICAgICAgIGMwLngqYzAueCpyeXJ5IC0gMipjMC55KmVjLnkqcnhyeCAtIDIqYzAueCplYy54KnJ5cnkgK1xyXG4gICAgICAgICAgICBjMC55KmMwLnkqcnhyeCArIGVjLngqZWMueCpyeXJ5ICsgZWMueSplYy55KnJ4cnggLSByeHJ4KnJ5cnlcclxuICAgICk7XHJcbiAgICB2YXIgcm9vdHMgPSBwb2x5LmdldFJvb3RzSW5JbnRlcnZhbCgwLDEpO1xyXG5cclxuICAgIGZvciAoIHZhciBpID0gMDsgaSA8IHJvb3RzLmxlbmd0aDsgaSsrICkge1xyXG4gICAgICAgIHZhciB0ID0gcm9vdHNbaV07XHJcblxyXG4gICAgICAgIHJlc3VsdC5wb2ludHMucHVzaChcclxuICAgICAgICAgICAgYzMubXVsdGlwbHkodCp0KnQpLmFkZChjMi5tdWx0aXBseSh0KnQpLmFkZChjMS5tdWx0aXBseSh0KS5hZGQoYzApKSlcclxuICAgICAgICApO1xyXG4gICAgfVxyXG5cclxuICAgIGlmICggcmVzdWx0LnBvaW50cy5sZW5ndGggPiAwICkgcmVzdWx0LnN0YXR1cyA9IFwiSW50ZXJzZWN0aW9uXCI7XHJcblxyXG4gICAgcmV0dXJuIHJlc3VsdDtcclxufTtcclxuXHJcblxyXG4vKipcclxuICogIGludGVyc2VjdEJlemllcjNMaW5lXHJcbiAqXHJcbiAqICBNYW55IHRoYW5rcyB0byBEYW4gU3VuZGF5IGF0IFNvZnRTdXJmZXIuY29tLiAgSGUgZ2F2ZSBtZSBhIHZlcnkgdGhvcm91Z2hcclxuICogIHNrZXRjaCBvZiB0aGUgYWxnb3JpdGhtIHVzZWQgaGVyZS4gIFdpdGhvdXQgaGlzIGhlbHAsIEknbSBub3Qgc3VyZSB3aGVuIElcclxuICogIHdvdWxkIGhhdmUgZmlndXJlZCBvdXQgdGhpcyBpbnRlcnNlY3Rpb24gcHJvYmxlbS5cclxuICpcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gcDFcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gcDJcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gcDNcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gcDRcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gYTFcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gYTJcclxuICogIEByZXR1cm5zIHtJbnRlcnNlY3Rpb259XHJcbiAqL1xyXG5JbnRlcnNlY3Rpb24uaW50ZXJzZWN0QmV6aWVyM0xpbmUgPSBmdW5jdGlvbihwMSwgcDIsIHAzLCBwNCwgYTEsIGEyKSB7XHJcbiAgICB2YXIgYSwgYiwgYywgZDsgICAgICAgLy8gdGVtcG9yYXJ5IHZhcmlhYmxlc1xyXG4gICAgdmFyIGMzLCBjMiwgYzEsIGMwOyAgIC8vIGNvZWZmaWNpZW50cyBvZiBjdWJpY1xyXG4gICAgdmFyIGNsOyAgICAgICAgICAgICAgIC8vIGMgY29lZmZpY2llbnQgZm9yIG5vcm1hbCBmb3JtIG9mIGxpbmVcclxuICAgIHZhciBuOyAgICAgICAgICAgICAgICAvLyBub3JtYWwgZm9yIG5vcm1hbCBmb3JtIG9mIGxpbmVcclxuICAgIHZhciBtaW4gPSBhMS5taW4oYTIpOyAvLyB1c2VkIHRvIGRldGVybWluZSBpZiBwb2ludCBpcyBvbiBsaW5lIHNlZ21lbnRcclxuICAgIHZhciBtYXggPSBhMS5tYXgoYTIpOyAvLyB1c2VkIHRvIGRldGVybWluZSBpZiBwb2ludCBpcyBvbiBsaW5lIHNlZ21lbnRcclxuICAgIHZhciByZXN1bHQgPSBuZXcgSW50ZXJzZWN0aW9uKFwiTm8gSW50ZXJzZWN0aW9uXCIpO1xyXG5cclxuICAgIC8vIFN0YXJ0IHdpdGggQmV6aWVyIHVzaW5nIEJlcm5zdGVpbiBwb2x5bm9taWFscyBmb3Igd2VpZ2h0aW5nIGZ1bmN0aW9uczpcclxuICAgIC8vICAgICAoMS10XjMpUDEgKyAzdCgxLXQpXjJQMiArIDN0XjIoMS10KVAzICsgdF4zUDRcclxuICAgIC8vXHJcbiAgICAvLyBFeHBhbmQgYW5kIGNvbGxlY3QgdGVybXMgdG8gZm9ybSBsaW5lYXIgY29tYmluYXRpb25zIG9mIG9yaWdpbmFsIEJlemllclxyXG4gICAgLy8gY29udHJvbHMuICBUaGlzIGVuZHMgdXAgd2l0aCBhIHZlY3RvciBjdWJpYyBpbiB0OlxyXG4gICAgLy8gICAgICgtUDErM1AyLTNQMytQNCl0XjMgKyAoM1AxLTZQMiszUDMpdF4yICsgKC0zUDErM1AyKXQgKyBQMVxyXG4gICAgLy8gICAgICAgICAgICAgL1xcICAgICAgICAgICAgICAgICAgL1xcICAgICAgICAgICAgICAgIC9cXCAgICAgICAvXFxcclxuICAgIC8vICAgICAgICAgICAgIHx8ICAgICAgICAgICAgICAgICAgfHwgICAgICAgICAgICAgICAgfHwgICAgICAgfHxcclxuICAgIC8vICAgICAgICAgICAgIGMzICAgICAgICAgICAgICAgICAgYzIgICAgICAgICAgICAgICAgYzEgICAgICAgYzBcclxuXHJcbiAgICAvLyBDYWxjdWxhdGUgdGhlIGNvZWZmaWNpZW50c1xyXG4gICAgYSA9IHAxLm11bHRpcGx5KC0xKTtcclxuICAgIGIgPSBwMi5tdWx0aXBseSgzKTtcclxuICAgIGMgPSBwMy5tdWx0aXBseSgtMyk7XHJcbiAgICBkID0gYS5hZGQoYi5hZGQoYy5hZGQocDQpKSk7XHJcbiAgICBjMyA9IG5ldyBWZWN0b3IyRChkLngsIGQueSk7XHJcblxyXG4gICAgYSA9IHAxLm11bHRpcGx5KDMpO1xyXG4gICAgYiA9IHAyLm11bHRpcGx5KC02KTtcclxuICAgIGMgPSBwMy5tdWx0aXBseSgzKTtcclxuICAgIGQgPSBhLmFkZChiLmFkZChjKSk7XHJcbiAgICBjMiA9IG5ldyBWZWN0b3IyRChkLngsIGQueSk7XHJcblxyXG4gICAgYSA9IHAxLm11bHRpcGx5KC0zKTtcclxuICAgIGIgPSBwMi5tdWx0aXBseSgzKTtcclxuICAgIGMgPSBhLmFkZChiKTtcclxuICAgIGMxID0gbmV3IFZlY3RvcjJEKGMueCwgYy55KTtcclxuXHJcbiAgICBjMCA9IG5ldyBWZWN0b3IyRChwMS54LCBwMS55KTtcclxuXHJcbiAgICAvLyBDb252ZXJ0IGxpbmUgdG8gbm9ybWFsIGZvcm06IGF4ICsgYnkgKyBjID0gMFxyXG4gICAgLy8gRmluZCBub3JtYWwgdG8gbGluZTogbmVnYXRpdmUgaW52ZXJzZSBvZiBvcmlnaW5hbCBsaW5lJ3Mgc2xvcGVcclxuICAgIG4gPSBuZXcgVmVjdG9yMkQoYTEueSAtIGEyLnksIGEyLnggLSBhMS54KTtcclxuXHJcbiAgICAvLyBEZXRlcm1pbmUgbmV3IGMgY29lZmZpY2llbnRcclxuICAgIGNsID0gYTEueCphMi55IC0gYTIueCphMS55O1xyXG5cclxuICAgIC8vID9Sb3RhdGUgZWFjaCBjdWJpYyBjb2VmZmljaWVudCB1c2luZyBsaW5lIGZvciBuZXcgY29vcmRpbmF0ZSBzeXN0ZW0/XHJcbiAgICAvLyBGaW5kIHJvb3RzIG9mIHJvdGF0ZWQgY3ViaWNcclxuICAgIHJvb3RzID0gbmV3IFBvbHlub21pYWwoXHJcbiAgICAgICAgbi5kb3QoYzMpLFxyXG4gICAgICAgIG4uZG90KGMyKSxcclxuICAgICAgICBuLmRvdChjMSksXHJcbiAgICAgICAgbi5kb3QoYzApICsgY2xcclxuICAgICkuZ2V0Um9vdHMoKTtcclxuXHJcbiAgICAvLyBBbnkgcm9vdHMgaW4gY2xvc2VkIGludGVydmFsIFswLDFdIGFyZSBpbnRlcnNlY3Rpb25zIG9uIEJlemllciwgYnV0XHJcbiAgICAvLyBtaWdodCBub3QgYmUgb24gdGhlIGxpbmUgc2VnbWVudC5cclxuICAgIC8vIEZpbmQgaW50ZXJzZWN0aW9ucyBhbmQgY2FsY3VsYXRlIHBvaW50IGNvb3JkaW5hdGVzXHJcbiAgICBmb3IgKCB2YXIgaSA9IDA7IGkgPCByb290cy5sZW5ndGg7IGkrKyApIHtcclxuICAgICAgICB2YXIgdCA9IHJvb3RzW2ldO1xyXG5cclxuICAgICAgICBpZiAoIDAgPD0gdCAmJiB0IDw9IDEgKSB7XHJcbiAgICAgICAgICAgIC8vIFdlJ3JlIHdpdGhpbiB0aGUgQmV6aWVyIGN1cnZlXHJcbiAgICAgICAgICAgIC8vIEZpbmQgcG9pbnQgb24gQmV6aWVyXHJcbiAgICAgICAgICAgIHZhciBwNSA9IHAxLmxlcnAocDIsIHQpO1xyXG4gICAgICAgICAgICB2YXIgcDYgPSBwMi5sZXJwKHAzLCB0KTtcclxuICAgICAgICAgICAgdmFyIHA3ID0gcDMubGVycChwNCwgdCk7XHJcblxyXG4gICAgICAgICAgICB2YXIgcDggPSBwNS5sZXJwKHA2LCB0KTtcclxuICAgICAgICAgICAgdmFyIHA5ID0gcDYubGVycChwNywgdCk7XHJcblxyXG4gICAgICAgICAgICB2YXIgcDEwID0gcDgubGVycChwOSwgdCk7XHJcblxyXG4gICAgICAgICAgICAvLyBTZWUgaWYgcG9pbnQgaXMgb24gbGluZSBzZWdtZW50XHJcbiAgICAgICAgICAgIC8vIEhhZCB0byBtYWtlIHNwZWNpYWwgY2FzZXMgZm9yIHZlcnRpY2FsIGFuZCBob3Jpem9udGFsIGxpbmVzIGR1ZVxyXG4gICAgICAgICAgICAvLyB0byBzbGlnaHQgZXJyb3JzIGluIGNhbGN1bGF0aW9uIG9mIHAxMFxyXG4gICAgICAgICAgICBpZiAoIGExLnggPT0gYTIueCApIHtcclxuICAgICAgICAgICAgICAgIGlmICggbWluLnkgPD0gcDEwLnkgJiYgcDEwLnkgPD0gbWF4LnkgKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgcmVzdWx0LnN0YXR1cyA9IFwiSW50ZXJzZWN0aW9uXCI7XHJcbiAgICAgICAgICAgICAgICAgICAgcmVzdWx0LmFwcGVuZFBvaW50KCBwMTAgKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSBlbHNlIGlmICggYTEueSA9PSBhMi55ICkge1xyXG4gICAgICAgICAgICAgICAgaWYgKCBtaW4ueCA8PSBwMTAueCAmJiBwMTAueCA8PSBtYXgueCApIHtcclxuICAgICAgICAgICAgICAgICAgICByZXN1bHQuc3RhdHVzID0gXCJJbnRlcnNlY3Rpb25cIjtcclxuICAgICAgICAgICAgICAgICAgICByZXN1bHQuYXBwZW5kUG9pbnQoIHAxMCApO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9IGVsc2UgaWYgKG1pbi54IDw9IHAxMC54ICYmIHAxMC54IDw9IG1heC54ICYmIG1pbi55IDw9IHAxMC55ICYmIHAxMC55IDw9IG1heC55KSB7XHJcbiAgICAgICAgICAgICAgICByZXN1bHQuc3RhdHVzID0gXCJJbnRlcnNlY3Rpb25cIjtcclxuICAgICAgICAgICAgICAgIHJlc3VsdC5hcHBlbmRQb2ludCggcDEwICk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIHJlc3VsdDtcclxufTtcclxuXHJcblxyXG4vKipcclxuICogIGludGVyc2VjdEJlemllcjNQb2x5Z29uXHJcbiAqXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IHAxXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IHAyXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IHAzXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IHA0XHJcbiAqICBAcGFyYW0ge0FycmF5PFBvaW50MkQ+fSBwb2ludHNcclxuICogIEByZXR1cm5zIHtJbnRlcnNlY3Rpb259XHJcbiAqL1xyXG5JbnRlcnNlY3Rpb24uaW50ZXJzZWN0QmV6aWVyM1BvbHlnb24gPSBmdW5jdGlvbihwMSwgcDIsIHAzLCBwNCwgcG9pbnRzKSB7XHJcbiAgICB2YXIgcmVzdWx0ID0gbmV3IEludGVyc2VjdGlvbihcIk5vIEludGVyc2VjdGlvblwiKTtcclxuICAgIHZhciBsZW5ndGggPSBwb2ludHMubGVuZ3RoO1xyXG5cclxuICAgIGZvciAoIHZhciBpID0gMDsgaSA8IGxlbmd0aDsgaSsrICkge1xyXG4gICAgICAgIHZhciBhMSA9IHBvaW50c1tpXTtcclxuICAgICAgICB2YXIgYTIgPSBwb2ludHNbKGkrMSkgJSBsZW5ndGhdO1xyXG4gICAgICAgIHZhciBpbnRlciA9IEludGVyc2VjdGlvbi5pbnRlcnNlY3RCZXppZXIzTGluZShwMSwgcDIsIHAzLCBwNCwgYTEsIGEyKTtcclxuXHJcbiAgICAgICAgcmVzdWx0LmFwcGVuZFBvaW50cyhpbnRlci5wb2ludHMpO1xyXG4gICAgfVxyXG5cclxuICAgIGlmICggcmVzdWx0LnBvaW50cy5sZW5ndGggPiAwICkgcmVzdWx0LnN0YXR1cyA9IFwiSW50ZXJzZWN0aW9uXCI7XHJcblxyXG4gICAgcmV0dXJuIHJlc3VsdDtcclxufTtcclxuXHJcblxyXG4vKipcclxuICogIGludGVyc2VjdEJlemllcjNSZWN0YW5nbGVcclxuICpcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gcDFcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gcDJcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gcDNcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gcDRcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gcjFcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gcjJcclxuICogIEByZXR1cm5zIHtJbnRlcnNlY3Rpb259XHJcbiAqL1xyXG5JbnRlcnNlY3Rpb24uaW50ZXJzZWN0QmV6aWVyM1JlY3RhbmdsZSA9IGZ1bmN0aW9uKHAxLCBwMiwgcDMsIHA0LCByMSwgcjIpIHtcclxuICAgIHZhciBtaW4gICAgICAgID0gcjEubWluKHIyKTtcclxuICAgIHZhciBtYXggICAgICAgID0gcjEubWF4KHIyKTtcclxuICAgIHZhciB0b3BSaWdodCAgID0gbmV3IFBvaW50MkQoIG1heC54LCBtaW4ueSApO1xyXG4gICAgdmFyIGJvdHRvbUxlZnQgPSBuZXcgUG9pbnQyRCggbWluLngsIG1heC55ICk7XHJcblxyXG4gICAgdmFyIGludGVyMSA9IEludGVyc2VjdGlvbi5pbnRlcnNlY3RCZXppZXIzTGluZShwMSwgcDIsIHAzLCBwNCwgbWluLCB0b3BSaWdodCk7XHJcbiAgICB2YXIgaW50ZXIyID0gSW50ZXJzZWN0aW9uLmludGVyc2VjdEJlemllcjNMaW5lKHAxLCBwMiwgcDMsIHA0LCB0b3BSaWdodCwgbWF4KTtcclxuICAgIHZhciBpbnRlcjMgPSBJbnRlcnNlY3Rpb24uaW50ZXJzZWN0QmV6aWVyM0xpbmUocDEsIHAyLCBwMywgcDQsIG1heCwgYm90dG9tTGVmdCk7XHJcbiAgICB2YXIgaW50ZXI0ID0gSW50ZXJzZWN0aW9uLmludGVyc2VjdEJlemllcjNMaW5lKHAxLCBwMiwgcDMsIHA0LCBib3R0b21MZWZ0LCBtaW4pO1xyXG5cclxuICAgIHZhciByZXN1bHQgPSBuZXcgSW50ZXJzZWN0aW9uKFwiTm8gSW50ZXJzZWN0aW9uXCIpO1xyXG5cclxuICAgIHJlc3VsdC5hcHBlbmRQb2ludHMoaW50ZXIxLnBvaW50cyk7XHJcbiAgICByZXN1bHQuYXBwZW5kUG9pbnRzKGludGVyMi5wb2ludHMpO1xyXG4gICAgcmVzdWx0LmFwcGVuZFBvaW50cyhpbnRlcjMucG9pbnRzKTtcclxuICAgIHJlc3VsdC5hcHBlbmRQb2ludHMoaW50ZXI0LnBvaW50cyk7XHJcblxyXG4gICAgaWYgKCByZXN1bHQucG9pbnRzLmxlbmd0aCA+IDAgKSByZXN1bHQuc3RhdHVzID0gXCJJbnRlcnNlY3Rpb25cIjtcclxuXHJcbiAgICByZXR1cm4gcmVzdWx0O1xyXG59O1xyXG5cclxuXHJcbi8qKlxyXG4gKiAgaW50ZXJzZWN0Q2lyY2xlQ2lyY2xlXHJcbiAqXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IGMxXHJcbiAqICBAcGFyYW0ge051bWJlcn0gcjFcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gYzJcclxuICogIEBwYXJhbSB7TnVtYmVyfSByMlxyXG4gKiAgQHJldHVybnMge0ludGVyc2VjdGlvbn1cclxuICovXHJcbkludGVyc2VjdGlvbi5pbnRlcnNlY3RDaXJjbGVDaXJjbGUgPSBmdW5jdGlvbihjMSwgcjEsIGMyLCByMikge1xyXG4gICAgdmFyIHJlc3VsdDtcclxuXHJcbiAgICAvLyBEZXRlcm1pbmUgbWluaW11bSBhbmQgbWF4aW11bSByYWRpaSB3aGVyZSBjaXJjbGVzIGNhbiBpbnRlcnNlY3RcclxuICAgIHZhciByX21heCA9IHIxICsgcjI7XHJcbiAgICB2YXIgcl9taW4gPSBNYXRoLmFicyhyMSAtIHIyKTtcclxuXHJcbiAgICAvLyBEZXRlcm1pbmUgYWN0dWFsIGRpc3RhbmNlIGJldHdlZW4gY2lyY2xlIGNpcmNsZXNcclxuICAgIHZhciBjX2Rpc3QgPSBjMS5kaXN0YW5jZUZyb20oIGMyICk7XHJcblxyXG4gICAgaWYgKCBjX2Rpc3QgPiByX21heCApIHtcclxuICAgICAgICByZXN1bHQgPSBuZXcgSW50ZXJzZWN0aW9uKFwiT3V0c2lkZVwiKTtcclxuICAgIH0gZWxzZSBpZiAoIGNfZGlzdCA8IHJfbWluICkge1xyXG4gICAgICAgIHJlc3VsdCA9IG5ldyBJbnRlcnNlY3Rpb24oXCJJbnNpZGVcIik7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICAgIHJlc3VsdCA9IG5ldyBJbnRlcnNlY3Rpb24oXCJJbnRlcnNlY3Rpb25cIik7XHJcblxyXG4gICAgICAgIHZhciBhID0gKHIxKnIxIC0gcjIqcjIgKyBjX2Rpc3QqY19kaXN0KSAvICggMipjX2Rpc3QgKTtcclxuICAgICAgICB2YXIgaCA9IE1hdGguc3FydChyMSpyMSAtIGEqYSk7XHJcbiAgICAgICAgdmFyIHAgPSBjMS5sZXJwKGMyLCBhL2NfZGlzdCk7XHJcbiAgICAgICAgdmFyIGIgPSBoIC8gY19kaXN0O1xyXG5cclxuICAgICAgICByZXN1bHQucG9pbnRzLnB1c2goXHJcbiAgICAgICAgICAgIG5ldyBQb2ludDJEKFxyXG4gICAgICAgICAgICAgICAgcC54IC0gYiAqIChjMi55IC0gYzEueSksXHJcbiAgICAgICAgICAgICAgICBwLnkgKyBiICogKGMyLnggLSBjMS54KVxyXG4gICAgICAgICAgICApXHJcbiAgICAgICAgKTtcclxuICAgICAgICByZXN1bHQucG9pbnRzLnB1c2goXHJcbiAgICAgICAgICAgIG5ldyBQb2ludDJEKFxyXG4gICAgICAgICAgICAgICAgcC54ICsgYiAqIChjMi55IC0gYzEueSksXHJcbiAgICAgICAgICAgICAgICBwLnkgLSBiICogKGMyLnggLSBjMS54KVxyXG4gICAgICAgICAgICApXHJcbiAgICAgICAgKTtcclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gcmVzdWx0O1xyXG59O1xyXG5cclxuXHJcbi8qKlxyXG4gKiAgaW50ZXJzZWN0Q2lyY2xlRWxsaXBzZVxyXG4gKlxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBjY1xyXG4gKiAgQHBhcmFtIHtOdW1iZXJ9IHJcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gZWNcclxuICogIEBwYXJhbSB7TnVtYmVyfSByeFxyXG4gKiAgQHBhcmFtIHtOdW1iZXJ9IHJ5XHJcbiAqICBAcmV0dXJucyB7SW50ZXJzZWN0aW9ufVxyXG4gKi9cclxuSW50ZXJzZWN0aW9uLmludGVyc2VjdENpcmNsZUVsbGlwc2UgPSBmdW5jdGlvbihjYywgciwgZWMsIHJ4LCByeSkge1xyXG4gICAgcmV0dXJuIEludGVyc2VjdGlvbi5pbnRlcnNlY3RFbGxpcHNlRWxsaXBzZShjYywgciwgciwgZWMsIHJ4LCByeSk7XHJcbn07XHJcblxyXG5cclxuLyoqXHJcbiAqICBpbnRlcnNlY3RDaXJjbGVMaW5lXHJcbiAqXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IGNcclxuICogIEBwYXJhbSB7TnVtYmVyfSByXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IGExXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IGEyXHJcbiAqICBAcmV0dXJucyB7SW50ZXJzZWN0aW9ufVxyXG4gKi9cclxuSW50ZXJzZWN0aW9uLmludGVyc2VjdENpcmNsZUxpbmUgPSBmdW5jdGlvbihjLCByLCBhMSwgYTIpIHtcclxuICAgIHZhciByZXN1bHQ7XHJcbiAgICB2YXIgYSAgPSAoYTIueCAtIGExLngpICogKGEyLnggLSBhMS54KSArXHJcbiAgICAgICAgICAgICAoYTIueSAtIGExLnkpICogKGEyLnkgLSBhMS55KTtcclxuICAgIHZhciBiICA9IDIgKiAoIChhMi54IC0gYTEueCkgKiAoYTEueCAtIGMueCkgK1xyXG4gICAgICAgICAgICAgICAgICAgKGEyLnkgLSBhMS55KSAqIChhMS55IC0gYy55KSAgICk7XHJcbiAgICB2YXIgY2MgPSBjLngqYy54ICsgYy55KmMueSArIGExLngqYTEueCArIGExLnkqYTEueSAtXHJcbiAgICAgICAgICAgICAyICogKGMueCAqIGExLnggKyBjLnkgKiBhMS55KSAtIHIqcjtcclxuICAgIHZhciBkZXRlciA9IGIqYiAtIDQqYSpjYztcclxuXHJcbiAgICBpZiAoIGRldGVyIDwgMCApIHtcclxuICAgICAgICByZXN1bHQgPSBuZXcgSW50ZXJzZWN0aW9uKFwiT3V0c2lkZVwiKTtcclxuICAgIH0gZWxzZSBpZiAoIGRldGVyID09IDAgKSB7XHJcbiAgICAgICAgcmVzdWx0ID0gbmV3IEludGVyc2VjdGlvbihcIlRhbmdlbnRcIik7XHJcbiAgICAgICAgLy8gTk9URTogc2hvdWxkIGNhbGN1bGF0ZSB0aGlzIHBvaW50XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICAgIHZhciBlICA9IE1hdGguc3FydChkZXRlcik7XHJcbiAgICAgICAgdmFyIHUxID0gKCAtYiArIGUgKSAvICggMiphICk7XHJcbiAgICAgICAgdmFyIHUyID0gKCAtYiAtIGUgKSAvICggMiphICk7XHJcblxyXG4gICAgICAgIGlmICggKHUxIDwgMCB8fCB1MSA+IDEpICYmICh1MiA8IDAgfHwgdTIgPiAxKSApIHtcclxuICAgICAgICAgICAgaWYgKCAodTEgPCAwICYmIHUyIDwgMCkgfHwgKHUxID4gMSAmJiB1MiA+IDEpICkge1xyXG4gICAgICAgICAgICAgICAgcmVzdWx0ID0gbmV3IEludGVyc2VjdGlvbihcIk91dHNpZGVcIik7XHJcbiAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICByZXN1bHQgPSBuZXcgSW50ZXJzZWN0aW9uKFwiSW5zaWRlXCIpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgcmVzdWx0ID0gbmV3IEludGVyc2VjdGlvbihcIkludGVyc2VjdGlvblwiKTtcclxuXHJcbiAgICAgICAgICAgIGlmICggMCA8PSB1MSAmJiB1MSA8PSAxKVxyXG4gICAgICAgICAgICAgICAgcmVzdWx0LnBvaW50cy5wdXNoKCBhMS5sZXJwKGEyLCB1MSkgKTtcclxuXHJcbiAgICAgICAgICAgIGlmICggMCA8PSB1MiAmJiB1MiA8PSAxKVxyXG4gICAgICAgICAgICAgICAgcmVzdWx0LnBvaW50cy5wdXNoKCBhMS5sZXJwKGEyLCB1MikgKTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIHJlc3VsdDtcclxufTtcclxuXHJcblxyXG4vKipcclxuICogIGludGVyc2VjdENpcmNsZVBvbHlnb25cclxuICpcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gY1xyXG4gKiAgQHBhcmFtIHtOdW1iZXJ9IHJcclxuICogIEBwYXJhbSB7QXJyYXk8UG9pbnQyRD59IHBvaW50c1xyXG4gKiAgQHJldHVybnMge0ludGVyc2VjdGlvbn1cclxuICovXHJcbkludGVyc2VjdGlvbi5pbnRlcnNlY3RDaXJjbGVQb2x5Z29uID0gZnVuY3Rpb24oYywgciwgcG9pbnRzKSB7XHJcbiAgICB2YXIgcmVzdWx0ID0gbmV3IEludGVyc2VjdGlvbihcIk5vIEludGVyc2VjdGlvblwiKTtcclxuICAgIHZhciBsZW5ndGggPSBwb2ludHMubGVuZ3RoO1xyXG4gICAgdmFyIGludGVyO1xyXG5cclxuICAgIGZvciAoIHZhciBpID0gMDsgaSA8IGxlbmd0aDsgaSsrICkge1xyXG4gICAgICAgIHZhciBhMSA9IHBvaW50c1tpXTtcclxuICAgICAgICB2YXIgYTIgPSBwb2ludHNbKGkrMSkgJSBsZW5ndGhdO1xyXG5cclxuICAgICAgICBpbnRlciA9IEludGVyc2VjdGlvbi5pbnRlcnNlY3RDaXJjbGVMaW5lKGMsIHIsIGExLCBhMik7XHJcbiAgICAgICAgcmVzdWx0LmFwcGVuZFBvaW50cyhpbnRlci5wb2ludHMpO1xyXG4gICAgfVxyXG5cclxuICAgIGlmICggcmVzdWx0LnBvaW50cy5sZW5ndGggPiAwIClcclxuICAgICAgICByZXN1bHQuc3RhdHVzID0gXCJJbnRlcnNlY3Rpb25cIjtcclxuICAgIGVsc2VcclxuICAgICAgICByZXN1bHQuc3RhdHVzID0gaW50ZXIuc3RhdHVzO1xyXG5cclxuICAgIHJldHVybiByZXN1bHQ7XHJcbn07XHJcblxyXG5cclxuLyoqXHJcbiAqICBpbnRlcnNlY3RDaXJjbGVSZWN0YW5nbGVcclxuICpcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gY1xyXG4gKiAgQHBhcmFtIHtOdW1iZXJ9IHJcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gcjFcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gcjJcclxuICogIEByZXR1cm5zIHtJbnRlcnNlY3Rpb259XHJcbiAqL1xyXG5JbnRlcnNlY3Rpb24uaW50ZXJzZWN0Q2lyY2xlUmVjdGFuZ2xlID0gZnVuY3Rpb24oYywgciwgcjEsIHIyKSB7XHJcbiAgICB2YXIgbWluICAgICAgICA9IHIxLm1pbihyMik7XHJcbiAgICB2YXIgbWF4ICAgICAgICA9IHIxLm1heChyMik7XHJcbiAgICB2YXIgdG9wUmlnaHQgICA9IG5ldyBQb2ludDJEKCBtYXgueCwgbWluLnkgKTtcclxuICAgIHZhciBib3R0b21MZWZ0ID0gbmV3IFBvaW50MkQoIG1pbi54LCBtYXgueSApO1xyXG5cclxuICAgIHZhciBpbnRlcjEgPSBJbnRlcnNlY3Rpb24uaW50ZXJzZWN0Q2lyY2xlTGluZShjLCByLCBtaW4sIHRvcFJpZ2h0KTtcclxuICAgIHZhciBpbnRlcjIgPSBJbnRlcnNlY3Rpb24uaW50ZXJzZWN0Q2lyY2xlTGluZShjLCByLCB0b3BSaWdodCwgbWF4KTtcclxuICAgIHZhciBpbnRlcjMgPSBJbnRlcnNlY3Rpb24uaW50ZXJzZWN0Q2lyY2xlTGluZShjLCByLCBtYXgsIGJvdHRvbUxlZnQpO1xyXG4gICAgdmFyIGludGVyNCA9IEludGVyc2VjdGlvbi5pbnRlcnNlY3RDaXJjbGVMaW5lKGMsIHIsIGJvdHRvbUxlZnQsIG1pbik7XHJcblxyXG4gICAgdmFyIHJlc3VsdCA9IG5ldyBJbnRlcnNlY3Rpb24oXCJObyBJbnRlcnNlY3Rpb25cIik7XHJcblxyXG4gICAgcmVzdWx0LmFwcGVuZFBvaW50cyhpbnRlcjEucG9pbnRzKTtcclxuICAgIHJlc3VsdC5hcHBlbmRQb2ludHMoaW50ZXIyLnBvaW50cyk7XHJcbiAgICByZXN1bHQuYXBwZW5kUG9pbnRzKGludGVyMy5wb2ludHMpO1xyXG4gICAgcmVzdWx0LmFwcGVuZFBvaW50cyhpbnRlcjQucG9pbnRzKTtcclxuXHJcbiAgICBpZiAoIHJlc3VsdC5wb2ludHMubGVuZ3RoID4gMCApXHJcbiAgICAgICAgcmVzdWx0LnN0YXR1cyA9IFwiSW50ZXJzZWN0aW9uXCI7XHJcbiAgICBlbHNlXHJcbiAgICAgICAgcmVzdWx0LnN0YXR1cyA9IGludGVyMS5zdGF0dXM7XHJcblxyXG4gICAgcmV0dXJuIHJlc3VsdDtcclxufTtcclxuXHJcblxyXG4vKipcclxuICogIGludGVyc2VjdEVsbGlwc2VFbGxpcHNlXHJcbiAqXHJcbiAqICBUaGlzIGNvZGUgaXMgYmFzZWQgb24gTWdjSW50cjJERWxwRWxwLmNwcCB3cml0dGVuIGJ5IERhdmlkIEViZXJseS4gIEhpc1xyXG4gKiAgY29kZSBhbG9uZyB3aXRoIG1hbnkgb3RoZXIgZXhjZWxsZW50IGV4YW1wbGVzIGFyZSBhdmFpYWJsZSBhdCBoaXMgc2l0ZTpcclxuICogIGh0dHA6Ly93d3cubWFnaWMtc29mdHdhcmUuY29tXHJcbiAqXHJcbiAqICBOT1RFOiBSb3RhdGlvbiB3aWxsIG5lZWQgdG8gYmUgYWRkZWQgdG8gdGhpcyBmdW5jdGlvblxyXG4gKlxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBjMVxyXG4gKiAgQHBhcmFtIHtOdW1iZXJ9IHJ4MVxyXG4gKiAgQHBhcmFtIHtOdW1iZXJ9IHJ5MVxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBjMlxyXG4gKiAgQHBhcmFtIHtOdW1iZXJ9IHJ4MlxyXG4gKiAgQHBhcmFtIHtOdW1iZXJ9IHJ5MlxyXG4gKiAgQHJldHVybnMge0ludGVyc2VjdGlvbn1cclxuICovXHJcbkludGVyc2VjdGlvbi5pbnRlcnNlY3RFbGxpcHNlRWxsaXBzZSA9IGZ1bmN0aW9uKGMxLCByeDEsIHJ5MSwgYzIsIHJ4MiwgcnkyKSB7XHJcbiAgICB2YXIgYSA9IFtcclxuICAgICAgICByeTEqcnkxLCAwLCByeDEqcngxLCAtMipyeTEqcnkxKmMxLngsIC0yKnJ4MSpyeDEqYzEueSxcclxuICAgICAgICByeTEqcnkxKmMxLngqYzEueCArIHJ4MSpyeDEqYzEueSpjMS55IC0gcngxKnJ4MSpyeTEqcnkxXHJcbiAgICBdO1xyXG4gICAgdmFyIGIgPSBbXHJcbiAgICAgICAgcnkyKnJ5MiwgMCwgcngyKnJ4MiwgLTIqcnkyKnJ5MipjMi54LCAtMipyeDIqcngyKmMyLnksXHJcbiAgICAgICAgcnkyKnJ5MipjMi54KmMyLnggKyByeDIqcngyKmMyLnkqYzIueSAtIHJ4MipyeDIqcnkyKnJ5MlxyXG4gICAgXTtcclxuXHJcbiAgICB2YXIgeVBvbHkgICA9IEludGVyc2VjdGlvbi5iZXpvdXQoYSwgYik7XHJcbiAgICB2YXIgeVJvb3RzICA9IHlQb2x5LmdldFJvb3RzKCk7XHJcbiAgICB2YXIgZXBzaWxvbiA9IDFlLTM7XHJcbiAgICB2YXIgbm9ybTAgICA9ICggYVswXSphWzBdICsgMiphWzFdKmFbMV0gKyBhWzJdKmFbMl0gKSAqIGVwc2lsb247XHJcbiAgICB2YXIgbm9ybTEgICA9ICggYlswXSpiWzBdICsgMipiWzFdKmJbMV0gKyBiWzJdKmJbMl0gKSAqIGVwc2lsb247XHJcbiAgICB2YXIgcmVzdWx0ICA9IG5ldyBJbnRlcnNlY3Rpb24oXCJObyBJbnRlcnNlY3Rpb25cIik7XHJcblxyXG4gICAgZm9yICggdmFyIHkgPSAwOyB5IDwgeVJvb3RzLmxlbmd0aDsgeSsrICkge1xyXG4gICAgICAgIHZhciB4UG9seSA9IG5ldyBQb2x5bm9taWFsKFxyXG4gICAgICAgICAgICBhWzBdLFxyXG4gICAgICAgICAgICBhWzNdICsgeVJvb3RzW3ldICogYVsxXSxcclxuICAgICAgICAgICAgYVs1XSArIHlSb290c1t5XSAqIChhWzRdICsgeVJvb3RzW3ldKmFbMl0pXHJcbiAgICAgICAgKTtcclxuICAgICAgICB2YXIgeFJvb3RzID0geFBvbHkuZ2V0Um9vdHMoKTtcclxuXHJcbiAgICAgICAgZm9yICggdmFyIHggPSAwOyB4IDwgeFJvb3RzLmxlbmd0aDsgeCsrICkge1xyXG4gICAgICAgICAgICB2YXIgdGVzdCA9XHJcbiAgICAgICAgICAgICAgICAoIGFbMF0qeFJvb3RzW3hdICsgYVsxXSp5Um9vdHNbeV0gKyBhWzNdICkgKiB4Um9vdHNbeF0gK1xyXG4gICAgICAgICAgICAgICAgKCBhWzJdKnlSb290c1t5XSArIGFbNF0gKSAqIHlSb290c1t5XSArIGFbNV07XHJcbiAgICAgICAgICAgIGlmICggTWF0aC5hYnModGVzdCkgPCBub3JtMCApIHtcclxuICAgICAgICAgICAgICAgIHRlc3QgPVxyXG4gICAgICAgICAgICAgICAgICAgICggYlswXSp4Um9vdHNbeF0gKyBiWzFdKnlSb290c1t5XSArIGJbM10gKSAqIHhSb290c1t4XSArXHJcbiAgICAgICAgICAgICAgICAgICAgKCBiWzJdKnlSb290c1t5XSArIGJbNF0gKSAqIHlSb290c1t5XSArIGJbNV07XHJcbiAgICAgICAgICAgICAgICBpZiAoIE1hdGguYWJzKHRlc3QpIDwgbm9ybTEgKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgcmVzdWx0LmFwcGVuZFBvaW50KCBuZXcgUG9pbnQyRCggeFJvb3RzW3hdLCB5Um9vdHNbeV0gKSApO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIGlmICggcmVzdWx0LnBvaW50cy5sZW5ndGggPiAwICkgcmVzdWx0LnN0YXR1cyA9IFwiSW50ZXJzZWN0aW9uXCI7XHJcblxyXG4gICAgcmV0dXJuIHJlc3VsdDtcclxufTtcclxuXHJcblxyXG4vKipcclxuICogIGludGVyc2VjdEVsbGlwc2VMaW5lXHJcbiAqXHJcbiAqICBOT1RFOiBSb3RhdGlvbiB3aWxsIG5lZWQgdG8gYmUgYWRkZWQgdG8gdGhpcyBmdW5jdGlvblxyXG4gKlxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBjXHJcbiAqICBAcGFyYW0ge051bWJlcn0gcnhcclxuICogIEBwYXJhbSB7TnVtYmVyfSByeVxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBhMVxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBhMlxyXG4gKiAgQHJldHVybnMge0ludGVyc2VjdGlvbn1cclxuICovXHJcbkludGVyc2VjdGlvbi5pbnRlcnNlY3RFbGxpcHNlTGluZSA9IGZ1bmN0aW9uKGMsIHJ4LCByeSwgYTEsIGEyKSB7XHJcbiAgICB2YXIgcmVzdWx0O1xyXG4gICAgdmFyIG9yaWdpbiA9IG5ldyBWZWN0b3IyRChhMS54LCBhMS55KTtcclxuICAgIHZhciBkaXIgICAgPSBWZWN0b3IyRC5mcm9tUG9pbnRzKGExLCBhMik7XHJcbiAgICB2YXIgY2VudGVyID0gbmV3IFZlY3RvcjJEKGMueCwgYy55KTtcclxuICAgIHZhciBkaWZmICAgPSBvcmlnaW4uc3VidHJhY3QoY2VudGVyKTtcclxuICAgIHZhciBtRGlyICAgPSBuZXcgVmVjdG9yMkQoIGRpci54LyhyeCpyeCksICBkaXIueS8ocnkqcnkpICApO1xyXG4gICAgdmFyIG1EaWZmICA9IG5ldyBWZWN0b3IyRCggZGlmZi54LyhyeCpyeCksIGRpZmYueS8ocnkqcnkpICk7XHJcblxyXG4gICAgdmFyIGEgPSBkaXIuZG90KG1EaXIpO1xyXG4gICAgdmFyIGIgPSBkaXIuZG90KG1EaWZmKTtcclxuICAgIHZhciBjID0gZGlmZi5kb3QobURpZmYpIC0gMS4wO1xyXG4gICAgdmFyIGQgPSBiKmIgLSBhKmM7XHJcblxyXG4gICAgaWYgKCBkIDwgMCApIHtcclxuICAgICAgICByZXN1bHQgPSBuZXcgSW50ZXJzZWN0aW9uKFwiT3V0c2lkZVwiKTtcclxuICAgIH0gZWxzZSBpZiAoIGQgPiAwICkge1xyXG4gICAgICAgIHZhciByb290ID0gTWF0aC5zcXJ0KGQpO1xyXG4gICAgICAgIHZhciB0X2EgID0gKC1iIC0gcm9vdCkgLyBhO1xyXG4gICAgICAgIHZhciB0X2IgID0gKC1iICsgcm9vdCkgLyBhO1xyXG5cclxuICAgICAgICBpZiAoICh0X2EgPCAwIHx8IDEgPCB0X2EpICYmICh0X2IgPCAwIHx8IDEgPCB0X2IpICkge1xyXG4gICAgICAgICAgICBpZiAoICh0X2EgPCAwICYmIHRfYiA8IDApIHx8ICh0X2EgPiAxICYmIHRfYiA+IDEpIClcclxuICAgICAgICAgICAgICAgIHJlc3VsdCA9IG5ldyBJbnRlcnNlY3Rpb24oXCJPdXRzaWRlXCIpO1xyXG4gICAgICAgICAgICBlbHNlXHJcbiAgICAgICAgICAgICAgICByZXN1bHQgPSBuZXcgSW50ZXJzZWN0aW9uKFwiSW5zaWRlXCIpO1xyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgIHJlc3VsdCA9IG5ldyBJbnRlcnNlY3Rpb24oXCJJbnRlcnNlY3Rpb25cIik7XHJcbiAgICAgICAgICAgIGlmICggMCA8PSB0X2EgJiYgdF9hIDw9IDEgKVxyXG4gICAgICAgICAgICAgICAgcmVzdWx0LmFwcGVuZFBvaW50KCBhMS5sZXJwKGEyLCB0X2EpICk7XHJcbiAgICAgICAgICAgIGlmICggMCA8PSB0X2IgJiYgdF9iIDw9IDEgKVxyXG4gICAgICAgICAgICAgICAgcmVzdWx0LmFwcGVuZFBvaW50KCBhMS5sZXJwKGEyLCB0X2IpICk7XHJcbiAgICAgICAgfVxyXG4gICAgfSBlbHNlIHtcclxuICAgICAgICB2YXIgdCA9IC1iL2E7XHJcbiAgICAgICAgaWYgKCAwIDw9IHQgJiYgdCA8PSAxICkge1xyXG4gICAgICAgICAgICByZXN1bHQgPSBuZXcgSW50ZXJzZWN0aW9uKFwiSW50ZXJzZWN0aW9uXCIpO1xyXG4gICAgICAgICAgICByZXN1bHQuYXBwZW5kUG9pbnQoIGExLmxlcnAoYTIsIHQpICk7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgcmVzdWx0ID0gbmV3IEludGVyc2VjdGlvbihcIk91dHNpZGVcIik7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiByZXN1bHQ7XHJcbn07XHJcblxyXG5cclxuLyoqXHJcbiAqICBpbnRlcnNlY3RFbGxpcHNlUG9seWdvblxyXG4gKlxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBjXHJcbiAqICBAcGFyYW0ge051bWJlcn0gcnhcclxuICogIEBwYXJhbSB7TnVtYmVyfSByeVxyXG4gKiAgQHBhcmFtIHtBcnJheTxQb2ludDJEPn0gYzJcclxuICogIEByZXR1cm5zIHtJbnRlcnNlY3Rpb259XHJcbiAqL1xyXG5JbnRlcnNlY3Rpb24uaW50ZXJzZWN0RWxsaXBzZVBvbHlnb24gPSBmdW5jdGlvbihjLCByeCwgcnksIHBvaW50cykge1xyXG4gICAgdmFyIHJlc3VsdCA9IG5ldyBJbnRlcnNlY3Rpb24oXCJObyBJbnRlcnNlY3Rpb25cIik7XHJcbiAgICB2YXIgbGVuZ3RoID0gcG9pbnRzLmxlbmd0aDtcclxuXHJcbiAgICBmb3IgKCB2YXIgaSA9IDA7IGkgPCBsZW5ndGg7IGkrKyApIHtcclxuICAgICAgICB2YXIgYjEgPSBwb2ludHNbaV07XHJcbiAgICAgICAgdmFyIGIyID0gcG9pbnRzWyhpKzEpICUgbGVuZ3RoXTtcclxuICAgICAgICB2YXIgaW50ZXIgPSBJbnRlcnNlY3Rpb24uaW50ZXJzZWN0RWxsaXBzZUxpbmUoYywgcngsIHJ5LCBiMSwgYjIpO1xyXG5cclxuICAgICAgICByZXN1bHQuYXBwZW5kUG9pbnRzKGludGVyLnBvaW50cyk7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKCByZXN1bHQucG9pbnRzLmxlbmd0aCA+IDAgKVxyXG4gICAgICAgIHJlc3VsdC5zdGF0dXMgPSBcIkludGVyc2VjdGlvblwiO1xyXG5cclxuICAgIHJldHVybiByZXN1bHQ7XHJcbn07XHJcblxyXG5cclxuLyoqXHJcbiAqICBpbnRlcnNlY3RFbGxpcHNlUmVjdGFuZ2xlXHJcbiAqXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IGNcclxuICogIEBwYXJhbSB7TnVtYmVyfSByeFxyXG4gKiAgQHBhcmFtIHtOdW1iZXJ9IHJ5XHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IHIxXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IHIyXHJcbiAqICBAcmV0dXJucyB7SW50ZXJzZWN0aW9ufVxyXG4gKi9cclxuSW50ZXJzZWN0aW9uLmludGVyc2VjdEVsbGlwc2VSZWN0YW5nbGUgPSBmdW5jdGlvbihjLCByeCwgcnksIHIxLCByMikge1xyXG4gICAgdmFyIG1pbiAgICAgICAgPSByMS5taW4ocjIpO1xyXG4gICAgdmFyIG1heCAgICAgICAgPSByMS5tYXgocjIpO1xyXG4gICAgdmFyIHRvcFJpZ2h0ICAgPSBuZXcgUG9pbnQyRCggbWF4LngsIG1pbi55ICk7XHJcbiAgICB2YXIgYm90dG9tTGVmdCA9IG5ldyBQb2ludDJEKCBtaW4ueCwgbWF4LnkgKTtcclxuXHJcbiAgICB2YXIgaW50ZXIxID0gSW50ZXJzZWN0aW9uLmludGVyc2VjdEVsbGlwc2VMaW5lKGMsIHJ4LCByeSwgbWluLCB0b3BSaWdodCk7XHJcbiAgICB2YXIgaW50ZXIyID0gSW50ZXJzZWN0aW9uLmludGVyc2VjdEVsbGlwc2VMaW5lKGMsIHJ4LCByeSwgdG9wUmlnaHQsIG1heCk7XHJcbiAgICB2YXIgaW50ZXIzID0gSW50ZXJzZWN0aW9uLmludGVyc2VjdEVsbGlwc2VMaW5lKGMsIHJ4LCByeSwgbWF4LCBib3R0b21MZWZ0KTtcclxuICAgIHZhciBpbnRlcjQgPSBJbnRlcnNlY3Rpb24uaW50ZXJzZWN0RWxsaXBzZUxpbmUoYywgcngsIHJ5LCBib3R0b21MZWZ0LCBtaW4pO1xyXG5cclxuICAgIHZhciByZXN1bHQgPSBuZXcgSW50ZXJzZWN0aW9uKFwiTm8gSW50ZXJzZWN0aW9uXCIpO1xyXG5cclxuICAgIHJlc3VsdC5hcHBlbmRQb2ludHMoaW50ZXIxLnBvaW50cyk7XHJcbiAgICByZXN1bHQuYXBwZW5kUG9pbnRzKGludGVyMi5wb2ludHMpO1xyXG4gICAgcmVzdWx0LmFwcGVuZFBvaW50cyhpbnRlcjMucG9pbnRzKTtcclxuICAgIHJlc3VsdC5hcHBlbmRQb2ludHMoaW50ZXI0LnBvaW50cyk7XHJcblxyXG4gICAgaWYgKCByZXN1bHQucG9pbnRzLmxlbmd0aCA+IDAgKVxyXG4gICAgICAgIHJlc3VsdC5zdGF0dXMgPSBcIkludGVyc2VjdGlvblwiO1xyXG5cclxuICAgIHJldHVybiByZXN1bHQ7XHJcbn07XHJcblxyXG5cclxuLyoqXHJcbiAqICBpbnRlcnNlY3RMaW5lTGluZVxyXG4gKlxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBhMVxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBhMlxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBiMVxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBiMlxyXG4gKiAgQHJldHVybnMge0ludGVyc2VjdGlvbn1cclxuICovXHJcbkludGVyc2VjdGlvbi5pbnRlcnNlY3RMaW5lTGluZSA9IGZ1bmN0aW9uKGExLCBhMiwgYjEsIGIyKSB7XHJcbiAgICB2YXIgcmVzdWx0O1xyXG5cclxuICAgIHZhciB1YV90ID0gKGIyLnggLSBiMS54KSAqIChhMS55IC0gYjEueSkgLSAoYjIueSAtIGIxLnkpICogKGExLnggLSBiMS54KTtcclxuICAgIHZhciB1Yl90ID0gKGEyLnggLSBhMS54KSAqIChhMS55IC0gYjEueSkgLSAoYTIueSAtIGExLnkpICogKGExLnggLSBiMS54KTtcclxuICAgIHZhciB1X2IgID0gKGIyLnkgLSBiMS55KSAqIChhMi54IC0gYTEueCkgLSAoYjIueCAtIGIxLngpICogKGEyLnkgLSBhMS55KTtcclxuXHJcbiAgICBpZiAoIHVfYiAhPSAwICkge1xyXG4gICAgICAgIHZhciB1YSA9IHVhX3QgLyB1X2I7XHJcbiAgICAgICAgdmFyIHViID0gdWJfdCAvIHVfYjtcclxuXHJcbiAgICAgICAgaWYgKCAwIDw9IHVhICYmIHVhIDw9IDEgJiYgMCA8PSB1YiAmJiB1YiA8PSAxICkge1xyXG4gICAgICAgICAgICByZXN1bHQgPSBuZXcgSW50ZXJzZWN0aW9uKFwiSW50ZXJzZWN0aW9uXCIpO1xyXG4gICAgICAgICAgICByZXN1bHQucG9pbnRzLnB1c2goXHJcbiAgICAgICAgICAgICAgICBuZXcgUG9pbnQyRChcclxuICAgICAgICAgICAgICAgICAgICBhMS54ICsgdWEgKiAoYTIueCAtIGExLngpLFxyXG4gICAgICAgICAgICAgICAgICAgIGExLnkgKyB1YSAqIChhMi55IC0gYTEueSlcclxuICAgICAgICAgICAgICAgIClcclxuICAgICAgICAgICAgKTtcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICByZXN1bHQgPSBuZXcgSW50ZXJzZWN0aW9uKFwiTm8gSW50ZXJzZWN0aW9uXCIpO1xyXG4gICAgICAgIH1cclxuICAgIH0gZWxzZSB7XHJcbiAgICAgICAgaWYgKCB1YV90ID09IDAgfHwgdWJfdCA9PSAwICkge1xyXG4gICAgICAgICAgICByZXN1bHQgPSBuZXcgSW50ZXJzZWN0aW9uKFwiQ29pbmNpZGVudFwiKTtcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICByZXN1bHQgPSBuZXcgSW50ZXJzZWN0aW9uKFwiUGFyYWxsZWxcIik7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiByZXN1bHQ7XHJcbn07XHJcblxyXG5cclxuLyoqXHJcbiAqICBpbnRlcnNlY3RMaW5lUG9seWdvblxyXG4gKlxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBhMVxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBhMlxyXG4gKiAgQHBhcmFtIHtBcnJheTxQb2ludDJEPn0gcG9pbnRzXHJcbiAqICBAcmV0dXJucyB7SW50ZXJzZWN0aW9ufVxyXG4gKi9cclxuSW50ZXJzZWN0aW9uLmludGVyc2VjdExpbmVQb2x5Z29uID0gZnVuY3Rpb24oYTEsIGEyLCBwb2ludHMpIHtcclxuICAgIHZhciByZXN1bHQgPSBuZXcgSW50ZXJzZWN0aW9uKFwiTm8gSW50ZXJzZWN0aW9uXCIpO1xyXG4gICAgdmFyIGxlbmd0aCA9IHBvaW50cy5sZW5ndGg7XHJcblxyXG4gICAgZm9yICggdmFyIGkgPSAwOyBpIDwgbGVuZ3RoOyBpKysgKSB7XHJcbiAgICAgICAgdmFyIGIxID0gcG9pbnRzW2ldO1xyXG4gICAgICAgIHZhciBiMiA9IHBvaW50c1soaSsxKSAlIGxlbmd0aF07XHJcbiAgICAgICAgdmFyIGludGVyID0gSW50ZXJzZWN0aW9uLmludGVyc2VjdExpbmVMaW5lKGExLCBhMiwgYjEsIGIyKTtcclxuXHJcbiAgICAgICAgcmVzdWx0LmFwcGVuZFBvaW50cyhpbnRlci5wb2ludHMpO1xyXG4gICAgfVxyXG5cclxuICAgIGlmICggcmVzdWx0LnBvaW50cy5sZW5ndGggPiAwICkgcmVzdWx0LnN0YXR1cyA9IFwiSW50ZXJzZWN0aW9uXCI7XHJcblxyXG4gICAgcmV0dXJuIHJlc3VsdDtcclxufTtcclxuXHJcblxyXG4vKipcclxuICogIGludGVyc2VjdExpbmVSZWN0YW5nbGVcclxuICpcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gYTFcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gYTJcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gcjFcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gcjJcclxuICogIEByZXR1cm5zIHtJbnRlcnNlY3Rpb259XHJcbiAqL1xyXG5JbnRlcnNlY3Rpb24uaW50ZXJzZWN0TGluZVJlY3RhbmdsZSA9IGZ1bmN0aW9uKGExLCBhMiwgcjEsIHIyKSB7XHJcbiAgICB2YXIgbWluICAgICAgICA9IHIxLm1pbihyMik7XHJcbiAgICB2YXIgbWF4ICAgICAgICA9IHIxLm1heChyMik7XHJcbiAgICB2YXIgdG9wUmlnaHQgICA9IG5ldyBQb2ludDJEKCBtYXgueCwgbWluLnkgKTtcclxuICAgIHZhciBib3R0b21MZWZ0ID0gbmV3IFBvaW50MkQoIG1pbi54LCBtYXgueSApO1xyXG5cclxuICAgIHZhciBpbnRlcjEgPSBJbnRlcnNlY3Rpb24uaW50ZXJzZWN0TGluZUxpbmUobWluLCB0b3BSaWdodCwgYTEsIGEyKTtcclxuICAgIHZhciBpbnRlcjIgPSBJbnRlcnNlY3Rpb24uaW50ZXJzZWN0TGluZUxpbmUodG9wUmlnaHQsIG1heCwgYTEsIGEyKTtcclxuICAgIHZhciBpbnRlcjMgPSBJbnRlcnNlY3Rpb24uaW50ZXJzZWN0TGluZUxpbmUobWF4LCBib3R0b21MZWZ0LCBhMSwgYTIpO1xyXG4gICAgdmFyIGludGVyNCA9IEludGVyc2VjdGlvbi5pbnRlcnNlY3RMaW5lTGluZShib3R0b21MZWZ0LCBtaW4sIGExLCBhMik7XHJcblxyXG4gICAgdmFyIHJlc3VsdCA9IG5ldyBJbnRlcnNlY3Rpb24oXCJObyBJbnRlcnNlY3Rpb25cIik7XHJcblxyXG4gICAgcmVzdWx0LmFwcGVuZFBvaW50cyhpbnRlcjEucG9pbnRzKTtcclxuICAgIHJlc3VsdC5hcHBlbmRQb2ludHMoaW50ZXIyLnBvaW50cyk7XHJcbiAgICByZXN1bHQuYXBwZW5kUG9pbnRzKGludGVyMy5wb2ludHMpO1xyXG4gICAgcmVzdWx0LmFwcGVuZFBvaW50cyhpbnRlcjQucG9pbnRzKTtcclxuXHJcbiAgICBpZiAoIHJlc3VsdC5wb2ludHMubGVuZ3RoID4gMCApXHJcbiAgICAgICAgcmVzdWx0LnN0YXR1cyA9IFwiSW50ZXJzZWN0aW9uXCI7XHJcblxyXG4gICAgcmV0dXJuIHJlc3VsdDtcclxufTtcclxuXHJcblxyXG4vKipcclxuICogIGludGVyc2VjdFBvbHlnb25Qb2x5Z29uXHJcbiAqXHJcbiAqICBAcGFyYW0ge0FycmF5PFBvaW50MkQ+fSBwb2ludHMxXHJcbiAqICBAcGFyYW0ge0FycmF5PFBvaW50MkQ+fSBwb2ludHMyXHJcbiAqICBAcmV0dXJucyB7SW50ZXJzZWN0aW9ufVxyXG4gKi9cclxuSW50ZXJzZWN0aW9uLmludGVyc2VjdFBvbHlnb25Qb2x5Z29uID0gZnVuY3Rpb24ocG9pbnRzMSwgcG9pbnRzMikge1xyXG4gICAgdmFyIHJlc3VsdCA9IG5ldyBJbnRlcnNlY3Rpb24oXCJObyBJbnRlcnNlY3Rpb25cIik7XHJcbiAgICB2YXIgbGVuZ3RoID0gcG9pbnRzMS5sZW5ndGg7XHJcblxyXG4gICAgZm9yICggdmFyIGkgPSAwOyBpIDwgbGVuZ3RoOyBpKysgKSB7XHJcbiAgICAgICAgdmFyIGExID0gcG9pbnRzMVtpXTtcclxuICAgICAgICB2YXIgYTIgPSBwb2ludHMxWyhpKzEpICUgbGVuZ3RoXTtcclxuICAgICAgICB2YXIgaW50ZXIgPSBJbnRlcnNlY3Rpb24uaW50ZXJzZWN0TGluZVBvbHlnb24oYTEsIGEyLCBwb2ludHMyKTtcclxuXHJcbiAgICAgICAgcmVzdWx0LmFwcGVuZFBvaW50cyhpbnRlci5wb2ludHMpO1xyXG4gICAgfVxyXG5cclxuICAgIGlmICggcmVzdWx0LnBvaW50cy5sZW5ndGggPiAwIClcclxuICAgICAgICByZXN1bHQuc3RhdHVzID0gXCJJbnRlcnNlY3Rpb25cIjtcclxuXHJcbiAgICByZXR1cm4gcmVzdWx0O1xyXG5cclxufTtcclxuXHJcblxyXG4vKipcclxuICogIGludGVyc2VjdFBvbHlnb25SZWN0YW5nbGVcclxuICpcclxuICogIEBwYXJhbSB7QXJyYXk8UG9pbnQyRD59IHBvaW50c1xyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSByMVxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSByMlxyXG4gKiAgQHJldHVybnMge0ludGVyc2VjdGlvbn1cclxuICovXHJcbkludGVyc2VjdGlvbi5pbnRlcnNlY3RQb2x5Z29uUmVjdGFuZ2xlID0gZnVuY3Rpb24ocG9pbnRzLCByMSwgcjIpIHtcclxuICAgIHZhciBtaW4gICAgICAgID0gcjEubWluKHIyKTtcclxuICAgIHZhciBtYXggICAgICAgID0gcjEubWF4KHIyKTtcclxuICAgIHZhciB0b3BSaWdodCAgID0gbmV3IFBvaW50MkQoIG1heC54LCBtaW4ueSApO1xyXG4gICAgdmFyIGJvdHRvbUxlZnQgPSBuZXcgUG9pbnQyRCggbWluLngsIG1heC55ICk7XHJcblxyXG4gICAgdmFyIGludGVyMSA9IEludGVyc2VjdGlvbi5pbnRlcnNlY3RMaW5lUG9seWdvbihtaW4sIHRvcFJpZ2h0LCBwb2ludHMpO1xyXG4gICAgdmFyIGludGVyMiA9IEludGVyc2VjdGlvbi5pbnRlcnNlY3RMaW5lUG9seWdvbih0b3BSaWdodCwgbWF4LCBwb2ludHMpO1xyXG4gICAgdmFyIGludGVyMyA9IEludGVyc2VjdGlvbi5pbnRlcnNlY3RMaW5lUG9seWdvbihtYXgsIGJvdHRvbUxlZnQsIHBvaW50cyk7XHJcbiAgICB2YXIgaW50ZXI0ID0gSW50ZXJzZWN0aW9uLmludGVyc2VjdExpbmVQb2x5Z29uKGJvdHRvbUxlZnQsIG1pbiwgcG9pbnRzKTtcclxuXHJcbiAgICB2YXIgcmVzdWx0ID0gbmV3IEludGVyc2VjdGlvbihcIk5vIEludGVyc2VjdGlvblwiKTtcclxuXHJcbiAgICByZXN1bHQuYXBwZW5kUG9pbnRzKGludGVyMS5wb2ludHMpO1xyXG4gICAgcmVzdWx0LmFwcGVuZFBvaW50cyhpbnRlcjIucG9pbnRzKTtcclxuICAgIHJlc3VsdC5hcHBlbmRQb2ludHMoaW50ZXIzLnBvaW50cyk7XHJcbiAgICByZXN1bHQuYXBwZW5kUG9pbnRzKGludGVyNC5wb2ludHMpO1xyXG5cclxuICAgIGlmICggcmVzdWx0LnBvaW50cy5sZW5ndGggPiAwIClcclxuICAgICAgICByZXN1bHQuc3RhdHVzID0gXCJJbnRlcnNlY3Rpb25cIjtcclxuXHJcbiAgICByZXR1cm4gcmVzdWx0O1xyXG59O1xyXG5cclxuXHJcbi8qKlxyXG4gKiAgaW50ZXJzZWN0UmF5UmF5XHJcbiAqXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IGExXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IGEyXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IGIxXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IGIyXHJcbiAqICBAcmV0dXJucyB7SW50ZXJzZWN0aW9ufVxyXG4gKi9cclxuSW50ZXJzZWN0aW9uLmludGVyc2VjdFJheVJheSA9IGZ1bmN0aW9uKGExLCBhMiwgYjEsIGIyKSB7XHJcbiAgICB2YXIgcmVzdWx0O1xyXG5cclxuICAgIHZhciB1YV90ID0gKGIyLnggLSBiMS54KSAqIChhMS55IC0gYjEueSkgLSAoYjIueSAtIGIxLnkpICogKGExLnggLSBiMS54KTtcclxuICAgIHZhciB1Yl90ID0gKGEyLnggLSBhMS54KSAqIChhMS55IC0gYjEueSkgLSAoYTIueSAtIGExLnkpICogKGExLnggLSBiMS54KTtcclxuICAgIHZhciB1X2IgID0gKGIyLnkgLSBiMS55KSAqIChhMi54IC0gYTEueCkgLSAoYjIueCAtIGIxLngpICogKGEyLnkgLSBhMS55KTtcclxuXHJcbiAgICBpZiAoIHVfYiAhPSAwICkge1xyXG4gICAgICAgIHZhciB1YSA9IHVhX3QgLyB1X2I7XHJcblxyXG4gICAgICAgIHJlc3VsdCA9IG5ldyBJbnRlcnNlY3Rpb24oXCJJbnRlcnNlY3Rpb25cIik7XHJcbiAgICAgICAgcmVzdWx0LnBvaW50cy5wdXNoKFxyXG4gICAgICAgICAgICBuZXcgUG9pbnQyRChcclxuICAgICAgICAgICAgICAgIGExLnggKyB1YSAqIChhMi54IC0gYTEueCksXHJcbiAgICAgICAgICAgICAgICBhMS55ICsgdWEgKiAoYTIueSAtIGExLnkpXHJcbiAgICAgICAgICAgIClcclxuICAgICAgICApO1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgICBpZiAoIHVhX3QgPT0gMCB8fCB1Yl90ID09IDAgKSB7XHJcbiAgICAgICAgICAgIHJlc3VsdCA9IG5ldyBJbnRlcnNlY3Rpb24oXCJDb2luY2lkZW50XCIpO1xyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgIHJlc3VsdCA9IG5ldyBJbnRlcnNlY3Rpb24oXCJQYXJhbGxlbFwiKTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIHJlc3VsdDtcclxufTtcclxuXHJcblxyXG4vKipcclxuICogIGludGVyc2VjdFJlY3RhbmdsZVJlY3RhbmdsZVxyXG4gKlxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBhMVxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBhMlxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBiMVxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBiMlxyXG4gKiAgQHJldHVybnMge0ludGVyc2VjdGlvbn1cclxuICovXHJcbkludGVyc2VjdGlvbi5pbnRlcnNlY3RSZWN0YW5nbGVSZWN0YW5nbGUgPSBmdW5jdGlvbihhMSwgYTIsIGIxLCBiMikge1xyXG4gICAgdmFyIG1pbiAgICAgICAgPSBhMS5taW4oYTIpO1xyXG4gICAgdmFyIG1heCAgICAgICAgPSBhMS5tYXgoYTIpO1xyXG4gICAgdmFyIHRvcFJpZ2h0ICAgPSBuZXcgUG9pbnQyRCggbWF4LngsIG1pbi55ICk7XHJcbiAgICB2YXIgYm90dG9tTGVmdCA9IG5ldyBQb2ludDJEKCBtaW4ueCwgbWF4LnkgKTtcclxuXHJcbiAgICB2YXIgaW50ZXIxID0gSW50ZXJzZWN0aW9uLmludGVyc2VjdExpbmVSZWN0YW5nbGUobWluLCB0b3BSaWdodCwgYjEsIGIyKTtcclxuICAgIHZhciBpbnRlcjIgPSBJbnRlcnNlY3Rpb24uaW50ZXJzZWN0TGluZVJlY3RhbmdsZSh0b3BSaWdodCwgbWF4LCBiMSwgYjIpO1xyXG4gICAgdmFyIGludGVyMyA9IEludGVyc2VjdGlvbi5pbnRlcnNlY3RMaW5lUmVjdGFuZ2xlKG1heCwgYm90dG9tTGVmdCwgYjEsIGIyKTtcclxuICAgIHZhciBpbnRlcjQgPSBJbnRlcnNlY3Rpb24uaW50ZXJzZWN0TGluZVJlY3RhbmdsZShib3R0b21MZWZ0LCBtaW4sIGIxLCBiMik7XHJcblxyXG4gICAgdmFyIHJlc3VsdCA9IG5ldyBJbnRlcnNlY3Rpb24oXCJObyBJbnRlcnNlY3Rpb25cIik7XHJcblxyXG4gICAgcmVzdWx0LmFwcGVuZFBvaW50cyhpbnRlcjEucG9pbnRzKTtcclxuICAgIHJlc3VsdC5hcHBlbmRQb2ludHMoaW50ZXIyLnBvaW50cyk7XHJcbiAgICByZXN1bHQuYXBwZW5kUG9pbnRzKGludGVyMy5wb2ludHMpO1xyXG4gICAgcmVzdWx0LmFwcGVuZFBvaW50cyhpbnRlcjQucG9pbnRzKTtcclxuXHJcbiAgICBpZiAoIHJlc3VsdC5wb2ludHMubGVuZ3RoID4gMCApXHJcbiAgICAgICAgcmVzdWx0LnN0YXR1cyA9IFwiSW50ZXJzZWN0aW9uXCI7XHJcblxyXG4gICAgcmV0dXJuIHJlc3VsdDtcclxufTtcclxuXHJcblxyXG4vKipcclxuICogIGJlem91dFxyXG4gKlxyXG4gKiAgVGhpcyBjb2RlIGlzIGJhc2VkIG9uIE1nY0ludHIyREVscEVscC5jcHAgd3JpdHRlbiBieSBEYXZpZCBFYmVybHkuICBIaXNcclxuICogIGNvZGUgYWxvbmcgd2l0aCBtYW55IG90aGVyIGV4Y2VsbGVudCBleGFtcGxlcyBhcmUgYXZhaWFibGUgYXQgaGlzIHNpdGU6XHJcbiAqICBodHRwOi8vd3d3Lm1hZ2ljLXNvZnR3YXJlLmNvbVxyXG4gKlxyXG4gKiAgQHBhcmFtIHtBcnJheTxQb2ludDJEPn0gZTFcclxuICogIEBwYXJhbSB7QXJyYXk8UG9pbnQyRD59IGUyXHJcbiAqICBAcmV0dXJucyB7UG9seW5vbWlhbH1cclxuICovXHJcbkludGVyc2VjdGlvbi5iZXpvdXQgPSBmdW5jdGlvbihlMSwgZTIpIHtcclxuICAgIHZhciBBQiAgICA9IGUxWzBdKmUyWzFdIC0gZTJbMF0qZTFbMV07XHJcbiAgICB2YXIgQUMgICAgPSBlMVswXSplMlsyXSAtIGUyWzBdKmUxWzJdO1xyXG4gICAgdmFyIEFEICAgID0gZTFbMF0qZTJbM10gLSBlMlswXSplMVszXTtcclxuICAgIHZhciBBRSAgICA9IGUxWzBdKmUyWzRdIC0gZTJbMF0qZTFbNF07XHJcbiAgICB2YXIgQUYgICAgPSBlMVswXSplMls1XSAtIGUyWzBdKmUxWzVdO1xyXG4gICAgdmFyIEJDICAgID0gZTFbMV0qZTJbMl0gLSBlMlsxXSplMVsyXTtcclxuICAgIHZhciBCRSAgICA9IGUxWzFdKmUyWzRdIC0gZTJbMV0qZTFbNF07XHJcbiAgICB2YXIgQkYgICAgPSBlMVsxXSplMls1XSAtIGUyWzFdKmUxWzVdO1xyXG4gICAgdmFyIENEICAgID0gZTFbMl0qZTJbM10gLSBlMlsyXSplMVszXTtcclxuICAgIHZhciBERSAgICA9IGUxWzNdKmUyWzRdIC0gZTJbM10qZTFbNF07XHJcbiAgICB2YXIgREYgICAgPSBlMVszXSplMls1XSAtIGUyWzNdKmUxWzVdO1xyXG4gICAgdmFyIEJGcERFID0gQkYgKyBERTtcclxuICAgIHZhciBCRW1DRCA9IEJFIC0gQ0Q7XHJcblxyXG4gICAgcmV0dXJuIG5ldyBQb2x5bm9taWFsKFxyXG4gICAgICAgIEFCKkJDIC0gQUMqQUMsXHJcbiAgICAgICAgQUIqQkVtQ0QgKyBBRCpCQyAtIDIqQUMqQUUsXHJcbiAgICAgICAgQUIqQkZwREUgKyBBRCpCRW1DRCAtIEFFKkFFIC0gMipBQypBRixcclxuICAgICAgICBBQipERiArIEFEKkJGcERFIC0gMipBRSpBRixcclxuICAgICAgICBBRCpERiAtIEFGKkFGXHJcbiAgICApO1xyXG59O1xyXG5cclxuaWYgKHR5cGVvZiBtb2R1bGUgIT09IFwidW5kZWZpbmVkXCIpIHtcclxuICAgIG1vZHVsZS5leHBvcnRzID0gSW50ZXJzZWN0aW9uO1xyXG59XHJcbiIsIi8qKlxyXG4gKlxyXG4gKiAgIEludGVyc2VjdGlvblBhcmFtcy5qc1xyXG4gKlxyXG4gKiAgIGNvcHlyaWdodCAyMDAyLCBLZXZpbiBMaW5kc2V5XHJcbiAqXHJcbiAqL1xyXG5cclxuLyoqXHJcbiAqICBJbnRlcnNlY3Rpb25QYXJhbXNcclxuICpcclxuICogIEBwYXJhbSB7U3RyaW5nfSBuYW1lXHJcbiAqICBAcGFyYW0ge0FycmF5PFBvaW50MkR9IHBhcmFtc1xyXG4gKiAgQHJldHVybnMge0ludGVyc2VjdGlvblBhcmFtc31cclxuICovXHJcbmZ1bmN0aW9uIEludGVyc2VjdGlvblBhcmFtcyhuYW1lLCBwYXJhbXMpIHtcclxuICAgIHRoaXMuaW5pdChuYW1lLCBwYXJhbXMpO1xyXG59XHJcblxyXG4vKipcclxuICogIGluaXRcclxuICpcclxuICogIEBwYXJhbSB7U3RyaW5nfSBuYW1lXHJcbiAqICBAcGFyYW0ge0FycmF5PFBvaW50MkQ+fSBwYXJhbXNcclxuICovXHJcbkludGVyc2VjdGlvblBhcmFtcy5wcm90b3R5cGUuaW5pdCA9IGZ1bmN0aW9uKG5hbWUsIHBhcmFtcykge1xyXG4gICAgdGhpcy5uYW1lICAgPSBuYW1lO1xyXG4gICAgdGhpcy5wYXJhbXMgPSBwYXJhbXM7XHJcbn07XHJcblxyXG5pZiAodHlwZW9mIG1vZHVsZSAhPT0gXCJ1bmRlZmluZWRcIikge1xyXG4gICAgbW9kdWxlLmV4cG9ydHMgPSBJbnRlcnNlY3Rpb25QYXJhbXM7XHJcbn0iLCIvLyBleHBvc2UgY2xhc3Nlc1xuXG5leHBvcnRzLlBvaW50MkQgPSByZXF1aXJlKCcuL2xpYi9Qb2ludDJEJyk7XG5leHBvcnRzLlZlY3RvcjJEID0gcmVxdWlyZSgnLi9saWIvVmVjdG9yMkQnKTtcbmV4cG9ydHMuTWF0cml4MkQgPSByZXF1aXJlKCcuL2xpYi9NYXRyaXgyRCcpO1xuIiwiLyoqXG4gKlxuICogICBNYXRyaXgyRC5qc1xuICpcbiAqICAgY29weXJpZ2h0IDIwMDEtMjAwMiwgMjAxMyBLZXZpbiBMaW5kc2V5XG4gKlxuICovXG5cbi8qKlxuICogIE1hdHJpeDJEXG4gKlxuICogIEBwYXJhbSB7TnVtYmVyfSBhXG4gKiAgQHBhcmFtIHtOdW1iZXJ9IGJcbiAqICBAcGFyYW0ge051bWJlcn0gY1xuICogIEBwYXJhbSB7TnVtYmVyfSBkXG4gKiAgQHBhcmFtIHtOdW1iZXJ9IGVcbiAqICBAcGFyYW0ge051bWJlcn0gZlxuICogIEByZXR1cm5zIHtNYXRyaXgyRH1cbiAqL1xuZnVuY3Rpb24gTWF0cml4MkQoYSwgYiwgYywgZCwgZSwgZikge1xuICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0aWVzKHRoaXMsIHtcbiAgICAgICAgXCJhXCI6IHtcbiAgICAgICAgICAgIHZhbHVlOiAoYSAhPT0gdW5kZWZpbmVkKSA/IGEgOiAxLFxuICAgICAgICAgICAgd3JpdGFibGU6IGZhbHNlLFxuICAgICAgICAgICAgZW51bWVyYWJsZTogdHJ1ZSxcbiAgICAgICAgICAgIGNvbmZpZ3VyYWJsZTogZmFsc2VcbiAgICAgICAgfSxcbiAgICAgICAgXCJiXCI6IHtcbiAgICAgICAgICAgIHZhbHVlOiAoYiAhPT0gdW5kZWZpbmVkKSA/IGIgOiAwLFxuICAgICAgICAgICAgd3JpdGFibGU6IGZhbHNlLFxuICAgICAgICAgICAgZW51bWVyYWJsZTogdHJ1ZSxcbiAgICAgICAgICAgIGNvbmZpZ3VyYWJsZTogZmFsc2VcbiAgICAgICAgfSxcbiAgICAgICAgXCJjXCI6IHtcbiAgICAgICAgICAgIHZhbHVlOiAoYyAhPT0gdW5kZWZpbmVkKSA/IGMgOiAwLFxuICAgICAgICAgICAgd3JpdGFibGU6IGZhbHNlLFxuICAgICAgICAgICAgZW51bWVyYWJsZTogdHJ1ZSxcbiAgICAgICAgICAgIGNvbmZpZ3VyYWJsZTogZmFsc2VcbiAgICAgICAgfSxcbiAgICAgICAgXCJkXCI6IHtcbiAgICAgICAgICAgIHZhbHVlOiAoZCAhPT0gdW5kZWZpbmVkKSA/IGQgOiAxLFxuICAgICAgICAgICAgd3JpdGFibGU6IGZhbHNlLFxuICAgICAgICAgICAgZW51bWVyYWJsZTogdHJ1ZSxcbiAgICAgICAgICAgIGNvbmZpZ3VyYWJsZTogZmFsc2VcbiAgICAgICAgfSxcbiAgICAgICAgXCJlXCI6IHtcbiAgICAgICAgICAgIHZhbHVlOiAoZSAhPT0gdW5kZWZpbmVkKSA/IGUgOiAwLFxuICAgICAgICAgICAgd3JpdGFibGU6IGZhbHNlLFxuICAgICAgICAgICAgZW51bWVyYWJsZTogdHJ1ZSxcbiAgICAgICAgICAgIGNvbmZpZ3VyYWJsZTogZmFsc2VcbiAgICAgICAgfSxcbiAgICAgICAgXCJmXCI6IHtcbiAgICAgICAgICAgIHZhbHVlOiAoZiAhPT0gdW5kZWZpbmVkKSA/IGYgOiAwLFxuICAgICAgICAgICAgd3JpdGFibGU6IGZhbHNlLFxuICAgICAgICAgICAgZW51bWVyYWJsZTogdHJ1ZSxcbiAgICAgICAgICAgIGNvbmZpZ3VyYWJsZTogZmFsc2VcbiAgICAgICAgfVxuICAgIH0pO1xuICAgIC8vIHRoaXMuYSA9IChhICE9PSB1bmRlZmluZWQpID8gYSA6IDE7XG4gICAgLy8gdGhpcy5iID0gKGIgIT09IHVuZGVmaW5lZCkgPyBiIDogMDtcbiAgICAvLyB0aGlzLmMgPSAoYyAhPT0gdW5kZWZpbmVkKSA/IGMgOiAwO1xuICAgIC8vIHRoaXMuZCA9IChkICE9PSB1bmRlZmluZWQpID8gZCA6IDE7XG4gICAgLy8gdGhpcy5lID0gKGUgIT09IHVuZGVmaW5lZCkgPyBlIDogMDtcbiAgICAvLyB0aGlzLmYgPSAoZiAhPT0gdW5kZWZpbmVkKSA/IGYgOiAwO1xufVxuXG4vKipcbiAqICBJZGVudGl0eSBtYXRyaXhcbiAqXG4gKiAgQHJldHVybnMge01hdHJpeDJEfVxuICovXG5NYXRyaXgyRC5JREVOVElUWSA9IG5ldyBNYXRyaXgyRCgxLCAwLCAwLCAxLCAwLCAwKTtcblxuLy8gVE9ETzogcm90YXRlLCBza2V3LCBldGMuIG1hdHJpY2VzIGFzIHdlbGw/XG5cbi8qKlxuICogIG11bHRpcGx5XG4gKlxuICogIEBwYXJhcm0ge01hdHJpeDJEfSB0aGF0XG4gKiAgQHJldHVybnMge01hdHJpeDJEfVxuICovXG5NYXRyaXgyRC5wcm90b3R5cGUubXVsdGlwbHkgPSBmdW5jdGlvbih0aGF0KSB7XG4gICAgcmV0dXJuIG5ldyBNYXRyaXgyRChcbiAgICAgICAgdGhpcy5hICogdGhhdC5hICsgdGhpcy5jICogdGhhdC5iLFxuICAgICAgICB0aGlzLmIgKiB0aGF0LmEgKyB0aGlzLmQgKiB0aGF0LmIsXG4gICAgICAgIHRoaXMuYSAqIHRoYXQuYyArIHRoaXMuYyAqIHRoYXQuZCxcbiAgICAgICAgdGhpcy5iICogdGhhdC5jICsgdGhpcy5kICogdGhhdC5kLFxuICAgICAgICB0aGlzLmEgKiB0aGF0LmUgKyB0aGlzLmMgKiB0aGF0LmYgKyB0aGlzLmUsXG4gICAgICAgIHRoaXMuYiAqIHRoYXQuZSArIHRoaXMuZCAqIHRoYXQuZiArIHRoaXMuZlxuICAgICk7XG59O1xuXG4vKipcbiAqICBpbnZlcnNlXG4gKlxuICogIEByZXR1cm5zIHtNYXRyaXgyRH1cbiAqL1xuTWF0cml4MkQucHJvdG90eXBlLmludmVyc2UgPSBmdW5jdGlvbigpIHtcbiAgICB2YXIgZGV0MSA9IHRoaXMuYSAqIHRoaXMuZCAtIHRoaXMuYiAqIHRoaXMuYztcblxuICAgIGlmICggZGV0MSA9PSAwLjAgKVxuICAgICAgICB0aHJvdyhcIk1hdHJpeCBpcyBub3QgaW52ZXJ0aWJsZVwiKTtcblxuICAgIHZhciBpZGV0ID0gMS4wIC8gZGV0MTtcbiAgICB2YXIgZGV0MiA9IHRoaXMuZiAqIHRoaXMuYyAtIHRoaXMuZSAqIHRoaXMuZDtcbiAgICB2YXIgZGV0MyA9IHRoaXMuZSAqIHRoaXMuYiAtIHRoaXMuZiAqIHRoaXMuYTtcblxuICAgIHJldHVybiBuZXcgTWF0cml4MkQoXG4gICAgICAgIHRoaXMuZCAqIGlkZXQsXG4gICAgICAgLXRoaXMuYiAqIGlkZXQsXG4gICAgICAgLXRoaXMuYyAqIGlkZXQsXG4gICAgICAgIHRoaXMuYSAqIGlkZXQsXG4gICAgICAgICAgZGV0MiAqIGlkZXQsXG4gICAgICAgICAgZGV0MyAqIGlkZXRcbiAgICApO1xufTtcblxuLyoqXG4gKiAgdHJhbnNsYXRlXG4gKlxuICogIEBwYXJhbSB7TnVtYmVyfSB0eFxuICogIEBwYXJhbSB7TnVtYmVyfSB0eVxuICogIEByZXR1cm5zIHtNYXRyaXgyRH1cbiAqL1xuTWF0cml4MkQucHJvdG90eXBlLnRyYW5zbGF0ZSA9IGZ1bmN0aW9uKHR4LCB0eSkge1xuICAgIHJldHVybiBuZXcgTWF0cml4MkQoXG4gICAgICAgIHRoaXMuYSxcbiAgICAgICAgdGhpcy5iLFxuICAgICAgICB0aGlzLmMsXG4gICAgICAgIHRoaXMuZCxcbiAgICAgICAgdGhpcy5hICogdHggKyB0aGlzLmMgKiB0eSArIHRoaXMuZSxcbiAgICAgICAgdGhpcy5iICogdHggKyB0aGlzLmQgKiB0eSArIHRoaXMuZlxuICAgICk7XG59O1xuXG4vKipcbiAqICBzY2FsZVxuICpcbiAqICBAcGFyYW0ge051bWJlcn0gc2NhbGVcbiAqICBAcmV0dXJucyB7TWF0cml4MkR9XG4gKi9cbk1hdHJpeDJELnByb3RvdHlwZS5zY2FsZSA9IGZ1bmN0aW9uKHNjYWxlKSB7XG4gICAgcmV0dXJuIG5ldyBNYXRyaXgyRChcbiAgICAgICAgdGhpcy5hICogc2NhbGUsXG4gICAgICAgIHRoaXMuYiAqIHNjYWxlLFxuICAgICAgICB0aGlzLmMgKiBzY2FsZSxcbiAgICAgICAgdGhpcy5kICogc2NhbGUsXG4gICAgICAgIHRoaXMuZSxcbiAgICAgICAgdGhpcy5mXG4gICAgKTtcbn07XG5cbi8qKlxuICogIHNjYWxlQXRcbiAqXG4gKiAgQHBhcmFtIHtOdW1iZXJ9IHNjYWxlXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBjZW50ZXJcbiAqICBAcmV0dXJucyB7TWF0cml4MkR9XG4gKi9cbk1hdHJpeDJELnByb3RvdHlwZS5zY2FsZUF0ID0gZnVuY3Rpb24oc2NhbGUsIGNlbnRlcikge1xuICAgIHZhciBkeCA9IGNlbnRlci54IC0gc2NhbGUgKiBjZW50ZXIueDtcbiAgICB2YXIgZHkgPSBjZW50ZXIueSAtIHNjYWxlICogY2VudGVyLnk7XG5cbiAgICByZXR1cm4gbmV3IE1hdHJpeDJEKFxuICAgICAgICB0aGlzLmEgKiBzY2FsZSxcbiAgICAgICAgdGhpcy5iICogc2NhbGUsXG4gICAgICAgIHRoaXMuYyAqIHNjYWxlLFxuICAgICAgICB0aGlzLmQgKiBzY2FsZSxcbiAgICAgICAgdGhpcy5hICogZHggKyB0aGlzLmMgKiBkeSArIHRoaXMuZSxcbiAgICAgICAgdGhpcy5iICogZHggKyB0aGlzLmQgKiBkeSArIHRoaXMuZlxuICAgICk7XG59O1xuXG4vKipcbiAqICBzY2FsZU5vblVuaWZvcm1cbiAqXG4gKiAgQHBhcmFtIHtOdW1iZXJ9IHNjYWxlWFxuICogIEBwYXJhbSB7TnVtYmVyfSBzY2FsZVlcbiAqICBAcmV0dXJucyB7TWF0cml4MkR9XG4gKi9cbk1hdHJpeDJELnByb3RvdHlwZS5zY2FsZU5vblVuaWZvcm0gPSBmdW5jdGlvbihzY2FsZVgsIHNjYWxlWSkge1xuICAgIHJldHVybiBuZXcgTWF0cml4MkQoXG4gICAgICAgIHRoaXMuYSAqIHNjYWxlWCxcbiAgICAgICAgdGhpcy5iICogc2NhbGVYLFxuICAgICAgICB0aGlzLmMgKiBzY2FsZVksXG4gICAgICAgIHRoaXMuZCAqIHNjYWxlWSxcbiAgICAgICAgdGhpcy5lLFxuICAgICAgICB0aGlzLmZcbiAgICApO1xufTtcblxuLyoqXG4gKiAgc2NhbGVOb25Vbmlmb3JtQXRcbiAqXG4gKiAgQHBhcmFtIHtOdW1iZXJ9IHNjYWxlWFxuICogIEBwYXJhbSB7TnVtYmVyfSBzY2FsZVlcbiAqICBAcGFyYW0ge1BvaW50MkR9IGNlbnRlclxuICogIEByZXR1cm5zIHtNYXRyaXgyRH1cbiAqL1xuTWF0cml4MkQucHJvdG90eXBlLnNjYWxlTm9uVW5pZm9ybUF0ID0gZnVuY3Rpb24oc2NhbGVYLCBzY2FsZVksIGNlbnRlcikge1xuICAgIHZhciBkeCA9IGNlbnRlci54IC0gc2NhbGVYICogY2VudGVyLng7XG4gICAgdmFyIGR5ID0gY2VudGVyLnkgLSBzY2FsZVkgKiBjZW50ZXIueTtcblxuICAgIHJldHVybiBuZXcgTWF0cml4MkQoXG4gICAgICAgIHRoaXMuYSAqIHNjYWxlWCxcbiAgICAgICAgdGhpcy5iICogc2NhbGVYLFxuICAgICAgICB0aGlzLmMgKiBzY2FsZVksXG4gICAgICAgIHRoaXMuZCAqIHNjYWxlWSxcbiAgICAgICAgdGhpcy5hICogZHggKyB0aGlzLmMgKiBkeSArIHRoaXMuZSxcbiAgICAgICAgdGhpcy5iICogZHggKyB0aGlzLmQgKiBkeSArIHRoaXMuZlxuICAgICk7XG59O1xuXG4vKipcbiAqICByb3RhdGVcbiAqXG4gKiAgQHBhcmFtIHtOdW1iZXJ9IHJhZGlhbnNcbiAqICBAcmV0dXJucyB7TWF0cml4MkR9XG4gKi9cbk1hdHJpeDJELnByb3RvdHlwZS5yb3RhdGUgPSBmdW5jdGlvbihyYWRpYW5zKSB7XG4gICAgdmFyIGMgPSBNYXRoLmNvcyhyYWRpYW5zKTtcbiAgICB2YXIgcyA9IE1hdGguc2luKHJhZGlhbnMpO1xuXG4gICAgcmV0dXJuIG5ldyBNYXRyaXgyRChcbiAgICAgICAgdGhpcy5hICogIGMgKyB0aGlzLmMgKiBzLFxuICAgICAgICB0aGlzLmIgKiAgYyArIHRoaXMuZCAqIHMsXG4gICAgICAgIHRoaXMuYSAqIC1zICsgdGhpcy5jICogYyxcbiAgICAgICAgdGhpcy5iICogLXMgKyB0aGlzLmQgKiBjLFxuICAgICAgICB0aGlzLmUsXG4gICAgICAgIHRoaXMuZlxuICAgICk7XG59O1xuXG4vKipcbiAqICByb3RhdGVBdFxuICpcbiAqICBAcGFyYW0ge051bWJlcn0gcmFkaWFuc1xuICogIEBwYXJhbSB7UG9pbnQyRH0gY2VudGVyXG4gKiAgQHJlc3VsdCB7TWF0cml4MkR9XG4gKi9cbk1hdHJpeDJELnByb3RvdHlwZS5yb3RhdGVBdCA9IGZ1bmN0aW9uKHJhZGlhbnMsIGNlbnRlcikge1xuICAgIHZhciBjID0gTWF0aC5jb3MocmFkaWFucyk7XG4gICAgdmFyIHMgPSBNYXRoLnNpbihyYWRpYW5zKTtcbiAgICB2YXIgdDEgPSAtY2VudGVyLnggKyBjZW50ZXIueCAqIGMgLSBjZW50ZXIueSAqIHM7XG4gICAgdmFyIHQyID0gLWNlbnRlci55ICsgY2VudGVyLnkgKiBjICsgY2VudGVyLnggKiBzO1xuXG4gICAgcmV0dXJuIG5ldyBNYXRyaXgyRChcbiAgICAgICAgdGhpcy5hICogIGMgKyB0aGlzLmMgKiBzLFxuICAgICAgICB0aGlzLmIgKiAgYyArIHRoaXMuZCAqIHMsXG4gICAgICAgIHRoaXMuYSAqIC1zICsgdGhpcy5jICogYyxcbiAgICAgICAgdGhpcy5iICogLXMgKyB0aGlzLmQgKiBjLFxuICAgICAgICB0aGlzLmEgKiB0MSArIHRoaXMuYyAqIHQyICsgdGhpcy5lLFxuICAgICAgICB0aGlzLmIgKiB0MSArIHRoaXMuZCAqIHQyICsgdGhpcy5mXG4gICAgKTtcbn07XG5cbi8qKlxuICogIHJvdGF0ZUZyb21WZWN0b3JcbiAqXG4gKiAgQHBhcmFtIHtWZWN0b3IyRH1cbiAqICBAcmV0dXJucyB7TWF0cml4MkR9XG4gKi9cbk1hdHJpeDJELnByb3RvdHlwZS5yb3RhdGVGcm9tVmVjdG9yID0gZnVuY3Rpb24odmVjdG9yKSB7XG4gICAgdmFyIHVuaXQgPSB2ZWN0b3IudW5pdCgpO1xuICAgIHZhciBjID0gdW5pdC54OyAvLyBjb3NcbiAgICB2YXIgcyA9IHVuaXQueTsgLy8gc2luXG5cbiAgICByZXR1cm4gbmV3IE1hdHJpeDJEKFxuICAgICAgICB0aGlzLmEgKiAgYyArIHRoaXMuYyAqIHMsXG4gICAgICAgIHRoaXMuYiAqICBjICsgdGhpcy5kICogcyxcbiAgICAgICAgdGhpcy5hICogLXMgKyB0aGlzLmMgKiBjLFxuICAgICAgICB0aGlzLmIgKiAtcyArIHRoaXMuZCAqIGMsXG4gICAgICAgIHRoaXMuZSxcbiAgICAgICAgdGhpcy5mXG4gICAgKTtcbn07XG5cbi8qKlxuICogIGZsaXBYXG4gKlxuICogIEByZXR1cm5zIHtNYXRyaXgyRH1cbiAqL1xuTWF0cml4MkQucHJvdG90eXBlLmZsaXBYID0gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIG5ldyBNYXRyaXgyRChcbiAgICAgICAgLXRoaXMuYSxcbiAgICAgICAgLXRoaXMuYixcbiAgICAgICAgIHRoaXMuYyxcbiAgICAgICAgIHRoaXMuZCxcbiAgICAgICAgIHRoaXMuZSxcbiAgICAgICAgIHRoaXMuZlxuICAgICk7XG59O1xuXG4vKipcbiAqICBmbGlwWVxuICpcbiAqICBAcmV0dXJucyB7TWF0cml4MkR9XG4gKi9cbk1hdHJpeDJELnByb3RvdHlwZS5mbGlwWSA9IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiBuZXcgTWF0cml4MkQoXG4gICAgICAgICB0aGlzLmEsXG4gICAgICAgICB0aGlzLmIsXG4gICAgICAgIC10aGlzLmMsXG4gICAgICAgIC10aGlzLmQsXG4gICAgICAgICB0aGlzLmUsXG4gICAgICAgICB0aGlzLmZcbiAgICApO1xufTtcblxuLyoqXG4gKiAgc2tld1hcbiAqXG4gKiAgQHBhcmFybSB7TnVtYmVyfSByYWRpYW5zXG4gKiAgQHJldHVybnMge01hdHJpeDJEfVxuICovXG5NYXRyaXgyRC5wcm90b3R5cGUuc2tld1ggPSBmdW5jdGlvbihyYWRpYW5zKSB7XG4gICAgdmFyIHQgPSBNYXRoLnRhbihyYWRpYW5zKTtcblxuICAgIHJldHVybiBuZXcgTWF0cml4MkQoXG4gICAgICAgIHRoaXMuYSxcbiAgICAgICAgdGhpcy5iLFxuICAgICAgICB0aGlzLmEgKiB0ICsgdGhpcy5jLFxuICAgICAgICB0aGlzLmIgKiB0ICsgdGhpcy5kLFxuICAgICAgICB0aGlzLmUsXG4gICAgICAgIHRoaXMuZlxuICAgICk7XG59O1xuXG4vLyBUT0RPOiBza2V3WEF0XG5cbi8qKlxuICogIHNrZXdZXG4gKlxuICogIEBwYXJhcm0ge051bWJlcn0gcmFkaWFuc1xuICogIEByZXR1cm5zIHtNYXRyaXgyRH1cbiAqL1xuTWF0cml4MkQucHJvdG90eXBlLnNrZXdZID0gZnVuY3Rpb24ocmFkaWFucykge1xuICAgIHZhciB0ID0gTWF0aC50YW4oYW5nbGUpO1xuXG4gICAgcmV0dXJuIG1hdHJpeF9uZXcoXG4gICAgICAgIHRoaXMuYSArIHRoaXMuYyAqIHQsXG4gICAgICAgIHRoaXMuYiArIHRoaXMuZCAqIHQsXG4gICAgICAgIHRoaXMuYyxcbiAgICAgICAgdGhpcy5kLFxuICAgICAgICB0aGlzLmUsXG4gICAgICAgIHRoaXMuZlxuICAgICk7XG59O1xuXG4vLyBUT0RPOiBza2V3WUF0XG5cbi8qKlxuICogIGlzSWRlbnRpdHlcbiAqXG4gKiAgQHJldHVybnMge0Jvb2xlYW59XG4gKi9cbk1hdHJpeDJELnByb3RvdHlwZS5pc0lkZW50aXR5ID0gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIChcbiAgICAgICAgdGhpcy5hID09PSAxLjAgJiZcbiAgICAgICAgdGhpcy5iID09PSAwLjAgJiZcbiAgICAgICAgdGhpcy5jID09PSAwLjAgJiZcbiAgICAgICAgdGhpcy5kID09PSAxLjAgJiZcbiAgICAgICAgdGhpcy5lID09PSAwLjAgJiZcbiAgICAgICAgdGhpcy5mID09PSAwLjBcbiAgICApO1xufTtcblxuLyoqXG4gKiAgaXNJbnZlcnRpYmxlXG4gKlxuICogIEByZXR1cm5zIHtCb29sZWFufVxuICovXG5NYXRyaXgyRC5wcm90b3R5cGUuaXNJbnZlcnRpYmxlID0gZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5hICogdGhpcy5kIC0gdGhpcy5iICogdGhpcy5jICE9PSAwLjA7XG59O1xuXG4vKipcbiAqICBnZXRTY2FsZVxuICpcbiAqICBAcmV0dXJucyB7c2NhbGVYOiBOdW1iZXIsIHNjYWxlWTogTnVtYmVyfVxuICovXG5NYXRyaXgyRC5wcm90b3R5cGUuZ2V0U2NhbGUgPSBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4ge1xuICAgICAgICBzY2FsZVg6IE1hdGguc3FydCh0aGlzLmEgKiB0aGlzLmEgKyB0aGlzLmMgKiB0aGlzLmMpLFxuICAgICAgICBzY2FsZVk6IE1hdGguc3FydCh0aGlzLmIgKiB0aGlzLmIgKyB0aGlzLmQgKiB0aGlzLmQpXG4gICAgfTtcbn07XG5cbi8qKlxuICogIGVxdWFsc1xuICpcbiAqICBAcGFyYW0ge01hdHJpeDJEfSB0aGF0XG4gKiAgQHJldHVybnMge0Jvb2xlYW59XG4gKi9cbk1hdHJpeDJELnByb3RvdHlwZS5lcXVhbHMgPSBmdW5jdGlvbih0aGF0KSB7XG4gICAgcmV0dXJuIChcbiAgICAgICAgdGhpcy5hID09PSB0aGF0LmEgJiZcbiAgICAgICAgdGhpcy5iID09PSB0aGF0LmIgJiZcbiAgICAgICAgdGhpcy5jID09PSB0aGF0LmMgJiZcbiAgICAgICAgdGhpcy5kID09PSB0aGF0LmQgJiZcbiAgICAgICAgdGhpcy5lID09PSB0aGF0LmUgJiZcbiAgICAgICAgdGhpcy5mID09PSB0aGF0LmZcbiAgICApO1xufTtcblxuLyoqXG4gKiAgdG9TdHJpbmdcbiAqXG4gKiAgQHJldHVybnMge1N0cmluZ31cbiAqL1xuTWF0cml4MkQucHJvdG90eXBlLnRvU3RyaW5nID0gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIChcbiAgICAgICAgXCJtYXRyaXgoXCIgK1xuICAgICAgICB0aGlzLmEgKyBcIixcIiArXG4gICAgICAgIHRoaXMuYiArIFwiLFwiICtcbiAgICAgICAgdGhpcy5jICsgXCIsXCIgK1xuICAgICAgICB0aGlzLmQgKyBcIixcIiArXG4gICAgICAgIHRoaXMuZSArIFwiLFwiICtcbiAgICAgICAgdGhpcy5mICsgXCIpXCJcbiAgICApO1xufVxuXG5pZiAodHlwZW9mIG1vZHVsZSAhPT0gXCJ1bmRlZmluZWRcIikge1xuICAgIG1vZHVsZS5leHBvcnRzID0gTWF0cml4MkQ7XG59IiwiLyoqXG4gKlxuICogICBQb2ludDJELmpzXG4gKlxuICogICBjb3B5cmlnaHQgMjAwMS0yMDAyLCAyMDEzIEtldmluIExpbmRzZXlcbiAqXG4gKi9cblxuLyoqXG4gKiAgUG9pbnQyRFxuICpcbiAqICBAcGFyYW0ge051bWJlcn0geFxuICogIEBwYXJhbSB7TnVtYmVyfSB5XG4gKiAgQHJldHVybnMge1BvaW50MkR9XG4gKi9cbmZ1bmN0aW9uIFBvaW50MkQoeCwgeSkge1xuICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0aWVzKHRoaXMsIHtcbiAgICAgICAgXCJ4XCI6IHtcbiAgICAgICAgICAgIHZhbHVlOiB4LFxuICAgICAgICAgICAgd3JpdGFibGU6IGZhbHNlLFxuICAgICAgICAgICAgZW51bWVyYWJsZTogdHJ1ZSxcbiAgICAgICAgICAgIGNvbmZpZ3VyYWJsZTogZmFsc2VcbiAgICAgICAgfSxcbiAgICAgICAgXCJ5XCI6IHtcbiAgICAgICAgICAgIHZhbHVlOiB5LFxuICAgICAgICAgICAgd3JpdGFibGU6IGZhbHNlLFxuICAgICAgICAgICAgZW51bWVyYWJsZTogdHJ1ZSxcbiAgICAgICAgICAgIGNvbmZpZ3VyYWJsZTogZmFsc2VcbiAgICAgICAgfVxuICAgIH0pO1xuICAgIC8vIHRoaXMueCA9IHg7XG4gICAgLy8gdGhpcy55ID0geTtcbn1cblxuLyoqXG4gKiAgY2xvbmVcbiAqXG4gKiAgQHJldHVybnMge1BvaW50MkR9XG4gKi9cblBvaW50MkQucHJvdG90eXBlLmNsb25lID0gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIG5ldyBQb2ludDJEKHRoaXMueCwgdGhpcy55KTtcbn07XG5cbi8qKlxuICogIGFkZFxuICpcbiAqICBAcGFyYW0ge1BvaW50MkR8VmVjdG9yMkR9IHRoYXRcbiAqICBAcmV0dXJucyB7UG9pbnQyRH1cbiAqL1xuUG9pbnQyRC5wcm90b3R5cGUuYWRkID0gZnVuY3Rpb24odGhhdCkge1xuICAgIHJldHVybiBuZXcgUG9pbnQyRCh0aGlzLngrdGhhdC54LCB0aGlzLnkrdGhhdC55KTtcbn07XG5cbi8qKlxuICogIHN1YnRyYWN0XG4gKlxuICogIEBwYXJhbSB7IFZlY3RvcjJEIHwgUG9pbnQyRCB9IHRoYXRcbiAqICBAcmV0dXJucyB7UG9pbnQyRH1cbiAqL1xuUG9pbnQyRC5wcm90b3R5cGUuc3VidHJhY3QgPSBmdW5jdGlvbih0aGF0KSB7XG4gICAgcmV0dXJuIG5ldyBQb2ludDJEKHRoaXMueC10aGF0LngsIHRoaXMueS10aGF0LnkpO1xufTtcblxuLyoqXG4gKiAgbXVsdGlwbHlcbiAqXG4gKiAgQHBhcmFtIHtOdW1iZXJ9IHNjYWxhclxuICogIEByZXR1cm5zIHtQb2ludDJEfVxuICovXG5Qb2ludDJELnByb3RvdHlwZS5tdWx0aXBseSA9IGZ1bmN0aW9uKHNjYWxhcikge1xuICAgIHJldHVybiBuZXcgUG9pbnQyRCh0aGlzLngqc2NhbGFyLCB0aGlzLnkqc2NhbGFyKTtcbn07XG5cbi8qKlxuICogIGRpdmlkZVxuICpcbiAqICBAcGFyYW0ge051bWJlcn0gc2NhbGFyXG4gKiAgQHJldHVybnMge1BvaW50MkR9XG4gKi9cblBvaW50MkQucHJvdG90eXBlLmRpdmlkZSA9IGZ1bmN0aW9uKHNjYWxhcikge1xuICAgIHJldHVybiBuZXcgUG9pbnQyRCh0aGlzLngvc2NhbGFyLCB0aGlzLnkvc2NhbGFyKTtcbn07XG5cbi8qKlxuICogIGVxdWFsc1xuICpcbiAqICBAcGFyYW0ge1BvaW50MkR9IHRoYXRcbiAqICBAcmV0dXJucyB7Qm9vbGVhbn1cbiAqL1xuUG9pbnQyRC5wcm90b3R5cGUuZXF1YWxzID0gZnVuY3Rpb24odGhhdCkge1xuICAgIHJldHVybiAoIHRoaXMueCA9PSB0aGF0LnggJiYgdGhpcy55ID09IHRoYXQueSApO1xufTtcblxuLy8gdXRpbGl0eSBtZXRob2RzXG5cbi8qKlxuICogIGxlcnBcbiAqXG4gKiAgQHBhcmFtIHsgVmVjdG9yMkQgfCBQb2ludDJEIH0gdGhhdFxuICogIEBwYXJhbSB7TnVtYmVyfSB0XG4gQCAgQHJldHVybnMge1BvaW50MkR9XG4gKi9cblBvaW50MkQucHJvdG90eXBlLmxlcnAgPSBmdW5jdGlvbih0aGF0LCB0KSB7XG4gICAgdmFyIG9tdCA9IDEuMCAtIHQ7XG5cbiAgICByZXR1cm4gbmV3IFBvaW50MkQoXG4gICAgICAgIHRoaXMueCAqIG9tdCArIHRoYXQueCAqIHQsXG4gICAgICAgIHRoaXMueSAqIG9tdCArIHRoYXQueSAqIHRcbiAgICApO1xufTtcblxuLyoqXG4gKiAgZGlzdGFuY2VGcm9tXG4gKlxuICogIEBwYXJhbSB7UG9pbnQyRH0gdGhhdFxuICogIEByZXR1cm5zIHtOdW1iZXJ9XG4gKi9cblBvaW50MkQucHJvdG90eXBlLmRpc3RhbmNlRnJvbSA9IGZ1bmN0aW9uKHRoYXQpIHtcbiAgICB2YXIgZHggPSB0aGlzLnggLSB0aGF0Lng7XG4gICAgdmFyIGR5ID0gdGhpcy55IC0gdGhhdC55O1xuXG4gICAgcmV0dXJuIE1hdGguc3FydChkeCpkeCArIGR5KmR5KTtcbn07XG5cbi8qKlxuICogIG1pblxuICpcbiAqICBAcGFyYW0ge1BvaW50MkR9IHRoYXRcbiAqICBAcmV0dXJucyB7TnVtYmVyfVxuICovXG5Qb2ludDJELnByb3RvdHlwZS5taW4gPSBmdW5jdGlvbih0aGF0KSB7XG4gICAgcmV0dXJuIG5ldyBQb2ludDJEKFxuICAgICAgICBNYXRoLm1pbiggdGhpcy54LCB0aGF0LnggKSxcbiAgICAgICAgTWF0aC5taW4oIHRoaXMueSwgdGhhdC55IClcbiAgICApO1xufTtcblxuLyoqXG4gKiAgbWF4XG4gKlxuICogIEBwYXJhbSB7UG9pbnQyRH0gdGhhdFxuICogIEByZXR1cm5zIHtOdW1iZXJ9XG4gKi9cblBvaW50MkQucHJvdG90eXBlLm1heCA9IGZ1bmN0aW9uKHRoYXQpIHtcbiAgICByZXR1cm4gbmV3IFBvaW50MkQoXG4gICAgICAgIE1hdGgubWF4KCB0aGlzLngsIHRoYXQueCApLFxuICAgICAgICBNYXRoLm1heCggdGhpcy55LCB0aGF0LnkgKVxuICAgICk7XG59O1xuXG4vKipcbiAqICB0cmFuc2Zvcm1cbiAqXG4gKiAgQHBhcmFtIHtNYXRyaXgyRH1cbiAqICBAcmVzdWx0IHtQb2ludDJEfVxuICovXG5Qb2ludDJELnByb3RvdHlwZS50cmFuc2Zvcm0gPSBmdW5jdGlvbihtYXRyaXgpIHtcbiAgICByZXR1cm4gbmV3IFBvaW50MkQoXG4gICAgICAgIG1hdHJpeC5hICogdGhpcy54ICsgbWF0cml4LmMgKiB0aGlzLnkgKyBtYXRyaXguZSxcbiAgICAgICAgbWF0cml4LmIgKiB0aGlzLnggKyBtYXRyaXguZCAqIHRoaXMueSArIG1hdHJpeC5mXG4gICAgKTtcbn07XG5cbi8qKlxuICogIHRvU3RyaW5nXG4gKlxuICogIEByZXR1cm5zIHtTdHJpbmd9XG4gKi9cblBvaW50MkQucHJvdG90eXBlLnRvU3RyaW5nID0gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIFwicG9pbnQoXCIgKyB0aGlzLnggKyBcIixcIiArIHRoaXMueSArIFwiKVwiO1xufTtcblxuaWYgKHR5cGVvZiBtb2R1bGUgIT09IFwidW5kZWZpbmVkXCIpIHtcbiAgICBtb2R1bGUuZXhwb3J0cyA9IFBvaW50MkQ7XG59XG4iLCIvKipcbiAqXG4gKiAgIFZlY3RvcjJELmpzXG4gKlxuICogICBjb3B5cmlnaHQgMjAwMS0yMDAyLCAyMDEzIEtldmluIExpbmRzZXlcbiAqXG4gKi9cblxuLyoqXG4gKiAgVmVjdG9yMkRcbiAqXG4gKiAgQHBhcmFtIHtOdW1iZXJ9IHhcbiAqICBAcGFyYW0ge051bWJlcn0geVxuICogIEByZXR1cm5zIHtWZWN0b3IyRH1cbiAqL1xuZnVuY3Rpb24gVmVjdG9yMkQoeCwgeSkge1xuICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0aWVzKHRoaXMsIHtcbiAgICAgICAgXCJ4XCI6IHtcbiAgICAgICAgICAgIHZhbHVlOiB4LFxuICAgICAgICAgICAgd3JpdGFibGU6IGZhbHNlLFxuICAgICAgICAgICAgZW51bWVyYWJsZTogdHJ1ZSxcbiAgICAgICAgICAgIGNvbmZpZ3VyYWJsZTogZmFsc2VcbiAgICAgICAgfSxcbiAgICAgICAgXCJ5XCI6IHtcbiAgICAgICAgICAgIHZhbHVlOiB5LFxuICAgICAgICAgICAgd3JpdGFibGU6IGZhbHNlLFxuICAgICAgICAgICAgZW51bWVyYWJsZTogdHJ1ZSxcbiAgICAgICAgICAgIGNvbmZpZ3VyYWJsZTogZmFsc2VcbiAgICAgICAgfVxuICAgIH0pO1xuICAgIC8vIHRoaXMueCA9IHg7XG4gICAgLy8gdGhpcy55ID0geTtcbn1cblxuLyoqXG4gKiAgZnJvbVBvaW50c1xuICpcbiAqICBAcGFyYW0ge1BvaW50MkR9IHAxXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBwMlxuICogIEByZXR1cm5zIHtWZWN0b3IyRH1cbiAqL1xuVmVjdG9yMkQuZnJvbVBvaW50cyA9IGZ1bmN0aW9uKHAxLCBwMikge1xuICAgIHJldHVybiBuZXcgVmVjdG9yMkQoXG4gICAgICAgIHAyLnggLSBwMS54LFxuICAgICAgICBwMi55IC0gcDEueVxuICAgICk7XG59O1xuXG4vKipcbiAqICBsZW5ndGhcbiAqXG4gKiAgQHJldHVybnMge051bWJlcn1cbiAqL1xuVmVjdG9yMkQucHJvdG90eXBlLmxlbmd0aCA9IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiBNYXRoLnNxcnQodGhpcy54KnRoaXMueCArIHRoaXMueSp0aGlzLnkpO1xufTtcblxuLyoqXG4gKiAgbWFnbml0dWRlXG4gKlxuICogIEByZXR1cm5zIHtOdW1iZXJ9XG4gKi9cblZlY3RvcjJELnByb3RvdHlwZS5tYWduaXR1ZGUgPSBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gdGhpcy54KnRoaXMueCArIHRoaXMueSp0aGlzLnk7XG59O1xuXG4vKipcbiAqICBkb3RcbiAqXG4gKiAgQHBhcmFtIHtWZWN0b3IyRH0gdGhhdFxuICogIEByZXR1cm5zIHtOdW1iZXJ9XG4gKi9cblZlY3RvcjJELnByb3RvdHlwZS5kb3QgPSBmdW5jdGlvbih0aGF0KSB7XG4gICAgcmV0dXJuIHRoaXMueCp0aGF0LnggKyB0aGlzLnkqdGhhdC55O1xufTtcblxuLyoqXG4gKiAgY3Jvc3NcbiAqXG4gKiAgQHBhcmFtIHtWZWN0b3IyRH0gdGhhdFxuICogIEByZXR1cm5zIHtOdW1iZXJ9XG4gKi9cblZlY3RvcjJELnByb3RvdHlwZS5jcm9zcyA9IGZ1bmN0aW9uKHRoYXQpIHtcbiAgICByZXR1cm4gdGhpcy54KnRoYXQueSAtIHRoaXMueSp0aGF0Lng7XG59XG5cbi8qKlxuICogIGRldGVybWluYW50XG4gKlxuICogIEBwYXJhbSB7VmVjdG9yMkR9IHRoYXRcbiAqICBAcmV0dXJucyB7TnVtYmVyfVxuICovXG5WZWN0b3IyRC5wcm90b3R5cGUuZGV0ZXJtaW5hbnQgPSBmdW5jdGlvbih0aGF0KSB7XG4gICAgcmV0dXJuIHRoaXMueCp0aGF0LnkgLSB0aGlzLnkqdGhhdC54O1xufTtcblxuLyoqXG4gKiAgdW5pdFxuICpcbiAqICBAcmV0dXJucyB7VmVjdG9yMkR9XG4gKi9cblZlY3RvcjJELnByb3RvdHlwZS51bml0ID0gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIHRoaXMuZGl2aWRlKCB0aGlzLmxlbmd0aCgpICk7XG59O1xuXG4vKipcbiAqICBhZGRcbiAqXG4gKiAgQHBhcmFtIHtWZWN0b3IyRH0gdGhhdFxuICogIEByZXR1cm5zIHtWZWN0b3IyRH1cbiAqL1xuVmVjdG9yMkQucHJvdG90eXBlLmFkZCA9IGZ1bmN0aW9uKHRoYXQpIHtcbiAgICByZXR1cm4gbmV3IFZlY3RvcjJEKHRoaXMueCArIHRoYXQueCwgdGhpcy55ICsgdGhhdC55KTtcbn07XG5cbi8qKlxuICogIHN1YnRyYWN0XG4gKlxuICogIEBwYXJhbSB7VmVjdG9yMkR9IHRoYXRcbiAqICBAcmV0dXJucyB7VmVjdG9yMkR9XG4gKi9cblZlY3RvcjJELnByb3RvdHlwZS5zdWJ0cmFjdCA9IGZ1bmN0aW9uKHRoYXQpIHtcbiAgICByZXR1cm4gbmV3IFZlY3RvcjJEKHRoaXMueCAtIHRoYXQueCwgdGhpcy55IC0gdGhhdC55KTtcbn07XG5cbi8qKlxuICogIG11bHRpcGx5XG4gKlxuICogIEBwYXJhbSB7TnVtYmVyfSBzY2FsYXJcbiAqICBAcmV0dXJucyB7VmVjdG9yMkR9XG4gKi9cblZlY3RvcjJELnByb3RvdHlwZS5tdWx0aXBseSA9IGZ1bmN0aW9uKHNjYWxhcikge1xuICAgIHJldHVybiBuZXcgVmVjdG9yMkQodGhpcy54ICogc2NhbGFyLCB0aGlzLnkgKiBzY2FsYXIpO1xufTtcblxuLyoqXG4gKiAgZGl2aWRlXG4gKlxuICogIEBwYXJhbSB7TnVtYmVyfSBzY2FsYXJcbiAqICBAcmV0dXJucyB7VmVjdG9yMkR9XG4gKi9cblZlY3RvcjJELnByb3RvdHlwZS5kaXZpZGUgPSBmdW5jdGlvbihzY2FsYXIpIHtcbiAgICByZXR1cm4gbmV3IFZlY3RvcjJEKHRoaXMueCAvIHNjYWxhciwgdGhpcy55IC8gc2NhbGFyKTtcbn07XG5cbi8qKlxuICogIGFuZ2xlQmV0d2VlblxuICpcbiAqICBAcGFyYW0ge1ZlY3RvcjJEfSB0aGF0XG4gKiAgQHJldHVybnMge051bWJlcn1cbiAqL1xuVmVjdG9yMkQucHJvdG90eXBlLmFuZ2xlQmV0d2VlbiA9IGZ1bmN0aW9uKHRoYXQpIHtcbiAgICB2YXIgY29zID0gdGhpcy5kb3QodGhhdCkgLyAodGhpcy5sZW5ndGgoKSAqIHRoYXQubGVuZ3RoKCkpO1xuICAgIGlmIChjb3MgPCAtMSkge1xuICAgICAgICBjb3MgPSAtMTtcbiAgICB9XG4gICAgZWxzZSBpZiAoY29zID4gMSkge1xuICAgICAgICBjb3MgPSAxO1xuICAgIH1cbiAgICB2YXIgcmFkaWFucyA9IE1hdGguYWNvcyhjb3MpO1xuXG4gICAgcmV0dXJuICh0aGlzLmNyb3NzKHRoYXQpIDwgMC4wKSA/IC1yYWRpYW5zIDogcmFkaWFucztcbn07XG5cbi8qKlxuICogIEZpbmQgYSB2ZWN0b3IgaXMgdGhhdCBpcyBwZXJwZW5kaWN1bGFyIHRvIHRoaXMgdmVjdG9yXG4gKlxuICogIEByZXR1cm5zIHtWZWN0b3IyRH1cbiAqL1xuVmVjdG9yMkQucHJvdG90eXBlLnBlcnAgPSBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gbmV3IFZlY3RvcjJEKC10aGlzLnksIHRoaXMueCk7XG59O1xuXG4vKipcbiAqICBGaW5kIHRoZSBjb21wb25lbnQgb2YgdGhlIHNwZWNpZmllZCB2ZWN0b3IgdGhhdCBpcyBwZXJwZW5kaWN1bGFyIHRvXG4gKiAgdGhpcyB2ZWN0b3JcbiAqXG4gKiAgQHBhcmFtIHtWZWN0b3IyRH0gdGhhdFxuICogIEByZXR1cm5zIHtWZWN0b3IyRH1cbiAqL1xuVmVjdG9yMkQucHJvdG90eXBlLnBlcnBlbmRpY3VsYXIgPSBmdW5jdGlvbih0aGF0KSB7XG4gICAgcmV0dXJuIHRoaXMuc3VidHJhY3QodGhpcy5wcm9qZWN0KHRoYXQpKTtcbn07XG5cbi8qKlxuICogIHByb2plY3RcbiAqXG4gKiAgQHBhcmFtIHtWZWN0b3IyRH0gdGhhdFxuICogIEByZXR1cm5zIHtWZWN0b3IyRH1cbiAqL1xuVmVjdG9yMkQucHJvdG90eXBlLnByb2plY3QgPSBmdW5jdGlvbih0aGF0KSB7XG4gICAgdmFyIHBlcmNlbnQgPSB0aGlzLmRvdCh0aGF0KSAvIHRoYXQuZG90KHRoYXQpO1xuXG4gICAgcmV0dXJuIHRoYXQubXVsdGlwbHkocGVyY2VudCk7XG59O1xuXG4vKipcbiAqICB0cmFuc2Zvcm1cbiAqXG4gKiAgQHBhcmFtIHtNYXRyaXgyRH1cbiAqICBAcmV0dXJucyB7VmVjdG9yMkR9XG4gKi9cblZlY3RvcjJELnByb3RvdHlwZS50cmFuc2Zvcm0gPSBmdW5jdGlvbihtYXRyaXgpIHtcbiAgICByZXR1cm4gbmV3IFZlY3RvcjJEKFxuICAgICAgICBtYXRyaXguYSAqIHRoaXMueCArIG1hdHJpeC5jICogdGhpcy55LFxuICAgICAgICBtYXRyaXguYiAqIHRoaXMueCArIG1hdHJpeC5kICogdGhpcy55XG4gICAgKTtcbn07XG5cbi8qKlxuICogIGVxdWFsc1xuICpcbiAqICBAcGFyYW0ge1ZlY3RvcjJEfSB0aGF0XG4gKiAgQHJldHVybnMge0Jvb2xlYW59XG4gKi9cblZlY3RvcjJELnByb3RvdHlwZS5lcXVhbHMgPSBmdW5jdGlvbih0aGF0KSB7XG4gICAgcmV0dXJuIChcbiAgICAgICAgdGhpcy54ID09PSB0aGF0LnggJiZcbiAgICAgICAgdGhpcy55ID09PSB0aGF0LnlcbiAgICApO1xufTtcblxuLyoqXG4gKiAgdG9TdHJpbmdcbiAqXG4gKiAgQHJldHVybnMge1N0cmluZ31cbiAqL1xuVmVjdG9yMkQucHJvdG90eXBlLnRvU3RyaW5nID0gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIFwidmVjdG9yKFwiICsgdGhpcy54ICsgXCIsXCIgKyB0aGlzLnkgKyBcIilcIjtcbn07XG5cbmlmICh0eXBlb2YgbW9kdWxlICE9PSBcInVuZGVmaW5lZFwiKSB7XG4gICAgbW9kdWxlLmV4cG9ydHMgPSBWZWN0b3IyRDtcbn1cbiIsIi8vIGV4cG9zZSBjbGFzc2VzXG5cbmV4cG9ydHMuUG9seW5vbWlhbCA9IHJlcXVpcmUoJy4vbGliL1BvbHlub21pYWwnKTtcbmV4cG9ydHMuU3FydFBvbHlub21pYWwgPSByZXF1aXJlKCcuL2xpYi9TcXJ0UG9seW5vbWlhbCcpO1xuIiwiLyoqXG4gKlxuICogICBQb2x5bm9taWFsLmpzXG4gKlxuICogICBjb3B5cmlnaHQgMjAwMiwgMjEwMyBLZXZpbiBMaW5kc2V5XG4gKlxuICovXG5cblBvbHlub21pYWwuVE9MRVJBTkNFID0gMWUtNjtcblBvbHlub21pYWwuQUNDVVJBQ1kgID0gMTU7XG5cblxuLyoqXG4gKiAgaW50ZXJwb2xhdGVcbiAqXG4gKiAgQHBhcmFtIHtBcnJheTxOdW1iZXI+fSB4c1xuICogIEBwYXJhbSB7QXJyYXk8TnVtYmVyPn0geXNcbiAqICBAcGFyYW0ge051bWJlcn0gblxuICogIEBwYXJhbSB7TnVtYmVyfSBvZmZzZXRcbiAqICBAcGFyYW0ge051bWJlcn0geFxuICpcbiAqICBAcmV0dXJucyB7eTpOdW1iZXIsIGR5Ok51bWJlcn1cbiAqL1xuUG9seW5vbWlhbC5pbnRlcnBvbGF0ZSA9IGZ1bmN0aW9uKHhzLCB5cywgbiwgb2Zmc2V0LCB4KSB7XG4gICAgaWYgKCB4cy5jb25zdHJ1Y3RvciAhPT0gQXJyYXkgfHwgeXMuY29uc3RydWN0b3IgIT09IEFycmF5IClcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiUG9seW5vbWlhbC5pbnRlcnBvbGF0ZTogeHMgYW5kIHlzIG11c3QgYmUgYXJyYXlzXCIpO1xuICAgIGlmICggaXNOYU4obikgfHwgaXNOYU4ob2Zmc2V0KSB8fCBpc05hTih4KSApXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcIlBvbHlub21pYWwuaW50ZXJwb2xhdGU6IG4sIG9mZnNldCwgYW5kIHggbXVzdCBiZSBudW1iZXJzXCIpO1xuXG4gICAgdmFyIHkgID0gMDtcbiAgICB2YXIgZHkgPSAwO1xuICAgIHZhciBjID0gbmV3IEFycmF5KG4pO1xuICAgIHZhciBkID0gbmV3IEFycmF5KG4pO1xuICAgIHZhciBucyA9IDA7XG4gICAgdmFyIHJlc3VsdDtcblxuICAgIHZhciBkaWZmID0gTWF0aC5hYnMoeCAtIHhzW29mZnNldF0pO1xuICAgIGZvciAoIHZhciBpID0gMDsgaSA8IG47IGkrKyApIHtcbiAgICAgICAgdmFyIGRpZnQgPSBNYXRoLmFicyh4IC0geHNbb2Zmc2V0K2ldKTtcblxuICAgICAgICBpZiAoIGRpZnQgPCBkaWZmICkge1xuICAgICAgICAgICAgbnMgPSBpO1xuICAgICAgICAgICAgZGlmZiA9IGRpZnQ7XG4gICAgICAgIH1cbiAgICAgICAgY1tpXSA9IGRbaV0gPSB5c1tvZmZzZXQraV07XG4gICAgfVxuICAgIHkgPSB5c1tvZmZzZXQrbnNdO1xuICAgIG5zLS07XG5cbiAgICBmb3IgKCB2YXIgbSA9IDE7IG0gPCBuOyBtKysgKSB7XG4gICAgICAgIGZvciAoIHZhciBpID0gMDsgaSA8IG4tbTsgaSsrICkge1xuICAgICAgICAgICAgdmFyIGhvID0geHNbb2Zmc2V0K2ldIC0geDtcbiAgICAgICAgICAgIHZhciBocCA9IHhzW29mZnNldCtpK21dIC0geDtcbiAgICAgICAgICAgIHZhciB3ID0gY1tpKzFdLWRbaV07XG4gICAgICAgICAgICB2YXIgZGVuID0gaG8gLSBocDtcblxuICAgICAgICAgICAgaWYgKCBkZW4gPT0gMC4wICkge1xuICAgICAgICAgICAgICAgIHJlc3VsdCA9IHsgeTogMCwgZHk6IDB9O1xuICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBkZW4gPSB3IC8gZGVuO1xuICAgICAgICAgICAgZFtpXSA9IGhwKmRlbjtcbiAgICAgICAgICAgIGNbaV0gPSBobypkZW47XG4gICAgICAgIH1cbiAgICAgICAgZHkgPSAoMioobnMrMSkgPCAobi1tKSkgPyBjW25zKzFdIDogZFtucy0tXTtcbiAgICAgICAgeSArPSBkeTtcbiAgICB9XG5cbiAgICByZXR1cm4geyB5OiB5LCBkeTogZHkgfTtcbn07XG5cblxuLyoqXG4gKiAgUG9seW5vbWlhbFxuICpcbiAqICBAcmV0dXJucyB7UG9seW5vbWlhbH1cbiAqL1xuZnVuY3Rpb24gUG9seW5vbWlhbCgpIHtcbiAgICB0aGlzLmluaXQoIGFyZ3VtZW50cyApO1xufVxuXG5cbi8qKlxuICogIGluaXRcbiAqL1xuUG9seW5vbWlhbC5wcm90b3R5cGUuaW5pdCA9IGZ1bmN0aW9uKGNvZWZzKSB7XG4gICAgdGhpcy5jb2VmcyA9IG5ldyBBcnJheSgpO1xuXG4gICAgZm9yICggdmFyIGkgPSBjb2Vmcy5sZW5ndGggLSAxOyBpID49IDA7IGktLSApXG4gICAgICAgIHRoaXMuY29lZnMucHVzaCggY29lZnNbaV0gKTtcblxuICAgIHRoaXMuX3ZhcmlhYmxlID0gXCJ0XCI7XG4gICAgdGhpcy5fcyA9IDA7XG59O1xuXG5cbi8qKlxuICogIGV2YWxcbiAqL1xuUG9seW5vbWlhbC5wcm90b3R5cGUuZXZhbCA9IGZ1bmN0aW9uKHgpIHtcbiAgICBpZiAoIGlzTmFOKHgpIClcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiUG9seW5vbWlhbC5ldmFsOiBwYXJhbWV0ZXIgbXVzdCBiZSBhIG51bWJlclwiKTtcblxuICAgIHZhciByZXN1bHQgPSAwO1xuXG4gICAgZm9yICggdmFyIGkgPSB0aGlzLmNvZWZzLmxlbmd0aCAtIDE7IGkgPj0gMDsgaS0tIClcbiAgICAgICAgcmVzdWx0ID0gcmVzdWx0ICogeCArIHRoaXMuY29lZnNbaV07XG5cbiAgICByZXR1cm4gcmVzdWx0O1xufTtcblxuXG4vKipcbiAqICBhZGRcbiAqL1xuUG9seW5vbWlhbC5wcm90b3R5cGUuYWRkID0gZnVuY3Rpb24odGhhdCkge1xuICAgIHZhciByZXN1bHQgPSBuZXcgUG9seW5vbWlhbCgpO1xuICAgIHZhciBkMSA9IHRoaXMuZ2V0RGVncmVlKCk7XG4gICAgdmFyIGQyID0gdGhhdC5nZXREZWdyZWUoKTtcbiAgICB2YXIgZG1heCA9IE1hdGgubWF4KGQxLGQyKTtcblxuICAgIGZvciAoIHZhciBpID0gMDsgaSA8PSBkbWF4OyBpKysgKSB7XG4gICAgICAgIHZhciB2MSA9IChpIDw9IGQxKSA/IHRoaXMuY29lZnNbaV0gOiAwO1xuICAgICAgICB2YXIgdjIgPSAoaSA8PSBkMikgPyB0aGF0LmNvZWZzW2ldIDogMDtcblxuICAgICAgICByZXN1bHQuY29lZnNbaV0gPSB2MSArIHYyO1xuICAgIH1cblxuICAgIHJldHVybiByZXN1bHQ7XG59O1xuXG5cbi8qKlxuICogIG11bHRpcGx5XG4gKi9cblBvbHlub21pYWwucHJvdG90eXBlLm11bHRpcGx5ID0gZnVuY3Rpb24odGhhdCkge1xuICAgIHZhciByZXN1bHQgPSBuZXcgUG9seW5vbWlhbCgpO1xuXG4gICAgZm9yICggdmFyIGkgPSAwOyBpIDw9IHRoaXMuZ2V0RGVncmVlKCkgKyB0aGF0LmdldERlZ3JlZSgpOyBpKysgKVxuICAgICAgICByZXN1bHQuY29lZnMucHVzaCgwKTtcblxuICAgIGZvciAoIHZhciBpID0gMDsgaSA8PSB0aGlzLmdldERlZ3JlZSgpOyBpKysgKVxuICAgICAgICBmb3IgKCB2YXIgaiA9IDA7IGogPD0gdGhhdC5nZXREZWdyZWUoKTsgaisrIClcbiAgICAgICAgICAgIHJlc3VsdC5jb2Vmc1tpK2pdICs9IHRoaXMuY29lZnNbaV0gKiB0aGF0LmNvZWZzW2pdO1xuXG4gICAgcmV0dXJuIHJlc3VsdDtcbn07XG5cblxuLyoqXG4gKiAgZGl2aWRlX3NjYWxhclxuICovXG5Qb2x5bm9taWFsLnByb3RvdHlwZS5kaXZpZGVfc2NhbGFyID0gZnVuY3Rpb24oc2NhbGFyKSB7XG4gICAgZm9yICggdmFyIGkgPSAwOyBpIDwgdGhpcy5jb2Vmcy5sZW5ndGg7IGkrKyApXG4gICAgICAgIHRoaXMuY29lZnNbaV0gLz0gc2NhbGFyO1xufTtcblxuXG4vKipcbiAqICBzaW1wbGlmeVxuICovXG5Qb2x5bm9taWFsLnByb3RvdHlwZS5zaW1wbGlmeSA9IGZ1bmN0aW9uKCkge1xuICAgIGZvciAoIHZhciBpID0gdGhpcy5nZXREZWdyZWUoKTsgaSA+PSAwOyBpLS0gKSB7XG4gICAgICAgIGlmICggTWF0aC5hYnMoIHRoaXMuY29lZnNbaV0gKSA8PSBQb2x5bm9taWFsLlRPTEVSQU5DRSApXG4gICAgICAgICAgICB0aGlzLmNvZWZzLnBvcCgpO1xuICAgICAgICBlbHNlXG4gICAgICAgICAgICBicmVhaztcbiAgICB9XG59O1xuXG5cbi8qKlxuICogIGJpc2VjdGlvblxuICovXG5Qb2x5bm9taWFsLnByb3RvdHlwZS5iaXNlY3Rpb24gPSBmdW5jdGlvbihtaW4sIG1heCkge1xuICAgIHZhciBtaW5WYWx1ZSA9IHRoaXMuZXZhbChtaW4pO1xuICAgIHZhciBtYXhWYWx1ZSA9IHRoaXMuZXZhbChtYXgpO1xuICAgIHZhciByZXN1bHQ7XG5cbiAgICBpZiAoIE1hdGguYWJzKG1pblZhbHVlKSA8PSBQb2x5bm9taWFsLlRPTEVSQU5DRSApXG4gICAgICAgIHJlc3VsdCA9IG1pbjtcbiAgICBlbHNlIGlmICggTWF0aC5hYnMobWF4VmFsdWUpIDw9IFBvbHlub21pYWwuVE9MRVJBTkNFIClcbiAgICAgICAgcmVzdWx0ID0gbWF4O1xuICAgIGVsc2UgaWYgKCBtaW5WYWx1ZSAqIG1heFZhbHVlIDw9IDAgKSB7XG4gICAgICAgIHZhciB0bXAxICA9IE1hdGgubG9nKG1heCAtIG1pbik7XG4gICAgICAgIHZhciB0bXAyICA9IE1hdGguTE4xMCAqIFBvbHlub21pYWwuQUNDVVJBQ1k7XG4gICAgICAgIHZhciBpdGVycyA9IE1hdGguY2VpbCggKHRtcDErdG1wMikgLyBNYXRoLkxOMiApO1xuXG4gICAgICAgIGZvciAoIHZhciBpID0gMDsgaSA8IGl0ZXJzOyBpKysgKSB7XG4gICAgICAgICAgICByZXN1bHQgPSAwLjUgKiAobWluICsgbWF4KTtcbiAgICAgICAgICAgIHZhciB2YWx1ZSA9IHRoaXMuZXZhbChyZXN1bHQpO1xuXG4gICAgICAgICAgICBpZiAoIE1hdGguYWJzKHZhbHVlKSA8PSBQb2x5bm9taWFsLlRPTEVSQU5DRSApIHtcbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKCB2YWx1ZSAqIG1pblZhbHVlIDwgMCApIHtcbiAgICAgICAgICAgICAgICBtYXggPSByZXN1bHQ7XG4gICAgICAgICAgICAgICAgbWF4VmFsdWUgPSB2YWx1ZTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgbWluID0gcmVzdWx0O1xuICAgICAgICAgICAgICAgIG1pblZhbHVlID0gdmFsdWU7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gcmVzdWx0O1xufTtcblxuXG4vKipcbiAqICB0b1N0cmluZ1xuICovXG5Qb2x5bm9taWFsLnByb3RvdHlwZS50b1N0cmluZyA9IGZ1bmN0aW9uKCkge1xuICAgIHZhciBjb2VmcyA9IG5ldyBBcnJheSgpO1xuICAgIHZhciBzaWducyA9IG5ldyBBcnJheSgpO1xuXG4gICAgZm9yICggdmFyIGkgPSB0aGlzLmNvZWZzLmxlbmd0aCAtIDE7IGkgPj0gMDsgaS0tICkge1xuICAgICAgICB2YXIgdmFsdWUgPSBNYXRoLnJvdW5kKHRoaXMuY29lZnNbaV0qMTAwMCkvMTAwMDtcbiAgICAgICAgLy92YXIgdmFsdWUgPSB0aGlzLmNvZWZzW2ldO1xuXG4gICAgICAgIGlmICggdmFsdWUgIT0gMCApIHtcbiAgICAgICAgICAgIHZhciBzaWduID0gKCB2YWx1ZSA8IDAgKSA/IFwiIC0gXCIgOiBcIiArIFwiO1xuXG4gICAgICAgICAgICB2YWx1ZSA9IE1hdGguYWJzKHZhbHVlKTtcbiAgICAgICAgICAgIGlmICggaSA+IDAgKVxuICAgICAgICAgICAgICAgIGlmICggdmFsdWUgPT0gMSApXG4gICAgICAgICAgICAgICAgICAgIHZhbHVlID0gdGhpcy5fdmFyaWFibGU7XG4gICAgICAgICAgICAgICAgZWxzZVxuICAgICAgICAgICAgICAgICAgICB2YWx1ZSArPSB0aGlzLl92YXJpYWJsZTtcbiAgICAgICAgICAgIGlmICggaSA+IDEgKSB2YWx1ZSArPSBcIl5cIiArIGk7XG5cbiAgICAgICAgICAgIHNpZ25zLnB1c2goIHNpZ24gKTtcbiAgICAgICAgICAgIGNvZWZzLnB1c2goIHZhbHVlICk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBzaWduc1swXSA9ICggc2lnbnNbMF0gPT0gXCIgKyBcIiApID8gXCJcIiA6IFwiLVwiO1xuXG4gICAgdmFyIHJlc3VsdCA9IFwiXCI7XG4gICAgZm9yICggdmFyIGkgPSAwOyBpIDwgY29lZnMubGVuZ3RoOyBpKysgKVxuICAgICAgICByZXN1bHQgKz0gc2lnbnNbaV0gKyBjb2Vmc1tpXTtcblxuICAgIHJldHVybiByZXN1bHQ7XG59O1xuXG5cbi8qKlxuICogIHRyYXBlem9pZFxuICogIEJhc2VkIG9uIHRyYXB6ZCBpbiBcIk51bWVyaWNhbCBSZWNpcGVzIGluIENcIiwgcGFnZSAxMzdcbiAqL1xuUG9seW5vbWlhbC5wcm90b3R5cGUudHJhcGV6b2lkID0gZnVuY3Rpb24obWluLCBtYXgsIG4pIHtcbiAgICBpZiAoIGlzTmFOKG1pbikgfHwgaXNOYU4obWF4KSB8fCBpc05hTihuKSApXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcIlBvbHlub21pYWwudHJhcGV6b2lkOiBwYXJhbWV0ZXJzIG11c3QgYmUgbnVtYmVyc1wiKTtcblxuICAgIHZhciByYW5nZSA9IG1heCAtIG1pbjtcbiAgICB2YXIgVE9MRVJBTkNFID0gMWUtNztcblxuICAgIGlmICggbiA9PSAxICkge1xuICAgICAgICB2YXIgbWluVmFsdWUgPSB0aGlzLmV2YWwobWluKTtcbiAgICAgICAgdmFyIG1heFZhbHVlID0gdGhpcy5ldmFsKG1heCk7XG4gICAgICAgIHRoaXMuX3MgPSAwLjUqcmFuZ2UqKCBtaW5WYWx1ZSArIG1heFZhbHVlICk7XG4gICAgfSBlbHNlIHtcbiAgICAgICAgdmFyIGl0ID0gMSA8PCAobi0yKTtcbiAgICAgICAgdmFyIGRlbHRhID0gcmFuZ2UgLyBpdDtcbiAgICAgICAgdmFyIHggPSBtaW4gKyAwLjUqZGVsdGE7XG4gICAgICAgIHZhciBzdW0gPSAwO1xuXG4gICAgICAgIGZvciAoIHZhciBpID0gMDsgaSA8IGl0OyBpKysgKSB7XG4gICAgICAgICAgICBzdW0gKz0gdGhpcy5ldmFsKHgpO1xuICAgICAgICAgICAgeCArPSBkZWx0YTtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLl9zID0gMC41Kih0aGlzLl9zICsgcmFuZ2Uqc3VtL2l0KTtcbiAgICB9XG5cbiAgICBpZiAoIGlzTmFOKHRoaXMuX3MpIClcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiUG9seW5vbWlhbC50cmFwZXpvaWQ6IHRoaXMuX3MgaXMgTmFOXCIpO1xuXG4gICAgcmV0dXJuIHRoaXMuX3M7XG59O1xuXG5cbi8qKlxuICogIHNpbXBzb25cbiAqICBCYXNlZCBvbiB0cmFwemQgaW4gXCJOdW1lcmljYWwgUmVjaXBlcyBpbiBDXCIsIHBhZ2UgMTM5XG4gKi9cblBvbHlub21pYWwucHJvdG90eXBlLnNpbXBzb24gPSBmdW5jdGlvbihtaW4sIG1heCkge1xuICAgIGlmICggaXNOYU4obWluKSB8fCBpc05hTihtYXgpIClcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiUG9seW5vbWlhbC5zaW1wc29uOiBwYXJhbWV0ZXJzIG11c3QgYmUgbnVtYmVyc1wiKTtcblxuICAgIHZhciByYW5nZSA9IG1heCAtIG1pbjtcbiAgICB2YXIgc3QgPSAwLjUgKiByYW5nZSAqICggdGhpcy5ldmFsKG1pbikgKyB0aGlzLmV2YWwobWF4KSApO1xuICAgIHZhciB0ID0gc3Q7XG4gICAgdmFyIHMgPSA0LjAqc3QvMy4wO1xuICAgIHZhciBvcyA9IHM7XG4gICAgdmFyIG9zdCA9IHN0O1xuICAgIHZhciBUT0xFUkFOQ0UgPSAxZS03O1xuXG4gICAgdmFyIGl0ID0gMTtcbiAgICBmb3IgKCB2YXIgbiA9IDI7IG4gPD0gMjA7IG4rKyApIHtcbiAgICAgICAgdmFyIGRlbHRhID0gcmFuZ2UgLyBpdDtcbiAgICAgICAgdmFyIHggICAgID0gbWluICsgMC41KmRlbHRhO1xuICAgICAgICB2YXIgc3VtICAgPSAwO1xuXG4gICAgICAgIGZvciAoIHZhciBpID0gMTsgaSA8PSBpdDsgaSsrICkge1xuICAgICAgICAgICAgc3VtICs9IHRoaXMuZXZhbCh4KTtcbiAgICAgICAgICAgIHggKz0gZGVsdGE7XG4gICAgICAgIH1cblxuICAgICAgICB0ID0gMC41ICogKHQgKyByYW5nZSAqIHN1bSAvIGl0KTtcbiAgICAgICAgc3QgPSB0O1xuICAgICAgICBzID0gKDQuMCpzdCAtIG9zdCkvMy4wO1xuXG4gICAgICAgIGlmICggTWF0aC5hYnMocy1vcykgPCBUT0xFUkFOQ0UqTWF0aC5hYnMob3MpIClcbiAgICAgICAgICAgIGJyZWFrO1xuXG4gICAgICAgIG9zID0gcztcbiAgICAgICAgb3N0ID0gc3Q7XG4gICAgICAgIGl0IDw8PSAxO1xuICAgIH1cblxuICAgIHJldHVybiBzO1xufTtcblxuXG4vKipcbiAqICByb21iZXJnXG4gKi9cblBvbHlub21pYWwucHJvdG90eXBlLnJvbWJlcmcgPSBmdW5jdGlvbihtaW4sIG1heCkge1xuICAgIGlmICggaXNOYU4obWluKSB8fCBpc05hTihtYXgpIClcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiUG9seW5vbWlhbC5yb21iZXJnOiBwYXJhbWV0ZXJzIG11c3QgYmUgbnVtYmVyc1wiKTtcblxuICAgIHZhciBNQVggPSAyMDtcbiAgICB2YXIgSyA9IDM7XG4gICAgdmFyIFRPTEVSQU5DRSA9IDFlLTY7XG4gICAgdmFyIHMgPSBuZXcgQXJyYXkoTUFYKzEpO1xuICAgIHZhciBoID0gbmV3IEFycmF5KE1BWCsxKTtcbiAgICB2YXIgcmVzdWx0ID0geyB5OiAwLCBkeTogMCB9O1xuXG4gICAgaFswXSA9IDEuMDtcbiAgICBmb3IgKCB2YXIgaiA9IDE7IGogPD0gTUFYOyBqKysgKSB7XG4gICAgICAgIHNbai0xXSA9IHRoaXMudHJhcGV6b2lkKG1pbiwgbWF4LCBqKTtcbiAgICAgICAgaWYgKCBqID49IEsgKSB7XG4gICAgICAgICAgICByZXN1bHQgPSBQb2x5bm9taWFsLmludGVycG9sYXRlKGgsIHMsIEssIGotSywgMC4wKTtcbiAgICAgICAgICAgIGlmICggTWF0aC5hYnMocmVzdWx0LmR5KSA8PSBUT0xFUkFOQ0UqcmVzdWx0LnkpIGJyZWFrO1xuICAgICAgICB9XG4gICAgICAgIHNbal0gPSBzW2otMV07XG4gICAgICAgIGhbal0gPSAwLjI1ICogaFtqLTFdO1xuICAgIH1cblxuICAgIHJldHVybiByZXN1bHQueTtcbn07XG5cbi8vIGdldHRlcnMgYW5kIHNldHRlcnNcblxuLyoqXG4gKiAgZ2V0IGRlZ3JlZVxuICovXG5Qb2x5bm9taWFsLnByb3RvdHlwZS5nZXREZWdyZWUgPSBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gdGhpcy5jb2Vmcy5sZW5ndGggLSAxO1xufTtcblxuXG4vKipcbiAqICBnZXREZXJpdmF0aXZlXG4gKi9cblBvbHlub21pYWwucHJvdG90eXBlLmdldERlcml2YXRpdmUgPSBmdW5jdGlvbigpIHtcbiAgICB2YXIgZGVyaXZhdGl2ZSA9IG5ldyBQb2x5bm9taWFsKCk7XG5cbiAgICBmb3IgKCB2YXIgaSA9IDE7IGkgPCB0aGlzLmNvZWZzLmxlbmd0aDsgaSsrICkge1xuICAgICAgICBkZXJpdmF0aXZlLmNvZWZzLnB1c2goaSp0aGlzLmNvZWZzW2ldKTtcbiAgICB9XG5cbiAgICByZXR1cm4gZGVyaXZhdGl2ZTtcbn07XG5cblxuLyoqXG4gKiAgZ2V0Um9vdHNcbiAqL1xuUG9seW5vbWlhbC5wcm90b3R5cGUuZ2V0Um9vdHMgPSBmdW5jdGlvbigpIHtcbiAgICB2YXIgcmVzdWx0O1xuXG4gICAgdGhpcy5zaW1wbGlmeSgpO1xuICAgIHN3aXRjaCAoIHRoaXMuZ2V0RGVncmVlKCkgKSB7XG4gICAgICAgIGNhc2UgMDogcmVzdWx0ID0gbmV3IEFycmF5KCk7ICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgY2FzZSAxOiByZXN1bHQgPSB0aGlzLmdldExpbmVhclJvb3QoKTsgICAgIGJyZWFrO1xuICAgICAgICBjYXNlIDI6IHJlc3VsdCA9IHRoaXMuZ2V0UXVhZHJhdGljUm9vdHMoKTsgYnJlYWs7XG4gICAgICAgIGNhc2UgMzogcmVzdWx0ID0gdGhpcy5nZXRDdWJpY1Jvb3RzKCk7ICAgICBicmVhaztcbiAgICAgICAgY2FzZSA0OiByZXN1bHQgPSB0aGlzLmdldFF1YXJ0aWNSb290cygpOyAgIGJyZWFrO1xuICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgcmVzdWx0ID0gbmV3IEFycmF5KCk7XG4gICAgICAgICAgICAvLyBzaG91bGQgdHJ5IE5ld3RvbidzIG1ldGhvZCBhbmQvb3IgYmlzZWN0aW9uXG4gICAgfVxuXG4gICAgcmV0dXJuIHJlc3VsdDtcbn07XG5cblxuLyoqXG4gKiAgZ2V0Um9vdHNJbkludGVydmFsXG4gKi9cblBvbHlub21pYWwucHJvdG90eXBlLmdldFJvb3RzSW5JbnRlcnZhbCA9IGZ1bmN0aW9uKG1pbiwgbWF4KSB7XG4gICAgdmFyIHJvb3RzID0gbmV3IEFycmF5KCk7XG4gICAgdmFyIHJvb3Q7XG5cbiAgICBpZiAoIHRoaXMuZ2V0RGVncmVlKCkgPT0gMSApIHtcbiAgICAgICAgcm9vdCA9IHRoaXMuYmlzZWN0aW9uKG1pbiwgbWF4KTtcbiAgICAgICAgaWYgKCByb290ICE9IG51bGwgKSByb290cy5wdXNoKHJvb3QpO1xuICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIGdldCByb290cyBvZiBkZXJpdmF0aXZlXG4gICAgICAgIHZhciBkZXJpdiAgPSB0aGlzLmdldERlcml2YXRpdmUoKTtcbiAgICAgICAgdmFyIGRyb290cyA9IGRlcml2LmdldFJvb3RzSW5JbnRlcnZhbChtaW4sIG1heCk7XG5cbiAgICAgICAgaWYgKCBkcm9vdHMubGVuZ3RoID4gMCApIHtcbiAgICAgICAgICAgIC8vIGZpbmQgcm9vdCBvbiBbbWluLCBkcm9vdHNbMF1dXG4gICAgICAgICAgICByb290ID0gdGhpcy5iaXNlY3Rpb24obWluLCBkcm9vdHNbMF0pO1xuICAgICAgICAgICAgaWYgKCByb290ICE9IG51bGwgKSByb290cy5wdXNoKHJvb3QpO1xuXG4gICAgICAgICAgICAvLyBmaW5kIHJvb3Qgb24gW2Ryb290c1tpXSxkcm9vdHNbaSsxXV0gZm9yIDAgPD0gaSA8PSBjb3VudC0yXG4gICAgICAgICAgICBmb3IgKCBpID0gMDsgaSA8PSBkcm9vdHMubGVuZ3RoLTI7IGkrKyApIHtcbiAgICAgICAgICAgICAgICByb290ID0gdGhpcy5iaXNlY3Rpb24oZHJvb3RzW2ldLCBkcm9vdHNbaSsxXSk7XG4gICAgICAgICAgICAgICAgaWYgKCByb290ICE9IG51bGwgKSByb290cy5wdXNoKHJvb3QpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBmaW5kIHJvb3Qgb24gW2Ryb290c1tjb3VudC0xXSx4bWF4XVxuICAgICAgICAgICAgcm9vdCA9IHRoaXMuYmlzZWN0aW9uKGRyb290c1tkcm9vdHMubGVuZ3RoLTFdLCBtYXgpO1xuICAgICAgICAgICAgaWYgKCByb290ICE9IG51bGwgKSByb290cy5wdXNoKHJvb3QpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgLy8gcG9seW5vbWlhbCBpcyBtb25vdG9uZSBvbiBbbWluLG1heF0sIGhhcyBhdCBtb3N0IG9uZSByb290XG4gICAgICAgICAgICByb290ID0gdGhpcy5iaXNlY3Rpb24obWluLCBtYXgpO1xuICAgICAgICAgICAgaWYgKCByb290ICE9IG51bGwgKSByb290cy5wdXNoKHJvb3QpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHJvb3RzO1xufTtcblxuXG4vKipcbiAqICBnZXRMaW5lYXJSb290XG4gKi9cblBvbHlub21pYWwucHJvdG90eXBlLmdldExpbmVhclJvb3QgPSBmdW5jdGlvbigpIHtcbiAgICB2YXIgcmVzdWx0ID0gbmV3IEFycmF5KCk7XG4gICAgdmFyIGEgPSB0aGlzLmNvZWZzWzFdO1xuXG4gICAgaWYgKCBhICE9IDAgKVxuICAgICAgICByZXN1bHQucHVzaCggLXRoaXMuY29lZnNbMF0gLyBhICk7XG5cbiAgICByZXR1cm4gcmVzdWx0O1xufTtcblxuXG4vKipcbiAqICBnZXRRdWFkcmF0aWNSb290c1xuICovXG5Qb2x5bm9taWFsLnByb3RvdHlwZS5nZXRRdWFkcmF0aWNSb290cyA9IGZ1bmN0aW9uKCkge1xuICAgIHZhciByZXN1bHRzID0gbmV3IEFycmF5KCk7XG5cbiAgICBpZiAoIHRoaXMuZ2V0RGVncmVlKCkgPT0gMiApIHtcbiAgICAgICAgdmFyIGEgPSB0aGlzLmNvZWZzWzJdO1xuICAgICAgICB2YXIgYiA9IHRoaXMuY29lZnNbMV0gLyBhO1xuICAgICAgICB2YXIgYyA9IHRoaXMuY29lZnNbMF0gLyBhO1xuICAgICAgICB2YXIgZCA9IGIqYiAtIDQqYztcblxuICAgICAgICBpZiAoIGQgPiAwICkge1xuICAgICAgICAgICAgdmFyIGUgPSBNYXRoLnNxcnQoZCk7XG5cbiAgICAgICAgICAgIHJlc3VsdHMucHVzaCggMC41ICogKC1iICsgZSkgKTtcbiAgICAgICAgICAgIHJlc3VsdHMucHVzaCggMC41ICogKC1iIC0gZSkgKTtcbiAgICAgICAgfSBlbHNlIGlmICggZCA9PSAwICkge1xuICAgICAgICAgICAgLy8gcmVhbGx5IHR3byByb290cyB3aXRoIHNhbWUgdmFsdWUsIGJ1dCB3ZSBvbmx5IHJldHVybiBvbmVcbiAgICAgICAgICAgIHJlc3VsdHMucHVzaCggMC41ICogLWIgKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiByZXN1bHRzO1xufTtcblxuXG4vKipcbiAqICBnZXRDdWJpY1Jvb3RzXG4gKlxuICogIFRoaXMgY29kZSBpcyBiYXNlZCBvbiBNZ2NQb2x5bm9taWFsLmNwcCB3cml0dGVuIGJ5IERhdmlkIEViZXJseS4gIEhpc1xuICogIGNvZGUgYWxvbmcgd2l0aCBtYW55IG90aGVyIGV4Y2VsbGVudCBleGFtcGxlcyBhcmUgYXZhaWFibGUgYXQgaGlzIHNpdGU6XG4gKiAgaHR0cDovL3d3dy5tYWdpYy1zb2Z0d2FyZS5jb21cbiAqL1xuUG9seW5vbWlhbC5wcm90b3R5cGUuZ2V0Q3ViaWNSb290cyA9IGZ1bmN0aW9uKCkge1xuICAgIHZhciByZXN1bHRzID0gbmV3IEFycmF5KCk7XG5cbiAgICBpZiAoIHRoaXMuZ2V0RGVncmVlKCkgPT0gMyApIHtcbiAgICAgICAgdmFyIGMzID0gdGhpcy5jb2Vmc1szXTtcbiAgICAgICAgdmFyIGMyID0gdGhpcy5jb2Vmc1syXSAvIGMzO1xuICAgICAgICB2YXIgYzEgPSB0aGlzLmNvZWZzWzFdIC8gYzM7XG4gICAgICAgIHZhciBjMCA9IHRoaXMuY29lZnNbMF0gLyBjMztcblxuICAgICAgICB2YXIgYSAgICAgICA9ICgzKmMxIC0gYzIqYzIpIC8gMztcbiAgICAgICAgdmFyIGIgICAgICAgPSAoMipjMipjMipjMiAtIDkqYzEqYzIgKyAyNypjMCkgLyAyNztcbiAgICAgICAgdmFyIG9mZnNldCAgPSBjMiAvIDM7XG4gICAgICAgIHZhciBkaXNjcmltID0gYipiLzQgKyBhKmEqYS8yNztcbiAgICAgICAgdmFyIGhhbGZCICAgPSBiIC8gMjtcblxuICAgICAgICBpZiAoIE1hdGguYWJzKGRpc2NyaW0pIDw9IFBvbHlub21pYWwuVE9MRVJBTkNFICkgZGlzY3JpbSA9IDA7XG5cbiAgICAgICAgaWYgKCBkaXNjcmltID4gMCApIHtcbiAgICAgICAgICAgIHZhciBlID0gTWF0aC5zcXJ0KGRpc2NyaW0pO1xuICAgICAgICAgICAgdmFyIHRtcDtcbiAgICAgICAgICAgIHZhciByb290O1xuXG4gICAgICAgICAgICB0bXAgPSAtaGFsZkIgKyBlO1xuICAgICAgICAgICAgaWYgKCB0bXAgPj0gMCApXG4gICAgICAgICAgICAgICAgcm9vdCA9IE1hdGgucG93KHRtcCwgMS8zKTtcbiAgICAgICAgICAgIGVsc2VcbiAgICAgICAgICAgICAgICByb290ID0gLU1hdGgucG93KC10bXAsIDEvMyk7XG5cbiAgICAgICAgICAgIHRtcCA9IC1oYWxmQiAtIGU7XG4gICAgICAgICAgICBpZiAoIHRtcCA+PSAwIClcbiAgICAgICAgICAgICAgICByb290ICs9IE1hdGgucG93KHRtcCwgMS8zKTtcbiAgICAgICAgICAgIGVsc2VcbiAgICAgICAgICAgICAgICByb290IC09IE1hdGgucG93KC10bXAsIDEvMyk7XG5cbiAgICAgICAgICAgIHJlc3VsdHMucHVzaCggcm9vdCAtIG9mZnNldCApO1xuICAgICAgICB9IGVsc2UgaWYgKCBkaXNjcmltIDwgMCApIHtcbiAgICAgICAgICAgIHZhciBkaXN0YW5jZSA9IE1hdGguc3FydCgtYS8zKTtcbiAgICAgICAgICAgIHZhciBhbmdsZSAgICA9IE1hdGguYXRhbjIoIE1hdGguc3FydCgtZGlzY3JpbSksIC1oYWxmQikgLyAzO1xuICAgICAgICAgICAgdmFyIGNvcyAgICAgID0gTWF0aC5jb3MoYW5nbGUpO1xuICAgICAgICAgICAgdmFyIHNpbiAgICAgID0gTWF0aC5zaW4oYW5nbGUpO1xuICAgICAgICAgICAgdmFyIHNxcnQzICAgID0gTWF0aC5zcXJ0KDMpO1xuXG4gICAgICAgICAgICByZXN1bHRzLnB1c2goIDIqZGlzdGFuY2UqY29zIC0gb2Zmc2V0ICk7XG4gICAgICAgICAgICByZXN1bHRzLnB1c2goIC1kaXN0YW5jZSAqIChjb3MgKyBzcXJ0MyAqIHNpbikgLSBvZmZzZXQpO1xuICAgICAgICAgICAgcmVzdWx0cy5wdXNoKCAtZGlzdGFuY2UgKiAoY29zIC0gc3FydDMgKiBzaW4pIC0gb2Zmc2V0KTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHZhciB0bXA7XG5cbiAgICAgICAgICAgIGlmICggaGFsZkIgPj0gMCApXG4gICAgICAgICAgICAgICAgdG1wID0gLU1hdGgucG93KGhhbGZCLCAxLzMpO1xuICAgICAgICAgICAgZWxzZVxuICAgICAgICAgICAgICAgIHRtcCA9IE1hdGgucG93KC1oYWxmQiwgMS8zKTtcblxuICAgICAgICAgICAgcmVzdWx0cy5wdXNoKCAyKnRtcCAtIG9mZnNldCApO1xuICAgICAgICAgICAgLy8gcmVhbGx5IHNob3VsZCByZXR1cm4gbmV4dCByb290IHR3aWNlLCBidXQgd2UgcmV0dXJuIG9ubHkgb25lXG4gICAgICAgICAgICByZXN1bHRzLnB1c2goIC10bXAgLSBvZmZzZXQgKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiByZXN1bHRzO1xufTtcblxuXG4vKipcbiAqICBnZXRRdWFydGljUm9vdHNcbiAqXG4gKiAgVGhpcyBjb2RlIGlzIGJhc2VkIG9uIE1nY1BvbHlub21pYWwuY3BwIHdyaXR0ZW4gYnkgRGF2aWQgRWJlcmx5LiAgSGlzXG4gKiAgY29kZSBhbG9uZyB3aXRoIG1hbnkgb3RoZXIgZXhjZWxsZW50IGV4YW1wbGVzIGFyZSBhdmFpYWJsZSBhdCBoaXMgc2l0ZTpcbiAqICBodHRwOi8vd3d3Lm1hZ2ljLXNvZnR3YXJlLmNvbVxuICovXG5Qb2x5bm9taWFsLnByb3RvdHlwZS5nZXRRdWFydGljUm9vdHMgPSBmdW5jdGlvbigpIHtcbiAgICB2YXIgcmVzdWx0cyA9IG5ldyBBcnJheSgpO1xuXG4gICAgaWYgKCB0aGlzLmdldERlZ3JlZSgpID09IDQgKSB7XG4gICAgICAgIHZhciBjNCA9IHRoaXMuY29lZnNbNF07XG4gICAgICAgIHZhciBjMyA9IHRoaXMuY29lZnNbM10gLyBjNDtcbiAgICAgICAgdmFyIGMyID0gdGhpcy5jb2Vmc1syXSAvIGM0O1xuICAgICAgICB2YXIgYzEgPSB0aGlzLmNvZWZzWzFdIC8gYzQ7XG4gICAgICAgIHZhciBjMCA9IHRoaXMuY29lZnNbMF0gLyBjNDtcblxuICAgICAgICB2YXIgcmVzb2x2ZVJvb3RzID0gbmV3IFBvbHlub21pYWwoXG4gICAgICAgICAgICAxLCAtYzIsIGMzKmMxIC0gNCpjMCwgLWMzKmMzKmMwICsgNCpjMipjMCAtYzEqYzFcbiAgICAgICAgKS5nZXRDdWJpY1Jvb3RzKCk7XG4gICAgICAgIHZhciB5ICAgICAgID0gcmVzb2x2ZVJvb3RzWzBdO1xuICAgICAgICB2YXIgZGlzY3JpbSA9IGMzKmMzLzQgLSBjMiArIHk7XG5cbiAgICAgICAgaWYgKCBNYXRoLmFicyhkaXNjcmltKSA8PSBQb2x5bm9taWFsLlRPTEVSQU5DRSApIGRpc2NyaW0gPSAwO1xuXG4gICAgICAgIGlmICggZGlzY3JpbSA+IDAgKSB7XG4gICAgICAgICAgICB2YXIgZSAgICAgPSBNYXRoLnNxcnQoZGlzY3JpbSk7XG4gICAgICAgICAgICB2YXIgdDEgICAgPSAzKmMzKmMzLzQgLSBlKmUgLSAyKmMyO1xuICAgICAgICAgICAgdmFyIHQyICAgID0gKCA0KmMzKmMyIC0gOCpjMSAtIGMzKmMzKmMzICkgLyAoIDQqZSApO1xuICAgICAgICAgICAgdmFyIHBsdXMgID0gdDErdDI7XG4gICAgICAgICAgICB2YXIgbWludXMgPSB0MS10MjtcblxuICAgICAgICAgICAgaWYgKCBNYXRoLmFicyhwbHVzKSAgPD0gUG9seW5vbWlhbC5UT0xFUkFOQ0UgKSBwbHVzICA9IDA7XG4gICAgICAgICAgICBpZiAoIE1hdGguYWJzKG1pbnVzKSA8PSBQb2x5bm9taWFsLlRPTEVSQU5DRSApIG1pbnVzID0gMDtcblxuICAgICAgICAgICAgaWYgKCBwbHVzID49IDAgKSB7XG4gICAgICAgICAgICAgICAgdmFyIGYgPSBNYXRoLnNxcnQocGx1cyk7XG5cbiAgICAgICAgICAgICAgICByZXN1bHRzLnB1c2goIC1jMy80ICsgKGUrZikvMiApO1xuICAgICAgICAgICAgICAgIHJlc3VsdHMucHVzaCggLWMzLzQgKyAoZS1mKS8yICk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoIG1pbnVzID49IDAgKSB7XG4gICAgICAgICAgICAgICAgdmFyIGYgPSBNYXRoLnNxcnQobWludXMpO1xuXG4gICAgICAgICAgICAgICAgcmVzdWx0cy5wdXNoKCAtYzMvNCArIChmLWUpLzIgKTtcbiAgICAgICAgICAgICAgICByZXN1bHRzLnB1c2goIC1jMy80IC0gKGYrZSkvMiApO1xuICAgICAgICAgICAgfVxuICAgICAgICB9IGVsc2UgaWYgKCBkaXNjcmltIDwgMCApIHtcbiAgICAgICAgICAgIC8vIG5vIHJvb3RzXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB2YXIgdDIgPSB5KnkgLSA0KmMwO1xuXG4gICAgICAgICAgICBpZiAoIHQyID49IC1Qb2x5bm9taWFsLlRPTEVSQU5DRSApIHtcbiAgICAgICAgICAgICAgICBpZiAoIHQyIDwgMCApIHQyID0gMDtcblxuICAgICAgICAgICAgICAgIHQyID0gMipNYXRoLnNxcnQodDIpO1xuICAgICAgICAgICAgICAgIHQxID0gMypjMypjMy80IC0gMipjMjtcbiAgICAgICAgICAgICAgICBpZiAoIHQxK3QyID49IFBvbHlub21pYWwuVE9MRVJBTkNFICkge1xuICAgICAgICAgICAgICAgICAgICB2YXIgZCA9IE1hdGguc3FydCh0MSt0Mik7XG5cbiAgICAgICAgICAgICAgICAgICAgcmVzdWx0cy5wdXNoKCAtYzMvNCArIGQvMiApO1xuICAgICAgICAgICAgICAgICAgICByZXN1bHRzLnB1c2goIC1jMy80IC0gZC8yICk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGlmICggdDEtdDIgPj0gUG9seW5vbWlhbC5UT0xFUkFOQ0UgKSB7XG4gICAgICAgICAgICAgICAgICAgIHZhciBkID0gTWF0aC5zcXJ0KHQxLXQyKTtcblxuICAgICAgICAgICAgICAgICAgICByZXN1bHRzLnB1c2goIC1jMy80ICsgZC8yICk7XG4gICAgICAgICAgICAgICAgICAgIHJlc3VsdHMucHVzaCggLWMzLzQgLSBkLzIgKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gcmVzdWx0cztcbn07XG5cbmlmICh0eXBlb2YgbW9kdWxlICE9PSBcInVuZGVmaW5lZFwiKSB7XG4gICAgbW9kdWxlLmV4cG9ydHMgPSBQb2x5bm9taWFsO1xufVxuIiwiLyoqXG4gKlxuICogICBTcXJ0UG9seW5vbWlhbC5qc1xuICpcbiAqICAgY29weXJpZ2h0IDIwMDMsIDIwMTMgS2V2aW4gTGluZHNleVxuICpcbiAqL1xuXG5pZiAodHlwZW9mIG1vZHVsZSAhPT0gXCJ1bmRlZmluZWRcIikge1xuICAgIHZhciBQb2x5bm9taWFsID0gcmVxdWlyZShcIi4vUG9seW5vbWlhbFwiKTtcbn1cblxuLyoqXG4gKiAgIGNsYXNzIHZhcmlhYmxlc1xuICovXG5TcXJ0UG9seW5vbWlhbC5WRVJTSU9OID0gMS4wO1xuXG4vLyBzZXR1cCBpbmhlcml0YW5jZVxuU3FydFBvbHlub21pYWwucHJvdG90eXBlICAgICAgICAgICAgID0gbmV3IFBvbHlub21pYWwoKTtcblNxcnRQb2x5bm9taWFsLnByb3RvdHlwZS5jb25zdHJ1Y3RvciA9IFNxcnRQb2x5bm9taWFsO1xuU3FydFBvbHlub21pYWwuc3VwZXJjbGFzcyAgICAgICAgICAgID0gUG9seW5vbWlhbC5wcm90b3R5cGU7XG5cblxuLyoqXG4gKiAgU3FydFBvbHlub21pYWxcbiAqL1xuZnVuY3Rpb24gU3FydFBvbHlub21pYWwoKSB7XG4gICAgdGhpcy5pbml0KCBhcmd1bWVudHMgKTtcbn1cblxuXG4vKipcbiAqICBldmFsXG4gKlxuICogIEBwYXJhbSB7TnVtYmVyfSB4XG4gKiAgQHJldHVybnMge051bWJlcn1cbiAqL1xuU3FydFBvbHlub21pYWwucHJvdG90eXBlLmV2YWwgPSBmdW5jdGlvbih4KSB7XG4gICAgdmFyIFRPTEVSQU5DRSA9IDFlLTc7XG4gICAgdmFyIHJlc3VsdCA9IFNxcnRQb2x5bm9taWFsLnN1cGVyY2xhc3MuZXZhbC5jYWxsKHRoaXMsIHgpO1xuXG4gICAgLy8gTk9URTogTWF5IG5lZWQgdG8gY2hhbmdlIHRoZSBmb2xsb3dpbmcuICBJIGFkZGVkIHRoZXNlIHRvIGNhcHR1cmVcbiAgICAvLyBzb21lIHJlYWxseSBzbWFsbCBuZWdhdGl2ZSB2YWx1ZXMgdGhhdCB3ZXJlIGJlaW5nIGdlbmVyYXRlZCBieSBvbmVcbiAgICAvLyBvZiBteSBCZXppZXIgYXJjTGVuZ3RoIGZ1bmN0aW9uc1xuICAgIGlmICggTWF0aC5hYnMocmVzdWx0KSA8IFRPTEVSQU5DRSApIHJlc3VsdCA9IDA7XG4gICAgaWYgKCByZXN1bHQgPCAwIClcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiU3FydFBvbHlub21pYWwuZXZhbDogY2Fubm90IHRha2Ugc3F1YXJlIHJvb3Qgb2YgbmVnYXRpdmUgbnVtYmVyXCIpO1xuXG4gICAgcmV0dXJuIE1hdGguc3FydChyZXN1bHQpO1xufTtcblxuU3FydFBvbHlub21pYWwucHJvdG90eXBlLnRvU3RyaW5nID0gZnVuY3Rpb24oKSB7XG4gICAgdmFyIHJlc3VsdCA9IFNxcnRQb2x5bm9taWFsLnN1cGVyY2xhc3MudG9TdHJpbmcuY2FsbCh0aGlzKTtcblxuICAgIHJldHVybiBcInNxcnQoXCIgKyByZXN1bHQgKyBcIilcIjtcbn07XG5cbmlmICh0eXBlb2YgbW9kdWxlICE9PSBcInVuZGVmaW5lZFwiKSB7XG4gICAgbW9kdWxlLmV4cG9ydHMgPSBTcXJ0UG9seW5vbWlhbDtcbn1cbiIsIi8qXG4gKGMpIDIwMTMsIFZsYWRpbWlyIEFnYWZvbmtpblxuIFJCdXNoLCBhIEphdmFTY3JpcHQgbGlicmFyeSBmb3IgaGlnaC1wZXJmb3JtYW5jZSAyRCBzcGF0aWFsIGluZGV4aW5nIG9mIHBvaW50cyBhbmQgcmVjdGFuZ2xlcy5cbiBodHRwczovL2dpdGh1Yi5jb20vbW91cm5lci9yYnVzaFxuKi9cblxuKGZ1bmN0aW9uICgpIHsgJ3VzZSBzdHJpY3QnO1xuXG5mdW5jdGlvbiByYnVzaChtYXhFbnRyaWVzLCBmb3JtYXQpIHtcblxuICAgIC8vIGpzaGludCBuZXdjYXA6IGZhbHNlLCB2YWxpZHRoaXM6IHRydWVcbiAgICBpZiAoISh0aGlzIGluc3RhbmNlb2YgcmJ1c2gpKSByZXR1cm4gbmV3IHJidXNoKG1heEVudHJpZXMsIGZvcm1hdCk7XG5cbiAgICAvLyBtYXggZW50cmllcyBpbiBhIG5vZGUgaXMgOSBieSBkZWZhdWx0OyBtaW4gbm9kZSBmaWxsIGlzIDQwJSBmb3IgYmVzdCBwZXJmb3JtYW5jZVxuICAgIHRoaXMuX21heEVudHJpZXMgPSBNYXRoLm1heCg0LCBtYXhFbnRyaWVzIHx8IDkpO1xuICAgIHRoaXMuX21pbkVudHJpZXMgPSBNYXRoLm1heCgyLCBNYXRoLmNlaWwodGhpcy5fbWF4RW50cmllcyAqIDAuNCkpO1xuXG4gICAgaWYgKGZvcm1hdCkge1xuICAgICAgICB0aGlzLl9pbml0Rm9ybWF0KGZvcm1hdCk7XG4gICAgfVxuXG4gICAgdGhpcy5jbGVhcigpO1xufVxuXG5yYnVzaC5wcm90b3R5cGUgPSB7XG5cbiAgICBhbGw6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuX2FsbCh0aGlzLmRhdGEsIFtdKTtcbiAgICB9LFxuXG4gICAgc2VhcmNoOiBmdW5jdGlvbiAoYmJveCkge1xuXG4gICAgICAgIHZhciBub2RlID0gdGhpcy5kYXRhLFxuICAgICAgICAgICAgcmVzdWx0ID0gW10sXG4gICAgICAgICAgICB0b0JCb3ggPSB0aGlzLnRvQkJveDtcblxuICAgICAgICBpZiAoIWludGVyc2VjdHMoYmJveCwgbm9kZS5iYm94KSkgcmV0dXJuIHJlc3VsdDtcblxuICAgICAgICB2YXIgbm9kZXNUb1NlYXJjaCA9IFtdLFxuICAgICAgICAgICAgaSwgbGVuLCBjaGlsZCwgY2hpbGRCQm94O1xuXG4gICAgICAgIHdoaWxlIChub2RlKSB7XG4gICAgICAgICAgICBmb3IgKGkgPSAwLCBsZW4gPSBub2RlLmNoaWxkcmVuLmxlbmd0aDsgaSA8IGxlbjsgaSsrKSB7XG5cbiAgICAgICAgICAgICAgICBjaGlsZCA9IG5vZGUuY2hpbGRyZW5baV07XG4gICAgICAgICAgICAgICAgY2hpbGRCQm94ID0gbm9kZS5sZWFmID8gdG9CQm94KGNoaWxkKSA6IGNoaWxkLmJib3g7XG5cbiAgICAgICAgICAgICAgICBpZiAoaW50ZXJzZWN0cyhiYm94LCBjaGlsZEJCb3gpKSB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChub2RlLmxlYWYpIHJlc3VsdC5wdXNoKGNoaWxkKTtcbiAgICAgICAgICAgICAgICAgICAgZWxzZSBpZiAoY29udGFpbnMoYmJveCwgY2hpbGRCQm94KSkgdGhpcy5fYWxsKGNoaWxkLCByZXN1bHQpO1xuICAgICAgICAgICAgICAgICAgICBlbHNlIG5vZGVzVG9TZWFyY2gucHVzaChjaGlsZCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgbm9kZSA9IG5vZGVzVG9TZWFyY2gucG9wKCk7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gcmVzdWx0O1xuICAgIH0sXG5cbiAgICBjb2xsaWRlczogZnVuY3Rpb24gKGJib3gpIHtcblxuICAgICAgICB2YXIgbm9kZSA9IHRoaXMuZGF0YSxcbiAgICAgICAgICAgIHRvQkJveCA9IHRoaXMudG9CQm94O1xuXG4gICAgICAgIGlmICghaW50ZXJzZWN0cyhiYm94LCBub2RlLmJib3gpKSByZXR1cm4gZmFsc2U7XG5cbiAgICAgICAgdmFyIG5vZGVzVG9TZWFyY2ggPSBbXSxcbiAgICAgICAgICAgIGksIGxlbiwgY2hpbGQsIGNoaWxkQkJveDtcblxuICAgICAgICB3aGlsZSAobm9kZSkge1xuICAgICAgICAgICAgZm9yIChpID0gMCwgbGVuID0gbm9kZS5jaGlsZHJlbi5sZW5ndGg7IGkgPCBsZW47IGkrKykge1xuXG4gICAgICAgICAgICAgICAgY2hpbGQgPSBub2RlLmNoaWxkcmVuW2ldO1xuICAgICAgICAgICAgICAgIGNoaWxkQkJveCA9IG5vZGUubGVhZiA/IHRvQkJveChjaGlsZCkgOiBjaGlsZC5iYm94O1xuXG4gICAgICAgICAgICAgICAgaWYgKGludGVyc2VjdHMoYmJveCwgY2hpbGRCQm94KSkge1xuICAgICAgICAgICAgICAgICAgICBpZiAobm9kZS5sZWFmIHx8IGNvbnRhaW5zKGJib3gsIGNoaWxkQkJveCkpIHJldHVybiB0cnVlO1xuICAgICAgICAgICAgICAgICAgICBub2Rlc1RvU2VhcmNoLnB1c2goY2hpbGQpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIG5vZGUgPSBub2Rlc1RvU2VhcmNoLnBvcCgpO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH0sXG5cbiAgICBsb2FkOiBmdW5jdGlvbiAoZGF0YSkge1xuICAgICAgICBpZiAoIShkYXRhICYmIGRhdGEubGVuZ3RoKSkgcmV0dXJuIHRoaXM7XG5cbiAgICAgICAgaWYgKGRhdGEubGVuZ3RoIDwgdGhpcy5fbWluRW50cmllcykge1xuICAgICAgICAgICAgZm9yICh2YXIgaSA9IDAsIGxlbiA9IGRhdGEubGVuZ3RoOyBpIDwgbGVuOyBpKyspIHtcbiAgICAgICAgICAgICAgICB0aGlzLmluc2VydChkYXRhW2ldKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiB0aGlzO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gcmVjdXJzaXZlbHkgYnVpbGQgdGhlIHRyZWUgd2l0aCB0aGUgZ2l2ZW4gZGF0YSBmcm9tIHN0cmF0Y2ggdXNpbmcgT01UIGFsZ29yaXRobVxuICAgICAgICB2YXIgbm9kZSA9IHRoaXMuX2J1aWxkKGRhdGEuc2xpY2UoKSwgMCwgZGF0YS5sZW5ndGggLSAxLCAwKTtcblxuICAgICAgICBpZiAoIXRoaXMuZGF0YS5jaGlsZHJlbi5sZW5ndGgpIHtcbiAgICAgICAgICAgIC8vIHNhdmUgYXMgaXMgaWYgdHJlZSBpcyBlbXB0eVxuICAgICAgICAgICAgdGhpcy5kYXRhID0gbm9kZTtcblxuICAgICAgICB9IGVsc2UgaWYgKHRoaXMuZGF0YS5oZWlnaHQgPT09IG5vZGUuaGVpZ2h0KSB7XG4gICAgICAgICAgICAvLyBzcGxpdCByb290IGlmIHRyZWVzIGhhdmUgdGhlIHNhbWUgaGVpZ2h0XG4gICAgICAgICAgICB0aGlzLl9zcGxpdFJvb3QodGhpcy5kYXRhLCBub2RlKTtcblxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgaWYgKHRoaXMuZGF0YS5oZWlnaHQgPCBub2RlLmhlaWdodCkge1xuICAgICAgICAgICAgICAgIC8vIHN3YXAgdHJlZXMgaWYgaW5zZXJ0ZWQgb25lIGlzIGJpZ2dlclxuICAgICAgICAgICAgICAgIHZhciB0bXBOb2RlID0gdGhpcy5kYXRhO1xuICAgICAgICAgICAgICAgIHRoaXMuZGF0YSA9IG5vZGU7XG4gICAgICAgICAgICAgICAgbm9kZSA9IHRtcE5vZGU7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIGluc2VydCB0aGUgc21hbGwgdHJlZSBpbnRvIHRoZSBsYXJnZSB0cmVlIGF0IGFwcHJvcHJpYXRlIGxldmVsXG4gICAgICAgICAgICB0aGlzLl9pbnNlcnQobm9kZSwgdGhpcy5kYXRhLmhlaWdodCAtIG5vZGUuaGVpZ2h0IC0gMSwgdHJ1ZSk7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gdGhpcztcbiAgICB9LFxuXG4gICAgaW5zZXJ0OiBmdW5jdGlvbiAoaXRlbSkge1xuICAgICAgICBpZiAoaXRlbSkgdGhpcy5faW5zZXJ0KGl0ZW0sIHRoaXMuZGF0YS5oZWlnaHQgLSAxKTtcbiAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfSxcblxuICAgIGNsZWFyOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHRoaXMuZGF0YSA9IHtcbiAgICAgICAgICAgIGNoaWxkcmVuOiBbXSxcbiAgICAgICAgICAgIGhlaWdodDogMSxcbiAgICAgICAgICAgIGJib3g6IGVtcHR5KCksXG4gICAgICAgICAgICBsZWFmOiB0cnVlXG4gICAgICAgIH07XG4gICAgICAgIHJldHVybiB0aGlzO1xuICAgIH0sXG5cbiAgICByZW1vdmU6IGZ1bmN0aW9uIChpdGVtKSB7XG4gICAgICAgIGlmICghaXRlbSkgcmV0dXJuIHRoaXM7XG5cbiAgICAgICAgdmFyIG5vZGUgPSB0aGlzLmRhdGEsXG4gICAgICAgICAgICBiYm94ID0gdGhpcy50b0JCb3goaXRlbSksXG4gICAgICAgICAgICBwYXRoID0gW10sXG4gICAgICAgICAgICBpbmRleGVzID0gW10sXG4gICAgICAgICAgICBpLCBwYXJlbnQsIGluZGV4LCBnb2luZ1VwO1xuXG4gICAgICAgIC8vIGRlcHRoLWZpcnN0IGl0ZXJhdGl2ZSB0cmVlIHRyYXZlcnNhbFxuICAgICAgICB3aGlsZSAobm9kZSB8fCBwYXRoLmxlbmd0aCkge1xuXG4gICAgICAgICAgICBpZiAoIW5vZGUpIHsgLy8gZ28gdXBcbiAgICAgICAgICAgICAgICBub2RlID0gcGF0aC5wb3AoKTtcbiAgICAgICAgICAgICAgICBwYXJlbnQgPSBwYXRoW3BhdGgubGVuZ3RoIC0gMV07XG4gICAgICAgICAgICAgICAgaSA9IGluZGV4ZXMucG9wKCk7XG4gICAgICAgICAgICAgICAgZ29pbmdVcCA9IHRydWU7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmIChub2RlLmxlYWYpIHsgLy8gY2hlY2sgY3VycmVudCBub2RlXG4gICAgICAgICAgICAgICAgaW5kZXggPSBub2RlLmNoaWxkcmVuLmluZGV4T2YoaXRlbSk7XG5cbiAgICAgICAgICAgICAgICBpZiAoaW5kZXggIT09IC0xKSB7XG4gICAgICAgICAgICAgICAgICAgIC8vIGl0ZW0gZm91bmQsIHJlbW92ZSB0aGUgaXRlbSBhbmQgY29uZGVuc2UgdHJlZSB1cHdhcmRzXG4gICAgICAgICAgICAgICAgICAgIG5vZGUuY2hpbGRyZW4uc3BsaWNlKGluZGV4LCAxKTtcbiAgICAgICAgICAgICAgICAgICAgcGF0aC5wdXNoKG5vZGUpO1xuICAgICAgICAgICAgICAgICAgICB0aGlzLl9jb25kZW5zZShwYXRoKTtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAoIWdvaW5nVXAgJiYgIW5vZGUubGVhZiAmJiBjb250YWlucyhub2RlLmJib3gsIGJib3gpKSB7IC8vIGdvIGRvd25cbiAgICAgICAgICAgICAgICBwYXRoLnB1c2gobm9kZSk7XG4gICAgICAgICAgICAgICAgaW5kZXhlcy5wdXNoKGkpO1xuICAgICAgICAgICAgICAgIGkgPSAwO1xuICAgICAgICAgICAgICAgIHBhcmVudCA9IG5vZGU7XG4gICAgICAgICAgICAgICAgbm9kZSA9IG5vZGUuY2hpbGRyZW5bMF07XG5cbiAgICAgICAgICAgIH0gZWxzZSBpZiAocGFyZW50KSB7IC8vIGdvIHJpZ2h0XG4gICAgICAgICAgICAgICAgaSsrO1xuICAgICAgICAgICAgICAgIG5vZGUgPSBwYXJlbnQuY2hpbGRyZW5baV07XG4gICAgICAgICAgICAgICAgZ29pbmdVcCA9IGZhbHNlO1xuXG4gICAgICAgICAgICB9IGVsc2Ugbm9kZSA9IG51bGw7IC8vIG5vdGhpbmcgZm91bmRcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB0aGlzO1xuICAgIH0sXG5cbiAgICB0b0JCb3g6IGZ1bmN0aW9uIChpdGVtKSB7IHJldHVybiBpdGVtOyB9LFxuXG4gICAgY29tcGFyZU1pblg6IGZ1bmN0aW9uIChhLCBiKSB7IHJldHVybiBhWzBdIC0gYlswXTsgfSxcbiAgICBjb21wYXJlTWluWTogZnVuY3Rpb24gKGEsIGIpIHsgcmV0dXJuIGFbMV0gLSBiWzFdOyB9LFxuXG4gICAgdG9KU09OOiBmdW5jdGlvbiAoKSB7IHJldHVybiB0aGlzLmRhdGE7IH0sXG5cbiAgICBmcm9tSlNPTjogZnVuY3Rpb24gKGRhdGEpIHtcbiAgICAgICAgdGhpcy5kYXRhID0gZGF0YTtcbiAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfSxcblxuICAgIF9hbGw6IGZ1bmN0aW9uIChub2RlLCByZXN1bHQpIHtcbiAgICAgICAgdmFyIG5vZGVzVG9TZWFyY2ggPSBbXTtcbiAgICAgICAgd2hpbGUgKG5vZGUpIHtcbiAgICAgICAgICAgIGlmIChub2RlLmxlYWYpIHJlc3VsdC5wdXNoLmFwcGx5KHJlc3VsdCwgbm9kZS5jaGlsZHJlbik7XG4gICAgICAgICAgICBlbHNlIG5vZGVzVG9TZWFyY2gucHVzaC5hcHBseShub2Rlc1RvU2VhcmNoLCBub2RlLmNoaWxkcmVuKTtcblxuICAgICAgICAgICAgbm9kZSA9IG5vZGVzVG9TZWFyY2gucG9wKCk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICB9LFxuXG4gICAgX2J1aWxkOiBmdW5jdGlvbiAoaXRlbXMsIGxlZnQsIHJpZ2h0LCBoZWlnaHQpIHtcblxuICAgICAgICB2YXIgTiA9IHJpZ2h0IC0gbGVmdCArIDEsXG4gICAgICAgICAgICBNID0gdGhpcy5fbWF4RW50cmllcyxcbiAgICAgICAgICAgIG5vZGU7XG5cbiAgICAgICAgaWYgKE4gPD0gTSkge1xuICAgICAgICAgICAgLy8gcmVhY2hlZCBsZWFmIGxldmVsOyByZXR1cm4gbGVhZlxuICAgICAgICAgICAgbm9kZSA9IHtcbiAgICAgICAgICAgICAgICBjaGlsZHJlbjogaXRlbXMuc2xpY2UobGVmdCwgcmlnaHQgKyAxKSxcbiAgICAgICAgICAgICAgICBoZWlnaHQ6IDEsXG4gICAgICAgICAgICAgICAgYmJveDogbnVsbCxcbiAgICAgICAgICAgICAgICBsZWFmOiB0cnVlXG4gICAgICAgICAgICB9O1xuICAgICAgICAgICAgY2FsY0JCb3gobm9kZSwgdGhpcy50b0JCb3gpO1xuICAgICAgICAgICAgcmV0dXJuIG5vZGU7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoIWhlaWdodCkge1xuICAgICAgICAgICAgLy8gdGFyZ2V0IGhlaWdodCBvZiB0aGUgYnVsay1sb2FkZWQgdHJlZVxuICAgICAgICAgICAgaGVpZ2h0ID0gTWF0aC5jZWlsKE1hdGgubG9nKE4pIC8gTWF0aC5sb2coTSkpO1xuXG4gICAgICAgICAgICAvLyB0YXJnZXQgbnVtYmVyIG9mIHJvb3QgZW50cmllcyB0byBtYXhpbWl6ZSBzdG9yYWdlIHV0aWxpemF0aW9uXG4gICAgICAgICAgICBNID0gTWF0aC5jZWlsKE4gLyBNYXRoLnBvdyhNLCBoZWlnaHQgLSAxKSk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBUT0RPIGVsaW1pbmF0ZSByZWN1cnNpb24/XG5cbiAgICAgICAgbm9kZSA9IHtcbiAgICAgICAgICAgIGNoaWxkcmVuOiBbXSxcbiAgICAgICAgICAgIGhlaWdodDogaGVpZ2h0LFxuICAgICAgICAgICAgYmJveDogbnVsbFxuICAgICAgICB9O1xuXG4gICAgICAgIC8vIHNwbGl0IHRoZSBpdGVtcyBpbnRvIE0gbW9zdGx5IHNxdWFyZSB0aWxlc1xuXG4gICAgICAgIHZhciBOMiA9IE1hdGguY2VpbChOIC8gTSksXG4gICAgICAgICAgICBOMSA9IE4yICogTWF0aC5jZWlsKE1hdGguc3FydChNKSksXG4gICAgICAgICAgICBpLCBqLCByaWdodDIsIHJpZ2h0MztcblxuICAgICAgICBtdWx0aVNlbGVjdChpdGVtcywgbGVmdCwgcmlnaHQsIE4xLCB0aGlzLmNvbXBhcmVNaW5YKTtcblxuICAgICAgICBmb3IgKGkgPSBsZWZ0OyBpIDw9IHJpZ2h0OyBpICs9IE4xKSB7XG5cbiAgICAgICAgICAgIHJpZ2h0MiA9IE1hdGgubWluKGkgKyBOMSAtIDEsIHJpZ2h0KTtcblxuICAgICAgICAgICAgbXVsdGlTZWxlY3QoaXRlbXMsIGksIHJpZ2h0MiwgTjIsIHRoaXMuY29tcGFyZU1pblkpO1xuXG4gICAgICAgICAgICBmb3IgKGogPSBpOyBqIDw9IHJpZ2h0MjsgaiArPSBOMikge1xuXG4gICAgICAgICAgICAgICAgcmlnaHQzID0gTWF0aC5taW4oaiArIE4yIC0gMSwgcmlnaHQyKTtcblxuICAgICAgICAgICAgICAgIC8vIHBhY2sgZWFjaCBlbnRyeSByZWN1cnNpdmVseVxuICAgICAgICAgICAgICAgIG5vZGUuY2hpbGRyZW4ucHVzaCh0aGlzLl9idWlsZChpdGVtcywgaiwgcmlnaHQzLCBoZWlnaHQgLSAxKSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBjYWxjQkJveChub2RlLCB0aGlzLnRvQkJveCk7XG5cbiAgICAgICAgcmV0dXJuIG5vZGU7XG4gICAgfSxcblxuICAgIF9jaG9vc2VTdWJ0cmVlOiBmdW5jdGlvbiAoYmJveCwgbm9kZSwgbGV2ZWwsIHBhdGgpIHtcblxuICAgICAgICB2YXIgaSwgbGVuLCBjaGlsZCwgdGFyZ2V0Tm9kZSwgYXJlYSwgZW5sYXJnZW1lbnQsIG1pbkFyZWEsIG1pbkVubGFyZ2VtZW50O1xuXG4gICAgICAgIHdoaWxlICh0cnVlKSB7XG4gICAgICAgICAgICBwYXRoLnB1c2gobm9kZSk7XG5cbiAgICAgICAgICAgIGlmIChub2RlLmxlYWYgfHwgcGF0aC5sZW5ndGggLSAxID09PSBsZXZlbCkgYnJlYWs7XG5cbiAgICAgICAgICAgIG1pbkFyZWEgPSBtaW5FbmxhcmdlbWVudCA9IEluZmluaXR5O1xuXG4gICAgICAgICAgICBmb3IgKGkgPSAwLCBsZW4gPSBub2RlLmNoaWxkcmVuLmxlbmd0aDsgaSA8IGxlbjsgaSsrKSB7XG4gICAgICAgICAgICAgICAgY2hpbGQgPSBub2RlLmNoaWxkcmVuW2ldO1xuICAgICAgICAgICAgICAgIGFyZWEgPSBiYm94QXJlYShjaGlsZC5iYm94KTtcbiAgICAgICAgICAgICAgICBlbmxhcmdlbWVudCA9IGVubGFyZ2VkQXJlYShiYm94LCBjaGlsZC5iYm94KSAtIGFyZWE7XG5cbiAgICAgICAgICAgICAgICAvLyBjaG9vc2UgZW50cnkgd2l0aCB0aGUgbGVhc3QgYXJlYSBlbmxhcmdlbWVudFxuICAgICAgICAgICAgICAgIGlmIChlbmxhcmdlbWVudCA8IG1pbkVubGFyZ2VtZW50KSB7XG4gICAgICAgICAgICAgICAgICAgIG1pbkVubGFyZ2VtZW50ID0gZW5sYXJnZW1lbnQ7XG4gICAgICAgICAgICAgICAgICAgIG1pbkFyZWEgPSBhcmVhIDwgbWluQXJlYSA/IGFyZWEgOiBtaW5BcmVhO1xuICAgICAgICAgICAgICAgICAgICB0YXJnZXROb2RlID0gY2hpbGQ7XG5cbiAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKGVubGFyZ2VtZW50ID09PSBtaW5FbmxhcmdlbWVudCkge1xuICAgICAgICAgICAgICAgICAgICAvLyBvdGhlcndpc2UgY2hvb3NlIG9uZSB3aXRoIHRoZSBzbWFsbGVzdCBhcmVhXG4gICAgICAgICAgICAgICAgICAgIGlmIChhcmVhIDwgbWluQXJlYSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgbWluQXJlYSA9IGFyZWE7XG4gICAgICAgICAgICAgICAgICAgICAgICB0YXJnZXROb2RlID0gY2hpbGQ7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIG5vZGUgPSB0YXJnZXROb2RlO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIG5vZGU7XG4gICAgfSxcblxuICAgIF9pbnNlcnQ6IGZ1bmN0aW9uIChpdGVtLCBsZXZlbCwgaXNOb2RlKSB7XG5cbiAgICAgICAgdmFyIHRvQkJveCA9IHRoaXMudG9CQm94LFxuICAgICAgICAgICAgYmJveCA9IGlzTm9kZSA/IGl0ZW0uYmJveCA6IHRvQkJveChpdGVtKSxcbiAgICAgICAgICAgIGluc2VydFBhdGggPSBbXTtcblxuICAgICAgICAvLyBmaW5kIHRoZSBiZXN0IG5vZGUgZm9yIGFjY29tbW9kYXRpbmcgdGhlIGl0ZW0sIHNhdmluZyBhbGwgbm9kZXMgYWxvbmcgdGhlIHBhdGggdG9vXG4gICAgICAgIHZhciBub2RlID0gdGhpcy5fY2hvb3NlU3VidHJlZShiYm94LCB0aGlzLmRhdGEsIGxldmVsLCBpbnNlcnRQYXRoKTtcblxuICAgICAgICAvLyBwdXQgdGhlIGl0ZW0gaW50byB0aGUgbm9kZVxuICAgICAgICBub2RlLmNoaWxkcmVuLnB1c2goaXRlbSk7XG4gICAgICAgIGV4dGVuZChub2RlLmJib3gsIGJib3gpO1xuXG4gICAgICAgIC8vIHNwbGl0IG9uIG5vZGUgb3ZlcmZsb3c7IHByb3BhZ2F0ZSB1cHdhcmRzIGlmIG5lY2Vzc2FyeVxuICAgICAgICB3aGlsZSAobGV2ZWwgPj0gMCkge1xuICAgICAgICAgICAgaWYgKGluc2VydFBhdGhbbGV2ZWxdLmNoaWxkcmVuLmxlbmd0aCA+IHRoaXMuX21heEVudHJpZXMpIHtcbiAgICAgICAgICAgICAgICB0aGlzLl9zcGxpdChpbnNlcnRQYXRoLCBsZXZlbCk7XG4gICAgICAgICAgICAgICAgbGV2ZWwtLTtcbiAgICAgICAgICAgIH0gZWxzZSBicmVhaztcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIGFkanVzdCBiYm94ZXMgYWxvbmcgdGhlIGluc2VydGlvbiBwYXRoXG4gICAgICAgIHRoaXMuX2FkanVzdFBhcmVudEJCb3hlcyhiYm94LCBpbnNlcnRQYXRoLCBsZXZlbCk7XG4gICAgfSxcblxuICAgIC8vIHNwbGl0IG92ZXJmbG93ZWQgbm9kZSBpbnRvIHR3b1xuICAgIF9zcGxpdDogZnVuY3Rpb24gKGluc2VydFBhdGgsIGxldmVsKSB7XG5cbiAgICAgICAgdmFyIG5vZGUgPSBpbnNlcnRQYXRoW2xldmVsXSxcbiAgICAgICAgICAgIE0gPSBub2RlLmNoaWxkcmVuLmxlbmd0aCxcbiAgICAgICAgICAgIG0gPSB0aGlzLl9taW5FbnRyaWVzO1xuXG4gICAgICAgIHRoaXMuX2Nob29zZVNwbGl0QXhpcyhub2RlLCBtLCBNKTtcblxuICAgICAgICB2YXIgbmV3Tm9kZSA9IHtcbiAgICAgICAgICAgIGNoaWxkcmVuOiBub2RlLmNoaWxkcmVuLnNwbGljZSh0aGlzLl9jaG9vc2VTcGxpdEluZGV4KG5vZGUsIG0sIE0pKSxcbiAgICAgICAgICAgIGhlaWdodDogbm9kZS5oZWlnaHRcbiAgICAgICAgfTtcblxuICAgICAgICBpZiAobm9kZS5sZWFmKSBuZXdOb2RlLmxlYWYgPSB0cnVlO1xuXG4gICAgICAgIGNhbGNCQm94KG5vZGUsIHRoaXMudG9CQm94KTtcbiAgICAgICAgY2FsY0JCb3gobmV3Tm9kZSwgdGhpcy50b0JCb3gpO1xuXG4gICAgICAgIGlmIChsZXZlbCkgaW5zZXJ0UGF0aFtsZXZlbCAtIDFdLmNoaWxkcmVuLnB1c2gobmV3Tm9kZSk7XG4gICAgICAgIGVsc2UgdGhpcy5fc3BsaXRSb290KG5vZGUsIG5ld05vZGUpO1xuICAgIH0sXG5cbiAgICBfc3BsaXRSb290OiBmdW5jdGlvbiAobm9kZSwgbmV3Tm9kZSkge1xuICAgICAgICAvLyBzcGxpdCByb290IG5vZGVcbiAgICAgICAgdGhpcy5kYXRhID0ge1xuICAgICAgICAgICAgY2hpbGRyZW46IFtub2RlLCBuZXdOb2RlXSxcbiAgICAgICAgICAgIGhlaWdodDogbm9kZS5oZWlnaHQgKyAxXG4gICAgICAgIH07XG4gICAgICAgIGNhbGNCQm94KHRoaXMuZGF0YSwgdGhpcy50b0JCb3gpO1xuICAgIH0sXG5cbiAgICBfY2hvb3NlU3BsaXRJbmRleDogZnVuY3Rpb24gKG5vZGUsIG0sIE0pIHtcblxuICAgICAgICB2YXIgaSwgYmJveDEsIGJib3gyLCBvdmVybGFwLCBhcmVhLCBtaW5PdmVybGFwLCBtaW5BcmVhLCBpbmRleDtcblxuICAgICAgICBtaW5PdmVybGFwID0gbWluQXJlYSA9IEluZmluaXR5O1xuXG4gICAgICAgIGZvciAoaSA9IG07IGkgPD0gTSAtIG07IGkrKykge1xuICAgICAgICAgICAgYmJveDEgPSBkaXN0QkJveChub2RlLCAwLCBpLCB0aGlzLnRvQkJveCk7XG4gICAgICAgICAgICBiYm94MiA9IGRpc3RCQm94KG5vZGUsIGksIE0sIHRoaXMudG9CQm94KTtcblxuICAgICAgICAgICAgb3ZlcmxhcCA9IGludGVyc2VjdGlvbkFyZWEoYmJveDEsIGJib3gyKTtcbiAgICAgICAgICAgIGFyZWEgPSBiYm94QXJlYShiYm94MSkgKyBiYm94QXJlYShiYm94Mik7XG5cbiAgICAgICAgICAgIC8vIGNob29zZSBkaXN0cmlidXRpb24gd2l0aCBtaW5pbXVtIG92ZXJsYXBcbiAgICAgICAgICAgIGlmIChvdmVybGFwIDwgbWluT3ZlcmxhcCkge1xuICAgICAgICAgICAgICAgIG1pbk92ZXJsYXAgPSBvdmVybGFwO1xuICAgICAgICAgICAgICAgIGluZGV4ID0gaTtcblxuICAgICAgICAgICAgICAgIG1pbkFyZWEgPSBhcmVhIDwgbWluQXJlYSA/IGFyZWEgOiBtaW5BcmVhO1xuXG4gICAgICAgICAgICB9IGVsc2UgaWYgKG92ZXJsYXAgPT09IG1pbk92ZXJsYXApIHtcbiAgICAgICAgICAgICAgICAvLyBvdGhlcndpc2UgY2hvb3NlIGRpc3RyaWJ1dGlvbiB3aXRoIG1pbmltdW0gYXJlYVxuICAgICAgICAgICAgICAgIGlmIChhcmVhIDwgbWluQXJlYSkge1xuICAgICAgICAgICAgICAgICAgICBtaW5BcmVhID0gYXJlYTtcbiAgICAgICAgICAgICAgICAgICAgaW5kZXggPSBpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBpbmRleDtcbiAgICB9LFxuXG4gICAgLy8gc29ydHMgbm9kZSBjaGlsZHJlbiBieSB0aGUgYmVzdCBheGlzIGZvciBzcGxpdFxuICAgIF9jaG9vc2VTcGxpdEF4aXM6IGZ1bmN0aW9uIChub2RlLCBtLCBNKSB7XG5cbiAgICAgICAgdmFyIGNvbXBhcmVNaW5YID0gbm9kZS5sZWFmID8gdGhpcy5jb21wYXJlTWluWCA6IGNvbXBhcmVOb2RlTWluWCxcbiAgICAgICAgICAgIGNvbXBhcmVNaW5ZID0gbm9kZS5sZWFmID8gdGhpcy5jb21wYXJlTWluWSA6IGNvbXBhcmVOb2RlTWluWSxcbiAgICAgICAgICAgIHhNYXJnaW4gPSB0aGlzLl9hbGxEaXN0TWFyZ2luKG5vZGUsIG0sIE0sIGNvbXBhcmVNaW5YKSxcbiAgICAgICAgICAgIHlNYXJnaW4gPSB0aGlzLl9hbGxEaXN0TWFyZ2luKG5vZGUsIG0sIE0sIGNvbXBhcmVNaW5ZKTtcblxuICAgICAgICAvLyBpZiB0b3RhbCBkaXN0cmlidXRpb25zIG1hcmdpbiB2YWx1ZSBpcyBtaW5pbWFsIGZvciB4LCBzb3J0IGJ5IG1pblgsXG4gICAgICAgIC8vIG90aGVyd2lzZSBpdCdzIGFscmVhZHkgc29ydGVkIGJ5IG1pbllcbiAgICAgICAgaWYgKHhNYXJnaW4gPCB5TWFyZ2luKSBub2RlLmNoaWxkcmVuLnNvcnQoY29tcGFyZU1pblgpO1xuICAgIH0sXG5cbiAgICAvLyB0b3RhbCBtYXJnaW4gb2YgYWxsIHBvc3NpYmxlIHNwbGl0IGRpc3RyaWJ1dGlvbnMgd2hlcmUgZWFjaCBub2RlIGlzIGF0IGxlYXN0IG0gZnVsbFxuICAgIF9hbGxEaXN0TWFyZ2luOiBmdW5jdGlvbiAobm9kZSwgbSwgTSwgY29tcGFyZSkge1xuXG4gICAgICAgIG5vZGUuY2hpbGRyZW4uc29ydChjb21wYXJlKTtcblxuICAgICAgICB2YXIgdG9CQm94ID0gdGhpcy50b0JCb3gsXG4gICAgICAgICAgICBsZWZ0QkJveCA9IGRpc3RCQm94KG5vZGUsIDAsIG0sIHRvQkJveCksXG4gICAgICAgICAgICByaWdodEJCb3ggPSBkaXN0QkJveChub2RlLCBNIC0gbSwgTSwgdG9CQm94KSxcbiAgICAgICAgICAgIG1hcmdpbiA9IGJib3hNYXJnaW4obGVmdEJCb3gpICsgYmJveE1hcmdpbihyaWdodEJCb3gpLFxuICAgICAgICAgICAgaSwgY2hpbGQ7XG5cbiAgICAgICAgZm9yIChpID0gbTsgaSA8IE0gLSBtOyBpKyspIHtcbiAgICAgICAgICAgIGNoaWxkID0gbm9kZS5jaGlsZHJlbltpXTtcbiAgICAgICAgICAgIGV4dGVuZChsZWZ0QkJveCwgbm9kZS5sZWFmID8gdG9CQm94KGNoaWxkKSA6IGNoaWxkLmJib3gpO1xuICAgICAgICAgICAgbWFyZ2luICs9IGJib3hNYXJnaW4obGVmdEJCb3gpO1xuICAgICAgICB9XG5cbiAgICAgICAgZm9yIChpID0gTSAtIG0gLSAxOyBpID49IG07IGktLSkge1xuICAgICAgICAgICAgY2hpbGQgPSBub2RlLmNoaWxkcmVuW2ldO1xuICAgICAgICAgICAgZXh0ZW5kKHJpZ2h0QkJveCwgbm9kZS5sZWFmID8gdG9CQm94KGNoaWxkKSA6IGNoaWxkLmJib3gpO1xuICAgICAgICAgICAgbWFyZ2luICs9IGJib3hNYXJnaW4ocmlnaHRCQm94KTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBtYXJnaW47XG4gICAgfSxcblxuICAgIF9hZGp1c3RQYXJlbnRCQm94ZXM6IGZ1bmN0aW9uIChiYm94LCBwYXRoLCBsZXZlbCkge1xuICAgICAgICAvLyBhZGp1c3QgYmJveGVzIGFsb25nIHRoZSBnaXZlbiB0cmVlIHBhdGhcbiAgICAgICAgZm9yICh2YXIgaSA9IGxldmVsOyBpID49IDA7IGktLSkge1xuICAgICAgICAgICAgZXh0ZW5kKHBhdGhbaV0uYmJveCwgYmJveCk7XG4gICAgICAgIH1cbiAgICB9LFxuXG4gICAgX2NvbmRlbnNlOiBmdW5jdGlvbiAocGF0aCkge1xuICAgICAgICAvLyBnbyB0aHJvdWdoIHRoZSBwYXRoLCByZW1vdmluZyBlbXB0eSBub2RlcyBhbmQgdXBkYXRpbmcgYmJveGVzXG4gICAgICAgIGZvciAodmFyIGkgPSBwYXRoLmxlbmd0aCAtIDEsIHNpYmxpbmdzOyBpID49IDA7IGktLSkge1xuICAgICAgICAgICAgaWYgKHBhdGhbaV0uY2hpbGRyZW4ubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICAgICAgaWYgKGkgPiAwKSB7XG4gICAgICAgICAgICAgICAgICAgIHNpYmxpbmdzID0gcGF0aFtpIC0gMV0uY2hpbGRyZW47XG4gICAgICAgICAgICAgICAgICAgIHNpYmxpbmdzLnNwbGljZShzaWJsaW5ncy5pbmRleE9mKHBhdGhbaV0pLCAxKTtcblxuICAgICAgICAgICAgICAgIH0gZWxzZSB0aGlzLmNsZWFyKCk7XG5cbiAgICAgICAgICAgIH0gZWxzZSBjYWxjQkJveChwYXRoW2ldLCB0aGlzLnRvQkJveCk7XG4gICAgICAgIH1cbiAgICB9LFxuXG4gICAgX2luaXRGb3JtYXQ6IGZ1bmN0aW9uIChmb3JtYXQpIHtcbiAgICAgICAgLy8gZGF0YSBmb3JtYXQgKG1pblgsIG1pblksIG1heFgsIG1heFkgYWNjZXNzb3JzKVxuXG4gICAgICAgIC8vIHVzZXMgZXZhbC10eXBlIGZ1bmN0aW9uIGNvbXBpbGF0aW9uIGluc3RlYWQgb2YganVzdCBhY2NlcHRpbmcgYSB0b0JCb3ggZnVuY3Rpb25cbiAgICAgICAgLy8gYmVjYXVzZSB0aGUgYWxnb3JpdGhtcyBhcmUgdmVyeSBzZW5zaXRpdmUgdG8gc29ydGluZyBmdW5jdGlvbnMgcGVyZm9ybWFuY2UsXG4gICAgICAgIC8vIHNvIHRoZXkgc2hvdWxkIGJlIGRlYWQgc2ltcGxlIGFuZCB3aXRob3V0IGlubmVyIGNhbGxzXG5cbiAgICAgICAgLy8ganNoaW50IGV2aWw6IHRydWVcblxuICAgICAgICB2YXIgY29tcGFyZUFyciA9IFsncmV0dXJuIGEnLCAnIC0gYicsICc7J107XG5cbiAgICAgICAgdGhpcy5jb21wYXJlTWluWCA9IG5ldyBGdW5jdGlvbignYScsICdiJywgY29tcGFyZUFyci5qb2luKGZvcm1hdFswXSkpO1xuICAgICAgICB0aGlzLmNvbXBhcmVNaW5ZID0gbmV3IEZ1bmN0aW9uKCdhJywgJ2InLCBjb21wYXJlQXJyLmpvaW4oZm9ybWF0WzFdKSk7XG5cbiAgICAgICAgdGhpcy50b0JCb3ggPSBuZXcgRnVuY3Rpb24oJ2EnLCAncmV0dXJuIFthJyArIGZvcm1hdC5qb2luKCcsIGEnKSArICddOycpO1xuICAgIH1cbn07XG5cblxuLy8gY2FsY3VsYXRlIG5vZGUncyBiYm94IGZyb20gYmJveGVzIG9mIGl0cyBjaGlsZHJlblxuZnVuY3Rpb24gY2FsY0JCb3gobm9kZSwgdG9CQm94KSB7XG4gICAgbm9kZS5iYm94ID0gZGlzdEJCb3gobm9kZSwgMCwgbm9kZS5jaGlsZHJlbi5sZW5ndGgsIHRvQkJveCk7XG59XG5cbi8vIG1pbiBib3VuZGluZyByZWN0YW5nbGUgb2Ygbm9kZSBjaGlsZHJlbiBmcm9tIGsgdG8gcC0xXG5mdW5jdGlvbiBkaXN0QkJveChub2RlLCBrLCBwLCB0b0JCb3gpIHtcbiAgICB2YXIgYmJveCA9IGVtcHR5KCk7XG5cbiAgICBmb3IgKHZhciBpID0gaywgY2hpbGQ7IGkgPCBwOyBpKyspIHtcbiAgICAgICAgY2hpbGQgPSBub2RlLmNoaWxkcmVuW2ldO1xuICAgICAgICBleHRlbmQoYmJveCwgbm9kZS5sZWFmID8gdG9CQm94KGNoaWxkKSA6IGNoaWxkLmJib3gpO1xuICAgIH1cblxuICAgIHJldHVybiBiYm94O1xufVxuXG5mdW5jdGlvbiBlbXB0eSgpIHsgcmV0dXJuIFtJbmZpbml0eSwgSW5maW5pdHksIC1JbmZpbml0eSwgLUluZmluaXR5XTsgfVxuXG5mdW5jdGlvbiBleHRlbmQoYSwgYikge1xuICAgIGFbMF0gPSBNYXRoLm1pbihhWzBdLCBiWzBdKTtcbiAgICBhWzFdID0gTWF0aC5taW4oYVsxXSwgYlsxXSk7XG4gICAgYVsyXSA9IE1hdGgubWF4KGFbMl0sIGJbMl0pO1xuICAgIGFbM10gPSBNYXRoLm1heChhWzNdLCBiWzNdKTtcbiAgICByZXR1cm4gYTtcbn1cblxuZnVuY3Rpb24gY29tcGFyZU5vZGVNaW5YKGEsIGIpIHsgcmV0dXJuIGEuYmJveFswXSAtIGIuYmJveFswXTsgfVxuZnVuY3Rpb24gY29tcGFyZU5vZGVNaW5ZKGEsIGIpIHsgcmV0dXJuIGEuYmJveFsxXSAtIGIuYmJveFsxXTsgfVxuXG5mdW5jdGlvbiBiYm94QXJlYShhKSAgIHsgcmV0dXJuIChhWzJdIC0gYVswXSkgKiAoYVszXSAtIGFbMV0pOyB9XG5mdW5jdGlvbiBiYm94TWFyZ2luKGEpIHsgcmV0dXJuIChhWzJdIC0gYVswXSkgKyAoYVszXSAtIGFbMV0pOyB9XG5cbmZ1bmN0aW9uIGVubGFyZ2VkQXJlYShhLCBiKSB7XG4gICAgcmV0dXJuIChNYXRoLm1heChiWzJdLCBhWzJdKSAtIE1hdGgubWluKGJbMF0sIGFbMF0pKSAqXG4gICAgICAgICAgIChNYXRoLm1heChiWzNdLCBhWzNdKSAtIE1hdGgubWluKGJbMV0sIGFbMV0pKTtcbn1cblxuZnVuY3Rpb24gaW50ZXJzZWN0aW9uQXJlYShhLCBiKSB7XG4gICAgdmFyIG1pblggPSBNYXRoLm1heChhWzBdLCBiWzBdKSxcbiAgICAgICAgbWluWSA9IE1hdGgubWF4KGFbMV0sIGJbMV0pLFxuICAgICAgICBtYXhYID0gTWF0aC5taW4oYVsyXSwgYlsyXSksXG4gICAgICAgIG1heFkgPSBNYXRoLm1pbihhWzNdLCBiWzNdKTtcblxuICAgIHJldHVybiBNYXRoLm1heCgwLCBtYXhYIC0gbWluWCkgKlxuICAgICAgICAgICBNYXRoLm1heCgwLCBtYXhZIC0gbWluWSk7XG59XG5cbmZ1bmN0aW9uIGNvbnRhaW5zKGEsIGIpIHtcbiAgICByZXR1cm4gYVswXSA8PSBiWzBdICYmXG4gICAgICAgICAgIGFbMV0gPD0gYlsxXSAmJlxuICAgICAgICAgICBiWzJdIDw9IGFbMl0gJiZcbiAgICAgICAgICAgYlszXSA8PSBhWzNdO1xufVxuXG5mdW5jdGlvbiBpbnRlcnNlY3RzKGEsIGIpIHtcbiAgICByZXR1cm4gYlswXSA8PSBhWzJdICYmXG4gICAgICAgICAgIGJbMV0gPD0gYVszXSAmJlxuICAgICAgICAgICBiWzJdID49IGFbMF0gJiZcbiAgICAgICAgICAgYlszXSA+PSBhWzFdO1xufVxuXG4vLyBzb3J0IGFuIGFycmF5IHNvIHRoYXQgaXRlbXMgY29tZSBpbiBncm91cHMgb2YgbiB1bnNvcnRlZCBpdGVtcywgd2l0aCBncm91cHMgc29ydGVkIGJldHdlZW4gZWFjaCBvdGhlcjtcbi8vIGNvbWJpbmVzIHNlbGVjdGlvbiBhbGdvcml0aG0gd2l0aCBiaW5hcnkgZGl2aWRlICYgY29ucXVlciBhcHByb2FjaFxuXG5mdW5jdGlvbiBtdWx0aVNlbGVjdChhcnIsIGxlZnQsIHJpZ2h0LCBuLCBjb21wYXJlKSB7XG4gICAgdmFyIHN0YWNrID0gW2xlZnQsIHJpZ2h0XSxcbiAgICAgICAgbWlkO1xuXG4gICAgd2hpbGUgKHN0YWNrLmxlbmd0aCkge1xuICAgICAgICByaWdodCA9IHN0YWNrLnBvcCgpO1xuICAgICAgICBsZWZ0ID0gc3RhY2sucG9wKCk7XG5cbiAgICAgICAgaWYgKHJpZ2h0IC0gbGVmdCA8PSBuKSBjb250aW51ZTtcblxuICAgICAgICBtaWQgPSBsZWZ0ICsgTWF0aC5jZWlsKChyaWdodCAtIGxlZnQpIC8gbiAvIDIpICogbjtcbiAgICAgICAgc2VsZWN0KGFyciwgbGVmdCwgcmlnaHQsIG1pZCwgY29tcGFyZSk7XG5cbiAgICAgICAgc3RhY2sucHVzaChsZWZ0LCBtaWQsIG1pZCwgcmlnaHQpO1xuICAgIH1cbn1cblxuLy8gRmxveWQtUml2ZXN0IHNlbGVjdGlvbiBhbGdvcml0aG06XG4vLyBzb3J0IGFuIGFycmF5IGJldHdlZW4gbGVmdCBhbmQgcmlnaHQgKGluY2x1c2l2ZSkgc28gdGhhdCB0aGUgc21hbGxlc3QgayBlbGVtZW50cyBjb21lIGZpcnN0ICh1bm9yZGVyZWQpXG5mdW5jdGlvbiBzZWxlY3QoYXJyLCBsZWZ0LCByaWdodCwgaywgY29tcGFyZSkge1xuICAgIHZhciBuLCBpLCB6LCBzLCBzZCwgbmV3TGVmdCwgbmV3UmlnaHQsIHQsIGo7XG5cbiAgICB3aGlsZSAocmlnaHQgPiBsZWZ0KSB7XG4gICAgICAgIGlmIChyaWdodCAtIGxlZnQgPiA2MDApIHtcbiAgICAgICAgICAgIG4gPSByaWdodCAtIGxlZnQgKyAxO1xuICAgICAgICAgICAgaSA9IGsgLSBsZWZ0ICsgMTtcbiAgICAgICAgICAgIHogPSBNYXRoLmxvZyhuKTtcbiAgICAgICAgICAgIHMgPSAwLjUgKiBNYXRoLmV4cCgyICogeiAvIDMpO1xuICAgICAgICAgICAgc2QgPSAwLjUgKiBNYXRoLnNxcnQoeiAqIHMgKiAobiAtIHMpIC8gbikgKiAoaSAtIG4gLyAyIDwgMCA/IC0xIDogMSk7XG4gICAgICAgICAgICBuZXdMZWZ0ID0gTWF0aC5tYXgobGVmdCwgTWF0aC5mbG9vcihrIC0gaSAqIHMgLyBuICsgc2QpKTtcbiAgICAgICAgICAgIG5ld1JpZ2h0ID0gTWF0aC5taW4ocmlnaHQsIE1hdGguZmxvb3IoayArIChuIC0gaSkgKiBzIC8gbiArIHNkKSk7XG4gICAgICAgICAgICBzZWxlY3QoYXJyLCBuZXdMZWZ0LCBuZXdSaWdodCwgaywgY29tcGFyZSk7XG4gICAgICAgIH1cblxuICAgICAgICB0ID0gYXJyW2tdO1xuICAgICAgICBpID0gbGVmdDtcbiAgICAgICAgaiA9IHJpZ2h0O1xuXG4gICAgICAgIHN3YXAoYXJyLCBsZWZ0LCBrKTtcbiAgICAgICAgaWYgKGNvbXBhcmUoYXJyW3JpZ2h0XSwgdCkgPiAwKSBzd2FwKGFyciwgbGVmdCwgcmlnaHQpO1xuXG4gICAgICAgIHdoaWxlIChpIDwgaikge1xuICAgICAgICAgICAgc3dhcChhcnIsIGksIGopO1xuICAgICAgICAgICAgaSsrO1xuICAgICAgICAgICAgai0tO1xuICAgICAgICAgICAgd2hpbGUgKGNvbXBhcmUoYXJyW2ldLCB0KSA8IDApIGkrKztcbiAgICAgICAgICAgIHdoaWxlIChjb21wYXJlKGFycltqXSwgdCkgPiAwKSBqLS07XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoY29tcGFyZShhcnJbbGVmdF0sIHQpID09PSAwKSBzd2FwKGFyciwgbGVmdCwgaik7XG4gICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgaisrO1xuICAgICAgICAgICAgc3dhcChhcnIsIGosIHJpZ2h0KTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChqIDw9IGspIGxlZnQgPSBqICsgMTtcbiAgICAgICAgaWYgKGsgPD0gaikgcmlnaHQgPSBqIC0gMTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIHN3YXAoYXJyLCBpLCBqKSB7XG4gICAgdmFyIHRtcCA9IGFycltpXTtcbiAgICBhcnJbaV0gPSBhcnJbal07XG4gICAgYXJyW2pdID0gdG1wO1xufVxuXG5cbi8vIGV4cG9ydCBhcyBBTUQvQ29tbW9uSlMgbW9kdWxlIG9yIGdsb2JhbCB2YXJpYWJsZVxuaWYgKHR5cGVvZiBkZWZpbmUgPT09ICdmdW5jdGlvbicgJiYgZGVmaW5lLmFtZCkgZGVmaW5lKCdyYnVzaCcsIGZ1bmN0aW9uKCkgeyByZXR1cm4gcmJ1c2g7IH0pO1xuZWxzZSBpZiAodHlwZW9mIG1vZHVsZSAhPT0gJ3VuZGVmaW5lZCcpIG1vZHVsZS5leHBvcnRzID0gcmJ1c2g7XG5lbHNlIGlmICh0eXBlb2Ygc2VsZiAhPT0gJ3VuZGVmaW5lZCcpIHNlbGYucmJ1c2ggPSByYnVzaDtcbmVsc2Ugd2luZG93LnJidXNoID0gcmJ1c2g7XG5cbn0pKCk7XG4iXX0=
