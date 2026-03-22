Unreleased Changes
------------------
* Added explorer for ERA data. Set growing season temp definition to >= 5C. Only looks at the current year, not the growing season per se. (Southern hemisphere will be split between two seasons).
* Added SPEI average index for 12/24/48 months. Chose 12 since we are aggregating per year, since SPEI is monthly, we take the mean value for the year for the 12/24/48 band.
* Added annual mean of FLDAS 10-40cm soil moisture for the given year. (We originally proposed GLADS but that is a 3 hour cadence, FLDAS is 1 month, need to consider GEE compute limits).
