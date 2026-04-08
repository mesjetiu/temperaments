# Visualizaciones pendientes — Salinas

## Implementadas

| Pestaña | Estado |
|---|---|
| Overview, Fifths, Thirds, Compare, Intervals, Beats | ✅ |
| Consonancia (curva gaussiana + audio + batimentos + zoom + raíz) | ✅ |
| Tonnetz, Scatter, Keyboard, Medidor/Tuner | ✅ |

---

## Candidatas

### 2D (más rápidas)

**A. Lattice de Euler (red de quintas × terceras)**
- Red 2D: eje X = quintas sucesivas, eje Y = terceras mayores
- Nodos = notas del temperamento, coloreados por desviación respecto a justo
- Aristas = intervalos, con grosor/color según pureza
- Interactivo: hover → info Hz + cents; click → reproduce nota
- Sin dependencias externas, canvas 2D

**B. Histograma de consonancia**
- Distribución de los 132 intervalos del temperamento agrupados por consonancia teórica
- Comparativa superpuesta entre varios temperamentos seleccionados
- Muestra si el temperamento "concentra" consonancias o las dispersa

**C. Mapa de tríadas**
- Rueda o grid con las 24 tríadas (12 mayores + 12 menores)
- Color = pureza de la tríada (desviación combinada de 3ª y 5ª)
- Click → reproduce la tríada
- Complementa el Tonnetz con datos cuantitativos de pureza

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
- **Analítica**: B (histograma de consonancia)
