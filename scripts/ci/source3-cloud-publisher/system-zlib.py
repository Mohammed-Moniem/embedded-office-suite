"""Bounded raw-DEFLATE bridge to the existing macOS system zlib; no fallback."""
import ctypes as C
import json
import sys

LIBRARY = '/usr/lib/libz.1.dylib'
EXPECTED_VERSION = b'1.2.12'
INPUT_CHUNK = 65536
OUTPUT_CHUNK = 16384

class Stream(C.Structure):
    _fields_ = [('next_in', C.c_void_p), ('avail_in', C.c_uint), ('total_in', C.c_ulong),
                ('next_out', C.c_void_p), ('avail_out', C.c_uint), ('total_out', C.c_ulong),
                ('msg', C.c_void_p), ('state', C.c_void_p), ('zalloc', C.c_void_p),
                ('zfree', C.c_void_p), ('opaque', C.c_void_p), ('data_type', C.c_int),
                ('adler', C.c_ulong), ('reserved', C.c_ulong)]

def library():
    assert sys.platform == 'darwin' and C.sizeof(C.c_void_p) == 8 and C.sizeof(Stream) == 112, 'unsupported ABI'
    lib = C.CDLL(LIBRARY)
    lib.zlibVersion.argtypes = []; lib.zlibVersion.restype = C.c_char_p
    assert lib.zlibVersion() == EXPECTED_VERSION, 'system zlib version is not admitted'
    lib.deflateInit2_.argtypes = [C.POINTER(Stream), C.c_int, C.c_int, C.c_int, C.c_int, C.c_int, C.c_char_p, C.c_int]
    lib.deflateInit2_.restype = C.c_int
    lib.deflate.argtypes = [C.POINTER(Stream), C.c_int]; lib.deflate.restype = C.c_int
    lib.deflateEnd.argtypes = [C.POINTER(Stream)]; lib.deflateEnd.restype = C.c_int
    return lib

def encode(lib):
    state = Stream()
    assert lib.deflateInit2_(C.byref(state), 9, 8, -15, 8, 0, EXPECTED_VERSION, C.sizeof(Stream)) == 0, 'deflate initialization failed'
    output = C.create_string_buffer(OUTPUT_CHUNK)
    try:
        while True:
            data = sys.stdin.buffer.read(INPUT_CHUNK)
            finishing = not data
            origin = C.create_string_buffer(data) if data else None
            state.next_in = C.cast(origin, C.c_void_p) if origin is not None else None
            state.avail_in = len(data)
            while True:
                state.next_out = C.cast(output, C.c_void_p); state.avail_out = OUTPUT_CHUNK
                status = lib.deflate(C.byref(state), 4 if finishing else 0)
                assert status in (0, 1), 'deflate operation failed'
                count = OUTPUT_CHUNK - state.avail_out
                if count:
                    sys.stdout.buffer.write(output.raw[:count])
                if status == 1:
                    assert finishing and state.avail_in == 0, 'unexpected stream end'
                    sys.stdout.buffer.flush(); return
                if not finishing and state.avail_in == 0 and state.avail_out != 0:
                    break
                assert count or state.avail_in, 'deflate made no progress'
    finally:
        assert lib.deflateEnd(C.byref(state)) == 0, 'deflate finalization failed'

if __name__ == '__main__':
    try:
        assert sys.argv[1:] in ([], ['--identity']), 'unsupported arguments'
        lib = library()
        if sys.argv[1:] == ['--identity']:
            print(json.dumps({'library': LIBRARY, 'runtimeZlib': lib.zlibVersion().decode('ascii'), 'streamBytes': C.sizeof(Stream), 'level': 9, 'method': 8, 'windowBits': -15, 'memLevel': 8, 'strategy': 0, 'inputChunk': INPUT_CHUNK, 'outputChunk': OUTPUT_CHUNK}))
        else:
            encode(lib)
    except Exception:
        print('SYSTEM_ZLIB_BRIDGE_FAILED_CLOSED', file=sys.stderr)
        sys.exit(1)
