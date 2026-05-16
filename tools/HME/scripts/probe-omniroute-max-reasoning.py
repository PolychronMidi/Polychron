#!/usr/bin/env python3
import sys
from omniroute_reasoning_config import verify


def main() -> int:
    ok, detail = verify()
    if not ok:
        print(f'omniroute_max_reasoning_probe=fail detail={detail}')
        return 1
    print('omniroute_max_reasoning_probe=ok')
    return 0


if __name__ == '__main__':
    sys.exit(main())
