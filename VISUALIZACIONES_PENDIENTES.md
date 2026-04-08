# Visualizaciones pendientes — Salinas

## Implementadas

| Pestaña | Estado |
|---|---|
| Overview, Fifths, Thirds, Compare, Intervals, Beats | ✅ |
| Consonancia (curva gaussiana + audio + batimentos + zoom + raíz) | ✅ |
| Histograma de consonancia (distribución de 132 intervalos por consonancia teórica) | ✅ |
| Lattice de Euler (red 4×3 quintas × terceras, nodos coloreados por desviación, hover + click) | ✅ |
| Mapa de tríadas (rueda + grid, 24 tríadas coloreadas por pureza, hover + click reproduce) | ✅ |
| Tonnetz, Scatter, Keyboard, Medidor/Tuner | ✅ |

---

## Candidatas

### 2D (más rápidas)

**A. ~~Lattice de Euler~~ ✅ implementado**

**B. ~~Histograma de consonancia~~ ✅ implementado**

**C. ~~Mapa de tríadas~~ ✅ implementado**

**D. Espiral de tonos**
- Espiral cromática (12 posiciones, 1 vuelta = octava)
- Radio = desviación respecto al ET (hacia fuera = sharp, hacia dentro = flat)
- Varias espirales superpuestas para comparar temperamentos
- Visualización polar alternativa al círculo de quintas lineal

### 3D (más ambiciosas)

**E. Tonnetz 3D**
- Tonnetz clásico (quintas × 3as mayores) + tercera dimensión: séptimas menores (7:4)
- Notas como esferas flotando en el espacio; tríadas = triángulos; acordes 7ª = tetraedros
- Navegable: órbita con ratón/táctil, zoom con rueda
- Requiere Three.js (CDN, sin build step)

**F. Espacio de temperamentos 3D**
- Extensión del Scatter actual a 3 ejes:
  - X = RMS desviación quintas
  - Y = RMS desviación terceras mayores
  - Z = RMS desviación séptimas (o tritono)
- Todos los ~3000 temperamentos como puntos en el espacio
- Órbita + zoom + click para seleccionar
- Útil para ver "dónde vive" históricamente un temperamento

---

## Prioridad sugerida

- **Rápida + útil musicalmente**: C (mapa de tríadas) o A (Euler lattice)
- **Rica visualmente**: E (Tonnetz 3D) o F (espacio 3D)
- **Analítica**: ~~B (histograma de consonancia)~~ ✅ → C (mapa de tríadas)
