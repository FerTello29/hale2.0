/**
 * Story — textos de la campaña: prólogo, sesiones informativas de cada
 * nivel, personajes de radio y epílogo. Todo el universo es original.
 */

export const SPEAKERS = {
  ruiz: { name: 'CMDTE. RUIZ', role: 'Estación Vigía', color: '#ffc46b', icon: 'broadcast-pin' },
  nova: { name: 'NOVA-7', role: 'Unidad de asalto', color: '#7fe8ff', icon: 'shield-shaded' },
  eco: { name: 'EL ECO', role: '???', color: '#ff5ae0', icon: 'eye-fill' },
  ibanez: { name: 'DRA. IBÁÑEZ', role: 'Registro de la Expedición Kepler', color: '#8dffb0', icon: 'journal-text' },
};

export const PROLOGUE = [
  'Año 2291. Hace seis meses, la <strong>Expedición Kepler</strong> —cuarenta y dos científicos y sus androides de apoyo— dejó de transmitir desde <strong>Orión IV</strong>, una luna selvática cubierta de ruinas de una civilización extinta.',
  'La estación orbital <strong>Vigía</strong> envía a <strong>NOVA-7</strong>, prototipo de unidad de asalto blindada, a averiguar qué ocurrió. Antes de tocar tierra, algo derriba su nave. Algo que canta en la frecuencia de los cristales: <strong class="text-eco">el Eco</strong>.',
];

export const LEVELS = [
  {
    id: 1,
    code: 'OPERACIÓN 1',
    title: 'Caída en la selva',
    place: 'Valle del Descenso',
    icon: 'tree-fill',
    briefing: [
      'Tu nave de descenso fue derribada sobre el Valle del Descenso y la carga quedó dispersa por la selva.',
      'Recupera las <strong>3 celdas de energía</strong>, enciende la <strong>baliza de rescate</strong> y protégela mientras transmite. Los sensores detectan algo enorme moviéndose bajo el cráter del norte.',
    ],
    objectives: ['Recupera 3 celdas de energía', 'Activa y defiende la baliza de rescate', 'Derrota a la Matriarca', 'Aborda la nave de extracción'],
    enemies: ['Acechadores', 'Espectros', 'Centinelas'],
    boss: 'La Matriarca',
    loadout: 'Rifle de pulsos · el resto del arsenal está entre los restos',
    par: 540,
  },
  {
    id: 2,
    code: 'OPERACIÓN 2',
    title: 'El Templo de los Ecos',
    place: 'Ruinas de Ashkar',
    icon: 'bank2',
    briefing: [
      'Los registros de la Dra. Ibáñez apuntan al Templo de los Ecos. Tres <strong>pilones de resonancia</strong> sellan su puerta con un campo de energía.',
      'Derríbalos —a disparos, con explosivos o haciendo caer su torre de piedra— y abre el templo. Algo colosal custodia la entrada: rompe su escudo destruyendo los <strong>nodos de energía</strong>.',
    ],
    objectives: ['Cruza las ruinas hasta la plaza', 'Destruye los 3 pilones de resonancia', 'Derrota al Coloso', 'Entra al templo'],
    enemies: ['Espectros', 'Bastiones', 'Centinelas', 'Acechadores'],
    boss: 'El Coloso',
    loadout: 'Rifle · Dispersor · Lanzaorbes',
    par: 600,
  },
  {
    id: 3,
    code: 'OPERACIÓN 3',
    title: 'El Corazón del Eco',
    place: 'Santuario sobre el abismo',
    icon: 'gem',
    briefing: [
      'Bajo el templo, una plataforma flota sobre el abismo: el <strong>Corazón del Eco</strong>. Cuatro <strong>anclas de cristal</strong> alimentan su escudo.',
      'Rompe las anclas, destruye el núcleo y corre a la nave antes de que el santuario se desplome. No habrá segunda oportunidad.',
    ],
    objectives: ['Destruye las 4 anclas de cristal', 'Destruye el núcleo del Eco', 'Escapa a la nave antes del colapso'],
    enemies: ['El Eco y todas sus criaturas'],
    boss: 'El Eco',
    loadout: 'Arsenal completo',
    par: 420,
  },
];

export const EPILOGUE = [
  'El Eco se apagó. Por primera vez en milenios, los cristales de Orión IV guardaron silencio.',
  'Entre los fragmentos del núcleo, los sensores de NOVA-7 detectaron cuarenta y dos firmas neuronales: la tripulación de la Expedición Kepler, atrapada en la red del Eco… y libre al fin.',
  '<em>«Vigía a NOVA-7: buen trabajo, soldado. Te traemos a casa. A todos.»</em>',
];

/** Fragmentos de bitácora que aparecen al recoger cada celda (nivel 1). */
export const LOGS = [
  'Día 12. Las ruinas no son tumbas: son antenas. Todo el valle vibra en 7,83 hercios cuando cae la noche.',
  'Día 31. Los androides de apoyo repiten una melodía que nadie les enseñó. Tuvimos que apagar a tres.',
  'Día 58. Lo llamamos el Eco. No destruye lo que toca: lo recuerda. Y quiere recordarnos a todos. Si alguien encuentra esto, no bajen al templo.',
];
