const e="NODE_ENV".trim(),s="development"===process.env[e],o=process.argv.includes("build"),r=s||o;export{s as isDevelopment,r as isDevelopmentOrNextBuild,o as isNextBuild};
