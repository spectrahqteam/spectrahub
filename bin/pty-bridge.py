#!/usr/bin/env python3
"""A small POSIX PTY bridge: JSON lines in/out, no third-party Python packages."""
import base64
import errno
import fcntl
import json
import os
import pty
import select
import signal
import struct
import sys
import termios
import time


def emit(message):
    sys.stdout.write(json.dumps(message, separators=(',', ':')) + '\n')
    sys.stdout.flush()


def size(fd, rows, cols):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))


def main():
    # Read the first line without Python's buffered stdin: a resize/stop can already
    # be queued behind it, and must remain visible to the nonblocking loop.
    first = bytearray()
    while not first.endswith(b'\n'):
        part = os.read(0, 1)
        if not part:
            return
        first.extend(part)
        if len(first) > 65536:
            raise ValueError('invalid PTY startup message')
    options = json.loads(first)
    pid, master = pty.fork()
    if pid == 0:
        os.chdir(options['cwd'])
        size(0, options['rows'], options['cols'])
        os.execvpe(options['command'], [options['command']] + options['args'], os.environ)
    os.set_blocking(master, False)
    os.set_blocking(0, False)
    size(master, options['rows'], options['cols'])
    incoming = b''
    pending = bytearray()
    stopped = False
    deadline = None
    status = None
    shell_exit_deadline = None

    def signal_groups(sig):
        groups = {pid}
        try:
            groups.add(os.tcgetpgrp(master))
        except OSError:
            pass
        for group in groups:
            try:
                # During startup the child may not have acquired the controlling
                # terminal yet. Never signal a group from our parent's session.
                if group > 0 and os.getsid(group) == pid:
                    os.killpg(group, sig)
            except (ProcessLookupError, OSError):
                pass

    def stop(_sig=None, _frame=None):
        nonlocal stopped, deadline
        if not stopped:
            stopped = True
            deadline = time.monotonic() + 2
            signal_groups(signal.SIGHUP)

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    try:
        emit({'type': 'ready', 'pid': pid})
        while True:
            readers, writers, _ = select.select([master, 0] if not stopped else [master], [master] if pending else [], [], 0.1)
            if 0 in readers:
                chunk = os.read(0, 65536)
                if not chunk:
                    stop()
                incoming += chunk
                while b'\n' in incoming:
                    line, incoming = incoming.split(b'\n', 1)
                    try:
                        message = json.loads(line)
                        if message['type'] == 'input':
                            pending.extend(base64.b64decode(message['data'], validate=True))
                        elif message['type'] == 'resize':
                            size(master, message['rows'], message['cols'])
                        elif message['type'] == 'stop':
                            stop()
                    except (KeyError, ValueError, TypeError):
                        emit({'type': 'error', 'message': 'invalid bridge message'})
                if len(incoming) > 262144 or len(pending) > 1048576:
                    stop()
            if master in writers and pending:
                try:
                    count = os.write(master, pending)
                    del pending[:count]
                except BlockingIOError:
                    pass
            if master in readers:
                try:
                    chunk = os.read(master, 65536)
                except OSError as error:
                    if error.errno == errno.EIO:
                        break
                    raise
                if not chunk:
                    break
                emit({'type': 'data', 'data': base64.b64encode(chunk).decode('ascii')})
            if deadline and time.monotonic() > deadline:
                signal_groups(signal.SIGKILL)
                deadline = None
            if status is None:
                waited, result = os.waitpid(pid, os.WNOHANG)
                if waited:
                    status = result
                    # Drain the last output, but do not wait indefinitely for a
                    # background job that inherited the terminal descriptor.
                    shell_exit_deadline = time.monotonic() + 0.2
            if shell_exit_deadline and time.monotonic() > shell_exit_deadline:
                break
    finally:
        # Also covers a broken parent pipe: never wait indefinitely for a shell
        # that ignores HUP when the bridge can no longer report its output.
        signal_groups(signal.SIGKILL)
        os.close(master)
        if status is None:
            _, status = os.waitpid(pid, 0)
    emit({'type': 'exit', 'code': os.waitstatus_to_exitcode(status)})


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        emit({'type': 'error', 'message': str(error)})
        sys.exit(1)
