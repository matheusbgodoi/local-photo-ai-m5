/**
 * Conservative pt-BR -> EN normaliser for photographic briefs.
 *
 * Why this exists: Z-Image's text encoder is multilingual, but its photographic
 * vocabulary is overwhelmingly English. A Portuguese brief still renders, just
 * less precisely — "jaleco branco" is far weaker than "white lab coat".
 *
 * This is semantic normalisation into natural photographic English, not literal
 * translation: idioms are mapped whole ("sem aparência de stock photo" ->
 * "not looking like a stock photo") rather than word by word, because a
 * half-translated brief is worse than either language on its own.
 *
 * Why it is *conservative*: rule 14 of the brief — enhancement must never
 * change semantics. So this is a dictionary, not a paraphraser. It preserves
 * grammatical gender ("médica" -> "female doctor", not "doctor"), preserves
 * number, and leaves anything it does not recognise untouched rather than
 * guessing. Coverage is reported so the caller can see how much was actually
 * translated.
 *
 * Everything here is offline and deterministic.
 */

export interface TranslationResult {
  text: string;
  /** Fraction of content words that were recognised, 0..1. */
  coverage: number;
  /** True when the input looked like Portuguese at all. */
  wasPortuguese: boolean;
  unknown: string[];
}

/** Strip diacritics for matching only — output keeps dictionary spelling. */
function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * Multi-word entries. Matched longest-first, so "sala de espera" wins over
 * "sala". Keys are diacritic-folded.
 */
const PHRASES: Record<string, string> = {
  // --- settings -----------------------------------------------------------
  "sala de espera": "waiting room",
  "sala de estar": "living room",
  "sala de reuniao": "meeting room",
  "sala de reunioes": "meeting room",
  "sala de aula": "classroom",
  "sala de exame": "exam room",
  "centro cirurgico": "operating room",
  "sala de cirurgia": "operating room",
  "pronto socorro": "emergency room",
  "pronto-socorro": "emergency room",
  "unidade de terapia intensiva": "intensive care unit",
  "posto de enfermagem": "nursing station",
  "consultorio medico": "doctor's office",
  "consultorio odontologico": "dental office",
  "sala de atendimento": "consultation room",
  "sala de triagem": "triage room",
  "clinica medica": "medical clinic",
  "clinica moderna": "modern clinic",
  "centro medico": "medical center",
  "hospital publico": "public hospital",
  "hospital particular": "private hospital",
  "hospital universitario": "teaching hospital",
  "posto de saude": "public health clinic",
  "unidade basica de saude": "public primary care clinic",
  "rede publica": "public health system",
  "saude publica": "public health",
  "leito hospitalar": "hospital bed",
  "espaco de coworking": "coworking space",
  "escritorio moderno": "modern office",
  "home office": "home office",
  "mesa de escritorio": "office desk",
  "mesa de trabalho": "work desk",
  "mesa de jantar": "dining table",
  "mesa de reuniao": "conference table",
  "area comum": "common area",
  "ambiente clinico": "clinical setting",
  "ambiente hospitalar": "hospital setting",
  "ambiente de trabalho": "workplace",
  "ambiente corporativo": "corporate setting",
  "em casa": "at home",
  "sem pessoas": "without people",
  "sem ninguem": "without people",
  "vazia": "empty",
  "vazio": "empty",
  "sobre uma mesa de escritorio": "on an office desk",
  "sobre a mesa de escritorio": "on the office desk",
  "em uma mesa de escritorio": "on an office desk",
  "na mesa de escritorio": "on the office desk",
  "sobre uma mesa de madeira": "on a wooden table",
  "anos de idade": "years old",

  // --- people -------------------------------------------------------------
  "profissional de saude": "healthcare professional",
  "profissionais de saude": "healthcare professionals",
  "equipe medica": "medical team",
  "agente de saude": "community health worker",
  "paciente idosa": "elderly female patient",
  "paciente idoso": "elderly male patient",
  "senhora idosa": "elderly woman",
  "senhor idoso": "elderly man",
  "casal idoso": "elderly couple",
  "casal de idosos": "elderly couple",
  "mulher idosa": "elderly woman",
  "homem idoso": "elderly man",
  "pessoa idosa": "elderly person",
  "pessoas idosas": "elderly people",
  "mulher de meia idade": "middle-aged woman",
  "homem de meia idade": "middle-aged man",
  "meia idade": "middle-aged",
  "meia-idade": "middle-aged",
  "jovem adulto": "young adult man",
  "jovem adulta": "young adult woman",

  // --- actions ------------------------------------------------------------
  "olhando para a camera": "looking at the camera",
  "olhando para camera": "looking at the camera",
  "olhando um para o outro": "looking at each other",
  "nao olhando para a camera": "not looking at the camera",
  "sem olhar para a camera": "not looking at the camera",
  "sem olhar para camera": "not looking at the camera",
  "sem encarar a camera": "not looking at the camera",
  "sem todos olhando para a camera": "with only some of them looking at the camera",
  "nem todos olhando para a camera": "with only some of them looking at the camera",
  "ninguem olhando para a camera": "nobody looking at the camera",
  "de costas": "seen from behind",
  "de perfil": "in profile",
  "em pe": "standing",
  "sentado a mesa": "sitting at a desk",
  "sentada a mesa": "sitting at a desk",
  "medindo a pressao": "measuring blood pressure",
  "aferindo a pressao": "measuring blood pressure",
  // "atendimento" is the everyday word for the act of seeing a patient; the
  // natural English is a consultation, not "attendance".
  "em atendimento": "during a consultation",
  "durante o atendimento": "during the consultation",
  "no atendimento": "during the consultation",
  "atendimento medico": "medical consultation",
  "atendimento ao paciente": "patient care",
  "atendimento humanizado": "attentive, humane patient care",
  "tomando notas": "taking notes",
  "fazendo anotacoes": "taking notes",
  "tirando duvidas": "answering questions",
  "prestando atencao": "paying attention",
  "conversando com": "talking with",
  "falando com": "talking with",
  "olhando para": "looking at",
  "apoiado em": "resting on",
  "apoiada em": "resting on",
  "ao lado de": "next to",
  "perto de": "near",
  "em frente a": "in front of",
  "atras de": "behind",
  "dentro de": "inside",
  "em cima de": "on top of",
  "em cima da": "on top of the",
  "em cima do": "on top of the",
  "sobre a mesa": "on the table",
  "sobre uma mesa": "on a table",
  "em uma mesa": "on a table",
  "na mesa": "on the table",

  // --- light --------------------------------------------------------------
  "luz natural": "natural light",
  "luz da janela": "window light",
  "luz do sol": "sunlight",
  "luz suave": "soft light",
  "luz dura": "hard light",
  "luz fria": "cool light",
  "luz quente": "warm light",
  "luz artificial": "artificial light",
  "luz ambiente": "ambient light",
  "luz fluorescente": "fluorescent light",
  "luz fluorescente de teto": "overhead fluorescent light",
  "luz de teto": "ceiling light",
  "luz do teto": "ceiling light",
  "luz natural lateral": "natural light from the side",
  "luz lateral": "side light",
  "misturada com luz natural lateral": "mixed with natural light from the side",
  "misturado com luz natural lateral": "mixed with natural light from the side",
  "misturada com": "mixed with",
  "misturado com": "mixed with",
  "hora dourada": "golden hour",
  "final de tarde": "late afternoon",
  "fim de tarde": "late afternoon",
  "de manha": "in the morning",
  "a tarde": "in the afternoon",
  "a noite": "at night",

  // --- craft: how the photograph itself is described -----------------------
  "fotografia documental": "documentary photograph",
  "foto documental": "documentary photograph",
  "estilo documental": "documentary style",
  "fotografia jornalistica": "photojournalistic photograph",
  "foto jornalistica": "photojournalistic photograph",
  "fotografia publicitaria": "advertising photograph",
  "fotografia de produto": "product photograph",
  "foto de produto": "product photograph",
  "banco de imagens": "stock photo library",
  "profundidade de campo": "depth of field",
  "corpo inteiro": "full body",
  "meio corpo": "waist up",
  "plano aberto": "wide shot",
  "plano fechado": "close-up",
  "plano medio": "medium shot",
  "primeiro plano": "foreground",
  "segundo plano": "background",
  "altura dos olhos": "at eye level",
  "visto de cima": "seen from above",
  "visto de baixo": "seen from below",

  // --- realism clauses ----------------------------------------------------
  // These carry the whole point of the brief, so a half-translated version
  // ("without retoque of beleza") is worse than useless.
  "pele com textura normal": "skin with ordinary texture",
  "pele com textura real": "skin with real texture",
  "textura de pele": "skin texture",
  "textura normal": "ordinary texture",
  "retoque de beleza": "beauty retouching",
  "sem retoque de beleza": "no beauty retouching",
  "sem retoque": "no retouching",
  "sem retoques": "no retouching",
  "sem maquiagem": "without makeup",
  "sem filtro": "without filters",
  "sem filtros": "without filters",
  "sem pose": "not posing",
  "sem posar": "not posing",
  "sem aparencia de stock photo": "not looking like a stock photo",
  "sem cara de stock photo": "not looking like a stock photo",
  "sem parecer stock photo": "not looking like a stock photo",
  "aparencia de stock photo": "the look of a stock photo",
  "linhas finas": "fine lines",
  "linhas de expressao": "expression lines",
  "pequenas imperfeicoes": "small imperfections",
  "imperfeicoes naturais": "natural imperfections",
  "usado normalmente": "worn normally",
  "usada normalmente": "worn normally",
  "uso normal": "ordinary use",
  "dia a dia": "everyday",
  "no dia a dia": "in everyday use",

  // --- objects ------------------------------------------------------------
  "aparelho de pressao": "blood pressure monitor",
  "medidor de pressao": "blood pressure monitor",
  "equipamento medico": "medical equipment",
  "equipamentos medicos": "medical equipment",
  "aparelho de ultrassom": "ultrasound machine",
  "maca hospitalar": "hospital bed",
  "cama hospitalar": "hospital bed",
  "jaleco branco": "white lab coat",
  "oculos de grau": "prescription glasses",
  "cracha de identificacao": "id badge",
  "prontuario eletronico": "electronic medical record",
  "ficha medica": "medical chart",
  "celular na mao": "phone in hand",
  "tela do celular": "phone screen",
  "tela do notebook": "laptop screen",
  "xicara de cafe": "cup of coffee",
  "caneca de cafe": "coffee mug",
  "cartao de visita": "business card",
  "fone de ouvido": "headphones",
  "fones de ouvido": "headphones",
};

/** Single-token dictionary. Keys are diacritic-folded. */
const WORDS: Record<string, string> = {
  // --- articles, prepositions, connectors ---------------------------------
  o: "the",
  a: "the",
  os: "the",
  as: "the",
  um: "a",
  uma: "a",
  uns: "some",
  umas: "some",
  de: "of",
  do: "of the",
  da: "of the",
  dos: "of the",
  das: "of the",
  em: "in",
  no: "in the",
  na: "in the",
  nos: "in the",
  nas: "in the",
  num: "in a",
  numa: "in a",
  ao: "to the",
  aos: "to the",
  com: "with",
  sem: "without",
  para: "for",
  pra: "for",
  por: "by",
  entre: "between",
  sobre: "on",
  sob: "under",
  durante: "during",
  enquanto: "while",
  e: "and",
  ou: "or",
  que: "that",
  nao: "not",
  seu: "his",
  sua: "her",
  seus: "their",
  suas: "their",
  este: "this",
  esta: "this",
  esse: "that",
  essa: "that",
  dois: "two",
  duas: "two",
  tres: "three",
  quatro: "four",
  cinco: "five",
  varios: "several",
  varias: "several",
  alguns: "some",
  algumas: "some",
  muitos: "many",
  muitas: "many",
  todos: "all",
  todas: "all",
  ninguem: "nobody",
  cada: "each",
  outro: "another",
  outra: "another",

  // --- people -------------------------------------------------------------
  pessoa: "person",
  pessoas: "people",
  homem: "man",
  homens: "men",
  mulher: "woman",
  mulheres: "women",
  menino: "boy",
  menina: "girl",
  crianca: "child",
  criancas: "children",
  adolescente: "teenager",
  bebe: "baby",
  jovem: "young person",
  jovens: "young people",
  adulto: "adult man",
  adulta: "adult woman",
  adultos: "adults",
  idoso: "elderly man",
  idosa: "elderly woman",
  idosos: "elderly people",
  idosas: "elderly women",
  senhor: "older man",
  senhora: "older woman",
  vovo: "grandparent",
  avo: "grandparent",
  avos: "grandparents",
  casal: "couple",
  familia: "family",
  familias: "families",
  grupo: "group",
  equipe: "team",
  time: "team",
  colegas: "colleagues",
  amigos: "friends",
  amigas: "friends",
  pai: "father",
  mae: "mother",
  pais: "parents",
  filho: "son",
  filha: "daughter",
  filhos: "children",
  neto: "grandson",
  neta: "granddaughter",
  netos: "grandchildren",

  // --- professions --------------------------------------------------------
  medico: "male doctor",
  medica: "female doctor",
  medicos: "doctors",
  medicas: "female doctors",
  doutor: "male doctor",
  doutora: "female doctor",
  enfermeiro: "male nurse",
  enfermeira: "female nurse",
  enfermeiros: "nurses",
  dentista: "dentist",
  fisioterapeuta: "physical therapist",
  nutricionista: "nutritionist",
  psicologo: "male psychologist",
  psicologa: "female psychologist",
  cirurgiao: "male surgeon",
  cirurgia: "surgeon",
  farmaceutico: "male pharmacist",
  farmaceutica: "female pharmacist",
  tecnico: "technician",
  recepcionista: "receptionist",
  secretaria: "assistant",
  atendente: "front desk attendant",
  paciente: "patient",
  pacientes: "patients",
  cliente: "client",
  clientes: "clients",
  funcionario: "male employee",
  funcionaria: "female employee",
  funcionarios: "employees",
  colaborador: "team member",
  colaboradores: "team members",
  cuidador: "male caregiver",
  cuidadora: "female caregiver",
  acompanhante: "companion",
  profissional: "professional",
  profissionais: "professionals",
  executivo: "male executive",
  executiva: "female executive",
  gerente: "manager",
  diretor: "male director",
  diretora: "female director",
  empresario: "businessman",
  empresaria: "businesswoman",
  estudante: "student",
  professor: "male teacher",
  professora: "female teacher",
  vendedor: "male salesperson",
  vendedora: "female salesperson",

  // --- actions ------------------------------------------------------------
  conversando: "talking",
  conversa: "conversation",
  falando: "speaking",
  sorrindo: "smiling",
  rindo: "laughing",
  olhando: "looking",
  observando: "watching",
  ouvindo: "listening",
  escutando: "listening",
  explicando: "explaining",
  mostrando: "showing",
  apontando: "pointing",
  segurando: "holding",
  examinando: "examining",
  atendendo: "attending to",
  atendimento: "consultation",
  acolhendo: "welcoming",
  consultando: "consulting",
  cuidando: "caring for",
  ajudando: "helping",
  trabalhando: "working",
  digitando: "typing",
  escrevendo: "writing",
  lendo: "reading",
  analisando: "reviewing",
  apresentando: "presenting",
  usando: "using",
  mexendo: "using",
  esperando: "waiting",
  sentado: "sitting",
  sentada: "sitting",
  sentados: "sitting",
  andando: "walking",
  caminhando: "walking",
  reunidos: "gathered",
  reunida: "gathered",
  reunidas: "gathered",
  reunido: "gathered",
  aged: "aged",
  about: "about",
  naturalmente: "naturally",
  atentamente: "attentively",
  calmamente: "calmly",
  tranquilamente: "calmly",
  atenciosamente: "attentively",
  cuidadosamente: "carefully",
  levemente: "slightly",
  ligeiramente: "slightly",
  claramente: "clearly",
  realmente: "really",
  simplesmente: "simply",
  suavemente: "softly",
  discretamente: "discreetly",
  aproximadamente: "approximately",
  provavelmente: "probably",
  possivelmente: "possibly",
  parcialmente: "partially",
  totalmente: "completely",
  rapidamente: "quickly",
  lentamente: "slowly",
  anos: "years old",
  reuniao: "meeting",
  abraçando: "hugging",
  abracando: "hugging",
  brincando: "playing",
  cozinhando: "cooking",
  almocando: "having lunch",
  jantando: "having dinner",
  descansando: "resting",
  medindo: "measuring",
  aplicando: "administering",
  vacinando: "vaccinating",
  operando: "operating",

  // --- settings -----------------------------------------------------------
  clinica: "clinic",
  clinicas: "clinics",
  consultorio: "doctor's office",
  hospital: "hospital",
  enfermaria: "hospital ward",
  laboratorio: "laboratory",
  farmacia: "pharmacy",
  recepcao: "reception area",
  corredor: "hallway",
  escritorio: "office",
  empresa: "company office",
  coworking: "coworking space",
  sala: "room",
  casa: "home",
  cozinha: "kitchen",
  quarto: "bedroom",
  varanda: "balcony",
  jardim: "garden",
  quintal: "backyard",
  rua: "street",
  parque: "park",
  praca: "town square",
  cafe: "cafe",
  cafeteria: "coffee shop",
  restaurante: "restaurant",
  loja: "shop",
  estudio: "studio",
  ambiente: "environment",
  cenario: "setting",
  fundo: "background",
  janela: "window",
  janelas: "windows",
  porta: "door",
  parede: "wall",
  teto: "ceiling",
  chao: "floor",
  piso: "floor",
  triagem: "triage",
  leito: "hospital bed",
  luz: "light",
  luzes: "lights",
  sombra: "shadow",
  sombras: "shadows",
  reflexo: "reflection",
  reflexos: "reflections",
  mesa: "table",
  escrivaninha: "desk",
  balcao: "counter",
  cadeira: "chair",
  poltrona: "armchair",
  sofa: "sofa",
  maca: "examination table",
  cama: "bed",
  prateleira: "shelf",

  // --- objects ------------------------------------------------------------
  celular: "smartphone",
  smartphone: "smartphone",
  telefone: "phone",
  notebook: "laptop",
  laptop: "laptop",
  macbook: "MacBook",
  computador: "computer",
  tela: "screen",
  monitor: "monitor",
  teclado: "keyboard",
  mouse: "mouse",
  tablet: "tablet",
  fone: "headphones",
  camera: "camera",
  prontuario: "medical chart",
  papel: "paper",
  papeis: "papers",
  documento: "document",
  documentos: "documents",
  caneta: "pen",
  caderno: "notebook",
  livro: "book",
  oculos: "glasses",
  jaleco: "lab coat",
  uniforme: "uniform",
  crachá: "id badge",
  cracha: "id badge",
  estetoscopio: "stethoscope",
  seringa: "syringe",
  termometro: "thermometer",
  aparelho: "device",
  equipamento: "equipment",
  maquina: "machine",
  monitorcardiaco: "cardiac monitor",
  ultrassom: "ultrasound machine",
  raio: "x-ray",
  remedio: "medication",
  medicamento: "medication",
  produto: "product",
  produtos: "products",
  embalagem: "packaging",
  caixa: "box",
  xicara: "cup",
  caneca: "mug",
  copo: "glass",
  planta: "plant",
  flores: "flowers",
  quadro: "framed picture",
  roupa: "clothing",
  roupas: "clothes",
  camisa: "shirt",
  blusa: "blouse",
  terno: "suit",
  vestido: "dress",
  maquiagem: "makeup",
  filtro: "filter",

  // --- the body, and how it is allowed to look ----------------------------
  // The realism vocabulary the briefs actually use. Leaving these in
  // Portuguese was the single biggest source of hybrid output.
  pele: "skin",
  textura: "texture",
  rugas: "wrinkles",
  ruga: "wrinkle",
  poros: "pores",
  linhas: "lines",
  linha: "line",
  imperfeicoes: "imperfections",
  imperfeicao: "imperfection",
  retoque: "retouching",
  retoques: "retouching",
  beleza: "beauty",
  aparencia: "appearance",
  cabelo: "hair",
  cabelos: "hair",
  barba: "beard",
  mao: "hand",
  maos: "hands",

  // --- adjectives / qualities --------------------------------------------
  brasileiro: "Brazilian",
  brasileira: "Brazilian",
  brasileiros: "Brazilian",
  brasileiras: "Brazilian",
  moderno: "modern",
  moderna: "modern",
  simples: "simple",
  real: "real",
  natural: "natural",
  naturais: "natural",
  espontaneo: "candid",
  espontanea: "candid",
  concentrado: "focused",
  concentrada: "focused",
  concentrados: "focused",
  concentradas: "focused",
  ambos: "both",
  ambas: "both",
  atentos: "attentive",
  atentas: "attentive",
  sorridentes: "smiling",
  sentadas: "sitting",
  atento: "attentive",
  atenta: "attentive",
  serio: "serious",
  seria: "serious",
  tranquilo: "relaxed",
  tranquila: "relaxed",
  sorridente: "smiling",
  cansado: "tired",
  cansada: "tired",
  velho: "old",
  velha: "old",
  novo: "new",
  nova: "new",
  pequeno: "small",
  pequena: "small",
  grande: "large",
  limpo: "clean",
  limpa: "clean",
  claro: "bright",
  clara: "bright",
  escuro: "dark",
  escura: "dark",
  branco: "white",
  branca: "white",
  preto: "black",
  preta: "black",
  azul: "blue",
  verde: "green",
  cinza: "gray",
  bege: "beige",
  aberto: "open",
  aberta: "open",
  fechado: "closed",
  fechada: "closed",
  juntos: "together",
  juntas: "together",
  aconchegante: "cozy",
  acolhedor: "welcoming",
  acolhedora: "welcoming",
  corporativo: "corporate",
  corporativa: "corporate",
  hospitalar: "hospital",
  clinico: "clinical",
  medicinal: "medical",
  documental: "documentary",
  publico: "public",
  publica: "public",
  publicos: "public",
  publicas: "public",
  fluorescente: "fluorescent",
  fluorescentes: "fluorescent",
  funcional: "functional",
  funcionais: "functional",
  vivido: "lived-in",
  vivida: "lived-in",
  lateral: "side",
  fino: "fine",
  fina: "fine",
  finos: "fine",
  finas: "fine",
  pequenos: "small",
  pequenas: "small",
  normal: "ordinary",
  normais: "ordinary",
  normalmente: "normally",
  // "used", not "worn": the clothing sense is carried by the phrases above
  // ("usado normalmente"), and a bare "notebook usado" is a used laptop.
  usado: "used",
  usada: "used",
  misturado: "mixed",
  misturada: "mixed",
  realista: "realistic",
  verdadeiro: "real",
  verdadeira: "real",
  cotidiano: "everyday",
  organizado: "tidy",
  organizada: "tidy",
  desarrumado: "untidy",
  desarrumada: "untidy",
  iluminado: "lit",
  iluminada: "lit",
  saude: "health",
  trabalho: "work",
  vida: "life",
  foto: "photo",
  fotografia: "photograph",
  imagem: "image",
  retrato: "portrait",
};

const PORTUGUESE_MARKERS = new Set([
  "de", "da", "do", "das", "dos", "com", "em", "na", "no", "nas", "nos", "para",
  "uma", "um", "que", "e", "os", "as", "ao", "pela", "pelo", "sem", "sobre",
]);

// Six, so idioms like "sem todos olhando para a camera" can be matched whole.
const MAX_PHRASE_TOKENS = 6;

interface Token {
  raw: string;
  folded: string;
  isWord: boolean;
}

function tokenize(text: string): Token[] {
  const parts = text.match(/[\p{L}\p{N}][\p{L}\p{N}'-]*|[^\s\p{L}\p{N}]+|\s+/gu) ?? [];
  return parts.map((raw): Token => {
    const isWord = /^[\p{L}\p{N}]/u.test(raw);
    return { raw, folded: isWord ? fold(raw) : raw, isWord };
  });
}

/** Words we consider "content" when scoring coverage. */
function isContentWord(folded: string): boolean {
  return folded.length > 1 && !/^\d+$/.test(folded);
}

function tidy(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    // "of the of the" and friends from stacked contractions
    .replace(/\b(of the) (of the)\b/gi, "$1")
    .replace(/\b(in the) (the)\b/gi, "$1")
    .replace(/\b(of) (the the)\b/gi, "of the")
    .replace(/\bthe the\b/gi, "the")
    .replace(/\ba a\b/gi, "a")
    .replace(/\bof of\b/gi, "of")
    // English indefinite article agreement
    .replace(/\ba ([aeiouAEIOU])/g, "an $1")
    .replace(/\ban ([^aeiouAEIOU\s])/g, "a $1")
    // Appositive rules can leave a dangling separator at the end.
    .replace(/[,;:\s]+$/, "")
    .trim();
}

/**
 * Portuguese puts most qualifiers after the noun ("escritório real"); English
 * puts them before ("real office"). Left alone, the model reads the adjective
 * as a separate object in the scene.
 */
const ADJECTIVES = new Set([
  "real", "reais", "moderno", "moderna", "modernos", "modernas", "novo", "nova",
  "novos", "novas", "velho", "velha", "branco", "branca", "brancos", "brancas",
  "preto", "preta", "azul", "verde", "cinza", "bege", "vermelho", "vermelha",
  "pequeno", "pequena", "grande", "grandes", "limpo", "limpa", "claro", "clara",
  "escuro", "escura", "brasileiro", "brasileira", "brasileiros", "brasileiras",
  "aconchegante", "acolhedor", "acolhedora", "corporativo", "corporativa",
  "sorridente", "concentrado", "concentrada", "concentrados", "serio", "seria",
  "tranquilo", "tranquila", "cansado", "cansada", "aberto", "aberta",
  "fechado", "fechada", "simples", "espontaneo", "espontanea", "hospitalar",
  "atento", "atenta", "idoso", "idosa", "idosos", "idosas", "jovem", "jovens",
  "clinico", "clinicos", "corporativos", "modernos", "reais",
  "documental", "publico", "publica", "publicos", "publicas", "fluorescente",
  "fluorescentes", "funcional", "funcionais", "vivido", "vivida", "lateral",
  "fino", "fina", "finos", "finas", "pequenos", "pequenas", "normal", "normais",
  "usado", "usada", "misturado", "misturada", "realista", "verdadeiro",
  "verdadeira", "organizado", "organizada", "desarrumado", "desarrumada",
  "iluminado", "iluminada",
]);

/** Words that must never absorb a following adjective. */
const NON_NOUNS = new Set([
  ...PORTUGUESE_MARKERS,
  "o", "a", "os", "as", "um", "uma", "e", "ou", "nao", "muito", "mais", "menos",
]);

/**
 * Words that are nouns on their own ("uma idosa" = an elderly woman) but pure
 * modifiers when they trail a noun ("médico idoso" = elderly male doctor).
 * The modifier form is only used when a swap actually happens.
 */
const ADJECTIVAL_FORM: Record<string, string> = {
  idoso: "elderly",
  idosa: "elderly",
  idosos: "elderly",
  idosas: "elderly",
  jovem: "young",
  jovens: "young",
};

/**
 * Portuguese nouns that name a person without stating their gender. The gender
 * lives entirely in the surrounding article and adjectives ("uma jovem
 * brasileira"), and English drops both — so "young person" comes out and the
 * model renders a man. These carry the agreement across instead.
 */
const NEUTRAL_PERSON: Record<string, { neutral: string; f: string; m: string }> = {
  jovem: { neutral: "young person", f: "young woman", m: "young man" },
  jovens: { neutral: "young people", f: "young women", m: "young men" },
  adolescente: { neutral: "teenager", f: "teenage girl", m: "teenage boy" },
  paciente: { neutral: "patient", f: "female patient", m: "male patient" },
  profissional: { neutral: "professional", f: "female professional", m: "male professional" },
  estudante: { neutral: "student", f: "female student", m: "male student" },
  cliente: { neutral: "client", f: "female client", m: "male client" },
  dentista: { neutral: "dentist", f: "female dentist", m: "male dentist" },
  fisioterapeuta: { neutral: "physical therapist", f: "female physical therapist", m: "male physical therapist" },
  nutricionista: { neutral: "nutritionist", f: "female nutritionist", m: "male nutritionist" },
  gerente: { neutral: "manager", f: "female manager", m: "male manager" },
  atendente: { neutral: "front desk attendant", f: "female front desk attendant", m: "male front desk attendant" },
  recepcionista: { neutral: "receptionist", f: "female receptionist", m: "male receptionist" },
  adulto: { neutral: "adult man", f: "adult woman", m: "adult man" },
};

const FEMININE_DETERMINERS = new Set(["a", "as", "uma", "umas", "esta", "essa", "aquela"]);
const MASCULINE_DETERMINERS = new Set(["o", "os", "um", "uns", "este", "esse", "aquele"]);

/**
 * Adjectives that end in -a for every gender. Reading agreement off them makes
 * "profissional realista" come out as a *female* professional — the engine
 * inventing a fact about a person, which is exactly what it must never do.
 */
const GENDER_INVARIANT = new Set(["realista", "realistas", "cinza"]);

/** Reads gender agreement from the article and adjectives around a noun. */
function genderAround(tokens: Token[], index: number): "f" | "m" | null {
  const wordAt = (offset: number): Token | undefined => {
    let seen = 0;
    const step = offset < 0 ? -1 : 1;
    for (let i = index + step; i >= 0 && i < tokens.length; i += step) {
      const token = tokens[i]!;
      if (!token.isWord) continue;
      seen++;
      if (seen === Math.abs(offset)) return token;
    }
    return undefined;
  };

  const before = wordAt(-1);
  if (before) {
    if (FEMININE_DETERMINERS.has(before.folded)) return "f";
    if (MASCULINE_DETERMINERS.has(before.folded)) return "m";
  }

  // Adjacent adjectives agree with the noun: "jovem brasileira" is feminine.
  for (const offset of [1, 2]) {
    const after = wordAt(offset);
    if (!after || !ADJECTIVES.has(after.folded)) continue;
    if (GENDER_INVARIANT.has(after.folded)) continue;
    if (/[aá]s?$/.test(after.folded)) return "f";
    if (/[oó]s?$/.test(after.folded)) return "m";
  }
  return null;
}

type Tag = "noun" | "adj" | "other";

interface Emitted {
  text: string;
  tag: Tag;
  /** Alternative wording to use if this item gets moved in front of a noun. */
  adjForm?: string;
}

/** Pre-passes that run on the raw Portuguese, before tokenising. */
function preNormalise(input: string): string {
  return input
    // "de 40 anos", "com 40 anos", "de aproximadamente 40 anos"
    .replace(
      /\b(?:de|com)\s+(aproximadamente|cerca\s+de|uns|quase|mais\s+de|em\s+torno\s+de)?\s*(\d{1,3})\s+anos?\b/gi,
      (_match, qualifier: string | undefined, age: string) =>
        qualifier ? ` aged about ${age}` : ` aged ${age}`,
    )
    .replace(/\b(\d{1,3})\s+anos?\s+de\s+idade\b/gi, " aged $1")
    .replace(/\bde\s+meia[-\s]idade\b/gi, ", middle-aged,")
    .replace(/\s{2,}/g, " ");
}

/**
 * Move Portuguese post-nominal adjectives in front of their noun.
 * "office desk real" -> "real office desk".
 */
function reorderAdjectives(items: Emitted[]): Emitted[] {
  const result = [...items];
  for (let i = 0; i < result.length; i++) {
    if (result[i]!.tag !== "adj") continue;
    // Find the previous emitted word.
    let j = i - 1;
    while (j >= 0 && result[j]!.tag === "other" && /^\s*$/.test(result[j]!.text)) j--;
    const prev = result[j]!;
    // An item that carries an adjForm is still holding its noun wording here,
    // so it can absorb a modifier just like a plain noun.
    const prevIsNoun = prev.tag === "noun" || (prev.tag === "adj" && prev.adjForm !== undefined);
    if (j < 0 || !prevIsNoun) continue;
    // Walk back over any adjectives already sitting in front of that noun.
    let insertAt = j;
    while (insertAt - 1 >= 0 && result[insertAt - 1]!.tag === "adj") insertAt--;

    const [adj] = result.splice(i, 1);
    const moved: Emitted = { text: adj!.adjForm ?? adj!.text, tag: "adj" };
    // Drop the whitespace slot the adjective left behind, then re-insert it
    // ahead of the noun with a single space.
    if (result[i - 1] && /^\s+$/.test(result[i - 1]!.text)) result.splice(i - 1, 1);
    result.splice(insertAt, 0, moved, { text: " ", tag: "other" });
    i = insertAt;
  }
  return result;
}

/**
 * Translate a Portuguese photographic brief into English.
 * Text that is already English passes through untouched.
 */
export function translateToEnglish(rawInput: string): TranslationResult {
  const input = preNormalise(rawInput);
  const tokens = tokenize(input);
  const words = tokens.filter((t) => t.isWord);
  if (words.length === 0) {
    return { text: input, coverage: 1, wasPortuguese: false, unknown: [] };
  }

  // Detect on the *raw* text: pre-normalisation rewrites "de 40 anos" into
  // English, which can strip the very markers that identify the language.
  const rawWords = tokenize(rawInput).filter((t) => t.isWord);
  const markerHits = rawWords.filter((t) => PORTUGUESE_MARKERS.has(t.folded)).length;
  const dictHits = rawWords.filter((t) => WORDS[t.folded] !== undefined).length;
  const looksPortuguese =
    (markerHits >= 1 && (markerHits + dictHits) / rawWords.length >= 0.25) ||
    // A short phrase can be unambiguously Portuguese without a function word:
    // "médica idosa" has no marker but is not English either.
    (rawWords.length <= 4 && dictHits / rawWords.length >= 0.5 && dictHits > 0);

  if (!looksPortuguese) {
    return { text: input.trim(), coverage: 1, wasPortuguese: false, unknown: [] };
  }

  const out: Emitted[] = [];
  const unknown: string[] = [];
  let contentWords = 0;
  let matched = 0;

  for (let i = 0; i < tokens.length; ) {
    const token = tokens[i]!;

    if (!token.isWord) {
      // Collapse the whitespace that follows a consumed phrase.
      out.push({ text: token.raw, tag: "other" });
      i++;
      continue;
    }

    // Longest-match phrase lookup, ignoring interleaved whitespace.
    let phraseHit: { text: string; consumed: number } | null = null;
    for (let len = MAX_PHRASE_TOKENS; len >= 2 && !phraseHit; len--) {
      const collected: string[] = [];
      let j = i;
      let wordCount = 0;
      while (j < tokens.length && wordCount < len) {
        const t = tokens[j]!;
        if (t.isWord) {
          collected.push(t.folded);
          wordCount++;
        } else if (!/^\s+$/.test(t.raw)) {
          break; // punctuation breaks a phrase
        }
        j++;
      }
      if (wordCount === len) {
        const key = collected.join(" ");
        const value = PHRASES[key];
        if (value) phraseHit = { text: value, consumed: j - i };
      }
    }

    if (phraseHit) {
      // A matched phrase is already in English noun-first order.
      out.push({ text: phraseHit.text, tag: "noun" });
      contentWords += 1;
      matched += 1;
      i += phraseHit.consumed;
      continue;
    }

    const single = WORDS[token.folded];
    if (isContentWord(token.folded)) contentWords++;

    const tag: Tag =
      ADJECTIVES.has(token.folded) ? "adj"
      : NON_NOUNS.has(token.folded) || !isContentWord(token.folded) ? "other"
      : "noun";

    const neutral = NEUTRAL_PERSON[token.folded];
    if (neutral) {
      const gender = genderAround(tokens, i);
      out.push({ text: gender ? neutral[gender] : neutral.neutral, tag: "noun" });
      if (isContentWord(token.folded)) matched++;
      i++;
      continue;
    }

    if (single !== undefined) {
      const adjForm = ADJECTIVAL_FORM[token.folded];
      out.push(adjForm ? { text: single, tag, adjForm } : { text: single, tag });
      if (isContentWord(token.folded)) matched++;
    } else {
      // Unknown words keep their original form and never move.
      out.push({ text: token.raw, tag: tag === "adj" ? "other" : tag });
      if (isContentWord(token.folded)) unknown.push(token.raw);
    }
    i++;
  }

  return {
    text: tidy(reorderAdjectives(out).map((item) => item.text).join("")),
    coverage: contentWords === 0 ? 1 : matched / contentWords,
    wasPortuguese: true,
    unknown: [...new Set(unknown)],
  };
}
