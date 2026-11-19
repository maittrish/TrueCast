[trustcast_github_readme.md](https://github.com/user-attachments/files/35066022/trustcast_github_readme.md)
# 🛡️ TrustCast — High-Security Online Voting System

![HTML5](https://img.shields.io/badge/HTML5-E34F26?style=for-the-badge&logo=html5&logoColor=white)
![CSS3](https://img.shields.io/badge/CSS3-1572B6?style=for-the-badge&logo=css3&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)
![PHP](https://img.shields.io/badge/PHP-777BB4?style=for-the-badge&logo=php&logoColor=white)
![MySQL](https://img.shields.io/badge/MySQL-4479A1?style=for-the-badge&logo=mysql&logoColor=white)
![Chart.js](https://img.shields.io/badge/Chart.js-FF6384?style=for-the-badge&logo=chartdotjs&logoColor=white)

**TrustCast** is a constitutionally compliant, loophole-free online voting infrastructure engineered to guarantee **absolute ballot secrecy**, **real-time electoral transparency**, and **mathematical immunity against double-voting, impersonation, and session hijacking**.

---

## 🌐 Live Deployments

- **🗳️ Public Voter Portal:** [https://trustcast.ai.studio/](https://trustcast.ai.studio/)
- **🏛️ ECI Returning Officer Control Console:** [https://trustcast.ai.studio/eci-officer-portal](https://trustcast.ai.studio/eci-officer-portal)

---

## ✨ Core Innovative Features

1. **📊 Real-Time Analytics Dashboard**
   - Live-polling dashboard powered by `fetch()` and **Chart.js** that updates candidate standings, aggregate voter turnout, and age-cohort demographics continuously without page refreshes.
   - Interactive **Constituency Voter Turnout Density Heat Map** mapping participation across constituencies and age groups.

2. **🔐 Cryptographic Vote Receipt (VVPAT Hash)**
   - Generates a unique **SHA-256 ballot inclusion hash** upon vote confirmation.
   - Allows voters to independently verify their vote's inclusion on the public ledger without disclosing their candidate selection.

3. **🏛️ Returning Officer Control Console (Authority Portal)**
   - Enroll citizens and bind EPIC IDs with salted `+91` mobile hashes and parliamentary constituencies.
   - Monitor live electoral roll participation status (`Pending` / `Voted`) while keeping candidate choices mathematically unlinked.
   - Seal polling booths and export certified CSV tallies.

---

## 🛡️ Critical Security & Anti-Rigging Protocols

| Security Protocol | Implementation Details |
| :--- | :--- |
| **Multi-Factor Electoral Roll Check** | Requires matching 10-character Election Commission EPIC ID (`3 letters + 7 digits`), salted SHA-256 `+91` mobile hash / OTP verification, and constituency binding—backed by a **5-attempt lockout** against brute-force or roll scraping. |
| **Absolute Ballot Secrecy** | The `voters` (identity) table and `votes` (ballot) table are **completely decoupled** with zero foreign keys. Commit timestamps are quantized into **15-minute IST buckets** to prevent temporal correlation attacks. |
| **Concurrency & Double-Voting Lock** | Uses ACID-compliant MySQL **InnoDB** atomic transactions (`START TRANSACTION`, row-level locks, `COMMIT`) in PHP so rapid multi-click or scripted submissions cannot bypass the `has_voted` flag. |
| **Session Hijacking & Device Takeover Prevention** | Enforces a strict **3-minute session timeout**, destroys the PHP session and clears local storage the exact millisecond a vote is cast, and locks the browser's **Back** button via JavaScript `history.pushState()` manipulation. |
| **SQL Injection Immunity** | All backend API endpoints strictly return JSON and use **PHP PDO Prepared Statements**. |

---

## 🏗️ System Architecture & Workflow

```text
Voter ──► Multi-Factor Verification (EPIC ID + Mobile Hash/OTP + Constituency)
      ──► Isolated Ballot Booth (Strict 3-Min Countdown Timer)
      ──► Explicit Candidate Confirmation UI
      ──► Atomic InnoDB Transaction (Update voters.has_voted = 1 & Insert Unlinked Vote)
      ──► Instant Session Destruction + Local Storage Clear + Back-Button Lock
      ──► SHA-256 Cryptographic VVPAT Receipt Issued
```

### Decoupled Database Schema (`trustcast_db`)

- **`voters` (Identity Ledger):** `epic_id` (PK), `mobile_hash`, `constituency`, `has_voted` (`0` = Pending, `1` = Voted).
- **`votes` (Anonymous Ballot Ledger):** `vote_id` (PK, Auto-Increment), `candidate_id`, `constituency`, `timestamp_bucket` (15-min quantized IST window).
- *Zero foreign-key links exist between `voters` and `votes`.*

---

## 📂 Project Structure

```text
TrustCast/
├── database/
│   └── database_schema.sql     # InnoDB decoupled schema & transaction-safe tables
├── frontend/
│   ├── index.html              # Multi-Factor Electoral Roll Check UI
│   ├── login.js                # Regex validation, OTP timer & auth handling
│   ├── ballot.html             # Official Candidate Ballot Slate & Confirmation UI
│   ├── ballot.js               # 3-min timer, vote submission & history lock
│   ├── dashboard.html          # Live Constituency Results & Turnout Analytics
│   └── dashboard.js            # Zero-refresh fetch() polling & Chart.js rendering
└── api/
    ├── login.php               # Secure PDO verification & lockout throttling
    ├── cast_vote.php           # Atomic InnoDB transaction & session destruction
    └── get_results.php         # Real-time aggregated JSON tally endpoint
```

---

## 🚀 Local Setup & Installation

### Prerequisites
- **Web Server:** Apache or Nginx (e.g., XAMPP, WAMP, Laragon, or LAMP)
- **PHP:** Version 8.0 or higher (with `pdo_mysql` enabled)
- **Database:** MySQL 8.0+ (InnoDB engine)

### Installation Steps

1. **Clone the repository**
   ```bash
   git clone https://github.com/<your-username>/trustcast.git
   cd trustcast
   ```

2. **Set up the MySQL Database**
   - Create a database named `trustcast_db`.
   - Import `database_schema.sql`:
     ```bash
     mysql -u root -p trustcast_db < database_schema.sql
     ```

3. **Configure Database Credentials**
   - Update your PDO connection parameters (`host`, `dbname`, `username`, `password`) inside the backend PHP configuration/API files (`login.php`, `cast_vote.php`, `get_results.php`).

4. **Run the Application**
   - Place the project folder in your server root (e.g., `htdocs/trustcast` for XAMPP) or start the built-in PHP server:
     ```bash
     php -S localhost:8000
     ```
   - Open `http://localhost:8000` in your browser.

---

## 📸 Screenshots

> *Tip: Upload your screenshots into a `/screenshots` folder in your repository to display them below.*

- **Multi-Factor Electoral Roll Check & Duplicate Vote Prevention**
- **Returning Officer Control Console & Roll Status**
- **Official Candidate Ballot Slate (with 3-Minute Timer)**
- **Cryptographic Vote Receipt (SHA-256 VVPAT Hash)**
- **Live Constituency Results, Age-Group Turnout & Density Heat Map**

---

## 🔮 Future Scope

- Hardware biometric authentication (fingerprint/iris) tied to national ID verification.
- Migrating the anonymized `votes` ledger to a permissioned blockchain (e.g., Hyperledger Fabric) for decentralized public auditing.
- Native mobile applications (Android/iOS) with push-based MFA notifications.

---

## 👨‍💻 Author

**Maittrish Sen Sharma**  
B.Tech (2nd Year) — Computer Science and Engineering (Data Science)  
University of Engineering and Management, Kolkata (UEMK)  
Academic Session: 2025-2029

---

## 📄 License

This project was developed for academic and research purposes. Feel free to fork and extend it under the [MIT License](LICENSE).
