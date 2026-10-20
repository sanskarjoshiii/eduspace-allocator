# EduSpace: How the System Works

A plain-language guide to every role, every screen and the full flow, from a learner's request to a running class.

---

## 1. What EduSpace does

Cities have rooms that sit empty for hours: school classrooms after school, college computer labs on weekends, community halls, NGO centres. At the same time, people near those rooms want to learn coding, dance, music, art or tuition, and tutors who could teach them have nowhere to teach.

EduSpace brings the three sides together:

| Who | What they bring | What they get |
|---|---|---|
| **Learner** | "I want to learn this, near here, at these times" | A seat in a nearby class |
| **Space Giver** (school, college, NGO, hall) | A room, its equipment, its free hours and its rules | Their idle rooms put to good use, with rent if they charge it |
| **Course Provider** (tutor, institute, dance teacher) | A course, a batch size and preferred times | A suitable room and a ready group of learners |
| **Administrator** (the platform team) | Oversight | Control, monitoring and reports |

The system does the matching automatically. Nobody has to make phone calls or keep spreadsheets. It decides which room should host which class, at what time, and which learners get the seats. It also explains every decision in plain words.

---

## 2. The whole flow in one story

Here is what happens from start to finish, using a real example: **weekend coding classes in Kothrud, Pune.**

1. **The room is registered.** Kothrud Community Centre (a Space Giver) adds its computer lab: 30 seats, 30 working computers, free on Saturdays and Sundays 9:00–18:00, rent ₹300 an hour. It sets **Auto approval**, meaning "accept any booking that follows my rules".
2. **The course is registered.** CodeBridge Pune (a Course Provider) adds a course, "Python Basics", which needs 15 computers. Then it creates an **offering**: a batch of 15 learners, a 2-hour class every Saturday between 10:00 and 13:00, for 8 weeks, in the Kothrud area.
3. **Learners ask.** 18 people near Kothrud submit a request: "I want to learn Coding, Saturday mornings, within 5 km of home."
4. **Smart Allocation runs.** Shortly after new submissions, the system wakes up and does the matching:
   - It checks every possible room for every course against **7 strict rules** (enough seats, working computers, the right time, within distance, within budget, and so on).
   - It scores every room that passes, between 0 and 1.
   - It picks the best overall plan, not just the nearest room.
   - It places learners into seats. If a class is full, the extra learners go on a **waitlist**.
   - Result: Python Basics goes to the Kothrud lab, Saturday 10:00–12:00. 15 learners get a seat and 3 are waitlisted.
5. **The room owner approves.** The lab is set to Auto approval, so this happens instantly. (With Manual approval, the Space Giver would press **Approve**.)
6. **The provider confirms.** CodeBridge sees the proposed room and presses **Confirm**.
7. **Learners get offers.** The 15 seated learners get a notification: "You have a seat in Python Basics, held until Friday 18:00." They have 72 hours to accept.
8. **Learners accept or decline.**
   - **Accept:** the seat is theirs.
   - **Decline**, or no answer in time: the seat automatically goes to the first person on the waitlist.
9. **The schedule is created.** On the first acceptance, the system creates all 8 Saturday sessions and checks that nothing else is booked in the lab at those times.
10. **Classes run.** The provider marks attendance each week. When the course ends, learners are asked to rate it.
11. **Impact is counted.** The numbers (learners served, hours taught, idle hours used) feed the Social Impact and SDG dashboards.

If something breaks, for example 20 computers stop working, the Space Giver reports it. The system checks which classes are affected, finds an alternative room, and asks everyone to confirm the move. Nothing moves without people agreeing.

---

## 3. Key ideas in simple words

**Smart Allocation**
The automatic matching engine. It runs by itself shortly after anyone submits or changes a room, offering or request. The Administrator can also start it with **Run Allocation**.

**The 7 strict rules (hard constraints)**
A room can only be used for a class if all seven pass. If one fails, the system records which one and why.

| # | Rule | Example of a failure |
|---|---|---|
| 1 | The room is active and the time slot is open | "The hall is closed for repairs" |
| 2 | The time fits: the room is free when the class wants to meet, with no clash | "Room is booked Saturday 10:00–12:00 already" |
| 3 | There are enough seats | "25 seats, the batch needs 30" |
| 4 | The equipment works in sufficient numbers | "17 working computers, the course needs 18" |
| 5 | The room's rules allow this course and this age group | "This hall allows only adult classes" |
| 6 | It is close enough to the learners | "6.2 km from the learners, limit 5 km" |
| 7 | The rent fits the provider's budget | "₹600 per hour, budget ₹450 per hour" |

**Compatibility score**
A number from 0 to 1 that says how good a room is for a class (for example 0.86). It is built from seven factors: distance, time fit, equipment fit, seat fit, cost, how much demand the area has, and whether the room is under-used. It is **not** a probability or a percentage chance; it is a quality score.

**Strategy**
Which factors matter most. The Administrator picks one:

| Strategy | What it favours |
|---|---|
| **Balanced** (default) | A fair mix of everything |
| **Accessibility first** | Shortest travel for learners |
| **Maximum reach** | Filling seats and serving high-demand areas |
| **Cost efficient** | Cheapest rooms |

**Waitlist**
When a class is full, extra learners wait in order: best match first, and earlier requests first on a tie. When a seat frees up, the next person gets an offer automatically.

**Offer expiry**
An offered seat is held for 72 hours by default. A reminder goes out 24 hours before it expires. After that, the seat moves to the next person on the waitlist.

**Demand levels**
The system groups areas into **High**, **Medium** and **Emerging** demand, using population, student numbers, how many requests there are, and how many seats are missing. This tells providers and room owners where classes are needed most.

**Privacy stages**
Learners' personal details are revealed only step by step, and only to the people who need them. See section 6.

---

## 4. Every role, every section

Every role sees a sidebar on the left with its own menu. At the top right of every page there are the same tools for everyone:

- **Bell:** notifications. A number shows unread ones; it updates every 30 seconds.
- **Moon or sun icon:** switches between dark and light mode.
- **Your name:** opens **Profile** (name, phone, email preference) and **Sign Out**.

### 4.1 Learner

*Students and anyone who wants to learn.*

| Section | What it shows | What you can do |
|---|---|---|
| **Dashboard** | Your requests with a progress line (Submitted → Matched → Offered → Accepted → Scheduled → Completed), any offers waiting for you, three recommended courses, and how many classes are near you | Accept or decline offers right here; start a **New Request** |
| **My Requests** | All your requests and where each one stands | Open one to see its full timeline, edit it (before it is matched), or cancel it |
| ↳ **New Request** | A form: what to learn, where you live (pick on the map), how far you will travel, preferred days and times, start month, duration, budget, equipment you need | Submit. You must tick the consent box, which explains exactly what is shared and when |
| ↳ **A request's page** | The timeline, the details, and if no class was found, the three best alternatives with reasons | Your request stays open, so you are matched automatically when a suitable class appears |
| **Offers** | Seats offered to you: course, provider, room, area, day and time, distance, fee and compatibility score, with a countdown to the deadline | **Accept Offer** or **Decline**. If you are waitlisted, it shows your place ("You are 2nd on the waitlist"). After acceptance, it shows your upcoming sessions and later a **Rate Course** button |
| **Discover Courses** | Open classes with free seats near you, plus course types in demand nearby or similar to what you asked for, each with reasons | **Request This Course** fills in a new request for you |
| **Demand Insights** | What people in your area want to learn, as totals only | View only |
| **GIS Map** | A map of nearby classes with seats, rooms, and demand by area | Switch map layers on and off |
| **Social Impact** and **SDG Dashboard** | The platform's overall impact numbers | View only |
| **Notifications** | Every message you have received | Mark as read, open the related page |

### 4.2 Space Giver

*Schools, colleges, NGOs and community halls that own rooms.*

| Section | What it shows | What you can do |
|---|---|---|
| **Dashboard** | How full your rooms are, upcoming sessions, bookings waiting for your approval, unused hours, demand near your rooms, open equipment issues | **Approve** or **Decline** bookings; **Add Space** |
| **My Spaces** | Your rooms, with how much of each room's weekly time is booked | Add, edit or delete a room |
| ↳ **Add or edit a space** | Basic details, location on a map, seats, equipment (for example 30 computers, of which 28 working), weekly free time slots (each slot can be blocked), rules, and photos | Save. Rules include: which course types and age groups are allowed, rent per hour, **Auto** or **Manual** approval, and house rules |
| ↳ **Slots and Policies** | One table of every room's approval mode, rent, allowed courses and blocked slots | Quick overview |
| **Allocations** | Classes proposed or booked in your rooms, with the compatibility score and status | Open one to see why your room was chosen. **Approve** or **Decline** if you use Manual approval |
| **Matched Requests** | Learners booked into your rooms. You see the area and times; after they accept, only their **names**, for entry. Never phone numbers or emails | View only |
| **Demand Insights** | What people near your rooms want to learn, as totals | Spot opportunities |
| **GIS Map** | Your rooms, the demand around them, and your unused hours | Switch layers |
| **Facility Issues** | Equipment problems you reported and what happened to the affected classes | **Report Issue** (for example "20 computers down"); **Resolve** when fixed |
| **Analytics** | Room use by day of the week, sessions held, per-room numbers | View only |
| **Activity** | A log of every change made to your records | View only |
| **Social Impact**, **SDG Dashboard**, **Notifications** | As for learners | |

**Auto or Manual approval.** With **Auto**, any booking that follows your rules is accepted immediately. With **Manual**, you get a notification and must press **Approve** for each booking.

### 4.3 Course Provider

*Tutors, institutes and teachers of dance, music, art, coding and tuition.*

| Section | What it shows | What you can do |
|---|---|---|
| **Dashboard** | Your offerings and their status, the room and time each one got, rooms waiting for your confirmation, accepted learners, high-demand areas, attendance rate | **Confirm** proposed rooms; start a **New Offering** |
| **My Courses** | Your courses: what you teach | Add or edit a course: title, category, description, the equipment it needs (for example "15 computers"), cover image |
| **Offerings** | Each scheduled run of a course | Create an offering: batch size, session length, weeks, start date, preferred days and times, target area, the most rent you will pay per hour, fee per month for learners. Set it to Draft, Open or Cancelled |
| **Assigned Spaces** | Rooms the system found for your offerings, with the explanation and score | Open one to see "Why This Space" and "Why Not the Others"; **Confirm** it |
| **Learners** | For each class: the accepted learners with their contact details, the session list, attendance rates and anonymous feedback | **Mark attendance** for each session |
| **Matched Requests** | Learners matched to your classes. Before they accept you see only the area and times; after they accept, their name and contact | View only |
| **Demand Insights** | Which courses are wanted where | Plan new offerings where demand is high |
| **GIS Map** | Your offerings, the rooms and the demand | Switch layers |
| **Analytics** | Seats filled, attendance, ratings, high-demand areas | View only |
| **Activity**, **Social Impact**, **SDG Dashboard**, **Notifications** | As above | |

**Offering status:** **Draft** (not ready yet) → **Open** (looking for a room) → **Allocated** (got a room) → **Active** (classes running) → **Completed**. You can **Cancel** at any time.

### 4.4 Administrator

*The platform team. Sees everything and can step in.*

| Section | What it shows | What you can do |
|---|---|---|
| **Dashboard** | Platform health: how many learners got seats, average travel distance, how full classes are, waitlist rate, open requests, equipment alerts, latest run, requests that found no class, demand by area, impact | **Run Allocation** |
| **Space Registry** | Every room on the platform | View, edit or add any room |
| **Learning Requests** | Every request, with filters | Open any request in full detail |
| **Course Offerings** | Every offering | View or edit any |
| **Smart Allocation** | Every matching run: when, why it started, how long it took, results | **Run Allocation** now; **Retry** a failed run |
| ↳ **A run's page** | A comparison of the smart plan against a simple "nearest room" plan: seats filled, distance, score. This proves the system adds value | Jump to that run's allocations |
| **Allocation Results** | Every proposed or booked class | Open one for the full explanation; **Override** if needed (approve, confirm, reject, cancel or move to another room, always with a written reason that is logged) |
| **Demand Insights** | Demand by area and course across the city, on a map and in a table | Find gaps |
| **GIS Mapping** | The whole city map with all layers | Switch layers |
| **Analytics** | Trends over 12 weeks, room use, runs, requests and allocations by status | View only |
| **Facility Issues** | Every equipment problem | Resolve issues |
| **Audit Logs** | Every change anyone made, with before and after values | Filter by person, record or date |
| **Social Impact** and **SDG Dashboard** | Monthly impact numbers and how they map to the UN Sustainable Development Goals | View only |
| **Settings** | All the system's tuning (see the list below) | Change and save; every change is logged |
| ↳ **Users** | Every account | Add users (including other Administrators), suspend, activate, approve new accounts |
| ↳ **Notification Templates** | The wording of every message the system sends | Edit the text with a live preview; turn email copies on or off per message |
| ↳ **Lookups** | The lists the forms use: equipment types, course categories, city areas | Add, edit or remove items |

**What the Administrator can change in Settings:**

| Setting | Default | Meaning |
|---|---|---|
| Strategy | Balanced | Which factors matter most in matching |
| Strategy weights | Preset values | Fine-tune each factor for each strategy |
| Maximum distance | 10 km | Furthest any learner is placed from a room |
| Minimum score | 0.20 | Pairings scoring below this are never proposed |
| Wait before matching | 30 seconds | Waits after the last submission so a burst of submissions is matched together |
| Offer deadline | 72 hours | How long a learner has to accept |
| Reminder before deadline | 24 hours | When the "offer expiring" reminder goes out |
| Demand alert | 3 areas, 10 requests, 14 days | When to alert providers and room owners about unmet demand |
| Demand grouping | 2–6 groups | How finely areas are grouped into High, Medium and Emerging |
| Email notifications | Off | Send email copies (needs the email service set up) |
| Approve new partners | Off | Whether new Space Giver and Course Provider accounts wait for approval |

---

## 5. What every status means

### A learner's request

| Status | Meaning |
|---|---|
| **Submitted** | Received, waiting for the next matching run |
| **Analysed** | Looked at by the system |
| **Matched** | A class and room were found; waiting for the room owner and provider |
| **Unmatched** | No suitable class yet. The learner sees three alternatives, and the request stays open |
| **Waitlisted** | A suitable class exists but it is full; in the queue |
| **Offered** | A seat is offered; the learner must accept before the deadline |
| **Accepted** | The learner said yes |
| **Scheduled** | Sessions are on the calendar |
| **Active** | Classes have started |
| **Completed** | The course has ended |
| **Declined** / **Expired** / **Cancelled** | Said no / did not answer in time / withdrew |

### A class booking (allocation)

| Status | Meaning |
|---|---|
| **Proposed** | Smart Allocation suggested this room for this class |
| **Approved** | The room owner agreed (automatically or by hand) |
| **Confirmed** | The provider agreed; offers went to learners |
| **Scheduled** | Sessions created |
| **Active** / **Completed** | Classes running / finished |
| **Needs reallocation** | Something broke (for example equipment); an alternative is being arranged |
| **Rejected** / **Cancelled** / **Superseded** | Room owner said no / called off / replaced by a better plan in a newer run |

---

## 6. Privacy: who sees what

Learners share only what is needed, and only when it is needed.

| Stage | Course Provider sees | Space Giver sees |
|---|---|---|
| Before matching | Only totals ("85 requests for Coding near Kothrud") | Only totals |
| Class proposed | Group summary: how many learners, which areas, which times | Head count and times |
| After the learner accepts | Name, age group, phone and email | **Names only**, for entry. Never contact details |
| Always | The Administrator sees everything. Each learner sees their own data | |

**Locations:** a learner's exact home point is never shown to anyone except the learner and the Administrator. Everyone else sees only the **area centre** (for example "Kothrud"). Every page and the map follow this rule, and automated tests check it.

---

## 7. What happens automatically

| When | What the system does |
|---|---|
| Someone saves a room, offering or request | Waits 30 seconds for more changes, then runs Smart Allocation once for the whole batch |
| After every run | Sends notifications; checks for unmet demand across areas and alerts suitable room owners and providers |
| Every hour | Expires unanswered offers, moves seats to the waitlist, sends deadline reminders |
| Every night at 02:00 | Re-checks unconfirmed proposals in case a better plan exists (confirmed classes are never touched); marks classes Active or Completed; asks learners to rate finished courses; updates the impact numbers |

**Only one run happens at a time.** If a run fails, it retries automatically and the Administrator is notified.

**Nothing confirmed moves silently.** A confirmed class changes only through an equipment problem, a cancellation, or an Administrator override, and the people affected are always told.

---

## 8. Special situations

**No class fits a learner.**
The request becomes **Unmatched**. The learner sees the three best alternatives (a nearby class at a different time, a similar course type, and so on) with reasons. The request stays open, so when a provider later creates a suitable offering, the learner is matched automatically.

**A learner declines or does not answer.**
The seat goes to the first person on the waitlist, who gets an offer with a fresh deadline. The provider is told.

**A room owner declines a booking.**
The class goes back to looking for a room, and that room is not proposed again for that class.

**Equipment breaks** (for example 20 computers stop working).
1. The Space Giver presses **Report Issue**.
2. The system re-checks only the classes in that room. Classes that still fit are left alone.
3. For classes that no longer fit, it finds the best alternative room and proposes it.
4. The provider, the new room owner and the learners are notified.
5. Once the new room is approved and the provider confirms, the class moves and the schedule is updated.
6. When the equipment is fixed, the Space Giver presses **Resolve**, and classes that fit again return to their original room if the move has not been confirmed yet.

**Many people want something nobody offers.**
When at least 3 areas each have at least 10 open requests for the same course type within 14 days, and no confirmed class covers them, the system alerts room owners with a free matching slot and providers who teach that subject. The alert is sent once and repeats only if demand changes.

---

## 9. A demo walkthrough for your client

Use the demo accounts (password `Demo-Pass-2026`; the Administrator uses the password set in `.env.local`).

1. **As the Administrator** (`admin@eduspace.local`): open the **Dashboard** and show the platform overview. Press **Run Allocation**, then open **Smart Allocation** and click the run to show the comparison against the simple "nearest room" plan.
2. **Still as the Administrator:** open **Allocation Results**, click a class, and show **Why This Space** and **Why Not the Others**. This is the "explainable" part clients love.
3. **As the Space Giver** (`spaces@eduspace.local`): show **My Spaces** and one room's equipment, slots and rules. On the **Dashboard**, approve a pending booking if there is one.
4. **As the Course Provider** (`provider@eduspace.local`): on the **Dashboard**, press **Confirm** on a proposed room. Show **Learners** and attendance.
5. **As the Learner** (`learner@eduspace.local`): open **Offers** and press **Accept Offer**. Go to **My Requests** and show the status change to **Scheduled**.
6. Finish with the **GIS Map**, **Demand Insights** and the **SDG Dashboard** to show the bigger picture.

**One-line pitch:** *"EduSpace turns idle rooms into classes near home, matches everyone automatically, explains every decision, protects learners' privacy, and measures the social impact."*

---

## 10. Glossary

| Word | Meaning |
|---|---|
| **Space** | A room or venue offered by a Space Giver |
| **Slot** | A weekly time window when a space is free (for example Saturday 9:00–18:00) |
| **Course** | What a provider teaches (for example Python Basics) |
| **Offering** | One run of a course: a batch, times, duration and start date |
| **Request** | A learner's wish to learn something, somewhere, at some time |
| **Allocation** | One offering booked into one space at one weekly time |
| **Enrollment / Offer** | One learner's seat in an allocation |
| **Run** | One pass of Smart Allocation |
| **Baseline** | A simple "nearest room" plan, used only to show how much better the smart plan is |
| **Compatibility score** | 0 to 1 quality score of a match (not a probability) |
| **Area centre** | The middle point of a locality, shown instead of a learner's exact location |
| **SDG** | The UN Sustainable Development Goals: 4 Education, 8 Work, 9 Infrastructure, 10 Equality, 11 Cities, 17 Partnerships |
