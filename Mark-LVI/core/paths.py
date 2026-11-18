"""Resolução de caminhos do Mark LVI.

Dois conceitos diferentes que por muito tempo foram a mesma coisa ("BASE_DIR"):

- ``resource_base_dir()`` — recursos empacotados e somente leitura
  (``core/prompt.txt``, ``actions/``, ``plugins/``, ``dashboard/static/``).
  No build PyInstaller é a pasta do executável; em desenvolvimento, a raiz
  do repositório.
- ``data_dir()`` — dados graváveis do usuário (``config/``, ``memory/``,
  ``uploads/``). Por padrão é a mesma pasta do executável (comportamento
  histórico), mas pode ser redirecionada pela variável de ambiente
  ``MARK_LVI_HOME``. O Kolnd Hub define ``MARK_LVI_HOME=%APPDATA%/kolnd-hub/mark-lvi``
  ao iniciar o Mark LVI para que a chave de API e a memória nunca dependam
  de a pasta de instalação ser gravável nem sumam junto com o app.
"""

import os
import sys
from pathlib import Path


def resource_base_dir() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    # core/paths.py -> raiz do repositório (pasta acima de core/)
    return Path(__file__).resolve().parent.parent


def data_dir() -> Path:
    home = os.environ.get("MARK_LVI_HOME")
    if home:
        return Path(home).expanduser()
    return resource_base_dir()
