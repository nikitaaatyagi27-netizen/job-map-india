// Skill gap analysis — pure pattern matching, zero LLM cost, instant response.
//
// Strategy: maintain a canonical skill dictionary with common aliases.
// Scan job title + description text for skill mentions, then diff against
// the user's profile to produce matched / missing lists and a score.

const SKILL_DICT = [
  // Frontend
  { canonical: "React",        aliases: ["react","reactjs","react.js","react js"] },
  { canonical: "Next.js",      aliases: ["next.js","nextjs","next js"] },
  { canonical: "Vue.js",       aliases: ["vue","vuejs","vue.js","vue js"] },
  { canonical: "Angular",      aliases: ["angular","angularjs"] },
  { canonical: "TypeScript",   aliases: ["typescript","ts"] },
  { canonical: "JavaScript",   aliases: ["javascript","js","es6","es2015"] },
  { canonical: "HTML/CSS",     aliases: ["html","css","html5","css3","tailwind","sass","scss"] },
  { canonical: "Redux",        aliases: ["redux","redux-toolkit","zustand"] },
  { canonical: "GraphQL",      aliases: ["graphql","gql","apollo"] },

  // Backend
  { canonical: "Node.js",      aliases: ["node","nodejs","node.js","express","expressjs","fastify","nestjs"] },
  { canonical: "Python",       aliases: ["python","django","flask","fastapi"] },
  { canonical: "Java",         aliases: ["java","spring","springboot","spring boot","hibernate"] },
  { canonical: "Go",           aliases: ["golang","go lang"] },
  { canonical: "Rust",         aliases: ["rust","rustlang"] },
  { canonical: "C#",           aliases: ["c#","csharp","dotnet",".net","asp.net"] },
  { canonical: "C++",          aliases: ["c++","cpp"] },
  { canonical: "Ruby",         aliases: ["ruby","rails","ruby on rails"] },
  { canonical: "PHP",          aliases: ["php","laravel","symfony"] },
  { canonical: "Scala",        aliases: ["scala","akka","play framework"] },
  { canonical: "Kotlin",       aliases: ["kotlin"] },
  { canonical: "Swift",        aliases: ["swift","swiftui","xcode"] },

  // Databases
  { canonical: "PostgreSQL",   aliases: ["postgresql","postgres","pg"] },
  { canonical: "MySQL",        aliases: ["mysql","mariadb"] },
  { canonical: "MongoDB",      aliases: ["mongodb","mongoose"] },
  { canonical: "Redis",        aliases: ["redis","redis cache"] },
  { canonical: "Elasticsearch",aliases: ["elasticsearch","elastic","opensearch"] },
  { canonical: "Cassandra",    aliases: ["cassandra","apache cassandra"] },
  { canonical: "DynamoDB",     aliases: ["dynamodb"] },
  { canonical: "SQL",          aliases: ["sql","t-sql","plsql","pl/sql"] },

  // Cloud & DevOps
  { canonical: "AWS",          aliases: ["aws","amazon web services","ec2","s3","lambda","rds","eks","ecs"] },
  { canonical: "GCP",          aliases: ["gcp","google cloud","bigquery","gke","cloud run"] },
  { canonical: "Azure",        aliases: ["azure","microsoft azure","aks"] },
  { canonical: "Docker",       aliases: ["docker","dockerfile","containerization"] },
  { canonical: "Kubernetes",   aliases: ["kubernetes","k8s","helm"] },
  { canonical: "Terraform",    aliases: ["terraform","infrastructure as code","iac"] },
  { canonical: "CI/CD",        aliases: ["ci/cd","github actions","jenkins","gitlab ci","circleci","bitbucket pipelines"] },
  { canonical: "Linux",        aliases: ["linux","unix","bash","shell scripting"] },
  { canonical: "Ansible",      aliases: ["ansible"] },
  { canonical: "Prometheus",   aliases: ["prometheus","grafana","observability"] },

  // ML / Data
  { canonical: "Machine Learning", aliases: ["machine learning","ml","sklearn","scikit-learn","scikit learn"] },
  { canonical: "Deep Learning",    aliases: ["deep learning","dl","neural network","pytorch","tensorflow","keras"] },
  { canonical: "NLP",              aliases: ["nlp","natural language processing","huggingface","transformers","bert","gpt"] },
  { canonical: "Data Engineering", aliases: ["data engineering","etl","airflow","dbt","spark","pyspark","kafka","hadoop"] },
  { canonical: "Data Science",     aliases: ["data science","pandas","numpy","matplotlib","seaborn","jupyter","statistics"] },
  { canonical: "LLM",              aliases: ["llm","large language model","langchain","openai","anthropic","rag"] },
  { canonical: "Computer Vision",  aliases: ["computer vision","opencv","yolo","image processing"] },

  // Mobile
  { canonical: "React Native",  aliases: ["react native","rn"] },
  { canonical: "Flutter",       aliases: ["flutter","dart"] },
  { canonical: "Android",       aliases: ["android","kotlin android","java android"] },
  { canonical: "iOS",           aliases: ["ios","swift ios","objective-c","objc"] },

  // AR/VR / Game
  { canonical: "Unity",         aliases: ["unity","unity3d","unity 3d"] },
  { canonical: "Unreal Engine", aliases: ["unreal","unreal engine","ue4","ue5"] },
  { canonical: "AR/VR",         aliases: ["ar","vr","arvr","arcore","arkit","webxr","openxr","oculus","mixed reality","xr"] },
  { canonical: "WebGL",         aliases: ["webgl","three.js","threejs","babylon.js"] },

  // Security
  { canonical: "Cybersecurity", aliases: ["security","cybersecurity","penetration testing","pentesting","vapt","soc","siem","threat hunting"] },
  { canonical: "Cryptography",  aliases: ["cryptography","encryption","ssl","tls","pki"] },

  // Blockchain
  { canonical: "Blockchain",    aliases: ["blockchain","solidity","ethereum","web3","smart contracts","defi","nft"] },

  // Embedded / IoT
  { canonical: "Embedded Systems", aliases: ["embedded","rtos","firmware","microcontroller","arduino","raspberry pi","fpga","vhdl","verilog"] },

  // Tools
  { canonical: "Git",           aliases: ["git","github","gitlab","bitbucket","version control"] },
  { canonical: "REST APIs",     aliases: ["rest","restful","api","api design","openapi","swagger"] },
  { canonical: "Microservices", aliases: ["microservices","service mesh","istio","grpc"] },
  { canonical: "System Design", aliases: ["system design","distributed systems","scalability","high availability"] },
  { canonical: "Agile",         aliases: ["agile","scrum","kanban","jira","sprint"] },
];

// Build a fast reverse-lookup: alias → canonical
const ALIAS_MAP = new Map();
for (const entry of SKILL_DICT) {
  for (const alias of entry.aliases) {
    ALIAS_MAP.set(alias.toLowerCase(), entry.canonical);
  }
}

// Extract all canonical skills mentioned in a block of text
function extractSkillsFromText(text) {
  if (!text) return new Set();
  const lower = text.toLowerCase();
  const found = new Set();

  for (const [alias, canonical] of ALIAS_MAP) {
    // Word-boundary check to avoid "go" matching "google"
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = alias.length <= 3
      ? new RegExp("\\b" + escaped + "\\b")
      : new RegExp("(?<![a-z0-9])" + escaped + "(?![a-z0-9])");
    if (pattern.test(lower)) {
      found.add(canonical);
    }
  }

  return found;
}

// Normalise a user skill list to canonical names
function normaliseUserSkills(skills) {
  const canonical = new Set();
  for (const skill of skills) {
    const lower = skill.toLowerCase().trim();
    // Try exact alias match first
    if (ALIAS_MAP.has(lower)) {
      canonical.add(ALIAS_MAP.get(lower));
      continue;
    }
    // Partial match: any alias that starts with this skill token
    let matched = false;
    for (const [alias, can] of ALIAS_MAP) {
      if (alias.startsWith(lower) || lower.startsWith(alias)) {
        canonical.add(can);
        matched = true;
        break;
      }
    }
    // If nothing matched, add as-is (capitalised) so it still shows up
    if (!matched) {
      canonical.add(skill.trim());
    }
  }
  return canonical;
}

// Main function — compare user profile against a job
function analyseSkillGap({ primarySkills, secondarySkills, jobTitle, jobDescription }) {
  const text = `${jobTitle || ""} ${jobDescription || ""}`;
  const jobSkills = extractSkillsFromText(text);

  if (jobSkills.size === 0) {
    // Can't analyse without any skill signal from the job
    return { matched: [], missing: [], matchScore: null, hasAnalysis: false };
  }

  const userSkills = normaliseUserSkills([...(primarySkills || []), ...(secondarySkills || [])]);

  const matched = [];
  const missing = [];

  for (const skill of jobSkills) {
    if (userSkills.has(skill)) {
      matched.push(skill);
    } else {
      missing.push(skill);
    }
  }

  const total = matched.length + missing.length;
  const matchScore = total > 0 ? Math.round((matched.length / total) * 100) : null;

  return {
    matched,
    missing,
    matchScore,
    hasAnalysis: total > 0
  };
}

module.exports = { analyseSkillGap, extractSkillsFromText };
