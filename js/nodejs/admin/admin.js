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
 * Due to various browser bugs, sometimes the Object implementation will be used even
 * when the browser supports typed arrays.
 *
 * Note:
 *
 *   - Firefox 4-29 lacks support for adding new properties to `Uint8Array` instances,
 *     See: https://bugzilla.mozilla.org/show_bug.cgi?id=695438.
 *
 *   - Safari 5-7 lacks support for changing the `Object.prototype.constructor` property
 *     on objects.
 *
 *   - Chrome 9-10 is missing the `TypedArray.prototype.subarray` function.
 *
 *   - IE10 has a broken `TypedArray.prototype.subarray` function which returns arrays of
 *     incorrect length in some situations.

 * We detect these buggy browsers and set `Buffer.TYPED_ARRAY_SUPPORT` to `false` so they
 * get the Object implementation, which is slower but behaves correctly.
 */
Buffer.TYPED_ARRAY_SUPPORT = (function () {
  function Bar () {}
  try {
    var arr = new Uint8Array(1)
    arr.foo = function () { return 42 }
    arr.constructor = Bar
    return arr.foo() === 42 && // typed array instances can be augmented
        arr.constructor === Bar && // constructor can be set
        typeof arr.subarray === 'function' && // chrome 9-10 lack `subarray`
        arr.subarray(1, 1).byteLength === 0 // ie10 has broken `subarray`
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

  if (typeof ArrayBuffer !== 'undefined') {
    if (object.buffer instanceof ArrayBuffer) {
      return fromTypedArray(that, object)
    }
    if (object instanceof ArrayBuffer) {
      return fromArrayBuffer(that, object)
    }
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

function fromArrayBuffer (that, array) {
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    // Return an augmented `Uint8Array` instance, for best performance
    array.byteLength
    that = Buffer._augment(new Uint8Array(array))
  } else {
    // Fallback: Return an object instance of the Buffer class
    that = fromTypedArray(that, new Uint8Array(array))
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

// `get` is deprecated
Buffer.prototype.get = function get (offset) {
  console.log('.get() is deprecated. Access using array indexes instead.')
  return this.readUInt8(offset)
}

// `set` is deprecated
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
  end = Math.min(buf.length, end)
  var firstByte
  var secondByte
  var thirdByte
  var fourthByte
  var bytesPerSequence
  var tempCodePoint
  var codePoint
  var res = []
  var i = start

  for (; i < end; i += bytesPerSequence) {
    firstByte = buf[i]
    codePoint = 0xFFFD

    if (firstByte > 0xEF) {
      bytesPerSequence = 4
    } else if (firstByte > 0xDF) {
      bytesPerSequence = 3
    } else if (firstByte > 0xBF) {
      bytesPerSequence = 2
    } else {
      bytesPerSequence = 1
    }

    if (i + bytesPerSequence <= end) {
      switch (bytesPerSequence) {
        case 1:
          if (firstByte < 0x80) {
            codePoint = firstByte
          }
          break
        case 2:
          secondByte = buf[i + 1]
          if ((secondByte & 0xC0) === 0x80) {
            tempCodePoint = (firstByte & 0x1F) << 0x6 | (secondByte & 0x3F)
            if (tempCodePoint > 0x7F) {
              codePoint = tempCodePoint
            }
          }
          break
        case 3:
          secondByte = buf[i + 1]
          thirdByte = buf[i + 2]
          if ((secondByte & 0xC0) === 0x80 && (thirdByte & 0xC0) === 0x80) {
            tempCodePoint = (firstByte & 0xF) << 0xC | (secondByte & 0x3F) << 0x6 | (thirdByte & 0x3F)
            if (tempCodePoint > 0x7FF && (tempCodePoint < 0xD800 || tempCodePoint > 0xDFFF)) {
              codePoint = tempCodePoint
            }
          }
          break
        case 4:
          secondByte = buf[i + 1]
          thirdByte = buf[i + 2]
          fourthByte = buf[i + 3]
          if ((secondByte & 0xC0) === 0x80 && (thirdByte & 0xC0) === 0x80 && (fourthByte & 0xC0) === 0x80) {
            tempCodePoint = (firstByte & 0xF) << 0x12 | (secondByte & 0x3F) << 0xC | (thirdByte & 0x3F) << 0x6 | (fourthByte & 0x3F)
            if (tempCodePoint > 0xFFFF && tempCodePoint < 0x110000) {
              codePoint = tempCodePoint
            }
          }
      }
    }

    if (codePoint === 0xFFFD) {
      // we generated an invalid codePoint so make sure to only advance by 1 byte
      bytesPerSequence = 1
    } else if (codePoint > 0xFFFF) {
      // encode to utf16 (surrogate pair dance)
      codePoint -= 0x10000
      res.push(codePoint >>> 10 & 0x3FF | 0xD800)
      codePoint = 0xDC00 | codePoint & 0x3FF
    }

    res.push(codePoint)
  }

  return String.fromCharCode.apply(String, res)
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
  var i

  if (this === target && start < targetStart && targetStart < end) {
    // descending copy from end
    for (i = len - 1; i >= 0; i--) {
      target[i + targetStart] = this[i + start]
    }
  } else if (len < 1000 || !Buffer.TYPED_ARRAY_SUPPORT) {
    // ascending copy from start
    for (i = 0; i < len; i++) {
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

  // deprecated
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

var INVALID_BASE64_RE = /[^+\/0-9A-Za-z-_]/g

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

  for (var i = 0; i < length; i++) {
    codePoint = string.charCodeAt(i)

    // is surrogate component
    if (codePoint > 0xD7FF && codePoint < 0xE000) {
      // last char was a lead
      if (!leadSurrogate) {
        // no lead yet
        if (codePoint > 0xDBFF) {
          // unexpected trail
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
          continue

        } else if (i + 1 === length) {
          // unpaired lead
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
          continue
        }

        // valid lead
        leadSurrogate = codePoint

        continue
      }

      // 2 leads in a row
      if (codePoint < 0xDC00) {
        if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
        leadSurrogate = codePoint
        continue
      }

      // valid surrogate pair
      codePoint = leadSurrogate - 0xD800 << 10 | codePoint - 0xDC00 | 0x10000

    } else if (leadSurrogate) {
      // valid bmp char, but last char was a lead
      if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
    }

    leadSurrogate = null

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
    } else if (codePoint < 0x110000) {
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
		gpsInaccuracy : 30,						 //TODO 13 min ? 
		speedAndAccelerationAverageDegree : 2,	// calculation based on N states (average) (MIN 2)
		displayDelay : 90,						// display delay in SECONDS
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
			init : false
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
			if (minf == null && mminf == null) 
			{
				console.error("MMINF NULL > DISCARD "+this.code+" | "+this.deviceId);
				this.setIsDiscarded(true);
				state.setElapsed(lelp);
				this.addState(state);
				return;
			}

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
//# sourceMappingURL=data:application/json;charset:utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIkM6L1VzZXJzL3J1bWVuL0FwcERhdGEvUm9hbWluZy9ucG0vbm9kZV9tb2R1bGVzL2Jyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2Jyb3dzZXItcGFjay9fcHJlbHVkZS5qcyIsIkM6L1VzZXJzL3J1bWVuL0FwcERhdGEvUm9hbWluZy9ucG0vbm9kZV9tb2R1bGVzL2Jyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2J1ZmZlci9pbmRleC5qcyIsIkM6L1VzZXJzL3J1bWVuL0FwcERhdGEvUm9hbWluZy9ucG0vbm9kZV9tb2R1bGVzL2Jyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2J1ZmZlci9ub2RlX21vZHVsZXMvYmFzZTY0LWpzL2xpYi9iNjQuanMiLCJDOi9Vc2Vycy9ydW1lbi9BcHBEYXRhL1JvYW1pbmcvbnBtL25vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9idWZmZXIvbm9kZV9tb2R1bGVzL2llZWU3NTQvaW5kZXguanMiLCJDOi9Vc2Vycy9ydW1lbi9BcHBEYXRhL1JvYW1pbmcvbnBtL25vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9idWZmZXIvbm9kZV9tb2R1bGVzL2lzLWFycmF5L2luZGV4LmpzIiwiQzovVXNlcnMvcnVtZW4vQXBwRGF0YS9Sb2FtaW5nL25wbS9ub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvcHJvY2Vzcy9icm93c2VyLmpzIiwianMvYXBwL0FkbWluLmpzIiwianMvYXBwL0NvbmZpZy5qcyIsImpzL2FwcC9HVUkuanMiLCJqcy9hcHAvTGl2ZVN0cmVhbS5qcyIsImpzL2FwcC9QYXJ0aWNpcGFudC5qcyIsImpzL2FwcC9Qb2ludC5qcyIsImpzL2FwcC9TdHlsZXMuanMiLCJqcy9hcHAvVHJhY2suanMiLCJqcy9hcHAvVXRpbHMuanMiLCJub2RlX21vZHVsZXMvam9vc2Uvam9vc2UtYWxsLmpzIiwibm9kZV9tb2R1bGVzL2tsZC1pbnRlcnNlY3Rpb25zL2luZGV4LmpzIiwibm9kZV9tb2R1bGVzL2tsZC1pbnRlcnNlY3Rpb25zL2xpYi9JbnRlcnNlY3Rpb24uanMiLCJub2RlX21vZHVsZXMva2xkLWludGVyc2VjdGlvbnMvbGliL0ludGVyc2VjdGlvblBhcmFtcy5qcyIsIm5vZGVfbW9kdWxlcy9rbGQtaW50ZXJzZWN0aW9ucy9ub2RlX21vZHVsZXMva2xkLWFmZmluZS9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9rbGQtaW50ZXJzZWN0aW9ucy9ub2RlX21vZHVsZXMva2xkLWFmZmluZS9saWIvTWF0cml4MkQuanMiLCJub2RlX21vZHVsZXMva2xkLWludGVyc2VjdGlvbnMvbm9kZV9tb2R1bGVzL2tsZC1hZmZpbmUvbGliL1BvaW50MkQuanMiLCJub2RlX21vZHVsZXMva2xkLWludGVyc2VjdGlvbnMvbm9kZV9tb2R1bGVzL2tsZC1hZmZpbmUvbGliL1ZlY3RvcjJELmpzIiwibm9kZV9tb2R1bGVzL2tsZC1pbnRlcnNlY3Rpb25zL25vZGVfbW9kdWxlcy9rbGQtcG9seW5vbWlhbC9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9rbGQtaW50ZXJzZWN0aW9ucy9ub2RlX21vZHVsZXMva2xkLXBvbHlub21pYWwvbGliL1BvbHlub21pYWwuanMiLCJub2RlX21vZHVsZXMva2xkLWludGVyc2VjdGlvbnMvbm9kZV9tb2R1bGVzL2tsZC1wb2x5bm9taWFsL2xpYi9TcXJ0UG9seW5vbWlhbC5qcyIsIm5vZGVfbW9kdWxlcy9yYnVzaC9yYnVzaC5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTtBQ0FBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNoL0NBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDNUhBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BGQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNqQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDMUZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDeFhBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNwSEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdmpCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQy9IQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDNXlCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN2Q0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM1aUJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7OztBQzVaQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7OztBQzlqQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7OztBQ2pwR0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNQQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2x1REE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2hDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDTEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN4YUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMvS0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDMU9BO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDSkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdG5CQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM1REE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EiLCJmaWxlIjoiZ2VuZXJhdGVkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXNDb250ZW50IjpbIihmdW5jdGlvbiBlKHQsbixyKXtmdW5jdGlvbiBzKG8sdSl7aWYoIW5bb10pe2lmKCF0W29dKXt2YXIgYT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2lmKCF1JiZhKXJldHVybiBhKG8sITApO2lmKGkpcmV0dXJuIGkobywhMCk7dmFyIGY9bmV3IEVycm9yKFwiQ2Fubm90IGZpbmQgbW9kdWxlICdcIitvK1wiJ1wiKTt0aHJvdyBmLmNvZGU9XCJNT0RVTEVfTk9UX0ZPVU5EXCIsZn12YXIgbD1uW29dPXtleHBvcnRzOnt9fTt0W29dWzBdLmNhbGwobC5leHBvcnRzLGZ1bmN0aW9uKGUpe3ZhciBuPXRbb11bMV1bZV07cmV0dXJuIHMobj9uOmUpfSxsLGwuZXhwb3J0cyxlLHQsbixyKX1yZXR1cm4gbltvXS5leHBvcnRzfXZhciBpPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7Zm9yKHZhciBvPTA7bzxyLmxlbmd0aDtvKyspcyhyW29dKTtyZXR1cm4gc30pIiwiLyohXG4gKiBUaGUgYnVmZmVyIG1vZHVsZSBmcm9tIG5vZGUuanMsIGZvciB0aGUgYnJvd3Nlci5cbiAqXG4gKiBAYXV0aG9yICAgRmVyb3NzIEFib3VraGFkaWplaCA8ZmVyb3NzQGZlcm9zcy5vcmc+IDxodHRwOi8vZmVyb3NzLm9yZz5cbiAqIEBsaWNlbnNlICBNSVRcbiAqL1xuXG52YXIgYmFzZTY0ID0gcmVxdWlyZSgnYmFzZTY0LWpzJylcbnZhciBpZWVlNzU0ID0gcmVxdWlyZSgnaWVlZTc1NCcpXG52YXIgaXNBcnJheSA9IHJlcXVpcmUoJ2lzLWFycmF5JylcblxuZXhwb3J0cy5CdWZmZXIgPSBCdWZmZXJcbmV4cG9ydHMuU2xvd0J1ZmZlciA9IFNsb3dCdWZmZXJcbmV4cG9ydHMuSU5TUEVDVF9NQVhfQllURVMgPSA1MFxuQnVmZmVyLnBvb2xTaXplID0gODE5MiAvLyBub3QgdXNlZCBieSB0aGlzIGltcGxlbWVudGF0aW9uXG5cbnZhciByb290UGFyZW50ID0ge31cblxuLyoqXG4gKiBJZiBgQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlRgOlxuICogICA9PT0gdHJ1ZSAgICBVc2UgVWludDhBcnJheSBpbXBsZW1lbnRhdGlvbiAoZmFzdGVzdClcbiAqICAgPT09IGZhbHNlICAgVXNlIE9iamVjdCBpbXBsZW1lbnRhdGlvbiAobW9zdCBjb21wYXRpYmxlLCBldmVuIElFNilcbiAqXG4gKiBCcm93c2VycyB0aGF0IHN1cHBvcnQgdHlwZWQgYXJyYXlzIGFyZSBJRSAxMCssIEZpcmVmb3ggNCssIENocm9tZSA3KywgU2FmYXJpIDUuMSssXG4gKiBPcGVyYSAxMS42KywgaU9TIDQuMisuXG4gKlxuICogRHVlIHRvIHZhcmlvdXMgYnJvd3NlciBidWdzLCBzb21ldGltZXMgdGhlIE9iamVjdCBpbXBsZW1lbnRhdGlvbiB3aWxsIGJlIHVzZWQgZXZlblxuICogd2hlbiB0aGUgYnJvd3NlciBzdXBwb3J0cyB0eXBlZCBhcnJheXMuXG4gKlxuICogTm90ZTpcbiAqXG4gKiAgIC0gRmlyZWZveCA0LTI5IGxhY2tzIHN1cHBvcnQgZm9yIGFkZGluZyBuZXcgcHJvcGVydGllcyB0byBgVWludDhBcnJheWAgaW5zdGFuY2VzLFxuICogICAgIFNlZTogaHR0cHM6Ly9idWd6aWxsYS5tb3ppbGxhLm9yZy9zaG93X2J1Zy5jZ2k/aWQ9Njk1NDM4LlxuICpcbiAqICAgLSBTYWZhcmkgNS03IGxhY2tzIHN1cHBvcnQgZm9yIGNoYW5naW5nIHRoZSBgT2JqZWN0LnByb3RvdHlwZS5jb25zdHJ1Y3RvcmAgcHJvcGVydHlcbiAqICAgICBvbiBvYmplY3RzLlxuICpcbiAqICAgLSBDaHJvbWUgOS0xMCBpcyBtaXNzaW5nIHRoZSBgVHlwZWRBcnJheS5wcm90b3R5cGUuc3ViYXJyYXlgIGZ1bmN0aW9uLlxuICpcbiAqICAgLSBJRTEwIGhhcyBhIGJyb2tlbiBgVHlwZWRBcnJheS5wcm90b3R5cGUuc3ViYXJyYXlgIGZ1bmN0aW9uIHdoaWNoIHJldHVybnMgYXJyYXlzIG9mXG4gKiAgICAgaW5jb3JyZWN0IGxlbmd0aCBpbiBzb21lIHNpdHVhdGlvbnMuXG5cbiAqIFdlIGRldGVjdCB0aGVzZSBidWdneSBicm93c2VycyBhbmQgc2V0IGBCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVGAgdG8gYGZhbHNlYCBzbyB0aGV5XG4gKiBnZXQgdGhlIE9iamVjdCBpbXBsZW1lbnRhdGlvbiwgd2hpY2ggaXMgc2xvd2VyIGJ1dCBiZWhhdmVzIGNvcnJlY3RseS5cbiAqL1xuQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQgPSAoZnVuY3Rpb24gKCkge1xuICBmdW5jdGlvbiBCYXIgKCkge31cbiAgdHJ5IHtcbiAgICB2YXIgYXJyID0gbmV3IFVpbnQ4QXJyYXkoMSlcbiAgICBhcnIuZm9vID0gZnVuY3Rpb24gKCkgeyByZXR1cm4gNDIgfVxuICAgIGFyci5jb25zdHJ1Y3RvciA9IEJhclxuICAgIHJldHVybiBhcnIuZm9vKCkgPT09IDQyICYmIC8vIHR5cGVkIGFycmF5IGluc3RhbmNlcyBjYW4gYmUgYXVnbWVudGVkXG4gICAgICAgIGFyci5jb25zdHJ1Y3RvciA9PT0gQmFyICYmIC8vIGNvbnN0cnVjdG9yIGNhbiBiZSBzZXRcbiAgICAgICAgdHlwZW9mIGFyci5zdWJhcnJheSA9PT0gJ2Z1bmN0aW9uJyAmJiAvLyBjaHJvbWUgOS0xMCBsYWNrIGBzdWJhcnJheWBcbiAgICAgICAgYXJyLnN1YmFycmF5KDEsIDEpLmJ5dGVMZW5ndGggPT09IDAgLy8gaWUxMCBoYXMgYnJva2VuIGBzdWJhcnJheWBcbiAgfSBjYXRjaCAoZSkge1xuICAgIHJldHVybiBmYWxzZVxuICB9XG59KSgpXG5cbmZ1bmN0aW9uIGtNYXhMZW5ndGggKCkge1xuICByZXR1cm4gQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlRcbiAgICA/IDB4N2ZmZmZmZmZcbiAgICA6IDB4M2ZmZmZmZmZcbn1cblxuLyoqXG4gKiBDbGFzczogQnVmZmVyXG4gKiA9PT09PT09PT09PT09XG4gKlxuICogVGhlIEJ1ZmZlciBjb25zdHJ1Y3RvciByZXR1cm5zIGluc3RhbmNlcyBvZiBgVWludDhBcnJheWAgdGhhdCBhcmUgYXVnbWVudGVkXG4gKiB3aXRoIGZ1bmN0aW9uIHByb3BlcnRpZXMgZm9yIGFsbCB0aGUgbm9kZSBgQnVmZmVyYCBBUEkgZnVuY3Rpb25zLiBXZSB1c2VcbiAqIGBVaW50OEFycmF5YCBzbyB0aGF0IHNxdWFyZSBicmFja2V0IG5vdGF0aW9uIHdvcmtzIGFzIGV4cGVjdGVkIC0tIGl0IHJldHVybnNcbiAqIGEgc2luZ2xlIG9jdGV0LlxuICpcbiAqIEJ5IGF1Z21lbnRpbmcgdGhlIGluc3RhbmNlcywgd2UgY2FuIGF2b2lkIG1vZGlmeWluZyB0aGUgYFVpbnQ4QXJyYXlgXG4gKiBwcm90b3R5cGUuXG4gKi9cbmZ1bmN0aW9uIEJ1ZmZlciAoYXJnKSB7XG4gIGlmICghKHRoaXMgaW5zdGFuY2VvZiBCdWZmZXIpKSB7XG4gICAgLy8gQXZvaWQgZ29pbmcgdGhyb3VnaCBhbiBBcmd1bWVudHNBZGFwdG9yVHJhbXBvbGluZSBpbiB0aGUgY29tbW9uIGNhc2UuXG4gICAgaWYgKGFyZ3VtZW50cy5sZW5ndGggPiAxKSByZXR1cm4gbmV3IEJ1ZmZlcihhcmcsIGFyZ3VtZW50c1sxXSlcbiAgICByZXR1cm4gbmV3IEJ1ZmZlcihhcmcpXG4gIH1cblxuICB0aGlzLmxlbmd0aCA9IDBcbiAgdGhpcy5wYXJlbnQgPSB1bmRlZmluZWRcblxuICAvLyBDb21tb24gY2FzZS5cbiAgaWYgKHR5cGVvZiBhcmcgPT09ICdudW1iZXInKSB7XG4gICAgcmV0dXJuIGZyb21OdW1iZXIodGhpcywgYXJnKVxuICB9XG5cbiAgLy8gU2xpZ2h0bHkgbGVzcyBjb21tb24gY2FzZS5cbiAgaWYgKHR5cGVvZiBhcmcgPT09ICdzdHJpbmcnKSB7XG4gICAgcmV0dXJuIGZyb21TdHJpbmcodGhpcywgYXJnLCBhcmd1bWVudHMubGVuZ3RoID4gMSA/IGFyZ3VtZW50c1sxXSA6ICd1dGY4JylcbiAgfVxuXG4gIC8vIFVudXN1YWwuXG4gIHJldHVybiBmcm9tT2JqZWN0KHRoaXMsIGFyZylcbn1cblxuZnVuY3Rpb24gZnJvbU51bWJlciAodGhhdCwgbGVuZ3RoKSB7XG4gIHRoYXQgPSBhbGxvY2F0ZSh0aGF0LCBsZW5ndGggPCAwID8gMCA6IGNoZWNrZWQobGVuZ3RoKSB8IDApXG4gIGlmICghQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbmd0aDsgaSsrKSB7XG4gICAgICB0aGF0W2ldID0gMFxuICAgIH1cbiAgfVxuICByZXR1cm4gdGhhdFxufVxuXG5mdW5jdGlvbiBmcm9tU3RyaW5nICh0aGF0LCBzdHJpbmcsIGVuY29kaW5nKSB7XG4gIGlmICh0eXBlb2YgZW5jb2RpbmcgIT09ICdzdHJpbmcnIHx8IGVuY29kaW5nID09PSAnJykgZW5jb2RpbmcgPSAndXRmOCdcblxuICAvLyBBc3N1bXB0aW9uOiBieXRlTGVuZ3RoKCkgcmV0dXJuIHZhbHVlIGlzIGFsd2F5cyA8IGtNYXhMZW5ndGguXG4gIHZhciBsZW5ndGggPSBieXRlTGVuZ3RoKHN0cmluZywgZW5jb2RpbmcpIHwgMFxuICB0aGF0ID0gYWxsb2NhdGUodGhhdCwgbGVuZ3RoKVxuXG4gIHRoYXQud3JpdGUoc3RyaW5nLCBlbmNvZGluZylcbiAgcmV0dXJuIHRoYXRcbn1cblxuZnVuY3Rpb24gZnJvbU9iamVjdCAodGhhdCwgb2JqZWN0KSB7XG4gIGlmIChCdWZmZXIuaXNCdWZmZXIob2JqZWN0KSkgcmV0dXJuIGZyb21CdWZmZXIodGhhdCwgb2JqZWN0KVxuXG4gIGlmIChpc0FycmF5KG9iamVjdCkpIHJldHVybiBmcm9tQXJyYXkodGhhdCwgb2JqZWN0KVxuXG4gIGlmIChvYmplY3QgPT0gbnVsbCkge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ211c3Qgc3RhcnQgd2l0aCBudW1iZXIsIGJ1ZmZlciwgYXJyYXkgb3Igc3RyaW5nJylcbiAgfVxuXG4gIGlmICh0eXBlb2YgQXJyYXlCdWZmZXIgIT09ICd1bmRlZmluZWQnKSB7XG4gICAgaWYgKG9iamVjdC5idWZmZXIgaW5zdGFuY2VvZiBBcnJheUJ1ZmZlcikge1xuICAgICAgcmV0dXJuIGZyb21UeXBlZEFycmF5KHRoYXQsIG9iamVjdClcbiAgICB9XG4gICAgaWYgKG9iamVjdCBpbnN0YW5jZW9mIEFycmF5QnVmZmVyKSB7XG4gICAgICByZXR1cm4gZnJvbUFycmF5QnVmZmVyKHRoYXQsIG9iamVjdClcbiAgICB9XG4gIH1cblxuICBpZiAob2JqZWN0Lmxlbmd0aCkgcmV0dXJuIGZyb21BcnJheUxpa2UodGhhdCwgb2JqZWN0KVxuXG4gIHJldHVybiBmcm9tSnNvbk9iamVjdCh0aGF0LCBvYmplY3QpXG59XG5cbmZ1bmN0aW9uIGZyb21CdWZmZXIgKHRoYXQsIGJ1ZmZlcikge1xuICB2YXIgbGVuZ3RoID0gY2hlY2tlZChidWZmZXIubGVuZ3RoKSB8IDBcbiAgdGhhdCA9IGFsbG9jYXRlKHRoYXQsIGxlbmd0aClcbiAgYnVmZmVyLmNvcHkodGhhdCwgMCwgMCwgbGVuZ3RoKVxuICByZXR1cm4gdGhhdFxufVxuXG5mdW5jdGlvbiBmcm9tQXJyYXkgKHRoYXQsIGFycmF5KSB7XG4gIHZhciBsZW5ndGggPSBjaGVja2VkKGFycmF5Lmxlbmd0aCkgfCAwXG4gIHRoYXQgPSBhbGxvY2F0ZSh0aGF0LCBsZW5ndGgpXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuZ3RoOyBpICs9IDEpIHtcbiAgICB0aGF0W2ldID0gYXJyYXlbaV0gJiAyNTVcbiAgfVxuICByZXR1cm4gdGhhdFxufVxuXG4vLyBEdXBsaWNhdGUgb2YgZnJvbUFycmF5KCkgdG8ga2VlcCBmcm9tQXJyYXkoKSBtb25vbW9ycGhpYy5cbmZ1bmN0aW9uIGZyb21UeXBlZEFycmF5ICh0aGF0LCBhcnJheSkge1xuICB2YXIgbGVuZ3RoID0gY2hlY2tlZChhcnJheS5sZW5ndGgpIHwgMFxuICB0aGF0ID0gYWxsb2NhdGUodGhhdCwgbGVuZ3RoKVxuICAvLyBUcnVuY2F0aW5nIHRoZSBlbGVtZW50cyBpcyBwcm9iYWJseSBub3Qgd2hhdCBwZW9wbGUgZXhwZWN0IGZyb20gdHlwZWRcbiAgLy8gYXJyYXlzIHdpdGggQllURVNfUEVSX0VMRU1FTlQgPiAxIGJ1dCBpdCdzIGNvbXBhdGlibGUgd2l0aCB0aGUgYmVoYXZpb3JcbiAgLy8gb2YgdGhlIG9sZCBCdWZmZXIgY29uc3RydWN0b3IuXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuZ3RoOyBpICs9IDEpIHtcbiAgICB0aGF0W2ldID0gYXJyYXlbaV0gJiAyNTVcbiAgfVxuICByZXR1cm4gdGhhdFxufVxuXG5mdW5jdGlvbiBmcm9tQXJyYXlCdWZmZXIgKHRoYXQsIGFycmF5KSB7XG4gIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIC8vIFJldHVybiBhbiBhdWdtZW50ZWQgYFVpbnQ4QXJyYXlgIGluc3RhbmNlLCBmb3IgYmVzdCBwZXJmb3JtYW5jZVxuICAgIGFycmF5LmJ5dGVMZW5ndGhcbiAgICB0aGF0ID0gQnVmZmVyLl9hdWdtZW50KG5ldyBVaW50OEFycmF5KGFycmF5KSlcbiAgfSBlbHNlIHtcbiAgICAvLyBGYWxsYmFjazogUmV0dXJuIGFuIG9iamVjdCBpbnN0YW5jZSBvZiB0aGUgQnVmZmVyIGNsYXNzXG4gICAgdGhhdCA9IGZyb21UeXBlZEFycmF5KHRoYXQsIG5ldyBVaW50OEFycmF5KGFycmF5KSlcbiAgfVxuICByZXR1cm4gdGhhdFxufVxuXG5mdW5jdGlvbiBmcm9tQXJyYXlMaWtlICh0aGF0LCBhcnJheSkge1xuICB2YXIgbGVuZ3RoID0gY2hlY2tlZChhcnJheS5sZW5ndGgpIHwgMFxuICB0aGF0ID0gYWxsb2NhdGUodGhhdCwgbGVuZ3RoKVxuICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbmd0aDsgaSArPSAxKSB7XG4gICAgdGhhdFtpXSA9IGFycmF5W2ldICYgMjU1XG4gIH1cbiAgcmV0dXJuIHRoYXRcbn1cblxuLy8gRGVzZXJpYWxpemUgeyB0eXBlOiAnQnVmZmVyJywgZGF0YTogWzEsMiwzLC4uLl0gfSBpbnRvIGEgQnVmZmVyIG9iamVjdC5cbi8vIFJldHVybnMgYSB6ZXJvLWxlbmd0aCBidWZmZXIgZm9yIGlucHV0cyB0aGF0IGRvbid0IGNvbmZvcm0gdG8gdGhlIHNwZWMuXG5mdW5jdGlvbiBmcm9tSnNvbk9iamVjdCAodGhhdCwgb2JqZWN0KSB7XG4gIHZhciBhcnJheVxuICB2YXIgbGVuZ3RoID0gMFxuXG4gIGlmIChvYmplY3QudHlwZSA9PT0gJ0J1ZmZlcicgJiYgaXNBcnJheShvYmplY3QuZGF0YSkpIHtcbiAgICBhcnJheSA9IG9iamVjdC5kYXRhXG4gICAgbGVuZ3RoID0gY2hlY2tlZChhcnJheS5sZW5ndGgpIHwgMFxuICB9XG4gIHRoYXQgPSBhbGxvY2F0ZSh0aGF0LCBsZW5ndGgpXG5cbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW5ndGg7IGkgKz0gMSkge1xuICAgIHRoYXRbaV0gPSBhcnJheVtpXSAmIDI1NVxuICB9XG4gIHJldHVybiB0aGF0XG59XG5cbmZ1bmN0aW9uIGFsbG9jYXRlICh0aGF0LCBsZW5ndGgpIHtcbiAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgLy8gUmV0dXJuIGFuIGF1Z21lbnRlZCBgVWludDhBcnJheWAgaW5zdGFuY2UsIGZvciBiZXN0IHBlcmZvcm1hbmNlXG4gICAgdGhhdCA9IEJ1ZmZlci5fYXVnbWVudChuZXcgVWludDhBcnJheShsZW5ndGgpKVxuICB9IGVsc2Uge1xuICAgIC8vIEZhbGxiYWNrOiBSZXR1cm4gYW4gb2JqZWN0IGluc3RhbmNlIG9mIHRoZSBCdWZmZXIgY2xhc3NcbiAgICB0aGF0Lmxlbmd0aCA9IGxlbmd0aFxuICAgIHRoYXQuX2lzQnVmZmVyID0gdHJ1ZVxuICB9XG5cbiAgdmFyIGZyb21Qb29sID0gbGVuZ3RoICE9PSAwICYmIGxlbmd0aCA8PSBCdWZmZXIucG9vbFNpemUgPj4+IDFcbiAgaWYgKGZyb21Qb29sKSB0aGF0LnBhcmVudCA9IHJvb3RQYXJlbnRcblxuICByZXR1cm4gdGhhdFxufVxuXG5mdW5jdGlvbiBjaGVja2VkIChsZW5ndGgpIHtcbiAgLy8gTm90ZTogY2Fubm90IHVzZSBgbGVuZ3RoIDwga01heExlbmd0aGAgaGVyZSBiZWNhdXNlIHRoYXQgZmFpbHMgd2hlblxuICAvLyBsZW5ndGggaXMgTmFOICh3aGljaCBpcyBvdGhlcndpc2UgY29lcmNlZCB0byB6ZXJvLilcbiAgaWYgKGxlbmd0aCA+PSBrTWF4TGVuZ3RoKCkpIHtcbiAgICB0aHJvdyBuZXcgUmFuZ2VFcnJvcignQXR0ZW1wdCB0byBhbGxvY2F0ZSBCdWZmZXIgbGFyZ2VyIHRoYW4gbWF4aW11bSAnICtcbiAgICAgICAgICAgICAgICAgICAgICAgICAnc2l6ZTogMHgnICsga01heExlbmd0aCgpLnRvU3RyaW5nKDE2KSArICcgYnl0ZXMnKVxuICB9XG4gIHJldHVybiBsZW5ndGggfCAwXG59XG5cbmZ1bmN0aW9uIFNsb3dCdWZmZXIgKHN1YmplY3QsIGVuY29kaW5nKSB7XG4gIGlmICghKHRoaXMgaW5zdGFuY2VvZiBTbG93QnVmZmVyKSkgcmV0dXJuIG5ldyBTbG93QnVmZmVyKHN1YmplY3QsIGVuY29kaW5nKVxuXG4gIHZhciBidWYgPSBuZXcgQnVmZmVyKHN1YmplY3QsIGVuY29kaW5nKVxuICBkZWxldGUgYnVmLnBhcmVudFxuICByZXR1cm4gYnVmXG59XG5cbkJ1ZmZlci5pc0J1ZmZlciA9IGZ1bmN0aW9uIGlzQnVmZmVyIChiKSB7XG4gIHJldHVybiAhIShiICE9IG51bGwgJiYgYi5faXNCdWZmZXIpXG59XG5cbkJ1ZmZlci5jb21wYXJlID0gZnVuY3Rpb24gY29tcGFyZSAoYSwgYikge1xuICBpZiAoIUJ1ZmZlci5pc0J1ZmZlcihhKSB8fCAhQnVmZmVyLmlzQnVmZmVyKGIpKSB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcignQXJndW1lbnRzIG11c3QgYmUgQnVmZmVycycpXG4gIH1cblxuICBpZiAoYSA9PT0gYikgcmV0dXJuIDBcblxuICB2YXIgeCA9IGEubGVuZ3RoXG4gIHZhciB5ID0gYi5sZW5ndGhcblxuICB2YXIgaSA9IDBcbiAgdmFyIGxlbiA9IE1hdGgubWluKHgsIHkpXG4gIHdoaWxlIChpIDwgbGVuKSB7XG4gICAgaWYgKGFbaV0gIT09IGJbaV0pIGJyZWFrXG5cbiAgICArK2lcbiAgfVxuXG4gIGlmIChpICE9PSBsZW4pIHtcbiAgICB4ID0gYVtpXVxuICAgIHkgPSBiW2ldXG4gIH1cblxuICBpZiAoeCA8IHkpIHJldHVybiAtMVxuICBpZiAoeSA8IHgpIHJldHVybiAxXG4gIHJldHVybiAwXG59XG5cbkJ1ZmZlci5pc0VuY29kaW5nID0gZnVuY3Rpb24gaXNFbmNvZGluZyAoZW5jb2RpbmcpIHtcbiAgc3dpdGNoIChTdHJpbmcoZW5jb2RpbmcpLnRvTG93ZXJDYXNlKCkpIHtcbiAgICBjYXNlICdoZXgnOlxuICAgIGNhc2UgJ3V0ZjgnOlxuICAgIGNhc2UgJ3V0Zi04JzpcbiAgICBjYXNlICdhc2NpaSc6XG4gICAgY2FzZSAnYmluYXJ5JzpcbiAgICBjYXNlICdiYXNlNjQnOlxuICAgIGNhc2UgJ3Jhdyc6XG4gICAgY2FzZSAndWNzMic6XG4gICAgY2FzZSAndWNzLTInOlxuICAgIGNhc2UgJ3V0ZjE2bGUnOlxuICAgIGNhc2UgJ3V0Zi0xNmxlJzpcbiAgICAgIHJldHVybiB0cnVlXG4gICAgZGVmYXVsdDpcbiAgICAgIHJldHVybiBmYWxzZVxuICB9XG59XG5cbkJ1ZmZlci5jb25jYXQgPSBmdW5jdGlvbiBjb25jYXQgKGxpc3QsIGxlbmd0aCkge1xuICBpZiAoIWlzQXJyYXkobGlzdCkpIHRocm93IG5ldyBUeXBlRXJyb3IoJ2xpc3QgYXJndW1lbnQgbXVzdCBiZSBhbiBBcnJheSBvZiBCdWZmZXJzLicpXG5cbiAgaWYgKGxpc3QubGVuZ3RoID09PSAwKSB7XG4gICAgcmV0dXJuIG5ldyBCdWZmZXIoMClcbiAgfVxuXG4gIHZhciBpXG4gIGlmIChsZW5ndGggPT09IHVuZGVmaW5lZCkge1xuICAgIGxlbmd0aCA9IDBcbiAgICBmb3IgKGkgPSAwOyBpIDwgbGlzdC5sZW5ndGg7IGkrKykge1xuICAgICAgbGVuZ3RoICs9IGxpc3RbaV0ubGVuZ3RoXG4gICAgfVxuICB9XG5cbiAgdmFyIGJ1ZiA9IG5ldyBCdWZmZXIobGVuZ3RoKVxuICB2YXIgcG9zID0gMFxuICBmb3IgKGkgPSAwOyBpIDwgbGlzdC5sZW5ndGg7IGkrKykge1xuICAgIHZhciBpdGVtID0gbGlzdFtpXVxuICAgIGl0ZW0uY29weShidWYsIHBvcylcbiAgICBwb3MgKz0gaXRlbS5sZW5ndGhcbiAgfVxuICByZXR1cm4gYnVmXG59XG5cbmZ1bmN0aW9uIGJ5dGVMZW5ndGggKHN0cmluZywgZW5jb2RpbmcpIHtcbiAgaWYgKHR5cGVvZiBzdHJpbmcgIT09ICdzdHJpbmcnKSBzdHJpbmcgPSAnJyArIHN0cmluZ1xuXG4gIHZhciBsZW4gPSBzdHJpbmcubGVuZ3RoXG4gIGlmIChsZW4gPT09IDApIHJldHVybiAwXG5cbiAgLy8gVXNlIGEgZm9yIGxvb3AgdG8gYXZvaWQgcmVjdXJzaW9uXG4gIHZhciBsb3dlcmVkQ2FzZSA9IGZhbHNlXG4gIGZvciAoOzspIHtcbiAgICBzd2l0Y2ggKGVuY29kaW5nKSB7XG4gICAgICBjYXNlICdhc2NpaSc6XG4gICAgICBjYXNlICdiaW5hcnknOlxuICAgICAgLy8gRGVwcmVjYXRlZFxuICAgICAgY2FzZSAncmF3JzpcbiAgICAgIGNhc2UgJ3Jhd3MnOlxuICAgICAgICByZXR1cm4gbGVuXG4gICAgICBjYXNlICd1dGY4JzpcbiAgICAgIGNhc2UgJ3V0Zi04JzpcbiAgICAgICAgcmV0dXJuIHV0ZjhUb0J5dGVzKHN0cmluZykubGVuZ3RoXG4gICAgICBjYXNlICd1Y3MyJzpcbiAgICAgIGNhc2UgJ3Vjcy0yJzpcbiAgICAgIGNhc2UgJ3V0ZjE2bGUnOlxuICAgICAgY2FzZSAndXRmLTE2bGUnOlxuICAgICAgICByZXR1cm4gbGVuICogMlxuICAgICAgY2FzZSAnaGV4JzpcbiAgICAgICAgcmV0dXJuIGxlbiA+Pj4gMVxuICAgICAgY2FzZSAnYmFzZTY0JzpcbiAgICAgICAgcmV0dXJuIGJhc2U2NFRvQnl0ZXMoc3RyaW5nKS5sZW5ndGhcbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIGlmIChsb3dlcmVkQ2FzZSkgcmV0dXJuIHV0ZjhUb0J5dGVzKHN0cmluZykubGVuZ3RoIC8vIGFzc3VtZSB1dGY4XG4gICAgICAgIGVuY29kaW5nID0gKCcnICsgZW5jb2RpbmcpLnRvTG93ZXJDYXNlKClcbiAgICAgICAgbG93ZXJlZENhc2UgPSB0cnVlXG4gICAgfVxuICB9XG59XG5CdWZmZXIuYnl0ZUxlbmd0aCA9IGJ5dGVMZW5ndGhcblxuLy8gcHJlLXNldCBmb3IgdmFsdWVzIHRoYXQgbWF5IGV4aXN0IGluIHRoZSBmdXR1cmVcbkJ1ZmZlci5wcm90b3R5cGUubGVuZ3RoID0gdW5kZWZpbmVkXG5CdWZmZXIucHJvdG90eXBlLnBhcmVudCA9IHVuZGVmaW5lZFxuXG5mdW5jdGlvbiBzbG93VG9TdHJpbmcgKGVuY29kaW5nLCBzdGFydCwgZW5kKSB7XG4gIHZhciBsb3dlcmVkQ2FzZSA9IGZhbHNlXG5cbiAgc3RhcnQgPSBzdGFydCB8IDBcbiAgZW5kID0gZW5kID09PSB1bmRlZmluZWQgfHwgZW5kID09PSBJbmZpbml0eSA/IHRoaXMubGVuZ3RoIDogZW5kIHwgMFxuXG4gIGlmICghZW5jb2RpbmcpIGVuY29kaW5nID0gJ3V0ZjgnXG4gIGlmIChzdGFydCA8IDApIHN0YXJ0ID0gMFxuICBpZiAoZW5kID4gdGhpcy5sZW5ndGgpIGVuZCA9IHRoaXMubGVuZ3RoXG4gIGlmIChlbmQgPD0gc3RhcnQpIHJldHVybiAnJ1xuXG4gIHdoaWxlICh0cnVlKSB7XG4gICAgc3dpdGNoIChlbmNvZGluZykge1xuICAgICAgY2FzZSAnaGV4JzpcbiAgICAgICAgcmV0dXJuIGhleFNsaWNlKHRoaXMsIHN0YXJ0LCBlbmQpXG5cbiAgICAgIGNhc2UgJ3V0ZjgnOlxuICAgICAgY2FzZSAndXRmLTgnOlxuICAgICAgICByZXR1cm4gdXRmOFNsaWNlKHRoaXMsIHN0YXJ0LCBlbmQpXG5cbiAgICAgIGNhc2UgJ2FzY2lpJzpcbiAgICAgICAgcmV0dXJuIGFzY2lpU2xpY2UodGhpcywgc3RhcnQsIGVuZClcblxuICAgICAgY2FzZSAnYmluYXJ5JzpcbiAgICAgICAgcmV0dXJuIGJpbmFyeVNsaWNlKHRoaXMsIHN0YXJ0LCBlbmQpXG5cbiAgICAgIGNhc2UgJ2Jhc2U2NCc6XG4gICAgICAgIHJldHVybiBiYXNlNjRTbGljZSh0aGlzLCBzdGFydCwgZW5kKVxuXG4gICAgICBjYXNlICd1Y3MyJzpcbiAgICAgIGNhc2UgJ3Vjcy0yJzpcbiAgICAgIGNhc2UgJ3V0ZjE2bGUnOlxuICAgICAgY2FzZSAndXRmLTE2bGUnOlxuICAgICAgICByZXR1cm4gdXRmMTZsZVNsaWNlKHRoaXMsIHN0YXJ0LCBlbmQpXG5cbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIGlmIChsb3dlcmVkQ2FzZSkgdGhyb3cgbmV3IFR5cGVFcnJvcignVW5rbm93biBlbmNvZGluZzogJyArIGVuY29kaW5nKVxuICAgICAgICBlbmNvZGluZyA9IChlbmNvZGluZyArICcnKS50b0xvd2VyQ2FzZSgpXG4gICAgICAgIGxvd2VyZWRDYXNlID0gdHJ1ZVxuICAgIH1cbiAgfVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnRvU3RyaW5nID0gZnVuY3Rpb24gdG9TdHJpbmcgKCkge1xuICB2YXIgbGVuZ3RoID0gdGhpcy5sZW5ndGggfCAwXG4gIGlmIChsZW5ndGggPT09IDApIHJldHVybiAnJ1xuICBpZiAoYXJndW1lbnRzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIHV0ZjhTbGljZSh0aGlzLCAwLCBsZW5ndGgpXG4gIHJldHVybiBzbG93VG9TdHJpbmcuYXBwbHkodGhpcywgYXJndW1lbnRzKVxufVxuXG5CdWZmZXIucHJvdG90eXBlLmVxdWFscyA9IGZ1bmN0aW9uIGVxdWFscyAoYikge1xuICBpZiAoIUJ1ZmZlci5pc0J1ZmZlcihiKSkgdGhyb3cgbmV3IFR5cGVFcnJvcignQXJndW1lbnQgbXVzdCBiZSBhIEJ1ZmZlcicpXG4gIGlmICh0aGlzID09PSBiKSByZXR1cm4gdHJ1ZVxuICByZXR1cm4gQnVmZmVyLmNvbXBhcmUodGhpcywgYikgPT09IDBcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5pbnNwZWN0ID0gZnVuY3Rpb24gaW5zcGVjdCAoKSB7XG4gIHZhciBzdHIgPSAnJ1xuICB2YXIgbWF4ID0gZXhwb3J0cy5JTlNQRUNUX01BWF9CWVRFU1xuICBpZiAodGhpcy5sZW5ndGggPiAwKSB7XG4gICAgc3RyID0gdGhpcy50b1N0cmluZygnaGV4JywgMCwgbWF4KS5tYXRjaCgvLnsyfS9nKS5qb2luKCcgJylcbiAgICBpZiAodGhpcy5sZW5ndGggPiBtYXgpIHN0ciArPSAnIC4uLiAnXG4gIH1cbiAgcmV0dXJuICc8QnVmZmVyICcgKyBzdHIgKyAnPidcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5jb21wYXJlID0gZnVuY3Rpb24gY29tcGFyZSAoYikge1xuICBpZiAoIUJ1ZmZlci5pc0J1ZmZlcihiKSkgdGhyb3cgbmV3IFR5cGVFcnJvcignQXJndW1lbnQgbXVzdCBiZSBhIEJ1ZmZlcicpXG4gIGlmICh0aGlzID09PSBiKSByZXR1cm4gMFxuICByZXR1cm4gQnVmZmVyLmNvbXBhcmUodGhpcywgYilcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5pbmRleE9mID0gZnVuY3Rpb24gaW5kZXhPZiAodmFsLCBieXRlT2Zmc2V0KSB7XG4gIGlmIChieXRlT2Zmc2V0ID4gMHg3ZmZmZmZmZikgYnl0ZU9mZnNldCA9IDB4N2ZmZmZmZmZcbiAgZWxzZSBpZiAoYnl0ZU9mZnNldCA8IC0weDgwMDAwMDAwKSBieXRlT2Zmc2V0ID0gLTB4ODAwMDAwMDBcbiAgYnl0ZU9mZnNldCA+Pj0gMFxuXG4gIGlmICh0aGlzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIC0xXG4gIGlmIChieXRlT2Zmc2V0ID49IHRoaXMubGVuZ3RoKSByZXR1cm4gLTFcblxuICAvLyBOZWdhdGl2ZSBvZmZzZXRzIHN0YXJ0IGZyb20gdGhlIGVuZCBvZiB0aGUgYnVmZmVyXG4gIGlmIChieXRlT2Zmc2V0IDwgMCkgYnl0ZU9mZnNldCA9IE1hdGgubWF4KHRoaXMubGVuZ3RoICsgYnl0ZU9mZnNldCwgMClcblxuICBpZiAodHlwZW9mIHZhbCA9PT0gJ3N0cmluZycpIHtcbiAgICBpZiAodmFsLmxlbmd0aCA9PT0gMCkgcmV0dXJuIC0xIC8vIHNwZWNpYWwgY2FzZTogbG9va2luZyBmb3IgZW1wdHkgc3RyaW5nIGFsd2F5cyBmYWlsc1xuICAgIHJldHVybiBTdHJpbmcucHJvdG90eXBlLmluZGV4T2YuY2FsbCh0aGlzLCB2YWwsIGJ5dGVPZmZzZXQpXG4gIH1cbiAgaWYgKEJ1ZmZlci5pc0J1ZmZlcih2YWwpKSB7XG4gICAgcmV0dXJuIGFycmF5SW5kZXhPZih0aGlzLCB2YWwsIGJ5dGVPZmZzZXQpXG4gIH1cbiAgaWYgKHR5cGVvZiB2YWwgPT09ICdudW1iZXInKSB7XG4gICAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUICYmIFVpbnQ4QXJyYXkucHJvdG90eXBlLmluZGV4T2YgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgIHJldHVybiBVaW50OEFycmF5LnByb3RvdHlwZS5pbmRleE9mLmNhbGwodGhpcywgdmFsLCBieXRlT2Zmc2V0KVxuICAgIH1cbiAgICByZXR1cm4gYXJyYXlJbmRleE9mKHRoaXMsIFsgdmFsIF0sIGJ5dGVPZmZzZXQpXG4gIH1cblxuICBmdW5jdGlvbiBhcnJheUluZGV4T2YgKGFyciwgdmFsLCBieXRlT2Zmc2V0KSB7XG4gICAgdmFyIGZvdW5kSW5kZXggPSAtMVxuICAgIGZvciAodmFyIGkgPSAwOyBieXRlT2Zmc2V0ICsgaSA8IGFyci5sZW5ndGg7IGkrKykge1xuICAgICAgaWYgKGFycltieXRlT2Zmc2V0ICsgaV0gPT09IHZhbFtmb3VuZEluZGV4ID09PSAtMSA/IDAgOiBpIC0gZm91bmRJbmRleF0pIHtcbiAgICAgICAgaWYgKGZvdW5kSW5kZXggPT09IC0xKSBmb3VuZEluZGV4ID0gaVxuICAgICAgICBpZiAoaSAtIGZvdW5kSW5kZXggKyAxID09PSB2YWwubGVuZ3RoKSByZXR1cm4gYnl0ZU9mZnNldCArIGZvdW5kSW5kZXhcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGZvdW5kSW5kZXggPSAtMVxuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gLTFcbiAgfVxuXG4gIHRocm93IG5ldyBUeXBlRXJyb3IoJ3ZhbCBtdXN0IGJlIHN0cmluZywgbnVtYmVyIG9yIEJ1ZmZlcicpXG59XG5cbi8vIGBnZXRgIGlzIGRlcHJlY2F0ZWRcbkJ1ZmZlci5wcm90b3R5cGUuZ2V0ID0gZnVuY3Rpb24gZ2V0IChvZmZzZXQpIHtcbiAgY29uc29sZS5sb2coJy5nZXQoKSBpcyBkZXByZWNhdGVkLiBBY2Nlc3MgdXNpbmcgYXJyYXkgaW5kZXhlcyBpbnN0ZWFkLicpXG4gIHJldHVybiB0aGlzLnJlYWRVSW50OChvZmZzZXQpXG59XG5cbi8vIGBzZXRgIGlzIGRlcHJlY2F0ZWRcbkJ1ZmZlci5wcm90b3R5cGUuc2V0ID0gZnVuY3Rpb24gc2V0ICh2LCBvZmZzZXQpIHtcbiAgY29uc29sZS5sb2coJy5zZXQoKSBpcyBkZXByZWNhdGVkLiBBY2Nlc3MgdXNpbmcgYXJyYXkgaW5kZXhlcyBpbnN0ZWFkLicpXG4gIHJldHVybiB0aGlzLndyaXRlVUludDgodiwgb2Zmc2V0KVxufVxuXG5mdW5jdGlvbiBoZXhXcml0ZSAoYnVmLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKSB7XG4gIG9mZnNldCA9IE51bWJlcihvZmZzZXQpIHx8IDBcbiAgdmFyIHJlbWFpbmluZyA9IGJ1Zi5sZW5ndGggLSBvZmZzZXRcbiAgaWYgKCFsZW5ndGgpIHtcbiAgICBsZW5ndGggPSByZW1haW5pbmdcbiAgfSBlbHNlIHtcbiAgICBsZW5ndGggPSBOdW1iZXIobGVuZ3RoKVxuICAgIGlmIChsZW5ndGggPiByZW1haW5pbmcpIHtcbiAgICAgIGxlbmd0aCA9IHJlbWFpbmluZ1xuICAgIH1cbiAgfVxuXG4gIC8vIG11c3QgYmUgYW4gZXZlbiBudW1iZXIgb2YgZGlnaXRzXG4gIHZhciBzdHJMZW4gPSBzdHJpbmcubGVuZ3RoXG4gIGlmIChzdHJMZW4gJSAyICE9PSAwKSB0aHJvdyBuZXcgRXJyb3IoJ0ludmFsaWQgaGV4IHN0cmluZycpXG5cbiAgaWYgKGxlbmd0aCA+IHN0ckxlbiAvIDIpIHtcbiAgICBsZW5ndGggPSBzdHJMZW4gLyAyXG4gIH1cbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW5ndGg7IGkrKykge1xuICAgIHZhciBwYXJzZWQgPSBwYXJzZUludChzdHJpbmcuc3Vic3RyKGkgKiAyLCAyKSwgMTYpXG4gICAgaWYgKGlzTmFOKHBhcnNlZCkpIHRocm93IG5ldyBFcnJvcignSW52YWxpZCBoZXggc3RyaW5nJylcbiAgICBidWZbb2Zmc2V0ICsgaV0gPSBwYXJzZWRcbiAgfVxuICByZXR1cm4gaVxufVxuXG5mdW5jdGlvbiB1dGY4V3JpdGUgKGJ1Ziwgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCkge1xuICByZXR1cm4gYmxpdEJ1ZmZlcih1dGY4VG9CeXRlcyhzdHJpbmcsIGJ1Zi5sZW5ndGggLSBvZmZzZXQpLCBidWYsIG9mZnNldCwgbGVuZ3RoKVxufVxuXG5mdW5jdGlvbiBhc2NpaVdyaXRlIChidWYsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpIHtcbiAgcmV0dXJuIGJsaXRCdWZmZXIoYXNjaWlUb0J5dGVzKHN0cmluZyksIGJ1Ziwgb2Zmc2V0LCBsZW5ndGgpXG59XG5cbmZ1bmN0aW9uIGJpbmFyeVdyaXRlIChidWYsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpIHtcbiAgcmV0dXJuIGFzY2lpV3JpdGUoYnVmLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKVxufVxuXG5mdW5jdGlvbiBiYXNlNjRXcml0ZSAoYnVmLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKSB7XG4gIHJldHVybiBibGl0QnVmZmVyKGJhc2U2NFRvQnl0ZXMoc3RyaW5nKSwgYnVmLCBvZmZzZXQsIGxlbmd0aClcbn1cblxuZnVuY3Rpb24gdWNzMldyaXRlIChidWYsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpIHtcbiAgcmV0dXJuIGJsaXRCdWZmZXIodXRmMTZsZVRvQnl0ZXMoc3RyaW5nLCBidWYubGVuZ3RoIC0gb2Zmc2V0KSwgYnVmLCBvZmZzZXQsIGxlbmd0aClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZSA9IGZ1bmN0aW9uIHdyaXRlIChzdHJpbmcsIG9mZnNldCwgbGVuZ3RoLCBlbmNvZGluZykge1xuICAvLyBCdWZmZXIjd3JpdGUoc3RyaW5nKVxuICBpZiAob2Zmc2V0ID09PSB1bmRlZmluZWQpIHtcbiAgICBlbmNvZGluZyA9ICd1dGY4J1xuICAgIGxlbmd0aCA9IHRoaXMubGVuZ3RoXG4gICAgb2Zmc2V0ID0gMFxuICAvLyBCdWZmZXIjd3JpdGUoc3RyaW5nLCBlbmNvZGluZylcbiAgfSBlbHNlIGlmIChsZW5ndGggPT09IHVuZGVmaW5lZCAmJiB0eXBlb2Ygb2Zmc2V0ID09PSAnc3RyaW5nJykge1xuICAgIGVuY29kaW5nID0gb2Zmc2V0XG4gICAgbGVuZ3RoID0gdGhpcy5sZW5ndGhcbiAgICBvZmZzZXQgPSAwXG4gIC8vIEJ1ZmZlciN3cml0ZShzdHJpbmcsIG9mZnNldFssIGxlbmd0aF1bLCBlbmNvZGluZ10pXG4gIH0gZWxzZSBpZiAoaXNGaW5pdGUob2Zmc2V0KSkge1xuICAgIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgICBpZiAoaXNGaW5pdGUobGVuZ3RoKSkge1xuICAgICAgbGVuZ3RoID0gbGVuZ3RoIHwgMFxuICAgICAgaWYgKGVuY29kaW5nID09PSB1bmRlZmluZWQpIGVuY29kaW5nID0gJ3V0ZjgnXG4gICAgfSBlbHNlIHtcbiAgICAgIGVuY29kaW5nID0gbGVuZ3RoXG4gICAgICBsZW5ndGggPSB1bmRlZmluZWRcbiAgICB9XG4gIC8vIGxlZ2FjeSB3cml0ZShzdHJpbmcsIGVuY29kaW5nLCBvZmZzZXQsIGxlbmd0aCkgLSByZW1vdmUgaW4gdjAuMTNcbiAgfSBlbHNlIHtcbiAgICB2YXIgc3dhcCA9IGVuY29kaW5nXG4gICAgZW5jb2RpbmcgPSBvZmZzZXRcbiAgICBvZmZzZXQgPSBsZW5ndGggfCAwXG4gICAgbGVuZ3RoID0gc3dhcFxuICB9XG5cbiAgdmFyIHJlbWFpbmluZyA9IHRoaXMubGVuZ3RoIC0gb2Zmc2V0XG4gIGlmIChsZW5ndGggPT09IHVuZGVmaW5lZCB8fCBsZW5ndGggPiByZW1haW5pbmcpIGxlbmd0aCA9IHJlbWFpbmluZ1xuXG4gIGlmICgoc3RyaW5nLmxlbmd0aCA+IDAgJiYgKGxlbmd0aCA8IDAgfHwgb2Zmc2V0IDwgMCkpIHx8IG9mZnNldCA+IHRoaXMubGVuZ3RoKSB7XG4gICAgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ2F0dGVtcHQgdG8gd3JpdGUgb3V0c2lkZSBidWZmZXIgYm91bmRzJylcbiAgfVxuXG4gIGlmICghZW5jb2RpbmcpIGVuY29kaW5nID0gJ3V0ZjgnXG5cbiAgdmFyIGxvd2VyZWRDYXNlID0gZmFsc2VcbiAgZm9yICg7Oykge1xuICAgIHN3aXRjaCAoZW5jb2RpbmcpIHtcbiAgICAgIGNhc2UgJ2hleCc6XG4gICAgICAgIHJldHVybiBoZXhXcml0ZSh0aGlzLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKVxuXG4gICAgICBjYXNlICd1dGY4JzpcbiAgICAgIGNhc2UgJ3V0Zi04JzpcbiAgICAgICAgcmV0dXJuIHV0ZjhXcml0ZSh0aGlzLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKVxuXG4gICAgICBjYXNlICdhc2NpaSc6XG4gICAgICAgIHJldHVybiBhc2NpaVdyaXRlKHRoaXMsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpXG5cbiAgICAgIGNhc2UgJ2JpbmFyeSc6XG4gICAgICAgIHJldHVybiBiaW5hcnlXcml0ZSh0aGlzLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKVxuXG4gICAgICBjYXNlICdiYXNlNjQnOlxuICAgICAgICAvLyBXYXJuaW5nOiBtYXhMZW5ndGggbm90IHRha2VuIGludG8gYWNjb3VudCBpbiBiYXNlNjRXcml0ZVxuICAgICAgICByZXR1cm4gYmFzZTY0V3JpdGUodGhpcywgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aClcblxuICAgICAgY2FzZSAndWNzMic6XG4gICAgICBjYXNlICd1Y3MtMic6XG4gICAgICBjYXNlICd1dGYxNmxlJzpcbiAgICAgIGNhc2UgJ3V0Zi0xNmxlJzpcbiAgICAgICAgcmV0dXJuIHVjczJXcml0ZSh0aGlzLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKVxuXG4gICAgICBkZWZhdWx0OlxuICAgICAgICBpZiAobG93ZXJlZENhc2UpIHRocm93IG5ldyBUeXBlRXJyb3IoJ1Vua25vd24gZW5jb2Rpbmc6ICcgKyBlbmNvZGluZylcbiAgICAgICAgZW5jb2RpbmcgPSAoJycgKyBlbmNvZGluZykudG9Mb3dlckNhc2UoKVxuICAgICAgICBsb3dlcmVkQ2FzZSA9IHRydWVcbiAgICB9XG4gIH1cbn1cblxuQnVmZmVyLnByb3RvdHlwZS50b0pTT04gPSBmdW5jdGlvbiB0b0pTT04gKCkge1xuICByZXR1cm4ge1xuICAgIHR5cGU6ICdCdWZmZXInLFxuICAgIGRhdGE6IEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKHRoaXMuX2FyciB8fCB0aGlzLCAwKVxuICB9XG59XG5cbmZ1bmN0aW9uIGJhc2U2NFNsaWNlIChidWYsIHN0YXJ0LCBlbmQpIHtcbiAgaWYgKHN0YXJ0ID09PSAwICYmIGVuZCA9PT0gYnVmLmxlbmd0aCkge1xuICAgIHJldHVybiBiYXNlNjQuZnJvbUJ5dGVBcnJheShidWYpXG4gIH0gZWxzZSB7XG4gICAgcmV0dXJuIGJhc2U2NC5mcm9tQnl0ZUFycmF5KGJ1Zi5zbGljZShzdGFydCwgZW5kKSlcbiAgfVxufVxuXG5mdW5jdGlvbiB1dGY4U2xpY2UgKGJ1Ziwgc3RhcnQsIGVuZCkge1xuICBlbmQgPSBNYXRoLm1pbihidWYubGVuZ3RoLCBlbmQpXG4gIHZhciBmaXJzdEJ5dGVcbiAgdmFyIHNlY29uZEJ5dGVcbiAgdmFyIHRoaXJkQnl0ZVxuICB2YXIgZm91cnRoQnl0ZVxuICB2YXIgYnl0ZXNQZXJTZXF1ZW5jZVxuICB2YXIgdGVtcENvZGVQb2ludFxuICB2YXIgY29kZVBvaW50XG4gIHZhciByZXMgPSBbXVxuICB2YXIgaSA9IHN0YXJ0XG5cbiAgZm9yICg7IGkgPCBlbmQ7IGkgKz0gYnl0ZXNQZXJTZXF1ZW5jZSkge1xuICAgIGZpcnN0Qnl0ZSA9IGJ1ZltpXVxuICAgIGNvZGVQb2ludCA9IDB4RkZGRFxuXG4gICAgaWYgKGZpcnN0Qnl0ZSA+IDB4RUYpIHtcbiAgICAgIGJ5dGVzUGVyU2VxdWVuY2UgPSA0XG4gICAgfSBlbHNlIGlmIChmaXJzdEJ5dGUgPiAweERGKSB7XG4gICAgICBieXRlc1BlclNlcXVlbmNlID0gM1xuICAgIH0gZWxzZSBpZiAoZmlyc3RCeXRlID4gMHhCRikge1xuICAgICAgYnl0ZXNQZXJTZXF1ZW5jZSA9IDJcbiAgICB9IGVsc2Uge1xuICAgICAgYnl0ZXNQZXJTZXF1ZW5jZSA9IDFcbiAgICB9XG5cbiAgICBpZiAoaSArIGJ5dGVzUGVyU2VxdWVuY2UgPD0gZW5kKSB7XG4gICAgICBzd2l0Y2ggKGJ5dGVzUGVyU2VxdWVuY2UpIHtcbiAgICAgICAgY2FzZSAxOlxuICAgICAgICAgIGlmIChmaXJzdEJ5dGUgPCAweDgwKSB7XG4gICAgICAgICAgICBjb2RlUG9pbnQgPSBmaXJzdEJ5dGVcbiAgICAgICAgICB9XG4gICAgICAgICAgYnJlYWtcbiAgICAgICAgY2FzZSAyOlxuICAgICAgICAgIHNlY29uZEJ5dGUgPSBidWZbaSArIDFdXG4gICAgICAgICAgaWYgKChzZWNvbmRCeXRlICYgMHhDMCkgPT09IDB4ODApIHtcbiAgICAgICAgICAgIHRlbXBDb2RlUG9pbnQgPSAoZmlyc3RCeXRlICYgMHgxRikgPDwgMHg2IHwgKHNlY29uZEJ5dGUgJiAweDNGKVxuICAgICAgICAgICAgaWYgKHRlbXBDb2RlUG9pbnQgPiAweDdGKSB7XG4gICAgICAgICAgICAgIGNvZGVQb2ludCA9IHRlbXBDb2RlUG9pbnRcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgICAgYnJlYWtcbiAgICAgICAgY2FzZSAzOlxuICAgICAgICAgIHNlY29uZEJ5dGUgPSBidWZbaSArIDFdXG4gICAgICAgICAgdGhpcmRCeXRlID0gYnVmW2kgKyAyXVxuICAgICAgICAgIGlmICgoc2Vjb25kQnl0ZSAmIDB4QzApID09PSAweDgwICYmICh0aGlyZEJ5dGUgJiAweEMwKSA9PT0gMHg4MCkge1xuICAgICAgICAgICAgdGVtcENvZGVQb2ludCA9IChmaXJzdEJ5dGUgJiAweEYpIDw8IDB4QyB8IChzZWNvbmRCeXRlICYgMHgzRikgPDwgMHg2IHwgKHRoaXJkQnl0ZSAmIDB4M0YpXG4gICAgICAgICAgICBpZiAodGVtcENvZGVQb2ludCA+IDB4N0ZGICYmICh0ZW1wQ29kZVBvaW50IDwgMHhEODAwIHx8IHRlbXBDb2RlUG9pbnQgPiAweERGRkYpKSB7XG4gICAgICAgICAgICAgIGNvZGVQb2ludCA9IHRlbXBDb2RlUG9pbnRcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgICAgYnJlYWtcbiAgICAgICAgY2FzZSA0OlxuICAgICAgICAgIHNlY29uZEJ5dGUgPSBidWZbaSArIDFdXG4gICAgICAgICAgdGhpcmRCeXRlID0gYnVmW2kgKyAyXVxuICAgICAgICAgIGZvdXJ0aEJ5dGUgPSBidWZbaSArIDNdXG4gICAgICAgICAgaWYgKChzZWNvbmRCeXRlICYgMHhDMCkgPT09IDB4ODAgJiYgKHRoaXJkQnl0ZSAmIDB4QzApID09PSAweDgwICYmIChmb3VydGhCeXRlICYgMHhDMCkgPT09IDB4ODApIHtcbiAgICAgICAgICAgIHRlbXBDb2RlUG9pbnQgPSAoZmlyc3RCeXRlICYgMHhGKSA8PCAweDEyIHwgKHNlY29uZEJ5dGUgJiAweDNGKSA8PCAweEMgfCAodGhpcmRCeXRlICYgMHgzRikgPDwgMHg2IHwgKGZvdXJ0aEJ5dGUgJiAweDNGKVxuICAgICAgICAgICAgaWYgKHRlbXBDb2RlUG9pbnQgPiAweEZGRkYgJiYgdGVtcENvZGVQb2ludCA8IDB4MTEwMDAwKSB7XG4gICAgICAgICAgICAgIGNvZGVQb2ludCA9IHRlbXBDb2RlUG9pbnRcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKGNvZGVQb2ludCA9PT0gMHhGRkZEKSB7XG4gICAgICAvLyB3ZSBnZW5lcmF0ZWQgYW4gaW52YWxpZCBjb2RlUG9pbnQgc28gbWFrZSBzdXJlIHRvIG9ubHkgYWR2YW5jZSBieSAxIGJ5dGVcbiAgICAgIGJ5dGVzUGVyU2VxdWVuY2UgPSAxXG4gICAgfSBlbHNlIGlmIChjb2RlUG9pbnQgPiAweEZGRkYpIHtcbiAgICAgIC8vIGVuY29kZSB0byB1dGYxNiAoc3Vycm9nYXRlIHBhaXIgZGFuY2UpXG4gICAgICBjb2RlUG9pbnQgLT0gMHgxMDAwMFxuICAgICAgcmVzLnB1c2goY29kZVBvaW50ID4+PiAxMCAmIDB4M0ZGIHwgMHhEODAwKVxuICAgICAgY29kZVBvaW50ID0gMHhEQzAwIHwgY29kZVBvaW50ICYgMHgzRkZcbiAgICB9XG5cbiAgICByZXMucHVzaChjb2RlUG9pbnQpXG4gIH1cblxuICByZXR1cm4gU3RyaW5nLmZyb21DaGFyQ29kZS5hcHBseShTdHJpbmcsIHJlcylcbn1cblxuZnVuY3Rpb24gYXNjaWlTbGljZSAoYnVmLCBzdGFydCwgZW5kKSB7XG4gIHZhciByZXQgPSAnJ1xuICBlbmQgPSBNYXRoLm1pbihidWYubGVuZ3RoLCBlbmQpXG5cbiAgZm9yICh2YXIgaSA9IHN0YXJ0OyBpIDwgZW5kOyBpKyspIHtcbiAgICByZXQgKz0gU3RyaW5nLmZyb21DaGFyQ29kZShidWZbaV0gJiAweDdGKVxuICB9XG4gIHJldHVybiByZXRcbn1cblxuZnVuY3Rpb24gYmluYXJ5U2xpY2UgKGJ1Ziwgc3RhcnQsIGVuZCkge1xuICB2YXIgcmV0ID0gJydcbiAgZW5kID0gTWF0aC5taW4oYnVmLmxlbmd0aCwgZW5kKVxuXG4gIGZvciAodmFyIGkgPSBzdGFydDsgaSA8IGVuZDsgaSsrKSB7XG4gICAgcmV0ICs9IFN0cmluZy5mcm9tQ2hhckNvZGUoYnVmW2ldKVxuICB9XG4gIHJldHVybiByZXRcbn1cblxuZnVuY3Rpb24gaGV4U2xpY2UgKGJ1Ziwgc3RhcnQsIGVuZCkge1xuICB2YXIgbGVuID0gYnVmLmxlbmd0aFxuXG4gIGlmICghc3RhcnQgfHwgc3RhcnQgPCAwKSBzdGFydCA9IDBcbiAgaWYgKCFlbmQgfHwgZW5kIDwgMCB8fCBlbmQgPiBsZW4pIGVuZCA9IGxlblxuXG4gIHZhciBvdXQgPSAnJ1xuICBmb3IgKHZhciBpID0gc3RhcnQ7IGkgPCBlbmQ7IGkrKykge1xuICAgIG91dCArPSB0b0hleChidWZbaV0pXG4gIH1cbiAgcmV0dXJuIG91dFxufVxuXG5mdW5jdGlvbiB1dGYxNmxlU2xpY2UgKGJ1Ziwgc3RhcnQsIGVuZCkge1xuICB2YXIgYnl0ZXMgPSBidWYuc2xpY2Uoc3RhcnQsIGVuZClcbiAgdmFyIHJlcyA9ICcnXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgYnl0ZXMubGVuZ3RoOyBpICs9IDIpIHtcbiAgICByZXMgKz0gU3RyaW5nLmZyb21DaGFyQ29kZShieXRlc1tpXSArIGJ5dGVzW2kgKyAxXSAqIDI1NilcbiAgfVxuICByZXR1cm4gcmVzXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUuc2xpY2UgPSBmdW5jdGlvbiBzbGljZSAoc3RhcnQsIGVuZCkge1xuICB2YXIgbGVuID0gdGhpcy5sZW5ndGhcbiAgc3RhcnQgPSB+fnN0YXJ0XG4gIGVuZCA9IGVuZCA9PT0gdW5kZWZpbmVkID8gbGVuIDogfn5lbmRcblxuICBpZiAoc3RhcnQgPCAwKSB7XG4gICAgc3RhcnQgKz0gbGVuXG4gICAgaWYgKHN0YXJ0IDwgMCkgc3RhcnQgPSAwXG4gIH0gZWxzZSBpZiAoc3RhcnQgPiBsZW4pIHtcbiAgICBzdGFydCA9IGxlblxuICB9XG5cbiAgaWYgKGVuZCA8IDApIHtcbiAgICBlbmQgKz0gbGVuXG4gICAgaWYgKGVuZCA8IDApIGVuZCA9IDBcbiAgfSBlbHNlIGlmIChlbmQgPiBsZW4pIHtcbiAgICBlbmQgPSBsZW5cbiAgfVxuXG4gIGlmIChlbmQgPCBzdGFydCkgZW5kID0gc3RhcnRcblxuICB2YXIgbmV3QnVmXG4gIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIG5ld0J1ZiA9IEJ1ZmZlci5fYXVnbWVudCh0aGlzLnN1YmFycmF5KHN0YXJ0LCBlbmQpKVxuICB9IGVsc2Uge1xuICAgIHZhciBzbGljZUxlbiA9IGVuZCAtIHN0YXJ0XG4gICAgbmV3QnVmID0gbmV3IEJ1ZmZlcihzbGljZUxlbiwgdW5kZWZpbmVkKVxuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgc2xpY2VMZW47IGkrKykge1xuICAgICAgbmV3QnVmW2ldID0gdGhpc1tpICsgc3RhcnRdXG4gICAgfVxuICB9XG5cbiAgaWYgKG5ld0J1Zi5sZW5ndGgpIG5ld0J1Zi5wYXJlbnQgPSB0aGlzLnBhcmVudCB8fCB0aGlzXG5cbiAgcmV0dXJuIG5ld0J1ZlxufVxuXG4vKlxuICogTmVlZCB0byBtYWtlIHN1cmUgdGhhdCBidWZmZXIgaXNuJ3QgdHJ5aW5nIHRvIHdyaXRlIG91dCBvZiBib3VuZHMuXG4gKi9cbmZ1bmN0aW9uIGNoZWNrT2Zmc2V0IChvZmZzZXQsIGV4dCwgbGVuZ3RoKSB7XG4gIGlmICgob2Zmc2V0ICUgMSkgIT09IDAgfHwgb2Zmc2V0IDwgMCkgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ29mZnNldCBpcyBub3QgdWludCcpXG4gIGlmIChvZmZzZXQgKyBleHQgPiBsZW5ndGgpIHRocm93IG5ldyBSYW5nZUVycm9yKCdUcnlpbmcgdG8gYWNjZXNzIGJleW9uZCBidWZmZXIgbGVuZ3RoJylcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkVUludExFID0gZnVuY3Rpb24gcmVhZFVJbnRMRSAob2Zmc2V0LCBieXRlTGVuZ3RoLCBub0Fzc2VydCkge1xuICBvZmZzZXQgPSBvZmZzZXQgfCAwXG4gIGJ5dGVMZW5ndGggPSBieXRlTGVuZ3RoIHwgMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIGJ5dGVMZW5ndGgsIHRoaXMubGVuZ3RoKVxuXG4gIHZhciB2YWwgPSB0aGlzW29mZnNldF1cbiAgdmFyIG11bCA9IDFcbiAgdmFyIGkgPSAwXG4gIHdoaWxlICgrK2kgPCBieXRlTGVuZ3RoICYmIChtdWwgKj0gMHgxMDApKSB7XG4gICAgdmFsICs9IHRoaXNbb2Zmc2V0ICsgaV0gKiBtdWxcbiAgfVxuXG4gIHJldHVybiB2YWxcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkVUludEJFID0gZnVuY3Rpb24gcmVhZFVJbnRCRSAob2Zmc2V0LCBieXRlTGVuZ3RoLCBub0Fzc2VydCkge1xuICBvZmZzZXQgPSBvZmZzZXQgfCAwXG4gIGJ5dGVMZW5ndGggPSBieXRlTGVuZ3RoIHwgMFxuICBpZiAoIW5vQXNzZXJ0KSB7XG4gICAgY2hlY2tPZmZzZXQob2Zmc2V0LCBieXRlTGVuZ3RoLCB0aGlzLmxlbmd0aClcbiAgfVxuXG4gIHZhciB2YWwgPSB0aGlzW29mZnNldCArIC0tYnl0ZUxlbmd0aF1cbiAgdmFyIG11bCA9IDFcbiAgd2hpbGUgKGJ5dGVMZW5ndGggPiAwICYmIChtdWwgKj0gMHgxMDApKSB7XG4gICAgdmFsICs9IHRoaXNbb2Zmc2V0ICsgLS1ieXRlTGVuZ3RoXSAqIG11bFxuICB9XG5cbiAgcmV0dXJuIHZhbFxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRVSW50OCA9IGZ1bmN0aW9uIHJlYWRVSW50OCAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDEsIHRoaXMubGVuZ3RoKVxuICByZXR1cm4gdGhpc1tvZmZzZXRdXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZFVJbnQxNkxFID0gZnVuY3Rpb24gcmVhZFVJbnQxNkxFIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgMiwgdGhpcy5sZW5ndGgpXG4gIHJldHVybiB0aGlzW29mZnNldF0gfCAodGhpc1tvZmZzZXQgKyAxXSA8PCA4KVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRVSW50MTZCRSA9IGZ1bmN0aW9uIHJlYWRVSW50MTZCRSAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDIsIHRoaXMubGVuZ3RoKVxuICByZXR1cm4gKHRoaXNbb2Zmc2V0XSA8PCA4KSB8IHRoaXNbb2Zmc2V0ICsgMV1cbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkVUludDMyTEUgPSBmdW5jdGlvbiByZWFkVUludDMyTEUgKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCA0LCB0aGlzLmxlbmd0aClcblxuICByZXR1cm4gKCh0aGlzW29mZnNldF0pIHxcbiAgICAgICh0aGlzW29mZnNldCArIDFdIDw8IDgpIHxcbiAgICAgICh0aGlzW29mZnNldCArIDJdIDw8IDE2KSkgK1xuICAgICAgKHRoaXNbb2Zmc2V0ICsgM10gKiAweDEwMDAwMDApXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZFVJbnQzMkJFID0gZnVuY3Rpb24gcmVhZFVJbnQzMkJFIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgNCwgdGhpcy5sZW5ndGgpXG5cbiAgcmV0dXJuICh0aGlzW29mZnNldF0gKiAweDEwMDAwMDApICtcbiAgICAoKHRoaXNbb2Zmc2V0ICsgMV0gPDwgMTYpIHxcbiAgICAodGhpc1tvZmZzZXQgKyAyXSA8PCA4KSB8XG4gICAgdGhpc1tvZmZzZXQgKyAzXSlcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkSW50TEUgPSBmdW5jdGlvbiByZWFkSW50TEUgKG9mZnNldCwgYnl0ZUxlbmd0aCwgbm9Bc3NlcnQpIHtcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBieXRlTGVuZ3RoID0gYnl0ZUxlbmd0aCB8IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCBieXRlTGVuZ3RoLCB0aGlzLmxlbmd0aClcblxuICB2YXIgdmFsID0gdGhpc1tvZmZzZXRdXG4gIHZhciBtdWwgPSAxXG4gIHZhciBpID0gMFxuICB3aGlsZSAoKytpIDwgYnl0ZUxlbmd0aCAmJiAobXVsICo9IDB4MTAwKSkge1xuICAgIHZhbCArPSB0aGlzW29mZnNldCArIGldICogbXVsXG4gIH1cbiAgbXVsICo9IDB4ODBcblxuICBpZiAodmFsID49IG11bCkgdmFsIC09IE1hdGgucG93KDIsIDggKiBieXRlTGVuZ3RoKVxuXG4gIHJldHVybiB2YWxcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkSW50QkUgPSBmdW5jdGlvbiByZWFkSW50QkUgKG9mZnNldCwgYnl0ZUxlbmd0aCwgbm9Bc3NlcnQpIHtcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBieXRlTGVuZ3RoID0gYnl0ZUxlbmd0aCB8IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCBieXRlTGVuZ3RoLCB0aGlzLmxlbmd0aClcblxuICB2YXIgaSA9IGJ5dGVMZW5ndGhcbiAgdmFyIG11bCA9IDFcbiAgdmFyIHZhbCA9IHRoaXNbb2Zmc2V0ICsgLS1pXVxuICB3aGlsZSAoaSA+IDAgJiYgKG11bCAqPSAweDEwMCkpIHtcbiAgICB2YWwgKz0gdGhpc1tvZmZzZXQgKyAtLWldICogbXVsXG4gIH1cbiAgbXVsICo9IDB4ODBcblxuICBpZiAodmFsID49IG11bCkgdmFsIC09IE1hdGgucG93KDIsIDggKiBieXRlTGVuZ3RoKVxuXG4gIHJldHVybiB2YWxcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkSW50OCA9IGZ1bmN0aW9uIHJlYWRJbnQ4IChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgMSwgdGhpcy5sZW5ndGgpXG4gIGlmICghKHRoaXNbb2Zmc2V0XSAmIDB4ODApKSByZXR1cm4gKHRoaXNbb2Zmc2V0XSlcbiAgcmV0dXJuICgoMHhmZiAtIHRoaXNbb2Zmc2V0XSArIDEpICogLTEpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEludDE2TEUgPSBmdW5jdGlvbiByZWFkSW50MTZMRSAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDIsIHRoaXMubGVuZ3RoKVxuICB2YXIgdmFsID0gdGhpc1tvZmZzZXRdIHwgKHRoaXNbb2Zmc2V0ICsgMV0gPDwgOClcbiAgcmV0dXJuICh2YWwgJiAweDgwMDApID8gdmFsIHwgMHhGRkZGMDAwMCA6IHZhbFxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRJbnQxNkJFID0gZnVuY3Rpb24gcmVhZEludDE2QkUgKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCAyLCB0aGlzLmxlbmd0aClcbiAgdmFyIHZhbCA9IHRoaXNbb2Zmc2V0ICsgMV0gfCAodGhpc1tvZmZzZXRdIDw8IDgpXG4gIHJldHVybiAodmFsICYgMHg4MDAwKSA/IHZhbCB8IDB4RkZGRjAwMDAgOiB2YWxcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkSW50MzJMRSA9IGZ1bmN0aW9uIHJlYWRJbnQzMkxFIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgNCwgdGhpcy5sZW5ndGgpXG5cbiAgcmV0dXJuICh0aGlzW29mZnNldF0pIHxcbiAgICAodGhpc1tvZmZzZXQgKyAxXSA8PCA4KSB8XG4gICAgKHRoaXNbb2Zmc2V0ICsgMl0gPDwgMTYpIHxcbiAgICAodGhpc1tvZmZzZXQgKyAzXSA8PCAyNClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkSW50MzJCRSA9IGZ1bmN0aW9uIHJlYWRJbnQzMkJFIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgNCwgdGhpcy5sZW5ndGgpXG5cbiAgcmV0dXJuICh0aGlzW29mZnNldF0gPDwgMjQpIHxcbiAgICAodGhpc1tvZmZzZXQgKyAxXSA8PCAxNikgfFxuICAgICh0aGlzW29mZnNldCArIDJdIDw8IDgpIHxcbiAgICAodGhpc1tvZmZzZXQgKyAzXSlcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkRmxvYXRMRSA9IGZ1bmN0aW9uIHJlYWRGbG9hdExFIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgNCwgdGhpcy5sZW5ndGgpXG4gIHJldHVybiBpZWVlNzU0LnJlYWQodGhpcywgb2Zmc2V0LCB0cnVlLCAyMywgNClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkRmxvYXRCRSA9IGZ1bmN0aW9uIHJlYWRGbG9hdEJFIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgNCwgdGhpcy5sZW5ndGgpXG4gIHJldHVybiBpZWVlNzU0LnJlYWQodGhpcywgb2Zmc2V0LCBmYWxzZSwgMjMsIDQpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZERvdWJsZUxFID0gZnVuY3Rpb24gcmVhZERvdWJsZUxFIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgOCwgdGhpcy5sZW5ndGgpXG4gIHJldHVybiBpZWVlNzU0LnJlYWQodGhpcywgb2Zmc2V0LCB0cnVlLCA1MiwgOClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkRG91YmxlQkUgPSBmdW5jdGlvbiByZWFkRG91YmxlQkUgKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCA4LCB0aGlzLmxlbmd0aClcbiAgcmV0dXJuIGllZWU3NTQucmVhZCh0aGlzLCBvZmZzZXQsIGZhbHNlLCA1MiwgOClcbn1cblxuZnVuY3Rpb24gY2hlY2tJbnQgKGJ1ZiwgdmFsdWUsIG9mZnNldCwgZXh0LCBtYXgsIG1pbikge1xuICBpZiAoIUJ1ZmZlci5pc0J1ZmZlcihidWYpKSB0aHJvdyBuZXcgVHlwZUVycm9yKCdidWZmZXIgbXVzdCBiZSBhIEJ1ZmZlciBpbnN0YW5jZScpXG4gIGlmICh2YWx1ZSA+IG1heCB8fCB2YWx1ZSA8IG1pbikgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ3ZhbHVlIGlzIG91dCBvZiBib3VuZHMnKVxuICBpZiAob2Zmc2V0ICsgZXh0ID4gYnVmLmxlbmd0aCkgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ2luZGV4IG91dCBvZiByYW5nZScpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVVSW50TEUgPSBmdW5jdGlvbiB3cml0ZVVJbnRMRSAodmFsdWUsIG9mZnNldCwgYnl0ZUxlbmd0aCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBieXRlTGVuZ3RoID0gYnl0ZUxlbmd0aCB8IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgYnl0ZUxlbmd0aCwgTWF0aC5wb3coMiwgOCAqIGJ5dGVMZW5ndGgpLCAwKVxuXG4gIHZhciBtdWwgPSAxXG4gIHZhciBpID0gMFxuICB0aGlzW29mZnNldF0gPSB2YWx1ZSAmIDB4RkZcbiAgd2hpbGUgKCsraSA8IGJ5dGVMZW5ndGggJiYgKG11bCAqPSAweDEwMCkpIHtcbiAgICB0aGlzW29mZnNldCArIGldID0gKHZhbHVlIC8gbXVsKSAmIDB4RkZcbiAgfVxuXG4gIHJldHVybiBvZmZzZXQgKyBieXRlTGVuZ3RoXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVVSW50QkUgPSBmdW5jdGlvbiB3cml0ZVVJbnRCRSAodmFsdWUsIG9mZnNldCwgYnl0ZUxlbmd0aCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBieXRlTGVuZ3RoID0gYnl0ZUxlbmd0aCB8IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgYnl0ZUxlbmd0aCwgTWF0aC5wb3coMiwgOCAqIGJ5dGVMZW5ndGgpLCAwKVxuXG4gIHZhciBpID0gYnl0ZUxlbmd0aCAtIDFcbiAgdmFyIG11bCA9IDFcbiAgdGhpc1tvZmZzZXQgKyBpXSA9IHZhbHVlICYgMHhGRlxuICB3aGlsZSAoLS1pID49IDAgJiYgKG11bCAqPSAweDEwMCkpIHtcbiAgICB0aGlzW29mZnNldCArIGldID0gKHZhbHVlIC8gbXVsKSAmIDB4RkZcbiAgfVxuXG4gIHJldHVybiBvZmZzZXQgKyBieXRlTGVuZ3RoXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVVSW50OCA9IGZ1bmN0aW9uIHdyaXRlVUludDggKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgMSwgMHhmZiwgMClcbiAgaWYgKCFCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkgdmFsdWUgPSBNYXRoLmZsb29yKHZhbHVlKVxuICB0aGlzW29mZnNldF0gPSB2YWx1ZVxuICByZXR1cm4gb2Zmc2V0ICsgMVxufVxuXG5mdW5jdGlvbiBvYmplY3RXcml0ZVVJbnQxNiAoYnVmLCB2YWx1ZSwgb2Zmc2V0LCBsaXR0bGVFbmRpYW4pIHtcbiAgaWYgKHZhbHVlIDwgMCkgdmFsdWUgPSAweGZmZmYgKyB2YWx1ZSArIDFcbiAgZm9yICh2YXIgaSA9IDAsIGogPSBNYXRoLm1pbihidWYubGVuZ3RoIC0gb2Zmc2V0LCAyKTsgaSA8IGo7IGkrKykge1xuICAgIGJ1ZltvZmZzZXQgKyBpXSA9ICh2YWx1ZSAmICgweGZmIDw8ICg4ICogKGxpdHRsZUVuZGlhbiA/IGkgOiAxIC0gaSkpKSkgPj4+XG4gICAgICAobGl0dGxlRW5kaWFuID8gaSA6IDEgLSBpKSAqIDhcbiAgfVxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlVUludDE2TEUgPSBmdW5jdGlvbiB3cml0ZVVJbnQxNkxFICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgfCAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIDIsIDB4ZmZmZiwgMClcbiAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgdGhpc1tvZmZzZXRdID0gdmFsdWVcbiAgICB0aGlzW29mZnNldCArIDFdID0gKHZhbHVlID4+PiA4KVxuICB9IGVsc2Uge1xuICAgIG9iamVjdFdyaXRlVUludDE2KHRoaXMsIHZhbHVlLCBvZmZzZXQsIHRydWUpXG4gIH1cbiAgcmV0dXJuIG9mZnNldCArIDJcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZVVJbnQxNkJFID0gZnVuY3Rpb24gd3JpdGVVSW50MTZCRSAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCAyLCAweGZmZmYsIDApXG4gIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIHRoaXNbb2Zmc2V0XSA9ICh2YWx1ZSA+Pj4gOClcbiAgICB0aGlzW29mZnNldCArIDFdID0gdmFsdWVcbiAgfSBlbHNlIHtcbiAgICBvYmplY3RXcml0ZVVJbnQxNih0aGlzLCB2YWx1ZSwgb2Zmc2V0LCBmYWxzZSlcbiAgfVxuICByZXR1cm4gb2Zmc2V0ICsgMlxufVxuXG5mdW5jdGlvbiBvYmplY3RXcml0ZVVJbnQzMiAoYnVmLCB2YWx1ZSwgb2Zmc2V0LCBsaXR0bGVFbmRpYW4pIHtcbiAgaWYgKHZhbHVlIDwgMCkgdmFsdWUgPSAweGZmZmZmZmZmICsgdmFsdWUgKyAxXG4gIGZvciAodmFyIGkgPSAwLCBqID0gTWF0aC5taW4oYnVmLmxlbmd0aCAtIG9mZnNldCwgNCk7IGkgPCBqOyBpKyspIHtcbiAgICBidWZbb2Zmc2V0ICsgaV0gPSAodmFsdWUgPj4+IChsaXR0bGVFbmRpYW4gPyBpIDogMyAtIGkpICogOCkgJiAweGZmXG4gIH1cbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZVVJbnQzMkxFID0gZnVuY3Rpb24gd3JpdGVVSW50MzJMRSAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCA0LCAweGZmZmZmZmZmLCAwKVxuICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICB0aGlzW29mZnNldCArIDNdID0gKHZhbHVlID4+PiAyNClcbiAgICB0aGlzW29mZnNldCArIDJdID0gKHZhbHVlID4+PiAxNilcbiAgICB0aGlzW29mZnNldCArIDFdID0gKHZhbHVlID4+PiA4KVxuICAgIHRoaXNbb2Zmc2V0XSA9IHZhbHVlXG4gIH0gZWxzZSB7XG4gICAgb2JqZWN0V3JpdGVVSW50MzIodGhpcywgdmFsdWUsIG9mZnNldCwgdHJ1ZSlcbiAgfVxuICByZXR1cm4gb2Zmc2V0ICsgNFxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlVUludDMyQkUgPSBmdW5jdGlvbiB3cml0ZVVJbnQzMkJFICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgfCAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIDQsIDB4ZmZmZmZmZmYsIDApXG4gIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIHRoaXNbb2Zmc2V0XSA9ICh2YWx1ZSA+Pj4gMjQpXG4gICAgdGhpc1tvZmZzZXQgKyAxXSA9ICh2YWx1ZSA+Pj4gMTYpXG4gICAgdGhpc1tvZmZzZXQgKyAyXSA9ICh2YWx1ZSA+Pj4gOClcbiAgICB0aGlzW29mZnNldCArIDNdID0gdmFsdWVcbiAgfSBlbHNlIHtcbiAgICBvYmplY3RXcml0ZVVJbnQzMih0aGlzLCB2YWx1ZSwgb2Zmc2V0LCBmYWxzZSlcbiAgfVxuICByZXR1cm4gb2Zmc2V0ICsgNFxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlSW50TEUgPSBmdW5jdGlvbiB3cml0ZUludExFICh2YWx1ZSwgb2Zmc2V0LCBieXRlTGVuZ3RoLCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgfCAwXG4gIGlmICghbm9Bc3NlcnQpIHtcbiAgICB2YXIgbGltaXQgPSBNYXRoLnBvdygyLCA4ICogYnl0ZUxlbmd0aCAtIDEpXG5cbiAgICBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCBieXRlTGVuZ3RoLCBsaW1pdCAtIDEsIC1saW1pdClcbiAgfVxuXG4gIHZhciBpID0gMFxuICB2YXIgbXVsID0gMVxuICB2YXIgc3ViID0gdmFsdWUgPCAwID8gMSA6IDBcbiAgdGhpc1tvZmZzZXRdID0gdmFsdWUgJiAweEZGXG4gIHdoaWxlICgrK2kgPCBieXRlTGVuZ3RoICYmIChtdWwgKj0gMHgxMDApKSB7XG4gICAgdGhpc1tvZmZzZXQgKyBpXSA9ICgodmFsdWUgLyBtdWwpID4+IDApIC0gc3ViICYgMHhGRlxuICB9XG5cbiAgcmV0dXJuIG9mZnNldCArIGJ5dGVMZW5ndGhcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUludEJFID0gZnVuY3Rpb24gd3JpdGVJbnRCRSAodmFsdWUsIG9mZnNldCwgYnl0ZUxlbmd0aCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBpZiAoIW5vQXNzZXJ0KSB7XG4gICAgdmFyIGxpbWl0ID0gTWF0aC5wb3coMiwgOCAqIGJ5dGVMZW5ndGggLSAxKVxuXG4gICAgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgYnl0ZUxlbmd0aCwgbGltaXQgLSAxLCAtbGltaXQpXG4gIH1cblxuICB2YXIgaSA9IGJ5dGVMZW5ndGggLSAxXG4gIHZhciBtdWwgPSAxXG4gIHZhciBzdWIgPSB2YWx1ZSA8IDAgPyAxIDogMFxuICB0aGlzW29mZnNldCArIGldID0gdmFsdWUgJiAweEZGXG4gIHdoaWxlICgtLWkgPj0gMCAmJiAobXVsICo9IDB4MTAwKSkge1xuICAgIHRoaXNbb2Zmc2V0ICsgaV0gPSAoKHZhbHVlIC8gbXVsKSA+PiAwKSAtIHN1YiAmIDB4RkZcbiAgfVxuXG4gIHJldHVybiBvZmZzZXQgKyBieXRlTGVuZ3RoXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVJbnQ4ID0gZnVuY3Rpb24gd3JpdGVJbnQ4ICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgfCAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIDEsIDB4N2YsIC0weDgwKVxuICBpZiAoIUJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB2YWx1ZSA9IE1hdGguZmxvb3IodmFsdWUpXG4gIGlmICh2YWx1ZSA8IDApIHZhbHVlID0gMHhmZiArIHZhbHVlICsgMVxuICB0aGlzW29mZnNldF0gPSB2YWx1ZVxuICByZXR1cm4gb2Zmc2V0ICsgMVxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlSW50MTZMRSA9IGZ1bmN0aW9uIHdyaXRlSW50MTZMRSAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCAyLCAweDdmZmYsIC0weDgwMDApXG4gIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIHRoaXNbb2Zmc2V0XSA9IHZhbHVlXG4gICAgdGhpc1tvZmZzZXQgKyAxXSA9ICh2YWx1ZSA+Pj4gOClcbiAgfSBlbHNlIHtcbiAgICBvYmplY3RXcml0ZVVJbnQxNih0aGlzLCB2YWx1ZSwgb2Zmc2V0LCB0cnVlKVxuICB9XG4gIHJldHVybiBvZmZzZXQgKyAyXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVJbnQxNkJFID0gZnVuY3Rpb24gd3JpdGVJbnQxNkJFICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgfCAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIDIsIDB4N2ZmZiwgLTB4ODAwMClcbiAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgdGhpc1tvZmZzZXRdID0gKHZhbHVlID4+PiA4KVxuICAgIHRoaXNbb2Zmc2V0ICsgMV0gPSB2YWx1ZVxuICB9IGVsc2Uge1xuICAgIG9iamVjdFdyaXRlVUludDE2KHRoaXMsIHZhbHVlLCBvZmZzZXQsIGZhbHNlKVxuICB9XG4gIHJldHVybiBvZmZzZXQgKyAyXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVJbnQzMkxFID0gZnVuY3Rpb24gd3JpdGVJbnQzMkxFICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgfCAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIDQsIDB4N2ZmZmZmZmYsIC0weDgwMDAwMDAwKVxuICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICB0aGlzW29mZnNldF0gPSB2YWx1ZVxuICAgIHRoaXNbb2Zmc2V0ICsgMV0gPSAodmFsdWUgPj4+IDgpXG4gICAgdGhpc1tvZmZzZXQgKyAyXSA9ICh2YWx1ZSA+Pj4gMTYpXG4gICAgdGhpc1tvZmZzZXQgKyAzXSA9ICh2YWx1ZSA+Pj4gMjQpXG4gIH0gZWxzZSB7XG4gICAgb2JqZWN0V3JpdGVVSW50MzIodGhpcywgdmFsdWUsIG9mZnNldCwgdHJ1ZSlcbiAgfVxuICByZXR1cm4gb2Zmc2V0ICsgNFxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlSW50MzJCRSA9IGZ1bmN0aW9uIHdyaXRlSW50MzJCRSAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCA0LCAweDdmZmZmZmZmLCAtMHg4MDAwMDAwMClcbiAgaWYgKHZhbHVlIDwgMCkgdmFsdWUgPSAweGZmZmZmZmZmICsgdmFsdWUgKyAxXG4gIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIHRoaXNbb2Zmc2V0XSA9ICh2YWx1ZSA+Pj4gMjQpXG4gICAgdGhpc1tvZmZzZXQgKyAxXSA9ICh2YWx1ZSA+Pj4gMTYpXG4gICAgdGhpc1tvZmZzZXQgKyAyXSA9ICh2YWx1ZSA+Pj4gOClcbiAgICB0aGlzW29mZnNldCArIDNdID0gdmFsdWVcbiAgfSBlbHNlIHtcbiAgICBvYmplY3RXcml0ZVVJbnQzMih0aGlzLCB2YWx1ZSwgb2Zmc2V0LCBmYWxzZSlcbiAgfVxuICByZXR1cm4gb2Zmc2V0ICsgNFxufVxuXG5mdW5jdGlvbiBjaGVja0lFRUU3NTQgKGJ1ZiwgdmFsdWUsIG9mZnNldCwgZXh0LCBtYXgsIG1pbikge1xuICBpZiAodmFsdWUgPiBtYXggfHwgdmFsdWUgPCBtaW4pIHRocm93IG5ldyBSYW5nZUVycm9yKCd2YWx1ZSBpcyBvdXQgb2YgYm91bmRzJylcbiAgaWYgKG9mZnNldCArIGV4dCA+IGJ1Zi5sZW5ndGgpIHRocm93IG5ldyBSYW5nZUVycm9yKCdpbmRleCBvdXQgb2YgcmFuZ2UnKVxuICBpZiAob2Zmc2V0IDwgMCkgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ2luZGV4IG91dCBvZiByYW5nZScpXG59XG5cbmZ1bmN0aW9uIHdyaXRlRmxvYXQgKGJ1ZiwgdmFsdWUsIG9mZnNldCwgbGl0dGxlRW5kaWFuLCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSB7XG4gICAgY2hlY2tJRUVFNzU0KGJ1ZiwgdmFsdWUsIG9mZnNldCwgNCwgMy40MDI4MjM0NjYzODUyODg2ZSszOCwgLTMuNDAyODIzNDY2Mzg1Mjg4NmUrMzgpXG4gIH1cbiAgaWVlZTc1NC53cml0ZShidWYsIHZhbHVlLCBvZmZzZXQsIGxpdHRsZUVuZGlhbiwgMjMsIDQpXG4gIHJldHVybiBvZmZzZXQgKyA0XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVGbG9hdExFID0gZnVuY3Rpb24gd3JpdGVGbG9hdExFICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICByZXR1cm4gd3JpdGVGbG9hdCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCB0cnVlLCBub0Fzc2VydClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUZsb2F0QkUgPSBmdW5jdGlvbiB3cml0ZUZsb2F0QkUgKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHJldHVybiB3cml0ZUZsb2F0KHRoaXMsIHZhbHVlLCBvZmZzZXQsIGZhbHNlLCBub0Fzc2VydClcbn1cblxuZnVuY3Rpb24gd3JpdGVEb3VibGUgKGJ1ZiwgdmFsdWUsIG9mZnNldCwgbGl0dGxlRW5kaWFuLCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSB7XG4gICAgY2hlY2tJRUVFNzU0KGJ1ZiwgdmFsdWUsIG9mZnNldCwgOCwgMS43OTc2OTMxMzQ4NjIzMTU3RSszMDgsIC0xLjc5NzY5MzEzNDg2MjMxNTdFKzMwOClcbiAgfVxuICBpZWVlNzU0LndyaXRlKGJ1ZiwgdmFsdWUsIG9mZnNldCwgbGl0dGxlRW5kaWFuLCA1MiwgOClcbiAgcmV0dXJuIG9mZnNldCArIDhcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZURvdWJsZUxFID0gZnVuY3Rpb24gd3JpdGVEb3VibGVMRSAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgcmV0dXJuIHdyaXRlRG91YmxlKHRoaXMsIHZhbHVlLCBvZmZzZXQsIHRydWUsIG5vQXNzZXJ0KVxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlRG91YmxlQkUgPSBmdW5jdGlvbiB3cml0ZURvdWJsZUJFICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICByZXR1cm4gd3JpdGVEb3VibGUodGhpcywgdmFsdWUsIG9mZnNldCwgZmFsc2UsIG5vQXNzZXJ0KVxufVxuXG4vLyBjb3B5KHRhcmdldEJ1ZmZlciwgdGFyZ2V0U3RhcnQ9MCwgc291cmNlU3RhcnQ9MCwgc291cmNlRW5kPWJ1ZmZlci5sZW5ndGgpXG5CdWZmZXIucHJvdG90eXBlLmNvcHkgPSBmdW5jdGlvbiBjb3B5ICh0YXJnZXQsIHRhcmdldFN0YXJ0LCBzdGFydCwgZW5kKSB7XG4gIGlmICghc3RhcnQpIHN0YXJ0ID0gMFxuICBpZiAoIWVuZCAmJiBlbmQgIT09IDApIGVuZCA9IHRoaXMubGVuZ3RoXG4gIGlmICh0YXJnZXRTdGFydCA+PSB0YXJnZXQubGVuZ3RoKSB0YXJnZXRTdGFydCA9IHRhcmdldC5sZW5ndGhcbiAgaWYgKCF0YXJnZXRTdGFydCkgdGFyZ2V0U3RhcnQgPSAwXG4gIGlmIChlbmQgPiAwICYmIGVuZCA8IHN0YXJ0KSBlbmQgPSBzdGFydFxuXG4gIC8vIENvcHkgMCBieXRlczsgd2UncmUgZG9uZVxuICBpZiAoZW5kID09PSBzdGFydCkgcmV0dXJuIDBcbiAgaWYgKHRhcmdldC5sZW5ndGggPT09IDAgfHwgdGhpcy5sZW5ndGggPT09IDApIHJldHVybiAwXG5cbiAgLy8gRmF0YWwgZXJyb3IgY29uZGl0aW9uc1xuICBpZiAodGFyZ2V0U3RhcnQgPCAwKSB7XG4gICAgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ3RhcmdldFN0YXJ0IG91dCBvZiBib3VuZHMnKVxuICB9XG4gIGlmIChzdGFydCA8IDAgfHwgc3RhcnQgPj0gdGhpcy5sZW5ndGgpIHRocm93IG5ldyBSYW5nZUVycm9yKCdzb3VyY2VTdGFydCBvdXQgb2YgYm91bmRzJylcbiAgaWYgKGVuZCA8IDApIHRocm93IG5ldyBSYW5nZUVycm9yKCdzb3VyY2VFbmQgb3V0IG9mIGJvdW5kcycpXG5cbiAgLy8gQXJlIHdlIG9vYj9cbiAgaWYgKGVuZCA+IHRoaXMubGVuZ3RoKSBlbmQgPSB0aGlzLmxlbmd0aFxuICBpZiAodGFyZ2V0Lmxlbmd0aCAtIHRhcmdldFN0YXJ0IDwgZW5kIC0gc3RhcnQpIHtcbiAgICBlbmQgPSB0YXJnZXQubGVuZ3RoIC0gdGFyZ2V0U3RhcnQgKyBzdGFydFxuICB9XG5cbiAgdmFyIGxlbiA9IGVuZCAtIHN0YXJ0XG4gIHZhciBpXG5cbiAgaWYgKHRoaXMgPT09IHRhcmdldCAmJiBzdGFydCA8IHRhcmdldFN0YXJ0ICYmIHRhcmdldFN0YXJ0IDwgZW5kKSB7XG4gICAgLy8gZGVzY2VuZGluZyBjb3B5IGZyb20gZW5kXG4gICAgZm9yIChpID0gbGVuIC0gMTsgaSA+PSAwOyBpLS0pIHtcbiAgICAgIHRhcmdldFtpICsgdGFyZ2V0U3RhcnRdID0gdGhpc1tpICsgc3RhcnRdXG4gICAgfVxuICB9IGVsc2UgaWYgKGxlbiA8IDEwMDAgfHwgIUJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgLy8gYXNjZW5kaW5nIGNvcHkgZnJvbSBzdGFydFxuICAgIGZvciAoaSA9IDA7IGkgPCBsZW47IGkrKykge1xuICAgICAgdGFyZ2V0W2kgKyB0YXJnZXRTdGFydF0gPSB0aGlzW2kgKyBzdGFydF1cbiAgICB9XG4gIH0gZWxzZSB7XG4gICAgdGFyZ2V0Ll9zZXQodGhpcy5zdWJhcnJheShzdGFydCwgc3RhcnQgKyBsZW4pLCB0YXJnZXRTdGFydClcbiAgfVxuXG4gIHJldHVybiBsZW5cbn1cblxuLy8gZmlsbCh2YWx1ZSwgc3RhcnQ9MCwgZW5kPWJ1ZmZlci5sZW5ndGgpXG5CdWZmZXIucHJvdG90eXBlLmZpbGwgPSBmdW5jdGlvbiBmaWxsICh2YWx1ZSwgc3RhcnQsIGVuZCkge1xuICBpZiAoIXZhbHVlKSB2YWx1ZSA9IDBcbiAgaWYgKCFzdGFydCkgc3RhcnQgPSAwXG4gIGlmICghZW5kKSBlbmQgPSB0aGlzLmxlbmd0aFxuXG4gIGlmIChlbmQgPCBzdGFydCkgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ2VuZCA8IHN0YXJ0JylcblxuICAvLyBGaWxsIDAgYnl0ZXM7IHdlJ3JlIGRvbmVcbiAgaWYgKGVuZCA9PT0gc3RhcnQpIHJldHVyblxuICBpZiAodGhpcy5sZW5ndGggPT09IDApIHJldHVyblxuXG4gIGlmIChzdGFydCA8IDAgfHwgc3RhcnQgPj0gdGhpcy5sZW5ndGgpIHRocm93IG5ldyBSYW5nZUVycm9yKCdzdGFydCBvdXQgb2YgYm91bmRzJylcbiAgaWYgKGVuZCA8IDAgfHwgZW5kID4gdGhpcy5sZW5ndGgpIHRocm93IG5ldyBSYW5nZUVycm9yKCdlbmQgb3V0IG9mIGJvdW5kcycpXG5cbiAgdmFyIGlcbiAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gJ251bWJlcicpIHtcbiAgICBmb3IgKGkgPSBzdGFydDsgaSA8IGVuZDsgaSsrKSB7XG4gICAgICB0aGlzW2ldID0gdmFsdWVcbiAgICB9XG4gIH0gZWxzZSB7XG4gICAgdmFyIGJ5dGVzID0gdXRmOFRvQnl0ZXModmFsdWUudG9TdHJpbmcoKSlcbiAgICB2YXIgbGVuID0gYnl0ZXMubGVuZ3RoXG4gICAgZm9yIChpID0gc3RhcnQ7IGkgPCBlbmQ7IGkrKykge1xuICAgICAgdGhpc1tpXSA9IGJ5dGVzW2kgJSBsZW5dXG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHRoaXNcbn1cblxuLyoqXG4gKiBDcmVhdGVzIGEgbmV3IGBBcnJheUJ1ZmZlcmAgd2l0aCB0aGUgKmNvcGllZCogbWVtb3J5IG9mIHRoZSBidWZmZXIgaW5zdGFuY2UuXG4gKiBBZGRlZCBpbiBOb2RlIDAuMTIuIE9ubHkgYXZhaWxhYmxlIGluIGJyb3dzZXJzIHRoYXQgc3VwcG9ydCBBcnJheUJ1ZmZlci5cbiAqL1xuQnVmZmVyLnByb3RvdHlwZS50b0FycmF5QnVmZmVyID0gZnVuY3Rpb24gdG9BcnJheUJ1ZmZlciAoKSB7XG4gIGlmICh0eXBlb2YgVWludDhBcnJheSAhPT0gJ3VuZGVmaW5lZCcpIHtcbiAgICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICAgIHJldHVybiAobmV3IEJ1ZmZlcih0aGlzKSkuYnVmZmVyXG4gICAgfSBlbHNlIHtcbiAgICAgIHZhciBidWYgPSBuZXcgVWludDhBcnJheSh0aGlzLmxlbmd0aClcbiAgICAgIGZvciAodmFyIGkgPSAwLCBsZW4gPSBidWYubGVuZ3RoOyBpIDwgbGVuOyBpICs9IDEpIHtcbiAgICAgICAgYnVmW2ldID0gdGhpc1tpXVxuICAgICAgfVxuICAgICAgcmV0dXJuIGJ1Zi5idWZmZXJcbiAgICB9XG4gIH0gZWxzZSB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcignQnVmZmVyLnRvQXJyYXlCdWZmZXIgbm90IHN1cHBvcnRlZCBpbiB0aGlzIGJyb3dzZXInKVxuICB9XG59XG5cbi8vIEhFTFBFUiBGVU5DVElPTlNcbi8vID09PT09PT09PT09PT09PT1cblxudmFyIEJQID0gQnVmZmVyLnByb3RvdHlwZVxuXG4vKipcbiAqIEF1Z21lbnQgYSBVaW50OEFycmF5ICppbnN0YW5jZSogKG5vdCB0aGUgVWludDhBcnJheSBjbGFzcyEpIHdpdGggQnVmZmVyIG1ldGhvZHNcbiAqL1xuQnVmZmVyLl9hdWdtZW50ID0gZnVuY3Rpb24gX2F1Z21lbnQgKGFycikge1xuICBhcnIuY29uc3RydWN0b3IgPSBCdWZmZXJcbiAgYXJyLl9pc0J1ZmZlciA9IHRydWVcblxuICAvLyBzYXZlIHJlZmVyZW5jZSB0byBvcmlnaW5hbCBVaW50OEFycmF5IHNldCBtZXRob2QgYmVmb3JlIG92ZXJ3cml0aW5nXG4gIGFyci5fc2V0ID0gYXJyLnNldFxuXG4gIC8vIGRlcHJlY2F0ZWRcbiAgYXJyLmdldCA9IEJQLmdldFxuICBhcnIuc2V0ID0gQlAuc2V0XG5cbiAgYXJyLndyaXRlID0gQlAud3JpdGVcbiAgYXJyLnRvU3RyaW5nID0gQlAudG9TdHJpbmdcbiAgYXJyLnRvTG9jYWxlU3RyaW5nID0gQlAudG9TdHJpbmdcbiAgYXJyLnRvSlNPTiA9IEJQLnRvSlNPTlxuICBhcnIuZXF1YWxzID0gQlAuZXF1YWxzXG4gIGFyci5jb21wYXJlID0gQlAuY29tcGFyZVxuICBhcnIuaW5kZXhPZiA9IEJQLmluZGV4T2ZcbiAgYXJyLmNvcHkgPSBCUC5jb3B5XG4gIGFyci5zbGljZSA9IEJQLnNsaWNlXG4gIGFyci5yZWFkVUludExFID0gQlAucmVhZFVJbnRMRVxuICBhcnIucmVhZFVJbnRCRSA9IEJQLnJlYWRVSW50QkVcbiAgYXJyLnJlYWRVSW50OCA9IEJQLnJlYWRVSW50OFxuICBhcnIucmVhZFVJbnQxNkxFID0gQlAucmVhZFVJbnQxNkxFXG4gIGFyci5yZWFkVUludDE2QkUgPSBCUC5yZWFkVUludDE2QkVcbiAgYXJyLnJlYWRVSW50MzJMRSA9IEJQLnJlYWRVSW50MzJMRVxuICBhcnIucmVhZFVJbnQzMkJFID0gQlAucmVhZFVJbnQzMkJFXG4gIGFyci5yZWFkSW50TEUgPSBCUC5yZWFkSW50TEVcbiAgYXJyLnJlYWRJbnRCRSA9IEJQLnJlYWRJbnRCRVxuICBhcnIucmVhZEludDggPSBCUC5yZWFkSW50OFxuICBhcnIucmVhZEludDE2TEUgPSBCUC5yZWFkSW50MTZMRVxuICBhcnIucmVhZEludDE2QkUgPSBCUC5yZWFkSW50MTZCRVxuICBhcnIucmVhZEludDMyTEUgPSBCUC5yZWFkSW50MzJMRVxuICBhcnIucmVhZEludDMyQkUgPSBCUC5yZWFkSW50MzJCRVxuICBhcnIucmVhZEZsb2F0TEUgPSBCUC5yZWFkRmxvYXRMRVxuICBhcnIucmVhZEZsb2F0QkUgPSBCUC5yZWFkRmxvYXRCRVxuICBhcnIucmVhZERvdWJsZUxFID0gQlAucmVhZERvdWJsZUxFXG4gIGFyci5yZWFkRG91YmxlQkUgPSBCUC5yZWFkRG91YmxlQkVcbiAgYXJyLndyaXRlVUludDggPSBCUC53cml0ZVVJbnQ4XG4gIGFyci53cml0ZVVJbnRMRSA9IEJQLndyaXRlVUludExFXG4gIGFyci53cml0ZVVJbnRCRSA9IEJQLndyaXRlVUludEJFXG4gIGFyci53cml0ZVVJbnQxNkxFID0gQlAud3JpdGVVSW50MTZMRVxuICBhcnIud3JpdGVVSW50MTZCRSA9IEJQLndyaXRlVUludDE2QkVcbiAgYXJyLndyaXRlVUludDMyTEUgPSBCUC53cml0ZVVJbnQzMkxFXG4gIGFyci53cml0ZVVJbnQzMkJFID0gQlAud3JpdGVVSW50MzJCRVxuICBhcnIud3JpdGVJbnRMRSA9IEJQLndyaXRlSW50TEVcbiAgYXJyLndyaXRlSW50QkUgPSBCUC53cml0ZUludEJFXG4gIGFyci53cml0ZUludDggPSBCUC53cml0ZUludDhcbiAgYXJyLndyaXRlSW50MTZMRSA9IEJQLndyaXRlSW50MTZMRVxuICBhcnIud3JpdGVJbnQxNkJFID0gQlAud3JpdGVJbnQxNkJFXG4gIGFyci53cml0ZUludDMyTEUgPSBCUC53cml0ZUludDMyTEVcbiAgYXJyLndyaXRlSW50MzJCRSA9IEJQLndyaXRlSW50MzJCRVxuICBhcnIud3JpdGVGbG9hdExFID0gQlAud3JpdGVGbG9hdExFXG4gIGFyci53cml0ZUZsb2F0QkUgPSBCUC53cml0ZUZsb2F0QkVcbiAgYXJyLndyaXRlRG91YmxlTEUgPSBCUC53cml0ZURvdWJsZUxFXG4gIGFyci53cml0ZURvdWJsZUJFID0gQlAud3JpdGVEb3VibGVCRVxuICBhcnIuZmlsbCA9IEJQLmZpbGxcbiAgYXJyLmluc3BlY3QgPSBCUC5pbnNwZWN0XG4gIGFyci50b0FycmF5QnVmZmVyID0gQlAudG9BcnJheUJ1ZmZlclxuXG4gIHJldHVybiBhcnJcbn1cblxudmFyIElOVkFMSURfQkFTRTY0X1JFID0gL1teK1xcLzAtOUEtWmEtei1fXS9nXG5cbmZ1bmN0aW9uIGJhc2U2NGNsZWFuIChzdHIpIHtcbiAgLy8gTm9kZSBzdHJpcHMgb3V0IGludmFsaWQgY2hhcmFjdGVycyBsaWtlIFxcbiBhbmQgXFx0IGZyb20gdGhlIHN0cmluZywgYmFzZTY0LWpzIGRvZXMgbm90XG4gIHN0ciA9IHN0cmluZ3RyaW0oc3RyKS5yZXBsYWNlKElOVkFMSURfQkFTRTY0X1JFLCAnJylcbiAgLy8gTm9kZSBjb252ZXJ0cyBzdHJpbmdzIHdpdGggbGVuZ3RoIDwgMiB0byAnJ1xuICBpZiAoc3RyLmxlbmd0aCA8IDIpIHJldHVybiAnJ1xuICAvLyBOb2RlIGFsbG93cyBmb3Igbm9uLXBhZGRlZCBiYXNlNjQgc3RyaW5ncyAobWlzc2luZyB0cmFpbGluZyA9PT0pLCBiYXNlNjQtanMgZG9lcyBub3RcbiAgd2hpbGUgKHN0ci5sZW5ndGggJSA0ICE9PSAwKSB7XG4gICAgc3RyID0gc3RyICsgJz0nXG4gIH1cbiAgcmV0dXJuIHN0clxufVxuXG5mdW5jdGlvbiBzdHJpbmd0cmltIChzdHIpIHtcbiAgaWYgKHN0ci50cmltKSByZXR1cm4gc3RyLnRyaW0oKVxuICByZXR1cm4gc3RyLnJlcGxhY2UoL15cXHMrfFxccyskL2csICcnKVxufVxuXG5mdW5jdGlvbiB0b0hleCAobikge1xuICBpZiAobiA8IDE2KSByZXR1cm4gJzAnICsgbi50b1N0cmluZygxNilcbiAgcmV0dXJuIG4udG9TdHJpbmcoMTYpXG59XG5cbmZ1bmN0aW9uIHV0ZjhUb0J5dGVzIChzdHJpbmcsIHVuaXRzKSB7XG4gIHVuaXRzID0gdW5pdHMgfHwgSW5maW5pdHlcbiAgdmFyIGNvZGVQb2ludFxuICB2YXIgbGVuZ3RoID0gc3RyaW5nLmxlbmd0aFxuICB2YXIgbGVhZFN1cnJvZ2F0ZSA9IG51bGxcbiAgdmFyIGJ5dGVzID0gW11cblxuICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbmd0aDsgaSsrKSB7XG4gICAgY29kZVBvaW50ID0gc3RyaW5nLmNoYXJDb2RlQXQoaSlcblxuICAgIC8vIGlzIHN1cnJvZ2F0ZSBjb21wb25lbnRcbiAgICBpZiAoY29kZVBvaW50ID4gMHhEN0ZGICYmIGNvZGVQb2ludCA8IDB4RTAwMCkge1xuICAgICAgLy8gbGFzdCBjaGFyIHdhcyBhIGxlYWRcbiAgICAgIGlmICghbGVhZFN1cnJvZ2F0ZSkge1xuICAgICAgICAvLyBubyBsZWFkIHlldFxuICAgICAgICBpZiAoY29kZVBvaW50ID4gMHhEQkZGKSB7XG4gICAgICAgICAgLy8gdW5leHBlY3RlZCB0cmFpbFxuICAgICAgICAgIGlmICgodW5pdHMgLT0gMykgPiAtMSkgYnl0ZXMucHVzaCgweEVGLCAweEJGLCAweEJEKVxuICAgICAgICAgIGNvbnRpbnVlXG5cbiAgICAgICAgfSBlbHNlIGlmIChpICsgMSA9PT0gbGVuZ3RoKSB7XG4gICAgICAgICAgLy8gdW5wYWlyZWQgbGVhZFxuICAgICAgICAgIGlmICgodW5pdHMgLT0gMykgPiAtMSkgYnl0ZXMucHVzaCgweEVGLCAweEJGLCAweEJEKVxuICAgICAgICAgIGNvbnRpbnVlXG4gICAgICAgIH1cblxuICAgICAgICAvLyB2YWxpZCBsZWFkXG4gICAgICAgIGxlYWRTdXJyb2dhdGUgPSBjb2RlUG9pbnRcblxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICAvLyAyIGxlYWRzIGluIGEgcm93XG4gICAgICBpZiAoY29kZVBvaW50IDwgMHhEQzAwKSB7XG4gICAgICAgIGlmICgodW5pdHMgLT0gMykgPiAtMSkgYnl0ZXMucHVzaCgweEVGLCAweEJGLCAweEJEKVxuICAgICAgICBsZWFkU3Vycm9nYXRlID0gY29kZVBvaW50XG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIC8vIHZhbGlkIHN1cnJvZ2F0ZSBwYWlyXG4gICAgICBjb2RlUG9pbnQgPSBsZWFkU3Vycm9nYXRlIC0gMHhEODAwIDw8IDEwIHwgY29kZVBvaW50IC0gMHhEQzAwIHwgMHgxMDAwMFxuXG4gICAgfSBlbHNlIGlmIChsZWFkU3Vycm9nYXRlKSB7XG4gICAgICAvLyB2YWxpZCBibXAgY2hhciwgYnV0IGxhc3QgY2hhciB3YXMgYSBsZWFkXG4gICAgICBpZiAoKHVuaXRzIC09IDMpID4gLTEpIGJ5dGVzLnB1c2goMHhFRiwgMHhCRiwgMHhCRClcbiAgICB9XG5cbiAgICBsZWFkU3Vycm9nYXRlID0gbnVsbFxuXG4gICAgLy8gZW5jb2RlIHV0ZjhcbiAgICBpZiAoY29kZVBvaW50IDwgMHg4MCkge1xuICAgICAgaWYgKCh1bml0cyAtPSAxKSA8IDApIGJyZWFrXG4gICAgICBieXRlcy5wdXNoKGNvZGVQb2ludClcbiAgICB9IGVsc2UgaWYgKGNvZGVQb2ludCA8IDB4ODAwKSB7XG4gICAgICBpZiAoKHVuaXRzIC09IDIpIDwgMCkgYnJlYWtcbiAgICAgIGJ5dGVzLnB1c2goXG4gICAgICAgIGNvZGVQb2ludCA+PiAweDYgfCAweEMwLFxuICAgICAgICBjb2RlUG9pbnQgJiAweDNGIHwgMHg4MFxuICAgICAgKVxuICAgIH0gZWxzZSBpZiAoY29kZVBvaW50IDwgMHgxMDAwMCkge1xuICAgICAgaWYgKCh1bml0cyAtPSAzKSA8IDApIGJyZWFrXG4gICAgICBieXRlcy5wdXNoKFxuICAgICAgICBjb2RlUG9pbnQgPj4gMHhDIHwgMHhFMCxcbiAgICAgICAgY29kZVBvaW50ID4+IDB4NiAmIDB4M0YgfCAweDgwLFxuICAgICAgICBjb2RlUG9pbnQgJiAweDNGIHwgMHg4MFxuICAgICAgKVxuICAgIH0gZWxzZSBpZiAoY29kZVBvaW50IDwgMHgxMTAwMDApIHtcbiAgICAgIGlmICgodW5pdHMgLT0gNCkgPCAwKSBicmVha1xuICAgICAgYnl0ZXMucHVzaChcbiAgICAgICAgY29kZVBvaW50ID4+IDB4MTIgfCAweEYwLFxuICAgICAgICBjb2RlUG9pbnQgPj4gMHhDICYgMHgzRiB8IDB4ODAsXG4gICAgICAgIGNvZGVQb2ludCA+PiAweDYgJiAweDNGIHwgMHg4MCxcbiAgICAgICAgY29kZVBvaW50ICYgMHgzRiB8IDB4ODBcbiAgICAgIClcbiAgICB9IGVsc2Uge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdJbnZhbGlkIGNvZGUgcG9pbnQnKVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiBieXRlc1xufVxuXG5mdW5jdGlvbiBhc2NpaVRvQnl0ZXMgKHN0cikge1xuICB2YXIgYnl0ZUFycmF5ID0gW11cbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBzdHIubGVuZ3RoOyBpKyspIHtcbiAgICAvLyBOb2RlJ3MgY29kZSBzZWVtcyB0byBiZSBkb2luZyB0aGlzIGFuZCBub3QgJiAweDdGLi5cbiAgICBieXRlQXJyYXkucHVzaChzdHIuY2hhckNvZGVBdChpKSAmIDB4RkYpXG4gIH1cbiAgcmV0dXJuIGJ5dGVBcnJheVxufVxuXG5mdW5jdGlvbiB1dGYxNmxlVG9CeXRlcyAoc3RyLCB1bml0cykge1xuICB2YXIgYywgaGksIGxvXG4gIHZhciBieXRlQXJyYXkgPSBbXVxuICBmb3IgKHZhciBpID0gMDsgaSA8IHN0ci5sZW5ndGg7IGkrKykge1xuICAgIGlmICgodW5pdHMgLT0gMikgPCAwKSBicmVha1xuXG4gICAgYyA9IHN0ci5jaGFyQ29kZUF0KGkpXG4gICAgaGkgPSBjID4+IDhcbiAgICBsbyA9IGMgJSAyNTZcbiAgICBieXRlQXJyYXkucHVzaChsbylcbiAgICBieXRlQXJyYXkucHVzaChoaSlcbiAgfVxuXG4gIHJldHVybiBieXRlQXJyYXlcbn1cblxuZnVuY3Rpb24gYmFzZTY0VG9CeXRlcyAoc3RyKSB7XG4gIHJldHVybiBiYXNlNjQudG9CeXRlQXJyYXkoYmFzZTY0Y2xlYW4oc3RyKSlcbn1cblxuZnVuY3Rpb24gYmxpdEJ1ZmZlciAoc3JjLCBkc3QsIG9mZnNldCwgbGVuZ3RoKSB7XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuZ3RoOyBpKyspIHtcbiAgICBpZiAoKGkgKyBvZmZzZXQgPj0gZHN0Lmxlbmd0aCkgfHwgKGkgPj0gc3JjLmxlbmd0aCkpIGJyZWFrXG4gICAgZHN0W2kgKyBvZmZzZXRdID0gc3JjW2ldXG4gIH1cbiAgcmV0dXJuIGlcbn1cbiIsInZhciBsb29rdXAgPSAnQUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVphYmNkZWZnaGlqa2xtbm9wcXJzdHV2d3h5ejAxMjM0NTY3ODkrLyc7XG5cbjsoZnVuY3Rpb24gKGV4cG9ydHMpIHtcblx0J3VzZSBzdHJpY3QnO1xuXG4gIHZhciBBcnIgPSAodHlwZW9mIFVpbnQ4QXJyYXkgIT09ICd1bmRlZmluZWQnKVxuICAgID8gVWludDhBcnJheVxuICAgIDogQXJyYXlcblxuXHR2YXIgUExVUyAgID0gJysnLmNoYXJDb2RlQXQoMClcblx0dmFyIFNMQVNIICA9ICcvJy5jaGFyQ29kZUF0KDApXG5cdHZhciBOVU1CRVIgPSAnMCcuY2hhckNvZGVBdCgwKVxuXHR2YXIgTE9XRVIgID0gJ2EnLmNoYXJDb2RlQXQoMClcblx0dmFyIFVQUEVSICA9ICdBJy5jaGFyQ29kZUF0KDApXG5cdHZhciBQTFVTX1VSTF9TQUZFID0gJy0nLmNoYXJDb2RlQXQoMClcblx0dmFyIFNMQVNIX1VSTF9TQUZFID0gJ18nLmNoYXJDb2RlQXQoMClcblxuXHRmdW5jdGlvbiBkZWNvZGUgKGVsdCkge1xuXHRcdHZhciBjb2RlID0gZWx0LmNoYXJDb2RlQXQoMClcblx0XHRpZiAoY29kZSA9PT0gUExVUyB8fFxuXHRcdCAgICBjb2RlID09PSBQTFVTX1VSTF9TQUZFKVxuXHRcdFx0cmV0dXJuIDYyIC8vICcrJ1xuXHRcdGlmIChjb2RlID09PSBTTEFTSCB8fFxuXHRcdCAgICBjb2RlID09PSBTTEFTSF9VUkxfU0FGRSlcblx0XHRcdHJldHVybiA2MyAvLyAnLydcblx0XHRpZiAoY29kZSA8IE5VTUJFUilcblx0XHRcdHJldHVybiAtMSAvL25vIG1hdGNoXG5cdFx0aWYgKGNvZGUgPCBOVU1CRVIgKyAxMClcblx0XHRcdHJldHVybiBjb2RlIC0gTlVNQkVSICsgMjYgKyAyNlxuXHRcdGlmIChjb2RlIDwgVVBQRVIgKyAyNilcblx0XHRcdHJldHVybiBjb2RlIC0gVVBQRVJcblx0XHRpZiAoY29kZSA8IExPV0VSICsgMjYpXG5cdFx0XHRyZXR1cm4gY29kZSAtIExPV0VSICsgMjZcblx0fVxuXG5cdGZ1bmN0aW9uIGI2NFRvQnl0ZUFycmF5IChiNjQpIHtcblx0XHR2YXIgaSwgaiwgbCwgdG1wLCBwbGFjZUhvbGRlcnMsIGFyclxuXG5cdFx0aWYgKGI2NC5sZW5ndGggJSA0ID4gMCkge1xuXHRcdFx0dGhyb3cgbmV3IEVycm9yKCdJbnZhbGlkIHN0cmluZy4gTGVuZ3RoIG11c3QgYmUgYSBtdWx0aXBsZSBvZiA0Jylcblx0XHR9XG5cblx0XHQvLyB0aGUgbnVtYmVyIG9mIGVxdWFsIHNpZ25zIChwbGFjZSBob2xkZXJzKVxuXHRcdC8vIGlmIHRoZXJlIGFyZSB0d28gcGxhY2Vob2xkZXJzLCB0aGFuIHRoZSB0d28gY2hhcmFjdGVycyBiZWZvcmUgaXRcblx0XHQvLyByZXByZXNlbnQgb25lIGJ5dGVcblx0XHQvLyBpZiB0aGVyZSBpcyBvbmx5IG9uZSwgdGhlbiB0aGUgdGhyZWUgY2hhcmFjdGVycyBiZWZvcmUgaXQgcmVwcmVzZW50IDIgYnl0ZXNcblx0XHQvLyB0aGlzIGlzIGp1c3QgYSBjaGVhcCBoYWNrIHRvIG5vdCBkbyBpbmRleE9mIHR3aWNlXG5cdFx0dmFyIGxlbiA9IGI2NC5sZW5ndGhcblx0XHRwbGFjZUhvbGRlcnMgPSAnPScgPT09IGI2NC5jaGFyQXQobGVuIC0gMikgPyAyIDogJz0nID09PSBiNjQuY2hhckF0KGxlbiAtIDEpID8gMSA6IDBcblxuXHRcdC8vIGJhc2U2NCBpcyA0LzMgKyB1cCB0byB0d28gY2hhcmFjdGVycyBvZiB0aGUgb3JpZ2luYWwgZGF0YVxuXHRcdGFyciA9IG5ldyBBcnIoYjY0Lmxlbmd0aCAqIDMgLyA0IC0gcGxhY2VIb2xkZXJzKVxuXG5cdFx0Ly8gaWYgdGhlcmUgYXJlIHBsYWNlaG9sZGVycywgb25seSBnZXQgdXAgdG8gdGhlIGxhc3QgY29tcGxldGUgNCBjaGFyc1xuXHRcdGwgPSBwbGFjZUhvbGRlcnMgPiAwID8gYjY0Lmxlbmd0aCAtIDQgOiBiNjQubGVuZ3RoXG5cblx0XHR2YXIgTCA9IDBcblxuXHRcdGZ1bmN0aW9uIHB1c2ggKHYpIHtcblx0XHRcdGFycltMKytdID0gdlxuXHRcdH1cblxuXHRcdGZvciAoaSA9IDAsIGogPSAwOyBpIDwgbDsgaSArPSA0LCBqICs9IDMpIHtcblx0XHRcdHRtcCA9IChkZWNvZGUoYjY0LmNoYXJBdChpKSkgPDwgMTgpIHwgKGRlY29kZShiNjQuY2hhckF0KGkgKyAxKSkgPDwgMTIpIHwgKGRlY29kZShiNjQuY2hhckF0KGkgKyAyKSkgPDwgNikgfCBkZWNvZGUoYjY0LmNoYXJBdChpICsgMykpXG5cdFx0XHRwdXNoKCh0bXAgJiAweEZGMDAwMCkgPj4gMTYpXG5cdFx0XHRwdXNoKCh0bXAgJiAweEZGMDApID4+IDgpXG5cdFx0XHRwdXNoKHRtcCAmIDB4RkYpXG5cdFx0fVxuXG5cdFx0aWYgKHBsYWNlSG9sZGVycyA9PT0gMikge1xuXHRcdFx0dG1wID0gKGRlY29kZShiNjQuY2hhckF0KGkpKSA8PCAyKSB8IChkZWNvZGUoYjY0LmNoYXJBdChpICsgMSkpID4+IDQpXG5cdFx0XHRwdXNoKHRtcCAmIDB4RkYpXG5cdFx0fSBlbHNlIGlmIChwbGFjZUhvbGRlcnMgPT09IDEpIHtcblx0XHRcdHRtcCA9IChkZWNvZGUoYjY0LmNoYXJBdChpKSkgPDwgMTApIHwgKGRlY29kZShiNjQuY2hhckF0KGkgKyAxKSkgPDwgNCkgfCAoZGVjb2RlKGI2NC5jaGFyQXQoaSArIDIpKSA+PiAyKVxuXHRcdFx0cHVzaCgodG1wID4+IDgpICYgMHhGRilcblx0XHRcdHB1c2godG1wICYgMHhGRilcblx0XHR9XG5cblx0XHRyZXR1cm4gYXJyXG5cdH1cblxuXHRmdW5jdGlvbiB1aW50OFRvQmFzZTY0ICh1aW50OCkge1xuXHRcdHZhciBpLFxuXHRcdFx0ZXh0cmFCeXRlcyA9IHVpbnQ4Lmxlbmd0aCAlIDMsIC8vIGlmIHdlIGhhdmUgMSBieXRlIGxlZnQsIHBhZCAyIGJ5dGVzXG5cdFx0XHRvdXRwdXQgPSBcIlwiLFxuXHRcdFx0dGVtcCwgbGVuZ3RoXG5cblx0XHRmdW5jdGlvbiBlbmNvZGUgKG51bSkge1xuXHRcdFx0cmV0dXJuIGxvb2t1cC5jaGFyQXQobnVtKVxuXHRcdH1cblxuXHRcdGZ1bmN0aW9uIHRyaXBsZXRUb0Jhc2U2NCAobnVtKSB7XG5cdFx0XHRyZXR1cm4gZW5jb2RlKG51bSA+PiAxOCAmIDB4M0YpICsgZW5jb2RlKG51bSA+PiAxMiAmIDB4M0YpICsgZW5jb2RlKG51bSA+PiA2ICYgMHgzRikgKyBlbmNvZGUobnVtICYgMHgzRilcblx0XHR9XG5cblx0XHQvLyBnbyB0aHJvdWdoIHRoZSBhcnJheSBldmVyeSB0aHJlZSBieXRlcywgd2UnbGwgZGVhbCB3aXRoIHRyYWlsaW5nIHN0dWZmIGxhdGVyXG5cdFx0Zm9yIChpID0gMCwgbGVuZ3RoID0gdWludDgubGVuZ3RoIC0gZXh0cmFCeXRlczsgaSA8IGxlbmd0aDsgaSArPSAzKSB7XG5cdFx0XHR0ZW1wID0gKHVpbnQ4W2ldIDw8IDE2KSArICh1aW50OFtpICsgMV0gPDwgOCkgKyAodWludDhbaSArIDJdKVxuXHRcdFx0b3V0cHV0ICs9IHRyaXBsZXRUb0Jhc2U2NCh0ZW1wKVxuXHRcdH1cblxuXHRcdC8vIHBhZCB0aGUgZW5kIHdpdGggemVyb3MsIGJ1dCBtYWtlIHN1cmUgdG8gbm90IGZvcmdldCB0aGUgZXh0cmEgYnl0ZXNcblx0XHRzd2l0Y2ggKGV4dHJhQnl0ZXMpIHtcblx0XHRcdGNhc2UgMTpcblx0XHRcdFx0dGVtcCA9IHVpbnQ4W3VpbnQ4Lmxlbmd0aCAtIDFdXG5cdFx0XHRcdG91dHB1dCArPSBlbmNvZGUodGVtcCA+PiAyKVxuXHRcdFx0XHRvdXRwdXQgKz0gZW5jb2RlKCh0ZW1wIDw8IDQpICYgMHgzRilcblx0XHRcdFx0b3V0cHV0ICs9ICc9PSdcblx0XHRcdFx0YnJlYWtcblx0XHRcdGNhc2UgMjpcblx0XHRcdFx0dGVtcCA9ICh1aW50OFt1aW50OC5sZW5ndGggLSAyXSA8PCA4KSArICh1aW50OFt1aW50OC5sZW5ndGggLSAxXSlcblx0XHRcdFx0b3V0cHV0ICs9IGVuY29kZSh0ZW1wID4+IDEwKVxuXHRcdFx0XHRvdXRwdXQgKz0gZW5jb2RlKCh0ZW1wID4+IDQpICYgMHgzRilcblx0XHRcdFx0b3V0cHV0ICs9IGVuY29kZSgodGVtcCA8PCAyKSAmIDB4M0YpXG5cdFx0XHRcdG91dHB1dCArPSAnPSdcblx0XHRcdFx0YnJlYWtcblx0XHR9XG5cblx0XHRyZXR1cm4gb3V0cHV0XG5cdH1cblxuXHRleHBvcnRzLnRvQnl0ZUFycmF5ID0gYjY0VG9CeXRlQXJyYXlcblx0ZXhwb3J0cy5mcm9tQnl0ZUFycmF5ID0gdWludDhUb0Jhc2U2NFxufSh0eXBlb2YgZXhwb3J0cyA9PT0gJ3VuZGVmaW5lZCcgPyAodGhpcy5iYXNlNjRqcyA9IHt9KSA6IGV4cG9ydHMpKVxuIiwiZXhwb3J0cy5yZWFkID0gZnVuY3Rpb24gKGJ1ZmZlciwgb2Zmc2V0LCBpc0xFLCBtTGVuLCBuQnl0ZXMpIHtcbiAgdmFyIGUsIG1cbiAgdmFyIGVMZW4gPSBuQnl0ZXMgKiA4IC0gbUxlbiAtIDFcbiAgdmFyIGVNYXggPSAoMSA8PCBlTGVuKSAtIDFcbiAgdmFyIGVCaWFzID0gZU1heCA+PiAxXG4gIHZhciBuQml0cyA9IC03XG4gIHZhciBpID0gaXNMRSA/IChuQnl0ZXMgLSAxKSA6IDBcbiAgdmFyIGQgPSBpc0xFID8gLTEgOiAxXG4gIHZhciBzID0gYnVmZmVyW29mZnNldCArIGldXG5cbiAgaSArPSBkXG5cbiAgZSA9IHMgJiAoKDEgPDwgKC1uQml0cykpIC0gMSlcbiAgcyA+Pj0gKC1uQml0cylcbiAgbkJpdHMgKz0gZUxlblxuICBmb3IgKDsgbkJpdHMgPiAwOyBlID0gZSAqIDI1NiArIGJ1ZmZlcltvZmZzZXQgKyBpXSwgaSArPSBkLCBuQml0cyAtPSA4KSB7fVxuXG4gIG0gPSBlICYgKCgxIDw8ICgtbkJpdHMpKSAtIDEpXG4gIGUgPj49ICgtbkJpdHMpXG4gIG5CaXRzICs9IG1MZW5cbiAgZm9yICg7IG5CaXRzID4gMDsgbSA9IG0gKiAyNTYgKyBidWZmZXJbb2Zmc2V0ICsgaV0sIGkgKz0gZCwgbkJpdHMgLT0gOCkge31cblxuICBpZiAoZSA9PT0gMCkge1xuICAgIGUgPSAxIC0gZUJpYXNcbiAgfSBlbHNlIGlmIChlID09PSBlTWF4KSB7XG4gICAgcmV0dXJuIG0gPyBOYU4gOiAoKHMgPyAtMSA6IDEpICogSW5maW5pdHkpXG4gIH0gZWxzZSB7XG4gICAgbSA9IG0gKyBNYXRoLnBvdygyLCBtTGVuKVxuICAgIGUgPSBlIC0gZUJpYXNcbiAgfVxuICByZXR1cm4gKHMgPyAtMSA6IDEpICogbSAqIE1hdGgucG93KDIsIGUgLSBtTGVuKVxufVxuXG5leHBvcnRzLndyaXRlID0gZnVuY3Rpb24gKGJ1ZmZlciwgdmFsdWUsIG9mZnNldCwgaXNMRSwgbUxlbiwgbkJ5dGVzKSB7XG4gIHZhciBlLCBtLCBjXG4gIHZhciBlTGVuID0gbkJ5dGVzICogOCAtIG1MZW4gLSAxXG4gIHZhciBlTWF4ID0gKDEgPDwgZUxlbikgLSAxXG4gIHZhciBlQmlhcyA9IGVNYXggPj4gMVxuICB2YXIgcnQgPSAobUxlbiA9PT0gMjMgPyBNYXRoLnBvdygyLCAtMjQpIC0gTWF0aC5wb3coMiwgLTc3KSA6IDApXG4gIHZhciBpID0gaXNMRSA/IDAgOiAobkJ5dGVzIC0gMSlcbiAgdmFyIGQgPSBpc0xFID8gMSA6IC0xXG4gIHZhciBzID0gdmFsdWUgPCAwIHx8ICh2YWx1ZSA9PT0gMCAmJiAxIC8gdmFsdWUgPCAwKSA/IDEgOiAwXG5cbiAgdmFsdWUgPSBNYXRoLmFicyh2YWx1ZSlcblxuICBpZiAoaXNOYU4odmFsdWUpIHx8IHZhbHVlID09PSBJbmZpbml0eSkge1xuICAgIG0gPSBpc05hTih2YWx1ZSkgPyAxIDogMFxuICAgIGUgPSBlTWF4XG4gIH0gZWxzZSB7XG4gICAgZSA9IE1hdGguZmxvb3IoTWF0aC5sb2codmFsdWUpIC8gTWF0aC5MTjIpXG4gICAgaWYgKHZhbHVlICogKGMgPSBNYXRoLnBvdygyLCAtZSkpIDwgMSkge1xuICAgICAgZS0tXG4gICAgICBjICo9IDJcbiAgICB9XG4gICAgaWYgKGUgKyBlQmlhcyA+PSAxKSB7XG4gICAgICB2YWx1ZSArPSBydCAvIGNcbiAgICB9IGVsc2Uge1xuICAgICAgdmFsdWUgKz0gcnQgKiBNYXRoLnBvdygyLCAxIC0gZUJpYXMpXG4gICAgfVxuICAgIGlmICh2YWx1ZSAqIGMgPj0gMikge1xuICAgICAgZSsrXG4gICAgICBjIC89IDJcbiAgICB9XG5cbiAgICBpZiAoZSArIGVCaWFzID49IGVNYXgpIHtcbiAgICAgIG0gPSAwXG4gICAgICBlID0gZU1heFxuICAgIH0gZWxzZSBpZiAoZSArIGVCaWFzID49IDEpIHtcbiAgICAgIG0gPSAodmFsdWUgKiBjIC0gMSkgKiBNYXRoLnBvdygyLCBtTGVuKVxuICAgICAgZSA9IGUgKyBlQmlhc1xuICAgIH0gZWxzZSB7XG4gICAgICBtID0gdmFsdWUgKiBNYXRoLnBvdygyLCBlQmlhcyAtIDEpICogTWF0aC5wb3coMiwgbUxlbilcbiAgICAgIGUgPSAwXG4gICAgfVxuICB9XG5cbiAgZm9yICg7IG1MZW4gPj0gODsgYnVmZmVyW29mZnNldCArIGldID0gbSAmIDB4ZmYsIGkgKz0gZCwgbSAvPSAyNTYsIG1MZW4gLT0gOCkge31cblxuICBlID0gKGUgPDwgbUxlbikgfCBtXG4gIGVMZW4gKz0gbUxlblxuICBmb3IgKDsgZUxlbiA+IDA7IGJ1ZmZlcltvZmZzZXQgKyBpXSA9IGUgJiAweGZmLCBpICs9IGQsIGUgLz0gMjU2LCBlTGVuIC09IDgpIHt9XG5cbiAgYnVmZmVyW29mZnNldCArIGkgLSBkXSB8PSBzICogMTI4XG59XG4iLCJcbi8qKlxuICogaXNBcnJheVxuICovXG5cbnZhciBpc0FycmF5ID0gQXJyYXkuaXNBcnJheTtcblxuLyoqXG4gKiB0b1N0cmluZ1xuICovXG5cbnZhciBzdHIgPSBPYmplY3QucHJvdG90eXBlLnRvU3RyaW5nO1xuXG4vKipcbiAqIFdoZXRoZXIgb3Igbm90IHRoZSBnaXZlbiBgdmFsYFxuICogaXMgYW4gYXJyYXkuXG4gKlxuICogZXhhbXBsZTpcbiAqXG4gKiAgICAgICAgaXNBcnJheShbXSk7XG4gKiAgICAgICAgLy8gPiB0cnVlXG4gKiAgICAgICAgaXNBcnJheShhcmd1bWVudHMpO1xuICogICAgICAgIC8vID4gZmFsc2VcbiAqICAgICAgICBpc0FycmF5KCcnKTtcbiAqICAgICAgICAvLyA+IGZhbHNlXG4gKlxuICogQHBhcmFtIHttaXhlZH0gdmFsXG4gKiBAcmV0dXJuIHtib29sfVxuICovXG5cbm1vZHVsZS5leHBvcnRzID0gaXNBcnJheSB8fCBmdW5jdGlvbiAodmFsKSB7XG4gIHJldHVybiAhISB2YWwgJiYgJ1tvYmplY3QgQXJyYXldJyA9PSBzdHIuY2FsbCh2YWwpO1xufTtcbiIsIi8vIHNoaW0gZm9yIHVzaW5nIHByb2Nlc3MgaW4gYnJvd3NlclxuXG52YXIgcHJvY2VzcyA9IG1vZHVsZS5leHBvcnRzID0ge307XG52YXIgcXVldWUgPSBbXTtcbnZhciBkcmFpbmluZyA9IGZhbHNlO1xudmFyIGN1cnJlbnRRdWV1ZTtcbnZhciBxdWV1ZUluZGV4ID0gLTE7XG5cbmZ1bmN0aW9uIGNsZWFuVXBOZXh0VGljaygpIHtcbiAgICBkcmFpbmluZyA9IGZhbHNlO1xuICAgIGlmIChjdXJyZW50UXVldWUubGVuZ3RoKSB7XG4gICAgICAgIHF1ZXVlID0gY3VycmVudFF1ZXVlLmNvbmNhdChxdWV1ZSk7XG4gICAgfSBlbHNlIHtcbiAgICAgICAgcXVldWVJbmRleCA9IC0xO1xuICAgIH1cbiAgICBpZiAocXVldWUubGVuZ3RoKSB7XG4gICAgICAgIGRyYWluUXVldWUoKTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIGRyYWluUXVldWUoKSB7XG4gICAgaWYgKGRyYWluaW5nKSB7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG4gICAgdmFyIHRpbWVvdXQgPSBzZXRUaW1lb3V0KGNsZWFuVXBOZXh0VGljayk7XG4gICAgZHJhaW5pbmcgPSB0cnVlO1xuXG4gICAgdmFyIGxlbiA9IHF1ZXVlLmxlbmd0aDtcbiAgICB3aGlsZShsZW4pIHtcbiAgICAgICAgY3VycmVudFF1ZXVlID0gcXVldWU7XG4gICAgICAgIHF1ZXVlID0gW107XG4gICAgICAgIHdoaWxlICgrK3F1ZXVlSW5kZXggPCBsZW4pIHtcbiAgICAgICAgICAgIGN1cnJlbnRRdWV1ZVtxdWV1ZUluZGV4XS5ydW4oKTtcbiAgICAgICAgfVxuICAgICAgICBxdWV1ZUluZGV4ID0gLTE7XG4gICAgICAgIGxlbiA9IHF1ZXVlLmxlbmd0aDtcbiAgICB9XG4gICAgY3VycmVudFF1ZXVlID0gbnVsbDtcbiAgICBkcmFpbmluZyA9IGZhbHNlO1xuICAgIGNsZWFyVGltZW91dCh0aW1lb3V0KTtcbn1cblxucHJvY2Vzcy5uZXh0VGljayA9IGZ1bmN0aW9uIChmdW4pIHtcbiAgICB2YXIgYXJncyA9IG5ldyBBcnJheShhcmd1bWVudHMubGVuZ3RoIC0gMSk7XG4gICAgaWYgKGFyZ3VtZW50cy5sZW5ndGggPiAxKSB7XG4gICAgICAgIGZvciAodmFyIGkgPSAxOyBpIDwgYXJndW1lbnRzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICBhcmdzW2kgLSAxXSA9IGFyZ3VtZW50c1tpXTtcbiAgICAgICAgfVxuICAgIH1cbiAgICBxdWV1ZS5wdXNoKG5ldyBJdGVtKGZ1biwgYXJncykpO1xuICAgIGlmIChxdWV1ZS5sZW5ndGggPT09IDEgJiYgIWRyYWluaW5nKSB7XG4gICAgICAgIHNldFRpbWVvdXQoZHJhaW5RdWV1ZSwgMCk7XG4gICAgfVxufTtcblxuLy8gdjggbGlrZXMgcHJlZGljdGlibGUgb2JqZWN0c1xuZnVuY3Rpb24gSXRlbShmdW4sIGFycmF5KSB7XG4gICAgdGhpcy5mdW4gPSBmdW47XG4gICAgdGhpcy5hcnJheSA9IGFycmF5O1xufVxuSXRlbS5wcm90b3R5cGUucnVuID0gZnVuY3Rpb24gKCkge1xuICAgIHRoaXMuZnVuLmFwcGx5KG51bGwsIHRoaXMuYXJyYXkpO1xufTtcbnByb2Nlc3MudGl0bGUgPSAnYnJvd3Nlcic7XG5wcm9jZXNzLmJyb3dzZXIgPSB0cnVlO1xucHJvY2Vzcy5lbnYgPSB7fTtcbnByb2Nlc3MuYXJndiA9IFtdO1xucHJvY2Vzcy52ZXJzaW9uID0gJyc7IC8vIGVtcHR5IHN0cmluZyB0byBhdm9pZCByZWdleHAgaXNzdWVzXG5wcm9jZXNzLnZlcnNpb25zID0ge307XG5cbmZ1bmN0aW9uIG5vb3AoKSB7fVxuXG5wcm9jZXNzLm9uID0gbm9vcDtcbnByb2Nlc3MuYWRkTGlzdGVuZXIgPSBub29wO1xucHJvY2Vzcy5vbmNlID0gbm9vcDtcbnByb2Nlc3Mub2ZmID0gbm9vcDtcbnByb2Nlc3MucmVtb3ZlTGlzdGVuZXIgPSBub29wO1xucHJvY2Vzcy5yZW1vdmVBbGxMaXN0ZW5lcnMgPSBub29wO1xucHJvY2Vzcy5lbWl0ID0gbm9vcDtcblxucHJvY2Vzcy5iaW5kaW5nID0gZnVuY3Rpb24gKG5hbWUpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ3Byb2Nlc3MuYmluZGluZyBpcyBub3Qgc3VwcG9ydGVkJyk7XG59O1xuXG4vLyBUT0RPKHNodHlsbWFuKVxucHJvY2Vzcy5jd2QgPSBmdW5jdGlvbiAoKSB7IHJldHVybiAnLycgfTtcbnByb2Nlc3MuY2hkaXIgPSBmdW5jdGlvbiAoZGlyKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdwcm9jZXNzLmNoZGlyIGlzIG5vdCBzdXBwb3J0ZWQnKTtcbn07XG5wcm9jZXNzLnVtYXNrID0gZnVuY3Rpb24oKSB7IHJldHVybiAwOyB9O1xuIiwicmVxdWlyZSgnLi9UcmFjaycpO1xyXG5yZXF1aXJlKCcuL0dVSScpO1xyXG5yZXF1aXJlKCcuL1BhcnRpY2lwYW50Jyk7XHJcbndpbmRvdy5DT05GSUc9cmVxdWlyZSgnLi9Db25maWcnKTtcclxudmFyIFNUWUxFUz1yZXF1aXJlKCcuL1N0eWxlcycpO1xyXG52YXIgVXRpbHM9cmVxdWlyZSgnLi9VdGlscycpO1xyXG5mb3IgKHZhciBlIGluIFV0aWxzKSBcclxuXHR3aW5kb3dbZV09VXRpbHNbZV07XHJcblxyXG52YXIgZHJhdztcclxudmFyIG1vZGlmeTtcclxudmFyIHNlbGVjdDtcclxuXHJcbndpbmRvdy5UUkFDSyA9IG5ldyBUcmFjaygpO1xyXG53aW5kb3cuR1VJID0gbmV3IEd1aShcclxue1xyXG5cdFx0dHJhY2tcdFx0OiBUUkFDSyxcclxuXHRcdGluaXRpYWxab29tIDogMlxyXG5cdFx0Ly9pbml0aWFsUG9zICA6IFtsb24sbGF0XSxcclxufSk7XHJcblxyXG5mdW5jdGlvbiBlcnJvclJvdXRlKGVycikge1xyXG5cdEdVSS5zaG93RXJyb3IoZXJyKTtcclxufVxyXG5cclxuZnVuY3Rpb24gaW5pdEdVSSgpIFxyXG57XHJcblx0aWYgKEdVSS5pc19pbml0KSB7XHJcblx0XHRzZWxlY3QuZ2V0RmVhdHVyZXMoKS5jbGVhcigpO1xyXG5cdFx0cmV0dXJuO1xyXG5cdH1cclxuXHRHVUkuaXNfaW5pdD0xO1xyXG5cdEdVSS5pbml0KHtza2lwRXh0ZW50OnRydWV9KTtcclxuXHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRmdW5jdGlvbiBzdG9yZShmb3JjZUNsb3NlLGUpIFxyXG5cdHtcclxuXHRcdHZhciBmZWF0O1xyXG5cdFx0aWYgKCFHVUkuZ2V0VHJhY2tMYXllcigpLmdldFNvdXJjZSgpLmdldEZlYXR1cmVzKCkubGVuZ3RoKSB7XHJcblx0XHRcdGlmIChlICYmIGUuZmVhdHVyZSkge1xyXG5cdFx0XHRcdGZlYXQ9ZS5mZWF0dXJlOyAgICBcclxuXHRcdFx0fSBlbHNlIHtcclxuXHRcdFx0XHRyZXR1cm4gbnVsbDtcclxuXHRcdFx0fVxyXG5cdFx0fSBlbHNlIHtcclxuXHRcdFx0ZmVhdCA9IEdVSS5nZXRUcmFja0xheWVyKCkuZ2V0U291cmNlKCkuZ2V0RmVhdHVyZXMoKVswXTtcclxuXHRcdH1cclxuXHRcdHZhciB0cmFja0RhdGE9ZmVhdC5nZXRHZW9tZXRyeSgpLmdldENvb3JkaW5hdGVzKCk7XHJcblx0XHRpZiAoZm9yY2VDbG9zZSkgXHJcblx0XHR7XHJcblx0XHRcdGlmICh0cmFja0RhdGFbMF1bMF0gIT0gdHJhY2tEYXRhW3RyYWNrRGF0YS5sZW5ndGgtMV1bMF0gfHwgdHJhY2tEYXRhWzBdWzFdICE9IHRyYWNrRGF0YVt0cmFja0RhdGEubGVuZ3RoLTFdWzFdKSB7XHJcblx0XHRcdFx0dHJhY2tEYXRhLnB1c2godHJhY2tEYXRhWzBdKTtcclxuXHRcdFx0XHRmZWF0LmdldEdlb21ldHJ5KCkuc2V0Q29vcmRpbmF0ZXModHJhY2tEYXRhKTtcclxuXHRcdFx0fVxyXG5cdFx0fVxyXG5cdFx0Zm9yICh2YXIgaT0wO2k8dHJhY2tEYXRhLmxlbmd0aDtpKyspXHJcblx0XHRcdHRyYWNrRGF0YVtpXT1vbC5wcm9qLnRyYW5zZm9ybSh0cmFja0RhdGFbaV0sICdFUFNHOjM4NTcnLCdFUFNHOjQzMjYnKTtcdFx0XHRcclxuXHRcdCQoXCIjcm91dGVfdGV4dF9hcmVhXCIpLnZhbChKU09OLnN0cmluZ2lmeSh0cmFja0RhdGEpKTtcclxuXHJcblx0XHRUUkFDSy5zZXRSb3V0ZSh0cmFja0RhdGEpO1xyXG5cdFx0VFJBQ0sudXBkYXRlRmVhdHVyZSgpO1xyXG5cdFx0R1VJLnRyYWNrTGF5ZXIuZ2V0U291cmNlKCkuY2xlYXIoKTtcclxuXHRcdEdVSS5hZGRUcmFja0ZlYXR1cmUoKTtcclxuXHRcdFxyXG5cdFx0dmFyIHN0ciA9IChUUkFDSy5nZXRUcmFja0xlbmd0aCgpLzEwMDAuMCkrXCIga21cIjtcclxuXHRcdCQoXCIjcm91dGVfaW5mb1wiKS52YWwoc3RyKTtcclxuXHRcdHJldHVybiBKU09OLnN0cmluZ2lmeSh0cmFja0RhdGEpO1xyXG5cdH1cclxuXHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRzZWxlY3QgPSBuZXcgb2wuaW50ZXJhY3Rpb24uU2VsZWN0KHtcclxuXHRcdHN0eWxlOiBTVFlMRVNbXCJ0cmFja3NlbGVjdGVkXCJdLFxyXG5cdFx0bGF5ZXJzOiBbR1VJLnRyYWNrTGF5ZXJdXHJcblx0fSk7XHJcblx0bW9kaWZ5ID0gbmV3IG9sLmludGVyYWN0aW9uLk1vZGlmeSh7XHJcblx0XHRmZWF0dXJlczogc2VsZWN0LmdldEZlYXR1cmVzKCksXHJcblx0XHRsYXllcnM6IFtHVUkudHJhY2tMYXllcl1cclxuXHR9KTtcclxuXHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRkcmF3ID0gbmV3IG9sLmludGVyYWN0aW9uLkRyYXcoe1xyXG5cdCAgICAgIHNvdXJjZTogR1VJLnRyYWNrTGF5ZXIuZ2V0U291cmNlKCksXHJcblx0ICAgICAgdHlwZTogXCJMaW5lU3RyaW5nXCJcclxuXHR9KTtcclxuXHRkcmF3Lm9uKCdkcmF3c3RhcnQnLCBmdW5jdGlvbihlKSB7XHJcblx0XHRHVUkudHJhY2tMYXllci5nZXRTb3VyY2UoKS5jbGVhcigpO1xyXG5cdH0pO1xyXG5cdGRyYXcub24oJ2RyYXdlbmQnLCBmdW5jdGlvbihlKSB7XHJcblx0XHRHVUkubWFwLnJlbW92ZUludGVyYWN0aW9uKGRyYXcpO1xyXG5cdFx0R1VJLm1hcC5hZGRJbnRlcmFjdGlvbihzZWxlY3QpO1xyXG5cdFx0R1VJLm1hcC5hZGRJbnRlcmFjdGlvbihtb2RpZnkpO1xyXG5cdFx0c3RvcmUoZmFsc2UsZSk7XHJcblx0XHQvLyBQT1NUIENMRUFOVVAgT0YgRE9CTEUgRkVBVFVSRSAob24gZHJhdyBzdWJtaXQpXHJcblx0XHRzZXRUaW1lb3V0KGZ1bmN0aW9uKCkgXHJcblx0XHR7XHJcblx0XHRcdHZhciBmZWF0cyA9IEdVSS50cmFja0xheWVyLmdldFNvdXJjZSgpLmdldEZlYXR1cmVzKCk7XHJcblx0XHRcdHZhciB0b2RlbD1bXTtcclxuXHRcdFx0Zm9yICh2YXIgaSBpbiBmZWF0cykge1xyXG5cdFx0XHRcdHZhciBmZWF0ID0gZmVhdHNbaV07XHJcblx0XHRcdFx0aWYgKCFmZWF0LnRyYWNrKSB7XHJcblx0XHRcdFx0XHR0b2RlbC5wdXNoKGZlYXQpO1xyXG5cdFx0XHRcdH1cclxuXHRcdFx0fVxyXG5cdFx0XHRmb3IgKHZhciBpIGluIHRvZGVsKSB7XHJcblx0XHRcdFx0dmFyIGZlYXQgPSB0b2RlbFtpXTtcclxuXHRcdFx0XHRHVUkudHJhY2tMYXllci5nZXRTb3VyY2UoKS5yZW1vdmVGZWF0dXJlKGZlYXQpO1xyXG5cdFx0XHR9XHJcblx0XHR9LDApO1xyXG5cdH0pO1xyXG5cdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdEdVSS5tYXAucmVtb3ZlSW50ZXJhY3Rpb24oc2VsZWN0KTtcclxuXHRHVUkubWFwLnJlbW92ZUludGVyYWN0aW9uKG1vZGlmeSk7XHJcblx0R1VJLm1hcC5hZGRJbnRlcmFjdGlvbihkcmF3KTtcclxuXHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHQkKFwiI2J1dHRvbl9lcmFzZVwiKS5jbGljayhmdW5jdGlvbigpe1xyXG5cdFx0R1VJLnRyYWNrTGF5ZXIuZ2V0U291cmNlKCkuY2xlYXIoKTtcclxuXHRcdHNlbGVjdC5nZXRGZWF0dXJlcygpLmNsZWFyKCk7XHJcblx0XHRHVUkubWFwLnJlbW92ZUludGVyYWN0aW9uKHNlbGVjdCk7XHJcblx0XHRHVUkubWFwLnJlbW92ZUludGVyYWN0aW9uKG1vZGlmeSk7XHJcblx0XHRHVUkubWFwLmFkZEludGVyYWN0aW9uKGRyYXcpO1xyXG5cdFx0c3RvcmUoKTtcclxuXHRcdEdVSS5nZXRUcmFja0xheWVyKCkuZ2V0U291cmNlKCkuY2xlYXIoKVxyXG5cdFx0ZGVsZXRlIFRSQUNLLmZlYXR1cmU7XHJcblx0fSk7XHJcblx0JChcIiNidXR0b25fbmF2aWdhdGVcIikuY2xpY2soZnVuY3Rpb24oKXtcclxuXHRcdFRSQUNLLmdlbmVyYXRlRnJvbUxvY2F0aW9ucyhUUkFDSy5nZXRSb3V0ZSgpLGZ1bmN0aW9uKCkge1xyXG5cdFx0XHRUUkFDSy51cGRhdGVGZWF0dXJlKCk7XHJcblx0XHRcdHN0b3JlKCk7XHJcblx0XHR9LGZ1bmN0aW9uKG1zZykge1xyXG5cdFx0XHRHVUkuc2hvd0Vycm9yKG1zZyk7XHJcblx0XHR9LHRydWUpO1x0XHRcdFxyXG5cdH0pO1xyXG5cdCQoXCIjYnV0dG9uX2pvaW5cIikuY2xpY2soZnVuY3Rpb24oKSB7XHJcblx0XHRzdG9yZSh0cnVlKTtcclxuXHR9KTtcclxuXHQkKFwiI2J1dHRvbl9zdWJtaXRcIikuY2xpY2soZnVuY3Rpb24oKSB7XHJcblx0XHR2YXIgZGF0YSA9IHN0b3JlKCk7XHJcblx0XHRHVUkub25FZGl0U2F2ZShkYXRhKTtcdFx0XHRcclxuXHRcdCQoXCIuZnctY29udGFpbmVyXCIpLmNzcyhcImRpc3BsYXlcIixcImJsb2NrXCIpO1xyXG5cdH0pO1xyXG5cdCQoXCIjYnV0dG9uX2NhbmNlbFwiKS5jbGljayhmdW5jdGlvbigpIHtcclxuXHRcdCQoXCIjbWFwXCIpLmNzcyhcImRpc3BsYXlcIixcIm5vbmVcIik7XHJcblx0XHQkKFwiLmZ3LWNvbnRhaW5lclwiKS5jc3MoXCJkaXNwbGF5XCIsXCJibG9ja1wiKTtcclxuXHR9KTtcclxufVxyXG4vLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuZnVuY3Rpb24gbWFwRWRpdChpZCxqc29uLHZhbEJpa2VTdGFydCx2YWxSdW5TdGFydCxvblN1Ym1pdCkgXHJcbntcdFx0XHJcblx0Ly9jb25zb2xlLmxvZyhcIklEIDogXCIraWQrXCIgfCBKU09OIDogXCIranNvbik7XHJcblx0JChcIi5mdy1jb250YWluZXJcIikuY3NzKFwiZGlzcGxheVwiLFwibm9uZVwiKTtcclxuXHQkKFwiI21hcFwiKS5jc3MoXCJkaXNwbGF5XCIsXCJibG9ja1wiKTtcclxuXHRpbml0R1VJKCk7XHJcblx0R1VJLnRyYWNrTGF5ZXIuZ2V0U291cmNlKCkuY2xlYXIoKTtcclxuXHR2YXIgdHJhY2tEYXRhO1xyXG5cdHRyeSB7XHJcblx0XHR0cmFja0RhdGEgPSBKU09OLnBhcnNlKGpzb24pO1xyXG5cdH0gY2F0Y2ggKGUpIHtcclxuXHRcdGNvbnNvbGUubG9nKFwiVW5hYmxlIHRvIGRvIG1hcEVkaXQgZm9yIFwiK2pzb24pO1xyXG5cdFx0dHJhY2tEYXRhPVtdO1xyXG5cdH1cdFx0XHJcblx0VFJBQ0suc2V0Um91dGUodHJhY2tEYXRhKTtcclxuXHRUUkFDSy5iaWtlU3RhcnRLTT1wYXJzZUZsb2F0KHZhbEJpa2VTdGFydCk7XHJcblx0VFJBQ0sucnVuU3RhcnRLTT1wYXJzZUZsb2F0KHZhbFJ1blN0YXJ0KTtcclxuXHRpZiAoaXNOYU4oVFJBQ0suYmlrZVN0YXJ0S00pKVxyXG5cdFx0VFJBQ0suYmlrZVN0YXJ0S009My44NjtcclxuXHRpZiAoaXNOYU4oVFJBQ0sucnVuU3RhcnRLTSkpXHJcblx0XHRUUkFDSy5ydW5TdGFydEtNPTE4MC4yNStUUkFDSy5iaWtlU3RhcnRLTTtcclxuXHRpZiAoanNvbiAmJiBqc29uICE9IFwiXCIpIFxyXG5cdHtcclxuXHRcdCQoXCIjcm91dGVfdGV4dF9hcmVhXCIpLnZhbChqc29uKTtcclxuXHRcdHZhciBzdHIgPSAoVFJBQ0suZ2V0VHJhY2tMZW5ndGgoKS8xMDAwLjApK1wiIGttXCI7XHJcblx0XHQkKFwiI3JvdXRlX2luZm9cIikudmFsKHN0cik7XHJcblx0XHRHVUkuYWRkVHJhY2tGZWF0dXJlKCk7XHJcblx0XHRHVUkuem9vbVRvVHJhY2soKTtcclxuXHRcdEdVSS5tYXAucmVtb3ZlSW50ZXJhY3Rpb24oZHJhdyk7XHJcblx0XHRHVUkubWFwLmFkZEludGVyYWN0aW9uKHNlbGVjdCk7XHJcblx0XHRHVUkubWFwLmFkZEludGVyYWN0aW9uKG1vZGlmeSk7XHJcblx0fVx0XHRcclxuXHRHVUkub25FZGl0U2F2ZSA9IGZ1bmN0aW9uKGRhdGEpIHtcclxuXHRcdCQoXCIjbWFwXCIpLmNzcyhcImRpc3BsYXlcIixcIm5vbmVcIik7XHJcblx0XHRvblN1Ym1pdChkYXRhKTtcclxuXHR9O1xyXG59XHJcblxyXG4kKGRvY3VtZW50KS5yZWFkeSggZnVuY3Rpb24gKCkgXHJcbntcclxuXHQkKFwiLmJ1dHRvbi1hc3NpZ25tZW50c1wiKS5jbGljayhmdW5jdGlvbigpIHtcclxuXHRcdHdpbmRvdy5vcGVuKFwiYXNzaWdubWVudC5odG1sXCIsICdfYmxhbmsnKTtcclxuXHR9KTtcclxuXHQkKFwiLmJ1dHRvbi1zdGF0dXNcIikuY2xpY2soZnVuY3Rpb24oKSB7XHJcblx0XHR3aW5kb3cub3BlbihcInN0YXR1cy5odG1sXCIsICdfYmxhbmsnKTtcclxuXHR9KTtcclxuXHQkKFwiLmJ1dHRvbi1ncHhcIikuY2xpY2soZnVuY3Rpb24oKSB7XHJcblx0XHR3aW5kb3cub3BlbihcImdweC5odG1sXCIsICdfYmxhbmsnKTtcclxuXHR9KTtcclxuXHQkKFwiLm1vYmlsZS1zaG93IGlcIikuY2xpY2soZnVuY3Rpb24oKSB7XHJcblx0XHQkKFwiLm1vYmlsZS1zaG93XCIpLmNzcyhcImRpc3BsYXlcIixcIm5vbmVcIik7IFxyXG5cdFx0JChcIi5mdy1uYXZcIikuY3NzKFwiaGVpZ2h0XCIsXCJhdXRvXCIpOyBcclxuXHR9KTtcclxuXHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHR3aW5kb3cuRURJVE9SMSA9IG5ldyAkLmZuLmRhdGFUYWJsZS5FZGl0b3IoIHtcclxuXHRcdGFqYXg6ICcuLi9wYXJ0aWNpcGFudHMnLFxyXG5cdFx0dGFibGU6IFwiI3RhYmxlLXBhcnRpY2lwYW50c1wiLFxyXG5cdFx0aWRTcmM6IFwiaWRcIixcclxuXHRcdGZpZWxkczogWyBcclxuXHRcdCAgICB7XHJcblx0XHRcdFx0bGFiZWw6IFwiU3RhcnQgTm9cIixcclxuXHRcdFx0XHRuYW1lOiBcInN0YXJ0Tm9cIlxyXG5cdFx0XHR9LHtcclxuXHRcdFx0XHRsYWJlbDogXCJGaXJzdCBuYW1lXCIsXHJcblx0XHRcdFx0bmFtZTogXCJmaXJzdG5hbWVcIlxyXG5cdFx0XHR9LHtcclxuXHRcdFx0XHRsYWJlbDogXCJMYXN0IG5hbWVcIixcclxuXHRcdFx0XHRuYW1lOiBcImxhc3RuYW1lXCJcclxuXHRcdFx0fSx7XHJcblx0XHRcdFx0bGFiZWw6IFwiR2VuZGVyXCIsXHJcblx0XHRcdFx0bmFtZTogXCJnZW5kZXJcIlxyXG5cdFx0XHR9LHtcclxuXHRcdFx0XHRsYWJlbDogXCJOYXRpb25hbGl0eVwiLFxyXG5cdFx0XHRcdG5hbWU6IFwibmF0aW9uYWxpdHlcIlxyXG5cdFx0XHR9LHtcclxuXHRcdFx0XHRsYWJlbDogXCJTdGFydCBncm91cFwiLFxyXG5cdFx0XHRcdG5hbWU6IFwic3RhcnRHcm91cFwiXHJcblx0XHRcdH0se1xyXG5cdFx0XHRcdGxhYmVsOiBcIkNsdWJcIixcclxuXHRcdFx0XHRuYW1lOiBcImNsdWJcIlxyXG5cdFx0XHR9LHtcclxuXHRcdFx0XHRsYWJlbDogXCJCaXJ0aCBkYXRlXCIsXHJcblx0XHRcdFx0bmFtZTogXCJiaXJ0aERhdGVcIixcclxuXHRcdFx0fSx7XHJcblx0XHRcdFx0bGFiZWw6IFwiSWRcIixcclxuXHRcdFx0XHRuYW1lOiBcImlkXCIsXHJcblx0XHRcdFx0dHlwZSA6IFwicmVhZG9ubHlcIlxyXG5cdFx0XHR9XHRcdFx0XHJcblx0XHRdXHJcblx0fSApO1xyXG5cclxuXHR3aW5kb3cuRURJVE9SMyA9IG5ldyAkLmZuLmRhdGFUYWJsZS5FZGl0b3IoIHtcclxuXHRcdGFqYXg6ICcuLi9ldmVudHMnLFxyXG5cdFx0dGFibGU6IFwiI3RhYmxlLWV2ZW50c1wiLFxyXG5cdFx0aWRTcmM6IFwiaWRcIixcclxuXHRcdGZpZWxkczogW3tcclxuXHRcdFx0XHRcdGxhYmVsOiBcIkNvZGVcIixcclxuXHRcdFx0XHRcdG5hbWU6IFwiY29kZVwiXHJcblx0XHRcdFx0IH0se1xyXG5cdFx0XHRcdFx0bGFiZWw6IFwiU3RhcnRcIixcclxuXHRcdFx0XHRcdG5hbWU6IFwic3RhcnRUaW1lXCJcclxuXHRcdFx0XHR9LCB7XHJcblx0XHRcdFx0XHRsYWJlbDogXCJFbmRcIixcclxuXHRcdFx0XHRcdG5hbWU6IFwiZW5kVGltZVwiXHJcblx0XHRcdFx0fSwge1xyXG5cdFx0XHRcdFx0bGFiZWw6IFwiVHJhY2tcIixcclxuXHRcdFx0XHRcdG5hbWU6IFwidHJhY2tcIlxyXG5cdFx0XHRcdH0sIHtcclxuXHRcdFx0XHRcdGxhYmVsOiBcIkJpa2Ugc3RhcnQga21cIixcclxuXHRcdFx0XHRcdG5hbWU6IFwiYmlrZVN0YXJ0S01cIlxyXG5cdFx0XHRcdH0sIHtcclxuXHRcdFx0XHRcdGxhYmVsOiBcIlJ1biBzdGFydCBrbVwiLFxyXG5cdFx0XHRcdFx0bmFtZTogXCJydW5TdGFydEtNXCJcclxuXHRcdFx0XHR9LHtcclxuXHRcdFx0XHRcdGxhYmVsOiBcIklkXCIsXHJcblx0XHRcdFx0XHRuYW1lOiBcImlkXCIsXHJcblx0XHRcdFx0XHR0eXBlIDogXCJyZWFkb25seVwiXHJcblx0XHRcdFx0fV1cclxuXHR9KTtcclxuXHJcblx0XHJcblx0dmFyIHRhYmxlUGFydGljaXBhbnRzID0gJCgnI3RhYmxlLXBhcnRpY2lwYW50cycpLkRhdGFUYWJsZSgge1xyXG5cdFx0ZG9tOiBcIlRmcnRpcFwiLFxyXG5cdFx0YWpheDogXCIuLi9wYXJ0aWNpcGFudHM/bW9kZT1kdGJsXCIsXHJcblx0XHRjb2x1bW5zOiBbXHJcblx0XHRcdHsgZGF0YTogXCJzdGFydE5vXCIsY2xhc3NOYW1lIDogXCJkdC1ib2R5LXJpZ2h0XCIgfSxcclxuXHRcdFx0eyBkYXRhOiBcImZpcnN0bmFtZVwiIH0sXHJcblx0XHRcdHsgZGF0YTogXCJsYXN0bmFtZVwiIH0sXHJcblx0XHRcdHsgZGF0YTogXCJnZW5kZXJcIiB9LFxyXG5cdFx0XHR7IGRhdGE6IFwibmF0aW9uYWxpdHlcIn0sXHJcblx0XHRcdHsgZGF0YTogXCJzdGFydEdyb3VwXCIgfSxcclxuXHRcdFx0eyBkYXRhOiBcImNsdWJcIn0sXHJcblx0XHRcdHsgZGF0YTogXCJiaXJ0aERhdGVcIixjbGFzc05hbWUgOiBcImR0LWJvZHktcmlnaHRcIiB9XHJcblx0XHRdLFxyXG5cdFx0dGFibGVUb29sczoge1xyXG5cdFx0XHRzUm93U2VsZWN0OiBcIm9zXCIsXHJcblx0XHRcdGFCdXR0b25zOiBbXHJcblx0XHRcdFx0eyBzRXh0ZW5kczogXCJlZGl0b3JfY3JlYXRlXCIsIGVkaXRvcjogRURJVE9SMSB9LFxyXG5cdFx0XHRcdHsgc0V4dGVuZHM6IFwiZWRpdG9yX2VkaXRcIiwgICBlZGl0b3I6IEVESVRPUjEgfSxcclxuXHRcdFx0XHR7IHNFeHRlbmRzOiBcImVkaXRvcl9yZW1vdmVcIiwgZWRpdG9yOiBFRElUT1IxIH1cclxuXHRcdFx0XVxyXG5cdFx0fVxyXG5cdH0gKTtcdFxyXG5cdFxyXG5cdHZhciB0YWJsZUV2ZW50cyA9ICQoJyN0YWJsZS1ldmVudHMnKS5EYXRhVGFibGUoIHtcclxuXHRcdGRvbTogXCJUZnJ0aXBcIixcclxuXHRcdGFqYXg6IFwiLi4vZXZlbnRzXCIsXHJcblx0XHRjb2x1bW5zOiBbXHJcblx0XHRcdHsgZGF0YTogXCJjb2RlXCIgfSxcclxuXHRcdFx0eyBkYXRhOiBcInN0YXJ0VGltZVwiIH0sXHJcblx0XHRcdHsgZGF0YTogXCJlbmRUaW1lXCIgfSxcclxuXHRcdFx0eyBcclxuXHRcdFx0XHQvLyB0cmFja1xyXG5cdFx0XHRcdGRhdGE6IG51bGwsXHJcblx0XHRcdFx0cmVuZGVyOiBmdW5jdGlvbiAoIGRhdGEsIHR5cGUsIHJvdyApIFxyXG5cdFx0XHRcdHtcclxuXHRcdFx0XHRcdGlmICghZGF0YVtcInRyYWNrXCJdKVxyXG5cdFx0XHRcdFx0XHRyZXR1cm4gXCJcIjtcclxuXHRcdFx0XHRcdHZhciB0cG9zID0gbnVsbDtcclxuXHRcdFx0XHRcdHRyeSB7XHJcblx0XHRcdFx0XHRcdHRwb3M9SlNPTi5wYXJzZShkYXRhW1widHJhY2tcIl0pO1xyXG5cdFx0XHRcdFx0fSBjYXRjaChlKSB7XHJcblx0XHRcdFx0XHR9XHJcblx0XHRcdFx0XHR2YXIgcmVzO1xyXG5cdFx0XHRcdFx0aWYgKCF0cG9zIHx8ICF0cG9zLmxlbmd0aClcclxuXHRcdFx0XHRcdFx0cmVzPVwiMCBrbVwiO1xyXG5cdFx0XHRcdFx0ZWxzZSB7XHJcblx0XHRcdFx0XHRcdHZhciB0ciA9IG5ldyBUcmFjaygpO1xyXG5cdFx0XHRcdFx0XHR0ci5zZXRSb3V0ZSh0cG9zKTtcclxuXHRcdFx0XHRcdFx0cmVzID0gZm9ybWF0TnVtYmVyMih0ci5nZXRUcmFja0xlbmd0aCgpLzEwMDAuMCkrXCIga21cIjtcclxuXHRcdFx0XHRcdH1cclxuXHRcdFx0XHRcdGlmIChkYXRhW1wicnVuLWNvdW50XCJdICYmIHBhcnNlSW50KGRhdGFbXCJydW4tY291bnRcIl0pID4gMSlcclxuXHRcdFx0XHRcdFx0cmVzPVwiPGI+XCIrZGF0YVtcInJ1bi1jb3VudFwiXStcIng8L2I+IFwiK3JlcztcclxuXHRcdFx0XHRcdGlmIChkYXRhW1wiYmVnaW4tdGltZVwiXSAmJiBkYXRhW1wiZW5kLXRpbWVcIl0pXHJcblx0XHRcdFx0XHRcdHJlcz1kYXRhW1wiYmVnaW4tdGltZVwiXStcIi1cIitkYXRhW1wiZW5kLXRpbWVcIl0rXCIgKFwiK3JlcytcIilcIjtcclxuXHRcdFx0XHRcdHJldHVybiByZXM7XHJcblx0XHRcdFx0fSBcclxuXHRcdFx0fSxcclxuXHRcdFx0eyBkYXRhOiBcImJpa2VTdGFydEtNXCIsY2xhc3NOYW1lIDogXCJkdC1ib2R5LXJpZ2h0XCIgfSxcclxuXHRcdFx0eyBkYXRhOiBcInJ1blN0YXJ0S01cIixjbGFzc05hbWUgOiBcImR0LWJvZHktcmlnaHRcIiB9XHJcblx0XHRdLFxyXG5cdFx0dGFibGVUb29sczoge1xyXG5cdFx0XHRzUm93U2VsZWN0OiBcIm9zXCIsXHJcblx0XHRcdGFCdXR0b25zOiBbXHJcblx0XHRcdCAgICB7IHNFeHRlbmRzOiBcImVkaXRvcl9jcmVhdGVcIiwgZWRpdG9yIDogRURJVE9SMyB9LFxyXG5cdFx0XHRcdHsgc0V4dGVuZHM6IFwiZWRpdG9yX2VkaXRcIiwgICBmbkNsaWNrIDogZnVuY3Rpb24gKCkge1xyXG5cdFx0XHRcdFx0RURJVE9SM1xyXG5cdFx0ICAgICAgICAgICAgLnRpdGxlKCAnRWRpdCBldmVudCBjb25maWd1cmF0aW9uJyApXHJcblx0XHQgICAgICAgICAgICAuYnV0dG9ucyggW1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgeyBsYWJlbDogJ1NhdmUnLCBmbjogZnVuY3Rpb24oKSB7IHRoaXMuc3VibWl0KCk7IH0gfSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHsgbGFiZWw6ICdNYXAnLCBmbjogZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBcdCAgIHZhciBkdCA9IHRhYmxlRXZlbnRzLnJvd3MoXCIuc2VsZWN0ZWRcIikuZGF0YSgpWzBdO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgXHQgICB2YXIgdGhhdD10aGlzO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgXHQgICBtYXBFZGl0KGR0LmlkLCQoXCIjRFRFX0ZpZWxkX3RyYWNrXCIpLnZhbCgpLCQoXCIjRFRFX0ZpZWxkX2Jpa2VTdGFydEtNXCIpLnZhbCgpLCQoXCIjRFRFX0ZpZWxkX3J1blN0YXJ0S01cIikudmFsKCksZnVuY3Rpb24oZGF0YSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgXHRcdCAgICQoXCIjRFRFX0ZpZWxkX3RyYWNrXCIpLnZhbChkYXRhKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIFx0ICAgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfSB9LFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHsgbGFiZWw6ICdTdGFydHMnLCBmbjogZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgXHR2YXIgZWlkID0gJChcIiNEVEVfRmllbGRfaWRcIikudmFsKCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgXHRpZiAoIWVpZCB8fCAhZWlkLmxlbmd0aCkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFx0XHRhbGVydChcIk9ubHkgb24gc2F2ZWQgZXZlbnQgcG9zc2libGUhXCIpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFx0XHRyZXR1cm47XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgXHR9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgXHQgdmFyIHdpbiA9IHdpbmRvdy5vcGVuKFwic3RhcnRzLmh0bWw/aWQ9XCIrZWlkK1wiJnRpdGxlPVwiK2VuY29kZVVSSUNvbXBvbmVudCgkKFwiI0RURV9GaWVsZF9jb2RlXCIpLnZhbCgpK1wiIFwiKyQoXCIjRFRFX0ZpZWxkX3N0YXJ0VGltZVwiKS52YWwoKStcIiA+IFwiKyQoXCIjRFRFX0ZpZWxkX2VuZFRpbWVcIikudmFsKCkpLCAnX2JsYW5rJyk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgXHQgd2luLmZvY3VzKCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfSB9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgXSApXHJcblx0XHQgICAgICAgICAgICAgICAgICAgIC5lZGl0KCB0YWJsZUV2ZW50cy5yb3coICcuc2VsZWN0ZWQnICkubm9kZSgpICk7XHJcblx0XHRcdFx0ICAgICB9IFxyXG5cdFx0XHRcdH0sXHJcblx0XHRcdFx0eyBzRXh0ZW5kczogXCJlZGl0b3JfcmVtb3ZlXCIsIGVkaXRvcjogRURJVE9SMyB9XHJcbiAgICAgICAgICAgXVxyXG5cdFx0fVxyXG5cdH0gKTtcclxuXHRcclxuXHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0XHJcblx0LypcclxuXHQkKFwiI25hdjFcIikuY2xpY2soZnVuY3Rpb24oKSB7XHJcblx0XHQkKFwiI25hdjFcIikuYWRkQ2xhc3MoXCJhY3RpdmVcIik7XHJcblx0XHQkKFwiI25hdjJcIikucmVtb3ZlQ2xhc3MoXCJhY3RpdmVcIik7XHJcblx0XHQkKFwiI3RhYjFcIikuY3NzKFwiaGVpZ2h0XCIsXCJhdXRvXCIpO1xyXG5cdFx0JChcIiN0YWIyXCIpLmNzcyhcImhlaWdodFwiLFwiMFwiKTtcclxuXHR9KTtcclxuXHQkKFwiI25hdjJcIikuY2xpY2soZnVuY3Rpb24oKSB7XHJcblx0XHQkKFwiI25hdjJcIikuYWRkQ2xhc3MoXCJhY3RpdmVcIik7XHJcblx0XHQkKFwiI25hdjFcIikucmVtb3ZlQ2xhc3MoXCJhY3RpdmVcIik7XHJcblx0XHQkKFwiI3RhYjJcIikuY3NzKFwiaGVpZ2h0XCIsXCJhdXRvXCIpO1xyXG5cdFx0JChcIiN0YWIxXCIpLmNzcyhcImhlaWdodFwiLFwiMFwiKTtcclxuXHR9KTtcclxuXHQqL1xyXG5cdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxufSk7XHJcbiIsInZhciBVdGlscyA9IHJlcXVpcmUoXCIuL1V0aWxzLmpzXCIpO1xyXG5cclxudmFyIENPTkZJRyA9IFxyXG57XHJcblx0dGltZW91dHMgOiAvLyBpbiBzZWNvbmRzXHJcblx0e1xyXG5cdFx0ZGV2aWNlVGltZW91dCA6IDYwKjUsXHJcblx0XHRhbmltYXRpb25GcmFtZSA6IFV0aWxzLm1vYmlsZUFuZFRhYmxldENoZWNrKCkgPyAwLjQgOiAwLjEsXHJcblx0XHRncHNMb2NhdGlvbkRlYnVnU2hvdyA6IDQsXHRcdC8vIHRpbWUgdG8gc2hvdyBncHMgbG9jYXRpb24gKGRlYnVnKSBpbmZvXHJcblx0XHRzdHJlYW1EYXRhSW50ZXJ2YWwgOiAxMCBcdFx0LyogTk9STUFMIDEwIHNlY29uZHMgKi9cclxuXHR9LFxyXG5cdGRpc3RhbmNlcyA6IC8vIGluIG1cclxuXHR7XHJcblx0XHRzdGF5T25Sb2FkVG9sZXJhbmNlIDogNTAwLFx0Ly8gNTAwbSBzdGF5IG9uIHJvYWQgdG9sZXJhbmNlXHJcblx0XHRlbGFwc2VkRGlyZWN0aW9uRXBzaWxvbiA6IDUwMCAvLyA1MDBtIGRpcmVjdGlvbiB0b2xlcmFuY2UsIHRvbyBmYXN0IG1vdmVtZW50IHdpbGwgZGlzY2FyZCBcclxuXHR9LFxyXG5cdGNvbnN0cmFpbnRzIDoge1xyXG5cdFx0YmFja3dhcmRzRXBzaWxvbkluTWV0ZXIgOiA0MDAsIC8vMjIwIG0gbW92ZW1lbnQgaW4gdGhlIGJhY2t3YXJkIGRpcmVjdGlvbiB3aWxsIG5vdCB0cmlnZ2VyIG5leHQgcnVuIGNvdW50ZXIgaW5jcmVtZW50XHRcdFxyXG5cdFx0bWF4U3BlZWQgOiAyMCxcdC8va21oXHJcblx0XHRtYXhQYXJ0aWNpcGFudFN0YXRlSGlzdG9yeSA6IDEwMDAsIC8vIG51bWJlciBvZiBlbGVtZW50c1xyXG5cdFx0cG9wdXBFbnN1cmVWaXNpYmxlV2lkdGggOiAyMDAsXHJcblx0XHRwb3B1cEVuc3VyZVZpc2libGVIZWlnaHQ6IDEyMFxyXG5cdH0sXHJcblx0c2ltdWxhdGlvbiA6IHtcclxuXHRcdHBpbmdJbnRlcnZhbCA6IDEwLCAgLy8gaW50ZXJ2YWwgaW4gc2Vjb25kcyB0byBwaW5nIHdpdGggZ3BzIGRhdGFcclxuXHRcdGdwc0luYWNjdXJhY3kgOiA0LCAvLzgsICAvLyBlcnJvciBzaW11bGF0aW9uIGluIE1FVEVSIChsb29rIG1hdGguZ3BzSW5hY2N1cmFjeSwgbWluIDEvMilcclxuXHRcdHNwZWVkQ29lZiA6IDEwMFxyXG5cdH0sXHJcblx0c2V0dGluZ3MgOiB7XHJcblx0XHRub01pZGRsZVdhcmUgOiAwLCBcdC8vIFNLSVAgbWlkZGxlIHdhcmUgbm9kZSBqcyBhcHBcclxuXHRcdG5vSW50ZXJwb2xhdGlvbiA6IDBcdC8vIDEgLT4gbm8gaW50ZXJwb2xhdGlvbiBvbmx5IHBvaW50c1xyXG5cdH0sXHJcblx0bWF0aCA6IHtcclxuXHRcdHByb2plY3Rpb25TY2FsZVkgOiAwLjc1LFx0XHRcdFx0Ly8gVE9ETyBFWFBMQUlOIChyZWN0YW5nZSBjcmVhdGlvbiBpbiB3b3JsZCBtZXJjYXRvciBjb2VmIHkgXHJcblx0XHRncHNJbmFjY3VyYWN5IDogMzAsXHRcdFx0XHRcdFx0IC8vVE9ETyAxMyBtaW4gPyBcclxuXHRcdHNwZWVkQW5kQWNjZWxlcmF0aW9uQXZlcmFnZURlZ3JlZSA6IDIsXHQvLyBjYWxjdWxhdGlvbiBiYXNlZCBvbiBOIHN0YXRlcyAoYXZlcmFnZSkgKE1JTiAyKVxyXG5cdFx0ZGlzcGxheURlbGF5IDogOTAsXHRcdFx0XHRcdFx0Ly8gZGlzcGxheSBkZWxheSBpbiBTRUNPTkRTXHJcblx0XHRpbnRlcnBvbGF0ZUdQU0F2ZXJhZ2UgOiAwIC8vIG51bWJlciBvZiByZWNlbnQgdmFsdWVzIHRvIGNhbGN1bGF0ZSBhdmVyYWdlIGdwcyBmb3IgcG9zaXRpb24gKHNtb290aGluZyB0aGUgY3VydmUubWluIDAgPSBOTywxID0gMiB2YWx1ZXMgKGN1cnJlbnQgYW5kIGxhc3QpKVxyXG5cdH0sXHJcblx0Y29uc3RhbnRzIDogXHJcblx0e1xyXG5cdFx0YWdlR3JvdXBzIDogIFxyXG5cdFx0W1xyXG5cdFx0IHtcclxuXHRcdFx0IGZyb20gOiBudWxsLFxyXG5cdFx0XHQgdG8gOiA4LCBcclxuXHRcdFx0IGNvZGUgOiBcIkZpcnN0QWdlR3JvdXBcIlxyXG5cdFx0IH1cclxuXHRcdCAse1xyXG5cdFx0XHQgZnJvbSA6IDgsXHJcblx0XHRcdCB0byA6IDQwLCBcclxuXHRcdFx0IGNvZGUgOiBcIk1pZGRsZUFnZUdyb3VwXCJcclxuXHRcdCB9XHJcblx0XHQgLHtcclxuXHRcdFx0IGZyb20gOiA0MCxcclxuXHRcdFx0IHRvIDogbnVsbCwgXHJcblx0XHRcdCBjb2RlIDogXCJMYXN0QWdlR3JvdXBcIlxyXG5cdFx0IH1cclxuXHRcdF1cclxuXHR9LFxyXG5cclxuXHRldmVudCA6IHtcclxuXHRcdGJlZ2luVGltZXN0YW1wIDogKG5ldyBEYXRlKCkpLmdldFRpbWUoKSxcclxuXHRcdGR1cmF0aW9uIDogNjAsIC8vTUlOVVRFU1xyXG5cdFx0aWQgOiAzXHJcblx0fSxcclxuXHJcblx0c2VydmVyIDoge1xyXG5cdFx0cHJlZml4IDogXCIvdHJpYXRobG9uL1wiXHJcblx0fSxcclxuXHRcclxuXHRhcHBlYXJhbmNlIDoge1xyXG5cdFx0ZGVidWcgOiAwLFxyXG5cdFx0dHJhY2tDb2xvclN3aW0gOiAnIzU2NzZmZicsXHJcblx0XHR0cmFja0NvbG9yQmlrZSA6ICcjRTIwMDc0JyxcclxuXHRcdHRyYWNrQ29sb3JSdW4gOiAgJyMwNzlmMzYnLFxyXG5cclxuXHRcdC8vIE5vdGUgdGhlIHNlcXVlbmNlIGlzIGFsd2F5cyBTd2ltLUJpa2UtUnVuIC0gc28gMiBjaGFuZ2UtcG9pbnRzXHJcblx0XHQvLyBUT0RPIFJ1bWVuIC0gYWRkIHNjYWxlIGhlcmUsIG5vdCBpbiBTdHlsZXMuanNcclxuXHRcdGltYWdlU3RhcnQgOiBcImltZy9zdGFydC5wbmdcIixcclxuXHRcdGltYWdlRmluaXNoIDogXCJpbWcvZmluaXNoLnBuZ1wiLFxyXG5cdFx0aW1hZ2VDYW0gOiBcImltZy9jYW1lcmEuc3ZnXCIsXHJcblx0XHRpbWFnZUNoZWNrcG9pbnRTd2ltQmlrZSA6IFwiaW1nL3d6MS5zdmdcIixcclxuXHRcdGltYWdlQ2hlY2twb2ludEJpa2VSdW4gOiBcImltZy93ejIuc3ZnXCIsXHJcblx0XHRpc1Nob3dDaGVja3BvaW50SW1hZ2UgOiBmYWxzZSwgLyogc2hvdyBhbiBpbWFnZSBvbiB0aGUgY2hlY2twb2ludHMgKGUuZyBvbiB0aGUgY2hhbmdpbmcgV1ogcG9pbnRzICovXHJcblx0XHRpc1Nob3dDaGVja3BvaW50IDogZmFsc2UsICAvKiBzaG93IGFuIHNxdWFyZSBvbiB0aGUgc2FtZSBjb2xvciBvbiB0aGUgY2hlY2twb2ludHMsIG9ubHkgaWYgaXNTaG93Q2hlY2twb2ludEltYWdlIGlzIG5vdCB0cnVlKi9cclxuXHJcbiAgICAgICAgLy8gdGhlIGRpc3RhbmNlIGJldHdlZW4gdGhlIGRpcmVjdGlvbiBpY29ucyAtIGluIHBpeGVscyxcclxuICAgICAgICAvLyBpZiBzZXQgbm9uLXBvc2l0aXZlIHZhbHVlICgwIG9yIGxlc3MpIHRoZW4gZG9uJ3Qgc2hvdyB0aGVtIGF0IGFsbFxyXG5cdFx0Ly9kaXJlY3Rpb25JY29uQmV0d2VlbiA6IDIwMFxyXG5cdFx0ZGlyZWN0aW9uSWNvbkJldHdlZW4gOiAtMVxyXG5cdH0sXHJcblxyXG4gICAgaG90c3BvdCA6IHtcclxuICAgICAgICBjYW0gOiB7aW1hZ2UgOlwiaW1nL2NhbWVyYS5zdmdcIn0sICAvLyB1c2UgdGhlIHNhbWUgaW1hZ2UgZm9yIHN0YXRpYyBjYW1lcmFzIGFzIGZvciB0aGUgbW92aW5nIG9uZXNcclxuXHRcdGNhbVN3aW1CaWtlIDoge2ltYWdlIDogXCJpbWcvd3oxLnN2Z1wifSxcclxuXHRcdGNhbUJpa2VSdW4gOiB7aW1hZ2UgOiBcImltZy93ejIuc3ZnXCJ9LFxyXG4gICAgICAgIHdhdGVyIDoge2ltYWdlIDogXCJpbWcvd2F0ZXIuc3ZnXCJ9LFxyXG4gICAgICAgIHV0dXJuIDoge2ltYWdlIDogXCJpbWcvdXR1cm4uc3ZnXCJ9LFxyXG5cclxuXHRcdGttMTAgOiB7aW1hZ2UgOiBcImltZy8xMGttLnN2Z1wiLCBzY2FsZSA6IDEuNX0sXHJcblx0XHRrbTIwIDoge2ltYWdlIDogXCJpbWcvMjBrbS5zdmdcIiwgc2NhbGUgOiAxLjV9LFxyXG5cdFx0a20zMCA6IHtpbWFnZSA6IFwiaW1nLzMwa20uc3ZnXCIsIHNjYWxlIDogMS41fSxcclxuXHRcdGttNDAgOiB7aW1hZ2UgOiBcImltZy80MGttLnN2Z1wiLCBzY2FsZSA6IDEuNX0sXHJcblx0XHRrbTYwIDoge2ltYWdlIDogXCJpbWcvNjBrbS5zdmdcIiwgc2NhbGUgOiAxLjV9LFxyXG5cdFx0a204MCA6IHtpbWFnZSA6IFwiaW1nLzgwa20uc3ZnXCIsIHNjYWxlIDogMS41fSxcclxuXHRcdGttMTAwIDoge2ltYWdlIDogXCJpbWcvMTAwa20uc3ZnXCIsIHNjYWxlIDogMS41fSxcclxuXHRcdGttMTIwIDoge2ltYWdlIDogXCJpbWcvMTIwa20uc3ZnXCIsIHNjYWxlIDogMS41fSxcclxuXHRcdGttMTQwIDoge2ltYWdlIDogXCJpbWcvMTQwa20uc3ZnXCIsIHNjYWxlIDogMS41fSxcclxuXHRcdGttMTYwIDoge2ltYWdlIDogXCJpbWcvMTYwa20uc3ZnXCIsIHNjYWxlIDogMS41fSxcclxuXHRcdGttMTgwIDoge2ltYWdlIDogXCJpbWcvMTgwa20uc3ZnXCIsIHNjYWxlIDogMS41fVxyXG4gICAgfVxyXG59O1xyXG5cclxuZm9yICh2YXIgaSBpbiBDT05GSUcpXHJcblx0ZXhwb3J0c1tpXT1DT05GSUdbaV07XHJcbiIsInZhciBVdGlscz1yZXF1aXJlKCcuL1V0aWxzJyk7XHJcbnZhciBTVFlMRVM9cmVxdWlyZSgnLi9TdHlsZXMnKTtcclxucmVxdWlyZSgnam9vc2UnKTtcclxucmVxdWlyZSgnLi9UcmFjaycpO1xyXG5yZXF1aXJlKCcuL0xpdmVTdHJlYW0nKTtcclxudmFyIENPTkZJRyA9IHJlcXVpcmUoXCIuL0NvbmZpZ1wiKTtcclxuXHJcbkNsYXNzKFwiR3VpXCIsIFxyXG57XHJcbiAgICAvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0Ly8gQUxMIENPT1JESU5BVEVTIEFSRSBJTiBXT1JMRCBNRVJDQVRPUlxyXG4gICAgLy8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG4gICAgaGFzOiBcclxuXHR7XHJcbiAgICBcdGlzRGVidWcgOiB7XHJcbiAgICBcdFx0aXMgOiBcInJ3XCIsXHJcbiAgICBcdFx0aW5pdCA6ICFVdGlscy5tb2JpbGVBbmRUYWJsZXRDaGVjaygpICYmIENPTkZJRy5hcHBlYXJhbmNlLmRlYnVnXHJcbiAgICBcdH0sXHJcblx0XHRpc1dpZGdldCA6IHtcclxuXHRcdFx0aW5pdCA6IGZhbHNlXHJcblx0XHR9LFxyXG5cdFx0aXNEZWJ1Z1Nob3dQb3NpdGlvbiA6IHtcclxuXHRcdFx0Ly8gaWYgc2V0IHRvIHRydWUgaXQgd2lsbCBhZGQgYW4gYWJzb2x1dGUgZWxlbWVudCBzaG93aW5nIHRoZSBjb29yZGluYXRlcyBhYm92ZSB0aGUgbW91c2UgbG9jYXRpb25cclxuXHRcdFx0aW5pdCA6IGZhbHNlXHJcblx0XHR9LFxyXG5cdFx0cmVjZWl2ZXJPbk1hcENsaWNrIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IFtdXHJcblx0XHR9LFxyXG4gICAgICAgIHdpZHRoIDoge1xyXG4gICAgICAgICAgICBpczogICBcInJ3XCIsXHJcbiAgICAgICAgICAgIGluaXQ6IDc1MFxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgaGVpZ2h0OiB7XHJcbiAgICAgICAgICAgIGlzOiAgIFwicndcIixcclxuICAgICAgICAgICAgaW5pdDogNTAwXHJcbiAgICAgICAgfSxcclxuXHRcdHRyYWNrIDoge1xyXG5cdFx0XHRpczogICBcInJ3XCJcclxuXHRcdH0sXHJcblx0XHRlbGVtZW50SWQgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogXCJtYXBcIlxyXG5cdFx0fSxcclxuXHRcdGluaXRpYWxQb3MgOiB7XHRcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiBudWxsXHJcblx0XHR9LFxyXG5cdFx0aW5pdGlhbFpvb20gOiB7XHRcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiAxMFxyXG5cdFx0fSxcclxuXHRcdGlzU2tpcEV4dGVudCA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiBmYWxzZVxyXG5cdFx0fSxcclxuXHRcdGJpbmdNYXBLZXkgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogJ0FpanQzQXNXT01FM2hQRUVfSHFSbFVLZGNCS3FlOGRHUlpIX3YtTDNIX0ZGNjRzdlhNYmtyMVQ2dV9XQVNvZXQnXHJcblx0XHR9LFxyXG5cdFx0Ly8tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0XHRtYXAgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogbnVsbFxyXG5cdFx0fSxcclxuXHRcdHRyYWNrTGF5ZXIgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogbnVsbFxyXG5cdFx0fSxcclxuICAgICAgICBob3RzcG90c0xheWVyIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IG51bGxcclxuXHRcdH0sXHJcbiAgICAgICAgY2Ftc0xheWVyIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IG51bGxcclxuXHRcdH0sXHJcblx0XHRwYXJ0aWNpcGFudHNMYXllciA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiBudWxsXHJcblx0XHR9LFxyXG5cdFx0ZGVidWdMYXllckdQUyA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiBudWxsXHJcblx0XHR9LFx0XHJcblx0XHR0ZXN0TGF5ZXIgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogbnVsbFxyXG5cdFx0fSxcdFxyXG5cdFx0dGVzdExheWVyMSA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiBudWxsXHJcblx0XHR9LFx0XHJcblx0XHR0ZXN0TGF5ZXIyIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IG51bGxcclxuXHRcdH0sXHRcclxuXHRcdFxyXG5cdFx0c2VsZWN0ZWRQYXJ0aWNpcGFudDEgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogbnVsbFxyXG5cdFx0fSxcclxuXHRcdHNlbGVjdGVkUGFydGljaXBhbnQyIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IG51bGxcclxuXHRcdH0sXHJcblx0XHRwb3B1cDEgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogbnVsbFxyXG5cdFx0fSxcclxuXHRcdHBvcHVwMiA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiBudWxsXHJcblx0XHR9LFxyXG5cdFx0aXNTaG93U3dpbSA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiB0cnVlXHJcblx0XHR9LFxyXG5cdFx0aXNTaG93QmlrZSA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiB0cnVlXHJcblx0XHR9LFxyXG5cdFx0aXNTaG93UnVuIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IHRydWVcclxuXHRcdH0sXHJcblx0XHRzZWxlY3ROdW0gOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogMVxyXG5cdFx0fSxcclxuICAgICAgICBsaXZlU3RyZWFtIDoge1xyXG4gICAgICAgICAgICBpbml0OiBudWxsXHJcbiAgICAgICAgfVxyXG4gICAgfSxcclxuICAgIC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRtZXRob2RzOiBcclxuXHR7XHJcbiAgICAgICAgaW5pdDogZnVuY3Rpb24gKHBhcmFtcykgIFxyXG5cdFx0e1xyXG5cdFx0XHQvLyBpZiBpbiB3aWRnZXQgbW9kZSB0aGVuIGRpc2FibGUgZGVidWdcclxuXHRcdFx0aWYgKHRoaXMuaXNXaWRnZXQpIHtcclxuXHRcdFx0XHR0aGlzLmlzRGVidWcgPSBmYWxzZTtcclxuXHRcdFx0fVxyXG5cclxuXHRcdFx0dmFyIGRlZlBvcyA9IFswLDBdO1xyXG5cdFx0XHRpZiAodGhpcy5pbml0aWFsUG9zKSB7XHJcblx0XHRcdFx0ZGVmUG9zID0gdGhpcy5pbml0aWFsUG9zO1xyXG5cdFx0XHR9IGVsc2UgaWYgKFRSQUNLLmdldFJvdXRlKCkgJiYgVFJBQ0suZ2V0Um91dGUoKS5sZW5ndGggPiAxKSB7XHJcblx0XHRcdFx0ZGVmUG9zID0gVFJBQ0suZ2V0Um91dGUoKVswXTtcclxuXHRcdFx0fVxyXG5cdFx0XHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdFx0XHR2YXIgZXh0ZW50ID0gdGhpcy5pc1NraXBFeHRlbnQgPyBudWxsIDogVFJBQ0suZ2V0Um91dGUoKSAmJiBUUkFDSy5nZXRSb3V0ZSgpLmxlbmd0aCA+IDEgPyBvbC5wcm9qLnRyYW5zZm9ybUV4dGVudCggKG5ldyBvbC5nZW9tLkxpbmVTdHJpbmcoVFJBQ0suZ2V0Um91dGUoKSkpLmdldEV4dGVudCgpICwgJ0VQU0c6NDMyNicsICdFUFNHOjM4NTcnKSA6IG51bGw7XHJcblx0XHRcdHRoaXMudHJhY2tMYXllciA9IG5ldyBvbC5sYXllci5WZWN0b3Ioe1xyXG5cdFx0XHQgIHNvdXJjZTogbmV3IG9sLnNvdXJjZS5WZWN0b3IoKSxcclxuXHRcdFx0ICBzdHlsZSA6IFNUWUxFU1tcInRyYWNrXCJdXHJcblx0XHRcdH0pO1xyXG5cdFx0XHR0aGlzLmhvdHNwb3RzTGF5ZXIgPSBuZXcgb2wubGF5ZXIuVmVjdG9yKHtcclxuXHRcdFx0ICBzb3VyY2U6IG5ldyBvbC5zb3VyY2UuVmVjdG9yKCksXHJcblx0XHRcdCAgc3R5bGUgOiBTVFlMRVNbXCJob3RzcG90XCJdXHJcblx0XHRcdH0pO1xyXG5cdFx0XHR0aGlzLnBhcnRpY2lwYW50c0xheWVyID0gbmV3IG9sLmxheWVyLlZlY3Rvcih7XHJcblx0XHRcdCAgc291cmNlOiBuZXcgb2wuc291cmNlLlZlY3RvcigpLFxyXG5cdFx0XHQgIHN0eWxlIDogU1RZTEVTW1wicGFydGljaXBhbnRcIl1cclxuXHRcdFx0fSk7XHJcblx0XHRcdHRoaXMuY2Ftc0xheWVyID0gbmV3IG9sLmxheWVyLlZlY3Rvcih7XHJcblx0XHRcdFx0c291cmNlOiBuZXcgb2wuc291cmNlLlZlY3RvcigpLFxyXG5cdFx0XHRcdHN0eWxlIDogU1RZTEVTW1wiY2FtXCJdXHJcblx0XHRcdH0pO1xyXG5cdFx0XHRpZiAodGhpcy5pc0RlYnVnKSBcclxuXHRcdFx0e1xyXG5cdFx0XHRcdHRoaXMuZGVidWdMYXllckdQUyA9IG5ldyBvbC5sYXllci5WZWN0b3Ioe1xyXG5cdFx0XHRcdFx0ICBzb3VyY2U6IG5ldyBvbC5zb3VyY2UuVmVjdG9yKCksXHJcblx0XHRcdFx0XHQgIHN0eWxlIDogU1RZTEVTW1wiZGVidWdHUFNcIl1cclxuXHRcdFx0XHR9KTtcclxuXHRcdFx0XHR0aGlzLnRlc3RMYXllciA9IG5ldyBvbC5sYXllci5WZWN0b3Ioe1xyXG5cdFx0XHRcdFx0ICBzb3VyY2U6IG5ldyBvbC5zb3VyY2UuVmVjdG9yKCksXHJcblx0XHRcdFx0XHQgIHN0eWxlIDogU1RZTEVTW1widGVzdFwiXVxyXG5cdFx0XHRcdH0pO1xyXG5cdFx0XHRcdHRoaXMudGVzdExheWVyMSA9IG5ldyBvbC5sYXllci5WZWN0b3Ioe1xyXG5cdFx0XHRcdFx0ICBzb3VyY2U6IG5ldyBvbC5zb3VyY2UuVmVjdG9yKCksXHJcblx0XHRcdFx0XHQgIHN0eWxlIDogU1RZTEVTW1widGVzdDFcIl1cclxuXHRcdFx0XHR9KTtcclxuXHRcdFx0XHR0aGlzLnRlc3RMYXllcjIgPSBuZXcgb2wubGF5ZXIuVmVjdG9yKHtcclxuXHRcdFx0XHRcdCAgc291cmNlOiBuZXcgb2wuc291cmNlLlZlY3RvcigpLFxyXG5cdFx0XHRcdCAgXHRzdHlsZSA6IFNUWUxFU1tcInRlc3QyXCJdXHJcblx0XHRcdFx0fSk7XHJcblx0XHRcdH1cclxuXHRcdFx0Ly8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdFx0XHR2YXIgaW50cyA9IFtdO1xyXG5cdFx0XHR0aGlzLnBvcHVwMSA9IG5ldyBvbC5PdmVybGF5LlBvcHVwKHthbmk6ZmFsc2UscGFuTWFwSWZPdXRPZlZpZXcgOiBmYWxzZX0pO1xyXG5cdFx0XHR0aGlzLnBvcHVwMiA9IG5ldyBvbC5PdmVybGF5LlBvcHVwKHthbmk6ZmFsc2UscGFuTWFwSWZPdXRPZlZpZXcgOiBmYWxzZX0pO1xyXG5cdFx0XHR0aGlzLnBvcHVwMi5zZXRPZmZzZXQoWzAsMTc1XSk7XHJcblx0XHRcdHRoaXMubWFwID0gbmV3IG9sLk1hcCh7XHJcblx0XHRcdCAgcmVuZGVyZXIgOiBcImNhbnZhc1wiLFxyXG5cdFx0XHQgIHRhcmdldDogJ21hcCcsXHJcblx0XHRcdCAgbGF5ZXJzOiBbXHJcblx0XHRcdCAgICAgICAgICAgbmV3IG9sLmxheWVyLlRpbGUoe1xyXG5cdFx0XHQgICAgICAgICAgICAgICBzb3VyY2U6IG5ldyBvbC5zb3VyY2UuT1NNKClcclxuXHRcdFx0ICAgICAgICAgICB9KSxcclxuXHRcdFx0XHRcdHRoaXMudHJhY2tMYXllcixcclxuXHRcdFx0XHRcdHRoaXMuaG90c3BvdHNMYXllcixcclxuXHRcdFx0XHRcdHRoaXMuY2Ftc0xheWVyLFxyXG5cdFx0XHRcdFx0dGhpcy5wYXJ0aWNpcGFudHNMYXllclxyXG5cdFx0XHQgIF0sXHJcblx0XHRcdCAgY29udHJvbHM6IHRoaXMuaXNXaWRnZXQgPyBbXSA6IG9sLmNvbnRyb2wuZGVmYXVsdHMoKSxcclxuXHRcdFx0ICB2aWV3OiBuZXcgb2wuVmlldyh7XHJcblx0XHRcdFx0Y2VudGVyOiBvbC5wcm9qLnRyYW5zZm9ybShkZWZQb3MsICdFUFNHOjQzMjYnLCAnRVBTRzozODU3JyksXHJcblx0XHRcdFx0em9vbTogdGhpcy5pbml0aWFsWm9vbSxcclxuXHRcdFx0XHRtaW5ab29tOiB0aGlzLmlzV2lkZ2V0ID8gdGhpcy5pbml0aWFsWm9vbSA6IDgsXHJcblx0XHRcdFx0bWF4Wm9vbTogdGhpcy5pc1dpZGdldCA/IHRoaXMuaW5pdGlhbFpvb20gOiAoQ09ORklHLmFwcGVhcmFuY2UuZGVidWcgPyAyMCA6IDE3KSxcclxuXHRcdFx0XHRleHRlbnQgOiBleHRlbnQgPyBleHRlbnQgOiB1bmRlZmluZWRcclxuXHRcdFx0ICB9KVxyXG5cdFx0XHR9KTtcclxuXHRcdFx0XHJcblx0XHRcdGZvciAodmFyIGk9MDtpPGludHMubGVuZ3RoO2krKylcclxuXHRcdFx0XHR0aGlzLm1hcC5hZGRJbnRlcmFjdGlvbihpbnRzW2ldKTtcclxuXHRcdFx0dGhpcy5tYXAuYWRkT3ZlcmxheSh0aGlzLnBvcHVwMSk7XHJcblx0XHRcdHRoaXMubWFwLmFkZE92ZXJsYXkodGhpcy5wb3B1cDIpO1xyXG5cdFx0XHRpZiAodGhpcy5pc0RlYnVnKSB7IFxyXG5cdFx0XHRcdHRoaXMubWFwLmFkZExheWVyKHRoaXMuZGVidWdMYXllckdQUyk7XHJcblx0XHRcdFx0dGhpcy5tYXAuYWRkTGF5ZXIodGhpcy50ZXN0TGF5ZXIpO1xyXG5cdFx0XHRcdHRoaXMubWFwLmFkZExheWVyKHRoaXMudGVzdExheWVyMSk7XHJcblx0XHRcdFx0dGhpcy5tYXAuYWRkTGF5ZXIodGhpcy50ZXN0TGF5ZXIyKTtcclxuXHRcdFx0fVxyXG5cdFx0XHRUUkFDSy5pbml0KCk7XHJcblx0XHRcdHRoaXMuYWRkVHJhY2tGZWF0dXJlKCk7XHJcblx0XHRcdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdFx0XHRpZiAoIXRoaXMuaXNXaWRnZXQpIHtcclxuXHRcdFx0XHR0aGlzLm1hcC5vbignY2xpY2snLCBmdW5jdGlvbiAoZXZlbnQpIHtcclxuXHRcdFx0XHRcdFRSQUNLLm9uTWFwQ2xpY2soZXZlbnQpO1xyXG5cdFx0XHRcdFx0dmFyIHNlbGVjdGVkUGFydGljaXBhbnRzID0gW107XHJcblx0XHRcdFx0XHR2YXIgc2VsZWN0ZWRIb3RzcG90ID0gbnVsbDtcclxuXHRcdFx0XHRcdHRoaXMubWFwLmZvckVhY2hGZWF0dXJlQXRQaXhlbChldmVudC5waXhlbCwgZnVuY3Rpb24gKGZlYXR1cmUsIGxheWVyKSB7XHJcblx0XHRcdFx0XHRcdGlmIChsYXllciA9PSB0aGlzLnBhcnRpY2lwYW50c0xheWVyKSB7XHJcblx0XHRcdFx0XHRcdFx0c2VsZWN0ZWRQYXJ0aWNpcGFudHMucHVzaChmZWF0dXJlKTtcclxuXHRcdFx0XHRcdFx0fSBlbHNlIGlmIChsYXllciA9PSB0aGlzLmhvdHNwb3RzTGF5ZXIpIHtcclxuXHRcdFx0XHRcdFx0XHQvLyBhbGxvdyBvbmx5IG9uZSBob3RzcG90IHRvIGJlIHNlbGVjdGVkIGF0IGEgdGltZVxyXG5cdFx0XHRcdFx0XHRcdGlmICghc2VsZWN0ZWRIb3RzcG90KVxyXG5cdFx0XHRcdFx0XHRcdFx0c2VsZWN0ZWRIb3RzcG90ID0gZmVhdHVyZTtcclxuXHRcdFx0XHRcdFx0fVxyXG5cdFx0XHRcdFx0fSwgdGhpcyk7XHJcblxyXG5cdFx0XHRcdFx0Ly8gZmlyc3QgaWYgdGhlcmUgYXJlIHNlbGVjdGVkIHBhcnRpY2lwYW50cyB0aGVuIHNob3cgdGhlaXIgcG9wdXBzXHJcblx0XHRcdFx0XHQvLyBhbmQgb25seSBpZiB0aGVyZSBhcmUgbm90IHVzZSB0aGUgc2VsZWN0ZWQgaG90c3BvdCBpZiB0aGVyZSdzIGFueVxyXG5cdFx0XHRcdFx0aWYgKHNlbGVjdGVkUGFydGljaXBhbnRzLmxlbmd0aCkge1xyXG5cdFx0XHRcdFx0XHRpZiAodGhpcy5zZWxlY3RlZFBhcnRpY2lwYW50MSA9PSBudWxsKSB7XHJcblx0XHRcdFx0XHRcdFx0dmFyIGZlYXQgPSB0aGlzLmdldFNlbGVjdGVkUGFydGljaXBhbnRGcm9tQXJyYXlDeWNsaWMoc2VsZWN0ZWRQYXJ0aWNpcGFudHMpO1xyXG5cdFx0XHRcdFx0XHRcdGlmIChmZWF0KVxyXG5cdFx0XHRcdFx0XHRcdFx0dGhpcy5zZXRTZWxlY3RlZFBhcnRpY2lwYW50MShmZWF0LnBhcnRpY2lwYW50KTtcclxuXHRcdFx0XHRcdFx0XHRlbHNlXHJcblx0XHRcdFx0XHRcdFx0XHR0aGlzLnNldFNlbGVjdGVkUGFydGljaXBhbnQxKG51bGwpO1xyXG5cdFx0XHRcdFx0XHRcdHRoaXMuc2VsZWN0TnVtID0gMDtcclxuXHRcdFx0XHRcdFx0fSBlbHNlIGlmICh0aGlzLnNlbGVjdGVkUGFydGljaXBhbnQyID09IG51bGwpIHtcclxuXHRcdFx0XHRcdFx0XHR2YXIgZmVhdCA9IHRoaXMuZ2V0U2VsZWN0ZWRQYXJ0aWNpcGFudEZyb21BcnJheUN5Y2xpYyhzZWxlY3RlZFBhcnRpY2lwYW50cyk7XHJcblx0XHRcdFx0XHRcdFx0aWYgKGZlYXQpXHJcblx0XHRcdFx0XHRcdFx0XHR0aGlzLnNldFNlbGVjdGVkUGFydGljaXBhbnQyKGZlYXQucGFydGljaXBhbnQpO1xyXG5cdFx0XHRcdFx0XHRcdGVsc2VcclxuXHRcdFx0XHRcdFx0XHRcdHRoaXMuc2V0U2VsZWN0ZWRQYXJ0aWNpcGFudDIobnVsbCk7XHJcblx0XHRcdFx0XHRcdFx0dGhpcy5zZWxlY3ROdW0gPSAxO1xyXG5cdFx0XHRcdFx0XHR9IGVsc2Uge1xyXG5cdFx0XHRcdFx0XHRcdHRoaXMuc2VsZWN0TnVtID0gKHRoaXMuc2VsZWN0TnVtICsgMSkgJSAyO1xyXG5cdFx0XHRcdFx0XHRcdGlmICh0aGlzLnNlbGVjdE51bSA9PSAwKSB7XHJcblx0XHRcdFx0XHRcdFx0XHR2YXIgZmVhdCA9IHRoaXMuZ2V0U2VsZWN0ZWRQYXJ0aWNpcGFudEZyb21BcnJheUN5Y2xpYyhzZWxlY3RlZFBhcnRpY2lwYW50cyk7XHJcblx0XHRcdFx0XHRcdFx0XHRpZiAoZmVhdClcclxuXHRcdFx0XHRcdFx0XHRcdFx0dGhpcy5zZXRTZWxlY3RlZFBhcnRpY2lwYW50MShmZWF0LnBhcnRpY2lwYW50KTtcclxuXHRcdFx0XHRcdFx0XHRcdGVsc2VcclxuXHRcdFx0XHRcdFx0XHRcdFx0dGhpcy5zZXRTZWxlY3RlZFBhcnRpY2lwYW50MShudWxsKTtcclxuXHRcdFx0XHRcdFx0XHR9IGVsc2Uge1xyXG5cdFx0XHRcdFx0XHRcdFx0dmFyIGZlYXQgPSB0aGlzLmdldFNlbGVjdGVkUGFydGljaXBhbnRGcm9tQXJyYXlDeWNsaWMoc2VsZWN0ZWRQYXJ0aWNpcGFudHMpO1xyXG5cdFx0XHRcdFx0XHRcdFx0aWYgKGZlYXQpXHJcblx0XHRcdFx0XHRcdFx0XHRcdHRoaXMuc2V0U2VsZWN0ZWRQYXJ0aWNpcGFudDIoZmVhdC5wYXJ0aWNpcGFudCk7XHJcblx0XHRcdFx0XHRcdFx0XHRlbHNlXHJcblx0XHRcdFx0XHRcdFx0XHRcdHRoaXMuc2V0U2VsZWN0ZWRQYXJ0aWNpcGFudDIobnVsbCk7XHJcblx0XHRcdFx0XHRcdFx0fVxyXG5cdFx0XHRcdFx0XHR9XHJcblx0XHRcdFx0XHR9IGVsc2Uge1xyXG5cdFx0XHRcdFx0XHR0aGlzLnNldFNlbGVjdGVkUGFydGljaXBhbnQxKG51bGwpO1xyXG5cdFx0XHRcdFx0XHR0aGlzLnNldFNlbGVjdGVkUGFydGljaXBhbnQyKG51bGwpO1xyXG5cclxuXHRcdFx0XHRcdFx0aWYgKHNlbGVjdGVkSG90c3BvdCkge1xyXG5cdFx0XHRcdFx0XHRcdHNlbGVjdGVkSG90c3BvdC5ob3RzcG90Lm9uQ2xpY2soKTtcclxuXHRcdFx0XHRcdFx0fVxyXG5cdFx0XHRcdFx0fVxyXG5cdFx0XHRcdH0sIHRoaXMpO1xyXG5cclxuXHRcdFx0XHQvLyBjaGFuZ2UgbW91c2UgY3Vyc29yIHdoZW4gb3ZlciBzcGVjaWZpYyBmZWF0dXJlc1xyXG5cdFx0XHRcdHZhciBzZWxmID0gdGhpcztcclxuXHRcdFx0XHQkKHRoaXMubWFwLmdldFZpZXdwb3J0KCkpLm9uKCdtb3VzZW1vdmUnLCBmdW5jdGlvbiAoZSkge1xyXG5cdFx0XHRcdFx0dmFyIHBpeGVsID0gc2VsZi5tYXAuZ2V0RXZlbnRQaXhlbChlLm9yaWdpbmFsRXZlbnQpO1xyXG5cdFx0XHRcdFx0dmFyIGlzQ2xpY2thYmxlID0gc2VsZi5tYXAuZm9yRWFjaEZlYXR1cmVBdFBpeGVsKHBpeGVsLCBmdW5jdGlvbiAoZmVhdHVyZSwgbGF5ZXIpIHtcclxuXHRcdFx0XHRcdFx0aWYgKGxheWVyID09PSBzZWxmLnBhcnRpY2lwYW50c0xheWVyIHx8IGxheWVyID09PSBzZWxmLmNhbXNMYXllcikge1xyXG5cdFx0XHRcdFx0XHRcdC8vIGFsbCBwYXJ0aWNpcGFudHMgYW5kIG1vdmluZyBjYW1lcmFzIGFyZSBjbGlja2FibGVcclxuXHRcdFx0XHRcdFx0XHRyZXR1cm4gdHJ1ZTtcclxuXHRcdFx0XHRcdFx0fSBlbHNlIGlmIChsYXllciA9PT0gc2VsZi5ob3RzcG90c0xheWVyKSB7XHJcblx0XHRcdFx0XHRcdFx0Ly8gZ2V0IFwiY2xpY2thYmlsaXR5XCIgZnJvbSB0aGUgaG90c3BvdFxyXG5cdFx0XHRcdFx0XHRcdHJldHVybiBmZWF0dXJlLmhvdHNwb3QuaXNDbGlja2FibGUoKTtcclxuXHRcdFx0XHRcdFx0fVxyXG5cdFx0XHRcdFx0fSk7XHJcblx0XHRcdFx0XHRzZWxmLm1hcC5nZXRWaWV3cG9ydCgpLnN0eWxlLmN1cnNvciA9IGlzQ2xpY2thYmxlID8gJ3BvaW50ZXInIDogJyc7XHJcblx0XHRcdFx0fSk7XHJcblx0XHRcdH1cclxuXHRcdFx0Ly8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdFx0XHRpZiAoIXRoaXMuX2FuaW1hdGlvbkluaXQpIHtcclxuXHRcdFx0XHR0aGlzLl9hbmltYXRpb25Jbml0PXRydWU7XHJcblx0XHRcdFx0c2V0SW50ZXJ2YWwodGhpcy5vbkFuaW1hdGlvbi5iaW5kKHRoaXMpLCAxMDAwKkNPTkZJRy50aW1lb3V0cy5hbmltYXRpb25GcmFtZSApO1xyXG5cdFx0XHR9XHJcblxyXG5cdFx0XHQvLyBpZiB0aGlzIGlzIE9OIHRoZW4gaXQgd2lsbCBzaG93IHRoZSBjb29yZGluYXRlcyBwb3NpdGlvbiB1bmRlciB0aGUgbW91c2UgbG9jYXRpb25cclxuXHRcdFx0aWYgKHRoaXMuaXNEZWJ1Z1Nob3dQb3NpdGlvbikge1xyXG5cdFx0XHRcdCQoXCIjbWFwXCIpLmFwcGVuZCgnPHAgaWQ9XCJkZWJ1Z1Nob3dQb3NpdGlvblwiPkVQU0c6Mzg1NyA8c3BhbiBpZD1cIm1vdXNlMzg1N1wiPjwvc3Bhbj4gJm5ic3A7IEVQU0c6NDMyNiA8c3BhbiBpZD1cIm1vdXNlNDMyNlwiPjwvc3Bhbj4nKTtcclxuXHRcdFx0XHR0aGlzLm1hcC5vbigncG9pbnRlcm1vdmUnLCBmdW5jdGlvbihldmVudCkge1xyXG5cdFx0XHRcdFx0dmFyIGNvb3JkMzg1NyA9IGV2ZW50LmNvb3JkaW5hdGU7XHJcblx0XHRcdFx0XHR2YXIgY29vcmQ0MzI2ID0gb2wucHJvai50cmFuc2Zvcm0oY29vcmQzODU3LCAnRVBTRzozODU3JywgJ0VQU0c6NDMyNicpO1xyXG5cdFx0XHRcdFx0JCgnI21vdXNlMzg1NycpLnRleHQob2wuY29vcmRpbmF0ZS50b1N0cmluZ1hZKGNvb3JkMzg1NywgMikpO1xyXG5cdFx0XHRcdFx0JCgnI21vdXNlNDMyNicpLnRleHQob2wuY29vcmRpbmF0ZS50b1N0cmluZ1hZKGNvb3JkNDMyNiwgMTUpKTtcclxuXHRcdFx0XHR9KTtcclxuXHRcdFx0fVxyXG5cclxuXHRcdFx0Ly8gcGFzcyB0aGUgaWQgb2YgdGhlIERPTSBlbGVtZW50XHJcblx0XHRcdHRoaXMubGl2ZVN0cmVhbSA9IG5ldyBMaXZlU3RyZWFtKHtpZCA6IFwibGl2ZVN0cmVhbVwifSk7XHJcbiAgICAgICAgfSxcclxuXHRcdFxyXG4gICAgICAgIFxyXG4gICAgICAgIGFkZFRyYWNrRmVhdHVyZSA6IGZ1bmN0aW9uKCkge1xyXG4gICAgICAgIFx0VFJBQ0suaW5pdCgpO1xyXG4gICAgICAgIFx0aWYgKFRSQUNLLmZlYXR1cmUpIHtcclxuICAgICAgICBcdFx0dmFyIGZ0ID0gdGhpcy50cmFja0xheWVyLmdldFNvdXJjZSgpLmdldEZlYXR1cmVzKCk7XHJcbiAgICAgICAgXHRcdHZhciBvaz1mYWxzZTtcclxuICAgICAgICBcdFx0Zm9yICh2YXIgaT0wO2k8ZnQubGVuZ3RoO2krKykgXHJcbiAgICAgICAgXHRcdHtcclxuICAgICAgICBcdFx0XHRpZiAoZnRbaV0gPT0gVFJBQ0suZmVhdHVyZSlcclxuICAgICAgICBcdFx0XHR7XHJcbiAgICAgICAgXHRcdFx0XHRvaz10cnVlO1xyXG4gICAgICAgIFx0XHRcdFx0YnJlYWs7XHJcbiAgICAgICAgXHRcdFx0fVxyXG4gICAgICAgIFx0XHR9XHJcbiAgICAgICAgXHRcdGlmICghb2spXHJcbiAgICAgICAgXHRcdFx0dGhpcy50cmFja0xheWVyLmdldFNvdXJjZSgpLmFkZEZlYXR1cmUoVFJBQ0suZmVhdHVyZSk7XHJcbiAgICAgICAgXHR9XHJcbiAgICAgICAgfSxcclxuICAgICAgICB6b29tVG9UcmFjayA6IGZ1bmN0aW9uKCkge1xyXG4gICAgICAgICAgICB2YXIgZXh0ZW50ID0gVFJBQ0suZ2V0Um91dGUoKSAmJiBUUkFDSy5nZXRSb3V0ZSgpLmxlbmd0aCA+IDEgPyBvbC5wcm9qLnRyYW5zZm9ybUV4dGVudCggKG5ldyBvbC5nZW9tLkxpbmVTdHJpbmcoVFJBQ0suZ2V0Um91dGUoKSkpLmdldEV4dGVudCgpICwgJ0VQU0c6NDMyNicsICdFUFNHOjM4NTcnKSA6IG51bGw7XHJcbiAgICAgICAgICAgIGlmIChleHRlbnQpXHJcbiAgICAgICAgICAgIFx0dGhpcy5tYXAuZ2V0VmlldygpLmZpdEV4dGVudChleHRlbnQsdGhpcy5tYXAuZ2V0U2l6ZSgpKTtcclxuICAgICAgICB9LFxyXG4gICAgICAgIFxyXG4gICAgICAgIGdldFNlbGVjdGVkUGFydGljaXBhbnRGcm9tQXJyYXlDeWNsaWMgOiBmdW5jdGlvbihmZWF0dXJlcykge1xyXG4gICAgXHRcdHZhciBhcnIgPSBbXTtcclxuICAgIFx0XHR2YXIgdG1hcCA9IHt9O1xyXG4gICAgXHRcdHZhciBjcnJQb3MgPSAwO1xyXG5cdFx0XHR2YXIgcG9zPW51bGw7XHJcbiAgICBcdFx0Zm9yICh2YXIgaT0wO2k8ZmVhdHVyZXMubGVuZ3RoO2krKykge1xyXG4gICAgXHRcdFx0dmFyIGZlYXR1cmUgPSBmZWF0dXJlc1tpXTtcclxuICAgIFx0XHRcdHZhciBpZCA9IGZlYXR1cmUucGFydGljaXBhbnQuY29kZTtcclxuICAgIFx0XHRcdGFyci5wdXNoKGlkKTtcclxuICAgIFx0XHRcdHRtYXBbaWRdPXRydWU7XHJcblx0XHRcdFx0aWYgKGlkID09IHRoaXMudnJfbGFzdHNlbGVjdGVkKSB7XHJcblx0XHRcdFx0XHRwb3M9aTtcclxuXHRcdFx0XHR9XHJcbiAgICBcdFx0fVxyXG4gICAgXHRcdHZhciBzYW1lID0gdGhpcy52cl9vbGRiZXN0YXJyICYmIHBvcyAhPSBudWxsOyBcclxuICAgIFx0XHRpZiAoc2FtZSkgXHJcbiAgICBcdFx0e1xyXG4gICAgXHRcdFx0Ly8gYWxsIGZyb20gdGhlIG9sZCBjb250YWluZWQgaW4gdGhlIG5ld1xyXG4gICAgXHRcdFx0Zm9yICh2YXIgaT0wO2k8dGhpcy52cl9vbGRiZXN0YXJyLmxlbmd0aDtpKyspIFxyXG4gICAgXHRcdFx0e1xyXG4gICAgXHRcdFx0XHRpZiAoIXRtYXBbdGhpcy52cl9vbGRiZXN0YXJyW2ldXSkge1xyXG4gICAgXHRcdFx0XHRcdHNhbWU9ZmFsc2U7XHJcbiAgICBcdFx0XHRcdFx0YnJlYWs7XHJcbiAgICBcdFx0XHRcdH1cclxuICAgIFx0XHRcdH1cclxuICAgIFx0XHR9XHJcbiAgICBcdFx0aWYgKCFzYW1lKSB7XHJcbiAgICBcdFx0XHR0aGlzLnZyX29sZGJlc3RhcnI9YXJyO1xyXG4gICAgXHRcdFx0dGhpcy52cl9sYXN0c2VsZWN0ZWQ9YXJyWzBdO1xyXG4gICAgXHRcdFx0cmV0dXJuIGZlYXR1cmVzWzBdO1xyXG4gICAgXHRcdH0gZWxzZSB7XHJcbiAgICBcdFx0XHR0aGlzLnZyX2xhc3RzZWxlY3RlZCA9IHBvcyA+IDAgPyBhcnJbcG9zLTFdIDogYXJyW2Fyci5sZW5ndGgtMV07ICAgIFx0XHRcdFxyXG4gICAgICAgIFx0XHR2YXIgcmVzdWx0RmVhdHVyZTtcclxuICAgIFx0XHRcdGZvciAodmFyIGk9MDtpPGZlYXR1cmVzLmxlbmd0aDtpKyspIFxyXG4gICAgICAgIFx0XHR7XHJcbiAgICAgICAgXHRcdFx0dmFyIGZlYXR1cmUgPSBmZWF0dXJlc1tpXTtcclxuICAgICAgICBcdFx0XHR2YXIgaWQgPSBmZWF0dXJlLnBhcnRpY2lwYW50LmNvZGU7XHJcbiAgICAgICAgXHRcdFx0aWYgKGlkID09IHRoaXMudnJfbGFzdHNlbGVjdGVkKSB7XHJcbiAgICAgICAgXHRcdFx0XHRyZXN1bHRGZWF0dXJlPWZlYXR1cmU7XHJcbiAgICAgICAgXHRcdFx0XHRicmVhaztcclxuICAgICAgICBcdFx0XHR9XHJcbiAgICAgICAgXHRcdH1cclxuICAgICAgICAgICAgICAgIHJldHVybiByZXN1bHRGZWF0dXJlO1xyXG4gICAgXHRcdH1cclxuICAgICAgICB9LFxyXG4gICAgICAgIFxyXG5cdFx0c2hvd0Vycm9yIDogZnVuY3Rpb24obXNnLG9uQ2xvc2VDYWxsYmFjaylcclxuXHRcdHtcclxuXHRcdFx0YWxlcnQoXCJFUlJPUiA6IFwiK21zZyk7XHJcblx0XHRcdGlmIChvbkNsb3NlQ2FsbGJhY2spIFxyXG5cdFx0XHRcdG9uQ2xvc2VDYWxsYmFjaygpO1xyXG5cdFx0fSxcclxuXHRcdFxyXG5cdFx0b25BbmltYXRpb24gOiBmdW5jdGlvbigpXHJcblx0XHR7XHJcblx0XHRcdHZhciBhcnI9W107XHJcblx0XHRcdGZvciAodmFyIGlwPTA7aXA8VFJBQ0sucGFydGljaXBhbnRzLmxlbmd0aDtpcCsrKVxyXG5cdFx0XHR7XHJcblx0XHRcdFx0dmFyIHAgPSBUUkFDSy5wYXJ0aWNpcGFudHNbaXBdO1xyXG5cdFx0XHRcdGlmIChwLmlzRmF2b3JpdGUpXHJcblx0XHRcdFx0e1xyXG5cdFx0XHRcdFx0cC5pbnRlcnBvbGF0ZSgpO1xyXG5cclxuXHRcdFx0XHRcdC8vIHRoaXMgd2lsbCBhZGQgaW4gdGhlIHJhbmtpbmcgcG9zaXRpbmcgb25seSB0aGUgcGFydGljaXBhbnRzIHRoZSBoYXMgdG8gYmUgdHJhY2tlZFxyXG5cdFx0XHRcdFx0Ly8gc28gbW92aW5nIGNhbXMgYXJlIHNraXBwZWRcclxuXHRcdFx0XHRcdGlmICghcC5fX3NraXBUcmFja2luZ1BvcylcclxuXHRcdFx0XHRcdFx0YXJyLnB1c2goaXApO1xyXG5cdFx0XHRcdH1cclxuXHRcdFx0fVxyXG5cdFx0XHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRcdFx0Ly8gd2UgaGF2ZSB0byBzb3J0IHRoZW0gb3RoZXJ3aXNlIHRoaXMgX19wb3MsIF9fcHJldiwgX19uZXh0IGFyZSBpcnJlbGV2YW50XHJcblx0XHRcdGFyci5zb3J0KGZ1bmN0aW9uKGlwMSwgaWQyKXtcclxuXHRcdFx0XHRyZXR1cm4gVFJBQ0sucGFydGljaXBhbnRzW2lkMl0uZ2V0RWxhcHNlZCgpIC0gVFJBQ0sucGFydGljaXBhbnRzW2lwMV0uZ2V0RWxhcHNlZCgpO1xyXG5cdFx0XHR9KTtcclxuXHRcdFx0Zm9yICh2YXIgaXA9MDtpcDxhcnIubGVuZ3RoO2lwKyspXHJcblx0XHRcdHtcclxuXHRcdFx0XHRUUkFDSy5wYXJ0aWNpcGFudHNbYXJyW2lwXV0uX19wb3M9aXA7XHJcblx0XHRcdFx0aWYgKGlwID09IDApXHJcblx0XHRcdFx0XHRkZWxldGUgVFJBQ0sucGFydGljaXBhbnRzW2FycltpcF1dLl9fcHJldjtcclxuXHRcdFx0XHRlbHNlXHJcblx0XHRcdFx0XHRUUkFDSy5wYXJ0aWNpcGFudHNbYXJyW2lwXV0uX19wcmV2PVRSQUNLLnBhcnRpY2lwYW50c1thcnJbaXAtMV1dO1xyXG5cdFx0XHRcdGlmIChpcCA9PSBUUkFDSy5wYXJ0aWNpcGFudHMubGVuZ3RoLTEpXHJcblx0XHRcdFx0XHRkZWxldGUgIFRSQUNLLnBhcnRpY2lwYW50c1thcnJbaXBdXS5fX25leHQ7XHJcblx0XHRcdFx0ZWxzZVxyXG5cdFx0XHRcdFx0VFJBQ0sucGFydGljaXBhbnRzW2FycltpcF1dLl9fbmV4dD1UUkFDSy5wYXJ0aWNpcGFudHNbYXJyW2lwKzFdXTtcclxuXHRcdFx0fVxyXG5cdFx0XHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRcdFx0aWYgKHRoaXMuc2VsZWN0ZWRQYXJ0aWNpcGFudDEpIFxyXG5cdFx0XHR7XHJcblx0XHRcdFx0dmFyIHNwb3MgPSB0aGlzLnNlbGVjdGVkUGFydGljaXBhbnQxLmdldEZlYXR1cmUoKS5nZXRHZW9tZXRyeSgpLmdldENvb3JkaW5hdGVzKCk7XHJcblx0XHRcdFx0aWYgKCF0aGlzLnBvcHVwMS5pc19zaG93bikge1xyXG5cdFx0XHRcdCAgICB0aGlzLnBvcHVwMS5zaG93KHNwb3MsIHRoaXMucG9wdXAxLmxhc3RIVE1MPXRoaXMuc2VsZWN0ZWRQYXJ0aWNpcGFudDEuZ2V0UG9wdXBIVE1MKCkpO1xyXG5cdFx0XHRcdCAgICB0aGlzLnBvcHVwMS5pc19zaG93bj0xO1xyXG5cdFx0XHRcdH0gZWxzZSB7XHJcblx0XHRcdFx0XHRpZiAoIXRoaXMucG9wdXAxLmdldFBvc2l0aW9uKCkgfHwgdGhpcy5wb3B1cDEuZ2V0UG9zaXRpb24oKVswXSAhPSBzcG9zWzBdIHx8IHRoaXMucG9wdXAxLmdldFBvc2l0aW9uKClbMV0gIT0gc3Bvc1sxXSlcclxuXHRcdFx0XHRcdCAgICB0aGlzLnBvcHVwMS5zZXRQb3NpdGlvbihzcG9zKTtcclxuXHRcdFx0XHRcdHZhciBjdGltZSA9IChuZXcgRGF0ZSgpKS5nZXRUaW1lKCk7XHRcdFx0IFxyXG5cdFx0XHRcdFx0aWYgKCF0aGlzLmxhc3RQb3B1cFJlZmVyZXNoMSB8fCBjdGltZSAtIHRoaXMubGFzdFBvcHVwUmVmZXJlc2gxID4gMjAwMCkgXHJcblx0XHRcdFx0XHR7XHJcblx0XHRcdFx0XHRcdHRoaXMubGFzdFBvcHVwUmVmZXJlc2gxPWN0aW1lO1xyXG5cdFx0XHRcdFx0ICAgIHZhciByciA9IHRoaXMuc2VsZWN0ZWRQYXJ0aWNpcGFudDEuZ2V0UG9wdXBIVE1MKCk7XHJcblx0XHRcdFx0XHQgICAgaWYgKHJyICE9IHRoaXMucG9wdXAxLmxhc3RIVE1MKSB7XHJcblx0XHRcdFx0XHQgICAgXHR0aGlzLnBvcHVwMS5sYXN0SFRNTD1ycjtcclxuXHRcdFx0XHRcdFx0ICAgIHRoaXMucG9wdXAxLmNvbnRlbnQuaW5uZXJIVE1MPXJyOyBcclxuXHRcdFx0XHRcdCAgICB9XHRcdFx0XHRcdFxyXG5cdFx0XHRcdFx0fVxyXG5cdFx0XHRcdCAgICB0aGlzLnBvcHVwMS5wYW5JbnRvVmlld18oc3Bvcyk7XHJcblx0XHRcdFx0fVxyXG5cdFx0XHR9XHJcblx0XHRcdGlmICh0aGlzLnNlbGVjdGVkUGFydGljaXBhbnQyKSBcclxuXHRcdFx0e1xyXG5cdFx0XHRcdHZhciBzcG9zID0gdGhpcy5zZWxlY3RlZFBhcnRpY2lwYW50Mi5nZXRGZWF0dXJlKCkuZ2V0R2VvbWV0cnkoKS5nZXRDb29yZGluYXRlcygpO1xyXG5cdFx0XHRcdGlmICghdGhpcy5wb3B1cDIuaXNfc2hvd24pIHtcclxuXHRcdFx0XHQgICAgdGhpcy5wb3B1cDIuc2hvdyhzcG9zLCB0aGlzLnBvcHVwMi5sYXN0SFRNTD10aGlzLnNlbGVjdGVkUGFydGljaXBhbnQyLmdldFBvcHVwSFRNTCgpKTtcclxuXHRcdFx0XHQgICAgdGhpcy5wb3B1cDIuaXNfc2hvd249MTtcclxuXHRcdFx0XHR9IGVsc2Uge1xyXG5cdFx0XHRcdFx0aWYgKCF0aGlzLnBvcHVwMi5nZXRQb3NpdGlvbigpIHx8IHRoaXMucG9wdXAyLmdldFBvc2l0aW9uKClbMF0gIT0gc3Bvc1swXSB8fCB0aGlzLnBvcHVwMi5nZXRQb3NpdGlvbigpWzFdICE9IHNwb3NbMV0pXHJcblx0XHRcdFx0XHQgICAgdGhpcy5wb3B1cDIuc2V0UG9zaXRpb24oc3Bvcyk7XHJcblx0XHRcdFx0XHR2YXIgY3RpbWUgPSAobmV3IERhdGUoKSkuZ2V0VGltZSgpO1x0XHRcdCBcclxuXHRcdFx0XHRcdGlmICghdGhpcy5sYXN0UG9wdXBSZWZlcmVzaDIgfHwgY3RpbWUgLSB0aGlzLmxhc3RQb3B1cFJlZmVyZXNoMiA+IDIwMDApIFxyXG5cdFx0XHRcdFx0e1xyXG5cdFx0XHRcdFx0XHR0aGlzLmxhc3RQb3B1cFJlZmVyZXNoMj1jdGltZTtcclxuXHRcdFx0XHRcdCAgICB2YXIgcnIgPSB0aGlzLnNlbGVjdGVkUGFydGljaXBhbnQyLmdldFBvcHVwSFRNTCgpO1xyXG5cdFx0XHRcdFx0ICAgIGlmIChyciAhPSB0aGlzLnBvcHVwMi5sYXN0SFRNTCkge1xyXG5cdFx0XHRcdFx0ICAgIFx0dGhpcy5wb3B1cDIubGFzdEhUTUw9cnI7XHJcblx0XHRcdFx0XHRcdCAgICB0aGlzLnBvcHVwMi5jb250ZW50LmlubmVySFRNTD1ycjsgXHJcblx0XHRcdFx0XHQgICAgfVx0XHRcdFx0XHRcclxuXHRcdFx0XHRcdH1cclxuXHRcdFx0XHQgICAgdGhpcy5wb3B1cDIucGFuSW50b1ZpZXdfKHNwb3MpO1xyXG5cdFx0XHRcdH1cclxuXHRcdFx0fVxyXG5cdFx0XHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tXHRcdFx0XHJcblx0XHRcdGlmICh0aGlzLmlzRGVidWcpICBcclxuXHRcdFx0XHR0aGlzLmRvRGVidWdBbmltYXRpb24oKTtcclxuXHRcdH0sXHJcblx0XHRcclxuXHRcdHNldFNlbGVjdGVkUGFydGljaXBhbnQxIDogZnVuY3Rpb24ocGFydCxjZW50ZXIpIHtcclxuXHRcdFx0Ly8gVE9ETyBSdW1lbiAtIG1lcmdlIHNldFNlbGVjdGVkUGFydGljaXBhbnQxIGFuZCBzZXRTZWxlY3RlZFBhcnRpY2lwYW50MiBpbiBvbmx5IG9uZSBtZXRob2RcclxuXHRcdFx0Ly8gVE9ETyBSdW1lbiAtIGFuZCB1c2Ugb25seSBpdCAtIHByb2JhYmx5IG1lcmdlIHRoZW0gdG9nZXRoZXIgYWxzbyB3aXRoIHNldFNlbGVjdGVkUGFydGljaXBhbnRcclxuXHRcdFx0dGhpcy5zZWxlY3RlZFBhcnRpY2lwYW50MT1wYXJ0O1xyXG5cdFx0XHRpZiAoIXBhcnQpIHtcclxuXHRcdFx0XHR0aGlzLnBvcHVwMS5oaWRlKCk7XHJcblx0XHRcdFx0ZGVsZXRlIHRoaXMucG9wdXAxLmlzX3Nob3duO1xyXG5cdFx0XHR9IGVsc2Uge1xyXG5cdFx0XHRcdHRoaXMubGFzdFBvcHVwUmVmZXJlc2gxPTA7XHJcblx0XHRcdFx0aWYgKGNlbnRlciAmJiBHVUkubWFwICYmIHBhcnQuZmVhdHVyZSkge1xyXG5cdFx0XHRcdFx0dmFyIHggPSAocGFydC5mZWF0dXJlLmdldEdlb21ldHJ5KCkuZ2V0RXh0ZW50KClbMF0rcGFydC5mZWF0dXJlLmdldEdlb21ldHJ5KCkuZ2V0RXh0ZW50KClbMl0pLzI7XHJcblx0XHRcdFx0XHR2YXIgeSA9IChwYXJ0LmZlYXR1cmUuZ2V0R2VvbWV0cnkoKS5nZXRFeHRlbnQoKVsxXStwYXJ0LmZlYXR1cmUuZ2V0R2VvbWV0cnkoKS5nZXRFeHRlbnQoKVszXSkvMjtcclxuXHRcdFx0XHRcdEdVSS5tYXAuZ2V0VmlldygpLnNldENlbnRlcihbeCx5XSk7XHJcblx0XHRcdFx0fVxyXG5cdFx0XHR9IFxyXG5cdFx0fSxcclxuXHJcblx0XHRzZXRTZWxlY3RlZFBhcnRpY2lwYW50MiA6IGZ1bmN0aW9uKHBhcnQsY2VudGVyKSB7XHJcblx0XHRcdHRoaXMuc2VsZWN0ZWRQYXJ0aWNpcGFudDI9cGFydDtcclxuXHRcdFx0aWYgKCFwYXJ0KSB7XHJcblx0XHRcdFx0dGhpcy5wb3B1cDIuaGlkZSgpO1xyXG5cdFx0XHRcdGRlbGV0ZSB0aGlzLnBvcHVwMi5pc19zaG93bjtcclxuXHRcdFx0fSBlbHNlIHtcclxuXHRcdFx0XHR0aGlzLmxhc3RQb3B1cFJlZmVyZXNoMj0wO1xyXG5cdFx0XHRcdGlmIChjZW50ZXIgJiYgR1VJLm1hcCAmJiBwYXJ0LmZlYXR1cmUpIHtcclxuXHRcdFx0XHRcdHZhciB4ID0gKHBhcnQuZmVhdHVyZS5nZXRHZW9tZXRyeSgpLmdldEV4dGVudCgpWzBdK3BhcnQuZmVhdHVyZS5nZXRHZW9tZXRyeSgpLmdldEV4dGVudCgpWzJdKS8yO1xyXG5cdFx0XHRcdFx0dmFyIHkgPSAocGFydC5mZWF0dXJlLmdldEdlb21ldHJ5KCkuZ2V0RXh0ZW50KClbMV0rcGFydC5mZWF0dXJlLmdldEdlb21ldHJ5KCkuZ2V0RXh0ZW50KClbM10pLzI7XHJcblx0XHRcdFx0XHRHVUkubWFwLmdldFZpZXcoKS5zZXRDZW50ZXIoW3gseV0pO1xyXG5cdFx0XHRcdH1cclxuXHRcdFx0fSBcclxuXHRcdH0sXHJcblxyXG5cdFx0c2V0U2VsZWN0ZWRQYXJ0aWNpcGFudCA6IGZ1bmN0aW9uKHBhcnQpIHtcclxuXHRcdFx0aWYgKCF0aGlzLnBvcHVwMS5pc19zaG93bikgIHtcclxuXHRcdFx0XHR0aGlzLnNldFNlbGVjdGVkUGFydGljaXBhbnQxKHBhcnQsIHRydWUpO1xyXG5cdFx0XHR9IGVsc2UgaWYgKCF0aGlzLnBvcHVwMi5pc19zaG93bikge1xyXG5cdFx0XHRcdHRoaXMuc2V0U2VsZWN0ZWRQYXJ0aWNpcGFudDIocGFydCwgdHJ1ZSk7XHJcblx0XHRcdH0gZWxzZSB7XHJcblx0XHRcdFx0dGhpcy5zZXRTZWxlY3RlZFBhcnRpY2lwYW50MShwYXJ0LCB0cnVlKTtcclxuXHRcdFx0fVxyXG5cdFx0fSxcclxuXHJcblx0XHRkb0RlYnVnQW5pbWF0aW9uIDogZnVuY3Rpb24oKSBcclxuXHRcdHtcclxuXHRcdFx0dmFyIGN0aW1lID0gKG5ldyBEYXRlKCkpLmdldFRpbWUoKTtcclxuXHRcdFx0dmFyIHRvZGVsPVtdO1xyXG5cdFx0XHR2YXIgcnIgPSB0aGlzLmRlYnVnTGF5ZXJHUFMuZ2V0U291cmNlKCkuZ2V0RmVhdHVyZXMoKTtcclxuXHRcdFx0Zm9yICh2YXIgaT0wO2k8cnIubGVuZ3RoO2krKylcclxuXHRcdFx0e1xyXG5cdFx0XHRcdHZhciBmID0gcnJbaV07XHJcblx0XHRcdFx0aWYgKGN0aW1lIC0gZi50aW1lQ3JlYXRlZCAtIENPTkZJRy5tYXRoLmRpc3BsYXlEZWxheSoxMDAwID4gQ09ORklHLnRpbWVvdXRzLmdwc0xvY2F0aW9uRGVidWdTaG93KjEwMDApXHJcblx0XHRcdFx0XHR0b2RlbC5wdXNoKGYpO1xyXG5cdFx0XHRcdGVsc2VcclxuXHRcdFx0XHRcdGYuY2hhbmdlZCgpO1xyXG5cdFx0XHR9XHJcblx0XHRcdGlmICh0b2RlbC5sZW5ndGgpIFxyXG5cdFx0XHR7XHJcblx0XHRcdFx0Zm9yICh2YXIgaT0wO2k8dG9kZWwubGVuZ3RoO2krKylcclxuXHRcdFx0XHRcdHRoaXMuZGVidWdMYXllckdQUy5nZXRTb3VyY2UoKS5yZW1vdmVGZWF0dXJlKHRvZGVsW2ldKTtcclxuXHRcdFx0fVxyXG5cdFx0XHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRcdH0sXHJcblx0XHRcclxuXHRcdHJlZHJhdyA6IGZ1bmN0aW9uKCkge1xyXG5cdFx0XHR0aGlzLmdldFRyYWNrKCkuZ2V0RmVhdHVyZSgpLmNoYW5nZWQoKTtcclxuXHRcdH0sXHJcblxyXG4gICAgICAgIC8qKlxyXG4gICAgICAgICAqIFNob3cgdGhlIGxpdmUtc3RyZWFtaW5nIGNvbnRhaW5lci4gSWYgdGhlIHBhc3NlZCAnc3RyZWFtSWQnIGlzIHZhbGlkIHRoZW4gaXQgb3BlbnMgaXRzIHN0cmVhbSBkaXJlY3RseS5cclxuICAgICAgICAgKiBAcGFyYW0ge1N0cmluZ30gW3N0cmVhbUlkXVxyXG4gICAgICAgICAqIEBwYXJhbSB7RnVuY3Rpb259IFtjb21wbGV0ZUNhbGxiYWNrXVxyXG4gICAgICAgICAqL1xyXG4gICAgICAgIHNob3dMaXZlU3RyZWFtIDogZnVuY3Rpb24oc3RyZWFtSWQsIGNvbXBsZXRlQ2FsbGJhY2spIHtcclxuICAgICAgICAgICAgdGhpcy5saXZlU3RyZWFtLnNob3coc3RyZWFtSWQsIGNvbXBsZXRlQ2FsbGJhY2spO1xyXG4gICAgICAgIH0sXHJcblxyXG4gICAgICAgIC8qKlxyXG4gICAgICAgICAqIFRvZ2dsZSB0aGUgbGl2ZS1zdHJlYW1pbmcgY29udGFpbmVyIGNvbnRhaW5lclxyXG5cdFx0ICogQHBhcmFtIHtGdW5jdGlvbn0gW2NvbXBsZXRlQ2FsbGJhY2tdXHJcbiAgICAgICAgICovXHJcbiAgICAgICAgdG9nZ2xlTGl2ZVN0cmVhbTogZnVuY3Rpb24oY29tcGxldGVDYWxsYmFjaykge1xyXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5saXZlU3RyZWFtLnRvZ2dsZShjb21wbGV0ZUNhbGxiYWNrKTtcclxuICAgICAgICB9XHJcblx0XHRcclxuICAgIH1cclxufSk7IiwicmVxdWlyZSgnam9vc2UnKTtcclxucmVxdWlyZSgnLi9VdGlscycpO1xyXG5cclxuQ2xhc3MoXCJMaXZlU3RyZWFtXCIsIHtcclxuICAgIGhhcyA6IHtcclxuICAgICAgICBfJGNvbXAgOiB7XHJcbiAgICAgICAgICAgIGluaXQ6IGZ1bmN0aW9uKGNvbmZpZykge1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuICQoJyMnICsgY29uZmlnLmlkKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0sXHJcblxyXG4gICAgICAgIF9pc1Nob3duIDoge1xyXG4gICAgICAgICAgIGluaXQgOiBmYWxzZVxyXG4gICAgICAgIH0sXHJcblxyXG4gICAgICAgIF9pc1ZhbGlkIDoge1xyXG4gICAgICAgICAgICBpbml0IDogZmFsc2VcclxuICAgICAgICB9XHJcbiAgICB9LFxyXG4gICAgbWV0aG9kczoge1xyXG4gICAgICAgIGluaXRpYWxpemU6IGZ1bmN0aW9uKCkge1xyXG4gICAgICAgICAgICB2YXIgbGl2ZVN0cmVhbXMgPSB3aW5kb3cuTElWRV9TVFJFQU1TO1xyXG4gICAgICAgICAgICBpZiAoIWxpdmVTdHJlYW1zIHx8IGxpdmVTdHJlYW1zLmxlbmd0aCA8PSAwKSB7XHJcbiAgICAgICAgICAgICAgICBjb25zb2xlLndhcm4oXCJObyBsaXZlIHN0cmVhbXMgc2V0XCIpO1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICAvLyBpbml0aWFsaXplIHRoZSBzdHJlYW1zXHJcbiAgICAgICAgICAgIHZhciBzZWxmID0gdGhpcztcclxuICAgICAgICAgICAgdmFyIGkgPSAwO1xyXG4gICAgICAgICAgICB0aGlzLl8kY29tcC5maW5kKFwiLmxpdmVTdHJlYW1UaHVtYlwiKS5hZGRDbGFzcyhcImluYWN0aXZlXCIpLmVhY2goZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgICAgICAgICB2YXIgc3RyZWFtID0gbGl2ZVN0cmVhbXNbaV07XHJcbiAgICAgICAgICAgICAgICBpKys7XHJcbiAgICAgICAgICAgICAgICBpZiAoIXN0cmVhbSkge1xyXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBmYWxzZTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICQodGhpcykuYWRkQ2xhc3MoXCJ2YWxpZFwiKS5kYXRhKFwiaWRcIiwgc3RyZWFtLmlkKS5kYXRhKFwidXJsXCIsIHN0cmVhbS51cmwpO1xyXG5cclxuICAgICAgICAgICAgICAgIC8vIGF0IGxlYXN0IG9uZSB2YWxpZCB0aHVtYiAtIHNvIHRoZSB3aG9sZSBMaXZlU3RyZWFtIGlzIHZhbGlkXHJcbiAgICAgICAgICAgICAgICBzZWxmLl9pc1ZhbGlkID0gdHJ1ZTtcclxuICAgICAgICAgICAgfSkuZmlsdGVyKFwiLnZhbGlkXCIpLmNsaWNrKGZ1bmN0aW9uKCkge1xyXG4gICAgICAgICAgICAgICAgdmFyICR0aGlzID0gJCh0aGlzKTtcclxuXHJcbiAgICAgICAgICAgICAgICAvLyBpZiBjbGlja2VkIG9uIHRoZSBzYW1lIGFjdGl2ZSB0aHVtYiB0aGVuIHNraXAgaXRcclxuICAgICAgICAgICAgICAgIGlmICghJHRoaXMuaGFzQ2xhc3MoXCJpbmFjdGl2ZVwiKSkge1xyXG4gICAgICAgICAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgICAgIHNlbGYuX3Nob3dTdHJlYW0oJHRoaXMpO1xyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICB9LFxyXG5cclxuICAgICAgICBzaG93OiBmdW5jdGlvbihzdHJlYW1JZCwgY29tcGxldGVDYWxsYmFjaykge1xyXG4gICAgICAgICAgICBpZiAoIXRoaXMuX2lzVmFsaWQpXHJcbiAgICAgICAgICAgICAgIHJldHVybjtcclxuXHJcbiAgICAgICAgICAgIHZhciAkdGh1bWIgPSBudWxsO1xyXG4gICAgICAgICAgICB2YXIgJHRodW1icyA9IHRoaXMuXyRjb21wLmZpbmQoXCIubGl2ZVN0cmVhbVRodW1iLnZhbGlkXCIpO1xyXG4gICAgICAgICAgICBpZiAoIWlzRGVmaW5lZChzdHJlYW1JZCkpIHtcclxuICAgICAgICAgICAgICAgICR0aHVtYiA9ICR0aHVtYnMuZXEoMCk7XHJcbiAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAkdGh1bWJzLmVhY2goZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKHN0cmVhbUlkID09PSAkKHRoaXMpLmRhdGEoXCJpZFwiKSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAkdGh1bWIgPSAkKHRoaXMpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gZmFsc2U7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIGlmICghJHRodW1iKSB7XHJcbiAgICAgICAgICAgICAgICBjb25zb2xlLndhcm4oXCJObyBzdHJlYW0gZm9yIGlkIDogXCIgKyBzdHJlYW1JZCk7XHJcbiAgICAgICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIHRoaXMuX3Nob3dTdHJlYW0oJHRodW1iLCBjb21wbGV0ZUNhbGxiYWNrKTtcclxuICAgICAgICB9LFxyXG5cclxuICAgICAgICAvKipcclxuICAgICAgICAgKlxyXG4gICAgICAgICAqIEByZXR1cm4ge2Jvb2xlYW59XHJcbiAgICAgICAgICovXHJcbiAgICAgICAgdG9nZ2xlIDogZnVuY3Rpb24oY29tcGxldGVDYWxsYmFjaykge1xyXG4gICAgICAgICAgICBpZiAoIXRoaXMuX2lzVmFsaWQpXHJcbiAgICAgICAgICAgICAgICByZXR1cm47XHJcblxyXG4gICAgICAgICAgICAvLyBpZiBzaG93biBoaWRlIG90aGVyd2lzZSBzaG93XHJcbiAgICAgICAgICAgIGlmICh0aGlzLl9pc1Nob3duKVxyXG4gICAgICAgICAgICAgICAgdGhpcy5faGlkZShjb21wbGV0ZUNhbGxiYWNrKTtcclxuICAgICAgICAgICAgZWxzZVxyXG4gICAgICAgICAgICAgICAgdGhpcy5zaG93KGNvbXBsZXRlQ2FsbGJhY2spO1xyXG5cclxuICAgICAgICAgICAgcmV0dXJuIHRoaXMuX2lzU2hvd247XHJcbiAgICAgICAgfSxcclxuXHJcbiAgICAgICAgLyogUHJpdmF0ZSBNZXRob2RzICovXHJcblxyXG4gICAgICAgIF9oaWRlIDogZnVuY3Rpb24oY29tcGxldGVDYWxsYmFjaykge1xyXG4gICAgICAgICAgICB2YXIgc2VsZiA9IHRoaXM7XHJcbiAgICAgICAgICAgIHRoaXMuXyRjb21wLnNsaWRlVXAoNDAwLCBmdW5jdGlvbigpIHtcclxuICAgICAgICAgICAgICAgIC8vIHN0b3AgdGhlIHN0cmVhbSB3aGVuIHdob2xlIHBhbmVsIGhhcyBjb21wbGV0ZWQgYW5pbWF0aW9uXHJcbiAgICAgICAgICAgICAgICBzZWxmLl8kY29tcC5maW5kKFwiLmxpdmVTdHJlYW1QbGF5ZXJcIikuZW1wdHkoKTtcclxuICAgICAgICAgICAgICAgIGNvbXBsZXRlQ2FsbGJhY2soKTtcclxuICAgICAgICAgICAgfSk7XHJcblxyXG4gICAgICAgICAgICB0aGlzLl9pc1Nob3duID0gZmFsc2U7XHJcbiAgICAgICAgfSxcclxuXHJcbiAgICAgICAgX3Nob3dTdHJlYW0gOiBmdW5jdGlvbigkdGh1bWIsIGNvbXBsZXRlQ2FsbGJhY2spIHtcclxuICAgICAgICAgICAgLy8gdG9nZ2xlIHRoZSBcImluYWN0aXZlXCIgY2xhc3NcclxuICAgICAgICAgICAgdGhpcy5fJGNvbXAuZmluZChcIi5saXZlU3RyZWFtVGh1bWJcIikuYWRkQ2xhc3MoXCJpbmFjdGl2ZVwiKTtcclxuICAgICAgICAgICAgJHRodW1iLnJlbW92ZUNsYXNzKFwiaW5hY3RpdmVcIik7XHJcblxyXG4gICAgICAgICAgICAvLyBzaG93IHRoZSBuZXcgc3RyZWFtXHJcbiAgICAgICAgICAgIHZhciB1cmwgPSAkdGh1bWIuZGF0YShcInVybFwiKTtcclxuICAgICAgICAgICAgdmFyICRwbGF5ZXIgPSB0aGlzLl8kY29tcC5maW5kKFwiLmxpdmVTdHJlYW1QbGF5ZXJcIik7XHJcblxyXG4gICAgICAgICAgICAvLyB3aWR0aD00OTAmaGVpZ2h0PTI3NSZcclxuICAgICAgICAgICAgLy8gd2lkdGg9XCI0OTBcIiBoZWlnaHQ9XCIyNzVcIlxyXG4gICAgICAgICAgICAkcGxheWVyLmh0bWwoJzxpZnJhbWUgc3JjPScgKyB1cmwgKyAnP2F1dG9QbGF5PXRydWUmbXV0ZT1mYWxzZVwiIGZyYW1lYm9yZGVyPVwiMFwiIHNjcm9sbGluZz1cIm5vXCIgJytcclxuICAgICAgICAgICAgJ2FsbG93ZnVsbHNjcmVlbiB3ZWJraXRhbGxvd2Z1bGxzY3JlZW4gbW96YWxsb3dmdWxsc2NyZWVuIG9hbGxvd2Z1bGxzY3JlZW4gbXNhbGxvd2Z1bGxzY3JlZW4+PC9pZnJhbWU+Jyk7XHJcblxyXG4gICAgICAgICAgICAvLyBzaG93IGlmIG5vdCBhbHJlYWR5IHNob3duXHJcbiAgICAgICAgICAgIGlmICghdGhpcy5faXNTaG93bilcclxuICAgICAgICAgICAgICAgIHRoaXMuXyRjb21wLnNsaWRlRG93big0MDAsIGNvbXBsZXRlQ2FsbGJhY2spO1xyXG4gICAgICAgICAgICB0aGlzLl9pc1Nob3duID0gdHJ1ZTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbn0pOyIsInJlcXVpcmUoJ2pvb3NlJyk7XHJcbnJlcXVpcmUoJy4vUG9pbnQnKTtcclxuXHJcbnZhciBDT05GSUcgPSByZXF1aXJlKCcuL0NvbmZpZycpO1xyXG52YXIgVXRpbHMgPSByZXF1aXJlKCcuL1V0aWxzJyk7XHJcbnZhciBJbnRlcnNlY3Rpb24gPSByZXF1aXJlKFwia2xkLWludGVyc2VjdGlvbnNcIikuSW50ZXJzZWN0aW9uO1xyXG52YXIgUG9pbnQyRCA9IHJlcXVpcmUoXCJrbGQtaW50ZXJzZWN0aW9uc1wiKS5Qb2ludDJEO1xyXG5cclxudmFyIGNvZWZ5ID0gQ09ORklHLm1hdGgucHJvamVjdGlvblNjYWxlWTtcclxuQ2xhc3MoXCJQYXJ0aWNpcGFudFN0YXRlXCIsXHJcbntcclxuXHRoYXMgOiB7XHRcdFxyXG4gICAgXHRkZWJ1Z0luZm8gOiB7XHJcbiAgICBcdFx0aXMgOiBcInJ3XCIsXHJcbiAgICBcdFx0aW5pdCA6IG51bGxcclxuICAgIFx0fSxcclxuXHRcdHNwZWVkIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IDBcclxuXHRcdH0sXHJcblx0XHRlbGFwc2VkIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IDBcclxuXHRcdH0sXHJcblx0ICAgIHRpbWVzdGFtcCA6IFxyXG5cdFx0e1xyXG5cdCAgICAgICAgaXM6ICAgXCJyd1wiLFxyXG5cdCAgICAgICAgaW5pdDogMFx0Ly9sb24gbGF0IHdvcmxkIG1lcmNhdG9yXHJcblx0ICAgIH0sXHJcblx0ICAgIGdwcyA6IHtcclxuXHQgICAgXHRpczogICBcInJ3XCIsXHJcblx0ICAgICAgICBpbml0OiBbMCwwXVx0Ly9sb24gbGF0IHdvcmxkIG1lcmNhdG9yXHJcblx0ICAgIH0sXHJcblx0XHRmcmVxIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IDBcclxuXHRcdH0sXHJcblx0XHRpc1NPUyA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiBmYWxzZVxyXG5cdFx0fSxcclxuXHRcdGFjY2VsZXJhdGlvbiA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiAwXHJcblx0XHR9LFxyXG5cdFx0YWx0IDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IDBcclxuXHRcdH0sXHJcblx0XHRvdmVyYWxsUmFuayA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiAwXHJcblx0XHR9LFxyXG5cdFx0Z2VuZGVyUmFuayA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiAwXHJcblx0XHR9LFxyXG5cdFx0Z3JvdXBSYW5rIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IDBcclxuXHRcdH1cclxuXHR9XHJcbn0pO1x0XHRcclxuLy8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcbkNsYXNzKFwiTW92aW5nUG9pbnRcIiwge1xyXG5cdGlzYSA6IFBvaW50LFxyXG5cclxuXHRoYXMgOiB7XHJcblx0XHRkZXZpY2VJZCA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiBcIkRFVklDRV9JRF9OT1RfU0VUXCJcclxuXHRcdH1cclxuXHR9XHJcbn0pO1xyXG4vLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuQ2xhc3MoXCJQYXJ0aWNpcGFudFwiLFxyXG57XHJcblx0aXNhIDogTW92aW5nUG9pbnQsXHJcblxyXG4gICAgaGFzOiBcclxuXHR7XHRcclxuICAgIFx0bGFzdFBpbmdUaW1lc3RhbXAgOiB7XHJcbiAgICBcdFx0aXMgOiBcInJ3XCIsXHJcbiAgICBcdFx0aW5pdCA6IG51bGxcclxuICAgIFx0fSxcclxuICAgIFx0c2lnbmFsTG9zdERlbGF5IDoge1xyXG4gICAgXHRcdGlzIDogXCJyd1wiLFxyXG4gICAgXHRcdGluaXQgOiBudWxsXHJcbiAgICBcdH0sXHJcbiAgICBcdGxhc3RSZWFsRGVsYXkgOiB7XHJcbiAgICBcdFx0aXMgOiBcInJ3XCIsXHJcbiAgICBcdFx0aW5pdCA6IDBcclxuICAgIFx0fSxcclxuICAgIFx0dHJhY2sgOiB7XHJcbiAgICBcdFx0aXMgOiBcInJ3XCJcclxuICAgIFx0fSxcclxuICAgIFx0c3RhdGVzIDoge1xyXG4gICAgXHRcdGlzIDogXCJyd1wiLFxyXG4gICAgXHRcdGluaXQgOiBudWxsIC8vW11cclxuICAgIFx0XHRcclxuICAgIFx0fSxcclxuXHRcdGlzVGltZWRPdXQgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogZmFsc2VcclxuXHRcdH0sXHJcblx0XHRpc0Rpc2NhcmRlZCA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiBmYWxzZVxyXG5cdFx0fSxcclxuXHRcdGlzU09TIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IGZhbHNlXHJcblx0XHR9LFxyXG5cdFx0aWNvbjoge1xyXG5cdFx0XHRpczogXCJyd1wiLFxyXG5cdCAgICAgICAgaW5pdDogXCJpbWcvcGxheWVyMS5wbmdcIlxyXG5cdCAgICB9LFxyXG5cdCAgICBpbWFnZSA6XHR7XHJcblx0ICAgICAgICBpczogICBcInJ3XCIsXHJcblx0ICAgICAgICBpbml0OiBcImltZy9wcm9maWxlMS5wbmdcIiAgLy8xMDB4MTAwXHJcblx0ICAgIH0sXHJcblx0ICAgIGNvbG9yIDoge1xyXG5cdCAgICAgICAgaXM6ICAgXCJyd1wiLFxyXG5cdCAgICAgICAgaW5pdDogXCIjZmZmXCJcclxuXHQgICAgfSxcclxuXHQgICAgbGFzdEludGVycG9sYXRlVGltZXN0YW1wIDoge1xyXG5cdCAgICBcdGlzIDogXCJyd1wiLFxyXG5cdCAgICBcdGluaXQgOiBudWxsXHJcblx0ICAgIH0sXHJcblx0ICAgIGFnZUdyb3VwIDoge1xyXG5cdCAgICBcdGlzIDogXCJyd1wiLFxyXG5cdCAgICBcdGluaXQgOiBcIi1cIlxyXG5cdCAgICB9LFxyXG5cdCAgICBhZ2UgOiB7XHJcblx0ICAgIFx0aXMgOiBcInJ3XCIsXHJcblx0ICAgIFx0aW5pdCA6IFwiLVwiXHJcblx0ICAgIH0sXHJcblx0ICAgIHJvdGF0aW9uIDoge1xyXG5cdCAgICBcdGlzIDogXCJyd1wiLFxyXG5cdCAgICBcdGluaXQgOiBudWxsIFxyXG5cdCAgICB9LCBcclxuXHQgICAgZWxhcHNlZCA6IHtcclxuXHQgICAgXHRpcyA6IFwicndcIixcclxuXHQgICAgXHRpbml0IDogMFxyXG5cdCAgICB9LFxyXG5cdFx0c2VxSWQgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogMFxyXG5cdFx0fSxcclxuXHRcdGNvdW50cnkgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogXCJHZXJtYW55XCJcclxuXHRcdH0sXHJcblx0XHRzdGFydFBvcyA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiAwXHJcblx0XHR9LFxyXG5cdFx0c3RhcnRUaW1lIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IDBcclxuXHRcdH0sXHJcblx0XHRnZW5kZXIgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogXCJNXCJcclxuXHRcdH0sXHJcblx0XHRpc0Zhdm9yaXRlIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IGZhbHNlXHJcblx0XHR9XHJcbiAgICB9LFxyXG5cdGFmdGVyIDoge1xyXG5cdFx0aW5pdCA6IGZ1bmN0aW9uKHBvcywgdHJhY2spIHtcclxuXHRcdFx0dGhpcy5zZXRUcmFjayh0cmFjayk7XHJcblx0XHRcdHZhciBjdGltZSA9IChuZXcgRGF0ZSgpKS5nZXRUaW1lKCk7XHJcblx0XHRcdHZhciBzdGF0ZSA9IG5ldyBQYXJ0aWNpcGFudFN0YXRlKHt0aW1lc3RhbXA6MS8qIHBsYWNlaG9sZGVyIGN0aW1lIG5vdCAwICovLGdwczpwb3MsaXNTT1M6ZmFsc2UsZnJlcTowLHNwZWVkOjAsZWxhcHNlZDowfSk7XHJcblx0XHRcdHRoaXMuc2V0RWxhcHNlZChzdGF0ZS5lbGFwc2VkKTtcclxuXHRcdFx0dGhpcy5zZXRTdGF0ZXMoW3N0YXRlXSk7XHJcblx0XHRcdHRoaXMuc2V0SXNTT1MoZmFsc2UpO1xyXG5cdFx0XHR0aGlzLnNldElzRGlzY2FyZGVkKGZhbHNlKTtcclxuXHJcblx0XHRcdGlmICh0aGlzLmZlYXR1cmUpIHtcclxuXHRcdFx0XHR0aGlzLmluaXRGZWF0dXJlKCk7XHJcblx0XHRcdH1cclxuXHRcdFx0dGhpcy5waW5nQ2FsY3VsYXRlZChzdGF0ZSk7XHJcblx0XHR9XHJcblx0fSxcclxuICAgIC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRtZXRob2RzOiBcclxuXHR7XHJcblx0XHRpbml0RmVhdHVyZSA6IGZ1bmN0aW9uKCkge1xyXG5cdFx0XHR0aGlzLmZlYXR1cmUucGFydGljaXBhbnQ9dGhpcztcclxuXHRcdFx0R1VJLnBhcnRpY2lwYW50c0xheWVyLmdldFNvdXJjZSgpLmFkZEZlYXR1cmUodGhpcy5mZWF0dXJlKTtcclxuXHRcdH0sXHJcblxyXG5cdFx0Z2V0SW5pdGlhbHMgOiBmdW5jdGlvbigpIHtcclxuXHRcdFx0dmFyIHR0ID0gdGhpcy5nZXRDb2RlKCkuc3BsaXQoXCIgXCIpO1xyXG5cdFx0XHRpZiAodHQubGVuZ3RoID49IDIpIHtcclxuXHRcdFx0XHRyZXR1cm4gdHRbMF1bMF0rdHRbMV1bMF07XHJcblx0XHRcdH1cclxuXHRcdFx0aWYgKHR0Lmxlbmd0aCA9PSAxKVxyXG5cdFx0XHRcdHJldHVybiB0dFswXVswXTtcclxuXHRcdFx0cmV0dXJuIFwiP1wiO1xyXG5cdFx0fSxcclxuXHRcdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdFx0Ly8gbWFpbiBmdW5jdGlvbiBjYWxsID4gXHJcblx0XHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRcdHVwZGF0ZUZlYXR1cmUgOiBmdW5jdGlvbigpIHtcclxuXHRcdFx0dmFyIG1wb3MgPSBvbC5wcm9qLnRyYW5zZm9ybSh0aGlzLmdldFBvc2l0aW9uKCksICdFUFNHOjQzMjYnLCAnRVBTRzozODU3Jyk7XHJcblx0XHRcdGlmICh0aGlzLmZlYXR1cmUpIFxyXG5cdFx0XHRcdHRoaXMuZmVhdHVyZS5zZXRHZW9tZXRyeShuZXcgb2wuZ2VvbS5Qb2ludChtcG9zKSk7XHJcblx0XHR9LFxyXG5cdFx0aW50ZXJwb2xhdGUgOiBmdW5jdGlvbigpIFxyXG5cdFx0e1xyXG5cdFx0XHRcclxuXHRcdFx0aWYgKCF0aGlzLnN0YXRlcy5sZW5ndGgpXHJcblx0XHRcdFx0cmV0dXJuO1xyXG5cdFx0XHR2YXIgY3RpbWU9KG5ldyBEYXRlKCkpLmdldFRpbWUoKTtcclxuXHRcdFx0dmFyIGlzVGltZSA9IChjdGltZSA+PSBDT05GSUcudGltZXMuYmVnaW4gJiYgY3RpbWUgPD0gQ09ORklHLnRpbWVzLmVuZCk7XHJcblx0XHRcdGlmICh0aGlzLmlzRGlzY2FyZGVkIHx8IHRoaXMuaXNTT1MvKiB8fCAhdGhpcy5pc09uUm9hZCovIHx8ICFpc1RpbWUgfHwgQ09ORklHLnNldHRpbmdzLm5vSW50ZXJwb2xhdGlvbikgXHJcblx0XHRcdHtcclxuXHRcdFx0XHR2YXIgbHN0YXRlPXRoaXMuc3RhdGVzW3RoaXMuc3RhdGVzLmxlbmd0aC0xXTtcclxuXHRcdFx0XHR2YXIgcG9zID0gbHN0YXRlLmdwcztcclxuXHRcdFx0XHRpZiAocG9zWzBdICE9IHRoaXMuZ2V0UG9zaXRpb24oKVswXSB8fCBwb3NbMV0gIT0gdGhpcy5nZXRQb3NpdGlvbigpWzFdKSBcclxuXHRcdFx0XHR7XHJcblx0XHRcdFx0ICAgIHRoaXMuc2V0UG9zaXRpb24ocG9zKTtcclxuXHRcdFx0XHQgICAgdGhpcy5zZXRSb3RhdGlvbihudWxsKTtcclxuXHRcdFx0XHRcdHRoaXMudXBkYXRlRmVhdHVyZSgpO1xyXG5cdFx0XHRcdH0gZWxzZSB7XHJcblx0XHRcdFx0XHRpZiAodGhpcy5pc0Rpc2NhcmRlZCkge1xyXG5cdFx0XHRcdFx0XHR0aGlzLnVwZGF0ZUZlYXR1cmUoKTtcclxuXHRcdFx0XHRcdH1cclxuXHRcdFx0XHR9XHJcblx0XHRcdFx0cmV0dXJuO1xyXG5cdFx0XHR9XHJcblx0XHRcdHRoaXMuc2V0TGFzdEludGVycG9sYXRlVGltZXN0YW1wKGN0aW1lKTtcclxuXHRcdFx0Ly8gTm8gZW5vdWdoIGRhdGE/XHJcblx0XHRcdGlmICh0aGlzLnN0YXRlcy5sZW5ndGggPCAyKVxyXG5cdFx0XHRcdHJldHVybjtcclxuXHRcdFx0dmFyIHJlcyA9IHRoaXMuY2FsY3VsYXRlRWxhcHNlZEF2ZXJhZ2UoY3RpbWUpO1xyXG5cdFx0XHRpZiAocmVzKSBcclxuXHRcdFx0e1xyXG5cdFx0XHRcdHZhciB0cmVzPXJlcztcclxuXHRcdFx0XHRpZiAodHJlcyA9PSB0aGlzLnRyYWNrLmxhcHMpXHJcblx0XHRcdFx0XHR0cmVzPTEuMDtcclxuXHRcdFx0XHRlbHNlXHJcblx0XHRcdFx0XHR0cmVzPXRyZXMlMTtcclxuXHRcdFx0XHR2YXIgdGthID0gdGhpcy50cmFjay5nZXRQb3NpdGlvbkFuZFJvdGF0aW9uRnJvbUVsYXBzZWQodHJlcyk7XHJcblx0XHRcdFx0dGhpcy5zZXRQb3NpdGlvbihbdGthWzBdLHRrYVsxXV0pO1xyXG5cdFx0XHRcdHRoaXMuc2V0Um90YXRpb24odGthWzJdKTtcclxuXHRcdFx0XHR0aGlzLnVwZGF0ZUZlYXR1cmUoKTtcclxuXHRcdFx0XHR0aGlzLnNldEVsYXBzZWQocmVzKTtcclxuXHRcdFx0fSBcclxuXHRcdH0sXHJcblxyXG5cdFx0bWluIDogZnVuY3Rpb24oY3RpbWUscHJvTmFtZSkgXHJcblx0XHR7XHJcblx0XHRcdHZhciByZXM9bnVsbDtcclxuXHRcdFx0Zm9yICh2YXIgaT10aGlzLnN0YXRlcy5sZW5ndGgtMjtpPj0wO2ktLSkgXHJcblx0XHRcdHtcclxuXHRcdFx0XHR2YXIgaiA9IGkrMTtcclxuXHRcdFx0XHR2YXIgc2EgPSB0aGlzLnN0YXRlc1tpXTtcclxuXHRcdFx0XHR2YXIgc2IgPSB0aGlzLnN0YXRlc1tqXTtcclxuXHRcdFx0XHRpZiAoY3RpbWUgPj0gc2EudGltZXN0YW1wICYmIGN0aW1lIDw9IHNiLnRpbWVzdGFtcCkgXHJcblx0XHRcdFx0eyBcclxuXHRcdFx0XHRcdHJlcyA9IHNhW3Byb05hbWVdO1xyXG5cdFx0XHRcdFx0Ly9jb25zb2xlLmxvZyhcIk1JTiBGT1IgXCIrcHJvTmFtZStcIiB8IFwiK3JlcytcIiB8IFwiK0pTT04uc3RyaW5naWZ5KHRoaXMuc3RhdGVzW2ldKSk7XHJcblx0XHRcdFx0XHRicmVhaztcclxuXHRcdFx0XHR9XHJcblx0XHRcdFx0aWYgKHNiLnRpbWVzdGFtcCA8IGN0aW1lKVxyXG5cdFx0XHRcdFx0YnJlYWs7XHJcblx0XHRcdH1cclxuXHRcdFx0cmV0dXJuIHJlcztcclxuXHRcdH0sXHJcblxyXG5cdFx0YXZnMiA6IGZ1bmN0aW9uKGN0aW1lLHByb05hbWUpIFxyXG5cdFx0e1xyXG5cdFx0XHR2YXIgcmVzPW51bGw7XHJcblx0XHRcdGZvciAodmFyIGk9dGhpcy5zdGF0ZXMubGVuZ3RoLTI7aT49MDtpLS0pIFxyXG5cdFx0XHR7XHJcblx0XHRcdFx0dmFyIGogPSBpKzE7XHJcblx0XHRcdFx0dmFyIHNhID0gdGhpcy5zdGF0ZXNbaV07XHJcblx0XHRcdFx0dmFyIHNiID0gdGhpcy5zdGF0ZXNbal07XHJcblx0XHRcdFx0aWYgKGN0aW1lID49IHNhLnRpbWVzdGFtcCAmJiBjdGltZSA8PSBzYi50aW1lc3RhbXApIFxyXG5cdFx0XHRcdHsgXHJcblx0XHRcdFx0XHRyZXMgPSBbXHJcblx0XHRcdFx0XHQgICAgICAgXHRzYVtwcm9OYW1lXVswXSsoY3RpbWUtc2EudGltZXN0YW1wKSAqIChzYltwcm9OYW1lXVswXS1zYVtwcm9OYW1lXVswXSkgLyAoc2IudGltZXN0YW1wLXNhLnRpbWVzdGFtcCksXHJcblx0XHRcdFx0XHQgICAgICAgXHRzYVtwcm9OYW1lXVsxXSsoY3RpbWUtc2EudGltZXN0YW1wKSAqIChzYltwcm9OYW1lXVsxXS1zYVtwcm9OYW1lXVsxXSkgLyAoc2IudGltZXN0YW1wLXNhLnRpbWVzdGFtcClcclxuXHRcdFx0XHQgICAgICAgICAgXTsgXHJcblx0XHRcdFx0XHRicmVhaztcclxuXHRcdFx0XHR9XHJcblx0XHRcdFx0aWYgKHNiLnRpbWVzdGFtcCA8IGN0aW1lKVxyXG5cdFx0XHRcdFx0YnJlYWs7XHJcblx0XHRcdH1cclxuXHRcdFx0cmV0dXJuIHJlcztcclxuXHRcdH0sXHJcblxyXG5cdFx0YXZnIDogZnVuY3Rpb24oY3RpbWUscHJvTmFtZSkgXHJcblx0XHR7XHJcblx0XHRcdHZhciByZXM9bnVsbDtcclxuXHRcdFx0Ly9jb25zb2xlLmxvZyh0aGlzLnN0YXRlcyk7XHJcblx0XHRcdGZvciAodmFyIGk9dGhpcy5zdGF0ZXMubGVuZ3RoLTI7aT49MDtpLS0pIFxyXG5cdFx0XHR7XHJcblx0XHRcdFx0dmFyIGogPSBpKzE7XHJcblx0XHRcdFx0dmFyIHNhID0gdGhpcy5zdGF0ZXNbaV07XHJcblx0XHRcdFx0dmFyIHNiID0gdGhpcy5zdGF0ZXNbal07XHJcblx0XHRcdFx0aWYgKGN0aW1lID49IHNhLnRpbWVzdGFtcCAmJiBjdGltZSA8PSBzYi50aW1lc3RhbXApIFxyXG5cdFx0XHRcdHsgXHJcblx0XHRcdFx0XHRyZXMgPSBzYVtwcm9OYW1lXSsoY3RpbWUtc2EudGltZXN0YW1wKSAqIChzYltwcm9OYW1lXS1zYVtwcm9OYW1lXSkgLyAoc2IudGltZXN0YW1wLXNhLnRpbWVzdGFtcCk7XHJcblx0XHRcdFx0XHRicmVhaztcclxuXHRcdFx0XHR9XHJcblx0XHRcdFx0aWYgKHNiLnRpbWVzdGFtcCA8IGN0aW1lKVxyXG5cdFx0XHRcdFx0YnJlYWs7XHJcblx0XHRcdH1cclxuXHRcdFx0LyppZiAocmVzID09IG51bGwpIHtcclxuXHRcdFx0XHR2YXIgYXJyPVtdO1xyXG5cdFx0XHRcdGZvciAodmFyIGk9dGhpcy5zdGF0ZXMubGVuZ3RoLTE7aT49MDtpLS0pIGlmIChpID09IDAgfHwgaSA9PSB0aGlzLnN0YXRlcy5sZW5ndGgtMSkge1xyXG5cdFx0XHRcdFx0YXJyLnB1c2goVXRpbHMuZm9ybWF0RGF0ZVRpbWVTZWMobmV3IERhdGUodGhpcy5zdGF0ZXNbaV0udGltZXN0YW1wKSkpO1xyXG5cdFx0XHRcdH0gXHJcblx0XHRcdFx0Y29uc29sZS5sb2coXCJBVkcgTlVMTCBCRUNBVVNFIFNFQVJDSElORyBcIitVdGlscy5mb3JtYXREYXRlVGltZVNlYyhuZXcgRGF0ZShjdGltZSkpK1wiIHwgXCIrYXJyKTtcclxuXHRcdFx0fSovXHJcblx0XHRcdHJldHVybiByZXM7XHJcblx0XHR9LFxyXG5cclxuXHRcdGNhbGN1bGF0ZUVsYXBzZWRBdmVyYWdlIDogZnVuY3Rpb24oY3RpbWUpIFxyXG5cdFx0e1xyXG5cdFx0XHR2YXIgcmVzPW51bGw7XHJcblx0XHRcdGN0aW1lLT1DT05GSUcubWF0aC5kaXNwbGF5RGVsYXkqMTAwMDtcclxuXHRcdFx0Ly9jb25zb2xlLmxvZyhcIlNFQVJDSElORyBGT1IgVElNRSBcIitVdGlscy5mb3JtYXREYXRlVGltZVNlYyhuZXcgRGF0ZShjdGltZSkpKTtcclxuXHRcdFx0dmFyIG9rID0gZmFsc2U7XHJcblx0XHRcdGZvciAodmFyIGk9dGhpcy5zdGF0ZXMubGVuZ3RoLTI7aT49MDtpLS0pIFxyXG5cdFx0XHR7XHJcblx0XHRcdFx0dmFyIGogPSBpKzE7XHJcblx0XHRcdFx0dmFyIHNhID0gdGhpcy5jYWxjQVZHU3RhdGUoaSk7XHJcblx0XHRcdFx0dmFyIHNiID0gdGhpcy5jYWxjQVZHU3RhdGUoaik7XHJcblx0XHRcdFx0aWYgKGN0aW1lID49IHNhLnRpbWVzdGFtcCAmJiBjdGltZSA8PSBzYi50aW1lc3RhbXApIFxyXG5cdFx0XHRcdHsgXHJcblx0XHRcdFx0XHRyZXMgPSBzYS5lbGFwc2VkKyhjdGltZS1zYS50aW1lc3RhbXApICogKHNiLmVsYXBzZWQtc2EuZWxhcHNlZCkgLyAoc2IudGltZXN0YW1wLXNhLnRpbWVzdGFtcCk7XHJcblx0XHRcdFx0XHQvL2NvbnNvbGUubG9nKFwiRk9VTkQgVElNRSBJTlQgW1wiK1V0aWxzLmZvcm1hdERhdGVUaW1lU2VjKG5ldyBEYXRlKHNhLnRpbWVzdGFtcCkpK1wiID4gXCIrVXRpbHMuZm9ybWF0RGF0ZVRpbWVTZWMobmV3IERhdGUoc2IudGltZXN0YW1wKSkrXCJdXCIpO1xyXG5cdFx0XHRcdFx0b2s9dHJ1ZTtcclxuXHRcdFx0XHRcdGJyZWFrO1xyXG5cdFx0XHRcdH1cclxuXHRcdFx0XHRpZiAoc2IudGltZXN0YW1wIDwgY3RpbWUpIHtcclxuXHRcdFx0XHRcdHRoaXMuc2V0U2lnbmFsTG9zdERlbGF5KGN0aW1lLXNiLnRpbWVzdGFtcCk7XHJcblx0XHRcdFx0XHQvL2NvbnNvbGUubG9nKFwiQlJFQUsgT04gXCIrZm9ybWF0VGltZVNlYyhuZXcgRGF0ZShjdGltZSkpK1wiIHwgXCIrKGN0aW1lLXNiLnRpbWVzdGFtcCkvMTAwMC4wKTtcclxuXHRcdFx0XHRcdHJldHVybiBudWxsO1xyXG5cdFx0XHRcdH1cclxuXHRcdFx0fVxyXG5cdFx0XHRpZiAoIW9rKSB7XHJcblx0XHRcdFx0aWYgKHRoaXMuc3RhdGVzLmxlbmd0aCA+PSAyKVxyXG5cdFx0XHRcdFx0Y29uc29sZS5sb2codGhpcy5jb2RlK1wiIHwgTk9UIEZPVU5EIFRJTUUgXCIrVXRpbHMuZm9ybWF0RGF0ZVRpbWVTZWMobmV3IERhdGUoY3RpbWUpKStcIiB8IHQtbGFzdD1cIisoY3RpbWUtdGhpcy5zdGF0ZXNbdGhpcy5zdGF0ZXMubGVuZ3RoLTFdLnRpbWVzdGFtcCkvMTAwMC4wK1wiIHwgdC1maXJzdD1cIisoY3RpbWUtdGhpcy5zdGF0ZXNbMF0udGltZXN0YW1wKS8xMDAwLjApO1xyXG5cdFx0XHR9IGVsc2VcclxuXHRcdFx0XHR0aGlzLnNldFNpZ25hbExvc3REZWxheShudWxsKTtcclxuXHRcdFx0cmV0dXJuIHJlcztcclxuXHRcdH0sXHJcblx0XHRcclxuXHRcdGNhbGNBVkdTdGF0ZSA6IGZ1bmN0aW9uKHBvcykge1xyXG5cdFx0XHRpZiAoIUNPTkZJRy5tYXRoLmludGVycG9sYXRlR1BTQXZlcmFnZSlcclxuXHRcdFx0XHRyZXR1cm4gdGhpcy5zdGF0ZXNbcG9zXTtcclxuXHRcdFx0dmFyIHNzdW1lPTA7XHJcblx0XHRcdHZhciBzc3VtdD0wO1xyXG5cdFx0XHR2YXIgY2M9MDtcclxuXHRcdFx0Zm9yICh2YXIgaT1wb3M7aT49MCAmJiAocG9zLWkpPENPTkZJRy5tYXRoLmludGVycG9sYXRlR1BTQXZlcmFnZTtpLS0pIHtcclxuXHRcdFx0XHRzc3VtZSs9dGhpcy5zdGF0ZXNbaV0uZWxhcHNlZDtcclxuXHRcdFx0XHRzc3VtdCs9dGhpcy5zdGF0ZXNbaV0udGltZXN0YW1wO1xyXG5cdFx0XHRcdGNjKys7XHJcblx0XHRcdH1cclxuXHRcdFx0c3N1bWUvPWNjO1xyXG5cdFx0XHRzc3VtdC89Y2M7XHJcblx0XHRcdHJldHVybiB7ZWxhcHNlZCA6IHNzdW1lLHRpbWVzdGFtcCA6IHNzdW10fTtcclxuXHRcdH0sXHJcblxyXG5cdFx0cGluZ0NhbGN1bGF0ZWQgOiBmdW5jdGlvbihvYmopIHtcclxuXHRcdFx0aWYgKG9iai5kaXNjYXJkZWQpIHtcclxuXHRcdFx0XHRkZWxldGUgb2JqLmRpc2NhcmRlZDtcclxuXHRcdFx0XHR0aGlzLnNldElzRGlzY2FyZGVkKHRydWUpO1x0XHRcdFxyXG5cdFx0XHR9XHJcblx0XHRcdHZhciBzdGF0ZSA9IG5ldyBQYXJ0aWNpcGFudFN0YXRlKG9iaik7XHJcblx0XHRcdHRoaXMuYWRkU3RhdGUoc3RhdGUpO1xyXG5cdFx0XHR2YXIgcG9zID0gc3RhdGUuZ3BzO1xyXG5cdFx0XHR2YXIgY29lZiA9IHRoaXMudHJhY2suZ2V0VHJhY2tMZW5ndGhJbldHUzg0KCkvdGhpcy50cmFjay5nZXRUcmFja0xlbmd0aCgpO1xyXG5cdFx0XHR2YXIgcnIgPSBDT05GSUcubWF0aC5ncHNJbmFjY3VyYWN5KmNvZWY7XHJcblx0XHRcdFxyXG5cdFx0XHRcclxuXHRcdFx0aWYgKHR5cGVvZiBHVUkgIT0gXCJ1bmRlZmluZWRcIiAmJiBHVUkuaXNEZWJ1ZykgXHJcblx0XHRcdHtcclxuXHRcdFx0XHR2YXIgcmluZyA9IFtcclxuXHRcdFx0XHQgICAgICAgICAgICBbcG9zWzBdLXJyLCBwb3NbMV0tcnIqY29lZnldLCBbcG9zWzBdK3JyLCBwb3NbMV0tcnIqY29lZnldLFtwb3NbMF0rcnIsIHBvc1sxXStycipjb2VmeV0sW3Bvc1swXS1yciwgcG9zWzFdK3JyKmNvZWZ5XSxbcG9zWzBdLXJyLCBwb3NbMV0tcnIqY29lZnldXHJcblx0IFx0XHRcdCAgICAgICAgICBdO1xyXG5cdFx0XHRcdHZhciBwb2x5Z29uID0gbmV3IG9sLmdlb20uUG9seWdvbihbcmluZ10pO1xyXG5cdFx0XHRcdHBvbHlnb24udHJhbnNmb3JtKCdFUFNHOjQzMjYnLCAnRVBTRzozODU3Jyk7XHJcblx0XHRcdFx0dmFyIGZlYXR1cmUgPSBuZXcgb2wuRmVhdHVyZShwb2x5Z29uKTtcclxuXHRcdFx0XHRHVUkudGVzdExheWVyMS5nZXRTb3VyY2UoKS5hZGRGZWF0dXJlKGZlYXR1cmUpO1xyXG5cclxuXHRcdFx0XHR2YXIgbXBvcyA9IG9sLnByb2oudHJhbnNmb3JtKHBvcywgJ0VQU0c6NDMyNicsICdFUFNHOjM4NTcnKTtcclxuXHRcdFx0XHR2YXIgZmVhdHVyZSA9IG5ldyBvbC5GZWF0dXJlKG5ldyBvbC5nZW9tLlBvaW50KG1wb3MpKTtcclxuXHRcdFx0XHRHVUkudGVzdExheWVyLmdldFNvdXJjZSgpLmFkZEZlYXR1cmUoZmVhdHVyZSk7XHJcblx0XHRcdFx0Ly9jb25zb2xlLmxvZyh0aGlzLmdldENvZGUoKStcIiB8IFwiK01hdGgucm91bmQoc3RhdGUuZWxhcHNlZCoxMDAuMCoxMDAuMCkvMTAwLjArXCIlIFBPTkcgW1wiK3Bvc1swXStcIixcIitwb3NbMV0rXCJdIFwiK25ldyBEYXRlKHN0YXRlLnRpbWVzdGFtcCkrXCIgfCBcIitzdGF0ZS5kZWJ1Z0luZm8pO1xyXG5cdFx0XHRcdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdFx0XHRcdGlmIChzdGF0ZS5kZWJ1Z0luZm8gJiYgc3RhdGUuZGVidWdJbmZvLnBvaW50ICYmIHN0YXRlLmRlYnVnSW5mby5iZXN0KSBcclxuXHRcdFx0XHR7XHJcblx0XHRcdFx0XHR2YXIgbXBvcyA9IG9sLnByb2oudHJhbnNmb3JtKHN0YXRlLmRlYnVnSW5mby5wb2ludCwgJ0VQU0c6NDMyNicsICdFUFNHOjM4NTcnKTtcclxuXHRcdFx0XHRcdHZhciBmZWF0dXJlID0gbmV3IG9sLkZlYXR1cmUobmV3IG9sLmdlb20uUG9pbnQobXBvcykpO1xyXG5cdFx0XHRcdFx0aWYgKHRoaXMuX19vbGRGZWF0dXJlMSlcclxuXHRcdFx0XHRcdFx0R1VJLnRlc3RMYXllcjIuZ2V0U291cmNlKCkucmVtb3ZlRmVhdHVyZSh0aGlzLl9fb2xkRmVhdHVyZTEpO1xyXG5cdFx0XHRcdFx0R1VJLnRlc3RMYXllcjIuZ2V0U291cmNlKCkuYWRkRmVhdHVyZShmZWF0dXJlKTtcclxuXHRcdFx0XHRcdGZlYXR1cmUuZGVidWdJbmZvPXN0YXRlLmRlYnVnSW5mbztcclxuXHRcdFx0XHRcdHRoaXMuX19vbGRGZWF0dXJlMT1mZWF0dXJlO1xyXG5cclxuXHRcdFx0XHRcdHZhciBwMSA9IHRoaXMudHJhY2sucm91dGVbc3RhdGUuZGVidWdJbmZvLmJlc3RdO1xyXG5cdFx0XHRcdFx0dmFyIHAyID0gdGhpcy50cmFjay5yb3V0ZVtzdGF0ZS5kZWJ1Z0luZm8uYmVzdCsxXTtcclxuXHRcdFx0XHRcdHZhciBsaW5lID0gbmV3IG9sLmdlb20uTGluZVN0cmluZyhbIHAxLHAyIF0pO1xyXG5cdFx0XHRcdFx0bGluZS50cmFuc2Zvcm0oJ0VQU0c6NDMyNicsICdFUFNHOjM4NTcnKTtcclxuXHRcdFx0XHRcdFxyXG5cdFx0XHRcdFx0aWYgKHRoaXMuX19vbGRGZWF0dXJlMilcclxuXHRcdFx0XHRcdFx0R1VJLnRlc3RMYXllcjIuZ2V0U291cmNlKCkucmVtb3ZlRmVhdHVyZSh0aGlzLl9fb2xkRmVhdHVyZTIpO1xyXG5cdFx0XHRcdFx0dmFyIGZlYXR1cmUgPSBuZXcgb2wuRmVhdHVyZShsaW5lKTtcclxuXHRcdFx0XHRcdGZlYXR1cmUuZGVidWdJbmZvPXN0YXRlLmRlYnVnSW5mbztcclxuXHRcdFx0XHRcdEdVSS50ZXN0TGF5ZXIyLmdldFNvdXJjZSgpLmFkZEZlYXR1cmUoZmVhdHVyZSk7XHJcblx0XHRcdFx0XHR0aGlzLl9fb2xkRmVhdHVyZTI9ZmVhdHVyZTtcclxuXHRcdFx0XHR9XHJcblx0XHRcdFx0XHJcblx0XHRcdFx0d2hpbGUgKEdVSS50ZXN0TGF5ZXIxLmdldFNvdXJjZSgpLmdldEZlYXR1cmVzKCkubGVuZ3RoID4gMTAwKVxyXG5cdFx0XHRcdFx0R1VJLnRlc3RMYXllcjEuZ2V0U291cmNlKCkucmVtb3ZlRmVhdHVyZShHVUkudGVzdExheWVyMS5nZXRTb3VyY2UoKS5nZXRGZWF0dXJlcygpWzBdKTtcclxuXHRcdFx0XHR3aGlsZSAoR1VJLnRlc3RMYXllci5nZXRTb3VyY2UoKS5nZXRGZWF0dXJlcygpLmxlbmd0aCA+IDEwMClcclxuXHRcdFx0XHRcdEdVSS50ZXN0TGF5ZXIuZ2V0U291cmNlKCkucmVtb3ZlRmVhdHVyZShHVUkudGVzdExheWVyLmdldFNvdXJjZSgpLmdldEZlYXR1cmVzKClbMF0pO1xyXG5cdFx0XHR9IFxyXG5cclxuXHRcdH0sXHJcblxyXG5cdFx0Z2V0T3ZlcmFsbFJhbmsgOiBmdW5jdGlvbigpIHtcclxuXHRcdFx0aWYgKHRoaXMuc3RhdGVzLmxlbmd0aCkge1xyXG5cdFx0XHRcdHJldHVybiB0aGlzLnN0YXRlc1t0aGlzLnN0YXRlcy5sZW5ndGgtMV0ub3ZlcmFsbFJhbms7XHJcblx0XHRcdH1cclxuXHRcdFx0cmV0dXJuIFwiLVwiO1xyXG5cdFx0fSxcclxuXHRcdGdldEdyb3VwUmFuayA6IGZ1bmN0aW9uKCkge1xyXG5cdFx0XHRpZiAodGhpcy5zdGF0ZXMubGVuZ3RoKSB7XHJcblx0XHRcdFx0cmV0dXJuIHRoaXMuc3RhdGVzW3RoaXMuc3RhdGVzLmxlbmd0aC0xXS5ncm91cFJhbms7XHJcblx0XHRcdH1cclxuXHRcdFx0cmV0dXJuIFwiLVwiO1xyXG5cdFx0fSxcclxuXHRcdGdldEdlbmRlclJhbmsgOiBmdW5jdGlvbigpIHtcclxuXHRcdFx0aWYgKHRoaXMuc3RhdGVzLmxlbmd0aCkge1xyXG5cdFx0XHRcdHJldHVybiB0aGlzLnN0YXRlc1t0aGlzLnN0YXRlcy5sZW5ndGgtMV0uZ2VuZGVyUmFuaztcclxuXHRcdFx0fVxyXG5cdFx0XHRyZXR1cm4gXCItXCI7XHJcblx0XHR9LFxyXG5cdFx0XHJcblx0XHRwaW5nIDogZnVuY3Rpb24ocG9zLGZyZXEsaXNTT1MsY3RpbWUsYWx0LG92ZXJhbGxSYW5rLGdyb3VwUmFuayxnZW5kZXJSYW5rLF9FTEFQU0VEKVxyXG5cdFx0e1xyXG5cdFx0XHR2YXIgbGx0ID0gKG5ldyBEYXRlKCkpLmdldFRpbWUoKTsgXHJcblx0XHRcdGlmICghY3RpbWUpXHJcblx0XHRcdFx0Y3RpbWU9bGx0O1xyXG5cdFx0XHR0aGlzLnNldExhc3RSZWFsRGVsYXkobGx0LWN0aW1lKTtcclxuXHRcdFx0dGhpcy5zZXRMYXN0UGluZ1RpbWVzdGFtcChsbHQpO1x0XHRcdFxyXG5cdFx0XHR2YXIgc3RhdGUgPSBuZXcgUGFydGljaXBhbnRTdGF0ZSh7dGltZXN0YW1wOmN0aW1lLGdwczpwb3MsaXNTT1M6aXNTT1MsZnJlcTpmcmVxLGFsdDphbHQsb3ZlcmFsbFJhbms6b3ZlcmFsbFJhbmssZ3JvdXBSYW5rOmdyb3VwUmFuayxnZW5kZXJSYW5rOmdlbmRlclJhbmt9KTtcclxuXHRcdFx0Ly9pc1NPUz10cnVlO1xyXG5cdFx0XHRpZiAoaXNTT1MgfHwgQ09ORklHLnNldHRpbmdzLm5vSW50ZXJwb2xhdGlvbilcclxuXHRcdFx0e1xyXG5cdFx0XHRcdGlmIChpc1NPUylcclxuXHRcdFx0XHRcdHRoaXMuc2V0SXNTT1ModHJ1ZSk7XHRcdFx0XHRcclxuXHRcdFx0XHR0aGlzLmFkZFN0YXRlKHN0YXRlKTtcclxuXHRcdFx0XHRyZXR1cm47XHJcblx0XHRcdH1cclxuXHRcdFx0Ly8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0XHRcdHZhciB0cmFja2xlbiA9IHRoaXMudHJhY2suZ2V0VHJhY2tMZW5ndGgoKTtcclxuXHRcdFx0dmFyIHRyYWNrbGVuMSA9IHRoaXMudHJhY2suZ2V0VHJhY2tMZW5ndGhJbldHUzg0KCk7XHJcblx0XHRcdHZhciBsbHN0YXRlID0gdGhpcy5zdGF0ZXMubGVuZ3RoID49IDIgPyB0aGlzLnN0YXRlc1t0aGlzLnN0YXRlcy5sZW5ndGgtMl0gOiBudWxsO1xyXG5cdFx0XHR2YXIgbHN0YXRlID0gdGhpcy5zdGF0ZXMubGVuZ3RoID8gdGhpcy5zdGF0ZXNbdGhpcy5zdGF0ZXMubGVuZ3RoLTFdIDogbnVsbDtcclxuXHRcdFx0aWYgKHBvc1swXSA9PSAwICYmIHBvc1sxXSA9PSAwKSB7XHJcblx0XHRcdFx0aWYgKCFsc3RhdGUpIHJldHVybjtcclxuXHRcdFx0XHRwb3M9bHN0YXRlLmdwcztcclxuXHRcdFx0fVxyXG5cdFx0XHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRcdFx0dmFyIGJlc3Q7XHJcblx0XHRcdHZhciBiZXN0bT1udWxsO1xyXG5cdFx0XHR2YXIgbGVscCA9IGxzdGF0ZSA/IGxzdGF0ZS5nZXRFbGFwc2VkKCkgOiAwO1x0Ly8gbGFzdCBlbGFwc2VkXHJcblx0XHRcdHZhciB0ZyA9IHRoaXMudHJhY2sucm91dGU7XHJcblx0XHRcdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdFx0XHQvLyBORVcgQUxHXHJcblx0XHRcdHZhciBjb2VmID0gdGhpcy50cmFjay5nZXRUcmFja0xlbmd0aEluV0dTODQoKS90aGlzLnRyYWNrLmdldFRyYWNrTGVuZ3RoKCk7XHJcblx0XHRcdHZhciBtaW5mID0gbnVsbDtcclxuXHRcdFx0dmFyIHJyID0gQ09ORklHLm1hdGguZ3BzSW5hY2N1cmFjeSpjb2VmO1xyXG5cdFx0XHR2YXIgcmVzdWx0ID0gdGhpcy50cmFjay5yVHJlZS5zZWFyY2goW3Bvc1swXS1yciwgcG9zWzFdLXJyKmNvZWZ5LCBwb3NbMF0rcnIsIHBvc1sxXStycipjb2VmeV0pO1xyXG5cdFx0XHRpZiAoIXJlc3VsdClcclxuXHRcdFx0XHRyZXN1bHQ9W107XHJcblx0XHRcdC8vY29uc29sZS5sb2coXCIhISEgRk9VTkQgXCIrcmVzdWx0Lmxlbmd0aCtcIiB8IFwiK3RoaXMudHJhY2sucm91dGUubGVuZ3RoK1wiIHwgXCIrcnIpO1xyXG5cdFx0XHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRcdFx0dmFyIGRlYnVnSW5mbz17fTtcclxuXHRcdFx0dmFyIG1taW5mPW51bGw7XHJcblx0XHRcdGZvciAodmFyIF9pPTA7X2k8cmVzdWx0Lmxlbmd0aDtfaSsrKVxyXG5cdFx0XHR7XHJcblx0XHRcdFx0dmFyIGkgPSByZXN1bHRbX2ldWzRdLmluZGV4O1xyXG5cdFx0XHRcdC8vYTEsYTIscjEscjJcclxuXHRcdFx0XHR2YXIgcmVzID0gSW50ZXJzZWN0aW9uLmludGVyc2VjdExpbmVSZWN0YW5nbGUoXHJcblx0XHRcdFx0XHRcdFx0bmV3IFBvaW50MkQodGdbaV1bMF0sdGdbaV1bMV0pLFxyXG5cdFx0XHRcdFx0XHRcdG5ldyBQb2ludDJEKHRnW2krMV1bMF0sdGdbaSsxXVsxXSksXHJcblx0XHRcdFx0XHRcdFx0bmV3IFBvaW50MkQocG9zWzBdLXJyLHBvc1sxXS1ycipjb2VmeSksXHJcblx0XHRcdFx0XHRcdFx0bmV3IFBvaW50MkQocG9zWzBdK3JyLHBvc1sxXStycipjb2VmeSlcclxuXHRcdFx0XHRcdFx0KTtcclxuXHRcdFx0XHQvL2NvbnNvbGUubG9nKHJlcyk7XHJcblx0XHRcdFx0aWYgKHJlcyAmJiByZXMucG9pbnRzICYmIHJlcy5wb2ludHMubGVuZ3RoKSBcclxuXHRcdFx0XHR7XHJcblx0XHRcdFx0XHQvL1V0aWxzLmRpc3BcclxuXHRcdFx0XHRcdHZhciBkMyA9IFV0aWxzLldHUzg0U1BIRVJFLmhhdmVyc2luZURpc3RhbmNlKHRnW2ldLHRnW2krMV0pO1xyXG5cdFx0XHRcdFx0cmVzPXJlcy5wb2ludHM7XHJcblx0XHRcdFx0XHRmb3IgKHZhciBxPTA7cTxyZXMubGVuZ3RoO3ErKykgXHJcblx0XHRcdFx0XHR7XHJcblx0XHRcdFx0XHRcdC8vVXRpbHMuZGlzcFxyXG5cdFx0XHRcdFx0XHR2YXIgZDEgPSBVdGlscy5XR1M4NFNQSEVSRS5oYXZlcnNpbmVEaXN0YW5jZShbcmVzW3FdLngscmVzW3FdLnldLHRnW2ldKTtcclxuXHRcdFx0XHRcdFx0dmFyIGVsMSA9IHRoaXMudHJhY2suZGlzdGFuY2VzRWxhcHNlZFtpXSsodGhpcy50cmFjay5kaXN0YW5jZXNFbGFwc2VkW2krMV0tdGhpcy50cmFjay5kaXN0YW5jZXNFbGFwc2VkW2ldKSpkMS9kMztcclxuXHRcdFx0XHRcdFx0aWYgKGVsMSA8IGxlbHApIHtcclxuXHRcdFx0XHRcdFx0XHRpZiAobW1pbmYgPT0gbnVsbCB8fCBtbWluZiA+IGVsMSlcclxuXHRcdFx0XHRcdFx0XHRcdG1taW5mPWVsMTtcclxuXHRcdFx0XHRcdFx0XHRjb250aW51ZTsgXHRcdFx0XHQvLyBTS0lQIDwgTEVMUFxyXG5cdFx0XHRcdFx0XHR9XHJcblx0XHRcdFx0XHRcdGlmIChtaW5mID09IG51bGwgfHwgZWwxIDwgbWluZikge1xyXG5cdFx0XHRcdFx0XHRcdGlmIChkZWJ1Z0luZm8pIHtcclxuXHRcdFx0XHRcdFx0XHRcdGRlYnVnSW5mby5iZXN0PWk7XHJcblx0XHRcdFx0XHRcdFx0XHRkZWJ1Z0luZm8ucG9pbnQ9W3Jlc1txXS54LHJlc1txXS55XTtcclxuXHRcdFx0XHRcdFx0XHRcdGRlYnVnSW5mby52YWx1ZT1lbDE7XHJcblx0XHRcdFx0XHRcdFx0fVxyXG5cdFx0XHRcdFx0XHRcdG1pbmY9ZWwxO1xyXG5cdFx0XHRcdFx0XHR9XHJcblx0XHRcdFx0XHRcdC8vY29uc29sZS5sb2coXCJJbnRlcnNlY3Rpb24gY2FuZGlkYXRlIGF0IFwiK2krXCIgfCBcIitNYXRoLnJvdW5kKGVsMSoxMDAuMCoxMDAuMCkvMTAwLjApO1xyXG5cdFx0XHRcdFx0fVxyXG5cdFx0XHRcdH1cclxuXHRcdFx0XHQvKnZhciByZXMgPSBVdGlscy5pbnRlcmNlcHRPbkNpcmNsZSh0Z1tpXSx0Z1tpKzFdLHBvcyxycik7XHJcblx0XHRcdFx0aWYgKHJlcykgXHJcblx0XHRcdFx0e1xyXG5cdFx0XHRcdFx0Ly8gaGFzIGludGVyc2VjdGlvbiAoMiBwb2ludHMpXHJcblx0XHRcdFx0XHR2YXIgZDEgPSBVdGlscy5kaXN0cChyZXNbMF0sdGdbaV0pO1xyXG5cdFx0XHRcdFx0dmFyIGQyID0gVXRpbHMuZGlzdHAocmVzWzFdLHRnW2ldKTtcclxuXHRcdFx0XHRcdHZhciBkMyA9IFV0aWxzLmRpc3RwKHRnW2ldLHRnW2krMV0pO1xyXG5cdFx0XHRcdFx0dmFyIGVsMSA9IHRoaXMudHJhY2suZGlzdGFuY2VzRWxhcHNlZFtpXSsodGhpcy50cmFjay5kaXN0YW5jZXNFbGFwc2VkW2krMV0tdGhpcy50cmFjay5kaXN0YW5jZXNFbGFwc2VkW2ldKSpkMS9kMztcclxuXHRcdFx0XHRcdHZhciBlbDIgPSB0aGlzLnRyYWNrLmRpc3RhbmNlc0VsYXBzZWRbaV0rKHRoaXMudHJhY2suZGlzdGFuY2VzRWxhcHNlZFtpKzFdLXRoaXMudHJhY2suZGlzdGFuY2VzRWxhcHNlZFtpXSkqZDIvZDM7XHJcblx0XHRcdFx0XHQvL2NvbnNvbGUubG9nKFwiSW50ZXJzZWN0aW9uIGNhbmRpZGF0ZSBhdCBcIitpK1wiIHwgXCIrTWF0aC5yb3VuZChlbDEqMTAwLjAqMTAwLjApLzEwMC4wK1wiIHwgXCIrTWF0aC5yb3VuZChlbDIqMTAwLjAqMTAwLjApLzEwMC4wK1wiIHwgTEVMUD1cIitNYXRoLnJvdW5kKGxlbHAqMTAwLjAqMTAwLjApLzEwMC4wKTtcclxuXHRcdFx0XHRcdGlmIChlbDEgPCBsZWxwKVxyXG5cdFx0XHRcdFx0XHRlbDE9bGVscDtcclxuXHRcdFx0XHRcdGlmIChlbDIgPCBsZWxwKVxyXG5cdFx0XHRcdFx0XHRlbDI9bGVscDtcclxuXHRcdFx0XHRcdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdFx0XHRcdFx0aWYgKG1pbmYgPT0gbnVsbCB8fCBlbDEgPCBtaW5mKVxyXG5cdFx0XHRcdFx0XHRtaW5mPWVsMTtcclxuXHRcdFx0XHRcdGlmIChlbDIgPCBtaW5mKVxyXG5cdFx0XHRcdFx0XHRtaW5mPWVsMjtcclxuXHRcdFx0XHR9Ki9cclxuXHRcdFx0fVxyXG5cdFx0XHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVx0XHRcdFxyXG5cdFx0XHRpZiAobWluZiA9PSBudWxsICYmIG1taW5mID09IG51bGwpIFxyXG5cdFx0XHR7XHJcblx0XHRcdFx0Y29uc29sZS5lcnJvcihcIk1NSU5GIE5VTEwgPiBESVNDQVJEIFwiK3RoaXMuY29kZStcIiB8IFwiK3RoaXMuZGV2aWNlSWQpO1xyXG5cdFx0XHRcdHRoaXMuc2V0SXNEaXNjYXJkZWQodHJ1ZSk7XHJcblx0XHRcdFx0c3RhdGUuc2V0RWxhcHNlZChsZWxwKTtcclxuXHRcdFx0XHR0aGlzLmFkZFN0YXRlKHN0YXRlKTtcclxuXHRcdFx0XHRyZXR1cm47XHJcblx0XHRcdH1cclxuXHJcblx0XHRcdC8qaWYgKG1pbmYgPT0gbnVsbClcclxuXHRcdFx0XHRjb25zb2xlLmVycm9yKFwiTUlORiBOVUxMXCIpO1xyXG5cdFx0XHRlbHNlXHJcblx0XHRcdFx0Y29uc29sZS5sb2coXCI+PiBNSU5GIFwiK01hdGgucm91bmQobWluZioxMDAuMCoxMDAuMCkvMTAwLjApOyovXHJcblx0XHRcdGlmIChkZWJ1Z0luZm8pXHJcblx0XHRcdFx0c3RhdGUuZGVidWdJbmZvPWRlYnVnSW5mbztcclxuXHRcdFx0Ly9jb25zb2xlLmxvZyhcIlNUQVRUVFRUVEVFRUVFIDogXCIrSlNPTi5zdHJpbmdpZnkoc3RhdGUpKTtcclxuXHRcdFx0aWYgKG1pbmYgPT0gbnVsbCkge1xyXG5cdFx0XHRcdHN0YXRlLnNldEVsYXBzZWQobGVscCk7XHJcblx0XHRcdFx0dGhpcy5hZGRTdGF0ZShzdGF0ZSk7XHJcblx0XHRcdFx0cmV0dXJuO1xyXG5cdFx0XHR9XHJcblxyXG5cdFx0XHRiZXN0bT1taW5mO1xyXG5cdFx0XHRpZiAoYmVzdG0gIT0gbnVsbCkgXHJcblx0XHRcdHtcclxuXHRcdFx0XHR2YXIgbmVsID0gYmVzdG07IFxyXG5cdFx0XHRcdGlmIChsc3RhdGUpIFxyXG5cdFx0XHRcdHtcclxuXHRcdFx0XHRcdC8qaWYgKG5lbCA8IGxzdGF0ZS5nZXRFbGFwc2VkKCkpIFxyXG5cdFx0XHRcdFx0e1xyXG5cdFx0XHRcdFx0XHQvLyBXUk9ORyBESVJFQ1RJT04gT1IgR1BTIERBVEEgV1JPTkc/IFNLSVAuLlxyXG5cdFx0XHRcdFx0XHRpZiAoKGxzdGF0ZS5nZXRFbGFwc2VkKCktbmVsKSp0cmFja2xlbiA8IENPTkZJRy5jb25zdHJhaW50cy5iYWNrd2FyZHNFcHNpbG9uSW5NZXRlcikgXHJcblx0XHRcdFx0XHRcdFx0cmV0dXJuO1xyXG5cdFx0XHRcdFx0XHRkbyAgXHJcblx0XHRcdFx0XHRcdHtcclxuXHRcdFx0XHRcdFx0XHRuZWwrPTEuMDtcclxuXHRcdFx0XHRcdFx0fSB3aGlsZSAobmVsIDwgbHN0YXRlLmdldEVsYXBzZWQoKSk7XHJcblx0XHRcdFx0XHR9Ki9cclxuXHRcdFx0XHRcdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRcdFx0XHRcdGlmIChuZWwgPiB0aGlzLnRyYWNrLmxhcHMpIHtcclxuXHRcdFx0XHRcdFx0bmVsPXRoaXMudHJhY2subGFwcztcclxuXHRcdFx0XHRcdH1cclxuXHRcdFx0XHRcdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRcdFx0XHRcdGxsc3RhdGUgPSB0aGlzLnN0YXRlcy5sZW5ndGggPj0gQ09ORklHLm1hdGguc3BlZWRBbmRBY2NlbGVyYXRpb25BdmVyYWdlRGVncmVlKjIgPyB0aGlzLnN0YXRlc1t0aGlzLnN0YXRlcy5sZW5ndGgtQ09ORklHLm1hdGguc3BlZWRBbmRBY2NlbGVyYXRpb25BdmVyYWdlRGVncmVlKjJdIDogbnVsbDtcclxuXHRcdFx0XHRcdGxzdGF0ZSA9IHRoaXMuc3RhdGVzLmxlbmd0aCA+PSBDT05GSUcubWF0aC5zcGVlZEFuZEFjY2VsZXJhdGlvbkF2ZXJhZ2VEZWdyZWUgPyB0aGlzLnN0YXRlc1t0aGlzLnN0YXRlcy5sZW5ndGgtQ09ORklHLm1hdGguc3BlZWRBbmRBY2NlbGVyYXRpb25BdmVyYWdlRGVncmVlXSA6IG51bGw7XHJcblx0XHRcdFx0XHRpZiAobHN0YXRlKSAge1xyXG5cdFx0XHRcdFx0XHRzdGF0ZS5zZXRTcGVlZCggdHJhY2tsZW4gKiAobmVsLWxzdGF0ZS5nZXRFbGFwc2VkKCkpICogMTAwMCAvIChjdGltZS1sc3RhdGUudGltZXN0YW1wKSk7XHJcblx0XHRcdFx0XHRcdGlmIChsbHN0YXRlKSBcclxuXHRcdFx0XHRcdFx0XHRzdGF0ZS5zZXRBY2NlbGVyYXRpb24oIChzdGF0ZS5nZXRTcGVlZCgpLWxzdGF0ZS5nZXRTcGVlZCgpKSAqIDEwMDAgLyAoY3RpbWUtbHN0YXRlLnRpbWVzdGFtcCkpO1xyXG5cdFx0XHRcdFx0fVxyXG5cdFx0XHRcdFx0Ly8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdFx0XHRcdH1cclxuXHRcdFx0XHRzdGF0ZS5zZXRFbGFwc2VkKG5lbCk7XHJcblx0XHRcdH0gZWxzZSB7XHJcblx0XHRcdFx0aWYgKGxzdGF0ZSlcclxuXHRcdFx0XHRcdHN0YXRlLnNldEVsYXBzZWQobHN0YXRlLmdldEVsYXBzZWQoKSk7XHJcblx0XHRcdFx0aWYgKGxzdGF0ZS5nZXRFbGFwc2VkKCkgIT0gdGhpcy50cmFjay5sYXBzKSB7XHJcblx0XHRcdFx0XHR0aGlzLnNldElzRGlzY2FyZGVkKHRydWUpO1xyXG5cdFx0XHRcdH1cclxuXHRcdFx0fVxyXG5cdFx0XHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0XHRcdHRoaXMuYWRkU3RhdGUoc3RhdGUpO1xyXG5cdFx0fSxcclxuXHRcdFxyXG5cdFx0YWRkU3RhdGUgOiBmdW5jdGlvbihzdGF0ZSkge1xyXG5cdFx0XHR0aGlzLnN0YXRlcy5wdXNoKHN0YXRlKTtcclxuXHRcdFx0aWYgKHRoaXMuc3RhdGVzLmxlbmd0aCA+IENPTkZJRy5jb25zdHJhaW50cy5tYXhQYXJ0aWNpcGFudFN0YXRlSGlzdG9yeSAmJiAhdGhpcy5pc1NPUylcclxuXHRcdFx0XHR0aGlzLnN0YXRlcy5zaGlmdCgpO1xyXG5cdFx0fSxcclxuXHJcblx0XHRnZXRMYXN0U3RhdGU6IGZ1bmN0aW9uKCkge1xyXG5cdFx0XHRyZXR1cm4gdGhpcy5zdGF0ZXMubGVuZ3RoID8gdGhpcy5zdGF0ZXNbdGhpcy5zdGF0ZXMubGVuZ3RoLTFdIDogbnVsbDtcclxuXHRcdH0sXHJcblxyXG5cdFx0Z2V0RnJlcSA6IGZ1bmN0aW9uKCkge1xyXG5cdFx0XHR2YXIgbHN0YXRlID0gdGhpcy5nZXRMYXN0U3RhdGUoKTtcclxuXHRcdFx0cmV0dXJuIGxzdGF0ZSA/IGxzdGF0ZS5mcmVxIDogMDtcclxuXHRcdH0sXHJcblxyXG5cdFx0Z2V0U3BlZWQgOiBmdW5jdGlvbigpIHtcclxuXHRcdFx0dmFyIGxzdGF0ZSA9IHRoaXMuZ2V0TGFzdFN0YXRlKCk7XHJcblx0XHRcdHJldHVybiBsc3RhdGUgPyBsc3RhdGUuc3BlZWQgOiAwO1xyXG5cdFx0fSxcclxuXHJcblx0XHRnZXRHUFMgOiBmdW5jdGlvbigpIHtcclxuXHRcdFx0dmFyIGxzdGF0ZSA9IHRoaXMuZ2V0TGFzdFN0YXRlKCk7XHJcblx0XHRcdHJldHVybiBsc3RhdGUgPyBsc3RhdGUuZ3BzIDogdGhpcy5nZXRQb3NpdGlvbigpO1xyXG5cdFx0fSxcclxuXHJcblx0XHRnZXRFbGFwc2VkIDogZnVuY3Rpb24oKSB7XHJcblx0XHRcdHZhciBsc3RhdGUgPSB0aGlzLmdldExhc3RTdGF0ZSgpO1xyXG5cdFx0XHRyZXR1cm4gbHN0YXRlID8gbHN0YXRlLmVsYXBzZWQgOiAwO1xyXG5cdFx0fSxcclxuXHJcblx0XHRnZXRQb3B1cEhUTUwgOiBmdW5jdGlvbigpIHtcclxuXHRcdFx0dmFyIHBvcyA9IHRoaXMuZ2V0UG9zaXRpb24oKTtcclxuXHRcdFx0aWYgKHRoaXMuaXNTT1MgfHwgdGhpcy5pc0Rpc2NhcmRlZCkge1xyXG5cdFx0XHRcdHBvcyA9IHRoaXMuZ2V0R1BTKCk7XHJcblx0XHRcdH1cclxuXHRcdFx0dmFyIHRsZW4gPSB0aGlzLnRyYWNrLmdldFRyYWNrTGVuZ3RoKCk7XHJcblx0XHRcdHZhciBjdGltZSA9IChuZXcgRGF0ZSgpKS5nZXRUaW1lKCk7XHJcblx0XHRcdHZhciBlbGFwc2VkID0gdGhpcy5jYWxjdWxhdGVFbGFwc2VkQXZlcmFnZShjdGltZSk7XHJcblx0XHRcdHZhciB0cGFydCA9IHRoaXMudHJhY2suZ2V0VHJhY2tQYXJ0KGVsYXBzZWQpO1xyXG5cdFx0XHR2YXIgdGFyZ2V0S007XHJcblx0XHRcdHZhciBwYXJ0U3RhcnQ7XHJcblx0XHRcdHZhciB0cGFydE1vcmU7XHJcblx0XHRcdGlmICh0cGFydCA9PSAwKSB7XHJcblx0XHRcdFx0dHBhcnRzPVwiU1dJTVwiO1xyXG5cdFx0XHRcdHRhcmdldEtNPXRoaXMudHJhY2suYmlrZVN0YXJ0S007XHJcblx0XHRcdFx0cGFydFN0YXJ0PTA7XHJcblx0XHRcdFx0dHBhcnRNb3JlPVwiU1dJTVwiO1xyXG5cdFx0XHR9IGVsc2UgaWYgKHRwYXJ0ID09IDEpIHtcclxuXHRcdFx0XHR0cGFydHM9XCJCSUtFXCI7XHJcblx0XHRcdFx0dGFyZ2V0S009dGhpcy50cmFjay5ydW5TdGFydEtNO1xyXG5cdFx0XHRcdHBhcnRTdGFydD10aGlzLnRyYWNrLmJpa2VTdGFydEtNO1xyXG5cdFx0XHRcdHRwYXJ0TW9yZT1cIlJJREVcIjtcclxuXHRcdFx0fSBlbHNlIGlmICh0cGFydCA9PSAyKSB7IFxyXG5cdFx0XHRcdHRwYXJ0cz1cIlJVTlwiO1xyXG5cdFx0XHRcdHRhcmdldEtNPXRsZW4vMTAwMC4wO1xyXG5cdFx0XHRcdHBhcnRTdGFydD10aGlzLnRyYWNrLnJ1blN0YXJ0S007XHJcblx0XHRcdFx0dHBhcnRNb3JlPVwiUlVOXCI7XHJcblx0XHRcdH1cclxuXHRcdFx0dmFyIGh0bWw9XCI8ZGl2IGNsYXNzPSdwb3B1cF9jb2RlJyBzdHlsZT0nY29sb3I6cmdiYShcIitjb2xvckFscGhhQXJyYXkodGhpcy5nZXRDb2xvcigpLDAuOSkuam9pbihcIixcIikrXCIpJz5cIitlc2NhcGVIVE1MKHRoaXMuZ2V0Q29kZSgpKStcIiAoMSk8L2Rpdj5cIjtcclxuXHRcdFx0dmFyIGZyZXEgPSBNYXRoLnJvdW5kKHRoaXMuZ2V0RnJlcSgpKTtcclxuXHRcdFx0aWYgKGZyZXEgPiAwKSB7XHJcblx0XHRcdFx0aHRtbCs9XCI8ZGl2IGNsYXNzXCIgK1xyXG5cdFx0XHRcdFx0XHRcIj0ncG9wdXBfZnJlcSc+XCIrZnJlcStcIjwvZGl2PlwiO1xyXG5cdFx0XHR9XHJcblx0XHRcdHZhciBlbGttID0gZWxhcHNlZCp0bGVuLzEwMDAuMDtcclxuXHRcdFx0dmFyIGVsa21zID0gcGFyc2VGbG9hdChNYXRoLnJvdW5kKGVsa20gKiAxMDApIC8gMTAwKS50b0ZpeGVkKDIpO1x0XHRcdFxyXG5cclxuXHRcdFx0Lyp2YXIgcmVrbSA9IGVsYXBzZWQlMS4wO1xyXG5cdFx0XHRyZWttPSgxLjAtcmVrbSkqdGxlbi8xMDAwLjA7XHJcblx0XHRcdHJla20gPSBwYXJzZUZsb2F0KE1hdGgucm91bmQocmVrbSAqIDEwMCkgLyAxMDApLnRvRml4ZWQoMik7Ki9cdFx0XHRcclxuXHRcdFx0Ly8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdFx0XHR2YXIgZXN0Zj1udWxsO1xyXG5cdFx0XHR2YXIgZXR4dDE9bnVsbDtcclxuXHRcdFx0dmFyIGV0eHQyPW51bGw7XHJcblx0XHRcdHZhciBsc3RhdGUgPSBudWxsOyBcclxuXHRcdFx0aWYgKHRoaXMuc3RhdGVzLmxlbmd0aCkgXHJcblx0XHRcdHtcclxuXHRcdFx0XHRsc3RhdGUgPSB0aGlzLnN0YXRlc1t0aGlzLnN0YXRlcy5sZW5ndGgtMV07XHJcblx0XHRcdFx0aWYgKGxzdGF0ZS5nZXRTcGVlZCgpID4gMCkgXHJcblx0XHRcdFx0e1xyXG5cdFx0XHRcdFx0dmFyIHNwbXMgPSBNYXRoLmNlaWwobHN0YXRlLmdldFNwZWVkKCkgKiAxMDApIC8gMTAwO1xyXG5cdFx0XHRcdFx0c3Btcy89MTAwMC4wO1xyXG5cdFx0XHRcdFx0c3Btcyo9NjAqNjA7XHJcblx0XHRcdFx0XHRldHh0MT1wYXJzZUZsb2F0KHNwbXMpLnRvRml4ZWQoMikrXCIga20vaFwiO1xyXG5cdFx0XHRcdFx0dmFyIHJvdCA9IC10aGlzLmdldFJvdGF0aW9uKCkqMTgwL01hdGguUEk7IFxyXG5cdFx0XHRcdFx0aWYgKHJvdCA8IDApXHJcblx0XHRcdFx0XHRcdHJvdCs9MzYwO1xyXG5cdFx0XHRcdFx0aWYgKHJvdCAhPSBudWxsKSBcclxuXHRcdFx0XHRcdHtcclxuXHRcdFx0XHRcdFx0aWYgKHJvdCA8PSAwKSBcclxuXHRcdFx0XHRcdFx0XHRldHh0MSs9XCIgRVwiO1xyXG5cdFx0XHRcdFx0XHRlbHNlIGlmIChyb3QgPD0gNDUpXHJcblx0XHRcdFx0XHRcdFx0ZXR4dDErPVwiIFNFXCI7XHJcblx0XHRcdFx0XHRcdGVsc2UgaWYgKHJvdCA8PSA5MClcclxuXHRcdFx0XHRcdFx0XHRldHh0MSs9XCIgU1wiO1xyXG5cdFx0XHRcdFx0XHRlbHNlIGlmIChyb3QgPD0gMTM1KVxyXG5cdFx0XHRcdFx0XHRcdGV0eHQxKz1cIiBTV1wiO1xyXG5cdFx0XHRcdFx0XHRlbHNlIGlmIChyb3QgPD0gMTgwKVxyXG5cdFx0XHRcdFx0XHRcdGV0eHQxKz1cIiBXXCI7XHJcblx0XHRcdFx0XHRcdGVsc2UgaWYgKHJvdCA8PSAyMjUpXHJcblx0XHRcdFx0XHRcdFx0ZXR4dDErPVwiIE5XXCI7XHJcblx0XHRcdFx0XHRcdGVsc2UgaWYgKHJvdCA8PSAyNzApXHJcblx0XHRcdFx0XHRcdFx0ZXR4dDErPVwiIE5cIjtcclxuXHRcdFx0XHRcdFx0ZWxzZSBcclxuXHRcdFx0XHRcdFx0XHRldHh0MSs9XCIgTkVcIjtcclxuXHRcdFx0XHRcdH1cclxuXHRcdFx0XHRcdGVzdGY9VXRpbHMuZm9ybWF0VGltZShuZXcgRGF0ZSggY3RpbWUgKyB0YXJnZXRLTSoxMDAwIC8gc3BtcyoxMDAwICkpOyAgXHJcblx0XHRcdFx0fVxyXG5cdFx0XHRcdGlmIChsc3RhdGUuZ2V0QWNjZWxlcmF0aW9uKCkgPiAwKVxyXG5cdFx0XHRcdFx0ZXR4dDI9cGFyc2VGbG9hdChNYXRoLmNlaWwobHN0YXRlLmdldEFjY2VsZXJhdGlvbigpICogMTAwKSAvIDEwMCkudG9GaXhlZCgyKStcIiBtL3MyXCI7XHJcblx0XHRcdH1cclxuXHRcdFx0Ly8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0XHRcdHZhciBwMSA9IDEwMCp0aGlzLnRyYWNrLmJpa2VTdGFydEtNLyh0bGVuLzEwMDAuMCk7XHJcblx0XHRcdHZhciBwMiA9IDEwMCoodGhpcy50cmFjay5ydW5TdGFydEtNLXRoaXMudHJhY2suYmlrZVN0YXJ0S00pLyh0bGVuLzEwMDAuMCk7XHJcblx0XHRcdHZhciBwMyA9IDEwMCoodGxlbi8xMDAwLjAgLSB0aGlzLnRyYWNrLnJ1blN0YXJ0S00pLyh0bGVuLzEwMDAuMCk7XHJcblx0XHRcdHZhciBwcmV0dHlDb29yZD1cclxuXHRcdFx0XHRcIjxkaXYgc3R5bGU9J29wYWNpdHk6MC43O2Zsb2F0OmxlZnQ7b3ZlcmZsb3c6aGlkZGVuO2hlaWdodDo3cHg7d2lkdGg6XCIrcDErXCIlO2JhY2tncm91bmQtY29sb3I6XCIrQ09ORklHLmFwcGVhcmFuY2UudHJhY2tDb2xvclN3aW0rXCInLz5cIitcclxuXHRcdFx0XHRcIjxkaXYgc3R5bGU9J29wYWNpdHk6MC43O2Zsb2F0OmxlZnQ7b3ZlcmZsb3c6aGlkZGVuO2hlaWdodDo3cHg7d2lkdGg6XCIrcDIrXCIlO2JhY2tncm91bmQtY29sb3I6XCIrQ09ORklHLmFwcGVhcmFuY2UudHJhY2tDb2xvckJpa2UrXCInLz5cIitcclxuXHRcdFx0XHRcIjxkaXYgc3R5bGU9J29wYWNpdHk6MC43O2Zsb2F0OmxlZnQ7b3ZlcmZsb3c6aGlkZGVuO2hlaWdodDo3cHg7d2lkdGg6XCIrcDMrXCIlO2JhY2tncm91bmQtY29sb3I6XCIrQ09ORklHLmFwcGVhcmFuY2UudHJhY2tDb2xvclJ1bitcIicvPlwiXHJcblx0XHRcdFx0OyAvL29sLmNvb3JkaW5hdGUudG9TdHJpbmdIRE1TKHRoaXMuZ2V0UG9zaXRpb24oKSwgMik7XHJcblxyXG5cdFx0XHR2YXIgaW1nZGl2O1xyXG5cdFx0XHRpZiAodHBhcnQgPT0gMClcclxuXHRcdFx0XHRpbWdkaXY9XCI8aW1nIGNsYXNzPSdwb3B1cF90cmFja19tb2RlJyBzdHlsZT0nbGVmdDpcIitlbGFwc2VkKjEwMCtcIiUnIHNyYz0naW1nL3N3aW0uc3ZnJy8+XCJcclxuXHRcdFx0ZWxzZSBpZiAodHBhcnQgPT0gMSlcclxuXHRcdFx0XHRpbWdkaXY9XCI8aW1nIGNsYXNzPSdwb3B1cF90cmFja19tb2RlJyBzdHlsZT0nbGVmdDpcIitlbGFwc2VkKjEwMCtcIiUnIHNyYz0naW1nL2Jpa2Uuc3ZnJy8+XCJcclxuXHRcdFx0ZWxzZSAvKmlmICh0cGFydCA9PSAyKSovXHJcblx0XHRcdFx0aW1nZGl2PVwiPGltZyBjbGFzcz0ncG9wdXBfdHJhY2tfbW9kZScgc3R5bGU9J2xlZnQ6XCIrZWxhcHNlZCoxMDArXCIlJyBzcmM9J2ltZy9ydW4uc3ZnJy8+XCJcclxuXHRcclxuXHJcblx0XHRcdHZhciBwYXNzID0gTWF0aC5yb3VuZCgobmV3IERhdGUoKSkuZ2V0VGltZSgpLzM1MDApICUgMztcclxuXHRcdFx0aHRtbCs9XCI8dGFibGUgY2xhc3M9J3BvcHVwX3RhYmxlJyBzdHlsZT0nYmFja2dyb3VuZC1pbWFnZTp1cmwoXFxcIlwiK3RoaXMuZ2V0SW1hZ2UoKStcIlxcXCIpJz5cIjtcclxuXHRcdFx0dmFyIGlzRHVtbXk9IShlbGFwc2VkID4gMCk7XHJcblx0XHRcdGh0bWwrPVwiPHRyPjx0ZCBjbGFzcz0nbGJsJz5FbGFwc2VkPC90ZD48dGQgY2xhc3M9J3ZhbHVlJz5cIisoaXNEdW1teSA/IFwiLVwiIDogZWxrbXMrXCIga21cIikrXCI8L3RkPjwvdHI+XCI7XHJcblx0XHRcdGh0bWwrPVwiPHRyPjx0ZCBjbGFzcz0nbGJsJz5Nb3JlIHRvIFwiK3RwYXJ0TW9yZStcIjwvdGQ+PHRkIGNsYXNzPSd2YWx1ZSc+XCIrKGlzRHVtbXkgPyBcIi1cIiA6IHBhcnNlRmxvYXQoTWF0aC5yb3VuZCgodGFyZ2V0S00tZWxrbSkgKiAxMDApIC8gMTAwKS50b0ZpeGVkKDIpIC8qIHJla20gKi8gK1wiIGttXCIpK1wiPC90ZD48L3RyPlwiO1xyXG5cdFx0XHRodG1sKz1cIjx0cj48dGQgY2xhc3M9J2xibCc+RmluaXNoIFwiKyB0cGFydHMudG9Mb3dlckNhc2UoKSArXCI8L3RkPjx0ZCBjbGFzcz0ndmFsdWUnPlwiKyghZXN0ZiA/IFwiLVwiIDogZXN0ZikrXCI8L3RkPjwvdHI+XCI7XHRcdFx0XHRcdFxyXG5cdFx0XHRodG1sKz1cIjx0cj48dGQgY2xhc3M9J2xibCc+U3BlZWQ8L3RkPjx0ZCBjbGFzcz0ndmFsdWUnPlwiKyghaXNEdW1teSAmJiBldHh0MSA/IGV0eHQxIDogXCItXCIpICsgXCI8L3RkPjwvdHI+XCI7XHJcblx0XHRcdGh0bWwrPVwiPHRyPjx0ZCBjbGFzcz0nbGJsJz5BY2NlbGVyLjwvdGQ+PHRkIGNsYXNzPSd2YWx1ZSc+XCIrKCFpc0R1bW15ICYmIGV0eHQyID8gZXR4dDIgOiBcIi1cIikgK1wiPC90ZD48L3RyPlwiO1xyXG5cdFx0XHRodG1sKz1cIjx0ciBzdHlsZT0naGVpZ2h0OjEwMCUnPjx0ZD4mbmJzcDs8L3RkPjx0ZD4mbmJzcDs8L3RkPjwvdHI+XCI7XHJcblx0XHRcdGh0bWwrXCI8L3RhYmxlPlwiXHJcblx0XHRcdC8vaHRtbCs9XCI8ZGl2IGNsYXNzPSdwb3B1cF9zaGFkb3cnPlwiK3ByZXR0eUNvb3JkK2ltZ2RpditcIjwvZGl2PlwiO1xyXG5cdFx0XHRcclxuXHRcdFx0dmFyIHJhbms9XCItXCI7XHJcblx0XHRcdGlmICh0aGlzLl9fcG9zICE9IHVuZGVmaW5lZClcclxuXHRcdFx0XHRyYW5rPXRoaXMuX19wb3MgKyAxOyAgIC8vIHRoZSBmaXJzdCBwb3MgLSB0aGUgRkFTVEVTVCBpcyAwXHJcblx0XHRcdFxyXG5cdFx0XHRcclxuXHRcdFx0aHRtbD1cIjxkaXYgY2xhc3M9J3BvcHVwX2NvbnRlbnRfcHJnJz48ZGl2IHN0eWxlPSd3aWR0aDpcIitwMStcIiU7aGVpZ2h0OjZweDtiYWNrZ3JvdW5kLWNvbG9yOlwiK0NPTkZJRy5hcHBlYXJhbmNlLnRyYWNrQ29sb3JTd2ltK1wiO2Zsb2F0OmxlZnQ7Jz48L2Rpdj48ZGl2IHN0eWxlPSd3aWR0aDpcIitwMitcIiU7aGVpZ2h0OjZweDtiYWNrZ3JvdW5kLWNvbG9yOlwiK0NPTkZJRy5hcHBlYXJhbmNlLnRyYWNrQ29sb3JCaWtlK1wiO2Zsb2F0OmxlZnQ7Jz48L2Rpdj48ZGl2IHN0eWxlPSd3aWR0aDpcIitwMytcIiU7aGVpZ2h0OjZweDtiYWNrZ3JvdW5kLWNvbG9yOlwiK0NPTkZJRy5hcHBlYXJhbmNlLnRyYWNrQ29sb3JSdW4rXCI7ZmxvYXQ6bGVmdDsnPjwvZGl2PlwiO1xyXG5cdFx0XHRodG1sKz1cIjxkaXYgY2xhc3M9J3BvcHVwX3RyYWNrX3Bvcyc+PGRpdiBjbGFzcz0ncG9wdXBfdHJhY2tfcG9zXzEnIHN0eWxlPSdsZWZ0OlwiKyhlbGFwc2VkKjkwKStcIiUnPjwvZGl2PjwvZGl2PlwiO1xyXG5cdFx0XHRodG1sKz1cIjwvZGl2PlwiO1xyXG5cdFx0XHRodG1sKz1cIjxpbWcgY2xhc3M9J3BvcHVwX2NvbnRlbnRfaW1nJyBzcmM9J1wiK3RoaXMuZ2V0SW1hZ2UoKStcIicvPlwiO1xyXG5cdFx0XHRodG1sKz1cIjxkaXYgY2xhc3M9J3BvcHVwX2NvbnRlbnRfMSc+XCI7XHJcblx0XHRcdGh0bWwrPVwiPGRpdiBjbGFzcz0ncG9wdXBfY29udGVudF9uYW1lJz5cIitlc2NhcGVIVE1MKHRoaXMuZ2V0Q29kZSgpKStcIjwvZGl2PlwiO1xyXG5cdFx0XHRodG1sKz1cIjxkaXYgY2xhc3M9J3BvcHVwX2NvbnRlbnRfbDEnPlwiK3RoaXMuZ2V0Q291bnRyeSgpLnN1YnN0cmluZygwLDMpLnRvVXBwZXJDYXNlKCkrXCIgfCBQb3M6IFwiK3JhbmsrXCIgfCBTcGVlZDogXCIrKCFpc0R1bW15ICYmIGV0eHQxID8gZXR4dDEgOiBcIi1cIikrXCI8L2Rpdj5cIjtcclxuXHRcdFx0dmFyIHBhc3MgPSBNYXRoLnJvdW5kKCgobmV3IERhdGUoKSkuZ2V0VGltZSgpIC8gMTAwMCAvIDQpKSUyO1xyXG5cdFx0XHRpZiAocGFzcyA9PSAwKSB7XHJcblx0XHRcdFx0aWYgKHRoaXMuX19wb3MgIT0gdW5kZWZpbmVkKSBcclxuXHRcdFx0XHR7XHJcblx0XHRcdFx0XHRwYXJzZUZsb2F0KE1hdGgucm91bmQoZWxrbSAqIDEwMCkgLyAxMDApLnRvRml4ZWQoMik7XHJcblxyXG5cdFx0XHRcdFx0Ly8gdGhpcy5fX25leHQgaXMgdGhlIHBhcnRpY2lwYW50IGJlaGluZCB0aGlzIG9uZSAoZS5nIHRoZSBzbG93ZXIgb25lIHdpdGggbGVzdCBlbGFwc2VkIGluZGV4KVxyXG5cdFx0XHRcdFx0Ly8gYW5kIHRoaXMuX19wcmV2IGlzIHRoZSBvbmUgYmVmb3JlIHVzXHJcblx0XHRcdFx0XHQvLyBzbyBpZiBwYXJ0aWNpcGFudCBpcyBpbiBwb3NpdGlvbiAzIHRoZSBvbmUgYmVmb3JlIGhpbSB3aWxsIGJlIDIgYW5kIHRoZSBvbmUgYmVoaW5kIGhpbSB3aWxsIGJlIDRcclxuXHRcdFx0XHRcdC8vIChlLmcuIFwidGhpcy5fX3BvcyA9PSAzXCIgPT4gdGhpcy5fX3ByZXYuX19wb3MgPT0gMiBhbmQgdGhpcy5fX3ByZXYuX19uZXh0ID09IDRcclxuXHRcdFx0XHRcdC8vIGZvciB0aGVcclxuXHJcblx0XHRcdFx0XHRpZiAodGhpcy5fX3ByZXYgJiYgdGhpcy5fX3ByZXYuX19wb3MgIT0gdW5kZWZpbmVkICYmIHRoaXMuZ2V0U3BlZWQoKSkge1xyXG5cdFx0XHRcdFx0XHQvLyB3aGF0IGlzIHRoZSBkaWZmZXJlbmNlIGJldHdlZW4gY3VycmVudCBvbmUgYW5kIHRoZSBvbmUgYmVmb3JlIC0gd2Ugd2lsbCBydW4gc28gb3VyIHNwZWVkXHJcblx0XHRcdFx0XHRcdC8vIHdoYXQgdGltZSB3ZSBhcmUgc2hvcnQgLSBzbyB3aWxsIGFkZCBhIG1pbnVzIGluIGZyb250IG9mIHRoZSB0aW1lXHJcblx0XHRcdFx0XHRcdHZhciBlbGFwc2VkcHJldiA9IHRoaXMuX19wcmV2LmNhbGN1bGF0ZUVsYXBzZWRBdmVyYWdlKGN0aW1lKTtcclxuXHRcdFx0XHRcdFx0dmFyIGRwcmV2ID0gKChlbGFwc2VkcHJldiAtIGVsYXBzZWQpKnRoaXMudHJhY2suZ2V0VHJhY2tMZW5ndGgoKSAvIHRoaXMuZ2V0U3BlZWQoKSkvNjAuMDtcclxuXHRcdFx0XHRcdFx0ZHByZXYgPSBwYXJzZUZsb2F0KE1hdGgucm91bmQoZHByZXYgKiAxMDApIC8gMTAwKS50b0ZpeGVkKDIpO1xyXG5cdFx0XHRcdFx0XHRodG1sKz1cIjxkaXYgY2xhc3M9J3BvcHVwX2NvbnRlbnRfbDInPkdBUCBQXCIrKHRoaXMuX19wcmV2Ll9fcG9zICsgMSkrXCIgOiAtXCIrZHByZXYrXCIgTWluPC9kaXY+XCI7XHJcblx0XHRcdFx0XHR9IGVsc2Uge1xyXG5cdFx0XHRcdFx0XHRodG1sKz1cIjxkaXYgY2xhc3M9J3BvcHVwX2NvbnRlbnRfbDInPiZuYnNwOzwvZGl2PlwiO1xyXG5cdFx0XHRcdFx0fVxyXG5cclxuXHRcdFx0XHRcdGlmICh0aGlzLl9fbmV4dCAmJiB0aGlzLl9fbmV4dC5fX3BvcyAhPSB1bmRlZmluZWQgJiYgdGhpcy5fX25leHQuZ2V0U3BlZWQoKSkge1xyXG5cdFx0XHRcdFx0XHQvLyB3aGF0IGlzIHRoZSBkaWZmZXJlbmNlIGJldHdlZW4gY3VycmVudCBvbmUgYW5kIHRoZSBvbmUgYmVoaW5kIC0gdGhpcyBvdGhlciBvbmUgd2lsbCBydW4gc28gaGlzIHNwZWVkXHJcblx0XHRcdFx0XHRcdC8vIHdhaHQgdGltZSB3ZSBhcmUgYWhlYWQgLSBzbyBhIHBvc2l0aXZlIHRpbWVcclxuXHRcdFx0XHRcdFx0dmFyIGVsYXBzZWRuZXh0ID0gdGhpcy5fX25leHQuY2FsY3VsYXRlRWxhcHNlZEF2ZXJhZ2UoY3RpbWUpO1xyXG5cdFx0XHRcdFx0XHR2YXIgZG5leHQgPSAoKGVsYXBzZWQgLSBlbGFwc2VkbmV4dCkqdGhpcy50cmFjay5nZXRUcmFja0xlbmd0aCgpIC8gdGhpcy5fX25leHQuZ2V0U3BlZWQoKSkvNjAuMDtcclxuXHRcdFx0XHRcdFx0ZG5leHQgPSBwYXJzZUZsb2F0KE1hdGgucm91bmQoZG5leHQgKiAxMDApIC8gMTAwKS50b0ZpeGVkKDIpO1xyXG5cdFx0XHRcdFx0XHRodG1sKz1cIjxkaXYgY2xhc3M9J3BvcHVwX2NvbnRlbnRfbDMnPkdBUCBQXCIrKHRoaXMuX19uZXh0Ll9fcG9zICsgMSkrXCIgOiBcIitkbmV4dCtcIiBNaW48L2Rpdj5cIjtcclxuXHRcdFx0XHRcdH0gZWxzZSB7XHJcblx0XHRcdFx0XHRcdGh0bWwrPVwiPGRpdiBjbGFzcz0ncG9wdXBfY29udGVudF9sMic+Jm5ic3A7PC9kaXY+XCI7XHJcblx0XHRcdFx0XHR9XHJcblx0XHRcdFx0fVxyXG5cdFx0XHR9IGVsc2Uge1xyXG5cdFx0XHRcdGh0bWwrPVwiPGRpdiBjbGFzcz0ncG9wdXBfY29udGVudF9sMic+TU9SRSBUTyAgXCIrdHBhcnRNb3JlK1wiOiBcIisoaXNEdW1teSA/IFwiLVwiIDogcGFyc2VGbG9hdChNYXRoLnJvdW5kKCh0YXJnZXRLTS1lbGttKSAqIDEwMCkgLyAxMDApLnRvRml4ZWQoMikgLyogcmVrbSAqLyArXCIga21cIikrXCI8L2Rpdj5cIjtcclxuXHRcdFx0XHRodG1sKz1cIjxkaXYgY2xhc3M9J3BvcHVwX2NvbnRlbnRfbDMnPkZJTklTSCBcIisgdHBhcnRzICtcIjogXCIrKCFlc3RmID8gXCItXCIgOiBlc3RmKStcIjwvZGl2PlwiO1xyXG5cdFx0XHR9XHJcblx0XHRcdGh0bWwrPVwiPC9kaXY+XCI7XHJcblx0XHRcdHJldHVybiBodG1sO1xyXG5cdFx0fVxyXG5cdFx0XHJcblx0XHRcclxuICAgIH1cclxufSk7XHJcbiIsInJlcXVpcmUoJ2pvb3NlJyk7XHJcblxyXG5DbGFzcyhcIlBvaW50XCIsIHtcclxuICAgIC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuICAgIC8vIEFMTCBDT09SRElOQVRFUyBBUkUgSU4gV09STEQgTUVSQ0FUT1JcclxuICAgIC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHJcbiAgICBoYXMgOiB7XHJcbiAgICAgICAgY29kZSA6IHtcclxuICAgICAgICAgICAgaXMgOiBcInJ3XCIsXHJcbiAgICAgICAgICAgIGluaXQgOiBcIkNPREVfTk9UX1NFVFwiXHJcbiAgICAgICAgfSxcclxuICAgICAgICBpZCA6IHtcclxuICAgICAgICAgICAgaXMgOiBcInJ3XCIsXHJcbiAgICAgICAgICAgIGluaXQgOiBcIklEX05PVF9TRVRcIlxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgZmVhdHVyZSA6IHtcclxuICAgICAgICAgICAgaXMgOiBcInJ3XCIsXHJcbiAgICAgICAgICAgIGluaXQgOiBudWxsXHJcbiAgICAgICAgfSxcclxuICAgICAgICBwb3NpdGlvbiA6IHtcclxuICAgICAgICAgICAgaXM6ICAgXCJyd1wiLFxyXG4gICAgICAgICAgICBpbml0OiBbMCwwXVx0Ly9sb24gbGF0IHdvcmxkIG1lcmNhdG9yXHJcbiAgICAgICAgfVxyXG4gICAgfSxcclxuXHJcbiAgICBtZXRob2RzIDoge1xyXG4gICAgICAgIGluaXQgOiBmdW5jdGlvbihwb3MpIHtcclxuICAgICAgICAgICAgaWYgKHR5cGVvZiBvbCAhPSBcInVuZGVmaW5lZFwiKSB7XHJcbiAgICAgICAgICAgICAgICB2YXIgZ2VvbSA9IG5ldyBvbC5nZW9tLlBvaW50KHBvcyk7XHJcbiAgICAgICAgICAgICAgICBnZW9tLnRyYW5zZm9ybSgnRVBTRzo0MzI2JywgJ0VQU0c6Mzg1NycpO1xyXG4gICAgICAgICAgICAgICAgdmFyIGZlYXR1cmUgPSBuZXcgb2wuRmVhdHVyZSgpO1xyXG4gICAgICAgICAgICAgICAgZmVhdHVyZS5zZXRHZW9tZXRyeShnZW9tKTtcclxuICAgICAgICAgICAgICAgIHRoaXMuc2V0RmVhdHVyZShmZWF0dXJlKTtcclxuXHJcbiAgICAgICAgICAgICAgICB0aGlzLnNldFBvc2l0aW9uKHBvcyk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICB9XHJcbn0pOyIsInZhciBDT05GSUcgPSByZXF1aXJlKCcuL0NvbmZpZycpO1xyXG5cclxudmFyIFNUWUxFUz1cclxue1xyXG5cdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0Ly8gc3R5bGUgZnVuY3Rpb24gZm9yIHRyYWNrXHJcblx0Ly8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRcdFxyXG5cdFwiX3RyYWNrXCI6IGZ1bmN0aW9uKGZlYXR1cmUscmVzb2x1dGlvbikgXHJcblx0e1xyXG4gICAgICAgIHJldHVybiBbXHJcbiAgICAgICAgXTtcclxuXHR9LFxyXG5cclxuXHRcInRlc3RcIjogZnVuY3Rpb24oZmVhdHVyZSxyZXNvbHV0aW9uKSBcclxuXHR7XHJcblx0XHR2YXIgc3R5bGVzPVtdO1xyXG4gICAgICAgIHN0eWxlcy5wdXNoKG5ldyBvbC5zdHlsZS5TdHlsZSh7XHJcbiAgICAgICAgICAgIGltYWdlOiBuZXcgb2wuc3R5bGUuQ2lyY2xlKHtcclxuICAgICAgICAgICAgICAgIHJhZGl1czogMTcsXHJcbiAgICAgICAgICAgICAgICBmaWxsOiBuZXcgb2wuc3R5bGUuRmlsbCh7XHJcbiAgICAgICAgICAgICAgICAgICAgY29sb3I6IFwicmdiYSgyNTUsMjU1LDI1NSwwLjUpXCJcclxuICAgICAgICAgICAgICAgIH0pLFxyXG4gICAgICAgICAgICAgICAgc3Ryb2tlOiBuZXcgb2wuc3R5bGUuU3Ryb2tlKHtcclxuICAgICAgICAgICAgICAgICAgICBjb2xvcjogXCJyZ2JhKDI1NSwyNTUsMjU1LDEpXCIsXHJcbiAgICAgICAgICAgICAgICAgICAgd2lkdGg6IDNcclxuICAgICAgICAgICAgICAgIH0pXHJcbiAgICAgICAgICAgIH0pXHJcbiAgICAgICAgfSkpO1xyXG4gICAgICAgIHJldHVybiBzdHlsZXM7XHJcblx0fSxcclxuXHJcblx0XCJ0ZXN0MlwiOiBmdW5jdGlvbihmZWF0dXJlLHJlc29sdXRpb24pIFxyXG5cdHtcclxuXHRcdHZhciBzdHlsZXM9W107XHJcbiAgICAgICAgc3R5bGVzLnB1c2gobmV3IG9sLnN0eWxlLlN0eWxlKHtcclxuICAgICAgICAgICAgc3Ryb2tlOiBuZXcgb2wuc3R5bGUuU3Ryb2tlKHtcclxuICAgICAgICAgICAgICAgIGNvbG9yOiBcInJnYmEoMjU1LDI1NSwwLDEpXCIsXHJcbiAgICAgICAgICAgICAgICB3aWR0aDogM1xyXG4gICAgICAgICAgICB9KSxcclxuXHQgICAgICAgIGltYWdlOiBuZXcgb2wuc3R5bGUuQ2lyY2xlKHtcclxuXHQgICAgICAgICAgICByYWRpdXM6IDcsXHJcblx0ICAgICAgICAgICAgc3Ryb2tlOiBuZXcgb2wuc3R5bGUuU3Ryb2tlKHtcclxuXHQgICAgICAgICAgICBcdC8vZmVhdHVyZS5jb2xvclxyXG5cdCAgICAgICAgICAgICAgICBjb2xvcjogXCJyZ2JhKDI1NSwyNTUsMCwxKVwiLFxyXG5cdCAgICAgICAgICAgICAgICB3aWR0aDogM1xyXG5cdCAgICAgICAgICAgIH0pLFxyXG5cdCAgICAgICAgICAgIGZpbGw6IG5ldyBvbC5zdHlsZS5TdHJva2Uoe1xyXG5cdCAgICAgICAgICAgIFx0Ly9mZWF0dXJlLmNvbG9yXHJcblx0ICAgICAgICAgICAgICAgIGNvbG9yOiBcInJnYmEoMjU1LDI1NSwwLDAuNylcIixcclxuXHQgICAgICAgICAgICAgICAgd2lkdGg6IDNcclxuXHQgICAgICAgICAgICB9KVxyXG5cdCAgICAgICAgfSksXHJcblx0ICAgICAgICB0ZXh0OiBuZXcgb2wuc3R5bGUuVGV4dCh7XHJcblx0ICAgICAgICAgICAgZm9udDogJ2JvbGQgMTVweCBMYXRvLVJlZ3VsYXInLFxyXG5cdCAgICAgICAgICAgIGZpbGw6IG5ldyBvbC5zdHlsZS5GaWxsKHtcclxuXHQgICAgICAgICAgICAgICAgY29sb3I6ICdyZ2JhKDI1NSwyNTUsMCwxKSdcclxuXHQgICAgICAgICAgICB9KSxcclxuXHQgICAgICAgICAgICB0ZXh0OiBmZWF0dXJlLmdldEdlb21ldHJ5KCkgaW5zdGFuY2VvZiBvbC5nZW9tLlBvaW50ID8gKE1hdGgucm91bmQoZmVhdHVyZS5kZWJ1Z0luZm8udmFsdWUqMTAwKjEwMC4wKS8xMDAuMCkrXCIlXCIgOiBcIlwiLFxyXG5cdCAgICAgICAgICAgIG9mZnNldFg6ICAwLFxyXG5cdCAgICAgICAgICAgIG9mZnNldFkgOiAxNlxyXG5cdCAgICAgICAgfSlcclxuICAgICAgICB9KSk7XHJcbiAgICAgICAgcmV0dXJuIHN0eWxlcztcclxuXHR9LFxyXG5cclxuXHRcInRlc3QxXCI6IGZ1bmN0aW9uKGZlYXR1cmUscmVzb2x1dGlvbikgXHJcblx0e1xyXG5cdFx0dmFyIHN0eWxlcz1bXTtcclxuICAgICAgICBzdHlsZXMucHVzaChuZXcgb2wuc3R5bGUuU3R5bGUoe1xyXG4gICAgICAgICAgICAgc3Ryb2tlOiBuZXcgb2wuc3R5bGUuU3Ryb2tlKHtcclxuICAgICAgICAgICAgICAgICBjb2xvcjogXCJyZ2JhKDAsMCwwLDAuNClcIixcclxuICAgICAgICAgICAgICAgICB3aWR0aDogM1xyXG4gICAgICAgICAgICAgfSksXHJcblx0ICAgICAgICAgZmlsbDogbmV3IG9sLnN0eWxlLkZpbGwoe1xyXG5cdCAgICAgICAgICAgIGNvbG9yOiBcInJnYmEoNDAsMjU1LDQwLDAuMilcIlxyXG5cdCAgICAgICAgIH0pLFxyXG4gICAgICAgIH0pKTtcclxuICAgICAgICByZXR1cm4gc3R5bGVzO1xyXG5cdH0sXHJcblx0XCJ0cmFja1wiIDogZnVuY3Rpb24oZmVhdHVyZSxyZXNvbHV0aW9uKSBcclxuXHR7XHJcblx0XHR2YXIgc3R5bGVzPVtdO1xyXG5cdFx0dmFyIHRyYWNrPWZlYXR1cmUudHJhY2s7XHJcblx0XHRpZiAoIXRyYWNrKSB7XHJcblx0XHRcdGNvbnNvbGUubG9nKFwiUmVuZGVyaW5nIHRyYWNrIGZlYXR1cmUgd2l0aG91dCB0cmFjayBvYmplY3QhXCIpO1xyXG5cdFx0XHRyZXR1cm4gc3R5bGVzO1xyXG5cdFx0fVxyXG5cdFx0dmFyIGNvb3Jkcz1mZWF0dXJlLmdldEdlb21ldHJ5KCkuZ2V0Q29vcmRpbmF0ZXMoKTtcclxuXHRcdHZhciBnZW9tc3dpbT1jb29yZHM7XHJcblx0XHR2YXIgZ2VvbWJpa2U7XHJcblx0XHR2YXIgZ2VvbXJ1bjtcclxuXHRcdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdFx0XHJcblx0XHQvKnZhciB3dyA9IDguMC9yZXNvbHV0aW9uO1xyXG5cdFx0aWYgKHd3IDwgNi4wKVxyXG5cdFx0XHR3dz02LjA7Ki9cclxuXHRcdHZhciB3dz0xMC4wO1xyXG5cclxuXHRcdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdFx0aWYgKHRyYWNrICYmICFpc05hTih0cmFjay5iaWtlU3RhcnRLTSkpIFxyXG5cdFx0e1xyXG5cdFx0XHRmb3IgKHZhciBpPTA7aTx0cmFjay5kaXN0YW5jZXMubGVuZ3RoO2krKykge1xyXG5cdFx0XHRcdGlmICh0cmFjay5kaXN0YW5jZXNbaV0gPj0gdHJhY2suYmlrZVN0YXJ0S00qMTAwMCkge1xyXG5cdFx0XHRcdFx0YnJlYWs7XHJcblx0XHRcdFx0fVxyXG5cdFx0XHR9XHJcblx0XHRcdHZhciBqO1xyXG5cdFx0XHRpZiAoIWlzTmFOKHRyYWNrLnJ1blN0YXJ0S00pKSB7XHJcblx0XHRcdFx0Zm9yIChqPWk7ajx0cmFjay5kaXN0YW5jZXMubGVuZ3RoO2orKykge1xyXG5cdFx0XHRcdFx0aWYgKHRyYWNrLmRpc3RhbmNlc1tqXSA+PSB0cmFjay5ydW5TdGFydEtNKjEwMDApXHJcblx0XHRcdFx0XHRcdGJyZWFrO1xyXG5cdFx0XHRcdH1cclxuXHRcdFx0fSBlbHNlIHtcclxuXHRcdFx0XHRqPXRyYWNrLmRpc3RhbmNlcy5sZW5ndGg7XHJcblx0XHRcdH1cclxuXHRcdFx0Z2VvbXN3aW09Y29vcmRzLnNsaWNlKDAsaSk7XHJcblx0XHRcdGdlb21iaWtlPWNvb3Jkcy5zbGljZShpIDwgMSA/IGkgOiBpLTEsaik7XHJcblx0XHRcdGlmIChqIDwgdHJhY2suZGlzdGFuY2VzLmxlbmd0aClcclxuXHRcdFx0XHRnZW9tcnVuPWNvb3Jkcy5zbGljZShqIDwgMSA/IGogOiBqLTEsdHJhY2suZGlzdGFuY2VzLmxlbmd0aCk7XHJcblx0XHRcdGlmICghZ2VvbXN3aW0gfHwgIWdlb21zd2ltLmxlbmd0aClcclxuXHRcdFx0XHRnZW9tc3dpbT1udWxsO1xyXG5cdFx0XHRpZiAoIWdlb21iaWtlIHx8ICFnZW9tYmlrZS5sZW5ndGgpXHJcblx0XHRcdFx0Z2VvbWJpa2U9bnVsbDtcclxuXHRcdFx0aWYgKCFnZW9tcnVuIHx8ICFnZW9tcnVuLmxlbmd0aClcclxuICAgICAgICAgICAgICAgIGdlb21ydW49bnVsbDtcclxuXHRcdH1cclxuXHJcblxyXG4gICAgICAgIGlmIChnZW9tc3dpbSAmJiBHVUkuaXNTaG93U3dpbSkge1xyXG4gICAgICAgICAgICBzdHlsZXMucHVzaChuZXcgb2wuc3R5bGUuU3R5bGUoe1xyXG4gICAgICAgICAgICAgICAgICAgIGdlb21ldHJ5OiBuZXcgb2wuZ2VvbS5MaW5lU3RyaW5nKGdlb21zd2ltKSxcclxuICAgICAgICAgICAgICAgICAgICBzdHJva2U6IG5ldyBvbC5zdHlsZS5TdHJva2Uoe1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb2xvcjogQ09ORklHLmFwcGVhcmFuY2UudHJhY2tDb2xvclN3aW0sXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHdpZHRoOiB3d1xyXG4gICAgICAgICAgICAgICAgICAgIH0pXHJcbiAgICAgICAgICAgICAgICB9KVxyXG4gICAgICAgICAgICApO1xyXG4gICAgICAgICAgICBTVFlMRVMuX2dlbkRpcmVjdGlvbihnZW9tc3dpbSwgd3csIHJlc29sdXRpb24sIENPTkZJRy5hcHBlYXJhbmNlLnRyYWNrQ29sb3JTd2ltLCBzdHlsZXMpO1xyXG5cclxuICAgICAgICAgICAgU1RZTEVTLl9nZW5EaXN0YW5jZUttKHd3LCByZXNvbHV0aW9uLCBjb29yZHMsIHRyYWNrLmRpc3RhbmNlcywgMCwgaSwgc3R5bGVzKTtcclxuXHJcblx0XHRcdC8vIGZvciBub3cgZG9uJ3Qgc2hvdyB0aGlzIGNoZWNrcG9pbnRcclxuXHRcdFx0Ly9pZiAoR1VJLmlzU2hvd1N3aW0pXHJcblx0XHRcdC8vXHRTVFlMRVMuX2dlbkNoZWNrcG9pbnQoZ2VvbXN3aW0sIENPTkZJRy5hcHBlYXJhbmNlLnRyYWNrQ29sb3JTd2ltLCBzdHlsZXMpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBpZiAoZ2VvbWJpa2UgJiYgR1VJLmlzU2hvd0Jpa2UpXHJcbiAgICAgICAge1xyXG4gICAgICAgICAgICBzdHlsZXMucHVzaChuZXcgb2wuc3R5bGUuU3R5bGUoe1xyXG4gICAgICAgICAgICAgICAgICAgIGdlb21ldHJ5OiBuZXcgb2wuZ2VvbS5MaW5lU3RyaW5nKGdlb21iaWtlKSxcclxuICAgICAgICAgICAgICAgICAgICBzdHJva2U6IG5ldyBvbC5zdHlsZS5TdHJva2Uoe1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb2xvcjogQ09ORklHLmFwcGVhcmFuY2UudHJhY2tDb2xvckJpa2UsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHdpZHRoOiB3d1xyXG4gICAgICAgICAgICAgICAgICAgIH0pXHJcbiAgICAgICAgICAgICAgICB9KVxyXG4gICAgICAgICAgICApO1xyXG4gICAgICAgICAgICBTVFlMRVMuX2dlbkRpcmVjdGlvbihnZW9tYmlrZSwgd3csIHJlc29sdXRpb24sIENPTkZJRy5hcHBlYXJhbmNlLnRyYWNrQ29sb3JCaWtlLCBzdHlsZXMpO1xyXG5cclxuICAgICAgICAgICAgU1RZTEVTLl9nZW5EaXN0YW5jZUttKHd3LCByZXNvbHV0aW9uLCBjb29yZHMsIHRyYWNrLmRpc3RhbmNlcywgaSwgaiwgc3R5bGVzKTtcclxuXHJcblx0XHRcdC8vIGFkZCBjaGVja3BvaW50IGlmIHRoaXMgaXMgbm90IGFscmVhZHkgYWRkZWQgYXMgYSBob3RzcG90XHJcblx0XHRcdGlmICghdHJhY2suaXNBZGRlZEhvdFNwb3RTd2ltQmlrZSkge1xyXG5cdFx0XHRcdGlmIChDT05GSUcuYXBwZWFyYW5jZS5pc1Nob3dDaGVja3BvaW50SW1hZ2UpXHJcblx0XHRcdFx0XHRTVFlMRVMuX2dlbkNoZWNrcG9pbnRJbWFnZShnZW9tYmlrZSwgQ09ORklHLmFwcGVhcmFuY2UuaW1hZ2VDaGVja3BvaW50U3dpbUJpa2UsIHN0eWxlcyk7XHJcblx0XHRcdFx0ZWxzZSBpZiAoQ09ORklHLmFwcGVhcmFuY2UuaXNTaG93Q2hlY2twb2ludCAmJiBHVUkuaXNTaG93QmlrZSlcclxuXHRcdFx0XHRcdFNUWUxFUy5fZ2VuQ2hlY2twb2ludChnZW9tYmlrZSwgQ09ORklHLmFwcGVhcmFuY2UudHJhY2tDb2xvckJpa2UsIHN0eWxlcyk7XHJcblx0XHRcdH1cclxuICAgICAgICB9XHJcblx0XHRpZiAoZ2VvbXJ1biAmJiBHVUkuaXNTaG93UnVuKVxyXG5cdFx0e1xyXG5cdFx0XHRzdHlsZXMucHVzaChuZXcgb2wuc3R5bGUuU3R5bGUoe1xyXG4gICAgICAgICAgICAgICAgICAgIGdlb21ldHJ5OiBuZXcgb2wuZ2VvbS5MaW5lU3RyaW5nKGdlb21ydW4pLFxyXG4gICAgICAgICAgICAgICAgICAgIHN0cm9rZTogbmV3IG9sLnN0eWxlLlN0cm9rZSh7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbG9yOiBDT05GSUcuYXBwZWFyYW5jZS50cmFja0NvbG9yUnVuLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICB3aWR0aDogd3dcclxuICAgICAgICAgICAgICAgICAgICB9KVxyXG4gICAgICAgICAgICAgICAgfSlcclxuICAgICAgICAgICAgKTtcclxuICAgICAgICAgICAgU1RZTEVTLl9nZW5EaXJlY3Rpb24oZ2VvbXJ1biwgd3csIHJlc29sdXRpb24sIENPTkZJRy5hcHBlYXJhbmNlLnRyYWNrQ29sb3JSdW4sIHN0eWxlcyk7XHJcblxyXG4gICAgICAgICAgICBTVFlMRVMuX2dlbkRpc3RhbmNlS20od3csIHJlc29sdXRpb24sIGNvb3JkcywgdHJhY2suZGlzdGFuY2VzLCBqLCB0cmFjay5kaXN0YW5jZXMubGVuZ3RoLCBzdHlsZXMpO1xyXG5cclxuXHRcdFx0Ly8gYWRkIGNoZWNrcG9pbnQgaWYgdGhpcyBpcyBub3QgYWxyZWFkeSBhZGRlZCBhcyBhIGhvdHNwb3RcclxuXHRcdFx0aWYgKCF0cmFjay5pc0FkZGVkSG90U3BvdEJpa2VSdW4pIHtcclxuXHRcdFx0XHRpZiAoQ09ORklHLmFwcGVhcmFuY2UuaXNTaG93Q2hlY2twb2ludEltYWdlKVxyXG5cdFx0XHRcdFx0U1RZTEVTLl9nZW5DaGVja3BvaW50SW1hZ2UoZ2VvbXJ1biwgQ09ORklHLmFwcGVhcmFuY2UuaW1hZ2VDaGVja3BvaW50QmlrZVJ1biwgc3R5bGVzKTtcclxuXHRcdFx0XHRlbHNlIGlmIChDT05GSUcuYXBwZWFyYW5jZS5pc1Nob3dDaGVja3BvaW50ICYmIEdVSS5pc1Nob3dCaWtlKVxyXG5cdFx0XHRcdFx0U1RZTEVTLl9nZW5DaGVja3BvaW50KGdlb21ydW4sIENPTkZJRy5hcHBlYXJhbmNlLnRyYWNrQ29sb3JSdW4sIHN0eWxlcyk7XHJcblx0XHRcdH1cclxuICAgICAgICB9XHJcblxyXG5cdFx0Ly8gU1RBUlQtRklOSVNIIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0XHRpZiAoY29vcmRzICYmIGNvb3Jkcy5sZW5ndGggPj0gMilcclxuXHRcdHtcclxuXHRcdFx0dmFyIHN0YXJ0ID0gY29vcmRzWzBdO1xyXG5cdFx0XHR2YXIgZW5kID0gY29vcmRzWzFdO1xyXG5cdFx0XHQvKnZhciBkeCA9IGVuZFswXSAtIHN0YXJ0WzBdO1xyXG5cdFx0XHQgdmFyIGR5ID0gZW5kWzFdIC0gc3RhcnRbMV07XHJcblx0XHRcdCB2YXIgcm90YXRpb24gPSBNYXRoLmF0YW4yKGR5LCBkeCk7XHJcblx0XHRcdCBzdHlsZXMucHVzaChuZXcgb2wuc3R5bGUuU3R5bGUoXHJcblx0XHRcdCB7XHJcblx0XHRcdCBnZW9tZXRyeTogbmV3IG9sLmdlb20uUG9pbnQoc3RhcnQpLFxyXG5cdFx0XHQgaW1hZ2U6IG5ldyBvbC5zdHlsZS5JY29uKHtcclxuXHRcdFx0IHNyYzogJ2ltZy9iZWdpbi1lbmQtYXJyb3cucG5nJyxcclxuXHRcdFx0IHNjYWxlIDogMC40NSxcclxuXHRcdFx0IGFuY2hvcjogWzAuMCwgMC41XSxcclxuXHRcdFx0IHJvdGF0ZVdpdGhWaWV3OiB0cnVlLFxyXG5cdFx0XHQgcm90YXRpb246IC1yb3RhdGlvbixcclxuXHRcdFx0IG9wYWNpdHkgOiAxXHJcblx0XHRcdCB9KVxyXG5cdFx0XHQgfSkpOyovXHJcblxyXG5cdFx0XHQvLyBsb29wP1xyXG5cdFx0XHRlbmQgPSBjb29yZHNbY29vcmRzLmxlbmd0aC0xXTtcclxuXHRcdFx0aWYgKGVuZFswXSAhPSBzdGFydFswXSB8fCBlbmRbMV0gIT0gc3RhcnRbMV0pXHJcblx0XHRcdHtcclxuXHRcdFx0XHR2YXIgc3RhcnQgPSBjb29yZHNbY29vcmRzLmxlbmd0aC0yXTtcclxuXHRcdFx0XHR2YXIgZHggPSBlbmRbMF0gLSBzdGFydFswXTtcclxuXHRcdFx0XHR2YXIgZHkgPSBlbmRbMV0gLSBzdGFydFsxXTtcclxuXHRcdFx0XHR2YXIgcm90YXRpb24gPSBNYXRoLmF0YW4yKGR5LCBkeCk7XHJcblx0XHRcdFx0c3R5bGVzLnB1c2gobmV3IG9sLnN0eWxlLlN0eWxlKFxyXG5cdFx0XHRcdFx0e1xyXG5cdFx0XHRcdFx0XHRnZW9tZXRyeTogbmV3IG9sLmdlb20uUG9pbnQoZW5kKSxcclxuXHRcdFx0XHRcdFx0aW1hZ2U6IG5ldyBvbC5zdHlsZS5JY29uKHtcclxuXHRcdFx0XHRcdFx0XHRzcmM6IENPTkZJRy5hcHBlYXJhbmNlLmltYWdlRmluaXNoLFxyXG5cdFx0XHRcdFx0XHRcdHNjYWxlIDogMC40NSxcclxuXHRcdFx0XHRcdFx0XHRhbmNob3I6IFswLjUsIDAuNV0sXHJcblx0XHRcdFx0XHRcdFx0cm90YXRlV2l0aFZpZXc6IHRydWUsXHJcblx0XHRcdFx0XHRcdFx0Ly9yb3RhdGlvbjogLXJvdGF0aW9uLFxyXG5cdFx0XHRcdFx0XHRcdG9wYWNpdHkgOiAxXHJcblx0XHRcdFx0XHRcdH0pXHJcblx0XHRcdFx0XHR9KSk7XHJcblx0XHRcdH1cclxuXHRcdH1cclxuXHJcblx0XHRyZXR1cm4gc3R5bGVzO1xyXG5cdH0sXHJcblx0Ly8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdFwiZGVidWdHUFNcIiA6IGZ1bmN0aW9uKGZlYXR1cmUscmVzb2x1dGlvbikgXHJcblx0e1xyXG5cdFx0dmFyIGNvZWYgPSAoKG5ldyBEYXRlKCkpLmdldFRpbWUoKS1mZWF0dXJlLnRpbWVDcmVhdGVkKS8oQ09ORklHLnRpbWVvdXRzLmdwc0xvY2F0aW9uRGVidWdTaG93KjEwMDApO1xyXG5cdFx0aWYgKGNvZWYgPiAxKVxyXG5cdFx0XHRyZXR1cm4gW107XHJcblx0XHRyZXR1cm4gW1xyXG5cdFx0ICAgICAgICBuZXcgb2wuc3R5bGUuU3R5bGUoe1xyXG5cdFx0ICAgICAgICBpbWFnZTogbmV3IG9sLnN0eWxlLkNpcmNsZSh7XHJcblx0XHQgICAgICAgICAgICByYWRpdXM6IGNvZWYqMjAsXHJcblx0XHQgICAgICAgICAgICBzdHJva2U6IG5ldyBvbC5zdHlsZS5TdHJva2Uoe1xyXG5cdFx0ICAgICAgICAgICAgXHQvL2ZlYXR1cmUuY29sb3JcclxuXHRcdCAgICAgICAgICAgICAgICBjb2xvcjogY29sb3JBbHBoYUFycmF5KGZlYXR1cmUuY29sb3IsKDEuMC1jb2VmKSoxLjApLCBcclxuXHRcdCAgICAgICAgICAgICAgICB3aWR0aDogNFxyXG5cdFx0ICAgICAgICAgICAgfSlcclxuXHRcdCAgICAgICAgICB9KVxyXG5cdFx0fSldO1xyXG5cdH0sXHJcblx0XHJcblx0XCJwYXJ0aWNpcGFudFwiIDogZnVuY3Rpb24oZmVhdHVyZSxyZXNvbHV0aW9uKSBcclxuXHR7XHJcblx0XHQvLyBTS0lQIERSQVcgKFRPRE8gT1BUSU1JWkUpXHJcblx0XHR2YXIgcGFydCA9IGZlYXR1cmUucGFydGljaXBhbnQ7XHJcblx0XHRpZiAoIXBhcnQuaXNGYXZvcml0ZSlcclxuXHRcdFx0cmV0dXJuIFtdO1xyXG5cdFx0XHJcblx0XHR2YXIgZXR4dD1cIlwiO1xyXG5cdFx0dmFyIGxzdGF0ZSA9IG51bGw7XHJcblx0XHRpZiAocGFydC5zdGF0ZXMubGVuZ3RoKSB7XHJcblx0XHRcdGxzdGF0ZSA9IHBhcnQuc3RhdGVzW3BhcnQuc3RhdGVzLmxlbmd0aC0xXTtcclxuXHRcdFx0ZXR4dD1cIiBcIitwYXJzZUZsb2F0KE1hdGguY2VpbChsc3RhdGUuZ2V0U3BlZWQoKSAqIDEwMCkgLyAxMDApLnRvRml4ZWQoMikrXCIgbS9zXCI7Ly8gfCBhY2MgXCIrcGFyc2VGbG9hdChNYXRoLmNlaWwobHN0YXRlLmdldEFjY2VsZXJhdGlvbigpICogMTAwKSAvIDEwMCkudG9GaXhlZCgyKStcIiBtL3NcIjtcclxuXHRcdH1cclxuXHRcdHZhciB6SW5kZXggPSBNYXRoLnJvdW5kKHBhcnQuZ2V0RWxhcHNlZCgpKjEwMDAwMDApKjEwMDArcGFydC5zZXFJZDtcclxuXHRcdC8qaWYgKHBhcnQgPT0gR1VJLmdldFNlbGVjdGVkUGFydGljaXBhbnQoKSkge1xyXG5cdFx0XHR6SW5kZXg9MWUyMDtcclxuXHRcdH0qL1xyXG5cdFx0dmFyIHN0eWxlcz1bXTtcclxuXHRcdC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHRcdHZhciBjdGltZSA9IChuZXcgRGF0ZSgpKS5nZXRUaW1lKCk7XHJcblx0XHR2YXIgaXNUaW1lID0gKGN0aW1lID49IENPTkZJRy50aW1lcy5iZWdpbiAmJiBjdGltZSA8PSBDT05GSUcudGltZXMuZW5kKTtcclxuXHRcdHZhciBpc0RpcmVjdGlvbiA9IChsc3RhdGUgJiYgbHN0YXRlLmdldFNwZWVkKCkgPiAwICYmICFwYXJ0LmlzU09TICYmICFwYXJ0LmlzRGlzY2FyZGVkICYmIGlzVGltZSk7XHJcblx0XHR2YXIgYW5pbUZyYW1lID0gKGN0aW1lJTMwMDApKk1hdGguUEkqMi8zMDAwLjA7XHJcblxyXG4gICAgICAgIGlmIChpc1RpbWUpIHtcclxuICAgICAgICAgICAgc3R5bGVzLnB1c2gobmV3IG9sLnN0eWxlLlN0eWxlKHtcclxuICAgICAgICAgICAgICAgIHpJbmRleDogekluZGV4LFxyXG4gICAgICAgICAgICAgICAgaW1hZ2U6IG5ldyBvbC5zdHlsZS5DaXJjbGUoe1xyXG4gICAgICAgICAgICAgICAgICAgIHJhZGl1czogMTcsXHJcbiAgICAgICAgICAgICAgICAgICAgZmlsbDogbmV3IG9sLnN0eWxlLkZpbGwoe1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb2xvcjogcGFydC5pc0Rpc2NhcmRlZCB8fCBwYXJ0LmlzU09TID8gXCJyZ2JhKDE5MiwwLDAsXCIgKyAoTWF0aC5zaW4oYW5pbUZyYW1lKSAqIDAuNyArIDAuMykgKyBcIilcIiA6IFwicmdiYShcIiArIGNvbG9yQWxwaGFBcnJheShwYXJ0LmNvbG9yLCAwLjg1KS5qb2luKFwiLFwiKSArIFwiKVwiXHJcbiAgICAgICAgICAgICAgICAgICAgfSksXHJcbiAgICAgICAgICAgICAgICAgICAgc3Ryb2tlOiBuZXcgb2wuc3R5bGUuU3Ryb2tlKHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29sb3I6IHBhcnQuaXNEaXNjYXJkZWQgfHwgcGFydC5pc1NPUyA/IFwicmdiYSgyNTUsMCwwLFwiICsgKDEuMCAtIChNYXRoLnNpbihhbmltRnJhbWUpICogMC43ICsgMC4zKSkgKyBcIilcIiA6IFwiI2ZmZmZmZlwiLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICB3aWR0aDogM1xyXG4gICAgICAgICAgICAgICAgICAgIH0pXHJcbiAgICAgICAgICAgICAgICB9KSxcclxuICAgICAgICAgICAgICAgIHRleHQ6IG5ldyBvbC5zdHlsZS5UZXh0KHtcclxuICAgICAgICAgICAgICAgICAgICBmb250OiAnbm9ybWFsIDEzcHggTGF0by1SZWd1bGFyJyxcclxuICAgICAgICAgICAgICAgICAgICBmaWxsOiBuZXcgb2wuc3R5bGUuRmlsbCh7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbG9yOiAnI0ZGRkZGRidcclxuICAgICAgICAgICAgICAgICAgICB9KSxcclxuICAgICAgICAgICAgICAgICAgICB0ZXh0OiBwYXJ0LmdldEluaXRpYWxzKCksXHJcbiAgICAgICAgICAgICAgICAgICAgb2Zmc2V0WDogMCxcclxuICAgICAgICAgICAgICAgICAgICBvZmZzZXRZOiAwXHJcbiAgICAgICAgICAgICAgICB9KVxyXG4gICAgICAgICAgICB9KSk7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgc3R5bGVzLnB1c2gobmV3IG9sLnN0eWxlLlN0eWxlKHtcclxuICAgICAgICAgICAgICAgIHpJbmRleDogekluZGV4LFxyXG4gICAgICAgICAgICAgICAgaW1hZ2U6IG5ldyBvbC5zdHlsZS5DaXJjbGUoe1xyXG4gICAgICAgICAgICAgICAgICAgIHJhZGl1czogMTcsXHJcbiAgICAgICAgICAgICAgICAgICAgZmlsbDogbmV3IG9sLnN0eWxlLkZpbGwoe1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb2xvcjogXCJyZ2JhKFwiICsgY29sb3JBbHBoYUFycmF5KHBhcnQuY29sb3IsIDAuMzUpLmpvaW4oXCIsXCIpICsgXCIpXCJcclxuICAgICAgICAgICAgICAgICAgICB9KSxcclxuICAgICAgICAgICAgICAgICAgICBzdHJva2U6IG5ldyBvbC5zdHlsZS5TdHJva2Uoe1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb2xvcjogXCJyZ2JhKDI1NSwyNTUsMjU1LDEpXCIsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHdpZHRoOiAzXHJcbiAgICAgICAgICAgICAgICAgICAgfSlcclxuICAgICAgICAgICAgICAgIH0pLFxyXG4gICAgICAgICAgICAgICAgdGV4dDogbmV3IG9sLnN0eWxlLlRleHQoe1xyXG4gICAgICAgICAgICAgICAgICAgIGZvbnQ6ICdub3JtYWwgMTNweCBMYXRvLVJlZ3VsYXInLFxyXG4gICAgICAgICAgICAgICAgICAgIGZpbGw6IG5ldyBvbC5zdHlsZS5GaWxsKHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29sb3I6ICcjMDAwMDAwJ1xyXG4gICAgICAgICAgICAgICAgICAgIH0pLFxyXG4gICAgICAgICAgICAgICAgICAgIHRleHQ6IHBhcnQuZ2V0RGV2aWNlSWQoKSxcclxuICAgICAgICAgICAgICAgICAgICBvZmZzZXRYOiAwLFxyXG4gICAgICAgICAgICAgICAgICAgIG9mZnNldFk6IDIwXHJcbiAgICAgICAgICAgICAgICB9KVxyXG4gICAgICAgICAgICB9KSk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuICAgICAgICBzdHlsZXMucHVzaChuZXcgb2wuc3R5bGUuU3R5bGUoe1xyXG4gICAgICAgICAgICB6SW5kZXg6IHpJbmRleCxcclxuICAgICAgICAgICAgaW1hZ2U6IG5ldyBvbC5zdHlsZS5DaXJjbGUoe1xyXG4gICAgICAgICAgICAgICAgcmFkaXVzOiAxNyxcclxuICAgICAgICAgICAgICAgIGZpbGw6IG5ldyBvbC5zdHlsZS5GaWxsKHtcclxuICAgICAgICAgICAgICAgICAgICBjb2xvcjogcGFydC5pc0Rpc2NhcmRlZCB8fCBwYXJ0LmlzU09TID8gXCJyZ2JhKDE5MiwwLDAsXCIgKyAoTWF0aC5zaW4oYW5pbUZyYW1lKSAqIDAuNyArIDAuMykgKyBcIilcIiA6IFwicmdiYShcIiArIGNvbG9yQWxwaGFBcnJheShwYXJ0LmNvbG9yLCAwLjg1KS5qb2luKFwiLFwiKSArIFwiKVwiXHJcbiAgICAgICAgICAgICAgICB9KSxcclxuICAgICAgICAgICAgICAgIHN0cm9rZTogbmV3IG9sLnN0eWxlLlN0cm9rZSh7XHJcbiAgICAgICAgICAgICAgICAgICAgY29sb3I6IHBhcnQuaXNEaXNjYXJkZWQgfHwgcGFydC5pc1NPUyA/IFwicmdiYSgyNTUsMCwwLFwiICsgKDEuMCAtIChNYXRoLnNpbihhbmltRnJhbWUpICogMC43ICsgMC4zKSkgKyBcIilcIiA6IFwiI2ZmZmZmZlwiLFxyXG4gICAgICAgICAgICAgICAgICAgIHdpZHRoOiAzXHJcbiAgICAgICAgICAgICAgICB9KVxyXG4gICAgICAgICAgICB9KSxcclxuICAgICAgICAgICAgdGV4dDogbmV3IG9sLnN0eWxlLlRleHQoe1xyXG4gICAgICAgICAgICAgICAgZm9udDogJ25vcm1hbCAxM3B4IExhdG8tUmVndWxhcicsXHJcbiAgICAgICAgICAgICAgICBmaWxsOiBuZXcgb2wuc3R5bGUuRmlsbCh7XHJcbiAgICAgICAgICAgICAgICAgICAgY29sb3I6ICcjRkZGRkZGJ1xyXG4gICAgICAgICAgICAgICAgfSksXHJcbiAgICAgICAgICAgICAgICB0ZXh0OiBwYXJ0LmdldEluaXRpYWxzKCksXHJcbiAgICAgICAgICAgICAgICBvZmZzZXRYOiAwLFxyXG4gICAgICAgICAgICAgICAgb2Zmc2V0WTogMFxyXG4gICAgICAgICAgICB9KVxyXG4gICAgICAgIH0pKTtcclxuXHJcblxyXG4gICAgICAgIGlmIChpc0RpcmVjdGlvbiAmJiBwYXJ0LmdldFJvdGF0aW9uKCkgIT0gbnVsbClcclxuICAgICAgICB7XHJcbiAgICAgICAgICAgIHN0eWxlcy5wdXNoKG5ldyBvbC5zdHlsZS5TdHlsZSh7XHJcbiAgICAgICAgICAgICAgICB6SW5kZXg6IHpJbmRleCxcclxuICAgICAgICAgICAgICAgIGltYWdlOiBuZXcgb2wuc3R5bGUuSWNvbigoe1xyXG4gICAgICAgICAgICAgICAgICAgIGFuY2hvcjogWy0wLjUsMC41XSxcclxuICAgICAgICAgICAgICAgICAgICBhbmNob3JYVW5pdHM6ICdmcmFjdGlvbicsXHJcbiAgICAgICAgICAgICAgICAgICAgYW5jaG9yWVVuaXRzOiAnZnJhY3Rpb24nLFxyXG4gICAgICAgICAgICAgICAgICAgIG9wYWNpdHk6IDEsXHJcbiAgICAgICAgICAgICAgICAgICAgc3JjIDogcmVuZGVyQXJyb3dCYXNlNjQoNDgsNDgscGFydC5jb2xvciksXHJcblx0XHRcdFx0XHQgIHNjYWxlIDogMC41NSxcclxuXHRcdFx0XHRcdCAgcm90YXRpb24gOiAtcGFydC5nZXRSb3RhdGlvbigpXHJcblx0XHRcdFx0ICAgfSkpXHJcblx0XHRcdH0pKTtcclxuXHRcdH1cclxuICAgICAgICBcclxuXHRcdC8qdmFyIGNvZWYgPSBwYXJ0LnRyYWNrLmdldFRyYWNrTGVuZ3RoSW5XR1M4NCgpL3BhcnQudHJhY2suZ2V0VHJhY2tMZW5ndGgoKTtcdFx0XHJcblx0XHR2YXIgcnIgPSBDT05GSUcubWF0aC5ncHNJbmFjY3VyYWN5KmNvZWY7XHRcdFxyXG4gICAgICAgIHN0eWxlcy5wdXNoKG5ldyBvbC5zdHlsZS5TdHlsZSh7XHJcbiAgICAgICAgICAgIHpJbmRleDogekluZGV4LFxyXG4gICAgICAgICAgICBpbWFnZTogbmV3IG9sLnN0eWxlLkNpcmNsZSh7XHJcbiAgICAgICAgICAgIFx0Z2VvbWV0cnk6IG5ldyBvbC5nZW9tLlBvaW50KHBhcnQuZ2V0R1BTKCkpLFxyXG4gICAgICAgICAgICAgICAgcmFkaXVzOiAxMCwgLy9yciAqIHJlc29sdXRpb24sXHJcbiAgICAgICAgICAgICAgICBmaWxsOiBuZXcgb2wuc3R5bGUuRmlsbCh7XHJcbiAgICAgICAgICAgICAgICAgICAgY29sb3I6IFwicmdiYSgyNTUsMjU1LDI1NSwwLjgpXCJcclxuICAgICAgICAgICAgICAgIH0pLFxyXG4gICAgICAgICAgICAgICAgc3Ryb2tlOiBuZXcgb2wuc3R5bGUuU3Ryb2tlKHtcclxuICAgICAgICAgICAgICAgICAgICBjb2xvcjogXCJyZ2JhKDAsMCwwLDEpXCIsXHJcbiAgICAgICAgICAgICAgICAgICAgd2lkdGg6IDFcclxuICAgICAgICAgICAgICAgIH0pXHJcbiAgICAgICAgICAgIH0pXHJcbiAgICAgICAgfSkpOyovXHJcblx0XHRyZXR1cm4gc3R5bGVzO1xyXG5cdH0sXHJcblxyXG5cdFwiY2FtXCIgOiBmdW5jdGlvbihmZWF0dXJlLCByZXNvbHV0aW9uKSB7XHJcblx0XHR2YXIgc3R5bGVzPVtdO1xyXG5cclxuXHRcdHZhciBjYW0gPSBmZWF0dXJlLmNhbTtcclxuXHJcblx0XHRzdHlsZXMucHVzaChuZXcgb2wuc3R5bGUuU3R5bGUoe1xyXG5cdFx0XHRpbWFnZTogbmV3IG9sLnN0eWxlLkljb24oKHtcclxuXHRcdFx0XHQvLyBUT0RPIFJ1bWVuIC0gaXQncyBiZXR0ZXIgYWxsIGltYWdlcyB0byBiZSB0aGUgc2FtZSBzaXplLCBzbyB0aGUgc2FtZSBzY2FsZVxyXG5cdFx0XHRcdHNjYWxlIDogMC4wNDAsXHJcblx0XHRcdFx0c3JjIDogQ09ORklHLmFwcGVhcmFuY2UuaW1hZ2VDYW0uc3BsaXQoXCIuc3ZnXCIpLmpvaW4oKGNhbS5zZXFJZCsxKSArIFwiLnN2Z1wiKVxyXG5cdFx0XHR9KSlcclxuXHRcdH0pKTtcclxuXHJcblx0XHRyZXR1cm4gc3R5bGVzO1xyXG5cdH0sXHJcblxyXG4gICAgXCJob3RzcG90XCIgOiBmdW5jdGlvbihmZWF0dXJlLCByZXNvbHV0aW9uKSB7XHJcbiAgICAgICAgdmFyIHN0eWxlcz1bXTtcclxuXHJcbiAgICAgICAgdmFyIGhvdHNwb3QgPSBmZWF0dXJlLmhvdHNwb3Q7XHJcblxyXG4gICAgICAgIHN0eWxlcy5wdXNoKG5ldyBvbC5zdHlsZS5TdHlsZSh7XHJcbiAgICAgICAgICAgIGltYWdlOiBuZXcgb2wuc3R5bGUuSWNvbigoe1xyXG4gICAgICAgICAgICAgICAgc2NhbGUgOiBob3RzcG90LmdldFR5cGUoKS5zY2FsZSB8fCAxLFxyXG4gICAgICAgICAgICAgICAgc3JjIDogaG90c3BvdC5nZXRUeXBlKCkuaW1hZ2VcclxuICAgICAgICAgICAgfSkpXHJcbiAgICAgICAgfSkpO1xyXG5cclxuICAgICAgICByZXR1cm4gc3R5bGVzO1xyXG4gICAgfSxcclxuXHJcblx0Ly8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHQvLyBQcml2YXRlIG1ldGhvZHNcclxuXHQvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cclxuXHRfdHJhY2tTZWxlY3RlZCA6IG5ldyBvbC5zdHlsZS5TdHlsZSh7XHJcblx0XHRzdHJva2U6IG5ldyBvbC5zdHlsZS5TdHJva2Uoe1xyXG5cdFx0XHRjb2xvcjogJyNGRjUwNTAnLFxyXG5cdFx0XHR3aWR0aDogNC41XHJcblx0XHR9KVxyXG5cdH0pLFxyXG5cclxuXHRfZ2VuQ2hlY2twb2ludCA6IGZ1bmN0aW9uKGdlb21ldHJ5LCBjb2xvciwgc3R5bGVzKSB7XHJcblx0XHR2YXIgc3RhcnQgPSBnZW9tZXRyeVswXTtcclxuXHRcdHZhciBlbmQgPSBnZW9tZXRyeVsxXTtcclxuXHRcdHZhciBkeCA9IGVuZFswXSAtIHN0YXJ0WzBdO1xyXG5cdFx0dmFyIGR5ID0gZW5kWzFdIC0gc3RhcnRbMV07XHJcblx0XHR2YXIgcm90YXRpb24gPSBNYXRoLmF0YW4yKGR5LCBkeCk7XHJcblxyXG5cdFx0c3R5bGVzLnB1c2gobmV3IG9sLnN0eWxlLlN0eWxlKHtcclxuXHRcdFx0Z2VvbWV0cnk6IG5ldyBvbC5nZW9tLlBvaW50KHN0YXJ0KSxcclxuXHRcdFx0aW1hZ2U6IG5ldyBvbC5zdHlsZS5JY29uKHtcclxuXHRcdFx0XHRzcmM6IHJlbmRlckJveEJhc2U2NCgxNiwxNixjb2xvciksXHJcblx0XHRcdFx0c2NhbGUgOiAxLFxyXG5cdFx0XHRcdGFuY2hvcjogWzAuOTIsIDAuNV0sXHJcblx0XHRcdFx0cm90YXRlV2l0aFZpZXc6IHRydWUsXHJcblx0XHRcdFx0cm90YXRpb246IC1yb3RhdGlvbixcclxuXHRcdFx0XHRvcGFjaXR5IDogMC42NVxyXG5cdFx0XHR9KVxyXG5cdFx0fSkpO1xyXG5cdH0sXHJcblxyXG5cdF9nZW5DaGVja3BvaW50SW1hZ2UgOiBmdW5jdGlvbihnZW9tZXRyeSwgaW1hZ2UsIHN0eWxlcykge1xyXG5cdFx0dmFyIHN0YXJ0ID0gZ2VvbWV0cnlbMF07XHJcblx0XHQvL3ZhciBlbmQgPSBnZW9tZXRyeVsxXTtcclxuXHRcdC8vdmFyIGR4ID0gZW5kWzBdIC0gc3RhcnRbMF07XHJcblx0XHQvL3ZhciBkeSA9IGVuZFsxXSAtIHN0YXJ0WzFdO1xyXG5cdFx0Ly92YXIgcm90YXRpb24gPSBNYXRoLmF0YW4yKGR5LCBkeCk7XHJcblxyXG5cdFx0c3R5bGVzLnB1c2gobmV3IG9sLnN0eWxlLlN0eWxlKHtcclxuXHRcdFx0Z2VvbWV0cnk6IG5ldyBvbC5nZW9tLlBvaW50KHN0YXJ0KSxcclxuXHRcdFx0aW1hZ2U6IG5ldyBvbC5zdHlsZS5JY29uKHtcclxuXHRcdFx0XHRzcmM6IGltYWdlLFxyXG5cdFx0XHRcdC8vc2NhbGUgOiAwLjY1LFxyXG5cdFx0XHRcdGFuY2hvcjogWzAuNSwgMC41XSxcclxuXHRcdFx0XHRyb3RhdGVXaXRoVmlldzogdHJ1ZSxcclxuXHRcdFx0XHQvL3JvdGF0aW9uOiAtcm90YXRpb24sXHJcblx0XHRcdFx0b3BhY2l0eSA6IDFcclxuXHRcdFx0fSlcclxuXHRcdH0pKTtcclxuXHR9LFxyXG5cclxuXHRfZ2VuRGlyZWN0aW9uIDogZnVuY3Rpb24ocHRzLCB3dywgcmVzb2x1dGlvbiwgY29sb3IsIHN0eWxlcykge1xyXG4gICAgICAgIGlmIChDT05GSUcuYXBwZWFyYW5jZS5kaXJlY3Rpb25JY29uQmV0d2VlbiA8PSAwKSB7XHJcbiAgICAgICAgICAgIC8vIHRoaXMgbWVhbnMgbm8gbmVlZCB0byBzaG93IHRoZSBkaXJlY3Rpb25zXHJcbiAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIHZhciBjbnQgPSAwO1xyXG4gICAgICAgIHZhciBpY24gPSByZW5kZXJEaXJlY3Rpb25CYXNlNjQoMTYsIDE2LCBjb2xvcik7XHJcbiAgICAgICAgdmFyIHJlcyA9IDAuMDtcclxuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IHB0cy5sZW5ndGggLSAxOyBpKyspIHtcclxuICAgICAgICAgICAgdmFyIHN0YXJ0ID0gcHRzW2kgKyAxXTtcclxuICAgICAgICAgICAgdmFyIGVuZCA9IHB0c1tpXTtcclxuICAgICAgICAgICAgdmFyIGR4ID0gZW5kWzBdIC0gc3RhcnRbMF07XHJcbiAgICAgICAgICAgIHZhciBkeSA9IGVuZFsxXSAtIHN0YXJ0WzFdO1xyXG4gICAgICAgICAgICB2YXIgbGVuID0gTWF0aC5zcXJ0KGR4ICogZHggKyBkeSAqIGR5KSAvIHJlc29sdXRpb247XHJcbiAgICAgICAgICAgIHJlcyArPSBsZW47XHJcbiAgICAgICAgICAgIGlmIChpID09IDAgfHwgcmVzID49IENPTkZJRy5hcHBlYXJhbmNlLmRpcmVjdGlvbkljb25CZXR3ZWVuKSB7XHJcbiAgICAgICAgICAgICAgICByZXMgPSAwO1xyXG4gICAgICAgICAgICAgICAgdmFyIHJvdGF0aW9uID0gTWF0aC5hdGFuMihkeSwgZHgpO1xyXG4gICAgICAgICAgICAgICAgc3R5bGVzLnB1c2gobmV3IG9sLnN0eWxlLlN0eWxlKHtcclxuICAgICAgICAgICAgICAgICAgICBnZW9tZXRyeTogbmV3IG9sLmdlb20uUG9pbnQoWyhzdGFydFswXSArIGVuZFswXSkgLyAyLCAoc3RhcnRbMV0gKyBlbmRbMV0pIC8gMl0pLFxyXG4gICAgICAgICAgICAgICAgICAgIGltYWdlOiBuZXcgb2wuc3R5bGUuSWNvbih7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHNyYzogaWNuLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBzY2FsZTogd3cgLyAxMi4wLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBhbmNob3I6IFswLjUsIDAuNV0sXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHJvdGF0ZVdpdGhWaWV3OiB0cnVlLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICByb3RhdGlvbjogLXJvdGF0aW9uICsgTWF0aC5QSSwgLy8gYWRkIDE4MCBkZWdyZWVzXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIG9wYWNpdHk6IDFcclxuICAgICAgICAgICAgICAgICAgICB9KVxyXG4gICAgICAgICAgICAgICAgfSkpO1xyXG4gICAgICAgICAgICAgICAgY250Kys7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICB9LFxyXG5cclxuICAgIF9nZW5EaXN0YW5jZUttIDogZnVuY3Rpb24od3csIHJlc29sdXRpb24sXHJcblx0XHRcdFx0XHRcdFx0ICBjb29yZHMsIGRpc3RhbmNlcywgc3RhcnREaXN0SW5kZXgsIGVuZERpc3RJbmRleCxcclxuXHRcdFx0XHRcdFx0XHQgIHN0eWxlcykge1xyXG4gICAgICAgIC8vIFRPRE8gUnVtZW4gLSBzdGlsbCBub3QgcmVhZHkgLSBmb3Igbm93IHN0YXRpYyBob3RzcG90cyBhcmUgdXNlZFxyXG4gICAgICAgIGlmICh0cnVlKSB7cmV0dXJuO31cclxuXHJcbiAgICAgICAgdmFyIGhvdHNwb3RzS20gPSBbMjAsIDQwLCA2MCwgODAsIDEwMCwgMTIwLCAxNDAsIDE2MCwgMTgwXTtcclxuXHJcbiAgICAgICAgZnVuY3Rpb24gYWRkSG90U3BvdEtNKGttLCBwb2ludCkge1xyXG4gICAgICAgICAgICAvL3ZhciBkeCA9IGVuZFswXSAtIHN0YXJ0WzBdO1xyXG4gICAgICAgICAgICAvL3ZhciBkeSA9IGVuZFsxXSAtIHN0YXJ0WzFdO1xyXG4gICAgICAgICAgICAvL3ZhciByb3RhdGlvbiA9IE1hdGguYXRhbjIoZHksIGR4KTtcclxuICAgICAgICAgICAgc3R5bGVzLnB1c2gobmV3IG9sLnN0eWxlLlN0eWxlKHtcclxuICAgICAgICAgICAgICAgIC8vZ2VvbWV0cnk6IG5ldyBvbC5nZW9tLlBvaW50KFsoc3RhcnRbMF0rZW5kWzBdKS8yLChzdGFydFsxXStlbmRbMV0pLzJdKSxcclxuICAgICAgICAgICAgICAgIGdlb21ldHJ5OiBuZXcgb2wuZ2VvbS5Qb2ludChbcG9pbnRbMF0sIHBvaW50WzFdXSksXHJcbiAgICAgICAgICAgICAgICBpbWFnZTogbmV3IG9sLnN0eWxlLkljb24oe1xyXG4gICAgICAgICAgICAgICAgICAgIHNyYzogXCJpbWcvXCIgKyBrbSArIFwia20uc3ZnXCIsXHJcbiAgICAgICAgICAgICAgICAgICAgc2NhbGU6IDEuNSxcclxuICAgICAgICAgICAgICAgICAgICByb3RhdGVXaXRoVmlldzogdHJ1ZSxcclxuICAgICAgICAgICAgICAgICAgICAvL3JvdGF0aW9uOiAtcm90YXRpb24gKyBNYXRoLlBJLzIsIC8vIGFkZCAxODAgZGVncmVlc1xyXG4gICAgICAgICAgICAgICAgICAgIG9wYWNpdHkgOiAxXHJcbiAgICAgICAgICAgICAgICB9KVxyXG4gICAgICAgICAgICB9KSk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBmb3IgKHZhciBpID0gc3RhcnREaXN0SW5kZXg7IGkgPCBlbmREaXN0SW5kZXg7IGkrKykge1xyXG4gICAgICAgICAgICBpZiAoIWhvdHNwb3RzS20ubGVuZ3RoKSB7XHJcblx0XHRcdFx0cmV0dXJuO1xyXG5cdFx0XHR9XHJcblxyXG5cdFx0XHR2YXIgZGlzdCA9IGRpc3RhbmNlc1tpXTtcclxuXHJcblx0XHRcdGlmIChkaXN0ID49IGhvdHNwb3RzS21bMF0qMTAwMCkge1xyXG5cdFx0XHRcdC8vIGRyYXcgdGhlIGZpcnN0IGhvdHNwb3QgYW5kIGFueSBuZXh0IGlmIGl0J3MgY29udGFpbmVkIGluIHRoZSBzYW1lIFwiZGlzdGFuY2VcIlxyXG5cdFx0XHRcdHZhciByZW1vdmVIb3RzcG90S20gPSAwO1xyXG5cdFx0XHRcdGZvciAodmFyIGsgPSAwLCBsZW5Ib3RzcG90c0ttID0gaG90c3BvdHNLbS5sZW5ndGg7IGsgPCBsZW5Ib3RzcG90c0ttOyBrKyspIHtcclxuXHRcdFx0XHRcdGlmIChkaXN0ID49IGhvdHNwb3RzS21ba10qMTAwMCkge1xyXG5cdFx0XHRcdFx0XHRhZGRIb3RTcG90S00oaG90c3BvdHNLbVtrXSwgY29vcmRzW2ldKTtcclxuXHRcdFx0XHRcdFx0cmVtb3ZlSG90c3BvdEttKys7XHJcblx0XHRcdFx0XHR9IGVsc2Uge1xyXG5cdFx0XHRcdFx0XHRicmVhaztcclxuXHRcdFx0XHRcdH1cclxuXHRcdFx0XHR9XHJcblx0XHRcdFx0Ly8gcmVtb3ZlIGFsbCB0aGUgYWxyZWFkeSBkcmF3biBob3RzcG90c1xyXG5cdFx0XHRcdGZvciAodmFyIGogPSAwOyBqIDxyZW1vdmVIb3RzcG90S207IGorKykgaG90c3BvdHNLbS5zaGlmdCgpO1xyXG5cdFx0XHR9XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG59O1xyXG5cclxuZm9yICh2YXIgaSBpbiBTVFlMRVMpXHJcblx0ZXhwb3J0c1tpXT1TVFlMRVNbaV07XHJcbiIsInJlcXVpcmUoJ2pvb3NlJyk7XHJcbnJlcXVpcmUoJy4vUGFydGljaXBhbnQnKTtcclxuXHJcbnZhciByYnVzaCA9IHJlcXVpcmUoJ3JidXNoJyk7XHJcbnZhciBDT05GSUcgPSByZXF1aXJlKCcuL0NvbmZpZycpO1xyXG52YXIgV0dTODRTUEhFUkUgPSByZXF1aXJlKCcuL1V0aWxzJykuV0dTODRTUEhFUkU7XHJcblxyXG5DbGFzcyhcIlRyYWNrXCIsIFxyXG57XHRcclxuICAgIC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHQvLyBBTEwgQ09PUkRJTkFURVMgQVJFIElOIFdPUkxEIE1FUkNBVE9SXHJcbiAgICAvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcbiAgICBoYXM6IFxyXG5cdHtcclxuICAgICAgICByb3V0ZSA6IHtcclxuICAgICAgICAgICAgaXM6ICAgXCJyd1wiXHJcbiAgICAgICAgfSxcclxuICAgICAgICBkaXN0YW5jZXMgOiB7XHJcbiAgICAgICAgICAgIGlzOiAgIFwicndcIlxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgZGlzdGFuY2VzRWxhcHNlZCA6IHtcclxuICAgICAgICAgICAgaXM6ICAgXCJyd1wiXHJcbiAgICAgICAgfSxcclxuXHRcdHRvdGFsTGVuZ3RoIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIlxyXG5cdFx0fSxcclxuXHRcdHBhcnRpY2lwYW50cyA6IHtcclxuXHRcdFx0aXM6ICAgXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogW11cclxuXHRcdH0sXHJcblx0XHRjYW1zQ291bnQgOiB7XHJcblx0XHRcdGlzOiAgIFwicndcIixcclxuXHRcdFx0aW5pdDogMFxyXG5cdFx0fSxcclxuXHRcdC8vIGluIEVQU0cgMzg1N1xyXG5cdFx0ZmVhdHVyZSA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiBudWxsXHRcdFxyXG5cdFx0fSxcclxuXHRcdGlzRGlyZWN0aW9uQ29uc3RyYWludCA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiBmYWxzZVxyXG5cdFx0fSxcclxuXHRcdFxyXG5cdFx0ZGVidWdQYXJ0aWNpcGFudCA6IHtcclxuXHRcdFx0aXMgOiBcInJ3XCIsXHJcblx0XHRcdGluaXQgOiBudWxsXHJcblx0XHR9LFxyXG5cdFx0YmlrZVN0YXJ0S00gOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogbnVsbFxyXG5cdFx0fSxcclxuXHRcdHJ1blN0YXJ0S00gOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogbnVsbFxyXG5cdFx0fSxcclxuXHRcdGxhcHMgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogMVxyXG5cdFx0fSxcclxuXHRcdHRvdGFsUGFydGljaXBhbnRzIDoge1xyXG5cdFx0XHRpcyA6IFwicndcIixcclxuXHRcdFx0aW5pdCA6IDUwXHJcblx0XHR9LFxyXG5cdFx0clRyZWUgOiB7XHJcblx0XHRcdGlzIDogXCJyd1wiLFxyXG5cdFx0XHRpbml0IDogcmJ1c2goMTApXHJcblx0XHR9LFxyXG5cclxuXHRcdGlzQWRkZWRIb3RTcG90U3dpbUJpa2UgOiB7XHJcblx0XHRcdGluaXQgOiBmYWxzZVxyXG5cdFx0fSxcclxuXHRcdGlzQWRkZWRIb3RTcG90QmlrZVJ1biA6IHtcclxuXHRcdFx0aW5pdCA6IGZhbHNlXHJcblx0XHR9XHJcbiAgICB9LFxyXG4gICAgLy8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdG1ldGhvZHM6IFxyXG5cdHtcdFx0XHJcblx0XHRzZXRSb3V0ZSA6IGZ1bmN0aW9uKHZhbCkge1xyXG5cdFx0XHR0aGlzLnJvdXRlPXZhbDtcclxuXHRcdFx0ZGVsZXRlIHRoaXMuX2xlbnRtcDE7XHJcblx0XHRcdGRlbGV0ZSB0aGlzLl9sZW50bXAyO1xyXG5cdFx0fSxcclxuXHRcdFxyXG5cdFx0Z2V0Qm91bmRpbmdCb3ggOiBmdW5jdGlvbigpIHtcclxuXHRcdFx0dmFyIG1pbng9bnVsbCxtaW55PW51bGwsbWF4eD1udWxsLG1heHk9bnVsbDtcclxuXHRcdFx0Zm9yICh2YXIgaT0wO2k8dGhpcy5yb3V0ZS5sZW5ndGg7aSsrKVxyXG5cdFx0XHR7XHJcblx0XHRcdFx0dmFyIHA9dGhpcy5yb3V0ZVtpXTtcclxuXHRcdFx0XHRpZiAobWlueCA9PSBudWxsIHx8IHBbMF0gPCBtaW54KSBtaW54PXBbMF07XHJcblx0XHRcdFx0aWYgKG1heHggPT0gbnVsbCB8fCBwWzBdID4gbWF4eCkgbWF4eD1wWzBdO1xyXG5cdFx0XHRcdGlmIChtaW55ID09IG51bGwgfHwgcFsxXSA8IG1pbnkpIG1pbnk9cFsxXTtcclxuXHRcdFx0XHRpZiAobWF4eSA9PSBudWxsIHx8IHBbMV0gPiBtYXh5KSBtYXh5PXBbMV07XHJcblx0XHRcdH1cclxuXHRcdFx0cmV0dXJuIFttaW54LG1pbnksbWF4eCxtYXh5XTtcclxuXHRcdH0sXHJcblx0XHRcclxuXHRcdC8vIGVsYXBzZWQgZnJvbSAwLi4xXHJcblx0XHRnZXRQb3NpdGlvbkFuZFJvdGF0aW9uRnJvbUVsYXBzZWQgOiBmdW5jdGlvbihlbGFwc2VkKSB7XHJcblx0XHRcdHZhciBycj1udWxsO1xyXG5cdFx0XHR2YXIgY2MgPSB0aGlzLnJvdXRlO1xyXG5cdFx0XHRcclxuXHRcdFx0dmFyIGxsID0gdGhpcy5kaXN0YW5jZXNFbGFwc2VkLmxlbmd0aC0xO1xyXG5cdFx0XHR2YXIgc2kgPSAwO1xyXG5cclxuXHRcdFx0Ly8gVE9ETyBGSVggTUUgXHJcblx0XHRcdHdoaWxlIChzaSA8IGxsICYmIHNpKzUwMCA8IGxsICYmIHRoaXMuZGlzdGFuY2VzRWxhcHNlZFtzaSs1MDBdIDwgZWxhcHNlZCApIHtcclxuXHRcdFx0XHRzaSs9NTAwO1xyXG5cdFx0XHR9XHJcblx0XHRcdFxyXG5cdFx0XHR3aGlsZSAoc2kgPCBsbCAmJiBzaSsyNTAgPCBsbCAmJiB0aGlzLmRpc3RhbmNlc0VsYXBzZWRbc2krMjUwXSA8IGVsYXBzZWQgKSB7XHJcblx0XHRcdFx0c2krPTI1MDtcclxuXHRcdFx0fVxyXG5cdFx0XHRcclxuXHRcdFx0d2hpbGUgKHNpIDwgbGwgJiYgc2krMTI1IDwgbGwgJiYgdGhpcy5kaXN0YW5jZXNFbGFwc2VkW3NpKzEyNV0gPCBlbGFwc2VkICkge1xyXG5cdFx0XHRcdHNpKz0xMjU7XHJcblx0XHRcdH1cclxuXHJcblx0XHRcdHdoaWxlIChzaSA8IGxsICYmIHNpKzUwIDwgbGwgJiYgdGhpcy5kaXN0YW5jZXNFbGFwc2VkW3NpKzUwXSA8IGVsYXBzZWQgKSB7XHJcblx0XHRcdFx0c2krPTUwO1xyXG5cdFx0XHR9XHJcblx0XHRcdFxyXG5cdFx0XHRmb3IgKHZhciBpPXNpO2k8bGw7aSsrKSBcclxuXHRcdFx0e1xyXG5cdFx0XHRcdC8qZG8gXHJcblx0XHRcdFx0e1xyXG5cdFx0XHRcdFx0dmFyIG0gPSAoKGNjLmxlbmd0aC0xK2kpID4+IDEpO1xyXG5cdFx0XHRcdFx0aWYgKG0taSA+IDUgJiYgZWxhcHNlZCA8IHRoaXMuZGlzdGFuY2VzRWxhcHNlZFttXSkge1xyXG5cdFx0XHRcdFx0XHRpPW07XHJcblx0XHRcdFx0XHRcdGNvbnRpbnVlO1xyXG5cdFx0XHRcdFx0fVxyXG5cdFx0XHRcdFx0YnJlYWs7XHJcblx0XHRcdFx0fSB3aGlsZSAodHJ1ZSk7Ki9cclxuXHRcdFx0XHRpZiAoZWxhcHNlZCA+PSB0aGlzLmRpc3RhbmNlc0VsYXBzZWRbaV0gJiYgZWxhcHNlZCA8PSB0aGlzLmRpc3RhbmNlc0VsYXBzZWRbaSsxXSkgXHJcblx0XHRcdFx0e1xyXG5cdFx0XHRcdFx0ZWxhcHNlZC09dGhpcy5kaXN0YW5jZXNFbGFwc2VkW2ldO1xyXG5cdFx0XHRcdFx0dmFyIGFjPXRoaXMuZGlzdGFuY2VzRWxhcHNlZFtpKzFdLXRoaXMuZGlzdGFuY2VzRWxhcHNlZFtpXTtcclxuXHRcdFx0XHRcdHZhciBhID0gY2NbaV07XHJcblx0XHRcdFx0XHR2YXIgYyA9IGNjW2krMV07XHJcblx0XHRcdFx0XHR2YXIgZHggPSBjWzBdIC0gYVswXTtcclxuXHRcdFx0XHRcdHZhciBkeSA9IGNbMV0gLSBhWzFdO1xyXG5cdFx0XHRcdFx0cnI9WyBhWzBdKyhjWzBdLWFbMF0pKmVsYXBzZWQvYWMsYVsxXSsoY1sxXS1hWzFdKSplbGFwc2VkL2FjLE1hdGguYXRhbjIoZHksIGR4KV07XHJcblx0XHRcdFx0XHRicmVhaztcclxuXHRcdFx0XHR9XHJcblx0XHRcdH1cclxuXHRcdFx0cmV0dXJuIHJyO1xyXG5cdFx0fSxcclxuXHRcdFxyXG5cdFx0X19nZXRQb3NpdGlvbkFuZFJvdGF0aW9uRnJvbUVsYXBzZWQgOiBmdW5jdGlvbihlbGFwc2VkKSB7XHJcblx0XHRcdGVsYXBzZWQqPXRoaXMuZ2V0VHJhY2tMZW5ndGgoKTtcclxuXHRcdFx0dmFyIHJyPW51bGw7XHJcblx0XHRcdHZhciBjYyA9IHRoaXMucm91dGU7XHJcblx0XHRcdGZvciAodmFyIGk9MDtpPGNjLmxlbmd0aC0xO2krKykgXHJcblx0XHRcdHtcclxuXHRcdFx0XHR2YXIgYSA9IGNjW2ldO1xyXG5cdFx0XHRcdHZhciBjID0gY2NbaSsxXTtcclxuXHRcdFx0XHR2YXIgYWMgPSBXR1M4NFNQSEVSRS5oYXZlcnNpbmVEaXN0YW5jZShhLGMpO1xyXG5cdFx0XHRcdGlmIChlbGFwc2VkIDw9IGFjKSB7XHJcblx0XHRcdFx0XHR2YXIgZHggPSBjWzBdIC0gYVswXTtcclxuXHRcdFx0XHRcdHZhciBkeSA9IGNbMV0gLSBhWzFdO1xyXG5cdFx0XHRcdFx0cnI9WyBhWzBdKyhjWzBdLWFbMF0pKmVsYXBzZWQvYWMsYVsxXSsoY1sxXS1hWzFdKSplbGFwc2VkL2FjLE1hdGguYXRhbjIoZHksIGR4KV07XHJcblx0XHRcdFx0XHRicmVhaztcclxuXHRcdFx0XHR9XHJcblx0XHRcdFx0ZWxhcHNlZC09YWM7XHJcblx0XHRcdH1cclxuXHRcdFx0cmV0dXJuIHJyO1xyXG5cdFx0fSxcclxuXHJcblx0XHRcclxuXHRcdGdldFRyYWNrTGVuZ3RoIDogZnVuY3Rpb24oKSB7XHJcblx0XHRcdGlmICh0aGlzLl9sZW50bXAxKVxyXG5cdFx0XHRcdHJldHVybiB0aGlzLl9sZW50bXAxO1xyXG5cdFx0XHR2YXIgcmVzPTAuMDtcclxuXHRcdFx0dmFyIGNjID0gdGhpcy5yb3V0ZTtcclxuXHRcdFx0Zm9yICh2YXIgaT0wO2k8Y2MubGVuZ3RoLTE7aSsrKSBcclxuXHRcdFx0e1xyXG5cdFx0XHRcdHZhciBhID0gY2NbaV07XHJcblx0XHRcdFx0dmFyIGIgPSBjY1tpKzFdO1xyXG5cdFx0XHRcdHZhciBkID0gV0dTODRTUEhFUkUuaGF2ZXJzaW5lRGlzdGFuY2UoYSxiKTtcclxuXHRcdFx0XHRpZiAoIWlzTmFOKGQpICYmIGQgPiAwKSBcclxuXHRcdFx0XHRcdHJlcys9ZDtcclxuXHRcdFx0fVxyXG5cdFx0XHR0aGlzLl9sZW50bXAxPXJlcztcclxuXHRcdFx0cmV0dXJuIHJlcztcclxuXHRcdH0sXHJcblxyXG5cdFx0Z2V0VHJhY2tMZW5ndGhJbldHUzg0IDogZnVuY3Rpb24oKSB7XHJcblx0XHRcdGlmICh0aGlzLl9sZW50bXAyKVxyXG5cdFx0XHRcdHJldHVybiB0aGlzLl9sZW50bXAyO1xyXG5cdFx0XHR2YXIgcmVzPTAuMDtcclxuXHRcdFx0dmFyIGNjID0gdGhpcy5yb3V0ZTtcclxuXHRcdFx0Zm9yICh2YXIgaT0wO2k8Y2MubGVuZ3RoLTE7aSsrKSBcclxuXHRcdFx0e1xyXG5cdFx0XHRcdHZhciBhID0gY2NbaV07XHJcblx0XHRcdFx0dmFyIGIgPSBjY1tpKzFdO1xyXG5cdFx0XHRcdHZhciBkID0gTWF0aC5zcXJ0KChhWzBdLWJbMF0pKihhWzBdLWJbMF0pKyhhWzFdLWJbMV0pKihhWzFdLWJbMV0pKTtcclxuXHRcdFx0XHRpZiAoIWlzTmFOKGQpICYmIGQgPiAwKSBcclxuXHRcdFx0XHRcdHJlcys9ZDtcclxuXHRcdFx0fVxyXG5cdFx0XHR0aGlzLl9sZW50bXAyPXJlcztcclxuXHRcdFx0cmV0dXJuIHJlcztcclxuXHRcdH0sXHJcblxyXG5cdFx0Z2V0Q2VudGVyIDogZnVuY3Rpb24oKSB7XHJcblx0XHRcdHZhciBiYiA9IHRoaXMuZ2V0Qm91bmRpbmdCb3goKTtcclxuXHRcdFx0cmV0dXJuIFsoYmJbMF0rYmJbMl0pLzIuMCwoYmJbMV0rYmJbM10pLzIuMF07XHJcblx0XHR9LFxyXG5cdFx0XHJcblx0XHRpbml0IDogZnVuY3Rpb24oKSBcclxuXHRcdHtcclxuXHRcdFx0aWYgKCF0aGlzLnJvdXRlKVxyXG5cdFx0XHRcdHJldHVybjtcclxuXHRcdFx0Ly8gMSkgY2FsY3VsYXRlIHRvdGFsIHJvdXRlIGxlbmd0aCBpbiBLTSBcclxuXHRcdFx0dGhpcy51cGRhdGVGZWF0dXJlKCk7XHJcblx0XHRcdGlmICh0eXBlb2Ygd2luZG93ICE9IFwidW5kZWZpbmVkXCIpIFxyXG5cdFx0XHR7XHJcblx0XHRcdFx0aWYgKCFHVUkuZ2V0SXNTa2lwRXh0ZW50KCkpIHtcclxuXHRcdFx0XHRcdGlmICh0aGlzLmZlYXR1cmUpIHtcclxuXHRcdFx0XHRcdFx0R1VJLm1hcC5nZXRWaWV3KCkuZml0RXh0ZW50KHRoaXMuZmVhdHVyZS5nZXRHZW9tZXRyeSgpLmdldEV4dGVudCgpLCBHVUkubWFwLmdldFNpemUoKSk7XHJcblx0XHRcdFx0XHRcdGNvbnNvbGUubG9nKFwiQ3VycmVudCBleHRlbnQgOiBcIiArIEpTT04uc3RyaW5naWZ5KHRoaXMuZmVhdHVyZS5nZXRHZW9tZXRyeSgpLmdldEV4dGVudCgpKSk7XHJcblx0XHRcdFx0XHR9IGVsc2Uge1xyXG5cdFx0XHRcdFx0XHRHVUkubWFwLmdldFZpZXcoKS5maXRFeHRlbnQoWzEyMzQ1OTIuMzYzNzM0NTU2OCwgNjI4MjcwNi44ODk2NzY0MzUsIDEyNjQzNDguNDY0MzczNzY2LCA2MzI1Njk0Ljc0MzE2NDcyNV0sIEdVSS5tYXAuZ2V0U2l6ZSgpKTtcclxuXHRcdFx0XHRcdH1cclxuXHRcdFx0XHR9XHJcblx0XHRcdH1cclxuXHRcdH0sXHJcblx0XHRcclxuXHRcdGdldFRyYWNrUGFydCA6IGZ1bmN0aW9uKGVsYXBzZWQpIHtcclxuXHRcdFx0dmFyIGxlbiA9IHRoaXMuZ2V0VHJhY2tMZW5ndGgoKTtcclxuXHRcdFx0dmFyIGVtID0gKGVsYXBzZWQlMS4wKSpsZW47XHJcblx0XHRcdGlmIChlbSA+PSB0aGlzLnJ1blN0YXJ0S00qMTAwMCkgXHJcblx0XHRcdFx0cmV0dXJuIDI7XHJcblx0XHRcdGlmIChlbSA+PSB0aGlzLmJpa2VTdGFydEtNKjEwMDApIFxyXG5cdFx0XHRcdHJldHVybiAxO1xyXG5cdFx0XHRyZXR1cm4gMDtcclxuXHRcdH0sXHJcblx0XHRcclxuXHRcdHVwZGF0ZUZlYXR1cmUgOiBmdW5jdGlvbigpIFxyXG5cdFx0e1xyXG5cdFx0XHR0aGlzLmRpc3RhbmNlcz1bXTtcclxuXHRcdFx0dmFyIHJlcz0wLjA7XHJcblx0XHRcdHZhciBjYyA9IHRoaXMucm91dGU7XHJcblx0XHRcdGZvciAodmFyIGk9MDtpPGNjLmxlbmd0aC0xO2krKykgXHJcblx0XHRcdHtcclxuXHRcdFx0XHR2YXIgYSA9IGNjW2ldO1xyXG5cdFx0XHRcdHZhciBiID0gY2NbaSsxXTtcclxuXHRcdFx0XHR2YXIgZCA9IFdHUzg0U1BIRVJFLmhhdmVyc2luZURpc3RhbmNlKGEsYik7XHJcblx0XHRcdFx0dGhpcy5kaXN0YW5jZXMucHVzaChyZXMpO1xyXG5cdFx0XHRcdGlmICghaXNOYU4oZCkgJiYgZCA+IDApIFxyXG5cdFx0XHRcdFx0cmVzKz1kO1xyXG5cdFx0XHR9XHJcblx0XHRcdHRoaXMuZGlzdGFuY2VzLnB1c2gocmVzKTtcclxuXHRcdFx0dGhpcy5kaXN0YW5jZXNFbGFwc2VkPVtdO1xyXG5cdFx0XHR2YXIgdGwgPSB0aGlzLmdldFRyYWNrTGVuZ3RoKCk7XHJcblx0XHRcdGZvciAodmFyIGk9MDtpPGNjLmxlbmd0aDtpKyspIHtcclxuXHRcdFx0XHR0aGlzLmRpc3RhbmNlc0VsYXBzZWQucHVzaCh0aGlzLmRpc3RhbmNlc1tpXS90bCk7XHJcblx0XHRcdH1cclxuXHRcdFx0Ly8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cdFx0XHR0aGlzLnJUcmVlLmNsZWFyKCk7XHJcblx0XHRcdHZhciBhcnIgPSBbXTtcclxuXHRcdFx0Zm9yICh2YXIgaT0wO2k8dGhpcy5yb3V0ZS5sZW5ndGgtMTtpKyspIFxyXG5cdFx0XHR7XHJcblx0XHRcdFx0dmFyIHgxID0gdGhpcy5yb3V0ZVtpXVswXTtcclxuXHRcdFx0XHR2YXIgeTEgPSB0aGlzLnJvdXRlW2ldWzFdO1xyXG5cdFx0XHRcdHZhciB4MiA9IHRoaXMucm91dGVbaSsxXVswXTtcclxuXHRcdFx0XHR2YXIgeTIgPSB0aGlzLnJvdXRlW2krMV1bMV07XHJcblx0XHRcdFx0dmFyIG1pbnggPSB4MSA8IHgyID8geDEgOiB4MjtcclxuXHRcdFx0XHR2YXIgbWlueSA9IHkxIDwgeTIgPyB5MSA6IHkyO1xyXG5cdFx0XHRcdHZhciBtYXh4ID0geDEgPiB4MiA/IHgxIDogeDI7XHJcblx0XHRcdFx0dmFyIG1heHkgPSB5MSA+IHkyID8geTEgOiB5MjtcclxuXHRcdFx0XHRhcnIucHVzaChbbWlueCxtaW55LG1heHgsbWF4eSx7IGluZGV4IDogaSB9XSk7XHJcblx0XHRcdH1cclxuXHRcdFx0dGhpcy5yVHJlZS5sb2FkKGFycik7XHJcblx0XHRcdC8vLS0tLS0tLS0tLS0tLS0tLS0gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblx0XHRcdGlmICh0eXBlb2Ygd2luZG93ICE9IFwidW5kZWZpbmVkXCIgJiYgdGhpcy5yb3V0ZSAmJiB0aGlzLnJvdXRlLmxlbmd0aCkgXHJcblx0XHRcdHtcclxuXHRcdFx0XHR2YXIgd2t0ID0gW107XHJcblx0XHRcdFx0Zm9yICh2YXIgaT0wO2k8dGhpcy5yb3V0ZS5sZW5ndGg7aSsrKSB7XHJcblx0XHRcdFx0XHR3a3QucHVzaCh0aGlzLnJvdXRlW2ldWzBdK1wiIFwiK3RoaXMucm91dGVbaV1bMV0pO1xyXG5cdFx0XHRcdH1cclxuXHRcdFx0XHR3a3Q9XCJMSU5FU1RSSU5HKFwiK3drdC5qb2luKFwiLFwiKStcIilcIjtcclxuXHRcdFx0XHR2YXIgZm9ybWF0ID0gbmV3IG9sLmZvcm1hdC5XS1QoKTtcclxuXHRcdFx0XHRpZiAoIXRoaXMuZmVhdHVyZSkge1xyXG5cdFx0XHRcdFx0dGhpcy5mZWF0dXJlID0gZm9ybWF0LnJlYWRGZWF0dXJlKHdrdCk7XHJcblx0XHRcdFx0fSBlbHNlIHtcclxuXHRcdFx0XHRcdHRoaXMuZmVhdHVyZS5zZXRHZW9tZXRyeShmb3JtYXQucmVhZEZlYXR1cmUod2t0KS5nZXRHZW9tZXRyeSgpKTtcclxuXHRcdFx0XHR9XHJcblx0XHRcdFx0dGhpcy5mZWF0dXJlLnRyYWNrPXRoaXM7XHJcblx0XHRcdFx0dGhpcy5mZWF0dXJlLmdldEdlb21ldHJ5KCkudHJhbnNmb3JtKCdFUFNHOjQzMjYnLCAnRVBTRzozODU3Jyk7XHRcdFx0XHRcdFx0XHJcblx0XHRcdFx0Ly9jb25zb2xlLmxvZyhcIkZFQVRVUkUgVFJBQ0sgOiBcIit0aGlzLmZlYXR1cmUudHJhY2spO1xyXG5cdFx0XHR9IGVsc2Uge1xyXG5cdFx0XHRcdGRlbGV0ZSB0aGlzLmZlYXR1cmU7XHJcblx0XHRcdH1cclxuXHRcdH0sXHJcblxyXG5cdFx0Z2V0UmVhbFBhcnRpY2lwYW50c0NvdW50IDogZnVuY3Rpb24oKSB7XHJcblx0XHRcdHJldHVybiB0aGlzLnBhcnRpY2lwYW50cy5sZW5ndGggLSB0aGlzLmNhbXNDb3VudDtcclxuXHRcdH0sXHJcblxyXG5cdFx0Z2V0UGFydGljaXBhbnRCeUlkIDogZnVuY3Rpb24oaWQpIHtcclxuXHRcdFx0Ly8gVE9ETyBSdW1lbiAtIGl0IHdvdWxkIGJlIGdvb2QgdG8gaG9sZCBhIG1hcCBvZiB0aGUgdHlwZSBpZCAtPiBQYXJ0aWNpcGFudFxyXG5cdFx0XHRpZiAodGhpcy5wYXJ0aWNpcGFudHMpIHtcclxuXHRcdFx0XHRmb3IgKHZhciBpID0gMCwgbGVuID0gdGhpcy5wYXJ0aWNpcGFudHMubGVuZ3RoOyBpIDwgbGVuOyBpKyspIHtcclxuXHRcdFx0XHRcdCBpZiAodGhpcy5wYXJ0aWNpcGFudHNbaV0uaWQgPT09IGlkKSB7XHJcblx0XHRcdFx0XHRcdCByZXR1cm4gdGhpcy5wYXJ0aWNpcGFudHNbaV07XHJcblx0XHRcdFx0XHQgfVxyXG5cdFx0XHRcdH1cclxuXHRcdFx0fVxyXG5cdFx0XHRyZXR1cm4gbnVsbDtcclxuXHRcdH0sXHJcblx0XHRcclxuXHRcdG5ld1BhcnRpY2lwYW50IDogZnVuY3Rpb24oaWQsZGV2aWNlSWQsbmFtZSlcclxuXHRcdHtcclxuXHRcdFx0dmFyIHBhcnQgPSBuZXcgUGFydGljaXBhbnQoe2lkOmlkLGRldmljZUlkOmRldmljZUlkLGNvZGU6bmFtZX0pO1xyXG5cdFx0XHRwYXJ0LmluaXQodGhpcy5yb3V0ZVswXSx0aGlzKTtcclxuXHRcdFx0cGFydC5zZXRTZXFJZCh0aGlzLnBhcnRpY2lwYW50cy5sZW5ndGgpO1xyXG5cdFx0XHR0aGlzLnBhcnRpY2lwYW50cy5wdXNoKHBhcnQpO1xyXG5cdFx0XHRyZXR1cm4gcGFydDtcclxuXHRcdH0sXHJcblxyXG5cdFx0bmV3TW92aW5nQ2FtIDogZnVuY3Rpb24oaWQsZGV2aWNlSWQsbmFtZSlcclxuXHRcdHtcclxuXHRcdFx0dmFyIGNhbSA9IG5ldyBNb3ZpbmdDYW0oe2lkOmlkLGRldmljZUlkOmRldmljZUlkLGNvZGU6bmFtZX0pO1xyXG5cdFx0XHRjYW0uaW5pdCh0aGlzLnJvdXRlWzBdLHRoaXMpO1xyXG5cdFx0XHRjYW0uc2V0U2VxSWQodGhpcy5jYW1zQ291bnQpO1xyXG5cdFx0XHR0aGlzLmNhbXNDb3VudCsrO1xyXG5cdFx0XHRjYW0uX19za2lwVHJhY2tpbmdQb3M9dHJ1ZTtcclxuXHRcdFx0dGhpcy5wYXJ0aWNpcGFudHMucHVzaChjYW0pO1xyXG5cdFx0XHRyZXR1cm4gY2FtO1xyXG5cdFx0fSxcclxuXHJcblx0XHRuZXdIb3RTcG90cyA6IGZ1bmN0aW9uKGhvdHNwb3RzKSB7XHJcblx0XHRcdGlmICghaG90c3BvdHMgfHwgIWhvdHNwb3RzLmxlbmd0aCkge1xyXG5cdFx0XHRcdHJldHVybjtcclxuXHRcdFx0fVxyXG5cclxuXHRcdFx0Ly8gVE9ETyBSdW1lbiAtIHRoaXMgaXMgQ09QWS1QQVNURSBjb2RlIGZvcm0gdGhlIFN0eWxlc1xyXG5cdFx0XHQvLyBzbyBsYXRlciBpdCBoYXMgdG8gYmUgaW4gb25seSBvbmUgcGxhY2UgLSBnZXR0aW5nIHRoZSBnZW9tZXRyaWVzIGZvciBlYWNoIHR5cGUgZGlzdGFuY2VcclxuXHRcdFx0Ly8gbWF5YmUgaW4gdGhlIHNhbWUgcGxhY2UgZGlzdGFuY2VzIGFyZSBjYWxjdWxhdGVkLlxyXG5cdFx0XHQvLyBUSElTIElTIFRFTVBPUkFSWSBQQVRDSCB0byBnZXQgdGhlIG5lZWRlZCBwb2ludHNcclxuXHRcdFx0aWYgKCFpc05hTih0aGlzLmJpa2VTdGFydEtNKSkge1xyXG5cdFx0XHRcdGZvciAodmFyIGk9MDtpPHRoaXMuZGlzdGFuY2VzLmxlbmd0aDtpKyspIHtcclxuXHRcdFx0XHRcdGlmICh0aGlzLmRpc3RhbmNlc1tpXSA+PSB0aGlzLmJpa2VTdGFydEtNKjEwMDApXHJcblx0XHRcdFx0XHRcdGJyZWFrO1xyXG5cdFx0XHRcdH1cclxuXHRcdFx0XHR2YXIgajtcclxuXHRcdFx0XHRpZiAoIWlzTmFOKHRoaXMucnVuU3RhcnRLTSkpIHtcclxuXHRcdFx0XHRcdGZvciAoaj1pO2o8dGhpcy5kaXN0YW5jZXMubGVuZ3RoO2orKykge1xyXG5cdFx0XHRcdFx0XHRpZiAodGhpcy5kaXN0YW5jZXNbal0gPj0gdGhpcy5ydW5TdGFydEtNKjEwMDApXHJcblx0XHRcdFx0XHRcdFx0YnJlYWs7XHJcblx0XHRcdFx0XHR9XHJcblx0XHRcdFx0fSBlbHNlIHtcclxuXHRcdFx0XHRcdGo9dGhpcy5kaXN0YW5jZXMubGVuZ3RoO1xyXG5cdFx0XHRcdH1cclxuXHRcdFx0XHR2YXIgY29vcmRzPXRoaXMuZmVhdHVyZS5nZXRHZW9tZXRyeSgpLmdldENvb3JkaW5hdGVzKCk7XHJcblx0XHRcdFx0dmFyIGdlb21zd2ltPWNvb3Jkcy5zbGljZSgwLGkpO1xyXG5cdFx0XHRcdHZhciBnZW9tYmlrZT1jb29yZHMuc2xpY2UoaSA8IDEgPyBpIDogaS0xLGopO1xyXG5cdFx0XHRcdGlmIChqIDwgdGhpcy5kaXN0YW5jZXMubGVuZ3RoKVxyXG5cdFx0XHRcdFx0dmFyIGdlb21ydW49Y29vcmRzLnNsaWNlKGogPCAxID8gaiA6IGotMSx0aGlzLmRpc3RhbmNlcy5sZW5ndGgpO1xyXG5cdFx0XHRcdGlmICghZ2VvbXN3aW0ubGVuZ3RoKVxyXG5cdFx0XHRcdFx0Z2VvbXN3aW09bnVsbDtcclxuXHRcdFx0XHRpZiAoIWdlb21iaWtlLmxlbmd0aClcclxuXHRcdFx0XHRcdGdlb21iaWtlPW51bGw7XHJcblx0XHRcdFx0aWYgKCFnZW9tcnVuLmxlbmd0aClcclxuXHRcdFx0XHRcdGdlb21ydW49bnVsbDtcclxuXHRcdFx0fVxyXG5cclxuXHRcdFx0Zm9yICh2YXIgaSA9IDAsIGxlbiA9IGhvdHNwb3RzLmxlbmd0aDsgaSA8IGxlbjsgaSsrKSB7XHJcblx0XHRcdFx0dmFyIGhvdHNwb3QgPSBob3RzcG90c1tpXTtcclxuXHRcdFx0XHR2YXIgcG9pbnQ7XHJcblx0XHRcdFx0aWYgKGhvdHNwb3QudHlwZSA9PT0gQ09ORklHLmhvdHNwb3QuY2FtU3dpbUJpa2UpIHtcclxuXHRcdFx0XHRcdGlmICh0aGlzLmlzQWRkZWRIb3RTcG90U3dpbUJpa2UpIGNvbnRpbnVlOyAvLyBub3QgYWxsb3dlZCB0byBhZGQgdG8gc2FtZSBob3RzcG90c1xyXG5cdFx0XHRcdFx0aWYgKGdlb21iaWtlKSB7XHJcblx0XHRcdFx0XHRcdHBvaW50ID0gb2wucHJvai50cmFuc2Zvcm0oZ2VvbWJpa2VbMF0sICdFUFNHOjM4NTcnLCAnRVBTRzo0MzI2Jyk7XHJcblx0XHRcdFx0XHRcdHRoaXMuaXNBZGRlZEhvdFNwb3RTd2ltQmlrZSA9IHRydWU7XHJcblx0XHRcdFx0XHR9XHJcblx0XHRcdFx0fSBlbHNlIGlmIChob3RzcG90LnR5cGUgPT09IENPTkZJRy5ob3RzcG90LmNhbUJpa2VSdW4pIHtcclxuXHRcdFx0XHRcdGlmICh0aGlzLmlzQWRkZWRIb3RTcG90QmlrZVJ1bikgY29udGludWU7IC8vIG5vdCBhbGxvd2VkIHRvIGFkZCB0byBzYW1lIGhvdHNwb3RzXHJcblx0XHRcdFx0XHRpZiAoZ2VvbXJ1bikge1xyXG5cdFx0XHRcdFx0XHRwb2ludCA9IG9sLnByb2oudHJhbnNmb3JtKGdlb21ydW5bMF0sICdFUFNHOjM4NTcnLCAnRVBTRzo0MzI2Jyk7XHJcblx0XHRcdFx0XHRcdHRoaXMuaXNBZGRlZEhvdFNwb3RCaWtlUnVuID0gdHJ1ZTtcclxuXHRcdFx0XHRcdH1cclxuXHRcdFx0XHR9XHJcblx0XHRcdFx0aWYgKHBvaW50KVxyXG5cdFx0XHRcdFx0aG90c3BvdC5pbml0KHBvaW50KTtcclxuXHRcdFx0fVxyXG5cdFx0fSxcclxuXHRcdFxyXG5cdFx0b25NYXBDbGljayA6IGZ1bmN0aW9uKGV2ZW50KSBcclxuXHRcdHtcclxuXHRcdFx0aWYgKHRoaXMuZGVidWdQYXJ0aWNpcGFudCkgXHJcblx0XHRcdHtcclxuXHRcdFx0XHR0aGlzLmRlYnVnUGFydGljaXBhbnQub25EZWJ1Z0NsaWNrKGV2ZW50KTtcclxuXHRcdFx0fVxyXG5cdFx0fSxcclxuXHRcdFxyXG5cdFx0dGVzdDEgOiBmdW5jdGlvbigpIHtcclxuXHRcdFx0Lypjb25zb2xlLmxvZyhcIiNCRUdJTk5OTk5OTk5OTk5OTk5OTk5OTk5OTk5OTk5OTk5OTk5OTk5OTlwiKVxyXG5cdFx0XHRmb3IgKHZhciBpPTA7aTwzMDtpKyspIFxyXG5cdFx0XHR7XHJcblx0XHRcdFx0dmFyIGVsYXBzZWQgPSBpLzYwLjA7ICAvLygodG0gLSBzdGltZSkvMTAwMC4wKS90cmFja0luU2Vjb25kcyArIENvbmZpZy5zaW11bGF0aW9uLnN0YXJ0RWxhcHNlZDtcclxuXHRcdFx0XHRpZiAoZWxhcHNlZCA+IDEpXHJcblx0XHRcdFx0XHRlbGFwc2VkPTE7XHJcblx0XHRcdFx0Ly92YXIgcG9zID0gdHJhY2suZ2V0UG9zaXRpb25BbmRSb3RhdGlvbkZyb21FbGFwc2VkKGVsYXBzZWQpO1xyXG5cdFx0XHRcdHZhciBwb3MgPSB0aGlzLl9fZ2V0UG9zaXRpb25BbmRSb3RhdGlvbkZyb21FbGFwc2VkKGVsYXBzZWQpO1xyXG5cdFx0XHRcdGNvbnNvbGUubG9nKFtNYXRoLnJvdW5kKHBvc1swXSoxMDAwMDAwLjApLzEwMDAwMDAuMCxNYXRoLnJvdW5kKHBvc1sxXSoxMDAwMDAwLjApLzEwMDAwMDAuMF0pO1xyXG5cdFx0XHR9XHJcblx0XHRcdGNvbnNvbGUubG9nKFwiI0VORFwiKTsqL1xyXG5cdFx0fVxyXG5cclxuICAgIH1cclxufSk7IiwidmFyIHRvUmFkaWFucyA9IGZ1bmN0aW9uKGFuZ2xlRGVncmVlcykgeyByZXR1cm4gYW5nbGVEZWdyZWVzICogTWF0aC5QSSAvIDE4MDsgfTtcclxudmFyIHRvRGVncmVlcyA9IGZ1bmN0aW9uKGFuZ2xlUmFkaWFucykgeyByZXR1cm4gYW5nbGVSYWRpYW5zICogMTgwIC8gTWF0aC5QSTsgfTtcclxuXHJcbnZhciBXR1M4NFNwaGVyZSA9IGZ1bmN0aW9uKHJhZGl1cykge1xyXG4gIHRoaXMucmFkaXVzID0gcmFkaXVzO1xyXG59O1xyXG5cclxuV0dTODRTcGhlcmUucHJvdG90eXBlLmNvc2luZURpc3RhbmNlID0gZnVuY3Rpb24oYzEsIGMyKSB7XHJcbiAgdmFyIGxhdDEgPSB0b1JhZGlhbnMoYzFbMV0pO1xyXG4gIHZhciBsYXQyID0gdG9SYWRpYW5zKGMyWzFdKTtcclxuICB2YXIgZGVsdGFMb24gPSB0b1JhZGlhbnMoYzJbMF0gLSBjMVswXSk7XHJcbiAgcmV0dXJuIHRoaXMucmFkaXVzICogTWF0aC5hY29zKFxyXG4gICAgICBNYXRoLnNpbihsYXQxKSAqIE1hdGguc2luKGxhdDIpICtcclxuICAgICAgTWF0aC5jb3MobGF0MSkgKiBNYXRoLmNvcyhsYXQyKSAqIE1hdGguY29zKGRlbHRhTG9uKSk7XHJcbn07XHJcblxyXG5XR1M4NFNwaGVyZS5wcm90b3R5cGUuZ2VvZGVzaWNBcmVhID0gZnVuY3Rpb24oY29vcmRpbmF0ZXMpIHtcclxuICB2YXIgYXJlYSA9IDAsIGxlbiA9IGNvb3JkaW5hdGVzLmxlbmd0aDtcclxuICB2YXIgeDEgPSBjb29yZGluYXRlc1tsZW4gLSAxXVswXTtcclxuICB2YXIgeTEgPSBjb29yZGluYXRlc1tsZW4gLSAxXVsxXTtcclxuICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbjsgaSsrKSB7XHJcbiAgICB2YXIgeDIgPSBjb29yZGluYXRlc1tpXVswXSwgeTIgPSBjb29yZGluYXRlc1tpXVsxXTtcclxuICAgIGFyZWEgKz0gdG9SYWRpYW5zKHgyIC0geDEpICpcclxuICAgICAgICAoMiArIE1hdGguc2luKHRvUmFkaWFucyh5MSkpICtcclxuICAgICAgICBNYXRoLnNpbih0b1JhZGlhbnMoeTIpKSk7XHJcbiAgICB4MSA9IHgyO1xyXG4gICAgeTEgPSB5MjtcclxuICB9XHJcbiAgcmV0dXJuIGFyZWEgKiB0aGlzLnJhZGl1cyAqIHRoaXMucmFkaXVzIC8gMi4wO1xyXG59O1xyXG5cclxuV0dTODRTcGhlcmUucHJvdG90eXBlLmNyb3NzVHJhY2tEaXN0YW5jZSA9IGZ1bmN0aW9uKGMxLCBjMiwgYzMpIHtcclxuICB2YXIgZDEzID0gdGhpcy5jb3NpbmVEaXN0YW5jZShjMSwgYzIpO1xyXG4gIHZhciB0aGV0YTEyID0gdG9SYWRpYW5zKHRoaXMuaW5pdGlhbEJlYXJpbmcoYzEsIGMyKSk7XHJcbiAgdmFyIHRoZXRhMTMgPSB0b1JhZGlhbnModGhpcy5pbml0aWFsQmVhcmluZyhjMSwgYzMpKTtcclxuICByZXR1cm4gdGhpcy5yYWRpdXMgKlxyXG4gICAgICBNYXRoLmFzaW4oTWF0aC5zaW4oZDEzIC8gdGhpcy5yYWRpdXMpICogTWF0aC5zaW4odGhldGExMyAtIHRoZXRhMTIpKTtcclxufTtcclxuXHJcbldHUzg0U3BoZXJlLnByb3RvdHlwZS5lcXVpcmVjdGFuZ3VsYXJEaXN0YW5jZSA9IGZ1bmN0aW9uKGMxLCBjMikge1xyXG4gIHZhciBsYXQxID0gdG9SYWRpYW5zKGMxWzFdKTtcclxuICB2YXIgbGF0MiA9IHRvUmFkaWFucyhjMlsxXSk7XHJcbiAgdmFyIGRlbHRhTG9uID0gdG9SYWRpYW5zKGMyWzBdIC0gYzFbMF0pO1xyXG4gIHZhciB4ID0gZGVsdGFMb24gKiBNYXRoLmNvcygobGF0MSArIGxhdDIpIC8gMik7XHJcbiAgdmFyIHkgPSBsYXQyIC0gbGF0MTtcclxuICByZXR1cm4gdGhpcy5yYWRpdXMgKiBNYXRoLnNxcnQoeCAqIHggKyB5ICogeSk7XHJcbn07XHJcblxyXG5XR1M4NFNwaGVyZS5wcm90b3R5cGUuZmluYWxCZWFyaW5nID0gZnVuY3Rpb24oYzEsIGMyKSB7XHJcbiAgcmV0dXJuICh0aGlzLmluaXRpYWxCZWFyaW5nKGMyLCBjMSkgKyAxODApICUgMzYwO1xyXG59O1xyXG5cclxuV0dTODRTcGhlcmUucHJvdG90eXBlLmhhdmVyc2luZURpc3RhbmNlID0gZnVuY3Rpb24oYzEsIGMyKSB7XHJcbiAgdmFyIGxhdDEgPSB0b1JhZGlhbnMoYzFbMV0pO1xyXG4gIHZhciBsYXQyID0gdG9SYWRpYW5zKGMyWzFdKTtcclxuICB2YXIgZGVsdGFMYXRCeTIgPSAobGF0MiAtIGxhdDEpIC8gMjtcclxuICB2YXIgZGVsdGFMb25CeTIgPSB0b1JhZGlhbnMoYzJbMF0gLSBjMVswXSkgLyAyO1xyXG4gIHZhciBhID0gTWF0aC5zaW4oZGVsdGFMYXRCeTIpICogTWF0aC5zaW4oZGVsdGFMYXRCeTIpICtcclxuICAgICAgTWF0aC5zaW4oZGVsdGFMb25CeTIpICogTWF0aC5zaW4oZGVsdGFMb25CeTIpICpcclxuICAgICAgTWF0aC5jb3MobGF0MSkgKiBNYXRoLmNvcyhsYXQyKTtcclxuICByZXR1cm4gMiAqIHRoaXMucmFkaXVzICogTWF0aC5hdGFuMihNYXRoLnNxcnQoYSksIE1hdGguc3FydCgxIC0gYSkpO1xyXG59O1xyXG5cclxuV0dTODRTcGhlcmUucHJvdG90eXBlLmludGVycG9sYXRlID0gZnVuY3Rpb24oYzEsIGMyLCBmcmFjdGlvbikge1xyXG4gIHZhciBsYXQxID0gdG9SYWRpYW5zKGMxWzFdKTtcclxuICB2YXIgbG9uMSA9IHRvUmFkaWFucyhjMVswXSk7XHJcbiAgdmFyIGxhdDIgPSB0b1JhZGlhbnMoYzJbMV0pO1xyXG4gIHZhciBsb24yID0gdG9SYWRpYW5zKGMyWzBdKTtcclxuICB2YXIgY29zTGF0MSA9IE1hdGguY29zKGxhdDEpO1xyXG4gIHZhciBzaW5MYXQxID0gTWF0aC5zaW4obGF0MSk7XHJcbiAgdmFyIGNvc0xhdDIgPSBNYXRoLmNvcyhsYXQyKTtcclxuICB2YXIgc2luTGF0MiA9IE1hdGguc2luKGxhdDIpO1xyXG4gIHZhciBjb3NEZWx0YUxvbiA9IE1hdGguY29zKGxvbjIgLSBsb24xKTtcclxuICB2YXIgZCA9IHNpbkxhdDEgKiBzaW5MYXQyICsgY29zTGF0MSAqIGNvc0xhdDIgKiBjb3NEZWx0YUxvbjtcclxuICBpZiAoMSA8PSBkKSB7XHJcbiAgICByZXR1cm4gYzIuc2xpY2UoKTtcclxuICB9XHJcbiAgZCA9IGZyYWN0aW9uICogTWF0aC5hY29zKGQpO1xyXG4gIHZhciBjb3NEID0gTWF0aC5jb3MoZCk7XHJcbiAgdmFyIHNpbkQgPSBNYXRoLnNpbihkKTtcclxuICB2YXIgeSA9IE1hdGguc2luKGxvbjIgLSBsb24xKSAqIGNvc0xhdDI7XHJcbiAgdmFyIHggPSBjb3NMYXQxICogc2luTGF0MiAtIHNpbkxhdDEgKiBjb3NMYXQyICogY29zRGVsdGFMb247XHJcbiAgdmFyIHRoZXRhID0gTWF0aC5hdGFuMih5LCB4KTtcclxuICB2YXIgbGF0ID0gTWF0aC5hc2luKHNpbkxhdDEgKiBjb3NEICsgY29zTGF0MSAqIHNpbkQgKiBNYXRoLmNvcyh0aGV0YSkpO1xyXG4gIHZhciBsb24gPSBsb24xICsgTWF0aC5hdGFuMihNYXRoLnNpbih0aGV0YSkgKiBzaW5EICogY29zTGF0MSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29zRCAtIHNpbkxhdDEgKiBNYXRoLnNpbihsYXQpKTtcclxuICByZXR1cm4gW3RvRGVncmVlcyhsb24pLCB0b0RlZ3JlZXMobGF0KV07XHJcbn07XHJcblxyXG5XR1M4NFNwaGVyZS5wcm90b3R5cGUuaW5pdGlhbEJlYXJpbmcgPSBmdW5jdGlvbihjMSwgYzIpIHtcclxuICB2YXIgbGF0MSA9IHRvUmFkaWFucyhjMVsxXSk7XHJcbiAgdmFyIGxhdDIgPSB0b1JhZGlhbnMoYzJbMV0pO1xyXG4gIHZhciBkZWx0YUxvbiA9IHRvUmFkaWFucyhjMlswXSAtIGMxWzBdKTtcclxuICB2YXIgeSA9IE1hdGguc2luKGRlbHRhTG9uKSAqIE1hdGguY29zKGxhdDIpO1xyXG4gIHZhciB4ID0gTWF0aC5jb3MobGF0MSkgKiBNYXRoLnNpbihsYXQyKSAtXHJcbiAgICAgIE1hdGguc2luKGxhdDEpICogTWF0aC5jb3MobGF0MikgKiBNYXRoLmNvcyhkZWx0YUxvbik7XHJcbiAgcmV0dXJuIHRvRGVncmVlcyhNYXRoLmF0YW4yKHksIHgpKTtcclxufTtcclxuXHJcbldHUzg0U3BoZXJlLnByb3RvdHlwZS5tYXhpbXVtTGF0aXR1ZGUgPSBmdW5jdGlvbihiZWFyaW5nLCBsYXRpdHVkZSkge1xyXG4gIHJldHVybiBNYXRoLmNvcyhNYXRoLmFicyhNYXRoLnNpbih0b1JhZGlhbnMoYmVhcmluZykpICpcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgTWF0aC5jb3ModG9SYWRpYW5zKGxhdGl0dWRlKSkpKTtcclxufTtcclxuXHJcbldHUzg0U3BoZXJlLnByb3RvdHlwZS5taWRwb2ludCA9IGZ1bmN0aW9uKGMxLCBjMikge1xyXG4gIHZhciBsYXQxID0gdG9SYWRpYW5zKGMxWzFdKTtcclxuICB2YXIgbGF0MiA9IHRvUmFkaWFucyhjMlsxXSk7XHJcbiAgdmFyIGxvbjEgPSB0b1JhZGlhbnMoYzFbMF0pO1xyXG4gIHZhciBkZWx0YUxvbiA9IHRvUmFkaWFucyhjMlswXSAtIGMxWzBdKTtcclxuICB2YXIgQnggPSBNYXRoLmNvcyhsYXQyKSAqIE1hdGguY29zKGRlbHRhTG9uKTtcclxuICB2YXIgQnkgPSBNYXRoLmNvcyhsYXQyKSAqIE1hdGguc2luKGRlbHRhTG9uKTtcclxuICB2YXIgY29zTGF0MVBsdXNCeCA9IE1hdGguY29zKGxhdDEpICsgQng7XHJcbiAgdmFyIGxhdCA9IE1hdGguYXRhbjIoTWF0aC5zaW4obGF0MSkgKyBNYXRoLnNpbihsYXQyKSxcclxuICAgICAgICAgICAgICAgICAgICAgICBNYXRoLnNxcnQoY29zTGF0MVBsdXNCeCAqIGNvc0xhdDFQbHVzQnggKyBCeSAqIEJ5KSk7XHJcbiAgdmFyIGxvbiA9IGxvbjEgKyBNYXRoLmF0YW4yKEJ5LCBjb3NMYXQxUGx1c0J4KTtcclxuICByZXR1cm4gW3RvRGVncmVlcyhsb24pLCB0b0RlZ3JlZXMobGF0KV07XHJcbn07XHJcblxyXG5XR1M4NFNwaGVyZS5wcm90b3R5cGUub2Zmc2V0ID0gZnVuY3Rpb24oYzEsIGRpc3RhbmNlLCBiZWFyaW5nKSB7XHJcbiAgdmFyIGxhdDEgPSB0b1JhZGlhbnMoYzFbMV0pO1xyXG4gIHZhciBsb24xID0gdG9SYWRpYW5zKGMxWzBdKTtcclxuICB2YXIgZEJ5UiA9IGRpc3RhbmNlIC8gdGhpcy5yYWRpdXM7XHJcbiAgdmFyIGxhdCA9IE1hdGguYXNpbihcclxuICAgICAgTWF0aC5zaW4obGF0MSkgKiBNYXRoLmNvcyhkQnlSKSArXHJcbiAgICAgIE1hdGguY29zKGxhdDEpICogTWF0aC5zaW4oZEJ5UikgKiBNYXRoLmNvcyhiZWFyaW5nKSk7XHJcbiAgdmFyIGxvbiA9IGxvbjEgKyBNYXRoLmF0YW4yKFxyXG4gICAgICBNYXRoLnNpbihiZWFyaW5nKSAqIE1hdGguc2luKGRCeVIpICogTWF0aC5jb3MobGF0MSksXHJcbiAgICAgIE1hdGguY29zKGRCeVIpIC0gTWF0aC5zaW4obGF0MSkgKiBNYXRoLnNpbihsYXQpKTtcclxuICByZXR1cm4gW3RvRGVncmVlcyhsb24pLCB0b0RlZ3JlZXMobGF0KV07XHJcbn07XHJcblxyXG4vKipcclxuICogQ2hlY2tzIHdoZXRoZXIgb2JqZWN0IGlzIG5vdCBudWxsIGFuZCBub3QgdW5kZWZpbmVkXHJcbiAqIEBwYXJhbSB7Kn0gb2JqIG9iamVjdCB0byBiZSBjaGVja2VkXHJcbiAqIEByZXR1cm4ge2Jvb2xlYW59XHJcbiAqL1xyXG5cclxuZnVuY3Rpb24gaXNEZWZpbmVkKG9iaikge1xyXG4gICAgcmV0dXJuIG51bGwgIT0gb2JqICYmIHVuZGVmaW5lZCAhPSBvYmo7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGlzTnVtZXJpYyh3aCkge1xyXG4gICAgcmV0dXJuICFpc05hTihwYXJzZUZsb2F0KHdoKSkgJiYgaXNGaW5pdGUod2gpO1xyXG59XHJcblxyXG5mdW5jdGlvbiBpc0Z1bmN0aW9uKHdoKSB7XHJcbiAgICBpZiAoIXdoKSB7XHJcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuICh3aCBpbnN0YW5jZW9mIEZ1bmN0aW9uIHx8IHR5cGVvZiB3aCA9PSBcImZ1bmN0aW9uXCIpO1xyXG59XHJcblxyXG5mdW5jdGlvbiBpc1N0cmluZ05vdEVtcHR5KHdoKSB7XHJcbiAgICBpZiAoIXdoKSB7XHJcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuICh3aCBpbnN0YW5jZW9mIFN0cmluZyB8fCB0eXBlb2Ygd2ggPT0gXCJzdHJpbmdcIik7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGlzU3RyKHdoKSB7XHJcbiAgICByZXR1cm4gKHdoIGluc3RhbmNlb2YgU3RyaW5nIHx8IHR5cGVvZiB3aCA9PT0gXCJzdHJpbmdcIik7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGlzQm9vbGVhbih3aCkge1xyXG4gICAgcmV0dXJuICh3aCBpbnN0YW5jZW9mIEJvb2xlYW4gfHwgdHlwZW9mIHdoID09IFwiYm9vbGVhblwiKTtcclxufVxyXG5cclxuZnVuY3Rpb24gbXlUcmltKHgpIHtcclxuICAgIHJldHVybiB4LnJlcGxhY2UoL15cXHMrfFxccyskL2dtLCcnKTtcclxufVxyXG5cclxuZnVuY3Rpb24gbXlUcmltQ29vcmRpbmF0ZSh4KSB7XHJcblx0ZG8ge1xyXG5cdFx0dmFyIGs9eDtcclxuXHRcdHg9bXlUcmltKHgpO1xyXG5cdFx0aWYgKGsgIT0geCkgXHJcblx0XHRcdGNvbnRpbnVlO1xyXG5cdFx0aWYgKHgubGVuZ3RoKSBcclxuXHRcdHtcclxuXHRcdFx0aWYgKHhbMF0gPT0gXCIsXCIpXHJcblx0XHRcdFx0eD14LnN1YnN0cmluZygxLHgubGVuZ3RoKTtcclxuXHRcdFx0ZWxzZSBpZiAoa1trLmxlbmd0aC0xXSA9PSBcIixcIilcclxuXHRcdFx0XHR4PXguc3Vic3RyaW5nKDAseC5sZW5ndGgtMSk7XHJcblx0XHRcdGVsc2VcclxuXHRcdFx0XHRicmVhaztcclxuXHRcdFx0Y29udGludWU7XHJcblx0XHR9XHJcblx0XHRicmVhaztcclxuXHR9IHdoaWxlICh0cnVlKTtcclxuXHRyZXR1cm4geDtcclxufVxyXG5cclxuXHJcbmZ1bmN0aW9uIGNsb3Nlc3RQcm9qZWN0aW9uT2ZQb2ludE9uTGluZSh4LHkseDEseTEseDIseTIpIFxyXG57XHJcblx0dmFyIHN0YXR1cztcclxuXHR2YXIgUDE9bnVsbDtcclxuXHR2YXIgUDI9bnVsbDtcclxuXHR2YXIgUDM9bnVsbDtcclxuXHR2YXIgUDQ9bnVsbDtcclxuXHR2YXIgcDE9W107XHJcbiAgICB2YXIgcDI9W107XHJcbiAgICB2YXIgcDM9W107XHJcblx0dmFyIHA0PVtdO1xyXG4gICAgdmFyIGludGVyc2VjdGlvblBvaW50PW51bGw7XHJcbiAgICB2YXIgZGlzdE1pblBvaW50PW51bGw7XHJcbiAgICB2YXIgZGVub21pbmF0b3I9MDtcclxuICAgIHZhciBub21pbmF0b3I9MDtcclxuICAgIHZhciB1PTA7XHJcbiAgICB2YXIgZGlzdE9ydGhvPTA7XHJcbiAgICB2YXIgZGlzdFAxPTA7XHJcbiAgICB2YXIgZGlzdFAyPTA7XHJcbiAgICB2YXIgZGlzdE1pbj0wO1xyXG4gICAgdmFyIGRpc3RNYXg9MDtcclxuICAgXHJcbiAgICBmdW5jdGlvbiBpbnRlcnNlY3Rpb24oKVxyXG4gICAge1xyXG4gICAgICAgIHZhciBheCA9IHAxWzBdICsgdSAqIChwMlswXSAtIHAxWzBdKTtcclxuICAgICAgICB2YXIgYXkgPSBwMVsxXSArIHUgKiAocDJbMV0gLSBwMVsxXSk7XHJcbiAgICAgICAgcDQgPSBbYXgsIGF5XTtcclxuICAgICAgICBpbnRlcnNlY3Rpb25Qb2ludCA9IFtheCxheV07XHJcbiAgICB9XHJcblxyXG4gICAgZnVuY3Rpb24gZGlzdGFuY2UoKVxyXG4gICAge1xyXG4gICAgICAgIHZhciBheCA9IHAxWzBdICsgdSAqIChwMlswXSAtIHAxWzBdKTtcclxuICAgICAgICB2YXIgYXkgPSBwMVsxXSArIHUgKiAocDJbMV0gLSBwMVsxXSk7XHJcbiAgICAgICAgcDQgPSBbYXgsIGF5XTtcclxuICAgICAgICBkaXN0T3J0aG8gPSBNYXRoLnNxcnQoTWF0aC5wb3coKHA0WzBdIC0gcDNbMF0pLDIpICsgTWF0aC5wb3coKHA0WzFdIC0gcDNbMV0pLDIpKTtcclxuICAgICAgICBkaXN0UDEgICAgPSBNYXRoLnNxcnQoTWF0aC5wb3coKHAxWzBdIC0gcDNbMF0pLDIpICsgTWF0aC5wb3coKHAxWzFdIC0gcDNbMV0pLDIpKTtcclxuICAgICAgICBkaXN0UDIgICAgPSBNYXRoLnNxcnQoTWF0aC5wb3coKHAyWzBdIC0gcDNbMF0pLDIpICsgTWF0aC5wb3coKHAyWzFdIC0gcDNbMV0pLDIpKTtcclxuICAgICAgICBpZih1Pj0wICYmIHU8PTEpXHJcbiAgICAgICAgeyAgIGRpc3RNaW4gPSBkaXN0T3J0aG87XHJcbiAgICAgICAgICAgIGRpc3RNaW5Qb2ludCA9IGludGVyc2VjdGlvblBvaW50O1xyXG4gICAgICAgIH1cclxuICAgICAgICBlbHNlXHJcbiAgICAgICAgeyAgIGlmKGRpc3RQMSA8PSBkaXN0UDIpXHJcbiAgICAgICAgICAgIHsgICBkaXN0TWluID0gZGlzdFAxO1xyXG4gICAgICAgICAgICAgICAgZGlzdE1pblBvaW50ID0gUDE7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgZWxzZVxyXG4gICAgICAgICAgICB7ICAgZGlzdE1pbiA9IGRpc3RQMjtcclxuICAgICAgICAgICAgICAgIGRpc3RNaW5Qb2ludCA9IFAyO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGRpc3RNYXggPSBNYXRoLm1heChNYXRoLm1heChkaXN0T3J0aG8sIGRpc3RQMSksIGRpc3RQMik7XHJcbiAgICB9XHJcblx0UDEgPSBbeDEseTFdO1xyXG5cdFAyID0gW3gyLHkyXTtcclxuXHRQMyA9IFt4LHldO1xyXG5cdHAxID0gW3gxLCB5MV07XHJcblx0cDIgPSBbeDIsIHkyXTtcclxuXHRwMyA9IFt4LCB5XTtcclxuXHRkZW5vbWluYXRvciA9IE1hdGgucG93KE1hdGguc3FydChNYXRoLnBvdyhwMlswXS1wMVswXSwyKSArIE1hdGgucG93KHAyWzFdLXAxWzFdLDIpKSwyICk7XHJcblx0bm9taW5hdG9yICAgPSAocDNbMF0gLSBwMVswXSkgKiAocDJbMF0gLSBwMVswXSkgKyAocDNbMV0gLSBwMVsxXSkgKiAocDJbMV0gLSBwMVsxXSk7XHJcblx0aWYoZGVub21pbmF0b3I9PTApXHJcblx0eyAgIHN0YXR1cyA9IFwiY29pbmNpZGVudGFsXCJcclxuXHRcdHUgPSAtOTk5O1xyXG5cdH1cclxuXHRlbHNlXHJcblx0eyAgIHUgPSBub21pbmF0b3IgLyBkZW5vbWluYXRvcjtcclxuXHRcdGlmKHUgPj0wICYmIHUgPD0gMSlcclxuXHRcdFx0c3RhdHVzID0gXCJvcnRob2dvbmFsXCI7XHJcblx0XHRlbHNlXHJcblx0XHRcdHN0YXR1cyA9IFwib2JsaXF1ZVwiO1xyXG5cdH1cclxuXHRpbnRlcnNlY3Rpb24oKTtcclxuXHRkaXN0YW5jZSgpO1xyXG5cdFxyXG5cdHJldHVybiB7IHN0YXR1cyA6IHN0YXR1cywgcG9zIDogZGlzdE1pblBvaW50LCBtaW4gOiBkaXN0TWluIH07XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGNvbG9yTHVtaW5hbmNlKGhleCwgbHVtKSB7XHJcbiAgICAvLyBWYWxpZGF0ZSBoZXggc3RyaW5nXHJcbiAgICBoZXggPSBTdHJpbmcoaGV4KS5yZXBsYWNlKC9bXjAtOWEtZl0vZ2ksIFwiXCIpO1xyXG4gICAgaWYgKGhleC5sZW5ndGggPCA2KSB7XHJcbiAgICAgICAgaGV4ID0gaGV4LnJlcGxhY2UoLyguKS9nLCAnJDEkMScpO1xyXG4gICAgfVxyXG4gICAgbHVtID0gbHVtIHx8IDA7XHJcbiAgICAvLyBDb252ZXJ0IHRvIGRlY2ltYWwgYW5kIGNoYW5nZSBsdW1pbm9zaXR5XHJcbiAgICB2YXIgcmdiID0gXCIjXCIsXHJcbiAgICAgICAgYztcclxuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgMzsgKytpKSB7XHJcbiAgICAgICAgYyA9IHBhcnNlSW50KGhleC5zdWJzdHIoaSAqIDIsIDIpLCAxNik7XHJcbiAgICAgICAgYyA9IE1hdGgucm91bmQoTWF0aC5taW4oTWF0aC5tYXgoMCwgYyArIChjICogbHVtKSksIDI1NSkpLnRvU3RyaW5nKDE2KTtcclxuICAgICAgICByZ2IgKz0gKFwiMDBcIiArIGMpLnN1YnN0cihjLmxlbmd0aCk7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gcmdiO1xyXG59XHJcblxyXG5mdW5jdGlvbiBpbmNyZWFzZUJyaWdodG5lc3MoaGV4LCBwZXJjZW50KSBcclxue1xyXG4gICAgaGV4ID0gU3RyaW5nKGhleCkucmVwbGFjZSgvW14wLTlhLWZdL2dpLCBcIlwiKTtcclxuICAgIGlmIChoZXgubGVuZ3RoIDwgNikge1xyXG4gICAgICAgIGhleCA9IGhleC5yZXBsYWNlKC8oLikvZywgJyQxJDEnKTtcclxuICAgIH1cclxuICAgIHZhciByZ2IgPSBcIiNcIixcclxuICAgICAgICBjO1xyXG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCAzOyArK2kpIHtcclxuICAgICAgICBjID0gcGFyc2VJbnQoaGV4LnN1YnN0cihpICogMiwgMiksIDE2KTtcclxuICAgICAgICBjID0gcGFyc2VJbnQoKGMqKDEwMC1wZXJjZW50KSsyNTUqcGVyY2VudCkvMTAwKTtcclxuICAgICAgICBpZiAoYyA+IDI1NSlcclxuICAgICAgICBcdGM9MjU1O1xyXG4gICAgICAgIGM9Yy50b1N0cmluZygxNik7XHJcbiAgICAgICAgcmdiICs9IChcIjAwXCIgKyBjKS5zdWJzdHIoYy5sZW5ndGgpO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIHJnYjtcclxufVxyXG5cclxuZnVuY3Rpb24gY29sb3JBbHBoYUFycmF5KGhleCwgYWxwaGEpIHtcclxuICAgIGhleCA9IFN0cmluZyhoZXgpLnJlcGxhY2UoL1teMC05YS1mXS9naSwgXCJcIik7XHJcbiAgICBpZiAoaGV4Lmxlbmd0aCA8IDYpIHtcclxuICAgICAgICBoZXggPSBoZXgucmVwbGFjZSgvKC4pL2csICckMSQxJyk7XHJcbiAgICB9XHJcbiAgICB2YXIgcmVzPVtdO1xyXG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCAzOyArK2kpIHtcclxuICAgICAgICBjID0gcGFyc2VJbnQoaGV4LnN1YnN0cihpICogMiwgMiksIDE2KTtcclxuICAgICAgICByZXMucHVzaChjKTtcclxuICAgIH1cclxuICAgIHJlcy5wdXNoKGFscGhhKTtcclxuICAgIHJldHVybiByZXM7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGVzY2FwZUhUTUwodW5zYWZlKSB7XHJcbiAgICByZXR1cm4gdW5zYWZlXHJcbiAgICAgICAgIC5yZXBsYWNlKC8mL2csIFwiJmFtcDtcIilcclxuICAgICAgICAgLnJlcGxhY2UoLzwvZywgXCImbHQ7XCIpXHJcbiAgICAgICAgIC5yZXBsYWNlKC8+L2csIFwiJmd0O1wiKVxyXG4gICAgICAgICAucmVwbGFjZSgvXCIvZywgXCImcXVvdDtcIilcclxuICAgICAgICAgLnJlcGxhY2UoLycvZywgXCImIzAzOTtcIik7XHJcbiB9XHJcblxyXG5mdW5jdGlvbiBmb3JtYXROdW1iZXIyKHZhbCkge1xyXG5cdHJldHVybiBwYXJzZUZsb2F0KE1hdGgucm91bmQodmFsICogMTAwKSAvIDEwMCkudG9GaXhlZCgyKTtcclxufVxyXG5mdW5jdGlvbiBmb3JtYXREYXRlKGQpIHtcclxuIFx0dmFyIGRkID0gZC5nZXREYXRlKCk7XHJcbiAgICB2YXIgbW0gPSBkLmdldE1vbnRoKCkrMTsgLy9KYW51YXJ5IGlzIDAhXHJcbiAgICB2YXIgeXl5eSA9IGQuZ2V0RnVsbFllYXIoKTtcclxuICAgIGlmKGRkPDEwKXtcclxuICAgICAgICBkZD0nMCcrZGQ7XHJcbiAgICB9IFxyXG4gICAgaWYobW08MTApe1xyXG4gICAgICAgIG1tPScwJyttbTtcclxuICAgIH0gXHJcbiAgICByZXR1cm4gZGQrJy4nK21tKycuJyt5eXl5O1xyXG59XHJcblxyXG5mdW5jdGlvbiBmb3JtYXRUaW1lKGQpIHtcclxuICAgIHZhciBoaCA9IGQuZ2V0SG91cnMoKTtcclxuICAgIGlmKGhoPDEwKXtcclxuICAgIFx0aGg9JzAnK2hoO1xyXG4gICAgfSBcclxuICAgIHZhciBtbSA9IGQuZ2V0TWludXRlcygpO1xyXG4gICAgaWYobW08MTApe1xyXG4gICAgICAgIG1tPScwJyttbTtcclxuICAgIH0gXHJcbiAgICByZXR1cm4gaGgrXCI6XCIrbW07XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGZvcm1hdERhdGVUaW1lKGQpIHtcclxuXHRyZXR1cm4gZm9ybWF0RGF0ZShkKStcIiBcIitmb3JtYXRUaW1lKGQpO1xyXG59XHJcblxyXG5mdW5jdGlvbiBmb3JtYXREYXRlVGltZVNlYyhkKSB7XHJcblx0cmV0dXJuIGZvcm1hdERhdGUoZCkrXCIgXCIrZm9ybWF0VGltZVNlYyhkKTtcclxufVxyXG5cclxuZnVuY3Rpb24gZm9ybWF0VGltZVNlYyhkKSB7XHJcbiAgICB2YXIgaGggPSBkLmdldEhvdXJzKCk7XHJcbiAgICBpZihoaDwxMCl7XHJcbiAgICBcdGhoPScwJytoaDtcclxuICAgIH0gXHJcbiAgICB2YXIgbW0gPSBkLmdldE1pbnV0ZXMoKTtcclxuICAgIGlmKG1tPDEwKXtcclxuICAgICAgICBtbT0nMCcrbW07XHJcbiAgICB9IFxyXG4gICAgdmFyIHNzID0gZC5nZXRTZWNvbmRzKCk7XHJcbiAgICBpZihzczwxMCl7XHJcbiAgICAgICAgc3M9JzAnK3NzO1xyXG4gICAgfSBcclxuICAgIHJldHVybiBoaCtcIjpcIittbStcIjpcIitzcztcclxufVxyXG5cclxuZnVuY3Rpb24gcmFpbmJvdyhudW1PZlN0ZXBzLCBzdGVwKSB7XHJcbiAgICAvLyBUaGlzIGZ1bmN0aW9uIGdlbmVyYXRlcyB2aWJyYW50LCBcImV2ZW5seSBzcGFjZWRcIiBjb2xvdXJzIChpLmUuIG5vIGNsdXN0ZXJpbmcpLiBUaGlzIGlzIGlkZWFsIGZvciBjcmVhdGluZyBlYXNpbHkgZGlzdGluZ3Vpc2hhYmxlIHZpYnJhbnQgbWFya2VycyBpbiBHb29nbGUgTWFwcyBhbmQgb3RoZXIgYXBwcy5cclxuICAgIC8vIEFkYW0gQ29sZSwgMjAxMS1TZXB0LTE0XHJcbiAgICAvLyBIU1YgdG8gUkJHIGFkYXB0ZWQgZnJvbTogaHR0cDovL21qaWphY2tzb24uY29tLzIwMDgvMDIvcmdiLXRvLWhzbC1hbmQtcmdiLXRvLWhzdi1jb2xvci1tb2RlbC1jb252ZXJzaW9uLWFsZ29yaXRobXMtaW4tamF2YXNjcmlwdFxyXG4gICAgdmFyIHIsIGcsIGI7XHJcbiAgICB2YXIgaCA9IHN0ZXAgLyBudW1PZlN0ZXBzO1xyXG4gICAgdmFyIGkgPSB+fihoICogNik7XHJcbiAgICB2YXIgZiA9IGggKiA2IC0gaTtcclxuICAgIHZhciBxID0gMSAtIGY7XHJcbiAgICBzd2l0Y2goaSAlIDYpe1xyXG4gICAgICAgIGNhc2UgMDogciA9IDEsIGcgPSBmLCBiID0gMDsgYnJlYWs7XHJcbiAgICAgICAgY2FzZSAxOiByID0gcSwgZyA9IDEsIGIgPSAwOyBicmVhaztcclxuICAgICAgICBjYXNlIDI6IHIgPSAwLCBnID0gMSwgYiA9IGY7IGJyZWFrO1xyXG4gICAgICAgIGNhc2UgMzogciA9IDAsIGcgPSBxLCBiID0gMTsgYnJlYWs7XHJcbiAgICAgICAgY2FzZSA0OiByID0gZiwgZyA9IDAsIGIgPSAxOyBicmVhaztcclxuICAgICAgICBjYXNlIDU6IHIgPSAxLCBnID0gMCwgYiA9IHE7IGJyZWFrO1xyXG4gICAgfVxyXG4gICAgdmFyIGMgPSBcIiNcIiArIChcIjAwXCIgKyAofiB+KHIgKiAyNTUpKS50b1N0cmluZygxNikpLnNsaWNlKC0yKSArIChcIjAwXCIgKyAofiB+KGcgKiAyNTUpKS50b1N0cmluZygxNikpLnNsaWNlKC0yKSArIChcIjAwXCIgKyAofiB+KGIgKiAyNTUpKS50b1N0cmluZygxNikpLnNsaWNlKC0yKTtcclxuICAgIHJldHVybiAoYyk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIG1vYmlsZUFuZFRhYmxldENoZWNrKCkgXHJcbntcclxuXHQgIGlmICh0eXBlb2YgbmF2aWdhdG9yID09IFwidW5kZWZpbmVkXCIpXHJcblx0XHQgIHJldHVybiBmYWxzZTtcclxuXHQgIHZhciBjaGVjayA9IGZhbHNlO1xyXG5cdCAgKGZ1bmN0aW9uKGEpe2lmKC8oYW5kcm9pZHxiYlxcZCt8bWVlZ28pLittb2JpbGV8YXZhbnRnb3xiYWRhXFwvfGJsYWNrYmVycnl8YmxhemVyfGNvbXBhbHxlbGFpbmV8ZmVubmVjfGhpcHRvcHxpZW1vYmlsZXxpcChob25lfG9kKXxpcmlzfGtpbmRsZXxsZ2UgfG1hZW1vfG1pZHB8bW1wfG1vYmlsZS4rZmlyZWZveHxuZXRmcm9udHxvcGVyYSBtKG9ifGluKWl8cGFsbSggb3MpP3xwaG9uZXxwKGl4aXxyZSlcXC98cGx1Y2tlcnxwb2NrZXR8cHNwfHNlcmllcyg0fDYpMHxzeW1iaWFufHRyZW98dXBcXC4oYnJvd3NlcnxsaW5rKXx2b2RhZm9uZXx3YXB8d2luZG93cyBjZXx4ZGF8eGlpbm98YW5kcm9pZHxpcGFkfHBsYXlib29rfHNpbGsvaS50ZXN0KGEpfHwvMTIwN3w2MzEwfDY1OTB8M2dzb3w0dGhwfDUwWzEtNl1pfDc3MHN8ODAyc3xhIHdhfGFiYWN8YWMoZXJ8b298c1xcLSl8YWkoa298cm4pfGFsKGF2fGNhfGNvKXxhbW9pfGFuKGV4fG55fHl3KXxhcHR1fGFyKGNofGdvKXxhcyh0ZXx1cyl8YXR0d3xhdShkaXxcXC1tfHIgfHMgKXxhdmFufGJlKGNrfGxsfG5xKXxiaShsYnxyZCl8YmwoYWN8YXopfGJyKGV8dil3fGJ1bWJ8YndcXC0obnx1KXxjNTVcXC98Y2FwaXxjY3dhfGNkbVxcLXxjZWxsfGNodG18Y2xkY3xjbWRcXC18Y28obXB8bmQpfGNyYXd8ZGEoaXR8bGx8bmcpfGRidGV8ZGNcXC1zfGRldml8ZGljYXxkbW9ifGRvKGN8cClvfGRzKDEyfFxcLWQpfGVsKDQ5fGFpKXxlbShsMnx1bCl8ZXIoaWN8azApfGVzbDh8ZXooWzQtN10wfG9zfHdhfHplKXxmZXRjfGZseShcXC18Xyl8ZzEgdXxnNTYwfGdlbmV8Z2ZcXC01fGdcXC1tb3xnbyhcXC53fG9kKXxncihhZHx1bil8aGFpZXxoY2l0fGhkXFwtKG18cHx0KXxoZWlcXC18aGkocHR8dGEpfGhwKCBpfGlwKXxoc1xcLWN8aHQoYyhcXC18IHxffGF8Z3xwfHN8dCl8dHApfGh1KGF3fHRjKXxpXFwtKDIwfGdvfG1hKXxpMjMwfGlhYyggfFxcLXxcXC8pfGlicm98aWRlYXxpZzAxfGlrb218aW0xa3xpbm5vfGlwYXF8aXJpc3xqYSh0fHYpYXxqYnJvfGplbXV8amlnc3xrZGRpfGtlaml8a2d0KCB8XFwvKXxrbG9ufGtwdCB8a3djXFwtfGt5byhjfGspfGxlKG5vfHhpKXxsZyggZ3xcXC8oa3xsfHUpfDUwfDU0fFxcLVthLXddKXxsaWJ3fGx5bnh8bTFcXC13fG0zZ2F8bTUwXFwvfG1hKHRlfHVpfHhvKXxtYygwMXwyMXxjYSl8bVxcLWNyfG1lKHJjfHJpKXxtaShvOHxvYXx0cyl8bW1lZnxtbygwMXwwMnxiaXxkZXxkb3x0KFxcLXwgfG98dil8enopfG10KDUwfHAxfHYgKXxtd2JwfG15d2F8bjEwWzAtMl18bjIwWzItM118bjMwKDB8Mil8bjUwKDB8Mnw1KXxuNygwKDB8MSl8MTApfG5lKChjfG0pXFwtfG9ufHRmfHdmfHdnfHd0KXxub2soNnxpKXxuenBofG8yaW18b3AodGl8d3YpfG9yYW58b3dnMXxwODAwfHBhbihhfGR8dCl8cGR4Z3xwZygxM3xcXC0oWzEtOF18YykpfHBoaWx8cGlyZXxwbChheXx1Yyl8cG5cXC0yfHBvKGNrfHJ0fHNlKXxwcm94fHBzaW98cHRcXC1nfHFhXFwtYXxxYygwN3wxMnwyMXwzMnw2MHxcXC1bMi03XXxpXFwtKXxxdGVrfHIzODB8cjYwMHxyYWtzfHJpbTl8cm8odmV8em8pfHM1NVxcL3xzYShnZXxtYXxtbXxtc3xueXx2YSl8c2MoMDF8aFxcLXxvb3xwXFwtKXxzZGtcXC98c2UoYyhcXC18MHwxKXw0N3xtY3xuZHxyaSl8c2doXFwtfHNoYXJ8c2llKFxcLXxtKXxza1xcLTB8c2woNDV8aWQpfHNtKGFsfGFyfGIzfGl0fHQ1KXxzbyhmdHxueSl8c3AoMDF8aFxcLXx2XFwtfHYgKXxzeSgwMXxtYil8dDIoMTh8NTApfHQ2KDAwfDEwfDE4KXx0YShndHxsayl8dGNsXFwtfHRkZ1xcLXx0ZWwoaXxtKXx0aW1cXC18dFxcLW1vfHRvKHBsfHNoKXx0cyg3MHxtXFwtfG0zfG01KXx0eFxcLTl8dXAoXFwuYnxnMXxzaSl8dXRzdHx2NDAwfHY3NTB8dmVyaXx2aShyZ3x0ZSl8dmsoNDB8NVswLTNdfFxcLXYpfHZtNDB8dm9kYXx2dWxjfHZ4KDUyfDUzfDYwfDYxfDcwfDgwfDgxfDgzfDg1fDk4KXx3M2MoXFwtfCApfHdlYmN8d2hpdHx3aShnIHxuY3xudyl8d21sYnx3b251fHg3MDB8eWFzXFwtfHlvdXJ8emV0b3x6dGVcXC0vaS50ZXN0KGEuc3Vic3RyKDAsNCkpKWNoZWNrID0gdHJ1ZX0pKG5hdmlnYXRvci51c2VyQWdlbnR8fG5hdmlnYXRvci52ZW5kb3J8fHdpbmRvdy5vcGVyYSk7XHJcblx0ICByZXR1cm4gY2hlY2s7XHJcbn1cclxuXHJcbnZhciBSRU5ERVJFREFSUk9XUz17fTtcclxuZnVuY3Rpb24gcmVuZGVyQXJyb3dCYXNlNjQod2lkdGgsaGVpZ2h0LGNvbG9yKSBcclxue1xyXG5cdHZhciBrZXkgPSB3aWR0aCtcInhcIitoZWlnaHQrXCI6XCIrY29sb3I7XHJcblx0aWYgKFJFTkRFUkVEQVJST1dTW2tleV0pXHJcblx0XHRyZXR1cm4gUkVOREVSRURBUlJPV1Nba2V5XTtcclxuXHR2YXIgYnJkY29sID0gXCIjZmVmZWZlXCI7IC8vaW5jcmVhc2VCcmlnaHRuZXNzKGNvbG9yLDk5KTtcclxuXHRcclxuXHR2YXIgc3ZnPSc8c3ZnIHZlcnNpb249XCIxLjFcIiBpZD1cIkxheWVyXzFcIiB4bWxucz1cImh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnXCIgeG1sbnM6eGxpbms9XCJodHRwOi8vd3d3LnczLm9yZy8xOTk5L3hsaW5rXCIgeD1cIjBweFwiIHk9XCIwcHhcIiB3aWR0aD1cIicrd2lkdGgrJ3B0XCIgaGVpZ2h0PVwiJytoZWlnaHQrJ3B0XCIgJ1x0XHJcblx0Kyd2aWV3Qm94PVwiMTM3LjgzNCAtODIuODMzIDExNCA5MS4zMzNcIiBlbmFibGUtYmFja2dyb3VuZD1cIm5ldyAxMzcuODM0IC04Mi44MzMgMTE0IDkxLjMzM1wiIHhtbDpzcGFjZT1cInByZXNlcnZlXCI+J1xyXG5cdCsnPHBhdGggZmlsbD1cIm5vbmVcIiBkPVwiTS01MS0yLjE2N2g0OHY0OGgtNDhWLTIuMTY3elwiLz4nXHJcblx0Kyc8Y2lyY2xlIGRpc3BsYXk9XCJub25lXCIgZmlsbD1cIiM2MDVDQzlcIiBjeD1cIjUxLjI4NlwiIGN5PVwiLTM1LjI4NlwiIHI9XCI4OC43ODZcIi8+J1xyXG5cdCsnPHBhdGggZmlsbD1cIiM2MDVDQzlcIiBzdHJva2U9XCIjRkZGRkZGXCIgc3Ryb2tlLXdpZHRoPVwiNFwiIHN0cm9rZS1taXRlcmxpbWl0PVwiMTBcIiBkPVwiTTIzOS41LTM2LjhsLTkyLjU1OC0zNS42OSBjNS4yMTYsMTEuMzA0LDguMTMsMjMuODg3LDguMTMsMzcuMTUzYzAsMTIuMTctMi40NTEsMjMuNzY3LTYuODgzLDM0LjMyN0wyMzkuNS0zNi44elwiLz4nXHJcblx0Kyc8L3N2Zz4nXHJcblx0dmFyIHN2Zz1zdmcuc3BsaXQoXCIjNjA1Q0M5XCIpLmpvaW4oY29sb3IpO1xyXG5cdHZhciBjYW52YXMgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdjYW52YXMnKTtcclxuICAgIGNhbnZhcy53aWR0aCA9IHdpZHRoO1xyXG4gICAgY2FudmFzLmhlaWdodCA9IGhlaWdodDtcclxuICAgIGNhbnZnKGNhbnZhcywgc3ZnLHsgaWdub3JlTW91c2U6IHRydWUsIGlnbm9yZUFuaW1hdGlvbjogdHJ1ZSB9KTtcclxuICAgIHJldHVybiBSRU5ERVJFREFSUk9XU1trZXldPWNhbnZhcy50b0RhdGFVUkwoKTtcclxufVxyXG5cclxudmFyIFJFTkRFUkVERElSRUNUSU9OUz17fTtcclxuZnVuY3Rpb24gcmVuZGVyRGlyZWN0aW9uQmFzZTY0KHdpZHRoLGhlaWdodCxjb2xvcikgXHJcbntcclxuXHR2YXIga2V5ID0gd2lkdGgrXCJ4XCIraGVpZ2h0K1wiOlwiK2NvbG9yO1xyXG5cdGlmIChSRU5ERVJFRERJUkVDVElPTlNba2V5XSlcclxuXHRcdHJldHVybiBSRU5ERVJFRERJUkVDVElPTlNba2V5XTtcclxuXHJcblx0dmFyIHN2Zz0nPHN2ZyB3aWR0aD1cIicrd2lkdGgrJ3B0XCIgaGVpZ2h0PVwiJytoZWlnaHQrJ3B0XCIgJ1xyXG5cclxuXHRcdCsndmlld0JveD1cIjE1IDkgMTkuNzUgMjkuNVwiIGVuYWJsZS1iYWNrZ3JvdW5kPVwibmV3IDE1IDkgMTkuNzUgMjkuNVwiIHhtbDpzcGFjZT1cInByZXNlcnZlXCI+J1xyXG5cdFx0Kyc8cGF0aCBmaWxsPVwiI0ZGRkVGRlwiIGQ9XCJNMTcuMTcsMzIuOTJsOS4xNy05LjE3bC05LjE3LTkuMTdMMjAsMTEuNzVsMTIsMTJsLTEyLDEyTDE3LjE3LDMyLjkyelwiLz4nXHJcblx0XHQrJzxwYXRoIGZpbGw9XCJub25lXCIgZD1cIk0wLTAuMjVoNDh2NDhIMFYtMC4yNXpcIi8+J1xyXG5cclxuXHQrJzwvc3ZnPic7XHJcblxyXG5cdHZhciBzdmc9c3ZnLnNwbGl0KFwiIzAwMDAwMFwiKS5qb2luKGNvbG9yKTtcclxuXHR2YXIgY2FudmFzID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnY2FudmFzJyk7XHJcbiAgICBjYW52YXMud2lkdGggPSB3aWR0aDtcclxuICAgIGNhbnZhcy5oZWlnaHQgPSBoZWlnaHQ7XHJcbiAgICBjYW52ZyhjYW52YXMsIHN2Zyx7IGlnbm9yZU1vdXNlOiB0cnVlLCBpZ25vcmVBbmltYXRpb246IHRydWUgfSk7XHJcbiAgICByZXR1cm4gUkVOREVSRURESVJFQ1RJT05TW2tleV09Y2FudmFzLnRvRGF0YVVSTCgpO1xyXG59XHJcblxyXG52YXIgUkVOREVSRUJPWEVTPXt9O1xyXG5mdW5jdGlvbiByZW5kZXJCb3hCYXNlNjQod2lkdGgsaGVpZ2h0LGNvbG9yKSBcclxue1xyXG5cdHZhciBrZXkgPSB3aWR0aCtcInhcIitoZWlnaHQrXCI6XCIrY29sb3I7XHJcblx0aWYgKFJFTkRFUkVCT1hFU1trZXldKVxyXG5cdFx0cmV0dXJuIFJFTkRFUkVCT1hFU1trZXldO1xyXG5cclxuXHR2YXIgc3ZnPSc8c3ZnIHdpZHRoPVwiJyt3aWR0aCsncHRcIiBoZWlnaHQ9XCInK2hlaWdodCsncHRcIiB2aWV3Qm94PVwiMCAwIDUxMiA1MTJcIiB2ZXJzaW9uPVwiMS4xXCIgeG1sbnM9XCJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2Z1wiPidcclxuXHQrJzxnIGlkPVwiI2ZmZmZmZmZmXCI+J1xyXG5cdCsnPHBhdGggZmlsbD1cIiNmZmZmZmZcIiBvcGFjaXR5PVwiMS4wMFwiIGQ9XCIgTSA1NS41MCAwLjAwIEwgNDU4LjQ1IDAuMDAgQyA0NzIuNDQgMC45OSA0ODYuMDMgNy4wOSA0OTUuNzggMTcuMjMgQyA1MDUuMzQgMjYuODggNTExLjAxIDQwLjA0IDUxMi4wMCA1My41NSBMIDUxMi4wMCA0NTguNDQgQyA1MTAuOTkgNDcyLjQzIDUwNC45MCA0ODYuMDEgNDk0Ljc3IDQ5NS43NyBDIDQ4NS4xMSA1MDUuMzIgNDcxLjk2IDUxMS4wMSA0NTguNDUgNTEyLjAwIEwgNTMuNTYgNTEyLjAwIEMgMzkuNTcgNTEwLjk5IDI1Ljk3IDUwNC45MSAxNi4yMiA0OTQuNzggQyA2LjY3IDQ4NS4xMiAwLjk3IDQ3MS45NyAwLjAwIDQ1OC40NSBMIDAuMDAgNTUuNTAgQyAwLjQwIDQxLjA3IDYuNDUgMjYuODkgMTYuNzQgMTYuNzMgQyAyNi44OSA2LjQ1IDQxLjA3IDAuNDEgNTUuNTAgMC4wMCBNIDU2LjkwIDU2LjkwIEMgNTYuODcgMTg5LjYzIDU2Ljg2IDMyMi4zNiA1Ni45MCA0NTUuMDkgQyAxODkuNjMgNDU1LjEyIDMyMi4zNiA0NTUuMTIgNDU1LjA5IDQ1NS4wOSBDIDQ1NS4xMiAzMjIuMzYgNDU1LjEyIDE4OS42MyA0NTUuMDkgNTYuOTAgQyAzMjIuMzYgNTYuODYgMTg5LjYzIDU2Ljg3IDU2LjkwIDU2LjkwIFpcIiAvPidcclxuXHQrJzwvZz4nXHJcblx0Kyc8ZyBpZD1cIiMwMDAwMDBmZlwiPidcclxuXHQrJzxwYXRoIGZpbGw9XCIjMDAwMDAwXCIgb3BhY2l0eT1cIjEuMDBcIiBkPVwiIE0gNTYuOTAgNTYuOTAgQyAxODkuNjMgNTYuODcgMzIyLjM2IDU2Ljg2IDQ1NS4wOSA1Ni45MCBDIDQ1NS4xMiAxODkuNjMgNDU1LjEyIDMyMi4zNiA0NTUuMDkgNDU1LjA5IEMgMzIyLjM2IDQ1NS4xMiAxODkuNjMgNDU1LjEyIDU2LjkwIDQ1NS4wOSBDIDU2Ljg2IDMyMi4zNiA1Ni44NyAxODkuNjMgNTYuOTAgNTYuOTAgWlwiIC8+J1xyXG5cdCsnPC9nPidcclxuXHQrJzwvc3ZnPic7XHJcblxyXG5cdHZhciBzdmc9c3ZnLnNwbGl0KFwiIzAwMDAwMFwiKS5qb2luKGNvbG9yKTtcclxuXHR2YXIgY2FudmFzID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnY2FudmFzJyk7XHJcbiAgICBjYW52YXMud2lkdGggPSB3aWR0aDtcclxuICAgIGNhbnZhcy5oZWlnaHQgPSBoZWlnaHQ7XHJcbiAgICBjYW52ZyhjYW52YXMsIHN2Zyx7IGlnbm9yZU1vdXNlOiB0cnVlLCBpZ25vcmVBbmltYXRpb246IHRydWUgfSk7XHJcbiAgICByZXR1cm4gUkVOREVSRUJPWEVTW2tleV09Y2FudmFzLnRvRGF0YVVSTCgpO1xyXG59XHJcblxyXG5cclxuZnVuY3Rpb24gaW50ZXJjZXB0T25DaXJjbGUoYSxiLGMscikge1xyXG5cdHJldHVybiBjaXJjbGVMaW5lSW50ZXJzZWN0KGFbMF0sYVsxXSxiWzBdLGJbMV0sY1swXSxjWzFdLHIpO1x0XHJcbn1cclxuZnVuY3Rpb24gZGlzdHAocDEscDIpIHtcclxuXHQgIHJldHVybiBNYXRoLnNxcnQoKHAyWzBdLXAxWzBdKSoocDJbMF0tcDFbMF0pKyhwMlsxXS1wMVsxXSkqKHAyWzFdLXAxWzFdKSk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGNpcmNsZUxpbmVJbnRlcnNlY3QoeDEsIHkxLCB4MiwgeTIsIGN4LCBjeSwgY3IgKSBcclxue1xyXG5cdCAgZnVuY3Rpb24gZGlzdCh4MSx5MSx4Mix5Mikge1xyXG5cdFx0ICByZXR1cm4gTWF0aC5zcXJ0KCh4Mi14MSkqKHgyLXgxKSsoeTIteTEpKih5Mi15MSkpO1xyXG5cdCAgfVxyXG5cdCAgdmFyIGR4ID0geDIgLSB4MTtcclxuXHQgIHZhciBkeSA9IHkyIC0geTE7XHJcblx0ICB2YXIgYSA9IGR4ICogZHggKyBkeSAqIGR5O1xyXG5cdCAgdmFyIGIgPSAyICogKGR4ICogKHgxIC0gY3gpICsgZHkgKiAoeTEgLSBjeSkpO1xyXG5cdCAgdmFyIGMgPSBjeCAqIGN4ICsgY3kgKiBjeTtcclxuXHQgIGMgKz0geDEgKiB4MSArIHkxICogeTE7XHJcblx0ICBjIC09IDIgKiAoY3ggKiB4MSArIGN5ICogeTEpO1xyXG5cdCAgYyAtPSBjciAqIGNyO1xyXG5cdCAgdmFyIGJiNGFjID0gYiAqIGIgLSA0ICogYSAqIGM7XHJcblx0ICBpZiAoYmI0YWMgPCAwKSB7ICAvLyBOb3QgaW50ZXJzZWN0aW5nXHJcblx0ICAgIHJldHVybiBmYWxzZTtcclxuXHQgIH0gZWxzZSB7XHJcblx0XHR2YXIgbXUgPSAoLWIgKyBNYXRoLnNxcnQoIGIqYiAtIDQqYSpjICkpIC8gKDIqYSk7XHJcblx0XHR2YXIgaXgxID0geDEgKyBtdSooZHgpO1xyXG5cdFx0dmFyIGl5MSA9IHkxICsgbXUqKGR5KTtcclxuXHQgICAgbXUgPSAoLWIgLSBNYXRoLnNxcnQoYipiIC0gNCphKmMgKSkgLyAoMiphKTtcclxuXHQgICAgdmFyIGl4MiA9IHgxICsgbXUqKGR4KTtcclxuXHQgICAgdmFyIGl5MiA9IHkxICsgbXUqKGR5KTtcclxuXHJcblx0ICAgIC8vIFRoZSBpbnRlcnNlY3Rpb24gcG9pbnRzXHJcblx0ICAgIC8vZWxsaXBzZShpeDEsIGl5MSwgMTAsIDEwKTtcclxuXHQgICAgLy9lbGxpcHNlKGl4MiwgaXkyLCAxMCwgMTApO1xyXG5cdCAgICBcclxuXHQgICAgdmFyIHRlc3RYO1xyXG5cdCAgICB2YXIgdGVzdFk7XHJcblx0ICAgIC8vIEZpZ3VyZSBvdXQgd2hpY2ggcG9pbnQgaXMgY2xvc2VyIHRvIHRoZSBjaXJjbGVcclxuXHQgICAgaWYgKGRpc3QoeDEsIHkxLCBjeCwgY3kpIDwgZGlzdCh4MiwgeTIsIGN4LCBjeSkpIHtcclxuXHQgICAgICB0ZXN0WCA9IHgyO1xyXG5cdCAgICAgIHRlc3RZID0geTI7XHJcblx0ICAgIH0gZWxzZSB7XHJcblx0ICAgICAgdGVzdFggPSB4MTtcclxuXHQgICAgICB0ZXN0WSA9IHkxO1xyXG5cdCAgICB9XHJcblx0ICAgICBcclxuXHQgICAgaWYgKGRpc3QodGVzdFgsIHRlc3RZLCBpeDEsIGl5MSkgPCBkaXN0KHgxLCB5MSwgeDIsIHkyKSB8fCBkaXN0KHRlc3RYLCB0ZXN0WSwgaXgyLCBpeTIpIDwgZGlzdCh4MSwgeTEsIHgyLCB5MikpIHtcclxuXHQgICAgICByZXR1cm4gWyBbaXgxLGl5MV0sW2l4MixpeTJdIF07XHJcblx0ICAgIH0gZWxzZSB7XHJcblx0ICAgICAgcmV0dXJuIGZhbHNlO1xyXG5cdCAgICB9XHJcblx0ICB9XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGRlY29kZUJhc2U2NEltYWdlKGRhdGFTdHJpbmcpIHtcclxuXHQgIHZhciBtYXRjaGVzID0gZGF0YVN0cmluZy5tYXRjaCgvXmRhdGE6KFtBLVphLXotK1xcL10rKTtiYXNlNjQsKC4rKSQvKSxcclxuXHQgICAgcmVzcG9uc2UgPSB7fTtcclxuXHQgIGlmIChtYXRjaGVzLmxlbmd0aCAhPT0gMykge1xyXG5cdCAgICByZXR1cm4gbmV3IEVycm9yKCdJbnZhbGlkIGlucHV0IHN0cmluZycpO1xyXG5cdCAgfVxyXG5cdCAgcmVzcG9uc2UudHlwZSA9IG1hdGNoZXNbMV07XHJcblx0ICByZXNwb25zZS5kYXRhID0gbmV3IEJ1ZmZlcihtYXRjaGVzWzJdLCAnYmFzZTY0Jyk7XHJcblx0ICByZXR1cm4gcmVzcG9uc2U7XHJcblx0fVxyXG5cclxuLy8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuZXhwb3J0cy5teVRyaW09bXlUcmltO1xyXG5leHBvcnRzLm15VHJpbUNvb3JkaW5hdGU9bXlUcmltQ29vcmRpbmF0ZTtcclxuZXhwb3J0cy5jbG9zZXN0UHJvamVjdGlvbk9mUG9pbnRPbkxpbmU9Y2xvc2VzdFByb2plY3Rpb25PZlBvaW50T25MaW5lO1xyXG5leHBvcnRzLmNvbG9yTHVtaW5hbmNlPWNvbG9yTHVtaW5hbmNlO1xyXG5leHBvcnRzLmluY3JlYXNlQnJpZ2h0bmVzcz1pbmNyZWFzZUJyaWdodG5lc3M7XHJcbmV4cG9ydHMuY29sb3JBbHBoYUFycmF5PWNvbG9yQWxwaGFBcnJheTtcclxuZXhwb3J0cy5lc2NhcGVIVE1MPWVzY2FwZUhUTUw7XHJcbmV4cG9ydHMuZm9ybWF0TnVtYmVyMj1mb3JtYXROdW1iZXIyO1xyXG5leHBvcnRzLmZvcm1hdERhdGVUaW1lPWZvcm1hdERhdGVUaW1lO1xyXG5leHBvcnRzLmZvcm1hdERhdGVUaW1lU2VjPWZvcm1hdERhdGVUaW1lU2VjO1xyXG5leHBvcnRzLmZvcm1hdERhdGU9Zm9ybWF0RGF0ZTtcclxuZXhwb3J0cy5mb3JtYXRUaW1lPWZvcm1hdFRpbWU7XHJcbmV4cG9ydHMucmFpbmJvdz1yYWluYm93O1xyXG5leHBvcnRzLm1vYmlsZUFuZFRhYmxldENoZWNrPW1vYmlsZUFuZFRhYmxldENoZWNrO1xyXG5leHBvcnRzLnJlbmRlckFycm93QmFzZTY0PXJlbmRlckFycm93QmFzZTY0O1xyXG5leHBvcnRzLnJlbmRlckRpcmVjdGlvbkJhc2U2ND1yZW5kZXJEaXJlY3Rpb25CYXNlNjQ7XHJcbmV4cG9ydHMucmVuZGVyQm94QmFzZTY0PXJlbmRlckJveEJhc2U2NDtcclxuZXhwb3J0cy5pbnRlcmNlcHRPbkNpcmNsZT1pbnRlcmNlcHRPbkNpcmNsZTtcclxuZXhwb3J0cy5kaXN0cD1kaXN0cDtcclxuZXhwb3J0cy5jaXJjbGVMaW5lSW50ZXJzZWN0PWNpcmNsZUxpbmVJbnRlcnNlY3Q7XHJcbmV4cG9ydHMuTU9CSUxFPW1vYmlsZUFuZFRhYmxldENoZWNrKCk7XHJcbmV4cG9ydHMuV0dTODRTUEhFUkU9bmV3IFdHUzg0U3BoZXJlKDYzNzgxMzcpO1xyXG5leHBvcnRzLmZvcm1hdFRpbWVTZWM9Zm9ybWF0VGltZVNlYztcclxuZXhwb3J0cy5kZWNvZGVCYXNlNjRJbWFnZT1kZWNvZGVCYXNlNjRJbWFnZTtcclxuZXhwb3J0cy5pc0RlZmluZWQ9aXNEZWZpbmVkOyIsIjshZnVuY3Rpb24gKCkgeztcbnZhciBKb29zZSA9IHt9XG5cbi8vIGNvbmZpZ3VyYXRpb24gaGFzaFxuXG5Kb29zZS5DICAgICAgICAgICAgID0gdHlwZW9mIEpPT1NFX0NGRyAhPSAndW5kZWZpbmVkJyA/IEpPT1NFX0NGRyA6IHt9XG5cbkpvb3NlLmlzX0lFICAgICAgICAgPSAnXFx2JyA9PSAndidcbkpvb3NlLmlzX05vZGVKUyAgICAgPSBCb29sZWFuKHR5cGVvZiBwcm9jZXNzICE9ICd1bmRlZmluZWQnICYmIHByb2Nlc3MucGlkKVxuXG5cbkpvb3NlLnRvcCAgICAgICAgICAgPSBKb29zZS5pc19Ob2RlSlMgJiYgZ2xvYmFsIHx8IHRoaXNcblxuSm9vc2Uuc3R1YiAgICAgICAgICA9IGZ1bmN0aW9uICgpIHtcbiAgICByZXR1cm4gZnVuY3Rpb24gKCkgeyB0aHJvdyBuZXcgRXJyb3IoXCJNb2R1bGVzIGNhbiBub3QgYmUgaW5zdGFudGlhdGVkXCIpIH1cbn1cblxuXG5Kb29zZS5WRVJTSU9OICAgICAgID0gKHsgLypQS0dWRVJTSU9OKi9WRVJTSU9OIDogJzMuNTAuMCcgfSkuVkVSU0lPTlxuXG5cbmlmICh0eXBlb2YgbW9kdWxlICE9ICd1bmRlZmluZWQnKSBtb2R1bGUuZXhwb3J0cyA9IEpvb3NlXG4vKmlmICghSm9vc2UuaXNfTm9kZUpTKSAqL1xudGhpcy5Kb29zZSA9IEpvb3NlXG5cblxuLy8gU3RhdGljIGhlbHBlcnMgZm9yIEFycmF5c1xuSm9vc2UuQSA9IHtcblxuICAgIGVhY2ggOiBmdW5jdGlvbiAoYXJyYXksIGZ1bmMsIHNjb3BlKSB7XG4gICAgICAgIHNjb3BlID0gc2NvcGUgfHwgdGhpc1xuICAgICAgICBcbiAgICAgICAgZm9yICh2YXIgaSA9IDAsIGxlbiA9IGFycmF5Lmxlbmd0aDsgaSA8IGxlbjsgaSsrKSBcbiAgICAgICAgICAgIGlmIChmdW5jLmNhbGwoc2NvcGUsIGFycmF5W2ldLCBpKSA9PT0gZmFsc2UpIHJldHVybiBmYWxzZVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgZWFjaFIgOiBmdW5jdGlvbiAoYXJyYXksIGZ1bmMsIHNjb3BlKSB7XG4gICAgICAgIHNjb3BlID0gc2NvcGUgfHwgdGhpc1xuXG4gICAgICAgIGZvciAodmFyIGkgPSBhcnJheS5sZW5ndGggLSAxOyBpID49IDA7IGktLSkgXG4gICAgICAgICAgICBpZiAoZnVuYy5jYWxsKHNjb3BlLCBhcnJheVtpXSwgaSkgPT09IGZhbHNlKSByZXR1cm4gZmFsc2VcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGV4aXN0cyA6IGZ1bmN0aW9uIChhcnJheSwgdmFsdWUpIHtcbiAgICAgICAgZm9yICh2YXIgaSA9IDAsIGxlbiA9IGFycmF5Lmxlbmd0aDsgaSA8IGxlbjsgaSsrKSBpZiAoYXJyYXlbaV0gPT0gdmFsdWUpIHJldHVybiB0cnVlXG4gICAgICAgICAgICBcbiAgICAgICAgcmV0dXJuIGZhbHNlXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBtYXAgOiBmdW5jdGlvbiAoYXJyYXksIGZ1bmMsIHNjb3BlKSB7XG4gICAgICAgIHNjb3BlID0gc2NvcGUgfHwgdGhpc1xuICAgICAgICBcbiAgICAgICAgdmFyIHJlcyA9IFtdXG4gICAgICAgIFxuICAgICAgICBmb3IgKHZhciBpID0gMCwgbGVuID0gYXJyYXkubGVuZ3RoOyBpIDwgbGVuOyBpKyspIFxuICAgICAgICAgICAgcmVzLnB1c2goIGZ1bmMuY2FsbChzY29wZSwgYXJyYXlbaV0sIGkpIClcbiAgICAgICAgICAgIFxuICAgICAgICByZXR1cm4gcmVzXG4gICAgfSxcbiAgICBcblxuICAgIGdyZXAgOiBmdW5jdGlvbiAoYXJyYXksIGZ1bmMpIHtcbiAgICAgICAgdmFyIGEgPSBbXVxuICAgICAgICBcbiAgICAgICAgSm9vc2UuQS5lYWNoKGFycmF5LCBmdW5jdGlvbiAodCkge1xuICAgICAgICAgICAgaWYgKGZ1bmModCkpIGEucHVzaCh0KVxuICAgICAgICB9KVxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIGFcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIHJlbW92ZSA6IGZ1bmN0aW9uIChhcnJheSwgcmVtb3ZlRWxlKSB7XG4gICAgICAgIHZhciBhID0gW11cbiAgICAgICAgXG4gICAgICAgIEpvb3NlLkEuZWFjaChhcnJheSwgZnVuY3Rpb24gKHQpIHtcbiAgICAgICAgICAgIGlmICh0ICE9PSByZW1vdmVFbGUpIGEucHVzaCh0KVxuICAgICAgICB9KVxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIGFcbiAgICB9XG4gICAgXG59XG5cbi8vIFN0YXRpYyBoZWxwZXJzIGZvciBTdHJpbmdzXG5Kb29zZS5TID0ge1xuICAgIFxuICAgIHNhbmVTcGxpdCA6IGZ1bmN0aW9uIChzdHIsIGRlbGltZXRlcikge1xuICAgICAgICB2YXIgcmVzID0gKHN0ciB8fCAnJykuc3BsaXQoZGVsaW1ldGVyKVxuICAgICAgICBcbiAgICAgICAgaWYgKHJlcy5sZW5ndGggPT0gMSAmJiAhcmVzWzBdKSByZXMuc2hpZnQoKVxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIHJlc1xuICAgIH0sXG4gICAgXG5cbiAgICB1cHBlcmNhc2VGaXJzdCA6IGZ1bmN0aW9uIChzdHJpbmcpIHsgXG4gICAgICAgIHJldHVybiBzdHJpbmcuc3Vic3RyKDAsIDEpLnRvVXBwZXJDYXNlKCkgKyBzdHJpbmcuc3Vic3RyKDEsIHN0cmluZy5sZW5ndGggLSAxKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgc3RyVG9DbGFzcyA6IGZ1bmN0aW9uIChuYW1lLCB0b3ApIHtcbiAgICAgICAgdmFyIGN1cnJlbnQgPSB0b3AgfHwgSm9vc2UudG9wXG4gICAgICAgIFxuICAgICAgICBKb29zZS5BLmVhY2gobmFtZS5zcGxpdCgnLicpLCBmdW5jdGlvbiAoc2VnbWVudCkge1xuICAgICAgICAgICAgaWYgKGN1cnJlbnQpIFxuICAgICAgICAgICAgICAgIGN1cnJlbnQgPSBjdXJyZW50WyBzZWdtZW50IF1cbiAgICAgICAgICAgIGVsc2VcbiAgICAgICAgICAgICAgICByZXR1cm4gZmFsc2VcbiAgICAgICAgfSlcbiAgICAgICAgXG4gICAgICAgIHJldHVybiBjdXJyZW50XG4gICAgfVxufVxuXG52YXIgYmFzZUZ1bmMgICAgPSBmdW5jdGlvbiAoKSB7fVxuXG4vLyBTdGF0aWMgaGVscGVycyBmb3Igb2JqZWN0c1xuSm9vc2UuTyA9IHtcblxuICAgIGVhY2ggOiBmdW5jdGlvbiAob2JqZWN0LCBmdW5jLCBzY29wZSkge1xuICAgICAgICBzY29wZSA9IHNjb3BlIHx8IHRoaXNcbiAgICAgICAgXG4gICAgICAgIGZvciAodmFyIGkgaW4gb2JqZWN0KSBcbiAgICAgICAgICAgIGlmIChmdW5jLmNhbGwoc2NvcGUsIG9iamVjdFtpXSwgaSkgPT09IGZhbHNlKSByZXR1cm4gZmFsc2VcbiAgICAgICAgXG4gICAgICAgIGlmIChKb29zZS5pc19JRSkgXG4gICAgICAgICAgICByZXR1cm4gSm9vc2UuQS5lYWNoKFsgJ3RvU3RyaW5nJywgJ2NvbnN0cnVjdG9yJywgJ2hhc093blByb3BlcnR5JyBdLCBmdW5jdGlvbiAoZWwpIHtcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBpZiAob2JqZWN0Lmhhc093blByb3BlcnR5KGVsKSkgcmV0dXJuIGZ1bmMuY2FsbChzY29wZSwgb2JqZWN0W2VsXSwgZWwpXG4gICAgICAgICAgICB9KVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgZWFjaE93biA6IGZ1bmN0aW9uIChvYmplY3QsIGZ1bmMsIHNjb3BlKSB7XG4gICAgICAgIHNjb3BlID0gc2NvcGUgfHwgdGhpc1xuICAgICAgICBcbiAgICAgICAgcmV0dXJuIEpvb3NlLk8uZWFjaChvYmplY3QsIGZ1bmN0aW9uICh2YWx1ZSwgbmFtZSkge1xuICAgICAgICAgICAgaWYgKG9iamVjdC5oYXNPd25Qcm9wZXJ0eShuYW1lKSkgcmV0dXJuIGZ1bmMuY2FsbChzY29wZSwgdmFsdWUsIG5hbWUpXG4gICAgICAgIH0sIHNjb3BlKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgY29weSA6IGZ1bmN0aW9uIChzb3VyY2UsIHRhcmdldCkge1xuICAgICAgICB0YXJnZXQgPSB0YXJnZXQgfHwge31cbiAgICAgICAgXG4gICAgICAgIEpvb3NlLk8uZWFjaChzb3VyY2UsIGZ1bmN0aW9uICh2YWx1ZSwgbmFtZSkgeyB0YXJnZXRbbmFtZV0gPSB2YWx1ZSB9KVxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIHRhcmdldFxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgY29weU93biA6IGZ1bmN0aW9uIChzb3VyY2UsIHRhcmdldCkge1xuICAgICAgICB0YXJnZXQgPSB0YXJnZXQgfHwge31cbiAgICAgICAgXG4gICAgICAgIEpvb3NlLk8uZWFjaE93bihzb3VyY2UsIGZ1bmN0aW9uICh2YWx1ZSwgbmFtZSkgeyB0YXJnZXRbbmFtZV0gPSB2YWx1ZSB9KVxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIHRhcmdldFxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgZ2V0TXV0YWJsZUNvcHkgOiBmdW5jdGlvbiAob2JqZWN0KSB7XG4gICAgICAgIGJhc2VGdW5jLnByb3RvdHlwZSA9IG9iamVjdFxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIG5ldyBiYXNlRnVuYygpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBleHRlbmQgOiBmdW5jdGlvbiAodGFyZ2V0LCBzb3VyY2UpIHtcbiAgICAgICAgcmV0dXJuIEpvb3NlLk8uY29weShzb3VyY2UsIHRhcmdldClcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGlzRW1wdHkgOiBmdW5jdGlvbiAob2JqZWN0KSB7XG4gICAgICAgIGZvciAodmFyIGkgaW4gb2JqZWN0KSBpZiAob2JqZWN0Lmhhc093blByb3BlcnR5KGkpKSByZXR1cm4gZmFsc2VcbiAgICAgICAgXG4gICAgICAgIHJldHVybiB0cnVlXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBpc0luc3RhbmNlOiBmdW5jdGlvbiAob2JqKSB7XG4gICAgICAgIHJldHVybiBvYmogJiYgb2JqLm1ldGEgJiYgb2JqLmNvbnN0cnVjdG9yID09IG9iai5tZXRhLmNcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGlzQ2xhc3MgOiBmdW5jdGlvbiAob2JqKSB7XG4gICAgICAgIHJldHVybiBvYmogJiYgb2JqLm1ldGEgJiYgb2JqLm1ldGEuYyA9PSBvYmpcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIHdhbnRBcnJheSA6IGZ1bmN0aW9uIChvYmopIHtcbiAgICAgICAgaWYgKG9iaiBpbnN0YW5jZW9mIEFycmF5KSByZXR1cm4gb2JqXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gWyBvYmogXVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgLy8gdGhpcyB3YXMgYSBidWcgaW4gV2ViS2l0LCB3aGljaCBnaXZlcyB0eXBlb2YgLyAvID09ICdmdW5jdGlvbidcbiAgICAvLyBzaG91bGQgYmUgbW9uaXRvcmVkIGFuZCByZW1vdmVkIGF0IHNvbWUgcG9pbnQgaW4gdGhlIGZ1dHVyZVxuICAgIGlzRnVuY3Rpb24gOiBmdW5jdGlvbiAob2JqKSB7XG4gICAgICAgIHJldHVybiB0eXBlb2Ygb2JqID09ICdmdW5jdGlvbicgJiYgb2JqLmNvbnN0cnVjdG9yICE9IC8gLy5jb25zdHJ1Y3RvclxuICAgIH1cbn1cblxuXG4vL2luaXRpYWxpemVyc1xuXG5Kb29zZS5JID0ge1xuICAgIEFycmF5ICAgICAgIDogZnVuY3Rpb24gKCkgeyByZXR1cm4gW10gfSxcbiAgICBPYmplY3QgICAgICA6IGZ1bmN0aW9uICgpIHsgcmV0dXJuIHt9IH0sXG4gICAgRnVuY3Rpb24gICAgOiBmdW5jdGlvbiAoKSB7IHJldHVybiBhcmd1bWVudHMuY2FsbGVlIH0sXG4gICAgTm93ICAgICAgICAgOiBmdW5jdGlvbiAoKSB7IHJldHVybiBuZXcgRGF0ZSgpIH1cbn07XG5Kb29zZS5Qcm90byA9IEpvb3NlLnN0dWIoKVxuXG5Kb29zZS5Qcm90by5FbXB0eSA9IEpvb3NlLnN0dWIoKVxuICAgIFxuSm9vc2UuUHJvdG8uRW1wdHkubWV0YSA9IHt9O1xuOyhmdW5jdGlvbiAoKSB7XG5cbiAgICBKb29zZS5Qcm90by5PYmplY3QgPSBKb29zZS5zdHViKClcbiAgICBcbiAgICBcbiAgICB2YXIgU1VQRVIgPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHZhciBzZWxmID0gU1VQRVIuY2FsbGVyXG4gICAgICAgIFxuICAgICAgICBpZiAoc2VsZiA9PSBTVVBFUkFSRykgc2VsZiA9IHNlbGYuY2FsbGVyXG4gICAgICAgIFxuICAgICAgICBpZiAoIXNlbGYuU1VQRVIpIHRocm93IFwiSW52YWxpZCBjYWxsIHRvIFNVUEVSXCJcbiAgICAgICAgXG4gICAgICAgIHJldHVybiBzZWxmLlNVUEVSW3NlbGYubWV0aG9kTmFtZV0uYXBwbHkodGhpcywgYXJndW1lbnRzKVxuICAgIH1cbiAgICBcbiAgICBcbiAgICB2YXIgU1VQRVJBUkcgPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHJldHVybiB0aGlzLlNVUEVSLmFwcGx5KHRoaXMsIGFyZ3VtZW50c1swXSlcbiAgICB9XG4gICAgXG4gICAgXG4gICAgXG4gICAgSm9vc2UuUHJvdG8uT2JqZWN0LnByb3RvdHlwZSA9IHtcbiAgICAgICAgXG4gICAgICAgIFNVUEVSQVJHIDogU1VQRVJBUkcsXG4gICAgICAgIFNVUEVSIDogU1VQRVIsXG4gICAgICAgIFxuICAgICAgICBJTk5FUiA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHRocm93IFwiSW52YWxpZCBjYWxsIHRvIElOTkVSXCJcbiAgICAgICAgfSwgICAgICAgICAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgQlVJTEQgOiBmdW5jdGlvbiAoY29uZmlnKSB7XG4gICAgICAgICAgICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aCA9PSAxICYmIHR5cGVvZiBjb25maWcgPT0gJ29iamVjdCcgJiYgY29uZmlnIHx8IHt9XG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgaW5pdGlhbGl6ZTogZnVuY3Rpb24gKCkge1xuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIHRvU3RyaW5nOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICByZXR1cm4gXCJhIFwiICsgdGhpcy5tZXRhLm5hbWVcbiAgICAgICAgfVxuICAgICAgICBcbiAgICB9XG4gICAgICAgIFxuICAgIEpvb3NlLlByb3RvLk9iamVjdC5tZXRhID0ge1xuICAgICAgICBjb25zdHJ1Y3RvciAgICAgOiBKb29zZS5Qcm90by5PYmplY3QsXG4gICAgICAgIFxuICAgICAgICBtZXRob2RzICAgICAgICAgOiBKb29zZS5PLmNvcHkoSm9vc2UuUHJvdG8uT2JqZWN0LnByb3RvdHlwZSksXG4gICAgICAgIGF0dHJpYnV0ZXMgICAgICA6IHt9XG4gICAgfVxuICAgIFxuICAgIEpvb3NlLlByb3RvLk9iamVjdC5wcm90b3R5cGUubWV0YSA9IEpvb3NlLlByb3RvLk9iamVjdC5tZXRhXG5cbn0pKCk7XG47KGZ1bmN0aW9uICgpIHtcblxuICAgIEpvb3NlLlByb3RvLkNsYXNzID0gZnVuY3Rpb24gKCkge1xuICAgICAgICByZXR1cm4gdGhpcy5pbml0aWFsaXplKHRoaXMuQlVJTEQuYXBwbHkodGhpcywgYXJndW1lbnRzKSkgfHwgdGhpc1xuICAgIH1cbiAgICBcbiAgICB2YXIgYm9vdHN0cmFwID0ge1xuICAgICAgICBcbiAgICAgICAgVkVSU0lPTiAgICAgICAgICAgICA6IG51bGwsXG4gICAgICAgIEFVVEhPUklUWSAgICAgICAgICAgOiBudWxsLFxuICAgICAgICBcbiAgICAgICAgY29uc3RydWN0b3IgICAgICAgICA6IEpvb3NlLlByb3RvLkNsYXNzLFxuICAgICAgICBzdXBlckNsYXNzICAgICAgICAgIDogbnVsbCxcbiAgICAgICAgXG4gICAgICAgIG5hbWUgICAgICAgICAgICAgICAgOiBudWxsLFxuICAgICAgICBcbiAgICAgICAgYXR0cmlidXRlcyAgICAgICAgICA6IG51bGwsXG4gICAgICAgIG1ldGhvZHMgICAgICAgICAgICAgOiBudWxsLFxuICAgICAgICBcbiAgICAgICAgbWV0YSAgICAgICAgICAgICAgICA6IG51bGwsXG4gICAgICAgIGMgICAgICAgICAgICAgICAgICAgOiBudWxsLFxuICAgICAgICBcbiAgICAgICAgZGVmYXVsdFN1cGVyQ2xhc3MgICA6IEpvb3NlLlByb3RvLk9iamVjdCxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBCVUlMRCA6IGZ1bmN0aW9uIChuYW1lLCBleHRlbmQpIHtcbiAgICAgICAgICAgIHRoaXMubmFtZSA9IG5hbWVcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcmV0dXJuIHsgX19leHRlbmRfXyA6IGV4dGVuZCB8fCB7fSB9XG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgaW5pdGlhbGl6ZTogZnVuY3Rpb24gKHByb3BzKSB7XG4gICAgICAgICAgICB2YXIgZXh0ZW5kICAgICAgPSBwcm9wcy5fX2V4dGVuZF9fXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXMuVkVSU0lPTiAgICA9IGV4dGVuZC5WRVJTSU9OXG4gICAgICAgICAgICB0aGlzLkFVVEhPUklUWSAgPSBleHRlbmQuQVVUSE9SSVRZXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGRlbGV0ZSBleHRlbmQuVkVSU0lPTlxuICAgICAgICAgICAgZGVsZXRlIGV4dGVuZC5BVVRIT1JJVFlcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpcy5jID0gdGhpcy5leHRyYWN0Q29uc3RydWN0b3IoZXh0ZW5kKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLmFkYXB0Q29uc3RydWN0b3IodGhpcy5jKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAoZXh0ZW5kLmNvbnN0cnVjdG9yT25seSkge1xuICAgICAgICAgICAgICAgIGRlbGV0ZSBleHRlbmQuY29uc3RydWN0b3JPbmx5XG4gICAgICAgICAgICAgICAgcmV0dXJuXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXMuY29uc3RydWN0KGV4dGVuZClcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBjb25zdHJ1Y3QgOiBmdW5jdGlvbiAoZXh0ZW5kKSB7XG4gICAgICAgICAgICBpZiAoIXRoaXMucHJlcGFyZVByb3BzKGV4dGVuZCkpIHJldHVyblxuICAgICAgICAgICAgXG4gICAgICAgICAgICB2YXIgc3VwZXJDbGFzcyA9IHRoaXMuc3VwZXJDbGFzcyA9IHRoaXMuZXh0cmFjdFN1cGVyQ2xhc3MoZXh0ZW5kKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLnByb2Nlc3NTdXBlckNsYXNzKHN1cGVyQ2xhc3MpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXMuYWRhcHRQcm90b3R5cGUodGhpcy5jLnByb3RvdHlwZSlcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpcy5maW5hbGl6ZShleHRlbmQpXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgZmluYWxpemUgOiBmdW5jdGlvbiAoZXh0ZW5kKSB7XG4gICAgICAgICAgICB0aGlzLnByb2Nlc3NTdGVtKGV4dGVuZClcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpcy5leHRlbmQoZXh0ZW5kKVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIC8vaWYgdGhlIGV4dGVuc2lvbiByZXR1cm5zIGZhbHNlIGZyb20gdGhpcyBtZXRob2QgaXQgc2hvdWxkIHJlLWVudGVyICdjb25zdHJ1Y3QnXG4gICAgICAgIHByZXBhcmVQcm9wcyA6IGZ1bmN0aW9uIChleHRlbmQpIHtcbiAgICAgICAgICAgIHJldHVybiB0cnVlXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgZXh0cmFjdENvbnN0cnVjdG9yIDogZnVuY3Rpb24gKGV4dGVuZCkge1xuICAgICAgICAgICAgdmFyIHJlcyA9IGV4dGVuZC5oYXNPd25Qcm9wZXJ0eSgnY29uc3RydWN0b3InKSA/IGV4dGVuZC5jb25zdHJ1Y3RvciA6IHRoaXMuZGVmYXVsdENvbnN0cnVjdG9yKClcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgZGVsZXRlIGV4dGVuZC5jb25zdHJ1Y3RvclxuICAgICAgICAgICAgXG4gICAgICAgICAgICByZXR1cm4gcmVzXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgZXh0cmFjdFN1cGVyQ2xhc3MgOiBmdW5jdGlvbiAoZXh0ZW5kKSB7XG4gICAgICAgICAgICBpZiAoZXh0ZW5kLmhhc093blByb3BlcnR5KCdpc2EnKSAmJiAhZXh0ZW5kLmlzYSkgdGhyb3cgbmV3IEVycm9yKFwiQXR0ZW1wdCB0byBpbmhlcml0IGZyb20gdW5kZWZpbmVkIHN1cGVyY2xhc3MgW1wiICsgdGhpcy5uYW1lICsgXCJdXCIpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciByZXMgPSBleHRlbmQuaXNhIHx8IHRoaXMuZGVmYXVsdFN1cGVyQ2xhc3NcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgZGVsZXRlIGV4dGVuZC5pc2FcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcmV0dXJuIHJlc1xuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIHByb2Nlc3NTdGVtIDogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgdmFyIHN1cGVyTWV0YSAgICAgICA9IHRoaXMuc3VwZXJDbGFzcy5tZXRhXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXMubWV0aG9kcyAgICAgICAgPSBKb29zZS5PLmdldE11dGFibGVDb3B5KHN1cGVyTWV0YS5tZXRob2RzIHx8IHt9KVxuICAgICAgICAgICAgdGhpcy5hdHRyaWJ1dGVzICAgICA9IEpvb3NlLk8uZ2V0TXV0YWJsZUNvcHkoc3VwZXJNZXRhLmF0dHJpYnV0ZXMgfHwge30pXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgaW5pdEluc3RhbmNlIDogZnVuY3Rpb24gKGluc3RhbmNlLCBwcm9wcykge1xuICAgICAgICAgICAgSm9vc2UuTy5jb3B5T3duKHByb3BzLCBpbnN0YW5jZSlcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBkZWZhdWx0Q29uc3RydWN0b3I6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHJldHVybiBmdW5jdGlvbiAoYXJnKSB7XG4gICAgICAgICAgICAgICAgdmFyIEJVSUxEID0gdGhpcy5CVUlMRFxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIHZhciBhcmdzID0gQlVJTEQgJiYgQlVJTEQuYXBwbHkodGhpcywgYXJndW1lbnRzKSB8fCBhcmcgfHwge31cbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICB2YXIgdGhpc01ldGEgICAgPSB0aGlzLm1ldGFcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICB0aGlzTWV0YS5pbml0SW5zdGFuY2UodGhpcywgYXJncylcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICByZXR1cm4gdGhpc01ldGEuaGFzTWV0aG9kKCdpbml0aWFsaXplJykgJiYgdGhpcy5pbml0aWFsaXplKGFyZ3MpIHx8IHRoaXNcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBwcm9jZXNzU3VwZXJDbGFzczogZnVuY3Rpb24gKHN1cGVyQ2xhc3MpIHtcbiAgICAgICAgICAgIHZhciBzdXBlclByb3RvICAgICAgPSBzdXBlckNsYXNzLnByb3RvdHlwZVxuICAgICAgICAgICAgXG4gICAgICAgICAgICAvL25vbi1Kb29zZSBzdXBlcmNsYXNzZXNcbiAgICAgICAgICAgIGlmICghc3VwZXJDbGFzcy5tZXRhKSB7XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgdmFyIGV4dGVuZCA9IEpvb3NlLk8uY29weShzdXBlclByb3RvKVxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIGV4dGVuZC5pc2EgPSBKb29zZS5Qcm90by5FbXB0eVxuICAgICAgICAgICAgICAgIC8vIGNsZWFyIHBvdGVudGlhbCB2YWx1ZSBpbiB0aGUgYGV4dGVuZC5jb25zdHJ1Y3RvcmAgdG8gcHJldmVudCBpdCBmcm9tIGJlaW5nIG1vZGlmaWVkXG4gICAgICAgICAgICAgICAgZGVsZXRlIGV4dGVuZC5jb25zdHJ1Y3RvclxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIHZhciBtZXRhID0gbmV3IHRoaXMuZGVmYXVsdFN1cGVyQ2xhc3MubWV0YS5jb25zdHJ1Y3RvcihudWxsLCBleHRlbmQpXG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgc3VwZXJDbGFzcy5tZXRhID0gc3VwZXJQcm90by5tZXRhID0gbWV0YVxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIG1ldGEuYyA9IHN1cGVyQ2xhc3NcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpcy5jLnByb3RvdHlwZSAgICA9IEpvb3NlLk8uZ2V0TXV0YWJsZUNvcHkoc3VwZXJQcm90bylcbiAgICAgICAgICAgIHRoaXMuYy5zdXBlckNsYXNzICAgPSBzdXBlclByb3RvXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgYWRhcHRDb25zdHJ1Y3RvcjogZnVuY3Rpb24gKGMpIHtcbiAgICAgICAgICAgIGMubWV0YSA9IHRoaXNcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKCFjLmhhc093blByb3BlcnR5KCd0b1N0cmluZycpKSBjLnRvU3RyaW5nID0gZnVuY3Rpb24gKCkgeyByZXR1cm4gdGhpcy5tZXRhLm5hbWUgfVxuICAgICAgICB9LFxuICAgIFxuICAgICAgICBcbiAgICAgICAgYWRhcHRQcm90b3R5cGU6IGZ1bmN0aW9uIChwcm90bykge1xuICAgICAgICAgICAgLy90aGlzIHdpbGwgZml4IHdlaXJkIHNlbWFudGljIG9mIG5hdGl2ZSBcImNvbnN0cnVjdG9yXCIgcHJvcGVydHkgdG8gbW9yZSBpbnR1aXRpdmUgKGlkZWEgYm9ycm93ZWQgZnJvbSBFeHQpXG4gICAgICAgICAgICBwcm90by5jb25zdHJ1Y3RvciAgID0gdGhpcy5jXG4gICAgICAgICAgICBwcm90by5tZXRhICAgICAgICAgID0gdGhpc1xuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIGFkZE1ldGhvZDogZnVuY3Rpb24gKG5hbWUsIGZ1bmMpIHtcbiAgICAgICAgICAgIGZ1bmMuU1VQRVIgPSB0aGlzLnN1cGVyQ2xhc3MucHJvdG90eXBlXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vY2hyb21lIGRvbid0IGFsbG93IHRvIHJlZGVmaW5lIHRoZSBcIm5hbWVcIiBwcm9wZXJ0eVxuICAgICAgICAgICAgZnVuYy5tZXRob2ROYW1lID0gbmFtZVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLm1ldGhvZHNbbmFtZV0gPSBmdW5jXG4gICAgICAgICAgICB0aGlzLmMucHJvdG90eXBlW25hbWVdID0gZnVuY1xuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIGFkZEF0dHJpYnV0ZTogZnVuY3Rpb24gKG5hbWUsIGluaXQpIHtcbiAgICAgICAgICAgIHRoaXMuYXR0cmlidXRlc1tuYW1lXSA9IGluaXRcbiAgICAgICAgICAgIHRoaXMuYy5wcm90b3R5cGVbbmFtZV0gPSBpbml0XG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgcmVtb3ZlTWV0aG9kIDogZnVuY3Rpb24gKG5hbWUpIHtcbiAgICAgICAgICAgIGRlbGV0ZSB0aGlzLm1ldGhvZHNbbmFtZV1cbiAgICAgICAgICAgIGRlbGV0ZSB0aGlzLmMucHJvdG90eXBlW25hbWVdXG4gICAgICAgIH0sXG4gICAgXG4gICAgICAgIFxuICAgICAgICByZW1vdmVBdHRyaWJ1dGU6IGZ1bmN0aW9uIChuYW1lKSB7XG4gICAgICAgICAgICBkZWxldGUgdGhpcy5hdHRyaWJ1dGVzW25hbWVdXG4gICAgICAgICAgICBkZWxldGUgdGhpcy5jLnByb3RvdHlwZVtuYW1lXVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIGhhc01ldGhvZDogZnVuY3Rpb24gKG5hbWUpIHsgXG4gICAgICAgICAgICByZXR1cm4gQm9vbGVhbih0aGlzLm1ldGhvZHNbbmFtZV0pXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgaGFzQXR0cmlidXRlOiBmdW5jdGlvbiAobmFtZSkgeyBcbiAgICAgICAgICAgIHJldHVybiB0aGlzLmF0dHJpYnV0ZXNbbmFtZV0gIT09IHVuZGVmaW5lZFxuICAgICAgICB9LFxuICAgICAgICBcbiAgICBcbiAgICAgICAgaGFzT3duTWV0aG9kOiBmdW5jdGlvbiAobmFtZSkgeyBcbiAgICAgICAgICAgIHJldHVybiB0aGlzLmhhc01ldGhvZChuYW1lKSAmJiB0aGlzLm1ldGhvZHMuaGFzT3duUHJvcGVydHkobmFtZSlcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBoYXNPd25BdHRyaWJ1dGU6IGZ1bmN0aW9uIChuYW1lKSB7IFxuICAgICAgICAgICAgcmV0dXJuIHRoaXMuaGFzQXR0cmlidXRlKG5hbWUpICYmIHRoaXMuYXR0cmlidXRlcy5oYXNPd25Qcm9wZXJ0eShuYW1lKVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIGV4dGVuZCA6IGZ1bmN0aW9uIChwcm9wcykge1xuICAgICAgICAgICAgSm9vc2UuTy5lYWNoT3duKHByb3BzLCBmdW5jdGlvbiAodmFsdWUsIG5hbWUpIHtcbiAgICAgICAgICAgICAgICBpZiAobmFtZSAhPSAnbWV0YScgJiYgbmFtZSAhPSAnY29uc3RydWN0b3InKSBcbiAgICAgICAgICAgICAgICAgICAgaWYgKEpvb3NlLk8uaXNGdW5jdGlvbih2YWx1ZSkgJiYgIXZhbHVlLm1ldGEpIFxuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5hZGRNZXRob2QobmFtZSwgdmFsdWUpIFxuICAgICAgICAgICAgICAgICAgICBlbHNlIFxuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5hZGRBdHRyaWJ1dGUobmFtZSwgdmFsdWUpXG4gICAgICAgICAgICB9LCB0aGlzKVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIHN1YkNsYXNzT2YgOiBmdW5jdGlvbiAoY2xhc3NPYmplY3QsIGV4dGVuZCkge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuc3ViQ2xhc3MoZXh0ZW5kLCBudWxsLCBjbGFzc09iamVjdClcbiAgICAgICAgfSxcbiAgICBcbiAgICBcbiAgICAgICAgc3ViQ2xhc3MgOiBmdW5jdGlvbiAoZXh0ZW5kLCBuYW1lLCBjbGFzc09iamVjdCkge1xuICAgICAgICAgICAgZXh0ZW5kICAgICAgPSBleHRlbmQgICAgICAgIHx8IHt9XG4gICAgICAgICAgICBleHRlbmQuaXNhICA9IGNsYXNzT2JqZWN0ICAgfHwgdGhpcy5jXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHJldHVybiBuZXcgdGhpcy5jb25zdHJ1Y3RvcihuYW1lLCBleHRlbmQpLmNcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBpbnN0YW50aWF0ZSA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHZhciBmID0gZnVuY3Rpb24gKCkge31cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgZi5wcm90b3R5cGUgPSB0aGlzLmMucHJvdG90eXBlXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciBvYmogPSBuZXcgZigpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHJldHVybiB0aGlzLmMuYXBwbHkob2JqLCBhcmd1bWVudHMpIHx8IG9ialxuICAgICAgICB9XG4gICAgfVxuICAgIFxuICAgIC8vbWljcm8gYm9vdHN0cmFwaW5nXG4gICAgXG4gICAgSm9vc2UuUHJvdG8uQ2xhc3MucHJvdG90eXBlID0gSm9vc2UuTy5nZXRNdXRhYmxlQ29weShKb29zZS5Qcm90by5PYmplY3QucHJvdG90eXBlKVxuICAgIFxuICAgIEpvb3NlLk8uZXh0ZW5kKEpvb3NlLlByb3RvLkNsYXNzLnByb3RvdHlwZSwgYm9vdHN0cmFwKVxuICAgIFxuICAgIEpvb3NlLlByb3RvLkNsYXNzLnByb3RvdHlwZS5tZXRhID0gbmV3IEpvb3NlLlByb3RvLkNsYXNzKCdKb29zZS5Qcm90by5DbGFzcycsIGJvb3RzdHJhcClcbiAgICBcbiAgICBcbiAgICBcbiAgICBKb29zZS5Qcm90by5DbGFzcy5tZXRhLmFkZE1ldGhvZCgnaXNhJywgZnVuY3Rpb24gKHNvbWVDbGFzcykge1xuICAgICAgICB2YXIgZiA9IGZ1bmN0aW9uICgpIHt9XG4gICAgICAgIFxuICAgICAgICBmLnByb3RvdHlwZSA9IHRoaXMuYy5wcm90b3R5cGVcbiAgICAgICAgXG4gICAgICAgIHJldHVybiBuZXcgZigpIGluc3RhbmNlb2Ygc29tZUNsYXNzXG4gICAgfSlcbn0pKCk7XG5Kb29zZS5NYW5hZ2VkID0gSm9vc2Uuc3R1YigpXG5cbkpvb3NlLk1hbmFnZWQuUHJvcGVydHkgPSBuZXcgSm9vc2UuUHJvdG8uQ2xhc3MoJ0pvb3NlLk1hbmFnZWQuUHJvcGVydHknLCB7XG4gICAgXG4gICAgbmFtZSAgICAgICAgICAgIDogbnVsbCxcbiAgICBcbiAgICBpbml0ICAgICAgICAgICAgOiBudWxsLFxuICAgIHZhbHVlICAgICAgICAgICA6IG51bGwsXG4gICAgXG4gICAgZGVmaW5lZEluICAgICAgIDogbnVsbCxcbiAgICBcbiAgICBcbiAgICBpbml0aWFsaXplIDogZnVuY3Rpb24gKHByb3BzKSB7XG4gICAgICAgIEpvb3NlLk1hbmFnZWQuUHJvcGVydHkuc3VwZXJDbGFzcy5pbml0aWFsaXplLmNhbGwodGhpcywgcHJvcHMpXG4gICAgICAgIFxuICAgICAgICB0aGlzLmNvbXB1dGVWYWx1ZSgpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBjb21wdXRlVmFsdWUgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHRoaXMudmFsdWUgPSB0aGlzLmluaXRcbiAgICB9LCAgICBcbiAgICBcbiAgICBcbiAgICAvL3RhcmdldENsYXNzIGlzIHN0aWxsIG9wZW4gYXQgdGhpcyBzdGFnZVxuICAgIHByZUFwcGx5IDogZnVuY3Rpb24gKHRhcmdldENsYXNzKSB7XG4gICAgfSxcbiAgICBcblxuICAgIC8vdGFyZ2V0Q2xhc3MgaXMgYWxyZWFkeSBvcGVuIGF0IHRoaXMgc3RhZ2VcbiAgICBwb3N0VW5BcHBseSA6IGZ1bmN0aW9uICh0YXJnZXRDbGFzcykge1xuICAgIH0sXG4gICAgXG4gICAgXG4gICAgYXBwbHkgOiBmdW5jdGlvbiAodGFyZ2V0KSB7XG4gICAgICAgIHRhcmdldFt0aGlzLm5hbWVdID0gdGhpcy52YWx1ZVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgaXNBcHBsaWVkVG8gOiBmdW5jdGlvbiAodGFyZ2V0KSB7XG4gICAgICAgIHJldHVybiB0YXJnZXRbdGhpcy5uYW1lXSA9PSB0aGlzLnZhbHVlXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICB1bmFwcGx5IDogZnVuY3Rpb24gKGZyb20pIHtcbiAgICAgICAgaWYgKCF0aGlzLmlzQXBwbGllZFRvKGZyb20pKSB0aHJvdyBcIlVuYXBwbHkgb2YgcHJvcGVydHkgW1wiICsgdGhpcy5uYW1lICsgXCJdIGZyb20gW1wiICsgZnJvbSArIFwiXSBmYWlsZWRcIlxuICAgICAgICBcbiAgICAgICAgZGVsZXRlIGZyb21bdGhpcy5uYW1lXVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgY2xvbmVQcm9wcyA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIG5hbWUgICAgICAgIDogdGhpcy5uYW1lLCBcbiAgICAgICAgICAgIGluaXQgICAgICAgIDogdGhpcy5pbml0LFxuICAgICAgICAgICAgZGVmaW5lZEluICAgOiB0aGlzLmRlZmluZWRJblxuICAgICAgICB9XG4gICAgfSxcblxuICAgIFxuICAgIGNsb25lIDogZnVuY3Rpb24gKG5hbWUpIHtcbiAgICAgICAgdmFyIHByb3BzID0gdGhpcy5jbG9uZVByb3BzKClcbiAgICAgICAgXG4gICAgICAgIHByb3BzLm5hbWUgPSBuYW1lIHx8IHByb3BzLm5hbWVcbiAgICAgICAgXG4gICAgICAgIHJldHVybiBuZXcgdGhpcy5jb25zdHJ1Y3Rvcihwcm9wcylcbiAgICB9XG4gICAgXG4gICAgXG59KS5jO1xuSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5Db25mbGljdE1hcmtlciA9IG5ldyBKb29zZS5Qcm90by5DbGFzcygnSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5Db25mbGljdE1hcmtlcicsIHtcbiAgICBcbiAgICBpc2EgOiBKb29zZS5NYW5hZ2VkLlByb3BlcnR5LFxuXG4gICAgYXBwbHkgOiBmdW5jdGlvbiAodGFyZ2V0KSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcIkF0dGVtcHQgdG8gYXBwbHkgQ29uZmxpY3RNYXJrZXIgW1wiICsgdGhpcy5uYW1lICsgXCJdIHRvIFtcIiArIHRhcmdldCArIFwiXVwiKVxuICAgIH1cbiAgICBcbn0pLmM7XG5Kb29zZS5NYW5hZ2VkLlByb3BlcnR5LlJlcXVpcmVtZW50ID0gbmV3IEpvb3NlLlByb3RvLkNsYXNzKCdKb29zZS5NYW5hZ2VkLlByb3BlcnR5LlJlcXVpcmVtZW50Jywge1xuICAgIFxuICAgIGlzYSA6IEpvb3NlLk1hbmFnZWQuUHJvcGVydHksXG5cbiAgICBcbiAgICBhcHBseSA6IGZ1bmN0aW9uICh0YXJnZXQpIHtcbiAgICAgICAgaWYgKCF0YXJnZXQubWV0YS5oYXNNZXRob2QodGhpcy5uYW1lKSkgXG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJSZXF1aXJlbWVudCBbXCIgKyB0aGlzLm5hbWUgKyBcIl0sIGRlZmluZWQgaW4gW1wiICsgdGhpcy5kZWZpbmVkSW4uZGVmaW5lZEluLm5hbWUgKyBcIl0gaXMgbm90IHNhdGlzZmllZCBmb3IgY2xhc3MgW1wiICsgdGFyZ2V0ICsgXCJdXCIpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICB1bmFwcGx5IDogZnVuY3Rpb24gKGZyb20pIHtcbiAgICB9XG4gICAgXG59KS5jO1xuSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5BdHRyaWJ1dGUgPSBuZXcgSm9vc2UuUHJvdG8uQ2xhc3MoJ0pvb3NlLk1hbmFnZWQuUHJvcGVydHkuQXR0cmlidXRlJywge1xuICAgIFxuICAgIGlzYSA6IEpvb3NlLk1hbmFnZWQuUHJvcGVydHksXG4gICAgXG4gICAgc2xvdCAgICAgICAgICAgICAgICA6IG51bGwsXG4gICAgXG4gICAgXG4gICAgaW5pdGlhbGl6ZSA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5BdHRyaWJ1dGUuc3VwZXJDbGFzcy5pbml0aWFsaXplLmFwcGx5KHRoaXMsIGFyZ3VtZW50cylcbiAgICAgICAgXG4gICAgICAgIHRoaXMuc2xvdCA9IHRoaXMubmFtZVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgYXBwbHkgOiBmdW5jdGlvbiAodGFyZ2V0KSB7XG4gICAgICAgIHRhcmdldC5wcm90b3R5cGVbIHRoaXMuc2xvdCBdID0gdGhpcy52YWx1ZVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgaXNBcHBsaWVkVG8gOiBmdW5jdGlvbiAodGFyZ2V0KSB7XG4gICAgICAgIHJldHVybiB0YXJnZXQucHJvdG90eXBlWyB0aGlzLnNsb3QgXSA9PSB0aGlzLnZhbHVlXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICB1bmFwcGx5IDogZnVuY3Rpb24gKGZyb20pIHtcbiAgICAgICAgaWYgKCF0aGlzLmlzQXBwbGllZFRvKGZyb20pKSB0aHJvdyBcIlVuYXBwbHkgb2YgcHJvcGVydHkgW1wiICsgdGhpcy5uYW1lICsgXCJdIGZyb20gW1wiICsgZnJvbSArIFwiXSBmYWlsZWRcIlxuICAgICAgICBcbiAgICAgICAgZGVsZXRlIGZyb20ucHJvdG90eXBlW3RoaXMuc2xvdF1cbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGNsZWFyVmFsdWUgOiBmdW5jdGlvbiAoaW5zdGFuY2UpIHtcbiAgICAgICAgZGVsZXRlIGluc3RhbmNlWyB0aGlzLnNsb3QgXVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgaGFzVmFsdWUgOiBmdW5jdGlvbiAoaW5zdGFuY2UpIHtcbiAgICAgICAgcmV0dXJuIGluc3RhbmNlLmhhc093blByb3BlcnR5KHRoaXMuc2xvdClcbiAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgZ2V0UmF3VmFsdWVGcm9tIDogZnVuY3Rpb24gKGluc3RhbmNlKSB7XG4gICAgICAgIHJldHVybiBpbnN0YW5jZVsgdGhpcy5zbG90IF1cbiAgICB9LFxuICAgIFxuICAgIFxuICAgIHNldFJhd1ZhbHVlVG8gOiBmdW5jdGlvbiAoaW5zdGFuY2UsIHZhbHVlKSB7XG4gICAgICAgIGluc3RhbmNlWyB0aGlzLnNsb3QgXSA9IHZhbHVlXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gdGhpc1xuICAgIH1cbiAgICBcbn0pLmM7XG5Kb29zZS5NYW5hZ2VkLlByb3BlcnR5Lk1ldGhvZE1vZGlmaWVyID0gbmV3IEpvb3NlLlByb3RvLkNsYXNzKCdKb29zZS5NYW5hZ2VkLlByb3BlcnR5Lk1ldGhvZE1vZGlmaWVyJywge1xuICAgIFxuICAgIGlzYSA6IEpvb3NlLk1hbmFnZWQuUHJvcGVydHksXG5cbiAgICBcbiAgICBwcmVwYXJlV3JhcHBlciA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgdGhyb3cgXCJBYnN0cmFjdCBtZXRob2QgW3ByZXBhcmVXcmFwcGVyXSBvZiBcIiArIHRoaXMgKyBcIiB3YXMgY2FsbGVkXCJcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGFwcGx5IDogZnVuY3Rpb24gKHRhcmdldCkge1xuICAgICAgICB2YXIgbmFtZSAgICAgICAgICAgID0gdGhpcy5uYW1lXG4gICAgICAgIHZhciB0YXJnZXRQcm90byAgICAgPSB0YXJnZXQucHJvdG90eXBlXG4gICAgICAgIHZhciBpc093biAgICAgICAgICAgPSB0YXJnZXRQcm90by5oYXNPd25Qcm9wZXJ0eShuYW1lKVxuICAgICAgICB2YXIgb3JpZ2luYWwgICAgICAgID0gdGFyZ2V0UHJvdG9bbmFtZV1cbiAgICAgICAgdmFyIHN1cGVyUHJvdG8gICAgICA9IHRhcmdldC5tZXRhLnN1cGVyQ2xhc3MucHJvdG90eXBlXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgdmFyIG9yaWdpbmFsQ2FsbCA9IGlzT3duID8gb3JpZ2luYWwgOiBmdW5jdGlvbiAoKSB7IFxuICAgICAgICAgICAgcmV0dXJuIHN1cGVyUHJvdG9bbmFtZV0uYXBwbHkodGhpcywgYXJndW1lbnRzKSBcbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgdmFyIG1ldGhvZFdyYXBwZXIgPSB0aGlzLnByZXBhcmVXcmFwcGVyKHtcbiAgICAgICAgICAgIG5hbWUgICAgICAgICAgICA6IG5hbWUsXG4gICAgICAgICAgICBtb2RpZmllciAgICAgICAgOiB0aGlzLnZhbHVlLCBcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaXNPd24gICAgICAgICAgIDogaXNPd24sXG4gICAgICAgICAgICBvcmlnaW5hbENhbGwgICAgOiBvcmlnaW5hbENhbGwsIFxuICAgICAgICAgICAgXG4gICAgICAgICAgICBzdXBlclByb3RvICAgICAgOiBzdXBlclByb3RvLFxuICAgICAgICAgICAgXG4gICAgICAgICAgICB0YXJnZXQgICAgICAgICAgOiB0YXJnZXRcbiAgICAgICAgfSlcbiAgICAgICAgXG4gICAgICAgIGlmIChpc093bikgbWV0aG9kV3JhcHBlci5fX09SSUdJTkFMX18gPSBvcmlnaW5hbFxuICAgICAgICBcbiAgICAgICAgbWV0aG9kV3JhcHBlci5fX0NPTlRBSU5fXyAgID0gdGhpcy52YWx1ZVxuICAgICAgICBtZXRob2RXcmFwcGVyLl9fTUVUSE9EX18gICAgPSB0aGlzXG4gICAgICAgIFxuICAgICAgICB0YXJnZXRQcm90b1tuYW1lXSA9IG1ldGhvZFdyYXBwZXJcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGlzQXBwbGllZFRvIDogZnVuY3Rpb24gKHRhcmdldCkge1xuICAgICAgICB2YXIgdGFyZ2V0Q29udCA9IHRhcmdldC5wcm90b3R5cGVbdGhpcy5uYW1lXVxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIHRhcmdldENvbnQgJiYgdGFyZ2V0Q29udC5fX0NPTlRBSU5fXyA9PSB0aGlzLnZhbHVlXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICB1bmFwcGx5IDogZnVuY3Rpb24gKGZyb20pIHtcbiAgICAgICAgdmFyIG5hbWUgPSB0aGlzLm5hbWVcbiAgICAgICAgdmFyIGZyb21Qcm90byA9IGZyb20ucHJvdG90eXBlXG4gICAgICAgIHZhciBvcmlnaW5hbCA9IGZyb21Qcm90b1tuYW1lXS5fX09SSUdJTkFMX19cbiAgICAgICAgXG4gICAgICAgIGlmICghdGhpcy5pc0FwcGxpZWRUbyhmcm9tKSkgdGhyb3cgXCJVbmFwcGx5IG9mIG1ldGhvZCBbXCIgKyBuYW1lICsgXCJdIGZyb20gY2xhc3MgW1wiICsgZnJvbSArIFwiXSBmYWlsZWRcIlxuICAgICAgICBcbiAgICAgICAgLy9pZiBtb2RpZmllciB3YXMgYXBwbGllZCB0byBvd24gbWV0aG9kIC0gcmVzdG9yZSBpdFxuICAgICAgICBpZiAob3JpZ2luYWwpIFxuICAgICAgICAgICAgZnJvbVByb3RvW25hbWVdID0gb3JpZ2luYWxcbiAgICAgICAgLy9vdGhlcndpc2UgLSBqdXN0IGRlbGV0ZSBpdCwgdG8gcmV2ZWFsIHRoZSBpbmhlcml0ZWQgbWV0aG9kIFxuICAgICAgICBlbHNlXG4gICAgICAgICAgICBkZWxldGUgZnJvbVByb3RvW25hbWVdXG4gICAgfVxuICAgIFxufSkuYztcbkpvb3NlLk1hbmFnZWQuUHJvcGVydHkuTWV0aG9kTW9kaWZpZXIuT3ZlcnJpZGUgPSBuZXcgSm9vc2UuUHJvdG8uQ2xhc3MoJ0pvb3NlLk1hbmFnZWQuUHJvcGVydHkuTWV0aG9kTW9kaWZpZXIuT3ZlcnJpZGUnLCB7XG4gICAgXG4gICAgaXNhIDogSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5NZXRob2RNb2RpZmllcixcblxuICAgIFxuICAgIHByZXBhcmVXcmFwcGVyIDogZnVuY3Rpb24gKHBhcmFtcykge1xuICAgICAgICBcbiAgICAgICAgdmFyIG1vZGlmaWVyICAgICAgICA9IHBhcmFtcy5tb2RpZmllclxuICAgICAgICB2YXIgb3JpZ2luYWxDYWxsICAgID0gcGFyYW1zLm9yaWdpbmFsQ2FsbFxuICAgICAgICB2YXIgc3VwZXJQcm90byAgICAgID0gcGFyYW1zLnN1cGVyUHJvdG9cbiAgICAgICAgdmFyIHN1cGVyTWV0YUNvbnN0ICA9IHN1cGVyUHJvdG8ubWV0YS5jb25zdHJ1Y3RvclxuICAgICAgICBcbiAgICAgICAgLy9jYWxsIHRvIEpvb3NlLlByb3RvIGxldmVsLCByZXF1aXJlIHNvbWUgYWRkaXRpb25hbCBwcm9jZXNzaW5nXG4gICAgICAgIHZhciBpc0NhbGxUb1Byb3RvID0gKHN1cGVyTWV0YUNvbnN0ID09IEpvb3NlLlByb3RvLkNsYXNzIHx8IHN1cGVyTWV0YUNvbnN0ID09IEpvb3NlLlByb3RvLk9iamVjdCkgJiYgIShwYXJhbXMuaXNPd24gJiYgb3JpZ2luYWxDYWxsLklTX09WRVJSSURFKSBcbiAgICAgICAgXG4gICAgICAgIHZhciBvcmlnaW5hbCA9IG9yaWdpbmFsQ2FsbFxuICAgICAgICBcbiAgICAgICAgaWYgKGlzQ2FsbFRvUHJvdG8pIG9yaWdpbmFsID0gZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgdmFyIGJlZm9yZVNVUEVSID0gdGhpcy5TVVBFUlxuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLlNVUEVSICA9IHN1cGVyUHJvdG8uU1VQRVJcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdmFyIHJlcyA9IG9yaWdpbmFsQ2FsbC5hcHBseSh0aGlzLCBhcmd1bWVudHMpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXMuU1VQRVIgPSBiZWZvcmVTVVBFUlxuICAgICAgICAgICAgXG4gICAgICAgICAgICByZXR1cm4gcmVzXG4gICAgICAgIH1cblxuICAgICAgICB2YXIgb3ZlcnJpZGUgPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciBiZWZvcmVTVVBFUiA9IHRoaXMuU1VQRVJcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpcy5TVVBFUiAgPSBvcmlnaW5hbFxuICAgICAgICAgICAgXG4gICAgICAgICAgICB2YXIgcmVzID0gbW9kaWZpZXIuYXBwbHkodGhpcywgYXJndW1lbnRzKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLlNVUEVSID0gYmVmb3JlU1VQRVJcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcmV0dXJuIHJlc1xuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICBvdmVycmlkZS5JU19PVkVSUklERSA9IHRydWVcbiAgICAgICAgXG4gICAgICAgIHJldHVybiBvdmVycmlkZVxuICAgIH1cbiAgICBcbiAgICBcbn0pLmM7XG5Kb29zZS5NYW5hZ2VkLlByb3BlcnR5Lk1ldGhvZE1vZGlmaWVyLlB1dCA9IG5ldyBKb29zZS5Qcm90by5DbGFzcygnSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5NZXRob2RNb2RpZmllci5QdXQnLCB7XG4gICAgXG4gICAgaXNhIDogSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5NZXRob2RNb2RpZmllci5PdmVycmlkZSxcblxuXG4gICAgcHJlcGFyZVdyYXBwZXIgOiBmdW5jdGlvbiAocGFyYW1zKSB7XG4gICAgICAgIFxuICAgICAgICBpZiAocGFyYW1zLmlzT3duKSB0aHJvdyBcIk1ldGhvZCBbXCIgKyBwYXJhbXMubmFtZSArIFwiXSBpcyBhcHBseWluZyBvdmVyIHNvbWV0aGluZyBbXCIgKyBwYXJhbXMub3JpZ2luYWxDYWxsICsgXCJdIGluIGNsYXNzIFtcIiArIHBhcmFtcy50YXJnZXQgKyBcIl1cIlxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIEpvb3NlLk1hbmFnZWQuUHJvcGVydHkuTWV0aG9kTW9kaWZpZXIuUHV0LnN1cGVyQ2xhc3MucHJlcGFyZVdyYXBwZXIuY2FsbCh0aGlzLCBwYXJhbXMpXG4gICAgfVxuICAgIFxuICAgIFxufSkuYztcbkpvb3NlLk1hbmFnZWQuUHJvcGVydHkuTWV0aG9kTW9kaWZpZXIuQWZ0ZXIgPSBuZXcgSm9vc2UuUHJvdG8uQ2xhc3MoJ0pvb3NlLk1hbmFnZWQuUHJvcGVydHkuTWV0aG9kTW9kaWZpZXIuQWZ0ZXInLCB7XG4gICAgXG4gICAgaXNhIDogSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5NZXRob2RNb2RpZmllcixcblxuICAgIFxuICAgIHByZXBhcmVXcmFwcGVyIDogZnVuY3Rpb24gKHBhcmFtcykge1xuICAgICAgICBcbiAgICAgICAgdmFyIG1vZGlmaWVyICAgICAgICA9IHBhcmFtcy5tb2RpZmllclxuICAgICAgICB2YXIgb3JpZ2luYWxDYWxsICAgID0gcGFyYW1zLm9yaWdpbmFsQ2FsbFxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHZhciByZXMgPSBvcmlnaW5hbENhbGwuYXBwbHkodGhpcywgYXJndW1lbnRzKVxuICAgICAgICAgICAgbW9kaWZpZXIuYXBwbHkodGhpcywgYXJndW1lbnRzKVxuICAgICAgICAgICAgcmV0dXJuIHJlc1xuICAgICAgICB9XG4gICAgfSAgICBcblxuICAgIFxufSkuYztcbkpvb3NlLk1hbmFnZWQuUHJvcGVydHkuTWV0aG9kTW9kaWZpZXIuQmVmb3JlID0gbmV3IEpvb3NlLlByb3RvLkNsYXNzKCdKb29zZS5NYW5hZ2VkLlByb3BlcnR5Lk1ldGhvZE1vZGlmaWVyLkJlZm9yZScsIHtcbiAgICBcbiAgICBpc2EgOiBKb29zZS5NYW5hZ2VkLlByb3BlcnR5Lk1ldGhvZE1vZGlmaWVyLFxuXG4gICAgXG4gICAgcHJlcGFyZVdyYXBwZXIgOiBmdW5jdGlvbiAocGFyYW1zKSB7XG4gICAgICAgIFxuICAgICAgICB2YXIgbW9kaWZpZXIgICAgICAgID0gcGFyYW1zLm1vZGlmaWVyXG4gICAgICAgIHZhciBvcmlnaW5hbENhbGwgICAgPSBwYXJhbXMub3JpZ2luYWxDYWxsXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgbW9kaWZpZXIuYXBwbHkodGhpcywgYXJndW1lbnRzKVxuICAgICAgICAgICAgcmV0dXJuIG9yaWdpbmFsQ2FsbC5hcHBseSh0aGlzLCBhcmd1bWVudHMpXG4gICAgICAgIH1cbiAgICB9XG4gICAgXG59KS5jO1xuSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5NZXRob2RNb2RpZmllci5Bcm91bmQgPSBuZXcgSm9vc2UuUHJvdG8uQ2xhc3MoJ0pvb3NlLk1hbmFnZWQuUHJvcGVydHkuTWV0aG9kTW9kaWZpZXIuQXJvdW5kJywge1xuICAgIFxuICAgIGlzYSA6IEpvb3NlLk1hbmFnZWQuUHJvcGVydHkuTWV0aG9kTW9kaWZpZXIsXG5cbiAgICBwcmVwYXJlV3JhcHBlciA6IGZ1bmN0aW9uIChwYXJhbXMpIHtcbiAgICAgICAgXG4gICAgICAgIHZhciBtb2RpZmllciAgICAgICAgPSBwYXJhbXMubW9kaWZpZXJcbiAgICAgICAgdmFyIG9yaWdpbmFsQ2FsbCAgICA9IHBhcmFtcy5vcmlnaW5hbENhbGxcbiAgICAgICAgXG4gICAgICAgIHZhciBtZVxuICAgICAgICBcbiAgICAgICAgdmFyIGJvdW5kID0gZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgcmV0dXJuIG9yaWdpbmFsQ2FsbC5hcHBseShtZSwgYXJndW1lbnRzKVxuICAgICAgICB9XG4gICAgICAgICAgICBcbiAgICAgICAgcmV0dXJuIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIG1lID0gdGhpc1xuICAgICAgICAgICAgXG4gICAgICAgICAgICB2YXIgYm91bmRBcnIgPSBbIGJvdW5kIF1cbiAgICAgICAgICAgIGJvdW5kQXJyLnB1c2guYXBwbHkoYm91bmRBcnIsIGFyZ3VtZW50cylcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcmV0dXJuIG1vZGlmaWVyLmFwcGx5KHRoaXMsIGJvdW5kQXJyKVxuICAgICAgICB9XG4gICAgfVxuICAgIFxufSkuYztcbkpvb3NlLk1hbmFnZWQuUHJvcGVydHkuTWV0aG9kTW9kaWZpZXIuQXVnbWVudCA9IG5ldyBKb29zZS5Qcm90by5DbGFzcygnSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5NZXRob2RNb2RpZmllci5BdWdtZW50Jywge1xuICAgIFxuICAgIGlzYSA6IEpvb3NlLk1hbmFnZWQuUHJvcGVydHkuTWV0aG9kTW9kaWZpZXIsXG5cbiAgICBcbiAgICBwcmVwYXJlV3JhcHBlciA6IGZ1bmN0aW9uIChwYXJhbXMpIHtcbiAgICAgICAgXG4gICAgICAgIHZhciBBVUdNRU5UID0gZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgXG4gICAgICAgICAgICAvL3BvcHVsYXRlIGNhbGxzdGFjayB0byB0aGUgbW9zdCBkZWVwIG5vbi1hdWdtZW50IG1ldGhvZFxuICAgICAgICAgICAgdmFyIGNhbGxzdGFjayA9IFtdXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciBzZWxmID0gQVVHTUVOVFxuICAgICAgICAgICAgXG4gICAgICAgICAgICBkbyB7XG4gICAgICAgICAgICAgICAgY2FsbHN0YWNrLnB1c2goc2VsZi5JU19BVUdNRU5UID8gc2VsZi5fX0NPTlRBSU5fXyA6IHNlbGYpXG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgc2VsZiA9IHNlbGYuSVNfQVVHTUVOVCAmJiAoc2VsZi5fX09SSUdJTkFMX18gfHwgc2VsZi5TVVBFUltzZWxmLm1ldGhvZE5hbWVdKVxuICAgICAgICAgICAgfSB3aGlsZSAoc2VsZilcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgXG4gICAgICAgICAgICAvL3NhdmUgcHJldmlvdXMgSU5ORVJcbiAgICAgICAgICAgIHZhciBiZWZvcmVJTk5FUiA9IHRoaXMuSU5ORVJcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy9jcmVhdGUgbmV3IElOTkVSXG4gICAgICAgICAgICB0aGlzLklOTkVSID0gZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgIHZhciBpbm5lckNhbGwgPSBjYWxsc3RhY2sucG9wKClcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICByZXR1cm4gaW5uZXJDYWxsID8gaW5uZXJDYWxsLmFwcGx5KHRoaXMsIGFyZ3VtZW50cykgOiB1bmRlZmluZWRcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy9hdWdtZW50IG1vZGlmaWVyIHJlc3VsdHMgaW4gaHlwb3RldGljYWwgSU5ORVIgY2FsbCBvZiB0aGUgc2FtZSBtZXRob2QgaW4gc3ViY2xhc3MgXG4gICAgICAgICAgICB2YXIgcmVzID0gdGhpcy5JTk5FUi5hcHBseSh0aGlzLCBhcmd1bWVudHMpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vcmVzdG9yZSBwcmV2aW91cyBJTk5FUiBjaGFpblxuICAgICAgICAgICAgdGhpcy5JTk5FUiA9IGJlZm9yZUlOTkVSXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHJldHVybiByZXNcbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgQVVHTUVOVC5tZXRob2ROYW1lICA9IHBhcmFtcy5uYW1lXG4gICAgICAgIEFVR01FTlQuU1VQRVIgICAgICAgPSBwYXJhbXMuc3VwZXJQcm90b1xuICAgICAgICBBVUdNRU5ULklTX0FVR01FTlQgID0gdHJ1ZVxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIEFVR01FTlRcbiAgICB9XG4gICAgXG59KS5jO1xuSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eVNldCA9IG5ldyBKb29zZS5Qcm90by5DbGFzcygnSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eVNldCcsIHtcbiAgICBcbiAgICBpc2EgICAgICAgICAgICAgICAgICAgICAgIDogSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eSxcblxuICAgIHByb3BlcnRpZXMgICAgICAgICAgICAgICAgOiBudWxsLFxuICAgIFxuICAgIHByb3BlcnR5TWV0YUNsYXNzICAgICAgICAgOiBKb29zZS5NYW5hZ2VkLlByb3BlcnR5LFxuICAgIFxuICAgIFxuICAgIGluaXRpYWxpemUgOiBmdW5jdGlvbiAocHJvcHMpIHtcbiAgICAgICAgSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eVNldC5zdXBlckNsYXNzLmluaXRpYWxpemUuY2FsbCh0aGlzLCBwcm9wcylcbiAgICAgICAgXG4gICAgICAgIC8vWFhYIHRoaXMgZ3VhcmRzIHRoZSBtZXRhIHJvbGVzIDopXG4gICAgICAgIHRoaXMucHJvcGVydGllcyA9IHByb3BzLnByb3BlcnRpZXMgfHwge31cbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGFkZFByb3BlcnR5IDogZnVuY3Rpb24gKG5hbWUsIHByb3BzKSB7XG4gICAgICAgIHZhciBtZXRhQ2xhc3MgPSBwcm9wcy5tZXRhIHx8IHRoaXMucHJvcGVydHlNZXRhQ2xhc3NcbiAgICAgICAgZGVsZXRlIHByb3BzLm1ldGFcbiAgICAgICAgXG4gICAgICAgIHByb3BzLmRlZmluZWRJbiAgICAgPSB0aGlzXG4gICAgICAgIHByb3BzLm5hbWUgICAgICAgICAgPSBuYW1lXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gdGhpcy5wcm9wZXJ0aWVzW25hbWVdID0gbmV3IG1ldGFDbGFzcyhwcm9wcylcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGFkZFByb3BlcnR5T2JqZWN0IDogZnVuY3Rpb24gKG9iamVjdCkge1xuICAgICAgICByZXR1cm4gdGhpcy5wcm9wZXJ0aWVzW29iamVjdC5uYW1lXSA9IG9iamVjdFxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgcmVtb3ZlUHJvcGVydHkgOiBmdW5jdGlvbiAobmFtZSkge1xuICAgICAgICB2YXIgcHJvcCA9IHRoaXMucHJvcGVydGllc1tuYW1lXVxuICAgICAgICBcbiAgICAgICAgZGVsZXRlIHRoaXMucHJvcGVydGllc1tuYW1lXVxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIHByb3BcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGhhdmVQcm9wZXJ0eSA6IGZ1bmN0aW9uIChuYW1lKSB7XG4gICAgICAgIHJldHVybiB0aGlzLnByb3BlcnRpZXNbbmFtZV0gIT0gbnVsbFxuICAgIH0sXG4gICAgXG5cbiAgICBoYXZlT3duUHJvcGVydHkgOiBmdW5jdGlvbiAobmFtZSkge1xuICAgICAgICByZXR1cm4gdGhpcy5oYXZlUHJvcGVydHkobmFtZSkgJiYgdGhpcy5wcm9wZXJ0aWVzLmhhc093blByb3BlcnR5KG5hbWUpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBnZXRQcm9wZXJ0eSA6IGZ1bmN0aW9uIChuYW1lKSB7XG4gICAgICAgIHJldHVybiB0aGlzLnByb3BlcnRpZXNbbmFtZV1cbiAgICB9LFxuICAgIFxuICAgIFxuICAgIC8vaW5jbHVkZXMgaW5oZXJpdGVkIHByb3BlcnRpZXMgKHByb2JhYmx5IHlvdSB3YW50cyAnZWFjaE93bicsIHdoaWNoIHByb2Nlc3Mgb25seSBcIm93blwiIChpbmNsdWRpbmcgY29uc3VtZWQgZnJvbSBSb2xlcykgcHJvcGVydGllcykgXG4gICAgZWFjaCA6IGZ1bmN0aW9uIChmdW5jLCBzY29wZSkge1xuICAgICAgICBKb29zZS5PLmVhY2godGhpcy5wcm9wZXJ0aWVzLCBmdW5jLCBzY29wZSB8fCB0aGlzKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgZWFjaE93biA6IGZ1bmN0aW9uIChmdW5jLCBzY29wZSkge1xuICAgICAgICBKb29zZS5PLmVhY2hPd24odGhpcy5wcm9wZXJ0aWVzLCBmdW5jLCBzY29wZSB8fCB0aGlzKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgLy9zeW5vbnltIGZvciBlYWNoXG4gICAgZWFjaEFsbCA6IGZ1bmN0aW9uIChmdW5jLCBzY29wZSkge1xuICAgICAgICB0aGlzLmVhY2goZnVuYywgc2NvcGUpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBjbG9uZVByb3BzIDogZnVuY3Rpb24gKCkge1xuICAgICAgICB2YXIgcHJvcHMgPSBKb29zZS5NYW5hZ2VkLlByb3BlcnR5U2V0LnN1cGVyQ2xhc3MuY2xvbmVQcm9wcy5jYWxsKHRoaXMpXG4gICAgICAgIFxuICAgICAgICBwcm9wcy5wcm9wZXJ0eU1ldGFDbGFzcyAgICAgPSB0aGlzLnByb3BlcnR5TWV0YUNsYXNzXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gcHJvcHNcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGNsb25lIDogZnVuY3Rpb24gKG5hbWUpIHtcbiAgICAgICAgdmFyIGNsb25lID0gdGhpcy5jbGVhbkNsb25lKG5hbWUpXG4gICAgICAgIFxuICAgICAgICBjbG9uZS5wcm9wZXJ0aWVzID0gSm9vc2UuTy5jb3B5T3duKHRoaXMucHJvcGVydGllcylcbiAgICAgICAgXG4gICAgICAgIHJldHVybiBjbG9uZVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgY2xlYW5DbG9uZSA6IGZ1bmN0aW9uIChuYW1lKSB7XG4gICAgICAgIHZhciBwcm9wcyA9IHRoaXMuY2xvbmVQcm9wcygpXG4gICAgICAgIFxuICAgICAgICBwcm9wcy5uYW1lID0gbmFtZSB8fCBwcm9wcy5uYW1lXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gbmV3IHRoaXMuY29uc3RydWN0b3IocHJvcHMpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBhbGlhcyA6IGZ1bmN0aW9uICh3aGF0KSB7XG4gICAgICAgIHZhciBwcm9wcyA9IHRoaXMucHJvcGVydGllc1xuICAgICAgICBcbiAgICAgICAgSm9vc2UuTy5lYWNoKHdoYXQsIGZ1bmN0aW9uIChhbGlhc05hbWUsIG9yaWdpbmFsTmFtZSkge1xuICAgICAgICAgICAgdmFyIG9yaWdpbmFsID0gcHJvcHNbb3JpZ2luYWxOYW1lXVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAob3JpZ2luYWwpIHRoaXMuYWRkUHJvcGVydHlPYmplY3Qob3JpZ2luYWwuY2xvbmUoYWxpYXNOYW1lKSlcbiAgICAgICAgfSwgdGhpcylcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGV4Y2x1ZGUgOiBmdW5jdGlvbiAod2hhdCkge1xuICAgICAgICB2YXIgcHJvcHMgPSB0aGlzLnByb3BlcnRpZXNcbiAgICAgICAgXG4gICAgICAgIEpvb3NlLkEuZWFjaCh3aGF0LCBmdW5jdGlvbiAobmFtZSkge1xuICAgICAgICAgICAgZGVsZXRlIHByb3BzW25hbWVdXG4gICAgICAgIH0pXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBiZWZvcmVDb25zdW1lZEJ5IDogZnVuY3Rpb24gKCkge1xuICAgIH0sXG4gICAgXG4gICAgXG4gICAgZmxhdHRlblRvIDogZnVuY3Rpb24gKHRhcmdldCkge1xuICAgICAgICB2YXIgdGFyZ2V0UHJvcHMgPSB0YXJnZXQucHJvcGVydGllc1xuICAgICAgICBcbiAgICAgICAgdGhpcy5lYWNoT3duKGZ1bmN0aW9uIChwcm9wZXJ0eSwgbmFtZSkge1xuICAgICAgICAgICAgdmFyIHRhcmdldFByb3BlcnR5ID0gdGFyZ2V0UHJvcHNbbmFtZV1cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKHRhcmdldFByb3BlcnR5IGluc3RhbmNlb2YgSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5Db25mbGljdE1hcmtlcikgcmV0dXJuXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmICghdGFyZ2V0UHJvcHMuaGFzT3duUHJvcGVydHkobmFtZSkgfHwgdGFyZ2V0UHJvcGVydHkgPT0gbnVsbCkge1xuICAgICAgICAgICAgICAgIHRhcmdldC5hZGRQcm9wZXJ0eU9iamVjdChwcm9wZXJ0eSlcbiAgICAgICAgICAgICAgICByZXR1cm5cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKHRhcmdldFByb3BlcnR5ID09IHByb3BlcnR5KSByZXR1cm5cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGFyZ2V0LnJlbW92ZVByb3BlcnR5KG5hbWUpXG4gICAgICAgICAgICB0YXJnZXQuYWRkUHJvcGVydHkobmFtZSwge1xuICAgICAgICAgICAgICAgIG1ldGEgOiBKb29zZS5NYW5hZ2VkLlByb3BlcnR5LkNvbmZsaWN0TWFya2VyXG4gICAgICAgICAgICB9KVxuICAgICAgICB9LCB0aGlzKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgY29tcG9zZVRvIDogZnVuY3Rpb24gKHRhcmdldCkge1xuICAgICAgICB0aGlzLmVhY2hPd24oZnVuY3Rpb24gKHByb3BlcnR5LCBuYW1lKSB7XG4gICAgICAgICAgICBpZiAoIXRhcmdldC5oYXZlT3duUHJvcGVydHkobmFtZSkpIHRhcmdldC5hZGRQcm9wZXJ0eU9iamVjdChwcm9wZXJ0eSlcbiAgICAgICAgfSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGNvbXBvc2VGcm9tIDogZnVuY3Rpb24gKCkge1xuICAgICAgICBpZiAoIWFyZ3VtZW50cy5sZW5ndGgpIHJldHVyblxuICAgICAgICBcbiAgICAgICAgdmFyIGZsYXR0ZW5pbmcgPSB0aGlzLmNsZWFuQ2xvbmUoKVxuICAgICAgICBcbiAgICAgICAgSm9vc2UuQS5lYWNoKGFyZ3VtZW50cywgZnVuY3Rpb24gKGFyZykge1xuICAgICAgICAgICAgdmFyIGlzRGVzY3JpcHRvciAgICA9ICEoYXJnIGluc3RhbmNlb2YgSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eVNldClcbiAgICAgICAgICAgIHZhciBwcm9wU2V0ICAgICAgICAgPSBpc0Rlc2NyaXB0b3IgPyBhcmcucHJvcGVydHlTZXQgOiBhcmdcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcHJvcFNldC5iZWZvcmVDb25zdW1lZEJ5KHRoaXMsIGZsYXR0ZW5pbmcpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmIChpc0Rlc2NyaXB0b3IpIHtcbiAgICAgICAgICAgICAgICBpZiAoYXJnLmFsaWFzIHx8IGFyZy5leGNsdWRlKSAgIHByb3BTZXQgPSBwcm9wU2V0LmNsb25lKClcbiAgICAgICAgICAgICAgICBpZiAoYXJnLmFsaWFzKSAgICAgICAgICAgICAgICAgIHByb3BTZXQuYWxpYXMoYXJnLmFsaWFzKVxuICAgICAgICAgICAgICAgIGlmIChhcmcuZXhjbHVkZSkgICAgICAgICAgICAgICAgcHJvcFNldC5leGNsdWRlKGFyZy5leGNsdWRlKVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBwcm9wU2V0LmZsYXR0ZW5UbyhmbGF0dGVuaW5nKVxuICAgICAgICB9LCB0aGlzKVxuICAgICAgICBcbiAgICAgICAgZmxhdHRlbmluZy5jb21wb3NlVG8odGhpcylcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIHByZUFwcGx5IDogZnVuY3Rpb24gKHRhcmdldCkge1xuICAgICAgICB0aGlzLmVhY2hPd24oZnVuY3Rpb24gKHByb3BlcnR5KSB7XG4gICAgICAgICAgICBwcm9wZXJ0eS5wcmVBcHBseSh0YXJnZXQpXG4gICAgICAgIH0pXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBhcHBseSA6IGZ1bmN0aW9uICh0YXJnZXQpIHtcbiAgICAgICAgdGhpcy5lYWNoT3duKGZ1bmN0aW9uIChwcm9wZXJ0eSkge1xuICAgICAgICAgICAgcHJvcGVydHkuYXBwbHkodGFyZ2V0KVxuICAgICAgICB9KVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgdW5hcHBseSA6IGZ1bmN0aW9uIChmcm9tKSB7XG4gICAgICAgIHRoaXMuZWFjaE93bihmdW5jdGlvbiAocHJvcGVydHkpIHtcbiAgICAgICAgICAgIHByb3BlcnR5LnVuYXBwbHkoZnJvbSlcbiAgICAgICAgfSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIHBvc3RVbkFwcGx5IDogZnVuY3Rpb24gKHRhcmdldCkge1xuICAgICAgICB0aGlzLmVhY2hPd24oZnVuY3Rpb24gKHByb3BlcnR5KSB7XG4gICAgICAgICAgICBwcm9wZXJ0eS5wb3N0VW5BcHBseSh0YXJnZXQpXG4gICAgICAgIH0pXG4gICAgfVxuICAgIFxufSkuY1xuO1xudmFyIF9fSURfXyA9IDFcblxuXG5Kb29zZS5NYW5hZ2VkLlByb3BlcnR5U2V0Lk11dGFibGUgPSBuZXcgSm9vc2UuUHJvdG8uQ2xhc3MoJ0pvb3NlLk1hbmFnZWQuUHJvcGVydHlTZXQuTXV0YWJsZScsIHtcbiAgICBcbiAgICBpc2EgICAgICAgICAgICAgICAgIDogSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eVNldCxcblxuICAgIElEICAgICAgICAgICAgICAgICAgOiBudWxsLFxuICAgIFxuICAgIGRlcml2YXRpdmVzICAgICAgICAgOiBudWxsLFxuICAgIFxuICAgIG9wZW5lZCAgICAgICAgICAgICAgOiBudWxsLFxuICAgIFxuICAgIGNvbXBvc2VkRnJvbSAgICAgICAgOiBudWxsLFxuICAgIFxuICAgIFxuICAgIGluaXRpYWxpemUgOiBmdW5jdGlvbiAocHJvcHMpIHtcbiAgICAgICAgSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eVNldC5NdXRhYmxlLnN1cGVyQ2xhc3MuaW5pdGlhbGl6ZS5jYWxsKHRoaXMsIHByb3BzKVxuICAgICAgICBcbiAgICAgICAgLy9pbml0aWFsbHkgb3BlbmVkXG4gICAgICAgIHRoaXMub3BlbmVkICAgICAgICAgICAgID0gMVxuICAgICAgICB0aGlzLmRlcml2YXRpdmVzICAgICAgICA9IHt9XG4gICAgICAgIHRoaXMuSUQgICAgICAgICAgICAgICAgID0gX19JRF9fKytcbiAgICAgICAgdGhpcy5jb21wb3NlZEZyb20gICAgICAgPSBbXVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgYWRkQ29tcG9zZUluZm8gOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHRoaXMuZW5zdXJlT3BlbigpXG4gICAgICAgIFxuICAgICAgICBKb29zZS5BLmVhY2goYXJndW1lbnRzLCBmdW5jdGlvbiAoYXJnKSB7XG4gICAgICAgICAgICB0aGlzLmNvbXBvc2VkRnJvbS5wdXNoKGFyZylcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdmFyIHByb3BTZXQgPSBhcmcgaW5zdGFuY2VvZiBKb29zZS5NYW5hZ2VkLlByb3BlcnR5U2V0ID8gYXJnIDogYXJnLnByb3BlcnR5U2V0XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICBwcm9wU2V0LmRlcml2YXRpdmVzW3RoaXMuSURdID0gdGhpc1xuICAgICAgICB9LCB0aGlzKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgcmVtb3ZlQ29tcG9zZUluZm8gOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHRoaXMuZW5zdXJlT3BlbigpXG4gICAgICAgIFxuICAgICAgICBKb29zZS5BLmVhY2goYXJndW1lbnRzLCBmdW5jdGlvbiAoYXJnKSB7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciBpID0gMFxuICAgICAgICAgICAgXG4gICAgICAgICAgICB3aGlsZSAoaSA8IHRoaXMuY29tcG9zZWRGcm9tLmxlbmd0aCkge1xuICAgICAgICAgICAgICAgIHZhciBwcm9wU2V0ID0gdGhpcy5jb21wb3NlZEZyb21baV1cbiAgICAgICAgICAgICAgICBwcm9wU2V0ID0gcHJvcFNldCBpbnN0YW5jZW9mIEpvb3NlLk1hbmFnZWQuUHJvcGVydHlTZXQgPyBwcm9wU2V0IDogcHJvcFNldC5wcm9wZXJ0eVNldFxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIGlmIChhcmcgPT0gcHJvcFNldCkge1xuICAgICAgICAgICAgICAgICAgICBkZWxldGUgcHJvcFNldC5kZXJpdmF0aXZlc1t0aGlzLklEXVxuICAgICAgICAgICAgICAgICAgICB0aGlzLmNvbXBvc2VkRnJvbS5zcGxpY2UoaSwgMSlcbiAgICAgICAgICAgICAgICB9IGVsc2UgaSsrXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBcbiAgICAgICAgfSwgdGhpcylcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGVuc3VyZU9wZW4gOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIGlmICghdGhpcy5vcGVuZWQpIHRocm93IFwiTXV0YXRpb24gb2YgY2xvc2VkIHByb3BlcnR5IHNldDogW1wiICsgdGhpcy5uYW1lICsgXCJdXCJcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGFkZFByb3BlcnR5IDogZnVuY3Rpb24gKG5hbWUsIHByb3BzKSB7XG4gICAgICAgIHRoaXMuZW5zdXJlT3BlbigpXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eVNldC5NdXRhYmxlLnN1cGVyQ2xhc3MuYWRkUHJvcGVydHkuY2FsbCh0aGlzLCBuYW1lLCBwcm9wcylcbiAgICB9LFxuICAgIFxuXG4gICAgYWRkUHJvcGVydHlPYmplY3QgOiBmdW5jdGlvbiAob2JqZWN0KSB7XG4gICAgICAgIHRoaXMuZW5zdXJlT3BlbigpXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eVNldC5NdXRhYmxlLnN1cGVyQ2xhc3MuYWRkUHJvcGVydHlPYmplY3QuY2FsbCh0aGlzLCBvYmplY3QpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICByZW1vdmVQcm9wZXJ0eSA6IGZ1bmN0aW9uIChuYW1lKSB7XG4gICAgICAgIHRoaXMuZW5zdXJlT3BlbigpXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eVNldC5NdXRhYmxlLnN1cGVyQ2xhc3MucmVtb3ZlUHJvcGVydHkuY2FsbCh0aGlzLCBuYW1lKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgY29tcG9zZUZyb20gOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHRoaXMuZW5zdXJlT3BlbigpXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eVNldC5NdXRhYmxlLnN1cGVyQ2xhc3MuY29tcG9zZUZyb20uYXBwbHkodGhpcywgdGhpcy5jb21wb3NlZEZyb20pXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBvcGVuIDogZnVuY3Rpb24gKCkge1xuICAgICAgICB0aGlzLm9wZW5lZCsrXG4gICAgICAgIFxuICAgICAgICBpZiAodGhpcy5vcGVuZWQgPT0gMSkge1xuICAgICAgICBcbiAgICAgICAgICAgIEpvb3NlLk8uZWFjaCh0aGlzLmRlcml2YXRpdmVzLCBmdW5jdGlvbiAocHJvcFNldCkge1xuICAgICAgICAgICAgICAgIHByb3BTZXQub3BlbigpXG4gICAgICAgICAgICB9KVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLmRlQ29tcG9zZSgpXG4gICAgICAgIH1cbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGNsb3NlIDogZnVuY3Rpb24gKCkge1xuICAgICAgICBpZiAoIXRoaXMub3BlbmVkKSB0aHJvdyBcIlVubWF0Y2hlZCAnY2xvc2UnIG9wZXJhdGlvbiBvbiBwcm9wZXJ0eSBzZXQ6IFtcIiArIHRoaXMubmFtZSArIFwiXVwiXG4gICAgICAgIFxuICAgICAgICBpZiAodGhpcy5vcGVuZWQgPT0gMSkge1xuICAgICAgICAgICAgdGhpcy5yZUNvbXBvc2UoKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBKb29zZS5PLmVhY2godGhpcy5kZXJpdmF0aXZlcywgZnVuY3Rpb24gKHByb3BTZXQpIHtcbiAgICAgICAgICAgICAgICBwcm9wU2V0LmNsb3NlKClcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5vcGVuZWQtLVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgcmVDb21wb3NlIDogZnVuY3Rpb24gKCkge1xuICAgICAgICB0aGlzLmNvbXBvc2VGcm9tKClcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGRlQ29tcG9zZSA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgdGhpcy5lYWNoT3duKGZ1bmN0aW9uIChwcm9wZXJ0eSwgbmFtZSkge1xuICAgICAgICAgICAgaWYgKHByb3BlcnR5LmRlZmluZWRJbiAhPSB0aGlzKSB0aGlzLnJlbW92ZVByb3BlcnR5KG5hbWUpXG4gICAgICAgIH0sIHRoaXMpXG4gICAgfVxuICAgIFxufSkuYztcbkpvb3NlLk1hbmFnZWQuU3RlbUVsZW1lbnQgPSBmdW5jdGlvbiAoKSB7IHRocm93IFwiTW9kdWxlcyBtYXkgbm90IGJlIGluc3RhbnRpYXRlZC5cIiB9XG5cbkpvb3NlLk1hbmFnZWQuU3RlbUVsZW1lbnQuQXR0cmlidXRlcyA9IG5ldyBKb29zZS5Qcm90by5DbGFzcygnSm9vc2UuTWFuYWdlZC5TdGVtRWxlbWVudC5BdHRyaWJ1dGVzJywge1xuICAgIFxuICAgIGlzYSAgICAgICAgICAgICAgICAgICAgIDogSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eVNldC5NdXRhYmxlLFxuICAgIFxuICAgIHByb3BlcnR5TWV0YUNsYXNzICAgICAgIDogSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5BdHRyaWJ1dGVcbiAgICBcbn0pLmNcbjtcbkpvb3NlLk1hbmFnZWQuU3RlbUVsZW1lbnQuTWV0aG9kcyA9IG5ldyBKb29zZS5Qcm90by5DbGFzcygnSm9vc2UuTWFuYWdlZC5TdGVtRWxlbWVudC5NZXRob2RzJywge1xuICAgIFxuICAgIGlzYSA6IEpvb3NlLk1hbmFnZWQuUHJvcGVydHlTZXQuTXV0YWJsZSxcbiAgICBcbiAgICBwcm9wZXJ0eU1ldGFDbGFzcyA6IEpvb3NlLk1hbmFnZWQuUHJvcGVydHkuTWV0aG9kTW9kaWZpZXIuUHV0LFxuXG4gICAgXG4gICAgcHJlQXBwbHkgOiBmdW5jdGlvbiAoKSB7XG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBwb3N0VW5BcHBseSA6IGZ1bmN0aW9uICgpIHtcbiAgICB9XG4gICAgXG59KS5jO1xuSm9vc2UuTWFuYWdlZC5TdGVtRWxlbWVudC5SZXF1aXJlbWVudHMgPSBuZXcgSm9vc2UuUHJvdG8uQ2xhc3MoJ0pvb3NlLk1hbmFnZWQuU3RlbUVsZW1lbnQuUmVxdWlyZW1lbnRzJywge1xuXG4gICAgaXNhICAgICAgICAgICAgICAgICAgICAgOiBKb29zZS5NYW5hZ2VkLlByb3BlcnR5U2V0Lk11dGFibGUsXG4gICAgXG4gICAgcHJvcGVydHlNZXRhQ2xhc3MgICAgICAgOiBKb29zZS5NYW5hZ2VkLlByb3BlcnR5LlJlcXVpcmVtZW50LFxuICAgIFxuICAgIFxuICAgIFxuICAgIGFsaWFzIDogZnVuY3Rpb24gKCkge1xuICAgIH0sXG4gICAgXG4gICAgXG4gICAgZXhjbHVkZSA6IGZ1bmN0aW9uICgpIHtcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGZsYXR0ZW5UbyA6IGZ1bmN0aW9uICh0YXJnZXQpIHtcbiAgICAgICAgdGhpcy5lYWNoKGZ1bmN0aW9uIChwcm9wZXJ0eSwgbmFtZSkge1xuICAgICAgICAgICAgaWYgKCF0YXJnZXQuaGF2ZVByb3BlcnR5KG5hbWUpKSB0YXJnZXQuYWRkUHJvcGVydHlPYmplY3QocHJvcGVydHkpXG4gICAgICAgIH0pXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBjb21wb3NlVG8gOiBmdW5jdGlvbiAodGFyZ2V0KSB7XG4gICAgICAgIHRoaXMuZmxhdHRlblRvKHRhcmdldClcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIHByZUFwcGx5IDogZnVuY3Rpb24gKCkge1xuICAgIH0sXG4gICAgXG4gICAgXG4gICAgcG9zdFVuQXBwbHkgOiBmdW5jdGlvbiAoKSB7XG4gICAgfVxuICAgIFxufSkuYztcbkpvb3NlLk1hbmFnZWQuU3RlbUVsZW1lbnQuTWV0aG9kTW9kaWZpZXJzID0gbmV3IEpvb3NlLlByb3RvLkNsYXNzKCdKb29zZS5NYW5hZ2VkLlN0ZW1FbGVtZW50Lk1ldGhvZE1vZGlmaWVycycsIHtcblxuICAgIGlzYSAgICAgICAgICAgICAgICAgICAgIDogSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eVNldC5NdXRhYmxlLFxuICAgIFxuICAgIHByb3BlcnR5TWV0YUNsYXNzICAgICAgIDogbnVsbCxcbiAgICBcbiAgICBcbiAgICBhZGRQcm9wZXJ0eSA6IGZ1bmN0aW9uIChuYW1lLCBwcm9wcykge1xuICAgICAgICB2YXIgbWV0YUNsYXNzID0gcHJvcHMubWV0YVxuICAgICAgICBkZWxldGUgcHJvcHMubWV0YVxuICAgICAgICBcbiAgICAgICAgcHJvcHMuZGVmaW5lZEluICAgICAgICAgPSB0aGlzXG4gICAgICAgIHByb3BzLm5hbWUgICAgICAgICAgICAgID0gbmFtZVxuICAgICAgICBcbiAgICAgICAgdmFyIG1vZGlmaWVyICAgICAgICAgICAgPSBuZXcgbWV0YUNsYXNzKHByb3BzKVxuICAgICAgICB2YXIgcHJvcGVydGllcyAgICAgICAgICA9IHRoaXMucHJvcGVydGllc1xuICAgICAgICBcbiAgICAgICAgaWYgKCFwcm9wZXJ0aWVzW25hbWVdKSBwcm9wZXJ0aWVzWyBuYW1lIF0gPSBbXVxuICAgICAgICBcbiAgICAgICAgcHJvcGVydGllc1tuYW1lXS5wdXNoKG1vZGlmaWVyKVxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIG1vZGlmaWVyXG4gICAgfSxcbiAgICBcblxuICAgIGFkZFByb3BlcnR5T2JqZWN0IDogZnVuY3Rpb24gKG9iamVjdCkge1xuICAgICAgICB2YXIgbmFtZSAgICAgICAgICAgID0gb2JqZWN0Lm5hbWVcbiAgICAgICAgdmFyIHByb3BlcnRpZXMgICAgICA9IHRoaXMucHJvcGVydGllc1xuICAgICAgICBcbiAgICAgICAgaWYgKCFwcm9wZXJ0aWVzW25hbWVdKSBwcm9wZXJ0aWVzW25hbWVdID0gW11cbiAgICAgICAgXG4gICAgICAgIHByb3BlcnRpZXNbbmFtZV0ucHVzaChvYmplY3QpXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gb2JqZWN0XG4gICAgfSxcbiAgICBcbiAgICBcbiAgICAvL3JlbW92ZSBvbmx5IHRoZSBsYXN0IG1vZGlmaWVyXG4gICAgcmVtb3ZlUHJvcGVydHkgOiBmdW5jdGlvbiAobmFtZSkge1xuICAgICAgICBpZiAoIXRoaXMuaGF2ZVByb3BlcnR5KG5hbWUpKSByZXR1cm4gdW5kZWZpbmVkXG4gICAgICAgIFxuICAgICAgICB2YXIgcHJvcGVydGllcyAgICAgID0gdGhpcy5wcm9wZXJ0aWVzXG4gICAgICAgIHZhciBtb2RpZmllciAgICAgICAgPSBwcm9wZXJ0aWVzWyBuYW1lIF0ucG9wKClcbiAgICAgICAgXG4gICAgICAgIC8vaWYgYWxsIG1vZGlmaWVycyB3ZXJlIHJlbW92ZWQgLSBjbGVhcmluZyB0aGUgcHJvcGVydGllc1xuICAgICAgICBpZiAoIXByb3BlcnRpZXNbbmFtZV0ubGVuZ3RoKSBKb29zZS5NYW5hZ2VkLlN0ZW1FbGVtZW50Lk1ldGhvZE1vZGlmaWVycy5zdXBlckNsYXNzLnJlbW92ZVByb3BlcnR5LmNhbGwodGhpcywgbmFtZSlcbiAgICAgICAgXG4gICAgICAgIHJldHVybiBtb2RpZmllclxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgYWxpYXMgOiBmdW5jdGlvbiAoKSB7XG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBleGNsdWRlIDogZnVuY3Rpb24gKCkge1xuICAgIH0sXG4gICAgXG4gICAgXG4gICAgZmxhdHRlblRvIDogZnVuY3Rpb24gKHRhcmdldCkge1xuICAgICAgICB2YXIgdGFyZ2V0UHJvcHMgPSB0YXJnZXQucHJvcGVydGllc1xuICAgICAgICBcbiAgICAgICAgdGhpcy5lYWNoKGZ1bmN0aW9uIChtb2RpZmllcnNBcnIsIG5hbWUpIHtcbiAgICAgICAgICAgIHZhciB0YXJnZXRNb2RpZmllcnNBcnIgPSB0YXJnZXRQcm9wc1tuYW1lXVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAodGFyZ2V0TW9kaWZpZXJzQXJyID09IG51bGwpIHRhcmdldE1vZGlmaWVyc0FyciA9IHRhcmdldFByb3BzW25hbWVdID0gW11cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgSm9vc2UuQS5lYWNoKG1vZGlmaWVyc0FyciwgZnVuY3Rpb24gKG1vZGlmaWVyKSB7XG4gICAgICAgICAgICAgICAgaWYgKCFKb29zZS5BLmV4aXN0cyh0YXJnZXRNb2RpZmllcnNBcnIsIG1vZGlmaWVyKSkgdGFyZ2V0TW9kaWZpZXJzQXJyLnB1c2gobW9kaWZpZXIpXG4gICAgICAgICAgICB9KVxuICAgICAgICAgICAgXG4gICAgICAgIH0pXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBjb21wb3NlVG8gOiBmdW5jdGlvbiAodGFyZ2V0KSB7XG4gICAgICAgIHRoaXMuZmxhdHRlblRvKHRhcmdldClcbiAgICB9LFxuXG4gICAgXG4gICAgZGVDb21wb3NlIDogZnVuY3Rpb24gKCkge1xuICAgICAgICB0aGlzLmVhY2goZnVuY3Rpb24gKG1vZGlmaWVyc0FyciwgbmFtZSkge1xuICAgICAgICAgICAgdmFyIGkgPSAwXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHdoaWxlIChpIDwgbW9kaWZpZXJzQXJyLmxlbmd0aCkgXG4gICAgICAgICAgICAgICAgaWYgKG1vZGlmaWVyc0FycltpXS5kZWZpbmVkSW4gIT0gdGhpcykgXG4gICAgICAgICAgICAgICAgICAgIG1vZGlmaWVyc0Fyci5zcGxpY2UoaSwgMSlcbiAgICAgICAgICAgICAgICBlbHNlIFxuICAgICAgICAgICAgICAgICAgICBpKytcbiAgICAgICAgfSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIHByZUFwcGx5IDogZnVuY3Rpb24gKHRhcmdldCkge1xuICAgIH0sXG5cbiAgICBcbiAgICBwb3N0VW5BcHBseSA6IGZ1bmN0aW9uICh0YXJnZXQpIHtcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGFwcGx5IDogZnVuY3Rpb24gKHRhcmdldCkge1xuICAgICAgICB0aGlzLmVhY2goZnVuY3Rpb24gKG1vZGlmaWVyc0FyciwgbmFtZSkge1xuICAgICAgICAgICAgSm9vc2UuQS5lYWNoKG1vZGlmaWVyc0FyciwgZnVuY3Rpb24gKG1vZGlmaWVyKSB7XG4gICAgICAgICAgICAgICAgbW9kaWZpZXIuYXBwbHkodGFyZ2V0KVxuICAgICAgICAgICAgfSlcbiAgICAgICAgfSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIHVuYXBwbHkgOiBmdW5jdGlvbiAoZnJvbSkge1xuICAgICAgICB0aGlzLmVhY2goZnVuY3Rpb24gKG1vZGlmaWVyc0FyciwgbmFtZSkge1xuICAgICAgICAgICAgZm9yICh2YXIgaSA9IG1vZGlmaWVyc0Fyci5sZW5ndGggLSAxOyBpID49MCA7IGktLSkgbW9kaWZpZXJzQXJyW2ldLnVuYXBwbHkoZnJvbSlcbiAgICAgICAgfSlcbiAgICB9XG4gICAgXG4gICAgXG4gICAgXG59KS5jO1xuSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eVNldC5Db21wb3NpdGlvbiA9IG5ldyBKb29zZS5Qcm90by5DbGFzcygnSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eVNldC5Db21wb3NpdGlvbicsIHtcbiAgICBcbiAgICBpc2EgICAgICAgICAgICAgICAgICAgICAgICAgOiBKb29zZS5NYW5hZ2VkLlByb3BlcnR5U2V0Lk11dGFibGUsXG4gICAgXG4gICAgcHJvcGVydHlNZXRhQ2xhc3MgICAgICAgICAgIDogSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eVNldC5NdXRhYmxlLFxuICAgIFxuICAgIHByb2Nlc3NPcmRlciAgICAgICAgICAgICAgICA6IG51bGwsXG5cbiAgICBcbiAgICBlYWNoIDogZnVuY3Rpb24gKGZ1bmMsIHNjb3BlKSB7XG4gICAgICAgIHZhciBwcm9wcyAgID0gdGhpcy5wcm9wZXJ0aWVzXG4gICAgICAgIHZhciBzY29wZSAgID0gc2NvcGUgfHwgdGhpc1xuICAgICAgICBcbiAgICAgICAgSm9vc2UuQS5lYWNoKHRoaXMucHJvY2Vzc09yZGVyLCBmdW5jdGlvbiAobmFtZSkge1xuICAgICAgICAgICAgZnVuYy5jYWxsKHNjb3BlLCBwcm9wc1tuYW1lXSwgbmFtZSlcbiAgICAgICAgfSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGVhY2hSIDogZnVuY3Rpb24gKGZ1bmMsIHNjb3BlKSB7XG4gICAgICAgIHZhciBwcm9wcyAgID0gdGhpcy5wcm9wZXJ0aWVzXG4gICAgICAgIHZhciBzY29wZSAgID0gc2NvcGUgfHwgdGhpc1xuICAgICAgICBcbiAgICAgICAgSm9vc2UuQS5lYWNoUih0aGlzLnByb2Nlc3NPcmRlciwgZnVuY3Rpb24gKG5hbWUpIHtcbiAgICAgICAgICAgIGZ1bmMuY2FsbChzY29wZSwgcHJvcHNbbmFtZV0sIG5hbWUpXG4gICAgICAgIH0pXG4gICAgICAgIFxuICAgICAgICBcbi8vICAgICAgICB2YXIgcHJvcHMgICAgICAgICAgID0gdGhpcy5wcm9wZXJ0aWVzXG4vLyAgICAgICAgdmFyIHByb2Nlc3NPcmRlciAgICA9IHRoaXMucHJvY2Vzc09yZGVyXG4vLyAgICAgICAgXG4vLyAgICAgICAgZm9yKHZhciBpID0gcHJvY2Vzc09yZGVyLmxlbmd0aCAtIDE7IGkgPj0gMDsgaS0tKSBcbi8vICAgICAgICAgICAgZnVuYy5jYWxsKHNjb3BlIHx8IHRoaXMsIHByb3BzWyBwcm9jZXNzT3JkZXJbaV0gXSwgcHJvY2Vzc09yZGVyW2ldKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgY2xvbmUgOiBmdW5jdGlvbiAobmFtZSkge1xuICAgICAgICB2YXIgY2xvbmUgPSB0aGlzLmNsZWFuQ2xvbmUobmFtZSlcbiAgICAgICAgXG4gICAgICAgIHRoaXMuZWFjaChmdW5jdGlvbiAocHJvcGVydHkpIHtcbiAgICAgICAgICAgIGNsb25lLmFkZFByb3BlcnR5T2JqZWN0KHByb3BlcnR5LmNsb25lKCkpXG4gICAgICAgIH0pXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gY2xvbmVcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGFsaWFzIDogZnVuY3Rpb24gKHdoYXQpIHtcbiAgICAgICAgdGhpcy5lYWNoKGZ1bmN0aW9uIChwcm9wZXJ0eSkge1xuICAgICAgICAgICAgcHJvcGVydHkuYWxpYXMod2hhdClcbiAgICAgICAgfSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGV4Y2x1ZGUgOiBmdW5jdGlvbiAod2hhdCkge1xuICAgICAgICB0aGlzLmVhY2goZnVuY3Rpb24gKHByb3BlcnR5KSB7XG4gICAgICAgICAgICBwcm9wZXJ0eS5leGNsdWRlKHdoYXQpXG4gICAgICAgIH0pXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBmbGF0dGVuVG8gOiBmdW5jdGlvbiAodGFyZ2V0KSB7XG4gICAgICAgIHZhciB0YXJnZXRQcm9wcyA9IHRhcmdldC5wcm9wZXJ0aWVzXG4gICAgICAgIFxuICAgICAgICB0aGlzLmVhY2goZnVuY3Rpb24gKHByb3BlcnR5LCBuYW1lKSB7XG4gICAgICAgICAgICB2YXIgc3ViVGFyZ2V0ID0gdGFyZ2V0UHJvcHNbbmFtZV0gfHwgdGFyZ2V0LmFkZFByb3BlcnR5KG5hbWUsIHtcbiAgICAgICAgICAgICAgICBtZXRhIDogcHJvcGVydHkuY29uc3RydWN0b3JcbiAgICAgICAgICAgIH0pXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHByb3BlcnR5LmZsYXR0ZW5UbyhzdWJUYXJnZXQpXG4gICAgICAgIH0pXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBjb21wb3NlVG8gOiBmdW5jdGlvbiAodGFyZ2V0KSB7XG4gICAgICAgIHZhciB0YXJnZXRQcm9wcyA9IHRhcmdldC5wcm9wZXJ0aWVzXG4gICAgICAgIFxuICAgICAgICB0aGlzLmVhY2goZnVuY3Rpb24gKHByb3BlcnR5LCBuYW1lKSB7XG4gICAgICAgICAgICB2YXIgc3ViVGFyZ2V0ID0gdGFyZ2V0UHJvcHNbbmFtZV0gfHwgdGFyZ2V0LmFkZFByb3BlcnR5KG5hbWUsIHtcbiAgICAgICAgICAgICAgICBtZXRhIDogcHJvcGVydHkuY29uc3RydWN0b3JcbiAgICAgICAgICAgIH0pXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHByb3BlcnR5LmNvbXBvc2VUbyhzdWJUYXJnZXQpXG4gICAgICAgIH0pXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBcbiAgICBkZUNvbXBvc2UgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHRoaXMuZWFjaFIoZnVuY3Rpb24gKHByb3BlcnR5KSB7XG4gICAgICAgICAgICBwcm9wZXJ0eS5vcGVuKClcbiAgICAgICAgfSlcbiAgICAgICAgXG4gICAgICAgIEpvb3NlLk1hbmFnZWQuUHJvcGVydHlTZXQuQ29tcG9zaXRpb24uc3VwZXJDbGFzcy5kZUNvbXBvc2UuY2FsbCh0aGlzKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgcmVDb21wb3NlIDogZnVuY3Rpb24gKCkge1xuICAgICAgICBKb29zZS5NYW5hZ2VkLlByb3BlcnR5U2V0LkNvbXBvc2l0aW9uLnN1cGVyQ2xhc3MucmVDb21wb3NlLmNhbGwodGhpcylcbiAgICAgICAgXG4gICAgICAgIHRoaXMuZWFjaChmdW5jdGlvbiAocHJvcGVydHkpIHtcbiAgICAgICAgICAgIHByb3BlcnR5LmNsb3NlKClcbiAgICAgICAgfSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIHVuYXBwbHkgOiBmdW5jdGlvbiAoZnJvbSkge1xuICAgICAgICB0aGlzLmVhY2hSKGZ1bmN0aW9uIChwcm9wZXJ0eSkge1xuICAgICAgICAgICAgcHJvcGVydHkudW5hcHBseShmcm9tKVxuICAgICAgICB9KVxuICAgIH1cbiAgICBcbn0pLmNcbjtcbkpvb3NlLk1hbmFnZWQuU3RlbSA9IG5ldyBKb29zZS5Qcm90by5DbGFzcygnSm9vc2UuTWFuYWdlZC5TdGVtJywge1xuICAgIFxuICAgIGlzYSAgICAgICAgICAgICAgICAgIDogSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eVNldC5Db21wb3NpdGlvbixcbiAgICBcbiAgICB0YXJnZXRNZXRhICAgICAgICAgICA6IG51bGwsXG4gICAgXG4gICAgYXR0cmlidXRlc01DICAgICAgICAgOiBKb29zZS5NYW5hZ2VkLlN0ZW1FbGVtZW50LkF0dHJpYnV0ZXMsXG4gICAgbWV0aG9kc01DICAgICAgICAgICAgOiBKb29zZS5NYW5hZ2VkLlN0ZW1FbGVtZW50Lk1ldGhvZHMsXG4gICAgcmVxdWlyZW1lbnRzTUMgICAgICAgOiBKb29zZS5NYW5hZ2VkLlN0ZW1FbGVtZW50LlJlcXVpcmVtZW50cyxcbiAgICBtZXRob2RzTW9kaWZpZXJzTUMgICA6IEpvb3NlLk1hbmFnZWQuU3RlbUVsZW1lbnQuTWV0aG9kTW9kaWZpZXJzLFxuICAgIFxuICAgIHByb2Nlc3NPcmRlciAgICAgICAgIDogWyAnYXR0cmlidXRlcycsICdtZXRob2RzJywgJ3JlcXVpcmVtZW50cycsICdtZXRob2RzTW9kaWZpZXJzJyBdLFxuICAgIFxuICAgIFxuICAgIGluaXRpYWxpemUgOiBmdW5jdGlvbiAocHJvcHMpIHtcbiAgICAgICAgSm9vc2UuTWFuYWdlZC5TdGVtLnN1cGVyQ2xhc3MuaW5pdGlhbGl6ZS5jYWxsKHRoaXMsIHByb3BzKVxuICAgICAgICBcbiAgICAgICAgdmFyIHRhcmdldE1ldGEgPSB0aGlzLnRhcmdldE1ldGFcbiAgICAgICAgXG4gICAgICAgIHRoaXMuYWRkUHJvcGVydHkoJ2F0dHJpYnV0ZXMnLCB7XG4gICAgICAgICAgICBtZXRhIDogdGhpcy5hdHRyaWJ1dGVzTUMsXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vaXQgY2FuIGJlIG5vICd0YXJnZXRNZXRhJyBpbiBjbG9uZXNcbiAgICAgICAgICAgIHByb3BlcnRpZXMgOiB0YXJnZXRNZXRhID8gdGFyZ2V0TWV0YS5hdHRyaWJ1dGVzIDoge31cbiAgICAgICAgfSlcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICB0aGlzLmFkZFByb3BlcnR5KCdtZXRob2RzJywge1xuICAgICAgICAgICAgbWV0YSA6IHRoaXMubWV0aG9kc01DLFxuICAgICAgICAgICAgXG4gICAgICAgICAgICBwcm9wZXJ0aWVzIDogdGFyZ2V0TWV0YSA/IHRhcmdldE1ldGEubWV0aG9kcyA6IHt9XG4gICAgICAgIH0pXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgdGhpcy5hZGRQcm9wZXJ0eSgncmVxdWlyZW1lbnRzJywge1xuICAgICAgICAgICAgbWV0YSA6IHRoaXMucmVxdWlyZW1lbnRzTUNcbiAgICAgICAgfSlcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICB0aGlzLmFkZFByb3BlcnR5KCdtZXRob2RzTW9kaWZpZXJzJywge1xuICAgICAgICAgICAgbWV0YSA6IHRoaXMubWV0aG9kc01vZGlmaWVyc01DXG4gICAgICAgIH0pXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICByZUNvbXBvc2UgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHZhciBjICAgICAgID0gdGhpcy50YXJnZXRNZXRhLmNcbiAgICAgICAgXG4gICAgICAgIHRoaXMucHJlQXBwbHkoYylcbiAgICAgICAgXG4gICAgICAgIEpvb3NlLk1hbmFnZWQuU3RlbS5zdXBlckNsYXNzLnJlQ29tcG9zZS5jYWxsKHRoaXMpXG4gICAgICAgIFxuICAgICAgICB0aGlzLmFwcGx5KGMpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBkZUNvbXBvc2UgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHZhciBjICAgICAgID0gdGhpcy50YXJnZXRNZXRhLmNcbiAgICAgICAgXG4gICAgICAgIHRoaXMudW5hcHBseShjKVxuICAgICAgICBcbiAgICAgICAgSm9vc2UuTWFuYWdlZC5TdGVtLnN1cGVyQ2xhc3MuZGVDb21wb3NlLmNhbGwodGhpcylcbiAgICAgICAgXG4gICAgICAgIHRoaXMucG9zdFVuQXBwbHkoYylcbiAgICB9XG4gICAgXG4gICAgXG59KS5jXG47XG5Kb29zZS5NYW5hZ2VkLkJ1aWxkZXIgPSBuZXcgSm9vc2UuUHJvdG8uQ2xhc3MoJ0pvb3NlLk1hbmFnZWQuQnVpbGRlcicsIHtcbiAgICBcbiAgICB0YXJnZXRNZXRhICAgICAgICAgIDogbnVsbCxcbiAgICBcbiAgICBcbiAgICBfYnVpbGRTdGFydCA6IGZ1bmN0aW9uICh0YXJnZXRNZXRhLCBwcm9wcykge1xuICAgICAgICB0YXJnZXRNZXRhLnN0ZW0ub3BlbigpXG4gICAgICAgIFxuICAgICAgICBKb29zZS5BLmVhY2goWyAndHJhaXQnLCAndHJhaXRzJywgJ3JlbW92ZVRyYWl0JywgJ3JlbW92ZVRyYWl0cycsICdkb2VzJywgJ2RvZXNub3QnLCAnZG9lc250JyBdLCBmdW5jdGlvbiAoYnVpbGRlcikge1xuICAgICAgICAgICAgaWYgKHByb3BzW2J1aWxkZXJdKSB7XG4gICAgICAgICAgICAgICAgdGhpc1tidWlsZGVyXSh0YXJnZXRNZXRhLCBwcm9wc1tidWlsZGVyXSlcbiAgICAgICAgICAgICAgICBkZWxldGUgcHJvcHNbYnVpbGRlcl1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfSwgdGhpcylcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIF9leHRlbmQgOiBmdW5jdGlvbiAocHJvcHMpIHtcbiAgICAgICAgaWYgKEpvb3NlLk8uaXNFbXB0eShwcm9wcykpIHJldHVyblxuICAgICAgICBcbiAgICAgICAgdmFyIHRhcmdldE1ldGEgPSB0aGlzLnRhcmdldE1ldGFcbiAgICAgICAgXG4gICAgICAgIHRoaXMuX2J1aWxkU3RhcnQodGFyZ2V0TWV0YSwgcHJvcHMpXG4gICAgICAgIFxuICAgICAgICBKb29zZS5PLmVhY2hPd24ocHJvcHMsIGZ1bmN0aW9uICh2YWx1ZSwgbmFtZSkge1xuICAgICAgICAgICAgdmFyIGhhbmRsZXIgPSB0aGlzW25hbWVdXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmICghaGFuZGxlcikgdGhyb3cgbmV3IEVycm9yKFwiVW5rbm93biBidWlsZGVyIFtcIiArIG5hbWUgKyBcIl0gd2FzIHVzZWQgZHVyaW5nIGV4dGVuZGluZyBvZiBbXCIgKyB0YXJnZXRNZXRhLmMgKyBcIl1cIilcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaGFuZGxlci5jYWxsKHRoaXMsIHRhcmdldE1ldGEsIHZhbHVlKVxuICAgICAgICB9LCB0aGlzKVxuICAgICAgICBcbiAgICAgICAgdGhpcy5fYnVpbGRDb21wbGV0ZSh0YXJnZXRNZXRhLCBwcm9wcylcbiAgICB9LFxuICAgIFxuXG4gICAgX2J1aWxkQ29tcGxldGUgOiBmdW5jdGlvbiAodGFyZ2V0TWV0YSwgcHJvcHMpIHtcbiAgICAgICAgdGFyZ2V0TWV0YS5zdGVtLmNsb3NlKClcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIG1ldGhvZHMgOiBmdW5jdGlvbiAodGFyZ2V0TWV0YSwgaW5mbykge1xuICAgICAgICBKb29zZS5PLmVhY2hPd24oaW5mbywgZnVuY3Rpb24gKHZhbHVlLCBuYW1lKSB7XG4gICAgICAgICAgICB0YXJnZXRNZXRhLmFkZE1ldGhvZChuYW1lLCB2YWx1ZSlcbiAgICAgICAgfSlcbiAgICB9LFxuICAgIFxuXG4gICAgcmVtb3ZlTWV0aG9kcyA6IGZ1bmN0aW9uICh0YXJnZXRNZXRhLCBpbmZvKSB7XG4gICAgICAgIEpvb3NlLkEuZWFjaChpbmZvLCBmdW5jdGlvbiAobmFtZSkge1xuICAgICAgICAgICAgdGFyZ2V0TWV0YS5yZW1vdmVNZXRob2QobmFtZSlcbiAgICAgICAgfSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGhhdmUgOiBmdW5jdGlvbiAodGFyZ2V0TWV0YSwgaW5mbykge1xuICAgICAgICBKb29zZS5PLmVhY2hPd24oaW5mbywgZnVuY3Rpb24gKHZhbHVlLCBuYW1lKSB7XG4gICAgICAgICAgICB0YXJnZXRNZXRhLmFkZEF0dHJpYnV0ZShuYW1lLCB2YWx1ZSlcbiAgICAgICAgfSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGhhdmVub3QgOiBmdW5jdGlvbiAodGFyZ2V0TWV0YSwgaW5mbykge1xuICAgICAgICBKb29zZS5BLmVhY2goaW5mbywgZnVuY3Rpb24gKG5hbWUpIHtcbiAgICAgICAgICAgIHRhcmdldE1ldGEucmVtb3ZlQXR0cmlidXRlKG5hbWUpXG4gICAgICAgIH0pXG4gICAgfSxcbiAgICBcblxuICAgIGhhdmVudCA6IGZ1bmN0aW9uICh0YXJnZXRNZXRhLCBpbmZvKSB7XG4gICAgICAgIHRoaXMuaGF2ZW5vdCh0YXJnZXRNZXRhLCBpbmZvKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgYWZ0ZXIgOiBmdW5jdGlvbiAodGFyZ2V0TWV0YSwgaW5mbykge1xuICAgICAgICBKb29zZS5PLmVhY2goaW5mbywgZnVuY3Rpb24gKHZhbHVlLCBuYW1lKSB7XG4gICAgICAgICAgICB0YXJnZXRNZXRhLmFkZE1ldGhvZE1vZGlmaWVyKG5hbWUsIHZhbHVlLCBKb29zZS5NYW5hZ2VkLlByb3BlcnR5Lk1ldGhvZE1vZGlmaWVyLkFmdGVyKVxuICAgICAgICB9KVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgYmVmb3JlIDogZnVuY3Rpb24gKHRhcmdldE1ldGEsIGluZm8pIHtcbiAgICAgICAgSm9vc2UuTy5lYWNoKGluZm8sIGZ1bmN0aW9uICh2YWx1ZSwgbmFtZSkge1xuICAgICAgICAgICAgdGFyZ2V0TWV0YS5hZGRNZXRob2RNb2RpZmllcihuYW1lLCB2YWx1ZSwgSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5NZXRob2RNb2RpZmllci5CZWZvcmUpXG4gICAgICAgIH0pXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBvdmVycmlkZSA6IGZ1bmN0aW9uICh0YXJnZXRNZXRhLCBpbmZvKSB7XG4gICAgICAgIEpvb3NlLk8uZWFjaChpbmZvLCBmdW5jdGlvbiAodmFsdWUsIG5hbWUpIHtcbiAgICAgICAgICAgIHRhcmdldE1ldGEuYWRkTWV0aG9kTW9kaWZpZXIobmFtZSwgdmFsdWUsIEpvb3NlLk1hbmFnZWQuUHJvcGVydHkuTWV0aG9kTW9kaWZpZXIuT3ZlcnJpZGUpXG4gICAgICAgIH0pXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBhcm91bmQgOiBmdW5jdGlvbiAodGFyZ2V0TWV0YSwgaW5mbykge1xuICAgICAgICBKb29zZS5PLmVhY2goaW5mbywgZnVuY3Rpb24gKHZhbHVlLCBuYW1lKSB7XG4gICAgICAgICAgICB0YXJnZXRNZXRhLmFkZE1ldGhvZE1vZGlmaWVyKG5hbWUsIHZhbHVlLCBKb29zZS5NYW5hZ2VkLlByb3BlcnR5Lk1ldGhvZE1vZGlmaWVyLkFyb3VuZClcbiAgICAgICAgfSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGF1Z21lbnQgOiBmdW5jdGlvbiAodGFyZ2V0TWV0YSwgaW5mbykge1xuICAgICAgICBKb29zZS5PLmVhY2goaW5mbywgZnVuY3Rpb24gKHZhbHVlLCBuYW1lKSB7XG4gICAgICAgICAgICB0YXJnZXRNZXRhLmFkZE1ldGhvZE1vZGlmaWVyKG5hbWUsIHZhbHVlLCBKb29zZS5NYW5hZ2VkLlByb3BlcnR5Lk1ldGhvZE1vZGlmaWVyLkF1Z21lbnQpXG4gICAgICAgIH0pXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICByZW1vdmVNb2RpZmllciA6IGZ1bmN0aW9uICh0YXJnZXRNZXRhLCBpbmZvKSB7XG4gICAgICAgIEpvb3NlLkEuZWFjaChpbmZvLCBmdW5jdGlvbiAobmFtZSkge1xuICAgICAgICAgICAgdGFyZ2V0TWV0YS5yZW1vdmVNZXRob2RNb2RpZmllcihuYW1lKVxuICAgICAgICB9KVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgZG9lcyA6IGZ1bmN0aW9uICh0YXJnZXRNZXRhLCBpbmZvKSB7XG4gICAgICAgIEpvb3NlLkEuZWFjaChKb29zZS5PLndhbnRBcnJheShpbmZvKSwgZnVuY3Rpb24gKGRlc2MpIHtcbiAgICAgICAgICAgIHRhcmdldE1ldGEuYWRkUm9sZShkZXNjKVxuICAgICAgICB9KVxuICAgIH0sXG4gICAgXG5cbiAgICBkb2Vzbm90IDogZnVuY3Rpb24gKHRhcmdldE1ldGEsIGluZm8pIHtcbiAgICAgICAgSm9vc2UuQS5lYWNoKEpvb3NlLk8ud2FudEFycmF5KGluZm8pLCBmdW5jdGlvbiAoZGVzYykge1xuICAgICAgICAgICAgdGFyZ2V0TWV0YS5yZW1vdmVSb2xlKGRlc2MpXG4gICAgICAgIH0pXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBkb2VzbnQgOiBmdW5jdGlvbiAodGFyZ2V0TWV0YSwgaW5mbykge1xuICAgICAgICB0aGlzLmRvZXNub3QodGFyZ2V0TWV0YSwgaW5mbylcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIHRyYWl0IDogZnVuY3Rpb24gKCkge1xuICAgICAgICB0aGlzLnRyYWl0cy5hcHBseSh0aGlzLCBhcmd1bWVudHMpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICB0cmFpdHMgOiBmdW5jdGlvbiAodGFyZ2V0TWV0YSwgaW5mbykge1xuICAgICAgICBpZiAodGFyZ2V0TWV0YS5maXJzdFBhc3MpIHJldHVyblxuICAgICAgICBcbiAgICAgICAgaWYgKCF0YXJnZXRNZXRhLm1ldGEuaXNEZXRhY2hlZCkgdGhyb3cgXCJDYW4ndCBhcHBseSB0cmFpdCB0byBub3QgZGV0YWNoZWQgY2xhc3NcIlxuICAgICAgICBcbiAgICAgICAgdGFyZ2V0TWV0YS5tZXRhLmV4dGVuZCh7XG4gICAgICAgICAgICBkb2VzIDogaW5mb1xuICAgICAgICB9KVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgcmVtb3ZlVHJhaXQgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHRoaXMucmVtb3ZlVHJhaXRzLmFwcGx5KHRoaXMsIGFyZ3VtZW50cylcbiAgICB9LFxuICAgICBcbiAgICBcbiAgICByZW1vdmVUcmFpdHMgOiBmdW5jdGlvbiAodGFyZ2V0TWV0YSwgaW5mbykge1xuICAgICAgICBpZiAoIXRhcmdldE1ldGEubWV0YS5pc0RldGFjaGVkKSB0aHJvdyBcIkNhbid0IHJlbW92ZSB0cmFpdCBmcm9tIG5vdCBkZXRhY2hlZCBjbGFzc1wiXG4gICAgICAgIFxuICAgICAgICB0YXJnZXRNZXRhLm1ldGEuZXh0ZW5kKHtcbiAgICAgICAgICAgIGRvZXNub3QgOiBpbmZvXG4gICAgICAgIH0pXG4gICAgfVxuICAgIFxuICAgIFxuICAgIFxufSkuYztcbkpvb3NlLk1hbmFnZWQuQ2xhc3MgPSBuZXcgSm9vc2UuUHJvdG8uQ2xhc3MoJ0pvb3NlLk1hbmFnZWQuQ2xhc3MnLCB7XG4gICAgXG4gICAgaXNhICAgICAgICAgICAgICAgICAgICAgICAgIDogSm9vc2UuUHJvdG8uQ2xhc3MsXG4gICAgXG4gICAgc3RlbSAgICAgICAgICAgICAgICAgICAgICAgIDogbnVsbCxcbiAgICBzdGVtQ2xhc3MgICAgICAgICAgICAgICAgICAgOiBKb29zZS5NYW5hZ2VkLlN0ZW0sXG4gICAgc3RlbUNsYXNzQ3JlYXRlZCAgICAgICAgICAgIDogZmFsc2UsXG4gICAgXG4gICAgYnVpbGRlciAgICAgICAgICAgICAgICAgICAgIDogbnVsbCxcbiAgICBidWlsZGVyQ2xhc3MgICAgICAgICAgICAgICAgOiBKb29zZS5NYW5hZ2VkLkJ1aWxkZXIsXG4gICAgYnVpbGRlckNsYXNzQ3JlYXRlZCAgICAgICAgIDogZmFsc2UsXG4gICAgXG4gICAgaXNEZXRhY2hlZCAgICAgICAgICAgICAgICAgIDogZmFsc2UsXG4gICAgZmlyc3RQYXNzICAgICAgICAgICAgICAgICAgIDogdHJ1ZSxcbiAgICBcbiAgICAvLyBhIHNwZWNpYWwgaW5zdGFuY2UsIHdoaWNoLCB3aGVuIHBhc3NlZCBhcyAxc3QgYXJndW1lbnQgdG8gY29uc3RydWN0b3IsIHNpZ25pZmllcyB0aGF0IGNvbnN0cnVjdG9yIHNob3VsZFxuICAgIC8vIHNraXBzIHRyYWl0cyBwcm9jZXNzaW5nIGZvciB0aGlzIGluc3RhbmNlXG4gICAgc2tpcFRyYWl0c0FuY2hvciAgICAgICAgICAgIDoge30sXG4gICAgXG4gICAgXG4gICAgLy9idWlsZCBmb3IgbWV0YWNsYXNzZXMgLSBjb2xsZWN0cyB0cmFpdHMgZnJvbSByb2xlc1xuICAgIEJVSUxEIDogZnVuY3Rpb24gKCkge1xuICAgICAgICB2YXIgc3VwID0gSm9vc2UuTWFuYWdlZC5DbGFzcy5zdXBlckNsYXNzLkJVSUxELmFwcGx5KHRoaXMsIGFyZ3VtZW50cylcbiAgICAgICAgXG4gICAgICAgIHZhciBwcm9wcyAgID0gc3VwLl9fZXh0ZW5kX19cbiAgICAgICAgXG4gICAgICAgIHZhciB0cmFpdHMgPSBKb29zZS5PLndhbnRBcnJheShwcm9wcy50cmFpdCB8fCBwcm9wcy50cmFpdHMgfHwgW10pXG4gICAgICAgIGRlbGV0ZSBwcm9wcy50cmFpdFxuICAgICAgICBkZWxldGUgcHJvcHMudHJhaXRzXG4gICAgICAgIFxuICAgICAgICBKb29zZS5BLmVhY2goSm9vc2UuTy53YW50QXJyYXkocHJvcHMuZG9lcyB8fCBbXSksIGZ1bmN0aW9uIChhcmcpIHtcbiAgICAgICAgICAgIHZhciByb2xlID0gKGFyZy5tZXRhIGluc3RhbmNlb2YgSm9vc2UuTWFuYWdlZC5DbGFzcykgPyBhcmcgOiBhcmcucm9sZVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAocm9sZS5tZXRhLm1ldGEuaXNEZXRhY2hlZCkgdHJhaXRzLnB1c2gocm9sZS5tZXRhLmNvbnN0cnVjdG9yKVxuICAgICAgICB9KVxuICAgICAgICBcbiAgICAgICAgaWYgKHRyYWl0cy5sZW5ndGgpIHByb3BzLnRyYWl0cyA9IHRyYWl0cyBcbiAgICAgICAgXG4gICAgICAgIHJldHVybiBzdXBcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGluaXRJbnN0YW5jZSA6IGZ1bmN0aW9uIChpbnN0YW5jZSwgcHJvcHMpIHtcbiAgICAgICAgSm9vc2UuTy5lYWNoKHRoaXMuYXR0cmlidXRlcywgZnVuY3Rpb24gKGF0dHJpYnV0ZSwgbmFtZSkge1xuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAoYXR0cmlidXRlIGluc3RhbmNlb2YgSm9vc2UuTWFuYWdlZC5BdHRyaWJ1dGUpIFxuICAgICAgICAgICAgICAgIGF0dHJpYnV0ZS5pbml0RnJvbUNvbmZpZyhpbnN0YW5jZSwgcHJvcHMpXG4gICAgICAgICAgICBlbHNlIFxuICAgICAgICAgICAgICAgIGlmIChwcm9wcy5oYXNPd25Qcm9wZXJ0eShuYW1lKSkgaW5zdGFuY2VbbmFtZV0gPSBwcm9wc1tuYW1lXVxuICAgICAgICB9KVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgLy8gd2UgYXJlIHVzaW5nIHRoZSBzYW1lIGNvbnN0cnVjdG9yIGZvciB1c3VhbCBhbmQgbWV0YS0gY2xhc3Nlc1xuICAgIGRlZmF1bHRDb25zdHJ1Y3RvcjogZnVuY3Rpb24gKCkge1xuICAgICAgICByZXR1cm4gZnVuY3Rpb24gKHNraXBUcmFpdHNBbmNob3IsIHBhcmFtcykge1xuICAgICAgICAgICAgXG4gICAgICAgICAgICB2YXIgdGhpc01ldGEgICAgPSB0aGlzLm1ldGFcbiAgICAgICAgICAgIHZhciBza2lwVHJhaXRzICA9IHNraXBUcmFpdHNBbmNob3IgPT0gdGhpc01ldGEuc2tpcFRyYWl0c0FuY2hvclxuICAgICAgICAgICAgXG4gICAgICAgICAgICB2YXIgQlVJTEQgICAgICAgPSB0aGlzLkJVSUxEXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciBwcm9wcyAgICAgICA9IEJVSUxEICYmIEJVSUxELmFwcGx5KHRoaXMsIHNraXBUcmFpdHMgPyBwYXJhbXMgOiBhcmd1bWVudHMpIHx8IChza2lwVHJhaXRzID8gcGFyYW1zWzBdIDogc2tpcFRyYWl0c0FuY2hvcikgfHwge31cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBlaXRoZXIgbG9va2luZyBmb3IgdHJhaXRzIGluIF9fZXh0ZW5kX18gKG1ldGEtY2xhc3MpIG9yIGluIHVzdWFsIHByb3BzICh1c3VhbCBjbGFzcylcbiAgICAgICAgICAgIHZhciBleHRlbmQgID0gcHJvcHMuX19leHRlbmRfXyB8fCBwcm9wc1xuICAgICAgICAgICAgXG4gICAgICAgICAgICB2YXIgdHJhaXRzID0gZXh0ZW5kLnRyYWl0IHx8IGV4dGVuZC50cmFpdHNcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKHRyYWl0cyB8fCBleHRlbmQuZGV0YWNoZWQpIHtcbiAgICAgICAgICAgICAgICBkZWxldGUgZXh0ZW5kLnRyYWl0XG4gICAgICAgICAgICAgICAgZGVsZXRlIGV4dGVuZC50cmFpdHNcbiAgICAgICAgICAgICAgICBkZWxldGUgZXh0ZW5kLmRldGFjaGVkXG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgaWYgKCFza2lwVHJhaXRzKSB7XG4gICAgICAgICAgICAgICAgICAgIHZhciBjbGFzc1dpdGhUcmFpdCAgPSB0aGlzTWV0YS5zdWJDbGFzcyh7IGRvZXMgOiB0cmFpdHMgfHwgW10gfSwgdGhpc01ldGEubmFtZSlcbiAgICAgICAgICAgICAgICAgICAgdmFyIG1ldGEgICAgICAgICAgICA9IGNsYXNzV2l0aFRyYWl0Lm1ldGFcbiAgICAgICAgICAgICAgICAgICAgbWV0YS5pc0RldGFjaGVkICAgICA9IHRydWVcbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBtZXRhLmluc3RhbnRpYXRlKHRoaXNNZXRhLnNraXBUcmFpdHNBbmNob3IsIGFyZ3VtZW50cylcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXNNZXRhLmluaXRJbnN0YW5jZSh0aGlzLCBwcm9wcylcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcmV0dXJuIHRoaXNNZXRhLmhhc01ldGhvZCgnaW5pdGlhbGl6ZScpICYmIHRoaXMuaW5pdGlhbGl6ZShwcm9wcykgfHwgdGhpc1xuICAgICAgICB9XG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBmaW5hbGl6ZTogZnVuY3Rpb24gKGV4dGVuZCkge1xuICAgICAgICBKb29zZS5NYW5hZ2VkLkNsYXNzLnN1cGVyQ2xhc3MuZmluYWxpemUuY2FsbCh0aGlzLCBleHRlbmQpXG4gICAgICAgIFxuICAgICAgICB0aGlzLnN0ZW0uY2xvc2UoKVxuICAgICAgICBcbiAgICAgICAgdGhpcy5hZnRlck11dGF0ZSgpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBwcm9jZXNzU3RlbSA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgSm9vc2UuTWFuYWdlZC5DbGFzcy5zdXBlckNsYXNzLnByb2Nlc3NTdGVtLmNhbGwodGhpcylcbiAgICAgICAgXG4gICAgICAgIHRoaXMuYnVpbGRlciAgICA9IG5ldyB0aGlzLmJ1aWxkZXJDbGFzcyh7IHRhcmdldE1ldGEgOiB0aGlzIH0pXG4gICAgICAgIHRoaXMuc3RlbSAgICAgICA9IG5ldyB0aGlzLnN0ZW1DbGFzcyh7IG5hbWUgOiB0aGlzLm5hbWUsIHRhcmdldE1ldGEgOiB0aGlzIH0pXG4gICAgICAgIFxuICAgICAgICB2YXIgYnVpbGRlckNsYXNzID0gdGhpcy5nZXRDbGFzc0luQXR0cmlidXRlKCdidWlsZGVyQ2xhc3MnKVxuICAgICAgICBcbiAgICAgICAgaWYgKGJ1aWxkZXJDbGFzcykge1xuICAgICAgICAgICAgdGhpcy5idWlsZGVyQ2xhc3NDcmVhdGVkID0gdHJ1ZVxuICAgICAgICAgICAgdGhpcy5hZGRBdHRyaWJ1dGUoJ2J1aWxkZXJDbGFzcycsIHRoaXMuc3ViQ2xhc3NPZihidWlsZGVyQ2xhc3MpKVxuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgdmFyIHN0ZW1DbGFzcyA9IHRoaXMuZ2V0Q2xhc3NJbkF0dHJpYnV0ZSgnc3RlbUNsYXNzJylcbiAgICAgICAgXG4gICAgICAgIGlmIChzdGVtQ2xhc3MpIHtcbiAgICAgICAgICAgIHRoaXMuc3RlbUNsYXNzQ3JlYXRlZCA9IHRydWVcbiAgICAgICAgICAgIHRoaXMuYWRkQXR0cmlidXRlKCdzdGVtQ2xhc3MnLCB0aGlzLnN1YkNsYXNzT2Yoc3RlbUNsYXNzKSlcbiAgICAgICAgfVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgZXh0ZW5kIDogZnVuY3Rpb24gKHByb3BzKSB7XG4gICAgICAgIGlmIChwcm9wcy5idWlsZGVyKSB7XG4gICAgICAgICAgICB0aGlzLmdldEJ1aWxkZXJUYXJnZXQoKS5tZXRhLmV4dGVuZChwcm9wcy5idWlsZGVyKVxuICAgICAgICAgICAgZGVsZXRlIHByb3BzLmJ1aWxkZXJcbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgaWYgKHByb3BzLnN0ZW0pIHtcbiAgICAgICAgICAgIHRoaXMuZ2V0U3RlbVRhcmdldCgpLm1ldGEuZXh0ZW5kKHByb3BzLnN0ZW0pXG4gICAgICAgICAgICBkZWxldGUgcHJvcHMuc3RlbVxuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICB0aGlzLmJ1aWxkZXIuX2V4dGVuZChwcm9wcylcbiAgICAgICAgXG4gICAgICAgIHRoaXMuZmlyc3RQYXNzID0gZmFsc2VcbiAgICAgICAgXG4gICAgICAgIGlmICghdGhpcy5zdGVtLm9wZW5lZCkgdGhpcy5hZnRlck11dGF0ZSgpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBnZXRCdWlsZGVyVGFyZ2V0IDogZnVuY3Rpb24gKCkge1xuICAgICAgICB2YXIgYnVpbGRlckNsYXNzID0gdGhpcy5nZXRDbGFzc0luQXR0cmlidXRlKCdidWlsZGVyQ2xhc3MnKVxuICAgICAgICBpZiAoIWJ1aWxkZXJDbGFzcykgdGhyb3cgXCJBdHRlbXB0IHRvIGV4dGVuZCBhIGJ1aWxkZXIgb24gbm9uLW1ldGEgY2xhc3NcIlxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIGJ1aWxkZXJDbGFzc1xuICAgIH0sXG4gICAgXG5cbiAgICBnZXRTdGVtVGFyZ2V0IDogZnVuY3Rpb24gKCkge1xuICAgICAgICB2YXIgc3RlbUNsYXNzID0gdGhpcy5nZXRDbGFzc0luQXR0cmlidXRlKCdzdGVtQ2xhc3MnKVxuICAgICAgICBpZiAoIXN0ZW1DbGFzcykgdGhyb3cgXCJBdHRlbXB0IHRvIGV4dGVuZCBhIHN0ZW0gb24gbm9uLW1ldGEgY2xhc3NcIlxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIHN0ZW1DbGFzc1xuICAgIH0sXG4gICAgXG4gICAgXG4gICAgZ2V0Q2xhc3NJbkF0dHJpYnV0ZSA6IGZ1bmN0aW9uIChhdHRyaWJ1dGVOYW1lKSB7XG4gICAgICAgIHZhciBhdHRyQ2xhc3MgPSB0aGlzLmdldEF0dHJpYnV0ZShhdHRyaWJ1dGVOYW1lKVxuICAgICAgICBpZiAoYXR0ckNsYXNzIGluc3RhbmNlb2YgSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eS5BdHRyaWJ1dGUpIGF0dHJDbGFzcyA9IGF0dHJDbGFzcy52YWx1ZVxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIGF0dHJDbGFzc1xuICAgIH0sXG4gICAgXG4gICAgXG4gICAgYWRkTWV0aG9kTW9kaWZpZXI6IGZ1bmN0aW9uIChuYW1lLCBmdW5jLCB0eXBlKSB7XG4gICAgICAgIHZhciBwcm9wcyA9IHt9XG4gICAgICAgIFxuICAgICAgICBwcm9wcy5pbml0ID0gZnVuY1xuICAgICAgICBwcm9wcy5tZXRhID0gdHlwZVxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIHRoaXMuc3RlbS5wcm9wZXJ0aWVzLm1ldGhvZHNNb2RpZmllcnMuYWRkUHJvcGVydHkobmFtZSwgcHJvcHMpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICByZW1vdmVNZXRob2RNb2RpZmllcjogZnVuY3Rpb24gKG5hbWUpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuc3RlbS5wcm9wZXJ0aWVzLm1ldGhvZHNNb2RpZmllcnMucmVtb3ZlUHJvcGVydHkobmFtZSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGFkZE1ldGhvZDogZnVuY3Rpb24gKG5hbWUsIGZ1bmMsIHByb3BzKSB7XG4gICAgICAgIHByb3BzID0gcHJvcHMgfHwge31cbiAgICAgICAgcHJvcHMuaW5pdCA9IGZ1bmNcbiAgICAgICAgXG4gICAgICAgIHJldHVybiB0aGlzLnN0ZW0ucHJvcGVydGllcy5tZXRob2RzLmFkZFByb3BlcnR5KG5hbWUsIHByb3BzKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgYWRkQXR0cmlidXRlOiBmdW5jdGlvbiAobmFtZSwgaW5pdCwgcHJvcHMpIHtcbiAgICAgICAgcHJvcHMgPSBwcm9wcyB8fCB7fVxuICAgICAgICBwcm9wcy5pbml0ID0gaW5pdFxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIHRoaXMuc3RlbS5wcm9wZXJ0aWVzLmF0dHJpYnV0ZXMuYWRkUHJvcGVydHkobmFtZSwgcHJvcHMpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICByZW1vdmVNZXRob2QgOiBmdW5jdGlvbiAobmFtZSkge1xuICAgICAgICByZXR1cm4gdGhpcy5zdGVtLnByb3BlcnRpZXMubWV0aG9kcy5yZW1vdmVQcm9wZXJ0eShuYW1lKVxuICAgIH0sXG5cbiAgICBcbiAgICByZW1vdmVBdHRyaWJ1dGU6IGZ1bmN0aW9uIChuYW1lKSB7XG4gICAgICAgIHJldHVybiB0aGlzLnN0ZW0ucHJvcGVydGllcy5hdHRyaWJ1dGVzLnJlbW92ZVByb3BlcnR5KG5hbWUpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBoYXNNZXRob2Q6IGZ1bmN0aW9uIChuYW1lKSB7XG4gICAgICAgIHJldHVybiB0aGlzLnN0ZW0ucHJvcGVydGllcy5tZXRob2RzLmhhdmVQcm9wZXJ0eShuYW1lKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgaGFzQXR0cmlidXRlOiBmdW5jdGlvbiAobmFtZSkgeyBcbiAgICAgICAgcmV0dXJuIHRoaXMuc3RlbS5wcm9wZXJ0aWVzLmF0dHJpYnV0ZXMuaGF2ZVByb3BlcnR5KG5hbWUpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBoYXNNZXRob2RNb2RpZmllcnNGb3IgOiBmdW5jdGlvbiAobmFtZSkge1xuICAgICAgICByZXR1cm4gdGhpcy5zdGVtLnByb3BlcnRpZXMubWV0aG9kc01vZGlmaWVycy5oYXZlUHJvcGVydHkobmFtZSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGhhc093bk1ldGhvZDogZnVuY3Rpb24gKG5hbWUpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuc3RlbS5wcm9wZXJ0aWVzLm1ldGhvZHMuaGF2ZU93blByb3BlcnR5KG5hbWUpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBoYXNPd25BdHRyaWJ1dGU6IGZ1bmN0aW9uIChuYW1lKSB7IFxuICAgICAgICByZXR1cm4gdGhpcy5zdGVtLnByb3BlcnRpZXMuYXR0cmlidXRlcy5oYXZlT3duUHJvcGVydHkobmFtZSlcbiAgICB9LFxuICAgIFxuXG4gICAgZ2V0TWV0aG9kIDogZnVuY3Rpb24gKG5hbWUpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuc3RlbS5wcm9wZXJ0aWVzLm1ldGhvZHMuZ2V0UHJvcGVydHkobmFtZSlcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGdldEF0dHJpYnV0ZSA6IGZ1bmN0aW9uIChuYW1lKSB7XG4gICAgICAgIHJldHVybiB0aGlzLnN0ZW0ucHJvcGVydGllcy5hdHRyaWJ1dGVzLmdldFByb3BlcnR5KG5hbWUpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBlYWNoUm9sZSA6IGZ1bmN0aW9uIChyb2xlcywgZnVuYywgc2NvcGUpIHtcbiAgICAgICAgSm9vc2UuQS5lYWNoKHJvbGVzLCBmdW5jdGlvbiAoYXJnLCBpbmRleCkge1xuICAgICAgICAgICAgdmFyIHJvbGUgPSAoYXJnLm1ldGEgaW5zdGFuY2VvZiBKb29zZS5NYW5hZ2VkLkNsYXNzKSA/IGFyZyA6IGFyZy5yb2xlXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGZ1bmMuY2FsbChzY29wZSB8fCB0aGlzLCBhcmcsIHJvbGUsIGluZGV4KVxuICAgICAgICB9LCB0aGlzKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgYWRkUm9sZSA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgXG4gICAgICAgIHRoaXMuZWFjaFJvbGUoYXJndW1lbnRzLCBmdW5jdGlvbiAoYXJnLCByb2xlKSB7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXMuYmVmb3JlUm9sZUFkZChyb2xlKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB2YXIgZGVzYyA9IGFyZ1xuICAgICAgICAgICAgXG4gICAgICAgICAgICAvL2NvbXBvc2UgZGVzY3JpcHRvciBjYW4gY29udGFpbiAnYWxpYXMnIGFuZCAnZXhjbHVkZScgZmllbGRzLCBpbiB0aGlzIGNhc2UgYWN0dWFsIHJlZmVyZW5jZSBzaG91bGQgYmUgc3RvcmVkXG4gICAgICAgICAgICAvL2ludG8gJ3Byb3BlcnR5U2V0JyBmaWVsZFxuICAgICAgICAgICAgaWYgKHJvbGUgIT0gYXJnKSB7XG4gICAgICAgICAgICAgICAgZGVzYy5wcm9wZXJ0eVNldCA9IHJvbGUubWV0YS5zdGVtXG4gICAgICAgICAgICAgICAgZGVsZXRlIGRlc2Mucm9sZVxuICAgICAgICAgICAgfSBlbHNlXG4gICAgICAgICAgICAgICAgZGVzYyA9IGRlc2MubWV0YS5zdGVtXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXMuc3RlbS5hZGRDb21wb3NlSW5mbyhkZXNjKVxuICAgICAgICAgICAgXG4gICAgICAgIH0sIHRoaXMpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBiZWZvcmVSb2xlQWRkIDogZnVuY3Rpb24gKHJvbGUpIHtcbiAgICAgICAgdmFyIHJvbGVNZXRhID0gcm9sZS5tZXRhXG4gICAgICAgIFxuICAgICAgICBpZiAocm9sZU1ldGEuYnVpbGRlckNsYXNzQ3JlYXRlZCkgdGhpcy5nZXRCdWlsZGVyVGFyZ2V0KCkubWV0YS5leHRlbmQoe1xuICAgICAgICAgICAgZG9lcyA6IFsgcm9sZU1ldGEuZ2V0QnVpbGRlclRhcmdldCgpIF1cbiAgICAgICAgfSlcbiAgICAgICAgXG4gICAgICAgIGlmIChyb2xlTWV0YS5zdGVtQ2xhc3NDcmVhdGVkKSB0aGlzLmdldFN0ZW1UYXJnZXQoKS5tZXRhLmV4dGVuZCh7XG4gICAgICAgICAgICBkb2VzIDogWyByb2xlTWV0YS5nZXRTdGVtVGFyZ2V0KCkgXVxuICAgICAgICB9KVxuICAgICAgICBcbiAgICAgICAgaWYgKHJvbGVNZXRhLm1ldGEuaXNEZXRhY2hlZCAmJiAhdGhpcy5maXJzdFBhc3MpIHRoaXMuYnVpbGRlci50cmFpdHModGhpcywgcm9sZU1ldGEuY29uc3RydWN0b3IpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBiZWZvcmVSb2xlUmVtb3ZlIDogZnVuY3Rpb24gKHJvbGUpIHtcbiAgICAgICAgdmFyIHJvbGVNZXRhID0gcm9sZS5tZXRhXG4gICAgICAgIFxuICAgICAgICBpZiAocm9sZU1ldGEuYnVpbGRlckNsYXNzQ3JlYXRlZCkgdGhpcy5nZXRCdWlsZGVyVGFyZ2V0KCkubWV0YS5leHRlbmQoe1xuICAgICAgICAgICAgZG9lc250IDogWyByb2xlTWV0YS5nZXRCdWlsZGVyVGFyZ2V0KCkgXVxuICAgICAgICB9KVxuICAgICAgICBcbiAgICAgICAgaWYgKHJvbGVNZXRhLnN0ZW1DbGFzc0NyZWF0ZWQpIHRoaXMuZ2V0U3RlbVRhcmdldCgpLm1ldGEuZXh0ZW5kKHtcbiAgICAgICAgICAgIGRvZXNudCA6IFsgcm9sZU1ldGEuZ2V0U3RlbVRhcmdldCgpIF1cbiAgICAgICAgfSlcbiAgICAgICAgXG4gICAgICAgIGlmIChyb2xlTWV0YS5tZXRhLmlzRGV0YWNoZWQgJiYgIXRoaXMuZmlyc3RQYXNzKSB0aGlzLmJ1aWxkZXIucmVtb3ZlVHJhaXRzKHRoaXMsIHJvbGVNZXRhLmNvbnN0cnVjdG9yKVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgcmVtb3ZlUm9sZSA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgdGhpcy5lYWNoUm9sZShhcmd1bWVudHMsIGZ1bmN0aW9uIChhcmcsIHJvbGUpIHtcbiAgICAgICAgICAgIHRoaXMuYmVmb3JlUm9sZVJlbW92ZShyb2xlKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLnN0ZW0ucmVtb3ZlQ29tcG9zZUluZm8ocm9sZS5tZXRhLnN0ZW0pXG4gICAgICAgIH0sIHRoaXMpXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBnZXRSb2xlcyA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgXG4gICAgICAgIHJldHVybiBKb29zZS5BLm1hcCh0aGlzLnN0ZW0uY29tcG9zZWRGcm9tLCBmdW5jdGlvbiAoY29tcG9zZURlc2MpIHtcbiAgICAgICAgICAgIC8vY29tcG9zZSBkZXNjcmlwdG9yIGNhbiBjb250YWluICdhbGlhcycgYW5kICdleGNsdWRlJyBmaWVsZHMsIGluIHRoaXMgY2FzZSBhY3R1YWwgcmVmZXJlbmNlIGlzIHN0b3JlZFxuICAgICAgICAgICAgLy9pbnRvICdwcm9wZXJ0eVNldCcgZmllbGRcbiAgICAgICAgICAgIGlmICghKGNvbXBvc2VEZXNjIGluc3RhbmNlb2YgSm9vc2UuTWFuYWdlZC5Qcm9wZXJ0eVNldCkpIHJldHVybiBjb21wb3NlRGVzYy5wcm9wZXJ0eVNldFxuICAgICAgICAgICAgXG4gICAgICAgICAgICByZXR1cm4gY29tcG9zZURlc2MudGFyZ2V0TWV0YS5jXG4gICAgICAgIH0pXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBkb2VzIDogZnVuY3Rpb24gKHJvbGUpIHtcbiAgICAgICAgdmFyIG15Um9sZXMgPSB0aGlzLmdldFJvbGVzKClcbiAgICAgICAgXG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgbXlSb2xlcy5sZW5ndGg7IGkrKykgaWYgKHJvbGUgPT0gbXlSb2xlc1tpXSkgcmV0dXJuIHRydWVcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBteVJvbGVzLmxlbmd0aDsgaSsrKSBpZiAobXlSb2xlc1tpXS5tZXRhLmRvZXMocm9sZSkpIHJldHVybiB0cnVlXG4gICAgICAgIFxuICAgICAgICB2YXIgc3VwZXJNZXRhID0gdGhpcy5zdXBlckNsYXNzLm1ldGFcbiAgICAgICAgXG4gICAgICAgIC8vIGNvbnNpZGVyaW5nIHRoZSBjYXNlIG9mIGluaGVyaXRpbmcgZnJvbSBub24tSm9vc2UgY2xhc3Nlc1xuICAgICAgICBpZiAodGhpcy5zdXBlckNsYXNzICE9IEpvb3NlLlByb3RvLkVtcHR5ICYmIHN1cGVyTWV0YSAmJiBzdXBlck1ldGEubWV0YSAmJiBzdXBlck1ldGEubWV0YS5oYXNNZXRob2QoJ2RvZXMnKSkgcmV0dXJuIHN1cGVyTWV0YS5kb2VzKHJvbGUpXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gZmFsc2VcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIGdldE1ldGhvZHMgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHJldHVybiB0aGlzLnN0ZW0ucHJvcGVydGllcy5tZXRob2RzXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBnZXRBdHRyaWJ1dGVzIDogZnVuY3Rpb24gKCkge1xuICAgICAgICByZXR1cm4gdGhpcy5zdGVtLnByb3BlcnRpZXMuYXR0cmlidXRlc1xuICAgIH0sXG4gICAgXG4gICAgXG4gICAgYWZ0ZXJNdXRhdGUgOiBmdW5jdGlvbiAoKSB7XG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBnZXRDdXJyZW50TWV0aG9kIDogZnVuY3Rpb24gKCkge1xuICAgICAgICBmb3IgKHZhciB3cmFwcGVyID0gYXJndW1lbnRzLmNhbGxlZS5jYWxsZXIsIGNvdW50ID0gMDsgd3JhcHBlciAmJiBjb3VudCA8IDU7IHdyYXBwZXIgPSB3cmFwcGVyLmNhbGxlciwgY291bnQrKylcbiAgICAgICAgICAgIGlmICh3cmFwcGVyLl9fTUVUSE9EX18pIHJldHVybiB3cmFwcGVyLl9fTUVUSE9EX19cbiAgICAgICAgXG4gICAgICAgIHJldHVybiBudWxsXG4gICAgfVxuICAgIFxuICAgIFxufSkuYztcbkpvb3NlLk1hbmFnZWQuUm9sZSA9IG5ldyBKb29zZS5NYW5hZ2VkLkNsYXNzKCdKb29zZS5NYW5hZ2VkLlJvbGUnLCB7XG4gICAgXG4gICAgaXNhICAgICAgICAgICAgICAgICAgICAgICAgIDogSm9vc2UuTWFuYWdlZC5DbGFzcyxcbiAgICBcbiAgICBoYXZlIDoge1xuICAgICAgICBkZWZhdWx0U3VwZXJDbGFzcyAgICAgICA6IEpvb3NlLlByb3RvLkVtcHR5LFxuICAgICAgICBcbiAgICAgICAgYnVpbGRlclJvbGUgICAgICAgICAgICAgOiBudWxsLFxuICAgICAgICBzdGVtUm9sZSAgICAgICAgICAgICAgICA6IG51bGxcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIG1ldGhvZHMgOiB7XG4gICAgICAgIFxuICAgICAgICBkZWZhdWx0Q29uc3RydWN0b3IgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICByZXR1cm4gZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcIlJvbGVzIGNhbnQgYmUgaW5zdGFudGlhdGVkXCIpXG4gICAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIFxuXG4gICAgICAgIHByb2Nlc3NTdXBlckNsYXNzIDogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgaWYgKHRoaXMuc3VwZXJDbGFzcyAhPSB0aGlzLmRlZmF1bHRTdXBlckNsYXNzKSB0aHJvdyBuZXcgRXJyb3IoXCJSb2xlcyBjYW4ndCBpbmhlcml0IGZyb20gYW55dGhpbmdcIilcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBnZXRCdWlsZGVyVGFyZ2V0IDogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgaWYgKCF0aGlzLmJ1aWxkZXJSb2xlKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5idWlsZGVyUm9sZSA9IG5ldyB0aGlzLmNvbnN0cnVjdG9yKCkuY1xuICAgICAgICAgICAgICAgIHRoaXMuYnVpbGRlckNsYXNzQ3JlYXRlZCA9IHRydWVcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcmV0dXJuIHRoaXMuYnVpbGRlclJvbGVcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgXG4gICAgICAgIGdldFN0ZW1UYXJnZXQgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBpZiAoIXRoaXMuc3RlbVJvbGUpIHtcbiAgICAgICAgICAgICAgICB0aGlzLnN0ZW1Sb2xlID0gbmV3IHRoaXMuY29uc3RydWN0b3IoKS5jXG4gICAgICAgICAgICAgICAgdGhpcy5zdGVtQ2xhc3NDcmVhdGVkID0gdHJ1ZVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5zdGVtUm9sZVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICBcbiAgICAgICAgYWRkUmVxdWlyZW1lbnQgOiBmdW5jdGlvbiAobWV0aG9kTmFtZSkge1xuICAgICAgICAgICAgdGhpcy5zdGVtLnByb3BlcnRpZXMucmVxdWlyZW1lbnRzLmFkZFByb3BlcnR5KG1ldGhvZE5hbWUsIHt9KVxuICAgICAgICB9XG4gICAgICAgIFxuICAgIH0sXG4gICAgXG5cbiAgICBzdGVtIDoge1xuICAgICAgICBtZXRob2RzIDoge1xuICAgICAgICAgICAgXG4gICAgICAgICAgICBhcHBseSA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdW5hcHBseSA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgYnVpbGRlciA6IHtcbiAgICAgICAgbWV0aG9kcyA6IHtcbiAgICAgICAgICAgIHJlcXVpcmVzIDogZnVuY3Rpb24gKHRhcmdldENsYXNzTWV0YSwgaW5mbykge1xuICAgICAgICAgICAgICAgIEpvb3NlLkEuZWFjaChKb29zZS5PLndhbnRBcnJheShpbmZvKSwgZnVuY3Rpb24gKG1ldGhvZE5hbWUpIHtcbiAgICAgICAgICAgICAgICAgICAgdGFyZ2V0Q2xhc3NNZXRhLmFkZFJlcXVpcmVtZW50KG1ldGhvZE5hbWUpXG4gICAgICAgICAgICAgICAgfSwgdGhpcylcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cbiAgICBcbn0pLmM7XG5Kb29zZS5NYW5hZ2VkLkF0dHJpYnV0ZSA9IG5ldyBKb29zZS5NYW5hZ2VkLkNsYXNzKCdKb29zZS5NYW5hZ2VkLkF0dHJpYnV0ZScsIHtcbiAgICBcbiAgICBpc2EgOiBKb29zZS5NYW5hZ2VkLlByb3BlcnR5LkF0dHJpYnV0ZSxcbiAgICBcbiAgICBoYXZlIDoge1xuICAgICAgICBpcyAgICAgICAgICAgICAgOiBudWxsLFxuICAgICAgICBcbiAgICAgICAgYnVpbGRlciAgICAgICAgIDogbnVsbCxcbiAgICAgICAgXG4gICAgICAgIGlzUHJpdmF0ZSAgICAgICA6IGZhbHNlLFxuICAgICAgICBcbiAgICAgICAgcm9sZSAgICAgICAgICAgIDogbnVsbCxcbiAgICAgICAgXG4gICAgICAgIHB1YmxpY05hbWUgICAgICA6IG51bGwsXG4gICAgICAgIHNldHRlck5hbWUgICAgICA6IG51bGwsXG4gICAgICAgIGdldHRlck5hbWUgICAgICA6IG51bGwsXG4gICAgICAgIFxuICAgICAgICAvL2luZGljYXRlcyB0aGUgbG9naWNhbCByZWFkYWJsZW5lc3Mvd3JpdGVhYmxlbmVzcyBvZiB0aGUgYXR0cmlidXRlXG4gICAgICAgIHJlYWRhYmxlICAgICAgICA6IGZhbHNlLFxuICAgICAgICB3cml0ZWFibGUgICAgICAgOiBmYWxzZSxcbiAgICAgICAgXG4gICAgICAgIC8vaW5kaWNhdGVzIHRoZSBwaHlzaWNhbCBwcmVzZW5zZSBvZiB0aGUgYWNjZXNzb3IgKG1heSBiZSBhYnNlbnQgZm9yIFwiY29tYmluZWRcIiBhY2Nlc3NvcnMgZm9yIGV4YW1wbGUpXG4gICAgICAgIGhhc0dldHRlciAgICAgICA6IGZhbHNlLFxuICAgICAgICBoYXNTZXR0ZXIgICAgICAgOiBmYWxzZSxcbiAgICAgICAgXG4gICAgICAgIHJlcXVpcmVkICAgICAgICA6IGZhbHNlLFxuICAgICAgICBcbiAgICAgICAgY2FuSW5saW5lU2V0UmF3IDogdHJ1ZSxcbiAgICAgICAgY2FuSW5saW5lR2V0UmF3IDogdHJ1ZVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgYWZ0ZXIgOiB7XG4gICAgICAgIGluaXRpYWxpemUgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB2YXIgbmFtZSA9IHRoaXMubmFtZVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLnB1YmxpY05hbWUgPSBuYW1lLnJlcGxhY2UoL15fKy8sICcnKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLnNsb3QgPSB0aGlzLmlzUHJpdmF0ZSA/ICckJCcgKyBuYW1lIDogbmFtZVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLnNldHRlck5hbWUgPSB0aGlzLnNldHRlck5hbWUgfHwgdGhpcy5nZXRTZXR0ZXJOYW1lKClcbiAgICAgICAgICAgIHRoaXMuZ2V0dGVyTmFtZSA9IHRoaXMuZ2V0dGVyTmFtZSB8fCB0aGlzLmdldEdldHRlck5hbWUoKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLnJlYWRhYmxlICA9IHRoaXMuaGFzR2V0dGVyID0gL15yL2kudGVzdCh0aGlzLmlzKVxuICAgICAgICAgICAgdGhpcy53cml0ZWFibGUgPSB0aGlzLmhhc1NldHRlciA9IC9eLncvaS50ZXN0KHRoaXMuaXMpXG4gICAgICAgIH1cbiAgICB9LFxuICAgIFxuICAgIFxuICAgIG92ZXJyaWRlIDoge1xuICAgICAgICBcbiAgICAgICAgY29tcHV0ZVZhbHVlIDogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgdmFyIGluaXQgICAgPSB0aGlzLmluaXRcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKEpvb3NlLk8uaXNDbGFzcyhpbml0KSB8fCAhSm9vc2UuTy5pc0Z1bmN0aW9uKGluaXQpKSB0aGlzLlNVUEVSKClcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBwcmVBcHBseSA6IGZ1bmN0aW9uICh0YXJnZXRDbGFzcykge1xuICAgICAgICAgICAgdGFyZ2V0Q2xhc3MubWV0YS5leHRlbmQoe1xuICAgICAgICAgICAgICAgIG1ldGhvZHMgOiB0aGlzLmdldEFjY2Vzc29yc0Zvcih0YXJnZXRDbGFzcylcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgcG9zdFVuQXBwbHkgOiBmdW5jdGlvbiAoZnJvbSkge1xuICAgICAgICAgICAgZnJvbS5tZXRhLmV4dGVuZCh7XG4gICAgICAgICAgICAgICAgcmVtb3ZlTWV0aG9kcyA6IHRoaXMuZ2V0QWNjZXNzb3JzRnJvbShmcm9tKVxuICAgICAgICAgICAgfSlcbiAgICAgICAgfVxuICAgICAgICBcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIG1ldGhvZHMgOiB7XG4gICAgICAgIFxuICAgICAgICBnZXRBY2Nlc3NvcnNGb3IgOiBmdW5jdGlvbiAodGFyZ2V0Q2xhc3MpIHtcbiAgICAgICAgICAgIHZhciB0YXJnZXRNZXRhID0gdGFyZ2V0Q2xhc3MubWV0YVxuICAgICAgICAgICAgdmFyIHNldHRlck5hbWUgPSB0aGlzLnNldHRlck5hbWVcbiAgICAgICAgICAgIHZhciBnZXR0ZXJOYW1lID0gdGhpcy5nZXR0ZXJOYW1lXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciBtZXRob2RzID0ge31cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKHRoaXMuaGFzU2V0dGVyICYmICF0YXJnZXRNZXRhLmhhc01ldGhvZChzZXR0ZXJOYW1lKSkge1xuICAgICAgICAgICAgICAgIG1ldGhvZHNbc2V0dGVyTmFtZV0gPSB0aGlzLmdldFNldHRlcigpXG4gICAgICAgICAgICAgICAgbWV0aG9kc1tzZXR0ZXJOYW1lXS5BQ0NFU1NPUl9GUk9NID0gdGhpc1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAodGhpcy5oYXNHZXR0ZXIgJiYgIXRhcmdldE1ldGEuaGFzTWV0aG9kKGdldHRlck5hbWUpKSB7XG4gICAgICAgICAgICAgICAgbWV0aG9kc1tnZXR0ZXJOYW1lXSA9IHRoaXMuZ2V0R2V0dGVyKClcbiAgICAgICAgICAgICAgICBtZXRob2RzW2dldHRlck5hbWVdLkFDQ0VTU09SX0ZST00gPSB0aGlzXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHJldHVybiBtZXRob2RzXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgZ2V0QWNjZXNzb3JzRnJvbSA6IGZ1bmN0aW9uIChmcm9tKSB7XG4gICAgICAgICAgICB2YXIgdGFyZ2V0TWV0YSA9IGZyb20ubWV0YVxuICAgICAgICAgICAgdmFyIHNldHRlck5hbWUgPSB0aGlzLnNldHRlck5hbWVcbiAgICAgICAgICAgIHZhciBnZXR0ZXJOYW1lID0gdGhpcy5nZXR0ZXJOYW1lXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciBzZXR0ZXIgPSB0aGlzLmhhc1NldHRlciAmJiB0YXJnZXRNZXRhLmdldE1ldGhvZChzZXR0ZXJOYW1lKVxuICAgICAgICAgICAgdmFyIGdldHRlciA9IHRoaXMuaGFzR2V0dGVyICYmIHRhcmdldE1ldGEuZ2V0TWV0aG9kKGdldHRlck5hbWUpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciByZW1vdmVNZXRob2RzID0gW11cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKHNldHRlciAmJiBzZXR0ZXIudmFsdWUuQUNDRVNTT1JfRlJPTSA9PSB0aGlzKSByZW1vdmVNZXRob2RzLnB1c2goc2V0dGVyTmFtZSlcbiAgICAgICAgICAgIGlmIChnZXR0ZXIgJiYgZ2V0dGVyLnZhbHVlLkFDQ0VTU09SX0ZST00gPT0gdGhpcykgcmVtb3ZlTWV0aG9kcy5wdXNoKGdldHRlck5hbWUpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHJldHVybiByZW1vdmVNZXRob2RzXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgZ2V0R2V0dGVyTmFtZSA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHJldHVybiAnZ2V0JyArIEpvb3NlLlMudXBwZXJjYXNlRmlyc3QodGhpcy5wdWJsaWNOYW1lKVxuICAgICAgICB9LFxuXG5cbiAgICAgICAgZ2V0U2V0dGVyTmFtZSA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHJldHVybiAnc2V0JyArIEpvb3NlLlMudXBwZXJjYXNlRmlyc3QodGhpcy5wdWJsaWNOYW1lKVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIGdldFNldHRlciA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHZhciBtZSAgICAgID0gdGhpc1xuICAgICAgICAgICAgdmFyIHNsb3QgICAgPSBtZS5zbG90XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmIChtZS5jYW5JbmxpbmVTZXRSYXcpXG4gICAgICAgICAgICAgICAgcmV0dXJuIGZ1bmN0aW9uICh2YWx1ZSkge1xuICAgICAgICAgICAgICAgICAgICB0aGlzWyBzbG90IF0gPSB2YWx1ZVxuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRoaXNcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICBlbHNlXG4gICAgICAgICAgICAgICAgcmV0dXJuIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIG1lLnNldFJhd1ZhbHVlVG8uYXBwbHkodGhpcywgYXJndW1lbnRzKVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBnZXRHZXR0ZXIgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB2YXIgbWUgICAgICA9IHRoaXNcbiAgICAgICAgICAgIHZhciBzbG90ICAgID0gbWUuc2xvdFxuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAobWUuY2FuSW5saW5lR2V0UmF3KVxuICAgICAgICAgICAgICAgIHJldHVybiBmdW5jdGlvbiAodmFsdWUpIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRoaXNbIHNsb3QgXVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGVsc2VcbiAgICAgICAgICAgICAgICByZXR1cm4gZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gbWUuZ2V0UmF3VmFsdWVGcm9tLmFwcGx5KHRoaXMsIGFyZ3VtZW50cylcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgZ2V0VmFsdWVGcm9tIDogZnVuY3Rpb24gKGluc3RhbmNlKSB7XG4gICAgICAgICAgICB2YXIgZ2V0dGVyTmFtZSAgICAgID0gdGhpcy5nZXR0ZXJOYW1lXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmICh0aGlzLnJlYWRhYmxlICYmIGluc3RhbmNlLm1ldGEuaGFzTWV0aG9kKGdldHRlck5hbWUpKSByZXR1cm4gaW5zdGFuY2VbIGdldHRlck5hbWUgXSgpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHJldHVybiB0aGlzLmdldFJhd1ZhbHVlRnJvbShpbnN0YW5jZSlcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBzZXRWYWx1ZVRvIDogZnVuY3Rpb24gKGluc3RhbmNlLCB2YWx1ZSkge1xuICAgICAgICAgICAgdmFyIHNldHRlck5hbWUgICAgICA9IHRoaXMuc2V0dGVyTmFtZVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAodGhpcy53cml0ZWFibGUgJiYgaW5zdGFuY2UubWV0YS5oYXNNZXRob2Qoc2V0dGVyTmFtZSkpIFxuICAgICAgICAgICAgICAgIGluc3RhbmNlWyBzZXR0ZXJOYW1lIF0odmFsdWUpXG4gICAgICAgICAgICBlbHNlXG4gICAgICAgICAgICAgICAgdGhpcy5zZXRSYXdWYWx1ZVRvKGluc3RhbmNlLCB2YWx1ZSlcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBpbml0RnJvbUNvbmZpZyA6IGZ1bmN0aW9uIChpbnN0YW5jZSwgY29uZmlnKSB7XG4gICAgICAgICAgICB2YXIgbmFtZSAgICAgICAgICAgID0gdGhpcy5uYW1lXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciB2YWx1ZSwgaXNTZXQgPSBmYWxzZVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAoY29uZmlnLmhhc093blByb3BlcnR5KG5hbWUpKSB7XG4gICAgICAgICAgICAgICAgdmFsdWUgPSBjb25maWdbbmFtZV1cbiAgICAgICAgICAgICAgICBpc1NldCA9IHRydWVcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgdmFyIGluaXQgICAgPSB0aGlzLmluaXRcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAvLyBzaW1wbGUgZnVuY3Rpb24gKG5vdCBjbGFzcykgaGFzIGJlZW4gdXNlZCBhcyBcImluaXRcIiB2YWx1ZVxuICAgICAgICAgICAgICAgIGlmIChKb29zZS5PLmlzRnVuY3Rpb24oaW5pdCkgJiYgIUpvb3NlLk8uaXNDbGFzcyhpbml0KSkge1xuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgdmFsdWUgPSBpbml0LmNhbGwoaW5zdGFuY2UsIGNvbmZpZywgbmFtZSlcbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIGlzU2V0ID0gdHJ1ZVxuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKHRoaXMuYnVpbGRlcikge1xuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgdmFsdWUgPSBpbnN0YW5jZVsgdGhpcy5idWlsZGVyLnJlcGxhY2UoL150aGlzXFwuLywgJycpIF0oY29uZmlnLCBuYW1lKVxuICAgICAgICAgICAgICAgICAgICBpc1NldCA9IHRydWVcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmIChpc1NldClcbiAgICAgICAgICAgICAgICB0aGlzLnNldFJhd1ZhbHVlVG8oaW5zdGFuY2UsIHZhbHVlKVxuICAgICAgICAgICAgZWxzZSBcbiAgICAgICAgICAgICAgICBpZiAodGhpcy5yZXF1aXJlZCkgdGhyb3cgbmV3IEVycm9yKFwiUmVxdWlyZWQgYXR0cmlidXRlIFtcIiArIG5hbWUgKyBcIl0gaXMgbWlzc2VkIGR1cmluZyBpbml0aWFsaXphdGlvbiBvZiBcIiArIGluc3RhbmNlKVxuICAgICAgICB9XG4gICAgfVxuXG59KS5jXG47XG5Kb29zZS5NYW5hZ2VkLkF0dHJpYnV0ZS5CdWlsZGVyID0gbmV3IEpvb3NlLk1hbmFnZWQuUm9sZSgnSm9vc2UuTWFuYWdlZC5BdHRyaWJ1dGUuQnVpbGRlcicsIHtcbiAgICBcbiAgICBcbiAgICBoYXZlIDoge1xuICAgICAgICBkZWZhdWx0QXR0cmlidXRlQ2xhc3MgOiBKb29zZS5NYW5hZ2VkLkF0dHJpYnV0ZVxuICAgIH0sXG4gICAgXG4gICAgYnVpbGRlciA6IHtcbiAgICAgICAgXG4gICAgICAgIG1ldGhvZHMgOiB7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGhhcyA6IGZ1bmN0aW9uICh0YXJnZXRDbGFzc01ldGEsIGluZm8pIHtcbiAgICAgICAgICAgICAgICBKb29zZS5PLmVhY2hPd24oaW5mbywgZnVuY3Rpb24gKHByb3BzLCBuYW1lKSB7XG4gICAgICAgICAgICAgICAgICAgIGlmICh0eXBlb2YgcHJvcHMgIT0gJ29iamVjdCcgfHwgcHJvcHMgPT0gbnVsbCB8fCBwcm9wcy5jb25zdHJ1Y3RvciA9PSAvIC8uY29uc3RydWN0b3IpIHByb3BzID0geyBpbml0IDogcHJvcHMgfVxuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgcHJvcHMubWV0YSA9IHByb3BzLm1ldGEgfHwgdGFyZ2V0Q2xhc3NNZXRhLmRlZmF1bHRBdHRyaWJ1dGVDbGFzc1xuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgaWYgKC9eX18vLnRlc3QobmFtZSkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIG5hbWUgPSBuYW1lLnJlcGxhY2UoL15fKy8sICcnKVxuICAgICAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgICAgICBwcm9wcy5pc1ByaXZhdGUgPSB0cnVlXG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIHRhcmdldENsYXNzTWV0YS5hZGRBdHRyaWJ1dGUobmFtZSwgcHJvcHMuaW5pdCwgcHJvcHMpXG4gICAgICAgICAgICAgICAgfSwgdGhpcylcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaGFzbm90IDogZnVuY3Rpb24gKHRhcmdldENsYXNzTWV0YSwgaW5mbykge1xuICAgICAgICAgICAgICAgIHRoaXMuaGF2ZW5vdCh0YXJnZXRDbGFzc01ldGEsIGluZm8pXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGhhc250IDogZnVuY3Rpb24gKHRhcmdldENsYXNzTWV0YSwgaW5mbykge1xuICAgICAgICAgICAgICAgIHRoaXMuaGFzbm90KHRhcmdldENsYXNzTWV0YSwgaW5mbylcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICAgICAgXG4gICAgfVxuICAgIFxufSkuY1xuO1xuSm9vc2UuTWFuYWdlZC5NeSA9IG5ldyBKb29zZS5NYW5hZ2VkLlJvbGUoJ0pvb3NlLk1hbmFnZWQuTXknLCB7XG4gICAgXG4gICAgaGF2ZSA6IHtcbiAgICAgICAgbXlDbGFzcyAgICAgICAgICAgICAgICAgICAgICAgICA6IG51bGwsXG4gICAgICAgIFxuICAgICAgICBuZWVkVG9SZUFsaWFzICAgICAgICAgICAgICAgICAgIDogZmFsc2VcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIG1ldGhvZHMgOiB7XG4gICAgICAgIGNyZWF0ZU15IDogZnVuY3Rpb24gKGV4dGVuZCkge1xuICAgICAgICAgICAgdmFyIHRoaXNNZXRhID0gdGhpcy5tZXRhXG4gICAgICAgICAgICB2YXIgaXNSb2xlID0gdGhpcyBpbnN0YW5jZW9mIEpvb3NlLk1hbmFnZWQuUm9sZVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB2YXIgbXlFeHRlbmQgPSBleHRlbmQubXkgfHwge31cbiAgICAgICAgICAgIGRlbGV0ZSBleHRlbmQubXlcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gU3ltYmlvbnQgd2lsbCBnZW5lcmFsbHkgaGF2ZSB0aGUgc2FtZSBtZXRhIGNsYXNzIGFzIGl0cyBob3N0ZXIsIGV4Y2VwdGluZyB0aGUgY2FzZXMsIHdoZW4gdGhlIHN1cGVyY2xhc3MgYWxzbyBoYXZlIHRoZSBzeW1iaW9udC4gXG4gICAgICAgICAgICAvLyBJbiBzdWNoIGNhc2VzLCB0aGUgbWV0YSBjbGFzcyBmb3Igc3ltYmlvbnQgd2lsbCBiZSBpbmhlcml0ZWQgKHVubGVzcyBleHBsaWNpdGx5IHNwZWNpZmllZClcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdmFyIHN1cGVyQ2xhc3NNeSAgICA9IHRoaXMuc3VwZXJDbGFzcy5tZXRhLm15Q2xhc3NcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKCFpc1JvbGUgJiYgIW15RXh0ZW5kLmlzYSAmJiBzdXBlckNsYXNzTXkpIG15RXh0ZW5kLmlzYSA9IHN1cGVyQ2xhc3NNeVxuICAgICAgICAgICAgXG5cbiAgICAgICAgICAgIGlmICghbXlFeHRlbmQubWV0YSAmJiAhbXlFeHRlbmQuaXNhKSBteUV4dGVuZC5tZXRhID0gdGhpcy5jb25zdHJ1Y3RvclxuICAgICAgICAgICAgXG4gICAgICAgICAgICB2YXIgY3JlYXRlZENsYXNzICAgID0gdGhpcy5teUNsYXNzID0gQ2xhc3MobXlFeHRlbmQpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciBjICAgICAgICAgICAgICAgPSB0aGlzLmNcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgYy5wcm90b3R5cGUubXkgICAgICA9IGMubXkgPSBpc1JvbGUgPyBjcmVhdGVkQ2xhc3MgOiBuZXcgY3JlYXRlZENsYXNzKHsgSE9TVCA6IGMgfSlcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpcy5uZWVkVG9SZUFsaWFzID0gdHJ1ZVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIGFsaWFzU3RhdGljTWV0aG9kcyA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHRoaXMubmVlZFRvUmVBbGlhcyA9IGZhbHNlXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciBjICAgICAgICAgICA9IHRoaXMuY1xuICAgICAgICAgICAgdmFyIG15UHJvdG8gICAgID0gdGhpcy5teUNsYXNzLnByb3RvdHlwZVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBKb29zZS5PLmVhY2hPd24oYywgZnVuY3Rpb24gKHByb3BlcnR5LCBuYW1lKSB7XG4gICAgICAgICAgICAgICAgaWYgKHByb3BlcnR5LklTX0FMSUFTKSBkZWxldGUgY1sgbmFtZSBdIFxuICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpcy5teUNsYXNzLm1ldGEuc3RlbS5wcm9wZXJ0aWVzLm1ldGhvZHMuZWFjaChmdW5jdGlvbiAobWV0aG9kLCBuYW1lKSB7XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgaWYgKCFjWyBuYW1lIF0pXG4gICAgICAgICAgICAgICAgICAgIChjWyBuYW1lIF0gPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gbXlQcm90b1sgbmFtZSBdLmFwcGx5KGMubXksIGFyZ3VtZW50cylcbiAgICAgICAgICAgICAgICAgICAgfSkuSVNfQUxJQVMgPSB0cnVlXG4gICAgICAgICAgICB9KVxuICAgICAgICB9XG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBvdmVycmlkZSA6IHtcbiAgICAgICAgXG4gICAgICAgIGV4dGVuZCA6IGZ1bmN0aW9uIChwcm9wcykge1xuICAgICAgICAgICAgdmFyIG15Q2xhc3MgPSB0aGlzLm15Q2xhc3NcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKCFteUNsYXNzICYmIHRoaXMuc3VwZXJDbGFzcy5tZXRhLm15Q2xhc3MpIHRoaXMuY3JlYXRlTXkocHJvcHMpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmIChwcm9wcy5teSkge1xuICAgICAgICAgICAgICAgIGlmICghbXlDbGFzcykgXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuY3JlYXRlTXkocHJvcHMpXG4gICAgICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMubmVlZFRvUmVBbGlhcyA9IHRydWVcbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIG15Q2xhc3MubWV0YS5leHRlbmQocHJvcHMubXkpXG4gICAgICAgICAgICAgICAgICAgIGRlbGV0ZSBwcm9wcy5teVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpcy5TVVBFUihwcm9wcylcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKHRoaXMubmVlZFRvUmVBbGlhcyAmJiAhKHRoaXMgaW5zdGFuY2VvZiBKb29zZS5NYW5hZ2VkLlJvbGUpKSB0aGlzLmFsaWFzU3RhdGljTWV0aG9kcygpXG4gICAgICAgIH0gIFxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgYmVmb3JlIDoge1xuICAgICAgICBcbiAgICAgICAgYWRkUm9sZSA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHZhciBteVN0ZW1cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgSm9vc2UuQS5lYWNoKGFyZ3VtZW50cywgZnVuY3Rpb24gKGFyZykge1xuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIGlmICghYXJnKSB0aHJvdyBuZXcgRXJyb3IoXCJBdHRlbXB0IHRvIGNvbnN1bWUgYW4gdW5kZWZpbmVkIFJvbGUgaW50byBbXCIgKyB0aGlzLm5hbWUgKyBcIl1cIilcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAvL2luc3RhbmNlb2YgQ2xhc3MgdG8gYWxsb3cgdHJlYXQgY2xhc3NlcyBhcyByb2xlc1xuICAgICAgICAgICAgICAgIHZhciByb2xlID0gKGFyZy5tZXRhIGluc3RhbmNlb2YgSm9vc2UuTWFuYWdlZC5DbGFzcykgPyBhcmcgOiBhcmcucm9sZVxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIGlmIChyb2xlLm1ldGEubWV0YS5oYXNBdHRyaWJ1dGUoJ215Q2xhc3MnKSAmJiByb2xlLm1ldGEubXlDbGFzcykge1xuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgaWYgKCF0aGlzLm15Q2xhc3MpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuY3JlYXRlTXkoe1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG15IDoge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBkb2VzIDogcm9sZS5tZXRhLm15Q2xhc3NcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuXG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIG15U3RlbSA9IHRoaXMubXlDbGFzcy5tZXRhLnN0ZW1cbiAgICAgICAgICAgICAgICAgICAgaWYgKCFteVN0ZW0ub3BlbmVkKSBteVN0ZW0ub3BlbigpXG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICBteVN0ZW0uYWRkQ29tcG9zZUluZm8ocm9sZS5teS5tZXRhLnN0ZW0pXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSwgdGhpcylcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKG15U3RlbSkge1xuICAgICAgICAgICAgICAgIG15U3RlbS5jbG9zZSgpXG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgdGhpcy5uZWVkVG9SZUFsaWFzID0gdHJ1ZVxuICAgICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIHJlbW92ZVJvbGUgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBpZiAoIXRoaXMubXlDbGFzcykgcmV0dXJuXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciBteVN0ZW0gPSB0aGlzLm15Q2xhc3MubWV0YS5zdGVtXG4gICAgICAgICAgICBteVN0ZW0ub3BlbigpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIEpvb3NlLkEuZWFjaChhcmd1bWVudHMsIGZ1bmN0aW9uIChyb2xlKSB7XG4gICAgICAgICAgICAgICAgaWYgKHJvbGUubWV0YS5tZXRhLmhhc0F0dHJpYnV0ZSgnbXlDbGFzcycpICYmIHJvbGUubWV0YS5teUNsYXNzKSB7XG4gICAgICAgICAgICAgICAgICAgIG15U3RlbS5yZW1vdmVDb21wb3NlSW5mbyhyb2xlLm15Lm1ldGEuc3RlbSlcbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIHRoaXMubmVlZFRvUmVBbGlhcyA9IHRydWVcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9LCB0aGlzKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBteVN0ZW0uY2xvc2UoKVxuICAgICAgICB9XG4gICAgICAgIFxuICAgIH1cbiAgICBcbn0pLmM7XG5Kb29zZS5OYW1lc3BhY2UgPSBKb29zZS5zdHViKClcblxuSm9vc2UuTmFtZXNwYWNlLkFibGUgPSBuZXcgSm9vc2UuTWFuYWdlZC5Sb2xlKCdKb29zZS5OYW1lc3BhY2UuQWJsZScsIHtcblxuICAgIGhhdmUgOiB7XG4gICAgICAgIGJvZHlGdW5jICAgICAgICAgICAgICAgIDogbnVsbFxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgYmVmb3JlIDoge1xuICAgICAgICBleHRlbmQgOiBmdW5jdGlvbiAoZXh0ZW5kKSB7XG4gICAgICAgICAgICBpZiAoZXh0ZW5kLmJvZHkpIHtcbiAgICAgICAgICAgICAgICB0aGlzLmJvZHlGdW5jID0gZXh0ZW5kLmJvZHlcbiAgICAgICAgICAgICAgICBkZWxldGUgZXh0ZW5kLmJvZHlcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgYWZ0ZXI6IHtcbiAgICAgICAgXG4gICAgICAgIGFmdGVyTXV0YXRlIDogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgdmFyIGJvZHlGdW5jID0gdGhpcy5ib2R5RnVuY1xuICAgICAgICAgICAgZGVsZXRlIHRoaXMuYm9keUZ1bmNcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKGJvZHlGdW5jKSBKb29zZS5OYW1lc3BhY2UuTWFuYWdlci5teS5leGVjdXRlSW4odGhpcy5jLCBib2R5RnVuYylcbiAgICAgICAgfVxuICAgIH1cbiAgICBcbn0pLmM7XG5Kb29zZS5NYW5hZ2VkLkJvb3RzdHJhcCA9IG5ldyBKb29zZS5NYW5hZ2VkLlJvbGUoJ0pvb3NlLk1hbmFnZWQuQm9vdHN0cmFwJywge1xuICAgIFxuICAgIGRvZXMgICA6IFsgSm9vc2UuTmFtZXNwYWNlLkFibGUsIEpvb3NlLk1hbmFnZWQuTXksIEpvb3NlLk1hbmFnZWQuQXR0cmlidXRlLkJ1aWxkZXIgXVxuICAgIFxufSkuY1xuO1xuSm9vc2UuTWV0YSA9IEpvb3NlLnN0dWIoKVxuXG5cbkpvb3NlLk1ldGEuT2JqZWN0ID0gbmV3IEpvb3NlLlByb3RvLkNsYXNzKCdKb29zZS5NZXRhLk9iamVjdCcsIHtcbiAgICBcbiAgICBpc2EgICAgICAgICAgICAgOiBKb29zZS5Qcm90by5PYmplY3RcbiAgICBcbn0pLmNcblxuXG47XG5Kb29zZS5NZXRhLkNsYXNzID0gbmV3IEpvb3NlLk1hbmFnZWQuQ2xhc3MoJ0pvb3NlLk1ldGEuQ2xhc3MnLCB7XG4gICAgXG4gICAgaXNhICAgICAgICAgICAgICAgICAgICAgICAgIDogSm9vc2UuTWFuYWdlZC5DbGFzcyxcbiAgICBcbiAgICBkb2VzICAgICAgICAgICAgICAgICAgICAgICAgOiBKb29zZS5NYW5hZ2VkLkJvb3RzdHJhcCxcbiAgICBcbiAgICBoYXZlIDoge1xuICAgICAgICBkZWZhdWx0U3VwZXJDbGFzcyAgICAgICA6IEpvb3NlLk1ldGEuT2JqZWN0XG4gICAgfVxuICAgIFxufSkuY1xuXG47XG5Kb29zZS5NZXRhLlJvbGUgPSBuZXcgSm9vc2UuTWV0YS5DbGFzcygnSm9vc2UuTWV0YS5Sb2xlJywge1xuICAgIFxuICAgIGlzYSAgICAgICAgICAgICAgICAgICAgICAgICA6IEpvb3NlLk1hbmFnZWQuUm9sZSxcbiAgICBcbiAgICBkb2VzICAgICAgICAgICAgICAgICAgICAgICAgOiBKb29zZS5NYW5hZ2VkLkJvb3RzdHJhcFxuICAgIFxufSkuYztcbkpvb3NlLk5hbWVzcGFjZS5LZWVwZXIgPSBuZXcgSm9vc2UuTWV0YS5DbGFzcygnSm9vc2UuTmFtZXNwYWNlLktlZXBlcicsIHtcbiAgICBcbiAgICBpc2EgICAgICAgICA6IEpvb3NlLk1ldGEuQ2xhc3MsXG4gICAgXG4gICAgaGF2ZSAgICAgICAgOiB7XG4gICAgICAgIGV4dGVybmFsQ29uc3RydWN0b3IgICAgICAgICAgICAgOiBudWxsXG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBtZXRob2RzOiB7XG4gICAgICAgIFxuICAgICAgICBkZWZhdWx0Q29uc3RydWN0b3I6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcmV0dXJuIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgICAvL2NvbnN0cnVjdG9ycyBzaG91bGQgYXNzdW1lIHRoYXQgbWV0YSBpcyBhdHRhY2hlZCB0byAnYXJndW1lbnRzLmNhbGxlZScgKG5vdCB0byAndGhpcycpIFxuICAgICAgICAgICAgICAgIHZhciB0aGlzTWV0YSA9IGFyZ3VtZW50cy5jYWxsZWUubWV0YVxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIGlmICh0aGlzTWV0YSBpbnN0YW5jZW9mIEpvb3NlLk5hbWVzcGFjZS5LZWVwZXIpIHRocm93IG5ldyBFcnJvcihcIk1vZHVsZSBbXCIgKyB0aGlzTWV0YS5jICsgXCJdIG1heSBub3QgYmUgaW5zdGFudGlhdGVkLiBGb3Jnb3QgdG8gJ3VzZScgdGhlIGNsYXNzIHdpdGggdGhlIHNhbWUgbmFtZT9cIilcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICB2YXIgZXh0ZXJuYWxDb25zdHJ1Y3RvciA9IHRoaXNNZXRhLmV4dGVybmFsQ29uc3RydWN0b3JcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBpZiAodHlwZW9mIGV4dGVybmFsQ29uc3RydWN0b3IgPT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgZXh0ZXJuYWxDb25zdHJ1Y3Rvci5tZXRhID0gdGhpc01ldGFcbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBleHRlcm5hbENvbnN0cnVjdG9yLmFwcGx5KHRoaXMsIGFyZ3VtZW50cylcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgdGhyb3cgXCJOYW1lc3BhY2VLZWVwZXIgb2YgW1wiICsgdGhpc01ldGEubmFtZSArIFwiXSB3YXMgcGxhbnRlZCBpbmNvcnJlY3RseS5cIlxuICAgICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIC8vd2l0aENsYXNzIHNob3VsZCBiZSBub3QgY29uc3RydWN0ZWQgeWV0IG9uIHRoaXMgc3RhZ2UgKHNlZSBKb29zZS5Qcm90by5DbGFzcy5jb25zdHJ1Y3QpXG4gICAgICAgIC8vaXQgc2hvdWxkIGJlIG9uIHRoZSAnY29uc3RydWN0b3JPbmx5JyBsaWZlIHN0YWdlIChzaG91bGQgYWxyZWFkeSBoYXZlIGNvbnN0cnVjdG9yKVxuICAgICAgICBwbGFudDogZnVuY3Rpb24gKHdpdGhDbGFzcykge1xuICAgICAgICAgICAgdmFyIGtlZXBlciA9IHRoaXMuY1xuICAgICAgICAgICAgXG4gICAgICAgICAgICBrZWVwZXIubWV0YSA9IHdpdGhDbGFzcy5tZXRhXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGtlZXBlci5tZXRhLmMgPSBrZWVwZXJcbiAgICAgICAgICAgIGtlZXBlci5tZXRhLmV4dGVybmFsQ29uc3RydWN0b3IgPSB3aXRoQ2xhc3NcbiAgICAgICAgfVxuICAgIH1cbiAgICBcbn0pLmNcblxuXG47XG5Kb29zZS5OYW1lc3BhY2UuTWFuYWdlciA9IG5ldyBKb29zZS5NYW5hZ2VkLkNsYXNzKCdKb29zZS5OYW1lc3BhY2UuTWFuYWdlcicsIHtcbiAgICBcbiAgICBoYXZlIDoge1xuICAgICAgICBjdXJyZW50ICAgICA6IG51bGxcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIG1ldGhvZHMgOiB7XG4gICAgICAgIFxuICAgICAgICBpbml0aWFsaXplIDogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgdGhpcy5jdXJyZW50ICAgID0gWyBKb29zZS50b3AgXVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIGdldEN1cnJlbnQ6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLmN1cnJlbnRbMF1cbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBleGVjdXRlSW4gOiBmdW5jdGlvbiAobnMsIGZ1bmMpIHtcbiAgICAgICAgICAgIHZhciBjdXJyZW50ID0gdGhpcy5jdXJyZW50XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGN1cnJlbnQudW5zaGlmdChucylcbiAgICAgICAgICAgIHZhciByZXMgPSBmdW5jLmNhbGwobnMsIG5zKVxuICAgICAgICAgICAgY3VycmVudC5zaGlmdCgpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHJldHVybiByZXNcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBlYXJseUNyZWF0ZSA6IGZ1bmN0aW9uIChuYW1lLCBtZXRhQ2xhc3MsIHByb3BzKSB7XG4gICAgICAgICAgICBwcm9wcy5jb25zdHJ1Y3Rvck9ubHkgPSB0cnVlXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHJldHVybiBuZXcgbWV0YUNsYXNzKG5hbWUsIHByb3BzKS5jXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgLy90aGlzIGZ1bmN0aW9uIGVzdGFibGlzaGluZyB0aGUgZnVsbCBcIm5hbWVzcGFjZSBjaGFpblwiIChpbmNsdWRpbmcgdGhlIGxhc3QgZWxlbWVudClcbiAgICAgICAgY3JlYXRlIDogZnVuY3Rpb24gKG5zTmFtZSwgbWV0YUNsYXNzLCBleHRlbmQpIHtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy9pZiBubyBuYW1lIHByb3ZpZGVkLCB0aGVuIHdlIGNyZWF0aW5nIGFuIGFub255bW91cyBjbGFzcywgc28ganVzdCBza2lwIGFsbCB0aGUgbmFtZXNwYWNlIG1hbmlwdWxhdGlvbnNcbiAgICAgICAgICAgIGlmICghbnNOYW1lKSByZXR1cm4gbmV3IG1ldGFDbGFzcyhuc05hbWUsIGV4dGVuZCkuY1xuICAgICAgICAgICAgXG4gICAgICAgICAgICB2YXIgbWUgPSB0aGlzXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmICgvXlxcLi8udGVzdChuc05hbWUpKSByZXR1cm4gdGhpcy5leGVjdXRlSW4oSm9vc2UudG9wLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIG1lLmNyZWF0ZShuc05hbWUucmVwbGFjZSgvXlxcLi8sICcnKSwgbWV0YUNsYXNzLCBleHRlbmQpXG4gICAgICAgICAgICB9KVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB2YXIgcHJvcHMgICA9IGV4dGVuZCB8fCB7fVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB2YXIgcGFydHMgICA9IEpvb3NlLlMuc2FuZVNwbGl0KG5zTmFtZSwgJy4nKVxuICAgICAgICAgICAgdmFyIG9iamVjdCAgPSB0aGlzLmdldEN1cnJlbnQoKVxuICAgICAgICAgICAgdmFyIHNvRmFyICAgPSBvYmplY3QgPT0gSm9vc2UudG9wID8gW10gOiBKb29zZS5TLnNhbmVTcGxpdChvYmplY3QubWV0YS5uYW1lLCAnLicpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgcGFydHMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgICAgICB2YXIgcGFydCAgICAgICAgPSBwYXJ0c1tpXVxuICAgICAgICAgICAgICAgIHZhciBpc0xhc3QgICAgICA9IGkgPT0gcGFydHMubGVuZ3RoIC0gMVxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIGlmIChwYXJ0ID09IFwibWV0YVwiIHx8IHBhcnQgPT0gXCJteVwiIHx8ICFwYXJ0KSB0aHJvdyBcIk1vZHVsZSBuYW1lIFtcIiArIG5zTmFtZSArIFwiXSBtYXkgbm90IGluY2x1ZGUgYSBwYXJ0IGNhbGxlZCAnbWV0YScgb3IgJ215JyBvciBlbXB0eSBwYXJ0LlwiXG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgdmFyIGN1ciA9ICAgb2JqZWN0W3BhcnRdXG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgc29GYXIucHVzaChwYXJ0KVxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIHZhciBzb0Zhck5hbWUgICAgICAgPSBzb0Zhci5qb2luKFwiLlwiKVxuICAgICAgICAgICAgICAgIHZhciBuZWVkRmluYWxpemUgICAgPSBmYWxzZVxuICAgICAgICAgICAgICAgIHZhciBuc0tlZXBlclxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIC8vIGlmIHRoZSBuYW1lc3BhY2Ugc2VnbWVudCBpcyBlbXB0eVxuICAgICAgICAgICAgICAgIGlmICh0eXBlb2YgY3VyID09IFwidW5kZWZpbmVkXCIpIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGlzTGFzdCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgLy8gcGVyZm9ybSBcImVhcmx5IGNyZWF0ZVwiIHdoaWNoIGp1c3QgZmlsbHMgdGhlIG5hbWVzcGFjZSBzZWdtZW50IHdpdGggcmlnaHQgY29uc3RydWN0b3JcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIHRoaXMgYWxsb3dzIHVzIHRvIGhhdmUgYSByaWdodCBjb25zdHJ1Y3RvciBpbiB0aGUgbmFtZXNwYWNlIHNlZ21lbnQgd2hlbiB0aGUgYGJvZHlgIHdpbGwgYmUgY2FsbGVkXG4gICAgICAgICAgICAgICAgICAgICAgICBuc0tlZXBlciAgICAgICAgPSB0aGlzLmVhcmx5Q3JlYXRlKHNvRmFyTmFtZSwgbWV0YUNsYXNzLCBwcm9wcylcbiAgICAgICAgICAgICAgICAgICAgICAgIG5lZWRGaW5hbGl6ZSAgICA9IHRydWVcbiAgICAgICAgICAgICAgICAgICAgfSBlbHNlXG4gICAgICAgICAgICAgICAgICAgICAgICBuc0tlZXBlciAgICAgICAgPSBuZXcgSm9vc2UuTmFtZXNwYWNlLktlZXBlcihzb0Zhck5hbWUpLmNcbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIG9iamVjdFtwYXJ0XSA9IG5zS2VlcGVyXG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICBjdXIgPSBuc0tlZXBlclxuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKGlzTGFzdCAmJiBjdXIgJiYgY3VyLm1ldGEpIHtcbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIHZhciBjdXJyZW50TWV0YSA9IGN1ci5tZXRhXG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICBpZiAobWV0YUNsYXNzID09IEpvb3NlLk5hbWVzcGFjZS5LZWVwZXIpXG4gICAgICAgICAgICAgICAgICAgICAgICAvL2BNb2R1bGVgIG92ZXIgc29tZXRoaW5nIGNhc2UgLSBleHRlbmQgdGhlIG9yaWdpbmFsXG4gICAgICAgICAgICAgICAgICAgICAgICBjdXJyZW50TWV0YS5leHRlbmQocHJvcHMpXG4gICAgICAgICAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoY3VycmVudE1ldGEgaW5zdGFuY2VvZiBKb29zZS5OYW1lc3BhY2UuS2VlcGVyKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY3VycmVudE1ldGEucGxhbnQodGhpcy5lYXJseUNyZWF0ZShzb0Zhck5hbWUsIG1ldGFDbGFzcywgcHJvcHMpKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG5lZWRGaW5hbGl6ZSA9IHRydWVcbiAgICAgICAgICAgICAgICAgICAgICAgIH0gZWxzZVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcIkRvdWJsZSBkZWNsYXJhdGlvbiBvZiBbXCIgKyBzb0Zhck5hbWUgKyBcIl1cIilcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICB9IGVsc2UgXG4gICAgICAgICAgICAgICAgICAgIGlmIChpc0xhc3QgJiYgIShjdXIgJiYgY3VyLm1ldGEgJiYgY3VyLm1ldGEubWV0YSkpIHRocm93IFwiVHJ5aW5nIHRvIHNldHVwIG1vZHVsZSBcIiArIHNvRmFyTmFtZSArIFwiIGZhaWxlZC4gVGhlcmUgaXMgYWxyZWFkeSBzb21ldGhpbmc6IFwiICsgY3VyXG5cbiAgICAgICAgICAgICAgICAvLyBob29rIHRvIGFsbG93IGVtYmVkZCByZXNvdXJjZSBpbnRvIG1ldGFcbiAgICAgICAgICAgICAgICBpZiAoaXNMYXN0KSB0aGlzLnByZXBhcmVNZXRhKGN1ci5tZXRhKVxuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBpZiAobmVlZEZpbmFsaXplKSBjdXIubWV0YS5jb25zdHJ1Y3QocHJvcHMpXG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIG9iamVjdCA9IGN1clxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgXG4gICAgICAgICAgICByZXR1cm4gb2JqZWN0XG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgcHJlcGFyZU1ldGEgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgcHJlcGFyZVByb3BlcnRpZXMgOiBmdW5jdGlvbiAobmFtZSwgcHJvcHMsIGRlZmF1bHRNZXRhLCBjYWxsYmFjaykge1xuICAgICAgICAgICAgaWYgKG5hbWUgJiYgdHlwZW9mIG5hbWUgIT0gJ3N0cmluZycpIHtcbiAgICAgICAgICAgICAgICBwcm9wcyAgID0gbmFtZVxuICAgICAgICAgICAgICAgIG5hbWUgICAgPSBudWxsXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciBtZXRhXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmIChwcm9wcyAmJiBwcm9wcy5tZXRhKSB7XG4gICAgICAgICAgICAgICAgbWV0YSA9IHByb3BzLm1ldGFcbiAgICAgICAgICAgICAgICBkZWxldGUgcHJvcHMubWV0YVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAoIW1ldGEpXG4gICAgICAgICAgICAgICAgaWYgKHByb3BzICYmIHR5cGVvZiBwcm9wcy5pc2EgPT0gJ2Z1bmN0aW9uJyAmJiBwcm9wcy5pc2EubWV0YSlcbiAgICAgICAgICAgICAgICAgICAgbWV0YSA9IHByb3BzLmlzYS5tZXRhLmNvbnN0cnVjdG9yXG4gICAgICAgICAgICAgICAgZWxzZVxuICAgICAgICAgICAgICAgICAgICBtZXRhID0gZGVmYXVsdE1ldGFcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcmV0dXJuIGNhbGxiYWNrLmNhbGwodGhpcywgbmFtZSwgbWV0YSwgcHJvcHMpXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgZ2V0RGVmYXVsdEhlbHBlckZvciA6IGZ1bmN0aW9uIChtZXRhQ2xhc3MpIHtcbiAgICAgICAgICAgIHZhciBtZSA9IHRoaXNcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcmV0dXJuIGZ1bmN0aW9uIChuYW1lLCBwcm9wcykge1xuICAgICAgICAgICAgICAgIHJldHVybiBtZS5wcmVwYXJlUHJvcGVydGllcyhuYW1lLCBwcm9wcywgbWV0YUNsYXNzLCBmdW5jdGlvbiAobmFtZSwgbWV0YSwgcHJvcHMpIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIG1lLmNyZWF0ZShuYW1lLCBtZXRhLCBwcm9wcylcbiAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgXG4gICAgICAgIHJlZ2lzdGVyIDogZnVuY3Rpb24gKGhlbHBlck5hbWUsIG1ldGFDbGFzcywgZnVuYykge1xuICAgICAgICAgICAgdmFyIG1lID0gdGhpc1xuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAodGhpcy5tZXRhLmhhc01ldGhvZChoZWxwZXJOYW1lKSkge1xuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIHZhciBoZWxwZXIgPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBtZVsgaGVscGVyTmFtZSBdLmFwcGx5KG1lLCBhcmd1bWVudHMpXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIGlmICghSm9vc2UudG9wWyBoZWxwZXJOYW1lIF0pICAgSm9vc2UudG9wWyBoZWxwZXJOYW1lIF0gICAgICAgICA9IGhlbHBlclxuICAgICAgICAgICAgICAgIGlmICghSm9vc2VbIGhlbHBlck5hbWUgXSkgICAgICAgSm9vc2VbIGhlbHBlck5hbWUgXSAgICAgICAgICAgICA9IGhlbHBlclxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIGlmIChKb29zZS5pc19Ob2RlSlMgJiYgdHlwZW9mIGV4cG9ydHMgIT0gJ3VuZGVmaW5lZCcpICAgICAgICAgICAgZXhwb3J0c1sgaGVscGVyTmFtZSBdICAgID0gaGVscGVyXG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHZhciBtZXRob2RzID0ge31cbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBtZXRob2RzWyBoZWxwZXJOYW1lIF0gPSBmdW5jIHx8IHRoaXMuZ2V0RGVmYXVsdEhlbHBlckZvcihtZXRhQ2xhc3MpXG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgdGhpcy5tZXRhLmV4dGVuZCh7XG4gICAgICAgICAgICAgICAgICAgIG1ldGhvZHMgOiBtZXRob2RzXG4gICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICB0aGlzLnJlZ2lzdGVyKGhlbHBlck5hbWUpXG4gICAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgTW9kdWxlIDogZnVuY3Rpb24gKG5hbWUsIHByb3BzKSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5wcmVwYXJlUHJvcGVydGllcyhuYW1lLCBwcm9wcywgSm9vc2UuTmFtZXNwYWNlLktlZXBlciwgZnVuY3Rpb24gKG5hbWUsIG1ldGEsIHByb3BzKSB7XG4gICAgICAgICAgICAgICAgaWYgKHR5cGVvZiBwcm9wcyA9PSAnZnVuY3Rpb24nKSBwcm9wcyA9IHsgYm9keSA6IHByb3BzIH0gICAgXG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuY3JlYXRlKG5hbWUsIG1ldGEsIHByb3BzKVxuICAgICAgICAgICAgfSlcbiAgICAgICAgfVxuICAgIH1cbiAgICBcbn0pLmNcblxuSm9vc2UuTmFtZXNwYWNlLk1hbmFnZXIubXkgPSBuZXcgSm9vc2UuTmFtZXNwYWNlLk1hbmFnZXIoKVxuXG5Kb29zZS5OYW1lc3BhY2UuTWFuYWdlci5teS5yZWdpc3RlcignQ2xhc3MnLCBKb29zZS5NZXRhLkNsYXNzKVxuSm9vc2UuTmFtZXNwYWNlLk1hbmFnZXIubXkucmVnaXN0ZXIoJ1JvbGUnLCBKb29zZS5NZXRhLlJvbGUpXG5Kb29zZS5OYW1lc3BhY2UuTWFuYWdlci5teS5yZWdpc3RlcignTW9kdWxlJylcblxuXG4vLyBmb3IgdGhlIHJlc3Qgb2YgdGhlIHBhY2thZ2VcbnZhciBDbGFzcyAgICAgICA9IEpvb3NlLkNsYXNzXG52YXIgUm9sZSAgICAgICAgPSBKb29zZS5Sb2xlXG47XG5Sb2xlKCdKb29zZS5BdHRyaWJ1dGUuRGVsZWdhdGUnLCB7XG4gICAgXG4gICAgaGF2ZSA6IHtcbiAgICAgICAgaGFuZGxlcyA6IG51bGxcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIG92ZXJyaWRlIDoge1xuICAgICAgICBcbiAgICAgICAgZWFjaERlbGVnYXRlIDogZnVuY3Rpb24gKGhhbmRsZXMsIGZ1bmMsIHNjb3BlKSB7XG4gICAgICAgICAgICBpZiAodHlwZW9mIGhhbmRsZXMgPT0gJ3N0cmluZycpIHJldHVybiBmdW5jLmNhbGwoc2NvcGUsIGhhbmRsZXMsIGhhbmRsZXMpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmIChoYW5kbGVzIGluc3RhbmNlb2YgQXJyYXkpXG4gICAgICAgICAgICAgICAgcmV0dXJuIEpvb3NlLkEuZWFjaChoYW5kbGVzLCBmdW5jdGlvbiAoZGVsZWdhdGVUbykge1xuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgZnVuYy5jYWxsKHNjb3BlLCBkZWxlZ2F0ZVRvLCBkZWxlZ2F0ZVRvKVxuICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAoaGFuZGxlcyA9PT0gT2JqZWN0KGhhbmRsZXMpKVxuICAgICAgICAgICAgICAgIEpvb3NlLk8uZWFjaE93bihoYW5kbGVzLCBmdW5jdGlvbiAoZGVsZWdhdGVUbywgaGFuZGxlQXMpIHtcbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIGZ1bmMuY2FsbChzY29wZSwgaGFuZGxlQXMsIGRlbGVnYXRlVG8pXG4gICAgICAgICAgICAgICAgfSlcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIFxuICAgICAgICBnZXRBY2Nlc3NvcnNGb3IgOiBmdW5jdGlvbiAodGFyZ2V0Q2xhc3MpIHtcbiAgICAgICAgICAgIHZhciB0YXJnZXRNZXRhICA9IHRhcmdldENsYXNzLm1ldGFcbiAgICAgICAgICAgIHZhciBtZXRob2RzICAgICA9IHRoaXMuU1VQRVIodGFyZ2V0Q2xhc3MpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciBtZSAgICAgID0gdGhpc1xuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLmVhY2hEZWxlZ2F0ZSh0aGlzLmhhbmRsZXMsIGZ1bmN0aW9uIChoYW5kbGVBcywgZGVsZWdhdGVUbykge1xuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIGlmICghdGFyZ2V0TWV0YS5oYXNNZXRob2QoaGFuZGxlQXMpKSB7XG4gICAgICAgICAgICAgICAgICAgIHZhciBoYW5kbGVyID0gbWV0aG9kc1sgaGFuZGxlQXMgXSA9IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHZhciBhdHRyVmFsdWUgPSBtZS5nZXRWYWx1ZUZyb20odGhpcylcbiAgICAgICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGF0dHJWYWx1ZVsgZGVsZWdhdGVUbyBdLmFwcGx5KGF0dHJWYWx1ZSwgYXJndW1lbnRzKVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICBoYW5kbGVyLkFDQ0VTU09SX0ZST00gPSBtZVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHJldHVybiBtZXRob2RzXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgZ2V0QWNjZXNzb3JzRnJvbSA6IGZ1bmN0aW9uIChmcm9tKSB7XG4gICAgICAgICAgICB2YXIgbWV0aG9kcyA9IHRoaXMuU1VQRVIoZnJvbSlcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdmFyIG1lICAgICAgICAgID0gdGhpc1xuICAgICAgICAgICAgdmFyIHRhcmdldE1ldGEgID0gZnJvbS5tZXRhXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXMuZWFjaERlbGVnYXRlKHRoaXMuaGFuZGxlcywgZnVuY3Rpb24gKGhhbmRsZUFzKSB7XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgdmFyIGhhbmRsZXIgPSB0YXJnZXRNZXRhLmdldE1ldGhvZChoYW5kbGVBcylcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBpZiAoaGFuZGxlciAmJiBoYW5kbGVyLnZhbHVlLkFDQ0VTU09SX0ZST00gPT0gbWUpIG1ldGhvZHMucHVzaChoYW5kbGVBcylcbiAgICAgICAgICAgIH0pXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHJldHVybiBtZXRob2RzXG4gICAgICAgIH1cbiAgICB9XG59KVxuXG47XG5Sb2xlKCdKb29zZS5BdHRyaWJ1dGUuVHJpZ2dlcicsIHtcbiAgICBcbiAgICBoYXZlIDoge1xuICAgICAgICB0cmlnZ2VyICAgICAgICA6IG51bGxcbiAgICB9LCBcblxuICAgIFxuICAgIGFmdGVyIDoge1xuICAgICAgICBpbml0aWFsaXplIDogZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICBpZiAodGhpcy50cmlnZ2VyKSB7XG4gICAgICAgICAgICAgICAgaWYgKCF0aGlzLndyaXRlYWJsZSkgdGhyb3cgbmV3IEVycm9yKFwiQ2FuJ3QgdXNlIGB0cmlnZ2VyYCBmb3IgcmVhZC1vbmx5IGF0dHJpYnV0ZXNcIilcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICB0aGlzLmhhc1NldHRlciA9IHRydWVcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgb3ZlcnJpZGUgOiB7XG4gICAgICAgIFxuICAgICAgICBnZXRTZXR0ZXIgOiBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgIHZhciBvcmlnaW5hbCAgICA9IHRoaXMuU1VQRVIoKVxuICAgICAgICAgICAgdmFyIHRyaWdnZXIgICAgID0gdGhpcy50cmlnZ2VyXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmICghdHJpZ2dlcikgcmV0dXJuIG9yaWdpbmFsXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHZhciBtZSAgICAgID0gdGhpc1xuICAgICAgICAgICAgdmFyIGluaXQgICAgPSBKb29zZS5PLmlzRnVuY3Rpb24obWUuaW5pdCkgPyBudWxsIDogbWUuaW5pdFxuICAgICAgICAgICAgXG4gICAgICAgICAgICByZXR1cm4gZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgIHZhciBvbGRWYWx1ZSAgICA9IG1lLmhhc1ZhbHVlKHRoaXMpID8gbWUuZ2V0VmFsdWVGcm9tKHRoaXMpIDogaW5pdFxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIHZhciByZXMgICAgICAgICA9IG9yaWdpbmFsLmFwcGx5KHRoaXMsIGFyZ3VtZW50cylcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICB0cmlnZ2VyLmNhbGwodGhpcywgbWUuZ2V0VmFsdWVGcm9tKHRoaXMpLCBvbGRWYWx1ZSlcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICByZXR1cm4gcmVzXG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG59KSAgICBcblxuO1xuUm9sZSgnSm9vc2UuQXR0cmlidXRlLkxhenknLCB7XG4gICAgXG4gICAgXG4gICAgaGF2ZSA6IHtcbiAgICAgICAgbGF6eSAgICAgICAgOiBudWxsXG4gICAgfSwgXG4gICAgXG4gICAgXG4gICAgYmVmb3JlIDoge1xuICAgICAgICBjb21wdXRlVmFsdWUgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBpZiAodHlwZW9mIHRoaXMuaW5pdCA9PSAnZnVuY3Rpb24nICYmIHRoaXMubGF6eSkge1xuICAgICAgICAgICAgICAgIHRoaXMubGF6eSA9IHRoaXMuaW5pdCAgICBcbiAgICAgICAgICAgICAgICBkZWxldGUgdGhpcy5pbml0ICAgIFxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfSxcbiAgICBcbiAgICBcbiAgICBhZnRlciA6IHtcbiAgICAgICAgaW5pdGlhbGl6ZSA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIGlmICh0aGlzLmxhenkpIHRoaXMucmVhZGFibGUgPSB0aGlzLmhhc0dldHRlciA9IHRydWVcbiAgICAgICAgfVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgb3ZlcnJpZGUgOiB7XG4gICAgICAgIFxuICAgICAgICBnZXRHZXR0ZXIgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB2YXIgb3JpZ2luYWwgICAgPSB0aGlzLlNVUEVSKClcbiAgICAgICAgICAgIHZhciBsYXp5ICAgICAgICA9IHRoaXMubGF6eVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAoIWxhenkpIHJldHVybiBvcmlnaW5hbFxuICAgICAgICAgICAgXG4gICAgICAgICAgICB2YXIgbWUgICAgICA9IHRoaXMgICAgXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHJldHVybiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgICAgaWYgKCFtZS5oYXNWYWx1ZSh0aGlzKSkge1xuICAgICAgICAgICAgICAgICAgICB2YXIgaW5pdGlhbGl6ZXIgPSB0eXBlb2YgbGF6eSA9PSAnZnVuY3Rpb24nID8gbGF6eSA6IHRoaXNbIGxhenkucmVwbGFjZSgvXnRoaXNcXC4vLCAnJykgXVxuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgbWUuc2V0VmFsdWVUbyh0aGlzLCBpbml0aWFsaXplci5hcHBseSh0aGlzLCBhcmd1bWVudHMpKVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICByZXR1cm4gb3JpZ2luYWwuY2FsbCh0aGlzKSAgICBcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cbn0pXG5cbjtcblJvbGUoJ0pvb3NlLkF0dHJpYnV0ZS5BY2Nlc3Nvci5Db21iaW5lZCcsIHtcbiAgICBcbiAgICBcbiAgICBoYXZlIDoge1xuICAgICAgICBpc0NvbWJpbmVkICAgICAgICA6IGZhbHNlXG4gICAgfSwgXG4gICAgXG4gICAgXG4gICAgYWZ0ZXIgOiB7XG4gICAgICAgIGluaXRpYWxpemUgOiBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgIHRoaXMuaXNDb21iaW5lZCA9IHRoaXMuaXNDb21iaW5lZCB8fCAvLi5jL2kudGVzdCh0aGlzLmlzKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAodGhpcy5pc0NvbWJpbmVkKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5zbG90ID0gJyQkJyArIHRoaXMubmFtZVxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIHRoaXMuaGFzR2V0dGVyID0gdHJ1ZVxuICAgICAgICAgICAgICAgIHRoaXMuaGFzU2V0dGVyID0gZmFsc2VcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICB0aGlzLnNldHRlck5hbWUgPSB0aGlzLmdldHRlck5hbWUgPSB0aGlzLnB1YmxpY05hbWVcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH0sXG4gICAgXG4gICAgXG4gICAgb3ZlcnJpZGUgOiB7XG4gICAgICAgIFxuICAgICAgICBnZXRHZXR0ZXIgOiBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgIHZhciBnZXR0ZXIgICAgPSB0aGlzLlNVUEVSKClcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKCF0aGlzLmlzQ29tYmluZWQpIHJldHVybiBnZXR0ZXJcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdmFyIHNldHRlciAgICA9IHRoaXMuZ2V0U2V0dGVyKClcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdmFyIG1lID0gdGhpc1xuICAgICAgICAgICAgXG4gICAgICAgICAgICByZXR1cm4gZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIGlmICghYXJndW1lbnRzLmxlbmd0aCkge1xuICAgICAgICAgICAgICAgICAgICBpZiAobWUucmVhZGFibGUpIHJldHVybiBnZXR0ZXIuY2FsbCh0aGlzKVxuICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDYWxsIHRvIGdldHRlciBvZiB1bnJlYWRhYmxlIGF0dHJpYnV0ZTogW1wiICsgbWUubmFtZSArIFwiXVwiKVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBpZiAobWUud3JpdGVhYmxlKSByZXR1cm4gc2V0dGVyLmFwcGx5KHRoaXMsIGFyZ3VtZW50cylcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDYWxsIHRvIHNldHRlciBvZiByZWFkLW9ubHkgYXR0cmlidXRlOiBbXCIgKyBtZS5uYW1lICsgXCJdXCIpICAgIFxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuICAgIFxufSlcblxuO1xuSm9vc2UuTWFuYWdlZC5BdHRyaWJ1dGUubWV0YS5leHRlbmQoe1xuICAgIGRvZXMgOiBbIEpvb3NlLkF0dHJpYnV0ZS5EZWxlZ2F0ZSwgSm9vc2UuQXR0cmlidXRlLlRyaWdnZXIsIEpvb3NlLkF0dHJpYnV0ZS5MYXp5LCBKb29zZS5BdHRyaWJ1dGUuQWNjZXNzb3IuQ29tYmluZWQgXVxufSkgICAgICAgICAgICBcblxuO1xuUm9sZSgnSm9vc2UuTWV0YS5TaW5nbGV0b24nLCB7XG4gICAgXG4gICAgaGFzIDoge1xuICAgICAgICBmb3JjZUluc3RhbmNlICAgICAgICAgICA6IEpvb3NlLkkuT2JqZWN0LFxuICAgICAgICBpbnN0YW5jZSAgICAgICAgICAgICAgICA6IG51bGxcbiAgICB9LFxuICAgIFxuICAgIFxuICAgIFxuICAgIG92ZXJyaWRlIDoge1xuICAgICAgICBcbiAgICAgICAgZGVmYXVsdENvbnN0cnVjdG9yIDogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgdmFyIG1ldGEgICAgICAgID0gdGhpc1xuICAgICAgICAgICAgdmFyIHByZXZpb3VzICAgID0gdGhpcy5TVVBFUigpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXMuYWRhcHRDb25zdHJ1Y3RvcihwcmV2aW91cylcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcmV0dXJuIGZ1bmN0aW9uIChmb3JjZUluc3RhbmNlLCBwYXJhbXMpIHtcbiAgICAgICAgICAgICAgICBpZiAoZm9yY2VJbnN0YW5jZSA9PSBtZXRhLmZvcmNlSW5zdGFuY2UpIHJldHVybiBwcmV2aW91cy5hcHBseSh0aGlzLCBwYXJhbXMpIHx8IHRoaXNcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICB2YXIgaW5zdGFuY2UgPSBtZXRhLmluc3RhbmNlXG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgaWYgKGluc3RhbmNlKSB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChtZXRhLmhhc01ldGhvZCgnY29uZmlndXJlJykpIGluc3RhbmNlLmNvbmZpZ3VyZS5hcHBseShpbnN0YW5jZSwgYXJndW1lbnRzKVxuICAgICAgICAgICAgICAgIH0gZWxzZVxuICAgICAgICAgICAgICAgICAgICBtZXRhLmluc3RhbmNlID0gbmV3IG1ldGEuYyhtZXRhLmZvcmNlSW5zdGFuY2UsIGFyZ3VtZW50cylcbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgcmV0dXJuIG1ldGEuaW5zdGFuY2VcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSAgICAgICAgXG4gICAgfVxuICAgIFxuXG59KVxuXG5cbkpvb3NlLk5hbWVzcGFjZS5NYW5hZ2VyLm15LnJlZ2lzdGVyKCdTaW5nbGV0b24nLCBDbGFzcyh7XG4gICAgaXNhICAgICA6IEpvb3NlLk1ldGEuQ2xhc3MsXG4gICAgbWV0YSAgICA6IEpvb3NlLk1ldGEuQ2xhc3MsXG4gICAgXG4gICAgZG9lcyAgICA6IEpvb3NlLk1ldGEuU2luZ2xldG9uXG59KSlcbjtcbjtcbn0oKTs7XG4iLCIvLyBleHBvc2UgbW9kdWxlIGNsYXNzZXNcclxuXHJcbmV4cG9ydHMuSW50ZXJzZWN0aW9uID0gcmVxdWlyZSgnLi9saWIvSW50ZXJzZWN0aW9uJyk7XHJcbmV4cG9ydHMuSW50ZXJzZWN0aW9uUGFyYW1zID0gcmVxdWlyZSgnLi9saWIvSW50ZXJzZWN0aW9uUGFyYW1zJyk7XHJcblxyXG4vLyBleHBvc2UgYWZmaW5lIG1vZHVsZSBjbGFzc2VzXHJcbmV4cG9ydHMuUG9pbnQyRCA9IHJlcXVpcmUoJ2tsZC1hZmZpbmUnKS5Qb2ludDJEO1xyXG4iLCIvKipcclxuICpcclxuICogIEludGVyc2VjdGlvbi5qc1xyXG4gKlxyXG4gKiAgY29weXJpZ2h0IDIwMDIsIDIwMTMgS2V2aW4gTGluZHNleVxyXG4gKlxyXG4gKi9cclxuXHJcbnZhciBQb2ludDJEID0gcmVxdWlyZSgna2xkLWFmZmluZScpLlBvaW50MkQsXHJcbiAgICBWZWN0b3IyRCA9IHJlcXVpcmUoJ2tsZC1hZmZpbmUnKS5WZWN0b3IyRCxcclxuICAgIFBvbHlub21pYWwgPSByZXF1aXJlKCdrbGQtcG9seW5vbWlhbCcpLlBvbHlub21pYWw7XHJcblxyXG4vKipcclxuICogIEludGVyc2VjdGlvblxyXG4gKi9cclxuZnVuY3Rpb24gSW50ZXJzZWN0aW9uKHN0YXR1cykge1xyXG4gICAgdGhpcy5pbml0KHN0YXR1cyk7XHJcbn1cclxuXHJcbi8qKlxyXG4gKiAgaW5pdFxyXG4gKlxyXG4gKiAgQHBhcmFtIHtTdHJpbmd9IHN0YXR1c1xyXG4gKiAgQHJldHVybnMge0ludGVyc2VjdGlvbn1cclxuICovXHJcbkludGVyc2VjdGlvbi5wcm90b3R5cGUuaW5pdCA9IGZ1bmN0aW9uKHN0YXR1cykge1xyXG4gICAgdGhpcy5zdGF0dXMgPSBzdGF0dXM7XHJcbiAgICB0aGlzLnBvaW50cyA9IG5ldyBBcnJheSgpO1xyXG59O1xyXG5cclxuLyoqXHJcbiAqICBhcHBlbmRQb2ludFxyXG4gKlxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBwb2ludFxyXG4gKi9cclxuSW50ZXJzZWN0aW9uLnByb3RvdHlwZS5hcHBlbmRQb2ludCA9IGZ1bmN0aW9uKHBvaW50KSB7XHJcbiAgICB0aGlzLnBvaW50cy5wdXNoKHBvaW50KTtcclxufTtcclxuXHJcbi8qKlxyXG4gKiAgYXBwZW5kUG9pbnRzXHJcbiAqXHJcbiAqICBAcGFyYW0ge0FycmF5PFBvaW50MkQ+fSBwb2ludHNcclxuICovXHJcbkludGVyc2VjdGlvbi5wcm90b3R5cGUuYXBwZW5kUG9pbnRzID0gZnVuY3Rpb24ocG9pbnRzKSB7XHJcbiAgICB0aGlzLnBvaW50cyA9IHRoaXMucG9pbnRzLmNvbmNhdChwb2ludHMpO1xyXG59O1xyXG5cclxuLy8gc3RhdGljIG1ldGhvZHNcclxuXHJcbi8qKlxyXG4gKiAgaW50ZXJzZWN0U2hhcGVzXHJcbiAqXHJcbiAqICBAcGFyYW0ge0ludGVyc2VjdGlvblBhcmFtc30gc2hhcGUxXHJcbiAqICBAcGFyYW0ge0ludGVyc2VjdGlvblBhcmFtc30gc2hhcGUyXHJcbiAqICBAcmV0dXJucyB7SW50ZXJzZWN0aW9ufVxyXG4gKi9cclxuSW50ZXJzZWN0aW9uLmludGVyc2VjdFNoYXBlcyA9IGZ1bmN0aW9uKHNoYXBlMSwgc2hhcGUyKSB7XHJcbiAgICB2YXIgaXAxID0gc2hhcGUxLmdldEludGVyc2VjdGlvblBhcmFtcygpO1xyXG4gICAgdmFyIGlwMiA9IHNoYXBlMi5nZXRJbnRlcnNlY3Rpb25QYXJhbXMoKTtcclxuICAgIHZhciByZXN1bHQ7XHJcblxyXG4gICAgaWYgKCBpcDEgIT0gbnVsbCAmJiBpcDIgIT0gbnVsbCApIHtcclxuICAgICAgICBpZiAoIGlwMS5uYW1lID09IFwiUGF0aFwiICkge1xyXG4gICAgICAgICAgICByZXN1bHQgPSBJbnRlcnNlY3Rpb24uaW50ZXJzZWN0UGF0aFNoYXBlKHNoYXBlMSwgc2hhcGUyKTtcclxuICAgICAgICB9IGVsc2UgaWYgKCBpcDIubmFtZSA9PSBcIlBhdGhcIiApIHtcclxuICAgICAgICAgICAgcmVzdWx0ID0gSW50ZXJzZWN0aW9uLmludGVyc2VjdFBhdGhTaGFwZShzaGFwZTIsIHNoYXBlMSk7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgdmFyIG1ldGhvZDtcclxuICAgICAgICAgICAgdmFyIHBhcmFtcztcclxuXHJcbiAgICAgICAgICAgIGlmICggaXAxLm5hbWUgPCBpcDIubmFtZSApIHtcclxuICAgICAgICAgICAgICAgIG1ldGhvZCA9IFwiaW50ZXJzZWN0XCIgKyBpcDEubmFtZSArIGlwMi5uYW1lO1xyXG4gICAgICAgICAgICAgICAgcGFyYW1zID0gaXAxLnBhcmFtcy5jb25jYXQoIGlwMi5wYXJhbXMgKTtcclxuICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgIG1ldGhvZCA9IFwiaW50ZXJzZWN0XCIgKyBpcDIubmFtZSArIGlwMS5uYW1lO1xyXG4gICAgICAgICAgICAgICAgcGFyYW1zID0gaXAyLnBhcmFtcy5jb25jYXQoIGlwMS5wYXJhbXMgKTtcclxuICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgaWYgKCAhKG1ldGhvZCBpbiBJbnRlcnNlY3Rpb24pIClcclxuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcIkludGVyc2VjdGlvbiBub3QgYXZhaWxhYmxlOiBcIiArIG1ldGhvZCk7XHJcblxyXG4gICAgICAgICAgICByZXN1bHQgPSBJbnRlcnNlY3Rpb25bbWV0aG9kXS5hcHBseShudWxsLCBwYXJhbXMpO1xyXG4gICAgICAgIH1cclxuICAgIH0gZWxzZSB7XHJcbiAgICAgICAgcmVzdWx0ID0gbmV3IEludGVyc2VjdGlvbihcIk5vIEludGVyc2VjdGlvblwiKTtcclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gcmVzdWx0O1xyXG59O1xyXG5cclxuLyoqXHJcbiAqICBpbnRlcnNlY3RQYXRoU2hhcGVcclxuICpcclxuICogIEBwYXJhbSB7SW50ZXJzZWN0aW9uUGFyYW1zfSBwYXRoXHJcbiAqICBAcGFyYW0ge0ludGVyc2VjdGlvblBhcmFtc30gc2hhcGVcclxuICogIEByZXR1cm5zIHtJbnRlcnNlY3Rpb259XHJcbiAqL1xyXG5JbnRlcnNlY3Rpb24uaW50ZXJzZWN0UGF0aFNoYXBlID0gZnVuY3Rpb24ocGF0aCwgc2hhcGUpIHtcclxuICAgIHJldHVybiBwYXRoLmludGVyc2VjdFNoYXBlKHNoYXBlKTtcclxufTtcclxuXHJcbi8qKlxyXG4gKiAgaW50ZXJzZWN0QmV6aWVyMkJlemllcjJcclxuICpcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gYTFcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gYTJcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gYTNcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gYjFcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gYjJcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gYjNcclxuICogIEByZXR1cm5zIHtJbnRlcnNlY3Rpb259XHJcbiAqL1xyXG5JbnRlcnNlY3Rpb24uaW50ZXJzZWN0QmV6aWVyMkJlemllcjIgPSBmdW5jdGlvbihhMSwgYTIsIGEzLCBiMSwgYjIsIGIzKSB7XHJcbiAgICB2YXIgYSwgYjtcclxuICAgIHZhciBjMTIsIGMxMSwgYzEwO1xyXG4gICAgdmFyIGMyMiwgYzIxLCBjMjA7XHJcbiAgICB2YXIgcmVzdWx0ID0gbmV3IEludGVyc2VjdGlvbihcIk5vIEludGVyc2VjdGlvblwiKTtcclxuICAgIHZhciBwb2x5O1xyXG5cclxuICAgIGEgPSBhMi5tdWx0aXBseSgtMik7XHJcbiAgICBjMTIgPSBhMS5hZGQoYS5hZGQoYTMpKTtcclxuXHJcbiAgICBhID0gYTEubXVsdGlwbHkoLTIpO1xyXG4gICAgYiA9IGEyLm11bHRpcGx5KDIpO1xyXG4gICAgYzExID0gYS5hZGQoYik7XHJcblxyXG4gICAgYzEwID0gbmV3IFBvaW50MkQoYTEueCwgYTEueSk7XHJcblxyXG4gICAgYSA9IGIyLm11bHRpcGx5KC0yKTtcclxuICAgIGMyMiA9IGIxLmFkZChhLmFkZChiMykpO1xyXG5cclxuICAgIGEgPSBiMS5tdWx0aXBseSgtMik7XHJcbiAgICBiID0gYjIubXVsdGlwbHkoMik7XHJcbiAgICBjMjEgPSBhLmFkZChiKTtcclxuXHJcbiAgICBjMjAgPSBuZXcgUG9pbnQyRChiMS54LCBiMS55KTtcclxuXHJcbiAgICBpZiAoIGMxMi55ID09IDAgKSB7XHJcbiAgICAgICAgdmFyIHYwID0gYzEyLngqKGMxMC55IC0gYzIwLnkpO1xyXG4gICAgICAgIHZhciB2MSA9IHYwIC0gYzExLngqYzExLnk7XHJcbiAgICAgICAgdmFyIHYyID0gdjAgKyB2MTtcclxuICAgICAgICB2YXIgdjMgPSBjMTEueSpjMTEueTtcclxuXHJcbiAgICAgICAgcG9seSA9IG5ldyBQb2x5bm9taWFsKFxyXG4gICAgICAgICAgICBjMTIueCpjMjIueSpjMjIueSxcclxuICAgICAgICAgICAgMipjMTIueCpjMjEueSpjMjIueSxcclxuICAgICAgICAgICAgYzEyLngqYzIxLnkqYzIxLnkgLSBjMjIueCp2MyAtIGMyMi55KnYwIC0gYzIyLnkqdjEsXHJcbiAgICAgICAgICAgIC1jMjEueCp2MyAtIGMyMS55KnYwIC0gYzIxLnkqdjEsXHJcbiAgICAgICAgICAgIChjMTAueCAtIGMyMC54KSp2MyArIChjMTAueSAtIGMyMC55KSp2MVxyXG4gICAgICAgICk7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICAgIHZhciB2MCA9IGMxMi54KmMyMi55IC0gYzEyLnkqYzIyLng7XHJcbiAgICAgICAgdmFyIHYxID0gYzEyLngqYzIxLnkgLSBjMjEueCpjMTIueTtcclxuICAgICAgICB2YXIgdjIgPSBjMTEueCpjMTIueSAtIGMxMS55KmMxMi54O1xyXG4gICAgICAgIHZhciB2MyA9IGMxMC55IC0gYzIwLnk7XHJcbiAgICAgICAgdmFyIHY0ID0gYzEyLnkqKGMxMC54IC0gYzIwLngpIC0gYzEyLngqdjM7XHJcbiAgICAgICAgdmFyIHY1ID0gLWMxMS55KnYyICsgYzEyLnkqdjQ7XHJcbiAgICAgICAgdmFyIHY2ID0gdjIqdjI7XHJcblxyXG4gICAgICAgIHBvbHkgPSBuZXcgUG9seW5vbWlhbChcclxuICAgICAgICAgICAgdjAqdjAsXHJcbiAgICAgICAgICAgIDIqdjAqdjEsXHJcbiAgICAgICAgICAgICgtYzIyLnkqdjYgKyBjMTIueSp2MSp2MSArIGMxMi55KnYwKnY0ICsgdjAqdjUpIC8gYzEyLnksXHJcbiAgICAgICAgICAgICgtYzIxLnkqdjYgKyBjMTIueSp2MSp2NCArIHYxKnY1KSAvIGMxMi55LFxyXG4gICAgICAgICAgICAodjMqdjYgKyB2NCp2NSkgLyBjMTIueVxyXG4gICAgICAgICk7XHJcbiAgICB9XHJcblxyXG4gICAgdmFyIHJvb3RzID0gcG9seS5nZXRSb290cygpO1xyXG4gICAgZm9yICggdmFyIGkgPSAwOyBpIDwgcm9vdHMubGVuZ3RoOyBpKysgKSB7XHJcbiAgICAgICAgdmFyIHMgPSByb290c1tpXTtcclxuXHJcbiAgICAgICAgaWYgKCAwIDw9IHMgJiYgcyA8PSAxICkge1xyXG4gICAgICAgICAgICB2YXIgeFJvb3RzID0gbmV3IFBvbHlub21pYWwoXHJcbiAgICAgICAgICAgICAgICBjMTIueCxcclxuICAgICAgICAgICAgICAgIGMxMS54LFxyXG4gICAgICAgICAgICAgICAgYzEwLnggLSBjMjAueCAtIHMqYzIxLnggLSBzKnMqYzIyLnhcclxuICAgICAgICAgICAgKS5nZXRSb290cygpO1xyXG4gICAgICAgICAgICB2YXIgeVJvb3RzID0gbmV3IFBvbHlub21pYWwoXHJcbiAgICAgICAgICAgICAgICBjMTIueSxcclxuICAgICAgICAgICAgICAgIGMxMS55LFxyXG4gICAgICAgICAgICAgICAgYzEwLnkgLSBjMjAueSAtIHMqYzIxLnkgLSBzKnMqYzIyLnlcclxuICAgICAgICAgICAgKS5nZXRSb290cygpO1xyXG5cclxuICAgICAgICAgICAgaWYgKCB4Um9vdHMubGVuZ3RoID4gMCAmJiB5Um9vdHMubGVuZ3RoID4gMCApIHtcclxuICAgICAgICAgICAgICAgIHZhciBUT0xFUkFOQ0UgPSAxZS00O1xyXG5cclxuICAgICAgICAgICAgICAgIGNoZWNrUm9vdHM6XHJcbiAgICAgICAgICAgICAgICBmb3IgKCB2YXIgaiA9IDA7IGogPCB4Um9vdHMubGVuZ3RoOyBqKysgKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdmFyIHhSb290ID0geFJvb3RzW2pdO1xyXG5cclxuICAgICAgICAgICAgICAgICAgICBpZiAoIDAgPD0geFJvb3QgJiYgeFJvb3QgPD0gMSApIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgZm9yICggdmFyIGsgPSAwOyBrIDwgeVJvb3RzLmxlbmd0aDsgaysrICkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCBNYXRoLmFicyggeFJvb3QgLSB5Um9vdHNba10gKSA8IFRPTEVSQU5DRSApIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXN1bHQucG9pbnRzLnB1c2goIGMyMi5tdWx0aXBseShzKnMpLmFkZChjMjEubXVsdGlwbHkocykuYWRkKGMyMCkpICk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWsgY2hlY2tSb290cztcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICBpZiAoIHJlc3VsdC5wb2ludHMubGVuZ3RoID4gMCApIHJlc3VsdC5zdGF0dXMgPSBcIkludGVyc2VjdGlvblwiO1xyXG5cclxuICAgIHJldHVybiByZXN1bHQ7XHJcbn07XHJcblxyXG5cclxuLyoqXHJcbiAqICBpbnRlcnNlY3RCZXppZXIyQmV6aWVyM1xyXG4gKlxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBhMVxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBhMlxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBhM1xyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBiMVxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBiMlxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBiM1xyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBiNFxyXG4gKiAgQHJldHVybnMge0ludGVyc2VjdGlvbn1cclxuICovXHJcbkludGVyc2VjdGlvbi5pbnRlcnNlY3RCZXppZXIyQmV6aWVyMyA9IGZ1bmN0aW9uKGExLCBhMiwgYTMsIGIxLCBiMiwgYjMsIGI0KSB7XHJcbiAgICB2YXIgYSwgYixjLCBkO1xyXG4gICAgdmFyIGMxMiwgYzExLCBjMTA7XHJcbiAgICB2YXIgYzIzLCBjMjIsIGMyMSwgYzIwO1xyXG4gICAgdmFyIHJlc3VsdCA9IG5ldyBJbnRlcnNlY3Rpb24oXCJObyBJbnRlcnNlY3Rpb25cIik7XHJcblxyXG4gICAgYSA9IGEyLm11bHRpcGx5KC0yKTtcclxuICAgIGMxMiA9IGExLmFkZChhLmFkZChhMykpO1xyXG5cclxuICAgIGEgPSBhMS5tdWx0aXBseSgtMik7XHJcbiAgICBiID0gYTIubXVsdGlwbHkoMik7XHJcbiAgICBjMTEgPSBhLmFkZChiKTtcclxuXHJcbiAgICBjMTAgPSBuZXcgUG9pbnQyRChhMS54LCBhMS55KTtcclxuXHJcbiAgICBhID0gYjEubXVsdGlwbHkoLTEpO1xyXG4gICAgYiA9IGIyLm11bHRpcGx5KDMpO1xyXG4gICAgYyA9IGIzLm11bHRpcGx5KC0zKTtcclxuICAgIGQgPSBhLmFkZChiLmFkZChjLmFkZChiNCkpKTtcclxuICAgIGMyMyA9IG5ldyBWZWN0b3IyRChkLngsIGQueSk7XHJcblxyXG4gICAgYSA9IGIxLm11bHRpcGx5KDMpO1xyXG4gICAgYiA9IGIyLm11bHRpcGx5KC02KTtcclxuICAgIGMgPSBiMy5tdWx0aXBseSgzKTtcclxuICAgIGQgPSBhLmFkZChiLmFkZChjKSk7XHJcbiAgICBjMjIgPSBuZXcgVmVjdG9yMkQoZC54LCBkLnkpO1xyXG5cclxuICAgIGEgPSBiMS5tdWx0aXBseSgtMyk7XHJcbiAgICBiID0gYjIubXVsdGlwbHkoMyk7XHJcbiAgICBjID0gYS5hZGQoYik7XHJcbiAgICBjMjEgPSBuZXcgVmVjdG9yMkQoYy54LCBjLnkpO1xyXG5cclxuICAgIGMyMCA9IG5ldyBWZWN0b3IyRChiMS54LCBiMS55KTtcclxuXHJcbiAgICB2YXIgYzEweDIgPSBjMTAueCpjMTAueDtcclxuICAgIHZhciBjMTB5MiA9IGMxMC55KmMxMC55O1xyXG4gICAgdmFyIGMxMXgyID0gYzExLngqYzExLng7XHJcbiAgICB2YXIgYzExeTIgPSBjMTEueSpjMTEueTtcclxuICAgIHZhciBjMTJ4MiA9IGMxMi54KmMxMi54O1xyXG4gICAgdmFyIGMxMnkyID0gYzEyLnkqYzEyLnk7XHJcbiAgICB2YXIgYzIweDIgPSBjMjAueCpjMjAueDtcclxuICAgIHZhciBjMjB5MiA9IGMyMC55KmMyMC55O1xyXG4gICAgdmFyIGMyMXgyID0gYzIxLngqYzIxLng7XHJcbiAgICB2YXIgYzIxeTIgPSBjMjEueSpjMjEueTtcclxuICAgIHZhciBjMjJ4MiA9IGMyMi54KmMyMi54O1xyXG4gICAgdmFyIGMyMnkyID0gYzIyLnkqYzIyLnk7XHJcbiAgICB2YXIgYzIzeDIgPSBjMjMueCpjMjMueDtcclxuICAgIHZhciBjMjN5MiA9IGMyMy55KmMyMy55O1xyXG5cclxuICAgIHZhciBwb2x5ID0gbmV3IFBvbHlub21pYWwoXHJcbiAgICAgICAgLTIqYzEyLngqYzEyLnkqYzIzLngqYzIzLnkgKyBjMTJ4MipjMjN5MiArIGMxMnkyKmMyM3gyLFxyXG4gICAgICAgIC0yKmMxMi54KmMxMi55KmMyMi54KmMyMy55IC0gMipjMTIueCpjMTIueSpjMjIueSpjMjMueCArIDIqYzEyeTIqYzIyLngqYzIzLnggK1xyXG4gICAgICAgICAgICAyKmMxMngyKmMyMi55KmMyMy55LFxyXG4gICAgICAgIC0yKmMxMi54KmMyMS54KmMxMi55KmMyMy55IC0gMipjMTIueCpjMTIueSpjMjEueSpjMjMueCAtIDIqYzEyLngqYzEyLnkqYzIyLngqYzIyLnkgK1xyXG4gICAgICAgICAgICAyKmMyMS54KmMxMnkyKmMyMy54ICsgYzEyeTIqYzIyeDIgKyBjMTJ4MiooMipjMjEueSpjMjMueSArIGMyMnkyKSxcclxuICAgICAgICAyKmMxMC54KmMxMi54KmMxMi55KmMyMy55ICsgMipjMTAueSpjMTIueCpjMTIueSpjMjMueCArIGMxMS54KmMxMS55KmMxMi54KmMyMy55ICtcclxuICAgICAgICAgICAgYzExLngqYzExLnkqYzEyLnkqYzIzLnggLSAyKmMyMC54KmMxMi54KmMxMi55KmMyMy55IC0gMipjMTIueCpjMjAueSpjMTIueSpjMjMueCAtXHJcbiAgICAgICAgICAgIDIqYzEyLngqYzIxLngqYzEyLnkqYzIyLnkgLSAyKmMxMi54KmMxMi55KmMyMS55KmMyMi54IC0gMipjMTAueCpjMTJ5MipjMjMueCAtXHJcbiAgICAgICAgICAgIDIqYzEwLnkqYzEyeDIqYzIzLnkgKyAyKmMyMC54KmMxMnkyKmMyMy54ICsgMipjMjEueCpjMTJ5MipjMjIueCAtXHJcbiAgICAgICAgICAgIGMxMXkyKmMxMi54KmMyMy54IC0gYzExeDIqYzEyLnkqYzIzLnkgKyBjMTJ4MiooMipjMjAueSpjMjMueSArIDIqYzIxLnkqYzIyLnkpLFxyXG4gICAgICAgIDIqYzEwLngqYzEyLngqYzEyLnkqYzIyLnkgKyAyKmMxMC55KmMxMi54KmMxMi55KmMyMi54ICsgYzExLngqYzExLnkqYzEyLngqYzIyLnkgK1xyXG4gICAgICAgICAgICBjMTEueCpjMTEueSpjMTIueSpjMjIueCAtIDIqYzIwLngqYzEyLngqYzEyLnkqYzIyLnkgLSAyKmMxMi54KmMyMC55KmMxMi55KmMyMi54IC1cclxuICAgICAgICAgICAgMipjMTIueCpjMjEueCpjMTIueSpjMjEueSAtIDIqYzEwLngqYzEyeTIqYzIyLnggLSAyKmMxMC55KmMxMngyKmMyMi55ICtcclxuICAgICAgICAgICAgMipjMjAueCpjMTJ5MipjMjIueCAtIGMxMXkyKmMxMi54KmMyMi54IC0gYzExeDIqYzEyLnkqYzIyLnkgKyBjMjF4MipjMTJ5MiArXHJcbiAgICAgICAgICAgIGMxMngyKigyKmMyMC55KmMyMi55ICsgYzIxeTIpLFxyXG4gICAgICAgIDIqYzEwLngqYzEyLngqYzEyLnkqYzIxLnkgKyAyKmMxMC55KmMxMi54KmMyMS54KmMxMi55ICsgYzExLngqYzExLnkqYzEyLngqYzIxLnkgK1xyXG4gICAgICAgICAgICBjMTEueCpjMTEueSpjMjEueCpjMTIueSAtIDIqYzIwLngqYzEyLngqYzEyLnkqYzIxLnkgLSAyKmMxMi54KmMyMC55KmMyMS54KmMxMi55IC1cclxuICAgICAgICAgICAgMipjMTAueCpjMjEueCpjMTJ5MiAtIDIqYzEwLnkqYzEyeDIqYzIxLnkgKyAyKmMyMC54KmMyMS54KmMxMnkyIC1cclxuICAgICAgICAgICAgYzExeTIqYzEyLngqYzIxLnggLSBjMTF4MipjMTIueSpjMjEueSArIDIqYzEyeDIqYzIwLnkqYzIxLnksXHJcbiAgICAgICAgLTIqYzEwLngqYzEwLnkqYzEyLngqYzEyLnkgLSBjMTAueCpjMTEueCpjMTEueSpjMTIueSAtIGMxMC55KmMxMS54KmMxMS55KmMxMi54ICtcclxuICAgICAgICAgICAgMipjMTAueCpjMTIueCpjMjAueSpjMTIueSArIDIqYzEwLnkqYzIwLngqYzEyLngqYzEyLnkgKyBjMTEueCpjMjAueCpjMTEueSpjMTIueSArXHJcbiAgICAgICAgICAgIGMxMS54KmMxMS55KmMxMi54KmMyMC55IC0gMipjMjAueCpjMTIueCpjMjAueSpjMTIueSAtIDIqYzEwLngqYzIwLngqYzEyeTIgK1xyXG4gICAgICAgICAgICBjMTAueCpjMTF5MipjMTIueCArIGMxMC55KmMxMXgyKmMxMi55IC0gMipjMTAueSpjMTJ4MipjMjAueSAtXHJcbiAgICAgICAgICAgIGMyMC54KmMxMXkyKmMxMi54IC0gYzExeDIqYzIwLnkqYzEyLnkgKyBjMTB4MipjMTJ5MiArIGMxMHkyKmMxMngyICtcclxuICAgICAgICAgICAgYzIweDIqYzEyeTIgKyBjMTJ4MipjMjB5MlxyXG4gICAgKTtcclxuICAgIHZhciByb290cyA9IHBvbHkuZ2V0Um9vdHNJbkludGVydmFsKDAsMSk7XHJcblxyXG4gICAgZm9yICggdmFyIGkgPSAwOyBpIDwgcm9vdHMubGVuZ3RoOyBpKysgKSB7XHJcbiAgICAgICAgdmFyIHMgPSByb290c1tpXTtcclxuICAgICAgICB2YXIgeFJvb3RzID0gbmV3IFBvbHlub21pYWwoXHJcbiAgICAgICAgICAgIGMxMi54LFxyXG4gICAgICAgICAgICBjMTEueCxcclxuICAgICAgICAgICAgYzEwLnggLSBjMjAueCAtIHMqYzIxLnggLSBzKnMqYzIyLnggLSBzKnMqcypjMjMueFxyXG4gICAgICAgICkuZ2V0Um9vdHMoKTtcclxuICAgICAgICB2YXIgeVJvb3RzID0gbmV3IFBvbHlub21pYWwoXHJcbiAgICAgICAgICAgIGMxMi55LFxyXG4gICAgICAgICAgICBjMTEueSxcclxuICAgICAgICAgICAgYzEwLnkgLSBjMjAueSAtIHMqYzIxLnkgLSBzKnMqYzIyLnkgLSBzKnMqcypjMjMueVxyXG4gICAgICAgICkuZ2V0Um9vdHMoKTtcclxuXHJcbiAgICAgICAgaWYgKCB4Um9vdHMubGVuZ3RoID4gMCAmJiB5Um9vdHMubGVuZ3RoID4gMCApIHtcclxuICAgICAgICAgICAgdmFyIFRPTEVSQU5DRSA9IDFlLTQ7XHJcblxyXG4gICAgICAgICAgICBjaGVja1Jvb3RzOlxyXG4gICAgICAgICAgICBmb3IgKCB2YXIgaiA9IDA7IGogPCB4Um9vdHMubGVuZ3RoOyBqKysgKSB7XHJcbiAgICAgICAgICAgICAgICB2YXIgeFJvb3QgPSB4Um9vdHNbal07XHJcblxyXG4gICAgICAgICAgICAgICAgaWYgKCAwIDw9IHhSb290ICYmIHhSb290IDw9IDEgKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgZm9yICggdmFyIGsgPSAwOyBrIDwgeVJvb3RzLmxlbmd0aDsgaysrICkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoIE1hdGguYWJzKCB4Um9vdCAtIHlSb290c1trXSApIDwgVE9MRVJBTkNFICkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcmVzdWx0LnBvaW50cy5wdXNoKFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGMyMy5tdWx0aXBseShzKnMqcykuYWRkKGMyMi5tdWx0aXBseShzKnMpLmFkZChjMjEubXVsdGlwbHkocykuYWRkKGMyMCkpKVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrIGNoZWNrUm9vdHM7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKCByZXN1bHQucG9pbnRzLmxlbmd0aCA+IDAgKSByZXN1bHQuc3RhdHVzID0gXCJJbnRlcnNlY3Rpb25cIjtcclxuXHJcbiAgICByZXR1cm4gcmVzdWx0O1xyXG5cclxufTtcclxuXHJcblxyXG4vKipcclxuICogIGludGVyc2VjdEJlemllcjJDaXJjbGVcclxuICpcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gcDFcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gcDJcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gcDNcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gY1xyXG4gKiAgQHBhcmFtIHtOdW1iZXJ9IHJcclxuICogIEByZXR1cm5zIHtJbnRlcnNlY3Rpb259XHJcbiAqL1xyXG5JbnRlcnNlY3Rpb24uaW50ZXJzZWN0QmV6aWVyMkNpcmNsZSA9IGZ1bmN0aW9uKHAxLCBwMiwgcDMsIGMsIHIpIHtcclxuICAgIHJldHVybiBJbnRlcnNlY3Rpb24uaW50ZXJzZWN0QmV6aWVyMkVsbGlwc2UocDEsIHAyLCBwMywgYywgciwgcik7XHJcbn07XHJcblxyXG5cclxuLyoqXHJcbiAqICBpbnRlcnNlY3RCZXppZXIyRWxsaXBzZVxyXG4gKlxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBwMVxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBwMlxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBwM1xyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBlY1xyXG4gKiAgQHBhcmFtIHtOdW1iZXJ9IHJ4XHJcbiAqICBAcGFyYW0ge051bWJlcn0gcnlcclxuICogIEByZXR1cm5zIHtJbnRlcnNlY3Rpb259XHJcbiAqL1xyXG5JbnRlcnNlY3Rpb24uaW50ZXJzZWN0QmV6aWVyMkVsbGlwc2UgPSBmdW5jdGlvbihwMSwgcDIsIHAzLCBlYywgcngsIHJ5KSB7XHJcbiAgICB2YXIgYSwgYjsgICAgICAgLy8gdGVtcG9yYXJ5IHZhcmlhYmxlc1xyXG4gICAgdmFyIGMyLCBjMSwgYzA7IC8vIGNvZWZmaWNpZW50cyBvZiBxdWFkcmF0aWNcclxuICAgIHZhciByZXN1bHQgPSBuZXcgSW50ZXJzZWN0aW9uKFwiTm8gSW50ZXJzZWN0aW9uXCIpO1xyXG5cclxuICAgIGEgPSBwMi5tdWx0aXBseSgtMik7XHJcbiAgICBjMiA9IHAxLmFkZChhLmFkZChwMykpO1xyXG5cclxuICAgIGEgPSBwMS5tdWx0aXBseSgtMik7XHJcbiAgICBiID0gcDIubXVsdGlwbHkoMik7XHJcbiAgICBjMSA9IGEuYWRkKGIpO1xyXG5cclxuICAgIGMwID0gbmV3IFBvaW50MkQocDEueCwgcDEueSk7XHJcblxyXG4gICAgdmFyIHJ4cnggID0gcngqcng7XHJcbiAgICB2YXIgcnlyeSAgPSByeSpyeTtcclxuICAgIHZhciByb290cyA9IG5ldyBQb2x5bm9taWFsKFxyXG4gICAgICAgIHJ5cnkqYzIueCpjMi54ICsgcnhyeCpjMi55KmMyLnksXHJcbiAgICAgICAgMioocnlyeSpjMi54KmMxLnggKyByeHJ4KmMyLnkqYzEueSksXHJcbiAgICAgICAgcnlyeSooMipjMi54KmMwLnggKyBjMS54KmMxLngpICsgcnhyeCooMipjMi55KmMwLnkrYzEueSpjMS55KSAtXHJcbiAgICAgICAgICAgIDIqKHJ5cnkqZWMueCpjMi54ICsgcnhyeCplYy55KmMyLnkpLFxyXG4gICAgICAgIDIqKHJ5cnkqYzEueCooYzAueC1lYy54KSArIHJ4cngqYzEueSooYzAueS1lYy55KSksXHJcbiAgICAgICAgcnlyeSooYzAueCpjMC54K2VjLngqZWMueCkgKyByeHJ4KihjMC55KmMwLnkgKyBlYy55KmVjLnkpIC1cclxuICAgICAgICAgICAgMioocnlyeSplYy54KmMwLnggKyByeHJ4KmVjLnkqYzAueSkgLSByeHJ4KnJ5cnlcclxuICAgICkuZ2V0Um9vdHMoKTtcclxuXHJcbiAgICBmb3IgKCB2YXIgaSA9IDA7IGkgPCByb290cy5sZW5ndGg7IGkrKyApIHtcclxuICAgICAgICB2YXIgdCA9IHJvb3RzW2ldO1xyXG5cclxuICAgICAgICBpZiAoIDAgPD0gdCAmJiB0IDw9IDEgKVxyXG4gICAgICAgICAgICByZXN1bHQucG9pbnRzLnB1c2goIGMyLm11bHRpcGx5KHQqdCkuYWRkKGMxLm11bHRpcGx5KHQpLmFkZChjMCkpICk7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKCByZXN1bHQucG9pbnRzLmxlbmd0aCA+IDAgKSByZXN1bHQuc3RhdHVzID0gXCJJbnRlcnNlY3Rpb25cIjtcclxuXHJcbiAgICByZXR1cm4gcmVzdWx0O1xyXG59O1xyXG5cclxuXHJcbi8qKlxyXG4gKiAgaW50ZXJzZWN0QmV6aWVyMkxpbmVcclxuICpcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gcDFcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gcDJcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gcDNcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gYTFcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gYTJcclxuICogIEByZXR1cm5zIHtJbnRlcnNlY3Rpb259XHJcbiAqL1xyXG5JbnRlcnNlY3Rpb24uaW50ZXJzZWN0QmV6aWVyMkxpbmUgPSBmdW5jdGlvbihwMSwgcDIsIHAzLCBhMSwgYTIpIHtcclxuICAgIHZhciBhLCBiOyAgICAgICAgICAgICAvLyB0ZW1wb3JhcnkgdmFyaWFibGVzXHJcbiAgICB2YXIgYzIsIGMxLCBjMDsgICAgICAgLy8gY29lZmZpY2llbnRzIG9mIHF1YWRyYXRpY1xyXG4gICAgdmFyIGNsOyAgICAgICAgICAgICAgIC8vIGMgY29lZmZpY2llbnQgZm9yIG5vcm1hbCBmb3JtIG9mIGxpbmVcclxuICAgIHZhciBuOyAgICAgICAgICAgICAgICAvLyBub3JtYWwgZm9yIG5vcm1hbCBmb3JtIG9mIGxpbmVcclxuICAgIHZhciBtaW4gPSBhMS5taW4oYTIpOyAvLyB1c2VkIHRvIGRldGVybWluZSBpZiBwb2ludCBpcyBvbiBsaW5lIHNlZ21lbnRcclxuICAgIHZhciBtYXggPSBhMS5tYXgoYTIpOyAvLyB1c2VkIHRvIGRldGVybWluZSBpZiBwb2ludCBpcyBvbiBsaW5lIHNlZ21lbnRcclxuICAgIHZhciByZXN1bHQgPSBuZXcgSW50ZXJzZWN0aW9uKFwiTm8gSW50ZXJzZWN0aW9uXCIpO1xyXG5cclxuICAgIGEgPSBwMi5tdWx0aXBseSgtMik7XHJcbiAgICBjMiA9IHAxLmFkZChhLmFkZChwMykpO1xyXG5cclxuICAgIGEgPSBwMS5tdWx0aXBseSgtMik7XHJcbiAgICBiID0gcDIubXVsdGlwbHkoMik7XHJcbiAgICBjMSA9IGEuYWRkKGIpO1xyXG5cclxuICAgIGMwID0gbmV3IFBvaW50MkQocDEueCwgcDEueSk7XHJcblxyXG4gICAgLy8gQ29udmVydCBsaW5lIHRvIG5vcm1hbCBmb3JtOiBheCArIGJ5ICsgYyA9IDBcclxuICAgIC8vIEZpbmQgbm9ybWFsIHRvIGxpbmU6IG5lZ2F0aXZlIGludmVyc2Ugb2Ygb3JpZ2luYWwgbGluZSdzIHNsb3BlXHJcbiAgICBuID0gbmV3IFZlY3RvcjJEKGExLnkgLSBhMi55LCBhMi54IC0gYTEueCk7XHJcblxyXG4gICAgLy8gRGV0ZXJtaW5lIG5ldyBjIGNvZWZmaWNpZW50XHJcbiAgICBjbCA9IGExLngqYTIueSAtIGEyLngqYTEueTtcclxuXHJcbiAgICAvLyBUcmFuc2Zvcm0gY3ViaWMgY29lZmZpY2llbnRzIHRvIGxpbmUncyBjb29yZGluYXRlIHN5c3RlbSBhbmQgZmluZCByb290c1xyXG4gICAgLy8gb2YgY3ViaWNcclxuICAgIHJvb3RzID0gbmV3IFBvbHlub21pYWwoXHJcbiAgICAgICAgbi5kb3QoYzIpLFxyXG4gICAgICAgIG4uZG90KGMxKSxcclxuICAgICAgICBuLmRvdChjMCkgKyBjbFxyXG4gICAgKS5nZXRSb290cygpO1xyXG5cclxuICAgIC8vIEFueSByb290cyBpbiBjbG9zZWQgaW50ZXJ2YWwgWzAsMV0gYXJlIGludGVyc2VjdGlvbnMgb24gQmV6aWVyLCBidXRcclxuICAgIC8vIG1pZ2h0IG5vdCBiZSBvbiB0aGUgbGluZSBzZWdtZW50LlxyXG4gICAgLy8gRmluZCBpbnRlcnNlY3Rpb25zIGFuZCBjYWxjdWxhdGUgcG9pbnQgY29vcmRpbmF0ZXNcclxuICAgIGZvciAoIHZhciBpID0gMDsgaSA8IHJvb3RzLmxlbmd0aDsgaSsrICkge1xyXG4gICAgICAgIHZhciB0ID0gcm9vdHNbaV07XHJcblxyXG4gICAgICAgIGlmICggMCA8PSB0ICYmIHQgPD0gMSApIHtcclxuICAgICAgICAgICAgLy8gV2UncmUgd2l0aGluIHRoZSBCZXppZXIgY3VydmVcclxuICAgICAgICAgICAgLy8gRmluZCBwb2ludCBvbiBCZXppZXJcclxuICAgICAgICAgICAgdmFyIHA0ID0gcDEubGVycChwMiwgdCk7XHJcbiAgICAgICAgICAgIHZhciBwNSA9IHAyLmxlcnAocDMsIHQpO1xyXG5cclxuICAgICAgICAgICAgdmFyIHA2ID0gcDQubGVycChwNSwgdCk7XHJcblxyXG4gICAgICAgICAgICAvLyBTZWUgaWYgcG9pbnQgaXMgb24gbGluZSBzZWdtZW50XHJcbiAgICAgICAgICAgIC8vIEhhZCB0byBtYWtlIHNwZWNpYWwgY2FzZXMgZm9yIHZlcnRpY2FsIGFuZCBob3Jpem9udGFsIGxpbmVzIGR1ZVxyXG4gICAgICAgICAgICAvLyB0byBzbGlnaHQgZXJyb3JzIGluIGNhbGN1bGF0aW9uIG9mIHA2XHJcbiAgICAgICAgICAgIGlmICggYTEueCA9PSBhMi54ICkge1xyXG4gICAgICAgICAgICAgICAgaWYgKCBtaW4ueSA8PSBwNi55ICYmIHA2LnkgPD0gbWF4LnkgKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgcmVzdWx0LnN0YXR1cyA9IFwiSW50ZXJzZWN0aW9uXCI7XHJcbiAgICAgICAgICAgICAgICAgICAgcmVzdWx0LmFwcGVuZFBvaW50KCBwNiApO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9IGVsc2UgaWYgKCBhMS55ID09IGEyLnkgKSB7XHJcbiAgICAgICAgICAgICAgICBpZiAoIG1pbi54IDw9IHA2LnggJiYgcDYueCA8PSBtYXgueCApIHtcclxuICAgICAgICAgICAgICAgICAgICByZXN1bHQuc3RhdHVzID0gXCJJbnRlcnNlY3Rpb25cIjtcclxuICAgICAgICAgICAgICAgICAgICByZXN1bHQuYXBwZW5kUG9pbnQoIHA2ICk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0gZWxzZSBpZiAobWluLnggPD0gcDYueCAmJiBwNi54IDw9IG1heC54ICYmIG1pbi55IDw9IHA2LnkgJiYgcDYueSA8PSBtYXgueSkge1xyXG4gICAgICAgICAgICAgICAgcmVzdWx0LnN0YXR1cyA9IFwiSW50ZXJzZWN0aW9uXCI7XHJcbiAgICAgICAgICAgICAgICByZXN1bHQuYXBwZW5kUG9pbnQoIHA2ICk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIHJlc3VsdDtcclxufTtcclxuXHJcblxyXG4vKipcclxuICogIGludGVyc2VjdEJlemllcjJQb2x5Z29uXHJcbiAqXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IHAxXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IHAyXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IHAzXHJcbiAqICBAcGFyYW0ge0FycmF5PFBvaW50MkQ+fSBwb2ludHNcclxuICogIEByZXR1cm5zIHtJbnRlcnNlY3Rpb259XHJcbiAqL1xyXG5JbnRlcnNlY3Rpb24uaW50ZXJzZWN0QmV6aWVyMlBvbHlnb24gPSBmdW5jdGlvbihwMSwgcDIsIHAzLCBwb2ludHMpIHtcclxuICAgIHZhciByZXN1bHQgPSBuZXcgSW50ZXJzZWN0aW9uKFwiTm8gSW50ZXJzZWN0aW9uXCIpO1xyXG4gICAgdmFyIGxlbmd0aCA9IHBvaW50cy5sZW5ndGg7XHJcblxyXG4gICAgZm9yICggdmFyIGkgPSAwOyBpIDwgbGVuZ3RoOyBpKysgKSB7XHJcbiAgICAgICAgdmFyIGExID0gcG9pbnRzW2ldO1xyXG4gICAgICAgIHZhciBhMiA9IHBvaW50c1soaSsxKSAlIGxlbmd0aF07XHJcbiAgICAgICAgdmFyIGludGVyID0gSW50ZXJzZWN0aW9uLmludGVyc2VjdEJlemllcjJMaW5lKHAxLCBwMiwgcDMsIGExLCBhMik7XHJcblxyXG4gICAgICAgIHJlc3VsdC5hcHBlbmRQb2ludHMoaW50ZXIucG9pbnRzKTtcclxuICAgIH1cclxuXHJcbiAgICBpZiAoIHJlc3VsdC5wb2ludHMubGVuZ3RoID4gMCApIHJlc3VsdC5zdGF0dXMgPSBcIkludGVyc2VjdGlvblwiO1xyXG5cclxuICAgIHJldHVybiByZXN1bHQ7XHJcbn07XHJcblxyXG5cclxuLyoqXHJcbiAqICBpbnRlcnNlY3RCZXppZXIyUmVjdGFuZ2xlXHJcbiAqXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IHAxXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IHAyXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IHAzXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IHIxXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IHIyXHJcbiAqICBAcmV0dXJucyB7SW50ZXJzZWN0aW9ufVxyXG4gKi9cclxuSW50ZXJzZWN0aW9uLmludGVyc2VjdEJlemllcjJSZWN0YW5nbGUgPSBmdW5jdGlvbihwMSwgcDIsIHAzLCByMSwgcjIpIHtcclxuICAgIHZhciBtaW4gICAgICAgID0gcjEubWluKHIyKTtcclxuICAgIHZhciBtYXggICAgICAgID0gcjEubWF4KHIyKTtcclxuICAgIHZhciB0b3BSaWdodCAgID0gbmV3IFBvaW50MkQoIG1heC54LCBtaW4ueSApO1xyXG4gICAgdmFyIGJvdHRvbUxlZnQgPSBuZXcgUG9pbnQyRCggbWluLngsIG1heC55ICk7XHJcblxyXG4gICAgdmFyIGludGVyMSA9IEludGVyc2VjdGlvbi5pbnRlcnNlY3RCZXppZXIyTGluZShwMSwgcDIsIHAzLCBtaW4sIHRvcFJpZ2h0KTtcclxuICAgIHZhciBpbnRlcjIgPSBJbnRlcnNlY3Rpb24uaW50ZXJzZWN0QmV6aWVyMkxpbmUocDEsIHAyLCBwMywgdG9wUmlnaHQsIG1heCk7XHJcbiAgICB2YXIgaW50ZXIzID0gSW50ZXJzZWN0aW9uLmludGVyc2VjdEJlemllcjJMaW5lKHAxLCBwMiwgcDMsIG1heCwgYm90dG9tTGVmdCk7XHJcbiAgICB2YXIgaW50ZXI0ID0gSW50ZXJzZWN0aW9uLmludGVyc2VjdEJlemllcjJMaW5lKHAxLCBwMiwgcDMsIGJvdHRvbUxlZnQsIG1pbik7XHJcblxyXG4gICAgdmFyIHJlc3VsdCA9IG5ldyBJbnRlcnNlY3Rpb24oXCJObyBJbnRlcnNlY3Rpb25cIik7XHJcblxyXG4gICAgcmVzdWx0LmFwcGVuZFBvaW50cyhpbnRlcjEucG9pbnRzKTtcclxuICAgIHJlc3VsdC5hcHBlbmRQb2ludHMoaW50ZXIyLnBvaW50cyk7XHJcbiAgICByZXN1bHQuYXBwZW5kUG9pbnRzKGludGVyMy5wb2ludHMpO1xyXG4gICAgcmVzdWx0LmFwcGVuZFBvaW50cyhpbnRlcjQucG9pbnRzKTtcclxuXHJcbiAgICBpZiAoIHJlc3VsdC5wb2ludHMubGVuZ3RoID4gMCApIHJlc3VsdC5zdGF0dXMgPSBcIkludGVyc2VjdGlvblwiO1xyXG5cclxuICAgIHJldHVybiByZXN1bHQ7XHJcbn07XHJcblxyXG5cclxuLyoqXHJcbiAqICBpbnRlcnNlY3RCZXppZXIzQmV6aWVyM1xyXG4gKlxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBhMVxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBhMlxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBhM1xyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBhNFxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBiMVxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBiMlxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBiM1xyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBiNFxyXG4gKiAgQHJldHVybnMge0ludGVyc2VjdGlvbn1cclxuICovXHJcbkludGVyc2VjdGlvbi5pbnRlcnNlY3RCZXppZXIzQmV6aWVyMyA9IGZ1bmN0aW9uKGExLCBhMiwgYTMsIGE0LCBiMSwgYjIsIGIzLCBiNCkge1xyXG4gICAgdmFyIGEsIGIsIGMsIGQ7ICAgICAgICAgLy8gdGVtcG9yYXJ5IHZhcmlhYmxlc1xyXG4gICAgdmFyIGMxMywgYzEyLCBjMTEsIGMxMDsgLy8gY29lZmZpY2llbnRzIG9mIGN1YmljXHJcbiAgICB2YXIgYzIzLCBjMjIsIGMyMSwgYzIwOyAvLyBjb2VmZmljaWVudHMgb2YgY3ViaWNcclxuICAgIHZhciByZXN1bHQgPSBuZXcgSW50ZXJzZWN0aW9uKFwiTm8gSW50ZXJzZWN0aW9uXCIpO1xyXG5cclxuICAgIC8vIENhbGN1bGF0ZSB0aGUgY29lZmZpY2llbnRzIG9mIGN1YmljIHBvbHlub21pYWxcclxuICAgIGEgPSBhMS5tdWx0aXBseSgtMSk7XHJcbiAgICBiID0gYTIubXVsdGlwbHkoMyk7XHJcbiAgICBjID0gYTMubXVsdGlwbHkoLTMpO1xyXG4gICAgZCA9IGEuYWRkKGIuYWRkKGMuYWRkKGE0KSkpO1xyXG4gICAgYzEzID0gbmV3IFZlY3RvcjJEKGQueCwgZC55KTtcclxuXHJcbiAgICBhID0gYTEubXVsdGlwbHkoMyk7XHJcbiAgICBiID0gYTIubXVsdGlwbHkoLTYpO1xyXG4gICAgYyA9IGEzLm11bHRpcGx5KDMpO1xyXG4gICAgZCA9IGEuYWRkKGIuYWRkKGMpKTtcclxuICAgIGMxMiA9IG5ldyBWZWN0b3IyRChkLngsIGQueSk7XHJcblxyXG4gICAgYSA9IGExLm11bHRpcGx5KC0zKTtcclxuICAgIGIgPSBhMi5tdWx0aXBseSgzKTtcclxuICAgIGMgPSBhLmFkZChiKTtcclxuICAgIGMxMSA9IG5ldyBWZWN0b3IyRChjLngsIGMueSk7XHJcblxyXG4gICAgYzEwID0gbmV3IFZlY3RvcjJEKGExLngsIGExLnkpO1xyXG5cclxuICAgIGEgPSBiMS5tdWx0aXBseSgtMSk7XHJcbiAgICBiID0gYjIubXVsdGlwbHkoMyk7XHJcbiAgICBjID0gYjMubXVsdGlwbHkoLTMpO1xyXG4gICAgZCA9IGEuYWRkKGIuYWRkKGMuYWRkKGI0KSkpO1xyXG4gICAgYzIzID0gbmV3IFZlY3RvcjJEKGQueCwgZC55KTtcclxuXHJcbiAgICBhID0gYjEubXVsdGlwbHkoMyk7XHJcbiAgICBiID0gYjIubXVsdGlwbHkoLTYpO1xyXG4gICAgYyA9IGIzLm11bHRpcGx5KDMpO1xyXG4gICAgZCA9IGEuYWRkKGIuYWRkKGMpKTtcclxuICAgIGMyMiA9IG5ldyBWZWN0b3IyRChkLngsIGQueSk7XHJcblxyXG4gICAgYSA9IGIxLm11bHRpcGx5KC0zKTtcclxuICAgIGIgPSBiMi5tdWx0aXBseSgzKTtcclxuICAgIGMgPSBhLmFkZChiKTtcclxuICAgIGMyMSA9IG5ldyBWZWN0b3IyRChjLngsIGMueSk7XHJcblxyXG4gICAgYzIwID0gbmV3IFZlY3RvcjJEKGIxLngsIGIxLnkpO1xyXG5cclxuICAgIHZhciBjMTB4MiA9IGMxMC54KmMxMC54O1xyXG4gICAgdmFyIGMxMHgzID0gYzEwLngqYzEwLngqYzEwLng7XHJcbiAgICB2YXIgYzEweTIgPSBjMTAueSpjMTAueTtcclxuICAgIHZhciBjMTB5MyA9IGMxMC55KmMxMC55KmMxMC55O1xyXG4gICAgdmFyIGMxMXgyID0gYzExLngqYzExLng7XHJcbiAgICB2YXIgYzExeDMgPSBjMTEueCpjMTEueCpjMTEueDtcclxuICAgIHZhciBjMTF5MiA9IGMxMS55KmMxMS55O1xyXG4gICAgdmFyIGMxMXkzID0gYzExLnkqYzExLnkqYzExLnk7XHJcbiAgICB2YXIgYzEyeDIgPSBjMTIueCpjMTIueDtcclxuICAgIHZhciBjMTJ4MyA9IGMxMi54KmMxMi54KmMxMi54O1xyXG4gICAgdmFyIGMxMnkyID0gYzEyLnkqYzEyLnk7XHJcbiAgICB2YXIgYzEyeTMgPSBjMTIueSpjMTIueSpjMTIueTtcclxuICAgIHZhciBjMTN4MiA9IGMxMy54KmMxMy54O1xyXG4gICAgdmFyIGMxM3gzID0gYzEzLngqYzEzLngqYzEzLng7XHJcbiAgICB2YXIgYzEzeTIgPSBjMTMueSpjMTMueTtcclxuICAgIHZhciBjMTN5MyA9IGMxMy55KmMxMy55KmMxMy55O1xyXG4gICAgdmFyIGMyMHgyID0gYzIwLngqYzIwLng7XHJcbiAgICB2YXIgYzIweDMgPSBjMjAueCpjMjAueCpjMjAueDtcclxuICAgIHZhciBjMjB5MiA9IGMyMC55KmMyMC55O1xyXG4gICAgdmFyIGMyMHkzID0gYzIwLnkqYzIwLnkqYzIwLnk7XHJcbiAgICB2YXIgYzIxeDIgPSBjMjEueCpjMjEueDtcclxuICAgIHZhciBjMjF4MyA9IGMyMS54KmMyMS54KmMyMS54O1xyXG4gICAgdmFyIGMyMXkyID0gYzIxLnkqYzIxLnk7XHJcbiAgICB2YXIgYzIyeDIgPSBjMjIueCpjMjIueDtcclxuICAgIHZhciBjMjJ4MyA9IGMyMi54KmMyMi54KmMyMi54O1xyXG4gICAgdmFyIGMyMnkyID0gYzIyLnkqYzIyLnk7XHJcbiAgICB2YXIgYzIzeDIgPSBjMjMueCpjMjMueDtcclxuICAgIHZhciBjMjN4MyA9IGMyMy54KmMyMy54KmMyMy54O1xyXG4gICAgdmFyIGMyM3kyID0gYzIzLnkqYzIzLnk7XHJcbiAgICB2YXIgYzIzeTMgPSBjMjMueSpjMjMueSpjMjMueTtcclxuICAgIHZhciBwb2x5ID0gbmV3IFBvbHlub21pYWwoXHJcbiAgICAgICAgLWMxM3gzKmMyM3kzICsgYzEzeTMqYzIzeDMgLSAzKmMxMy54KmMxM3kyKmMyM3gyKmMyMy55ICtcclxuICAgICAgICAgICAgMypjMTN4MipjMTMueSpjMjMueCpjMjN5MixcclxuICAgICAgICAtNipjMTMueCpjMjIueCpjMTN5MipjMjMueCpjMjMueSArIDYqYzEzeDIqYzEzLnkqYzIyLnkqYzIzLngqYzIzLnkgKyAzKmMyMi54KmMxM3kzKmMyM3gyIC1cclxuICAgICAgICAgICAgMypjMTN4MypjMjIueSpjMjN5MiAtIDMqYzEzLngqYzEzeTIqYzIyLnkqYzIzeDIgKyAzKmMxM3gyKmMyMi54KmMxMy55KmMyM3kyLFxyXG4gICAgICAgIC02KmMyMS54KmMxMy54KmMxM3kyKmMyMy54KmMyMy55IC0gNipjMTMueCpjMjIueCpjMTN5MipjMjIueSpjMjMueCArIDYqYzEzeDIqYzIyLngqYzEzLnkqYzIyLnkqYzIzLnkgK1xyXG4gICAgICAgICAgICAzKmMyMS54KmMxM3kzKmMyM3gyICsgMypjMjJ4MipjMTN5MypjMjMueCArIDMqYzIxLngqYzEzeDIqYzEzLnkqYzIzeTIgLSAzKmMxMy54KmMyMS55KmMxM3kyKmMyM3gyIC1cclxuICAgICAgICAgICAgMypjMTMueCpjMjJ4MipjMTN5MipjMjMueSArIGMxM3gyKmMxMy55KmMyMy54Kig2KmMyMS55KmMyMy55ICsgMypjMjJ5MikgKyBjMTN4MyooLWMyMS55KmMyM3kyIC1cclxuICAgICAgICAgICAgMipjMjJ5MipjMjMueSAtIGMyMy55KigyKmMyMS55KmMyMy55ICsgYzIyeTIpKSxcclxuICAgICAgICBjMTEueCpjMTIueSpjMTMueCpjMTMueSpjMjMueCpjMjMueSAtIGMxMS55KmMxMi54KmMxMy54KmMxMy55KmMyMy54KmMyMy55ICsgNipjMjEueCpjMjIueCpjMTN5MypjMjMueCArXHJcbiAgICAgICAgICAgIDMqYzExLngqYzEyLngqYzEzLngqYzEzLnkqYzIzeTIgKyA2KmMxMC54KmMxMy54KmMxM3kyKmMyMy54KmMyMy55IC0gMypjMTEueCpjMTIueCpjMTN5MipjMjMueCpjMjMueSAtXHJcbiAgICAgICAgICAgIDMqYzExLnkqYzEyLnkqYzEzLngqYzEzLnkqYzIzeDIgLSA2KmMxMC55KmMxM3gyKmMxMy55KmMyMy54KmMyMy55IC0gNipjMjAueCpjMTMueCpjMTN5MipjMjMueCpjMjMueSArXHJcbiAgICAgICAgICAgIDMqYzExLnkqYzEyLnkqYzEzeDIqYzIzLngqYzIzLnkgLSAyKmMxMi54KmMxMnkyKmMxMy54KmMyMy54KmMyMy55IC0gNipjMjEueCpjMTMueCpjMjIueCpjMTN5MipjMjMueSAtXHJcbiAgICAgICAgICAgIDYqYzIxLngqYzEzLngqYzEzeTIqYzIyLnkqYzIzLnggLSA2KmMxMy54KmMyMS55KmMyMi54KmMxM3kyKmMyMy54ICsgNipjMjEueCpjMTN4MipjMTMueSpjMjIueSpjMjMueSArXHJcbiAgICAgICAgICAgIDIqYzEyeDIqYzEyLnkqYzEzLnkqYzIzLngqYzIzLnkgKyBjMjJ4MypjMTN5MyAtIDMqYzEwLngqYzEzeTMqYzIzeDIgKyAzKmMxMC55KmMxM3gzKmMyM3kyICtcclxuICAgICAgICAgICAgMypjMjAueCpjMTN5MypjMjN4MiArIGMxMnkzKmMxMy54KmMyM3gyIC0gYzEyeDMqYzEzLnkqYzIzeTIgLSAzKmMxMC54KmMxM3gyKmMxMy55KmMyM3kyICtcclxuICAgICAgICAgICAgMypjMTAueSpjMTMueCpjMTN5MipjMjN4MiAtIDIqYzExLngqYzEyLnkqYzEzeDIqYzIzeTIgKyBjMTEueCpjMTIueSpjMTN5MipjMjN4MiAtIGMxMS55KmMxMi54KmMxM3gyKmMyM3kyICtcclxuICAgICAgICAgICAgMipjMTEueSpjMTIueCpjMTN5MipjMjN4MiArIDMqYzIwLngqYzEzeDIqYzEzLnkqYzIzeTIgLSBjMTIueCpjMTJ5MipjMTMueSpjMjN4MiAtXHJcbiAgICAgICAgICAgIDMqYzIwLnkqYzEzLngqYzEzeTIqYzIzeDIgKyBjMTJ4MipjMTIueSpjMTMueCpjMjN5MiAtIDMqYzEzLngqYzIyeDIqYzEzeTIqYzIyLnkgK1xyXG4gICAgICAgICAgICBjMTN4MipjMTMueSpjMjMueCooNipjMjAueSpjMjMueSArIDYqYzIxLnkqYzIyLnkpICsgYzEzeDIqYzIyLngqYzEzLnkqKDYqYzIxLnkqYzIzLnkgKyAzKmMyMnkyKSArXHJcbiAgICAgICAgICAgIGMxM3gzKigtMipjMjEueSpjMjIueSpjMjMueSAtIGMyMC55KmMyM3kyIC0gYzIyLnkqKDIqYzIxLnkqYzIzLnkgKyBjMjJ5MikgLSBjMjMueSooMipjMjAueSpjMjMueSArIDIqYzIxLnkqYzIyLnkpKSxcclxuICAgICAgICA2KmMxMS54KmMxMi54KmMxMy54KmMxMy55KmMyMi55KmMyMy55ICsgYzExLngqYzEyLnkqYzEzLngqYzIyLngqYzEzLnkqYzIzLnkgKyBjMTEueCpjMTIueSpjMTMueCpjMTMueSpjMjIueSpjMjMueCAtXHJcbiAgICAgICAgICAgIGMxMS55KmMxMi54KmMxMy54KmMyMi54KmMxMy55KmMyMy55IC0gYzExLnkqYzEyLngqYzEzLngqYzEzLnkqYzIyLnkqYzIzLnggLSA2KmMxMS55KmMxMi55KmMxMy54KmMyMi54KmMxMy55KmMyMy54IC1cclxuICAgICAgICAgICAgNipjMTAueCpjMjIueCpjMTN5MypjMjMueCArIDYqYzIwLngqYzIyLngqYzEzeTMqYzIzLnggKyA2KmMxMC55KmMxM3gzKmMyMi55KmMyMy55ICsgMipjMTJ5MypjMTMueCpjMjIueCpjMjMueCAtXHJcbiAgICAgICAgICAgIDIqYzEyeDMqYzEzLnkqYzIyLnkqYzIzLnkgKyA2KmMxMC54KmMxMy54KmMyMi54KmMxM3kyKmMyMy55ICsgNipjMTAueCpjMTMueCpjMTN5MipjMjIueSpjMjMueCArXHJcbiAgICAgICAgICAgIDYqYzEwLnkqYzEzLngqYzIyLngqYzEzeTIqYzIzLnggLSAzKmMxMS54KmMxMi54KmMyMi54KmMxM3kyKmMyMy55IC0gMypjMTEueCpjMTIueCpjMTN5MipjMjIueSpjMjMueCArXHJcbiAgICAgICAgICAgIDIqYzExLngqYzEyLnkqYzIyLngqYzEzeTIqYzIzLnggKyA0KmMxMS55KmMxMi54KmMyMi54KmMxM3kyKmMyMy54IC0gNipjMTAueCpjMTN4MipjMTMueSpjMjIueSpjMjMueSAtXHJcbiAgICAgICAgICAgIDYqYzEwLnkqYzEzeDIqYzIyLngqYzEzLnkqYzIzLnkgLSA2KmMxMC55KmMxM3gyKmMxMy55KmMyMi55KmMyMy54IC0gNCpjMTEueCpjMTIueSpjMTN4MipjMjIueSpjMjMueSAtXHJcbiAgICAgICAgICAgIDYqYzIwLngqYzEzLngqYzIyLngqYzEzeTIqYzIzLnkgLSA2KmMyMC54KmMxMy54KmMxM3kyKmMyMi55KmMyMy54IC0gMipjMTEueSpjMTIueCpjMTN4MipjMjIueSpjMjMueSArXHJcbiAgICAgICAgICAgIDMqYzExLnkqYzEyLnkqYzEzeDIqYzIyLngqYzIzLnkgKyAzKmMxMS55KmMxMi55KmMxM3gyKmMyMi55KmMyMy54IC0gMipjMTIueCpjMTJ5MipjMTMueCpjMjIueCpjMjMueSAtXHJcbiAgICAgICAgICAgIDIqYzEyLngqYzEyeTIqYzEzLngqYzIyLnkqYzIzLnggLSAyKmMxMi54KmMxMnkyKmMyMi54KmMxMy55KmMyMy54IC0gNipjMjAueSpjMTMueCpjMjIueCpjMTN5MipjMjMueCAtXHJcbiAgICAgICAgICAgIDYqYzIxLngqYzEzLngqYzIxLnkqYzEzeTIqYzIzLnggLSA2KmMyMS54KmMxMy54KmMyMi54KmMxM3kyKmMyMi55ICsgNipjMjAueCpjMTN4MipjMTMueSpjMjIueSpjMjMueSArXHJcbiAgICAgICAgICAgIDIqYzEyeDIqYzEyLnkqYzEzLngqYzIyLnkqYzIzLnkgKyAyKmMxMngyKmMxMi55KmMyMi54KmMxMy55KmMyMy55ICsgMipjMTJ4MipjMTIueSpjMTMueSpjMjIueSpjMjMueCArXHJcbiAgICAgICAgICAgIDMqYzIxLngqYzIyeDIqYzEzeTMgKyAzKmMyMXgyKmMxM3kzKmMyMy54IC0gMypjMTMueCpjMjEueSpjMjJ4MipjMTN5MiAtIDMqYzIxeDIqYzEzLngqYzEzeTIqYzIzLnkgK1xyXG4gICAgICAgICAgICBjMTN4MipjMjIueCpjMTMueSooNipjMjAueSpjMjMueSArIDYqYzIxLnkqYzIyLnkpICsgYzEzeDIqYzEzLnkqYzIzLngqKDYqYzIwLnkqYzIyLnkgKyAzKmMyMXkyKSArXHJcbiAgICAgICAgICAgIGMyMS54KmMxM3gyKmMxMy55Kig2KmMyMS55KmMyMy55ICsgMypjMjJ5MikgKyBjMTN4MyooLTIqYzIwLnkqYzIyLnkqYzIzLnkgLSBjMjMueSooMipjMjAueSpjMjIueSArIGMyMXkyKSAtXHJcbiAgICAgICAgICAgIGMyMS55KigyKmMyMS55KmMyMy55ICsgYzIyeTIpIC0gYzIyLnkqKDIqYzIwLnkqYzIzLnkgKyAyKmMyMS55KmMyMi55KSksXHJcbiAgICAgICAgYzExLngqYzIxLngqYzEyLnkqYzEzLngqYzEzLnkqYzIzLnkgKyBjMTEueCpjMTIueSpjMTMueCpjMjEueSpjMTMueSpjMjMueCArIGMxMS54KmMxMi55KmMxMy54KmMyMi54KmMxMy55KmMyMi55IC1cclxuICAgICAgICAgICAgYzExLnkqYzEyLngqYzIxLngqYzEzLngqYzEzLnkqYzIzLnkgLSBjMTEueSpjMTIueCpjMTMueCpjMjEueSpjMTMueSpjMjMueCAtIGMxMS55KmMxMi54KmMxMy54KmMyMi54KmMxMy55KmMyMi55IC1cclxuICAgICAgICAgICAgNipjMTEueSpjMjEueCpjMTIueSpjMTMueCpjMTMueSpjMjMueCAtIDYqYzEwLngqYzIxLngqYzEzeTMqYzIzLnggKyA2KmMyMC54KmMyMS54KmMxM3kzKmMyMy54ICtcclxuICAgICAgICAgICAgMipjMjEueCpjMTJ5MypjMTMueCpjMjMueCArIDYqYzEwLngqYzIxLngqYzEzLngqYzEzeTIqYzIzLnkgKyA2KmMxMC54KmMxMy54KmMyMS55KmMxM3kyKmMyMy54ICtcclxuICAgICAgICAgICAgNipjMTAueCpjMTMueCpjMjIueCpjMTN5MipjMjIueSArIDYqYzEwLnkqYzIxLngqYzEzLngqYzEzeTIqYzIzLnggLSAzKmMxMS54KmMxMi54KmMyMS54KmMxM3kyKmMyMy55IC1cclxuICAgICAgICAgICAgMypjMTEueCpjMTIueCpjMjEueSpjMTN5MipjMjMueCAtIDMqYzExLngqYzEyLngqYzIyLngqYzEzeTIqYzIyLnkgKyAyKmMxMS54KmMyMS54KmMxMi55KmMxM3kyKmMyMy54ICtcclxuICAgICAgICAgICAgNCpjMTEueSpjMTIueCpjMjEueCpjMTN5MipjMjMueCAtIDYqYzEwLnkqYzIxLngqYzEzeDIqYzEzLnkqYzIzLnkgLSA2KmMxMC55KmMxM3gyKmMyMS55KmMxMy55KmMyMy54IC1cclxuICAgICAgICAgICAgNipjMTAueSpjMTN4MipjMjIueCpjMTMueSpjMjIueSAtIDYqYzIwLngqYzIxLngqYzEzLngqYzEzeTIqYzIzLnkgLSA2KmMyMC54KmMxMy54KmMyMS55KmMxM3kyKmMyMy54IC1cclxuICAgICAgICAgICAgNipjMjAueCpjMTMueCpjMjIueCpjMTN5MipjMjIueSArIDMqYzExLnkqYzIxLngqYzEyLnkqYzEzeDIqYzIzLnkgLSAzKmMxMS55KmMxMi55KmMxMy54KmMyMngyKmMxMy55ICtcclxuICAgICAgICAgICAgMypjMTEueSpjMTIueSpjMTN4MipjMjEueSpjMjMueCArIDMqYzExLnkqYzEyLnkqYzEzeDIqYzIyLngqYzIyLnkgLSAyKmMxMi54KmMyMS54KmMxMnkyKmMxMy54KmMyMy55IC1cclxuICAgICAgICAgICAgMipjMTIueCpjMjEueCpjMTJ5MipjMTMueSpjMjMueCAtIDIqYzEyLngqYzEyeTIqYzEzLngqYzIxLnkqYzIzLnggLSAyKmMxMi54KmMxMnkyKmMxMy54KmMyMi54KmMyMi55IC1cclxuICAgICAgICAgICAgNipjMjAueSpjMjEueCpjMTMueCpjMTN5MipjMjMueCAtIDYqYzIxLngqYzEzLngqYzIxLnkqYzIyLngqYzEzeTIgKyA2KmMyMC55KmMxM3gyKmMyMS55KmMxMy55KmMyMy54ICtcclxuICAgICAgICAgICAgMipjMTJ4MipjMjEueCpjMTIueSpjMTMueSpjMjMueSArIDIqYzEyeDIqYzEyLnkqYzIxLnkqYzEzLnkqYzIzLnggKyAyKmMxMngyKmMxMi55KmMyMi54KmMxMy55KmMyMi55IC1cclxuICAgICAgICAgICAgMypjMTAueCpjMjJ4MipjMTN5MyArIDMqYzIwLngqYzIyeDIqYzEzeTMgKyAzKmMyMXgyKmMyMi54KmMxM3kzICsgYzEyeTMqYzEzLngqYzIyeDIgK1xyXG4gICAgICAgICAgICAzKmMxMC55KmMxMy54KmMyMngyKmMxM3kyICsgYzExLngqYzEyLnkqYzIyeDIqYzEzeTIgKyAyKmMxMS55KmMxMi54KmMyMngyKmMxM3kyIC1cclxuICAgICAgICAgICAgYzEyLngqYzEyeTIqYzIyeDIqYzEzLnkgLSAzKmMyMC55KmMxMy54KmMyMngyKmMxM3kyIC0gMypjMjF4MipjMTMueCpjMTN5MipjMjIueSArXHJcbiAgICAgICAgICAgIGMxMngyKmMxMi55KmMxMy54KigyKmMyMS55KmMyMy55ICsgYzIyeTIpICsgYzExLngqYzEyLngqYzEzLngqYzEzLnkqKDYqYzIxLnkqYzIzLnkgKyAzKmMyMnkyKSArXHJcbiAgICAgICAgICAgIGMyMS54KmMxM3gyKmMxMy55Kig2KmMyMC55KmMyMy55ICsgNipjMjEueSpjMjIueSkgKyBjMTJ4MypjMTMueSooLTIqYzIxLnkqYzIzLnkgLSBjMjJ5MikgK1xyXG4gICAgICAgICAgICBjMTAueSpjMTN4MyooNipjMjEueSpjMjMueSArIDMqYzIyeTIpICsgYzExLnkqYzEyLngqYzEzeDIqKC0yKmMyMS55KmMyMy55IC0gYzIyeTIpICtcclxuICAgICAgICAgICAgYzExLngqYzEyLnkqYzEzeDIqKC00KmMyMS55KmMyMy55IC0gMipjMjJ5MikgKyBjMTAueCpjMTN4MipjMTMueSooLTYqYzIxLnkqYzIzLnkgLSAzKmMyMnkyKSArXHJcbiAgICAgICAgICAgIGMxM3gyKmMyMi54KmMxMy55Kig2KmMyMC55KmMyMi55ICsgMypjMjF5MikgKyBjMjAueCpjMTN4MipjMTMueSooNipjMjEueSpjMjMueSArIDMqYzIyeTIpICtcclxuICAgICAgICAgICAgYzEzeDMqKC0yKmMyMC55KmMyMS55KmMyMy55IC0gYzIyLnkqKDIqYzIwLnkqYzIyLnkgKyBjMjF5MikgLSBjMjAueSooMipjMjEueSpjMjMueSArIGMyMnkyKSAtXHJcbiAgICAgICAgICAgIGMyMS55KigyKmMyMC55KmMyMy55ICsgMipjMjEueSpjMjIueSkpLFxyXG4gICAgICAgIC1jMTAueCpjMTEueCpjMTIueSpjMTMueCpjMTMueSpjMjMueSArIGMxMC54KmMxMS55KmMxMi54KmMxMy54KmMxMy55KmMyMy55ICsgNipjMTAueCpjMTEueSpjMTIueSpjMTMueCpjMTMueSpjMjMueCAtXHJcbiAgICAgICAgICAgIDYqYzEwLnkqYzExLngqYzEyLngqYzEzLngqYzEzLnkqYzIzLnkgLSBjMTAueSpjMTEueCpjMTIueSpjMTMueCpjMTMueSpjMjMueCArIGMxMC55KmMxMS55KmMxMi54KmMxMy54KmMxMy55KmMyMy54ICtcclxuICAgICAgICAgICAgYzExLngqYzExLnkqYzEyLngqYzEyLnkqYzEzLngqYzIzLnkgLSBjMTEueCpjMTEueSpjMTIueCpjMTIueSpjMTMueSpjMjMueCArIGMxMS54KmMyMC54KmMxMi55KmMxMy54KmMxMy55KmMyMy55ICtcclxuICAgICAgICAgICAgYzExLngqYzIwLnkqYzEyLnkqYzEzLngqYzEzLnkqYzIzLnggKyBjMTEueCpjMjEueCpjMTIueSpjMTMueCpjMTMueSpjMjIueSArIGMxMS54KmMxMi55KmMxMy54KmMyMS55KmMyMi54KmMxMy55IC1cclxuICAgICAgICAgICAgYzIwLngqYzExLnkqYzEyLngqYzEzLngqYzEzLnkqYzIzLnkgLSA2KmMyMC54KmMxMS55KmMxMi55KmMxMy54KmMxMy55KmMyMy54IC0gYzExLnkqYzEyLngqYzIwLnkqYzEzLngqYzEzLnkqYzIzLnggLVxyXG4gICAgICAgICAgICBjMTEueSpjMTIueCpjMjEueCpjMTMueCpjMTMueSpjMjIueSAtIGMxMS55KmMxMi54KmMxMy54KmMyMS55KmMyMi54KmMxMy55IC0gNipjMTEueSpjMjEueCpjMTIueSpjMTMueCpjMjIueCpjMTMueSAtXHJcbiAgICAgICAgICAgIDYqYzEwLngqYzIwLngqYzEzeTMqYzIzLnggLSA2KmMxMC54KmMyMS54KmMyMi54KmMxM3kzIC0gMipjMTAueCpjMTJ5MypjMTMueCpjMjMueCArIDYqYzIwLngqYzIxLngqYzIyLngqYzEzeTMgK1xyXG4gICAgICAgICAgICAyKmMyMC54KmMxMnkzKmMxMy54KmMyMy54ICsgMipjMjEueCpjMTJ5MypjMTMueCpjMjIueCArIDIqYzEwLnkqYzEyeDMqYzEzLnkqYzIzLnkgLSA2KmMxMC54KmMxMC55KmMxMy54KmMxM3kyKmMyMy54ICtcclxuICAgICAgICAgICAgMypjMTAueCpjMTEueCpjMTIueCpjMTN5MipjMjMueSAtIDIqYzEwLngqYzExLngqYzEyLnkqYzEzeTIqYzIzLnggLSA0KmMxMC54KmMxMS55KmMxMi54KmMxM3kyKmMyMy54ICtcclxuICAgICAgICAgICAgMypjMTAueSpjMTEueCpjMTIueCpjMTN5MipjMjMueCArIDYqYzEwLngqYzEwLnkqYzEzeDIqYzEzLnkqYzIzLnkgKyA2KmMxMC54KmMyMC54KmMxMy54KmMxM3kyKmMyMy55IC1cclxuICAgICAgICAgICAgMypjMTAueCpjMTEueSpjMTIueSpjMTN4MipjMjMueSArIDIqYzEwLngqYzEyLngqYzEyeTIqYzEzLngqYzIzLnkgKyAyKmMxMC54KmMxMi54KmMxMnkyKmMxMy55KmMyMy54ICtcclxuICAgICAgICAgICAgNipjMTAueCpjMjAueSpjMTMueCpjMTN5MipjMjMueCArIDYqYzEwLngqYzIxLngqYzEzLngqYzEzeTIqYzIyLnkgKyA2KmMxMC54KmMxMy54KmMyMS55KmMyMi54KmMxM3kyICtcclxuICAgICAgICAgICAgNCpjMTAueSpjMTEueCpjMTIueSpjMTN4MipjMjMueSArIDYqYzEwLnkqYzIwLngqYzEzLngqYzEzeTIqYzIzLnggKyAyKmMxMC55KmMxMS55KmMxMi54KmMxM3gyKmMyMy55IC1cclxuICAgICAgICAgICAgMypjMTAueSpjMTEueSpjMTIueSpjMTN4MipjMjMueCArIDIqYzEwLnkqYzEyLngqYzEyeTIqYzEzLngqYzIzLnggKyA2KmMxMC55KmMyMS54KmMxMy54KmMyMi54KmMxM3kyIC1cclxuICAgICAgICAgICAgMypjMTEueCpjMjAueCpjMTIueCpjMTN5MipjMjMueSArIDIqYzExLngqYzIwLngqYzEyLnkqYzEzeTIqYzIzLnggKyBjMTEueCpjMTEueSpjMTJ5MipjMTMueCpjMjMueCAtXHJcbiAgICAgICAgICAgIDMqYzExLngqYzEyLngqYzIwLnkqYzEzeTIqYzIzLnggLSAzKmMxMS54KmMxMi54KmMyMS54KmMxM3kyKmMyMi55IC0gMypjMTEueCpjMTIueCpjMjEueSpjMjIueCpjMTN5MiArXHJcbiAgICAgICAgICAgIDIqYzExLngqYzIxLngqYzEyLnkqYzIyLngqYzEzeTIgKyA0KmMyMC54KmMxMS55KmMxMi54KmMxM3kyKmMyMy54ICsgNCpjMTEueSpjMTIueCpjMjEueCpjMjIueCpjMTN5MiAtXHJcbiAgICAgICAgICAgIDIqYzEwLngqYzEyeDIqYzEyLnkqYzEzLnkqYzIzLnkgLSA2KmMxMC55KmMyMC54KmMxM3gyKmMxMy55KmMyMy55IC0gNipjMTAueSpjMjAueSpjMTN4MipjMTMueSpjMjMueCAtXHJcbiAgICAgICAgICAgIDYqYzEwLnkqYzIxLngqYzEzeDIqYzEzLnkqYzIyLnkgLSAyKmMxMC55KmMxMngyKmMxMi55KmMxMy54KmMyMy55IC0gMipjMTAueSpjMTJ4MipjMTIueSpjMTMueSpjMjMueCAtXHJcbiAgICAgICAgICAgIDYqYzEwLnkqYzEzeDIqYzIxLnkqYzIyLngqYzEzLnkgLSBjMTEueCpjMTEueSpjMTJ4MipjMTMueSpjMjMueSAtIDIqYzExLngqYzExeTIqYzEzLngqYzEzLnkqYzIzLnggK1xyXG4gICAgICAgICAgICAzKmMyMC54KmMxMS55KmMxMi55KmMxM3gyKmMyMy55IC0gMipjMjAueCpjMTIueCpjMTJ5MipjMTMueCpjMjMueSAtIDIqYzIwLngqYzEyLngqYzEyeTIqYzEzLnkqYzIzLnggLVxyXG4gICAgICAgICAgICA2KmMyMC54KmMyMC55KmMxMy54KmMxM3kyKmMyMy54IC0gNipjMjAueCpjMjEueCpjMTMueCpjMTN5MipjMjIueSAtIDYqYzIwLngqYzEzLngqYzIxLnkqYzIyLngqYzEzeTIgK1xyXG4gICAgICAgICAgICAzKmMxMS55KmMyMC55KmMxMi55KmMxM3gyKmMyMy54ICsgMypjMTEueSpjMjEueCpjMTIueSpjMTN4MipjMjIueSArIDMqYzExLnkqYzEyLnkqYzEzeDIqYzIxLnkqYzIyLnggLVxyXG4gICAgICAgICAgICAyKmMxMi54KmMyMC55KmMxMnkyKmMxMy54KmMyMy54IC0gMipjMTIueCpjMjEueCpjMTJ5MipjMTMueCpjMjIueSAtIDIqYzEyLngqYzIxLngqYzEyeTIqYzIyLngqYzEzLnkgLVxyXG4gICAgICAgICAgICAyKmMxMi54KmMxMnkyKmMxMy54KmMyMS55KmMyMi54IC0gNipjMjAueSpjMjEueCpjMTMueCpjMjIueCpjMTN5MiAtIGMxMXkyKmMxMi54KmMxMi55KmMxMy54KmMyMy54ICtcclxuICAgICAgICAgICAgMipjMjAueCpjMTJ4MipjMTIueSpjMTMueSpjMjMueSArIDYqYzIwLnkqYzEzeDIqYzIxLnkqYzIyLngqYzEzLnkgKyAyKmMxMXgyKmMxMS55KmMxMy54KmMxMy55KmMyMy55ICtcclxuICAgICAgICAgICAgYzExeDIqYzEyLngqYzEyLnkqYzEzLnkqYzIzLnkgKyAyKmMxMngyKmMyMC55KmMxMi55KmMxMy55KmMyMy54ICsgMipjMTJ4MipjMjEueCpjMTIueSpjMTMueSpjMjIueSArXHJcbiAgICAgICAgICAgIDIqYzEyeDIqYzEyLnkqYzIxLnkqYzIyLngqYzEzLnkgKyBjMjF4MypjMTN5MyArIDMqYzEweDIqYzEzeTMqYzIzLnggLSAzKmMxMHkyKmMxM3gzKmMyMy55ICtcclxuICAgICAgICAgICAgMypjMjB4MipjMTN5MypjMjMueCArIGMxMXkzKmMxM3gyKmMyMy54IC0gYzExeDMqYzEzeTIqYzIzLnkgLSBjMTEueCpjMTF5MipjMTN4MipjMjMueSArXHJcbiAgICAgICAgICAgIGMxMXgyKmMxMS55KmMxM3kyKmMyMy54IC0gMypjMTB4MipjMTMueCpjMTN5MipjMjMueSArIDMqYzEweTIqYzEzeDIqYzEzLnkqYzIzLnggLSBjMTF4MipjMTJ5MipjMTMueCpjMjMueSArXHJcbiAgICAgICAgICAgIGMxMXkyKmMxMngyKmMxMy55KmMyMy54IC0gMypjMjF4MipjMTMueCpjMjEueSpjMTN5MiAtIDMqYzIweDIqYzEzLngqYzEzeTIqYzIzLnkgKyAzKmMyMHkyKmMxM3gyKmMxMy55KmMyMy54ICtcclxuICAgICAgICAgICAgYzExLngqYzEyLngqYzEzLngqYzEzLnkqKDYqYzIwLnkqYzIzLnkgKyA2KmMyMS55KmMyMi55KSArIGMxMngzKmMxMy55KigtMipjMjAueSpjMjMueSAtIDIqYzIxLnkqYzIyLnkpICtcclxuICAgICAgICAgICAgYzEwLnkqYzEzeDMqKDYqYzIwLnkqYzIzLnkgKyA2KmMyMS55KmMyMi55KSArIGMxMS55KmMxMi54KmMxM3gyKigtMipjMjAueSpjMjMueSAtIDIqYzIxLnkqYzIyLnkpICtcclxuICAgICAgICAgICAgYzEyeDIqYzEyLnkqYzEzLngqKDIqYzIwLnkqYzIzLnkgKyAyKmMyMS55KmMyMi55KSArIGMxMS54KmMxMi55KmMxM3gyKigtNCpjMjAueSpjMjMueSAtIDQqYzIxLnkqYzIyLnkpICtcclxuICAgICAgICAgICAgYzEwLngqYzEzeDIqYzEzLnkqKC02KmMyMC55KmMyMy55IC0gNipjMjEueSpjMjIueSkgKyBjMjAueCpjMTN4MipjMTMueSooNipjMjAueSpjMjMueSArIDYqYzIxLnkqYzIyLnkpICtcclxuICAgICAgICAgICAgYzIxLngqYzEzeDIqYzEzLnkqKDYqYzIwLnkqYzIyLnkgKyAzKmMyMXkyKSArIGMxM3gzKigtMipjMjAueSpjMjEueSpjMjIueSAtIGMyMHkyKmMyMy55IC1cclxuICAgICAgICAgICAgYzIxLnkqKDIqYzIwLnkqYzIyLnkgKyBjMjF5MikgLSBjMjAueSooMipjMjAueSpjMjMueSArIDIqYzIxLnkqYzIyLnkpKSxcclxuICAgICAgICAtYzEwLngqYzExLngqYzEyLnkqYzEzLngqYzEzLnkqYzIyLnkgKyBjMTAueCpjMTEueSpjMTIueCpjMTMueCpjMTMueSpjMjIueSArIDYqYzEwLngqYzExLnkqYzEyLnkqYzEzLngqYzIyLngqYzEzLnkgLVxyXG4gICAgICAgICAgICA2KmMxMC55KmMxMS54KmMxMi54KmMxMy54KmMxMy55KmMyMi55IC0gYzEwLnkqYzExLngqYzEyLnkqYzEzLngqYzIyLngqYzEzLnkgKyBjMTAueSpjMTEueSpjMTIueCpjMTMueCpjMjIueCpjMTMueSArXHJcbiAgICAgICAgICAgIGMxMS54KmMxMS55KmMxMi54KmMxMi55KmMxMy54KmMyMi55IC0gYzExLngqYzExLnkqYzEyLngqYzEyLnkqYzIyLngqYzEzLnkgKyBjMTEueCpjMjAueCpjMTIueSpjMTMueCpjMTMueSpjMjIueSArXHJcbiAgICAgICAgICAgIGMxMS54KmMyMC55KmMxMi55KmMxMy54KmMyMi54KmMxMy55ICsgYzExLngqYzIxLngqYzEyLnkqYzEzLngqYzIxLnkqYzEzLnkgLSBjMjAueCpjMTEueSpjMTIueCpjMTMueCpjMTMueSpjMjIueSAtXHJcbiAgICAgICAgICAgIDYqYzIwLngqYzExLnkqYzEyLnkqYzEzLngqYzIyLngqYzEzLnkgLSBjMTEueSpjMTIueCpjMjAueSpjMTMueCpjMjIueCpjMTMueSAtIGMxMS55KmMxMi54KmMyMS54KmMxMy54KmMyMS55KmMxMy55IC1cclxuICAgICAgICAgICAgNipjMTAueCpjMjAueCpjMjIueCpjMTN5MyAtIDIqYzEwLngqYzEyeTMqYzEzLngqYzIyLnggKyAyKmMyMC54KmMxMnkzKmMxMy54KmMyMi54ICsgMipjMTAueSpjMTJ4MypjMTMueSpjMjIueSAtXHJcbiAgICAgICAgICAgIDYqYzEwLngqYzEwLnkqYzEzLngqYzIyLngqYzEzeTIgKyAzKmMxMC54KmMxMS54KmMxMi54KmMxM3kyKmMyMi55IC0gMipjMTAueCpjMTEueCpjMTIueSpjMjIueCpjMTN5MiAtXHJcbiAgICAgICAgICAgIDQqYzEwLngqYzExLnkqYzEyLngqYzIyLngqYzEzeTIgKyAzKmMxMC55KmMxMS54KmMxMi54KmMyMi54KmMxM3kyICsgNipjMTAueCpjMTAueSpjMTN4MipjMTMueSpjMjIueSArXHJcbiAgICAgICAgICAgIDYqYzEwLngqYzIwLngqYzEzLngqYzEzeTIqYzIyLnkgLSAzKmMxMC54KmMxMS55KmMxMi55KmMxM3gyKmMyMi55ICsgMipjMTAueCpjMTIueCpjMTJ5MipjMTMueCpjMjIueSArXHJcbiAgICAgICAgICAgIDIqYzEwLngqYzEyLngqYzEyeTIqYzIyLngqYzEzLnkgKyA2KmMxMC54KmMyMC55KmMxMy54KmMyMi54KmMxM3kyICsgNipjMTAueCpjMjEueCpjMTMueCpjMjEueSpjMTN5MiArXHJcbiAgICAgICAgICAgIDQqYzEwLnkqYzExLngqYzEyLnkqYzEzeDIqYzIyLnkgKyA2KmMxMC55KmMyMC54KmMxMy54KmMyMi54KmMxM3kyICsgMipjMTAueSpjMTEueSpjMTIueCpjMTN4MipjMjIueSAtXHJcbiAgICAgICAgICAgIDMqYzEwLnkqYzExLnkqYzEyLnkqYzEzeDIqYzIyLnggKyAyKmMxMC55KmMxMi54KmMxMnkyKmMxMy54KmMyMi54IC0gMypjMTEueCpjMjAueCpjMTIueCpjMTN5MipjMjIueSArXHJcbiAgICAgICAgICAgIDIqYzExLngqYzIwLngqYzEyLnkqYzIyLngqYzEzeTIgKyBjMTEueCpjMTEueSpjMTJ5MipjMTMueCpjMjIueCAtIDMqYzExLngqYzEyLngqYzIwLnkqYzIyLngqYzEzeTIgLVxyXG4gICAgICAgICAgICAzKmMxMS54KmMxMi54KmMyMS54KmMyMS55KmMxM3kyICsgNCpjMjAueCpjMTEueSpjMTIueCpjMjIueCpjMTN5MiAtIDIqYzEwLngqYzEyeDIqYzEyLnkqYzEzLnkqYzIyLnkgLVxyXG4gICAgICAgICAgICA2KmMxMC55KmMyMC54KmMxM3gyKmMxMy55KmMyMi55IC0gNipjMTAueSpjMjAueSpjMTN4MipjMjIueCpjMTMueSAtIDYqYzEwLnkqYzIxLngqYzEzeDIqYzIxLnkqYzEzLnkgLVxyXG4gICAgICAgICAgICAyKmMxMC55KmMxMngyKmMxMi55KmMxMy54KmMyMi55IC0gMipjMTAueSpjMTJ4MipjMTIueSpjMjIueCpjMTMueSAtIGMxMS54KmMxMS55KmMxMngyKmMxMy55KmMyMi55IC1cclxuICAgICAgICAgICAgMipjMTEueCpjMTF5MipjMTMueCpjMjIueCpjMTMueSArIDMqYzIwLngqYzExLnkqYzEyLnkqYzEzeDIqYzIyLnkgLSAyKmMyMC54KmMxMi54KmMxMnkyKmMxMy54KmMyMi55IC1cclxuICAgICAgICAgICAgMipjMjAueCpjMTIueCpjMTJ5MipjMjIueCpjMTMueSAtIDYqYzIwLngqYzIwLnkqYzEzLngqYzIyLngqYzEzeTIgLSA2KmMyMC54KmMyMS54KmMxMy54KmMyMS55KmMxM3kyICtcclxuICAgICAgICAgICAgMypjMTEueSpjMjAueSpjMTIueSpjMTN4MipjMjIueCArIDMqYzExLnkqYzIxLngqYzEyLnkqYzEzeDIqYzIxLnkgLSAyKmMxMi54KmMyMC55KmMxMnkyKmMxMy54KmMyMi54IC1cclxuICAgICAgICAgICAgMipjMTIueCpjMjEueCpjMTJ5MipjMTMueCpjMjEueSAtIGMxMXkyKmMxMi54KmMxMi55KmMxMy54KmMyMi54ICsgMipjMjAueCpjMTJ4MipjMTIueSpjMTMueSpjMjIueSAtXHJcbiAgICAgICAgICAgIDMqYzExLnkqYzIxeDIqYzEyLnkqYzEzLngqYzEzLnkgKyA2KmMyMC55KmMyMS54KmMxM3gyKmMyMS55KmMxMy55ICsgMipjMTF4MipjMTEueSpjMTMueCpjMTMueSpjMjIueSArXHJcbiAgICAgICAgICAgIGMxMXgyKmMxMi54KmMxMi55KmMxMy55KmMyMi55ICsgMipjMTJ4MipjMjAueSpjMTIueSpjMjIueCpjMTMueSArIDIqYzEyeDIqYzIxLngqYzEyLnkqYzIxLnkqYzEzLnkgLVxyXG4gICAgICAgICAgICAzKmMxMC54KmMyMXgyKmMxM3kzICsgMypjMjAueCpjMjF4MipjMTN5MyArIDMqYzEweDIqYzIyLngqYzEzeTMgLSAzKmMxMHkyKmMxM3gzKmMyMi55ICsgMypjMjB4MipjMjIueCpjMTN5MyArXHJcbiAgICAgICAgICAgIGMyMXgyKmMxMnkzKmMxMy54ICsgYzExeTMqYzEzeDIqYzIyLnggLSBjMTF4MypjMTN5MipjMjIueSArIDMqYzEwLnkqYzIxeDIqYzEzLngqYzEzeTIgLVxyXG4gICAgICAgICAgICBjMTEueCpjMTF5MipjMTN4MipjMjIueSArIGMxMS54KmMyMXgyKmMxMi55KmMxM3kyICsgMipjMTEueSpjMTIueCpjMjF4MipjMTN5MiArIGMxMXgyKmMxMS55KmMyMi54KmMxM3kyIC1cclxuICAgICAgICAgICAgYzEyLngqYzIxeDIqYzEyeTIqYzEzLnkgLSAzKmMyMC55KmMyMXgyKmMxMy54KmMxM3kyIC0gMypjMTB4MipjMTMueCpjMTN5MipjMjIueSArIDMqYzEweTIqYzEzeDIqYzIyLngqYzEzLnkgLVxyXG4gICAgICAgICAgICBjMTF4MipjMTJ5MipjMTMueCpjMjIueSArIGMxMXkyKmMxMngyKmMyMi54KmMxMy55IC0gMypjMjB4MipjMTMueCpjMTN5MipjMjIueSArIDMqYzIweTIqYzEzeDIqYzIyLngqYzEzLnkgK1xyXG4gICAgICAgICAgICBjMTJ4MipjMTIueSpjMTMueCooMipjMjAueSpjMjIueSArIGMyMXkyKSArIGMxMS54KmMxMi54KmMxMy54KmMxMy55Kig2KmMyMC55KmMyMi55ICsgMypjMjF5MikgK1xyXG4gICAgICAgICAgICBjMTJ4MypjMTMueSooLTIqYzIwLnkqYzIyLnkgLSBjMjF5MikgKyBjMTAueSpjMTN4MyooNipjMjAueSpjMjIueSArIDMqYzIxeTIpICtcclxuICAgICAgICAgICAgYzExLnkqYzEyLngqYzEzeDIqKC0yKmMyMC55KmMyMi55IC0gYzIxeTIpICsgYzExLngqYzEyLnkqYzEzeDIqKC00KmMyMC55KmMyMi55IC0gMipjMjF5MikgK1xyXG4gICAgICAgICAgICBjMTAueCpjMTN4MipjMTMueSooLTYqYzIwLnkqYzIyLnkgLSAzKmMyMXkyKSArIGMyMC54KmMxM3gyKmMxMy55Kig2KmMyMC55KmMyMi55ICsgMypjMjF5MikgK1xyXG4gICAgICAgICAgICBjMTN4MyooLTIqYzIwLnkqYzIxeTIgLSBjMjB5MipjMjIueSAtIGMyMC55KigyKmMyMC55KmMyMi55ICsgYzIxeTIpKSxcclxuICAgICAgICAtYzEwLngqYzExLngqYzEyLnkqYzEzLngqYzIxLnkqYzEzLnkgKyBjMTAueCpjMTEueSpjMTIueCpjMTMueCpjMjEueSpjMTMueSArIDYqYzEwLngqYzExLnkqYzIxLngqYzEyLnkqYzEzLngqYzEzLnkgLVxyXG4gICAgICAgICAgICA2KmMxMC55KmMxMS54KmMxMi54KmMxMy54KmMyMS55KmMxMy55IC0gYzEwLnkqYzExLngqYzIxLngqYzEyLnkqYzEzLngqYzEzLnkgKyBjMTAueSpjMTEueSpjMTIueCpjMjEueCpjMTMueCpjMTMueSAtXHJcbiAgICAgICAgICAgIGMxMS54KmMxMS55KmMxMi54KmMyMS54KmMxMi55KmMxMy55ICsgYzExLngqYzExLnkqYzEyLngqYzEyLnkqYzEzLngqYzIxLnkgKyBjMTEueCpjMjAueCpjMTIueSpjMTMueCpjMjEueSpjMTMueSArXHJcbiAgICAgICAgICAgIDYqYzExLngqYzEyLngqYzIwLnkqYzEzLngqYzIxLnkqYzEzLnkgKyBjMTEueCpjMjAueSpjMjEueCpjMTIueSpjMTMueCpjMTMueSAtIGMyMC54KmMxMS55KmMxMi54KmMxMy54KmMyMS55KmMxMy55IC1cclxuICAgICAgICAgICAgNipjMjAueCpjMTEueSpjMjEueCpjMTIueSpjMTMueCpjMTMueSAtIGMxMS55KmMxMi54KmMyMC55KmMyMS54KmMxMy54KmMxMy55IC0gNipjMTAueCpjMjAueCpjMjEueCpjMTN5MyAtXHJcbiAgICAgICAgICAgIDIqYzEwLngqYzIxLngqYzEyeTMqYzEzLnggKyA2KmMxMC55KmMyMC55KmMxM3gzKmMyMS55ICsgMipjMjAueCpjMjEueCpjMTJ5MypjMTMueCArIDIqYzEwLnkqYzEyeDMqYzIxLnkqYzEzLnkgLVxyXG4gICAgICAgICAgICAyKmMxMngzKmMyMC55KmMyMS55KmMxMy55IC0gNipjMTAueCpjMTAueSpjMjEueCpjMTMueCpjMTN5MiArIDMqYzEwLngqYzExLngqYzEyLngqYzIxLnkqYzEzeTIgLVxyXG4gICAgICAgICAgICAyKmMxMC54KmMxMS54KmMyMS54KmMxMi55KmMxM3kyIC0gNCpjMTAueCpjMTEueSpjMTIueCpjMjEueCpjMTN5MiArIDMqYzEwLnkqYzExLngqYzEyLngqYzIxLngqYzEzeTIgK1xyXG4gICAgICAgICAgICA2KmMxMC54KmMxMC55KmMxM3gyKmMyMS55KmMxMy55ICsgNipjMTAueCpjMjAueCpjMTMueCpjMjEueSpjMTN5MiAtIDMqYzEwLngqYzExLnkqYzEyLnkqYzEzeDIqYzIxLnkgK1xyXG4gICAgICAgICAgICAyKmMxMC54KmMxMi54KmMyMS54KmMxMnkyKmMxMy55ICsgMipjMTAueCpjMTIueCpjMTJ5MipjMTMueCpjMjEueSArIDYqYzEwLngqYzIwLnkqYzIxLngqYzEzLngqYzEzeTIgK1xyXG4gICAgICAgICAgICA0KmMxMC55KmMxMS54KmMxMi55KmMxM3gyKmMyMS55ICsgNipjMTAueSpjMjAueCpjMjEueCpjMTMueCpjMTN5MiArIDIqYzEwLnkqYzExLnkqYzEyLngqYzEzeDIqYzIxLnkgLVxyXG4gICAgICAgICAgICAzKmMxMC55KmMxMS55KmMyMS54KmMxMi55KmMxM3gyICsgMipjMTAueSpjMTIueCpjMjEueCpjMTJ5MipjMTMueCAtIDMqYzExLngqYzIwLngqYzEyLngqYzIxLnkqYzEzeTIgK1xyXG4gICAgICAgICAgICAyKmMxMS54KmMyMC54KmMyMS54KmMxMi55KmMxM3kyICsgYzExLngqYzExLnkqYzIxLngqYzEyeTIqYzEzLnggLSAzKmMxMS54KmMxMi54KmMyMC55KmMyMS54KmMxM3kyICtcclxuICAgICAgICAgICAgNCpjMjAueCpjMTEueSpjMTIueCpjMjEueCpjMTN5MiAtIDYqYzEwLngqYzIwLnkqYzEzeDIqYzIxLnkqYzEzLnkgLSAyKmMxMC54KmMxMngyKmMxMi55KmMyMS55KmMxMy55IC1cclxuICAgICAgICAgICAgNipjMTAueSpjMjAueCpjMTN4MipjMjEueSpjMTMueSAtIDYqYzEwLnkqYzIwLnkqYzIxLngqYzEzeDIqYzEzLnkgLSAyKmMxMC55KmMxMngyKmMyMS54KmMxMi55KmMxMy55IC1cclxuICAgICAgICAgICAgMipjMTAueSpjMTJ4MipjMTIueSpjMTMueCpjMjEueSAtIGMxMS54KmMxMS55KmMxMngyKmMyMS55KmMxMy55IC0gNCpjMTEueCpjMjAueSpjMTIueSpjMTN4MipjMjEueSAtXHJcbiAgICAgICAgICAgIDIqYzExLngqYzExeTIqYzIxLngqYzEzLngqYzEzLnkgKyAzKmMyMC54KmMxMS55KmMxMi55KmMxM3gyKmMyMS55IC0gMipjMjAueCpjMTIueCpjMjEueCpjMTJ5MipjMTMueSAtXHJcbiAgICAgICAgICAgIDIqYzIwLngqYzEyLngqYzEyeTIqYzEzLngqYzIxLnkgLSA2KmMyMC54KmMyMC55KmMyMS54KmMxMy54KmMxM3kyIC0gMipjMTEueSpjMTIueCpjMjAueSpjMTN4MipjMjEueSArXHJcbiAgICAgICAgICAgIDMqYzExLnkqYzIwLnkqYzIxLngqYzEyLnkqYzEzeDIgLSAyKmMxMi54KmMyMC55KmMyMS54KmMxMnkyKmMxMy54IC0gYzExeTIqYzEyLngqYzIxLngqYzEyLnkqYzEzLnggK1xyXG4gICAgICAgICAgICA2KmMyMC54KmMyMC55KmMxM3gyKmMyMS55KmMxMy55ICsgMipjMjAueCpjMTJ4MipjMTIueSpjMjEueSpjMTMueSArIDIqYzExeDIqYzExLnkqYzEzLngqYzIxLnkqYzEzLnkgK1xyXG4gICAgICAgICAgICBjMTF4MipjMTIueCpjMTIueSpjMjEueSpjMTMueSArIDIqYzEyeDIqYzIwLnkqYzIxLngqYzEyLnkqYzEzLnkgKyAyKmMxMngyKmMyMC55KmMxMi55KmMxMy54KmMyMS55ICtcclxuICAgICAgICAgICAgMypjMTB4MipjMjEueCpjMTN5MyAtIDMqYzEweTIqYzEzeDMqYzIxLnkgKyAzKmMyMHgyKmMyMS54KmMxM3kzICsgYzExeTMqYzIxLngqYzEzeDIgLSBjMTF4MypjMjEueSpjMTN5MiAtXHJcbiAgICAgICAgICAgIDMqYzIweTIqYzEzeDMqYzIxLnkgLSBjMTEueCpjMTF5MipjMTN4MipjMjEueSArIGMxMXgyKmMxMS55KmMyMS54KmMxM3kyIC0gMypjMTB4MipjMTMueCpjMjEueSpjMTN5MiArXHJcbiAgICAgICAgICAgIDMqYzEweTIqYzIxLngqYzEzeDIqYzEzLnkgLSBjMTF4MipjMTJ5MipjMTMueCpjMjEueSArIGMxMXkyKmMxMngyKmMyMS54KmMxMy55IC0gMypjMjB4MipjMTMueCpjMjEueSpjMTN5MiArXHJcbiAgICAgICAgICAgIDMqYzIweTIqYzIxLngqYzEzeDIqYzEzLnksXHJcbiAgICAgICAgYzEwLngqYzEwLnkqYzExLngqYzEyLnkqYzEzLngqYzEzLnkgLSBjMTAueCpjMTAueSpjMTEueSpjMTIueCpjMTMueCpjMTMueSArIGMxMC54KmMxMS54KmMxMS55KmMxMi54KmMxMi55KmMxMy55IC1cclxuICAgICAgICAgICAgYzEwLnkqYzExLngqYzExLnkqYzEyLngqYzEyLnkqYzEzLnggLSBjMTAueCpjMTEueCpjMjAueSpjMTIueSpjMTMueCpjMTMueSArIDYqYzEwLngqYzIwLngqYzExLnkqYzEyLnkqYzEzLngqYzEzLnkgK1xyXG4gICAgICAgICAgICBjMTAueCpjMTEueSpjMTIueCpjMjAueSpjMTMueCpjMTMueSAtIGMxMC55KmMxMS54KmMyMC54KmMxMi55KmMxMy54KmMxMy55IC0gNipjMTAueSpjMTEueCpjMTIueCpjMjAueSpjMTMueCpjMTMueSArXHJcbiAgICAgICAgICAgIGMxMC55KmMyMC54KmMxMS55KmMxMi54KmMxMy54KmMxMy55IC0gYzExLngqYzIwLngqYzExLnkqYzEyLngqYzEyLnkqYzEzLnkgKyBjMTEueCpjMTEueSpjMTIueCpjMjAueSpjMTIueSpjMTMueCArXHJcbiAgICAgICAgICAgIGMxMS54KmMyMC54KmMyMC55KmMxMi55KmMxMy54KmMxMy55IC0gYzIwLngqYzExLnkqYzEyLngqYzIwLnkqYzEzLngqYzEzLnkgLSAyKmMxMC54KmMyMC54KmMxMnkzKmMxMy54ICtcclxuICAgICAgICAgICAgMipjMTAueSpjMTJ4MypjMjAueSpjMTMueSAtIDMqYzEwLngqYzEwLnkqYzExLngqYzEyLngqYzEzeTIgLSA2KmMxMC54KmMxMC55KmMyMC54KmMxMy54KmMxM3kyICtcclxuICAgICAgICAgICAgMypjMTAueCpjMTAueSpjMTEueSpjMTIueSpjMTN4MiAtIDIqYzEwLngqYzEwLnkqYzEyLngqYzEyeTIqYzEzLnggLSAyKmMxMC54KmMxMS54KmMyMC54KmMxMi55KmMxM3kyIC1cclxuICAgICAgICAgICAgYzEwLngqYzExLngqYzExLnkqYzEyeTIqYzEzLnggKyAzKmMxMC54KmMxMS54KmMxMi54KmMyMC55KmMxM3kyIC0gNCpjMTAueCpjMjAueCpjMTEueSpjMTIueCpjMTN5MiArXHJcbiAgICAgICAgICAgIDMqYzEwLnkqYzExLngqYzIwLngqYzEyLngqYzEzeTIgKyA2KmMxMC54KmMxMC55KmMyMC55KmMxM3gyKmMxMy55ICsgMipjMTAueCpjMTAueSpjMTJ4MipjMTIueSpjMTMueSArXHJcbiAgICAgICAgICAgIDIqYzEwLngqYzExLngqYzExeTIqYzEzLngqYzEzLnkgKyAyKmMxMC54KmMyMC54KmMxMi54KmMxMnkyKmMxMy55ICsgNipjMTAueCpjMjAueCpjMjAueSpjMTMueCpjMTN5MiAtXHJcbiAgICAgICAgICAgIDMqYzEwLngqYzExLnkqYzIwLnkqYzEyLnkqYzEzeDIgKyAyKmMxMC54KmMxMi54KmMyMC55KmMxMnkyKmMxMy54ICsgYzEwLngqYzExeTIqYzEyLngqYzEyLnkqYzEzLnggK1xyXG4gICAgICAgICAgICBjMTAueSpjMTEueCpjMTEueSpjMTJ4MipjMTMueSArIDQqYzEwLnkqYzExLngqYzIwLnkqYzEyLnkqYzEzeDIgLSAzKmMxMC55KmMyMC54KmMxMS55KmMxMi55KmMxM3gyICtcclxuICAgICAgICAgICAgMipjMTAueSpjMjAueCpjMTIueCpjMTJ5MipjMTMueCArIDIqYzEwLnkqYzExLnkqYzEyLngqYzIwLnkqYzEzeDIgKyBjMTEueCpjMjAueCpjMTEueSpjMTJ5MipjMTMueCAtXHJcbiAgICAgICAgICAgIDMqYzExLngqYzIwLngqYzEyLngqYzIwLnkqYzEzeTIgLSAyKmMxMC54KmMxMngyKmMyMC55KmMxMi55KmMxMy55IC0gNipjMTAueSpjMjAueCpjMjAueSpjMTN4MipjMTMueSAtXHJcbiAgICAgICAgICAgIDIqYzEwLnkqYzIwLngqYzEyeDIqYzEyLnkqYzEzLnkgLSAyKmMxMC55KmMxMXgyKmMxMS55KmMxMy54KmMxMy55IC0gYzEwLnkqYzExeDIqYzEyLngqYzEyLnkqYzEzLnkgLVxyXG4gICAgICAgICAgICAyKmMxMC55KmMxMngyKmMyMC55KmMxMi55KmMxMy54IC0gMipjMTEueCpjMjAueCpjMTF5MipjMTMueCpjMTMueSAtIGMxMS54KmMxMS55KmMxMngyKmMyMC55KmMxMy55ICtcclxuICAgICAgICAgICAgMypjMjAueCpjMTEueSpjMjAueSpjMTIueSpjMTN4MiAtIDIqYzIwLngqYzEyLngqYzIwLnkqYzEyeTIqYzEzLnggLSBjMjAueCpjMTF5MipjMTIueCpjMTIueSpjMTMueCArXHJcbiAgICAgICAgICAgIDMqYzEweTIqYzExLngqYzEyLngqYzEzLngqYzEzLnkgKyAzKmMxMS54KmMxMi54KmMyMHkyKmMxMy54KmMxMy55ICsgMipjMjAueCpjMTJ4MipjMjAueSpjMTIueSpjMTMueSAtXHJcbiAgICAgICAgICAgIDMqYzEweDIqYzExLnkqYzEyLnkqYzEzLngqYzEzLnkgKyAyKmMxMXgyKmMxMS55KmMyMC55KmMxMy54KmMxMy55ICsgYzExeDIqYzEyLngqYzIwLnkqYzEyLnkqYzEzLnkgLVxyXG4gICAgICAgICAgICAzKmMyMHgyKmMxMS55KmMxMi55KmMxMy54KmMxMy55IC0gYzEweDMqYzEzeTMgKyBjMTB5MypjMTN4MyArIGMyMHgzKmMxM3kzIC0gYzIweTMqYzEzeDMgLVxyXG4gICAgICAgICAgICAzKmMxMC54KmMyMHgyKmMxM3kzIC0gYzEwLngqYzExeTMqYzEzeDIgKyAzKmMxMHgyKmMyMC54KmMxM3kzICsgYzEwLnkqYzExeDMqYzEzeTIgK1xyXG4gICAgICAgICAgICAzKmMxMC55KmMyMHkyKmMxM3gzICsgYzIwLngqYzExeTMqYzEzeDIgKyBjMTB4MipjMTJ5MypjMTMueCAtIDMqYzEweTIqYzIwLnkqYzEzeDMgLSBjMTB5MipjMTJ4MypjMTMueSArXHJcbiAgICAgICAgICAgIGMyMHgyKmMxMnkzKmMxMy54IC0gYzExeDMqYzIwLnkqYzEzeTIgLSBjMTJ4MypjMjB5MipjMTMueSAtIGMxMC54KmMxMXgyKmMxMS55KmMxM3kyICtcclxuICAgICAgICAgICAgYzEwLnkqYzExLngqYzExeTIqYzEzeDIgLSAzKmMxMC54KmMxMHkyKmMxM3gyKmMxMy55IC0gYzEwLngqYzExeTIqYzEyeDIqYzEzLnkgKyBjMTAueSpjMTF4MipjMTJ5MipjMTMueCAtXHJcbiAgICAgICAgICAgIGMxMS54KmMxMXkyKmMyMC55KmMxM3gyICsgMypjMTB4MipjMTAueSpjMTMueCpjMTN5MiArIGMxMHgyKmMxMS54KmMxMi55KmMxM3kyICtcclxuICAgICAgICAgICAgMipjMTB4MipjMTEueSpjMTIueCpjMTN5MiAtIDIqYzEweTIqYzExLngqYzEyLnkqYzEzeDIgLSBjMTB5MipjMTEueSpjMTIueCpjMTN4MiArIGMxMXgyKmMyMC54KmMxMS55KmMxM3kyIC1cclxuICAgICAgICAgICAgMypjMTAueCpjMjB5MipjMTN4MipjMTMueSArIDMqYzEwLnkqYzIweDIqYzEzLngqYzEzeTIgKyBjMTEueCpjMjB4MipjMTIueSpjMTN5MiAtIDIqYzExLngqYzIweTIqYzEyLnkqYzEzeDIgK1xyXG4gICAgICAgICAgICBjMjAueCpjMTF5MipjMTJ4MipjMTMueSAtIGMxMS55KmMxMi54KmMyMHkyKmMxM3gyIC0gYzEweDIqYzEyLngqYzEyeTIqYzEzLnkgLSAzKmMxMHgyKmMyMC55KmMxMy54KmMxM3kyICtcclxuICAgICAgICAgICAgMypjMTB5MipjMjAueCpjMTN4MipjMTMueSArIGMxMHkyKmMxMngyKmMxMi55KmMxMy54IC0gYzExeDIqYzIwLnkqYzEyeTIqYzEzLnggKyAyKmMyMHgyKmMxMS55KmMxMi54KmMxM3kyICtcclxuICAgICAgICAgICAgMypjMjAueCpjMjB5MipjMTN4MipjMTMueSAtIGMyMHgyKmMxMi54KmMxMnkyKmMxMy55IC0gMypjMjB4MipjMjAueSpjMTMueCpjMTN5MiArIGMxMngyKmMyMHkyKmMxMi55KmMxMy54XHJcbiAgICApO1xyXG4gICAgdmFyIHJvb3RzID0gcG9seS5nZXRSb290c0luSW50ZXJ2YWwoMCwxKTtcclxuXHJcbiAgICBmb3IgKCB2YXIgaSA9IDA7IGkgPCByb290cy5sZW5ndGg7IGkrKyApIHtcclxuICAgICAgICB2YXIgcyA9IHJvb3RzW2ldO1xyXG4gICAgICAgIHZhciB4Um9vdHMgPSBuZXcgUG9seW5vbWlhbChcclxuICAgICAgICAgICAgYzEzLngsXHJcbiAgICAgICAgICAgIGMxMi54LFxyXG4gICAgICAgICAgICBjMTEueCxcclxuICAgICAgICAgICAgYzEwLnggLSBjMjAueCAtIHMqYzIxLnggLSBzKnMqYzIyLnggLSBzKnMqcypjMjMueFxyXG4gICAgICAgICkuZ2V0Um9vdHMoKTtcclxuICAgICAgICB2YXIgeVJvb3RzID0gbmV3IFBvbHlub21pYWwoXHJcbiAgICAgICAgICAgIGMxMy55LFxyXG4gICAgICAgICAgICBjMTIueSxcclxuICAgICAgICAgICAgYzExLnksXHJcbiAgICAgICAgICAgIGMxMC55IC0gYzIwLnkgLSBzKmMyMS55IC0gcypzKmMyMi55IC0gcypzKnMqYzIzLnlcclxuICAgICAgICApLmdldFJvb3RzKCk7XHJcblxyXG4gICAgICAgIGlmICggeFJvb3RzLmxlbmd0aCA+IDAgJiYgeVJvb3RzLmxlbmd0aCA+IDAgKSB7XHJcbiAgICAgICAgICAgIHZhciBUT0xFUkFOQ0UgPSAxZS00O1xyXG5cclxuICAgICAgICAgICAgY2hlY2tSb290czpcclxuICAgICAgICAgICAgZm9yICggdmFyIGogPSAwOyBqIDwgeFJvb3RzLmxlbmd0aDsgaisrICkge1xyXG4gICAgICAgICAgICAgICAgdmFyIHhSb290ID0geFJvb3RzW2pdO1xyXG5cclxuICAgICAgICAgICAgICAgIGlmICggMCA8PSB4Um9vdCAmJiB4Um9vdCA8PSAxICkge1xyXG4gICAgICAgICAgICAgICAgICAgIGZvciAoIHZhciBrID0gMDsgayA8IHlSb290cy5sZW5ndGg7IGsrKyApIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCBNYXRoLmFicyggeFJvb3QgLSB5Um9vdHNba10gKSA8IFRPTEVSQU5DRSApIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJlc3VsdC5wb2ludHMucHVzaChcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjMjMubXVsdGlwbHkocypzKnMpLmFkZChjMjIubXVsdGlwbHkocypzKS5hZGQoYzIxLm11bHRpcGx5KHMpLmFkZChjMjApKSlcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBicmVhayBjaGVja1Jvb3RzO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIGlmICggcmVzdWx0LnBvaW50cy5sZW5ndGggPiAwICkgcmVzdWx0LnN0YXR1cyA9IFwiSW50ZXJzZWN0aW9uXCI7XHJcblxyXG4gICAgcmV0dXJuIHJlc3VsdDtcclxufTtcclxuXHJcblxyXG4vKipcclxuICogIGludGVyc2VjdEJlemllcjNDaXJjbGVcclxuICpcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gcDFcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gcDJcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gcDNcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gcDRcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gY1xyXG4gKiAgQHBhcmFtIHtOdW1iZXJ9IHJcclxuICogIEByZXR1cm5zIHtJbnRlcnNlY3Rpb259XHJcbiAqL1xyXG5JbnRlcnNlY3Rpb24uaW50ZXJzZWN0QmV6aWVyM0NpcmNsZSA9IGZ1bmN0aW9uKHAxLCBwMiwgcDMsIHA0LCBjLCByKSB7XHJcbiAgICByZXR1cm4gSW50ZXJzZWN0aW9uLmludGVyc2VjdEJlemllcjNFbGxpcHNlKHAxLCBwMiwgcDMsIHA0LCBjLCByLCByKTtcclxufTtcclxuXHJcblxyXG4vKipcclxuICogIGludGVyc2VjdEJlemllcjNFbGxpcHNlXHJcbiAqXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IHAxXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IHAyXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IHAzXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IHA0XHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IGVjXHJcbiAqICBAcGFyYW0ge051bWJlcn0gcnhcclxuICogIEBwYXJhbSB7TnVtYmVyfSByeVxyXG4gKiAgQHJldHVybnMge0ludGVyc2VjdGlvbn1cclxuICovXHJcbkludGVyc2VjdGlvbi5pbnRlcnNlY3RCZXppZXIzRWxsaXBzZSA9IGZ1bmN0aW9uKHAxLCBwMiwgcDMsIHA0LCBlYywgcngsIHJ5KSB7XHJcbiAgICB2YXIgYSwgYiwgYywgZDsgICAgICAgLy8gdGVtcG9yYXJ5IHZhcmlhYmxlc1xyXG4gICAgdmFyIGMzLCBjMiwgYzEsIGMwOyAgIC8vIGNvZWZmaWNpZW50cyBvZiBjdWJpY1xyXG4gICAgdmFyIHJlc3VsdCA9IG5ldyBJbnRlcnNlY3Rpb24oXCJObyBJbnRlcnNlY3Rpb25cIik7XHJcblxyXG4gICAgLy8gQ2FsY3VsYXRlIHRoZSBjb2VmZmljaWVudHMgb2YgY3ViaWMgcG9seW5vbWlhbFxyXG4gICAgYSA9IHAxLm11bHRpcGx5KC0xKTtcclxuICAgIGIgPSBwMi5tdWx0aXBseSgzKTtcclxuICAgIGMgPSBwMy5tdWx0aXBseSgtMyk7XHJcbiAgICBkID0gYS5hZGQoYi5hZGQoYy5hZGQocDQpKSk7XHJcbiAgICBjMyA9IG5ldyBWZWN0b3IyRChkLngsIGQueSk7XHJcblxyXG4gICAgYSA9IHAxLm11bHRpcGx5KDMpO1xyXG4gICAgYiA9IHAyLm11bHRpcGx5KC02KTtcclxuICAgIGMgPSBwMy5tdWx0aXBseSgzKTtcclxuICAgIGQgPSBhLmFkZChiLmFkZChjKSk7XHJcbiAgICBjMiA9IG5ldyBWZWN0b3IyRChkLngsIGQueSk7XHJcblxyXG4gICAgYSA9IHAxLm11bHRpcGx5KC0zKTtcclxuICAgIGIgPSBwMi5tdWx0aXBseSgzKTtcclxuICAgIGMgPSBhLmFkZChiKTtcclxuICAgIGMxID0gbmV3IFZlY3RvcjJEKGMueCwgYy55KTtcclxuXHJcbiAgICBjMCA9IG5ldyBWZWN0b3IyRChwMS54LCBwMS55KTtcclxuXHJcbiAgICB2YXIgcnhyeCAgPSByeCpyeDtcclxuICAgIHZhciByeXJ5ICA9IHJ5KnJ5O1xyXG4gICAgdmFyIHBvbHkgPSBuZXcgUG9seW5vbWlhbChcclxuICAgICAgICBjMy54KmMzLngqcnlyeSArIGMzLnkqYzMueSpyeHJ4LFxyXG4gICAgICAgIDIqKGMzLngqYzIueCpyeXJ5ICsgYzMueSpjMi55KnJ4cngpLFxyXG4gICAgICAgIDIqKGMzLngqYzEueCpyeXJ5ICsgYzMueSpjMS55KnJ4cngpICsgYzIueCpjMi54KnJ5cnkgKyBjMi55KmMyLnkqcnhyeCxcclxuICAgICAgICAyKmMzLngqcnlyeSooYzAueCAtIGVjLngpICsgMipjMy55KnJ4cngqKGMwLnkgLSBlYy55KSArXHJcbiAgICAgICAgICAgIDIqKGMyLngqYzEueCpyeXJ5ICsgYzIueSpjMS55KnJ4cngpLFxyXG4gICAgICAgIDIqYzIueCpyeXJ5KihjMC54IC0gZWMueCkgKyAyKmMyLnkqcnhyeCooYzAueSAtIGVjLnkpICtcclxuICAgICAgICAgICAgYzEueCpjMS54KnJ5cnkgKyBjMS55KmMxLnkqcnhyeCxcclxuICAgICAgICAyKmMxLngqcnlyeSooYzAueCAtIGVjLngpICsgMipjMS55KnJ4cngqKGMwLnkgLSBlYy55KSxcclxuICAgICAgICBjMC54KmMwLngqcnlyeSAtIDIqYzAueSplYy55KnJ4cnggLSAyKmMwLngqZWMueCpyeXJ5ICtcclxuICAgICAgICAgICAgYzAueSpjMC55KnJ4cnggKyBlYy54KmVjLngqcnlyeSArIGVjLnkqZWMueSpyeHJ4IC0gcnhyeCpyeXJ5XHJcbiAgICApO1xyXG4gICAgdmFyIHJvb3RzID0gcG9seS5nZXRSb290c0luSW50ZXJ2YWwoMCwxKTtcclxuXHJcbiAgICBmb3IgKCB2YXIgaSA9IDA7IGkgPCByb290cy5sZW5ndGg7IGkrKyApIHtcclxuICAgICAgICB2YXIgdCA9IHJvb3RzW2ldO1xyXG5cclxuICAgICAgICByZXN1bHQucG9pbnRzLnB1c2goXHJcbiAgICAgICAgICAgIGMzLm11bHRpcGx5KHQqdCp0KS5hZGQoYzIubXVsdGlwbHkodCp0KS5hZGQoYzEubXVsdGlwbHkodCkuYWRkKGMwKSkpXHJcbiAgICAgICAgKTtcclxuICAgIH1cclxuXHJcbiAgICBpZiAoIHJlc3VsdC5wb2ludHMubGVuZ3RoID4gMCApIHJlc3VsdC5zdGF0dXMgPSBcIkludGVyc2VjdGlvblwiO1xyXG5cclxuICAgIHJldHVybiByZXN1bHQ7XHJcbn07XHJcblxyXG5cclxuLyoqXHJcbiAqICBpbnRlcnNlY3RCZXppZXIzTGluZVxyXG4gKlxyXG4gKiAgTWFueSB0aGFua3MgdG8gRGFuIFN1bmRheSBhdCBTb2Z0U3VyZmVyLmNvbS4gIEhlIGdhdmUgbWUgYSB2ZXJ5IHRob3JvdWdoXHJcbiAqICBza2V0Y2ggb2YgdGhlIGFsZ29yaXRobSB1c2VkIGhlcmUuICBXaXRob3V0IGhpcyBoZWxwLCBJJ20gbm90IHN1cmUgd2hlbiBJXHJcbiAqICB3b3VsZCBoYXZlIGZpZ3VyZWQgb3V0IHRoaXMgaW50ZXJzZWN0aW9uIHByb2JsZW0uXHJcbiAqXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IHAxXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IHAyXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IHAzXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IHA0XHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IGExXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IGEyXHJcbiAqICBAcmV0dXJucyB7SW50ZXJzZWN0aW9ufVxyXG4gKi9cclxuSW50ZXJzZWN0aW9uLmludGVyc2VjdEJlemllcjNMaW5lID0gZnVuY3Rpb24ocDEsIHAyLCBwMywgcDQsIGExLCBhMikge1xyXG4gICAgdmFyIGEsIGIsIGMsIGQ7ICAgICAgIC8vIHRlbXBvcmFyeSB2YXJpYWJsZXNcclxuICAgIHZhciBjMywgYzIsIGMxLCBjMDsgICAvLyBjb2VmZmljaWVudHMgb2YgY3ViaWNcclxuICAgIHZhciBjbDsgICAgICAgICAgICAgICAvLyBjIGNvZWZmaWNpZW50IGZvciBub3JtYWwgZm9ybSBvZiBsaW5lXHJcbiAgICB2YXIgbjsgICAgICAgICAgICAgICAgLy8gbm9ybWFsIGZvciBub3JtYWwgZm9ybSBvZiBsaW5lXHJcbiAgICB2YXIgbWluID0gYTEubWluKGEyKTsgLy8gdXNlZCB0byBkZXRlcm1pbmUgaWYgcG9pbnQgaXMgb24gbGluZSBzZWdtZW50XHJcbiAgICB2YXIgbWF4ID0gYTEubWF4KGEyKTsgLy8gdXNlZCB0byBkZXRlcm1pbmUgaWYgcG9pbnQgaXMgb24gbGluZSBzZWdtZW50XHJcbiAgICB2YXIgcmVzdWx0ID0gbmV3IEludGVyc2VjdGlvbihcIk5vIEludGVyc2VjdGlvblwiKTtcclxuXHJcbiAgICAvLyBTdGFydCB3aXRoIEJlemllciB1c2luZyBCZXJuc3RlaW4gcG9seW5vbWlhbHMgZm9yIHdlaWdodGluZyBmdW5jdGlvbnM6XHJcbiAgICAvLyAgICAgKDEtdF4zKVAxICsgM3QoMS10KV4yUDIgKyAzdF4yKDEtdClQMyArIHReM1A0XHJcbiAgICAvL1xyXG4gICAgLy8gRXhwYW5kIGFuZCBjb2xsZWN0IHRlcm1zIHRvIGZvcm0gbGluZWFyIGNvbWJpbmF0aW9ucyBvZiBvcmlnaW5hbCBCZXppZXJcclxuICAgIC8vIGNvbnRyb2xzLiAgVGhpcyBlbmRzIHVwIHdpdGggYSB2ZWN0b3IgY3ViaWMgaW4gdDpcclxuICAgIC8vICAgICAoLVAxKzNQMi0zUDMrUDQpdF4zICsgKDNQMS02UDIrM1AzKXReMiArICgtM1AxKzNQMil0ICsgUDFcclxuICAgIC8vICAgICAgICAgICAgIC9cXCAgICAgICAgICAgICAgICAgIC9cXCAgICAgICAgICAgICAgICAvXFwgICAgICAgL1xcXHJcbiAgICAvLyAgICAgICAgICAgICB8fCAgICAgICAgICAgICAgICAgIHx8ICAgICAgICAgICAgICAgIHx8ICAgICAgIHx8XHJcbiAgICAvLyAgICAgICAgICAgICBjMyAgICAgICAgICAgICAgICAgIGMyICAgICAgICAgICAgICAgIGMxICAgICAgIGMwXHJcblxyXG4gICAgLy8gQ2FsY3VsYXRlIHRoZSBjb2VmZmljaWVudHNcclxuICAgIGEgPSBwMS5tdWx0aXBseSgtMSk7XHJcbiAgICBiID0gcDIubXVsdGlwbHkoMyk7XHJcbiAgICBjID0gcDMubXVsdGlwbHkoLTMpO1xyXG4gICAgZCA9IGEuYWRkKGIuYWRkKGMuYWRkKHA0KSkpO1xyXG4gICAgYzMgPSBuZXcgVmVjdG9yMkQoZC54LCBkLnkpO1xyXG5cclxuICAgIGEgPSBwMS5tdWx0aXBseSgzKTtcclxuICAgIGIgPSBwMi5tdWx0aXBseSgtNik7XHJcbiAgICBjID0gcDMubXVsdGlwbHkoMyk7XHJcbiAgICBkID0gYS5hZGQoYi5hZGQoYykpO1xyXG4gICAgYzIgPSBuZXcgVmVjdG9yMkQoZC54LCBkLnkpO1xyXG5cclxuICAgIGEgPSBwMS5tdWx0aXBseSgtMyk7XHJcbiAgICBiID0gcDIubXVsdGlwbHkoMyk7XHJcbiAgICBjID0gYS5hZGQoYik7XHJcbiAgICBjMSA9IG5ldyBWZWN0b3IyRChjLngsIGMueSk7XHJcblxyXG4gICAgYzAgPSBuZXcgVmVjdG9yMkQocDEueCwgcDEueSk7XHJcblxyXG4gICAgLy8gQ29udmVydCBsaW5lIHRvIG5vcm1hbCBmb3JtOiBheCArIGJ5ICsgYyA9IDBcclxuICAgIC8vIEZpbmQgbm9ybWFsIHRvIGxpbmU6IG5lZ2F0aXZlIGludmVyc2Ugb2Ygb3JpZ2luYWwgbGluZSdzIHNsb3BlXHJcbiAgICBuID0gbmV3IFZlY3RvcjJEKGExLnkgLSBhMi55LCBhMi54IC0gYTEueCk7XHJcblxyXG4gICAgLy8gRGV0ZXJtaW5lIG5ldyBjIGNvZWZmaWNpZW50XHJcbiAgICBjbCA9IGExLngqYTIueSAtIGEyLngqYTEueTtcclxuXHJcbiAgICAvLyA/Um90YXRlIGVhY2ggY3ViaWMgY29lZmZpY2llbnQgdXNpbmcgbGluZSBmb3IgbmV3IGNvb3JkaW5hdGUgc3lzdGVtP1xyXG4gICAgLy8gRmluZCByb290cyBvZiByb3RhdGVkIGN1YmljXHJcbiAgICByb290cyA9IG5ldyBQb2x5bm9taWFsKFxyXG4gICAgICAgIG4uZG90KGMzKSxcclxuICAgICAgICBuLmRvdChjMiksXHJcbiAgICAgICAgbi5kb3QoYzEpLFxyXG4gICAgICAgIG4uZG90KGMwKSArIGNsXHJcbiAgICApLmdldFJvb3RzKCk7XHJcblxyXG4gICAgLy8gQW55IHJvb3RzIGluIGNsb3NlZCBpbnRlcnZhbCBbMCwxXSBhcmUgaW50ZXJzZWN0aW9ucyBvbiBCZXppZXIsIGJ1dFxyXG4gICAgLy8gbWlnaHQgbm90IGJlIG9uIHRoZSBsaW5lIHNlZ21lbnQuXHJcbiAgICAvLyBGaW5kIGludGVyc2VjdGlvbnMgYW5kIGNhbGN1bGF0ZSBwb2ludCBjb29yZGluYXRlc1xyXG4gICAgZm9yICggdmFyIGkgPSAwOyBpIDwgcm9vdHMubGVuZ3RoOyBpKysgKSB7XHJcbiAgICAgICAgdmFyIHQgPSByb290c1tpXTtcclxuXHJcbiAgICAgICAgaWYgKCAwIDw9IHQgJiYgdCA8PSAxICkge1xyXG4gICAgICAgICAgICAvLyBXZSdyZSB3aXRoaW4gdGhlIEJlemllciBjdXJ2ZVxyXG4gICAgICAgICAgICAvLyBGaW5kIHBvaW50IG9uIEJlemllclxyXG4gICAgICAgICAgICB2YXIgcDUgPSBwMS5sZXJwKHAyLCB0KTtcclxuICAgICAgICAgICAgdmFyIHA2ID0gcDIubGVycChwMywgdCk7XHJcbiAgICAgICAgICAgIHZhciBwNyA9IHAzLmxlcnAocDQsIHQpO1xyXG5cclxuICAgICAgICAgICAgdmFyIHA4ID0gcDUubGVycChwNiwgdCk7XHJcbiAgICAgICAgICAgIHZhciBwOSA9IHA2LmxlcnAocDcsIHQpO1xyXG5cclxuICAgICAgICAgICAgdmFyIHAxMCA9IHA4LmxlcnAocDksIHQpO1xyXG5cclxuICAgICAgICAgICAgLy8gU2VlIGlmIHBvaW50IGlzIG9uIGxpbmUgc2VnbWVudFxyXG4gICAgICAgICAgICAvLyBIYWQgdG8gbWFrZSBzcGVjaWFsIGNhc2VzIGZvciB2ZXJ0aWNhbCBhbmQgaG9yaXpvbnRhbCBsaW5lcyBkdWVcclxuICAgICAgICAgICAgLy8gdG8gc2xpZ2h0IGVycm9ycyBpbiBjYWxjdWxhdGlvbiBvZiBwMTBcclxuICAgICAgICAgICAgaWYgKCBhMS54ID09IGEyLnggKSB7XHJcbiAgICAgICAgICAgICAgICBpZiAoIG1pbi55IDw9IHAxMC55ICYmIHAxMC55IDw9IG1heC55ICkge1xyXG4gICAgICAgICAgICAgICAgICAgIHJlc3VsdC5zdGF0dXMgPSBcIkludGVyc2VjdGlvblwiO1xyXG4gICAgICAgICAgICAgICAgICAgIHJlc3VsdC5hcHBlbmRQb2ludCggcDEwICk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0gZWxzZSBpZiAoIGExLnkgPT0gYTIueSApIHtcclxuICAgICAgICAgICAgICAgIGlmICggbWluLnggPD0gcDEwLnggJiYgcDEwLnggPD0gbWF4LnggKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgcmVzdWx0LnN0YXR1cyA9IFwiSW50ZXJzZWN0aW9uXCI7XHJcbiAgICAgICAgICAgICAgICAgICAgcmVzdWx0LmFwcGVuZFBvaW50KCBwMTAgKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSBlbHNlIGlmIChtaW4ueCA8PSBwMTAueCAmJiBwMTAueCA8PSBtYXgueCAmJiBtaW4ueSA8PSBwMTAueSAmJiBwMTAueSA8PSBtYXgueSkge1xyXG4gICAgICAgICAgICAgICAgcmVzdWx0LnN0YXR1cyA9IFwiSW50ZXJzZWN0aW9uXCI7XHJcbiAgICAgICAgICAgICAgICByZXN1bHQuYXBwZW5kUG9pbnQoIHAxMCApO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiByZXN1bHQ7XHJcbn07XHJcblxyXG5cclxuLyoqXHJcbiAqICBpbnRlcnNlY3RCZXppZXIzUG9seWdvblxyXG4gKlxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBwMVxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBwMlxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBwM1xyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBwNFxyXG4gKiAgQHBhcmFtIHtBcnJheTxQb2ludDJEPn0gcG9pbnRzXHJcbiAqICBAcmV0dXJucyB7SW50ZXJzZWN0aW9ufVxyXG4gKi9cclxuSW50ZXJzZWN0aW9uLmludGVyc2VjdEJlemllcjNQb2x5Z29uID0gZnVuY3Rpb24ocDEsIHAyLCBwMywgcDQsIHBvaW50cykge1xyXG4gICAgdmFyIHJlc3VsdCA9IG5ldyBJbnRlcnNlY3Rpb24oXCJObyBJbnRlcnNlY3Rpb25cIik7XHJcbiAgICB2YXIgbGVuZ3RoID0gcG9pbnRzLmxlbmd0aDtcclxuXHJcbiAgICBmb3IgKCB2YXIgaSA9IDA7IGkgPCBsZW5ndGg7IGkrKyApIHtcclxuICAgICAgICB2YXIgYTEgPSBwb2ludHNbaV07XHJcbiAgICAgICAgdmFyIGEyID0gcG9pbnRzWyhpKzEpICUgbGVuZ3RoXTtcclxuICAgICAgICB2YXIgaW50ZXIgPSBJbnRlcnNlY3Rpb24uaW50ZXJzZWN0QmV6aWVyM0xpbmUocDEsIHAyLCBwMywgcDQsIGExLCBhMik7XHJcblxyXG4gICAgICAgIHJlc3VsdC5hcHBlbmRQb2ludHMoaW50ZXIucG9pbnRzKTtcclxuICAgIH1cclxuXHJcbiAgICBpZiAoIHJlc3VsdC5wb2ludHMubGVuZ3RoID4gMCApIHJlc3VsdC5zdGF0dXMgPSBcIkludGVyc2VjdGlvblwiO1xyXG5cclxuICAgIHJldHVybiByZXN1bHQ7XHJcbn07XHJcblxyXG5cclxuLyoqXHJcbiAqICBpbnRlcnNlY3RCZXppZXIzUmVjdGFuZ2xlXHJcbiAqXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IHAxXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IHAyXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IHAzXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IHA0XHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IHIxXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IHIyXHJcbiAqICBAcmV0dXJucyB7SW50ZXJzZWN0aW9ufVxyXG4gKi9cclxuSW50ZXJzZWN0aW9uLmludGVyc2VjdEJlemllcjNSZWN0YW5nbGUgPSBmdW5jdGlvbihwMSwgcDIsIHAzLCBwNCwgcjEsIHIyKSB7XHJcbiAgICB2YXIgbWluICAgICAgICA9IHIxLm1pbihyMik7XHJcbiAgICB2YXIgbWF4ICAgICAgICA9IHIxLm1heChyMik7XHJcbiAgICB2YXIgdG9wUmlnaHQgICA9IG5ldyBQb2ludDJEKCBtYXgueCwgbWluLnkgKTtcclxuICAgIHZhciBib3R0b21MZWZ0ID0gbmV3IFBvaW50MkQoIG1pbi54LCBtYXgueSApO1xyXG5cclxuICAgIHZhciBpbnRlcjEgPSBJbnRlcnNlY3Rpb24uaW50ZXJzZWN0QmV6aWVyM0xpbmUocDEsIHAyLCBwMywgcDQsIG1pbiwgdG9wUmlnaHQpO1xyXG4gICAgdmFyIGludGVyMiA9IEludGVyc2VjdGlvbi5pbnRlcnNlY3RCZXppZXIzTGluZShwMSwgcDIsIHAzLCBwNCwgdG9wUmlnaHQsIG1heCk7XHJcbiAgICB2YXIgaW50ZXIzID0gSW50ZXJzZWN0aW9uLmludGVyc2VjdEJlemllcjNMaW5lKHAxLCBwMiwgcDMsIHA0LCBtYXgsIGJvdHRvbUxlZnQpO1xyXG4gICAgdmFyIGludGVyNCA9IEludGVyc2VjdGlvbi5pbnRlcnNlY3RCZXppZXIzTGluZShwMSwgcDIsIHAzLCBwNCwgYm90dG9tTGVmdCwgbWluKTtcclxuXHJcbiAgICB2YXIgcmVzdWx0ID0gbmV3IEludGVyc2VjdGlvbihcIk5vIEludGVyc2VjdGlvblwiKTtcclxuXHJcbiAgICByZXN1bHQuYXBwZW5kUG9pbnRzKGludGVyMS5wb2ludHMpO1xyXG4gICAgcmVzdWx0LmFwcGVuZFBvaW50cyhpbnRlcjIucG9pbnRzKTtcclxuICAgIHJlc3VsdC5hcHBlbmRQb2ludHMoaW50ZXIzLnBvaW50cyk7XHJcbiAgICByZXN1bHQuYXBwZW5kUG9pbnRzKGludGVyNC5wb2ludHMpO1xyXG5cclxuICAgIGlmICggcmVzdWx0LnBvaW50cy5sZW5ndGggPiAwICkgcmVzdWx0LnN0YXR1cyA9IFwiSW50ZXJzZWN0aW9uXCI7XHJcblxyXG4gICAgcmV0dXJuIHJlc3VsdDtcclxufTtcclxuXHJcblxyXG4vKipcclxuICogIGludGVyc2VjdENpcmNsZUNpcmNsZVxyXG4gKlxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBjMVxyXG4gKiAgQHBhcmFtIHtOdW1iZXJ9IHIxXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IGMyXHJcbiAqICBAcGFyYW0ge051bWJlcn0gcjJcclxuICogIEByZXR1cm5zIHtJbnRlcnNlY3Rpb259XHJcbiAqL1xyXG5JbnRlcnNlY3Rpb24uaW50ZXJzZWN0Q2lyY2xlQ2lyY2xlID0gZnVuY3Rpb24oYzEsIHIxLCBjMiwgcjIpIHtcclxuICAgIHZhciByZXN1bHQ7XHJcblxyXG4gICAgLy8gRGV0ZXJtaW5lIG1pbmltdW0gYW5kIG1heGltdW0gcmFkaWkgd2hlcmUgY2lyY2xlcyBjYW4gaW50ZXJzZWN0XHJcbiAgICB2YXIgcl9tYXggPSByMSArIHIyO1xyXG4gICAgdmFyIHJfbWluID0gTWF0aC5hYnMocjEgLSByMik7XHJcblxyXG4gICAgLy8gRGV0ZXJtaW5lIGFjdHVhbCBkaXN0YW5jZSBiZXR3ZWVuIGNpcmNsZSBjaXJjbGVzXHJcbiAgICB2YXIgY19kaXN0ID0gYzEuZGlzdGFuY2VGcm9tKCBjMiApO1xyXG5cclxuICAgIGlmICggY19kaXN0ID4gcl9tYXggKSB7XHJcbiAgICAgICAgcmVzdWx0ID0gbmV3IEludGVyc2VjdGlvbihcIk91dHNpZGVcIik7XHJcbiAgICB9IGVsc2UgaWYgKCBjX2Rpc3QgPCByX21pbiApIHtcclxuICAgICAgICByZXN1bHQgPSBuZXcgSW50ZXJzZWN0aW9uKFwiSW5zaWRlXCIpO1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgICByZXN1bHQgPSBuZXcgSW50ZXJzZWN0aW9uKFwiSW50ZXJzZWN0aW9uXCIpO1xyXG5cclxuICAgICAgICB2YXIgYSA9IChyMSpyMSAtIHIyKnIyICsgY19kaXN0KmNfZGlzdCkgLyAoIDIqY19kaXN0ICk7XHJcbiAgICAgICAgdmFyIGggPSBNYXRoLnNxcnQocjEqcjEgLSBhKmEpO1xyXG4gICAgICAgIHZhciBwID0gYzEubGVycChjMiwgYS9jX2Rpc3QpO1xyXG4gICAgICAgIHZhciBiID0gaCAvIGNfZGlzdDtcclxuXHJcbiAgICAgICAgcmVzdWx0LnBvaW50cy5wdXNoKFxyXG4gICAgICAgICAgICBuZXcgUG9pbnQyRChcclxuICAgICAgICAgICAgICAgIHAueCAtIGIgKiAoYzIueSAtIGMxLnkpLFxyXG4gICAgICAgICAgICAgICAgcC55ICsgYiAqIChjMi54IC0gYzEueClcclxuICAgICAgICAgICAgKVxyXG4gICAgICAgICk7XHJcbiAgICAgICAgcmVzdWx0LnBvaW50cy5wdXNoKFxyXG4gICAgICAgICAgICBuZXcgUG9pbnQyRChcclxuICAgICAgICAgICAgICAgIHAueCArIGIgKiAoYzIueSAtIGMxLnkpLFxyXG4gICAgICAgICAgICAgICAgcC55IC0gYiAqIChjMi54IC0gYzEueClcclxuICAgICAgICAgICAgKVxyXG4gICAgICAgICk7XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIHJlc3VsdDtcclxufTtcclxuXHJcblxyXG4vKipcclxuICogIGludGVyc2VjdENpcmNsZUVsbGlwc2VcclxuICpcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gY2NcclxuICogIEBwYXJhbSB7TnVtYmVyfSByXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IGVjXHJcbiAqICBAcGFyYW0ge051bWJlcn0gcnhcclxuICogIEBwYXJhbSB7TnVtYmVyfSByeVxyXG4gKiAgQHJldHVybnMge0ludGVyc2VjdGlvbn1cclxuICovXHJcbkludGVyc2VjdGlvbi5pbnRlcnNlY3RDaXJjbGVFbGxpcHNlID0gZnVuY3Rpb24oY2MsIHIsIGVjLCByeCwgcnkpIHtcclxuICAgIHJldHVybiBJbnRlcnNlY3Rpb24uaW50ZXJzZWN0RWxsaXBzZUVsbGlwc2UoY2MsIHIsIHIsIGVjLCByeCwgcnkpO1xyXG59O1xyXG5cclxuXHJcbi8qKlxyXG4gKiAgaW50ZXJzZWN0Q2lyY2xlTGluZVxyXG4gKlxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBjXHJcbiAqICBAcGFyYW0ge051bWJlcn0gclxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBhMVxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBhMlxyXG4gKiAgQHJldHVybnMge0ludGVyc2VjdGlvbn1cclxuICovXHJcbkludGVyc2VjdGlvbi5pbnRlcnNlY3RDaXJjbGVMaW5lID0gZnVuY3Rpb24oYywgciwgYTEsIGEyKSB7XHJcbiAgICB2YXIgcmVzdWx0O1xyXG4gICAgdmFyIGEgID0gKGEyLnggLSBhMS54KSAqIChhMi54IC0gYTEueCkgK1xyXG4gICAgICAgICAgICAgKGEyLnkgLSBhMS55KSAqIChhMi55IC0gYTEueSk7XHJcbiAgICB2YXIgYiAgPSAyICogKCAoYTIueCAtIGExLngpICogKGExLnggLSBjLngpICtcclxuICAgICAgICAgICAgICAgICAgIChhMi55IC0gYTEueSkgKiAoYTEueSAtIGMueSkgICApO1xyXG4gICAgdmFyIGNjID0gYy54KmMueCArIGMueSpjLnkgKyBhMS54KmExLnggKyBhMS55KmExLnkgLVxyXG4gICAgICAgICAgICAgMiAqIChjLnggKiBhMS54ICsgYy55ICogYTEueSkgLSByKnI7XHJcbiAgICB2YXIgZGV0ZXIgPSBiKmIgLSA0KmEqY2M7XHJcblxyXG4gICAgaWYgKCBkZXRlciA8IDAgKSB7XHJcbiAgICAgICAgcmVzdWx0ID0gbmV3IEludGVyc2VjdGlvbihcIk91dHNpZGVcIik7XHJcbiAgICB9IGVsc2UgaWYgKCBkZXRlciA9PSAwICkge1xyXG4gICAgICAgIHJlc3VsdCA9IG5ldyBJbnRlcnNlY3Rpb24oXCJUYW5nZW50XCIpO1xyXG4gICAgICAgIC8vIE5PVEU6IHNob3VsZCBjYWxjdWxhdGUgdGhpcyBwb2ludFxyXG4gICAgfSBlbHNlIHtcclxuICAgICAgICB2YXIgZSAgPSBNYXRoLnNxcnQoZGV0ZXIpO1xyXG4gICAgICAgIHZhciB1MSA9ICggLWIgKyBlICkgLyAoIDIqYSApO1xyXG4gICAgICAgIHZhciB1MiA9ICggLWIgLSBlICkgLyAoIDIqYSApO1xyXG5cclxuICAgICAgICBpZiAoICh1MSA8IDAgfHwgdTEgPiAxKSAmJiAodTIgPCAwIHx8IHUyID4gMSkgKSB7XHJcbiAgICAgICAgICAgIGlmICggKHUxIDwgMCAmJiB1MiA8IDApIHx8ICh1MSA+IDEgJiYgdTIgPiAxKSApIHtcclxuICAgICAgICAgICAgICAgIHJlc3VsdCA9IG5ldyBJbnRlcnNlY3Rpb24oXCJPdXRzaWRlXCIpO1xyXG4gICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgcmVzdWx0ID0gbmV3IEludGVyc2VjdGlvbihcIkluc2lkZVwiKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgIHJlc3VsdCA9IG5ldyBJbnRlcnNlY3Rpb24oXCJJbnRlcnNlY3Rpb25cIik7XHJcblxyXG4gICAgICAgICAgICBpZiAoIDAgPD0gdTEgJiYgdTEgPD0gMSlcclxuICAgICAgICAgICAgICAgIHJlc3VsdC5wb2ludHMucHVzaCggYTEubGVycChhMiwgdTEpICk7XHJcblxyXG4gICAgICAgICAgICBpZiAoIDAgPD0gdTIgJiYgdTIgPD0gMSlcclxuICAgICAgICAgICAgICAgIHJlc3VsdC5wb2ludHMucHVzaCggYTEubGVycChhMiwgdTIpICk7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiByZXN1bHQ7XHJcbn07XHJcblxyXG5cclxuLyoqXHJcbiAqICBpbnRlcnNlY3RDaXJjbGVQb2x5Z29uXHJcbiAqXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IGNcclxuICogIEBwYXJhbSB7TnVtYmVyfSByXHJcbiAqICBAcGFyYW0ge0FycmF5PFBvaW50MkQ+fSBwb2ludHNcclxuICogIEByZXR1cm5zIHtJbnRlcnNlY3Rpb259XHJcbiAqL1xyXG5JbnRlcnNlY3Rpb24uaW50ZXJzZWN0Q2lyY2xlUG9seWdvbiA9IGZ1bmN0aW9uKGMsIHIsIHBvaW50cykge1xyXG4gICAgdmFyIHJlc3VsdCA9IG5ldyBJbnRlcnNlY3Rpb24oXCJObyBJbnRlcnNlY3Rpb25cIik7XHJcbiAgICB2YXIgbGVuZ3RoID0gcG9pbnRzLmxlbmd0aDtcclxuICAgIHZhciBpbnRlcjtcclxuXHJcbiAgICBmb3IgKCB2YXIgaSA9IDA7IGkgPCBsZW5ndGg7IGkrKyApIHtcclxuICAgICAgICB2YXIgYTEgPSBwb2ludHNbaV07XHJcbiAgICAgICAgdmFyIGEyID0gcG9pbnRzWyhpKzEpICUgbGVuZ3RoXTtcclxuXHJcbiAgICAgICAgaW50ZXIgPSBJbnRlcnNlY3Rpb24uaW50ZXJzZWN0Q2lyY2xlTGluZShjLCByLCBhMSwgYTIpO1xyXG4gICAgICAgIHJlc3VsdC5hcHBlbmRQb2ludHMoaW50ZXIucG9pbnRzKTtcclxuICAgIH1cclxuXHJcbiAgICBpZiAoIHJlc3VsdC5wb2ludHMubGVuZ3RoID4gMCApXHJcbiAgICAgICAgcmVzdWx0LnN0YXR1cyA9IFwiSW50ZXJzZWN0aW9uXCI7XHJcbiAgICBlbHNlXHJcbiAgICAgICAgcmVzdWx0LnN0YXR1cyA9IGludGVyLnN0YXR1cztcclxuXHJcbiAgICByZXR1cm4gcmVzdWx0O1xyXG59O1xyXG5cclxuXHJcbi8qKlxyXG4gKiAgaW50ZXJzZWN0Q2lyY2xlUmVjdGFuZ2xlXHJcbiAqXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IGNcclxuICogIEBwYXJhbSB7TnVtYmVyfSByXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IHIxXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IHIyXHJcbiAqICBAcmV0dXJucyB7SW50ZXJzZWN0aW9ufVxyXG4gKi9cclxuSW50ZXJzZWN0aW9uLmludGVyc2VjdENpcmNsZVJlY3RhbmdsZSA9IGZ1bmN0aW9uKGMsIHIsIHIxLCByMikge1xyXG4gICAgdmFyIG1pbiAgICAgICAgPSByMS5taW4ocjIpO1xyXG4gICAgdmFyIG1heCAgICAgICAgPSByMS5tYXgocjIpO1xyXG4gICAgdmFyIHRvcFJpZ2h0ICAgPSBuZXcgUG9pbnQyRCggbWF4LngsIG1pbi55ICk7XHJcbiAgICB2YXIgYm90dG9tTGVmdCA9IG5ldyBQb2ludDJEKCBtaW4ueCwgbWF4LnkgKTtcclxuXHJcbiAgICB2YXIgaW50ZXIxID0gSW50ZXJzZWN0aW9uLmludGVyc2VjdENpcmNsZUxpbmUoYywgciwgbWluLCB0b3BSaWdodCk7XHJcbiAgICB2YXIgaW50ZXIyID0gSW50ZXJzZWN0aW9uLmludGVyc2VjdENpcmNsZUxpbmUoYywgciwgdG9wUmlnaHQsIG1heCk7XHJcbiAgICB2YXIgaW50ZXIzID0gSW50ZXJzZWN0aW9uLmludGVyc2VjdENpcmNsZUxpbmUoYywgciwgbWF4LCBib3R0b21MZWZ0KTtcclxuICAgIHZhciBpbnRlcjQgPSBJbnRlcnNlY3Rpb24uaW50ZXJzZWN0Q2lyY2xlTGluZShjLCByLCBib3R0b21MZWZ0LCBtaW4pO1xyXG5cclxuICAgIHZhciByZXN1bHQgPSBuZXcgSW50ZXJzZWN0aW9uKFwiTm8gSW50ZXJzZWN0aW9uXCIpO1xyXG5cclxuICAgIHJlc3VsdC5hcHBlbmRQb2ludHMoaW50ZXIxLnBvaW50cyk7XHJcbiAgICByZXN1bHQuYXBwZW5kUG9pbnRzKGludGVyMi5wb2ludHMpO1xyXG4gICAgcmVzdWx0LmFwcGVuZFBvaW50cyhpbnRlcjMucG9pbnRzKTtcclxuICAgIHJlc3VsdC5hcHBlbmRQb2ludHMoaW50ZXI0LnBvaW50cyk7XHJcblxyXG4gICAgaWYgKCByZXN1bHQucG9pbnRzLmxlbmd0aCA+IDAgKVxyXG4gICAgICAgIHJlc3VsdC5zdGF0dXMgPSBcIkludGVyc2VjdGlvblwiO1xyXG4gICAgZWxzZVxyXG4gICAgICAgIHJlc3VsdC5zdGF0dXMgPSBpbnRlcjEuc3RhdHVzO1xyXG5cclxuICAgIHJldHVybiByZXN1bHQ7XHJcbn07XHJcblxyXG5cclxuLyoqXHJcbiAqICBpbnRlcnNlY3RFbGxpcHNlRWxsaXBzZVxyXG4gKlxyXG4gKiAgVGhpcyBjb2RlIGlzIGJhc2VkIG9uIE1nY0ludHIyREVscEVscC5jcHAgd3JpdHRlbiBieSBEYXZpZCBFYmVybHkuICBIaXNcclxuICogIGNvZGUgYWxvbmcgd2l0aCBtYW55IG90aGVyIGV4Y2VsbGVudCBleGFtcGxlcyBhcmUgYXZhaWFibGUgYXQgaGlzIHNpdGU6XHJcbiAqICBodHRwOi8vd3d3Lm1hZ2ljLXNvZnR3YXJlLmNvbVxyXG4gKlxyXG4gKiAgTk9URTogUm90YXRpb24gd2lsbCBuZWVkIHRvIGJlIGFkZGVkIHRvIHRoaXMgZnVuY3Rpb25cclxuICpcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gYzFcclxuICogIEBwYXJhbSB7TnVtYmVyfSByeDFcclxuICogIEBwYXJhbSB7TnVtYmVyfSByeTFcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gYzJcclxuICogIEBwYXJhbSB7TnVtYmVyfSByeDJcclxuICogIEBwYXJhbSB7TnVtYmVyfSByeTJcclxuICogIEByZXR1cm5zIHtJbnRlcnNlY3Rpb259XHJcbiAqL1xyXG5JbnRlcnNlY3Rpb24uaW50ZXJzZWN0RWxsaXBzZUVsbGlwc2UgPSBmdW5jdGlvbihjMSwgcngxLCByeTEsIGMyLCByeDIsIHJ5Mikge1xyXG4gICAgdmFyIGEgPSBbXHJcbiAgICAgICAgcnkxKnJ5MSwgMCwgcngxKnJ4MSwgLTIqcnkxKnJ5MSpjMS54LCAtMipyeDEqcngxKmMxLnksXHJcbiAgICAgICAgcnkxKnJ5MSpjMS54KmMxLnggKyByeDEqcngxKmMxLnkqYzEueSAtIHJ4MSpyeDEqcnkxKnJ5MVxyXG4gICAgXTtcclxuICAgIHZhciBiID0gW1xyXG4gICAgICAgIHJ5MipyeTIsIDAsIHJ4MipyeDIsIC0yKnJ5MipyeTIqYzIueCwgLTIqcngyKnJ4MipjMi55LFxyXG4gICAgICAgIHJ5MipyeTIqYzIueCpjMi54ICsgcngyKnJ4MipjMi55KmMyLnkgLSByeDIqcngyKnJ5MipyeTJcclxuICAgIF07XHJcblxyXG4gICAgdmFyIHlQb2x5ICAgPSBJbnRlcnNlY3Rpb24uYmV6b3V0KGEsIGIpO1xyXG4gICAgdmFyIHlSb290cyAgPSB5UG9seS5nZXRSb290cygpO1xyXG4gICAgdmFyIGVwc2lsb24gPSAxZS0zO1xyXG4gICAgdmFyIG5vcm0wICAgPSAoIGFbMF0qYVswXSArIDIqYVsxXSphWzFdICsgYVsyXSphWzJdICkgKiBlcHNpbG9uO1xyXG4gICAgdmFyIG5vcm0xICAgPSAoIGJbMF0qYlswXSArIDIqYlsxXSpiWzFdICsgYlsyXSpiWzJdICkgKiBlcHNpbG9uO1xyXG4gICAgdmFyIHJlc3VsdCAgPSBuZXcgSW50ZXJzZWN0aW9uKFwiTm8gSW50ZXJzZWN0aW9uXCIpO1xyXG5cclxuICAgIGZvciAoIHZhciB5ID0gMDsgeSA8IHlSb290cy5sZW5ndGg7IHkrKyApIHtcclxuICAgICAgICB2YXIgeFBvbHkgPSBuZXcgUG9seW5vbWlhbChcclxuICAgICAgICAgICAgYVswXSxcclxuICAgICAgICAgICAgYVszXSArIHlSb290c1t5XSAqIGFbMV0sXHJcbiAgICAgICAgICAgIGFbNV0gKyB5Um9vdHNbeV0gKiAoYVs0XSArIHlSb290c1t5XSphWzJdKVxyXG4gICAgICAgICk7XHJcbiAgICAgICAgdmFyIHhSb290cyA9IHhQb2x5LmdldFJvb3RzKCk7XHJcblxyXG4gICAgICAgIGZvciAoIHZhciB4ID0gMDsgeCA8IHhSb290cy5sZW5ndGg7IHgrKyApIHtcclxuICAgICAgICAgICAgdmFyIHRlc3QgPVxyXG4gICAgICAgICAgICAgICAgKCBhWzBdKnhSb290c1t4XSArIGFbMV0qeVJvb3RzW3ldICsgYVszXSApICogeFJvb3RzW3hdICtcclxuICAgICAgICAgICAgICAgICggYVsyXSp5Um9vdHNbeV0gKyBhWzRdICkgKiB5Um9vdHNbeV0gKyBhWzVdO1xyXG4gICAgICAgICAgICBpZiAoIE1hdGguYWJzKHRlc3QpIDwgbm9ybTAgKSB7XHJcbiAgICAgICAgICAgICAgICB0ZXN0ID1cclxuICAgICAgICAgICAgICAgICAgICAoIGJbMF0qeFJvb3RzW3hdICsgYlsxXSp5Um9vdHNbeV0gKyBiWzNdICkgKiB4Um9vdHNbeF0gK1xyXG4gICAgICAgICAgICAgICAgICAgICggYlsyXSp5Um9vdHNbeV0gKyBiWzRdICkgKiB5Um9vdHNbeV0gKyBiWzVdO1xyXG4gICAgICAgICAgICAgICAgaWYgKCBNYXRoLmFicyh0ZXN0KSA8IG5vcm0xICkge1xyXG4gICAgICAgICAgICAgICAgICAgIHJlc3VsdC5hcHBlbmRQb2ludCggbmV3IFBvaW50MkQoIHhSb290c1t4XSwgeVJvb3RzW3ldICkgKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICBpZiAoIHJlc3VsdC5wb2ludHMubGVuZ3RoID4gMCApIHJlc3VsdC5zdGF0dXMgPSBcIkludGVyc2VjdGlvblwiO1xyXG5cclxuICAgIHJldHVybiByZXN1bHQ7XHJcbn07XHJcblxyXG5cclxuLyoqXHJcbiAqICBpbnRlcnNlY3RFbGxpcHNlTGluZVxyXG4gKlxyXG4gKiAgTk9URTogUm90YXRpb24gd2lsbCBuZWVkIHRvIGJlIGFkZGVkIHRvIHRoaXMgZnVuY3Rpb25cclxuICpcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gY1xyXG4gKiAgQHBhcmFtIHtOdW1iZXJ9IHJ4XHJcbiAqICBAcGFyYW0ge051bWJlcn0gcnlcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gYTFcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gYTJcclxuICogIEByZXR1cm5zIHtJbnRlcnNlY3Rpb259XHJcbiAqL1xyXG5JbnRlcnNlY3Rpb24uaW50ZXJzZWN0RWxsaXBzZUxpbmUgPSBmdW5jdGlvbihjLCByeCwgcnksIGExLCBhMikge1xyXG4gICAgdmFyIHJlc3VsdDtcclxuICAgIHZhciBvcmlnaW4gPSBuZXcgVmVjdG9yMkQoYTEueCwgYTEueSk7XHJcbiAgICB2YXIgZGlyICAgID0gVmVjdG9yMkQuZnJvbVBvaW50cyhhMSwgYTIpO1xyXG4gICAgdmFyIGNlbnRlciA9IG5ldyBWZWN0b3IyRChjLngsIGMueSk7XHJcbiAgICB2YXIgZGlmZiAgID0gb3JpZ2luLnN1YnRyYWN0KGNlbnRlcik7XHJcbiAgICB2YXIgbURpciAgID0gbmV3IFZlY3RvcjJEKCBkaXIueC8ocngqcngpLCAgZGlyLnkvKHJ5KnJ5KSAgKTtcclxuICAgIHZhciBtRGlmZiAgPSBuZXcgVmVjdG9yMkQoIGRpZmYueC8ocngqcngpLCBkaWZmLnkvKHJ5KnJ5KSApO1xyXG5cclxuICAgIHZhciBhID0gZGlyLmRvdChtRGlyKTtcclxuICAgIHZhciBiID0gZGlyLmRvdChtRGlmZik7XHJcbiAgICB2YXIgYyA9IGRpZmYuZG90KG1EaWZmKSAtIDEuMDtcclxuICAgIHZhciBkID0gYipiIC0gYSpjO1xyXG5cclxuICAgIGlmICggZCA8IDAgKSB7XHJcbiAgICAgICAgcmVzdWx0ID0gbmV3IEludGVyc2VjdGlvbihcIk91dHNpZGVcIik7XHJcbiAgICB9IGVsc2UgaWYgKCBkID4gMCApIHtcclxuICAgICAgICB2YXIgcm9vdCA9IE1hdGguc3FydChkKTtcclxuICAgICAgICB2YXIgdF9hICA9ICgtYiAtIHJvb3QpIC8gYTtcclxuICAgICAgICB2YXIgdF9iICA9ICgtYiArIHJvb3QpIC8gYTtcclxuXHJcbiAgICAgICAgaWYgKCAodF9hIDwgMCB8fCAxIDwgdF9hKSAmJiAodF9iIDwgMCB8fCAxIDwgdF9iKSApIHtcclxuICAgICAgICAgICAgaWYgKCAodF9hIDwgMCAmJiB0X2IgPCAwKSB8fCAodF9hID4gMSAmJiB0X2IgPiAxKSApXHJcbiAgICAgICAgICAgICAgICByZXN1bHQgPSBuZXcgSW50ZXJzZWN0aW9uKFwiT3V0c2lkZVwiKTtcclxuICAgICAgICAgICAgZWxzZVxyXG4gICAgICAgICAgICAgICAgcmVzdWx0ID0gbmV3IEludGVyc2VjdGlvbihcIkluc2lkZVwiKTtcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICByZXN1bHQgPSBuZXcgSW50ZXJzZWN0aW9uKFwiSW50ZXJzZWN0aW9uXCIpO1xyXG4gICAgICAgICAgICBpZiAoIDAgPD0gdF9hICYmIHRfYSA8PSAxIClcclxuICAgICAgICAgICAgICAgIHJlc3VsdC5hcHBlbmRQb2ludCggYTEubGVycChhMiwgdF9hKSApO1xyXG4gICAgICAgICAgICBpZiAoIDAgPD0gdF9iICYmIHRfYiA8PSAxIClcclxuICAgICAgICAgICAgICAgIHJlc3VsdC5hcHBlbmRQb2ludCggYTEubGVycChhMiwgdF9iKSApO1xyXG4gICAgICAgIH1cclxuICAgIH0gZWxzZSB7XHJcbiAgICAgICAgdmFyIHQgPSAtYi9hO1xyXG4gICAgICAgIGlmICggMCA8PSB0ICYmIHQgPD0gMSApIHtcclxuICAgICAgICAgICAgcmVzdWx0ID0gbmV3IEludGVyc2VjdGlvbihcIkludGVyc2VjdGlvblwiKTtcclxuICAgICAgICAgICAgcmVzdWx0LmFwcGVuZFBvaW50KCBhMS5sZXJwKGEyLCB0KSApO1xyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgIHJlc3VsdCA9IG5ldyBJbnRlcnNlY3Rpb24oXCJPdXRzaWRlXCIpO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gcmVzdWx0O1xyXG59O1xyXG5cclxuXHJcbi8qKlxyXG4gKiAgaW50ZXJzZWN0RWxsaXBzZVBvbHlnb25cclxuICpcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gY1xyXG4gKiAgQHBhcmFtIHtOdW1iZXJ9IHJ4XHJcbiAqICBAcGFyYW0ge051bWJlcn0gcnlcclxuICogIEBwYXJhbSB7QXJyYXk8UG9pbnQyRD59IGMyXHJcbiAqICBAcmV0dXJucyB7SW50ZXJzZWN0aW9ufVxyXG4gKi9cclxuSW50ZXJzZWN0aW9uLmludGVyc2VjdEVsbGlwc2VQb2x5Z29uID0gZnVuY3Rpb24oYywgcngsIHJ5LCBwb2ludHMpIHtcclxuICAgIHZhciByZXN1bHQgPSBuZXcgSW50ZXJzZWN0aW9uKFwiTm8gSW50ZXJzZWN0aW9uXCIpO1xyXG4gICAgdmFyIGxlbmd0aCA9IHBvaW50cy5sZW5ndGg7XHJcblxyXG4gICAgZm9yICggdmFyIGkgPSAwOyBpIDwgbGVuZ3RoOyBpKysgKSB7XHJcbiAgICAgICAgdmFyIGIxID0gcG9pbnRzW2ldO1xyXG4gICAgICAgIHZhciBiMiA9IHBvaW50c1soaSsxKSAlIGxlbmd0aF07XHJcbiAgICAgICAgdmFyIGludGVyID0gSW50ZXJzZWN0aW9uLmludGVyc2VjdEVsbGlwc2VMaW5lKGMsIHJ4LCByeSwgYjEsIGIyKTtcclxuXHJcbiAgICAgICAgcmVzdWx0LmFwcGVuZFBvaW50cyhpbnRlci5wb2ludHMpO1xyXG4gICAgfVxyXG5cclxuICAgIGlmICggcmVzdWx0LnBvaW50cy5sZW5ndGggPiAwIClcclxuICAgICAgICByZXN1bHQuc3RhdHVzID0gXCJJbnRlcnNlY3Rpb25cIjtcclxuXHJcbiAgICByZXR1cm4gcmVzdWx0O1xyXG59O1xyXG5cclxuXHJcbi8qKlxyXG4gKiAgaW50ZXJzZWN0RWxsaXBzZVJlY3RhbmdsZVxyXG4gKlxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBjXHJcbiAqICBAcGFyYW0ge051bWJlcn0gcnhcclxuICogIEBwYXJhbSB7TnVtYmVyfSByeVxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSByMVxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSByMlxyXG4gKiAgQHJldHVybnMge0ludGVyc2VjdGlvbn1cclxuICovXHJcbkludGVyc2VjdGlvbi5pbnRlcnNlY3RFbGxpcHNlUmVjdGFuZ2xlID0gZnVuY3Rpb24oYywgcngsIHJ5LCByMSwgcjIpIHtcclxuICAgIHZhciBtaW4gICAgICAgID0gcjEubWluKHIyKTtcclxuICAgIHZhciBtYXggICAgICAgID0gcjEubWF4KHIyKTtcclxuICAgIHZhciB0b3BSaWdodCAgID0gbmV3IFBvaW50MkQoIG1heC54LCBtaW4ueSApO1xyXG4gICAgdmFyIGJvdHRvbUxlZnQgPSBuZXcgUG9pbnQyRCggbWluLngsIG1heC55ICk7XHJcblxyXG4gICAgdmFyIGludGVyMSA9IEludGVyc2VjdGlvbi5pbnRlcnNlY3RFbGxpcHNlTGluZShjLCByeCwgcnksIG1pbiwgdG9wUmlnaHQpO1xyXG4gICAgdmFyIGludGVyMiA9IEludGVyc2VjdGlvbi5pbnRlcnNlY3RFbGxpcHNlTGluZShjLCByeCwgcnksIHRvcFJpZ2h0LCBtYXgpO1xyXG4gICAgdmFyIGludGVyMyA9IEludGVyc2VjdGlvbi5pbnRlcnNlY3RFbGxpcHNlTGluZShjLCByeCwgcnksIG1heCwgYm90dG9tTGVmdCk7XHJcbiAgICB2YXIgaW50ZXI0ID0gSW50ZXJzZWN0aW9uLmludGVyc2VjdEVsbGlwc2VMaW5lKGMsIHJ4LCByeSwgYm90dG9tTGVmdCwgbWluKTtcclxuXHJcbiAgICB2YXIgcmVzdWx0ID0gbmV3IEludGVyc2VjdGlvbihcIk5vIEludGVyc2VjdGlvblwiKTtcclxuXHJcbiAgICByZXN1bHQuYXBwZW5kUG9pbnRzKGludGVyMS5wb2ludHMpO1xyXG4gICAgcmVzdWx0LmFwcGVuZFBvaW50cyhpbnRlcjIucG9pbnRzKTtcclxuICAgIHJlc3VsdC5hcHBlbmRQb2ludHMoaW50ZXIzLnBvaW50cyk7XHJcbiAgICByZXN1bHQuYXBwZW5kUG9pbnRzKGludGVyNC5wb2ludHMpO1xyXG5cclxuICAgIGlmICggcmVzdWx0LnBvaW50cy5sZW5ndGggPiAwIClcclxuICAgICAgICByZXN1bHQuc3RhdHVzID0gXCJJbnRlcnNlY3Rpb25cIjtcclxuXHJcbiAgICByZXR1cm4gcmVzdWx0O1xyXG59O1xyXG5cclxuXHJcbi8qKlxyXG4gKiAgaW50ZXJzZWN0TGluZUxpbmVcclxuICpcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gYTFcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gYTJcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gYjFcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gYjJcclxuICogIEByZXR1cm5zIHtJbnRlcnNlY3Rpb259XHJcbiAqL1xyXG5JbnRlcnNlY3Rpb24uaW50ZXJzZWN0TGluZUxpbmUgPSBmdW5jdGlvbihhMSwgYTIsIGIxLCBiMikge1xyXG4gICAgdmFyIHJlc3VsdDtcclxuXHJcbiAgICB2YXIgdWFfdCA9IChiMi54IC0gYjEueCkgKiAoYTEueSAtIGIxLnkpIC0gKGIyLnkgLSBiMS55KSAqIChhMS54IC0gYjEueCk7XHJcbiAgICB2YXIgdWJfdCA9IChhMi54IC0gYTEueCkgKiAoYTEueSAtIGIxLnkpIC0gKGEyLnkgLSBhMS55KSAqIChhMS54IC0gYjEueCk7XHJcbiAgICB2YXIgdV9iICA9IChiMi55IC0gYjEueSkgKiAoYTIueCAtIGExLngpIC0gKGIyLnggLSBiMS54KSAqIChhMi55IC0gYTEueSk7XHJcblxyXG4gICAgaWYgKCB1X2IgIT0gMCApIHtcclxuICAgICAgICB2YXIgdWEgPSB1YV90IC8gdV9iO1xyXG4gICAgICAgIHZhciB1YiA9IHViX3QgLyB1X2I7XHJcblxyXG4gICAgICAgIGlmICggMCA8PSB1YSAmJiB1YSA8PSAxICYmIDAgPD0gdWIgJiYgdWIgPD0gMSApIHtcclxuICAgICAgICAgICAgcmVzdWx0ID0gbmV3IEludGVyc2VjdGlvbihcIkludGVyc2VjdGlvblwiKTtcclxuICAgICAgICAgICAgcmVzdWx0LnBvaW50cy5wdXNoKFxyXG4gICAgICAgICAgICAgICAgbmV3IFBvaW50MkQoXHJcbiAgICAgICAgICAgICAgICAgICAgYTEueCArIHVhICogKGEyLnggLSBhMS54KSxcclxuICAgICAgICAgICAgICAgICAgICBhMS55ICsgdWEgKiAoYTIueSAtIGExLnkpXHJcbiAgICAgICAgICAgICAgICApXHJcbiAgICAgICAgICAgICk7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgcmVzdWx0ID0gbmV3IEludGVyc2VjdGlvbihcIk5vIEludGVyc2VjdGlvblwiKTtcclxuICAgICAgICB9XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICAgIGlmICggdWFfdCA9PSAwIHx8IHViX3QgPT0gMCApIHtcclxuICAgICAgICAgICAgcmVzdWx0ID0gbmV3IEludGVyc2VjdGlvbihcIkNvaW5jaWRlbnRcIik7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgcmVzdWx0ID0gbmV3IEludGVyc2VjdGlvbihcIlBhcmFsbGVsXCIpO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gcmVzdWx0O1xyXG59O1xyXG5cclxuXHJcbi8qKlxyXG4gKiAgaW50ZXJzZWN0TGluZVBvbHlnb25cclxuICpcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gYTFcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gYTJcclxuICogIEBwYXJhbSB7QXJyYXk8UG9pbnQyRD59IHBvaW50c1xyXG4gKiAgQHJldHVybnMge0ludGVyc2VjdGlvbn1cclxuICovXHJcbkludGVyc2VjdGlvbi5pbnRlcnNlY3RMaW5lUG9seWdvbiA9IGZ1bmN0aW9uKGExLCBhMiwgcG9pbnRzKSB7XHJcbiAgICB2YXIgcmVzdWx0ID0gbmV3IEludGVyc2VjdGlvbihcIk5vIEludGVyc2VjdGlvblwiKTtcclxuICAgIHZhciBsZW5ndGggPSBwb2ludHMubGVuZ3RoO1xyXG5cclxuICAgIGZvciAoIHZhciBpID0gMDsgaSA8IGxlbmd0aDsgaSsrICkge1xyXG4gICAgICAgIHZhciBiMSA9IHBvaW50c1tpXTtcclxuICAgICAgICB2YXIgYjIgPSBwb2ludHNbKGkrMSkgJSBsZW5ndGhdO1xyXG4gICAgICAgIHZhciBpbnRlciA9IEludGVyc2VjdGlvbi5pbnRlcnNlY3RMaW5lTGluZShhMSwgYTIsIGIxLCBiMik7XHJcblxyXG4gICAgICAgIHJlc3VsdC5hcHBlbmRQb2ludHMoaW50ZXIucG9pbnRzKTtcclxuICAgIH1cclxuXHJcbiAgICBpZiAoIHJlc3VsdC5wb2ludHMubGVuZ3RoID4gMCApIHJlc3VsdC5zdGF0dXMgPSBcIkludGVyc2VjdGlvblwiO1xyXG5cclxuICAgIHJldHVybiByZXN1bHQ7XHJcbn07XHJcblxyXG5cclxuLyoqXHJcbiAqICBpbnRlcnNlY3RMaW5lUmVjdGFuZ2xlXHJcbiAqXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IGExXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IGEyXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IHIxXHJcbiAqICBAcGFyYW0ge1BvaW50MkR9IHIyXHJcbiAqICBAcmV0dXJucyB7SW50ZXJzZWN0aW9ufVxyXG4gKi9cclxuSW50ZXJzZWN0aW9uLmludGVyc2VjdExpbmVSZWN0YW5nbGUgPSBmdW5jdGlvbihhMSwgYTIsIHIxLCByMikge1xyXG4gICAgdmFyIG1pbiAgICAgICAgPSByMS5taW4ocjIpO1xyXG4gICAgdmFyIG1heCAgICAgICAgPSByMS5tYXgocjIpO1xyXG4gICAgdmFyIHRvcFJpZ2h0ICAgPSBuZXcgUG9pbnQyRCggbWF4LngsIG1pbi55ICk7XHJcbiAgICB2YXIgYm90dG9tTGVmdCA9IG5ldyBQb2ludDJEKCBtaW4ueCwgbWF4LnkgKTtcclxuXHJcbiAgICB2YXIgaW50ZXIxID0gSW50ZXJzZWN0aW9uLmludGVyc2VjdExpbmVMaW5lKG1pbiwgdG9wUmlnaHQsIGExLCBhMik7XHJcbiAgICB2YXIgaW50ZXIyID0gSW50ZXJzZWN0aW9uLmludGVyc2VjdExpbmVMaW5lKHRvcFJpZ2h0LCBtYXgsIGExLCBhMik7XHJcbiAgICB2YXIgaW50ZXIzID0gSW50ZXJzZWN0aW9uLmludGVyc2VjdExpbmVMaW5lKG1heCwgYm90dG9tTGVmdCwgYTEsIGEyKTtcclxuICAgIHZhciBpbnRlcjQgPSBJbnRlcnNlY3Rpb24uaW50ZXJzZWN0TGluZUxpbmUoYm90dG9tTGVmdCwgbWluLCBhMSwgYTIpO1xyXG5cclxuICAgIHZhciByZXN1bHQgPSBuZXcgSW50ZXJzZWN0aW9uKFwiTm8gSW50ZXJzZWN0aW9uXCIpO1xyXG5cclxuICAgIHJlc3VsdC5hcHBlbmRQb2ludHMoaW50ZXIxLnBvaW50cyk7XHJcbiAgICByZXN1bHQuYXBwZW5kUG9pbnRzKGludGVyMi5wb2ludHMpO1xyXG4gICAgcmVzdWx0LmFwcGVuZFBvaW50cyhpbnRlcjMucG9pbnRzKTtcclxuICAgIHJlc3VsdC5hcHBlbmRQb2ludHMoaW50ZXI0LnBvaW50cyk7XHJcblxyXG4gICAgaWYgKCByZXN1bHQucG9pbnRzLmxlbmd0aCA+IDAgKVxyXG4gICAgICAgIHJlc3VsdC5zdGF0dXMgPSBcIkludGVyc2VjdGlvblwiO1xyXG5cclxuICAgIHJldHVybiByZXN1bHQ7XHJcbn07XHJcblxyXG5cclxuLyoqXHJcbiAqICBpbnRlcnNlY3RQb2x5Z29uUG9seWdvblxyXG4gKlxyXG4gKiAgQHBhcmFtIHtBcnJheTxQb2ludDJEPn0gcG9pbnRzMVxyXG4gKiAgQHBhcmFtIHtBcnJheTxQb2ludDJEPn0gcG9pbnRzMlxyXG4gKiAgQHJldHVybnMge0ludGVyc2VjdGlvbn1cclxuICovXHJcbkludGVyc2VjdGlvbi5pbnRlcnNlY3RQb2x5Z29uUG9seWdvbiA9IGZ1bmN0aW9uKHBvaW50czEsIHBvaW50czIpIHtcclxuICAgIHZhciByZXN1bHQgPSBuZXcgSW50ZXJzZWN0aW9uKFwiTm8gSW50ZXJzZWN0aW9uXCIpO1xyXG4gICAgdmFyIGxlbmd0aCA9IHBvaW50czEubGVuZ3RoO1xyXG5cclxuICAgIGZvciAoIHZhciBpID0gMDsgaSA8IGxlbmd0aDsgaSsrICkge1xyXG4gICAgICAgIHZhciBhMSA9IHBvaW50czFbaV07XHJcbiAgICAgICAgdmFyIGEyID0gcG9pbnRzMVsoaSsxKSAlIGxlbmd0aF07XHJcbiAgICAgICAgdmFyIGludGVyID0gSW50ZXJzZWN0aW9uLmludGVyc2VjdExpbmVQb2x5Z29uKGExLCBhMiwgcG9pbnRzMik7XHJcblxyXG4gICAgICAgIHJlc3VsdC5hcHBlbmRQb2ludHMoaW50ZXIucG9pbnRzKTtcclxuICAgIH1cclxuXHJcbiAgICBpZiAoIHJlc3VsdC5wb2ludHMubGVuZ3RoID4gMCApXHJcbiAgICAgICAgcmVzdWx0LnN0YXR1cyA9IFwiSW50ZXJzZWN0aW9uXCI7XHJcblxyXG4gICAgcmV0dXJuIHJlc3VsdDtcclxuXHJcbn07XHJcblxyXG5cclxuLyoqXHJcbiAqICBpbnRlcnNlY3RQb2x5Z29uUmVjdGFuZ2xlXHJcbiAqXHJcbiAqICBAcGFyYW0ge0FycmF5PFBvaW50MkQ+fSBwb2ludHNcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gcjFcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gcjJcclxuICogIEByZXR1cm5zIHtJbnRlcnNlY3Rpb259XHJcbiAqL1xyXG5JbnRlcnNlY3Rpb24uaW50ZXJzZWN0UG9seWdvblJlY3RhbmdsZSA9IGZ1bmN0aW9uKHBvaW50cywgcjEsIHIyKSB7XHJcbiAgICB2YXIgbWluICAgICAgICA9IHIxLm1pbihyMik7XHJcbiAgICB2YXIgbWF4ICAgICAgICA9IHIxLm1heChyMik7XHJcbiAgICB2YXIgdG9wUmlnaHQgICA9IG5ldyBQb2ludDJEKCBtYXgueCwgbWluLnkgKTtcclxuICAgIHZhciBib3R0b21MZWZ0ID0gbmV3IFBvaW50MkQoIG1pbi54LCBtYXgueSApO1xyXG5cclxuICAgIHZhciBpbnRlcjEgPSBJbnRlcnNlY3Rpb24uaW50ZXJzZWN0TGluZVBvbHlnb24obWluLCB0b3BSaWdodCwgcG9pbnRzKTtcclxuICAgIHZhciBpbnRlcjIgPSBJbnRlcnNlY3Rpb24uaW50ZXJzZWN0TGluZVBvbHlnb24odG9wUmlnaHQsIG1heCwgcG9pbnRzKTtcclxuICAgIHZhciBpbnRlcjMgPSBJbnRlcnNlY3Rpb24uaW50ZXJzZWN0TGluZVBvbHlnb24obWF4LCBib3R0b21MZWZ0LCBwb2ludHMpO1xyXG4gICAgdmFyIGludGVyNCA9IEludGVyc2VjdGlvbi5pbnRlcnNlY3RMaW5lUG9seWdvbihib3R0b21MZWZ0LCBtaW4sIHBvaW50cyk7XHJcblxyXG4gICAgdmFyIHJlc3VsdCA9IG5ldyBJbnRlcnNlY3Rpb24oXCJObyBJbnRlcnNlY3Rpb25cIik7XHJcblxyXG4gICAgcmVzdWx0LmFwcGVuZFBvaW50cyhpbnRlcjEucG9pbnRzKTtcclxuICAgIHJlc3VsdC5hcHBlbmRQb2ludHMoaW50ZXIyLnBvaW50cyk7XHJcbiAgICByZXN1bHQuYXBwZW5kUG9pbnRzKGludGVyMy5wb2ludHMpO1xyXG4gICAgcmVzdWx0LmFwcGVuZFBvaW50cyhpbnRlcjQucG9pbnRzKTtcclxuXHJcbiAgICBpZiAoIHJlc3VsdC5wb2ludHMubGVuZ3RoID4gMCApXHJcbiAgICAgICAgcmVzdWx0LnN0YXR1cyA9IFwiSW50ZXJzZWN0aW9uXCI7XHJcblxyXG4gICAgcmV0dXJuIHJlc3VsdDtcclxufTtcclxuXHJcblxyXG4vKipcclxuICogIGludGVyc2VjdFJheVJheVxyXG4gKlxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBhMVxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBhMlxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBiMVxyXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBiMlxyXG4gKiAgQHJldHVybnMge0ludGVyc2VjdGlvbn1cclxuICovXHJcbkludGVyc2VjdGlvbi5pbnRlcnNlY3RSYXlSYXkgPSBmdW5jdGlvbihhMSwgYTIsIGIxLCBiMikge1xyXG4gICAgdmFyIHJlc3VsdDtcclxuXHJcbiAgICB2YXIgdWFfdCA9IChiMi54IC0gYjEueCkgKiAoYTEueSAtIGIxLnkpIC0gKGIyLnkgLSBiMS55KSAqIChhMS54IC0gYjEueCk7XHJcbiAgICB2YXIgdWJfdCA9IChhMi54IC0gYTEueCkgKiAoYTEueSAtIGIxLnkpIC0gKGEyLnkgLSBhMS55KSAqIChhMS54IC0gYjEueCk7XHJcbiAgICB2YXIgdV9iICA9IChiMi55IC0gYjEueSkgKiAoYTIueCAtIGExLngpIC0gKGIyLnggLSBiMS54KSAqIChhMi55IC0gYTEueSk7XHJcblxyXG4gICAgaWYgKCB1X2IgIT0gMCApIHtcclxuICAgICAgICB2YXIgdWEgPSB1YV90IC8gdV9iO1xyXG5cclxuICAgICAgICByZXN1bHQgPSBuZXcgSW50ZXJzZWN0aW9uKFwiSW50ZXJzZWN0aW9uXCIpO1xyXG4gICAgICAgIHJlc3VsdC5wb2ludHMucHVzaChcclxuICAgICAgICAgICAgbmV3IFBvaW50MkQoXHJcbiAgICAgICAgICAgICAgICBhMS54ICsgdWEgKiAoYTIueCAtIGExLngpLFxyXG4gICAgICAgICAgICAgICAgYTEueSArIHVhICogKGEyLnkgLSBhMS55KVxyXG4gICAgICAgICAgICApXHJcbiAgICAgICAgKTtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgICAgaWYgKCB1YV90ID09IDAgfHwgdWJfdCA9PSAwICkge1xyXG4gICAgICAgICAgICByZXN1bHQgPSBuZXcgSW50ZXJzZWN0aW9uKFwiQ29pbmNpZGVudFwiKTtcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICByZXN1bHQgPSBuZXcgSW50ZXJzZWN0aW9uKFwiUGFyYWxsZWxcIik7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiByZXN1bHQ7XHJcbn07XHJcblxyXG5cclxuLyoqXHJcbiAqICBpbnRlcnNlY3RSZWN0YW5nbGVSZWN0YW5nbGVcclxuICpcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gYTFcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gYTJcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gYjFcclxuICogIEBwYXJhbSB7UG9pbnQyRH0gYjJcclxuICogIEByZXR1cm5zIHtJbnRlcnNlY3Rpb259XHJcbiAqL1xyXG5JbnRlcnNlY3Rpb24uaW50ZXJzZWN0UmVjdGFuZ2xlUmVjdGFuZ2xlID0gZnVuY3Rpb24oYTEsIGEyLCBiMSwgYjIpIHtcclxuICAgIHZhciBtaW4gICAgICAgID0gYTEubWluKGEyKTtcclxuICAgIHZhciBtYXggICAgICAgID0gYTEubWF4KGEyKTtcclxuICAgIHZhciB0b3BSaWdodCAgID0gbmV3IFBvaW50MkQoIG1heC54LCBtaW4ueSApO1xyXG4gICAgdmFyIGJvdHRvbUxlZnQgPSBuZXcgUG9pbnQyRCggbWluLngsIG1heC55ICk7XHJcblxyXG4gICAgdmFyIGludGVyMSA9IEludGVyc2VjdGlvbi5pbnRlcnNlY3RMaW5lUmVjdGFuZ2xlKG1pbiwgdG9wUmlnaHQsIGIxLCBiMik7XHJcbiAgICB2YXIgaW50ZXIyID0gSW50ZXJzZWN0aW9uLmludGVyc2VjdExpbmVSZWN0YW5nbGUodG9wUmlnaHQsIG1heCwgYjEsIGIyKTtcclxuICAgIHZhciBpbnRlcjMgPSBJbnRlcnNlY3Rpb24uaW50ZXJzZWN0TGluZVJlY3RhbmdsZShtYXgsIGJvdHRvbUxlZnQsIGIxLCBiMik7XHJcbiAgICB2YXIgaW50ZXI0ID0gSW50ZXJzZWN0aW9uLmludGVyc2VjdExpbmVSZWN0YW5nbGUoYm90dG9tTGVmdCwgbWluLCBiMSwgYjIpO1xyXG5cclxuICAgIHZhciByZXN1bHQgPSBuZXcgSW50ZXJzZWN0aW9uKFwiTm8gSW50ZXJzZWN0aW9uXCIpO1xyXG5cclxuICAgIHJlc3VsdC5hcHBlbmRQb2ludHMoaW50ZXIxLnBvaW50cyk7XHJcbiAgICByZXN1bHQuYXBwZW5kUG9pbnRzKGludGVyMi5wb2ludHMpO1xyXG4gICAgcmVzdWx0LmFwcGVuZFBvaW50cyhpbnRlcjMucG9pbnRzKTtcclxuICAgIHJlc3VsdC5hcHBlbmRQb2ludHMoaW50ZXI0LnBvaW50cyk7XHJcblxyXG4gICAgaWYgKCByZXN1bHQucG9pbnRzLmxlbmd0aCA+IDAgKVxyXG4gICAgICAgIHJlc3VsdC5zdGF0dXMgPSBcIkludGVyc2VjdGlvblwiO1xyXG5cclxuICAgIHJldHVybiByZXN1bHQ7XHJcbn07XHJcblxyXG5cclxuLyoqXHJcbiAqICBiZXpvdXRcclxuICpcclxuICogIFRoaXMgY29kZSBpcyBiYXNlZCBvbiBNZ2NJbnRyMkRFbHBFbHAuY3BwIHdyaXR0ZW4gYnkgRGF2aWQgRWJlcmx5LiAgSGlzXHJcbiAqICBjb2RlIGFsb25nIHdpdGggbWFueSBvdGhlciBleGNlbGxlbnQgZXhhbXBsZXMgYXJlIGF2YWlhYmxlIGF0IGhpcyBzaXRlOlxyXG4gKiAgaHR0cDovL3d3dy5tYWdpYy1zb2Z0d2FyZS5jb21cclxuICpcclxuICogIEBwYXJhbSB7QXJyYXk8UG9pbnQyRD59IGUxXHJcbiAqICBAcGFyYW0ge0FycmF5PFBvaW50MkQ+fSBlMlxyXG4gKiAgQHJldHVybnMge1BvbHlub21pYWx9XHJcbiAqL1xyXG5JbnRlcnNlY3Rpb24uYmV6b3V0ID0gZnVuY3Rpb24oZTEsIGUyKSB7XHJcbiAgICB2YXIgQUIgICAgPSBlMVswXSplMlsxXSAtIGUyWzBdKmUxWzFdO1xyXG4gICAgdmFyIEFDICAgID0gZTFbMF0qZTJbMl0gLSBlMlswXSplMVsyXTtcclxuICAgIHZhciBBRCAgICA9IGUxWzBdKmUyWzNdIC0gZTJbMF0qZTFbM107XHJcbiAgICB2YXIgQUUgICAgPSBlMVswXSplMls0XSAtIGUyWzBdKmUxWzRdO1xyXG4gICAgdmFyIEFGICAgID0gZTFbMF0qZTJbNV0gLSBlMlswXSplMVs1XTtcclxuICAgIHZhciBCQyAgICA9IGUxWzFdKmUyWzJdIC0gZTJbMV0qZTFbMl07XHJcbiAgICB2YXIgQkUgICAgPSBlMVsxXSplMls0XSAtIGUyWzFdKmUxWzRdO1xyXG4gICAgdmFyIEJGICAgID0gZTFbMV0qZTJbNV0gLSBlMlsxXSplMVs1XTtcclxuICAgIHZhciBDRCAgICA9IGUxWzJdKmUyWzNdIC0gZTJbMl0qZTFbM107XHJcbiAgICB2YXIgREUgICAgPSBlMVszXSplMls0XSAtIGUyWzNdKmUxWzRdO1xyXG4gICAgdmFyIERGICAgID0gZTFbM10qZTJbNV0gLSBlMlszXSplMVs1XTtcclxuICAgIHZhciBCRnBERSA9IEJGICsgREU7XHJcbiAgICB2YXIgQkVtQ0QgPSBCRSAtIENEO1xyXG5cclxuICAgIHJldHVybiBuZXcgUG9seW5vbWlhbChcclxuICAgICAgICBBQipCQyAtIEFDKkFDLFxyXG4gICAgICAgIEFCKkJFbUNEICsgQUQqQkMgLSAyKkFDKkFFLFxyXG4gICAgICAgIEFCKkJGcERFICsgQUQqQkVtQ0QgLSBBRSpBRSAtIDIqQUMqQUYsXHJcbiAgICAgICAgQUIqREYgKyBBRCpCRnBERSAtIDIqQUUqQUYsXHJcbiAgICAgICAgQUQqREYgLSBBRipBRlxyXG4gICAgKTtcclxufTtcclxuXHJcbmlmICh0eXBlb2YgbW9kdWxlICE9PSBcInVuZGVmaW5lZFwiKSB7XHJcbiAgICBtb2R1bGUuZXhwb3J0cyA9IEludGVyc2VjdGlvbjtcclxufVxyXG4iLCIvKipcclxuICpcclxuICogICBJbnRlcnNlY3Rpb25QYXJhbXMuanNcclxuICpcclxuICogICBjb3B5cmlnaHQgMjAwMiwgS2V2aW4gTGluZHNleVxyXG4gKlxyXG4gKi9cclxuXHJcbi8qKlxyXG4gKiAgSW50ZXJzZWN0aW9uUGFyYW1zXHJcbiAqXHJcbiAqICBAcGFyYW0ge1N0cmluZ30gbmFtZVxyXG4gKiAgQHBhcmFtIHtBcnJheTxQb2ludDJEfSBwYXJhbXNcclxuICogIEByZXR1cm5zIHtJbnRlcnNlY3Rpb25QYXJhbXN9XHJcbiAqL1xyXG5mdW5jdGlvbiBJbnRlcnNlY3Rpb25QYXJhbXMobmFtZSwgcGFyYW1zKSB7XHJcbiAgICB0aGlzLmluaXQobmFtZSwgcGFyYW1zKTtcclxufVxyXG5cclxuLyoqXHJcbiAqICBpbml0XHJcbiAqXHJcbiAqICBAcGFyYW0ge1N0cmluZ30gbmFtZVxyXG4gKiAgQHBhcmFtIHtBcnJheTxQb2ludDJEPn0gcGFyYW1zXHJcbiAqL1xyXG5JbnRlcnNlY3Rpb25QYXJhbXMucHJvdG90eXBlLmluaXQgPSBmdW5jdGlvbihuYW1lLCBwYXJhbXMpIHtcclxuICAgIHRoaXMubmFtZSAgID0gbmFtZTtcclxuICAgIHRoaXMucGFyYW1zID0gcGFyYW1zO1xyXG59O1xyXG5cclxuaWYgKHR5cGVvZiBtb2R1bGUgIT09IFwidW5kZWZpbmVkXCIpIHtcclxuICAgIG1vZHVsZS5leHBvcnRzID0gSW50ZXJzZWN0aW9uUGFyYW1zO1xyXG59IiwiLy8gZXhwb3NlIGNsYXNzZXNcblxuZXhwb3J0cy5Qb2ludDJEID0gcmVxdWlyZSgnLi9saWIvUG9pbnQyRCcpO1xuZXhwb3J0cy5WZWN0b3IyRCA9IHJlcXVpcmUoJy4vbGliL1ZlY3RvcjJEJyk7XG5leHBvcnRzLk1hdHJpeDJEID0gcmVxdWlyZSgnLi9saWIvTWF0cml4MkQnKTtcbiIsIi8qKlxuICpcbiAqICAgTWF0cml4MkQuanNcbiAqXG4gKiAgIGNvcHlyaWdodCAyMDAxLTIwMDIsIDIwMTMgS2V2aW4gTGluZHNleVxuICpcbiAqL1xuXG4vKipcbiAqICBNYXRyaXgyRFxuICpcbiAqICBAcGFyYW0ge051bWJlcn0gYVxuICogIEBwYXJhbSB7TnVtYmVyfSBiXG4gKiAgQHBhcmFtIHtOdW1iZXJ9IGNcbiAqICBAcGFyYW0ge051bWJlcn0gZFxuICogIEBwYXJhbSB7TnVtYmVyfSBlXG4gKiAgQHBhcmFtIHtOdW1iZXJ9IGZcbiAqICBAcmV0dXJucyB7TWF0cml4MkR9XG4gKi9cbmZ1bmN0aW9uIE1hdHJpeDJEKGEsIGIsIGMsIGQsIGUsIGYpIHtcbiAgICBPYmplY3QuZGVmaW5lUHJvcGVydGllcyh0aGlzLCB7XG4gICAgICAgIFwiYVwiOiB7XG4gICAgICAgICAgICB2YWx1ZTogKGEgIT09IHVuZGVmaW5lZCkgPyBhIDogMSxcbiAgICAgICAgICAgIHdyaXRhYmxlOiBmYWxzZSxcbiAgICAgICAgICAgIGVudW1lcmFibGU6IHRydWUsXG4gICAgICAgICAgICBjb25maWd1cmFibGU6IGZhbHNlXG4gICAgICAgIH0sXG4gICAgICAgIFwiYlwiOiB7XG4gICAgICAgICAgICB2YWx1ZTogKGIgIT09IHVuZGVmaW5lZCkgPyBiIDogMCxcbiAgICAgICAgICAgIHdyaXRhYmxlOiBmYWxzZSxcbiAgICAgICAgICAgIGVudW1lcmFibGU6IHRydWUsXG4gICAgICAgICAgICBjb25maWd1cmFibGU6IGZhbHNlXG4gICAgICAgIH0sXG4gICAgICAgIFwiY1wiOiB7XG4gICAgICAgICAgICB2YWx1ZTogKGMgIT09IHVuZGVmaW5lZCkgPyBjIDogMCxcbiAgICAgICAgICAgIHdyaXRhYmxlOiBmYWxzZSxcbiAgICAgICAgICAgIGVudW1lcmFibGU6IHRydWUsXG4gICAgICAgICAgICBjb25maWd1cmFibGU6IGZhbHNlXG4gICAgICAgIH0sXG4gICAgICAgIFwiZFwiOiB7XG4gICAgICAgICAgICB2YWx1ZTogKGQgIT09IHVuZGVmaW5lZCkgPyBkIDogMSxcbiAgICAgICAgICAgIHdyaXRhYmxlOiBmYWxzZSxcbiAgICAgICAgICAgIGVudW1lcmFibGU6IHRydWUsXG4gICAgICAgICAgICBjb25maWd1cmFibGU6IGZhbHNlXG4gICAgICAgIH0sXG4gICAgICAgIFwiZVwiOiB7XG4gICAgICAgICAgICB2YWx1ZTogKGUgIT09IHVuZGVmaW5lZCkgPyBlIDogMCxcbiAgICAgICAgICAgIHdyaXRhYmxlOiBmYWxzZSxcbiAgICAgICAgICAgIGVudW1lcmFibGU6IHRydWUsXG4gICAgICAgICAgICBjb25maWd1cmFibGU6IGZhbHNlXG4gICAgICAgIH0sXG4gICAgICAgIFwiZlwiOiB7XG4gICAgICAgICAgICB2YWx1ZTogKGYgIT09IHVuZGVmaW5lZCkgPyBmIDogMCxcbiAgICAgICAgICAgIHdyaXRhYmxlOiBmYWxzZSxcbiAgICAgICAgICAgIGVudW1lcmFibGU6IHRydWUsXG4gICAgICAgICAgICBjb25maWd1cmFibGU6IGZhbHNlXG4gICAgICAgIH1cbiAgICB9KTtcbiAgICAvLyB0aGlzLmEgPSAoYSAhPT0gdW5kZWZpbmVkKSA/IGEgOiAxO1xuICAgIC8vIHRoaXMuYiA9IChiICE9PSB1bmRlZmluZWQpID8gYiA6IDA7XG4gICAgLy8gdGhpcy5jID0gKGMgIT09IHVuZGVmaW5lZCkgPyBjIDogMDtcbiAgICAvLyB0aGlzLmQgPSAoZCAhPT0gdW5kZWZpbmVkKSA/IGQgOiAxO1xuICAgIC8vIHRoaXMuZSA9IChlICE9PSB1bmRlZmluZWQpID8gZSA6IDA7XG4gICAgLy8gdGhpcy5mID0gKGYgIT09IHVuZGVmaW5lZCkgPyBmIDogMDtcbn1cblxuLyoqXG4gKiAgSWRlbnRpdHkgbWF0cml4XG4gKlxuICogIEByZXR1cm5zIHtNYXRyaXgyRH1cbiAqL1xuTWF0cml4MkQuSURFTlRJVFkgPSBuZXcgTWF0cml4MkQoMSwgMCwgMCwgMSwgMCwgMCk7XG5cbi8vIFRPRE86IHJvdGF0ZSwgc2tldywgZXRjLiBtYXRyaWNlcyBhcyB3ZWxsP1xuXG4vKipcbiAqICBtdWx0aXBseVxuICpcbiAqICBAcGFyYXJtIHtNYXRyaXgyRH0gdGhhdFxuICogIEByZXR1cm5zIHtNYXRyaXgyRH1cbiAqL1xuTWF0cml4MkQucHJvdG90eXBlLm11bHRpcGx5ID0gZnVuY3Rpb24odGhhdCkge1xuICAgIHJldHVybiBuZXcgTWF0cml4MkQoXG4gICAgICAgIHRoaXMuYSAqIHRoYXQuYSArIHRoaXMuYyAqIHRoYXQuYixcbiAgICAgICAgdGhpcy5iICogdGhhdC5hICsgdGhpcy5kICogdGhhdC5iLFxuICAgICAgICB0aGlzLmEgKiB0aGF0LmMgKyB0aGlzLmMgKiB0aGF0LmQsXG4gICAgICAgIHRoaXMuYiAqIHRoYXQuYyArIHRoaXMuZCAqIHRoYXQuZCxcbiAgICAgICAgdGhpcy5hICogdGhhdC5lICsgdGhpcy5jICogdGhhdC5mICsgdGhpcy5lLFxuICAgICAgICB0aGlzLmIgKiB0aGF0LmUgKyB0aGlzLmQgKiB0aGF0LmYgKyB0aGlzLmZcbiAgICApO1xufTtcblxuLyoqXG4gKiAgaW52ZXJzZVxuICpcbiAqICBAcmV0dXJucyB7TWF0cml4MkR9XG4gKi9cbk1hdHJpeDJELnByb3RvdHlwZS5pbnZlcnNlID0gZnVuY3Rpb24oKSB7XG4gICAgdmFyIGRldDEgPSB0aGlzLmEgKiB0aGlzLmQgLSB0aGlzLmIgKiB0aGlzLmM7XG5cbiAgICBpZiAoIGRldDEgPT0gMC4wIClcbiAgICAgICAgdGhyb3coXCJNYXRyaXggaXMgbm90IGludmVydGlibGVcIik7XG5cbiAgICB2YXIgaWRldCA9IDEuMCAvIGRldDE7XG4gICAgdmFyIGRldDIgPSB0aGlzLmYgKiB0aGlzLmMgLSB0aGlzLmUgKiB0aGlzLmQ7XG4gICAgdmFyIGRldDMgPSB0aGlzLmUgKiB0aGlzLmIgLSB0aGlzLmYgKiB0aGlzLmE7XG5cbiAgICByZXR1cm4gbmV3IE1hdHJpeDJEKFxuICAgICAgICB0aGlzLmQgKiBpZGV0LFxuICAgICAgIC10aGlzLmIgKiBpZGV0LFxuICAgICAgIC10aGlzLmMgKiBpZGV0LFxuICAgICAgICB0aGlzLmEgKiBpZGV0LFxuICAgICAgICAgIGRldDIgKiBpZGV0LFxuICAgICAgICAgIGRldDMgKiBpZGV0XG4gICAgKTtcbn07XG5cbi8qKlxuICogIHRyYW5zbGF0ZVxuICpcbiAqICBAcGFyYW0ge051bWJlcn0gdHhcbiAqICBAcGFyYW0ge051bWJlcn0gdHlcbiAqICBAcmV0dXJucyB7TWF0cml4MkR9XG4gKi9cbk1hdHJpeDJELnByb3RvdHlwZS50cmFuc2xhdGUgPSBmdW5jdGlvbih0eCwgdHkpIHtcbiAgICByZXR1cm4gbmV3IE1hdHJpeDJEKFxuICAgICAgICB0aGlzLmEsXG4gICAgICAgIHRoaXMuYixcbiAgICAgICAgdGhpcy5jLFxuICAgICAgICB0aGlzLmQsXG4gICAgICAgIHRoaXMuYSAqIHR4ICsgdGhpcy5jICogdHkgKyB0aGlzLmUsXG4gICAgICAgIHRoaXMuYiAqIHR4ICsgdGhpcy5kICogdHkgKyB0aGlzLmZcbiAgICApO1xufTtcblxuLyoqXG4gKiAgc2NhbGVcbiAqXG4gKiAgQHBhcmFtIHtOdW1iZXJ9IHNjYWxlXG4gKiAgQHJldHVybnMge01hdHJpeDJEfVxuICovXG5NYXRyaXgyRC5wcm90b3R5cGUuc2NhbGUgPSBmdW5jdGlvbihzY2FsZSkge1xuICAgIHJldHVybiBuZXcgTWF0cml4MkQoXG4gICAgICAgIHRoaXMuYSAqIHNjYWxlLFxuICAgICAgICB0aGlzLmIgKiBzY2FsZSxcbiAgICAgICAgdGhpcy5jICogc2NhbGUsXG4gICAgICAgIHRoaXMuZCAqIHNjYWxlLFxuICAgICAgICB0aGlzLmUsXG4gICAgICAgIHRoaXMuZlxuICAgICk7XG59O1xuXG4vKipcbiAqICBzY2FsZUF0XG4gKlxuICogIEBwYXJhbSB7TnVtYmVyfSBzY2FsZVxuICogIEBwYXJhbSB7UG9pbnQyRH0gY2VudGVyXG4gKiAgQHJldHVybnMge01hdHJpeDJEfVxuICovXG5NYXRyaXgyRC5wcm90b3R5cGUuc2NhbGVBdCA9IGZ1bmN0aW9uKHNjYWxlLCBjZW50ZXIpIHtcbiAgICB2YXIgZHggPSBjZW50ZXIueCAtIHNjYWxlICogY2VudGVyLng7XG4gICAgdmFyIGR5ID0gY2VudGVyLnkgLSBzY2FsZSAqIGNlbnRlci55O1xuXG4gICAgcmV0dXJuIG5ldyBNYXRyaXgyRChcbiAgICAgICAgdGhpcy5hICogc2NhbGUsXG4gICAgICAgIHRoaXMuYiAqIHNjYWxlLFxuICAgICAgICB0aGlzLmMgKiBzY2FsZSxcbiAgICAgICAgdGhpcy5kICogc2NhbGUsXG4gICAgICAgIHRoaXMuYSAqIGR4ICsgdGhpcy5jICogZHkgKyB0aGlzLmUsXG4gICAgICAgIHRoaXMuYiAqIGR4ICsgdGhpcy5kICogZHkgKyB0aGlzLmZcbiAgICApO1xufTtcblxuLyoqXG4gKiAgc2NhbGVOb25Vbmlmb3JtXG4gKlxuICogIEBwYXJhbSB7TnVtYmVyfSBzY2FsZVhcbiAqICBAcGFyYW0ge051bWJlcn0gc2NhbGVZXG4gKiAgQHJldHVybnMge01hdHJpeDJEfVxuICovXG5NYXRyaXgyRC5wcm90b3R5cGUuc2NhbGVOb25Vbmlmb3JtID0gZnVuY3Rpb24oc2NhbGVYLCBzY2FsZVkpIHtcbiAgICByZXR1cm4gbmV3IE1hdHJpeDJEKFxuICAgICAgICB0aGlzLmEgKiBzY2FsZVgsXG4gICAgICAgIHRoaXMuYiAqIHNjYWxlWCxcbiAgICAgICAgdGhpcy5jICogc2NhbGVZLFxuICAgICAgICB0aGlzLmQgKiBzY2FsZVksXG4gICAgICAgIHRoaXMuZSxcbiAgICAgICAgdGhpcy5mXG4gICAgKTtcbn07XG5cbi8qKlxuICogIHNjYWxlTm9uVW5pZm9ybUF0XG4gKlxuICogIEBwYXJhbSB7TnVtYmVyfSBzY2FsZVhcbiAqICBAcGFyYW0ge051bWJlcn0gc2NhbGVZXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBjZW50ZXJcbiAqICBAcmV0dXJucyB7TWF0cml4MkR9XG4gKi9cbk1hdHJpeDJELnByb3RvdHlwZS5zY2FsZU5vblVuaWZvcm1BdCA9IGZ1bmN0aW9uKHNjYWxlWCwgc2NhbGVZLCBjZW50ZXIpIHtcbiAgICB2YXIgZHggPSBjZW50ZXIueCAtIHNjYWxlWCAqIGNlbnRlci54O1xuICAgIHZhciBkeSA9IGNlbnRlci55IC0gc2NhbGVZICogY2VudGVyLnk7XG5cbiAgICByZXR1cm4gbmV3IE1hdHJpeDJEKFxuICAgICAgICB0aGlzLmEgKiBzY2FsZVgsXG4gICAgICAgIHRoaXMuYiAqIHNjYWxlWCxcbiAgICAgICAgdGhpcy5jICogc2NhbGVZLFxuICAgICAgICB0aGlzLmQgKiBzY2FsZVksXG4gICAgICAgIHRoaXMuYSAqIGR4ICsgdGhpcy5jICogZHkgKyB0aGlzLmUsXG4gICAgICAgIHRoaXMuYiAqIGR4ICsgdGhpcy5kICogZHkgKyB0aGlzLmZcbiAgICApO1xufTtcblxuLyoqXG4gKiAgcm90YXRlXG4gKlxuICogIEBwYXJhbSB7TnVtYmVyfSByYWRpYW5zXG4gKiAgQHJldHVybnMge01hdHJpeDJEfVxuICovXG5NYXRyaXgyRC5wcm90b3R5cGUucm90YXRlID0gZnVuY3Rpb24ocmFkaWFucykge1xuICAgIHZhciBjID0gTWF0aC5jb3MocmFkaWFucyk7XG4gICAgdmFyIHMgPSBNYXRoLnNpbihyYWRpYW5zKTtcblxuICAgIHJldHVybiBuZXcgTWF0cml4MkQoXG4gICAgICAgIHRoaXMuYSAqICBjICsgdGhpcy5jICogcyxcbiAgICAgICAgdGhpcy5iICogIGMgKyB0aGlzLmQgKiBzLFxuICAgICAgICB0aGlzLmEgKiAtcyArIHRoaXMuYyAqIGMsXG4gICAgICAgIHRoaXMuYiAqIC1zICsgdGhpcy5kICogYyxcbiAgICAgICAgdGhpcy5lLFxuICAgICAgICB0aGlzLmZcbiAgICApO1xufTtcblxuLyoqXG4gKiAgcm90YXRlQXRcbiAqXG4gKiAgQHBhcmFtIHtOdW1iZXJ9IHJhZGlhbnNcbiAqICBAcGFyYW0ge1BvaW50MkR9IGNlbnRlclxuICogIEByZXN1bHQge01hdHJpeDJEfVxuICovXG5NYXRyaXgyRC5wcm90b3R5cGUucm90YXRlQXQgPSBmdW5jdGlvbihyYWRpYW5zLCBjZW50ZXIpIHtcbiAgICB2YXIgYyA9IE1hdGguY29zKHJhZGlhbnMpO1xuICAgIHZhciBzID0gTWF0aC5zaW4ocmFkaWFucyk7XG4gICAgdmFyIHQxID0gLWNlbnRlci54ICsgY2VudGVyLnggKiBjIC0gY2VudGVyLnkgKiBzO1xuICAgIHZhciB0MiA9IC1jZW50ZXIueSArIGNlbnRlci55ICogYyArIGNlbnRlci54ICogcztcblxuICAgIHJldHVybiBuZXcgTWF0cml4MkQoXG4gICAgICAgIHRoaXMuYSAqICBjICsgdGhpcy5jICogcyxcbiAgICAgICAgdGhpcy5iICogIGMgKyB0aGlzLmQgKiBzLFxuICAgICAgICB0aGlzLmEgKiAtcyArIHRoaXMuYyAqIGMsXG4gICAgICAgIHRoaXMuYiAqIC1zICsgdGhpcy5kICogYyxcbiAgICAgICAgdGhpcy5hICogdDEgKyB0aGlzLmMgKiB0MiArIHRoaXMuZSxcbiAgICAgICAgdGhpcy5iICogdDEgKyB0aGlzLmQgKiB0MiArIHRoaXMuZlxuICAgICk7XG59O1xuXG4vKipcbiAqICByb3RhdGVGcm9tVmVjdG9yXG4gKlxuICogIEBwYXJhbSB7VmVjdG9yMkR9XG4gKiAgQHJldHVybnMge01hdHJpeDJEfVxuICovXG5NYXRyaXgyRC5wcm90b3R5cGUucm90YXRlRnJvbVZlY3RvciA9IGZ1bmN0aW9uKHZlY3Rvcikge1xuICAgIHZhciB1bml0ID0gdmVjdG9yLnVuaXQoKTtcbiAgICB2YXIgYyA9IHVuaXQueDsgLy8gY29zXG4gICAgdmFyIHMgPSB1bml0Lnk7IC8vIHNpblxuXG4gICAgcmV0dXJuIG5ldyBNYXRyaXgyRChcbiAgICAgICAgdGhpcy5hICogIGMgKyB0aGlzLmMgKiBzLFxuICAgICAgICB0aGlzLmIgKiAgYyArIHRoaXMuZCAqIHMsXG4gICAgICAgIHRoaXMuYSAqIC1zICsgdGhpcy5jICogYyxcbiAgICAgICAgdGhpcy5iICogLXMgKyB0aGlzLmQgKiBjLFxuICAgICAgICB0aGlzLmUsXG4gICAgICAgIHRoaXMuZlxuICAgICk7XG59O1xuXG4vKipcbiAqICBmbGlwWFxuICpcbiAqICBAcmV0dXJucyB7TWF0cml4MkR9XG4gKi9cbk1hdHJpeDJELnByb3RvdHlwZS5mbGlwWCA9IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiBuZXcgTWF0cml4MkQoXG4gICAgICAgIC10aGlzLmEsXG4gICAgICAgIC10aGlzLmIsXG4gICAgICAgICB0aGlzLmMsXG4gICAgICAgICB0aGlzLmQsXG4gICAgICAgICB0aGlzLmUsXG4gICAgICAgICB0aGlzLmZcbiAgICApO1xufTtcblxuLyoqXG4gKiAgZmxpcFlcbiAqXG4gKiAgQHJldHVybnMge01hdHJpeDJEfVxuICovXG5NYXRyaXgyRC5wcm90b3R5cGUuZmxpcFkgPSBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gbmV3IE1hdHJpeDJEKFxuICAgICAgICAgdGhpcy5hLFxuICAgICAgICAgdGhpcy5iLFxuICAgICAgICAtdGhpcy5jLFxuICAgICAgICAtdGhpcy5kLFxuICAgICAgICAgdGhpcy5lLFxuICAgICAgICAgdGhpcy5mXG4gICAgKTtcbn07XG5cbi8qKlxuICogIHNrZXdYXG4gKlxuICogIEBwYXJhcm0ge051bWJlcn0gcmFkaWFuc1xuICogIEByZXR1cm5zIHtNYXRyaXgyRH1cbiAqL1xuTWF0cml4MkQucHJvdG90eXBlLnNrZXdYID0gZnVuY3Rpb24ocmFkaWFucykge1xuICAgIHZhciB0ID0gTWF0aC50YW4ocmFkaWFucyk7XG5cbiAgICByZXR1cm4gbmV3IE1hdHJpeDJEKFxuICAgICAgICB0aGlzLmEsXG4gICAgICAgIHRoaXMuYixcbiAgICAgICAgdGhpcy5hICogdCArIHRoaXMuYyxcbiAgICAgICAgdGhpcy5iICogdCArIHRoaXMuZCxcbiAgICAgICAgdGhpcy5lLFxuICAgICAgICB0aGlzLmZcbiAgICApO1xufTtcblxuLy8gVE9ETzogc2tld1hBdFxuXG4vKipcbiAqICBza2V3WVxuICpcbiAqICBAcGFyYXJtIHtOdW1iZXJ9IHJhZGlhbnNcbiAqICBAcmV0dXJucyB7TWF0cml4MkR9XG4gKi9cbk1hdHJpeDJELnByb3RvdHlwZS5za2V3WSA9IGZ1bmN0aW9uKHJhZGlhbnMpIHtcbiAgICB2YXIgdCA9IE1hdGgudGFuKGFuZ2xlKTtcblxuICAgIHJldHVybiBtYXRyaXhfbmV3KFxuICAgICAgICB0aGlzLmEgKyB0aGlzLmMgKiB0LFxuICAgICAgICB0aGlzLmIgKyB0aGlzLmQgKiB0LFxuICAgICAgICB0aGlzLmMsXG4gICAgICAgIHRoaXMuZCxcbiAgICAgICAgdGhpcy5lLFxuICAgICAgICB0aGlzLmZcbiAgICApO1xufTtcblxuLy8gVE9ETzogc2tld1lBdFxuXG4vKipcbiAqICBpc0lkZW50aXR5XG4gKlxuICogIEByZXR1cm5zIHtCb29sZWFufVxuICovXG5NYXRyaXgyRC5wcm90b3R5cGUuaXNJZGVudGl0eSA9IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiAoXG4gICAgICAgIHRoaXMuYSA9PT0gMS4wICYmXG4gICAgICAgIHRoaXMuYiA9PT0gMC4wICYmXG4gICAgICAgIHRoaXMuYyA9PT0gMC4wICYmXG4gICAgICAgIHRoaXMuZCA9PT0gMS4wICYmXG4gICAgICAgIHRoaXMuZSA9PT0gMC4wICYmXG4gICAgICAgIHRoaXMuZiA9PT0gMC4wXG4gICAgKTtcbn07XG5cbi8qKlxuICogIGlzSW52ZXJ0aWJsZVxuICpcbiAqICBAcmV0dXJucyB7Qm9vbGVhbn1cbiAqL1xuTWF0cml4MkQucHJvdG90eXBlLmlzSW52ZXJ0aWJsZSA9IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMuYSAqIHRoaXMuZCAtIHRoaXMuYiAqIHRoaXMuYyAhPT0gMC4wO1xufTtcblxuLyoqXG4gKiAgZ2V0U2NhbGVcbiAqXG4gKiAgQHJldHVybnMge3NjYWxlWDogTnVtYmVyLCBzY2FsZVk6IE51bWJlcn1cbiAqL1xuTWF0cml4MkQucHJvdG90eXBlLmdldFNjYWxlID0gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgICAgc2NhbGVYOiBNYXRoLnNxcnQodGhpcy5hICogdGhpcy5hICsgdGhpcy5jICogdGhpcy5jKSxcbiAgICAgICAgc2NhbGVZOiBNYXRoLnNxcnQodGhpcy5iICogdGhpcy5iICsgdGhpcy5kICogdGhpcy5kKVxuICAgIH07XG59O1xuXG4vKipcbiAqICBlcXVhbHNcbiAqXG4gKiAgQHBhcmFtIHtNYXRyaXgyRH0gdGhhdFxuICogIEByZXR1cm5zIHtCb29sZWFufVxuICovXG5NYXRyaXgyRC5wcm90b3R5cGUuZXF1YWxzID0gZnVuY3Rpb24odGhhdCkge1xuICAgIHJldHVybiAoXG4gICAgICAgIHRoaXMuYSA9PT0gdGhhdC5hICYmXG4gICAgICAgIHRoaXMuYiA9PT0gdGhhdC5iICYmXG4gICAgICAgIHRoaXMuYyA9PT0gdGhhdC5jICYmXG4gICAgICAgIHRoaXMuZCA9PT0gdGhhdC5kICYmXG4gICAgICAgIHRoaXMuZSA9PT0gdGhhdC5lICYmXG4gICAgICAgIHRoaXMuZiA9PT0gdGhhdC5mXG4gICAgKTtcbn07XG5cbi8qKlxuICogIHRvU3RyaW5nXG4gKlxuICogIEByZXR1cm5zIHtTdHJpbmd9XG4gKi9cbk1hdHJpeDJELnByb3RvdHlwZS50b1N0cmluZyA9IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiAoXG4gICAgICAgIFwibWF0cml4KFwiICtcbiAgICAgICAgdGhpcy5hICsgXCIsXCIgK1xuICAgICAgICB0aGlzLmIgKyBcIixcIiArXG4gICAgICAgIHRoaXMuYyArIFwiLFwiICtcbiAgICAgICAgdGhpcy5kICsgXCIsXCIgK1xuICAgICAgICB0aGlzLmUgKyBcIixcIiArXG4gICAgICAgIHRoaXMuZiArIFwiKVwiXG4gICAgKTtcbn1cblxuaWYgKHR5cGVvZiBtb2R1bGUgIT09IFwidW5kZWZpbmVkXCIpIHtcbiAgICBtb2R1bGUuZXhwb3J0cyA9IE1hdHJpeDJEO1xufSIsIi8qKlxuICpcbiAqICAgUG9pbnQyRC5qc1xuICpcbiAqICAgY29weXJpZ2h0IDIwMDEtMjAwMiwgMjAxMyBLZXZpbiBMaW5kc2V5XG4gKlxuICovXG5cbi8qKlxuICogIFBvaW50MkRcbiAqXG4gKiAgQHBhcmFtIHtOdW1iZXJ9IHhcbiAqICBAcGFyYW0ge051bWJlcn0geVxuICogIEByZXR1cm5zIHtQb2ludDJEfVxuICovXG5mdW5jdGlvbiBQb2ludDJEKHgsIHkpIHtcbiAgICBPYmplY3QuZGVmaW5lUHJvcGVydGllcyh0aGlzLCB7XG4gICAgICAgIFwieFwiOiB7XG4gICAgICAgICAgICB2YWx1ZTogeCxcbiAgICAgICAgICAgIHdyaXRhYmxlOiBmYWxzZSxcbiAgICAgICAgICAgIGVudW1lcmFibGU6IHRydWUsXG4gICAgICAgICAgICBjb25maWd1cmFibGU6IGZhbHNlXG4gICAgICAgIH0sXG4gICAgICAgIFwieVwiOiB7XG4gICAgICAgICAgICB2YWx1ZTogeSxcbiAgICAgICAgICAgIHdyaXRhYmxlOiBmYWxzZSxcbiAgICAgICAgICAgIGVudW1lcmFibGU6IHRydWUsXG4gICAgICAgICAgICBjb25maWd1cmFibGU6IGZhbHNlXG4gICAgICAgIH1cbiAgICB9KTtcbiAgICAvLyB0aGlzLnggPSB4O1xuICAgIC8vIHRoaXMueSA9IHk7XG59XG5cbi8qKlxuICogIGNsb25lXG4gKlxuICogIEByZXR1cm5zIHtQb2ludDJEfVxuICovXG5Qb2ludDJELnByb3RvdHlwZS5jbG9uZSA9IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiBuZXcgUG9pbnQyRCh0aGlzLngsIHRoaXMueSk7XG59O1xuXG4vKipcbiAqICBhZGRcbiAqXG4gKiAgQHBhcmFtIHtQb2ludDJEfFZlY3RvcjJEfSB0aGF0XG4gKiAgQHJldHVybnMge1BvaW50MkR9XG4gKi9cblBvaW50MkQucHJvdG90eXBlLmFkZCA9IGZ1bmN0aW9uKHRoYXQpIHtcbiAgICByZXR1cm4gbmV3IFBvaW50MkQodGhpcy54K3RoYXQueCwgdGhpcy55K3RoYXQueSk7XG59O1xuXG4vKipcbiAqICBzdWJ0cmFjdFxuICpcbiAqICBAcGFyYW0geyBWZWN0b3IyRCB8IFBvaW50MkQgfSB0aGF0XG4gKiAgQHJldHVybnMge1BvaW50MkR9XG4gKi9cblBvaW50MkQucHJvdG90eXBlLnN1YnRyYWN0ID0gZnVuY3Rpb24odGhhdCkge1xuICAgIHJldHVybiBuZXcgUG9pbnQyRCh0aGlzLngtdGhhdC54LCB0aGlzLnktdGhhdC55KTtcbn07XG5cbi8qKlxuICogIG11bHRpcGx5XG4gKlxuICogIEBwYXJhbSB7TnVtYmVyfSBzY2FsYXJcbiAqICBAcmV0dXJucyB7UG9pbnQyRH1cbiAqL1xuUG9pbnQyRC5wcm90b3R5cGUubXVsdGlwbHkgPSBmdW5jdGlvbihzY2FsYXIpIHtcbiAgICByZXR1cm4gbmV3IFBvaW50MkQodGhpcy54KnNjYWxhciwgdGhpcy55KnNjYWxhcik7XG59O1xuXG4vKipcbiAqICBkaXZpZGVcbiAqXG4gKiAgQHBhcmFtIHtOdW1iZXJ9IHNjYWxhclxuICogIEByZXR1cm5zIHtQb2ludDJEfVxuICovXG5Qb2ludDJELnByb3RvdHlwZS5kaXZpZGUgPSBmdW5jdGlvbihzY2FsYXIpIHtcbiAgICByZXR1cm4gbmV3IFBvaW50MkQodGhpcy54L3NjYWxhciwgdGhpcy55L3NjYWxhcik7XG59O1xuXG4vKipcbiAqICBlcXVhbHNcbiAqXG4gKiAgQHBhcmFtIHtQb2ludDJEfSB0aGF0XG4gKiAgQHJldHVybnMge0Jvb2xlYW59XG4gKi9cblBvaW50MkQucHJvdG90eXBlLmVxdWFscyA9IGZ1bmN0aW9uKHRoYXQpIHtcbiAgICByZXR1cm4gKCB0aGlzLnggPT0gdGhhdC54ICYmIHRoaXMueSA9PSB0aGF0LnkgKTtcbn07XG5cbi8vIHV0aWxpdHkgbWV0aG9kc1xuXG4vKipcbiAqICBsZXJwXG4gKlxuICogIEBwYXJhbSB7IFZlY3RvcjJEIHwgUG9pbnQyRCB9IHRoYXRcbiAqICBAcGFyYW0ge051bWJlcn0gdFxuIEAgIEByZXR1cm5zIHtQb2ludDJEfVxuICovXG5Qb2ludDJELnByb3RvdHlwZS5sZXJwID0gZnVuY3Rpb24odGhhdCwgdCkge1xuICAgIHZhciBvbXQgPSAxLjAgLSB0O1xuXG4gICAgcmV0dXJuIG5ldyBQb2ludDJEKFxuICAgICAgICB0aGlzLnggKiBvbXQgKyB0aGF0LnggKiB0LFxuICAgICAgICB0aGlzLnkgKiBvbXQgKyB0aGF0LnkgKiB0XG4gICAgKTtcbn07XG5cbi8qKlxuICogIGRpc3RhbmNlRnJvbVxuICpcbiAqICBAcGFyYW0ge1BvaW50MkR9IHRoYXRcbiAqICBAcmV0dXJucyB7TnVtYmVyfVxuICovXG5Qb2ludDJELnByb3RvdHlwZS5kaXN0YW5jZUZyb20gPSBmdW5jdGlvbih0aGF0KSB7XG4gICAgdmFyIGR4ID0gdGhpcy54IC0gdGhhdC54O1xuICAgIHZhciBkeSA9IHRoaXMueSAtIHRoYXQueTtcblxuICAgIHJldHVybiBNYXRoLnNxcnQoZHgqZHggKyBkeSpkeSk7XG59O1xuXG4vKipcbiAqICBtaW5cbiAqXG4gKiAgQHBhcmFtIHtQb2ludDJEfSB0aGF0XG4gKiAgQHJldHVybnMge051bWJlcn1cbiAqL1xuUG9pbnQyRC5wcm90b3R5cGUubWluID0gZnVuY3Rpb24odGhhdCkge1xuICAgIHJldHVybiBuZXcgUG9pbnQyRChcbiAgICAgICAgTWF0aC5taW4oIHRoaXMueCwgdGhhdC54ICksXG4gICAgICAgIE1hdGgubWluKCB0aGlzLnksIHRoYXQueSApXG4gICAgKTtcbn07XG5cbi8qKlxuICogIG1heFxuICpcbiAqICBAcGFyYW0ge1BvaW50MkR9IHRoYXRcbiAqICBAcmV0dXJucyB7TnVtYmVyfVxuICovXG5Qb2ludDJELnByb3RvdHlwZS5tYXggPSBmdW5jdGlvbih0aGF0KSB7XG4gICAgcmV0dXJuIG5ldyBQb2ludDJEKFxuICAgICAgICBNYXRoLm1heCggdGhpcy54LCB0aGF0LnggKSxcbiAgICAgICAgTWF0aC5tYXgoIHRoaXMueSwgdGhhdC55IClcbiAgICApO1xufTtcblxuLyoqXG4gKiAgdHJhbnNmb3JtXG4gKlxuICogIEBwYXJhbSB7TWF0cml4MkR9XG4gKiAgQHJlc3VsdCB7UG9pbnQyRH1cbiAqL1xuUG9pbnQyRC5wcm90b3R5cGUudHJhbnNmb3JtID0gZnVuY3Rpb24obWF0cml4KSB7XG4gICAgcmV0dXJuIG5ldyBQb2ludDJEKFxuICAgICAgICBtYXRyaXguYSAqIHRoaXMueCArIG1hdHJpeC5jICogdGhpcy55ICsgbWF0cml4LmUsXG4gICAgICAgIG1hdHJpeC5iICogdGhpcy54ICsgbWF0cml4LmQgKiB0aGlzLnkgKyBtYXRyaXguZlxuICAgICk7XG59O1xuXG4vKipcbiAqICB0b1N0cmluZ1xuICpcbiAqICBAcmV0dXJucyB7U3RyaW5nfVxuICovXG5Qb2ludDJELnByb3RvdHlwZS50b1N0cmluZyA9IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiBcInBvaW50KFwiICsgdGhpcy54ICsgXCIsXCIgKyB0aGlzLnkgKyBcIilcIjtcbn07XG5cbmlmICh0eXBlb2YgbW9kdWxlICE9PSBcInVuZGVmaW5lZFwiKSB7XG4gICAgbW9kdWxlLmV4cG9ydHMgPSBQb2ludDJEO1xufVxuIiwiLyoqXG4gKlxuICogICBWZWN0b3IyRC5qc1xuICpcbiAqICAgY29weXJpZ2h0IDIwMDEtMjAwMiwgMjAxMyBLZXZpbiBMaW5kc2V5XG4gKlxuICovXG5cbi8qKlxuICogIFZlY3RvcjJEXG4gKlxuICogIEBwYXJhbSB7TnVtYmVyfSB4XG4gKiAgQHBhcmFtIHtOdW1iZXJ9IHlcbiAqICBAcmV0dXJucyB7VmVjdG9yMkR9XG4gKi9cbmZ1bmN0aW9uIFZlY3RvcjJEKHgsIHkpIHtcbiAgICBPYmplY3QuZGVmaW5lUHJvcGVydGllcyh0aGlzLCB7XG4gICAgICAgIFwieFwiOiB7XG4gICAgICAgICAgICB2YWx1ZTogeCxcbiAgICAgICAgICAgIHdyaXRhYmxlOiBmYWxzZSxcbiAgICAgICAgICAgIGVudW1lcmFibGU6IHRydWUsXG4gICAgICAgICAgICBjb25maWd1cmFibGU6IGZhbHNlXG4gICAgICAgIH0sXG4gICAgICAgIFwieVwiOiB7XG4gICAgICAgICAgICB2YWx1ZTogeSxcbiAgICAgICAgICAgIHdyaXRhYmxlOiBmYWxzZSxcbiAgICAgICAgICAgIGVudW1lcmFibGU6IHRydWUsXG4gICAgICAgICAgICBjb25maWd1cmFibGU6IGZhbHNlXG4gICAgICAgIH1cbiAgICB9KTtcbiAgICAvLyB0aGlzLnggPSB4O1xuICAgIC8vIHRoaXMueSA9IHk7XG59XG5cbi8qKlxuICogIGZyb21Qb2ludHNcbiAqXG4gKiAgQHBhcmFtIHtQb2ludDJEfSBwMVxuICogIEBwYXJhbSB7UG9pbnQyRH0gcDJcbiAqICBAcmV0dXJucyB7VmVjdG9yMkR9XG4gKi9cblZlY3RvcjJELmZyb21Qb2ludHMgPSBmdW5jdGlvbihwMSwgcDIpIHtcbiAgICByZXR1cm4gbmV3IFZlY3RvcjJEKFxuICAgICAgICBwMi54IC0gcDEueCxcbiAgICAgICAgcDIueSAtIHAxLnlcbiAgICApO1xufTtcblxuLyoqXG4gKiAgbGVuZ3RoXG4gKlxuICogIEByZXR1cm5zIHtOdW1iZXJ9XG4gKi9cblZlY3RvcjJELnByb3RvdHlwZS5sZW5ndGggPSBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gTWF0aC5zcXJ0KHRoaXMueCp0aGlzLnggKyB0aGlzLnkqdGhpcy55KTtcbn07XG5cbi8qKlxuICogIG1hZ25pdHVkZVxuICpcbiAqICBAcmV0dXJucyB7TnVtYmVyfVxuICovXG5WZWN0b3IyRC5wcm90b3R5cGUubWFnbml0dWRlID0gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIHRoaXMueCp0aGlzLnggKyB0aGlzLnkqdGhpcy55O1xufTtcblxuLyoqXG4gKiAgZG90XG4gKlxuICogIEBwYXJhbSB7VmVjdG9yMkR9IHRoYXRcbiAqICBAcmV0dXJucyB7TnVtYmVyfVxuICovXG5WZWN0b3IyRC5wcm90b3R5cGUuZG90ID0gZnVuY3Rpb24odGhhdCkge1xuICAgIHJldHVybiB0aGlzLngqdGhhdC54ICsgdGhpcy55KnRoYXQueTtcbn07XG5cbi8qKlxuICogIGNyb3NzXG4gKlxuICogIEBwYXJhbSB7VmVjdG9yMkR9IHRoYXRcbiAqICBAcmV0dXJucyB7TnVtYmVyfVxuICovXG5WZWN0b3IyRC5wcm90b3R5cGUuY3Jvc3MgPSBmdW5jdGlvbih0aGF0KSB7XG4gICAgcmV0dXJuIHRoaXMueCp0aGF0LnkgLSB0aGlzLnkqdGhhdC54O1xufVxuXG4vKipcbiAqICBkZXRlcm1pbmFudFxuICpcbiAqICBAcGFyYW0ge1ZlY3RvcjJEfSB0aGF0XG4gKiAgQHJldHVybnMge051bWJlcn1cbiAqL1xuVmVjdG9yMkQucHJvdG90eXBlLmRldGVybWluYW50ID0gZnVuY3Rpb24odGhhdCkge1xuICAgIHJldHVybiB0aGlzLngqdGhhdC55IC0gdGhpcy55KnRoYXQueDtcbn07XG5cbi8qKlxuICogIHVuaXRcbiAqXG4gKiAgQHJldHVybnMge1ZlY3RvcjJEfVxuICovXG5WZWN0b3IyRC5wcm90b3R5cGUudW5pdCA9IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiB0aGlzLmRpdmlkZSggdGhpcy5sZW5ndGgoKSApO1xufTtcblxuLyoqXG4gKiAgYWRkXG4gKlxuICogIEBwYXJhbSB7VmVjdG9yMkR9IHRoYXRcbiAqICBAcmV0dXJucyB7VmVjdG9yMkR9XG4gKi9cblZlY3RvcjJELnByb3RvdHlwZS5hZGQgPSBmdW5jdGlvbih0aGF0KSB7XG4gICAgcmV0dXJuIG5ldyBWZWN0b3IyRCh0aGlzLnggKyB0aGF0LngsIHRoaXMueSArIHRoYXQueSk7XG59O1xuXG4vKipcbiAqICBzdWJ0cmFjdFxuICpcbiAqICBAcGFyYW0ge1ZlY3RvcjJEfSB0aGF0XG4gKiAgQHJldHVybnMge1ZlY3RvcjJEfVxuICovXG5WZWN0b3IyRC5wcm90b3R5cGUuc3VidHJhY3QgPSBmdW5jdGlvbih0aGF0KSB7XG4gICAgcmV0dXJuIG5ldyBWZWN0b3IyRCh0aGlzLnggLSB0aGF0LngsIHRoaXMueSAtIHRoYXQueSk7XG59O1xuXG4vKipcbiAqICBtdWx0aXBseVxuICpcbiAqICBAcGFyYW0ge051bWJlcn0gc2NhbGFyXG4gKiAgQHJldHVybnMge1ZlY3RvcjJEfVxuICovXG5WZWN0b3IyRC5wcm90b3R5cGUubXVsdGlwbHkgPSBmdW5jdGlvbihzY2FsYXIpIHtcbiAgICByZXR1cm4gbmV3IFZlY3RvcjJEKHRoaXMueCAqIHNjYWxhciwgdGhpcy55ICogc2NhbGFyKTtcbn07XG5cbi8qKlxuICogIGRpdmlkZVxuICpcbiAqICBAcGFyYW0ge051bWJlcn0gc2NhbGFyXG4gKiAgQHJldHVybnMge1ZlY3RvcjJEfVxuICovXG5WZWN0b3IyRC5wcm90b3R5cGUuZGl2aWRlID0gZnVuY3Rpb24oc2NhbGFyKSB7XG4gICAgcmV0dXJuIG5ldyBWZWN0b3IyRCh0aGlzLnggLyBzY2FsYXIsIHRoaXMueSAvIHNjYWxhcik7XG59O1xuXG4vKipcbiAqICBhbmdsZUJldHdlZW5cbiAqXG4gKiAgQHBhcmFtIHtWZWN0b3IyRH0gdGhhdFxuICogIEByZXR1cm5zIHtOdW1iZXJ9XG4gKi9cblZlY3RvcjJELnByb3RvdHlwZS5hbmdsZUJldHdlZW4gPSBmdW5jdGlvbih0aGF0KSB7XG4gICAgdmFyIGNvcyA9IHRoaXMuZG90KHRoYXQpIC8gKHRoaXMubGVuZ3RoKCkgKiB0aGF0Lmxlbmd0aCgpKTtcbiAgICBpZiAoY29zIDwgLTEpIHtcbiAgICAgICAgY29zID0gLTE7XG4gICAgfVxuICAgIGVsc2UgaWYgKGNvcyA+IDEpIHtcbiAgICAgICAgY29zID0gMTtcbiAgICB9XG4gICAgdmFyIHJhZGlhbnMgPSBNYXRoLmFjb3MoY29zKTtcblxuICAgIHJldHVybiAodGhpcy5jcm9zcyh0aGF0KSA8IDAuMCkgPyAtcmFkaWFucyA6IHJhZGlhbnM7XG59O1xuXG4vKipcbiAqICBGaW5kIGEgdmVjdG9yIGlzIHRoYXQgaXMgcGVycGVuZGljdWxhciB0byB0aGlzIHZlY3RvclxuICpcbiAqICBAcmV0dXJucyB7VmVjdG9yMkR9XG4gKi9cblZlY3RvcjJELnByb3RvdHlwZS5wZXJwID0gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIG5ldyBWZWN0b3IyRCgtdGhpcy55LCB0aGlzLngpO1xufTtcblxuLyoqXG4gKiAgRmluZCB0aGUgY29tcG9uZW50IG9mIHRoZSBzcGVjaWZpZWQgdmVjdG9yIHRoYXQgaXMgcGVycGVuZGljdWxhciB0b1xuICogIHRoaXMgdmVjdG9yXG4gKlxuICogIEBwYXJhbSB7VmVjdG9yMkR9IHRoYXRcbiAqICBAcmV0dXJucyB7VmVjdG9yMkR9XG4gKi9cblZlY3RvcjJELnByb3RvdHlwZS5wZXJwZW5kaWN1bGFyID0gZnVuY3Rpb24odGhhdCkge1xuICAgIHJldHVybiB0aGlzLnN1YnRyYWN0KHRoaXMucHJvamVjdCh0aGF0KSk7XG59O1xuXG4vKipcbiAqICBwcm9qZWN0XG4gKlxuICogIEBwYXJhbSB7VmVjdG9yMkR9IHRoYXRcbiAqICBAcmV0dXJucyB7VmVjdG9yMkR9XG4gKi9cblZlY3RvcjJELnByb3RvdHlwZS5wcm9qZWN0ID0gZnVuY3Rpb24odGhhdCkge1xuICAgIHZhciBwZXJjZW50ID0gdGhpcy5kb3QodGhhdCkgLyB0aGF0LmRvdCh0aGF0KTtcblxuICAgIHJldHVybiB0aGF0Lm11bHRpcGx5KHBlcmNlbnQpO1xufTtcblxuLyoqXG4gKiAgdHJhbnNmb3JtXG4gKlxuICogIEBwYXJhbSB7TWF0cml4MkR9XG4gKiAgQHJldHVybnMge1ZlY3RvcjJEfVxuICovXG5WZWN0b3IyRC5wcm90b3R5cGUudHJhbnNmb3JtID0gZnVuY3Rpb24obWF0cml4KSB7XG4gICAgcmV0dXJuIG5ldyBWZWN0b3IyRChcbiAgICAgICAgbWF0cml4LmEgKiB0aGlzLnggKyBtYXRyaXguYyAqIHRoaXMueSxcbiAgICAgICAgbWF0cml4LmIgKiB0aGlzLnggKyBtYXRyaXguZCAqIHRoaXMueVxuICAgICk7XG59O1xuXG4vKipcbiAqICBlcXVhbHNcbiAqXG4gKiAgQHBhcmFtIHtWZWN0b3IyRH0gdGhhdFxuICogIEByZXR1cm5zIHtCb29sZWFufVxuICovXG5WZWN0b3IyRC5wcm90b3R5cGUuZXF1YWxzID0gZnVuY3Rpb24odGhhdCkge1xuICAgIHJldHVybiAoXG4gICAgICAgIHRoaXMueCA9PT0gdGhhdC54ICYmXG4gICAgICAgIHRoaXMueSA9PT0gdGhhdC55XG4gICAgKTtcbn07XG5cbi8qKlxuICogIHRvU3RyaW5nXG4gKlxuICogIEByZXR1cm5zIHtTdHJpbmd9XG4gKi9cblZlY3RvcjJELnByb3RvdHlwZS50b1N0cmluZyA9IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiBcInZlY3RvcihcIiArIHRoaXMueCArIFwiLFwiICsgdGhpcy55ICsgXCIpXCI7XG59O1xuXG5pZiAodHlwZW9mIG1vZHVsZSAhPT0gXCJ1bmRlZmluZWRcIikge1xuICAgIG1vZHVsZS5leHBvcnRzID0gVmVjdG9yMkQ7XG59XG4iLCIvLyBleHBvc2UgY2xhc3Nlc1xuXG5leHBvcnRzLlBvbHlub21pYWwgPSByZXF1aXJlKCcuL2xpYi9Qb2x5bm9taWFsJyk7XG5leHBvcnRzLlNxcnRQb2x5bm9taWFsID0gcmVxdWlyZSgnLi9saWIvU3FydFBvbHlub21pYWwnKTtcbiIsIi8qKlxuICpcbiAqICAgUG9seW5vbWlhbC5qc1xuICpcbiAqICAgY29weXJpZ2h0IDIwMDIsIDIxMDMgS2V2aW4gTGluZHNleVxuICpcbiAqL1xuXG5Qb2x5bm9taWFsLlRPTEVSQU5DRSA9IDFlLTY7XG5Qb2x5bm9taWFsLkFDQ1VSQUNZICA9IDE1O1xuXG5cbi8qKlxuICogIGludGVycG9sYXRlXG4gKlxuICogIEBwYXJhbSB7QXJyYXk8TnVtYmVyPn0geHNcbiAqICBAcGFyYW0ge0FycmF5PE51bWJlcj59IHlzXG4gKiAgQHBhcmFtIHtOdW1iZXJ9IG5cbiAqICBAcGFyYW0ge051bWJlcn0gb2Zmc2V0XG4gKiAgQHBhcmFtIHtOdW1iZXJ9IHhcbiAqXG4gKiAgQHJldHVybnMge3k6TnVtYmVyLCBkeTpOdW1iZXJ9XG4gKi9cblBvbHlub21pYWwuaW50ZXJwb2xhdGUgPSBmdW5jdGlvbih4cywgeXMsIG4sIG9mZnNldCwgeCkge1xuICAgIGlmICggeHMuY29uc3RydWN0b3IgIT09IEFycmF5IHx8IHlzLmNvbnN0cnVjdG9yICE9PSBBcnJheSApXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcIlBvbHlub21pYWwuaW50ZXJwb2xhdGU6IHhzIGFuZCB5cyBtdXN0IGJlIGFycmF5c1wiKTtcbiAgICBpZiAoIGlzTmFOKG4pIHx8IGlzTmFOKG9mZnNldCkgfHwgaXNOYU4oeCkgKVxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJQb2x5bm9taWFsLmludGVycG9sYXRlOiBuLCBvZmZzZXQsIGFuZCB4IG11c3QgYmUgbnVtYmVyc1wiKTtcblxuICAgIHZhciB5ICA9IDA7XG4gICAgdmFyIGR5ID0gMDtcbiAgICB2YXIgYyA9IG5ldyBBcnJheShuKTtcbiAgICB2YXIgZCA9IG5ldyBBcnJheShuKTtcbiAgICB2YXIgbnMgPSAwO1xuICAgIHZhciByZXN1bHQ7XG5cbiAgICB2YXIgZGlmZiA9IE1hdGguYWJzKHggLSB4c1tvZmZzZXRdKTtcbiAgICBmb3IgKCB2YXIgaSA9IDA7IGkgPCBuOyBpKysgKSB7XG4gICAgICAgIHZhciBkaWZ0ID0gTWF0aC5hYnMoeCAtIHhzW29mZnNldCtpXSk7XG5cbiAgICAgICAgaWYgKCBkaWZ0IDwgZGlmZiApIHtcbiAgICAgICAgICAgIG5zID0gaTtcbiAgICAgICAgICAgIGRpZmYgPSBkaWZ0O1xuICAgICAgICB9XG4gICAgICAgIGNbaV0gPSBkW2ldID0geXNbb2Zmc2V0K2ldO1xuICAgIH1cbiAgICB5ID0geXNbb2Zmc2V0K25zXTtcbiAgICBucy0tO1xuXG4gICAgZm9yICggdmFyIG0gPSAxOyBtIDwgbjsgbSsrICkge1xuICAgICAgICBmb3IgKCB2YXIgaSA9IDA7IGkgPCBuLW07IGkrKyApIHtcbiAgICAgICAgICAgIHZhciBobyA9IHhzW29mZnNldCtpXSAtIHg7XG4gICAgICAgICAgICB2YXIgaHAgPSB4c1tvZmZzZXQraSttXSAtIHg7XG4gICAgICAgICAgICB2YXIgdyA9IGNbaSsxXS1kW2ldO1xuICAgICAgICAgICAgdmFyIGRlbiA9IGhvIC0gaHA7XG5cbiAgICAgICAgICAgIGlmICggZGVuID09IDAuMCApIHtcbiAgICAgICAgICAgICAgICByZXN1bHQgPSB7IHk6IDAsIGR5OiAwfTtcbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgZGVuID0gdyAvIGRlbjtcbiAgICAgICAgICAgIGRbaV0gPSBocCpkZW47XG4gICAgICAgICAgICBjW2ldID0gaG8qZGVuO1xuICAgICAgICB9XG4gICAgICAgIGR5ID0gKDIqKG5zKzEpIDwgKG4tbSkpID8gY1tucysxXSA6IGRbbnMtLV07XG4gICAgICAgIHkgKz0gZHk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHsgeTogeSwgZHk6IGR5IH07XG59O1xuXG5cbi8qKlxuICogIFBvbHlub21pYWxcbiAqXG4gKiAgQHJldHVybnMge1BvbHlub21pYWx9XG4gKi9cbmZ1bmN0aW9uIFBvbHlub21pYWwoKSB7XG4gICAgdGhpcy5pbml0KCBhcmd1bWVudHMgKTtcbn1cblxuXG4vKipcbiAqICBpbml0XG4gKi9cblBvbHlub21pYWwucHJvdG90eXBlLmluaXQgPSBmdW5jdGlvbihjb2Vmcykge1xuICAgIHRoaXMuY29lZnMgPSBuZXcgQXJyYXkoKTtcblxuICAgIGZvciAoIHZhciBpID0gY29lZnMubGVuZ3RoIC0gMTsgaSA+PSAwOyBpLS0gKVxuICAgICAgICB0aGlzLmNvZWZzLnB1c2goIGNvZWZzW2ldICk7XG5cbiAgICB0aGlzLl92YXJpYWJsZSA9IFwidFwiO1xuICAgIHRoaXMuX3MgPSAwO1xufTtcblxuXG4vKipcbiAqICBldmFsXG4gKi9cblBvbHlub21pYWwucHJvdG90eXBlLmV2YWwgPSBmdW5jdGlvbih4KSB7XG4gICAgaWYgKCBpc05hTih4KSApXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcIlBvbHlub21pYWwuZXZhbDogcGFyYW1ldGVyIG11c3QgYmUgYSBudW1iZXJcIik7XG5cbiAgICB2YXIgcmVzdWx0ID0gMDtcblxuICAgIGZvciAoIHZhciBpID0gdGhpcy5jb2Vmcy5sZW5ndGggLSAxOyBpID49IDA7IGktLSApXG4gICAgICAgIHJlc3VsdCA9IHJlc3VsdCAqIHggKyB0aGlzLmNvZWZzW2ldO1xuXG4gICAgcmV0dXJuIHJlc3VsdDtcbn07XG5cblxuLyoqXG4gKiAgYWRkXG4gKi9cblBvbHlub21pYWwucHJvdG90eXBlLmFkZCA9IGZ1bmN0aW9uKHRoYXQpIHtcbiAgICB2YXIgcmVzdWx0ID0gbmV3IFBvbHlub21pYWwoKTtcbiAgICB2YXIgZDEgPSB0aGlzLmdldERlZ3JlZSgpO1xuICAgIHZhciBkMiA9IHRoYXQuZ2V0RGVncmVlKCk7XG4gICAgdmFyIGRtYXggPSBNYXRoLm1heChkMSxkMik7XG5cbiAgICBmb3IgKCB2YXIgaSA9IDA7IGkgPD0gZG1heDsgaSsrICkge1xuICAgICAgICB2YXIgdjEgPSAoaSA8PSBkMSkgPyB0aGlzLmNvZWZzW2ldIDogMDtcbiAgICAgICAgdmFyIHYyID0gKGkgPD0gZDIpID8gdGhhdC5jb2Vmc1tpXSA6IDA7XG5cbiAgICAgICAgcmVzdWx0LmNvZWZzW2ldID0gdjEgKyB2MjtcbiAgICB9XG5cbiAgICByZXR1cm4gcmVzdWx0O1xufTtcblxuXG4vKipcbiAqICBtdWx0aXBseVxuICovXG5Qb2x5bm9taWFsLnByb3RvdHlwZS5tdWx0aXBseSA9IGZ1bmN0aW9uKHRoYXQpIHtcbiAgICB2YXIgcmVzdWx0ID0gbmV3IFBvbHlub21pYWwoKTtcblxuICAgIGZvciAoIHZhciBpID0gMDsgaSA8PSB0aGlzLmdldERlZ3JlZSgpICsgdGhhdC5nZXREZWdyZWUoKTsgaSsrIClcbiAgICAgICAgcmVzdWx0LmNvZWZzLnB1c2goMCk7XG5cbiAgICBmb3IgKCB2YXIgaSA9IDA7IGkgPD0gdGhpcy5nZXREZWdyZWUoKTsgaSsrIClcbiAgICAgICAgZm9yICggdmFyIGogPSAwOyBqIDw9IHRoYXQuZ2V0RGVncmVlKCk7IGorKyApXG4gICAgICAgICAgICByZXN1bHQuY29lZnNbaStqXSArPSB0aGlzLmNvZWZzW2ldICogdGhhdC5jb2Vmc1tqXTtcblxuICAgIHJldHVybiByZXN1bHQ7XG59O1xuXG5cbi8qKlxuICogIGRpdmlkZV9zY2FsYXJcbiAqL1xuUG9seW5vbWlhbC5wcm90b3R5cGUuZGl2aWRlX3NjYWxhciA9IGZ1bmN0aW9uKHNjYWxhcikge1xuICAgIGZvciAoIHZhciBpID0gMDsgaSA8IHRoaXMuY29lZnMubGVuZ3RoOyBpKysgKVxuICAgICAgICB0aGlzLmNvZWZzW2ldIC89IHNjYWxhcjtcbn07XG5cblxuLyoqXG4gKiAgc2ltcGxpZnlcbiAqL1xuUG9seW5vbWlhbC5wcm90b3R5cGUuc2ltcGxpZnkgPSBmdW5jdGlvbigpIHtcbiAgICBmb3IgKCB2YXIgaSA9IHRoaXMuZ2V0RGVncmVlKCk7IGkgPj0gMDsgaS0tICkge1xuICAgICAgICBpZiAoIE1hdGguYWJzKCB0aGlzLmNvZWZzW2ldICkgPD0gUG9seW5vbWlhbC5UT0xFUkFOQ0UgKVxuICAgICAgICAgICAgdGhpcy5jb2Vmcy5wb3AoKTtcbiAgICAgICAgZWxzZVxuICAgICAgICAgICAgYnJlYWs7XG4gICAgfVxufTtcblxuXG4vKipcbiAqICBiaXNlY3Rpb25cbiAqL1xuUG9seW5vbWlhbC5wcm90b3R5cGUuYmlzZWN0aW9uID0gZnVuY3Rpb24obWluLCBtYXgpIHtcbiAgICB2YXIgbWluVmFsdWUgPSB0aGlzLmV2YWwobWluKTtcbiAgICB2YXIgbWF4VmFsdWUgPSB0aGlzLmV2YWwobWF4KTtcbiAgICB2YXIgcmVzdWx0O1xuXG4gICAgaWYgKCBNYXRoLmFicyhtaW5WYWx1ZSkgPD0gUG9seW5vbWlhbC5UT0xFUkFOQ0UgKVxuICAgICAgICByZXN1bHQgPSBtaW47XG4gICAgZWxzZSBpZiAoIE1hdGguYWJzKG1heFZhbHVlKSA8PSBQb2x5bm9taWFsLlRPTEVSQU5DRSApXG4gICAgICAgIHJlc3VsdCA9IG1heDtcbiAgICBlbHNlIGlmICggbWluVmFsdWUgKiBtYXhWYWx1ZSA8PSAwICkge1xuICAgICAgICB2YXIgdG1wMSAgPSBNYXRoLmxvZyhtYXggLSBtaW4pO1xuICAgICAgICB2YXIgdG1wMiAgPSBNYXRoLkxOMTAgKiBQb2x5bm9taWFsLkFDQ1VSQUNZO1xuICAgICAgICB2YXIgaXRlcnMgPSBNYXRoLmNlaWwoICh0bXAxK3RtcDIpIC8gTWF0aC5MTjIgKTtcblxuICAgICAgICBmb3IgKCB2YXIgaSA9IDA7IGkgPCBpdGVyczsgaSsrICkge1xuICAgICAgICAgICAgcmVzdWx0ID0gMC41ICogKG1pbiArIG1heCk7XG4gICAgICAgICAgICB2YXIgdmFsdWUgPSB0aGlzLmV2YWwocmVzdWx0KTtcblxuICAgICAgICAgICAgaWYgKCBNYXRoLmFicyh2YWx1ZSkgPD0gUG9seW5vbWlhbC5UT0xFUkFOQ0UgKSB7XG4gICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmICggdmFsdWUgKiBtaW5WYWx1ZSA8IDAgKSB7XG4gICAgICAgICAgICAgICAgbWF4ID0gcmVzdWx0O1xuICAgICAgICAgICAgICAgIG1heFZhbHVlID0gdmFsdWU7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIG1pbiA9IHJlc3VsdDtcbiAgICAgICAgICAgICAgICBtaW5WYWx1ZSA9IHZhbHVlO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHJlc3VsdDtcbn07XG5cblxuLyoqXG4gKiAgdG9TdHJpbmdcbiAqL1xuUG9seW5vbWlhbC5wcm90b3R5cGUudG9TdHJpbmcgPSBmdW5jdGlvbigpIHtcbiAgICB2YXIgY29lZnMgPSBuZXcgQXJyYXkoKTtcbiAgICB2YXIgc2lnbnMgPSBuZXcgQXJyYXkoKTtcblxuICAgIGZvciAoIHZhciBpID0gdGhpcy5jb2Vmcy5sZW5ndGggLSAxOyBpID49IDA7IGktLSApIHtcbiAgICAgICAgdmFyIHZhbHVlID0gTWF0aC5yb3VuZCh0aGlzLmNvZWZzW2ldKjEwMDApLzEwMDA7XG4gICAgICAgIC8vdmFyIHZhbHVlID0gdGhpcy5jb2Vmc1tpXTtcblxuICAgICAgICBpZiAoIHZhbHVlICE9IDAgKSB7XG4gICAgICAgICAgICB2YXIgc2lnbiA9ICggdmFsdWUgPCAwICkgPyBcIiAtIFwiIDogXCIgKyBcIjtcblxuICAgICAgICAgICAgdmFsdWUgPSBNYXRoLmFicyh2YWx1ZSk7XG4gICAgICAgICAgICBpZiAoIGkgPiAwIClcbiAgICAgICAgICAgICAgICBpZiAoIHZhbHVlID09IDEgKVxuICAgICAgICAgICAgICAgICAgICB2YWx1ZSA9IHRoaXMuX3ZhcmlhYmxlO1xuICAgICAgICAgICAgICAgIGVsc2VcbiAgICAgICAgICAgICAgICAgICAgdmFsdWUgKz0gdGhpcy5fdmFyaWFibGU7XG4gICAgICAgICAgICBpZiAoIGkgPiAxICkgdmFsdWUgKz0gXCJeXCIgKyBpO1xuXG4gICAgICAgICAgICBzaWducy5wdXNoKCBzaWduICk7XG4gICAgICAgICAgICBjb2Vmcy5wdXNoKCB2YWx1ZSApO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgc2lnbnNbMF0gPSAoIHNpZ25zWzBdID09IFwiICsgXCIgKSA/IFwiXCIgOiBcIi1cIjtcblxuICAgIHZhciByZXN1bHQgPSBcIlwiO1xuICAgIGZvciAoIHZhciBpID0gMDsgaSA8IGNvZWZzLmxlbmd0aDsgaSsrIClcbiAgICAgICAgcmVzdWx0ICs9IHNpZ25zW2ldICsgY29lZnNbaV07XG5cbiAgICByZXR1cm4gcmVzdWx0O1xufTtcblxuXG4vKipcbiAqICB0cmFwZXpvaWRcbiAqICBCYXNlZCBvbiB0cmFwemQgaW4gXCJOdW1lcmljYWwgUmVjaXBlcyBpbiBDXCIsIHBhZ2UgMTM3XG4gKi9cblBvbHlub21pYWwucHJvdG90eXBlLnRyYXBlem9pZCA9IGZ1bmN0aW9uKG1pbiwgbWF4LCBuKSB7XG4gICAgaWYgKCBpc05hTihtaW4pIHx8IGlzTmFOKG1heCkgfHwgaXNOYU4obikgKVxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJQb2x5bm9taWFsLnRyYXBlem9pZDogcGFyYW1ldGVycyBtdXN0IGJlIG51bWJlcnNcIik7XG5cbiAgICB2YXIgcmFuZ2UgPSBtYXggLSBtaW47XG4gICAgdmFyIFRPTEVSQU5DRSA9IDFlLTc7XG5cbiAgICBpZiAoIG4gPT0gMSApIHtcbiAgICAgICAgdmFyIG1pblZhbHVlID0gdGhpcy5ldmFsKG1pbik7XG4gICAgICAgIHZhciBtYXhWYWx1ZSA9IHRoaXMuZXZhbChtYXgpO1xuICAgICAgICB0aGlzLl9zID0gMC41KnJhbmdlKiggbWluVmFsdWUgKyBtYXhWYWx1ZSApO1xuICAgIH0gZWxzZSB7XG4gICAgICAgIHZhciBpdCA9IDEgPDwgKG4tMik7XG4gICAgICAgIHZhciBkZWx0YSA9IHJhbmdlIC8gaXQ7XG4gICAgICAgIHZhciB4ID0gbWluICsgMC41KmRlbHRhO1xuICAgICAgICB2YXIgc3VtID0gMDtcblxuICAgICAgICBmb3IgKCB2YXIgaSA9IDA7IGkgPCBpdDsgaSsrICkge1xuICAgICAgICAgICAgc3VtICs9IHRoaXMuZXZhbCh4KTtcbiAgICAgICAgICAgIHggKz0gZGVsdGE7XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5fcyA9IDAuNSoodGhpcy5fcyArIHJhbmdlKnN1bS9pdCk7XG4gICAgfVxuXG4gICAgaWYgKCBpc05hTih0aGlzLl9zKSApXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcIlBvbHlub21pYWwudHJhcGV6b2lkOiB0aGlzLl9zIGlzIE5hTlwiKTtcblxuICAgIHJldHVybiB0aGlzLl9zO1xufTtcblxuXG4vKipcbiAqICBzaW1wc29uXG4gKiAgQmFzZWQgb24gdHJhcHpkIGluIFwiTnVtZXJpY2FsIFJlY2lwZXMgaW4gQ1wiLCBwYWdlIDEzOVxuICovXG5Qb2x5bm9taWFsLnByb3RvdHlwZS5zaW1wc29uID0gZnVuY3Rpb24obWluLCBtYXgpIHtcbiAgICBpZiAoIGlzTmFOKG1pbikgfHwgaXNOYU4obWF4KSApXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcIlBvbHlub21pYWwuc2ltcHNvbjogcGFyYW1ldGVycyBtdXN0IGJlIG51bWJlcnNcIik7XG5cbiAgICB2YXIgcmFuZ2UgPSBtYXggLSBtaW47XG4gICAgdmFyIHN0ID0gMC41ICogcmFuZ2UgKiAoIHRoaXMuZXZhbChtaW4pICsgdGhpcy5ldmFsKG1heCkgKTtcbiAgICB2YXIgdCA9IHN0O1xuICAgIHZhciBzID0gNC4wKnN0LzMuMDtcbiAgICB2YXIgb3MgPSBzO1xuICAgIHZhciBvc3QgPSBzdDtcbiAgICB2YXIgVE9MRVJBTkNFID0gMWUtNztcblxuICAgIHZhciBpdCA9IDE7XG4gICAgZm9yICggdmFyIG4gPSAyOyBuIDw9IDIwOyBuKysgKSB7XG4gICAgICAgIHZhciBkZWx0YSA9IHJhbmdlIC8gaXQ7XG4gICAgICAgIHZhciB4ICAgICA9IG1pbiArIDAuNSpkZWx0YTtcbiAgICAgICAgdmFyIHN1bSAgID0gMDtcblxuICAgICAgICBmb3IgKCB2YXIgaSA9IDE7IGkgPD0gaXQ7IGkrKyApIHtcbiAgICAgICAgICAgIHN1bSArPSB0aGlzLmV2YWwoeCk7XG4gICAgICAgICAgICB4ICs9IGRlbHRhO1xuICAgICAgICB9XG5cbiAgICAgICAgdCA9IDAuNSAqICh0ICsgcmFuZ2UgKiBzdW0gLyBpdCk7XG4gICAgICAgIHN0ID0gdDtcbiAgICAgICAgcyA9ICg0LjAqc3QgLSBvc3QpLzMuMDtcblxuICAgICAgICBpZiAoIE1hdGguYWJzKHMtb3MpIDwgVE9MRVJBTkNFKk1hdGguYWJzKG9zKSApXG4gICAgICAgICAgICBicmVhaztcblxuICAgICAgICBvcyA9IHM7XG4gICAgICAgIG9zdCA9IHN0O1xuICAgICAgICBpdCA8PD0gMTtcbiAgICB9XG5cbiAgICByZXR1cm4gcztcbn07XG5cblxuLyoqXG4gKiAgcm9tYmVyZ1xuICovXG5Qb2x5bm9taWFsLnByb3RvdHlwZS5yb21iZXJnID0gZnVuY3Rpb24obWluLCBtYXgpIHtcbiAgICBpZiAoIGlzTmFOKG1pbikgfHwgaXNOYU4obWF4KSApXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcIlBvbHlub21pYWwucm9tYmVyZzogcGFyYW1ldGVycyBtdXN0IGJlIG51bWJlcnNcIik7XG5cbiAgICB2YXIgTUFYID0gMjA7XG4gICAgdmFyIEsgPSAzO1xuICAgIHZhciBUT0xFUkFOQ0UgPSAxZS02O1xuICAgIHZhciBzID0gbmV3IEFycmF5KE1BWCsxKTtcbiAgICB2YXIgaCA9IG5ldyBBcnJheShNQVgrMSk7XG4gICAgdmFyIHJlc3VsdCA9IHsgeTogMCwgZHk6IDAgfTtcblxuICAgIGhbMF0gPSAxLjA7XG4gICAgZm9yICggdmFyIGogPSAxOyBqIDw9IE1BWDsgaisrICkge1xuICAgICAgICBzW2otMV0gPSB0aGlzLnRyYXBlem9pZChtaW4sIG1heCwgaik7XG4gICAgICAgIGlmICggaiA+PSBLICkge1xuICAgICAgICAgICAgcmVzdWx0ID0gUG9seW5vbWlhbC5pbnRlcnBvbGF0ZShoLCBzLCBLLCBqLUssIDAuMCk7XG4gICAgICAgICAgICBpZiAoIE1hdGguYWJzKHJlc3VsdC5keSkgPD0gVE9MRVJBTkNFKnJlc3VsdC55KSBicmVhaztcbiAgICAgICAgfVxuICAgICAgICBzW2pdID0gc1tqLTFdO1xuICAgICAgICBoW2pdID0gMC4yNSAqIGhbai0xXTtcbiAgICB9XG5cbiAgICByZXR1cm4gcmVzdWx0Lnk7XG59O1xuXG4vLyBnZXR0ZXJzIGFuZCBzZXR0ZXJzXG5cbi8qKlxuICogIGdldCBkZWdyZWVcbiAqL1xuUG9seW5vbWlhbC5wcm90b3R5cGUuZ2V0RGVncmVlID0gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIHRoaXMuY29lZnMubGVuZ3RoIC0gMTtcbn07XG5cblxuLyoqXG4gKiAgZ2V0RGVyaXZhdGl2ZVxuICovXG5Qb2x5bm9taWFsLnByb3RvdHlwZS5nZXREZXJpdmF0aXZlID0gZnVuY3Rpb24oKSB7XG4gICAgdmFyIGRlcml2YXRpdmUgPSBuZXcgUG9seW5vbWlhbCgpO1xuXG4gICAgZm9yICggdmFyIGkgPSAxOyBpIDwgdGhpcy5jb2Vmcy5sZW5ndGg7IGkrKyApIHtcbiAgICAgICAgZGVyaXZhdGl2ZS5jb2Vmcy5wdXNoKGkqdGhpcy5jb2Vmc1tpXSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGRlcml2YXRpdmU7XG59O1xuXG5cbi8qKlxuICogIGdldFJvb3RzXG4gKi9cblBvbHlub21pYWwucHJvdG90eXBlLmdldFJvb3RzID0gZnVuY3Rpb24oKSB7XG4gICAgdmFyIHJlc3VsdDtcblxuICAgIHRoaXMuc2ltcGxpZnkoKTtcbiAgICBzd2l0Y2ggKCB0aGlzLmdldERlZ3JlZSgpICkge1xuICAgICAgICBjYXNlIDA6IHJlc3VsdCA9IG5ldyBBcnJheSgpOyAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgIGNhc2UgMTogcmVzdWx0ID0gdGhpcy5nZXRMaW5lYXJSb290KCk7ICAgICBicmVhaztcbiAgICAgICAgY2FzZSAyOiByZXN1bHQgPSB0aGlzLmdldFF1YWRyYXRpY1Jvb3RzKCk7IGJyZWFrO1xuICAgICAgICBjYXNlIDM6IHJlc3VsdCA9IHRoaXMuZ2V0Q3ViaWNSb290cygpOyAgICAgYnJlYWs7XG4gICAgICAgIGNhc2UgNDogcmVzdWx0ID0gdGhpcy5nZXRRdWFydGljUm9vdHMoKTsgICBicmVhaztcbiAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAgIHJlc3VsdCA9IG5ldyBBcnJheSgpO1xuICAgICAgICAgICAgLy8gc2hvdWxkIHRyeSBOZXd0b24ncyBtZXRob2QgYW5kL29yIGJpc2VjdGlvblxuICAgIH1cblxuICAgIHJldHVybiByZXN1bHQ7XG59O1xuXG5cbi8qKlxuICogIGdldFJvb3RzSW5JbnRlcnZhbFxuICovXG5Qb2x5bm9taWFsLnByb3RvdHlwZS5nZXRSb290c0luSW50ZXJ2YWwgPSBmdW5jdGlvbihtaW4sIG1heCkge1xuICAgIHZhciByb290cyA9IG5ldyBBcnJheSgpO1xuICAgIHZhciByb290O1xuXG4gICAgaWYgKCB0aGlzLmdldERlZ3JlZSgpID09IDEgKSB7XG4gICAgICAgIHJvb3QgPSB0aGlzLmJpc2VjdGlvbihtaW4sIG1heCk7XG4gICAgICAgIGlmICggcm9vdCAhPSBudWxsICkgcm9vdHMucHVzaChyb290KTtcbiAgICB9IGVsc2Uge1xuICAgICAgICAvLyBnZXQgcm9vdHMgb2YgZGVyaXZhdGl2ZVxuICAgICAgICB2YXIgZGVyaXYgID0gdGhpcy5nZXREZXJpdmF0aXZlKCk7XG4gICAgICAgIHZhciBkcm9vdHMgPSBkZXJpdi5nZXRSb290c0luSW50ZXJ2YWwobWluLCBtYXgpO1xuXG4gICAgICAgIGlmICggZHJvb3RzLmxlbmd0aCA+IDAgKSB7XG4gICAgICAgICAgICAvLyBmaW5kIHJvb3Qgb24gW21pbiwgZHJvb3RzWzBdXVxuICAgICAgICAgICAgcm9vdCA9IHRoaXMuYmlzZWN0aW9uKG1pbiwgZHJvb3RzWzBdKTtcbiAgICAgICAgICAgIGlmICggcm9vdCAhPSBudWxsICkgcm9vdHMucHVzaChyb290KTtcblxuICAgICAgICAgICAgLy8gZmluZCByb290IG9uIFtkcm9vdHNbaV0sZHJvb3RzW2krMV1dIGZvciAwIDw9IGkgPD0gY291bnQtMlxuICAgICAgICAgICAgZm9yICggaSA9IDA7IGkgPD0gZHJvb3RzLmxlbmd0aC0yOyBpKysgKSB7XG4gICAgICAgICAgICAgICAgcm9vdCA9IHRoaXMuYmlzZWN0aW9uKGRyb290c1tpXSwgZHJvb3RzW2krMV0pO1xuICAgICAgICAgICAgICAgIGlmICggcm9vdCAhPSBudWxsICkgcm9vdHMucHVzaChyb290KTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gZmluZCByb290IG9uIFtkcm9vdHNbY291bnQtMV0seG1heF1cbiAgICAgICAgICAgIHJvb3QgPSB0aGlzLmJpc2VjdGlvbihkcm9vdHNbZHJvb3RzLmxlbmd0aC0xXSwgbWF4KTtcbiAgICAgICAgICAgIGlmICggcm9vdCAhPSBudWxsICkgcm9vdHMucHVzaChyb290KTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIC8vIHBvbHlub21pYWwgaXMgbW9ub3RvbmUgb24gW21pbixtYXhdLCBoYXMgYXQgbW9zdCBvbmUgcm9vdFxuICAgICAgICAgICAgcm9vdCA9IHRoaXMuYmlzZWN0aW9uKG1pbiwgbWF4KTtcbiAgICAgICAgICAgIGlmICggcm9vdCAhPSBudWxsICkgcm9vdHMucHVzaChyb290KTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiByb290cztcbn07XG5cblxuLyoqXG4gKiAgZ2V0TGluZWFyUm9vdFxuICovXG5Qb2x5bm9taWFsLnByb3RvdHlwZS5nZXRMaW5lYXJSb290ID0gZnVuY3Rpb24oKSB7XG4gICAgdmFyIHJlc3VsdCA9IG5ldyBBcnJheSgpO1xuICAgIHZhciBhID0gdGhpcy5jb2Vmc1sxXTtcblxuICAgIGlmICggYSAhPSAwIClcbiAgICAgICAgcmVzdWx0LnB1c2goIC10aGlzLmNvZWZzWzBdIC8gYSApO1xuXG4gICAgcmV0dXJuIHJlc3VsdDtcbn07XG5cblxuLyoqXG4gKiAgZ2V0UXVhZHJhdGljUm9vdHNcbiAqL1xuUG9seW5vbWlhbC5wcm90b3R5cGUuZ2V0UXVhZHJhdGljUm9vdHMgPSBmdW5jdGlvbigpIHtcbiAgICB2YXIgcmVzdWx0cyA9IG5ldyBBcnJheSgpO1xuXG4gICAgaWYgKCB0aGlzLmdldERlZ3JlZSgpID09IDIgKSB7XG4gICAgICAgIHZhciBhID0gdGhpcy5jb2Vmc1syXTtcbiAgICAgICAgdmFyIGIgPSB0aGlzLmNvZWZzWzFdIC8gYTtcbiAgICAgICAgdmFyIGMgPSB0aGlzLmNvZWZzWzBdIC8gYTtcbiAgICAgICAgdmFyIGQgPSBiKmIgLSA0KmM7XG5cbiAgICAgICAgaWYgKCBkID4gMCApIHtcbiAgICAgICAgICAgIHZhciBlID0gTWF0aC5zcXJ0KGQpO1xuXG4gICAgICAgICAgICByZXN1bHRzLnB1c2goIDAuNSAqICgtYiArIGUpICk7XG4gICAgICAgICAgICByZXN1bHRzLnB1c2goIDAuNSAqICgtYiAtIGUpICk7XG4gICAgICAgIH0gZWxzZSBpZiAoIGQgPT0gMCApIHtcbiAgICAgICAgICAgIC8vIHJlYWxseSB0d28gcm9vdHMgd2l0aCBzYW1lIHZhbHVlLCBidXQgd2Ugb25seSByZXR1cm4gb25lXG4gICAgICAgICAgICByZXN1bHRzLnB1c2goIDAuNSAqIC1iICk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gcmVzdWx0cztcbn07XG5cblxuLyoqXG4gKiAgZ2V0Q3ViaWNSb290c1xuICpcbiAqICBUaGlzIGNvZGUgaXMgYmFzZWQgb24gTWdjUG9seW5vbWlhbC5jcHAgd3JpdHRlbiBieSBEYXZpZCBFYmVybHkuICBIaXNcbiAqICBjb2RlIGFsb25nIHdpdGggbWFueSBvdGhlciBleGNlbGxlbnQgZXhhbXBsZXMgYXJlIGF2YWlhYmxlIGF0IGhpcyBzaXRlOlxuICogIGh0dHA6Ly93d3cubWFnaWMtc29mdHdhcmUuY29tXG4gKi9cblBvbHlub21pYWwucHJvdG90eXBlLmdldEN1YmljUm9vdHMgPSBmdW5jdGlvbigpIHtcbiAgICB2YXIgcmVzdWx0cyA9IG5ldyBBcnJheSgpO1xuXG4gICAgaWYgKCB0aGlzLmdldERlZ3JlZSgpID09IDMgKSB7XG4gICAgICAgIHZhciBjMyA9IHRoaXMuY29lZnNbM107XG4gICAgICAgIHZhciBjMiA9IHRoaXMuY29lZnNbMl0gLyBjMztcbiAgICAgICAgdmFyIGMxID0gdGhpcy5jb2Vmc1sxXSAvIGMzO1xuICAgICAgICB2YXIgYzAgPSB0aGlzLmNvZWZzWzBdIC8gYzM7XG5cbiAgICAgICAgdmFyIGEgICAgICAgPSAoMypjMSAtIGMyKmMyKSAvIDM7XG4gICAgICAgIHZhciBiICAgICAgID0gKDIqYzIqYzIqYzIgLSA5KmMxKmMyICsgMjcqYzApIC8gMjc7XG4gICAgICAgIHZhciBvZmZzZXQgID0gYzIgLyAzO1xuICAgICAgICB2YXIgZGlzY3JpbSA9IGIqYi80ICsgYSphKmEvMjc7XG4gICAgICAgIHZhciBoYWxmQiAgID0gYiAvIDI7XG5cbiAgICAgICAgaWYgKCBNYXRoLmFicyhkaXNjcmltKSA8PSBQb2x5bm9taWFsLlRPTEVSQU5DRSApIGRpc2NyaW0gPSAwO1xuXG4gICAgICAgIGlmICggZGlzY3JpbSA+IDAgKSB7XG4gICAgICAgICAgICB2YXIgZSA9IE1hdGguc3FydChkaXNjcmltKTtcbiAgICAgICAgICAgIHZhciB0bXA7XG4gICAgICAgICAgICB2YXIgcm9vdDtcblxuICAgICAgICAgICAgdG1wID0gLWhhbGZCICsgZTtcbiAgICAgICAgICAgIGlmICggdG1wID49IDAgKVxuICAgICAgICAgICAgICAgIHJvb3QgPSBNYXRoLnBvdyh0bXAsIDEvMyk7XG4gICAgICAgICAgICBlbHNlXG4gICAgICAgICAgICAgICAgcm9vdCA9IC1NYXRoLnBvdygtdG1wLCAxLzMpO1xuXG4gICAgICAgICAgICB0bXAgPSAtaGFsZkIgLSBlO1xuICAgICAgICAgICAgaWYgKCB0bXAgPj0gMCApXG4gICAgICAgICAgICAgICAgcm9vdCArPSBNYXRoLnBvdyh0bXAsIDEvMyk7XG4gICAgICAgICAgICBlbHNlXG4gICAgICAgICAgICAgICAgcm9vdCAtPSBNYXRoLnBvdygtdG1wLCAxLzMpO1xuXG4gICAgICAgICAgICByZXN1bHRzLnB1c2goIHJvb3QgLSBvZmZzZXQgKTtcbiAgICAgICAgfSBlbHNlIGlmICggZGlzY3JpbSA8IDAgKSB7XG4gICAgICAgICAgICB2YXIgZGlzdGFuY2UgPSBNYXRoLnNxcnQoLWEvMyk7XG4gICAgICAgICAgICB2YXIgYW5nbGUgICAgPSBNYXRoLmF0YW4yKCBNYXRoLnNxcnQoLWRpc2NyaW0pLCAtaGFsZkIpIC8gMztcbiAgICAgICAgICAgIHZhciBjb3MgICAgICA9IE1hdGguY29zKGFuZ2xlKTtcbiAgICAgICAgICAgIHZhciBzaW4gICAgICA9IE1hdGguc2luKGFuZ2xlKTtcbiAgICAgICAgICAgIHZhciBzcXJ0MyAgICA9IE1hdGguc3FydCgzKTtcblxuICAgICAgICAgICAgcmVzdWx0cy5wdXNoKCAyKmRpc3RhbmNlKmNvcyAtIG9mZnNldCApO1xuICAgICAgICAgICAgcmVzdWx0cy5wdXNoKCAtZGlzdGFuY2UgKiAoY29zICsgc3FydDMgKiBzaW4pIC0gb2Zmc2V0KTtcbiAgICAgICAgICAgIHJlc3VsdHMucHVzaCggLWRpc3RhbmNlICogKGNvcyAtIHNxcnQzICogc2luKSAtIG9mZnNldCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB2YXIgdG1wO1xuXG4gICAgICAgICAgICBpZiAoIGhhbGZCID49IDAgKVxuICAgICAgICAgICAgICAgIHRtcCA9IC1NYXRoLnBvdyhoYWxmQiwgMS8zKTtcbiAgICAgICAgICAgIGVsc2VcbiAgICAgICAgICAgICAgICB0bXAgPSBNYXRoLnBvdygtaGFsZkIsIDEvMyk7XG5cbiAgICAgICAgICAgIHJlc3VsdHMucHVzaCggMip0bXAgLSBvZmZzZXQgKTtcbiAgICAgICAgICAgIC8vIHJlYWxseSBzaG91bGQgcmV0dXJuIG5leHQgcm9vdCB0d2ljZSwgYnV0IHdlIHJldHVybiBvbmx5IG9uZVxuICAgICAgICAgICAgcmVzdWx0cy5wdXNoKCAtdG1wIC0gb2Zmc2V0ICk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gcmVzdWx0cztcbn07XG5cblxuLyoqXG4gKiAgZ2V0UXVhcnRpY1Jvb3RzXG4gKlxuICogIFRoaXMgY29kZSBpcyBiYXNlZCBvbiBNZ2NQb2x5bm9taWFsLmNwcCB3cml0dGVuIGJ5IERhdmlkIEViZXJseS4gIEhpc1xuICogIGNvZGUgYWxvbmcgd2l0aCBtYW55IG90aGVyIGV4Y2VsbGVudCBleGFtcGxlcyBhcmUgYXZhaWFibGUgYXQgaGlzIHNpdGU6XG4gKiAgaHR0cDovL3d3dy5tYWdpYy1zb2Z0d2FyZS5jb21cbiAqL1xuUG9seW5vbWlhbC5wcm90b3R5cGUuZ2V0UXVhcnRpY1Jvb3RzID0gZnVuY3Rpb24oKSB7XG4gICAgdmFyIHJlc3VsdHMgPSBuZXcgQXJyYXkoKTtcblxuICAgIGlmICggdGhpcy5nZXREZWdyZWUoKSA9PSA0ICkge1xuICAgICAgICB2YXIgYzQgPSB0aGlzLmNvZWZzWzRdO1xuICAgICAgICB2YXIgYzMgPSB0aGlzLmNvZWZzWzNdIC8gYzQ7XG4gICAgICAgIHZhciBjMiA9IHRoaXMuY29lZnNbMl0gLyBjNDtcbiAgICAgICAgdmFyIGMxID0gdGhpcy5jb2Vmc1sxXSAvIGM0O1xuICAgICAgICB2YXIgYzAgPSB0aGlzLmNvZWZzWzBdIC8gYzQ7XG5cbiAgICAgICAgdmFyIHJlc29sdmVSb290cyA9IG5ldyBQb2x5bm9taWFsKFxuICAgICAgICAgICAgMSwgLWMyLCBjMypjMSAtIDQqYzAsIC1jMypjMypjMCArIDQqYzIqYzAgLWMxKmMxXG4gICAgICAgICkuZ2V0Q3ViaWNSb290cygpO1xuICAgICAgICB2YXIgeSAgICAgICA9IHJlc29sdmVSb290c1swXTtcbiAgICAgICAgdmFyIGRpc2NyaW0gPSBjMypjMy80IC0gYzIgKyB5O1xuXG4gICAgICAgIGlmICggTWF0aC5hYnMoZGlzY3JpbSkgPD0gUG9seW5vbWlhbC5UT0xFUkFOQ0UgKSBkaXNjcmltID0gMDtcblxuICAgICAgICBpZiAoIGRpc2NyaW0gPiAwICkge1xuICAgICAgICAgICAgdmFyIGUgICAgID0gTWF0aC5zcXJ0KGRpc2NyaW0pO1xuICAgICAgICAgICAgdmFyIHQxICAgID0gMypjMypjMy80IC0gZSplIC0gMipjMjtcbiAgICAgICAgICAgIHZhciB0MiAgICA9ICggNCpjMypjMiAtIDgqYzEgLSBjMypjMypjMyApIC8gKCA0KmUgKTtcbiAgICAgICAgICAgIHZhciBwbHVzICA9IHQxK3QyO1xuICAgICAgICAgICAgdmFyIG1pbnVzID0gdDEtdDI7XG5cbiAgICAgICAgICAgIGlmICggTWF0aC5hYnMocGx1cykgIDw9IFBvbHlub21pYWwuVE9MRVJBTkNFICkgcGx1cyAgPSAwO1xuICAgICAgICAgICAgaWYgKCBNYXRoLmFicyhtaW51cykgPD0gUG9seW5vbWlhbC5UT0xFUkFOQ0UgKSBtaW51cyA9IDA7XG5cbiAgICAgICAgICAgIGlmICggcGx1cyA+PSAwICkge1xuICAgICAgICAgICAgICAgIHZhciBmID0gTWF0aC5zcXJ0KHBsdXMpO1xuXG4gICAgICAgICAgICAgICAgcmVzdWx0cy5wdXNoKCAtYzMvNCArIChlK2YpLzIgKTtcbiAgICAgICAgICAgICAgICByZXN1bHRzLnB1c2goIC1jMy80ICsgKGUtZikvMiApO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKCBtaW51cyA+PSAwICkge1xuICAgICAgICAgICAgICAgIHZhciBmID0gTWF0aC5zcXJ0KG1pbnVzKTtcblxuICAgICAgICAgICAgICAgIHJlc3VsdHMucHVzaCggLWMzLzQgKyAoZi1lKS8yICk7XG4gICAgICAgICAgICAgICAgcmVzdWx0cy5wdXNoKCAtYzMvNCAtIChmK2UpLzIgKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIGlmICggZGlzY3JpbSA8IDAgKSB7XG4gICAgICAgICAgICAvLyBubyByb290c1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdmFyIHQyID0geSp5IC0gNCpjMDtcblxuICAgICAgICAgICAgaWYgKCB0MiA+PSAtUG9seW5vbWlhbC5UT0xFUkFOQ0UgKSB7XG4gICAgICAgICAgICAgICAgaWYgKCB0MiA8IDAgKSB0MiA9IDA7XG5cbiAgICAgICAgICAgICAgICB0MiA9IDIqTWF0aC5zcXJ0KHQyKTtcbiAgICAgICAgICAgICAgICB0MSA9IDMqYzMqYzMvNCAtIDIqYzI7XG4gICAgICAgICAgICAgICAgaWYgKCB0MSt0MiA+PSBQb2x5bm9taWFsLlRPTEVSQU5DRSApIHtcbiAgICAgICAgICAgICAgICAgICAgdmFyIGQgPSBNYXRoLnNxcnQodDErdDIpO1xuXG4gICAgICAgICAgICAgICAgICAgIHJlc3VsdHMucHVzaCggLWMzLzQgKyBkLzIgKTtcbiAgICAgICAgICAgICAgICAgICAgcmVzdWx0cy5wdXNoKCAtYzMvNCAtIGQvMiApO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBpZiAoIHQxLXQyID49IFBvbHlub21pYWwuVE9MRVJBTkNFICkge1xuICAgICAgICAgICAgICAgICAgICB2YXIgZCA9IE1hdGguc3FydCh0MS10Mik7XG5cbiAgICAgICAgICAgICAgICAgICAgcmVzdWx0cy5wdXNoKCAtYzMvNCArIGQvMiApO1xuICAgICAgICAgICAgICAgICAgICByZXN1bHRzLnB1c2goIC1jMy80IC0gZC8yICk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHJlc3VsdHM7XG59O1xuXG5pZiAodHlwZW9mIG1vZHVsZSAhPT0gXCJ1bmRlZmluZWRcIikge1xuICAgIG1vZHVsZS5leHBvcnRzID0gUG9seW5vbWlhbDtcbn1cbiIsIi8qKlxuICpcbiAqICAgU3FydFBvbHlub21pYWwuanNcbiAqXG4gKiAgIGNvcHlyaWdodCAyMDAzLCAyMDEzIEtldmluIExpbmRzZXlcbiAqXG4gKi9cblxuaWYgKHR5cGVvZiBtb2R1bGUgIT09IFwidW5kZWZpbmVkXCIpIHtcbiAgICB2YXIgUG9seW5vbWlhbCA9IHJlcXVpcmUoXCIuL1BvbHlub21pYWxcIik7XG59XG5cbi8qKlxuICogICBjbGFzcyB2YXJpYWJsZXNcbiAqL1xuU3FydFBvbHlub21pYWwuVkVSU0lPTiA9IDEuMDtcblxuLy8gc2V0dXAgaW5oZXJpdGFuY2VcblNxcnRQb2x5bm9taWFsLnByb3RvdHlwZSAgICAgICAgICAgICA9IG5ldyBQb2x5bm9taWFsKCk7XG5TcXJ0UG9seW5vbWlhbC5wcm90b3R5cGUuY29uc3RydWN0b3IgPSBTcXJ0UG9seW5vbWlhbDtcblNxcnRQb2x5bm9taWFsLnN1cGVyY2xhc3MgICAgICAgICAgICA9IFBvbHlub21pYWwucHJvdG90eXBlO1xuXG5cbi8qKlxuICogIFNxcnRQb2x5bm9taWFsXG4gKi9cbmZ1bmN0aW9uIFNxcnRQb2x5bm9taWFsKCkge1xuICAgIHRoaXMuaW5pdCggYXJndW1lbnRzICk7XG59XG5cblxuLyoqXG4gKiAgZXZhbFxuICpcbiAqICBAcGFyYW0ge051bWJlcn0geFxuICogIEByZXR1cm5zIHtOdW1iZXJ9XG4gKi9cblNxcnRQb2x5bm9taWFsLnByb3RvdHlwZS5ldmFsID0gZnVuY3Rpb24oeCkge1xuICAgIHZhciBUT0xFUkFOQ0UgPSAxZS03O1xuICAgIHZhciByZXN1bHQgPSBTcXJ0UG9seW5vbWlhbC5zdXBlcmNsYXNzLmV2YWwuY2FsbCh0aGlzLCB4KTtcblxuICAgIC8vIE5PVEU6IE1heSBuZWVkIHRvIGNoYW5nZSB0aGUgZm9sbG93aW5nLiAgSSBhZGRlZCB0aGVzZSB0byBjYXB0dXJlXG4gICAgLy8gc29tZSByZWFsbHkgc21hbGwgbmVnYXRpdmUgdmFsdWVzIHRoYXQgd2VyZSBiZWluZyBnZW5lcmF0ZWQgYnkgb25lXG4gICAgLy8gb2YgbXkgQmV6aWVyIGFyY0xlbmd0aCBmdW5jdGlvbnNcbiAgICBpZiAoIE1hdGguYWJzKHJlc3VsdCkgPCBUT0xFUkFOQ0UgKSByZXN1bHQgPSAwO1xuICAgIGlmICggcmVzdWx0IDwgMCApXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcIlNxcnRQb2x5bm9taWFsLmV2YWw6IGNhbm5vdCB0YWtlIHNxdWFyZSByb290IG9mIG5lZ2F0aXZlIG51bWJlclwiKTtcblxuICAgIHJldHVybiBNYXRoLnNxcnQocmVzdWx0KTtcbn07XG5cblNxcnRQb2x5bm9taWFsLnByb3RvdHlwZS50b1N0cmluZyA9IGZ1bmN0aW9uKCkge1xuICAgIHZhciByZXN1bHQgPSBTcXJ0UG9seW5vbWlhbC5zdXBlcmNsYXNzLnRvU3RyaW5nLmNhbGwodGhpcyk7XG5cbiAgICByZXR1cm4gXCJzcXJ0KFwiICsgcmVzdWx0ICsgXCIpXCI7XG59O1xuXG5pZiAodHlwZW9mIG1vZHVsZSAhPT0gXCJ1bmRlZmluZWRcIikge1xuICAgIG1vZHVsZS5leHBvcnRzID0gU3FydFBvbHlub21pYWw7XG59XG4iLCIvKlxuIChjKSAyMDEzLCBWbGFkaW1pciBBZ2Fmb25raW5cbiBSQnVzaCwgYSBKYXZhU2NyaXB0IGxpYnJhcnkgZm9yIGhpZ2gtcGVyZm9ybWFuY2UgMkQgc3BhdGlhbCBpbmRleGluZyBvZiBwb2ludHMgYW5kIHJlY3RhbmdsZXMuXG4gaHR0cHM6Ly9naXRodWIuY29tL21vdXJuZXIvcmJ1c2hcbiovXG5cbihmdW5jdGlvbiAoKSB7ICd1c2Ugc3RyaWN0JztcblxuZnVuY3Rpb24gcmJ1c2gobWF4RW50cmllcywgZm9ybWF0KSB7XG5cbiAgICAvLyBqc2hpbnQgbmV3Y2FwOiBmYWxzZSwgdmFsaWR0aGlzOiB0cnVlXG4gICAgaWYgKCEodGhpcyBpbnN0YW5jZW9mIHJidXNoKSkgcmV0dXJuIG5ldyByYnVzaChtYXhFbnRyaWVzLCBmb3JtYXQpO1xuXG4gICAgLy8gbWF4IGVudHJpZXMgaW4gYSBub2RlIGlzIDkgYnkgZGVmYXVsdDsgbWluIG5vZGUgZmlsbCBpcyA0MCUgZm9yIGJlc3QgcGVyZm9ybWFuY2VcbiAgICB0aGlzLl9tYXhFbnRyaWVzID0gTWF0aC5tYXgoNCwgbWF4RW50cmllcyB8fCA5KTtcbiAgICB0aGlzLl9taW5FbnRyaWVzID0gTWF0aC5tYXgoMiwgTWF0aC5jZWlsKHRoaXMuX21heEVudHJpZXMgKiAwLjQpKTtcblxuICAgIGlmIChmb3JtYXQpIHtcbiAgICAgICAgdGhpcy5faW5pdEZvcm1hdChmb3JtYXQpO1xuICAgIH1cblxuICAgIHRoaXMuY2xlYXIoKTtcbn1cblxucmJ1c2gucHJvdG90eXBlID0ge1xuXG4gICAgYWxsOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHJldHVybiB0aGlzLl9hbGwodGhpcy5kYXRhLCBbXSk7XG4gICAgfSxcblxuICAgIHNlYXJjaDogZnVuY3Rpb24gKGJib3gpIHtcblxuICAgICAgICB2YXIgbm9kZSA9IHRoaXMuZGF0YSxcbiAgICAgICAgICAgIHJlc3VsdCA9IFtdLFxuICAgICAgICAgICAgdG9CQm94ID0gdGhpcy50b0JCb3g7XG5cbiAgICAgICAgaWYgKCFpbnRlcnNlY3RzKGJib3gsIG5vZGUuYmJveCkpIHJldHVybiByZXN1bHQ7XG5cbiAgICAgICAgdmFyIG5vZGVzVG9TZWFyY2ggPSBbXSxcbiAgICAgICAgICAgIGksIGxlbiwgY2hpbGQsIGNoaWxkQkJveDtcblxuICAgICAgICB3aGlsZSAobm9kZSkge1xuICAgICAgICAgICAgZm9yIChpID0gMCwgbGVuID0gbm9kZS5jaGlsZHJlbi5sZW5ndGg7IGkgPCBsZW47IGkrKykge1xuXG4gICAgICAgICAgICAgICAgY2hpbGQgPSBub2RlLmNoaWxkcmVuW2ldO1xuICAgICAgICAgICAgICAgIGNoaWxkQkJveCA9IG5vZGUubGVhZiA/IHRvQkJveChjaGlsZCkgOiBjaGlsZC5iYm94O1xuXG4gICAgICAgICAgICAgICAgaWYgKGludGVyc2VjdHMoYmJveCwgY2hpbGRCQm94KSkge1xuICAgICAgICAgICAgICAgICAgICBpZiAobm9kZS5sZWFmKSByZXN1bHQucHVzaChjaGlsZCk7XG4gICAgICAgICAgICAgICAgICAgIGVsc2UgaWYgKGNvbnRhaW5zKGJib3gsIGNoaWxkQkJveCkpIHRoaXMuX2FsbChjaGlsZCwgcmVzdWx0KTtcbiAgICAgICAgICAgICAgICAgICAgZWxzZSBub2Rlc1RvU2VhcmNoLnB1c2goY2hpbGQpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIG5vZGUgPSBub2Rlc1RvU2VhcmNoLnBvcCgpO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICB9LFxuXG4gICAgY29sbGlkZXM6IGZ1bmN0aW9uIChiYm94KSB7XG5cbiAgICAgICAgdmFyIG5vZGUgPSB0aGlzLmRhdGEsXG4gICAgICAgICAgICB0b0JCb3ggPSB0aGlzLnRvQkJveDtcblxuICAgICAgICBpZiAoIWludGVyc2VjdHMoYmJveCwgbm9kZS5iYm94KSkgcmV0dXJuIGZhbHNlO1xuXG4gICAgICAgIHZhciBub2Rlc1RvU2VhcmNoID0gW10sXG4gICAgICAgICAgICBpLCBsZW4sIGNoaWxkLCBjaGlsZEJCb3g7XG5cbiAgICAgICAgd2hpbGUgKG5vZGUpIHtcbiAgICAgICAgICAgIGZvciAoaSA9IDAsIGxlbiA9IG5vZGUuY2hpbGRyZW4ubGVuZ3RoOyBpIDwgbGVuOyBpKyspIHtcblxuICAgICAgICAgICAgICAgIGNoaWxkID0gbm9kZS5jaGlsZHJlbltpXTtcbiAgICAgICAgICAgICAgICBjaGlsZEJCb3ggPSBub2RlLmxlYWYgPyB0b0JCb3goY2hpbGQpIDogY2hpbGQuYmJveDtcblxuICAgICAgICAgICAgICAgIGlmIChpbnRlcnNlY3RzKGJib3gsIGNoaWxkQkJveCkpIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKG5vZGUubGVhZiB8fCBjb250YWlucyhiYm94LCBjaGlsZEJCb3gpKSByZXR1cm4gdHJ1ZTtcbiAgICAgICAgICAgICAgICAgICAgbm9kZXNUb1NlYXJjaC5wdXNoKGNoaWxkKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBub2RlID0gbm9kZXNUb1NlYXJjaC5wb3AoKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9LFxuXG4gICAgbG9hZDogZnVuY3Rpb24gKGRhdGEpIHtcbiAgICAgICAgaWYgKCEoZGF0YSAmJiBkYXRhLmxlbmd0aCkpIHJldHVybiB0aGlzO1xuXG4gICAgICAgIGlmIChkYXRhLmxlbmd0aCA8IHRoaXMuX21pbkVudHJpZXMpIHtcbiAgICAgICAgICAgIGZvciAodmFyIGkgPSAwLCBsZW4gPSBkYXRhLmxlbmd0aDsgaSA8IGxlbjsgaSsrKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5pbnNlcnQoZGF0YVtpXSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gdGhpcztcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIHJlY3Vyc2l2ZWx5IGJ1aWxkIHRoZSB0cmVlIHdpdGggdGhlIGdpdmVuIGRhdGEgZnJvbSBzdHJhdGNoIHVzaW5nIE9NVCBhbGdvcml0aG1cbiAgICAgICAgdmFyIG5vZGUgPSB0aGlzLl9idWlsZChkYXRhLnNsaWNlKCksIDAsIGRhdGEubGVuZ3RoIC0gMSwgMCk7XG5cbiAgICAgICAgaWYgKCF0aGlzLmRhdGEuY2hpbGRyZW4ubGVuZ3RoKSB7XG4gICAgICAgICAgICAvLyBzYXZlIGFzIGlzIGlmIHRyZWUgaXMgZW1wdHlcbiAgICAgICAgICAgIHRoaXMuZGF0YSA9IG5vZGU7XG5cbiAgICAgICAgfSBlbHNlIGlmICh0aGlzLmRhdGEuaGVpZ2h0ID09PSBub2RlLmhlaWdodCkge1xuICAgICAgICAgICAgLy8gc3BsaXQgcm9vdCBpZiB0cmVlcyBoYXZlIHRoZSBzYW1lIGhlaWdodFxuICAgICAgICAgICAgdGhpcy5fc3BsaXRSb290KHRoaXMuZGF0YSwgbm9kZSk7XG5cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGlmICh0aGlzLmRhdGEuaGVpZ2h0IDwgbm9kZS5oZWlnaHQpIHtcbiAgICAgICAgICAgICAgICAvLyBzd2FwIHRyZWVzIGlmIGluc2VydGVkIG9uZSBpcyBiaWdnZXJcbiAgICAgICAgICAgICAgICB2YXIgdG1wTm9kZSA9IHRoaXMuZGF0YTtcbiAgICAgICAgICAgICAgICB0aGlzLmRhdGEgPSBub2RlO1xuICAgICAgICAgICAgICAgIG5vZGUgPSB0bXBOb2RlO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBpbnNlcnQgdGhlIHNtYWxsIHRyZWUgaW50byB0aGUgbGFyZ2UgdHJlZSBhdCBhcHByb3ByaWF0ZSBsZXZlbFxuICAgICAgICAgICAgdGhpcy5faW5zZXJ0KG5vZGUsIHRoaXMuZGF0YS5oZWlnaHQgLSBub2RlLmhlaWdodCAtIDEsIHRydWUpO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfSxcblxuICAgIGluc2VydDogZnVuY3Rpb24gKGl0ZW0pIHtcbiAgICAgICAgaWYgKGl0ZW0pIHRoaXMuX2luc2VydChpdGVtLCB0aGlzLmRhdGEuaGVpZ2h0IC0gMSk7XG4gICAgICAgIHJldHVybiB0aGlzO1xuICAgIH0sXG5cbiAgICBjbGVhcjogZnVuY3Rpb24gKCkge1xuICAgICAgICB0aGlzLmRhdGEgPSB7XG4gICAgICAgICAgICBjaGlsZHJlbjogW10sXG4gICAgICAgICAgICBoZWlnaHQ6IDEsXG4gICAgICAgICAgICBiYm94OiBlbXB0eSgpLFxuICAgICAgICAgICAgbGVhZjogdHJ1ZVxuICAgICAgICB9O1xuICAgICAgICByZXR1cm4gdGhpcztcbiAgICB9LFxuXG4gICAgcmVtb3ZlOiBmdW5jdGlvbiAoaXRlbSkge1xuICAgICAgICBpZiAoIWl0ZW0pIHJldHVybiB0aGlzO1xuXG4gICAgICAgIHZhciBub2RlID0gdGhpcy5kYXRhLFxuICAgICAgICAgICAgYmJveCA9IHRoaXMudG9CQm94KGl0ZW0pLFxuICAgICAgICAgICAgcGF0aCA9IFtdLFxuICAgICAgICAgICAgaW5kZXhlcyA9IFtdLFxuICAgICAgICAgICAgaSwgcGFyZW50LCBpbmRleCwgZ29pbmdVcDtcblxuICAgICAgICAvLyBkZXB0aC1maXJzdCBpdGVyYXRpdmUgdHJlZSB0cmF2ZXJzYWxcbiAgICAgICAgd2hpbGUgKG5vZGUgfHwgcGF0aC5sZW5ndGgpIHtcblxuICAgICAgICAgICAgaWYgKCFub2RlKSB7IC8vIGdvIHVwXG4gICAgICAgICAgICAgICAgbm9kZSA9IHBhdGgucG9wKCk7XG4gICAgICAgICAgICAgICAgcGFyZW50ID0gcGF0aFtwYXRoLmxlbmd0aCAtIDFdO1xuICAgICAgICAgICAgICAgIGkgPSBpbmRleGVzLnBvcCgpO1xuICAgICAgICAgICAgICAgIGdvaW5nVXAgPSB0cnVlO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAobm9kZS5sZWFmKSB7IC8vIGNoZWNrIGN1cnJlbnQgbm9kZVxuICAgICAgICAgICAgICAgIGluZGV4ID0gbm9kZS5jaGlsZHJlbi5pbmRleE9mKGl0ZW0pO1xuXG4gICAgICAgICAgICAgICAgaWYgKGluZGV4ICE9PSAtMSkge1xuICAgICAgICAgICAgICAgICAgICAvLyBpdGVtIGZvdW5kLCByZW1vdmUgdGhlIGl0ZW0gYW5kIGNvbmRlbnNlIHRyZWUgdXB3YXJkc1xuICAgICAgICAgICAgICAgICAgICBub2RlLmNoaWxkcmVuLnNwbGljZShpbmRleCwgMSk7XG4gICAgICAgICAgICAgICAgICAgIHBhdGgucHVzaChub2RlKTtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5fY29uZGVuc2UocGF0aCk7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB0aGlzO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKCFnb2luZ1VwICYmICFub2RlLmxlYWYgJiYgY29udGFpbnMobm9kZS5iYm94LCBiYm94KSkgeyAvLyBnbyBkb3duXG4gICAgICAgICAgICAgICAgcGF0aC5wdXNoKG5vZGUpO1xuICAgICAgICAgICAgICAgIGluZGV4ZXMucHVzaChpKTtcbiAgICAgICAgICAgICAgICBpID0gMDtcbiAgICAgICAgICAgICAgICBwYXJlbnQgPSBub2RlO1xuICAgICAgICAgICAgICAgIG5vZGUgPSBub2RlLmNoaWxkcmVuWzBdO1xuXG4gICAgICAgICAgICB9IGVsc2UgaWYgKHBhcmVudCkgeyAvLyBnbyByaWdodFxuICAgICAgICAgICAgICAgIGkrKztcbiAgICAgICAgICAgICAgICBub2RlID0gcGFyZW50LmNoaWxkcmVuW2ldO1xuICAgICAgICAgICAgICAgIGdvaW5nVXAgPSBmYWxzZTtcblxuICAgICAgICAgICAgfSBlbHNlIG5vZGUgPSBudWxsOyAvLyBub3RoaW5nIGZvdW5kXG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gdGhpcztcbiAgICB9LFxuXG4gICAgdG9CQm94OiBmdW5jdGlvbiAoaXRlbSkgeyByZXR1cm4gaXRlbTsgfSxcblxuICAgIGNvbXBhcmVNaW5YOiBmdW5jdGlvbiAoYSwgYikgeyByZXR1cm4gYVswXSAtIGJbMF07IH0sXG4gICAgY29tcGFyZU1pblk6IGZ1bmN0aW9uIChhLCBiKSB7IHJldHVybiBhWzFdIC0gYlsxXTsgfSxcblxuICAgIHRvSlNPTjogZnVuY3Rpb24gKCkgeyByZXR1cm4gdGhpcy5kYXRhOyB9LFxuXG4gICAgZnJvbUpTT046IGZ1bmN0aW9uIChkYXRhKSB7XG4gICAgICAgIHRoaXMuZGF0YSA9IGRhdGE7XG4gICAgICAgIHJldHVybiB0aGlzO1xuICAgIH0sXG5cbiAgICBfYWxsOiBmdW5jdGlvbiAobm9kZSwgcmVzdWx0KSB7XG4gICAgICAgIHZhciBub2Rlc1RvU2VhcmNoID0gW107XG4gICAgICAgIHdoaWxlIChub2RlKSB7XG4gICAgICAgICAgICBpZiAobm9kZS5sZWFmKSByZXN1bHQucHVzaC5hcHBseShyZXN1bHQsIG5vZGUuY2hpbGRyZW4pO1xuICAgICAgICAgICAgZWxzZSBub2Rlc1RvU2VhcmNoLnB1c2guYXBwbHkobm9kZXNUb1NlYXJjaCwgbm9kZS5jaGlsZHJlbik7XG5cbiAgICAgICAgICAgIG5vZGUgPSBub2Rlc1RvU2VhcmNoLnBvcCgpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgfSxcblxuICAgIF9idWlsZDogZnVuY3Rpb24gKGl0ZW1zLCBsZWZ0LCByaWdodCwgaGVpZ2h0KSB7XG5cbiAgICAgICAgdmFyIE4gPSByaWdodCAtIGxlZnQgKyAxLFxuICAgICAgICAgICAgTSA9IHRoaXMuX21heEVudHJpZXMsXG4gICAgICAgICAgICBub2RlO1xuXG4gICAgICAgIGlmIChOIDw9IE0pIHtcbiAgICAgICAgICAgIC8vIHJlYWNoZWQgbGVhZiBsZXZlbDsgcmV0dXJuIGxlYWZcbiAgICAgICAgICAgIG5vZGUgPSB7XG4gICAgICAgICAgICAgICAgY2hpbGRyZW46IGl0ZW1zLnNsaWNlKGxlZnQsIHJpZ2h0ICsgMSksXG4gICAgICAgICAgICAgICAgaGVpZ2h0OiAxLFxuICAgICAgICAgICAgICAgIGJib3g6IG51bGwsXG4gICAgICAgICAgICAgICAgbGVhZjogdHJ1ZVxuICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIGNhbGNCQm94KG5vZGUsIHRoaXMudG9CQm94KTtcbiAgICAgICAgICAgIHJldHVybiBub2RlO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKCFoZWlnaHQpIHtcbiAgICAgICAgICAgIC8vIHRhcmdldCBoZWlnaHQgb2YgdGhlIGJ1bGstbG9hZGVkIHRyZWVcbiAgICAgICAgICAgIGhlaWdodCA9IE1hdGguY2VpbChNYXRoLmxvZyhOKSAvIE1hdGgubG9nKE0pKTtcblxuICAgICAgICAgICAgLy8gdGFyZ2V0IG51bWJlciBvZiByb290IGVudHJpZXMgdG8gbWF4aW1pemUgc3RvcmFnZSB1dGlsaXphdGlvblxuICAgICAgICAgICAgTSA9IE1hdGguY2VpbChOIC8gTWF0aC5wb3coTSwgaGVpZ2h0IC0gMSkpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gVE9ETyBlbGltaW5hdGUgcmVjdXJzaW9uP1xuXG4gICAgICAgIG5vZGUgPSB7XG4gICAgICAgICAgICBjaGlsZHJlbjogW10sXG4gICAgICAgICAgICBoZWlnaHQ6IGhlaWdodCxcbiAgICAgICAgICAgIGJib3g6IG51bGxcbiAgICAgICAgfTtcblxuICAgICAgICAvLyBzcGxpdCB0aGUgaXRlbXMgaW50byBNIG1vc3RseSBzcXVhcmUgdGlsZXNcblxuICAgICAgICB2YXIgTjIgPSBNYXRoLmNlaWwoTiAvIE0pLFxuICAgICAgICAgICAgTjEgPSBOMiAqIE1hdGguY2VpbChNYXRoLnNxcnQoTSkpLFxuICAgICAgICAgICAgaSwgaiwgcmlnaHQyLCByaWdodDM7XG5cbiAgICAgICAgbXVsdGlTZWxlY3QoaXRlbXMsIGxlZnQsIHJpZ2h0LCBOMSwgdGhpcy5jb21wYXJlTWluWCk7XG5cbiAgICAgICAgZm9yIChpID0gbGVmdDsgaSA8PSByaWdodDsgaSArPSBOMSkge1xuXG4gICAgICAgICAgICByaWdodDIgPSBNYXRoLm1pbihpICsgTjEgLSAxLCByaWdodCk7XG5cbiAgICAgICAgICAgIG11bHRpU2VsZWN0KGl0ZW1zLCBpLCByaWdodDIsIE4yLCB0aGlzLmNvbXBhcmVNaW5ZKTtcblxuICAgICAgICAgICAgZm9yIChqID0gaTsgaiA8PSByaWdodDI7IGogKz0gTjIpIHtcblxuICAgICAgICAgICAgICAgIHJpZ2h0MyA9IE1hdGgubWluKGogKyBOMiAtIDEsIHJpZ2h0Mik7XG5cbiAgICAgICAgICAgICAgICAvLyBwYWNrIGVhY2ggZW50cnkgcmVjdXJzaXZlbHlcbiAgICAgICAgICAgICAgICBub2RlLmNoaWxkcmVuLnB1c2godGhpcy5fYnVpbGQoaXRlbXMsIGosIHJpZ2h0MywgaGVpZ2h0IC0gMSkpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgY2FsY0JCb3gobm9kZSwgdGhpcy50b0JCb3gpO1xuXG4gICAgICAgIHJldHVybiBub2RlO1xuICAgIH0sXG5cbiAgICBfY2hvb3NlU3VidHJlZTogZnVuY3Rpb24gKGJib3gsIG5vZGUsIGxldmVsLCBwYXRoKSB7XG5cbiAgICAgICAgdmFyIGksIGxlbiwgY2hpbGQsIHRhcmdldE5vZGUsIGFyZWEsIGVubGFyZ2VtZW50LCBtaW5BcmVhLCBtaW5FbmxhcmdlbWVudDtcblxuICAgICAgICB3aGlsZSAodHJ1ZSkge1xuICAgICAgICAgICAgcGF0aC5wdXNoKG5vZGUpO1xuXG4gICAgICAgICAgICBpZiAobm9kZS5sZWFmIHx8IHBhdGgubGVuZ3RoIC0gMSA9PT0gbGV2ZWwpIGJyZWFrO1xuXG4gICAgICAgICAgICBtaW5BcmVhID0gbWluRW5sYXJnZW1lbnQgPSBJbmZpbml0eTtcblxuICAgICAgICAgICAgZm9yIChpID0gMCwgbGVuID0gbm9kZS5jaGlsZHJlbi5sZW5ndGg7IGkgPCBsZW47IGkrKykge1xuICAgICAgICAgICAgICAgIGNoaWxkID0gbm9kZS5jaGlsZHJlbltpXTtcbiAgICAgICAgICAgICAgICBhcmVhID0gYmJveEFyZWEoY2hpbGQuYmJveCk7XG4gICAgICAgICAgICAgICAgZW5sYXJnZW1lbnQgPSBlbmxhcmdlZEFyZWEoYmJveCwgY2hpbGQuYmJveCkgLSBhcmVhO1xuXG4gICAgICAgICAgICAgICAgLy8gY2hvb3NlIGVudHJ5IHdpdGggdGhlIGxlYXN0IGFyZWEgZW5sYXJnZW1lbnRcbiAgICAgICAgICAgICAgICBpZiAoZW5sYXJnZW1lbnQgPCBtaW5FbmxhcmdlbWVudCkge1xuICAgICAgICAgICAgICAgICAgICBtaW5FbmxhcmdlbWVudCA9IGVubGFyZ2VtZW50O1xuICAgICAgICAgICAgICAgICAgICBtaW5BcmVhID0gYXJlYSA8IG1pbkFyZWEgPyBhcmVhIDogbWluQXJlYTtcbiAgICAgICAgICAgICAgICAgICAgdGFyZ2V0Tm9kZSA9IGNoaWxkO1xuXG4gICAgICAgICAgICAgICAgfSBlbHNlIGlmIChlbmxhcmdlbWVudCA9PT0gbWluRW5sYXJnZW1lbnQpIHtcbiAgICAgICAgICAgICAgICAgICAgLy8gb3RoZXJ3aXNlIGNob29zZSBvbmUgd2l0aCB0aGUgc21hbGxlc3QgYXJlYVxuICAgICAgICAgICAgICAgICAgICBpZiAoYXJlYSA8IG1pbkFyZWEpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIG1pbkFyZWEgPSBhcmVhO1xuICAgICAgICAgICAgICAgICAgICAgICAgdGFyZ2V0Tm9kZSA9IGNoaWxkO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBub2RlID0gdGFyZ2V0Tm9kZTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBub2RlO1xuICAgIH0sXG5cbiAgICBfaW5zZXJ0OiBmdW5jdGlvbiAoaXRlbSwgbGV2ZWwsIGlzTm9kZSkge1xuXG4gICAgICAgIHZhciB0b0JCb3ggPSB0aGlzLnRvQkJveCxcbiAgICAgICAgICAgIGJib3ggPSBpc05vZGUgPyBpdGVtLmJib3ggOiB0b0JCb3goaXRlbSksXG4gICAgICAgICAgICBpbnNlcnRQYXRoID0gW107XG5cbiAgICAgICAgLy8gZmluZCB0aGUgYmVzdCBub2RlIGZvciBhY2NvbW1vZGF0aW5nIHRoZSBpdGVtLCBzYXZpbmcgYWxsIG5vZGVzIGFsb25nIHRoZSBwYXRoIHRvb1xuICAgICAgICB2YXIgbm9kZSA9IHRoaXMuX2Nob29zZVN1YnRyZWUoYmJveCwgdGhpcy5kYXRhLCBsZXZlbCwgaW5zZXJ0UGF0aCk7XG5cbiAgICAgICAgLy8gcHV0IHRoZSBpdGVtIGludG8gdGhlIG5vZGVcbiAgICAgICAgbm9kZS5jaGlsZHJlbi5wdXNoKGl0ZW0pO1xuICAgICAgICBleHRlbmQobm9kZS5iYm94LCBiYm94KTtcblxuICAgICAgICAvLyBzcGxpdCBvbiBub2RlIG92ZXJmbG93OyBwcm9wYWdhdGUgdXB3YXJkcyBpZiBuZWNlc3NhcnlcbiAgICAgICAgd2hpbGUgKGxldmVsID49IDApIHtcbiAgICAgICAgICAgIGlmIChpbnNlcnRQYXRoW2xldmVsXS5jaGlsZHJlbi5sZW5ndGggPiB0aGlzLl9tYXhFbnRyaWVzKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5fc3BsaXQoaW5zZXJ0UGF0aCwgbGV2ZWwpO1xuICAgICAgICAgICAgICAgIGxldmVsLS07XG4gICAgICAgICAgICB9IGVsc2UgYnJlYWs7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBhZGp1c3QgYmJveGVzIGFsb25nIHRoZSBpbnNlcnRpb24gcGF0aFxuICAgICAgICB0aGlzLl9hZGp1c3RQYXJlbnRCQm94ZXMoYmJveCwgaW5zZXJ0UGF0aCwgbGV2ZWwpO1xuICAgIH0sXG5cbiAgICAvLyBzcGxpdCBvdmVyZmxvd2VkIG5vZGUgaW50byB0d29cbiAgICBfc3BsaXQ6IGZ1bmN0aW9uIChpbnNlcnRQYXRoLCBsZXZlbCkge1xuXG4gICAgICAgIHZhciBub2RlID0gaW5zZXJ0UGF0aFtsZXZlbF0sXG4gICAgICAgICAgICBNID0gbm9kZS5jaGlsZHJlbi5sZW5ndGgsXG4gICAgICAgICAgICBtID0gdGhpcy5fbWluRW50cmllcztcblxuICAgICAgICB0aGlzLl9jaG9vc2VTcGxpdEF4aXMobm9kZSwgbSwgTSk7XG5cbiAgICAgICAgdmFyIG5ld05vZGUgPSB7XG4gICAgICAgICAgICBjaGlsZHJlbjogbm9kZS5jaGlsZHJlbi5zcGxpY2UodGhpcy5fY2hvb3NlU3BsaXRJbmRleChub2RlLCBtLCBNKSksXG4gICAgICAgICAgICBoZWlnaHQ6IG5vZGUuaGVpZ2h0XG4gICAgICAgIH07XG5cbiAgICAgICAgaWYgKG5vZGUubGVhZikgbmV3Tm9kZS5sZWFmID0gdHJ1ZTtcblxuICAgICAgICBjYWxjQkJveChub2RlLCB0aGlzLnRvQkJveCk7XG4gICAgICAgIGNhbGNCQm94KG5ld05vZGUsIHRoaXMudG9CQm94KTtcblxuICAgICAgICBpZiAobGV2ZWwpIGluc2VydFBhdGhbbGV2ZWwgLSAxXS5jaGlsZHJlbi5wdXNoKG5ld05vZGUpO1xuICAgICAgICBlbHNlIHRoaXMuX3NwbGl0Um9vdChub2RlLCBuZXdOb2RlKTtcbiAgICB9LFxuXG4gICAgX3NwbGl0Um9vdDogZnVuY3Rpb24gKG5vZGUsIG5ld05vZGUpIHtcbiAgICAgICAgLy8gc3BsaXQgcm9vdCBub2RlXG4gICAgICAgIHRoaXMuZGF0YSA9IHtcbiAgICAgICAgICAgIGNoaWxkcmVuOiBbbm9kZSwgbmV3Tm9kZV0sXG4gICAgICAgICAgICBoZWlnaHQ6IG5vZGUuaGVpZ2h0ICsgMVxuICAgICAgICB9O1xuICAgICAgICBjYWxjQkJveCh0aGlzLmRhdGEsIHRoaXMudG9CQm94KTtcbiAgICB9LFxuXG4gICAgX2Nob29zZVNwbGl0SW5kZXg6IGZ1bmN0aW9uIChub2RlLCBtLCBNKSB7XG5cbiAgICAgICAgdmFyIGksIGJib3gxLCBiYm94Miwgb3ZlcmxhcCwgYXJlYSwgbWluT3ZlcmxhcCwgbWluQXJlYSwgaW5kZXg7XG5cbiAgICAgICAgbWluT3ZlcmxhcCA9IG1pbkFyZWEgPSBJbmZpbml0eTtcblxuICAgICAgICBmb3IgKGkgPSBtOyBpIDw9IE0gLSBtOyBpKyspIHtcbiAgICAgICAgICAgIGJib3gxID0gZGlzdEJCb3gobm9kZSwgMCwgaSwgdGhpcy50b0JCb3gpO1xuICAgICAgICAgICAgYmJveDIgPSBkaXN0QkJveChub2RlLCBpLCBNLCB0aGlzLnRvQkJveCk7XG5cbiAgICAgICAgICAgIG92ZXJsYXAgPSBpbnRlcnNlY3Rpb25BcmVhKGJib3gxLCBiYm94Mik7XG4gICAgICAgICAgICBhcmVhID0gYmJveEFyZWEoYmJveDEpICsgYmJveEFyZWEoYmJveDIpO1xuXG4gICAgICAgICAgICAvLyBjaG9vc2UgZGlzdHJpYnV0aW9uIHdpdGggbWluaW11bSBvdmVybGFwXG4gICAgICAgICAgICBpZiAob3ZlcmxhcCA8IG1pbk92ZXJsYXApIHtcbiAgICAgICAgICAgICAgICBtaW5PdmVybGFwID0gb3ZlcmxhcDtcbiAgICAgICAgICAgICAgICBpbmRleCA9IGk7XG5cbiAgICAgICAgICAgICAgICBtaW5BcmVhID0gYXJlYSA8IG1pbkFyZWEgPyBhcmVhIDogbWluQXJlYTtcblxuICAgICAgICAgICAgfSBlbHNlIGlmIChvdmVybGFwID09PSBtaW5PdmVybGFwKSB7XG4gICAgICAgICAgICAgICAgLy8gb3RoZXJ3aXNlIGNob29zZSBkaXN0cmlidXRpb24gd2l0aCBtaW5pbXVtIGFyZWFcbiAgICAgICAgICAgICAgICBpZiAoYXJlYSA8IG1pbkFyZWEpIHtcbiAgICAgICAgICAgICAgICAgICAgbWluQXJlYSA9IGFyZWE7XG4gICAgICAgICAgICAgICAgICAgIGluZGV4ID0gaTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gaW5kZXg7XG4gICAgfSxcblxuICAgIC8vIHNvcnRzIG5vZGUgY2hpbGRyZW4gYnkgdGhlIGJlc3QgYXhpcyBmb3Igc3BsaXRcbiAgICBfY2hvb3NlU3BsaXRBeGlzOiBmdW5jdGlvbiAobm9kZSwgbSwgTSkge1xuXG4gICAgICAgIHZhciBjb21wYXJlTWluWCA9IG5vZGUubGVhZiA/IHRoaXMuY29tcGFyZU1pblggOiBjb21wYXJlTm9kZU1pblgsXG4gICAgICAgICAgICBjb21wYXJlTWluWSA9IG5vZGUubGVhZiA/IHRoaXMuY29tcGFyZU1pblkgOiBjb21wYXJlTm9kZU1pblksXG4gICAgICAgICAgICB4TWFyZ2luID0gdGhpcy5fYWxsRGlzdE1hcmdpbihub2RlLCBtLCBNLCBjb21wYXJlTWluWCksXG4gICAgICAgICAgICB5TWFyZ2luID0gdGhpcy5fYWxsRGlzdE1hcmdpbihub2RlLCBtLCBNLCBjb21wYXJlTWluWSk7XG5cbiAgICAgICAgLy8gaWYgdG90YWwgZGlzdHJpYnV0aW9ucyBtYXJnaW4gdmFsdWUgaXMgbWluaW1hbCBmb3IgeCwgc29ydCBieSBtaW5YLFxuICAgICAgICAvLyBvdGhlcndpc2UgaXQncyBhbHJlYWR5IHNvcnRlZCBieSBtaW5ZXG4gICAgICAgIGlmICh4TWFyZ2luIDwgeU1hcmdpbikgbm9kZS5jaGlsZHJlbi5zb3J0KGNvbXBhcmVNaW5YKTtcbiAgICB9LFxuXG4gICAgLy8gdG90YWwgbWFyZ2luIG9mIGFsbCBwb3NzaWJsZSBzcGxpdCBkaXN0cmlidXRpb25zIHdoZXJlIGVhY2ggbm9kZSBpcyBhdCBsZWFzdCBtIGZ1bGxcbiAgICBfYWxsRGlzdE1hcmdpbjogZnVuY3Rpb24gKG5vZGUsIG0sIE0sIGNvbXBhcmUpIHtcblxuICAgICAgICBub2RlLmNoaWxkcmVuLnNvcnQoY29tcGFyZSk7XG5cbiAgICAgICAgdmFyIHRvQkJveCA9IHRoaXMudG9CQm94LFxuICAgICAgICAgICAgbGVmdEJCb3ggPSBkaXN0QkJveChub2RlLCAwLCBtLCB0b0JCb3gpLFxuICAgICAgICAgICAgcmlnaHRCQm94ID0gZGlzdEJCb3gobm9kZSwgTSAtIG0sIE0sIHRvQkJveCksXG4gICAgICAgICAgICBtYXJnaW4gPSBiYm94TWFyZ2luKGxlZnRCQm94KSArIGJib3hNYXJnaW4ocmlnaHRCQm94KSxcbiAgICAgICAgICAgIGksIGNoaWxkO1xuXG4gICAgICAgIGZvciAoaSA9IG07IGkgPCBNIC0gbTsgaSsrKSB7XG4gICAgICAgICAgICBjaGlsZCA9IG5vZGUuY2hpbGRyZW5baV07XG4gICAgICAgICAgICBleHRlbmQobGVmdEJCb3gsIG5vZGUubGVhZiA/IHRvQkJveChjaGlsZCkgOiBjaGlsZC5iYm94KTtcbiAgICAgICAgICAgIG1hcmdpbiArPSBiYm94TWFyZ2luKGxlZnRCQm94KTtcbiAgICAgICAgfVxuXG4gICAgICAgIGZvciAoaSA9IE0gLSBtIC0gMTsgaSA+PSBtOyBpLS0pIHtcbiAgICAgICAgICAgIGNoaWxkID0gbm9kZS5jaGlsZHJlbltpXTtcbiAgICAgICAgICAgIGV4dGVuZChyaWdodEJCb3gsIG5vZGUubGVhZiA/IHRvQkJveChjaGlsZCkgOiBjaGlsZC5iYm94KTtcbiAgICAgICAgICAgIG1hcmdpbiArPSBiYm94TWFyZ2luKHJpZ2h0QkJveCk7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gbWFyZ2luO1xuICAgIH0sXG5cbiAgICBfYWRqdXN0UGFyZW50QkJveGVzOiBmdW5jdGlvbiAoYmJveCwgcGF0aCwgbGV2ZWwpIHtcbiAgICAgICAgLy8gYWRqdXN0IGJib3hlcyBhbG9uZyB0aGUgZ2l2ZW4gdHJlZSBwYXRoXG4gICAgICAgIGZvciAodmFyIGkgPSBsZXZlbDsgaSA+PSAwOyBpLS0pIHtcbiAgICAgICAgICAgIGV4dGVuZChwYXRoW2ldLmJib3gsIGJib3gpO1xuICAgICAgICB9XG4gICAgfSxcblxuICAgIF9jb25kZW5zZTogZnVuY3Rpb24gKHBhdGgpIHtcbiAgICAgICAgLy8gZ28gdGhyb3VnaCB0aGUgcGF0aCwgcmVtb3ZpbmcgZW1wdHkgbm9kZXMgYW5kIHVwZGF0aW5nIGJib3hlc1xuICAgICAgICBmb3IgKHZhciBpID0gcGF0aC5sZW5ndGggLSAxLCBzaWJsaW5nczsgaSA+PSAwOyBpLS0pIHtcbiAgICAgICAgICAgIGlmIChwYXRoW2ldLmNoaWxkcmVuLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgICAgICAgIGlmIChpID4gMCkge1xuICAgICAgICAgICAgICAgICAgICBzaWJsaW5ncyA9IHBhdGhbaSAtIDFdLmNoaWxkcmVuO1xuICAgICAgICAgICAgICAgICAgICBzaWJsaW5ncy5zcGxpY2Uoc2libGluZ3MuaW5kZXhPZihwYXRoW2ldKSwgMSk7XG5cbiAgICAgICAgICAgICAgICB9IGVsc2UgdGhpcy5jbGVhcigpO1xuXG4gICAgICAgICAgICB9IGVsc2UgY2FsY0JCb3gocGF0aFtpXSwgdGhpcy50b0JCb3gpO1xuICAgICAgICB9XG4gICAgfSxcblxuICAgIF9pbml0Rm9ybWF0OiBmdW5jdGlvbiAoZm9ybWF0KSB7XG4gICAgICAgIC8vIGRhdGEgZm9ybWF0IChtaW5YLCBtaW5ZLCBtYXhYLCBtYXhZIGFjY2Vzc29ycylcblxuICAgICAgICAvLyB1c2VzIGV2YWwtdHlwZSBmdW5jdGlvbiBjb21waWxhdGlvbiBpbnN0ZWFkIG9mIGp1c3QgYWNjZXB0aW5nIGEgdG9CQm94IGZ1bmN0aW9uXG4gICAgICAgIC8vIGJlY2F1c2UgdGhlIGFsZ29yaXRobXMgYXJlIHZlcnkgc2Vuc2l0aXZlIHRvIHNvcnRpbmcgZnVuY3Rpb25zIHBlcmZvcm1hbmNlLFxuICAgICAgICAvLyBzbyB0aGV5IHNob3VsZCBiZSBkZWFkIHNpbXBsZSBhbmQgd2l0aG91dCBpbm5lciBjYWxsc1xuXG4gICAgICAgIC8vIGpzaGludCBldmlsOiB0cnVlXG5cbiAgICAgICAgdmFyIGNvbXBhcmVBcnIgPSBbJ3JldHVybiBhJywgJyAtIGInLCAnOyddO1xuXG4gICAgICAgIHRoaXMuY29tcGFyZU1pblggPSBuZXcgRnVuY3Rpb24oJ2EnLCAnYicsIGNvbXBhcmVBcnIuam9pbihmb3JtYXRbMF0pKTtcbiAgICAgICAgdGhpcy5jb21wYXJlTWluWSA9IG5ldyBGdW5jdGlvbignYScsICdiJywgY29tcGFyZUFyci5qb2luKGZvcm1hdFsxXSkpO1xuXG4gICAgICAgIHRoaXMudG9CQm94ID0gbmV3IEZ1bmN0aW9uKCdhJywgJ3JldHVybiBbYScgKyBmb3JtYXQuam9pbignLCBhJykgKyAnXTsnKTtcbiAgICB9XG59O1xuXG5cbi8vIGNhbGN1bGF0ZSBub2RlJ3MgYmJveCBmcm9tIGJib3hlcyBvZiBpdHMgY2hpbGRyZW5cbmZ1bmN0aW9uIGNhbGNCQm94KG5vZGUsIHRvQkJveCkge1xuICAgIG5vZGUuYmJveCA9IGRpc3RCQm94KG5vZGUsIDAsIG5vZGUuY2hpbGRyZW4ubGVuZ3RoLCB0b0JCb3gpO1xufVxuXG4vLyBtaW4gYm91bmRpbmcgcmVjdGFuZ2xlIG9mIG5vZGUgY2hpbGRyZW4gZnJvbSBrIHRvIHAtMVxuZnVuY3Rpb24gZGlzdEJCb3gobm9kZSwgaywgcCwgdG9CQm94KSB7XG4gICAgdmFyIGJib3ggPSBlbXB0eSgpO1xuXG4gICAgZm9yICh2YXIgaSA9IGssIGNoaWxkOyBpIDwgcDsgaSsrKSB7XG4gICAgICAgIGNoaWxkID0gbm9kZS5jaGlsZHJlbltpXTtcbiAgICAgICAgZXh0ZW5kKGJib3gsIG5vZGUubGVhZiA/IHRvQkJveChjaGlsZCkgOiBjaGlsZC5iYm94KTtcbiAgICB9XG5cbiAgICByZXR1cm4gYmJveDtcbn1cblxuZnVuY3Rpb24gZW1wdHkoKSB7IHJldHVybiBbSW5maW5pdHksIEluZmluaXR5LCAtSW5maW5pdHksIC1JbmZpbml0eV07IH1cblxuZnVuY3Rpb24gZXh0ZW5kKGEsIGIpIHtcbiAgICBhWzBdID0gTWF0aC5taW4oYVswXSwgYlswXSk7XG4gICAgYVsxXSA9IE1hdGgubWluKGFbMV0sIGJbMV0pO1xuICAgIGFbMl0gPSBNYXRoLm1heChhWzJdLCBiWzJdKTtcbiAgICBhWzNdID0gTWF0aC5tYXgoYVszXSwgYlszXSk7XG4gICAgcmV0dXJuIGE7XG59XG5cbmZ1bmN0aW9uIGNvbXBhcmVOb2RlTWluWChhLCBiKSB7IHJldHVybiBhLmJib3hbMF0gLSBiLmJib3hbMF07IH1cbmZ1bmN0aW9uIGNvbXBhcmVOb2RlTWluWShhLCBiKSB7IHJldHVybiBhLmJib3hbMV0gLSBiLmJib3hbMV07IH1cblxuZnVuY3Rpb24gYmJveEFyZWEoYSkgICB7IHJldHVybiAoYVsyXSAtIGFbMF0pICogKGFbM10gLSBhWzFdKTsgfVxuZnVuY3Rpb24gYmJveE1hcmdpbihhKSB7IHJldHVybiAoYVsyXSAtIGFbMF0pICsgKGFbM10gLSBhWzFdKTsgfVxuXG5mdW5jdGlvbiBlbmxhcmdlZEFyZWEoYSwgYikge1xuICAgIHJldHVybiAoTWF0aC5tYXgoYlsyXSwgYVsyXSkgLSBNYXRoLm1pbihiWzBdLCBhWzBdKSkgKlxuICAgICAgICAgICAoTWF0aC5tYXgoYlszXSwgYVszXSkgLSBNYXRoLm1pbihiWzFdLCBhWzFdKSk7XG59XG5cbmZ1bmN0aW9uIGludGVyc2VjdGlvbkFyZWEoYSwgYikge1xuICAgIHZhciBtaW5YID0gTWF0aC5tYXgoYVswXSwgYlswXSksXG4gICAgICAgIG1pblkgPSBNYXRoLm1heChhWzFdLCBiWzFdKSxcbiAgICAgICAgbWF4WCA9IE1hdGgubWluKGFbMl0sIGJbMl0pLFxuICAgICAgICBtYXhZID0gTWF0aC5taW4oYVszXSwgYlszXSk7XG5cbiAgICByZXR1cm4gTWF0aC5tYXgoMCwgbWF4WCAtIG1pblgpICpcbiAgICAgICAgICAgTWF0aC5tYXgoMCwgbWF4WSAtIG1pblkpO1xufVxuXG5mdW5jdGlvbiBjb250YWlucyhhLCBiKSB7XG4gICAgcmV0dXJuIGFbMF0gPD0gYlswXSAmJlxuICAgICAgICAgICBhWzFdIDw9IGJbMV0gJiZcbiAgICAgICAgICAgYlsyXSA8PSBhWzJdICYmXG4gICAgICAgICAgIGJbM10gPD0gYVszXTtcbn1cblxuZnVuY3Rpb24gaW50ZXJzZWN0cyhhLCBiKSB7XG4gICAgcmV0dXJuIGJbMF0gPD0gYVsyXSAmJlxuICAgICAgICAgICBiWzFdIDw9IGFbM10gJiZcbiAgICAgICAgICAgYlsyXSA+PSBhWzBdICYmXG4gICAgICAgICAgIGJbM10gPj0gYVsxXTtcbn1cblxuLy8gc29ydCBhbiBhcnJheSBzbyB0aGF0IGl0ZW1zIGNvbWUgaW4gZ3JvdXBzIG9mIG4gdW5zb3J0ZWQgaXRlbXMsIHdpdGggZ3JvdXBzIHNvcnRlZCBiZXR3ZWVuIGVhY2ggb3RoZXI7XG4vLyBjb21iaW5lcyBzZWxlY3Rpb24gYWxnb3JpdGhtIHdpdGggYmluYXJ5IGRpdmlkZSAmIGNvbnF1ZXIgYXBwcm9hY2hcblxuZnVuY3Rpb24gbXVsdGlTZWxlY3QoYXJyLCBsZWZ0LCByaWdodCwgbiwgY29tcGFyZSkge1xuICAgIHZhciBzdGFjayA9IFtsZWZ0LCByaWdodF0sXG4gICAgICAgIG1pZDtcblxuICAgIHdoaWxlIChzdGFjay5sZW5ndGgpIHtcbiAgICAgICAgcmlnaHQgPSBzdGFjay5wb3AoKTtcbiAgICAgICAgbGVmdCA9IHN0YWNrLnBvcCgpO1xuXG4gICAgICAgIGlmIChyaWdodCAtIGxlZnQgPD0gbikgY29udGludWU7XG5cbiAgICAgICAgbWlkID0gbGVmdCArIE1hdGguY2VpbCgocmlnaHQgLSBsZWZ0KSAvIG4gLyAyKSAqIG47XG4gICAgICAgIHNlbGVjdChhcnIsIGxlZnQsIHJpZ2h0LCBtaWQsIGNvbXBhcmUpO1xuXG4gICAgICAgIHN0YWNrLnB1c2gobGVmdCwgbWlkLCBtaWQsIHJpZ2h0KTtcbiAgICB9XG59XG5cbi8vIEZsb3lkLVJpdmVzdCBzZWxlY3Rpb24gYWxnb3JpdGhtOlxuLy8gc29ydCBhbiBhcnJheSBiZXR3ZWVuIGxlZnQgYW5kIHJpZ2h0IChpbmNsdXNpdmUpIHNvIHRoYXQgdGhlIHNtYWxsZXN0IGsgZWxlbWVudHMgY29tZSBmaXJzdCAodW5vcmRlcmVkKVxuZnVuY3Rpb24gc2VsZWN0KGFyciwgbGVmdCwgcmlnaHQsIGssIGNvbXBhcmUpIHtcbiAgICB2YXIgbiwgaSwgeiwgcywgc2QsIG5ld0xlZnQsIG5ld1JpZ2h0LCB0LCBqO1xuXG4gICAgd2hpbGUgKHJpZ2h0ID4gbGVmdCkge1xuICAgICAgICBpZiAocmlnaHQgLSBsZWZ0ID4gNjAwKSB7XG4gICAgICAgICAgICBuID0gcmlnaHQgLSBsZWZ0ICsgMTtcbiAgICAgICAgICAgIGkgPSBrIC0gbGVmdCArIDE7XG4gICAgICAgICAgICB6ID0gTWF0aC5sb2cobik7XG4gICAgICAgICAgICBzID0gMC41ICogTWF0aC5leHAoMiAqIHogLyAzKTtcbiAgICAgICAgICAgIHNkID0gMC41ICogTWF0aC5zcXJ0KHogKiBzICogKG4gLSBzKSAvIG4pICogKGkgLSBuIC8gMiA8IDAgPyAtMSA6IDEpO1xuICAgICAgICAgICAgbmV3TGVmdCA9IE1hdGgubWF4KGxlZnQsIE1hdGguZmxvb3IoayAtIGkgKiBzIC8gbiArIHNkKSk7XG4gICAgICAgICAgICBuZXdSaWdodCA9IE1hdGgubWluKHJpZ2h0LCBNYXRoLmZsb29yKGsgKyAobiAtIGkpICogcyAvIG4gKyBzZCkpO1xuICAgICAgICAgICAgc2VsZWN0KGFyciwgbmV3TGVmdCwgbmV3UmlnaHQsIGssIGNvbXBhcmUpO1xuICAgICAgICB9XG5cbiAgICAgICAgdCA9IGFycltrXTtcbiAgICAgICAgaSA9IGxlZnQ7XG4gICAgICAgIGogPSByaWdodDtcblxuICAgICAgICBzd2FwKGFyciwgbGVmdCwgayk7XG4gICAgICAgIGlmIChjb21wYXJlKGFycltyaWdodF0sIHQpID4gMCkgc3dhcChhcnIsIGxlZnQsIHJpZ2h0KTtcblxuICAgICAgICB3aGlsZSAoaSA8IGopIHtcbiAgICAgICAgICAgIHN3YXAoYXJyLCBpLCBqKTtcbiAgICAgICAgICAgIGkrKztcbiAgICAgICAgICAgIGotLTtcbiAgICAgICAgICAgIHdoaWxlIChjb21wYXJlKGFycltpXSwgdCkgPCAwKSBpKys7XG4gICAgICAgICAgICB3aGlsZSAoY29tcGFyZShhcnJbal0sIHQpID4gMCkgai0tO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGNvbXBhcmUoYXJyW2xlZnRdLCB0KSA9PT0gMCkgc3dhcChhcnIsIGxlZnQsIGopO1xuICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgIGorKztcbiAgICAgICAgICAgIHN3YXAoYXJyLCBqLCByaWdodCk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoaiA8PSBrKSBsZWZ0ID0gaiArIDE7XG4gICAgICAgIGlmIChrIDw9IGopIHJpZ2h0ID0gaiAtIDE7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBzd2FwKGFyciwgaSwgaikge1xuICAgIHZhciB0bXAgPSBhcnJbaV07XG4gICAgYXJyW2ldID0gYXJyW2pdO1xuICAgIGFycltqXSA9IHRtcDtcbn1cblxuXG4vLyBleHBvcnQgYXMgQU1EL0NvbW1vbkpTIG1vZHVsZSBvciBnbG9iYWwgdmFyaWFibGVcbmlmICh0eXBlb2YgZGVmaW5lID09PSAnZnVuY3Rpb24nICYmIGRlZmluZS5hbWQpIGRlZmluZSgncmJ1c2gnLCBmdW5jdGlvbigpIHsgcmV0dXJuIHJidXNoOyB9KTtcbmVsc2UgaWYgKHR5cGVvZiBtb2R1bGUgIT09ICd1bmRlZmluZWQnKSBtb2R1bGUuZXhwb3J0cyA9IHJidXNoO1xuZWxzZSBpZiAodHlwZW9mIHNlbGYgIT09ICd1bmRlZmluZWQnKSBzZWxmLnJidXNoID0gcmJ1c2g7XG5lbHNlIHdpbmRvdy5yYnVzaCA9IHJidXNoO1xuXG59KSgpO1xuIl19
