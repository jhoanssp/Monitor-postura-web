#!/usr/bin/env python3
"""
Genera un archivo PROYECTO_COMPLETO.txt con la estructura de carpetas
y el contenido de todos los archivos de texto del proyecto.
Manejo inteligente para archivos CSV (solo muestra una muestra).
"""

import os
import sys
from pathlib import Path

# Extensiones de archivos de texto
EXTENSIONES_TEXTO = {
    '.py', '.txt', '.md', '.json', '.yml', '.yaml', '.toml', '.ini',
    '.cfg', '.conf', '.sh', '.env', '.gitignore', '.requirements', '.csv'
}

# Carpetas y archivos a omitir por completo
IGNORAR_NOMBRES = {
    '.git', '__pycache__', 'build', 'dist', 'venv', 'env', 
    '.idea', '.vscode', '.mypy_cache', '.pytest_cache'
}

def listar_archivos(raiz: Path, salida_txt: Path) -> list:
    """Recorre el directorio ignorando carpetas pesadas y extensiones binarias."""
    archivos_validos = []
    salida_absoluta = salida_txt.resolve()

    for root, dirs, files in os.walk(raiz):
        # Evitar entrar en carpetas ignoradas
        dirs[:] = [d for d in dirs if d not in IGNORAR_NOMBRES]
        
        ruta_dir = Path(root)
        for f in files:
            ruta_archivo = ruta_dir / f
            
            # Saltar el archivo de salida
            if ruta_archivo.resolve() == salida_absoluta:
                continue
                
            # Validar extensión (los .pkl se descartan automáticamente al no estar en EXTENSIONES_TEXTO)
            if ruta_archivo.suffix.lower() in EXTENSIONES_TEXTO:
                nombre_rel = ruta_archivo.relative_to(raiz)
                archivos_validos.append(nombre_rel)
                
    return sorted(archivos_validos)

def leer_contenido(ruta_archivo: Path) -> str:
    """Lee el contenido. Si es un CSV, solo extrae las primeras líneas como muestra."""
    try:
        # Optimización para archivos CSV gigantes
        if ruta_archivo.suffix.lower() == '.csv':
            lineas_muestra = []
            with open(ruta_archivo, 'r', encoding='utf-8') as f:
                for _ in range(5): # Tomar solo la cabecera y 4 filas de ejemplo
                    linea = f.readline()
                    if not linea:
                        break
                    lineas_muestra.append(linea)
            
            contenido_previo = "".join(lineas_muestra)
            return contenido_previo + "[... El resto del archivo CSV ha sido omitido para optimizar espacio ...]\n"
        
        # Lectura normal para scripts de python, json, txt, etc.
        return ruta_archivo.read_text(encoding='utf-8')
        
    except (UnicodeDecodeError, PermissionError, IsADirectoryError):
        return "[Contenido binario o no legible, omitido]\n"

def generar_txt(raiz: Path, salida: Path):
    """Genera el archivo de salida con la estructura y contenidos."""
    print(f"Escaneando: {raiz.resolve()}")
    archivos_rel = listar_archivos(raiz, salida)
    print(f"Archivos encontrados (filtrados): {len(archivos_rel)}")

    with open(salida, 'w', encoding='utf-8') as f:
        # === ESTRUCTURA DE CARPETAS ===
        f.write("=== ESTRUCTURA DE CARPETAS ===\n")
        for r in archivos_rel:
            f.write(f"./{r.as_posix()}\n")
        # Añadir mención explícita de los archivos .pkl en la estructura para que la IA sepa que existen
        f.write("./modelo_frontal/modelo_postura.pkl (Archivo binario - Omitido)\n")
        f.write("./modelo_frontal/scaler_postura.pkl (Archivo binario - Omitido)\n")
        f.write("./modelo_lateral/modelo_postura.pkl (Archivo binario - Omitido)\n")
        f.write("./modelo_lateral/scaler_postura.pkl (Archivo binario - Omitido)\n")
        f.write("\n")

        # === CONTENIDO DE ARCHIVOS ===
        f.write("=== CONTENIDO DE ARCHIVOS ===\n\n")
        for r in archivos_rel:
            ruta_completa = raiz / r
            if ruta_completa.is_file():
                f.write(f"--- ./{r.as_posix()} ---\n")
                contenido = leer_contenido(ruta_completa)
                f.write(contenido)
                if not contenido.endswith('\n'):
                    f.write('\n')
                f.write("\n")
    print(f"Archivo generado con éxito: {salida.resolve()}")

def main():
    args = sys.argv[1:]
    ruta_base = Path(args[0]).resolve() if len(args) >= 1 else Path.cwd().resolve()
    nombre_salida = args[1] if len(args) >= 2 else "PROYECTO_COMPLETO.txt"

    if not ruta_base.is_dir():
        print(f"Error: '{ruta_base}' no es un directorio válido.")
        sys.exit(1)

    salida_path = Path(nombre_salida)
    if salida_path.resolve() == ruta_base:
        print("Error: el archivo de salida no puede ser el mismo directorio raíz.")
        sys.exit(1)

    generar_txt(ruta_base, salida_path)

if __name__ == "__main__":
    main()
