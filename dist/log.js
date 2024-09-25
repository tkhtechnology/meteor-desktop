"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
/* eslint-disable no-console */
/*
 0.OFF
 1.INFO
 2.WARN
 3.ERROR
 4.TRACE
 5.DEBUG
 6.ALL
 */

class Log {
  constructor(prefix) {
    this.prefix = prefix;
  }
  static level() {
    return process.env.MD_LOG_LEVEL || 'ALL';
  }
  static slice(args) {
    return Array.prototype.slice.call(args, 0);
  }
  log(type, args) {
    console.log.apply(null, [`${type}  ${this.prefix}: `].concat(Log.slice(args)));
  }
  info(...args) {
    if (/INFO|ALL/i.test(Log.level())) {
      this.log('INFO', args);
    }
  }
  warn(...args) {
    if (/WARN|ALL/i.test(Log.level())) {
      this.log('WARN', args);
    }
  }
  error(...args) {
    if (/ERROR|ALL/i.test(Log.level())) {
      this.log('ERROR', args);
    }
  }
  debug(...args) {
    if (/DEBUG|ALL/i.test(Log.level())) {
      this.log('DEBUG', args);
    }
  }
  verbose(...args) {
    if (/VERBOSE|ALL/i.test(Log.level())) {
      this.log('VERBOSE', args);
    }
  }
  trace(...args) {
    if (/TRACE|ALL/i.test(Log.level())) {
      this.log('TRACE', args);
    }
  }
}
exports.default = Log;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJMb2ciLCJjb25zdHJ1Y3RvciIsInByZWZpeCIsImxldmVsIiwicHJvY2VzcyIsImVudiIsIk1EX0xPR19MRVZFTCIsInNsaWNlIiwiYXJncyIsIkFycmF5IiwicHJvdG90eXBlIiwiY2FsbCIsImxvZyIsInR5cGUiLCJjb25zb2xlIiwiYXBwbHkiLCJjb25jYXQiLCJpbmZvIiwidGVzdCIsIndhcm4iLCJlcnJvciIsImRlYnVnIiwidmVyYm9zZSIsInRyYWNlIiwiZXhwb3J0cyIsImRlZmF1bHQiXSwic291cmNlcyI6WyIuLi9saWIvbG9nLmpzIl0sInNvdXJjZXNDb250ZW50IjpbIi8qIGVzbGludC1kaXNhYmxlIG5vLWNvbnNvbGUgKi9cbi8qXG4gMC5PRkZcbiAxLklORk9cbiAyLldBUk5cbiAzLkVSUk9SXG4gNC5UUkFDRVxuIDUuREVCVUdcbiA2LkFMTFxuICovXG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIExvZyB7XG4gICAgY29uc3RydWN0b3IocHJlZml4KSB7XG4gICAgICAgIHRoaXMucHJlZml4ID0gcHJlZml4O1xuICAgIH1cblxuICAgIHN0YXRpYyBsZXZlbCgpIHtcbiAgICAgICAgcmV0dXJuIHByb2Nlc3MuZW52Lk1EX0xPR19MRVZFTCB8fCAnQUxMJztcbiAgICB9XG5cbiAgICBzdGF0aWMgc2xpY2UoYXJncykge1xuICAgICAgICByZXR1cm4gQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwoYXJncywgMCk7XG4gICAgfVxuXG4gICAgbG9nKHR5cGUsIGFyZ3MpIHtcbiAgICAgICAgY29uc29sZS5sb2cuYXBwbHkobnVsbCwgW2Ake3R5cGV9ICAke3RoaXMucHJlZml4fTogYF0uY29uY2F0KExvZy5zbGljZShhcmdzKSkpO1xuICAgIH1cblxuICAgIGluZm8oLi4uYXJncykge1xuICAgICAgICBpZiAoL0lORk98QUxML2kudGVzdChMb2cubGV2ZWwoKSkpIHtcbiAgICAgICAgICAgIHRoaXMubG9nKCdJTkZPJywgYXJncyk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICB3YXJuKC4uLmFyZ3MpIHtcbiAgICAgICAgaWYgKC9XQVJOfEFMTC9pLnRlc3QoTG9nLmxldmVsKCkpKSB7XG4gICAgICAgICAgICB0aGlzLmxvZygnV0FSTicsIGFyZ3MpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgZXJyb3IoLi4uYXJncykge1xuICAgICAgICBpZiAoL0VSUk9SfEFMTC9pLnRlc3QoTG9nLmxldmVsKCkpKSB7XG4gICAgICAgICAgICB0aGlzLmxvZygnRVJST1InLCBhcmdzKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGRlYnVnKC4uLmFyZ3MpIHtcbiAgICAgICAgaWYgKC9ERUJVR3xBTEwvaS50ZXN0KExvZy5sZXZlbCgpKSkge1xuICAgICAgICAgICAgdGhpcy5sb2coJ0RFQlVHJywgYXJncyk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICB2ZXJib3NlKC4uLmFyZ3MpIHtcbiAgICAgICAgaWYgKC9WRVJCT1NFfEFMTC9pLnRlc3QoTG9nLmxldmVsKCkpKSB7XG4gICAgICAgICAgICB0aGlzLmxvZygnVkVSQk9TRScsIGFyZ3MpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgdHJhY2UoLi4uYXJncykge1xuICAgICAgICBpZiAoL1RSQUNFfEFMTC9pLnRlc3QoTG9nLmxldmVsKCkpKSB7XG4gICAgICAgICAgICB0aGlzLmxvZygnVFJBQ0UnLCBhcmdzKTtcbiAgICAgICAgfVxuICAgIH1cbn1cbiJdLCJtYXBwaW5ncyI6Ijs7Ozs7O0FBQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRWUsTUFBTUEsR0FBRyxDQUFDO0VBQ3JCQyxXQUFXQSxDQUFDQyxNQUFNLEVBQUU7SUFDaEIsSUFBSSxDQUFDQSxNQUFNLEdBQUdBLE1BQU07RUFDeEI7RUFFQSxPQUFPQyxLQUFLQSxDQUFBLEVBQUc7SUFDWCxPQUFPQyxPQUFPLENBQUNDLEdBQUcsQ0FBQ0MsWUFBWSxJQUFJLEtBQUs7RUFDNUM7RUFFQSxPQUFPQyxLQUFLQSxDQUFDQyxJQUFJLEVBQUU7SUFDZixPQUFPQyxLQUFLLENBQUNDLFNBQVMsQ0FBQ0gsS0FBSyxDQUFDSSxJQUFJLENBQUNILElBQUksRUFBRSxDQUFDLENBQUM7RUFDOUM7RUFFQUksR0FBR0EsQ0FBQ0MsSUFBSSxFQUFFTCxJQUFJLEVBQUU7SUFDWk0sT0FBTyxDQUFDRixHQUFHLENBQUNHLEtBQUssQ0FBQyxJQUFJLEVBQUUsQ0FBQyxHQUFHRixJQUFJLEtBQUssSUFBSSxDQUFDWCxNQUFNLElBQUksQ0FBQyxDQUFDYyxNQUFNLENBQUNoQixHQUFHLENBQUNPLEtBQUssQ0FBQ0MsSUFBSSxDQUFDLENBQUMsQ0FBQztFQUNsRjtFQUVBUyxJQUFJQSxDQUFDLEdBQUdULElBQUksRUFBRTtJQUNWLElBQUksV0FBVyxDQUFDVSxJQUFJLENBQUNsQixHQUFHLENBQUNHLEtBQUssQ0FBQyxDQUFDLENBQUMsRUFBRTtNQUMvQixJQUFJLENBQUNTLEdBQUcsQ0FBQyxNQUFNLEVBQUVKLElBQUksQ0FBQztJQUMxQjtFQUNKO0VBRUFXLElBQUlBLENBQUMsR0FBR1gsSUFBSSxFQUFFO0lBQ1YsSUFBSSxXQUFXLENBQUNVLElBQUksQ0FBQ2xCLEdBQUcsQ0FBQ0csS0FBSyxDQUFDLENBQUMsQ0FBQyxFQUFFO01BQy9CLElBQUksQ0FBQ1MsR0FBRyxDQUFDLE1BQU0sRUFBRUosSUFBSSxDQUFDO0lBQzFCO0VBQ0o7RUFFQVksS0FBS0EsQ0FBQyxHQUFHWixJQUFJLEVBQUU7SUFDWCxJQUFJLFlBQVksQ0FBQ1UsSUFBSSxDQUFDbEIsR0FBRyxDQUFDRyxLQUFLLENBQUMsQ0FBQyxDQUFDLEVBQUU7TUFDaEMsSUFBSSxDQUFDUyxHQUFHLENBQUMsT0FBTyxFQUFFSixJQUFJLENBQUM7SUFDM0I7RUFDSjtFQUVBYSxLQUFLQSxDQUFDLEdBQUdiLElBQUksRUFBRTtJQUNYLElBQUksWUFBWSxDQUFDVSxJQUFJLENBQUNsQixHQUFHLENBQUNHLEtBQUssQ0FBQyxDQUFDLENBQUMsRUFBRTtNQUNoQyxJQUFJLENBQUNTLEdBQUcsQ0FBQyxPQUFPLEVBQUVKLElBQUksQ0FBQztJQUMzQjtFQUNKO0VBRUFjLE9BQU9BLENBQUMsR0FBR2QsSUFBSSxFQUFFO0lBQ2IsSUFBSSxjQUFjLENBQUNVLElBQUksQ0FBQ2xCLEdBQUcsQ0FBQ0csS0FBSyxDQUFDLENBQUMsQ0FBQyxFQUFFO01BQ2xDLElBQUksQ0FBQ1MsR0FBRyxDQUFDLFNBQVMsRUFBRUosSUFBSSxDQUFDO0lBQzdCO0VBQ0o7RUFFQWUsS0FBS0EsQ0FBQyxHQUFHZixJQUFJLEVBQUU7SUFDWCxJQUFJLFlBQVksQ0FBQ1UsSUFBSSxDQUFDbEIsR0FBRyxDQUFDRyxLQUFLLENBQUMsQ0FBQyxDQUFDLEVBQUU7TUFDaEMsSUFBSSxDQUFDUyxHQUFHLENBQUMsT0FBTyxFQUFFSixJQUFJLENBQUM7SUFDM0I7RUFDSjtBQUNKO0FBQUNnQixPQUFBLENBQUFDLE9BQUEsR0FBQXpCLEdBQUEiLCJpZ25vcmVMaXN0IjpbXX0=