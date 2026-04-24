import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export default function App() {
  const mcWorkerRef = useRef(null);
  const useReliabilityMode = true;

  const parseEra = (v) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 4.25;
  };
  const recentPitcherBoost = (obj = {}) => {
    const last3Era = parseFloat(obj?.last3Era || obj?.recentEra || obj?.recentStats?.era || obj?.stats?.pitching?.eraLast3 || NaN);
    const last3Whip = parseFloat(obj?.last3Whip || obj?.recentWhip || obj?.recentStats?.whip || NaN);
    let score = 0;
    if (Number.isFinite(last3Era)) score += (4.5 - last3Era) * 1.8;
    if (Number.isFinite(last3Whip)) score += (1.40 - last3Whip) * 5;
    return clamp(score, -4, 4);
  };
  const pitcherScore = (obj = {}) => {
    const era = parseEra(obj?.era || obj?.seasonStats?.pitching?.era || obj?.stats?.[0]?.splits?.[0]?.stat?.era);
    const whip = parseFloat(obj?.whip || obj?.seasonStats?.pitching?.whip || obj?.stats?.[0]?.splits?.[0]?.stat?.whip || 1.30);
    const wins = parseFloat(obj?.wins || obj?.seasonStats?.pitching?.wins || 0);
    const losses = parseFloat(obj?.losses || obj?.seasonStats?.pitching?.losses || 0);
    const wl = 0;
    const eraScore = (4.8 - era) * 2.6;
    const whipScore = (1.45 - whip) * 7;
    return clamp(eraScore + whipScore + wl + recentPitcherBoost(obj), -10, 10);
  };

  const [games, setGames] = useState([]);
  const [mcResults, setMcResults] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sortBy, setSortBy] = useState('confidence');
  const [lastUpdated, setLastUpdated] = useState(new Date().toLocaleTimeString());
  const teamLogoMap = {
    'New York Yankees':'147','Boston Red Sox':'111','Los Angeles Dodgers':'119','San Diego Padres':'135','New York Mets':'121','Atlanta Braves':'144','Chicago Cubs':'112','St. Louis Cardinals':'138','Houston Astros':'117','Texas Rangers':'140','Toronto Blue Jays':'141','Tampa Bay Rays':'139','Philadelphia Phillies':'143','Milwaukee Brewers':'158','Arizona Diamondbacks':'109','San Francisco Giants':'137','Seattle Mariners':'136','Cleveland Guardians':'114','Detroit Tigers':'116','Minnesota Twins':'142','Kansas City Royals':'118','Baltimore Orioles':'110','Pittsburgh Pirates':'134','Cincinnati Reds':'113','Miami Marlins':'146','Washington Nationals':'120','Colorado Rockies':'115','Los Angeles Angels':'108','Athletics':'133','Chicago White Sox':'145'
  };
  const logoFor = (name = '') => `https://www.mlbstatic.com/team-logos/${teamLogoMap[name] || '0'}.svg`;

  const today = new Date().toISOString().split('T')[0];

  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const calcRecentBoost = (wins, losses) => {
    const gp = wins + losses;
    if (!gp) return 0;
    return ((wins / gp) - 0.5) * 8;
  };

  const getGrade = (wp, isLive = false, edge = 0, seriesDiff = 0) => {
    let score = wp;
    if (isLive) score += 2;
    score += Math.min(6, Math.abs(edge) * 0.35);
    score += Math.min(3, Math.abs(seriesDiff));
    if (score >= 76) return 'A+';
    if (score >= 68) return 'A';
    if (score >= 60) return 'B+';
    if (score >= 54) return 'B';
    if (score >= 48) return 'C+';
    return 'C';
  };
  const getSignal = (wp) => wp > 70 ? 'Elite' : wp > 60 ? 'Strong' : wp > 53 ? 'Lean' : wp < 40 ? 'Upset Shot' : 'Coin Flip';
  const runLambda = (pct, pitcherAdj, bullpenAdj, parkAdj, lineupAdj = 0, recentAdj = 0) => {
    const baseRuns = 4.35 + ((pct - 0.5) * 1.4);
    const offenseAdj = (lineupAdj * 0.9) + (recentAdj * 0.35);
    const envAdj = (parkAdj * 0.10);
    return clamp(baseRuns + offenseAdj + pitcherAdj + bullpenAdj + envAdj, 2.4, 7.2);
  };
  const poissonSample = (lambda) => {
    const L = Math.exp(-lambda);
    let k = 0;
    let p = 1;
    do { k++; p *= Math.random(); } while (p > L);
    return k - 1;
  };

  useEffect(() => {
    const workerCode = `self.onmessage=function(e){const jobs=e.data.jobs; const poisson=(lambda)=>{const L=Math.exp(-lambda);let k=0,p=1;do{k++;p*=Math.random();}while(p>L);return k-1;}; const out=jobs.map(j=>{let w=0;for(let i=0;i<j.sims;i++){const hs=poisson(j.homeLambda);const as=poisson(j.awayLambda);if(hs>as)w+=1;else if(hs===as)w+=0.54;} return {id:j.id, wp:(w/j.sims)*100};}); self.postMessage(out);}`;
    const blob = new Blob([workerCode], { type: 'application/javascript' });
    mcWorkerRef.current = new Worker(URL.createObjectURL(blob));
    mcWorkerRef.current.onmessage = (e) => {
      const arr = e.data || [];
      setMcResults(prev => {
        const next = { ...prev };
        arr.forEach(x => { next[x.id] = x.wp; });
        return next;
      });
    };
    return () => mcWorkerRef.current && mcWorkerRef.current.terminate();
  }, []);

  const buildRows = useCallback((schedule, recentGames = [], mcMap = {}) => {
    const games = schedule?.dates?.[0]?.games || [];
    const matchupCounts = {};
    games.forEach((gm) => {
      const away = gm?.teams?.away?.team?.name || 'Away';
      const home = gm?.teams?.home?.team?.name || 'Home';
      const key = [away, home].sort().join('::');
      matchupCounts[key] = (matchupCounts[key] || 0) + 1;
    });
    return games.map((gm) => {
      const homeWins = gm?.teams?.home?.leagueRecord?.wins || 0;
      const homeLosses = gm?.teams?.home?.leagueRecord?.losses || 0;
      const awayWins = gm?.teams?.away?.leagueRecord?.wins || 0;
      const awayLosses = gm?.teams?.away?.leagueRecord?.losses || 0;
      const homeRuns = gm?.teams?.home?.score ?? 0;
      const awayRuns = gm?.teams?.away?.score ?? 0;
      const totalRuns = homeRuns + awayRuns;

      const homePct = homeWins / Math.max(homeWins + homeLosses, 1);
      const awayPct = awayWins / Math.max(awayWins + awayLosses, 1);
      const homeRS = parseFloat(gm?.teams?.home?.teamStats?.batting?.runsPerGame || 4.4);
      const awayRS = parseFloat(gm?.teams?.away?.teamStats?.batting?.runsPerGame || 4.4);
      const homeRARaw = parseFloat(gm?.teams?.home?.teamStats?.pitching?.runsAllowedPerGame || gm?.teams?.home?.teamStats?.pitching?.runsAllowed || NaN);
      const awayRARaw = parseFloat(gm?.teams?.away?.teamStats?.pitching?.runsAllowedPerGame || gm?.teams?.away?.teamStats?.pitching?.runsAllowed || NaN);
      const homeERA = parseFloat(gm?.teams?.home?.teamStats?.pitching?.era || 4.4);
      const awayERA = parseFloat(gm?.teams?.away?.teamStats?.pitching?.era || 4.4);
      const homeWHIP = parseFloat(gm?.teams?.home?.teamStats?.pitching?.whip || 1.30);
      const awayWHIP = parseFloat(gm?.teams?.away?.teamStats?.pitching?.whip || 1.30);
      const homeRA = Number.isFinite(homeRARaw) ? homeRARaw : clamp(homeERA + ((homeWHIP - 1.30) * 0.9), 3.0, 7.0);
      const awayRA = Number.isFinite(awayRARaw) ? awayRARaw : clamp(awayERA + ((awayWHIP - 1.30) * 0.9), 3.0, 7.0);
      const pExp = 1.83;
      const homePyth = Math.pow(homeRS,pExp) / (Math.pow(homeRS,pExp) + Math.pow(homeRA,pExp));
      const awayPyth = Math.pow(awayRS,pExp) / (Math.pow(awayRS,pExp) + Math.pow(awayRA,pExp));
      const diff = homeWins - awayWins;
      const pctEdge = (homePyth - awayPyth) * 24;
      const homeL10 = recentGames.filter(g => g?.status?.abstractGameState === 'Final' && (g?.teams?.home?.team?.name === (gm?.teams?.home?.team?.name) || g?.teams?.away?.team?.name === (gm?.teams?.home?.team?.name))).slice(0,10);
      const awayL10 = recentGames.filter(g => g?.status?.abstractGameState === 'Final' && (g?.teams?.home?.team?.name === (gm?.teams?.away?.team?.name) || g?.teams?.away?.team?.name === (gm?.teams?.away?.team?.name))).slice(0,10);
      const countWins = (arr, team) => arr.filter(g => { const hs=g?.teams?.home?.score??0; const as=g?.teams?.away?.score??0; const winner = hs>as ? g?.teams?.home?.team?.name : g?.teams?.away?.team?.name; return winner===team; }).length;
      const homeL10w = countWins(homeL10, gm?.teams?.home?.team?.name);
      const awayL10w = countWins(awayL10, gm?.teams?.away?.team?.name);
      const recentEdge = (((homeL10w / Math.max(homeL10.length,1)) - (awayL10w / Math.max(awayL10.length,1))) * 10) * 0.45;
      const runDiff = homeRuns - awayRuns;
      const inning = gm?.linescore?.currentInning || 0;
      const inningWeight = inning ? Math.min(2.8, inning / 3) : 1;
      const liveBoost = gm?.status?.abstractGameState === 'Live' ? runDiff * inningWeight : 0;

      const homePitcherObj = gm?.probablePitchers?.home || gm?.teams?.home?.probablePitcher || gm?.probablePitcher?.home || {};
      const homePitcher = homePitcherObj?.fullName || homePitcherObj?.lastInitName || 'TBD';
      const homeEraRaw = homePitcherObj?.era || homePitcherObj?.seasonStats?.pitching?.era || homePitcherObj?.stats?.[0]?.splits?.[0]?.stat?.era;
      const homeEra = Number.isFinite(parseFloat(homeEraRaw)) ? parseFloat(homeEraRaw).toFixed(2) : '--';
      const awayPitcherObj = gm?.probablePitchers?.away || gm?.teams?.away?.probablePitcher || gm?.probablePitcher?.away || {};
      const awayPitcher = awayPitcherObj?.fullName || awayPitcherObj?.lastInitName || 'TBD';
      const awayEraRaw = awayPitcherObj?.era || awayPitcherObj?.seasonStats?.pitching?.era || awayPitcherObj?.stats?.[0]?.splits?.[0]?.stat?.era;
      const awayEra = Number.isFinite(parseFloat(awayEraRaw)) ? parseFloat(awayEraRaw).toFixed(2) : '--';
      const homePitcherRating = pitcherScore(homePitcherObj);
      const awayPitcherRating = pitcherScore(awayPitcherObj);
      const pitcherBoost = (homePitcherRating - awayPitcherRating) * 1.8;

      const homeBullpenEra = parseEra(gm?.teams?.home?.teamStats?.pitching?.era || gm?.teams?.home?.teamStats?.teamStats?.pitching?.era || 4.10);
      const awayBullpenEra = parseEra(gm?.teams?.away?.teamStats?.pitching?.era || gm?.teams?.away?.teamStats?.teamStats?.pitching?.era || 4.10);
      const homeBullpenWhip = parseFloat(gm?.teams?.home?.teamStats?.pitching?.whip || 1.30);
      const awayBullpenWhip = parseFloat(gm?.teams?.away?.teamStats?.pitching?.whip || 1.30);
      const bullpenEraEdge = (awayBullpenEra - homeBullpenEra) * 2.2;
      const bullpenWhipEdge = (awayBullpenWhip - homeBullpenWhip) * 6;
      const homeBullpenFatigue = parseFloat(gm?.teams?.home?.bullpenFatigueElite ?? gm?.teams?.home?.bullpenFatigue ?? gm?.teams?.home?.teamStats?.bullpenFatigue ?? 0);
      const awayBullpenFatigue = parseFloat(gm?.teams?.away?.bullpenFatigueElite ?? gm?.teams?.away?.bullpenFatigue ?? gm?.teams?.away?.teamStats?.bullpenFatigue ?? 0);
      const fatigueEdge = clamp((awayBullpenFatigue - homeBullpenFatigue) * 1.8, -4, 4);
      const homeFatigueLabel = homeBullpenFatigue >= 2 ? 'Taxed' : homeBullpenFatigue >= 1 ? 'Warm' : 'Fresh';
      const awayFatigueLabel = awayBullpenFatigue >= 2 ? 'Taxed' : awayBullpenFatigue >= 1 ? 'Warm' : 'Fresh';
      const bullpenEdge = clamp(bullpenEraEdge + bullpenWhipEdge + fatigueEdge, -8, 8);
      const venueName = gm?.venue?.name || '';
      const parkMap = {
        'Coors Field': { base: 3.2, hr: 1.2 },
        'Great American Ball Park': { base: 2.6, hr: 1.5 },
        'Fenway Park': { base: 1.8, hr: 1.1 },
        'Yankee Stadium': { base: 1.7, hr: 1.4 },
        'Citizens Bank Park': { base: 1.6, hr: 1.2 },
        'Globe Life Field': { base: 1.0, hr: 1.0 },
        'Petco Park': { base: -2.0, hr: -0.8 },
        'T-Mobile Park': { base: -1.8, hr: -0.6 },
        'Oracle Park': { base: -2.2, hr: -1.0 },
        'loanDepot park': { base: -1.6, hr: -0.5 },
        'Citi Field': { base: -0.8, hr: -0.2 },
        'Kauffman Stadium': { base: -0.6, hr: -0.4 }
      };
      const dynamicAdj = clamp((((homeRS + awayRS) / 2) - 4.4) * 0.35, -1.2, 1.2);
      const parkDataBase = parkMap[venueName] || { base: 0, hr: 0 };
      const parkData = { base: parkDataBase.base + dynamicAdj, hr: parkDataBase.hr + (dynamicAdj * 0.35) };
      const handedBonus = venueName === 'Yankee Stadium' ? 0.5 : venueName === 'Fenway Park' ? 0.3 : 0;
      const strongerTeamBias = homePct >= awayPct ? 0.35 : -0.35;
      const parkFactor = parkData.base + (parkData.hr * strongerTeamBias) + handedBonus;
      const variancePenalty = Math.abs(diff) < 3 ? -2.5 : 0;
      const awayLineupScore = parseFloat(gm?.teams?.away?.lineupStrength || gm?.teams?.away?.teamStats?.batting?.runsPerGame || 4.3);
      const homeLineupScore = parseFloat(gm?.teams?.home?.lineupStrength || gm?.teams?.home?.teamStats?.batting?.runsPerGame || 4.3);
      const lineupPosted = !!(gm?.lineups?.awayConfirmed || gm?.lineups?.homeConfirmed || gm?.teams?.away?.battingOrder?.length || gm?.teams?.home?.battingOrder?.length);
      const lineupEdge = clamp((homeLineupScore - awayLineupScore) * (lineupPosted ? 1.6 : 0.8), -6, 6);
      const winDiffEdge = clamp(diff * 0.22, -4, 4);
      const finalRaw = pctEdge + winDiffEdge + recentEdge + liveBoost + (pitcherBoost * 1.12) + (bullpenEdge * 0.82) + (parkFactor * 0.7) + lineupEdge + variancePenalty + 2.1;
      const finalModel = useReliabilityMode ? finalRaw * 0.92 : finalRaw;
      const isLive = gm?.status?.abstractGameState === 'Live';
      const outsLive = gm?.linescore?.outs ?? 0;
      const inningLive = gm?.linescore?.currentInning || 1;
      const runMargin = homeRuns - awayRuns;
      const progress = Math.min(0.95, ((inningLive - 1) * 3 + outsLive) / 27);
      const liveFatigueBoost = isLive ? fatigueEdge * (0.6 + progress) : 0;
      const liveWpHome = clamp(50 + (runMargin * 12 * progress) + (homePyth - awayPyth) * 20 + pitcherBoost + liveFatigueBoost + (parkFactor * 0.6), 5, 95);
      const pregameWpHome = clamp(50 + finalModel, 28, 72);
      let wp = isLive ? liveWpHome : pregameWpHome;
      if (!isLive) {
        const sims = 10000;
        const recentHomeAdj = ((homeL10w / Math.max(homeL10.length,1)) - 0.5) * 1.2;
        const recentAwayAdj = ((awayL10w / Math.max(awayL10.length,1)) - 0.5) * 1.2;
        const lineupHomeAdj = clamp((homeLineupScore - 4.3) / 2, -1, 1);
        const lineupAwayAdj = clamp((awayLineupScore - 4.3) / 2, -1, 1);
        const homeLambda = runLambda(homePyth, pitcherBoost * 0.045, bullpenEdge * 0.028, parkFactor, lineupHomeAdj, recentHomeAdj);
        const awayLambda = runLambda(awayPyth, -pitcherBoost * 0.045, -bullpenEdge * 0.028, parkFactor * -0.12, lineupAwayAdj, recentAwayAdj);
        let mcWp = mcMap[gm.gamePk] ?? wp;
        if (mcWorkerRef.current && mcMap[gm.gamePk] == null) {
          mcWorkerRef.current.postMessage({ jobs:[{ id: gm.gamePk, sims, homeLambda, awayLambda }] });
        } else {
          let homeWinsSim = 0;
          for (let i = 0; i < sims; i++) {
            const hs = poissonSample(homeLambda);
            const as = poissonSample(awayLambda);
            if (hs > as) homeWinsSim += 1;
            else if (hs === as) homeWinsSim += 0.54;
          }
          mcWp = (homeWinsSim / sims) * 100;
        }
        const baseWp = Math.round(wp);
        wp = Math.round((baseWp * 0.48) + (mcWp * 0.52));
      }

      const awayTeam = gm?.teams?.away?.team?.name || 'Away';
      const homeTeam = gm?.teams?.home?.team?.name || 'Home';
      const matchupKey = [awayTeam, homeTeam].sort().join('::');
      const seriesGame = gm?.seriesGameNumber || 1;
      const seriesTotal = matchupCounts[matchupKey] || gm?.gamesInSeries || 1;
      const seriesStart = new Date(gm?.seriesDescription === 'Regular Season' ? gm.gameDate : gm.gameDate);
      seriesStart.setDate(seriesStart.getDate() - 7);
      let awaySeriesWins = 0;
      let homeSeriesWins = 0;
      recentGames.forEach((pg) => {
        const pgAway = pg?.teams?.away?.team?.name;
        const pgHome = pg?.teams?.home?.team?.name;
        const sameMatchup = (pgAway === awayTeam && pgHome === homeTeam) || (pgAway === homeTeam && pgHome === awayTeam);
        const final = pg?.status?.abstractGameState === 'Final';
        if (sameMatchup && final) {
          const awayScore = pg?.teams?.away?.score ?? 0;
          const homeScore = pg?.teams?.home?.score ?? 0;
          const winner = awayScore > homeScore ? pgAway : pgHome;
          if (winner === awayTeam) awaySeriesWins += 1;
          if (winner === homeTeam) homeSeriesWins += 1;
        }
      });

      return {
        gamePk: gm.gamePk,
        awayTeam,
        homeTeam,
        awayLogo: logoFor(awayTeam),
        homeLogo: logoFor(homeTeam),
        g: `${awayTeam} vs ${homeTeam}`,
        wp: Math.round(wp),
        baseWp: isLive ? Math.round(liveWpHome) : Math.round(pregameWpHome),
        p: wp >= 50 ? (gm?.teams?.home?.team?.name || 'Home') : (gm?.teams?.away?.team?.name || 'Away'),
        pickLogo: wp >= 50 ? logoFor(homeTeam) : logoFor(awayTeam),
        c: getGrade(wp, isLive, Math.round(wp - 50), awaySeriesWins - homeSeriesWins),
        status: gm?.status?.detailedState || 'Scheduled',
        awayPitcher,
        homePitcher,
        awayEra,
        homeEra,
        awayForm: awayPitcherObj?.last3Era || awayPitcherObj?.recentEra || '--',
        homeForm: homePitcherObj?.last3Era || homePitcherObj?.recentEra || '--',
        pitcherEdge: `${homePitcherRating}-${awayPitcherRating}`,
        homeRecord: `${homeWins}-${homeLosses}`,
        homeSplit: `${homeWins}-${homeLosses}`,
        homeBullpen: homeFatigueLabel,
        awayRecord: `${awayWins}-${awayLosses}`,
        awaySplit: `${awayWins}-${awayLosses}`,
        awayBullpen: awayFatigueLabel,
        inning: gm?.linescore?.currentInning || '-',
        inningHalf: gm?.linescore?.inningHalf || '',
        outs: gm?.linescore?.outs ?? '-',
        modelEdge: `${Math.abs(Math.round(wp - 50))}%`,
        confidence: Math.abs(Math.round(wp - 50)),
        wpType: isLive ? 'LIVE' : 'PRE',
        awayPctDisplay: `${(awayPct * 100).toFixed(1)}%`,
        homePctDisplay: `${(homePct * 100).toFixed(1)}%`,
        weather: gm?.venue?.name || 'Venue N/A',
        leverage: gm?.status?.abstractGameState === 'Live' ? 'High' : 'Normal',
        fatigueImpact: Math.round(liveFatigueBoost * 10) / 10,
        parkImpact: parkFactor,
        score: `${awayRuns}-${homeRuns}`,
        series: `${awaySeriesWins}-${homeSeriesWins}`,
        seriesWins: Math.max(awaySeriesWins, homeSeriesWins),
        lineupStatus: lineupPosted ? 'Confirmed' : 'Projected',
        lineupImpact: Math.round(lineupEdge * 10) / 10,
        form10: `${awayL10.length ? awayL10w : '-'}-${awayL10.length ? awayL10.length-awayL10w : '-'} / ${homeL10.length ? homeL10w : '-'}-${homeL10.length ? homeL10.length-homeL10w : '-'}`, 
        streak: '- / -',
      };
    });
  }, []);

  const loadGames = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${today}&hydrate=probablePitcher(stats(group=[pitching],type=[season])),team,teamStats,linescore`);
      const data = await res.json();
      const todayGames = (data?.dates || []).flatMap(d => d.games || []);
      const feedResults = await Promise.all(todayGames.map(async (gm) => {
        try {
          const r = await fetch(`https://statsapi.mlb.com/api/v1.1/game/${gm.gamePk}/feed/live`);
          const j = await r.json();
          return { gamePk: gm.gamePk, feed: j };
        } catch (e) {
          return { gamePk: gm.gamePk, feed: null };
        }
      }));
      const feedMap = {};
      feedResults.forEach((x) => { feedMap[x.gamePk] = x.feed; });
      const recentGames = [];
      const pitcherLast3Map = {};
      const start = new Date(); start.setDate(start.getDate()-30);
      const startStr = start.toISOString().split('T')[0];
      const res2 = await fetch(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&startDate=${startStr}&endDate=${today}&hydrate=team,linescore`);
      const hist = await res2.json();
      recentGames.splice(0, recentGames.length, ...((hist?.dates || []).flatMap(d => d.games || [])));
      await Promise.all(todayGames.map(async (gm)=>{
        const ids = [gm?.probablePitchers?.away?.id, gm?.probablePitchers?.home?.id].filter(Boolean);
        await Promise.all(ids.map(async(pid)=>{
          if (pitcherLast3Map[pid]) return;
          try {
            const r = await fetch(`https://statsapi.mlb.com/api/v1/people/${pid}/stats?stats=gameLog&group=pitching&season=${new Date().getFullYear()}`);
            const j = await r.json();
            const splits = j?.stats?.[0]?.splits || [];
            const last3 = splits.slice(-3);
            const ipToDec = (ip)=>{ const s=String(ip||'0').split('.'); return parseInt(s[0]||0)+(s[1]==='1'?1/3:s[1]==='2'?2/3:0); };
            const er = last3.reduce((a,x)=>a+(parseFloat(x?.stat?.earnedRuns||0)),0);
            const ip = last3.reduce((a,x)=>a+ipToDec(x?.stat?.inningsPitched),0);
            const bb = last3.reduce((a,x)=>a+(parseFloat(x?.stat?.baseOnBalls||0)),0);
            const h = last3.reduce((a,x)=>a+(parseFloat(x?.stat?.hits||0)),0);
            pitcherLast3Map[pid] = { era: ip>0 ? ((er*9)/ip).toFixed(2) : null, whip: ip>0 ? ((bb+h)/ip).toFixed(2) : null };
          } catch(e) {}
        }));
      }));
      todayGames.forEach((gm) => {
        gm.lineups = gm.lineups || {};
        const feed = feedMap[gm.gamePk];
        if (feed?.gameData?.probablePitchers) gm.probablePitchers = feed.gameData.probablePitchers;
        const awayId = gm?.probablePitchers?.away?.id;
        const homeId = gm?.probablePitchers?.home?.id;
        const awayPlayers = feed?.liveData?.boxscore?.teams?.away?.players || {};
        const homePlayers = feed?.liveData?.boxscore?.teams?.home?.players || {};
        const awayOrder = feed?.liveData?.boxscore?.teams?.away?.battingOrder || [];
        const homeOrder = feed?.liveData?.boxscore?.teams?.home?.battingOrder || [];
        gm.teams.away.battingOrder = awayOrder;
        gm.teams.home.battingOrder = homeOrder;
        gm.lineups.awayConfirmed = awayOrder.length >= 9;
        gm.lineups.homeConfirmed = homeOrder.length >= 9;
        gm.teams.away.lineupStrength = awayOrder.slice(0,9).reduce((acc,id)=> acc + parseFloat(awayPlayers[`ID${id}`]?.seasonStats?.batting?.ops || awayPlayers[`ID${id}`]?.stats?.batting?.ops || 0.720),0) / Math.max(1, awayOrder.slice(0,9).length);
        gm.teams.home.lineupStrength = homeOrder.slice(0,9).reduce((acc,id)=> acc + parseFloat(homePlayers[`ID${id}`]?.seasonStats?.batting?.ops || homePlayers[`ID${id}`]?.stats?.batting?.ops || 0.720),0) / Math.max(1, homeOrder.slice(0,9).length);
        if (awayId && awayPlayers[`ID${awayId}`]) {
          const p = awayPlayers[`ID${awayId}`]; const s = p.seasonStats?.pitching || {}; const gs = p.stats?.pitching || {};
          gm.probablePitchers.away = { ...(gm.probablePitchers.away || {}), ...s, era: s?.era || gs?.era, last3Era: pitcherLast3Map[awayId]?.era || gs?.era || s?.era, last3Whip: pitcherLast3Map[awayId]?.whip || gs?.whip || s?.whip, fullName: p.person?.fullName || gm.probablePitchers?.away?.fullName };
        }
        if (homeId && homePlayers[`ID${homeId}`]) {
          const p = homePlayers[`ID${homeId}`]; const s = p.seasonStats?.pitching || {}; const gs = p.stats?.pitching || {};
          gm.probablePitchers.home = { ...(gm.probablePitchers.home || {}), ...s, era: s?.era || gs?.era, last3Era: pitcherLast3Map[homeId]?.era || gs?.era || s?.era, last3Whip: pitcherLast3Map[homeId]?.whip || gs?.whip || s?.whip, fullName: p.person?.fullName || gm.probablePitchers?.home?.fullName };
        }
      });
      const bullpenUseMap = {};
      const bullpenRecentMap = {};
      const bullpenPitchCountMap = JSON.parse(sessionStorage.getItem('bullpenPitchCache') || '{}');
      const bullpenBackToBackMap = {};
      const streakMap = {};
      const l10Map = {};
      const splitMap = {};
      const sortedRecent = [...recentGames].sort((a,b)=> new Date(b.gameDate)-new Date(a.gameDate));
      await Promise.all(sortedRecent.slice(0,7).map(async (g) => {
        try {
          if (bullpenPitchCountMap[g?.gamePk]) {
            const cached = bullpenPitchCountMap[g.gamePk];
            const away = g?.teams?.away?.team?.name;
            const home = g?.teams?.home?.team?.name;
            bullpenPitchCountMap[away] = (bullpenPitchCountMap[away] || 0) + (cached.away || 0);
            bullpenPitchCountMap[home] = (bullpenPitchCountMap[home] || 0) + (cached.home || 0);
            return;
          }
          const r = await fetch(`https://statsapi.mlb.com/api/v1.1/game/${g?.gamePk}/feed/live`);
          const feed = await r.json();
          const away = g?.teams?.away?.team?.name;
          const home = g?.teams?.home?.team?.name;
          const awayPlayers = feed?.liveData?.boxscore?.teams?.away?.players || {};
          const homePlayers = feed?.liveData?.boxscore?.teams?.home?.players || {};
          const sumRelief = (players) => {
            const pitchers = Object.values(players).filter(p => p?.position?.abbreviation === 'P');
            if (!pitchers.length) return 0;
            const sorted = pitchers
              .map(p => ({ p, pitches: parseFloat(p?.stats?.pitching?.numberOfPitches || 0) }))
              .sort((a,b) => b.pitches - a.pitches);
            const relievers = sorted.slice(1);
            return relievers.reduce((acc,x)=> acc + x.pitches, 0);
          };
          const awayRelief = sumRelief(awayPlayers);
          const homeRelief = sumRelief(homePlayers);
          bullpenPitchCountMap[away] = (bullpenPitchCountMap[away] || 0) + awayRelief;
          bullpenPitchCountMap[home] = (bullpenPitchCountMap[home] || 0) + homeRelief;
          bullpenPitchCountMap[g.gamePk] = { away: awayRelief, home: homeRelief };
        } catch(e) {}
      }));
      sessionStorage.setItem('bullpenPitchCache', JSON.stringify(bullpenPitchCountMap));
      sortedRecent.forEach((g)=>{
        const final = g?.status?.abstractGameState === 'Final';
        if(!final) return;
        const away = g?.teams?.away?.team?.name;
        const home = g?.teams?.home?.team?.name;
        const awayScore = g?.teams?.away?.score ?? 0;
        const homeScore = g?.teams?.home?.score ?? 0;
        const awayWin = awayScore > homeScore;
        const awayPen = parseFloat(g?.teams?.away?.teamStats?.pitching?.inningsPitched || g?.teams?.away?.score || 0);
        const homePen = parseFloat(g?.teams?.home?.teamStats?.pitching?.inningsPitched || g?.teams?.home?.score || 0);
        bullpenUseMap[away] = (bullpenUseMap[away] || 0) + Math.min(3, awayPen/9);
        bullpenUseMap[home] = (bullpenUseMap[home] || 0) + Math.min(3, homePen/9);
        bullpenRecentMap[away] = bullpenRecentMap[away] || [];
        bullpenRecentMap[home] = bullpenRecentMap[home] || [];
        bullpenRecentMap[away].push(Math.min(3, awayPen/9));
        bullpenRecentMap[home].push(Math.min(3, homePen/9));
        if (Math.min(3, awayPen/9) > 1.2) bullpenBackToBackMap[away] = (bullpenBackToBackMap[away] || 0) + 1;
        if (Math.min(3, homePen/9) > 1.2) bullpenBackToBackMap[home] = (bullpenBackToBackMap[home] || 0) + 1;
        const homeWin = homeScore > awayScore;
        [[away, awayWin],[home, homeWin]].forEach(([tm,won])=>{
          if(!tm) return;
          l10Map[tm] = l10Map[tm] || [];
          if (l10Map[tm].length < 10) l10Map[tm].push(won ? 'W' : 'L');
          if (!(tm in streakMap)) {
            streakMap[tm] = { type: won ? 'W' : 'L', count: 1, locked: false };
          } else if (!streakMap[tm].locked) {
            const curType = won ? 'W' : 'L';
            if (streakMap[tm].type === curType) {
              streakMap[tm].count += 1;
            } else {
              streakMap[tm].locked = true;
            }
          }
        });
      });
      todayGames.forEach((gm)=>{
        const away = gm?.teams?.away?.team?.name;
        const home = gm?.teams?.home?.team?.name;
        const awayFatigueReal = bullpenUseMap[away] || 0;
        const homeFatigueReal = bullpenUseMap[home] || 0;
        const awayRecentUse = (bullpenRecentMap[away] || []).slice(0,3).reduce((a,b)=>a+b,0);
        const homeRecentUse = (bullpenRecentMap[home] || []).slice(0,3).reduce((a,b)=>a+b,0);
        const awayPitchLoad = (bullpenPitchCountMap[away] || 0) / 90;
        const homePitchLoad = (bullpenPitchCountMap[home] || 0) / 90;
        const awayB2B = (bullpenBackToBackMap[away] || 0) * 0.8;
        const homeB2B = (bullpenBackToBackMap[home] || 0) * 0.8;
        gm.teams.away.bullpenFatigueElite = awayFatigueReal + awayRecentUse + awayPitchLoad + awayB2B;
        gm.teams.home.bullpenFatigueElite = homeFatigueReal + homeRecentUse + homePitchLoad + homeB2B;
      });
      setGames(buildRows(data, recentGames, mcResults).map(row=>{
        const awayFatigueReal = bullpenUseMap[row.awayTeam] || 0;
        const homeFatigueReal = bullpenUseMap[row.homeTeam] || 0;
        const awayRecentUse = (bullpenRecentMap[row.awayTeam] || []).slice(0,3).reduce((a,b)=>a+b,0);
        const homeRecentUse = (bullpenRecentMap[row.homeTeam] || []).slice(0,3).reduce((a,b)=>a+b,0);
        const awayEliteFatigue = awayFatigueReal + awayRecentUse;
        const homeEliteFatigue = homeFatigueReal + homeRecentUse;
        const away10 = l10Map[row.awayTeam] || [];
        const home10 = l10Map[row.homeTeam] || [];
        const away10w = away10.filter(x=>x==='W').length;
        const home10w = home10.filter(x=>x==='W').length;
        const awaySt = streakMap[row.awayTeam];
        const homeSt = streakMap[row.homeTeam];
        return {
          ...row,
          awayBullpen: awayEliteFatigue >= 8 ? 'Burned' : awayEliteFatigue >= 5 ? 'Taxed' : awayEliteFatigue >= 2.5 ? 'Warm' : 'Fresh',
          homeBullpen: homeEliteFatigue >= 8 ? 'Burned' : homeEliteFatigue >= 5 ? 'Taxed' : homeEliteFatigue >= 2.5 ? 'Warm' : 'Fresh',
          fatigueImpact: Math.round((awayEliteFatigue - homeEliteFatigue) * 10) / 10,
          form10: `${away10.length ? away10w : '-'}-${away10.length ? away10.length-away10w : '-'} / ${home10.length ? home10w : '-'}-${home10.length ? home10.length-home10w : '-'}`, 
          streak: `${awaySt ? awaySt.type + awaySt.count : '-'} / ${homeSt ? homeSt.type + homeSt.count : '-'}`,
          awaySplit: `${away10.length ? away10w : '-'}-${away10.length ? away10.length-away10w : '-'}`,
          homeSplit: `${home10.length ? home10w : '-'}-${home10.length ? home10.length-home10w : '-'}`,
        };
      }));
      setLastUpdated(new Date().toLocaleTimeString());
    } catch (e) {
      setError('Unable to load MLB data right now.');
    } finally {
      setLoading(false);
    }
  }, [today, buildRows]);

  useEffect(() => { loadGames(); }, [loadGames]);

  useEffect(() => {
    setGames(prev => prev.map(g => {
      const mcWp = mcResults[g.gamePk];
      if (mcWp == null) return g;
      const base = g.baseWp ?? g.wp;
      const blended = Math.round((base * 0.48) + (mcWp * 0.52));
      return { ...g, wp: blended, confidence: Math.abs(blended - 50), modelEdge: `${Math.abs(blended - 50)}%` };
    }));
  }, [mcResults]);

  const sortedGames = useMemo(() => {
    const rows = [...games];
    const sorters = {
      confidence: (a, b) => b.confidence - a.confidence,
      wp: (a, b) => b.wp - a.wp,
      edge: (a, b) => parseInt(b.modelEdge) - parseInt(a.modelEdge),
      grade: (a, b) => a.c.localeCompare(b.c),
      live: (a, b) => b.leverage.localeCompare(a.leverage),
      game: (a, b) => a.g.localeCompare(b.g),
      series: (a, b) => b.seriesWins - a.seriesWins,
    };
    return rows.sort(sorters[sortBy] || sorters.confidence);
  }, [games, sortBy]);

  const topGames = sortedGames.slice(0, 3);

  const playerProps = topGames.flatMap((g) => {
    const edge = parseInt(g.modelEdge) || 0;
    const runs = (4.1 + (g.wp - 50) * 0.06).toFixed(1);
    return [
      { name: `${g.p} Team Total Over ${runs}`, edge: `Edge +${edge}`, conf: `Confidence ${clamp(55 + edge,55,89)}%` },
      { name: `${g.p} Moneyline`, edge: `Edge +${edge}`, conf: `Confidence ${clamp(52 + edge,52,85)}%` },
    ];
  }).slice(0,6);

  const liveCount = games.filter((g) => /live|progress/i.test(g.status)).length;

  const safeParlay = topGames.slice(0, 2);
  const balancedParlay = topGames.slice(0, 3);
  const aggressiveParlay = sortedGames.slice(0, 5);

  const calcParlay = (legs) => {
    const confidence = legs.length ? Math.round(legs.reduce((acc, g) => acc + g.wp, 0) / legs.length) : 0;
    const edge = legs.reduce((acc, g) => acc + (parseInt(g.modelEdge) || 0), 0);
    return { confidence, edge, legs };
  };

  const safeData = calcParlay(safeParlay);
  const balancedData = calcParlay(balancedParlay);
  const aggressiveData = calcParlay(aggressiveParlay);
  const underdogParlay = sortedGames.filter((g) => g.wp < 50).slice(0, 3);
  const underdogData = calcParlay(underdogParlay);

  return (
    <div className="p-6 bg-slate-950 min-h-screen text-white font-sans">
      <div className="flex items-center justify-between gap-4 flex-wrap mb-6">
        <div>
          <h1 className="text-3xl font-bold">MLB Sharp Board • MLB API LIVE</h1>
          <p className="text-slate-400">Rebalanced accuracy mode using weighted official MLB data + Monte Carlo.</p>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          <div className="px-4 py-2 rounded-2xl bg-emerald-600/20 border border-emerald-500 text-emerald-300 flex items-center gap-2">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse"></span>
            <span>{loading ? 'Connecting to Live MLB Data...' : 'Connected to Live MLB Data'}</span>
          </div>
          <button onClick={loadGames} disabled={loading} className="px-3 py-2 rounded-2xl bg-blue-600 disabled:opacity-60 text-xs font-medium">
            {loading ? 'Refreshing...' : 'Refresh Data'}
          </button>
          <div className="px-3 py-2 rounded-2xl bg-slate-800 text-xs">Updated {lastUpdated}</div>
        </div>
      </div>

      <div className="rounded-2xl bg-slate-900 p-4 overflow-x-auto">
        <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
          <h2 className="text-xl font-semibold">Full Slate</h2>
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="bg-slate-800 rounded-xl px-3 py-2 text-sm">
            <option value="confidence">Confidence</option>
            <option value="wp">Win %</option>
            <option value="edge">Edge</option>
            <option value="grade">Grade</option>
            
            <option value="game">Game</option>
            <option value="series">Series</option>
          </select>
        </div>
        <table className="w-full min-w-[1000px] text-sm">
          <thead><tr className="text-slate-400">
            <th className="p-2 text-left">Game</th><th className="p-2 text-left">Win%</th><th className="p-2 text-left">Pick</th><th className="p-2 text-left">Grade</th><th className="p-2 text-left">Pitchers</th><th className="p-2 text-left">Records</th><th className="p-2 text-left">L10</th><th className="p-2 text-left">Streak</th><th className="p-2 text-left">Series</th>
          </tr></thead>
          <tbody>
            {loading && <tr><td colSpan={9} className="p-3">Loading...</td></tr>}
            {!loading && sortedGames.map((game) => (
              <tr key={game.g} className="border-t border-slate-800">
                <td className="p-2"><div className="flex items-center gap-2 whitespace-nowrap"><img src={game.awayLogo} alt={game.awayTeam} className="w-6 h-6" /><span>@</span><img src={game.homeLogo} alt={game.homeTeam} className="w-6 h-6" /></div></td><td className={`p-2 font-semibold ${game.wp >= 65 ? 'text-emerald-400' : game.wp >= 55 ? 'text-lime-300' : game.wp >= 45 ? 'text-yellow-300' : 'text-rose-400'}`}>{game.wp}%</td><td className="p-2"><div className="flex items-center justify-center"><img src={game.pickLogo} alt={game.p} className="w-6 h-6" /></div></td><td className={`p-2 font-bold ${game.c === 'A+' ? 'text-emerald-400' : game.c === 'A' ? 'text-lime-300' : game.c === 'B+' ? 'text-sky-300' : game.c === 'B' ? 'text-yellow-300' : 'text-slate-300'}`}>{game.c}</td><td className="p-2 whitespace-nowrap text-xs">{game.awayPitcher} (ERA {game.awayEra}) / {game.homePitcher} (ERA {game.homeEra})</td><td className="p-2">{game.awayRecord} / {game.homeRecord}</td><td className="p-2">{game.form10}</td><td className="p-2">{game.streak}</td><td className="p-2">{game.series}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {error && <div className="text-red-400 mt-3">{error}</div>}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 mt-4">
        <div className="rounded-2xl bg-slate-900 p-4"><h2 className="text-xl font-semibold mb-3">Top Signals</h2>{topGames.map((g)=><div key={g.g} className="bg-slate-800 rounded-xl p-3 mb-2 flex justify-between"><span>{g.p}</span><span>{g.modelEdge}</span></div>)}</div>
        <div className="rounded-2xl bg-slate-900 p-4"><h2 className="text-xl font-semibold mb-3">Elite Team Props</h2>{playerProps.map((p,i)=><div key={i} className="bg-slate-800 rounded-xl p-3 mb-2"><div>{p.name}</div><div className="text-slate-400">{p.edge} • {p.conf}</div></div>)}</div>
        <div className="rounded-2xl bg-slate-900 p-4"><h2 className="text-xl font-semibold mb-3">Metrics</h2><div className="bg-slate-800 rounded-xl p-3 mb-2">Live Games: {liveCount}</div><div className="bg-slate-800 rounded-xl p-3 mb-2">Loaded Games: {games.length}</div><div className="bg-slate-800 rounded-xl p-3">Mode: Pythagorean Live Model + True RA Inputs + Elite Bullpen + Smart Park + Monte Carlo 2.0 10K + Confirmed Lineups</div></div>
        <div className="rounded-2xl bg-slate-900 p-4"><h2 className="text-xl font-semibold mb-3">Parlay Builder Elite</h2>
          <div className="bg-slate-800 rounded-xl p-3 mb-3">
            <div className="font-semibold mb-2">Safe 2-Leg</div>
            {safeData.legs.map((pick,i)=><div key={`safe-${i}`} className="text-sm mb-1">Leg {i+1}: {pick.p} ({pick.wp}%)</div>)}
            <div className="text-emerald-300 text-sm">Confidence {safeData.confidence}% • Edge +{safeData.edge}</div>
          </div>
          <div className="bg-slate-800 rounded-xl p-3 mb-3">
            <div className="font-semibold mb-2">Balanced 3-Leg</div>
            {balancedData.legs.map((pick,i)=><div key={`bal-${i}`} className="text-sm mb-1">Leg {i+1}: {pick.p} ({pick.wp}%)</div>)}
            <div className="text-sky-300 text-sm">Confidence {balancedData.confidence}% • Edge +{balancedData.edge}</div>
          </div>
          <div className="bg-slate-800 rounded-xl p-3 mb-3">
            <div className="font-semibold mb-2">Aggressive 5-Leg</div>
            {aggressiveData.legs.map((pick,i)=><div key={`agg-${i}`} className="text-sm mb-1">Leg {i+1}: {pick.p} ({pick.wp}%)</div>)}
            <div className="text-rose-300 text-sm">Confidence {aggressiveData.confidence}% • Edge +{aggressiveData.edge}</div>
          </div>
          <div className="bg-slate-800 rounded-xl p-3">
            <div className="font-semibold mb-2">Underdog 3-Leg</div>
            {underdogData.legs.length === 0 ? <div className="text-sm text-slate-400">No qualified underdogs today.</div> : underdogData.legs.map((pick,i)=><div key={`dog-${i}`} className="text-sm mb-1">Leg {i+1}: {pick.p} ({pick.wp}%)</div>)}
            <div className="text-amber-300 text-sm">Confidence {underdogData.confidence}% • Edge +{underdogData.edge}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
