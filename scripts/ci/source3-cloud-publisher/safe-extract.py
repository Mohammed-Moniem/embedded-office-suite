"""No archive code executes. Validate the complete inventory before extraction."""
import hashlib, json, os, re, shutil, stat, sys, tarfile, unicodedata, zipfile
from pathlib import Path

def file_hash(stream):
    h = hashlib.sha256()
    while chunk := stream.read(1024 * 1024):
        h.update(chunk)
    return h.hexdigest()

def regular(p):
    for parent in [p, *p.parents]:
        assert not parent.is_symlink(), 'symlink input or ancestor'
    assert p.is_file(), 'regular archive required'

def safe_name(name, kind):
    if kind == 'tar' and name.startswith('./'):
        name = name[2:]
    name = name.rstrip('/')
    assert name and not re.search(r'[\x00-\x1f\x7f<>:"|?*\[\]\\]', name), 'unsafe archive name'
    assert not name.startswith('/'), 'absolute archive path'
    for part in name.split('/'):
        assert part not in ('', '.', '..') and not part.endswith(('.', ' ')), 'unsafe path segment'
        assert not re.match(r'^(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(?:\.|$)', part, re.I), 'reserved device name'
    return name

def extract(kind, archive, destination, digest, size, file_mode='preserve', operation='extract'):
    assert file_mode in ('preserve', '420'), 'unsupported explicit restoration mode'
    assert operation in ('extract', 'inspect'), 'unsupported operation'
    archive = Path(os.path.abspath(archive)); destination = Path(os.path.abspath(destination))
    regular(archive)
    assert archive.stat().st_size == int(size), 'archive size mismatch'
    with archive.open('rb') as f:
        assert file_hash(f) == digest, 'archive hash mismatch'
    for p in [destination, *destination.parents]:
        assert not p.is_symlink(), 'symlink destination ancestor'
    assert not destination.exists(), 'immutable destination exists'
    source = zipfile.ZipFile(archive) if kind == 'zip' else tarfile.open(archive, 'r:gz')
    try:
        entries = source.infolist() if kind == 'zip' else source.getmembers()
        assert 0 < len(entries) <= 65535, 'archive entry limit'
        seen = {}; aliases = {}; inventory = []; total = 0; root_seen = False
        for entry in entries:
            original = entry.filename if kind == 'zip' else entry.name
            if kind == 'tar' and original in ('.', './'):
                assert entry.isdir(), 'invalid root entry'
                assert not root_seen, 'duplicate root entry'
                root_seen = True
                continue
            name = safe_name(original, kind)
            key = unicodedata.normalize('NFC', name).casefold()
            assert key not in seen, 'duplicate or aliased archive member'
            parts = name.split('/')
            for n in range(1, len(parts) + 1):
                prefix = '/'.join(parts[:n]); alias = unicodedata.normalize('NFC', prefix).casefold()
                assert alias not in aliases or aliases[alias] == prefix, 'aliased implicit parent directory'
                aliases[alias] = prefix
            isdir = entry.is_dir() if kind == 'zip' else entry.isdir()
            if kind == 'zip':
                mode = entry.external_attr >> 16
                entry_kind = stat.S_IFMT(mode)
                assert entry_kind in (0, stat.S_IFREG, stat.S_IFDIR), 'nonregular ZIP member'
                assert not mode & 0o7000, 'privileged ZIP mode'
                assert entry_kind == 0 or (entry_kind == stat.S_IFDIR) == isdir, 'ZIP name and type disagree'
                assert not entry.flag_bits & 1 and entry.compress_type in (0, 8), 'unsupported ZIP entry'
                count = entry.file_size
                mode = mode & 0o777 if mode else (0o755 if isdir else 0o644)
                # Windows Actions ZIPs report DOS writable 0666 permissions.
                # The reviewed POSIX restoration used regular files at 0644.
                # Recover that explicit mode to reproduce its native package.
                if not isdir and file_mode == '420':
                    mode = 0o644
            else:
                assert entry.isdir() or entry.isfile(), 'nonregular TAR member'
                assert not entry.pax_headers or all(k in ('mtime', 'atime', 'ctime') for k in entry.pax_headers), 'unexpected TAR extended attributes'
                mode = entry.mode
                assert 0 <= mode <= 0o777, 'privileged archive mode'
                count = entry.size
            assert 0 <= count <= 1024**3, 'member size bound'
            total += count; assert total <= 4 * 1024**3, 'archive expansion bound'
            seen[key] = isdir
            inventory.append((entry, name, isdir, mode, count))
        for _, name, _, _, _ in inventory:
            parts = name.split('/')
            for n in range(1, len(parts)):
                key = unicodedata.normalize('NFC', '/'.join(parts[:n])).casefold()
                assert seen.get(key, True), 'file used as parent directory'
        if operation == 'inspect':
            return
        destination.mkdir(parents=True, exist_ok=False)
        records = []
        for entry, name, isdir, mode, count in inventory:
            target = destination / name
            if isdir:
                target.mkdir(parents=True, exist_ok=True)
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            origin = source.open(entry) if kind == 'zip' else source.extractfile(entry)
            digestor = hashlib.sha256(); written = 0
            with origin, target.open('xb') as output:
                while chunk := origin.read(1024 * 1024):
                    written += len(chunk); assert written <= count, 'member expanded beyond inventory'
                    digestor.update(chunk); output.write(chunk)
            assert written == count, 'truncated archive member'
            os.chmod(target, mode)
            records.append({'path': name, 'bytes': count, 'mode': mode, 'sha256': digestor.hexdigest()})
        for row in records:
            target = destination / row['path']; regular(target)
            assert target.stat().st_size == row['bytes'] and stat.S_IMODE(target.stat().st_mode) == row['mode'], 'restored member metadata mismatch'
            with target.open('rb') as f:
                assert file_hash(f) == row['sha256'], 'restored member hash mismatch'
        with Path(str(destination) + '.inventory.json').open('x') as output:
            json.dump({'archiveSha256': digest, 'files': records}, output, indent=2); output.write('\n')
    finally:
        source.close()

if __name__ == '__main__':
    assert len(sys.argv) in (6, 7, 8) and sys.argv[1] in ('tar', 'zip'), 'arguments: kind archive absent-destination sha256 bytes optional-file-mode optional-operation'
    extract(*sys.argv[1:])
    print('SAFE_ARCHIVE_INVENTORY_INSPECTION_PASS' if len(sys.argv) == 8 and sys.argv[7] == 'inspect' else 'SAFE_EXTRACT_FULL_INVENTORY_HASH_MODE_PASS')
