/* LifeLoop — data.js
   All the content of the game: life stages, events, jobs, activities and achievements.

   Effect keys used everywhere:
     h = health, p = happiness, i = intelligence, r = reputation, m = money
   A value can be a number or a function (state) => number.

   Outcome extras (all optional):
     flags:{k:v}            set flags            inc:{k:n}        add to a numeric flag
     edu:n                  raise education      add:{role,...}   add a person (or an array of them)
     bond:{role:n}          change a bond        end:{role,why}   a relationship ends
     upgrade:{from,to}      change a role        job:n|'quit'|'teen'   new job (tier n) / quit
     promote:true           promote              retire:'full'|'consult'
     die:'cause'            the life ends        fn:(s, notes)    custom code
*/

(function () {
  'use strict';

  const LL = (window.LL = window.LL || {});

  /* ---------- tiny builders ---------- */

  const rnd = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;

  const o = (text, fx, more) => Object.assign({ w: 1, text: text, fx: fx || {} }, more || {});
  const ow = (w, text, fx, more) => Object.assign({ w: w, text: text, fx: fx || {} }, more || {});
  const c = (label, out, extra) => Object.assign({ label: label, out: [].concat(out) }, extra || {});

  const has = (s, role) => s.people.some(p => p.role === role && p.alive);
  const partnerOf = s => has(s, 'spouse') || has(s, 'partner');
  const student = s => !!(s.flags.uni || s.flags.trade);
  const kidsUnder = (s, age) => s.people.some(p => p.role === 'child' && p.alive && p.age < age);
  const bondOf = (s, role) => {
    const p = s.people.find(x => x.role === role && x.alive);
    return p ? p.bond : 0;
  };

  /* ---------- basics ---------- */

  const STAGES = [
    { id: 'baby', name: 'Baby', from: 0, to: 4 },
    { id: 'child', name: 'Child', from: 5, to: 12 },
    { id: 'teen', name: 'Teen', from: 13, to: 17 },
    { id: 'young', name: 'Young adult', from: 18, to: 29 },
    { id: 'adult', name: 'Adult', from: 30, to: 64 },
    { id: 'elder', name: 'Elder', from: 65, to: 110 }
  ];

  const EDU_NAMES = ['No qualifications', 'Secondary school', 'Trade certificate', 'University degree'];

  const FAMILY_TEXT = ['a family that counts every coin', 'a warm, comfortable home', 'a wealthy family with a big house'];

  const HOBBY_NAMES = { music: 'music', sport: 'football', art: 'drawing', tech: 'coding' };

  const CITIES = [
    'Lagos', 'Abuja', 'Ibadan', 'Port Harcourt', 'Enugu', 'Kano', 'Accra', 'Nairobi', 'Cape Town', 'Cairo',
    'London', 'Manchester', 'Toronto', 'Houston', 'Atlanta', 'Mumbai', 'Manila', 'Sydney', 'Lisbon', 'Mexico City'
  ];

  const NAMES_F = [
    'Amara', 'Ngozi', 'Zainab', 'Adaeze', 'Funke', 'Tola', 'Imani', 'Nia', 'Sade', 'Chioma',
    'Maya', 'Elena', 'Priya', 'Lucy', 'Hannah', 'Sofia', 'Leila', 'Grace', 'Ruth', 'Zara'
  ];

  const NAMES_M = [
    'Chidi', 'Tunde', 'Femi', 'Emeka', 'Ibrahim', 'Kofi', 'Kwame', 'Jabari', 'Dayo', 'Obinna',
    'Leo', 'Daniel', 'Marcus', 'Omar', 'Ravi', 'Mateo', 'Ethan', 'Jonah', 'Sam', 'Theo'
  ];

  const NAMES_ALL = NAMES_F.concat(NAMES_M);

  const PET_NAMES = ['Biscuit', 'Pepper', 'Ziggy', 'Mango', 'Scout', 'Nova', 'Coco', 'Bolt', 'Pixel', 'Suya'];

  const MILESTONES = {
    5: 'School age',
    13: 'Teenager',
    18: 'Adulthood',
    21: 'Twenty-one',
    30: 'Thirty',
    40: 'Forty',
    50: 'Fifty',
    65: 'Retirement age',
    80: 'Eighty',
    90: 'Ninety',
    100: 'A hundred years'
  };

  const QUIET_TEXTS = [
    'A calm year. No big headlines, just ordinary days stacking up.',
    'Nothing dramatic happens. You notice small things: the light in the morning, a good meal, a song stuck in your head.',
    'The year passes quietly. You get to decide what kind of quiet it was.',
    'It is a slow year. The kind you only appreciate later.'
  ];

  /* ---------- jobs ---------- */

  const JOBS = [
    { id: 'cashier', title: 'Cashier', tier: 0, salary: 15000 },
    { id: 'rider', title: 'Delivery Rider', tier: 0, salary: 16500 },
    { id: 'shopassist', title: 'Shop Assistant', tier: 0, salary: 15500 },

    { id: 'callcentre', title: 'Call Centre Agent', tier: 1, salary: 26000 },
    { id: 'salesrep', title: 'Sales Representative', tier: 1, salary: 28500 },
    { id: 'security', title: 'Security Officer', tier: 1, salary: 27000 },
    { id: 'clerk', title: 'Office Clerk', tier: 1, salary: 29000 },

    { id: 'electrician', title: 'Electrician', tier: 2, salary: 41000 },
    { id: 'mechanic', title: 'Mechanic', tier: 2, salary: 38000 },
    { id: 'chef', title: 'Chef', tier: 2, salary: 36000 },
    { id: 'welder', title: 'Welder', tier: 2, salary: 40000 },
    { id: 'stylist', title: 'Hair Stylist', tier: 2, salary: 35000 },

    { id: 'developer', title: 'Software Developer', tier: 3, salary: 68000 },
    { id: 'nurse', title: 'Nurse', tier: 3, salary: 56000 },
    { id: 'accountant', title: 'Accountant', tier: 3, salary: 58000 },
    { id: 'engineer', title: 'Engineer', tier: 3, salary: 70000 },
    { id: 'teacher', title: 'Teacher', tier: 3, salary: 45000 },
    { id: 'designer', title: 'Designer', tier: 3, salary: 51000 },
    { id: 'journalist', title: 'Journalist', tier: 3, salary: 44000 }
  ];

  const TEEN_JOBS = [
    { id: 'shophelper', title: 'Shop Helper', tier: 0, salary: 3200, teen: true },
    { id: 'tutor', title: 'Junior Tutor', tier: 0, salary: 3800, teen: true },
    { id: 'runner', title: 'Errand Runner', tier: 0, salary: 3000, teen: true }
  ];

  const LEVEL_NAMES = ['Junior ', '', 'Senior ', 'Lead '];

  /* ---------- activities (2 energy per year) ---------- */

  const ACTIVITIES = [
    {
      id: 'study', name: 'Study or read', desc: 'Sharpen your mind.', min: 5,
      out: [
        ow(80, 'You get lost in a good book and come out knowing more than when you went in.', { i: () => rnd(3, 6) }),
        ow(20, 'You study hard, but not much sticks. Some days are like that.', { i: 1, p: -1 })
      ]
    },
    {
      id: 'exercise', name: 'Work out', desc: 'Run, lift, or play a sport.', min: 8,
      out: [
        ow(85, 'A solid session. You are tired, strong, and a little proud.', { h: () => rnd(4, 8), p: 2 }),
        ow(15, 'You overdo it and pay for it with sore muscles for a week.', { h: 1, p: -1 })
      ]
    },
    {
      id: 'socialize', name: 'See your people', desc: 'Time with friends builds your name.', min: 5,
      out: [
        ow(85, 'Good food, loud laughter, and plans nobody will remember. Perfect.', { r: () => rnd(2, 4), p: () => rnd(2, 5) }, { bond: { friend: 5 } }),
        ow(15, 'It turns into an awkward evening, but you still showed up.', { r: 1, p: 1 }, { bond: { friend: 2 } })
      ]
    },
    {
      id: 'rest', name: 'Rest and reset', desc: 'Slow down on purpose.', min: 5,
      out: [
        ow(90, 'You switch everything off for a day. The quiet does you good.', { p: () => rnd(4, 8), h: 1 }),
        ow(10, 'You cannot switch your brain off, but resting still helps a little.', { p: 2 })
      ]
    },
    {
      id: 'doctor', name: 'Doctor visit', desc: 'A checkup and a good talking-to.', min: 1,
      cost: s => (s.age < 18 ? 0 : Math.min(900, 120 + s.age * 8)),
      out: [
        ow(90, 'The doctor looks you over, adjusts a few things, and sends you off feeling better.', { h: () => rnd(8, 14) }),
        ow(10, 'Mostly fine, says the doctor. Drink more water.', { h: 4, p: 1 })
      ]
    },
    {
      id: 'overtime', name: 'Extra shifts', desc: 'Trade energy for money.', min: 15,
      req: s => !!s.job, reqText: 'You need a job first.',
      out: [
        ow(90, 'You pick up extra shifts. The paycheck is bigger. So are the bags under your eyes.', { m: s => Math.round(s.job.salary * 0.08), p: -2, h: -1 }),
        ow(10, 'A manager notices your effort and adds a bonus.', { m: s => Math.round(s.job.salary * 0.12), r: 2, h: -1 })
      ]
    },
    {
      id: 'volunteer', name: 'Volunteer', desc: 'Help out where it counts.', min: 12,
      out: [
        ow(1, 'You spend weekends helping the neighbourhood. People remember it.', { r: () => rnd(3, 6), p: () => rnd(2, 4) })
      ]
    },
    {
      id: 'hustle', name: 'Side hustle', desc: 'Try to make a little extra cash.', min: 14,
      out: [
        ow(70, 'You find a few customers and make some extra money.', { m: () => rnd(150, 650), i: 1 }),
        ow(30, 'Nobody bites this time. You learn something anyway.', { i: 1, p: -1 })
      ]
    },
    {
      id: 'trip', name: 'Weekend trip', desc: 'See somewhere new.', min: 10,
      cost: s => (s.age < 18 ? 0 : 700),
      out: [
        ow(1, 'A change of scenery clears your head and fills your phone with photos.', { p: () => rnd(5, 9), i: 2 }, { inc: { travel: 1 } })
      ]
    },
    {
      id: 'gamble', name: 'Try your luck', desc: 'Risk some money on a bet.', min: 18,
      req: s => s.money >= 250, reqText: 'You need at least $250.',
      out: [
        ow(42, 'Luck is on your side tonight. You walk out ahead.', { m: () => rnd(180, 520), p: 3 }),
        ow(58, 'The house wins. You walk out lighter and a bit wiser.', { m: () => -rnd(80, 250), p: -2 })
      ]
    }
  ];

  /* ---------- achievements ---------- */

  const ACHIEVEMENTS = [
    { id: 'first-loop', name: 'First Loop', desc: 'Complete your first life.', icon: '◯', check: s => !s.alive },
    { id: 'graduate', name: 'Graduate', desc: 'Earn a university degree.', icon: '🎓', check: s => s.edu >= 3 },
    { id: 'six-figures', name: 'Six Figures', desc: 'Hold $100,000 at once.', icon: '💰', check: s => s.peak.money >= 100000 },
    { id: 'millionaire', name: 'Millionaire', desc: 'Hold $1,000,000 at once.', icon: '💎', check: s => s.peak.money >= 1000000 },
    { id: 'genius', name: 'Big Brain', desc: 'Reach 90 intelligence.', icon: '🧠', check: s => s.peak.intelligence >= 90 },
    { id: 'beloved', name: 'Beloved', desc: 'Reach 90 reputation.', icon: '🌟', check: s => s.peak.reputation >= 90 },
    { id: 'pure-joy', name: 'Pure Joy', desc: 'Reach 98 happiness.', icon: '☀️', check: s => s.peak.happiness >= 98 },
    { id: 'soulmate', name: 'Soulmate', desc: 'Get married.', icon: '💍', check: s => !!s.flags.married },
    { id: 'parent', name: 'Parent', desc: 'Have a child.', icon: '🍼', check: s => s.people.some(p => p.role === 'child') },
    { id: 'ride-or-die', name: 'Ride or Die', desc: 'Reach a 95 bond with a friend.', icon: '🤝', check: s => s.people.some(p => p.role === 'friend' && p.bond >= 95) },
    { id: 'founder', name: 'Founder', desc: 'Build a business that works.', icon: '🚀', check: s => !!s.flags.founder },
    { id: 'boss-level', name: 'Boss Level', desc: 'Reach the top rung of a career.', icon: '👔', check: s => !!s.flags.topLevel },
    { id: 'eighty', name: 'Still Going', desc: 'Live to 80.', icon: '🎂', check: s => s.age >= 80 },
    { id: 'centenarian', name: 'Centenarian', desc: 'Live to 100.', icon: '🏆', check: s => s.age >= 100 },
    { id: 'comeback', name: 'Comeback', desc: 'Recover from near-death health.', icon: '❤️', check: s => !!s.flags.comeback },
    { id: 'globetrotter', name: 'Globetrotter', desc: 'Take three trips or more.', icon: '🌍', check: s => (s.flags.travel || 0) >= 3 },
    { id: 'giving-heart', name: 'Giving Heart', desc: 'Give a large gift to charity.', icon: '🎁', check: s => !!s.flags.donated },
    { id: 'pet-lover', name: 'Pet Lover', desc: 'Reach a 90 bond with a pet.', icon: '🐾', check: s => s.people.some(p => p.role === 'pet' && p.bond >= 90) },
    { id: 'rags-to-riches', name: 'Rags to Riches', desc: 'Start poor and hold $100,000.', icon: '📈', check: s => s.family === 0 && s.peak.money >= 100000 }
  ];

  /* ---------- events ---------- */

  const EVENTS = [

    /* ===== BABY ===== */

    {
      id: 'birth', min: 0, max: 0, force: 100, once: true, title: 'Welcome to the world',
      text: s => 'You are born in {city}, into ' + FAMILY_TEXT[s.family] + '. {mom} and {dad} look at you like you are the best thing that has ever happened. How do you introduce yourself?',
      choices: [
        c('Cry as loudly as possible', o('Your lungs work perfectly. The whole ward knows you have arrived, and {mom} laughs through happy tears.', { h: 3, p: 2 }, { bond: { mom: 8 } })),
        c('Fall asleep in {mom}\'s arms', o('You drift off, warm and calm. {mom} says you were the easiest baby on the ward.', { h: 2, p: 4 }, { bond: { mom: 10, dad: 4 } })),
        c('Stare at everything', o('Wide eyes, no blinking. The nurse says you look like you are already studying the room.', { i: 4, p: 1 }, { bond: { dad: 8 } }))
      ]
    },

    {
      id: 'firstWords', min: 1, max: 2, once: true, w: 20, title: 'First words',
      text: 'Everyone has been waiting for this. {mom} and {dad} hover over you, phones out, hoping you will say something.',
      choices: [
        c('Say "Mama"', o('{mom} cries. {dad} pretends he is not jealous.', { p: 4 }, { bond: { mom: 10 } })),
        c('Say "Dada"', o('{dad} tells everyone he knows. For a week.', { p: 4 }, { bond: { dad: 10 } })),
        c('Babble something nobody understands', o('It sounds important. Everyone agrees you are probably a genius.', { i: 4, p: 2 }))
      ]
    },

    {
      id: 'tummyBug', min: 1, max: 4, once: true, title: 'Tummy trouble',
      text: 'You wake up crying and your stomach is a disaster. {mom} carries you to the clinic at two in the morning.',
      choices: [
        c('Cry until someone fixes it', o('It works. A nurse arrives with medicine and a sticker.', { h: -2, p: -1 }, { bond: { mom: 5 } })),
        c('Hold on to {mom} and be brave', o('You fall asleep on her shoulder. By morning, you are fine.', { h: 1, p: 2 }, { bond: { mom: 8 } })),
        c('Throw up on the doctor', o('A moment nobody will ever forget. You feel much better afterwards.', { h: 2, r: 1 }))
      ]
    },

    {
      id: 'toddler', min: 3, max: 4, once: true, w: 14, title: 'Little explorer',
      text: 'You have discovered that you can walk and that nothing at home is truly out of reach.',
      choices: [
        c('Climb the bookshelf', [
          ow(55, 'You make it to the top, king of the living room. {dad} lifts you down, laughing and horrified.', { p: 4, h: 1 }),
          ow(45, 'Gravity wins. Lots of tears, one bruise, and a lecture you do not understand.', { h: -6, p: -2 }, { bond: { dad: 3 } })
        ]),
        c('Stack blocks for an hour', o('You build a tower taller than yourself. Nobody is allowed to touch it.', { i: 5, p: 2 })),
        c('Chase the neighbour\'s chickens', o('Chaos, feathers, and the best afternoon of your short life.', { h: 4, p: 4 }))
      ]
    },

    /* ===== CHILD ===== */

    {
      id: 'firstDay', min: 5, max: 6, force: 60, once: true, title: 'First day of school',
      text: 'Your uniform is too big and your bag is too heavy. The classroom smells like chalk and floor polish. Everyone looks as nervous as you feel.',
      choices: [
        c('Say hi to someone', o('You walk up to a kid chewing a pencil and say hello. By lunch, {new} is saving you a seat.', { p: 5, r: 2 }, { add: { role: 'friend' } })),
        c('Sit at the front and listen', o('Your teacher notices. "Good attention," she writes in your book.', { i: 5, r: 1 })),
        c('Run around at break time', o('You race around the whole playground and come home sweaty, scraped, and thrilled.', { h: 4, p: 4 }))
      ]
    },

    {
      id: 'hobby', min: 6, max: 10, once: true, w: 30, title: 'Something catches your attention',
      text: 'Over the next few months, one thing keeps pulling you back. What is it?',
      choices: [
        c('Music', o('You bang on a borrowed keyboard until {mom} negotiates a truce. You are hooked.', { p: 5, i: 2 }, { flags: { hobby: 'music' } })),
        c('Football', o('You play until the streetlights come on. Your knees are scabbed and you have never been happier.', { h: 5, p: 4 }, { flags: { hobby: 'sport' } })),
        c('Drawing', o('Your notebooks fill with dragons, cars, and unflattering portraits of your family.', { p: 4, i: 3 }, { flags: { hobby: 'art' } })),
        c('Building things on a computer', o('You figure out how to make a tiny game. It barely works, but it is yours.', { i: 6, p: 2 }, { flags: { hobby: 'tech' } }))
      ]
    },

    {
      id: 'hangout', min: 6, max: 12, cool: 3, title: 'A friend calls',
      text: '{friend} knocks on the gate and asks if you can come out. It is a Saturday, and you could do anything.',
      choices: [
        c('Go out with {friend}', o('You spend the whole day outside. Dirt, laughter, and a game with rules that keep changing.', { p: 6, h: 2 }, { bond: { friend: 10 } })),
        c('Stay home and study', o('You get ahead on your homework. It feels grown-up, if a little lonely.', { i: 5, p: -1 }, { bond: { friend: -2 } })),
        c('Invite {friend} over', o('{mom} makes snacks, and the two of you build a fort that ruins the living room.', { p: 5, r: 1 }, { bond: { friend: 8, mom: 3 } }))
      ]
    },

    {
      id: 'bully', min: 7, max: 12, once: true, title: 'The big kid',
      text: 'A bigger kid has started taking your snacks at break. Today he comes for your whole lunch.',
      choices: [
        c('Stand up to him', [
          ow(55, 'You plant your feet and say no. He backs off, surprised. Word gets around.', { r: 6, p: 4 }),
          ow(45, 'He shoves you hard. You get a scraped elbow and a lot of attention from the teacher.', { h: -4, r: 2, p: -2 })
        ]),
        c('Tell your teacher', o('The teacher deals with it quickly. It is not glamorous, but it works.', { p: 3, r: -1 }, { bond: { mom: 2 } })),
        c('Avoid him', o('You take a different route every day. It works, mostly, but it eats at you.', { p: -4, h: -1 }))
      ]
    },

    {
      id: 'examWeek', min: 8, max: 12, cool: 3, title: 'Exam week',
      text: 'Test papers are coming, and your teacher has made it very clear that they count.',
      choices: [
        c('Study all night', o('You cram until your eyes sting. The results are great. The sleep debt is not.', { i: 6, h: -3, p: -2 })),
        c('Review a little every day', o('Calm and steady. You do well and keep your weekends.', { i: 5, p: 2 })),
        c('Wing it', [
          ow(s => 15 + s.intelligence / 2, 'Somehow the answers come to you. You walk out grinning and slightly confused.', { i: 2, p: 4 }),
          ow(s => 85 - s.intelligence / 2, 'It goes badly. Your teacher writes "see me" on the paper.', { i: -1, p: -4, r: -1 })
        ])
      ]
    },

    {
      id: 'pet', min: 6, max: 11, once: true, w: 14, title: 'Can we get a pet?',
      text: 'You have been asking for months. Tonight, {dad} says that if you really want one, you can choose.',
      choices: [
        c('A dog', o('A scruffy ball of energy named {new} runs straight into your arms and refuses to leave.', { p: 8, h: 2 }, { add: { role: 'pet', kind: 'Dog', bond: 75 } })),
        c('A cat', o('{new} stares at you for an hour, then decides you are acceptable. You feel honoured.', { p: 7 }, { add: { role: 'pet', kind: 'Cat', bond: 70 } })),
        c('No pet, thanks', o('You decide it is too much responsibility. {dad} nods, impressed and a bit relieved.', { i: 2 }, { bond: { dad: 3 } }))
      ]
    },

    {
      id: 'talentShow', min: 7, max: 12, once: true, cond: s => !!s.flags.hobby, title: 'The school talent show',
      text: 'Your teacher is putting together a talent show. Everyone knows you have been spending your time on {hobby}.',
      choices: [
        c('Sign up and perform', [
          ow(s => 30 + s.intelligence / 3 + s.reputation / 4, 'You absolutely nail it. The hall erupts, and kids you have never met are suddenly your fans.', { r: 8, p: 8 }, { bond: { mom: 4, dad: 4 } }),
          ow(s => 70 - s.intelligence / 3 - s.reputation / 4, 'Your nerves take over and everything goes wrong. But you finish, and some kids still clap.', { r: -2, p: -3, i: 1 })
        ]),
        c('Help backstage', o('You run the music and the lights. Nobody notices you, which is exactly the job.', { i: 3, r: 2, p: 2 })),
        c('Cheer from the audience', o('You clap the loudest for {friend}. It is a good night to be in the crowd.', { p: 4 }, { bond: { friend: 6 } }))
      ]
    },

    {
      id: 'foundMoney', min: 6, max: 12, once: true, title: 'Money on the road',
      text: 'You spot a crumpled bill on the pavement. Nobody is around. It is enough to buy a lot of sweets.',
      choices: [
        c('Keep it', o('You buy sweets for a week. They taste a little bit like guilt.', { m: 20, p: 3, r: -1 })),
        c('Hand it in', o('The shopkeeper stares at you and shakes your hand like an adult. Word travels fast.', { r: 5, p: 2 })),
        c('Share it with {friend}', o('You split it fifty-fifty and eat ice cream on the kerb.', { m: 10, p: 5 }, { bond: { friend: 8 } }))
      ]
    },

    {
      id: 'familyTrip', min: 5, max: 12, cool: 6, title: 'Family trip',
      text: '{mom} and {dad} announce a weekend away. You get a vote on where.',
      choices: [
        c('The beach', o('Sand in everything, sunburn on your nose, and the best sunset of the year.', { p: 7, h: 2 }, { bond: { mom: 5, dad: 5 } })),
        c('See your grandparents', o('Your grandmother feeds you until you cannot move. Your grandfather tells the same story three times. You love it.', { p: 5, i: 2 }, { bond: { mom: 3, dad: 3 } })),
        c('Stay home', o('You get the house to yourself while they are out. It feels like a secret holiday.', { p: 3, i: 2 }))
      ]
    },

    {
      id: 'sportsDay', min: 6, max: 12, once: true, title: 'Sports day',
      text: 'The whole school is on the field. The relay race is about to start.',
      choices: [
        c('Run the final leg', [
          ow(s => 25 + s.health / 2, 'You grab the baton and fly. Your house wins by half a step.', { r: 6, p: 7, h: 2 }),
          ow(s => 75 - s.health / 2, 'You trip near the finish line. You laugh it off, but your ears are still hot.', { r: -1, p: -2, h: -2 })
        ]),
        c('Cheer for your team', o('You scream yourself hoarse. Your voice is gone, but your team still carries you shoulder-high.', { p: 4, r: 2 })),
        c('Help organise the races', o('You run around with a clipboard and a whistle. You like the order of it.', { i: 3, r: 3 }))
      ]
    },

    /* ===== TEEN ===== */

    {
      id: 'socialMedia', min: 13, max: 17, once: true, w: 14, title: 'Everyone is online',
      text: 'Your whole class is on one app, and your phone buzzes every few minutes. You can feel it pulling at you.',
      choices: [
        c('Post everything', [
          ow(55, 'Your posts take off. Strangers like your jokes, and you feel a little bit famous.', { r: 7, p: 4, i: -2 }),
          ow(45, 'One post goes wrong in front of the whole school. You wish you could delete it from every phone.', { r: -5, p: -6 })
        ]),
        c('Keep your account private', o('You post rarely and only for close friends. It feels calm.', { p: 3, i: 1 })),
        c('Delete the apps for a while', o('You get your evenings back. At first it feels strange. Then it feels great.', { i: 4, h: 2, r: -1 }))
      ]
    },

    {
      id: 'crush', min: 13, max: 17, once: true, w: 14, cond: s => !partnerOf(s), title: 'Butterflies',
      text: 'There is someone in your class you cannot stop thinking about. Your hands go cold every time they talk to you.',
      choices: [
        c('Tell them how you feel', [
          ow(s => 25 + s.reputation / 3 + s.happiness / 5, '{new} smiles and says they feel the same way. Your heart attempts to leave your chest.', { p: 10, r: 2 }, { add: { role: 'partner', bond: 60 } }),
          ow(s => 75 - s.reputation / 3 - s.happiness / 5, 'They say it is kind of you, but no. It stings for a week.', { p: -5, r: -1 })
        ]),
        c('Write them a note', o('You pass it along with shaking hands. They never mention it, but they smile at you more in the corridor.', { p: 3, r: 1 })),
        c('Keep it secret', o('You admire from a distance. It is a bit sad, but also safe.', { p: -1, i: 1 }))
      ]
    },

    {
      id: 'partTime', min: 15, max: 17, once: true, w: 14, title: 'A job offer',
      text: 'A shop owner on your street says she needs a hand after school. It does not pay much, but it pays.',
      choices: [
        c('Take the job', o('You work after class and carry the smell of the shop home with you. Your first paycheck feels amazing.', { m: 0, r: 2, p: 2, i: 1 }, { job: 'teen' })),
        c('Focus on school', o('You keep your evenings for homework. Your grades thank you.', { i: 5, p: -1 })),
        c('Sell snacks at school', [
          ow(65, 'You buy in bulk and sell at a markup. Your classmates are a loyal market.', { m: () => rnd(60, 180), r: 3, i: 1 }),
          ow(35, 'A teacher confiscates the whole stock. You lose your investment.', { m: -40, r: -2, p: -3 })
        ])
      ]
    },

    {
      id: 'party', min: 14, max: 17, cool: 3, title: 'Big party',
      text: '{friend} is hosting a party this weekend. Everyone will be there, and nobody can talk about anything else.',
      choices: [
        c('Stay until sunrise', [
          ow(60, 'The night is loud and perfect. You get home just as the birds start singing.', { p: 7, r: 4, h: -3 }),
          ow(40, 'Things get out of hand. You spend Sunday apologising to your parents.', { p: -2, r: -2, h: -3 }, { bond: { mom: -4, dad: -4 } })
        ]),
        c('Go but leave early', o('You enjoy the best part and get home at a sensible time. Nobody mocks you for it.', { p: 4, r: 2 }, { bond: { friend: 3 } })),
        c('Skip it', o('You stay in with snacks and a movie. Missing it feels weird for exactly one hour.', { p: 2, i: 2 }, { bond: { friend: -3 } }))
      ]
    },

    {
      id: 'tryouts', min: 13, max: 17, once: true, title: 'Team tryouts',
      text: 'Your school is picking a team for the regional tournament. The notice board has a long list.',
      choices: [
        c('Try out', [
          ow(s => 25 + s.health / 2 + (s.flags.hobby === 'sport' ? 20 : 0), 'You make the team. The coach says you have a real engine.', { h: 5, r: 6, p: 6 }),
          ow(s => 75 - s.health / 2 - (s.flags.hobby === 'sport' ? 20 : 0), 'You do not make the cut, but the coach tells you to try again next year.', { p: -3, h: 2 })
        ]),
        c('Join the school club instead', o('You find your people in a room full of snacks and spirited debates.', { i: 4, r: 3, p: 3 })),
        c('Watch from the stands', o('You cheer for your friends and catch every play. It is a decent view.', { p: 2 }))
      ]
    },

    {
      id: 'finals', min: 17, max: 17, force: 90, once: true, title: 'Final exams',
      text: 'It is the end of secondary school. Every exam you have taken so far has been leading to this week.',
      choices: [
        c('Study like your life depends on it', [
          ow(s => 55 + s.intelligence / 2, 'You pass, with marks that make your teachers smile.', { i: 5, p: 5, r: 3 }, { edu: 1 }),
          ow(s => 45 - s.intelligence / 2 + 10, 'The pressure gets to you. You scrape through, barely.', { i: 2, p: -2, h: -2 }, { edu: 1 })
        ]),
        c('Study smart and sleep well', [
          ow(s => 45 + s.intelligence / 2 + 8, 'Calm and prepared, you pass and feel great.', { i: 4, p: 5 }, { edu: 1 }),
          ow(s => 55 - s.intelligence / 2 - 8, 'You miss a couple of important topics and fall short. You will have to retake.', { p: -6, i: 1 })
        ]),
        c('Hope for the best', [
          ow(s => 15 + s.intelligence / 2, 'Pure luck. You somehow pass.', { p: 4 }, { edu: 1 }),
          ow(s => 85 - s.intelligence / 2, 'It does not go well. Your parents are quiet at dinner.', { p: -8, i: -1 }, { bond: { mom: -3, dad: -3 } })
        ])
      ]
    },

    {
      id: 'prank', min: 13, max: 16, once: true, title: 'The prank',
      text: '{friend} has a plan to prank a teacher. It is a really good one. It is also definitely against the rules.',
      choices: [
        c('Pull it off together', [
          ow(60, 'It works perfectly. The school talks about it for months.', { r: 6, p: 6 }, { bond: { friend: 10 } }),
          ow(40, 'You get caught. Detention, a letter home, and a very long conversation with {mom}.', { r: -3, p: -4 }, { bond: { friend: 4, mom: -5 } })
        ]),
        c('Say no', o('{friend} rolls their eyes but does not push. You sleep well that night.', { i: 2, p: 1 }, { bond: { friend: -2 } })),
        c('Take the blame when it goes wrong', o('You step up when the teacher asks who did it. It costs you detention, and earns you a friend for life.', { r: 3, p: -2 }, { bond: { friend: 14 } }))
      ]
    },

    {
      id: 'driving', min: 16, max: 17, once: true, title: 'Behind the wheel',
      text: 'Your driving instructor has the patience of a saint. You do not know how long it will last.',
      choices: [
        c('Practise carefully', o('Mirror, signal, manoeuvre. You pass the test on the first try.', { i: 3, p: 5, r: 1 })),
        c('Drive fast and loose', [
          ow(60, 'You love it. The instructor does not, but you pass anyway.', { p: 5, r: 1 }),
          ow(40, 'You clip a bollard and spend the afternoon filling in forms.', { p: -2, h: -3, m: -80 })
        ]),
        c('Put it off', o('You decide to wait until you are older. Buses will do for now.', { p: -1 }))
      ]
    },

    {
      id: 'parentsClash', min: 13, max: 17, cool: 4, title: 'A fight at home',
      text: 'It starts with the dishes and ends with raised voices. {mom} wants to know why you are always on your phone.',
      choices: [
        c('Apologise', o('It is hard to say the words, but it works. You have a quiet talk after dinner.', { p: 2, i: 1 }, { bond: { mom: 8, dad: 4 } })),
        c('Stand your ground', o('You say what you really think. Nobody wins, but they listen.', { p: -2, r: 1 }, { bond: { mom: -4, dad: -3 } })),
        c('Storm over to {friend}\'s house', o('{friend} lets you vent. You come home in the morning, calmer and embarrassed.', { p: 2 }, { bond: { friend: 6, mom: -3 } }))
      ]
    },

    {
      id: 'dance', min: 15, max: 17, once: true, title: 'The end-of-term dance',
      text: 'There is a dance at the end of the term. Everyone is talking about it. Everyone has a plan. You are not sure you do.',
      choices: [
        c('Ask someone to go', [
          ow(55, 'They say yes. The night is awkward, loud, and wonderful.', { p: 8, r: 3 }),
          ow(45, 'They already have plans. You decide to go anyway.', { p: -2, r: 1 })
        ]),
        c('Go with your friends', o('You turn up as a group and dance badly in a circle. It is perfect.', { p: 7, r: 2 }, { bond: { friend: 8 } })),
        c('Skip it', o('Your night is quiet. You do not mind that much.', { p: 1, i: 2 }))
      ]
    },

    /* ===== YOUNG ADULT ===== */

    {
      id: 'whatsNext', min: 18, max: 18, force: 80, once: true, cond: s => s.edu >= 1, title: 'What happens now?',
      text: 'School is over. Your whole life stretches in front of you, and everyone has an opinion on what you should do with it.',
      choices: [
        c('Go to university', o('You get in and pack your bags. Four years of lectures, late nights, and new ideas are waiting.', { i: 4, p: 5 }, { flags: { uni: 4 } })),
        c('Learn a trade', o('You join a two-year programme and start learning with your hands. It feels real.', { i: 2, p: 4 }, { flags: { trade: 2 } })),
        c('Start working', o('You get a job and start earning right away.', { p: 3, m: 0 }, { job: 1 })),
        c('Take a gap year', o('You travel, work odd jobs, and learn more about yourself than any classroom could teach.', { p: 8, i: 3, m: s => (s.family === 0 ? 0 : s.family === 1 ? 1500 : 6000) }, { inc: { travel: 1 } }))
      ]
    },

    {
      id: 'whatsNextNoEdu', min: 18, max: 18, force: 80, once: true, cond: s => s.edu < 1, title: 'A second chance',
      text: 'Your exam results did not go the way you hoped. Your family is supportive, but you can feel the pressure.',
      choices: [
        c('Retake the exams', [
          ow(s => 40 + s.intelligence / 2, 'You work hard all year and pass. Doors that were closed are suddenly open.', { i: 4, p: 6 }, { edu: 1 }),
          ow(s => 60 - s.intelligence / 2, 'It is another near miss. You try not to let it break you.', { p: -4 })
        ]),
        c('Start working', o('You take any job you can get. It is a start.', { p: 1 }, { job: 0 })),
        c('Start a small hustle', [
          ow(50, 'People like what you sell. It is small, but it is yours.', { m: () => rnd(200, 900), r: 4, p: 5 }),
          ow(50, 'Money goes out faster than it comes in. You learn the hard way.', { m: -150, p: -3, i: 2 })
        ])
      ]
    },

    {
      id: 'uniCrunch', min: 19, max: 22, cool: 1, cond: s => !!s.flags.uni, title: 'Crunch time at university',
      text: 'Deadlines are stacking up. You have three assignments, one exam, and a social life that is quietly dying.',
      choices: [
        c('Pull all-nighters', o('Coffee, panic, and a brain that finally works at 4 a.m. You scrape through with strong marks.', { i: 6, h: -4, p: -3 })),
        c('Pay for a tutor', o('Your tutor helps you work smarter. It costs money, but it saves your semester.', { i: 5, m: -300, p: 1 }, { })),
        c('Drop out', o('You decide it is not for you. You walk out of the lecture hall and into an uncertain future.', { p: -4, i: 1 }, { fn: s => { delete s.flags.uni; }, job: 'best' }), { reqText: '' })
      ]
    },

    {
      id: 'meetSomeone', min: 18, max: 38, cool: 4, w: 14, cond: s => !partnerOf(s), title: 'Someone new',
      text: 'There is someone at a friend\'s place who makes you laugh. It has been a while since that happened.',
      choices: [
        c('Say hello', [
          ow(s => 35 + s.reputation / 3 + s.happiness / 6, '{new} laughs at your first joke. By the end of the night you have swapped numbers.', { p: 9, r: 2 }, { add: { role: 'partner', bond: 55 } }),
          ow(s => 65 - s.reputation / 3 - s.happiness / 6, 'The conversation fizzles. You walk home with an odd mix of embarrassment and relief.', { p: -2 })
        ]),
        c('Try a dating app', [
          ow(50, 'After a few awkward chats, you meet {new}. Coffee turns into dinner.', { p: 7, m: -40 }, { add: { role: 'partner', bond: 50 } }),
          ow(50, 'Three bad dates and one ghosting later, you close the app.', { p: -4, m: -60 })
        ]),
        c('Focus on yourself', o('You decide your own company is more than enough for now. You use the time well.', { p: 3, i: 3, h: 2 }))
      ]
    },

    {
      id: 'movingOut', min: 19, max: 26, once: true, cond: s => !!s.flags.withFamily && !student(s), title: 'Time to leave the nest?',
      text: '{mom} says nothing, but you can hear her sighing every time you leave your socks on the floor.',
      choices: [
        c('Rent your own flat', o('Your keys, your rules, your rent. It feels amazing and terrifying.', { p: 6, r: 1 }, { fn: s => { delete s.flags.withFamily; } })),
        c('Stay and save money', o('You stay for another year and your savings grow. {mom} makes your favourite food.', { m: 1500, p: 1 }, { bond: { mom: 5 } })),
        c('Share a flat with {friend}', o('Between the two of you, the flat is always a mess. It is also always fun.', { p: 6, m: -300 }, { bond: { friend: 10 }, fn: s => { delete s.flags.withFamily; } }))
      ]
    },

    {
      id: 'businessIdea', min: 22, max: 50, cool: 10, w: 8, title: 'A business idea',
      text: 'You cannot stop thinking about it. A small business, something that is yours, and something people actually want.',
      choices: [
        c('Invest your savings', [
          ow(s => 25 + s.intelligence / 3 + s.reputation / 4, 'It works better than you ever expected. Customers come back, and word spreads.', { m: s => Math.round(8000 + s.intelligence * 150), r: 8, p: 9 }, { flags: { founder: true } }),
          ow(s => 75 - s.intelligence / 3 - s.reputation / 4, 'The numbers never add up. You close the doors, poorer and wiser.', { m: -4000, p: -8, i: 3 })
        ], { req: s => s.money >= 3000, reqText: 'Needs $3,000 saved' }),
        c('Test it on a small scale first', [
          ow(60, 'A weekend stall brings in a few loyal customers. It is not much, but it is real.', { m: () => rnd(300, 1200), p: 4, i: 2 }),
          ow(40, 'Nobody notices. You pack up early and regroup.', { p: -2, i: 2 })
        ]),
        c('Let it go', o('It was just an idea anyway. But it keeps visiting you in the shower.', { p: -2 }))
      ]
    },

    {
      id: 'proposal', min: 22, max: 45, once: true, w: 20, cond: s => has(s, 'partner') && bondOf(s, 'partner') >= 60, title: 'The question',
      text: 'You and {partner} have been together a while now. It is obvious where this is going, and you both know it.',
      choices: [
        c('Propose', [
          ow(85, '{partner} says yes, crying and laughing at the same time. Your whole family cries with you.', { p: 15, r: 3, m: -1200 }, { upgrade: { from: 'partner', to: 'spouse' }, flags: { married: true }, bond: { spouse: 15 } }),
          ow(15, '{partner} needs more time. It hurts, but you decide to wait together.', { p: -6 }, { bond: { partner: -10 } })
        ], { }),
        c('Wait a bit longer', o('There is no rush. You keep dating, and keep growing.', { p: 2 }, { bond: { partner: 3 } })),
        c('End the relationship', o('You both know something is missing. The conversation is calm and awful.', { p: -9 }, { end: { role: 'partner', why: 'broke up with you' } }))
      ]
    },

    {
      id: 'restless', min: 24, max: 31, once: true, title: 'Restless',
      text: 'Everything is fine, on paper. You have a routine, a place, a plan. And yet you keep staring out of windows.',
      choices: [
        c('Take a solo trip', o('You get lost in a city that does not speak your language. You find yourself in the process.', { p: 9, i: 3, m: -900 }, { inc: { travel: 1 } }), { req: s => s.money >= 900, reqText: 'Needs $900' }),
        c('Try a new career', o('You apply for something completely different. It is a rocky start, but it feels alive.', { p: 4, i: 2 }, { job: 'best' })),
        c('Stay the course', o('You stay. Routine has its own comfort.', { p: 1, h: 1 }))
      ]
    },

    {
      id: 'friendInNeed', min: 20, max: 60, cool: 8, cond: s => has(s, 'friend') && s.money >= 600, title: 'A favour',
      text: '{friend} calls late. Their voice is shaky. They need $500, and they say they will pay you back.',
      choices: [
        c('Lend the money', [
          ow(65, '{friend} pays you back with interest and a hug. The friendship is stronger than ever.', { m: 100, p: 3 }, { bond: { friend: 12 } }),
          ow(35, 'Months pass. The money never comes back, and neither does your old ease with {friend}.', { m: -500, p: -3 }, { bond: { friend: -6 } })
        ]),
        c('Give a smaller gift', o('You hand over $100 and a hug. {friend} is thankful, and no strings are attached.', { m: -100, p: 2, r: 1 }, { bond: { friend: 8 } })),
        c('Say no', o('You cannot do it. {friend} says they understand. They do not sound like they do.', { p: -3 }, { bond: { friend: -10 } }))
      ]
    },

    {
      id: 'viral', min: 18, max: 45, cool: 15, title: 'Your moment',
      text: 'A video of you goes viral overnight. You wake up with thousands of notifications and a message from a stranger.',
      choices: [
        c('Lean into it', [
          ow(60, 'You ride the wave. Brands come calling, and your name is suddenly well known.', { r: 10, m: 1500, p: 6 }),
          ow(40, 'Attention is a double-edged sword. Strangers love you, and a few strangers hate you.', { r: 4, p: -5 })
        ]),
        c('Ignore it', o('You put your phone down. In a week, the internet finds something new to talk about.', { p: 2, r: 1 })),
        c('Use it for a good cause', o('You turn the spotlight onto a cause you care about. People remember that.', { r: 8, p: 6, m: 200 }))
      ]
    },

    {
      id: 'lottery', min: 18, max: 80, cool: 6, w: 5, title: 'A lottery ticket',
      text: 'The shop owner slides a ticket across the counter. "Feeling lucky today?"',
      choices: [
        c('Buy it', [
          ow(1, 'JACKPOT. You check the numbers four times. Then you sit down on the floor of the shop.', { m: 50000, p: 20 }),
          ow(99, 'Nothing. The ticket joins a hundred others in a drawer at home.', { m: -5 })
        ]),
        c('Not today', o('You keep your money. You smile politely.', {})),
        c('Buy one for {friend}', o('{friend} laughs and says if it wins, you are splitting it.', { m: -5, p: 2 }, { bond: { friend: 4 } }))
      ]
    },

    /* ===== ADULT ===== */

    {
      id: 'promotion', min: 26, max: 60, cool: 4, cond: s => !!s.job && !s.job.teen && s.job.level < 3, title: 'A chance to move up',
      text: 'There is an opening for a more senior role at {job}. Your boss has not said a word about it.',
      choices: [
        c('Ask for the promotion', o('You prepare your case and walk into the office with your head high.', { r: 2 }, { promote: true })),
        c('Learn new skills first', o('You take evening classes and build your case slowly.', { i: 5, p: -1, h: -1 })),
        c('Stay put', o('You enjoy the work you have. Not everything has to be a climb.', { p: 3, h: 1 }))
      ]
    },

    {
      id: 'layoffs', min: 26, max: 62, cool: 10, cond: s => !!s.job && !s.job.teen, title: 'Layoffs rumour',
      text: 'The office is full of whispers. People are eating lunch in silence. Someone says management is making a list.',
      choices: [
        c('Update your CV', [
          ow(55, 'You find a better offer with a decent raise. You leave on good terms.', { p: 6, m: 1000 }, { fn: s => { s.job.salary = Math.round(s.job.salary * 1.12); } }),
          ow(45, 'Your search comes up empty, but you stay prepared. The layoffs do not reach you.', { p: -2, i: 2 })
        ]),
        c('Work harder than ever', o('You stay late and take on projects. Your name does not appear on the list.', { r: 4, h: -3, p: -2 })),
        c('Start a side business', o('You fill your evenings with a project of your own. It makes you feel safer.', { m: 400, p: 2, h: -2 }))
      ]
    },

    {
      id: 'baby', min: 24, max: 42, cool: 5, w: 18, cond: s => partnerOf(s) && s.people.filter(p => p.role === 'child').length < 3, title: 'Starting a family',
      text: '{partner} brings up the idea of a baby over dinner. The conversation lasts until midnight.',
      choices: [
        c('Yes, let us do it', o('Months later, a tiny person named {new} arrives. Nothing prepares you for this.', { p: 12, h: -2, m: -1500 }, { add: { role: 'child', age: 0, bond: 90 } })),
        c('Not yet', o('You agree to wait. It is the right call, even if it does not feel easy.', { p: 1 }, { bond: { spouse: 2, partner: 2 } })),
        c('Take a few months to think', o('You use the time to talk, plan, and dream. It strengthens the two of you.', { p: 3 }, { bond: { spouse: 5, partner: 5 } }))
      ]
    },

    {
      id: 'parentEvening', min: 26, max: 55, cool: 3, cond: s => kidsUnder(s, 18), title: 'Parents\' evening',
      text: '{kid}\'s teacher has asked to see you. Nobody says why. You spend the whole drive guessing.',
      choices: [
        c('Go and ask lots of questions', o('You learn a lot. {kid} sees you cheering them on, and it matters.', { p: 4, i: 1 }, { bond: { child: 10 } })),
        c('Send your partner', o('Your partner handles it well. You catch up later with a summary.', { p: 1 }, { bond: { child: -2 } })),
        c('Skip it', o('Work gets in the way again. {kid} says it is fine. It is not totally fine.', { p: -3 }, { bond: { child: -8 } }))
      ]
    },

    {
      id: 'midlife', min: 40, max: 52, once: true, w: 16, title: 'A strange feeling',
      text: 'You wake up one morning and ask yourself, quite seriously, whether this is it. The question will not go away.',
      choices: [
        c('Buy something flashy', o('A shiny new car makes you feel twenty again for about three weeks.', { m: -8000, p: 6, r: 3 }), { req: s => s.money >= 8000, reqText: 'Needs $8,000' }),
        c('Learn something new', o('You sign up for a class you always wanted to take. You are the oldest in the room and the most excited.', { i: 6, p: 5 })),
        c('Call old friends', o('You spend the weekend reconnecting with people you thought you had lost.', { p: 6, r: 2 }, { bond: { friend: 12 } }))
      ]
    },

    {
      id: 'healthScare', min: 38, max: 85, cool: 8, w: s => (s.health < 55 ? 22 : 8), title: 'A strange pain',
      text: 'There is a pain in your chest that comes and goes. It is probably nothing. But it is not nothing, is it?',
      choices: [
        c('See a doctor', o('Tests, scans, and a very quiet waiting room. The doctor catches it early. You walk out relieved.', { h: 12, p: 3, m: -600 }), { req: s => s.money >= 600, reqText: 'Needs $600' }),
        c('Ignore it', [
          ow(55, 'It fades on its own. You were probably just tired.', { p: 1 }),
          ow(39, 'The pain returns, worse. You end up in hospital and spend weeks recovering.', { h: -20, p: -8, m: -1500 }),
          ow(6, 'It was serious. By the time you reach the hospital, it is too late.', { h: -50 }, { die: 'a heart attack' })
        ], { hint: 'Risky' }),
        c('Change how you live', o('You eat better, walk more, and sleep properly. A year later, you feel like a new person.', { h: 10, p: 5 }))
      ]
    },

    {
      id: 'agingParents', min: 40, max: 62, cool: 8, cond: s => has(s, 'mom') || has(s, 'dad'), title: 'Your parents need you',
      text: 'The calls from home have changed. {mom} and {dad} are slower than they used to be, and they will not ask for help.',
      choices: [
        c('Move closer and care for them', o('It is exhausting, and the best thing you have ever done.', { p: -2, h: -2, r: 3 }, { bond: { mom: 12, dad: 12 } })),
        c('Visit more often', o('You call every night and drive over every weekend. They never say it, but they wait for you.', { p: 2 }, { bond: { mom: 8, dad: 8 } })),
        c('Pay for a carer', o('A kind nurse helps them every day. It costs money, but it brings peace of mind.', { m: -2500, p: 1 }, { bond: { mom: 3, dad: 3 } }), { req: s => s.money >= 2500, reqText: 'Needs $2,500' })
      ]
    },

    {
      id: 'windfall', min: 30, max: 70, cool: 12, w: 6, title: 'Unexpected money',
      text: 'A distant relative you barely remember has left you something in their will. It is not a fortune, but it is real.',
      choices: [
        c('Invest it', [
          ow(65, 'The market is kind. A few years later, your little windfall has grown quietly.', { m: 9000, p: 3 }),
          ow(35, 'The market is not kind. A chunk of it disappears.', { m: 2500, p: -2 })
        ]),
        c('Enjoy it', o('You treat yourself and the people you love. It is a great year.', { m: 3000, p: 9, r: 2 })),
        c('Share it with your family', o('You split it between those who need it most. The thanks you get are worth more than the cash.', { m: 1200, p: 6, r: 4 }, { bond: { mom: 6, dad: 6, child: 6 } }))
      ]
    },

    {
      id: 'marriageTrouble', min: 28, max: 75, cool: 6, w: 22, cond: s => has(s, 'spouse') && (bondOf(s, 'spouse') < 50 || !!s.flags.troubled), title: 'Cracks',
      text: 'You and {partner} have been sleeping in the same bed without really talking. Something has got to change.',
      choices: [
        c('Go to couples counselling', [
          ow(70, 'It is hard, and it is worth it. You learn to hear each other again.', { p: 6, m: -600 }, { bond: { spouse: 18 } }),
          ow(30, 'It helps a little, but not enough. The distance remains.', { p: -2, m: -600 }, { bond: { spouse: 4 } })
        ]),
        c('Have an honest heart-to-heart', o('It gets loud, then it gets quiet, then it gets honest. You both cry, and you both laugh.', { p: 4 }, { bond: { spouse: 12 } })),
        c('Pull away', o('You keep your head down and hope it fixes itself. It does not. {partner} packs a bag.', { p: -14 }, { end: { role: 'spouse', why: 'divorced you' }, flags: { married: false } }))
      ]
    },

    {
      id: 'community', min: 30, max: 65, cool: 12, title: 'Your community',
      text: 'The neighbourhood needs someone to step up and lead. There is a meeting tonight, and a seat at the front is empty.',
      choices: [
        c('Run for the council', [
          ow(s => 25 + s.reputation / 2, 'You win by a small margin. Your phone rings from morning to night, and you love it.', { r: 12, p: 5, h: -2 }),
          ow(s => 75 - s.reputation / 2, 'You lose, but you make friends and gather a lot of respect.', { r: 4, p: -2 })
        ]),
        c('Volunteer every Saturday', o('You help organise events and get to know every corner of your neighbourhood.', { r: 6, p: 5 })),
        c('Politely decline', o('You are busy enough. You wave from the back of the room.', { p: 1 }))
      ]
    },

    {
      id: 'reunion', min: 30, max: 70, cool: 10, cond: s => has(s, 'friend'), title: 'Reunion',
      text: 'A group chat you thought was dead has just come back to life. Someone is organising a reunion.',
      choices: [
        c('Go and stay all night', o('It is like no time has passed. You laugh until your face hurts.', { p: 8, r: 2 }, { bond: { friend: 14 } })),
        c('Go for an hour', o('You stay just long enough. It is nice, and slightly strange.', { p: 3 }, { bond: { friend: 5 } })),
        c('Stay home', o('You like the idea more than the reality. You watch their photos the next day.', { p: -1 }, { bond: { friend: -4 } }))
      ]
    },

    {
      id: 'burnout', min: 28, max: 62, cool: 6, cond: s => !!s.job && s.happiness < 50, title: 'Running on empty',
      text: 'You are good at your job, and it is eating you alive. Sundays are the worst part of the week.',
      choices: [
        c('Take a leave', o('You step away and sleep, walk, and breathe. It takes weeks, but you start to feel like yourself again.', { p: 12, h: 6, m: -1200 })),
        c('Push through', o('You push on. A month later, the cracks are bigger.', { p: -6, h: -6, r: 2 })),
        c('Quit', o('You hand in your notice. The weight lifts at once. The panic about money comes a day later.', { p: 6, h: 3 }, { job: 'quit' }))
      ]
    },

    {
      id: 'buyHouse', min: 28, max: 60, once: true, w: 12, cond: s => s.money >= 25000 && !s.flags.house, title: 'A place of your own',
      text: 'There is a small house on a quiet street. It has a yard, a leaking tap, and good light in the kitchen.',
      choices: [
        c('Buy it', o('You sign the papers with a shaky hand. Keys in your palm, you feel like an adult for real.', { m: -25000, p: 10, r: 2 }, { flags: { house: true } })),
        c('Keep renting', o('Freedom, flexibility, and a landlord who never fixes anything.', { p: 1 })),
        c('Invest in shares instead', [
          ow(60, 'Your portfolio grows steadily. Spreadsheets are your new favourite thing.', { m: 6000, i: 2 }),
          ow(40, 'The market has other plans. You lose a chunk of your money.', { m: -4500, p: -4, i: 2 })
        ], { req: s => s.money >= 8000, reqText: 'Needs $8,000' })
      ]
    },

    {
      id: 'mentor', min: 32, max: 62, cool: 12, cond: s => !!s.job && !s.job.teen, title: 'A new face at work',
      text: 'A nervous newcomer joins your team. They remind you of yourself, a long time ago.',
      choices: [
        c('Take them under your wing', o('You show them where the coffee is and where the traps are. A few years later, they thank you in a speech.', { r: 6, p: 5, i: 1 })),
        c('Stay out of it', o('They figure it out on their own. You stay focused on your own work.', { p: 1 })),
        c('Make them your project', o('You push them hard. They grow fast, and so do you.', { r: 4, i: 3, h: -1 }))
      ]
    },

    {
      id: 'teenKid', min: 36, max: 58, cool: 4, cond: s => s.people.some(p => p.role === 'child' && p.alive && p.age >= 13 && p.age <= 17), title: 'The teenage years',
      text: '{kid} has stopped telling you things. Their bedroom door is shut more than it is open.',
      choices: [
        c('Listen without judging', o('It takes a few quiet drives, but eventually {kid} starts to talk.', { p: 4 }, { bond: { child: 12 } })),
        c('Set clear rules', o('You draw some lines. They roll their eyes, but they respect the boundaries.', { p: -1 }, { bond: { child: -2 } })),
        c('Give them space', o('You let them breathe. It is hard to watch, and it works.', { p: 1 }, { bond: { child: 5 } }))
      ]
    },

    /* ===== ELDER ===== */

    {
      id: 'retire65', min: 65, max: 65, force: 70, once: true, title: 'Retirement age',
      text: 'The calendar says it is time. A pension is waiting for you, and so are a thousand slow mornings.',
      choices: [
        c('Retire fully', o('You clear out your desk and walk out for the last time. The first morning feels strange. The second feels like freedom.', { p: 8, h: 3 }, { retire: 'full' })),
        c('Keep consulting part-time', o('You trade your full-time role for a few days a week. You keep your mind busy and your income steady.', { p: 4, r: 2 }, { retire: 'consult' })),
        c('Keep working', o('You are not ready yet. The work is part of who you are.', { p: 1, r: 1 }))
      ]
    },

    {
      id: 'retire70', min: 70, max: 70, force: 70, once: true, cond: s => !s.flags.retired, title: 'Is it time?',
      text: 'People keep asking when you are going to stop. You are not sure you ever will.',
      choices: [
        c('Retire at last', o('You finally hand the keys over. Your family throws you a party that nobody forgets.', { p: 9, h: 4, r: 3 }, { retire: 'full' })),
        c('Consult part-time', o('You step back, but not out. A few days a week is the perfect mix.', { p: 4 }, { retire: 'consult' }))
      ]
    },

    {
      id: 'grandkids', min: 60, max: 95, cool: 6, cond: s => s.people.some(p => p.role === 'child' && p.alive), title: 'The grandchildren',
      text: 'The house is loud again. {kid} has brought the little ones over, and they are heading straight for the biscuit tin.',
      choices: [
        c('Spoil them rotten', o('Sweets, stories, and too many toys. You are the best person in the world, according to them.', { p: 9, m: -150 }, { bond: { child: 6 } })),
        c('Tell them stories', o('You tell stories from your life. Their eyes grow wider with every one.', { p: 7, r: 2 }, { bond: { child: 4 } })),
        c('Babysit for the weekend', o('You are exhausted by Sunday. You would do it again tomorrow.', { p: 6, h: -2 }, { bond: { child: 8 } }))
      ]
    },

    {
      id: 'goodbye', min: 66, max: 95, cool: 7, cond: s => has(s, 'friend'), title: 'A friend is gone',
      text: 'The phone call comes early. {friend}, who you have known for most of your life, has passed away.',
      choices: [
        c('Go to the funeral and say a few words', o('You stand up and speak about the best times. Your voice shakes, but every word is true.', { p: -5, r: 3 }, { end: { role: 'friend', why: 'passed away' } })),
        c('Write a letter to the family', o('You write for hours. Their reply, weeks later, makes you cry.', { p: -4, i: 1 }, { end: { role: 'friend', why: 'passed away' } })),
        c('Keep yourself busy', o('You throw yourself into chores and errands. Grief catches up with you at night.', { p: -8, h: -2 }, { end: { role: 'friend', why: 'passed away' } }))
      ]
    },

    {
      id: 'memoir', min: 65, max: 95, once: true, title: 'Your story',
      text: 'Someone has asked you to write down your life. You are not sure it is interesting. Everyone else is quite sure.',
      choices: [
        c('Write a memoir', o('It takes a year. You laugh at some of it, cry at the rest, and finish with a book you are proud of.', { i: 4, r: 8, p: 6 })),
        c('Record your stories out loud', o('You talk to a little recorder for hours. Your family listens to it for years.', { p: 6, r: 2 }, { bond: { child: 6 } })),
        c('Keep it to yourself', o('Some stories are yours alone. That is fine.', { p: 1 }))
      ]
    },

    {
      id: 'bucketList', min: 66, max: 90, once: true, title: 'The list',
      text: 'You find an old, creased piece of paper. It is a list of things you wanted to do before you got old. You are now old.',
      choices: [
        c('Take the big trip', o('Planes, trains, and an overpriced souvenir shop. You tick one item off the list and add three more.', { p: 12, i: 3, m: -6000, h: -1 }, { inc: { travel: 2 } }), { req: s => s.money >= 6000, reqText: 'Needs $6,000' }),
        c('Learn a new language', o('You study every day for months. You order your first coffee in a new language, and it tastes better.', { i: 5, p: 6 })),
        c('Reconnect with someone', o('You make a phone call you have been putting off for decades. It goes better than you hoped.', { p: 9 }, { bond: { friend: 12, child: 8 } }))
      ]
    },

    {
      id: 'legacy', min: 70, max: 100, once: true, cond: s => s.money >= 20000, title: 'What you leave behind',
      text: 'You have more than you need. The question is what to do with it.',
      choices: [
        c('Give to charity', o('You fund a scholarship in your name. A year later, a student thanks you in tears.', { m: -15000, r: 10, p: 10 }, { flags: { donated: true } })),
        c('Leave it for your family', o('You update your will, call everyone, and enjoy their faces when you say it out loud.', { p: 5 }, { bond: { child: 8, spouse: 5 } })),
        c('Spend it on yourself', o('A trip, a hobby, a good chair. You have earned all of it.', { m: -8000, p: 8, h: 2 }))
      ]
    },

    {
      id: 'garden', min: 65, max: 100, cool: 6, title: 'The garden',
      text: 'It started with one pot on the windowsill. Now there are tomatoes, peppers, and a rose bush that is a bit rude to the neighbours.',
      choices: [
        c('Spend every morning out there', o('Soil under your nails and sunshine on your neck. You live a little longer for it.', { h: 5, p: 6 })),
        c('Share the harvest', o('You hand out bags of vegetables to every neighbour. Your name gets very popular.', { r: 5, p: 5 })),
        c('Hire a gardener', o('You sit back with a cold drink and supervise. It is a good life.', { p: 3, m: -400 }))
      ]
    },

    {
      id: 'fall', min: 72, max: 100, cool: 8, w: s => (s.health < 50 ? 16 : 8), title: 'A fall',
      text: 'You miss the last step on the stairs. For a second, everything goes quiet.',
      choices: [
        c('Go straight to the hospital', o('A bruised hip, a sore wrist, and a long wait on a plastic chair. You are in good hands.', { h: -4, m: -700, p: -2 }), { req: s => s.money >= 700, reqText: 'Needs $700' }),
        c('Rest and recover at home', [
          ow(75, 'A few days in bed and a lot of tea. You heal slowly.', { h: -5, p: -2 }),
          ow(25, 'It is worse than you thought. Recovery takes months.', { h: -14, p: -6 })
        ]),
        c('Brush it off', [
          ow(88, 'You are sore, but fine. Nobody has to know.', { h: -3 }),
          ow(12, 'You are not fine. The next morning, you cannot get out of bed.', { h: -30, p: -8 })
        ], { hint: 'Risky' })
      ]
    },

    {
      id: 'centennial', min: 100, max: 100, force: 100, once: true, title: 'One hundred years',
      text: 'Your family fills the house. There is a cake with more candles than anyone can safely light. A journalist is waiting by the door.',
      choices: [
        c('Blow out the candles', o('It takes three tries. The room erupts when you finally do it.', { p: 15, r: 10 })),
        c('Give a short speech', o('"I did not plan any of this," you say. They give you a standing ovation.', { r: 12, p: 10 })),
        c('Ask for a second slice', o('Everyone laughs. You get it.', { p: 12, r: 6 }))
      ]
    },

    /* ===== ANY AGE ===== */

    {
      id: 'luckyDay', min: 8, max: 100, cool: 4, w: 5, title: 'Lucky day',
      text: 'Everything seems to go your way. The bus arrives right on time, the queue is short, and someone pays for your coffee.',
      choices: [
        c('Pay it forward', o('You buy lunch for the next person in line. The smile you get back is worth it.', { m: -15, p: 6, r: 2 })),
        c('Enjoy it quietly', o('You take the good day and keep it to yourself.', { p: 5 })),
        c('Tell everyone', o('You cannot help yourself. People smile, and the day becomes even better.', { p: 4, r: 1 }))
      ]
    },

    {
      id: 'flu', min: 5, max: 100, cool: 3, w: 6, title: 'Under the weather',
      text: 'It starts with a scratchy throat and quickly becomes a full-body shutdown.',
      choices: [
        c('Rest properly', o('You cancel everything and sleep for two days. It is annoying, but it works.', { h: 2, p: -1 })),
        c('Push through', [
          ow(60, 'You get through the week, but you feel like a ghost.', { h: -4, p: -2 }),
          ow(40, 'It drags on much longer than it should have.', { h: -8, p: -4 })
        ]),
        c('Visit a doctor', o('A quick checkup and some medicine. Done in a day.', { h: 4, m: s => (s.age < 18 ? 0 : -80) }))
      ]
    },

    {
      id: 'festival', min: 6, max: 100, cool: 4, w: 6, title: 'Street festival',
      text: 'Music is blasting from somewhere, there is food on every corner, and half your neighbourhood is dancing.',
      choices: [
        c('Dance until your feet hurt', o('You dance until midnight, and do not feel the least bit sorry.', { p: 7, h: 1, r: 2 })),
        c('Help set up the stalls', o('You carry chairs and plug in speakers. People remember who helped.', { r: 5, p: 3 })),
        c('Just watch', o('You find a good spot and watch the crowd for hours. It is its own kind of joy.', { p: 4 }))
      ]
    },

    {
      id: 'oldPhoto', min: 10, max: 100, cool: 6, w: 5, title: 'An old photo',
      text: 'While tidying a drawer, you find a photo from years ago. Everyone in it looks so young.',
      choices: [
        c('Send it to everyone in it', o('Messages and laughter come flooding in. You have not talked this much in years.', { p: 6 }, { bond: { friend: 6, mom: 3 } })),
        c('Frame it', o('It sits on your shelf, quietly keeping an eye on you.', { p: 4 })),
        c('Put it back', o('You close the drawer. Some things are better kept private.', { p: 1 }))
      ]
    },

    {
      id: 'bill', min: 18, max: 100, cool: 4, w: 7, title: 'An unexpected bill',
      text: 'An envelope arrives with a number on it that you were definitely not expecting.',
      choices: [
        c('Pay it now', o('You pay and move on. It hurts the wallet, not the mind.', { m: -450, p: -1 })),
        c('Negotiate', [
          ow(55, 'A patient phone call shaves a good chunk off the total.', { m: -200, i: 1 }),
          ow(45, 'Forty minutes on hold, and the bill stays the same.', { m: -450, p: -3 })
        ]),
        c('Ignore it', o('You leave it on the table until it grows late fees.', { m: -700, p: -3 }))
      ]
    },

    {
      id: 'compliment', min: 8, max: 100, cool: 4, w: 5, title: 'A kind word',
      text: 'A stranger stops you on the street to say something nice. It is such a small thing, and it hits harder than it should.',
      choices: [
        c('Thank them warmly', o('You chat for a minute. You both walk away feeling better.', { p: 5, r: 1 })),
        c('Pass it on to someone else', o('You find someone who looks like they need it. The chain continues.', { p: 4, r: 2 })),
        c('Blush and keep walking', o('You smile the whole way home.', { p: 3 }))
      ]
    },

    /* ===== quiet-year fallback ===== */

    {
      id: 'quiet', min: 0, max: 200, w: 0, title: 'A quiet year',
      text: 'A calm year.',
      choices: [
        c('Make time for the people you love', o('You pick up the phone more, show up more, and listen more.', { p: 4 }, { fn: function (s) { s.people.forEach(function (p) { if (p.alive && p.role !== 'pet') p.bond = Math.min(100, p.bond + 5); }); } })),
        c('Invest in yourself', o('You read, practise, and learn new things. Small steps add up.', { i: 3, p: 1 })),
        c('Take it easy', o('You eat well, sleep well, and let the days be slow.', { h: 3, p: 2 }))
      ]
    }
  ];

  const EVENT_MAP = {};
  EVENTS.forEach(function (e) { EVENT_MAP[e.id] = e; });

  LL.data = {
    STAGES: STAGES,
    EDU_NAMES: EDU_NAMES,
    FAMILY_TEXT: FAMILY_TEXT,
    HOBBY_NAMES: HOBBY_NAMES,
    CITIES: CITIES,
    NAMES_F: NAMES_F,
    NAMES_M: NAMES_M,
    NAMES_ALL: NAMES_ALL,
    PET_NAMES: PET_NAMES,
    MILESTONES: MILESTONES,
    QUIET_TEXTS: QUIET_TEXTS,
    JOBS: JOBS,
    TEEN_JOBS: TEEN_JOBS,
    ALL_JOBS: JOBS.concat(TEEN_JOBS),
    LEVEL_NAMES: LEVEL_NAMES,
    ACTIVITIES: ACTIVITIES,
    ACHIEVEMENTS: ACHIEVEMENTS,
    EVENTS: EVENTS,
    EVENT_MAP: EVENT_MAP
  };
})();
