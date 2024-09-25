"use strict";

// This propagates the version from package.json to Meteor plugins.

const {
  version
} = require('../../package.json');
const fs = require('fs');
const paths = ['./plugins/bundler/package.js', './plugins/watcher/package.js'];
paths.forEach(path => {
  let packageJs = fs.readFileSync(path, 'UTF-8');
  packageJs = packageJs.replace(/(version: ')([^']+)'/, `$1${version}'`);
  if (~path.indexOf('watcher')) {
    packageJs = packageJs.replace(/(communitypackages:meteor-desktop-bundler@)([^']+)'/, `$1${version}'`);
  }
  fs.writeFileSync(path, packageJs);
});
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJ2ZXJzaW9uIiwicmVxdWlyZSIsImZzIiwicGF0aHMiLCJmb3JFYWNoIiwicGF0aCIsInBhY2thZ2VKcyIsInJlYWRGaWxlU3luYyIsInJlcGxhY2UiLCJpbmRleE9mIiwid3JpdGVGaWxlU3luYyJdLCJzb3VyY2VzIjpbIi4uLy4uL2xpYi9zY3JpcHRzL3Byb3BhZ2F0ZVZlcnNpb24uanMiXSwic291cmNlc0NvbnRlbnQiOlsiLy8gVGhpcyBwcm9wYWdhdGVzIHRoZSB2ZXJzaW9uIGZyb20gcGFja2FnZS5qc29uIHRvIE1ldGVvciBwbHVnaW5zLlxuXG5jb25zdCB7IHZlcnNpb24gfSA9IHJlcXVpcmUoJy4uLy4uL3BhY2thZ2UuanNvbicpO1xuY29uc3QgZnMgPSByZXF1aXJlKCdmcycpO1xuXG5jb25zdCBwYXRocyA9IFsnLi9wbHVnaW5zL2J1bmRsZXIvcGFja2FnZS5qcycsICcuL3BsdWdpbnMvd2F0Y2hlci9wYWNrYWdlLmpzJ107XG5wYXRocy5mb3JFYWNoKChwYXRoKSA9PiB7XG4gICAgbGV0IHBhY2thZ2VKcyA9IGZzLnJlYWRGaWxlU3luYyhwYXRoLCAnVVRGLTgnKTtcbiAgICBwYWNrYWdlSnMgPSBwYWNrYWdlSnMucmVwbGFjZSgvKHZlcnNpb246ICcpKFteJ10rKScvLCBgJDEke3ZlcnNpb259J2ApO1xuICAgIGlmICh+cGF0aC5pbmRleE9mKCd3YXRjaGVyJykpIHtcbiAgICAgICAgcGFja2FnZUpzID0gcGFja2FnZUpzLnJlcGxhY2UoLyhjb21tdW5pdHlwYWNrYWdlczptZXRlb3ItZGVza3RvcC1idW5kbGVyQCkoW14nXSspJy8sIGAkMSR7dmVyc2lvbn0nYCk7XG4gICAgfVxuICAgIGZzLndyaXRlRmlsZVN5bmMocGF0aCwgcGFja2FnZUpzKTtcbn0pO1xuIl0sIm1hcHBpbmdzIjoiOztBQUFBOztBQUVBLE1BQU07RUFBRUE7QUFBUSxDQUFDLEdBQUdDLE9BQU8sQ0FBQyxvQkFBb0IsQ0FBQztBQUNqRCxNQUFNQyxFQUFFLEdBQUdELE9BQU8sQ0FBQyxJQUFJLENBQUM7QUFFeEIsTUFBTUUsS0FBSyxHQUFHLENBQUMsOEJBQThCLEVBQUUsOEJBQThCLENBQUM7QUFDOUVBLEtBQUssQ0FBQ0MsT0FBTyxDQUFFQyxJQUFJLElBQUs7RUFDcEIsSUFBSUMsU0FBUyxHQUFHSixFQUFFLENBQUNLLFlBQVksQ0FBQ0YsSUFBSSxFQUFFLE9BQU8sQ0FBQztFQUM5Q0MsU0FBUyxHQUFHQSxTQUFTLENBQUNFLE9BQU8sQ0FBQyxzQkFBc0IsRUFBRSxLQUFLUixPQUFPLEdBQUcsQ0FBQztFQUN0RSxJQUFJLENBQUNLLElBQUksQ0FBQ0ksT0FBTyxDQUFDLFNBQVMsQ0FBQyxFQUFFO0lBQzFCSCxTQUFTLEdBQUdBLFNBQVMsQ0FBQ0UsT0FBTyxDQUFDLHFEQUFxRCxFQUFFLEtBQUtSLE9BQU8sR0FBRyxDQUFDO0VBQ3pHO0VBQ0FFLEVBQUUsQ0FBQ1EsYUFBYSxDQUFDTCxJQUFJLEVBQUVDLFNBQVMsQ0FBQztBQUNyQyxDQUFDLENBQUMiLCJpZ25vcmVMaXN0IjpbXX0=