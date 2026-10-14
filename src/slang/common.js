'use strict';
/* Words too common to be a "heard as" variant. A variant is a rewrite rule: "a" -> "aura" would damage every sentence.
   Variants in this list are rejected when a pack loads, unless the entry says allowCommon:true. Terms themselves are not
   checked (a term only ever maps to its own spelling). English and Dutch, deliberately generous. */
const EN = `a about above across after again against all almost also always am an and another any anyone anything are aren't around as at
away back be because been before being below between both but by came can can't cannot come could couldn't day did didn't do does doesn't
doing don't done down during each either else end enough even ever every everyone everything few find first for found from get gets getting
give given go goes going gone good got great had hadn't has hasn't have haven't having he her here hers herself him himself his how however
i i'd i'll i'm i've if in into is isn't it it's its itself just keep know last less let like little long look made make many may me might
more most much must my myself need never new next no nobody none nor not nothing now of off often oh ok okay old on once one only onto or
other our ours out over own part people put really right said same say see she should shouldn't since so some someone something still such
take than that that's the their them then there there's these they they'd they'll they're they've thing things think this those though
through time to together too took toward two under until up upon us use used very want was wasn't way we we'd we'll we're we've well went
were weren't what what's when where whether which while who whom whose why will with without won't would wouldn't yes yet you you'd you'll
you're you've your yours yourself one three four five six seven eight nine ten zero today tomorrow yesterday man men woman women
bro mate guy guys girl boy kid kids game games play played player players team win won lost lose live love hate hit run ran
red blue green black white big small high low fast slow hot cold hard soft easy real true false free open close shut stop start`;
const NL = `aan al alle als altijd ben bij daar dan dat de deze die dit doen door dus een eens en er ge geen had heb heeft hem het hier hij hoe
hun iemand iets ik in is ja je jij jou jullie kan kon kunnen maar me mee meer men met mij mijn moet na naar niet nog nu of om omdat onder ons
ook op over te toch toen tot u uit van veel voor waar was wat we weer wel wij wil worden wordt zal ze zelf zich zij zijn zo zou
goed gaan gaat gedaan gek gaaf geweest heel hallo hoi dag doei mooi nee nou oke oké paar rond samen vaak weg zeg zeker`;
const words = (s) => new Set(s.split(/\s+/).filter(Boolean).map((w) => w.toLowerCase()));
const COMMON = new Set([...words(EN), ...words(NL)]);
module.exports = { COMMON };
