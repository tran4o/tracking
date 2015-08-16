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
		ajax: 
		{
			url : "../participants",
			data: function ( d ) {
				if (d.action == "remove") 
				    return JSON.stringify({"delete":d.id});
			    return JSON.stringify( d.data );
			}
		},
		table: "#table-participants",
		idSrc: "id",
		fields: [ {
				label: "Id",
				name: "id",
				type : "readonly"
			},{
				label: "Code",
				name: "code"
			}, {
				label: "Name",
				name: "name"
			}, {
				label: "BIB",
				name: "bib"
			}, {
				label: "Country",
				name: "country"
			}, {
				label: "Age",
				name: "age"
			}, {
				label: "Gender",
				name: "gender"
			}, {
				label: "Occupation",
				name: "occupation"
			}
		]
	} );

	window.EDITOR2 = new $.fn.dataTable.Editor( {
		ajax: 
		{
			url : CONFIG.server.prefix+"rest/event/",
			data: function ( d ) 
			{
				if (d.action == "remove") 
				    return JSON.stringify({"delete":d.id});
			    return JSON.stringify( d.data );
			}
		},
		data: function ( d ) {
		    return JSON.stringify( d );
		},
		table: "#table-events",
		idSrc: "id",
		fields: [ {
				label: "Id",
				name: "id",
				type : "readonly"
			}, {
				label: "Code",
				name: "code"
			}, {
				label: "Name",
				name: "name"
			}, {
				label: "Date",
				name: "date",
				dateFormat: "mm-dd-yyyy",
				type: "date"
			}, {
				label: "Begin time",
				name: "begin-time"
			}, {
				label: "End time",
				name: "end-time"
			},{
	            label: "track JSON data",
	            name:  "track"
	        },{
	            label: "track run count",
	            name:  "run-count"
	        },{
	            label: "bike start km.",
	            name:  "bike-start"
	        },{
	            label: "run start km.",
	            name:  "run-start"
	        }
			]
	} );

	var tableParticipants = $('#table-participants').DataTable( {
		dom: "Tfrtip",
		ajax: "../participants?mode=dtbl",
		columns: [
			{ data: "id" },
			{ data: "firstname" },
			{ data: "lastname" },
			{ data: "gender" },
			{ 
				// birth date 
				data: null,
				render: function ( data, type, row ) 
				{
					var dt = data.birthDate;
					if (!dt)
						return "";
					var res="";
					try {
						res = formatDate(new Date(dt));
					} catch(e) {
					}
					return res;
				} 
			},
			{ data: "nationality"},
			{ data: "club"},
			{ data: "startGroup" },
			{ data: "startNo",className : "dt-body-right" },
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
		ajax: CONFIG.server.prefix+"rest/event/",
		columns: [
			{ data: "code" },
			{ data: "name" },
			{ 
				// date 
				data: null,
				render: function ( data, type, row ) 
				{
					var dt = data["date"];
					if (!dt)
						return "";
					var res="";
					try {
						res = formatDate(new Date(dt));
					} catch(e) {
					}
					return res;
				} 
			},
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
			}
		],
		tableTools: {
			sRowSelect: "os",
			aButtons: [
				{ sExtends: "editor_create", editor : EDITOR2 },
				{ sExtends: "editor_edit",   fnClick : function () {
					EDITOR2
                    .title( 'Edit track' )
                    .buttons( [
                               { label: 'Save', fn: function() { this.submit(); } },
                               { label: 'Map', fn: function() {
                            	   var dt = tableEvents.rows(".selected").data()[0];
                            	   var that=this;
                            	   mapEdit(dt.id,$("#DTE_Field_track").val(),$("#DTE_Field_bike-start").val(),$("#DTE_Field_run-start").val(),function(data) {
                            		   $("#DTE_Field_track").val(data);
                            	   });
                                } }
                    	] )
                    .edit( tableEvents.row( '.selected' ).node() );
					
				} },
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
//# sourceMappingURL=data:application/json;charset:utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL0FwcERhdGEvUm9hbWluZy9ucG0vbm9kZV9tb2R1bGVzL2Jyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2Jyb3dzZXItcGFjay9fcHJlbHVkZS5qcyIsIi4uLy4uL0FwcERhdGEvUm9hbWluZy9ucG0vbm9kZV9tb2R1bGVzL2Jyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2J1ZmZlci9pbmRleC5qcyIsIi4uLy4uL0FwcERhdGEvUm9hbWluZy9ucG0vbm9kZV9tb2R1bGVzL2Jyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2J1ZmZlci9ub2RlX21vZHVsZXMvYmFzZTY0LWpzL2xpYi9iNjQuanMiLCIuLi8uLi9BcHBEYXRhL1JvYW1pbmcvbnBtL25vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9idWZmZXIvbm9kZV9tb2R1bGVzL2llZWU3NTQvaW5kZXguanMiLCIuLi8uLi9BcHBEYXRhL1JvYW1pbmcvbnBtL25vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9idWZmZXIvbm9kZV9tb2R1bGVzL2lzLWFycmF5L2luZGV4LmpzIiwiLi4vLi4vQXBwRGF0YS9Sb2FtaW5nL25wbS9ub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvcHJvY2Vzcy9icm93c2VyLmpzIiwianMvYXBwL0FkbWluLmpzIiwianMvYXBwL0NvbmZpZy5qcyIsImpzL2FwcC9HVUkuanMiLCJqcy9hcHAvTGl2ZVN0cmVhbS5qcyIsImpzL2FwcC9QYXJ0aWNpcGFudC5qcyIsImpzL2FwcC9Qb2ludC5qcyIsImpzL2FwcC9TdHlsZXMuanMiLCJqcy9hcHAvVHJhY2suanMiLCJqcy9hcHAvVXRpbHMuanMiLCJub2RlX21vZHVsZXMvam9vc2Uvam9vc2UtYWxsLmpzIiwibm9kZV9tb2R1bGVzL3JidXNoL3JidXNoLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBO0FDQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDNzVDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzVIQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNwRkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDakNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzFGQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2pZQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNsSEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN0aUJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDNUhBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNqdUJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3ZDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDamZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7QUN4WkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7Ozs7QUM5akJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7Ozs7QUNqcEdBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBIiwiZmlsZSI6ImdlbmVyYXRlZC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzQ29udGVudCI6WyIoZnVuY3Rpb24gZSh0LG4scil7ZnVuY3Rpb24gcyhvLHUpe2lmKCFuW29dKXtpZighdFtvXSl7dmFyIGE9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtpZighdSYmYSlyZXR1cm4gYShvLCEwKTtpZihpKXJldHVybiBpKG8sITApO3ZhciBmPW5ldyBFcnJvcihcIkNhbm5vdCBmaW5kIG1vZHVsZSAnXCIrbytcIidcIik7dGhyb3cgZi5jb2RlPVwiTU9EVUxFX05PVF9GT1VORFwiLGZ9dmFyIGw9bltvXT17ZXhwb3J0czp7fX07dFtvXVswXS5jYWxsKGwuZXhwb3J0cyxmdW5jdGlvbihlKXt2YXIgbj10W29dWzFdW2VdO3JldHVybiBzKG4/bjplKX0sbCxsLmV4cG9ydHMsZSx0LG4scil9cmV0dXJuIG5bb10uZXhwb3J0c312YXIgaT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2Zvcih2YXIgbz0wO288ci5sZW5ndGg7bysrKXMocltvXSk7cmV0dXJuIHN9KSIsIi8qIVxuICogVGhlIGJ1ZmZlciBtb2R1bGUgZnJvbSBub2RlLmpzLCBmb3IgdGhlIGJyb3dzZXIuXG4gKlxuICogQGF1dGhvciAgIEZlcm9zcyBBYm91a2hhZGlqZWggPGZlcm9zc0BmZXJvc3Mub3JnPiA8aHR0cDovL2Zlcm9zcy5vcmc+XG4gKiBAbGljZW5zZSAgTUlUXG4gKi9cblxudmFyIGJhc2U2NCA9IHJlcXVpcmUoJ2Jhc2U2NC1qcycpXG52YXIgaWVlZTc1NCA9IHJlcXVpcmUoJ2llZWU3NTQnKVxudmFyIGlzQXJyYXkgPSByZXF1aXJlKCdpcy1hcnJheScpXG5cbmV4cG9ydHMuQnVmZmVyID0gQnVmZmVyXG5leHBvcnRzLlNsb3dCdWZmZXIgPSBTbG93QnVmZmVyXG5leHBvcnRzLklOU1BFQ1RfTUFYX0JZVEVTID0gNTBcbkJ1ZmZlci5wb29sU2l6ZSA9IDgxOTIgLy8gbm90IHVzZWQgYnkgdGhpcyBpbXBsZW1lbnRhdGlvblxuXG52YXIgcm9vdFBhcmVudCA9IHt9XG5cbi8qKlxuICogSWYgYEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUYDpcbiAqICAgPT09IHRydWUgICAgVXNlIFVpbnQ4QXJyYXkgaW1wbGVtZW50YXRpb24gKGZhc3Rlc3QpXG4gKiAgID09PSBmYWxzZSAgIFVzZSBPYmplY3QgaW1wbGVtZW50YXRpb24gKG1vc3QgY29tcGF0aWJsZSwgZXZlbiBJRTYpXG4gKlxuICogQnJvd3NlcnMgdGhhdCBzdXBwb3J0IHR5cGVkIGFycmF5cyBhcmUgSUUgMTArLCBGaXJlZm94IDQrLCBDaHJvbWUgNyssIFNhZmFyaSA1LjErLFxuICogT3BlcmEgMTEuNissIGlPUyA0LjIrLlxuICpcbiAqIE5vdGU6XG4gKlxuICogLSBJbXBsZW1lbnRhdGlvbiBtdXN0IHN1cHBvcnQgYWRkaW5nIG5ldyBwcm9wZXJ0aWVzIHRvIGBVaW50OEFycmF5YCBpbnN0YW5jZXMuXG4gKiAgIEZpcmVmb3ggNC0yOSBsYWNrZWQgc3VwcG9ydCwgZml4ZWQgaW4gRmlyZWZveCAzMCsuXG4gKiAgIFNlZTogaHR0cHM6Ly9idWd6aWxsYS5tb3ppbGxhLm9yZy9zaG93X2J1Zy5jZ2k/aWQ9Njk1NDM4LlxuICpcbiAqICAtIENocm9tZSA5LTEwIGlzIG1pc3NpbmcgdGhlIGBUeXBlZEFycmF5LnByb3RvdHlwZS5zdWJhcnJheWAgZnVuY3Rpb24uXG4gKlxuICogIC0gSUUxMCBoYXMgYSBicm9rZW4gYFR5cGVkQXJyYXkucHJvdG90eXBlLnN1YmFycmF5YCBmdW5jdGlvbiB3aGljaCByZXR1cm5zIGFycmF5cyBvZlxuICogICAgaW5jb3JyZWN0IGxlbmd0aCBpbiBzb21lIHNpdHVhdGlvbnMuXG4gKlxuICogV2UgZGV0ZWN0IHRoZXNlIGJ1Z2d5IGJyb3dzZXJzIGFuZCBzZXQgYEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUYCB0byBgZmFsc2VgIHNvIHRoZXkgd2lsbFxuICogZ2V0IHRoZSBPYmplY3QgaW1wbGVtZW50YXRpb24sIHdoaWNoIGlzIHNsb3dlciBidXQgd2lsbCB3b3JrIGNvcnJlY3RseS5cbiAqL1xuQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQgPSAoZnVuY3Rpb24gKCkge1xuICBmdW5jdGlvbiBGb28gKCkge31cbiAgdHJ5IHtcbiAgICB2YXIgYnVmID0gbmV3IEFycmF5QnVmZmVyKDApXG4gICAgdmFyIGFyciA9IG5ldyBVaW50OEFycmF5KGJ1ZilcbiAgICBhcnIuZm9vID0gZnVuY3Rpb24gKCkgeyByZXR1cm4gNDIgfVxuICAgIGFyci5jb25zdHJ1Y3RvciA9IEZvb1xuICAgIHJldHVybiBhcnIuZm9vKCkgPT09IDQyICYmIC8vIHR5cGVkIGFycmF5IGluc3RhbmNlcyBjYW4gYmUgYXVnbWVudGVkXG4gICAgICAgIGFyci5jb25zdHJ1Y3RvciA9PT0gRm9vICYmIC8vIGNvbnN0cnVjdG9yIGNhbiBiZSBzZXRcbiAgICAgICAgdHlwZW9mIGFyci5zdWJhcnJheSA9PT0gJ2Z1bmN0aW9uJyAmJiAvLyBjaHJvbWUgOS0xMCBsYWNrIGBzdWJhcnJheWBcbiAgICAgICAgbmV3IFVpbnQ4QXJyYXkoMSkuc3ViYXJyYXkoMSwgMSkuYnl0ZUxlbmd0aCA9PT0gMCAvLyBpZTEwIGhhcyBicm9rZW4gYHN1YmFycmF5YFxuICB9IGNhdGNoIChlKSB7XG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cbn0pKClcblxuZnVuY3Rpb24ga01heExlbmd0aCAoKSB7XG4gIHJldHVybiBCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVFxuICAgID8gMHg3ZmZmZmZmZlxuICAgIDogMHgzZmZmZmZmZlxufVxuXG4vKipcbiAqIENsYXNzOiBCdWZmZXJcbiAqID09PT09PT09PT09PT1cbiAqXG4gKiBUaGUgQnVmZmVyIGNvbnN0cnVjdG9yIHJldHVybnMgaW5zdGFuY2VzIG9mIGBVaW50OEFycmF5YCB0aGF0IGFyZSBhdWdtZW50ZWRcbiAqIHdpdGggZnVuY3Rpb24gcHJvcGVydGllcyBmb3IgYWxsIHRoZSBub2RlIGBCdWZmZXJgIEFQSSBmdW5jdGlvbnMuIFdlIHVzZVxuICogYFVpbnQ4QXJyYXlgIHNvIHRoYXQgc3F1YXJlIGJyYWNrZXQgbm90YXRpb24gd29ya3MgYXMgZXhwZWN0ZWQgLS0gaXQgcmV0dXJuc1xuICogYSBzaW5nbGUgb2N0ZXQuXG4gKlxuICogQnkgYXVnbWVudGluZyB0aGUgaW5zdGFuY2VzLCB3ZSBjYW4gYXZvaWQgbW9kaWZ5aW5nIHRoZSBgVWludDhBcnJheWBcbiAqIHByb3RvdHlwZS5cbiAqL1xuZnVuY3Rpb24gQnVmZmVyIChhcmcpIHtcbiAgaWYgKCEodGhpcyBpbnN0YW5jZW9mIEJ1ZmZlcikpIHtcbiAgICAvLyBBdm9pZCBnb2luZyB0aHJvdWdoIGFuIEFyZ3VtZW50c0FkYXB0b3JUcmFtcG9saW5lIGluIHRoZSBjb21tb24gY2FzZS5cbiAgICBpZiAoYXJndW1lbnRzLmxlbmd0aCA+IDEpIHJldHVybiBuZXcgQnVmZmVyKGFyZywgYXJndW1lbnRzWzFdKVxuICAgIHJldHVybiBuZXcgQnVmZmVyKGFyZylcbiAgfVxuXG4gIHRoaXMubGVuZ3RoID0gMFxuICB0aGlzLnBhcmVudCA9IHVuZGVmaW5lZFxuXG4gIC8vIENvbW1vbiBjYXNlLlxuICBpZiAodHlwZW9mIGFyZyA9PT0gJ251bWJlcicpIHtcbiAgICByZXR1cm4gZnJvbU51bWJlcih0aGlzLCBhcmcpXG4gIH1cblxuICAvLyBTbGlnaHRseSBsZXNzIGNvbW1vbiBjYXNlLlxuICBpZiAodHlwZW9mIGFyZyA9PT0gJ3N0cmluZycpIHtcbiAgICByZXR1cm4gZnJvbVN0cmluZyh0aGlzLCBhcmcsIGFyZ3VtZW50cy5sZW5ndGggPiAxID8gYXJndW1lbnRzWzFdIDogJ3V0ZjgnKVxuICB9XG5cbiAgLy8gVW51c3VhbC5cbiAgcmV0dXJuIGZyb21PYmplY3QodGhpcywgYXJnKVxufVxuXG5mdW5jdGlvbiBmcm9tTnVtYmVyICh0aGF0LCBsZW5ndGgpIHtcbiAgdGhhdCA9IGFsbG9jYXRlKHRoYXQsIGxlbmd0aCA8IDAgPyAwIDogY2hlY2tlZChsZW5ndGgpIHwgMClcbiAgaWYgKCFCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuZ3RoOyBpKyspIHtcbiAgICAgIHRoYXRbaV0gPSAwXG4gICAgfVxuICB9XG4gIHJldHVybiB0aGF0XG59XG5cbmZ1bmN0aW9uIGZyb21TdHJpbmcgKHRoYXQsIHN0cmluZywgZW5jb2RpbmcpIHtcbiAgaWYgKHR5cGVvZiBlbmNvZGluZyAhPT0gJ3N0cmluZycgfHwgZW5jb2RpbmcgPT09ICcnKSBlbmNvZGluZyA9ICd1dGY4J1xuXG4gIC8vIEFzc3VtcHRpb246IGJ5dGVMZW5ndGgoKSByZXR1cm4gdmFsdWUgaXMgYWx3YXlzIDwga01heExlbmd0aC5cbiAgdmFyIGxlbmd0aCA9IGJ5dGVMZW5ndGgoc3RyaW5nLCBlbmNvZGluZykgfCAwXG4gIHRoYXQgPSBhbGxvY2F0ZSh0aGF0LCBsZW5ndGgpXG5cbiAgdGhhdC53cml0ZShzdHJpbmcsIGVuY29kaW5nKVxuICByZXR1cm4gdGhhdFxufVxuXG5mdW5jdGlvbiBmcm9tT2JqZWN0ICh0aGF0LCBvYmplY3QpIHtcbiAgaWYgKEJ1ZmZlci5pc0J1ZmZlcihvYmplY3QpKSByZXR1cm4gZnJvbUJ1ZmZlcih0aGF0LCBvYmplY3QpXG5cbiAgaWYgKGlzQXJyYXkob2JqZWN0KSkgcmV0dXJuIGZyb21BcnJheSh0aGF0LCBvYmplY3QpXG5cbiAgaWYgKG9iamVjdCA9PSBudWxsKSB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcignbXVzdCBzdGFydCB3aXRoIG51bWJlciwgYnVmZmVyLCBhcnJheSBvciBzdHJpbmcnKVxuICB9XG5cbiAgaWYgKHR5cGVvZiBBcnJheUJ1ZmZlciAhPT0gJ3VuZGVmaW5lZCcgJiYgb2JqZWN0LmJ1ZmZlciBpbnN0YW5jZW9mIEFycmF5QnVmZmVyKSB7XG4gICAgcmV0dXJuIGZyb21UeXBlZEFycmF5KHRoYXQsIG9iamVjdClcbiAgfVxuXG4gIGlmIChvYmplY3QubGVuZ3RoKSByZXR1cm4gZnJvbUFycmF5TGlrZSh0aGF0LCBvYmplY3QpXG5cbiAgcmV0dXJuIGZyb21Kc29uT2JqZWN0KHRoYXQsIG9iamVjdClcbn1cblxuZnVuY3Rpb24gZnJvbUJ1ZmZlciAodGhhdCwgYnVmZmVyKSB7XG4gIHZhciBsZW5ndGggPSBjaGVja2VkKGJ1ZmZlci5sZW5ndGgpIHwgMFxuICB0aGF0ID0gYWxsb2NhdGUodGhhdCwgbGVuZ3RoKVxuICBidWZmZXIuY29weSh0aGF0LCAwLCAwLCBsZW5ndGgpXG4gIHJldHVybiB0aGF0XG59XG5cbmZ1bmN0aW9uIGZyb21BcnJheSAodGhhdCwgYXJyYXkpIHtcbiAgdmFyIGxlbmd0aCA9IGNoZWNrZWQoYXJyYXkubGVuZ3RoKSB8IDBcbiAgdGhhdCA9IGFsbG9jYXRlKHRoYXQsIGxlbmd0aClcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW5ndGg7IGkgKz0gMSkge1xuICAgIHRoYXRbaV0gPSBhcnJheVtpXSAmIDI1NVxuICB9XG4gIHJldHVybiB0aGF0XG59XG5cbi8vIER1cGxpY2F0ZSBvZiBmcm9tQXJyYXkoKSB0byBrZWVwIGZyb21BcnJheSgpIG1vbm9tb3JwaGljLlxuZnVuY3Rpb24gZnJvbVR5cGVkQXJyYXkgKHRoYXQsIGFycmF5KSB7XG4gIHZhciBsZW5ndGggPSBjaGVja2VkKGFycmF5Lmxlbmd0aCkgfCAwXG4gIHRoYXQgPSBhbGxvY2F0ZSh0aGF0LCBsZW5ndGgpXG4gIC8vIFRydW5jYXRpbmcgdGhlIGVsZW1lbnRzIGlzIHByb2JhYmx5IG5vdCB3aGF0IHBlb3BsZSBleHBlY3QgZnJvbSB0eXBlZFxuICAvLyBhcnJheXMgd2l0aCBCWVRFU19QRVJfRUxFTUVOVCA+IDEgYnV0IGl0J3MgY29tcGF0aWJsZSB3aXRoIHRoZSBiZWhhdmlvclxuICAvLyBvZiB0aGUgb2xkIEJ1ZmZlciBjb25zdHJ1Y3Rvci5cbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW5ndGg7IGkgKz0gMSkge1xuICAgIHRoYXRbaV0gPSBhcnJheVtpXSAmIDI1NVxuICB9XG4gIHJldHVybiB0aGF0XG59XG5cbmZ1bmN0aW9uIGZyb21BcnJheUxpa2UgKHRoYXQsIGFycmF5KSB7XG4gIHZhciBsZW5ndGggPSBjaGVja2VkKGFycmF5Lmxlbmd0aCkgfCAwXG4gIHRoYXQgPSBhbGxvY2F0ZSh0aGF0LCBsZW5ndGgpXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuZ3RoOyBpICs9IDEpIHtcbiAgICB0aGF0W2ldID0gYXJyYXlbaV0gJiAyNTVcbiAgfVxuICByZXR1cm4gdGhhdFxufVxuXG4vLyBEZXNlcmlhbGl6ZSB7IHR5cGU6ICdCdWZmZXInLCBkYXRhOiBbMSwyLDMsLi4uXSB9IGludG8gYSBCdWZmZXIgb2JqZWN0LlxuLy8gUmV0dXJucyBhIHplcm8tbGVuZ3RoIGJ1ZmZlciBmb3IgaW5wdXRzIHRoYXQgZG9uJ3QgY29uZm9ybSB0byB0aGUgc3BlYy5cbmZ1bmN0aW9uIGZyb21Kc29uT2JqZWN0ICh0aGF0LCBvYmplY3QpIHtcbiAgdmFyIGFycmF5XG4gIHZhciBsZW5ndGggPSAwXG5cbiAgaWYgKG9iamVjdC50eXBlID09PSAnQnVmZmVyJyAmJiBpc0FycmF5KG9iamVjdC5kYXRhKSkge1xuICAgIGFycmF5ID0gb2JqZWN0LmRhdGFcbiAgICBsZW5ndGggPSBjaGVja2VkKGFycmF5Lmxlbmd0aCkgfCAwXG4gIH1cbiAgdGhhdCA9IGFsbG9jYXRlKHRoYXQsIGxlbmd0aClcblxuICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbmd0aDsgaSArPSAxKSB7XG4gICAgdGhhdFtpXSA9IGFycmF5W2ldICYgMjU1XG4gIH1cbiAgcmV0dXJuIHRoYXRcbn1cblxuZnVuY3Rpb24gYWxsb2NhdGUgKHRoYXQsIGxlbmd0aCkge1xuICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICAvLyBSZXR1cm4gYW4gYXVnbWVudGVkIGBVaW50OEFycmF5YCBpbnN0YW5jZSwgZm9yIGJlc3QgcGVyZm9ybWFuY2VcbiAgICB0aGF0ID0gQnVmZmVyLl9hdWdtZW50KG5ldyBVaW50OEFycmF5KGxlbmd0aCkpXG4gIH0gZWxzZSB7XG4gICAgLy8gRmFsbGJhY2s6IFJldHVybiBhbiBvYmplY3QgaW5zdGFuY2Ugb2YgdGhlIEJ1ZmZlciBjbGFzc1xuICAgIHRoYXQubGVuZ3RoID0gbGVuZ3RoXG4gICAgdGhhdC5faXNCdWZmZXIgPSB0cnVlXG4gIH1cblxuICB2YXIgZnJvbVBvb2wgPSBsZW5ndGggIT09IDAgJiYgbGVuZ3RoIDw9IEJ1ZmZlci5wb29sU2l6ZSA+Pj4gMVxuICBpZiAoZnJvbVBvb2wpIHRoYXQucGFyZW50ID0gcm9vdFBhcmVudFxuXG4gIHJldHVybiB0aGF0XG59XG5cbmZ1bmN0aW9uIGNoZWNrZWQgKGxlbmd0aCkge1xuICAvLyBOb3RlOiBjYW5ub3QgdXNlIGBsZW5ndGggPCBrTWF4TGVuZ3RoYCBoZXJlIGJlY2F1c2UgdGhhdCBmYWlscyB3aGVuXG4gIC8vIGxlbmd0aCBpcyBOYU4gKHdoaWNoIGlzIG90aGVyd2lzZSBjb2VyY2VkIHRvIHplcm8uKVxuICBpZiAobGVuZ3RoID49IGtNYXhMZW5ndGgoKSkge1xuICAgIHRocm93IG5ldyBSYW5nZUVycm9yKCdBdHRlbXB0IHRvIGFsbG9jYXRlIEJ1ZmZlciBsYXJnZXIgdGhhbiBtYXhpbXVtICcgK1xuICAgICAgICAgICAgICAgICAgICAgICAgICdzaXplOiAweCcgKyBrTWF4TGVuZ3RoKCkudG9TdHJpbmcoMTYpICsgJyBieXRlcycpXG4gIH1cbiAgcmV0dXJuIGxlbmd0aCB8IDBcbn1cblxuZnVuY3Rpb24gU2xvd0J1ZmZlciAoc3ViamVjdCwgZW5jb2RpbmcpIHtcbiAgaWYgKCEodGhpcyBpbnN0YW5jZW9mIFNsb3dCdWZmZXIpKSByZXR1cm4gbmV3IFNsb3dCdWZmZXIoc3ViamVjdCwgZW5jb2RpbmcpXG5cbiAgdmFyIGJ1ZiA9IG5ldyBCdWZmZXIoc3ViamVjdCwgZW5jb2RpbmcpXG4gIGRlbGV0ZSBidWYucGFyZW50XG4gIHJldHVybiBidWZcbn1cblxuQnVmZmVyLmlzQnVmZmVyID0gZnVuY3Rpb24gaXNCdWZmZXIgKGIpIHtcbiAgcmV0dXJuICEhKGIgIT0gbnVsbCAmJiBiLl9pc0J1ZmZlcilcbn1cblxuQnVmZmVyLmNvbXBhcmUgPSBmdW5jdGlvbiBjb21wYXJlIChhLCBiKSB7XG4gIGlmICghQnVmZmVyLmlzQnVmZmVyKGEpIHx8ICFCdWZmZXIuaXNCdWZmZXIoYikpIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdBcmd1bWVudHMgbXVzdCBiZSBCdWZmZXJzJylcbiAgfVxuXG4gIGlmIChhID09PSBiKSByZXR1cm4gMFxuXG4gIHZhciB4ID0gYS5sZW5ndGhcbiAgdmFyIHkgPSBiLmxlbmd0aFxuXG4gIHZhciBpID0gMFxuICB2YXIgbGVuID0gTWF0aC5taW4oeCwgeSlcbiAgd2hpbGUgKGkgPCBsZW4pIHtcbiAgICBpZiAoYVtpXSAhPT0gYltpXSkgYnJlYWtcblxuICAgICsraVxuICB9XG5cbiAgaWYgKGkgIT09IGxlbikge1xuICAgIHggPSBhW2ldXG4gICAgeSA9IGJbaV1cbiAgfVxuXG4gIGlmICh4IDwgeSkgcmV0dXJuIC0xXG4gIGlmICh5IDwgeCkgcmV0dXJuIDFcbiAgcmV0dXJuIDBcbn1cblxuQnVmZmVyLmlzRW5jb2RpbmcgPSBmdW5jdGlvbiBpc0VuY29kaW5nIChlbmNvZGluZykge1xuICBzd2l0Y2ggKFN0cmluZyhlbmNvZGluZykudG9Mb3dlckNhc2UoKSkge1xuICAgIGNhc2UgJ2hleCc6XG4gICAgY2FzZSAndXRmOCc6XG4gICAgY2FzZSAndXRmLTgnOlxuICAgIGNhc2UgJ2FzY2lpJzpcbiAgICBjYXNlICdiaW5hcnknOlxuICAgIGNhc2UgJ2Jhc2U2NCc6XG4gICAgY2FzZSAncmF3JzpcbiAgICBjYXNlICd1Y3MyJzpcbiAgICBjYXNlICd1Y3MtMic6XG4gICAgY2FzZSAndXRmMTZsZSc6XG4gICAgY2FzZSAndXRmLTE2bGUnOlxuICAgICAgcmV0dXJuIHRydWVcbiAgICBkZWZhdWx0OlxuICAgICAgcmV0dXJuIGZhbHNlXG4gIH1cbn1cblxuQnVmZmVyLmNvbmNhdCA9IGZ1bmN0aW9uIGNvbmNhdCAobGlzdCwgbGVuZ3RoKSB7XG4gIGlmICghaXNBcnJheShsaXN0KSkgdGhyb3cgbmV3IFR5cGVFcnJvcignbGlzdCBhcmd1bWVudCBtdXN0IGJlIGFuIEFycmF5IG9mIEJ1ZmZlcnMuJylcblxuICBpZiAobGlzdC5sZW5ndGggPT09IDApIHtcbiAgICByZXR1cm4gbmV3IEJ1ZmZlcigwKVxuICB9IGVsc2UgaWYgKGxpc3QubGVuZ3RoID09PSAxKSB7XG4gICAgcmV0dXJuIGxpc3RbMF1cbiAgfVxuXG4gIHZhciBpXG4gIGlmIChsZW5ndGggPT09IHVuZGVmaW5lZCkge1xuICAgIGxlbmd0aCA9IDBcbiAgICBmb3IgKGkgPSAwOyBpIDwgbGlzdC5sZW5ndGg7IGkrKykge1xuICAgICAgbGVuZ3RoICs9IGxpc3RbaV0ubGVuZ3RoXG4gICAgfVxuICB9XG5cbiAgdmFyIGJ1ZiA9IG5ldyBCdWZmZXIobGVuZ3RoKVxuICB2YXIgcG9zID0gMFxuICBmb3IgKGkgPSAwOyBpIDwgbGlzdC5sZW5ndGg7IGkrKykge1xuICAgIHZhciBpdGVtID0gbGlzdFtpXVxuICAgIGl0ZW0uY29weShidWYsIHBvcylcbiAgICBwb3MgKz0gaXRlbS5sZW5ndGhcbiAgfVxuICByZXR1cm4gYnVmXG59XG5cbmZ1bmN0aW9uIGJ5dGVMZW5ndGggKHN0cmluZywgZW5jb2RpbmcpIHtcbiAgaWYgKHR5cGVvZiBzdHJpbmcgIT09ICdzdHJpbmcnKSBzdHJpbmcgPSAnJyArIHN0cmluZ1xuXG4gIHZhciBsZW4gPSBzdHJpbmcubGVuZ3RoXG4gIGlmIChsZW4gPT09IDApIHJldHVybiAwXG5cbiAgLy8gVXNlIGEgZm9yIGxvb3AgdG8gYXZvaWQgcmVjdXJzaW9uXG4gIHZhciBsb3dlcmVkQ2FzZSA9IGZhbHNlXG4gIGZvciAoOzspIHtcbiAgICBzd2l0Y2ggKGVuY29kaW5nKSB7XG4gICAgICBjYXNlICdhc2NpaSc6XG4gICAgICBjYXNlICdiaW5hcnknOlxuICAgICAgLy8gRGVwcmVjYXRlZFxuICAgICAgY2FzZSAncmF3JzpcbiAgICAgIGNhc2UgJ3Jhd3MnOlxuICAgICAgICByZXR1cm4gbGVuXG4gICAgICBjYXNlICd1dGY4JzpcbiAgICAgIGNhc2UgJ3V0Zi04JzpcbiAgICAgICAgcmV0dXJuIHV0ZjhUb0J5dGVzKHN0cmluZykubGVuZ3RoXG4gICAgICBjYXNlICd1Y3MyJzpcbiAgICAgIGNhc2UgJ3Vjcy0yJzpcbiAgICAgIGNhc2UgJ3V0ZjE2bGUnOlxuICAgICAgY2FzZSAndXRmLTE2bGUnOlxuICAgICAgICByZXR1cm4gbGVuICogMlxuICAgICAgY2FzZSAnaGV4JzpcbiAgICAgICAgcmV0dXJuIGxlbiA+Pj4gMVxuICAgICAgY2FzZSAnYmFzZTY0JzpcbiAgICAgICAgcmV0dXJuIGJhc2U2NFRvQnl0ZXMoc3RyaW5nKS5sZW5ndGhcbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIGlmIChsb3dlcmVkQ2FzZSkgcmV0dXJuIHV0ZjhUb0J5dGVzKHN0cmluZykubGVuZ3RoIC8vIGFzc3VtZSB1dGY4XG4gICAgICAgIGVuY29kaW5nID0gKCcnICsgZW5jb2RpbmcpLnRvTG93ZXJDYXNlKClcbiAgICAgICAgbG93ZXJlZENhc2UgPSB0cnVlXG4gICAgfVxuICB9XG59XG5CdWZmZXIuYnl0ZUxlbmd0aCA9IGJ5dGVMZW5ndGhcblxuLy8gcHJlLXNldCBmb3IgdmFsdWVzIHRoYXQgbWF5IGV4aXN0IGluIHRoZSBmdXR1cmVcbkJ1ZmZlci5wcm90b3R5cGUubGVuZ3RoID0gdW5kZWZpbmVkXG5CdWZmZXIucHJvdG90eXBlLnBhcmVudCA9IHVuZGVmaW5lZFxuXG5mdW5jdGlvbiBzbG93VG9TdHJpbmcgKGVuY29kaW5nLCBzdGFydCwgZW5kKSB7XG4gIHZhciBsb3dlcmVkQ2FzZSA9IGZhbHNlXG5cbiAgc3RhcnQgPSBzdGFydCB8IDBcbiAgZW5kID0gZW5kID09PSB1bmRlZmluZWQgfHwgZW5kID09PSBJbmZpbml0eSA/IHRoaXMubGVuZ3RoIDogZW5kIHwgMFxuXG4gIGlmICghZW5jb2RpbmcpIGVuY29kaW5nID0gJ3V0ZjgnXG4gIGlmIChzdGFydCA8IDApIHN0YXJ0ID0gMFxuICBpZiAoZW5kID4gdGhpcy5sZW5ndGgpIGVuZCA9IHRoaXMubGVuZ3RoXG4gIGlmIChlbmQgPD0gc3RhcnQpIHJldHVybiAnJ1xuXG4gIHdoaWxlICh0cnVlKSB7XG4gICAgc3dpdGNoIChlbmNvZGluZykge1xuICAgICAgY2FzZSAnaGV4JzpcbiAgICAgICAgcmV0dXJuIGhleFNsaWNlKHRoaXMsIHN0YXJ0LCBlbmQpXG5cbiAgICAgIGNhc2UgJ3V0ZjgnOlxuICAgICAgY2FzZSAndXRmLTgnOlxuICAgICAgICByZXR1cm4gdXRmOFNsaWNlKHRoaXMsIHN0YXJ0LCBlbmQpXG5cbiAgICAgIGNhc2UgJ2FzY2lpJzpcbiAgICAgICAgcmV0dXJuIGFzY2lpU2xpY2UodGhpcywgc3RhcnQsIGVuZClcblxuICAgICAgY2FzZSAnYmluYXJ5JzpcbiAgICAgICAgcmV0dXJuIGJpbmFyeVNsaWNlKHRoaXMsIHN0YXJ0LCBlbmQpXG5cbiAgICAgIGNhc2UgJ2Jhc2U2NCc6XG4gICAgICAgIHJldHVybiBiYXNlNjRTbGljZSh0aGlzLCBzdGFydCwgZW5kKVxuXG4gICAgICBjYXNlICd1Y3MyJzpcbiAgICAgIGNhc2UgJ3Vjcy0yJzpcbiAgICAgIGNhc2UgJ3V0ZjE2bGUnOlxuICAgICAgY2FzZSAndXRmLTE2bGUnOlxuICAgICAgICByZXR1cm4gdXRmMTZsZVNsaWNlKHRoaXMsIHN0YXJ0LCBlbmQpXG5cbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIGlmIChsb3dlcmVkQ2FzZSkgdGhyb3cgbmV3IFR5cGVFcnJvcignVW5rbm93biBlbmNvZGluZzogJyArIGVuY29kaW5nKVxuICAgICAgICBlbmNvZGluZyA9IChlbmNvZGluZyArICcnKS50b0xvd2VyQ2FzZSgpXG4gICAgICAgIGxvd2VyZWRDYXNlID0gdHJ1ZVxuICAgIH1cbiAgfVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnRvU3RyaW5nID0gZnVuY3Rpb24gdG9TdHJpbmcgKCkge1xuICB2YXIgbGVuZ3RoID0gdGhpcy5sZW5ndGggfCAwXG4gIGlmIChsZW5ndGggPT09IDApIHJldHVybiAnJ1xuICBpZiAoYXJndW1lbnRzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIHV0ZjhTbGljZSh0aGlzLCAwLCBsZW5ndGgpXG4gIHJldHVybiBzbG93VG9TdHJpbmcuYXBwbHkodGhpcywgYXJndW1lbnRzKVxufVxuXG5CdWZmZXIucHJvdG90eXBlLmVxdWFscyA9IGZ1bmN0aW9uIGVxdWFscyAoYikge1xuICBpZiAoIUJ1ZmZlci5pc0J1ZmZlcihiKSkgdGhyb3cgbmV3IFR5cGVFcnJvcignQXJndW1lbnQgbXVzdCBiZSBhIEJ1ZmZlcicpXG4gIGlmICh0aGlzID09PSBiKSByZXR1cm4gdHJ1ZVxuICByZXR1cm4gQnVmZmVyLmNvbXBhcmUodGhpcywgYikgPT09IDBcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5pbnNwZWN0ID0gZnVuY3Rpb24gaW5zcGVjdCAoKSB7XG4gIHZhciBzdHIgPSAnJ1xuICB2YXIgbWF4ID0gZXhwb3J0cy5JTlNQRUNUX01BWF9CWVRFU1xuICBpZiAodGhpcy5sZW5ndGggPiAwKSB7XG4gICAgc3RyID0gdGhpcy50b1N0cmluZygnaGV4JywgMCwgbWF4KS5tYXRjaCgvLnsyfS9nKS5qb2luKCcgJylcbiAgICBpZiAodGhpcy5sZW5ndGggPiBtYXgpIHN0ciArPSAnIC4uLiAnXG4gIH1cbiAgcmV0dXJuICc8QnVmZmVyICcgKyBzdHIgKyAnPidcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5jb21wYXJlID0gZnVuY3Rpb24gY29tcGFyZSAoYikge1xuICBpZiAoIUJ1ZmZlci5pc0J1ZmZlcihiKSkgdGhyb3cgbmV3IFR5cGVFcnJvcignQXJndW1lbnQgbXVzdCBiZSBhIEJ1ZmZlcicpXG4gIGlmICh0aGlzID09PSBiKSByZXR1cm4gMFxuICByZXR1cm4gQnVmZmVyLmNvbXBhcmUodGhpcywgYilcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5pbmRleE9mID0gZnVuY3Rpb24gaW5kZXhPZiAodmFsLCBieXRlT2Zmc2V0KSB7XG4gIGlmIChieXRlT2Zmc2V0ID4gMHg3ZmZmZmZmZikgYnl0ZU9mZnNldCA9IDB4N2ZmZmZmZmZcbiAgZWxzZSBpZiAoYnl0ZU9mZnNldCA8IC0weDgwMDAwMDAwKSBieXRlT2Zmc2V0ID0gLTB4ODAwMDAwMDBcbiAgYnl0ZU9mZnNldCA+Pj0gMFxuXG4gIGlmICh0aGlzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIC0xXG4gIGlmIChieXRlT2Zmc2V0ID49IHRoaXMubGVuZ3RoKSByZXR1cm4gLTFcblxuICAvLyBOZWdhdGl2ZSBvZmZzZXRzIHN0YXJ0IGZyb20gdGhlIGVuZCBvZiB0aGUgYnVmZmVyXG4gIGlmIChieXRlT2Zmc2V0IDwgMCkgYnl0ZU9mZnNldCA9IE1hdGgubWF4KHRoaXMubGVuZ3RoICsgYnl0ZU9mZnNldCwgMClcblxuICBpZiAodHlwZW9mIHZhbCA9PT0gJ3N0cmluZycpIHtcbiAgICBpZiAodmFsLmxlbmd0aCA9PT0gMCkgcmV0dXJuIC0xIC8vIHNwZWNpYWwgY2FzZTogbG9va2luZyBmb3IgZW1wdHkgc3RyaW5nIGFsd2F5cyBmYWlsc1xuICAgIHJldHVybiBTdHJpbmcucHJvdG90eXBlLmluZGV4T2YuY2FsbCh0aGlzLCB2YWwsIGJ5dGVPZmZzZXQpXG4gIH1cbiAgaWYgKEJ1ZmZlci5pc0J1ZmZlcih2YWwpKSB7XG4gICAgcmV0dXJuIGFycmF5SW5kZXhPZih0aGlzLCB2YWwsIGJ5dGVPZmZzZXQpXG4gIH1cbiAgaWYgKHR5cGVvZiB2YWwgPT09ICdudW1iZXInKSB7XG4gICAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUICYmIFVpbnQ4QXJyYXkucHJvdG90eXBlLmluZGV4T2YgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgIHJldHVybiBVaW50OEFycmF5LnByb3RvdHlwZS5pbmRleE9mLmNhbGwodGhpcywgdmFsLCBieXRlT2Zmc2V0KVxuICAgIH1cbiAgICByZXR1cm4gYXJyYXlJbmRleE9mKHRoaXMsIFsgdmFsIF0sIGJ5dGVPZmZzZXQpXG4gIH1cblxuICBmdW5jdGlvbiBhcnJheUluZGV4T2YgKGFyciwgdmFsLCBieXRlT2Zmc2V0KSB7XG4gICAgdmFyIGZvdW5kSW5kZXggPSAtMVxuICAgIGZvciAodmFyIGkgPSAwOyBieXRlT2Zmc2V0ICsgaSA8IGFyci5sZW5ndGg7IGkrKykge1xuICAgICAgaWYgKGFycltieXRlT2Zmc2V0ICsgaV0gPT09IHZhbFtmb3VuZEluZGV4ID09PSAtMSA/IDAgOiBpIC0gZm91bmRJbmRleF0pIHtcbiAgICAgICAgaWYgKGZvdW5kSW5kZXggPT09IC0xKSBmb3VuZEluZGV4ID0gaVxuICAgICAgICBpZiAoaSAtIGZvdW5kSW5kZXggKyAxID09PSB2YWwubGVuZ3RoKSByZXR1cm4gYnl0ZU9mZnNldCArIGZvdW5kSW5kZXhcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGZvdW5kSW5kZXggPSAtMVxuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gLTFcbiAgfVxuXG4gIHRocm93IG5ldyBUeXBlRXJyb3IoJ3ZhbCBtdXN0IGJlIHN0cmluZywgbnVtYmVyIG9yIEJ1ZmZlcicpXG59XG5cbi8vIGBnZXRgIHdpbGwgYmUgcmVtb3ZlZCBpbiBOb2RlIDAuMTMrXG5CdWZmZXIucHJvdG90eXBlLmdldCA9IGZ1bmN0aW9uIGdldCAob2Zmc2V0KSB7XG4gIGNvbnNvbGUubG9nKCcuZ2V0KCkgaXMgZGVwcmVjYXRlZC4gQWNjZXNzIHVzaW5nIGFycmF5IGluZGV4ZXMgaW5zdGVhZC4nKVxuICByZXR1cm4gdGhpcy5yZWFkVUludDgob2Zmc2V0KVxufVxuXG4vLyBgc2V0YCB3aWxsIGJlIHJlbW92ZWQgaW4gTm9kZSAwLjEzK1xuQnVmZmVyLnByb3RvdHlwZS5zZXQgPSBmdW5jdGlvbiBzZXQgKHYsIG9mZnNldCkge1xuICBjb25zb2xlLmxvZygnLnNldCgpIGlzIGRlcHJlY2F0ZWQuIEFjY2VzcyB1c2luZyBhcnJheSBpbmRleGVzIGluc3RlYWQuJylcbiAgcmV0dXJuIHRoaXMud3JpdGVVSW50OCh2LCBvZmZzZXQpXG59XG5cbmZ1bmN0aW9uIGhleFdyaXRlIChidWYsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpIHtcbiAgb2Zmc2V0ID0gTnVtYmVyKG9mZnNldCkgfHwgMFxuICB2YXIgcmVtYWluaW5nID0gYnVmLmxlbmd0aCAtIG9mZnNldFxuICBpZiAoIWxlbmd0aCkge1xuICAgIGxlbmd0aCA9IHJlbWFpbmluZ1xuICB9IGVsc2Uge1xuICAgIGxlbmd0aCA9IE51bWJlcihsZW5ndGgpXG4gICAgaWYgKGxlbmd0aCA+IHJlbWFpbmluZykge1xuICAgICAgbGVuZ3RoID0gcmVtYWluaW5nXG4gICAgfVxuICB9XG5cbiAgLy8gbXVzdCBiZSBhbiBldmVuIG51bWJlciBvZiBkaWdpdHNcbiAgdmFyIHN0ckxlbiA9IHN0cmluZy5sZW5ndGhcbiAgaWYgKHN0ckxlbiAlIDIgIT09IDApIHRocm93IG5ldyBFcnJvcignSW52YWxpZCBoZXggc3RyaW5nJylcblxuICBpZiAobGVuZ3RoID4gc3RyTGVuIC8gMikge1xuICAgIGxlbmd0aCA9IHN0ckxlbiAvIDJcbiAgfVxuICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbmd0aDsgaSsrKSB7XG4gICAgdmFyIHBhcnNlZCA9IHBhcnNlSW50KHN0cmluZy5zdWJzdHIoaSAqIDIsIDIpLCAxNilcbiAgICBpZiAoaXNOYU4ocGFyc2VkKSkgdGhyb3cgbmV3IEVycm9yKCdJbnZhbGlkIGhleCBzdHJpbmcnKVxuICAgIGJ1ZltvZmZzZXQgKyBpXSA9IHBhcnNlZFxuICB9XG4gIHJldHVybiBpXG59XG5cbmZ1bmN0aW9uIHV0ZjhXcml0ZSAoYnVmLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKSB7XG4gIHJldHVybiBibGl0QnVmZmVyKHV0ZjhUb0J5dGVzKHN0cmluZywgYnVmLmxlbmd0aCAtIG9mZnNldCksIGJ1Ziwgb2Zmc2V0LCBsZW5ndGgpXG59XG5cbmZ1bmN0aW9uIGFzY2lpV3JpdGUgKGJ1Ziwgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCkge1xuICByZXR1cm4gYmxpdEJ1ZmZlcihhc2NpaVRvQnl0ZXMoc3RyaW5nKSwgYnVmLCBvZmZzZXQsIGxlbmd0aClcbn1cblxuZnVuY3Rpb24gYmluYXJ5V3JpdGUgKGJ1Ziwgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCkge1xuICByZXR1cm4gYXNjaWlXcml0ZShidWYsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpXG59XG5cbmZ1bmN0aW9uIGJhc2U2NFdyaXRlIChidWYsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpIHtcbiAgcmV0dXJuIGJsaXRCdWZmZXIoYmFzZTY0VG9CeXRlcyhzdHJpbmcpLCBidWYsIG9mZnNldCwgbGVuZ3RoKVxufVxuXG5mdW5jdGlvbiB1Y3MyV3JpdGUgKGJ1Ziwgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCkge1xuICByZXR1cm4gYmxpdEJ1ZmZlcih1dGYxNmxlVG9CeXRlcyhzdHJpbmcsIGJ1Zi5sZW5ndGggLSBvZmZzZXQpLCBidWYsIG9mZnNldCwgbGVuZ3RoKVxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlID0gZnVuY3Rpb24gd3JpdGUgKHN0cmluZywgb2Zmc2V0LCBsZW5ndGgsIGVuY29kaW5nKSB7XG4gIC8vIEJ1ZmZlciN3cml0ZShzdHJpbmcpXG4gIGlmIChvZmZzZXQgPT09IHVuZGVmaW5lZCkge1xuICAgIGVuY29kaW5nID0gJ3V0ZjgnXG4gICAgbGVuZ3RoID0gdGhpcy5sZW5ndGhcbiAgICBvZmZzZXQgPSAwXG4gIC8vIEJ1ZmZlciN3cml0ZShzdHJpbmcsIGVuY29kaW5nKVxuICB9IGVsc2UgaWYgKGxlbmd0aCA9PT0gdW5kZWZpbmVkICYmIHR5cGVvZiBvZmZzZXQgPT09ICdzdHJpbmcnKSB7XG4gICAgZW5jb2RpbmcgPSBvZmZzZXRcbiAgICBsZW5ndGggPSB0aGlzLmxlbmd0aFxuICAgIG9mZnNldCA9IDBcbiAgLy8gQnVmZmVyI3dyaXRlKHN0cmluZywgb2Zmc2V0WywgbGVuZ3RoXVssIGVuY29kaW5nXSlcbiAgfSBlbHNlIGlmIChpc0Zpbml0ZShvZmZzZXQpKSB7XG4gICAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICAgIGlmIChpc0Zpbml0ZShsZW5ndGgpKSB7XG4gICAgICBsZW5ndGggPSBsZW5ndGggfCAwXG4gICAgICBpZiAoZW5jb2RpbmcgPT09IHVuZGVmaW5lZCkgZW5jb2RpbmcgPSAndXRmOCdcbiAgICB9IGVsc2Uge1xuICAgICAgZW5jb2RpbmcgPSBsZW5ndGhcbiAgICAgIGxlbmd0aCA9IHVuZGVmaW5lZFxuICAgIH1cbiAgLy8gbGVnYWN5IHdyaXRlKHN0cmluZywgZW5jb2RpbmcsIG9mZnNldCwgbGVuZ3RoKSAtIHJlbW92ZSBpbiB2MC4xM1xuICB9IGVsc2Uge1xuICAgIHZhciBzd2FwID0gZW5jb2RpbmdcbiAgICBlbmNvZGluZyA9IG9mZnNldFxuICAgIG9mZnNldCA9IGxlbmd0aCB8IDBcbiAgICBsZW5ndGggPSBzd2FwXG4gIH1cblxuICB2YXIgcmVtYWluaW5nID0gdGhpcy5sZW5ndGggLSBvZmZzZXRcbiAgaWYgKGxlbmd0aCA9PT0gdW5kZWZpbmVkIHx8IGxlbmd0aCA+IHJlbWFpbmluZykgbGVuZ3RoID0gcmVtYWluaW5nXG5cbiAgaWYgKChzdHJpbmcubGVuZ3RoID4gMCAmJiAobGVuZ3RoIDwgMCB8fCBvZmZzZXQgPCAwKSkgfHwgb2Zmc2V0ID4gdGhpcy5sZW5ndGgpIHtcbiAgICB0aHJvdyBuZXcgUmFuZ2VFcnJvcignYXR0ZW1wdCB0byB3cml0ZSBvdXRzaWRlIGJ1ZmZlciBib3VuZHMnKVxuICB9XG5cbiAgaWYgKCFlbmNvZGluZykgZW5jb2RpbmcgPSAndXRmOCdcblxuICB2YXIgbG93ZXJlZENhc2UgPSBmYWxzZVxuICBmb3IgKDs7KSB7XG4gICAgc3dpdGNoIChlbmNvZGluZykge1xuICAgICAgY2FzZSAnaGV4JzpcbiAgICAgICAgcmV0dXJuIGhleFdyaXRlKHRoaXMsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpXG5cbiAgICAgIGNhc2UgJ3V0ZjgnOlxuICAgICAgY2FzZSAndXRmLTgnOlxuICAgICAgICByZXR1cm4gdXRmOFdyaXRlKHRoaXMsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpXG5cbiAgICAgIGNhc2UgJ2FzY2lpJzpcbiAgICAgICAgcmV0dXJuIGFzY2lpV3JpdGUodGhpcywgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aClcblxuICAgICAgY2FzZSAnYmluYXJ5JzpcbiAgICAgICAgcmV0dXJuIGJpbmFyeVdyaXRlKHRoaXMsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpXG5cbiAgICAgIGNhc2UgJ2Jhc2U2NCc6XG4gICAgICAgIC8vIFdhcm5pbmc6IG1heExlbmd0aCBub3QgdGFrZW4gaW50byBhY2NvdW50IGluIGJhc2U2NFdyaXRlXG4gICAgICAgIHJldHVybiBiYXNlNjRXcml0ZSh0aGlzLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKVxuXG4gICAgICBjYXNlICd1Y3MyJzpcbiAgICAgIGNhc2UgJ3Vjcy0yJzpcbiAgICAgIGNhc2UgJ3V0ZjE2bGUnOlxuICAgICAgY2FzZSAndXRmLTE2bGUnOlxuICAgICAgICByZXR1cm4gdWNzMldyaXRlKHRoaXMsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpXG5cbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIGlmIChsb3dlcmVkQ2FzZSkgdGhyb3cgbmV3IFR5cGVFcnJvcignVW5rbm93biBlbmNvZGluZzogJyArIGVuY29kaW5nKVxuICAgICAgICBlbmNvZGluZyA9ICgnJyArIGVuY29kaW5nKS50b0xvd2VyQ2FzZSgpXG4gICAgICAgIGxvd2VyZWRDYXNlID0gdHJ1ZVxuICAgIH1cbiAgfVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnRvSlNPTiA9IGZ1bmN0aW9uIHRvSlNPTiAoKSB7XG4gIHJldHVybiB7XG4gICAgdHlwZTogJ0J1ZmZlcicsXG4gICAgZGF0YTogQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwodGhpcy5fYXJyIHx8IHRoaXMsIDApXG4gIH1cbn1cblxuZnVuY3Rpb24gYmFzZTY0U2xpY2UgKGJ1Ziwgc3RhcnQsIGVuZCkge1xuICBpZiAoc3RhcnQgPT09IDAgJiYgZW5kID09PSBidWYubGVuZ3RoKSB7XG4gICAgcmV0dXJuIGJhc2U2NC5mcm9tQnl0ZUFycmF5KGJ1ZilcbiAgfSBlbHNlIHtcbiAgICByZXR1cm4gYmFzZTY0LmZyb21CeXRlQXJyYXkoYnVmLnNsaWNlKHN0YXJ0LCBlbmQpKVxuICB9XG59XG5cbmZ1bmN0aW9uIHV0ZjhTbGljZSAoYnVmLCBzdGFydCwgZW5kKSB7XG4gIHZhciByZXMgPSAnJ1xuICB2YXIgdG1wID0gJydcbiAgZW5kID0gTWF0aC5taW4oYnVmLmxlbmd0aCwgZW5kKVxuXG4gIGZvciAodmFyIGkgPSBzdGFydDsgaSA8IGVuZDsgaSsrKSB7XG4gICAgaWYgKGJ1ZltpXSA8PSAweDdGKSB7XG4gICAgICByZXMgKz0gZGVjb2RlVXRmOENoYXIodG1wKSArIFN0cmluZy5mcm9tQ2hhckNvZGUoYnVmW2ldKVxuICAgICAgdG1wID0gJydcbiAgICB9IGVsc2Uge1xuICAgICAgdG1wICs9ICclJyArIGJ1ZltpXS50b1N0cmluZygxNilcbiAgICB9XG4gIH1cblxuICByZXR1cm4gcmVzICsgZGVjb2RlVXRmOENoYXIodG1wKVxufVxuXG5mdW5jdGlvbiBhc2NpaVNsaWNlIChidWYsIHN0YXJ0LCBlbmQpIHtcbiAgdmFyIHJldCA9ICcnXG4gIGVuZCA9IE1hdGgubWluKGJ1Zi5sZW5ndGgsIGVuZClcblxuICBmb3IgKHZhciBpID0gc3RhcnQ7IGkgPCBlbmQ7IGkrKykge1xuICAgIHJldCArPSBTdHJpbmcuZnJvbUNoYXJDb2RlKGJ1ZltpXSAmIDB4N0YpXG4gIH1cbiAgcmV0dXJuIHJldFxufVxuXG5mdW5jdGlvbiBiaW5hcnlTbGljZSAoYnVmLCBzdGFydCwgZW5kKSB7XG4gIHZhciByZXQgPSAnJ1xuICBlbmQgPSBNYXRoLm1pbihidWYubGVuZ3RoLCBlbmQpXG5cbiAgZm9yICh2YXIgaSA9IHN0YXJ0OyBpIDwgZW5kOyBpKyspIHtcbiAgICByZXQgKz0gU3RyaW5nLmZyb21DaGFyQ29kZShidWZbaV0pXG4gIH1cbiAgcmV0dXJuIHJldFxufVxuXG5mdW5jdGlvbiBoZXhTbGljZSAoYnVmLCBzdGFydCwgZW5kKSB7XG4gIHZhciBsZW4gPSBidWYubGVuZ3RoXG5cbiAgaWYgKCFzdGFydCB8fCBzdGFydCA8IDApIHN0YXJ0ID0gMFxuICBpZiAoIWVuZCB8fCBlbmQgPCAwIHx8IGVuZCA+IGxlbikgZW5kID0gbGVuXG5cbiAgdmFyIG91dCA9ICcnXG4gIGZvciAodmFyIGkgPSBzdGFydDsgaSA8IGVuZDsgaSsrKSB7XG4gICAgb3V0ICs9IHRvSGV4KGJ1ZltpXSlcbiAgfVxuICByZXR1cm4gb3V0XG59XG5cbmZ1bmN0aW9uIHV0ZjE2bGVTbGljZSAoYnVmLCBzdGFydCwgZW5kKSB7XG4gIHZhciBieXRlcyA9IGJ1Zi5zbGljZShzdGFydCwgZW5kKVxuICB2YXIgcmVzID0gJydcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBieXRlcy5sZW5ndGg7IGkgKz0gMikge1xuICAgIHJlcyArPSBTdHJpbmcuZnJvbUNoYXJDb2RlKGJ5dGVzW2ldICsgYnl0ZXNbaSArIDFdICogMjU2KVxuICB9XG4gIHJldHVybiByZXNcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5zbGljZSA9IGZ1bmN0aW9uIHNsaWNlIChzdGFydCwgZW5kKSB7XG4gIHZhciBsZW4gPSB0aGlzLmxlbmd0aFxuICBzdGFydCA9IH5+c3RhcnRcbiAgZW5kID0gZW5kID09PSB1bmRlZmluZWQgPyBsZW4gOiB+fmVuZFxuXG4gIGlmIChzdGFydCA8IDApIHtcbiAgICBzdGFydCArPSBsZW5cbiAgICBpZiAoc3RhcnQgPCAwKSBzdGFydCA9IDBcbiAgfSBlbHNlIGlmIChzdGFydCA+IGxlbikge1xuICAgIHN0YXJ0ID0gbGVuXG4gIH1cblxuICBpZiAoZW5kIDwgMCkge1xuICAgIGVuZCArPSBsZW5cbiAgICBpZiAoZW5kIDwgMCkgZW5kID0gMFxuICB9IGVsc2UgaWYgKGVuZCA+IGxlbikge1xuICAgIGVuZCA9IGxlblxuICB9XG5cbiAgaWYgKGVuZCA8IHN0YXJ0KSBlbmQgPSBzdGFydFxuXG4gIHZhciBuZXdCdWZcbiAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgbmV3QnVmID0gQnVmZmVyLl9hdWdtZW50KHRoaXMuc3ViYXJyYXkoc3RhcnQsIGVuZCkpXG4gIH0gZWxzZSB7XG4gICAgdmFyIHNsaWNlTGVuID0gZW5kIC0gc3RhcnRcbiAgICBuZXdCdWYgPSBuZXcgQnVmZmVyKHNsaWNlTGVuLCB1bmRlZmluZWQpXG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBzbGljZUxlbjsgaSsrKSB7XG4gICAgICBuZXdCdWZbaV0gPSB0aGlzW2kgKyBzdGFydF1cbiAgICB9XG4gIH1cblxuICBpZiAobmV3QnVmLmxlbmd0aCkgbmV3QnVmLnBhcmVudCA9IHRoaXMucGFyZW50IHx8IHRoaXNcblxuICByZXR1cm4gbmV3QnVmXG59XG5cbi8qXG4gKiBOZWVkIHRvIG1ha2Ugc3VyZSB0aGF0IGJ1ZmZlciBpc24ndCB0cnlpbmcgdG8gd3JpdGUgb3V0IG9mIGJvdW5kcy5cbiAqL1xuZnVuY3Rpb24gY2hlY2tPZmZzZXQgKG9mZnNldCwgZXh0LCBsZW5ndGgpIHtcbiAgaWYgKChvZmZzZXQgJSAxKSAhPT0gMCB8fCBvZmZzZXQgPCAwKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcignb2Zmc2V0IGlzIG5vdCB1aW50JylcbiAgaWYgKG9mZnNldCArIGV4dCA+IGxlbmd0aCkgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ1RyeWluZyB0byBhY2Nlc3MgYmV5b25kIGJ1ZmZlciBsZW5ndGgnKVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRVSW50TEUgPSBmdW5jdGlvbiByZWFkVUludExFIChvZmZzZXQsIGJ5dGVMZW5ndGgsIG5vQXNzZXJ0KSB7XG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgYnl0ZUxlbmd0aCA9IGJ5dGVMZW5ndGggfCAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgYnl0ZUxlbmd0aCwgdGhpcy5sZW5ndGgpXG5cbiAgdmFyIHZhbCA9IHRoaXNbb2Zmc2V0XVxuICB2YXIgbXVsID0gMVxuICB2YXIgaSA9IDBcbiAgd2hpbGUgKCsraSA8IGJ5dGVMZW5ndGggJiYgKG11bCAqPSAweDEwMCkpIHtcbiAgICB2YWwgKz0gdGhpc1tvZmZzZXQgKyBpXSAqIG11bFxuICB9XG5cbiAgcmV0dXJuIHZhbFxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRVSW50QkUgPSBmdW5jdGlvbiByZWFkVUludEJFIChvZmZzZXQsIGJ5dGVMZW5ndGgsIG5vQXNzZXJ0KSB7XG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgYnl0ZUxlbmd0aCA9IGJ5dGVMZW5ndGggfCAwXG4gIGlmICghbm9Bc3NlcnQpIHtcbiAgICBjaGVja09mZnNldChvZmZzZXQsIGJ5dGVMZW5ndGgsIHRoaXMubGVuZ3RoKVxuICB9XG5cbiAgdmFyIHZhbCA9IHRoaXNbb2Zmc2V0ICsgLS1ieXRlTGVuZ3RoXVxuICB2YXIgbXVsID0gMVxuICB3aGlsZSAoYnl0ZUxlbmd0aCA+IDAgJiYgKG11bCAqPSAweDEwMCkpIHtcbiAgICB2YWwgKz0gdGhpc1tvZmZzZXQgKyAtLWJ5dGVMZW5ndGhdICogbXVsXG4gIH1cblxuICByZXR1cm4gdmFsXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZFVJbnQ4ID0gZnVuY3Rpb24gcmVhZFVJbnQ4IChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgMSwgdGhpcy5sZW5ndGgpXG4gIHJldHVybiB0aGlzW29mZnNldF1cbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkVUludDE2TEUgPSBmdW5jdGlvbiByZWFkVUludDE2TEUgKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCAyLCB0aGlzLmxlbmd0aClcbiAgcmV0dXJuIHRoaXNbb2Zmc2V0XSB8ICh0aGlzW29mZnNldCArIDFdIDw8IDgpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZFVJbnQxNkJFID0gZnVuY3Rpb24gcmVhZFVJbnQxNkJFIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgMiwgdGhpcy5sZW5ndGgpXG4gIHJldHVybiAodGhpc1tvZmZzZXRdIDw8IDgpIHwgdGhpc1tvZmZzZXQgKyAxXVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRVSW50MzJMRSA9IGZ1bmN0aW9uIHJlYWRVSW50MzJMRSAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDQsIHRoaXMubGVuZ3RoKVxuXG4gIHJldHVybiAoKHRoaXNbb2Zmc2V0XSkgfFxuICAgICAgKHRoaXNbb2Zmc2V0ICsgMV0gPDwgOCkgfFxuICAgICAgKHRoaXNbb2Zmc2V0ICsgMl0gPDwgMTYpKSArXG4gICAgICAodGhpc1tvZmZzZXQgKyAzXSAqIDB4MTAwMDAwMClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkVUludDMyQkUgPSBmdW5jdGlvbiByZWFkVUludDMyQkUgKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCA0LCB0aGlzLmxlbmd0aClcblxuICByZXR1cm4gKHRoaXNbb2Zmc2V0XSAqIDB4MTAwMDAwMCkgK1xuICAgICgodGhpc1tvZmZzZXQgKyAxXSA8PCAxNikgfFxuICAgICh0aGlzW29mZnNldCArIDJdIDw8IDgpIHxcbiAgICB0aGlzW29mZnNldCArIDNdKVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRJbnRMRSA9IGZ1bmN0aW9uIHJlYWRJbnRMRSAob2Zmc2V0LCBieXRlTGVuZ3RoLCBub0Fzc2VydCkge1xuICBvZmZzZXQgPSBvZmZzZXQgfCAwXG4gIGJ5dGVMZW5ndGggPSBieXRlTGVuZ3RoIHwgMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIGJ5dGVMZW5ndGgsIHRoaXMubGVuZ3RoKVxuXG4gIHZhciB2YWwgPSB0aGlzW29mZnNldF1cbiAgdmFyIG11bCA9IDFcbiAgdmFyIGkgPSAwXG4gIHdoaWxlICgrK2kgPCBieXRlTGVuZ3RoICYmIChtdWwgKj0gMHgxMDApKSB7XG4gICAgdmFsICs9IHRoaXNbb2Zmc2V0ICsgaV0gKiBtdWxcbiAgfVxuICBtdWwgKj0gMHg4MFxuXG4gIGlmICh2YWwgPj0gbXVsKSB2YWwgLT0gTWF0aC5wb3coMiwgOCAqIGJ5dGVMZW5ndGgpXG5cbiAgcmV0dXJuIHZhbFxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRJbnRCRSA9IGZ1bmN0aW9uIHJlYWRJbnRCRSAob2Zmc2V0LCBieXRlTGVuZ3RoLCBub0Fzc2VydCkge1xuICBvZmZzZXQgPSBvZmZzZXQgfCAwXG4gIGJ5dGVMZW5ndGggPSBieXRlTGVuZ3RoIHwgMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIGJ5dGVMZW5ndGgsIHRoaXMubGVuZ3RoKVxuXG4gIHZhciBpID0gYnl0ZUxlbmd0aFxuICB2YXIgbXVsID0gMVxuICB2YXIgdmFsID0gdGhpc1tvZmZzZXQgKyAtLWldXG4gIHdoaWxlIChpID4gMCAmJiAobXVsICo9IDB4MTAwKSkge1xuICAgIHZhbCArPSB0aGlzW29mZnNldCArIC0taV0gKiBtdWxcbiAgfVxuICBtdWwgKj0gMHg4MFxuXG4gIGlmICh2YWwgPj0gbXVsKSB2YWwgLT0gTWF0aC5wb3coMiwgOCAqIGJ5dGVMZW5ndGgpXG5cbiAgcmV0dXJuIHZhbFxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRJbnQ4ID0gZnVuY3Rpb24gcmVhZEludDggKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCAxLCB0aGlzLmxlbmd0aClcbiAgaWYgKCEodGhpc1tvZmZzZXRdICYgMHg4MCkpIHJldHVybiAodGhpc1tvZmZzZXRdKVxuICByZXR1cm4gKCgweGZmIC0gdGhpc1tvZmZzZXRdICsgMSkgKiAtMSlcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkSW50MTZMRSA9IGZ1bmN0aW9uIHJlYWRJbnQxNkxFIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgMiwgdGhpcy5sZW5ndGgpXG4gIHZhciB2YWwgPSB0aGlzW29mZnNldF0gfCAodGhpc1tvZmZzZXQgKyAxXSA8PCA4KVxuICByZXR1cm4gKHZhbCAmIDB4ODAwMCkgPyB2YWwgfCAweEZGRkYwMDAwIDogdmFsXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEludDE2QkUgPSBmdW5jdGlvbiByZWFkSW50MTZCRSAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDIsIHRoaXMubGVuZ3RoKVxuICB2YXIgdmFsID0gdGhpc1tvZmZzZXQgKyAxXSB8ICh0aGlzW29mZnNldF0gPDwgOClcbiAgcmV0dXJuICh2YWwgJiAweDgwMDApID8gdmFsIHwgMHhGRkZGMDAwMCA6IHZhbFxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRJbnQzMkxFID0gZnVuY3Rpb24gcmVhZEludDMyTEUgKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCA0LCB0aGlzLmxlbmd0aClcblxuICByZXR1cm4gKHRoaXNbb2Zmc2V0XSkgfFxuICAgICh0aGlzW29mZnNldCArIDFdIDw8IDgpIHxcbiAgICAodGhpc1tvZmZzZXQgKyAyXSA8PCAxNikgfFxuICAgICh0aGlzW29mZnNldCArIDNdIDw8IDI0KVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRJbnQzMkJFID0gZnVuY3Rpb24gcmVhZEludDMyQkUgKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCA0LCB0aGlzLmxlbmd0aClcblxuICByZXR1cm4gKHRoaXNbb2Zmc2V0XSA8PCAyNCkgfFxuICAgICh0aGlzW29mZnNldCArIDFdIDw8IDE2KSB8XG4gICAgKHRoaXNbb2Zmc2V0ICsgMl0gPDwgOCkgfFxuICAgICh0aGlzW29mZnNldCArIDNdKVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRGbG9hdExFID0gZnVuY3Rpb24gcmVhZEZsb2F0TEUgKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCA0LCB0aGlzLmxlbmd0aClcbiAgcmV0dXJuIGllZWU3NTQucmVhZCh0aGlzLCBvZmZzZXQsIHRydWUsIDIzLCA0KVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRGbG9hdEJFID0gZnVuY3Rpb24gcmVhZEZsb2F0QkUgKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCA0LCB0aGlzLmxlbmd0aClcbiAgcmV0dXJuIGllZWU3NTQucmVhZCh0aGlzLCBvZmZzZXQsIGZhbHNlLCAyMywgNClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkRG91YmxlTEUgPSBmdW5jdGlvbiByZWFkRG91YmxlTEUgKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCA4LCB0aGlzLmxlbmd0aClcbiAgcmV0dXJuIGllZWU3NTQucmVhZCh0aGlzLCBvZmZzZXQsIHRydWUsIDUyLCA4KVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWREb3VibGVCRSA9IGZ1bmN0aW9uIHJlYWREb3VibGVCRSAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDgsIHRoaXMubGVuZ3RoKVxuICByZXR1cm4gaWVlZTc1NC5yZWFkKHRoaXMsIG9mZnNldCwgZmFsc2UsIDUyLCA4KVxufVxuXG5mdW5jdGlvbiBjaGVja0ludCAoYnVmLCB2YWx1ZSwgb2Zmc2V0LCBleHQsIG1heCwgbWluKSB7XG4gIGlmICghQnVmZmVyLmlzQnVmZmVyKGJ1ZikpIHRocm93IG5ldyBUeXBlRXJyb3IoJ2J1ZmZlciBtdXN0IGJlIGEgQnVmZmVyIGluc3RhbmNlJylcbiAgaWYgKHZhbHVlID4gbWF4IHx8IHZhbHVlIDwgbWluKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcigndmFsdWUgaXMgb3V0IG9mIGJvdW5kcycpXG4gIGlmIChvZmZzZXQgKyBleHQgPiBidWYubGVuZ3RoKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcignaW5kZXggb3V0IG9mIHJhbmdlJylcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZVVJbnRMRSA9IGZ1bmN0aW9uIHdyaXRlVUludExFICh2YWx1ZSwgb2Zmc2V0LCBieXRlTGVuZ3RoLCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgfCAwXG4gIGJ5dGVMZW5ndGggPSBieXRlTGVuZ3RoIHwgMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCBieXRlTGVuZ3RoLCBNYXRoLnBvdygyLCA4ICogYnl0ZUxlbmd0aCksIDApXG5cbiAgdmFyIG11bCA9IDFcbiAgdmFyIGkgPSAwXG4gIHRoaXNbb2Zmc2V0XSA9IHZhbHVlICYgMHhGRlxuICB3aGlsZSAoKytpIDwgYnl0ZUxlbmd0aCAmJiAobXVsICo9IDB4MTAwKSkge1xuICAgIHRoaXNbb2Zmc2V0ICsgaV0gPSAodmFsdWUgLyBtdWwpICYgMHhGRlxuICB9XG5cbiAgcmV0dXJuIG9mZnNldCArIGJ5dGVMZW5ndGhcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZVVJbnRCRSA9IGZ1bmN0aW9uIHdyaXRlVUludEJFICh2YWx1ZSwgb2Zmc2V0LCBieXRlTGVuZ3RoLCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgfCAwXG4gIGJ5dGVMZW5ndGggPSBieXRlTGVuZ3RoIHwgMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCBieXRlTGVuZ3RoLCBNYXRoLnBvdygyLCA4ICogYnl0ZUxlbmd0aCksIDApXG5cbiAgdmFyIGkgPSBieXRlTGVuZ3RoIC0gMVxuICB2YXIgbXVsID0gMVxuICB0aGlzW29mZnNldCArIGldID0gdmFsdWUgJiAweEZGXG4gIHdoaWxlICgtLWkgPj0gMCAmJiAobXVsICo9IDB4MTAwKSkge1xuICAgIHRoaXNbb2Zmc2V0ICsgaV0gPSAodmFsdWUgLyBtdWwpICYgMHhGRlxuICB9XG5cbiAgcmV0dXJuIG9mZnNldCArIGJ5dGVMZW5ndGhcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZVVJbnQ4ID0gZnVuY3Rpb24gd3JpdGVVSW50OCAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCAxLCAweGZmLCAwKVxuICBpZiAoIUJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB2YWx1ZSA9IE1hdGguZmxvb3IodmFsdWUpXG4gIHRoaXNbb2Zmc2V0XSA9IHZhbHVlXG4gIHJldHVybiBvZmZzZXQgKyAxXG59XG5cbmZ1bmN0aW9uIG9iamVjdFdyaXRlVUludDE2IChidWYsIHZhbHVlLCBvZmZzZXQsIGxpdHRsZUVuZGlhbikge1xuICBpZiAodmFsdWUgPCAwKSB2YWx1ZSA9IDB4ZmZmZiArIHZhbHVlICsgMVxuICBmb3IgKHZhciBpID0gMCwgaiA9IE1hdGgubWluKGJ1Zi5sZW5ndGggLSBvZmZzZXQsIDIpOyBpIDwgajsgaSsrKSB7XG4gICAgYnVmW29mZnNldCArIGldID0gKHZhbHVlICYgKDB4ZmYgPDwgKDggKiAobGl0dGxlRW5kaWFuID8gaSA6IDEgLSBpKSkpKSA+Pj5cbiAgICAgIChsaXR0bGVFbmRpYW4gPyBpIDogMSAtIGkpICogOFxuICB9XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVVSW50MTZMRSA9IGZ1bmN0aW9uIHdyaXRlVUludDE2TEUgKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgMiwgMHhmZmZmLCAwKVxuICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICB0aGlzW29mZnNldF0gPSB2YWx1ZVxuICAgIHRoaXNbb2Zmc2V0ICsgMV0gPSAodmFsdWUgPj4+IDgpXG4gIH0gZWxzZSB7XG4gICAgb2JqZWN0V3JpdGVVSW50MTYodGhpcywgdmFsdWUsIG9mZnNldCwgdHJ1ZSlcbiAgfVxuICByZXR1cm4gb2Zmc2V0ICsgMlxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlVUludDE2QkUgPSBmdW5jdGlvbiB3cml0ZVVJbnQxNkJFICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgfCAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIDIsIDB4ZmZmZiwgMClcbiAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgdGhpc1tvZmZzZXRdID0gKHZhbHVlID4+PiA4KVxuICAgIHRoaXNbb2Zmc2V0ICsgMV0gPSB2YWx1ZVxuICB9IGVsc2Uge1xuICAgIG9iamVjdFdyaXRlVUludDE2KHRoaXMsIHZhbHVlLCBvZmZzZXQsIGZhbHNlKVxuICB9XG4gIHJldHVybiBvZmZzZXQgKyAyXG59XG5cbmZ1bmN0aW9uIG9iamVjdFdyaXRlVUludDMyIChidWYsIHZhbHVlLCBvZmZzZXQsIGxpdHRsZUVuZGlhbikge1xuICBpZiAodmFsdWUgPCAwKSB2YWx1ZSA9IDB4ZmZmZmZmZmYgKyB2YWx1ZSArIDFcbiAgZm9yICh2YXIgaSA9IDAsIGogPSBNYXRoLm1pbihidWYubGVuZ3RoIC0gb2Zmc2V0LCA0KTsgaSA8IGo7IGkrKykge1xuICAgIGJ1ZltvZmZzZXQgKyBpXSA9ICh2YWx1ZSA+Pj4gKGxpdHRsZUVuZGlhbiA/IGkgOiAzIC0gaSkgKiA4KSAmIDB4ZmZcbiAgfVxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlVUludDMyTEUgPSBmdW5jdGlvbiB3cml0ZVVJbnQzMkxFICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgfCAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIDQsIDB4ZmZmZmZmZmYsIDApXG4gIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIHRoaXNbb2Zmc2V0ICsgM10gPSAodmFsdWUgPj4+IDI0KVxuICAgIHRoaXNbb2Zmc2V0ICsgMl0gPSAodmFsdWUgPj4+IDE2KVxuICAgIHRoaXNbb2Zmc2V0ICsgMV0gPSAodmFsdWUgPj4+IDgpXG4gICAgdGhpc1tvZmZzZXRdID0gdmFsdWVcbiAgfSBlbHNlIHtcbiAgICBvYmplY3RXcml0ZVVJbnQzMih0aGlzLCB2YWx1ZSwgb2Zmc2V0LCB0cnVlKVxuICB9XG4gIHJldHVybiBvZmZzZXQgKyA0XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVVSW50MzJCRSA9IGZ1bmN0aW9uIHdyaXRlVUludDMyQkUgKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgNCwgMHhmZmZmZmZmZiwgMClcbiAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgdGhpc1tvZmZzZXRdID0gKHZhbHVlID4+PiAyNClcbiAgICB0aGlzW29mZnNldCArIDFdID0gKHZhbHVlID4+PiAxNilcbiAgICB0aGlzW29mZnNldCArIDJdID0gKHZhbHVlID4+PiA4KVxuICAgIHRoaXNbb2Zmc2V0ICsgM10gPSB2YWx1ZVxuICB9IGVsc2Uge1xuICAgIG9iamVjdFdyaXRlVUludDMyKHRoaXMsIHZhbHVlLCBvZmZzZXQsIGZhbHNlKVxuICB9XG4gIHJldHVybiBvZmZzZXQgKyA0XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVJbnRMRSA9IGZ1bmN0aW9uIHdyaXRlSW50TEUgKHZhbHVlLCBvZmZzZXQsIGJ5dGVMZW5ndGgsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgaWYgKCFub0Fzc2VydCkge1xuICAgIHZhciBsaW1pdCA9IE1hdGgucG93KDIsIDggKiBieXRlTGVuZ3RoIC0gMSlcblxuICAgIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIGJ5dGVMZW5ndGgsIGxpbWl0IC0gMSwgLWxpbWl0KVxuICB9XG5cbiAgdmFyIGkgPSAwXG4gIHZhciBtdWwgPSAxXG4gIHZhciBzdWIgPSB2YWx1ZSA8IDAgPyAxIDogMFxuICB0aGlzW29mZnNldF0gPSB2YWx1ZSAmIDB4RkZcbiAgd2hpbGUgKCsraSA8IGJ5dGVMZW5ndGggJiYgKG11bCAqPSAweDEwMCkpIHtcbiAgICB0aGlzW29mZnNldCArIGldID0gKCh2YWx1ZSAvIG11bCkgPj4gMCkgLSBzdWIgJiAweEZGXG4gIH1cblxuICByZXR1cm4gb2Zmc2V0ICsgYnl0ZUxlbmd0aFxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlSW50QkUgPSBmdW5jdGlvbiB3cml0ZUludEJFICh2YWx1ZSwgb2Zmc2V0LCBieXRlTGVuZ3RoLCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgfCAwXG4gIGlmICghbm9Bc3NlcnQpIHtcbiAgICB2YXIgbGltaXQgPSBNYXRoLnBvdygyLCA4ICogYnl0ZUxlbmd0aCAtIDEpXG5cbiAgICBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCBieXRlTGVuZ3RoLCBsaW1pdCAtIDEsIC1saW1pdClcbiAgfVxuXG4gIHZhciBpID0gYnl0ZUxlbmd0aCAtIDFcbiAgdmFyIG11bCA9IDFcbiAgdmFyIHN1YiA9IHZhbHVlIDwgMCA/IDEgOiAwXG4gIHRoaXNbb2Zmc2V0ICsgaV0gPSB2YWx1ZSAmIDB4RkZcbiAgd2hpbGUgKC0taSA+PSAwICYmIChtdWwgKj0gMHgxMDApKSB7XG4gICAgdGhpc1tvZmZzZXQgKyBpXSA9ICgodmFsdWUgLyBtdWwpID4+IDApIC0gc3ViICYgMHhGRlxuICB9XG5cbiAgcmV0dXJuIG9mZnNldCArIGJ5dGVMZW5ndGhcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUludDggPSBmdW5jdGlvbiB3cml0ZUludDggKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgMSwgMHg3ZiwgLTB4ODApXG4gIGlmICghQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHZhbHVlID0gTWF0aC5mbG9vcih2YWx1ZSlcbiAgaWYgKHZhbHVlIDwgMCkgdmFsdWUgPSAweGZmICsgdmFsdWUgKyAxXG4gIHRoaXNbb2Zmc2V0XSA9IHZhbHVlXG4gIHJldHVybiBvZmZzZXQgKyAxXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVJbnQxNkxFID0gZnVuY3Rpb24gd3JpdGVJbnQxNkxFICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgfCAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIDIsIDB4N2ZmZiwgLTB4ODAwMClcbiAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgdGhpc1tvZmZzZXRdID0gdmFsdWVcbiAgICB0aGlzW29mZnNldCArIDFdID0gKHZhbHVlID4+PiA4KVxuICB9IGVsc2Uge1xuICAgIG9iamVjdFdyaXRlVUludDE2KHRoaXMsIHZhbHVlLCBvZmZzZXQsIHRydWUpXG4gIH1cbiAgcmV0dXJuIG9mZnNldCArIDJcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUludDE2QkUgPSBmdW5jdGlvbiB3cml0ZUludDE2QkUgKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgMiwgMHg3ZmZmLCAtMHg4MDAwKVxuICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICB0aGlzW29mZnNldF0gPSAodmFsdWUgPj4+IDgpXG4gICAgdGhpc1tvZmZzZXQgKyAxXSA9IHZhbHVlXG4gIH0gZWxzZSB7XG4gICAgb2JqZWN0V3JpdGVVSW50MTYodGhpcywgdmFsdWUsIG9mZnNldCwgZmFsc2UpXG4gIH1cbiAgcmV0dXJuIG9mZnNldCArIDJcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUludDMyTEUgPSBmdW5jdGlvbiB3cml0ZUludDMyTEUgKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgNCwgMHg3ZmZmZmZmZiwgLTB4ODAwMDAwMDApXG4gIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIHRoaXNbb2Zmc2V0XSA9IHZhbHVlXG4gICAgdGhpc1tvZmZzZXQgKyAxXSA9ICh2YWx1ZSA+Pj4gOClcbiAgICB0aGlzW29mZnNldCArIDJdID0gKHZhbHVlID4+PiAxNilcbiAgICB0aGlzW29mZnNldCArIDNdID0gKHZhbHVlID4+PiAyNClcbiAgfSBlbHNlIHtcbiAgICBvYmplY3RXcml0ZVVJbnQzMih0aGlzLCB2YWx1ZSwgb2Zmc2V0LCB0cnVlKVxuICB9XG4gIHJldHVybiBvZmZzZXQgKyA0XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVJbnQzMkJFID0gZnVuY3Rpb24gd3JpdGVJbnQzMkJFICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgfCAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIDQsIDB4N2ZmZmZmZmYsIC0weDgwMDAwMDAwKVxuICBpZiAodmFsdWUgPCAwKSB2YWx1ZSA9IDB4ZmZmZmZmZmYgKyB2YWx1ZSArIDFcbiAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgdGhpc1tvZmZzZXRdID0gKHZhbHVlID4+PiAyNClcbiAgICB0aGlzW29mZnNldCArIDFdID0gKHZhbHVlID4+PiAxNilcbiAgICB0aGlzW29mZnNldCArIDJdID0gKHZhbHVlID4+PiA4KVxuICAgIHRoaXNbb2Zmc2V0ICsgM10gPSB2YWx1ZVxuICB9IGVsc2Uge1xuICAgIG9iamVjdFdyaXRlVUludDMyKHRoaXMsIHZhbHVlLCBvZmZzZXQsIGZhbHNlKVxuICB9XG4gIHJldHVybiBvZmZzZXQgKyA0XG59XG5cbmZ1bmN0aW9uIGNoZWNrSUVFRTc1NCAoYnVmLCB2YWx1ZSwgb2Zmc2V0LCBleHQsIG1heCwgbWluKSB7XG4gIGlmICh2YWx1ZSA+IG1heCB8fCB2YWx1ZSA8IG1pbikgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ3ZhbHVlIGlzIG91dCBvZiBib3VuZHMnKVxuICBpZiAob2Zmc2V0ICsgZXh0ID4gYnVmLmxlbmd0aCkgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ2luZGV4IG91dCBvZiByYW5nZScpXG4gIGlmIChvZmZzZXQgPCAwKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcignaW5kZXggb3V0IG9mIHJhbmdlJylcbn1cblxuZnVuY3Rpb24gd3JpdGVGbG9hdCAoYnVmLCB2YWx1ZSwgb2Zmc2V0LCBsaXR0bGVFbmRpYW4sIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIHtcbiAgICBjaGVja0lFRUU3NTQoYnVmLCB2YWx1ZSwgb2Zmc2V0LCA0LCAzLjQwMjgyMzQ2NjM4NTI4ODZlKzM4LCAtMy40MDI4MjM0NjYzODUyODg2ZSszOClcbiAgfVxuICBpZWVlNzU0LndyaXRlKGJ1ZiwgdmFsdWUsIG9mZnNldCwgbGl0dGxlRW5kaWFuLCAyMywgNClcbiAgcmV0dXJuIG9mZnNldCArIDRcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUZsb2F0TEUgPSBmdW5jdGlvbiB3cml0ZUZsb2F0TEUgKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHJldHVybiB3cml0ZUZsb2F0KHRoaXMsIHZhbHVlLCBvZmZzZXQsIHRydWUsIG5vQXNzZXJ0KVxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlRmxvYXRCRSA9IGZ1bmN0aW9uIHdyaXRlRmxvYXRCRSAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgcmV0dXJuIHdyaXRlRmxvYXQodGhpcywgdmFsdWUsIG9mZnNldCwgZmFsc2UsIG5vQXNzZXJ0KVxufVxuXG5mdW5jdGlvbiB3cml0ZURvdWJsZSAoYnVmLCB2YWx1ZSwgb2Zmc2V0LCBsaXR0bGVFbmRpYW4sIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIHtcbiAgICBjaGVja0lFRUU3NTQoYnVmLCB2YWx1ZSwgb2Zmc2V0LCA4LCAxLjc5NzY5MzEzNDg2MjMxNTdFKzMwOCwgLTEuNzk3NjkzMTM0ODYyMzE1N0UrMzA4KVxuICB9XG4gIGllZWU3NTQud3JpdGUoYnVmLCB2YWx1ZSwgb2Zmc2V0LCBsaXR0bGVFbmRpYW4sIDUyLCA4KVxuICByZXR1cm4gb2Zmc2V0ICsgOFxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlRG91YmxlTEUgPSBmdW5jdGlvbiB3cml0ZURvdWJsZUxFICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICByZXR1cm4gd3JpdGVEb3VibGUodGhpcywgdmFsdWUsIG9mZnNldCwgdHJ1ZSwgbm9Bc3NlcnQpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVEb3VibGVCRSA9IGZ1bmN0aW9uIHdyaXRlRG91YmxlQkUgKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHJldHVybiB3cml0ZURvdWJsZSh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCBmYWxzZSwgbm9Bc3NlcnQpXG59XG5cbi8vIGNvcHkodGFyZ2V0QnVmZmVyLCB0YXJnZXRTdGFydD0wLCBzb3VyY2VTdGFydD0wLCBzb3VyY2VFbmQ9YnVmZmVyLmxlbmd0aClcbkJ1ZmZlci5wcm90b3R5cGUuY29weSA9IGZ1bmN0aW9uIGNvcHkgKHRhcmdldCwgdGFyZ2V0U3RhcnQsIHN0YXJ0LCBlbmQpIHtcbiAgaWYgKCFzdGFydCkgc3RhcnQgPSAwXG4gIGlmICghZW5kICYmIGVuZCAhPT0gMCkgZW5kID0gdGhpcy5sZW5ndGhcbiAgaWYgKHRhcmdldFN0YXJ0ID49IHRhcmdldC5sZW5ndGgpIHRhcmdldFN0YXJ0ID0gdGFyZ2V0Lmxlbmd0aFxuICBpZiAoIXRhcmdldFN0YXJ0KSB0YXJnZXRTdGFydCA9IDBcbiAgaWYgKGVuZCA+IDAgJiYgZW5kIDwgc3RhcnQpIGVuZCA9IHN0YXJ0XG5cbiAgLy8gQ29weSAwIGJ5dGVzOyB3ZSdyZSBkb25lXG4gIGlmIChlbmQgPT09IHN0YXJ0KSByZXR1cm4gMFxuICBpZiAodGFyZ2V0Lmxlbmd0aCA9PT0gMCB8fCB0aGlzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIDBcblxuICAvLyBGYXRhbCBlcnJvciBjb25kaXRpb25zXG4gIGlmICh0YXJnZXRTdGFydCA8IDApIHtcbiAgICB0aHJvdyBuZXcgUmFuZ2VFcnJvcigndGFyZ2V0U3RhcnQgb3V0IG9mIGJvdW5kcycpXG4gIH1cbiAgaWYgKHN0YXJ0IDwgMCB8fCBzdGFydCA+PSB0aGlzLmxlbmd0aCkgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ3NvdXJjZVN0YXJ0IG91dCBvZiBib3VuZHMnKVxuICBpZiAoZW5kIDwgMCkgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ3NvdXJjZUVuZCBvdXQgb2YgYm91bmRzJylcblxuICAvLyBBcmUgd2Ugb29iP1xuICBpZiAoZW5kID4gdGhpcy5sZW5ndGgpIGVuZCA9IHRoaXMubGVuZ3RoXG4gIGlmICh0YXJnZXQubGVuZ3RoIC0gdGFyZ2V0U3RhcnQgPCBlbmQgLSBzdGFydCkge1xuICAgIGVuZCA9IHRhcmdldC5sZW5ndGggLSB0YXJnZXRTdGFydCArIHN0YXJ0XG4gIH1cblxuICB2YXIgbGVuID0gZW5kIC0gc3RhcnRcblxuICBpZiAobGVuIDwgMTAwMCB8fCAhQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbjsgaSsrKSB7XG4gICAgICB0YXJnZXRbaSArIHRhcmdldFN0YXJ0XSA9IHRoaXNbaSArIHN0YXJ0XVxuICAgIH1cbiAgfSBlbHNlIHtcbiAgICB0YXJnZXQuX3NldCh0aGlzLnN1YmFycmF5KHN0YXJ0LCBzdGFydCArIGxlbiksIHRhcmdldFN0YXJ0KVxuICB9XG5cbiAgcmV0dXJuIGxlblxufVxuXG4vLyBmaWxsKHZhbHVlLCBzdGFydD0wLCBlbmQ9YnVmZmVyLmxlbmd0aClcbkJ1ZmZlci5wcm90b3R5cGUuZmlsbCA9IGZ1bmN0aW9uIGZpbGwgKHZhbHVlLCBzdGFydCwgZW5kKSB7XG4gIGlmICghdmFsdWUpIHZhbHVlID0gMFxuICBpZiAoIXN0YXJ0KSBzdGFydCA9IDBcbiAgaWYgKCFlbmQpIGVuZCA9IHRoaXMubGVuZ3RoXG5cbiAgaWYgKGVuZCA8IHN0YXJ0KSB0aHJvdyBuZXcgUmFuZ2VFcnJvcignZW5kIDwgc3RhcnQnKVxuXG4gIC8vIEZpbGwgMCBieXRlczsgd2UncmUgZG9uZVxuICBpZiAoZW5kID09PSBzdGFydCkgcmV0dXJuXG4gIGlmICh0aGlzLmxlbmd0aCA9PT0gMCkgcmV0dXJuXG5cbiAgaWYgKHN0YXJ0IDwgMCB8fCBzdGFydCA+PSB0aGlzLmxlbmd0aCkgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ3N0YXJ0IG91dCBvZiBib3VuZHMnKVxuICBpZiAoZW5kIDwgMCB8fCBlbmQgPiB0aGlzLmxlbmd0aCkgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ2VuZCBvdXQgb2YgYm91bmRzJylcblxuICB2YXIgaVxuICBpZiAodHlwZW9mIHZhbHVlID09PSAnbnVtYmVyJykge1xuICAgIGZvciAoaSA9IHN0YXJ0OyBpIDwgZW5kOyBpKyspIHtcbiAgICAgIHRoaXNbaV0gPSB2YWx1ZVxuICAgIH1cbiAgfSBlbHNlIHtcbiAgICB2YXIgYnl0ZXMgPSB1dGY4VG9CeXRlcyh2YWx1ZS50b1N0cmluZygpKVxuICAgIHZhciBsZW4gPSBieXRlcy5sZW5ndGhcbiAgICBmb3IgKGkgPSBzdGFydDsgaSA8IGVuZDsgaSsrKSB7XG4gICAgICB0aGlzW2ldID0gYnl0ZXNbaSAlIGxlbl1cbiAgICB9XG4gIH1cblxuICByZXR1cm4gdGhpc1xufVxuXG4vKipcbiAqIENyZWF0ZXMgYSBuZXcgYEFycmF5QnVmZmVyYCB3aXRoIHRoZSAqY29waWVkKiBtZW1vcnkgb2YgdGhlIGJ1ZmZlciBpbnN0YW5jZS5cbiAqIEFkZGVkIGluIE5vZGUgMC4xMi4gT25seSBhdmFpbGFibGUgaW4gYnJvd3NlcnMgdGhhdCBzdXBwb3J0IEFycmF5QnVmZmVyLlxuICovXG5CdWZmZXIucHJvdG90eXBlLnRvQXJyYXlCdWZmZXIgPSBmdW5jdGlvbiB0b0FycmF5QnVmZmVyICgpIHtcbiAgaWYgKHR5cGVvZiBVaW50OEFycmF5ICE9PSAndW5kZWZpbmVkJykge1xuICAgIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgICAgcmV0dXJuIChuZXcgQnVmZmVyKHRoaXMpKS5idWZmZXJcbiAgICB9IGVsc2Uge1xuICAgICAgdmFyIGJ1ZiA9IG5ldyBVaW50OEFycmF5KHRoaXMubGVuZ3RoKVxuICAgICAgZm9yICh2YXIgaSA9IDAsIGxlbiA9IGJ1Zi5sZW5ndGg7IGkgPCBsZW47IGkgKz0gMSkge1xuICAgICAgICBidWZbaV0gPSB0aGlzW2ldXG4gICAgICB9XG4gICAgICByZXR1cm4gYnVmLmJ1ZmZlclxuICAgIH1cbiAgfSBlbHNlIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdCdWZmZXIudG9BcnJheUJ1ZmZlciBub3Qgc3VwcG9ydGVkIGluIHRoaXMgYnJvd3NlcicpXG4gIH1cbn1cblxuLy8gSEVMUEVSIEZVTkNUSU9OU1xuLy8gPT09PT09PT09PT09PT09PVxuXG52YXIgQlAgPSBCdWZmZXIucHJvdG90eXBlXG5cbi8qKlxuICogQXVnbWVudCBhIFVpbnQ4QXJyYXkgKmluc3RhbmNlKiAobm90IHRoZSBVaW50OEFycmF5IGNsYXNzISkgd2l0aCBCdWZmZXIgbWV0aG9kc1xuICovXG5CdWZmZXIuX2F1Z21lbnQgPSBmdW5jdGlvbiBfYXVnbWVudCAoYXJyKSB7XG4gIGFyci5jb25zdHJ1Y3RvciA9IEJ1ZmZlclxuICBhcnIuX2lzQnVmZmVyID0gdHJ1ZVxuXG4gIC8vIHNhdmUgcmVmZXJlbmNlIHRvIG9yaWdpbmFsIFVpbnQ4QXJyYXkgc2V0IG1ldGhvZCBiZWZvcmUgb3ZlcndyaXRpbmdcbiAgYXJyLl9zZXQgPSBhcnIuc2V0XG5cbiAgLy8gZGVwcmVjYXRlZCwgd2lsbCBiZSByZW1vdmVkIGluIG5vZGUgMC4xMytcbiAgYXJyLmdldCA9IEJQLmdldFxuICBhcnIuc2V0ID0gQlAuc2V0XG5cbiAgYXJyLndyaXRlID0gQlAud3JpdGVcbiAgYXJyLnRvU3RyaW5nID0gQlAudG9TdHJpbmdcbiAgYXJyLnRvTG9jYWxlU3RyaW5nID0gQlAudG9TdHJpbmdcbiAgYXJyLnRvSlNPTiA9IEJQLnRvSlNPTlxuICBhcnIuZXF1YWxzID0gQlAuZXF1YWxzXG4gIGFyci5jb21wYXJlID0gQlAuY29tcGFyZVxuICBhcnIuaW5kZXhPZiA9IEJQLmluZGV4T2ZcbiAgYXJyLmNvcHkgPSBCUC5jb3B5XG4gIGFyci5zbGljZSA9IEJQLnNsaWNlXG4gIGFyci5yZWFkVUludExFID0gQlAucmVhZFVJbnRMRVxuICBhcnIucmVhZFVJbnRCRSA9IEJQLnJlYWRVSW50QkVcbiAgYXJyLnJlYWRVSW50OCA9IEJQLnJlYWRVSW50OFxuICBhcnIucmVhZFVJbnQxNkxFID0gQlAucmVhZFVJbnQxNkxFXG4gIGFyci5yZWFkVUludDE2QkUgPSBCUC5yZWFkVUludDE2QkVcbiAgYXJyLnJlYWRVSW50MzJMRSA9IEJQLnJlYWRVSW50MzJMRVxuICBhcnIucmVhZFVJbnQzMkJFID0gQlAucmVhZFVJbnQzMkJFXG4gIGFyci5yZWFkSW50TEUgPSBCUC5yZWFkSW50TEVcbiAgYXJyLnJlYWRJbnRCRSA9IEJQLnJlYWRJbnRCRVxuICBhcnIucmVhZEludDggPSBCUC5yZWFkSW50OFxuICBhcnIucmVhZEludDE2TEUgPSBCUC5yZWFkSW50MTZMRVxuICBhcnIucmVhZEludDE2QkUgPSBCUC5yZWFkSW50MTZCRVxuICBhcnIucmVhZEludDMyTEUgPSBCUC5yZWFkSW50MzJMRVxuICBhcnIucmVhZEludDMyQkUgPSBCUC5yZWFkSW50MzJCRVxuICBhcnIucmVhZEZsb2F0TEUgPSBCUC5yZWFkRmxvYXRMRVxuICBhcnIucmVhZEZsb2F0QkUgPSBCUC5yZWFkRmxvYXRCRVxuICBhcnIucmVhZERvdWJsZUxFID0gQlAucmVhZERvdWJsZUxFXG4gIGFyci5yZWFkRG91YmxlQkUgPSBCUC5yZWFkRG91YmxlQkVcbiAgYXJyLndyaXRlVUludDggPSBCUC53cml0ZVVJbnQ4XG4gIGFyci53cml0ZVVJbnRMRSA9IEJQLndyaXRlVUludExFXG4gIGFyci53cml0ZVVJbnRCRSA9IEJQLndyaXRlVUludEJFXG4gIGFyci53cml0ZVVJbnQxNkxFID0gQlAud3JpdGVVSW50MTZMRVxuICBhcnIud3JpdGVVSW50MTZCRSA9IEJQLndyaXRlVUludDE2QkVcbiAgYXJyLndyaXRlVUludDMyTEUgPSBCUC53cml0ZVVJbnQzMkxFXG4gIGFyci53cml0ZVVJbnQzMkJFID0gQlAud3JpdGVVSW50MzJCRVxuICBhcnIud3JpdGVJbnRMRSA9IEJQLndyaXRlSW50TEVcbiAgYXJyLndyaXRlSW50QkUgPSBCUC53cml0ZUludEJFXG4gIGFyci53cml0ZUludDggPSBCUC53cml0ZUludDhcbiAgYXJyLndyaXRlSW50MTZMRSA9IEJQLndyaXRlSW50MTZMRVxuICBhcnIud3JpdGVJbnQxNkJFID0gQlAud3JpdGVJbnQxNkJFXG4gIGFyci53cml0ZUludDMyTEUgPSBCUC53cml0ZUludDMyTEVcbiAgYXJyLndyaXRlSW50MzJCRSA9IEJQLndyaXRlSW50MzJCRVxuICBhcnIud3JpdGVGbG9hdExFID0gQlAud3JpdGVGbG9hdExFXG4gIGFyci53cml0ZUZsb2F0QkUgPSBCUC53cml0ZUZsb2F0QkVcbiAgYXJyLndyaXRlRG91YmxlTEUgPSBCUC53cml0ZURvdWJsZUxFXG4gIGFyci53cml0ZURvdWJsZUJFID0gQlAud3JpdGVEb3VibGVCRVxuICBhcnIuZmlsbCA9IEJQLmZpbGxcbiAgYXJyLmluc3BlY3QgPSBCUC5pbnNwZWN0XG4gIGFyci50b0FycmF5QnVmZmVyID0gQlAudG9BcnJheUJ1ZmZlclxuXG4gIHJldHVybiBhcnJcbn1cblxudmFyIElOVkFMSURfQkFTRTY0X1JFID0gL1teK1xcLzAtOUEtelxcLV0vZ1xuXG5mdW5jdGlvbiBiYXNlNjRjbGVhbiAoc3RyKSB7XG4gIC8vIE5vZGUgc3RyaXBzIG91dCBpbnZhbGlkIGNoYXJhY3RlcnMgbGlrZSBcXG4gYW5kIFxcdCBmcm9tIHRoZSBzdHJpbmcsIGJhc2U2NC1qcyBkb2VzIG5vdFxuICBzdHIgPSBzdHJpbmd0cmltKHN0cikucmVwbGFjZShJTlZBTElEX0JBU0U2NF9SRSwgJycpXG4gIC8vIE5vZGUgY29udmVydHMgc3RyaW5ncyB3aXRoIGxlbmd0aCA8IDIgdG8gJydcbiAgaWYgKHN0ci5sZW5ndGggPCAyKSByZXR1cm4gJydcbiAgLy8gTm9kZSBhbGxvd3MgZm9yIG5vbi1wYWRkZWQgYmFzZTY0IHN0cmluZ3MgKG1pc3NpbmcgdHJhaWxpbmcgPT09KSwgYmFzZTY0LWpzIGRvZXMgbm90XG4gIHdoaWxlIChzdHIubGVuZ3RoICUgNCAhPT0gMCkge1xuICAgIHN0ciA9IHN0ciArICc9J1xuICB9XG4gIHJldHVybiBzdHJcbn1cblxuZnVuY3Rpb24gc3RyaW5ndHJpbSAoc3RyKSB7XG4gIGlmIChzdHIudHJpbSkgcmV0dXJuIHN0ci50cmltKClcbiAgcmV0dXJuIHN0ci5yZXBsYWNlKC9eXFxzK3xcXHMrJC9nLCAnJylcbn1cblxuZnVuY3Rpb24gdG9IZXggKG4pIHtcbiAgaWYgKG4gPCAxNikgcmV0dXJuICcwJyArIG4udG9TdHJpbmcoMTYpXG4gIHJldHVybiBuLnRvU3RyaW5nKDE2KVxufVxuXG5mdW5jdGlvbiB1dGY4VG9CeXRlcyAoc3RyaW5nLCB1bml0cykge1xuICB1bml0cyA9IHVuaXRzIHx8IEluZmluaXR5XG4gIHZhciBjb2RlUG9pbnRcbiAgdmFyIGxlbmd0aCA9IHN0cmluZy5sZW5ndGhcbiAgdmFyIGxlYWRTdXJyb2dhdGUgPSBudWxsXG4gIHZhciBieXRlcyA9IFtdXG4gIHZhciBpID0gMFxuXG4gIGZvciAoOyBpIDwgbGVuZ3RoOyBpKyspIHtcbiAgICBjb2RlUG9pbnQgPSBzdHJpbmcuY2hhckNvZGVBdChpKVxuXG4gICAgLy8gaXMgc3Vycm9nYXRlIGNvbXBvbmVudFxuICAgIGlmIChjb2RlUG9pbnQgPiAweEQ3RkYgJiYgY29kZVBvaW50IDwgMHhFMDAwKSB7XG4gICAgICAvLyBsYXN0IGNoYXIgd2FzIGEgbGVhZFxuICAgICAgaWYgKGxlYWRTdXJyb2dhdGUpIHtcbiAgICAgICAgLy8gMiBsZWFkcyBpbiBhIHJvd1xuICAgICAgICBpZiAoY29kZVBvaW50IDwgMHhEQzAwKSB7XG4gICAgICAgICAgaWYgKCh1bml0cyAtPSAzKSA+IC0xKSBieXRlcy5wdXNoKDB4RUYsIDB4QkYsIDB4QkQpXG4gICAgICAgICAgbGVhZFN1cnJvZ2F0ZSA9IGNvZGVQb2ludFxuICAgICAgICAgIGNvbnRpbnVlXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgLy8gdmFsaWQgc3Vycm9nYXRlIHBhaXJcbiAgICAgICAgICBjb2RlUG9pbnQgPSBsZWFkU3Vycm9nYXRlIC0gMHhEODAwIDw8IDEwIHwgY29kZVBvaW50IC0gMHhEQzAwIHwgMHgxMDAwMFxuICAgICAgICAgIGxlYWRTdXJyb2dhdGUgPSBudWxsXG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIG5vIGxlYWQgeWV0XG5cbiAgICAgICAgaWYgKGNvZGVQb2ludCA+IDB4REJGRikge1xuICAgICAgICAgIC8vIHVuZXhwZWN0ZWQgdHJhaWxcbiAgICAgICAgICBpZiAoKHVuaXRzIC09IDMpID4gLTEpIGJ5dGVzLnB1c2goMHhFRiwgMHhCRiwgMHhCRClcbiAgICAgICAgICBjb250aW51ZVxuICAgICAgICB9IGVsc2UgaWYgKGkgKyAxID09PSBsZW5ndGgpIHtcbiAgICAgICAgICAvLyB1bnBhaXJlZCBsZWFkXG4gICAgICAgICAgaWYgKCh1bml0cyAtPSAzKSA+IC0xKSBieXRlcy5wdXNoKDB4RUYsIDB4QkYsIDB4QkQpXG4gICAgICAgICAgY29udGludWVcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAvLyB2YWxpZCBsZWFkXG4gICAgICAgICAgbGVhZFN1cnJvZ2F0ZSA9IGNvZGVQb2ludFxuICAgICAgICAgIGNvbnRpbnVlXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKGxlYWRTdXJyb2dhdGUpIHtcbiAgICAgIC8vIHZhbGlkIGJtcCBjaGFyLCBidXQgbGFzdCBjaGFyIHdhcyBhIGxlYWRcbiAgICAgIGlmICgodW5pdHMgLT0gMykgPiAtMSkgYnl0ZXMucHVzaCgweEVGLCAweEJGLCAweEJEKVxuICAgICAgbGVhZFN1cnJvZ2F0ZSA9IG51bGxcbiAgICB9XG5cbiAgICAvLyBlbmNvZGUgdXRmOFxuICAgIGlmIChjb2RlUG9pbnQgPCAweDgwKSB7XG4gICAgICBpZiAoKHVuaXRzIC09IDEpIDwgMCkgYnJlYWtcbiAgICAgIGJ5dGVzLnB1c2goY29kZVBvaW50KVxuICAgIH0gZWxzZSBpZiAoY29kZVBvaW50IDwgMHg4MDApIHtcbiAgICAgIGlmICgodW5pdHMgLT0gMikgPCAwKSBicmVha1xuICAgICAgYnl0ZXMucHVzaChcbiAgICAgICAgY29kZVBvaW50ID4+IDB4NiB8IDB4QzAsXG4gICAgICAgIGNvZGVQb2ludCAmIDB4M0YgfCAweDgwXG4gICAgICApXG4gICAgfSBlbHNlIGlmIChjb2RlUG9pbnQgPCAweDEwMDAwKSB7XG4gICAgICBpZiAoKHVuaXRzIC09IDMpIDwgMCkgYnJlYWtcbiAgICAgIGJ5dGVzLnB1c2goXG4gICAgICAgIGNvZGVQb2ludCA+PiAweEMgfCAweEUwLFxuICAgICAgICBjb2RlUG9pbnQgPj4gMHg2ICYgMHgzRiB8IDB4ODAsXG4gICAgICAgIGNvZGVQb2ludCAmIDB4M0YgfCAweDgwXG4gICAgICApXG4gICAgfSBlbHNlIGlmIChjb2RlUG9pbnQgPCAweDIwMDAwMCkge1xuICAgICAgaWYgKCh1bml0cyAtPSA0KSA8IDApIGJyZWFrXG4gICAgICBieXRlcy5wdXNoKFxuICAgICAgICBjb2RlUG9pbnQgPj4gMHgxMiB8IDB4RjAsXG4gICAgICAgIGNvZGVQb2ludCA+PiAweEMgJiAweDNGIHwgMHg4MCxcbiAgICAgICAgY29kZVBvaW50ID4+IDB4NiAmIDB4M0YgfCAweDgwLFxuICAgICAgICBjb2RlUG9pbnQgJiAweDNGIHwgMHg4MFxuICAgICAgKVxuICAgIH0gZWxzZSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0ludmFsaWQgY29kZSBwb2ludCcpXG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIGJ5dGVzXG59XG5cbmZ1bmN0aW9uIGFzY2lpVG9CeXRlcyAoc3RyKSB7XG4gIHZhciBieXRlQXJyYXkgPSBbXVxuICBmb3IgKHZhciBpID0gMDsgaSA8IHN0ci5sZW5ndGg7IGkrKykge1xuICAgIC8vIE5vZGUncyBjb2RlIHNlZW1zIHRvIGJlIGRvaW5nIHRoaXMgYW5kIG5vdCAmIDB4N0YuLlxuICAgIGJ5dGVBcnJheS5wdXNoKHN0ci5jaGFyQ29kZUF0KGkpICYgMHhGRilcbiAgfVxuICByZXR1cm4gYnl0ZUFycmF5XG59XG5cbmZ1bmN0aW9uIHV0ZjE2bGVUb0J5dGVzIChzdHIsIHVuaXRzKSB7XG4gIHZhciBjLCBoaSwgbG9cbiAgdmFyIGJ5dGVBcnJheSA9IFtdXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgc3RyLmxlbmd0aDsgaSsrKSB7XG4gICAgaWYgKCh1bml0cyAtPSAyKSA8IDApIGJyZWFrXG5cbiAgICBjID0gc3RyLmNoYXJDb2RlQXQoaSlcbiAgICBoaSA9IGMgPj4gOFxuICAgIGxvID0gYyAlIDI1NlxuICAgIGJ5dGVBcnJheS5wdXNoKGxvKVxuICAgIGJ5dGVBcnJheS5wdXNoKGhpKVxuICB9XG5cbiAgcmV0dXJuIGJ5dGVBcnJheVxufVxuXG5mdW5jdGlvbiBiYXNlNjRUb0J5dGVzIChzdHIpIHtcbiAgcmV0dXJuIGJhc2U2NC50b0J5dGVBcnJheShiYXNlNjRjbGVhbihzdHIpKVxufVxuXG5mdW5jdGlvbiBibGl0QnVmZmVyIChzcmMsIGRzdCwgb2Zmc2V0LCBsZW5ndGgpIHtcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW5ndGg7IGkrKykge1xuICAgIGlmICgoaSArIG9mZnNldCA+PSBkc3QubGVuZ3RoKSB8fCAoaSA+PSBzcmMubGVuZ3RoKSkgYnJlYWtcbiAgICBkc3RbaSArIG9mZnNldF0gPSBzcmNbaV1cbiAgfVxuICByZXR1cm4gaVxufVxuXG5mdW5jdGlvbiBkZWNvZGVVdGY4Q2hhciAoc3RyKSB7XG4gIHRyeSB7XG4gICAgcmV0dXJuIGRlY29kZVVSSUNvbXBvbmVudChzdHIpXG4gIH0gY2F0Y2ggKGVycikge1xuICAgIHJldHVybiBTdHJpbmcuZnJvbUNoYXJDb2RlKDB4RkZGRCkgLy8gVVRGIDggaW52YWxpZCBjaGFyXG4gIH1cbn1cbiIsInZhciBsb29rdXAgPSAnQUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVphYmNkZWZnaGlqa2xtbm9wcXJzdHV2d3h5ejAxMjM0NTY3ODkrLyc7XG5cbjsoZnVuY3Rpb24gKGV4cG9ydHMpIHtcblx0J3VzZSBzdHJpY3QnO1xuXG4gIHZhciBBcnIgPSAodHlwZW9mIFVpbnQ4QXJyYXkgIT09ICd1bmRlZmluZWQnKVxuICAgID8gVWludDhBcnJheVxuICAgIDogQXJyYXlcblxuXHR2YXIgUExVUyAgID0gJysnLmNoYXJDb2RlQXQoMClcblx0dmFyIFNMQVNIICA9ICcvJy5jaGFyQ29kZUF0KDApXG5cdHZhciBOVU1CRVIgPSAnMCcuY2hhckNvZGVBdCgwKVxuXHR2YXIgTE9XRVIgID0gJ2EnLmNoYXJDb2RlQXQoMClcblx0dmFyIFVQUEVSICA9ICdBJy5jaGFyQ29kZUF0KDApXG5cdHZhciBQTFVTX1VSTF9TQUZFID0gJy0nLmNoYXJDb2RlQXQoMClcblx0dmFyIFNMQVNIX1VSTF9TQUZFID0gJ18nLmNoYXJDb2RlQXQoMClcblxuXHRmdW5jdGlvbiBkZWNvZGUgKGVsdCkge1xuXHRcdHZhciBjb2RlID0gZWx0LmNoYXJDb2RlQXQoMClcblx0XHRpZiAoY29kZSA9PT0gUExVUyB8fFxuXHRcdCAgICBjb2RlID09PSBQTFVTX1VSTF9TQUZFKVxuXHRcdFx0cmV0dXJuIDYyIC8vICcrJ1xuXHRcdGlmIChjb2RlID09PSBTTEFTSCB8fFxuXHRcdCAgICBjb2RlID09PSBTTEFTSF9VUkxfU0FGRSlcblx0XHRcdHJldHVybiA2MyAvLyAnLydcblx0XHRpZiAoY29kZSA8IE5VTUJFUilcblx0XHRcdHJldHVybiAtMSAvL25vIG1hdGNoXG5cdFx0aWYgKGNvZGUgPCBOVU1CRVIgKyAxMClcblx0XHRcdHJldHVybiBjb2RlIC0gTlVNQkVSICsgMjYgKyAyNlxuXHRcdGlmIChjb2RlIDwgVVBQRVIgKyAyNilcblx0XHRcdHJldHVybiBjb2RlIC0gVVBQRVJcblx0XHRpZiAoY29kZSA8IExPV0VSICsgMjYpXG5cdFx0XHRyZXR1cm4gY29kZSAtIExPV0VSICsgMjZcblx0fVxuXG5cdGZ1bmN0aW9uIGI2NFRvQnl0ZUFycmF5IChiNjQpIHtcblx0XHR2YXIgaSwgaiwgbCwgdG1wLCBwbGFjZUhvbGRlcnMsIGFyclxuXG5cdFx0aWYgKGI2NC5sZW5ndGggJSA0ID4gMCkge1xuXHRcdFx0dGhyb3cgbmV3IEVycm9yKCdJbnZhbGlkIHN0cmluZy4gTGVuZ3RoIG11c3QgYmUgYSBtdWx0aXBsZSBvZiA0Jylcblx0XHR9XG5cblx0XHQvLyB0aGUgbnVtYmVyIG9mIGVxdWFsIHNpZ25zIChwbGFjZSBob2xkZXJzKVxuXHRcdC8vIGlmIHRoZXJlIGFyZSB0d28gcGxhY2Vob2xkZXJzLCB0aGFuIHRoZSB0d28gY2hhcmFjdGVycyBiZWZvcmUgaXRcblx0XHQvLyByZXByZXNlbnQgb25lIGJ5dGVcblx0XHQvLyBpZiB0aGVyZSBpcyBvbmx5IG9uZSwgdGhlbiB0aGUgdGhyZWUgY2hhcmFjdGVycyBiZWZvcmUgaXQgcmVwcmVzZW50IDIgYnl0ZXNcblx0XHQvLyB0aGlzIGlzIGp1c3QgYSBjaGVhcCBoYWNrIHRvIG5vdCBkbyBpbmRleE9mIHR3aWNlXG5cdFx0dmFyIGxlbiA9IGI2NC5sZW5ndGhcblx0XHRwbGFjZUhvbGRlcnMgPSAnPScgPT09IGI2NC5jaGFyQXQobGVuIC0gMikgPyAyIDogJz0nID09PSBiNjQuY2hhckF0KGxlbiAtIDEpID8gMSA6IDBcblxuXHRcdC8vIGJhc2U2NCBpcyA0LzMgKyB1cCB0byB0d28gY2hhcmFjdGVycyBvZiB0aGUgb3JpZ2luYWwgZGF0YVxuXHRcdGFyciA9IG5ldyBBcnIoYjY0Lmxlbmd0aCAqIDMgLyA0IC0gcGxhY2VIb2xkZXJzKVxuXG5cdFx0Ly8gaWYgdGhlcmUgYXJlIHBsYWNlaG9sZGVycywgb25seSBnZXQgdXAgdG8gdGhlIGxhc3QgY29tcGxldGUgNCBjaGFyc1xuXHRcdGwgPSBwbGFjZUhvbGRlcnMgPiAwID8gYjY0Lmxlbmd0aCAtIDQgOiBiNjQubGVuZ3RoXG5cblx0XHR2YXIgTCA9IDBcblxuXHRcdGZ1bmN0aW9uIHB1c2ggKHYpIHtcblx0XHRcdGFycltMKytdID0gdlxuXHRcdH1cblxuXHRcdGZvciAoaSA9IDAsIGogPSAwOyBpIDwgbDsgaSArPSA0LCBqICs9IDMpIHtcblx0XHRcdHRtcCA9IChkZWNvZGUoYjY0LmNoYXJBdChpKSkgPDwgMTgpIHwgKGRlY29kZShiNjQuY2hhckF0KGkgKyAxKSkgPDwgMTIpIHwgKGRlY29kZShiNjQuY2hhckF0KGkgKyAyKSkgPDwgNikgfCBkZWNvZGUoYjY0LmNoYXJBdChpICsgMykpXG5cdFx0XHRwdXNoKCh0bXAgJiAweEZGMDAwMCkgPj4gMTYpXG5cdFx0XHRwdXNoKCh0bXAgJiAweEZGMDApID4+IDgpXG5cdFx0XHRwdXNoKHRtcCAmIDB4RkYpXG5cdFx0fVxuXG5cdFx0aWYgKHBsYWNlSG9sZGVycyA9PT0gMikge1xuXHRcdFx0dG1wID0gKGRlY29kZShiNjQuY2hhckF0KGkpKSA8PCAyKSB8IChkZWNvZGUoYjY0LmNoYXJBdChpICsgMSkpID4+IDQpXG5cdFx0XHRwdXNoKHRtcCAmIDB4RkYpXG5cdFx0fSBlbHNlIGlmIChwbGFjZUhvbGRlcnMgPT09IDEpIHtcblx0XHRcdHRtcCA9IChkZWNvZGUoYjY0LmNoYXJBdChpKSkgPDwgMTApIHwgKGRlY29kZShiNjQuY2hhckF0KGkgKyAxKSkgPDwgNCkgfCAoZGVjb2RlKGI2NC5jaGFyQXQoaSArIDIpKSA+PiAyKVxuXHRcdFx0cHVzaCgodG1wID4+IDgpICYgMHhGRilcblx0XHRcdHB1c2godG1wICYgMHhGRilcblx0XHR9XG5cblx0XHRyZXR1cm4gYXJyXG5cdH1cblxuXHRmdW5jdGlvbiB1aW50OFRvQmFzZTY0ICh1aW50OCkge1xuXHRcdHZhciBpLFxuXHRcdFx0ZXh0cmFCeXRlcyA9IHVpbnQ4Lmxlbmd0aCAlIDMsIC8vIGlmIHdlIGhhdmUgMSBieXRlIGxlZnQsIHBhZCAyIGJ5dGVzXG5cdFx0XHRvdXRwdXQgPSBcIlwiLFxuXHRcdFx0dGVtcCwgbGVuZ3RoXG5cblx0XHRmdW5jdGlvbiBlbmNvZGUgKG51bSkge1xuXHRcdFx0cmV0dXJuIGxvb2t1cC5jaGFyQXQobnVtKVxuXHRcdH1cblxuXHRcdGZ1bmN0aW9uIHRyaXBsZXRUb0Jhc2U2NCAobnVtKSB7XG5cdFx0XHRyZXR1cm4gZW5jb2RlKG51bSA+PiAxOCAmIDB4M0YpICsgZW5jb2RlKG51bSA+PiAxMiAmIDB4M0YpICsgZW5jb2RlKG51bSA+PiA2ICYgMHgzRikgKyBlbmNvZGUobnVtICYgMHgzRilcblx0XHR9XG5cblx0XHQvLyBnbyB0aHJvdWdoIHRoZSBhcnJheSBldmVyeSB0aHJlZSBieXRlcywgd2UnbGwgZGVhbCB3aXRoIHRyYWlsaW5nIHN0dWZmIGxhdGVyXG5cdFx0Zm9yIChpID0gMCwgbGVuZ3RoID0gdWludDgubGVuZ3RoIC0gZXh0cmFCeXRlczsgaSA8IGxlbmd0aDsgaSArPSAzKSB7XG5cdFx0XHR0ZW1wID0gKHVpbnQ4W2ldIDw8IDE2KSArICh1aW50OFtpICsgMV0gPDwgOCkgKyAodWludDhbaSArIDJdKVxuXHRcdFx0b3V0cHV0ICs9IHRyaXBsZXRUb0Jhc2U2NCh0ZW1wKVxuXHRcdH1cblxuXHRcdC8vIHBhZCB0aGUgZW5kIHdpdGggemVyb3MsIGJ1dCBtYWtlIHN1cmUgdG8gbm90IGZvcmdldCB0aGUgZXh0cmEgYnl0ZXNcblx0XHRzd2l0Y2ggKGV4dHJhQnl0ZXMpIHtcblx0XHRcdGNhc2UgMTpcblx0XHRcdFx0dGVtcCA9IHVpbnQ4W3VpbnQ4Lmxlbmd0aCAtIDFdXG5cdFx0XHRcdG91dHB1dCArPSBlbmNvZGUodGVtcCA+PiAyKVxuXHRcdFx0XHRvdXRwdXQgKz0gZW5jb2RlKCh0ZW1wIDw8IDQpICYgMHgzRilcblx0XHRcdFx0b3V0cHV0ICs9ICc9PSdcblx0XHRcdFx0YnJlYWtcblx0XHRcdGNhc2UgMjpcblx0XHRcdFx0dGVtcCA9ICh1aW50OFt1aW50OC5sZW5ndGggLSAyXSA8PCA4KSArICh1aW50OFt1aW50OC5sZW5ndGggLSAxXSlcblx0XHRcdFx0b3V0cHV0ICs9IGVuY29kZSh0ZW1wID4+IDEwKVxuXHRcdFx0XHRvdXRwdXQgKz0gZW5jb2RlKCh0ZW1wID4+IDQpICYgMHgzRilcblx0XHRcdFx0b3V0cHV0ICs9IGVuY29kZSgodGVtcCA8PCAyKSAmIDB4M0YpXG5cdFx0XHRcdG91dHB1dCArPSAnPSdcblx0XHRcdFx0YnJlYWtcblx0XHR9XG5cblx0XHRyZXR1cm4gb3V0cHV0XG5cdH1cblxuXHRleHBvcnRzLnRvQnl0ZUFycmF5ID0gYjY0VG9CeXRlQXJyYXlcblx0ZXhwb3J0cy5mcm9tQnl0ZUFycmF5ID0gdWludDhUb0Jhc2U2NFxufSh0eXBlb2YgZXhwb3J0cyA9PT0gJ3VuZGVmaW5lZCcgPyAodGhpcy5iYXNlNjRqcyA9IHt9KSA6IGV4cG9ydHMpKVxuIiwiZXhwb3J0cy5yZWFkID0gZnVuY3Rpb24gKGJ1ZmZlciwgb2Zmc2V0LCBpc0xFLCBtTGVuLCBuQnl0ZXMpIHtcbiAgdmFyIGUsIG1cbiAgdmFyIGVMZW4gPSBuQnl0ZXMgKiA4IC0gbUxlbiAtIDFcbiAgdmFyIGVNYXggPSAoMSA8PCBlTGVuKSAtIDFcbiAgdmFyIGVCaWFzID0gZU1heCA+PiAxXG4gIHZhciBuQml0cyA9IC03XG4gIHZhciBpID0gaXNMRSA/IChuQnl0ZXMgLSAxKSA6IDBcbiAgdmFyIGQgPSBpc0xFID8gLTEgOiAxXG4gIHZhciBzID0gYnVmZmVyW29mZnNldCArIGldXG5cbiAgaSArPSBkXG5cbiAgZSA9IHMgJiAoKDEgPDwgKC1uQml0cykpIC0gMSlcbiAgcyA+Pj0gKC1uQml0cylcbiAgbkJpdHMgKz0gZUxlblxuICBmb3IgKDsgbkJpdHMgPiAwOyBlID0gZSAqIDI1NiArIGJ1ZmZlcltvZmZzZXQgKyBpXSwgaSArPSBkLCBuQml0cyAtPSA4KSB7fVxuXG4gIG0gPSBlICYgKCgxIDw8ICgtbkJpdHMpKSAtIDEpXG4gIGUgPj49ICgtbkJpdHMpXG4gIG5CaXRzICs9IG1MZW5cbiAgZm9yICg7IG5CaXRzID4gMDsgbSA9IG0gKiAyNTYgKyBidWZmZXJbb2Zmc2V0ICsgaV0sIGkgKz0gZCwgbkJpdHMgLT0gOCkge31cblxuICBpZiAoZSA9PT0gMCkge1xuICAgIGUgPSAxIC0gZUJpYXNcbiAgfSBlbHNlIGlmIChlID09PSBlTWF4KSB7XG4gICAgcmV0dXJuIG0gPyBOYU4gOiAoKHMgPyAtMSA6IDEpICogSW5maW5pdHkpXG4gIH0gZWxzZSB7XG4gICAgbSA9IG0gKyBNYXRoLnBvdygyLCBtTGVuKVxuICAgIGUgPSBlIC0gZUJpYXNcbiAgfVxuICByZXR1cm4gKHMgPyAtMSA6IDEpICogbSAqIE1hdGgucG93KDIsIGUgLSBtTGVuKVxufVxuXG5leHBvcnRzLndyaXRlID0gZnVuY3Rpb24gKGJ1ZmZlciwgdmFsdWUsIG9mZnNldCwgaXNMRSwgbUxlbiwgbkJ5dGVzKSB7XG4gIHZhciBlLCBtLCBjXG4gIHZhciBlTGVuID0gbkJ5dGVzICogOCAtIG1MZW4gLSAxXG4gIHZhciBlTWF4ID0gKDEgPDwgZUxlbikgLSAxXG4gIHZhciBlQmlhcyA9IGVNYXggPj4gMVxuICB2YXIgcnQgPSAobUxlbiA9PT0gMjMgPyBNYXRoLnBvdygyLCAtMjQpIC0gTWF0aC5wb3coMiwgLTc3KSA6IDApXG4gIHZhciBpID0gaXNMRSA/IDAgOiAobkJ5dGVzIC0gMSlcbiAgdmFyIGQgPSBpc0xFID8gMSA6IC0xXG4gIHZhciBzID0gdmFsdWUgPCAwIHx8ICh2YWx1ZSA9PT0gMCAmJiAxIC8gdmFsdWUgPCAwKSA/IDEgOiAwXG5cbiAgdmFsdWUgPSBNYXRoLmFicyh2YWx1ZSlcblxuICBpZiAoaXNOYU4odmFsdWUpIHx8IHZhbHVlID09PSBJbmZpbml0eSkge1xuICAgIG0gPSBpc05hTih2YWx1ZSkgPyAxIDogMFxuICAgIGUgPSBlTWF4XG4gIH0gZWxzZSB7XG4gICAgZSA9IE1hdGguZmxvb3IoTWF0aC5sb2codmFsdWUpIC8gTWF0aC5MTjIpXG4gICAgaWYgKHZhbHVlICogKGMgPSBNYXRoLnBvdygyLCAtZSkpIDwgMSkge1xuICAgICAgZS0tXG4gICAgICBjICo9IDJcbiAgICB9XG4gICAgaWYgKGUgKyBlQmlhcyA+PSAxKSB7XG4gICAgICB2YWx1ZSArPSBydCAvIGNcbiAgICB9IGVsc2Uge1xuICAgICAgdmFsdWUgKz0gcnQgKiBNYXRoLnBvdygyLCAxIC0gZUJpYXMpXG4gICAgfVxuICAgIGlmICh2YWx1ZSAqIGMgPj0gMikge1xuICAgICAgZSsrXG4gICAgICBjIC89IDJcbiAgICB9XG5cbiAgICBpZiAoZSArIGVCaWFzID49IGVNYXgpIHtcbiAgICAgIG0gPSAwXG4gICAgICBlID0gZU1heFxuICAgIH0gZWxzZSBpZiAoZSArIGVCaWFzID49IDEpIHtcbiAgICAgIG0gPSAodmFsdWUgKiBjIC0gMSkgKiBNYXRoLnBvdygyLCBtTGVuKVxuICAgICAgZSA9IGUgKyBlQmlhc1xuICAgIH0gZWxzZSB7XG4gICAgICBtID0gdmFsdWUgKiBNYXRoLnBvdygyLCBlQmlhcyAtIDEpICogTWF0aC5wb3coMiwgbUxlbilcbiAgICAgIGUgPSAwXG4gICAgfVxuICB9XG5cbiAgZm9yICg7IG1MZW4gPj0gODsgYnVmZmVyW29mZnNldCArIGldID0gbSAmIDB4ZmYsIGkgKz0gZCwgbSAvPSAyNTYsIG1MZW4gLT0gOCkge31cblxuICBlID0gKGUgPDwgbUxlbikgfCBtXG4gIGVMZW4gKz0gbUxlblxuICBmb3IgKDsgZUxlbiA+IDA7IGJ1ZmZlcltvZmZzZXQgKyBpXSA9IGUgJiAweGZmLCBpICs9IGQsIGUgLz0gMjU2LCBlTGVuIC09IDgpIHt9XG5cbiAgYnVmZmVyW29mZnNldCArIGkgLSBkXSB8PSBzICogMTI4XG59XG4iLCJcbi8qKlxuICogaXNBcnJheVxuICovXG5cbnZhciBpc0FycmF5ID0gQXJyYXkuaXNBcnJheTtcblxuLyoqXG4gKiB0b1N0cmluZ1xuICovXG5cbnZhciBzdHIgPSBPYmplY3QucHJvdG90eXBlLnRvU3RyaW5nO1xuXG4vKipcbiAqIFdoZXRoZXIgb3Igbm90IHRoZSBnaXZlbiBgdmFsYFxuICogaXMgYW4gYXJyYXkuXG4gKlxuICogZXhhbXBsZTpcbiAqXG4gKiAgICAgICAgaXNBcnJheShbXSk7XG4gKiAgICAgICAgLy8gPiB0cnVlXG4gKiAgICAgICAgaXNBcnJheShhcmd1bWVudHMpO1xuICogICAgICAgIC8vID4gZmFsc2VcbiAqICAgICAgICBpc0FycmF5KCcnKTtcbiAqICAgICAgICAvLyA+IGZhbHNlXG4gKlxuICogQHBhcmFtIHttaXhlZH0gdmFsXG4gKiBAcmV0dXJuIHtib29sfVxuICovXG5cbm1vZHVsZS5leHBvcnRzID0gaXNBcnJheSB8fCBmdW5jdGlvbiAodmFsKSB7XG4gIHJldHVybiAhISB2YWwgJiYgJ1tvYmplY3QgQXJyYXldJyA9PSBzdHIuY2FsbCh2YWwpO1xufTtcbiIsIi8vIHNoaW0gZm9yIHVzaW5nIHByb2Nlc3MgaW4gYnJvd3NlclxuXG52YXIgcHJvY2VzcyA9IG1vZHVsZS5leHBvcnRzID0ge307XG52YXIgcXVldWUgPSBbXTtcbnZhciBkcmFpbmluZyA9IGZhbHNlO1xudmFyIGN1cnJlbnRRdWV1ZTtcbnZhciBxdWV1ZUluZGV4ID0gLTE7XG5cbmZ1bmN0aW9uIGNsZWFuVXBOZXh0VGljaygpIHtcbiAgICBkcmFpbmluZyA9IGZhbHNlO1xuICAgIGlmIChjdXJyZW50UXVldWUubGVuZ3RoKSB7XG4gICAgICAgIHF1ZXVlID0gY3VycmVudFF1ZXVlLmNvbmNhdChxdWV1ZSk7XG4gICAgfSBlbHNlIHtcbiAgICAgICAgcXVldWVJbmRleCA9IC0xO1xuICAgIH1cbiAgICBpZiAocXVldWUubGVuZ3RoKSB7XG4gICAgICAgIGRyYWluUXVldWUoKTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIGRyYWluUXVldWUoKSB7XG4gICAgaWYgKGRyYWluaW5nKSB7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG4gICAgdmFyIHRpbWVvdXQgPSBzZXRUaW1lb3V0KGNsZWFuVXBOZXh0VGljayk7XG4gICAgZHJhaW5pbmcgPSB0cnVlO1xuXG4gICAgdmFyIGxlbiA9IHF1ZXVlLmxlbmd0aDtcbiAgICB3aGlsZShsZW4pIHtcbiAgICAgICAgY3VycmVudFF1ZXVlID0gcXVldWU7XG4gICAgICAgIHF1ZXVlID0gW107XG4gICAgICAgIHdoaWxlICgrK3F1ZXVlSW5kZXggPCBsZW4pIHtcbiAgICAgICAgICAgIGN1cnJlbnRRdWV1ZVtxdWV1ZUluZGV4XS5ydW4oKTtcbiAgICAgICAgfVxuICAgICAgICBxdWV1ZUluZGV4ID0gLTE7XG4gICAgICAgIGxlbiA9IHF1ZXVlLmxlbmd0aDtcbiAgICB9XG4gICAgY3VycmVudFF1ZXVlID0gbnVsbDtcbiAgICBkcmFpbmluZyA9IGZhbHNlO1xuICAgIGNsZWFyVGltZW91dCh0aW1lb3V0KTtcbn1cblxucHJvY2Vzcy5uZXh0VGljayA9IGZ1bmN0aW9uIChmdW4pIHtcbiAgICB2YXIgYXJncyA9IG5ldyBBcnJheShhcmd1bWVudHMubGVuZ3RoIC0gMSk7XG4gICAgaWYgKGFyZ3VtZW50cy5sZW5ndGggPiAxKSB7XG4gICAgICAgIGZvciAodmFyIGkgPSAxOyBpIDwgYXJndW1lbnRzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICBhcmdzW2kgLSAxXSA9IGFyZ3VtZW50c1tpXTtcbiAgICAgICAgfVxuICAgIH1cbiAgICBxdWV1ZS5wdXNoKG5ldyBJdGVtKGZ1biwgYXJncykpO1xuICAgIGlmIChxdWV1ZS5sZW5ndGggPT09IDEgJiYgIWRyYWluaW5nKSB7XG4gICAgICAgIHNldFRpbWVvdXQoZHJhaW5RdWV1ZSwgMCk7XG4gICAgfVxufTtcblxuLy8gdjggbGlrZXMgcHJlZGljdGlibGUgb2JqZWN0c1xuZnVuY3Rpb24gSXRlbShmdW4sIGFycmF5KSB7XG4gICAgdGhpcy5mdW4gPSBmdW47XG4gICAgdGhpcy5hcnJheSA9IGFycmF5O1xufVxuSXRlbS5wcm90b3R5cGUucnVuID0gZnVuY3Rpb24gKCkge1xuICAgIHRoaXMuZnVuLmFwcGx5KG51bGwsIHRoaXMuYXJyYXkpO1xufTtcbnByb2Nlc3MudGl0bGUgPSAnYnJvd3Nlcic7XG5wcm9jZXNzLmJyb3dzZXIgPSB0cnVlO1xucHJvY2Vzcy5lbnYgPSB7fTtcbnByb2Nlc3MuYXJndiA9IFtdO1xucHJvY2Vzcy52ZXJzaW9uID0gJyc7IC8vIGVtcHR5IHN0cmluZyB0byBhdm9pZCByZWdleHAgaXNzdWVzXG5wcm9jZXNzLnZlcnNpb25zID0ge307XG5cbmZ1bmN0aW9uIG5vb3AoKSB7fVxuXG5wcm9jZXNzLm9uID0gbm9vcDtcbnByb2Nlc3MuYWRkTGlzdGVuZXIgPSBub29wO1xucHJvY2Vzcy5vbmNlID0gbm9vcDtcbnByb2Nlc3Mub2ZmID0gbm9vcDtcbnByb2Nlc3MucmVtb3ZlTGlzdGVuZXIgPSBub29wO1xucHJvY2Vzcy5yZW1vdmVBbGxMaXN0ZW5lcnMgPSBub29wO1xucHJvY2Vzcy5lbWl0ID0gbm9vcDtcblxucHJvY2Vzcy5iaW5kaW5nID0gZnVuY3Rpb24gKG5hbWUpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ3Byb2Nlc3MuYmluZGluZyBpcyBub3Qgc3VwcG9ydGVkJyk7XG59O1xuXG4vLyBUT0RPKHNodHlsbWFuKVxucHJvY2Vzcy5jd2QgPSBmdW5jdGlvbiAoKSB7IHJldHVybiAnLycgfTtcbnByb2Nlc3MuY2hkaXIgPSBmdW5jdGlvbiAoZGlyKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdwcm9jZXNzLmNoZGlyIGlzIG5vdCBzdXBwb3J0ZWQnKTtcbn07XG5wcm9jZXNzLnVtYXNrID0gZnVuY3Rpb24oKSB7IHJldHVybiAwOyB9O1xuIiwicmVxdWlyZSgnLi9UcmFjaycpO1xyXG5yZXF1aXJlKCcuL0dVSScpO1xyXG5yZXF1aXJlKCcuL1BhcnRpY2lwYW50Jyk7XHJcbndpbmRvdy5DT05GSUc9cmVxdWlyZSgnLi9Db25maWcnKTtcclxudmFyIFV0aWxzPXJlcXVpcmUoJy4vVXRpbHMnKTtcclxuZm9yICh2YXIgZSBpbiBVdGlscykgXHJcblx0d2luZG93W2VdPVV0aWxzW2VdO1xyXG5cclxudmFyIGRyYXc7XHJcbnZhciBtb2RpZnk7XHJcbnZhciBzZWxlY3Q7XHJcblxyXG53aW5kb3cuVFJBQ0sgPSBuZXcgVHJhY2soKTtcclxud2luZG93LkdVSSA9IG5ldyBHdWkoXHJcbntcclxuXHRcdHRyYWNrXHRcdDogVFJBQ0ssXHJcblx0XHRpbml0aWFsWm9vbSA6IDJcclxuXHRcdC8vaW5pdGlhbFBvcyAgOiBbbG9uLGxhdF0sXHJcbn0pO1xyXG5cclxuZnVuY3Rpb24gZXJyb3JSb3V0ZShlcnIpIHtcclxuXHRHVUkuc2hvd0Vycm9yKGVycik7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGluaXRHVUkoKSBcclxue1xyXG5cdGlmIChHVUkuaXNfaW5pdCkge1xyXG5cdFx0c2VsZWN0LmdldEZlYXR1cmVzKCkuY2xlYXIoKTtcclxuXHRcdHJldHVybjtcclxuXHR9XHJcblx0R1VJLmlzX2luaXQ9MTtcclxuXHRHVUkuaW5pdCh7c2tpcEV4dGVudDp0cnVlfSk7XHJcblx0Ly8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0ZnVuY3Rpb24gc3RvcmUoZm9yY2VDbG9zZSkgXHJcblx0e1xyXG5cdFx0aWYgKCFHVUkuZ2V0VHJhY2tMYXllcigpLmdldFNvdXJjZSgpLmdldEZlYXR1cmVzKCkubGVuZ3RoKSB7XHJcblx0XHRcdHJldHVybiBudWxsO1xyXG5cdFx0fVxyXG5cdFx0dmFyIHRyYWNrRGF0YT1HVUkuZ2V0VHJhY2tMYXllcigpLmdldFNvdXJjZSgpLmdldEZlYXR1cmVzKClbMF0uZ2V0R2VvbWV0cnkoKS5nZXRDb29yZGluYXRlcygpO1xyXG5cdFx0aWYgKGZvcmNlQ2xvc2UpIFxyXG5cdFx0e1xyXG5cdFx0XHRpZiAodHJhY2tEYXRhWzBdWzBdICE9IHRyYWNrRGF0YVt0cmFja0RhdGEubGVuZ3RoLTFdWzBdIHx8IHRyYWNrRGF0YVswXVsxXSAhPSB0cmFja0RhdGFbdHJhY2tEYXRhLmxlbmd0aC0xXVsxXSkge1xyXG5cdFx0XHRcdHRyYWNrRGF0YS5wdXNoKHRyYWNrRGF0YVswXSk7XHJcblx0XHRcdFx0R1VJLmdldFRyYWNrTGF5ZXIoKS5nZXRTb3VyY2UoKS5nZXRGZWF0dXJlcygpWzBdLmdldEdlb21ldHJ5KCkuc2V0Q29vcmRpbmF0ZXModHJhY2tEYXRhKTtcclxuXHRcdFx0fVxyXG5cdFx0fVxyXG5cdFx0Zm9yICh2YXIgaT0wO2k8dHJhY2tEYXRhLmxlbmd0aDtpKyspXHJcblx0XHRcdHRyYWNrRGF0YVtpXT1vbC5wcm9qLnRyYW5zZm9ybSh0cmFja0RhdGFbaV0sICdFUFNHOjM4NTcnLCdFUFNHOjQzMjYnKTtcdFx0XHRcclxuXHRcdCQoXCIjcm91dGVfdGV4dF9hcmVhXCIpLnZhbChKU09OLnN0cmluZ2lmeSh0cmFja0RhdGEpKTtcclxuXHRcdFRSQUNLLnNldFJvdXRlKHRyYWNrRGF0YSk7XHJcblx0XHRcclxuXHRcdHZhciBzdHIgPSAoVFJBQ0suZ2V0VHJhY2tMZW5ndGgoKS8xMDAwLjApK1wiIGttXCI7XHJcblx0XHQkKFwiI3JvdXRlX2luZm9cIikudmFsKHN0cik7XHJcblx0XHRyZXR1cm4gSlNPTi5zdHJpbmdpZnkodHJhY2tEYXRhKTtcclxuXHR9XHJcblx0Ly8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0c2VsZWN0ID0gbmV3IG9sLmludGVyYWN0aW9uLlNlbGVjdCh7XHJcblx0XHRzdHlsZTogU1RZTEVTW1widHJhY2tzZWxlY3RlZFwiXSxcclxuXHRcdGxheWVyczogW0dVSS50cmFja0xheWVyXVxyXG5cdH0pO1xyXG5cdG1vZGlmeSA9IG5ldyBvbC5pbnRlcmFjdGlvbi5Nb2RpZnkoe1xyXG5cdFx0ZmVhdHVyZXM6IHNlbGVjdC5nZXRGZWF0dXJlcygpLFxyXG5cdFx0bGF5ZXJzOiBbR1VJLnRyYWNrTGF5ZXJdXHJcblx0fSk7XHJcblx0Ly8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0ZHJhdyA9IG5ldyBvbC5pbnRlcmFjdGlvbi5EcmF3KHtcclxuXHQgICAgICBzb3VyY2U6IEdVSS50cmFja0xheWVyLmdldFNvdXJjZSgpLFxyXG5cdCAgICAgIHR5cGU6IFwiTGluZVN0cmluZ1wiXHJcblx0fSk7XHJcblx0ZHJhdy5vbignZHJhd3N0YXJ0JywgZnVuY3Rpb24oZSkge1xyXG5cdFx0R1VJLnRyYWNrTGF5ZXIuZ2V0U291cmNlKCkuY2xlYXIoKTtcclxuXHR9KTtcclxuXHRkcmF3Lm9uKCdkcmF3ZW5kJywgZnVuY3Rpb24oZSkge1xyXG5cdFx0R1VJLm1hcC5yZW1vdmVJbnRlcmFjdGlvbihkcmF3KTtcclxuXHRcdEdVSS5tYXAuYWRkSW50ZXJhY3Rpb24oc2VsZWN0KTtcclxuXHRcdEdVSS5tYXAuYWRkSW50ZXJhY3Rpb24obW9kaWZ5KTtcclxuXHRcdHN0b3JlKCk7XHJcblx0XHRpZiAoIVRSQUNLLmZlYXR1cmUpXHJcblx0XHRcdFRSQUNLLmZlYXR1cmU9R1VJLmdldFRyYWNrTGF5ZXIoKS5nZXRTb3VyY2UoKS5nZXRGZWF0dXJlcygpWzBdO1xyXG5cdH0pO1xyXG5cdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdEdVSS5tYXAucmVtb3ZlSW50ZXJhY3Rpb24oc2VsZWN0KTtcclxuXHRHVUkubWFwLnJlbW92ZUludGVyYWN0aW9uKG1vZGlmeSk7XHJcblx0R1VJLm1hcC5hZGRJbnRlcmFjdGlvbihkcmF3KTtcclxuXHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHQkKFwiI2J1dHRvbl9lcmFzZVwiKS5jbGljayhmdW5jdGlvbigpe1xyXG5cdFx0R1VJLnRyYWNrTGF5ZXIuZ2V0U291cmNlKCkuY2xlYXIoKTtcclxuXHRcdHNlbGVjdC5nZXRGZWF0dXJlcygpLmNsZWFyKCk7XHJcblx0XHRHVUkubWFwLnJlbW92ZUludGVyYWN0aW9uKHNlbGVjdCk7XHJcblx0XHRHVUkubWFwLnJlbW92ZUludGVyYWN0aW9uKG1vZGlmeSk7XHJcblx0XHRHVUkubWFwLmFkZEludGVyYWN0aW9uKGRyYXcpO1xyXG5cdFx0c3RvcmUoKTtcclxuXHR9KTtcclxuXHQkKFwiI2J1dHRvbl9uYXZpZ2F0ZVwiKS5jbGljayhmdW5jdGlvbigpe1xyXG5cdFx0VFJBQ0suZ2VuZXJhdGVGcm9tTG9jYXRpb25zKFRSQUNLLmdldFJvdXRlKCksZnVuY3Rpb24oKSB7XHJcblx0XHRcdFRSQUNLLnVwZGF0ZUZlYXR1cmUoKTtcclxuXHRcdFx0c3RvcmUoKTtcclxuXHRcdH0sZnVuY3Rpb24obXNnKSB7XHJcblx0XHRcdEdVSS5zaG93RXJyb3IobXNnKTtcclxuXHRcdH0sdHJ1ZSk7XHRcdFx0XHJcblx0fSk7XHJcblx0JChcIiNidXR0b25fam9pblwiKS5jbGljayhmdW5jdGlvbigpIHtcclxuXHRcdHN0b3JlKHRydWUpO1xyXG5cdH0pO1xyXG5cdCQoXCIjYnV0dG9uX3N1Ym1pdFwiKS5jbGljayhmdW5jdGlvbigpIHtcclxuXHRcdHZhciBkYXRhID0gc3RvcmUoKTtcclxuXHRcdEdVSS5vbkVkaXRTYXZlKGRhdGEpO1x0XHRcdFxyXG5cdFx0JChcIi5mdy1jb250YWluZXJcIikuY3NzKFwiZGlzcGxheVwiLFwiYmxvY2tcIik7XHJcblx0fSk7XHJcblx0JChcIiNidXR0b25fY2FuY2VsXCIpLmNsaWNrKGZ1bmN0aW9uKCkge1xyXG5cdFx0JChcIiNtYXBcIikuY3NzKFwiZGlzcGxheVwiLFwibm9uZVwiKTtcclxuXHRcdCQoXCIuZnctY29udGFpbmVyXCIpLmNzcyhcImRpc3BsYXlcIixcImJsb2NrXCIpO1xyXG5cdH0pO1xyXG59XHJcbi8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5mdW5jdGlvbiBtYXBFZGl0KGlkLGpzb24sdmFsQmlrZVN0YXJ0LHZhbFJ1blN0YXJ0LG9uU3VibWl0KSBcclxue1x0XHRcclxuXHQvL2NvbnNvbGUubG9nKFwiSUQgOiBcIitpZCtcIiB8IEpTT04gOiBcIitqc29uKTtcclxuXHQkKFwiLmZ3LWNvbnRhaW5lclwiKS5jc3MoXCJkaXNwbGF5XCIsXCJub25lXCIpO1xyXG5cdCQoXCIjbWFwXCIpLmNzcyhcImRpc3BsYXlcIixcImJsb2NrXCIpO1xyXG5cdGluaXRHVUkoKTtcclxuXHRHVUkudHJhY2tMYXllci5nZXRTb3VyY2UoKS5jbGVhcigpO1xyXG5cdHRyeSB7XHJcblx0XHR2YXIgdHJhY2tEYXRhID0gSlNPTi5wYXJzZShqc29uKTtcclxuXHRcdFRSQUNLLnNldFJvdXRlKHRyYWNrRGF0YSk7XHJcblx0XHRUUkFDSy5iaWtlU3RhcnRLTT1wYXJzZUZsb2F0KHZhbEJpa2VTdGFydCk7XHJcblx0XHRUUkFDSy5ydW5TdGFydEtNPXBhcnNlRmxvYXQodmFsUnVuU3RhcnQpO1xyXG5cdFx0aWYgKGlzTmFOKFRSQUNLLmJpa2VTdGFydEtNKSlcclxuXHRcdFx0VFJBQ0suYmlrZVN0YXJ0S009My44NjtcclxuXHRcdGlmIChpc05hTihUUkFDSy5ydW5TdGFydEtNKSlcclxuXHRcdFx0VFJBQ0sucnVuU3RhcnRLTT0xODAuMjUrVFJBQ0suYmlrZVN0YXJ0S007XHJcblx0XHRpZiAoanNvbiAmJiBqc29uICE9IFwiXCIpIFxyXG5cdFx0e1xyXG5cdFx0XHQkKFwiI3JvdXRlX3RleHRfYXJlYVwiKS52YWwoanNvbik7XHJcblxyXG5cdFx0XHR2YXIgc3RyID0gKFRSQUNLLmdldFRyYWNrTGVuZ3RoKCkvMTAwMC4wKStcIiBrbVwiO1xyXG5cdFx0XHQkKFwiI3JvdXRlX2luZm9cIikudmFsKHN0cik7XHJcblxyXG5cdFx0XHRHVUkuYWRkVHJhY2tGZWF0dXJlKCk7XHJcblx0XHRcdEdVSS56b29tVG9UcmFjaygpO1xyXG5cdFx0XHRHVUkubWFwLnJlbW92ZUludGVyYWN0aW9uKGRyYXcpO1xyXG5cdFx0XHRHVUkubWFwLmFkZEludGVyYWN0aW9uKHNlbGVjdCk7XHJcblx0XHRcdEdVSS5tYXAuYWRkSW50ZXJhY3Rpb24obW9kaWZ5KTtcclxuXHRcdH1cdFx0XHJcblx0fSBjYXRjaCAoZSkge1xyXG5cdFx0Y29uc29sZS5sb2coXCJVbmFibGUgdG8gZG8gbWFwRWRpdCBmb3IgXCIranNvbik7XHJcblx0XHRjb25zb2xlLmVycm9yKFwiRXhjZXB0aW9uIG9uIG1hcEVkaXQgXCIrZSk7XHJcblx0fVx0XHRcclxuXHRHVUkub25FZGl0U2F2ZSA9IGZ1bmN0aW9uKGRhdGEpIHtcclxuXHRcdCQoXCIjbWFwXCIpLmNzcyhcImRpc3BsYXlcIixcIm5vbmVcIik7XHJcblx0XHRvblN1Ym1pdChkYXRhKTtcclxuXHR9O1xyXG59XHJcblxyXG4kKGRvY3VtZW50KS5yZWFkeSggZnVuY3Rpb24gKCkgXHJcbntcclxuXHQkKFwiLm1vYmlsZS1zaG93IGlcIikuY2xpY2soZnVuY3Rpb24oKSB7XHJcblx0XHQkKFwiLm1vYmlsZS1zaG93XCIpLmNzcyhcImRpc3BsYXlcIixcIm5vbmVcIik7IFxyXG5cdFx0JChcIi5mdy1uYXZcIikuY3NzKFwiaGVpZ2h0XCIsXCJhdXRvXCIpOyBcclxuXHR9KTtcclxuXHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHR3aW5kb3cuRURJVE9SMSA9IG5ldyAkLmZuLmRhdGFUYWJsZS5FZGl0b3IoIHtcclxuXHRcdGFqYXg6IFxyXG5cdFx0e1xyXG5cdFx0XHR1cmwgOiBcIi4uL3BhcnRpY2lwYW50c1wiLFxyXG5cdFx0XHRkYXRhOiBmdW5jdGlvbiAoIGQgKSB7XHJcblx0XHRcdFx0aWYgKGQuYWN0aW9uID09IFwicmVtb3ZlXCIpIFxyXG5cdFx0XHRcdCAgICByZXR1cm4gSlNPTi5zdHJpbmdpZnkoe1wiZGVsZXRlXCI6ZC5pZH0pO1xyXG5cdFx0XHQgICAgcmV0dXJuIEpTT04uc3RyaW5naWZ5KCBkLmRhdGEgKTtcclxuXHRcdFx0fVxyXG5cdFx0fSxcclxuXHRcdHRhYmxlOiBcIiN0YWJsZS1wYXJ0aWNpcGFudHNcIixcclxuXHRcdGlkU3JjOiBcImlkXCIsXHJcblx0XHRmaWVsZHM6IFsge1xyXG5cdFx0XHRcdGxhYmVsOiBcIklkXCIsXHJcblx0XHRcdFx0bmFtZTogXCJpZFwiLFxyXG5cdFx0XHRcdHR5cGUgOiBcInJlYWRvbmx5XCJcclxuXHRcdFx0fSx7XHJcblx0XHRcdFx0bGFiZWw6IFwiQ29kZVwiLFxyXG5cdFx0XHRcdG5hbWU6IFwiY29kZVwiXHJcblx0XHRcdH0sIHtcclxuXHRcdFx0XHRsYWJlbDogXCJOYW1lXCIsXHJcblx0XHRcdFx0bmFtZTogXCJuYW1lXCJcclxuXHRcdFx0fSwge1xyXG5cdFx0XHRcdGxhYmVsOiBcIkJJQlwiLFxyXG5cdFx0XHRcdG5hbWU6IFwiYmliXCJcclxuXHRcdFx0fSwge1xyXG5cdFx0XHRcdGxhYmVsOiBcIkNvdW50cnlcIixcclxuXHRcdFx0XHRuYW1lOiBcImNvdW50cnlcIlxyXG5cdFx0XHR9LCB7XHJcblx0XHRcdFx0bGFiZWw6IFwiQWdlXCIsXHJcblx0XHRcdFx0bmFtZTogXCJhZ2VcIlxyXG5cdFx0XHR9LCB7XHJcblx0XHRcdFx0bGFiZWw6IFwiR2VuZGVyXCIsXHJcblx0XHRcdFx0bmFtZTogXCJnZW5kZXJcIlxyXG5cdFx0XHR9LCB7XHJcblx0XHRcdFx0bGFiZWw6IFwiT2NjdXBhdGlvblwiLFxyXG5cdFx0XHRcdG5hbWU6IFwib2NjdXBhdGlvblwiXHJcblx0XHRcdH1cclxuXHRcdF1cclxuXHR9ICk7XHJcblxyXG5cdHdpbmRvdy5FRElUT1IyID0gbmV3ICQuZm4uZGF0YVRhYmxlLkVkaXRvcigge1xyXG5cdFx0YWpheDogXHJcblx0XHR7XHJcblx0XHRcdHVybCA6IENPTkZJRy5zZXJ2ZXIucHJlZml4K1wicmVzdC9ldmVudC9cIixcclxuXHRcdFx0ZGF0YTogZnVuY3Rpb24gKCBkICkgXHJcblx0XHRcdHtcclxuXHRcdFx0XHRpZiAoZC5hY3Rpb24gPT0gXCJyZW1vdmVcIikgXHJcblx0XHRcdFx0ICAgIHJldHVybiBKU09OLnN0cmluZ2lmeSh7XCJkZWxldGVcIjpkLmlkfSk7XHJcblx0XHRcdCAgICByZXR1cm4gSlNPTi5zdHJpbmdpZnkoIGQuZGF0YSApO1xyXG5cdFx0XHR9XHJcblx0XHR9LFxyXG5cdFx0ZGF0YTogZnVuY3Rpb24gKCBkICkge1xyXG5cdFx0ICAgIHJldHVybiBKU09OLnN0cmluZ2lmeSggZCApO1xyXG5cdFx0fSxcclxuXHRcdHRhYmxlOiBcIiN0YWJsZS1ldmVudHNcIixcclxuXHRcdGlkU3JjOiBcImlkXCIsXHJcblx0XHRmaWVsZHM6IFsge1xyXG5cdFx0XHRcdGxhYmVsOiBcIklkXCIsXHJcblx0XHRcdFx0bmFtZTogXCJpZFwiLFxyXG5cdFx0XHRcdHR5cGUgOiBcInJlYWRvbmx5XCJcclxuXHRcdFx0fSwge1xyXG5cdFx0XHRcdGxhYmVsOiBcIkNvZGVcIixcclxuXHRcdFx0XHRuYW1lOiBcImNvZGVcIlxyXG5cdFx0XHR9LCB7XHJcblx0XHRcdFx0bGFiZWw6IFwiTmFtZVwiLFxyXG5cdFx0XHRcdG5hbWU6IFwibmFtZVwiXHJcblx0XHRcdH0sIHtcclxuXHRcdFx0XHRsYWJlbDogXCJEYXRlXCIsXHJcblx0XHRcdFx0bmFtZTogXCJkYXRlXCIsXHJcblx0XHRcdFx0ZGF0ZUZvcm1hdDogXCJtbS1kZC15eXl5XCIsXHJcblx0XHRcdFx0dHlwZTogXCJkYXRlXCJcclxuXHRcdFx0fSwge1xyXG5cdFx0XHRcdGxhYmVsOiBcIkJlZ2luIHRpbWVcIixcclxuXHRcdFx0XHRuYW1lOiBcImJlZ2luLXRpbWVcIlxyXG5cdFx0XHR9LCB7XHJcblx0XHRcdFx0bGFiZWw6IFwiRW5kIHRpbWVcIixcclxuXHRcdFx0XHRuYW1lOiBcImVuZC10aW1lXCJcclxuXHRcdFx0fSx7XHJcblx0ICAgICAgICAgICAgbGFiZWw6IFwidHJhY2sgSlNPTiBkYXRhXCIsXHJcblx0ICAgICAgICAgICAgbmFtZTogIFwidHJhY2tcIlxyXG5cdCAgICAgICAgfSx7XHJcblx0ICAgICAgICAgICAgbGFiZWw6IFwidHJhY2sgcnVuIGNvdW50XCIsXHJcblx0ICAgICAgICAgICAgbmFtZTogIFwicnVuLWNvdW50XCJcclxuXHQgICAgICAgIH0se1xyXG5cdCAgICAgICAgICAgIGxhYmVsOiBcImJpa2Ugc3RhcnQga20uXCIsXHJcblx0ICAgICAgICAgICAgbmFtZTogIFwiYmlrZS1zdGFydFwiXHJcblx0ICAgICAgICB9LHtcclxuXHQgICAgICAgICAgICBsYWJlbDogXCJydW4gc3RhcnQga20uXCIsXHJcblx0ICAgICAgICAgICAgbmFtZTogIFwicnVuLXN0YXJ0XCJcclxuXHQgICAgICAgIH1cclxuXHRcdFx0XVxyXG5cdH0gKTtcclxuXHJcblx0dmFyIHRhYmxlUGFydGljaXBhbnRzID0gJCgnI3RhYmxlLXBhcnRpY2lwYW50cycpLkRhdGFUYWJsZSgge1xyXG5cdFx0ZG9tOiBcIlRmcnRpcFwiLFxyXG5cdFx0YWpheDogXCIuLi9wYXJ0aWNpcGFudHM/bW9kZT1kdGJsXCIsXHJcblx0XHRjb2x1bW5zOiBbXHJcblx0XHRcdHsgZGF0YTogXCJpZFwiIH0sXHJcblx0XHRcdHsgZGF0YTogXCJmaXJzdG5hbWVcIiB9LFxyXG5cdFx0XHR7IGRhdGE6IFwibGFzdG5hbWVcIiB9LFxyXG5cdFx0XHR7IGRhdGE6IFwiZ2VuZGVyXCIgfSxcclxuXHRcdFx0eyBcclxuXHRcdFx0XHQvLyBiaXJ0aCBkYXRlIFxyXG5cdFx0XHRcdGRhdGE6IG51bGwsXHJcblx0XHRcdFx0cmVuZGVyOiBmdW5jdGlvbiAoIGRhdGEsIHR5cGUsIHJvdyApIFxyXG5cdFx0XHRcdHtcclxuXHRcdFx0XHRcdHZhciBkdCA9IGRhdGEuYmlydGhEYXRlO1xyXG5cdFx0XHRcdFx0aWYgKCFkdClcclxuXHRcdFx0XHRcdFx0cmV0dXJuIFwiXCI7XHJcblx0XHRcdFx0XHR2YXIgcmVzPVwiXCI7XHJcblx0XHRcdFx0XHR0cnkge1xyXG5cdFx0XHRcdFx0XHRyZXMgPSBmb3JtYXREYXRlKG5ldyBEYXRlKGR0KSk7XHJcblx0XHRcdFx0XHR9IGNhdGNoKGUpIHtcclxuXHRcdFx0XHRcdH1cclxuXHRcdFx0XHRcdHJldHVybiByZXM7XHJcblx0XHRcdFx0fSBcclxuXHRcdFx0fSxcclxuXHRcdFx0eyBkYXRhOiBcIm5hdGlvbmFsaXR5XCJ9LFxyXG5cdFx0XHR7IGRhdGE6IFwiY2x1YlwifSxcclxuXHRcdFx0eyBkYXRhOiBcInN0YXJ0R3JvdXBcIiB9LFxyXG5cdFx0XHR7IGRhdGE6IFwic3RhcnROb1wiLGNsYXNzTmFtZSA6IFwiZHQtYm9keS1yaWdodFwiIH0sXHJcblx0XHRdLFxyXG5cdFx0dGFibGVUb29sczoge1xyXG5cdFx0XHRzUm93U2VsZWN0OiBcIm9zXCIsXHJcblx0XHRcdGFCdXR0b25zOiBbXHJcblx0XHRcdFx0eyBzRXh0ZW5kczogXCJlZGl0b3JfY3JlYXRlXCIsIGVkaXRvcjogRURJVE9SMSB9LFxyXG5cdFx0XHRcdHsgc0V4dGVuZHM6IFwiZWRpdG9yX2VkaXRcIiwgICBlZGl0b3I6IEVESVRPUjEgfSxcclxuXHRcdFx0XHR7IHNFeHRlbmRzOiBcImVkaXRvcl9yZW1vdmVcIiwgZWRpdG9yOiBFRElUT1IxIH1cclxuXHRcdFx0XVxyXG5cdFx0fVxyXG5cdH0gKTtcdFxyXG5cdFxyXG5cdHZhciB0YWJsZUV2ZW50cyA9ICQoJyN0YWJsZS1ldmVudHMnKS5EYXRhVGFibGUoIHtcclxuXHRcdGRvbTogXCJUZnJ0aXBcIixcclxuXHRcdGFqYXg6IENPTkZJRy5zZXJ2ZXIucHJlZml4K1wicmVzdC9ldmVudC9cIixcclxuXHRcdGNvbHVtbnM6IFtcclxuXHRcdFx0eyBkYXRhOiBcImNvZGVcIiB9LFxyXG5cdFx0XHR7IGRhdGE6IFwibmFtZVwiIH0sXHJcblx0XHRcdHsgXHJcblx0XHRcdFx0Ly8gZGF0ZSBcclxuXHRcdFx0XHRkYXRhOiBudWxsLFxyXG5cdFx0XHRcdHJlbmRlcjogZnVuY3Rpb24gKCBkYXRhLCB0eXBlLCByb3cgKSBcclxuXHRcdFx0XHR7XHJcblx0XHRcdFx0XHR2YXIgZHQgPSBkYXRhW1wiZGF0ZVwiXTtcclxuXHRcdFx0XHRcdGlmICghZHQpXHJcblx0XHRcdFx0XHRcdHJldHVybiBcIlwiO1xyXG5cdFx0XHRcdFx0dmFyIHJlcz1cIlwiO1xyXG5cdFx0XHRcdFx0dHJ5IHtcclxuXHRcdFx0XHRcdFx0cmVzID0gZm9ybWF0RGF0ZShuZXcgRGF0ZShkdCkpO1xyXG5cdFx0XHRcdFx0fSBjYXRjaChlKSB7XHJcblx0XHRcdFx0XHR9XHJcblx0XHRcdFx0XHRyZXR1cm4gcmVzO1xyXG5cdFx0XHRcdH0gXHJcblx0XHRcdH0sXHJcblx0XHRcdHsgXHJcblx0XHRcdFx0Ly8gdHJhY2tcclxuXHRcdFx0XHRkYXRhOiBudWxsLFxyXG5cdFx0XHRcdHJlbmRlcjogZnVuY3Rpb24gKCBkYXRhLCB0eXBlLCByb3cgKSBcclxuXHRcdFx0XHR7XHJcblx0XHRcdFx0XHRpZiAoIWRhdGFbXCJ0cmFja1wiXSlcclxuXHRcdFx0XHRcdFx0cmV0dXJuIFwiXCI7XHJcblx0XHRcdFx0XHR2YXIgdHBvcyA9IG51bGw7XHJcblx0XHRcdFx0XHR0cnkge1xyXG5cdFx0XHRcdFx0XHR0cG9zPUpTT04ucGFyc2UoZGF0YVtcInRyYWNrXCJdKTtcclxuXHRcdFx0XHRcdH0gY2F0Y2goZSkge1xyXG5cdFx0XHRcdFx0fVxyXG5cdFx0XHRcdFx0dmFyIHJlcztcclxuXHRcdFx0XHRcdGlmICghdHBvcyB8fCAhdHBvcy5sZW5ndGgpXHJcblx0XHRcdFx0XHRcdHJlcz1cIjAga21cIjtcclxuXHRcdFx0XHRcdGVsc2Uge1xyXG5cdFx0XHRcdFx0XHR2YXIgdHIgPSBuZXcgVHJhY2soKTtcclxuXHRcdFx0XHRcdFx0dHIuc2V0Um91dGUodHBvcyk7XHJcblx0XHRcdFx0XHRcdHJlcyA9IGZvcm1hdE51bWJlcjIodHIuZ2V0VHJhY2tMZW5ndGgoKS8xMDAwLjApK1wiIGttXCI7XHJcblx0XHRcdFx0XHR9XHJcblx0XHRcdFx0XHRpZiAoZGF0YVtcInJ1bi1jb3VudFwiXSAmJiBwYXJzZUludChkYXRhW1wicnVuLWNvdW50XCJdKSA+IDEpXHJcblx0XHRcdFx0XHRcdHJlcz1cIjxiPlwiK2RhdGFbXCJydW4tY291bnRcIl0rXCJ4PC9iPiBcIityZXM7XHJcblx0XHRcdFx0XHRpZiAoZGF0YVtcImJlZ2luLXRpbWVcIl0gJiYgZGF0YVtcImVuZC10aW1lXCJdKVxyXG5cdFx0XHRcdFx0XHRyZXM9ZGF0YVtcImJlZ2luLXRpbWVcIl0rXCItXCIrZGF0YVtcImVuZC10aW1lXCJdK1wiIChcIityZXMrXCIpXCI7XHJcblx0XHRcdFx0XHRyZXR1cm4gcmVzO1xyXG5cdFx0XHRcdH0gXHJcblx0XHRcdH1cclxuXHRcdF0sXHJcblx0XHR0YWJsZVRvb2xzOiB7XHJcblx0XHRcdHNSb3dTZWxlY3Q6IFwib3NcIixcclxuXHRcdFx0YUJ1dHRvbnM6IFtcclxuXHRcdFx0XHR7IHNFeHRlbmRzOiBcImVkaXRvcl9jcmVhdGVcIiwgZWRpdG9yIDogRURJVE9SMiB9LFxyXG5cdFx0XHRcdHsgc0V4dGVuZHM6IFwiZWRpdG9yX2VkaXRcIiwgICBmbkNsaWNrIDogZnVuY3Rpb24gKCkge1xyXG5cdFx0XHRcdFx0RURJVE9SMlxyXG4gICAgICAgICAgICAgICAgICAgIC50aXRsZSggJ0VkaXQgdHJhY2snIClcclxuICAgICAgICAgICAgICAgICAgICAuYnV0dG9ucyggW1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgeyBsYWJlbDogJ1NhdmUnLCBmbjogZnVuY3Rpb24oKSB7IHRoaXMuc3VibWl0KCk7IH0gfSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHsgbGFiZWw6ICdNYXAnLCBmbjogZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBcdCAgIHZhciBkdCA9IHRhYmxlRXZlbnRzLnJvd3MoXCIuc2VsZWN0ZWRcIikuZGF0YSgpWzBdO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgXHQgICB2YXIgdGhhdD10aGlzO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgXHQgICBtYXBFZGl0KGR0LmlkLCQoXCIjRFRFX0ZpZWxkX3RyYWNrXCIpLnZhbCgpLCQoXCIjRFRFX0ZpZWxkX2Jpa2Utc3RhcnRcIikudmFsKCksJChcIiNEVEVfRmllbGRfcnVuLXN0YXJ0XCIpLnZhbCgpLGZ1bmN0aW9uKGRhdGEpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIFx0XHQgICAkKFwiI0RURV9GaWVsZF90cmFja1wiKS52YWwoZGF0YSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBcdCAgIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0gfVxyXG4gICAgICAgICAgICAgICAgICAgIFx0XSApXHJcbiAgICAgICAgICAgICAgICAgICAgLmVkaXQoIHRhYmxlRXZlbnRzLnJvdyggJy5zZWxlY3RlZCcgKS5ub2RlKCkgKTtcclxuXHRcdFx0XHRcdFxyXG5cdFx0XHRcdH0gfSxcclxuXHRcdFx0XHR7IHNFeHRlbmRzOiBcImVkaXRvcl9yZW1vdmVcIiwgZWRpdG9yOiBFRElUT1IyIH1cclxuICAgICAgICAgICBdXHJcblx0XHR9XHJcblx0fSApO1xyXG5cdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHQvKlxyXG5cdCQoXCIjbmF2MVwiKS5jbGljayhmdW5jdGlvbigpIHtcclxuXHRcdCQoXCIjbmF2MVwiKS5hZGRDbGFzcyhcImFjdGl2ZVwiKTtcclxuXHRcdCQoXCIjbmF2MlwiKS5yZW1vdmVDbGFzcyhcImFjdGl2ZVwiKTtcclxuXHRcdCQoXCIjdGFiMVwiKS5jc3MoXCJoZWlnaHRcIixcImF1dG9cIik7XHJcblx0XHQkKFwiI3RhYjJcIikuY3NzKFwiaGVpZ2h0XCIsXCIwXCIpO1xyXG5cdH0pO1xyXG5cdCQoXCIjbmF2MlwiKS5jbGljayhmdW5jdGlvbigpIHtcclxuXHRcdCQoXCIjbmF2MlwiKS5hZGRDbGFzcyhcImFjdGl2ZVwiKTtcclxuXHRcdCQoXCIjbmF2MVwiKS5yZW1vdmVDbGFzcyhcImFjdGl2ZVwiKTtcclxuXHRcdCQoXCIjdGFiMlwiKS5jc3MoXCJoZWlnaHRcIixcImF1dG9cIik7XHJcblx0XHQkKFwiI3RhYjFcIikuY3NzKFwiaGVpZ2h0XCIsXCIwXCIpO1xyXG5cdH0pO1xyXG5cdCovXHJcblx0Ly8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG59KTtcclxuIiwidmFyIFV0aWxzID0gcmVxdWlyZShcIi4vVXRpbHMuanNcIik7XHJcblxyXG52YXIgQ09ORklHID0gXHJcbntcclxuXHR0aW1lb3V0cyA6IC8vIGluIHNlY29uZHNcclxuXHR7XHJcblx0XHRkZXZpY2VUaW1lb3V0IDogNjAqNSxcclxuXHRcdGFuaW1hdGlvbkZyYW1lIDogVXRpbHMubW9iaWxlQW5kVGFibGV0Q2hlY2soKSA/IDAuNCA6IDAuMSxcclxuXHRcdGdwc0xvY2F0aW9uRGVidWdTaG93IDogNCxcdFx0Ly8gdGltZSB0byBzaG93IGdwcyBsb2NhdGlvbiAoZGVidWcpIGluZm9cclxuXHRcdHN0cmVhbURhdGFJbnRlcnZhbCA6IDEwIFx0XHQvKiBOT1JNQUwgMTAgc2Vjb25kcyAqL1xyXG5cdH0sXHJcblx0ZGlzdGFuY2VzIDogLy8gaW4gbVxyXG5cdHtcclxuXHRcdHN0YXlPblJvYWRUb2xlcmFuY2UgOiA1MDAsXHQvLyA1MDBtIHN0YXkgb24gcm9hZCB0b2xlcmFuY2VcclxuXHRcdGVsYXBzZWREaXJlY3Rpb25FcHNpbG9uIDogNTAwIC8vIDUwMG0gZGlyZWN0aW9uIHRvbGVyYW5jZSwgdG9vIGZhc3QgbW92ZW1lbnQgd2lsbCBkaXNjYXJkIFxyXG5cdH0sXHJcblx0Y29uc3RyYWludHMgOiB7XHJcblx0XHRiYWNrd2FyZHNFcHNpbG9uSW5NZXRlciA6IDQwMCwgLy8yMjAgbSBtb3ZlbWVudCBpbiB0aGUgYmFja3dhcmQgZGlyZWN0aW9uIHdpbGwgbm90IHRyaWdnZXIgbmV4dCBydW4gY291bnRlciBpbmNyZW1lbnRcdFx0XHJcblx0XHRtYXhTcGVlZCA6IDIwLFx0Ly9rbWhcclxuXHRcdG1heFBhcnRpY2lwYW50U3RhdGVIaXN0b3J5IDogMTAwMCwgLy8gbnVtYmVyIG9mIGVsZW1lbnRzXHJcblx0XHRwb3B1cEVuc3VyZVZpc2libGVXaWR0aCA6IDIwMCxcclxuXHRcdHBvcHVwRW5zdXJlVmlzaWJsZUhlaWdodDogMTIwXHJcblx0fSxcclxuXHRzaW11bGF0aW9uIDoge1xyXG5cdFx0cGluZ0ludGVydmFsIDogMTAsIC8vIGludGVydmFsIGluIHNlY29uZHMgdG8gcGluZyB3aXRoIGdwcyBkYXRhXHJcblx0XHRncHNJbmFjY3VyYWN5IDogMCwgIC8vIGVycm9yIHNpbXVsYXRpb24gaW4gTUVURVIgKGxvb2sgbWF0aC5ncHNJbmFjY3VyYWN5LCBtaW4gMS8yKVxyXG5cdH0sXHJcblx0c2V0dGluZ3MgOiB7XHJcblx0XHRub01pZGRsZVdhcmUgOiAwLCBcdC8vIFNLSVAgbWlkZGxlIHdhcmUgbm9kZSBqcyBhcHBcclxuXHRcdG5vSW50ZXJwb2xhdGlvbiA6IDBcdC8vIDEgLT4gbm8gaW50ZXJwb2xhdGlvbiBvbmx5IHBvaW50c1xyXG5cdH0sXHJcblx0bWF0aCA6IHtcclxuXHRcdGdwc0luYWNjdXJhY3kgOiAyMCxcdC8vVE9ETyAxMyBtaW5cclxuXHRcdHNwZWVkQW5kQWNjZWxlcmF0aW9uQXZlcmFnZURlZ3JlZSA6IDIsXHQvLyBjYWxjdWxhdGlvbiBiYXNlZCBvbiBOIHN0YXRlcyAoYXZlcmFnZSkgKE1JTiAyKVxyXG5cdFx0ZGlzcGxheURlbGF5IDogODAsXHRcdFx0XHRcdFx0Ly8gZGlzcGxheSBkZWxheSBpbiBTRUNPTkRTXHJcblx0XHRpbnRlcnBvbGF0ZUdQU0F2ZXJhZ2UgOiAwLCAvLyBudW1iZXIgb2YgcmVjZW50IHZhbHVlcyB0byBjYWxjdWxhdGUgYXZlcmFnZSBncHMgZm9yIHBvc2l0aW9uIChzbW9vdGhpbmcgdGhlIGN1cnZlLm1pbiAwID0gTk8sMSA9IDIgdmFsdWVzIChjdXJyZW50IGFuZCBsYXN0KSlcclxuXHRcdHJvYWREaXN0YW5jZUJlc3RQb2ludENhbGN1bGF0aW9uQ29lZiA6IDAuMiAvLyBUT0RPIEVYUExBSU5cclxuXHR9LFxyXG5cdGNvbnN0YW50cyA6IFxyXG5cdHtcclxuXHRcdGFnZUdyb3VwcyA6ICBcclxuXHRcdFtcclxuXHRcdCB7XHJcblx0XHRcdCBmcm9tIDogbnVsbCxcclxuXHRcdFx0IHRvIDogOCwgXHJcblx0XHRcdCBjb2RlIDogXCJGaXJzdEFnZUdyb3VwXCJcclxuXHRcdCB9XHJcblx0XHQgLHtcclxuXHRcdFx0IGZyb20gOiA4LFxyXG5cdFx0XHQgdG8gOiA0MCwgXHJcblx0XHRcdCBjb2RlIDogXCJNaWRkbGVBZ2VHcm91cFwiXHJcblx0XHQgfVxyXG5cdFx0ICx7XHJcblx0XHRcdCBmcm9tIDogNDAsXHJcblx0XHRcdCB0byA6IG51bGwsIFxyXG5cdFx0XHQgY29kZSA6IFwiTGFzdEFnZUdyb3VwXCJcclxuXHRcdCB9XHJcblx0XHRdXHJcblx0fSxcclxuXHJcblx0ZXZlbnQgOiB7XHJcblx0XHRiZWdpblRpbWVzdGFtcCA6IChuZXcgRGF0ZSgpKS5nZXRUaW1lKCksXHJcblx0XHRkdXJhdGlvbiA6IDYwLCAvL01JTlVURVNcclxuXHRcdGlkIDogM1xyXG5cdH0sXHJcblxyXG5cdHNlcnZlciA6IHtcclxuXHRcdHByZWZpeCA6IFwiL3RyaWF0aGxvbi9cIlxyXG5cdH0sXHJcblx0XHJcblx0YXBwZWFyYW5jZSA6IHtcclxuXHRcdGRlYnVnIDogMCxcclxuXHRcdHRyYWNrQ29sb3JTd2ltIDogJyM1Njc2ZmYnLFxyXG5cdFx0dHJhY2tDb2xvckJpa2UgOiAnI0UyMDA3NCcsXHJcblx0XHR0cmFja0NvbG9yUnVuIDogICcjMDc5ZjM2JyxcclxuXHJcblx0XHQvLyBOb3RlIHRoZSBzZXF1ZW5jZSBpcyBhbHdheXMgU3dpbS1CaWtlLVJ1biAtIHNvIDIgY2hhbmdlLXBvaW50c1xyXG5cdFx0Ly8gVE9ETyBSdW1lbiAtIGFkZCBzY2FsZSBoZXJlLCBub3QgaW4gU3R5bGVzLmpzXHJcblx0XHRpbWFnZVN0YXJ0IDogXCJpbWcvc3RhcnQucG5nXCIsXHJcblx0XHRpbWFnZUZpbmlzaCA6IFwiaW1nL2ZpbmlzaC5wbmdcIixcclxuXHRcdGltYWdlQ2FtIDogXCJpbWcvY2FtZXJhLnN2Z1wiLFxyXG5cdFx0aW1hZ2VDaGVja3BvaW50U3dpbUJpa2UgOiBcImltZy93ejEuc3ZnXCIsXHJcblx0XHRpbWFnZUNoZWNrcG9pbnRCaWtlUnVuIDogXCJpbWcvd3oyLnN2Z1wiLFxyXG5cdFx0aXNTaG93SW1hZ2VDaGVja3BvaW50IDogdHJ1ZSxcclxuXHJcbiAgICAgICAgLy8gdGhlIGRpc3RhbmNlIGJldHdlZW4gdGhlIGRpcmVjdGlvbiBpY29ucyAtIGluIHBpeGVscyxcclxuICAgICAgICAvLyBpZiBzZXQgbm9uLXBvc2l0aXZlIHZhbHVlICgwIG9yIGxlc3MpIHRoZW4gZG9uJ3Qgc2hvdyB0aGVtIGF0IGFsbFxyXG5cdFx0Ly9kaXJlY3Rpb25JY29uQmV0d2VlbiA6IDIwMFxyXG5cdFx0ZGlyZWN0aW9uSWNvbkJldHdlZW4gOiAtMVxyXG5cdH0sXHJcblxyXG4gICAgaG90c3BvdCA6IHtcclxuICAgICAgICBjYW0gOiB7aW1hZ2UgOlwiaW1nL2NhbWVyYS5zdmdcIn0sICAvLyB1c2UgdGhlIHNhbWUgaW1hZ2UgZm9yIHN0YXRpYyBjYW1lcmFzIGFzIGZvciB0aGUgbW92aW5nIG9uZXNcclxuXHRcdGNhbVN3aW1CaWtlIDoge2ltYWdlIDogXCJpbWcvd3oxLnN2Z1wiLCBzY2FsZSA6IDAuMDQwfSxcclxuXHRcdGNhbUJpa2VSdW4gOiB7aW1hZ2UgOiBcImltZy93ejIuc3ZnXCIsIHNjYWxlIDogMC4wNDB9LFxyXG4gICAgICAgIHdhdGVyIDoge2ltYWdlIDogXCJpbWcvd2F0ZXIuc3ZnXCJ9LFxyXG4gICAgICAgIHV0dXJuIDoge2ltYWdlIDogXCJpbWcvdXR1cm4uc3ZnXCJ9LFxyXG5cclxuXHRcdGttMTAgOiB7aW1hZ2UgOiBcImltZy8xMGttLnN2Z1wiLCBzY2FsZSA6IDEuNX0sXHJcblx0XHRrbTIwIDoge2ltYWdlIDogXCJpbWcvMjBrbS5zdmdcIiwgc2NhbGUgOiAxLjV9LFxyXG5cdFx0a20zMCA6IHtpbWFnZSA6IFwiaW1nLzMwa20uc3ZnXCIsIHNjYWxlIDogMS41fSxcclxuXHRcdGttNDAgOiB7aW1hZ2UgOiBcImltZy80MGttLnN2Z1wiLCBzY2FsZSA6IDEuNX0sXHJcblx0XHRrbTYwIDoge2ltYWdlIDogXCJpbWcvNjBrbS5zdmdcIiwgc2NhbGUgOiAxLjV9LFxyXG5cdFx0a204MCA6IHtpbWFnZSA6IFwiaW1nLzgwa20uc3ZnXCIsIHNjYWxlIDogMS41fSxcclxuXHRcdGttMTAwIDoge2ltYWdlIDogXCJpbWcvMTAwa20uc3ZnXCIsIHNjYWxlIDogMS41fSxcclxuXHRcdGttMTIwIDoge2ltYWdlIDogXCJpbWcvMTIwa20uc3ZnXCIsIHNjYWxlIDogMS41fSxcclxuXHRcdGttMTQwIDoge2ltYWdlIDogXCJpbWcvMTQwa20uc3ZnXCIsIHNjYWxlIDogMS41fSxcclxuXHRcdGttMTYwIDoge2ltYWdlIDogXCJpbWcvMTYwa20uc3ZnXCIsIHNjYWxlIDogMS41fSxcclxuXHRcdGttMTgwIDoge2ltYWdlIDogXCJpbWcvMTgwa20uc3ZnXCIsIHNjYWxlIDogMS41fVxyXG4gICAgfVxyXG59O1xyXG5cclxuZm9yICh2YXIgaSBpbiBDT05GSUcpXHJcblx0ZXhwb3J0c1tpXT1DT05GSUdbaV07XHJcbiIsInZhciBVdGlscz1yZXF1aXJlKCcuL1V0aWxzJyk7XHJcbnZhciBTVFlMRVM9cmVxdWlyZSgnLi9TdHlsZXMnKTtcclxucmVxdWlyZSgnam9vc2UnKTtcclxucmVxdWlyZSgnLi9UcmFjaycpO1xyXG5yZXF1aXJlKCcuL0xpdmVTdHJlYW0nKTtcclxudmFyIENPTkZJRyA9IHJlcXVpcmUoXCIuL0NvbmZpZ1wiKTtcclxuXHJcbkNsYXNzKFwiR3VpXCIsIFxyXG57XHJcbiAgICAvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0Ly8gQUxMIENPT1JESU5BVEVTIEFSRSBJTiBXT1JMRCBNRVJDQVRPUlxyXG4gICAgLy8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG4gICAgaGFzOiBcclxuXHR7XHJcbiAgICBcdGlzRGVidWcgOiB7XHJcbiAgICBcdFx0aXMgOiBcInJ3XCIsXHJcbiAgICBcdFx0aW5pdCA6ICFVdGlscy5tb2JpbGVBbmRUYWJsZXRDaGVjaygpICYmIENPTkZJRy5hcHBlYXJhbmNlLmRlYnVnXHJcbiAgICBcdH0sXHJcblx0XHRpc1dpZGdldCA6IHtcclxuXHRcdFx0aW5pdCA6IGZhbHNlXHJcblx0XHR9LFxyXG5cdFx0aXNEZWJ1Z1Nob3dQb3NpdGlvbiA6IHtcclxuXHRcdFx0Ly8gaWYgc2V0IHRvIHRydWUgaXQgd2lsbCBhZGQgYW4gYWJzb2x1dGUgZWxlbWVudCBzaG93aW5nIHRoZSBjb29yZGluYXRlcyBhYm92ZSB0aGUgbW91c2UgbG9jYXRpb25cclxuXHRcdFx0aW5pdCA6IGZhbHNlXHJcblx0XHR9LFxyXG5cdFx0cmVjZWl2ZXJPbk1hcENsaWNrIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IFtdXHJcblx0XHR9LFxyXG4gICAgICAgIHdpZHRoIDoge1xyXG4gICAgICAgICAgICBpczogICBcInJ3XCIsXHJcbiAgICAgICAgICAgIGluaXQ6IDc1MFxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgaGVpZ2h0OiB7XHJcbiAgICAgICAgICAgIGlzOiAgIFwicndcIixcclxuICAgICAgICAgICAgaW5pdDogNTAwXHJcbiAgICAgICAgfSxcclxuXHRcdHRyYWNrIDoge1xyXG5cdFx0XHRpczogICBcInJ3XCJcclxuXHRcdH0sXHJcblx0XHRlbGVtZW50SWQgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogXCJtYXBcIlxyXG5cdFx0fSxcclxuXHRcdGluaXRpYWxQb3MgOiB7XHRcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiBudWxsXHJcblx0XHR9LFxyXG5cdFx0aW5pdGlhbFpvb20gOiB7XHRcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiAxMFxyXG5cdFx0fSxcclxuXHRcdGJpbmdNYXBLZXkgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogJ0FpanQzQXNXT01FM2hQRUVfSHFSbFVLZGNCS3FlOGRHUlpIX3YtTDNIX0ZGNjRzdlhNYmtyMVQ2dV9XQVNvZXQnXHJcblx0XHR9LFxyXG5cdFx0Ly8tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0XHRtYXAgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogbnVsbFxyXG5cdFx0fSxcclxuXHRcdHRyYWNrTGF5ZXIgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogbnVsbFxyXG5cdFx0fSxcclxuICAgICAgICBob3RzcG90c0xheWVyIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IG51bGxcclxuXHRcdH0sXHJcbiAgICAgICAgY2Ftc0xheWVyIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IG51bGxcclxuXHRcdH0sXHJcblx0XHRwYXJ0aWNpcGFudHNMYXllciA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiBudWxsXHJcblx0XHR9LFxyXG5cdFx0ZGVidWdMYXllckdQUyA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiBudWxsXHJcblx0XHR9LFx0XHJcblx0XHR0ZXN0TGF5ZXIgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogbnVsbFxyXG5cdFx0fSxcdFxyXG5cdFx0XHJcblx0XHRzZWxlY3RlZFBhcnRpY2lwYW50MSA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiBudWxsXHJcblx0XHR9LFxyXG5cdFx0c2VsZWN0ZWRQYXJ0aWNpcGFudDIgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogbnVsbFxyXG5cdFx0fSxcclxuXHRcdHBvcHVwMSA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiBudWxsXHJcblx0XHR9LFxyXG5cdFx0cG9wdXAyIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IG51bGxcclxuXHRcdH0sXHJcblx0XHRpc1Nob3dTd2ltIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IHRydWVcclxuXHRcdH0sXHJcblx0XHRpc1Nob3dCaWtlIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IHRydWVcclxuXHRcdH0sXHJcblx0XHRpc1Nob3dSdW4gOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogdHJ1ZVxyXG5cdFx0fSxcclxuXHRcdHNlbGVjdE51bSA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiAxXHJcblx0XHR9LFxyXG4gICAgICAgIGxpdmVTdHJlYW0gOiB7XHJcbiAgICAgICAgICAgIGluaXQ6IG51bGxcclxuICAgICAgICB9XHJcbiAgICB9LFxyXG4gICAgLy8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdG1ldGhvZHM6IFxyXG5cdHtcclxuICAgICAgICBpbml0OiBmdW5jdGlvbiAocGFyYW1zKSAgXHJcblx0XHR7XHJcblx0XHRcdC8vIGlmIGluIHdpZGdldCBtb2RlIHRoZW4gZGlzYWJsZSBkZWJ1Z1xyXG5cdFx0XHRpZiAodGhpcy5pc1dpZGdldCkge1xyXG5cdFx0XHRcdHRoaXMuaXNEZWJ1ZyA9IGZhbHNlO1xyXG5cdFx0XHR9XHJcblxyXG5cdFx0XHR2YXIgZGVmUG9zID0gWzAsMF07XHJcblx0XHRcdGlmICh0aGlzLmluaXRpYWxQb3MpIFxyXG5cdFx0XHRcdGRlZlBvcz10aGlzLmluaXRpYWxQb3M7XHJcblx0XHRcdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0XHRcdHZhciBleHRlbnQgPSBwYXJhbXMgJiYgcGFyYW1zLnNraXBFeHRlbnQgPyBudWxsIDogVFJBQ0suZ2V0Um91dGUoKSAmJiBUUkFDSy5nZXRSb3V0ZSgpLmxlbmd0aCA+IDEgPyBvbC5wcm9qLnRyYW5zZm9ybUV4dGVudCggKG5ldyBvbC5nZW9tLkxpbmVTdHJpbmcoVFJBQ0suZ2V0Um91dGUoKSkpLmdldEV4dGVudCgpICwgJ0VQU0c6NDMyNicsICdFUFNHOjM4NTcnKSA6IG51bGw7XHJcblx0XHRcdHRoaXMudHJhY2tMYXllciA9IG5ldyBvbC5sYXllci5WZWN0b3Ioe1xyXG5cdFx0XHQgIHNvdXJjZTogbmV3IG9sLnNvdXJjZS5WZWN0b3IoKSxcclxuXHRcdFx0ICBzdHlsZSA6IFNUWUxFU1tcInRyYWNrXCJdXHJcblx0XHRcdH0pO1xyXG5cdFx0XHR0aGlzLmhvdHNwb3RzTGF5ZXIgPSBuZXcgb2wubGF5ZXIuVmVjdG9yKHtcclxuXHRcdFx0ICBzb3VyY2U6IG5ldyBvbC5zb3VyY2UuVmVjdG9yKCksXHJcblx0XHRcdCAgc3R5bGUgOiBTVFlMRVNbXCJob3RzcG90XCJdXHJcblx0XHRcdH0pO1xyXG5cdFx0XHR0aGlzLnBhcnRpY2lwYW50c0xheWVyID0gbmV3IG9sLmxheWVyLlZlY3Rvcih7XHJcblx0XHRcdCAgc291cmNlOiBuZXcgb2wuc291cmNlLlZlY3RvcigpLFxyXG5cdFx0XHQgIHN0eWxlIDogU1RZTEVTW1wicGFydGljaXBhbnRcIl1cclxuXHRcdFx0fSk7XHJcblx0XHRcdHRoaXMuY2Ftc0xheWVyID0gbmV3IG9sLmxheWVyLlZlY3Rvcih7XHJcblx0XHRcdFx0c291cmNlOiBuZXcgb2wuc291cmNlLlZlY3RvcigpLFxyXG5cdFx0XHRcdHN0eWxlIDogU1RZTEVTW1wiY2FtXCJdXHJcblx0XHRcdH0pO1xyXG5cdFx0XHRpZiAodGhpcy5pc0RlYnVnKSBcclxuXHRcdFx0e1xyXG5cdFx0XHRcdHRoaXMuZGVidWdMYXllckdQUyA9IG5ldyBvbC5sYXllci5WZWN0b3Ioe1xyXG5cdFx0XHRcdFx0ICBzb3VyY2U6IG5ldyBvbC5zb3VyY2UuVmVjdG9yKCksXHJcblx0XHRcdFx0XHQgIHN0eWxlIDogU1RZTEVTW1wiZGVidWdHUFNcIl1cclxuXHRcdFx0XHR9KTtcclxuXHRcdFx0XHR0aGlzLnRlc3RMYXllciA9IG5ldyBvbC5sYXllci5WZWN0b3Ioe1xyXG5cdFx0XHRcdFx0ICBzb3VyY2U6IG5ldyBvbC5zb3VyY2UuVmVjdG9yKCksXHJcblx0XHRcdFx0XHQgIHN0eWxlIDogU1RZTEVTW1widGVzdFwiXVxyXG5cdFx0XHRcdH0pO1xyXG5cdFx0XHR9XHJcblx0XHRcdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRcdFx0dmFyIGludHMgPSBbXTtcclxuXHRcdFx0dGhpcy5wb3B1cDEgPSBuZXcgb2wuT3ZlcmxheS5Qb3B1cCh7YW5pOmZhbHNlLHBhbk1hcElmT3V0T2ZWaWV3IDogZmFsc2V9KTtcclxuXHRcdFx0dGhpcy5wb3B1cDIgPSBuZXcgb2wuT3ZlcmxheS5Qb3B1cCh7YW5pOmZhbHNlLHBhbk1hcElmT3V0T2ZWaWV3IDogZmFsc2V9KTtcclxuXHRcdFx0dGhpcy5wb3B1cDIuc2V0T2Zmc2V0KFswLDE3NV0pO1xyXG5cdFx0XHR0aGlzLm1hcCA9IG5ldyBvbC5NYXAoe1xyXG5cdFx0XHQgIHJlbmRlcmVyIDogXCJjYW52YXNcIixcclxuXHRcdFx0ICB0YXJnZXQ6ICdtYXAnLFxyXG5cdFx0XHQgIGxheWVyczogW1xyXG5cdFx0XHQgICAgICAgICAgIG5ldyBvbC5sYXllci5UaWxlKHtcclxuXHRcdFx0ICAgICAgICAgICAgICAgc291cmNlOiBuZXcgb2wuc291cmNlLk9TTSgpXHJcblx0XHRcdCAgICAgICAgICAgfSksXHJcblx0XHRcdFx0XHR0aGlzLnRyYWNrTGF5ZXIsXHJcblx0XHRcdFx0XHR0aGlzLmhvdHNwb3RzTGF5ZXIsXHJcblx0XHRcdFx0XHR0aGlzLmNhbXNMYXllcixcclxuXHRcdFx0XHRcdHRoaXMucGFydGljaXBhbnRzTGF5ZXJcclxuXHRcdFx0ICBdLFxyXG5cdFx0XHQgIGNvbnRyb2xzOiB0aGlzLmlzV2lkZ2V0ID8gW10gOiBvbC5jb250cm9sLmRlZmF1bHRzKCksXHJcblx0XHRcdCAgdmlldzogbmV3IG9sLlZpZXcoe1xyXG5cdFx0XHRcdGNlbnRlcjogb2wucHJvai50cmFuc2Zvcm0oZGVmUG9zLCAnRVBTRzo0MzI2JywgJ0VQU0c6Mzg1NycpLFxyXG5cdFx0XHRcdHpvb206IHRoaXMuZ2V0SW5pdGlhbFpvb20oKSxcclxuXHRcdFx0XHRtaW5ab29tOiB0aGlzLmlzV2lkZ2V0ID8gdGhpcy5pbml0aWFsWm9vbSA6IDEwLFxyXG5cdFx0XHRcdG1heFpvb206IHRoaXMuaXNXaWRnZXQgPyB0aGlzLmluaXRpYWxab29tIDogMTcsXHJcblx0XHRcdFx0ZXh0ZW50IDogZXh0ZW50ID8gZXh0ZW50IDogdW5kZWZpbmVkXHJcblx0XHRcdCAgfSlcclxuXHRcdFx0fSk7XHJcblx0XHRcdFxyXG5cdFx0XHRmb3IgKHZhciBpPTA7aTxpbnRzLmxlbmd0aDtpKyspXHJcblx0XHRcdFx0dGhpcy5tYXAuYWRkSW50ZXJhY3Rpb24oaW50c1tpXSk7XHJcblx0XHRcdHRoaXMubWFwLmFkZE92ZXJsYXkodGhpcy5wb3B1cDEpO1xyXG5cdFx0XHR0aGlzLm1hcC5hZGRPdmVybGF5KHRoaXMucG9wdXAyKTtcclxuXHRcdFx0aWYgKHRoaXMuaXNEZWJ1ZykgeyBcclxuXHRcdFx0XHR0aGlzLm1hcC5hZGRMYXllcih0aGlzLmRlYnVnTGF5ZXJHUFMpO1xyXG5cdFx0XHRcdHRoaXMubWFwLmFkZExheWVyKHRoaXMudGVzdExheWVyKTtcclxuXHRcdFx0fVxyXG5cdFx0XHRUUkFDSy5pbml0KCk7XHJcblx0XHRcdHRoaXMuYWRkVHJhY2tGZWF0dXJlKCk7XHJcblx0XHRcdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdFx0XHRpZiAoIXRoaXMuaXNXaWRnZXQpIHtcclxuXHRcdFx0XHR0aGlzLm1hcC5vbignY2xpY2snLCBmdW5jdGlvbiAoZXZlbnQpIHtcclxuXHRcdFx0XHRcdFRSQUNLLm9uTWFwQ2xpY2soZXZlbnQpO1xyXG5cdFx0XHRcdFx0dmFyIHNlbGVjdGVkUGFydGljaXBhbnRzID0gW107XHJcblx0XHRcdFx0XHR2YXIgc2VsZWN0ZWRIb3RzcG90ID0gbnVsbDtcclxuXHRcdFx0XHRcdHRoaXMubWFwLmZvckVhY2hGZWF0dXJlQXRQaXhlbChldmVudC5waXhlbCwgZnVuY3Rpb24gKGZlYXR1cmUsIGxheWVyKSB7XHJcblx0XHRcdFx0XHRcdGlmIChsYXllciA9PSB0aGlzLnBhcnRpY2lwYW50c0xheWVyKSB7XHJcblx0XHRcdFx0XHRcdFx0c2VsZWN0ZWRQYXJ0aWNpcGFudHMucHVzaChmZWF0dXJlKTtcclxuXHRcdFx0XHRcdFx0fSBlbHNlIGlmIChsYXllciA9PSB0aGlzLmhvdHNwb3RzTGF5ZXIpIHtcclxuXHRcdFx0XHRcdFx0XHQvLyBhbGxvdyBvbmx5IG9uZSBob3RzcG90IHRvIGJlIHNlbGVjdGVkIGF0IGEgdGltZVxyXG5cdFx0XHRcdFx0XHRcdGlmICghc2VsZWN0ZWRIb3RzcG90KVxyXG5cdFx0XHRcdFx0XHRcdFx0c2VsZWN0ZWRIb3RzcG90ID0gZmVhdHVyZTtcclxuXHRcdFx0XHRcdFx0fVxyXG5cdFx0XHRcdFx0fSwgdGhpcyk7XHJcblxyXG5cdFx0XHRcdFx0Ly8gZmlyc3QgaWYgdGhlcmUgYXJlIHNlbGVjdGVkIHBhcnRpY2lwYW50cyB0aGVuIHNob3cgdGhlaXIgcG9wdXBzXHJcblx0XHRcdFx0XHQvLyBhbmQgb25seSBpZiB0aGVyZSBhcmUgbm90IHVzZSB0aGUgc2VsZWN0ZWQgaG90c3BvdCBpZiB0aGVyZSdzIGFueVxyXG5cdFx0XHRcdFx0aWYgKHNlbGVjdGVkUGFydGljaXBhbnRzLmxlbmd0aCkge1xyXG5cdFx0XHRcdFx0XHRpZiAodGhpcy5zZWxlY3RlZFBhcnRpY2lwYW50MSA9PSBudWxsKSB7XHJcblx0XHRcdFx0XHRcdFx0dmFyIGZlYXQgPSB0aGlzLmdldFNlbGVjdGVkUGFydGljaXBhbnRGcm9tQXJyYXlDeWNsaWMoc2VsZWN0ZWRQYXJ0aWNpcGFudHMpO1xyXG5cdFx0XHRcdFx0XHRcdGlmIChmZWF0KVxyXG5cdFx0XHRcdFx0XHRcdFx0dGhpcy5zZXRTZWxlY3RlZFBhcnRpY2lwYW50MShmZWF0LnBhcnRpY2lwYW50KTtcclxuXHRcdFx0XHRcdFx0XHRlbHNlXHJcblx0XHRcdFx0XHRcdFx0XHR0aGlzLnNldFNlbGVjdGVkUGFydGljaXBhbnQxKG51bGwpO1xyXG5cdFx0XHRcdFx0XHRcdHRoaXMuc2VsZWN0TnVtID0gMDtcclxuXHRcdFx0XHRcdFx0fSBlbHNlIGlmICh0aGlzLnNlbGVjdGVkUGFydGljaXBhbnQyID09IG51bGwpIHtcclxuXHRcdFx0XHRcdFx0XHR2YXIgZmVhdCA9IHRoaXMuZ2V0U2VsZWN0ZWRQYXJ0aWNpcGFudEZyb21BcnJheUN5Y2xpYyhzZWxlY3RlZFBhcnRpY2lwYW50cyk7XHJcblx0XHRcdFx0XHRcdFx0aWYgKGZlYXQpXHJcblx0XHRcdFx0XHRcdFx0XHR0aGlzLnNldFNlbGVjdGVkUGFydGljaXBhbnQyKGZlYXQucGFydGljaXBhbnQpO1xyXG5cdFx0XHRcdFx0XHRcdGVsc2VcclxuXHRcdFx0XHRcdFx0XHRcdHRoaXMuc2V0U2VsZWN0ZWRQYXJ0aWNpcGFudDIobnVsbCk7XHJcblx0XHRcdFx0XHRcdFx0dGhpcy5zZWxlY3ROdW0gPSAxO1xyXG5cdFx0XHRcdFx0XHR9IGVsc2Uge1xyXG5cdFx0XHRcdFx0XHRcdHRoaXMuc2VsZWN0TnVtID0gKHRoaXMuc2VsZWN0TnVtICsgMSkgJSAyO1xyXG5cdFx0XHRcdFx0XHRcdGlmICh0aGlzLnNlbGVjdE51bSA9PSAwKSB7XHJcblx0XHRcdFx0XHRcdFx0XHR2YXIgZmVhdCA9IHRoaXMuZ2V0U2VsZWN0ZWRQYXJ0aWNpcGFudEZyb21BcnJheUN5Y2xpYyhzZWxlY3RlZFBhcnRpY2lwYW50cyk7XHJcblx0XHRcdFx0XHRcdFx0XHRpZiAoZmVhdClcclxuXHRcdFx0XHRcdFx0XHRcdFx0dGhpcy5zZXRTZWxlY3RlZFBhcnRpY2lwYW50MShmZWF0LnBhcnRpY2lwYW50KTtcclxuXHRcdFx0XHRcdFx0XHRcdGVsc2VcclxuXHRcdFx0XHRcdFx0XHRcdFx0dGhpcy5zZXRTZWxlY3RlZFBhcnRpY2lwYW50MShudWxsKTtcclxuXHRcdFx0XHRcdFx0XHR9IGVsc2Uge1xyXG5cdFx0XHRcdFx0XHRcdFx0dmFyIGZlYXQgPSB0aGlzLmdldFNlbGVjdGVkUGFydGljaXBhbnRGcm9tQXJyYXlDeWNsaWMoc2VsZWN0ZWRQYXJ0aWNpcGFudHMpO1xyXG5cdFx0XHRcdFx0XHRcdFx0aWYgKGZlYXQpXHJcblx0XHRcdFx0XHRcdFx0XHRcdHRoaXMuc2V0U2VsZWN0ZWRQYXJ0aWNpcGFudDIoZmVhdC5wYXJ0aWNpcGFudCk7XHJcblx0XHRcdFx0XHRcdFx0XHRlbHNlXHJcblx0XHRcdFx0XHRcdFx0XHRcdHRoaXMuc2V0U2VsZWN0ZWRQYXJ0aWNpcGFudDIobnVsbCk7XHJcblx0XHRcdFx0XHRcdFx0fVxyXG5cdFx0XHRcdFx0XHR9XHJcblx0XHRcdFx0XHR9IGVsc2Uge1xyXG5cdFx0XHRcdFx0XHR0aGlzLnNldFNlbGVjdGVkUGFydGljaXBhbnQxKG51bGwpO1xyXG5cdFx0XHRcdFx0XHR0aGlzLnNldFNlbGVjdGVkUGFydGljaXBhbnQyKG51bGwpO1xyXG5cclxuXHRcdFx0XHRcdFx0aWYgKHNlbGVjdGVkSG90c3BvdCkge1xyXG5cdFx0XHRcdFx0XHRcdHNlbGVjdGVkSG90c3BvdC5ob3RzcG90Lm9uQ2xpY2soKTtcclxuXHRcdFx0XHRcdFx0fVxyXG5cdFx0XHRcdFx0fVxyXG5cdFx0XHRcdH0sIHRoaXMpO1xyXG5cclxuXHRcdFx0XHQvLyBjaGFuZ2UgbW91c2UgY3Vyc29yIHdoZW4gb3ZlciBzcGVjaWZpYyBmZWF0dXJlc1xyXG5cdFx0XHRcdHZhciBzZWxmID0gdGhpcztcclxuXHRcdFx0XHQkKHRoaXMubWFwLmdldFZpZXdwb3J0KCkpLm9uKCdtb3VzZW1vdmUnLCBmdW5jdGlvbiAoZSkge1xyXG5cdFx0XHRcdFx0dmFyIHBpeGVsID0gc2VsZi5tYXAuZ2V0RXZlbnRQaXhlbChlLm9yaWdpbmFsRXZlbnQpO1xyXG5cdFx0XHRcdFx0dmFyIGlzQ2xpY2thYmxlID0gc2VsZi5tYXAuZm9yRWFjaEZlYXR1cmVBdFBpeGVsKHBpeGVsLCBmdW5jdGlvbiAoZmVhdHVyZSwgbGF5ZXIpIHtcclxuXHRcdFx0XHRcdFx0aWYgKGxheWVyID09PSBzZWxmLnBhcnRpY2lwYW50c0xheWVyIHx8IGxheWVyID09PSBzZWxmLmNhbXNMYXllcikge1xyXG5cdFx0XHRcdFx0XHRcdC8vIGFsbCBwYXJ0aWNpcGFudHMgYW5kIG1vdmluZyBjYW1lcmFzIGFyZSBjbGlja2FibGVcclxuXHRcdFx0XHRcdFx0XHRyZXR1cm4gdHJ1ZTtcclxuXHRcdFx0XHRcdFx0fSBlbHNlIGlmIChsYXllciA9PT0gc2VsZi5ob3RzcG90c0xheWVyKSB7XHJcblx0XHRcdFx0XHRcdFx0Ly8gZ2V0IFwiY2xpY2thYmlsaXR5XCIgZnJvbSB0aGUgaG90c3BvdFxyXG5cdFx0XHRcdFx0XHRcdHJldHVybiBmZWF0dXJlLmhvdHNwb3QuaXNDbGlja2FibGUoKTtcclxuXHRcdFx0XHRcdFx0fVxyXG5cdFx0XHRcdFx0fSk7XHJcblx0XHRcdFx0XHRzZWxmLm1hcC5nZXRWaWV3cG9ydCgpLnN0eWxlLmN1cnNvciA9IGlzQ2xpY2thYmxlID8gJ3BvaW50ZXInIDogJyc7XHJcblx0XHRcdFx0fSk7XHJcblx0XHRcdH1cclxuXHRcdFx0Ly8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdFx0XHRpZiAoIXRoaXMuX2FuaW1hdGlvbkluaXQpIHtcclxuXHRcdFx0XHR0aGlzLl9hbmltYXRpb25Jbml0PXRydWU7XHJcblx0XHRcdFx0c2V0SW50ZXJ2YWwodGhpcy5vbkFuaW1hdGlvbi5iaW5kKHRoaXMpLCAxMDAwKkNPTkZJRy50aW1lb3V0cy5hbmltYXRpb25GcmFtZSApO1xyXG5cdFx0XHR9XHJcblxyXG5cdFx0XHQvLyBpZiB0aGlzIGlzIE9OIHRoZW4gaXQgd2lsbCBzaG93IHRoZSBjb29yZGluYXRlcyBwb3NpdGlvbiB1bmRlciB0aGUgbW91c2UgbG9jYXRpb25cclxuXHRcdFx0aWYgKHRoaXMuaXNEZWJ1Z1Nob3dQb3NpdGlvbikge1xyXG5cdFx0XHRcdCQoXCIjbWFwXCIpLmFwcGVuZCgnPHAgaWQ9XCJkZWJ1Z1Nob3dQb3NpdGlvblwiPkVQU0c6Mzg1NyA8c3BhbiBpZD1cIm1vdXNlMzg1N1wiPjwvc3Bhbj4gJm5ic3A7IEVQU0c6NDMyNiA8c3BhbiBpZD1cIm1vdXNlNDMyNlwiPjwvc3Bhbj4nKTtcclxuXHRcdFx0XHR0aGlzLm1hcC5vbigncG9pbnRlcm1vdmUnLCBmdW5jdGlvbihldmVudCkge1xyXG5cdFx0XHRcdFx0dmFyIGNvb3JkMzg1NyA9IGV2ZW50LmNvb3JkaW5hdGU7XHJcblx0XHRcdFx0XHR2YXIgY29vcmQ0MzI2ID0gb2wucHJvai50cmFuc2Zvcm0oY29vcmQzODU3LCAnRVBTRzozODU3JywgJ0VQU0c6NDMyNicpO1xyXG5cdFx0XHRcdFx0JCgnI21vdXNlMzg1NycpLnRleHQob2wuY29vcmRpbmF0ZS50b1N0cmluZ1hZKGNvb3JkMzg1NywgMikpO1xyXG5cdFx0XHRcdFx0JCgnI21vdXNlNDMyNicpLnRleHQob2wuY29vcmRpbmF0ZS50b1N0cmluZ1hZKGNvb3JkNDMyNiwgMTUpKTtcclxuXHRcdFx0XHR9KTtcclxuXHRcdFx0fVxyXG5cclxuXHRcdFx0Ly8gcGFzcyB0aGUgaWQgb2YgdGhlIERPTSBlbGVtZW50XHJcblx0XHRcdHRoaXMubGl2ZVN0cmVhbSA9IG5ldyBMaXZlU3RyZWFtKHtpZCA6IFwibGl2ZVN0cmVhbVwifSk7XHJcbiAgICAgICAgfSxcclxuXHRcdFxyXG4gICAgICAgIFxyXG4gICAgICAgIGFkZFRyYWNrRmVhdHVyZSA6IGZ1bmN0aW9uKCkge1xyXG4gICAgICAgIFx0VFJBQ0suaW5pdCgpO1xyXG4gICAgICAgIFx0aWYgKFRSQUNLLmZlYXR1cmUpIHtcclxuICAgICAgICBcdFx0dmFyIGZ0ID0gdGhpcy50cmFja0xheWVyLmdldFNvdXJjZSgpLmdldEZlYXR1cmVzKCk7XHJcbiAgICAgICAgXHRcdHZhciBvaz1mYWxzZTtcclxuICAgICAgICBcdFx0Zm9yICh2YXIgaT0wO2k8ZnQubGVuZ3RoO2krKykgXHJcbiAgICAgICAgXHRcdHtcclxuICAgICAgICBcdFx0XHRpZiAoZnRbaV0gPT0gVFJBQ0suZmVhdHVyZSlcclxuICAgICAgICBcdFx0XHR7XHJcbiAgICAgICAgXHRcdFx0XHRvaz10cnVlO1xyXG4gICAgICAgIFx0XHRcdFx0YnJlYWs7XHJcbiAgICAgICAgXHRcdFx0fVxyXG4gICAgICAgIFx0XHR9XHJcbiAgICAgICAgXHRcdGlmICghb2spXHJcbiAgICAgICAgXHRcdFx0dGhpcy50cmFja0xheWVyLmdldFNvdXJjZSgpLmFkZEZlYXR1cmUoVFJBQ0suZmVhdHVyZSk7XHJcbiAgICAgICAgXHR9XHJcbiAgICAgICAgfSxcclxuICAgICAgICB6b29tVG9UcmFjayA6IGZ1bmN0aW9uKCkge1xyXG4gICAgICAgICAgICB2YXIgZXh0ZW50ID0gVFJBQ0suZ2V0Um91dGUoKSAmJiBUUkFDSy5nZXRSb3V0ZSgpLmxlbmd0aCA+IDEgPyBvbC5wcm9qLnRyYW5zZm9ybUV4dGVudCggKG5ldyBvbC5nZW9tLkxpbmVTdHJpbmcoVFJBQ0suZ2V0Um91dGUoKSkpLmdldEV4dGVudCgpICwgJ0VQU0c6NDMyNicsICdFUFNHOjM4NTcnKSA6IG51bGw7XHJcbiAgICAgICAgICAgIGlmIChleHRlbnQpXHJcbiAgICAgICAgICAgIFx0dGhpcy5tYXAuZ2V0VmlldygpLmZpdEV4dGVudChleHRlbnQsdGhpcy5tYXAuZ2V0U2l6ZSgpKTtcclxuICAgICAgICB9LFxyXG4gICAgICAgIFxyXG4gICAgICAgIGdldFNlbGVjdGVkUGFydGljaXBhbnRGcm9tQXJyYXlDeWNsaWMgOiBmdW5jdGlvbihmZWF0dXJlcykge1xyXG4gICAgXHRcdHZhciBhcnIgPSBbXTtcclxuICAgIFx0XHR2YXIgdG1hcCA9IHt9O1xyXG4gICAgXHRcdHZhciBjcnJQb3MgPSAwO1xyXG5cdFx0XHR2YXIgcG9zPW51bGw7XHJcbiAgICBcdFx0Zm9yICh2YXIgaT0wO2k8ZmVhdHVyZXMubGVuZ3RoO2krKykge1xyXG4gICAgXHRcdFx0dmFyIGZlYXR1cmUgPSBmZWF0dXJlc1tpXTtcclxuICAgIFx0XHRcdHZhciBpZCA9IGZlYXR1cmUucGFydGljaXBhbnQuY29kZTtcclxuICAgIFx0XHRcdGFyci5wdXNoKGlkKTtcclxuICAgIFx0XHRcdHRtYXBbaWRdPXRydWU7XHJcblx0XHRcdFx0aWYgKGlkID09IHRoaXMudnJfbGFzdHNlbGVjdGVkKSB7XHJcblx0XHRcdFx0XHRwb3M9aTtcclxuXHRcdFx0XHR9XHJcbiAgICBcdFx0fVxyXG4gICAgXHRcdHZhciBzYW1lID0gdGhpcy52cl9vbGRiZXN0YXJyICYmIHBvcyAhPSBudWxsOyBcclxuICAgIFx0XHRpZiAoc2FtZSkgXHJcbiAgICBcdFx0e1xyXG4gICAgXHRcdFx0Ly8gYWxsIGZyb20gdGhlIG9sZCBjb250YWluZWQgaW4gdGhlIG5ld1xyXG4gICAgXHRcdFx0Zm9yICh2YXIgaT0wO2k8dGhpcy52cl9vbGRiZXN0YXJyLmxlbmd0aDtpKyspIFxyXG4gICAgXHRcdFx0e1xyXG4gICAgXHRcdFx0XHRpZiAoIXRtYXBbdGhpcy52cl9vbGRiZXN0YXJyW2ldXSkge1xyXG4gICAgXHRcdFx0XHRcdHNhbWU9ZmFsc2U7XHJcbiAgICBcdFx0XHRcdFx0YnJlYWs7XHJcbiAgICBcdFx0XHRcdH1cclxuICAgIFx0XHRcdH1cclxuICAgIFx0XHR9XHJcbiAgICBcdFx0aWYgKCFzYW1lKSB7XHJcbiAgICBcdFx0XHR0aGlzLnZyX29sZGJlc3RhcnI9YXJyO1xyXG4gICAgXHRcdFx0dGhpcy52cl9sYXN0c2VsZWN0ZWQ9YXJyWzBdO1xyXG4gICAgXHRcdFx0cmV0dXJuIGZlYXR1cmVzWzBdO1xyXG4gICAgXHRcdH0gZWxzZSB7XHJcbiAgICBcdFx0XHR0aGlzLnZyX2xhc3RzZWxlY3RlZCA9IHBvcyA+IDAgPyBhcnJbcG9zLTFdIDogYXJyW2Fyci5sZW5ndGgtMV07ICAgIFx0XHRcdFxyXG4gICAgICAgIFx0XHR2YXIgcmVzdWx0RmVhdHVyZTtcclxuICAgIFx0XHRcdGZvciAodmFyIGk9MDtpPGZlYXR1cmVzLmxlbmd0aDtpKyspIFxyXG4gICAgICAgIFx0XHR7XHJcbiAgICAgICAgXHRcdFx0dmFyIGZlYXR1cmUgPSBmZWF0dXJlc1tpXTtcclxuICAgICAgICBcdFx0XHR2YXIgaWQgPSBmZWF0dXJlLnBhcnRpY2lwYW50LmNvZGU7XHJcbiAgICAgICAgXHRcdFx0aWYgKGlkID09IHRoaXMudnJfbGFzdHNlbGVjdGVkKSB7XHJcbiAgICAgICAgXHRcdFx0XHRyZXN1bHRGZWF0dXJlPWZlYXR1cmU7XHJcbiAgICAgICAgXHRcdFx0XHRicmVhaztcclxuICAgICAgICBcdFx0XHR9XHJcbiAgICAgICAgXHRcdH1cclxuICAgICAgICAgICAgICAgIHJldHVybiByZXN1bHRGZWF0dXJlO1xyXG4gICAgXHRcdH1cclxuICAgICAgICB9LFxyXG4gICAgICAgIFxyXG5cdFx0c2hvd0Vycm9yIDogZnVuY3Rpb24obXNnLG9uQ2xvc2VDYWxsYmFjaylcclxuXHRcdHtcclxuXHRcdFx0YWxlcnQoXCJFUlJPUiA6IFwiK21zZyk7XHJcblx0XHRcdGlmIChvbkNsb3NlQ2FsbGJhY2spIFxyXG5cdFx0XHRcdG9uQ2xvc2VDYWxsYmFjaygpO1xyXG5cdFx0fSxcclxuXHRcdFxyXG5cdFx0b25BbmltYXRpb24gOiBmdW5jdGlvbigpXHJcblx0XHR7XHJcblx0XHRcdHZhciBhcnI9W107XHJcblx0XHRcdGZvciAodmFyIGlwPTA7aXA8VFJBQ0sucGFydGljaXBhbnRzLmxlbmd0aDtpcCsrKVxyXG5cdFx0XHR7XHJcblx0XHRcdFx0dmFyIHAgPSBUUkFDSy5wYXJ0aWNpcGFudHNbaXBdO1xyXG5cdFx0XHRcdGlmIChwLmlzRmF2b3JpdGUpXHJcblx0XHRcdFx0e1xyXG5cdFx0XHRcdFx0cC5pbnRlcnBvbGF0ZSgpO1xyXG5cclxuXHRcdFx0XHRcdC8vIHRoaXMgd2lsbCBhZGQgaW4gdGhlIHJhbmtpbmcgcG9zaXRpbmcgb25seSB0aGUgcGFydGljaXBhbnRzIHRoZSBoYXMgdG8gYmUgdHJhY2tlZFxyXG5cdFx0XHRcdFx0Ly8gc28gbW92aW5nIGNhbXMgYXJlIHNraXBwZWRcclxuXHRcdFx0XHRcdGlmICghcC5fX3NraXBUcmFja2luZ1BvcylcclxuXHRcdFx0XHRcdFx0YXJyLnB1c2goaXApO1xyXG5cdFx0XHRcdH1cclxuXHRcdFx0fVxyXG5cdFx0XHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRcdFx0Ly8gd2UgaGF2ZSB0byBzb3J0IHRoZW0gb3RoZXJ3aXNlIHRoaXMgX19wb3MsIF9fcHJldiwgX19uZXh0IGFyZSBpcnJlbGV2YW50XHJcblx0XHRcdGFyci5zb3J0KGZ1bmN0aW9uKGlwMSwgaWQyKXtcclxuXHRcdFx0XHRyZXR1cm4gVFJBQ0sucGFydGljaXBhbnRzW2lkMl0uZ2V0RWxhcHNlZCgpIC0gVFJBQ0sucGFydGljaXBhbnRzW2lwMV0uZ2V0RWxhcHNlZCgpO1xyXG5cdFx0XHR9KTtcclxuXHRcdFx0Zm9yICh2YXIgaXA9MDtpcDxhcnIubGVuZ3RoO2lwKyspXHJcblx0XHRcdHtcclxuXHRcdFx0XHRUUkFDSy5wYXJ0aWNpcGFudHNbYXJyW2lwXV0uX19wb3M9aXA7XHJcblx0XHRcdFx0aWYgKGlwID09IDApXHJcblx0XHRcdFx0XHRkZWxldGUgVFJBQ0sucGFydGljaXBhbnRzW2FycltpcF1dLl9fcHJldjtcclxuXHRcdFx0XHRlbHNlXHJcblx0XHRcdFx0XHRUUkFDSy5wYXJ0aWNpcGFudHNbYXJyW2lwXV0uX19wcmV2PVRSQUNLLnBhcnRpY2lwYW50c1thcnJbaXAtMV1dO1xyXG5cdFx0XHRcdGlmIChpcCA9PSBUUkFDSy5wYXJ0aWNpcGFudHMubGVuZ3RoLTEpXHJcblx0XHRcdFx0XHRkZWxldGUgIFRSQUNLLnBhcnRpY2lwYW50c1thcnJbaXBdXS5fX25leHQ7XHJcblx0XHRcdFx0ZWxzZVxyXG5cdFx0XHRcdFx0VFJBQ0sucGFydGljaXBhbnRzW2FycltpcF1dLl9fbmV4dD1UUkFDSy5wYXJ0aWNpcGFudHNbYXJyW2lwKzFdXTtcclxuXHRcdFx0fVxyXG5cdFx0XHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRcdFx0aWYgKHRoaXMuc2VsZWN0ZWRQYXJ0aWNpcGFudDEpIFxyXG5cdFx0XHR7XHJcblx0XHRcdFx0dmFyIHNwb3MgPSB0aGlzLnNlbGVjdGVkUGFydGljaXBhbnQxLmdldEZlYXR1cmUoKS5nZXRHZW9tZXRyeSgpLmdldENvb3JkaW5hdGVzKCk7XHJcblx0XHRcdFx0aWYgKCF0aGlzLnBvcHVwMS5pc19zaG93bikge1xyXG5cdFx0XHRcdCAgICB0aGlzLnBvcHVwMS5zaG93KHNwb3MsIHRoaXMucG9wdXAxLmxhc3RIVE1MPXRoaXMuc2VsZWN0ZWRQYXJ0aWNpcGFudDEuZ2V0UG9wdXBIVE1MKCkpO1xyXG5cdFx0XHRcdCAgICB0aGlzLnBvcHVwMS5pc19zaG93bj0xO1xyXG5cdFx0XHRcdH0gZWxzZSB7XHJcblx0XHRcdFx0XHRpZiAoIXRoaXMucG9wdXAxLmdldFBvc2l0aW9uKCkgfHwgdGhpcy5wb3B1cDEuZ2V0UG9zaXRpb24oKVswXSAhPSBzcG9zWzBdIHx8IHRoaXMucG9wdXAxLmdldFBvc2l0aW9uKClbMV0gIT0gc3Bvc1sxXSlcclxuXHRcdFx0XHRcdCAgICB0aGlzLnBvcHVwMS5zZXRQb3NpdGlvbihzcG9zKTtcclxuXHRcdFx0XHRcdHZhciBjdGltZSA9IChuZXcgRGF0ZSgpKS5nZXRUaW1lKCk7XHRcdFx0IFxyXG5cdFx0XHRcdFx0aWYgKCF0aGlzLmxhc3RQb3B1cFJlZmVyZXNoMSB8fCBjdGltZSAtIHRoaXMubGFzdFBvcHVwUmVmZXJlc2gxID4gMjAwMCkgXHJcblx0XHRcdFx0XHR7XHJcblx0XHRcdFx0XHRcdHRoaXMubGFzdFBvcHVwUmVmZXJlc2gxPWN0aW1lO1xyXG5cdFx0XHRcdFx0ICAgIHZhciByciA9IHRoaXMuc2VsZWN0ZWRQYXJ0aWNpcGFudDEuZ2V0UG9wdXBIVE1MKCk7XHJcblx0XHRcdFx0XHQgICAgaWYgKHJyICE9IHRoaXMucG9wdXAxLmxhc3RIVE1MKSB7XHJcblx0XHRcdFx0XHQgICAgXHR0aGlzLnBvcHVwMS5sYXN0SFRNTD1ycjtcclxuXHRcdFx0XHRcdFx0ICAgIHRoaXMucG9wdXAxLmNvbnRlbnQuaW5uZXJIVE1MPXJyOyBcclxuXHRcdFx0XHRcdCAgICB9XHRcdFx0XHRcdFxyXG5cdFx0XHRcdFx0fVxyXG5cdFx0XHRcdCAgICB0aGlzLnBvcHVwMS5wYW5JbnRvVmlld18oc3Bvcyk7XHJcblx0XHRcdFx0fVxyXG5cdFx0XHR9XHJcblx0XHRcdGlmICh0aGlzLnNlbGVjdGVkUGFydGljaXBhbnQyKSBcclxuXHRcdFx0e1xyXG5cdFx0XHRcdHZhciBzcG9zID0gdGhpcy5zZWxlY3RlZFBhcnRpY2lwYW50Mi5nZXRGZWF0dXJlKCkuZ2V0R2VvbWV0cnkoKS5nZXRDb29yZGluYXRlcygpO1xyXG5cdFx0XHRcdGlmICghdGhpcy5wb3B1cDIuaXNfc2hvd24pIHtcclxuXHRcdFx0XHQgICAgdGhpcy5wb3B1cDIuc2hvdyhzcG9zLCB0aGlzLnBvcHVwMi5sYXN0SFRNTD10aGlzLnNlbGVjdGVkUGFydGljaXBhbnQyLmdldFBvcHVwSFRNTCgpKTtcclxuXHRcdFx0XHQgICAgdGhpcy5wb3B1cDIuaXNfc2hvd249MTtcclxuXHRcdFx0XHR9IGVsc2Uge1xyXG5cdFx0XHRcdFx0aWYgKCF0aGlzLnBvcHVwMi5nZXRQb3NpdGlvbigpIHx8IHRoaXMucG9wdXAyLmdldFBvc2l0aW9uKClbMF0gIT0gc3Bvc1swXSB8fCB0aGlzLnBvcHVwMi5nZXRQb3NpdGlvbigpWzFdICE9IHNwb3NbMV0pXHJcblx0XHRcdFx0XHQgICAgdGhpcy5wb3B1cDIuc2V0UG9zaXRpb24oc3Bvcyk7XHJcblx0XHRcdFx0XHR2YXIgY3RpbWUgPSAobmV3IERhdGUoKSkuZ2V0VGltZSgpO1x0XHRcdCBcclxuXHRcdFx0XHRcdGlmICghdGhpcy5sYXN0UG9wdXBSZWZlcmVzaDIgfHwgY3RpbWUgLSB0aGlzLmxhc3RQb3B1cFJlZmVyZXNoMiA+IDIwMDApIFxyXG5cdFx0XHRcdFx0e1xyXG5cdFx0XHRcdFx0XHR0aGlzLmxhc3RQb3B1cFJlZmVyZXNoMj1jdGltZTtcclxuXHRcdFx0XHRcdCAgICB2YXIgcnIgPSB0aGlzLnNlbGVjdGVkUGFydGljaXBhbnQyLmdldFBvcHVwSFRNTCgpO1xyXG5cdFx0XHRcdFx0ICAgIGlmIChyciAhPSB0aGlzLnBvcHVwMi5sYXN0SFRNTCkge1xyXG5cdFx0XHRcdFx0ICAgIFx0dGhpcy5wb3B1cDIubGFzdEhUTUw9cnI7XHJcblx0XHRcdFx0XHRcdCAgICB0aGlzLnBvcHVwMi5jb250ZW50LmlubmVySFRNTD1ycjsgXHJcblx0XHRcdFx0XHQgICAgfVx0XHRcdFx0XHRcclxuXHRcdFx0XHRcdH1cclxuXHRcdFx0XHQgICAgdGhpcy5wb3B1cDIucGFuSW50b1ZpZXdfKHNwb3MpO1xyXG5cdFx0XHRcdH1cclxuXHRcdFx0fVxyXG5cdFx0XHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tXHRcdFx0XHJcblx0XHRcdGlmICh0aGlzLmlzRGVidWcpICBcclxuXHRcdFx0XHR0aGlzLmRvRGVidWdBbmltYXRpb24oKTtcclxuXHRcdH0sXHJcblx0XHRcclxuXHRcdHNldFNlbGVjdGVkUGFydGljaXBhbnQxIDogZnVuY3Rpb24ocGFydCxjZW50ZXIpIFxyXG5cdFx0e1xyXG5cdFx0XHRpZiAoIShwYXJ0IGluc3RhbmNlb2YgUGFydGljaXBhbnQpKSB7XHJcblx0XHRcdFx0dmFyIHBwPXBhcnQ7XHJcblx0XHRcdFx0cGFydD1udWxsO1xyXG5cdFx0XHRcdGZvciAodmFyIGk9MDtpPFRSQUNLLnBhcnRpY2lwYW50cy5sZW5ndGg7aSsrKVxyXG5cdFx0XHRcdFx0aWYgKFRSQUNLLnBhcnRpY2lwYW50c1tpXS5kZXZpY2VJZCA9PSBwcCkge1xyXG5cdFx0XHRcdFx0XHRwYXJ0PVRSQUNLLnBhcnRpY2lwYW50c1tpXTtcclxuXHRcdFx0XHRcdFx0YnJlYWs7XHJcblx0XHRcdFx0XHR9XHJcblx0XHRcdH1cclxuXHRcdFx0dGhpcy5zZWxlY3RlZFBhcnRpY2lwYW50MT1wYXJ0O1xyXG5cdFx0XHRpZiAoIXBhcnQpIHtcclxuXHRcdFx0XHR0aGlzLnBvcHVwMS5oaWRlKCk7XHJcblx0XHRcdFx0ZGVsZXRlIHRoaXMucG9wdXAxLmlzX3Nob3duO1xyXG5cdFx0XHR9IGVsc2Uge1xyXG5cdFx0XHRcdHRoaXMubGFzdFBvcHVwUmVmZXJlc2gxPTA7XHJcblx0XHRcdFx0aWYgKGNlbnRlciAmJiBHVUkubWFwICYmIHBhcnQuZmVhdHVyZSkge1xyXG5cdFx0XHRcdFx0dmFyIHggPSAocGFydC5mZWF0dXJlLmdldEdlb21ldHJ5KCkuZ2V0RXh0ZW50KClbMF0rcGFydC5mZWF0dXJlLmdldEdlb21ldHJ5KCkuZ2V0RXh0ZW50KClbMl0pLzI7XHJcblx0XHRcdFx0XHR2YXIgeSA9IChwYXJ0LmZlYXR1cmUuZ2V0R2VvbWV0cnkoKS5nZXRFeHRlbnQoKVsxXStwYXJ0LmZlYXR1cmUuZ2V0R2VvbWV0cnkoKS5nZXRFeHRlbnQoKVszXSkvMjtcclxuXHRcdFx0XHRcdEdVSS5tYXAuZ2V0VmlldygpLnNldENlbnRlcihbeCx5XSk7XHJcblx0XHRcdFx0fVxyXG5cdFx0XHR9IFxyXG5cdFx0fSxcclxuXHJcblx0XHRzZXRTZWxlY3RlZFBhcnRpY2lwYW50MiA6IGZ1bmN0aW9uKHBhcnQsY2VudGVyKSBcclxuXHRcdHtcclxuXHRcdFx0aWYgKCEocGFydCBpbnN0YW5jZW9mIFBhcnRpY2lwYW50KSkge1xyXG5cdFx0XHRcdHZhciBwcD1wYXJ0O1xyXG5cdFx0XHRcdHBhcnQ9bnVsbDtcclxuXHRcdFx0XHRmb3IgKHZhciBpPTA7aTxUUkFDSy5wYXJ0aWNpcGFudHMubGVuZ3RoO2krKylcclxuXHRcdFx0XHRcdGlmIChUUkFDSy5wYXJ0aWNpcGFudHNbaV0uZGV2aWNlSWQgPT0gcHApIHtcclxuXHRcdFx0XHRcdFx0cGFydD1UUkFDSy5wYXJ0aWNpcGFudHNbaV07XHJcblx0XHRcdFx0XHRcdGJyZWFrO1xyXG5cdFx0XHRcdFx0fVxyXG5cdFx0XHR9XHJcblx0XHRcdHRoaXMuc2VsZWN0ZWRQYXJ0aWNpcGFudDI9cGFydDtcclxuXHRcdFx0aWYgKCFwYXJ0KSB7XHJcblx0XHRcdFx0dGhpcy5wb3B1cDIuaGlkZSgpO1xyXG5cdFx0XHRcdGRlbGV0ZSB0aGlzLnBvcHVwMi5pc19zaG93bjtcclxuXHRcdFx0fSBlbHNlIHtcclxuXHRcdFx0XHR0aGlzLmxhc3RQb3B1cFJlZmVyZXNoMj0wO1xyXG5cdFx0XHRcdGlmIChjZW50ZXIgJiYgR1VJLm1hcCAmJiBwYXJ0LmZlYXR1cmUpIHtcclxuXHRcdFx0XHRcdHZhciB4ID0gKHBhcnQuZmVhdHVyZS5nZXRHZW9tZXRyeSgpLmdldEV4dGVudCgpWzBdK3BhcnQuZmVhdHVyZS5nZXRHZW9tZXRyeSgpLmdldEV4dGVudCgpWzJdKS8yO1xyXG5cdFx0XHRcdFx0dmFyIHkgPSAocGFydC5mZWF0dXJlLmdldEdlb21ldHJ5KCkuZ2V0RXh0ZW50KClbMV0rcGFydC5mZWF0dXJlLmdldEdlb21ldHJ5KCkuZ2V0RXh0ZW50KClbM10pLzI7XHJcblx0XHRcdFx0XHRHVUkubWFwLmdldFZpZXcoKS5zZXRDZW50ZXIoW3gseV0pO1xyXG5cdFx0XHRcdH1cclxuXHRcdFx0fSBcclxuXHRcdH0sXHJcblxyXG5cdFx0ZG9EZWJ1Z0FuaW1hdGlvbiA6IGZ1bmN0aW9uKCkgXHJcblx0XHR7XHJcblx0XHRcdHZhciBjdGltZSA9IChuZXcgRGF0ZSgpKS5nZXRUaW1lKCk7XHJcblx0XHRcdHZhciB0b2RlbD1bXTtcclxuXHRcdFx0dmFyIHJyID0gdGhpcy5kZWJ1Z0xheWVyR1BTLmdldFNvdXJjZSgpLmdldEZlYXR1cmVzKCk7XHJcblx0XHRcdGZvciAodmFyIGk9MDtpPHJyLmxlbmd0aDtpKyspXHJcblx0XHRcdHtcclxuXHRcdFx0XHR2YXIgZiA9IHJyW2ldO1xyXG5cdFx0XHRcdGlmIChjdGltZSAtIGYudGltZUNyZWF0ZWQgLSBDT05GSUcubWF0aC5kaXNwbGF5RGVsYXkqMTAwMCA+IENPTkZJRy50aW1lb3V0cy5ncHNMb2NhdGlvbkRlYnVnU2hvdyoxMDAwKVxyXG5cdFx0XHRcdFx0dG9kZWwucHVzaChmKTtcclxuXHRcdFx0XHRlbHNlXHJcblx0XHRcdFx0XHRmLmNoYW5nZWQoKTtcclxuXHRcdFx0fVxyXG5cdFx0XHRpZiAodG9kZWwubGVuZ3RoKSBcclxuXHRcdFx0e1xyXG5cdFx0XHRcdGZvciAodmFyIGk9MDtpPHRvZGVsLmxlbmd0aDtpKyspXHJcblx0XHRcdFx0XHR0aGlzLmRlYnVnTGF5ZXJHUFMuZ2V0U291cmNlKCkucmVtb3ZlRmVhdHVyZSh0b2RlbFtpXSk7XHJcblx0XHRcdH1cclxuXHRcdFx0Ly8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0XHR9LFxyXG5cdFx0XHJcblx0XHRyZWRyYXcgOiBmdW5jdGlvbigpIHtcclxuXHRcdFx0dGhpcy5nZXRUcmFjaygpLmdldEZlYXR1cmUoKS5jaGFuZ2VkKCk7XHJcblx0XHR9LFxyXG5cclxuICAgICAgICAvKipcclxuICAgICAgICAgKiBTaG93IHRoZSBsaXZlLXN0cmVhbWluZyBjb250YWluZXIuIElmIHRoZSBwYXNzZWQgJ3N0cmVhbUlkJyBpcyB2YWxpZCB0aGVuIGl0IG9wZW5zIGl0cyBzdHJlYW0gZGlyZWN0bHkuXHJcbiAgICAgICAgICogQHBhcmFtIHtTdHJpbmd9IFtzdHJlYW1JZF1cclxuICAgICAgICAgKiBAcGFyYW0ge0Z1bmN0aW9ufSBbY29tcGxldGVDYWxsYmFja11cclxuICAgICAgICAgKi9cclxuICAgICAgICBzaG93TGl2ZVN0cmVhbSA6IGZ1bmN0aW9uKHN0cmVhbUlkLCBjb21wbGV0ZUNhbGxiYWNrKSB7XHJcbiAgICAgICAgICAgIHRoaXMubGl2ZVN0cmVhbS5zaG93KHN0cmVhbUlkLCBjb21wbGV0ZUNhbGxiYWNrKTtcclxuICAgICAgICB9LFxyXG5cclxuICAgICAgICAvKipcclxuICAgICAgICAgKiBUb2dnbGUgdGhlIGxpdmUtc3RyZWFtaW5nIGNvbnRhaW5lciBjb250YWluZXJcclxuXHRcdCAqIEBwYXJhbSB7RnVuY3Rpb259IFtjb21wbGV0ZUNhbGxiYWNrXVxyXG4gICAgICAgICAqL1xyXG4gICAgICAgIHRvZ2dsZUxpdmVTdHJlYW06IGZ1bmN0aW9uKGNvbXBsZXRlQ2FsbGJhY2spIHtcclxuICAgICAgICAgICAgcmV0dXJuIHRoaXMubGl2ZVN0cmVhbS50b2dnbGUoY29tcGxldGVDYWxsYmFjayk7XHJcbiAgICAgICAgfVxyXG5cdFx0XHJcbiAgICB9XHJcbn0pOyIsInJlcXVpcmUoJ2pvb3NlJyk7XHJcbnJlcXVpcmUoJy4vVXRpbHMnKTtcclxuXHJcbkNsYXNzKFwiTGl2ZVN0cmVhbVwiLCB7XHJcbiAgICBoYXMgOiB7XHJcbiAgICAgICAgXyRjb21wIDoge1xyXG4gICAgICAgICAgICBpbml0OiBmdW5jdGlvbihjb25maWcpIHtcclxuICAgICAgICAgICAgICAgIHJldHVybiAkKCcjJyArIGNvbmZpZy5pZCk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9LFxyXG5cclxuICAgICAgICBfaXNTaG93biA6IHtcclxuICAgICAgICAgICBpbml0IDogZmFsc2VcclxuICAgICAgICB9LFxyXG5cclxuICAgICAgICBfaXNWYWxpZCA6IHtcclxuICAgICAgICAgICAgaW5pdCA6IGZhbHNlXHJcbiAgICAgICAgfVxyXG4gICAgfSxcclxuICAgIG1ldGhvZHM6IHtcclxuICAgICAgICBpbml0aWFsaXplOiBmdW5jdGlvbigpIHtcclxuICAgICAgICAgICAgdmFyIGxpdmVTdHJlYW1zID0gd2luZG93LkxJVkVfU1RSRUFNUztcclxuICAgICAgICAgICAgaWYgKCFsaXZlU3RyZWFtcyB8fCBsaXZlU3RyZWFtcy5sZW5ndGggPD0gMCkge1xyXG4gICAgICAgICAgICAgICAgY29uc29sZS53YXJuKFwiTm8gbGl2ZSBzdHJlYW1zIHNldFwiKTtcclxuICAgICAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgLy8gaW5pdGlhbGl6ZSB0aGUgc3RyZWFtc1xyXG4gICAgICAgICAgICB2YXIgc2VsZiA9IHRoaXM7XHJcbiAgICAgICAgICAgIHZhciBpID0gMDtcclxuICAgICAgICAgICAgdGhpcy5fJGNvbXAuZmluZChcIi5saXZlU3RyZWFtVGh1bWJcIikuYWRkQ2xhc3MoXCJpbmFjdGl2ZVwiKS5lYWNoKGZ1bmN0aW9uKCkge1xyXG4gICAgICAgICAgICAgICAgdmFyIHN0cmVhbSA9IGxpdmVTdHJlYW1zW2ldO1xyXG4gICAgICAgICAgICAgICAgaSsrO1xyXG4gICAgICAgICAgICAgICAgaWYgKCFzdHJlYW0pIHtcclxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gZmFsc2U7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAkKHRoaXMpLmFkZENsYXNzKFwidmFsaWRcIikuZGF0YShcImlkXCIsIHN0cmVhbS5pZCkuZGF0YShcInVybFwiLCBzdHJlYW0udXJsKTtcclxuXHJcbiAgICAgICAgICAgICAgICAvLyBhdCBsZWFzdCBvbmUgdmFsaWQgdGh1bWIgLSBzbyB0aGUgd2hvbGUgTGl2ZVN0cmVhbSBpcyB2YWxpZFxyXG4gICAgICAgICAgICAgICAgc2VsZi5faXNWYWxpZCA9IHRydWU7XHJcbiAgICAgICAgICAgIH0pLmZpbHRlcihcIi52YWxpZFwiKS5jbGljayhmdW5jdGlvbigpIHtcclxuICAgICAgICAgICAgICAgIHZhciAkdGhpcyA9ICQodGhpcyk7XHJcblxyXG4gICAgICAgICAgICAgICAgLy8gaWYgY2xpY2tlZCBvbiB0aGUgc2FtZSBhY3RpdmUgdGh1bWIgdGhlbiBza2lwIGl0XHJcbiAgICAgICAgICAgICAgICBpZiAoISR0aGlzLmhhc0NsYXNzKFwiaW5hY3RpdmVcIikpIHtcclxuICAgICAgICAgICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICAgICBzZWxmLl9zaG93U3RyZWFtKCR0aGlzKTtcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgfSxcclxuXHJcbiAgICAgICAgc2hvdzogZnVuY3Rpb24oc3RyZWFtSWQsIGNvbXBsZXRlQ2FsbGJhY2spIHtcclxuICAgICAgICAgICAgaWYgKCF0aGlzLl9pc1ZhbGlkKVxyXG4gICAgICAgICAgICAgICByZXR1cm47XHJcblxyXG4gICAgICAgICAgICB2YXIgJHRodW1iID0gbnVsbDtcclxuICAgICAgICAgICAgdmFyICR0aHVtYnMgPSB0aGlzLl8kY29tcC5maW5kKFwiLmxpdmVTdHJlYW1UaHVtYi52YWxpZFwiKTtcclxuICAgICAgICAgICAgaWYgKCFpc0RlZmluZWQoc3RyZWFtSWQpKSB7XHJcbiAgICAgICAgICAgICAgICAkdGh1bWIgPSAkdGh1bWJzLmVxKDApO1xyXG4gICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgJHRodW1icy5lYWNoKGZ1bmN0aW9uKCkge1xyXG4gICAgICAgICAgICAgICAgICAgIGlmIChzdHJlYW1JZCA9PT0gJCh0aGlzKS5kYXRhKFwiaWRcIikpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgJHRodW1iID0gJCh0aGlzKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICBpZiAoISR0aHVtYikge1xyXG4gICAgICAgICAgICAgICAgY29uc29sZS53YXJuKFwiTm8gc3RyZWFtIGZvciBpZCA6IFwiICsgc3RyZWFtSWQpO1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICB0aGlzLl9zaG93U3RyZWFtKCR0aHVtYiwgY29tcGxldGVDYWxsYmFjayk7XHJcbiAgICAgICAgfSxcclxuXHJcbiAgICAgICAgLyoqXHJcbiAgICAgICAgICpcclxuICAgICAgICAgKiBAcmV0dXJuIHtib29sZWFufVxyXG4gICAgICAgICAqL1xyXG4gICAgICAgIHRvZ2dsZSA6IGZ1bmN0aW9uKGNvbXBsZXRlQ2FsbGJhY2spIHtcclxuICAgICAgICAgICAgaWYgKCF0aGlzLl9pc1ZhbGlkKVxyXG4gICAgICAgICAgICAgICAgcmV0dXJuO1xyXG5cclxuICAgICAgICAgICAgLy8gaWYgc2hvd24gaGlkZSBvdGhlcndpc2Ugc2hvd1xyXG4gICAgICAgICAgICBpZiAodGhpcy5faXNTaG93bilcclxuICAgICAgICAgICAgICAgIHRoaXMuX2hpZGUoY29tcGxldGVDYWxsYmFjayk7XHJcbiAgICAgICAgICAgIGVsc2VcclxuICAgICAgICAgICAgICAgIHRoaXMuc2hvdyhjb21wbGV0ZUNhbGxiYWNrKTtcclxuXHJcbiAgICAgICAgICAgIHJldHVybiB0aGlzLl9pc1Nob3duO1xyXG4gICAgICAgIH0sXHJcblxyXG4gICAgICAgIC8qIFByaXZhdGUgTWV0aG9kcyAqL1xyXG5cclxuICAgICAgICBfaGlkZSA6IGZ1bmN0aW9uKGNvbXBsZXRlQ2FsbGJhY2spIHtcclxuICAgICAgICAgICAgdmFyIHNlbGYgPSB0aGlzO1xyXG4gICAgICAgICAgICB0aGlzLl8kY29tcC5zbGlkZVVwKDQwMCwgZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgICAgICAgICAvLyBzdG9wIHRoZSBzdHJlYW0gd2hlbiB3aG9sZSBwYW5lbCBoYXMgY29tcGxldGVkIGFuaW1hdGlvblxyXG4gICAgICAgICAgICAgICAgc2VsZi5fJGNvbXAuZmluZChcIi5saXZlU3RyZWFtUGxheWVyXCIpLmVtcHR5KCk7XHJcbiAgICAgICAgICAgICAgICBjb21wbGV0ZUNhbGxiYWNrKCk7XHJcbiAgICAgICAgICAgIH0pO1xyXG5cclxuICAgICAgICAgICAgdGhpcy5faXNTaG93biA9IGZhbHNlO1xyXG4gICAgICAgIH0sXHJcblxyXG4gICAgICAgIF9zaG93U3RyZWFtIDogZnVuY3Rpb24oJHRodW1iLCBjb21wbGV0ZUNhbGxiYWNrKSB7XHJcbiAgICAgICAgICAgIC8vIHRvZ2dsZSB0aGUgXCJpbmFjdGl2ZVwiIGNsYXNzXHJcbiAgICAgICAgICAgIHRoaXMuXyRjb21wLmZpbmQoXCIubGl2ZVN0cmVhbVRodW1iXCIpLmFkZENsYXNzKFwiaW5hY3RpdmVcIik7XHJcbiAgICAgICAgICAgICR0aHVtYi5yZW1vdmVDbGFzcyhcImluYWN0aXZlXCIpO1xyXG5cclxuICAgICAgICAgICAgLy8gc2hvdyB0aGUgbmV3IHN0cmVhbVxyXG4gICAgICAgICAgICB2YXIgdXJsID0gJHRodW1iLmRhdGEoXCJ1cmxcIik7XHJcbiAgICAgICAgICAgIHZhciAkcGxheWVyID0gdGhpcy5fJGNvbXAuZmluZChcIi5saXZlU3RyZWFtUGxheWVyXCIpO1xyXG4gICAgICAgICAgICAkcGxheWVyLmh0bWwoJzxpZnJhbWUgc3JjPScgKyB1cmwgKyAnP3dpZHRoPTQ5MCZoZWlnaHQ9Mjc1JmF1dG9QbGF5PXRydWUmbXV0ZT1mYWxzZVwiIHdpZHRoPVwiNDkwXCIgaGVpZ2h0PVwiMjc1XCIgZnJhbWVib3JkZXI9XCIwXCIgc2Nyb2xsaW5nPVwibm9cIiAnK1xyXG4gICAgICAgICAgICAnYWxsb3dmdWxsc2NyZWVuIHdlYmtpdGFsbG93ZnVsbHNjcmVlbiBtb3phbGxvd2Z1bGxzY3JlZW4gb2FsbG93ZnVsbHNjcmVlbiBtc2FsbG93ZnVsbHNjcmVlbj48L2lmcmFtZT4nKTtcclxuXHJcbiAgICAgICAgICAgIC8vIHNob3cgaWYgbm90IGFscmVhZHkgc2hvd25cclxuICAgICAgICAgICAgaWYgKCF0aGlzLl9pc1Nob3duKVxyXG4gICAgICAgICAgICAgICAgdGhpcy5fJGNvbXAuc2xpZGVEb3duKDQwMCwgY29tcGxldGVDYWxsYmFjayk7XHJcbiAgICAgICAgICAgIHRoaXMuX2lzU2hvd24gPSB0cnVlO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxufSk7IiwicmVxdWlyZSgnam9vc2UnKTtcclxucmVxdWlyZSgnLi9Qb2ludCcpO1xyXG5cclxudmFyIENPTkZJRyA9IHJlcXVpcmUoJy4vQ29uZmlnJyk7XHJcbnZhciBVdGlscyA9IHJlcXVpcmUoJy4vVXRpbHMnKTtcclxuXHJcbkNsYXNzKFwiUGFydGljaXBhbnRTdGF0ZVwiLFxyXG57XHJcblx0aGFzIDoge1x0XHRcclxuXHRcdHNwZWVkIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IDBcclxuXHRcdH0sXHJcblx0XHRlbGFwc2VkIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IDBcclxuXHRcdH0sXHJcblx0ICAgIHRpbWVzdGFtcCA6IFxyXG5cdFx0e1xyXG5cdCAgICAgICAgaXM6ICAgXCJyd1wiLFxyXG5cdCAgICAgICAgaW5pdDogWzAsMF1cdC8vbG9uIGxhdCB3b3JsZCBtZXJjYXRvclxyXG5cdCAgICB9LFxyXG5cdCAgICBncHMgOiB7XHJcblx0ICAgIFx0aXM6ICAgXCJyd1wiLFxyXG5cdCAgICAgICAgaW5pdDogWzAsMF1cdC8vbG9uIGxhdCB3b3JsZCBtZXJjYXRvclxyXG5cdCAgICB9LFxyXG5cdFx0ZnJlcSA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiAwXHJcblx0XHR9LFxyXG5cdFx0aXNTT1MgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogZmFsc2VcclxuXHRcdH0sXHJcblx0XHRhY2NlbGVyYXRpb24gOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogMFxyXG5cdFx0fSxcclxuXHRcdGFsdCA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiAwXHJcblx0XHR9LFxyXG5cdFx0b3ZlcmFsbFJhbmsgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogMFxyXG5cdFx0fSxcclxuXHRcdGdlbmRlclJhbmsgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogMFxyXG5cdFx0fSxcclxuXHRcdGdyb3VwUmFuayA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiAwXHJcblx0XHR9XHJcblx0fVxyXG59KTtcdFx0XHJcbi8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5DbGFzcyhcIk1vdmluZ1BvaW50XCIsIHtcclxuXHRpc2EgOiBQb2ludCxcclxuXHJcblx0aGFzIDoge1xyXG5cdFx0ZGV2aWNlSWQgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogXCJERVZJQ0VfSURfTk9UX1NFVFwiXHJcblx0XHR9XHJcblx0fVxyXG59KTtcclxuLy8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcbkNsYXNzKFwiUGFydGljaXBhbnRcIixcclxue1xyXG5cdGlzYSA6IE1vdmluZ1BvaW50LFxyXG5cclxuICAgIGhhczogXHJcblx0e1xyXG4gICAgXHRsYXN0UGluZ1RpbWVzdGFtcCA6IHtcclxuICAgIFx0XHRpcyA6IFwicndcIixcclxuICAgIFx0XHRpbml0IDogbnVsbFxyXG4gICAgXHR9LFxyXG4gICAgXHRzaWduYWxMb3N0RGVsYXkgOiB7XHJcbiAgICBcdFx0aXMgOiBcInJ3XCIsXHJcbiAgICBcdFx0aW5pdCA6IG51bGxcclxuICAgIFx0fSxcclxuICAgIFx0bGFzdFJlYWxEZWxheSA6IHtcclxuICAgIFx0XHRpcyA6IFwicndcIixcclxuICAgIFx0XHRpbml0IDogMFxyXG4gICAgXHR9LFxyXG4gICAgXHR0cmFjayA6IHtcclxuICAgIFx0XHRpcyA6IFwicndcIlxyXG4gICAgXHR9LFxyXG4gICAgXHRzdGF0ZXMgOiB7XHJcbiAgICBcdFx0aXMgOiBcInJ3XCIsXHJcbiAgICBcdFx0aW5pdCA6IG51bGwgLy9bXVxyXG4gICAgXHRcdFxyXG4gICAgXHR9LFxyXG5cdFx0aXNUaW1lZE91dCA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiBmYWxzZVxyXG5cdFx0fSxcclxuXHRcdGlzRGlzY2FyZGVkIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IGZhbHNlXHJcblx0XHR9LFxyXG5cdFx0aXNTT1MgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogZmFsc2VcclxuXHRcdH0sXHJcblx0XHRpY29uOiB7XHJcblx0XHRcdGlzOiBcInJ3XCIsXHJcblx0ICAgICAgICBpbml0OiBcImltZy9wbGF5ZXIxLnBuZ1wiXHJcblx0ICAgIH0sXHJcblx0ICAgIGltYWdlIDpcdHtcclxuXHQgICAgICAgIGlzOiAgIFwicndcIixcclxuXHQgICAgICAgIGluaXQ6IFwiaW1nL3Byb2ZpbGUxLnBuZ1wiICAvLzEwMHgxMDBcclxuXHQgICAgfSxcclxuXHQgICAgY29sb3IgOiB7XHJcblx0ICAgICAgICBpczogICBcInJ3XCIsXHJcblx0ICAgICAgICBpbml0OiBcIiNmZmZcIlxyXG5cdCAgICB9LFxyXG5cdCAgICBsYXN0SW50ZXJwb2xhdGVUaW1lc3RhbXAgOiB7XHJcblx0ICAgIFx0aXMgOiBcInJ3XCIsXHJcblx0ICAgIFx0aW5pdCA6IG51bGxcclxuXHQgICAgfSxcclxuXHQgICAgYWdlR3JvdXAgOiB7XHJcblx0ICAgIFx0aXMgOiBcInJ3XCIsXHJcblx0ICAgIFx0aW5pdCA6IFwiLVwiXHJcblx0ICAgIH0sXHJcblx0ICAgIGFnZSA6IHtcclxuXHQgICAgXHRpcyA6IFwicndcIixcclxuXHQgICAgXHRpbml0IDogXCItXCJcclxuXHQgICAgfSxcclxuXHQgICAgcm90YXRpb24gOiB7XHJcblx0ICAgIFx0aXMgOiBcInJ3XCIsXHJcblx0ICAgIFx0aW5pdCA6IG51bGwgXHJcblx0ICAgIH0sIFxyXG5cdCAgICBlbGFwc2VkIDoge1xyXG5cdCAgICBcdGlzIDogXCJyd1wiLFxyXG5cdCAgICBcdGluaXQgOiAwXHJcblx0ICAgIH0sXHJcblx0XHRzZXFJZCA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiAwXHJcblx0XHR9LFxyXG5cdFx0Y291bnRyeSA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiBcIkdlcm1hbnlcIlxyXG5cdFx0fSxcclxuXHRcdHN0YXJ0UG9zIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IDBcclxuXHRcdH0sXHJcblx0XHRzdGFydFRpbWUgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogMFxyXG5cdFx0fSxcclxuXHRcdGdlbmRlciA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiBcIk1cIlxyXG5cdFx0fSxcclxuXHRcdGlzRmF2b3JpdGUgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogdHJ1ZSAvKiB0b2RvIHNldCBmYWxzZSAqL1xyXG5cdFx0fVxyXG4gICAgfSxcclxuXHRhZnRlciA6IHtcclxuXHRcdGluaXQgOiBmdW5jdGlvbihwb3MsIHRyYWNrKSB7XHJcblx0XHRcdHRoaXMuc2V0VHJhY2sodHJhY2spO1xyXG5cdFx0XHR2YXIgY3RpbWUgPSAobmV3IERhdGUoKSkuZ2V0VGltZSgpO1xyXG5cdFx0XHR2YXIgc3RhdGUgPSBuZXcgUGFydGljaXBhbnRTdGF0ZSh7dGltZXN0YW1wOjEvKiBwbGFjZWhvbGRlciBjdGltZSBub3QgMCAqLyxncHM6cG9zLGlzU09TOmZhbHNlLGZyZXE6MCxzcGVlZDowLGVsYXBzZWQ6dHJhY2suZ2V0RWxhcHNlZEZyb21Qb2ludChwb3MpfSk7XHJcblx0XHRcdHRoaXMuc2V0RWxhcHNlZChzdGF0ZS5lbGFwc2VkKTtcclxuXHRcdFx0dGhpcy5zZXRTdGF0ZXMoW3N0YXRlXSk7XHJcblx0XHRcdHRoaXMuc2V0SXNTT1MoZmFsc2UpO1xyXG5cdFx0XHR0aGlzLnNldElzRGlzY2FyZGVkKGZhbHNlKTtcclxuXHJcblx0XHRcdGlmICh0aGlzLmZlYXR1cmUpIHtcclxuXHRcdFx0XHR0aGlzLmluaXRGZWF0dXJlKCk7XHJcblx0XHRcdH1cclxuXHRcdFx0dGhpcy5waW5nKHBvcywwLGZhbHNlLDEgLyogcGxhY2Vob2xkZXIgY3RpbWUgbm90IDAgKi8sMCwwLDAsMCwwKTtcclxuXHRcdH1cclxuXHR9LFxyXG4gICAgLy8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdG1ldGhvZHM6IFxyXG5cdHtcclxuXHRcdGluaXRGZWF0dXJlIDogZnVuY3Rpb24oKSB7XHJcblx0XHRcdHRoaXMuZmVhdHVyZS5wYXJ0aWNpcGFudD10aGlzO1xyXG5cdFx0XHRHVUkucGFydGljaXBhbnRzTGF5ZXIuZ2V0U291cmNlKCkuYWRkRmVhdHVyZSh0aGlzLmZlYXR1cmUpO1xyXG5cdFx0fSxcclxuXHJcblx0XHRnZXRJbml0aWFscyA6IGZ1bmN0aW9uKCkge1xyXG5cdFx0XHR2YXIgdHQgPSB0aGlzLmdldENvZGUoKS5zcGxpdChcIiBcIik7XHJcblx0XHRcdGlmICh0dC5sZW5ndGggPj0gMikge1xyXG5cdFx0XHRcdHJldHVybiB0dFswXVswXSt0dFsxXVswXTtcclxuXHRcdFx0fVxyXG5cdFx0XHRpZiAodHQubGVuZ3RoID09IDEpXHJcblx0XHRcdFx0cmV0dXJuIHR0WzBdWzBdO1xyXG5cdFx0XHRyZXR1cm4gXCI/XCI7XHJcblx0XHR9LFxyXG5cdFx0Ly8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0XHQvLyBtYWluIGZ1bmN0aW9uIGNhbGwgPiBcclxuXHRcdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdFx0dXBkYXRlRmVhdHVyZSA6IGZ1bmN0aW9uKCkge1xyXG5cdFx0XHR2YXIgbXBvcyA9IG9sLnByb2oudHJhbnNmb3JtKHRoaXMuZ2V0UG9zaXRpb24oKSwgJ0VQU0c6NDMyNicsICdFUFNHOjM4NTcnKTtcclxuXHRcdFx0aWYgKHRoaXMuZmVhdHVyZSkgXHJcblx0XHRcdFx0dGhpcy5mZWF0dXJlLnNldEdlb21ldHJ5KG5ldyBvbC5nZW9tLlBvaW50KG1wb3MpKTtcclxuXHRcdH0sXHJcblx0XHRpbnRlcnBvbGF0ZSA6IGZ1bmN0aW9uKCkgXHJcblx0XHR7XHJcblx0XHRcdFxyXG5cdFx0XHRpZiAoIXRoaXMuc3RhdGVzLmxlbmd0aClcclxuXHRcdFx0XHRyZXR1cm47XHJcblx0XHRcdHZhciBjdGltZT0obmV3IERhdGUoKSkuZ2V0VGltZSgpO1xyXG5cdFx0XHR2YXIgaXNUaW1lID0gKGN0aW1lID49IENPTkZJRy50aW1lcy5iZWdpbiAmJiBjdGltZSA8PSBDT05GSUcudGltZXMuZW5kKTtcclxuXHRcdFx0aWYgKHRoaXMuaXNEaXNjYXJkZWQgfHwgdGhpcy5pc1NPUy8qIHx8ICF0aGlzLmlzT25Sb2FkKi8gfHwgIWlzVGltZSB8fCBDT05GSUcuc2V0dGluZ3Mubm9JbnRlcnBvbGF0aW9uKSBcclxuXHRcdFx0e1xyXG5cdFx0XHRcdHZhciBsc3RhdGU9dGhpcy5zdGF0ZXNbdGhpcy5zdGF0ZXMubGVuZ3RoLTFdO1xyXG5cdFx0XHRcdHZhciBwb3MgPSBsc3RhdGUuZ3BzO1xyXG5cdFx0XHRcdGlmIChwb3NbMF0gIT0gdGhpcy5nZXRQb3NpdGlvbigpWzBdIHx8IHBvc1sxXSAhPSB0aGlzLmdldFBvc2l0aW9uKClbMV0pIFxyXG5cdFx0XHRcdHtcclxuXHRcdFx0XHQgICAgdGhpcy5zZXRQb3NpdGlvbihwb3MpO1xyXG5cdFx0XHRcdCAgICB0aGlzLnNldFJvdGF0aW9uKG51bGwpO1xyXG5cdFx0XHRcdFx0dGhpcy51cGRhdGVGZWF0dXJlKCk7XHJcblx0XHRcdFx0fSBlbHNlIHtcclxuXHRcdFx0XHRcdGlmICh0aGlzLmlzRGlzY2FyZGVkKSB7XHJcblx0XHRcdFx0XHRcdHRoaXMudXBkYXRlRmVhdHVyZSgpO1xyXG5cdFx0XHRcdFx0fVxyXG5cdFx0XHRcdH1cclxuXHRcdFx0XHRyZXR1cm47XHJcblx0XHRcdH1cclxuXHRcdFx0dGhpcy5zZXRMYXN0SW50ZXJwb2xhdGVUaW1lc3RhbXAoY3RpbWUpO1xyXG5cdFx0XHQvLyBObyBlbm91Z2ggZGF0YT9cclxuXHRcdFx0aWYgKHRoaXMuc3RhdGVzLmxlbmd0aCA8IDIpXHJcblx0XHRcdFx0cmV0dXJuO1xyXG5cdFx0XHR2YXIgcmVzID0gdGhpcy5jYWxjdWxhdGVFbGFwc2VkQXZlcmFnZShjdGltZSk7XHJcblx0XHRcdGlmIChyZXMpIFxyXG5cdFx0XHR7XHJcblx0XHRcdFx0dmFyIHRyZXM9cmVzO1xyXG5cdFx0XHRcdGlmICh0cmVzID09IHRoaXMudHJhY2subGFwcylcclxuXHRcdFx0XHRcdHRyZXM9MS4wO1xyXG5cdFx0XHRcdGVsc2VcclxuXHRcdFx0XHRcdHRyZXM9dHJlcyUxO1xyXG5cdFx0XHRcdHZhciB0a2EgPSB0aGlzLnRyYWNrLmdldFBvc2l0aW9uQW5kUm90YXRpb25Gcm9tRWxhcHNlZCh0cmVzKTtcclxuXHRcdFx0XHR0aGlzLnNldFBvc2l0aW9uKFt0a2FbMF0sdGthWzFdXSk7XHJcblx0XHRcdFx0dGhpcy5zZXRSb3RhdGlvbih0a2FbMl0pO1xyXG5cdFx0XHRcdHRoaXMudXBkYXRlRmVhdHVyZSgpO1xyXG5cdFx0XHRcdHRoaXMuc2V0RWxhcHNlZChyZXMpO1xyXG5cdFx0XHR9IFxyXG5cdFx0fSxcclxuXHJcblx0XHRtYXggOiBmdW5jdGlvbihjdGltZSxwcm9OYW1lKSBcclxuXHRcdHtcclxuXHRcdFx0dmFyIHJlcz0wO1xyXG5cdFx0XHRmb3IgKHZhciBpPXRoaXMuc3RhdGVzLmxlbmd0aC0yO2k+PTA7aS0tKSBcclxuXHRcdFx0e1xyXG5cdFx0XHRcdHZhciBqID0gaSsxO1xyXG5cdFx0XHRcdHZhciBzYSA9IHRoaXMuc3RhdGVzW2ldO1xyXG5cdFx0XHRcdHZhciBzYiA9IHRoaXMuc3RhdGVzW2pdO1xyXG5cdFx0XHRcdGlmIChjdGltZSA+PSBzYS50aW1lc3RhbXAgJiYgY3RpbWUgPD0gc2IudGltZXN0YW1wKSBcclxuXHRcdFx0XHR7IFxyXG5cdFx0XHRcdFx0cmVzID0gc2FbcHJvTmFtZV07XHJcblx0XHRcdFx0XHRicmVhaztcclxuXHRcdFx0XHR9XHJcblx0XHRcdFx0aWYgKHNiLnRpbWVzdGFtcCA8IGN0aW1lKVxyXG5cdFx0XHRcdFx0YnJlYWs7XHJcblx0XHRcdH1cclxuXHRcdFx0cmV0dXJuIHJlcztcclxuXHRcdH0sXHJcblxyXG5cdFx0YXZnMiA6IGZ1bmN0aW9uKGN0aW1lLHByb05hbWUpIFxyXG5cdFx0e1xyXG5cdFx0XHR2YXIgcmVzPW51bGw7XHJcblx0XHRcdGZvciAodmFyIGk9dGhpcy5zdGF0ZXMubGVuZ3RoLTI7aT49MDtpLS0pIFxyXG5cdFx0XHR7XHJcblx0XHRcdFx0dmFyIGogPSBpKzE7XHJcblx0XHRcdFx0dmFyIHNhID0gdGhpcy5zdGF0ZXNbaV07XHJcblx0XHRcdFx0dmFyIHNiID0gdGhpcy5zdGF0ZXNbal07XHJcblx0XHRcdFx0aWYgKGN0aW1lID49IHNhLnRpbWVzdGFtcCAmJiBjdGltZSA8PSBzYi50aW1lc3RhbXApIFxyXG5cdFx0XHRcdHsgXHJcblx0XHRcdFx0XHRyZXMgPSBbXHJcblx0XHRcdFx0XHQgICAgICAgXHRzYVtwcm9OYW1lXVswXSsoY3RpbWUtc2EudGltZXN0YW1wKSAqIChzYltwcm9OYW1lXVswXS1zYVtwcm9OYW1lXVswXSkgLyAoc2IudGltZXN0YW1wLXNhLnRpbWVzdGFtcCksXHJcblx0XHRcdFx0XHQgICAgICAgXHRzYVtwcm9OYW1lXVsxXSsoY3RpbWUtc2EudGltZXN0YW1wKSAqIChzYltwcm9OYW1lXVsxXS1zYVtwcm9OYW1lXVsxXSkgLyAoc2IudGltZXN0YW1wLXNhLnRpbWVzdGFtcClcclxuXHRcdFx0XHQgICAgICAgICAgXTsgXHJcblx0XHRcdFx0XHRicmVhaztcclxuXHRcdFx0XHR9XHJcblx0XHRcdFx0aWYgKHNiLnRpbWVzdGFtcCA8IGN0aW1lKVxyXG5cdFx0XHRcdFx0YnJlYWs7XHJcblx0XHRcdH1cclxuXHRcdFx0cmV0dXJuIHJlcztcclxuXHRcdH0sXHJcblxyXG5cdFx0YXZnIDogZnVuY3Rpb24oY3RpbWUscHJvTmFtZSkgXHJcblx0XHR7XHJcblx0XHRcdHZhciByZXM9bnVsbDtcclxuXHRcdFx0Ly9jb25zb2xlLmxvZyh0aGlzLnN0YXRlcyk7XHJcblx0XHRcdGZvciAodmFyIGk9dGhpcy5zdGF0ZXMubGVuZ3RoLTI7aT49MDtpLS0pIFxyXG5cdFx0XHR7XHJcblx0XHRcdFx0dmFyIGogPSBpKzE7XHJcblx0XHRcdFx0dmFyIHNhID0gdGhpcy5zdGF0ZXNbaV07XHJcblx0XHRcdFx0dmFyIHNiID0gdGhpcy5zdGF0ZXNbal07XHJcblx0XHRcdFx0aWYgKGN0aW1lID49IHNhLnRpbWVzdGFtcCAmJiBjdGltZSA8PSBzYi50aW1lc3RhbXApIFxyXG5cdFx0XHRcdHsgXHJcblx0XHRcdFx0XHRyZXMgPSBzYVtwcm9OYW1lXSsoY3RpbWUtc2EudGltZXN0YW1wKSAqIChzYltwcm9OYW1lXS1zYVtwcm9OYW1lXSkgLyAoc2IudGltZXN0YW1wLXNhLnRpbWVzdGFtcCk7XHJcblx0XHRcdFx0XHRicmVhaztcclxuXHRcdFx0XHR9XHJcblx0XHRcdFx0aWYgKHNiLnRpbWVzdGFtcCA8IGN0aW1lKVxyXG5cdFx0XHRcdFx0YnJlYWs7XHJcblx0XHRcdH1cclxuXHRcdFx0cmV0dXJuIHJlcztcclxuXHRcdH0sXHJcblxyXG5cdFx0Y2FsY3VsYXRlRWxhcHNlZEF2ZXJhZ2UgOiBmdW5jdGlvbihjdGltZSkgXHJcblx0XHR7XHJcblx0XHRcdHZhciByZXM9bnVsbDtcclxuXHRcdFx0Y3RpbWUtPUNPTkZJRy5tYXRoLmRpc3BsYXlEZWxheSoxMDAwO1xyXG5cdFx0XHQvL2NvbnNvbGUubG9nKFwiU0VBUkNISU5HIEZPUiBUSU1FIFwiK1V0aWxzLmZvcm1hdERhdGVUaW1lU2VjKG5ldyBEYXRlKGN0aW1lKSkpO1xyXG5cdFx0XHR2YXIgb2sgPSBmYWxzZTtcclxuXHRcdFx0Zm9yICh2YXIgaT10aGlzLnN0YXRlcy5sZW5ndGgtMjtpPj0wO2ktLSkgXHJcblx0XHRcdHtcclxuXHRcdFx0XHR2YXIgaiA9IGkrMTtcclxuXHRcdFx0XHR2YXIgc2EgPSB0aGlzLmNhbGNBVkdTdGF0ZShpKTtcclxuXHRcdFx0XHR2YXIgc2IgPSB0aGlzLmNhbGNBVkdTdGF0ZShqKTtcclxuXHRcdFx0XHRpZiAoY3RpbWUgPj0gc2EudGltZXN0YW1wICYmIGN0aW1lIDw9IHNiLnRpbWVzdGFtcCkgXHJcblx0XHRcdFx0eyBcclxuXHRcdFx0XHRcdHJlcyA9IHNhLmVsYXBzZWQrKGN0aW1lLXNhLnRpbWVzdGFtcCkgKiAoc2IuZWxhcHNlZC1zYS5lbGFwc2VkKSAvIChzYi50aW1lc3RhbXAtc2EudGltZXN0YW1wKTtcclxuXHRcdFx0XHRcdC8vY29uc29sZS5sb2coXCJGT1VORCBUSU1FIElOVCBbXCIrVXRpbHMuZm9ybWF0RGF0ZVRpbWVTZWMobmV3IERhdGUoc2EudGltZXN0YW1wKSkrXCIgPiBcIitVdGlscy5mb3JtYXREYXRlVGltZVNlYyhuZXcgRGF0ZShzYi50aW1lc3RhbXApKStcIl1cIik7XHJcblx0XHRcdFx0XHRvaz10cnVlO1xyXG5cdFx0XHRcdFx0YnJlYWs7XHJcblx0XHRcdFx0fVxyXG5cdFx0XHRcdGlmIChzYi50aW1lc3RhbXAgPCBjdGltZSkge1xyXG5cdFx0XHRcdFx0dGhpcy5zZXRTaWduYWxMb3N0RGVsYXkoY3RpbWUtc2IudGltZXN0YW1wKTtcclxuXHRcdFx0XHRcdC8vY29uc29sZS5sb2coXCJCUkVBSyBPTiBcIitmb3JtYXRUaW1lU2VjKG5ldyBEYXRlKGN0aW1lKSkrXCIgfCBcIisoY3RpbWUtc2IudGltZXN0YW1wKS8xMDAwLjApO1xyXG5cdFx0XHRcdFx0cmV0dXJuIG51bGw7XHJcblx0XHRcdFx0fVxyXG5cdFx0XHR9XHJcblx0XHRcdGlmICghb2spIHtcclxuXHRcdFx0XHRpZiAodGhpcy5zdGF0ZXMubGVuZ3RoID49IDIpXHJcblx0XHRcdFx0XHRjb25zb2xlLmxvZyh0aGlzLmNvZGUrXCIgfCBOT1QgRk9VTkQgVElNRSBcIitVdGlscy5mb3JtYXREYXRlVGltZVNlYyhuZXcgRGF0ZShjdGltZSkpK1wiIHwgdC1sYXN0PVwiKyhjdGltZS10aGlzLnN0YXRlc1t0aGlzLnN0YXRlcy5sZW5ndGgtMV0udGltZXN0YW1wKS8xMDAwLjArXCIgfCB0LWZpcnN0PVwiKyhjdGltZS10aGlzLnN0YXRlc1swXS50aW1lc3RhbXApLzEwMDAuMCk7XHJcblx0XHRcdH0gZWxzZVxyXG5cdFx0XHRcdHRoaXMuc2V0U2lnbmFsTG9zdERlbGF5KG51bGwpO1xyXG5cdFx0XHRyZXR1cm4gcmVzO1xyXG5cdFx0fSxcclxuXHRcdFxyXG5cdFx0Y2FsY0FWR1N0YXRlIDogZnVuY3Rpb24ocG9zKSB7XHJcblx0XHRcdGlmICghQ09ORklHLm1hdGguaW50ZXJwb2xhdGVHUFNBdmVyYWdlKVxyXG5cdFx0XHRcdHJldHVybiB0aGlzLnN0YXRlc1twb3NdO1xyXG5cdFx0XHR2YXIgc3N1bWU9MDtcclxuXHRcdFx0dmFyIHNzdW10PTA7XHJcblx0XHRcdHZhciBjYz0wO1xyXG5cdFx0XHRmb3IgKHZhciBpPXBvcztpPj0wICYmIChwb3MtaSk8Q09ORklHLm1hdGguaW50ZXJwb2xhdGVHUFNBdmVyYWdlO2ktLSkge1xyXG5cdFx0XHRcdHNzdW1lKz10aGlzLnN0YXRlc1tpXS5lbGFwc2VkO1xyXG5cdFx0XHRcdHNzdW10Kz10aGlzLnN0YXRlc1tpXS50aW1lc3RhbXA7XHJcblx0XHRcdFx0Y2MrKztcclxuXHRcdFx0fVxyXG5cdFx0XHRzc3VtZS89Y2M7XHJcblx0XHRcdHNzdW10Lz1jYztcclxuXHRcdFx0cmV0dXJuIHtlbGFwc2VkIDogc3N1bWUsdGltZXN0YW1wIDogc3N1bXR9O1xyXG5cdFx0fSxcclxuXHJcblx0XHRwaW5nQ2FsY3VsYXRlZCA6IGZ1bmN0aW9uKG9iaikge1xyXG5cdFx0XHR2YXIgc3RhdGUgPSBuZXcgUGFydGljaXBhbnRTdGF0ZShvYmopO1xyXG5cdFx0XHQvL2NvbnNvbGUud2FybihzdGF0ZSk7XHJcblx0XHRcdHRoaXMuYWRkU3RhdGUoc3RhdGUpO1xyXG5cdFx0fSxcclxuXHJcblx0XHRnZXRPdmVyYWxsUmFuayA6IGZ1bmN0aW9uKCkge1xyXG5cdFx0XHRpZiAodGhpcy5zdGF0ZXMubGVuZ3RoKSB7XHJcblx0XHRcdFx0cmV0dXJuIHRoaXMuc3RhdGVzW3RoaXMuc3RhdGVzLmxlbmd0aC0xXS5vdmVyYWxsUmFuaztcclxuXHRcdFx0fVxyXG5cdFx0XHRyZXR1cm4gXCItXCI7XHJcblx0XHR9LFxyXG5cdFx0Z2V0R3JvdXBSYW5rIDogZnVuY3Rpb24oKSB7XHJcblx0XHRcdGlmICh0aGlzLnN0YXRlcy5sZW5ndGgpIHtcclxuXHRcdFx0XHRyZXR1cm4gdGhpcy5zdGF0ZXNbdGhpcy5zdGF0ZXMubGVuZ3RoLTFdLmdyb3VwUmFuaztcclxuXHRcdFx0fVxyXG5cdFx0XHRyZXR1cm4gXCItXCI7XHJcblx0XHR9LFxyXG5cdFx0Z2V0R2VuZGVyUmFuayA6IGZ1bmN0aW9uKCkge1xyXG5cdFx0XHRpZiAodGhpcy5zdGF0ZXMubGVuZ3RoKSB7XHJcblx0XHRcdFx0cmV0dXJuIHRoaXMuc3RhdGVzW3RoaXMuc3RhdGVzLmxlbmd0aC0xXS5nZW5kZXJSYW5rO1xyXG5cdFx0XHR9XHJcblx0XHRcdHJldHVybiBcIi1cIjtcclxuXHRcdH0sXHJcblx0XHRcclxuXHRcdHBpbmcgOiBmdW5jdGlvbihwb3MsZnJlcSxpc1NPUyxjdGltZSxhbHQsb3ZlcmFsbFJhbmssZ3JvdXBSYW5rLGdlbmRlclJhbmssX0VMQVBTRUQpXHJcblx0XHR7XHJcblx0XHRcdHZhciBsbHQgPSAobmV3IERhdGUoKSkuZ2V0VGltZSgpOyBcclxuXHRcdFx0aWYgKCFjdGltZSlcclxuXHRcdFx0XHRjdGltZT1sbHQ7XHJcblx0XHRcdHRoaXMuc2V0TGFzdFJlYWxEZWxheShsbHQtY3RpbWUpO1xyXG5cdFx0XHR0aGlzLnNldExhc3RQaW5nVGltZXN0YW1wKGxsdCk7XHRcdFx0XHJcblx0XHRcdHZhciBzdGF0ZSA9IG5ldyBQYXJ0aWNpcGFudFN0YXRlKHt0aW1lc3RhbXA6Y3RpbWUsZ3BzOnBvcyxpc1NPUzppc1NPUyxmcmVxOmZyZXEsYWx0OmFsdCxvdmVyYWxsUmFuazpvdmVyYWxsUmFuayxncm91cFJhbms6Z3JvdXBSYW5rLGdlbmRlclJhbms6Z2VuZGVyUmFua30pO1xyXG5cdFx0XHQvL2lzU09TPXRydWU7XHJcblx0XHRcdGlmIChpc1NPUyB8fCBDT05GSUcuc2V0dGluZ3Mubm9JbnRlcnBvbGF0aW9uKVxyXG5cdFx0XHR7XHJcblx0XHRcdFx0aWYgKGlzU09TKVxyXG5cdFx0XHRcdFx0dGhpcy5zZXRJc1NPUyh0cnVlKTtcdFx0XHRcdFxyXG5cdFx0XHRcdHRoaXMuYWRkU3RhdGUoc3RhdGUpO1xyXG5cdFx0XHRcdHJldHVybjtcclxuXHRcdFx0fVxyXG5cdFx0XHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRcdFx0dmFyIHRyYWNrbGVuID0gdGhpcy50cmFjay5nZXRUcmFja0xlbmd0aCgpO1xyXG5cdFx0XHR2YXIgdHJhY2tsZW4xID0gdGhpcy50cmFjay5nZXRUcmFja0xlbmd0aEluV0dTODQoKTtcclxuXHRcdFx0dmFyIGxsc3RhdGUgPSB0aGlzLnN0YXRlcy5sZW5ndGggPj0gMiA/IHRoaXMuc3RhdGVzW3RoaXMuc3RhdGVzLmxlbmd0aC0yXSA6IG51bGw7XHJcblx0XHRcdHZhciBsc3RhdGUgPSB0aGlzLnN0YXRlcy5sZW5ndGggPyB0aGlzLnN0YXRlc1t0aGlzLnN0YXRlcy5sZW5ndGgtMV0gOiBudWxsO1xyXG5cdFx0XHRpZiAocG9zWzBdID09IDAgJiYgcG9zWzFdID09IDApIHtcclxuXHRcdFx0XHRpZiAoIWxzdGF0ZSkgcmV0dXJuO1xyXG5cdFx0XHRcdHBvcz1sc3RhdGUuZ3BzO1xyXG5cdFx0XHR9XHJcblx0XHRcdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdFx0XHR2YXIgYmVzdDtcclxuXHRcdFx0dmFyIGJlc3RtPW51bGw7XHJcblx0XHRcdHZhciBsZWxwID0gbHN0YXRlID8gbHN0YXRlLmdldEVsYXBzZWQoKSA6IDA7XHQvLyBsYXN0IGVsYXBzZWRcclxuXHRcdFx0dmFyIHRnID0gdGhpcy50cmFjay5yb3V0ZTtcclxuXHRcdFx0Ly8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0XHRcdC8vIE5FVyBBTEdcclxuXHRcdFx0dmFyIGNvZWYgPSB0aGlzLnRyYWNrLmdldFRyYWNrTGVuZ3RoSW5XR1M4NCgpL3RoaXMudHJhY2suZ2V0VHJhY2tMZW5ndGgoKTtcclxuXHRcdFx0dmFyIG1pbmYgPSBudWxsO1xyXG5cdFx0XHR2YXIgcnIgPSBDT05GSUcubWF0aC5ncHNJbmFjY3VyYWN5KmNvZWY7XHJcblx0XHRcdHZhciByZXN1bHQgPSB0aGlzLnRyYWNrLnJUcmVlLnNlYXJjaChbcG9zWzBdLXJyLCBwb3NbMV0tcnIsIHBvc1swXStyciwgcG9zWzFdK3JyXSk7XHJcblx0XHRcdGlmICghcmVzdWx0KVxyXG5cdFx0XHRcdHJlc3VsdD1bXTtcclxuXHRcdFx0Ly9jb25zb2xlLmxvZyhcIkZPVU5EIFwiK3Jlc3VsdC5sZW5ndGgrXCIgfCBcIit0aGlzLnRyYWNrLnJvdXRlLmxlbmd0aCtcIiB8IFwiK3JyKTtcclxuXHRcdFx0Ly9mb3IgKHZhciBpPTA7aTx0aGlzLnRyYWNrLnJvdXRlLmxlbmd0aC0xO2krKykge1xyXG5cclxuXHRcdFx0Ly8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0XHRcdHZhciBkYmdMaW5lID0gW107XHJcblx0XHRcdGZvciAodmFyIF9pPTA7X2k8cmVzdWx0Lmxlbmd0aDtfaSsrKVxyXG5cdFx0XHR7XHJcblx0XHRcdFx0dmFyIGkgPSByZXN1bHRbX2ldWzRdLmluZGV4O1xyXG5cdFx0XHRcdFxyXG5cdFx0XHRcdGlmICh0eXBlb2YgR1VJICE9IFwidW5kZWZpbmVkXCIgJiYgR1VJLmlzRGVidWcpIFxyXG5cdFx0XHRcdFx0ZGJnTGluZS5wdXNoKFtbdGdbaV1bMF0sIHRnW2ldWzFdXSwgW3RnW2krMV1bMF0sIHRnW2krMV1bMV1dXSk7XHJcblx0XHRcdFx0XHJcblx0XHRcdFx0dmFyIHJlcyA9IFV0aWxzLmludGVyY2VwdE9uQ2lyY2xlKHRnW2ldLHRnW2krMV0scG9zLHJyKTtcclxuXHRcdFx0XHRpZiAocmVzKSBcclxuXHRcdFx0XHR7XHJcblx0XHRcdFx0XHQvLyBoYXMgaW50ZXJzZWN0aW9uICgyIHBvaW50cylcclxuXHRcdFx0XHRcdHZhciBkMSA9IFV0aWxzLmRpc3RwKHJlc1swXSx0Z1tpXSk7XHJcblx0XHRcdFx0XHR2YXIgZDIgPSBVdGlscy5kaXN0cChyZXNbMV0sdGdbaV0pO1xyXG5cdFx0XHRcdFx0dmFyIGQzID0gVXRpbHMuZGlzdHAodGdbaV0sdGdbaSsxXSk7XHJcblx0XHRcdFx0XHR2YXIgZWwxID0gdGhpcy50cmFjay5kaXN0YW5jZXNFbGFwc2VkW2ldKyh0aGlzLnRyYWNrLmRpc3RhbmNlc0VsYXBzZWRbaSsxXS10aGlzLnRyYWNrLmRpc3RhbmNlc0VsYXBzZWRbaV0pKmQxL2QzO1xyXG5cdFx0XHRcdFx0dmFyIGVsMiA9IHRoaXMudHJhY2suZGlzdGFuY2VzRWxhcHNlZFtpXSsodGhpcy50cmFjay5kaXN0YW5jZXNFbGFwc2VkW2krMV0tdGhpcy50cmFjay5kaXN0YW5jZXNFbGFwc2VkW2ldKSpkMi9kMztcclxuXHRcdFx0XHRcdC8vY29uc29sZS5sb2coXCJJbnRlcnNlY3Rpb24gY2FuZGlkYXRlIGF0IFwiK2krXCIgfCBcIitlbDErXCIgfCBcIitlbDIpO1xyXG5cdFx0XHRcdFx0aWYgKGVsMSA8IGxlbHApXHJcblx0XHRcdFx0XHRcdGVsMT1sZWxwO1xyXG5cdFx0XHRcdFx0aWYgKGVsMiA8IGxlbHApXHJcblx0XHRcdFx0XHRcdGVsMj1sZWxwO1xyXG5cdFx0XHRcdFx0Ly8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0XHRcdFx0XHRpZiAobWluZiA9PSBudWxsIHx8IGVsMSA8IG1pbmYpXHJcblx0XHRcdFx0XHRcdG1pbmY9ZWwxO1xyXG5cdFx0XHRcdFx0aWYgKGVsMiA8IG1pbmYpXHJcblx0XHRcdFx0XHRcdG1pbmY9ZWwyO1xyXG5cdFx0XHRcdH1cclxuXHRcdFx0fVxyXG5cdFx0XHQvLy0tLS0tLS8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRcdFx0Ly9jb25zb2xlLmxvZyhcIk9PT09PT1AhIFwiK2RiZ0xpbmUubGVuZ3RoKTtcclxuXHRcdFx0Ly9jb25zb2xlLmxvZyhkYmdMaW5lKTtcclxuXHRcdFx0aWYgKHR5cGVvZiBHVUkgIT0gXCJ1bmRlZmluZWRcIiAmJiBHVUkuaXNEZWJ1ZykgXHJcblx0XHRcdHtcclxuXHRcdFx0XHRpZiAodGhpcy5fX2RiZ0JveCkge1xyXG5cdFx0XHRcdFx0R1VJLnRlc3RMYXllci5nZXRTb3VyY2UoKS5yZW1vdmVGZWF0dXJlKHRoaXMuX19kYmdCb3gpO1xyXG5cdFx0XHRcdFx0ZGVsZXRlIHRoaXMuX19kYmdCb3g7XHJcblx0XHRcdFx0fVxyXG5cdFx0XHRcdGlmIChkYmdMaW5lLmxlbmd0aCkge1xyXG5cdFx0XHRcdFx0dmFyIGZlYXR1cmUgPSBuZXcgb2wuRmVhdHVyZSgpO1xyXG5cdFx0XHRcdFx0dmFyIGdlb20gPSBuZXcgb2wuZ2VvbS5NdWx0aUxpbmVTdHJpbmcoZGJnTGluZSk7XHJcblx0XHRcdFx0XHRnZW9tLnRyYW5zZm9ybSgnRVBTRzo0MzI2JywgJ0VQU0c6Mzg1NycpO1xyXG5cdFx0XHRcdFx0ZmVhdHVyZS5zZXRHZW9tZXRyeShnZW9tKTtcclxuXHRcdFx0XHRcdEdVSS50ZXN0TGF5ZXIuZ2V0U291cmNlKCkuYWRkRmVhdHVyZShmZWF0dXJlKTtcclxuXHRcdFx0XHR9XHJcblx0XHRcdH0gXHJcblx0XHRcdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0XHRcdFxyXG5cdFx0XHQvKmlmIChtaW5mID09IG51bGwpXHJcblx0XHRcdFx0Y29uc29sZS5lcnJvcihcIk1JTkYgTlVMTCAoXCIrcmVzdWx0Lmxlbmd0aCtcIikgQ09FRj1cIitjb2VmKTtcclxuXHRcdFx0ZWxzZVxyXG5cdFx0XHRcdGNvbnNvbGUubG9nKFwiPj4gTUlORiBcIittaW5mK1wiIChcIittaW5mKnRoaXMudHJhY2suZ2V0VHJhY2tMZW5ndGgoKStcIiBtKSBDT0VGPVwiK2NvZWYpOyovXHJcblx0XHRcdFxyXG5cdFx0XHQvLyA/PyBPSyBTS0lQIERJU0NBUkQhISFcclxuXHRcdFx0aWYgKG1pbmYgPT0gbnVsbCkgXHJcblx0XHRcdFx0cmV0dXJuO1xyXG5cdFx0XHRcclxuXHRcdFx0Ly8gbWluZiA9IG92ZXJhbGwgbWluaW11bSBvZiBlbGFwc2VkIGludGVyc2VjdGlvbnNcclxuXHRcdFx0aWYgKG1pbmYgIT0gbnVsbCkgXHJcblx0XHRcdFx0YmVzdG09bWluZjtcclxuXHRcdFx0XHJcblx0XHRcdC8vY29uc29sZS5sb2coXCJCRVNUTSBGT1IgUElORyA6IFwiK2Jlc3RtKTtcclxuXHRcdFx0Ly8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdFx0XHQvL2Jlc3RtID0gX0VMQVBTRUQ7IC8vKFRFU1QgSEFDSyBPTkxZKVxyXG5cdFx0XHRpZiAoYmVzdG0gIT0gbnVsbCkgXHJcblx0XHRcdHtcclxuXHRcdFx0XHR2YXIgbmVsID0gYmVzdG07IC8vdGhpcy50cmFjay5nZXRFbGFwc2VkRnJvbVBvaW50KGJlc3QpO1xyXG5cdFx0XHRcdGlmIChsc3RhdGUpIFxyXG5cdFx0XHRcdHtcclxuXHRcdFx0XHRcdC8qaWYgKG5lbCA8IGxzdGF0ZS5nZXRFbGFwc2VkKCkpIFxyXG5cdFx0XHRcdFx0e1xyXG5cdFx0XHRcdFx0XHQvLyBXUk9ORyBESVJFQ1RJT04gT1IgR1BTIERBVEEgV1JPTkc/IFNLSVAuLlxyXG5cdFx0XHRcdFx0XHRpZiAoKGxzdGF0ZS5nZXRFbGFwc2VkKCktbmVsKSp0cmFja2xlbiA8IENPTkZJRy5jb25zdHJhaW50cy5iYWNrd2FyZHNFcHNpbG9uSW5NZXRlcikgXHJcblx0XHRcdFx0XHRcdFx0cmV0dXJuO1xyXG5cdFx0XHRcdFx0XHRkbyAgXHJcblx0XHRcdFx0XHRcdHtcclxuXHRcdFx0XHRcdFx0XHRuZWwrPTEuMDtcclxuXHRcdFx0XHRcdFx0fSB3aGlsZSAobmVsIDwgbHN0YXRlLmdldEVsYXBzZWQoKSk7XHJcblx0XHRcdFx0XHR9Ki9cclxuXHRcdFx0XHRcdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRcdFx0XHRcdGlmIChuZWwgPiB0aGlzLnRyYWNrLmxhcHMpIHtcclxuXHRcdFx0XHRcdFx0bmVsPXRoaXMudHJhY2subGFwcztcclxuXHRcdFx0XHRcdH1cclxuXHRcdFx0XHRcdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRcdFx0XHRcdGxsc3RhdGUgPSB0aGlzLnN0YXRlcy5sZW5ndGggPj0gQ09ORklHLm1hdGguc3BlZWRBbmRBY2NlbGVyYXRpb25BdmVyYWdlRGVncmVlKjIgPyB0aGlzLnN0YXRlc1t0aGlzLnN0YXRlcy5sZW5ndGgtQ09ORklHLm1hdGguc3BlZWRBbmRBY2NlbGVyYXRpb25BdmVyYWdlRGVncmVlKjJdIDogbnVsbDtcclxuXHRcdFx0XHRcdGxzdGF0ZSA9IHRoaXMuc3RhdGVzLmxlbmd0aCA+PSBDT05GSUcubWF0aC5zcGVlZEFuZEFjY2VsZXJhdGlvbkF2ZXJhZ2VEZWdyZWUgPyB0aGlzLnN0YXRlc1t0aGlzLnN0YXRlcy5sZW5ndGgtQ09ORklHLm1hdGguc3BlZWRBbmRBY2NlbGVyYXRpb25BdmVyYWdlRGVncmVlXSA6IG51bGw7XHJcblx0XHRcdFx0XHRpZiAobHN0YXRlKSAge1xyXG5cdFx0XHRcdFx0XHRzdGF0ZS5zZXRTcGVlZCggdHJhY2tsZW4gKiAobmVsLWxzdGF0ZS5nZXRFbGFwc2VkKCkpICogMTAwMCAvIChjdGltZS1sc3RhdGUudGltZXN0YW1wKSk7XHJcblx0XHRcdFx0XHRcdGlmIChsbHN0YXRlKSBcclxuXHRcdFx0XHRcdFx0XHRzdGF0ZS5zZXRBY2NlbGVyYXRpb24oIChzdGF0ZS5nZXRTcGVlZCgpLWxzdGF0ZS5nZXRTcGVlZCgpKSAqIDEwMDAgLyAoY3RpbWUtbHN0YXRlLnRpbWVzdGFtcCkpO1xyXG5cdFx0XHRcdFx0fVxyXG5cdFx0XHRcdFx0Ly8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdFx0XHRcdH1cclxuXHRcdFx0XHRzdGF0ZS5zZXRFbGFwc2VkKG5lbCk7XHJcblx0XHRcdH0gZWxzZSB7XHJcblx0XHRcdFx0aWYgKGxzdGF0ZSlcclxuXHRcdFx0XHRcdHN0YXRlLnNldEVsYXBzZWQobHN0YXRlLmdldEVsYXBzZWQoKSk7XHJcblx0XHRcdFx0aWYgKGxzdGF0ZS5nZXRFbGFwc2VkKCkgIT0gdGhpcy50cmFjay5sYXBzKSB7XHJcblx0XHRcdFx0XHR0aGlzLnNldElzRGlzY2FyZGVkKHRydWUpO1xyXG5cdFx0XHRcdH1cclxuXHRcdFx0fVxyXG5cdFx0XHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0XHRcdHRoaXMuYWRkU3RhdGUoc3RhdGUpO1xyXG5cdFx0XHRpZiAodHlwZW9mIEdVSSAhPSBcInVuZGVmaW5lZFwiICYmIEdVSS5pc0RlYnVnICYmICF0aGlzLmdldElzRGlzY2FyZGVkKCkpIFxyXG5cdFx0XHR7XHJcblx0XHRcdFx0dmFyIGZlYXR1cmUgPSBuZXcgb2wuRmVhdHVyZSgpO1xyXG5cdFx0XHRcdHZhciBnZW9tID0gbmV3IG9sLmdlb20uUG9pbnQoc3RhdGUuZ3BzKTtcclxuXHRcdFx0XHRnZW9tLnRyYW5zZm9ybSgnRVBTRzo0MzI2JywgJ0VQU0c6Mzg1NycpO1xyXG5cdFx0XHRcdGZlYXR1cmUuY29sb3I9dGhpcy5jb2xvcjtcclxuXHRcdFx0XHRmZWF0dXJlLnNldEdlb21ldHJ5KGdlb20pO1xyXG5cdFx0XHRcdGZlYXR1cmUudGltZUNyZWF0ZWQ9Y3RpbWU7XHJcblx0XHRcdFx0R1VJLmRlYnVnTGF5ZXJHUFMuZ2V0U291cmNlKCkuYWRkRmVhdHVyZShmZWF0dXJlKTtcclxuXHRcdFx0fVxyXG5cdFx0fSxcclxuXHRcdFxyXG5cdFx0YWRkU3RhdGUgOiBmdW5jdGlvbihzdGF0ZSkge1xyXG5cdFx0XHR0aGlzLnN0YXRlcy5wdXNoKHN0YXRlKTtcclxuXHRcdFx0aWYgKHRoaXMuc3RhdGVzLmxlbmd0aCA+IENPTkZJRy5jb25zdHJhaW50cy5tYXhQYXJ0aWNpcGFudFN0YXRlSGlzdG9yeSAmJiAhdGhpcy5pc1NPUylcclxuXHRcdFx0XHR0aGlzLnN0YXRlcy5zaGlmdCgpO1xyXG5cdFx0fSxcclxuXHJcblx0XHRnZXRMYXN0U3RhdGU6IGZ1bmN0aW9uKCkge1xyXG5cdFx0XHRyZXR1cm4gdGhpcy5zdGF0ZXMubGVuZ3RoID8gdGhpcy5zdGF0ZXNbdGhpcy5zdGF0ZXMubGVuZ3RoLTFdIDogbnVsbDtcclxuXHRcdH0sXHJcblxyXG5cdFx0Z2V0RnJlcSA6IGZ1bmN0aW9uKCkge1xyXG5cdFx0XHR2YXIgbHN0YXRlID0gdGhpcy5nZXRMYXN0U3RhdGUoKTtcclxuXHRcdFx0cmV0dXJuIGxzdGF0ZSA/IGxzdGF0ZS5mcmVxIDogMDtcclxuXHRcdH0sXHJcblxyXG5cdFx0Z2V0U3BlZWQgOiBmdW5jdGlvbigpIHtcclxuXHRcdFx0dmFyIGxzdGF0ZSA9IHRoaXMuZ2V0TGFzdFN0YXRlKCk7XHJcblx0XHRcdHJldHVybiBsc3RhdGUgPyBsc3RhdGUuc3BlZWQgOiAwO1xyXG5cdFx0fSxcclxuXHJcblx0XHRnZXRHUFMgOiBmdW5jdGlvbigpIHtcclxuXHRcdFx0dmFyIGxzdGF0ZSA9IHRoaXMuZ2V0TGFzdFN0YXRlKCk7XHJcblx0XHRcdHJldHVybiBsc3RhdGUgPyBsc3RhdGUuZ3BzIDogdGhpcy5nZXRQb3NpdGlvbigpO1xyXG5cdFx0fSxcclxuXHJcblx0XHRnZXRFbGFwc2VkIDogZnVuY3Rpb24oKSB7XHJcblx0XHRcdHZhciBsc3RhdGUgPSB0aGlzLmdldExhc3RTdGF0ZSgpO1xyXG5cdFx0XHRyZXR1cm4gbHN0YXRlID8gbHN0YXRlLmVsYXBzZWQgOiAwO1xyXG5cdFx0fSxcclxuXHJcblx0XHRnZXRQb3B1cEhUTUwgOiBmdW5jdGlvbigpIHtcclxuXHRcdFx0dmFyIHBvcyA9IHRoaXMuZ2V0UG9zaXRpb24oKTtcclxuXHRcdFx0aWYgKHRoaXMuaXNTT1MgfHwgdGhpcy5pc0Rpc2NhcmRlZCkge1xyXG5cdFx0XHRcdHBvcyA9IHRoaXMuZ2V0R1BTKCk7XHJcblx0XHRcdH1cclxuXHRcdFx0dmFyIHRsZW4gPSB0aGlzLnRyYWNrLmdldFRyYWNrTGVuZ3RoKCk7XHJcblx0XHRcdHZhciBjdGltZSA9IChuZXcgRGF0ZSgpKS5nZXRUaW1lKCk7XHJcblx0XHRcdHZhciBlbGFwc2VkID0gdGhpcy5jYWxjdWxhdGVFbGFwc2VkQXZlcmFnZShjdGltZSk7XHJcblx0XHRcdHZhciB0cGFydCA9IHRoaXMudHJhY2suZ2V0VHJhY2tQYXJ0KGVsYXBzZWQpO1xyXG5cdFx0XHR2YXIgdGFyZ2V0S007XHJcblx0XHRcdHZhciBwYXJ0U3RhcnQ7XHJcblx0XHRcdHZhciB0cGFydE1vcmU7XHJcblx0XHRcdGlmICh0cGFydCA9PSAwKSB7XHJcblx0XHRcdFx0dHBhcnRzPVwiU1dJTVwiO1xyXG5cdFx0XHRcdHRhcmdldEtNPXRoaXMudHJhY2suYmlrZVN0YXJ0S007XHJcblx0XHRcdFx0cGFydFN0YXJ0PTA7XHJcblx0XHRcdFx0dHBhcnRNb3JlPVwiU1dJTVwiO1xyXG5cdFx0XHR9IGVsc2UgaWYgKHRwYXJ0ID09IDEpIHtcclxuXHRcdFx0XHR0cGFydHM9XCJCSUtFXCI7XHJcblx0XHRcdFx0dGFyZ2V0S009dGhpcy50cmFjay5ydW5TdGFydEtNO1xyXG5cdFx0XHRcdHBhcnRTdGFydD10aGlzLnRyYWNrLmJpa2VTdGFydEtNO1xyXG5cdFx0XHRcdHRwYXJ0TW9yZT1cIlJJREVcIjtcclxuXHRcdFx0fSBlbHNlIGlmICh0cGFydCA9PSAyKSB7IFxyXG5cdFx0XHRcdHRwYXJ0cz1cIlJVTlwiO1xyXG5cdFx0XHRcdHRhcmdldEtNPXRsZW4vMTAwMC4wO1xyXG5cdFx0XHRcdHBhcnRTdGFydD10aGlzLnRyYWNrLnJ1blN0YXJ0S007XHJcblx0XHRcdFx0dHBhcnRNb3JlPVwiUlVOXCI7XHJcblx0XHRcdH1cclxuXHRcdFx0dmFyIGh0bWw9XCI8ZGl2IGNsYXNzPSdwb3B1cF9jb2RlJyBzdHlsZT0nY29sb3I6cmdiYShcIitjb2xvckFscGhhQXJyYXkodGhpcy5nZXRDb2xvcigpLDAuOSkuam9pbihcIixcIikrXCIpJz5cIitlc2NhcGVIVE1MKHRoaXMuZ2V0Q29kZSgpKStcIiAoMSk8L2Rpdj5cIjtcclxuXHRcdFx0dmFyIGZyZXEgPSBNYXRoLnJvdW5kKHRoaXMuZ2V0RnJlcSgpKTtcclxuXHRcdFx0aWYgKGZyZXEgPiAwKSB7XHJcblx0XHRcdFx0aHRtbCs9XCI8ZGl2IGNsYXNzXCIgK1xyXG5cdFx0XHRcdFx0XHRcIj0ncG9wdXBfZnJlcSc+XCIrZnJlcStcIjwvZGl2PlwiO1xyXG5cdFx0XHR9XHJcblx0XHRcdHZhciBlbGttID0gZWxhcHNlZCp0bGVuLzEwMDAuMDtcclxuXHRcdFx0dmFyIGVsa21zID0gcGFyc2VGbG9hdChNYXRoLnJvdW5kKGVsa20gKiAxMDApIC8gMTAwKS50b0ZpeGVkKDIpO1x0XHRcdFxyXG5cclxuXHRcdFx0Lyp2YXIgcmVrbSA9IGVsYXBzZWQlMS4wO1xyXG5cdFx0XHRyZWttPSgxLjAtcmVrbSkqdGxlbi8xMDAwLjA7XHJcblx0XHRcdHJla20gPSBwYXJzZUZsb2F0KE1hdGgucm91bmQocmVrbSAqIDEwMCkgLyAxMDApLnRvRml4ZWQoMik7Ki9cdFx0XHRcclxuXHRcdFx0Ly8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdFx0XHR2YXIgZXN0Zj1udWxsO1xyXG5cdFx0XHR2YXIgZXR4dDE9bnVsbDtcclxuXHRcdFx0dmFyIGV0eHQyPW51bGw7XHJcblx0XHRcdHZhciBsc3RhdGUgPSBudWxsOyBcclxuXHRcdFx0aWYgKHRoaXMuc3RhdGVzLmxlbmd0aCkgXHJcblx0XHRcdHtcclxuXHRcdFx0XHRsc3RhdGUgPSB0aGlzLnN0YXRlc1t0aGlzLnN0YXRlcy5sZW5ndGgtMV07XHJcblx0XHRcdFx0aWYgKGxzdGF0ZS5nZXRTcGVlZCgpID4gMCkgXHJcblx0XHRcdFx0e1xyXG5cdFx0XHRcdFx0dmFyIHNwbXMgPSBNYXRoLmNlaWwobHN0YXRlLmdldFNwZWVkKCkgKiAxMDApIC8gMTAwO1xyXG5cdFx0XHRcdFx0c3Btcy89MTAwMC4wO1xyXG5cdFx0XHRcdFx0c3Btcyo9NjAqNjA7XHJcblx0XHRcdFx0XHRldHh0MT1wYXJzZUZsb2F0KHNwbXMpLnRvRml4ZWQoMikrXCIga20vaFwiO1xyXG5cdFx0XHRcdFx0dmFyIHJvdCA9IC10aGlzLmdldFJvdGF0aW9uKCkqMTgwL01hdGguUEk7IFxyXG5cdFx0XHRcdFx0aWYgKHJvdCA8IDApXHJcblx0XHRcdFx0XHRcdHJvdCs9MzYwO1xyXG5cdFx0XHRcdFx0aWYgKHJvdCAhPSBudWxsKSBcclxuXHRcdFx0XHRcdHtcclxuXHRcdFx0XHRcdFx0aWYgKHJvdCA8PSAwKSBcclxuXHRcdFx0XHRcdFx0XHRldHh0MSs9XCIgRVwiO1xyXG5cdFx0XHRcdFx0XHRlbHNlIGlmIChyb3QgPD0gNDUpXHJcblx0XHRcdFx0XHRcdFx0ZXR4dDErPVwiIFNFXCI7XHJcblx0XHRcdFx0XHRcdGVsc2UgaWYgKHJvdCA8PSA5MClcclxuXHRcdFx0XHRcdFx0XHRldHh0MSs9XCIgU1wiO1xyXG5cdFx0XHRcdFx0XHRlbHNlIGlmIChyb3QgPD0gMTM1KVxyXG5cdFx0XHRcdFx0XHRcdGV0eHQxKz1cIiBTV1wiO1xyXG5cdFx0XHRcdFx0XHRlbHNlIGlmIChyb3QgPD0gMTgwKVxyXG5cdFx0XHRcdFx0XHRcdGV0eHQxKz1cIiBXXCI7XHJcblx0XHRcdFx0XHRcdGVsc2UgaWYgKHJvdCA8PSAyMjUpXHJcblx0XHRcdFx0XHRcdFx0ZXR4dDErPVwiIE5XXCI7XHJcblx0XHRcdFx0XHRcdGVsc2UgaWYgKHJvdCA8PSAyNzApXHJcblx0XHRcdFx0XHRcdFx0ZXR4dDErPVwiIE5cIjtcclxuXHRcdFx0XHRcdFx0ZWxzZSBcclxuXHRcdFx0XHRcdFx0XHRldHh0MSs9XCIgTkVcIjtcclxuXHRcdFx0XHRcdH1cclxuXHRcdFx0XHRcdGVzdGY9VXRpbHMuZm9ybWF0VGltZShuZXcgRGF0ZSggY3RpbWUgKyB0YXJnZXRLTSoxMDAwIC8gc3BtcyoxMDAwICkpOyAgXHJcblx0XHRcdFx0fVxyXG5cdFx0XHRcdGlmIChsc3RhdGUuZ2V0QWNjZWxlcmF0aW9uKCkgPiAwKVxyXG5cdFx0XHRcdFx0ZXR4dDI9cGFyc2VGbG9hdChNYXRoLmNlaWwobHN0YXRlLmdldEFjY2VsZXJhdGlvbigpICogMTAwKSAvIDEwMCkudG9GaXhlZCgyKStcIiBtL3MyXCI7XHJcblx0XHRcdH1cclxuXHRcdFx0Ly8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0XHRcdHZhciBwMSA9IDEwMCp0aGlzLnRyYWNrLmJpa2VTdGFydEtNLyh0bGVuLzEwMDAuMCk7XHJcblx0XHRcdHZhciBwMiA9IDEwMCoodGhpcy50cmFjay5ydW5TdGFydEtNLXRoaXMudHJhY2suYmlrZVN0YXJ0S00pLyh0bGVuLzEwMDAuMCk7XHJcblx0XHRcdHZhciBwMyA9IDEwMCoodGxlbi8xMDAwLjAgLSB0aGlzLnRyYWNrLnJ1blN0YXJ0S00pLyh0bGVuLzEwMDAuMCk7XHJcblx0XHRcdHZhciBwcmV0dHlDb29yZD1cclxuXHRcdFx0XHRcIjxkaXYgc3R5bGU9J29wYWNpdHk6MC43O2Zsb2F0OmxlZnQ7b3ZlcmZsb3c6aGlkZGVuO2hlaWdodDo3cHg7d2lkdGg6XCIrcDErXCIlO2JhY2tncm91bmQtY29sb3I6XCIrQ09ORklHLmFwcGVhcmFuY2UudHJhY2tDb2xvclN3aW0rXCInLz5cIitcclxuXHRcdFx0XHRcIjxkaXYgc3R5bGU9J29wYWNpdHk6MC43O2Zsb2F0OmxlZnQ7b3ZlcmZsb3c6aGlkZGVuO2hlaWdodDo3cHg7d2lkdGg6XCIrcDIrXCIlO2JhY2tncm91bmQtY29sb3I6XCIrQ09ORklHLmFwcGVhcmFuY2UudHJhY2tDb2xvckJpa2UrXCInLz5cIitcclxuXHRcdFx0XHRcIjxkaXYgc3R5bGU9J29wYWNpdHk6MC43O2Zsb2F0OmxlZnQ7b3ZlcmZsb3c6aGlkZGVuO2hlaWdodDo3cHg7d2lkdGg6XCIrcDMrXCIlO2JhY2tncm91bmQtY29sb3I6XCIrQ09ORklHLmFwcGVhcmFuY2UudHJhY2tDb2xvclJ1bitcIicvPlwiXHJcblx0XHRcdFx0OyAvL29sLmNvb3JkaW5hdGUudG9TdHJpbmdIRE1TKHRoaXMuZ2V0UG9zaXRpb24oKSwgMik7XHJcblxyXG5cdFx0XHR2YXIgaW1nZGl2O1xyXG5cdFx0XHRpZiAodHBhcnQgPT0gMClcclxuXHRcdFx0XHRpbWdkaXY9XCI8aW1nIGNsYXNzPSdwb3B1cF90cmFja19tb2RlJyBzdHlsZT0nbGVmdDpcIitlbGFwc2VkKjEwMCtcIiUnIHNyYz0naW1nL3N3aW0uc3ZnJy8+XCJcclxuXHRcdFx0ZWxzZSBpZiAodHBhcnQgPT0gMSlcclxuXHRcdFx0XHRpbWdkaXY9XCI8aW1nIGNsYXNzPSdwb3B1cF90cmFja19tb2RlJyBzdHlsZT0nbGVmdDpcIitlbGFwc2VkKjEwMCtcIiUnIHNyYz0naW1nL2Jpa2Uuc3ZnJy8+XCJcclxuXHRcdFx0ZWxzZSAvKmlmICh0cGFydCA9PSAyKSovXHJcblx0XHRcdFx0aW1nZGl2PVwiPGltZyBjbGFzcz0ncG9wdXBfdHJhY2tfbW9kZScgc3R5bGU9J2xlZnQ6XCIrZWxhcHNlZCoxMDArXCIlJyBzcmM9J2ltZy9ydW4uc3ZnJy8+XCJcclxuXHRcclxuXHJcblx0XHRcdHZhciBwYXNzID0gTWF0aC5yb3VuZCgobmV3IERhdGUoKSkuZ2V0VGltZSgpLzM1MDApICUgMztcclxuXHRcdFx0aHRtbCs9XCI8dGFibGUgY2xhc3M9J3BvcHVwX3RhYmxlJyBzdHlsZT0nYmFja2dyb3VuZC1pbWFnZTp1cmwoXFxcIlwiK3RoaXMuZ2V0SW1hZ2UoKStcIlxcXCIpJz5cIjtcclxuXHRcdFx0dmFyIGlzRHVtbXk9IShlbGFwc2VkID4gMCk7XHJcblx0XHRcdGh0bWwrPVwiPHRyPjx0ZCBjbGFzcz0nbGJsJz5FbGFwc2VkPC90ZD48dGQgY2xhc3M9J3ZhbHVlJz5cIisoaXNEdW1teSA/IFwiLVwiIDogZWxrbXMrXCIga21cIikrXCI8L3RkPjwvdHI+XCI7XHJcblx0XHRcdGh0bWwrPVwiPHRyPjx0ZCBjbGFzcz0nbGJsJz5Nb3JlIHRvIFwiK3RwYXJ0TW9yZStcIjwvdGQ+PHRkIGNsYXNzPSd2YWx1ZSc+XCIrKGlzRHVtbXkgPyBcIi1cIiA6IHBhcnNlRmxvYXQoTWF0aC5yb3VuZCgodGFyZ2V0S00tZWxrbSkgKiAxMDApIC8gMTAwKS50b0ZpeGVkKDIpIC8qIHJla20gKi8gK1wiIGttXCIpK1wiPC90ZD48L3RyPlwiO1xyXG5cdFx0XHRodG1sKz1cIjx0cj48dGQgY2xhc3M9J2xibCc+RmluaXNoIFwiKyB0cGFydHMudG9Mb3dlckNhc2UoKSArXCI8L3RkPjx0ZCBjbGFzcz0ndmFsdWUnPlwiKyghZXN0ZiA/IFwiLVwiIDogZXN0ZikrXCI8L3RkPjwvdHI+XCI7XHRcdFx0XHRcdFxyXG5cdFx0XHRodG1sKz1cIjx0cj48dGQgY2xhc3M9J2xibCc+U3BlZWQ8L3RkPjx0ZCBjbGFzcz0ndmFsdWUnPlwiKyghaXNEdW1teSAmJiBldHh0MSA/IGV0eHQxIDogXCItXCIpICsgXCI8L3RkPjwvdHI+XCI7XHJcblx0XHRcdGh0bWwrPVwiPHRyPjx0ZCBjbGFzcz0nbGJsJz5BY2NlbGVyLjwvdGQ+PHRkIGNsYXNzPSd2YWx1ZSc+XCIrKCFpc0R1bW15ICYmIGV0eHQyID8gZXR4dDIgOiBcIi1cIikgK1wiPC90ZD48L3RyPlwiO1xyXG5cdFx0XHRodG1sKz1cIjx0ciBzdHlsZT0naGVpZ2h0OjEwMCUnPjx0ZD4mbmJzcDs8L3RkPjx0ZD4mbmJzcDs8L3RkPjwvdHI+XCI7XHJcblx0XHRcdGh0bWwrXCI8L3RhYmxlPlwiXHJcblx0XHRcdC8vaHRtbCs9XCI8ZGl2IGNsYXNzPSdwb3B1cF9zaGFkb3cnPlwiK3ByZXR0eUNvb3JkK2ltZ2RpditcIjwvZGl2PlwiO1xyXG5cdFx0XHRcclxuXHRcdFx0dmFyIHJhbms9XCItXCI7XHJcblx0XHRcdGlmICh0aGlzLl9fcG9zICE9IHVuZGVmaW5lZClcclxuXHRcdFx0XHRyYW5rPXRoaXMuX19wb3MgKyAxOyAgIC8vIHRoZSBmaXJzdCBwb3MgLSB0aGUgRkFTVEVTVCBpcyAwXHJcblx0XHRcdFxyXG5cdFx0XHRcclxuXHRcdFx0aHRtbD1cIjxkaXYgY2xhc3M9J3BvcHVwX2NvbnRlbnRfcHJnJz48ZGl2IHN0eWxlPSd3aWR0aDpcIitwMStcIiU7aGVpZ2h0OjZweDtiYWNrZ3JvdW5kLWNvbG9yOlwiK0NPTkZJRy5hcHBlYXJhbmNlLnRyYWNrQ29sb3JTd2ltK1wiO2Zsb2F0OmxlZnQ7Jz48L2Rpdj48ZGl2IHN0eWxlPSd3aWR0aDpcIitwMitcIiU7aGVpZ2h0OjZweDtiYWNrZ3JvdW5kLWNvbG9yOlwiK0NPTkZJRy5hcHBlYXJhbmNlLnRyYWNrQ29sb3JCaWtlK1wiO2Zsb2F0OmxlZnQ7Jz48L2Rpdj48ZGl2IHN0eWxlPSd3aWR0aDpcIitwMytcIiU7aGVpZ2h0OjZweDtiYWNrZ3JvdW5kLWNvbG9yOlwiK0NPTkZJRy5hcHBlYXJhbmNlLnRyYWNrQ29sb3JSdW4rXCI7ZmxvYXQ6bGVmdDsnPjwvZGl2PlwiO1xyXG5cdFx0XHRodG1sKz1cIjxkaXYgY2xhc3M9J3BvcHVwX3RyYWNrX3Bvcyc+PGRpdiBjbGFzcz0ncG9wdXBfdHJhY2tfcG9zXzEnIHN0eWxlPSdsZWZ0OlwiKyhlbGFwc2VkKjkwKStcIiUnPjwvZGl2PjwvZGl2PlwiO1xyXG5cdFx0XHRodG1sKz1cIjwvZGl2PlwiO1xyXG5cdFx0XHRodG1sKz1cIjxpbWcgY2xhc3M9J3BvcHVwX2NvbnRlbnRfaW1nJyBzcmM9J1wiK3RoaXMuZ2V0SW1hZ2UoKStcIicvPlwiO1xyXG5cdFx0XHRodG1sKz1cIjxkaXYgY2xhc3M9J3BvcHVwX2NvbnRlbnRfMSc+XCI7XHJcblx0XHRcdGh0bWwrPVwiPGRpdiBjbGFzcz0ncG9wdXBfY29udGVudF9uYW1lJz5cIitlc2NhcGVIVE1MKHRoaXMuZ2V0Q29kZSgpKStcIjwvZGl2PlwiO1xyXG5cdFx0XHRodG1sKz1cIjxkaXYgY2xhc3M9J3BvcHVwX2NvbnRlbnRfbDEnPlwiK3RoaXMuZ2V0Q291bnRyeSgpLnN1YnN0cmluZygwLDMpLnRvVXBwZXJDYXNlKCkrXCIgfCBQb3M6IFwiK3JhbmsrXCIgfCBTcGVlZDogXCIrKCFpc0R1bW15ICYmIGV0eHQxID8gZXR4dDEgOiBcIi1cIikrXCI8L2Rpdj5cIjtcclxuXHRcdFx0dmFyIHBhc3MgPSBNYXRoLnJvdW5kKCgobmV3IERhdGUoKSkuZ2V0VGltZSgpIC8gMTAwMCAvIDQpKSUyO1xyXG5cdFx0XHRpZiAocGFzcyA9PSAwKSB7XHJcblx0XHRcdFx0aWYgKHRoaXMuX19wb3MgIT0gdW5kZWZpbmVkKSBcclxuXHRcdFx0XHR7XHJcblx0XHRcdFx0XHRwYXJzZUZsb2F0KE1hdGgucm91bmQoZWxrbSAqIDEwMCkgLyAxMDApLnRvRml4ZWQoMik7XHJcblxyXG5cdFx0XHRcdFx0Ly8gdGhpcy5fX25leHQgaXMgdGhlIHBhcnRpY2lwYW50IGJlaGluZCB0aGlzIG9uZSAoZS5nIHRoZSBzbG93ZXIgb25lIHdpdGggbGVzdCBlbGFwc2VkIGluZGV4KVxyXG5cdFx0XHRcdFx0Ly8gYW5kIHRoaXMuX19wcmV2IGlzIHRoZSBvbmUgYmVmb3JlIHVzXHJcblx0XHRcdFx0XHQvLyBzbyBpZiBwYXJ0aWNpcGFudCBpcyBpbiBwb3NpdGlvbiAzIHRoZSBvbmUgYmVmb3JlIGhpbSB3aWxsIGJlIDIgYW5kIHRoZSBvbmUgYmVoaW5kIGhpbSB3aWxsIGJlIDRcclxuXHRcdFx0XHRcdC8vIChlLmcuIFwidGhpcy5fX3BvcyA9PSAzXCIgPT4gdGhpcy5fX3ByZXYuX19wb3MgPT0gMiBhbmQgdGhpcy5fX3ByZXYuX19uZXh0ID09IDRcclxuXHRcdFx0XHRcdC8vIGZvciB0aGVcclxuXHJcblx0XHRcdFx0XHRpZiAodGhpcy5fX3ByZXYgJiYgdGhpcy5fX3ByZXYuX19wb3MgIT0gdW5kZWZpbmVkICYmIHRoaXMuZ2V0U3BlZWQoKSkge1xyXG5cdFx0XHRcdFx0XHQvLyB3aGF0IGlzIHRoZSBkaWZmZXJlbmNlIGJldHdlZW4gY3VycmVudCBvbmUgYW5kIHRoZSBvbmUgYmVmb3JlIC0gd2Ugd2lsbCBydW4gc28gb3VyIHNwZWVkXHJcblx0XHRcdFx0XHRcdC8vIHdoYXQgdGltZSB3ZSBhcmUgc2hvcnQgLSBzbyB3aWxsIGFkZCBhIG1pbnVzIGluIGZyb250IG9mIHRoZSB0aW1lXHJcblx0XHRcdFx0XHRcdHZhciBlbGFwc2VkcHJldiA9IHRoaXMuX19wcmV2LmNhbGN1bGF0ZUVsYXBzZWRBdmVyYWdlKGN0aW1lKTtcclxuXHRcdFx0XHRcdFx0dmFyIGRwcmV2ID0gKChlbGFwc2VkcHJldiAtIGVsYXBzZWQpKnRoaXMudHJhY2suZ2V0VHJhY2tMZW5ndGgoKSAvIHRoaXMuZ2V0U3BlZWQoKSkvNjAuMDtcclxuXHRcdFx0XHRcdFx0ZHByZXYgPSBwYXJzZUZsb2F0KE1hdGgucm91bmQoZHByZXYgKiAxMDApIC8gMTAwKS50b0ZpeGVkKDIpO1xyXG5cdFx0XHRcdFx0XHRodG1sKz1cIjxkaXYgY2xhc3M9J3BvcHVwX2NvbnRlbnRfbDInPkdBUCBQXCIrKHRoaXMuX19wcmV2Ll9fcG9zICsgMSkrXCIgOiAtXCIrZHByZXYrXCIgTWluPC9kaXY+XCI7XHJcblx0XHRcdFx0XHR9IGVsc2Uge1xyXG5cdFx0XHRcdFx0XHRodG1sKz1cIjxkaXYgY2xhc3M9J3BvcHVwX2NvbnRlbnRfbDInPiZuYnNwOzwvZGl2PlwiO1xyXG5cdFx0XHRcdFx0fVxyXG5cclxuXHRcdFx0XHRcdGlmICh0aGlzLl9fbmV4dCAmJiB0aGlzLl9fbmV4dC5fX3BvcyAhPSB1bmRlZmluZWQgJiYgdGhpcy5fX25leHQuZ2V0U3BlZWQoKSkge1xyXG5cdFx0XHRcdFx0XHQvLyB3aGF0IGlzIHRoZSBkaWZmZXJlbmNlIGJldHdlZW4gY3VycmVudCBvbmUgYW5kIHRoZSBvbmUgYmVoaW5kIC0gdGhpcyBvdGhlciBvbmUgd2lsbCBydW4gc28gaGlzIHNwZWVkXHJcblx0XHRcdFx0XHRcdC8vIHdhaHQgdGltZSB3ZSBhcmUgYWhlYWQgLSBzbyBhIHBvc2l0aXZlIHRpbWVcclxuXHRcdFx0XHRcdFx0dmFyIGVsYXBzZWRuZXh0ID0gdGhpcy5fX25leHQuY2FsY3VsYXRlRWxhcHNlZEF2ZXJhZ2UoY3RpbWUpO1xyXG5cdFx0XHRcdFx0XHR2YXIgZG5leHQgPSAoKGVsYXBzZWQgLSBlbGFwc2VkbmV4dCkqdGhpcy50cmFjay5nZXRUcmFja0xlbmd0aCgpIC8gdGhpcy5fX25leHQuZ2V0U3BlZWQoKSkvNjAuMDtcclxuXHRcdFx0XHRcdFx0ZG5leHQgPSBwYXJzZUZsb2F0KE1hdGgucm91bmQoZG5leHQgKiAxMDApIC8gMTAwKS50b0ZpeGVkKDIpO1xyXG5cdFx0XHRcdFx0XHRodG1sKz1cIjxkaXYgY2xhc3M9J3BvcHVwX2NvbnRlbnRfbDMnPkdBUCBQXCIrKHRoaXMuX19uZXh0Ll9fcG9zICsgMSkrXCIgOiBcIitkbmV4dCtcIiBNaW48L2Rpdj5cIjtcclxuXHRcdFx0XHRcdH0gZWxzZSB7XHJcblx0XHRcdFx0XHRcdGh0bWwrPVwiPGRpdiBjbGFzcz0ncG9wdXBfY29udGVudF9sMic+Jm5ic3A7PC9kaXY+XCI7XHJcblx0XHRcdFx0XHR9XHJcblx0XHRcdFx0fVxyXG5cdFx0XHR9IGVsc2Uge1xyXG5cdFx0XHRcdGh0bWwrPVwiPGRpdiBjbGFzcz0ncG9wdXBfY29udGVudF9sMic+TU9SRSBUTyAgXCIrdHBhcnRNb3JlK1wiOiBcIisoaXNEdW1teSA/IFwiLVwiIDogcGFyc2VGbG9hdChNYXRoLnJvdW5kKCh0YXJnZXRLTS1lbGttKSAqIDEwMCkgLyAxMDApLnRvRml4ZWQoMikgLyogcmVrbSAqLyArXCIga21cIikrXCI8L2Rpdj5cIjtcclxuXHRcdFx0XHRodG1sKz1cIjxkaXYgY2xhc3M9J3BvcHVwX2NvbnRlbnRfbDMnPkZJTklTSCBcIisgdHBhcnRzICtcIjogXCIrKCFlc3RmID8gXCItXCIgOiBlc3RmKStcIjwvZGl2PlwiO1xyXG5cdFx0XHR9XHJcblx0XHRcdGh0bWwrPVwiPC9kaXY+XCI7XHJcblx0XHRcdHJldHVybiBodG1sO1xyXG5cdFx0fVxyXG5cdFx0XHJcblx0XHRcclxuICAgIH1cclxufSk7XHJcbiIsInJlcXVpcmUoJ2pvb3NlJyk7XHJcblxyXG5DbGFzcyhcIlBvaW50XCIsIHtcclxuICAgIC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuICAgIC8vIEFMTCBDT09SRElOQVRFUyBBUkUgSU4gV09STEQgTUVSQ0FUT1JcclxuICAgIC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHJcbiAgICBoYXMgOiB7XHJcbiAgICAgICAgY29kZSA6IHtcclxuICAgICAgICAgICAgaXMgOiBcInJ3XCIsXHJcbiAgICAgICAgICAgIGluaXQgOiBcIkNPREVfTk9UX1NFVFwiXHJcbiAgICAgICAgfSxcclxuICAgICAgICBpZCA6IHtcclxuICAgICAgICAgICAgaXMgOiBcInJ3XCIsXHJcbiAgICAgICAgICAgIGluaXQgOiBcIklEX05PVF9TRVRcIlxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgZmVhdHVyZSA6IHtcclxuICAgICAgICAgICAgaXMgOiBcInJ3XCIsXHJcbiAgICAgICAgICAgIGluaXQgOiBudWxsXHJcbiAgICAgICAgfSxcclxuICAgICAgICBwb3NpdGlvbiA6IHtcclxuICAgICAgICAgICAgaXM6ICAgXCJyd1wiLFxyXG4gICAgICAgICAgICBpbml0OiBbMCwwXVx0Ly9sb24gbGF0IHdvcmxkIG1lcmNhdG9yXHJcbiAgICAgICAgfVxyXG4gICAgfSxcclxuXHJcbiAgICBtZXRob2RzIDoge1xyXG4gICAgICAgIGluaXQgOiBmdW5jdGlvbihwb3MpIHtcclxuICAgICAgICAgICAgaWYgKHR5cGVvZiBvbCAhPSBcInVuZGVmaW5lZFwiKSB7XHJcbiAgICAgICAgICAgICAgICB2YXIgZ2VvbSA9IG5ldyBvbC5nZW9tLlBvaW50KHBvcyk7XHJcbiAgICAgICAgICAgICAgICBnZW9tLnRyYW5zZm9ybSgnRVBTRzo0MzI2JywgJ0VQU0c6Mzg1NycpO1xyXG4gICAgICAgICAgICAgICAgdmFyIGZlYXR1cmUgPSBuZXcgb2wuRmVhdHVyZSgpO1xyXG4gICAgICAgICAgICAgICAgZmVhdHVyZS5zZXRHZW9tZXRyeShnZW9tKTtcclxuICAgICAgICAgICAgICAgIHRoaXMuc2V0RmVhdHVyZShmZWF0dXJlKTtcclxuXHJcbiAgICAgICAgICAgICAgICB0aGlzLnNldFBvc2l0aW9uKHBvcyk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICB9XHJcbn0pOyIsInZhciBDT05GSUcgPSByZXF1aXJlKCcuL0NvbmZpZycpO1xyXG5cclxudmFyIFNUWUxFUz1cclxue1xyXG5cdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0Ly8gc3R5bGUgZnVuY3Rpb24gZm9yIHRyYWNrXHJcblx0Ly8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRcdFxyXG5cdFwiX3RyYWNrXCI6IGZ1bmN0aW9uKGZlYXR1cmUscmVzb2x1dGlvbikgXHJcblx0e1xyXG4gICAgICAgIHJldHVybiBcclxuICAgICAgICBbXHJcbiAgICAgICAgXTtcclxuXHR9LFxyXG5cclxuXHRcInRlc3RcIjogZnVuY3Rpb24oZmVhdHVyZSxyZXNvbHV0aW9uKSBcclxuXHR7XHJcblx0XHR2YXIgc3R5bGVzPVtdO1xyXG4gICAgICAgIHN0eWxlcy5wdXNoKG5ldyBvbC5zdHlsZS5TdHlsZSh7XHJcbiAgICAgICAgICAgICBzdHJva2U6IG5ldyBvbC5zdHlsZS5TdHJva2Uoe1xyXG4gICAgICAgICAgICAgICAgIGNvbG9yOiBcIiMwMDAwRkZcIixcclxuICAgICAgICAgICAgICAgICB3aWR0aDogM1xyXG4gICAgICAgICAgICAgfSlcclxuICAgICAgICAgXHR9KSk7XHJcbiAgICAgICAgcmV0dXJuIHN0eWxlcztcclxuXHR9LFxyXG5cdFwidHJhY2tcIiA6IGZ1bmN0aW9uKGZlYXR1cmUscmVzb2x1dGlvbikgXHJcblx0e1xyXG5cdFx0dmFyIHN0eWxlcz1bXTtcclxuXHRcdHZhciB0cmFjaz1mZWF0dXJlLnRyYWNrO1xyXG5cdFx0dmFyIGNvb3Jkcz1mZWF0dXJlLmdldEdlb21ldHJ5KCkuZ2V0Q29vcmRpbmF0ZXMoKTtcclxuXHRcdHZhciBnZW9tc3dpbT1jb29yZHM7XHJcblx0XHR2YXIgZ2VvbWJpa2U7XHJcblx0XHR2YXIgZ2VvbXJ1bjtcclxuXHRcdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdFx0XHJcblx0XHQvKnZhciB3dyA9IDguMC9yZXNvbHV0aW9uO1xyXG5cdFx0aWYgKHd3IDwgNi4wKVxyXG5cdFx0XHR3dz02LjA7Ki9cclxuXHRcdHZhciB3dz0xMC4wO1xyXG5cclxuXHRcdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdFx0aWYgKHRyYWNrICYmICFpc05hTih0cmFjay5iaWtlU3RhcnRLTSkpIFxyXG5cdFx0e1xyXG5cdFx0XHRmb3IgKHZhciBpPTA7aTx0cmFjay5kaXN0YW5jZXMubGVuZ3RoO2krKykge1xyXG5cdFx0XHRcdGlmICh0cmFjay5kaXN0YW5jZXNbaV0gPj0gdHJhY2suYmlrZVN0YXJ0S00qMTAwMClcclxuXHRcdFx0XHRcdGJyZWFrO1xyXG5cdFx0XHR9XHJcblx0XHRcdHZhciBqO1xyXG5cdFx0XHRpZiAoIWlzTmFOKHRyYWNrLnJ1blN0YXJ0S00pKSB7XHJcblx0XHRcdFx0Zm9yIChqPWk7ajx0cmFjay5kaXN0YW5jZXMubGVuZ3RoO2orKykge1xyXG5cdFx0XHRcdFx0aWYgKHRyYWNrLmRpc3RhbmNlc1tqXSA+PSB0cmFjay5ydW5TdGFydEtNKjEwMDApXHJcblx0XHRcdFx0XHRcdGJyZWFrO1xyXG5cdFx0XHRcdH1cclxuXHRcdFx0fSBlbHNlIHtcclxuXHRcdFx0XHRqPXRyYWNrLmRpc3RhbmNlcy5sZW5ndGg7XHJcblx0XHRcdH1cclxuXHRcdFx0Z2VvbXN3aW09Y29vcmRzLnNsaWNlKDAsaSk7XHJcblx0XHRcdGdlb21iaWtlPWNvb3Jkcy5zbGljZShpIDwgMSA/IGkgOiBpLTEsaik7XHJcblx0XHRcdGlmIChqIDwgdHJhY2suZGlzdGFuY2VzLmxlbmd0aClcclxuXHRcdFx0XHRnZW9tcnVuPWNvb3Jkcy5zbGljZShqIDwgMSA/IGogOiBqLTEsdHJhY2suZGlzdGFuY2VzLmxlbmd0aCk7XHJcblx0XHRcdGlmICghZ2VvbXN3aW0ubGVuZ3RoKVxyXG5cdFx0XHRcdGdlb21zd2ltPW51bGw7XHJcblx0XHRcdGlmICghZ2VvbWJpa2UubGVuZ3RoKVxyXG5cdFx0XHRcdGdlb21iaWtlPW51bGw7XHJcblx0XHRcdGlmICghZ2VvbXJ1bi5sZW5ndGgpXHJcbiAgICAgICAgICAgICAgICBnZW9tcnVuPW51bGw7XHJcblx0XHR9XHJcblxyXG5cclxuICAgICAgICBpZiAoZ2VvbXN3aW0gJiYgR1VJLmlzU2hvd1N3aW0pIHtcclxuICAgICAgICAgICAgc3R5bGVzLnB1c2gobmV3IG9sLnN0eWxlLlN0eWxlKHtcclxuICAgICAgICAgICAgICAgICAgICBnZW9tZXRyeTogbmV3IG9sLmdlb20uTGluZVN0cmluZyhnZW9tc3dpbSksXHJcbiAgICAgICAgICAgICAgICAgICAgc3Ryb2tlOiBuZXcgb2wuc3R5bGUuU3Ryb2tlKHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29sb3I6IENPTkZJRy5hcHBlYXJhbmNlLnRyYWNrQ29sb3JTd2ltLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICB3aWR0aDogd3dcclxuICAgICAgICAgICAgICAgICAgICB9KVxyXG4gICAgICAgICAgICAgICAgfSlcclxuICAgICAgICAgICAgKTtcclxuICAgICAgICAgICAgU1RZTEVTLl9nZW5EaXJlY3Rpb24oZ2VvbXN3aW0sIHd3LCByZXNvbHV0aW9uLCBDT05GSUcuYXBwZWFyYW5jZS50cmFja0NvbG9yU3dpbSwgc3R5bGVzKTtcclxuXHJcbiAgICAgICAgICAgIFNUWUxFUy5fZ2VuRGlzdGFuY2VLbSh3dywgcmVzb2x1dGlvbiwgY29vcmRzLCB0cmFjay5kaXN0YW5jZXMsIDAsIGksIHN0eWxlcyk7XHJcblxyXG5cdFx0XHQvLyBmb3Igbm93IGRvbid0IHNob3cgdGhpcyBjaGVja3BvaW50XHJcblx0XHRcdC8vaWYgKEdVSS5pc1Nob3dTd2ltKVxyXG5cdFx0XHQvL1x0U1RZTEVTLl9nZW5DaGVja3BvaW50KGdlb21zd2ltLCBDT05GSUcuYXBwZWFyYW5jZS50cmFja0NvbG9yU3dpbSwgc3R5bGVzKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgaWYgKGdlb21iaWtlICYmIEdVSS5pc1Nob3dCaWtlKVxyXG4gICAgICAgIHtcclxuICAgICAgICAgICAgc3R5bGVzLnB1c2gobmV3IG9sLnN0eWxlLlN0eWxlKHtcclxuICAgICAgICAgICAgICAgICAgICBnZW9tZXRyeTogbmV3IG9sLmdlb20uTGluZVN0cmluZyhnZW9tYmlrZSksXHJcbiAgICAgICAgICAgICAgICAgICAgc3Ryb2tlOiBuZXcgb2wuc3R5bGUuU3Ryb2tlKHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29sb3I6IENPTkZJRy5hcHBlYXJhbmNlLnRyYWNrQ29sb3JCaWtlLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICB3aWR0aDogd3dcclxuICAgICAgICAgICAgICAgICAgICB9KVxyXG4gICAgICAgICAgICAgICAgfSlcclxuICAgICAgICAgICAgKTtcclxuICAgICAgICAgICAgU1RZTEVTLl9nZW5EaXJlY3Rpb24oZ2VvbWJpa2UsIHd3LCByZXNvbHV0aW9uLCBDT05GSUcuYXBwZWFyYW5jZS50cmFja0NvbG9yQmlrZSwgc3R5bGVzKTtcclxuXHJcbiAgICAgICAgICAgIFNUWUxFUy5fZ2VuRGlzdGFuY2VLbSh3dywgcmVzb2x1dGlvbiwgY29vcmRzLCB0cmFjay5kaXN0YW5jZXMsIGksIGosIHN0eWxlcyk7XHJcblxyXG5cdFx0XHQvLyBhZGQgY2hlY2twb2ludCBpZiB0aGlzIGlzIG5vdCBhbHJlYWR5IGFkZGVkIGFzIGEgaG90c3BvdFxyXG5cdFx0XHRpZiAoIXRyYWNrLmlzQWRkZWRIb3RTcG90U3dpbUJpa2UpIHtcclxuXHRcdFx0XHRpZiAoQ09ORklHLmFwcGVhcmFuY2UuaXNTaG93SW1hZ2VDaGVja3BvaW50KVxyXG5cdFx0XHRcdFx0U1RZTEVTLl9nZW5DaGVja3BvaW50SW1hZ2UoZ2VvbWJpa2UsIENPTkZJRy5hcHBlYXJhbmNlLmltYWdlQ2hlY2twb2ludFN3aW1CaWtlLCBzdHlsZXMpO1xyXG5cdFx0XHRcdGVsc2UgaWYgKEdVSS5pc1Nob3dCaWtlKVxyXG5cdFx0XHRcdFx0U1RZTEVTLl9nZW5DaGVja3BvaW50KGdlb21iaWtlLCBDT05GSUcuYXBwZWFyYW5jZS50cmFja0NvbG9yQmlrZSwgc3R5bGVzKTtcclxuXHRcdFx0fVxyXG4gICAgICAgIH1cclxuXHRcdGlmIChnZW9tcnVuICYmIEdVSS5pc1Nob3dSdW4pXHJcblx0XHR7XHJcblx0XHRcdHN0eWxlcy5wdXNoKG5ldyBvbC5zdHlsZS5TdHlsZSh7XHJcbiAgICAgICAgICAgICAgICAgICAgZ2VvbWV0cnk6IG5ldyBvbC5nZW9tLkxpbmVTdHJpbmcoZ2VvbXJ1biksXHJcbiAgICAgICAgICAgICAgICAgICAgc3Ryb2tlOiBuZXcgb2wuc3R5bGUuU3Ryb2tlKHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29sb3I6IENPTkZJRy5hcHBlYXJhbmNlLnRyYWNrQ29sb3JSdW4sXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHdpZHRoOiB3d1xyXG4gICAgICAgICAgICAgICAgICAgIH0pXHJcbiAgICAgICAgICAgICAgICB9KVxyXG4gICAgICAgICAgICApO1xyXG4gICAgICAgICAgICBTVFlMRVMuX2dlbkRpcmVjdGlvbihnZW9tcnVuLCB3dywgcmVzb2x1dGlvbiwgQ09ORklHLmFwcGVhcmFuY2UudHJhY2tDb2xvclJ1biwgc3R5bGVzKTtcclxuXHJcbiAgICAgICAgICAgIFNUWUxFUy5fZ2VuRGlzdGFuY2VLbSh3dywgcmVzb2x1dGlvbiwgY29vcmRzLCB0cmFjay5kaXN0YW5jZXMsIGosIHRyYWNrLmRpc3RhbmNlcy5sZW5ndGgsIHN0eWxlcyk7XHJcblxyXG5cdFx0XHQvLyBhZGQgY2hlY2twb2ludCBpZiB0aGlzIGlzIG5vdCBhbHJlYWR5IGFkZGVkIGFzIGEgaG90c3BvdFxyXG5cdFx0XHRpZiAoIXRyYWNrLmlzQWRkZWRIb3RTcG90QmlrZVJ1bikge1xyXG5cdFx0XHRcdGlmIChDT05GSUcuYXBwZWFyYW5jZS5pc1Nob3dJbWFnZUNoZWNrcG9pbnQpXHJcblx0XHRcdFx0XHRTVFlMRVMuX2dlbkNoZWNrcG9pbnRJbWFnZShnZW9tcnVuLCBDT05GSUcuYXBwZWFyYW5jZS5pbWFnZUNoZWNrcG9pbnRCaWtlUnVuLCBzdHlsZXMpO1xyXG5cdFx0XHRcdGVsc2UgaWYgKEdVSS5pc1Nob3dCaWtlKVxyXG5cdFx0XHRcdFx0U1RZTEVTLl9nZW5DaGVja3BvaW50KGdlb21ydW4sIENPTkZJRy5hcHBlYXJhbmNlLnRyYWNrQ29sb3JSdW4sIHN0eWxlcyk7XHJcblx0XHRcdH1cclxuICAgICAgICB9XHJcblxyXG5cdFx0Ly8gU1RBUlQtRklOSVNIIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0XHRpZiAoY29vcmRzICYmIGNvb3Jkcy5sZW5ndGggPj0gMilcclxuXHRcdHtcclxuXHRcdFx0dmFyIHN0YXJ0ID0gY29vcmRzWzBdO1xyXG5cdFx0XHR2YXIgZW5kID0gY29vcmRzWzFdO1xyXG5cdFx0XHQvKnZhciBkeCA9IGVuZFswXSAtIHN0YXJ0WzBdO1xyXG5cdFx0XHQgdmFyIGR5ID0gZW5kWzFdIC0gc3RhcnRbMV07XHJcblx0XHRcdCB2YXIgcm90YXRpb24gPSBNYXRoLmF0YW4yKGR5LCBkeCk7XHJcblx0XHRcdCBzdHlsZXMucHVzaChuZXcgb2wuc3R5bGUuU3R5bGUoXHJcblx0XHRcdCB7XHJcblx0XHRcdCBnZW9tZXRyeTogbmV3IG9sLmdlb20uUG9pbnQoc3RhcnQpLFxyXG5cdFx0XHQgaW1hZ2U6IG5ldyBvbC5zdHlsZS5JY29uKHtcclxuXHRcdFx0IHNyYzogJ2ltZy9iZWdpbi1lbmQtYXJyb3cucG5nJyxcclxuXHRcdFx0IHNjYWxlIDogMC40NSxcclxuXHRcdFx0IGFuY2hvcjogWzAuMCwgMC41XSxcclxuXHRcdFx0IHJvdGF0ZVdpdGhWaWV3OiB0cnVlLFxyXG5cdFx0XHQgcm90YXRpb246IC1yb3RhdGlvbixcclxuXHRcdFx0IG9wYWNpdHkgOiAxXHJcblx0XHRcdCB9KVxyXG5cdFx0XHQgfSkpOyovXHJcblxyXG5cdFx0XHQvLyBsb29wP1xyXG5cdFx0XHRlbmQgPSBjb29yZHNbY29vcmRzLmxlbmd0aC0xXTtcclxuXHRcdFx0aWYgKGVuZFswXSAhPSBzdGFydFswXSB8fCBlbmRbMV0gIT0gc3RhcnRbMV0pXHJcblx0XHRcdHtcclxuXHRcdFx0XHR2YXIgc3RhcnQgPSBjb29yZHNbY29vcmRzLmxlbmd0aC0yXTtcclxuXHRcdFx0XHR2YXIgZHggPSBlbmRbMF0gLSBzdGFydFswXTtcclxuXHRcdFx0XHR2YXIgZHkgPSBlbmRbMV0gLSBzdGFydFsxXTtcclxuXHRcdFx0XHR2YXIgcm90YXRpb24gPSBNYXRoLmF0YW4yKGR5LCBkeCk7XHJcblx0XHRcdFx0c3R5bGVzLnB1c2gobmV3IG9sLnN0eWxlLlN0eWxlKFxyXG5cdFx0XHRcdFx0e1xyXG5cdFx0XHRcdFx0XHRnZW9tZXRyeTogbmV3IG9sLmdlb20uUG9pbnQoZW5kKSxcclxuXHRcdFx0XHRcdFx0aW1hZ2U6IG5ldyBvbC5zdHlsZS5JY29uKHtcclxuXHRcdFx0XHRcdFx0XHRzcmM6IENPTkZJRy5hcHBlYXJhbmNlLmltYWdlRmluaXNoLFxyXG5cdFx0XHRcdFx0XHRcdHNjYWxlIDogMC40NSxcclxuXHRcdFx0XHRcdFx0XHRhbmNob3I6IFswLjUsIDAuNV0sXHJcblx0XHRcdFx0XHRcdFx0cm90YXRlV2l0aFZpZXc6IHRydWUsXHJcblx0XHRcdFx0XHRcdFx0Ly9yb3RhdGlvbjogLXJvdGF0aW9uLFxyXG5cdFx0XHRcdFx0XHRcdG9wYWNpdHkgOiAxXHJcblx0XHRcdFx0XHRcdH0pXHJcblx0XHRcdFx0XHR9KSk7XHJcblx0XHRcdH1cclxuXHRcdH1cclxuXHJcblx0XHRyZXR1cm4gc3R5bGVzO1xyXG5cdH0sXHJcblx0Ly8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdFwiZGVidWdHUFNcIiA6IGZ1bmN0aW9uKGZlYXR1cmUscmVzb2x1dGlvbikgXHJcblx0e1xyXG5cdFx0dmFyIGNvZWYgPSAoKG5ldyBEYXRlKCkpLmdldFRpbWUoKS1mZWF0dXJlLnRpbWVDcmVhdGVkKS8oQ09ORklHLnRpbWVvdXRzLmdwc0xvY2F0aW9uRGVidWdTaG93KjEwMDApO1xyXG5cdFx0aWYgKGNvZWYgPiAxKVxyXG5cdFx0XHRyZXR1cm4gW107XHJcblx0XHRyZXR1cm4gW1xyXG5cdFx0ICAgICAgICBuZXcgb2wuc3R5bGUuU3R5bGUoe1xyXG5cdFx0ICAgICAgICBpbWFnZTogbmV3IG9sLnN0eWxlLkNpcmNsZSh7XHJcblx0XHQgICAgICAgICAgICByYWRpdXM6IGNvZWYqMjAsXHJcblx0XHQgICAgICAgICAgICBzdHJva2U6IG5ldyBvbC5zdHlsZS5TdHJva2Uoe1xyXG5cdFx0ICAgICAgICAgICAgXHQvL2ZlYXR1cmUuY29sb3JcclxuXHRcdCAgICAgICAgICAgICAgICBjb2xvcjogY29sb3JBbHBoYUFycmF5KGZlYXR1cmUuY29sb3IsKDEuMC1jb2VmKSoxLjApLCBcclxuXHRcdCAgICAgICAgICAgICAgICB3aWR0aDogNFxyXG5cdFx0ICAgICAgICAgICAgfSlcclxuXHRcdCAgICAgICAgICB9KVxyXG5cdFx0fSldO1xyXG5cdH0sXHJcblx0XHJcblx0XCJwYXJ0aWNpcGFudFwiIDogZnVuY3Rpb24oZmVhdHVyZSxyZXNvbHV0aW9uKSBcclxuXHR7XHJcblx0XHQvLyBTS0lQIERSQVcgKFRPRE8gT1BUSU1JWkUpXHJcblx0XHR2YXIgcGFydCA9IGZlYXR1cmUucGFydGljaXBhbnQ7XHJcblx0XHRpZiAoIXBhcnQuaXNGYXZvcml0ZSlcclxuXHRcdFx0cmV0dXJuIFtdO1xyXG5cdFx0XHJcblx0XHR2YXIgZXR4dD1cIlwiO1xyXG5cdFx0dmFyIGxzdGF0ZSA9IG51bGw7XHJcblx0XHRpZiAocGFydC5zdGF0ZXMubGVuZ3RoKSB7XHJcblx0XHRcdGxzdGF0ZSA9IHBhcnQuc3RhdGVzW3BhcnQuc3RhdGVzLmxlbmd0aC0xXTtcclxuXHRcdFx0ZXR4dD1cIiBcIitwYXJzZUZsb2F0KE1hdGguY2VpbChsc3RhdGUuZ2V0U3BlZWQoKSAqIDEwMCkgLyAxMDApLnRvRml4ZWQoMikrXCIgbS9zXCI7Ly8gfCBhY2MgXCIrcGFyc2VGbG9hdChNYXRoLmNlaWwobHN0YXRlLmdldEFjY2VsZXJhdGlvbigpICogMTAwKSAvIDEwMCkudG9GaXhlZCgyKStcIiBtL3NcIjtcclxuXHRcdH1cclxuXHRcdHZhciB6SW5kZXggPSBNYXRoLnJvdW5kKHBhcnQuZ2V0RWxhcHNlZCgpKjEwMDAwMDApKjEwMDArcGFydC5zZXFJZDtcclxuXHRcdC8qaWYgKHBhcnQgPT0gR1VJLmdldFNlbGVjdGVkUGFydGljaXBhbnQoKSkge1xyXG5cdFx0XHR6SW5kZXg9MWUyMDtcclxuXHRcdH0qL1xyXG5cdFx0dmFyIHN0eWxlcz1bXTtcclxuXHRcdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRcdHZhciBjdGltZSA9IChuZXcgRGF0ZSgpKS5nZXRUaW1lKCk7XHJcblx0XHR2YXIgaXNUaW1lID0gKGN0aW1lID49IENPTkZJRy50aW1lcy5iZWdpbiAmJiBjdGltZSA8PSBDT05GSUcudGltZXMuZW5kKTtcclxuXHRcdHZhciBpc0RpcmVjdGlvbiA9IChsc3RhdGUgJiYgbHN0YXRlLmdldFNwZWVkKCkgPiAwICYmICFwYXJ0LmlzU09TICYmICFwYXJ0LmlzRGlzY2FyZGVkICYmIGlzVGltZSk7XHJcblx0XHR2YXIgYW5pbUZyYW1lID0gKGN0aW1lJTMwMDApKk1hdGguUEkqMi8zMDAwLjA7XHJcblxyXG4gICAgICAgIGlmIChpc1RpbWUpIHtcclxuICAgICAgICAgICAgc3R5bGVzLnB1c2gobmV3IG9sLnN0eWxlLlN0eWxlKHtcclxuICAgICAgICAgICAgICAgIHpJbmRleDogekluZGV4LFxyXG4gICAgICAgICAgICAgICAgaW1hZ2U6IG5ldyBvbC5zdHlsZS5DaXJjbGUoe1xyXG4gICAgICAgICAgICAgICAgICAgIHJhZGl1czogMTcsXHJcbiAgICAgICAgICAgICAgICAgICAgZmlsbDogbmV3IG9sLnN0eWxlLkZpbGwoe1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb2xvcjogcGFydC5pc0Rpc2NhcmRlZCB8fCBwYXJ0LmlzU09TID8gXCJyZ2JhKDE5MiwwLDAsXCIgKyAoTWF0aC5zaW4oYW5pbUZyYW1lKSAqIDAuNyArIDAuMykgKyBcIilcIiA6IFwicmdiYShcIiArIGNvbG9yQWxwaGFBcnJheShwYXJ0LmNvbG9yLCAwLjg1KS5qb2luKFwiLFwiKSArIFwiKVwiXHJcbiAgICAgICAgICAgICAgICAgICAgfSksXHJcbiAgICAgICAgICAgICAgICAgICAgc3Ryb2tlOiBuZXcgb2wuc3R5bGUuU3Ryb2tlKHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29sb3I6IHBhcnQuaXNEaXNjYXJkZWQgfHwgcGFydC5pc1NPUyA/IFwicmdiYSgyNTUsMCwwLFwiICsgKDEuMCAtIChNYXRoLnNpbihhbmltRnJhbWUpICogMC43ICsgMC4zKSkgKyBcIilcIiA6IFwiI2ZmZmZmZlwiLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICB3aWR0aDogM1xyXG4gICAgICAgICAgICAgICAgICAgIH0pXHJcbiAgICAgICAgICAgICAgICB9KSxcclxuICAgICAgICAgICAgICAgIHRleHQ6IG5ldyBvbC5zdHlsZS5UZXh0KHtcclxuICAgICAgICAgICAgICAgICAgICBmb250OiAnbm9ybWFsIDEzcHggTGF0by1SZWd1bGFyJyxcclxuICAgICAgICAgICAgICAgICAgICBmaWxsOiBuZXcgb2wuc3R5bGUuRmlsbCh7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbG9yOiAnI0ZGRkZGRidcclxuICAgICAgICAgICAgICAgICAgICB9KSxcclxuICAgICAgICAgICAgICAgICAgICB0ZXh0OiBwYXJ0LmdldEluaXRpYWxzKCksXHJcbiAgICAgICAgICAgICAgICAgICAgb2Zmc2V0WDogMCxcclxuICAgICAgICAgICAgICAgICAgICBvZmZzZXRZOiAwXHJcbiAgICAgICAgICAgICAgICB9KVxyXG4gICAgICAgICAgICB9KSk7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgc3R5bGVzLnB1c2gobmV3IG9sLnN0eWxlLlN0eWxlKHtcclxuICAgICAgICAgICAgICAgIHpJbmRleDogekluZGV4LFxyXG4gICAgICAgICAgICAgICAgaW1hZ2U6IG5ldyBvbC5zdHlsZS5DaXJjbGUoe1xyXG4gICAgICAgICAgICAgICAgICAgIHJhZGl1czogMTcsXHJcbiAgICAgICAgICAgICAgICAgICAgZmlsbDogbmV3IG9sLnN0eWxlLkZpbGwoe1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb2xvcjogXCJyZ2JhKFwiICsgY29sb3JBbHBoYUFycmF5KHBhcnQuY29sb3IsIDAuMzUpLmpvaW4oXCIsXCIpICsgXCIpXCJcclxuICAgICAgICAgICAgICAgICAgICB9KSxcclxuICAgICAgICAgICAgICAgICAgICBzdHJva2U6IG5ldyBvbC5zdHlsZS5TdHJva2Uoe1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb2xvcjogXCJyZ2JhKDI1NSwyNTUsMjU1LDEpXCIsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHdpZHRoOiAzXHJcbiAgICAgICAgICAgICAgICAgICAgfSlcclxuICAgICAgICAgICAgICAgIH0pLFxyXG4gICAgICAgICAgICAgICAgdGV4dDogbmV3IG9sLnN0eWxlLlRleHQoe1xyXG4gICAgICAgICAgICAgICAgICAgIGZvbnQ6ICdub3JtYWwgMTNweCBMYXRvLVJlZ3VsYXInLFxyXG4gICAgICAgICAgICAgICAgICAgIGZpbGw6IG5ldyBvbC5zdHlsZS5GaWxsKHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29sb3I6ICcjMDAwMDAwJ1xyXG4gICAgICAgICAgICAgICAgICAgIH0pLFxyXG4gICAgICAgICAgICAgICAgICAgIHRleHQ6IHBhcnQuZ2V0RGV2aWNlSWQoKSxcclxuICAgICAgICAgICAgICAgICAgICBvZmZzZXRYOiAwLFxyXG4gICAgICAgICAgICAgICAgICAgIG9mZnNldFk6IDIwXHJcbiAgICAgICAgICAgICAgICB9KVxyXG4gICAgICAgICAgICB9KSk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuICAgICAgICBzdHlsZXMucHVzaChuZXcgb2wuc3R5bGUuU3R5bGUoe1xyXG4gICAgICAgICAgICB6SW5kZXg6IHpJbmRleCxcclxuICAgICAgICAgICAgaW1hZ2U6IG5ldyBvbC5zdHlsZS5DaXJjbGUoe1xyXG4gICAgICAgICAgICAgICAgcmFkaXVzOiAxNyxcclxuICAgICAgICAgICAgICAgIGZpbGw6IG5ldyBvbC5zdHlsZS5GaWxsKHtcclxuICAgICAgICAgICAgICAgICAgICBjb2xvcjogcGFydC5pc0Rpc2NhcmRlZCB8fCBwYXJ0LmlzU09TID8gXCJyZ2JhKDE5MiwwLDAsXCIgKyAoTWF0aC5zaW4oYW5pbUZyYW1lKSAqIDAuNyArIDAuMykgKyBcIilcIiA6IFwicmdiYShcIiArIGNvbG9yQWxwaGFBcnJheShwYXJ0LmNvbG9yLCAwLjg1KS5qb2luKFwiLFwiKSArIFwiKVwiXHJcbiAgICAgICAgICAgICAgICB9KSxcclxuICAgICAgICAgICAgICAgIHN0cm9rZTogbmV3IG9sLnN0eWxlLlN0cm9rZSh7XHJcbiAgICAgICAgICAgICAgICAgICAgY29sb3I6IHBhcnQuaXNEaXNjYXJkZWQgfHwgcGFydC5pc1NPUyA/IFwicmdiYSgyNTUsMCwwLFwiICsgKDEuMCAtIChNYXRoLnNpbihhbmltRnJhbWUpICogMC43ICsgMC4zKSkgKyBcIilcIiA6IFwiI2ZmZmZmZlwiLFxyXG4gICAgICAgICAgICAgICAgICAgIHdpZHRoOiAzXHJcbiAgICAgICAgICAgICAgICB9KVxyXG4gICAgICAgICAgICB9KSxcclxuICAgICAgICAgICAgdGV4dDogbmV3IG9sLnN0eWxlLlRleHQoe1xyXG4gICAgICAgICAgICAgICAgZm9udDogJ25vcm1hbCAxM3B4IExhdG8tUmVndWxhcicsXHJcbiAgICAgICAgICAgICAgICBmaWxsOiBuZXcgb2wuc3R5bGUuRmlsbCh7XHJcbiAgICAgICAgICAgICAgICAgICAgY29sb3I6ICcjRkZGRkZGJ1xyXG4gICAgICAgICAgICAgICAgfSksXHJcbiAgICAgICAgICAgICAgICB0ZXh0OiBwYXJ0LmdldEluaXRpYWxzKCksXHJcbiAgICAgICAgICAgICAgICBvZmZzZXRYOiAwLFxyXG4gICAgICAgICAgICAgICAgb2Zmc2V0WTogMFxyXG4gICAgICAgICAgICB9KVxyXG4gICAgICAgIH0pKTtcclxuXHJcblxyXG4gICAgICAgIGlmIChpc0RpcmVjdGlvbiAmJiBwYXJ0LmdldFJvdGF0aW9uKCkgIT0gbnVsbClcclxuICAgICAgICB7XHJcbiAgICAgICAgICAgIHN0eWxlcy5wdXNoKG5ldyBvbC5zdHlsZS5TdHlsZSh7XHJcbiAgICAgICAgICAgICAgICB6SW5kZXg6IHpJbmRleCxcclxuICAgICAgICAgICAgICAgIGltYWdlOiBuZXcgb2wuc3R5bGUuSWNvbigoe1xyXG4gICAgICAgICAgICAgICAgICAgIGFuY2hvcjogWy0wLjUsMC41XSxcclxuICAgICAgICAgICAgICAgICAgICBhbmNob3JYVW5pdHM6ICdmcmFjdGlvbicsXHJcbiAgICAgICAgICAgICAgICAgICAgYW5jaG9yWVVuaXRzOiAnZnJhY3Rpb24nLFxyXG4gICAgICAgICAgICAgICAgICAgIG9wYWNpdHk6IDEsXHJcbiAgICAgICAgICAgICAgICAgICAgc3JjIDogcmVuZGVyQXJyb3dCYXNlNjQoNDgsNDgscGFydC5jb2xvciksXHJcblx0XHRcdFx0XHQgIHNjYWxlIDogMC41NSxcclxuXHRcdFx0XHRcdCAgcm90YXRpb24gOiAtcGFydC5nZXRSb3RhdGlvbigpXHJcblx0XHRcdFx0ICAgfSkpXHJcblx0XHRcdH0pKTtcclxuXHRcdH1cclxuICAgICAgICBcclxuXHRcdC8qdmFyIGNvZWYgPSBwYXJ0LnRyYWNrLmdldFRyYWNrTGVuZ3RoSW5XR1M4NCgpL3BhcnQudHJhY2suZ2V0VHJhY2tMZW5ndGgoKTtcdFx0XHJcblx0XHR2YXIgcnIgPSBDT05GSUcubWF0aC5ncHNJbmFjY3VyYWN5KmNvZWY7XHRcdFxyXG4gICAgICAgIHN0eWxlcy5wdXNoKG5ldyBvbC5zdHlsZS5TdHlsZSh7XHJcbiAgICAgICAgICAgIHpJbmRleDogekluZGV4LFxyXG4gICAgICAgICAgICBpbWFnZTogbmV3IG9sLnN0eWxlLkNpcmNsZSh7XHJcbiAgICAgICAgICAgIFx0Z2VvbWV0cnk6IG5ldyBvbC5nZW9tLlBvaW50KHBhcnQuZ2V0R1BTKCkpLFxyXG4gICAgICAgICAgICAgICAgcmFkaXVzOiAxMCwgLy9yciAqIHJlc29sdXRpb24sXHJcbiAgICAgICAgICAgICAgICBmaWxsOiBuZXcgb2wuc3R5bGUuRmlsbCh7XHJcbiAgICAgICAgICAgICAgICAgICAgY29sb3I6IFwicmdiYSgyNTUsMjU1LDI1NSwwLjgpXCJcclxuICAgICAgICAgICAgICAgIH0pLFxyXG4gICAgICAgICAgICAgICAgc3Ryb2tlOiBuZXcgb2wuc3R5bGUuU3Ryb2tlKHtcclxuICAgICAgICAgICAgICAgICAgICBjb2xvcjogXCJyZ2JhKDAsMCwwLDEpXCIsXHJcbiAgICAgICAgICAgICAgICAgICAgd2lkdGg6IDFcclxuICAgICAgICAgICAgICAgIH0pXHJcbiAgICAgICAgICAgIH0pXHJcbiAgICAgICAgfSkpOyovXHJcblx0XHRyZXR1cm4gc3R5bGVzO1xyXG5cdH0sXHJcblxyXG5cdFwiY2FtXCIgOiBmdW5jdGlvbihmZWF0dXJlLCByZXNvbHV0aW9uKSB7XHJcblx0XHR2YXIgc3R5bGVzPVtdO1xyXG5cclxuXHRcdHZhciBjYW0gPSBmZWF0dXJlLmNhbTtcclxuXHJcblx0XHRzdHlsZXMucHVzaChuZXcgb2wuc3R5bGUuU3R5bGUoe1xyXG5cdFx0XHRpbWFnZTogbmV3IG9sLnN0eWxlLkljb24oKHtcclxuXHRcdFx0XHQvLyBUT0RPIFJ1bWVuIC0gaXQncyBiZXR0ZXIgYWxsIGltYWdlcyB0byBiZSB0aGUgc2FtZSBzaXplLCBzbyB0aGUgc2FtZSBzY2FsZVxyXG5cdFx0XHRcdHNjYWxlIDogMC4wNDAsXHJcblx0XHRcdFx0c3JjIDogQ09ORklHLmFwcGVhcmFuY2UuaW1hZ2VDYW0uc3BsaXQoXCIuc3ZnXCIpLmpvaW4oKGNhbS5zZXFJZCsxKSArIFwiLnN2Z1wiKVxyXG5cdFx0XHR9KSlcclxuXHRcdH0pKTtcclxuXHJcblx0XHRyZXR1cm4gc3R5bGVzO1xyXG5cdH0sXHJcblxyXG4gICAgXCJob3RzcG90XCIgOiBmdW5jdGlvbihmZWF0dXJlLCByZXNvbHV0aW9uKSB7XHJcbiAgICAgICAgdmFyIHN0eWxlcz1bXTtcclxuXHJcbiAgICAgICAgdmFyIGhvdHNwb3QgPSBmZWF0dXJlLmhvdHNwb3Q7XHJcblxyXG4gICAgICAgIHN0eWxlcy5wdXNoKG5ldyBvbC5zdHlsZS5TdHlsZSh7XHJcbiAgICAgICAgICAgIGltYWdlOiBuZXcgb2wuc3R5bGUuSWNvbigoe1xyXG4gICAgICAgICAgICAgICAgc2NhbGUgOiBob3RzcG90LmdldFR5cGUoKS5zY2FsZSB8fCAxLFxyXG4gICAgICAgICAgICAgICAgc3JjIDogaG90c3BvdC5nZXRUeXBlKCkuaW1hZ2VcclxuICAgICAgICAgICAgfSkpXHJcbiAgICAgICAgfSkpO1xyXG5cclxuICAgICAgICByZXR1cm4gc3R5bGVzO1xyXG4gICAgfSxcclxuXHJcblx0Ly8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHQvLyBQcml2YXRlIG1ldGhvZHNcclxuXHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cclxuXHRfdHJhY2tTZWxlY3RlZCA6IG5ldyBvbC5zdHlsZS5TdHlsZSh7XHJcblx0XHRzdHJva2U6IG5ldyBvbC5zdHlsZS5TdHJva2Uoe1xyXG5cdFx0XHRjb2xvcjogJyNGRjUwNTAnLFxyXG5cdFx0XHR3aWR0aDogNC41XHJcblx0XHR9KVxyXG5cdH0pLFxyXG5cclxuXHRfZ2VuQ2hlY2twb2ludCA6IGZ1bmN0aW9uKGdlb21ldHJ5LCBjb2xvciwgc3R5bGVzKSB7XHJcblx0XHR2YXIgc3RhcnQgPSBnZW9tZXRyeVswXTtcclxuXHRcdHZhciBlbmQgPSBnZW9tZXRyeVsxXTtcclxuXHRcdHZhciBkeCA9IGVuZFswXSAtIHN0YXJ0WzBdO1xyXG5cdFx0dmFyIGR5ID0gZW5kWzFdIC0gc3RhcnRbMV07XHJcblx0XHR2YXIgcm90YXRpb24gPSBNYXRoLmF0YW4yKGR5LCBkeCk7XHJcblxyXG5cdFx0c3R5bGVzLnB1c2gobmV3IG9sLnN0eWxlLlN0eWxlKHtcclxuXHRcdFx0Z2VvbWV0cnk6IG5ldyBvbC5nZW9tLlBvaW50KHN0YXJ0KSxcclxuXHRcdFx0aW1hZ2U6IG5ldyBvbC5zdHlsZS5JY29uKHtcclxuXHRcdFx0XHRzcmM6IHJlbmRlckJveEJhc2U2NCgxNiwxNixjb2xvciksXHJcblx0XHRcdFx0c2NhbGUgOiAxLFxyXG5cdFx0XHRcdGFuY2hvcjogWzAuOTIsIDAuNV0sXHJcblx0XHRcdFx0cm90YXRlV2l0aFZpZXc6IHRydWUsXHJcblx0XHRcdFx0cm90YXRpb246IC1yb3RhdGlvbixcclxuXHRcdFx0XHRvcGFjaXR5IDogMC42NVxyXG5cdFx0XHR9KVxyXG5cdFx0fSkpO1xyXG5cdH0sXHJcblxyXG5cdF9nZW5DaGVja3BvaW50SW1hZ2UgOiBmdW5jdGlvbihnZW9tZXRyeSwgaW1hZ2UsIHN0eWxlcykge1xyXG5cdFx0dmFyIHN0YXJ0ID0gZ2VvbWV0cnlbMF07XHJcblx0XHQvL3ZhciBlbmQgPSBnZW9tZXRyeVsxXTtcclxuXHRcdC8vdmFyIGR4ID0gZW5kWzBdIC0gc3RhcnRbMF07XHJcblx0XHQvL3ZhciBkeSA9IGVuZFsxXSAtIHN0YXJ0WzFdO1xyXG5cdFx0Ly92YXIgcm90YXRpb24gPSBNYXRoLmF0YW4yKGR5LCBkeCk7XHJcblxyXG5cdFx0c3R5bGVzLnB1c2gobmV3IG9sLnN0eWxlLlN0eWxlKHtcclxuXHRcdFx0Z2VvbWV0cnk6IG5ldyBvbC5nZW9tLlBvaW50KHN0YXJ0KSxcclxuXHRcdFx0aW1hZ2U6IG5ldyBvbC5zdHlsZS5JY29uKHtcclxuXHRcdFx0XHRzcmM6IGltYWdlLFxyXG5cdFx0XHRcdC8vc2NhbGUgOiAwLjY1LFxyXG5cdFx0XHRcdGFuY2hvcjogWzAuNSwgMC41XSxcclxuXHRcdFx0XHRyb3RhdGVXaXRoVmlldzogdHJ1ZSxcclxuXHRcdFx0XHQvL3JvdGF0aW9uOiAtcm90YXRpb24sXHJcblx0XHRcdFx0b3BhY2l0eSA6IDFcclxuXHRcdFx0fSlcclxuXHRcdH0pKTtcclxuXHR9LFxyXG5cclxuXHRfZ2VuRGlyZWN0aW9uIDogZnVuY3Rpb24ocHRzLCB3dywgcmVzb2x1dGlvbiwgY29sb3IsIHN0eWxlcykge1xyXG4gICAgICAgIGlmIChDT05GSUcuYXBwZWFyYW5jZS5kaXJlY3Rpb25JY29uQmV0d2VlbiA8PSAwKSB7XHJcbiAgICAgICAgICAgIC8vIHRoaXMgbWVhbnMgbm8gbmVlZCB0byBzaG93IHRoZSBkaXJlY3Rpb25zXHJcbiAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIHZhciBjbnQgPSAwO1xyXG4gICAgICAgIHZhciBpY24gPSByZW5kZXJEaXJlY3Rpb25CYXNlNjQoMTYsIDE2LCBjb2xvcik7XHJcbiAgICAgICAgdmFyIHJlcyA9IDAuMDtcclxuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IHB0cy5sZW5ndGggLSAxOyBpKyspIHtcclxuICAgICAgICAgICAgdmFyIHN0YXJ0ID0gcHRzW2kgKyAxXTtcclxuICAgICAgICAgICAgdmFyIGVuZCA9IHB0c1tpXTtcclxuICAgICAgICAgICAgdmFyIGR4ID0gZW5kWzBdIC0gc3RhcnRbMF07XHJcbiAgICAgICAgICAgIHZhciBkeSA9IGVuZFsxXSAtIHN0YXJ0WzFdO1xyXG4gICAgICAgICAgICB2YXIgbGVuID0gTWF0aC5zcXJ0KGR4ICogZHggKyBkeSAqIGR5KSAvIHJlc29sdXRpb247XHJcbiAgICAgICAgICAgIHJlcyArPSBsZW47XHJcbiAgICAgICAgICAgIGlmIChpID09IDAgfHwgcmVzID49IENPTkZJRy5hcHBlYXJhbmNlLmRpcmVjdGlvbkljb25CZXR3ZWVuKSB7XHJcbiAgICAgICAgICAgICAgICByZXMgPSAwO1xyXG4gICAgICAgICAgICAgICAgdmFyIHJvdGF0aW9uID0gTWF0aC5hdGFuMihkeSwgZHgpO1xyXG4gICAgICAgICAgICAgICAgc3R5bGVzLnB1c2gobmV3IG9sLnN0eWxlLlN0eWxlKHtcclxuICAgICAgICAgICAgICAgICAgICBnZW9tZXRyeTogbmV3IG9sLmdlb20uUG9pbnQoWyhzdGFydFswXSArIGVuZFswXSkgLyAyLCAoc3RhcnRbMV0gKyBlbmRbMV0pIC8gMl0pLFxyXG4gICAgICAgICAgICAgICAgICAgIGltYWdlOiBuZXcgb2wuc3R5bGUuSWNvbih7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHNyYzogaWNuLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBzY2FsZTogd3cgLyAxMi4wLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBhbmNob3I6IFswLjUsIDAuNV0sXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHJvdGF0ZVdpdGhWaWV3OiB0cnVlLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICByb3RhdGlvbjogLXJvdGF0aW9uICsgTWF0aC5QSSwgLy8gYWRkIDE4MCBkZWdyZWVzXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIG9wYWNpdHk6IDFcclxuICAgICAgICAgICAgICAgICAgICB9KVxyXG4gICAgICAgICAgICAgICAgfSkpO1xyXG4gICAgICAgICAgICAgICAgY250Kys7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICB9LFxyXG5cclxuICAgIF9nZW5EaXN0YW5jZUttIDogZnVuY3Rpb24od3csIHJlc29sdXRpb24sXHJcblx0XHRcdFx0XHRcdFx0ICBjb29yZHMsIGRpc3RhbmNlcywgc3RhcnREaXN0SW5kZXgsIGVuZERpc3RJbmRleCxcclxuXHRcdFx0XHRcdFx0XHQgIHN0eWxlcykge1xyXG4gICAgICAgIC8vIFRPRE8gUnVtZW4gLSBzdGlsbCBub3QgcmVhZHkgLSBmb3Igbm93IHN0YXRpYyBob3RzcG90cyBhcmUgdXNlZFxyXG4gICAgICAgIGlmICh0cnVlKSB7cmV0dXJuO31cclxuXHJcbiAgICAgICAgdmFyIGhvdHNwb3RzS20gPSBbMjAsIDQwLCA2MCwgODAsIDEwMCwgMTIwLCAxNDAsIDE2MCwgMTgwXTtcclxuXHJcbiAgICAgICAgZnVuY3Rpb24gYWRkSG90U3BvdEtNKGttLCBwb2ludCkge1xyXG4gICAgICAgICAgICAvL3ZhciBkeCA9IGVuZFswXSAtIHN0YXJ0WzBdO1xyXG4gICAgICAgICAgICAvL3ZhciBkeSA9IGVuZFsxXSAtIHN0YXJ0WzFdO1xyXG4gICAgICAgICAgICAvL3ZhciByb3RhdGlvbiA9IE1hdGguYXRhbjIoZHksIGR4KTtcclxuICAgICAgICAgICAgc3R5bGVzLnB1c2gobmV3IG9sLnN0eWxlLlN0eWxlKHtcclxuICAgICAgICAgICAgICAgIC8vZ2VvbWV0cnk6IG5ldyBvbC5nZW9tLlBvaW50KFsoc3RhcnRbMF0rZW5kWzBdKS8yLChzdGFydFsxXStlbmRbMV0pLzJdKSxcclxuICAgICAgICAgICAgICAgIGdlb21ldHJ5OiBuZXcgb2wuZ2VvbS5Qb2ludChbcG9pbnRbMF0sIHBvaW50WzFdXSksXHJcbiAgICAgICAgICAgICAgICBpbWFnZTogbmV3IG9sLnN0eWxlLkljb24oe1xyXG4gICAgICAgICAgICAgICAgICAgIHNyYzogXCJpbWcvXCIgKyBrbSArIFwia20uc3ZnXCIsXHJcbiAgICAgICAgICAgICAgICAgICAgc2NhbGU6IDEuNSxcclxuICAgICAgICAgICAgICAgICAgICByb3RhdGVXaXRoVmlldzogdHJ1ZSxcclxuICAgICAgICAgICAgICAgICAgICAvL3JvdGF0aW9uOiAtcm90YXRpb24gKyBNYXRoLlBJLzIsIC8vIGFkZCAxODAgZGVncmVlc1xyXG4gICAgICAgICAgICAgICAgICAgIG9wYWNpdHkgOiAxXHJcbiAgICAgICAgICAgICAgICB9KVxyXG4gICAgICAgICAgICB9KSk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBmb3IgKHZhciBpID0gc3RhcnREaXN0SW5kZXg7IGkgPCBlbmREaXN0SW5kZXg7IGkrKykge1xyXG4gICAgICAgICAgICBpZiAoIWhvdHNwb3RzS20ubGVuZ3RoKSB7XHJcblx0XHRcdFx0cmV0dXJuO1xyXG5cdFx0XHR9XHJcblxyXG5cdFx0XHR2YXIgZGlzdCA9IGRpc3RhbmNlc1tpXTtcclxuXHJcblx0XHRcdGlmIChkaXN0ID49IGhvdHNwb3RzS21bMF0qMTAwMCkge1xyXG5cdFx0XHRcdC8vIGRyYXcgdGhlIGZpcnN0IGhvdHNwb3QgYW5kIGFueSBuZXh0IGlmIGl0J3MgY29udGFpbmVkIGluIHRoZSBzYW1lIFwiZGlzdGFuY2VcIlxyXG5cdFx0XHRcdHZhciByZW1vdmVIb3RzcG90S20gPSAwO1xyXG5cdFx0XHRcdGZvciAodmFyIGsgPSAwLCBsZW5Ib3RzcG90c0ttID0gaG90c3BvdHNLbS5sZW5ndGg7IGsgPCBsZW5Ib3RzcG90c0ttOyBrKyspIHtcclxuXHRcdFx0XHRcdGlmIChkaXN0ID49IGhvdHNwb3RzS21ba10qMTAwMCkge1xyXG5cdFx0XHRcdFx0XHRhZGRIb3RTcG90S00oaG90c3BvdHNLbVtrXSwgY29vcmRzW2ldKTtcclxuXHRcdFx0XHRcdFx0cmVtb3ZlSG90c3BvdEttKys7XHJcblx0XHRcdFx0XHR9IGVsc2Uge1xyXG5cdFx0XHRcdFx0XHRicmVhaztcclxuXHRcdFx0XHRcdH1cclxuXHRcdFx0XHR9XHJcblx0XHRcdFx0Ly8gcmVtb3ZlIGFsbCB0aGUgYWxyZWFkeSBkcmF3biBob3RzcG90c1xyXG5cdFx0XHRcdGZvciAodmFyIGogPSAwOyBqIDxyZW1vdmVIb3RzcG90S207IGorKykgaG90c3BvdHNLbS5zaGlmdCgpO1xyXG5cdFx0XHR9XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG59O1xyXG5cclxuZm9yICh2YXIgaSBpbiBTVFlMRVMpXHJcblx0ZXhwb3J0c1tpXT1TVFlMRVNbaV07XHJcbiIsInJlcXVpcmUoJ2pvb3NlJyk7XHJcbnJlcXVpcmUoJy4vUGFydGljaXBhbnQnKTtcclxuXHJcbnZhciByYnVzaCA9IHJlcXVpcmUoJ3JidXNoJyk7XHJcbnZhciBDT05GSUcgPSByZXF1aXJlKCcuL0NvbmZpZycpO1xyXG52YXIgV0dTODRTUEhFUkUgPSByZXF1aXJlKCcuL1V0aWxzJykuV0dTODRTUEhFUkU7XHJcblxyXG5DbGFzcyhcIlRyYWNrXCIsIFxyXG57XHRcclxuICAgIC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHQvLyBBTEwgQ09PUkRJTkFURVMgQVJFIElOIFdPUkxEIE1FUkNBVE9SXHJcbiAgICAvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcbiAgICBoYXM6IFxyXG5cdHtcclxuICAgICAgICByb3V0ZSA6IHtcclxuICAgICAgICAgICAgaXM6ICAgXCJyd1wiXHJcbiAgICAgICAgfSxcclxuICAgICAgICBkaXN0YW5jZXMgOiB7XHJcbiAgICAgICAgICAgIGlzOiAgIFwicndcIlxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgZGlzdGFuY2VzRWxhcHNlZCA6IHtcclxuICAgICAgICAgICAgaXM6ICAgXCJyd1wiXHJcbiAgICAgICAgfSxcclxuXHRcdHRvdGFsTGVuZ3RoIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIlxyXG5cdFx0fSxcclxuXHRcdHBhcnRpY2lwYW50cyA6IHtcclxuXHRcdFx0aXM6ICAgXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogW11cclxuXHRcdH0sXHJcblx0XHRjYW1zQ291bnQgOiB7XHJcblx0XHRcdGlzOiAgIFwicndcIixcclxuXHRcdFx0aW5pdDogMFxyXG5cdFx0fSxcclxuXHRcdC8vIGluIEVQU0cgMzg1N1xyXG5cdFx0ZmVhdHVyZSA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiBudWxsXHRcdFxyXG5cdFx0fSxcclxuXHRcdGlzRGlyZWN0aW9uQ29uc3RyYWludCA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiBmYWxzZVxyXG5cdFx0fSxcclxuXHRcdFxyXG5cdFx0ZGVidWdQYXJ0aWNpcGFudCA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiBudWxsXHJcblx0XHR9LFxyXG5cdFx0YmlrZVN0YXJ0S00gOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogbnVsbFxyXG5cdFx0fSxcclxuXHRcdHJ1blN0YXJ0S00gOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogbnVsbFxyXG5cdFx0fSxcclxuXHRcdGxhcHMgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogMVxyXG5cdFx0fSxcclxuXHRcdHRvdGFsUGFydGljaXBhbnRzIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IDUwXHJcblx0XHR9LFxyXG5cdFx0clRyZWUgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogcmJ1c2goMTApXHJcblx0XHR9LFxyXG5cclxuXHRcdGlzQWRkZWRIb3RTcG90U3dpbUJpa2UgOiB7XHJcblx0XHRcdGluaXQgOiBmYWxzZVxyXG5cdFx0fSxcclxuXHRcdGlzQWRkZWRIb3RTcG90QmlrZVJ1biA6IHtcclxuXHRcdFx0aW5pdCA6IGZhbHNlXHJcblx0XHR9XHJcbiAgICB9LFxyXG4gICAgLy8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdG1ldGhvZHM6IFxyXG5cdHtcdFx0XHJcblx0XHRzZXRSb3V0ZSA6IGZ1bmN0aW9uKHZhbCkge1xyXG5cdFx0XHR0aGlzLnJvdXRlPXZhbDtcclxuXHRcdFx0ZGVsZXRlIHRoaXMuX2xlbnRtcDE7XHJcblx0XHRcdGRlbGV0ZSB0aGlzLl9sZW50bXAyO1xyXG5cdFx0fSxcclxuXHRcdFxyXG5cdFx0Z2V0Qm91bmRpbmdCb3ggOiBmdW5jdGlvbigpIHtcclxuXHRcdFx0dmFyIG1pbng9bnVsbCxtaW55PW51bGwsbWF4eD1udWxsLG1heHk9bnVsbDtcclxuXHRcdFx0Zm9yICh2YXIgaT0wO2k8dGhpcy5yb3V0ZS5sZW5ndGg7aSsrKVxyXG5cdFx0XHR7XHJcblx0XHRcdFx0dmFyIHA9dGhpcy5yb3V0ZVtpXTtcclxuXHRcdFx0XHRpZiAobWlueCA9PSBudWxsIHx8IHBbMF0gPCBtaW54KSBtaW54PXBbMF07XHJcblx0XHRcdFx0aWYgKG1heHggPT0gbnVsbCB8fCBwWzBdID4gbWF4eCkgbWF4eD1wWzBdO1xyXG5cdFx0XHRcdGlmIChtaW55ID09IG51bGwgfHwgcFsxXSA8IG1pbnkpIG1pbnk9cFsxXTtcclxuXHRcdFx0XHRpZiAobWF4eSA9PSBudWxsIHx8IHBbMV0gPiBtYXh5KSBtYXh5PXBbMV07XHJcblx0XHRcdH1cclxuXHRcdFx0cmV0dXJuIFttaW54LG1pbnksbWF4eCxtYXh5XTtcclxuXHRcdH0sXHJcblx0XHRcclxuXHRcdC8vIENBTEwgT05MWSBPTkNFIE9OIElOSVRcclxuXHRcdGdldEVsYXBzZWRGcm9tUG9pbnQgOiBmdW5jdGlvbihwb2ludCxzdGFydCkgXHJcblx0XHR7XHJcblx0XHRcdHZhciByZXM9MC4wO1xyXG5cdFx0XHR2YXIgYnJrPWZhbHNlO1xyXG5cdFx0XHR2YXIgY2MgPSB0aGlzLnJvdXRlO1xyXG5cdFx0XHRpZiAoIXN0YXJ0KVxyXG5cdFx0XHRcdHN0YXJ0PTA7XHJcblx0XHRcdGZvciAodmFyIGk9c3RhcnQ7aTxjYy5sZW5ndGgtMTtpKyspIFxyXG5cdFx0XHR7XHJcblx0XHRcdFx0dmFyIGEgPSBjY1tpXTtcclxuXHRcdFx0XHR2YXIgYyA9IGNjW2krMV07XHJcblx0XHRcdFx0dmFyIGIgPSBwb2ludDtcclxuXHRcdFx0XHR2YXIgYWMgPSBNYXRoLnNxcnQoKGFbMF0tY1swXSkqKGFbMF0tY1swXSkrKGFbMV0tY1sxXSkqKGFbMV0tY1sxXSkpO1xyXG5cdFx0XHRcdHZhciBiYSA9IE1hdGguc3FydCgoYlswXS1hWzBdKSooYlswXS1hWzBdKSsoYlsxXS1hWzFdKSooYlsxXS1hWzFdKSk7XHJcblx0XHRcdFx0dmFyIGJjID0gTWF0aC5zcXJ0KChiWzBdLWNbMF0pKihiWzBdLWNbMF0pKyhiWzFdLWNbMV0pKihiWzFdLWNbMV0pKTtcclxuXHRcdFx0XHRcclxuXHRcdFx0XHR2YXIgbWlueCA9IGFbMF0gPCBiWzBdID8gYVswXSA6IGJbMF07XHJcblx0XHRcdFx0dmFyIG1pbnkgPSBhWzFdIDwgYlsxXSA/IGFbMV0gOiBiWzFdO1xyXG5cdFx0XHRcdHZhciBtYXh4ID0gYVswXSA+IGJbMF0gPyBhWzBdIDogYlswXTtcclxuXHRcdFx0XHR2YXIgbWF4eSA9IGFbMV0gPiBiWzFdID8gYVsxXSA6IGJbMV07XHJcblx0XHRcdFx0Ly8gYmEgPiBhYyBPUiBiYyA+IGFjXHJcblx0XHRcdFx0aWYgKGJbMF0gPCBtaW54IHx8IGJbMF0gPiBtYXh4IHx8IGJbMV0gPCBtaW55IHx8IGJbMV0gPiBtYXh5IHx8IGJhID4gYWMgfHwgYmMgPiBhYykgXHJcblx0XHRcdFx0e1xyXG5cdFx0XHRcdFx0cmVzKz1XR1M4NFNQSEVSRS5oYXZlcnNpbmVEaXN0YW5jZShhLGMpO1xyXG5cdFx0XHRcdFx0Y29udGludWU7XHJcblx0XHRcdFx0fVxyXG5cdFx0XHRcdHJlcys9V0dTODRTUEhFUkUuaGF2ZXJzaW5lRGlzdGFuY2UoYSxiKTtcclxuXHRcdFx0XHRicmVhaztcclxuXHRcdFx0fVxyXG5cdFx0XHR2YXIgbGVuID0gdGhpcy5nZXRUcmFja0xlbmd0aCgpO1xyXG5cdFx0XHRyZXR1cm4gcmVzL2xlbjtcclxuXHRcdH0sXHJcblx0XHRcclxuXHRcdC8vIGVsYXBzZWQgZnJvbSAwLi4xXHJcblx0XHRnZXRQb3NpdGlvbkFuZFJvdGF0aW9uRnJvbUVsYXBzZWQgOiBmdW5jdGlvbihlbGFwc2VkKSB7XHJcblx0XHRcdHZhciBycj1udWxsO1xyXG5cdFx0XHR2YXIgY2MgPSB0aGlzLnJvdXRlO1xyXG5cdFx0XHRcclxuXHRcdFx0dmFyIGxsID0gdGhpcy5kaXN0YW5jZXNFbGFwc2VkLmxlbmd0aC0xO1xyXG5cdFx0XHR2YXIgc2kgPSAwO1xyXG5cclxuXHRcdFx0Ly8gVE9ETyBGSVggTUUgXHJcblx0XHRcdHdoaWxlIChzaSA8IGxsICYmIHNpKzUwMCA8IGxsICYmIHRoaXMuZGlzdGFuY2VzRWxhcHNlZFtzaSs1MDBdIDwgZWxhcHNlZCApIHtcclxuXHRcdFx0XHRzaSs9NTAwO1xyXG5cdFx0XHR9XHJcblx0XHRcdFxyXG5cdFx0XHR3aGlsZSAoc2kgPCBsbCAmJiBzaSsyNTAgPCBsbCAmJiB0aGlzLmRpc3RhbmNlc0VsYXBzZWRbc2krMjUwXSA8IGVsYXBzZWQgKSB7XHJcblx0XHRcdFx0c2krPTI1MDtcclxuXHRcdFx0fVxyXG5cdFx0XHRcclxuXHRcdFx0d2hpbGUgKHNpIDwgbGwgJiYgc2krMTI1IDwgbGwgJiYgdGhpcy5kaXN0YW5jZXNFbGFwc2VkW3NpKzEyNV0gPCBlbGFwc2VkICkge1xyXG5cdFx0XHRcdHNpKz0xMjU7XHJcblx0XHRcdH1cclxuXHJcblx0XHRcdHdoaWxlIChzaSA8IGxsICYmIHNpKzUwIDwgbGwgJiYgdGhpcy5kaXN0YW5jZXNFbGFwc2VkW3NpKzUwXSA8IGVsYXBzZWQgKSB7XHJcblx0XHRcdFx0c2krPTUwO1xyXG5cdFx0XHR9XHJcblx0XHRcdFxyXG5cdFx0XHRmb3IgKHZhciBpPXNpO2k8bGw7aSsrKSBcclxuXHRcdFx0e1xyXG5cdFx0XHRcdC8qZG8gXHJcblx0XHRcdFx0e1xyXG5cdFx0XHRcdFx0dmFyIG0gPSAoKGNjLmxlbmd0aC0xK2kpID4+IDEpO1xyXG5cdFx0XHRcdFx0aWYgKG0taSA+IDUgJiYgZWxhcHNlZCA8IHRoaXMuZGlzdGFuY2VzRWxhcHNlZFttXSkge1xyXG5cdFx0XHRcdFx0XHRpPW07XHJcblx0XHRcdFx0XHRcdGNvbnRpbnVlO1xyXG5cdFx0XHRcdFx0fVxyXG5cdFx0XHRcdFx0YnJlYWs7XHJcblx0XHRcdFx0fSB3aGlsZSAodHJ1ZSk7Ki9cclxuXHRcdFx0XHRpZiAoZWxhcHNlZCA+PSB0aGlzLmRpc3RhbmNlc0VsYXBzZWRbaV0gJiYgZWxhcHNlZCA8PSB0aGlzLmRpc3RhbmNlc0VsYXBzZWRbaSsxXSkgXHJcblx0XHRcdFx0e1xyXG5cdFx0XHRcdFx0ZWxhcHNlZC09dGhpcy5kaXN0YW5jZXNFbGFwc2VkW2ldO1xyXG5cdFx0XHRcdFx0dmFyIGFjPXRoaXMuZGlzdGFuY2VzRWxhcHNlZFtpKzFdLXRoaXMuZGlzdGFuY2VzRWxhcHNlZFtpXTtcclxuXHRcdFx0XHRcdHZhciBhID0gY2NbaV07XHJcblx0XHRcdFx0XHR2YXIgYyA9IGNjW2krMV07XHJcblx0XHRcdFx0XHR2YXIgZHggPSBjWzBdIC0gYVswXTtcclxuXHRcdFx0XHRcdHZhciBkeSA9IGNbMV0gLSBhWzFdO1xyXG5cdFx0XHRcdFx0cnI9WyBhWzBdKyhjWzBdLWFbMF0pKmVsYXBzZWQvYWMsYVsxXSsoY1sxXS1hWzFdKSplbGFwc2VkL2FjLE1hdGguYXRhbjIoZHksIGR4KV07XHJcblx0XHRcdFx0XHRicmVhaztcclxuXHRcdFx0XHR9XHJcblx0XHRcdH1cclxuXHRcdFx0cmV0dXJuIHJyO1xyXG5cdFx0fSxcclxuXHRcdFxyXG5cdFx0X19nZXRQb3NpdGlvbkFuZFJvdGF0aW9uRnJvbUVsYXBzZWQgOiBmdW5jdGlvbihlbGFwc2VkKSB7XHJcblx0XHRcdGVsYXBzZWQqPXRoaXMuZ2V0VHJhY2tMZW5ndGgoKTtcclxuXHRcdFx0dmFyIHJyPW51bGw7XHJcblx0XHRcdHZhciBjYyA9IHRoaXMucm91dGU7XHJcblx0XHRcdGZvciAodmFyIGk9MDtpPGNjLmxlbmd0aC0xO2krKykgXHJcblx0XHRcdHtcclxuXHRcdFx0XHR2YXIgYSA9IGNjW2ldO1xyXG5cdFx0XHRcdHZhciBjID0gY2NbaSsxXTtcclxuXHRcdFx0XHR2YXIgYWMgPSBXR1M4NFNQSEVSRS5oYXZlcnNpbmVEaXN0YW5jZShhLGMpO1xyXG5cdFx0XHRcdGlmIChlbGFwc2VkIDw9IGFjKSB7XHJcblx0XHRcdFx0XHR2YXIgZHggPSBjWzBdIC0gYVswXTtcclxuXHRcdFx0XHRcdHZhciBkeSA9IGNbMV0gLSBhWzFdO1xyXG5cdFx0XHRcdFx0cnI9WyBhWzBdKyhjWzBdLWFbMF0pKmVsYXBzZWQvYWMsYVsxXSsoY1sxXS1hWzFdKSplbGFwc2VkL2FjLE1hdGguYXRhbjIoZHksIGR4KV07XHJcblx0XHRcdFx0XHRicmVhaztcclxuXHRcdFx0XHR9XHJcblx0XHRcdFx0ZWxhcHNlZC09YWM7XHJcblx0XHRcdH1cclxuXHRcdFx0cmV0dXJuIHJyO1xyXG5cdFx0fSxcclxuXHJcblx0XHRcclxuXHRcdGdldFRyYWNrTGVuZ3RoIDogZnVuY3Rpb24oKSB7XHJcblx0XHRcdGlmICh0aGlzLl9sZW50bXAxKVxyXG5cdFx0XHRcdHJldHVybiB0aGlzLl9sZW50bXAxO1xyXG5cdFx0XHR2YXIgcmVzPTAuMDtcclxuXHRcdFx0dmFyIGNjID0gdGhpcy5yb3V0ZTtcclxuXHRcdFx0Zm9yICh2YXIgaT0wO2k8Y2MubGVuZ3RoLTE7aSsrKSBcclxuXHRcdFx0e1xyXG5cdFx0XHRcdHZhciBhID0gY2NbaV07XHJcblx0XHRcdFx0dmFyIGIgPSBjY1tpKzFdO1xyXG5cdFx0XHRcdHZhciBkID0gV0dTODRTUEhFUkUuaGF2ZXJzaW5lRGlzdGFuY2UoYSxiKTtcclxuXHRcdFx0XHRpZiAoIWlzTmFOKGQpICYmIGQgPiAwKSBcclxuXHRcdFx0XHRcdHJlcys9ZDtcclxuXHRcdFx0fVxyXG5cdFx0XHR0aGlzLl9sZW50bXAxPXJlcztcclxuXHRcdFx0cmV0dXJuIHJlcztcclxuXHRcdH0sXHJcblxyXG5cdFx0Z2V0VHJhY2tMZW5ndGhJbldHUzg0IDogZnVuY3Rpb24oKSB7XHJcblx0XHRcdGlmICh0aGlzLl9sZW50bXAyKVxyXG5cdFx0XHRcdHJldHVybiB0aGlzLl9sZW50bXAyO1xyXG5cdFx0XHR2YXIgcmVzPTAuMDtcclxuXHRcdFx0dmFyIGNjID0gdGhpcy5yb3V0ZTtcclxuXHRcdFx0Zm9yICh2YXIgaT0wO2k8Y2MubGVuZ3RoLTE7aSsrKSBcclxuXHRcdFx0e1xyXG5cdFx0XHRcdHZhciBhID0gY2NbaV07XHJcblx0XHRcdFx0dmFyIGIgPSBjY1tpKzFdO1xyXG5cdFx0XHRcdHZhciBkID0gTWF0aC5zcXJ0KChhWzBdLWJbMF0pKihhWzBdLWJbMF0pKyhhWzFdLWJbMV0pKihhWzFdLWJbMV0pKTtcclxuXHRcdFx0XHRpZiAoIWlzTmFOKGQpICYmIGQgPiAwKSBcclxuXHRcdFx0XHRcdHJlcys9ZDtcclxuXHRcdFx0fVxyXG5cdFx0XHR0aGlzLl9sZW50bXAyPXJlcztcclxuXHRcdFx0cmV0dXJuIHJlcztcclxuXHRcdH0sXHJcblxyXG5cdFx0Z2V0Q2VudGVyIDogZnVuY3Rpb24oKSB7XHJcblx0XHRcdHZhciBiYiA9IHRoaXMuZ2V0Qm91bmRpbmdCb3goKTtcclxuXHRcdFx0cmV0dXJuIFsoYmJbMF0rYmJbMl0pLzIuMCwoYmJbMV0rYmJbM10pLzIuMF07XHJcblx0XHR9LFxyXG5cdFx0XHJcblx0XHRpbml0IDogZnVuY3Rpb24oKSBcclxuXHRcdHtcclxuXHRcdFx0aWYgKCF0aGlzLnJvdXRlKVxyXG5cdFx0XHRcdHJldHVybjtcclxuXHRcdFx0Ly8gMSkgY2FsY3VsYXRlIHRvdGFsIHJvdXRlIGxlbmd0aCBpbiBLTSBcclxuXHRcdFx0dGhpcy51cGRhdGVGZWF0dXJlKCk7XHJcblx0XHRcdGlmICh0eXBlb2Ygd2luZG93ICE9IFwidW5kZWZpbmVkXCIpIFxyXG5cdFx0XHRcdEdVSS5tYXAuZ2V0VmlldygpLmZpdEV4dGVudCh0aGlzLmZlYXR1cmUuZ2V0R2VvbWV0cnkoKS5nZXRFeHRlbnQoKSwgR1VJLm1hcC5nZXRTaXplKCkpO1xyXG5cdFx0fSxcclxuXHRcdFxyXG5cdFx0Z2V0VHJhY2tQYXJ0IDogZnVuY3Rpb24oZWxhcHNlZCkge1xyXG5cdFx0XHR2YXIgbGVuID0gdGhpcy5nZXRUcmFja0xlbmd0aCgpO1xyXG5cdFx0XHR2YXIgZW0gPSAoZWxhcHNlZCUxLjApKmxlbjtcclxuXHRcdFx0aWYgKGVtID49IHRoaXMucnVuU3RhcnRLTSoxMDAwKSBcclxuXHRcdFx0XHRyZXR1cm4gMjtcclxuXHRcdFx0aWYgKGVtID49IHRoaXMuYmlrZVN0YXJ0S00qMTAwMCkgXHJcblx0XHRcdFx0cmV0dXJuIDE7XHJcblx0XHRcdHJldHVybiAwO1xyXG5cdFx0fSxcclxuXHRcdFxyXG5cdFx0dXBkYXRlRmVhdHVyZSA6IGZ1bmN0aW9uKCkgXHJcblx0XHR7XHJcblx0XHRcdHRoaXMuZGlzdGFuY2VzPVtdO1xyXG5cdFx0XHR2YXIgcmVzPTAuMDtcclxuXHRcdFx0dmFyIGNjID0gdGhpcy5yb3V0ZTtcclxuXHRcdFx0Zm9yICh2YXIgaT0wO2k8Y2MubGVuZ3RoLTE7aSsrKSBcclxuXHRcdFx0e1xyXG5cdFx0XHRcdHZhciBhID0gY2NbaV07XHJcblx0XHRcdFx0dmFyIGIgPSBjY1tpKzFdO1xyXG5cdFx0XHRcdHZhciBkID0gV0dTODRTUEhFUkUuaGF2ZXJzaW5lRGlzdGFuY2UoYSxiKTtcclxuXHRcdFx0XHR0aGlzLmRpc3RhbmNlcy5wdXNoKHJlcyk7XHJcblx0XHRcdFx0aWYgKCFpc05hTihkKSAmJiBkID4gMCkgXHJcblx0XHRcdFx0XHRyZXMrPWQ7XHJcblx0XHRcdH1cclxuXHRcdFx0dGhpcy5kaXN0YW5jZXMucHVzaChyZXMpO1xyXG5cdFx0XHR0aGlzLmRpc3RhbmNlc0VsYXBzZWQ9W107XHJcblx0XHRcdHZhciB0bCA9IHRoaXMuZ2V0VHJhY2tMZW5ndGgoKTtcclxuXHRcdFx0Zm9yICh2YXIgaT0wO2k8Y2MubGVuZ3RoO2krKykge1xyXG5cdFx0XHRcdHRoaXMuZGlzdGFuY2VzRWxhcHNlZC5wdXNoKHRoaXMuZGlzdGFuY2VzW2ldL3RsKTtcclxuXHRcdFx0fVxyXG5cdFx0XHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0XHRcdHRoaXMuclRyZWUuY2xlYXIoKTtcclxuXHRcdFx0dmFyIGFyciA9IFtdO1xyXG5cdFx0XHRmb3IgKHZhciBpPTA7aTx0aGlzLnJvdXRlLmxlbmd0aC0xO2krKykgXHJcblx0XHRcdHtcclxuXHRcdFx0XHR2YXIgeDEgPSB0aGlzLnJvdXRlW2ldWzBdO1xyXG5cdFx0XHRcdHZhciB5MSA9IHRoaXMucm91dGVbaV1bMV07XHJcblx0XHRcdFx0dmFyIHgyID0gdGhpcy5yb3V0ZVtpKzFdWzBdO1xyXG5cdFx0XHRcdHZhciB5MiA9IHRoaXMucm91dGVbaSsxXVsxXTtcclxuXHRcdFx0XHR2YXIgbWlueCA9IHgxIDwgeDIgPyB4MSA6IHgyO1xyXG5cdFx0XHRcdHZhciBtaW55ID0geTEgPCB5MiA/IHkxIDogeTI7XHJcblx0XHRcdFx0dmFyIG1heHggPSB4MSA+IHgyID8geDEgOiB4MjtcclxuXHRcdFx0XHR2YXIgbWF4eSA9IHkxID4geTIgPyB5MSA6IHkyO1xyXG5cdFx0XHRcdGFyci5wdXNoKFttaW54LG1pbnksbWF4eCxtYXh5LHsgaW5kZXggOiBpIH1dKTtcclxuXHRcdFx0fVxyXG5cdFx0XHR0aGlzLnJUcmVlLmxvYWQoYXJyKTtcclxuXHRcdFx0Ly8tLS0tLS0tLS0tLS0tLS0tLSAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRcdFx0aWYgKHR5cGVvZiB3aW5kb3cgIT0gXCJ1bmRlZmluZWRcIikgXHJcblx0XHRcdHtcclxuXHRcdFx0XHR2YXIgd2t0ID0gW107XHJcblx0XHRcdFx0Zm9yICh2YXIgaT0wO2k8dGhpcy5yb3V0ZS5sZW5ndGg7aSsrKSB7XHJcblx0XHRcdFx0XHR3a3QucHVzaCh0aGlzLnJvdXRlW2ldWzBdK1wiIFwiK3RoaXMucm91dGVbaV1bMV0pO1xyXG5cdFx0XHRcdH1cclxuXHRcdFx0XHR3a3Q9XCJMSU5FU1RSSU5HKFwiK3drdC5qb2luKFwiLFwiKStcIilcIjtcclxuXHRcdFx0XHR2YXIgZm9ybWF0ID0gbmV3IG9sLmZvcm1hdC5XS1QoKTtcclxuXHRcdFx0XHRpZiAoIXRoaXMuZmVhdHVyZSkge1xyXG5cdFx0XHRcdFx0dGhpcy5mZWF0dXJlID0gZm9ybWF0LnJlYWRGZWF0dXJlKHdrdCk7XHJcblx0XHRcdFx0fSBlbHNlIHtcclxuXHRcdFx0XHRcdHRoaXMuZmVhdHVyZS5zZXRHZW9tZXRyeShmb3JtYXQucmVhZEZlYXR1cmUod2t0KS5nZXRHZW9tZXRyeSgpKTtcclxuXHRcdFx0XHR9XHJcblx0XHRcdFx0dGhpcy5mZWF0dXJlLnRyYWNrPXRoaXM7XHJcblx0XHRcdFx0dGhpcy5mZWF0dXJlLmdldEdlb21ldHJ5KCkudHJhbnNmb3JtKCdFUFNHOjQzMjYnLCAnRVBTRzozODU3Jyk7XHRcdFx0XHRcdFx0XHJcblx0XHRcdH1cclxuXHRcdH0sXHJcblxyXG5cdFx0Z2V0UmVhbFBhcnRpY2lwYW50c0NvdW50IDogZnVuY3Rpb24oKSB7XHJcblx0XHRcdHJldHVybiB0aGlzLnBhcnRpY2lwYW50cy5sZW5ndGggLSB0aGlzLmNhbXNDb3VudDtcclxuXHRcdH0sXHJcblx0XHRcclxuXHRcdG5ld1BhcnRpY2lwYW50IDogZnVuY3Rpb24oaWQsZGV2aWNlSWQsbmFtZSlcclxuXHRcdHtcclxuXHRcdFx0dmFyIHBhcnQgPSBuZXcgUGFydGljaXBhbnQoe2lkOmlkLGRldmljZUlkOmRldmljZUlkLGNvZGU6bmFtZX0pO1xyXG5cdFx0XHRwYXJ0LmluaXQodGhpcy5yb3V0ZVswXSx0aGlzKTtcclxuXHRcdFx0cGFydC5zZXRTZXFJZCh0aGlzLnBhcnRpY2lwYW50cy5sZW5ndGgpO1xyXG5cdFx0XHR0aGlzLnBhcnRpY2lwYW50cy5wdXNoKHBhcnQpO1xyXG5cdFx0XHRyZXR1cm4gcGFydDtcclxuXHRcdH0sXHJcblxyXG5cdFx0bmV3TW92aW5nQ2FtIDogZnVuY3Rpb24oaWQsZGV2aWNlSWQsbmFtZSlcclxuXHRcdHtcclxuXHRcdFx0dmFyIGNhbSA9IG5ldyBNb3ZpbmdDYW0oe2lkOmlkLGRldmljZUlkOmRldmljZUlkLGNvZGU6bmFtZX0pO1xyXG5cdFx0XHRjYW0uaW5pdCh0aGlzLnJvdXRlWzBdLHRoaXMpO1xyXG5cdFx0XHRjYW0uc2V0U2VxSWQodGhpcy5jYW1zQ291bnQpO1xyXG5cdFx0XHR0aGlzLmNhbXNDb3VudCsrO1xyXG5cdFx0XHRjYW0uX19za2lwVHJhY2tpbmdQb3M9dHJ1ZTtcclxuXHRcdFx0dGhpcy5wYXJ0aWNpcGFudHMucHVzaChjYW0pO1xyXG5cdFx0XHRyZXR1cm4gY2FtO1xyXG5cdFx0fSxcclxuXHJcblx0XHRuZXdIb3RTcG90cyA6IGZ1bmN0aW9uKGhvdHNwb3RzKSB7XHJcblx0XHRcdGlmICghaG90c3BvdHMgfHwgIWhvdHNwb3RzLmxlbmd0aCkge1xyXG5cdFx0XHRcdHJldHVybjtcclxuXHRcdFx0fVxyXG5cclxuXHRcdFx0Ly8gVE9ETyBSdW1lbiAtIHRoaXMgaXMgQ09QWS1QQVNURSBjb2RlIGZvcm0gdGhlIFN0eWxlc1xyXG5cdFx0XHQvLyBzbyBsYXRlciBpdCBoYXMgdG8gYmUgaW4gb25seSBvbmUgcGxhY2UgLSBnZXR0aW5nIHRoZSBnZW9tZXRyaWVzIGZvciBlYWNoIHR5cGUgZGlzdGFuY2VcclxuXHRcdFx0Ly8gbWF5YmUgaW4gdGhlIHNhbWUgcGxhY2UgZGlzdGFuY2VzIGFyZSBjYWxjdWxhdGVkLlxyXG5cdFx0XHQvLyBUSElTIElTIFRFTVBPUkFSWSBQQVRDSCB0byBnZXQgdGhlIG5lZWRlZCBwb2ludHNcclxuXHRcdFx0aWYgKCFpc05hTih0aGlzLmJpa2VTdGFydEtNKSkge1xyXG5cdFx0XHRcdGZvciAodmFyIGk9MDtpPHRoaXMuZGlzdGFuY2VzLmxlbmd0aDtpKyspIHtcclxuXHRcdFx0XHRcdGlmICh0aGlzLmRpc3RhbmNlc1tpXSA+PSB0aGlzLmJpa2VTdGFydEtNKjEwMDApXHJcblx0XHRcdFx0XHRcdGJyZWFrO1xyXG5cdFx0XHRcdH1cclxuXHRcdFx0XHR2YXIgajtcclxuXHRcdFx0XHRpZiAoIWlzTmFOKHRoaXMucnVuU3RhcnRLTSkpIHtcclxuXHRcdFx0XHRcdGZvciAoaj1pO2o8dGhpcy5kaXN0YW5jZXMubGVuZ3RoO2orKykge1xyXG5cdFx0XHRcdFx0XHRpZiAodGhpcy5kaXN0YW5jZXNbal0gPj0gdGhpcy5ydW5TdGFydEtNKjEwMDApXHJcblx0XHRcdFx0XHRcdFx0YnJlYWs7XHJcblx0XHRcdFx0XHR9XHJcblx0XHRcdFx0fSBlbHNlIHtcclxuXHRcdFx0XHRcdGo9dGhpcy5kaXN0YW5jZXMubGVuZ3RoO1xyXG5cdFx0XHRcdH1cclxuXHRcdFx0XHR2YXIgY29vcmRzPXRoaXMuZmVhdHVyZS5nZXRHZW9tZXRyeSgpLmdldENvb3JkaW5hdGVzKCk7XHJcblx0XHRcdFx0dmFyIGdlb21zd2ltPWNvb3Jkcy5zbGljZSgwLGkpO1xyXG5cdFx0XHRcdHZhciBnZW9tYmlrZT1jb29yZHMuc2xpY2UoaSA8IDEgPyBpIDogaS0xLGopO1xyXG5cdFx0XHRcdGlmIChqIDwgdGhpcy5kaXN0YW5jZXMubGVuZ3RoKVxyXG5cdFx0XHRcdFx0dmFyIGdlb21ydW49Y29vcmRzLnNsaWNlKGogPCAxID8gaiA6IGotMSx0aGlzLmRpc3RhbmNlcy5sZW5ndGgpO1xyXG5cdFx0XHRcdGlmICghZ2VvbXN3aW0ubGVuZ3RoKVxyXG5cdFx0XHRcdFx0Z2VvbXN3aW09bnVsbDtcclxuXHRcdFx0XHRpZiAoIWdlb21iaWtlLmxlbmd0aClcclxuXHRcdFx0XHRcdGdlb21iaWtlPW51bGw7XHJcblx0XHRcdFx0aWYgKCFnZW9tcnVuLmxlbmd0aClcclxuXHRcdFx0XHRcdGdlb21ydW49bnVsbDtcclxuXHRcdFx0fVxyXG5cclxuXHRcdFx0Zm9yICh2YXIgaSA9IDAsIGxlbiA9IGhvdHNwb3RzLmxlbmd0aDsgaSA8IGxlbjsgaSsrKSB7XHJcblx0XHRcdFx0dmFyIGhvdHNwb3QgPSBob3RzcG90c1tpXTtcclxuXHRcdFx0XHR2YXIgcG9pbnQ7XHJcblx0XHRcdFx0aWYgKGhvdHNwb3QudHlwZSA9PT0gQ09ORklHLmhvdHNwb3QuY2FtU3dpbUJpa2UpIHtcclxuXHRcdFx0XHRcdGlmICh0aGlzLmlzQWRkZWRIb3RTcG90U3dpbUJpa2UpIGNvbnRpbnVlOyAvLyBub3QgYWxsb3dlZCB0byBhZGQgdG8gc2FtZSBob3RzcG90c1xyXG5cdFx0XHRcdFx0aWYgKGdlb21iaWtlKSB7XHJcblx0XHRcdFx0XHRcdHBvaW50ID0gb2wucHJvai50cmFuc2Zvcm0oZ2VvbWJpa2VbMF0sICdFUFNHOjM4NTcnLCAnRVBTRzo0MzI2Jyk7XHJcblx0XHRcdFx0XHRcdHRoaXMuaXNBZGRlZEhvdFNwb3RTd2ltQmlrZSA9IHRydWU7XHJcblx0XHRcdFx0XHR9XHJcblx0XHRcdFx0fSBlbHNlIGlmIChob3RzcG90LnR5cGUgPT09IENPTkZJRy5ob3RzcG90LmNhbUJpa2VSdW4pIHtcclxuXHRcdFx0XHRcdGlmICh0aGlzLmlzQWRkZWRIb3RTcG90QmlrZVJ1bikgY29udGludWU7IC8vIG5vdCBhbGxvd2VkIHRvIGFkZCB0byBzYW1lIGhvdHNwb3RzXHJcblx0XHRcdFx0XHRpZiAoZ2VvbXJ1bikge1xyXG5cdFx0XHRcdFx0XHRwb2ludCA9IG9sLnByb2oudHJhbnNmb3JtKGdlb21ydW5bMF0sICdFUFNHOjM4NTcnLCAnRVBTRzo0MzI2Jyk7XHJcblx0XHRcdFx0XHRcdHRoaXMuaXNBZGRlZEhvdFNwb3RCaWtlUnVuID0gdHJ1ZTtcclxuXHRcdFx0XHRcdH1cclxuXHRcdFx0XHR9XHJcblx0XHRcdFx0aWYgKHBvaW50KVxyXG5cdFx0XHRcdFx0aG90c3BvdC5pbml0KHBvaW50KTtcclxuXHRcdFx0fVxyXG5cdFx0fSxcclxuXHRcdFxyXG5cdFx0b25NYXBDbGljayA6IGZ1bmN0aW9uKGV2ZW50KSBcclxuXHRcdHtcclxuXHRcdFx0aWYgKHRoaXMuZGVidWdQYXJ0aWNpcGFudCkgXHJcblx0XHRcdHtcclxuXHRcdFx0XHR0aGlzLmRlYnVnUGFydGljaXBhbnQub25EZWJ1Z0NsaWNrKGV2ZW50KTtcclxuXHRcdFx0fVxyXG5cdFx0fVxyXG5cclxuICAgIH1cclxufSk7IiwidmFyIHRvUmFkaWFucyA9IGZ1bmN0aW9uKGFuZ2xlRGVncmVlcykgeyByZXR1cm4gYW5nbGVEZWdyZWVzICogTWF0aC5QSSAvIDE4MDsgfTtcclxudmFyIHRvRGVncmVlcyA9IGZ1bmN0aW9uKGFuZ2xlUmFkaWFucykgeyByZXR1cm4gYW5nbGVSYWRpYW5zICogMTgwIC8gTWF0aC5QSTsgfTtcclxuXHJcbnZhciBXR1M4NFNwaGVyZSA9IGZ1bmN0aW9uKHJhZGl1cykge1xyXG4gIHRoaXMucmFkaXVzID0gcmFkaXVzO1xyXG59O1xyXG5cclxuV0dTODRTcGhlcmUucHJvdG90eXBlLmNvc2luZURpc3RhbmNlID0gZnVuY3Rpb24oYzEsIGMyKSB7XHJcbiAgdmFyIGxhdDEgPSB0b1JhZGlhbnMoYzFbMV0pO1xyXG4gIHZhciBsYXQyID0gdG9SYWRpYW5zKGMyWzFdKTtcclxuICB2YXIgZGVsdGFMb24gPSB0b1JhZGlhbnMoYzJbMF0gLSBjMVswXSk7XHJcbiAgcmV0dXJuIHRoaXMucmFkaXVzICogTWF0aC5hY29zKFxyXG4gICAgICBNYXRoLnNpbihsYXQxKSAqIE1hdGguc2luKGxhdDIpICtcclxuICAgICAgTWF0aC5jb3MobGF0MSkgKiBNYXRoLmNvcyhsYXQyKSAqIE1hdGguY29zKGRlbHRhTG9uKSk7XHJcbn07XHJcblxyXG5XR1M4NFNwaGVyZS5wcm90b3R5cGUuZ2VvZGVzaWNBcmVhID0gZnVuY3Rpb24oY29vcmRpbmF0ZXMpIHtcclxuICB2YXIgYXJlYSA9IDAsIGxlbiA9IGNvb3JkaW5hdGVzLmxlbmd0aDtcclxuICB2YXIgeDEgPSBjb29yZGluYXRlc1tsZW4gLSAxXVswXTtcclxuICB2YXIgeTEgPSBjb29yZGluYXRlc1tsZW4gLSAxXVsxXTtcclxuICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbjsgaSsrKSB7XHJcbiAgICB2YXIgeDIgPSBjb29yZGluYXRlc1tpXVswXSwgeTIgPSBjb29yZGluYXRlc1tpXVsxXTtcclxuICAgIGFyZWEgKz0gdG9SYWRpYW5zKHgyIC0geDEpICpcclxuICAgICAgICAoMiArIE1hdGguc2luKHRvUmFkaWFucyh5MSkpICtcclxuICAgICAgICBNYXRoLnNpbih0b1JhZGlhbnMoeTIpKSk7XHJcbiAgICB4MSA9IHgyO1xyXG4gICAgeTEgPSB5MjtcclxuICB9XHJcbiAgcmV0dXJuIGFyZWEgKiB0aGlzLnJhZGl1cyAqIHRoaXMucmFkaXVzIC8gMi4wO1xyXG59O1xyXG5cclxuV0dTODRTcGhlcmUucHJvdG90eXBlLmNyb3NzVHJhY2tEaXN0YW5jZSA9IGZ1bmN0aW9uKGMxLCBjMiwgYzMpIHtcclxuICB2YXIgZDEzID0gdGhpcy5jb3NpbmVEaXN0YW5jZShjMSwgYzIpO1xyXG4gIHZhciB0aGV0YTEyID0gdG9SYWRpYW5zKHRoaXMuaW5pdGlhbEJlYXJpbmcoYzEsIGMyKSk7XHJcbiAgdmFyIHRoZXRhMTMgPSB0b1JhZGlhbnModGhpcy5pbml0aWFsQmVhcmluZyhjMSwgYzMpKTtcclxuICByZXR1cm4gdGhpcy5yYWRpdXMgKlxyXG4gICAgICBNYXRoLmFzaW4oTWF0aC5zaW4oZDEzIC8gdGhpcy5yYWRpdXMpICogTWF0aC5zaW4odGhldGExMyAtIHRoZXRhMTIpKTtcclxufTtcclxuXHJcbldHUzg0U3BoZXJlLnByb3RvdHlwZS5lcXVpcmVjdGFuZ3VsYXJEaXN0YW5jZSA9IGZ1bmN0aW9uKGMxLCBjMikge1xyXG4gIHZhciBsYXQxID0gdG9SYWRpYW5zKGMxWzFdKTtcclxuICB2YXIgbGF0MiA9IHRvUmFkaWFucyhjMlsxXSk7XHJcbiAgdmFyIGRlbHRhTG9uID0gdG9SYWRpYW5zKGMyWzBdIC0gYzFbMF0pO1xyXG4gIHZhciB4ID0gZGVsdGFMb24gKiBNYXRoLmNvcygobGF0MSArIGxhdDIpIC8gMik7XHJcbiAgdmFyIHkgPSBsYXQyIC0gbGF0MTtcclxuICByZXR1cm4gdGhpcy5yYWRpdXMgKiBNYXRoLnNxcnQoeCAqIHggKyB5ICogeSk7XHJcbn07XHJcblxyXG5XR1M4NFNwaGVyZS5wcm90b3R5cGUuZmluYWxCZWFyaW5nID0gZnVuY3Rpb24oYzEsIGMyKSB7XHJcbiAgcmV0dXJuICh0aGlzLmluaXRpYWxCZWFyaW5nKGMyLCBjMSkgKyAxODApICUgMzYwO1xyXG59O1xyXG5cclxuV0dTODRTcGhlcmUucHJvdG90eXBlLmhhdmVyc2luZURpc3RhbmNlID0gZnVuY3Rpb24oYzEsIGMyKSB7XHJcbiAgdmFyIGxhdDEgPSB0b1JhZGlhbnMoYzFbMV0pO1xyXG4gIHZhciBsYXQyID0gdG9SYWRpYW5zKGMyWzFdKTtcclxuICB2YXIgZGVsdGFMYXRCeTIgPSAobGF0MiAtIGxhdDEpIC8gMjtcclxuICB2YXIgZGVsdGFMb25CeTIgPSB0b1JhZGlhbnMoYzJbMF0gLSBjMVswXSkgLyAyO1xyXG4gIHZhciBhID0gTWF0aC5zaW4oZGVsdGFMYXRCeTIpICogTWF0aC5zaW4oZGVsdGFMYXRCeTIpICtcclxuICAgICAgTWF0aC5zaW4oZGVsdGFMb25CeTIpICogTWF0aC5zaW4oZGVsdGFMb25CeTIpICpcclxuICAgICAgTWF0aC5jb3MobGF0MSkgKiBNYXRoLmNvcyhsYXQyKTtcclxuICByZXR1cm4gMiAqIHRoaXMucmFkaXVzICogTWF0aC5hdGFuMihNYXRoLnNxcnQoYSksIE1hdGguc3FydCgxIC0gYSkpO1xyXG59O1xyXG5cclxuV0dTODRTcGhlcmUucHJvdG90eXBlLmludGVycG9sYXRlID0gZnVuY3Rpb24oYzEsIGMyLCBmcmFjdGlvbikge1xyXG4gIHZhciBsYXQxID0gdG9SYWRpYW5zKGMxWzFdKTtcclxuICB2YXIgbG9uMSA9IHRvUmFkaWFucyhjMVswXSk7XHJcbiAgdmFyIGxhdDIgPSB0b1JhZGlhbnMoYzJbMV0pO1xyXG4gIHZhciBsb24yID0gdG9SYWRpYW5zKGMyWzBdKTtcclxuICB2YXIgY29zTGF0MSA9IE1hdGguY29zKGxhdDEpO1xyXG4gIHZhciBzaW5MYXQxID0gTWF0aC5zaW4obGF0MSk7XHJcbiAgdmFyIGNvc0xhdDIgPSBNYXRoLmNvcyhsYXQyKTtcclxuICB2YXIgc2luTGF0MiA9IE1hdGguc2luKGxhdDIpO1xyXG4gIHZhciBjb3NEZWx0YUxvbiA9IE1hdGguY29zKGxvbjIgLSBsb24xKTtcclxuICB2YXIgZCA9IHNpbkxhdDEgKiBzaW5MYXQyICsgY29zTGF0MSAqIGNvc0xhdDIgKiBjb3NEZWx0YUxvbjtcclxuICBpZiAoMSA8PSBkKSB7XHJcbiAgICByZXR1cm4gYzIuc2xpY2UoKTtcclxuICB9XHJcbiAgZCA9IGZyYWN0aW9uICogTWF0aC5hY29zKGQpO1xyXG4gIHZhciBjb3NEID0gTWF0aC5jb3MoZCk7XHJcbiAgdmFyIHNpbkQgPSBNYXRoLnNpbihkKTtcclxuICB2YXIgeSA9IE1hdGguc2luKGxvbjIgLSBsb24xKSAqIGNvc0xhdDI7XHJcbiAgdmFyIHggPSBjb3NMYXQxICogc2luTGF0MiAtIHNpbkxhdDEgKiBjb3NMYXQyICogY29zRGVsdGFMb247XHJcbiAgdmFyIHRoZXRhID0gTWF0aC5hdGFuMih5LCB4KTtcclxuICB2YXIgbGF0ID0gTWF0aC5hc2luKHNpbkxhdDEgKiBjb3NEICsgY29zTGF0MSAqIHNpbkQgKiBNYXRoLmNvcyh0aGV0YSkpO1xyXG4gIHZhciBsb24gPSBsb24xICsgTWF0aC5hdGFuMihNYXRoLnNpbih0aGV0YSkgKiBzaW5EICogY29zTGF0MSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29zRCAtIHNpbkxhdDEgKiBNYXRoLnNpbihsYXQpKTtcclxuICByZXR1cm4gW3RvRGVncmVlcyhsb24pLCB0b0RlZ3JlZXMobGF0KV07XHJcbn07XHJcblxyXG5XR1M4NFNwaGVyZS5wcm90b3R5cGUuaW5pdGlhbEJlYXJpbmcgPSBmdW5jdGlvbihjMSwgYzIpIHtcclxuICB2YXIgbGF0MSA9IHRvUmFkaWFucyhjMVsxXSk7XHJcbiAgdmFyIGxhdDIgPSB0b1JhZGlhbnMoYzJbMV0pO1xyXG4gIHZhciBkZWx0YUxvbiA9IHRvUmFkaWFucyhjMlswXSAtIGMxWzBdKTtcclxuICB2YXIgeSA9IE1hdGguc2luKGRlbHRhTG9uKSAqIE1hdGguY29zKGxhdDIpO1xyXG4gIHZhciB4ID0gTWF0aC5jb3MobGF0MSkgKiBNYXRoLnNpbihsYXQyKSAtXHJcbiAgICAgIE1hdGguc2luKGxhdDEpICogTWF0aC5jb3MobGF0MikgKiBNYXRoLmNvcyhkZWx0YUxvbik7XHJcbiAgcmV0dXJuIHRvRGVncmVlcyhNYXRoLmF0YW4yKHksIHgpKTtcclxufTtcclxuXHJcbldHUzg0U3BoZXJlLnByb3RvdHlwZS5tYXhpbXVtTGF0aXR1ZGUgPSBmdW5jdGlvbihiZWFyaW5nLCBsYXRpdHVkZSkge1xyXG4gIHJldHVybiBNYXRoLmNvcyhNYXRoLmFicyhNYXRoLnNpbih0b1JhZGlhbnMoYmVhcmluZykpICpcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgTWF0aC5jb3ModG9SYWRpYW5zKGxhdGl0dWRlKSkpKTtcclxufTtcclxuXHJcbldHUzg0U3BoZXJlLnByb3RvdHlwZS5taWRwb2ludCA9IGZ1bmN0aW9uKGMxLCBjMikge1xyXG4gIHZhciBsYXQxID0gdG9SYWRpYW5zKGMxWzFdKTtcclxuICB2YXIgbGF0MiA9IHRvUmFkaWFucyhjMlsxXSk7XHJcbiAgdmFyIGxvbjEgPSB0b1JhZGlhbnMoYzFbMF0pO1xyXG4gIHZhciBkZWx0YUxvbiA9IHRvUmFkaWFucyhjMlswXSAtIGMxWzBdKTtcclxuICB2YXIgQnggPSBNYXRoLmNvcyhsYXQyKSAqIE1hdGguY29zKGRlbHRhTG9uKTtcclxuICB2YXIgQnkgPSBNYXRoLmNvcyhsYXQyKSAqIE1hdGguc2luKGRlbHRhTG9uKTtcclxuICB2YXIgY29zTGF0MVBsdXNCeCA9IE1hdGguY29zKGxhdDEpICsgQng7XHJcbiAgdmFyIGxhdCA9IE1hdGguYXRhbjIoTWF0aC5zaW4obGF0MSkgKyBNYXRoLnNpbihsYXQyKSxcclxuICAgICAgICAgICAgICAgICAgICAgICBNYXRoLnNxcnQoY29zTGF0MVBsdXNCeCAqIGNvc0xhdDFQbHVzQnggKyBCeSAqIEJ5KSk7XHJcbiAgdmFyIGxvbiA9IGxvbjEgKyBNYXRoLmF0YW4yKEJ5LCBjb3NMYXQxUGx1c0J4KTtcclxuICByZXR1cm4gW3RvRGVncmVlcyhsb24pLCB0b0RlZ3JlZXMobGF0KV07XHJcbn07XHJcblxyXG5XR1M4NFNwaGVyZS5wcm90b3R5cGUub2Zmc2V0ID0gZnVuY3Rpb24oYzEsIGRpc3RhbmNlLCBiZWFyaW5nKSB7XHJcbiAgdmFyIGxhdDEgPSB0b1JhZGlhbnMoYzFbMV0pO1xyXG4gIHZhciBsb24xID0gdG9SYWRpYW5zKGMxWzBdKTtcclxuICB2YXIgZEJ5UiA9IGRpc3RhbmNlIC8gdGhpcy5yYWRpdXM7XHJcbiAgdmFyIGxhdCA9IE1hdGguYXNpbihcclxuICAgICAgTWF0aC5zaW4obGF0MSkgKiBNYXRoLmNvcyhkQnlSKSArXHJcbiAgICAgIE1hdGguY29zKGxhdDEpICogTWF0aC5zaW4oZEJ5UikgKiBNYXRoLmNvcyhiZWFyaW5nKSk7XHJcbiAgdmFyIGxvbiA9IGxvbjEgKyBNYXRoLmF0YW4yKFxyXG4gICAgICBNYXRoLnNpbihiZWFyaW5nKSAqIE1hdGguc2luKGRCeVIpICogTWF0aC5jb3MobGF0MSksXHJcbiAgICAgIE1hdGguY29zKGRCeVIpIC0gTWF0aC5zaW4obGF0MSkgKiBNYXRoLnNpbihsYXQpKTtcclxuICByZXR1cm4gW3RvRGVncmVlcyhsb24pLCB0b0RlZ3JlZXMobGF0KV07XHJcbn07XHJcblxyXG4vKipcclxuICogQ2hlY2tzIHdoZXRoZXIgb2JqZWN0IGlzIG5vdCBudWxsIGFuZCBub3QgdW5kZWZpbmVkXHJcbiAqIEBwYXJhbSB7Kn0gb2JqIG9iamVjdCB0byBiZSBjaGVja2VkXHJcbiAqIEByZXR1cm4ge2Jvb2xlYW59XHJcbiAqL1xyXG5cclxuZnVuY3Rpb24gaXNEZWZpbmVkKG9iaikge1xyXG4gICAgcmV0dXJuIG51bGwgIT0gb2JqICYmIHVuZGVmaW5lZCAhPSBvYmo7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGlzTnVtZXJpYyh3aCkge1xyXG4gICAgcmV0dXJuICFpc05hTihwYXJzZUZsb2F0KHdoKSkgJiYgaXNGaW5pdGUod2gpO1xyXG59XHJcblxyXG5mdW5jdGlvbiBpc0Z1bmN0aW9uKHdoKSB7XHJcbiAgICBpZiAoIXdoKSB7XHJcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuICh3aCBpbnN0YW5jZW9mIEZ1bmN0aW9uIHx8IHR5cGVvZiB3aCA9PSBcImZ1bmN0aW9uXCIpO1xyXG59XHJcblxyXG5mdW5jdGlvbiBpc1N0cmluZ05vdEVtcHR5KHdoKSB7XHJcbiAgICBpZiAoIXdoKSB7XHJcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuICh3aCBpbnN0YW5jZW9mIFN0cmluZyB8fCB0eXBlb2Ygd2ggPT0gXCJzdHJpbmdcIik7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGlzU3RyKHdoKSB7XHJcbiAgICByZXR1cm4gKHdoIGluc3RhbmNlb2YgU3RyaW5nIHx8IHR5cGVvZiB3aCA9PT0gXCJzdHJpbmdcIik7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGlzQm9vbGVhbih3aCkge1xyXG4gICAgcmV0dXJuICh3aCBpbnN0YW5jZW9mIEJvb2xlYW4gfHwgdHlwZW9mIHdoID09IFwiYm9vbGVhblwiKTtcclxufVxyXG5cclxuZnVuY3Rpb24gbXlUcmltKHgpIHtcclxuICAgIHJldHVybiB4LnJlcGxhY2UoL15cXHMrfFxccyskL2dtLCcnKTtcclxufVxyXG5cclxuZnVuY3Rpb24gbXlUcmltQ29vcmRpbmF0ZSh4KSB7XHJcblx0ZG8ge1xyXG5cdFx0dmFyIGs9eDtcclxuXHRcdHg9bXlUcmltKHgpO1xyXG5cdFx0aWYgKGsgIT0geCkgXHJcblx0XHRcdGNvbnRpbnVlO1xyXG5cdFx0aWYgKHgubGVuZ3RoKSBcclxuXHRcdHtcclxuXHRcdFx0aWYgKHhbMF0gPT0gXCIsXCIpXHJcblx0XHRcdFx0eD14LnN1YnN0cmluZygxLHgubGVuZ3RoKTtcclxuXHRcdFx0ZWxzZSBpZiAoa1trLmxlbmd0aC0xXSA9PSBcIixcIilcclxuXHRcdFx0XHR4PXguc3Vic3RyaW5nKDAseC5sZW5ndGgtMSk7XHJcblx0XHRcdGVsc2VcclxuXHRcdFx0XHRicmVhaztcclxuXHRcdFx0Y29udGludWU7XHJcblx0XHR9XHJcblx0XHRicmVhaztcclxuXHR9IHdoaWxlICh0cnVlKTtcclxuXHRyZXR1cm4geDtcclxufVxyXG5cclxuXHJcbmZ1bmN0aW9uIGNsb3Nlc3RQcm9qZWN0aW9uT2ZQb2ludE9uTGluZSh4LHkseDEseTEseDIseTIpIFxyXG57XHJcblx0dmFyIHN0YXR1cztcclxuXHR2YXIgUDE9bnVsbDtcclxuXHR2YXIgUDI9bnVsbDtcclxuXHR2YXIgUDM9bnVsbDtcclxuXHR2YXIgUDQ9bnVsbDtcclxuXHR2YXIgcDE9W107XHJcbiAgICB2YXIgcDI9W107XHJcbiAgICB2YXIgcDM9W107XHJcblx0dmFyIHA0PVtdO1xyXG4gICAgdmFyIGludGVyc2VjdGlvblBvaW50PW51bGw7XHJcbiAgICB2YXIgZGlzdE1pblBvaW50PW51bGw7XHJcbiAgICB2YXIgZGVub21pbmF0b3I9MDtcclxuICAgIHZhciBub21pbmF0b3I9MDtcclxuICAgIHZhciB1PTA7XHJcbiAgICB2YXIgZGlzdE9ydGhvPTA7XHJcbiAgICB2YXIgZGlzdFAxPTA7XHJcbiAgICB2YXIgZGlzdFAyPTA7XHJcbiAgICB2YXIgZGlzdE1pbj0wO1xyXG4gICAgdmFyIGRpc3RNYXg9MDtcclxuICAgXHJcbiAgICBmdW5jdGlvbiBpbnRlcnNlY3Rpb24oKVxyXG4gICAge1xyXG4gICAgICAgIHZhciBheCA9IHAxWzBdICsgdSAqIChwMlswXSAtIHAxWzBdKTtcclxuICAgICAgICB2YXIgYXkgPSBwMVsxXSArIHUgKiAocDJbMV0gLSBwMVsxXSk7XHJcbiAgICAgICAgcDQgPSBbYXgsIGF5XTtcclxuICAgICAgICBpbnRlcnNlY3Rpb25Qb2ludCA9IFtheCxheV07XHJcbiAgICB9XHJcblxyXG4gICAgZnVuY3Rpb24gZGlzdGFuY2UoKVxyXG4gICAge1xyXG4gICAgICAgIHZhciBheCA9IHAxWzBdICsgdSAqIChwMlswXSAtIHAxWzBdKTtcclxuICAgICAgICB2YXIgYXkgPSBwMVsxXSArIHUgKiAocDJbMV0gLSBwMVsxXSk7XHJcbiAgICAgICAgcDQgPSBbYXgsIGF5XTtcclxuICAgICAgICBkaXN0T3J0aG8gPSBNYXRoLnNxcnQoTWF0aC5wb3coKHA0WzBdIC0gcDNbMF0pLDIpICsgTWF0aC5wb3coKHA0WzFdIC0gcDNbMV0pLDIpKTtcclxuICAgICAgICBkaXN0UDEgICAgPSBNYXRoLnNxcnQoTWF0aC5wb3coKHAxWzBdIC0gcDNbMF0pLDIpICsgTWF0aC5wb3coKHAxWzFdIC0gcDNbMV0pLDIpKTtcclxuICAgICAgICBkaXN0UDIgICAgPSBNYXRoLnNxcnQoTWF0aC5wb3coKHAyWzBdIC0gcDNbMF0pLDIpICsgTWF0aC5wb3coKHAyWzFdIC0gcDNbMV0pLDIpKTtcclxuICAgICAgICBpZih1Pj0wICYmIHU8PTEpXHJcbiAgICAgICAgeyAgIGRpc3RNaW4gPSBkaXN0T3J0aG87XHJcbiAgICAgICAgICAgIGRpc3RNaW5Qb2ludCA9IGludGVyc2VjdGlvblBvaW50O1xyXG4gICAgICAgIH1cclxuICAgICAgICBlbHNlXHJcbiAgICAgICAgeyAgIGlmKGRpc3RQMSA8PSBkaXN0UDIpXHJcbiAgICAgICAgICAgIHsgICBkaXN0TWluID0gZGlzdFAxO1xyXG4gICAgICAgICAgICAgICAgZGlzdE1pblBvaW50ID0gUDE7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgZWxzZVxyXG4gICAgICAgICAgICB7ICAgZGlzdE1pbiA9IGRpc3RQMjtcclxuICAgICAgICAgICAgICAgIGRpc3RNaW5Qb2ludCA9IFAyO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGRpc3RNYXggPSBNYXRoLm1heChNYXRoLm1heChkaXN0T3J0aG8sIGRpc3RQMSksIGRpc3RQMik7XHJcbiAgICB9XHJcblx0UDEgPSBbeDEseTFdO1xyXG5cdFAyID0gW3gyLHkyXTtcclxuXHRQMyA9IFt4LHldO1xyXG5cdHAxID0gW3gxLCB5MV07XHJcblx0cDIgPSBbeDIsIHkyXTtcclxuXHRwMyA9IFt4LCB5XTtcclxuXHRkZW5vbWluYXRvciA9IE1hdGgucG93KE1hdGguc3FydChNYXRoLnBvdyhwMlswXS1wMVswXSwyKSArIE1hdGgucG93KHAyWzFdLXAxWzFdLDIpKSwyICk7XHJcblx0bm9taW5hdG9yICAgPSAocDNbMF0gLSBwMVswXSkgKiAocDJbMF0gLSBwMVswXSkgKyAocDNbMV0gLSBwMVsxXSkgKiAocDJbMV0gLSBwMVsxXSk7XHJcblx0aWYoZGVub21pbmF0b3I9PTApXHJcblx0eyAgIHN0YXR1cyA9IFwiY29pbmNpZGVudGFsXCJcclxuXHRcdHUgPSAtOTk5O1xyXG5cdH1cclxuXHRlbHNlXHJcblx0eyAgIHUgPSBub21pbmF0b3IgLyBkZW5vbWluYXRvcjtcclxuXHRcdGlmKHUgPj0wICYmIHUgPD0gMSlcclxuXHRcdFx0c3RhdHVzID0gXCJvcnRob2dvbmFsXCI7XHJcblx0XHRlbHNlXHJcblx0XHRcdHN0YXR1cyA9IFwib2JsaXF1ZVwiO1xyXG5cdH1cclxuXHRpbnRlcnNlY3Rpb24oKTtcclxuXHRkaXN0YW5jZSgpO1xyXG5cdFxyXG5cdHJldHVybiB7IHN0YXR1cyA6IHN0YXR1cywgcG9zIDogZGlzdE1pblBvaW50LCBtaW4gOiBkaXN0TWluIH07XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGNvbG9yTHVtaW5hbmNlKGhleCwgbHVtKSB7XHJcbiAgICAvLyBWYWxpZGF0ZSBoZXggc3RyaW5nXHJcbiAgICBoZXggPSBTdHJpbmcoaGV4KS5yZXBsYWNlKC9bXjAtOWEtZl0vZ2ksIFwiXCIpO1xyXG4gICAgaWYgKGhleC5sZW5ndGggPCA2KSB7XHJcbiAgICAgICAgaGV4ID0gaGV4LnJlcGxhY2UoLyguKS9nLCAnJDEkMScpO1xyXG4gICAgfVxyXG4gICAgbHVtID0gbHVtIHx8IDA7XHJcbiAgICAvLyBDb252ZXJ0IHRvIGRlY2ltYWwgYW5kIGNoYW5nZSBsdW1pbm9zaXR5XHJcbiAgICB2YXIgcmdiID0gXCIjXCIsXHJcbiAgICAgICAgYztcclxuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgMzsgKytpKSB7XHJcbiAgICAgICAgYyA9IHBhcnNlSW50KGhleC5zdWJzdHIoaSAqIDIsIDIpLCAxNik7XHJcbiAgICAgICAgYyA9IE1hdGgucm91bmQoTWF0aC5taW4oTWF0aC5tYXgoMCwgYyArIChjICogbHVtKSksIDI1NSkpLnRvU3RyaW5nKDE2KTtcclxuICAgICAgICByZ2IgKz0gKFwiMDBcIiArIGMpLnN1YnN0cihjLmxlbmd0aCk7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gcmdiO1xyXG59XHJcblxyXG5mdW5jdGlvbiBpbmNyZWFzZUJyaWdodG5lc3MoaGV4LCBwZXJjZW50KSBcclxue1xyXG4gICAgaGV4ID0gU3RyaW5nKGhleCkucmVwbGFjZSgvW14wLTlhLWZdL2dpLCBcIlwiKTtcclxuICAgIGlmIChoZXgubGVuZ3RoIDwgNikge1xyXG4gICAgICAgIGhleCA9IGhleC5yZXBsYWNlKC8oLikvZywgJyQxJDEnKTtcclxuICAgIH1cclxuICAgIHZhciByZ2IgPSBcIiNcIixcclxuICAgICAgICBjO1xyXG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCAzOyArK2kpIHtcclxuICAgICAgICBjID0gcGFyc2VJbnQoaGV4LnN1YnN0cihpICogMiwgMiksIDE2KTtcclxuICAgICAgICBjID0gcGFyc2VJbnQoKGMqKDEwMC1wZXJjZW50KSsyNTUqcGVyY2VudCkvMTAwKTtcclxuICAgICAgICBpZiAoYyA+IDI1NSlcclxuICAgICAgICBcdGM9MjU1O1xyXG4gICAgICAgIGM9Yy50b1N0cmluZygxNik7XHJcbiAgICAgICAgcmdiICs9IChcIjAwXCIgKyBjKS5zdWJzdHIoYy5sZW5ndGgpO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIHJnYjtcclxufVxyXG5cclxuZnVuY3Rpb24gY29sb3JBbHBoYUFycmF5KGhleCwgYWxwaGEpIHtcclxuICAgIGhleCA9IFN0cmluZyhoZXgpLnJlcGxhY2UoL1teMC05YS1mXS9naSwgXCJcIik7XHJcbiAgICBpZiAoaGV4Lmxlbmd0aCA8IDYpIHtcclxuICAgICAgICBoZXggPSBoZXgucmVwbGFjZSgvKC4pL2csICckMSQxJyk7XHJcbiAgICB9XHJcbiAgICB2YXIgcmVzPVtdO1xyXG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCAzOyArK2kpIHtcclxuICAgICAgICBjID0gcGFyc2VJbnQoaGV4LnN1YnN0cihpICogMiwgMiksIDE2KTtcclxuICAgICAgICByZXMucHVzaChjKTtcclxuICAgIH1cclxuICAgIHJlcy5wdXNoKGFscGhhKTtcclxuICAgIHJldHVybiByZXM7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGVzY2FwZUhUTUwodW5zYWZlKSB7XHJcbiAgICByZXR1cm4gdW5zYWZlXHJcbiAgICAgICAgIC5yZXBsYWNlKC8mL2csIFwiJmFtcDtcIilcclxuICAgICAgICAgLnJlcGxhY2UoLzwvZywgXCImbHQ7XCIpXHJcbiAgICAgICAgIC5yZXBsYWNlKC8+L2csIFwiJmd0O1wiKVxyXG4gICAgICAgICAucmVwbGFjZSgvXCIvZywgXCImcXVvdDtcIilcclxuICAgICAgICAgLnJlcGxhY2UoLycvZywgXCImIzAzOTtcIik7XHJcbiB9XHJcblxyXG5mdW5jdGlvbiBmb3JtYXROdW1iZXIyKHZhbCkge1xyXG5cdHJldHVybiBwYXJzZUZsb2F0KE1hdGgucm91bmQodmFsICogMTAwKSAvIDEwMCkudG9GaXhlZCgyKTtcclxufVxyXG5mdW5jdGlvbiBmb3JtYXREYXRlKGQpIHtcclxuIFx0dmFyIGRkID0gZC5nZXREYXRlKCk7XHJcbiAgICB2YXIgbW0gPSBkLmdldE1vbnRoKCkrMTsgLy9KYW51YXJ5IGlzIDAhXHJcbiAgICB2YXIgeXl5eSA9IGQuZ2V0RnVsbFllYXIoKTtcclxuICAgIGlmKGRkPDEwKXtcclxuICAgICAgICBkZD0nMCcrZGQ7XHJcbiAgICB9IFxyXG4gICAgaWYobW08MTApe1xyXG4gICAgICAgIG1tPScwJyttbTtcclxuICAgIH0gXHJcbiAgICByZXR1cm4gZGQrJy4nK21tKycuJyt5eXl5O1xyXG59XHJcblxyXG5mdW5jdGlvbiBmb3JtYXRUaW1lKGQpIHtcclxuICAgIHZhciBoaCA9IGQuZ2V0SG91cnMoKTtcclxuICAgIGlmKGhoPDEwKXtcclxuICAgIFx0aGg9JzAnK2hoO1xyXG4gICAgfSBcclxuICAgIHZhciBtbSA9IGQuZ2V0TWludXRlcygpO1xyXG4gICAgaWYobW08MTApe1xyXG4gICAgICAgIG1tPScwJyttbTtcclxuICAgIH0gXHJcbiAgICByZXR1cm4gaGgrXCI6XCIrbW07XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGZvcm1hdERhdGVUaW1lKGQpIHtcclxuXHRyZXR1cm4gZm9ybWF0RGF0ZShkKStcIiBcIitmb3JtYXRUaW1lKGQpO1xyXG59XHJcblxyXG5mdW5jdGlvbiBmb3JtYXREYXRlVGltZVNlYyhkKSB7XHJcblx0cmV0dXJuIGZvcm1hdERhdGUoZCkrXCIgXCIrZm9ybWF0VGltZVNlYyhkKTtcclxufVxyXG5cclxuZnVuY3Rpb24gZm9ybWF0VGltZVNlYyhkKSB7XHJcbiAgICB2YXIgaGggPSBkLmdldEhvdXJzKCk7XHJcbiAgICBpZihoaDwxMCl7XHJcbiAgICBcdGhoPScwJytoaDtcclxuICAgIH0gXHJcbiAgICB2YXIgbW0gPSBkLmdldE1pbnV0ZXMoKTtcclxuICAgIGlmKG1tPDEwKXtcclxuICAgICAgICBtbT0nMCcrbW07XHJcbiAgICB9IFxyXG4gICAgdmFyIHNzID0gZC5nZXRTZWNvbmRzKCk7XHJcbiAgICBpZihzczwxMCl7XHJcbiAgICAgICAgc3M9JzAnK3NzO1xyXG4gICAgfSBcclxuICAgIHJldHVybiBoaCtcIjpcIittbStcIjpcIitzcztcclxufVxyXG5cclxuZnVuY3Rpb24gcmFpbmJvdyhudW1PZlN0ZXBzLCBzdGVwKSB7XHJcbiAgICAvLyBUaGlzIGZ1bmN0aW9uIGdlbmVyYXRlcyB2aWJyYW50LCBcImV2ZW5seSBzcGFjZWRcIiBjb2xvdXJzIChpLmUuIG5vIGNsdXN0ZXJpbmcpLiBUaGlzIGlzIGlkZWFsIGZvciBjcmVhdGluZyBlYXNpbHkgZGlzdGluZ3Vpc2hhYmxlIHZpYnJhbnQgbWFya2VycyBpbiBHb29nbGUgTWFwcyBhbmQgb3RoZXIgYXBwcy5cclxuICAgIC8vIEFkYW0gQ29sZSwgMjAxMS1TZXB0LTE0XHJcbiAgICAvLyBIU1YgdG8gUkJHIGFkYXB0ZWQgZnJvbTogaHR0cDovL21qaWphY2tzb24uY29tLzIwMDgvMDIvcmdiLXRvLWhzbC1hbmQtcmdiLXRvLWhzdi1jb2xvci1tb2RlbC1jb252ZXJzaW9uLWFsZ29yaXRobXMtaW4tamF2YXNjcmlwdFxyXG4gICAgdmFyIHIsIGcsIGI7XHJcbiAgICB2YXIgaCA9IHN0ZXAgLyBudW1PZlN0ZXBzO1xyXG4gICAgdmFyIGkgPSB+fihoICogNik7XHJcbiAgICB2YXIgZiA9IGggKiA2IC0gaTtcclxuICAgIHZhciBxID0gMSAtIGY7XHJcbiAgICBzd2l0Y2goaSAlIDYpe1xyXG4gICAgICAgIGNhc2UgMDogciA9IDEsIGcgPSBmLCBiID0gMDsgYnJlYWs7XHJcbiAgICAgICAgY2FzZSAxOiByID0gcSwgZyA9IDEsIGIgPSAwOyBicmVhaztcclxuICAgICAgICBjYXNlIDI6IHIgPSAwLCBnID0gMSwgYiA9IGY7IGJyZWFrO1xyXG4gICAgICAgIGNhc2UgMzogciA9IDAsIGcgPSBxLCBiID0gMTsgYnJlYWs7XHJcbiAgICAgICAgY2FzZSA0OiByID0gZiwgZyA9IDAsIGIgPSAxOyBicmVhaztcclxuICAgICAgICBjYXNlIDU6IHIgPSAxLCBnID0gMCwgYiA9IHE7IGJyZWFrO1xyXG4gICAgfVxyXG4gICAgdmFyIGMgPSBcIiNcIiArIChcIjAwXCIgKyAofiB+KHIgKiAyNTUpKS50b1N0cmluZygxNikpLnNsaWNlKC0yKSArIChcIjAwXCIgKyAofiB+KGcgKiAyNTUpKS50b1N0cmluZygxNikpLnNsaWNlKC0yKSArIChcIjAwXCIgKyAofiB+KGIgKiAyNTUpKS50b1N0cmluZygxNikpLnNsaWNlKC0yKTtcclxuICAgIHJldHVybiAoYyk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIG1vYmlsZUFuZFRhYmxldENoZWNrKCkgXHJcbntcclxuXHQgIGlmICh0eXBlb2YgbmF2aWdhdG9yID09IFwidW5kZWZpbmVkXCIpXHJcblx0XHQgIHJldHVybiBmYWxzZTtcclxuXHQgIHZhciBjaGVjayA9IGZhbHNlO1xyXG5cdCAgKGZ1bmN0aW9uKGEpe2lmKC8oYW5kcm9pZHxiYlxcZCt8bWVlZ28pLittb2JpbGV8YXZhbnRnb3xiYWRhXFwvfGJsYWNrYmVycnl8YmxhemVyfGNvbXBhbHxlbGFpbmV8ZmVubmVjfGhpcHRvcHxpZW1vYmlsZXxpcChob25lfG9kKXxpcmlzfGtpbmRsZXxsZ2UgfG1hZW1vfG1pZHB8bW1wfG1vYmlsZS4rZmlyZWZveHxuZXRmcm9udHxvcGVyYSBtKG9ifGluKWl8cGFsbSggb3MpP3xwaG9uZXxwKGl4aXxyZSlcXC98cGx1Y2tlcnxwb2NrZXR8cHNwfHNlcmllcyg0fDYpMHxzeW1iaWFufHRyZW98dXBcXC4oYnJvd3NlcnxsaW5rKXx2b2RhZm9uZXx3YXB8d2luZG93cyBjZXx4ZGF8eGlpbm98YW5kcm9pZHxpcGFkfHBsYXlib29rfHNpbGsvaS50ZXN0KGEpfHwvMTIwN3w2MzEwfDY1OTB8M2dzb3w0dGhwfDUwWzEtNl1pfDc3MHN8ODAyc3xhIHdhfGFiYWN8YWMoZXJ8b298c1xcLSl8YWkoa298cm4pfGFsKGF2fGNhfGNvKXxhbW9pfGFuKGV4fG55fHl3KXxhcHR1fGFyKGNofGdvKXxhcyh0ZXx1cyl8YXR0d3xhdShkaXxcXC1tfHIgfHMgKXxhdmFufGJlKGNrfGxsfG5xKXxiaShsYnxyZCl8YmwoYWN8YXopfGJyKGV8dil3fGJ1bWJ8YndcXC0obnx1KXxjNTVcXC98Y2FwaXxjY3dhfGNkbVxcLXxjZWxsfGNodG18Y2xkY3xjbWRcXC18Y28obXB8bmQpfGNyYXd8ZGEoaXR8bGx8bmcpfGRidGV8ZGNcXC1zfGRldml8ZGljYXxkbW9ifGRvKGN8cClvfGRzKDEyfFxcLWQpfGVsKDQ5fGFpKXxlbShsMnx1bCl8ZXIoaWN8azApfGVzbDh8ZXooWzQtN10wfG9zfHdhfHplKXxmZXRjfGZseShcXC18Xyl8ZzEgdXxnNTYwfGdlbmV8Z2ZcXC01fGdcXC1tb3xnbyhcXC53fG9kKXxncihhZHx1bil8aGFpZXxoY2l0fGhkXFwtKG18cHx0KXxoZWlcXC18aGkocHR8dGEpfGhwKCBpfGlwKXxoc1xcLWN8aHQoYyhcXC18IHxffGF8Z3xwfHN8dCl8dHApfGh1KGF3fHRjKXxpXFwtKDIwfGdvfG1hKXxpMjMwfGlhYyggfFxcLXxcXC8pfGlicm98aWRlYXxpZzAxfGlrb218aW0xa3xpbm5vfGlwYXF8aXJpc3xqYSh0fHYpYXxqYnJvfGplbXV8amlnc3xrZGRpfGtlaml8a2d0KCB8XFwvKXxrbG9ufGtwdCB8a3djXFwtfGt5byhjfGspfGxlKG5vfHhpKXxsZyggZ3xcXC8oa3xsfHUpfDUwfDU0fFxcLVthLXddKXxsaWJ3fGx5bnh8bTFcXC13fG0zZ2F8bTUwXFwvfG1hKHRlfHVpfHhvKXxtYygwMXwyMXxjYSl8bVxcLWNyfG1lKHJjfHJpKXxtaShvOHxvYXx0cyl8bW1lZnxtbygwMXwwMnxiaXxkZXxkb3x0KFxcLXwgfG98dil8enopfG10KDUwfHAxfHYgKXxtd2JwfG15d2F8bjEwWzAtMl18bjIwWzItM118bjMwKDB8Mil8bjUwKDB8Mnw1KXxuNygwKDB8MSl8MTApfG5lKChjfG0pXFwtfG9ufHRmfHdmfHdnfHd0KXxub2soNnxpKXxuenBofG8yaW18b3AodGl8d3YpfG9yYW58b3dnMXxwODAwfHBhbihhfGR8dCl8cGR4Z3xwZygxM3xcXC0oWzEtOF18YykpfHBoaWx8cGlyZXxwbChheXx1Yyl8cG5cXC0yfHBvKGNrfHJ0fHNlKXxwcm94fHBzaW98cHRcXC1nfHFhXFwtYXxxYygwN3wxMnwyMXwzMnw2MHxcXC1bMi03XXxpXFwtKXxxdGVrfHIzODB8cjYwMHxyYWtzfHJpbTl8cm8odmV8em8pfHM1NVxcL3xzYShnZXxtYXxtbXxtc3xueXx2YSl8c2MoMDF8aFxcLXxvb3xwXFwtKXxzZGtcXC98c2UoYyhcXC18MHwxKXw0N3xtY3xuZHxyaSl8c2doXFwtfHNoYXJ8c2llKFxcLXxtKXxza1xcLTB8c2woNDV8aWQpfHNtKGFsfGFyfGIzfGl0fHQ1KXxzbyhmdHxueSl8c3AoMDF8aFxcLXx2XFwtfHYgKXxzeSgwMXxtYil8dDIoMTh8NTApfHQ2KDAwfDEwfDE4KXx0YShndHxsayl8dGNsXFwtfHRkZ1xcLXx0ZWwoaXxtKXx0aW1cXC18dFxcLW1vfHRvKHBsfHNoKXx0cyg3MHxtXFwtfG0zfG01KXx0eFxcLTl8dXAoXFwuYnxnMXxzaSl8dXRzdHx2NDAwfHY3NTB8dmVyaXx2aShyZ3x0ZSl8dmsoNDB8NVswLTNdfFxcLXYpfHZtNDB8dm9kYXx2dWxjfHZ4KDUyfDUzfDYwfDYxfDcwfDgwfDgxfDgzfDg1fDk4KXx3M2MoXFwtfCApfHdlYmN8d2hpdHx3aShnIHxuY3xudyl8d21sYnx3b251fHg3MDB8eWFzXFwtfHlvdXJ8emV0b3x6dGVcXC0vaS50ZXN0KGEuc3Vic3RyKDAsNCkpKWNoZWNrID0gdHJ1ZX0pKG5hdmlnYXRvci51c2VyQWdlbnR8fG5hdmlnYXRvci52ZW5kb3J8fHdpbmRvdy5vcGVyYSk7XHJcblx0ICByZXR1cm4gY2hlY2s7XHJcbn1cclxuXHJcbnZhciBSRU5ERVJFREFSUk9XUz17fTtcclxuZnVuY3Rpb24gcmVuZGVyQXJyb3dCYXNlNjQod2lkdGgsaGVpZ2h0LGNvbG9yKSBcclxue1xyXG5cdHZhciBrZXkgPSB3aWR0aCtcInhcIitoZWlnaHQrXCI6XCIrY29sb3I7XHJcblx0aWYgKFJFTkRFUkVEQVJST1dTW2tleV0pXHJcblx0XHRyZXR1cm4gUkVOREVSRURBUlJPV1Nba2V5XTtcclxuXHR2YXIgYnJkY29sID0gXCIjZmVmZWZlXCI7IC8vaW5jcmVhc2VCcmlnaHRuZXNzKGNvbG9yLDk5KTtcclxuXHRcclxuXHR2YXIgc3ZnPSc8c3ZnIHZlcnNpb249XCIxLjFcIiBpZD1cIkxheWVyXzFcIiB4bWxucz1cImh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnXCIgeG1sbnM6eGxpbms9XCJodHRwOi8vd3d3LnczLm9yZy8xOTk5L3hsaW5rXCIgeD1cIjBweFwiIHk9XCIwcHhcIiB3aWR0aD1cIicrd2lkdGgrJ3B0XCIgaGVpZ2h0PVwiJytoZWlnaHQrJ3B0XCIgJ1x0XHJcblx0Kyd2aWV3Qm94PVwiMTM3LjgzNCAtODIuODMzIDExNCA5MS4zMzNcIiBlbmFibGUtYmFja2dyb3VuZD1cIm5ldyAxMzcuODM0IC04Mi44MzMgMTE0IDkxLjMzM1wiIHhtbDpzcGFjZT1cInByZXNlcnZlXCI+J1xyXG5cdCsnPHBhdGggZmlsbD1cIm5vbmVcIiBkPVwiTS01MS0yLjE2N2g0OHY0OGgtNDhWLTIuMTY3elwiLz4nXHJcblx0Kyc8Y2lyY2xlIGRpc3BsYXk9XCJub25lXCIgZmlsbD1cIiM2MDVDQzlcIiBjeD1cIjUxLjI4NlwiIGN5PVwiLTM1LjI4NlwiIHI9XCI4OC43ODZcIi8+J1xyXG5cdCsnPHBhdGggZmlsbD1cIiM2MDVDQzlcIiBzdHJva2U9XCIjRkZGRkZGXCIgc3Ryb2tlLXdpZHRoPVwiNFwiIHN0cm9rZS1taXRlcmxpbWl0PVwiMTBcIiBkPVwiTTIzOS41LTM2LjhsLTkyLjU1OC0zNS42OSBjNS4yMTYsMTEuMzA0LDguMTMsMjMuODg3LDguMTMsMzcuMTUzYzAsMTIuMTctMi40NTEsMjMuNzY3LTYuODgzLDM0LjMyN0wyMzkuNS0zNi44elwiLz4nXHJcblx0Kyc8L3N2Zz4nXHJcblx0dmFyIHN2Zz1zdmcuc3BsaXQoXCIjNjA1Q0M5XCIpLmpvaW4oY29sb3IpO1xyXG5cdHZhciBjYW52YXMgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdjYW52YXMnKTtcclxuICAgIGNhbnZhcy53aWR0aCA9IHdpZHRoO1xyXG4gICAgY2FudmFzLmhlaWdodCA9IGhlaWdodDtcclxuICAgIGNhbnZnKGNhbnZhcywgc3ZnLHsgaWdub3JlTW91c2U6IHRydWUsIGlnbm9yZUFuaW1hdGlvbjogdHJ1ZSB9KTtcclxuICAgIHJldHVybiBSRU5ERVJFREFSUk9XU1trZXldPWNhbnZhcy50b0RhdGFVUkwoKTtcclxufVxyXG5cclxudmFyIFJFTkRFUkVERElSRUNUSU9OUz17fTtcclxuZnVuY3Rpb24gcmVuZGVyRGlyZWN0aW9uQmFzZTY0KHdpZHRoLGhlaWdodCxjb2xvcikgXHJcbntcclxuXHR2YXIga2V5ID0gd2lkdGgrXCJ4XCIraGVpZ2h0K1wiOlwiK2NvbG9yO1xyXG5cdGlmIChSRU5ERVJFRERJUkVDVElPTlNba2V5XSlcclxuXHRcdHJldHVybiBSRU5ERVJFRERJUkVDVElPTlNba2V5XTtcclxuXHJcblx0dmFyIHN2Zz0nPHN2ZyB3aWR0aD1cIicrd2lkdGgrJ3B0XCIgaGVpZ2h0PVwiJytoZWlnaHQrJ3B0XCIgJ1xyXG5cclxuXHRcdCsndmlld0JveD1cIjE1IDkgMTkuNzUgMjkuNVwiIGVuYWJsZS1iYWNrZ3JvdW5kPVwibmV3IDE1IDkgMTkuNzUgMjkuNVwiIHhtbDpzcGFjZT1cInByZXNlcnZlXCI+J1xyXG5cdFx0Kyc8cGF0aCBmaWxsPVwiI0ZGRkVGRlwiIGQ9XCJNMTcuMTcsMzIuOTJsOS4xNy05LjE3bC05LjE3LTkuMTdMMjAsMTEuNzVsMTIsMTJsLTEyLDEyTDE3LjE3LDMyLjkyelwiLz4nXHJcblx0XHQrJzxwYXRoIGZpbGw9XCJub25lXCIgZD1cIk0wLTAuMjVoNDh2NDhIMFYtMC4yNXpcIi8+J1xyXG5cclxuXHQrJzwvc3ZnPic7XHJcblxyXG5cdHZhciBzdmc9c3ZnLnNwbGl0KFwiIzAwMDAwMFwiKS5qb2luKGNvbG9yKTtcclxuXHR2YXIgY2FudmFzID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnY2FudmFzJyk7XHJcbiAgICBjYW52YXMud2lkdGggPSB3aWR0aDtcclxuICAgIGNhbnZhcy5oZWlnaHQgPSBoZWlnaHQ7XHJcbiAgICBjYW52ZyhjYW52YXMsIHN2Zyx7IGlnbm9yZU1vdXNlOiB0cnVlLCBpZ25vcmVBbmltYXRpb246IHRydWUgfSk7XHJcbiAgICByZXR1cm4gUkVOREVSRURESVJFQ1RJT05TW2tleV09Y2FudmFzLnRvRGF0YVVSTCgpO1xyXG59XHJcblxyXG52YXIgUkVOREVSRUJPWEVTPXt9O1xyXG5mdW5jdGlvbiByZW5kZXJCb3hCYXNlNjQod2lkdGgsaGVpZ2h0LGNvbG9yKSBcclxue1xyXG5cdHZhciBrZXkgPSB3aWR0aCtcInhcIitoZWlnaHQrXCI6XCIrY29sb3I7XHJcblx0aWYgKFJFTkRFUkVCT1hFU1trZXldKVxyXG5cdFx0cmV0dXJuIFJFTkRFUkVCT1hFU1trZXldO1xyXG5cclxuXHR2YXIgc3ZnPSc8c3ZnIHdpZHRoPVwiJyt3aWR0aCsncHRcIiBoZWlnaHQ9XCInK2hlaWdodCsncHRcIiB2aWV3Qm94PVwiMCAwIDUxMiA1MTJcIiB2ZXJzaW9uPVwiMS4xXCIgeG1sbnM9XCJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2Z1wiPidcclxuXHQrJzxnIGlkPVwiI2ZmZmZmZmZmXCI+J1xyXG5cdCsnPHBhdGggZmlsbD1cIiNmZmZmZmZcIiBvcGFjaXR5PVwiMS4wMFwiIGQ9XCIgTSA1NS41MCAwLjAwIEwgNDU4LjQ1IDAuMDAgQyA0NzIuNDQgMC45OSA0ODYuMDMgNy4wOSA0OTUuNzggMTcuMjMgQyA1MDUuMzQgMjYuODggNTExLjAxIDQwLjA0IDUxMi4wMCA1My41NSBMIDUxMi4wMCA0NTguNDQgQyA1MTAuOTkgNDcyLjQzIDUwNC45MCA0ODYuMDEgNDk0Ljc3IDQ5NS43NyBDIDQ4NS4xMSA1MDUuMzIgNDcxLjk2IDUxMS4wMSA0NTguNDUgNTEyLjAwIEwgNTMuNTYgNTEyLjAwIEMgMzkuNTcgNTEwLjk5IDI1Ljk3IDUwNC45MSAxNi4yMiA0OTQuNzggQyA2LjY3IDQ4NS4xMiAwLjk3IDQ3MS45NyAwLjAwIDQ1OC40NSBMIDAuMDAgNTUuNTAgQyAwLjQwIDQxLjA3IDYuNDUgMjYuODkgMTYuNzQgMTYuNzMgQyAyNi44OSA2LjQ1IDQxLjA3IDAuNDEgNTUuNTAgMC4wMCBNIDU2LjkwIDU2LjkwIEMgNTYuODcgMTg5LjYzIDU2Ljg2IDMyMi4zNiA1Ni45MCA0NTUuMDkgQyAxODkuNjMgNDU1LjEyIDMyMi4zNiA0NTUuMTIgNDU1LjA5IDQ1NS4wOSBDIDQ1NS4xMiAzMjIuMzYgNDU1LjEyIDE4OS42MyA0NTUuMDkgNTYuOTAgQyAzMjIuMzYgNTYuODYgMTg5LjYzIDU2Ljg3IDU2LjkwIDU2LjkwIFpcIiAvPidcclxuXHQrJzwvZz4nXHJcblx0Kyc8ZyBpZD1cIiMwMDAwMDBmZlwiPidcclxuXHQrJzxwYXRoIGZpbGw9XCIjMDAwMDAwXCIgb3BhY2l0eT1cIjEuMDBcIiBkPVwiIE0gNTYuOTAgNTYuOTAgQyAxODkuNjMgNTYuODcgMzIyLjM2IDU2Ljg2IDQ1NS4wOSA1Ni45MCBDIDQ1NS4xMiAxODkuNjMgNDU1LjEyIDMyMi4zNiA0NTUuMDkgNDU1LjA5IEMgMzIyLjM2IDQ1NS4xMiAxODkuNjMgNDU1LjEyIDU2LjkwIDQ1NS4wOSBDIDU2Ljg2IDMyMi4zNiA1Ni44NyAxODkuNjMgNTYuOTAgNTYuOTAgWlwiIC8+J1xyXG5cdCsnPC9nPidcclxuXHQrJzwvc3ZnPic7XHJcblxyXG5cdHZhciBzdmc9c3ZnLnNwbGl0KFwiIzAwMDAwMFwiKS5qb2luKGNvbG9yKTtcclxuXHR2YXIgY2FudmFzID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnY2FudmFzJyk7XHJcbiAgICBjYW52YXMud2lkdGggPSB3aWR0aDtcclxuICAgIGNhbnZhcy5oZWlnaHQgPSBoZWlnaHQ7XHJcbiAgICBjYW52ZyhjYW52YXMsIHN2Zyx7IGlnbm9yZU1vdXNlOiB0cnVlLCBpZ25vcmVBbmltYXRpb246IHRydWUgfSk7XHJcbiAgICByZXR1cm4gUkVOREVSRUJPWEVTW2tleV09Y2FudmFzLnRvRGF0YVVSTCgpO1xyXG59XHJcblxyXG5cclxuZnVuY3Rpb24gaW50ZXJjZXB0T25DaXJjbGUoYSxiLGMscikge1xyXG5cdHJldHVybiBjaXJjbGVMaW5lSW50ZXJzZWN0KGFbMF0sYVsxXSxiWzBdLGJbMV0sY1swXSxjWzFdLHIpO1x0XHJcbn1cclxuZnVuY3Rpb24gZGlzdHAocDEscDIpIHtcclxuXHQgIHJldHVybiBNYXRoLnNxcnQoKHAyWzBdLXAxWzBdKSoocDJbMF0tcDFbMF0pKyhwMlsxXS1wMVsxXSkqKHAyWzFdLXAxWzFdKSk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGNpcmNsZUxpbmVJbnRlcnNlY3QoeDEsIHkxLCB4MiwgeTIsIGN4LCBjeSwgY3IgKSBcclxue1xyXG5cdCAgZnVuY3Rpb24gZGlzdCh4MSx5MSx4Mix5Mikge1xyXG5cdFx0ICByZXR1cm4gTWF0aC5zcXJ0KCh4Mi14MSkqKHgyLXgxKSsoeTIteTEpKih5Mi15MSkpO1xyXG5cdCAgfVxyXG5cdCAgdmFyIGR4ID0geDIgLSB4MTtcclxuXHQgIHZhciBkeSA9IHkyIC0geTE7XHJcblx0ICB2YXIgYSA9IGR4ICogZHggKyBkeSAqIGR5O1xyXG5cdCAgdmFyIGIgPSAyICogKGR4ICogKHgxIC0gY3gpICsgZHkgKiAoeTEgLSBjeSkpO1xyXG5cdCAgdmFyIGMgPSBjeCAqIGN4ICsgY3kgKiBjeTtcclxuXHQgIGMgKz0geDEgKiB4MSArIHkxICogeTE7XHJcblx0ICBjIC09IDIgKiAoY3ggKiB4MSArIGN5ICogeTEpO1xyXG5cdCAgYyAtPSBjciAqIGNyO1xyXG5cdCAgdmFyIGJiNGFjID0gYiAqIGIgLSA0ICogYSAqIGM7XHJcblx0ICBpZiAoYmI0YWMgPCAwKSB7ICAvLyBOb3QgaW50ZXJzZWN0aW5nXHJcblx0ICAgIHJldHVybiBmYWxzZTtcclxuXHQgIH0gZWxzZSB7XHJcblx0XHR2YXIgbXUgPSAoLWIgKyBNYXRoLnNxcnQoIGIqYiAtIDQqYSpjICkpIC8gKDIqYSk7XHJcblx0XHR2YXIgaXgxID0geDEgKyBtdSooZHgpO1xyXG5cdFx0dmFyIGl5MSA9IHkxICsgbXUqKGR5KTtcclxuXHQgICAgbXUgPSAoLWIgLSBNYXRoLnNxcnQoYipiIC0gNCphKmMgKSkgLyAoMiphKTtcclxuXHQgICAgdmFyIGl4MiA9IHgxICsgbXUqKGR4KTtcclxuXHQgICAgdmFyIGl5MiA9IHkxICsgbXUqKGR5KTtcclxuXHJcblx0ICAgIC8vIFRoZSBpbnRlcnNlY3Rpb24gcG9pbnRzXHJcblx0ICAgIC8vZWxsaXBzZShpeDEsIGl5MSwgMTAsIDEwKTtcclxuXHQgICAgLy9lbGxpcHNlKGl4MiwgaXkyLCAxMCwgMTApO1xyXG5cdCAgICBcclxuXHQgICAgdmFyIHRlc3RYO1xyXG5cdCAgICB2YXIgdGVzdFk7XHJcblx0ICAgIC8vIEZpZ3VyZSBvdXQgd2hpY2ggcG9pbnQgaXMgY2xvc2VyIHRvIHRoZSBjaXJjbGVcclxuXHQgICAgaWYgKGRpc3QoeDEsIHkxLCBjeCwgY3kpIDwgZGlzdCh4MiwgeTIsIGN4LCBjeSkpIHtcclxuXHQgICAgICB0ZXN0WCA9IHgyO1xyXG5cdCAgICAgIHRlc3RZID0geTI7XHJcblx0ICAgIH0gZWxzZSB7XHJcblx0ICAgICAgdGVzdFggPSB4MTtcclxuXHQgICAgICB0ZXN0WSA9IHkxO1xyXG5cdCAgICB9XHJcblx0ICAgICBcclxuXHQgICAgaWYgKGRpc3QodGVzdFgsIHRlc3RZLCBpeDEsIGl5MSkgPCBkaXN0KHgxLCB5MSwgeDIsIHkyKSB8fCBkaXN0KHRlc3RYLCB0ZXN0WSwgaXgyLCBpeTIpIDwgZGlzdCh4MSwgeTEsIHgyLCB5MikpIHtcclxuXHQgICAgICByZXR1cm4gWyBbaXgxLGl5MV0sW2l4MixpeTJdIF07XHJcblx0ICAgIH0gZWxzZSB7XHJcblx0ICAgICAgcmV0dXJuIGZhbHNlO1xyXG5cdCAgICB9XHJcblx0ICB9XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGRlY29kZUJhc2U2NEltYWdlKGRhdGFTdHJpbmcpIHtcclxuXHQgIHZhciBtYXRjaGVzID0gZGF0YVN0cmluZy5tYXRjaCgvXmRhdGE6KFtBLVphLXotK1xcL10rKTtiYXNlNjQsKC4rKSQvKSxcclxuXHQgICAgcmVzcG9uc2UgPSB7fTtcclxuXHQgIGlmIChtYXRjaGVzLmxlbmd0aCAhPT0gMykge1xyXG5cdCAgICByZXR1cm4gbmV3IEVycm9yKCdJbnZhbGlkIGlucHV0IHN0cmluZycpO1xyXG5cdCAgfVxyXG5cdCAgcmVzcG9uc2UudHlwZSA9IG1hdGNoZXNbMV07XHJcblx0ICByZXNwb25zZS5kYXRhID0gbmV3IEJ1ZmZlcihtYXRjaGVzWzJdLCAnYmFzZTY0Jyk7XHJcblx0ICByZXR1cm4gcmVzcG9uc2U7XHJcblx0fVxyXG5cclxuLy8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuZXhwb3J0cy5teVRyaW09bXlUcmltO1xyXG5leHBvcnRzLm15VHJpbUNvb3JkaW5hdGU9bXlUcmltQ29vcmRpbmF0ZTtcclxuZXhwb3J0cy5jbG9zZXN0UHJvamVjdGlvbk9mUG9pbnRPbkxpbmU9Y2xvc2VzdFByb2plY3Rpb25PZlBvaW50T25MaW5lO1xyXG5leHBvcnRzLmNvbG9yTHVtaW5hbmNlPWNvbG9yTHVtaW5hbmNlO1xyXG5leHBvcnRzLmluY3JlYXNlQnJpZ2h0bmVzcz1pbmNyZWFzZUJyaWdodG5lc3M7XHJcbmV4cG9ydHMuY29sb3JBbHBoYUFycmF5PWNvbG9yQWxwaGFBcnJheTtcclxuZXhwb3J0cy5lc2NhcGVIVE1MPWVzY2FwZUhUTUw7XHJcbmV4cG9ydHMuZm9ybWF0TnVtYmVyMj1mb3JtYXROdW1iZXIyO1xyXG5leHBvcnRzLmZvcm1hdERhdGVUaW1lPWZvcm1hdERhdGVUaW1lO1xyXG5leHBvcnRzLmZvcm1hdERhdGVUaW1lU2VjPWZvcm1hdERhdGVUaW1lU2VjO1xyXG5leHBvcnRzLmZvcm1hdERhdGU9Zm9ybWF0RGF0ZTtcclxuZXhwb3J0cy5mb3JtYXRUaW1lPWZvcm1hdFRpbWU7XHJcbmV4cG9ydHMucmFpbmJvdz1yYWluYm93O1xyXG5leHBvcnRzLm1vYmlsZUFuZFRhYmxldENoZWNrPW1vYmlsZUFuZFRhYmxldENoZWNrO1xyXG5leHBvcnRzLnJlbmRlckFycm93QmFzZTY0PXJlbmRlckFycm93QmFzZTY0O1xyXG5leHBvcnRzLnJlbmRlckRpcmVjdGlvbkJhc2U2ND1yZW5kZXJEaXJlY3Rpb25CYXNlNjQ7XHJcbmV4cG9ydHMucmVuZGVyQm94QmFzZTY0PXJlbmRlckJveEJhc2U2NDtcclxuZXhwb3J0cy5pbnRlcmNlcHRPbkNpcmNsZT1pbnRlcmNlcHRPbkNpcmNsZTtcclxuZXhwb3J0cy5kaXN0cD1kaXN0cDtcclxuZXhwb3J0cy5jaXJjbGVMaW5lSW50ZXJzZWN0PWNpcmNsZUxpbmVJbnRlcnNlY3Q7XHJcbmV4cG9ydHMuTU9CSUxFPW1vYmlsZUFuZFRhYmxldENoZWNrKCk7XHJcbmV4cG9ydHMuV0dTODRTUEhFUkU9bmV3IFdHUzg0U3BoZXJlKDYzNzgxMzcpO1xyXG5leHBvcnRzLmZvcm1hdFRpbWVTZWM9Zm9ybWF0VGltZVNlYztcclxuZXhwb3J0cy5kZWNvZGVCYXNlNjRJbWFnZT1kZWNvZGVCYXNlNjRJbWFnZTtcclxuZXhwb3J0cy5pc0RlZmluZWQ9aXNEZWZpbmVkOyIsIjshZnVuY3Rpb24gKCkgeztcbnZhciBKb29zZSA9IHt9XG5cbi8vIGNvbmZpZ3VyYXRpb24gaGFzaFxuXG5Kb29zZS5DICAgICAgICAgICAgID0gdHlwZW9mIEpPT1NFX0NGRyAhPSAndW5kZWZpbmVkJyA/IEpPT1NFX0NGRyA6IHt9XG5cbkpvb3NlLmlzX0lFICAgICAgICAgPSAnXFx2JyA9PSAndidcbkpvb3NlLmlzX05vZGVKUyAgICAgPSBCb29sZWFuKHR5cGVvZiBwcm9jZXNzICE9ICd1bmRlZmluZWQnICYmIHByb2Nlc3MucGlkKVxuXG5cbkpvb3NlLnRvcCAgICAgICAgICAgPSBKb29zZS5pc19Ob2RlSlMgJiYgZ2xvYmFsIHx8IHRoaXNcblxuSm9vc2Uuc3R1YiAgICAgICAgICA9IGZ1bmN0aW9uICgpIHtcbiAgICByZXR1cm4gZnVuY3Rpb24gKCkgeyB0aHJvdyBuZXcgRXJyb3IoXCJNb2R1bGVzIGNhbiBub3QgYmUgaW5zdGFudGlhdGVkXCIpIH1cbn1cblxuXG5Kb29zZS5WRVJTSU9OICAgICAgID0gKHsgLypQS0dWRVJTSU9OKi9WRVJTSU9OIDogJzMuNTAuMCcgfSkuVkVSU0lPTlxuXG5cbmlmICh0eXBlb2YgbW9kdWxlICE9ICd1bmRlZmluZWQnKSBtb2R1bGUuZXhwb3J0cyA9IEpvb3NlXG4vKmlmICghSm9vc2UuaXNfTm9kZUpTKSAqL1xudGhpcy5Kb29zZSA9IEpvb3NlXG5cblxuLy8gU3RhdGljIGhlbHBlcnMgZm9yIEFycmF5c1xuSm9vc2UuQSA9IHtcblxuICAgIGVhY2ggOiBmdW5jdGlvbiAoYXJyYXksIGZ1bmMsIHNjb3BlKSB7XG4gICAgICAgIHNjb3BlID0gc2NvcGUgfHwgdGhpc1xuICAgICAgICBcbiAgICAgICAgZm9yICh2YXIgaSA9IDAsIGxlbiA9IGFycmF5Lmxlbmd0aDsgaSA8IGxlbjsgaSsrKSBcbiAgICAgICAgICAgIGlmIChmdW5jLmNhbGwoc2NvcGUsIGFycmF5W2ldLCBpKSA9PT0gZmFsc2UpIHJldHVybiBmYWxzZVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgZWFjaFIgOiBmdW5jdGlvbiAoYXJyYXksIGZ1bmMsIHNjb3BlKSB7XG4gICAgICAgIHNjb3BlID0gc2NvcGUgfHwgdGhpc1xuXG4gICAgICAgIGZvciAodmFyIGkgPSBhcnJheS5sZW5ndGggLSAxOyBpID49IDA7IGktLSkgXG4gICAgICAgICAgICBpZiAoZnVuYy5jYWxsKHNjb3BlLCBhcnJheVtpXSwgaSkgPT09IGZhbHNlKSByZXR1cm4gZmFsc2VcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGV4aXN0cyA6IGZ1bmN0aW9uIChhcnJheSwgdmFsdWUpIHtcbiAgICAgICAgZm9yICh2YXIgaSA9IDAsIGxlbiA9IGFycmF5Lmxlbmd0aDsgaSA8IGxlbjsgaSsrKSBpZiAoYXJyYXlbaV0gPT0gdmFsdWUpIHJldHVybiB0cnVlXG4gICAgICAgICAgICBcbiAgICAgICAgcmV0dXJuIGZhbHNlXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBtYXAgOiBmdW5jdGlvbiAoYXJyYXksIGZ1bmMsIHNjb3BlKSB7XG4gICAgICAgIHNjb3BlID0gc2NvcGUgfHwgdGhpc1xuICAgICAgICBcbiAgICAgICAgdmFyIHJlcyA9IFtdXG4gICAgICAgIFxuICAgICAgICBmb3IgKHZhciBpID0gMCwgbGVuID0gYXJyYXkubGVuZ3RoOyBpIDwgbGVuOyBpKyspIFxuICAgICAgICAgICAgcmVzLnB1c2goIGZ1bmMuY2FsbChzY29wZSwgYXJyYXlbaV0sIGkpIClcbiAgICAgICAgICAgIFxuICAgICAgICByZXR1cm4gcmVzXG4gICAgfSxcbiAgICBcblxuICAgIGdyZXAgOiBmdW5jdGlvbiAoYXJyYXksIGZ1bmMpIHtcbiAgICAgICAgdmFyIGEgPSBbXVxuICAgICAgICBcbiAgICAgICAgSm9vc2UuQS5lYWNoKGFycmF5LCBmdW5jdGlvbiAodCkge1xuICAgICAgICAgICAgaWYgKGZ1bmModCkpIGEucHVzaCh0KVxuICAgICAgICB9KVxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIGFcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIHJlbW92ZSA6IGZ1bmN0aW9uIChhcnJheSwgcmVtb3ZlRWxlKSB7XG4gICAgICAgIHZhciBhID0gW11cbiAgICAgICAgXG4gICAgICAgIEpvb3NlLkEuZWFjaChhcnJheSwgZnVuY3Rpb24gKHQpIHtcbiAgICAgICAgICAgIGlmICh0ICE9PSByZW1vdmVFbGUpIGEucHVzaCh0KVxuICAgICAgICB9KVxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIGFcbiAgICB9XG4gICAgXG59XG5cbi8vIFN0YXRpYyBoZWxwZXJzIGZvciBTdHJpbmdzXG5Kb29zZS5TID0ge1xuICAgIFxuICAgIHNhbmVTcGxpdCA6IGZ1bmN0aW9uIChzdHIsIGRlbGltZXRlcikge1xuICAgICAgICB2YXIgcmVzID0gKHN0ciB8fCAnJykuc3BsaXQoZGVsaW1ldGVyKVxuICAgICAgICBcbiAgICAgICAgaWYgKHJlcy5sZW5ndGggPT0gMSAmJiAhcmVzWzBdKSByZXMuc2hpZnQoKVxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIHJlc1xuICAgIH0sXG4gICAgXG5cbiAgICB1cHBlcmNhc2VGaXJzdCA6IGZ1bmN0aW9uIChzdHJpbmcpIHsgXG4gICAgICAgIHJldHVybiBzdHJpbmcuc3Vic3RyKDAsIDEpLnRvVXBwZXJDYXNlKCkgKyBzdHJpbmcuc3Vic3RyKDEsIHN0cmluZy5sZW5ndGggLSAxKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgc3RyVG9DbGFzcyA6IGZ1bmN0aW9uIChuYW1lLCB0b3ApIHtcbiAgICAgICAgdmFyIGN1cnJlbnQgPSB0b3AgfHwgSm9vc2UudG9wXG4gICAgICAgIFxuICAgICAgICBKb29zZS5BLmVhY2gobmFtZS5zcGxpdCgnLicpLCBmdW5jdGlvbiAoc2VnbWVudCkge1xuICAgICAgICAgICAgaWYgKGN1cnJlbnQpIFxuICAgICAgICAgICAgICAgIGN1cnJlbnQgPSBjdXJyZW50WyBzZWdtZW50IF1cbiAgICAgICAgICAgIGVsc2VcbiAgICAgICAgICAgICAgICByZXR1cm4gZmFsc2VcbiAgICAgICAgfSlcbiAgICAgICAgXG4gICAgICAgIHJldHVybiBjdXJyZW50XG4gICAgfVxufVxuXG52YXIgYmFzZUZ1bmMgICAgPSBmdW5jdGlvbiAoKSB7fVxuXG4vLyBTdGF0aWMgaGVscGVycyBmb3Igb2JqZWN0c1xuSm9vc2UuTyA9IHtcblxuICAgIGVhY2ggOiBmdW5jdGlvbiAob2JqZWN0LCBmdW5jLCBzY29wZSkge1xuICAgICAgICBzY29wZSA9IHNjb3BlIHx8IHRoaXNcbiAgICAgICAgXG4gICAgICAgIGZvciAodmFyIGkgaW4gb2JqZWN0KSBcbiAgICAgICAgICAgIGlmIChmdW5jLmNhbGwoc2NvcGUsIG9iamVjdFtpXSwgaSkgPT09IGZhbHNlKSByZXR1cm4gZmFsc2VcbiAgICAgICAgXG4gICAgICAgIGlmIChKb29zZS5pc19JRSkgXG4gICAgICAgICAgICByZXR1cm4gSm9vc2UuQS5lYWNoKFsgJ3RvU3RyaW5nJywgJ2NvbnN0cnVjdG9yJywgJ2hhc093blByb3BlcnR5JyBdLCBmdW5jdGlvbiAoZWwpIHtcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBpZiAob2JqZWN0Lmhhc093blByb3BlcnR5KGVsKSkgcmV0dXJuIGZ1bmMuY2FsbChzY29wZSwgb2JqZWN0W2VsXSwgZWwpXG4gICAgICAgICAgICB9KVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgZWFjaE93biA6IGZ1bmN0aW9uIChvYmplY3QsIGZ1bmMsIHNjb3BlKSB7XG4gICAgICAgIHNjb3BlID0gc2NvcGUgfHwgdGhpc1xuICAgICAgICBcbiAgICAgICAgcmV0dXJuIEpvb3NlLk8uZWFjaChvYmplY3QsIGZ1bmN0aW9uICh2YWx1ZSwgbmFtZSkge1xuICAgICAgICAgICAgaWYgKG9iamVjdC5oYXNPd25Qcm9wZXJ0eShuYW1lKSkgcmV0dXJuIGZ1bmMuY2FsbChzY29wZSwgdmFsdWUsIG5hbWUpXG4gICAgICAgIH0sIHNjb3BlKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgY29weSA6IGZ1bmN0aW9uIChzb3VyY2UsIHRhcmdldCkge1xuICAgICAgICB0YXJnZXQgPSB0YXJnZXQgfHwge31cbiAgICAgICAgXG4gICAgICAgIEpvb3NlLk8uZWFjaChzb3VyY2UsIGZ1bmN0aW9uICh2YWx1ZSwgbmFtZSkgeyB0YXJnZXRbbmFtZV0gPSB2YWx1ZSB9KVxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIHRhcmdldFxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgY29weU93biA6IGZ1bmN0aW9uIChzb3VyY2UsIHRhcmdldCkge1xuICAgICAgICB0YXJnZXQgPSB0YXJnZXQgfHwge31cbiAgICAgICAgXG4gICAgICAgIEpvb3NlLk8uZWFjaE93bihzb3VyY2UsIGZ1bmN0aW9uICh2YWx1ZSwgbmFtZSkgeyB0YXJnZXRbbmFtZV0gPSB2YWx1ZSB9KVxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIHRhcmdldFxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgZ2V0TXV0YWJsZUNvcHkgOiBmdW5jdGlvbiAob2JqZWN0KSB7XG4gICAgICAgIGJhc2VGdW5jLnByb3RvdHlwZSA9IG9iamVjdFxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIG5ldyBiYXNlRnVuYygpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBleHRlbmQgOiBmdW5jdGlvbiAodGFyZ2V0LCBzb3VyY2UpIHtcbiAgICAgICAgcmV0dXJuIEpvb3NlLk8uY29weShzb3VyY2UsIHRhcmdldClcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGlzRW1wdHkgOiBmdW5jdGlvbiAob2JqZWN0KSB7XG4gICAgICAgIGZvciAodmFyIGkgaW4gb2JqZWN0KSBpZiAob2JqZWN0Lmhhc093blByb3BlcnR5KGkpKSByZXR1cm4gZmFsc2VcbiAgICAgICAgXG4gICAgICAgIHJldHVybiB0cnVlXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBpc0luc3RhbmNlOiBmdW5jdGlvbiAob2JqKSB7XG4gICAgICAgIHJldHVybiBvYmogJiYgb2JqLm1ldGEgJiYgb2JqLmNvbnN0cnVjdG9yID09IG9iai5tZXRhLmNcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGlzQ2xhc3MgOiBmdW5jdGlvbiAob2JqKSB7XG4gICAgICAgIHJldHVybiBvYmogJiYgb2JqLm1ldGEgJiYgb2JqLm1ldGEuYyA9PSBvYmpcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIHdhbnRBcnJheSA6IGZ1bmN0aW9uIChvYmopIHtcbiAgICAgICAgaWYgKG9iaiBpbnN0YW5jZW9mIEFycmF5KSByZXR1cm4gb2JqXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gWyBvYmogXVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgLy8gdGhpcyB3YXMgYSBidWcgaW4gV2ViS2l0LCB3aGljaCBnaXZlcyB0eXBlb2YgLyAvID09ICdmdW5jdGlvbidcbiAgICAvLyBzaG91bGQgYmUgbW9uaXRvcmVkIGFuZCByZW1vdmVkIGF0IHNvbWUgcG9pbnQgaW4gdGhlIGZ1dHVyZVxuICAgIGlzRnVuY3Rpb24gOiBmdW5jdGlvbiAob2JqKSB7XG4gICAgICAgIHJldHVybiB0eXBlb2Ygb2JqID09ICdmdW5jdGlvbicgJiYgb2JqLmNvbnN0cnVjdG9yICE9IC8gLy5jb25zdHJ1Y3RvclxuICAgIH1cbn1cblxuXG4vL2luaXRpYWxpemVyc1xuXG5Kb29zZS5JID0ge1xuICAgIEFycmF5ICAgICAgIDogZnVuY3Rpb24gKCkgeyByZXR1cm4gW10gfSxcbiAgICBPYmplY3QgICAgICA6IGZ1bmN0aW9uICgpIHsgcmV0dXJuIHt9IH0sXG4gICAgRnVuY3Rpb24gICAgOiBmdW5jdGlvbiAoKSB7IHJldHVybiBhcmd1bWVudHMuY2FsbGVlIH0sXG4gICAgTm93ICAgICAgICAgOiBmdW5jdGlvbiAoKSB7IHJldHVybiBuZXcgRGF0ZSgpIH1cbn07XG5Kb29zZS5Qcm90byA9IEpvb3NlLnN0dWIoKVxuXG5Kb29zZS5Qcm90by5FbXB0eSA9IEpvb3NlLnN0dWIoKVxuICAgIFxuSm9vc2UuUHJvdG8uRW1wdHkubWV0YSA9IHt9O1xuOyhmdW5jdGlvbiAoKSB7XG5cbiAgICBKb29zZS5Qcm90by5PYmplY3QgPSBKb29zZS5zdHViKClcbiAgICBcbiAgICBcbiAgICB2YXIgU1VQRVIgPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHZhciBzZWxmID0gU1VQRVIuY2FsbGVyXG4gICAgICAgIFxuICAgICAgICBpZiAoc2VsZiA9PSBTVVBFUkFSRykgc2VsZiA9IHNlbGYuY2FsbGVyXG4gICAgICAgIFxuICAgICAgICBpZiAoIXNlbGYuU1VQRVIpIHRocm93IFwiSW52YWxpZCBjYWxsIHRvIFNVUEVSXCJcbiAgICAgICAgXG4gICAgICAgIHJldHVybiBzZWxmLlNVUEVSW3NlbGYubWV0aG9kTmFtZV0uYXBwbHkodGhpcywgYXJndW1lbnRzKVxuICAgIH1cbiAgICBcbiAgICBcbiAgICB2YXIgU1VQRVJBUkcgPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHJldHVybiB0aGlzLlNVUEVSLmFwcGx5KHRoaXMsIGFyZ3VtZW50c1swXSlcbiAgICB9XG4gICAgXG4gICAgXG4gICAgXG4gICAgSm9vc2UuUHJvdG8uT2JqZWN0LnByb3RvdHlwZSA9IHtcbiAgICAgICAgXG4gICAgICAgIFNVUEVSQVJHIDogU1VQRVJBUkcsXG4gICAgICAgIFNVUEVSIDogU1VQRVIsXG4gICAgICAgIFxuICAgICAgICBJTk5FUiA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHRocm93IFwiSW52YWxpZCBjYWxsIHRvIElOTkVSXCJcbiAgICAgICAgfSwgICAgICAgICAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgQlVJTEQgOiBmdW5jdGlvbiAoY29uZmlnKSB7XG4gICAgICAgICAgICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aCA9PSAxICYmIHR5cGVvZiBjb25maWcgPT0gJ29iamVjdCcgJiYgY29uZmlnIHx8IHt9XG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgaW5pdGlhbGl6ZTogZnVuY3Rpb24gKCkge1xuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIHRvU3RyaW5nOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICByZXR1cm4gXCJhIFwiICsgdGhpcy5tZXRhLm5hbWVcbiAgICAgICAgfVxuICAgICAgICBcbiAgICB9XG4gICAgICAgIFxuICAgIEpvb3NlLlByb3RvLk9iamVjdC5tZXRhID0ge1xuICAgICAgICBjb25zdHJ1Y3RvciAgICAgOiBKb29zZS5Qcm90by5PYmplY3QsXG4gICAgICAgIFxuICAgICAgICBtZXRob2RzICAgICAgICAgOiBKb29zZS5PLmNvcHkoSm9vc2UuUHJvdG8uT2JqZWN0LnByb3RvdHlwZSksXG4gICAgICAgIGF0dHJpYnV0ZXMgICAgICA6IHt9XG4gICAgfVxuICAgIFxuICAgIEpvb3NlLlByb3RvLk9iamVjdC5wcm90b3R5cGUubWV0YSA9IEpvb3NlLlByb3RvLk9iamVjdC5tZXRhXG5cbn0pKCk7XG47KGZ1bmN0aW9uICgpIHtcblxuICAgIEpvb3NlLlByb3RvLkNsYXNzID0gZnVuY3Rpb24gKCkge1xuICAgICAgICByZXR1cm4gdGhpcy5pbml0aWFsaXplKHRoaXMuQlVJTEQuYXBwbHkodGhpcywgYXJndW1lbnRzKSkgfHwgdGhpc1xuICAgIH1cbiAgICBcbiAgICB2YXIgYm9vdHN0cmFwID0ge1xuICAgICAgICBcbiAgICAgICAgVkVSU0lPTiAgICAgICAgICAgICA6IG51bGwsXG4gICAgICAgIEFVVEhPUklUWSAgICAgICAgICAgOiBudWxsLFxuICAgICAgICBcbiAgICAgICAgY29uc3RydWN0b3IgICAgICAgICA6IEpvb3NlLlByb3RvLkNsYXNzLFxuICAgICAgICBzdXBlckNsYXNzICAgICAgICAgIDogbnVsbCxcbiAgICAgICAgXG4gICAgICAgIG5hbWUgICAgICAgICAgICAgICAgOiBudWxsLFxuICAgICAgICBcbiAgICAgICAgYXR0cmlidXRlcyAgICAgICAgICA6IG51bGwsXG4gICAgICAgIG1ldGhvZHMgICAgICAgICAgICAgOiBudWxsLFxuICAgICAgICBcbiAgICAgICAgbWV0YSAgICAgICAgICAgICAgICA6IG51bGwsXG4gICAgICAgIGMgICAgICAgICAgICAgICAgICAgOiBudWxsLFxuICAgICAgICBcbiAgICAgICAgZGVmYXVsdFN1cGVyQ2xhc3MgICA6IEpvb3NlLlByb3RvLk9iamVjdCxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBCVUlMRCA6IGZ1bmN0aW9uIChuYW1lLCBleHRlbmQpIHtcbiAgICAgICAgICAgIHRoaXMubmFtZSA9IG5hbWVcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcmV0dXJuIHsgX19leHRlbmRfXyA6IGV4dGVuZCB8fCB7fSB9XG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgaW5pdGlhbGl6ZTogZnVuY3Rpb24gKHByb3BzKSB7XG4gICAgICAgICAgICB2YXIgZXh0ZW5kICAgICAgPSBwcm9wcy5fX2V4dGVuZF9fXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXMuVkVSU0lPTiAgICA9IGV4dGVuZC5WRVJTSU9OXG4gICAgICAgICAgICB0aGlzLkFVVEhPUklUWSAgPSBleHRlbmQuQVVUSE9SSVRZXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGRlbGV0ZSBleHRlbmQuVkVSU0lPTlxuICAgICAgICAgICAgZGVsZXRlIGV4dGVuZC5BVVRIT1JJVFlcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpcy5jID0gdGhpcy5leHRyYWN0Q29uc3RydWN0b3IoZXh0ZW5kKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLmFkYXB0Q29uc3RydWN0b3IodGhpcy5jKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAoZXh0ZW5kLmNvbnN0cnVjdG9yT25seSkge1xuICAgICAgICAgICAgICAgIGRlbGV0ZSBleHRlbmQuY29uc3RydWN0b3JPbmx5XG4gICAgICAgICAgICAgICAgcmV0dXJuXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXMuY29uc3RydWN0KGV4dGVuZClcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBjb25zdHJ1Y3QgOiBmdW5jdGlvbiAoZXh0ZW5kKSB7XG4gICAgICAgICAgICBpZiAoIXRoaXMucHJlcGFyZVByb3BzKGV4dGVuZCkpIHJldHVyblxuICAgICAgICAgICAgXG4gICAgICAgICAgICB2YXIgc3VwZXJDbGFzcyA9IHRoaXMuc3VwZXJDbGFzcyA9IHRoaXMuZXh0cmFjdFN1cGVyQ2xhc3MoZXh0ZW5kKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLnByb2Nlc3NTdXBlckNsYXNzKHN1cGVyQ2xhc3MpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXMuYWRhcHRQcm90b3R5cGUodGhpcy5jLnByb3RvdHlwZSlcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpcy5maW5hbGl6ZShleHRlbmQpXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgZmluYWxpemUgOiBmdW5jdGlvbiAoZXh0ZW5kKSB7XG4gICAgICAgICAgICB0aGlzLnByb2Nlc3NTdGVtKGV4dGVuZClcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpcy5leHRlbmQoZXh0ZW5kKVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIC8vaWYgdGhlIGV4dGVuc2lvbiByZXR1cm5zIGZhbHNlIGZyb20gdGhpcyBtZXRob2QgaXQgc2hvdWxkIHJlLWVudGVyICdjb25zdHJ1Y3QnXG4gICAgICAgIHByZXBhcmVQcm9wcyA6IGZ1bmN0aW9uIChleHRlbmQpIHtcbiAgICAgICAgICAgIHJldHVybiB0cnVlXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgZXh0cmFjdENvbnN0cnVjdG9yIDogZnVuY3Rpb24gKGV4dGVuZCkge1xuICAgICAgICAgICAgdmFyIHJlcyA9IGV4dGVuZC5oYXNPd25Qcm9wZXJ0eSgnY29uc3RydWN0b3InKSA/IGV4dGVuZC5jb25zdHJ1Y3RvciA6IHRoaXMuZGVmYXVsdENvbnN0cnVjdG9yKClcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgZGVsZXRlIGV4dGVuZC5jb25zdHJ1Y3RvclxuICAgICAgICAgICAgXG4gICAgICAgICAgICByZXR1cm4gcmVzXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgZXh0cmFjdFN1cGVyQ2xhc3MgOiBmdW5jdGlvbiAoZXh0ZW5kKSB7XG4gICAgICAgICAgICBpZiAoZXh0ZW5kLmhhc093blByb3BlcnR5KCdpc2EnKSAmJiAhZXh0ZW5kLmlzYSkgdGhyb3cgbmV3IEVycm9yKFwiQXR0ZW1wdCB0byBpbmhlcml0IGZyb20gdW5kZWZpbmVkIHN1cGVyY2xhc3MgW1wiICsgdGhpcy5uYW1lICsgXCJdXCIpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciByZXMgPSBleHRlbmQuaXNhIHx8IHRoaXMuZGVmYXVsdFN1cGVyQ2xhc3NcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgZGVsZXRlIGV4dGVuZC5pc2FcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcmV0dXJuIHJlc1xuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIHByb2Nlc3NTdGVtIDogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgdmFyIHN1cGVyTWV0YSAgICAgICA9IHRoaXMuc3VwZXJDbGFzcy5tZXRhXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXMubWV0aG9kcyAgICAgICAgPSBKb29zZS5PLmdldE11dGFibGVDb3B5KHN1cGVyTWV0YS5tZXRob2RzIHx8IHt9KVxuICAgICAgICAgICAgdGhpcy5hdHRyaWJ1dGVzICAgICA9IEpvb3NlLk8uZ2V0TXV0YWJsZUNvcHkoc3VwZXJNZXRhLmF0dHJpYnV0ZXMgfHwge30pXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgaW5pdEluc3RhbmNlIDogZnVuY3Rpb24gKGluc3RhbmNlLCBwcm9wcykge1xuICAgICAgICAgICAgSm9vc2UuTy5jb3B5T3duKHByb3BzLCBpbnN0YW5jZSlcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBkZWZhdWx0Q29uc3RydWN0b3I6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHJldHVybiBmdW5jdGlvbiAoYXJnKSB7XG4gICAgICAgICAgICAgICAgdmFyIEJVSUxEID0gdGhpcy5CVUlMRFxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIHZhciBhcmdzID0gQlVJTEQgJiYgQlVJTEQuYXBwbHkodGhpcywgYXJndW1lbnRzKSB8fCBhcmcgfHwge31cbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICB2YXIgdGhpc01ldGEgICAgPSB0aGlzLm1ldGFcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICB0aGlzTWV0YS5pbml0SW5zdGFuY2UodGhpcywgYXJncylcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICByZXR1cm4gdGhpc01ldGEuaGFzTWV0aG9kKCdpbml0aWFsaXplJykgJiYgdGhpcy5pbml0aWFsaXplKGFyZ3MpIHx8IHRoaXNcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBwcm9jZXNzU3VwZXJDbGFzczogZnVuY3Rpb24gKHN1cGVyQ2xhc3MpIHtcbiAgICAgICAgICAgIHZhciBzdXBlclByb3RvICAgICAgPSBzdXBlckNsYXNzLnByb3RvdHlwZVxuICAgICAgICAgICAgXG4gICAgICAgICAgICAvL25vbi1Kb29zZSBzdXBlcmNsYXNzZXNcbiAgICAgICAgICAgIGlmICghc3VwZXJDbGFzcy5tZXRhKSB7XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgdmFyIGV4dGVuZCA9IEpvb3NlLk8uY29weShzdXBlclByb3RvKVxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIGV4dGVuZC5pc2EgPSBKb29zZS5Qcm90by5FbXB0eVxuICAgICAgICAgICAgICAgIC8vIGNsZWFyIHBvdGVudGlhbCB2YWx1ZSBpbiB0aGUgYGV4dGVuZC5jb25zdHJ1Y3RvcmAgdG8gcHJldmVudCBpdCBmcm9tIGJlaW5nIG1vZGlmaWVkXG4gICAgICAgICAgICAgICAgZGVsZXRlIGV4dGVuZC5jb25zdHJ1Y3RvclxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIHZhciBtZXRhID0gbmV3IHRoaXMuZGVmYXVsdFN1cGVyQ2xhc3MubWV0YS5jb25zdHJ1Y3RvcihudWxsLCBleHRlbmQpXG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgc3VwZXJDbGFzcy5tZXRhID0gc3VwZXJQcm90by5tZXRhID0gbWV0YVxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIG1ldGEuYyA9IHN1cGVyQ2xhc3NcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpcy5jLnByb3RvdHlwZSAgICA9IEpvb3NlLk8uZ2V0TXV0YWJsZUNvcHkoc3VwZXJQcm90bylcbiAgICAgICAgICAgIHRoaXMuYy5zdXBlckNsYXNzICAgPSBzdXBlclByb3RvXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgYWRhcHRDb25zdHJ1Y3RvcjogZnVuY3Rpb24gKGMpIHtcbiAgICAgICAgICAgIGMubWV0YSA9IHRoaXNcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKCFjLmhhc093blByb3BlcnR5KCd0b1N0cmluZycpKSBjLnRvU3RyaW5nID0gZnVuY3Rpb24gKCkgeyByZXR1cm4gdGhpcy5tZXRhLm5hbWUgfVxuICAgICAgICB9LFxuICAgIFxuICAgICAgICBcbiAgICAgICAgYWRhcHRQcm90b3R5cGU6IGZ1bmN0aW9uIChwcm90bykge1xuICAgICAgICAgICAgLy90aGlzIHdpbGwgZml4IHdlaXJkIHNlbWFudGljIG9mIG5hdGl2ZSBcImNvbnN0cnVjdG9yXCIgcHJvcGVydHkgdG8gbW9yZSBpbnR1aXRpdmUgKGlkZWEgYm9ycm93ZWQgZnJvbSBFeHQpXG4gICAgICAgICAgICBwcm90by5jb25zdHJ1Y3RvciAgID0gdGhpcy5jXG4gICAgICAgICAgICBwcm90by5tZXRhICAgICAgICAgID0gdGhpc1xuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIGFkZE1ldGhvZDogZnVuY3Rpb24gKG5hbWUsIGZ1bmMpIHtcbiAgICAgICAgICAgIGZ1bmMuU1VQRVIgPSB0aGlzLnN1cGVyQ2xhc3MucHJvdG90eXBlXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vY2hyb21lIGRvbid0IGFsbG93IHRvIHJlZGVmaW5lIHRoZSBcIm5hbWVcIiBwcm9wZXJ0eVxuICAgICAgICAgICAgZnVuYy5tZXRob2ROYW1lID0gbmFtZVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLm1ldGhvZHNbbmFtZV0gPSBmdW5jXG4gICAgICAgICAgICB0aGlzLmMucHJvdG90eXBlW25hbWVdID0gZnVuY1xuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIGFkZEF0dHJpYnV0ZTogZnVuY3Rpb24gKG5hbWUsIGluaXQpIHtcbiAgICAgICAgICAgIHRoaXMuYXR0cmlidXRlc1tuYW1lXSA9IGluaXRcbiAgICAgICAgICAgIHRoaXMuYy5wcm90b3R5cGVbbmFtZV0gPSBpbml0XG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgcmVtb3ZlTWV0aG9kIDogZnVuY3Rpb24gKG5hbWUpIHtcbiAgICAgICAgICAgIGRlbGV0ZSB0aGlzLm1ldGhvZHNbbmFtZV1cbiAgICAgICAgICAgIGRlbGV0ZSB0aGlzLmMucHJvdG90eXBlW25hbWVdXG4gICAgICAgIH0sXG4gICAgXG4gICAgICAgIFxuICAgICAgICByZW1vdmVBdHRyaWJ1dGU6IGZ1bmN0aW9uIChuYW1lKSB7XG4gICAgICAgICAgICBkZWxldGUgdGhpcy5hdHRyaWJ1dGVzW25hbWVdXG4gICAgICAgICAgICBkZWxldGUgdGhpcy5jLnByb3RvdHlwZVtuYW1lXVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIGhhc01ldGhvZDogZnVuY3Rpb24gKG5hbWUpIHsgXG4gICAgICAgICAgICByZXR1cm4gQm9vbGVhbih0aGlzLm1ldGhvZHNbbmFtZV0pXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgaGFzQXR0cmlidXRlOiBmdW5jdGlvbiAobmFtZSkgeyBcbiAgICAgICAgICAgIHJldHVybiB0aGlzLmF0dHJpYnV0ZXNbbmFtZV0gIT09IHVuZGVmaW5lZFxuICAgICAgICB9LFxuICAgICAgICBcbiAgICBcbiAgICAgICAgaGFzT3duTWV0aG9kOiBmdW5jdGlvbiAobmFtZSkgeyBcbiAgICAgICAgICAgIHJldHVybiB0aGlzLmhhc01ldGhvZChuYW1lKSAmJiB0aGlzLm1ldGhvZHMuaGFzT3duUHJvcGVydHkobmFtZSlcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBoYXNPd25BdHRyaWJ1dGU6IGZ1bmN0aW9uIChuYW1lKSB7IFxuICAgICAgICAgICAgcmV0dXJuIHRoaXMuaGFzQXR0cmlidXRlKG5hbWUpICYmIHRoaXMuYXR0cmlidXRlcy5oYXNPd25Qcm9wZXJ0eShuYW1lKVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIGV4dGVuZCA6IGZ1bmN0aW9uIChwcm9wcykge1xuICAgICAgICAgICAgSm9vc2UuTy5lYWNoT3duKHByb3BzLCBmdW5jdGlvbiAodmFsdWUsIG5hbWUpIHtcbiAgICAgICAgICAgICAgICBpZiAobmFtZSAhPSAnbWV0YScgJiYgbmFtZSAhPSAnY29uc3RydWN0b3InKSBcbiAgICAgICAgICAgICAgICAgICAgaWYgKEpvb3NlLk8uaXNGdW5jdGlvbih2YWx1ZSkgJiYgIXZhbHVlLm1ldGEpIFxuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5hZGRNZXRob2QobmFtZSwgdmFsdWUpIFxuICAgICAgICAgICAgICAgICAgICBlbHNlIFxuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5hZGRBdHRyaWJ1dGUobmFtZSwgdmFsdWUpXG4gICAgICAgICAgICB9LCB0aGlzKVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIHN1YkNsYXNzT2YgOiBmdW5jdGlvbiAoY2xhc3NPYmplY3QsIGV4dGVuZCkge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuc3ViQ2xhc3MoZXh0ZW5kLCBudWxsLCBjbGFzc09iamVjdClcbiAgICAgICAgfSxcbiAgICBcbiAgICBcbiAgICAgICAgc3ViQ2xhc3MgOiBmdW5jdGlvbiAoZXh0ZW5kLCBuYW1lLCBjbGFzc09iamVjdCkge1xuICAgICAgICAgICAgZXh0ZW5kICAgICAgPSBleHRlbmQgICAgICAgIHx8IHt9XG4gICAgICAgICAgICBleHRlbmQuaXNhICA9IGNsYXNzT2JqZWN0ICAgfHwgdGhpcy5jXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHJldHVybiBuZXcgdGhpcy5jb25zdHJ1Y3RvcihuYW1lLCBleHRlbmQpLmNcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBpbnN0YW50aWF0ZSA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHZhciBmID0gZnVuY3Rpb24gKCkge31cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgZi5wcm90b3R5cGUgPSB0aGlzLmMucHJvdG90eXBlXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciBvYmogPSBuZXcgZigpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHJldHVybiB0aGlzLmMuYXBwbHkob2JqLCBhcmd1bWVudHMpIHx8IG9ialxuICAgICAgICB9XG4gICAgfVxuICAgIFxuICAgIC8vbWljcm8gYm9vdHN0cmFwaW5nXG4gICAgXG4gICAgSm9vc2UuUHJvdG8uQ2xhc3MucHJvdG90eXBlID0gSm9vc2UuTy5nZXRNdXRhYmxlQ29weShKb29zZS5Qcm90by5PYmplY3QucHJvdG90eXBlKVxuICAgIFxuICAgIEpvb3NlLk8uZXh0ZW5kKEpvb3NlLlByb3RvLkNsYXNzLnByb3RvdHlwZSwgYm9vdHN0cmFwKVxuICAgIFxuICAgIEpvb3NlLlByb3RvLkNsYXNzLnByb3RvdHlwZS5tZXRhID0gbmV3IEpvb3NlLlByb3RvLkNsYXNzKCdKb29zZS5Qcm90by5DbGFzcycsIGJvb3RzdHJhcClcbiAgICBcbiAgICBcbiAgICBcbiAgICBKb29zZS5Qcm90by5DbGFzcy5tZXRhLmFkZE1ldGhvZCgnaXNhJywgZnVuY3Rpb24gKHNvbWVDbGFzcykge1xuICAgICAgICB2YXIgZiA9IGZ1bmN0aW9uICgpIHt9XG4gICAgICAgIFxuICAgICAgICBmLnByb3RvdHlwZSA9IHRoaXMuYy5wcm90b3R5cGVcbiAgICAgICAgXG4gICAgICAgIHJldHVybiBuZXcgZigpIGluc3RhbmNlb2Ygc29tZUNsYXNzXG4gICAgfSlcbn0pKCk7XG5Kb29zZS5NYW5hZ2VkID0gSm9vc2Uuc3R1YigpXG5cbkpvb3NlLk1hbmFnZWQuUHJvcGVydHkgPSBuZXcgSm9vc2UuUHJvdG8uQ2xhc3MoJ0pvb3NlLk1hbmFnZWQuUHJvcGVydHknLCB7XG4gICAgXG4gICAgbmFtZSAgICAgICAgICAgIDogbnVsbCxcbiAgICBcbiAgICBpbml0ICAgICAgICAgICAgOiBudWxsLFxuICAgIHZhbHVlICAgICAgICAgICA6IG51bGwsXG4gICAgXG4gICAgZGVmaW5lZEluICAgICAgIDogbnVsbCxcbiAgICBcbiAgICBcbiAgICBpbml0aWFsaXplIDogZnVuY3Rpb24gKHByb3BzKSB7XG4gICAgICAgIEpvb3NlLk1hbmFnZWQuUHJvcGVydHkuc3VwZXJDbGFzcy5pbml0aWFsaXplLmNhbGwodGhpcywgcHJvcHMpXG4gICAgICAgIFxuICAgICAgICB0aGlzLmNvbXB1dGVWYWx1ZSgpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBjb21wdXRlVmFsdWUgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHRoaXMudmFsdWUgPSB0aGlzLmluaXRcbiAgICB9LCAgICBcbiAgICBcbiAgICBcbiAgICAvL3RhcmdldENsYXNzIGlzIHN0aWxsIG9wZW4gYXQgdGhpcyBzdGFnZVxuICAgIHByZUFwcGx5IDogZnVuY3Rpb24gKHRhcmdldENsYXNzKSB7XG4gICAgfSxcbiAgICBcblxuICAgIC8vdGFyZ2V0Q2xhc3MgaXMgYWxyZWFkeSBvcGVuIGF0IHRoaXMgc3RhZ2VcbiAgICBwb3N0VW5BcHBseSA6IGZ1bmN0aW9uICh0YXJnZXRDbGFzcykge1xuICAgIH0sXG4gICAgXG4gICAgXG4gICAgYXBwbHkgOiBmdW5jdGlvbiAodGFyZ2V0KSB7XG4gICAgICAgIHRhcmdldFt0aGlzLm5hbWVdID0gdGhpcy52YWx1ZVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgaXNBcHBsaWVkVG8gOiBmdW5jdGlvbiAodGFyZ2V0KSB7XG4gICAgICAgIHJldHVybiB0YXJnZXRbdGhpcy5uYW1lXSA9PSB0aGlzLnZhbHVlXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICB1bmFwcGx5IDogZnVuY3Rpb24gKGZyb20pIHtcbiAgICAgICAgaWYgKCF0aGlzLmlzQXBwbGllZFRvKGZyb20pKSB0aHJvdyBcIlVuYXBwbHkgb2YgcHJvcGVydHkgW1wiICsgdGhpcy5uYW1lICsgXCJdIGZyb20gW1wiICsgZnJvbSArIFwiXSBmYWlsZWRcIlxuICAgICAgICBcbiAgICAgICAgZGVsZXRlIGZyb21bdGhpcy5uYW1lXVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgY2xvbmVQcm9wcyA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIG5hbWUgICAgICAgIDogdGhpcy5uYW1lLCBcbiAgICAgICAgICAgIGluaXQgICAgICAgIDogdGhpcy5pbml0LFxuICAgICAgICAgICAgZGVmaW5lZEluICAgOiB0aGlzLmRlZmluZWRJblxuICAgICAgICB9XG4gICAgfSxcblxuICAgIFxuICAgIGNsb25lIDogZnVuY3Rpb24gKG5hbWUpIHtcbiAgICAgICAgdmFyIHByb3BzID0gdGhpcy5jbG9uZVByb3BzKClcbiAgICAgICAgXG4gICAgICAgIHByb3BzLm5hbWUgPSBuYW1lIHx8IHByb3BzLm5hbWVcbiAgICAgICAgXG4gICAgICAgIHJldHVybiBuZXcgdGhpcy5jb25zdHJ1Y3Rvcihwcm9wcylcbiAgICB9XG4gICAgXG4gICAgXG59KS5jO1xuSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5Db25mbGljdE1hcmtlciA9IG5ldyBKb29zZS5Qcm90by5DbGFzcygnSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5Db25mbGljdE1hcmtlcicsIHtcbiAgICBcbiAgICBpc2EgOiBKb29zZS5NYW5hZ2VkLlByb3BlcnR5LFxuXG4gICAgYXBwbHkgOiBmdW5jdGlvbiAodGFyZ2V0KSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcIkF0dGVtcHQgdG8gYXBwbHkgQ29uZmxpY3RNYXJrZXIgW1wiICsgdGhpcy5uYW1lICsgXCJdIHRvIFtcIiArIHRhcmdldCArIFwiXVwiKVxuICAgIH1cbiAgICBcbn0pLmM7XG5Kb29zZS5NYW5hZ2VkLlByb3BlcnR5LlJlcXVpcmVtZW50ID0gbmV3IEpvb3NlLlByb3RvLkNsYXNzKCdKb29zZS5NYW5hZ2VkLlByb3BlcnR5LlJlcXVpcmVtZW50Jywge1xuICAgIFxuICAgIGlzYSA6IEpvb3NlLk1hbmFnZWQuUHJvcGVydHksXG5cbiAgICBcbiAgICBhcHBseSA6IGZ1bmN0aW9uICh0YXJnZXQpIHtcbiAgICAgICAgaWYgKCF0YXJnZXQubWV0YS5oYXNNZXRob2QodGhpcy5uYW1lKSkgXG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJSZXF1aXJlbWVudCBbXCIgKyB0aGlzLm5hbWUgKyBcIl0sIGRlZmluZWQgaW4gW1wiICsgdGhpcy5kZWZpbmVkSW4uZGVmaW5lZEluLm5hbWUgKyBcIl0gaXMgbm90IHNhdGlzZmllZCBmb3IgY2xhc3MgW1wiICsgdGFyZ2V0ICsgXCJdXCIpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICB1bmFwcGx5IDogZnVuY3Rpb24gKGZyb20pIHtcbiAgICB9XG4gICAgXG59KS5jO1xuSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5BdHRyaWJ1dGUgPSBuZXcgSm9vc2UuUHJvdG8uQ2xhc3MoJ0pvb3NlLk1hbmFnZWQuUHJvcGVydHkuQXR0cmlidXRlJywge1xuICAgIFxuICAgIGlzYSA6IEpvb3NlLk1hbmFnZWQuUHJvcGVydHksXG4gICAgXG4gICAgc2xvdCAgICAgICAgICAgICAgICA6IG51bGwsXG4gICAgXG4gICAgXG4gICAgaW5pdGlhbGl6ZSA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5BdHRyaWJ1dGUuc3VwZXJDbGFzcy5pbml0aWFsaXplLmFwcGx5KHRoaXMsIGFyZ3VtZW50cylcbiAgICAgICAgXG4gICAgICAgIHRoaXMuc2xvdCA9IHRoaXMubmFtZVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgYXBwbHkgOiBmdW5jdGlvbiAodGFyZ2V0KSB7XG4gICAgICAgIHRhcmdldC5wcm90b3R5cGVbIHRoaXMuc2xvdCBdID0gdGhpcy52YWx1ZVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgaXNBcHBsaWVkVG8gOiBmdW5jdGlvbiAodGFyZ2V0KSB7XG4gICAgICAgIHJldHVybiB0YXJnZXQucHJvdG90eXBlWyB0aGlzLnNsb3QgXSA9PSB0aGlzLnZhbHVlXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICB1bmFwcGx5IDogZnVuY3Rpb24gKGZyb20pIHtcbiAgICAgICAgaWYgKCF0aGlzLmlzQXBwbGllZFRvKGZyb20pKSB0aHJvdyBcIlVuYXBwbHkgb2YgcHJvcGVydHkgW1wiICsgdGhpcy5uYW1lICsgXCJdIGZyb20gW1wiICsgZnJvbSArIFwiXSBmYWlsZWRcIlxuICAgICAgICBcbiAgICAgICAgZGVsZXRlIGZyb20ucHJvdG90eXBlW3RoaXMuc2xvdF1cbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGNsZWFyVmFsdWUgOiBmdW5jdGlvbiAoaW5zdGFuY2UpIHtcbiAgICAgICAgZGVsZXRlIGluc3RhbmNlWyB0aGlzLnNsb3QgXVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgaGFzVmFsdWUgOiBmdW5jdGlvbiAoaW5zdGFuY2UpIHtcbiAgICAgICAgcmV0dXJuIGluc3RhbmNlLmhhc093blByb3BlcnR5KHRoaXMuc2xvdClcbiAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgZ2V0UmF3VmFsdWVGcm9tIDogZnVuY3Rpb24gKGluc3RhbmNlKSB7XG4gICAgICAgIHJldHVybiBpbnN0YW5jZVsgdGhpcy5zbG90IF1cbiAgICB9LFxuICAgIFxuICAgIFxuICAgIHNldFJhd1ZhbHVlVG8gOiBmdW5jdGlvbiAoaW5zdGFuY2UsIHZhbHVlKSB7XG4gICAgICAgIGluc3RhbmNlWyB0aGlzLnNsb3QgXSA9IHZhbHVlXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gdGhpc1xuICAgIH1cbiAgICBcbn0pLmM7XG5Kb29zZS5NYW5hZ2VkLlByb3BlcnR5Lk1ldGhvZE1vZGlmaWVyID0gbmV3IEpvb3NlLlByb3RvLkNsYXNzKCdKb29zZS5NYW5hZ2VkLlByb3BlcnR5Lk1ldGhvZE1vZGlmaWVyJywge1xuICAgIFxuICAgIGlzYSA6IEpvb3NlLk1hbmFnZWQuUHJvcGVydHksXG5cbiAgICBcbiAgICBwcmVwYXJlV3JhcHBlciA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgdGhyb3cgXCJBYnN0cmFjdCBtZXRob2QgW3ByZXBhcmVXcmFwcGVyXSBvZiBcIiArIHRoaXMgKyBcIiB3YXMgY2FsbGVkXCJcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGFwcGx5IDogZnVuY3Rpb24gKHRhcmdldCkge1xuICAgICAgICB2YXIgbmFtZSAgICAgICAgICAgID0gdGhpcy5uYW1lXG4gICAgICAgIHZhciB0YXJnZXRQcm90byAgICAgPSB0YXJnZXQucHJvdG90eXBlXG4gICAgICAgIHZhciBpc093biAgICAgICAgICAgPSB0YXJnZXRQcm90by5oYXNPd25Qcm9wZXJ0eShuYW1lKVxuICAgICAgICB2YXIgb3JpZ2luYWwgICAgICAgID0gdGFyZ2V0UHJvdG9bbmFtZV1cbiAgICAgICAgdmFyIHN1cGVyUHJvdG8gICAgICA9IHRhcmdldC5tZXRhLnN1cGVyQ2xhc3MucHJvdG90eXBlXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgdmFyIG9yaWdpbmFsQ2FsbCA9IGlzT3duID8gb3JpZ2luYWwgOiBmdW5jdGlvbiAoKSB7IFxuICAgICAgICAgICAgcmV0dXJuIHN1cGVyUHJvdG9bbmFtZV0uYXBwbHkodGhpcywgYXJndW1lbnRzKSBcbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgdmFyIG1ldGhvZFdyYXBwZXIgPSB0aGlzLnByZXBhcmVXcmFwcGVyKHtcbiAgICAgICAgICAgIG5hbWUgICAgICAgICAgICA6IG5hbWUsXG4gICAgICAgICAgICBtb2RpZmllciAgICAgICAgOiB0aGlzLnZhbHVlLCBcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaXNPd24gICAgICAgICAgIDogaXNPd24sXG4gICAgICAgICAgICBvcmlnaW5hbENhbGwgICAgOiBvcmlnaW5hbENhbGwsIFxuICAgICAgICAgICAgXG4gICAgICAgICAgICBzdXBlclByb3RvICAgICAgOiBzdXBlclByb3RvLFxuICAgICAgICAgICAgXG4gICAgICAgICAgICB0YXJnZXQgICAgICAgICAgOiB0YXJnZXRcbiAgICAgICAgfSlcbiAgICAgICAgXG4gICAgICAgIGlmIChpc093bikgbWV0aG9kV3JhcHBlci5fX09SSUdJTkFMX18gPSBvcmlnaW5hbFxuICAgICAgICBcbiAgICAgICAgbWV0aG9kV3JhcHBlci5fX0NPTlRBSU5fXyAgID0gdGhpcy52YWx1ZVxuICAgICAgICBtZXRob2RXcmFwcGVyLl9fTUVUSE9EX18gICAgPSB0aGlzXG4gICAgICAgIFxuICAgICAgICB0YXJnZXRQcm90b1tuYW1lXSA9IG1ldGhvZFdyYXBwZXJcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGlzQXBwbGllZFRvIDogZnVuY3Rpb24gKHRhcmdldCkge1xuICAgICAgICB2YXIgdGFyZ2V0Q29udCA9IHRhcmdldC5wcm90b3R5cGVbdGhpcy5uYW1lXVxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIHRhcmdldENvbnQgJiYgdGFyZ2V0Q29udC5fX0NPTlRBSU5fXyA9PSB0aGlzLnZhbHVlXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICB1bmFwcGx5IDogZnVuY3Rpb24gKGZyb20pIHtcbiAgICAgICAgdmFyIG5hbWUgPSB0aGlzLm5hbWVcbiAgICAgICAgdmFyIGZyb21Qcm90byA9IGZyb20ucHJvdG90eXBlXG4gICAgICAgIHZhciBvcmlnaW5hbCA9IGZyb21Qcm90b1tuYW1lXS5fX09SSUdJTkFMX19cbiAgICAgICAgXG4gICAgICAgIGlmICghdGhpcy5pc0FwcGxpZWRUbyhmcm9tKSkgdGhyb3cgXCJVbmFwcGx5IG9mIG1ldGhvZCBbXCIgKyBuYW1lICsgXCJdIGZyb20gY2xhc3MgW1wiICsgZnJvbSArIFwiXSBmYWlsZWRcIlxuICAgICAgICBcbiAgICAgICAgLy9pZiBtb2RpZmllciB3YXMgYXBwbGllZCB0byBvd24gbWV0aG9kIC0gcmVzdG9yZSBpdFxuICAgICAgICBpZiAob3JpZ2luYWwpIFxuICAgICAgICAgICAgZnJvbVByb3RvW25hbWVdID0gb3JpZ2luYWxcbiAgICAgICAgLy9vdGhlcndpc2UgLSBqdXN0IGRlbGV0ZSBpdCwgdG8gcmV2ZWFsIHRoZSBpbmhlcml0ZWQgbWV0aG9kIFxuICAgICAgICBlbHNlXG4gICAgICAgICAgICBkZWxldGUgZnJvbVByb3RvW25hbWVdXG4gICAgfVxuICAgIFxufSkuYztcbkpvb3NlLk1hbmFnZWQuUHJvcGVydHkuTWV0aG9kTW9kaWZpZXIuT3ZlcnJpZGUgPSBuZXcgSm9vc2UuUHJvdG8uQ2xhc3MoJ0pvb3NlLk1hbmFnZWQuUHJvcGVydHkuTWV0aG9kTW9kaWZpZXIuT3ZlcnJpZGUnLCB7XG4gICAgXG4gICAgaXNhIDogSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5NZXRob2RNb2RpZmllcixcblxuICAgIFxuICAgIHByZXBhcmVXcmFwcGVyIDogZnVuY3Rpb24gKHBhcmFtcykge1xuICAgICAgICBcbiAgICAgICAgdmFyIG1vZGlmaWVyICAgICAgICA9IHBhcmFtcy5tb2RpZmllclxuICAgICAgICB2YXIgb3JpZ2luYWxDYWxsICAgID0gcGFyYW1zLm9yaWdpbmFsQ2FsbFxuICAgICAgICB2YXIgc3VwZXJQcm90byAgICAgID0gcGFyYW1zLnN1cGVyUHJvdG9cbiAgICAgICAgdmFyIHN1cGVyTWV0YUNvbnN0ICA9IHN1cGVyUHJvdG8ubWV0YS5jb25zdHJ1Y3RvclxuICAgICAgICBcbiAgICAgICAgLy9jYWxsIHRvIEpvb3NlLlByb3RvIGxldmVsLCByZXF1aXJlIHNvbWUgYWRkaXRpb25hbCBwcm9jZXNzaW5nXG4gICAgICAgIHZhciBpc0NhbGxUb1Byb3RvID0gKHN1cGVyTWV0YUNvbnN0ID09IEpvb3NlLlByb3RvLkNsYXNzIHx8IHN1cGVyTWV0YUNvbnN0ID09IEpvb3NlLlByb3RvLk9iamVjdCkgJiYgIShwYXJhbXMuaXNPd24gJiYgb3JpZ2luYWxDYWxsLklTX09WRVJSSURFKSBcbiAgICAgICAgXG4gICAgICAgIHZhciBvcmlnaW5hbCA9IG9yaWdpbmFsQ2FsbFxuICAgICAgICBcbiAgICAgICAgaWYgKGlzQ2FsbFRvUHJvdG8pIG9yaWdpbmFsID0gZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgdmFyIGJlZm9yZVNVUEVSID0gdGhpcy5TVVBFUlxuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLlNVUEVSICA9IHN1cGVyUHJvdG8uU1VQRVJcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdmFyIHJlcyA9IG9yaWdpbmFsQ2FsbC5hcHBseSh0aGlzLCBhcmd1bWVudHMpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXMuU1VQRVIgPSBiZWZvcmVTVVBFUlxuICAgICAgICAgICAgXG4gICAgICAgICAgICByZXR1cm4gcmVzXG4gICAgICAgIH1cblxuICAgICAgICB2YXIgb3ZlcnJpZGUgPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciBiZWZvcmVTVVBFUiA9IHRoaXMuU1VQRVJcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpcy5TVVBFUiAgPSBvcmlnaW5hbFxuICAgICAgICAgICAgXG4gICAgICAgICAgICB2YXIgcmVzID0gbW9kaWZpZXIuYXBwbHkodGhpcywgYXJndW1lbnRzKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLlNVUEVSID0gYmVmb3JlU1VQRVJcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcmV0dXJuIHJlc1xuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICBvdmVycmlkZS5JU19PVkVSUklERSA9IHRydWVcbiAgICAgICAgXG4gICAgICAgIHJldHVybiBvdmVycmlkZVxuICAgIH1cbiAgICBcbiAgICBcbn0pLmM7XG5Kb29zZS5NYW5hZ2VkLlByb3BlcnR5Lk1ldGhvZE1vZGlmaWVyLlB1dCA9IG5ldyBKb29zZS5Qcm90by5DbGFzcygnSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5NZXRob2RNb2RpZmllci5QdXQnLCB7XG4gICAgXG4gICAgaXNhIDogSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5NZXRob2RNb2RpZmllci5PdmVycmlkZSxcblxuXG4gICAgcHJlcGFyZVdyYXBwZXIgOiBmdW5jdGlvbiAocGFyYW1zKSB7XG4gICAgICAgIFxuICAgICAgICBpZiAocGFyYW1zLmlzT3duKSB0aHJvdyBcIk1ldGhvZCBbXCIgKyBwYXJhbXMubmFtZSArIFwiXSBpcyBhcHBseWluZyBvdmVyIHNvbWV0aGluZyBbXCIgKyBwYXJhbXMub3JpZ2luYWxDYWxsICsgXCJdIGluIGNsYXNzIFtcIiArIHBhcmFtcy50YXJnZXQgKyBcIl1cIlxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIEpvb3NlLk1hbmFnZWQuUHJvcGVydHkuTWV0aG9kTW9kaWZpZXIuUHV0LnN1cGVyQ2xhc3MucHJlcGFyZVdyYXBwZXIuY2FsbCh0aGlzLCBwYXJhbXMpXG4gICAgfVxuICAgIFxuICAgIFxufSkuYztcbkpvb3NlLk1hbmFnZWQuUHJvcGVydHkuTWV0aG9kTW9kaWZpZXIuQWZ0ZXIgPSBuZXcgSm9vc2UuUHJvdG8uQ2xhc3MoJ0pvb3NlLk1hbmFnZWQuUHJvcGVydHkuTWV0aG9kTW9kaWZpZXIuQWZ0ZXInLCB7XG4gICAgXG4gICAgaXNhIDogSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5NZXRob2RNb2RpZmllcixcblxuICAgIFxuICAgIHByZXBhcmVXcmFwcGVyIDogZnVuY3Rpb24gKHBhcmFtcykge1xuICAgICAgICBcbiAgICAgICAgdmFyIG1vZGlmaWVyICAgICAgICA9IHBhcmFtcy5tb2RpZmllclxuICAgICAgICB2YXIgb3JpZ2luYWxDYWxsICAgID0gcGFyYW1zLm9yaWdpbmFsQ2FsbFxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHZhciByZXMgPSBvcmlnaW5hbENhbGwuYXBwbHkodGhpcywgYXJndW1lbnRzKVxuICAgICAgICAgICAgbW9kaWZpZXIuYXBwbHkodGhpcywgYXJndW1lbnRzKVxuICAgICAgICAgICAgcmV0dXJuIHJlc1xuICAgICAgICB9XG4gICAgfSAgICBcblxuICAgIFxufSkuYztcbkpvb3NlLk1hbmFnZWQuUHJvcGVydHkuTWV0aG9kTW9kaWZpZXIuQmVmb3JlID0gbmV3IEpvb3NlLlByb3RvLkNsYXNzKCdKb29zZS5NYW5hZ2VkLlByb3BlcnR5Lk1ldGhvZE1vZGlmaWVyLkJlZm9yZScsIHtcbiAgICBcbiAgICBpc2EgOiBKb29zZS5NYW5hZ2VkLlByb3BlcnR5Lk1ldGhvZE1vZGlmaWVyLFxuXG4gICAgXG4gICAgcHJlcGFyZVdyYXBwZXIgOiBmdW5jdGlvbiAocGFyYW1zKSB7XG4gICAgICAgIFxuICAgICAgICB2YXIgbW9kaWZpZXIgICAgICAgID0gcGFyYW1zLm1vZGlmaWVyXG4gICAgICAgIHZhciBvcmlnaW5hbENhbGwgICAgPSBwYXJhbXMub3JpZ2luYWxDYWxsXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgbW9kaWZpZXIuYXBwbHkodGhpcywgYXJndW1lbnRzKVxuICAgICAgICAgICAgcmV0dXJuIG9yaWdpbmFsQ2FsbC5hcHBseSh0aGlzLCBhcmd1bWVudHMpXG4gICAgICAgIH1cbiAgICB9XG4gICAgXG59KS5jO1xuSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5NZXRob2RNb2RpZmllci5Bcm91bmQgPSBuZXcgSm9vc2UuUHJvdG8uQ2xhc3MoJ0pvb3NlLk1hbmFnZWQuUHJvcGVydHkuTWV0aG9kTW9kaWZpZXIuQXJvdW5kJywge1xuICAgIFxuICAgIGlzYSA6IEpvb3NlLk1hbmFnZWQuUHJvcGVydHkuTWV0aG9kTW9kaWZpZXIsXG5cbiAgICBwcmVwYXJlV3JhcHBlciA6IGZ1bmN0aW9uIChwYXJhbXMpIHtcbiAgICAgICAgXG4gICAgICAgIHZhciBtb2RpZmllciAgICAgICAgPSBwYXJhbXMubW9kaWZpZXJcbiAgICAgICAgdmFyIG9yaWdpbmFsQ2FsbCAgICA9IHBhcmFtcy5vcmlnaW5hbENhbGxcbiAgICAgICAgXG4gICAgICAgIHZhciBtZVxuICAgICAgICBcbiAgICAgICAgdmFyIGJvdW5kID0gZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgcmV0dXJuIG9yaWdpbmFsQ2FsbC5hcHBseShtZSwgYXJndW1lbnRzKVxuICAgICAgICB9XG4gICAgICAgICAgICBcbiAgICAgICAgcmV0dXJuIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIG1lID0gdGhpc1xuICAgICAgICAgICAgXG4gICAgICAgICAgICB2YXIgYm91bmRBcnIgPSBbIGJvdW5kIF1cbiAgICAgICAgICAgIGJvdW5kQXJyLnB1c2guYXBwbHkoYm91bmRBcnIsIGFyZ3VtZW50cylcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcmV0dXJuIG1vZGlmaWVyLmFwcGx5KHRoaXMsIGJvdW5kQXJyKVxuICAgICAgICB9XG4gICAgfVxuICAgIFxufSkuYztcbkpvb3NlLk1hbmFnZWQuUHJvcGVydHkuTWV0aG9kTW9kaWZpZXIuQXVnbWVudCA9IG5ldyBKb29zZS5Qcm90by5DbGFzcygnSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5NZXRob2RNb2RpZmllci5BdWdtZW50Jywge1xuICAgIFxuICAgIGlzYSA6IEpvb3NlLk1hbmFnZWQuUHJvcGVydHkuTWV0aG9kTW9kaWZpZXIsXG5cbiAgICBcbiAgICBwcmVwYXJlV3JhcHBlciA6IGZ1bmN0aW9uIChwYXJhbXMpIHtcbiAgICAgICAgXG4gICAgICAgIHZhciBBVUdNRU5UID0gZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgXG4gICAgICAgICAgICAvL3BvcHVsYXRlIGNhbGxzdGFjayB0byB0aGUgbW9zdCBkZWVwIG5vbi1hdWdtZW50IG1ldGhvZFxuICAgICAgICAgICAgdmFyIGNhbGxzdGFjayA9IFtdXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciBzZWxmID0gQVVHTUVOVFxuICAgICAgICAgICAgXG4gICAgICAgICAgICBkbyB7XG4gICAgICAgICAgICAgICAgY2FsbHN0YWNrLnB1c2goc2VsZi5JU19BVUdNRU5UID8gc2VsZi5fX0NPTlRBSU5fXyA6IHNlbGYpXG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgc2VsZiA9IHNlbGYuSVNfQVVHTUVOVCAmJiAoc2VsZi5fX09SSUdJTkFMX18gfHwgc2VsZi5TVVBFUltzZWxmLm1ldGhvZE5hbWVdKVxuICAgICAgICAgICAgfSB3aGlsZSAoc2VsZilcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgXG4gICAgICAgICAgICAvL3NhdmUgcHJldmlvdXMgSU5ORVJcbiAgICAgICAgICAgIHZhciBiZWZvcmVJTk5FUiA9IHRoaXMuSU5ORVJcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy9jcmVhdGUgbmV3IElOTkVSXG4gICAgICAgICAgICB0aGlzLklOTkVSID0gZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgIHZhciBpbm5lckNhbGwgPSBjYWxsc3RhY2sucG9wKClcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICByZXR1cm4gaW5uZXJDYWxsID8gaW5uZXJDYWxsLmFwcGx5KHRoaXMsIGFyZ3VtZW50cykgOiB1bmRlZmluZWRcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy9hdWdtZW50IG1vZGlmaWVyIHJlc3VsdHMgaW4gaHlwb3RldGljYWwgSU5ORVIgY2FsbCBvZiB0aGUgc2FtZSBtZXRob2QgaW4gc3ViY2xhc3MgXG4gICAgICAgICAgICB2YXIgcmVzID0gdGhpcy5JTk5FUi5hcHBseSh0aGlzLCBhcmd1bWVudHMpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vcmVzdG9yZSBwcmV2aW91cyBJTk5FUiBjaGFpblxuICAgICAgICAgICAgdGhpcy5JTk5FUiA9IGJlZm9yZUlOTkVSXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHJldHVybiByZXNcbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgQVVHTUVOVC5tZXRob2ROYW1lICA9IHBhcmFtcy5uYW1lXG4gICAgICAgIEFVR01FTlQuU1VQRVIgICAgICAgPSBwYXJhbXMuc3VwZXJQcm90b1xuICAgICAgICBBVUdNRU5ULklTX0FVR01FTlQgID0gdHJ1ZVxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIEFVR01FTlRcbiAgICB9XG4gICAgXG59KS5jO1xuSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eVNldCA9IG5ldyBKb29zZS5Qcm90by5DbGFzcygnSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eVNldCcsIHtcbiAgICBcbiAgICBpc2EgICAgICAgICAgICAgICAgICAgICAgIDogSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eSxcblxuICAgIHByb3BlcnRpZXMgICAgICAgICAgICAgICAgOiBudWxsLFxuICAgIFxuICAgIHByb3BlcnR5TWV0YUNsYXNzICAgICAgICAgOiBKb29zZS5NYW5hZ2VkLlByb3BlcnR5LFxuICAgIFxuICAgIFxuICAgIGluaXRpYWxpemUgOiBmdW5jdGlvbiAocHJvcHMpIHtcbiAgICAgICAgSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eVNldC5zdXBlckNsYXNzLmluaXRpYWxpemUuY2FsbCh0aGlzLCBwcm9wcylcbiAgICAgICAgXG4gICAgICAgIC8vWFhYIHRoaXMgZ3VhcmRzIHRoZSBtZXRhIHJvbGVzIDopXG4gICAgICAgIHRoaXMucHJvcGVydGllcyA9IHByb3BzLnByb3BlcnRpZXMgfHwge31cbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGFkZFByb3BlcnR5IDogZnVuY3Rpb24gKG5hbWUsIHByb3BzKSB7XG4gICAgICAgIHZhciBtZXRhQ2xhc3MgPSBwcm9wcy5tZXRhIHx8IHRoaXMucHJvcGVydHlNZXRhQ2xhc3NcbiAgICAgICAgZGVsZXRlIHByb3BzLm1ldGFcbiAgICAgICAgXG4gICAgICAgIHByb3BzLmRlZmluZWRJbiAgICAgPSB0aGlzXG4gICAgICAgIHByb3BzLm5hbWUgICAgICAgICAgPSBuYW1lXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gdGhpcy5wcm9wZXJ0aWVzW25hbWVdID0gbmV3IG1ldGFDbGFzcyhwcm9wcylcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGFkZFByb3BlcnR5T2JqZWN0IDogZnVuY3Rpb24gKG9iamVjdCkge1xuICAgICAgICByZXR1cm4gdGhpcy5wcm9wZXJ0aWVzW29iamVjdC5uYW1lXSA9IG9iamVjdFxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgcmVtb3ZlUHJvcGVydHkgOiBmdW5jdGlvbiAobmFtZSkge1xuICAgICAgICB2YXIgcHJvcCA9IHRoaXMucHJvcGVydGllc1tuYW1lXVxuICAgICAgICBcbiAgICAgICAgZGVsZXRlIHRoaXMucHJvcGVydGllc1tuYW1lXVxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIHByb3BcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGhhdmVQcm9wZXJ0eSA6IGZ1bmN0aW9uIChuYW1lKSB7XG4gICAgICAgIHJldHVybiB0aGlzLnByb3BlcnRpZXNbbmFtZV0gIT0gbnVsbFxuICAgIH0sXG4gICAgXG5cbiAgICBoYXZlT3duUHJvcGVydHkgOiBmdW5jdGlvbiAobmFtZSkge1xuICAgICAgICByZXR1cm4gdGhpcy5oYXZlUHJvcGVydHkobmFtZSkgJiYgdGhpcy5wcm9wZXJ0aWVzLmhhc093blByb3BlcnR5KG5hbWUpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBnZXRQcm9wZXJ0eSA6IGZ1bmN0aW9uIChuYW1lKSB7XG4gICAgICAgIHJldHVybiB0aGlzLnByb3BlcnRpZXNbbmFtZV1cbiAgICB9LFxuICAgIFxuICAgIFxuICAgIC8vaW5jbHVkZXMgaW5oZXJpdGVkIHByb3BlcnRpZXMgKHByb2JhYmx5IHlvdSB3YW50cyAnZWFjaE93bicsIHdoaWNoIHByb2Nlc3Mgb25seSBcIm93blwiIChpbmNsdWRpbmcgY29uc3VtZWQgZnJvbSBSb2xlcykgcHJvcGVydGllcykgXG4gICAgZWFjaCA6IGZ1bmN0aW9uIChmdW5jLCBzY29wZSkge1xuICAgICAgICBKb29zZS5PLmVhY2godGhpcy5wcm9wZXJ0aWVzLCBmdW5jLCBzY29wZSB8fCB0aGlzKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgZWFjaE93biA6IGZ1bmN0aW9uIChmdW5jLCBzY29wZSkge1xuICAgICAgICBKb29zZS5PLmVhY2hPd24odGhpcy5wcm9wZXJ0aWVzLCBmdW5jLCBzY29wZSB8fCB0aGlzKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgLy9zeW5vbnltIGZvciBlYWNoXG4gICAgZWFjaEFsbCA6IGZ1bmN0aW9uIChmdW5jLCBzY29wZSkge1xuICAgICAgICB0aGlzLmVhY2goZnVuYywgc2NvcGUpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBjbG9uZVByb3BzIDogZnVuY3Rpb24gKCkge1xuICAgICAgICB2YXIgcHJvcHMgPSBKb29zZS5NYW5hZ2VkLlByb3BlcnR5U2V0LnN1cGVyQ2xhc3MuY2xvbmVQcm9wcy5jYWxsKHRoaXMpXG4gICAgICAgIFxuICAgICAgICBwcm9wcy5wcm9wZXJ0eU1ldGFDbGFzcyAgICAgPSB0aGlzLnByb3BlcnR5TWV0YUNsYXNzXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gcHJvcHNcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGNsb25lIDogZnVuY3Rpb24gKG5hbWUpIHtcbiAgICAgICAgdmFyIGNsb25lID0gdGhpcy5jbGVhbkNsb25lKG5hbWUpXG4gICAgICAgIFxuICAgICAgICBjbG9uZS5wcm9wZXJ0aWVzID0gSm9vc2UuTy5jb3B5T3duKHRoaXMucHJvcGVydGllcylcbiAgICAgICAgXG4gICAgICAgIHJldHVybiBjbG9uZVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgY2xlYW5DbG9uZSA6IGZ1bmN0aW9uIChuYW1lKSB7XG4gICAgICAgIHZhciBwcm9wcyA9IHRoaXMuY2xvbmVQcm9wcygpXG4gICAgICAgIFxuICAgICAgICBwcm9wcy5uYW1lID0gbmFtZSB8fCBwcm9wcy5uYW1lXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gbmV3IHRoaXMuY29uc3RydWN0b3IocHJvcHMpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBhbGlhcyA6IGZ1bmN0aW9uICh3aGF0KSB7XG4gICAgICAgIHZhciBwcm9wcyA9IHRoaXMucHJvcGVydGllc1xuICAgICAgICBcbiAgICAgICAgSm9vc2UuTy5lYWNoKHdoYXQsIGZ1bmN0aW9uIChhbGlhc05hbWUsIG9yaWdpbmFsTmFtZSkge1xuICAgICAgICAgICAgdmFyIG9yaWdpbmFsID0gcHJvcHNbb3JpZ2luYWxOYW1lXVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAob3JpZ2luYWwpIHRoaXMuYWRkUHJvcGVydHlPYmplY3Qob3JpZ2luYWwuY2xvbmUoYWxpYXNOYW1lKSlcbiAgICAgICAgfSwgdGhpcylcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGV4Y2x1ZGUgOiBmdW5jdGlvbiAod2hhdCkge1xuICAgICAgICB2YXIgcHJvcHMgPSB0aGlzLnByb3BlcnRpZXNcbiAgICAgICAgXG4gICAgICAgIEpvb3NlLkEuZWFjaCh3aGF0LCBmdW5jdGlvbiAobmFtZSkge1xuICAgICAgICAgICAgZGVsZXRlIHByb3BzW25hbWVdXG4gICAgICAgIH0pXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBiZWZvcmVDb25zdW1lZEJ5IDogZnVuY3Rpb24gKCkge1xuICAgIH0sXG4gICAgXG4gICAgXG4gICAgZmxhdHRlblRvIDogZnVuY3Rpb24gKHRhcmdldCkge1xuICAgICAgICB2YXIgdGFyZ2V0UHJvcHMgPSB0YXJnZXQucHJvcGVydGllc1xuICAgICAgICBcbiAgICAgICAgdGhpcy5lYWNoT3duKGZ1bmN0aW9uIChwcm9wZXJ0eSwgbmFtZSkge1xuICAgICAgICAgICAgdmFyIHRhcmdldFByb3BlcnR5ID0gdGFyZ2V0UHJvcHNbbmFtZV1cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKHRhcmdldFByb3BlcnR5IGluc3RhbmNlb2YgSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5Db25mbGljdE1hcmtlcikgcmV0dXJuXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmICghdGFyZ2V0UHJvcHMuaGFzT3duUHJvcGVydHkobmFtZSkgfHwgdGFyZ2V0UHJvcGVydHkgPT0gbnVsbCkge1xuICAgICAgICAgICAgICAgIHRhcmdldC5hZGRQcm9wZXJ0eU9iamVjdChwcm9wZXJ0eSlcbiAgICAgICAgICAgICAgICByZXR1cm5cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKHRhcmdldFByb3BlcnR5ID09IHByb3BlcnR5KSByZXR1cm5cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGFyZ2V0LnJlbW92ZVByb3BlcnR5KG5hbWUpXG4gICAgICAgICAgICB0YXJnZXQuYWRkUHJvcGVydHkobmFtZSwge1xuICAgICAgICAgICAgICAgIG1ldGEgOiBKb29zZS5NYW5hZ2VkLlByb3BlcnR5LkNvbmZsaWN0TWFya2VyXG4gICAgICAgICAgICB9KVxuICAgICAgICB9LCB0aGlzKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgY29tcG9zZVRvIDogZnVuY3Rpb24gKHRhcmdldCkge1xuICAgICAgICB0aGlzLmVhY2hPd24oZnVuY3Rpb24gKHByb3BlcnR5LCBuYW1lKSB7XG4gICAgICAgICAgICBpZiAoIXRhcmdldC5oYXZlT3duUHJvcGVydHkobmFtZSkpIHRhcmdldC5hZGRQcm9wZXJ0eU9iamVjdChwcm9wZXJ0eSlcbiAgICAgICAgfSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGNvbXBvc2VGcm9tIDogZnVuY3Rpb24gKCkge1xuICAgICAgICBpZiAoIWFyZ3VtZW50cy5sZW5ndGgpIHJldHVyblxuICAgICAgICBcbiAgICAgICAgdmFyIGZsYXR0ZW5pbmcgPSB0aGlzLmNsZWFuQ2xvbmUoKVxuICAgICAgICBcbiAgICAgICAgSm9vc2UuQS5lYWNoKGFyZ3VtZW50cywgZnVuY3Rpb24gKGFyZykge1xuICAgICAgICAgICAgdmFyIGlzRGVzY3JpcHRvciAgICA9ICEoYXJnIGluc3RhbmNlb2YgSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eVNldClcbiAgICAgICAgICAgIHZhciBwcm9wU2V0ICAgICAgICAgPSBpc0Rlc2NyaXB0b3IgPyBhcmcucHJvcGVydHlTZXQgOiBhcmdcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcHJvcFNldC5iZWZvcmVDb25zdW1lZEJ5KHRoaXMsIGZsYXR0ZW5pbmcpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmIChpc0Rlc2NyaXB0b3IpIHtcbiAgICAgICAgICAgICAgICBpZiAoYXJnLmFsaWFzIHx8IGFyZy5leGNsdWRlKSAgIHByb3BTZXQgPSBwcm9wU2V0LmNsb25lKClcbiAgICAgICAgICAgICAgICBpZiAoYXJnLmFsaWFzKSAgICAgICAgICAgICAgICAgIHByb3BTZXQuYWxpYXMoYXJnLmFsaWFzKVxuICAgICAgICAgICAgICAgIGlmIChhcmcuZXhjbHVkZSkgICAgICAgICAgICAgICAgcHJvcFNldC5leGNsdWRlKGFyZy5leGNsdWRlKVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBwcm9wU2V0LmZsYXR0ZW5UbyhmbGF0dGVuaW5nKVxuICAgICAgICB9LCB0aGlzKVxuICAgICAgICBcbiAgICAgICAgZmxhdHRlbmluZy5jb21wb3NlVG8odGhpcylcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIHByZUFwcGx5IDogZnVuY3Rpb24gKHRhcmdldCkge1xuICAgICAgICB0aGlzLmVhY2hPd24oZnVuY3Rpb24gKHByb3BlcnR5KSB7XG4gICAgICAgICAgICBwcm9wZXJ0eS5wcmVBcHBseSh0YXJnZXQpXG4gICAgICAgIH0pXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBhcHBseSA6IGZ1bmN0aW9uICh0YXJnZXQpIHtcbiAgICAgICAgdGhpcy5lYWNoT3duKGZ1bmN0aW9uIChwcm9wZXJ0eSkge1xuICAgICAgICAgICAgcHJvcGVydHkuYXBwbHkodGFyZ2V0KVxuICAgICAgICB9KVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgdW5hcHBseSA6IGZ1bmN0aW9uIChmcm9tKSB7XG4gICAgICAgIHRoaXMuZWFjaE93bihmdW5jdGlvbiAocHJvcGVydHkpIHtcbiAgICAgICAgICAgIHByb3BlcnR5LnVuYXBwbHkoZnJvbSlcbiAgICAgICAgfSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIHBvc3RVbkFwcGx5IDogZnVuY3Rpb24gKHRhcmdldCkge1xuICAgICAgICB0aGlzLmVhY2hPd24oZnVuY3Rpb24gKHByb3BlcnR5KSB7XG4gICAgICAgICAgICBwcm9wZXJ0eS5wb3N0VW5BcHBseSh0YXJnZXQpXG4gICAgICAgIH0pXG4gICAgfVxuICAgIFxufSkuY1xuO1xudmFyIF9fSURfXyA9IDFcblxuXG5Kb29zZS5NYW5hZ2VkLlByb3BlcnR5U2V0Lk11dGFibGUgPSBuZXcgSm9vc2UuUHJvdG8uQ2xhc3MoJ0pvb3NlLk1hbmFnZWQuUHJvcGVydHlTZXQuTXV0YWJsZScsIHtcbiAgICBcbiAgICBpc2EgICAgICAgICAgICAgICAgIDogSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eVNldCxcblxuICAgIElEICAgICAgICAgICAgICAgICAgOiBudWxsLFxuICAgIFxuICAgIGRlcml2YXRpdmVzICAgICAgICAgOiBudWxsLFxuICAgIFxuICAgIG9wZW5lZCAgICAgICAgICAgICAgOiBudWxsLFxuICAgIFxuICAgIGNvbXBvc2VkRnJvbSAgICAgICAgOiBudWxsLFxuICAgIFxuICAgIFxuICAgIGluaXRpYWxpemUgOiBmdW5jdGlvbiAocHJvcHMpIHtcbiAgICAgICAgSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eVNldC5NdXRhYmxlLnN1cGVyQ2xhc3MuaW5pdGlhbGl6ZS5jYWxsKHRoaXMsIHByb3BzKVxuICAgICAgICBcbiAgICAgICAgLy9pbml0aWFsbHkgb3BlbmVkXG4gICAgICAgIHRoaXMub3BlbmVkICAgICAgICAgICAgID0gMVxuICAgICAgICB0aGlzLmRlcml2YXRpdmVzICAgICAgICA9IHt9XG4gICAgICAgIHRoaXMuSUQgICAgICAgICAgICAgICAgID0gX19JRF9fKytcbiAgICAgICAgdGhpcy5jb21wb3NlZEZyb20gICAgICAgPSBbXVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgYWRkQ29tcG9zZUluZm8gOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHRoaXMuZW5zdXJlT3BlbigpXG4gICAgICAgIFxuICAgICAgICBKb29zZS5BLmVhY2goYXJndW1lbnRzLCBmdW5jdGlvbiAoYXJnKSB7XG4gICAgICAgICAgICB0aGlzLmNvbXBvc2VkRnJvbS5wdXNoKGFyZylcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdmFyIHByb3BTZXQgPSBhcmcgaW5zdGFuY2VvZiBKb29zZS5NYW5hZ2VkLlByb3BlcnR5U2V0ID8gYXJnIDogYXJnLnByb3BlcnR5U2V0XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICBwcm9wU2V0LmRlcml2YXRpdmVzW3RoaXMuSURdID0gdGhpc1xuICAgICAgICB9LCB0aGlzKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgcmVtb3ZlQ29tcG9zZUluZm8gOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHRoaXMuZW5zdXJlT3BlbigpXG4gICAgICAgIFxuICAgICAgICBKb29zZS5BLmVhY2goYXJndW1lbnRzLCBmdW5jdGlvbiAoYXJnKSB7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciBpID0gMFxuICAgICAgICAgICAgXG4gICAgICAgICAgICB3aGlsZSAoaSA8IHRoaXMuY29tcG9zZWRGcm9tLmxlbmd0aCkge1xuICAgICAgICAgICAgICAgIHZhciBwcm9wU2V0ID0gdGhpcy5jb21wb3NlZEZyb21baV1cbiAgICAgICAgICAgICAgICBwcm9wU2V0ID0gcHJvcFNldCBpbnN0YW5jZW9mIEpvb3NlLk1hbmFnZWQuUHJvcGVydHlTZXQgPyBwcm9wU2V0IDogcHJvcFNldC5wcm9wZXJ0eVNldFxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIGlmIChhcmcgPT0gcHJvcFNldCkge1xuICAgICAgICAgICAgICAgICAgICBkZWxldGUgcHJvcFNldC5kZXJpdmF0aXZlc1t0aGlzLklEXVxuICAgICAgICAgICAgICAgICAgICB0aGlzLmNvbXBvc2VkRnJvbS5zcGxpY2UoaSwgMSlcbiAgICAgICAgICAgICAgICB9IGVsc2UgaSsrXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBcbiAgICAgICAgfSwgdGhpcylcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGVuc3VyZU9wZW4gOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIGlmICghdGhpcy5vcGVuZWQpIHRocm93IFwiTXV0YXRpb24gb2YgY2xvc2VkIHByb3BlcnR5IHNldDogW1wiICsgdGhpcy5uYW1lICsgXCJdXCJcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGFkZFByb3BlcnR5IDogZnVuY3Rpb24gKG5hbWUsIHByb3BzKSB7XG4gICAgICAgIHRoaXMuZW5zdXJlT3BlbigpXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eVNldC5NdXRhYmxlLnN1cGVyQ2xhc3MuYWRkUHJvcGVydHkuY2FsbCh0aGlzLCBuYW1lLCBwcm9wcylcbiAgICB9LFxuICAgIFxuXG4gICAgYWRkUHJvcGVydHlPYmplY3QgOiBmdW5jdGlvbiAob2JqZWN0KSB7XG4gICAgICAgIHRoaXMuZW5zdXJlT3BlbigpXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eVNldC5NdXRhYmxlLnN1cGVyQ2xhc3MuYWRkUHJvcGVydHlPYmplY3QuY2FsbCh0aGlzLCBvYmplY3QpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICByZW1vdmVQcm9wZXJ0eSA6IGZ1bmN0aW9uIChuYW1lKSB7XG4gICAgICAgIHRoaXMuZW5zdXJlT3BlbigpXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eVNldC5NdXRhYmxlLnN1cGVyQ2xhc3MucmVtb3ZlUHJvcGVydHkuY2FsbCh0aGlzLCBuYW1lKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgY29tcG9zZUZyb20gOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHRoaXMuZW5zdXJlT3BlbigpXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eVNldC5NdXRhYmxlLnN1cGVyQ2xhc3MuY29tcG9zZUZyb20uYXBwbHkodGhpcywgdGhpcy5jb21wb3NlZEZyb20pXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBvcGVuIDogZnVuY3Rpb24gKCkge1xuICAgICAgICB0aGlzLm9wZW5lZCsrXG4gICAgICAgIFxuICAgICAgICBpZiAodGhpcy5vcGVuZWQgPT0gMSkge1xuICAgICAgICBcbiAgICAgICAgICAgIEpvb3NlLk8uZWFjaCh0aGlzLmRlcml2YXRpdmVzLCBmdW5jdGlvbiAocHJvcFNldCkge1xuICAgICAgICAgICAgICAgIHByb3BTZXQub3BlbigpXG4gICAgICAgICAgICB9KVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLmRlQ29tcG9zZSgpXG4gICAgICAgIH1cbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGNsb3NlIDogZnVuY3Rpb24gKCkge1xuICAgICAgICBpZiAoIXRoaXMub3BlbmVkKSB0aHJvdyBcIlVubWF0Y2hlZCAnY2xvc2UnIG9wZXJhdGlvbiBvbiBwcm9wZXJ0eSBzZXQ6IFtcIiArIHRoaXMubmFtZSArIFwiXVwiXG4gICAgICAgIFxuICAgICAgICBpZiAodGhpcy5vcGVuZWQgPT0gMSkge1xuICAgICAgICAgICAgdGhpcy5yZUNvbXBvc2UoKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBKb29zZS5PLmVhY2godGhpcy5kZXJpdmF0aXZlcywgZnVuY3Rpb24gKHByb3BTZXQpIHtcbiAgICAgICAgICAgICAgICBwcm9wU2V0LmNsb3NlKClcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5vcGVuZWQtLVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgcmVDb21wb3NlIDogZnVuY3Rpb24gKCkge1xuICAgICAgICB0aGlzLmNvbXBvc2VGcm9tKClcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGRlQ29tcG9zZSA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgdGhpcy5lYWNoT3duKGZ1bmN0aW9uIChwcm9wZXJ0eSwgbmFtZSkge1xuICAgICAgICAgICAgaWYgKHByb3BlcnR5LmRlZmluZWRJbiAhPSB0aGlzKSB0aGlzLnJlbW92ZVByb3BlcnR5KG5hbWUpXG4gICAgICAgIH0sIHRoaXMpXG4gICAgfVxuICAgIFxufSkuYztcbkpvb3NlLk1hbmFnZWQuU3RlbUVsZW1lbnQgPSBmdW5jdGlvbiAoKSB7IHRocm93IFwiTW9kdWxlcyBtYXkgbm90IGJlIGluc3RhbnRpYXRlZC5cIiB9XG5cbkpvb3NlLk1hbmFnZWQuU3RlbUVsZW1lbnQuQXR0cmlidXRlcyA9IG5ldyBKb29zZS5Qcm90by5DbGFzcygnSm9vc2UuTWFuYWdlZC5TdGVtRWxlbWVudC5BdHRyaWJ1dGVzJywge1xuICAgIFxuICAgIGlzYSAgICAgICAgICAgICAgICAgICAgIDogSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eVNldC5NdXRhYmxlLFxuICAgIFxuICAgIHByb3BlcnR5TWV0YUNsYXNzICAgICAgIDogSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5BdHRyaWJ1dGVcbiAgICBcbn0pLmNcbjtcbkpvb3NlLk1hbmFnZWQuU3RlbUVsZW1lbnQuTWV0aG9kcyA9IG5ldyBKb29zZS5Qcm90by5DbGFzcygnSm9vc2UuTWFuYWdlZC5TdGVtRWxlbWVudC5NZXRob2RzJywge1xuICAgIFxuICAgIGlzYSA6IEpvb3NlLk1hbmFnZWQuUHJvcGVydHlTZXQuTXV0YWJsZSxcbiAgICBcbiAgICBwcm9wZXJ0eU1ldGFDbGFzcyA6IEpvb3NlLk1hbmFnZWQuUHJvcGVydHkuTWV0aG9kTW9kaWZpZXIuUHV0LFxuXG4gICAgXG4gICAgcHJlQXBwbHkgOiBmdW5jdGlvbiAoKSB7XG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBwb3N0VW5BcHBseSA6IGZ1bmN0aW9uICgpIHtcbiAgICB9XG4gICAgXG59KS5jO1xuSm9vc2UuTWFuYWdlZC5TdGVtRWxlbWVudC5SZXF1aXJlbWVudHMgPSBuZXcgSm9vc2UuUHJvdG8uQ2xhc3MoJ0pvb3NlLk1hbmFnZWQuU3RlbUVsZW1lbnQuUmVxdWlyZW1lbnRzJywge1xuXG4gICAgaXNhICAgICAgICAgICAgICAgICAgICAgOiBKb29zZS5NYW5hZ2VkLlByb3BlcnR5U2V0Lk11dGFibGUsXG4gICAgXG4gICAgcHJvcGVydHlNZXRhQ2xhc3MgICAgICAgOiBKb29zZS5NYW5hZ2VkLlByb3BlcnR5LlJlcXVpcmVtZW50LFxuICAgIFxuICAgIFxuICAgIFxuICAgIGFsaWFzIDogZnVuY3Rpb24gKCkge1xuICAgIH0sXG4gICAgXG4gICAgXG4gICAgZXhjbHVkZSA6IGZ1bmN0aW9uICgpIHtcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGZsYXR0ZW5UbyA6IGZ1bmN0aW9uICh0YXJnZXQpIHtcbiAgICAgICAgdGhpcy5lYWNoKGZ1bmN0aW9uIChwcm9wZXJ0eSwgbmFtZSkge1xuICAgICAgICAgICAgaWYgKCF0YXJnZXQuaGF2ZVByb3BlcnR5KG5hbWUpKSB0YXJnZXQuYWRkUHJvcGVydHlPYmplY3QocHJvcGVydHkpXG4gICAgICAgIH0pXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBjb21wb3NlVG8gOiBmdW5jdGlvbiAodGFyZ2V0KSB7XG4gICAgICAgIHRoaXMuZmxhdHRlblRvKHRhcmdldClcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIHByZUFwcGx5IDogZnVuY3Rpb24gKCkge1xuICAgIH0sXG4gICAgXG4gICAgXG4gICAgcG9zdFVuQXBwbHkgOiBmdW5jdGlvbiAoKSB7XG4gICAgfVxuICAgIFxufSkuYztcbkpvb3NlLk1hbmFnZWQuU3RlbUVsZW1lbnQuTWV0aG9kTW9kaWZpZXJzID0gbmV3IEpvb3NlLlByb3RvLkNsYXNzKCdKb29zZS5NYW5hZ2VkLlN0ZW1FbGVtZW50Lk1ldGhvZE1vZGlmaWVycycsIHtcblxuICAgIGlzYSAgICAgICAgICAgICAgICAgICAgIDogSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eVNldC5NdXRhYmxlLFxuICAgIFxuICAgIHByb3BlcnR5TWV0YUNsYXNzICAgICAgIDogbnVsbCxcbiAgICBcbiAgICBcbiAgICBhZGRQcm9wZXJ0eSA6IGZ1bmN0aW9uIChuYW1lLCBwcm9wcykge1xuICAgICAgICB2YXIgbWV0YUNsYXNzID0gcHJvcHMubWV0YVxuICAgICAgICBkZWxldGUgcHJvcHMubWV0YVxuICAgICAgICBcbiAgICAgICAgcHJvcHMuZGVmaW5lZEluICAgICAgICAgPSB0aGlzXG4gICAgICAgIHByb3BzLm5hbWUgICAgICAgICAgICAgID0gbmFtZVxuICAgICAgICBcbiAgICAgICAgdmFyIG1vZGlmaWVyICAgICAgICAgICAgPSBuZXcgbWV0YUNsYXNzKHByb3BzKVxuICAgICAgICB2YXIgcHJvcGVydGllcyAgICAgICAgICA9IHRoaXMucHJvcGVydGllc1xuICAgICAgICBcbiAgICAgICAgaWYgKCFwcm9wZXJ0aWVzW25hbWVdKSBwcm9wZXJ0aWVzWyBuYW1lIF0gPSBbXVxuICAgICAgICBcbiAgICAgICAgcHJvcGVydGllc1tuYW1lXS5wdXNoKG1vZGlmaWVyKVxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIG1vZGlmaWVyXG4gICAgfSxcbiAgICBcblxuICAgIGFkZFByb3BlcnR5T2JqZWN0IDogZnVuY3Rpb24gKG9iamVjdCkge1xuICAgICAgICB2YXIgbmFtZSAgICAgICAgICAgID0gb2JqZWN0Lm5hbWVcbiAgICAgICAgdmFyIHByb3BlcnRpZXMgICAgICA9IHRoaXMucHJvcGVydGllc1xuICAgICAgICBcbiAgICAgICAgaWYgKCFwcm9wZXJ0aWVzW25hbWVdKSBwcm9wZXJ0aWVzW25hbWVdID0gW11cbiAgICAgICAgXG4gICAgICAgIHByb3BlcnRpZXNbbmFtZV0ucHVzaChvYmplY3QpXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gb2JqZWN0XG4gICAgfSxcbiAgICBcbiAgICBcbiAgICAvL3JlbW92ZSBvbmx5IHRoZSBsYXN0IG1vZGlmaWVyXG4gICAgcmVtb3ZlUHJvcGVydHkgOiBmdW5jdGlvbiAobmFtZSkge1xuICAgICAgICBpZiAoIXRoaXMuaGF2ZVByb3BlcnR5KG5hbWUpKSByZXR1cm4gdW5kZWZpbmVkXG4gICAgICAgIFxuICAgICAgICB2YXIgcHJvcGVydGllcyAgICAgID0gdGhpcy5wcm9wZXJ0aWVzXG4gICAgICAgIHZhciBtb2RpZmllciAgICAgICAgPSBwcm9wZXJ0aWVzWyBuYW1lIF0ucG9wKClcbiAgICAgICAgXG4gICAgICAgIC8vaWYgYWxsIG1vZGlmaWVycyB3ZXJlIHJlbW92ZWQgLSBjbGVhcmluZyB0aGUgcHJvcGVydGllc1xuICAgICAgICBpZiAoIXByb3BlcnRpZXNbbmFtZV0ubGVuZ3RoKSBKb29zZS5NYW5hZ2VkLlN0ZW1FbGVtZW50Lk1ldGhvZE1vZGlmaWVycy5zdXBlckNsYXNzLnJlbW92ZVByb3BlcnR5LmNhbGwodGhpcywgbmFtZSlcbiAgICAgICAgXG4gICAgICAgIHJldHVybiBtb2RpZmllclxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgYWxpYXMgOiBmdW5jdGlvbiAoKSB7XG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBleGNsdWRlIDogZnVuY3Rpb24gKCkge1xuICAgIH0sXG4gICAgXG4gICAgXG4gICAgZmxhdHRlblRvIDogZnVuY3Rpb24gKHRhcmdldCkge1xuICAgICAgICB2YXIgdGFyZ2V0UHJvcHMgPSB0YXJnZXQucHJvcGVydGllc1xuICAgICAgICBcbiAgICAgICAgdGhpcy5lYWNoKGZ1bmN0aW9uIChtb2RpZmllcnNBcnIsIG5hbWUpIHtcbiAgICAgICAgICAgIHZhciB0YXJnZXRNb2RpZmllcnNBcnIgPSB0YXJnZXRQcm9wc1tuYW1lXVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAodGFyZ2V0TW9kaWZpZXJzQXJyID09IG51bGwpIHRhcmdldE1vZGlmaWVyc0FyciA9IHRhcmdldFByb3BzW25hbWVdID0gW11cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgSm9vc2UuQS5lYWNoKG1vZGlmaWVyc0FyciwgZnVuY3Rpb24gKG1vZGlmaWVyKSB7XG4gICAgICAgICAgICAgICAgaWYgKCFKb29zZS5BLmV4aXN0cyh0YXJnZXRNb2RpZmllcnNBcnIsIG1vZGlmaWVyKSkgdGFyZ2V0TW9kaWZpZXJzQXJyLnB1c2gobW9kaWZpZXIpXG4gICAgICAgICAgICB9KVxuICAgICAgICAgICAgXG4gICAgICAgIH0pXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBjb21wb3NlVG8gOiBmdW5jdGlvbiAodGFyZ2V0KSB7XG4gICAgICAgIHRoaXMuZmxhdHRlblRvKHRhcmdldClcbiAgICB9LFxuXG4gICAgXG4gICAgZGVDb21wb3NlIDogZnVuY3Rpb24gKCkge1xuICAgICAgICB0aGlzLmVhY2goZnVuY3Rpb24gKG1vZGlmaWVyc0FyciwgbmFtZSkge1xuICAgICAgICAgICAgdmFyIGkgPSAwXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHdoaWxlIChpIDwgbW9kaWZpZXJzQXJyLmxlbmd0aCkgXG4gICAgICAgICAgICAgICAgaWYgKG1vZGlmaWVyc0FycltpXS5kZWZpbmVkSW4gIT0gdGhpcykgXG4gICAgICAgICAgICAgICAgICAgIG1vZGlmaWVyc0Fyci5zcGxpY2UoaSwgMSlcbiAgICAgICAgICAgICAgICBlbHNlIFxuICAgICAgICAgICAgICAgICAgICBpKytcbiAgICAgICAgfSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIHByZUFwcGx5IDogZnVuY3Rpb24gKHRhcmdldCkge1xuICAgIH0sXG5cbiAgICBcbiAgICBwb3N0VW5BcHBseSA6IGZ1bmN0aW9uICh0YXJnZXQpIHtcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGFwcGx5IDogZnVuY3Rpb24gKHRhcmdldCkge1xuICAgICAgICB0aGlzLmVhY2goZnVuY3Rpb24gKG1vZGlmaWVyc0FyciwgbmFtZSkge1xuICAgICAgICAgICAgSm9vc2UuQS5lYWNoKG1vZGlmaWVyc0FyciwgZnVuY3Rpb24gKG1vZGlmaWVyKSB7XG4gICAgICAgICAgICAgICAgbW9kaWZpZXIuYXBwbHkodGFyZ2V0KVxuICAgICAgICAgICAgfSlcbiAgICAgICAgfSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIHVuYXBwbHkgOiBmdW5jdGlvbiAoZnJvbSkge1xuICAgICAgICB0aGlzLmVhY2goZnVuY3Rpb24gKG1vZGlmaWVyc0FyciwgbmFtZSkge1xuICAgICAgICAgICAgZm9yICh2YXIgaSA9IG1vZGlmaWVyc0Fyci5sZW5ndGggLSAxOyBpID49MCA7IGktLSkgbW9kaWZpZXJzQXJyW2ldLnVuYXBwbHkoZnJvbSlcbiAgICAgICAgfSlcbiAgICB9XG4gICAgXG4gICAgXG4gICAgXG59KS5jO1xuSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eVNldC5Db21wb3NpdGlvbiA9IG5ldyBKb29zZS5Qcm90by5DbGFzcygnSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eVNldC5Db21wb3NpdGlvbicsIHtcbiAgICBcbiAgICBpc2EgICAgICAgICAgICAgICAgICAgICAgICAgOiBKb29zZS5NYW5hZ2VkLlByb3BlcnR5U2V0Lk11dGFibGUsXG4gICAgXG4gICAgcHJvcGVydHlNZXRhQ2xhc3MgICAgICAgICAgIDogSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eVNldC5NdXRhYmxlLFxuICAgIFxuICAgIHByb2Nlc3NPcmRlciAgICAgICAgICAgICAgICA6IG51bGwsXG5cbiAgICBcbiAgICBlYWNoIDogZnVuY3Rpb24gKGZ1bmMsIHNjb3BlKSB7XG4gICAgICAgIHZhciBwcm9wcyAgID0gdGhpcy5wcm9wZXJ0aWVzXG4gICAgICAgIHZhciBzY29wZSAgID0gc2NvcGUgfHwgdGhpc1xuICAgICAgICBcbiAgICAgICAgSm9vc2UuQS5lYWNoKHRoaXMucHJvY2Vzc09yZGVyLCBmdW5jdGlvbiAobmFtZSkge1xuICAgICAgICAgICAgZnVuYy5jYWxsKHNjb3BlLCBwcm9wc1tuYW1lXSwgbmFtZSlcbiAgICAgICAgfSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGVhY2hSIDogZnVuY3Rpb24gKGZ1bmMsIHNjb3BlKSB7XG4gICAgICAgIHZhciBwcm9wcyAgID0gdGhpcy5wcm9wZXJ0aWVzXG4gICAgICAgIHZhciBzY29wZSAgID0gc2NvcGUgfHwgdGhpc1xuICAgICAgICBcbiAgICAgICAgSm9vc2UuQS5lYWNoUih0aGlzLnByb2Nlc3NPcmRlciwgZnVuY3Rpb24gKG5hbWUpIHtcbiAgICAgICAgICAgIGZ1bmMuY2FsbChzY29wZSwgcHJvcHNbbmFtZV0sIG5hbWUpXG4gICAgICAgIH0pXG4gICAgICAgIFxuICAgICAgICBcbi8vICAgICAgICB2YXIgcHJvcHMgICAgICAgICAgID0gdGhpcy5wcm9wZXJ0aWVzXG4vLyAgICAgICAgdmFyIHByb2Nlc3NPcmRlciAgICA9IHRoaXMucHJvY2Vzc09yZGVyXG4vLyAgICAgICAgXG4vLyAgICAgICAgZm9yKHZhciBpID0gcHJvY2Vzc09yZGVyLmxlbmd0aCAtIDE7IGkgPj0gMDsgaS0tKSBcbi8vICAgICAgICAgICAgZnVuYy5jYWxsKHNjb3BlIHx8IHRoaXMsIHByb3BzWyBwcm9jZXNzT3JkZXJbaV0gXSwgcHJvY2Vzc09yZGVyW2ldKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgY2xvbmUgOiBmdW5jdGlvbiAobmFtZSkge1xuICAgICAgICB2YXIgY2xvbmUgPSB0aGlzLmNsZWFuQ2xvbmUobmFtZSlcbiAgICAgICAgXG4gICAgICAgIHRoaXMuZWFjaChmdW5jdGlvbiAocHJvcGVydHkpIHtcbiAgICAgICAgICAgIGNsb25lLmFkZFByb3BlcnR5T2JqZWN0KHByb3BlcnR5LmNsb25lKCkpXG4gICAgICAgIH0pXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gY2xvbmVcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGFsaWFzIDogZnVuY3Rpb24gKHdoYXQpIHtcbiAgICAgICAgdGhpcy5lYWNoKGZ1bmN0aW9uIChwcm9wZXJ0eSkge1xuICAgICAgICAgICAgcHJvcGVydHkuYWxpYXMod2hhdClcbiAgICAgICAgfSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGV4Y2x1ZGUgOiBmdW5jdGlvbiAod2hhdCkge1xuICAgICAgICB0aGlzLmVhY2goZnVuY3Rpb24gKHByb3BlcnR5KSB7XG4gICAgICAgICAgICBwcm9wZXJ0eS5leGNsdWRlKHdoYXQpXG4gICAgICAgIH0pXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBmbGF0dGVuVG8gOiBmdW5jdGlvbiAodGFyZ2V0KSB7XG4gICAgICAgIHZhciB0YXJnZXRQcm9wcyA9IHRhcmdldC5wcm9wZXJ0aWVzXG4gICAgICAgIFxuICAgICAgICB0aGlzLmVhY2goZnVuY3Rpb24gKHByb3BlcnR5LCBuYW1lKSB7XG4gICAgICAgICAgICB2YXIgc3ViVGFyZ2V0ID0gdGFyZ2V0UHJvcHNbbmFtZV0gfHwgdGFyZ2V0LmFkZFByb3BlcnR5KG5hbWUsIHtcbiAgICAgICAgICAgICAgICBtZXRhIDogcHJvcGVydHkuY29uc3RydWN0b3JcbiAgICAgICAgICAgIH0pXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHByb3BlcnR5LmZsYXR0ZW5UbyhzdWJUYXJnZXQpXG4gICAgICAgIH0pXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBjb21wb3NlVG8gOiBmdW5jdGlvbiAodGFyZ2V0KSB7XG4gICAgICAgIHZhciB0YXJnZXRQcm9wcyA9IHRhcmdldC5wcm9wZXJ0aWVzXG4gICAgICAgIFxuICAgICAgICB0aGlzLmVhY2goZnVuY3Rpb24gKHByb3BlcnR5LCBuYW1lKSB7XG4gICAgICAgICAgICB2YXIgc3ViVGFyZ2V0ID0gdGFyZ2V0UHJvcHNbbmFtZV0gfHwgdGFyZ2V0LmFkZFByb3BlcnR5KG5hbWUsIHtcbiAgICAgICAgICAgICAgICBtZXRhIDogcHJvcGVydHkuY29uc3RydWN0b3JcbiAgICAgICAgICAgIH0pXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHByb3BlcnR5LmNvbXBvc2VUbyhzdWJUYXJnZXQpXG4gICAgICAgIH0pXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBcbiAgICBkZUNvbXBvc2UgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHRoaXMuZWFjaFIoZnVuY3Rpb24gKHByb3BlcnR5KSB7XG4gICAgICAgICAgICBwcm9wZXJ0eS5vcGVuKClcbiAgICAgICAgfSlcbiAgICAgICAgXG4gICAgICAgIEpvb3NlLk1hbmFnZWQuUHJvcGVydHlTZXQuQ29tcG9zaXRpb24uc3VwZXJDbGFzcy5kZUNvbXBvc2UuY2FsbCh0aGlzKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgcmVDb21wb3NlIDogZnVuY3Rpb24gKCkge1xuICAgICAgICBKb29zZS5NYW5hZ2VkLlByb3BlcnR5U2V0LkNvbXBvc2l0aW9uLnN1cGVyQ2xhc3MucmVDb21wb3NlLmNhbGwodGhpcylcbiAgICAgICAgXG4gICAgICAgIHRoaXMuZWFjaChmdW5jdGlvbiAocHJvcGVydHkpIHtcbiAgICAgICAgICAgIHByb3BlcnR5LmNsb3NlKClcbiAgICAgICAgfSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIHVuYXBwbHkgOiBmdW5jdGlvbiAoZnJvbSkge1xuICAgICAgICB0aGlzLmVhY2hSKGZ1bmN0aW9uIChwcm9wZXJ0eSkge1xuICAgICAgICAgICAgcHJvcGVydHkudW5hcHBseShmcm9tKVxuICAgICAgICB9KVxuICAgIH1cbiAgICBcbn0pLmNcbjtcbkpvb3NlLk1hbmFnZWQuU3RlbSA9IG5ldyBKb29zZS5Qcm90by5DbGFzcygnSm9vc2UuTWFuYWdlZC5TdGVtJywge1xuICAgIFxuICAgIGlzYSAgICAgICAgICAgICAgICAgIDogSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eVNldC5Db21wb3NpdGlvbixcbiAgICBcbiAgICB0YXJnZXRNZXRhICAgICAgICAgICA6IG51bGwsXG4gICAgXG4gICAgYXR0cmlidXRlc01DICAgICAgICAgOiBKb29zZS5NYW5hZ2VkLlN0ZW1FbGVtZW50LkF0dHJpYnV0ZXMsXG4gICAgbWV0aG9kc01DICAgICAgICAgICAgOiBKb29zZS5NYW5hZ2VkLlN0ZW1FbGVtZW50Lk1ldGhvZHMsXG4gICAgcmVxdWlyZW1lbnRzTUMgICAgICAgOiBKb29zZS5NYW5hZ2VkLlN0ZW1FbGVtZW50LlJlcXVpcmVtZW50cyxcbiAgICBtZXRob2RzTW9kaWZpZXJzTUMgICA6IEpvb3NlLk1hbmFnZWQuU3RlbUVsZW1lbnQuTWV0aG9kTW9kaWZpZXJzLFxuICAgIFxuICAgIHByb2Nlc3NPcmRlciAgICAgICAgIDogWyAnYXR0cmlidXRlcycsICdtZXRob2RzJywgJ3JlcXVpcmVtZW50cycsICdtZXRob2RzTW9kaWZpZXJzJyBdLFxuICAgIFxuICAgIFxuICAgIGluaXRpYWxpemUgOiBmdW5jdGlvbiAocHJvcHMpIHtcbiAgICAgICAgSm9vc2UuTWFuYWdlZC5TdGVtLnN1cGVyQ2xhc3MuaW5pdGlhbGl6ZS5jYWxsKHRoaXMsIHByb3BzKVxuICAgICAgICBcbiAgICAgICAgdmFyIHRhcmdldE1ldGEgPSB0aGlzLnRhcmdldE1ldGFcbiAgICAgICAgXG4gICAgICAgIHRoaXMuYWRkUHJvcGVydHkoJ2F0dHJpYnV0ZXMnLCB7XG4gICAgICAgICAgICBtZXRhIDogdGhpcy5hdHRyaWJ1dGVzTUMsXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vaXQgY2FuIGJlIG5vICd0YXJnZXRNZXRhJyBpbiBjbG9uZXNcbiAgICAgICAgICAgIHByb3BlcnRpZXMgOiB0YXJnZXRNZXRhID8gdGFyZ2V0TWV0YS5hdHRyaWJ1dGVzIDoge31cbiAgICAgICAgfSlcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICB0aGlzLmFkZFByb3BlcnR5KCdtZXRob2RzJywge1xuICAgICAgICAgICAgbWV0YSA6IHRoaXMubWV0aG9kc01DLFxuICAgICAgICAgICAgXG4gICAgICAgICAgICBwcm9wZXJ0aWVzIDogdGFyZ2V0TWV0YSA/IHRhcmdldE1ldGEubWV0aG9kcyA6IHt9XG4gICAgICAgIH0pXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgdGhpcy5hZGRQcm9wZXJ0eSgncmVxdWlyZW1lbnRzJywge1xuICAgICAgICAgICAgbWV0YSA6IHRoaXMucmVxdWlyZW1lbnRzTUNcbiAgICAgICAgfSlcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICB0aGlzLmFkZFByb3BlcnR5KCdtZXRob2RzTW9kaWZpZXJzJywge1xuICAgICAgICAgICAgbWV0YSA6IHRoaXMubWV0aG9kc01vZGlmaWVyc01DXG4gICAgICAgIH0pXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICByZUNvbXBvc2UgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHZhciBjICAgICAgID0gdGhpcy50YXJnZXRNZXRhLmNcbiAgICAgICAgXG4gICAgICAgIHRoaXMucHJlQXBwbHkoYylcbiAgICAgICAgXG4gICAgICAgIEpvb3NlLk1hbmFnZWQuU3RlbS5zdXBlckNsYXNzLnJlQ29tcG9zZS5jYWxsKHRoaXMpXG4gICAgICAgIFxuICAgICAgICB0aGlzLmFwcGx5KGMpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBkZUNvbXBvc2UgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHZhciBjICAgICAgID0gdGhpcy50YXJnZXRNZXRhLmNcbiAgICAgICAgXG4gICAgICAgIHRoaXMudW5hcHBseShjKVxuICAgICAgICBcbiAgICAgICAgSm9vc2UuTWFuYWdlZC5TdGVtLnN1cGVyQ2xhc3MuZGVDb21wb3NlLmNhbGwodGhpcylcbiAgICAgICAgXG4gICAgICAgIHRoaXMucG9zdFVuQXBwbHkoYylcbiAgICB9XG4gICAgXG4gICAgXG59KS5jXG47XG5Kb29zZS5NYW5hZ2VkLkJ1aWxkZXIgPSBuZXcgSm9vc2UuUHJvdG8uQ2xhc3MoJ0pvb3NlLk1hbmFnZWQuQnVpbGRlcicsIHtcbiAgICBcbiAgICB0YXJnZXRNZXRhICAgICAgICAgIDogbnVsbCxcbiAgICBcbiAgICBcbiAgICBfYnVpbGRTdGFydCA6IGZ1bmN0aW9uICh0YXJnZXRNZXRhLCBwcm9wcykge1xuICAgICAgICB0YXJnZXRNZXRhLnN0ZW0ub3BlbigpXG4gICAgICAgIFxuICAgICAgICBKb29zZS5BLmVhY2goWyAndHJhaXQnLCAndHJhaXRzJywgJ3JlbW92ZVRyYWl0JywgJ3JlbW92ZVRyYWl0cycsICdkb2VzJywgJ2RvZXNub3QnLCAnZG9lc250JyBdLCBmdW5jdGlvbiAoYnVpbGRlcikge1xuICAgICAgICAgICAgaWYgKHByb3BzW2J1aWxkZXJdKSB7XG4gICAgICAgICAgICAgICAgdGhpc1tidWlsZGVyXSh0YXJnZXRNZXRhLCBwcm9wc1tidWlsZGVyXSlcbiAgICAgICAgICAgICAgICBkZWxldGUgcHJvcHNbYnVpbGRlcl1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfSwgdGhpcylcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIF9leHRlbmQgOiBmdW5jdGlvbiAocHJvcHMpIHtcbiAgICAgICAgaWYgKEpvb3NlLk8uaXNFbXB0eShwcm9wcykpIHJldHVyblxuICAgICAgICBcbiAgICAgICAgdmFyIHRhcmdldE1ldGEgPSB0aGlzLnRhcmdldE1ldGFcbiAgICAgICAgXG4gICAgICAgIHRoaXMuX2J1aWxkU3RhcnQodGFyZ2V0TWV0YSwgcHJvcHMpXG4gICAgICAgIFxuICAgICAgICBKb29zZS5PLmVhY2hPd24ocHJvcHMsIGZ1bmN0aW9uICh2YWx1ZSwgbmFtZSkge1xuICAgICAgICAgICAgdmFyIGhhbmRsZXIgPSB0aGlzW25hbWVdXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmICghaGFuZGxlcikgdGhyb3cgbmV3IEVycm9yKFwiVW5rbm93biBidWlsZGVyIFtcIiArIG5hbWUgKyBcIl0gd2FzIHVzZWQgZHVyaW5nIGV4dGVuZGluZyBvZiBbXCIgKyB0YXJnZXRNZXRhLmMgKyBcIl1cIilcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaGFuZGxlci5jYWxsKHRoaXMsIHRhcmdldE1ldGEsIHZhbHVlKVxuICAgICAgICB9LCB0aGlzKVxuICAgICAgICBcbiAgICAgICAgdGhpcy5fYnVpbGRDb21wbGV0ZSh0YXJnZXRNZXRhLCBwcm9wcylcbiAgICB9LFxuICAgIFxuXG4gICAgX2J1aWxkQ29tcGxldGUgOiBmdW5jdGlvbiAodGFyZ2V0TWV0YSwgcHJvcHMpIHtcbiAgICAgICAgdGFyZ2V0TWV0YS5zdGVtLmNsb3NlKClcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIG1ldGhvZHMgOiBmdW5jdGlvbiAodGFyZ2V0TWV0YSwgaW5mbykge1xuICAgICAgICBKb29zZS5PLmVhY2hPd24oaW5mbywgZnVuY3Rpb24gKHZhbHVlLCBuYW1lKSB7XG4gICAgICAgICAgICB0YXJnZXRNZXRhLmFkZE1ldGhvZChuYW1lLCB2YWx1ZSlcbiAgICAgICAgfSlcbiAgICB9LFxuICAgIFxuXG4gICAgcmVtb3ZlTWV0aG9kcyA6IGZ1bmN0aW9uICh0YXJnZXRNZXRhLCBpbmZvKSB7XG4gICAgICAgIEpvb3NlLkEuZWFjaChpbmZvLCBmdW5jdGlvbiAobmFtZSkge1xuICAgICAgICAgICAgdGFyZ2V0TWV0YS5yZW1vdmVNZXRob2QobmFtZSlcbiAgICAgICAgfSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGhhdmUgOiBmdW5jdGlvbiAodGFyZ2V0TWV0YSwgaW5mbykge1xuICAgICAgICBKb29zZS5PLmVhY2hPd24oaW5mbywgZnVuY3Rpb24gKHZhbHVlLCBuYW1lKSB7XG4gICAgICAgICAgICB0YXJnZXRNZXRhLmFkZEF0dHJpYnV0ZShuYW1lLCB2YWx1ZSlcbiAgICAgICAgfSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGhhdmVub3QgOiBmdW5jdGlvbiAodGFyZ2V0TWV0YSwgaW5mbykge1xuICAgICAgICBKb29zZS5BLmVhY2goaW5mbywgZnVuY3Rpb24gKG5hbWUpIHtcbiAgICAgICAgICAgIHRhcmdldE1ldGEucmVtb3ZlQXR0cmlidXRlKG5hbWUpXG4gICAgICAgIH0pXG4gICAgfSxcbiAgICBcblxuICAgIGhhdmVudCA6IGZ1bmN0aW9uICh0YXJnZXRNZXRhLCBpbmZvKSB7XG4gICAgICAgIHRoaXMuaGF2ZW5vdCh0YXJnZXRNZXRhLCBpbmZvKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgYWZ0ZXIgOiBmdW5jdGlvbiAodGFyZ2V0TWV0YSwgaW5mbykge1xuICAgICAgICBKb29zZS5PLmVhY2goaW5mbywgZnVuY3Rpb24gKHZhbHVlLCBuYW1lKSB7XG4gICAgICAgICAgICB0YXJnZXRNZXRhLmFkZE1ldGhvZE1vZGlmaWVyKG5hbWUsIHZhbHVlLCBKb29zZS5NYW5hZ2VkLlByb3BlcnR5Lk1ldGhvZE1vZGlmaWVyLkFmdGVyKVxuICAgICAgICB9KVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgYmVmb3JlIDogZnVuY3Rpb24gKHRhcmdldE1ldGEsIGluZm8pIHtcbiAgICAgICAgSm9vc2UuTy5lYWNoKGluZm8sIGZ1bmN0aW9uICh2YWx1ZSwgbmFtZSkge1xuICAgICAgICAgICAgdGFyZ2V0TWV0YS5hZGRNZXRob2RNb2RpZmllcihuYW1lLCB2YWx1ZSwgSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5NZXRob2RNb2RpZmllci5CZWZvcmUpXG4gICAgICAgIH0pXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBvdmVycmlkZSA6IGZ1bmN0aW9uICh0YXJnZXRNZXRhLCBpbmZvKSB7XG4gICAgICAgIEpvb3NlLk8uZWFjaChpbmZvLCBmdW5jdGlvbiAodmFsdWUsIG5hbWUpIHtcbiAgICAgICAgICAgIHRhcmdldE1ldGEuYWRkTWV0aG9kTW9kaWZpZXIobmFtZSwgdmFsdWUsIEpvb3NlLk1hbmFnZWQuUHJvcGVydHkuTWV0aG9kTW9kaWZpZXIuT3ZlcnJpZGUpXG4gICAgICAgIH0pXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBhcm91bmQgOiBmdW5jdGlvbiAodGFyZ2V0TWV0YSwgaW5mbykge1xuICAgICAgICBKb29zZS5PLmVhY2goaW5mbywgZnVuY3Rpb24gKHZhbHVlLCBuYW1lKSB7XG4gICAgICAgICAgICB0YXJnZXRNZXRhLmFkZE1ldGhvZE1vZGlmaWVyKG5hbWUsIHZhbHVlLCBKb29zZS5NYW5hZ2VkLlByb3BlcnR5Lk1ldGhvZE1vZGlmaWVyLkFyb3VuZClcbiAgICAgICAgfSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGF1Z21lbnQgOiBmdW5jdGlvbiAodGFyZ2V0TWV0YSwgaW5mbykge1xuICAgICAgICBKb29zZS5PLmVhY2goaW5mbywgZnVuY3Rpb24gKHZhbHVlLCBuYW1lKSB7XG4gICAgICAgICAgICB0YXJnZXRNZXRhLmFkZE1ldGhvZE1vZGlmaWVyKG5hbWUsIHZhbHVlLCBKb29zZS5NYW5hZ2VkLlByb3BlcnR5Lk1ldGhvZE1vZGlmaWVyLkF1Z21lbnQpXG4gICAgICAgIH0pXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICByZW1vdmVNb2RpZmllciA6IGZ1bmN0aW9uICh0YXJnZXRNZXRhLCBpbmZvKSB7XG4gICAgICAgIEpvb3NlLkEuZWFjaChpbmZvLCBmdW5jdGlvbiAobmFtZSkge1xuICAgICAgICAgICAgdGFyZ2V0TWV0YS5yZW1vdmVNZXRob2RNb2RpZmllcihuYW1lKVxuICAgICAgICB9KVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgZG9lcyA6IGZ1bmN0aW9uICh0YXJnZXRNZXRhLCBpbmZvKSB7XG4gICAgICAgIEpvb3NlLkEuZWFjaChKb29zZS5PLndhbnRBcnJheShpbmZvKSwgZnVuY3Rpb24gKGRlc2MpIHtcbiAgICAgICAgICAgIHRhcmdldE1ldGEuYWRkUm9sZShkZXNjKVxuICAgICAgICB9KVxuICAgIH0sXG4gICAgXG5cbiAgICBkb2Vzbm90IDogZnVuY3Rpb24gKHRhcmdldE1ldGEsIGluZm8pIHtcbiAgICAgICAgSm9vc2UuQS5lYWNoKEpvb3NlLk8ud2FudEFycmF5KGluZm8pLCBmdW5jdGlvbiAoZGVzYykge1xuICAgICAgICAgICAgdGFyZ2V0TWV0YS5yZW1vdmVSb2xlKGRlc2MpXG4gICAgICAgIH0pXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBkb2VzbnQgOiBmdW5jdGlvbiAodGFyZ2V0TWV0YSwgaW5mbykge1xuICAgICAgICB0aGlzLmRvZXNub3QodGFyZ2V0TWV0YSwgaW5mbylcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIHRyYWl0IDogZnVuY3Rpb24gKCkge1xuICAgICAgICB0aGlzLnRyYWl0cy5hcHBseSh0aGlzLCBhcmd1bWVudHMpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICB0cmFpdHMgOiBmdW5jdGlvbiAodGFyZ2V0TWV0YSwgaW5mbykge1xuICAgICAgICBpZiAodGFyZ2V0TWV0YS5maXJzdFBhc3MpIHJldHVyblxuICAgICAgICBcbiAgICAgICAgaWYgKCF0YXJnZXRNZXRhLm1ldGEuaXNEZXRhY2hlZCkgdGhyb3cgXCJDYW4ndCBhcHBseSB0cmFpdCB0byBub3QgZGV0YWNoZWQgY2xhc3NcIlxuICAgICAgICBcbiAgICAgICAgdGFyZ2V0TWV0YS5tZXRhLmV4dGVuZCh7XG4gICAgICAgICAgICBkb2VzIDogaW5mb1xuICAgICAgICB9KVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgcmVtb3ZlVHJhaXQgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHRoaXMucmVtb3ZlVHJhaXRzLmFwcGx5KHRoaXMsIGFyZ3VtZW50cylcbiAgICB9LFxuICAgICBcbiAgICBcbiAgICByZW1vdmVUcmFpdHMgOiBmdW5jdGlvbiAodGFyZ2V0TWV0YSwgaW5mbykge1xuICAgICAgICBpZiAoIXRhcmdldE1ldGEubWV0YS5pc0RldGFjaGVkKSB0aHJvdyBcIkNhbid0IHJlbW92ZSB0cmFpdCBmcm9tIG5vdCBkZXRhY2hlZCBjbGFzc1wiXG4gICAgICAgIFxuICAgICAgICB0YXJnZXRNZXRhLm1ldGEuZXh0ZW5kKHtcbiAgICAgICAgICAgIGRvZXNub3QgOiBpbmZvXG4gICAgICAgIH0pXG4gICAgfVxuICAgIFxuICAgIFxuICAgIFxufSkuYztcbkpvb3NlLk1hbmFnZWQuQ2xhc3MgPSBuZXcgSm9vc2UuUHJvdG8uQ2xhc3MoJ0pvb3NlLk1hbmFnZWQuQ2xhc3MnLCB7XG4gICAgXG4gICAgaXNhICAgICAgICAgICAgICAgICAgICAgICAgIDogSm9vc2UuUHJvdG8uQ2xhc3MsXG4gICAgXG4gICAgc3RlbSAgICAgICAgICAgICAgICAgICAgICAgIDogbnVsbCxcbiAgICBzdGVtQ2xhc3MgICAgICAgICAgICAgICAgICAgOiBKb29zZS5NYW5hZ2VkLlN0ZW0sXG4gICAgc3RlbUNsYXNzQ3JlYXRlZCAgICAgICAgICAgIDogZmFsc2UsXG4gICAgXG4gICAgYnVpbGRlciAgICAgICAgICAgICAgICAgICAgIDogbnVsbCxcbiAgICBidWlsZGVyQ2xhc3MgICAgICAgICAgICAgICAgOiBKb29zZS5NYW5hZ2VkLkJ1aWxkZXIsXG4gICAgYnVpbGRlckNsYXNzQ3JlYXRlZCAgICAgICAgIDogZmFsc2UsXG4gICAgXG4gICAgaXNEZXRhY2hlZCAgICAgICAgICAgICAgICAgIDogZmFsc2UsXG4gICAgZmlyc3RQYXNzICAgICAgICAgICAgICAgICAgIDogdHJ1ZSxcbiAgICBcbiAgICAvLyBhIHNwZWNpYWwgaW5zdGFuY2UsIHdoaWNoLCB3aGVuIHBhc3NlZCBhcyAxc3QgYXJndW1lbnQgdG8gY29uc3RydWN0b3IsIHNpZ25pZmllcyB0aGF0IGNvbnN0cnVjdG9yIHNob3VsZFxuICAgIC8vIHNraXBzIHRyYWl0cyBwcm9jZXNzaW5nIGZvciB0aGlzIGluc3RhbmNlXG4gICAgc2tpcFRyYWl0c0FuY2hvciAgICAgICAgICAgIDoge30sXG4gICAgXG4gICAgXG4gICAgLy9idWlsZCBmb3IgbWV0YWNsYXNzZXMgLSBjb2xsZWN0cyB0cmFpdHMgZnJvbSByb2xlc1xuICAgIEJVSUxEIDogZnVuY3Rpb24gKCkge1xuICAgICAgICB2YXIgc3VwID0gSm9vc2UuTWFuYWdlZC5DbGFzcy5zdXBlckNsYXNzLkJVSUxELmFwcGx5KHRoaXMsIGFyZ3VtZW50cylcbiAgICAgICAgXG4gICAgICAgIHZhciBwcm9wcyAgID0gc3VwLl9fZXh0ZW5kX19cbiAgICAgICAgXG4gICAgICAgIHZhciB0cmFpdHMgPSBKb29zZS5PLndhbnRBcnJheShwcm9wcy50cmFpdCB8fCBwcm9wcy50cmFpdHMgfHwgW10pXG4gICAgICAgIGRlbGV0ZSBwcm9wcy50cmFpdFxuICAgICAgICBkZWxldGUgcHJvcHMudHJhaXRzXG4gICAgICAgIFxuICAgICAgICBKb29zZS5BLmVhY2goSm9vc2UuTy53YW50QXJyYXkocHJvcHMuZG9lcyB8fCBbXSksIGZ1bmN0aW9uIChhcmcpIHtcbiAgICAgICAgICAgIHZhciByb2xlID0gKGFyZy5tZXRhIGluc3RhbmNlb2YgSm9vc2UuTWFuYWdlZC5DbGFzcykgPyBhcmcgOiBhcmcucm9sZVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAocm9sZS5tZXRhLm1ldGEuaXNEZXRhY2hlZCkgdHJhaXRzLnB1c2gocm9sZS5tZXRhLmNvbnN0cnVjdG9yKVxuICAgICAgICB9KVxuICAgICAgICBcbiAgICAgICAgaWYgKHRyYWl0cy5sZW5ndGgpIHByb3BzLnRyYWl0cyA9IHRyYWl0cyBcbiAgICAgICAgXG4gICAgICAgIHJldHVybiBzdXBcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGluaXRJbnN0YW5jZSA6IGZ1bmN0aW9uIChpbnN0YW5jZSwgcHJvcHMpIHtcbiAgICAgICAgSm9vc2UuTy5lYWNoKHRoaXMuYXR0cmlidXRlcywgZnVuY3Rpb24gKGF0dHJpYnV0ZSwgbmFtZSkge1xuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAoYXR0cmlidXRlIGluc3RhbmNlb2YgSm9vc2UuTWFuYWdlZC5BdHRyaWJ1dGUpIFxuICAgICAgICAgICAgICAgIGF0dHJpYnV0ZS5pbml0RnJvbUNvbmZpZyhpbnN0YW5jZSwgcHJvcHMpXG4gICAgICAgICAgICBlbHNlIFxuICAgICAgICAgICAgICAgIGlmIChwcm9wcy5oYXNPd25Qcm9wZXJ0eShuYW1lKSkgaW5zdGFuY2VbbmFtZV0gPSBwcm9wc1tuYW1lXVxuICAgICAgICB9KVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgLy8gd2UgYXJlIHVzaW5nIHRoZSBzYW1lIGNvbnN0cnVjdG9yIGZvciB1c3VhbCBhbmQgbWV0YS0gY2xhc3Nlc1xuICAgIGRlZmF1bHRDb25zdHJ1Y3RvcjogZnVuY3Rpb24gKCkge1xuICAgICAgICByZXR1cm4gZnVuY3Rpb24gKHNraXBUcmFpdHNBbmNob3IsIHBhcmFtcykge1xuICAgICAgICAgICAgXG4gICAgICAgICAgICB2YXIgdGhpc01ldGEgICAgPSB0aGlzLm1ldGFcbiAgICAgICAgICAgIHZhciBza2lwVHJhaXRzICA9IHNraXBUcmFpdHNBbmNob3IgPT0gdGhpc01ldGEuc2tpcFRyYWl0c0FuY2hvclxuICAgICAgICAgICAgXG4gICAgICAgICAgICB2YXIgQlVJTEQgICAgICAgPSB0aGlzLkJVSUxEXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciBwcm9wcyAgICAgICA9IEJVSUxEICYmIEJVSUxELmFwcGx5KHRoaXMsIHNraXBUcmFpdHMgPyBwYXJhbXMgOiBhcmd1bWVudHMpIHx8IChza2lwVHJhaXRzID8gcGFyYW1zWzBdIDogc2tpcFRyYWl0c0FuY2hvcikgfHwge31cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBlaXRoZXIgbG9va2luZyBmb3IgdHJhaXRzIGluIF9fZXh0ZW5kX18gKG1ldGEtY2xhc3MpIG9yIGluIHVzdWFsIHByb3BzICh1c3VhbCBjbGFzcylcbiAgICAgICAgICAgIHZhciBleHRlbmQgID0gcHJvcHMuX19leHRlbmRfXyB8fCBwcm9wc1xuICAgICAgICAgICAgXG4gICAgICAgICAgICB2YXIgdHJhaXRzID0gZXh0ZW5kLnRyYWl0IHx8IGV4dGVuZC50cmFpdHNcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKHRyYWl0cyB8fCBleHRlbmQuZGV0YWNoZWQpIHtcbiAgICAgICAgICAgICAgICBkZWxldGUgZXh0ZW5kLnRyYWl0XG4gICAgICAgICAgICAgICAgZGVsZXRlIGV4dGVuZC50cmFpdHNcbiAgICAgICAgICAgICAgICBkZWxldGUgZXh0ZW5kLmRldGFjaGVkXG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgaWYgKCFza2lwVHJhaXRzKSB7XG4gICAgICAgICAgICAgICAgICAgIHZhciBjbGFzc1dpdGhUcmFpdCAgPSB0aGlzTWV0YS5zdWJDbGFzcyh7IGRvZXMgOiB0cmFpdHMgfHwgW10gfSwgdGhpc01ldGEubmFtZSlcbiAgICAgICAgICAgICAgICAgICAgdmFyIG1ldGEgICAgICAgICAgICA9IGNsYXNzV2l0aFRyYWl0Lm1ldGFcbiAgICAgICAgICAgICAgICAgICAgbWV0YS5pc0RldGFjaGVkICAgICA9IHRydWVcbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBtZXRhLmluc3RhbnRpYXRlKHRoaXNNZXRhLnNraXBUcmFpdHNBbmNob3IsIGFyZ3VtZW50cylcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXNNZXRhLmluaXRJbnN0YW5jZSh0aGlzLCBwcm9wcylcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcmV0dXJuIHRoaXNNZXRhLmhhc01ldGhvZCgnaW5pdGlhbGl6ZScpICYmIHRoaXMuaW5pdGlhbGl6ZShwcm9wcykgfHwgdGhpc1xuICAgICAgICB9XG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBmaW5hbGl6ZTogZnVuY3Rpb24gKGV4dGVuZCkge1xuICAgICAgICBKb29zZS5NYW5hZ2VkLkNsYXNzLnN1cGVyQ2xhc3MuZmluYWxpemUuY2FsbCh0aGlzLCBleHRlbmQpXG4gICAgICAgIFxuICAgICAgICB0aGlzLnN0ZW0uY2xvc2UoKVxuICAgICAgICBcbiAgICAgICAgdGhpcy5hZnRlck11dGF0ZSgpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBwcm9jZXNzU3RlbSA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgSm9vc2UuTWFuYWdlZC5DbGFzcy5zdXBlckNsYXNzLnByb2Nlc3NTdGVtLmNhbGwodGhpcylcbiAgICAgICAgXG4gICAgICAgIHRoaXMuYnVpbGRlciAgICA9IG5ldyB0aGlzLmJ1aWxkZXJDbGFzcyh7IHRhcmdldE1ldGEgOiB0aGlzIH0pXG4gICAgICAgIHRoaXMuc3RlbSAgICAgICA9IG5ldyB0aGlzLnN0ZW1DbGFzcyh7IG5hbWUgOiB0aGlzLm5hbWUsIHRhcmdldE1ldGEgOiB0aGlzIH0pXG4gICAgICAgIFxuICAgICAgICB2YXIgYnVpbGRlckNsYXNzID0gdGhpcy5nZXRDbGFzc0luQXR0cmlidXRlKCdidWlsZGVyQ2xhc3MnKVxuICAgICAgICBcbiAgICAgICAgaWYgKGJ1aWxkZXJDbGFzcykge1xuICAgICAgICAgICAgdGhpcy5idWlsZGVyQ2xhc3NDcmVhdGVkID0gdHJ1ZVxuICAgICAgICAgICAgdGhpcy5hZGRBdHRyaWJ1dGUoJ2J1aWxkZXJDbGFzcycsIHRoaXMuc3ViQ2xhc3NPZihidWlsZGVyQ2xhc3MpKVxuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgdmFyIHN0ZW1DbGFzcyA9IHRoaXMuZ2V0Q2xhc3NJbkF0dHJpYnV0ZSgnc3RlbUNsYXNzJylcbiAgICAgICAgXG4gICAgICAgIGlmIChzdGVtQ2xhc3MpIHtcbiAgICAgICAgICAgIHRoaXMuc3RlbUNsYXNzQ3JlYXRlZCA9IHRydWVcbiAgICAgICAgICAgIHRoaXMuYWRkQXR0cmlidXRlKCdzdGVtQ2xhc3MnLCB0aGlzLnN1YkNsYXNzT2Yoc3RlbUNsYXNzKSlcbiAgICAgICAgfVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgZXh0ZW5kIDogZnVuY3Rpb24gKHByb3BzKSB7XG4gICAgICAgIGlmIChwcm9wcy5idWlsZGVyKSB7XG4gICAgICAgICAgICB0aGlzLmdldEJ1aWxkZXJUYXJnZXQoKS5tZXRhLmV4dGVuZChwcm9wcy5idWlsZGVyKVxuICAgICAgICAgICAgZGVsZXRlIHByb3BzLmJ1aWxkZXJcbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgaWYgKHByb3BzLnN0ZW0pIHtcbiAgICAgICAgICAgIHRoaXMuZ2V0U3RlbVRhcmdldCgpLm1ldGEuZXh0ZW5kKHByb3BzLnN0ZW0pXG4gICAgICAgICAgICBkZWxldGUgcHJvcHMuc3RlbVxuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICB0aGlzLmJ1aWxkZXIuX2V4dGVuZChwcm9wcylcbiAgICAgICAgXG4gICAgICAgIHRoaXMuZmlyc3RQYXNzID0gZmFsc2VcbiAgICAgICAgXG4gICAgICAgIGlmICghdGhpcy5zdGVtLm9wZW5lZCkgdGhpcy5hZnRlck11dGF0ZSgpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBnZXRCdWlsZGVyVGFyZ2V0IDogZnVuY3Rpb24gKCkge1xuICAgICAgICB2YXIgYnVpbGRlckNsYXNzID0gdGhpcy5nZXRDbGFzc0luQXR0cmlidXRlKCdidWlsZGVyQ2xhc3MnKVxuICAgICAgICBpZiAoIWJ1aWxkZXJDbGFzcykgdGhyb3cgXCJBdHRlbXB0IHRvIGV4dGVuZCBhIGJ1aWxkZXIgb24gbm9uLW1ldGEgY2xhc3NcIlxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIGJ1aWxkZXJDbGFzc1xuICAgIH0sXG4gICAgXG5cbiAgICBnZXRTdGVtVGFyZ2V0IDogZnVuY3Rpb24gKCkge1xuICAgICAgICB2YXIgc3RlbUNsYXNzID0gdGhpcy5nZXRDbGFzc0luQXR0cmlidXRlKCdzdGVtQ2xhc3MnKVxuICAgICAgICBpZiAoIXN0ZW1DbGFzcykgdGhyb3cgXCJBdHRlbXB0IHRvIGV4dGVuZCBhIHN0ZW0gb24gbm9uLW1ldGEgY2xhc3NcIlxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIHN0ZW1DbGFzc1xuICAgIH0sXG4gICAgXG4gICAgXG4gICAgZ2V0Q2xhc3NJbkF0dHJpYnV0ZSA6IGZ1bmN0aW9uIChhdHRyaWJ1dGVOYW1lKSB7XG4gICAgICAgIHZhciBhdHRyQ2xhc3MgPSB0aGlzLmdldEF0dHJpYnV0ZShhdHRyaWJ1dGVOYW1lKVxuICAgICAgICBpZiAoYXR0ckNsYXNzIGluc3RhbmNlb2YgSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5BdHRyaWJ1dGUpIGF0dHJDbGFzcyA9IGF0dHJDbGFzcy52YWx1ZVxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIGF0dHJDbGFzc1xuICAgIH0sXG4gICAgXG4gICAgXG4gICAgYWRkTWV0aG9kTW9kaWZpZXI6IGZ1bmN0aW9uIChuYW1lLCBmdW5jLCB0eXBlKSB7XG4gICAgICAgIHZhciBwcm9wcyA9IHt9XG4gICAgICAgIFxuICAgICAgICBwcm9wcy5pbml0ID0gZnVuY1xuICAgICAgICBwcm9wcy5tZXRhID0gdHlwZVxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIHRoaXMuc3RlbS5wcm9wZXJ0aWVzLm1ldGhvZHNNb2RpZmllcnMuYWRkUHJvcGVydHkobmFtZSwgcHJvcHMpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICByZW1vdmVNZXRob2RNb2RpZmllcjogZnVuY3Rpb24gKG5hbWUpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuc3RlbS5wcm9wZXJ0aWVzLm1ldGhvZHNNb2RpZmllcnMucmVtb3ZlUHJvcGVydHkobmFtZSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGFkZE1ldGhvZDogZnVuY3Rpb24gKG5hbWUsIGZ1bmMsIHByb3BzKSB7XG4gICAgICAgIHByb3BzID0gcHJvcHMgfHwge31cbiAgICAgICAgcHJvcHMuaW5pdCA9IGZ1bmNcbiAgICAgICAgXG4gICAgICAgIHJldHVybiB0aGlzLnN0ZW0ucHJvcGVydGllcy5tZXRob2RzLmFkZFByb3BlcnR5KG5hbWUsIHByb3BzKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgYWRkQXR0cmlidXRlOiBmdW5jdGlvbiAobmFtZSwgaW5pdCwgcHJvcHMpIHtcbiAgICAgICAgcHJvcHMgPSBwcm9wcyB8fCB7fVxuICAgICAgICBwcm9wcy5pbml0ID0gaW5pdFxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIHRoaXMuc3RlbS5wcm9wZXJ0aWVzLmF0dHJpYnV0ZXMuYWRkUHJvcGVydHkobmFtZSwgcHJvcHMpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICByZW1vdmVNZXRob2QgOiBmdW5jdGlvbiAobmFtZSkge1xuICAgICAgICByZXR1cm4gdGhpcy5zdGVtLnByb3BlcnRpZXMubWV0aG9kcy5yZW1vdmVQcm9wZXJ0eShuYW1lKVxuICAgIH0sXG5cbiAgICBcbiAgICByZW1vdmVBdHRyaWJ1dGU6IGZ1bmN0aW9uIChuYW1lKSB7XG4gICAgICAgIHJldHVybiB0aGlzLnN0ZW0ucHJvcGVydGllcy5hdHRyaWJ1dGVzLnJlbW92ZVByb3BlcnR5KG5hbWUpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBoYXNNZXRob2Q6IGZ1bmN0aW9uIChuYW1lKSB7XG4gICAgICAgIHJldHVybiB0aGlzLnN0ZW0ucHJvcGVydGllcy5tZXRob2RzLmhhdmVQcm9wZXJ0eShuYW1lKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgaGFzQXR0cmlidXRlOiBmdW5jdGlvbiAobmFtZSkgeyBcbiAgICAgICAgcmV0dXJuIHRoaXMuc3RlbS5wcm9wZXJ0aWVzLmF0dHJpYnV0ZXMuaGF2ZVByb3BlcnR5KG5hbWUpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBoYXNNZXRob2RNb2RpZmllcnNGb3IgOiBmdW5jdGlvbiAobmFtZSkge1xuICAgICAgICByZXR1cm4gdGhpcy5zdGVtLnByb3BlcnRpZXMubWV0aG9kc01vZGlmaWVycy5oYXZlUHJvcGVydHkobmFtZSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGhhc093bk1ldGhvZDogZnVuY3Rpb24gKG5hbWUpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuc3RlbS5wcm9wZXJ0aWVzLm1ldGhvZHMuaGF2ZU93blByb3BlcnR5KG5hbWUpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBoYXNPd25BdHRyaWJ1dGU6IGZ1bmN0aW9uIChuYW1lKSB7IFxuICAgICAgICByZXR1cm4gdGhpcy5zdGVtLnByb3BlcnRpZXMuYXR0cmlidXRlcy5oYXZlT3duUHJvcGVydHkobmFtZSlcbiAgICB9LFxuICAgIFxuXG4gICAgZ2V0TWV0aG9kIDogZnVuY3Rpb24gKG5hbWUpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuc3RlbS5wcm9wZXJ0aWVzLm1ldGhvZHMuZ2V0UHJvcGVydHkobmFtZSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGdldEF0dHJpYnV0ZSA6IGZ1bmN0aW9uIChuYW1lKSB7XG4gICAgICAgIHJldHVybiB0aGlzLnN0ZW0ucHJvcGVydGllcy5hdHRyaWJ1dGVzLmdldFByb3BlcnR5KG5hbWUpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBlYWNoUm9sZSA6IGZ1bmN0aW9uIChyb2xlcywgZnVuYywgc2NvcGUpIHtcbiAgICAgICAgSm9vc2UuQS5lYWNoKHJvbGVzLCBmdW5jdGlvbiAoYXJnLCBpbmRleCkge1xuICAgICAgICAgICAgdmFyIHJvbGUgPSAoYXJnLm1ldGEgaW5zdGFuY2VvZiBKb29zZS5NYW5hZ2VkLkNsYXNzKSA/IGFyZyA6IGFyZy5yb2xlXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGZ1bmMuY2FsbChzY29wZSB8fCB0aGlzLCBhcmcsIHJvbGUsIGluZGV4KVxuICAgICAgICB9LCB0aGlzKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgYWRkUm9sZSA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgXG4gICAgICAgIHRoaXMuZWFjaFJvbGUoYXJndW1lbnRzLCBmdW5jdGlvbiAoYXJnLCByb2xlKSB7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXMuYmVmb3JlUm9sZUFkZChyb2xlKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB2YXIgZGVzYyA9IGFyZ1xuICAgICAgICAgICAgXG4gICAgICAgICAgICAvL2NvbXBvc2UgZGVzY3JpcHRvciBjYW4gY29udGFpbiAnYWxpYXMnIGFuZCAnZXhjbHVkZScgZmllbGRzLCBpbiB0aGlzIGNhc2UgYWN0dWFsIHJlZmVyZW5jZSBzaG91bGQgYmUgc3RvcmVkXG4gICAgICAgICAgICAvL2ludG8gJ3Byb3BlcnR5U2V0JyBmaWVsZFxuICAgICAgICAgICAgaWYgKHJvbGUgIT0gYXJnKSB7XG4gICAgICAgICAgICAgICAgZGVzYy5wcm9wZXJ0eVNldCA9IHJvbGUubWV0YS5zdGVtXG4gICAgICAgICAgICAgICAgZGVsZXRlIGRlc2Mucm9sZVxuICAgICAgICAgICAgfSBlbHNlXG4gICAgICAgICAgICAgICAgZGVzYyA9IGRlc2MubWV0YS5zdGVtXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXMuc3RlbS5hZGRDb21wb3NlSW5mbyhkZXNjKVxuICAgICAgICAgICAgXG4gICAgICAgIH0sIHRoaXMpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBiZWZvcmVSb2xlQWRkIDogZnVuY3Rpb24gKHJvbGUpIHtcbiAgICAgICAgdmFyIHJvbGVNZXRhID0gcm9sZS5tZXRhXG4gICAgICAgIFxuICAgICAgICBpZiAocm9sZU1ldGEuYnVpbGRlckNsYXNzQ3JlYXRlZCkgdGhpcy5nZXRCdWlsZGVyVGFyZ2V0KCkubWV0YS5leHRlbmQoe1xuICAgICAgICAgICAgZG9lcyA6IFsgcm9sZU1ldGEuZ2V0QnVpbGRlclRhcmdldCgpIF1cbiAgICAgICAgfSlcbiAgICAgICAgXG4gICAgICAgIGlmIChyb2xlTWV0YS5zdGVtQ2xhc3NDcmVhdGVkKSB0aGlzLmdldFN0ZW1UYXJnZXQoKS5tZXRhLmV4dGVuZCh7XG4gICAgICAgICAgICBkb2VzIDogWyByb2xlTWV0YS5nZXRTdGVtVGFyZ2V0KCkgXVxuICAgICAgICB9KVxuICAgICAgICBcbiAgICAgICAgaWYgKHJvbGVNZXRhLm1ldGEuaXNEZXRhY2hlZCAmJiAhdGhpcy5maXJzdFBhc3MpIHRoaXMuYnVpbGRlci50cmFpdHModGhpcywgcm9sZU1ldGEuY29uc3RydWN0b3IpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBiZWZvcmVSb2xlUmVtb3ZlIDogZnVuY3Rpb24gKHJvbGUpIHtcbiAgICAgICAgdmFyIHJvbGVNZXRhID0gcm9sZS5tZXRhXG4gICAgICAgIFxuICAgICAgICBpZiAocm9sZU1ldGEuYnVpbGRlckNsYXNzQ3JlYXRlZCkgdGhpcy5nZXRCdWlsZGVyVGFyZ2V0KCkubWV0YS5leHRlbmQoe1xuICAgICAgICAgICAgZG9lc250IDogWyByb2xlTWV0YS5nZXRCdWlsZGVyVGFyZ2V0KCkgXVxuICAgICAgICB9KVxuICAgICAgICBcbiAgICAgICAgaWYgKHJvbGVNZXRhLnN0ZW1DbGFzc0NyZWF0ZWQpIHRoaXMuZ2V0U3RlbVRhcmdldCgpLm1ldGEuZXh0ZW5kKHtcbiAgICAgICAgICAgIGRvZXNudCA6IFsgcm9sZU1ldGEuZ2V0U3RlbVRhcmdldCgpIF1cbiAgICAgICAgfSlcbiAgICAgICAgXG4gICAgICAgIGlmIChyb2xlTWV0YS5tZXRhLmlzRGV0YWNoZWQgJiYgIXRoaXMuZmlyc3RQYXNzKSB0aGlzLmJ1aWxkZXIucmVtb3ZlVHJhaXRzKHRoaXMsIHJvbGVNZXRhLmNvbnN0cnVjdG9yKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgcmVtb3ZlUm9sZSA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgdGhpcy5lYWNoUm9sZShhcmd1bWVudHMsIGZ1bmN0aW9uIChhcmcsIHJvbGUpIHtcbiAgICAgICAgICAgIHRoaXMuYmVmb3JlUm9sZVJlbW92ZShyb2xlKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLnN0ZW0ucmVtb3ZlQ29tcG9zZUluZm8ocm9sZS5tZXRhLnN0ZW0pXG4gICAgICAgIH0sIHRoaXMpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBnZXRSb2xlcyA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgXG4gICAgICAgIHJldHVybiBKb29zZS5BLm1hcCh0aGlzLnN0ZW0uY29tcG9zZWRGcm9tLCBmdW5jdGlvbiAoY29tcG9zZURlc2MpIHtcbiAgICAgICAgICAgIC8vY29tcG9zZSBkZXNjcmlwdG9yIGNhbiBjb250YWluICdhbGlhcycgYW5kICdleGNsdWRlJyBmaWVsZHMsIGluIHRoaXMgY2FzZSBhY3R1YWwgcmVmZXJlbmNlIGlzIHN0b3JlZFxuICAgICAgICAgICAgLy9pbnRvICdwcm9wZXJ0eVNldCcgZmllbGRcbiAgICAgICAgICAgIGlmICghKGNvbXBvc2VEZXNjIGluc3RhbmNlb2YgSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eVNldCkpIHJldHVybiBjb21wb3NlRGVzYy5wcm9wZXJ0eVNldFxuICAgICAgICAgICAgXG4gICAgICAgICAgICByZXR1cm4gY29tcG9zZURlc2MudGFyZ2V0TWV0YS5jXG4gICAgICAgIH0pXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBkb2VzIDogZnVuY3Rpb24gKHJvbGUpIHtcbiAgICAgICAgdmFyIG15Um9sZXMgPSB0aGlzLmdldFJvbGVzKClcbiAgICAgICAgXG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgbXlSb2xlcy5sZW5ndGg7IGkrKykgaWYgKHJvbGUgPT0gbXlSb2xlc1tpXSkgcmV0dXJuIHRydWVcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBteVJvbGVzLmxlbmd0aDsgaSsrKSBpZiAobXlSb2xlc1tpXS5tZXRhLmRvZXMocm9sZSkpIHJldHVybiB0cnVlXG4gICAgICAgIFxuICAgICAgICB2YXIgc3VwZXJNZXRhID0gdGhpcy5zdXBlckNsYXNzLm1ldGFcbiAgICAgICAgXG4gICAgICAgIC8vIGNvbnNpZGVyaW5nIHRoZSBjYXNlIG9mIGluaGVyaXRpbmcgZnJvbSBub24tSm9vc2UgY2xhc3Nlc1xuICAgICAgICBpZiAodGhpcy5zdXBlckNsYXNzICE9IEpvb3NlLlByb3RvLkVtcHR5ICYmIHN1cGVyTWV0YSAmJiBzdXBlck1ldGEubWV0YSAmJiBzdXBlck1ldGEubWV0YS5oYXNNZXRob2QoJ2RvZXMnKSkgcmV0dXJuIHN1cGVyTWV0YS5kb2VzKHJvbGUpXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gZmFsc2VcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGdldE1ldGhvZHMgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHJldHVybiB0aGlzLnN0ZW0ucHJvcGVydGllcy5tZXRob2RzXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBnZXRBdHRyaWJ1dGVzIDogZnVuY3Rpb24gKCkge1xuICAgICAgICByZXR1cm4gdGhpcy5zdGVtLnByb3BlcnRpZXMuYXR0cmlidXRlc1xuICAgIH0sXG4gICAgXG4gICAgXG4gICAgYWZ0ZXJNdXRhdGUgOiBmdW5jdGlvbiAoKSB7XG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBnZXRDdXJyZW50TWV0aG9kIDogZnVuY3Rpb24gKCkge1xuICAgICAgICBmb3IgKHZhciB3cmFwcGVyID0gYXJndW1lbnRzLmNhbGxlZS5jYWxsZXIsIGNvdW50ID0gMDsgd3JhcHBlciAmJiBjb3VudCA8IDU7IHdyYXBwZXIgPSB3cmFwcGVyLmNhbGxlciwgY291bnQrKylcbiAgICAgICAgICAgIGlmICh3cmFwcGVyLl9fTUVUSE9EX18pIHJldHVybiB3cmFwcGVyLl9fTUVUSE9EX19cbiAgICAgICAgXG4gICAgICAgIHJldHVybiBudWxsXG4gICAgfVxuICAgIFxuICAgIFxufSkuYztcbkpvb3NlLk1hbmFnZWQuUm9sZSA9IG5ldyBKb29zZS5NYW5hZ2VkLkNsYXNzKCdKb29zZS5NYW5hZ2VkLlJvbGUnLCB7XG4gICAgXG4gICAgaXNhICAgICAgICAgICAgICAgICAgICAgICAgIDogSm9vc2UuTWFuYWdlZC5DbGFzcyxcbiAgICBcbiAgICBoYXZlIDoge1xuICAgICAgICBkZWZhdWx0U3VwZXJDbGFzcyAgICAgICA6IEpvb3NlLlByb3RvLkVtcHR5LFxuICAgICAgICBcbiAgICAgICAgYnVpbGRlclJvbGUgICAgICAgICAgICAgOiBudWxsLFxuICAgICAgICBzdGVtUm9sZSAgICAgICAgICAgICAgICA6IG51bGxcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIG1ldGhvZHMgOiB7XG4gICAgICAgIFxuICAgICAgICBkZWZhdWx0Q29uc3RydWN0b3IgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICByZXR1cm4gZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcIlJvbGVzIGNhbnQgYmUgaW5zdGFudGlhdGVkXCIpXG4gICAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIFxuXG4gICAgICAgIHByb2Nlc3NTdXBlckNsYXNzIDogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgaWYgKHRoaXMuc3VwZXJDbGFzcyAhPSB0aGlzLmRlZmF1bHRTdXBlckNsYXNzKSB0aHJvdyBuZXcgRXJyb3IoXCJSb2xlcyBjYW4ndCBpbmhlcml0IGZyb20gYW55dGhpbmdcIilcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBnZXRCdWlsZGVyVGFyZ2V0IDogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgaWYgKCF0aGlzLmJ1aWxkZXJSb2xlKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5idWlsZGVyUm9sZSA9IG5ldyB0aGlzLmNvbnN0cnVjdG9yKCkuY1xuICAgICAgICAgICAgICAgIHRoaXMuYnVpbGRlckNsYXNzQ3JlYXRlZCA9IHRydWVcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcmV0dXJuIHRoaXMuYnVpbGRlclJvbGVcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgXG4gICAgICAgIGdldFN0ZW1UYXJnZXQgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBpZiAoIXRoaXMuc3RlbVJvbGUpIHtcbiAgICAgICAgICAgICAgICB0aGlzLnN0ZW1Sb2xlID0gbmV3IHRoaXMuY29uc3RydWN0b3IoKS5jXG4gICAgICAgICAgICAgICAgdGhpcy5zdGVtQ2xhc3NDcmVhdGVkID0gdHJ1ZVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5zdGVtUm9sZVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICBcbiAgICAgICAgYWRkUmVxdWlyZW1lbnQgOiBmdW5jdGlvbiAobWV0aG9kTmFtZSkge1xuICAgICAgICAgICAgdGhpcy5zdGVtLnByb3BlcnRpZXMucmVxdWlyZW1lbnRzLmFkZFByb3BlcnR5KG1ldGhvZE5hbWUsIHt9KVxuICAgICAgICB9XG4gICAgICAgIFxuICAgIH0sXG4gICAgXG5cbiAgICBzdGVtIDoge1xuICAgICAgICBtZXRob2RzIDoge1xuICAgICAgICAgICAgXG4gICAgICAgICAgICBhcHBseSA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdW5hcHBseSA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgYnVpbGRlciA6IHtcbiAgICAgICAgbWV0aG9kcyA6IHtcbiAgICAgICAgICAgIHJlcXVpcmVzIDogZnVuY3Rpb24gKHRhcmdldENsYXNzTWV0YSwgaW5mbykge1xuICAgICAgICAgICAgICAgIEpvb3NlLkEuZWFjaChKb29zZS5PLndhbnRBcnJheShpbmZvKSwgZnVuY3Rpb24gKG1ldGhvZE5hbWUpIHtcbiAgICAgICAgICAgICAgICAgICAgdGFyZ2V0Q2xhc3NNZXRhLmFkZFJlcXVpcmVtZW50KG1ldGhvZE5hbWUpXG4gICAgICAgICAgICAgICAgfSwgdGhpcylcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cbiAgICBcbn0pLmM7XG5Kb29zZS5NYW5hZ2VkLkF0dHJpYnV0ZSA9IG5ldyBKb29zZS5NYW5hZ2VkLkNsYXNzKCdKb29zZS5NYW5hZ2VkLkF0dHJpYnV0ZScsIHtcbiAgICBcbiAgICBpc2EgOiBKb29zZS5NYW5hZ2VkLlByb3BlcnR5LkF0dHJpYnV0ZSxcbiAgICBcbiAgICBoYXZlIDoge1xuICAgICAgICBpcyAgICAgICAgICAgICAgOiBudWxsLFxuICAgICAgICBcbiAgICAgICAgYnVpbGRlciAgICAgICAgIDogbnVsbCxcbiAgICAgICAgXG4gICAgICAgIGlzUHJpdmF0ZSAgICAgICA6IGZhbHNlLFxuICAgICAgICBcbiAgICAgICAgcm9sZSAgICAgICAgICAgIDogbnVsbCxcbiAgICAgICAgXG4gICAgICAgIHB1YmxpY05hbWUgICAgICA6IG51bGwsXG4gICAgICAgIHNldHRlck5hbWUgICAgICA6IG51bGwsXG4gICAgICAgIGdldHRlck5hbWUgICAgICA6IG51bGwsXG4gICAgICAgIFxuICAgICAgICAvL2luZGljYXRlcyB0aGUgbG9naWNhbCByZWFkYWJsZW5lc3Mvd3JpdGVhYmxlbmVzcyBvZiB0aGUgYXR0cmlidXRlXG4gICAgICAgIHJlYWRhYmxlICAgICAgICA6IGZhbHNlLFxuICAgICAgICB3cml0ZWFibGUgICAgICAgOiBmYWxzZSxcbiAgICAgICAgXG4gICAgICAgIC8vaW5kaWNhdGVzIHRoZSBwaHlzaWNhbCBwcmVzZW5zZSBvZiB0aGUgYWNjZXNzb3IgKG1heSBiZSBhYnNlbnQgZm9yIFwiY29tYmluZWRcIiBhY2Nlc3NvcnMgZm9yIGV4YW1wbGUpXG4gICAgICAgIGhhc0dldHRlciAgICAgICA6IGZhbHNlLFxuICAgICAgICBoYXNTZXR0ZXIgICAgICAgOiBmYWxzZSxcbiAgICAgICAgXG4gICAgICAgIHJlcXVpcmVkICAgICAgICA6IGZhbHNlLFxuICAgICAgICBcbiAgICAgICAgY2FuSW5saW5lU2V0UmF3IDogdHJ1ZSxcbiAgICAgICAgY2FuSW5saW5lR2V0UmF3IDogdHJ1ZVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgYWZ0ZXIgOiB7XG4gICAgICAgIGluaXRpYWxpemUgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB2YXIgbmFtZSA9IHRoaXMubmFtZVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLnB1YmxpY05hbWUgPSBuYW1lLnJlcGxhY2UoL15fKy8sICcnKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLnNsb3QgPSB0aGlzLmlzUHJpdmF0ZSA/ICckJCcgKyBuYW1lIDogbmFtZVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLnNldHRlck5hbWUgPSB0aGlzLnNldHRlck5hbWUgfHwgdGhpcy5nZXRTZXR0ZXJOYW1lKClcbiAgICAgICAgICAgIHRoaXMuZ2V0dGVyTmFtZSA9IHRoaXMuZ2V0dGVyTmFtZSB8fCB0aGlzLmdldEdldHRlck5hbWUoKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLnJlYWRhYmxlICA9IHRoaXMuaGFzR2V0dGVyID0gL15yL2kudGVzdCh0aGlzLmlzKVxuICAgICAgICAgICAgdGhpcy53cml0ZWFibGUgPSB0aGlzLmhhc1NldHRlciA9IC9eLncvaS50ZXN0KHRoaXMuaXMpXG4gICAgICAgIH1cbiAgICB9LFxuICAgIFxuICAgIFxuICAgIG92ZXJyaWRlIDoge1xuICAgICAgICBcbiAgICAgICAgY29tcHV0ZVZhbHVlIDogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgdmFyIGluaXQgICAgPSB0aGlzLmluaXRcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKEpvb3NlLk8uaXNDbGFzcyhpbml0KSB8fCAhSm9vc2UuTy5pc0Z1bmN0aW9uKGluaXQpKSB0aGlzLlNVUEVSKClcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBwcmVBcHBseSA6IGZ1bmN0aW9uICh0YXJnZXRDbGFzcykge1xuICAgICAgICAgICAgdGFyZ2V0Q2xhc3MubWV0YS5leHRlbmQoe1xuICAgICAgICAgICAgICAgIG1ldGhvZHMgOiB0aGlzLmdldEFjY2Vzc29yc0Zvcih0YXJnZXRDbGFzcylcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgcG9zdFVuQXBwbHkgOiBmdW5jdGlvbiAoZnJvbSkge1xuICAgICAgICAgICAgZnJvbS5tZXRhLmV4dGVuZCh7XG4gICAgICAgICAgICAgICAgcmVtb3ZlTWV0aG9kcyA6IHRoaXMuZ2V0QWNjZXNzb3JzRnJvbShmcm9tKVxuICAgICAgICAgICAgfSlcbiAgICAgICAgfVxuICAgICAgICBcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIG1ldGhvZHMgOiB7XG4gICAgICAgIFxuICAgICAgICBnZXRBY2Nlc3NvcnNGb3IgOiBmdW5jdGlvbiAodGFyZ2V0Q2xhc3MpIHtcbiAgICAgICAgICAgIHZhciB0YXJnZXRNZXRhID0gdGFyZ2V0Q2xhc3MubWV0YVxuICAgICAgICAgICAgdmFyIHNldHRlck5hbWUgPSB0aGlzLnNldHRlck5hbWVcbiAgICAgICAgICAgIHZhciBnZXR0ZXJOYW1lID0gdGhpcy5nZXR0ZXJOYW1lXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciBtZXRob2RzID0ge31cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKHRoaXMuaGFzU2V0dGVyICYmICF0YXJnZXRNZXRhLmhhc01ldGhvZChzZXR0ZXJOYW1lKSkge1xuICAgICAgICAgICAgICAgIG1ldGhvZHNbc2V0dGVyTmFtZV0gPSB0aGlzLmdldFNldHRlcigpXG4gICAgICAgICAgICAgICAgbWV0aG9kc1tzZXR0ZXJOYW1lXS5BQ0NFU1NPUl9GUk9NID0gdGhpc1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAodGhpcy5oYXNHZXR0ZXIgJiYgIXRhcmdldE1ldGEuaGFzTWV0aG9kKGdldHRlck5hbWUpKSB7XG4gICAgICAgICAgICAgICAgbWV0aG9kc1tnZXR0ZXJOYW1lXSA9IHRoaXMuZ2V0R2V0dGVyKClcbiAgICAgICAgICAgICAgICBtZXRob2RzW2dldHRlck5hbWVdLkFDQ0VTU09SX0ZST00gPSB0aGlzXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHJldHVybiBtZXRob2RzXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgZ2V0QWNjZXNzb3JzRnJvbSA6IGZ1bmN0aW9uIChmcm9tKSB7XG4gICAgICAgICAgICB2YXIgdGFyZ2V0TWV0YSA9IGZyb20ubWV0YVxuICAgICAgICAgICAgdmFyIHNldHRlck5hbWUgPSB0aGlzLnNldHRlck5hbWVcbiAgICAgICAgICAgIHZhciBnZXR0ZXJOYW1lID0gdGhpcy5nZXR0ZXJOYW1lXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciBzZXR0ZXIgPSB0aGlzLmhhc1NldHRlciAmJiB0YXJnZXRNZXRhLmdldE1ldGhvZChzZXR0ZXJOYW1lKVxuICAgICAgICAgICAgdmFyIGdldHRlciA9IHRoaXMuaGFzR2V0dGVyICYmIHRhcmdldE1ldGEuZ2V0TWV0aG9kKGdldHRlck5hbWUpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciByZW1vdmVNZXRob2RzID0gW11cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKHNldHRlciAmJiBzZXR0ZXIudmFsdWUuQUNDRVNTT1JfRlJPTSA9PSB0aGlzKSByZW1vdmVNZXRob2RzLnB1c2goc2V0dGVyTmFtZSlcbiAgICAgICAgICAgIGlmIChnZXR0ZXIgJiYgZ2V0dGVyLnZhbHVlLkFDQ0VTU09SX0ZST00gPT0gdGhpcykgcmVtb3ZlTWV0aG9kcy5wdXNoKGdldHRlck5hbWUpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHJldHVybiByZW1vdmVNZXRob2RzXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgZ2V0R2V0dGVyTmFtZSA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHJldHVybiAnZ2V0JyArIEpvb3NlLlMudXBwZXJjYXNlRmlyc3QodGhpcy5wdWJsaWNOYW1lKVxuICAgICAgICB9LFxuXG5cbiAgICAgICAgZ2V0U2V0dGVyTmFtZSA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHJldHVybiAnc2V0JyArIEpvb3NlLlMudXBwZXJjYXNlRmlyc3QodGhpcy5wdWJsaWNOYW1lKVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIGdldFNldHRlciA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHZhciBtZSAgICAgID0gdGhpc1xuICAgICAgICAgICAgdmFyIHNsb3QgICAgPSBtZS5zbG90XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmIChtZS5jYW5JbmxpbmVTZXRSYXcpXG4gICAgICAgICAgICAgICAgcmV0dXJuIGZ1bmN0aW9uICh2YWx1ZSkge1xuICAgICAgICAgICAgICAgICAgICB0aGlzWyBzbG90IF0gPSB2YWx1ZVxuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRoaXNcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICBlbHNlXG4gICAgICAgICAgICAgICAgcmV0dXJuIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIG1lLnNldFJhd1ZhbHVlVG8uYXBwbHkodGhpcywgYXJndW1lbnRzKVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBnZXRHZXR0ZXIgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB2YXIgbWUgICAgICA9IHRoaXNcbiAgICAgICAgICAgIHZhciBzbG90ICAgID0gbWUuc2xvdFxuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAobWUuY2FuSW5saW5lR2V0UmF3KVxuICAgICAgICAgICAgICAgIHJldHVybiBmdW5jdGlvbiAodmFsdWUpIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRoaXNbIHNsb3QgXVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGVsc2VcbiAgICAgICAgICAgICAgICByZXR1cm4gZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gbWUuZ2V0UmF3VmFsdWVGcm9tLmFwcGx5KHRoaXMsIGFyZ3VtZW50cylcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgZ2V0VmFsdWVGcm9tIDogZnVuY3Rpb24gKGluc3RhbmNlKSB7XG4gICAgICAgICAgICB2YXIgZ2V0dGVyTmFtZSAgICAgID0gdGhpcy5nZXR0ZXJOYW1lXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmICh0aGlzLnJlYWRhYmxlICYmIGluc3RhbmNlLm1ldGEuaGFzTWV0aG9kKGdldHRlck5hbWUpKSByZXR1cm4gaW5zdGFuY2VbIGdldHRlck5hbWUgXSgpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHJldHVybiB0aGlzLmdldFJhd1ZhbHVlRnJvbShpbnN0YW5jZSlcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBzZXRWYWx1ZVRvIDogZnVuY3Rpb24gKGluc3RhbmNlLCB2YWx1ZSkge1xuICAgICAgICAgICAgdmFyIHNldHRlck5hbWUgICAgICA9IHRoaXMuc2V0dGVyTmFtZVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAodGhpcy53cml0ZWFibGUgJiYgaW5zdGFuY2UubWV0YS5oYXNNZXRob2Qoc2V0dGVyTmFtZSkpIFxuICAgICAgICAgICAgICAgIGluc3RhbmNlWyBzZXR0ZXJOYW1lIF0odmFsdWUpXG4gICAgICAgICAgICBlbHNlXG4gICAgICAgICAgICAgICAgdGhpcy5zZXRSYXdWYWx1ZVRvKGluc3RhbmNlLCB2YWx1ZSlcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBpbml0RnJvbUNvbmZpZyA6IGZ1bmN0aW9uIChpbnN0YW5jZSwgY29uZmlnKSB7XG4gICAgICAgICAgICB2YXIgbmFtZSAgICAgICAgICAgID0gdGhpcy5uYW1lXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciB2YWx1ZSwgaXNTZXQgPSBmYWxzZVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAoY29uZmlnLmhhc093blByb3BlcnR5KG5hbWUpKSB7XG4gICAgICAgICAgICAgICAgdmFsdWUgPSBjb25maWdbbmFtZV1cbiAgICAgICAgICAgICAgICBpc1NldCA9IHRydWVcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgdmFyIGluaXQgICAgPSB0aGlzLmluaXRcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAvLyBzaW1wbGUgZnVuY3Rpb24gKG5vdCBjbGFzcykgaGFzIGJlZW4gdXNlZCBhcyBcImluaXRcIiB2YWx1ZVxuICAgICAgICAgICAgICAgIGlmIChKb29zZS5PLmlzRnVuY3Rpb24oaW5pdCkgJiYgIUpvb3NlLk8uaXNDbGFzcyhpbml0KSkge1xuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgdmFsdWUgPSBpbml0LmNhbGwoaW5zdGFuY2UsIGNvbmZpZywgbmFtZSlcbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIGlzU2V0ID0gdHJ1ZVxuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKHRoaXMuYnVpbGRlcikge1xuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgdmFsdWUgPSBpbnN0YW5jZVsgdGhpcy5idWlsZGVyLnJlcGxhY2UoL150aGlzXFwuLywgJycpIF0oY29uZmlnLCBuYW1lKVxuICAgICAgICAgICAgICAgICAgICBpc1NldCA9IHRydWVcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmIChpc1NldClcbiAgICAgICAgICAgICAgICB0aGlzLnNldFJhd1ZhbHVlVG8oaW5zdGFuY2UsIHZhbHVlKVxuICAgICAgICAgICAgZWxzZSBcbiAgICAgICAgICAgICAgICBpZiAodGhpcy5yZXF1aXJlZCkgdGhyb3cgbmV3IEVycm9yKFwiUmVxdWlyZWQgYXR0cmlidXRlIFtcIiArIG5hbWUgKyBcIl0gaXMgbWlzc2VkIGR1cmluZyBpbml0aWFsaXphdGlvbiBvZiBcIiArIGluc3RhbmNlKVxuICAgICAgICB9XG4gICAgfVxuXG59KS5jXG47XG5Kb29zZS5NYW5hZ2VkLkF0dHJpYnV0ZS5CdWlsZGVyID0gbmV3IEpvb3NlLk1hbmFnZWQuUm9sZSgnSm9vc2UuTWFuYWdlZC5BdHRyaWJ1dGUuQnVpbGRlcicsIHtcbiAgICBcbiAgICBcbiAgICBoYXZlIDoge1xuICAgICAgICBkZWZhdWx0QXR0cmlidXRlQ2xhc3MgOiBKb29zZS5NYW5hZ2VkLkF0dHJpYnV0ZVxuICAgIH0sXG4gICAgXG4gICAgYnVpbGRlciA6IHtcbiAgICAgICAgXG4gICAgICAgIG1ldGhvZHMgOiB7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGhhcyA6IGZ1bmN0aW9uICh0YXJnZXRDbGFzc01ldGEsIGluZm8pIHtcbiAgICAgICAgICAgICAgICBKb29zZS5PLmVhY2hPd24oaW5mbywgZnVuY3Rpb24gKHByb3BzLCBuYW1lKSB7XG4gICAgICAgICAgICAgICAgICAgIGlmICh0eXBlb2YgcHJvcHMgIT0gJ29iamVjdCcgfHwgcHJvcHMgPT0gbnVsbCB8fCBwcm9wcy5jb25zdHJ1Y3RvciA9PSAvIC8uY29uc3RydWN0b3IpIHByb3BzID0geyBpbml0IDogcHJvcHMgfVxuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgcHJvcHMubWV0YSA9IHByb3BzLm1ldGEgfHwgdGFyZ2V0Q2xhc3NNZXRhLmRlZmF1bHRBdHRyaWJ1dGVDbGFzc1xuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgaWYgKC9eX18vLnRlc3QobmFtZSkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIG5hbWUgPSBuYW1lLnJlcGxhY2UoL15fKy8sICcnKVxuICAgICAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgICAgICBwcm9wcy5pc1ByaXZhdGUgPSB0cnVlXG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIHRhcmdldENsYXNzTWV0YS5hZGRBdHRyaWJ1dGUobmFtZSwgcHJvcHMuaW5pdCwgcHJvcHMpXG4gICAgICAgICAgICAgICAgfSwgdGhpcylcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaGFzbm90IDogZnVuY3Rpb24gKHRhcmdldENsYXNzTWV0YSwgaW5mbykge1xuICAgICAgICAgICAgICAgIHRoaXMuaGF2ZW5vdCh0YXJnZXRDbGFzc01ldGEsIGluZm8pXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGhhc250IDogZnVuY3Rpb24gKHRhcmdldENsYXNzTWV0YSwgaW5mbykge1xuICAgICAgICAgICAgICAgIHRoaXMuaGFzbm90KHRhcmdldENsYXNzTWV0YSwgaW5mbylcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICAgICAgXG4gICAgfVxuICAgIFxufSkuY1xuO1xuSm9vc2UuTWFuYWdlZC5NeSA9IG5ldyBKb29zZS5NYW5hZ2VkLlJvbGUoJ0pvb3NlLk1hbmFnZWQuTXknLCB7XG4gICAgXG4gICAgaGF2ZSA6IHtcbiAgICAgICAgbXlDbGFzcyAgICAgICAgICAgICAgICAgICAgICAgICA6IG51bGwsXG4gICAgICAgIFxuICAgICAgICBuZWVkVG9SZUFsaWFzICAgICAgICAgICAgICAgICAgIDogZmFsc2VcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIG1ldGhvZHMgOiB7XG4gICAgICAgIGNyZWF0ZU15IDogZnVuY3Rpb24gKGV4dGVuZCkge1xuICAgICAgICAgICAgdmFyIHRoaXNNZXRhID0gdGhpcy5tZXRhXG4gICAgICAgICAgICB2YXIgaXNSb2xlID0gdGhpcyBpbnN0YW5jZW9mIEpvb3NlLk1hbmFnZWQuUm9sZVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB2YXIgbXlFeHRlbmQgPSBleHRlbmQubXkgfHwge31cbiAgICAgICAgICAgIGRlbGV0ZSBleHRlbmQubXlcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gU3ltYmlvbnQgd2lsbCBnZW5lcmFsbHkgaGF2ZSB0aGUgc2FtZSBtZXRhIGNsYXNzIGFzIGl0cyBob3N0ZXIsIGV4Y2VwdGluZyB0aGUgY2FzZXMsIHdoZW4gdGhlIHN1cGVyY2xhc3MgYWxzbyBoYXZlIHRoZSBzeW1iaW9udC4gXG4gICAgICAgICAgICAvLyBJbiBzdWNoIGNhc2VzLCB0aGUgbWV0YSBjbGFzcyBmb3Igc3ltYmlvbnQgd2lsbCBiZSBpbmhlcml0ZWQgKHVubGVzcyBleHBsaWNpdGx5IHNwZWNpZmllZClcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdmFyIHN1cGVyQ2xhc3NNeSAgICA9IHRoaXMuc3VwZXJDbGFzcy5tZXRhLm15Q2xhc3NcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKCFpc1JvbGUgJiYgIW15RXh0ZW5kLmlzYSAmJiBzdXBlckNsYXNzTXkpIG15RXh0ZW5kLmlzYSA9IHN1cGVyQ2xhc3NNeVxuICAgICAgICAgICAgXG5cbiAgICAgICAgICAgIGlmICghbXlFeHRlbmQubWV0YSAmJiAhbXlFeHRlbmQuaXNhKSBteUV4dGVuZC5tZXRhID0gdGhpcy5jb25zdHJ1Y3RvclxuICAgICAgICAgICAgXG4gICAgICAgICAgICB2YXIgY3JlYXRlZENsYXNzICAgID0gdGhpcy5teUNsYXNzID0gQ2xhc3MobXlFeHRlbmQpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciBjICAgICAgICAgICAgICAgPSB0aGlzLmNcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgYy5wcm90b3R5cGUubXkgICAgICA9IGMubXkgPSBpc1JvbGUgPyBjcmVhdGVkQ2xhc3MgOiBuZXcgY3JlYXRlZENsYXNzKHsgSE9TVCA6IGMgfSlcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpcy5uZWVkVG9SZUFsaWFzID0gdHJ1ZVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIGFsaWFzU3RhdGljTWV0aG9kcyA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHRoaXMubmVlZFRvUmVBbGlhcyA9IGZhbHNlXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciBjICAgICAgICAgICA9IHRoaXMuY1xuICAgICAgICAgICAgdmFyIG15UHJvdG8gICAgID0gdGhpcy5teUNsYXNzLnByb3RvdHlwZVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBKb29zZS5PLmVhY2hPd24oYywgZnVuY3Rpb24gKHByb3BlcnR5LCBuYW1lKSB7XG4gICAgICAgICAgICAgICAgaWYgKHByb3BlcnR5LklTX0FMSUFTKSBkZWxldGUgY1sgbmFtZSBdIFxuICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpcy5teUNsYXNzLm1ldGEuc3RlbS5wcm9wZXJ0aWVzLm1ldGhvZHMuZWFjaChmdW5jdGlvbiAobWV0aG9kLCBuYW1lKSB7XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgaWYgKCFjWyBuYW1lIF0pXG4gICAgICAgICAgICAgICAgICAgIChjWyBuYW1lIF0gPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gbXlQcm90b1sgbmFtZSBdLmFwcGx5KGMubXksIGFyZ3VtZW50cylcbiAgICAgICAgICAgICAgICAgICAgfSkuSVNfQUxJQVMgPSB0cnVlXG4gICAgICAgICAgICB9KVxuICAgICAgICB9XG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBvdmVycmlkZSA6IHtcbiAgICAgICAgXG4gICAgICAgIGV4dGVuZCA6IGZ1bmN0aW9uIChwcm9wcykge1xuICAgICAgICAgICAgdmFyIG15Q2xhc3MgPSB0aGlzLm15Q2xhc3NcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKCFteUNsYXNzICYmIHRoaXMuc3VwZXJDbGFzcy5tZXRhLm15Q2xhc3MpIHRoaXMuY3JlYXRlTXkocHJvcHMpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmIChwcm9wcy5teSkge1xuICAgICAgICAgICAgICAgIGlmICghbXlDbGFzcykgXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuY3JlYXRlTXkocHJvcHMpXG4gICAgICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMubmVlZFRvUmVBbGlhcyA9IHRydWVcbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIG15Q2xhc3MubWV0YS5leHRlbmQocHJvcHMubXkpXG4gICAgICAgICAgICAgICAgICAgIGRlbGV0ZSBwcm9wcy5teVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpcy5TVVBFUihwcm9wcylcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKHRoaXMubmVlZFRvUmVBbGlhcyAmJiAhKHRoaXMgaW5zdGFuY2VvZiBKb29zZS5NYW5hZ2VkLlJvbGUpKSB0aGlzLmFsaWFzU3RhdGljTWV0aG9kcygpXG4gICAgICAgIH0gIFxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgYmVmb3JlIDoge1xuICAgICAgICBcbiAgICAgICAgYWRkUm9sZSA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHZhciBteVN0ZW1cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgSm9vc2UuQS5lYWNoKGFyZ3VtZW50cywgZnVuY3Rpb24gKGFyZykge1xuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIGlmICghYXJnKSB0aHJvdyBuZXcgRXJyb3IoXCJBdHRlbXB0IHRvIGNvbnN1bWUgYW4gdW5kZWZpbmVkIFJvbGUgaW50byBbXCIgKyB0aGlzLm5hbWUgKyBcIl1cIilcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAvL2luc3RhbmNlb2YgQ2xhc3MgdG8gYWxsb3cgdHJlYXQgY2xhc3NlcyBhcyByb2xlc1xuICAgICAgICAgICAgICAgIHZhciByb2xlID0gKGFyZy5tZXRhIGluc3RhbmNlb2YgSm9vc2UuTWFuYWdlZC5DbGFzcykgPyBhcmcgOiBhcmcucm9sZVxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIGlmIChyb2xlLm1ldGEubWV0YS5oYXNBdHRyaWJ1dGUoJ215Q2xhc3MnKSAmJiByb2xlLm1ldGEubXlDbGFzcykge1xuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgaWYgKCF0aGlzLm15Q2xhc3MpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuY3JlYXRlTXkoe1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG15IDoge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBkb2VzIDogcm9sZS5tZXRhLm15Q2xhc3NcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuXG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIG15U3RlbSA9IHRoaXMubXlDbGFzcy5tZXRhLnN0ZW1cbiAgICAgICAgICAgICAgICAgICAgaWYgKCFteVN0ZW0ub3BlbmVkKSBteVN0ZW0ub3BlbigpXG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICBteVN0ZW0uYWRkQ29tcG9zZUluZm8ocm9sZS5teS5tZXRhLnN0ZW0pXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSwgdGhpcylcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKG15U3RlbSkge1xuICAgICAgICAgICAgICAgIG15U3RlbS5jbG9zZSgpXG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgdGhpcy5uZWVkVG9SZUFsaWFzID0gdHJ1ZVxuICAgICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIHJlbW92ZVJvbGUgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBpZiAoIXRoaXMubXlDbGFzcykgcmV0dXJuXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciBteVN0ZW0gPSB0aGlzLm15Q2xhc3MubWV0YS5zdGVtXG4gICAgICAgICAgICBteVN0ZW0ub3BlbigpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIEpvb3NlLkEuZWFjaChhcmd1bWVudHMsIGZ1bmN0aW9uIChyb2xlKSB7XG4gICAgICAgICAgICAgICAgaWYgKHJvbGUubWV0YS5tZXRhLmhhc0F0dHJpYnV0ZSgnbXlDbGFzcycpICYmIHJvbGUubWV0YS5teUNsYXNzKSB7XG4gICAgICAgICAgICAgICAgICAgIG15U3RlbS5yZW1vdmVDb21wb3NlSW5mbyhyb2xlLm15Lm1ldGEuc3RlbSlcbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIHRoaXMubmVlZFRvUmVBbGlhcyA9IHRydWVcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9LCB0aGlzKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBteVN0ZW0uY2xvc2UoKVxuICAgICAgICB9XG4gICAgICAgIFxuICAgIH1cbiAgICBcbn0pLmM7XG5Kb29zZS5OYW1lc3BhY2UgPSBKb29zZS5zdHViKClcblxuSm9vc2UuTmFtZXNwYWNlLkFibGUgPSBuZXcgSm9vc2UuTWFuYWdlZC5Sb2xlKCdKb29zZS5OYW1lc3BhY2UuQWJsZScsIHtcblxuICAgIGhhdmUgOiB7XG4gICAgICAgIGJvZHlGdW5jICAgICAgICAgICAgICAgIDogbnVsbFxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgYmVmb3JlIDoge1xuICAgICAgICBleHRlbmQgOiBmdW5jdGlvbiAoZXh0ZW5kKSB7XG4gICAgICAgICAgICBpZiAoZXh0ZW5kLmJvZHkpIHtcbiAgICAgICAgICAgICAgICB0aGlzLmJvZHlGdW5jID0gZXh0ZW5kLmJvZHlcbiAgICAgICAgICAgICAgICBkZWxldGUgZXh0ZW5kLmJvZHlcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgYWZ0ZXI6IHtcbiAgICAgICAgXG4gICAgICAgIGFmdGVyTXV0YXRlIDogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgdmFyIGJvZHlGdW5jID0gdGhpcy5ib2R5RnVuY1xuICAgICAgICAgICAgZGVsZXRlIHRoaXMuYm9keUZ1bmNcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKGJvZHlGdW5jKSBKb29zZS5OYW1lc3BhY2UuTWFuYWdlci5teS5leGVjdXRlSW4odGhpcy5jLCBib2R5RnVuYylcbiAgICAgICAgfVxuICAgIH1cbiAgICBcbn0pLmM7XG5Kb29zZS5NYW5hZ2VkLkJvb3RzdHJhcCA9IG5ldyBKb29zZS5NYW5hZ2VkLlJvbGUoJ0pvb3NlLk1hbmFnZWQuQm9vdHN0cmFwJywge1xuICAgIFxuICAgIGRvZXMgICA6IFsgSm9vc2UuTmFtZXNwYWNlLkFibGUsIEpvb3NlLk1hbmFnZWQuTXksIEpvb3NlLk1hbmFnZWQuQXR0cmlidXRlLkJ1aWxkZXIgXVxuICAgIFxufSkuY1xuO1xuSm9vc2UuTWV0YSA9IEpvb3NlLnN0dWIoKVxuXG5cbkpvb3NlLk1ldGEuT2JqZWN0ID0gbmV3IEpvb3NlLlByb3RvLkNsYXNzKCdKb29zZS5NZXRhLk9iamVjdCcsIHtcbiAgICBcbiAgICBpc2EgICAgICAgICAgICAgOiBKb29zZS5Qcm90by5PYmplY3RcbiAgICBcbn0pLmNcblxuXG47XG5Kb29zZS5NZXRhLkNsYXNzID0gbmV3IEpvb3NlLk1hbmFnZWQuQ2xhc3MoJ0pvb3NlLk1ldGEuQ2xhc3MnLCB7XG4gICAgXG4gICAgaXNhICAgICAgICAgICAgICAgICAgICAgICAgIDogSm9vc2UuTWFuYWdlZC5DbGFzcyxcbiAgICBcbiAgICBkb2VzICAgICAgICAgICAgICAgICAgICAgICAgOiBKb29zZS5NYW5hZ2VkLkJvb3RzdHJhcCxcbiAgICBcbiAgICBoYXZlIDoge1xuICAgICAgICBkZWZhdWx0U3VwZXJDbGFzcyAgICAgICA6IEpvb3NlLk1ldGEuT2JqZWN0XG4gICAgfVxuICAgIFxufSkuY1xuXG47XG5Kb29zZS5NZXRhLlJvbGUgPSBuZXcgSm9vc2UuTWV0YS5DbGFzcygnSm9vc2UuTWV0YS5Sb2xlJywge1xuICAgIFxuICAgIGlzYSAgICAgICAgICAgICAgICAgICAgICAgICA6IEpvb3NlLk1hbmFnZWQuUm9sZSxcbiAgICBcbiAgICBkb2VzICAgICAgICAgICAgICAgICAgICAgICAgOiBKb29zZS5NYW5hZ2VkLkJvb3RzdHJhcFxuICAgIFxufSkuYztcbkpvb3NlLk5hbWVzcGFjZS5LZWVwZXIgPSBuZXcgSm9vc2UuTWV0YS5DbGFzcygnSm9vc2UuTmFtZXNwYWNlLktlZXBlcicsIHtcbiAgICBcbiAgICBpc2EgICAgICAgICA6IEpvb3NlLk1ldGEuQ2xhc3MsXG4gICAgXG4gICAgaGF2ZSAgICAgICAgOiB7XG4gICAgICAgIGV4dGVybmFsQ29uc3RydWN0b3IgICAgICAgICAgICAgOiBudWxsXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBtZXRob2RzOiB7XG4gICAgICAgIFxuICAgICAgICBkZWZhdWx0Q29uc3RydWN0b3I6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcmV0dXJuIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgICAvL2NvbnN0cnVjdG9ycyBzaG91bGQgYXNzdW1lIHRoYXQgbWV0YSBpcyBhdHRhY2hlZCB0byAnYXJndW1lbnRzLmNhbGxlZScgKG5vdCB0byAndGhpcycpIFxuICAgICAgICAgICAgICAgIHZhciB0aGlzTWV0YSA9IGFyZ3VtZW50cy5jYWxsZWUubWV0YVxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIGlmICh0aGlzTWV0YSBpbnN0YW5jZW9mIEpvb3NlLk5hbWVzcGFjZS5LZWVwZXIpIHRocm93IG5ldyBFcnJvcihcIk1vZHVsZSBbXCIgKyB0aGlzTWV0YS5jICsgXCJdIG1heSBub3QgYmUgaW5zdGFudGlhdGVkLiBGb3Jnb3QgdG8gJ3VzZScgdGhlIGNsYXNzIHdpdGggdGhlIHNhbWUgbmFtZT9cIilcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICB2YXIgZXh0ZXJuYWxDb25zdHJ1Y3RvciA9IHRoaXNNZXRhLmV4dGVybmFsQ29uc3RydWN0b3JcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBpZiAodHlwZW9mIGV4dGVybmFsQ29uc3RydWN0b3IgPT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgZXh0ZXJuYWxDb25zdHJ1Y3Rvci5tZXRhID0gdGhpc01ldGFcbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBleHRlcm5hbENvbnN0cnVjdG9yLmFwcGx5KHRoaXMsIGFyZ3VtZW50cylcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgdGhyb3cgXCJOYW1lc3BhY2VLZWVwZXIgb2YgW1wiICsgdGhpc01ldGEubmFtZSArIFwiXSB3YXMgcGxhbnRlZCBpbmNvcnJlY3RseS5cIlxuICAgICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIC8vd2l0aENsYXNzIHNob3VsZCBiZSBub3QgY29uc3RydWN0ZWQgeWV0IG9uIHRoaXMgc3RhZ2UgKHNlZSBKb29zZS5Qcm90by5DbGFzcy5jb25zdHJ1Y3QpXG4gICAgICAgIC8vaXQgc2hvdWxkIGJlIG9uIHRoZSAnY29uc3RydWN0b3JPbmx5JyBsaWZlIHN0YWdlIChzaG91bGQgYWxyZWFkeSBoYXZlIGNvbnN0cnVjdG9yKVxuICAgICAgICBwbGFudDogZnVuY3Rpb24gKHdpdGhDbGFzcykge1xuICAgICAgICAgICAgdmFyIGtlZXBlciA9IHRoaXMuY1xuICAgICAgICAgICAgXG4gICAgICAgICAgICBrZWVwZXIubWV0YSA9IHdpdGhDbGFzcy5tZXRhXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGtlZXBlci5tZXRhLmMgPSBrZWVwZXJcbiAgICAgICAgICAgIGtlZXBlci5tZXRhLmV4dGVybmFsQ29uc3RydWN0b3IgPSB3aXRoQ2xhc3NcbiAgICAgICAgfVxuICAgIH1cbiAgICBcbn0pLmNcblxuXG47XG5Kb29zZS5OYW1lc3BhY2UuTWFuYWdlciA9IG5ldyBKb29zZS5NYW5hZ2VkLkNsYXNzKCdKb29zZS5OYW1lc3BhY2UuTWFuYWdlcicsIHtcbiAgICBcbiAgICBoYXZlIDoge1xuICAgICAgICBjdXJyZW50ICAgICA6IG51bGxcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIG1ldGhvZHMgOiB7XG4gICAgICAgIFxuICAgICAgICBpbml0aWFsaXplIDogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgdGhpcy5jdXJyZW50ICAgID0gWyBKb29zZS50b3AgXVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIGdldEN1cnJlbnQ6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLmN1cnJlbnRbMF1cbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBleGVjdXRlSW4gOiBmdW5jdGlvbiAobnMsIGZ1bmMpIHtcbiAgICAgICAgICAgIHZhciBjdXJyZW50ID0gdGhpcy5jdXJyZW50XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGN1cnJlbnQudW5zaGlmdChucylcbiAgICAgICAgICAgIHZhciByZXMgPSBmdW5jLmNhbGwobnMsIG5zKVxuICAgICAgICAgICAgY3VycmVudC5zaGlmdCgpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHJldHVybiByZXNcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBlYXJseUNyZWF0ZSA6IGZ1bmN0aW9uIChuYW1lLCBtZXRhQ2xhc3MsIHByb3BzKSB7XG4gICAgICAgICAgICBwcm9wcy5jb25zdHJ1Y3Rvck9ubHkgPSB0cnVlXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHJldHVybiBuZXcgbWV0YUNsYXNzKG5hbWUsIHByb3BzKS5jXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgLy90aGlzIGZ1bmN0aW9uIGVzdGFibGlzaGluZyB0aGUgZnVsbCBcIm5hbWVzcGFjZSBjaGFpblwiIChpbmNsdWRpbmcgdGhlIGxhc3QgZWxlbWVudClcbiAgICAgICAgY3JlYXRlIDogZnVuY3Rpb24gKG5zTmFtZSwgbWV0YUNsYXNzLCBleHRlbmQpIHtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy9pZiBubyBuYW1lIHByb3ZpZGVkLCB0aGVuIHdlIGNyZWF0aW5nIGFuIGFub255bW91cyBjbGFzcywgc28ganVzdCBza2lwIGFsbCB0aGUgbmFtZXNwYWNlIG1hbmlwdWxhdGlvbnNcbiAgICAgICAgICAgIGlmICghbnNOYW1lKSByZXR1cm4gbmV3IG1ldGFDbGFzcyhuc05hbWUsIGV4dGVuZCkuY1xuICAgICAgICAgICAgXG4gICAgICAgICAgICB2YXIgbWUgPSB0aGlzXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmICgvXlxcLi8udGVzdChuc05hbWUpKSByZXR1cm4gdGhpcy5leGVjdXRlSW4oSm9vc2UudG9wLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIG1lLmNyZWF0ZShuc05hbWUucmVwbGFjZSgvXlxcLi8sICcnKSwgbWV0YUNsYXNzLCBleHRlbmQpXG4gICAgICAgICAgICB9KVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB2YXIgcHJvcHMgICA9IGV4dGVuZCB8fCB7fVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB2YXIgcGFydHMgICA9IEpvb3NlLlMuc2FuZVNwbGl0KG5zTmFtZSwgJy4nKVxuICAgICAgICAgICAgdmFyIG9iamVjdCAgPSB0aGlzLmdldEN1cnJlbnQoKVxuICAgICAgICAgICAgdmFyIHNvRmFyICAgPSBvYmplY3QgPT0gSm9vc2UudG9wID8gW10gOiBKb29zZS5TLnNhbmVTcGxpdChvYmplY3QubWV0YS5uYW1lLCAnLicpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgcGFydHMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgICAgICB2YXIgcGFydCAgICAgICAgPSBwYXJ0c1tpXVxuICAgICAgICAgICAgICAgIHZhciBpc0xhc3QgICAgICA9IGkgPT0gcGFydHMubGVuZ3RoIC0gMVxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIGlmIChwYXJ0ID09IFwibWV0YVwiIHx8IHBhcnQgPT0gXCJteVwiIHx8ICFwYXJ0KSB0aHJvdyBcIk1vZHVsZSBuYW1lIFtcIiArIG5zTmFtZSArIFwiXSBtYXkgbm90IGluY2x1ZGUgYSBwYXJ0IGNhbGxlZCAnbWV0YScgb3IgJ215JyBvciBlbXB0eSBwYXJ0LlwiXG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgdmFyIGN1ciA9ICAgb2JqZWN0W3BhcnRdXG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgc29GYXIucHVzaChwYXJ0KVxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIHZhciBzb0Zhck5hbWUgICAgICAgPSBzb0Zhci5qb2luKFwiLlwiKVxuICAgICAgICAgICAgICAgIHZhciBuZWVkRmluYWxpemUgICAgPSBmYWxzZVxuICAgICAgICAgICAgICAgIHZhciBuc0tlZXBlclxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIC8vIGlmIHRoZSBuYW1lc3BhY2Ugc2VnbWVudCBpcyBlbXB0eVxuICAgICAgICAgICAgICAgIGlmICh0eXBlb2YgY3VyID09IFwidW5kZWZpbmVkXCIpIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGlzTGFzdCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgLy8gcGVyZm9ybSBcImVhcmx5IGNyZWF0ZVwiIHdoaWNoIGp1c3QgZmlsbHMgdGhlIG5hbWVzcGFjZSBzZWdtZW50IHdpdGggcmlnaHQgY29uc3RydWN0b3JcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIHRoaXMgYWxsb3dzIHVzIHRvIGhhdmUgYSByaWdodCBjb25zdHJ1Y3RvciBpbiB0aGUgbmFtZXNwYWNlIHNlZ21lbnQgd2hlbiB0aGUgYGJvZHlgIHdpbGwgYmUgY2FsbGVkXG4gICAgICAgICAgICAgICAgICAgICAgICBuc0tlZXBlciAgICAgICAgPSB0aGlzLmVhcmx5Q3JlYXRlKHNvRmFyTmFtZSwgbWV0YUNsYXNzLCBwcm9wcylcbiAgICAgICAgICAgICAgICAgICAgICAgIG5lZWRGaW5hbGl6ZSAgICA9IHRydWVcbiAgICAgICAgICAgICAgICAgICAgfSBlbHNlXG4gICAgICAgICAgICAgICAgICAgICAgICBuc0tlZXBlciAgICAgICAgPSBuZXcgSm9vc2UuTmFtZXNwYWNlLktlZXBlcihzb0Zhck5hbWUpLmNcbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIG9iamVjdFtwYXJ0XSA9IG5zS2VlcGVyXG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICBjdXIgPSBuc0tlZXBlclxuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKGlzTGFzdCAmJiBjdXIgJiYgY3VyLm1ldGEpIHtcbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIHZhciBjdXJyZW50TWV0YSA9IGN1ci5tZXRhXG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICBpZiAobWV0YUNsYXNzID09IEpvb3NlLk5hbWVzcGFjZS5LZWVwZXIpXG4gICAgICAgICAgICAgICAgICAgICAgICAvL2BNb2R1bGVgIG92ZXIgc29tZXRoaW5nIGNhc2UgLSBleHRlbmQgdGhlIG9yaWdpbmFsXG4gICAgICAgICAgICAgICAgICAgICAgICBjdXJyZW50TWV0YS5leHRlbmQocHJvcHMpXG4gICAgICAgICAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoY3VycmVudE1ldGEgaW5zdGFuY2VvZiBKb29zZS5OYW1lc3BhY2UuS2VlcGVyKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY3VycmVudE1ldGEucGxhbnQodGhpcy5lYXJseUNyZWF0ZShzb0Zhck5hbWUsIG1ldGFDbGFzcywgcHJvcHMpKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG5lZWRGaW5hbGl6ZSA9IHRydWVcbiAgICAgICAgICAgICAgICAgICAgICAgIH0gZWxzZVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcIkRvdWJsZSBkZWNsYXJhdGlvbiBvZiBbXCIgKyBzb0Zhck5hbWUgKyBcIl1cIilcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICB9IGVsc2UgXG4gICAgICAgICAgICAgICAgICAgIGlmIChpc0xhc3QgJiYgIShjdXIgJiYgY3VyLm1ldGEgJiYgY3VyLm1ldGEubWV0YSkpIHRocm93IFwiVHJ5aW5nIHRvIHNldHVwIG1vZHVsZSBcIiArIHNvRmFyTmFtZSArIFwiIGZhaWxlZC4gVGhlcmUgaXMgYWxyZWFkeSBzb21ldGhpbmc6IFwiICsgY3VyXG5cbiAgICAgICAgICAgICAgICAvLyBob29rIHRvIGFsbG93IGVtYmVkZCByZXNvdXJjZSBpbnRvIG1ldGFcbiAgICAgICAgICAgICAgICBpZiAoaXNMYXN0KSB0aGlzLnByZXBhcmVNZXRhKGN1ci5tZXRhKVxuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBpZiAobmVlZEZpbmFsaXplKSBjdXIubWV0YS5jb25zdHJ1Y3QocHJvcHMpXG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIG9iamVjdCA9IGN1clxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgXG4gICAgICAgICAgICByZXR1cm4gb2JqZWN0XG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgcHJlcGFyZU1ldGEgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgcHJlcGFyZVByb3BlcnRpZXMgOiBmdW5jdGlvbiAobmFtZSwgcHJvcHMsIGRlZmF1bHRNZXRhLCBjYWxsYmFjaykge1xuICAgICAgICAgICAgaWYgKG5hbWUgJiYgdHlwZW9mIG5hbWUgIT0gJ3N0cmluZycpIHtcbiAgICAgICAgICAgICAgICBwcm9wcyAgID0gbmFtZVxuICAgICAgICAgICAgICAgIG5hbWUgICAgPSBudWxsXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciBtZXRhXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmIChwcm9wcyAmJiBwcm9wcy5tZXRhKSB7XG4gICAgICAgICAgICAgICAgbWV0YSA9IHByb3BzLm1ldGFcbiAgICAgICAgICAgICAgICBkZWxldGUgcHJvcHMubWV0YVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAoIW1ldGEpXG4gICAgICAgICAgICAgICAgaWYgKHByb3BzICYmIHR5cGVvZiBwcm9wcy5pc2EgPT0gJ2Z1bmN0aW9uJyAmJiBwcm9wcy5pc2EubWV0YSlcbiAgICAgICAgICAgICAgICAgICAgbWV0YSA9IHByb3BzLmlzYS5tZXRhLmNvbnN0cnVjdG9yXG4gICAgICAgICAgICAgICAgZWxzZVxuICAgICAgICAgICAgICAgICAgICBtZXRhID0gZGVmYXVsdE1ldGFcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcmV0dXJuIGNhbGxiYWNrLmNhbGwodGhpcywgbmFtZSwgbWV0YSwgcHJvcHMpXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgZ2V0RGVmYXVsdEhlbHBlckZvciA6IGZ1bmN0aW9uIChtZXRhQ2xhc3MpIHtcbiAgICAgICAgICAgIHZhciBtZSA9IHRoaXNcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcmV0dXJuIGZ1bmN0aW9uIChuYW1lLCBwcm9wcykge1xuICAgICAgICAgICAgICAgIHJldHVybiBtZS5wcmVwYXJlUHJvcGVydGllcyhuYW1lLCBwcm9wcywgbWV0YUNsYXNzLCBmdW5jdGlvbiAobmFtZSwgbWV0YSwgcHJvcHMpIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIG1lLmNyZWF0ZShuYW1lLCBtZXRhLCBwcm9wcylcbiAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIHJlZ2lzdGVyIDogZnVuY3Rpb24gKGhlbHBlck5hbWUsIG1ldGFDbGFzcywgZnVuYykge1xuICAgICAgICAgICAgdmFyIG1lID0gdGhpc1xuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAodGhpcy5tZXRhLmhhc01ldGhvZChoZWxwZXJOYW1lKSkge1xuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIHZhciBoZWxwZXIgPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBtZVsgaGVscGVyTmFtZSBdLmFwcGx5KG1lLCBhcmd1bWVudHMpXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIGlmICghSm9vc2UudG9wWyBoZWxwZXJOYW1lIF0pICAgSm9vc2UudG9wWyBoZWxwZXJOYW1lIF0gICAgICAgICA9IGhlbHBlclxuICAgICAgICAgICAgICAgIGlmICghSm9vc2VbIGhlbHBlck5hbWUgXSkgICAgICAgSm9vc2VbIGhlbHBlck5hbWUgXSAgICAgICAgICAgICA9IGhlbHBlclxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIGlmIChKb29zZS5pc19Ob2RlSlMgJiYgdHlwZW9mIGV4cG9ydHMgIT0gJ3VuZGVmaW5lZCcpICAgICAgICAgICAgZXhwb3J0c1sgaGVscGVyTmFtZSBdICAgID0gaGVscGVyXG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHZhciBtZXRob2RzID0ge31cbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBtZXRob2RzWyBoZWxwZXJOYW1lIF0gPSBmdW5jIHx8IHRoaXMuZ2V0RGVmYXVsdEhlbHBlckZvcihtZXRhQ2xhc3MpXG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgdGhpcy5tZXRhLmV4dGVuZCh7XG4gICAgICAgICAgICAgICAgICAgIG1ldGhvZHMgOiBtZXRob2RzXG4gICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICB0aGlzLnJlZ2lzdGVyKGhlbHBlck5hbWUpXG4gICAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgTW9kdWxlIDogZnVuY3Rpb24gKG5hbWUsIHByb3BzKSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5wcmVwYXJlUHJvcGVydGllcyhuYW1lLCBwcm9wcywgSm9vc2UuTmFtZXNwYWNlLktlZXBlciwgZnVuY3Rpb24gKG5hbWUsIG1ldGEsIHByb3BzKSB7XG4gICAgICAgICAgICAgICAgaWYgKHR5cGVvZiBwcm9wcyA9PSAnZnVuY3Rpb24nKSBwcm9wcyA9IHsgYm9keSA6IHByb3BzIH0gICAgXG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuY3JlYXRlKG5hbWUsIG1ldGEsIHByb3BzKVxuICAgICAgICAgICAgfSlcbiAgICAgICAgfVxuICAgIH1cbiAgICBcbn0pLmNcblxuSm9vc2UuTmFtZXNwYWNlLk1hbmFnZXIubXkgPSBuZXcgSm9vc2UuTmFtZXNwYWNlLk1hbmFnZXIoKVxuXG5Kb29zZS5OYW1lc3BhY2UuTWFuYWdlci5teS5yZWdpc3RlcignQ2xhc3MnLCBKb29zZS5NZXRhLkNsYXNzKVxuSm9vc2UuTmFtZXNwYWNlLk1hbmFnZXIubXkucmVnaXN0ZXIoJ1JvbGUnLCBKb29zZS5NZXRhLlJvbGUpXG5Kb29zZS5OYW1lc3BhY2UuTWFuYWdlci5teS5yZWdpc3RlcignTW9kdWxlJylcblxuXG4vLyBmb3IgdGhlIHJlc3Qgb2YgdGhlIHBhY2thZ2VcbnZhciBDbGFzcyAgICAgICA9IEpvb3NlLkNsYXNzXG52YXIgUm9sZSAgICAgICAgPSBKb29zZS5Sb2xlXG47XG5Sb2xlKCdKb29zZS5BdHRyaWJ1dGUuRGVsZWdhdGUnLCB7XG4gICAgXG4gICAgaGF2ZSA6IHtcbiAgICAgICAgaGFuZGxlcyA6IG51bGxcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIG92ZXJyaWRlIDoge1xuICAgICAgICBcbiAgICAgICAgZWFjaERlbGVnYXRlIDogZnVuY3Rpb24gKGhhbmRsZXMsIGZ1bmMsIHNjb3BlKSB7XG4gICAgICAgICAgICBpZiAodHlwZW9mIGhhbmRsZXMgPT0gJ3N0cmluZycpIHJldHVybiBmdW5jLmNhbGwoc2NvcGUsIGhhbmRsZXMsIGhhbmRsZXMpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmIChoYW5kbGVzIGluc3RhbmNlb2YgQXJyYXkpXG4gICAgICAgICAgICAgICAgcmV0dXJuIEpvb3NlLkEuZWFjaChoYW5kbGVzLCBmdW5jdGlvbiAoZGVsZWdhdGVUbykge1xuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgZnVuYy5jYWxsKHNjb3BlLCBkZWxlZ2F0ZVRvLCBkZWxlZ2F0ZVRvKVxuICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAoaGFuZGxlcyA9PT0gT2JqZWN0KGhhbmRsZXMpKVxuICAgICAgICAgICAgICAgIEpvb3NlLk8uZWFjaE93bihoYW5kbGVzLCBmdW5jdGlvbiAoZGVsZWdhdGVUbywgaGFuZGxlQXMpIHtcbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIGZ1bmMuY2FsbChzY29wZSwgaGFuZGxlQXMsIGRlbGVnYXRlVG8pXG4gICAgICAgICAgICAgICAgfSlcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBnZXRBY2Nlc3NvcnNGb3IgOiBmdW5jdGlvbiAodGFyZ2V0Q2xhc3MpIHtcbiAgICAgICAgICAgIHZhciB0YXJnZXRNZXRhICA9IHRhcmdldENsYXNzLm1ldGFcbiAgICAgICAgICAgIHZhciBtZXRob2RzICAgICA9IHRoaXMuU1VQRVIodGFyZ2V0Q2xhc3MpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciBtZSAgICAgID0gdGhpc1xuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLmVhY2hEZWxlZ2F0ZSh0aGlzLmhhbmRsZXMsIGZ1bmN0aW9uIChoYW5kbGVBcywgZGVsZWdhdGVUbykge1xuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIGlmICghdGFyZ2V0TWV0YS5oYXNNZXRob2QoaGFuZGxlQXMpKSB7XG4gICAgICAgICAgICAgICAgICAgIHZhciBoYW5kbGVyID0gbWV0aG9kc1sgaGFuZGxlQXMgXSA9IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHZhciBhdHRyVmFsdWUgPSBtZS5nZXRWYWx1ZUZyb20odGhpcylcbiAgICAgICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGF0dHJWYWx1ZVsgZGVsZWdhdGVUbyBdLmFwcGx5KGF0dHJWYWx1ZSwgYXJndW1lbnRzKVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICBoYW5kbGVyLkFDQ0VTU09SX0ZST00gPSBtZVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHJldHVybiBtZXRob2RzXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgZ2V0QWNjZXNzb3JzRnJvbSA6IGZ1bmN0aW9uIChmcm9tKSB7XG4gICAgICAgICAgICB2YXIgbWV0aG9kcyA9IHRoaXMuU1VQRVIoZnJvbSlcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdmFyIG1lICAgICAgICAgID0gdGhpc1xuICAgICAgICAgICAgdmFyIHRhcmdldE1ldGEgID0gZnJvbS5tZXRhXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXMuZWFjaERlbGVnYXRlKHRoaXMuaGFuZGxlcywgZnVuY3Rpb24gKGhhbmRsZUFzKSB7XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgdmFyIGhhbmRsZXIgPSB0YXJnZXRNZXRhLmdldE1ldGhvZChoYW5kbGVBcylcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBpZiAoaGFuZGxlciAmJiBoYW5kbGVyLnZhbHVlLkFDQ0VTU09SX0ZST00gPT0gbWUpIG1ldGhvZHMucHVzaChoYW5kbGVBcylcbiAgICAgICAgICAgIH0pXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHJldHVybiBtZXRob2RzXG4gICAgICAgIH1cbiAgICB9XG59KVxuXG47XG5Sb2xlKCdKb29zZS5BdHRyaWJ1dGUuVHJpZ2dlcicsIHtcbiAgICBcbiAgICBoYXZlIDoge1xuICAgICAgICB0cmlnZ2VyICAgICAgICA6IG51bGxcbiAgICB9LCBcblxuICAgIFxuICAgIGFmdGVyIDoge1xuICAgICAgICBpbml0aWFsaXplIDogZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICBpZiAodGhpcy50cmlnZ2VyKSB7XG4gICAgICAgICAgICAgICAgaWYgKCF0aGlzLndyaXRlYWJsZSkgdGhyb3cgbmV3IEVycm9yKFwiQ2FuJ3QgdXNlIGB0cmlnZ2VyYCBmb3IgcmVhZC1vbmx5IGF0dHJpYnV0ZXNcIilcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICB0aGlzLmhhc1NldHRlciA9IHRydWVcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgb3ZlcnJpZGUgOiB7XG4gICAgICAgIFxuICAgICAgICBnZXRTZXR0ZXIgOiBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgIHZhciBvcmlnaW5hbCAgICA9IHRoaXMuU1VQRVIoKVxuICAgICAgICAgICAgdmFyIHRyaWdnZXIgICAgID0gdGhpcy50cmlnZ2VyXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmICghdHJpZ2dlcikgcmV0dXJuIG9yaWdpbmFsXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciBtZSAgICAgID0gdGhpc1xuICAgICAgICAgICAgdmFyIGluaXQgICAgPSBKb29zZS5PLmlzRnVuY3Rpb24obWUuaW5pdCkgPyBudWxsIDogbWUuaW5pdFxuICAgICAgICAgICAgXG4gICAgICAgICAgICByZXR1cm4gZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgIHZhciBvbGRWYWx1ZSAgICA9IG1lLmhhc1ZhbHVlKHRoaXMpID8gbWUuZ2V0VmFsdWVGcm9tKHRoaXMpIDogaW5pdFxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIHZhciByZXMgICAgICAgICA9IG9yaWdpbmFsLmFwcGx5KHRoaXMsIGFyZ3VtZW50cylcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICB0cmlnZ2VyLmNhbGwodGhpcywgbWUuZ2V0VmFsdWVGcm9tKHRoaXMpLCBvbGRWYWx1ZSlcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICByZXR1cm4gcmVzXG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG59KSAgICBcblxuO1xuUm9sZSgnSm9vc2UuQXR0cmlidXRlLkxhenknLCB7XG4gICAgXG4gICAgXG4gICAgaGF2ZSA6IHtcbiAgICAgICAgbGF6eSAgICAgICAgOiBudWxsXG4gICAgfSwgXG4gICAgXG4gICAgXG4gICAgYmVmb3JlIDoge1xuICAgICAgICBjb21wdXRlVmFsdWUgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBpZiAodHlwZW9mIHRoaXMuaW5pdCA9PSAnZnVuY3Rpb24nICYmIHRoaXMubGF6eSkge1xuICAgICAgICAgICAgICAgIHRoaXMubGF6eSA9IHRoaXMuaW5pdCAgICBcbiAgICAgICAgICAgICAgICBkZWxldGUgdGhpcy5pbml0ICAgIFxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBhZnRlciA6IHtcbiAgICAgICAgaW5pdGlhbGl6ZSA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIGlmICh0aGlzLmxhenkpIHRoaXMucmVhZGFibGUgPSB0aGlzLmhhc0dldHRlciA9IHRydWVcbiAgICAgICAgfVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgb3ZlcnJpZGUgOiB7XG4gICAgICAgIFxuICAgICAgICBnZXRHZXR0ZXIgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB2YXIgb3JpZ2luYWwgICAgPSB0aGlzLlNVUEVSKClcbiAgICAgICAgICAgIHZhciBsYXp5ICAgICAgICA9IHRoaXMubGF6eVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAoIWxhenkpIHJldHVybiBvcmlnaW5hbFxuICAgICAgICAgICAgXG4gICAgICAgICAgICB2YXIgbWUgICAgICA9IHRoaXMgICAgXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHJldHVybiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgICAgaWYgKCFtZS5oYXNWYWx1ZSh0aGlzKSkge1xuICAgICAgICAgICAgICAgICAgICB2YXIgaW5pdGlhbGl6ZXIgPSB0eXBlb2YgbGF6eSA9PSAnZnVuY3Rpb24nID8gbGF6eSA6IHRoaXNbIGxhenkucmVwbGFjZSgvXnRoaXNcXC4vLCAnJykgXVxuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgbWUuc2V0VmFsdWVUbyh0aGlzLCBpbml0aWFsaXplci5hcHBseSh0aGlzLCBhcmd1bWVudHMpKVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICByZXR1cm4gb3JpZ2luYWwuY2FsbCh0aGlzKSAgICBcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cbn0pXG5cbjtcblJvbGUoJ0pvb3NlLkF0dHJpYnV0ZS5BY2Nlc3Nvci5Db21iaW5lZCcsIHtcbiAgICBcbiAgICBcbiAgICBoYXZlIDoge1xuICAgICAgICBpc0NvbWJpbmVkICAgICAgICA6IGZhbHNlXG4gICAgfSwgXG4gICAgXG4gICAgXG4gICAgYWZ0ZXIgOiB7XG4gICAgICAgIGluaXRpYWxpemUgOiBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgIHRoaXMuaXNDb21iaW5lZCA9IHRoaXMuaXNDb21iaW5lZCB8fCAvLi5jL2kudGVzdCh0aGlzLmlzKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAodGhpcy5pc0NvbWJpbmVkKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5zbG90ID0gJyQkJyArIHRoaXMubmFtZVxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIHRoaXMuaGFzR2V0dGVyID0gdHJ1ZVxuICAgICAgICAgICAgICAgIHRoaXMuaGFzU2V0dGVyID0gZmFsc2VcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICB0aGlzLnNldHRlck5hbWUgPSB0aGlzLmdldHRlck5hbWUgPSB0aGlzLnB1YmxpY05hbWVcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgb3ZlcnJpZGUgOiB7XG4gICAgICAgIFxuICAgICAgICBnZXRHZXR0ZXIgOiBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgIHZhciBnZXR0ZXIgICAgPSB0aGlzLlNVUEVSKClcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKCF0aGlzLmlzQ29tYmluZWQpIHJldHVybiBnZXR0ZXJcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdmFyIHNldHRlciAgICA9IHRoaXMuZ2V0U2V0dGVyKClcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdmFyIG1lID0gdGhpc1xuICAgICAgICAgICAgXG4gICAgICAgICAgICByZXR1cm4gZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIGlmICghYXJndW1lbnRzLmxlbmd0aCkge1xuICAgICAgICAgICAgICAgICAgICBpZiAobWUucmVhZGFibGUpIHJldHVybiBnZXR0ZXIuY2FsbCh0aGlzKVxuICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDYWxsIHRvIGdldHRlciBvZiB1bnJlYWRhYmxlIGF0dHJpYnV0ZTogW1wiICsgbWUubmFtZSArIFwiXVwiKVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBpZiAobWUud3JpdGVhYmxlKSByZXR1cm4gc2V0dGVyLmFwcGx5KHRoaXMsIGFyZ3VtZW50cylcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDYWxsIHRvIHNldHRlciBvZiByZWFkLW9ubHkgYXR0cmlidXRlOiBbXCIgKyBtZS5uYW1lICsgXCJdXCIpICAgIFxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuICAgIFxufSlcblxuO1xuSm9vc2UuTWFuYWdlZC5BdHRyaWJ1dGUubWV0YS5leHRlbmQoe1xuICAgIGRvZXMgOiBbIEpvb3NlLkF0dHJpYnV0ZS5EZWxlZ2F0ZSwgSm9vc2UuQXR0cmlidXRlLlRyaWdnZXIsIEpvb3NlLkF0dHJpYnV0ZS5MYXp5LCBKb29zZS5BdHRyaWJ1dGUuQWNjZXNzb3IuQ29tYmluZWQgXVxufSkgICAgICAgICAgICBcblxuO1xuUm9sZSgnSm9vc2UuTWV0YS5TaW5nbGV0b24nLCB7XG4gICAgXG4gICAgaGFzIDoge1xuICAgICAgICBmb3JjZUluc3RhbmNlICAgICAgICAgICA6IEpvb3NlLkkuT2JqZWN0LFxuICAgICAgICBpbnN0YW5jZSAgICAgICAgICAgICAgICA6IG51bGxcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIFxuICAgIG92ZXJyaWRlIDoge1xuICAgICAgICBcbiAgICAgICAgZGVmYXVsdENvbnN0cnVjdG9yIDogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgdmFyIG1ldGEgICAgICAgID0gdGhpc1xuICAgICAgICAgICAgdmFyIHByZXZpb3VzICAgID0gdGhpcy5TVVBFUigpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXMuYWRhcHRDb25zdHJ1Y3RvcihwcmV2aW91cylcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcmV0dXJuIGZ1bmN0aW9uIChmb3JjZUluc3RhbmNlLCBwYXJhbXMpIHtcbiAgICAgICAgICAgICAgICBpZiAoZm9yY2VJbnN0YW5jZSA9PSBtZXRhLmZvcmNlSW5zdGFuY2UpIHJldHVybiBwcmV2aW91cy5hcHBseSh0aGlzLCBwYXJhbXMpIHx8IHRoaXNcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICB2YXIgaW5zdGFuY2UgPSBtZXRhLmluc3RhbmNlXG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgaWYgKGluc3RhbmNlKSB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChtZXRhLmhhc01ldGhvZCgnY29uZmlndXJlJykpIGluc3RhbmNlLmNvbmZpZ3VyZS5hcHBseShpbnN0YW5jZSwgYXJndW1lbnRzKVxuICAgICAgICAgICAgICAgIH0gZWxzZVxuICAgICAgICAgICAgICAgICAgICBtZXRhLmluc3RhbmNlID0gbmV3IG1ldGEuYyhtZXRhLmZvcmNlSW5zdGFuY2UsIGFyZ3VtZW50cylcbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgcmV0dXJuIG1ldGEuaW5zdGFuY2VcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSAgICAgICAgXG4gICAgfVxuICAgIFxuXG59KVxuXG5cbkpvb3NlLk5hbWVzcGFjZS5NYW5hZ2VyLm15LnJlZ2lzdGVyKCdTaW5nbGV0b24nLCBDbGFzcyh7XG4gICAgaXNhICAgICA6IEpvb3NlLk1ldGEuQ2xhc3MsXG4gICAgbWV0YSAgICA6IEpvb3NlLk1ldGEuQ2xhc3MsXG4gICAgXG4gICAgZG9lcyAgICA6IEpvb3NlLk1ldGEuU2luZ2xldG9uXG59KSlcbjtcbjtcbn0oKTs7XG4iLCIvKlxuIChjKSAyMDEzLCBWbGFkaW1pciBBZ2Fmb25raW5cbiBSQnVzaCwgYSBKYXZhU2NyaXB0IGxpYnJhcnkgZm9yIGhpZ2gtcGVyZm9ybWFuY2UgMkQgc3BhdGlhbCBpbmRleGluZyBvZiBwb2ludHMgYW5kIHJlY3RhbmdsZXMuXG4gaHR0cHM6Ly9naXRodWIuY29tL21vdXJuZXIvcmJ1c2hcbiovXG5cbihmdW5jdGlvbiAoKSB7ICd1c2Ugc3RyaWN0JztcblxuZnVuY3Rpb24gcmJ1c2gobWF4RW50cmllcywgZm9ybWF0KSB7XG5cbiAgICAvLyBqc2hpbnQgbmV3Y2FwOiBmYWxzZSwgdmFsaWR0aGlzOiB0cnVlXG4gICAgaWYgKCEodGhpcyBpbnN0YW5jZW9mIHJidXNoKSkgcmV0dXJuIG5ldyByYnVzaChtYXhFbnRyaWVzLCBmb3JtYXQpO1xuXG4gICAgLy8gbWF4IGVudHJpZXMgaW4gYSBub2RlIGlzIDkgYnkgZGVmYXVsdDsgbWluIG5vZGUgZmlsbCBpcyA0MCUgZm9yIGJlc3QgcGVyZm9ybWFuY2VcbiAgICB0aGlzLl9tYXhFbnRyaWVzID0gTWF0aC5tYXgoNCwgbWF4RW50cmllcyB8fCA5KTtcbiAgICB0aGlzLl9taW5FbnRyaWVzID0gTWF0aC5tYXgoMiwgTWF0aC5jZWlsKHRoaXMuX21heEVudHJpZXMgKiAwLjQpKTtcblxuICAgIGlmIChmb3JtYXQpIHtcbiAgICAgICAgdGhpcy5faW5pdEZvcm1hdChmb3JtYXQpO1xuICAgIH1cblxuICAgIHRoaXMuY2xlYXIoKTtcbn1cblxucmJ1c2gucHJvdG90eXBlID0ge1xuXG4gICAgYWxsOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHJldHVybiB0aGlzLl9hbGwodGhpcy5kYXRhLCBbXSk7XG4gICAgfSxcblxuICAgIHNlYXJjaDogZnVuY3Rpb24gKGJib3gpIHtcblxuICAgICAgICB2YXIgbm9kZSA9IHRoaXMuZGF0YSxcbiAgICAgICAgICAgIHJlc3VsdCA9IFtdLFxuICAgICAgICAgICAgdG9CQm94ID0gdGhpcy50b0JCb3g7XG5cbiAgICAgICAgaWYgKCFpbnRlcnNlY3RzKGJib3gsIG5vZGUuYmJveCkpIHJldHVybiByZXN1bHQ7XG5cbiAgICAgICAgdmFyIG5vZGVzVG9TZWFyY2ggPSBbXSxcbiAgICAgICAgICAgIGksIGxlbiwgY2hpbGQsIGNoaWxkQkJveDtcblxuICAgICAgICB3aGlsZSAobm9kZSkge1xuICAgICAgICAgICAgZm9yIChpID0gMCwgbGVuID0gbm9kZS5jaGlsZHJlbi5sZW5ndGg7IGkgPCBsZW47IGkrKykge1xuXG4gICAgICAgICAgICAgICAgY2hpbGQgPSBub2RlLmNoaWxkcmVuW2ldO1xuICAgICAgICAgICAgICAgIGNoaWxkQkJveCA9IG5vZGUubGVhZiA/IHRvQkJveChjaGlsZCkgOiBjaGlsZC5iYm94O1xuXG4gICAgICAgICAgICAgICAgaWYgKGludGVyc2VjdHMoYmJveCwgY2hpbGRCQm94KSkge1xuICAgICAgICAgICAgICAgICAgICBpZiAobm9kZS5sZWFmKSByZXN1bHQucHVzaChjaGlsZCk7XG4gICAgICAgICAgICAgICAgICAgIGVsc2UgaWYgKGNvbnRhaW5zKGJib3gsIGNoaWxkQkJveCkpIHRoaXMuX2FsbChjaGlsZCwgcmVzdWx0KTtcbiAgICAgICAgICAgICAgICAgICAgZWxzZSBub2Rlc1RvU2VhcmNoLnB1c2goY2hpbGQpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIG5vZGUgPSBub2Rlc1RvU2VhcmNoLnBvcCgpO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICB9LFxuXG4gICAgY29sbGlkZXM6IGZ1bmN0aW9uIChiYm94KSB7XG5cbiAgICAgICAgdmFyIG5vZGUgPSB0aGlzLmRhdGEsXG4gICAgICAgICAgICB0b0JCb3ggPSB0aGlzLnRvQkJveDtcblxuICAgICAgICBpZiAoIWludGVyc2VjdHMoYmJveCwgbm9kZS5iYm94KSkgcmV0dXJuIGZhbHNlO1xuXG4gICAgICAgIHZhciBub2Rlc1RvU2VhcmNoID0gW10sXG4gICAgICAgICAgICBpLCBsZW4sIGNoaWxkLCBjaGlsZEJCb3g7XG5cbiAgICAgICAgd2hpbGUgKG5vZGUpIHtcbiAgICAgICAgICAgIGZvciAoaSA9IDAsIGxlbiA9IG5vZGUuY2hpbGRyZW4ubGVuZ3RoOyBpIDwgbGVuOyBpKyspIHtcblxuICAgICAgICAgICAgICAgIGNoaWxkID0gbm9kZS5jaGlsZHJlbltpXTtcbiAgICAgICAgICAgICAgICBjaGlsZEJCb3ggPSBub2RlLmxlYWYgPyB0b0JCb3goY2hpbGQpIDogY2hpbGQuYmJveDtcblxuICAgICAgICAgICAgICAgIGlmIChpbnRlcnNlY3RzKGJib3gsIGNoaWxkQkJveCkpIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKG5vZGUubGVhZiB8fCBjb250YWlucyhiYm94LCBjaGlsZEJCb3gpKSByZXR1cm4gdHJ1ZTtcbiAgICAgICAgICAgICAgICAgICAgbm9kZXNUb1NlYXJjaC5wdXNoKGNoaWxkKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBub2RlID0gbm9kZXNUb1NlYXJjaC5wb3AoKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9LFxuXG4gICAgbG9hZDogZnVuY3Rpb24gKGRhdGEpIHtcbiAgICAgICAgaWYgKCEoZGF0YSAmJiBkYXRhLmxlbmd0aCkpIHJldHVybiB0aGlzO1xuXG4gICAgICAgIGlmIChkYXRhLmxlbmd0aCA8IHRoaXMuX21pbkVudHJpZXMpIHtcbiAgICAgICAgICAgIGZvciAodmFyIGkgPSAwLCBsZW4gPSBkYXRhLmxlbmd0aDsgaSA8IGxlbjsgaSsrKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5pbnNlcnQoZGF0YVtpXSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gdGhpcztcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIHJlY3Vyc2l2ZWx5IGJ1aWxkIHRoZSB0cmVlIHdpdGggdGhlIGdpdmVuIGRhdGEgZnJvbSBzdHJhdGNoIHVzaW5nIE9NVCBhbGdvcml0aG1cbiAgICAgICAgdmFyIG5vZGUgPSB0aGlzLl9idWlsZChkYXRhLnNsaWNlKCksIDAsIGRhdGEubGVuZ3RoIC0gMSwgMCk7XG5cbiAgICAgICAgaWYgKCF0aGlzLmRhdGEuY2hpbGRyZW4ubGVuZ3RoKSB7XG4gICAgICAgICAgICAvLyBzYXZlIGFzIGlzIGlmIHRyZWUgaXMgZW1wdHlcbiAgICAgICAgICAgIHRoaXMuZGF0YSA9IG5vZGU7XG5cbiAgICAgICAgfSBlbHNlIGlmICh0aGlzLmRhdGEuaGVpZ2h0ID09PSBub2RlLmhlaWdodCkge1xuICAgICAgICAgICAgLy8gc3BsaXQgcm9vdCBpZiB0cmVlcyBoYXZlIHRoZSBzYW1lIGhlaWdodFxuICAgICAgICAgICAgdGhpcy5fc3BsaXRSb290KHRoaXMuZGF0YSwgbm9kZSk7XG5cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGlmICh0aGlzLmRhdGEuaGVpZ2h0IDwgbm9kZS5oZWlnaHQpIHtcbiAgICAgICAgICAgICAgICAvLyBzd2FwIHRyZWVzIGlmIGluc2VydGVkIG9uZSBpcyBiaWdnZXJcbiAgICAgICAgICAgICAgICB2YXIgdG1wTm9kZSA9IHRoaXMuZGF0YTtcbiAgICAgICAgICAgICAgICB0aGlzLmRhdGEgPSBub2RlO1xuICAgICAgICAgICAgICAgIG5vZGUgPSB0bXBOb2RlO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBpbnNlcnQgdGhlIHNtYWxsIHRyZWUgaW50byB0aGUgbGFyZ2UgdHJlZSBhdCBhcHByb3ByaWF0ZSBsZXZlbFxuICAgICAgICAgICAgdGhpcy5faW5zZXJ0KG5vZGUsIHRoaXMuZGF0YS5oZWlnaHQgLSBub2RlLmhlaWdodCAtIDEsIHRydWUpO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfSxcblxuICAgIGluc2VydDogZnVuY3Rpb24gKGl0ZW0pIHtcbiAgICAgICAgaWYgKGl0ZW0pIHRoaXMuX2luc2VydChpdGVtLCB0aGlzLmRhdGEuaGVpZ2h0IC0gMSk7XG4gICAgICAgIHJldHVybiB0aGlzO1xuICAgIH0sXG5cbiAgICBjbGVhcjogZnVuY3Rpb24gKCkge1xuICAgICAgICB0aGlzLmRhdGEgPSB7XG4gICAgICAgICAgICBjaGlsZHJlbjogW10sXG4gICAgICAgICAgICBoZWlnaHQ6IDEsXG4gICAgICAgICAgICBiYm94OiBlbXB0eSgpLFxuICAgICAgICAgICAgbGVhZjogdHJ1ZVxuICAgICAgICB9O1xuICAgICAgICByZXR1cm4gdGhpcztcbiAgICB9LFxuXG4gICAgcmVtb3ZlOiBmdW5jdGlvbiAoaXRlbSkge1xuICAgICAgICBpZiAoIWl0ZW0pIHJldHVybiB0aGlzO1xuXG4gICAgICAgIHZhciBub2RlID0gdGhpcy5kYXRhLFxuICAgICAgICAgICAgYmJveCA9IHRoaXMudG9CQm94KGl0ZW0pLFxuICAgICAgICAgICAgcGF0aCA9IFtdLFxuICAgICAgICAgICAgaW5kZXhlcyA9IFtdLFxuICAgICAgICAgICAgaSwgcGFyZW50LCBpbmRleCwgZ29pbmdVcDtcblxuICAgICAgICAvLyBkZXB0aC1maXJzdCBpdGVyYXRpdmUgdHJlZSB0cmF2ZXJzYWxcbiAgICAgICAgd2hpbGUgKG5vZGUgfHwgcGF0aC5sZW5ndGgpIHtcblxuICAgICAgICAgICAgaWYgKCFub2RlKSB7IC8vIGdvIHVwXG4gICAgICAgICAgICAgICAgbm9kZSA9IHBhdGgucG9wKCk7XG4gICAgICAgICAgICAgICAgcGFyZW50ID0gcGF0aFtwYXRoLmxlbmd0aCAtIDFdO1xuICAgICAgICAgICAgICAgIGkgPSBpbmRleGVzLnBvcCgpO1xuICAgICAgICAgICAgICAgIGdvaW5nVXAgPSB0cnVlO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAobm9kZS5sZWFmKSB7IC8vIGNoZWNrIGN1cnJlbnQgbm9kZVxuICAgICAgICAgICAgICAgIGluZGV4ID0gbm9kZS5jaGlsZHJlbi5pbmRleE9mKGl0ZW0pO1xuXG4gICAgICAgICAgICAgICAgaWYgKGluZGV4ICE9PSAtMSkge1xuICAgICAgICAgICAgICAgICAgICAvLyBpdGVtIGZvdW5kLCByZW1vdmUgdGhlIGl0ZW0gYW5kIGNvbmRlbnNlIHRyZWUgdXB3YXJkc1xuICAgICAgICAgICAgICAgICAgICBub2RlLmNoaWxkcmVuLnNwbGljZShpbmRleCwgMSk7XG4gICAgICAgICAgICAgICAgICAgIHBhdGgucHVzaChub2RlKTtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5fY29uZGVuc2UocGF0aCk7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB0aGlzO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKCFnb2luZ1VwICYmICFub2RlLmxlYWYgJiYgY29udGFpbnMobm9kZS5iYm94LCBiYm94KSkgeyAvLyBnbyBkb3duXG4gICAgICAgICAgICAgICAgcGF0aC5wdXNoKG5vZGUpO1xuICAgICAgICAgICAgICAgIGluZGV4ZXMucHVzaChpKTtcbiAgICAgICAgICAgICAgICBpID0gMDtcbiAgICAgICAgICAgICAgICBwYXJlbnQgPSBub2RlO1xuICAgICAgICAgICAgICAgIG5vZGUgPSBub2RlLmNoaWxkcmVuWzBdO1xuXG4gICAgICAgICAgICB9IGVsc2UgaWYgKHBhcmVudCkgeyAvLyBnbyByaWdodFxuICAgICAgICAgICAgICAgIGkrKztcbiAgICAgICAgICAgICAgICBub2RlID0gcGFyZW50LmNoaWxkcmVuW2ldO1xuICAgICAgICAgICAgICAgIGdvaW5nVXAgPSBmYWxzZTtcblxuICAgICAgICAgICAgfSBlbHNlIG5vZGUgPSBudWxsOyAvLyBub3RoaW5nIGZvdW5kXG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gdGhpcztcbiAgICB9LFxuXG4gICAgdG9CQm94OiBmdW5jdGlvbiAoaXRlbSkgeyByZXR1cm4gaXRlbTsgfSxcblxuICAgIGNvbXBhcmVNaW5YOiBmdW5jdGlvbiAoYSwgYikgeyByZXR1cm4gYVswXSAtIGJbMF07IH0sXG4gICAgY29tcGFyZU1pblk6IGZ1bmN0aW9uIChhLCBiKSB7IHJldHVybiBhWzFdIC0gYlsxXTsgfSxcblxuICAgIHRvSlNPTjogZnVuY3Rpb24gKCkgeyByZXR1cm4gdGhpcy5kYXRhOyB9LFxuXG4gICAgZnJvbUpTT046IGZ1bmN0aW9uIChkYXRhKSB7XG4gICAgICAgIHRoaXMuZGF0YSA9IGRhdGE7XG4gICAgICAgIHJldHVybiB0aGlzO1xuICAgIH0sXG5cbiAgICBfYWxsOiBmdW5jdGlvbiAobm9kZSwgcmVzdWx0KSB7XG4gICAgICAgIHZhciBub2Rlc1RvU2VhcmNoID0gW107XG4gICAgICAgIHdoaWxlIChub2RlKSB7XG4gICAgICAgICAgICBpZiAobm9kZS5sZWFmKSByZXN1bHQucHVzaC5hcHBseShyZXN1bHQsIG5vZGUuY2hpbGRyZW4pO1xuICAgICAgICAgICAgZWxzZSBub2Rlc1RvU2VhcmNoLnB1c2guYXBwbHkobm9kZXNUb1NlYXJjaCwgbm9kZS5jaGlsZHJlbik7XG5cbiAgICAgICAgICAgIG5vZGUgPSBub2Rlc1RvU2VhcmNoLnBvcCgpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgfSxcblxuICAgIF9idWlsZDogZnVuY3Rpb24gKGl0ZW1zLCBsZWZ0LCByaWdodCwgaGVpZ2h0KSB7XG5cbiAgICAgICAgdmFyIE4gPSByaWdodCAtIGxlZnQgKyAxLFxuICAgICAgICAgICAgTSA9IHRoaXMuX21heEVudHJpZXMsXG4gICAgICAgICAgICBub2RlO1xuXG4gICAgICAgIGlmIChOIDw9IE0pIHtcbiAgICAgICAgICAgIC8vIHJlYWNoZWQgbGVhZiBsZXZlbDsgcmV0dXJuIGxlYWZcbiAgICAgICAgICAgIG5vZGUgPSB7XG4gICAgICAgICAgICAgICAgY2hpbGRyZW46IGl0ZW1zLnNsaWNlKGxlZnQsIHJpZ2h0ICsgMSksXG4gICAgICAgICAgICAgICAgaGVpZ2h0OiAxLFxuICAgICAgICAgICAgICAgIGJib3g6IG51bGwsXG4gICAgICAgICAgICAgICAgbGVhZjogdHJ1ZVxuICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIGNhbGNCQm94KG5vZGUsIHRoaXMudG9CQm94KTtcbiAgICAgICAgICAgIHJldHVybiBub2RlO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKCFoZWlnaHQpIHtcbiAgICAgICAgICAgIC8vIHRhcmdldCBoZWlnaHQgb2YgdGhlIGJ1bGstbG9hZGVkIHRyZWVcbiAgICAgICAgICAgIGhlaWdodCA9IE1hdGguY2VpbChNYXRoLmxvZyhOKSAvIE1hdGgubG9nKE0pKTtcblxuICAgICAgICAgICAgLy8gdGFyZ2V0IG51bWJlciBvZiByb290IGVudHJpZXMgdG8gbWF4aW1pemUgc3RvcmFnZSB1dGlsaXphdGlvblxuICAgICAgICAgICAgTSA9IE1hdGguY2VpbChOIC8gTWF0aC5wb3coTSwgaGVpZ2h0IC0gMSkpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gVE9ETyBlbGltaW5hdGUgcmVjdXJzaW9uP1xuXG4gICAgICAgIG5vZGUgPSB7XG4gICAgICAgICAgICBjaGlsZHJlbjogW10sXG4gICAgICAgICAgICBoZWlnaHQ6IGhlaWdodCxcbiAgICAgICAgICAgIGJib3g6IG51bGxcbiAgICAgICAgfTtcblxuICAgICAgICAvLyBzcGxpdCB0aGUgaXRlbXMgaW50byBNIG1vc3RseSBzcXVhcmUgdGlsZXNcblxuICAgICAgICB2YXIgTjIgPSBNYXRoLmNlaWwoTiAvIE0pLFxuICAgICAgICAgICAgTjEgPSBOMiAqIE1hdGguY2VpbChNYXRoLnNxcnQoTSkpLFxuICAgICAgICAgICAgaSwgaiwgcmlnaHQyLCByaWdodDM7XG5cbiAgICAgICAgbXVsdGlTZWxlY3QoaXRlbXMsIGxlZnQsIHJpZ2h0LCBOMSwgdGhpcy5jb21wYXJlTWluWCk7XG5cbiAgICAgICAgZm9yIChpID0gbGVmdDsgaSA8PSByaWdodDsgaSArPSBOMSkge1xuXG4gICAgICAgICAgICByaWdodDIgPSBNYXRoLm1pbihpICsgTjEgLSAxLCByaWdodCk7XG5cbiAgICAgICAgICAgIG11bHRpU2VsZWN0KGl0ZW1zLCBpLCByaWdodDIsIE4yLCB0aGlzLmNvbXBhcmVNaW5ZKTtcblxuICAgICAgICAgICAgZm9yIChqID0gaTsgaiA8PSByaWdodDI7IGogKz0gTjIpIHtcblxuICAgICAgICAgICAgICAgIHJpZ2h0MyA9IE1hdGgubWluKGogKyBOMiAtIDEsIHJpZ2h0Mik7XG5cbiAgICAgICAgICAgICAgICAvLyBwYWNrIGVhY2ggZW50cnkgcmVjdXJzaXZlbHlcbiAgICAgICAgICAgICAgICBub2RlLmNoaWxkcmVuLnB1c2godGhpcy5fYnVpbGQoaXRlbXMsIGosIHJpZ2h0MywgaGVpZ2h0IC0gMSkpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgY2FsY0JCb3gobm9kZSwgdGhpcy50b0JCb3gpO1xuXG4gICAgICAgIHJldHVybiBub2RlO1xuICAgIH0sXG5cbiAgICBfY2hvb3NlU3VidHJlZTogZnVuY3Rpb24gKGJib3gsIG5vZGUsIGxldmVsLCBwYXRoKSB7XG5cbiAgICAgICAgdmFyIGksIGxlbiwgY2hpbGQsIHRhcmdldE5vZGUsIGFyZWEsIGVubGFyZ2VtZW50LCBtaW5BcmVhLCBtaW5FbmxhcmdlbWVudDtcblxuICAgICAgICB3aGlsZSAodHJ1ZSkge1xuICAgICAgICAgICAgcGF0aC5wdXNoKG5vZGUpO1xuXG4gICAgICAgICAgICBpZiAobm9kZS5sZWFmIHx8IHBhdGgubGVuZ3RoIC0gMSA9PT0gbGV2ZWwpIGJyZWFrO1xuXG4gICAgICAgICAgICBtaW5BcmVhID0gbWluRW5sYXJnZW1lbnQgPSBJbmZpbml0eTtcblxuICAgICAgICAgICAgZm9yIChpID0gMCwgbGVuID0gbm9kZS5jaGlsZHJlbi5sZW5ndGg7IGkgPCBsZW47IGkrKykge1xuICAgICAgICAgICAgICAgIGNoaWxkID0gbm9kZS5jaGlsZHJlbltpXTtcbiAgICAgICAgICAgICAgICBhcmVhID0gYmJveEFyZWEoY2hpbGQuYmJveCk7XG4gICAgICAgICAgICAgICAgZW5sYXJnZW1lbnQgPSBlbmxhcmdlZEFyZWEoYmJveCwgY2hpbGQuYmJveCkgLSBhcmVhO1xuXG4gICAgICAgICAgICAgICAgLy8gY2hvb3NlIGVudHJ5IHdpdGggdGhlIGxlYXN0IGFyZWEgZW5sYXJnZW1lbnRcbiAgICAgICAgICAgICAgICBpZiAoZW5sYXJnZW1lbnQgPCBtaW5FbmxhcmdlbWVudCkge1xuICAgICAgICAgICAgICAgICAgICBtaW5FbmxhcmdlbWVudCA9IGVubGFyZ2VtZW50O1xuICAgICAgICAgICAgICAgICAgICBtaW5BcmVhID0gYXJlYSA8IG1pbkFyZWEgPyBhcmVhIDogbWluQXJlYTtcbiAgICAgICAgICAgICAgICAgICAgdGFyZ2V0Tm9kZSA9IGNoaWxkO1xuXG4gICAgICAgICAgICAgICAgfSBlbHNlIGlmIChlbmxhcmdlbWVudCA9PT0gbWluRW5sYXJnZW1lbnQpIHtcbiAgICAgICAgICAgICAgICAgICAgLy8gb3RoZXJ3aXNlIGNob29zZSBvbmUgd2l0aCB0aGUgc21hbGxlc3QgYXJlYVxuICAgICAgICAgICAgICAgICAgICBpZiAoYXJlYSA8IG1pbkFyZWEpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIG1pbkFyZWEgPSBhcmVhO1xuICAgICAgICAgICAgICAgICAgICAgICAgdGFyZ2V0Tm9kZSA9IGNoaWxkO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBub2RlID0gdGFyZ2V0Tm9kZTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBub2RlO1xuICAgIH0sXG5cbiAgICBfaW5zZXJ0OiBmdW5jdGlvbiAoaXRlbSwgbGV2ZWwsIGlzTm9kZSkge1xuXG4gICAgICAgIHZhciB0b0JCb3ggPSB0aGlzLnRvQkJveCxcbiAgICAgICAgICAgIGJib3ggPSBpc05vZGUgPyBpdGVtLmJib3ggOiB0b0JCb3goaXRlbSksXG4gICAgICAgICAgICBpbnNlcnRQYXRoID0gW107XG5cbiAgICAgICAgLy8gZmluZCB0aGUgYmVzdCBub2RlIGZvciBhY2NvbW1vZGF0aW5nIHRoZSBpdGVtLCBzYXZpbmcgYWxsIG5vZGVzIGFsb25nIHRoZSBwYXRoIHRvb1xuICAgICAgICB2YXIgbm9kZSA9IHRoaXMuX2Nob29zZVN1YnRyZWUoYmJveCwgdGhpcy5kYXRhLCBsZXZlbCwgaW5zZXJ0UGF0aCk7XG5cbiAgICAgICAgLy8gcHV0IHRoZSBpdGVtIGludG8gdGhlIG5vZGVcbiAgICAgICAgbm9kZS5jaGlsZHJlbi5wdXNoKGl0ZW0pO1xuICAgICAgICBleHRlbmQobm9kZS5iYm94LCBiYm94KTtcblxuICAgICAgICAvLyBzcGxpdCBvbiBub2RlIG92ZXJmbG93OyBwcm9wYWdhdGUgdXB3YXJkcyBpZiBuZWNlc3NhcnlcbiAgICAgICAgd2hpbGUgKGxldmVsID49IDApIHtcbiAgICAgICAgICAgIGlmIChpbnNlcnRQYXRoW2xldmVsXS5jaGlsZHJlbi5sZW5ndGggPiB0aGlzLl9tYXhFbnRyaWVzKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5fc3BsaXQoaW5zZXJ0UGF0aCwgbGV2ZWwpO1xuICAgICAgICAgICAgICAgIGxldmVsLS07XG4gICAgICAgICAgICB9IGVsc2UgYnJlYWs7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBhZGp1c3QgYmJveGVzIGFsb25nIHRoZSBpbnNlcnRpb24gcGF0aFxuICAgICAgICB0aGlzLl9hZGp1c3RQYXJlbnRCQm94ZXMoYmJveCwgaW5zZXJ0UGF0aCwgbGV2ZWwpO1xuICAgIH0sXG5cbiAgICAvLyBzcGxpdCBvdmVyZmxvd2VkIG5vZGUgaW50byB0d29cbiAgICBfc3BsaXQ6IGZ1bmN0aW9uIChpbnNlcnRQYXRoLCBsZXZlbCkge1xuXG4gICAgICAgIHZhciBub2RlID0gaW5zZXJ0UGF0aFtsZXZlbF0sXG4gICAgICAgICAgICBNID0gbm9kZS5jaGlsZHJlbi5sZW5ndGgsXG4gICAgICAgICAgICBtID0gdGhpcy5fbWluRW50cmllcztcblxuICAgICAgICB0aGlzLl9jaG9vc2VTcGxpdEF4aXMobm9kZSwgbSwgTSk7XG5cbiAgICAgICAgdmFyIG5ld05vZGUgPSB7XG4gICAgICAgICAgICBjaGlsZHJlbjogbm9kZS5jaGlsZHJlbi5zcGxpY2UodGhpcy5fY2hvb3NlU3BsaXRJbmRleChub2RlLCBtLCBNKSksXG4gICAgICAgICAgICBoZWlnaHQ6IG5vZGUuaGVpZ2h0XG4gICAgICAgIH07XG5cbiAgICAgICAgaWYgKG5vZGUubGVhZikgbmV3Tm9kZS5sZWFmID0gdHJ1ZTtcblxuICAgICAgICBjYWxjQkJveChub2RlLCB0aGlzLnRvQkJveCk7XG4gICAgICAgIGNhbGNCQm94KG5ld05vZGUsIHRoaXMudG9CQm94KTtcblxuICAgICAgICBpZiAobGV2ZWwpIGluc2VydFBhdGhbbGV2ZWwgLSAxXS5jaGlsZHJlbi5wdXNoKG5ld05vZGUpO1xuICAgICAgICBlbHNlIHRoaXMuX3NwbGl0Um9vdChub2RlLCBuZXdOb2RlKTtcbiAgICB9LFxuXG4gICAgX3NwbGl0Um9vdDogZnVuY3Rpb24gKG5vZGUsIG5ld05vZGUpIHtcbiAgICAgICAgLy8gc3BsaXQgcm9vdCBub2RlXG4gICAgICAgIHRoaXMuZGF0YSA9IHtcbiAgICAgICAgICAgIGNoaWxkcmVuOiBbbm9kZSwgbmV3Tm9kZV0sXG4gICAgICAgICAgICBoZWlnaHQ6IG5vZGUuaGVpZ2h0ICsgMVxuICAgICAgICB9O1xuICAgICAgICBjYWxjQkJveCh0aGlzLmRhdGEsIHRoaXMudG9CQm94KTtcbiAgICB9LFxuXG4gICAgX2Nob29zZVNwbGl0SW5kZXg6IGZ1bmN0aW9uIChub2RlLCBtLCBNKSB7XG5cbiAgICAgICAgdmFyIGksIGJib3gxLCBiYm94Miwgb3ZlcmxhcCwgYXJlYSwgbWluT3ZlcmxhcCwgbWluQXJlYSwgaW5kZXg7XG5cbiAgICAgICAgbWluT3ZlcmxhcCA9IG1pbkFyZWEgPSBJbmZpbml0eTtcblxuICAgICAgICBmb3IgKGkgPSBtOyBpIDw9IE0gLSBtOyBpKyspIHtcbiAgICAgICAgICAgIGJib3gxID0gZGlzdEJCb3gobm9kZSwgMCwgaSwgdGhpcy50b0JCb3gpO1xuICAgICAgICAgICAgYmJveDIgPSBkaXN0QkJveChub2RlLCBpLCBNLCB0aGlzLnRvQkJveCk7XG5cbiAgICAgICAgICAgIG92ZXJsYXAgPSBpbnRlcnNlY3Rpb25BcmVhKGJib3gxLCBiYm94Mik7XG4gICAgICAgICAgICBhcmVhID0gYmJveEFyZWEoYmJveDEpICsgYmJveEFyZWEoYmJveDIpO1xuXG4gICAgICAgICAgICAvLyBjaG9vc2UgZGlzdHJpYnV0aW9uIHdpdGggbWluaW11bSBvdmVybGFwXG4gICAgICAgICAgICBpZiAob3ZlcmxhcCA8IG1pbk92ZXJsYXApIHtcbiAgICAgICAgICAgICAgICBtaW5PdmVybGFwID0gb3ZlcmxhcDtcbiAgICAgICAgICAgICAgICBpbmRleCA9IGk7XG5cbiAgICAgICAgICAgICAgICBtaW5BcmVhID0gYXJlYSA8IG1pbkFyZWEgPyBhcmVhIDogbWluQXJlYTtcblxuICAgICAgICAgICAgfSBlbHNlIGlmIChvdmVybGFwID09PSBtaW5PdmVybGFwKSB7XG4gICAgICAgICAgICAgICAgLy8gb3RoZXJ3aXNlIGNob29zZSBkaXN0cmlidXRpb24gd2l0aCBtaW5pbXVtIGFyZWFcbiAgICAgICAgICAgICAgICBpZiAoYXJlYSA8IG1pbkFyZWEpIHtcbiAgICAgICAgICAgICAgICAgICAgbWluQXJlYSA9IGFyZWE7XG4gICAgICAgICAgICAgICAgICAgIGluZGV4ID0gaTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gaW5kZXg7XG4gICAgfSxcblxuICAgIC8vIHNvcnRzIG5vZGUgY2hpbGRyZW4gYnkgdGhlIGJlc3QgYXhpcyBmb3Igc3BsaXRcbiAgICBfY2hvb3NlU3BsaXRBeGlzOiBmdW5jdGlvbiAobm9kZSwgbSwgTSkge1xuXG4gICAgICAgIHZhciBjb21wYXJlTWluWCA9IG5vZGUubGVhZiA/IHRoaXMuY29tcGFyZU1pblggOiBjb21wYXJlTm9kZU1pblgsXG4gICAgICAgICAgICBjb21wYXJlTWluWSA9IG5vZGUubGVhZiA/IHRoaXMuY29tcGFyZU1pblkgOiBjb21wYXJlTm9kZU1pblksXG4gICAgICAgICAgICB4TWFyZ2luID0gdGhpcy5fYWxsRGlzdE1hcmdpbihub2RlLCBtLCBNLCBjb21wYXJlTWluWCksXG4gICAgICAgICAgICB5TWFyZ2luID0gdGhpcy5fYWxsRGlzdE1hcmdpbihub2RlLCBtLCBNLCBjb21wYXJlTWluWSk7XG5cbiAgICAgICAgLy8gaWYgdG90YWwgZGlzdHJpYnV0aW9ucyBtYXJnaW4gdmFsdWUgaXMgbWluaW1hbCBmb3IgeCwgc29ydCBieSBtaW5YLFxuICAgICAgICAvLyBvdGhlcndpc2UgaXQncyBhbHJlYWR5IHNvcnRlZCBieSBtaW5ZXG4gICAgICAgIGlmICh4TWFyZ2luIDwgeU1hcmdpbikgbm9kZS5jaGlsZHJlbi5zb3J0KGNvbXBhcmVNaW5YKTtcbiAgICB9LFxuXG4gICAgLy8gdG90YWwgbWFyZ2luIG9mIGFsbCBwb3NzaWJsZSBzcGxpdCBkaXN0cmlidXRpb25zIHdoZXJlIGVhY2ggbm9kZSBpcyBhdCBsZWFzdCBtIGZ1bGxcbiAgICBfYWxsRGlzdE1hcmdpbjogZnVuY3Rpb24gKG5vZGUsIG0sIE0sIGNvbXBhcmUpIHtcblxuICAgICAgICBub2RlLmNoaWxkcmVuLnNvcnQoY29tcGFyZSk7XG5cbiAgICAgICAgdmFyIHRvQkJveCA9IHRoaXMudG9CQm94LFxuICAgICAgICAgICAgbGVmdEJCb3ggPSBkaXN0QkJveChub2RlLCAwLCBtLCB0b0JCb3gpLFxuICAgICAgICAgICAgcmlnaHRCQm94ID0gZGlzdEJCb3gobm9kZSwgTSAtIG0sIE0sIHRvQkJveCksXG4gICAgICAgICAgICBtYXJnaW4gPSBiYm94TWFyZ2luKGxlZnRCQm94KSArIGJib3hNYXJnaW4ocmlnaHRCQm94KSxcbiAgICAgICAgICAgIGksIGNoaWxkO1xuXG4gICAgICAgIGZvciAoaSA9IG07IGkgPCBNIC0gbTsgaSsrKSB7XG4gICAgICAgICAgICBjaGlsZCA9IG5vZGUuY2hpbGRyZW5baV07XG4gICAgICAgICAgICBleHRlbmQobGVmdEJCb3gsIG5vZGUubGVhZiA/IHRvQkJveChjaGlsZCkgOiBjaGlsZC5iYm94KTtcbiAgICAgICAgICAgIG1hcmdpbiArPSBiYm94TWFyZ2luKGxlZnRCQm94KTtcbiAgICAgICAgfVxuXG4gICAgICAgIGZvciAoaSA9IE0gLSBtIC0gMTsgaSA+PSBtOyBpLS0pIHtcbiAgICAgICAgICAgIGNoaWxkID0gbm9kZS5jaGlsZHJlbltpXTtcbiAgICAgICAgICAgIGV4dGVuZChyaWdodEJCb3gsIG5vZGUubGVhZiA/IHRvQkJveChjaGlsZCkgOiBjaGlsZC5iYm94KTtcbiAgICAgICAgICAgIG1hcmdpbiArPSBiYm94TWFyZ2luKHJpZ2h0QkJveCk7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gbWFyZ2luO1xuICAgIH0sXG5cbiAgICBfYWRqdXN0UGFyZW50QkJveGVzOiBmdW5jdGlvbiAoYmJveCwgcGF0aCwgbGV2ZWwpIHtcbiAgICAgICAgLy8gYWRqdXN0IGJib3hlcyBhbG9uZyB0aGUgZ2l2ZW4gdHJlZSBwYXRoXG4gICAgICAgIGZvciAodmFyIGkgPSBsZXZlbDsgaSA+PSAwOyBpLS0pIHtcbiAgICAgICAgICAgIGV4dGVuZChwYXRoW2ldLmJib3gsIGJib3gpO1xuICAgICAgICB9XG4gICAgfSxcblxuICAgIF9jb25kZW5zZTogZnVuY3Rpb24gKHBhdGgpIHtcbiAgICAgICAgLy8gZ28gdGhyb3VnaCB0aGUgcGF0aCwgcmVtb3ZpbmcgZW1wdHkgbm9kZXMgYW5kIHVwZGF0aW5nIGJib3hlc1xuICAgICAgICBmb3IgKHZhciBpID0gcGF0aC5sZW5ndGggLSAxLCBzaWJsaW5nczsgaSA+PSAwOyBpLS0pIHtcbiAgICAgICAgICAgIGlmIChwYXRoW2ldLmNoaWxkcmVuLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgICAgICAgIGlmIChpID4gMCkge1xuICAgICAgICAgICAgICAgICAgICBzaWJsaW5ncyA9IHBhdGhbaSAtIDFdLmNoaWxkcmVuO1xuICAgICAgICAgICAgICAgICAgICBzaWJsaW5ncy5zcGxpY2Uoc2libGluZ3MuaW5kZXhPZihwYXRoW2ldKSwgMSk7XG5cbiAgICAgICAgICAgICAgICB9IGVsc2UgdGhpcy5jbGVhcigpO1xuXG4gICAgICAgICAgICB9IGVsc2UgY2FsY0JCb3gocGF0aFtpXSwgdGhpcy50b0JCb3gpO1xuICAgICAgICB9XG4gICAgfSxcblxuICAgIF9pbml0Rm9ybWF0OiBmdW5jdGlvbiAoZm9ybWF0KSB7XG4gICAgICAgIC8vIGRhdGEgZm9ybWF0IChtaW5YLCBtaW5ZLCBtYXhYLCBtYXhZIGFjY2Vzc29ycylcblxuICAgICAgICAvLyB1c2VzIGV2YWwtdHlwZSBmdW5jdGlvbiBjb21waWxhdGlvbiBpbnN0ZWFkIG9mIGp1c3QgYWNjZXB0aW5nIGEgdG9CQm94IGZ1bmN0aW9uXG4gICAgICAgIC8vIGJlY2F1c2UgdGhlIGFsZ29yaXRobXMgYXJlIHZlcnkgc2Vuc2l0aXZlIHRvIHNvcnRpbmcgZnVuY3Rpb25zIHBlcmZvcm1hbmNlLFxuICAgICAgICAvLyBzbyB0aGV5IHNob3VsZCBiZSBkZWFkIHNpbXBsZSBhbmQgd2l0aG91dCBpbm5lciBjYWxsc1xuXG4gICAgICAgIC8vIGpzaGludCBldmlsOiB0cnVlXG5cbiAgICAgICAgdmFyIGNvbXBhcmVBcnIgPSBbJ3JldHVybiBhJywgJyAtIGInLCAnOyddO1xuXG4gICAgICAgIHRoaXMuY29tcGFyZU1pblggPSBuZXcgRnVuY3Rpb24oJ2EnLCAnYicsIGNvbXBhcmVBcnIuam9pbihmb3JtYXRbMF0pKTtcbiAgICAgICAgdGhpcy5jb21wYXJlTWluWSA9IG5ldyBGdW5jdGlvbignYScsICdiJywgY29tcGFyZUFyci5qb2luKGZvcm1hdFsxXSkpO1xuXG4gICAgICAgIHRoaXMudG9CQm94ID0gbmV3IEZ1bmN0aW9uKCdhJywgJ3JldHVybiBbYScgKyBmb3JtYXQuam9pbignLCBhJykgKyAnXTsnKTtcbiAgICB9XG59O1xuXG5cbi8vIGNhbGN1bGF0ZSBub2RlJ3MgYmJveCBmcm9tIGJib3hlcyBvZiBpdHMgY2hpbGRyZW5cbmZ1bmN0aW9uIGNhbGNCQm94KG5vZGUsIHRvQkJveCkge1xuICAgIG5vZGUuYmJveCA9IGRpc3RCQm94KG5vZGUsIDAsIG5vZGUuY2hpbGRyZW4ubGVuZ3RoLCB0b0JCb3gpO1xufVxuXG4vLyBtaW4gYm91bmRpbmcgcmVjdGFuZ2xlIG9mIG5vZGUgY2hpbGRyZW4gZnJvbSBrIHRvIHAtMVxuZnVuY3Rpb24gZGlzdEJCb3gobm9kZSwgaywgcCwgdG9CQm94KSB7XG4gICAgdmFyIGJib3ggPSBlbXB0eSgpO1xuXG4gICAgZm9yICh2YXIgaSA9IGssIGNoaWxkOyBpIDwgcDsgaSsrKSB7XG4gICAgICAgIGNoaWxkID0gbm9kZS5jaGlsZHJlbltpXTtcbiAgICAgICAgZXh0ZW5kKGJib3gsIG5vZGUubGVhZiA/IHRvQkJveChjaGlsZCkgOiBjaGlsZC5iYm94KTtcbiAgICB9XG5cbiAgICByZXR1cm4gYmJveDtcbn1cblxuZnVuY3Rpb24gZW1wdHkoKSB7IHJldHVybiBbSW5maW5pdHksIEluZmluaXR5LCAtSW5maW5pdHksIC1JbmZpbml0eV07IH1cblxuZnVuY3Rpb24gZXh0ZW5kKGEsIGIpIHtcbiAgICBhWzBdID0gTWF0aC5taW4oYVswXSwgYlswXSk7XG4gICAgYVsxXSA9IE1hdGgubWluKGFbMV0sIGJbMV0pO1xuICAgIGFbMl0gPSBNYXRoLm1heChhWzJdLCBiWzJdKTtcbiAgICBhWzNdID0gTWF0aC5tYXgoYVszXSwgYlszXSk7XG4gICAgcmV0dXJuIGE7XG59XG5cbmZ1bmN0aW9uIGNvbXBhcmVOb2RlTWluWChhLCBiKSB7IHJldHVybiBhLmJib3hbMF0gLSBiLmJib3hbMF07IH1cbmZ1bmN0aW9uIGNvbXBhcmVOb2RlTWluWShhLCBiKSB7IHJldHVybiBhLmJib3hbMV0gLSBiLmJib3hbMV07IH1cblxuZnVuY3Rpb24gYmJveEFyZWEoYSkgICB7IHJldHVybiAoYVsyXSAtIGFbMF0pICogKGFbM10gLSBhWzFdKTsgfVxuZnVuY3Rpb24gYmJveE1hcmdpbihhKSB7IHJldHVybiAoYVsyXSAtIGFbMF0pICsgKGFbM10gLSBhWzFdKTsgfVxuXG5mdW5jdGlvbiBlbmxhcmdlZEFyZWEoYSwgYikge1xuICAgIHJldHVybiAoTWF0aC5tYXgoYlsyXSwgYVsyXSkgLSBNYXRoLm1pbihiWzBdLCBhWzBdKSkgKlxuICAgICAgICAgICAoTWF0aC5tYXgoYlszXSwgYVszXSkgLSBNYXRoLm1pbihiWzFdLCBhWzFdKSk7XG59XG5cbmZ1bmN0aW9uIGludGVyc2VjdGlvbkFyZWEoYSwgYikge1xuICAgIHZhciBtaW5YID0gTWF0aC5tYXgoYVswXSwgYlswXSksXG4gICAgICAgIG1pblkgPSBNYXRoLm1heChhWzFdLCBiWzFdKSxcbiAgICAgICAgbWF4WCA9IE1hdGgubWluKGFbMl0sIGJbMl0pLFxuICAgICAgICBtYXhZID0gTWF0aC5taW4oYVszXSwgYlszXSk7XG5cbiAgICByZXR1cm4gTWF0aC5tYXgoMCwgbWF4WCAtIG1pblgpICpcbiAgICAgICAgICAgTWF0aC5tYXgoMCwgbWF4WSAtIG1pblkpO1xufVxuXG5mdW5jdGlvbiBjb250YWlucyhhLCBiKSB7XG4gICAgcmV0dXJuIGFbMF0gPD0gYlswXSAmJlxuICAgICAgICAgICBhWzFdIDw9IGJbMV0gJiZcbiAgICAgICAgICAgYlsyXSA8PSBhWzJdICYmXG4gICAgICAgICAgIGJbM10gPD0gYVszXTtcbn1cblxuZnVuY3Rpb24gaW50ZXJzZWN0cyhhLCBiKSB7XG4gICAgcmV0dXJuIGJbMF0gPD0gYVsyXSAmJlxuICAgICAgICAgICBiWzFdIDw9IGFbM10gJiZcbiAgICAgICAgICAgYlsyXSA+PSBhWzBdICYmXG4gICAgICAgICAgIGJbM10gPj0gYVsxXTtcbn1cblxuLy8gc29ydCBhbiBhcnJheSBzbyB0aGF0IGl0ZW1zIGNvbWUgaW4gZ3JvdXBzIG9mIG4gdW5zb3J0ZWQgaXRlbXMsIHdpdGggZ3JvdXBzIHNvcnRlZCBiZXR3ZWVuIGVhY2ggb3RoZXI7XG4vLyBjb21iaW5lcyBzZWxlY3Rpb24gYWxnb3JpdGhtIHdpdGggYmluYXJ5IGRpdmlkZSAmIGNvbnF1ZXIgYXBwcm9hY2hcblxuZnVuY3Rpb24gbXVsdGlTZWxlY3QoYXJyLCBsZWZ0LCByaWdodCwgbiwgY29tcGFyZSkge1xuICAgIHZhciBzdGFjayA9IFtsZWZ0LCByaWdodF0sXG4gICAgICAgIG1pZDtcblxuICAgIHdoaWxlIChzdGFjay5sZW5ndGgpIHtcbiAgICAgICAgcmlnaHQgPSBzdGFjay5wb3AoKTtcbiAgICAgICAgbGVmdCA9IHN0YWNrLnBvcCgpO1xuXG4gICAgICAgIGlmIChyaWdodCAtIGxlZnQgPD0gbikgY29udGludWU7XG5cbiAgICAgICAgbWlkID0gbGVmdCArIE1hdGguY2VpbCgocmlnaHQgLSBsZWZ0KSAvIG4gLyAyKSAqIG47XG4gICAgICAgIHNlbGVjdChhcnIsIGxlZnQsIHJpZ2h0LCBtaWQsIGNvbXBhcmUpO1xuXG4gICAgICAgIHN0YWNrLnB1c2gobGVmdCwgbWlkLCBtaWQsIHJpZ2h0KTtcbiAgICB9XG59XG5cbi8vIEZsb3lkLVJpdmVzdCBzZWxlY3Rpb24gYWxnb3JpdGhtOlxuLy8gc29ydCBhbiBhcnJheSBiZXR3ZWVuIGxlZnQgYW5kIHJpZ2h0IChpbmNsdXNpdmUpIHNvIHRoYXQgdGhlIHNtYWxsZXN0IGsgZWxlbWVudHMgY29tZSBmaXJzdCAodW5vcmRlcmVkKVxuZnVuY3Rpb24gc2VsZWN0KGFyciwgbGVmdCwgcmlnaHQsIGssIGNvbXBhcmUpIHtcbiAgICB2YXIgbiwgaSwgeiwgcywgc2QsIG5ld0xlZnQsIG5ld1JpZ2h0LCB0LCBqO1xuXG4gICAgd2hpbGUgKHJpZ2h0ID4gbGVmdCkge1xuICAgICAgICBpZiAocmlnaHQgLSBsZWZ0ID4gNjAwKSB7XG4gICAgICAgICAgICBuID0gcmlnaHQgLSBsZWZ0ICsgMTtcbiAgICAgICAgICAgIGkgPSBrIC0gbGVmdCArIDE7XG4gICAgICAgICAgICB6ID0gTWF0aC5sb2cobik7XG4gICAgICAgICAgICBzID0gMC41ICogTWF0aC5leHAoMiAqIHogLyAzKTtcbiAgICAgICAgICAgIHNkID0gMC41ICogTWF0aC5zcXJ0KHogKiBzICogKG4gLSBzKSAvIG4pICogKGkgLSBuIC8gMiA8IDAgPyAtMSA6IDEpO1xuICAgICAgICAgICAgbmV3TGVmdCA9IE1hdGgubWF4KGxlZnQsIE1hdGguZmxvb3IoayAtIGkgKiBzIC8gbiArIHNkKSk7XG4gICAgICAgICAgICBuZXdSaWdodCA9IE1hdGgubWluKHJpZ2h0LCBNYXRoLmZsb29yKGsgKyAobiAtIGkpICogcyAvIG4gKyBzZCkpO1xuICAgICAgICAgICAgc2VsZWN0KGFyciwgbmV3TGVmdCwgbmV3UmlnaHQsIGssIGNvbXBhcmUpO1xuICAgICAgICB9XG5cbiAgICAgICAgdCA9IGFycltrXTtcbiAgICAgICAgaSA9IGxlZnQ7XG4gICAgICAgIGogPSByaWdodDtcblxuICAgICAgICBzd2FwKGFyciwgbGVmdCwgayk7XG4gICAgICAgIGlmIChjb21wYXJlKGFycltyaWdodF0sIHQpID4gMCkgc3dhcChhcnIsIGxlZnQsIHJpZ2h0KTtcblxuICAgICAgICB3aGlsZSAoaSA8IGopIHtcbiAgICAgICAgICAgIHN3YXAoYXJyLCBpLCBqKTtcbiAgICAgICAgICAgIGkrKztcbiAgICAgICAgICAgIGotLTtcbiAgICAgICAgICAgIHdoaWxlIChjb21wYXJlKGFycltpXSwgdCkgPCAwKSBpKys7XG4gICAgICAgICAgICB3aGlsZSAoY29tcGFyZShhcnJbal0sIHQpID4gMCkgai0tO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGNvbXBhcmUoYXJyW2xlZnRdLCB0KSA9PT0gMCkgc3dhcChhcnIsIGxlZnQsIGopO1xuICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgIGorKztcbiAgICAgICAgICAgIHN3YXAoYXJyLCBqLCByaWdodCk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoaiA8PSBrKSBsZWZ0ID0gaiArIDE7XG4gICAgICAgIGlmIChrIDw9IGopIHJpZ2h0ID0gaiAtIDE7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBzd2FwKGFyciwgaSwgaikge1xuICAgIHZhciB0bXAgPSBhcnJbaV07XG4gICAgYXJyW2ldID0gYXJyW2pdO1xuICAgIGFycltqXSA9IHRtcDtcbn1cblxuXG4vLyBleHBvcnQgYXMgQU1EL0NvbW1vbkpTIG1vZHVsZSBvciBnbG9iYWwgdmFyaWFibGVcbmlmICh0eXBlb2YgZGVmaW5lID09PSAnZnVuY3Rpb24nICYmIGRlZmluZS5hbWQpIGRlZmluZSgncmJ1c2gnLCBmdW5jdGlvbigpIHsgcmV0dXJuIHJidXNoOyB9KTtcbmVsc2UgaWYgKHR5cGVvZiBtb2R1bGUgIT09ICd1bmRlZmluZWQnKSBtb2R1bGUuZXhwb3J0cyA9IHJidXNoO1xuZWxzZSBpZiAodHlwZW9mIHNlbGYgIT09ICd1bmRlZmluZWQnKSBzZWxmLnJidXNoID0gcmJ1c2g7XG5lbHNlIHdpbmRvdy5yYnVzaCA9IHJidXNoO1xuXG59KSgpO1xuIl19