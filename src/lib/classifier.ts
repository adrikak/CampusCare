/**
 * AI category suggestion for the Report Issue form.
 *
 * A small machine-learning text classifier (multinomial Naive Bayes) that runs entirely in the
 * browser. It is trained, when the page loads, on the labelled example complaints below and then
 * predicts the most likely category for whatever the user types. Nothing is sent to any outside
 * service, there is no API key and no cost. The user always makes the final choice.
 */

export const CATEGORY_LABELS = ["Electrical", "Plumbing", "IT & Network", "Furniture", "Cleanliness", "Safety", "HVAC", "Other"] as const;
export type CategoryLabel = (typeof CATEGORY_LABELS)[number];

/** Labelled training examples (fictional, written for this prototype). */
export const TRAINING: Record<CategoryLabel, string[]> = {
  Electrical: [
    "The ceiling fan makes a loud grinding noise and slows down",
    "Tube light keeps flickering in the classroom",
    "No power in the switch board near the window",
    "Power socket is not working, cannot charge laptop",
    "The fan does not start even when the switch is on",
    "Lights in the corridor are not working at night",
    "Sparks came out of the plug point when I plugged in",
    "The MCB trips again and again in the lab",
    "Bulb fused in the washroom, it is completely dark",
    "Electric board is loose and the wires are hanging",
    "Fan regulator is broken, fan only runs at full speed",
    "Stairwell light not working since last week",
    "Half the lights in the hall are off",
    "Extension board in the lab is burnt",
    "Power cut only in our classroom while others have electricity",
    "Switch gives a small shock when touched",
    "The emergency light is not charging",
    "Projector screen motor not moving, no power to it",
    "Street light outside the hostel block is off",
    "LED panel blinking continuously in the staff room",
    "Wiring smells burnt near the main switch",
    "Fan is wobbling and making a ticking sound",
    "Fan stops working after running for a while",
    "Fan in the hall is not rotating properly",
  ],
  Plumbing: [
    "Water leak near the staircase, the floor is wet",
    "The washroom tap keeps dripping all day",
    "Toilet flush is not working",
    "Wash basin is blocked and water is not draining",
    "Water cooler is leaking from the bottom",
    "No water supply in the girls washroom",
    "Pipe burst on the second floor, water is spreading",
    "The drinking water tap is broken",
    "Drain is clogged and dirty water is coming out",
    "Overhead tank is overflowing",
    "Urinal is leaking continuously",
    "Water pressure is very low in the taps",
    "Seepage on the wall from the bathroom pipe",
    "Shower in the hostel bathroom is not working",
    "Sink tap handle came off and water is running",
    "Washroom is flooded because the outlet is blocked",
    "Water purifier is leaking and wasting water",
    "Commode is cracked and leaking water",
    "Sewage smell from the drain pipe near the canteen",
    "Hand wash tap in the lab is jammed",
    "Ceiling is dripping water from the floor above",
  ],
  "IT & Network": [
    "Wi-Fi disconnects frequently in the classroom",
    "Projector shows no signal when the laptop is connected",
    "Computers in the lab are not starting",
    "Internet is very slow in the library",
    "LAN port not working on the lab system",
    "Cannot log in to the college Wi-Fi network",
    "Printer in the office is not printing",
    "Smart board touch is not responding",
    "Monitor is blank on computer number 12",
    "Keyboard and mouse not working in the computer lab",
    "HDMI cable for the projector is damaged",
    "Software not installed on lab machines for practicals",
    "No internet connection in the hostel rooms",
    "CCTV camera feed is not visible on the screen",
    "Router lights are off and the network is down",
    "Speaker and microphone in the seminar hall not working",
    "System shows blue screen and restarts",
    "Projector bulb is dim and display is unclear",
    "Biometric attendance machine is not working",
    "Wi-Fi signal is very weak on the third floor",
    "Lab computer is extremely slow and hangs",
  ],
  Furniture: [
    "Broken desk in the classroom, the top is loose",
    "Chair leg is broken and it is unsafe to sit",
    "Bench is wobbly and makes noise",
    "Cupboard door is broken and does not close",
    "Table drawer is stuck and cannot be opened",
    "Classroom door handle came off",
    "Window glass is cracked",
    "Whiteboard is falling off the wall",
    "Notice board pins and frame are broken",
    "Library rack shelf has collapsed",
    "Several chairs in the seminar hall are torn",
    "Lab stool is broken",
    "Window cannot be closed, the latch is broken",
    "Door lock of the classroom is jammed",
    "Wooden podium is cracked",
    "Hostel bed frame is broken",
    "Desk has sharp nails sticking out",
    "Curtain rod has fallen down",
    "Locker hinge is broken",
    "Bench seat plank is missing",
    "Damaged chairs and benches in the lecture hall",
    "Table is damaged and shaky",
  ],
  Cleanliness: [
    "Overflowing waste bins near the canteen",
    "Washroom is very dirty and smells bad",
    "Garbage has not been collected for days",
    "Classroom floor is dusty and has not been swept",
    "Spilled food in the corridor attracting flies",
    "Dustbin is missing from the classroom",
    "Cobwebs on the ceiling and walls",
    "Paan stains on the staircase walls",
    "Toilet has no soap and is unhygienic",
    "Mosquitoes breeding in stagnant water outside",
    "Lab is dirty with paper and waste everywhere",
    "Dead rat smell in the store room",
    "Canteen tables are not cleaned",
    "Leaves and plastic waste piled near the parking",
    "Washroom floor is slippery and dirty",
    "Pigeon droppings on the benches",
    "Dust on the computers and desks",
    "Water cooler area is dirty with algae",
    "Bad odour from the garbage room",
    "Sanitary bin in the washroom is overflowing",
  ],
  Safety: [
    "Fire extinguisher has expired",
    "Exposed live wire near the stairs is dangerous",
    "Emergency exit door is locked",
    "Staircase railing is broken and someone may fall",
    "Smell of gas in the chemistry lab",
    "Fire alarm is not working",
    "Ceiling plaster is falling and may hurt someone",
    "Floor tile is broken and people are tripping",
    "First aid box is empty",
    "Stray dogs near the entrance are chasing students",
    "Open manhole near the main gate",
    "Lift is stuck between floors with people inside",
    "Glass pane is broken with sharp edges",
    "Smoke coming from the electrical room",
    "Fire exit sign is not lit",
    "Water on the floor near the electrical panel is a hazard",
    "Lift door does not stop when someone is in between",
    "Loose ceiling panel may fall on students",
    "Chemical spill in the lab not cleaned",
    "Main gate barrier is broken",
  ],
  HVAC: [
    "Air conditioner is not cooling in the lab",
    "AC is leaking water on the desks",
    "AC makes a very loud noise",
    "Exhaust fan in the washroom is not working",
    "Room is too hot, ventilation is poor",
    "AC remote is missing and temperature cannot be changed",
    "Air conditioner is blowing warm air",
    "Server room AC has stopped",
    "AC unit trips after running for few minutes",
    "Heater in the staff room not working",
    "Air vents are blocked and there is no airflow",
    "Kitchen exhaust in the canteen is not working",
    "AC smells bad when switched on",
    "Ventilation duct is making rattling noise",
    "Temperature in the seminar hall is too cold and cannot be adjusted",
    "Air cooler is not working",
    "AC compressor outside is making noise",
    "Humidity is high and the room feels stuffy",
    "Split AC indoor unit is dripping",
    "Ventilator window is jammed, no fresh air",
    "Exhaust fan is broken and not running",
    "Poor ventilation makes the room very hot",
    "No airflow in the hall and it is very hot",
  ],
  Other: [
    "Request to change the lab timetable",
    "Need extra chairs for an event in the auditorium",
    "Lost and found item near the library",
    "Request for a new notice board in our department",
    "Parking area needs better signs",
    "Request to install a water dispenser on our floor",
    "Suggestion to add more benches in the garden",
    "Need permission to use the seminar hall",
    "Request for a lockers facility for day scholars",
    "Name plate of the department is missing",
    "Request to paint the classroom walls",
    "Request a bulletin board for the club",
    "Canteen menu prices should be displayed",
    "Request for a quiet study room",
    "Department signboard is faded",
    "Need a ramp for wheelchair access at the entrance",
    "Request to fix the timetable display screen schedule",
    "Request for a bicycle stand",
  ],
};

/** Separate examples, never used for training, to measure accuracy honestly. */
export const TEST_SET: [string, CategoryLabel][] = [
  ["The fan in room 204 stops every few minutes", "Electrical"],
  ["Tube light not working in the drawing hall", "Electrical"],
  ["Plug point near my bench has no power", "Electrical"],
  ["Lights keep switching off on their own in the library", "Electrical"],
  ["Tap in the second floor washroom is leaking", "Plumbing"],
  ["Water is not draining from the sink in the lab", "Plumbing"],
  ["Flush tank keeps running water", "Plumbing"],
  ["Drinking water cooler has a leaking pipe", "Plumbing"],
  ["Wi-Fi is not connecting on my phone in the canteen", "IT & Network"],
  ["Projector is not displaying anything from the laptop", "IT & Network"],
  ["Lab PC does not boot", "IT & Network"],
  ["Internet speed is too slow to open websites", "IT & Network"],
  ["The desk in the front row is broken", "Furniture"],
  ["Classroom door does not lock", "Furniture"],
  ["Chairs in the lab are damaged", "Furniture"],
  ["The cupboard shelf is broken", "Furniture"],
  ["Bins in the corridor are full and smelling", "Cleanliness"],
  ["The washroom has not been cleaned today", "Cleanliness"],
  ["Lots of garbage thrown behind the building", "Cleanliness"],
  ["Classroom has dust and waste paper on the floor", "Cleanliness"],
  ["Fire extinguisher missing on our floor", "Safety"],
  ["Broken railing on the terrace is dangerous", "Safety"],
  ["Lift got stuck today", "Safety"],
  ["Smoke smell in the electronics lab", "Safety"],
  ["AC in the classroom is not cooling at all", "HVAC"],
  ["Exhaust fan in the lab is broken", "HVAC"],
  ["Air conditioner dripping water", "HVAC"],
  ["No ventilation in the computer lab, it is very hot", "HVAC"],
  ["Request to reschedule the practical slot", "Other"],
  ["Need more chairs for the club event", "Other"],
  ["Request for a notice board near the canteen", "Other"],
  ["Suggest adding a bicycle parking stand", "Other"],
];

const STOP = new Set(
  "a an the is are was were be been it its this that these those in on at of for to from with and or but not no by as has have had do does did my our we i me us you your they them there here very all any some can cannot will would should near since last week today day days room classroom floor please also only even when while who which what again".split(
    " ",
  ),
);

/** Lower-case words, common words removed, a light stemmer so "leaking"/"leaks"/"leaked" match. */
export function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/wi-?fi/g, "wifi")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map((w) => w.replace(/(ing|ed|es|s)$/, "").replace(/(.)\1$/, "$1"))
    .filter((w) => w.length > 1);
}

type Model = { vocab: Set<string>; logPrior: Record<string, number>; counts: Record<string, Map<string, number>>; totals: Record<string, number> };

function train(data: Record<CategoryLabel, string[]>): Model {
  const vocab = new Set<string>();
  const counts: Model["counts"] = {};
  const totals: Model["totals"] = {};
  const logPrior: Model["logPrior"] = {};
  const docs = CATEGORY_LABELS.reduce((n, c) => n + data[c].length, 0);
  for (const c of CATEGORY_LABELS) {
    const m = new Map<string, number>();
    let total = 0;
    for (const example of data[c]) {
      for (const t of tokens(example)) {
        m.set(t, (m.get(t) ?? 0) + 1);
        vocab.add(t);
        total++;
      }
    }
    counts[c] = m;
    totals[c] = total;
    logPrior[c] = Math.log(data[c].length / docs);
  }
  return { vocab, logPrior, counts, totals };
}

const model = train(TRAINING);

export type Suggestion = { category: CategoryLabel; confidence: number; ranked: { category: CategoryLabel; p: number }[] };

/** Probability of each category for the text (Laplace-smoothed multinomial Naive Bayes). */
export function classify(text: string): Suggestion | null {
  const words = tokens(text).filter((w) => model.vocab.has(w));
  if (words.length === 0) return null;
  const V = model.vocab.size;
  const scores = CATEGORY_LABELS.map((c) => {
    let s = model.logPrior[c];
    for (const w of words) s += Math.log(((model.counts[c].get(w) ?? 0) + 1) / (model.totals[c] + V));
    return s;
  });
  const max = Math.max(...scores);
  const exps = scores.map((s) => Math.exp(s - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  const ranked = CATEGORY_LABELS.map((category, i) => ({ category, p: exps[i] / sum })).sort((a, b) => b.p - a.p);
  return { category: ranked[0].category, confidence: ranked[0].p, ranked };
}

/** Only show a suggestion once the description is meaningful and the model is reasonably sure. */
export function suggestCategory(text: string): Suggestion | null {
  if (text.trim().length < 12) return null;
  const s = classify(text);
  return s && s.confidence >= 0.5 ? s : null;
}
