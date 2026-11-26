// Node.js 설치 확인
// node -v
// npm -v

// 프로젝트 폴더 설정 및 초기화
// npm init -y

// 1 주요 패키지 설치
// 1-1 개발용 패키지 설치 (devDependencies)

// npm install --save-dev \
//   electron \
//   webpack \
//   webpack-cli \
//   @babel/core \
//   babel-loader \
//   @babel/preset-react \
//   @babel/preset-env \
//   style-loader \
//   css-loader \
//   postcss \
//   autoprefixer \
//   tailwindcss \
//   electron-builder \
//   electron-packager

// ⚠️ 이들은 개발/빌드 과정에서만 사용되므로 --save-dev 옵션을 붙입니다.


// 1-2 실행용 패키지 설치 (dependencies)

// npm install \
//   react \
//   react-dom \
//   react-router-dom \
//   prop-types \
//   @electron/remote \
//   chokidar \
//   diff \
//   flatted \
//   mime-types \
//   electron-store


// 실행 및 빌드 명령어

// 개발 모드 실행
// npm start

// 번들만 생성 (Webpack만 실행)
// npm run build

// 개발용 패키지 빌드 (./release-builds/ 생성)
// npm run pack

// 최종 앱 빌드
// npm run dist

// Windows 전용 빌드
// npm run dist:win