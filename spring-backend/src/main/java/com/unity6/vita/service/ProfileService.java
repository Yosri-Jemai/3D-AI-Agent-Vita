package com.unity6.vita.service;

import com.unity6.vita.dto.AuthDTO;
import com.unity6.vita.dto.ProfileDTO;
import com.unity6.vita.entity.Profile;
import com.unity6.vita.repository.ProfileRepository;
import com.unity6.vita.util.JwtUtil;
import lombok.RequiredArgsConstructor;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class ProfileService {

    private final ProfileRepository profileRepository;
    private final EmailService emailService;
    private final PasswordEncoder passwordEncoder;
    private final AuthenticationManager authenticationManager;
    private final JwtUtil jwtUtil;

    public Profile toEntity(ProfileDTO profileDTO) {
        return Profile.builder()
                .id(profileDTO.getId())
                .fullName(profileDTO.getFullName())
                .email(profileDTO.getEmail())
                .password(passwordEncoder.encode(profileDTO.getPassword()))
                .profileImageUrl(profileDTO.getProfileImageUrl())
                .numTelephone(profileDTO.getNumTelephone())
                .role(profileDTO.getRole())
                .createdAt(profileDTO.getCreatedAt())
                .build();
    }

    public ProfileDTO toDTO(Profile profile) {
        return ProfileDTO.builder()
                .id(profile.getId())
                .fullName(profile.getFullName())
                .email(profile.getEmail())
                .password(profile.getPassword())
                .numTelephone(profile.getNumTelephone())
                .profileImageUrl(profile.getProfileImageUrl())
                .role(profile.getRole())
                .createdAt(profile.getCreatedAt())
                .build();
    }

    public ProfileDTO registerProfile(ProfileDTO profileDTO) {
        Profile newProfile = toEntity(profileDTO);
        newProfile.setActivationToken(UUID.randomUUID().toString());
        Profile savedProfile = profileRepository.save(newProfile);
        String activationLink = "http://localhost:8080/api/v1/activate?token=" + savedProfile.getActivationToken();
        String subject = "Activate your Money Map account";
        String body = "Click the following Link to activate your Money Map account: "+ activationLink;
        emailService.sendEmail(savedProfile.getEmail(), subject, body);
        return  toDTO(savedProfile);
    }

    public boolean activateAccount(String activationToken) {
        return profileRepository.findByActivationToken(activationToken)
                .map(profile-> {
                        profile.setIsActive(true);
                        profileRepository.save(profile);
                        return true;
                }).orElse(false);
    }

    public boolean isAccountActive(String email) {
        return profileRepository.findByEmail(email)
                .map(Profile::getIsActive)
                .orElse(false);
    }

    // User Session
    public Profile getCurrentProfile() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        return profileRepository.findByEmail(authentication.getName())
                .orElseThrow(() -> new UsernameNotFoundException("User not found with email: " + authentication.getName()));
    }

    public ProfileDTO getPublicProfile(String email) {
        if(email == null) {
            return toDTO(getCurrentProfile());
        }else {
            return toDTO(profileRepository.findByEmail(email)
                    .orElseThrow(() -> new UsernameNotFoundException("User not found with email: " + email)));
        }
    }

    public Map<String, Object> authenticateAndGenerateToken(AuthDTO authDTO) {
        try{
            authenticationManager.authenticate(new UsernamePasswordAuthenticationToken(authDTO.getEmail(), authDTO.getPassword()));
            String token = jwtUtil.generateToken(authDTO.getEmail());
            return Map.of("token", token,
                    "user",getPublicProfile(authDTO.getEmail())
            );
        }catch (Exception e) {
            throw new UsernameNotFoundException("Invalid email or password");
        }
    }

    public List<ProfileDTO> getAllProfiles() {
        List<Profile> profiles = profileRepository.findAll();
        return profiles.stream()
                .map(this::toDTO)
                .collect(Collectors.toList());
    }

    // Dans ProfileService.java, ajoutez :
    public Profile getProfileById(Long id) {
        return profileRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("Profile not found with id: " + id));
    }
}
